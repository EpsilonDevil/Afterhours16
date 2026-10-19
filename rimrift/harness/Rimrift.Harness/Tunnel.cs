// --tunnel: fires the ball at the +z rim from a dense grid of directions / offsets at 15, 20 and 25 m/s and looks
// for sub-steps in which the ball centre passed through (or skimmed) the rim tube without any rim contact.
//
// Per sub-step (position p0 before, p1 after collision resolution) with no rim contact registered in that sub-step:
//   through  : the segment p0→p1 comes within rimTube of the torus centreline = the ball centre crossed the metal
//              (passed from one side of the tube to the other) — a real tunnel
//   skimmed  : the segment comes within BALL_R + rimTube (the ball should have touched) but neither endpoint did and
//              the ball was not just leaving a resolved contact — a missed glancing contact
// Counts are per trajectory (a trajectory is counted once per category).
//   inside   : p1 itself is within rimTube of the centreline (the ball ends a sub-step inside the tube)
// Contact detection uses Ball.touchedRim, reset before each sub-step (touchedRim is set on every resolved contact,
// the 'rim' event only above 0.25 m/s of normal speed).
using Rimrift.Sim;

namespace Rimrift.Harness;

public sealed class TunnelResult
{
    public double Speed; public int Sub, Trajectories, Contacted, Through, Skimmed, Inside;
    public double ClosestMiss = double.PositiveInfinity; // nearest centreline distance of a no-contact segment that still cleared BALL_R + rimTube
    public double DeepestSkim = 0; // how far inside the contact shell (m) a missed glancing contact got
    public override string ToString() =>
        $"{Speed,5:0} m/s  SUB={Sub,-3} trajectories={Trajectories,6} contacted={Contacted,6} through-tube={Through,5} skimmed={Skimmed,5} ended-inside={Inside,5}";
}

public static class Tunnel
{
    const double Cz = COURT.hoopZ, Cy = COURT.rimY;
    static double CentrelineDist(double x, double y, double z) => JsMath.Hypot(JsMath.Hypot(x, z - Cz) - Ball.RT, y - Cy);

    /// <summary>Minimum centreline distance along the segment, sampled at `n` points (<2 mm apart for a 25 m/s sub-step).</summary>
    static double SegmentMin(double x0, double y0, double z0, double x1, double y1, double z1, int n = 128)
    {
        double best = double.PositiveInfinity;
        for (int i = 0; i <= n; i++)
        {
            double t = (double)i / n;
            double d = CentrelineDist(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t);
            if (d < best) best = d;
        }
        return best;
    }

    public static IEnumerable<(Vec3 start, Vec3 vel)> Trajectories(double speed)
    {
        double[] elevs = { 0, 10, 25, 45, 65, 85 };          // degrees below horizontal the ball travels (85 = dropping steeply)
        double[] offs = { 0, 45, 90, 135, 180, 225, 270, 315 }; // travel azimuth relative to the ring point's radial
        double[] radial = { -0.12, -0.09, -0.06, -0.03, 0, 0.03, 0.06, 0.09, 0.12 }; // aim offset across the tube (m); |0.129| would just clear it
        double[] vert = { -0.06, 0, 0.06 };
        for (int ai = 0; ai < 8; ai++)
        {
            double az = ai * Math.PI / 4;
            double rx = Math.Cos(az), rz = Math.Sin(az); // outward radial of the ring point
            foreach (var ro in radial) foreach (var vo in vert) foreach (var e in elevs) foreach (var off in offs)
            {
                double ax = rx * (Ball.RT + ro), ay = Cy + vo, az_ = Cz + rz * (Ball.RT + ro);
                double el = e * Math.PI / 180, ta = az + off * Math.PI / 180;
                double ux = Math.Cos(el) * Math.Cos(ta), uy = -Math.Sin(el), uz = Math.Cos(el) * Math.Sin(ta);
                var start = new Vec3(ax - ux * 1.0, ay - uy * 1.0, az_ - uz * 1.0);
                yield return (start, new Vec3(ux * speed, uy * speed, uz * speed));
            }
        }
    }

    public static TunnelResult Run(double speed, int sub = Ball.SUB)
    {
        var res = new TunnelResult { Speed = speed, Sub = sub };
        var ev = new List<BallEvent>();
        double h = Constants.DT / sub;
        int steps = sub * 15; // 0.25 s: 1 m of approach plus the pass through the rim zone
        foreach (var (s, v) in Trajectories(speed))
        {
            res.Trajectories++;
            var b = new Ball { halfOnly = true, Sub = sub };
            b.setFlight(s.x, s.y, s.z, v.x, v.y, v.z, "shot", null);
            bool contacted = false, prevContact = false, through = false, skimmed = false, inside = false;
            const double shell = Constants.BALL_R + COURT.rimTube;
            for (int i = 0; i < steps; i++)
            {
                double x0 = b.x, y0 = b.y, z0 = b.z;
                double d0 = CentrelineDist(x0, y0, z0);
                b.touchedRim = false;
                b.substep(h, ev);
                if (b.touchedRim) { contacted = true; prevContact = true; continue; }
                double d1 = CentrelineDist(b.x, b.y, b.z);
                if (d1 < COURT.rimTube) inside = true;
                // leaving a resolved contact (p0 sits on the shell) is not a missed contact
                bool fromShell = prevContact || d0 <= shell + 1e-9;
                prevContact = false;
                double dmin = SegmentMin(x0, y0, z0, b.x, b.y, b.z);
                if (dmin < COURT.rimTube) through = true;
                else if (dmin < shell && !fromShell && d1 > shell) { skimmed = true; if (shell - dmin > res.DeepestSkim) res.DeepestSkim = shell - dmin; }
                else if (dmin >= shell && dmin < res.ClosestMiss) res.ClosestMiss = dmin;
            }
            if (contacted) res.Contacted++;
            if (through) res.Through++;
            if (skimmed) res.Skimmed++;
            if (inside) res.Inside++;
        }
        return res;
    }
}
