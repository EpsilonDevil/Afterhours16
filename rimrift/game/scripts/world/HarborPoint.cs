using Godot;
using System;
using System.Collections.Generic;

namespace Rimrift.World;

/// <summary>
/// Harbor Point at sunset. The whole park is generated at _Ready from the JS layout export
/// (assets/world/harbor_layout.json) with the maths of venues.js/court.js/props.js/harbor.js ported here, so the
/// courts, rims, fences and props sit exactly where the live game puts them (HarborLayout.Verify proves it on load).
/// Stable nodes for the sim: Court0..Court5 (Node3D at the court origin; the court long axis is local Z), each with
/// Rim+ (and Rim- on a full court) at the rim centre (y 3.05, z = ±12.725 local, turned to face the court), plus
/// Practice/Rim+. CourtTransform(i) gives a court's world transform.
/// </summary>
public partial class HarborPoint : Node3D
{
    [Export] public bool BuildEnvironment = true;
    [Export] public float SunElevationDeg = 22.0f;  // the key light (the theme's sun vector sits at 19°): long shadows, the court still lit
    [Export] public float SunDiscElevationDeg = 5.0f; // where the disc sits in the sky and the glitter on the water (the poster: on the horizon)
    [Export] public float SunBearingDeg = 14f;      // bearing from +Z (the sea) toward -X; the theme's own vector is 54°, the poster wants it in view
    [Export] public float SunEnergy = 3.6f;
    [Export] public float Exposure = 0.78f;
    [Export] public float HazeDensity = 0.0f;       // volumetric haze: even 0.0007 veils the whole park salmon under the sun, so it is off (0) by default
    [Export] public float FogBegin = 45f, FogEnd = 520f; // depth fog, from past the far fence out to the horizon
    [Export] public bool Shadows = true;
    [Export] public bool Ssao = true, Ssil = false, Ssr = true;
    [Export] public int PalmTiers = 3; // 1 = only the park's shadow-casting palms, 2 = + mid, 3 = + far groves

    public HarborLayout Layout { get; private set; } = null!;
    public readonly Dictionary<string, int> Triangles = new();
    public readonly List<Node3D> Courts = new();
    public DirectionalLight3D? Sun { get; private set; }
    public Vector3 SunDiscDir { get; private set; } = new(-0.24f, 0.09f, 0.97f);
    public WorldEnvironment? Env { get; private set; }
    private readonly Dictionary<string, Texture2D> _tex = new();
    private Rng _rng = new(4242);
    private HashSet<string> _look = new();

    public Transform3D CourtTransform(int index) => Courts[index].GlobalTransform;
    public Node3D Rim(int court, int side) => Courts[court].GetNode<Node3D>(side > 0 ? "Rim+" : "Rim-");
    public Vector3 RimWorld(int court, int side) => Rim(court, side).GlobalPosition;

    public override void _Ready()
    {
        var t0 = Time.GetTicksMsec();
        Layout = HarborLayout.Load();
        // look-dev switches from the shell (RIMRIFT_LOOK=novol,nofog,nossr,nossao,noglow,noshadow,nofill,noamb)
        var look = OS.GetEnvironment("RIMRIFT_LOOK") ?? "";
        _look = new HashSet<string>(look.Split(',', StringSplitOptions.RemoveEmptyEntries));
        if (_look.Contains("nossr")) Ssr = false; if (_look.Contains("nossao")) Ssao = false; if (_look.Contains("noshadow")) Shadows = false;
        int checks = Layout.Verify();
        GD.Print($"HarborPoint: layout proof: {checks} values derived in C# match the JS export (tools/world/export_layout.mjs)");
        if (BuildEnvironment) BuildSkyAndSun();
        BuildGround();
        BuildSea();
        BuildCourts();
        BuildFencesAndPoles();
        BuildProps();
        BuildPalms();
        for (int i = 0; i < Courts.Count; i++)
        {
            var c = Layout.courts[i]; var o = Courts[i].GlobalPosition;
            string rims = string.Join(" ", c.hoops.ConvertAll(h => $"rim{(h.side > 0 ? "+" : "-")}=({RimWorld(i, h.side).X:F3},{RimWorld(i, h.side).Y:F2},{RimWorld(i, h.side).Z:F3}) js=({h.rim[0]:F3},{h.rim[1]:F2},{h.rim[2]:F3})"));
            GD.Print($"HarborPoint: Court{i} '{c.id}' format {c.format} origin ({o.X:F1},{o.Y:F1},{o.Z:F1}) {rims}");
        }
        int total = 0; foreach (var kv in Triangles) total += kv.Value;
        GD.Print($"HarborPoint: built in {Time.GetTicksMsec() - t0} ms, {total} triangles: " + string.Join(", ", Triangles));
    }

