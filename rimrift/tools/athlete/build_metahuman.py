"""The MetaHuman athlete (David's Unreal export) through our pipeline (Blender 4.5 headless):
  blender -b --python tools/athlete/build_metahuman.py -- --fbx <Athlete_FullBody.fbx> --maps <Maps dir> --out <game/assets/athlete/metahuman>
      [--build 77 215 80] [--tris 45000] [--head-share 0.36] [--work <scratch>] [--no-kit]

Stage 1 (this file): imports the full-body skeletal mesh (341-bone MetaHuman skeleton, A-pose, cm, exported as
triangle soup: every head triangle carries its own 3 vertices, the body is split per UV island), bakes the transforms
to metres/Z-up, welds it back into shells (body+head, 2 eyeballs, teeth; eyelashes and the transparent eye shells are
dropped), folds the 288 weighted bones onto our 21 (twist/corrective/finger/toe bones walk up their parent chain to the
first game bone), decimates to the game budget in two passes (body region, then head region — one connected mesh, so
no crack at the neck seam; the head keeps ~--head-share of the triangles), retargets every vertex onto our 40 degree
A-pose bind for the build with the per-bone stretch LBS of build_body.py (minimal-rotation bone frames), rebuilds the
armature at our bind, splits the UDIM into two materials (tile 1001 = head, u 0..1; tile 1002 = body, u shifted by -1),
packs ORM from the SRMF maps when they exist, bakes beard/brow/scalp zones into the head basecolor (hair/beard are
strand grooms in Unreal and are not in the FBX), and saves <work>/body_rigged.blend + body_fit.json in the contract
build_athlete.py expects.
Stage 2: build_athlete.py --mh (the kit: jersey, shorts, sleeve, socks, shoes, hair cap; covered faces removed) exports
<out>/athlete_mh.glb. Pass --no-kit to stop after stage 1 (it then exports <out>/athlete_mh_body.glb, the nude body).
"""
import bpy, bmesh, sys, os, math, argparse, json, subprocess, shutil, glob
import numpy as np
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import skel
from skel import BONES, B, PARENT, to_blender

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--fbx', required=True); ap.add_argument('--maps', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--build', nargs=3, type=float, default=[77, 215, 80])
ap.add_argument('--tris', type=int, default=45000, help='body+head triangle budget before the kit')
ap.add_argument('--head-share', type=float, default=0.36, help='share of --tris that goes to the head')
ap.add_argument('--teeth-tris', type=int, default=1200)
ap.add_argument('--work', default='/tmp/claude-0/character/mh/work')
ap.add_argument('--no-kit', action='store_true')
ap.add_argument('--weld', type=float, default=2e-5)
ap.add_argument('--keep-lids', action='store_true', help='do not open the eyelids (for an export whose bind pose is neutral)')
ap.add_argument('--grooms', default=None, help="Unreal hair-card groom exports (hair/, beard/, brows/, SKM_Groom_Head_Legacy02.fbx); default: <fbx dir>/../grooms when it exists; 'none' to skip")
ap.add_argument('--head-fbx', default=None, help="the MetaHuman Head FBX (open-eyed LOD0 head + eyes/teeth/lashes) that replaces the FullBody's head shell; default: <FullBody stem with _Head>.fbx or any *_Head.fbx beside it; 'none' = FullBody head shell + the eyelid fix")
ap.add_argument('--groom-lod', type=int, default=1, help='card LOD for the game glb (LOD0 is also exported as athlete_mh_lod0.glb for the showroom)')
args = ap.parse_args(argv)
os.makedirs(args.out, exist_ok=True); os.makedirs(args.work, exist_ok=True)
TEX = os.path.join(args.out, 'textures'); os.makedirs(TEX, exist_ok=True)
log = []


def P(*a):
    s = ' '.join(str(x) for x in a); print(s); log.append(s)


# ---------------------------------------------------------------- 1. import, bake transforms, weld
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.fbx(filepath=args.fbx)
bpy.context.view_layer.update()
src_arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
src_mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
bones_world = {b.name: (np.array((src_arm.matrix_world @ b.head_local)[:]), np.array((src_arm.matrix_world @ b.tail_local)[:])) for b in src_arm.data.bones}
bone_parent = {b.name: (b.parent.name if b.parent else None) for b in src_arm.data.bones}
M = src_mesh.matrix_world.copy()
for v in src_mesh.data.vertices: v.co = M @ v.co
for m in list(src_mesh.modifiers): src_mesh.modifiers.remove(m)
src_mesh.parent = None; src_mesh.matrix_world = Matrix.Identity(4)
group_names = [g.name for g in src_mesh.vertex_groups]
nv_in = len(src_mesh.data.vertices); tri_in = sum(len(p.vertices) - 2 for p in src_mesh.data.polygons)

bm = bmesh.new(); bm.from_mesh(src_mesh.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=args.weld)
bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
P(f'[mh] imported {nv_in} verts / {tri_in} tris, {len(src_arm.data.bones)} bones, {len(group_names)} weighted; welded to {len(bm.verts)} verts')

# shells


def components():
    seen = np.zeros(len(bm.verts), bool); comps = []
    for v in bm.verts:
        if seen[v.index]: continue
        stack = [v]; seen[v.index] = True; c = []
        while stack:
            x = stack.pop(); c.append(x.index)
            for e in x.link_edges:
                o = e.other_vert(x)
                if not seen[o.index]: seen[o.index] = True; stack.append(o)
        comps.append(np.array(c))
    comps.sort(key=len, reverse=True)
    return comps


comps = components()
Vw = np.array([v.co[:] for v in bm.verts])

# ---------------------------------------------------------------- 1b. the Head FBX (round 4): open-eyed LOD0 head, eyes, teeth, lashes replace the FullBody's head shell
HEAD_FBX = args.head_fbx
if HEAD_FBX is None:
    cand = [args.fbx.replace('_FullBody.fbx', '_Head.fbx')] + sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(args.fbx)), '*_Head.fbx')))
    HEAD_FBX = next((c for c in cand if os.path.exists(c)), 'none')
