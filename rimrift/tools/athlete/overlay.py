"""Draws the joint segments (json from check_render.py) over a render. python3 overlay.py image.png joints.json"""
import sys, json
from PIL import Image, ImageDraw
im = Image.open(sys.argv[1]).convert('RGB'); dr = ImageDraw.Draw(im)
for n, a, b in json.load(open(sys.argv[2])):
    dr.line([tuple(a), tuple(b)], fill=(255, 220, 0), width=2)
    dr.ellipse([a[0] - 3, a[1] - 3, a[0] + 3, a[1] + 3], fill=(255, 60, 30))
im.save(sys.argv[1])
