"""Our 21-bone skeleton in Python (a transcription of client/js/char/skeleton.js, the same numbers as Rimrift.Anim's
Skeleton.cs) so the Blender pipeline can build the armature at the exact bind positions for a build.
Coordinates here are the game's: metres, y up, facing +Z, left +X. to_blender() turns them into Blender's Z-up/-Y-forward."""
import math

BONES = ['hips', 'spine', 'chest', 'neck', 'head',
         'clavL', 'upperL', 'foreL', 'handL',
         'clavR', 'upperR', 'foreR', 'handR',
         'thighL', 'shinL', 'footL', 'toeL',
         'thighR', 'shinR', 'footR', 'toeR']
B = {n: i for i, n in enumerate(BONES)}
PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 7, 2, 9, 10, 11, 0, 13, 14, 15, 0, 17, 18, 19]
ARM_ANGLE = 40 * math.pi / 180
INCH = 0.0254


def body_dims(height=77, weight=215, wingspan=80):
    H = height * INCH
    W = weight * 0.4536
    WS = wingspan * INCH
    bmi = W / (H * H)
    girth = max(0.86, min(1.28, math.sqrt(bmi / 23.5)))
    muscle = max(0.9, min(1.2, 1 + (bmi - 24) * 0.03))
    shoulderX = 0.094 * H * min(1.1, girth * 0.5 + 0.52)
    armScale = max(0.8, (WS / 2 - shoulderX) / (0.424 * H))
    d = dict(H=H, W=W, WS=WS, girth=girth, muscle=muscle, armScale=armScale,
             hipY=0.535 * H, spineLen=0.075 * H, chestLen=0.10 * H, neckLen=0.115 * H, headLen=0.05 * H,
             clavX=0.022 * H, clavY=0.097 * H, shoulderX=shoulderX,
             upperLen=0.172 * H * armScale, foreLen=0.148 * H * armScale, handLen=0.104 * H * armScale,
             hipX=0.05 * H * min(1.1, girth), hipDrop=0.03 * H,
             thighLen=0.235 * H, shinLen=0.23 * H, ankleY=0.04 * H, footLen=0.152 * H, toeFwd=0.105 * H, headR=0.063 * H)
    return d


def bind_offsets(d):
    off = [None] * len(BONES)
    s, c = math.sin(ARM_ANGLE), math.cos(ARM_ANGLE)
    H = d['H']
    off[B['hips']] = [0, d['hipY'], 0]
    off[B['spine']] = [0, d['spineLen'], -0.004 * H]
    off[B['chest']] = [0, d['chestLen'], 0]
    off[B['neck']] = [0, d['neckLen'], -0.006 * H]
    off[B['head']] = [0, d['headLen'], 0.006 * H]
    for side, sg in (('L', 1), ('R', -1)):
        off[B['clav' + side]] = [sg * d['clavX'], d['clavY'], -0.004 * H]
        off[B['upper' + side]] = [sg * (d['shoulderX'] - d['clavX']), 0.002 * H, -0.004 * H]
        off[B['fore' + side]] = [sg * s * d['upperLen'], -c * d['upperLen'], 0]
        off[B['hand' + side]] = [sg * s * d['foreLen'], -c * d['foreLen'], 0]
        off[B['thigh' + side]] = [sg * d['hipX'], -d['hipDrop'], 0.004 * H]
        off[B['shin' + side]] = [0, -d['thighLen'], 0.004 * H]
        off[B['foot' + side]] = [0, -d['shinLen'], -0.006 * H]
        off[B['toe' + side]] = [0, -(d['hipY'] - d['hipDrop'] - d['thighLen'] - d['shinLen']) + 0.012 * H, d['toeFwd']]
    return off


def bind_positions(off):
    pos = [None] * len(BONES)
    for i in range(len(BONES)):
        p = PARENT[i]
        pos[i] = list(off[i]) if p < 0 else [pos[p][k] + off[i][k] for k in range(3)]
    return pos


# leaf bone tails (game space offsets from the joint) so every Blender bone has a length
def leaf_tails(d, pos):
    H = d['H']
    s, c = math.sin(ARM_ANGLE), math.cos(ARM_ANGLE)
    t = {}
    t['head'] = [0, H, pos[B['head']][2]]  # (the top of the head: the mesh's crown lands exactly at H)
    for side, sg in (('L', 1), ('R', -1)):
        h = pos[B['hand' + side]]
        t['hand' + side] = [h[0] + sg * s * d['handLen'], h[1] - c * d['handLen'], h[2]]
        tp = pos[B['toe' + side]]
        t['toe' + side] = [tp[0], tp[1], tp[2] + (d['footLen'] - d['toeFwd'])]
    return t


def to_blender(v):
    """game (x, y, z) y-up facing +Z -> Blender (x, -z, y) z-up facing -Y. (glTF export with +Y up maps back exactly)"""
    return (v[0], -v[2], v[1])


def from_blender(v):
    return (v[0], v[2], -v[1])
