"""Meshy.ai athlete through our pipeline (Blender 4.5 headless):
  blender -b --python tools/athlete/build_meshy.py -- --fbx <Character_output.fbx> --tex <dir with texture_0*.png> --out <game/assets/athlete/meshy/athlete_v1> [--build 77 215 80] [--tris 45000]

Imports the Meshy auto-rig (Mixamo-style Unity Humanoid names), decimates the fused body to ~45k triangles keeping
UVs (symmetric collapse), merges the weights onto our 21 bones (Spine01+Spine -> chest, no finger bones to fold),
retargets every vertex onto our bind for the build with the same per-bone stretch LBS as build_body.py (source joints
taken straight from the FBX bones, not estimated), rebuilds the armature at our bind, and exports athlete_meshy.glb
with one PBR material (albedo + ORM packed from the metallic/roughness maps).
"""
import bpy, sys, os, math, argparse, json
import numpy as np
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import skel
from skel import BONES, B, PARENT, to_blender

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--fbx', required=True); ap.add_argument('--tex', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--build', nargs=3, type=float, default=[77, 215, 80])
ap.add_argument('--tris', type=int, default=45000)
ap.add_argument('--work', default='/tmp/claude-0/character/meshy/work')
args = ap.parse_args(argv)
os.makedirs(args.out, exist_ok=True); os.makedirs(args.work, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.fbx(filepath=args.fbx)
bpy.context.view_layer.update()
src_arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = next(o for o in bpy.data.objects if o.type == 'MESH')
# bake the object transforms (the FBX armature is at 0.01 scale, the mesh rotated 90 deg): world coords, z-up
M = body.matrix_world.copy()
for v in body.data.vertices: v.co = M @ v.co
bones_world = {b.name: (src_arm.matrix_world @ b.head_local, src_arm.matrix_world @ b.tail_local) for b in src_arm.data.bones}
for m in list(body.modifiers): body.modifiers.remove(m)
body.parent = None; body.matrix_world = Matrix.Identity(4)
body.name = 'Body'
V0 = np.array([v.co[:] for v in body.data.vertices])
tri0 = sum(len(p.vertices) - 2 for p in body.data.polygons)
print(f'[meshy] imported: {len(V0)} verts, {tri0} tris, height {V0[:, 2].max() - V0[:, 2].min():.3f} m, {len(src_arm.data.bones)} bones')

# ---------------------------------------------------------------- merge the Humanoid weights onto our bones
MAP = {'Hips': 'hips', 'Spine02': 'spine', 'Spine01': 'chest', 'Spine': 'chest', 'neck': 'neck', 'Neck': 'neck', 'Head': 'head', 'head_end': 'head', 'headfront': 'head',
       'LeftShoulder': 'clavL', 'LeftArm': 'upperL', 'LeftForeArm': 'foreL', 'LeftHand': 'handL',
       'RightShoulder': 'clavR', 'RightArm': 'upperR', 'RightForeArm': 'foreR', 'RightHand': 'handR',
       'LeftUpLeg': 'thighL', 'LeftLeg': 'shinL', 'LeftFoot': 'footL', 'LeftToeBase': 'toeL',
       'RightUpLeg': 'thighR', 'RightLeg': 'shinR', 'RightFoot': 'footR', 'RightToeBase': 'toeR'}
for g in body.vertex_groups:
    n = g.name
    if n not in MAP:
        for k in MAP:
            if n.lower().startswith(k.lower()): MAP[n] = MAP[k]; break
unmapped = [g.name for g in body.vertex_groups if g.name not in MAP]
print('[meshy] unmapped groups (folded into hand/parent by name):', unmapped)
NV = len(V0)
W = np.zeros((NV, len(BONES)))
gi = {g.index: g.name for g in body.vertex_groups}
for vi, v in enumerate(body.data.vertices):
    for g in v.groups:
        n = gi[g.group]; ours = MAP.get(n)
        if ours is None:
            ours = 'handL' if 'Left' in n else 'handR' if 'Right' in n else 'hips'
        W[vi, B[ours]] += g.weight
ws = W.sum(1, keepdims=True); ws[ws == 0] = 1; W /= ws
# write the merged groups back
for g in list(body.vertex_groups): body.vertex_groups.remove(g)
for bi, n in enumerate(BONES):
    g = body.vertex_groups.new(name=n)
    for vi in range(NV):
        if W[vi, bi] > 1e-4: g.add([vi], float(W[vi, bi]), 'REPLACE')

# ---------------------------------------------------------------- decimate (symmetric collapse, UVs kept)
ratio = min(1.0, args.tris / max(1, tri0))
if ratio < 0.999:
    dm = body.modifiers.new('Decimate', 'DECIMATE'); dm.ratio = ratio; dm.use_symmetry = True; dm.symmetry_axis = 'X'; dm.use_collapse_triangulate = True
    bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); bpy.context.view_layer.objects.active = body
    with bpy.context.temp_override(active_object=body, selected_objects=[body], object=body):
        bpy.ops.object.modifier_apply(modifier='Decimate')
