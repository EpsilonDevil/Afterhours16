"""Epic's MetaHuman hair-card grooms onto our head (called by build_metahuman.py, Blender python).

Inputs (David's Unreal export, <grooms>/): hair/, beard/, brows/ each with *_CardsMesh_Group0_LOD{0,1}.fbx (cm, Z-up;
the atlas UV layer is the one with the largest face UV span: 'LightMapUV' for hair/beard and brows LOD1, 'UVmap_0' for brows LOD0 — the hair's 'UVmap_1' is a constant and brows LOD0's 'LightMapUV' a real lightmap) and *_CardsAtlas_Attribute.png
(LAYOUT2: R = strand coverage = the alpha, G/B = per-strand depth/attribute ramps, A unused = 255; the 512² Tangent
atlas and the helmet-space RootUVSeedCoverage / ColorXYDepthGroupID maps are not used here), plus
SKM_Groom_Head_Legacy02.fbx, the archetype head the cards were authored on (full LOD0 head: slot 0 = skin).

Transfer: the archetype head and our full-body head shell are different LODs of the same MetaHuman head, so there is
no vertex correspondence, but every MetaHuman head shares one UV layout across LODs and characters. Each card vertex is
bound to the nearest point of the archetype skin (triangle, barycentric, signed normal offset), that point's UV is
looked up in our head's skin faces (UV-space point-in-triangle), and the card vertex is rebuilt there with the normal
offset scaled by the inter-pupil ratio. Cards are skinned 100% to the head bone by build_metahuman.py.
"""
import bpy, os, glob
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

SETS = {'hair': ('hair', 'Hair_S_AfroFade'), 'beard': ('beard', 'Beard_S_Curly'), 'brows': ('brows', 'Eyebrows_M_FlatThick')}
HELMET = ('hair', 'Hair_S_AfroFade_Helmet_LOD5.fbx')  # the far-LOD cap (967 tris), bound like the hair


