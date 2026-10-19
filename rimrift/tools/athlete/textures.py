"""The RIMRIFT athlete's textures (PIL + numpy), called by build_athlete.py:
  python3 tools/athlete/textures.py --work <dir with bake_*.png> --out <textures dir>

Layouts (from build_athlete.py): jersey tube v 0..0.9 (hem at 0), front centre u=0.75, back u=0.25, sides u=0/0.5,
straps at v 0.925..0.995; shorts body v 0.5..1 (waist at 1), legs v 0..0.5 with the outer-side stripe at u=0.5;
shoes: upper v 0.5..1 (planar from above, toe at u=0), sole v 0..0.25; hair: cylindrical round the head.
Fonts: Inter Black Italic (SIL OFL 1.1, /usr/share/fonts/opentype/inter).
"""
import argparse, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ap = argparse.ArgumentParser(); ap.add_argument('--work', required=True); ap.add_argument('--out', required=True)
args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
rng = np.random.default_rng(7)
EMBER = (255, 77, 36); CHAR = (41, 42, 46); INK = (18, 18, 20); CREAM = (232, 228, 220); WHITE = (240, 240, 238)
FONT = '/usr/share/fonts/opentype/inter/Inter-BlackItalic.otf'
if not os.path.exists(FONT): FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf'


def rect(dr, box, fill):
    x0, y0, x1, y1 = box
    dr.rectangle([min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)], fill=fill)


def save(img, name):
    p = os.path.join(args.out, name); img.save(p, optimize=True); print('[tex]', name, img.size)


