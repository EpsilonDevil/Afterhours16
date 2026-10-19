// The G0 gate as tests: the 1,000-shot bit-exact replay, the planner replay, the Math.* samples and the tunnelling
// measurement. The JS traces come from `node harness/export_traces.mjs` (+ `--math`); if they are missing the test
// runs the exporter itself (Node 22 on PATH) so the suite is self-contained and re-runnable.
using System.Diagnostics;
using Rimrift.Harness;
using Rimrift.Sim;
using Xunit;

namespace Rimrift.Sim.Tests;

public class ParityTests
{
    static string HarnessDir()
    {
        var dir = AppContext.BaseDirectory;
        for (int i = 0; i < 10 && dir != null; i++)
        {
            var cand = Path.Combine(dir, "harness");
            if (File.Exists(Path.Combine(cand, "export_traces.mjs"))) return cand;
            dir = Path.GetDirectoryName(dir);
        }
        throw new FileNotFoundException("rimrift/harness/export_traces.mjs not found above " + AppContext.BaseDirectory);
    }

    static string Ensure(string file, string extraArg)
    {
        var harness = HarnessDir();
        var path = Path.Combine(harness, "out", file);
        if (File.Exists(path)) return path;
        var psi = new ProcessStartInfo("node", $"export_traces.mjs {extraArg}") { WorkingDirectory = harness, RedirectStandardOutput = true, RedirectStandardError = true };
        using var p = Process.Start(psi)!;
        p.WaitForExit(600_000);
        Assert.True(File.Exists(path), $"could not produce {path}: {p.StandardError.ReadToEnd()}");
        return path;
    }

    [Fact]
    public void Ball_replay_is_bit_exact_over_1000_shots()
    {
        var path = Ensure("traces.jsonl", "");
        var (shots, ticks, events, diverged, first) = Replay.Traces(path, TextWriter.Null);
        Assert.Equal(1000, shots);
        Assert.True(ticks > 100_000, $"only {ticks} ticks compared");
        Assert.True(diverged == 0, $"{diverged} shots diverged; first: {first}");
    }

    [Fact]
    public void PlanShot_is_bit_exact_including_its_RNG_draws()
    {
        var path = Ensure("traces.jsonl", "");
        var (shots, diverged, first) = Replay.Planner(path, TextWriter.Null);
        Assert.Equal(1000, shots);
        Assert.True(diverged == 0, $"{diverged} plans diverged; first: {first}");
    }

    [Fact]
    public void JsMath_reproduces_every_Node_Math_sample()
    {
        var path = Ensure("math.jsonl", "--math");
        var rows = MathCheck.Run(path, TextWriter.Null);
        Assert.True(rows.Count >= 8);
        foreach (var r in rows) Assert.True(r.JsMathMiss == 0, $"{r.Fn}: {r.JsMathMiss} mismatches, first {r.FirstMiss}");
    }

    [Fact]
    public void No_tunnelling_through_the_rim_tube_at_20_m_per_s_with_SUB_4()
    {
        var r = Tunnel.Run(20, Ball.SUB);
        Assert.True(r.Trajectories > 5000);
        Assert.True(r.Contacted > r.Trajectories / 2, "most of the grid actually hits the rim");
        Assert.Equal(0, r.Through);
        Assert.Equal(0, r.Inside);
    }

    [Fact]
    public void Parity_end_condition_matches_the_exporter()
    {
        // the C# mirror of flightEnded must stop exactly where the JS did (checked for every shot by the replay); a
        // ball at rest on the floor ends the flight
        var b = new Ball { y = Constants.BALL_R, vy = 0, vx = 0.01, vz = 0 };
        Assert.True(Replay.FlightEnded(b, 0));
        Assert.False(Replay.FlightEnded(new Ball { y = 2 }, 0));
        Assert.True(Replay.FlightEnded(new Ball { y = 2 }, Replay.MAX_TICKS));
    }
}
