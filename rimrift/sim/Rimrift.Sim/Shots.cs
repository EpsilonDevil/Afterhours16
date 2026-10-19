// Port of client/js/sim/shots.js: shot model: classification, timing windows, make probability, physically-solved
// trajectories. Every export is here, in file order. `n` is ratings.rk, as in the JS import.
using static Rimrift.Sim.Ratings;
using static Rimrift.Sim.BadgesModel;

namespace Rimrift.Sim;

public sealed class GradeInfo { public string label = "", color = ""; }

public static class Shots
{
    static double n(double? v) => rk(v);

    // v0.4.5 badge tables: each tier step is 10% bigger than the one before
    static readonly double[] DEADEYE_WIN = tierTable(new[] { 0, 0.15, 0.25, 0.35, 0.45 });
    static readonly double[] DEADEYE_CON = tierTable(new[] { 0, 0.2, 0.35, 0.5, 0.6 });
    static readonly double[] FINISHER_CON = tierTable(new[] { 0, 0.15, 0.25, 0.35, 0.45 });

    public static readonly Dictionary<string, GradeInfo> GRADE = new()
    {
        ["excellent"] = new() { label = "Excellent Release", color = "#36e07a" },
        ["early"] = new() { label = "Slightly Early", color = "#f7c948" },
        ["late"] = new() { label = "Slightly Late", color = "#f7c948" },
        ["vearly"] = new() { label = "Very Early", color = "#ff6b57" },
        ["vlate"] = new() { label = "Very Late", color = "#ff6b57" },
        ["none"] = new() { label = "", color = "#ffffff" },
    };

    public static readonly Dictionary<string, Feel> BASE_FEEL = new()
    {
        ["standard"] = new(1, 1), ["high"] = new(1.03, 0.97), ["flick"] = new(0.94, 1),
        ["push"] = new(0.98, 1.07), ["lean"] = new(1.02, 0.95),
        ["kick"] = new(1.0, 1.0), ["wide"] = new(1.02, 1.04), ["sniper"] = new(0.93, 1.04),
        ["fade"] = new(1.04, 0.94), ["hitch"] = new(1.08, 1.06), ["sling"] = new(0.9, 0.96),
        ["scissor"] = new(1.01, 1.02), ["tuck"] = new(1.03, 1.03), ["sway"] = new(0.97, 1.05),
        ["silk"] = new(1.03, 0.97),
        ["pogo"] = new(1.01, 1.02), ["stork"] = new(1.02, 0.98), ["frog"] = new(1.0, 1.01), ["corkscrew"] = new(1.03, 0.97),
        ["heel"] = new(0.99, 1.0), ["turbo"] = new(0.9, 0.95), ["onestep"] = new(1.0, 1.03), ["tilt"] = new(1.02, 0.96),
        ["catapult"] = new(1.05, 0.98), ["statue"] = new(1.04, 1.04), ["bounce"] = new(0.97, 1.02), ["whip"] = new(0.95, 0.97),
        ["dip"] = new(1.06, 1.05), ["leaner"] = new(0.98, 0.99), ["bicycle"] = new(1.03, 1.0),
        ["sharpeye"] = new(0.9, 1.0),
    };
    public static readonly Dictionary<string, string> SHARP_EYE_PKG = new() { ["jumpshot"] = "js_base_sharpeye", ["release"] = "release_sharpeye" };

    /// <summary>Jumpshot timing package from equipment. icon: the Icon badge he holds (defaults to build.icon_badge).</summary>
    public static ShotPkg jumpshotPackage(Build build, Dictionary<string, CatalogItem>? catalog) => jumpshotPackage(build, catalog, build.icon_badge);
    public static ShotPkg jumpshotPackage(Build build, Dictionary<string, CatalogItem>? catalog, string? icon)
    {
        var eq = build.equipment ?? new Dictionary<string, string>();
        CatalogItem? mine(CatalogItem? i) => (i != null && (string.IsNullOrEmpty(i.icon) || i.icon == icon) ? i : null);
        CatalogItem? look(string slot) => catalog != null && eq.TryGetValue(slot, out var id) && id != null && catalog.TryGetValue(id, out var it) ? it : null;
        var base_ = mine(look("jumpshot"));
        var rel = mine(look("release"));
        double relSec = Nz(rel?.release_seconds, 0.72);
        string style = Or(base_?.style, "standard");
        var feel = BASE_FEEL.TryGetValue(style, out var f) ? f : BASE_FEEL["standard"];
        double setH = Nz(base_?.set_height, 1.05);
        return new ShotPkg
        {
            tRel = (0.36 + relSec * 0.36) * feel.speed,
            arc = Nz(rel?.arc, relSec < 0.65 ? 49 : relSec > 0.8 ? 56 : 52),
            setH = setH,
            push = Nz(base_?.push, 0.1),
            jumpK = Nz(base_?.jump, 0.75),
            apexK = Nz(base_?.apex, 0.9),
            relK = 0.93 + (setH - 1.05) * 0.3,
            winK = feel.win,
            style = style,
            release = System.Text.RegularExpressions.Regex.Replace(Or(rel?.id, "release_classic"), "^(wheel_)?release_", ""),
            hand = Or(build.hand, "R"),
        };
    }

    public const double SHOW_HOP_FLOOR = 0.04;
    public static double showKOf(ShotPkg? pkg, bool close = false) => (!close && (pkg?.jumpK ?? 0) > 1 ? 1 - 1 / pkg!.jumpK : 0);
    /// <summary>o: close, dRim (m), stamina (0..1)</summary>
    public static HopInfo jumperHop(ShotPkg pkg, double vertical, double tRel, bool close = false, double? dRim = null, double? stamina = null)
    {
        double jumpH = vertical * (close ? 0.4 : pkg.jumpK * 0.52) * (Nz(dRim, 0) > 7 ? 0.9 : 1) * (0.85 + 0.15 * Nz(stamina, 1));
        double tUp = Math.Sqrt(2 * jumpH / Constants.GRAVITY);
        double showK = showKOf(pkg, close);
        double takeoff = Math.Max(close ? 0.1 : showK != 0 ? SHOW_HOP_FLOOR : 0.2, tRel - tUp * (close ? 0.9 : pkg.apexK));
        return new HopInfo { jumpH = jumpH, tUp = tUp, takeoff = takeoff, showK = showK };
    }

