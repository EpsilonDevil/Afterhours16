using Godot;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Rimrift.World;

/// <summary>
/// 'Ten athletes' Jolt load scene: 10 kinematic capsule bodies (CharacterBody3D, r 0.3 m, 1.85 m) running the court
/// with MoveAndSlide, the ball (RigidBody3D, CCD) thrown at a trimesh rim every 2 s, the court floor and the rim's
/// backboard. Headless:  godot --headless --fixed-fps 60 --path game scenes/harbor/TenAthletes.tscn
/// Reports Performance.TimePhysicsProcess per tick (mean / p95 / max over 600 ticks) and the physics monitors.
/// RIMRIFT_ATHLETES=rigid runs them as dynamic capsules (RigidBody3D, rotation locked) instead.
/// </summary>
public partial class TenAthletes : Node3D
{
    [Export] public int Athletes = 10;
    [Export] public int Ticks = 600;
    private readonly List<CharacterBody3D> _kin = new();
    private readonly List<RigidBody3D> _rigid = new();
    private readonly List<Vector3> _goals = new();
    private RigidBody3D _ball = null!;
    private readonly List<double> _times = new();
    private int _tick;
    private Rng _rng = new(99);
    private bool _rigidMode;
    private ulong _last, _t0;
    private bool _done;

