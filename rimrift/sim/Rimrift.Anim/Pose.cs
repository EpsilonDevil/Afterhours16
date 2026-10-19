// Port of client/js/char/pose.js. Pose parameter vector (Float32 in the JS, float here so traces compare).
// Positions are in character space (metres, authored for a 2.0 m athlete and scaled at runtime), angles radians.
namespace Rimrift.Anim;

public static class P
{
    public const int root = 0, pelvis = 3, spine = 6, chest = 9, neck = 12, head = 15, clavL = 18, clavR = 21,
        handL = 24, handR = 27, elbowL = 30, elbowR = 33, wristL = 36, wristR = 39,
        footL = 42, footR = 45, yawL = 48, yawR = 49, pitchL = 50, pitchR = 51, toeL = 52, toeR = 53,
        kneeL = 54, kneeR = 57, N = 60;

    public static readonly string[] GROUPS = { "root", "pelvis", "spine", "chest", "neck", "head", "clavL", "clavR", "handL", "handR",
        "elbowL", "elbowR", "wristL", "wristR", "footL", "footR", "yawL", "yawR", "pitchL", "pitchR", "toeL", "toeR", "kneeL", "kneeR" };
    public static readonly int[] OFFSET = { 0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 49, 50, 51, 52, 53, 54, 57 };
    public static readonly int[] GROUP_SIZE = { 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1, 3, 3 };
    public static readonly HashSet<string> ANGLE_GROUPS = new() { "pelvis", "spine", "chest", "neck", "head", "clavL", "clavR", "wristL", "wristR", "yawL", "yawR", "pitchL", "pitchR", "toeL", "toeR" };

    public static int Of(string g) { int i = Array.IndexOf(GROUPS, g); if (i < 0) throw new ArgumentException(g); return OFFSET[i]; }
    public static int SizeOf(string g) => GROUP_SIZE[Array.IndexOf(GROUPS, g)];
    // side helpers: side 0 = L, 1 = R
    public static int Hand(int side) => side == 0 ? handL : handR;
    public static int Elbow(int side) => side == 0 ? elbowL : elbowR;
    public static int Wrist(int side) => side == 0 ? wristL : wristR;
    public static int Foot(int side) => side == 0 ? footL : footR;
    public static int Knee(int side) => side == 0 ? kneeL : kneeR;
    public static int Yaw(int side) => side == 0 ? yawL : yawR;
    public static int Pitch(int side) => side == 0 ? pitchL : pitchR;
    public static int ToeOf(int side) => side == 0 ? toeL : toeR;
    public static int Clav(int side) => side == 0 ? clavL : clavR;
}

public static class Pose
{
    const double D = Math.PI / 180;
    public static float[] NewPose() => new float[P.N];

    static void Set(float[] o, int at, double x, double y, double z) { o[at] = (float)x; o[at + 1] = (float)y; o[at + 2] = (float)z; }

    /// Neutral standing pose (reference 2.0 m athlete)
    public static float[] Neutral(float[]? o = null)
    {
        o ??= NewPose();
        Array.Fill(o, 0f);
        Set(o, P.handL, 0.235, 1.0, 0.04); Set(o, P.handR, -0.235, 1.0, 0.04);
        Set(o, P.elbowL, 0.35, -0.2, -1); Set(o, P.elbowR, -0.35, -0.2, -1);
        Set(o, P.footL, 0.125, 0.08, 0.0); Set(o, P.footR, -0.125, 0.08, 0.0);
        o[P.yawL] = (float)(8 * D); o[P.yawR] = (float)(-8 * D);
        Set(o, P.kneeL, 0.15, 0, 1); Set(o, P.kneeR, -0.15, 0, 1);
        Set(o, P.wristL, 0, 0, 6 * D); Set(o, P.wristR, 0, 0, -6 * D);
        return o;
    }

    /// Convert an authored key {group: [..] (degrees for angle groups)} to a full vector + mask (pose.js compileKey).
    public static (float[] v, float[] mask) CompileKey(IReadOnlyDictionary<string, double[]> key, float[]? @base = null)
    {
        var v = @base != null ? (float[])@base.Clone() : Neutral();
        var mask = new float[P.N];
        foreach (var (g, arr) in key)
        {
            int gi = Array.IndexOf(P.GROUPS, g);
            if (gi < 0) continue;
            int o = P.OFFSET[gi], n = P.GROUP_SIZE[gi];
            bool ang = P.ANGLE_GROUPS.Contains(g);
            for (int i = 0; i < n; i++)
            {
                double a = i < arr.Length ? arr[i] : 0;
                v[o + i] = (float)(ang ? a * D : a);
                mask[o + i] = 1;
            }
        }
        return (v, mask);
    }

    public static float[] BlendInto(float[] o, float[] src, double w, float[]? mask)
    {
        if (w <= 0) return o;
        if (w >= 1 && mask == null) { Array.Copy(src, o, P.N); return o; }
        for (int i = 0; i < P.N; i++)
        {
            double k = mask != null ? w * mask[i] : w;
            if (k > 0) o[i] = (float)(o[i] + (src[i] - o[i]) * k);
        }
        return o;
    }

    /// Mirror a pose left-right (x negated, yaw/roll negated)
    public static float[] Mirror(float[] o, float[] src)
    {
        Array.Copy(src, o, P.N);
        void Swap(int a, int b, int n) { for (int i = 0; i < n; i++) { float t = src[a + i]; o[a + i] = src[b + i]; o[b + i] = t; } }
        Swap(P.clavL, P.clavR, 3); Swap(P.handL, P.handR, 3); Swap(P.elbowL, P.elbowR, 3); Swap(P.wristL, P.wristR, 3);
        Swap(P.footL, P.footR, 3); Swap(P.yawL, P.yawR, 1); Swap(P.pitchL, P.pitchR, 1); Swap(P.toeL, P.toeR, 1); Swap(P.kneeL, P.kneeR, 3);
        foreach (int g in new[] { P.handL, P.handR, P.elbowL, P.elbowR, P.footL, P.footR, P.kneeL, P.kneeR, P.root }) o[g] = -o[g];
        foreach (int g in new[] { P.pelvis, P.spine, P.chest, P.neck, P.head, P.clavL, P.clavR, P.wristL, P.wristR }) { o[g + 1] = -o[g + 1]; o[g + 2] = -o[g + 2]; }
        foreach (int g in new[] { P.yawL, P.yawR }) o[g] = -o[g];
        return o;
    }
}