    public static double timingWindowMs(double? attr, Badges? badges = null)
    {
        return 14 + 52 * JsMath.Pow(rkRaw(attr), 1.25) + (Nz(attr, 0) >= 99 ? 16 : 0) + bk(badges, "green_machine") * 5;
    }
    static double profK(double? attr) => proficient(attr) ? 1 : SUB70_K;

    public const double SMOTHER = 0.75;
    public const double LAYUP_SMOTHER = 1.72;
    public static double insideGuard(double? raw) => Math.Min(1.25, Or(raw, 0) * SMOTHER / LAYUP_SMOTHER);
    public static double guardFor(string? kind, double? raw) => (kind == "layup" || kind == "close" ? insideGuard(raw) : Math.Min(1.25, Or(raw, 0)));
    public static bool isSmothered(double? guard) => Or(guard, 0) >= SMOTHER;
    public const double WIDE_OPEN_GUARD = 0.1, OPEN_GUARD = 0.2, LIGHT_GUARD = 0.45, LAYUP_SURE_OPEN = 85;
    public static string layupState(double? guard) { double g = Or(guard, 0); return g <= WIDE_OPEN_GUARD ? "wide" : g <= OPEN_GUARD ? "open" : g <= LIGHT_GUARD ? "light" : g < SMOTHER ? "contested" : "smothered"; }
    public static readonly Dictionary<string, double> LAYUP_GREEN_BOOST = new() { ["wide"] = 1, ["open"] = 1, ["light"] = 0.8, ["contested"] = 0.55, ["smothered"] = 0 };
    public static bool layupSure(double? guard, double? layupRating) { var s = layupState(guard); return s == "wide" || (s == "open" && Nz(layupRating, 0) >= LAYUP_SURE_OPEN); }
    public static readonly HashSet<string> SHOOTER_ARCH = new() { "sharpshooter", "stretch_big" };
    public const double NON_SHOOTER_WIN = 0.9;
    public static bool isShooterArch(string? arch) => string.IsNullOrEmpty(arch) || SHOOTER_ARCH.Contains(arch!);
    public const double DEF_K = 1.0375;
    public const double BLOCK_K = 1.0375;
    public static double blockUp(double v) => (v > 0 ? v * BLOCK_K : v);
    public const double GREEN_K = 0.9 * (1 - 0.065) * 0.9;
    public const double HOT_BOOST = 0.03;
    public static bool hasBadgeFor(Badges? badges, string stat) => (STAT_BADGES.TryGetValue(stat, out var l) ? l : Array.Empty<string>()).Any(k => (badges?.Tier(k) ?? 0) > 0);
    public static double contestBite(Badges? badges, string stat, double withBadge, double without) => (hasBadgeFor(badges, stat) ? withBadge : without);
    public const double CONTEST_TIER_BOOST = 0.05;
    public static double contestTierK(double? c) => (Or(c, 0) > 0.1 ? 1 + CONTEST_TIER_BOOST : 1);
    public sealed class OffTiming { public double k, cap; }
    public static readonly Dictionary<string, OffTiming> OFF_TIMING = new()
    {
        ["early"] = new() { k = 0.05, cap = 0.03 }, ["late"] = new() { k = 0.05, cap = 0.03 },
        ["vearly"] = new() { k = 0.01, cap = 0.005 }, ["vlate"] = new() { k = 0.01, cap = 0.005 },
    };
    public const double DEEP_D = 35 * 0.3048, HALF_D = COURT.hoopZ;
    public static double deepK(double? d) => Math.Max(0, Math.Min(1, (Or(d, 0) - DEEP_D) / (HALF_D - DEEP_D)));
    public static double deepLuck(double? attr) => 0.001 + 0.009 * JsMath.Pow(Math.Max(0, Math.Min(1, n(attr))), 2);

    public static double greenWindowMs(double? attr, Badges? badges = null, ShotCtx? ctx = null)
    {
        ctx ??= new ShotCtx();
        double w = timingWindowMs(attr, badges) * Or(ctx.greenK, 1) * profK(attr);
        if (ctx.ft) return w * 1.15 * GREEN_K;
        if (ctx.pkg != null && ctx.pkg.winK != 0) w *= ctx.pkg.winK;
        if (Or(ctx.contest, 0) >= SMOTHER || ctx.smothered) return 0;
        if (ctx.nonShooter) w *= NON_SHOOTER_WIN;
        var b = badges ?? new Badges();
        double c = Math.Min(1, Or(ctx.contest, 0)) * (1 - DEADEYE_WIN[b.Tier("deadeye")]);
        double ck = 1 + 0.0375 * Math.Max(0, Math.Min(1, (Or(ctx.contest, 0) - 0.15) / 0.05));
        w *= Math.Max(0, 1 - contestBite(b, ctx.three ? "three_point" : "mid_range", 0.55, 0.66) * ck * c * contestTierK(ctx.contest));
        w *= 1 - 0.28 * Math.Min(1, Or(ctx.moving, 0) / 5) * (ctx.hustle == "prohop" ? 0.5 : 1);
        if (!string.IsNullOrEmpty(ctx.hustle)) w *= HUSTLE_WIN.TryGetValue(ctx.hustle!, out var hw) ? hw : 1;
        if (ctx.fade) w *= 0.82;
        if (ctx.three && Or(ctx.d, 0) > 7.9) w *= Math.Max(0.3, 1 - ((ctx.d!.Value - 7.9) * 0.28) * (1 - Math.Min(0.85, 0.18 * bk(b, "limitless"))));
        if (ctx.catchShoot && b.Has("catch_shoot")) w *= 1 + 0.05 * bk(b, "catch_shoot");
        if (ctx.corner && b.Has("corner_specialist")) w *= 1 + 0.05 * bk(b, "corner_specialist");
        if (Or(ctx.d, 0) > DEEP_D) return Math.Max(0, w * (1 - deepK(ctx.d))) * GREEN_K;
        return Math.Max(9 * Or(ctx.greenK, 1), w) * GREEN_K;
    }