def noise(w, h, octaves=5, persistence=0.55, seed=0):
    r = np.random.default_rng(seed); out = np.zeros((h, w)); amp = 1; tot = 0
    for o in range(octaves):
        sw, sh = max(2, w >> (octaves - 1 - o)), max(2, h >> (octaves - 1 - o))
        base = r.random((sh, sw))
        im = Image.fromarray((base * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        out += np.asarray(im, dtype=float) / 255 * amp; tot += amp; amp *= persistence
    return out / tot


def to_img(arr3):
    return Image.fromarray(np.clip(arr3, 0, 255).astype(np.uint8))


def normal_from_height(h, strength=2.0):
    gy, gx = np.gradient(h)
    n = np.dstack([-gx * strength, -gy * strength, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return to_img((n * 0.5 + 0.5) * 255)


def orm(rough, metal=None, w=None, h=None):
    if np.isscalar(rough): rough = np.full((h, w), rough)
    hh, ww = rough.shape
    m = np.zeros((hh, ww)) if metal is None else metal
    return to_img(np.dstack([np.full((hh, ww), 255.0), rough * 255, m * 255]))


def text_layer(size, text, box, color, slant=0.18, squeeze=1.0, font_px=None):
    """draw text fitted into box (x0,y0,x1,y1) in pixels, slanted; returns RGBA layer"""
    x0, y0, x1, y1 = box; bw, bh = x1 - x0, y1 - y0
    fpx = font_px or int(bh * 1.25)
    f = ImageFont.truetype(FONT, fpx)
    bb = f.getbbox(text); tw, th = bb[2] - bb[0], bb[3] - bb[1]
    pad = int(fpx * 0.4)
    layer = Image.new('RGBA', (tw + 2 * pad, th + 2 * pad), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((pad - bb[0], pad - bb[1]), text, font=f, fill=color + (255,))
    # scale to the box, squeeze horizontally for a condensed look
    layer = layer.resize((max(1, int(bw * squeeze)), bh), Image.LANCZOS)
    out = Image.new('RGBA', size, (0, 0, 0, 0))
    out.paste(layer, (int(x0 + (bw - layer.width) / 2), y0), layer)
    return out


def mesh_grain(w, h, cell=14, seed=1):
    """a hexagon-ish mesh: dark holes on a grid"""
    yy, xx = np.mgrid[0:h, 0:w]
    hx = xx + (yy // cell % 2) * cell / 2
    dx = (hx % cell) - cell / 2; dy = (yy % cell) - cell / 2
    r = np.hypot(dx, dy)
    hole = np.clip((cell * 0.28 - r) / 1.5, 0, 1)
    return hole


# ---------------------------------------------------------------- jersey
W, Hh = 2048, 1024
grain = mesh_grain(W, Hh, 14)
base = np.array(CHAR, dtype=float)[None, None, :] * (1 - 0.35 * grain[..., None]) + noise(W, Hh, 4, seed=3)[..., None] * 10 - 5
jersey = to_img(base).convert('RGBA')
dr = ImageDraw.Draw(jersey)
V = lambda v: int((1 - v) * Hh)  # texture row from v
U = lambda u: int(u * W)
pipe = 10
# hem and top-edge piping, side seams, straps
rect(dr, [0, V(0.03), W, V(0.0)], fill=EMBER)
rect(dr, [0, V(0.9), W, V(0.872)], fill=EMBER)
for u in (0.0, 0.5, 1.0): rect(dr, [U(u) - 4, V(0.872), U(u) + 4, V(0.03)], fill=EMBER)
rect(dr, [0, V(0.92), W, V(1.0)], fill=CHAR)
rect(dr, [0, V(0.936), W, V(0.925)], fill=EMBER); rect(dr, [0, V(0.995), W, V(0.984)], fill=EMBER)
# the number: front chest, back big
num_f = text_layer((W, Hh), '39', (U(0.75) - 170, V(0.60), U(0.75) + 170, V(0.36)), CREAM, squeeze=0.78)
num_b = text_layer((W, Hh), '39', (U(0.25) - 230, V(0.75), U(0.25) + 230, V(0.42)), CREAM, squeeze=0.78)
word = text_layer((W, Hh), 'RIMRIFT', (U(0.75) - 240, V(0.70), U(0.75) + 240, V(0.635)), CREAM, squeeze=1.0)
word_b = text_layer((W, Hh), 'RIMRIFT', (U(0.25) - 110, V(0.84), U(0.25) + 110, V(0.80)), EMBER, squeeze=1.0)
for L in (num_f, num_b, word, word_b):
    # a tackle-twill look: the mesh grain shows through a little, darker outline
    jersey.alpha_composite(L)
jersey = jersey.convert('RGB')
jn = np.asarray(jersey, dtype=float)
jn = jn * (1 - 0.18 * grain[..., None])
save(to_img(jn), 'jersey_albedo.png')
rough = 0.62 + 0.25 * grain - 0.03 * noise(W, Hh, 3, seed=4)
# the numbers/wordmark are smoother
alpha = np.asarray(num_f.split()[3], dtype=float) / 255 + np.asarray(num_b.split()[3], dtype=float) / 255 + np.asarray(word.split()[3], dtype=float) / 255
rough = np.where(alpha > 0.5, 0.45, rough)
save(orm(np.clip(rough, 0, 1)), 'jersey_orm.png')
save(normal_from_height(grain * 0.9 + noise(W, Hh, 5, seed=5) * 0.15, 1.6), 'jersey_normal.png')

# ---------------------------------------------------------------- shorts
W2 = 1024
grain2 = mesh_grain(W2, W2, 10)
sb = np.array(CHAR, dtype=float)[None, None, :] * (1 - 0.3 * grain2[..., None]) - 6 + noise(W2, W2, 4, seed=8)[..., None] * 10
shorts = to_img(sb).convert('RGBA'); dr = ImageDraw.Draw(shorts)
V2 = lambda v: int((1 - v) * W2); U2 = lambda u: int(u * W2)
# waistband (charcoal with an ember tab at the front), hem piping, the side stripe down each leg
rect(dr, [0, V2(1.0), W2, V2(0.955)], fill=INK)
rect(dr, [U2(0.75) - 14, V2(1.0), U2(0.75) + 14, V2(0.955)], fill=EMBER)
rect(dr, [0, V2(0.02), W2, V2(0.0)], fill=EMBER)
rect(dr, [U2(0.5) - 7, V2(0.5), U2(0.5) + 7, V2(0.0)], fill=EMBER)
# the hem chevron: ember diagonals meeting at the side stripe, with a white insert under them
pts = [(U2(0.5) - 150, V2(0.0)), (U2(0.5), V2(0.16)), (U2(0.5) + 150, V2(0.0))]
dr.polygon([(U2(0.5) - 120, V2(0.0)), (U2(0.5), V2(0.13)), (U2(0.5) + 120, V2(0.0))], fill=CREAM)
dr.line(pts, fill=EMBER, width=12)
save(shorts.convert('RGB'), 'shorts_albedo.png')
save(orm(np.clip(0.6 + 0.25 * grain2, 0, 1)), 'shorts_orm.png')

# ---------------------------------------------------------------- knit (sleeve, socks)
kw = 256
knit = noise(kw, kw, 4, seed=11)
yy, xx = np.mgrid[0:kw, 0:kw]
rib = 0.5 + 0.5 * np.sin(xx / kw * 2 * np.pi * 48)
save(normal_from_height(rib * 0.5 + knit * 0.3, 1.5), 'knit_normal.png')
sleeve = np.full((kw, kw, 3), 22.0) + rib[..., None] * 8 + knit[..., None] * 6
save(to_img(sleeve), 'sleeve_albedo.png'); save(orm(0.75 + 0.1 * knit, w=kw, h=kw), 'sleeve_orm.png')
sock = np.full((kw, kw, 3), 236.0) - rib[..., None] * 12 - knit[..., None] * 8
sock_img = to_img(sock); dr = ImageDraw.Draw(sock_img)
rect(dr, [0, int(kw * 0.14), kw, int(kw * 0.19)], fill=EMBER)   # a stripe near the crew top (v ~0.83)
rect(dr, [0, int(kw * 0.0), kw, int(kw * 0.05)], fill=(200, 200, 198))
save(sock_img, 'sock_albedo.png'); save(orm(0.85 + 0.1 * knit, w=kw, h=kw), 'sock_orm.png')

# ---------------------------------------------------------------- shoes (upper: v 0.5..1 planar top-down, toe at u=0; sole: v 0..0.25)
sw = 1024
shoe = Image.new('RGB', (sw, sw), WHITE); dr = ImageDraw.Draw(shoe)
V3 = lambda v: int((1 - v) * sw); U3 = lambda u: int(u * sw)
# sole band: white sidewall, black midsole stripe, ember heel wedge
rect(dr, [0, V3(0.25), sw, V3(0.0)], fill=(228, 228, 226))
rect(dr, [0, V3(0.17), sw, V3(0.09)], fill=INK)
rect(dr, [U3(0.35), V3(0.17), U3(0.65), V3(0.09)], fill=EMBER)
# upper: black heel counter and eyestay, ember accent, laces across the tongue
rect(dr, [0, V3(1.0), sw, V3(0.5)], fill=WHITE)
dr.polygon([(U3(0.62), V3(1.0)), (U3(1.0), V3(1.0)), (U3(1.0), V3(0.5)), (U3(0.62), V3(0.5)), (U3(0.55), V3(0.75))], fill=INK)
dr.polygon([(U3(0.3), V3(0.78)), (U3(0.62), V3(0.86)), (U3(0.62), V3(0.64)), (U3(0.3), V3(0.72))], fill=EMBER)
for i in range(7):
    x = U3(0.2 + i * 0.058)
    dr.line([(x, V3(0.68)), (x + 14, V3(0.82))], fill=(200, 200, 196), width=9)
    dr.line([(x + 14, V3(0.68)), (x, V3(0.82))], fill=(215, 215, 212), width=9)
rect(dr, [U3(0.0), V3(0.76), U3(0.14), V3(0.74)], fill=(205, 205, 200))  # toe cap seam
save(shoe, 'shoe_albedo.png')
sr = np.full((sw, sw), 0.5); sr[V3(1.0):V3(0.5), :] = 0.42; sr[V3(0.25):, :] = 0.7
save(orm(sr), 'shoe_orm.png')

# ---------------------------------------------------------------- hair (cylindrical round the head) and the cards
hw = 1024
curl = noise(hw, hw, 6, 0.6, seed=21)
curl2 = noise(hw, hw, 3, 0.5, seed=22)
yy, xx = np.mgrid[0:hw, 0:hw]
rings = 0.5 + 0.5 * np.sin((xx * 0.9 + yy * 0.7) * 0.35 + curl * 12)
hv = (0.55 * curl + 0.45 * rings) * (0.7 + 0.3 * curl2)
col = np.dstack([14 + 26 * hv, 10 + 16 * hv, 9 + 10 * hv])
save(to_img(col), 'hair_albedo.png'); save(orm(np.clip(0.72 - 0.25 * hv, 0, 1)), 'hair_orm.png')
save(normal_from_height(hv * 1.4, 2.2), 'hair_normal.png')
cw = 256
cards = np.zeros((cw, cw, 4))
cv = noise(cw, cw, 5, 0.6, seed=31)
yy, xx = np.mgrid[0:cw, 0:cw]
blobs = np.clip((cv - 0.42) * 6, 0, 1) * (1 - yy / cw) ** 0.6
cards[..., 0] = 16 + 20 * cv; cards[..., 1] = 11 + 12 * cv; cards[..., 2] = 9 + 8 * cv; cards[..., 3] = blobs * 255
save(Image.fromarray(np.clip(cards, 0, 255).astype(np.uint8), 'RGBA'), 'hair_cards.png')

# ---------------------------------------------------------------- skin (from the baked zones)
S = 2048
zp = os.path.join(args.work, 'bake_zones.png'); pp = os.path.join(args.work, 'bake_pos.png')
zones = np.asarray(Image.open(zp).convert('RGBA'), dtype=float) / 255 if os.path.exists(zp) else np.zeros((S, S, 4))
posm = np.asarray(Image.open(pp).convert('RGB'), dtype=float) / 255 if os.path.exists(pp) else np.full((S, S, 3), 0.5)
zones = np.asarray(Image.fromarray((zones * 255).astype(np.uint8)).resize((S, S)), dtype=float) / 255
posm = np.asarray(Image.fromarray((posm * 255).astype(np.uint8)).resize((S, S)), dtype=float) / 255
beard, brow, lips, hairline = zones[..., 0], zones[..., 1], zones[..., 2], posm[..., 2]
n1 = noise(S, S, 7, 0.55, seed=41); n2 = noise(S, S, 4, 0.5, seed=42); pores = noise(S, S, 8, 0.7, seed=43)
# a medium-brown skin: warm base, slight mottling, cooler/darker toward the back of the hands... (position: R height, G front-ness)
base = np.array([130, 86, 60], dtype=float)
tone = base[None, None, :] * (0.95 + 0.1 * n2[..., None]) + (n1[..., None] - 0.5) * 7
tone[..., 0] += 6 * (posm[..., 1] - 0.5) * 2  # a touch redder on the front (chest/face)
# beard: short dark stubble, denser at the chin; brows; lips a touch darker and redder; the hairline fade under the cap
stub = noise(S, S, 9, 0.8, seed=44)
bd = beard * (0.45 + 0.5 * np.clip((stub - 0.4) * 3, 0, 1)) * 0.85
tone = tone * (1 - bd[..., None]) + np.array([24, 18, 16])[None, None, :] * bd[..., None]
bw_ = brow * (0.35 + 0.4 * np.clip((noise(S, S, 8, 0.7, seed=45) - 0.4) * 3, 0, 1))
tone = tone * (1 - bw_[..., None]) + np.array([22, 16, 14])[None, None, :] * bw_[..., None]
tone = tone * (1 - lips[..., None] * 0.5) + np.array([120, 60, 55])[None, None, :] * lips[..., None] * 0.5
fade = hairline * (0.5 + 0.3 * np.clip((stub - 0.4) * 3, 0, 1)) * 0.7
tone = tone * (1 - fade[..., None]) + np.array([30, 22, 18])[None, None, :] * fade[..., None]
tone = tone * (1 - 0.03 * (pores[..., None] - 0.5))
save(to_img(tone), 'skin_albedo.png')
# roughness: skin ~0.55, sweat sheen on the shoulders/chest/forehead (upper body, blotchy)
sweat = np.clip((posm[..., 0] - 0.6) / 0.3, 0, 1) * np.clip((n2 - 0.4) * 3, 0, 1)
rough = 0.56 - 0.22 * sweat + 0.08 * (pores - 0.5) + 0.12 * bd
save(orm(np.clip(rough, 0.2, 1)), 'skin_orm.png')
save(normal_from_height(pores * 0.35 + bd * 0.3 + n1 * 0.1, 1.2), 'skin_normal.png')

# ---------------------------------------------------------------- eyes (from the baked iris/pupil masks)
E = 256
ep = os.path.join(args.work, 'bake_eye.png')
ez = np.asarray(Image.open(ep).convert('RGB').resize((E, E)), dtype=float) / 255 if os.path.exists(ep) else np.zeros((E, E, 3))
iris, pupil = ez[..., 0], ez[..., 1]
yy, xx = np.mgrid[0:E, 0:E]
streak = 0.5 + 0.5 * np.sin(np.arctan2(yy - E / 2, xx - E / 2) * 24 + noise(E, E, 3, seed=51) * 6)
sclera = np.array([236, 230, 226]) - noise(E, E, 4, seed=52)[..., None] * 18
irisc = np.array([74, 42, 22])[None, None, :] * (0.8 + 0.4 * streak[..., None])
eye = sclera * (1 - iris[..., None]) + irisc * iris[..., None]
eye = eye * (1 - pupil[..., None]) + np.array([6, 5, 5])[None, None, :] * pupil[..., None]
save(to_img(eye), 'eye_albedo.png'); save(orm(0.12, w=E, h=E), 'eye_orm.png')
print('[tex] done')
