using Godot;
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Rimrift.World;

/// <summary>
/// The court geometry (client/js/sim/constants.js COURT) — the sim's numbers are the law; duplicated here so the world
/// scripts do not depend on the Rules agent's port, and checked against the JS export at load (HarborLayout.Verify).
/// </summary>
public static class CourtDims
{
    public const float Length = 28.65f, Width = 15.24f;
    public const float HoopZ = 12.725f, RimY = 3.05f, RimR = 0.2286f, RimTube = 0.0095f;
    public const float BoardZ = 13.105f, BoardW = 1.83f, BoardH = 1.07f, BoardBottom = 2.9f, BoardT = 0.05f;
    public const float KeyWidth = 4.88f, FtDist = 5.79f, FtRadius = 1.83f;
    public const float ThreeRadius = 7.24f, CornerThree = 6.71f, Restricted = 1.22f, CenterRadius = 1.83f;
    public const float BallR = 0.1194f;
    public const float LineW = 0.0508f;
    /// torus centreline radius as the sim collides it (ball.js RT = rimR + rimTube): the inner edge is rimR
    public const float RimCentreR = RimR + RimTube;
}

/// The park layout exported by tools/world/export_layout.mjs from the JS game (themes.js PARK_COURTS etc.).
public sealed class HarborLayout
{
    public sealed class CourtEntry
    {
        public string id { get; set; } = ""; public string name { get; set; } = ""; public int format { get; set; } public bool full { get; set; }
        public float[] origin { get; set; } = new float[3];
        public List<Hoop> hoops { get; set; } = new();
        public float logoSize { get; set; } public float[] overlayZ { get; set; } = new float[2];
        public Fence fence { get; set; } = new();
        public List<Pole> poles { get; set; } = new();
        public List<Bench> benches { get; set; } = new();
        public XZ trash { get; set; } = new();
        public GotNext gotNext { get; set; } = new();
    }
    public sealed class Hoop { public int side { get; set; } public float[] rim { get; set; } = new float[3]; }
    public sealed class Fence { public float h { get; set; } public List<float[]> runs { get; set; } = new(); public float halfW { get; set; } public float halfL { get; set; } }
    public sealed class Pole { public float x { get; set; } public float z { get; set; } public float yaw { get; set; } public float h { get; set; } }
    public sealed class Bench { public float x { get; set; } public float z { get; set; } public float yaw { get; set; } public string wood { get; set; } = "#9a6b42"; public string metal { get; set; } = "#30363b"; }
    public sealed class XZ { public float x { get; set; } public float z { get; set; } }
    public sealed class GotNext { public XZ mid { get; set; } = new(); public List<List<XZ>> rows { get; set; } = new(); }
    public sealed class Practice { public float[] origin { get; set; } = new float[3]; public float[] hoopOrigin { get; set; } = new float[3]; public float[] rim { get; set; } = new float[3]; public Slab slab { get; set; } = new(); public Rack rack { get; set; } = new(); }
    public sealed class Slab { public float x { get; set; } public float z { get; set; } public float w { get; set; } public float d { get; set; } public float h { get; set; } }
    public sealed class Rack { public float x { get; set; } public float z { get; set; } public float yaw { get; set; } }
    public sealed class Plaza
    {
        public XZ store { get; set; } = new(); public XZ wheel { get; set; } = new(); public XZ boost { get; set; } = new();
        public Size kiosk { get; set; } = new(); public string affColor { get; set; } = "#ef7d3c";
        public Building hq { get; set; } = new(); public Building hall { get; set; } = new();
        public List<Lamp> lamps { get; set; } = new(); public Mural mural { get; set; } = new();
    }
    public sealed class Size { public float w { get; set; } public float d { get; set; } public float h { get; set; } }
    public sealed class Building { public float x { get; set; } public float z { get; set; } public float w { get; set; } public float d { get; set; } public float h { get; set; } }
    public sealed class Lamp { public float x { get; set; } public float z { get; set; } public float h { get; set; } }
    public sealed class Mural { public float x { get; set; } public float y { get; set; } public float z { get; set; } public float w { get; set; } public float h { get; set; } public float t { get; set; } public float yaw { get; set; } }
    public sealed class Railing { public float z { get; set; } public float x0 { get; set; } public float x1 { get; set; } public float step { get; set; } public float h { get; set; } public string color { get; set; } = "#e8e3d8"; }
    public sealed class House { public float x { get; set; } public float z { get; set; } public float w { get; set; } public float h { get; set; } public float d { get; set; } public float y { get; set; } public string color { get; set; } = "#e9d8c0"; public Roof roof { get; set; } = new(); }
    public sealed class Roof { public float w { get; set; } public float h { get; set; } public float d { get; set; } public float y { get; set; } public string color { get; set; } = "#b65c3a"; }
    public sealed class Palm { public float x { get; set; } public float z { get; set; } public float s { get; set; } = 1; public float height { get; set; } public float[] lean { get; set; } = new float[2]; public string tier { get; set; } = "full"; }
    public sealed class Shore { public float z { get; set; } public float wet { get; set; } public float y { get; set; } public float water { get; set; } public float waterline { get; set; } public Sea sea { get; set; } = new(); public Surf surf { get; set; } = new(); }
    public sealed class Sea { public float width { get; set; } public float depth { get; set; } public float z { get; set; } public float y { get; set; } public string color { get; set; } = "#15566e"; public string color2 { get; set; } = "#2b7f92"; }
    public sealed class Surf { public float z { get; set; } public float depth { get; set; } }
    public sealed class Theme { public Dictionary<string, JsonElement> court { get; set; } = new(); public string ground { get; set; } = "#fff3e2"; public SunSpec sun { get; set; } = new(); public FogSpec fog { get; set; } = new(); public SkySpec sky { get; set; } = new(); }
    public sealed class SkySpec { public float[] top { get; set; } = { 0.16f, 0.2f, 0.42f }; public float[] horizon { get; set; } = { 1f, 0.56f, 0.32f }; public float[] ground { get; set; } = { 0.35f, 0.25f, 0.2f }; }
    public sealed class SunSpec { public float[] dir { get; set; } = new float[3]; public float[] color { get; set; } = new float[3]; public float intensity { get; set; } }
    public sealed class FogSpec { public float[] color { get; set; } = new float[3]; public float density { get; set; } }
    public sealed class HoopColors { public string rim { get; set; } = "#d8431c"; public string pole { get; set; } = "#2f5f63"; public string net { get; set; } = "#f4f4f0"; }

