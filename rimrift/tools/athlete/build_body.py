"""Stage 1 of the RIMRIFT athlete pipeline (Blender 4.5 headless):
  blender -b --python tools/athlete/build_body.py -- --bundle <human_base_meshes_bundle.blend> --out <dir> [--build 77 215 80]

Takes the CC0 "realistic male" body from the Blender Foundation Human Base Meshes bundle, estimates its joints, rigs it
to a source copy of our 21-bone skeleton (automatic weights), then retargets every vertex (linear blend skinning with
a per-bone stretch) onto our skeleton's bind for the build (skeleton.js bodyDims: height / weight / wingspan), builds
the final armature at the exact bind positions (bone names hips..toeR, 40 degree A-pose, facing -Y in Blender = +Z in
glTF/Godot, left +X, feet on the floor) and saves <out>/body_rigged.blend for the garment/texture stages.
"""
import bpy, sys, os, math, argparse
import numpy as np
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import skel
from skel import BONES, B, PARENT, to_blender

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--bundle', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--build', nargs=3, type=float, default=[77, 215, 80])
args = ap.parse_args(argv)
os.makedirs(args.out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'

# ---------------------------------------------------------------- 1. the base body (CC0, Blender Foundation)
NAMES = ['GEO-body_male_realistic', 'GEO-body_male_realistic.eye.L', 'GEO-body_male_realistic.eye.R']
with bpy.data.libraries.load(args.bundle, link=False) as (src, dst):
    dst.objects = [n for n in src.objects if n in NAMES]
for o in dst.objects:
    scene.collection.objects.link(o)
bpy.context.view_layer.update()
body = bpy.data.objects['GEO-body_male_realistic']
eyes = [bpy.data.objects['GEO-body_male_realistic.eye.L'], bpy.data.objects['GEO-body_male_realistic.eye.R']]
for m in list(body.modifiers):
    body.modifiers.remove(m)  # (the multires: base level only, ~10.6k quads)
# bake the eyes into body-local space, then unparent everything and put the body at the origin
inv = body.matrix_world.inverted()
for e in eyes:
    M = inv @ e.matrix_world
    for v in e.data.vertices:
        v.co = M @ v.co
    e.parent = None
    e.matrix_world = Matrix.Identity(4)
body.parent = None
body.matrix_world = Matrix.Identity(4)
body.name = 'Body'
eyes[0].name = 'EyeL'; eyes[1].name = 'EyeR'

V = np.array([v.co[:] for v in body.data.vertices])
xmid = (V[:, 0].min() + V[:, 0].max()) / 2
zmin = V[:, 2].min()
V[:, 0] -= xmid; V[:, 2] -= zmin
for i, v in enumerate(body.data.vertices):
    v.co = V[i]
for e in eyes:
    for v in e.data.vertices:
        v.co = (v.co.x - xmid, v.co.y, v.co.z - zmin)
Hs = V[:, 2].max()
print(f'[body] source height {Hs:.4f} m, {len(V)} verts, {len(body.data.polygons)} polys')


def slice_at(z, half=0.012, xmax=None):
    m = np.abs(V[:, 2] - z) < half
    if xmax is not None:
        m &= np.abs(V[:, 0]) < xmax
    return V[m]


def centre_y(zf, xmax=0.16):
    s = slice_at(zf * Hs, xmax=xmax)
    return float(s[:, 1].mean()) if len(s) else 0.0


# ---------------------------------------------------------------- 2. the source joints (Blender z-up, -Y forward)
# torso chain by our skeleton's own height fractions (the base body is a standard adult male), each on the body's
# centre line at that height; arms from the fitted arm axis; legs from the leg columns
d = skel.body_dims(*args.build)
fr = dict(hips=0.535, spine=0.61, chest=0.71, neck=0.825, head=0.875)
src = {}
for n, f in fr.items():
    src[n] = np.array([0.0, centre_y(f, 0.12 if n in ('neck', 'head') else 0.16), f * Hs])
src['head'][1] = centre_y(0.9, 0.12)
# shoulders: the arm root. the arm = vertices outside the torso column above the hips
arm = V[(V[:, 0] > 0.2) & (V[:, 2] > 0.5 * Hs)]
shoulder_x = 0.096 * Hs
upper = arm[np.abs(arm[:, 2] - 0.7 * Hs) < 0.03]
sh = np.array([shoulder_x, float(upper[:, 1].mean()), 0.812 * Hs])
tip = arm[np.argmin(arm[:, 2])]  # the fingertip: the arms hang, so the lowest arm vertex
ax = tip - sh; arm_len = float(np.linalg.norm(ax)); ax = ax / arm_len
print(f'[body] arm axis {ax}, {math.degrees(math.acos(-ax[2])):.1f} deg from vertical, shoulder {sh}, arm length {arm_len:.3f} m')
split = np.cumsum([0.172, 0.148, 0.104]) / 0.424
for side, sg in (('L', 1), ('R', -1)):
    axs = ax * np.array([sg, 1, 1])
    shs = sh * np.array([sg, 1, 1])
    src['clav' + side] = src['chest'] + np.array([sg * 0.022 * Hs, 0, 0.097 * Hs])
    src['clav' + side][1] = shs[1]
    src['upper' + side] = shs
    src['fore' + side] = shs + axs * arm_len * split[0]
    src['hand' + side] = shs + axs * arm_len * split[1]
    src['handtip' + side] = shs + axs * arm_len
# legs
ank = slice_at(0.04 * Hs)
ankL = ank[ank[:, 0] > 0]
leg_x = float(ankL[:, 0].mean()); leg_y = float(ankL[:, 1].mean())
toes = V[(V[:, 2] < 0.03 * Hs) & (V[:, 0] > 0)]
toe_y = float(toes[:, 1].min())
for side, sg in (('L', 1), ('R', -1)):
    hip = np.array([sg * 0.05 * Hs, centre_y(0.505), 0.505 * Hs])
    ankle = np.array([sg * leg_x, leg_y, 0.04 * Hs])
    src['thigh' + side] = hip
    src['shin' + side] = hip + (ankle - hip) * (0.235 / 0.465)
    src['foot' + side] = ankle
    src['toe' + side] = np.array([sg * leg_x, leg_y - (d['toeFwd'] / d['H']) * Hs, 0.012 * Hs])
    src['toetip' + side] = np.array([sg * leg_x, toe_y, 0.012 * Hs])
src['headtip'] = np.array([0, src['head'][1], Hs])

# ---------------------------------------------------------------- 3. the target bind (our skeleton, Blender coords)
off = skel.bind_offsets(d); pos = skel.bind_positions(off); tails = skel.leaf_tails(d, pos)
tgt = {n: np.array(to_blender(pos[B[n]])) for n in BONES}
tgt['headtip'] = np.array(to_blender(tails['head']))
for side in 'LR':
    tgt['handtip' + side] = np.array(to_blender(tails['hand' + side]))
    tgt['toetip' + side] = np.array(to_blender(tails['toe' + side]))
print(f'[body] target height {d["H"]:.4f} m (build {args.build}), shoulder x {d["shoulderX"]:.3f}, arm {d["upperLen"] + d["foreLen"] + d["handLen"]:.3f}')

CHILD = {n: [BONES[i] for i in range(len(BONES)) if PARENT[i] >= 0 and BONES[PARENT[i]] == n] for n in BONES}


def tail_of(j, n):
    ch = CHILD[n]
    if n == 'head': return j['headtip']
    if n.startswith('hand'): return j['handtip' + n[-1]]
    if n.startswith('toe'): return j['toetip' + n[-1]]
    if n == 'chest': return j['neck']
    if n == 'hips': return j['spine']
    return j[ch[0]]


def build_armature(name, j):
    arm_data = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm_data)
    scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for n in BONES:
        b = arm_data.edit_bones.new(n)
        b.head = Vector(j[n]); b.tail = Vector(tail_of(j, n))
        if (b.tail - b.head).length < 0.01: b.tail = b.head + Vector((0, 0, 0.02))
        b.roll = 0.0
        eb[n] = b
    for i, n in enumerate(BONES):
        if PARENT[i] >= 0:
            eb[n].parent = eb[BONES[PARENT[i]]]
            eb[n].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def frame(head, tail):
    y = tail - head; L = np.linalg.norm(y); y = y / L
    hint = np.array([0, 1.0, 0]) if abs(y[1]) < 0.9 else np.array([0, 0, 1.0])
    x = np.cross(y, hint); x /= np.linalg.norm(x)
    z = np.cross(x, y)
    M = np.eye(4); M[:3, 0] = x; M[:3, 1] = y; M[:3, 2] = z; M[:3, 3] = head
    return M, L


