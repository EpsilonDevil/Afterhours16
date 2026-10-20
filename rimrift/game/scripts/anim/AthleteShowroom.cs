// The character-sheet showroom: neutral studio lighting on a dark Carbon floor, front/back/face cameras framed like
// kit/RIMRIFT/images/character-visual-target.png plus a 3/4 motion camera, and a scripted sequence (stand, dribble,
// jumper, land) with frame captures. Frame-saver modelled on scripts/SpikeProbe.cs: pass the shots in
//   RIMRIFT_SHOTS="name:camera:seconds,..."   (cameras: front, back, face, motion)   RIMRIFT_SHOT_DIR=/abs/dir
// and the scene steps the animator to each time, renders, saves <dir>/<name>.png and quits after the last.
// Without RIMRIFT_SHOTS it just plays the sequence on a loop (for the editor / David's PC).
using Godot;
using System;
using System.Collections.Generic;
using Rimrift.Anim;

namespace Rimrift.Anim.Godot;

public partial class AthleteShowroom : Node3D
{
    AthleteDriver _ath = null!;
    MeshInstance3D _ball = null!;
    readonly Dictionary<string, Camera3D> _cams = new();
    List<(string name, string cam, double t)> _shots = new();
    int _shotIdx = -1; int _settle; string _dir = "";
    const double G = 9.81;
    // the jumper (the same numbers the parity trace uses): takeoff 0.22 s after the press, ideal release at 0.60 s
    const double SHOT_T0 = 3.0, SHOT_TREL = 0.6, SHOT_TAKEOFF = 0.22;
    static readonly double ShotVy = G * (SHOT_TREL - SHOT_TAKEOFF), ShotAir = 2 * ShotVy / G;
    const double SEQ_LEN = 6.0;
    AnimAction? _shot;

    public override void _Ready()
    {
        _ath = GetNode<AthleteDriver>("Athlete");
        _ball = GetNode<MeshInstance3D>("Ball");
        foreach (var n in new[] { "front", "back", "face", "motion" }) _cams[n] = GetNode<Camera3D>("Cam_" + n);
        // extra capture cameras without touching the scene: RIMRIFT_SHOT_CAMS="name:ex,ey,ez:tx,ty,tz:fov;..." (e.g. a side view
        // for the shot diagnosis); they are ordinary names for RIMRIFT_SHOTS
        var extra = OS.GetEnvironment("RIMRIFT_SHOT_CAMS");
        if (!string.IsNullOrEmpty(extra))
        {
            var inv = System.Globalization.CultureInfo.InvariantCulture;
            foreach (var spec in extra.Split(';', StringSplitOptions.RemoveEmptyEntries))
            {
                var p = spec.Split(':'); var e = Array.ConvertAll(p[1].Split(','), s => float.Parse(s, inv)); var t = Array.ConvertAll(p[2].Split(','), s => float.Parse(s, inv));
                var c = new Camera3D { Name = "Cam_" + p[0], Fov = p.Length > 3 ? float.Parse(p[3], inv) : 35f, Near = 0.05f };
                AddChild(c); c.Position = new Vector3(e[0], e[1], e[2]); c.LookAt(new Vector3(t[0], t[1], t[2]), Vector3.Up);
                _cams[p[0]] = c;
            }
        }
        _ath.OnTick = Script;
        var shots = OS.GetEnvironment("RIMRIFT_SHOTS");
        _dir = OS.GetEnvironment("RIMRIFT_SHOT_DIR");
        if (!string.IsNullOrEmpty(shots))
        {
            foreach (var s in shots.Split(',', StringSplitOptions.RemoveEmptyEntries))
            {
                var p = s.Split(':');
                _shots.Add((p[0], p[1], double.Parse(p[2], System.Globalization.CultureInfo.InvariantCulture)));
            }
            _ath.Paused = true;
            GD.Print($"showroom: {_shots.Count} shots -> {_dir}; adapter={RenderingServer.GetVideoAdapterName()}");
            NextShot();
        }
    }

