// animator.js actionPose and the action bodies: jump shots (every base and release), post moves, layups, dunks, hangs,
// passes, steals, blocks/rebounds (generic reach), stumbles, dribble moves, celebrations, the flip.
using static Rimrift.Anim.AnimMath;
using static Rimrift.Anim.AnimTables;
namespace Rimrift.Anim;

public sealed partial class Animator
{
    void ActionPose(float[] T, AnimAction a, AnimPlayer p, AnimGame? g, double[] b, double[] bm, double[]? rim)
    {
        double t = a.T, s = S;
        var tmp = new double[3];
        switch (a.Type)
        {
            case "shoot": case "ftshot":
            {
                bool ft = a.Type == "ftshot";
                double tR = a.TRel != 0 ? a.TRel : 0.6, tk = ft ? tR * 0.92 : (a.HasTakeoff ? a.Takeoff : tR * 0.36);
                double deep = Math.Max(0, Math.Min(1, ((double.IsNaN(a.DRim) ? 5 : a.DRim) - 4) / 4));
                string style = ft || a.Kind == "close" ? "standard" : (p.ShotPkg?.Style ?? "standard");
                double dip = ft ? 0.1 : a.Kind == "close" ? 0.11 : 0.15 + 0.04 * deep + (DIP.TryGetValue(style, out var dv) ? dv : 0);
                int sh = SideOf(p.ShotPkg?.Hand ?? "R"); double sg = Sgn(sh); int oh = Off(sh);
                if (t < 0) { Set(T, P.root + 1, -0.05); Set(T, P.spine, 0.14); }
                else if (!p.Airborne && !(a.Released && t > tk + 0.1))
                {
                    double tDown = tk * 0.58;
                    double yv, heel = 0;
                    if (t < tDown) { double q = t / Math.Max(0.05, tDown); yv = -dip * JsMath.Pow(JsMath.Sin(q * Math.PI / 2), 1.4); }
                    else { double q = Math.Min(1, (t - tDown) / Math.Max(0.04, tk - tDown)); yv = Lerp(-dip, 0.025, q * q); heel = Sm(0.55, 1, q); }
                    Set(T, P.root + 1, yv - 0.03 * (1 - Sm(0, 0.15, t)));
                    if (a.Hustle == "prohop" && a.HopEnd != 0 && t < a.HopEnd) { double hq = JsMath.Sin(Math.PI * t / a.HopEnd); Add(T, P.root + 1, 0.12 * hq); Set3(T, P.footL, 0.12, 0.08 + 0.12 * hq, 0.02); Set3(T, P.footR, -0.12, 0.08 + 0.12 * hq, 0.02); Set(T, P.pitchL, 0.5 * hq); Set(T, P.pitchR, 0.5 * hq); }
                    Set3(T, P.Foot(sh), sg * 0.13, 0.08, 0.06); Set3(T, P.Foot(oh), -sg * 0.13, 0.08, -0.03);
                    Set(T, P.pitchL, heel * 0.42); Set(T, P.pitchR, heel * 0.42); Set(T, P.toeL, -heel * 0.38); Set(T, P.toeR, -heel * 0.38);
                    Set3(T, P.kneeL, 0.12, 0, 1); Set3(T, P.kneeR, -0.12, 0, 1);
                    if (style == "wide") { Set3(T, P.footL, 0.27, 0.08, 0.02); Set3(T, P.footR, -0.27, 0.08, 0.0); Set3(T, P.kneeL, 0.4, 0, 1); Set3(T, P.kneeR, -0.4, 0, 1); }
                    else if (style == "sniper") { Set3(T, P.footL, 0.11, 0.08, 0.02); Set3(T, P.footR, -0.11, 0.08, 0.02); }
                    else if (style == "pogo") { double b2 = Math.Abs(JsMath.Sin(t / Math.Max(0.05, tk) * Math.PI * 2)); Set(T, P.root + 1, yv * 0.6 - 0.04 * b2); }
                    else if (style == "onestep" || style == "bounce") { double st2 = Sm(0, 0.6, t / Math.Max(0.05, tk)); Set3(T, P.Foot(sh), sg * 0.13, 0.08 + 0.1 * JsMath.Sin(st2 * Math.PI), 0.06 + 0.22 * st2); }
                    else if (style == "frog") { Set3(T, P.footL, 0.07, 0.08, 0.02); Set3(T, P.footR, -0.07, 0.08, 0.0); Set3(T, P.kneeL, 0.8, 0, 1); Set3(T, P.kneeR, -0.8, 0, 1); }
                    else if (style == "dip") { Set(T, P.spine, 0.18); }
                    else if (style == "whip") { Set(T, P.chest + 1, -sg * 0.2 * (1 - Sm(0, 1, t / Math.Max(0.05, tk)))); }
                    else if (style == "sharpeye") { Set3(T, P.footL, 0.085, 0.08, 0.02); Set3(T, P.footR, -0.085, 0.08, 0.01); Set3(T, P.kneeL, 0.08, 0, 1); Set3(T, P.kneeR, -0.08, 0, 1); }
                    double inc = -yv / dip;
                    Set(T, P.spine, 0.04 + inc * 0.12); Set(T, P.chest, 0.02 + inc * 0.05);
                }
                else if (p.Airborne)
                {
                    Set(T, P.root + 1, 0.0);
                    double tuck = a.Released ? 0.006 : 0.016;
                    Set3(T, P.footL, 0.12, 0.085 + tuck, 0.03); Set3(T, P.footR, -0.12, 0.085 + tuck * 1.3, -0.01);
                    Set(T, P.pitchL, 0.62); Set(T, P.pitchR, 0.66); Set(T, P.toeL, 0); Set(T, P.toeR, 0);
                    Set3(T, P.kneeL, 0.1, 0, 1); Set3(T, P.kneeR, -0.1, 0, 1);
                    Set(T, P.spine, -0.02); Set(T, P.chest, -0.03);
                    if (style == "high") { Set3(T, P.footL, 0.08, 0.08, 0.0); Set3(T, P.footR, -0.08, 0.08, -0.01); Set(T, P.pitchL, 0.72); Set(T, P.pitchR, 0.72); Set(T, P.spine, -0.05); Set(T, P.head, -0.16); }
                    else if (style == "flick") { Set3(T, P.footL, 0.13, 0.13, -0.09); Set3(T, P.footR, -0.13, 0.14, -0.11); Set(T, P.spine, 0.04); }
                    else if (style == "push") { Set3(T, P.Foot(sh), sg * 0.13, 0.1, 0.13); Set3(T, P.Foot(oh), -sg * 0.13, 0.12, -0.12); Set(T, P.spine, 0.03); }
                    else if (style == "lean") { double ko = Sm(0, 0.2, t - tk); Set3(T, P.footL, 0.13, 0.12 + ko * 0.12, 0.13 + ko * 0.16); Set3(T, P.footR, -0.13, 0.11 + ko * 0.1, 0.11 + ko * 0.15); Set3(T, P.kneeL, 0.12, 0.2, 1); Set3(T, P.kneeR, -0.12, 0.2, 1); Set(T, P.spine, -0.17); Set(T, P.chest, -0.08); }
                    else if (style == "kick") { double k2 = Sm(0, 0.18, t - tk); Set3(T, P.Foot(oh), -sg * 0.15, 0.1 + 0.2 * k2, 0.02 + 0.3 * k2); Set3(T, P.Knee(oh), -sg * 0.15, 0.3 * k2, 1); Set(T, P.Pitch(oh), 0.45); Set(T, P.spine, -0.04); }
                    else if (style == "wide") { Set3(T, P.footL, 0.27, 0.09, 0.02); Set3(T, P.footR, -0.27, 0.09, 0.0); Set3(T, P.kneeL, 0.4, 0, 1); Set3(T, P.kneeR, -0.4, 0, 1); Set(T, P.spine, 0.0); }
                    else if (style == "sniper") { Set3(T, P.footL, 0.1, 0.08, 0.02); Set3(T, P.footR, -0.1, 0.08, 0.02); Set(T, P.pitchL, 0.7); Set(T, P.pitchR, 0.7); Set(T, P.spine, -0.02); Set(T, P.head, -0.1); }
                    else if (style == "fade") { Set3(T, P.Foot(sh), sg * 0.17, 0.14, 0.24); Set3(T, P.Foot(oh), -sg * 0.17, 0.12, -0.16); Set(T, P.spine, -0.24); Set(T, P.chest, -0.12); Set(T, P.chest + 1, sg * 0.16); Set(T, P.head, 0.06); Set(T, P.pitchL, 0.5); Set(T, P.pitchR, 0.5); }
                    else if (style == "hitch") { double h = Sm(0, 0.16, t - tk) * (1 - Sm(0.3, 0.52, t - tk)); Set3(T, P.footL, 0.11, 0.09 + h * 0.3, 0.04 + h * 0.22); Set3(T, P.footR, -0.11, 0.09 + h * 0.3, 0.02 + h * 0.2); Set3(T, P.kneeL, 0.2, h * 0.5, 1); Set3(T, P.kneeR, -0.2, h * 0.5, 1); Set(T, P.spine, -0.03); }
                    else if (style == "sling") { Set3(T, P.footL, 0.14, 0.1, -0.2); Set3(T, P.footR, -0.14, 0.11, -0.24); Set3(T, P.kneeL, 0.2, -0.3, 1); Set3(T, P.kneeR, -0.2, -0.3, 1); Set(T, P.pitchL, 0.85); Set(T, P.pitchR, 0.85); Set(T, P.spine, 0.06); Set(T, P.head, -0.18); }
                    else if (style == "scissor") { double sc = JsMath.Sin(Math.Min(1, (t - tk) / 0.3) * Math.PI); Set3(T, P.footL, 0.12, 0.1 + sc * 0.2, 0.05 + sc * 0.42); Set3(T, P.footR, -0.12, 0.1 + sc * 0.16, -0.03 - sc * 0.4); Set3(T, P.kneeL, 0.15, sc * 0.4, 1); Set3(T, P.kneeR, -0.15, -sc * 0.3, 1); Set(T, P.pitchL, 0.5); Set(T, P.pitchR, 0.8); }
                    else if (style == "tuck") { double tu = Sm(0, 0.2, t - tk); Set3(T, P.footL, 0.13, 0.09 + tu * 0.4, 0.04 + tu * 0.3); Set3(T, P.footR, -0.13, 0.09 + tu * 0.42, 0.02 + tu * 0.3); Set3(T, P.kneeL, 0.26, tu * 0.5, 1); Set3(T, P.kneeR, -0.26, tu * 0.5, 1); Set(T, P.pitchL, 0.55); Set(T, P.pitchR, 0.55); Set(T, P.spine, -0.02 - tu * 0.04); }
                    else if (style == "silk") { double dr = Sm(0, 0.32, t - tk); Set3(T, P.footL, 0.075, 0.1 + dr * 0.05, 0.05 + dr * 0.16); Set3(T, P.footR, -0.075, 0.1 + dr * 0.08, 0.03 + dr * 0.15); Set3(T, P.kneeL, 0.1, 0.15, 1); Set3(T, P.kneeR, -0.1, 0.15, 1); Set(T, P.pitchL, 0.6); Set(T, P.pitchR, 0.6); Set(T, P.spine, 0.02); Set(T, P.chest, -0.02); Set(T, P.head, -0.13); }
                    else if (style == "sway") { double sy = Sm(0, 0.2, t - tk); Set3(T, P.Foot(oh), -sg * (0.14 + sy * 0.3), 0.1 + sy * 0.12, 0.02); Set3(T, P.Knee(oh), -sg * (0.3 + sy * 0.5), 0.1, 1); Set3(T, P.Foot(sh), sg * 0.1, 0.09, 0.03); Set(T, P.spine + 2, sg * 0.12 * sy); Set(T, P.chest + 2, sg * 0.08 * sy); Set(T, P.spine, -0.06); }
                    else if (AIR2.TryGetValue(style, out var airFn)) airFn(T, t - tk, sh, sg, Math.Max(0.1, tR - tk));
                    if (a.Fade) { Set(T, P.spine, -0.16); Set(T, P.chest, -0.08); Set3(T, P.footL, 0.12, 0.11, 0.12); Set3(T, P.footR, -0.12, 0.12, 0.1); }
                    if (a.Hustle == "pullup") { Set3(T, P.Foot(sh), sg * 0.12, 0.2, 0.26); Set3(T, P.Knee(sh), sg * 0.12, 0.3, 1); Set3(T, P.Foot(oh), -sg * 0.12, 0.22, -0.28); Set3(T, P.Knee(oh), -sg * 0.14, -0.2, 1); Set(T, P.spine, 0.06); Set(T, P.chest, 0.02); Set(T, P.Pitch(sh), 0.4); Set(T, P.Pitch(oh), 0.85); }
                    else if (a.Hustle == "runfade") { Set3(T, P.Foot(sh), sg * 0.16, 0.18, 0.32); Set3(T, P.Foot(oh), -sg * 0.14, 0.14, -0.1); Set3(T, P.Knee(sh), sg * 0.16, 0.25, 1); Set(T, P.spine, -0.3); Set(T, P.chest, -0.14); Set(T, P.head, 0.08); Set(T, P.chest + 1, sg * 0.12); }
                    else if (a.Hustle == "prohop") { Set3(T, P.footL, 0.13, 0.13, 0.03); Set3(T, P.footR, -0.13, 0.13, 0.03); Set3(T, P.kneeL, 0.25, 0.1, 1); Set3(T, P.kneeR, -0.25, 0.1, 1); Set(T, P.pitchL, 0.6); Set(T, P.pitchR, 0.6); Set(T, P.spine, 0.0); }
                }
                else { Set(T, P.spine, 0.08); Set(T, P.chest, 0.02); }
                Set(T, P.head, -0.12);
                if (a.Post == "hook")
                {
                    double k = Math.Min(1, t / (a.TRel != 0 ? a.TRel : 0.5)), up = p.Airborne ? 1 : 0.5; string shape = a.HookShape ?? "baby";
                    Set3(T, P.Foot(oh), -sg * 0.1, 0.08 + 0.26 * up * k, 0.16 * k); Set3(T, P.Knee(oh), -sg * 0.1, 0.35 * k, 1);
                    Set3(T, P.Foot(sh), sg * 0.14, 0.085 + 0.02 * up, -0.06); Set(T, P.Pitch(sh), 0.5 * up);
                    Set(T, P.spine + 2, sg * (shape == "sky" ? 0.22 : 0.12) * k); Set(T, P.spine, shape == "sky" ? -0.08 : 0.02); Set(T, P.chest + 1, sg * 0.25 * k); Set(T, P.head + 1, sg * 0.5);
                }
                else if (a.Post == "fade" && p.Airborne) { Set(T, P.spine, a.FadeShape == "high" ? -0.2 : -0.26); Set(T, P.chest, -0.1); Set3(T, P.footL, 0.13, 0.12, 0.16); Set3(T, P.footR, -0.13, 0.13, 0.14); Set(T, P.pitchL, 0.5); Set(T, P.pitchR, 0.5); }
                else if (a.Post == "turn" && !a.Released) { double k = Math.Min(1, t / (a.TRel != 0 ? a.TRel : 0.5)); Set(T, P.chest + 1, sg * 0.2 * (1 - k)); Set(T, P.spine + 2, sg * 0.06 * JsMath.Sin(k * Math.PI)); }
                if (a.Post != null) Stub("redShot (Sexy Red post shots)");
                if (a.Released) FollowThrough(T, a, p, t, style, true);
                break;
            }
            case "post":
            {
                double q = Math.Min(1, t / a.Dur), side = a.Side, e = a.Emph, fk = a.FakeAt;
                if (a.Move == "dropstep")
                {
                    double k = JsMath.Sin(q * Math.PI);
                    Sub(T, P.root + 1, 0.12 * k * e); Set(T, P.spine, 0.12 + 0.1 * k); Set(T, P.spine + 2, -side * 0.18 * k); Set(T, P.chest + 1, -side * 0.3 * k);
                    Set3(T, side > 0 ? P.footL : P.footR, side * (0.2 + 0.34 * k), 0.08, 0.1 + 0.2 * k); Set3(T, side > 0 ? P.footR : P.footL, -side * 0.16, 0.08 + 0.06 * k, -0.2);
                    Set3(T, side > 0 ? P.kneeL : P.kneeR, side * 0.6, 0.1, 1); Set3(T, side > 0 ? P.kneeR : P.kneeL, -side * 0.3, 0, 1);
                    Set(T, P.head + 1, -side * 0.3 * k);
                }
                else if (a.Move == "postspin")
                {
                    double k = JsMath.Sin(q * Math.PI);
                    Sub(T, P.root + 1, 0.06 * k); Set(T, P.spine, 0.08); Set(T, P.spine + 2, side * 0.1 * k);
                    Set3(T, P.footL, 0.12, 0.08 + (side > 0 ? 0.07 * k : 0), 0.04); Set3(T, P.footR, -0.12, 0.08 + (side < 0 ? 0.07 * k : 0), -0.04);
                    Set3(T, P.kneeL, 0.25, 0, 1); Set3(T, P.kneeR, -0.25, 0, 1);
                    int off = side > 0 ? P.handR : P.handL;
                    Mix3(T, off, (side > 0 ? -1 : 1) * 0.5, 1.25, 0.1, k); Set3(T, side > 0 ? P.elbowR : P.elbowL, side > 0 ? -1 : 1, -0.3, -0.2);
                    Set(T, P.head + 1, -side * 0.5 * k);
                }
                else
                {
                    if (q < fk) { double w = JsMath.Sin(q / fk * Math.PI); Add(T, P.root + 1, 0.03 * w); Set(T, P.spine, -0.1 * w); Set(T, P.head, -0.2 * w); Set3(T, P.footL, 0.14, 0.08 + 0.03 * w, 0.02); Set3(T, P.footR, -0.14, 0.08 + 0.03 * w, -0.02); Set(T, P.pitchL, 0.3 * w); Set(T, P.pitchR, 0.3 * w); }
                    else { double k = JsMath.Sin(Math.Min(1, (q - fk) / (1 - fk)) * Math.PI); Sub(T, P.root + 1, 0.14 * k * e); Set(T, P.spine, 0.2 * k); Set3(T, side > 0 ? P.footL : P.footR, side * 0.18, 0.08, 0.14 + 0.3 * k); Set3(T, side > 0 ? P.footR : P.footL, -side * 0.14, 0.08 + 0.04 * k, -0.24); Set3(T, side > 0 ? P.kneeL : P.kneeR, side * 0.4, 0.2, 1); Set(T, P.head, -0.1 * k); }
                }
                break;
            }
            case "pumpfake":
            {
                double k = JsMath.Sin(Math.Min(1, t / a.Dur) * Math.PI);
                Set(T, P.root + 1, -0.06 + k * 0.05); Set(T, P.spine, 0.05 - k * 0.1); Set(T, P.head, -0.15 * k);
                break;
            }
            case "layup": LayupPose(T, a, p, t); break;
            case "dunk": case "oop": DunkPose(T, a, p, t); break;
            case "hang":
            {
                if (rim != null)
                {
                    double[] l1 = { 0, 0, 0 }, l2 = { 0, 0, 0 };
                    double fx = JsMath.Sin(p.Facing), fz = JsMath.Cos(p.Facing), lx = JsMath.Cos(p.Facing), lz = -JsMath.Sin(p.Facing);
                    ToLocal(rim[0] + lx * 0.16 - fx * 0.12, rim[1] + 0.02, rim[2] + lz * 0.16 - fz * 0.12, l1);
                    ToLocal(rim[0] - lx * 0.16 - fx * 0.12, rim[1] + 0.02, rim[2] - lz * 0.16 - fz * 0.12, l2);
                    Set3(T, P.handL, l1[0] / s, l1[1] / s - 0.02, l1[2] / s - 0.05); Set3(T, P.handR, l2[0] / s, l2[1] / s - 0.02, l2[2] / s - 0.05);
                    palm[0] = new Palm(new[] { 0, -1.0, 0 }, new[] { 0, 0, 1.0 }, 0.8); palm[1] = new Palm(new[] { 0, -1.0, 0 }, new[] { 0, 0, 1.0 }, 0.8);
                }
                double sw = JsMath.Sin(t * 7) * 0.12 * JsMath.Exp(-t * 2);
                Set3(T, P.footL, 0.12, 0.25 + Math.Max(0, sw) * 0.4, 0.1 + sw); Set3(T, P.footR, -0.12, 0.22, 0.05 + sw);
                Set(T, P.pitchL, 0.7); Set(T, P.pitchR, 0.7); Set(T, P.spine, -0.08); Set(T, P.head, -0.15);
                Set3(T, P.elbowL, 0.8, 0, -0.6); Set3(T, P.elbowR, -0.8, 0, -0.6);
                break;
            }
            case "land": Set(T, P.root + 1, -0.05 * JsMath.Sin(Math.Min(1, t / a.Dur) * Math.PI)); Set(T, P.spine, 0.12); break;
            case "pass":
            {
                if (a.Op) { Stub("oprahPose"); break; }
                double q = Math.Min(1, t / a.Dur);
                double step = JsMath.Sin(q * Math.PI);
                Set3(T, P.footL, 0.13, 0.08, 0.05 + step * 0.22);
                Set(T, P.spine, 0.1 + step * (a.PType == "bounce" ? 0.3 : 0.15)); Set(T, P.root + 1, -0.06 - step * 0.06);
                if (a.Released)
                {
                    double dx = 0, dz = 1;
                    var tgt = g?.PassTargetPos;
                    if (tgt != null) { double[] lt = { 0, 0, 0 }; ToLocal(tgt[0], 1.2, tgt[1], lt); double l = JsMath.Hypot(lt[0], lt[2]); if (l == 0) l = 1; dx = lt[0] / l; dz = lt[2] / l; }
                    double yv = a.PType == "bounce" ? 0.9 : a.PType == "lob" || a.PType == "alley" ? 1.9 : 1.32;
                    Set3(T, P.handL, 0.14 + dx * 0.55, yv, 0.2 + dz * 0.5); Set3(T, P.handR, -0.14 + dx * 0.55, yv, 0.2 + dz * 0.5);
                    palm[0] = new Palm(new[] { 0, -0.3, 1 }, new[] { 0.2, 0.3, 0.9 }, 0.7); palm[1] = new Palm(new[] { 0, -0.3, 1 }, new[] { -0.2, 0.3, 0.9 }, 0.7);
                }
                break;
            }
            case "catch": Sub(T, P.root + 1, 0.05); Add(T, P.spine, 0.08); break;
            case "steal":
            {
                double k = JsMath.Sin(Math.Min(1, t / a.Dur) * Math.PI);
                int hd = a.Hand == "L" ? 0 : 1; double sg = Sgn(hd);
                Set(T, P.spine, 0.2 + k * (a.Low ? 0.55 : 0.4)); Set(T, P.chest + 1, sg * 0.25 * k); Set(T, P.root + 1, -0.1 - k * (a.Low ? 0.2 : 0.12));
                Set3(T, P.Foot(hd), sg * 0.18, 0.08, 0.1 + k * 0.38);
                double[] reach = b != null && JsMath.Hypot(b[0], b[2]) < 1.6 ? new[] { b[0], Math.Max(a.Low ? 0.35 : 0.6, b[1]), b[2] } : new[] { sg * 0.1, a.Low ? 0.55 : 0.95, 0.8 };
                Set3(T, P.Hand(hd), Lerp(sg * 0.25, reach[0], k), Lerp(1.0, reach[1], k), Lerp(0.2, reach[2], k));
                Set3(T, P.Elbow(hd), sg * 0.5, -1, 0);
                palm[hd] = new Palm(new[] { -sg * 0.3, -0.6, 0.6 }, new[] { 0, -0.2, 1 }, 0.6 * k);
                if (a.Icon == "clamp") Stub("clampStealPose (The Clamp)");
                break;
            }
            case "block": case "rebound": case "tipjump": BlockPose(T, a, p, g, b, t); break;
            case "stumble": StumblePose(T, a, t); break;
            case "bump": { double k = JsMath.Sin(Math.Min(1, t / a.Dur) * Math.PI); Sub(T, P.spine, 0.18 * k); Sub(T, P.root + 2, 0.06 * k); break; }
            case "move": MovePose(T, a, t); break;
            case "celebrate": Celebrate(T, a, p); break;
            case "flip": FlipPose(T, a, p); break;
            case "snag": Stub("snagPose (Open Arms)"); break;
        }
    }

