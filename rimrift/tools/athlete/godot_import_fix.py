"""After `godot --headless --import`: the groom/lash atlases Godot extracted from the glb must not get mipmaps (their
1-2 texel strands average under the alpha cutoff): python3 tools/athlete/godot_import_fix.py game/assets/athlete/metahuman
Rewrites the .import files (mipmaps/generate=false) — run the Godot import again afterwards. Idempotent."""
import sys, os, re, glob
d = sys.argv[1]; n = 0
for f in glob.glob(os.path.join(d, '*.import')):
    if not re.search(r'(mh_groom_\w+|Eyelashes_Color)\.(png|jpg)\.import$', f): continue
    s = open(f).read()
    if 'mipmaps/generate=false' in s: continue
    s2 = re.sub(r'mipmaps/generate=\w+', 'mipmaps/generate=false', s) if 'mipmaps/generate=' in s else s.replace('[params]', '[params]\nmipmaps/generate=false')
    open(f, 'w').write(s2); n += 1; print('[import-fix]', os.path.basename(f))
print(f'[import-fix] {n} files changed')
