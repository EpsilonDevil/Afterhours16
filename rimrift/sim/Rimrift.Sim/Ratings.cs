// Port of client/js/sim/ratings.js: attribute → physical/gameplay parameters. Attributes are 25..99.
namespace Rimrift.Sim;

public static class Ratings
{
    // ---- JS coercion helpers shared by the ports ----
    /// <summary>`v ?? dflt`</summary>
    public static double Nz(double? v, double dflt) => v ?? dflt;
    /// <summary>`v || dflt` for Numbers: undefined, 0, -0 and NaN are falsy.</summary>
    public static double Or(double? v, double dflt) => v is double x && x != 0 && !double.IsNaN(x) ? x : dflt;
    /// <summary>undefined in arithmetic → NaN</summary>
    public static double Undef(double? v) => v ?? double.NaN;
    /// <summary>`s || dflt` for strings: undefined and "" are falsy.</summary>
    public static string Or(string? s, string dflt) => string.IsNullOrEmpty(s) ? dflt : s!;

    public static readonly string[] ATTRS =
    {
        "close_shot", "mid_range", "three_point", "free_throw",
        "layup", "driving_dunk", "standing_dunk", "post_control",
        "ball_handle", "speed_with_ball", "pass_accuracy",
        "perimeter_d", "interior_d", "steal", "block",
        "off_rebound", "def_rebound",
        "speed", "acceleration", "vertical", "strength", "stamina",
    };
    public static readonly Dictionary<string, string[]> ATTR_GROUPS = new()
    {
        ["Shooting"] = new[] { "close_shot", "mid_range", "three_point", "free_throw" },
        ["Finishing"] = new[] { "layup", "driving_dunk", "standing_dunk", "post_control" },
        ["Playmaking"] = new[] { "ball_handle", "speed_with_ball", "pass_accuracy" },
        ["Defense"] = new[] { "perimeter_d", "interior_d", "steal", "block" },
        ["Rebounding"] = new[] { "off_rebound", "def_rebound" },
        ["Athleticism"] = new[] { "speed", "acceleration", "vertical", "strength", "stamina" },
    };
    static readonly Dictionary<string, string> BOOST_GROUP = new()
    {
        ["shooting"] = "Shooting", ["finishing"] = "Finishing", ["playmaking"] = "Playmaking", ["defense"] = "Defense", ["rebounding"] = "Rebounding", ["athleticism"] = "Athleticism",
    };
    /// <summary>v0.4.2 boosts: +amount to every attribute in each boosted category for one game (capped at 99)</summary>
    public static Build boostedBuild(Build build, IEnumerable<string>? cats, double amount = 5)
    {
        var out_ = new Build
        {
            height = build.height, weight = build.weight, wingspan = build.wingspan, equipment = build.equipment, hand = build.hand,
            icon_badge = build.icon_badge, archetype = build.archetype, style = build.style,
            attributes = build.attributes?.Clone() ?? new Attrs(),
        };
        foreach (var c in cats ?? Array.Empty<string>())
        {
            if (!BOOST_GROUP.TryGetValue(c, out var g) || !ATTR_GROUPS.TryGetValue(g, out var list)) continue;
            foreach (var a in list) out_.attributes[a] = Math.Min(99, Nz(out_.attributes[a], 60) + amount);
        }
        return out_;
    }
    public static readonly Dictionary<string, string> ATTR_LABEL = new()
    {
        ["close_shot"] = "Close Shot", ["mid_range"] = "Mid-Range", ["three_point"] = "Three-Point", ["free_throw"] = "Free Throw",
        ["layup"] = "Layup", ["driving_dunk"] = "Driving Dunk", ["standing_dunk"] = "Standing Dunk", ["post_control"] = "Post Control",
        ["ball_handle"] = "Ball Handle", ["speed_with_ball"] = "Speed w/ Ball", ["pass_accuracy"] = "Pass Accuracy",
        ["perimeter_d"] = "Perimeter D", ["interior_d"] = "Interior D", ["steal"] = "Steal", ["block"] = "Block",
        ["off_rebound"] = "Off. Rebound", ["def_rebound"] = "Def. Rebound",
        ["speed"] = "Speed", ["acceleration"] = "Acceleration", ["vertical"] = "Vertical", ["strength"] = "Strength", ["stamina"] = "Stamina",
    };

    // v0.4.4 rating curve used for every skill check
    public const double SUB70_K = 0.9;
    public static bool proficient(double? v) => Nz(v, 60) >= 70;
    public static double rk(double? v) { double x = rkRaw(v); return proficient(v) ? x : x * SUB70_K; }
    public static double rkRaw(double? v0)
    {
        double v = Nz(v0, 60);
        double x = (v - 25) / 74;
        if (v < 70) x -= JsMath.Pow((70 - v) / 30, 1.4) * 0.2;
        if (v > 95) x += Math.Min(4, v - 95) * 0.03;
        if (v >= 99) x += 0.2;
        if (v > 99) x += (v - 99) * 0.025;
        return Math.Max(0, x);
    }
    public const double RATING_MAX = 105;
    public static double over99(double? v) => Nz(v, 0) > 99 ? rk(Math.Min(RATING_MAX, v!.Value)) - rk(99) : 0;
    // physical attributes (speed, bounce, strength, stamina) get a gentler top end so movement stays sane
    static double n(double? v0) { double v = Nz(v0, 60); return ((v - 25) / 74 + (v > 95 ? (v - 95) * 0.012 : 0) + (v >= 99 ? 0.03 : 0)) * (v < 70 ? SUB70_K : 1); }

