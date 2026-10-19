// Minimal port of client/js/sim/hashsling.js: only what shots.js imports (HS_PKG, isHS, hsSpin, hsK). The ball key
// paths / hand tables / hsPath belong to the animator port, not the shot model.
namespace Rimrift.Sim;

public static class HashSling
{
    public const string HS_PKG = "dunk_hash_slinging";
    public const double HS_TIMING_pre = 0.15, HS_TIMING_hang = 0.6, HS_TIMING_hangOnRim = 0.6, HS_TIMING_hangOnRimR = 0.35;

    // style -> body turn [k0, k1, turns] (null: no spin)
    static readonly Dictionary<string, double[]?> SPIN = new()
    {
        ["hs_lostcause"] = null,
        ["hs_stinger"] = new[] { 0.12, 0.62, 0.5 },
        ["hs_doubledip"] = null,
        ["hs_backdoormill"] = null,
        ["hs_cradlespin"] = new[] { 0.1, 0.86, 1 },
        ["hs_sling"] = new[] { 0.08, 0.82, 1 },
    };
    public static readonly string[] HS_IDS = SPIN.Keys.ToArray();
    public static bool isHS(string? st) => st != null && SPIN.ContainsKey(st);

    static double clamp01(double x) => Math.Max(0, Math.Min(1, x));

    /// <summary>k for a dunk action: 0 at HS_TIMING.pre before the takeoff, 1 at the slam (clamped)</summary>
    public static double hsK(PlayerAction? a)
    {
        if (a == null) return 0;
        double t0 = a.takeoff - HS_TIMING_pre, t1 = a.slam != 0 ? a.slam : 1; // (a.slam || 1)
        return clamp01((a.t - t0) / Math.Max(0.1, t1 - t0));
    }

    /// <summary>body turn in radians at k (positive = spinDir)</summary>
    public static double hsSpin(string? st, double k, double dir = 1)
    {
        if (st == null || !SPIN.TryGetValue(st, out var s) || s == null) return 0;
        double k0 = s[0], k1 = s[1], turns = s[2], u = clamp01((k - k0) / Math.Max(0.05, k1 - k0));
        return dir * turns * JsMath.PI * 2 * u * u * u * (u * (u * 6 - 15) + 10);
    }
}