# ---------------------------------------------------------------- 4. source rig + automatic weights
src_arm = build_armature('SrcArmature', src)
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); src_arm.select_set(True)
bpy.context.view_layer.objects.active = src_arm
with bpy.context.temp_override(active_object=src_arm, selected_objects=[body, src_arm], selected_editable_objects=[body, src_arm]):
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
print('[body] automatic weights: groups', [g.name for g in body.vertex_groups][:5], '...', len(body.vertex_groups))

# ---------------------------------------------------------------- 5. retarget: per-bone affine (source frame -> target frame, stretched along the bone)
W = np.zeros((len(V), len(BONES)))
gi = {g.name: g.index for g in body.vertex_groups}
for vi, v in enumerate(body.data.vertices):
    for g in v.groups:
        for n in BONES:
            if gi.get(n) == g.group: W[vi, B[n]] = g.weight
ws = W.sum(1, keepdims=True); ws[ws == 0] = 1; W /= ws
print(f'[body] unweighted verts: {int((W.sum(1) == 0).sum())}')
A = {}
# the cross-section scales with the build: the height ratio times a share of the girth (a 215 lb frame is thicker than
# the base body's); along each bone the stretch is that bone's own (the long arms of an 80" wingspan)
k_cross = (d['H'] / Hs) * d['girth'] ** 0.6
print(f'[body] cross-section scale {k_cross:.3f} (height ratio {d["H"] / Hs:.3f}, girth {d["girth"]:.3f})')
for n in BONES:
    Ms, Ls = frame(src[n], tail_of(src, n)); Mt, Lt = frame(tgt[n], tail_of(tgt, n))
    S = np.diag([k_cross, Lt / Ls, k_cross, 1])
    A[n] = Mt @ S @ np.linalg.inv(Ms)
