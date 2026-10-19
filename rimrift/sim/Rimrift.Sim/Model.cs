// The loosely-typed JS objects the sim modules pass around (ratings dicts, badge tiers, catalog items, builds, the
// player-like records shots.js reads), typed just enough for the ports. `double?` = a JS Number that may be undefined.
namespace Rimrift.Sim;

/// <summary>Attribute → rating dictionary (`a.layup`, `a.three_point`, ...). Missing key reads as null (undefined).</summary>
public sealed class Attrs
{
    readonly Dictionary<string, double> d = new();
    public Attrs() { }
    public Attrs(IEnumerable<KeyValuePair<string, double>> items) { foreach (var kv in items) d[kv.Key] = kv.Value; }
    public double? this[string key]
    {
        get => d.TryGetValue(key, out var v) ? v : null;
        set { if (value is double v) d[key] = v; else d.Remove(key); }
    }
    public IEnumerable<string> Keys => d.Keys;
    public int Count => d.Count;
    public bool Has(string key) => d.ContainsKey(key);
    public Attrs Clone() => new(d);
    public static Attrs Of(params (string key, double value)[] items) { var a = new Attrs(); foreach (var (k, v) in items) a[k] = v; return a; }
}

/// <summary>Badge id → tier (0..4). Missing = 0.</summary>
public sealed class Badges : Dictionary<string, int>
{
    public Badges() { }
    public int Tier(string key) => TryGetValue(key, out var t) ? t : 0;
    public bool Has(string key) => Tier(key) != 0; // JS truthiness of badges[key]
    public static Badges Of(params (string key, int tier)[] items) { var b = new Badges(); foreach (var (k, t) in items) b[k] = t; return b; }
}

/// <summary>A server/catalog.json item (only the fields shots.js reads).</summary>
public sealed class CatalogItem
{
    public string id = "";
    public string? icon;            // exclusive to this Icon badge
    public string? style;           // jumpshot base style key (BASE_FEEL)
    public double? set_height, push, jump, apex; // base
    public double? release_seconds, arc;         // release
}

public sealed class Build
{
    public double? height, weight, wingspan; // in, lb, in
    public Attrs? attributes;
    public Dictionary<string, string>? equipment; // slot → item id
    public string? hand, icon_badge, archetype, style;
}

/// <summary>ratings.physical() output.</summary>
public sealed class Phys
{
    public double H, W, WS, radius, sprint, jog, walk, ballSpeedK, accel, brake, turn, vertical, reach, strength, staminaRate, recover;
}

/// <summary>A player action as shots.js reads it (type, and the dunk fields for dunkSpin / hsK).</summary>
public sealed class PlayerAction
{
    public string type = "";
    public string? style;
    public double slam, takeoff, t;
    public double spinDir; // 0 = unset (`|| 1`)
}

public sealed class Dribble
{
    public double phase;
    public string hand = "R";
    public string? xover;
}

public sealed class DribbleStyle { public double freqK; }

public sealed class Entry { public Build? build; }

/// <summary>The player record the shot model reads (shooter, defender, driver). Only what shots.js touches.</summary>
public sealed class SimPlayer
{
    public double x, y, z, vx, vz;
    public Attrs ratings = new();
    public Attrs? raw;
    public Badges? badges;
    public Phys phys = new();
    public PlayerAction? action;
    public bool handsUp, contestHand, airborne;
    public double stamina = 1;
    public double speed;        // (advanceDribble / sizeupOf)
    public string? sizeupStyle;
    public double sizeupLvl;
    public Dribble dribble = new();
    public DribbleStyle? dribbleStyle;
    public Entry? entry;
    public string? dunkPkg;
}

public sealed class ShotPkg
{
    public double tRel, arc, setH, push, jumpK, apexK, relK, winK;
    public string style = "standard", release = "classic", hand = "R";
    public ShotPkg Clone() => (ShotPkg)MemberwiseClone();
}

public sealed class Feel { public double speed, win; public Feel(double speed, double win) { this.speed = speed; this.win = win; } }
public sealed class LayupFeel { public double rel, win, gather; public LayupFeel(double rel, double win, double gather) { this.rel = rel; this.win = win; this.gather = gather; } }
public sealed class Sizeup
{
    public double hgt, side, freq, chance; public string[] combos;
    public Sizeup(double hgt, double side, double freq, string[] combos, double chance) { this.hgt = hgt; this.side = side; this.freq = freq; this.combos = combos; this.chance = chance; }
}

/// <summary>ctx for greenWindowMs / layupWindowMs / jumperTimingK.</summary>
public sealed class ShotCtx
{
    public double? greenK, contest, moving, d, winKOverride;
    public bool ft, smothered, nonShooter, three, fade, catchShoot, corner, natural, stepback;
    public string? hustle, lstyle;
    public ShotPkg? pkg;
}

/// <summary>o for finalChance.</summary>
public sealed class ChanceOpts
{
    public string type = "jumper";
    public double? d, contest, moving, stamina, traffic, guard;
    public Attrs a = new();
    public bool three, fade, hot, smothered, catchShoot, corner, clutch;
    public string? grade;
    public Badges? badges;
}

public sealed class ShotPlan
{
    public double vx, vy, vz, wx, wy, wz;
    public bool made;
    public bool? bank, rim;
    public bool ghost;
}

public sealed class PlanOpts
{
    public bool halfOnly, swish, guarantee, bad, bank;
    public string? surface;
}

public sealed class Coverage { public SimPlayer? rimProtector, wall; public bool open; }
public sealed class ShotType
{
    public string type = ""; public double d; public bool standing, pullup, fade, @long; public Coverage? cover;
}
public sealed class LayupCover { public string kind = "open"; public int side; }
public sealed class HopInfo { public double jumpH, tUp, takeoff, showK; }
public sealed class Launch { public double vx, vy, vz, v; }
