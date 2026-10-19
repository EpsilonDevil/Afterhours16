"""Numbers for a glb: python3 tools/athlete/glb_stats.py <file.glb>  (triangles per mesh, skin weights sanity, images)"""
import sys, json, struct, io
import numpy as np
from PIL import Image

path = sys.argv[1]
b = open(path, 'rb').read()
assert b[:4] == b'glTF'
jl = struct.unpack('<I', b[12:16])[0]; js = json.loads(b[20:20 + jl]); bl = struct.unpack('<I', b[20 + jl:24 + jl])[0]; bin_ = b[28 + jl:28 + jl + bl]
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def acc(i):
    a = js['accessors'][i]; bv = js['bufferViews'][a['bufferView']]; off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = NC[a['type']]; dt = CT[a['componentType']]
    arr = np.frombuffer(bin_, dtype=dt, count=a['count'] * n, offset=off).reshape(a['count'], n)
    if a.get('normalized'): arr = arr.astype(np.float64) / np.iinfo(dt).max
    return arr


tot = 0; verts = 0; rows = []
for m in js['meshes']:
    t = 0; v = 0; bad = []
    for p in m['primitives']:
        idx = acc(p['indices']); t += len(idx) // 3; v += js['accessors'][p['attributes']['POSITION']]['count']
        if 'WEIGHTS_0' in p['attributes']:
            W = acc(p['attributes']['WEIGHTS_0']).astype(np.float64); s = W.sum(1)
            bad.append((int((np.abs(s - 1) > 1e-3).sum()), int((s < 1e-6).sum()), float(s.min()), float(s.max())))
    rows.append((m['name'], v, t, bad)); tot += t; verts += v
print(f'{path}: {len(js["meshes"])} meshes, {verts} verts, {tot} triangles, {len(js.get("materials", []))} materials, {len(js.get("images", []))} images, {len(b) / 1e6:.2f} MB')
for n, v, t, bad in rows:
    print(f'  {n:10s} verts {v:6d} tris {t:6d}' + (f'  weights: sum!=1 {sum(x[0] for x in bad)}, unweighted {sum(x[1] for x in bad)}, sum range [{min(x[2] for x in bad):.4f}, {max(x[3] for x in bad):.4f}]' if bad else ''))
for im in js.get('images', []):
    bv = js['bufferViews'][im['bufferView']]; data = bin_[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
    pi = Image.open(io.BytesIO(data)); print(f'  image {im.get("name", "?"):40s} {pi.size[0]}x{pi.size[1]} {pi.mode} {len(data) / 1e6:.2f} MB')
if 'skins' in js:
    sk = js['skins'][0]; ibm = acc(sk['inverseBindMatrices']).reshape(-1, 4, 4)
    names = [js['nodes'][j]['name'] for j in sk['joints']]
    print('  skin joints:', len(names), names[:5], '...')
    for j, n in enumerate(names):
        M = np.linalg.inv(ibm[j].T); rows.append(None)
    print('  bind positions (glTF y-up):', {n: np.round(np.linalg.inv(ibm[j].T)[:3, 3], 4).tolist() for j, n in enumerate(names) if n in ('hips', 'head', 'handL', 'footL')})
