"""Contact sheets for an athlete's showroom renders (PIL):
  python3 tools/athlete/sheets.py --shots <dir with front/back/face/dribble/dip/set/release/land.png> --out <dir> [--label "MetaHuman v1"] [--compare <other shots dir> --compare-label Meshy]
Writes <out>/contact_sheet_vs_target.png (kit/RIMRIFT/images character sheet front/back + master-athlete-detail face
against ours, and optionally another run's) and <out>/motion_sheet.png (dribble, dip, set, release, land)."""
import argparse, os
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser(); ap.add_argument('--shots', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--label', default='OURS'); ap.add_argument('--compare'); ap.add_argument('--compare-label', default='MESHY')
ap.add_argument('--kit', default='/home/claude/ah/kit/RIMRIFT/images')
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
try: F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 20)
except Exception: F = ImageFont.load_default()
target = Image.open(os.path.join(a.kit, 'character-visual-target.png')).convert('RGB')
detail = Image.open(os.path.join(a.kit, 'master-athlete-detail.png')).convert('RGB')
W, H = target.size  # 1672 x 941: front panel ~ x 15..455, back ~ 470..905, face ~ 915..1650 (y 45..615)
t_front = target.crop((int(W * 0.009), int(H * 0.045), int(W * 0.272), int(H * 0.915)))
t_back = target.crop((int(W * 0.282), int(H * 0.045), int(W * 0.545), int(H * 0.915)))
t_face = target.crop((int(W * 0.548), int(H * 0.045), int(W * 0.99), int(H * 0.655)))
PH = 760


def fit_h(im, h):
    return im.resize((int(im.width * h / im.height), h), Image.LANCZOS)


def crop_center(path, frac_w=0.42):
    im = Image.open(path).convert('RGB'); w, h = im.size
    return im.crop((int(w * (0.5 - frac_w / 2)), 0, int(w * (0.5 + frac_w / 2)), h))


def panel(im, label, h=PH):
    im = fit_h(im, h); out = Image.new('RGB', (im.width, h + 30), (20, 20, 22)); out.paste(im, (0, 30))
    ImageDraw.Draw(out).text((6, 5), label, fill=(240, 240, 240), font=F); return out


cols = [panel(t_front, 'SHEET front'), panel(crop_center(os.path.join(a.shots, 'front.png')), a.label + ' front (Godot)')]
if a.compare: cols.append(panel(crop_center(os.path.join(a.compare, 'front.png')), a.compare_label + ' front'))
cols += [panel(t_back, 'SHEET back'), panel(crop_center(os.path.join(a.shots, 'back.png')), a.label + ' back')]
if a.compare: cols.append(panel(crop_center(os.path.join(a.compare, 'back.png')), a.compare_label + ' back'))
row1 = Image.new('RGB', (sum(c.width for c in cols) + 10 * (len(cols) - 1), PH + 30), (12, 12, 14)); x = 0
for c in cols: row1.paste(c, (x, 0)); x += c.width + 10
FH = 560
face = Image.open(os.path.join(a.shots, 'face.png')).convert('RGB'); fw, fh = face.size
face = face.crop((int(fw * 0.2), 0, int(fw * 0.8), fh))
cols2 = [panel(detail, 'SHEET face (master-athlete-detail)', FH), panel(t_face, 'SHEET face & materials', FH), panel(face, a.label + ' face (Godot)', FH)]
if a.compare:
    cf = Image.open(os.path.join(a.compare, 'face.png')).convert('RGB'); cols2.append(panel(cf.crop((int(fw * 0.2), 0, int(fw * 0.8), fh)), a.compare_label + ' face', FH))
row2 = Image.new('RGB', (sum(c.width for c in cols2) + 10 * (len(cols2) - 1), FH + 30), (12, 12, 14)); x = 0
for c in cols2: row2.paste(c, (x, 0)); x += c.width + 10
sheet = Image.new('RGB', (max(row1.width, row2.width), row1.height + row2.height + 10), (12, 12, 14))
sheet.paste(row1, (0, 0)); sheet.paste(row2, (0, row1.height + 10))
p = os.path.join(a.out, 'contact_sheet_vs_target.png'); sheet.save(p); print('[sheet]', p, sheet.size)

shots = [('dribble', 'dribble 2.30 s'), ('dip', 'jumper: dip (t=0.13)'), ('set', 'set (t=0.45, airborne)'), ('release', 'release (t=0.60)'), ('land', 'landing (t=1.02)')]
cols = []
for n, lab in shots:
    im = Image.open(os.path.join(a.shots, n + '.png')).convert('RGB'); w, h = im.size
    cols.append(panel(im.crop((int(w * 0.2), 0, int(w * 0.8), h)), lab, 700))
ms = Image.new('RGB', (sum(c.width for c in cols) + 10 * (len(cols) - 1), 730), (12, 12, 14)); x = 0
for c in cols: ms.paste(c, (x, 0)); x += c.width + 10
p = os.path.join(a.out, 'motion_sheet.png'); ms.save(p); print('[sheet]', p, ms.size)
