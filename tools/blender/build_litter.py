"""Models the litter that turns up on the floors — crumpled paper, a dented can,
a banana peel, a crisp packet and a scatter of crumbs — and exports it as one
GLB for the game to copy pieces from.

Run it inside Blender with assets/blender/house.blend open:

    exec(open(r"<repo>/tools/blender/build_litter.py").read())

It borrows the helpers and materials from build_props.py (everything above its
"furniture modelled from the concept images" line), rebuilds the
"Nongs Litter" collection south of the cooking kit, and writes
assets/converted/litter.glb. Each object keeps its own name (litter_*), so the
game can find and copy it.

Like the furniture, the litter is modelled at real size and enlarged by SCALE.
The origin is on the floor under the object's centre.
"""
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

_here = os.path.dirname(bpy.data.filepath) if bpy.data.filepath else ''
_props_src = os.path.normpath(os.path.join(_here, '..', '..', 'tools', 'blender', 'build_props.py'))
with open(_props_src, encoding='utf-8') as _f:
    _src = _f.read()
exec(_src[:_src.index('# ---- furniture modelled from the concept images ----')])


def jitter(bm, amount, seed):
    """Moves each vertex a little at random, for crumpled and squashed shapes."""
    rnd = random.Random(seed)
    for v in bm.verts:
        v.co += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * amount
    return bm


def lying(bm):
    """Turns an upright shape (along Z) to lie along X."""
    bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'Y'))
    return bm


def sheet(sx, sy, cuts):
    """A flat, thin rectangle with enough vertices to bend."""
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=cuts, y_segments=cuts, size=0.5)
    bmesh.ops.scale(bm, vec=(sx, sy, 1), verts=bm.verts[:])
    return bm


def thicken(bm, t):
    """Gives a sheet a little thickness, so it shows from both sides."""
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=t)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def sit_on_floor(bm):
    lowest = min(v.co.z for v in bm.verts)
    bmesh.ops.translate(bm, vec=(0, 0, -lowest), verts=bm.verts[:])
    return bm


# ---- materials ----
PAPER = mat('Litter Paper', 0xf4f1e8, 0.9)
PAPER_LINES = mat('Litter Paper Lines', 0xa9c4e0, 0.9)
CAN = mat('Litter Can', 0xd9483b, 0.35)
CAN_TOP = mat('Litter Can Top', 0xdfe3e8, 0.3)       # plain light grey: nothing in the game may be metallic
CAN_BAND = mat('Litter Can Band', 0xfbf8f1, 0.35)
PEEL = mat('Litter Peel', 0xf2cf4a, 0.55)
PEEL_IN = mat('Litter Peel Inside', 0xf6ecc4, 0.7)
PEEL_TIP = mat('Litter Peel Tip', 0x5a4632, 0.7)
WRAPPER = mat('Litter Wrapper', 0x4f8fd6, 0.25)
WRAPPER_IN = mat('Litter Wrapper Inside', 0xe6e8ec, 0.2)
WRAPPER_LABEL = mat('Litter Wrapper Label', 0xf7c23b, 0.3)
CRUMB = mat('Litter Crumb', 0xc9945a, 0.85)
CRUMB_DARK = mat('Litter Crumb Dark', 0x8e6236, 0.85)
SPILL = mat('Litter Spill', 0xf0a347, 0.05)   # orange juice, glossy

LITTER = []


def litter(fn):
    LITTER.append(fn)
    return fn


@litter
def paper_ball():
    p = Prop('litter_paper')  # a sheet of notepaper screwed up into a ball, 7 cm across
    b = jitter(ball(0.036, 0.034, 0.03, 12, 8), 0.007, 1)
    p.add(sit_on_floor(b), PAPER, smooth=False)
    # A few creases standing out, with the ruled lines of the page on one.
    rnd = random.Random(4)
    for i in range(4):
        a = 2 * math.pi * i / 4 + rnd.uniform(-0.3, 0.3)
        flap = jitter(plate(0.03, 0.022, 0.002, 0.004, 2), 0.002, 10 + i)
        p.add(flap, PAPER_LINES if i == 0 else PAPER,
              (0.026 * math.cos(a), 0.026 * math.sin(a), 0.03 + rnd.uniform(-0.008, 0.012)),
              (rnd.uniform(-40, 40), rnd.uniform(30, 70), math.degrees(a)), smooth=False)
    return p


