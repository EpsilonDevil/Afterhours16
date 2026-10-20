// The G0 spike demo: Harbor Point at sunset (World agent) + one athlete driven by the ported procedural animator
// (Character agent) + the ported deterministic ball solver (Rules agent) throwing real shots at the real rim.
//
// Loop: stand → dribble → jumper; at the release the ball is handed to Rimrift.Sim.Ball (planShot + step at 60 Hz,
// exactly the JS rules), so what you see fly is the parity-proven solver, not Godot physics.
//
// Keys: 1–6 cameras (poster, game, baseline, broadcast, rim, close) · C cycle · A add ten athletes (the fps gate) · R reset
//       athletes · B cycle the body (mh → cc0 → meshy; respawns everyone) · L cycle the groom LOD override
//       (auto → 0 → 1 → 2) · H toggle HUD (fps · athletes · body · groom LOD counts) · Esc quit.
// Env: RIMRIFT_BODY=meshy|mh|cc0 (default meshy), RIMRIFT_DEMO_EXTRAS=n, RIMRIFT_GROOM_LOD=auto|0|1|2,
//      RIMRIFT_DEMO_SHOTS / RIMRIFT_SHOT_DIR (capture mode), RIMRIFT_HUD=0 (no HUD: clean look-dev captures).
using Godot;
using System;
using System.Collections.Generic;
using Rimrift.Anim;
using Rimrift.Anim.Godot;
using Rimrift.Sim;
using Rimrift.World;

namespace Rimrift;

public partial class Demo : Node3D
{
    const double G = 9.81;
    const double SHOT_T0 = 3.0, SHOT_TREL = 0.6, SHOT_TAKEOFF = 0.22, SEQ_LEN = 9.0;
    static readonly double ShotVy = G * (SHOT_TREL - SHOT_TAKEOFF), ShotAir = 2 * ShotVy / G;

    HarborPoint _park = null!;
    AthleteDriver _ath = null!;
    MeshInstance3D _ball = null!;
    Label _hud = null!;
    readonly List<Camera3D> _cams = new();
    readonly List<string> _camNames = new();
    int _cam;
    readonly List<AthleteDriver> _extras = new();
    PackedScene _athleteScene = GD.Load<PackedScene>("res://scenes/athlete/AthleteMeshy.tscn");
    static readonly string[] BodyScenes = { "res://scenes/athlete/AthleteMeshy.tscn", "res://scenes/athlete/AthleteMH.tscn", "res://scenes/athlete/Athlete.tscn" };
    int _body;  // index into AthleteDriver.Bodies / BodyScenes
    int _lodOverride = -1;

    // the shooter's spot on Court0 (court-local = world for Court0): just inside the arc, facing +Z toward Rim+
    static readonly Vector3 Spot = new(1.2f, 0, 6.3f);
    AnimAction? _shot; bool _shotDone;
    Ball? _flight;
    readonly List<BallEvent> _events = new();
    readonly Rimrift.Sim.Rng _rng = new(7);
    int _shots, _made, _planMade, _planAgree;
    string _last = "";
    bool _hudOn = true;
    double _fpsAcc, _fpsMin = 999;
    int _fpsN;

