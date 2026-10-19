"""Stage 2 of the RIMRIFT athlete pipeline (Blender 4.5 headless), after build_body.py:
  blender -b --python tools/athlete/build_athlete.py -- --work <dir with body_rigged.blend> --out <game/assets/athlete> [--no-bake]

Garments lofted from the rigged body's own cross-sections (jersey with straps, shorts with two legs, a right-arm
compression sleeve, crew socks, high-top shoes with soles), a short curly hair cap, the eyes, skin-zone bake (beard,
brows, lips, hairline, sweat) to the body's UVs, the PIL texture pass (textures.py), materials, and the glTF export
(athlete.glb, skinned to the 21-bone armature, +Y up, facing +Z).
"""
import bpy, bmesh, sys, os, math, argparse, json, subprocess
import numpy as np
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import skel
from skel import BONES, B, PARENT

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--work', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--no-bake', action='store_true')
ap.add_argument('--no-export', action='store_true')
args = ap.parse_args(argv)
TEX = os.path.join(args.out, 'textures'); os.makedirs(TEX, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))

bpy.ops.wm.open_mainfile(filepath=os.path.join(args.work, 'body_rigged.blend'))
scene = bpy.context.scene
body = bpy.data.objects['Body']; rig = bpy.data.objects['Armature']
eyes = [bpy.data.objects['EyeL'], bpy.data.objects['EyeR']]
fit = json.load(open(os.path.join(args.work, 'body_fit.json')))
d = fit['dims']; H = d['H']
bind = {n: np.array(v) for n, v in fit['bind'].items()}

V = np.array([v.co[:] for v in body.data.vertices])
NV = len(V)
# per-vertex weights and the dominant bone
W = np.zeros((NV, len(BONES)))
gi = {g.index: g.name for g in body.vertex_groups}
for vi, v in enumerate(body.data.vertices):
    for g in v.groups:
        n = gi.get(g.group)
        if n in B: W[vi, B[n]] = g.weight
dom = W.argmax(1)
body.data.calc_normals_split() if hasattr(body.data, 'calc_normals_split') else None
N = np.array([v.normal[:] for v in body.data.vertices])
sig = lambda x: 1 / (1 + np.exp(-x))
smooth = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0, 1))
rng = np.random.default_rng(39)


def is_part(names):
    idx = [B[n] for n in names]
    return np.isin(dom, idx)


