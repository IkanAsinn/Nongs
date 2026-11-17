"""Models the cooking kit — tools, ingredients, cut pieces and finished dishes —
and exports it as one GLB for the cooking minigame.

Run it inside Blender with assets/blender/house.blend open:

    exec(open(r"<repo>/tools/blender/build_kitchen_kit.py").read())

It borrows the helpers and materials from build_props.py (everything above its
"furniture modelled from the concept images" line), rebuilds the
"Nongs Cooking Kit" collection south of the props, and writes
assets/converted/cooking_kit.glb. Each object keeps its own name (kit_*), so
the game can find and copy it.

Like the furniture, the kit is modelled at real size and enlarged by SCALE,
so a knife looks right beside the enlarged worktops.
Front is −Y (game +Z); the origin is on the surface under the object's centre.
Handles of the knife, pan and pot point to +Y: towards the cook.
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

_here = os.path.dirname(bpy.data.filepath) if bpy.data.filepath else ''
_props_src = os.path.normpath(os.path.join(_here, '..', '..', 'tools', 'blender', 'build_props.py'))
with open(_props_src, encoding='utf-8') as _f:
    _src = _f.read()
exec(_src[:_src.index('# ---- furniture modelled from the concept images ----')])


# ---- extra shapes ----
def tube(points, radius, segs=8, closed=False):
    """A round wire swept along a list of points."""
    bm = bmesh.new()
    pts = [Vector(p) for p in points]
    n = len(pts)
    rings = []
    normal = None
    for i, p in enumerate(pts):
        if closed:
            t = (pts[(i + 1) % n] - pts[i - 1]).normalized()
        else:
            t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        if normal is None:
            helper = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            normal = t.cross(helper).normalized()
        normal = (normal - t * normal.dot(t)).normalized()  # carried along the wire, so it does not twist
        binormal = t.cross(normal)
        rings.append([bm.verts.new(p + radius * (math.cos(a) * normal + math.sin(a) * binormal))
                      for a in (2 * math.pi * k / segs for k in range(segs))])
    pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if closed else [])
    for a, b in pairs:
        for k in range(segs):
            bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
    if not closed:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def lying(bm):
    """Turns an upright shape (along Z) to lie along X."""
    bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'Y'))
    return bm


def bowl_shape(r, h, wall=0.006, foot=0.5):
    """A hollow round bowl standing on the origin."""
    return lathe([(r * foot, 0.0), (r * (foot + 0.15), 0.004), (r * 0.82, h * 0.35), (r * 0.98, h * 0.8), (r, h),
                  (r - wall, h), (r - wall - 0.002, h * 0.8), (r * 0.8 - wall, h * 0.35), (r * foot - wall, wall)], 6)


def crumple(bm, amount, seed):
    """Moves each vertex a little at random: lettuce, rice, crumbs."""
    import random
    rnd = random.Random(seed)
    for v in bm.verts:
        v.co += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * amount
    return bm


# ---- materials ----
STEEL = mat('Kit Steel', 0xdfe3e8, 0.3)           # plain light grey: nothing in the game may be metallic
PAN = mat('Kit Pan', 0x34343a, 0.45)
POT_RED = mat('Kit Pot', 0xe0706a, 0.45)
CERAMIC = mat('Kit Ceramic', 0xfbf8f1, 0.3)
BLUE_RIM = mat('Kit Blue Rim', 0x8fb8de, 0.4)
KNIFE_GRIP = mat('Kit Knife Grip', 0x3b2f2a, 0.5)
SPOON_WOOD = mat('Kit Spoon Wood', 0xd9ae7a, 0.6, tex='wood', tile=0.2)
CARROT = mat('Kit Carrot', 0xf08a2e, 0.6)
CARROT_IN = mat('Kit Carrot Inside', 0xf6a64d, 0.6)
TOMATO = mat('Kit Tomato', 0xe0412f, 0.35)
TOMATO_IN = mat('Kit Tomato Inside', 0xf0705a, 0.5)
SEED = mat('Kit Seed', 0xf5d77a, 0.5)
GREEN = mat('Kit Green', 0x5ea84f, 0.6)
LIGHT_GREEN = mat('Kit Light Green', 0xa9d77c, 0.7)
PALE_GREEN = mat('Kit Pale Green', 0xd8efb8, 0.6)
CUKE = mat('Kit Cucumber', 0x3f7d3a, 0.45)
WHITE_ONION = mat('Kit Scallion White', 0xf3f2e4, 0.5)
EGG = mat('Kit Egg', 0xf6e8d2, 0.4)
YOLK = mat('Kit Yolk', 0xf7c23b, 0.4)
MEAT = mat('Kit Meat', 0xc24a4a, 0.6)
FAT = mat('Kit Fat', 0xf2e2d6, 0.6)
COOKED_MEAT = mat('Kit Cooked Meat', 0x7a4a33, 0.6)
GRILL = mat('Kit Grill Mark', 0x3d2418, 0.7)
MUSHROOM = mat('Kit Mushroom', 0xc9a27e, 0.7)
MUSHROOM_IN = mat('Kit Mushroom Inside', 0xf1e6d4, 0.7)
RICE = mat('Kit Rice', 0xfaf6ea, 0.8)
FRIED_RICE = mat('Kit Fried Rice', 0xe9be6a, 0.8)
BATTER = mat('Kit Batter', 0xf6e3b0, 0.4)
PANCAKE = mat('Kit Pancake', 0xd99a4e, 0.7)
BUTTER = mat('Kit Butter', 0xfbe38a, 0.4)
SYRUP = mat('Kit Syrup', 0xa8551f, 0.15)
OMELETTE = mat('Kit Omelette', 0xf5cf58, 0.5)
SOUP = mat('Kit Soup', 0xe0663f, 0.2)
SOY = mat('Kit Soy', 0x3a2219, 0.2)
CAP_RED = mat('Kit Cap Red', 0xd9483b, 0.5)
SALT = mat('Kit Salt', 0xffffff, 0.4)

KIT = []


def kit(fn):
    KIT.append(fn)
    return fn


# ---- tools ----
@kit
def board():
    p = Prop('kit_board')  # 0.38 × 0.26 chopping board
    p.add(soft_plate(0.38, 0.26, 0.022, 0.03, 0.006), SPOON_WOOD, (0, 0, 0.011))
    return p


@kit
def knife():
    p = Prop('kit_knife')  # origin at the bolster, on the cutting edge's line; blade forward (−Y)
    blade = slab([(0, 0.032), (0, -0.002), (0.15, -0.001), (0.195, 0.012), (0.215, 0.032)], 0.003)
    bmesh.ops.rotate(blade, verts=blade.verts[:], cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-90), 3, 'Z'))
    p.add(blade, STEEL, (0, 0, 0), smooth=False)
    p.add(rbox(0.012, 0.012, 0.034, 0.004, 2), STEEL, (0, 0.004, 0.017))
    p.add(rbox(0.022, 0.11, 0.028, 0.009, 3), KNIFE_GRIP, (0, 0.062, 0.02))
    for y in (0.035, 0.065, 0.095):
        p.add(cyl(0.004, 0.004, 0.024, segs=8), STEEL, (0, y, 0.02), (0, 90, 0))
    return p


@kit
def mixing_bowl():
    p = Prop('kit_bowl')  # 0.22 across
    p.add(bowl_shape(0.11, 0.085), CERAMIC)
    p.add(tube([(0.11 * math.cos(a), 0.11 * math.sin(a), 0.084) for a in
                (2 * math.pi * k / 32 for k in range(32))], 0.004, 6, closed=True), BLUE_RIM)
    return p


@kit
def bowl_fill():
    p = Prop('kit_bowl_fill')  # what is mixed in the bowl; the game tints it per recipe
    p.add(cyl(0.088, 0.096, 0.012, segs=24), BATTER, (0, 0, 0.055))
    return p


@kit
def whisk():
    p = Prop('kit_whisk')  # upright: wires at the bottom, handle up
    p.add(cyl(0.013, 0.011, 0.12, round_top=0.006, segs=12), SPOON_WOOD, (0, 0, 0.2))
    for k in range(6):
        a = math.pi * k / 6
        pts = []
        for i in range(25):
            t = math.pi * i / 24
            w = 0.035 * math.sin(t) * (0.6 + 0.4 * math.sin(t))
            pts.append((w * math.cos(a), w * math.sin(a), 0.145 - 0.135 * math.sin(t) ** 0.7))
        pts = [(0, 0, 0.145)] + pts[1:-1] + [(0, 0, 0.145)]
        p.add(tube(pts, 0.0022, 5), STEEL)
    return p


@kit
def frying_pan():
    p = Prop('kit_pan')  # 0.28 across; handle towards +Y
    p.add(lathe([(0.1, 0.0), (0.12, 0.004), (0.135, 0.02), (0.142, 0.042), (0.136, 0.042), (0.128, 0.022),
                 (0.112, 0.007), (0.09, 0.006)], 7), PAN)
    p.add(tube([(0, 0.125, 0.03), (0, 0.15, 0.038), (0, 0.19, 0.047)], 0.009, 8), PAN)
    p.add(rbox(0.03, 0.16, 0.022, 0.01, 3), KNIFE_GRIP, (0, 0.265, 0.06), (12, 0, 0))
    return p


@kit
def pot():
    p = Prop('kit_pot')  # 0.24 across, 0.14 high
    p.add(lathe([(0.1, 0.0), (0.115, 0.006), (0.12, 0.03), (0.12, 0.13), (0.126, 0.14), (0.114, 0.14),
                 (0.112, 0.13), (0.112, 0.03), (0.1, 0.008)], 7), POT_RED)
    for s in (-1, 1):
        p.add(tube([(s * 0.118, 0.025, 0.11), (s * 0.15, 0.022, 0.112), (s * 0.15, -0.022, 0.112),
                    (s * 0.118, -0.025, 0.11)], 0.007, 6), KNIFE_GRIP)
    return p


@kit
def spatula():
    p = Prop('kit_spatula')  # upright: blade at the bottom
    p.add(cyl(0.008, 0.009, 0.2, round_top=0.006, segs=10), SPOON_WOOD, (0, 0, 0.17))
    p.add(rbox(0.075, 0.008, 0.08, 0.004, 2), SPOON_WOOD, (0, 0, 0.04))
    return p


@kit
def wooden_spoon():
    p = Prop('kit_spoon')  # upright: bowl of the spoon at the bottom
    p.add(cyl(0.007, 0.008, 0.22, round_top=0.006, segs=10), SPOON_WOOD, (0, 0, 0.16))
    p.add(ball(0.03, 0.012, 0.042), SPOON_WOOD, (0, 0, 0.042))
    return p


@kit
def serving_plate():
    p = Prop('kit_plate')  # 0.26 across
    p.add(lathe([(0.07, 0.0), (0.08, 0.006), (0.1, 0.012), (0.13, 0.022), (0.126, 0.026), (0.096, 0.016),
                 (0.07, 0.012)], 7), CERAMIC)
    return p


@kit
def salt_shaker():
    p = Prop('kit_shaker')  # 0.1 high
    p.add(lathe([(0.022, 0.0), (0.026, 0.004), (0.026, 0.065), (0.022, 0.07)], 4), SALT)
    p.add(lathe([(0.023, 0.068), (0.024, 0.08), (0.016, 0.095), (0.004, 0.098)], 4), STEEL)
    return p


@kit
def soy_bottle():
    p = Prop('kit_soy')  # 0.17 high
    p.add(lathe([(0.026, 0.0), (0.03, 0.006), (0.03, 0.09), (0.016, 0.125), (0.012, 0.14)], 4), SOY)
    p.add(cyl(0.015, 0.015, 0.03, round_top=0.004, segs=12), CAP_RED, (0, 0, 0.152))
    p.add(cyl(0.031, 0.031, 0.04, segs=16), CERAMIC, (0, 0, 0.055))  # label
    return p


# ---- whole ingredients ----
@kit
def carrot():
    p = Prop('kit_carrot')  # 0.2 long, lying along X with the tip at +X
    body = lying(lathe([(0.018, -0.1), (0.022, -0.095), (0.02, -0.04), (0.014, 0.03), (0.006, 0.085), (0.002, 0.1)], 4))
    p.add(body, CARROT, (0, 0, 0.022))
    for i, a in enumerate((-25, 0, 25)):
        leaf = lying(cyl(0.004, 0.002, 0.07, segs=6))
        p.add(leaf, GREEN, (-0.13, 0.0, 0.022 + 0.01 * i - 0.01), (0, a * 0.6, a))
    return p


@kit
def tomato():
    p = Prop('kit_tomato')  # 0.075 across
    p.add(ball(0.038, 0.038, 0.032, 16, 10), TOMATO, (0, 0, 0.032))
    for k in range(5):
        a = 2 * math.pi * k / 5
        p.add(rbox(0.018, 0.006, 0.003, 0.001, 1), GREEN, (0.008 * math.cos(a), 0.008 * math.sin(a), 0.064),
              (0, 0, math.degrees(a)))
    p.add(cyl(0.003, 0.002, 0.012, segs=6), GREEN, (0, 0, 0.07))
    return p


@kit
def cucumber():
    p = Prop('kit_cucumber')  # 0.22 long, along X
    body = lying(lathe([(0.004, -0.11), (0.016, -0.105), (0.022, -0.08), (0.023, 0.06), (0.019, 0.1), (0.006, 0.11)], 4))
    p.add(body, CUKE, (0, 0, 0.023))
    return p


@kit
def scallion():
    p = Prop('kit_scallion')  # 0.26 long, along X: white root end at −X
    p.add(lying(cyl(0.008, 0.008, 0.08, segs=8)), WHITE_ONION, (-0.09, 0, 0.008))
    for dy, dz, length in ((0.0, 0.0, 0.18), (0.006, 0.004, 0.15)):
        p.add(lying(cyl(0.007, 0.004, length, segs=8)), GREEN, (-0.05 + length / 2, dy, 0.008 + dz))
    for k in range(4):
        p.add(cyl(0.0006, 0.0006, 0.012, segs=4), WHITE_ONION, (-0.132, 0.003 * (k - 1.5), 0.006), (0, 90, 0))
    return p


@kit
def egg():
    p = Prop('kit_egg')  # 0.057 high
    p.add(lathe([(0.002, 0.0), (0.016, 0.003), (0.022, 0.014), (0.022, 0.028), (0.017, 0.045), (0.008, 0.055),
                 (0.002, 0.057)], 4), EGG)
    return p


@kit
def lettuce():
    p = Prop('kit_lettuce')  # a small head, 0.14 across
    for i, (x, y, z, r) in enumerate(((0, 0, 0.05, 0.055), (0.03, 0.02, 0.04, 0.045), (-0.03, -0.015, 0.04, 0.047),
                                     (0.01, -0.035, 0.035, 0.04), (-0.015, 0.035, 0.035, 0.04))):
        p.add(crumple(ball(r, r, r * 0.9, 12, 8), 0.004, i), LIGHT_GREEN if i else PALE_GREEN, (x, y, z))
    return p


@kit
def steak():
    p = Prop('kit_steak')  # 0.17 × 0.11, raw; the game tints it as it cooks
    p.add(soft_plate(0.17, 0.11, 0.025, 0.045, 0.008), MEAT, (0, 0, 0.0125))
    p.add(tube([(-0.075, 0.04, 0.0125), (-0.02, 0.055, 0.0125), (0.04, 0.052, 0.0125), (0.08, 0.03, 0.0125)],
               0.011, 6), FAT)
    return p


@kit
def mushroom():
    p = Prop('kit_mushroom')  # 0.06 across
    p.add(cyl(0.011, 0.013, 0.035, segs=10), MUSHROOM_IN, (0, 0, 0.0175))
    p.add(lathe([(0.012, 0.028), (0.03, 0.03), (0.032, 0.04), (0.024, 0.055), (0.004, 0.06)], 4), MUSHROOM)
    return p


@kit
def rice_bowl():
    p = Prop('kit_rice')  # a small bowl of cooked rice
    p.add(bowl_shape(0.07, 0.055), CERAMIC)
    p.add(crumple(ball(0.062, 0.062, 0.03, 14, 8), 0.003, 3), RICE, (0, 0, 0.05))
    return p


# ---- cut pieces: one slice each; the game scatters copies ----
@kit
def carrot_slice():
    p = Prop('kit_carrot_slice')
    p.add(cyl(0.016, 0.016, 0.006, segs=12), CARROT_IN, (0, 0, 0.003))
    return p


@kit
def tomato_slice():
    p = Prop('kit_tomato_slice')
    p.add(cyl(0.034, 0.034, 0.007, segs=16), TOMATO, (0, 0, 0.0035))
    p.add(cyl(0.03, 0.03, 0.008, segs=16), TOMATO_IN, (0, 0, 0.004))
    for k in range(4):
        a = 2 * math.pi * k / 4 + 0.4
        p.add(ball(0.007, 0.004, 0.002), SEED, (0.015 * math.cos(a), 0.015 * math.sin(a), 0.0085))
    return p


@kit
def cucumber_slice():
    p = Prop('kit_cucumber_slice')
    p.add(cyl(0.022, 0.022, 0.006, segs=14), CUKE, (0, 0, 0.003))
    p.add(cyl(0.019, 0.019, 0.007, segs=14), PALE_GREEN, (0, 0, 0.0035))
    return p


@kit
def scallion_slice():
    p = Prop('kit_scallion_slice')
    p.add(tube([(0.007 * math.cos(a), 0.007 * math.sin(a), 0.003) for a in
                (2 * math.pi * k / 10 for k in range(10))], 0.0025, 5, closed=True), GREEN)
    return p


@kit
def lettuce_piece():
    p = Prop('kit_lettuce_piece')
    p.add(crumple(plate(0.045, 0.04, 0.004, 0.012, 3), 0.003, 9), LIGHT_GREEN, (0, 0, 0.004))
    return p


@kit
def mushroom_slice():
    p = Prop('kit_mushroom_slice')
    p.add(slab([(-0.012, 0), (0.012, 0), (0.012, 0.018), (0.03, 0.022), (0.026, 0.034), (0, 0.04), (-0.026, 0.034),
                 (-0.03, 0.022), (-0.012, 0.018)], 0.005), MUSHROOM_IN, (0, 0, 0.0025), (90, 0, 0))
    return p


# ---- food in the pan; the game tints these from raw to cooked to burnt ----
@kit
def pancake():
    p = Prop('kit_pancake')
    p.add(cyl(0.085, 0.09, 0.014, round_top=0.005, segs=24), PANCAKE, (0, 0, 0.007))
    return p


@kit
def omelette():
    p = Prop('kit_omelette')
    p.add(crumple(cyl(0.105, 0.11, 0.012, round_top=0.004, segs=24), 0.002, 4), OMELETTE, (0, 0, 0.006))
    return p


@kit
def rice_pile():
    p = Prop('kit_rice_pile')
    p.add(crumple(ball(0.1, 0.1, 0.028, 16, 8), 0.004, 5), RICE, (0, 0, 0.012))
    return p


@kit
def soup_surface():
    p = Prop('kit_soup')
    p.add(cyl(0.11, 0.11, 0.01, segs=24), SOUP, (0, 0, 0.005))
    return p


@kit
def scramble():
    p = Prop('kit_scramble')
    import random
    rnd = random.Random(2)
    for i in range(9):
        a, r = rnd.uniform(0, 2 * math.pi), rnd.uniform(0, 0.07)
        p.add(crumple(ball(0.022, 0.02, 0.012, 8, 6), 0.003, i), OMELETTE, (r * math.cos(a), r * math.sin(a), 0.008))
    return p


# ---- finished dishes: carried, eaten and shown at the end ----
def on_plate(name):
    p = Prop(name)
    p.add(lathe([(0.07, 0.0), (0.08, 0.006), (0.1, 0.012), (0.13, 0.022), (0.126, 0.026), (0.096, 0.016),
                 (0.07, 0.012)], 7), CERAMIC)
    return p


def in_bowl(name):
    p = Prop(name)
    p.add(bowl_shape(0.09, 0.07), CERAMIC)
    p.add(tube([(0.09 * math.cos(a), 0.09 * math.sin(a), 0.069) for a in
                (2 * math.pi * k / 28 for k in range(28))], 0.0035, 6, closed=True), BLUE_RIM)
    return p


def bits(p, colours, count, radius, z, seed, size=0.008):
    import random
    rnd = random.Random(seed)
    for i in range(count):
        a, r = rnd.uniform(0, 2 * math.pi), radius * math.sqrt(rnd.random())
        p.add(rbox(size, size, size * 0.8, size * 0.25, 1), colours[i % len(colours)],
              (r * math.cos(a), r * math.sin(a), z + rnd.uniform(0, 0.01)), (0, 0, rnd.uniform(0, 90)))


@kit
def dish_fried_rice():
    p = on_plate('kit_dish_fried_rice')
    p.add(crumple(ball(0.085, 0.085, 0.045, 16, 8), 0.004, 11), FRIED_RICE, (0, 0, 0.022))
    bits(p, [CARROT_IN, GREEN, YOLK], 18, 0.06, 0.05, 1)
    return p


@kit
def dish_pancakes():
    p = on_plate('kit_dish_pancakes')
    for i in range(3):
        p.add(cyl(0.075, 0.078, 0.016, round_top=0.005, round_bottom=0.004, segs=24), PANCAKE,
              (0.003 * i, -0.002 * i, 0.02 + 0.017 * i))
    p.add(cyl(0.07, 0.074, 0.004, segs=24), SYRUP, (0.004, -0.004, 0.071))
    p.add(rbox(0.03, 0.025, 0.012, 0.004, 2), BUTTER, (0.005, -0.004, 0.08))
    return p


@kit
def dish_steak():
    p = on_plate('kit_dish_steak')
    p.add(soft_plate(0.15, 0.1, 0.024, 0.04, 0.008), COOKED_MEAT, (-0.015, 0.01, 0.026))
    for k in range(3):
        p.add(rbox(0.11, 0.006, 0.002, 0.001, 1), GRILL, (-0.015, -0.028 + 0.028 * k, 0.0385), (0, 0, 30))
    for i, (x, y) in enumerate(((0.07, -0.05), (0.085, -0.02), (0.06, -0.075))):
        p.add(crumple(ball(0.018, 0.018, 0.016, 8, 6), 0.003, i), GREEN, (x, y, 0.025))
    p.add(cyl(0.022, 0.022, 0.012, segs=14), TOMATO, (0.065, 0.06, 0.02))
    return p


@kit
def dish_omelette():
    p = on_plate('kit_dish_omelette')
    half = lathe([(0.001, 0), (0.08, 0.002), (0.085, 0.012), (0.06, 0.026), (0.001, 0.03)], 6)
    bmesh.ops.scale(half, vec=(1, 0.55, 1), verts=half.verts[:])
    p.add(half, OMELETTE, (0, 0, 0.014))
    bits(p, [TOMATO, GREEN], 8, 0.05, 0.04, 6, 0.01)
    return p


@kit
def dish_soup():
    p = in_bowl('kit_dish_soup')
    p.add(cyl(0.08, 0.08, 0.008, segs=24), SOUP, (0, 0, 0.055))
    bits(p, [CARROT_IN, MUSHROOM_IN, GREEN], 12, 0.055, 0.058, 7)
    return p


@kit
def dish_salad():
    p = in_bowl('kit_dish_salad')
    import random
    rnd = random.Random(8)
    for i in range(14):
        a, r = rnd.uniform(0, 2 * math.pi), 0.06 * math.sqrt(rnd.random())
        p.add(crumple(plate(0.04, 0.036, 0.004, 0.01, 3), 0.004, i), LIGHT_GREEN if i % 3 else PALE_GREEN,
              (r * math.cos(a), r * math.sin(a), 0.06 + rnd.uniform(0, 0.02)),
              (rnd.uniform(-30, 30), rnd.uniform(-30, 30), rnd.uniform(0, 90)))
    for i in range(5):
        a = 2 * math.pi * i / 5
        p.add(cyl(0.02, 0.02, 0.006, segs=12), CUKE if i % 2 else TOMATO,
              (0.04 * math.cos(a), 0.04 * math.sin(a), 0.085), (rnd.uniform(-20, 20), 0, 0))
    return p


# ---- build into the "Nongs Cooking Kit" collection, in rows south of the props ----
ROW_Y_KIT, SPACING_KIT, PER_ROW_KIT = -42, 0.6, 10
kit_coll = bpy.data.collections.get('Nongs Cooking Kit')
if kit_coll:
    for o in list(kit_coll.objects):
        bpy.data.objects.remove(o, do_unlink=True)
else:
    kit_coll = bpy.data.collections.new('Nongs Cooking Kit')
    bpy.context.scene.collection.children.link(kit_coll)
for me in list(bpy.data.meshes):
    if me.users == 0:
        bpy.data.meshes.remove(me)

kit_objects = []
for i, build in enumerate(KIT):
    o = build().finish(kit_coll)
    o.location = ((i % PER_ROW_KIT - (PER_ROW_KIT - 1) / 2) * SPACING_KIT, ROW_Y_KIT - (i // PER_ROW_KIT) * SPACING_KIT, 0)
    kit_objects.append(o)


def export_kit():
    if not bpy.data.filepath:
        print('Not exported: open assets/blender/house.blend first.')
        return
    out = os.path.normpath(os.path.join(os.path.dirname(bpy.data.filepath), '..', 'converted', 'cooking_kit.glb'))
    # Selected and visible: objects in collections outside the scene (the headphones) can still count as selected.
    for o in bpy.context.view_layer.objects:
        o.select_set(o in kit_objects)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, use_visible=True,
                              export_apply=True, export_yup=True, export_image_format='JPEG',
                              export_jpeg_quality=85)
    for o in kit_objects:
        o.select_set(False)
    bpy.ops.wm.save_mainfile()
    print('exported', out, os.path.getsize(out), 'bytes')


if globals().get('EXPORT', True):
    export_kit()
