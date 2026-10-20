#!/usr/bin/env python3
"""De-light the Meshy athlete's albedo for Harbor Point's dynamic sun (look pass 3, World agent).

  python3 tools/athlete/delight_meshy.py [--dir game/assets/athlete/meshy/athlete_v1] [--strength 0.7] [--stats]

Meshy bakes its own soft studio lighting and AO into the albedo (the arms shade from 0.33 to 0.59 luma across one
limb; a real skin albedo is nearly flat), which fights the sun: the baked gradient shows through on the lit side and
doubles up with the real shadow on the dark side. This writes, next to the glb (the glb itself is untouched):

  <albedo>_lit.jpg   the albedo with the low-frequency shading divided out per material class (skin / dark jersey /
                     white socks+shoes / orange trim), pores and mesh weave kept (high frequencies pass through);
                     the skin nudged warmer toward the character sheet (its Meshy tone is pinker and paler), the jersey darker and a
                     touch cool (the warm sun made it brown), the whites down to the sheet's ~0.65 so they do not clip.
  <orm>_lit.png      ORM with per-class roughness (skin 0.48 for the sun's sheen, jersey mesh 0.80, trim 0.72,
                     socks/shoes 0.62), Meshy's own roughness variation kept at half amplitude; AO = 1, metallic as is.

AthleteDriver.TuneMaterials swaps these in at load for the MeshyAthlete material when they exist. Classes are found
by hue/saturation in the texture (the Meshy atlas has no material ids); the blur that estimates the baked shading is a
normalised convolution inside each class, so islands do not bleed into each other or into the black background.
"""
import argparse, glob, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

ap = argparse.ArgumentParser()
ap.add_argument('--dir', default=os.path.join(os.path.dirname(__file__), '..', '..', 'game', 'assets', 'athlete', 'meshy', 'athlete_v1'))
ap.add_argument('--strength', type=float, default=0.7, help='how much of the baked low-frequency shading to remove (0..1)')
ap.add_argument('--sigma', type=float, default=36.0, help='blur radius (px at 4096) that separates shading from detail')
ap.add_argument('--stats', action='store_true')
args = ap.parse_args()

alb_path = [p for p in glob.glob(os.path.join(args.dir, '*texture_0.png')) if '_lit' not in p][0]
orm_path = [p for p in glob.glob(os.path.join(args.dir, '*_orm.png')) if '_lit' not in p][0]
rgb = np.asarray(Image.open(alb_path).convert('RGB')).astype(np.float32) / 255
orm = np.asarray(Image.open(orm_path).convert('RGB')).astype(np.float32) / 255
H, W, _ = rgb.shape
scale = W / 4096.0

def classes(rgb):
    mx = rgb.max(-1); mn = rgb.min(-1); v = mx; s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]; d = np.maximum(mx - mn, 1e-6)
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    bg = v < 0.02
    skin = (~bg) & (h > 8) & (h < 40) & (s > 0.3) & (s < 0.8) & (v > 0.25)
    trim = (~bg) & (h > 15) & (h < 40) & (s >= 0.8) & (v > 0.45)
    white = (~bg) & (s < 0.2) & (v > 0.55)
    dark = (~bg) & (v < 0.3)
    other = (~bg) & ~(skin | trim | white | dark)
    return dict(skin=skin, trim=trim, white=white, dark=dark, other=other), bg

cls, bg = classes(rgb)
L = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]

# per class: how much to flatten, the target roughness, and a colour nudge
PLAN = {  # strength multiplier, roughness target, rgb gain
    'skin':  (1.0, 0.48, (1.00, 0.965, 0.90)),   # the sheet's skin is warmer / more saturated than Meshy's pinkish tone
    'dark':  (0.6, 0.80, (0.80, 0.84, 0.92)),   # the jersey: darker and a touch cool, so the warm sun reads charcoal (not brown) on it
    'white': (0.7, 0.62, (0.92, 0.92, 0.92)),   # socks/shoes: Meshy's 0.75 albedo clips white under the sun; the sheet's whites are ~0.65
    'trim':  (0.7, 0.72, (1.0, 1.0, 1.0)),
    'other': (0.3, None, (1.0, 1.0, 1.0)),
}
sig = args.sigma * scale
out = rgb.copy()
rough = orm[..., 1].copy()
for name, m in cls.items():
    if m.sum() == 0: continue
    k, rtarget, gain = PLAN[name]
    mf = m.astype(np.float32)
    # normalised convolution inside the class: blur(L*m) / blur(m)
    num = ndimage.gaussian_filter(L * mf, sig); den = ndimage.gaussian_filter(mf, sig)
    low = num / np.maximum(den, 1e-4)
    mean = L[m].mean()
    ratio = np.clip(mean / np.maximum(low, 1e-3), 0.55, 1.8)
    f = 1.0 + (ratio - 1.0) * (args.strength * k)
    out[m] = np.clip(rgb[m] * f[m][:, None] * np.array(gain, np.float32)[None, :], 0, 1)
    if rtarget is not None:
        rm = rough[m].mean()
        rough[m] = np.clip(rtarget + (rough[m] - rm) * 0.5, 0.05, 1.0)
    if args.stats:
        L2 = 0.2126 * out[..., 0] + 0.7152 * out[..., 1] + 0.0722 * out[..., 2]
        print(f'{name:6s} {m.mean()*100:5.1f}%  L {L[m].mean():.3f} sd {L[m].std():.3f} -> {L2[m].mean():.3f} sd {L2[m].std():.3f}   rough {orm[...,1][m].mean():.2f} -> {rough[m].mean():.2f}')

stem = alb_path[:-4]
lit_alb = stem + '_lit.jpg'
Image.fromarray((out * 255 + 0.5).astype(np.uint8)).save(lit_alb, quality=93, subsampling=0)
orm2 = orm.copy(); orm2[..., 1] = rough; orm2[..., 0] = 1.0
lit_orm = orm_path[:-4] + '_lit.png'
Image.fromarray((orm2 * 255 + 0.5).astype(np.uint8)).save(lit_orm, optimize=True)
print('wrote', lit_alb, round(os.path.getsize(lit_alb) / 1e6, 2), 'MB;', lit_orm, round(os.path.getsize(lit_orm) / 1e6, 2), 'MB')