    void LayupPose(float[] T, AnimAction a, AnimPlayer p, double t)
    {
        double tk = a.Takeoff;
        if (!p.Airborne && t < tk)
        {
            double q = t / Math.Max(0.05, tk);
            Set(T, P.root + 1, -0.06 - JsMath.Sin(q * Math.PI) * 0.14);
            Set(T, P.spine, 0.25);
            if (a.LStyle == "hop") { double h = JsMath.Sin(Math.Min(1, q / 0.6) * Math.PI); Add(T, P.root + 1, 0.1 * h); Set3(T, P.footL, 0.14, 0.08 + 0.12 * h, 0.06); Set3(T, P.footR, -0.14, 0.08 + 0.12 * h, 0.06); }
            if (a.LStyle == "spin") { Set(T, P.spine, 0.32); Sub(T, P.root + 1, 0.04); }
        }
        else if (p.Airborne)
        {
            Set3(T, P.footR, -0.1, 0.55, 0.32); Set3(T, P.kneeR, -0.1, 0.3, 1); Set(T, P.pitchR, 0.5);
            Set3(T, P.footL, 0.1, 0.18, -0.22); Set3(T, P.kneeL, 0.1, 0, 1); Set(T, P.pitchL, 0.8);
            Set(T, P.spine, -0.05); Set(T, P.chest, -0.05); Set(T, P.head, -0.2);
            string ls = a.LStyle ?? "basic"; double sw = a.LsDir;
            if (ls == "euro")
            {
                double q = Math.Min(1, (t - tk) / 0.3);
                Set3(T, P.footR, -0.1 + sw * 0.3 * q, 0.42, 0.42); Set3(T, P.footL, 0.1 + sw * 0.1, 0.2, -0.3);
                Set(T, P.spine + 2, -sw * 0.22); Set(T, P.chest + 2, -sw * 0.12); Set(T, P.root, sw * 0.08 * q);
            }
            else if (ls == "finger") { Set3(T, P.footR, -0.1, 0.42, 0.42); Set(T, P.spine, -0.12); Set(T, P.head, -0.3); Set3(T, P.handL, 0.28, 1.4, 0.1); Set3(T, P.elbowL, 0.9, -0.6, -0.2); }
            else if (ls == "scoop") { Set3(T, P.footR, -0.1, 0.5, 0.42); Set3(T, P.kneeR, -0.1, 0.45, 1); Set(T, P.spine, 0.16); Set(T, P.chest, 0.1); Set(T, P.head, -0.34); Set3(T, P.elbowR, -1, -0.9, -0.1); }
            else if (ls == "reverse")
            {
                double q = Math.Min(1, (t - tk) / 0.32);
                Set3(T, P.footL, 0.12, 0.34, 0.16); Set3(T, P.footR, -0.12, 0.36, 0.18); Set3(T, P.kneeL, 0.2, 0.3, 1); Set3(T, P.kneeR, -0.2, 0.3, 1);
                Set(T, P.chest + 1, -0.5 * q); Set(T, P.spine + 1, -0.2 * q); Set(T, P.head + 1, -0.6 * q); Set(T, P.spine, -0.14); Set(T, P.head, -0.3);
                Set3(T, P.handL, 0.42, 1.35, 0.1); Set3(T, P.elbowL, 1, -0.4, -0.3);
            }
            else if (ls == "hop") { Set3(T, P.footL, 0.14, 0.36, 0.14); Set3(T, P.footR, -0.14, 0.36, 0.14); Set3(T, P.kneeL, 0.3, 0.3, 1); Set3(T, P.kneeR, -0.3, 0.3, 1); Set(T, P.pitchL, 0.6); Set(T, P.pitchR, 0.6); Set(T, P.spine, 0.04); Set(T, P.head, -0.2); }
            else if (ls == "floater") { Set3(T, P.footL, 0.08, 0.2, 0.22); Set3(T, P.footR, -0.08, 0.24, 0.26); Set3(T, P.kneeL, 0.1, 0.2, 1); Set3(T, P.kneeR, -0.1, 0.2, 1); Set(T, P.pitchL, 0.7); Set(T, P.pitchR, 0.7); Set(T, P.spine, -0.16); Set(T, P.chest, -0.08); Set(T, P.head, -0.32); Set3(T, P.handL, 0.3, 1.5, 0.3); Set3(T, P.elbowL, 0.9, -0.5, 0); }
            else if (ls == "spin") { Set3(T, P.footL, 0.2, 0.3, -0.2); Set3(T, P.kneeL, 0.4, -0.1, 1); Set(T, P.chest + 1, a.SpinDir * 0.25); Set(T, P.spine, 0.02); }
            string cv = a.Cov ?? "open"; double cs = a.CovSide; int fh = LayupHand(a); double fs = Sgn(fh); int oh = Off(fh);
            double up = Math.Min(1, Math.Max(0, (t - tk) / Math.Max(0.1, a.Release - tk)));
            if (cv == "side") { Set(T, P.spine + 2, -cs * 0.2); Set(T, P.chest + 1, cs * 0.24); Set(T, P.head + 1, -cs * 0.12); Set3(T, P.Hand(oh), -fs * 0.34, 1.52, 0.32); Set3(T, P.Elbow(oh), -fs * 1, -0.2, 0.3); }
            else if (cv == "front")
            {
                double tuck = JsMath.Sin(Math.Min(1, up) * Math.PI);
                Set3(T, P.footL, 0.11, 0.3 + 0.24 * tuck, 0.1 + 0.18 * tuck); Set3(T, P.footR, -0.11, 0.34 + 0.24 * tuck, 0.12 + 0.18 * tuck);
                Set3(T, P.kneeL, 0.2, 0.4, 1); Set3(T, P.kneeR, -0.2, 0.4, 1); Set(T, P.spine, 0.04 + 0.16 * tuck); Set(T, P.chest, 0.08 * tuck); Set(T, P.head, -0.1);
            }
            else if (cv == "rim") { Set(T, P.chest + 1, cs * 0.5 * up); Set(T, P.spine + 1, cs * 0.2 * up); Set(T, P.head + 1, cs * 0.55 * up); Set(T, P.spine, -0.12); Set(T, P.head, -0.28); Set3(T, P.Hand(oh), -fs * 0.4, 1.35, 0.05); Set3(T, P.Elbow(oh), -fs * 1, -0.4, -0.3); }
            else if (cv == "trail") { Set3(T, P.footR, -0.1, 0.36, 0.24); Set3(T, P.footL, 0.1, 0.12, -0.08); Set(T, P.pitchL, 0.9); Set(T, P.pitchR, 0.8); Set(T, P.spine, -0.16); Set(T, P.head, -0.36); }
            if (a.Released)
            {
                int P2 = P.Hand(fh);
                if (cv == "rim") { Set3(T, P2, fs * 0.12, 2.36, 0.02); palm[fh] = new Palm(new[] { -fs * 0.3, 0.6, -0.7 }, new[] { 0, 0.9, 0.2 }, 0.85); }
                else if (ls == "scoop") { Set3(T, P2, fs * 0.08, 2.2, 0.5); palm[fh] = new Palm(new[] { 0, 0.95, 0.2 }, new[] { 0, 0.4, 0.9 }, 0.85); }
                else if (ls == "finger") { Set3(T, P2, fs * 0.05, 2.58, 0.36); palm[fh] = new Palm(new[] { 0, 0.1, 1 }, new[] { 0, 0.85, -0.5 }, 0.9); }
                else if (ls == "reverse") { Set3(T, P2, fs * 0.3, 2.05, -0.1); palm[fh] = new Palm(new[] { 0, 0.6, -0.8 }, new[] { 0, 0.8, 0.2 }, 0.85); }
                else { Set3(T, P2, fs * 0.06, 2.45, 0.32); palm[fh] = new Palm(new[] { 0, 0.3, 0.95 }, new[] { 0, 0.95, -0.2 }, 0.8); }
            }
            if (ls != "finger" && ls != "scoop" && ls != "hop" && ls != "reverse" && ls != "floater" && cv != "side" && cv != "rim") { Set3(T, P.Hand(oh), -fs * 0.35, 1.7, 0.2); Set3(T, P.Elbow(oh), -fs * 1, -0.3, 0); }
        }
        else { Set(T, P.root + 1, -0.12); Set(T, P.spine, 0.2); }
    }

