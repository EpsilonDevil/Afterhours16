using Godot;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Rimrift.World;

/// <summary>
/// Jolt ball-on-rim tunnelling test (the Jolt half of the G0 "no tunnelling at 20 m/s" gate). Headless:
///   godot --headless --fixed-fps 60 --path game scenes/harbor/JoltRimTest.tscn
/// Builds LANES independent rim+ball pairs (rim at the sim's dims: torus centreline 0.2381 m = rimR + rimTube,
/// tube 0.0095 m, at y 3.05; backboard 1.83 x 1.07 with its bottom at y 2.9, face 0.38 m behind the rim centre),
/// fires the ball at 15 / 20 / 25 m/s from a scatter of directions aimed at the ring's tube, and for every physics
/// tick checks the swept path of the ball centre against the tube analytically: if the sweep came within
/// (tube + ballR - margin) of the ring's centreline circle the ball must have reported a contact on that tick or
/// its neighbours, otherwise it tunnelled. It also flags deep penetrations (centre closer than tube + ballR - 4 cm
/// at a tick) and balls that end inside the tube. Configurations: rim collision as a ring of capsules, a convex
/// decomposition (one convex hull per ring segment) or a trimesh torus; 60 / 120 / 240 Hz ticks; CCD on / off.
/// Prints a table. Run with --fixed-fps 60 so the headless loop advances the clock per frame, not per wall-clock.
/// </summary>
public partial class JoltRimTest : Node3D
{
    [Export] public int Lanes = 64;
    [Export] public int TrajectoriesPerCase = 300;
    [Export] public string Shapes = "capsules,convex,trimesh";
    [Export] public string Rates = "60,120,240";
    [Export] public string Ccds = "on,off";
    [Export] public float[] Speeds = { 15, 20, 25 };

    private const float RT = CourtDims.RimR + CourtDims.RimTube; // 0.2381 torus centreline (sim ball.js)
    private const float TUBE = CourtDims.RimTube, BALL = CourtDims.BallR, RIM_Y = CourtDims.RimY;
    private const float TOUCH = TUBE + BALL;                    // 0.1289: centre-to-ring distance at contact
    private const float LANE_SPACING = 12f;

    private sealed class Lane
    {
        public Node3D Root = null!; public RigidBody3D Ball = null!; public StaticBody3D Rim = null!;
        public Vector3 Origin;
        public int Traj = -1; public int Tick; public int TicksToRun;
        public Vector3 PrevLocal; public bool Deep; public float MinD = 9; public int ContactTicks;
        public List<(int tick, bool should, bool contact)> Log = new();
    }
    private sealed class Case
    {
        public string Shape = ""; public int Hz; public bool Ccd; public float Speed;
        public int N, ShouldTouch, Touched, Tunnel, Deep, InsideAtEnd;
        public override string ToString() => $"{Shape,-9} {Hz,4} Hz  ccd {(Ccd ? "on " : "off")}  {Speed,4:F0} m/s   n={N,4}  touch_expected={ShouldTouch,4}  contacted={Touched,4}  tunnelled={Tunnel,3} ({(ShouldTouch > 0 ? 100.0 * Tunnel / ShouldTouch : 0),5:F1}%)  deep_pen={Deep,3}  inside_at_end={InsideAtEnd}";
    }

    private readonly List<Lane> _lanes = new();
    private readonly List<Case> _cases = new();
    private readonly List<(Vector3 pos, Vector3 vel, bool aimedAtTube)> _trajs = new();
    private int _caseIdx = -1, _nextTraj, _running;
    private Case? _case;
    private PhysicsMaterial _ballMat = null!;
    private readonly List<string> _notes = new();

    public override void _Ready()
    {
        GD.Print($"jolt: physics_engine={ProjectSettings.GetSetting("physics/3d/physics_engine")} ticks={Engine.PhysicsTicksPerSecond}");
        GD.Print($"jolt: rim torus centreline {RT:F4} m (rimR {CourtDims.RimR} + tube {TUBE}), tube {TUBE} m, ball r {BALL} m, contact distance {TOUCH:F4} m");
        _ballMat = new PhysicsMaterial { Bounce = 0.75f, Friction = 0.6f };
        Engine.MaxPhysicsStepsPerFrame = 64; // run with --fixed-fps 60 --headless: each frame advances 1/60 s as fast as the CPU allows
        var env = OS.GetEnvironment("RIMRIFT_JOLT_TRAJ"); if (!string.IsNullOrEmpty(env)) TrajectoriesPerCase = int.Parse(env);
        foreach (var sh in Shapes.Split(',')) foreach (var hz in Rates.Split(',')) foreach (var cc in Ccds.Split(',')) foreach (var sp in Speeds)
            _cases.Add(new Case { Shape = sh.Trim(), Hz = int.Parse(hz), Ccd = cc.Trim() == "on", Speed = sp });
        BuildLanes("capsules");
        NextCase();
    }

