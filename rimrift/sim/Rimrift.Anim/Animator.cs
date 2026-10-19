// Port of client/js/char/animator.js (v0.4.8.6): procedural animation driven by the simulation: velocity-matched gait
// with planted feet, stance blending, ball-hand IK, and timed action bodies (jumpshots, layups, dunks, passes, defence).
// Pure C#, fixed-step, no Godot. The pose vectors are float (Float32Array in the JS); everything else double.
//
// Port status (see STUBS at the bottom): the locomotion/stance/idle core, ball hands, the jump shot with every base
// and release, layups, the plain dunks, block/rebound reach, pass, steal, moves, size-ups, post bodies, stumbles,
// celebrations and the flip are ported. The Icon packages that live in their own modules (Big Brother blocks,
// the Clamp, Sexy Red, Oprah, Open Arms snags, Hash-Slinging dunks) and the thirty styled blocks are stubbed to
// their generic bodies.
using static Rimrift.Anim.AnimMath;
using static Rimrift.Anim.AnimTables;
namespace Rimrift.Anim;

public sealed partial class Animator
{
    public const double REACH_K = 0.96;
    public const double BALL_R = 0.1194, GRAVITY = 9.81;
    static readonly double CLAV_LIFT = Math.Asin(0.025 / 0.072);

    public readonly Rig Rig;
    public readonly AthleteModel Model;
    public readonly double H, S;
    public readonly float[] pose, target, outPose;
    float[]? poseVel;
    public double phase, time, lastFacing;
    public double leanF, leanS, prevVx, prevVz;
    sealed class Foot { public double wx = double.NaN, wz = double.NaN; public bool planted; public bool stepping; public double stepT, stepDur; public double[] stepFrom = new double[3]; }
    readonly Foot[] feet = { new(), new() };
    public double[] lookPt = { 0, 1.7, 3 };
    public readonly Palm?[] palm = { null, null };
    public double landX, landV, prevY, vyAir; bool wasAir;
    double boxW;
    AnimAction? lastShot; double lastShotT;
    public double x, y, z, f, xSpin;
    public double[]? look; public double lookW;
    public (double runK, double sprintK, double duty, double wGait, bool shuffle) gaitInfo;
    /// what the last update handed the rig (the view.update call in the JS)
    public double placeX, placeY, placeZ, placeYaw; public RigOpts lastOpts = new();
    public readonly List<string> StubsHit = new();

    public Animator(AthleteModel model)
    {
        Model = model; Rig = new Rig(model);
        H = model.D.H; S = H / 2;
        pose = Pose.Neutral(); target = Pose.NewPose(); outPose = Pose.NewPose();
    }
    public Animator(Build build) : this(new AthleteModel(build)) { }

    public void PalmOf(int side, Palm? p) => palm[side] = p;
    void Stub(string what) { if (!StubsHit.Contains(what)) StubsHit.Add(what); }

    /// local (character-space, metres) from world
    public double[] ToLocal(double wx, double wy, double wz, double[] o)
    {
        double c = JsMath.Cos(f), s = JsMath.Sin(f);
        double dx = wx - x, dz = wz - z;
        o[0] = c * dx - s * dz; o[1] = wy - y; o[2] = s * dx + c * dz;
        return o;
    }

    static double DunkSpin(AnimAction? a)
    {
        if (a == null || a.Type != "dunk" || !(a.Slam > 0)) return 0;
        double turn = a.Style == "360" || a.Style == "rev360" || a.Style == "spinmill" || a.Style == "helicopter" ? Math.PI * 2 : a.Style == "180" ? Math.PI : 0;
        if (turn == 0) return 0;
        double t0 = a.Takeoff + 0.03, t1 = a.Slam - (a.Style == "180" ? 0.12 : 0.06);
        double k = Math.Max(0, Math.Min(1, (a.T - t0) / Math.Max(0.1, t1 - t0)));
        return a.SpinDir * turn * k * k * k * (k * (k * 6 - 15) + 10);
    }
    public static int LayupHand(AnimAction a) => (a.Cov == "side" || a.Cov == "rim") && a.CovSide > 0 ? 0 : 1;
    public static int DunkHand(AnimAction a)
    {
        double q = a.T / Math.Max(0.1, a.Slam != 0 ? a.Slam : 1);
        double air = (a.T - a.Takeoff) / Math.Max(0.1, (a.Slam != 0 ? a.Slam : 1) - a.Takeoff);
        return (a.Style == "switch" && q > 0.57) || (a.Style == "eastbay" && air > 0.4) || (a.Style == "aroundback" && q > 0.5) || (a.Style == "behindhead" && q > 0.55) ? 0 : 1;
    }

