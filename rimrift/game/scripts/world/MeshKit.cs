using Godot;
using System;
using System.Collections.Generic;

namespace Rimrift.World;

/// <summary>
/// A vertex-array accumulator that ports client/js/gfx/geometry.js (box, plane, quad, sphere, cylinder, torus, tube)
/// and G.merge: every primitive is appended in world space with an optional vertex colour, and ToMesh() hands the
/// batch to an ArrayMesh as one surface. Everything the park is built from goes through here, so triangle counts
/// per category come for free (Triangles).
/// </summary>
public sealed class MeshKit
{
    private readonly List<Vector3> _pos = new();
    private readonly List<Vector3> _nrm = new();
    private readonly List<Vector2> _uv = new();
    private readonly List<Vector2> _uv2 = new();
    private readonly List<Color> _col = new();
    private readonly List<int> _idx = new();
    public bool UseUv2;
    public int Triangles => _idx.Count / 3;
    public int Vertices => _pos.Count;
    public bool IsEmpty => _idx.Count == 0;

    public static Color Hex(string hex)
    {
        // JS hexLinear: colours are given in sRGB; Godot's Color(...) from html is sRGB too and the renderer linearises
        return Color.FromHtml(hex);
    }

    private void Push(Vector3 p, Vector3 n, Vector2 uv, Color c, Vector2? uv2 = null)
    {
        _pos.Add(p); _nrm.Add(n); _uv.Add(uv); _col.Add(c);
        if (UseUv2) _uv2.Add(uv2 ?? uv);
    }

    /// Append raw triangles (positions/normals/uvs in local space) under a transform.
    public void Add(IList<Vector3> pos, IList<Vector3> nrm, IList<Vector2> uv, IList<int> idx, Transform3D xf, Color color)
    {
        int b = _pos.Count;
        var basis = xf.Basis;
        // normals: inverse-transpose for non-uniform scale (props.js bake explains why this matters)
        var nb = basis.Inverse().Transposed();
        for (int i = 0; i < pos.Count; i++) Push(xf * pos[i], (nb * nrm[i]).Normalized(), uv[i], color);
        foreach (var i in idx) _idx.Add(b + i);
    }

    /// Append raw triangles already in world space with a UV2 derived from the position (the court floor).
    public void AddWithUv2(IList<Vector3> pos, IList<Vector3> nrm, IList<Vector2> uv, IList<int> idx, Func<Vector3, Vector2> uv2)
    {
        int b = _pos.Count;
        for (int i = 0; i < pos.Count; i++) Push(pos[i], nrm[i], uv[i], Colors.White, uv2(pos[i]));
        foreach (var i in idx) _idx.Add(b + i);
    }

    // ---------------- primitives (geometry.js) ----------------
    public void Box(float w, float h, float d, Transform3D xf, Color color, bool y0 = false, float tile = 0)
    {
        float x = w / 2, y = h / 2, z = d / 2;
        var faces = new (Vector3 n, Vector3[] v, float fu, float fv)[] {
            (new(1,0,0), new Vector3[]{ new(x,-y,z), new(x,-y,-z), new(x,y,-z), new(x,y,z) }, d, h),
            (new(-1,0,0), new Vector3[]{ new(-x,-y,-z), new(-x,-y,z), new(-x,y,z), new(-x,y,-z) }, d, h),
            (new(0,1,0), new Vector3[]{ new(-x,y,z), new(x,y,z), new(x,y,-z), new(-x,y,-z) }, w, d),
            (new(0,-1,0), new Vector3[]{ new(-x,-y,-z), new(x,-y,-z), new(x,-y,z), new(-x,-y,z) }, w, d),
            (new(0,0,1), new Vector3[]{ new(-x,-y,z), new(x,-y,z), new(x,y,z), new(-x,y,z) }, w, h),
            (new(0,0,-1), new Vector3[]{ new(x,-y,-z), new(-x,-y,-z), new(-x,y,-z), new(x,y,-z) }, w, h),
        };
        var pos = new List<Vector3>(); var nrm = new List<Vector3>(); var uv = new List<Vector2>(); var idx = new List<int>();
        var off = y0 ? new Vector3(0, h / 2, 0) : Vector3.Zero;
        foreach (var (n, v, fu, fv) in faces)
        {
            int b = pos.Count; float su = tile > 0 ? fu / tile : 1, sv = tile > 0 ? fv / tile : 1;
            for (int i = 0; i < 4; i++) { pos.Add(v[i] + off); nrm.Add(n); }
            uv.Add(new(0, sv)); uv.Add(new(su, sv)); uv.Add(new(su, 0)); uv.Add(new(0, 0));
            idx.AddRange(new[] { b, b + 2, b + 1, b, b + 3, b + 2 });
        }
        Add(pos, nrm, uv, idx, xf, color);
    }