    /// <summary>which hand finishes a layup: the far hand when a defender is on one side or at the rim</summary>
    public static string layupHand(string? cov, double? covSide) => (cov == "side" || cov == "rim") && Or(covSide, 1) > 0 ? "L" : "R";

    public static ShotPkg? naturalPkg(ShotPkg? pkg) { if (pkg == null) return null; var c = pkg.Clone(); c.winK = Math.Min(1, pkg.winK); return c; }

    public static readonly Dictionary<string, LayupFeel> LAYUP_FEEL = new()
    {
        ["basic"] = new(0.48, 1.0, 0), ["euro"] = new(0.56, 0.95, 0.06), ["finger"] = new(0.6, 0.92, 0), ["scoop"] = new(0.4, 1.06, 0.02),
        ["reverse"] = new(0.62, 0.94, 0.03), ["hop"] = new(0.5, 1.03, 0.08), ["floater"] = new(0.36, 0.96, 0), ["spin"] = new(0.52, 0.95, 0.12),
    };
    public static readonly Dictionary<string, double> LAYUP_COVER = new() { ["open"] = 0, ["side"] = 0.03, ["front"] = 0.1, ["rim"] = 0.07, ["trail"] = -0.06 };

    public static LayupCover layupCoverage(SimPlayer p, Vec3 rim, IEnumerable<SimPlayer> defs)
    {
        double d0 = JsMath.Hypot(rim.x - p.x, rim.z - p.z), d = d0 != 0 && !double.IsNaN(d0) ? d0 : 1, ux = (rim.x - p.x) / d, uz = (rim.z - p.z) / d;
        string bestKind = "open"; int bestSide = 0; double bestThreat = 0, bestDist = 99;
        foreach (var q in defs)
        {
            if (q.action?.type == "stumble" || q.action?.type == "hang") continue;
            double rx = q.x - p.x, rz = q.z - p.z, dist = JsMath.Hypot(rx, rz);
            if (dist > 3.4) continue;
            double along = rx * ux + rz * uz, lat = rx * uz - rz * ux;
            double toRim = JsMath.Hypot(q.x - rim.x, q.z - rim.z), chase = q.vx * ux + q.vz * uz;
            string? kind = null; double threat = 0;
            if (toRim < 1.8 && along > 0.4) { kind = "rim"; threat = 3; }
            else if (along > 0.25 && along < 1.8 && Math.Abs(lat) < 0.7) { kind = "front"; threat = 2.5; }
            else if (along > -0.5 && along < 1.6 && Math.Abs(lat) < 1.5) { kind = "side"; threat = 2; }
            else if (along > -2.2 && along <= -0.3 && Math.Abs(lat) < 1.3 && chase > 1.5) { kind = "trail"; threat = 1.5; }
            if (kind != null && (threat > bestThreat || (threat == bestThreat && dist < bestDist)))
            { bestKind = kind; bestSide = lat > 0.05 ? -1 : lat < -0.05 ? 1 : 0; bestThreat = threat; bestDist = dist; }
        }
        return new LayupCover { kind = bestKind, side = bestSide };
    }

    public const double LAYUP_WIN_K = 1.2;
    public static double layupWindowMs(double? attr, Badges? badges = null, ShotCtx? ctx = null)
    {
        ctx ??= new ShotCtx();
        if (ctx.smothered) return 0;
        var f = ctx.lstyle != null && LAYUP_FEEL.TryGetValue(ctx.lstyle, out var ff) ? ff : LAYUP_FEEL["basic"];
        double w = timingWindowMs(attr, badges) * LAYUP_WIN_K * (ctx.natural ? Math.Min(1, f.win) : f.win) * Or(ctx.greenK, 1) * profK(attr);
        double c = Math.Min(1.2, Or(ctx.contest, 0)) * (1 - FINISHER_CON[badges?.Tier("contact_finisher") ?? 0]);
        bool fin = hasBadgeFor(badges, "layup");
        w *= Math.Max(fin ? 0.5 : 0.45, 1 - (fin ? 0.4 : 0.48) * c * contestTierK(ctx.contest));
        return Math.Max(9, w) * GREEN_K;
    }

    public static readonly Dictionary<string, double> HUSTLE_TIMING = new() { ["pullup"] = 0.9, ["runfade"] = 1.1, ["prohop"] = 1.16 };
    public static readonly Dictionary<string, double> HUSTLE_WIN = new() { ["pullup"] = 0.94, ["runfade"] = 0.9, ["prohop"] = 1.0 };
    public static double jumperTimingK(ShotCtx? o = null)
    {
        o ??= new ShotCtx();
        double k = 1;
        if (!string.IsNullOrEmpty(o.hustle)) k *= HUSTLE_TIMING.TryGetValue(o.hustle!, out var ht) ? ht : 1;
        else if (Or(o.moving, 0) > 2) k *= 0.95;
        if (o.stepback) k *= 1.06;
        else if (o.fade) k *= 1.04;
        if (o.three) k *= 1.03;
        return k;
    }

    public static string gradeFromWindow(double errSec, double windowMs)
    {
        double w = windowMs / 1000, a = Math.Abs(errSec);
        if (w > 0 && a <= w) return "excellent";
        if (a <= Math.Max(w * 2.6, 0.075)) return errSec < 0 ? "early" : "late";
        return errSec < 0 ? "vearly" : "vlate";
    }

