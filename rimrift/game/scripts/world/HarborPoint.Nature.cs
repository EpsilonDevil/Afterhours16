using Godot;
using System;
using System.Collections.Generic;

namespace Rimrift.World;

public partial class HarborPoint
{
    // ---------------- the beach (harbor.js harborGround): dry sand to SHORE.z, a wet slope down into the water ----------------
    private void BuildGround()
    {
        var sh = Layout.shore;
        var noise = new FastNoiseLite { Seed = 73, NoiseType = FastNoiseLite.NoiseTypeEnum.Value, Frequency = 1f, FractalOctaves = 3 };
        var tint = C(Layout.theme.ground) * new Color(0.52f, 0.5f, 0.47f); // the theme's near-white sand is an albedo for the JS lighting; real sand is darker
        const float TILE = 12f; // metres per sand texture tile
        Color Shade(float x, float z)
        {
            float n = noise.GetNoise2D(x / 70, z / 70) * 0.5f, m = noise.GetNoise2D(x / 23 + 9, z / 23) * 0.5f;
            float k = 1 + n * 0.16f + m * 0.06f;
            float damp = Mathf.Clamp((z - 36) / 8, 0, 1);
            k *= 1 - damp * 0.2f;
            return new Color(tint.R * k * (1 + n * 0.03f), tint.G * k, tint.B * k * (1 - n * 0.04f - damp * 0.03f));
        }
        // the dry sand: -300..300 x -300..SHORE.z, 10 m cells (the park sits on it; courts are 1 mm above)
        var sand = new MeshKit();
        float x0 = -300, x1 = 300, z0 = -300, z1 = sh.z;
        sand.Plane(x1 - x0, z1 - z0, 60, Mathf.RoundToInt((z1 - z0) / 10), MeshKit.At((x0 + x1) / 2, -0.005f, (z0 + z1) / 2), tint, shade: Shade, uvFn: (x, z) => new Vector2(x / TILE, z / TILE));
        var sandMat = new StandardMaterial3D
        {
            VertexColorUseAsAlbedo = true, AlbedoTexture = Tex("sand_c"), NormalEnabled = true, NormalTexture = Tex("sand_n"), NormalScale = 0.22f,
            Roughness = 0.95f, TextureFilter = BaseMaterial3D.TextureFilterEnum.LinearWithMipmapsAnisotropic,
        };
        Place(sand, "Sand", sandMat, this, "terrain", castShadow: false);
        // the wet slope: darker, glossy, running from the dry edge (y -0.005) down to SHORE.y under the water
        var wet = new MeshKit();
        Color WetShade(float x, float z) { float k = 0.62f - (z - sh.z) / (sh.wet - sh.z) * 0.12f + noise.GetNoise2D(x / 9, z / 3) * 0.02f; return new Color(tint.R * k, tint.G * k * 0.98f, tint.B * k * 0.95f); }
        wet.Plane(x1 - x0, sh.wet - sh.z, 60, 3, MeshKit.At(0, 0, (sh.z + sh.wet) / 2), tint, height: (x, z) => -0.005f + (z - sh.z) / (sh.wet - sh.z) * (sh.y + 0.005f), shade: WetShade, uvFn: (x, z) => new Vector2(x / TILE, z / TILE));
        var wetMat = new StandardMaterial3D
        {
            VertexColorUseAsAlbedo = true, AlbedoTexture = Tex("sand_c"), NormalEnabled = true, NormalTexture = Tex("sand_n"), NormalScale = 0.5f,
            Roughness = 0.22f, Metallic = 0.0f, MetallicSpecular = 0.9f, TextureFilter = BaseMaterial3D.TextureFilterEnum.LinearWithMipmapsAnisotropic,
        };
        Place(wet, "WetSand", wetMat, this, "terrain", castShadow: false);
    }

