using Godot;
using System;
using System.Collections.Generic;
using System.Globalization;

namespace Rimrift.World;

/// <summary>
/// Frame saver for the world scenes (modelled on scripts/SpikeProbe.cs). Only acts when RIMRIFT_PROBE_OUT is set:
/// places the camera from RIMRIFT_CAM (a preset name or "x,y,z,tx,ty,tz,fov"), renders RIMRIFT_FRAMES frames (TAA
/// and the volumetric fog need a few to settle), saves the PNG, prints the RenderingServer budget numbers and quits.
/// Presets: poster (the kit's visual target), game (camera.js 2K cam, a possession toward +Z on Court 1),
/// game_half (a 2v2 half court), broadcast (camera.js broadcast cam), top (plan view for the layout proof), beach, plaza.
/// </summary>
public partial class WorldProbe : Node
{
    private int _frames;
    private int _want = 12;
    private string _out = "";
    private Camera3D? _cam;
    private Vector3 _pos, _tgt, _up = Vector3.Up;

    public static readonly Dictionary<string, (Vector3 pos, Vector3 tgt, float fov)> Presets = new()
    {
        // the poster: high three-quarter from behind the main court's baseline, the rim right of frame, the sea beyond
        ["poster"] = (new Vector3(9.5f, 9.0f, -21.5f), new Vector3(-2.5f, 0.8f, 5.0f), 50),
        // camera.js 2K cam, full court, attacking +Z with the play at z ≈ 4: pos (0, 7.6+0.9, fz-15.5), tgt (0, 0.9, fz+2.2), fov 44
        ["game"] = (new Vector3(0, 8.5f, 4f - 15.5f), new Vector3(0, 0.9f, 4f + 2.2f), 44),
        ["game_rim"] = (new Vector3(0, 8.5f, 9f - 15.5f), new Vector3(0, 0.9f, 9f + 2.2f), 44),
        // camera.js 2K cam on a half court (Court 4, 2v2 at -52,-15): pos (ox, 7.9, oz+min(fz,9)-16.5), tgt (ox, 0.9, oz+fz+2.2)
        ["game_half"] = (new Vector3(-52, 7.9f, -15 + 5 - 16.5f), new Vector3(-52, 0.9f, -15 + 5 + 2.2f), 44),
        // camera.js broadcast cam, full court: pos (ox-19, 8.2, oz+z), tgt (ox+1.5, 1.2, oz+z), fov 44
        ["broadcast"] = (new Vector3(-19, 8.2f, 0), new Vector3(1.5f, 1.2f, 0), 44),
        ["top"] = (new Vector3(0, 118, 12), new Vector3(0, 0, 12), 60), // plan: +Z (the sea) up the screen, +X to the left, like the game camera
        // a low angle from behind the main court's -Z baseline, the far hoop and the sea beyond
        ["baseline"] = (new Vector3(4.5f, 1.6f, -15.6f), new Vector3(-1.5f, 2.4f, 8f), 55),
        ["beach"] = (new Vector3(-30, 6, 20), new Vector3(10, 1.5f, 48), 55),
        ["plaza"] = (new Vector3(-10, 5, -45), new Vector3(-20, 2, -20), 60),
    };

    public override void _Ready()
    {
        _out = OS.GetEnvironment("RIMRIFT_PROBE_OUT");
        if (string.IsNullOrEmpty(_out)) return;
        var f = OS.GetEnvironment("RIMRIFT_FRAMES"); if (!string.IsNullOrEmpty(f)) _want = int.Parse(f);
        var camSpec = OS.GetEnvironment("RIMRIFT_CAM"); if (string.IsNullOrEmpty(camSpec)) camSpec = "poster";
        Vector3 pos, tgt; float fov;
        if (Presets.TryGetValue(camSpec, out var p)) { (pos, tgt, fov) = p; if (camSpec == "top") _up = Vector3.Back; }
        else
        {
            var v = Array.ConvertAll(camSpec.Split(','), s => float.Parse(s, CultureInfo.InvariantCulture));
            pos = new Vector3(v[0], v[1], v[2]); tgt = new Vector3(v[3], v[4], v[5]); fov = v.Length > 6 ? v[6] : 44;
        }
        _cam = new Camera3D { Name = "ProbeCam", Fov = fov, Near = 0.1f, Far = 900 };
        // (the parent is still setting up its children during _Ready: add the camera on the first frame instead)
        _pos = pos; _tgt = tgt;
        GD.Print($"probe: {camSpec} pos {pos} tgt {tgt} fov {fov} adapter={RenderingServer.GetVideoAdapterName()} method={RenderingServer.GetCurrentRenderingMethod()}");
    }

    public override void _Process(double delta)
    {
        if (string.IsNullOrEmpty(_out)) return;
        if (_cam != null && !_cam.IsInsideTree()) { GetParent().AddChild(_cam); _cam.LookAtFromPosition(_pos, _tgt, _up); _cam.Current = true; }
        if (++_frames != _want) return;
        var img = GetViewport().GetTexture().GetImage();
        img.SavePng(_out);
        var rs = RenderingServer.Singleton;
        ulong prims = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalPrimitivesInFrame);
        ulong draws = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame);
        ulong objs = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalObjectsInFrame);
        ulong vmem = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.VideoMemUsed);
        ulong tmem = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TextureMemUsed);
        ulong bmem = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.BufferMemUsed);
        GD.Print($"probe: saved {_out} {img.GetWidth()}x{img.GetHeight()}");
        GD.Print($"probe: rendering_info primitives={prims} draw_calls={draws} objects={objs} video_mem={vmem / 1048576.0:F1}MB texture_mem={tmem / 1048576.0:F1}MB buffer_mem={bmem / 1048576.0:F1}MB");
        if (GetParent() is HarborPoint hp)
        {
            var rows = new List<string>(); int total = 0;
            foreach (var kv in hp.Triangles) { rows.Add($"{kv.Key}={kv.Value}"); total += kv.Value; }
            GD.Print($"probe: scene triangles total={total} " + string.Join(" ", rows));
        }
        GetTree().Quit();
    }
}
