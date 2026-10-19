using Godot;
using System;
using System.Collections.Generic;

namespace Rimrift.World;

public partial class HarborPoint
{
    private ShaderMaterial? _courtMatFull, _courtMatHalf2, _courtMatHalf1;

    private ShaderMaterial CourtMaterial(string overlay)
    {
        var m = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/world/court.gdshader") };
        m.SetShaderParameter("overlay", Tex(overlay));
        m.SetShaderParameter("asphalt", Tex("asphalt_c"));
        m.SetShaderParameter("asphalt_n", Tex("asphalt_n"));
        var tintHex = Layout.theme.court.TryGetValue("asphaltTint", out var tv) ? tv.GetString() ?? "#d8d2c8" : "#d8d2c8";
        m.SetShaderParameter("tint", C(tintHex));
        return m;
    }

    // ---------------- courts: floor + hoops (court.js buildCourt / buildHoop) ----------------
    private void BuildCourts()
    {
        _courtMatFull = CourtMaterial("court_full"); _courtMatHalf2 = CourtMaterial("court_half2"); _courtMatHalf1 = CourtMaterial("court_half1");
        var ringKit = new MeshKit(); var labelKit = new MeshKit();
        for (int i = 0; i < Layout.courts.Count; i++)
        {
            var c = Layout.courts[i];
            var origin = HarborLayout.V3(c.origin);
            var node = new Node3D { Name = $"Court{i}", Position = origin };
            node.SetMeta("id", c.id); node.SetMeta("format", c.format); node.SetMeta("full", c.full);
            AddChild(node); Courts.Add(node);
            // floor: the overlay rect is (W+4) x (L+4); half courts lay down z from -2.2 to L/2+2 only
            float W = CourtDims.Width + 4, L = CourtDims.Length + 4;
            float z0 = c.overlayZ[0], z1 = c.overlayZ[1];
            var floor = new MeshKit { UseUv2 = true };
            BuildFloorPlane(floor, W, z0, z1, L);
            var mat = c.format == 3 ? _courtMatFull : c.format == 2 ? _courtMatHalf2 : _courtMatHalf1;
            Place(floor, "Floor", mat!, node, "court", castShadow: false, xf: new Transform3D(Basis.Identity, new Vector3(0, 0.001f, 0)));
            foreach (var h in c.hoops) BuildHoop(node, h.side, c.full ? 48 : 40);
            // Got Next rings and the GOT NEXT stencil (venues.js)
            foreach (var row in c.gotNext.rows) foreach (var s in row)
                ringKit.Plane(1.3f, 1.3f, 1, 1, MeshKit.At(s.x, 0.02f, s.z), C(Layout.plaza.affColor));
            labelKit.Plane(1.9f, 0.42f, 1, 1, MeshKit.At(c.gotNext.mid.x, 0.021f, c.gotNext.mid.z, Mathf.Pi / 2), new Color(0.85f, 0.85f, 0.85f));
        }
        var ringMat = new StandardMaterial3D { AlbedoTexture = Tex("ring"), VertexColorUseAsAlbedo = true, ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded, Transparency = BaseMaterial3D.TransparencyEnum.Alpha, BlendMode = BaseMaterial3D.BlendModeEnum.Add, EmissionEnabled = true, Emission = C(Layout.plaza.affColor), EmissionEnergyMultiplier = 1.4f, EmissionTexture = Tex("ring"), DisableFog = true };
        Place(ringKit, "GotNextRings", ringMat, this, "props", castShadow: false);
        var labelMat = new StandardMaterial3D { AlbedoTexture = Tex("gotnext"), VertexColorUseAsAlbedo = true, ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded, Transparency = BaseMaterial3D.TransparencyEnum.Alpha, BlendMode = BaseMaterial3D.BlendModeEnum.Add, DisableFog = true };
        Place(labelKit, "GotNextLabels", labelMat, this, "props", castShadow: false);
        // the practice hoop and slab on the east annex
        var pr = Layout.practice;
        var pnode = new Node3D { Name = "Practice", Position = HarborLayout.V3(pr.hoopOrigin) };
        AddChild(pnode);
        BuildHoop(pnode, 1, 40);
        var slab = new MeshKit();
        slab.Box(pr.slab.w, pr.slab.h, pr.slab.d, MeshKit.At(pr.slab.x, 0.02f, pr.slab.z), C(Layout.theme.court["court"].GetString() ?? "#2f8a8c"));
        BallRack(slab, pr.rack.x, pr.rack.z, pr.rack.yaw);
        Place(slab, "PracticeSlab", Matte(), this, "props");
    }