    public Dictionary<string, float> court { get; set; } = new();
    public Theme theme { get; set; } = new();
    public HoopColors hoopColors { get; set; } = new();
    public Shore shore { get; set; } = new();
    public List<CourtEntry> courts { get; set; } = new();
    public Practice practice { get; set; } = new();
    public Plaza plaza { get; set; } = new();
    public Railing railing { get; set; } = new();
    public List<House> houses { get; set; } = new();
    public List<Palm> palms { get; set; } = new();

    public static HarborLayout Load(string path = "res://assets/world/harbor_layout.json")
    {
        using var f = FileAccess.Open(path, FileAccess.ModeFlags.Read);
        if (f == null) throw new Exception("HarborLayout: cannot open " + path + " (" + FileAccess.GetOpenError() + ")");
        var text = f.GetAsText();
        var lay = JsonSerializer.Deserialize<HarborLayout>(text, new JsonSerializerOptions { PropertyNameCaseInsensitive = true, NumberHandling = JsonNumberHandling.AllowReadingFromString })
            ?? throw new Exception("HarborLayout: empty");
        return lay;
    }

    // ---------------- the ported layout maths (venues.js buildPark) ----------------
    public const float FenceH = 3.8f;
    public static float FenceHalfW => CourtDims.Width / 2 + 2.2f;
    public static float FenceHalfL => CourtDims.Length / 2 + 2.6f;

    /// Fence runs for a court: [x0, z0, x1, z1] (venues.js: full courts get both baselines, the west sideline and the
    /// east sideline's two stubs either side of the Got Next line; half courts a cage open at the half-court end).
    public static List<float[]> FenceRuns(float ox, float oz, bool full)
    {
        float W = FenceHalfW, L = FenceHalfL;
        float zf = full ? oz - L : oz - 3.2f;
        var runs = new List<float[]> { new[] { ox - W, oz + L, ox + W, oz + L }, new[] { ox - W, zf, ox - W, oz + L }, new[] { ox + W, oz + 6, ox + W, oz + L } };
        if (full) { runs.Add(new[] { ox - W, oz - L, ox + W, oz - L }); runs.Add(new[] { ox + W, oz - L, ox + W, oz - 9 }); }
        return runs;
    }
    /// Light poles at the court's corners: (x, z, yaw, height).
    public static List<(float x, float z, float yaw, float h)> Poles(float ox, float oz, bool full)
    {
        float W = FenceHalfW, L = FenceHalfL, zf = full ? oz - L : oz - 3.2f;
        var corners = full ? new[] { (-1f, -1f), (1f, -1f), (-1f, 1f), (1f, 1f) } : new[] { (-1f, 1f), (1f, 1f), (-1f, -0.05f), (1f, -0.05f) };
        var outp = new List<(float, float, float, float)>();
        foreach (var (sx, sz) in corners)
        {
            float lx = ox + sx * (W + 0.3f), lz = sz > 0 ? oz + sz * (L - 1.5f) : (full ? oz + sz * (L - 1.5f) : zf + 1.2f);
            float yaw = Mathf.Atan2(ox - lx, (full ? oz : oz + 7) - lz);
            outp.Add((lx, lz, yaw, full ? 10 : 8));
        }
        return outp;
    }
    /// Benches: west sideline (3 on a full court, 1 on a half court) plus one by the Got Next line.
    public static List<(float x, float z, float yaw)> Benches(float ox, float oz, bool full)
    {
        float W = FenceHalfW; var b = new List<(float, float, float)>();
        int nb = full ? 3 : 1;
        for (int k = 0; k < nb; k++) b.Add((ox - W + 0.9f, (full ? oz - 9 : oz + 4) + k * 6, Mathf.Pi / 2));
        b.Add((ox + W + 1.6f, oz + (full ? -6 : 0), -Mathf.Pi / 2));
        return b;
    }
    /// themes.js gotNextMid / squadSpots
    public static (float x, float z) GotNextMid(float ox, float oz, bool full) => (ox + 9.4f, full ? oz : oz + 6.2f);
    public static List<List<(float x, float z)>> SquadSpots(float ox, float oz, bool full, int format)
    {
        var (mx, mz) = GotNextMid(ox, oz, full); float gap = 1.8f, step = 2.2f;
        var a = new List<(float, float)>(); var b = new List<(float, float)>();
        for (int i = 0; i < format; i++) { a.Add((mx, mz - gap - i * step)); b.Add((mx, mz + gap + i * step)); }
        return new() { a, b };
    }

