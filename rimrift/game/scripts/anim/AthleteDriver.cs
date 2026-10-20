// Drives a glTF athlete (game/assets/athlete/athlete.glb, rigged to our 21-bone skeleton) with the ported procedural
// animator (Rimrift.Anim) at a fixed 60 Hz, writing the rig's joint transforms into the Skeleton3D every tick.
//
// Bone maths: our rig's joint rotations are world-aligned (identity bind orientation): a joint's skin matrix is
// [R_i | p_i] * T(-bind_i). Godot skins with G_i * InverseBind_i where G_i is the bone's global pose and the
// inverse bind is the inverse of the imported rest G_rest_i = [R_rest_i | bind_i], so the global pose we need is
// G_i = [R_i * R_rest_i | p_i], and the bone-local pose is G_parent^-1 * G_i. (Verified at startup: the rest joint
// positions of the imported skeleton must equal our bind positions.)
using Godot;
using System.Collections.Generic;
using Rimrift.Anim;

namespace Rimrift.Anim.Godot;

public partial class AthleteDriver : Node3D
{
    [Export] public string GlbPath = "res://assets/athlete/athlete.glb";
    [Export] public double HeightIn = 77, WeightLb = 215, WingspanIn = 80;
    [Export] public bool Verbose = true;

    // ---- groom distance LOD (David's tunables): distance from the active camera to the head joint, in metres.
    // 0 = full (hair + beard + brows cards), 1 = hair only (beard/brows hidden), 2 = helmet cap instead of the hair cards.
    [Export] public float GroomLodMid = 8f;    // > this: hide beard + brows
    [Export] public float GroomLodFar = 18f;   // > this: hair cards -> helmet cap
    [Export] public float GroomLodHysteresis = 1.0f; // metres: a state only changes once the distance passes the threshold by this much
    /// -1 = automatic (distance), 0/1/2 force a state (key L in the Demo, or RIMRIFT_GROOM_LOD)
    public int GroomLodOverride = -1;
    public int GroomLod { get; private set; } = 0;
    public float CameraDistance { get; private set; }
    public string BodyName { get; private set; } = "";

    /// the selectable bodies: name -> glb (RIMRIFT_BODY=meshy|mh|cc0, or the Demo's B key). The showroom scenes set
    /// their own GlbPath (the MH showroom uses the LOD0-card glb); RIMRIFT_GLB overrides everything.
    public static readonly (string name, string glb)[] Bodies = {
        ("meshy", "res://assets/athlete/meshy/athlete_v1/athlete_meshy.glb"),   // David's pick (Oct 19): the hero body
        ("mh", "res://assets/athlete/metahuman/athlete_mh.glb"),
        ("cc0", "res://assets/athlete/athlete.glb"),
    };
    public static string BodyGlb(string name) { foreach (var b in Bodies) if (b.name == name) return b.glb; return Bodies[0].glb; }
    readonly List<MeshInstance3D> _hair = new(), _beard = new(), _brows = new(), _helmet = new();

    public Animator Anim = null!;
    public AnimPlayer Player = new() { Id = 0, MoveStyle = "standard" };
    public AnimState State;
    public AnimGame? Game;
    public AnimExtra Extra = new();
    /// the ball in the athlete's own frame (facing +Z, origin at his feet on the floor, excluding the jump): the same frame
    /// Transform * Ball draws it in. Step() converts it to world for the animator.
    public Vector3? Ball;
    public double FixedDt = 1.0 / 60;
    public int Ticks;
    public bool Paused;
    /// called every fixed tick before the animator runs (the showroom's script lives here)
    public System.Action<AthleteDriver, double>? OnTick;

    Skeleton3D _skel = null!;
    Node3D _model = null!;
    /// RIMRIFT_DEBUG_BONES=1: draw the animator's joints (rig.Pos) as unlit lines through the mesh (the retarget check:
    /// if the lines look right and the mesh does not, it is the skin; if the lines look wrong it is the pose)
    public bool DebugBones;
    ImmediateMesh? _dbgMesh;
    int[] _bone = new int[Skeleton.N];
    Basis[] _restGlobalBasis = new Basis[Skeleton.N];
    double _acc;
    public double MaxBindError = -1;