    /// court.js buildCourt: a plane with UV = overlay rect coordinates and UV2 = metres / 4 for the asphalt
    private void BuildFloorPlane(MeshKit kit, float W, float z0, float z1, float L)
    {
        // built by hand so UV (overlay) and UV2 (asphalt tile) are both set
        var pos = new List<Vector3>(); var nrm = new List<Vector3>(); var uv = new List<Vector2>(); var idx = new List<int>();
        int sx = 6, sz = 12; // a few cells so the long shadows and SSAO interpolate cleanly
        for (int j = 0; j <= sz; j++) for (int i = 0; i <= sx; i++)
        {
            float x = (-0.5f + (float)i / sx) * W, z = z0 + (z1 - z0) * j / sz;
            pos.Add(new Vector3(x, 0, z)); nrm.Add(Vector3.Up); uv.Add(new Vector2(x / W + 0.5f, z / L + 0.5f));
        }
        for (int j = 0; j < sz; j++) for (int i = 0; i < sx; i++) { int a = j * (sx + 1) + i, b = a + 1, c = a + sx + 1, e = c + 1; idx.AddRange(new[] { a, b, c, b, e, c }); }
        kit.AddWithUv2(pos, nrm, uv, idx, p => new Vector2(p.X / 4, p.Z / 4));
    }

    /// court.js buildHoop (style 'park'): glass board, frame, markings, rim + flange, pole + gooseneck, a net.
    /// Built in the rim's local frame: the court is toward -Z, the board toward +Z (the rim node is turned by the side).
    private void BuildHoop(Node3D court, int side, int rimSegs)
    {
        var rimNode = new Node3D { Name = side > 0 ? "Rim+" : "Rim-", Position = new Vector3(0, CourtDims.RimY, side * CourtDims.HoopZ), Rotation = new Vector3(0, side > 0 ? 0 : Mathf.Pi, 0) };
        court.AddChild(rimNode);
        float rimY = 0; // local: the rim centre is the origin
        float boardFace = CourtDims.BoardZ - CourtDims.HoopZ; // 0.38
        float boardCY = CourtDims.BoardBottom + CourtDims.BoardH / 2 - CourtDims.RimY;
        var id = Transform3D.Identity;
        // glass
        var glass = new MeshKit();
        glass.Box(CourtDims.BoardW, CourtDims.BoardH, 0.025f, MeshKit.At(0, boardCY, boardFace + 0.0125f), new Color(0.78f, 0.87f, 0.9f, 0.22f));
        var glassMat = new StandardMaterial3D { AlbedoColor = new Color(0.78f, 0.87f, 0.9f, 0.22f), Transparency = BaseMaterial3D.TransparencyEnum.Alpha, Roughness = 0.04f, Metallic = 0.1f, CullMode = BaseMaterial3D.CullModeEnum.Disabled, VertexColorUseAsAlbedo = true };
        Place(glass, "Glass", glassMat, rimNode, "hoops", castShadow: false);
        // markings (a quad on the court side of the glass, facing the court = local -Z)
        var marks = new MeshKit();
        marks.Quad(CourtDims.BoardW, CourtDims.BoardH, MeshKit.At(0, boardCY, boardFace - 0.002f, Mathf.Pi), Colors.White);
        var markMat = new StandardMaterial3D { AlbedoTexture = Tex("boardmarks"), Transparency = BaseMaterial3D.TransparencyEnum.AlphaScissor, AlphaScissorThreshold = 0.5f, Roughness = 0.4f, CullMode = BaseMaterial3D.CullModeEnum.Disabled, VertexColorUseAsAlbedo = true };
        Place(marks, "BoardMarks", markMat, rimNode, "hoops", castShadow: false);
        // frame + rim + pole in one metal batch
        var metal = new MeshKit();
        var frameC = C("#c9cdd2"); float fw = 0.035f;
        metal.Box(CourtDims.BoardW + fw, fw, 0.045f, MeshKit.At(0, boardCY + CourtDims.BoardH / 2, boardFace + 0.015f), frameC);
        metal.Box(CourtDims.BoardW + fw, fw, 0.045f, MeshKit.At(0, boardCY - CourtDims.BoardH / 2, boardFace + 0.015f), frameC);
        metal.Box(fw, CourtDims.BoardH, 0.045f, MeshKit.At(CourtDims.BoardW / 2, boardCY, boardFace + 0.015f), frameC);
        metal.Box(fw, CourtDims.BoardH, 0.045f, MeshKit.At(-CourtDims.BoardW / 2, boardCY, boardFace + 0.015f), frameC);
        var rimC = C(Layout.hoopColors.rim);
        var rim = new MeshKit();
        rim.Torus(CourtDims.RimCentreR, CourtDims.RimTube, rimSegs, 8, MeshKit.At(0, rimY, 0), rimC);
        rim.Box(0.11f, 0.028f, boardFace - CourtDims.RimR - 0.01f, MeshKit.At(0, rimY - 0.012f, (boardFace + CourtDims.RimR) / 2 + 0.005f), rimC);
        rim.Box(0.2f, 0.16f, 0.02f, MeshKit.At(0, rimY - 0.06f, boardFace - 0.01f), rimC);
        rim.Box(0.02f, 0.1f, 0.12f, MeshKit.At(0, rimY - 0.07f, boardFace - 0.07f), rimC);
        Place(rim, "RimMesh", Matte(0.32f, 0.65f), rimNode, "hoops");
        // the park pole: 3.9 m post behind the board, a gooseneck arc over to the board's back
        var poleC = C(Layout.hoopColors.pole);
        float poleZ = 1.6f + 1.1f, backZ = boardFace + 0.03f, baseY = -CourtDims.RimY;
        metal.Cylinder(0.085f, 0.1f, 3.9f, 14, MeshKit.At(0, baseY, poleZ), poleC, y0: true);
        var path = new List<Vector3>();
        for (int i = 0; i <= 10; i++) { float t = i / 10f, a = t * Mathf.Pi / 2; path.Add(new Vector3(0, baseY + 3.9f + Mathf.Sin(a) * 0.35f - (t > 0.5f ? (t - 0.5f) * 0.1f : 0), poleZ - t * (poleZ - backZ - 0.35f))); }
        path.Add(new Vector3(0, boardCY, backZ + 0.18f));
        metal.Tube(path, _ => 0.075f, 10, poleC);
        metal.Box(0.5f, 0.5f, 0.06f, MeshKit.At(0, boardCY, backZ + 0.07f), poleC);
        metal.Box(0.06f, 0.6f, 0.5f, MeshKit.At(0, boardCY - 0.05f, backZ + 0.3f), poleC);
        metal.Cylinder(0.24f, 0.28f, 0.12f, 14, MeshKit.At(0, baseY, poleZ), poleC, y0: true);
        Place(metal, "Stanchion", Matte(0.45f, 0.7f), rimNode, "hoops");
        // the net at rest (net.js home shape: 12 columns, 6 rows, a diamond lattice of 4.5 mm strands)
        var net = new MeshKit();
        BuildNet(net, C(Layout.hoopColors.net));
        Place(net, "Net", Matte(0.85f), rimNode, "hoops");
    }