    public override void _Ready()
    {
        _rigidMode = OS.GetEnvironment("RIMRIFT_ATHLETES") == "rigid";
        var n = OS.GetEnvironment("RIMRIFT_ATHLETES_N"); if (!string.IsNullOrEmpty(n)) Athletes = int.Parse(n);
        Engine.PhysicsTicksPerSecond = 60;
        // the court floor and the hoop (the +Z rim of Court 0, at the sim's dims)
        var floor = new StaticBody3D { Name = "Floor" };
        floor.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = new Vector3(40, 0.2f, 50) }, Position = new Vector3(0, -0.1f, 0) });
        AddChild(floor);
        var rim = new StaticBody3D { Name = "Rim", Position = new Vector3(0, 0, CourtDims.HoopZ) };
        const int R = 48, T = 12; float RT = CourtDims.RimCentreR, TUBE = CourtDims.RimTube;
        var faces = new List<Vector3>();
        Vector3 P(int i, int j) { float a = (float)i / R * Mathf.Tau, b = (float)j / T * Mathf.Tau; return new Vector3((RT + TUBE * Mathf.Cos(b)) * Mathf.Cos(a), CourtDims.RimY + TUBE * Mathf.Sin(b), (RT + TUBE * Mathf.Cos(b)) * Mathf.Sin(a)); }
        for (int i = 0; i < R; i++) for (int j = 0; j < T; j++) { faces.Add(P(i, j)); faces.Add(P(i + 1, j)); faces.Add(P(i, j + 1)); faces.Add(P(i + 1, j)); faces.Add(P(i + 1, j + 1)); faces.Add(P(i, j + 1)); }
        rim.AddChild(new CollisionShape3D { Shape = new ConcavePolygonShape3D { Data = faces.ToArray(), BackfaceCollision = true } });
        rim.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = new Vector3(CourtDims.BoardW, CourtDims.BoardH, CourtDims.BoardT) }, Position = new Vector3(0, CourtDims.BoardBottom + CourtDims.BoardH / 2, CourtDims.BoardZ - CourtDims.HoopZ + CourtDims.BoardT / 2) });
        AddChild(rim);
        if (Athletes == 0 && OS.GetEnvironment("RIMRIFT_ATHLETES") == "empty") { GD.Print("ten athletes: baseline, no bodies"); return; }
        _ball = new RigidBody3D { Name = "Ball", Mass = 0.62f, ContinuousCd = true, CanSleep = false, PhysicsMaterialOverride = new PhysicsMaterial { Bounce = 0.75f, Friction = 0.6f }, Position = new Vector3(0, 1, 0) };
        _ball.AddChild(new CollisionShape3D { Shape = new SphereShape3D { Radius = CourtDims.BallR } });
        AddChild(_ball);
        for (int i = 0; i < Athletes; i++)
        {
            var pos = new Vector3(_rng.Range(-6, 6), 0.95f, _rng.Range(-12, 12));
            var shape = new CollisionShape3D { Shape = new CapsuleShape3D { Radius = 0.3f, Height = 1.85f } };
            if (_rigidMode)
            {
                var b = new RigidBody3D { Name = $"Athlete{i}", Mass = 90, Position = pos, LockRotation = true, CanSleep = false };
                b.AddChild(shape); AddChild(b); _rigid.Add(b);
            }
            else
            {
                var c = new CharacterBody3D { Name = $"Athlete{i}", Position = pos };
                c.AddChild(shape); AddChild(c); _kin.Add(c);
            }
            _goals.Add(NewGoal());
        }
        GD.Print($"ten athletes: physics_engine={ProjectSettings.GetSetting("physics/3d/physics_engine")} mode={(_rigidMode ? "rigid" : "kinematic")} athletes={Athletes} ticks={Engine.PhysicsTicksPerSecond}");
    }

    private void Measure()
    {
        // Jolt does not feed Godot's physics monitors (they read 0), so the cost is the wall-clock time of one whole
        // headless tick (--fixed-fps 60: the loop runs flat out), compared with the same scene holding no bodies
        ulong now = Time.GetTicksUsec();
        if (_tick == 31) _t0 = now;
        if (_tick > 30 && _last > 0) _times.Add((now - _last) / 1000.0);
        _last = now;
        if (_tick >= Ticks + 30 && !_done)
        {
            _done = true;
            var s = _times.OrderBy(x => x).ToList();
            GD.Print($"ten athletes: whole-tick wall time (physics + script + loop) over {s.Count} ticks: mean {s.Average():F3} ms, median {s[s.Count / 2]:F3} ms, p95 {s[(int)(s.Count * 0.95)]:F3} ms, max {s[^1]:F3} ms; elapsed {(now - _t0) / 1000.0:F1} ms = {(now - _t0) / 1000.0 / s.Count:F3} ms/tick");
            GD.Print($"ten athletes: active objects={Performance.GetMonitor(Performance.Monitor.Physics3DActiveObjects)} collision pairs={Performance.GetMonitor(Performance.Monitor.Physics3DCollisionPairs)} islands={Performance.GetMonitor(Performance.Monitor.Physics3DIslandCount)} ball at {_ball.Position}");
            GetTree().Quit();
        }
    }

    private Vector3 NewGoal() => new(_rng.Range(-7, 7), 0.95f, _rng.Range(-13, 13));

    public override void _PhysicsProcess(double delta)
    {
        if (_done) return;
        _tick++;
        float dt = (float)delta;
        if (_ball == null) { Measure(); return; }
        for (int i = 0; i < Athletes; i++)
        {
            Node3D body = _rigidMode ? _rigid[i] : _kin[i];
            var to = _goals[i] - body.Position; to.Y = 0;
            if (to.Length() < 0.5f) { _goals[i] = NewGoal(); to = _goals[i] - body.Position; to.Y = 0; }
            var v = to.Normalized() * 7.0f; // a sprint
            if (_rigidMode) _rigid[i].LinearVelocity = new Vector3(v.X, _rigid[i].LinearVelocity.Y, v.Z);
            else { _kin[i].Velocity = new Vector3(v.X, _kin[i].Velocity.Y - 9.81f * dt, v.Z); _kin[i].MoveAndSlide(); }
        }
        Measure();
        if (_tick % 120 == 1)
        {
            // a shot from a random spot on the floor at the rim
            var from = new Vector3(_rng.Range(-6, 6), 2.0f, _rng.Range(-4, 8));
            var target = new Vector3(0, CourtDims.RimY + 0.3f, CourtDims.HoopZ);
            float t = 1.2f; var d = target - from;
            var vel = new Vector3(d.X / t, d.Y / t + 0.5f * 9.81f * t, d.Z / t);
            PhysicsServer3D.BodySetState(_ball.GetRid(), PhysicsServer3D.BodyState.Transform, new Transform3D(Basis.Identity, from));
            PhysicsServer3D.BodySetState(_ball.GetRid(), PhysicsServer3D.BodyState.LinearVelocity, vel);
        }
    }
}