    // ---------------- geometry ----------------
    private void BuildLanes(string shape)
    {
        foreach (var l in _lanes) l.Root.QueueFree();
        _lanes.Clear();
        int side = Mathf.CeilToInt(Mathf.Sqrt(Lanes));
        for (int i = 0; i < Lanes; i++)
        {
            var lane = new Lane { Origin = new Vector3((i % side) * LANE_SPACING, 0, (i / side) * LANE_SPACING) };
            lane.Root = new Node3D { Position = lane.Origin };
            AddChild(lane.Root);
            lane.Rim = new StaticBody3D { Name = "Rim" };
            lane.Root.AddChild(lane.Rim);
            AddRimShapes(lane.Rim, shape);
            // the backboard: a box 1.83 x 1.07 x 0.05 whose face is boardZ - hoopZ = 0.38 m behind the rim centre
            float boardFace = CourtDims.BoardZ - CourtDims.HoopZ, boardCY = CourtDims.BoardBottom + CourtDims.BoardH / 2;
            var board = new CollisionShape3D { Shape = new BoxShape3D { Size = new Vector3(CourtDims.BoardW, CourtDims.BoardH, CourtDims.BoardT) }, Position = new Vector3(0, boardCY, boardFace + CourtDims.BoardT / 2) };
            lane.Rim.AddChild(board);
            lane.Rim.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = new Vector3(11, 0.2f, 11) }, Position = new Vector3(0, -0.1f, 0) }); // the floor
            lane.Ball = new RigidBody3D { Name = "Ball", Mass = 0.62f, PhysicsMaterialOverride = _ballMat, ContactMonitor = true, MaxContactsReported = 8, ContinuousCd = true, CanSleep = false, Position = new Vector3(0, 1, 3) };
            lane.Ball.AddChild(new CollisionShape3D { Shape = new SphereShape3D { Radius = BALL } });
            lane.Root.AddChild(lane.Ball);
            _lanes.Add(lane);
        }
    }

    private static void AddRimShapes(StaticBody3D rim, string shape)
    {
        const int N = 24;
        if (shape == "capsules")
        {
            // 24 capsules along the ring, each a chord with a little overlap, radius = the tube
            float chord = 2 * RT * Mathf.Sin(Mathf.Pi / N);
            for (int i = 0; i < N; i++)
            {
                float a = (i + 0.5f) / N * Mathf.Tau;
                var cs = new CollisionShape3D { Shape = new CapsuleShape3D { Radius = TUBE, Height = chord + 2 * TUBE } };
                // a capsule's axis is Y: lay it tangentially (yaw a, then tip over 90° about X)
                cs.Transform = new Transform3D(new Basis(Vector3.Up, -a) * new Basis(Vector3.Right, Mathf.Pi / 2), new Vector3(Mathf.Cos(a) * RT, RIM_Y, Mathf.Sin(a) * RT));
                rim.AddChild(cs);
            }
        }
        else if (shape == "convex")
        {
            // convex decomposition: one convex hull per ring segment (two 12-point tube cross-sections)
            const int T = 12;
            for (int i = 0; i < N; i++)
            {
                var pts = new List<Vector3>();
                foreach (var a in new[] { (float)i / N * Mathf.Tau, (float)(i + 1) / N * Mathf.Tau })
                    for (int j = 0; j < T; j++) { float b = (float)j / T * Mathf.Tau; pts.Add(new Vector3((RT + TUBE * Mathf.Cos(b)) * Mathf.Cos(a), RIM_Y + TUBE * Mathf.Sin(b), (RT + TUBE * Mathf.Cos(b)) * Mathf.Sin(a))); }
                rim.AddChild(new CollisionShape3D { Shape = new ConvexPolygonShape3D { Points = pts.ToArray() } });
            }
        }
        else
        {
            // trimesh torus (48 x 12), both faces collide
            const int R = 48, T = 12;
            var faces = new List<Vector3>();
            Vector3 P(int i, int j) { float a = (float)i / R * Mathf.Tau, b = (float)j / T * Mathf.Tau; return new Vector3((RT + TUBE * Mathf.Cos(b)) * Mathf.Cos(a), RIM_Y + TUBE * Mathf.Sin(b), (RT + TUBE * Mathf.Cos(b)) * Mathf.Sin(a)); }
            for (int i = 0; i < R; i++) for (int j = 0; j < T; j++)
            {
                faces.Add(P(i, j)); faces.Add(P(i + 1, j)); faces.Add(P(i, j + 1));
                faces.Add(P(i + 1, j)); faces.Add(P(i + 1, j + 1)); faces.Add(P(i, j + 1));
            }
            rim.AddChild(new CollisionShape3D { Shape = new ConcavePolygonShape3D { Data = faces.ToArray(), BackfaceCollision = true } });
        }
    }

    // ---------------- trajectories ----------------
    private void MakeTrajectories(float speed)
    {
        _trajs.Clear();
        var rng = new Rng(777 + (uint)Mathf.RoundToInt(speed));
        for (int i = 0; i < TrajectoriesPerCase; i++)
        {
            // aim at a point in the tube's cross-section band around the ring
            float th = rng.Range(0, Mathf.Tau);
            float rOff = rng.Range(-TUBE, TUBE), yOff = rng.Range(-TUBE, TUBE);
            var target = new Vector3(Mathf.Cos(th) * (RT + rOff), RIM_Y + yOff, Mathf.Sin(th) * (RT + rOff));
            // from 2.5–5 m away, mostly from the court side (−z) and above, some flat, a few from below
            float az = rng.Range(-Mathf.Pi * 0.55f, Mathf.Pi * 0.55f) + Mathf.Pi; // around −z (the court side; past ±100° the board is in the way)
            float el = rng.Range(-8, 65) * Mathf.Pi / 180, D = rng.Range(2.5f, 5f);
            var dirFrom = new Vector3(Mathf.Sin(az) * Mathf.Cos(el), Mathf.Sin(el), Mathf.Cos(az) * Mathf.Cos(el));
            var start = target + dirFrom * D;
            var dir = (target - start).Normalized();
            float t = D / speed;
            var vel = dir * speed + Vector3.Up * (0.5f * 9.81f * t); // ballistic lift so the apex of the drop lands on target
            _trajs.Add((start, vel, true));
        }
    }

    private void NextCase()
    {
        _caseIdx++;
        if (_caseIdx >= _cases.Count) { Report(); GetTree().Quit(); return; }
        _case = _cases[_caseIdx];
        if (_caseIdx == 0 || _cases[_caseIdx - 1].Shape != _case.Shape) BuildLanes(_case.Shape);
        Engine.PhysicsTicksPerSecond = _case.Hz;
        foreach (var l in _lanes) { l.Ball.ContinuousCd = _case.Ccd; l.Traj = -1; }
        MakeTrajectories(_case.Speed);
        _nextTraj = 0; _running = 0;
        GD.Print($"jolt: case {_caseIdx + 1}/{_cases.Count}: {_case.Shape} {_case.Hz} Hz ccd {(_case.Ccd ? "on" : "off")} {_case.Speed} m/s");
    }

    private void Launch(Lane l, int traj)
    {
        var (pos, vel, _) = _trajs[traj];
        l.Traj = traj; l.Tick = 0; l.Deep = false; l.MinD = 9; l.ContactTicks = 0; l.Log.Clear();
        l.TicksToRun = Mathf.CeilToInt((pos.Length() / vel.Length() + 0.25f) * _case!.Hz);
        l.PrevLocal = pos;
        l.Ball.GlobalTransform = new Transform3D(Basis.Identity, l.Origin + pos);
        l.Ball.LinearVelocity = vel; l.Ball.AngularVelocity = Vector3.Zero;
        _running++;
    }

    private static float RingDist(Vector3 p)
    {
        float rxz = Mathf.Sqrt(p.X * p.X + p.Z * p.Z), dy = p.Y - RIM_Y;
        float dr = rxz - RT; return Mathf.Sqrt(dr * dr + dy * dy);
    }
    private static float SweepMin(Vector3 a, Vector3 b)
    {
        float m = 9; int n = 12;
        for (int i = 0; i <= n; i++) m = Mathf.Min(m, RingDist(a.Lerp(b, (float)i / n)));
        return m;
    }

    public override void _PhysicsProcess(double delta)
    {
        if (_case == null) return;
        // hand free lanes a trajectory
        foreach (var l in _lanes) if (l.Traj < 0 && _nextTraj < _trajs.Count) Launch(l, _nextTraj++);
        // step the running ones
        foreach (var l in _lanes)
        {
            if (l.Traj < 0) continue;
            l.Tick++;
            // read the body from the physics server (the node transform is synced once a frame; a frame holds Hz/60 ticks)
            var st = PhysicsServer3D.BodyGetDirectState(l.Ball.GetRid())!;
            var local = st.Transform.Origin - l.Origin;
            bool contact = st.GetContactCount() > 0;
            if (contact) l.ContactTicks++;
            float sweep = SweepMin(l.PrevLocal, local), here = RingDist(local);
            l.MinD = Mathf.Min(l.MinD, sweep);
            bool should = l.Tick > 2 && sweep < TOUCH; // (ticks 1–2: the teleport to the launch point is still settling) the swept centre came inside the contact distance (the ball geometrically touched the tube): a contact is due
            l.Log.Add((l.Tick, should, contact));
            if (here < TOUCH - 0.04f) l.Deep = true;
            l.PrevLocal = local;
            if (l.Tick >= l.TicksToRun || local.Y < 0.5f)
            {
                // judge: a trajectory whose sweep entered the tube must have a contact within one tick of that window
                int first = -1, last = -1;
                foreach (var e in l.Log) if (e.should) { if (first < 0) first = e.tick; last = e.tick; }
                var c = _case; c.N++;
                if (OS.HasEnvironment("RIMRIFT_JOLT_DEBUG") && l.Traj < 6) GD.Print($"  traj {l.Traj} ticks {l.Tick} minD {l.MinD:F4} first {first} last {last} contacts {l.ContactTicks} end {local}");
                if (first >= 0)
                {
                    c.ShouldTouch++;
                    bool touched = l.Log.Any(e => e.contact && e.tick >= first - 1 && e.tick <= last + 1);
                    if (touched) c.Touched++; else { c.Tunnel++; if (OS.HasEnvironment("RIMRIFT_JOLT_DEBUG")) GD.Print($"  TUNNEL {c.Shape} {c.Hz}Hz ccd {c.Ccd} {c.Speed} traj {l.Traj} minD {l.MinD:F4} window {first}-{last} contact ticks {string.Join(",", l.Log.Where(e => e.contact).Select(e => e.tick))}"); }
                }
                if (l.Deep) c.Deep++;
                if (here < TOUCH - 0.02f) c.InsideAtEnd++;
                l.Log.Clear();
                l.Traj = -1; _running--;
            }
        }
        if (_running == 0 && _nextTraj >= _trajs.Count) NextCase();
    }

    private void Report()
    {
        GD.Print("\njolt tunnelling table (ball r 0.1194 m, 0.62 kg, restitution 0.75; rim centreline 0.2381 m, tube 0.0095 m, y 3.05; " +
                 $"{TrajectoriesPerCase} trajectories per case aimed at the tube; 'tunnelled' = the swept ball centre passed within the contact distance of the ring with no contact reported on that tick or the next)");
        GD.Print("shape      rate     ccd   speed    trajectories / expected contacts / contacted / tunnelled / deep penetrations (>4 cm) / inside tube at end");
        foreach (var c in _cases) GD.Print(c.ToString());
        var sum = new Dictionary<string, (int should, int tun)>();
        foreach (var c in _cases) { var k = $"{c.Shape} {c.Hz}Hz ccd {(c.Ccd ? "on" : "off")}"; var v = sum.GetValueOrDefault(k); sum[k] = (v.should + c.ShouldTouch, v.tun + c.Tunnel); }
        GD.Print("per configuration (all speeds): " + string.Join(" | ", sum.Select(kv => $"{kv.Key}: {kv.Value.tun}/{kv.Value.should}")));
    }
}
