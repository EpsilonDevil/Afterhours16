// Replays every exported shot with the C# Ball / planShot and compares bit for bit.
using Rimrift.Sim;

namespace Rimrift.Harness;

public sealed class Divergence
{
    public int Shot, Seed, Tick; public string Field = "", Js = "", Cs = "";
    public override string ToString() => $"shot #{Shot} (seed {Seed}) tick {Tick} field {Field}: JS {Js} vs C# {Cs}";
}

public static class Replay
{
    public const int MAX_TICKS = 600;
    /// <summary>Mirror of export_traces.mjs flightEnded.</summary>
    public static bool FlightEnded(Ball b, int ticks)
    {
        if (ticks >= MAX_TICKS) return true;
        if (b.vy == 0 && b.y <= Constants.BALL_R + 0.001 && JsMath.Hypot(b.vx, b.vz) < 0.05) return true;
        if (Math.Abs(b.x) > 12 || Math.Abs(b.z) > 20) return true;
        if (b.floorBounces >= 40) return true;
        return false;
    }

    static readonly string[] Fields = { "x", "y", "z", "vx", "vy", "vz", "wx", "wy", "wz" };

    public static Ball BallFromLaunch(TraceShot s)
    {
        var l = s.Launch.Select(Hex.ToDouble).ToArray();
        var b = new Ball { halfOnly = s.Opts.HalfOnly, surface = s.Opts.Surface };
        b.setFlight(l[0], l[1], l[2], l[3], l[4], l[5], "shot", null);
        b.wx = l[6]; b.wy = l[7]; b.wz = l[8];
        b.ghost = s.Plan.Ghost;
        return b;
    }

    /// <summary>Compares every tick of every shot. Returns (shots, ticks, events, divergences, first divergence).</summary>
    public static (int shots, long ticks, long events, int diverged, Divergence? first) Traces(string path, TextWriter log, int maxReport = 5)
    {
        int shots = 0, diverged = 0; long ticks = 0, events = 0; Divergence? first = null;
        int shotIdx = 0;
        foreach (var s in TraceShot.ReadAll(path))
        {
            shots++;
            var b = BallFromLaunch(s);
            var ev = new List<BallEvent>();
            Divergence? d = null;
            int n = 0;
            while (!FlightEnded(b, n))
            {
                ev.Clear();
                b.step(Constants.DT, ev);
                n++;
                if (n > s.Ticks.Length) { d = new Divergence { Shot = shotIdx, Seed = s.Seed, Tick = n, Field = "length", Js = $"{s.Ticks.Length} ticks (flight ended)", Cs = "still flying" }; break; }
                var t = s.Ticks[n - 1];
                var snap = b.snapshot();
                double[] cs = { snap.x, snap.y, snap.z, snap.vx, snap.vy, snap.vz, snap.wx, snap.wy, snap.wz };
                for (int i = 0; i < 9; i++)
                {
                    double js = Hex.ToDouble(t.S[i]);
                    if (!Hex.Same(js, cs[i])) { d = new Divergence { Shot = shotIdx, Seed = s.Seed, Tick = n, Field = Fields[i], Js = Hex.Show(js), Cs = Hex.Show(cs[i]) }; break; }
                }
                if (d != null) break;
                ticks++;
                // flags
                double[] f = { b.touchedRim ? 1 : 0, b.touchedBoard ? 1 : 0, b.scoredFlag, b.floorBounces, b.netTouched ? 1 : 0 };
                string[] fn = { "touchedRim", "touchedBoard", "scoredFlag", "floorBounces", "netTouched" };
                for (int i = 0; i < 5; i++) if (f[i] != t.F[i]) { d = new Divergence { Shot = shotIdx, Seed = s.Seed, Tick = n, Field = fn[i], Js = t.F[i].ToString(), Cs = f[i].ToString() }; break; }
                if (d != null) break;
                // events
                if (ev.Count != t.E.Length) { d = new Divergence { Shot = shotIdx, Seed = s.Seed, Tick = n, Field = "events", Js = string.Join(" | ", t.E.Select(ShowEv)), Cs = string.Join(" | ", ev) }; break; }
                for (int i = 0; i < ev.Count; i++)
                {
                    string? bad = CompareEvent(t.E[i], ev[i]);
                    if (bad != null) { d = new Divergence { Shot = shotIdx, Seed = s.Seed, Tick = n, Field = "event." + bad, Js = ShowEv(t.E[i]), Cs = ev[i].ToString() }; break; }
                }
                if (d != null) break;
                events += ev.Count;
            }
            if (d == null && n != s.Ticks.Length) d = new Divergence { Shot = shotIdx, Seed = s.Seed, Tick = n, Field = "length", Js = $"{s.Ticks.Length} ticks", Cs = $"{n} ticks (flight ended early)" };
            if (d != null)
            {
                diverged++;
                first ??= d;
                if (diverged <= maxReport) log.WriteLine("  DIVERGENCE " + d);
            }
            shotIdx++;
        }
        return (shots, ticks, events, diverged, first);
    }

