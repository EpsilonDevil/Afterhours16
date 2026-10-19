// Port of client/js/char/rig.js: pose -> skeleton solve (FK spine, analytic two-bone IK for the limbs, look-at, palm
// orientation, the v0.4.7.5 limb clearance) -> joint rotations/positions and skin matrices.
using static Rimrift.Anim.JsMath;
namespace Rimrift.Anim;

public sealed class Palm
{
    public double[] Normal = { 0, 0, 1 }, Fingers = { 0, 1, 0 };
    public double W;
    public Palm() { }
    public Palm(double[] normal, double[] fingers, double w) { Normal = normal; Fingers = fingers; W = w; }
}

public sealed class RigOpts
{
    public double[]? Look; public double LookW;
    public Palm? PalmL, PalmR;
    public bool PinL, PinR;
    public double Flip, FlipY = 0.5;
    public Palm? Palm(int side) => side == 0 ? PalmL : PalmR;
    public bool Pin(int side) => side == 0 ? PinL : PinR;
}

public sealed class Rig
{
    public const double ARM_CLEAR_TORSO = 0.82, ARM_CLEAR_STEP = 0.04; public const int ARM_CLEAR_ITERS = 8;
    public const double ARM_CROSS_GAP = 0.056, ARM_HEAD_R = 0.084, LEG_CLEAR_THIGH = 0.082, LEG_CLEAR_SHIN = 0.068;
    static readonly double[][] ARM_PROBE_UPPER = { new[] { 0.5, 0.5 }, new[] { 0.65, 0.6 }, new[] { 0.8, 0.72 }, new[] { 1.0, ARM_CLEAR_TORSO } };
    static readonly double[][] ARM_PROBE_FORE = { new[] { 0.15, ARM_CLEAR_TORSO }, new[] { 0.32, ARM_CLEAR_TORSO }, new[] { 0.49, ARM_CLEAR_TORSO }, new[] { 0.66, ARM_CLEAR_TORSO }, new[] { 0.83, ARM_CLEAR_TORSO }, new[] { 1.0, ARM_CLEAR_TORSO } };

    public readonly AthleteModel Model;
    public readonly BodyDims D;
    public readonly double S;
    public readonly double[][] Off, Bind;
    public readonly int N = Skeleton.N;
    public readonly float[][] Rot;
    public readonly double[][] Pos;
    public readonly float[] Skin;
    public readonly float[] World = M4();
    public readonly double LenUpper, LenFore, LenThigh, LenShin;
    readonly double[][][] armA0 = new double[2][][], legA0 = new double[2][][];
    readonly double[][] armN0 = new double[2][], legN0 = new double[2][], palm0 = new double[2][], handA0 = new double[2][];
    public readonly double[][] ElbowPos = { new double[3], new double[3] };
    public readonly double[] Reach = { 0, 0 };
    readonly float[] tmpQ = Q4(), tmpQ2 = Q4();

    public Rig(AthleteModel model)
    {
        Model = model; D = model.D; S = D.H / 2.0; Off = model.Off; Bind = model.Bind;
        Rot = new float[N][]; Pos = new double[N][];
        for (int i = 0; i < N; i++) { Rot[i] = Q4(); Pos[i] = new double[3]; }
        Skin = new float[16 * N];
        var o = Off;
        LenUpper = Hypot(o[B.foreL]); LenFore = Hypot(o[B.handL]); LenThigh = Hypot(o[B.shinL]); LenShin = Hypot(o[B.footL]);
        double s40 = JsMath.Sin(Skeleton.ARM_ANGLE), c40 = JsMath.Cos(Skeleton.ARM_ANGLE);
        armA0[0] = new[] { Norm(o[B.foreL]), Norm(o[B.handL]) }; armA0[1] = new[] { Norm(o[B.foreR]), Norm(o[B.handR]) };
        armN0[0] = Cross(Norm(o[B.foreL]), V3(0, 0, -1)); armN0[1] = Cross(Norm(o[B.foreR]), V3(0, 0, -1));
        legA0[0] = new[] { Norm(o[B.shinL]), Norm(o[B.footL]) }; legA0[1] = new[] { Norm(o[B.shinR]), Norm(o[B.footR]) };
        legN0[0] = Cross(Norm(o[B.shinL]), V3(0, 0, 1)); legN0[1] = Cross(Norm(o[B.shinR]), V3(0, 0, 1));
        palm0[0] = V3(-c40, -s40, 0); palm0[1] = V3(c40, -s40, 0);
        handA0[0] = V3(s40, -c40, 0); handA0[1] = V3(-s40, -c40, 0);
    }

