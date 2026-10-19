"""Debug renders for the pipeline (Cycles CPU, orthographic front/side/back), with the armature's joints drawn over:
  blender -b --python tools/athlete/check_render.py -- --blend <file.blend> --out <png prefix> [--views front side back] [--res 500]
"""
import bpy, sys, os, argparse, json, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--blend', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--views', nargs='+', default=['front', 'side'])
ap.add_argument('--res', type=int, default=500)
ap.add_argument('--samples', type=int, default=24)
ap.add_argument('--nojoints', action='store_true')
args = ap.parse_args(argv)
bpy.ops.wm.open_mainfile(filepath=args.blend)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = args.samples
scene.cycles.use_denoising = False
scene.cycles.device = 'CPU'
scene.render.resolution_x = args.res; scene.render.resolution_y = args.res * 2
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
world = bpy.data.worlds.new('W') if not scene.world else scene.world
scene.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.35, 0.35, 0.38, 1); bg.inputs[1].default_value = 1.0
# key light
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN')); scene.collection.objects.link(sun)
sun.data.energy = 3.0; sun.rotation_euler = (math.radians(55), math.radians(-20), math.radians(-30))
cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')); scene.collection.objects.link(cam); scene.camera = cam
cam.data.type = 'ORTHO'
H = 2.1
cam.data.ortho_scale = H
rig = next((o for o in scene.objects if o.type == 'ARMATURE'), None)
joints = {}
if rig is not None:
    for b in rig.data.bones:
        joints[b.name] = (rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local)
for view in args.views:
    if view == 'front': cam.location = (0, -6, H / 2); cam.rotation_euler = (math.radians(90), 0, 0)
    elif view == 'back': cam.location = (0, 6, H / 2); cam.rotation_euler = (math.radians(90), 0, math.radians(180))
    elif view == 'side': cam.location = (6, 0, H / 2); cam.rotation_euler = (math.radians(90), 0, math.radians(90))
    elif view == 'face':
        cam.data.ortho_scale = 0.45; cam.location = (0, -6, 1.85 * 0.92); cam.rotation_euler = (math.radians(90), 0, 0)
    out = f'{args.out}_{view}.png'
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    if joints and not args.nojoints:
        W, Hp = scene.render.resolution_x, scene.render.resolution_y; sc = cam.data.ortho_scale
        def proj(p):
            if view == 'front' or view == 'face': u, v, cx = p.x, p.z, cam.location.x
            elif view == 'back': u, v, cx = -p.x, p.z, -cam.location.x
            else: u, v, cx = p.y, p.z, cam.location.y
            return ((u - cx) / (sc / 2) + 0.5) * W, (0.5 - (v - cam.location.z) / sc) * Hp
        segs = [[n, list(proj(h)), list(proj(t))] for n, (h, t) in joints.items()]
        json.dump(segs, open(f'{args.out}_{view}_joints.json', 'w'))
        os.system(f'python3 {os.path.join(os.path.dirname(os.path.abspath(__file__)), "overlay.py")} {out} {args.out}_{view}_joints.json')
    print('[check] wrote', out)