Vh = np.c_[V, np.ones(len(V))]
V2 = np.zeros_like(V)
for n in BONES:
    V2 += W[:, [B[n]]] * (Vh @ A[n].T)[:, :3]
for i, v in enumerate(body.data.vertices):
    v.co = V2[i]
# eyes: rigid with the head (uniform scale by the head's stretch about the head joint)
# eyes: the eyeball's centre goes where the head's affine puts it; the ball itself scales with the face (k_cross)
for e in eyes:
    E = np.array([v.co[:] for v in e.data.vertices]); c = E.mean(0)
    c2 = (A['head'] @ np.r_[c, 1])[:3]
    for i, v in enumerate(e.data.vertices):
        v.co = c2 + (E[i] - c) * k_cross
body.data.update()
V2z = V2[:, 2]
print(f'[body] retargeted: height {V2z.max() - V2z.min():.4f} (target {d["H"]:.4f}), feet z min {V2z.min():.4f}, hand tip x {V2[:, 0].max():.3f} (target {tgt["handtipL"][0]:.3f})')

# ---------------------------------------------------------------- 6. the final armature at our bind, weights kept
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); src_arm.select_set(True); bpy.context.view_layer.objects.active = body
with bpy.context.temp_override(active_object=body, selected_objects=[body], selected_editable_objects=[body]):
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
for m in list(body.modifiers):
    body.modifiers.remove(m)
bpy.data.objects.remove(src_arm, do_unlink=True)
rig = build_armature('Armature', tgt)
rig.name = 'Armature'
body.parent = rig
mod = body.modifiers.new('Armature', 'ARMATURE'); mod.object = rig
for e in eyes:
    e.parent = rig; e.parent_type = 'BONE'; e.parent_bone = 'head'
    # (bone parenting puts the child at the bone's tail: compensate)
    e.matrix_parent_inverse = (rig.matrix_world @ rig.pose.bones['head'].matrix @ Matrix.Translation((0, rig.data.bones['head'].length, 0))).inverted()
bpy.context.view_layer.update()
for o in (body, *eyes):
    for p in o.data.polygons: p.use_smooth = True
out = os.path.join(args.out, 'body_rigged.blend')
bpy.ops.wm.save_as_mainfile(filepath=out)
import json
json.dump({'build': args.build, 'dims': d, 'bind': {n: tgt[n].tolist() for n in tgt}, 'src': {n: src[n].tolist() for n in src}, 'Hs': Hs}, open(os.path.join(args.out, 'body_fit.json'), 'w'), indent=1)
print('[body] saved', out)