def new_mesh_object(name, verts, faces, uvs=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    if uvs is not None:
        uv = me.uv_layers.new(name='UVMap')
        for poly in me.polygons:
            for li in poly.loop_indices:
                vi = me.loops[li].vertex_index
                uv.data[li].uv = uvs[vi]
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    for p in me.polygons: p.use_smooth = True
    return ob


def clearance(ob, offset):
    """shrinkwrap 'above surface': any garment vertex inside (or closer than offset to) the body is pushed out to
    `offset` above the skin; vertices already clear stay put. Applied right away (the body loses its covered faces later)."""
    m = ob.modifiers.new('Clear', 'SHRINKWRAP'); m.target = body; m.wrap_method = 'NEAREST_SURFACEPOINT'; m.wrap_mode = 'ABOVE_SURFACE'; m.offset = offset
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    with bpy.context.temp_override(active_object=ob, selected_objects=[ob], selected_editable_objects=[ob], object=ob):
        bpy.ops.object.modifier_apply(modifier='Clear')


def skin_to_body(ob, offset_only=False):
    """copy the nearest body vertex's weights, parent to the armature"""
    P = np.array([v.co[:] for v in ob.data.vertices])
    idx = np.empty(len(P), dtype=int)
    for s in range(0, len(P), 512):
        dd = ((P[s:s + 512, None, :] - V[None, :, :]) ** 2).sum(2)
        idx[s:s + 512] = dd.argmin(1)
    for bi, n in enumerate(BONES):
        g = ob.vertex_groups.new(name=n)
        for vi in range(len(P)):
            w = W[idx[vi], bi]
            if w > 1e-4: g.add([vi], float(w), 'REPLACE')
    ob.parent = rig
    m = ob.modifiers.new('Armature', 'ARMATURE'); m.object = rig
    return idx


# ---------------------------------------------------------------- hull sampling
NA = 48  # ring segments


def hull_table(P, zs, u, v, axis, offset, half=0.012, extra=None):
    """radius table R[k, i] for levels zs (along `axis` through the origin-plane...) — here for vertical tubes:
    centre (cx, cy) at each z is the slab centroid; returns (centres, R) with R already offset."""
    cents, R = [], []
    for z in zs:
        m = np.abs(P[:, 2] - z) < half
        S = P[m]
        if len(S) < 6:
            S = P[np.abs(P[:, 2] - z) < half * 3]
        c = np.array([S[:, 0].mean(), S[:, 1].mean(), z]) if extra is None else extra(z, S)
        dxy = S[:, :2] - c[:2]
        a = dxy @ u[:2]; b = dxy @ v[:2]
        th = np.arctan2(b, a); r = np.hypot(a, b)
        bins = np.floor((th + np.pi) / (2 * np.pi) * NA).astype(int) % NA
        rr = np.full(NA, -1.0)
        np.maximum.at(rr, bins, r)
        # fill empty bins circularly, then smooth
        if (rr < 0).any():
            ok = np.where(rr >= 0)[0]
            for i in np.where(rr < 0)[0]:
                dist = np.minimum((ok - i) % NA, (i - ok) % NA)
                j = ok[np.argsort(dist)[:2]]
                rr[i] = rr[j].mean()
        sm_ = (np.roll(rr, 1) + 2 * rr + np.roll(rr, -1)) / 4
        rr = np.maximum(rr, sm_)  # (fill the dips between bins, keep the peaks: nothing of the body shows through)
        cents.append(c); R.append(rr + offset)
    return np.array(cents), np.array(R)


def sample_table(zs, cents, R, z, th):
    """bilinear in z (rows) and angle"""
    k = np.interp(z, zs, np.arange(len(zs)))
    k0 = int(np.clip(np.floor(k), 0, len(zs) - 2)); t = k - k0
    i = (th + np.pi) / (2 * np.pi) * NA; i0 = int(np.floor(i)) % NA; s = i - np.floor(i)
    r = (R[k0, i0] * (1 - s) + R[k0, (i0 + 1) % NA] * s) * (1 - t) + (R[k0 + 1, i0] * (1 - s) + R[k0 + 1, (i0 + 1) % NA] * s) * t
    c = cents[k0] * (1 - t) + cents[k0 + 1] * t
    return r, c


FRONT = np.array([0.0, -1.0, 0.0]); LEFT = np.array([1.0, 0.0, 0.0])


def tube(name, P, z_bot, z_top_fn, K, offset, seam=0.25, half=0.016, u_range=(0, 1), v_range=(0, 1), taper=None):
    """a vertical tube around point set P from z_bot up to z_top_fn(theta) (theta from the front, +left), K rings.
    Column 0 (u = u_range[0]) sits at angle seam*2pi from the front; the front centre lands at u = (-seam mod 1)."""
    tops = [z_top_fn(t) for t in np.linspace(-np.pi, np.pi, 33)]
    zs = np.linspace(min(z_bot, min(tops)) - 0.01, max(tops) + 0.01, 40)
    cents, R = hull_table(P, zs, FRONT, LEFT, None, offset, half)
    verts, uvs, faces = [], [], []
    th0 = seam * 2 * np.pi
    for k in range(K + 1):
        f = k / K
        for i in range(NA + 1):
            th = th0 + 2 * np.pi * (i % NA) / NA
            th = (th + np.pi) % (2 * np.pi) - np.pi  # -pi..pi, 0 = front
            zt = z_top_fn(th)
            z = z_bot + (zt - z_bot) * f
            r, c = sample_table(zs, cents, R, z, th)
            if taper is not None: r *= taper(f)
            p = c + (FRONT * np.cos(th) + LEFT * np.sin(th)) * r
            p[2] = z
            verts.append(p)
            uvs.append((u_range[0] + (u_range[1] - u_range[0]) * i / NA, v_range[0] + (v_range[1] - v_range[0]) * f))
    C = NA + 1
    for k in range(K):
        for i in range(NA):
            a = k * C + i; faces.append((a, a + 1, a + C + 1, a + C))
    return new_mesh_object(name, verts, faces, uvs)


def axis_tube(name, P, c0, c1, K, offset, r_extra=0.0, u_range=(0, 1), v_range=(0, 1), half=0.012):
    """a tube around P along the segment c0->c1 (any direction), rings perpendicular to the axis"""
    ax = c1 - c0; L = np.linalg.norm(ax); ax /= L
    hint = np.array([0, 1.0, 0]) if abs(ax[1]) < 0.9 else np.array([0, 0, 1.0])
    u = np.cross(ax, hint); u /= np.linalg.norm(u); v = np.cross(u, ax)
    rel = P - c0; t = rel @ ax
    verts, uvs, faces = [], [], []
    for k in range(K + 1):
        f = k / K; tk = f * L
        S = P[np.abs(t - tk) < half]
        if len(S) < 6: S = P[np.abs(t - tk) < half * 3]
        c = c0 + ax * tk
        # centre on the slab's centroid projected to the ring plane
        cs = S.mean(0); cs = cs - ax * ((cs - c) @ ax)
        dd = S - cs; a = dd @ u; b = dd @ v
        th = np.arctan2(b, a); r = np.hypot(a, b)
        bins = np.floor((th + np.pi) / (2 * np.pi) * NA).astype(int) % NA
        rr = np.full(NA, -1.0); np.maximum.at(rr, bins, r)
        if (rr < 0).any():
            ok = np.where(rr >= 0)[0]
            for i in np.where(rr < 0)[0]:
                dist = np.minimum((ok - i) % NA, (i - ok) % NA); j = ok[np.argsort(dist)[:2]]; rr[i] = rr[j].mean()
        sm_ = (np.roll(rr, 1) + 2 * rr + np.roll(rr, -1)) / 4
        rr = np.maximum(rr, sm_) + offset + r_extra
        for i in range(NA + 1):
            j = i % NA
            th_i = -np.pi + 2 * np.pi * j / NA
            r_i = rr[j] if i < NA else rr[0]
            verts.append(cs + (u * np.cos(th_i) + v * np.sin(th_i)) * r_i)
            uvs.append((u_range[0] + (u_range[1] - u_range[0]) * i / NA, v_range[0] + (v_range[1] - v_range[0]) * f))
    C = NA + 1
    for k in range(K):
        for i in range(NA):
            a = k * C + i; faces.append((a, a + 1, a + C + 1, a + C))
    return new_mesh_object(name, verts, faces, uvs)


# ---------------------------------------------------------------- jersey
torso = V[is_part(['hips', 'spine', 'chest', 'neck', 'clavL', 'clavR'])]
JER_HEM = 0.47 * H


def jersey_top(th):
    f = abs(th) / np.pi
    knots = [(0.0, 0.772), (0.16, 0.786), (0.3, 0.802), (0.5, 0.748), (0.7, 0.808), (0.85, 0.800), (1.0, 0.794)]
    xs = [k[0] for k in knots]; ys = [k[1] for k in knots]
    # smooth (cosine) interpolation between knots
    for i in range(1, len(xs)):
        if f <= xs[i]:
            t = (f - xs[i - 1]) / (xs[i] - xs[i - 1]); t = 0.5 - 0.5 * math.cos(math.pi * t)
            return (ys[i - 1] + (ys[i] - ys[i - 1]) * t) * H
    return ys[-1] * H


jersey = tube('Jersey', torso, JER_HEM, jersey_top, 22, 0.013, seam=0.25, v_range=(0.0, 0.9))
# straps: ribbons over the shoulders from the front top edge (f=0.3) to the back top edge (f=0.7)
strap_objs = []
for side, sg in (('L', 1), ('R', -1)):
    thA = sg * 0.3 * np.pi; thB = sg * 0.7 * np.pi
    jv = np.array([v.co[:] for v in jersey.data.vertices])
    def nearest_top(th):
        top = jv[-(NA + 1):]
        ang = np.array([0.25 * 2 * np.pi + 2 * np.pi * (i % NA) / NA for i in range(NA + 1)])
        return top[np.argmin(np.abs(((ang - th + np.pi) % (2 * np.pi)) - np.pi))]
    A = nearest_top(thA); Bp = nearest_top(thB)
    xs = sg * 0.52 * d['shoulderX']
    near = torso[(np.abs(torso[:, 0] - xs) < 0.025) & (torso[:, 2] > 0.76 * H)]
    zs_top = near[:, 2].max() + 0.012 if len(near) else 0.84 * H
    ys_top = near[np.argmax(near[:, 2]), 1] if len(near) else (A[1] + Bp[1]) / 2
    S = np.array([xs, ys_top, zs_top])
    # quadratic bezier through A, S, B: control = 2S - (A+B)/2
    Cc = 2 * S - (A + Bp) / 2
    Kq = 12; wd = 0.019
    verts, uvs, faces = [], [], []
    for k in range(Kq + 1):
        t = k / Kq
        p = (1 - t) ** 2 * A + 2 * (1 - t) * t * Cc + t * t * Bp
        tg = 2 * (1 - t) * (Cc - A) + 2 * t * (Bp - Cc); tg /= np.linalg.norm(tg)
        side_dir = np.array([sg, 0, 0.0]); side_dir -= tg * (side_dir @ tg); side_dir /= np.linalg.norm(side_dir)
        nrm = np.cross(tg, side_dir)
        if nrm[2] < 0: nrm = -nrm
        # widen a touch at the ends where they meet the panels
        w = wd * (1 + 0.35 * (abs(t - 0.5) * 2) ** 2)
        verts.append(p - side_dir * w); verts.append(p + side_dir * w)
        uvs.append((0.02 + 0.96 * t, 0.925)); uvs.append((0.02 + 0.96 * t, 0.995))
    for k in range(Kq):
        a = 2 * k; faces.append((a, a + 1, a + 3, a + 2))
    st = new_mesh_object('Strap' + side, verts, faces, uvs)
    strap_objs.append(st)
# join the straps into the jersey
bpy.ops.object.select_all(action='DESELECT')
for o in strap_objs: o.select_set(True)
jersey.select_set(True); bpy.context.view_layer.objects.active = jersey
with bpy.context.temp_override(active_object=jersey, selected_objects=[jersey, *strap_objs], selected_editable_objects=[jersey, *strap_objs]):
    bpy.ops.object.join()
clearance(jersey, 0.013)
skin_to_body(jersey)
sol = jersey.modifiers.new('Solidify', 'SOLIDIFY'); sol.thickness = 0.002; sol.offset = 1

# ---------------------------------------------------------------- shorts
hipsthighs = V[is_part(['hips', 'thighL', 'thighR', 'spine'])]
shorts = tube('Shorts', hipsthighs, 0.455 * H, lambda th: 0.605 * H, 10, 0.024, seam=0.25, v_range=(0.5, 1.0))
legs = []
for side, sg in (('L', 1), ('R', -1)):
    thigh = V[is_part(['thigh' + side])]
    thigh = thigh[thigh[:, 2] > 0.26 * H]
    leg = tube('ShortsLeg' + side, thigh, 0.305 * H, lambda th: 0.50 * H, 10, 0.015, seam=0.75 if sg > 0 else 0.25, v_range=(0.0, 0.5),
               taper=lambda f: 1 + 0.08 * (1 - f))
    clearance(leg, 0.015)
    legs.append(leg)
clearance(shorts, 0.024)
bpy.ops.object.select_all(action='DESELECT')
for o in legs: o.select_set(True)
shorts.select_set(True); bpy.context.view_layer.objects.active = shorts
with bpy.context.temp_override(active_object=shorts, selected_objects=[shorts, *legs], selected_editable_objects=[shorts, *legs]):
    bpy.ops.object.join()
skin_to_body(shorts)
sol = shorts.modifiers.new('Solidify', 'SOLIDIFY'); sol.thickness = 0.002; sol.offset = 1

# ---------------------------------------------------------------- sleeve (right arm), socks, shoes
armR = V[is_part(['upperR', 'foreR', 'handR'])]
sleeve = axis_tube('Sleeve', armR, bind['upperR'] + (bind['foreR'] - bind['upperR']) * 0.35, bind['handR'] - (bind['handR'] - bind['foreR']) * 0.06, 14, 0.006, half=0.014)
clearance(sleeve, 0.005)
skin_to_body(sleeve)
socks = []
for side in 'LR':
    shin = V[is_part(['shin' + side, 'foot' + side])]
    s = axis_tube('Sock' + side, shin, bind['foot' + side] - np.array([0, 0, 0.03 * H]), bind['foot' + side] + np.array([0, 0, 0.13 * H]), 8, 0.006, half=0.014)
    socks.append(s)
shoes = []
for side, sg in (('L', 1), ('R', -1)):
    foot_mask = is_part(['foot' + side, 'toe' + side]) & (V[:, 2] < 0.075 * H)
    foot_mask |= is_part(['shin' + side]) & (V[:, 2] < 0.075 * H) & (sg * V[:, 0] > 0)
    # upper: the foot's own vertices, pushed out along the normal (the shoe's thickness), high-top up to the ankle
    idx = np.where(foot_mask)[0]
    remap = {vi: i for i, vi in enumerate(idx)}
    verts = V[idx] + N[idx] * 0.009
    verts[:, 2] = np.maximum(verts[:, 2], 0.016)
    faces = []
    for p in body.data.polygons:
        vs = list(p.vertices)
        if all(vi in remap for vi in vs): faces.append([remap[vi] for vi in vs])
    # uvs: planar from above for the upper (u along the foot, v across), rotated per side
    fc = V[idx].mean(0)
    uvs = [(0.5 + (p[1] - fc[1]) / 0.42, 0.75 + sg * (p[0] - fc[0]) / 0.32) for p in verts]
    upper = new_mesh_object('ShoeUpper' + side, verts, faces, uvs)
    # sole: the foot's floor outline, extruded
    fl = V[idx][V[idx][:, 2] < 0.035]
    c = fl.mean(0); c[2] = 0
    th = np.arctan2(fl[:, 0] - c[0], -(fl[:, 1] - c[1])); r = np.hypot(fl[:, 0] - c[0], fl[:, 1] - c[1])
    bins = np.floor((th + np.pi) / (2 * np.pi) * NA).astype(int) % NA
    rr = np.full(NA, -1.0); np.maximum.at(rr, bins, r)
    ok = np.where(rr >= 0)[0]
    for i in np.where(rr < 0)[0]:
        dist = np.minimum((ok - i) % NA, (i - ok) % NA); j = ok[np.argsort(dist)[:2]]; rr[i] = rr[j].mean()
    for _ in range(3): rr = (np.roll(rr, 1) + 2 * rr + np.roll(rr, -1)) / 4
    rr += 0.012
    sv, su, sf = [], [], []
    zlev = [0.0, 0.014, 0.026]
    for k, z in enumerate(zlev):
        for i in range(NA + 1):
            j = i % NA; t = -np.pi + 2 * np.pi * j / NA
            sv.append(c + np.array([np.sin(t), -np.cos(t), 0]) * rr[j] * (1.0 if k else 0.97) + np.array([0, 0, z]))
            su.append((i / NA, 0.02 + 0.2 * k / 2))
    C = NA + 1
    for k in range(len(zlev) - 1):
        for i in range(NA):
            a = k * C + i; sf.append((a, a + 1, a + C + 1, a + C))
    # bottom cap (a fan)
    sv.append(c.copy()); ci = len(sv) - 1; su.append((0.5, 0.01))
    for i in range(NA): sf.append((ci, i + 1, i))
    # top cap
    sv.append(c + np.array([0, 0, zlev[-1]])); ti = len(sv) - 1; su.append((0.5, 0.23))
    base = (len(zlev) - 1) * C
    for i in range(NA): sf.append((ti, base + i, base + i + 1))
    sole = new_mesh_object('ShoeSole' + side, sv, sf, su)
    bpy.ops.object.select_all(action='DESELECT')
    sole.select_set(True); upper.select_set(True); bpy.context.view_layer.objects.active = upper
    with bpy.context.temp_override(active_object=upper, selected_objects=[upper, sole], selected_editable_objects=[upper, sole]):
        bpy.ops.object.join()
    upper.name = 'Shoe' + side
    shoes.append(upper)
for o in socks: clearance(o, 0.005)
for o in socks + shoes: skin_to_body(o)
for o in shoes:
    sol = o.modifiers.new('Solidify', 'SOLIDIFY'); sol.thickness = 0.004; sol.offset = 1

# ---------------------------------------------------------------- hair cap
head_mask = is_part(['head']) | (is_part(['neck']) & (V[:, 2] > bind['head'][2] + 0.02))
eyeL = np.array([v.co[:] for v in eyes[0].data.vertices]); eye_c = (eyeL.mean(0) + np.array([v.co[:] for v in eyes[1].data.vertices]).mean(0)) / 2
z_eye = eye_c[2]; z_top = V[:, 2].max()
hv = V[head_mask]
y_front, y_back = hv[:, 1].min(), hv[:, 1].max(); yc = (y_front + y_back) / 2
print(f'[hair] eye z {z_eye:.3f}, head top {z_top:.3f}, head y [{y_front:.3f}, {y_back:.3f}]')


def hairline(p):
    # hairline height as a function of where we are round the head (front high, sides mid, back low)
    fy = np.clip((p[:, 1] - y_front) / (y_back - y_front), 0, 1)  # 0 front, 1 back
    side = np.clip(np.abs(p[:, 0]) / 0.075, 0, 1)
    front = z_eye + 0.09 - 0.055 * side ** 1.5   # the forehead hairline, dropping to just above the ears at the sides
    back = z_eye - 0.015
    return np.where(fy < 0.42, front, np.where(fy < 0.72, front + (back - front) * smooth(0.42, 0.72, fy), back))


hmask = head_mask & (V[:, 2] > hairline(V))
# keep the ears out: ears sit at the sides at eye level +- ; they are already below the side hairline mostly
idx = np.where(hmask)[0]
remap = {vi: i for i, vi in enumerate(idx)}
hp = V[idx]
lift = 0.005 + 0.038 * smooth(z_eye + 0.02, z_top - 0.04, hp[:, 2]) * (1 - 0.55 * np.clip(np.abs(hp[:, 0]) / 0.095, 0, 1) ** 2)
curl = 1 + 0.35 * (np.sin(hp[:, 0] * 180) * np.sin(hp[:, 1] * 170 + 1.3) * np.sin(hp[:, 2] * 160 + 0.7))
hfaces = []
for p in body.data.polygons:
    vs = list(p.vertices)
    if all(vi in remap for vi in vs): hfaces.append([remap[vi] for vi in vs])
# soft hairline: the cap's boundary ring sits on the scalp, the next ring halfway (no hard helmet edge)
edge_count = {}
for f_ in hfaces:
    for a_, b_ in zip(f_, f_[1:] + f_[:1]): edge_count[tuple(sorted((a_, b_)))] = edge_count.get(tuple(sorted((a_, b_))), 0) + 1
bnd = {v_ for e_, c_ in edge_count.items() if c_ == 1 for v_ in e_}
ring2 = {v_ for e_ in edge_count for v_ in e_ if (e_[0] in bnd) != (e_[1] in bnd)} - bnd
taper = np.ones(len(hp)); taper[list(bnd)] = 0.08; taper[list(ring2)] = 0.5
hverts = hp + N[idx] * (lift * curl * taper)[:, None]
hc = np.array([0, yc, z_eye + 0.06])
huv = [(0.5 + np.arctan2(p[0] - hc[0], -(p[1] - hc[1])) / (2 * np.pi), np.clip((p[2] - (z_eye - 0.02)) / (z_top + 0.04 - (z_eye - 0.02)), 0, 1)) for p in hverts]
hair = new_mesh_object('Hair', hverts, hfaces, huv)
skin_to_body(hair)
smo = hair.modifiers.new('Smooth', 'SMOOTH'); smo.factor = 0.6; smo.iterations = 3
sub = hair.modifiers.new('Subdivision', 'SUBSURF'); sub.levels = 2; sub.render_levels = 2
sol = hair.modifiers.new('Solidify', 'SOLIDIFY'); sol.thickness = 0.008; sol.offset = -1
cards = None  # (hair cards tried and dropped: at this density they read as spikes; the subdivided cap carries the silhouette)

# ---------------------------------------------------------------- body UVs
# (the base body's UVMap only lays out the head; every other vertex sits on top of that island. The head's island is
# kept and the rest of the body is smart-projected beside it, then everything is packed into 0..1)
headish = is_part(['head', 'neck'])
bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='EDIT')
bm = bmesh.from_edit_mesh(body.data)
bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table()
for f in bm.faces:
    f.select = not all(headish[v.index] for v in f.verts)
