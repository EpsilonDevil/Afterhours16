// Port of client/js/char/skeleton.js. Humanoid skeleton with build-driven proportions. Bind orientations are
// identity (world-aligned), character faces +Z, left side is +X. Arms are in a 40 degree A-pose in bind.
namespace Rimrift.Anim;

public readonly record struct Build(double Height, double Weight, double Wingspan)
{
    // (JS: build.height || 78 etc. A zero/absent value falls back the same way)
    public double HeightIn => Height != 0 ? Height : 78;
    public double WeightLb => Weight != 0 ? Weight : 210;
    public double WingspanIn => Wingspan != 0 ? Wingspan : HeightIn + 3;
}

/// Body dimensions in metres (skeleton.js bodyDims).
public sealed class BodyDims
{
    public double H, W, WS, Girth, Muscle, ArmScale;
    public double HipY, SpineLen, ChestLen, NeckLen, HeadLen, ClavX, ClavY, ShoulderX;
    public double UpperLen, ForeLen, HandLen, HipX, HipDrop, ThighLen, ShinLen, AnkleY, FootLen, ToeFwd, HeadR, ReachStanding;
}

public static class Skeleton
{
    public const double INCH = 0.0254;
    public static readonly string[] BONES = {
        "hips", "spine", "chest", "neck", "head",
        "clavL", "upperL", "foreL", "handL",
        "clavR", "upperR", "foreR", "handR",
        "thighL", "shinL", "footL", "toeL",
        "thighR", "shinR", "footR", "toeR",
    };
    public const int N = 21;
    public static readonly int[] PARENT = { -1, 0, 1, 2, 3, 2, 5, 6, 7, 2, 9, 10, 11, 0, 13, 14, 15, 0, 17, 18, 19 };
    public const double ARM_ANGLE = 40 * Math.PI / 180;
    public const double OVERHEAD_LIFT = 0.025;

    public static int Index(string name) => Array.IndexOf(BONES, name);

    public static double StandingReach(BodyDims d) =>
        d.HipY + d.SpineLen + d.ChestLen + d.ClavY + 0.002 * d.H + OVERHEAD_LIFT * d.H + d.UpperLen + d.ForeLen + d.HandLen;

    public static BodyDims BodyDims(Build build)
    {
        double H = build.HeightIn * INCH;
        double W = build.WeightLb * 0.4536;
        double WS = build.WingspanIn * INCH;
        double bmi = W / (H * H);
        double girth = Math.Max(0.86, Math.Min(1.28, Math.Sqrt(bmi / 23.5)));
        double muscle = Math.Max(0.9, Math.Min(1.2, 1 + (bmi - 24) * 0.03));
        double shoulderX = 0.094 * H * Math.Min(1.1, girth * 0.5 + 0.52);
        double armScale = Math.Max(0.8, (WS / 2 - shoulderX) / (0.424 * H));
        var d = new BodyDims
        {
            H = H, W = W, WS = WS, Girth = girth, Muscle = muscle, ArmScale = armScale,
            HipY = 0.535 * H,
            SpineLen = 0.075 * H, ChestLen = 0.10 * H, NeckLen = 0.115 * H, HeadLen = 0.05 * H,
            ClavX = 0.022 * H, ClavY = 0.097 * H, ShoulderX = shoulderX,
            UpperLen = 0.172 * H * armScale, ForeLen = 0.148 * H * armScale, HandLen = 0.104 * H * armScale,
            HipX = 0.05 * H * Math.Min(1.1, girth), HipDrop = 0.03 * H,
            ThighLen = 0.235 * H, ShinLen = 0.23 * H, AnkleY = 0.04 * H,
            FootLen = 0.152 * H, ToeFwd = 0.105 * H,
            HeadR = 0.063 * H,
        };
        d.ReachStanding = StandingReach(d);
        return d;
    }

    /// Bind-pose local offsets (relative to the parent joint), metres.
    public static double[][] BindOffsets(BodyDims d)
    {
        var off = new double[N][];
        double s = JsMath.Sin(ARM_ANGLE), c = JsMath.Cos(ARM_ANGLE);
        off[B.hips] = new[] { 0, d.HipY, 0 };
        off[B.spine] = new[] { 0, d.SpineLen, -0.004 * d.H };
        off[B.chest] = new[] { 0, d.ChestLen, 0 };
        off[B.neck] = new[] { 0, d.NeckLen, -0.006 * d.H };
        off[B.head] = new[] { 0, d.HeadLen, 0.006 * d.H };
        foreach (var (side, sg) in new[] { ("L", 1.0), ("R", -1.0) })
        {
            off[B.Of("clav" + side)] = new[] { sg * d.ClavX, d.ClavY, -0.004 * d.H };
            off[B.Of("upper" + side)] = new[] { sg * (d.ShoulderX - d.ClavX), 0.002 * d.H, -0.004 * d.H };
            off[B.Of("fore" + side)] = new[] { sg * s * d.UpperLen, -c * d.UpperLen, 0 };
            off[B.Of("hand" + side)] = new[] { sg * s * d.ForeLen, -c * d.ForeLen, 0 };
            off[B.Of("thigh" + side)] = new[] { sg * d.HipX, -d.HipDrop, 0.004 * d.H };
            off[B.Of("shin" + side)] = new[] { 0, -d.ThighLen, 0.004 * d.H };
            off[B.Of("foot" + side)] = new[] { 0, -d.ShinLen, -0.006 * d.H };
            off[B.Of("toe" + side)] = new[] { 0, -(d.HipY - d.HipDrop - d.ThighLen - d.ShinLen) + 0.012 * d.H, d.ToeFwd };
        }
        return off;
    }

    /// Bind-pose model-space joint positions.
    public static double[][] BindPositions(double[][] off)
    {
        var pos = new double[N][];
        for (int i = 0; i < N; i++)
        {
            int p = PARENT[i];
            pos[i] = p < 0 ? (double[])off[i].Clone() : new[] { pos[p][0] + off[i][0], pos[p][1] + off[i][1], pos[p][2] + off[i][2] };
        }
        return pos;
    }
}

/// Bone indices (skeleton.js B).
public static class B
{
    public const int hips = 0, spine = 1, chest = 2, neck = 3, head = 4,
        clavL = 5, upperL = 6, foreL = 7, handL = 8,
        clavR = 9, upperR = 10, foreR = 11, handR = 12,
        thighL = 13, shinL = 14, footL = 15, toeL = 16,
        thighR = 17, shinR = 18, footR = 19, toeR = 20;
    public static int Of(string name) => Skeleton.Index(name);
    // side helpers (hot path: no string concatenation)
    public static int Clav(int side) => side == 0 ? clavL : clavR;
    public static int Upper(int side) => side == 0 ? upperL : upperR;
    public static int Fore(int side) => side == 0 ? foreL : foreR;
    public static int Hand(int side) => side == 0 ? handL : handR;
    public static int Thigh(int side) => side == 0 ? thighL : thighR;
    public static int Shin(int side) => side == 0 ? shinL : shinR;
    public static int Foot(int side) => side == 0 ? footL : footR;
    public static int Toe(int side) => side == 0 ? toeL : toeR;
}

/// The model the rig is built on (athlete.js AthleteModel's d / off / bind, nothing of its geometry).
public sealed class AthleteModel
{
    public readonly Build Build;
    public readonly BodyDims D;
    public readonly double[][] Off, Bind;
    public AthleteModel(Build build)
    {
        Build = build;
        D = Skeleton.BodyDims(build);
        Off = Skeleton.BindOffsets(D);
        Bind = Skeleton.BindPositions(Off);
    }
}