head_from_fbx = HEAD_FBX != 'none'
if head_from_fbx:
    deform = bm.verts.layers.deform.verify(); uv_lay = bm.loops.layers.uv.active
    part_lay = bm.verts.layers.int.new('part')  # 1 skin, 2 eye, 3 teeth, 4 lashes (survives the welds)
    PART = {'skin': 1, 'eye': 2, 'teeth': 3, 'lashes': 4}
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=HEAD_FBX)
    new = [o for o in bpy.data.objects if o not in before]
    hm = max((o for o in new if o.type == 'MESH'), key=lambda o: len(o.data.vertices)); ha = next((o for o in new if o.type == 'ARMATURE'), None)
    Mh = hm.matrix_world.copy()
    for v in hm.data.vertices: v.co = Mh @ v.co
    for m in list(hm.modifiers): hm.modifiers.remove(m)
    hm.parent = None; hm.matrix_world = Matrix.Identity(4)
    slots = [ms.material.name if ms.material else '' for ms in hm.material_slots]
    counts = np.bincount([p.material_index for p in hm.data.polygons], minlength=len(slots))
    skin_slot = int(np.argmax(counts)); eye_slots = [i for i, n in enumerate(slots) if 'Eyes' in n]; teeth_slot = next((i for i, n in enumerate(slots) if 'Teeth' in n), None)
    # the eyelashes: the hidden-material slot whose faces sit at the eyes and are not the eyeballs (the second-largest 'M_Hide')
    hv_ = np.array([v.co[:] for v in hm.data.vertices]); eye_z = np.mean([hv_[[vi for p in hm.data.polygons if p.material_index == i for vi in p.vertices]].mean(0)[2] for i in eye_slots]) if eye_slots else 0
    hide = [(counts[i], i) for i, n in enumerate(slots) if 'Hide' in n and counts[i] > 0 and abs(hv_[[vi for p in hm.data.polygons if p.material_index == i for vi in p.vertices]].mean(0)[2] - eye_z) < 0.012]
    lash_slot = max(hide)[1] if hide else None
    keep = {skin_slot: 'skin'}; keep.update({i: 'eye' for i in eye_slots})
    if teeth_slot is not None: keep[teeth_slot] = 'teeth'
    if lash_slot is not None: keep[lash_slot] = 'lashes'
    # the Head FBX's bones (body chain + FACIAL_*) fold onto the body's weighted bones by walking its armature's parents
    hparent = {b.name: (b.parent.name if b.parent else None) for b in ha.data.bones} if ha else {}
    body_gi = {n: i for i, n in enumerate(group_names)}
    def hfold(n):
        while n is not None and n not in body_gi: n = hparent.get(n)
        return body_gi.get(n, body_gi.get('head'))
    hg = {g.index: hfold(g.name) for g in hm.vertex_groups}
    # drop everything of the FullBody but its body shell, then append the kept head parts into the same bmesh
    keep_v = set(int(i) for i in comps[0])
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not all(v.index in keep_v for v in f.verts)], context='FACES')
    bm.verts.ensure_lookup_table(); bm.verts.index_update()
    huv = hm.data.uv_layers.active.data
    vmap = {}
    for p in hm.data.polygons:
        if p.material_index not in keep: continue
        vs = []
        for vi, li in zip(p.vertices, p.loop_indices):
            if vi not in vmap:
                nv = bm.verts.new(hm.data.vertices[vi].co); dv = nv[deform]; nv[part_lay] = PART[keep[p.material_index]]
                for g in hm.data.vertices[vi].groups:
                    if g.weight > 1e-5: dv[hg[g.group]] = dv.get(hg[g.group], 0.0) + g.weight
                vmap[vi] = nv
            vs.append(vmap[vi])
        try: f = bm.faces.new(vs)
        except ValueError: continue
        f.material_index = p.material_index
        for l, li in zip(f.loops, p.loop_indices): l[uv_lay].uv = huv[li].uv
    bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table(); bm.verts.index_update(); bm.faces.index_update()
    bmesh.ops.remove_doubles(bm, verts=list(vmap.values()), dist=args.weld)
    bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table(); bm.verts.index_update(); bm.faces.index_update()
    comps = components(); Vw = np.array([v.co[:] for v in bm.verts])
    PARTN = {v: k for k, v in PART.items()}
    def comp_parts():
        tag = np.array([v[part_lay] for v in bm.verts])
        return {k: PARTN.get(int(np.bincount(tag[c]).argmax())) for k, c in enumerate(comps)}
    comp_part = comp_parts()
    for o in new: bpy.data.objects.remove(o, do_unlink=True)
    P(f'[mh] head from {os.path.basename(HEAD_FBX)}: skin slot {skin_slot} ({counts[skin_slot]} faces), eyes {eye_slots}, teeth {teeth_slot}, lashes {lash_slot}; {len(vmap)} verts appended; bones folded via its armature ({len(hparent)} bones)')
deform = bm.verts.layers.deform.verify()
uv_lay = bm.loops.layers.uv.active
vu = np.zeros(len(bm.verts))
for f in bm.faces:
    for l in f.loops: vu[l.vert.index] = l[uv_lay].uv.x
main = comps[0]
lashes_c = None
if head_from_fbx:
    byp = lambda part: [c for k, c in enumerate(comps) if k > 0 and comp_part.get(k) == part]
    head_c = max(byp('skin'), key=len) if byp('skin') else None
    teeth = max(byp('teeth'), key=len) if byp('teeth') else None
    eyes_c = sorted(sorted(byp('eye'), key=len)[-2:], key=lambda c: -Vw[c][:, 0].mean())
    lashes_c = np.concatenate(byp('lashes')) if byp('lashes') else None  # (many strips)
    for f in bm.faces: f.material_index = 0
else:
    # the head: welded to the body (v1) or its own shell overlapping the body's neck (v2) — a big shell on the head tile
    head_c = next((c for c in comps[1:] if len(c) > 5000 and (vu[c] < 1).mean() > 0.9), None)
    mid = [c for c in comps[1:] if 1000 < len(c) < 20000 and (head_c is None or c is not head_c)]
    teeth = max(mid, key=len) if mid else None
    small = sorted([c for c in comps[1:] if 100 <= len(c) <= 1000], key=lambda c: -len(c))
    eyes_c = sorted(small[:2], key=lambda c: -Vw[c][:, 0].mean())  # left (+x) first