    /// Horizontal plane (normal +y) w along x, d along z, centred; uv 0..1 (times tile).
    public void Plane(float w, float d, int sx, int sz, Transform3D xf, Color color, Func<float, float, float>? height = null, Func<float, float, Color>? shade = null, Func<float, float, Vector2>? uvFn = null)
    {
        var pos = new List<Vector3>(); var nrm = new List<Vector3>(); var uv = new List<Vector2>(); var idx = new List<int>();
        var cols = new List<Color>();
        for (int j = 0; j <= sz; j++) for (int i = 0; i <= sx; i++)
        {
            float u = (float)i / sx, v = (float)j / sz;
            float x = (u - 0.5f) * w, z = (v - 0.5f) * d;
            var wp = xf * new Vector3(x, 0, z);
            float y = height?.Invoke(wp.X, wp.Z) ?? 0;
            pos.Add(new Vector3(x, y, z)); nrm.Add(Vector3.Up);
            uv.Add(uvFn?.Invoke(wp.X, wp.Z) ?? new Vector2(u, v));
            cols.Add(shade?.Invoke(wp.X, wp.Z) ?? color);
        }
        for (int j = 0; j < sz; j++) for (int i = 0; i < sx; i++)
        {
            int a = j * (sx + 1) + i, b = a + 1, c = a + sx + 1, e = c + 1;
            idx.AddRange(new[] { a, b, c, b, e, c });
        }
        int b0 = _pos.Count;
        for (int i = 0; i < pos.Count; i++) Push(xf * pos[i], Vector3.Up, uv[i], cols[i]);
        foreach (var i in idx) _idx.Add(b0 + i);
        if (height != null) RecomputeNormals(b0, _pos.Count - b0, _idx.Count - idx.Count);
    }

    /// Vertical quad in XY facing +Z (geometry.js quad), w by h; bottom = sits on y 0.
    public void Quad(float w, float h, Transform3D xf, Color color, bool bottom = false, float tileU = 1, float tileV = 1, bool twoSided = false)
    {
        float x = w / 2, y0 = bottom ? 0 : -h / 2, y1 = y0 + h;
        var pos = new List<Vector3> { new(-x, y0, 0), new(x, y0, 0), new(x, y1, 0), new(-x, y1, 0) };
        var nrm = new List<Vector3> { new(0, 0, 1), new(0, 0, 1), new(0, 0, 1), new(0, 0, 1) };
        var uv = new List<Vector2> { new(0, tileV), new(tileU, tileV), new(tileU, 0), new(0, 0) };
        var idx = new List<int> { 0, 2, 1, 0, 3, 2 };
        if (twoSided) idx.AddRange(new[] { 0, 1, 2, 0, 2, 3 });
        Add(pos, nrm, uv, idx, xf, color);
    }

    public void Sphere(float r, int ws, int hs, Transform3D xf, Color color, Vector3? scale = null)
    {
        var s = scale ?? Vector3.One;
        var pos = new List<Vector3>(); var nrm = new List<Vector3>(); var uv = new List<Vector2>(); var idx = new List<int>();
        for (int j = 0; j <= hs; j++)
        {
            float v = (float)j / hs, phi = v * Mathf.Pi;
            for (int i = 0; i <= ws; i++)
            {
                float u = (float)i / ws, th = u * Mathf.Tau;
                float nx = -Mathf.Cos(th) * Mathf.Sin(phi), ny = Mathf.Cos(phi), nz = Mathf.Sin(th) * Mathf.Sin(phi);
                pos.Add(new Vector3(nx * r * s.X, ny * r * s.Y, nz * r * s.Z));
                nrm.Add(new Vector3(nx / s.X, ny / s.Y, nz / s.Z).Normalized()); uv.Add(new(u, v));
            }
        }
        for (int j = 0; j < hs; j++) for (int i = 0; i < ws; i++)
        {
            int a = j * (ws + 1) + i, b = a + ws + 1;
            if (j != 0) idx.AddRange(new[] { a, a + 1, b });
            if (j != hs - 1) idx.AddRange(new[] { a + 1, b + 1, b });
        }
        Add(pos, nrm, uv, idx, xf, color);
    }

