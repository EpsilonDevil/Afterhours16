using Godot;
using System;
using System.Collections.Generic;

namespace Rimrift.World;

public partial class HarborPoint
{
    // ---------------- fences and light poles (venues.js buildPark, props.js fenceFrame/fenceMesh/lightPole) ----------------
    private void BuildFencesAndPoles()
    {
        var frame = new MeshKit(); var mesh = new MeshKit(); var lampFaces = new MeshKit();
        Color postC = C("#59636b"), poleC = C("#2c3237"), headC = C("#1c2024");
        foreach (var c in Layout.courts)
        {
            float ox = c.origin[0], oz = c.origin[2];
            foreach (var run in HarborLayout.FenceRuns(ox, oz, c.full))
            {
                float x0 = run[0], z0 = run[1], x1 = run[2], z1 = run[3], h = HarborLayout.FenceH;
                // posts every ~3 m, a top and a bottom rail
                float len = Mathf.Sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0)); int n = Math.Max(1, Mathf.RoundToInt(len / 3));
                for (int i = 0; i <= n; i++) { float t = (float)i / n; frame.Cylinder(0.035f, 0.035f, h, 6, MeshKit.At(x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t), postC, y0: true); }
                foreach (var y in new[] { h - 0.02f, 0.15f }) frame.Tube(new[] { new Vector3(x0, y, z0), new Vector3(x1, y, z1) }, _ => 0.025f, 5, postC);
                // the chain-link: one quad per run, the texture tiling every 1.2 m
                float yaw = Mathf.Atan2(x1 - x0, z1 - z0) - Mathf.Pi / 2;
                mesh.Quad(len, h, MeshKit.At((x0 + x1) / 2, 0, (z0 + z1) / 2, yaw), new Color(0.75f, 0.78f, 0.8f), bottom: true, tileU: len / 1.2f, tileV: h / 1.2f);
            }
            foreach (var (x, z, yaw, h) in HarborLayout.Poles(ox, oz, c.full))
            {
                frame.Cylinder(0.09f, 0.14f, h, 10, MeshKit.At(x, 0, z), poleC, y0: true);
                frame.Box(1.6f, 0.12f, 0.12f, MeshKit.At(x, h - 0.1f, z, yaw), poleC);
                foreach (var o in new[] { -0.55f, 0, 0.55f })
                {
                    frame.Box(0.38f, 0.22f, 0.3f, MeshKit.At(x, h - 0.25f, z, yaw) * new Transform3D(Basis.Identity, new Vector3(o, 0, 0.12f)), headC);
                    // the lamp face: a plane under each head (floodlights are off at sunset: a pale glass, no glow)
                    lampFaces.Plane(0.32f, 0.24f, 1, 1, MeshKit.At(x, h - 0.37f, z, yaw) * new Transform3D(Basis.Identity, new Vector3(o, 0, 0.12f)) * new Transform3D(new Basis(Vector3.Right, Mathf.Pi), Vector3.Zero), new Color(0.9f, 0.9f, 0.86f));
                }
            }
        }
        Place(frame, "FenceFrames", Matte(0.42f, 0.65f), this, "fences");
        var chain = new StandardMaterial3D
        {
            AlbedoTexture = Tex("chainlink"), VertexColorUseAsAlbedo = true, Roughness = 0.4f, Metallic = 0.6f,
            Transparency = BaseMaterial3D.TransparencyEnum.AlphaScissor, AlphaScissorThreshold = 0.42f, AlphaAntialiasingMode = BaseMaterial3D.AlphaAntiAliasing.AlphaToCoverageAndToOne,
            CullMode = BaseMaterial3D.CullModeEnum.Disabled, TextureFilter = BaseMaterial3D.TextureFilterEnum.LinearWithMipmapsAnisotropic,
        };
        Place(mesh, "ChainLink", chain, this, "fences");
        Place(lampFaces, "LampFaces", new StandardMaterial3D { VertexColorUseAsAlbedo = true, Roughness = 0.2f, Metallic = 0.3f, CullMode = BaseMaterial3D.CullModeEnum.Disabled }, this, "fences", castShadow: false);
    }

    // ---------------- the rest of the park's props ----------------
    private void BuildProps()
    {
        var matte = new MeshKit(); var metal = new MeshKit(); var glow = new MeshKit();
        foreach (var c in Layout.courts)
        {
            foreach (var b in c.benches) Bench(matte, b.x, b.z, b.yaw, C(b.wood), C(b.metal));
            TrashCan(matte, c.trash.x, c.trash.z);
        }
        // the plaza: kiosks (VC store, Boosts), the Daily Spin wheel's frame, the Crew HQ and the Event hall
        var pz = Layout.plaza;
        Kiosk(matte, pz.store.x, pz.store.z, C(pz.affColor));
        Kiosk(matte, pz.boost.x, pz.boost.z, C("#2f8f6b"));
        WheelFrame(matte, metal, pz.wheel.x, pz.wheel.z, C(pz.affColor));
        Clubhouse(matte, glow, pz.hq.x, pz.hq.z, pz.hq.w, pz.hq.d, pz.hq.h, C("#5b3a33"), C(pz.affColor), 2.2f);
        Clubhouse(matte, glow, pz.hall.x, pz.hall.z, pz.hall.w, pz.hall.d, pz.hall.h, C("#2a2d33"), C("#ff8a1f"), 2.0f);
        foreach (var l in pz.lamps) StreetLamp(metal, glow, l.x, l.z, l.h);
        // the mural wall behind the west court (a plain warm wall here; the mural painter is not ported)
        var m = pz.mural;
        matte.Box(m.w, m.h, m.t, MeshKit.At(m.x, m.y, m.z, m.yaw), C("#d9c3a3"));
        // the boardwalk railing along the beach
        var r = Layout.railing; var railC = C(r.color);
        for (float x = r.x0; x <= r.x1 + 1e-3f; x += r.step) metal.Cylinder(0.04f, 0.04f, r.h, 6, MeshKit.At(x, 0, r.z), railC, y0: true);
        metal.Tube(new[] { new Vector3(r.x0, r.h, r.z), new Vector3(r.x1, r.h, r.z) }, _ => 0.04f, 6, railC);
        // the beach houses to the south (coastScenery): a box and a roof slab, in the game's own colours
        foreach (var h in Layout.houses)
        {
            matte.Box(h.w, h.h, h.d, MeshKit.At(h.x, h.y, h.z), C(h.color));
            matte.Box(h.roof.w, h.roof.h, h.roof.d, MeshKit.At(h.x, h.roof.y, h.z), C(h.roof.color));
        }
        Place(matte, "Props", Matte(), this, "props");
        Place(metal, "PropsMetal", Matte(0.42f, 0.65f), this, "props");
        Place(glow, "PropsGlow", Unlit(Colors.White, 1.5f), this, "props", castShadow: false);
    }

    /// props.js bench: three slat boards, a three-board angled back, steel legs, rails and armrests
    private static void Bench(MeshKit kit, float x, float z, float yaw, Color wood, Color metal)
    {
        Transform3D At(float dx, float dy, float dz) => MeshKit.At(x, 0, z, yaw) * new Transform3D(Basis.Identity, new Vector3(dx, dy, dz));
        for (int i = 0; i < 3; i++) kit.Box(2.2f, 0.05f, 0.12f, At(0, 0.46f, -0.14f + i * 0.14f), wood);
        for (int i = 0; i < 3; i++) kit.Box(2.2f, 0.11f, 0.045f, At(0, 0.6f + i * 0.13f, -0.23f - i * 0.035f), wood);
        foreach (var sx in new[] { -1f, 1f })
        {
            kit.Box(0.07f, 0.46f, 0.08f, At(sx * 0.95f, 0.23f, 0.12f), metal);
            kit.Box(0.07f, 0.46f, 0.08f, At(sx * 0.95f, 0.23f, -0.2f), metal);
            kit.Box(0.07f, 0.06f, 0.52f, At(sx * 0.95f, 0.44f, -0.05f), metal);
            kit.Box(0.06f, 0.05f, 0.42f, At(sx * 1.02f, 0.78f, -0.08f), metal);
            kit.Box(0.06f, 0.3f, 0.05f, At(sx * 1.02f, 0.62f, 0.1f), metal);
        }
    }

    /// props.js trashCan: a slatted bin on a base with a domed lid
    private static void TrashCan(MeshKit kit, float x, float z)
    {
        var dark = MeshKit.Hex("#22262a"); var body = MeshKit.Hex("#2f4f45"); var lid = MeshKit.Hex("#2b3034");
        kit.Cylinder(0.34f, 0.31f, 0.08f, 14, MeshKit.At(x, 0, z), dark, y0: true);
        kit.Cylinder(0.29f, 0.26f, 0.82f, 14, MeshKit.At(x, 0.08f, z), body, y0: true);
        for (int i = 0; i < 12; i++) { float a = i / 12f * Mathf.Tau; kit.Box(0.05f, 0.78f, 0.05f, MeshKit.At(x + Mathf.Sin(a) * 0.295f, 0.1f + 0.39f, z + Mathf.Cos(a) * 0.295f), dark); }
        kit.Cylinder(0.33f, 0.33f, 0.06f, 14, MeshKit.At(x, 0.88f, z), dark, y0: true);
        kit.Cylinder(0.3f, 0.16f, 0.16f, 14, MeshKit.At(x, 0.94f, z), lid, y0: true);
        kit.Sphere(0.11f, 9, 7, MeshKit.At(x, 1.12f, z), lid);
    }

    /// props.js kiosk, the shell: floor, roof slab, side walls, knee walls with counters, headers, striped awnings
    private static void Kiosk(MeshKit kit, float x, float z, Color color)
    {
        float W = 5.2f, D = 3.4f, Hh = 3.2f, t = 0.18f;
        var wall = MeshKit.Hex("#e8e2d6"); var dark = MeshKit.Hex("#2a2e33"); var cream = MeshKit.Hex("#f4f1ea");
        void Put(float w, float h, float d, float dx, float dy, float dz, Color c) => kit.Box(w, h, d, MeshKit.At(x + dx, dy, z + dz), c);
        Put(W, 0.12f, D, 0, 0.06f, 0, MeshKit.Hex("#cfc7b8"));
        Put(W + 0.5f, 0.22f, D + 0.5f, 0, Hh, 0, dark);
        Put(t, Hh, D, -W / 2 + t / 2, Hh / 2, 0, wall); Put(t, Hh, D, W / 2 - t / 2, Hh / 2, 0, wall);
        foreach (var sz in new[] { 1f, -1f })
        {
            Put(W - t * 2, 1.05f, t, 0, 0.52f, sz * (D / 2 - t / 2), wall);
            Put(W - t * 2 + 0.3f, 0.1f, 0.5f, 0, 1.1f, sz * (D / 2 - 0.1f), MeshKit.Hex("#8a6f4e"));
            Put(W - t * 2, 0.9f, t, 0, Hh - 0.45f, sz * (D / 2 - t / 2), wall);
            for (int i = 0; i < 3; i++) Put((W + 0.6f) / 3 - 0.02f, 0.1f, 1.15f, (i - 1) * (W + 0.6f) / 3, Hh - 0.3f, sz * (D / 2 + 0.5f), i % 2 == 1 ? cream : color);
            Put(W + 0.6f, 0.26f, 0.12f, 0, Hh - 0.42f, sz * (D / 2 + 1.03f), color);
        }
        for (int shelf = 0; shelf < 3; shelf++) Put(W - 0.9f, 0.07f, 0.42f, 0, 0.75f + shelf * 0.72f, -0.2f, MeshKit.Hex("#6d5a42"));
    }

    /// props.js prizeWheel's frame and ring (the painted face is not ported)
    private static void WheelFrame(MeshKit matte, MeshKit metal, float x, float z, Color accent)
    {
        float cy = 2.35f, R = 1.45f; var frameC = MeshKit.Hex("#2a2e33");
        matte.Box(3.2f, 0.3f, 1.2f, MeshKit.At(x, 0.15f, z), frameC);
        matte.Box(0.22f, cy, 0.22f, MeshKit.At(x - 1.05f, cy / 2, z - 0.25f), frameC); matte.Box(0.22f, cy, 0.22f, MeshKit.At(x + 1.05f, cy / 2, z - 0.25f), frameC);
        matte.Box(2.3f, 0.2f, 0.22f, MeshKit.At(x, cy, z - 0.25f), frameC);
        metal.Torus(R + 0.03f, 0.06f, 48, 8, new Transform3D(new Basis(Vector3.Right, Mathf.Pi / 2), new Vector3(x, cy, z + 0.02f)), accent);
        matte.Cylinder(R, R, 0.04f, 36, new Transform3D(new Basis(Vector3.Right, Mathf.Pi / 2), new Vector3(x, cy, z + 0.06f)), MeshKit.Hex("#f4f1ea"));
    }

    /// props.js crewHQ / eventHall shell: back and side walls, roof slab and parapet, a plinth, piers either side
    /// of a glass door, an awning in the crew colour, lit windows
    private static void Clubhouse(MeshKit kit, MeshKit glow, float x, float z, float W, float D, float Hh, Color wallC, Color color, float door)
    {
        float t = 0.22f; var trim = MeshKit.Hex("#22262b"); var glass = MeshKit.Hex("#1c2a33");
        void Put(float w, float h, float d, float dx, float dy, float dz, Color c, MeshKit? into = null) => (into ?? kit).Box(w, h, d, MeshKit.At(x + dx, dy, z + dz), c);
        Put(W, Hh, t, 0, Hh / 2, -D / 2 + t / 2, wallC);
        foreach (var sx in new[] { -1f, 1f }) Put(t, Hh, D, sx * (W / 2 - t / 2), Hh / 2, 0, wallC);
        Put(W + 0.3f, 0.3f, D + 0.3f, 0, Hh + 0.15f, 0, trim);
        foreach (var sz in new[] { -1f, 1f }) Put(W + 0.3f, 0.5f, 0.14f, 0, Hh + 0.55f, sz * (D / 2 + 0.08f), trim);
        foreach (var sx in new[] { -1f, 1f }) Put(0.14f, 0.5f, D + 0.3f, sx * (W / 2 + 0.08f), Hh + 0.55f, 0, trim);
        Put(W + 0.12f, 0.35f, D + 0.12f, 0, 0.175f, 0, MeshKit.Hex("#3a3f45"));
        float fz = D / 2 - t / 2;
        foreach (var sx in new[] { -1f, 1f }) Put((W - door) / 2, Hh, t, sx * (door / 2 + (W - door) / 4), Hh / 2, fz, wallC);
        Put(door, Hh - 2.7f, t, 0, 2.7f + (Hh - 2.7f) / 2, fz, wallC);
        Put(door, 2.7f, 0.06f, 0, 1.35f, fz - 0.02f, glass);
        foreach (var dx in new[] { -door / 2, 0, door / 2 }) Put(0.1f, 2.7f, 0.12f, dx, 1.35f, fz + 0.02f, trim);
        Put(door + 0.1f, 0.1f, 0.12f, 0, 2.7f, fz + 0.02f, trim);
        Put(door + 1.2f, 0.12f, 1.3f, 0, 3.05f, D / 2 + 0.65f, color);
        Put(door + 1.2f, 0.3f, 0.08f, 0, 2.92f, D / 2 + 1.3f, color);
        foreach (var sx in new[] { -1f, 1f })
        {
            float wx = sx * (door / 2 + (W - door) / 4);
            Put(1.5f, 1.3f, 0.04f, wx, 1.85f, D / 2 + 0.005f, MeshKit.Hex("#ffd9a0"), glow);
            Put(1.62f, 0.08f, 0.1f, wx, 2.52f, D / 2 + 0.03f, trim); Put(1.62f, 0.08f, 0.1f, wx, 1.18f, D / 2 + 0.03f, trim);
            Put(0.06f, 1.3f, 0.1f, wx, 1.85f, D / 2 + 0.03f, trim);
        }
        Put(door + 0.8f, 0.04f, 0.1f, 0, 2.98f, D / 2 + 1.2f, MeshKit.Hex("#fff2d6"), glow);
    }

    /// props.js streetLamp: a fluted base, a tapered column, a quarter-arc arm, a lantern with a glass bowl
    private static void StreetLamp(MeshKit kit, MeshKit glow, float x, float z, float h)
    {
        var c = MeshKit.Hex("#25292d");
        kit.Cylinder(0.17f, 0.13f, 0.32f, 10, MeshKit.At(x, 0, z), c, y0: true);
        kit.Cylinder(0.12f, 0.095f, 0.18f, 10, MeshKit.At(x, 0.32f, z), c, y0: true);
        kit.Cylinder(0.075f, 0.055f, h - 0.5f, 9, MeshKit.At(x, 0.5f, z), c, y0: true);
        kit.Cylinder(0.1f, 0.1f, 0.1f, 9, MeshKit.At(x, h - 0.3f, z), c, y0: true);
        var arm = new List<Vector3>();
        for (int i = 0; i <= 6; i++) { float t = i / 6f; arm.Add(new Vector3(x + Mathf.Sin(t * Mathf.Pi / 2) * 0.5f, h - 0.2f + (1 - Mathf.Cos(t * Mathf.Pi / 2)) * 0.42f, z)); }
        kit.Tube(arm, _ => 0.045f, 7, c);
        float lx = x + 0.5f, ly = h + 0.22f;
        glow.Cylinder(0.1f, 0.19f, 0.34f, 8, MeshKit.At(lx, ly - 0.34f, z), MeshKit.Hex("#fdf0cf"), y0: true);
        kit.Cylinder(0.21f, 0.05f, 0.22f, 8, MeshKit.At(lx, ly, z), c, y0: true);
        kit.Sphere(0.05f, 7, 6, MeshKit.At(lx, ly + 0.26f, z), c);
    }
}