    void DunkPose(float[] T, AnimAction a, AnimPlayer p, double t)
    {
        double tk = a.Takeoff;
        if (!p.Airborne && t < tk)
        {
            double q = t / Math.Max(0.05, tk);
            Set(T, P.root + 1, -0.08 - JsMath.Sin(q * Math.PI) * 0.2);
            Set(T, P.spine, 0.3);
        }
        else if (p.Airborne)
        {
            string st = a.Style ?? ""; bool two = st == "power" || st == "double" || st == "360";
            double up = a.Slam != 0 ? Math.Min(1, Math.Max(0, (t - tk) / Math.Max(0.1, a.Slam - tk))) : 1;
            double slamD = Math.Max(0.1, a.Slam);
            if (st == "360") { Set3(T, P.footL, 0.12, 0.42, -0.02); Set3(T, P.footR, -0.12, 0.4, -0.04); Set(T, P.pitchL, 0.75); Set(T, P.pitchR, 0.75); Set3(T, P.kneeL, 0.25, 0, 1); Set3(T, P.kneeR, -0.25, 0, 1); }
            else if (st == "cradle") { Set3(T, P.footL, 0.1, 0.5, 0.18); Set3(T, P.footR, -0.1, 0.52, 0.2); Set(T, P.pitchL, 0.6); Set(T, P.pitchR, 0.6); Set3(T, P.kneeL, 0.2, 0.4, 1); Set3(T, P.kneeR, -0.2, 0.4, 1); }
            else if (st == "windmill") { Set3(T, P.footR, -0.1, 0.62, 0.34); Set3(T, P.kneeR, -0.1, 0.3, 1); Set3(T, P.footL, 0.12, 0.34, -0.42); Set3(T, P.kneeL, 0.1, -0.2, 1); Set(T, P.pitchL, 0.9); Set(T, P.pitchR, 0.5); }
            else if (st == "double") { double back = JsMath.Sin(Math.Min(1, up / 0.75) * Math.PI); Set3(T, P.footL, 0.14, 0.3 + back * 0.15, 0.05 - back * 0.3); Set3(T, P.footR, -0.14, 0.3 + back * 0.12, 0.05 - back * 0.28); Set(T, P.pitchL, 0.75); Set(T, P.pitchR, 0.75); Set3(T, P.kneeL, 0.3, 0, 1); Set3(T, P.kneeR, -0.3, 0, 1); }
            else if (st == "hammer") { Set3(T, P.footR, -0.12, 0.3, -0.5); Set3(T, P.kneeR, -0.12, -0.3, 1); Set3(T, P.footL, 0.12, 0.5, 0.22); Set3(T, P.kneeL, 0.14, 0.3, 1); Set(T, P.pitchL, 0.6); Set(T, P.pitchR, 0.9); Set(T, P.chest + 1, -0.38 * JsMath.Sin(Math.Min(1, (a.T / slamD) / 0.72) * Math.PI)); }
            else if (st == "rimrock") { double bk2 = JsMath.Sin(Math.Min(1, (a.T / slamD) / 0.76) * Math.PI); Set3(T, P.footL, 0.13, 0.42 + 0.12 * bk2, -0.3 - 0.12 * bk2); Set3(T, P.footR, -0.13, 0.44 + 0.12 * bk2, -0.32 - 0.12 * bk2); Set3(T, P.kneeL, 0.2, -0.3, 1); Set3(T, P.kneeR, -0.2, -0.3, 1); Set(T, P.pitchL, 0.95); Set(T, P.pitchR, 0.95); }
            else if (st == "bully") { Set3(T, P.footL, 0.18, 0.56, 0.24); Set3(T, P.kneeL, 0.3, 0.35, 1); Set3(T, P.footR, -0.2, 0.26, -0.12); Set3(T, P.kneeR, -0.28, 0, 1); Set(T, P.pitchL, 0.55); Set(T, P.pitchR, 0.75); Set(T, P.chest + 1, 0.36 * (1 - up * 0.6)); Set(T, P.spine + 2, -0.14); }
            else if (st == "aroundback") { double k = Math.Min(1, (a.T / slamD) / 0.72); Set3(T, P.footL, 0.11, 0.46, 0.12); Set3(T, P.footR, -0.11, 0.48, 0.12); Set3(T, P.kneeL, 0.2, 0.35, 1); Set3(T, P.kneeR, -0.2, 0.35, 1); Set(T, P.pitchL, 0.7); Set(T, P.pitchR, 0.7); Set(T, P.chest + 1, -0.32 * JsMath.Sin(Math.PI * k)); }
            else if (st == "superman") { Set3(T, P.footL, 0.12, 0.42, -0.58); Set3(T, P.footR, -0.12, 0.44, -0.56); Set3(T, P.kneeL, 0.1, -0.4, 1); Set3(T, P.kneeR, -0.1, -0.4, 1); Set(T, P.pitchL, 1.0); Set(T, P.pitchR, 1.0); }
            else if (st == "liberty") { Set3(T, P.footR, -0.11, 0.46, 0.4); Set3(T, P.kneeR, -0.11, 0.25, 1); Set3(T, P.footL, 0.12, 0.26, -0.4); Set3(T, P.kneeL, 0.1, -0.15, 1); Set(T, P.pitchL, 0.9); Set(T, P.pitchR, 0.45); }
            else if (st == "scoop") { double sc = JsMath.Sin(Math.Min(1, up / 0.7) * Math.PI); Set3(T, P.footL, 0.1, 0.4 + sc * 0.2, 0.22 + sc * 0.2); Set3(T, P.footR, -0.1, 0.42 + sc * 0.2, 0.24 + sc * 0.2); Set3(T, P.kneeL, 0.18, 0.4, 1); Set3(T, P.kneeR, -0.18, 0.4, 1); Set(T, P.pitchL, 0.6); Set(T, P.pitchR, 0.6); }
            else if (st == "switch") { Set3(T, P.footL, 0.16, 0.34, -0.1); Set3(T, P.footR, -0.16, 0.44, 0.2); Set3(T, P.kneeL, 0.3, -0.1, 1); Set3(T, P.kneeR, -0.3, 0.25, 1); Set(T, P.pitchL, 0.8); Set(T, P.pitchR, 0.55); Set(T, P.chest + 1, a.SpinDir * 0.3 * JsMath.Sin(Math.Min(1, up / 0.75) * Math.PI)); }
            else if (st == "180") { Set3(T, P.footL, 0.11, 0.4, 0.02); Set3(T, P.footR, -0.11, 0.38, 0.0); Set3(T, P.kneeL, 0.22, 0.1, 1); Set3(T, P.kneeR, -0.22, 0.1, 1); Set(T, P.pitchL, 0.8); Set(T, P.pitchR, 0.8); Set(T, P.chest + 1, -a.SpinDir * 0.25 * (1 - up)); }
            else if (st == "eastbay")
            {
                double thr = JsMath.Sin(Math.Min(1, up / 0.66) * Math.PI);
                Set3(T, P.footR, -0.12 - thr * 0.14, 0.52 + thr * 0.22, 0.34 + thr * 0.24); Set3(T, P.kneeR, -0.2 - thr * 0.5, 0.35, 1);
                Set3(T, P.footL, 0.12 + thr * 0.1, 0.26 - thr * 0.04, -0.4 - thr * 0.2); Set3(T, P.kneeL, 0.14 + thr * 0.3, -0.2, 1);
                Set(T, P.pitchL, 0.9); Set(T, P.pitchR, 0.5); Set(T, P.pelvis, -0.1 * thr);
            }
            else if (st.StartsWith("hs_")) { Stub("HS_BODY (Hash-Slinging dunks)"); Set3(T, P.footR, -0.1, 0.6, 0.3); Set3(T, P.kneeR, -0.1, 0.3, 1); Set3(T, P.footL, 0.1, 0.2, -0.2); Set(T, P.pitchL, 0.8); Set(T, P.pitchR, 0.5); }
            else if (DUNK_LEGS2.TryGetValue(st, out var legs)) legs(T, up);
            else if (two || a.Type == "oop") { Set3(T, P.footL, 0.14, 0.32, 0.05); Set3(T, P.footR, -0.14, 0.3, 0.05); Set(T, P.pitchL, 0.7); Set(T, P.pitchR, 0.7); Set3(T, P.kneeL, 0.3, 0, 1); Set3(T, P.kneeR, -0.3, 0, 1); }
            else { Set3(T, P.footR, -0.1, 0.6, 0.3); Set3(T, P.kneeR, -0.1, 0.3, 1); Set3(T, P.footL, 0.1, 0.2, -0.2); Set(T, P.pitchL, 0.8); Set(T, P.pitchR, 0.5); }
            if (!st.StartsWith("hs_"))
            {
                Set(T, P.spine, st == "tomahawk" || st == "hammer" ? -0.2 : st == "rimrock" ? -0.3 : st == "liberty" ? -0.26 : st == "windmill" || st == "cradle" ? -0.12 * JsMath.Sin(up * Math.PI) - 0.04 : st == "360" ? 0.08 : st == "eastbay" ? 0.1 : st == "scoop" ? 0.06 : st == "superman" ? 0.34 : st == "bully" ? 0.1 : st == "aroundback" ? 0.12 : -0.05);
                Set(T, P.chest, st == "tomahawk" || st == "hammer" ? -0.15 : st == "rimrock" ? -0.16 : st == "liberty" ? -0.12 : st == "windmill" ? -0.08 : st == "superman" ? 0.1 : 0);
                Set(T, P.head, st == "superman" ? -0.42 : -0.15);
                if (SPINE2.TryGetValue(st, out var sp2)) { Set(T, P.spine, sp2[0]); Set(T, P.chest, sp2[1]); Set(T, P.head, sp2[2]); }
            }
            int fh = Off(DunkHand(a)); double fs = Sgn(fh);
            if (!a.Slammed && (st == "windmill" || st == "cradle" || st == "tomahawk" || st == "hammer" || st == "liberty" || st == "180" || st == "eastbay" || st == "switch" || st == "aroundback" || st == "sidemill" || st == "spinmill" || st == "helicopter" || st == "crossleg" || st == "hurdle")) { Set3(T, P.Hand(fh), fs * 0.55, 1.75, 0.05); Set3(T, P.Elbow(fh), fs * 1, -0.2, -0.3); }
            if (!a.Slammed && st == "kneeup") { Set3(T, P.Hand(fh), fs * 0.3, 1.25, 0.42); Set3(T, P.Elbow(fh), fs * 0.8, -0.6, 0.2); }
            if (!a.Slammed && st == "jackknife") { Set3(T, P.Hand(fh), fs * 0.2, 0.9, 0.55); Set3(T, P.Elbow(fh), fs * 0.6, -0.6, 0.5); }
            if (!a.Slammed && st == "backscratch") { Set3(T, P.Hand(fh), fs * 0.6, 1.5, 0.2); Set3(T, P.Elbow(fh), fs * 1, -0.3, 0); }
            if (!a.Slammed && st == "scoop") { Set3(T, P.handL, 0.5, 1.3, -0.1); Set3(T, P.elbowL, 1, -0.5, -0.4); }
            if (!a.Slammed && st == "bully") { Set3(T, P.handL, 0.2, 1.62, 0.38); Set3(T, P.elbowL, 1, -0.5, 0.2); }
            if (!a.Slammed && st == "superman") { Set3(T, P.handL, 0.34, 1.25, -0.5); Set3(T, P.elbowL, 1, -0.3, -0.6); }
            if (a.Type == "oop") { Set3(T, P.handL, 0.15, 2.5, 0.35); Set3(T, P.handR, -0.15, 2.5, 0.35); }
            if (a.Slammed)
            {
                double k = Sm(0, 0.16, t - (!double.IsNaN(a.SlamAt) ? a.SlamAt : a.Slam != 0 ? a.Slam : t)); int dh = DunkHand(a); double ds = Sgn(dh); int oh = Off(dh);
                Set3(T, P.Hand(dh), ds * (0.08 - 0.02 * k), 2.3 - 0.62 * k, 0.45 + 0.12 * k);
                Set3(T, P.Elbow(dh), ds * 0.5, -0.3 - 0.5 * k, 0.6);
                Set3(T, P.Hand(oh), -ds * (0.25 + 0.15 * k), 2.1 - 0.75 * k, 0.3 - 0.05 * k);
                Add(T, P.spine, 0.22 * k); Add(T, P.chest, 0.16 * k); Add(T, P.head, 0.12 * k);
                Set(T, P.pitchL, Math.Max(T[P.pitchL], 0.7)); Set(T, P.pitchR, Math.Max(T[P.pitchR], 0.7));
                Set3(T, P.kneeL, 0.25, 0.35 * k, 1); Set3(T, P.kneeR, -0.25, 0.35 * k, 1);
            }
            if (!a.Slammed && a.Style == "reverse") Set(T, P.chest + 1, 0.3);
        }
        else { Set(T, P.root + 1, -0.18); Set(T, P.spine, 0.25); }
    }