V = np.array([v.co[:] for v in body.data.vertices]); NV = len(V)
tri1 = sum(len(p.vertices) - 2 for p in body.data.polygons)
print(f'[meshy] decimated: {NV} verts, {tri1} tris (ratio {ratio:.3f})')
# re-read the (interpolated) weights after the decimate
W = np.zeros((NV, len(BONES)))
gi = {g.index: g.name for g in body.vertex_groups}
for vi, v in enumerate(body.data.vertices):
    for g in v.groups:
        n = gi[g.group]
        if n in B: W[vi, B[n]] = g.weight
ws = W.sum(1, keepdims=True); ws[ws == 0] = 1; W /= ws

# ---------------------------------------------------------------- source joints from the FBX bones (Blender z-up)
def head(n): return np.array(bones_world[n][0][:])
def tail(n): return np.array(bones_world[n][1][:])
src = {'hips': head('Hips'), 'spine': head('Spine02'), 'chest': head('Spine01'), 'neck': head('neck') if 'neck' in bones_world else head('Neck'), 'head': head('Head'),
       'headtip': head('head_end') if 'head_end' in bones_world else tail('Head')}
for side, S in (('L', 'Left'), ('R', 'Right')):
    src['clav' + side] = head(S + 'Shoulder'); src['upper' + side] = head(S + 'Arm'); src['fore' + side] = head(S + 'ForeArm'); src['hand' + side] = head(S + 'Hand')
    src['handtip' + side] = tail(S + 'Hand')
    src['thigh' + side] = head(S + 'UpLeg'); src['shin' + side] = head(S + 'Leg'); src['foot' + side] = head(S + 'Foot'); src['toe' + side] = head(S + 'ToeBase')
    src['toetip' + side] = tail(S + 'ToeBase')
Hs = V0[:, 2].max() - V0[:, 2].min()
# fix the mesh so the floor is z=0 and x centred (the bones follow)
zmin = V0[:, 2].min(); xmid = (V0[:, 0].min() + V0[:, 0].max()) / 2
shift = np.array([-xmid, 0, -zmin])
V = V + shift
for k in src: src[k] = src[k] + shift
ax = src['handL'] - src['upperL']
print(f'[meshy] A-pose arm angle {math.degrees(math.atan2(abs(ax[0]), abs(ax[2]))):.1f} deg from vertical (a Humanoid A-pose); source H {Hs:.3f} m')
# the leaf tails from the MESH, not the FBX leaf bones: Meshy's LeftHand/ToeBase tails are arbitrary (the hand tail sits
# 9 cm past the fingertips), and the hand segment maps onto our handLen, so a too-long source tail shrank the hands to
# 0.15 m (ours: 0.20) and the fingers never reached the ball the poses put on them. The tip = the farthest vertex of the
# leaf's own weight group from its joint, measured along the FBX bone's direction.
for side in 'LR':
    for leaf, tipk in (('hand', 'handtip'), ('toe', 'toetip')):
        j = src[leaf + side]; bone_dir = src[tipk + side] - j; bone_dir /= np.linalg.norm(bone_dir)
        m = W[:, B[leaf + side]] > 0.5
        if m.sum() < 10: print(f'[meshy] {leaf}{side}: too few weighted verts, FBX tail kept'); continue
        along = (V[m] - j) @ bone_dir
        old = np.linalg.norm(src[tipk + side] - j); new = float(along.max())
        src[tipk + side] = j + bone_dir * new
        print(f'[meshy] {leaf}{side} tip: FBX tail {old:.3f} m -> mesh tip {new:.3f} m from the joint')

# ---------------------------------------------------------------- our bind
d = skel.body_dims(*args.build)
off = skel.bind_offsets(d); pos = skel.bind_positions(off); tails = skel.leaf_tails(d, pos)
tgt = {n: np.array(to_blender(pos[B[n]])) for n in BONES}
tgt['headtip'] = np.array(to_blender(tails['head']))
for side in 'LR':
    tgt['handtip' + side] = np.array(to_blender(tails['hand' + side])); tgt['toetip' + side] = np.array(to_blender(tails['toe' + side]))
CHILD = {n: [BONES[i] for i in range(len(BONES)) if PARENT[i] >= 0 and BONES[PARENT[i]] == n] for n in BONES}


def tail_of(j, n):
    if n == 'head': return j['headtip']
    if n.startswith('hand'): return j['handtip' + n[-1]]
    if n.startswith('toe'): return j['toetip' + n[-1]]
    if n == 'chest': return j['neck']
    if n == 'hips': return j['spine']
    return j[CHILD[n][0]]