    static string ShowEv(TraceEvent e) => $"{e.T} side={e.Side} clean={e.Clean} rim={e.Rim} v={e.V} x={e.X} y={e.Y} z={e.Z}";

    static string? CompareEvent(TraceEvent js, BallEvent cs)
    {
        if (js.T != cs.Type) return "type";
        if (js.Side != null && js.Side.Value != cs.Side) return "side";
        if (js.Clean != null && js.Clean.Value != cs.Clean) return "clean";
        if (js.Rim != null && js.Rim.Value != cs.Rim) return "rim";
        if (js.V != null && !Hex.Same(Hex.ToDouble(js.V), cs.V)) return "v";
        if (js.X != null && !Hex.Same(Hex.ToDouble(js.X), cs.X)) return "x";
        if (js.Y != null && !Hex.Same(Hex.ToDouble(js.Y), cs.Y)) return "y";
        if (js.Z != null && !Hex.Same(Hex.ToDouble(js.Z), cs.Z)) return "z";
        return null;
    }

    /// <summary>--planner: re-runs planShot from the recorded RNG state and compares the plan and the RNG state after.</summary>
    public static (int shots, int diverged, Divergence? first) Planner(string path, TextWriter log, int maxReport = 5)
    {
        int shots = 0, diverged = 0, idx = 0; Divergence? first = null;
        string[] vn = { "vx", "vy", "vz", "wx", "wy", "wz" };
        foreach (var s in TraceShot.ReadAll(path))
        {
            shots++;
            var rng = new Rng(s.Seed) { State = Hex.ToDouble(s.RngBefore) };
            var P = new Vec3(Hex.ToDouble(s.P[0]), Hex.ToDouble(s.P[1]), Hex.ToDouble(s.P[2]));
            var rim = new Vec3(Hex.ToDouble(s.Rim[0]), Hex.ToDouble(s.Rim[1]), Hex.ToDouble(s.Rim[2]));
            var opts = new PlanOpts { halfOnly = s.Opts.HalfOnly, surface = s.Opts.Surface, swish = s.Opts.Swish, guarantee = s.Opts.Guarantee, bad = s.Opts.Bad, bank = s.Opts.Bank };
            var plan = Shots.planShot(rng, P, rim, s.Side, s.Make, s.Arc, opts);
            Divergence? d = null;
            double[] cs = { plan.vx, plan.vy, plan.vz, plan.wx, plan.wy, plan.wz };
            for (int i = 0; i < 6 && d == null; i++)
            {
                double js = Hex.ToDouble(s.Plan.V[i]);
                if (!Hex.Same(js, cs[i])) d = new Divergence { Shot = idx, Seed = s.Seed, Field = "plan." + vn[i], Js = Hex.Show(js), Cs = Hex.Show(cs[i]) };
            }
            if (d == null && plan.made != s.Plan.Made) d = new Divergence { Shot = idx, Seed = s.Seed, Field = "plan.made", Js = s.Plan.Made.ToString(), Cs = plan.made.ToString() };
            if (d == null && plan.bank != s.Plan.Bank) d = new Divergence { Shot = idx, Seed = s.Seed, Field = "plan.bank", Js = $"{s.Plan.Bank}", Cs = $"{plan.bank}" };
            if (d == null && plan.rim != s.Plan.Rim) d = new Divergence { Shot = idx, Seed = s.Seed, Field = "plan.rim", Js = $"{s.Plan.Rim}", Cs = $"{plan.rim}" };
            if (d == null && plan.ghost != s.Plan.Ghost) d = new Divergence { Shot = idx, Seed = s.Seed, Field = "plan.ghost", Js = s.Plan.Ghost.ToString(), Cs = plan.ghost.ToString() };
            double rngJs = Hex.ToDouble(s.RngAfter);
            if (d == null && !Hex.Same(rngJs, rng.State)) d = new Divergence { Shot = idx, Seed = s.Seed, Field = "rng.state", Js = Hex.Show(rngJs), Cs = Hex.Show(rng.State) };
            if (d != null) { diverged++; first ??= d; if (diverged <= maxReport) log.WriteLine("  DIVERGENCE " + d); }
            idx++;
        }
        return (shots, diverged, first);
    }
}