    /// The layout proof: every value the C# maths derives must equal the JS export. Returns the number of values
    /// compared; throws on the first mismatch beyond 1e-4 m.
    public int Verify()
    {
        int n = 0;
        void Eq(float a, float b, string what) { n++; if (Mathf.Abs(a - b) > 1e-4f) throw new Exception($"layout mismatch {what}: C# {a} vs JS {b}"); }
        Eq(court["length"], CourtDims.Length, "length"); Eq(court["width"], CourtDims.Width, "width"); Eq(court["hoopZ"], CourtDims.HoopZ, "hoopZ");
        Eq(court["rimY"], CourtDims.RimY, "rimY"); Eq(court["rimR"], CourtDims.RimR, "rimR"); Eq(court["rimTube"], CourtDims.RimTube, "rimTube");
        Eq(court["boardZ"], CourtDims.BoardZ, "boardZ"); Eq(court["boardW"], CourtDims.BoardW, "boardW"); Eq(court["boardH"], CourtDims.BoardH, "boardH"); Eq(court["boardBottom"], CourtDims.BoardBottom, "boardBottom");
        Eq(court["keyWidth"], CourtDims.KeyWidth, "keyWidth"); Eq(court["ftDist"], CourtDims.FtDist, "ftDist"); Eq(court["threeRadius"], CourtDims.ThreeRadius, "threeRadius"); Eq(court["cornerThree"], CourtDims.CornerThree, "cornerThree");
        Eq(court["ballR"], CourtDims.BallR, "ballR");
        foreach (var c in courts)
        {
            float ox = c.origin[0], oz = c.origin[2];
            foreach (var h in c.hoops) { Eq(ox, h.rim[0], c.id + " rim x"); Eq(CourtDims.RimY, h.rim[1], c.id + " rim y"); Eq(oz + h.side * CourtDims.HoopZ, h.rim[2], c.id + " rim z"); }
            var runs = FenceRuns(ox, oz, c.full);
            if (runs.Count != c.fence.runs.Count) throw new Exception("fence run count " + c.id);
            for (int i = 0; i < runs.Count; i++) for (int k = 0; k < 4; k++) Eq(runs[i][k], c.fence.runs[i][k], $"{c.id} fence {i}[{k}]");
            Eq(FenceH, c.fence.h, "fence h");
            var poles = Poles(ox, oz, c.full);
            for (int i = 0; i < poles.Count; i++) { Eq(poles[i].x, c.poles[i].x, c.id + " pole x"); Eq(poles[i].z, c.poles[i].z, c.id + " pole z"); Eq(poles[i].yaw, c.poles[i].yaw, c.id + " pole yaw"); Eq(poles[i].h, c.poles[i].h, c.id + " pole h"); }
            var benches = Benches(ox, oz, c.full);
            for (int i = 0; i < benches.Count; i++) { Eq(benches[i].x, c.benches[i].x, c.id + " bench x"); Eq(benches[i].z, c.benches[i].z, c.id + " bench z"); Eq(benches[i].yaw, c.benches[i].yaw, c.id + " bench yaw"); }
            Eq(ox + FenceHalfW + 1.4f, c.trash.x, "trash x"); Eq(oz + 12, c.trash.z, "trash z");
            var (gx, gz) = GotNextMid(ox, oz, c.full); Eq(gx, c.gotNext.mid.x, "gotnext x"); Eq(gz, c.gotNext.mid.z, "gotnext z");
            var rows = SquadSpots(ox, oz, c.full, c.format);
            for (int r = 0; r < 2; r++) for (int i = 0; i < c.format; i++) { Eq(rows[r][i].x, c.gotNext.rows[r][i].x, "spot x"); Eq(rows[r][i].z, c.gotNext.rows[r][i].z, "spot z"); }
        }
        // the shore (harbor.js SHORE / waterlineZ)
        float wl = shore.z + (shore.wet - shore.z) * (shore.water + 0.005f) / (shore.y + 0.005f);
        Eq(wl, shore.waterline, "waterline");
        return n;
    }

    public static Vector3 V3(float[] a) => new(a[0], a[1], a[2]);
}