    // ---------------- textures and materials ----------------
    public Texture2D Tex(string name)
    {
        if (!_tex.TryGetValue(name, out var t)) { t = GD.Load<Texture2D>($"res://assets/world/tex/{name}.png"); _tex[name] = t; }
        return t;
    }
    public static Color C(string hex) => MeshKit.Hex(hex);

    public StandardMaterial3D Matte(float rough = 0.82f, float metal = 0f) => new()
    {
        VertexColorUseAsAlbedo = true, Roughness = rough, Metallic = metal,
        TextureFilter = BaseMaterial3D.TextureFilterEnum.LinearWithMipmapsAnisotropic,
    };
    public StandardMaterial3D Unlit(Color c, float energy = 1) => new()
    {
        ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded, AlbedoColor = c, EmissionEnabled = true, Emission = c, EmissionEnergyMultiplier = energy, VertexColorUseAsAlbedo = true,
    };

    public MeshInstance3D Place(MeshKit kit, string name, Material mat, Node parent, string category, bool castShadow = true, Transform3D? xf = null)
    {
        var mi = new MeshInstance3D { Name = name, Mesh = kit.ToMesh(mat) };
        if (!castShadow) mi.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
        if (xf != null) mi.Transform = xf.Value;
        parent.AddChild(mi);
        Triangles[category] = Triangles.GetValueOrDefault(category) + kit.Triangles;
        return mi;
    }