    public static Phys physical(Build build)
    {
        var a0 = build.attributes ?? new Attrs();
        var a = new Attrs();
        foreach (var k in a0.Keys) { var v = a0[k]; a[k] = v != null && v > RATING_MAX ? RATING_MAX : v; }
        double H = Or(build.height, 78) * Constants.INCH;
        double W = Or(build.weight, 210) * 0.4536;
        double WS = Or(build.wingspan, Undef(build.height) + 3) * Constants.INCH;
        double massK = JsMath.Pow(95 / W, 0.22);
        double sprint = 6.0 + rk(a["speed"]) * 2.0;
        return new Phys
        {
            H = H, W = W, WS = WS,
            radius = 0.25 + Math.Min(0.08, Math.Max(0, (W - 80) * 0.0016)) + (H - 1.9) * 0.08,
            sprint = sprint,
            jog = sprint * 0.62,
            walk = 1.6,
            ballSpeedK = 0.84 + rk(a["speed_with_ball"]) * 0.14,
            accel = (11 + rk(a["acceleration"]) * 6) * massK * 0.96,
            brake = (17 + rk(a["acceleration"]) * 6) * massK * 0.97,
            turn = 13 * massK * 0.93,
            vertical = 0.42 + n(a["vertical"]) * 0.4,
            reach = Body.bodyDims(build).reachStanding,
            strength = n(a["strength"]) * 0.7 + Math.Min(1, (W - 75) / 50) * 0.3,
            staminaRate = (0.055 - n(a["stamina"]) * 0.03) * 1.35,
            recover = 0.022 + n(a["stamina"]) * 0.032,
        };
    }

    public static readonly Dictionary<string, Dictionary<string, double>> OVERALL_WEIGHTS = new()
    {
        ["PG"] = new() { ["three_point"] = 2, ["mid_range"] = 1.5, ["ball_handle"] = 2.4, ["pass_accuracy"] = 2.2, ["speed_with_ball"] = 1.6, ["speed"] = 1.4, ["acceleration"] = 1.3, ["perimeter_d"] = 1.2, ["steal"] = 1.2, ["layup"] = 1.2, ["close_shot"] = 0.6, ["free_throw"] = 0.6 },
        ["SG"] = new() { ["three_point"] = 2.4, ["mid_range"] = 2, ["ball_handle"] = 1.5, ["pass_accuracy"] = 1, ["speed_with_ball"] = 1.1, ["speed"] = 1.3, ["acceleration"] = 1.2, ["perimeter_d"] = 1.4, ["steal"] = 1.1, ["layup"] = 1.4, ["driving_dunk"] = 0.8, ["free_throw"] = 0.6 },
        ["SF"] = new() { ["three_point"] = 1.6, ["mid_range"] = 1.6, ["layup"] = 1.5, ["driving_dunk"] = 1.3, ["ball_handle"] = 1.1, ["perimeter_d"] = 1.6, ["interior_d"] = 0.8, ["steal"] = 1, ["block"] = 0.8, ["speed"] = 1.1, ["vertical"] = 1, ["strength"] = 0.8, ["def_rebound"] = 0.8 },
        ["PF"] = new() { ["close_shot"] = 1.6, ["mid_range"] = 1.2, ["layup"] = 1.2, ["standing_dunk"] = 1.4, ["driving_dunk"] = 1, ["post_control"] = 1.4, ["interior_d"] = 1.8, ["block"] = 1.4, ["def_rebound"] = 1.8, ["off_rebound"] = 1.5, ["strength"] = 1.4, ["vertical"] = 0.8 },
        ["C"] = new() { ["close_shot"] = 1.8, ["standing_dunk"] = 1.8, ["post_control"] = 1.6, ["interior_d"] = 2.2, ["block"] = 2, ["def_rebound"] = 2.2, ["off_rebound"] = 1.8, ["strength"] = 1.6, ["layup"] = 0.8, ["vertical"] = 0.7 },
    };
    public static double overall(Attrs attrs, string position = "SF")
    {
        var w = OVERALL_WEIGHTS.TryGetValue(position, out var ww) ? ww : OVERALL_WEIGHTS["SF"];
        double s = 0, t = 0;
        foreach (var k in ATTRS) { double wk = w.TryGetValue(k, out var x) ? x : 0.45; s += Nz(attrs[k], 50) * wk; t += wk; }
        double raw = s / t;
        return JsMath.Round(Math.Max(40, Math.Min(99, 40 + (raw - 40) * 1.18)));
    }
}