P(f'[mh] shells: {len(comps)}; body {len(main)} verts, head {"welded" if head_c is None else str(len(head_c)) + " (separate shell)"}, teeth {len(teeth) if teeth is not None else 0}, eyes {[len(c) for c in eyes_c]}, dropped {len(comps) - 2 - len(eyes_c) - (1 if teeth is not None else 0) - (1 if head_c is not None else 0)} slivers (lashes, eye shells)')
if head_c is not None:
    # v2-style export: the body is cut at the shoulder line and the head shell carries the neck + yoke, but its rim
    # no longer meets the (re-cut) body's rim (2 cm higher, ~5 cm wider here). Fit the yoke rim onto the body rim by
    # angle round the torso, carry the offsets into the yoke with a falloff, weld the rims -> the v1 (welded) case.
    is_b = lambda i: any(e.is_boundary for e in bm.verts[int(i)].link_edges)
    brim = np.array([int(i) for i in main if is_b(i) and Vw[i, 2] > Vw[main, 2].max() - 0.15])
    hz0 = Vw[head_c, 2].min()
    hrim = np.array([int(i) for i in head_c if is_b(i) and Vw[i, 2] < hz0 + 0.12])
    def walk(rim):
        """the boundary loop in order, from the front-centre vertex, going toward +x first; (positions, arc fraction)"""
        rs = set(int(i) for i in rim); start = int(rim[np.argmin(Vw[rim, 1])])
        loop = [start]; prev = None; cur = start
        while True:
            nxt = [e.other_vert(bm.verts[cur]).index for e in bm.verts[cur].link_edges if e.is_boundary and e.other_vert(bm.verts[cur]).index in rs and e.other_vert(bm.verts[cur]).index != prev]
            if not nxt: break
            if prev is None: nxt.sort(key=lambda j: -Vw[j, 0])
            prev, cur = cur, nxt[0]
            if cur == start or cur in loop: break
            loop.append(cur)
        Pl = Vw[loop]; seg = np.linalg.norm(np.diff(np.r_[Pl, Pl[:1]], axis=0), axis=1)
        t = np.r_[0, np.cumsum(seg)[:-1]] / seg.sum()
        return np.array(loop), Pl, t

    lb, Pb, tb = walk(brim); lh, Ph, th = walk(hrim)
    tb2 = np.r_[tb, 1.0]; Pb2 = np.r_[Pb, Pb[:1]]
    off = np.zeros((len(lh), 3))
    for k in range(len(lh)):
        off[k] = np.array([np.interp(th[k], tb2, Pb2[:, a_]) for a_ in range(3)]) - Ph[k]
    hrim = lh
    P(f'[mh] neck loops: body start {np.round(Pb[0], 3)} dir {np.round(Pb[1] - Pb[0], 3)}, head start {np.round(Ph[0], 3)} dir {np.round(Ph[1] - Ph[0], 3)}; |offset| along the loop (cm): {np.round(np.linalg.norm(off, axis=1)[::6] * 100, 1).tolist()}')
    sm = lambda a_, b_, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a_) / (b_ - a_), 0, 1))
    # a global similarity (Procrustes: scale, rotation, translation) takes the yoke onto the body rim smoothly; the
    # small residuals are applied with a short falloff so the rim lands exactly
    Tb = Ph + off; mh_, mb_ = Ph.mean(0), Tb.mean(0); X, Y = Ph - mh_, Tb - mb_
    U, S_, Vt = np.linalg.svd(X.T @ Y); D = np.eye(3); D[2, 2] = np.sign(np.linalg.det(U @ Vt))
    R = (U @ D @ Vt).T; sc = (S_ * np.diag(D)).sum() / (X ** 2).sum()
    fit = lambda p_: sc * (R @ (p_ - mh_)) + mb_
    resid = Tb - np.array([fit(p_) for p_ in Ph])
    P(f'[mh] neck fit: scale {sc:.3f}, residual after the similarity {np.linalg.norm(resid, axis=1).mean() * 100:.2f} cm mean / {np.linalg.norm(resid, axis=1).max() * 100:.2f} max')
    moved = 0
    for i in head_c:
        d = np.linalg.norm(Ph - Vw[i], axis=1); k = int(np.argmin(d)); w = 1 - sm(0.0, 0.11, d[k]); w2 = 1 - sm(0.0, 0.03, d[k])
        if w < 1e-3: continue
        Vw[i] = Vw[i] + w * (fit(Vw[i]) - Vw[i]) + w2 * resid[k]; bm.verts[int(i)].co = Vw[i]; moved += 1
    bmesh.ops.remove_doubles(bm, verts=[bm.verts[int(i)] for i in np.r_[brim, hrim]], dist=0.004)
    bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table(); bm.verts.index_update(); bm.faces.index_update()
    P(f'[mh] neck: yoke rim ({len(hrim)} verts) fitted onto the body rim ({len(brim)} verts): mean offset {np.linalg.norm(off, axis=1).mean() * 100:.1f} cm (max {np.linalg.norm(off, axis=1).max() * 100:.1f}), {moved} yoke verts moved, rims welded')
    comps = components(); Vw = np.array([v.co[:] for v in bm.verts]); main = comps[0]
    vu = np.zeros(len(bm.verts))
    for f in bm.faces:
        for l in f.loops: vu[l.vert.index] = l[uv_lay].uv.x
    if head_from_fbx:
        comp_part = comp_parts()
        teeth = max(byp('teeth'), key=len) if byp('teeth') else None
        eyes_c = sorted(sorted(byp('eye'), key=len)[-2:], key=lambda c_: -Vw[c_][:, 0].mean())
        lashes_c = np.concatenate(byp('lashes')) if byp('lashes') else None
    else:
        mid = [c_ for c_ in comps[1:] if 1000 < len(c_) < 20000]; teeth = max(mid, key=len) if mid else None
        small = sorted([c_ for c_ in comps[1:] if 100 <= len(c_) <= 1000], key=lambda c_: -len(c_))
        eyes_c = sorted(small[:2], key=lambda c_: -Vw[c_][:, 0].mean())
    P(f'[mh] shells after the weld: {len(comps)}; body+head {len(main)} verts, teeth {len(teeth) if teeth is not None else 0}, eyes {[len(c_) for c_ in eyes_c]}')
def extract(name, vidx):
    """a new mesh object from a shell of the welded bmesh: verts, faces, UVs, vertex groups (original names)"""
    vset = set(int(i) for i in vidx); remap = {int(i): k for k, i in enumerate(vidx)}
    faces = [f for f in bm.faces if all(v.index in vset for v in f.verts)]
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(Vw[i]) for i in vidx], [], [[remap[v.index] for v in f.verts] for f in faces])
    me.update()
    uv = me.uv_layers.new(name='UVMap')
    li = 0
    for f in faces:
        for l in f.loops:
            uv.data[li].uv = l[uv_lay].uv; li += 1
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    for gname in group_names: ob.vertex_groups.new(name=gname)
    for i in vidx:
        dv = bm.verts[int(i)][deform]
        for gi, w in dv.items():
            if w > 1e-5: ob.vertex_groups[gi].add([remap[int(i)]], float(w), 'REPLACE')
    for p in me.polygons: p.use_smooth = True
    return ob