    /// st: render-interpolated placement; p: sim player; g: game (or null); ball: render ball position (or null)
    public void Update(double dt, AnimState st, AnimPlayer p, AnimGame? g, double[]? ball, AnimExtra? extra = null)
    {
        extra ??= new AnimExtra();
        time += dt;
        x = st.X; y = st.Y; z = st.Z;
        xSpin = 0; // (blockSpin + clampSpin: Icon packages, stubbed)
        f = st.Facing + DunkSpin(p.Action) + 0 /* snagSpin */ + xSpin;
        double s = S;
        var T = target;
        Pose.Neutral(T);
        double c = JsMath.Cos(f), sn = JsMath.Sin(f);
        double vx = p.Vx, vz = p.Vz;
        double lvx = c * vx - sn * vz, lvz = sn * vx + c * vz;
        double speed = JsMath.Hypot(vx, vz);
        double ax = (vx - prevVx) / Math.Max(dt, 1e-3), az = (vz - prevVz) / Math.Max(dt, 1e-3);
        prevVx = vx; prevVz = vz;
        double lax = c * ax - sn * az, laz = sn * ax + c * az;
        leanF = Lerp(leanF, Math.Max(-6, Math.Min(8, laz)), 1 - JsMath.Exp(-dt * 6));
        leanS = Lerp(leanS, Math.Max(-8, Math.Min(8, lax)), 1 - JsMath.Exp(-dt * 6));
        var a = p.Action;
        bool has = g != null ? g.BallHolder == p.Id : extra.HasBall;
        string? bmode = g != null ? g.BallMode : extra.BallMode;
        bool defense = p.Stance == "defense";
        bool airborne = p.Airborne || st.Y - extra.FloorY > 0.02;
        {
            double vy = (st.Y - prevY) / Math.Max(dt, 1e-3);
            prevY = st.Y;
            if (airborne) vyAir = vy;
            else if (wasAir) { landV -= Math.Min(5.5, Math.Max(0, -vyAir)) * 1.7; vyAir = 0; }
            wasAir = airborne;
            double w = 13, zt = 0.72; int n = Math.Max(1, (int)Math.Ceiling(dt / (1.0 / 120))); double h = dt / n;
            for (int i = 0; i < n; i++) { landV += (-w * w * landX - 2 * zt * w * landV) * h; landX += landV * h; }
            if (landX < -0.2) { landX = -0.2; if (landV < 0) landV = 0; }
            if (airborne) { landX *= 0.8; landV = 0; }
        }
        // ---- locomotion & stance ----
        double runK = Sm(1.9, 3.1, speed), sprintK = Sm(5.0, 7.0, speed);
        bool shuffle = (defense || (has && bmode == "dribble" && speed < 3.4 && Math.Abs(lvx) > Math.Abs(lvz) * 0.9)) && speed < 4.5;
        double hs = H / 1.8;
        var MS = (p.MoveStyle != null && MOVE_GAIT.TryGetValue(p.MoveStyle, out var ms0)) ? ms0 : MOVE_GAIT["standard"]; double msK = defense ? 0.5 : 1;
        double stepM = Lerp(Math.Min(0.9, 0.26 + 0.33 * speed), 0.62 + 0.17 * speed, runK) * hs * MS.stride;
        double stride = shuffle ? Math.Min(0.72, 0.4 + speed * 0.12) : (2 * stepM) / s;
        double duty = shuffle ? 0.6 : Lerp(Lerp(0.62, 0.36, runK), 0.26, sprintK);
        double lift = (shuffle ? 0.07 : Lerp(0.11, 0.3, runK) + sprintK * 0.2) * MS.lift;
        double strideM = stride * s;
        phase = (phase + speed * dt / Math.Max(0.3, strideM)) % 1;
        double[] dirL = speed > 0.05 ? new[] { lvx / speed, lvz / speed } : new[] { 0.0, 1.0 };
        double wGait = Sm(0.18, 0.85, speed) * (airborne ? 0 : 1);
        gaitInfo = (runK, sprintK, duty, wGait, shuffle);
        double crouch = 0, stanceW = 0.125, stagger = 0;
        if (defense) { crouch = -0.2; stanceW = 0.3; }
        else if (has && bmode == "dribble") { crouch = -0.08 - (speed < 1 ? 0.04 : 0); stanceW = 0.19; stagger = 0.05; }
        else if (has) { crouch = -0.07; stanceW = 0.2; stagger = 0.08; }
        if (p.Stamina < 0.18 && !has && speed < 0.3 && !defense && a == null) crouch -= 0.05;
        bool screenK = !has && !defense && a == null && p.Screening > 0 && speed < 0.7;
        if (screenK) { crouch = -0.12; stanceW = 0.27; stagger = 0.02; }
        if (!defense) { crouch += MS.crouch; stanceW += MS.wide; }
        double[] restL = { stanceW, 0.08, stagger }, restR = { -stanceW, 0.08, -stagger };
        double hp = Lerp(0.85, 0.6, runK);
        double shift = shuffle ? 0 : 0.1 * runK * duty * stride;
        double[] GaitFoot(double side, double off)
        {
            double ph = (phase + off) % 1;
            double along, h = 0, pitch = 0, toe = 0;
            if (ph < duty)
            {
                double q = ph / duty;
                along = (0.5 - q) * duty * stride - shift;
                if (q < 0.15) pitch = -0.22 * (1 - runK) * (1 - q / 0.15);
                else if (q > 0.55) pitch = Sm(0.55, 1, q) * (0.35 + 0.3 * runK);
                toe = -Math.Max(0, pitch) * 0.95;
            }
            else
            {
                double q = (ph - duty) / (1 - duty), e = q * q * (3 - 2 * q);
                along = (-0.5 + e) * duty * stride - shift;
                h = JsMath.Sin(Math.PI * JsMath.Pow(q, hp)) * lift;
                pitch = Lerp(0.62, -0.15 * (1 - runK), Sm(0, 0.8, q)) * (0.4 + 0.6 * Math.Max(runK, 0.35));
            }
            double bse = shuffle ? (side > 0 ? 0.26 : -0.26) : side * (0.11 - runK * 0.025);
            double fx = bse + dirL[0] * along, fz = dirL[1] * along;
            if (!shuffle && Math.Abs(dirL[0]) > 0.5 && ph >= duty) fz += JsMath.Sin((ph - duty) / (1 - duty) * Math.PI) * 0.12 * Math.Abs(dirL[0]);
            return new[] { fx, 0.08 + h, fz, pitch, toe };
        }
        var gL = GaitFoot(1, 0); var gR = GaitFoot(-1, 0.5);
        double[][] idle = { restL, restR }; double[][] gaits = { gL, gR };
        var tmp = new double[3];
        for (int k = 0; k < 2; k++)
        {
            var F = feet[k];
            double side = k == 0 ? 1 : -1;
            double[] local;
            if (wGait > 0.5 || !F.planted || airborne)
            {
                var gl = wGait > 0.5 ? gaits[k] : idle[k];
                F.wx = x + (c * gl[0] * s + sn * gl[2] * s); F.wz = z + (-sn * gl[0] * s + c * gl[2] * s);
                F.planted = true; F.stepping = false;
                local = (double[])idle[k].Clone();
            }
            else
            {
                ToLocal(F.wx, 0, F.wz, tmp);
                local = new[] { tmp[0] / s, 0.08, tmp[2] / s };
                double dx = local[0] - idle[k][0], dz = local[2] - idle[k][2];
                double off = JsMath.Hypot(dx, dz);
                if (!F.stepping && off > (defense ? 0.16 : 0.2) && !feet[1 - k].stepping) { F.stepping = true; F.stepT = 0; F.stepFrom = (double[])local.Clone(); F.stepDur = 0.2; }
                if (F.stepping)
                {
                    F.stepT += dt;
                    double q = Math.Min(1, F.stepT / F.stepDur), e = q * q * (3 - 2 * q);
                    local = new[] { Lerp(F.stepFrom[0], idle[k][0], e), 0.08 + JsMath.Sin(q * Math.PI) * 0.07, Lerp(F.stepFrom[2], idle[k][2], e) };
                    if (q >= 1) { F.stepping = false; F.wx = x + (c * idle[k][0] * s + sn * idle[k][2] * s); F.wz = z + (-sn * idle[k][0] * s + c * idle[k][2] * s); }
                }
            }
            var g2 = gaits[k];
            double fx = Lerp(local[0], g2[0], wGait), fy = Lerp(local[1], g2[1], wGait), fz = Lerp(local[2], g2[2], wGait);
            Set3(T, k == 0 ? P.footL : P.footR, fx, fy, fz);
            Set(T, k == 0 ? P.pitchL : P.pitchR, g2[3] * wGait);
            Set(T, k == 0 ? P.toeL : P.toeR, g2[4] * wGait);
            Set(T, k == 0 ? P.yawL : P.yawR, side * (defense ? 18 : 8) * D + (shuffle ? 0 : Math.Atan2(dirL[0], Math.Max(0.3, Math.Abs(dirL[1]))) * 0.3 * wGait));
            if (defense) Set3(T, k == 0 ? P.kneeL : P.kneeR, side * 0.45, 0, 1);
        }
        double msph = duty / 2;
        double c2 = JsMath.Cos(4 * Math.PI * (phase - msph));
        double bobWalk = 0.035 * (c2 - 1) * 0.5, bobRun = -(0.075 - 0.025 * sprintK) * (0.5 + 0.5 * c2);
        double bob = wGait * (shuffle ? -0.012 * (0.5 + 0.5 * c2) : Lerp(bobWalk, bobRun, runK) - 0.02 * runK);
        Set(T, P.root + 1, crouch + bob - (shuffle ? 0.03 : 0) + wGait * MS.bounce * (0.5 + 0.5 * c2) * msK);
        double cs = JsMath.Cos(TAU * (phase - msph));
        Set(T, P.root, wGait * (1 - runK) * cs * 0.025);
        Set(T, P.pelvis + 1, -wGait * JsMath.Cos(phase * TAU) * (0.08 + 0.06 * runK));
        Set(T, P.chest + 1, -T[P.pelvis + 1] * 1.6 + wGait * MS.sway * JsMath.Cos(phase * TAU) * msK);
        double roll = shuffle ? 0 : wGait * cs * (0.06 + 0.02 * runK);
        Set(T, P.pelvis + 2, roll);
        double leanFw = (defense ? 0.32 : has ? 0.16 : 0.04) + runK * 0.06 + sprintK * 0.09 + Math.Max(-0.12, Math.Min(0.28, leanF * 0.035)) + MS.lean * msK;
        Set(T, P.spine, leanFw * 0.6); Set(T, P.chest, leanFw * 0.4 + MS.chest * msK);
        Set(T, P.spine + 2, -leanS * 0.02 - roll * 0.9);
        Set(T, P.chest + 2, -leanS * 0.012);
        Set(T, P.head, -leanFw * 0.5 + MS.head * msK + wGait * MS.nod * JsMath.Cos(4 * Math.PI * phase));
        Set(T, P.head + 2, MS.tilt * msK);
        double armAmp = wGait * (0.1 + 0.2 * runK + sprintK * 0.1) * MS.arms;
        double swL = -JsMath.Cos(phase * TAU) * armAmp, swR = -JsMath.Cos((phase + 0.5) * TAU) * armAmp;
        double armY = 1.0 + 0.06 * runK + 0.04 * sprintK + crouch * 0.85;
        double up = 0.4 + 0.5 * runK, back = 0.25 * runK;
        double armX = 0.26 + 0.02 * runK - crouch * 0.25 + MS.armOut;
        Set3(T, P.handL, armX - Math.Max(0, swL) * 0.15 * runK, armY + Math.Max(0, swL) * up + Math.Max(0, -swL) * back, 0.08 + swL - crouch * 0.4);
        Set3(T, P.handR, -armX + Math.Max(0, swR) * 0.15 * runK, armY + Math.Max(0, swR) * up + Math.Max(0, -swR) * back, 0.08 + swR - crouch * 0.4);
        if (crouch < -0.04) { Set3(T, P.elbowL, 0.5, -0.4, -0.8); Set3(T, P.elbowR, -0.5, -0.4, -0.8); }
        if (runK > 0.3) { Set3(T, P.elbowL, 0.2, -0.3, -1); Set3(T, P.elbowR, -0.2, -0.3, -1); }
        if (defense)
        {
            double w = JsMath.Sin(time * 7 + p.Id) * 0.03;
            Set3(T, P.handL, 0.5, 1.22 + w, 0.28); Set3(T, P.handR, -0.5, 1.22 - w, 0.28);
            Set3(T, P.elbowL, 0.8, -0.6, -0.4); Set3(T, P.elbowR, -0.8, -0.6, -0.4);
        }
        if (screenK) { Set3(T, P.handL, -0.07, 1.02, 0.2); Set3(T, P.handR, 0.07, 0.98, 0.23); Set3(T, P.elbowL, 0.6, -0.5, -0.1); Set3(T, P.elbowR, -0.6, -0.5, -0.1); }
        if (p.HandsUp && a == null) { double hw = JsMath.Sin(time * 4 + p.Id); Set3(T, P.handL, 0.22 + 0.03 * hw, 2.2 + 0.04 * hw, 0.22); Set3(T, P.handR, -0.2 + 0.03 * hw, 2.28 - 0.04 * hw, 0.24); Set3(T, P.elbowL, 0.7, -0.1, -0.5); Set3(T, P.elbowR, -0.7, -0.1, -0.5); }
        else if (p.ContestHand != null && a == null)
        {
            int hd = SideOf(p.ContestHand), od = Off(hd); double sg = Sgn(hd);
            Set3(T, P.Hand(hd), sg * 0.12, 2.34, 0.36); Set3(T, P.Elbow(hd), sg * 0.6, -0.1, -0.4);
            Set3(T, P.Hand(od), -sg * 0.62, 1.1, 0.18); Set3(T, P.Elbow(od), -sg * 0.9, -0.4, -0.3);
        }
        else if (p.HandsSide != null && a == null)
        {
            double c0 = JsMath.Cos(f), s0 = JsMath.Sin(f), lxs = p.HandsSide[0] * c0 - p.HandsSide[1] * s0;
            int hd = lxs >= 0 ? 0 : 1; double sg = Sgn(hd);
            Set3(T, P.Hand(hd), sg * 0.72, 1.3, 0.3); Set3(T, P.Elbow(hd), sg * 1, -0.2, -0.3);
        }
        boxW = Lerp(boxW, (p.BoxOut ? 1 : p.BoxedOut ? -1 : 0), 1 - JsMath.Exp(-dt * 10));
        double bw = boxW;
        if (bw > 0.02 && a == null && !airborne)
        {
            Sub(T, P.root + 1, 0.13 * bw); Add(T, P.spine, (0.3 - T[P.spine]) * bw); Add(T, P.chest, (0.1 - T[P.chest]) * bw); Add(T, P.head, (-0.26 - T[P.head]) * bw);
            Mix3(T, P.footL, 0.35, 0.08, 0.02, bw); Mix3(T, P.footR, -0.35, 0.08, 0.02, bw);
            Mix3(T, P.handL, 0.66, 1.18, -0.08, bw); Mix3(T, P.handR, -0.66, 1.18, -0.08, bw);
            Mix3(T, P.elbowL, 1, -0.2, -0.4, bw); Mix3(T, P.elbowR, -1, -0.2, -0.4, bw);
        }
        else if (bw < -0.02 && a == null && !airborne)
        {
            double w2 = -bw, reach = 0.5 + 0.5 * JsMath.Sin(time * 3 + p.Id);
            Add(T, P.spine, (0.24 - T[P.spine]) * w2); Add(T, P.chest, (0.12 - T[P.chest]) * w2); Sub(T, P.root + 1, 0.04 * w2);
            Mix3(T, P.handL, 0.2, 1.22, 0.42, w2); Mix3(T, P.handR, -0.24, 1.75 + 0.4 * reach, 0.42, w2);
            Mix3(T, P.elbowL, 0.6, -0.4, -0.5, w2); Mix3(T, P.elbowR, -0.5, 0, -0.5, w2);
        }
        if (a == null && !airborne)
        {
            double still = 1 - Sm(0.2, 1.2, speed), br = time * (1.5 + (1 - p.Stamina) * 1.6) + p.Id;
            Sub(T, P.chest, 0.014 * JsMath.Sin(br) * still); Add(T, P.clavL + 2, 0.012 * JsMath.Sin(br) * still); Sub(T, P.clavR + 2, 0.012 * JsMath.Sin(br) * still);
            double ws = JsMath.Sin(time * 0.42 + p.Id * 1.7) * still * (defense ? 0.3 : 1);
            Add(T, P.root, 0.014 * ws); Add(T, P.pelvis + 2, 0.03 * ws); Sub(T, P.spine + 2, 0.02 * ws); Add(T, P.head + 2, 0.015 * ws);
        }
        if (p.Stamina < 0.12 && !has && speed < 0.25 && !defense && a == null)
        {
            Set(T, P.spine, 0.55); Set(T, P.chest, 0.25); Set(T, P.root + 1, -0.1);
            Set3(T, P.handL, 0.15, 0.62, 0.28); Set3(T, P.handR, -0.15, 0.62, 0.28);
        }
        if (has && bmode == "dribble" && speed < 1.2 && a == null && (p.SizeupLvl > 0 || (p.SizeupStyle != null && p.SizeupStyle != "basic"))) SizeupBody(T, p);
        // post bodies (v0.4.8.5: Sexy Red's are the Icon's own module: stubbed; the package back-downs are ported)
        string? postBody = p.Posting > 0 && has && a == null ? PostPackageBody(p) : null;
        if (postBody == "red") Stub("redBackdown (char/redpose.js)");
        if (postBody != null && postBody != "red")
        {
            bool bully = postBody == "bully", quick = postBody == "quick", backing = p.Backing > 0;
            double w2 = time * (bully ? 4.2 : quick ? 4.8 : 3) + p.Id;
            Sub(T, P.root + 1, bully ? 0.11 : quick ? 0.08 : 0.07);
            Set(T, P.spine, (bully ? -0.2 : -0.12) - (backing ? 0.08 : 0.05) * JsMath.Sin(w2));
            Set(T, P.chest, bully ? -0.1 : -0.05);
            Set3(T, P.footL, bully ? 0.3 : 0.24, 0.08, -0.08 + (backing ? 0.04 * JsMath.Sin(w2) : 0)); Set3(T, P.footR, bully ? -0.3 : -0.24, 0.08, -0.14 - (backing ? 0.04 * JsMath.Sin(w2) : 0));
            Set3(T, P.kneeL, 0.4, 0, 1); Set3(T, P.kneeR, -0.4, 0, 1);
            if (bully || backing) { Set(T, P.chest + 1, JsMath.Sin(w2) * (bully ? 0.26 : 0.14)); Set(T, P.pelvis + 2, JsMath.Sin(w2 * 0.5) * 0.1); Set(T, P.head + 1, -JsMath.Sin(w2) * 0.2); }
            if (quick) Set(T, P.head + 1, JsMath.Sin(w2 * 0.6) * 0.5);
        }
        // ---- actions ----
        palm[0] = null; palm[1] = null;
        double[] lb = { 0, 0, 0 };
        if (ball != null) ToLocal(ball[0], ball[1], ball[2], lb);
        double[] lbs = { lb[0] / s, lb[1] / s, lb[2] / s };
        double[]? lk = null; double lkW = 0.6;
        if (ball != null) lk = new[] { lb[0], lb[1], lb[2] };
        var rim = g?.Rim;
        if (a != null) ActionPose(T, a, p, g, lbs, lb, rim);
        if (a != null && a.Type == "shoot" && a.Released) { lastShot = a; lastShotT = a.T; }
        else if (a != null || has) lastShot = null;
        else if (lastShot != null)
        {
            lastShotT += dt;
            var ls = lastShot; string st2 = ls.Kind == "close" ? "standard" : (p.ShotPkg?.Style ?? "standard");
            if (FollowThrough(T, ls, p, lastShotT, st2, false)) lastShot = null;
        }
        // ---- ball hands ----
        if (has && ball != null && !(a != null && a.Type == "hang")) BallHands(T, p, g, a, lbs, bmode);
        else if (ball != null && !has && g != null && g.BallMode == "flight")
        {
            double dist = JsMath.Hypot(lb[0], lb[1] - 1.3 * s, lb[2]);
            bool coming = g.BallKind == "pass" && g.PassTo == p.Id;
            if ((coming && dist < 2.4) || (dist < 0.9 && (a?.Type == "rebound" || a?.Type == "block" || a?.Type == "catch")))
            {
                double w = coming ? Sm(2.4, 0.8, dist) : 1;
                Mix3(T, P.handL, lbs[0] + 0.14, lbs[1] - 0.02, lbs[2] - 0.05, w);
                Mix3(T, P.handR, lbs[0] - 0.14, lbs[1] - 0.02, lbs[2] - 0.05, w);
                palm[0] = new Palm(new[] { -1, 0, 0.2 }, new[] { 0, 0.8, 0.6 }, w * 0.8);
                palm[1] = new Palm(new[] { 1, 0, 0.2 }, new[] { 0, 0.8, 0.6 }, w * 0.8);
            }
        }
        if (p.ClampFx != null || (a != null && a.Clamp)) Stub("clampOverlay (char/clamp.js)");
        // look target
        if (rim != null && a != null && (a.Type == "shoot" || a.Type == "layup" || a.Type == "dunk" || a.Type == "ftshot")) { ToLocal(rim[0], rim[1], rim[2], tmp); lk = (double[])tmp.Clone(); lkW = 0.9; }
        else if (defense && g != null) { var hpos = g.HolderPos; if (hpos != null) { ToLocal(hpos[0], 1.4, hpos[1], tmp); lk = (double[])tmp.Clone(); lkW = 0.8; } }
        else if (has && g != null && rim != null && bmode == "dribble") { ToLocal(rim[0], 1.8, rim[2], tmp); lk = (double[])tmp.Clone(); lkW = 0.5; }
        if (extra.Look != null) { ToLocal(extra.Look[0], extra.Look[1], extra.Look[2], tmp); lk = (double[])tmp.Clone(); lkW = 0.8; }
        if (a != null && a.Type == "snag") lkW = Math.Min(lkW, 0.2);
        // ---- smoothing ----
        var o = pose;
        double kFast = 1 - JsMath.Exp(-dt * 26), kSlow = 1 - JsMath.Exp(-dt * 12);
        var raw = RawGroups(has, a, airborne);
        bool athletic = (a != null && (a.Type == "shoot" || a.Type == "ftshot" || a.Type == "layup" || a.Type == "dunk" || a.Type == "block" || a.Type == "rebound" || a.Type == "tipjump" || a.Type == "flip" || a.Type == "snag" || (a.Type == "pass" && a.Op) || (a.Type == "steal" && a.Clamp))) || p.ClampFx != null;
        var vel = poseVel ??= new float[o.Length];
        double wS = 15; int nS = Math.Min(4, Math.Max(1, (int)Math.Ceiling(dt * 60 - 1e-6))); double dtS = Math.Min(dt, 1.0 / 15) / nS;
        for (int gi = 0; gi < P.GROUPS.Length; gi++)
        {
            string g2 = P.GROUPS[gi]; int og = P.OFFSET[gi], n = P.GROUP_SIZE[gi];
            bool styledBlock = a != null && ((((a.Type == "block" && a.BStyle != null) || a.Type == "snag" || (a.Type == "steal" && a.Clamp)) && (g2.StartsWith("hand") || g2.StartsWith("elbow"))) || (a.Type == "snag" && (g2 == "head" || g2 == "neck")));
            double k = raw.Contains(g2) ? 1 : (g2.StartsWith("foot") || g2.StartsWith("pitch") || g2.StartsWith("toe") || g2.StartsWith("yaw")) ? (wGait > 0.5 ? 1 : kFast) : (athletic && (g2 == "root" || g2 == "spine" || g2 == "chest" || g2.StartsWith("knee"))) || styledBlock ? kFast : kSlow;
            if (k == kSlow && !athletic)
            {
                double w = g2 == "head" || g2 == "neck" ? wS * 0.85 : wS;
                for (int i = 0; i < n; i++) { int j = og + i; for (int s2 = 0; s2 < nS; s2++) { vel[j] = (float)(vel[j] + (w * w * (T[j] - o[j]) - 2 * w * vel[j]) * dtS); o[j] = (float)(o[j] + vel[j] * dtS); } }
            }
            else
            {
                for (int i = 0; i < n; i++) { int j = og + i; float prev = o[j]; o[j] = (float)(o[j] + (T[j] - o[j]) * k); vel[j] = (float)((o[j] - prev) / Math.Max(dt, 1e-4)); }
            }
        }
        look = lk; lookW = lkW;
        var fin = outPose;
        Array.Copy(o, fin, P.N);
        double lx = landX;
        if (lx < -1e-4) { Add(fin, P.root + 1, lx); Sub(fin, P.spine, lx * 0.9); Sub(fin, P.chest, lx * 0.3); Add(fin, P.head, lx * 0.5); }
        ClearBody(fin);
        // (clearOthers: the other players' bodies: needs the game's players; the showroom has none)
        placeX = st.X; placeY = st.Y; placeZ = st.Z;
        placeYaw = a?.Type == "snag" || xSpin != 0 ? f : st.Facing;
        lastOpts = new RigOpts { Look = lk, LookW = lkW, PalmL = palm[0], PalmR = palm[1], PinL = raw.Contains("handL"), PinR = raw.Contains("handR"), Flip = a?.Type == "flip" ? FlipAngle(a) : 0, FlipY = 0.52 };
        Rig.Solve(fin, lastOpts);
    }