    void BlockPose(float[] T, AnimAction a, AnimPlayer p, AnimGame? g, double[]? b, double t)
    {
        if (p.Airborne)
        {
            double u = Math.Max(0, t - a.JumpAt), air = a.Air != 0 ? a.Air : 0.6, up = Sm(0, air * 0.42, u), up2 = Sm(0.05, air * 0.52, u);
            bool own = a.Type == "rebound" && g != null && g.BallHolder == p.Id;
            double tx = 0.05, ty = 2.5, tz = 0.25;
            if (b != null) { tx = Math.Max(-0.6, Math.Min(0.6, b[0])); ty = Math.Max(1.7, Math.Min(2.75, b[1])); tz = Math.Max(-0.05, Math.Min(0.55, b[2])); }
            int ld = tx >= 0 ? 0 : 1, tr = Off(ld); double ls = Sgn(ld);
            Set3(T, P.footL, 0.13, 0.2 + 0.05 * up, 0.06); Set3(T, P.footR, -0.13, 0.25, -0.03); Set(T, P.pitchL, 0.55); Set(T, P.pitchR, 0.65);
            Set3(T, P.kneeL, 0.22, 0.1, 1); Set3(T, P.kneeR, -0.18, 0, 1);
            if (own)
            {
                double r = Sm(0, 0.18, u - (!double.IsNaN(a.GotAt) ? a.GotAt : u)); Set3(T, P.handL, 0.17, 1.48 + 0.2 * (1 - r), 0.38); Set3(T, P.handR, -0.17, 1.48 + 0.2 * (1 - r), 0.38);
                Set3(T, P.elbowL, 1, -0.3, -0.2); Set3(T, P.elbowR, -1, -0.3, -0.2); Set(T, P.spine, 0.12); Set(T, P.head, -0.05);
            }
            else
            {
                if (a.Type == "block" && a.BStyle != null) Stub("blockPose (thirty styled blocks, sim/blocks.js BLOCK_BY_ID)");
                double lz2 = Math.Max(tz, 0.18), tz2 = Math.Max(tz - 0.06, Math.Abs(tx - ls * 0.3) < 0.3 ? 0.34 : 0.12);
                Set3(T, P.Hand(ld), Lerp(ls * 0.42, tx + ls * 0.05, up), Lerp(1.05, ty, up), Lerp(0.12, lz2, up));
                Set3(T, P.Hand(tr), Lerp(-ls * 0.42, tx - ls * (a.Type == "block" ? 0.4 : 0.24), up2), Lerp(1.05, ty - (a.Type == "block" ? 0.5 : 0.26), up2), Lerp(0.12, tz2, up2));
                Set3(T, P.Elbow(ld), ls * 0.75, -0.25, -0.45); Set3(T, P.Elbow(tr), -ls * 0.95, -0.45, -0.35);
                if (a.Type == "block") palm[ld] = new Palm(new[] { 0, 0.1, 1 }, new[] { 0, 1, 0.1 }, 0.8 * up);
                Set(T, P.spine + 2, ls * 0.1 * up); Set(T, P.chest + 2, ls * 0.06 * up); Set(T, P.chest + 1, -ls * 0.12 * up);
                Set(T, P.spine, -0.05); Set(T, P.head, -0.22 - 0.1 * up);
            }
            if (a.Icon == "openarms" && !own)
            {
                double near = b != null ? Sm(1.25, 0.45, JsMath.Hypot(b[0], b[1] - 2.3, b[2] - 0.3)) : 0, open = up * (1 - near);
                Set3(T, P.handL, Lerp(Lerp(0.42, 0.92, open), tx + 0.19, near), Lerp(1.05, Lerp(2.2, ty, near), up), Lerp(0.12, Lerp(0.08, tz, near), up));
                Set3(T, P.handR, Lerp(Lerp(-0.42, -0.92, open), tx - 0.19, near), Lerp(1.05, Lerp(2.2, ty, near), up), Lerp(0.12, Lerp(0.08, tz, near), up));
                ClampReach(T, 0); ClampReach(T, 1);
                Set3(T, P.elbowL, 1, 0.3, -0.3); Set3(T, P.elbowR, -1, 0.3, -0.3);
                palm[0] = new Palm(new[] { -near, 0.2 * (1 - near), 1 - 0.8 * near }, new[] { 0.2, 0.95, 0 }, 0.85);
                palm[1] = new Palm(new[] { near, 0.2 * (1 - near), 1 - 0.8 * near }, new[] { -0.2, 0.95, 0 }, 0.85);
                Set(T, P.spine, -0.12 * open); Set(T, P.chest, -0.08 * open); Set(T, P.head, -0.24 - 0.1 * up); Set(T, P.chest + 1, 0); Set(T, P.spine + 2, 0); Set(T, P.chest + 2, 0);
                Set3(T, P.kneeL, 0.34, 0.2, 1); Set3(T, P.kneeR, -0.34, 0.2, 1);
            }
        }
        else if (a.Jumped || t > (a.JumpAt != 0 ? a.JumpAt : 0.06) + 0.1)
        {
            double q = Sm(0, 0.2, t - (a.JumpAt != 0 ? a.JumpAt : 0.06) - (a.Air != 0 ? a.Air : 0.6));
            Set(T, P.root + 1, -0.12 * (1 - q)); Set(T, P.spine, 0.18 * (1 - q) + 0.06);
            Set3(T, P.handL, 0.3, 1.25 - 0.2 * q, 0.16); Set3(T, P.handR, -0.3, 1.25 - 0.2 * q, 0.16);
            Set3(T, P.elbowL, 0.7, -0.6, -0.4); Set3(T, P.elbowR, -0.7, -0.6, -0.4);
            if (a.Type == "block" && a.Hit && a.BStyle != null) Stub("blockLanding (styled block landing gestures)");
        }
        else
        {
            double q = Math.Min(1, t / Math.Max(0.05, a.JumpAt != 0 ? a.JumpAt : 0.06));
            Set(T, P.root + 1, -0.16 * JsMath.Sin(q * Math.PI * 0.5 + 0.5)); Set(T, P.spine, 0.25);
            Set3(T, P.handL, 0.32, 1.0 + 0.4 * (1 - q), -0.12 * q); Set3(T, P.handR, -0.32, 1.0 + 0.4 * (1 - q), -0.12 * q);
            Set3(T, P.elbowL, 0.5, -0.6, -0.6); Set3(T, P.elbowR, -0.5, -0.6, -0.6);
        }
    }