bmesh.update_edit_mesh(body.data)
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003, correct_aspect=True, scale_to_bounds=False)
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.select_all(action='SELECT')
bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
bpy.ops.object.mode_set(mode='OBJECT')
print('[uv] body re-projected (head island kept), packed')

# ---------------------------------------------------------------- skin zones (vertex colours -> baked to the body's UVs)
zones = np.zeros((NV, 4), dtype=np.float32)
fy = np.clip((V[:, 1] - y_front) / (y_back - y_front), 0, 1)
front_face = head_mask & (fy < 0.5)
dz = V[:, 2] - z_eye; ax_ = np.abs(V[:, 0])
# (calibrated on the base head: mouth at -10 cm, chin -13.7 cm, nose base -5.5 cm, brows +3 cm, ears at |x| 0.09)
chin = front_face & (dz < -0.108) & (dz > -0.175)
jaw = head_mask & (((ax_ > 0.05) & (dz < -0.068) & (dz > -0.15)) | ((ax_ > 0.078) & (dz < 0.0) & (fy > 0.3))) & (fy < 0.62)
stache = front_face & (dz < -0.076) & (dz > -0.092) & (ax_ < 0.04)
lips = front_face & (dz < -0.092) & (dz > -0.108) & (ax_ < 0.03) & (fy < 0.15)
beard = (chin | jaw | stache) & ~lips
zones[:, 0] = np.where(beard, 1.0, 0.0) * (0.55 + 0.45 * smooth(-0.045, -0.1, dz)) * (1 - 0.6 * smooth(0.35, 0.62, fy))
zones[:, 2] = np.where(lips, 1.0, 0.0)
brow = front_face & (dz > 0.027) & (dz < 0.041) & (ax_ > 0.016) & (ax_ < 0.052) & (fy < 0.3)
zones[:, 1] = np.where(brow, 1.0, 0.0)
# hairline shadow (under the cap) and the fade at the sides
hairzone = np.where(head_mask & (V[:, 2] > hairline(V) - 0.02), 1.0, 0.0)
col = body.data.color_attributes.new('zones', 'FLOAT_COLOR', 'POINT')
for i in range(NV): col.data[i].color = zones[i]
# a second attribute: body position (for the sweat map: shoulders/chest/forehead) — height fraction in R, front-ness in G
posc = body.data.color_attributes.new('posz', 'FLOAT_COLOR', 'POINT')
for i in range(NV): posc.data[i].color = (V[i, 2] / H, 0.5 - V[i, 1] / 0.5, hairzone[i], 1)