    // ---- helpers (rig.js module scope) ----
    static float[] QuatFromBasis(float[] o, double[] x, double[] y, double[] z)
    {
        double m00 = x[0], m01 = y[0], m02 = z[0], m10 = x[1], m11 = y[1], m12 = z[1], m20 = x[2], m21 = y[2], m22 = z[2];
        double tr = m00 + m11 + m22;
        if (tr > 0) { double s = Math.Sqrt(tr + 1) * 2; o[3] = (float)(0.25 * s); o[0] = (float)((m21 - m12) / s); o[1] = (float)((m02 - m20) / s); o[2] = (float)((m10 - m01) / s); }
        else if (m00 > m11 && m00 > m22) { double s = Math.Sqrt(1 + m00 - m11 - m22) * 2; o[3] = (float)((m21 - m12) / s); o[0] = (float)(0.25 * s); o[1] = (float)((m01 + m10) / s); o[2] = (float)((m02 + m20) / s); }
        else if (m11 > m22) { double s = Math.Sqrt(1 + m11 - m00 - m22) * 2; o[3] = (float)((m02 - m20) / s); o[0] = (float)((m01 + m10) / s); o[1] = (float)(0.25 * s); o[2] = (float)((m12 + m21) / s); }
        else { double s = Math.Sqrt(1 + m22 - m00 - m11) * 2; o[3] = (float)((m10 - m01) / s); o[0] = (float)((m02 + m20) / s); o[1] = (float)((m12 + m21) / s); o[2] = (float)(0.25 * s); }
        return QNorm(o, o);
    }
    static (double[] x, double[] y, double[] z) Basis(double[] a, double[] n)
    {
        var x = Norm(a); var z = Norm(n);
        double d = Dot(z, x);
        z = Norm(V3(z[0] - x[0] * d, z[1] - x[1] * d, z[2] - x[2] * d));
        return (x, Cross(z, x), z);
    }
    /// Rotation mapping frame (a0, n0) -> (a1, n1)
    static float[] FrameRot(float[] o, double[] a0, double[] n0, double[] a1, double[] n1)
    {
        var (x0, y0, z0) = Basis(a0, n0); var (x1, y1, z1) = Basis(a1, n1);
        var q0 = QuatFromBasis(Q4(), x0, y0, z0); var q1 = QuatFromBasis(Q4(), x1, y1, z1);
        return QMul(o, q1, QInvert(Q4(), q0));
    }
    /// the least distance between two segments p1-q1 and p2-q2
    public static double SegSegDist(double[] p1, double[] q1, double[] p2, double[] q2)
    {
        var d1 = V3(q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]); var d2 = V3(q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]); var r = V3(p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]);
        double a = Dot(d1, d1), e = Dot(d2, d2), f = Dot(d2, r);
        double sc = 0, tc = 0;
        if (a > 1e-9 && e > 1e-9)
        {
            double c = Dot(d1, r), b = Dot(d1, d2), den = a * e - b * b;
            sc = den > 1e-9 ? Math.Max(0, Math.Min(1, (b * f - c * e) / den)) : 0;
            tc = (b * sc + f) / e;
            if (tc < 0) { tc = 0; sc = Math.Max(0, Math.Min(1, -c / a)); } else if (tc > 1) { tc = 1; sc = Math.Max(0, Math.Min(1, (b - c) / a)); }
        }
        else if (e > 1e-9) tc = Math.Max(0, Math.Min(1, f / e));
        double x = p1[0] + d1[0] * sc - p2[0] - d2[0] * tc, y = p1[1] + d1[1] * sc - p2[1] - d2[1] * tc, z = p1[2] + d1[2] * sc - p2[2] - d2[2] * tc;
        return Hypot(x, y, z);
    }

    float[] EulerQ(float[] o, float[] p, int i) => QEuler(o, p[i], p[i + 1], p[i + 2]);

    void ChainFK(int bone, int parentBone, float[] localQ)
    {
        var pr = Rot[parentBone]; var pp = Pos[parentBone];
        QMul(Rot[bone], pr, localQ);
        var o = QRot(pr, Off[bone]);
        Pos[bone][0] = pp[0] + o[0]; Pos[bone][1] = pp[1] + o[1]; Pos[bone][2] = pp[2] + o[2];
    }

    public void Solve(float[] pose, RigOpts? opts = null)
    {
        opts ??= new RigOpts();
        double s = S; var d = D;
        var hips = Pos[B.hips];
        var rH = Rot[B.hips];
        EulerQ(rH, pose, P.pelvis);
        hips[0] = pose[P.root] * s; hips[1] = Bind[B.hips][1] + pose[P.root + 1] * s; hips[2] = pose[P.root + 2] * s;
        // pelvis auto-drop so grounded feet can be reached
        double maxL = (LenThigh + LenShin) * 0.995;
        double drop = 0;
        for (int side = 0; side < 2; side++)
        {
            int fo = P.Foot(side);
            var hj = QRot(rH, Off[B.Thigh(side)]);
            double Ax = pose[fo] * s, Ay = pose[fo + 1] * s, Az = pose[fo + 2] * s;
            double hx = hips[0] + hj[0] - Ax, hz = hips[2] + hj[2] - Az, dy = hips[1] + hj[1] - Ay;
            double h2 = hx * hx + hz * hz;
            if (h2 < maxL * maxL) { double need = dy - Math.Sqrt(maxL * maxL - h2); if (need > drop) drop = need; }
        }
        hips[1] -= Math.Min(drop, 0.35 * d.H);
        // spine chain
        ChainFK(B.spine, B.hips, EulerQ(tmpQ, pose, P.spine));
        ChainFK(B.chest, B.spine, EulerQ(tmpQ, pose, P.chest));
        var neckQ = EulerQ(Q4(), pose, P.neck); var headQ = EulerQ(Q4(), pose, P.head);
        if (opts.Look != null && opts.LookW > 0)
        {
            var c = Pos[B.chest];
            double[] headPos = { c[0], c[1] + 0.17 * d.H, c[2] };
            var dir = Norm(V3(opts.Look[0] - headPos[0], opts.Look[1] - headPos[1], opts.Look[2] - headPos[2]));
            var inv = QInvert(Q4(), Rot[B.chest]);
            var ld = QRot(inv, dir);
            double yaw = Math.Atan2(ld[0], ld[2]), pitch = -Math.Atan2(ld[1], Hypot(ld[0], ld[2]));
            yaw = Clamp(yaw, -1.25, 1.25) * opts.LookW; pitch = Clamp(pitch, -0.6, 0.7) * opts.LookW;
            QMul(neckQ, neckQ, QEuler(tmpQ2, pitch * 0.35, yaw * 0.4, 0));
            QMul(headQ, headQ, QEuler(tmpQ2, pitch * 0.65, yaw * 0.6, 0));
        }
        ChainFK(B.neck, B.chest, neckQ);
        ChainFK(B.head, B.neck, headQ);
        // legs
        var FT = FootTargets(pose); var KP = KneePoles(pose, hips, rH, FT);
        for (int side = 0; side < 2; side++)
        {
            int th = B.Thigh(side), sh = B.Shin(side), ft = B.Foot(side), toe = B.Toe(side);
            var hj = QRot(rH, Off[th]);
            double[] Hj = { hips[0] + hj[0], hips[1] + hj[1], hips[2] + hj[2] };
            int ki = P.Knee(side);
            var T = FT[side];
            var (E, W, n) = TwoBone(Hj, T, LenThigh, LenShin, KP[side] ?? V3(pose[ki], pose[ki + 1], pose[ki + 2]));
            var a0 = legA0[side]; var n0 = legN0[side];
            FrameRot(Rot[th], a0[0], n0, Norm(V3(E[0] - Hj[0], E[1] - Hj[1], E[2] - Hj[2])), n);
            Pos[th][0] = Hj[0]; Pos[th][1] = Hj[1]; Pos[th][2] = Hj[2];
            FrameRot(Rot[sh], a0[1], n0, Norm(V3(W[0] - E[0], W[1] - E[1], W[2] - E[2])), n);
            var ks = QRot(Rot[th], Off[sh]);
            Pos[sh][0] = Hj[0] + ks[0]; Pos[sh][1] = Hj[1] + ks[1]; Pos[sh][2] = Hj[2] + ks[2];
            var af = QRot(Rot[sh], Off[ft]);
            Pos[ft][0] = Pos[sh][0] + af[0]; Pos[ft][1] = Pos[sh][1] + af[1]; Pos[ft][2] = Pos[sh][2] + af[2];
            QEuler(Rot[ft], pose[P.Pitch(side)], pose[P.Yaw(side)], 0);
            ChainFK(toe, ft, QAxis(tmpQ, 1, 0, 0, pose[P.ToeOf(side)]));
        }
        // arms
        var chestInv = QInvert(Q4(), Rot[B.chest]);
        var armT = new double[2][];
        for (int side = 0; side < 2; side++) armT[side] = SolveArm(side, pose, opts, chestInv);
        int mv = opts.PinR && !opts.PinL ? 0 : opts.PinR && opts.PinL ? -1 : 1; // (the hand that moves: never one on the ball)
        for (int it = 0; mv >= 0 && it < ARM_CLEAR_ITERS; it++)
        {
            double gap = ARM_CROSS_GAP * D.H, dd = SegSegDist(Pos[B.foreL], Pos[B.handL], Pos[B.foreR], Pos[B.handR]);
            if (dd >= gap) break;
            var f = QRot(Rot[B.chest], V3(0, 0, 1)); double step = gap - dd + 0.01 * D.H;
            armT[mv][0] += f[0] * step; armT[mv][1] += f[1] * step; armT[mv][2] += f[2] * step;
            SolveArm(mv, pose, opts, chestInv, armT[mv]);
        }
    }

    double[] SolveArm(int side, float[] pose, RigOpts opts, float[] chestInv, double[]? T0 = null)
    {
        double s = S;
        int clav = B.Clav(side), up = B.Upper(side), fo = B.Fore(side), ha = B.Hand(side);
        ChainFK(clav, B.chest, EulerQ(tmpQ, pose, P.Clav(side)));
        double[] Sh = { 0, 0, 0 };
        var o = QRot(Rot[clav], Off[up]);
        Sh[0] = Pos[clav][0] + o[0]; Sh[1] = Pos[clav][1] + o[1]; Sh[2] = Pos[clav][2] + o[2];
        int hi = P.Hand(side), ei = P.Elbow(side);
        var T = T0 != null ? (double[])T0.Clone() : V3(pose[hi] * s, pose[hi + 1] * s, pose[hi + 2] * s);
        ClearHead(T);
        var pole = V3(pose[ei], pose[ei + 1], pose[ei + 2]);
        var (E, W, n) = TwoBone(Sh, T, LenUpper, LenFore, pole);
        bool pinned = opts.Pin(side);
        for (int it = 0; it < ARM_CLEAR_ITERS; it++)
        {
            if (ArmPenetration(Sh, E, W, chestInv) == 0) break;
            var alt = ElbowOut(Sh, W, E, side, chestInv);
            if (alt != null) (E, W, n) = TwoBone(Sh, T, LenUpper, LenFore, alt.Value.d);
            if (pinned || (alt != null && alt.Value.clear)) break;
            if (!ArmClear(Sh, E, W, T, chestInv)) break;
            (E, W, n) = TwoBone(Sh, T, LenUpper, LenFore, pole);
        }
        Reach[side] = Hypot(T[0] - W[0], T[1] - W[1], T[2] - W[2]);
        var a0 = armA0[side]; var n0 = armN0[side];
        FrameRot(Rot[up], a0[0], n0, Norm(V3(E[0] - Sh[0], E[1] - Sh[1], E[2] - Sh[2])), n);
        Pos[up][0] = Sh[0]; Pos[up][1] = Sh[1]; Pos[up][2] = Sh[2];
        FrameRot(Rot[fo], a0[1], n0, Norm(V3(W[0] - E[0], W[1] - E[1], W[2] - E[2])), n);
        var ef = QRot(Rot[up], Off[fo]);
        Pos[fo][0] = Sh[0] + ef[0]; Pos[fo][1] = Sh[1] + ef[1]; Pos[fo][2] = Sh[2] + ef[2];
        ElbowPos[side] = (double[])Pos[fo].Clone();
        var hf = QRot(Rot[fo], Off[ha]);
        Pos[ha][0] = Pos[fo][0] + hf[0]; Pos[ha][1] = Pos[fo][1] + hf[1]; Pos[ha][2] = Pos[fo][2] + hf[2];
        var palm = opts.Palm(side);
        if (palm != null && palm.W > 0)
        {
            var want = FrameRot(Q4(), handA0[side], palm0[side], palm.Fingers, palm.Normal);
            var fk = QMul(Q4(), Rot[fo], EulerQ(tmpQ, pose, P.Wrist(side)));
            QSlerp(Rot[ha], fk, want, palm.W);
        }
        else QMul(Rot[ha], Rot[fo], EulerQ(tmpQ, pose, P.Wrist(side)));
        return T;
    }

    // ---- v0.4.7.5 limb collisions ----
    (double x, double z)? TorsoAt(double[] E, float[] chestInv)
    {
        double H = D.H, g = D.Girth != 0 ? D.Girth : 1; var c = Pos[B.chest]; double hy = Pos[B.hips][1], ny = Pos[B.neck][1];
        if (E[1] < hy - 0.02 * H || E[1] > ny - 0.01 * H) return null;
        var v = QRot(chestInv, V3(E[0] - c[0], E[1] - c[1], E[2] - c[2]));
        var tt = TorsoTable.At((Bind[B.chest][1] + v[1]) / H); double rx = tt[0], zf = tt[1], zb = tt[2], zc = tt[3], pad = 0.024 * H;
        return (v[0] / (rx * g * H + pad), (v[2] - zc * H) / ((v[2] - zc * H >= 0 ? zf : zb) * g * H + pad));
    }
    public bool InsideTorso(double[] E, float[] chestInv) { var t = TorsoAt(E, chestInv); return t != null && t.Value.x * t.Value.x + t.Value.z * t.Value.z < 1; }

    (double[] d, bool clear)? ElbowOut(double[] S0, double[] W, double[] E, int side, float[] chestInv)
    {
        var ax = Norm(V3(W[0] - S0[0], W[1] - S0[1], W[2] - S0[2]));
        var es = V3(E[0] - S0[0], E[1] - S0[1], E[2] - S0[2]);
        double t0 = Dot(es, ax);
        double[] c = { S0[0] + ax[0] * t0, S0[1] + ax[1] * t0, S0[2] + ax[2] * t0 };
        var r0 = V3(E[0] - c[0], E[1] - c[1], E[2] - c[2]); double h = Hypot(r0); if (h == 0) h = 1e-4;
        var u = Norm(r0); var w = Cross(ax, u);
        double[]? best = null; double bv = double.PositiveInfinity;
        for (int k = 1; k <= 12; k++) foreach (int sg in new[] { 1, -1 })
        {
            double a = sg * k * Math.PI / 12, ca = JsMath.Cos(a), sa = JsMath.Sin(a);
            double[] dd = { u[0] * ca + w[0] * sa, u[1] * ca + w[1] * sa, u[2] * ca + w[2] * sa };
            double[] P2 = { c[0] + dd[0] * h, c[1] + dd[1] * h, c[2] + dd[2] * h };
            double v = ArmPenetration(S0, P2, W, chestInv);
            if (v == 0) return (dd, true);
            if (v < bv) { bv = v; best = dd; }
        }
        return best != null ? (best, false) : null;
    }

    double ArmPenetration(double[] S0, double[] E, double[] W, float[] chestInv)
    {
        double H = D.H; var hd = Pos[B.head]; double hr = ARM_HEAD_R * H;
        double cx = hd[0], cy = hd[1] + 0.055 * H, cz = hd[2] + 0.01 * H;
        double v = 0;
        void Probe(double px, double py, double pz, double thr)
        {
            var t = TorsoAt(new[] { px, py, pz }, chestInv);
            if (t != null) { double r2 = t.Value.x * t.Value.x + t.Value.z * t.Value.z; if (r2 < thr) v += thr - r2; }
            double dd = Hypot(px - cx, py - cy, pz - cz);
            if (dd < hr - 0.005 * H) v += (hr - dd) / hr;
        }
        foreach (var kt in ARM_PROBE_UPPER) Probe(S0[0] + (E[0] - S0[0]) * kt[0], S0[1] + (E[1] - S0[1]) * kt[0], S0[2] + (E[2] - S0[2]) * kt[0], kt[1]);
        foreach (var kt in ARM_PROBE_FORE) Probe(E[0] + (W[0] - E[0]) * kt[0], E[1] + (W[1] - E[1]) * kt[0], E[2] + (W[2] - E[2]) * kt[0], kt[1]);
        foreach (var (lp, lq, r) in LegCapsules()) { double dd = SegSegDist(E, W, lp, lq); if (dd < r) v += (r - dd) / r; }
        return v;
    }

    bool ArmClear(double[] S0, double[] E, double[] W, double[] T, float[] chestInv)
    {
        double H = D.H; var hd = Pos[B.head]; double hr = ARM_HEAD_R * H;
        double cx = hd[0], cy = hd[1] + 0.055 * H, cz = hd[2] + 0.01 * H;
        double worstT = 0; double[]? headPush = null; (double x, double z)? outDir = null;
        void Probe(double px, double py, double pz, double thr)
        {
            var t = TorsoAt(new[] { px, py, pz }, chestInv);
            if (t != null) { double r2 = t.Value.x * t.Value.x + t.Value.z * t.Value.z; if (r2 < thr && thr - r2 > worstT) { worstT = thr - r2; outDir = t; } }
            double dx = px - cx, dy = py - cy, dz = pz - cz, dd = Hypot(dx, dy, dz);
            if (dd < hr - 0.005 * H && dd > 1e-5 && (headPush == null || hr - dd > headPush[3])) headPush = new[] { dx / dd, dy / dd, dz / dd, hr - dd };
        }
        foreach (var kt in ARM_PROBE_UPPER) Probe(S0[0] + (E[0] - S0[0]) * kt[0], S0[1] + (E[1] - S0[1]) * kt[0], S0[2] + (E[2] - S0[2]) * kt[0], kt[1]);
        foreach (var kt in ARM_PROBE_FORE) Probe(E[0] + (W[0] - E[0]) * kt[0], E[1] + (W[1] - E[1]) * kt[0], E[2] + (W[2] - E[2]) * kt[0], kt[1]);
        double[]? legPush = null;
        foreach (var (lp, lq, r) in LegCapsules())
        {
            double dd = SegSegDist(E, W, lp, lq);
            if (dd < r && (legPush == null || r - dd > legPush[3]))
            {
                double lx = lq[0] - lp[0], ly = lq[1] - lp[1], lz = lq[2] - lp[2], ll = lx * lx + ly * ly + lz * lz; if (ll == 0) ll = 1e-6;
                double t = Math.Max(0, Math.Min(1, ((W[0] - lp[0]) * lx + (W[1] - lp[1]) * ly + (W[2] - lp[2]) * lz) / ll));
                double nx = W[0] - (lp[0] + lx * t), ny = W[1] - (lp[1] + ly * t) + 0.02 * H, nz = W[2] - (lp[2] + lz * t), nl = Hypot(nx, ny, nz); if (nl == 0) nl = 1e-6;
                legPush = new[] { nx / nl, ny / nl, nz / nl, r - dd };
            }
        }
        if (worstT == 0 && headPush == null && legPush == null) return false;
        if (legPush != null) { double step = legPush[3] + 0.01 * H; T[0] += legPush[0] * step; T[1] += legPush[1] * step; T[2] += legPush[2] * step; }
        if (worstT != 0)
        {
            double dl = Hypot(outDir!.Value.x, outDir.Value.z); if (dl == 0) dl = 1;
            var dir = dl < 0.2 ? V3(0, 0, 1) : V3(outDir.Value.x / dl, 0, outDir.Value.z / dl);
            var f = QRot(Rot[B.chest], dir); double step = ARM_CLEAR_STEP * H * Math.Min(1, 0.5 + worstT);
            T[0] += f[0] * step; T[1] += f[1] * step; T[2] += f[2] * step;
        }
        if (headPush != null) { double step = headPush[3] + 0.01 * H; T[0] += headPush[0] * step; T[1] += headPush[1] * step; T[2] += headPush[2] * step; }
        return true;
    }

    (double[], double[], double)[] LegCapsules()
    {
        double H = D.H; var p = Pos;
        return new[] { (p[B.thighL], p[B.shinL], LEG_CLEAR_THIGH * H), (p[B.shinL], p[B.footL], LEG_CLEAR_SHIN * H), (p[B.thighR], p[B.shinR], LEG_CLEAR_THIGH * H), (p[B.shinR], p[B.footR], LEG_CLEAR_SHIN * H) };
    }

    void ClearHead(double[] T)
    {
        double H = D.H; var hd = Pos[B.head]; double r = 0.07 * H;
        double cx = hd[0], cy = hd[1] + 0.055 * H, cz = hd[2] + 0.01 * H;
        double dx = T[0] - cx, dy = T[1] - cy, dz = T[2] - cz, dd = Hypot(dx, dy, dz);
        if (dd >= r || dd < 1e-5) return;
        double k = r / dd; T[0] = cx + dx * k; T[1] = cy + dy * k; T[2] = cz + dz * k;
    }

    double[]?[] KneePoles(float[] pose, double[] hips, float[] rH, double[][] FT)
    {
        double H = D.H, min = 0.066 * H; var o = new double[]?[2]; var J = new double[2][]; var K = new double[2][];
        for (int side = 0; side < 2; side++)
        {
            var hj = QRot(rH, Off[B.Thigh(side)]); int ki = P.Knee(side);
            J[side] = new[] { hips[0] + hj[0], hips[1] + hj[1], hips[2] + hj[2] };
            K[side] = TwoBone(J[side], FT[side], LenThigh, LenShin, V3(pose[ki], pose[ki + 1], pose[ki + 2])).E;
        }
        double dd = Hypot(K[0][0] - K[1][0], K[0][1] - K[1][1], K[0][2] - K[1][2]);
        if (dd >= min) return o;
        for (int k = 1; k <= 8 && dd < min; k++)
        {
            for (int side = 0; side < 2; side++)
            {
                int ki = P.Knee(side); double sx = side == 0 ? 1 : -1;
                double[] bs = { pose[ki], pose[ki + 1], pose[ki + 2] }; double bl = Hypot(bs); if (bl == 0) bl = 1;
                o[side] = new[] { bs[0] / bl + sx * 0.18 * k, bs[1] / bl, bs[2] / bl };
                K[side] = TwoBone(J[side], FT[side], LenThigh, LenShin, o[side]!).E;
            }
            dd = Hypot(K[0][0] - K[1][0], K[0][1] - K[1][1], K[0][2] - K[1][2]);
        }
        return o;
    }

    double[][] FootTargets(float[] pose)
    {
        double s = S, H = D.H; int L = P.footL, R = P.footR;
        double[] a = { pose[L] * s, pose[L + 1] * s, pose[L + 2] * s }, b = { pose[R] * s, pose[R + 1] * s, pose[R + 2] * s };
        double min = 0.062 * H, dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2], dd = Hypot(dx, dy, dz);
        if (dd < min)
        {
            double push = (min - dd) / 2, sx = dx >= 0 ? 1 : -1;
            double hz = Hypot(dx, dz);
            var lat = hz > 1e-4 ? V3(dx / hz, 0, dz / hz) : V3(sx, 0, 0);
            a[0] += lat[0] * push; a[2] += lat[2] * push; b[0] -= lat[0] * push; b[2] -= lat[2] * push;
        }
        return new[] { a, b };
    }

    public (double[] E, double[] W, double[] n) TwoBone(double[] A, double[] T, double l1, double l2, double[] pole)
    {
        double dx = T[0] - A[0], dy = T[1] - A[1], dz = T[2] - A[2];
        double dist = Hypot(dx, dy, dz); if (dist == 0) dist = 1e-4;
        double[] dn = { dx / dist, dy / dist, dz / dist };
        dist = Clamp(dist, Math.Abs(l1 - l2) + 1e-3, (l1 + l2) * 0.9995);
        double[] W = { A[0] + dn[0] * dist, A[1] + dn[1] * dist, A[2] + dn[2] * dist };
        double a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
        double h = Math.Sqrt(Math.Max(0, l1 * l1 - a * a));
        var p = Norm(pole);
        double pd = Dot(p, dn);
        p = V3(p[0] - dn[0] * pd, p[1] - dn[1] * pd, p[2] - dn[2] * pd);
        if (Hypot(p[0], p[1], p[2]) < 1e-4) p = Norm(Cross(dn, V3(1, 0, 0))); else p = Norm(p);
        double[] E = { A[0] + dn[0] * a + p[0] * h, A[1] + dn[1] * a + p[1] * h, A[2] + dn[2] * a + p[2] * h };
        var n = Norm(Cross(dn, p));
        return (E, W, n);
    }

    /// world: character placement matrix (yaw + translation). Fills Skin (bone i at 16 i: world * local * T(-bind)).
    public void UpdateSkin(float[] world)
    {
        var m = M4(); var local = M4();
        for (int i = 0; i < N; i++)
        {
            var q = Rot[i]; var p = Pos[i]; var b = Bind[i];
            M4Compose(local, p, q);
            double bx = -b[0], by = -b[1], bz = -b[2];
            local[12] = (float)(local[12] + local[0] * bx + local[4] * by + local[8] * bz);
            local[13] = (float)(local[13] + local[1] * bx + local[5] * by + local[9] * bz);
            local[14] = (float)(local[14] + local[2] * bx + local[6] * by + local[10] * bz);
            M4Mul(m, world, local);
            Array.Copy(m, 0, Skin, i * 16, 16);
        }
    }

    public double[] JointWorld(float[] world, int bone, double[]? o = null)
    {
        o ??= new double[3]; var p = Pos[bone];
        o[0] = world[0] * p[0] + world[4] * p[1] + world[8] * p[2] + world[12];
        o[1] = world[1] * p[0] + world[5] * p[1] + world[9] * p[2] + world[13];
        o[2] = world[2] * p[0] + world[6] * p[1] + world[10] * p[2] + world[14];
        return o;
    }
}