    private static void BuildNet(MeshKit kit, Color color)
    {
        int cols = 12, rows = 6; float depth = 0.44f, bottomR = 0.13f, strandR = 0.0045f;
        var home = new Vector3[cols * (rows + 1)];
        for (int r = 0; r <= rows; r++)
        {
            float t = (float)r / rows, rad = CourtDims.RimR + (bottomR - CourtDims.RimR) * Mathf.Pow(t, 0.8f);
            for (int c = 0; c < cols; c++)
            {
                float a = (c + (r % 2) * 0.5f) / cols * Mathf.Tau;
                home[r * cols + c] = new Vector3(Mathf.Cos(a) * rad, -t * depth, Mathf.Sin(a) * rad);
            }
        }
        for (int r = 0; r < rows; r++) for (int c = 0; c < cols; c++)
        {
            int a = r * cols + c, off = r % 2;
            int b1 = (r + 1) * cols + ((c + off) % cols), b2 = (r + 1) * cols + ((c + off - 1 + cols) % cols);
            kit.Tube(new[] { home[a], home[b1] }, _ => strandR, 4, color);
            kit.Tube(new[] { home[a], home[b2] }, _ => strandR, 4, color);
        }
    }

    private static void BallRack(MeshKit kit, float x, float z, float yaw)
    {
        var c = MeshKit.Hex("#2c3237");
        kit.Box(1.4f, 0.05f, 0.4f, MeshKit.At(x, 0.55f, z, yaw), c); kit.Box(1.4f, 0.05f, 0.4f, MeshKit.At(x, 0.95f, z, yaw), c);
        foreach (var sx in new[] { -0.68f, 0.68f }) kit.Box(0.05f, 1.0f, 0.4f, MeshKit.At(x, 0.5f, z, yaw) * new Transform3D(Basis.Identity, new Vector3(sx, 0, 0)), c);
        // a few balls on it
        for (int i = 0; i < 4; i++) kit.Sphere(0.1194f, 10, 7, MeshKit.At(x, 0.72f, z, yaw) * new Transform3D(Basis.Identity, new Vector3(-0.5f + i * 0.33f, 0, 0)), MeshKit.Hex("#c8581f"));
    }
}