    // ---------------- the sea (venues.js coastScenery): a 700 x 160 m plane at y -0.6 ----------------
    private void BuildSea()
    {
        var sea = Layout.shore.sea;
        var kit = new MeshKit();
        kit.Plane(sea.width, sea.depth, 1, 1, MeshKit.At(0, sea.y, sea.z), Colors.White);
        var mat = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/world/sea.gdshader") };
        mat.SetShaderParameter("normal_map", Tex("water_n"));
        mat.SetShaderParameter("color", C(sea.color)); mat.SetShaderParameter("color2", C(sea.color2));
        var sd = Layout.theme.sun.dir; mat.SetShaderParameter("sun_dir", Sun != null ? SunDiscDir : new Vector3(sd[0], sd[1], sd[2]));
        Place(kit, "Sea", mat, this, "water", castShadow: false);
        // beyond the JS plane the water carries on to the horizon (same material; the depth fog takes it)
        var far = new MeshKit();
        float farDepth = 2400, farZ0 = sea.z + sea.depth / 2 - 1;
        far.Plane(sea.width * 6, farDepth, 1, 1, MeshKit.At(0, sea.y - 0.02f, farZ0 + farDepth / 2), Colors.White, uvFn: (x, z) => new Vector2(x / sea.width + 0.5f, z / sea.depth));
        Place(far, "SeaFar", mat, this, "water", castShadow: false);
        // a pale surf line where the water meets the sand
        var surf = new MeshKit();
        surf.Plane(sea.width, Layout.shore.surf.depth, 1, 1, MeshKit.At(0, sea.y + 0.01f, Layout.shore.surf.z), new Color(1, 1, 1, 0.45f), uvFn: (x, z) => new Vector2(x / 15, z / 5));
        var surfMat = new StandardMaterial3D { VertexColorUseAsAlbedo = true, AlbedoTexture = Tex("noise"), Transparency = BaseMaterial3D.TransparencyEnum.Alpha, Roughness = 0.3f, AlbedoColor = new Color(1, 1, 1, 0.5f) };
        Place(surf, "Surf", surfMat, this, "water", castShadow: false);
    }

    // ---------------- palms (harbor.js harborPalmSpots placements, props.js palmLeaning shapes) ----------------
    private void BuildPalms()
    {
        var trunksFull = new MeshKit(); var frondsFull = new MeshKit();
        var trunksFar = new MeshKit(); var frondsFar = new MeshKit();
        var rng = new Rng(4242);
        int nFull = 0, nMid = 0, nLite = 0;
        foreach (var p in Layout.palms)
        {
            bool full = p.tier == "full", mid = p.tier == "mid", lite = p.tier == "lite";
            if (mid && PalmTiers < 2) continue; if (lite && PalmTiers < 3) continue;
            if (full) nFull++; else if (mid) nMid++; else nLite++;
            Palm(full ? trunksFull : trunksFar, full ? frondsFull : frondsFar, p, rng, full ? 2 : mid ? 1 : 0);
        }
        var trunkMat = Matte(0.9f);
        var frondMat = new StandardMaterial3D
        {
            AlbedoTexture = Tex("frond"), VertexColorUseAsAlbedo = true, Roughness = 0.85f,
            Transparency = BaseMaterial3D.TransparencyEnum.AlphaScissor, AlphaScissorThreshold = 0.5f, AlphaAntialiasingMode = BaseMaterial3D.AlphaAntiAliasing.AlphaToCoverageAndToOne,
            CullMode = BaseMaterial3D.CullModeEnum.Disabled, TextureFilter = BaseMaterial3D.TextureFilterEnum.LinearWithMipmapsAnisotropic,
            BacklightEnabled = true, Backlight = new Color(0.35f, 0.45f, 0.2f),
        };
        Place(trunksFull, "PalmTrunks", trunkMat, this, "palms");
        Place(frondsFull, "PalmFronds", frondMat, this, "palms");
        Place(trunksFar, "PalmTrunksFar", trunkMat, this, "palms", castShadow: false);
        Place(frondsFar, "PalmFrondsFar", frondMat, this, "palms", castShadow: false);
        GD.Print($"HarborPoint: palms full {nFull} mid {nMid} lite {nLite}");
    }