    /// the scripted "sim" for one tick at sequence time t (seconds, looping)
    void Script(AthleteDriver a, double tAbs)
    {
        double t = tAbs % SEQ_LEN;
        var p = a.Player; var st = a.State;
        p.Vx = 0; p.Vz = 0; p.Airborne = false; st.Y = 0;
        a.Extra.HasBall = false; a.Extra.BallMode = "held";
        var H2 = a.Anim.H / 2;
        Vector3 Local(double lx, double ly, double lz) => new((float)lx, (float)ly, (float)lz); // (facing +Z at the origin)
        if (t < 1.0 || t >= 5.2)
        {
            if (_shot != null) { p.Action = null; _shot = null; }
            a.Ball = Local(0.6, 0.12, 1.2);
        }
        else if (t < SHOT_T0)
        {
            a.Extra.HasBall = true; a.Extra.BallMode = "dribble";
            double dt = t - 1.0, ph = (dt * 2.2) % 1; p.Dribble.Phase = ph; p.Dribble.Hand = "R";
            double by = 0.12 + 0.75 * Math.Abs(Math.Sin(ph * Math.PI));
            a.Ball = Local(-0.28, by, 0.32);
        }
        else
        {
            if (_shot == null) { _shot = new AnimAction { Type = "shoot", T = 0, TRel = SHOT_TREL, Takeoff = SHOT_TAKEOFF, HasTakeoff = true, Kind = "mid", DRim = 5.2 }; p.Action = _shot; }
            var act = _shot; act.T = t - SHOT_T0;
            double at = act.T;
            if (at >= SHOT_TAKEOFF) { double u = at - SHOT_TAKEOFF; st.Y = Math.Max(0, ShotVy * u - 0.5 * G * u * u); p.Airborne = u < ShotAir; }
            if (at >= SHOT_TREL && !act.Released) { act.Released = true; act.ReleaseAt = SHOT_TREL; }
            a.Extra.HasBall = !act.Released;
            double relY = a.Anim.Model.D.ReachStanding * 0.93;
            if (!act.Released)
            {
                double k = Math.Min(1, at / SHOT_TREL), e = k * k * (3 - 2 * k), y0 = 1.25 * H2;
                a.Ball = Local(0.05 * H2, y0 + (relY - y0) * e, (0.3 + 0.1 * e) * H2);
            }
            else
            {
                double u = at - SHOT_TREL;
                a.Ball = Local(0, relY + 4.5 * u - 0.5 * G * u * u, 0.4 * H2 + 6 * u);
            }
            if (at > SHOT_TAKEOFF + ShotAir + 0.3) { p.Action = null; _shot = null; }
        }
        a.State = st;
    }

    public override void _Process(double delta)
    {
        if (_ath.Ball.HasValue) _ball.Position = _ath.Ball.Value + new Vector3((float)_ath.State.X, (float)_ath.State.Y, (float)_ath.State.Z);
        if (_shotIdx < 0 || _shotIdx >= _shots.Count) return;
        if (++_settle < 3) return;
        var (name, cam, t) = _shots[_shotIdx];
        var img = GetViewport().GetTexture().GetImage();
        var path = System.IO.Path.Combine(_dir, name + ".png");
        img.SavePng(path);
        GD.Print($"showroom: saved {path} ({cam} @ {t:F2}s, tick {_ath.Ticks}) {img.GetWidth()}x{img.GetHeight()}");
        GD.Print($"showroom: metrics {name} @ {t:F2}s: {_ath.PoseMetrics()}");
        NextShot();
    }

    void NextShot()
    {
        _shotIdx++;
        if (_shotIdx >= _shots.Count) { GD.Print("showroom: done"); GetTree().Quit(); return; }
        var (name, cam, t) = _shots[_shotIdx];
        // step the (deterministic) animator forward to the shot's time
        int target = (int)Math.Round(t / _ath.FixedDt);
        if (target < _ath.Ticks) { GD.PushWarning("shots must be in time order; " + name + " skipped"); NextShot(); return; }
        while (_ath.Ticks < target) _ath.Step();
        _cams[cam].Current = true;
        if (cam == "face") { var h = _ath.JointWorld("head"); _cams[cam].LookAt(h + new Vector3(0, 0.03f, 0)); }
        if (cam == "motion") { var hips = _ath.JointWorld("hips"); _cams[cam].LookAt(new Vector3(0, hips.Y + 0.1f, 0)); }
        if (_ath.Ball.HasValue) _ball.Position = _ath.Ball.Value;
        _settle = 0;
    }
}
