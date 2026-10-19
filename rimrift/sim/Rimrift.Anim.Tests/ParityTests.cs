// Replays harness/traces/anim_*.json (made by harness/anim_traces.mjs from the JS animator) through the C# port and
// compares every tick: the final pose handed to the rig, the smoothed pose, and the rig's joint positions/rotations.
using System.Text.Json;
using Rimrift.Anim;
using Xunit;
using Xunit.Abstractions;

public class ParityTests
{
    readonly ITestOutputHelper o;
    public ParityTests(ITestOutputHelper o) { this.o = o; }

    static string TracePath(string name)
    {
        var dir = AppContext.BaseDirectory;
        for (int i = 0; i < 8 && dir != null; i++) { var c = Path.Combine(dir, "harness", "traces", name); if (File.Exists(c)) return c; dir = Path.GetDirectoryName(dir); }
        throw new FileNotFoundException(name + " (run: node rimrift/harness/anim_traces.mjs)");
    }
    static double D(JsonElement e, string k, double def = 0) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : def;
    static bool Bo(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.True;
    static string? Str(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    static double[] Arr(JsonElement e) => e.EnumerateArray().Select(x => x.GetDouble()).ToArray();

    [Theory]
    [InlineData("anim_77_215_80.json")]
    [InlineData("anim_69_160_67.json")]
    [InlineData("anim_87_268_96.json")]
    public void JsAnimatorTraceReplays(string name)
    {
        var doc = JsonDocument.Parse(File.ReadAllText(TracePath(name)));
        var root = doc.RootElement;
        var b = root.GetProperty("build");
        var build = new Build(D(b, "height"), D(b, "weight"), D(b, "wingspan"));
        var an = new Animator(build);
        double dt = D(root, "dt");
        // body dims against the JS model
        var dims = root.GetProperty("dims");
        Assert.Equal(D(dims, "H"), an.H, 12);
        Assert.Equal(D(dims, "reachStanding"), an.Model.D.ReachStanding, 12);
        var jsBind = root.GetProperty("bind").EnumerateArray().Select(Arr).ToArray();
        for (int i = 0; i < Skeleton.N; i++) for (int k = 0; k < 3; k++) Assert.Equal(jsBind[i][k], an.Model.Bind[i][k], 12);

        var p = new AnimPlayer { Id = 0, Phys = new AnimPhys { Reach = an.Model.D.ReachStanding, H = an.H, Radius = 0.3 }, MoveStyle = "standard" };
        double maxFin = 0, maxSmooth = 0, maxPos = 0, maxRot = 0, maxTarget = 0; int worstTick = -1; string worst = "";
        int n = 0;
        foreach (var tick in root.GetProperty("ticks").EnumerateArray())
        {
            var stj = tick.GetProperty("st");
            var st = new AnimState { X = D(stj, "x"), Y = D(stj, "y"), Z = D(stj, "z"), Facing = D(stj, "facing") };
            var bj = tick.GetProperty("ball"); double[] ball = { D(bj, "x"), D(bj, "y"), D(bj, "z") };
            var pj = tick.GetProperty("p");
            p.Vx = D(pj, "vx"); p.Vz = D(pj, "vz"); p.Airborne = Bo(pj, "airborne"); p.ContestHand = Str(pj, "contestHand"); p.Dribble.Phase = D(pj, "dribblePhase");
            var aj = tick.GetProperty("action");
            if (aj.ValueKind == JsonValueKind.Object)
            {
                var type = Str(aj, "type")!;
                // (the same action object persists across ticks in the JS; a fresh one with the same fields is equivalent)
                var a = p.Action != null && p.Action.Type == type ? p.Action : new AnimAction { Type = type };
                a.T = D(aj, "t"); a.Released = Bo(aj, "released"); a.Jumped = Bo(aj, "jumped"); a.Hit = Bo(aj, "hit");
                a.Kind = Str(aj, "kind");
                if (aj.TryGetProperty("tRel", out _)) a.TRel = D(aj, "tRel");
                if (aj.TryGetProperty("takeoff", out _)) { a.Takeoff = D(aj, "takeoff"); a.HasTakeoff = true; }
                if (aj.TryGetProperty("dRim", out _)) a.DRim = D(aj, "dRim");
                if (aj.TryGetProperty("releaseAt", out var ra) && ra.ValueKind == JsonValueKind.Number) a.ReleaseAt = ra.GetDouble(); else a.ReleaseAt = double.NaN;
                if (aj.TryGetProperty("jumpAt", out _)) a.JumpAt = D(aj, "jumpAt");
                if (aj.TryGetProperty("air", out _)) a.Air = D(aj, "air");
                p.Action = a;
            }
            else p.Action = null;
            var extra = new AnimExtra { HasBall = Bo(tick, "has"), BallMode = Str(tick, "ballMode"), FloorY = 0 };
            an.Update(dt, st, p, null, ball, extra);

            var outj = tick.GetProperty("out");
            var fin = Arr(outj.GetProperty("fin")); var smooth = Arr(outj.GetProperty("smooth")); var target = Arr(outj.GetProperty("target"));
            double eFin = 0, eSm = 0, eT = 0;
            for (int i = 0; i < P.N; i++) { eFin = Math.Max(eFin, Math.Abs(fin[i] - an.outPose[i])); eSm = Math.Max(eSm, Math.Abs(smooth[i] - an.pose[i])); eT = Math.Max(eT, Math.Abs(target[i] - an.target[i])); }
            double ePos = 0, eRot = 0;
            var pos = outj.GetProperty("pos").EnumerateArray().Select(Arr).ToArray();
            var rot = outj.GetProperty("rot").EnumerateArray().Select(Arr).ToArray();
            for (int i = 0; i < Skeleton.N; i++)
            {
                for (int k = 0; k < 3; k++) ePos = Math.Max(ePos, Math.Abs(pos[i][k] - an.Rig.Pos[i][k]));
                // (a quaternion and its negative are the same rotation)
                double s1 = 0, s2 = 0; for (int k = 0; k < 4; k++) { s1 = Math.Max(s1, Math.Abs(rot[i][k] - an.Rig.Rot[i][k])); s2 = Math.Max(s2, Math.Abs(rot[i][k] + an.Rig.Rot[i][k])); }
                eRot = Math.Max(eRot, Math.Min(s1, s2));
            }
            Assert.Equal(Bo(outj, "pinL"), an.lastOpts.PinL); Assert.Equal(Bo(outj, "pinR"), an.lastOpts.PinR);
            Assert.Equal(D(outj, "lookW"), an.lastOpts.LookW, 9);
            double eAll = Math.Max(Math.Max(eFin, ePos), eRot);
            if (eAll > Math.Max(Math.Max(maxFin, maxPos), maxRot)) { worstTick = n; worst = $"tick {n} t={D(tick, "t"):F3} {Str(tick, "phase")} fin={eFin:E2} pos={ePos:E2} rot={eRot:E2}"; }
            maxFin = Math.Max(maxFin, eFin); maxSmooth = Math.Max(maxSmooth, eSm); maxPos = Math.Max(maxPos, ePos); maxRot = Math.Max(maxRot, eRot); maxTarget = Math.Max(maxTarget, eT);
            n++;
        }
        o.WriteLine($"{name}: {n} ticks replayed. max |err|: target {maxTarget:E3}, smoothed pose {maxSmooth:E3}, final pose {maxFin:E3}, joint pos {maxPos:E3} m, joint rot {maxRot:E3}; worst: {worst}");
        o.WriteLine("stubs hit: " + (an.StubsHit.Count == 0 ? "none" : string.Join(", ", an.StubsHit)));
        Assert.True(n > 700, "trace too short");
        Assert.True(maxFin < 1e-5, $"final pose max error {maxFin:E3} ({worst})");
        Assert.True(maxPos < 1e-5, $"joint position max error {maxPos:E3} ({worst})");
        Assert.True(maxRot < 1e-5, $"joint rotation max error {maxRot:E3} ({worst})");
    }
}