    public override void _Ready()
    {
        var envGlb = OS.GetEnvironment("RIMRIFT_GLB");
        if (!string.IsNullOrEmpty(envGlb)) GlbPath = envGlb; // (the showroom can be pointed at another athlete without touching the scenes)
        foreach (var b in Bodies) if (GlbPath == b.glb || GlbPath == b.glb.Replace("athlete_mh.glb", "athlete_mh_lod0.glb")) BodyName = b.name;
        var envLod = OS.GetEnvironment("RIMRIFT_GROOM_LOD");
        if (!string.IsNullOrEmpty(envLod) && envLod != "auto") GroomLodOverride = int.Parse(envLod);
        var scene = ResourceLoader.Load<PackedScene>(GlbPath);
        _model = scene.Instantiate<Node3D>();
        AddChild(_model);
        _skel = FindSkeleton(_model) ?? throw new System.Exception("no Skeleton3D in " + GlbPath);
        TuneMaterials(_model);
        CollectGroom(_model);
        ApplyGroomLod(0);
        var build = new Build(HeightIn, WeightLb, WingspanIn);
        Anim = new Animator(build);
        Player.Phys = new AnimPhys { Reach = Anim.Model.D.ReachStanding, H = Anim.H, Radius = 0.3 };
        // bone map + rest global rotations
        var restGlobal = new Transform3D[_skel.GetBoneCount()];
        for (int b = 0; b < _skel.GetBoneCount(); b++)
        {
            int p = _skel.GetBoneParent(b);
            restGlobal[b] = p < 0 ? _skel.GetBoneRest(b) : restGlobal[p] * _skel.GetBoneRest(b);
        }
        MaxBindError = 0;
        for (int i = 0; i < Skeleton.N; i++)
        {
            _bone[i] = _skel.FindBone(Skeleton.BONES[i]);
            if (_bone[i] < 0) throw new System.Exception("bone missing in glb: " + Skeleton.BONES[i]);
            _restGlobalBasis[i] = restGlobal[_bone[i]].Basis.Orthonormalized();
            var bind = Anim.Model.Bind[i];
            var o = restGlobal[_bone[i]].Origin;
            double err = new Vector3((float)bind[0], (float)bind[1], (float)bind[2]).DistanceTo(o);
            if (err > MaxBindError) MaxBindError = err;
        }
        if (Verbose) GD.Print($"athlete: skeleton {_skel.GetBoneCount()} bones, H={Anim.H:F4} m, rest-vs-bind max error {MaxBindError * 1000:F2} mm");
        if (OS.GetEnvironment("RIMRIFT_DEBUG_BONES") == "1") DebugBones = true;
        if (DebugBones)
        {
            _dbgMesh = new ImmediateMesh();
            var mat = new StandardMaterial3D { ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded, NoDepthTest = true, VertexColorUseAsAlbedo = true, RenderPriority = 10 };
            AddChild(new MeshInstance3D { Mesh = _dbgMesh, MaterialOverride = mat, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        }
        // start in the neutral stance
        State = new AnimState { X = 0, Y = 0, Z = 0, Facing = 0 };
        Step();
    }

    /// glTF carries no subsurface scattering: the MetaHuman skin materials (MH_Head, MH_Body) get Godot's skin-mode SSS
    /// and the glTF-default specular (0.5); the groom cards stay matte. (The imported materials are StandardMaterial3D.)
    static void TuneMaterials(Node n)
    {
        if (n is MeshInstance3D mi && mi.Mesh != null)
        {
            for (int i = 0; i < mi.Mesh.GetSurfaceCount(); i++)
            {
                if (mi.GetActiveMaterial(i) is not StandardMaterial3D m) continue;
                var name = m.ResourceName ?? "";
                if (name.StartsWith("MeshyAthlete")) TuneMeshy(m);
                else if (name.StartsWith("MH_Head") || name.StartsWith("MH_Body"))
                {
                    m.SubsurfScatterEnabled = true; m.SubsurfScatterSkinMode = true; m.SubsurfScatterStrength = 0.25f;
                    m.MetallicSpecular = 0.5f; m.Metallic = 0f;
                }
                else if (name.StartsWith("Groom") || name.Contains("Cards") || name == "HairBase")
                {
                    m.MetallicSpecular = 0.1f;  // (roughness comes from the glb: 0.75 for the Epic card grooms)
                    // the beard/brow strands are 1-2 atlas texels wide: at court distance the mip chain averages their
                    // coverage under the glb's cutoff, so the scissor is relaxed here (the hair's strands are wider)
                    if (name.StartsWith("Groom"))
                    {
                        m.AlphaScissorThreshold = 0.35f;  // (the groom atlases are imported without mipmaps: see their .import files)
                        if (OS.GetEnvironment("RIMRIFT_GROOM_HASH") == "1") m.Transparency = BaseMaterial3D.TransparencyEnum.AlphaHash;
                    }
                }
            }
        }
        foreach (var c in n.GetChildren()) TuneMaterials(c);
        if (OS.GetEnvironment("RIMRIFT_ATHLETE_MASK") == "1" && n is MeshInstance3D mm)
        {   // look-dev: every athlete as a flat magenta cut-out (shadows kept), for exact athlete-pixel masks in the captures
            mm.MaterialOverride = new StandardMaterial3D { ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded, AlbedoColor = new Color(1, 0, 1), DisableFog = true };
        }
    }

    /// Look pass 3 (World agent): the Meshy albedo carries baked studio shading and AO that fight Harbor Point's sun.
    /// tools/athlete/delight_meshy.py writes a de-lit albedo (<albedo>_lit.jpg) and an ORM with per-class roughness
    /// (<orm>_lit.png) next to the glb; they are swapped in here when present, the glb stays untouched. The material
    /// itself gets the glTF-default specular, a subtle sky-coloured rim from the sky side (the concept art's
    /// backlit edge) and a touch of skin-mode subsurface so the sun warms the shadow side of the skin.
    static void TuneMeshy(StandardMaterial3D m)
    {
        if (m.AlbedoTexture?.ResourcePath is string alb && alb.EndsWith(".png"))
        {
            var lit = alb[..^4] + "_lit.jpg";
            if (ResourceLoader.Exists(lit)) m.AlbedoTexture = GD.Load<Texture2D>(lit);
        }
        var ormSrc = m.RoughnessTexture ?? m.MetallicTexture ?? m.AOTexture;
        if (ormSrc?.ResourcePath is string orm && orm.EndsWith(".png"))
        {
            var lit = orm[..^4] + "_lit.png";
            if (ResourceLoader.Exists(lit))
            {
                var t = GD.Load<Texture2D>(lit);
                m.RoughnessTexture = t; m.RoughnessTextureChannel = BaseMaterial3D.TextureChannel.Green;
                m.MetallicTexture = t; m.MetallicTextureChannel = BaseMaterial3D.TextureChannel.Blue;
                m.AOEnabled = false; // the lit ORM's AO is 1: SSAO/SSIL do the contact darkening in the scene
            }
        }
        m.Roughness = 1.0f; m.Metallic = 1.0f; // multipliers: the textures carry the values
        m.MetallicSpecular = 0.5f;
        m.RimEnabled = true; m.Rim = 0.18f; m.RimTint = 0.6f;
        m.SubsurfScatterEnabled = true; m.SubsurfScatterSkinMode = true; m.SubsurfScatterStrength = 0.12f;
        m.TextureFilter = BaseMaterial3D.TextureFilterEnum.LinearWithMipmapsAnisotropic;
    }

    void CollectGroom(Node n)
    {
        if (n is MeshInstance3D mi)
        {
            var nm = mi.Name.ToString();
            if (nm.StartsWith("HairCards")) _hair.Add(mi);
            else if (nm.StartsWith("BeardCards")) _beard.Add(mi);
            else if (nm.StartsWith("BrowsCards")) _brows.Add(mi);
            else if (nm.StartsWith("HairHelmet")) _helmet.Add(mi);
        }
        foreach (var c in n.GetChildren()) CollectGroom(c);
    }

    void ApplyGroomLod(int lod)
    {
        GroomLod = lod;
        foreach (var m in _hair) m.Visible = lod < 2;
        foreach (var m in _helmet) m.Visible = lod >= 2 || _hair.Count == 0;
        foreach (var m in _beard) m.Visible = lod < 1;
        foreach (var m in _brows) m.Visible = lod < 1;
    }

    /// the distance LOD with hysteresis: a state is left only once the distance passes its threshold by GroomLodHysteresis
    void UpdateGroomLod()
    {
        var cam = GetViewport()?.GetCamera3D();
        if (cam == null) return;
        CameraDistance = cam.GlobalPosition.DistanceTo(JointWorld("head"));
        if (_hair.Count + _beard.Count + _brows.Count + _helmet.Count == 0) return;
        int want = GroomLod;
        if (GroomLodOverride >= 0) want = GroomLodOverride;
        else
        {
            float h = GroomLodHysteresis, d = CameraDistance;
            if (GroomLod == 0 && d > GroomLodMid + h) want = 1;
            else if (GroomLod == 1 && d < GroomLodMid - h) want = 0;
            else if (GroomLod == 1 && d > GroomLodFar + h) want = 2;
            else if (GroomLod == 2 && d < GroomLodFar - h) want = 1;
            if (GroomLod == 0 && d > GroomLodFar + h) want = 2;
            if (GroomLod == 2 && d < GroomLodMid - h) want = 0;
        }
        if (want != GroomLod) ApplyGroomLod(want);
    }

    static Skeleton3D? FindSkeleton(Node n)
    {
        if (n is Skeleton3D s) return s;
        foreach (var c in n.GetChildren()) { var r = FindSkeleton(c); if (r != null) return r; }
        return null;
    }

    public override void _Process(double delta)
    {
        UpdateGroomLod();
        if (Paused) return;
        _acc += delta;
        int n = 0;
        while (_acc >= FixedDt && n < 8) { _acc -= FixedDt; Step(); n++; }
        if (_acc > FixedDt) _acc = 0;
    }

    /// one 60 Hz tick: the script, the animator, the skeleton
    public void Step()
    {
        OnTick?.Invoke(this, Ticks * FixedDt);
        // Ball is in the athlete's frame (yawed by Facing, origin at his feet, without the jump: what the Demo and the
        // showroom script and draw with Transform * Ball); the animator wants the WORLD ball (Animator.ToLocal subtracts
        // state x/y/z and un-yaws it). Passing the local ball straight through made every athlete not at the origin
        // reach for a phantom ball metres behind him and, in the air, below his hands (the "unnatural shooting arms").
        double[]? ball = null;
        if (Ball.HasValue)
        {
            double c = System.Math.Cos(State.Facing), s = System.Math.Sin(State.Facing);
            var b = Ball.Value;
            ball = new double[] { c * b.X + s * b.Z + State.X, b.Y + State.Y, -s * b.X + c * b.Z + State.Z };
        }
        Anim.Update(FixedDt, State, Player, Game, ball, Extra);
        ApplyPose();
        Ticks++;
    }

    public void ApplyPose()
    {
        var rig = Anim.Rig;
        // the character's placement: yaw + translation (view.js m4fromYaw)
        Transform = new Transform3D(Basis.FromEuler(new Vector3(0, (float)Anim.placeYaw, 0)), new Vector3((float)Anim.placeX, (float)Anim.placeY, (float)Anim.placeZ));
        var global = new Transform3D[Skeleton.N];
        for (int i = 0; i < Skeleton.N; i++)
        {
            var q = rig.Rot[i]; var p = rig.Pos[i];
            var R = new Basis(new Quaternion(q[0], q[1], q[2], q[3]).Normalized());
            global[i] = new Transform3D(R * _restGlobalBasis[i], new Vector3((float)p[0], (float)p[1], (float)p[2]));
            int parent = Skeleton.PARENT[i];
            var local = parent < 0 ? global[i] : global[parent].AffineInverse() * global[i];
            int b = _bone[i];
            _skel.SetBonePosePosition(b, local.Origin);
            _skel.SetBonePoseRotation(b, local.Basis.GetRotationQuaternion());
            _skel.SetBonePoseScale(b, Vector3.One);
        }
        if (_dbgMesh != null) DrawDebugBones(global);
    }

    /// bone lines (local to this node, which carries the placement): arms yellow, legs cyan, spine white, plus a short
    /// tick at each joint and the hand bones extended by the rig's hand length (the fingertip the pose assumes)
    void DrawDebugBones(Transform3D[] global)
    {
        var m = _dbgMesh!;
        m.ClearSurfaces();
        m.SurfaceBegin(Mesh.PrimitiveType.Lines);
        var handLen = (float)Anim.Model.D.HandLen;
        for (int i = 1; i < Skeleton.N; i++)
        {
            int p = Skeleton.PARENT[i];
            var name = Skeleton.BONES[i];
            var c = name.StartsWith("upper") || name.StartsWith("fore") || name.StartsWith("hand") || name.StartsWith("clav") ? new Color(1, 0.9f, 0.1f)
                  : name.StartsWith("thigh") || name.StartsWith("shin") || name.StartsWith("foot") || name.StartsWith("toe") ? new Color(0.2f, 0.9f, 1) : new Color(1, 1, 1);
            m.SurfaceSetColor(c); m.SurfaceAddVertex(global[p].Origin);
            m.SurfaceSetColor(c); m.SurfaceAddVertex(global[i].Origin);
            if (name.StartsWith("hand"))
            {   // the hand bone's own -Y (its bind points down the arm; the rig rotates it) scaled by the hand length
                var dir = new Basis(new Quaternion(Anim.Rig.Rot[i][0], Anim.Rig.Rot[i][1], Anim.Rig.Rot[i][2], Anim.Rig.Rot[i][3]).Normalized());
                var bindDir = new Vector3((float)(Anim.Model.Bind[i][0] - Anim.Model.Bind[p][0]), (float)(Anim.Model.Bind[i][1] - Anim.Model.Bind[p][1]), (float)(Anim.Model.Bind[i][2] - Anim.Model.Bind[p][2])).Normalized();
                var tip = global[i].Origin + dir * bindDir * handLen;
                m.SurfaceSetColor(new Color(1, 0.3f, 0.3f)); m.SurfaceAddVertex(global[i].Origin);
                m.SurfaceSetColor(new Color(1, 0.3f, 0.3f)); m.SurfaceAddVertex(tip);
            }
        }
        m.SurfaceEnd();
    }

    /// world position of one of our joints (for the ball, cameras)
    public Vector3 JointWorld(int bone)
    {
        var p = Anim.Rig.Pos[bone];
        return Transform * new Vector3((float)p[0], (float)p[1], (float)p[2]);
    }

    public Vector3 JointWorld(string name) => JointWorld(Skeleton.Index(name));

    /// where the pose puts the fingertips: the wrist + the hand bone's rotated bind direction * handLen (world)
    public Vector3 FingertipWorld(string side)
    {
        int i = Skeleton.Index("hand" + side), p = Skeleton.PARENT[i];
        var q = Anim.Rig.Rot[i];
        var dir = new Basis(new Quaternion(q[0], q[1], q[2], q[3]).Normalized());
        var bindDir = new Vector3((float)(Anim.Model.Bind[i][0] - Anim.Model.Bind[p][0]), (float)(Anim.Model.Bind[i][1] - Anim.Model.Bind[p][1]), (float)(Anim.Model.Bind[i][2] - Anim.Model.Bind[p][2])).Normalized();
        var tipLocal = new Vector3((float)Anim.Rig.Pos[i][0], (float)Anim.Rig.Pos[i][1], (float)Anim.Rig.Pos[i][2]) + dir * bindDir * (float)Anim.Model.D.HandLen;
        return Transform * tipLocal;
    }

    /// the inner elbow angle in degrees (180 = straight)
    public double ElbowAngleDeg(string side)
    {
        var s = JointWorld("upper" + side); var e = JointWorld("fore" + side); var w = JointWorld("hand" + side);
        return Mathf.RadToDeg((s - e).AngleTo(w - e));
    }

    /// one line of shot-diagnosis numbers (the capture logs): elbow angles, wrist and fingertip heights, hand-to-ball
    public string PoseMetrics()
    {
        var ballW = Ball.HasValue ? Transform * Ball.Value : (Vector3?)null;
        string Side(string sd)
        {
            var w = JointWorld("hand" + sd); var f = FingertipWorld(sd);
            string hb = ballW.HasValue ? $" wrist-ball {w.DistanceTo(ballW.Value):F3} tip-ball {f.DistanceTo(ballW.Value):F3}" : "";
            return $"{sd}: elbow {ElbowAngleDeg(sd):F0}deg wristY {w.Y:F3} tipY {f.Y:F3}{hb}";
        }
        return $"headY {JointWorld("head").Y:F3}" + (ballW.HasValue ? $" ballY {ballW.Value.Y:F3}" : "") + " | " + Side("R") + " | " + Side("L");
    }
}
