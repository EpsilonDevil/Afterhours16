"""The MetaHuman athlete's groom (called by build_athlete.py --mh): the Unreal strand grooms are not in the FBX, so the
head gets a card build — a curly top with a skin fade on the sides (tinted scalp only, from the ear line up ~4 cm),
3–4 cm of curl volume on top/crown from alpha cards over a thin matte inner cap, a soft hairline; a short dense beard
card layer along the jaw/chin/cheeks and a brow card pair. Beard/brow zones come from the 'zones' colour attribute
build_metahuman.py wrote on the body (R beard, G brow). All cards are skinned to the nearest body vertex."""
import numpy as np


def build(ctx):
    """ctx: body, V, N, z_eye, z_top, eye_c, y_front, y_back, smooth, new_mesh_object, skin_to_body, rng, print
    returns {'cap': ob, 'hair': ob, 'beard': ob, 'brow': ob}"""
    body, V, N = ctx['body'], ctx['V'], ctx['N']
    z_eye, z_top, y_front, y_back = ctx['z_eye'], ctx['z_top'], ctx['y_front'], ctx['y_back']
    smooth, new_mesh_object, skin_to_body, rng, log = ctx['smooth'], ctx['new_mesh_object'], ctx['skin_to_body'], ctx['rng'], ctx['print']
    head_mask = ctx['head_mask']
    zones = np.zeros((len(V), 4), np.float32)
    ca = body.data.color_attributes.get('zones')
    if ca is not None:
        for i in range(len(V)): zones[i] = ca.data[i].color
    beard_w, brow_w = zones[:, 0], zones[:, 1]
    fy = np.clip((V[:, 1] - y_front) / (y_back - y_front), 0, 1)  # 0 front .. 1 back
    side = np.clip(np.abs(V[:, 0]) / 0.07, 0, 1)

    # the curl line: where the fade ends and the curls start. Front: mid-forehead; sides: ~4 cm above the ear line
    # (ear top ~ z_eye + 0.01); back: a little lower (the crown wraps round)
    ear_line = z_eye + 0.01
    front_z = z_eye + 0.065 - 0.012 * side ** 2
    side_z = ear_line + 0.04
    back_z = z_eye + 0.035
    curl_line = np.where(fy < 0.42, np.maximum(front_z, side_z * side ** 1.5 + front_z * (1 - side ** 1.5)),
                         np.where(fy < 0.7, side_z + (back_z - side_z) * smooth(0.35, 0.7, fy), back_z))
    curl_line = np.where(side > 0.85, np.minimum(curl_line, side_z + 0.01), curl_line)
    curl_line = curl_line + 0.006 * np.sin(V[:, 0] * 260) * np.cos(V[:, 1] * 210 + 0.8)  # (a soft, slightly ragged hairline)
    above = V[:, 2] - curl_line
    curl = head_mask & (above > -0.008)

    # -------- inner cap: the scalp lifted a little (matte, hides the skin between cards), soft edge at the curl line
    idx = np.where(curl)[0]; remap = {vi: i for i, vi in enumerate(idx)}
    hp = V[idx]
    edge = smooth(-0.008, 0.02, above[idx])  # 0 at the line, 1 2 cm in
    lift = (0.002 + 0.010 * smooth(z_eye + 0.045, z_top - 0.03, hp[:, 2])) * edge
    faces = []
    for p in body.data.polygons:
        vs = list(p.vertices)
        if all(vi in remap for vi in vs): faces.append([remap[vi] for vi in vs])
    cap_v = hp + N[idx] * lift[:, None]
    hc = np.array([0, (y_front + y_back) / 2, z_eye + 0.06])
    cap_uv = [(0.5 + np.arctan2(p[0] - hc[0], -(p[1] - hc[1])) / (2 * np.pi), np.clip((p[2] - z_eye) / (z_top + 0.04 - z_eye), 0, 1)) for p in cap_v]
    cap = new_mesh_object('HairCap', cap_v, faces, cap_uv)
    skin_to_body(cap)

    # -------- cards
    def cards(name, picks, size_fn, height_fn, tilt_fn, cross=True, tangent_bias=0.0, lift_z=lambda vi: 0.0):
        verts, uvs, faces = [], [], []
        for vi in picks:
            p, n = V[vi], N[vi]
            n = n / (np.linalg.norm(n) + 1e-9)
            hint = np.array([1.0, 0, 0]) if abs(n[0]) < 0.8 else np.array([0, 1.0, 0])
            t1 = np.cross(n, hint); t1 /= np.linalg.norm(t1); t2 = np.cross(n, t1)
            yaw = rng.uniform(0, 2 * np.pi); u = np.cos(yaw) * t1 + np.sin(yaw) * t2; w_ = np.cross(n, u)
            s = size_fn(vi); h = height_fn(vi); tilt = tilt_fn(vi)
            c = p + n * h + np.array([0, 0, 1.0]) * lift_z(vi)
            # card 1: lies across the surface, tilted up by `tilt` (a shingle); card 2: standing, crossed
            a1 = u * s * 0.5; b1 = (w_ * np.cos(tilt) + n * np.sin(tilt)) * s * 0.5
            pairs = [(a1, b1)]
            if cross:
                a2 = w_ * s * 0.5; b2 = (n * (1 - tangent_bias) + u * tangent_bias) * s * 0.5
                pairs.append((a2, b2))
            for a, b in pairs:
                base = len(verts)
                verts += [c - a - b, c + a - b, c + a + b, c - a + b]
                uvs += [(0, 0), (1, 0), (1, 1), (0, 1)]
                faces.append((base, base + 1, base + 2, base + 3))
        ob = new_mesh_object(name, verts, faces, uvs)
        skin_to_body(ob)
        return ob

    # hair: cards on the curl region, denser and taller on top, short at the line (a soft hairline)
    cand = np.where(curl & (above > -0.004))[0]
    top = lambda vi: smooth(z_eye + 0.045, z_top - 0.025, V[vi, 2])
    # two layers: one close to the scalp on every curl vertex, a second higher one on the top/crown for the volume
    pick = np.r_[cand, cand[np.array([top(vi) for vi in cand]) > 0.35]]
    layer = np.r_[np.zeros(len(cand)), np.ones(len(pick) - len(cand))]
    k_ = {'i': 0}
    def hh(vi):
        L = layer[k_['i']]; k_['i'] += 1
        return (0.003 + 0.012 * top(vi) + L * (0.008 + 0.014 * top(vi))) * smooth(-0.004, 0.02, above[vi]) * rng.uniform(0.7, 1.0)
    near_line = lambda vi: smooth(-0.004, 0.03, above[vi])  # 0 at the hairline .. 1 three cm in
    hair = cards('HairCards', pick,  # (cards at the hairline are small and nudged up so nothing overhangs the forehead)
                 size_fn=lambda vi: (0.02 + 0.012 * top(vi) + rng.uniform(-0.004, 0.004)) * (0.45 + 0.55 * near_line(vi)),
                 height_fn=hh, tilt_fn=lambda vi: rng.uniform(0.2, 0.6), lift_z=lambda vi: 0.008 * (1 - near_line(vi)))
    # beard: short and dense along the jaw, chin, cheeks (the zone weight), lying close to the skin
    cand = np.where((beard_w > 0.2) & head_mask)[0]
    pick = cand[rng.random(len(cand)) < 0.7 * np.clip(beard_w[cand] / 0.7, 0, 1)]
    beard = cards('BeardCards', pick,  # (short fuzz just off the skin: the density comes from the tinted basecolor)
                  size_fn=lambda vi: 0.006 + 0.004 * beard_w[vi] + rng.uniform(-0.001, 0.001),
                  height_fn=lambda vi: 0.001 + 0.0025 * beard_w[vi] * rng.random(),
                  tilt_fn=lambda vi: rng.uniform(0.1, 0.3), tangent_bias=0.6)
    # brows: a card pair along each brow
    cand = np.where((brow_w > 0.35) & head_mask)[0]; cand = cand[rng.random(len(cand)) < 0.4]
    brow = cards('BrowCards', cand, size_fn=lambda vi: 0.006 + rng.uniform(-0.001, 0.001), height_fn=lambda vi: 0.0008,
                 tilt_fn=lambda vi: 0.1, cross=False)
    log(f'[groom] curl region {int(curl.sum())} verts, cap {len(faces)} faces, hair cards {len(hair.data.polygons) // 1}, beard cards {len(beard.data.polygons)}, brow cards {len(brow.data.polygons)}')
    return {'cap': cap, 'hair': hair, 'beard': beard, 'brow': brow}