    public static string gradeRelease(double errSec, double? attr, Badges? badges)
    {
        double w = timingWindowMs(attr, badges) / 1000;
        double a = Math.Abs(errSec);
        if (a <= w) return "excellent";
        if (a <= w * 2.6) return errSec < 0 ? "early" : "late";
        return errSec < 0 ? "vearly" : "vlate";
    }

    /// <summary>Base percentage for an open shot of `type` at distance d by a player with attributes a</summary>
    public static double baseChance(string type, double? d, Attrs a, bool three)
    {
        switch (type)
        {
            case "dunk": return 0.82 + 0.15 * n(Math.Max(Nz(a["driving_dunk"], 50), Nz(a["standing_dunk"], 50)));
            case "layup": return 0.40 + 0.46 * n(a["layup"]) - Math.Max(0, Undef(d) - 2.2) * 0.05;
            case "close": return 0.36 + 0.42 * n(a["close_shot"]) - Math.Max(0, Undef(d) - 1.5) * 0.05;
            case "ft": return 0.42 + 0.5 * n(a["free_throw"]);
            default:
                if (three) return Math.Max(0.03, 0.21 + 0.33 * n(a["three_point"]) - Math.Max(0, Undef(d) - 7.6) * 0.075);
                return Math.Max(0.05, 0.29 + 0.33 * n(a["mid_range"]) - Math.Max(0, Undef(d) - 3.2) * 0.012);
        }
    }
    public static double? attrFor(string type, bool three, Attrs a)
    {
        if (type == "ft") return a["free_throw"];
        if (type == "layup") return a["layup"];
        if (type == "close") return a["close_shot"];
        if (type == "dunk") return Math.Max(Nz(a["driving_dunk"], 50), Nz(a["standing_dunk"], 50));
        return three ? a["three_point"] : a["mid_range"];
    }

    /// <summary>v0.4.2: how well a player finishes dunks through bodies (0..1)</summary>
    public static double trafficSkill(SimPlayer p, bool standing = false)
    {
        var a = p.ratings;
        return 0.65 * n(standing ? Nz(a["standing_dunk"], 50) : Nz(a["driving_dunk"], 50)) + 0.35 * n(Nz(a["close_shot"], 50));
    }

    public static double finalChance(ChanceOpts o)
    {
        if (o.smothered) return 0;
        double p = baseChance(o.type, o.d, o.a, o.three);
        double? attr = attrFor(o.type, o.three, o.a);
        var b = o.badges ?? new Badges();
        if (o.type == "jumper" || o.type == "ft")
        {
            if (o.grade == "excellent") p = p + (1 - p) * (0.24 + 0.36 * n(attr) + 0.01 * bk(b, "deadeye"));
            else if (o.grade == "early" || o.grade == "late") p *= Nz(attr, 0) >= 99 ? 0.97 : Nz(attr, 0) > 95 ? 0.9 : 0.85;
            else if (o.grade == "vearly" || o.grade == "vlate") p *= 0.38;
        }
        bool deep = o.type == "jumper" && Or(o.d, 0) > DEEP_D;
        OffTiming? off = (o.type == "jumper" || o.type == "ft" || o.type == "layup") && o.grade != null && OFF_TIMING.TryGetValue(o.grade, out var ot) ? ot : null;
        if (Nz(attr, 0) >= 99 && off == null && !deep) p = Math.Max(p, o.type == "jumper" ? (o.three ? 0.9 : 0.93) : 0.96);
        // contest
        double deadeye = Math.Min(0.85, DEADEYE_CON[b.Tier("deadeye")]);
        double finisher = Math.Min(0.75, FINISHER_CON[b.Tier("contact_finisher")]);
        double c = Math.Min(1.2, Or(o.contest, 0));
        if (o.type == "jumper") c *= 1 - deadeye;
        if (o.type == "layup" || o.type == "close") c *= 1 - finisher;
        double cw = o.type == "jumper" ? contestBite(b, o.three ? "three_point" : "mid_range", 0.44, 0.53) : o.type == "dunk" ? 0.58 - 0.5 * Nz(o.traffic, 0.5) : contestBite(b, o.type == "close" ? "close_shot" : "layup", 0.36, 0.43);
        if (o.type != "ft") p *= 1 - cw * Math.Min(1, c);
        if (o.type == "jumper")
        {
            p *= 1 - 0.12 * Math.Min(1, Or(o.moving, 0) / 5);
            if (o.fade) p *= 0.88;
            if (o.three && b.Has("limitless") && o.d > 7.6) p *= 1 + 0.08 * bk(b, "limitless");
            if (o.catchShoot && b.Has("catch_shoot")) p *= 1 + 0.04 * bk(b, "catch_shoot");
            if (o.corner && b.Has("corner_specialist")) p *= 1 + 0.05 * bk(b, "corner_specialist");
        }
        if (o.type == "layup" && b.Has("acrobat") && o.contest > 0.5) p *= 1 + 0.05 * bk(b, "acrobat");
        if (o.type == "layup")
        {
            if (o.grade == "excellent") p = p + (1 - p) * (0.45 + 0.2 * n(attr)) * (o.guard != null ? LAYUP_GREEN_BOOST[layupState(o.guard)] : 1);
            else if (o.grade == "early" || o.grade == "late") p *= 0.92;
            else if (o.grade == "vearly" || o.grade == "vlate") p *= 0.62;
        }
        p *= 0.72 + 0.28 * Math.Max(0, Math.Min(1, Nz(o.stamina, 1)));
        if (o.hot) p *= 1 + HOT_BOOST;
        if (o.clutch && b.Has("clutch")) p *= 1 + 0.05 * bk(b, "clutch");
        if (deep)
        {
            double k = deepK(o.d), luck = deepLuck(attr);
            p = p * (1 - k) * (1 - k) + luck * k;
            p = Math.Max(0.0005, Math.Min(o.d >= HALF_D ? luck : 0.97, p));
            return off != null ? Math.Max(0.0005, Math.Min(off.cap, p * off.k)) : p;
        }
        if (off != null) return Math.Max(0.0005, Math.Min(off.cap, p * off.k));
        return Math.Max(0.01, Math.Min(0.97, p));
    }

