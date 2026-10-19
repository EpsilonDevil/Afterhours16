using Godot;
namespace Rimrift;
/// Toolchain probe: renders one frame of the scene, saves it, prints the renderer, quits.
public partial class SpikeProbe : Node3D
{
    private int _frames;
    public override void _Ready()
    {
        GD.Print("rimrift probe: adapter=", RenderingServer.GetVideoAdapterName(), " api=", RenderingServer.GetVideoAdapterApiVersion(), " method=", RenderingServer.GetCurrentRenderingMethod());
        GD.Print("rim y from Rimrift.Sim = ", Rimrift.Sim.COURT.rimY); // (World agent: Constants.RimY moved to COURT.rimY in the Rules agent's port)
    }
    public override void _Process(double delta)
    {
        if (++_frames != 3) return;
        var img = GetViewport().GetTexture().GetImage();
        var outPath = OS.GetEnvironment("RIMRIFT_PROBE_OUT");
        if (string.IsNullOrEmpty(outPath)) outPath = "user://probe.png";
        img.SavePng(outPath);
        GD.Print("rimrift probe: saved ", outPath, " ", img.GetWidth(), "x", img.GetHeight());
        GetTree().Quit();
    }
}