def _import_mesh(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    ob = max(meshes, key=lambda o: len(o.data.vertices))
    M = ob.matrix_world.copy()
    for v in ob.data.vertices: v.co = M @ v.co
    for m in list(ob.modifiers): ob.modifiers.remove(m)
    ob.parent = None; ob.matrix_world.identity()
    for o in new:
        if o is not ob: bpy.data.objects.remove(o, do_unlink=True)
    return ob


def _uv_grid(tri_uv, n=256):
    """bins of triangle indices over UV space"""
    grid = {}
    lo = np.floor(tri_uv.min(1) * n).astype(int); hi = np.floor(tri_uv.max(1) * n).astype(int)
    for t in range(len(tri_uv)):
        for gx in range(max(0, lo[t, 0]), min(n - 1, hi[t, 0]) + 1):
            for gy in range(max(0, lo[t, 1]), min(n - 1, hi[t, 1]) + 1):
                grid.setdefault((gx, gy), []).append(t)
    return grid, n


def _bary(p, a, b, c):
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11, d20, d21 = v0 @ v0, v0 @ v1, v1 @ v1, v2 @ v0, v2 @ v1
    den = d00 * d11 - d01 * d01
    if abs(den) < 1e-14: return None
    v = (d11 * d20 - d01 * d21) / den; w = (d00 * d21 - d01 * d20) / den
    return np.array([1 - v - w, v, w])


def transfer(grooms, body, eyes, scene, log):
    # ---- the archetype head (skin faces only)
    arch = _import_mesh(os.path.join(grooms, 'SKM_Groom_Head_Legacy02.fbx'))
    arch.data.calc_loop_triangles()
    AV = np.array([v.co[:] for v in arch.data.vertices])
    auv = arch.data.uv_layers.active.data
    tris, tri_uv, tri_n = [], [], []
    for lt in arch.data.loop_triangles:
        if lt.material_index != 0: continue
        tris.append(list(lt.vertices)); tri_uv.append([auv[l].uv[:] for l in lt.loops])
    tris = np.array(tris); tri_uv = np.array(tri_uv)
    AN = np.array([v.normal[:] for v in arch.data.vertices])
    # archetype pupils (slots 3/4 are the eyeballs)
    eye_a = []
    for slot in (3, 4):
        vs = sorted({vi for p in arch.data.polygons if p.material_index == slot for vi in p.vertices})
        eye_a.append(AV[vs].mean(0))
    ez_a = (eye_a[0][2] + eye_a[1][2]) / 2
    tz = AV[tris].mean(1)[:, 2]
    # one bind surface per groom: the brows must bind to the brow ridge/forehead (their outer ends are nearer the
    # eyelid skin, and a lid-relative offset floats in front of the eye on another head); the beard below the eyes
    def make_bvh(mask):
        idx = np.where(mask)[0]
        return BVHTree.FromPolygons([tuple(v) for v in AV], [tuple(int(i) for i in tris[t]) for t in idx]), idx
    bvhs = {'hair': make_bvh(np.ones(len(tris), bool)), 'brows': make_bvh(tz > ez_a + 0.008), 'beard': make_bvh(tz < ez_a - 0.012)}
    ipd_a = np.linalg.norm(eye_a[0] - eye_a[1])
    ipd_b = np.linalg.norm(np.array([v.co[:] for v in eyes[0].data.vertices]).mean(0) - np.array([v.co[:] for v in eyes[1].data.vertices]).mean(0)) if len(eyes) == 2 else ipd_a
    s_off = ipd_b / ipd_a
    # ---- our head skin faces in UV space
    body.data.calc_loop_triangles()
    BV = np.array([v.co[:] for v in body.data.vertices]); BN = np.array([v.normal[:] for v in body.data.vertices])
    buv = body.data.uv_layers.active.data
    htris, htri_uv = [], []
    eye_c = np.mean([np.array([v.co[:] for v in e.data.vertices]).mean(0) for e in eyes], axis=0) if eyes else BV[BV[:, 2] > BV[:, 2].max() - 0.2].mean(0)
    hc = np.array([0.0, eye_c[1] + 0.07, eye_c[2]])  # (roughly the skull centre)
    skipped = 0
    for lt in body.data.loop_triangles:
        if lt.material_index != 0: continue
        q = np.array([buv[l].uv[:] for l in lt.loops])
        if np.ptp(q, axis=0).max() > 0.06: continue  # (the eye-corner slivers with full-tile islands)
        cen = BV[list(lt.vertices)].mean(0)
        if np.dot(np.array(lt.normal[:]), cen - hc) < 0: skipped += 1; continue  # (eye-socket / mouth-cavity faces: their islands overlap the face in UV space)
        htris.append(list(lt.vertices)); htri_uv.append(q)
    htris = np.array(htris); htri_uv = np.array(htri_uv)
    grid, n = _uv_grid(htri_uv)
    # per-vertex UV of our head (for the fallback: nearest vertex in UV space)
    vuv = np.zeros((len(BV), 2)); has = np.zeros(len(BV), bool)
    for t, q in zip(htris, htri_uv):
        for k in range(3): vuv[t[k]] = q[k]; has[t[k]] = True
    hv_idx = np.where(has)[0]
    log(f'[groom] archetype head {len(AV)} verts / {len(tris)} skin tris, ours {len(htris)} outward skin tris ({skipped} cavity faces skipped); inter-pupil {ipd_a * 100:.2f} -> {ipd_b * 100:.2f} cm (offset scale {s_off:.3f})')

    eye_mid_a = (eye_a[0] + eye_a[1]) / 2
    eye_mid_b = np.mean([np.array([v.co[:] for v in e.data.vertices]).mean(0) for e in eyes], axis=0) if len(eyes) == 2 else eye_mid_a

    def lookup(uv, ref=None):
        """the face containing uv; where several islands overlap (the eyelid-interior islands sit over the side-of-head
        region of the layout), the one whose position relative to the eyes matches the archetype point `ref`"""
        gx, gy = int(uv[0] * n), int(uv[1] * n)
        best = None
        for t in grid.get((gx, gy), []):
            b = _bary(uv, htri_uv[t, 0], htri_uv[t, 1], htri_uv[t, 2])
            if b is None or not (b >= -1e-3).all(): continue
            if ref is None: return t, b
            pos = (np.clip(b, 0, 1)[:, None] * BV[htris[t]]).sum(0)
            err = np.linalg.norm((pos - eye_mid_b) - (ref - eye_mid_a) * s_off)
            if best is None or err < best[0]: best = (err, t, b)
        return (best[1], best[2]) if best else (None, None)

    # archetype skin vertices mapped onto our head (for the fallback: a card vertex whose UV finds no face follows the
    # nearest mapped archetype vertex — never a jump across UV space)
    arch_uv = np.full((len(AV), 2), np.nan)
    for t, q in zip(tris, tri_uv):
        for k in range(3): arch_uv[t[k]] = q[k]
    arch_map = np.full((len(AV), 3), np.nan)
    for i in range(len(AV)):
        if np.isnan(arch_uv[i, 0]): continue
        ht, hb = lookup(arch_uv[i], AV[i])
        if ht is not None: arch_map[i] = (hb[:, None] * BV[htris[ht]]).sum(0)
    mapped = np.where(~np.isnan(arch_map[:, 0]))[0]
    log(f'[groom] archetype skin vertices mapped onto our head: {len(mapped)} of {int((~np.isnan(arch_uv[:, 0])).sum())}')

    out = []
    jobs = [(kind, lod, os.path.join(grooms, sub, f'{stem}_CardsMesh_Group0_LOD{lod}.fbx'), f'{kind.capitalize()}Cards' + ('' if lod == 1 else 'LOD0')) for kind, (sub, stem) in SETS.items() for lod in (0, 1)]
    jobs.append(('helmet', 5, os.path.join(grooms, HELMET[0], HELMET[1]), 'HairHelmet'))
    for kind, lod, path, name in jobs:
        if True:
            if not os.path.exists(path): continue
            ob = _import_mesh(path)
            ob.name = name
            # keep the atlas UV layer only, as 'UVMap': the one with the largest face UV span (the real lightmap layer,
            # when present, packs tiny faces; the hair's 'UVmap_1' is a constant) — hair/beard: 'LightMapUV', brows LOD0: 'UVmap_0'
            def span(l):
                uv = np.array([x.uv[:] for x in l.data]); return float(np.median([np.ptp(uv[list(p.loop_indices)], axis=0).max() for p in list(ob.data.polygons)[::7]]))
            best = max(ob.data.uv_layers, key=span)
            for l in list(ob.data.uv_layers):
                if l.name != best.name: ob.data.uv_layers.remove(l)
            ob.data.uv_layers[0].name = 'UVMap'
            C = np.array([v.co[:] for v in ob.data.vertices]); C2 = np.zeros_like(C); miss = 0
            bvh, bidx = bvhs['hair' if kind == 'helmet' else kind]
            for i, c in enumerate(C):
                loc, nrm, fi, dist = bvh.find_nearest(Vector(c))
                loc = np.array(loc[:]); nrm = np.array(nrm[:]); fi = int(bidx[fi])
                h = float((c - loc) @ nrm)
                t = tris[fi]; b = _bary(loc, AV[t[0]], AV[t[1]], AV[t[2]])
                if b is None: b = np.array([1 / 3, 1 / 3, 1 / 3])
                b = np.clip(b, 0, 1); b /= b.sum()
                uv = (b[:, None] * tri_uv[fi]).sum(0)
                ht, hb = lookup(uv, loc)
                if ht is None:
                    miss += 1
                    j = mapped[np.argmin(((AV[mapped] - loc) ** 2).sum(1))]
                    C2[i] = arch_map[j] + (c - AV[j]) * s_off; continue
                else:
                    tv = htris[ht]; pos = (hb[:, None] * BV[tv]).sum(0); nn = (hb[:, None] * BN[tv]).sum(0); nn /= np.linalg.norm(nn) + 1e-9
                C2[i] = pos + nn * h * s_off
            for i, v in enumerate(ob.data.vertices): v.co = C2[i]
            ob.data.update()
            if kind == 'brows' and eyes:  # (the FlatThick brow tails reach the eye corners on this head: trim what dips to eye level)
                ez = np.mean([np.array([v.co[:] for v in e.data.vertices]).mean(0)[2] for e in eyes])
                import bmesh
                bmb = bmesh.new(); bmb.from_mesh(ob.data); bmb.verts.ensure_lookup_table()
                ex = np.mean([abs(np.array([v.co[:] for v in e.data.vertices]).mean(0)[0]) for e in eyes])
                dead = [f for f in bmb.faces if min(v.co.z for v in f.verts) < ez + 0.006 or max(abs(v.co.x) for v in f.verts) > ex + 0.024]  # (and the long outer tail past the eye corner)
                bmesh.ops.delete(bmb, geom=dead, context='FACES'); bmb.to_mesh(ob.data); bmb.free(); ob.data.update()
                log(f'[groom] {ob.name}: {len(dead)} faces at eye level trimmed')
            for p in ob.data.polygons: p.use_smooth = True
            scene.collection.objects.link(ob) if ob.name not in scene.collection.objects else None
            ntri = sum(len(p.vertices) - 2 for p in ob.data.polygons)
            log(f'[groom] {ob.name}: {len(C)} verts / {ntri} tris wrapped ({miss} UV misses -> nearest head vertex)')
            out.append((ob, lod))
    bpy.data.objects.remove(arch, do_unlink=True)
    return out