    /// <summary>v0.4.3: 1 at the rim and in the restricted area / low lane, fading to 0 by about 4.4 m</summary>
    public static double paintWeight(double distToRim) => Math.Max(0, Math.Min(1, (4.4 - distToRim) / 1.9));

    /// <summary>v0.4.3: how much a defender's contest is worth</summary>
    public static double defSkill(SimPlayer d, double pw)
    {
        var r = d.ratings; var b = d.badges;
        double perim = 0.74 + 0.5 * n(r["perimeter_d"]);
        double inside = 0.58 + 0.4 * n(r["interior_d"]) + 0.14 * n(r["block"]) + bk(b, "rim_protector") * 0.02;
        return perim + (inside - perim) * pw;
    }

    public static readonly Dictionary<string, double> DUNK_TIER = new()
    {
        ["dunk_basic"] = 0, ["dunk_rimrocker"] = 1, ["dunk_tomahawk"] = 1, ["dunk_windmill"] = 2, ["dunk_contact"] = 2, ["dunk_flight"] = 3, ["dunk_highflyer"] = 3, ["wheel_dunk_showtime"] = 3,
        ["dunk_hammer"] = 1, ["dunk_liberty"] = 1, ["dunk_scoop"] = 2, ["dunk_switch"] = 2, ["dunk_180"] = 3, ["dunk_eastbay"] = 4,
        ["dunk_cannonball"] = 1, ["dunk_kneeup"] = 1, ["dunk_pump"] = 1, ["dunk_hurdle"] = 2, ["dunk_crossleg"] = 2, ["dunk_jackknife"] = 2, ["dunk_sidemill"] = 2, ["dunk_twomill"] = 2,
        ["dunk_splits"] = 3, ["dunk_backscratch"] = 3, ["dunk_behindhead"] = 3, ["dunk_helicopter"] = 3, ["dunk_rev360"] = 4, ["dunk_spinmill"] = 4,
        [HashSling.HS_PKG] = 5,
    };
    public static readonly Dictionary<string, double> STYLE_FLAIR = new()
    {
        ["power"] = 0, ["onehand"] = 0.3, ["tomahawk"] = 1, ["reverse"] = 1.5, ["double"] = 2, ["windmill"] = 2, ["cradle"] = 2.5, ["360"] = 3,
        ["hammer"] = 1.2, ["liberty"] = 1.3, ["scoop"] = 2.2, ["switch"] = 2.6, ["180"] = 3, ["eastbay"] = 4,
        ["rimrock"] = 1.1, ["bully"] = 0.8, ["aroundback"] = 3.1, ["superman"] = 3.3,
        ["twomill"] = 2.4, ["sidemill"] = 2.3, ["backscratch"] = 2.8, ["rev360"] = 3.4, ["spinmill"] = 3.6, ["pump"] = 1.6, ["kneeup"] = 1.4, ["crossleg"] = 2.0, ["helicopter"] = 3.2,
        ["behindhead"] = 3.0, ["cannonball"] = 1.2, ["splits"] = 2.6, ["hurdle"] = 1.8, ["jackknife"] = 2.2,
        ["hs_lostcause"] = 4.6, ["hs_stinger"] = 4.5, ["hs_doubledip"] = 4.7, ["hs_backdoormill"] = 4.4, ["hs_cradlespin"] = 4.5, ["hs_sling"] = 4.8,
    };
    public static double dunkTier(SimPlayer? p) => p?.dunkPkg != null && DUNK_TIER.TryGetValue(p.dunkPkg, out var t) ? t : 0;

    public static readonly Dictionary<string, Sizeup> SIZEUP = new()
    {
        ["basic"] = new(1, 1, 1, Array.Empty<string>(), 0),
        ["rhythm"] = new(1.02, 1, 0.86, new[] { "cross" }, 0.25),
        ["pound"] = new(0.72, 0.9, 1.42, Array.Empty<string>(), 0),
        ["quick"] = new(0.9, 0.9, 1.16, new[] { "cross" }, 0.45),
        ["snake"] = new(0.6, 1.25, 1.1, new[] { "half", "half", "cross" }, 0.65),
        ["crab"] = new(0.86, 1.5, 0.94, new[] { "cross" }, 0.35),
        ["stutter"] = new(0.9, 1, 1.3, new[] { "hesi", "hesi", "cross" }, 0.55),
        ["elite"] = new(0.82, 0.95, 1.2, new[] { "cross", "btl" }, 0.7),
        ["ankle"] = new(0.74, 1.05, 1.33, new[] { "btl", "cross", "btb" }, 0.78),
        ["showtime"] = new(0.96, 1.12, 1.12, new[] { "btb", "btl", "btb" }, 0.7),
        ["yoyo"] = new(1.18, 0.95, 0.8, new[] { "hesi" }, 0.35),
        ["rocker"] = new(0.95, 1.05, 1.0, new[] { "half", "hesi" }, 0.5),
        ["cradle"] = new(0.66, 1.35, 1.25, new[] { "cross", "half" }, 0.6),
        ["glide"] = new(0.88, 1.18, 0.92, new[] { "btl" }, 0.4),
        ["jab"] = new(0.92, 1.0, 1.05, new[] { "hesi", "cross" }, 0.45),
        ["springs"] = new(1.0, 0.9, 1.36, new[] { "cross", "btl", "cross" }, 0.5),
        ["lowrider"] = new(0.55, 1.1, 1.5, new[] { "btl", "btb" }, 0.75),
        ["swagger"] = new(1.08, 1.2, 0.78, new[] { "btb" }, 0.3),
        ["blur"] = new(0.78, 0.85, 1.55, new[] { "cross", "cross", "btl", "btb" }, 0.85),
        ["pendulum"] = new(0.8, 1.4, 1.18, new[] { "btl", "btl", "half" }, 0.7),
    };
    public static Sizeup? sizeupOf(SimPlayer p) => (p.speed < 1.2 ? (p.sizeupStyle != null && SIZEUP.TryGetValue(p.sizeupStyle, out var s) ? s : SIZEUP["basic"]) : null);