    public static double FlipAir(AnimAction a) => 2 * Math.Sqrt(2 * (a.H != 0 ? a.H : 0.7) / GRAVITY);
    public static double FlipAngle(AnimAction? a) => a != null && a.Jumped ? -2 * Math.PI * Sm(0, 0.9, (a.T - (a.Takeoff != 0 ? a.Takeoff : 0.16)) / FlipAir(a)) : 0;

    static string? PostPackageBody(AnimPlayer p) => null; // (sim/post.js postPackageOf: the sim port's; none in the spike)

    /// v0.4.2 anti-clipping: hand targets outside an elliptic torso/hip column
    void ClearBody(float[] fp)
    {
        double g = Model.D.Girth != 0 ? Model.D.Girth : 1;
        double root = fp[P.root + 1], lean = fp[P.spine] + fp[P.chest] * 0.6;
        foreach (int o in new[] { P.handL, P.handR })
        {
            double side = o == P.handL ? 1 : -1;
            double by = fp[o + 1] - root;
            if (by < 0.62 || by > 1.66) continue;
            bool hips = by < 1.05, chest = by > 1.42;
            double rx = (hips ? 0.235 : chest ? 0.225 : 0.215) * g, rz = (hips ? 0.15 : chest ? 0.15 : 0.145) * g;
            double zc = Math.Max(0, by - 0.9) * JsMath.Sin(lean) * 0.9 + (hips ? -0.01 : 0.01);
            double ex = fp[o] / rx, ez = (fp[o + 2] - zc) / rz, e = JsMath.Hypot(ex, ez);
            if (e >= 1) continue;
            if (e < 0.15) { fp[o] = (float)(side * rx); continue; }
            fp[o] = (float)(fp[o] * (1 / e)); fp[o + 2] = (float)(zc + (fp[o + 2] - zc) / e);
        }
    }