body = extract('Body', main)
eyes = [extract('EyeL', eyes_c[0]), extract('EyeR', eyes_c[1])] if len(eyes_c) == 2 else []
teeth_ob = extract('Teeth', teeth) if teeth is not None else None
lashes_ob = extract('Lashes', lashes_c) if lashes_c is not None else None
bm.free()
bpy.data.objects.remove(src_mesh, do_unlink=True)
parts = [body] + eyes + ([teeth_ob] if teeth_ob else []) + ([lashes_ob] if lashes_ob else [])


def open_eyes(up_deg=19.0, down_deg=13.0):
    """David's FullBody export has the eyelids shut in its bind pose (the Head FBX basis is open-eyed, but it is a
    different LOD, so no delta transfer). Until the source is re-exported neutral, the lids are opened here: the lid
    skin in front of each eyeball rotates about the eyeball centre (upper lid up, lower lid down, fading out toward the
    socket rim and the corners), so it keeps wrapping the sphere. The upper margin ends ~4 mm above the pupil (the lid
    covers the top of the iris, not a stare). The lid margins are marked in the '_lash' vertex group for the texture pass."""
    lash = body.vertex_groups.new(name='_lash')
    if not eyes or args.keep_lids or head_from_fbx:
        P('[mh] eyelids: left as exported' + (' (open-eyed Head FBX)' if head_from_fbx else '')); return
    Vb = np.array([v.co[:] for v in body.data.vertices])
    sm = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0, 1))
    for e in eyes:
        E = np.array([v.co[:] for v in e.data.vertices]); c = E.mean(0); r = np.linalg.norm(E - c, axis=1).mean()
        rel = Vb - c; d = np.linalg.norm(rel, axis=1)
        on_axis = (np.hypot(rel[:, 0], rel[:, 2]) < 0.006) & (rel[:, 1] < -r + 0.003)
        if on_axis.sum() < 20:
            P(f'[mh] {e.name}: lids already open ({int(on_axis.sum())} skin verts in front of the pupil)'); continue
        region = (d < 0.026) & (rel[:, 1] < -0.004)
        zl = np.median(Vb[region & (np.abs(rel[:, 2]) < 0.004), 2]) if region.any() else c[2]
        lateral = 1 - sm(0.009, 0.016, np.abs(rel[:, 0]))
        up = (Vb[:, 2] >= zl) & region; dn = (Vb[:, 2] < zl) & region
        a = np.zeros(len(Vb))
        a[up] = math.radians(up_deg) * (1 - sm(0.0, 0.016, Vb[up, 2] - zl)) * lateral[up]
        a[dn] = -math.radians(down_deg) * (1 - sm(0.0, 0.011, zl - Vb[dn, 2])) * lateral[dn]
        idx = np.where(a != 0)[0]
        amax = np.abs(a).max()
        for i in idx:  # the margin: the most-rotated verts (upper lid strongest: the lashes)
            lw = float(np.clip((abs(a[i]) / amax - 0.6) / 0.4, 0, 1)) * (1.0 if a[i] > 0 else 0.5)
            if lw > 0.02: lash.add([int(i)], lw, 'REPLACE')
        dy, dz = rel[idx, 1], rel[idx, 2]; ca, sa = np.cos(a[idx]), np.sin(a[idx])
        Vb[idx, 1] = c[1] + dy * ca + dz * sa; Vb[idx, 2] = c[2] - dy * sa + dz * ca
        P(f'[mh] {e.name}: lids opened ({len(idx)} verts rotated, margin z {zl:.4f}, eyeball r {r * 1000:.1f} mm)')
    for i, v in enumerate(body.data.vertices): v.co = Vb[i]
    body.data.update()


open_eyes()

# ---------------------------------------------------------------- 2. fold the MetaHuman bones onto our 21
MAP = {'pelvis': 'hips', 'spine_01': 'hips', 'spine_02': 'spine', 'spine_03': 'spine', 'spine_04': 'chest', 'spine_05': 'chest',
       'neck_01': 'neck', 'neck_02': 'head', 'head': 'head'}
for s, S in (('l', 'L'), ('r', 'R')):
    MAP.update({f'clavicle_{s}': 'clav' + S, f'upperarm_{s}': 'upper' + S, f'lowerarm_{s}': 'fore' + S, f'hand_{s}': 'hand' + S,
                f'thigh_{s}': 'thigh' + S, f'calf_{s}': 'shin' + S, f'foot_{s}': 'foot' + S, f'ball_{s}': 'toe' + S})
# (our hips bone spans 1.046..1.193 m on this body, spine 1.193..1.389, chest 1.389..1.614, neck 1.614..1.712, head above:
#  the MetaHuman bones are assigned to the segment their head sits in)


def fold(n):
    while n is not None and n not in MAP: n = bone_parent.get(n)
    return MAP.get(n, 'hips')


FOLD = {g: fold(g) for g in group_names}
unfolded = [g for g in group_names if g not in MAP and bone_parent.get(g) is None]
P('[mh] bone fold:', {ours: sum(1 for g in group_names if FOLD[g] == ours) for ours in BONES}, 'root-only:', unfolded)


def read_weights(ob, folded=True):
    NV = len(ob.data.vertices); W = np.zeros((NV, len(BONES)))
    gi = {g.index: g.name for g in ob.vertex_groups}
    for vi, v in enumerate(ob.data.vertices):
        for g in v.groups:
            n = gi[g.group]; ours = FOLD.get(n, n) if folded else n
            if ours in B: W[vi, B[ours]] += g.weight
    return W


def write_weights(ob, W):
    for g in list(ob.vertex_groups):
        if not g.name.startswith('_'): ob.vertex_groups.remove(g)
    for bi, n in enumerate(BONES):
        g = ob.vertex_groups.new(name=n)
        for vi in np.where(W[:, bi] > 1e-4)[0]: g.add([int(vi)], float(W[vi, bi]), 'REPLACE')


for ob in parts:
    W = read_weights(ob)
    ws = W.sum(1, keepdims=True)
    if ob is not body:  # eyes/teeth ride with the head whatever Unreal weighted them to (facial bones are not in this FBX)
        W[:] = 0; W[:, B['head']] = 1; ws = np.ones_like(ws)
    P(f'[mh] {ob.name}: {len(W)} verts, unweighted {int((ws[:, 0] == 0).sum())}, weight sum range [{ws.min():.4f}, {ws.max():.4f}]')
    ws[ws == 0] = 1; W /= ws
    write_weights(ob, W)