    public void Cylinder(float rTop, float rBot, float h, int seg, Transform3D xf, Color color, bool y0 = false, bool open = false)
    {
        var pos = new List<Vector3>(); var nrm = new List<Vector3>(); var uv = new List<Vector2>(); var idx = new List<int>();
        float yb = y0 ? 0 : -h / 2, slope = (rBot - rTop) / h, l = Mathf.Sqrt(1 + slope * slope);
        for (int j = 0; j <= 1; j++)
        {
            float v = j, y = yb + v * h, r = rBot + (rTop - rBot) * v;
            for (int i = 0; i <= seg; i++)
            {
                float u = (float)i / seg, a = u * Mathf.Tau, c = Mathf.Cos(a), s = Mathf.Sin(a);
                pos.Add(new Vector3(c * r, y, s * r)); nrm.Add(new Vector3(c / l, slope / l, s / l)); uv.Add(new(u, 1 - v));
            }
        }
        for (int i = 0; i < seg; i++) { int a = i, b = a + seg + 1; idx.AddRange(new[] { a, a + 1, b, a + 1, b + 1, b }); }
        if (!open)
        {
            void Cap(float y, float r, float up)
            {
                if (r <= 0) return;
                int c = pos.Count; pos.Add(new Vector3(0, y, 0)); nrm.Add(new Vector3(0, up, 0)); uv.Add(new(0.5f, 0.5f));
                for (int i = 0; i <= seg; i++) { float a = (float)i / seg * Mathf.Tau; pos.Add(new Vector3(Mathf.Cos(a) * r, y, Mathf.Sin(a) * r)); nrm.Add(new Vector3(0, up, 0)); uv.Add(new(0.5f + Mathf.Cos(a) * 0.5f, 0.5f + Mathf.Sin(a) * 0.5f)); }
                for (int i = 0; i < seg; i++) { if (up > 0) idx.AddRange(new[] { c, c + 1 + i, c + 2 + i }); else idx.AddRange(new[] { c, c + 2 + i, c + 1 + i }); }
            }
            Cap(yb + h, rTop, 1); Cap(yb, rBot, -1);
        }
        Add(pos, nrm, uv, idx, xf, color);
    }

    /// Torus in the XZ plane (axis y), major radius R, tube r.
    public void Torus(float R, float r, int segR, int segT, Transform3D xf, Color color)
    {
        var pos = new List<Vector3>(); var nrm = new List<Vector3>(); var uv = new List<Vector2>(); var idx = new List<int>();
        for (int i = 0; i <= segR; i++)
        {
            float a = (float)i / segR * Mathf.Tau, ca = Mathf.Cos(a), sa = Mathf.Sin(a);
            for (int j = 0; j <= segT; j++)
            {
                float b = (float)j / segT * Mathf.Tau, cb = Mathf.Cos(b), sb = Mathf.Sin(b);
                pos.Add(new Vector3((R + r * cb) * ca, r * sb, (R + r * cb) * sa));
                nrm.Add(new Vector3(cb * ca, sb, cb * sa)); uv.Add(new((float)i / segR, (float)j / segT));
            }
        }
        for (int i = 0; i < segR; i++) for (int j = 0; j < segT; j++)
        {
            int a = i * (segT + 1) + j, b = a + segT + 1;
            idx.AddRange(new[] { a, b, a + 1, a + 1, b, b + 1 });
        }
        Add(pos, nrm, uv, idx, xf, color);
    }

