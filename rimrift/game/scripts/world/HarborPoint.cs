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
    [Export] public float SunElevationDeg = 17.0f;  // the key light (the theme's sun vector sits at 19°): long shadows, the court still lit, poles and fences silhouetted
    [Export] public float SunDiscElevationDeg = 2.6f; // where the disc sits in the sky and the glitter on the water (the poster: on the waterline)
    [Export] public float SunBearingDeg = 40f;      // bearing from +Z (the sea) toward -X; the theme's own vector is 54°. Look pass 3: 14° put the sun straight behind the athletes on the game camera (silhouettes); 40° side-lights them like the court reference and keeps the disc in the poster frame
    [Export] public float SunEnergy = 4.8f;          // hot on the sun-facing sides; the shadow sides fall dark (look pass 2)
    [Export] public float Exposure = 0.78f;          // look pass 2 set 0.68 for the empty poster (target luma 0.35); pass 3 with athletes in frame: 0.78 (game cam luma 0.36 vs the court reference's 0.42 / the poster's 0.35)
    [Export] public float Vignette = 0.42f;         // themes.js grade.vignette 0.55; a full-screen multiply before AgX (shaders/world/vignette.gdshader)
    [Export] public float HazeDensity = 0.0f;       // volumetric haze: even 0.0007 veils the whole park salmon under the sun, so it is off (0) by default
    [Export] public float FogBegin = 95f, FogEnd = 650f; // depth fog from beyond the far fence and the shore (the poster camera is 42 m from the far fence, 70 m from the water) out to the horizon
    [Export] public float FogMax = 0.8f;                   // the horizon keeps a little of the sea through the haze
    [Export] public bool Shadows = true;
    [Export] public bool Ssao = true, Ssil = false, Ssr = true;
    // look pass 3 ("athlete in the world"): the knobs that put the Meshy athletes into the light, all overridable from the
    // shell for look-dev with RIMRIFT_LOOKSET="AmbientEnergy=0.4,FillEnergy=0.6,..." (any float/bool export of this node)
    [Export] public float AmbientEnergy = 1.4f;       // energy of the flat ambient term (Godot ignores it for the sky part: with AmbientSkyMix = 1 the sky cubemap alone is the ambient)
    [Export] public float AmbientSkyMix = 0.5f;       // 1 = the sky cubemap only, 0 = AmbientColor * AmbientEnergy only. Pass 3: half flat dusk ambient — the cubemap alone left the athletes' shadow sides at luma 0.03
    [Export] public Color AmbientColor = new(0.80f, 0.70f, 0.74f); // dusk-pink (the theme's [0.42, 0.36, 0.48] with the pass-3 energy folded in: lavender, not brown, so the black jerseys stay charcoal)
    [Export] public float FillEnergy = 0.7f;         // the shadowless sky fill from the camera side (-Z, +X): what lights the athletes' faces when the sun is behind them
    [Export] public Color FillColor = new(0.74f, 0.64f, 0.74f); // the sky opposite the sun at golden hour: lavender-pink, not blue
    [Export] public float BounceEnergy = 0.0f;        // a warm shadowless light up from the court (the sunlit teal/orange bouncing onto shorts, chins, undersides)
    [Export] public Color BounceColor = new(0.55f, 0.75f, 0.70f);
    [Export] public float SsaoRadius = 0.7f, SsaoIntensity = 2.0f; // pass 3: sized for 1.9 m bodies (under the arms, between the legs), not the 1 m prop scale
    [Export] public float SsilRadius = 5.0f, SsilIntensity = 1.0f;
    [Export] public float GlowThreshold = 1.5f, GlowIntensity = 0.35f;
    [Export] public float ShadowBias = 0.015f, ShadowNormalBias = 0.9f, ShadowBlur = 1.0f;
    [Export] public float Contrast = 1.0f, Saturation = 0.95f; // pass 3: the frame with athletes measured sat 0.72 vs the references' 0.44-0.62; contrast 1.15 crushed the jerseys' shadow side to luma 0.03 (0.05 at 1.0)
    [Export] public int PalmTiers = 3; // 1 = only the park's shadow-casting palms, 2 = + mid, 3 = + far groves
    [Export] public bool ExtraPalms = true; // look pass 2: a few more palms in the beach band behind the main court (dressing only, not in the layout)

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
        var lookset = OS.GetEnvironment("RIMRIFT_LOOKSET") ?? "";
        foreach (var kv in lookset.Split(',', StringSplitOptions.RemoveEmptyEntries))
        {   // "Name=value" for any exported float/bool/colour (colour = r;g;b) of this node, e.g. RIMRIFT_LOOKSET="Exposure=0.7,Ssil=true,FillColor=0.8;0.6;0.7"
            var p = kv.Split('='); if (p.Length != 2) continue;
            var cur = Get(p[0]);
            Variant v = cur.VariantType switch
            {
                Variant.Type.Bool => p[1] == "true" || p[1] == "1",
                Variant.Type.Int => int.Parse(p[1]),
                Variant.Type.Color => new Color(float.Parse(p[1].Split(';')[0], System.Globalization.CultureInfo.InvariantCulture), float.Parse(p[1].Split(';')[1], System.Globalization.CultureInfo.InvariantCulture), float.Parse(p[1].Split(';')[2], System.Globalization.CultureInfo.InvariantCulture)),
                _ => float.Parse(p[1], System.Globalization.CultureInfo.InvariantCulture),
            };
            Set(p[0], v);
            GD.Print($"HarborPoint: lookset {p[0]} = {Get(p[0])}");
        }
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

    // VertexColorIsSrgb: the JS hexes are sRGB (hexLinear in the JS game); Forward+ treats vertex colours as linear
    // unless told, which rendered every prop, pole, palm and the sand tint about one gamma too light (the pastel look)
    public StandardMaterial3D Matte(float rough = 0.82f, float metal = 0f) => new()
    {
        VertexColorUseAsAlbedo = true, VertexColorIsSrgb = true, Roughness = rough, Metallic = metal,
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
        sun.LightColor = new Color(1.0f, 0.70f, 0.42f); // the theme's [1, 0.68, 0.42]: warmer than this and the blue channel crushes, the teal goes green
        sun.LightEnergy = SunEnergy;
        sun.LightAngularDistance = 0.9f; // soft edges on the long shadows, and the size of the sun disc in the sky
        sun.ShadowEnabled = Shadows;
        sun.DirectionalShadowMode = DirectionalLight3D.ShadowMode.Parallel4Splits;
        sun.DirectionalShadowMaxDistance = 110;
        sun.DirectionalShadowSplit1 = 0.05f; sun.DirectionalShadowSplit2 = 0.14f; sun.DirectionalShadowSplit3 = 0.36f;
        sun.DirectionalShadowFadeStart = 0.9f;
        sun.ShadowBias = ShadowBias; sun.ShadowNormalBias = ShadowNormalBias; sun.ShadowBlur = ShadowBlur;
        sun.DirectionalShadowBlendSplits = true;
        sun.DirectionalShadowPancakeSize = 40;
        sun.ShadowOpacity = 1.0f;
        AddChild(sun);
        sun.LookAtFromPosition(sunDir * 100, Vector3.Zero, Vector3.Up);
        Sun = sun;

        // the graded sunset sky from themes.js (top / horizon / ground) with the sun disc + glow, see shaders/world/sky.gdshader
        var sky = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/world/sky.gdshader") };
        // the gradient lives in the shader's defaults (look pass 2 against the concept art); the theme's ground stays
        sky.SetShaderParameter("ground_color", new Color(th.sky.ground[0], th.sky.ground[1], th.sky.ground[2]));
        sky.SetShaderParameter("sun_dir", SunDiscDir);
        sun.SkyMode = DirectionalLight3D.SkyModeEnum.LightOnly; // the shader draws the disc
        var env = new Godot.Environment
        {
            BackgroundMode = Godot.Environment.BGMode.Sky,
            Sky = new Sky { SkyMaterial = sky, RadianceSize = Sky.RadianceSizeEnum.Size256, ProcessMode = Sky.ProcessModeEnum.Realtime },
            // the theme's ambient is a dim cool sky [0.42, 0.36, 0.48]: keep the shadows readable, not filled
            AmbientLightSource = Godot.Environment.AmbientSource.Sky, AmbientLightSkyContribution = AmbientSkyMix, AmbientLightColor = AmbientColor, AmbientLightEnergy = AmbientEnergy,
            ReflectedLightSource = Godot.Environment.ReflectionSource.Sky,
            TonemapMode = Godot.Environment.ToneMapper.Agx, TonemapExposure = Exposure, TonemapWhite = 6.0f,
            GlowEnabled = true, GlowIntensity = GlowIntensity, GlowBloom = 0.04f, GlowHdrThreshold = GlowThreshold, GlowBlendMode = Godot.Environment.GlowBlendModeEnum.Softlight,
            SsaoEnabled = Ssao, SsaoRadius = SsaoRadius, SsaoIntensity = SsaoIntensity,
            SsilEnabled = Ssil, SsilRadius = SsilRadius, SsilIntensity = SsilIntensity,
            SsrEnabled = Ssr, SsrMaxSteps = 48, SsrFadeIn = 0.15f, SsrFadeOut = 2.0f, SsrDepthTolerance = 0.3f,
            // a thin volumetric haze toward the sun (the glitter corridor on the water), kept off the courts
            VolumetricFogEnabled = HazeDensity > 0, VolumetricFogDensity = HazeDensity, VolumetricFogAlbedo = new Color(0.96f, 0.76f, 0.6f),
            VolumetricFogEmission = new Color(0.86f, 0.6f, 0.48f), VolumetricFogEmissionEnergy = 0.0f,
            VolumetricFogLength = 180f, VolumetricFogDetailSpread = 2.0f, VolumetricFogSkyAffect = 0.1f, VolumetricFogAnisotropy = 0.45f,
            // depth fog: nothing until FogBegin, the horizon fully hazed at FogEnd (the theme's fog colour)
            // its colour is the sky's own horizon in that direction (aerial perspective), so it is orange under the sun and dusky away from it
            FogEnabled = true, FogMode = Godot.Environment.FogModeEnum.Depth, FogLightColor = new Color(0.80f, 0.42f, 0.20f), FogLightEnergy = 1.0f, FogDensity = FogMax,
            FogDepthBegin = FogBegin, FogDepthEnd = FogEnd, FogDepthCurve = 1.5f, FogAerialPerspective = 0.7f, FogSkyAffect = 0.0f, FogSunScatter = 0.12f,
            // the graded-photograph look: themes.js grade (1.1 / 1.05) pushed; the target measures sat 0.61 vs our 0.47
            AdjustmentEnabled = true, AdjustmentSaturation = Saturation, AdjustmentContrast = Contrast,
        };
        if (_look.Contains("novol")) env.VolumetricFogEnabled = false; if (_look.Contains("nofog")) env.FogEnabled = false;
        if (_look.Contains("noglow")) env.GlowEnabled = false; if (_look.Contains("noamb")) env.AmbientLightEnergy = 0; if (_look.Contains("noadj")) env.AdjustmentEnabled = false;
        if (_look.Count > 0) GD.Print("HarborPoint: look switches " + string.Join(",", _look));
        Env = new WorldEnvironment { Name = "Env", Environment = env };
        AddChild(Env);
        // a cool fill from the sky side so the shadows are not black (the theme's ambient sky [0.42, 0.36, 0.48]).
        // SkyMode LightOnly: it must not draw a second sun in the procedural sky.
        var fill = new DirectionalLight3D { Name = "SkyFill", LightColor = FillColor, LightEnergy = FillEnergy, ShadowEnabled = false, LightSpecular = 0.0f, SkyMode = DirectionalLight3D.SkyModeEnum.LightOnly };
        if (!_look.Contains("nofill") && FillEnergy > 0) { AddChild(fill); fill.LookAtFromPosition(new Vector3(40, 60, -30), Vector3.Zero, Vector3.Up); }
        if (BounceEnergy > 0)
        {   // the court's bounce: a shadowless light from below (lights down-facing and near-vertical surfaces a little)
            var bounce = new DirectionalLight3D { Name = "CourtBounce", LightColor = BounceColor, LightEnergy = BounceEnergy, ShadowEnabled = false, LightSpecular = 0.0f, SkyMode = DirectionalLight3D.SkyModeEnum.LightOnly };
            AddChild(bounce); bounce.LookAtFromPosition(new Vector3(0, -60, -25), Vector3.Zero, Vector3.Back);
        }
        if (Vignette > 0 && !_look.Contains("novig")) BuildVignette();
    }

    /// a 2 x 2 quad the vignette shader pins to the screen (clip-space vertex), drawn last in the transparent pass with
    /// multiply blending: it darkens the HDR frame before glow and tonemapping. One quad, one tiny shader: ~0 ms.
    private void BuildVignette()
    {
        var mat = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/world/vignette.gdshader"), RenderPriority = 127 };
        mat.SetShaderParameter("strength", Vignette);
        var mi = new MeshInstance3D
        {
            Name = "Vignette", Mesh = new QuadMesh { Size = new Vector2(2, 2) }, MaterialOverride = mat,
            CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
            CustomAabb = new Aabb(new Vector3(-4000, -4000, -4000), new Vector3(8000, 8000, 8000)), // never culled
        };
        AddChild(mi);
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