# eyes: an iris/pupil mask from the eye's own forward axis (the front-most pole)
for e in eyes:
    E = np.array([v.co[:] for v in e.data.vertices]); c = E.mean(0)
    dd = E - c; fwd = np.array([0, -1.0, 0]); r = np.linalg.norm(dd, axis=1).max()
    cosang = (dd @ fwd) / (np.linalg.norm(dd, axis=1) + 1e-9)
    iris = smooth(0.80, 0.84, cosang); pupil = smooth(0.955, 0.965, cosang)
    ca = e.data.color_attributes.new('zones', 'FLOAT_COLOR', 'POINT')
    for i in range(len(E)): ca.data[i].color = (iris[i], pupil[i], 0, 1)


def bake_attribute(ob, attr, size, path):
    scene.render.engine = 'CYCLES'; scene.cycles.samples = 1; scene.cycles.device = 'CPU'
    scene.render.bake.margin = 4; scene.render.bake.use_clear = True
    img = bpy.data.images.new(os.path.basename(path), size, size, alpha=True, float_buffer=False)
    mat = bpy.data.materials.new('bake_' + ob.name); mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial'); em = nt.nodes.new('ShaderNodeEmission'); at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = attr
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img; nt.nodes.active = tex
    nt.links.new(at.outputs['Color'], em.inputs['Color']); nt.links.new(em.outputs[0], out.inputs[0])
    ob.data.materials.clear(); ob.data.materials.append(mat)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    with bpy.context.temp_override(active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        bpy.ops.object.bake(type='EMIT')
    img.filepath_raw = path; img.file_format = 'PNG'; img.save()
    ob.data.materials.clear()
    print('[bake] wrote', path)


if not args.no_bake:
    bake_attribute(body, 'zones', 2048, os.path.join(args.work, 'bake_zones.png'))
    bake_attribute(body, 'posz', 2048, os.path.join(args.work, 'bake_pos.png'))
    bake_attribute(eyes[0], 'zones', 256, os.path.join(args.work, 'bake_eye.png'))

# ---------------------------------------------------------------- textures (PIL, system python)
subprocess.run(['python3', os.path.join(HERE, 'textures.py'), '--work', args.work, '--out', TEX], check=True)

# ---------------------------------------------------------------- materials


def image(name):
    p = os.path.join(TEX, name)
    img = bpy.data.images.load(p, check_existing=True)
    return img


def material(name, albedo, orm=None, normal=None, nstrength=1.0, alpha=False, double=False, rough=0.6):
    mat = bpy.data.materials.new(name); mat.use_nodes = True
    nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
    ta = nt.nodes.new('ShaderNodeTexImage'); ta.image = image(albedo)
    nt.links.new(ta.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    if orm:
        to = nt.nodes.new('ShaderNodeTexImage'); to.image = image(orm); to.image.colorspace_settings.name = 'Non-Color'
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(to.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness']); nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    if normal:
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = image(normal); tn.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = nstrength
        nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if alpha:
        nt.links.new(ta.outputs['Alpha'], bsdf.inputs['Alpha'])
        mat.blend_method = 'CLIP' if hasattr(mat, 'blend_method') else None
        if hasattr(mat, 'surface_render_method'): mat.surface_render_method = 'DITHERED'
    mat.use_backface_culling = not double
    return mat


def assign(ob, mat):
    ob.data.materials.clear(); ob.data.materials.append(mat)


skin = material('Skin', 'skin_albedo.png', 'skin_orm.png', 'skin_normal.png', 0.6)
assign(body, skin)
assign(jersey, material('Jersey', 'jersey_albedo.png', 'jersey_orm.png', 'jersey_normal.png', 0.35, double=True))
assign(shorts, material('Shorts', 'shorts_albedo.png', 'shorts_orm.png', 'jersey_normal.png', 0.3, double=True))
assign(sleeve, material('Sleeve', 'sleeve_albedo.png', 'sleeve_orm.png', 'knit_normal.png', 0.5, double=True))
sockm = material('Sock', 'sock_albedo.png', 'sock_orm.png', 'knit_normal.png', 0.7, double=True)
for o in socks: assign(o, sockm)
shoem = material('Shoe', 'shoe_albedo.png', 'shoe_orm.png', None, double=True)
for o in shoes: assign(o, shoem)
hairm = material('Hair', 'hair_albedo.png', 'hair_orm.png', 'hair_normal.png', 1.0, double=True)
assign(hair, hairm)
eyem = material('Eye', 'eye_albedo.png', 'eye_orm.png', None)
for e in eyes: assign(e, eyem)

# ---------------------------------------------------------------- hide what the kit covers
# (the standard trick: body faces entirely under the jersey, shorts, socks or shoes are deleted, so no pose can push
# the torso through the cloth; a margin is kept at every opening)
th_of = np.arctan2(V[:, 0], -V[:, 1])  # angle from the front, +left (the jersey's own convention)
ztop = np.array([jersey_top(t) for t in th_of])
torso_dom = is_part(['hips', 'spine', 'chest'])
under_jersey = torso_dom & (V[:, 2] > JER_HEM + 0.03) & (V[:, 2] < ztop - 0.03) & (np.abs(V[:, 0]) < d['shoulderX'] - 0.02)
under_shorts = is_part(['hips', 'thighL', 'thighR', 'spine']) & (V[:, 2] > 0.325 * H) & (V[:, 2] < 0.60 * H)
under_socks = is_part(['shinL', 'shinR']) & (V[:, 2] > 0.045 * H) & (V[:, 2] < 0.155 * H)
under_shoes = (V[:, 2] < 0.06 * H) & is_part(['footL', 'footR', 'toeL', 'toeR', 'shinL', 'shinR'])
covered = under_jersey | under_shorts | under_socks | under_shoes
bm = bmesh.new(); bm.from_mesh(body.data); bm.verts.ensure_lookup_table()
dead = [f_ for f_ in bm.faces if all(covered[v_.index] for v_ in f_.verts)]
bmesh.ops.delete(bm, geom=dead, context='FACES')
bm.to_mesh(body.data); bm.free(); body.data.update()
print(f'[cover] removed {len(dead)} covered body faces; body now {len(body.data.polygons)} polys')

# ---------------------------------------------------------------- stats + export
tri = 0
for o in scene.objects:
    if o.type == 'MESH':
        me = o.data; t = sum(len(p.vertices) - 2 for p in me.polygons)
        has_sol = any(m.type == 'SOLIDIFY' for m in o.modifiers)
        tri += t * (2 if has_sol else 1)
        print(f'[mesh] {o.name:12s} verts {len(me.vertices):6d} tris {t:6d}{" (x2 solidify)" if has_sol else ""}')
print(f'[mesh] total ~{tri} tris')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(args.work, 'athlete.blend'))
if not args.no_export:
    glb = os.path.join(args.out, 'athlete.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_skins=True, export_yup=True, export_apply=True,
                              export_animations=False, export_image_format='AUTO', export_texcoords=True, export_normals=True, export_materials='EXPORT')
    print('[export]', glb, os.path.getsize(glb) / 1e6, 'MB')