    void StumblePose(float[] T, AnimAction a, double t)
    {
        double q = Math.Min(1, t / a.Dur);
        if (a.React != null) { Stub("ANKLE_POSE (ankle-breaker victims)"); }
        if (a.Fall && a.Screen)
        {
            double hit = JsMath.Sin(Math.Min(1, q / 0.18) * Math.PI) * (1 - Sm(0.12, 0.3, q));
            double down = Sm(0.08, 0.32, q) * (1 - Sm(0.7, 1, q));
            double up = Sm(0.7, 1, q);
            Set(T, P.root + 1, -0.86 * down - 0.1 * hit); Set(T, P.root + 2, -0.42 * down - 0.2 * hit);
            Set(T, P.spine, -0.45 * hit + (0.35 - 0.2 * up) * down); Set(T, P.chest, -0.2 * hit); Set(T, P.head, 0.3 * hit - 0.15 * down);
            Set(T, P.pelvis, -0.5 * down);
            Set3(T, P.footL, 0.22, 0.08, 0.55 * down + 0.08 - 0.15 * hit); Set3(T, P.footR, -0.2, 0.08, 0.4 * down - 0.1 * hit);
            Set3(T, P.handL, 0.42, 1.3 * hit + 0.12 * down + 0.4 * (1 - down - hit), -0.42 * down + 0.1 * hit);
            Set3(T, P.handR, -0.42, 1.25 * hit + 0.12 * down + 0.4 * (1 - down - hit), -0.4 * down + 0.1 * hit);
            Set3(T, P.elbowL, 0.7, -0.1, -0.5); Set3(T, P.elbowR, -0.7, -0.1, -0.5);
        }
        else if (a.Fall && a.Flat) { Stub("stumble flat (posterized fall)"); }
        else if (a.Fall)
        {
            double down = Sm(0.05, 0.3, q) * (1 - Sm(0.72, 1, q));
            Set(T, P.root + 1, -0.82 * down); Set(T, P.root + 2, -0.25 * down);
            Set3(T, P.footL, 0.2, 0.08, 0.35 * down + 0.05); Set3(T, P.footR, -0.22, 0.08, 0.5 * down);
            Set3(T, P.handL, 0.35, 0.15 + 0.85 * (1 - down), -0.25 * down); Set3(T, P.handR, -0.35, 0.15 + 0.85 * (1 - down), -0.25 * down);
            Set(T, P.spine, 0.1 - 0.2 * down); Set(T, P.pelvis, -0.4 * down); Set(T, P.head, -0.2 * down);
        }
        else if (a.Back)
        {
            double k = JsMath.Sin(q * Math.PI), st = JsMath.Sin(Math.Min(1, q * 1.6) * Math.PI);
            Set(T, P.root + 1, -0.12 * k); Set(T, P.root + 2, -0.18 * k);
            Set(T, P.spine, -0.32 * k); Set(T, P.chest, -0.18 * k); Set(T, P.head, 0.25 * k);
            Set3(T, P.footL, 0.16, 0.08 + st * 0.06, -0.22 * k); Set3(T, P.footR, -0.16, 0.08, 0.1 - 0.3 * k);
            Set3(T, P.handL, 0.5, 1.45 + 0.3 * k, 0.15); Set3(T, P.handR, -0.5, 1.4 + 0.35 * k, 0.12);
            Set3(T, P.elbowL, 0.8, -0.2, -0.4); Set3(T, P.elbowR, -0.8, -0.2, -0.4);
        }
        else
        {
            double k = JsMath.Sin(q * Math.PI); double dir = a.Dir;
            Set(T, P.root + 1, -0.25 * k); Set(T, P.spine + 2, dir * 0.4 * k); Set(T, P.root, dir * 0.15 * k);
            Set3(T, dir > 0 ? P.footL : P.footR, dir * 0.42 * k + (dir > 0 ? 0.12 : -0.12), 0.08, -0.1);
            Set3(T, P.handL, 0.5, 1.1 + 0.3 * k, 0.1); Set3(T, P.handR, -0.5, 1.1 + 0.3 * k, 0.1);
        }
    }