    // ---------------- sky, sun, post ----------------
    private void BuildSkyAndSun()
    {
        var th = Layout.theme;
        // the sun sits low over the sea (+Z), a little west of straight out so it lands in the poster camera's frame
        float el = Mathf.DegToRad(SunElevationDeg), br = Mathf.DegToRad(SunBearingDeg);
        var flat = new Vector3(-Mathf.Sin(br), 0, Mathf.Cos(br));
        var sunDir = (flat * Mathf.Cos(el) + Vector3.Up * Mathf.Sin(el)).Normalized(); // toward the key light
        float eld = Mathf.DegToRad(SunDiscElevationDeg);
        SunDiscDir = (flat * Mathf.Cos(eld) + Vector3.Up * Mathf.Sin(eld)).Normalized(); // toward the disc
        var sun = new DirectionalLight3D { Name = "Sun" };
        sun.LightColor = new Color(th.sun.color[0], th.sun.color[1], th.sun.color[2]); // the theme's [1, 0.68, 0.42]
        sun.LightEnergy = SunEnergy;
        sun.LightAngularDistance = 0.9f; // soft edges on the long shadows, and the size of the sun disc in the sky
        sun.ShadowEnabled = Shadows;
        sun.DirectionalShadowMode = DirectionalLight3D.ShadowMode.Parallel4Splits;
        sun.DirectionalShadowMaxDistance = 110;
        sun.DirectionalShadowSplit1 = 0.05f; sun.DirectionalShadowSplit2 = 0.14f; sun.DirectionalShadowSplit3 = 0.36f;
        sun.DirectionalShadowFadeStart = 0.9f;
        sun.ShadowBias = 0.015f; sun.ShadowNormalBias = 0.9f; sun.ShadowBlur = 1.0f;
        sun.DirectionalShadowBlendSplits = true;
        sun.DirectionalShadowPancakeSize = 40;
        sun.ShadowOpacity = 1.0f;
        AddChild(sun);
        sun.LookAtFromPosition(sunDir * 100, Vector3.Zero, Vector3.Up);
        Sun = sun;

        // the graded sunset sky from themes.js (top / horizon / ground) with the sun disc + glow, see shaders/world/sky.gdshader
        var sky = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/world/sky.gdshader") };
        sky.SetShaderParameter("top_color", new Color(0.40f, 0.47f, 0.66f)); // the poster sees only the lowest 15° of sky: a blue-grey there (the theme's deep zenith blue would read mauve)
        sky.SetShaderParameter("horizon_color", new Color(1.0f, 0.5f, 0.22f)); // the theme's (1, 0.56, 0.32) pushed to the poster's gold-orange
        sky.SetShaderParameter("ground_color", new Color(th.sky.ground[0], th.sky.ground[1], th.sky.ground[2]));
        sky.SetShaderParameter("sun_dir", SunDiscDir);
        sky.SetShaderParameter("sun_color", new Color(1.0f, 0.74f, 0.48f));
        sun.SkyMode = DirectionalLight3D.SkyModeEnum.LightOnly; // the shader draws the disc
        var env = new Godot.Environment
        {
            BackgroundMode = Godot.Environment.BGMode.Sky,
            Sky = new Sky { SkyMaterial = sky, RadianceSize = Sky.RadianceSizeEnum.Size256, ProcessMode = Sky.ProcessModeEnum.Realtime },
            // the theme's ambient is a dim cool sky [0.42, 0.36, 0.48]: keep the shadows readable, not filled
            AmbientLightSource = Godot.Environment.AmbientSource.Sky, AmbientLightSkyContribution = 1.0f, AmbientLightEnergy = 0.45f,
            ReflectedLightSource = Godot.Environment.ReflectionSource.Sky,
            TonemapMode = Godot.Environment.ToneMapper.Agx, TonemapExposure = Exposure, TonemapWhite = 4.0f,
            GlowEnabled = true, GlowIntensity = 0.35f, GlowBloom = 0.04f, GlowHdrThreshold = 1.5f, GlowBlendMode = Godot.Environment.GlowBlendModeEnum.Softlight,
            SsaoEnabled = Ssao, SsaoRadius = 1.0f, SsaoIntensity = 1.8f,
            SsilEnabled = Ssil,
            SsrEnabled = Ssr, SsrMaxSteps = 48, SsrFadeIn = 0.15f, SsrFadeOut = 2.0f, SsrDepthTolerance = 0.3f,
            // a thin volumetric haze toward the sun (the glitter corridor on the water), kept off the courts
            VolumetricFogEnabled = HazeDensity > 0, VolumetricFogDensity = HazeDensity, VolumetricFogAlbedo = new Color(0.96f, 0.76f, 0.6f),
            VolumetricFogEmission = new Color(0.86f, 0.6f, 0.48f), VolumetricFogEmissionEnergy = 0.0f,
            VolumetricFogLength = 180f, VolumetricFogDetailSpread = 2.0f, VolumetricFogSkyAffect = 0.1f, VolumetricFogAnisotropy = 0.45f,
            // depth fog: nothing until FogBegin, the horizon fully hazed at FogEnd (the theme's fog colour)
            FogEnabled = true, FogMode = Godot.Environment.FogModeEnum.Depth, FogLightColor = new Color(th.fog.color[0], th.fog.color[1], th.fog.color[2]), FogLightEnergy = 1.0f,
            FogDepthBegin = FogBegin, FogDepthEnd = FogEnd, FogDepthCurve = 1.3f, FogAerialPerspective = 0.12f, FogSkyAffect = 0.08f, FogSunScatter = 0.08f,
            AdjustmentEnabled = true, AdjustmentSaturation = 1.2f, AdjustmentContrast = 1.15f,
        };
        if (_look.Contains("novol")) env.VolumetricFogEnabled = false; if (_look.Contains("nofog")) env.FogEnabled = false;
        if (_look.Contains("noglow")) env.GlowEnabled = false; if (_look.Contains("noamb")) env.AmbientLightEnergy = 0; if (_look.Contains("noadj")) env.AdjustmentEnabled = false;
        if (_look.Count > 0) GD.Print("HarborPoint: look switches " + string.Join(",", _look));
        Env = new WorldEnvironment { Name = "Env", Environment = env };
        AddChild(Env);
        // a cool fill from the sky side so the shadows are not black (the theme's ambient sky [0.42, 0.36, 0.48]).
        // SkyMode LightOnly: it must not draw a second sun in the procedural sky.
        var fill = new DirectionalLight3D { Name = "SkyFill", LightColor = new Color(0.5f, 0.56f, 0.8f), LightEnergy = 0.22f, ShadowEnabled = false, LightSpecular = 0.0f, SkyMode = DirectionalLight3D.SkyModeEnum.LightOnly };
        if (!_look.Contains("nofill")) { AddChild(fill); fill.LookAtFromPosition(new Vector3(40, 60, -30), Vector3.Zero, Vector3.Up); }
    }
}

/// mulberry32 (client/js/core/rng.js) for the world generator's own scatter (palm fronds, coconuts), so a build is
/// reproducible. Not the sim's RNG: that one lives in Rimrift.Sim.
public sealed class Rng
{
    private uint _s;
    public Rng(uint seed) { _s = seed == 0 ? 0x9e3779b9u : seed; }
    public double Next()
    {
        uint t = _s += 0x6d2b79f5u;
        t = (t ^ (t >> 15)) * (t | 1u);
        t ^= t + (t ^ (t >> 7)) * (t | 61u);
        return (t ^ (t >> 14)) / 4294967296.0;
    }
    public float Range(float a, float b) => a + (b - a) * (float)Next();
    public int Int(int a, int b) => (int)Math.Floor(Range(a, b + 1));
    public T Pick<T>(IList<T> arr) => arr[(int)Math.Floor(Next() * arr.Count)];
}