    public override void _Ready()
    {
        _park = GetNode<HarborPoint>("HarborPoint");
        var envBody = OS.GetEnvironment("RIMRIFT_BODY");
        for (int i = 0; i < AthleteDriver.Bodies.Length; i++) if (AthleteDriver.Bodies[i].name == envBody) _body = i;
        _athleteScene = GD.Load<PackedScene>(BodyScenes[_body]);
        var envLod = OS.GetEnvironment("RIMRIFT_GROOM_LOD");
        if (!string.IsNullOrEmpty(envLod) && envLod != "auto") _lodOverride = int.Parse(envLod);
        if (_body != 0) { GetNode<AthleteDriver>("Athlete").QueueFree(); var a0 = _athleteScene.Instantiate<AthleteDriver>(); a0.Name = "Athlete2"; AddChild(a0); _ath = a0; }
        else _ath = GetNode<AthleteDriver>("Athlete");
        _ath.GroomLodOverride = _lodOverride;
        _ball = GetNode<MeshInstance3D>("Ball");
        _hud = GetNode<Label>("UI/HUD");
        if (OS.GetEnvironment("RIMRIFT_HUD") == "0") { _hudOn = false; _hud.Visible = false; } // clean look-dev captures
        var rim = _park.Rim(0, 1).GlobalPosition;
        GD.Print($"demo: Court0 Rim+ at {rim} (sim rimPos(+1) = (0, {COURT.rimY}, {COURT.hoopZ}))");
        _ath.State = new AnimState { X = Spot.X, Y = 0, Z = Spot.Z, Facing = 0 }; // placement lives in the sim state (ApplyPose sets the transform from it)
        _ath.OnTick = Script;
        // cameras: the World agent's presets (eye, target, vertical fov)
        AddCam("poster", new Vector3(9.5f, 9.0f, -21.5f), new Vector3(-2.5f, 0.8f, 5.0f), 50);
        AddCam("game", new Vector3(0, 8.5f, 4f - 15.5f), new Vector3(0, 0.9f, 4f + 2.2f), 44);
        AddCam("baseline", new Vector3(4.5f, 1.6f, -15.6f), new Vector3(-1.5f, 2.4f, 8f), 55);
        AddCam("broadcast", new Vector3(-19, 8.2f, 0), new Vector3(1.5f, 1.2f, 0), 44);
        AddCam("rim", new Vector3(3.5f, 4.2f, 15.5f), new Vector3(0.6f, 2.2f, 6f), 50);
        // ~3.3 m from the shooter, front three-quarter from the rim side (he faces +Z), framed so the release stays in
        // shot (fingertips reach ~3.2 m with the jump): the full-groom LOD close-up (key 6 / C). Look pass 3: it used to
        // sit behind him and crop the head in the air.
        AddCam("close", new Vector3(-0.9f, 1.8f, 8.8f), new Vector3(1.2f, 1.75f, 6.3f), 58);
        SetCam(1);
        // headless capture mode (the lead's verification): RIMRIFT_DEMO_SHOTS="name:cam:seconds,..." RIMRIFT_SHOT_DIR=/abs
        var shots = OS.GetEnvironment("RIMRIFT_DEMO_SHOTS");
        _dir = OS.GetEnvironment("RIMRIFT_SHOT_DIR");
        var extras = OS.GetEnvironment("RIMRIFT_DEMO_EXTRAS");
        if (!string.IsNullOrEmpty(extras)) AddExtras(int.Parse(extras));
        if (!string.IsNullOrEmpty(shots))
        {
            foreach (var s in shots.Split(',', StringSplitOptions.RemoveEmptyEntries))
            {
                var p = s.Split(':');
                _capture.Add((p[0], p[1], double.Parse(p[2], System.Globalization.CultureInfo.InvariantCulture)));
            }
            _ath.Paused = true; foreach (var x in _extras) x.Paused = true;
            GD.Print($"demo: {_capture.Count} captures -> {_dir}; adapter={RenderingServer.GetVideoAdapterName()}");
            NextCapture();
        }
    }

    readonly List<(string name, string cam, double t)> _capture = new();
    int _capIdx = -1, _settle; string _dir = "";

    void NextCapture()
    {
        _capIdx++;
        if (_capIdx >= _capture.Count) { GD.Print("demo: captures done"); return; }
        var (name, cam, t) = _capture[_capIdx];
        int target = (int)Math.Round(t / _ath.FixedDt);
        while (_ath.Ticks < target) { _ath.Step(); foreach (var x in _extras) x.Step(); }
        int ci = _camNames.IndexOf(cam); if (ci >= 0) SetCam(ci);
        _settle = 0;
    }