    void MovePose(float[] T, AnimAction a, double t)
    {
        var sty = a.Sty != null && MOVE_STYLE.TryGetValue(a.Sty, out var s0) ? s0 : MOVE_STYLE["basic"];
        double q = Math.Min(1, t / a.Dur), k = JsMath.Sin(q * Math.PI) * (1 + 0.25 * a.Lvl) * sty.flair;
        double side = a.Hand == "R" ? 1 : -1, low = 0.5 + 0.5 * (2 - sty.low); // (a.handFrom: the Hand field carries it)
        string? mv = a.Move;
        if (mv == "cross" || mv == "btl" || mv == "btb" || mv == "inout")
        {
            Sub(T, P.root + 1, 0.08 * k * low); Set(T, P.spine + 2, -side * 0.25 * JsMath.Sin(q * Math.PI * 2) * (mv == "inout" ? 1 : 0.6));
            Set(T, P.chest + 1, side * 0.2 * k);
            Set3(T, side > 0 ? P.footR : P.footL, -side * 0.34 * sty.wide, 0.08, 0.1);
        }
        else if (mv == "hang")
        {
            bool hang = q < 0.38; double s2 = hang ? JsMath.Sin(q / 0.38 * Math.PI) : JsMath.Sin((q - 0.38) / 0.62 * Math.PI);
            Add(T, P.root + 1, hang ? 0.03 * s2 : -0.13 * s2 * low * sty.flair);
            Set(T, P.spine, hang ? -0.06 * s2 : 0.18 * s2);
            Set(T, P.chest + 1, hang ? -side * 0.22 * s2 * sty.flair : side * 0.24 * s2);
            Set(T, P.head + 1, hang ? -side * 0.18 * s2 : 0);
            if (!hang) Set3(T, side > 0 ? P.footR : P.footL, -side * 0.4 * sty.wide, 0.08, 0.12);
        }
        else if (mv == "wrap")
        {
            Sub(T, P.root + 1, 0.1 * k * low); Set(T, P.chest + 1, -side * 0.3 * k); Set(T, P.spine + 2, side * 0.18 * k);
            Set3(T, side > 0 ? P.footL : P.footR, side * 0.46 * sty.wide * Math.Min(1, q * 2), 0.08, 0.02);
        }
        else if (mv == "hesi")
        {
            Add(T, P.root + 1, q < 0.5 ? 0.04 * JsMath.Sin(q * 2 * Math.PI) : -0.08 * JsMath.Sin((q - 0.5) * 2 * Math.PI));
            Set(T, P.spine, q < 0.55 ? -0.08 : 0.3);
        }
        else if (mv == "stutter")
        {
            if (q < 0.62)
            {
                double tap = JsMath.Sin(q / 0.62 * Math.PI * 7), up = Math.Max(0, tap) * 0.07, dn = Math.Max(0, -tap) * 0.07;
                Set3(T, P.footL, 0.16, 0.08 + up, 0.04); Set3(T, P.footR, -0.16, 0.08 + dn, -0.02);
                Set(T, P.spine, -0.1); Add(T, P.root + 1, 0.02 * JsMath.Sin(q / 0.62 * Math.PI * 14));
            }
            else { double g2 = JsMath.Sin((q - 0.62) / 0.38 * Math.PI); Set(T, P.spine, 0.34 * g2); Sub(T, P.root + 1, 0.1 * g2 * low); }
        }
        else if (mv == "momentum")
        {
            Set(T, P.spine, 0.3 * k); Sub(T, P.root + 1, 0.06 * k * low); Set(T, P.head, -0.12 * k);
            Set3(T, P.footL, 0.14, 0.08 + 0.1 * Math.Max(0, JsMath.Sin(q * Math.PI * 2)), 0.32 * JsMath.Sin(q * Math.PI * 2));
            Set3(T, P.footR, -0.14, 0.08 + 0.1 * Math.Max(0, -JsMath.Sin(q * Math.PI * 2)), -0.32 * JsMath.Sin(q * Math.PI * 2));
        }
        else if (mv == "stepback")
        {
            double hop = JsMath.Sin(Math.Min(1, q / 0.55) * Math.PI);
            Set3(T, P.footL, 0.18, 0.08 + hop * 0.12, -0.05 - hop * 0.15); Set3(T, P.footR, -0.18, 0.08 + hop * 0.12, -0.12 - hop * 0.15);
            Set(T, P.root + 1, -0.1 - 0.06 * k * low); Set(T, P.spine, 0.05);
        }
        else if (mv == "sidestep")
        {
            double hop = JsMath.Sin(Math.Min(1, q / 0.5) * Math.PI), wide = 0.18 + 0.16 * (1 - hop) * sty.wide;
            Set3(T, P.footL, wide, 0.08 + hop * 0.14, -0.04); Set3(T, P.footR, -wide, 0.08 + hop * 0.14, -0.04);
            Set(T, P.root + 1, -0.08 - 0.08 * (1 - hop) * low); Set(T, P.spine + 2, side * 0.16 * k); Set(T, P.spine, -0.04);
        }
        else if (mv == "retreat")
        {
            double hop = Math.Abs(JsMath.Sin(q * Math.PI * 2)) * (q < 0.7 ? 1 : 0.4);
            Set3(T, P.footL, 0.17, 0.08 + hop * 0.09, -0.06 - hop * 0.12); Set3(T, P.footR, -0.17, 0.08 + hop * 0.09, -0.14 - hop * 0.12);
            Set(T, P.root + 1, -0.12 * low); Set(T, P.spine, 0.14);
        }
        else if (mv == "spin" || mv == "halfspin")
        {
            Set(T, P.root + 1, -0.12 * k * low); Set(T, P.spine, 0.25 * k);
            Set3(T, P.handL, 0.45, 1.15, 0.0); Set3(T, P.handR, -0.45, 1.15, 0.0);
        }
        else if (mv == "pushcross")
        {
            if (q < 0.42) { double u = JsMath.Sin(q / 0.42 * Math.PI / 2); Set(T, P.spine, 0.22 * u); Sub(T, P.root + 1, 0.05 * u * low); Set3(T, side > 0 ? P.footL : P.footR, side * 0.16, 0.08, 0.26 * u); }
            else { double u = JsMath.Sin((q - 0.42) / 0.58 * Math.PI); Set(T, P.spine, 0.16); Sub(T, P.root + 1, 0.09 * u * low); Set(T, P.chest + 1, side * 0.22 * u); Set(T, P.spine + 2, -side * 0.18 * u); Set3(T, side > 0 ? P.footR : P.footL, -side * 0.36 * sty.wide * u, 0.08, 0.12); }
        }
        else if (mv == "jab")
        {
            if (q < 0.45) { double j = JsMath.Sin(q / 0.45 * Math.PI); Set3(T, side > 0 ? P.footL : P.footR, side * (0.17 + 0.2 * j * sty.wide), 0.08 + 0.05 * Math.Max(0, JsMath.Sin(q / 0.45 * Math.PI * 2)), 0.06 + 0.24 * j); Set(T, P.spine, 0.18 * j); Sub(T, P.root + 1, 0.1 * j * low); Set(T, P.chest + 1, -side * 0.14 * j); Set(T, P.head + 1, side * 0.1 * j); }
            else { double g2 = JsMath.Sin((q - 0.45) / 0.55 * Math.PI); Set(T, P.spine, 0.3 * g2); Sub(T, P.root + 1, 0.08 * g2 * low); }
        }
        else if (mv == "snatch")
        {
            double hop = JsMath.Sin(Math.Min(1, q / 0.55) * Math.PI);
            Set3(T, P.footL, 0.18 + (side > 0 ? 0.08 * hop : 0), 0.08 + hop * 0.12, -0.06 - hop * 0.14); Set3(T, P.footR, -0.18 - (side < 0 ? 0.08 * hop : 0), 0.08 + hop * 0.12, -0.12 - hop * 0.14);
            Set(T, P.root + 1, -0.1 - 0.05 * k * low); Set(T, P.spine, -0.02); Set(T, P.spine + 2, side * 0.12 * k);
        }
        else if (mv == "btlback")
        {
            double hop = JsMath.Sin(Math.Min(1, q / 0.6) * Math.PI);
            Set3(T, side > 0 ? P.footL : P.footR, side * 0.16, 0.08 + hop * 0.06, 0.18 - 0.3 * q); Set3(T, side > 0 ? P.footR : P.footL, -side * 0.18, 0.08 + hop * 0.08, -0.16 - 0.12 * hop);
            Set(T, P.root + 1, -0.12 * low - 0.04 * k); Set(T, P.spine, 0.12); Set(T, P.chest + 1, side * 0.16 * k);
        }
    }