    HashSet<string> RawGroups(bool has, AnimAction? a, bool airborne)
    {
        var set = new HashSet<string>();
        if (has) { set.Add("handL"); set.Add("handR"); }
        if (a != null && a.Type == "hang") { set.Add("handL"); set.Add("handR"); }
        if (a != null && a.Type == "pass" && a.Op) { set.Add("handL"); set.Add("handR"); }
        return set;
    }

    void LiftShoulder(float[] T, int side, double by)
    {
        double k = Sm(1.9, 2.4, by), sg = Sgn(side);
        Add(T, P.Clav(side) + 2, sg * CLAV_LIFT * k);
    }

    /// a hand target pulled in to REACH_K of the arm's length from its shoulder (reference units)
    public void ClampReach(float[] T, int side)
    {
        var d = Model.D; double k = 2 / H;
        double sx = Sgn(side) * d.ShoulderX * k, sy = (d.HipY + d.SpineLen + d.ChestLen + d.ClavY) * k, sz = -0.012 * H * k;
        double reach = (d.UpperLen + d.ForeLen + 0.5 * d.HandLen) * k * REACH_K;
        int i = P.Hand(side); double dx = T[i] - sx, dy = T[i + 1] - sy, dz = T[i + 2] - sz, dd = JsMath.Hypot(dx, dy, dz);
        if (dd <= reach || dd < 1e-6) return;
        double fct = reach / dd; Set(T, i, sx + dx * fct); Set(T, i + 1, sy + dy * fct); Set(T, i + 2, sz + dz * fct);
    }