@litter
def soda_can():
    p = Prop('litter_can')  # a drinks can lying on its side, dented in the middle
    body = cyl(0.033, 0.033, 0.115, round_bottom=0.006, round_top=0.006, segs=20)
    for v in body.verts:
        squeeze = math.exp(-(v.co.z / 0.025) ** 2)  # pinched around the waist
        if v.co.x > 0:
            v.co.x *= 1 - 0.35 * squeeze
        v.co.y *= 1 - 0.08 * squeeze
    p.add(lying(body), CAN, (0, 0, 0.032))
    p.add(lying(cyl(0.0335, 0.0335, 0.03, segs=20)), CAN_BAND, (0.035, 0, 0.032))
    for s in (-1, 1):
        p.add(lying(cyl(0.027, 0.027, 0.004, segs=20)), CAN_TOP, (s * 0.058, 0, 0.032))
    p.add(rbox(0.003, 0.012, 0.02, 0.0015, 1), CAN_TOP, (0.061, 0, 0.04))  # the ring pull
    return p


@litter
def banana_peel():
    p = Prop('litter_peel')  # an eaten banana's peel, its four strips spread out
    for i in range(4):
        a = math.radians(90 * i + 20)
        strip = sheet(0.12, 0.032, 8)
        for v in strip.verts:
            t = (v.co.x + 0.06) / 0.12               # 0 at the stalk, 1 at the tip
            v.co.y *= 1 - 0.55 * t ** 1.5             # narrows to a point
            v.co.z = 0.012 * math.sin(math.pi * t) + 0.01 * (1 - t) - abs(v.co.y) * 0.3  # curls up a little
        thicken(strip, 0.003)
        lift = 0.004
        p.add(strip, PEEL, (0.06 * math.cos(a), 0.06 * math.sin(a), lift), (0, 0, math.degrees(a)))
        inner = sheet(0.11, 0.024, 6)
        for v in inner.verts:
            t = (v.co.x + 0.055) / 0.11
            v.co.y *= 1 - 0.55 * t ** 1.5
            v.co.z = 0.012 * math.sin(math.pi * t) + 0.01 * (1 - t) - abs(v.co.y) * 0.3
        p.add(inner, PEEL_IN, (0.06 * math.cos(a), 0.06 * math.sin(a), lift + 0.0035), (0, 0, math.degrees(a)))
        p.add(ball(0.004, 0.004, 0.003, 8, 4), PEEL_TIP,
              (0.118 * math.cos(a), 0.118 * math.sin(a), lift + 0.002))
    p.add(cyl(0.011, 0.008, 0.035, round_top=0.003, segs=10), PEEL, (0, 0, 0.022), (0, 70, 0))
    p.add(cyl(0.0085, 0.0085, 0.004, segs=10), PEEL_TIP, (0.017, 0, 0.028), (0, 70, 0))
    return p


@litter
def crisp_packet():
    p = Prop('litter_wrapper')  # an empty crisp packet, flattened and creased
    bag = sheet(0.13, 0.17, 10)
    rnd = random.Random(7)
    for v in bag.verts:
        u, w = v.co.x / 0.065, v.co.y / 0.085
        v.co.z = 0.012 * (1 - u * u) * (1 - w * w) + rnd.uniform(0, 0.004)
    thicken(bag, 0.002)
    p.add(bag, WRAPPER, smooth=False)
    inside = sheet(0.12, 0.012, 4)  # the torn-open end, showing the silver inside
    p.add(thicken(jitter(inside, 0.002, 3), 0.0015), WRAPPER_IN, (0, 0.087, 0.004), (15, 0, 0), smooth=False)
    p.add(plate(0.13, 0.012, 0.0025, 0.001, 1), WRAPPER, (0, -0.088, 0.002))  # crimped seal
    label = jitter(sheet(0.07, 0.05, 3), 0.001, 5)
    p.add(thicken(label, 0.001), WRAPPER_LABEL, (0, 0.01, 0.0135), (0, 0, 8), smooth=False)
    return p