# ---------------------------------------------------------------- 3. UDIM split: head faces (u < 1) -> slot 0, body faces (u >= 1) -> slot 1 shifted
uv = body.data.uv_layers.active.data
head_face = np.array([uv[p.loop_start].uv.x < 1.0 for p in body.data.polygons])
for p, hf in zip(body.data.polygons, head_face):
    p.material_index = 0 if hf else 1
    if not hf:
        for li in p.loop_indices: uv[li].uv.x -= 1.0
headv = np.zeros(len(body.data.vertices), bool)
for p, hf in zip(body.data.polygons, head_face):
    if hf: headv[list(p.vertices)] = True
tri_head0 = int(head_face.sum()); tri_body0 = int((~head_face).sum())
P(f'[mh] UDIM: head tile {tri_head0} tris, body tile {tri_body0} tris')


# ---------------------------------------------------------------- 3b. the Unreal hair-card grooms, wrapped onto this head through the shared MetaHuman head UV layout
GROOMS = args.grooms if args.grooms else os.path.join(os.path.dirname(os.path.abspath(args.fbx)), '..', 'grooms')
groom_objs = []  # (object, lod)
if GROOMS != 'none' and os.path.isdir(GROOMS):
    import mh_groom_transfer
    groom_objs = mh_groom_transfer.transfer(GROOMS, body, eyes, scene, P)
    for o, lod in groom_objs:  # the cards ride the head bone
        Wg = np.zeros((len(o.data.vertices), len(BONES))); Wg[:, B['head']] = 1; write_weights(o, Wg)
    parts += [o for o, lod in groom_objs]

# ---------------------------------------------------------------- 4. decimate: body region then head region (weight 0 protects)
def decimate(ob, ratio, group=None):
    if ratio >= 0.999: return
    dm = ob.modifiers.new('Decimate', 'DECIMATE'); dm.ratio = ratio; dm.use_symmetry = True; dm.symmetry_axis = 'X'; dm.use_collapse_triangulate = True
    if group: dm.vertex_group = group; dm.vertex_group_factor = 1.0
    with bpy.context.temp_override(active_object=ob, selected_objects=[ob], object=ob):
        bpy.ops.object.modifier_apply(modifier='Decimate')


def tris(ob): return sum(len(p.vertices) - 2 for p in ob.data.polygons)


head_budget = int(args.tris * args.head_share); body_budget = args.tris - head_budget
g = body.vertex_groups.new(name='_dec'); g.add([int(i) for i in np.where(~headv)[0]], 1.0, 'REPLACE'); g.add([int(i) for i in np.where(headv)[0]], 0.0, 'REPLACE')
decimate(body, min(1.0, (tri_head0 + body_budget) / (tri_head0 + tri_body0)), '_dec')
t1 = tris(body)
# flip the mask (the group survived the decimate, interpolated: re-threshold it)
gi = body.vertex_groups['_dec'].index
for v in body.data.vertices:
    w = next((g.weight for g in v.groups if g.group == gi), 0.0)
    body.vertex_groups['_dec'].add([v.index], 1.0 - w, 'REPLACE')
decimate(body, min(1.0, (body_budget + head_budget) / t1), '_dec')
body.vertex_groups.remove(body.vertex_groups['_dec'])
if teeth_ob: decimate(teeth_ob, min(1.0, args.teeth_tris / max(1, tris(teeth_ob))))
for e in eyes: decimate(e, min(1.0, 760 / max(1, tris(e))))
head_face = np.array([p.material_index == 0 for p in body.data.polygons])
P(f'[mh] decimated: body {tris(body)} tris (head region {int(head_face.sum())}, body region {int((~head_face).sum())}), eyes {[tris(e) for e in eyes]}, teeth {tris(teeth_ob) if teeth_ob else 0}; total {sum(tris(o) for o in parts)}')

# re-read the interpolated weights
Wp = {}
for ob in parts:
    W = read_weights(ob, folded=False); ws = W.sum(1, keepdims=True); ws[ws == 0] = 1; W /= ws; Wp[ob.name] = W

# ---------------------------------------------------------------- 5. source joints (Blender z-up, -Y forward) and our bind
V0 = np.array([v.co[:] for v in body.data.vertices])
Hs = V0[:, 2].max() - V0[:, 2].min()
d = skel.body_dims(*args.build)
off = skel.bind_offsets(d); pos = skel.bind_positions(off); tails = skel.leaf_tails(d, pos)
tgt = {n: np.array(to_blender(pos[B[n]])) for n in BONES}
tgt['headtip'] = np.array(to_blender(tails['head']))
for side in 'LR':
    tgt['handtip' + side] = np.array(to_blender(tails['hand' + side])); tgt['toetip' + side] = np.array(to_blender(tails['toe' + side]))


def bh(n): return bones_world[n][0].copy()


# the torso: same height (1.957 m MetaHuman vs our H for the build) -> the torso joints are taken at OUR heights on the
# MetaHuman's spine line (its fore/aft position interpolated along pelvis..head), so the torso is not stretched at all;
# limbs come from the MetaHuman joints (the mesh must bend at its own elbows and knees)
chain = [bh(n) for n in ('pelvis', 'spine_01', 'spine_02', 'spine_03', 'spine_04', 'spine_05', 'neck_01', 'neck_02', 'head')]
chain.append(np.array([0, bh('head')[1], V0[:, 2].max()]))
cz = np.array([c[2] for c in chain]); cy = np.array([c[1] for c in chain])
src = {}
for n in ('hips', 'spine', 'chest', 'neck', 'head'):
    z = tgt[n][2] * Hs / d['H']
    src[n] = np.array([0.0, float(np.interp(z, cz, cy)), z])
src['headtip'] = np.array([0.0, float(np.interp(V0[:, 2].max(), cz, cy)), V0[:, 2].max()])
for s, S in (('l', 'L'), ('r', 'R')):
    src['upper' + S] = bh(f'upperarm_{s}'); src['fore' + S] = bh(f'lowerarm_{s}'); src['hand' + S] = bh(f'hand_{s}')
    m2, m3 = bh(f'middle_02_{s}'), bh(f'middle_03_{s}')
    src['handtip' + S] = m3 + (m3 - m2) * 0.8
    src['shin' + S] = bh(f'calf_{s}')
    # the ankle: the MetaHuman's, lowered to our ankle height (its joint sits 2 cm higher in the heel than ours)
    src['foot' + S] = np.array([bh(f'foot_{s}')[0], bh(f'foot_{s}')[1], tgt['foot' + S][2] * Hs / d['H']])
