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

    public Animator Anim = null!;
    public AnimPlayer Player = new() { Id = 0, MoveStyle = "standard" };
    public AnimState State;
    public AnimGame? Game;
    public AnimExtra Extra = new();
    public Vector3? Ball;
    public double FixedDt = 1.0 / 60;
    public int Ticks;
    public bool Paused;
    /// called every fixed tick before the animator runs (the showroom's script lives here)
    public System.Action<AthleteDriver, double>? OnTick;

    Skeleton3D _skel = null!;
    Node3D _model = null!;
    int[] _bone = new int[Skeleton.N];
    Basis[] _restGlobalBasis = new Basis[Skeleton.N];
    double _acc;
    public double MaxBindError = -1;

    public override void _Ready()
    {
        var envGlb = OS.GetEnvironment("RIMRIFT_GLB");
        if (!string.IsNullOrEmpty(envGlb)) GlbPath = envGlb; // (the showroom can be pointed at another athlete without touching the scenes)
        var scene = ResourceLoader.Load<PackedScene>(GlbPath);
        _model = scene.Instantiate<Node3D>();
        AddChild(_model);
        _skel = FindSkeleton(_model) ?? throw new System.Exception("no Skeleton3D in " + GlbPath);
        TuneMaterials(_model);
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
                if (name.StartsWith("MH_Head") || name.StartsWith("MH_Body"))
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
    }

    static Skeleton3D? FindSkeleton(Node n)
    {
        if (n is Skeleton3D s) return s;
        foreach (var c in n.GetChildren()) { var r = FindSkeleton(c); if (r != null) return r; }
        return null;
    }

    public override void _Process(double delta)
    {
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
        double[]? ball = Ball.HasValue ? new double[] { Ball.Value.X, Ball.Value.Y, Ball.Value.Z } : null;
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
    }

    /// world position of one of our joints (for the ball, cameras)
    public Vector3 JointWorld(int bone)
    {
        var p = Anim.Rig.Pos[bone];
        return Transform * new Vector3((float)p[0], (float)p[1], (float)p[2]);
    }

    public Vector3 JointWorld(string name) => JointWorld(Skeleton.Index(name));
}