    /// Hand targets for whoever is holding/dribbling the ball (positions in reference units)
    void BallHands(float[] T, AnimPlayer p, AnimGame? g, AnimAction? a, double[] b, string? mode)
    {
        if (a != null && a.Type == "snag") { Stub("snagHands (Open Arms)"); return; }
        double r = BALL_R / S;
        int shootHand = SideOf(p.ShotPkg?.Hand ?? "R");
        if (a != null && (a.Type == "shoot" || a.Type == "ftshot" || a.Type == "pumpfake"))
        {
            if (a.Released) return;
            int sh = shootHand, gh = Off(sh);
            Set3(T, P.Hand(sh), b[0] + Sgn(sh) * 0.02, b[1] - r - 0.07, b[2] - 0.06);
            string est = a.Type == "shoot" && a.Kind != "close" ? (p.ShotPkg?.Style ?? "standard") : "standard";
            Set3(T, P.Elbow(sh), Sgn(sh) * (est == "push" ? 0.6 : est == "high" ? 0.04 : 0.15), -1, 0.5);
            palm[sh] = new Palm(new[] { 0, 0.85, 0.5 }, new[] { 0, 0.75, -0.6 }, 0.9);
            LiftShoulder(T, sh, b[1]);
            if (a.Post == "hook")
            {
                Set3(T, P.Hand(gh), Sgn(gh) * 0.55, 1.35, 0.16); Set3(T, P.Elbow(gh), Sgn(gh) * 1, -0.2, -0.3);
                palm[gh] = new Palm(new[] { Sgn(gh), 0, 0.3 }, new[] { 0, 1.0, 0 }, 0.8);
                Set3(T, P.Elbow(sh), Sgn(sh) * 0.9, -0.2, -0.2);
                palm[sh] = new Palm(new[] { -Sgn(sh) * 0.5, 0.8, 0.2 }, new[] { 0, 0.6, -0.7 }, 0.9);
                return;
            }
            Set3(T, P.Hand(gh), b[0] + Sgn(gh) * (r + 0.075), b[1] - 0.04, b[2] - 0.06);
            Set3(T, P.Elbow(gh), Sgn(gh) * 1, -0.4, 0.1);
            palm[gh] = new Palm(new[] { -Sgn(gh), 0.1, 0.1 }, new[] { 0, 0.9, 0.3 }, 0.85);
            return;
        }
        if (a != null && (a.Type == "layup" || a.Type == "dunk"))
        {
            bool one = (a.Type == "layup" && a.LStyle != "hop") || ONE_HAND_DUNK.Contains(a.Style ?? "");
            int sh = a.Type == "dunk" ? DunkHand(a) : LayupHand(a), oh = Off(sh); double sg = Sgn(sh);
            Set3(T, P.Hand(sh), b[0] + sg * 0.02, b[1] - r - 0.07, b[2] - 0.06);
            palm[sh] = new Palm(new[] { 0, 0.8, 0.55 }, new[] { 0, 0.8, -0.5 }, 0.85);
            if (a.Type == "layup") LiftShoulder(T, sh, b[1]);
            Set3(T, P.Elbow(sh), sg * 0.4, -1, 0.3);
            if (!one || (a.Type == "dunk" && a.T < a.Takeoff * 0.8) || (a.Type == "layup" && a.T < a.Takeoff))
            {
                Set3(T, P.Hand(oh), b[0] - sg * (r + 0.075), b[1] - 0.03, b[2] - 0.05);
                palm[oh] = new Palm(new[] { sg, 0.1, 0.1 }, new[] { 0, 0.9, 0.3 }, 0.85);
            }
            return;
        }
        if (a != null && a.Type == "pass" && a.Op && !a.Released) { Stub("oprahHands"); return; }
        if (a != null && a.Type == "pass" && !a.Released)
        {
            Set3(T, P.handL, b[0] + r + 0.07, b[1] - 0.03, b[2] - 0.08);
            Set3(T, P.handR, b[0] - r - 0.07, b[1] - 0.03, b[2] - 0.08);
            palm[0] = new Palm(new[] { -1, 0, 0.25 }, new[] { 0, 0.6, 0.8 }, 0.85);
            palm[1] = new Palm(new[] { 1, 0, 0.25 }, new[] { 0, 0.6, 0.8 }, 0.85);
            Set3(T, P.elbowL, 0.8, -0.6, -0.5); Set3(T, P.elbowR, -0.8, -0.6, -0.5);
            return;
        }
        if (mode == "dribble")
        {
            int hand = SideOf(p.Dribble.Hand), other = Off(hand);
            double pocket = 0.92;
            double top = b[1] + r + 0.02;
            double hy = Math.Max(top, pocket - 0.2);
            string? mvA = p.Action?.Type == "move" ? p.Action.Move : null; bool cross = mvA == "btb" || mvA == "wrap" || mvA == "btl" || mvA == "btlback";
            Set3(T, P.Hand(hand), cross ? Sgn(hand) * Math.Max(Sgn(hand) * b[0], 0.25) : b[0] - Sgn(hand) * 0.0, hy, cross ? Math.Max(b[2] - 0.06, -0.12) : b[2] - 0.06);
            Set3(T, P.Elbow(hand), Sgn(hand) * 0.6, -0.3, -0.8);
            palm[hand] = new Palm(new[] { 0, -1, 0.15 }, new[] { -Sgn(hand) * 0.2, -0.25, 1 }, Sm(pocket - 0.05, pocket - 0.25, hy) * 0.5 + 0.4);
            bool near = g != null && g.OpponentNear;
            if (near) { Set3(T, P.Hand(other), Sgn(other) * 0.36, 1.18, 0.36); Set3(T, P.Elbow(other), Sgn(other) * 0.9, -0.5, -0.2); }
            else { Set3(T, P.Hand(other), Sgn(other) * 0.32, 0.98, 0.2); Set3(T, P.Elbow(other), Sgn(other) * 0.7, -0.5, -0.5); }
            if (p.Action?.Type == "move")
            {
                string? mv = p.Action.Move;
                if (mv == "cross" || mv == "btl" || mv == "btb" || mv == "inout" || mv == "hang" || mv == "wrap" || mv == "pushcross" || mv == "btlback")
                {
                    double k = JsMath.Sin(Math.Min(1, p.Action.T / p.Action.Dur) * Math.PI);
                    double ox = mv == "btb" || mv == "wrap" || mv == "btl" || mv == "btlback" ? Sgn(other) * Math.Max(Sgn(other) * (b[0] + Sgn(other) * 0.06), 0.25) : b[0] + Sgn(other) * 0.06;
                    Mix3(T, P.Hand(other), ox, Math.Max(top, 0.7), mv == "btb" || mv == "wrap" ? Math.Max(b[2] - 0.05, -0.12) : b[2] - 0.05, k * (b[0] * Sgn(other) > -0.05 ? 1 : 0.5));
                }
            }
            else if (p.Dribble.Xover != null && p.Dribble.Xover != "half" && p.Dribble.Xover != "hesi")
            {
                double ph = p.Dribble.Phase;
                Mix3(T, P.Hand(hand), Sgn(hand) * 0.3, 0.98, 0.2, Sm(0.3, 0.55, ph));
                Mix3(T, P.Hand(other), b[0], Math.Max(top, 0.55), b[2] - 0.05, Sm(0.5, 0.9, ph));
            }
            return;
        }
        Set3(T, P.handL, b[0] + r + 0.075, b[1] - 0.03, b[2] - 0.07);
        Set3(T, P.handR, b[0] - r - 0.075, b[1] - 0.03, b[2] - 0.07);
        Set3(T, P.elbowL, 0.9, -0.7, -0.4); Set3(T, P.elbowR, -0.9, -0.7, -0.4);
        palm[0] = new Palm(new[] { -1, 0.05, 0.2 }, new[] { 0, 0.75, 0.65 }, 0.85);
        palm[1] = new Palm(new[] { 1, 0.05, 0.2 }, new[] { 0, 0.75, 0.65 }, 0.85);
    }