    /// <summary>one dribble's worth of time; true when the ball hits the floor.</summary>
    public static bool advanceDribble(SimPlayer p, double dt, Func<double> rnd, bool pressured)
    {
        var su = sizeupOf(p);
        double freq = (1.55 + Math.Min(1.1, p.speed * 0.2) + (p.action?.type == "move" ? 0.6 : 0)) * (p.dribble.xover != null ? (1 + 0.12 * p.sizeupLvl) * 0.8 : 1) * Or(p.dribbleStyle?.freqK, 1) * (su != null ? su.freq : 1);
        double prev = p.dribble.phase;
        p.dribble.phase = (p.dribble.phase + freq * dt) % 1;
        if (p.dribble.phase < prev)
        {
            var xo = p.dribble.xover;
            if (xo != null) { if (xo != "half" && xo != "hesi") p.dribble.hand = p.dribble.hand == "R" ? "L" : "R"; p.dribble.xover = null; }
            if (su != null && su.chance > 0 && p.action == null && pressured && rnd() < su.chance) p.dribble.xover = su.combos[Math.Min(su.combos.Length - 1, (int)Math.Floor(rnd() * su.combos.Length))];
        }
        return prev < 0.5 && p.dribble.phase >= 0.5;
    }

    /// <summary>extra body yaw during a 360 dunk</summary>
    public static double dunkSpin(PlayerAction? a)
    {
        if (a == null || a.type != "dunk" || !(a.slam > 0)) return 0;
        if (HashSling.isHS(a.style)) return HashSling.hsSpin(a.style, HashSling.hsK(a), Or(a.spinDir, 1));
        double turn = a.style == "360" || a.style == "rev360" || a.style == "spinmill" || a.style == "helicopter" ? JsMath.PI * 2 : a.style == "180" ? JsMath.PI : 0;
        if (turn == 0) return 0;
        double t0 = a.takeoff + 0.03, t1 = a.slam - (a.style == "180" ? 0.12 : 0.06);
        double k = Math.Max(0, Math.Min(1, (a.t - t0) / Math.Max(0.1, t1 - t0)));
        return Or(a.spinDir, 1) * turn * k * k * k * (k * (k * 6 - 15) + 10);
    }

    /// <summary>Contest from defenders: returns 0 (open) .. 1.25 (smothered)</summary>
    public static double contestFor(SimPlayer shooter, IEnumerable<SimPlayer> defenders, Vec3 rim, double releaseH)
    {
        return Math.Min(1.25, contestRaw(shooter, defenders, rim, releaseH));
    }
    public static double contestRaw(SimPlayer shooter, IEnumerable<SimPlayer> defenders, Vec3 rim, double releaseH)
    {
        var cs = new List<double>();
        double fx = rim.x - shooter.x, fz = rim.z - shooter.z, fl0 = JsMath.Hypot(fx, fz), fl = fl0 != 0 && !double.IsNaN(fl0) ? fl0 : 1;
        double pw = paintWeight(fl);
        foreach (var d in defenders)
        {
            double dx = d.x - shooter.x, dz = d.z - shooter.z, dist = JsMath.Hypot(dx, dz);
            double range = (2.6 + pw * 0.35 * n(d.ratings["interior_d"])) * DEF_K;
            if (dist > range) continue;
            double front = (dx * fx + dz * fz) / (fl * (dist != 0 ? dist : 1));
            double ang = front > 0.35 ? 1 : front > -0.1 ? 0.55 : 0.18 + pw * 0.22 * n(d.ratings["block"]);
            double prox = Math.Max(0, Math.Min(1, ((2.0 + pw * 0.3 * n(d.ratings["interior_d"])) * DEF_K - dist) / 1.45));
            bool up = d.handsUp || d.contestHand || d.action?.type == "contest" || d.action?.type == "block";
            double reach = d.phys.reach + d.y + (up ? 0.12 * DEF_K : -0.35);
            double hk = Math.Max(0.35, Math.Min(1.25 + 0.08 * pw, 0.75 + (reach - releaseH) * (0.9 + 0.1 * pw)));
            double timing = d.airborne && d.action != null && d.action.type == "block" ? (1.1 + 0.15 * n(d.ratings["block"])) * DEF_K : 1;
            double wk = 1 + pw * 0.1 * Math.Max(-1, Math.Min(1, (Or(d.phys.W, 95) - Or(shooter.phys?.W, 95)) / 30));
            cs.Add(prox * ang * hk * timing * wk * defSkill(d, pw) * (up ? DEF_K : 1));
        }
        cs.Sort((a, b) => b.CompareTo(a));
        return (cs.Count > 0 ? cs[0] : 0) + (cs.Count > 1 ? cs[1] : 0) * 0.3;
    }

    /// <summary>Solve launch velocity from P to aim point T with launch angle (deg), accounting for drag by iteration.</summary>
    public static Launch solveLaunch(Vec3 P, Vec3 T, double angleDeg)
    {
        double dx = T.x - P.x, dz = T.z - P.z, d = JsMath.Hypot(dx, dz), h = T.y - P.y;
        double th = angleDeg * JsMath.PI / 180;
        double dOr1 = d != 0 && !double.IsNaN(d) ? d : 1;
        double ux = dx / dOr1, uz = dz / dOr1;
        double denom = 2 * JsMath.Pow(JsMath.Cos(th), 2) * (d * JsMath.Tan(th) - h);
        if (denom <= 0.01) denom = 0.01;
        double v = Math.Sqrt(Constants.GRAVITY * d * d / denom);
        for (int it = 0; it < 4; it++)
        {
            double x = 0, y = P.y, vx = v * JsMath.Cos(th), vy = v * JsMath.Sin(th);
            double kd = 0.0185, dt = 1.0 / 240;
            double? reached = null;
            for (int s = 0; s < 1200; s++)
            {
                double sp = JsMath.Hypot(vx, vy);
                vx += -kd * sp * vx * dt; vy += (-Constants.GRAVITY - kd * sp * vy) * dt;
                double px = x, py = y;
                x += vx * dt; y += vy * dt;
                if (vy < 0 && py >= T.y && y < T.y) { double k = (py - T.y) / (py - y); reached = px + (x - px) * k; break; }
            }
            if (reached == null) { v *= 1.05; continue; }
            v *= Math.Sqrt(d / Math.Max(0.05, reached.Value));
        }
        return new Launch { vx = ux * v * JsMath.Cos(th), vy = v * JsMath.Sin(th), vz = uz * v * JsMath.Cos(th), v = v };
    }