/// athlete.js torsoTable: the torso cross-section by height fraction [rx, zf, zb, zc, e] (Catmull-Rom through TORSO).
public static class TorsoTable
{
    static readonly double[][] TORSO = {
        new[] { 0.452, 0.034, 0.018, 0.024, 0.006, 2.0 },
        new[] { 0.468, 0.074, 0.044, 0.060, 0.000, 2.2 },
        new[] { 0.495, 0.086, 0.051, 0.067, -0.002, 2.3 },
        new[] { 0.525, 0.088, 0.052, 0.063, 0.000, 2.3 },
        new[] { 0.555, 0.082, 0.051, 0.054, 0.003, 2.2 },
        new[] { 0.590, 0.075, 0.049, 0.048, 0.005, 2.2 },
        new[] { 0.630, 0.076, 0.052, 0.049, 0.005, 2.3 },
        new[] { 0.670, 0.085, 0.058, 0.054, 0.003, 2.4 },
        new[] { 0.705, 0.097, 0.065, 0.058, 0.001, 2.5 },
        new[] { 0.738, 0.103, 0.067, 0.061, -0.002, 2.6 },
        new[] { 0.768, 0.105, 0.065, 0.062, -0.005, 2.6 },
        new[] { 0.795, 0.108, 0.057, 0.060, -0.008, 2.5 },
        new[] { 0.815, 0.098, 0.047, 0.055, -0.010, 2.3 },
        new[] { 0.831, 0.070, 0.040, 0.046, -0.009, 2.1 },
        new[] { 0.845, 0.049, 0.035, 0.038, -0.006, 2.0 },
        new[] { 0.864, 0.036, 0.031, 0.031, -0.001, 2.0 },
        new[] { 0.888, 0.034, 0.030, 0.029, 0.004, 2.0 },
    };
    public static double[] At(double yf)
    {
        var T = TORSO;
        if (yf <= T[0][0]) return T[0][1..];
        for (int i = 1; i < T.Length; i++) if (yf <= T[i][0])
        {
            var a = T[i - 1]; var b = T[i]; double k = (yf - a[0]) / (b[0] - a[0]);
            var p0 = T[Math.Max(0, i - 2)]; var p3 = T[Math.Min(T.Length - 1, i + 1)];
            var o = new double[5];
            for (int j = 0; j < 5; j++)
            {
                double P0 = p0[j + 1], P1 = a[j + 1], P2 = b[j + 1], P3 = p3[j + 1], t = k, t2 = t * t, t3 = t2 * t;
                o[j] = 0.5 * ((2 * P1) + (-P0 + P2) * t + (2 * P0 - 5 * P1 + 4 * P2 - P3) * t2 + (-P0 + 3 * P1 - 3 * P2 + P3) * t3);
            }
            return o;
        }
        return T[T.Length - 1][1..];
    }
}