# floor at z = 0, x centred, and the torso's mean fore/aft at ours
zmin = V0[:, 2].min(); xmid = (V0[:, 0].min() + V0[:, 0].max()) / 2
dy = float(np.mean([tgt[n][1] - src[n][1] for n in ('hips', 'spine', 'chest', 'neck', 'head')]))
shift = np.array([-xmid, dy, -zmin])
for k in src: src[k] = src[k] + shift
for ob in parts:
    for v in ob.data.vertices: v.co = Vector(np.array(v.co[:]) + shift)
ax = src['handL'] - src['upperL']
P(f'[mh] source H {Hs:.4f} m, A-pose arm {math.degrees(math.atan2(abs(ax[0]), abs(ax[2]))):.1f} deg from vertical, torso y shift {dy * 100:.1f} cm')

CHILD = {n: [BONES[i] for i in range(len(BONES)) if PARENT[i] >= 0 and BONES[PARENT[i]] == n] for n in BONES}


def tail_of(j, n):
    if n == 'head': return j['headtip']
    if n.startswith('hand'): return j['handtip' + n[-1]]
    if n.startswith('toe'): return j['toetip' + n[-1]]
    if n == 'chest': return j['neck']
    if n == 'hips': return j['spine']
    return j[CHILD[n][0]]


def rot_between(a, b):
    """the minimal rotation taking unit a onto unit b (3x3)"""
    v = np.cross(a, b); c = float(a @ b)
    if np.linalg.norm(v) < 1e-9: return np.eye(3) if c > 0 else -np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1 / (1 + c))


k_cross = d['H'] / Hs
A = {}


def affine(n, rigid=False):
    """source bone frame -> target bone frame: minimal rotation, stretch Lt/Ls along the source bone, k_cross across
    (rigid: translation only — the feet keep their shape, our toe joint sits 5 cm beyond the MetaHuman's ball joint)"""
    hs, ts = src[n], tail_of(src, n); ht, tt = tgt[n], tail_of(tgt, n)
    if rigid:
        R = np.eye(3); S = k_cross * np.eye(3)
    else:
        a = ts - hs; Ls = np.linalg.norm(a); a /= Ls
        b = tt - ht; Lt = np.linalg.norm(b); b /= Lt
        S = k_cross * np.eye(3) + (Lt / Ls - k_cross) * np.outer(a, a)
        R = rot_between(a, b)
    Mx = np.eye(4); Mx[:3, :3] = R @ S; Mx[:3, 3] = ht - (R @ S) @ hs
    return Mx


def pull_back(parent, n):
    """the source joint that the parent's affine carries exactly onto our joint (no shear in the blend zone: the
    stretch is spread along the child bone instead)"""
    return (np.linalg.inv(A[parent]) @ np.r_[tgt[n], 1])[:3]


for n in ('hips', 'spine', 'chest', 'neck', 'head'): A[n] = affine(n)
for S in 'LR':
    src['clav' + S] = pull_back('chest', 'clav' + S); A['clav' + S] = affine('clav' + S)
    src['thigh' + S] = pull_back('hips', 'thigh' + S); A['thigh' + S] = affine('thigh' + S)
    for n in ('upper', 'fore', 'hand', 'shin'): A[n + S] = affine(n + S)
    src['toe' + S] = src['foot' + S] + (tgt['toe' + S] - tgt['foot' + S]) / k_cross
    src['toetip' + S] = src['toe' + S] + (tgt['toetip' + S] - tgt['toe' + S]) / k_cross
    A['foot' + S] = affine('foot' + S, rigid=True); A['toe' + S] = affine('toe' + S, rigid=True)
for ob in parts:
    V = np.array([v.co[:] for v in ob.data.vertices]); W = Wp[ob.name]
    Vh = np.c_[V, np.ones(len(V))]; V2 = np.zeros_like(V)
    for n in BONES: V2 += W[:, [B[n]]] * (Vh @ A[n].T)[:, :3]
    for i, v in enumerate(ob.data.vertices): v.co = V2[i]
    ob.data.update()
V = np.array([v.co[:] for v in body.data.vertices])
P(f'[mh] retargeted: height {V[:, 2].max() - V[:, 2].min():.4f} (target {d["H"]:.4f}), feet z {V[:, 2].min():.4f}, hand tip x {V[:, 0].max():.3f} (target {tgt["handtipL"][0]:.3f})')
for n in ('hips', 'spine', 'chest', 'neck', 'head', 'clavL', 'upperL', 'foreL', 'handL', 'thighL', 'shinL', 'footL', 'toeL'):
    P(f'[mh]   joint {n:7s} MetaHuman {np.round(src[n], 3)} -> ours {np.round(tgt[n], 3)}  ({np.linalg.norm(src[n] - tgt[n]) * 100:.1f} cm moved)')

# ---------------------------------------------------------------- 6. our armature at the bind
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
for ob in parts:
    ob.parent = rig
    mod = ob.modifiers.new('Armature', 'ARMATURE'); mod.object = rig

# ---------------------------------------------------------------- 7. textures: basecolor, ORM from SRMF, normals; beard/brow/scalp bake into the head basecolor
maps = {os.path.splitext(f)[0].lower(): os.path.join(args.maps, f) for f in os.listdir(args.maps)}


def have(k): return maps.get(k.lower())


# zones on the head (vertex colour -> baked to the head tile): beard, brows, scalp. Calibrated from the eyes.
eye_c = np.mean([np.array([v.co[:] for v in e.data.vertices]).mean(0) for e in eyes], axis=0) if eyes else np.array([0, -0.09, V[:, 2].max() - 0.106])
z_eye = eye_c[2]; z_top = V[:, 2].max()
headv = np.zeros(len(V), bool)
for p in body.data.polygons:
    if p.material_index == 0: headv[list(p.vertices)] = True