    /// the jump-shot follow-through; returns true once the hold is over
    bool FollowThrough(float[] T, AnimAction a, AnimPlayer p, double t, string style, bool inAction)
    {
        double s = S, tR = a.TRel != 0 ? a.TRel : 0.6;
        string relS = p.ShotPkg?.Release ?? "classic";
        int sh = SideOf(p.ShotPkg?.Hand ?? "R"); double sg = Sgn(sh);
        int gh = Off(sh);
        var F = FOLLOW.TryGetValue(relS, out var f0) ? f0 : FOLLOW["classic"];
        double since = t - (a.HasReleaseAt ? a.ReleaseAt : tR);
        double k = Math.Min(1, since / F.k);
        double relY = (p.Phys.Reach * (p.ShotPkg?.RelK ?? 0.93)) / s;
        Set3(T, P.Hand(sh), sg * 0.05, relY + F.y - (1 - k) * 0.03, 0.36 + k * (F.z - 0.36));
        Set3(T, P.Elbow(sh), sg * (style == "push" ? 0.45 : 0.1), -0.6, 0.6);
        palm[sh] = new Palm(new[] { 0, -0.45, 0.9 }, new[] { 0, F.f, 0.6 }, 0.9);
        Set3(T, P.Hand(gh), -sg * (F.gx != 0 ? F.gx : 0.26), relY - 0.14 - k * 0.12, 0.28);
        Set3(T, P.Elbow(gh), -sg * 0.6, -0.6, 0.45);
        int H2 = P.Hand(sh), G2 = P.Hand(gh);
        if (relS == "quick") { Set3(T, P.Elbow(sh), sg * 0.55, -0.9, 0.3); Set3(T, G2, -sg * 0.3, relY - 0.14 - k * 0.6, 0.22); }
        else if (relS == "high") { Set3(T, G2, -sg * 0.17, relY - 0.05, 0.24); palm[gh] = new Palm(new[] { sg, 0, 0.2 }, new[] { 0, 1.0, 0 }, 0.8); }
        else if (relS == "snap") { double q = Math.Min(1, Math.Max(0, since - F.k) / 0.12); Add(T, H2 + 1, 0.03 * q); Sub(T, H2 + 2, 0.17 * q); Add(T, P.head, -0.06 * q); }
        else if (relS == "float") { double d = Math.Min(1, since / F.hold); Sub(T, H2 + 1, 0.46 * d * d); Add(T, H2 + 2, 0.16 * d); Set3(T, G2, -sg * 0.26, relY - 0.17, 0.28); }
        else if (relS == "butter")
        {
            double ph = since * 5.5;
            Add(T, H2, sg * 0.07 * (JsMath.Cos(ph) - 1)); Add(T, H2 + 1, 0.06 * JsMath.Sin(ph));
            palm[sh] = new Palm(new[] { 0, -0.45, 0.9 }, new[] { sg * 0.3 * JsMath.Sin(ph), F.f, 0.6 }, 0.9);
            Set3(T, G2, -sg * 0.26, relY - 0.14 - 0.34 * Math.Min(1, since / F.hold), 0.28);
        }
        else if (relS == "feather") { Set3(T, G2, -sg * 0.44, relY - 0.05, 0.2); Set3(T, P.Elbow(gh), -sg * 1, -0.2, 0.1); palm[gh] = new Palm(new[] { 0, 0, 1.0 }, new[] { -sg * 0.3, 1, 0 }, 0.8); }
        else if (relS == "dart") { Set3(T, P.Elbow(sh), sg * 0.05, -0.25, 1); Set3(T, G2, -sg * 0.16, 1.42, 0.3); Set3(T, P.Elbow(gh), -sg * 0.7, -1, 0); }
        else if (relS == "rainbow") { double d = Math.Min(1, since / 0.6); Set3(T, H2, sg * 0.05, relY + F.y + 0.1 * JsMath.Sin(Math.PI * d) - 0.12 * d, F.z + 0.36 * d); }
        else if (relS == "laser")
        {
            double q = Math.Min(1, Math.Max(0, since - 0.06) / 0.14);
            Set3(T, G2, -sg * (0.26 - 0.22 * q), relY - 0.14 - 0.12 * k + q * (1.92 - (relY - 0.26)), 0.28 - 0.1 * q);
            Set3(T, P.Elbow(gh), -sg * 1, 0.1, 0.1); palm[gh] = new Palm(new[] { 0, -1, 0.1 }, new[] { sg * 1, 0, 0.25 }, 0.85 * q);
        }
        else if (relS == "wave") { double w = JsMath.Sin(since * 9); Add(T, H2, sg * 0.04 * w); palm[sh] = new Palm(new[] { 0, -0.45, 0.9 }, new[] { 0.25 * w, F.f, 0.6 }, 0.9); }
        else if (relS == "hold") { Set3(T, G2, -sg * 0.27, 1.04, 0.12); Set3(T, P.Elbow(gh), -sg * 0.35, -1, -0.25); palm[gh] = null; }
        else if (relS == "snatch" && since > F.k) { double q = Math.Min(1, (since - F.k) / 0.14); Set3(T, H2, sg * (0.05 + 0.2 * q), relY - q * 0.72, 0.36 - q * 0.1); Set3(T, P.Elbow(sh), sg * 0.6, -1, -0.2); }
        else if (relS == "twohand") { Set3(T, G2, -sg * 0.12, relY + F.y - 0.02, 0.34 + k * 0.08); Set3(T, P.Elbow(gh), -sg * 0.2, -0.6, 0.6); palm[gh] = new Palm(new[] { 0, -0.4, 0.9 }, new[] { 0, -0.7, 0.6 }, 0.85); }
        else if (relS == "point" && since > 0.26) { double q = Math.Min(1, (since - 0.26) / 0.16); Set3(T, H2, sg * (0.05 - 0.05 * q), relY + F.y - q * 0.22, 0.36 + q * 0.3); palm[sh] = new Palm(new[] { 0, -0.2, 1 }, new[] { 0, -0.3, 1 }, 0.9); }
        else if (relS == "cobra") { Set3(T, P.Elbow(sh), sg * 0.02, -0.2, 0.8); Set(T, P.head, -0.22); }
        else if (RELEASE2.TryGetValue(relS, out var fn)) fn(T, since, k, relY, sh, sg, gh, H2, G2, F, this);
        double hold = (a.HasReleaseAt ? a.ReleaseAt : tR) + (p.Airborne && !F.air ? 9 : F.hold);
        if (t > hold)
        {
            if (!inAction) return true;
            Set3(T, P.Hand(sh), sg * 0.27, 1.02, 0.12); Set3(T, P.Hand(gh), -sg * 0.27, 1.02, 0.12);
            Set3(T, P.Elbow(sh), sg * 0.35, -1, -0.25); Set3(T, P.Elbow(gh), -sg * 0.35, -1, -0.25);
            palm[sh] = null; palm[gh] = null;
        }
        return t > hold;
    }

