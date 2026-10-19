// animator.js module-scope tables: movement styles, jump-shot bases in the air, follow-throughs, dunk legs, celebrations.
using static Rimrift.Anim.AnimMath;
namespace Rimrift.Anim;

public sealed record Gait(double stride = 1, double lift = 1, double crouch = 0, double wide = 0, double bounce = 0, double sway = 0, double lean = 0, double chest = 0, double head = 0, double tilt = 0, double nod = 0, double arms = 1, double armOut = 0);

public sealed record Follow(double k, double y, double z, double f, double hold, bool air = false, double gx = 0);

public static class AnimMath
{
    public const double D = Math.PI / 180, TAU = Math.PI * 2;
    public static double Sm(double a, double b, double x) { double t = Math.Max(0, Math.Min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
    public static double Lerp(double a, double b, double t) => a + (b - a) * t;
    public static double Q01(double x, double a, double b) => Math.Max(0, Math.Min(1, (x - a) / (b - a)));
    // Float32 pose stores (JS: Float32Array element assignment)
    public static void Set3(float[] p, int o, double x, double y, double z) { p[o] = (float)x; p[o + 1] = (float)y; p[o + 2] = (float)z; }
    public static void Add3(float[] p, int o, double x, double y, double z) { p[o] = (float)(p[o] + x); p[o + 1] = (float)(p[o + 1] + y); p[o + 2] = (float)(p[o + 2] + z); }
    public static void Mix3(float[] p, int o, double x, double y, double z, double w) { p[o] = (float)(p[o] + (x - p[o]) * w); p[o + 1] = (float)(p[o + 1] + (y - p[o + 1]) * w); p[o + 2] = (float)(p[o + 2] + (z - p[o + 2]) * w); }
    public static void Set(float[] p, int i, double v) => p[i] = (float)v;
    public static void Add(float[] p, int i, double v) => p[i] = (float)(p[i] + v);
    public static void Sub(float[] p, int i, double v) => p[i] = (float)(p[i] - v);
    public static int Off(int sh) => sh == 0 ? 1 : 0;
    public static double Sgn(int side) => side == 0 ? 1 : -1;
    public static int SideOf(string? s) => s == "L" ? 0 : 1;
}

public static class AnimTables
{
    static readonly Gait G0 = new();
    public static readonly Dictionary<string, Gait> MOVE_GAIT = new()
    {
        ["standard"] = G0,
        ["smooth"] = G0 with { stride = 1.1, lift = 0.8, arms = 0.8, sway = 0.06, head = -0.04 },
        ["bouncy"] = G0 with { lift = 1.45, bounce = 0.07, nod = 0.08, arms = 1.15 },
        ["swagger"] = G0 with { stride = 0.94, sway = 0.24, armOut = 0.1, arms = 1.25, lean = -0.06, tilt = 0.1 },
        ["heavy"] = G0 with { stride = 0.88, crouch = -0.05, wide = 0.07, bounce = 0.035, lean = 0.08, arms = 0.75, armOut = 0.07 },
        ["shifty"] = G0 with { stride = 0.78, lift = 0.75, crouch = -0.06, arms = 0.65, nod = 0.04, wide = 0.03 },
        ["upright"] = G0 with { lean = -0.22, head = -0.22, chest = -0.08, arms = 0.8 },
        ["hunched"] = G0 with { lean = 0.26, head = 0.22, chest = 0.12, arms = 0.75 },
        ["loose"] = G0 with { arms = 1.9, armOut = 0.1, sway = 0.12, nod = 0.04 },
        ["strut"] = G0 with { chest = -0.18, lean = -0.06, lift = 1.65, arms = 0.55, sway = 0.1, head = -0.1 },
        ["glide"] = G0 with { stride = 1.22, lift = 0.7, bounce = -0.02, arms = 0.9, crouch = -0.02 },
        ["sprinter"] = G0 with { lift = 1.75, arms = 1.75, lean = 0.11 },
        ["laidback"] = G0 with { lean = -0.2, stride = 0.95, arms = 0.55, sway = 0.06, tilt = -0.1, head = 0.04 },
    };

    // v0.4.7.5 jump-shot bases in the air (u: seconds since takeoff; sh/sg: shooting hand side (0 L / 1 R) and its sign)
    public delegate void AirFn(float[] T, double u, int sh, double sg, double rise);
    public static readonly Dictionary<string, AirFn> AIR2 = new()
    {
        ["pogo"] = (T, u, sh, sg, _) => { double f = Sm(0.04, 0.18, u); Set3(T, P.footL, 0.06, 0.1 + 0.36 * f, -0.04 - 0.3 * f); Set3(T, P.footR, -0.06, 0.1 + 0.36 * f, -0.04 - 0.3 * f); Set(T, P.pitchL, 0.9); Set(T, P.pitchR, 0.9); Set3(T, P.kneeL, 0.05, -0.5, 1); Set3(T, P.kneeR, -0.05, -0.5, 1); Set(T, P.spine, -0.03); },
        ["stork"] = (T, u, sh, sg, _) => { double k = Sm(0, 0.18, u); int o = Off(sh); Set3(T, P.Foot(o), -sg * (0.12 - 0.12 * k), 0.1 + 0.46 * k, 0.02 - 0.04 * k); Set3(T, P.Knee(o), -sg * 0.5, 0.6 * k, 1); Set3(T, P.Foot(sh), sg * 0.06, 0.08, 0.0); Set(T, P.Pitch(o), 0.4); Set(T, P.Pitch(sh), 0.8); Set(T, P.spine, -0.02); },
        ["frog"] = (T, u, sh, sg, _) => { double k = Sm(0, 0.16, u); Set3(T, P.footL, 0.06, 0.16 + 0.16 * k, 0.04); Set3(T, P.footR, -0.06, 0.16 + 0.16 * k, 0.04); Set3(T, P.kneeL, 1, 0.2, 0.4); Set3(T, P.kneeR, -1, 0.2, 0.4); Set(T, P.pitchL, 0.5); Set(T, P.pitchR, 0.5); Set(T, P.spine, 0.02); },
        ["corkscrew"] = (T, u, sh, sg, _) => { double k = Sm(0, 0.22, u), o = -sg * 0.16 * k; Set3(T, P.footL, -0.04 * k + 0.1 * (1 - k) + o, 0.1 + 0.14 * k, -0.08 * k); Set3(T, P.footR, 0.04 * k - 0.1 * (1 - k) + o, 0.12 + 0.14 * k, -0.1 * k); Set3(T, P.kneeL, 0.2, 0.2, 1); Set3(T, P.kneeR, -0.2, 0.2, 1); Set(T, P.pelvis + 1, sg * 0.5 * k); Set(T, P.chest + 1, -sg * 0.32 * k); Set(T, P.pitchL, 0.7); Set(T, P.pitchR, 0.7); Set(T, P.spine, -0.04); },
        ["heel"] = (T, u, sh, sg, _) => { double k = Sm(0, 0.2, u); int o = Off(sh); Set3(T, P.Foot(o), -sg * 0.11, 0.1 + 0.38 * k, -0.06 - 0.3 * k); Set3(T, P.Knee(o), -sg * 0.12, -0.4 * k, 1); Set3(T, P.Foot(sh), sg * 0.11, 0.09, 0.04); Set(T, P.spine, -0.06); Set(T, P.head, -0.16); },
        ["turbo"] = (T, u, sh, sg, _) => { Set3(T, P.footL, 0.13, 0.16, -0.16); Set3(T, P.footR, -0.13, 0.17, -0.18); Set3(T, P.kneeL, 0.2, 0.5, 1); Set3(T, P.kneeR, -0.2, 0.5, 1); Set(T, P.pitchL, 0.4); Set(T, P.pitchR, 0.4); Set(T, P.spine, 0.12); Set(T, P.chest, 0.05); },
        ["onestep"] = (T, u, sh, sg, _) => { double k = Sm(0, 0.22, u); int o = Off(sh); Set3(T, P.Foot(sh), sg * 0.12, 0.1 + 0.3 * k, 0.1 + 0.34 * k); Set3(T, P.Knee(sh), sg * 0.12, 0.1, 1); Set3(T, P.Foot(o), -sg * 0.12, 0.12, -0.24 * k); Set(T, P.spine, 0.04); Set(T, P.chest, 0.02); },
        ["tilt"] = (T, u, sh, sg, _) => { double k = Sm(0, 0.24, u); Set3(T, P.footL, 0.12 + sg * 0.22 * k, 0.1 + 0.08 * k, 0.02); Set3(T, P.footR, -0.12 + sg * 0.22 * k, 0.12 + 0.04 * k, 0.0); Set(T, P.spine + 2, -sg * 0.26 * k); Set(T, P.chest + 2, -sg * 0.14 * k); Set(T, P.head + 2, sg * 0.2 * k); },
        ["catapult"] = (T, u, sh, sg, _) => { double k = Sm(0, 0.2, u); Set3(T, P.footL, -0.03, 0.12 + 0.12 * k, -0.06 - 0.06 * k); Set3(T, P.footR, 0.03, 0.13 + 0.12 * k, -0.08 - 0.06 * k); Set3(T, P.kneeL, 0.25, -0.1, 1); Set3(T, P.kneeR, -0.25, -0.1, 1); Set(T, P.spine, -0.2 * k); Set(T, P.chest, -0.14 * k); Set(T, P.head, -0.04); },
        ["statue"] = (T, u, sh, sg, _) => { int o = Off(sh); double k = Sm(0, 0.16, u); Set3(T, P.Foot(sh), sg * 0.08, 0.08, 0.02); Set3(T, P.Knee(sh), sg * 0.1, -0.3, 1); Set3(T, P.Foot(o), sg * 0.02, 0.12 + 0.22 * k, -0.1 - 0.06 * k); Set3(T, P.Knee(o), -sg * 0.9, 0.1, 0.4); Set(T, P.pitchL, 0.6); Set(T, P.pitchR, 0.6); Set(T, P.spine, 0.1); Set(T, P.chest, 0.04); Set(T, P.head, -0.2); },
        ["bounce"] = (T, u, sh, sg, _) => { double k = Sm(0, 0.16, u); Set3(T, P.footL, 0.2, 0.12 + 0.2 * k, -0.06 - 0.14 * k); Set3(T, P.footR, -0.2, 0.12 + 0.2 * k, -0.06 - 0.14 * k); Set3(T, P.kneeL, 0.4, 0.3, 1); Set3(T, P.kneeR, -0.4, 0.3, 1); Set(T, P.pitchL, 0.55); Set(T, P.pitchR, 0.55); Set(T, P.spine, 0.06); },
        ["whip"] = (T, u, sh, sg, _) => { double k = Sm(0, 0.2, u); Set3(T, P.footL, 0.07 - sg * 0.2 * k, 0.12 + 0.1 * k, -0.02); Set3(T, P.footR, -0.07 - sg * 0.2 * k, 0.13 + 0.1 * k, -0.04); Set(T, P.pelvis + 1, -sg * 0.2 * k); Set(T, P.chest + 1, sg * 0.22 * k); Set(T, P.pitchL, 0.7); Set(T, P.pitchR, 0.7); },
        ["dip"] = (T, u, sh, sg, _) => { int o = Off(sh); Set3(T, P.Foot(sh), sg * 0.12, 0.2, 0.18); Set3(T, P.Foot(o), -sg * 0.12, 0.24, -0.2); Set3(T, P.kneeL, 0.25, 0.35, 1); Set3(T, P.kneeR, -0.25, 0.35, 1); Set(T, P.spine, 0.08); },
        ["leaner"] = (T, u, sh, sg, _) => { double k = Sm(0, 0.22, u); Set3(T, P.footL, 0.12, 0.16 + 0.12 * k, -0.22 - 0.16 * k); Set3(T, P.footR, -0.12, 0.18 + 0.12 * k, -0.24 - 0.16 * k); Set3(T, P.kneeL, 0.12, -0.3, 1); Set3(T, P.kneeR, -0.12, -0.3, 1); Set(T, P.pitchL, 0.9); Set(T, P.pitchR, 0.9); Set(T, P.spine, 0.2 * k); Set(T, P.chest, 0.08 * k); Set(T, P.head, -0.3); },
        ["sharpeye"] = (T, u, sh, sg, rise) => { double k = Sm(0, 0.1, u), fl = Sm(0.6 * rise, 1.25 * rise, u); Set3(T, P.footL, 0.055, 0.085 + 0.07 * fl, 0.01 - 0.07 * fl); Set3(T, P.footR, -0.055, 0.09 + 0.07 * fl, 0.0 - 0.07 * fl); Set3(T, P.kneeL, 0.06, -0.15 * fl, 1); Set3(T, P.kneeR, -0.06, -0.15 * fl, 1); Set(T, P.pitchL, 0.98); Set(T, P.pitchR, 0.98); Set(T, P.toeL, 0); Set(T, P.toeR, 0); Set(T, P.spine, -0.05 * k); Set(T, P.chest, -0.04 * k); },
        ["bicycle"] = (T, u, sh, sg, _) => { double ph = u * 11; Set3(T, P.footL, 0.12, 0.2 + 0.14 * JsMath.Sin(ph), 0.02 + 0.22 * JsMath.Cos(ph)); Set3(T, P.footR, -0.12, 0.2 - 0.14 * JsMath.Sin(ph), 0.02 - 0.22 * JsMath.Cos(ph)); Set3(T, P.kneeL, 0.15, 0.3, 1); Set3(T, P.kneeR, -0.15, 0.3, 1); Set(T, P.pitchL, 0.6); Set(T, P.pitchR, 0.6); },
    };

    // v0.4.7.5 follow-throughs (t: seconds after the release; k: blend-in; relY; sh/sg; gh; H2/G2 pose offsets; F; an)
    public delegate void ReleaseFn(float[] T, double t, double k, double relY, int sh, double sg, int gh, int H2, int G2, Follow F, Animator an);
    public static readonly Dictionary<string, ReleaseFn> RELEASE2 = new()
    {
        ["flickup"] = (T, t, k, relY, sh, sg, gh, H2, G2, F, an) => { double q = Q01(t, 0.05, 0.16); an.PalmOf(sh, new Palm(new[] { 0, 0.2 - 0.6 * q, 1 }, new[] { 0, 0.2 + 0.8 * q, 0.6 - 0.6 * q }, 0.9)); Set3(T, G2, -sg * 0.3, relY - 0.3, 0.2); },
        ["fist"] = (T, t, k, relY, sh, sg, gh, H2, G2, F, an) => { double q = Q01(t, 0.12, 0.3); Set3(T, H2, sg * (0.05 + 0.12 * q), relY - 0.75 * q, 0.38 - 0.12 * q); Set3(T, P.Elbow(sh), sg * 0.6, -1, -0.1); Set3(T, G2, -sg * 0.3, relY - 0.5, 0.15); },
        ["spread"] = (T, t, k, relY, sh, sg, gh, H2, G2, F, an) => { double q = Q01(t, 0.1, 0.32); Set3(T, H2, sg * (0.05 + 0.7 * q), relY - 0.42 * q, 0.42 - 0.3 * q); Set3(T, G2, -sg * (0.26 + 0.5 * q), relY - 0.14 - 0.3 * q, 0.28 - 0.2 * q); Set3(T, P.Elbow(sh), sg, -0.2, -0.2); Set3(T, P.Elbow(gh), -sg, -0.2, -0.2); },
        ["drop"] = (T, t, k, relY, sh, sg, gh, H2, G2, F, an) => { double q = Q01(t, 0.04, 0.16); Set3(T, H2, sg * (0.05 + 0.22 * q), relY - (relY - 1.0) * q, 0.4 - 0.28 * q); Set3(T, G2, -sg * 0.27, relY - 0.14 - (relY - 1.14) * q, 0.28 - 0.16 * q); Set3(T, P.Elbow(sh), sg * 0.35, -1, -0.25); Set3(T, P.Elbow(gh), -sg * 0.35, -1, -0.25); },
        ["curl"] = (T, t, k, relY, sh, sg, gh, H2, G2, F, an) => { double q = Q01(t, 0.1, 0.3); Set3(T, H2, sg * (0.05 + 0.15 * q), relY - 0.42 * q, 0.4 - 0.32 * q); Set3(T, P.Elbow(sh), sg * 0.8, -0.3, 0.6); Set3(T, G2, -sg * 0.3, relY - 0.45, 0.2); },
        ["reach"] = (T, t, k, relY, sh, sg, gh, H2, G2, F, an) => { Set3(T, P.Elbow(sh), sg * 0.05, -0.2, 1); Set3(T, G2, -sg * 0.28, 1.05, 0.14); Set3(T, P.Elbow(gh), -sg * 0.35, -1, -0.25); Add(T, P.spine, 0.08); },
        ["swipe"] = (T, t, k, relY, sh, sg, gh, H2, G2, F, an) => { double q = Q01(t, 0.08, 0.34); Set3(T, G2, -sg * (0.4 - 0.75 * q), relY - 0.35 - 0.1 * JsMath.Sin(q * Math.PI), 0.42); Set3(T, P.Elbow(gh), -sg * 0.8, -0.6, 0.2); },
        ["tip"] = (T, t, k, relY, sh, sg, gh, H2, G2, F, an) => { double q = Q01(t, 0.14, 0.3), q2 = Q01(t, 0.38, 0.52); Set3(T, H2, sg * (0.05 + 0.04 * q + 0.3 * q2), relY - 0.36 * q + 0.04 * q2, 0.4 - 0.2 * q + 0.18 * q2); Set3(T, P.Elbow(sh), sg * 0.9, 0.1, 0.4); Set3(T, G2, -sg * 0.28, 1.05, 0.14); },
        ["swing"] = (T, t, k, relY, sh, sg, gh, H2, G2, F, an) => { double q = Q01(t, 0.06, 0.4), al = q * Math.PI * 1.1; Set3(T, H2, sg * 0.22, 1.2 + (relY - 1.2) * JsMath.Cos(al), 0.4 * JsMath.Sin(al + 0.3) - 0.1 * q); Set3(T, P.Elbow(sh), sg * 0.5, -0.8, -0.2); Set3(T, G2, -sg * 0.28, 1.05, 0.14); },
        ["lock"] = (T, t, k, relY, sh, sg, gh, H2, G2, F, an) => { double q = Q01(t, 0.06, 0.2); Set3(T, H2, sg * (0.05 + 0.18 * q), relY + 0.1 * q, 0.26); Set3(T, G2, -sg * (0.26 + 0.0 * q), relY - 0.14 + 0.24 * q, 0.22); Set3(T, P.Elbow(gh), -sg * 0.6, 0.2, -0.2); an.PalmOf(gh, new Palm(new[] { 0, 0, 1.0 }, new[] { 0, 1.0, 0 }, 0.8)); },
        ["chop"] = (T, t, k, relY, sh, sg, gh, H2, G2, F, an) => { double q = Q01(t, 0.08, 0.2); Set3(T, H2, sg * 0.04, relY - 0.95 * q, 0.5 + 0.08 * q); Set3(T, P.Elbow(sh), sg * 0.3, -0.5, 0.6); an.PalmOf(sh, new Palm(new[] { sg, 0, 0 }, new[] { 0, 0.6 - 0.6 * q, 0.8 }, 0.9)); Set3(T, G2, -sg * 0.3, relY - 0.4, 0.2); },
        ["thread"] = (T, t, k, relY, sh, sg, gh, H2, G2, F, an) => { double q = Q01(t, 0.08, 0.5); Set3(T, H2, sg * 0.04, relY - 0.5 * q * q, 0.5 + 0.34 * q); Set3(T, P.Elbow(sh), sg * 0.05, -0.4, 1); Set3(T, G2, -sg * 0.3, relY - 0.5, 0.2); },
        ["hook"] = (T, t, k, relY, sh, sg, gh, H2, G2, F, an) => { double q = Q01(t, 0.08, 0.26); Set3(T, H2, sg * (0.05 - 0.02 * q), relY - 0.12 * q, 0.36 - 0.4 * q); Set3(T, P.Elbow(sh), sg * 0.4, 0.4, 0.8); Set3(T, G2, -sg * 0.3, relY - 0.42, 0.18); },
        ["wipe"] = (T, t, k, relY, sh, sg, gh, H2, G2, F, an) => { double q = Q01(t, 0.1, 0.5); Set3(T, G2, sg * (0.05 - 0.02 * q), relY - 0.42 + 0.34 * q, 0.34 + 0.06 * q); Set3(T, P.Elbow(gh), -sg * 0.7, -0.4, 0.4); },
        ["shake"] = (T, t, k, relY, sh, sg, gh, H2, G2, F, an) => { double w = JsMath.Sin(t * 15) * Q01(t, 0.08, 0.2); Add(T, H2, sg * 0.14 * w); Add(T, H2 + 2, 0.06 * w); Set3(T, G2, -sg * (0.3 + 0.1 * w), relY - 0.45, 0.2); },
        ["sharpeye"] = (T, t, k, relY, sh, sg, gh, H2, G2, F, an) =>
        {
            double e = k * k * (3 - 2 * k), d = Q01(t, 0.3, 1.1);
            Set3(T, H2, sg * 0.04, relY + 0.02 + 0.08 * e - 0.04 * d, 0.36 + 0.02 * e + 0.06 * d);
            Set3(T, P.Elbow(sh), sg * 0.04, -0.15, 0.9);
            an.PalmOf(sh, new Palm(new[] { 0, -0.3 - 0.4 * e, 0.95 }, new[] { 0, -0.8 - 0.85 * e, 0.6 - 0.3 * e }, 0.95));
            Set3(T, G2, -sg * (0.26 + 0.06 * e), relY - 0.14 + 0.04 * e - 0.04 * d, 0.28 + 0.06 * e);
            Set3(T, P.Elbow(gh), -sg * 0.7, -0.2, 0.6);
            an.PalmOf(gh, new Palm(new[] { 0, -0.3 - 0.35 * e, 0.95 }, new[] { 0, -0.7 - 0.8 * e, 0.6 - 0.25 * e }, 0.9));
            Sub(T, P.head, 0.06 * e);
        },
        ["stretch"] = (T, t, k, relY, sh, sg, gh, H2, G2, F, an) => { double q = Q01(t, 0.08, 0.36); Set3(T, H2, sg * (0.05 + 0.2 * q), relY + 0.06 * q, 0.2 - 0.28 * q); Set3(T, G2, -sg * (0.26 + 0.0 * q), relY - 0.14 + 0.2 * q, 0.28 - 0.4 * q); Set3(T, P.Elbow(gh), -sg * 0.8, 0.4, -0.5); Set3(T, P.Elbow(sh), sg * 0.8, 0.4, -0.5); Sub(T, P.chest, 0.1 * q); Sub(T, P.head, 0.12 * q); },
    };

    public static readonly Dictionary<string, Follow> FOLLOW = new()
    {
        ["classic"] = new(0.12, 0.04, 0.46, -0.8, 0.5),
        ["quick"] = new(0.08, -0.2, 0.4, -0.75, 0.2, air: true),
        ["high"] = new(0.12, 0.15, 0.22, -0.62, 0.75),
        ["snap"] = new(0.05, 0.03, 0.46, -1.25, 0.35, gx: 0.42),
        ["float"] = new(0.16, 0.08, 0.48, -0.6, 0.95),
        ["butter"] = new(0.2, 0.05, 0.42, -0.62, 0.75),
        ["feather"] = new(0.17, 0.05, 0.44, -0.45, 0.85),
        ["dart"] = new(0.06, -0.13, 0.64, -0.42, 0.3, air: true),
        ["rainbow"] = new(0.15, 0.14, 0.28, -0.66, 1.0),
        ["laser"] = new(0.05, 0.0, 0.48, -1.0, 0.5),
        ["wave"] = new(0.14, 0.06, 0.42, -0.75, 1.1),
        ["hold"] = new(0.13, 0.12, 0.34, -0.72, 1.6),
        ["snatch"] = new(0.07, 0.02, 0.44, -0.95, 0.24, air: true, gx: 0.34),
        ["twohand"] = new(0.15, 0.03, 0.4, -0.7, 0.6),
        ["point"] = new(0.1, 0.05, 0.46, -0.8, 0.9),
        ["cobra"] = new(0.05, 0.19, 0.3, -1.32, 0.55),
        ["flickup"] = new(0.06, 0.1, 0.4, -0.2, 0.45),
        ["fist"] = new(0.07, -0.05, 0.38, -1.4, 0.32, air: true),
        ["spread"] = new(0.1, 0.02, 0.44, -0.8, 0.7),
        ["drop"] = new(0.05, 0.0, 0.42, -0.7, 0.12, air: true),
        ["curl"] = new(0.09, 0.0, 0.4, -0.9, 0.6),
        ["reach"] = new(0.14, -0.12, 0.72, -0.55, 0.85),
        ["swipe"] = new(0.08, 0.04, 0.46, -0.8, 0.6),
        ["tip"] = new(0.1, 0.0, 0.42, -0.8, 0.8),
        ["swing"] = new(0.08, 0.02, 0.44, -0.75, 0.55, air: true),
        ["lock"] = new(0.12, 0.16, 0.26, -0.6, 1.05),
        ["chop"] = new(0.06, 0.0, 0.5, -0.5, 0.45, air: true),
        ["thread"] = new(0.12, 0.0, 0.5, -0.5, 0.75),
        ["hook"] = new(0.08, 0.08, 0.36, -1.5, 0.6),
        ["wipe"] = new(0.1, 0.03, 0.42, -0.8, 0.85),
        ["shake"] = new(0.1, 0.06, 0.42, -0.7, 1.0),
        ["stretch"] = new(0.14, 0.14, 0.2, -0.6, 1.2),
        ["sharpeye"] = new(0.24, 0.1, 0.38, -1.55, 1.15),
    };

    public static readonly Dictionary<string, double> DIP = new()
    {
        ["push"] = 0.035, ["flick"] = -0.025, ["high"] = 0.01, ["wide"] = 0.045, ["sniper"] = -0.02, ["fade"] = -0.015, ["hitch"] = 0.02, ["sling"] = 0.06, ["scissor"] = 0.005, ["tuck"] = 0.015, ["sway"] = 0, ["silk"] = 0.03,
        ["pogo"] = -0.03, ["stork"] = 0.01, ["frog"] = 0.06, ["corkscrew"] = 0.02, ["heel"] = 0.0, ["turbo"] = -0.05, ["onestep"] = 0.03, ["tilt"] = 0.01, ["catapult"] = 0.04, ["statue"] = -0.04, ["bounce"] = 0.02, ["whip"] = 0.035, ["dip"] = 0.08, ["leaner"] = 0.02, ["bicycle"] = 0.01, ["sharpeye"] = -0.065,
    };

    // v0.4.7.5 dunk legs in the air (up: share of the way to the slam)
    public delegate void DunkLegsFn(float[] T, double up);
    public static readonly Dictionary<string, DunkLegsFn> DUNK_LEGS2 = new()
    {
        ["twomill"] = (T, up) => { Set3(T, P.footL, 0.26, 0.3, -0.12); Set3(T, P.footR, -0.26, 0.3, -0.12); Set3(T, P.kneeL, 0.6, 0, 1); Set3(T, P.kneeR, -0.6, 0, 1); Set(T, P.pitchL, 0.75); Set(T, P.pitchR, 0.75); },
        ["sidemill"] = (T, up) => { Set3(T, P.footR, -0.34, 0.56, 0.12); Set3(T, P.kneeR, -1, 0.4, 0.4); Set3(T, P.footL, 0.1, 0.16, -0.06); Set(T, P.pitchL, 0.85); Set(T, P.pitchR, 0.5); },
        ["backscratch"] = (T, up) => { Set3(T, P.footL, 0.07, 0.12, -0.12); Set3(T, P.footR, -0.07, 0.12, -0.14); Set3(T, P.kneeL, 0.1, -0.4, 1); Set3(T, P.kneeR, -0.1, -0.4, 1); Set(T, P.pitchL, 1); Set(T, P.pitchR, 1); },
        ["rev360"] = (T, up) => { Set3(T, P.footR, -0.12, 0.42, 0.34); Set3(T, P.kneeR, -0.12, 0.3, 1); Set3(T, P.footL, 0.12, 0.3, -0.36); Set3(T, P.kneeL, 0.12, -0.2, 1); Set(T, P.pitchL, 0.9); Set(T, P.pitchR, 0.5); },
        ["spinmill"] = (T, up) => { Set3(T, P.footL, 0.12, 0.44, -0.04); Set3(T, P.footR, -0.12, 0.42, -0.06); Set3(T, P.kneeL, 0.25, 0, 1); Set3(T, P.kneeR, -0.25, 0, 1); Set(T, P.pitchL, 0.75); Set(T, P.pitchR, 0.75); },
        ["pump"] = (T, up) => { double b = Math.Abs(JsMath.Sin(2 * Math.PI * Math.Min(1, up / 0.74))); Set3(T, P.footL, 0.14, 0.28 + 0.14 * b, 0.05 - 0.3 * b); Set3(T, P.footR, -0.14, 0.28 + 0.12 * b, 0.05 - 0.28 * b); Set3(T, P.kneeL, 0.3, 0, 1); Set3(T, P.kneeR, -0.3, 0, 1); Set(T, P.pitchL, 0.75); Set(T, P.pitchR, 0.75); },
        ["kneeup"] = (T, up) => { Set3(T, P.footR, -0.1, 0.78, 0.26); Set3(T, P.kneeR, -0.1, 0.5, 1); Set3(T, P.footL, 0.1, 0.1, -0.04); Set3(T, P.kneeL, 0.1, -0.2, 1); Set(T, P.pitchL, 0.9); Set(T, P.pitchR, 0.4); },
        ["crossleg"] = (T, up) => { Set3(T, P.footL, -0.1, 0.34, 0.04); Set3(T, P.footR, 0.1, 0.36, 0.0); Set3(T, P.kneeL, 0.3, 0.2, 1); Set3(T, P.kneeR, -0.3, 0.2, 1); Set(T, P.pitchL, 0.8); Set(T, P.pitchR, 0.8); },
        ["helicopter"] = (T, up) => { Set3(T, P.footL, 0.07, 0.16, -0.16); Set3(T, P.footR, -0.07, 0.16, -0.18); Set3(T, P.kneeL, 0.08, -0.4, 1); Set3(T, P.kneeR, -0.08, -0.4, 1); Set(T, P.pitchL, 0.95); Set(T, P.pitchR, 0.95); },
        ["behindhead"] = (T, up) => { Set3(T, P.footL, 0.08, 0.36, 0.06); Set3(T, P.footR, -0.08, 0.36, 0.06); Set3(T, P.kneeL, 1, 0.2, 0.4); Set3(T, P.kneeR, -1, 0.2, 0.4); Set(T, P.pitchL, 0.6); Set(T, P.pitchR, 0.6); },
        ["cannonball"] = (T, up) => { Set3(T, P.footL, 0.1, 0.58, 0.24); Set3(T, P.footR, -0.1, 0.6, 0.24); Set3(T, P.kneeL, 0.16, 0.6, 1); Set3(T, P.kneeR, -0.16, 0.6, 1); Set(T, P.pitchL, 0.5); Set(T, P.pitchR, 0.5); },
        ["splits"] = (T, up) => { Set3(T, P.footL, 0.52, 0.44, 0.04); Set3(T, P.footR, -0.52, 0.44, 0.04); Set3(T, P.kneeL, 1, 0.3, 0.2); Set3(T, P.kneeR, -1, 0.3, 0.2); Set(T, P.pitchL, 0.6); Set(T, P.pitchR, 0.6); },
        ["hurdle"] = (T, up) => { Set3(T, P.footR, -0.1, 0.52, 0.6); Set3(T, P.kneeR, -0.1, 0.2, 1); Set3(T, P.footL, 0.16, 0.36, -0.3); Set3(T, P.kneeL, 0.4, -0.2, 1); Set(T, P.pitchL, 0.7); Set(T, P.pitchR, 0.3); },
        ["jackknife"] = (T, up) => { Set3(T, P.footL, 0.08, 0.5, 0.5); Set3(T, P.footR, -0.08, 0.52, 0.5); Set3(T, P.kneeL, 0.1, 0.2, 1); Set3(T, P.kneeR, -0.1, 0.2, 1); Set(T, P.pitchL, 0.3); Set(T, P.pitchR, 0.3); },
    };
    public static readonly Dictionary<string, double[]> SPINE2 = new()
    {
        ["twomill"] = new[] { -0.1, -0.06, -0.15 }, ["sidemill"] = new[] { -0.06, -0.04, -0.15 }, ["backscratch"] = new[] { -0.28, -0.18, -0.05 }, ["rev360"] = new[] { -0.12, -0.08, -0.3 }, ["spinmill"] = new[] { 0.06, 0, -0.15 },
        ["pump"] = new[] { 0.12, 0.06, -0.1 }, ["kneeup"] = new[] { 0.08, 0.02, -0.2 }, ["crossleg"] = new[] { -0.04, 0, -0.15 }, ["helicopter"] = new[] { -0.04, -0.02, -0.12 }, ["behindhead"] = new[] { -0.08, -0.06, 0.05 },
        ["cannonball"] = new[] { 0.3, 0.14, 0.05 }, ["splits"] = new[] { -0.1, -0.06, -0.2 }, ["hurdle"] = new[] { 0.14, 0.05, -0.2 }, ["jackknife"] = new[] { 0.42, 0.18, -0.05 },
    };
    public static readonly HashSet<string> ONE_HAND_DUNK = new() { "onehand", "tomahawk", "windmill", "cradle", "reverse", "hammer", "liberty", "scoop", "switch", "eastbay", "bully", "aroundback", "superman",
        "sidemill", "backscratch", "spinmill", "kneeup", "crossleg", "helicopter", "behindhead", "hurdle", "jackknife" };
    // sim/moves.js MOVE_STYLE (the fields the animator reads)
    public sealed record MoveStyle(double low, double wide, double flair);
    public static readonly Dictionary<string, MoveStyle> MOVE_STYLE = new()
    {
        ["basic"] = new(1, 1, 1), ["quick"] = new(0.95, 0.9, 0.9), ["elite"] = new(0.9, 1.05, 1.2), ["rhythm"] = new(1.05, 1, 1.1), ["ankle"] = new(0.85, 1.15, 1.25),
        ["pound"] = new(1.15, 1, 1.1), ["snake"] = new(0.8, 1.2, 1.15), ["crab"] = new(0.9, 1.3, 1), ["stutter"] = new(1, 1, 1.2), ["showtime"] = new(1.05, 1.1, 1.4), ["yoyo"] = new(1.12, 0.95, 1.15), ["rocker"] = new(1, 1, 1.15), ["cradle"] = new(0.8, 1.25, 1.1), ["glide"] = new(0.92, 1.2, 1), ["jab"] = new(0.95, 1, 1.1),
        ["springs"] = new(1, 0.9, 1.05), ["lowrider"] = new(0.72, 1.1, 1.3), ["swagger"] = new(1.1, 1.2, 1.35), ["blur"] = new(0.85, 0.85, 1.2), ["pendulum"] = new(0.82, 1.35, 1.25),
    };
}