hv = V[headv]
y_front, y_back = hv[:, 1].min(), hv[hv[:, 2] > z_eye - 0.05][:, 1].max()
smooth = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0, 1))
fy = np.clip((V[:, 1] - y_front) / (y_back - y_front), 0, 1)
dz = V[:, 2] - z_eye; ax_ = np.abs(V[:, 0])
front = headv & (fy < 0.5)
# (MetaHuman head, from the eyes: nose base -4 cm, mouth -7 cm, chin -13.5 cm, under-jaw -16 cm, ears at |x| 0.07.
#  A short full beard like the sheet's: chin + jawline + cheeks up to the cheekbone, fading to the sideburns)
chin = front & (dz < -0.085) & (dz > -0.19)
w_chin = chin * smooth(-0.168, -0.148, dz)  # (fades out under the jaw)
cheek = headv & (ax_ > 0.035) & (dz < -0.02) & (dz > -0.19) & (fy < 0.62)
w_cheek = cheek * smooth(-0.03, -0.062, dz) * (1 - smooth(0.45, 0.62, fy)) * smooth(-0.168, -0.148, dz)
burn = headv & (ax_ > 0.06) & (dz > -0.05) & (dz < 0.012) & (fy > 0.44) & (fy < 0.56)
w_burn = burn * 0.9 * (1 - smooth(-0.01, 0.012, dz))
stache = front & (dz < -0.053) & (dz > -0.075) & (ax_ < 0.045)
lips = front & (dz < -0.058) & (dz > -0.088) & (ax_ < 0.03) & (fy < 0.12)
beard = np.maximum.reduce([w_chin, w_cheek, w_burn, stache * 0.9]) * (1 - lips)
brow = (front & (dz > 0.008) & (dz < 0.02) & (ax_ > 0.014) & (ax_ < 0.050) & (fy < 0.3)) * 0.6


def hairline(p):
    fyp = np.clip((p[:, 1] - y_front) / (y_back - y_front), 0, 1)
    side = np.clip(np.abs(p[:, 0]) / 0.07, 0, 1)
    front_z = z_eye + 0.058 - 0.045 * side ** 1.5
    back_z = z_eye - 0.025
    return np.where(fyp < 0.4, front_z, np.where(fyp < 0.72, front_z + (back_z - front_z) * smooth(0.4, 0.72, fyp), back_z))


# the scalp tint: a skin fade from the ear line (light) up to the curl line (full) — the curl line matches mh_groom.py
side_ = np.clip(ax_ / 0.07, 0, 1); ear_line = z_eye + 0.01
front_z = z_eye + 0.065 - 0.012 * side_ ** 2; side_z = ear_line + 0.04; back_z = z_eye + 0.035
curl_line = np.where(fy < 0.42, np.maximum(front_z, side_z * side_ ** 1.5 + front_z * (1 - side_ ** 1.5)), np.where(fy < 0.7, side_z + (back_z - side_z) * smooth(0.35, 0.7, fy), back_z))
curl_line = np.where(side_ > 0.85, np.minimum(curl_line, side_z + 0.01), curl_line)
curl_line = curl_line + 0.006 * np.sin(V[:, 0] * 260) * np.cos(V[:, 1] * 210 + 0.8); front_z = front_z + 0.006 * np.sin(V[:, 0] * 260) * np.cos(V[:, 1] * 210 + 0.8)
front_fade = smooth(front_z - 0.004, front_z + 0.008, V[:, 2]); side_fade = 0.25 + 0.75 * smooth(ear_line - 0.005, curl_line, V[:, 2])
sidew = np.maximum(smooth(0.05, 0.068, ax_), smooth(0.55, 0.7, fy))  # (the fade lives beside/behind the temples; the forehead keeps the hairline)
fade = front_fade * (1 - sidew) + side_fade * sidew
scalp = headv * np.clip(fade, 0, 1)
zones = np.zeros((len(V), 4), np.float32)
zones[:, 0] = beard; zones[:, 1] = brow; zones[:, 2] = scalp
if '_lash' in body.vertex_groups:
    gl = body.vertex_groups['_lash'].index
    for v in body.data.vertices:
        for g in v.groups:
            if g.group == gl: zones[v.index, 3] = g.weight
    body.vertex_groups.remove(body.vertex_groups['_lash'])
col = body.data.color_attributes.new('zones', 'FLOAT_COLOR', 'POINT')
for i in range(len(V)): col.data[i].color = zones[i]
P(f'[mh] zones: eye z {z_eye:.3f}, head top {z_top:.3f}, beard verts {int((beard > 0).sum())}, brow {int(brow.sum())}, scalp {int(scalp.sum())}')


def dump_head_zones(path):
    """the head faces with their UVs and per-corner zone values, for mh_textures.py to rasterise (painter's order:
    the mouth/eye-socket cavity faces first, outward skin last — the cavity islands overlap the scalp in UV space;
    the eye-corner slivers with full-tile islands are left out)"""
    uvb = body.data.uv_layers.active.data
    hc = np.array([0, eye_c[1] + 0.07, z_eye])
    tri_uv, tri_zone, inward = [], [], []
    for p in body.data.polygons:
        if p.material_index != 0: continue
        q = np.array([uvb[l].uv[:] for l in p.loop_indices])
        if abs((q[1, 0] - q[0, 0]) * (q[2, 1] - q[0, 1]) - (q[2, 0] - q[0, 0]) * (q[1, 1] - q[0, 1])) / 2 > 0.002 or np.ptp(q, axis=0).max() > 0.06: continue
        tri_uv.append(q); tri_zone.append(zones[list(p.vertices), :4]); inward.append(float(np.dot(p.normal, V[list(p.vertices)].mean(0) - hc)))
    np.savez(path, tri_uv=np.array(tri_uv, np.float32), tri_zone=np.array(tri_zone, np.float32), outward=np.array(inward, np.float32))
    P(f'[mh] head zones: {len(tri_uv)} faces -> {path}')


dump_head_zones(os.path.join(args.work, 'head_zones.npz'))

# the PIL pass (system python): tinted head basecolor, body basecolor, ORM from SRMF, normals copied
srmf_note = subprocess.run(['python3', os.path.join(HERE, 'mh_textures.py'), '--maps', args.maps, '--work', args.work, '--out', TEX] + (['--grooms', GROOMS] if groom_objs else []), check=True, capture_output=True, text=True).stdout
P(srmf_note.strip())


def tex(name):
    """a texture in TEX by base name, .jpg or .png"""
    for ext in ('.jpg', '.png'):
        if os.path.exists(os.path.join(TEX, name + ext)): return os.path.join(TEX, name + ext)
    return None