    /// props.js palmLeaning: a banded trunk leaning over and straightening, a crown shaft, pinnate fronds that arch up
    /// then droop, a few dead ones hanging, coconuts. detail: 2 = in the park (shadows), 1 = past the fences, 0 = far.
    private void Palm(MeshKit trunks, MeshKit fronds, HarborLayout.Palm p, Rng rng, int detail)
    {
        float s = p.s, h = p.height * s, lx = p.lean[0], lz = p.lean[1];
        int n = detail == 0 ? 5 : detail == 1 ? 8 : 12; var path = new List<Vector3>();
        for (int i = 0; i <= n; i++) { float t = (float)i / n, k = 1.5f * t - 0.5f * t * t; path.Add(new Vector3(p.x + lx * k, h * t, p.z + lz * k)); }
        int seg = detail == 0 ? 5 : detail == 1 ? 6 : 7;
        var ca = C("#7d6447"); var cb = C("#5f4c35"); var cTop = C("#8f7a58");
        trunks.Tube(path, t => 0.21f * s * (1 - t * 0.38f) * (detail == 0 ? 1 : 1 + 0.07f * ((Mathf.RoundToInt(t * n) % 2 == 1) ? 1 : -1)), seg, ca, k => k > n - 2 ? cTop : k % 2 == 1 ? cb : ca);
        var top = path[n];
        trunks.Cylinder(0.19f * s, 0.13f * s, 0.6f * s, seg, MeshKit.At(top.X, top.Y - 0.2f * s, top.Z), C("#6f7d45"), y0: true, open: true);
        int nf = detail == 0 ? 7 : detail == 1 ? 9 : 11;
        var greens = new[] { C("#3f7a3a"), C("#4f8a42"), C("#5f9a4a"), C("#4a8240") };
        for (int k = 0; k < nf; k++)
        {
            float a = (float)k / nf * Mathf.Tau + rng.Range(0, 0.35f);
            float L = (2.8f + (float)rng.Next() * 1.1f) * s, up = (0.5f + (float)rng.Next() * 0.45f) * s, droop = (1.6f + (float)rng.Next() * 1.3f) * s;
            Frond(fronds, new Vector3(top.X, top.Y + 0.32f * s, top.Z), a, L, up, droop, 0.3f * L, rng.Pick(greens), detail == 0 ? 4 : detail == 1 ? 6 : 8);
        }
        if (detail == 2)
        {
            int nd = rng.Int(1, 3);
            for (int k = 0; k < nd; k++) { float a = rng.Range(0, Mathf.Tau); Frond(fronds, new Vector3(top.X, top.Y + 0.05f * s, top.Z), a, (1.6f + (float)rng.Next() * 0.6f) * s, 0.05f * s, (2.6f + (float)rng.Next()) * s, 0.24f * s, rng.Pick(new[] { C("#8a6f45"), C("#9c8156"), C("#7a5f3a") }), 5); }
            int nc = rng.Int(3, 6);
            for (int k = 0; k < nc; k++)
            {
                float a = (float)k / nc * Mathf.Tau + rng.Range(0, 0.5f), rr = (0.2f + (float)rng.Next() * 0.08f) * s;
                trunks.Sphere(0.13f * s, 5, 4, MeshKit.At(top.X + Mathf.Sin(a) * rr, top.Y - (0.12f + (float)rng.Next() * 0.15f) * s, top.Z + Mathf.Cos(a) * rr), rng.Pick(new[] { C("#6b5a32"), C("#7a6a38"), C("#5f6b30") }));
            }
        }
    }

    /// props.js palmFrond's curve (arches up out of the crown, then droops as t³) carried by a folded card
    private static void Frond(MeshKit kit, Vector3 top, float a, float L, float up, float droop, float halfW, Color color, int steps)
    {
        float sx = Mathf.Sin(a), sz = Mathf.Cos(a), rx = Mathf.Cos(a), rz = -Mathf.Sin(a);
        var left = new List<Vector3>(); var mid = new List<Vector3>(); var right = new List<Vector3>();
        for (int i = 0; i <= steps; i++)
        {
            float t = (float)i / steps;
            float y = top.Y + up * Mathf.Sin(Mathf.Min(1, t * 1.25f) * Mathf.Pi * 0.55f) - t * t * t * droop;
            float cx = top.X + sx * L * t * (1 - t * t * droop * 0.06f), cz = top.Z + sz * L * t * (1 - t * t * droop * 0.06f);
            float fold = (0.35f + t * 0.5f) * 0.5f;
            left.Add(new Vector3(cx - rx * halfW, y - fold * halfW, cz - rz * halfW)); mid.Add(new Vector3(cx, y, cz)); right.Add(new Vector3(cx + rx * halfW, y - fold * halfW, cz + rz * halfW));
        }
        kit.Strip(left, mid, right, color, twoSided: false);
    }
}