    void SizeupBody(float[] T, AnimPlayer p)
    {
        double lvl = p.SizeupLvl, w = time * (5 + lvl * 1.8) + p.Id;
        Sub(T, P.root + 1, 0.035 * lvl);
        Add(T, P.chest + 1, JsMath.Sin(w) * 0.08 * lvl);
        Add(T, P.spine + 2, JsMath.Sin(w * 0.5) * 0.05 * lvl);
        Add(T, P.head, JsMath.Sin(w + 1.3) * 0.035 * lvl);
        string? su = p.SizeupStyle; double dph = p.Dribble.Phase;
        switch (su)
        {
            case "pound": Sub(T, P.root + 1, 0.05); Add(T, P.spine, 0.12); Add(T, P.head, JsMath.Sin(w * 0.9) * 0.08); Set3(T, P.footL, 0.2, 0.08, 0.04); Set3(T, P.footR, -0.2, 0.08, -0.02); break;
            case "crab": Sub(T, P.root + 1, 0.07); Set3(T, P.footL, 0.32, 0.08, 0.02); Set3(T, P.footR, -0.32, 0.08, 0.02); Set3(T, P.kneeL, 0.42, 0, 1); Set3(T, P.kneeR, -0.42, 0, 1); Add(T, P.root, JsMath.Sin(w * 0.45) * 0.05); break;
            case "snake": { double sn = JsMath.Sin(w * 0.7); Set(T, P.pelvis + 2, sn * 0.14); Add(T, P.spine + 2, -sn * 0.1); Add(T, P.root, sn * 0.06); Sub(T, P.root + 1, 0.04); break; }
            case "stutter": { double ch = JsMath.Sin(w * 2.1); Add(T, P.root + 1, Math.Abs(ch) * 0.025 - 0.03); Set3(T, P.footL, 0.17, 0.08 + Math.Max(0, ch) * 0.07, 0.06); Set3(T, P.footR, -0.17, 0.08 + Math.Max(0, -ch) * 0.07, 0.0); break; }
            case "rhythm": Sub(T, P.root + 1, 0.02 - 0.03 * Math.Abs(JsMath.Sin(Math.PI * dph))); Add(T, P.chest + 1, JsMath.Sin(w * 0.55) * 0.1); Set(T, P.head + 2, JsMath.Sin(w * 0.55) * 0.08); break;
            case "quick": Sub(T, P.root + 1, 0.045); Set3(T, P.footL, 0.19, 0.08, 0.06); Set3(T, P.footR, -0.19, 0.08, -0.02); Add(T, P.head, JsMath.Sin(w * 1.3) * 0.05); break;
            case "elite": { double e2 = JsMath.Sin(w * 0.9); Sub(T, P.root + 1, 0.06); Add(T, P.spine + 2, e2 * 0.1); Add(T, P.chest + 1, e2 * 0.18); Add(T, P.root, e2 * 0.04); break; }
            case "ankle": { double an = JsMath.Sin(w * 1.1); Sub(T, P.root + 1, 0.085); Add(T, P.chest + 1, an * 0.22); Set(T, P.head + 1, -an * 0.26); Set3(T, P.footL, 0.26, 0.08 + Math.Max(0, an) * 0.05, 0.08); Set3(T, P.footR, -0.26, 0.08, -0.04); break; }
            case "showtime": { double sh2 = JsMath.Sin(w * 0.8); Add(T, P.chest + 1, sh2 * 0.16); Add(T, P.head, JsMath.Sin(w * 0.8 + 1.9) * 0.1); Set(T, P.head + 1, -sh2 * 0.3); Sub(T, P.root + 1, 0.05); Add(T, P.spine + 2, sh2 * 0.08); break; }
            case "yoyo": Add(T, P.root + 1, 0.02); Sub(T, P.spine, 0.06); Add(T, P.head, JsMath.Sin(Math.PI * 2 * dph) * 0.08); Set3(T, P.footL, 0.14, 0.08, 0.03); Set3(T, P.footR, -0.14, 0.08, 0.0); break;
            case "rocker": { double rk2 = JsMath.Sin(w * 0.75); Add(T, P.spine, rk2 * 0.2); Sub(T, P.root + 1, 0.04 + Math.Max(0, rk2) * 0.03); Sub(T, P.head, rk2 * 0.12); Set3(T, P.footL, 0.18, 0.08, 0.12); Set3(T, P.footR, -0.18, 0.08, -0.12); break; }
            case "cradle": { double cr = JsMath.Sin(w * 0.6); Sub(T, P.root + 1, 0.09); Add(T, P.spine, 0.16); Set(T, P.pelvis + 2, cr * 0.08); Set3(T, P.footL, 0.3, 0.08, 0.0); Set3(T, P.footR, -0.3, 0.08, 0.0); Set3(T, P.kneeL, 0.7, 0, 1); Set3(T, P.kneeR, -0.7, 0, 1); break; }
            case "glide": { double gl = JsMath.Sin(w * 0.4); Add(T, P.root, gl * 0.1); Set(T, P.pelvis + 2, -gl * 0.1); Add(T, P.spine + 2, gl * 0.06); Sub(T, P.root + 1, 0.05); Set3(T, P.footL, 0.24 + Math.Max(0, gl) * 0.08, 0.08, 0.02); Set3(T, P.footR, -0.24 + Math.Min(0, gl) * 0.08, 0.08, 0.02); break; }
            case "jab": { double jb = Math.Max(0, JsMath.Sin(w * 0.9)); Set3(T, P.footR, -0.16, 0.08 + 0.04 * jb, 0.04 + 0.3 * jb); Add(T, P.spine, 0.1 * jb); Sub(T, P.root + 1, 0.05 + 0.03 * jb); Add(T, P.chest + 1, 0.12 * jb); break; }
            case "springs": { double sp2 = Math.Abs(JsMath.Sin(w * 1.6)); Add(T, P.root + 1, sp2 * 0.04 - 0.02); Set(T, P.pitchL, sp2 * 0.4); Set(T, P.pitchR, sp2 * 0.4); Set3(T, P.footL, 0.15, 0.08 + sp2 * 0.03, 0.04); Set3(T, P.footR, -0.15, 0.08 + sp2 * 0.03, 0.0); break; }
            case "lowrider": Sub(T, P.root + 1, 0.14); Add(T, P.spine, 0.24); Sub(T, P.head, 0.14); Set3(T, P.footL, 0.28, 0.08, 0.1); Set3(T, P.footR, -0.28, 0.08, -0.08); Set3(T, P.kneeL, 0.5, 0, 1); Set3(T, P.kneeR, -0.5, 0, 1); break;
            case "swagger": { double sw2 = JsMath.Sin(w * 0.5); Add(T, P.root + 1, 0.02); Sub(T, P.spine, 0.08); Add(T, P.chest + 1, sw2 * 0.24); Set(T, P.head + 1, -sw2 * 0.18); Set(T, P.head + 2, sw2 * 0.1); Set3(T, P.footL, 0.22, 0.08, 0.06); Set3(T, P.footR, -0.22, 0.08, -0.04); break; }
            case "blur": { double bl = JsMath.Sin(w * 2.4); Sub(T, P.root + 1, 0.08); Add(T, P.chest + 1, bl * 0.1); Add(T, P.root, bl * 0.03); Set3(T, P.footL, 0.2, 0.08 + Math.Max(0, bl) * 0.04, 0.05); Set3(T, P.footR, -0.2, 0.08 + Math.Max(0, -bl) * 0.04, -0.03); break; }
            case "pendulum": { double pd2 = JsMath.Sin(w * 0.7); Sub(T, P.root + 1, 0.08); Add(T, P.root, pd2 * 0.06); Set3(T, P.footL, 0.36, 0.08, 0.14); Set3(T, P.footR, -0.36, 0.08, -0.1); Set3(T, P.kneeL, 0.6, 0, 1); Set3(T, P.kneeR, -0.6, 0, 1); Add(T, P.spine, 0.12); break; }
        }
    }
}