def material(name, albedo, orm=None, normal=None, nstrength=1.0, rough=0.5):
    mat = bpy.data.materials.new(name); mat.use_nodes = True
    nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
    ta = nt.nodes.new('ShaderNodeTexImage'); ta.image = bpy.data.images.load(tex(albedo), check_existing=True); ta.image.pack()
    nt.links.new(ta.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    if orm and tex(orm):
        to = nt.nodes.new('ShaderNodeTexImage'); to.image = bpy.data.images.load(tex(orm), check_existing=True); to.image.pack(); to.image.colorspace_settings.name = 'Non-Color'
        sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(to.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness']); nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    if normal and tex(normal):
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = bpy.data.images.load(tex(normal), check_existing=True); tn.image.pack(); tn.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = nstrength
        nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


assert len(body.data.materials) == 0  # (materials.clear() would reset every polygon's material index: slot 0 = head, 1 = body)
body.data.materials.append(material('MH_Head', 'mh_head_albedo', 'mh_head_orm', 'mh_head_normal'))
body.data.materials.append(material('MH_Body', 'mh_body_albedo', 'mh_body_orm', 'mh_body_normal'))
if eyes and tex('mh_eye_albedo'):
    em = material('MH_Eye', 'mh_eye_albedo', None, 'mh_eye_normal', rough=0.1)  # (the wet look: roughness 0.1, specular 0.9, no metallic)
    em.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = 0.9
    for e in eyes: e.data.materials.clear(); e.data.materials.append(em)
def groom_material(name, texname, cutoff=0.35):
    """dark base x coverage from the Attribute atlas (R), alpha-scissor 0.4 (a Math node on the alpha link makes the glTF
    exporter write alphaMode MASK), roughness 0.75, no specular blob, double-sided"""
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; bsdf = nt.nodes['Principled BSDF']
    ta = nt.nodes.new('ShaderNodeTexImage'); ta.image = bpy.data.images.load(tex(texname), check_existing=True); ta.image.pack()
    nt.links.new(ta.outputs['Color'], bsdf.inputs['Base Color'])
    cut = nt.nodes.new('ShaderNodeMath'); cut.operation = 'GREATER_THAN'; cut.inputs[1].default_value = cutoff
    nt.links.new(ta.outputs['Alpha'], cut.inputs[0]); nt.links.new(cut.outputs[0], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = 0.75; bsdf.inputs['Specular IOR Level'].default_value = 0.1
    if hasattr(m, 'surface_render_method'): m.surface_render_method = 'DITHERED'
    m.use_backface_culling = False
    return m


gm = {}
for ob, lod in groom_objs:
    kind = ob.name.replace('Cards', '').replace('LOD0', '').lower()  # hair / beard / brows
    if kind not in gm: gm[kind] = groom_material('Groom' + kind.capitalize(), 'mh_groom_' + kind, 0.35)  # (alpha-scissor 0.35 for all three; Godot imports the atlases without mipmaps, see build_athlete/AthleteDriver)
    ob.data.materials.clear(); ob.data.materials.append(gm[kind])
if lashes_ob:
    lm = bpy.data.materials.new('MH_Lashes'); lm.use_nodes = True; ntl = lm.node_tree; bl = ntl.nodes['Principled BSDF']
    lp = have('Eyelashes_Color')
    if lp:
        tl = ntl.nodes.new('ShaderNodeTexImage'); tl.image = bpy.data.images.load(lp, check_existing=True); tl.image.pack()
        ntl.links.new(tl.outputs['Color'], bl.inputs['Base Color'])
        cl = ntl.nodes.new('ShaderNodeMath'); cl.operation = 'GREATER_THAN'; cl.inputs[1].default_value = 0.3
        ntl.links.new(tl.outputs['Alpha'], cl.inputs[0]); ntl.links.new(cl.outputs[0], bl.inputs['Alpha'])
    else:
        bl.inputs['Base Color'].default_value = (0.02, 0.015, 0.012, 1)
    bl.inputs['Roughness'].default_value = 0.8; bl.inputs['Specular IOR Level'].default_value = 0.1; lm.use_backface_culling = False
    if hasattr(lm, 'surface_render_method'): lm.surface_render_method = 'DITHERED'
    lashes_ob.data.materials.clear(); lashes_ob.data.materials.append(lm)
if teeth_ob:
    if tex('mh_teeth_albedo'):
        tm = material('MH_Teeth', 'mh_teeth_albedo', None, 'mh_teeth_normal', rough=0.3)
    else:
        tm = bpy.data.materials.new('MH_Teeth'); tm.use_nodes = True
        tm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.78, 0.72, 0.66, 1); tm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.35
    teeth_ob.data.materials.clear(); teeth_ob.data.materials.append(tm)

# ---------------------------------------------------------------- 8. save the stage-1 contract, then the kit (build_athlete.py --mh) or the nude export
bpy.context.view_layer.update()
sanity = {}
for ob in parts:
    W = read_weights(ob, folded=False); s = W.sum(1)
    sanity[ob.name] = dict(verts=len(W), tris=tris(ob), unweighted=int((s < 1e-6).sum()), sum_min=float(s.min()), sum_max=float(s.max()), max_influences=int((W > 1e-4).sum(1).max()))
P('[mh] skin sanity:', json.dumps(sanity))
fit = {'build': args.build, 'dims': d, 'Hs': Hs, 'bind': {n: tgt[n].tolist() for n in tgt}, 'src': {n: src[n].tolist() for n in src},
       'tris_in': tri_in, 'verts_in': nv_in, 'tris_body_head': tris(body), 'tris_head_region': int(head_face.sum()), 'tris_body_region': int((~head_face).sum()),
       'tris_eyes': [tris(e) for e in eyes], 'tris_teeth': tris(teeth_ob) if teeth_ob else 0, 'grooms': {o.name: {'lod': lod, 'tris': tris(o)} for o, lod in groom_objs}, 'groom_lod': args.groom_lod, 'sanity': sanity, 'eye_centre': eye_c.tolist(), 'mh': True, 'log': log}
json.dump(fit, open(os.path.join(args.work, 'body_fit.json'), 'w'), indent=1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(args.work, 'body_rigged.blend'))
P('[mh] saved', os.path.join(args.work, 'body_rigged.blend'))
if args.no_kit:
    glb = os.path.join(args.out, 'athlete_mh_body.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_skins=True, export_yup=True, export_apply=True, export_animations=False, export_image_format='AUTO')
    P('[export]', glb, round(os.path.getsize(glb) / 1e6, 2), 'MB')
else:
    cmd = [bpy.app.binary_path, '-b', '--python', os.path.join(HERE, 'build_athlete.py'), '--', '--work', args.work, '--out', args.out, '--mh', '--name', 'athlete_mh']
    P('[mh] stage 2:', ' '.join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    for line in r.stdout.splitlines():
        if line.startswith('['): P(line)
    if r.returncode != 0:
        print(r.stdout[-4000:]); print(r.stderr[-4000:]); sys.exit('stage 2 failed')
    # the textures are embedded in the glb (Godot extracts them beside it on import): keep the loose set in the work dir
    keep = os.path.join(args.work, 'textures'); shutil.rmtree(keep, ignore_errors=True); shutil.move(TEX, keep)
    P('[mh] loose textures moved to', keep)
open(os.path.join(args.work, 'build_log.txt'), 'w').write('\n'.join(log))