    void FlipPose(float[] T, AnimAction a, AnimPlayer p)
    {
        double t = a.T, tk = a.Takeoff != 0 ? a.Takeoff : 0.16, air = FlipAir(a), u = (t - tk) / air;
        if (!a.Jumped)
        {
            double q = Math.Min(1, t / tk);
            Set(T, P.root + 1, -0.17 * JsMath.Sin(q * Math.PI / 2)); Set(T, P.spine, 0.32 * q); Set(T, P.chest, 0.08 * q);
            Set3(T, P.handL, 0.26, 0.92, -0.26 * q); Set3(T, P.handR, -0.26, 0.92, -0.26 * q);
            Set3(T, P.kneeL, 0.14, 0, 1); Set3(T, P.kneeR, -0.14, 0, 1);
            return;
        }
        if (p.Airborne && u < 1.05)
        {
            double up = 1 - Sm(0, 0.16, u), tu = Sm(0.08, 0.3, u) * (1 - Sm(0.74, 0.92, u));
            Set(T, P.root + 1, 0);
            Set3(T, P.footL, 0.11, 0.09 + 0.64 * tu, 0.05 + 0.24 * tu); Set3(T, P.footR, -0.11, 0.09 + 0.64 * tu, 0.05 + 0.24 * tu);
            Set3(T, P.kneeL, 0.25, 0.95 * tu, 1); Set3(T, P.kneeR, -0.25, 0.95 * tu, 1);
            Set(T, P.pitchL, 0.7 - 0.3 * tu); Set(T, P.pitchR, 0.7 - 0.3 * tu);
            Set(T, P.spine, 0.55 * tu - 0.12 * up); Set(T, P.chest, 0.16 * tu); Set(T, P.head, 0.34 * tu - 0.2 * up);
            double o = Sm(0.74, 0.95, u), hy = Lerp(2.2 * up + (1 - up) * Lerp(1.05, 0.84, tu), 1.4, o), hx = 0.24 + 0.26 * o, hz = 0.1 + 0.24 * tu * (1 - o);
            Set3(T, P.handL, hx, hy, hz); Set3(T, P.handR, -hx, hy, hz);
            Set3(T, P.elbowL, 1, -0.2, 0.3); Set3(T, P.elbowR, -1, -0.2, 0.3);
            return;
        }
        double q2 = Sm(0, 0.3, t - tk - air);
        Set(T, P.root + 1, -0.13 * (1 - q2)); Set(T, P.spine, 0.22 * (1 - q2)); Set(T, P.head, -0.05);
        Set3(T, P.handL, 0.5 - 0.25 * q2, 1.35 - 0.33 * q2, 0.15); Set3(T, P.handR, -0.5 + 0.25 * q2, 1.35 - 0.33 * q2, 0.15);
        Set3(T, P.kneeL, 0.2, 0, 1); Set3(T, P.kneeR, -0.2, 0, 1);
    }

