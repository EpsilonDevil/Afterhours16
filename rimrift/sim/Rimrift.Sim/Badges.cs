// Port of client/js/sim/badges.js (the v0.4.5 badge model). Descriptions/names are left out; the numbers are all here.
namespace Rimrift.Sim;

public sealed class IconBadge
{
    public string archetype = "";
    public Dictionary<string, double> stats = new();
    public double all, green;
}
public sealed class Takeover
{
    public string[] positions = Array.Empty<string>();
    public string[] stats = Array.Empty<string>();
    public double boost, green;
}

public static class BadgesModel
{
    public static readonly double[] BADGE_K = { 0, 1, 2.1, 3.31, 4.641 };
    public static double bk(Badges? badges, string key) => BADGE_K[Math.Max(0, Math.Min(4, badges?.Tier(key) ?? 0))];

    /// <summary>a per-tier table [0, b1, b2, b3, b4] with each step 10% bigger than the last (same rule as bk)</summary>
    public static double[] tierTable(double[] t)
    {
        var o = new List<double> { 0 };
        for (int i = 1; i < t.Length; i++) o.Add(o[i - 1] + (t[i] - t[i - 1]) * JsMath.Pow(1.1, i - 1));
        return o.ToArray();
    }
    public static readonly string[] TIER_NAMES = { "", "Bronze", "Silver", "Gold", "Hall of Fame" };

    // stat -> the badges that work through it (insertion order kept: effectiveRatings iterates it)
    public static readonly KeyValuePair<string, string[]>[] STAT_BADGES_ORDER =
    {
        new("close_shot", new[] { "contact_finisher", "acrobat", "deadeye" }),
        new("mid_range", new[] { "deadeye", "green_machine", "clutch", "catch_shoot" }),
        new("three_point", new[] { "catch_shoot", "corner_specialist", "limitless", "deadeye", "green_machine", "clutch" }),
        new("free_throw", new[] { "green_machine", "clutch" }),
        new("layup", new[] { "contact_finisher", "acrobat" }),
        new("driving_dunk", new[] { "posterizer" }),
        new("standing_dunk", new[] { "posterizer" }),
        new("post_control", new[] { "contact_finisher", "brick_wall" }),
        new("ball_handle", new[] { "ankle_breaker", "handles_for_days" }),
        new("speed_with_ball", new[] { "handles_for_days" }),
        new("pass_accuracy", new[] { "dimer" }),
        new("perimeter_d", new[] { "pick_pocket", "brick_wall" }),
        new("interior_d", new[] { "rim_protector", "brick_wall" }),
        new("steal", new[] { "pick_pocket", "interceptor" }),
        new("block", new[] { "rim_protector", "chasedown" }),
        new("off_rebound", new[] { "rebound_chaser" }),
        new("def_rebound", new[] { "rebound_chaser" }),
        new("strength", new[] { "brick_wall" }),
    };
    public static readonly Dictionary<string, string[]> STAT_BADGES = STAT_BADGES_ORDER.ToDictionary(k => k.Key, k => k.Value);
    public const double NO_BADGE_K = 0.9;

    public static readonly Dictionary<string, IconBadge> ICON_BADGES = new()
    {
        ["sharp_eye"] = new() { archetype = "sharpshooter", green = 0.05 },
        ["hash_slinging"] = new() { archetype = "slasher", stats = new() { ["driving_dunk"] = 0.05, ["standing_dunk"] = 0.05 } },
        ["oprah"] = new() { archetype = "playmaker", stats = new() { ["ball_handle"] = 0.05, ["speed_with_ball"] = 0.05, ["pass_accuracy"] = 0.05 } },
        ["the_clamp"] = new() { archetype = "lockdown", stats = new() { ["perimeter_d"] = 0.05, ["steal"] = 0.05 } },
        ["the_general"] = new() { archetype = "two_way", all = 0.025 },
        ["big_brother"] = new() { archetype = "glass_cleaner", stats = new() { ["off_rebound"] = 0.05, ["def_rebound"] = 0.05, ["block"] = 0.05, ["interior_d"] = 0.05 } },
        ["open_arms"] = new() { archetype = "stretch_big", stats = new() { ["close_shot"] = 0.03, ["mid_range"] = 0.03, ["three_point"] = 0.03, ["free_throw"] = 0.03, ["perimeter_d"] = 0.03, ["interior_d"] = 0.03, ["steal"] = 0.03, ["block"] = 0.03 } },
        ["sexy_red"] = new() { archetype = "post_scorer", stats = new() { ["layup"] = 0.05, ["post_control"] = 0.05, ["close_shot"] = 0.05 } },
    };
    public static readonly Dictionary<string, string> ICON_FOR_ARCH = ICON_BADGES.ToDictionary(kv => kv.Value.archetype, kv => kv.Key);

    public static readonly Dictionary<string, Takeover> TAKEOVERS = new()
    {
        ["shooting"] = new() { positions = new[] { "PG", "SG" }, stats = new[] { "close_shot", "mid_range", "three_point", "free_throw" }, boost = 6, green = 0.12 },
        ["finishing"] = new() { positions = new[] { "SF", "PF" }, stats = new[] { "layup", "driving_dunk", "standing_dunk", "close_shot", "post_control" }, boost = 6 },
        ["glass"] = new() { positions = new[] { "C" }, stats = new[] { "off_rebound", "def_rebound", "block", "interior_d" }, boost = 6 },
    };
    public static readonly Dictionary<string, string> TAKEOVER_FOR_POS = new() { ["PG"] = "shooting", ["SG"] = "shooting", ["SF"] = "finishing", ["PF"] = "finishing", ["C"] = "glass" };
    public const int TAKEOVER_NEED = 6;
    public const int TAKEOVER_SECS = 90;

    /// <summary>Effective sim ratings. raw = the build's attributes; badges = {id: tier}; icon = icon badge id or null.</summary>
    public static Attrs effectiveRatings(Attrs raw, Badges? badges = null, string? icon = null, string? takeover = null)
    {
        var out_ = raw.Clone();
        badges ??= new Badges();
        foreach (var (stat, list) in STAT_BADGES_ORDER)
        {
            var cur = out_[stat];
            if (cur == null) continue;
            if (!list.Any(b => badges.Tier(b) > 0)) out_[stat] = 25 + (cur.Value - 25) * NO_BADGE_K;
        }
        var ic = icon != null && ICON_BADGES.TryGetValue(icon, out var icb) ? icb : null;
        if (ic != null)
        {
            foreach (var k in out_.Keys.ToList())
            {
                double pct = ic.all + (ic.stats.TryGetValue(k, out var sp) ? sp : 0);
                if (pct != 0) out_[k] = out_[k]!.Value * (1 + pct);
            }
        }
        var t = takeover != null && TAKEOVERS.TryGetValue(takeover, out var tk) ? tk : null;
        if (t != null) foreach (var k in t.stats) if (out_[k] != null) out_[k] = out_[k]!.Value + t.boost;
        return out_;
    }

    /// <summary>The build's attributes with the Icon badge's own % and nothing else. No Icon: the same object back.</summary>
    public static Attrs iconAttributes(Attrs raw, string? icon = null)
    {
        var ic = icon != null && ICON_BADGES.TryGetValue(icon, out var icb) ? icb : null;
        if (ic == null) return raw;
        var out_ = raw.Clone();
        foreach (var k in out_.Keys.ToList())
        {
            double pct = ic.all + (ic.stats.TryGetValue(k, out var sp) ? sp : 0);
            if (pct != 0 && out_[k] != null) out_[k] = out_[k]!.Value * (1 + pct);
        }
        return out_;
    }
}