    /// A tube along a polyline (geometry.js tube): radius may vary with t in 0..1. Points are world space.
    public void Tube(IList<Vector3> path, Func<float, float> radius, int seg, Color color, Func<int, Color>? ringColor = null)
    {
        int n = path.Count; if (n < 2) return;
        int b0 = _pos.Count;
        Vector3? prevN = null;
        for (int k = 0; k < n; k++)
        {
            float t = (float)k / (n - 1);
            var tan = (k == 0 ? path[1] - path[0] : k == n - 1 ? path[n - 1] - path[n - 2] : path[k + 1] - path[k - 1]).Normalized();
            // parallel-transport frame (geometry.js tube): the first normal is horizontal, later ones follow the path
            Vector3 nx;
            if (prevN == null) nx = Mathf.Abs(tan.Y) < 0.9f ? new Vector3(-tan.Z, 0, tan.X) : Vector3.Right;
            else { nx = prevN.Value; nx -= tan * nx.Dot(tan); }
            nx = nx.LengthSquared() > 1e-10f ? nx.Normalized() : Vector3.Right; prevN = nx;
            var ny = tan.Cross(nx).Normalized();
            float r = radius(t); var col = ringColor?.Invoke(k) ?? color;
            for (int i = 0; i <= seg; i++)
            {
                float a = (float)i / seg * Mathf.Tau; var o = nx * Mathf.Cos(a) + ny * Mathf.Sin(a);
                Push(path[k] + o * r, o, new Vector2((float)i / seg, t), col);
            }
        }
        for (int k = 0; k < n - 1; k++) for (int i = 0; i < seg; i++)
        {
            int a = b0 + k * (seg + 1) + i, b = a + seg + 1;
            // (nx, ny, tan) is right-handed where Cylinder's (x, z, y) is left-handed, so the ring order is mirrored
            // here to keep Godot's clockwise front faces outward (before this the tubes were inside out: palm trunks
            // showed their far, sun-lit inside wall)
            _idx.AddRange(new[] { a, b, a + 1, a + 1, b, b + 1 });
        }
    }

    /// A flat strip of quads through `centre` points with `half` extents sideways: the palm fronds (folded cards).
    public void Strip(IList<Vector3> left, IList<Vector3> mid, IList<Vector3> right, Color color, bool twoSided = true)
    {
        int n = mid.Count, b0 = _pos.Count;
        for (int k = 0; k < n; k++)
        {
            float t = (float)k / (n - 1);
            var tan = (k == 0 ? mid[1] - mid[0] : k == n - 1 ? mid[n - 1] - mid[n - 2] : mid[k + 1] - mid[k - 1]).Normalized();
            var across = (right[k] - left[k]).Normalized();
            var nrm = across.Cross(tan).Normalized(); if (nrm.Y < 0) nrm = -nrm;
            Push(left[k], nrm, new Vector2(t, 1), color); Push(mid[k], nrm, new Vector2(t, 0.5f), color); Push(right[k], nrm, new Vector2(t, 0), color);
        }
        for (int k = 0; k < n - 1; k++)
        {
            int a = b0 + k * 3, b = a + 3;
            _idx.AddRange(new[] { a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1 });
            if (twoSided) _idx.AddRange(new[] { a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2 });
        }
    }

    private void RecomputeNormals(int v0, int vCount, int i0)
    {
        var acc = new Vector3[vCount];
        for (int i = i0; i < _idx.Count; i += 3)
        {
            int a = _idx[i], b = _idx[i + 1], c = _idx[i + 2];
            var n = (_pos[c] - _pos[a]).Cross(_pos[b] - _pos[a]); // (Godot front faces wind clockwise)
            acc[a - v0] += n; acc[b - v0] += n; acc[c - v0] += n;
        }
        for (int i = 0; i < vCount; i++) _nrm[v0 + i] = acc[i].LengthSquared() > 0 ? acc[i].Normalized() : Vector3.Up;
    }

    public ArrayMesh ToMesh(Material? mat = null, ArrayMesh? into = null)
    {
        var mesh = into ?? new ArrayMesh();
        if (_idx.Count == 0) return mesh;
        var arrays = new Godot.Collections.Array();
        arrays.Resize((int)Mesh.ArrayType.Max);
        arrays[(int)Mesh.ArrayType.Vertex] = _pos.ToArray();
        arrays[(int)Mesh.ArrayType.Normal] = _nrm.ToArray();
        arrays[(int)Mesh.ArrayType.TexUV] = _uv.ToArray();
        if (UseUv2) arrays[(int)Mesh.ArrayType.TexUV2] = _uv2.ToArray();
        arrays[(int)Mesh.ArrayType.Color] = _col.ToArray();
        arrays[(int)Mesh.ArrayType.Index] = _idx.ToArray();
        mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
        if (mat != null) mesh.SurfaceSetMaterial(mesh.GetSurfaceCount() - 1, mat);
        return mesh;
    }

    public static Transform3D At(float x, float y, float z, float yaw = 0, float scale = 1)
    {
        var b = new Basis(Vector3.Up, yaw).Scaled(new Vector3(scale, scale, scale));
        return new Transform3D(b, new Vector3(x, y, z));
    }
    public static Transform3D At(Vector3 p, float yaw = 0) => At(p.X, p.Y, p.Z, yaw);
}