    void Celebrate(float[] T, AnimAction a, AnimPlayer p)
    {
        double t = a.T, k = Math.Min(1, t / 0.25) * (1 - Math.Max(0, (t - a.Dur + 0.3) / 0.3));
        string kind = a.Kind ?? "flex";
        switch (kind)
        {
            case "flex":
                Mix3(T, P.handL, 0.38, 1.78, 0.02, k); Mix3(T, P.handR, -0.38, 1.78, 0.02, k);
                Set3(T, P.elbowL, 1, -0.3, 0); Set3(T, P.elbowR, -1, -0.3, 0); Set(T, P.spine, -0.12 * k); Set(T, P.head, -0.2 * k);
                Set(T, P.chest + 2, JsMath.Sin(t * 10) * 0.05 * k); break;
            case "shimmy":
            {
                double sw = JsMath.Sin(t * 22);
                Set(T, P.chest + 1, sw * 0.32 * k); Set(T, P.clavL + 2, sw * 0.2 * k); Set(T, P.clavR + 2, sw * 0.2 * k);
                Set(T, P.root + 1, -0.07 * k); Set(T, P.spine, 0.08 * k);
                Mix3(T, P.handL, 0.24 + 0.05 * sw, 1.04, 0.16, k); Mix3(T, P.handR, -0.24 + 0.05 * sw, 1.04, 0.16, k); break;
            }
            case "point": Mix3(T, P.handR, -0.12, 2.55, 0.3, k); Set(T, P.head, -0.4 * k); break;
            case "chest": { double hit = Math.Abs(JsMath.Sin(t * 9)); Mix3(T, P.handR, -0.06, 1.45, 0.19 + hit * 0.12, k); Set3(T, P.elbowR, -1, -0.35, 0.1); Set(T, P.spine, -0.1 * k); break; }
            case "shush": Mix3(T, P.handR, -0.02, 1.86, 0.18, k); palm[1] = new Palm(new[] { 1.0, 0, 0 }, new[] { 0, 1.0, 0 }, k); break;
            case "too_small": Mix3(T, P.handR, -0.3, 0.75, 0.35, k); Set(T, P.spine, 0.2 * k); palm[1] = new Palm(new[] { 0, -1.0, 0 }, new[] { 0, 0, 1.0 }, k); break;
            case "shrug":
            {
                double up = 0.04 * Math.Min(1, t / 0.3);
                Mix3(T, P.handL, 0.58, 1.3 + up, 0.24, k); Mix3(T, P.handR, -0.58, 1.3 + up, 0.24, k);
                Set3(T, P.elbowL, 1, -0.6, 0.2); Set3(T, P.elbowR, -1, -0.6, 0.2);
                palm[0] = new Palm(new[] { 0, 1.0, 0 }, new[] { 0.3, 0, 1 }, k); palm[1] = new Palm(new[] { 0, 1.0, 0 }, new[] { -0.3, 0, 1 }, k);
                Set(T, P.head + 2, 0.18 * k); Set(T, P.spine, -0.04 * k); break;
            }
            case "salute": Mix3(T, P.handR, -0.06, 1.8, 0.2, k); Set3(T, P.elbowR, -1, 0.15, 0.2); palm[1] = new Palm(new[] { 0, -0.4, -1 }, new[] { 0.6, 0.6, 0 }, k); Set(T, P.spine, -0.06 * k); Set(T, P.head, -0.06 * k); break;
            case "cheer": { double pump = Math.Abs(JsMath.Sin(t * 7)); Mix3(T, P.handL, 0.32, 2.05 + 0.15 * pump, 0.1, k); Mix3(T, P.handR, -0.32, 2.05 + 0.15 * (1 - pump), 0.1, k); Add(T, P.root + 1, 0.03 * Math.Abs(JsMath.Sin(t * 7)) * k); Set(T, P.head, -0.25 * k); break; }
            case "clap": { double g2 = Math.Abs(JsMath.Sin(t * 11)); Mix3(T, P.handL, 0.03 + 0.1 * g2, 1.3, 0.3, k); Mix3(T, P.handR, -0.03 - 0.1 * g2, 1.3, 0.3, k); palm[0] = new Palm(new[] { -1.0, 0, 0 }, new[] { 0, 0.6, 0.8 }, k); palm[1] = new Palm(new[] { 1.0, 0, 0 }, new[] { 0, 0.6, 0.8 }, k); break; }
            case "roar": { double sh = JsMath.Sin(t * 16) * 0.03; Mix3(T, P.handL, 0.46, 0.92 + sh, -0.1, k); Mix3(T, P.handR, -0.46, 0.92 - sh, -0.1, k); Set3(T, P.elbowL, 1, -0.7, -0.5); Set3(T, P.elbowR, -1, -0.7, -0.5); Set(T, P.spine, -0.2 * k); Set(T, P.chest, -0.1 * k); Set(T, P.head, -0.3 * k); Set(T, P.root + 1, -0.03 * k); break; }
            default: Stub("celebrate '" + kind + "' (the rest of the celebrations)"); break;
        }
    }
}