def frame(h, t):
    y = t - h; L = np.linalg.norm(y); y = y / L
    hint = np.array([0, 1.0, 0]) if abs(y[1]) < 0.9 else np.array([0, 0, 1.0])
    x = np.cross(y, hint); x /= np.linalg.norm(x); z = np.cross(x, y)
    Mx = np.eye(4); Mx[:3, 0] = x; Mx[:3, 1] = y; Mx[:3, 2] = z; Mx[:3, 3] = h
    return Mx, L


k_cross = (d['H'] / Hs)  # (the Meshy body already carries the sheet's build; only the height ratio across)
A = {}
for n in BONES:
    Ms, Ls = frame(src[n], tail_of(src, n)); Mt, Lt = frame(tgt[n], tail_of(tgt, n))
    A[n] = Mt @ np.diag([k_cross, Lt / Ls, k_cross, 1]) @ np.linalg.inv(Ms)
Vh = np.c_[V, np.ones(NV)]
V2 = np.zeros_like(V)
for n in BONES: V2 += W[:, [B[n]]] * (Vh @ A[n].T)[:, :3]
for i, v in enumerate(body.data.vertices): v.co = V2[i]
body.data.update()
print(f'[meshy] retargeted: height {V2[:, 2].max() - V2[:, 2].min():.4f} (target {d["H"]:.4f}), feet z {V2[:, 2].min():.4f}, hand tip x {V2[:, 0].max():.3f} (target {tgt["handtipL"][0]:.3f})')

# ---------------------------------------------------------------- our armature at the bind
bpy.data.objects.remove(src_arm, do_unlink=True)
arm_data = bpy.data.armatures.new('Armature'); rig = bpy.data.objects.new('Armature', arm_data); scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = {}
for n in BONES:
    b = arm_data.edit_bones.new(n); b.head = Vector(tgt[n]); b.tail = Vector(tail_of(tgt, n))
    if (b.tail - b.head).length < 0.01: b.tail = b.head + Vector((0, 0, 0.02))
    b.roll = 0.0; eb[n] = b
for i, n in enumerate(BONES):
    if PARENT[i] >= 0: eb[n].parent = eb[BONES[PARENT[i]]]; eb[n].use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
body.parent = rig
mod = body.modifiers.new('Armature', 'ARMATURE'); mod.object = rig
for p in body.data.polygons: p.use_smooth = True

# ---------------------------------------------------------------- material: albedo + ORM (R=1, G=roughness, B=metallic)
import subprocess, glob
alb = [f for f in glob.glob(os.path.join(args.tex, '*texture_0.png'))][0]
met = glob.glob(os.path.join(args.tex, '*texture_0_metallic.png'))[0]; rgh = glob.glob(os.path.join(args.tex, '*texture_0_roughness.png'))[0]
orm = os.path.join(args.work, 'meshy_orm.png')
subprocess.run(['python3', '-c', f"""
from PIL import Image
import numpy as np
r = np.asarray(Image.open({rgh!r}).convert('L'), dtype=np.uint8); m = np.asarray(Image.open({met!r}).convert('L').resize(r.shape[::-1]), dtype=np.uint8)
o = np.dstack([np.full_like(r, 255), r, m]); Image.fromarray(o).save({orm!r}); print('[meshy] ORM', o.shape)
"""], check=True)
mat = bpy.data.materials.new('MeshyAthlete'); mat.use_nodes = True; nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
ta = nt.nodes.new('ShaderNodeTexImage'); ta.image = bpy.data.images.load(alb); nt.links.new(ta.outputs['Color'], bsdf.inputs['Base Color'])
to = nt.nodes.new('ShaderNodeTexImage'); to.image = bpy.data.images.load(orm); to.image.colorspace_settings.name = 'Non-Color'
sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(to.outputs['Color'], sep.inputs['Color'])
nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness']); nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
body.data.materials.clear(); body.data.materials.append(mat)
print(f'[meshy] albedo {ta.image.size[:]}, orm {to.image.size[:]}')

# ---------------------------------------------------------------- save + export
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(args.work, 'athlete_meshy.blend'))
json.dump({'build': args.build, 'tris_in': tri0, 'tris_out': tri1, 'src': {k: v.tolist() for k, v in src.items()}}, open(os.path.join(args.work, 'meshy_fit.json'), 'w'), indent=1)
glb = os.path.join(args.out, 'athlete_meshy.glb')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_skins=True, export_yup=True, export_apply=True, export_animations=False, export_image_format='AUTO')
print('[export]', glb, round(os.path.getsize(glb) / 1e6, 2), 'MB')