    void CaptureFrame()
    {
        if (_capIdx < 0 || _capIdx >= _capture.Count) return;
        if (++_settle < 3) return;
        var (name, cam, t) = _capture[_capIdx];
        var img = GetViewport().GetTexture().GetImage();
        var path = System.IO.Path.Combine(_dir, name + ".png");
        img.SavePng(path);
        var prim = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalPrimitivesInFrame);
        var draws = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame);
        GD.Print($"demo: saved {path} ({cam} @ {t:F2}s, tick {_ath.Ticks}, athletes {1 + _extras.Count}, primitives {prim}, draws {draws}) {img.GetWidth()}x{img.GetHeight()}");
        GD.Print($"demo: metrics {name} @ {t:F2}s: {_ath.PoseMetrics()}");
        NextCapture();
    }

    void AddCam(string name, Vector3 eye, Vector3 target, float fov)
    {
        var c = new Camera3D { Name = "Cam_" + name, Fov = fov, Far = 900, Near = 0.1f };
        AddChild(c);
        c.Position = eye; c.LookAt(target, Vector3.Up);
        _cams.Add(c); _camNames.Add(name);
    }

    void SetCam(int i) { _cam = ((i % _cams.Count) + _cams.Count) % _cams.Count; _cams[_cam].Current = true; }

    public override void _UnhandledInput(InputEvent e)
    {
        if (e is not InputEventKey k || !k.Pressed || k.Echo) return;
        switch (k.Keycode)
        {
            case Key.Escape: GetTree().Quit(); break;
            case Key.Key1: SetCam(0); break;
            case Key.Key2: SetCam(1); break;
            case Key.Key3: SetCam(2); break;
            case Key.Key4: SetCam(3); break;
            case Key.Key5: SetCam(4); break;
            case Key.Key6: SetCam(5); break;
            case Key.C: SetCam(_cam + 1); break;
            case Key.H: _hudOn = !_hudOn; _hud.Visible = _hudOn; break;
            case Key.A: AddExtras(10); break;
            case Key.R: foreach (var x in _extras) x.QueueFree(); _extras.Clear(); _fpsMin = 999; break;
            case Key.B: SetBody((_body + 1) % BodyScenes.Length); break;
            case Key.L: _lodOverride = _lodOverride >= 2 ? -1 : _lodOverride + 1; _ath.GroomLodOverride = _lodOverride; foreach (var x in _extras) x.GroomLodOverride = _lodOverride; break;
        }
    }

    /// swap every athlete to another body (the fps comparison old-vs-new): respawns the shooter and the extras
    void SetBody(int i)
    {
        _body = i; _athleteScene = GD.Load<PackedScene>(BodyScenes[_body]);
        int n = _extras.Count;
        foreach (var x in _extras) x.QueueFree(); _extras.Clear();
        _ath.QueueFree();
        var a = _athleteScene.Instantiate<AthleteDriver>(); a.Name = "Athlete" + GD.Randi(); AddChild(a);
        a.State = new AnimState { X = Spot.X, Y = 0, Z = Spot.Z, Facing = 0 }; a.OnTick = Script; a.GroomLodOverride = _lodOverride;
        _ath = a; _shot = null; _shotDone = false; _flight = null;
        AddExtras(n);
        GD.Print($"demo: body -> {AthleteDriver.Bodies[_body].name}");
    }

    /// ten more athletes around Court0 (idle / dribbling / walking), for the "60 fps with 10 athletes" gate
    void AddExtras(int n)
    {
        for (int i = 0; i < n; i++)
        {
            var a = _athleteScene.Instantiate<AthleteDriver>();
            a.Verbose = false;
            int idx = _extras.Count;
            double ang = idx * 0.62, r = 3.2 + (idx % 3) * 1.4;
            double px = Math.Cos(ang) * r, pz = 2.5 + Math.Sin(ang) * r * 0.6;
            int phase = idx * 37;
            a.OnTick = (d, t) => ExtraScript(d, t + phase * d.FixedDt, idx);
            a.GroomLodOverride = _lodOverride;
            AddChild(a);
            a.State = new AnimState { X = px, Y = 0, Z = pz, Facing = ang };
            _extras.Add(a);
        }
        _fpsMin = 999;
    }

    static void ExtraScript(AthleteDriver a, double t, int idx)
    {
        var p = a.Player; var st = a.State;
        p.Vx = 0; p.Vz = 0; p.Airborne = false; st.Y = 0;
        a.Extra.HasBall = false; a.Extra.BallMode = "held";
        double cyc = t % 6.0;
        if (idx % 3 == 0 && cyc < 3.0)
        {   // dribbler
            a.Extra.HasBall = true; a.Extra.BallMode = "dribble";
            double ph = (cyc * 2.0) % 1; p.Dribble.Phase = ph; p.Dribble.Hand = idx % 2 == 0 ? "R" : "L";
            a.Ball = new Vector3(idx % 2 == 0 ? -0.28f : 0.28f, (float)(0.12 + 0.75 * Math.Abs(Math.Sin(ph * Math.PI))), 0.32f);
        }
        else if (idx % 3 == 1 && cyc < 4.0)
        {   // walker on the spot (locomotion gait, no translation so they stay put)
            p.Vx = 0.9 * Math.Cos(idx); p.Vz = 0.9 * Math.Sin(idx);
        }
        a.State = st;
    }

    /// the shooter's script, one 60 Hz tick
    void Script(AthleteDriver a, double tAbs)
    {
        double t = tAbs % SEQ_LEN;
        var p = a.Player; var st = a.State;
        p.Vx = 0; p.Vz = 0; p.Airborne = false; st.Y = 0;
        a.Extra.HasBall = false; a.Extra.BallMode = "held";
        var H2 = a.Anim.H / 2;
        Vector3 Local(double lx, double ly, double lz) => new((float)lx, (float)ly, (float)lz);
        if (t < 1.0)
        {
            if (_shot != null) { p.Action = null; _shot = null; }
            _shotDone = false;
            if (_flight == null) a.Ball = Local(0.6, 0.12, 1.2);
        }
        else if (t < SHOT_T0)
        {
            _flight = null;
            a.Extra.HasBall = true; a.Extra.BallMode = "dribble";
            double dt = t - 1.0, ph = (dt * 2.2) % 1; p.Dribble.Phase = ph; p.Dribble.Hand = "R";
            a.Ball = Local(-0.28, 0.12 + 0.75 * Math.Abs(Math.Sin(ph * Math.PI)), 0.32);
        }
        else if (t < SHOT_T0 + 2.0 && !_shotDone)
        {
            if (_shot == null) { _shot = new AnimAction { Type = "shoot", T = 0, TRel = SHOT_TREL, Takeoff = SHOT_TAKEOFF, HasTakeoff = true, Kind = "mid", DRim = 6.5 }; p.Action = _shot; }
            var act = _shot; act.T = t - SHOT_T0;
            double at = act.T;
            if (at >= SHOT_TAKEOFF) { double u = at - SHOT_TAKEOFF; st.Y = Math.Max(0, ShotVy * u - 0.5 * G * u * u); p.Airborne = u < ShotAir; }
            double relY = a.Anim.Model.D.ReachStanding * 0.93;
            if (at >= SHOT_TREL && !act.Released)
            {
                act.Released = true; act.ReleaseAt = SHOT_TREL;
                Launch(a, Local(0.05 * H2, relY, 0.4 * H2));
            }
            a.Extra.HasBall = !act.Released;
            if (!act.Released)
            {
                double k = Math.Min(1, at / SHOT_TREL), e = k * k * (3 - 2 * k), y0 = 1.25 * H2;
                a.Ball = Local(0.05 * H2, y0 + (relY - y0) * e, (0.3 + 0.1 * e) * H2);
            }
            else a.Ball = null;
            if (at > SHOT_TAKEOFF + ShotAir + 0.3) { p.Action = null; _shot = null; _shotDone = true; }
        }
        else a.Ball = null;
        a.State = st;
        StepFlight();
    }

    /// hand the ball to the ported solver: the JS planShot (make decided first, trajectory solved to match) + Ball.step
    void Launch(AthleteDriver a, Vector3 local)
    {
        var P0 = a.Transform * local; // the transform already carries the jump (placeY)
        var P = new Rimrift.Sim.Vec3(P0.X, P0.Y, P0.Z);
        var rim = Constants.rimPos(1);
        bool make = _rng.Chance(0.55);
        var plan = Shots.planShot(_rng, P, rim, 1, make, 52, new PlanOpts { halfOnly = true, surface = "blacktop" });
        var b = new Ball { halfOnly = true, surface = "blacktop" };
        b.setFlight(P.x, P.y, P.z, plan.vx, plan.vy, plan.vz, "shot", null);
        b.wx = plan.wx; b.wy = plan.wy; b.wz = plan.wz;
        _flight = b; _events.Clear();
        _shots++; if (plan.made) _planMade++;
        _last = $"shot {_shots}: planned {(plan.made ? "MAKE" : "MISS")}{(plan.bank == true ? " (bank)" : "")} from ({P.x:F2}, {P.y:F2}, {P.z:F2}) v=({plan.vx:F2}, {plan.vy:F2}, {plan.vz:F2})";
        GD.Print("demo: " + _last);
    }

    void StepFlight()
    {
        if (_flight == null) return;
        var b = _flight;
        b.step(1.0 / 60, _events);
        foreach (var ev in _events)
        {
            if (ev.Type == "through") { _made++; if (ev.Side == 1) _planAgree++; }
            GD.Print("demo:   " + ev);
        }
        _events.Clear();
        if (b.floorBounces >= 3 || b.y < -1 || Math.Abs(b.x) > 12 || Math.Abs(b.z) > 20 || b.flightTime > 8)
        {
            _last += b.scoredFlag != 0 ? " → went through" : " → missed";
            _flight = null;
        }
    }

    public override void _Process(double delta)
    {
        if (_flight != null) _ball.Position = new Vector3((float)_flight.x, (float)_flight.y, (float)_flight.z);
        else if (_ath.Ball.HasValue) _ball.Position = _ath.Transform * _ath.Ball.Value;
        CaptureFrame();
        double fps = Engine.GetFramesPerSecond();
        _fpsAcc += fps; _fpsN++;
        if (_fpsN > 120 && fps < _fpsMin) _fpsMin = fps; // ignore the warm-up
        if (!_hudOn) return;
        var prim = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalPrimitivesInFrame);
        var draws = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame);
        int l0 = 0, l1 = 0, l2 = 0; float dmin = 999, dmax = 0;
        void Count(AthleteDriver a) { if (a.GroomLod == 0) l0++; else if (a.GroomLod == 1) l1++; else l2++; dmin = Math.Min(dmin, a.CameraDistance); dmax = Math.Max(dmax, a.CameraDistance); }
        Count(_ath); foreach (var x in _extras) Count(x);
        _hud.Text = $"RIMRIFT  G0 spike demo  ·  {RenderingServer.GetVideoAdapterName()}  ·  {RenderingServer.GetCurrentRenderingMethod()}\n" +
                    $"fps {fps:F0}  (min after warm-up {(_fpsMin > 998 ? 0 : _fpsMin):F0})  ·  athletes {1 + _extras.Count}  ·  body {AthleteDriver.Bodies[_body].name}  ·  triangles {prim:N0}  ·  draw calls {draws}\n" +
                    $"groom LOD [{(_lodOverride < 0 ? "auto" : _lodOverride.ToString())}]  full {l0} · hair-only {l1} · helmet {l2}  ·  camera distance {dmin:F1}–{dmax:F1} m  (mid > {_ath.GroomLodMid:F0} m, far > {_ath.GroomLodFar:F0} m)\n" +
                    $"camera [{_cam + 1}] {_camNames[_cam]}  ·  shots {_shots}  through {_made}  (planner said make {_planMade})\n" +
                    $"{_last}\n" +
                    "1-6 cameras · C cycle · A +10 athletes · R reset · B body · L groom LOD · H hide · Esc quit";
    }
}