@litter
def spill():
    p = Prop('litter_spill')  # a puddle of spilt juice, about 30 cm across: the mop's job, not the broom's
    rnd = random.Random(21)
    steps = 40
    rim = []
    for k in range(steps):
        a = 2 * math.pi * k / steps
        r = 0.13 * (1 + 0.18 * math.sin(3 * a + 0.5) + 0.1 * math.sin(5 * a + 1.3) + rnd.uniform(-0.03, 0.03))
        rim.append((r * math.cos(a) * 1.15, r * math.sin(a)))
    bm = bmesh.new()
    top = [bm.verts.new((x, y, 0.004)) for x, y in rim]
    bottom = [bm.verts.new((x * 0.97, y * 0.97, 0.0)) for x, y in rim]
    centre = bm.verts.new((0, 0, 0.005))
    for k in range(steps):
        j = (k + 1) % steps
        bm.faces.new((centre, top[k], top[j]))
        bm.faces.new((bottom[k], bottom[j], top[j], top[k]))
    bm.faces.new(bottom[::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    p.add(bm, SPILL)
    for i in range(5):  # splashes beside the puddle
        a = rnd.uniform(0, 2 * math.pi)
        r = rnd.uniform(0.18, 0.24)
        s = rnd.uniform(0.012, 0.025)
        p.add(cyl(s, s * 0.9, 0.004, segs=12), SPILL, (r * math.cos(a) * 1.1, r * math.sin(a), 0.002))
    return p


@litter
def crumbs():
    p = Prop('litter_crumbs')  # biscuit crumbs and a broken half biscuit, about 18 cm across
    rnd = random.Random(12)
    half = cyl(0.03, 0.03, 0.008, round_top=0.002, segs=18)
    half.verts.ensure_lookup_table()
    bmesh.ops.bisect_plane(half, geom=half.verts[:] + half.edges[:] + half.faces[:], plane_co=(0.004, 0, 0),
                           plane_no=(1, 0.2, 0), clear_outer=True)
    bmesh.ops.contextual_create(half, geom=[e for e in half.edges if e.is_boundary])
    jitter(half, 0.0012, 2)
    p.add(half, CRUMB, (0.025, 0.01, 0.004), (0, 0, -20), smooth=False)
    for i in range(18):
        a, r = rnd.uniform(0, 2 * math.pi), 0.085 * math.sqrt(rnd.random())
        s = rnd.uniform(0.003, 0.008)
        bit = jitter(rbox(s, s * rnd.uniform(0.7, 1.3), s * 0.6, s * 0.2, 1), s * 0.15, 20 + i)
        p.add(bit, CRUMB_DARK if i % 4 == 0 else CRUMB, (r * math.cos(a), r * math.sin(a), s * 0.3),
              (0, 0, rnd.uniform(0, 180)), smooth=False)
    return p


# ---- build into the "Nongs Litter" collection, in a row south of the cooking kit ----
ROW_Y_LITTER, SPACING_LITTER = -46, 0.6
litter_coll = bpy.data.collections.get('Nongs Litter')
if litter_coll:
    for o in list(litter_coll.objects):
        bpy.data.objects.remove(o, do_unlink=True)
else:
    litter_coll = bpy.data.collections.new('Nongs Litter')
    bpy.context.scene.collection.children.link(litter_coll)
for me in list(bpy.data.meshes):
    if me.users == 0:
        bpy.data.meshes.remove(me)

litter_objects = []
for i, build in enumerate(LITTER):
    o = build().finish(litter_coll)
    o.location = ((i - (len(LITTER) - 1) / 2) * SPACING_LITTER, ROW_Y_LITTER, 0)
    litter_objects.append(o)


def export_litter():
    if not bpy.data.filepath:
        print('Not exported: open assets/blender/house.blend first.')
        return
    out = os.path.normpath(os.path.join(os.path.dirname(bpy.data.filepath), '..', 'converted', 'litter.glb'))
    for o in bpy.context.view_layer.objects:
        o.select_set(o in litter_objects)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, use_visible=True,
                              export_apply=True, export_yup=True, export_image_format='JPEG',
                              export_jpeg_quality=85)
    for o in litter_objects:
        o.select_set(False)
    bpy.ops.wm.save_mainfile()
    print('exported', out, os.path.getsize(out), 'bytes')


if globals().get('EXPORT', True):
    export_litter()
