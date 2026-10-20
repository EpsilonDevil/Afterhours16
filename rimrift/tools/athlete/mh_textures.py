"""The MetaHuman athlete's textures (PIL + numpy), called by build_metahuman.py:
  python3 tools/athlete/mh_textures.py --maps <MetaHuman Maps dir> --work <dir with head_zones.npz> --out <textures dir>

Writes mh_head_albedo.png (Head_Basecolor with the beard/brow/scalp zones (head_zones.npz, rasterised here) tinted in: the grooms are not in the
FBX), mh_body_albedo.png, mh_{head,body}_orm.png (R = AO 255, G = roughness, B = metallic — from the SRMF maps when
they exist, else a procedural skin roughness with a sweat sheen), mh_{head,body}_normal.png (Unreal's normal maps are
DirectX-style: the green channel is flipped for glTF/Godot), and the eye/teeth maps when the export has them.

SRMF: MetaHuman Creator's packed map, R = Specular, G = Roughness, M = Metallic, (A = an unknown mask: black over the eyelids, blotchy on the skin — likely subsurface; not used, AO stays 1). The channel
means are printed so a run on a new export documents the layout it found.
"""
import argparse, os
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser(); ap.add_argument('--maps', required=True); ap.add_argument('--work', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--grooms', default=None, help='Unreal card groom exports: the Attribute atlases become the card textures and the beard/scalp tints go light')
args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
maps = {os.path.splitext(f)[0].lower(): os.path.join(args.maps, f) for f in os.listdir(args.maps)}


def have(k): return maps.get(k.lower())


def save(img, name, q=90):
    """JPEG for the big MetaHuman maps (a 2K PNG normal map is 5 MB; the glb must stay well under 30 MB)"""
    p = os.path.join(args.out, name)
    if name.endswith('.jpg'): img.convert('RGB').save(p, quality=q, subsampling=0)
    else: img.save(p, optimize=True)
    print('[mhtex]', name, img.size, f'{os.path.getsize(p) / 1e6:.2f} MB')


def noise(w, h, octaves=5, persistence=0.55, seed=0):
    r = np.random.default_rng(seed); out = np.zeros((h, w)); amp = 1; tot = 0
    for o in range(octaves):
        sw, sh = max(2, w >> (octaves - 1 - o)), max(2, h >> (octaves - 1 - o))
        im = Image.fromarray((r.random((sh, sw)) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        out += np.asarray(im, dtype=float) / 255 * amp; tot += amp; amp *= persistence
    return out / tot


def to_img(a): return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def flip_green(path, name, size=None):
    im = Image.open(path).convert('RGB')
    if size: im = im.resize((size, size), Image.LANCZOS)
    a = np.asarray(im).copy(); a[..., 1] = 255 - a[..., 1]
    save(Image.fromarray(a), name)


def orm_from_srmf(path, name, zones_rough=None):
    im = Image.open(path); a = np.asarray(im.convert('RGBA'), dtype=float)
    print(f'[mhtex] {os.path.basename(path)} {im.size} {im.mode}: channel means R {a[..., 0].mean():.1f} G {a[..., 1].mean():.1f} B {a[..., 2].mean():.1f} A {a[..., 3].mean():.1f} (R=specular, G=roughness, B=metallic)')
    rough = np.clip(a[..., 1], 0.5 * 255, 0.7 * 255); metal = a[..., 2]  # (skin roughness clamped 0.5..0.7)
    if zones_rough is not None:
        zr = np.asarray(Image.fromarray(zones_rough.astype(np.uint8)).resize(rough.shape[::-1]), dtype=float)
        rough = np.maximum(rough, zr)
    save(to_img(np.dstack([np.full_like(rough, 255), rough, metal])), name)


# ---------------------------------------------------------------- head: zones into the basecolor
S = 2048
hb = Image.open(have('Head_Basecolor')).convert('RGB').resize((S, S)); head = np.asarray(hb, dtype=float)
def raster_zones(path, S):
    """rasterise the head faces' per-corner zone values into the head tile (painter's order: cavity faces first,
    outward skin last), then fill the gaps/seam margins with the nearest painted texel"""
    d = np.load(path); tri = d['tri_uv']; tz = d['tri_zone']; order = np.argsort(d['outward'])
    img = np.zeros((S, S, 4), np.float32); cov = np.zeros((S, S), bool)
    for i in order:
        q = tri[i] * S; q[:, 1] = S - q[:, 1]
        x0, x1 = int(max(0, np.floor(q[:, 0].min()))), int(min(S - 1, np.ceil(q[:, 0].max())))
        y0, y1 = int(max(0, np.floor(q[:, 1].min()))), int(min(S - 1, np.ceil(q[:, 1].max())))
        if x1 < x0 or y1 < y0: continue
        den = (q[1, 0] - q[0, 0]) * (q[2, 1] - q[0, 1]) - (q[2, 0] - q[0, 0]) * (q[1, 1] - q[0, 1])
        if abs(den) < 1e-9: continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        l1 = ((xs - q[0, 0]) * (q[2, 1] - q[0, 1]) - (q[2, 0] - q[0, 0]) * (ys - q[0, 1])) / den
        l2 = ((q[1, 0] - q[0, 0]) * (ys - q[0, 1]) - (xs - q[0, 0]) * (q[1, 1] - q[0, 1])) / den
        l0 = 1 - l1 - l2; m = (l0 >= -2e-3) & (l1 >= -2e-3) & (l2 >= -2e-3)
        if not m.any(): continue
        val = l0[..., None] * tz[i, 0] + l1[..., None] * tz[i, 1] + l2[..., None] * tz[i, 2]
        sub = img[y0:y1 + 1, x0:x1 + 1]; sub[m] = val[m]; cov[y0:y1 + 1, x0:x1 + 1][m] = True
    from scipy import ndimage
    idx = ndimage.distance_transform_edt(~cov, return_distances=False, return_indices=True)
    return np.clip(img[idx[0], idx[1]], 0, 1)


zp = os.path.join(args.work, 'head_zones.npz')
zones = raster_zones(zp, S) if os.path.exists(zp) else np.zeros((S, S, 4))
beard, brow, scalp, lash = zones[..., 0], zones[..., 1], zones[..., 2], zones[..., 3]
stub = noise(S, S, 9, 0.8, seed=44); fine = noise(S, S, 8, 0.7, seed=45)
bd = beard * (0.72 + 0.28 * np.clip((stub - 0.42) * 3.2, 0, 1)) * (0.45 if args.grooms else 0.96)  # (under real cards only a light jaw tint)
head = head * (1 - bd[..., None]) + np.array([26, 19, 16])[None, None, :] * bd[..., None]
bw = brow * 0.0  # (the MetaHuman basecolor already paints the brows; the zone only places the brow cards)
head = head * (1 - bw[..., None]) + np.array([24, 17, 14])[None, None, :] * bw[..., None]
sc = scalp * (0.85 + 0.15 * np.clip((stub - 0.35) * 2.5, 0, 1)) * 0.92
if args.grooms: sc = np.where(scalp > 0.9, sc * 0.55, sc)  # (full tint only in the fade; a light scalp under the cards)
head = head * (1 - sc[..., None]) + np.array([22, 16, 13])[None, None, :] * sc[..., None]
# the lid margins: a dark lash line (the lash geometry/texture of the export is strand-based and not shipped)
ll = np.clip(lash, 0, 1) * 0.85
head = head * (1 - ll[..., None]) + np.array([18, 12, 10])[None, None, :] * ll[..., None]
save(to_img(head), 'mh_head_albedo.jpg', 92)
save(Image.open(have('Body_Basecolor')).convert('RGB'), 'mh_body_albedo.jpg', 92)

# ---------------------------------------------------------------- ORM
zr = (0.62 + 0.12 * bd) * 255 * (bd > 0.05)  # the beard is rougher than the skin
if have('Head_SRMF'): orm_from_srmf(have('Head_SRMF'), 'mh_head_orm.jpg', zr)
else:
    n2 = noise(S, S, 4, 0.5, seed=42); pores = noise(S, S, 8, 0.7, seed=43)
    sweat = np.clip((n2 - 0.45) * 3, 0, 1) * (1 - bd)
    rough = 0.50 - 0.16 * sweat + 0.06 * (pores - 0.5) + 0.14 * bd + 0.08 * sc
    save(to_img(np.dstack([np.full((S, S), 255.0), np.clip(rough, 0.2, 1) * 255, np.zeros((S, S))])).resize((S // 2, S // 2), Image.LANCZOS), 'mh_head_orm.png')
    print('[mhtex] Head_SRMF missing -> procedural skin roughness 0.34..0.64 (sweat sheen)')
if have('Body_SRMF'): orm_from_srmf(have('Body_SRMF'), 'mh_body_orm.jpg')
else:
    n2 = noise(S, S, 4, 0.5, seed=46); pores = noise(S, S, 8, 0.7, seed=47)
    sweat = np.clip((n2 - 0.45) * 3, 0, 1)
    rough = 0.52 - 0.18 * sweat + 0.06 * (pores - 0.5)
    save(to_img(np.dstack([np.full((S, S), 255.0), np.clip(rough, 0.2, 1) * 255, np.zeros((S, S))])).resize((S // 2, S // 2), Image.LANCZOS), 'mh_body_orm.png')
    print('[mhtex] Body_SRMF missing -> procedural skin roughness 0.34..0.58 (sweat sheen)')

# ---------------------------------------------------------------- normals, eyes, teeth
for src, dst, size in (('Head_Normal', 'mh_head_normal.jpg', None), ('Body_Normal', 'mh_body_normal.jpg', None), ('Eyes_Normal', 'mh_eye_normal.jpg', 512)):
    if have(src): flip_green(have(src), dst, size)
    else: print(f'[mhtex] {src} missing -> no normal map')
# (Teeth_Normal: 2K for 1.2k tris behind closed lips — not shipped)
for src, dst, size in (('Eyes_Color', 'mh_eye_albedo.jpg', 1024), ('Teeth_Color', 'mh_teeth_albedo.jpg', 512)):
    if not have(src):
        print(f'[mhtex] {src} missing -> {"procedural eye (textures.py iris bake)" if "Eye" in src else "flat teeth material"}'); continue
    im = Image.open(have(src)).convert('RGB').resize((size, size), Image.LANCZOS)
    if src == 'Eyes_Color':  # the iris is the centred disc (r < ~0.16 of the map): Unreal renders it dark brown, the map is hazel
        a_ = np.asarray(im, dtype=float); yy, xx = np.mgrid[0:size, 0:size] / size; r = np.hypot(xx - 0.5, yy - 0.5)
        k = 1 - 0.55 * np.clip((0.17 - r) / 0.03, 0, 1); im = to_img(a_ * k[..., None])
    save(im, dst)
# ---------------------------------------------------------------- groom cards (hair curls, beard/brow strokes, matte cap base)
def card_tex(size, n_strokes, kind, seed):
    from PIL import ImageDraw, ImageFilter
    r = np.random.default_rng(seed)
    alpha = Image.new('L', (size, size), 0); dr = ImageDraw.Draw(alpha)
    for _ in range(n_strokes):
        if kind == 'curl':  # small loops and arcs, denser toward the card's base (v = 0 is the bottom row)
            cx, cy = r.uniform(0.08, 0.92) * size, (1 - r.uniform(0, 1) ** 0.7) * size
            rad = r.uniform(0.035, 0.09) * size; w = max(1, int(size * 0.012))
            a0 = r.uniform(0, 360); dr.arc([cx - rad, cy - rad, cx + rad, cy + rad], a0, a0 + r.uniform(160, 330), fill=int(r.uniform(150, 255)), width=w)
        else:  # short slightly curved strokes
            cx, cy = r.uniform(0.05, 0.95) * size, r.uniform(0.15, 0.95) * size
            L = r.uniform(0.12, 0.3) * size; ang = r.uniform(-0.6, 0.6) + np.pi / 2; w = max(1, int(size * 0.02))
            dr.line([(cx - np.cos(ang) * L / 2, cy - np.sin(ang) * L / 2), (cx + np.cos(ang) * L / 2, cy + np.sin(ang) * L / 2)], fill=int(r.uniform(140, 255)), width=w)
    alpha = alpha.filter(ImageFilter.GaussianBlur(size * 0.004))
    a = np.asarray(alpha, dtype=float)
    # fade the card's outer edges so no rectangle ever shows
    yy, xx = np.mgrid[0:size, 0:size] / size
    edge = np.clip(xx / 0.12, 0, 1) * np.clip((1 - xx) / 0.12, 0, 1) * np.clip((1 - yy) / 0.15, 0, 1) * np.clip(yy / 0.06, 0, 1)
    a = a * edge
    tone = noise(size, size, 4, 0.6, seed=seed + 1)
    rgb = np.dstack([14 + 14 * tone, 10 + 9 * tone, 8 + 7 * tone])  # ~0.05 albedo, warm black
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), np.clip(a, 0, 255)]).astype(np.uint8), 'RGBA')


save(card_tex(512, 260, 'curl', 61), 'mh_hair_cards.png')
save(card_tex(256, 90, 'stroke', 62), 'mh_beard_cards.png')
bt = noise(512, 512, 6, 0.6, seed=63)
save(to_img(np.dstack([12 + 12 * bt, 9 + 8 * bt, 7 + 6 * bt])), 'mh_hair_base.png')
# ---------------------------------------------------------------- Epic card grooms: dark base x coverage (Attribute atlas R = coverage/alpha)
if args.grooms:
    for kind, sub, stem, size in (('hair', 'hair', 'Hair_S_AfroFade', 2048), ('beard', 'beard', 'Beard_S_Curly', 2048), ('brows', 'brows', 'Eyebrows_M_FlatThick', 2048)):  # (strands are 1-2 texels wide: downsampling kills them under the alpha cutoff)
        pth = os.path.join(args.grooms, sub, stem + '_CardsAtlas_Attribute.png')
        if not os.path.exists(pth): print('[mhtex] groom atlas missing:', pth); continue
        a = np.asarray(Image.open(pth).convert('RGBA'), dtype=float) / 255
        cov = a[..., 0]; shade = a[..., 1]
        rgb = np.dstack([0.040 + 0.025 * shade, 0.030 + 0.018 * shade, 0.024 + 0.014 * shade]) * 255  # ~0.04-0.06 warm black
        if kind == 'brows': cov = cov * 0.8  # (FlatThick brows are dense: a touch thinner so they read as hair, not a bar)
        im = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), cov * 255]).astype(np.uint8), 'RGBA')
        if im.size[0] != size:  # (downsample the coverage with a max so thin strands survive the cutoff)
            f = im.size[0] // size; cov_ds = cov.reshape(size, f, size, f).max(axis=(1, 3))
            im = Image.fromarray(np.dstack([np.asarray(im.convert('RGB').resize((size, size), Image.LANCZOS)), (cov_ds * 255).astype(np.uint8)]), 'RGBA')
        print(f'[mhtex] groom {kind}: atlas {a.shape[1]}² -> {size}², coverage>0.4 fraction {(cov > 0.4).mean():.3f}')
        save(im, f'mh_groom_{kind}.png')
    hp = os.path.join(args.grooms, 'hair', 'Hair_S_AfroFade_RootUVSeedCoverage.png')
    if os.path.exists(hp):  # the far-LOD helmet cap: dark hair x the helmet-space coverage (A)
        a = np.asarray(Image.open(hp).convert('RGBA'), dtype=float) / 255; cov = a[..., 3]
        rgb = np.dstack([0.045 + 0.02 * cov, 0.034 + 0.014 * cov, 0.027 + 0.01 * cov]) * 255
        im = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), cov * 255]).astype(np.uint8), 'RGBA').resize((512, 512), Image.LANCZOS)
        save(im, 'mh_groom_helmet.png')
print('[mhtex] done')
