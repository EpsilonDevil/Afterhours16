#!/usr/bin/env python3
"""RIMRIFT World spike: the Harbor Point textures, generated (no downloads), a port of the ideas in
client/js/gfx/textures.js (courtOverlay, asphalt, sand, chainlink, waterNormal) with Pillow + numpy.
Writes PNGs into rimrift/game/assets/world/tex/. Run:  python3 rimrift/tools/world/make_textures.py
Court geometry comes from the exported layout (harbor_layout.json → COURT), so the lines are the sim's lines."""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, '..', '..', 'game', 'assets', 'world'))
OUT = os.path.join(ASSETS, 'tex')
os.makedirs(OUT, exist_ok=True)
LAY = json.load(open(os.path.join(ASSETS, 'harbor_layout.json')))
COURT = LAY['court']
THEME = LAY['theme']['court']
FONT_BLACK = next((f for f in ['/usr/share/fonts/opentype/inter/Inter-Black.otf', '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'] if os.path.exists(f)), None)

def hex_rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

# ---------- tileable value noise (vectorised; the JS makeNoise2D idea: smoothstep-interpolated lattice) ----------
def tile_noise(S, period, octaves=4, seed=7, gain=0.5):
    """fbm on an SxS grid that tiles, `period` lattice cells across the tile at octave 0."""
    rng = np.random.default_rng(seed)
    out = np.zeros((S, S), np.float32); amp = 0.5; p = int(period)
    ys, xs = np.mgrid[0:S, 0:S].astype(np.float32)
    for _ in range(octaves):
        lat = rng.uniform(-1, 1, (p, p)).astype(np.float32)
        fx = xs * p / S; fy = ys * p / S
        x0 = np.floor(fx).astype(int) % p; y0 = np.floor(fy).astype(int) % p
        x1 = (x0 + 1) % p; y1 = (y0 + 1) % p
        u = fx - np.floor(fx); v = fy - np.floor(fy)
        u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v)
        a = lat[y0, x0]; b = lat[y0, x1]; c = lat[y1, x0]; d = lat[y1, x1]
        out += amp * ((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v)
        amp *= gain; p *= 2
    return out

def height_to_normal(H, strength=2.0):
    dx = (np.roll(H, -1, axis=1) - np.roll(H, 1, axis=1)) * strength
    dy = (np.roll(H, -1, axis=0) - np.roll(H, 1, axis=0)) * strength
    l = np.sqrt(dx * dx + dy * dy + 1)
    n = np.stack([(-dx / l * 0.5 + 0.5), (-dy / l * 0.5 + 0.5), (1 / l * 0.5 + 0.5)], -1)
    return Image.fromarray((np.clip(n, 0, 1) * 255).astype(np.uint8), 'RGB')

def save(img, name):
    img.save(os.path.join(OUT, name)); print('wrote', name, img.size)

# ---------- court overlay (textures.js courtOverlay, harbor spec) ----------
def court_overlay(spec, half_only, logo_size, name, ppm=100, ss=2):
    margin = 2.0
    W = COURT['width'] + margin * 2; L = COURT['length'] + margin * 2
    PX = ppm * ss
    cw, ch = round(W * PX), round(L * PX)
    img = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    d = ImageDraw.Draw(img, 'RGBA')
    P = lambda x, z: (cw / 2 + x * PX, ch / 2 + z * PX)
    lineW = 0.051; lw = max(1, round(lineW * PX))
    lines = hex_rgb(spec['lines']) + (255,)
    # apron, court
    d.rectangle([P(-W / 2, -L / 2), P(W / 2, L / 2)], fill=hex_rgb(spec['apron']) + (255,))
    d.rectangle([P(-COURT['width'] / 2, -COURT['length'] / 2), P(COURT['width'] / 2, COURT['length'] / 2)], fill=hex_rgb(spec['court']) + (255,))
    hoopZ = COURT['hoopZ']; cx3 = COURT['cornerThree']; R3 = COURT['threeRadius']
    dz3 = math.sqrt(R3 * R3 - cx3 * cx3); t0 = math.atan2(cx3, dz3)
    ends = [1] if half_only else [-1, 1]
    for s in ends:
        bz = s * COURT['length'] / 2; rz = s * hoopZ
        zmeet = rz - s * dz3
        arc = [(R3 * math.sin(t), rz - s * R3 * math.cos(t)) for t in np.linspace(-t0, t0, 160)]
        three = [(-cx3, bz), (-cx3, zmeet)] + arc + [(cx3, bz)]
        # three-point area tint rgba(255,255,255,0.05)
        tint = Image.new('RGBA', img.size, (0, 0, 0, 0)); ImageDraw.Draw(tint).polygon([P(*p) for p in three], fill=(255, 255, 255, 13))
        img.alpha_composite(tint); d = ImageDraw.Draw(img, 'RGBA')
        # key
        kw = COURT['keyWidth']; kl = COURT['ftDist']
        z0 = bz - kl if s > 0 else bz
        d.rectangle([P(-kw / 2, z0), P(kw / 2, z0 + kl)], fill=hex_rgb(spec['paint']) + (255,))
        d.rectangle([P(-kw / 2, z0), P(kw / 2, z0 + kl)], outline=lines, width=lw)
        # FT circle
        fr = COURT['ftRadius']; fz = bz - s * kl
        d.ellipse([P(-fr, fz - fr), P(fr, fz + fr)], outline=lines, width=lw)
        # lane hash marks
        for off in [2.13, 3.05, 3.96, 4.88]:
            for sx in (-1, 1):
                d.line([P(sx * kw / 2, bz - s * off), P(sx * (kw / 2 + 0.2), bz - s * off)], fill=lines, width=lw)
        # restricted arc (the half away from the baseline)
        rr = COURT['restricted']
        d.arc([P(-rr, rz - rr), P(rr, rz + rr)], 180 if s > 0 else 0, 360 if s > 0 else 180, fill=lines, width=lw)
        # three-point line
        d.line([P(*p) for p in three], fill=lines, width=lw, joint='curve')
        # backboard shadow mark, alpha 0.12
        mk = Image.new('RGBA', img.size, (0, 0, 0, 0)); ImageDraw.Draw(mk).line([P(-0.9, bz - s * 1.22), P(0.9, bz - s * 1.22)], fill=lines[:3] + (31,), width=lw)
        img.alpha_composite(mk); d = ImageDraw.Draw(img, 'RGBA')
    # boundary (the stroke just outside the playing area)
    hw = COURT['width'] / 2 + lineW / 2; hl = COURT['length'] / 2 + lineW / 2
    d.rectangle([P(-hw, -hl), P(hw, hl)], outline=lines, width=lw)
    if half_only:
        d.line([P(-COURT['width'] / 2 - lineW, -lineW / 2), P(COURT['width'] / 2 + lineW, -lineW / 2)], fill=lines, width=lw)
    else:
        d.line([P(-COURT['width'] / 2, 0), P(COURT['width'] / 2, 0)], fill=lines, width=lw)
        cr = COURT['centerRadius']
        d.ellipse([P(-cr, -cr), P(cr, cr)], outline=lines, width=lw)
        d.ellipse([P(-0.61, -0.61), P(0.61, 0.61)], outline=lines, width=lw)
    # centre logo: the Harbor Kings crown (drawLogo shape 'crown'), alpha 0.9 fill, accent stroke, 'HK' text
    logo = spec['logo']; sz = logo_size
    crown = [(-sz, sz * 0.6), (-sz, -sz * 0.4), (-sz * 0.5, sz * 0.05), (0, -sz * 0.8), (sz * 0.5, sz * 0.05), (sz, -sz * 0.4), (sz, sz * 0.6)]
    lg = Image.new('RGBA', img.size, (0, 0, 0, 0)); ld = ImageDraw.Draw(lg)
    ld.polygon([P(*p) for p in crown], fill=hex_rgb(logo['color']) + (230,))
    img.alpha_composite(lg); d = ImageDraw.Draw(img, 'RGBA')
    d.line([P(*p) for p in crown] + [P(*crown[0]), P(*crown[1])], fill=hex_rgb(logo['accent']) + (255,), width=max(1, round(sz * 0.06 * PX)), joint='curve')
    if FONT_BLACK:
        fs = sz * (0.42 if len(logo['text']) > 4 else 0.62) * PX
        font = ImageFont.truetype(FONT_BLACK, int(fs))
        d.text(P(0, sz * 0.04), logo['text'], fill=hex_rgb(logo['accent']) + (255,), font=font, anchor='mm')
        # baseline text 'HARBOR KINGS', alpha 0.85, 0.5 m letters, turned to read from its own end
        bfont = ImageFont.truetype(FONT_BLACK, int(0.5 * PX))
        for s in ends:
            tw = Image.new('RGBA', (int(10 * PX), int(1.2 * PX)), (0, 0, 0, 0))
            ImageDraw.Draw(tw).text((tw.width / 2, tw.height / 2), spec['baselineText'], fill=lines[:3] + (217,), font=bfont, anchor='mm')
            if s < 0: tw = tw.rotate(180)
            cxp, czp = P(0, s * (COURT['length'] / 2 + margin * 0.5))
            img.alpha_composite(tw, (int(cxp - tw.width / 2), int(czp - tw.height / 2)))
    # wear: erode the paint with noise, most in the traffic in front of each rim (textures.js wear)
    arr = np.asarray(img.resize((cw // ss, ch // ss), Image.LANCZOS)).astype(np.float32)
    H, Wd = arr.shape[:2]
    ys, xs = np.mgrid[0:H, 0:Wd]
    wx = xs / ppm - W / 2; wz = ys / ppm - L / 2
    traffic = np.exp(-((wx * wx) / 18 + ((np.abs(wz) - hoopZ + 3) ** 2) / 20))
    n = tile_noise(max(H, Wd), 16, 4, seed=3)[:H, :Wd] + tile_noise(max(H, Wd), 200, 1, seed=4)[:H, :Wd] * 0.15
    erosion = THEME['wear'] * (0.25 + traffic * 0.9) + n * 0.6
    k = np.clip((erosion - 0.6) * 2.2, 0, 1)
    rgb = arr[..., :3]; a = arr[..., 3]
    grey = rgb.mean(-1, keepdims=True)
    rgb = rgb + (grey * 1.12 - rgb) * (k[..., None] * 0.45)
    a = a * (1 - k * 0.35)
    scuff = np.random.default_rng(9).random((H, Wd)) < 0.004 * THEME['wear']
    rgb[scuff] *= 0.7
    out = np.concatenate([np.clip(rgb, 0, 255), np.clip(a, 0, 255)[..., None]], -1).astype(np.uint8)
    save(Image.fromarray(out, 'RGBA'), name)
    # a roughness/paint mask: where the overlay is opaque paint, the floor is smoother than bare asphalt
    return W, L

# ---------- asphalt (textures.js asphalt) ----------
def asphalt(S=1024, seed=5):
    rng = np.random.default_rng(seed)
    n = tile_noise(S, 20, 5, seed); big = tile_noise(S, 3, 3, seed + 1)
    speck = rng.random((S, S))
    v = 0.85 + n * 0.35 + big * 0.25; h = n * 0.5
    v = np.where(speck > 0.985, v * 1.45, np.where(speck < 0.02, v * 0.55, v)); h = np.where(speck > 0.985, h + 0.6, np.where(speck < 0.02, h - 0.4, h))
    base = np.array([0.24, 0.24, 0.25])
    rgb = np.clip(base[None, None] * v[..., None] * 255, 0, 255)
    # cracks: random walks
    for _ in range(6):
        x, y, a = rng.random() * S, rng.random() * S, rng.random() * math.tau
        for _ in range(int(80 + rng.random() * 300)):
            a += (rng.random() - 0.5) * 0.5; x += math.cos(a); y += math.sin(a)
            xi, yi = int(x) % S, int(y) % S
            rgb[yi, xi] *= 0.45; h[yi, xi] -= 1.2
    save(Image.fromarray(rgb.astype(np.uint8), 'RGB'), 'asphalt_c.png')
    save(height_to_normal(h, 1.5), 'asphalt_n.png')

# ---------- sand (textures.js sand: slow drift, patchy texture, lumps, wind ripples, grains) ----------
def sand(S=1024, seed=61, meters=12):
    rng = np.random.default_rng(seed)
    low = tile_noise(S, 3, 3, seed); mid = tile_noise(S, 14, 2, seed + 7); lump = tile_noise(S, 24, 2, seed + 2)
    warp = tile_noise(S, 6, 2, seed + 3) * 3.2 + mid * 1.5
    ys, xs = np.mgrid[0:S, 0:S].astype(np.float32)
    ka, kb, kc, kd = 70, 24, 30, -64
    ph = math.tau * (ka * xs + kb * ys) / S + warp; ph2 = math.tau * (kc * xs + kd * ys) / S + warp * 1.3
    m1 = tile_noise(S, 4, 2, seed + 8); m2 = tile_noise(S, 5, 2, seed + 9)
    s1 = np.clip((m1 - 0.05) * 3, 0, 1); s2 = np.clip((m2 - 0.15) * 3, 0, 1)
    rip = (np.sin(ph) + 0.28 * np.sin(ph * 2 + 0.6)) * s1 + (np.sin(ph2) + 0.25 * np.sin(ph2 * 2 + 0.4)) * s2 * 0.7
    grain = rng.random((S, S)).astype(np.float32)
    v = 0.95 + low * 0.14 + mid * 0.05 + lump * 0.03 + rip * 0.012 + (grain - 0.5) * 0.14
    tint = low * 0.035
    h = rip * 0.45 + lump * 0.9 + (grain - 0.5) * 0.3 + mid * 0.4
    shell = grain > 0.9965; dark = grain < 0.006
    v = np.where(shell, v * 1.3, np.where(dark, v * 0.55, v)); tint = np.where(shell, tint - 0.05, tint); h = np.where(shell, h + 0.6, np.where(dark, h + 0.3, h))
    base = [0.84, 0.76, 0.62]
    rgb = np.stack([base[0] * v * (1 + tint), base[1] * v, base[2] * v * (1 - tint)], -1)
    save(Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), 'RGB'), 'sand_c.png')
    save(height_to_normal(h, 1.1), 'sand_n.png')

# ---------- chain-link (textures.js chainlink: diagonal wires, alpha) — 8 diamonds per 1.2 m tile ----------
def chainlink(S=512, n=8):
    ss = 4; big = S * ss
    img = Image.new('L', (big, big), 0); d = ImageDraw.Draw(img)
    s = big / n; w = int(big / 110)
    for i in range(-n - 1, n + 2):
        d.line([(i * s, 0), (i * s + big, big)], fill=255, width=w)
        d.line([(i * s + big, 0), (i * s, big)], fill=255, width=w)
    a = img.resize((S, S), Image.LANCZOS)
    rgb = Image.new('RGB', (S, S), (205, 210, 215)); rgb.putalpha(a)
    save(rgb, 'chainlink.png')

# ---------- palm frond card: midrib + leaflets, the shape in the alpha ----------
def frond_card(W=1024, H=512):
    ss = 2; w, h = W * ss, H * ss
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    rng = np.random.default_rng(12)
    greens = [(63, 122, 58), (79, 138, 66), (95, 154, 74), (74, 130, 64), (58, 110, 52)]
    cy = h / 2
    # leaflets: pairs along the rib, angled forward, tapering; longest around 1/3 of the way out
    n = 44
    for i in range(n):
        t = (i + 0.5) / n
        x = t * w * 0.97
        L = h * 0.48 * math.sin(math.pi * min(1, t * 1.05 + 0.08)) * (0.85 + 0.3 * rng.random())
        ang = math.radians(52 + 18 * t + rng.uniform(-6, 6))
        for side in (-1, 1):
            c = greens[rng.integers(len(greens))]
            c = tuple(int(v * (0.9 + 0.2 * rng.random())) for v in c)
            tipx = x + math.cos(ang) * L; tipy = cy + side * math.sin(ang) * L
            bw = h * 0.018
            # a thin leaf: base width bw, pointed tip, slight droop toward the tip
            nx, ny = -math.sin(ang) * side, math.cos(ang)
            poly = [(x - nx * bw * 0.5 * side, cy - ny * bw * 0.5 * side * 0 + 0), (x + nx * bw * side, cy + ny * bw * side), (tipx, tipy + side * L * 0.08)]
            d.polygon(poly, fill=c + (255,))
    # the rib
    for i in range(40):
        t = i / 40; x0 = t * w; x1 = (t + 1 / 40) * w
        d.line([(x0, cy), (x1, cy)], fill=(110, 125, 60, 255), width=int(h * 0.035 * (1 - t * 0.7)) + 2)
    img = img.resize((W, H), Image.LANCZOS)
    # bleed the colour into transparent texels so mips don't go dark at the edges
    arr = np.asarray(img).astype(np.float32); a = arr[..., 3:4] / 255
    blur = np.asarray(img.filter(ImageFilter.GaussianBlur(6))).astype(np.float32)
    ba = np.maximum(blur[..., 3:4], 1)
    rgb = arr[..., :3] * a + (blur[..., :3] * 255 / ba) * (1 - a)
    out = np.concatenate([np.clip(rgb, 0, 255), arr[..., 3:4]], -1).astype(np.uint8)
    save(Image.fromarray(out, 'RGBA'), 'frond.png')

# ---------- water normal (textures.js waterNormal) ----------
def water_normal(S=512, seed=41):
    ys, xs = np.mgrid[0:S, 0:S].astype(np.float32)
    u = xs / S * math.tau; v = ys / S * math.tau
    h = np.sin(u * 2 + np.cos(v) * 0.6) * 0.6 + np.sin(v * 3 - u * 0.5) * 0.35
    h += tile_noise(S, 15, 4, seed) * 0.5 + tile_noise(S, 61, 2, seed + 1) * 0.18
    save(height_to_normal(h, 2.2), 'water_n.png')

# ---------- a sun-glitter / detail noise for the sea and the wet sand ----------
def noise_tile(S=512):
    n = tile_noise(S, 8, 5, 77)
    save(Image.fromarray((np.clip(n * 0.5 + 0.5, 0, 1) * 255).astype(np.uint8), 'L'), 'noise.png')

# ---------- backboard markings (court.js boardMarkings) ----------
def board_marks(W=512, H=300):
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.rectangle([5, 5, W - 6, H - 6], outline=(255, 255, 255, 255), width=9)
    sw = 0.61 / 1.83 * W; sh = 0.457 / 1.07 * H
    y1 = H - 0.15 / 1.07 * H
    d.rectangle([W / 2 - sw / 2, y1 - sh, W / 2 + sw / 2, y1], outline=(255, 255, 255, 255), width=7)
    save(img, 'boardmarks.png')

# ---------- the GOT NEXT ring and label (textures.js ringTexture / floorLabel) ----------
def ring(S=256):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.ellipse([S * 0.08, S * 0.08, S * 0.92, S * 0.92], outline=(255, 255, 255, 255), width=int(S * 0.07))
    save(img.filter(ImageFilter.GaussianBlur(1)), 'ring.png')
    lbl = Image.new('RGBA', (512, 112), (0, 0, 0, 0))
    if FONT_BLACK:
        ImageDraw.Draw(lbl).text((256, 56), 'GOT NEXT', fill=(255, 255, 255, 255), font=ImageFont.truetype(FONT_BLACK, 80), anchor='mm')
    save(lbl, 'gotnext.png')

if __name__ == '__main__':
    only = sys.argv[1:]
    todo = {
        'court': lambda: (court_overlay(THEME, False, THEME['logo']['size'], 'court_full.png'), court_overlay(THEME, True, 1.1, 'court_half2.png'), court_overlay(THEME, True, 0.9, 'court_half1.png')),
        'asphalt': asphalt, 'sand': sand, 'chainlink': chainlink, 'frond': frond_card, 'water': water_normal, 'noise': noise_tile, 'board': board_marks, 'ring': ring,
    }
    for k, f in todo.items():
        if not only or k in only: f()