    /// <summary>Build a shot trajectory consistent with the predetermined outcome.</summary>
    public static ShotPlan planShot(Rng rng, Vec3 P, Vec3 rim, int side, bool make, double arc, PlanOpts? opts = null)
    {
        opts ??= new PlanOpts();
        var b = new Ball(); b.halfOnly = opts.halfOnly; b.surface = Or(opts.surface, "wood");
        (PredictResult r, ShotPlan vel) tryAim(double ox, double oz, double oy, double arcUse)
        {
            var T = new Vec3(rim.x + ox, rim.y + oy, rim.z + oz);
            var L = solveLaunch(P, T, arcUse);
            b.x = P.x; b.y = P.y; b.z = P.z; b.vx = L.vx; b.vy = L.vy; b.vz = L.vz;
            // backspin about axis perpendicular to travel in horizontal plane
            double hx = L.vx, hz = L.vz, hl0 = JsMath.Hypot(hx, hz), hl = hl0 != 0 && !double.IsNaN(hl0) ? hl0 : 1;
            // (b.wx = -hz / hl * 0; b.wz = 0; b.wy = 0; — overwritten on the next line)
            b.wx = (hz / hl) * -14; b.wz = (hx / hl) * 14; b.wy = 0; // backspin
            b.mode = "flight"; b.touchedRim = false; b.touchedBoard = false; b.floorBounces = 0;
            var r = Ball.predictShot(b, 4);
            return (r, new ShotPlan { vx = b.vx, vy = b.vy, vz = b.vz, wx = b.wx, wy = b.wy, wz = b.wz });
        }
        double fx = rim.x - P.x, fz = rim.z - P.z, fl0 = JsMath.Hypot(fx, fz), fl = fl0 != 0 && !double.IsNaN(fl0) ? fl0 : 1;
        double ux = fx / fl, uz = fz / fl, px = -uz, pz = ux;
        bool bankOK = opts.bank && Math.Abs(P.x) > 1 && fl < 4.5;
        if (make)
        {
            var tries = new List<double[]>();
            if (bankOK && rng.Next() < 0.6)
            {
                double mirrorZ = 2 * side * COURT.boardZ - rim.z;
                for (int k = 0; k < 8; k++)
                {
                    double oy = 0.18 + rng.Next() * 0.3;
                    double t0 = rim.x * 0.6 + (rng.Next() - 0.5) * 0.12;
                    double t1 = mirrorZ - rim.z + (rng.Next() - 0.5) * 0.06;
                    tries.Add(new[] { t0, t1, oy });
                }
            }
            for (int k = 0; k < 10; k++)
            {
                double mag = (opts.swish ? 0.035 : 0.075) * (1 - k / 12.0) * Math.Sqrt(rng.Next());
                double a = rng.Next() * JsMath.PI * 2;
                tries.Add(new[] { JsMath.Cos(a) * mag + ux * 0.02, JsMath.Sin(a) * mag + uz * 0.02, 0 });
            }
            tries.Add(new[] { ux * 0.02, uz * 0.02, 0 });
            double[] arcs = fl < 1.6 ? new[] { arc, arc + 8, arc + 14, arc - 6 } : new[] { arc, arc + 5, arc - 4 };
            foreach (var arcUse in arcs)
            {
                foreach (var tr in tries)
                {
                    var (r, vel) = tryAim(tr[0], tr[1], tr[2], arcUse);
                    if (r.made) { vel.made = true; vel.bank = tr[2] > 0; vel.rim = r.rim; return vel; }
                }
            }
            {
                var (r, vel) = tryAim(0, 0, 0, arc);
                if (!r.made && opts.guarantee) { vel.made = true; vel.ghost = true; vel.rim = false; return vel; }
                vel.made = r.made; vel.rim = r.rim; return vel;
            }
        }
        // miss: choose a style
        for (int k = 0; k < 14; k++)
        {
            double style = rng.Next();
            double ox, oz;
            double m = 0.12 + rng.Next() * 0.16 + k * 0.012 + (opts.bad ? 0.2 * rng.Next() : 0);
            if (style < 0.35) { ox = ux * -m; oz = uz * -m; }
            else if (style < 0.7) { ox = ux * m; oz = uz * m; }
            else { double s = rng.Next() < 0.5 ? -1 : 1; ox = px * s * m * 0.9 + ux * 0.03; oz = pz * s * m * 0.9 + uz * 0.03; }
            var (r, vel) = tryAim(ox, oz, 0, arc);
            if (!r.made) { vel.made = false; vel.rim = r.rim; return vel; }
        }
        {
            var (r, vel) = tryAim(ux * -0.45, uz * -0.45, 0, arc);
            vel.made = r.made; return vel;
        }
    }

    /// <summary>v0.4.1 shot selection. ctx: sprint, forceJumper, attack (dedicated dunk bind), defs (defenders)</summary>
    public static ShotType shotTypeFor(SimPlayer player, Vec3 rim, bool sprint = false, bool forceJumper = false, bool attack = false, IEnumerable<SimPlayer>? defs = null)
    {
        double d = JsMath.Hypot(rim.x - player.x, rim.z - player.z);
        double speed = JsMath.Hypot(player.vx, player.vz);
        double toward = speed > 0.1 ? ((rim.x - player.x) * player.vx + (rim.z - player.z) * player.vz) / (d * speed) : 0;
        var a = player.ratings;
        if (forceJumper) return new ShotType { type = "jumper", d = d };
        double lift = player.phys.reach + player.phys.vertical;
        var raw = player.raw ?? a;
        bool canDunk = Nz(raw["driving_dunk"], 0) >= 55 && player.stamina > 0.12 && lift > 3.2;
        bool canStand = Nz(raw["standing_dunk"], 0) >= 65 && lift > 3.25;
        var cover = coverage(player, rim, d, defs ?? Array.Empty<SimPlayer>());
        if (attack)
        {
            bool dunkOver(double? dunkAttr) => betterFinish(player, dunkAttr, raw["layup"]) == "dunk";
            if (d < 1.6 && canStand && dunkOver(raw["standing_dunk"])) return new ShotType { type = "dunk", d = d, standing = true, cover = cover };
            if (d < 4.2 && canDunk && (speed > 1.2 || d < 2.4) && dunkOver(raw["driving_dunk"])) return new ShotType { type = "dunk", d = d, cover = cover };
            if (d < 5.8 && canDunk && speed > 3 && toward > 0.7 && cover.open && dunkOver(raw["driving_dunk"])) return new ShotType { type = "dunk", d = d, cover = cover, @long = true };
            if (d < 4.4) return new ShotType { type = d < 1.6 && speed < 1 ? "close" : "layup", d = d, cover = cover };
            return new ShotType { type = "none", d = d };
        }
        if (d < 1.4 && canStand && sprint) return new ShotType { type = "dunk", d = d, standing = true, cover = cover };
        if (d < 4.4 && speed > 2.2 && toward > 0.55)
        {
            var pick = pickFinish(player, d, cover, canDunk);
            if (pick == "jumper") return new ShotType { type = "jumper", d = d, pullup = true, cover = cover };
            return new ShotType { type = pick, d = d, cover = cover };
        }
        if (d < 1.8) return new ShotType { type = "close", d = d };
        bool fade = speed > 1.2 && toward < -0.5;
        return new ShotType { type = "jumper", d = d, fade = fade };
    }

    /// <summary>What the defense is doing about a drive from `p` to the rim</summary>
    public static Coverage coverage(SimPlayer p, Vec3 rim, double d, IEnumerable<SimPlayer> defs)
    {
        double dOr1 = d != 0 && !double.IsNaN(d) ? d : 1;
        double ux = (rim.x - p.x) / dOr1, uz = (rim.z - p.z) / dOr1;
        SimPlayer? rimProtector = null, wall = null;
        foreach (var q in defs)
        {
            if (q.action?.type == "stumble") continue;
            double rx = q.x - p.x, rz = q.z - p.z;
            double along = rx * ux + rz * uz, lat = Math.Abs(rx * uz - rz * ux);
            if (along < -0.2 || along > d + 0.6 || lat > 1.15) continue;
            double toRim = JsMath.Hypot(q.x - rim.x, q.z - rim.z);
            double blk = Nz(q.ratings["block"], 50);
            if (toRim < 2.0 && (rimProtector == null || blk > Nz(rimProtector.ratings["block"], 50))) rimProtector = q;
            if (along > 0.3 && along < 1.3 && lat < 0.6 && toRim > 1.2) wall = q;
        }
        return new Coverage { rimProtector = rimProtector, wall = wall, open = rimProtector == null && wall == null };
    }

    public static readonly Dictionary<string, string> FINISH_STYLE = new()
    {
        ["slasher"] = "dunk", ["glass_cleaner"] = "dunk", ["post_scorer"] = "dunk",
        ["playmaker"] = "layup", ["sharpshooter"] = "layup", ["stretch_big"] = "layup", ["lockdown"] = "layup", ["two_way"] = "layup",
    };
    public static string archetypeOf(SimPlayer p)
    {
        var b = p.entry?.build;
        if (!string.IsNullOrEmpty(b?.archetype)) return b!.archetype!;
        if (b?.style == "outside") return "sharpshooter";
        if (b?.style == "inside") return "slasher";
        return "two_way";
    }
    /// <summary>The higher rating wins; an exact tie goes to the archetype's style</summary>
    public static string betterFinish(SimPlayer p, double? dunk, double? layup)
    {
        if (Nz(dunk, 0) != Nz(layup, 0)) return Nz(dunk, 0) > Nz(layup, 0) ? "dunk" : "layup";
        return FINISH_STYLE.TryGetValue(archetypeOf(p), out var s) ? s : "layup";
    }

    /// <summary>'dunk' | 'layup' | 'jumper' for a driving shot press</summary>
    public static string pickFinish(SimPlayer p, double d, Coverage cover, bool canDunk)
    {
        var a = p.raw ?? p.ratings;
        double dunk = canDunk && d < 3.8 ? Nz(a["driving_dunk"], 0) : -1e9;
        double layup = Nz(a["layup"], 0);
        double pull = d > 3.0 ? Nz(a["mid_range"], 0) - 10 : -1e9;
        var rp = cover.rimProtector;
        if (rp != null)
        {
            double prot = (Nz(rp.ratings["block"], 50) - 60) * 0.3 + (rp.phys.reach - p.phys.reach) * 10;
            dunk -= Math.Min(10, Math.Max(0, prot)) * (p.badges?.Has("posterizer") == true ? 0.4 : 1) * (1.3 - trafficSkill(p));
            layup += 3 + (p.badges?.Has("acrobat") == true ? 2 : 0);
        }
        if (cover.wall != null) { pull += 6; dunk -= 4; }
        if (cover.open) pull -= 4;
        var rim = dunk > -1e8 ? betterFinish(p, dunk, layup) : "layup";
        return pull > Math.Max(dunk, layup) ? "jumper" : rim;
    }
}
