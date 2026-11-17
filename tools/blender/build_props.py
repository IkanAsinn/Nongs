"""Models the props and decorations for the house, and exports them.

Run it inside Blender with assets/blender/house.blend open:

    exec(open(r"<repo>/tools/blender/build_props.py").read())

It rebuilds the "Nongs Props" collection and writes one GLB per prop into
assets/converted/ for the game. Props that were modelled from a concept image
also get a copy in assets/concepts/, next to that image.

Each prop is modelled at its real size in metres and then enlarged by SCALE,
because full-size furniture looks small beside the big-headed 1.4 m characters.
The sizes in the comments below are the modelled ones, before enlarging. Things
held in the hand or worn (HAND_SIZED) stay at their modelled size. When SCALE
changes, the sizes and places in packages/shared/src/furniture.data.json, the
table tops in decor.ts and the seats in uses.ts have to change with it.

In Blender the front of every prop faces −Y (that is +Z in the game) and the
origin is on the floor under its centre. Things that hang (pictures, the pendant lamp) have their origin where
they are fixed: bottom centre for wall pieces, the ceiling for the pendant.

Rules followed here so the props look right in the game:
- furniture is built the way real furniture is: frames, rails, panelled doors,
  tapered legs, loose cushions;
- parts overlap where they join, so no seams show;
- every part has slightly rounded edges and smooth shading;
- wood, fabric and stone use small textures made in this file, tinted by the
  material's colour; everything else is a plain colour;
- nothing is metallic (the game has no environment map, so real metal would
  render black).
"""
import math
import os
import random
import shutil

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector


# How much larger than life the furniture is.
SCALE = 1.25
HAND_SIZED = {'prop_broom', 'prop_mop', 'shoes_sneakers'}


def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def set_input(node, name, value):
    """Sets a node input by name; safe for inputs Blender hides from name lookup."""
    for inp in node.inputs:
        if inp.name == name:
            inp.default_value = value
            return True
    return False


# ---- textures: made here with numpy, so nothing has to be downloaded ----
def value_noise(n, cells_x, cells_y, rng):
    """Smooth random values on an n × n image that repeats at its edges."""
    grid = rng.random((cells_y, cells_x))
    ys, xs = np.arange(n) * cells_y / n, np.arange(n) * cells_x / n
    y0, x0 = ys.astype(int), xs.astype(int)
    fy, fx = ys - y0, xs - x0
    fy, fx = (fy * fy * (3 - 2 * fy))[:, None], (fx * fx * (3 - 2 * fx))[None, :]
    y1, x1 = (y0 + 1) % cells_y, (x0 + 1) % cells_x
    top = grid[np.ix_(y0, x0)] * (1 - fx) + grid[np.ix_(y0, x1)] * fx
    bottom = grid[np.ix_(y1, x0)] * (1 - fx) + grid[np.ix_(y1, x1)] * fx
    return top * (1 - fy) + bottom * fy


def normal_map(height, strength):
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * strength
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * strength
    length = np.sqrt(dx * dx + dy * dy + 1)
    return np.stack([-dx / length, -dy / length, 1 / length], -1) * 0.5 + 0.5


def image(name, rgb, colour=True):
    """Stores an (n, n, 3) array as a Blender image, saved in assets/blender/textures."""
    n = rgb.shape[0]
    img = bpy.data.images.get(name)
    if img is not None and img.size[0] != n:
        bpy.data.images.remove(img)
        img = None
    if img is None:
        img = bpy.data.images.new(name, n, n, alpha=False)
    try:  # before the pixels: changing the colour space afterwards throws them away
        img.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    except TypeError:
        pass
    px = np.ones((n, n, 4), dtype=np.float32)
    px[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(px.ravel())
    img.update()
    if bpy.data.filepath:
        folder = os.path.join(os.path.dirname(bpy.data.filepath), 'textures')
        os.makedirs(folder, exist_ok=True)
        img.filepath_raw = os.path.join(folder, name + '.png')
        img.file_format = 'PNG'
        img.save()
    else:
        img.pack()
    return img


def make_textures():
    """Light, almost white textures; each material multiplies one by its own colour."""
    rng = np.random.default_rng(7)
    n = 512
    u = np.arange(n) / n
    wander = value_noise(n, 3, 2, rng)
    streaks = 0.6 * value_noise(n, 64, 2, rng) + 0.4 * value_noise(n, 160, 5, rng)
    bands = 0.5 + 0.5 * np.sin(2 * np.pi * (u[None, :] * 5 + wander * 0.5))
    val = 1 - 0.06 * bands ** 2 - 0.13 * streaks   # the grain runs up the image
    wood = image('tex_wood', np.stack([val, val * 0.97, val * 0.93], -1))
    n = 256
    u = np.arange(n) / n
    weave = np.sin(2 * np.pi * 32 * u)[None, :] * np.sin(2 * np.pi * 32 * u)[:, None]
    height = 0.5 + 0.3 * weave + 0.4 * (value_noise(n, 64, 64, rng) - 0.5)
    val = 0.86 + 0.14 * height
    fabric = image('tex_fabric', np.stack([val] * 3, -1))
    fabric_normal = image('tex_fabric_normal', normal_map(height, 2.0), colour=False)
    val = 1 - 0.22 * np.clip((value_noise(n, 90, 90, rng) - 0.7) * 6, 0, 1)
    speckle = image('tex_speckle', np.stack([val] * 3, -1))
    return {'wood': (wood, None), 'fabric': (fabric, fabric_normal), 'speckle': (speckle, None)}


TEXTURES = make_textures()


def mat(name, hexc, rough=0.75, glow=0.0, tex=None, tile=0.0):
    """A plain colour, or with `tex` a texture tinted by that colour; `tile` is its size in metres."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    tree = m.node_tree
    for node in list(tree.nodes):
        if node.type not in ('BSDF_PRINCIPLED', 'OUTPUT_MATERIAL'):
            tree.nodes.remove(node)
    b = next(n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED')
    rgb = [lin(((hexc >> s) & 255) / 255) for s in (16, 8, 0)]
    set_input(b, 'Base Color', (*rgb, 1))
    set_input(b, 'Roughness', rough)
    set_input(b, 'Metallic', 0.0)
    set_input(b, 'Emission Color', (*rgb, 1))
    set_input(b, 'Emission Strength', glow)
    if tex:
        colour, normal = TEXTURES[tex]
        picture_node = tree.nodes.new('ShaderNodeTexImage')
        picture_node.image = colour
        mix = tree.nodes.new('ShaderNodeMix')  # texture × colour; glTF keeps this as a colour factor
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs[0].default_value = 1.0
        mix.inputs[7].default_value = (*rgb, 1)
        tree.links.new(picture_node.outputs[0], mix.inputs[6])
        tree.links.new(mix.outputs[2], next(i for i in b.inputs if i.name == 'Base Color'))
        if normal:
            normal_node = tree.nodes.new('ShaderNodeTexImage')
            normal_node.image = normal
            bump = tree.nodes.new('ShaderNodeNormalMap')
            bump.inputs[0].default_value = 0.6
            tree.links.new(normal_node.outputs[0], bump.inputs[1])
            tree.links.new(bump.outputs[0], next(i for i in b.inputs if i.name == 'Normal'))
    m['tile'] = tile if tex else 0.0
    m.diffuse_color = (*rgb, 1)
    return m


# ---- shape helpers: each returns a new bmesh centred on the origin ----
def bevel_all(bm, r, seg=3):
    if r > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=r, offset_type='OFFSET', segments=seg,
                        profile=0.5, affect='EDGES', clamp_overlap=True)
    return bm


def rbox(sx, sy, sz, r, seg=3):
    """A box with rounded edges."""
    bm = bmesh.new()
    res = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=res['verts'])
    return bevel_all(bm, r, seg)


def cyl(r_bottom, r_top, height, round_bottom=0.0, round_top=0.0, segs=16):
    """An upright cylinder or cone, optionally with rounded ends."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                          radius1=r_bottom, radius2=r_top, depth=height)
    for z, r in ((-height / 2, round_bottom), (height / 2, round_top)):
        if r > 0:
            rim = [e for e in bm.edges if all(abs(v.co.z - z) < 1e-6 for v in e.verts)]
            bmesh.ops.bevel(bm, geom=rim, offset=r, offset_type='OFFSET', segments=3,
                            profile=0.5, affect='EDGES', clamp_overlap=True)
    return bm


def ball(rx, ry, rz, around=16, rings=10):
    bm = bmesh.new()
    res = bmesh.ops.create_uvsphere(bm, u_segments=around, v_segments=rings, radius=1.0)
    bmesh.ops.scale(bm, vec=(rx, ry, rz), verts=res['verts'])
    return bm


def slab(points, depth, r=0.0, seg=2):
    """A flat outline in the X/Z plane, given thickness along Y."""
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new((x, -depth / 2, z)) for x, z in points])
    res = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, vec=(0, depth, 0), verts=[g for g in res['geom'] if isinstance(g, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bevel_all(bm, r, seg)


def puff(sx, sy, sz, p=4.0, n=6):
    """A plump cushion shape: a box whose faces bulge. Lower p is rounder (2 is a ball)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=n, use_grid_fill=True)
    for v in bm.verts:
        x, y, z = v.co
        k = (abs(x) ** p + abs(y) ** p + abs(z) ** p) ** (1 / p)
        v.co = Vector((x / k * sx / 2, y / k * sy / 2, z / k * sz / 2))
    return bm


def quilt(sx, sy, sz, cells=3, depth=0.35):
    """A cushion whose top is stitched into cells × cells squares."""
    bm = puff(sx, sy, sz, 5.0, 4 * cells - 1)
    for v in bm.verts:
        if v.co.z > 0:
            u, w = v.co.x / (sx / 2), v.co.y / (sy / 2)
            t = abs(math.sin(cells * math.pi * (u + 1) / 2)) * abs(math.sin(cells * math.pi * (w + 1) / 2))
            v.co.z *= (1 - depth) + depth * t ** 0.5
    return bm


def outline(hx, hy, corner, steps=6):
    """A rectangle with rounded corners seen from above, anticlockwise. hx and hy are half sizes."""
    corner = max(1e-4, min(corner, hx, hy))
    pts = []
    for cx, cy, a0 in ((hx - corner, hy - corner, 0), (-hx + corner, hy - corner, 90),
                       (-hx + corner, -hy + corner, 180), (hx - corner, -hy + corner, 270)):
        for i in range(steps + 1):
            a = math.radians(a0 + 90 * i / steps)
            pts.append((cx + corner * math.cos(a), cy + corner * math.sin(a)))
    return pts


def loft(rings, steps=6):
    """A skin over a stack of outlines. Each ring is (half x, half y, corner radius, z)."""
    bm = bmesh.new()
    loops = [[bm.verts.new((x, y, z)) for x, y in outline(hx, hy, c, steps)] for hx, hy, c, z in rings]
    n = len(loops[0])
    for a, b in zip(loops, loops[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(loops[0][::-1])
    bm.faces.new(loops[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def lathe(profile, steps=5):
    """A round shape turned from (radius, z) pairs, bottom to top."""
    return loft([(r, r, r, z) for r, z in profile], steps)


def soft_plate(sx, sy, h, corner, r, steps=6, k=4):
    """A board with rounded corners (seen from above) and softly rounded edges."""
    hx, hy = sx / 2, sy / 2
    rings = []
    for i in range(k + 1):
        a = math.radians(90 * i / k)
        d = r * (1 - math.sin(a))
        rings.append((hx - d, hy - d, corner - d, -h / 2 + r * (1 - math.cos(a))))
    for i in range(k + 1):
        a = math.radians(90 * i / k)
        d = r * (1 - math.cos(a))
        rings.append((hx - d, hy - d, corner - d, h / 2 - r + r * math.sin(a)))
    return loft(rings, steps)


def tub(sx, sy, h, corner, wall, depth, steps=8):
    """A hollow basin with a rounded rim, centred on the origin."""
    hx, hy = sx / 2, sy / 2
    rings = []
    foot = min(0.08, h / 3)
    for i in range(5):  # rounded bottom edge, outside
        a = math.radians(90 * i / 4)
        d = foot * (1 - math.sin(a))
        rings.append((hx - d, hy - d, corner - d, -h / 2 + foot * (1 - math.cos(a))))
    for i in range(7):  # over the rim
        a = math.radians(180 * i / 6)
        d = wall / 2 * (1 - math.cos(a))
        rings.append((hx - d, hy - d, corner - d, h / 2 - wall / 2 + wall / 2 * math.sin(a)))
    floor = h / 2 - depth
    inner = min(0.06, depth / 3)
    for i in range(5):  # down the inside to the floor
        a = math.radians(90 * i / 4)
        d = wall + inner * (1 - math.cos(a))
        rings.append((hx - d, hy - d, corner - d, floor + inner * (1 - math.sin(a))))
    return loft(rings, steps)


def arch(width, height, corner, steps=8):
    """Outline of a board standing on the floor with rounded top corners."""
    pts = [(-width / 2, 0), (width / 2, 0)]
    for cx, a0 in ((width / 2 - corner, 0), (-width / 2 + corner, 90)):
        for i in range(steps + 1):
            a = math.radians(a0 + 90 * i / steps)
            pts.append((cx + corner * math.cos(a), height - corner + corner * math.sin(a)))
    return pts


def rounded_rect(width, height, corner, steps=6):
    """Outline of an upright board with all four corners rounded; its bottom is at 0."""
    pts = []
    for cx, cz, a0 in ((width / 2 - corner, corner, -90), (width / 2 - corner, height - corner, 0),
                       (-width / 2 + corner, height - corner, 90), (-width / 2 + corner, corner, 180)):
        for i in range(steps + 1):
            a = math.radians(a0 + 90 * i / steps)
            pts.append((cx + corner * math.cos(a), cz + corner * math.sin(a)))
    return pts


def plate(sx, sy, h, corner, seg=5):
    """A board lying flat, with rounded corners when seen from above."""
    bm = bmesh.new()
    res = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, h), verts=res['verts'])
    upright = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-6]
    bmesh.ops.bevel(bm, geom=upright, offset=corner, offset_type='OFFSET', segments=seg,
                    profile=0.5, affect='EDGES', clamp_overlap=True)
    return bm


class Prop:
    """Collects parts into one mesh with several materials."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.bm.loops.layers.uv.new('UVMap')
        self.mats = []
        self.parts = 0

    def add(self, part, material, loc=(0, 0, 0), rot=(0, 0, 0), smooth=True):
        if material not in self.mats:
            self.mats.append(material)
        index = self.mats.index(material)
        for f in part.faces:
            f.material_index = index
            f.smooth = smooth
        # Texture coordinates in metres, projected from the side each face looks at.
        # The texture's grain (its vertical) follows the longest side of the part.
        uv = part.loops.layers.uv.get('UVMap') or part.loops.layers.uv.new('UVMap')
        tile = material.get('tile', 0.0)
        if tile:
            part.normal_update()
            size = [max(v.co[i] for v in part.verts) - min(v.co[i] for v in part.verts) for i in range(3)]
            longest = max(range(3), key=lambda i: size[i])
            self.parts += 1
            shift = (0.37 * self.parts, 0.61 * self.parts)  # so no two parts show the same patch
            for f in part.faces:
                facing = max(range(3), key=lambda i: abs(f.normal[i]))
                across, along = [i for i in range(3) if i != facing]
                if across == longest or (along != longest and size[across] > size[along]):
                    across, along = along, across
                for loop in f.loops:
                    loop[uv].uv = (loop.vert.co[across] / tile + shift[0], loop.vert.co[along] / tile + shift[1])
        m = Matrix.Translation(loc) @ Matrix.Rotation(math.radians(rot[2]), 4, 'Z') \
            @ Matrix.Rotation(math.radians(rot[1]), 4, 'Y') @ Matrix.Rotation(math.radians(rot[0]), 4, 'X')
        part.transform(m)
        tmp = bpy.data.meshes.new('tmp')
        part.to_mesh(tmp)
        part.free()
        self.bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)

    def finish(self, collection):
        if self.name not in HAND_SIZED:
            bmesh.ops.scale(self.bm, vec=(SCALE, SCALE, SCALE), verts=self.bm.verts)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        o = bpy.data.objects.new(self.name, me)
        collection.objects.link(o)
        mod = o.modifiers.new('Normals', 'WEIGHTED_NORMAL')  # keeps flat faces flat under smooth shading
        mod.keep_sharp = False
        return o


# ---- materials ----
WOOD = mat('Prop Wood', 0xe8c093, 0.6, tex='wood', tile=0.5)             # oak
LINEN = mat('Prop Linen', 0xf7f4ee, 0.95, tex='fabric', tile=0.25)
BLANKET = mat('Prop Blanket', 0xa8c6dc, 0.95, tex='fabric', tile=0.25)
SOFA = mat('Prop Sofa', 0xdfa79b, 0.95, tex='fabric', tile=0.22)
MUSTARD = mat('Prop Mustard', 0xe2bb62, 0.95, tex='fabric', tile=0.22)
CREAM = mat('Prop Cream', 0xf5eedd, 0.6)                                  # painted wood
LEG = mat('Prop Leg Wood', 0xb8845a, 0.55, tex='wood', tile=0.4)         # walnut
MINT = mat('Prop Mint', 0xa7c9b0, 0.5)                                    # sage paint
METAL = mat('Prop Metal', 0xcdd1d6, 0.25)
BLACK = mat('Prop Black', 0x3a3a3f, 0.4)
CHAIR_WOOD = mat('Prop Chair Wood', 0xdcae7a, 0.6, tex='wood', tile=0.4)
CUSHION = mat('Prop Cushion', 0xe9b3a2, 0.95, tex='fabric', tile=0.2)
HANDLE = mat('Prop Handle Wood', 0xe0b27e, 0.6, tex='wood', tile=0.4)
PINK = mat('Prop Pink', 0xe8787f, 0.6)
BRISTLE = mat('Prop Bristle', 0xe9d679, 0.9)
MOP_STRING = mat('Prop Mop String', 0xf4f0e6, 0.95, tex='fabric', tile=0.1)
SHOE = mat('Prop Shoe', 0xf4f4f4, 0.7)
SHOE_INSIDE = mat('Prop Shoe Inside', 0x9a9a9a, 0.9)
WHITE = mat('Prop Ceramic', 0xfbfbf8, 0.25)
WATER = mat('Prop Water', 0xbfe6f5, 0.1)
MIRROR = mat('Prop Mirror', 0xdcefff, 0.05)
POT = mat('Prop Pot', 0xe8a27c, 0.8)
SOIL = mat('Prop Soil', 0x8a6a52, 0.95)
BARK = mat('Prop Stem', 0x9a7350, 0.9)
LEAF = mat('Prop Leaf', 0x7cc47f, 0.8)
DARK = mat('Prop Dark', 0x4a4a55, 0.5)
SCREEN = mat('Prop Screen', 0x2b2f3a, 0.15)
SHADE = mat('Prop Lamp Shade', 0xfff1c9, 0.9, glow=0.6)
BULB = mat('Prop Bulb', 0xfff6dd, 0.5, glow=2.0)
CABINET = mat('Prop Cabinet', 0xf7f1e4, 0.6)
WORKTOP = mat('Prop Worktop', 0xf3efe9, 0.3, tex='speckle', tile=0.4)
RUG_CREAM = mat('Prop Rug Cream', 0xf3e8d6, 1.0, tex='fabric', tile=0.3)
RUG_PINK = mat('Prop Rug Pink', 0xddaab0, 1.0, tex='fabric', tile=0.3)
RUG_BLUE = mat('Prop Rug Blue', 0x9dbdd6, 1.0, tex='fabric', tile=0.3)
MAT_TAN = mat('Prop Mat Tan', 0xd9b98a, 1.0, tex='fabric', tile=0.15)
MAT_BROWN = mat('Prop Mat Brown', 0xb98d5e, 1.0, tex='fabric', tile=0.15)
BASKET = mat('Prop Basket', 0xdcbb85, 0.9, tex='fabric', tile=0.12)
TEDDY = mat('Prop Teddy', 0xd2a071, 1.0, tex='fabric', tile=0.1)
SKY = mat('Prop Sky', 0xbfe3f5, 0.8)
BOOK_RED = mat('Prop Book Red', 0xe8787f, 0.8)
BOOK_YELLOW = mat('Prop Book Yellow', 0xf2cf6b, 0.8)
BOOK_BLUE = mat('Prop Book Blue', 0x8fb8de, 0.8)
BOOK_GREEN = mat('Prop Book Green', 0x9ccf9c, 0.8)
BOOK_PURPLE = mat('Prop Book Purple', 0xc3a6e0, 0.8)
BOOKS = [BOOK_RED, BOOK_YELLOW, BOOK_BLUE, BOOK_GREEN, BOOK_PURPLE]


def legs(p, material, dx, dy, height, r_top=0.035, r_bottom=0.025, y0=0.0):
    """Four tapered legs standing on the floor."""
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.add(cyl(r_bottom, r_top, height, round_bottom=min(0.012, r_bottom * 0.5), segs=10), material,
                  (sx * dx, y0 + sy * dy, height / 2))


# ---- furniture modelled from the concept images ----
def sq_leg(foot, top, height):
    """A square leg that narrows towards the floor. `foot` and `top` are half widths."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=foot * 1.4142, radius2=top * 1.4142, depth=height)
    bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(45), 3, 'Z'))
    return bevel_all(bm, min(foot, top) * 0.25, 2)


def four_legs(p, material, dx, dy, height, foot=0.014, top=0.022, y0=0.0):
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.add(sq_leg(foot, top, height), material, (sx * dx, y0 + sy * dy, height / 2))


def shaker(p, w, h, material, x, y, z, frame=0.045):
    """A framed door or drawer front, centred on (x, z), with its back at y and its face towards −Y."""
    p.add(rbox(w, 0.018, h, 0.004, 1), material, (x, y - 0.009, z))
    for s in (-1, 1):
        p.add(rbox(frame, 0.01, h, 0.003, 1), material, (x + s * (w - frame) / 2, y - 0.022, z))
        p.add(rbox(w - 2 * frame + 0.006, 0.01, frame, 0.003, 1), material, (x, y - 0.022, z + s * (h - frame) / 2))


def bar_handle(p, x, y, z, length, upright=True, material=None):
    """A thin bar handle standing off a face at y."""
    material = material or BLACK
    p.add(cyl(0.008, 0.008, length, round_bottom=0.004, round_top=0.004, segs=8), material, (x, y - 0.028, z),
          (0, 0, 0) if upright else (0, 90, 0))
    for d in (-1, 1):
        off = d * (length / 2 - 0.02)
        p.add(cyl(0.006, 0.006, 0.03, segs=6), material,
              (x + (0 if upright else off), y - 0.014, z + (off if upright else 0)), (90, 0, 0))


def pillow(sx, sy, sz):
    """A pillow lying flat: plump in the middle, pinched thin towards its corners."""
    bm = puff(sx, sy, sz, 2.6, 7)
    for v in bm.verts:
        k = (abs(v.co.x / (sx / 2)) * abs(v.co.y / (sy / 2))) ** 1.5
        v.co.x *= 1 + 0.12 * k
        v.co.y *= 1 + 0.12 * k
        v.co.z *= 1 - 0.75 * k
    return bm


def duvet(sx, sy, sz):
    """A thick cover with soft folds across its top."""
    bm = puff(sx, sy, sz, 9.0, 13)
    for v in bm.verts:
        if v.co.z > 0:
            wave = math.sin(v.co.x * 9 + v.co.y * 4) * math.cos(v.co.y * 7 - v.co.x * 3)
            v.co.z += 0.012 * wave * v.co.z / (sz / 2)
    return bm


def bed():
    p = Prop('prop_bed')  # 1.2 wide, 2.1 long, 1.0 high, head at +Y
    for y, post, rail_top, panel in ((1.01, 0.97, 1.0, 0.5), (-1.01, 0.53, 0.56, 0.24)):  # headboard, footboard
        for s in (-1, 1):
            p.add(rbox(0.075, 0.075, post, 0.012, 2), WOOD, (s * 0.5625, y, post / 2))
        p.add(rbox(1.2, 0.09, 0.07, 0.02), WOOD, (0, y, rail_top - 0.035))
        p.add(rbox(1.06, 0.03, panel, 0.006, 1), WOOD, (0, y, rail_top - 0.06 - panel / 2))
        p.add(rbox(1.06, 0.045, 0.07, 0.008, 1), WOOD, (0, y, 0.3))
    for s in (-1, 1):  # side rails
        p.add(rbox(0.035, 1.96, 0.16, 0.008, 1), WOOD, (s * 0.565, 0, 0.3))
    p.add(rbox(1.08, 1.94, 0.2, 0.05, 4), LINEN, (0, 0, 0.44))
    p.add(duvet(1.17, 1.32, 0.26), BLANKET, (0, -0.31, 0.45))
    p.add(puff(1.16, 0.26, 0.09, 3.0), BLANKET, (0, 0.36, 0.585))        # the duvet folded back
    p.add(pillow(0.7, 0.42, 0.17), LINEN, (0, 0.7, 0.63), (14, 0, 0))
    p.add(rbox(1.19, 0.42, 0.28, 0.07, 4), MUSTARD, (0, -0.66, 0.455))   # a throw across the foot
    return p


def couch(name, seats, pillows):
    """A sofa with `seats` cushions between two arms. Each seat is 0.7 wide."""
    p = Prop(name)
    inner, arm = 0.7 * seats, 0.2
    half = inner / 2 + arm
    p.add(rbox(2 * half - 0.04, 0.84, 0.2, 0.03), SOFA, (0, 0, 0.23))
    p.add(rbox(inner + 0.1, 0.2, 0.6, 0.07, 5), SOFA, (0, 0.32, 0.52), (-6, 0, 0))
    for s in (-1, 1):
        p.add(rbox(arm, 0.86, 0.5, 0.075, 5), SOFA, (s * (half - arm / 2), 0, 0.4))
        for y in (-0.34, 0.34):
            p.add(sq_leg(0.018, 0.028, 0.14), LEG, (s * (half - 0.09), y, 0.07))
    for i in range(seats):
        x = -inner / 2 + 0.35 + 0.7 * i
        p.add(puff(0.69, 0.64, 0.17, 6.0, 7), SOFA, (x, -0.09, 0.415))
        p.add(puff(0.68, 0.2, 0.42, 5.0, 7), SOFA, (x, 0.19, 0.68), (-12, 0, 0))
    for x, material, turn in pillows:  # throw pillows leaning on the back cushions
        p.add(pillow(0.34, 0.34, 0.12), material, (x, 0.04, 0.66), (72, 0, turn))
    return p


def sofa():  # 1.8 wide, 0.88 deep, 0.9 high
    return couch('prop_sofa', 2, [(0.5, MUSTARD, -14), (-0.52, LINEN, 12)])


def armchair():  # 1.1 wide, 0.88 deep, 0.9 high
    return couch('prop_armchair', 1, [(0.12, MUSTARD, -10)])


def fridge():
    p = Prop('prop_fridge')  # 0.75 wide, 0.7 deep, 1.5 high
    p.add(rbox(0.75, 0.6, 1.5, 0.035, 3), MINT, (0, 0.05, 0.75))
    p.add(rbox(0.74, 0.06, 0.52, 0.02, 2), MINT, (0, -0.28, 1.225))   # freezer door
    p.add(rbox(0.74, 0.06, 0.86, 0.02, 2), MINT, (0, -0.28, 0.515))   # main door
    p.add(rbox(0.7, 0.04, 0.07, 0.008, 1), DARK, (0, -0.24, 0.04))    # grille under the doors
    bar_handle(p, -0.3, -0.31, 1.1, 0.22, material=METAL)
    bar_handle(p, -0.3, -0.31, 0.72, 0.34, material=METAL)
    for z in (1.4, 0.98, 0.2):  # hinges
        p.add(rbox(0.02, 0.05, 0.07, 0.006, 1), METAL, (0.372, -0.25, z))
    return p


def coffee_table():
    p = Prop('prop_coffee_table')  # 0.95 × 0.65, 0.36 high
    p.add(soft_plate(0.95, 0.65, 0.035, 0.035, 0.01), WOOD, (0, 0, 0.3425))
    p.add(rbox(0.78, 0.5, 0.05, 0.006, 1), WOOD, (0, 0, 0.3))          # the frame under the top
    p.add(soft_plate(0.7, 0.42, 0.02, 0.02, 0.006), WOOD, (0, 0, 0.12))  # lower shelf
    for sx in (-1, 1):
        for sy in (-1, 1):  # round legs, splayed a little
            p.add(cyl(0.014, 0.024, 0.325, segs=10), LEG, (sx * 0.365, sy * 0.225, 0.16), (sy * 7, sx * -7, 0))
    return p


def chair():
    p = Prop('prop_chair')  # a dining chair: 0.46 × 0.5, seat 0.42 high, 0.9 high overall
    lean = math.radians(8)
    p.add(soft_plate(0.44, 0.42, 0.035, 0.04, 0.012), CHAIR_WOOD, (0, -0.02, 0.385))
    p.add(puff(0.4, 0.38, 0.05, 6.0, 5), CUSHION, (0, -0.02, 0.42))
    for s in (-1, 1):
        for y in (-0.2, 0.17):
            p.add(sq_leg(0.014, 0.02, 0.37), CHAIR_WOOD, (s * 0.19, y, 0.185))
        p.add(rbox(0.02, 0.34, 0.045, 0.006, 1), CHAIR_WOOD, (s * 0.19, -0.015, 0.345))
        # the back posts carry on up from the back legs, leaning back
        p.add(rbox(0.036, 0.03, 0.54, 0.008, 2), CHAIR_WOOD,
              (s * 0.19, 0.17 + 0.27 * math.sin(lean), 0.36 + 0.27 * math.cos(lean)), (-8, 0, 0))
    for y in (-0.2, 0.17):
        p.add(rbox(0.36, 0.02, 0.045, 0.006, 1), CHAIR_WOOD, (0, y, 0.345))
    p.add(rbox(0.42, 0.03, 0.08, 0.012), CHAIR_WOOD,
          (0, 0.17 + 0.5 * math.sin(lean), 0.36 + 0.5 * math.cos(lean)), (-8, 0, 0))
    for x in (-0.1, 0, 0.1):  # slats
        p.add(rbox(0.045, 0.014, 0.4, 0.004, 1), CHAIR_WOOD,
              (x, 0.17 + 0.27 * math.sin(lean), 0.36 + 0.27 * math.cos(lean)), (-8, 0, 0))
    return p


def broom():
    p = Prop('prop_broom')  # 1.25 high, bristles on the floor
    p.add(cyl(0.016, 0.016, 1.0, round_top=0.012, segs=10), HANDLE, (0, 0, 0.75))
    p.add(ball(0.04, 0.04, 0.03), PINK, (0, 0, 0.26))
    p.add(rbox(0.3, 0.07, 0.07, 0.02), HANDLE, (0, 0, 0.215))
    p.add(rbox(0.33, 0.08, 0.035, 0.012), PINK, (0, 0, 0.17))
    p.add(slab([(-0.19, 0), (0.19, 0), (0.15, 0.16), (-0.15, 0.16)], 0.06, 0.008), BRISTLE)
    return p


def mop():
    p = Prop('prop_mop')  # 1.25 high, a cotton string head resting on the floor
    p.add(cyl(0.016, 0.016, 1.0, round_top=0.012, segs=10), HANDLE, (0, 0, 0.75))
    p.add(cyl(0.022, 0.03, 0.09, round_top=0.008, segs=12), MINT, (0, 0, 0.215))   # the screw-on socket
    p.add(cyl(0.05, 0.05, 0.03, round_bottom=0.01, round_top=0.01, segs=16), MINT, (0, 0, 0.17))  # the clamp
    rnd = random.Random(3)
    for k in range(22):
        a = 2 * math.pi * k / 22 + rnd.uniform(-0.1, 0.1)
        out = rnd.uniform(0.11, 0.17)
        bend = rnd.uniform(-0.25, 0.25)
        pts = []
        for i in range(7):
            t = i / 6
            r = 0.035 + out * t ** 1.4
            h = 0.16 * (1 - t) ** 1.6 + 0.012
            pts.append((r * math.cos(a + bend * t), r * math.sin(a + bend * t), h))
        p.add(rope(pts, 0.009), MOP_STRING)
    return p


def rope(points, radius, segs=6):
    """A round strand swept along a list of points, capped at both ends."""
    bm = bmesh.new()
    pts = [Vector(q) for q in points]
    rings, normal = [], None
    for i, q in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if normal is None:
            helper = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            normal = t.cross(helper).normalized()
        normal = (normal - t * normal.dot(t)).normalized()
        binormal = t.cross(normal)
        rings.append([bm.verts.new(q + radius * (math.cos(c) * normal + math.sin(c) * binormal))
                      for c in (2 * math.pi * j / segs for j in range(segs))])
    for r0, r1 in zip(rings, rings[1:]):
        for j in range(segs):
            bm.faces.new((r0[j], r0[(j + 1) % segs], r1[(j + 1) % segs], r1[j]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def sneakers():
    p = Prop('shoes_sneakers')  # a pair; each 0.21 long, toes towards −Y
    for s in (-1, 1):
        x = s * 0.07
        p.add(rbox(0.095, 0.21, 0.035, 0.015), SHOE, (x, 0, 0.0175))
        upper = rbox(0.085, 0.2, 0.07, 0.032, 4)
        for v in upper.verts:  # lower the toe
            t = min(1.0, max(0.0, (-0.02 - v.co.y) / 0.08))
            v.co.z = -0.035 + (v.co.z + 0.035) * (1 - 0.3 * t)
        p.add(upper, SHOE, (x, 0, 0.065))
        collar = cyl(0.04, 0.04, 0.03, round_top=0.012)
        bmesh.ops.scale(collar, vec=(1, 1.25, 1), verts=collar.verts[:])
        p.add(collar, SHOE, (x, 0.045, 0.1))
        hole = cyl(0.026, 0.026, 0.004)
        bmesh.ops.scale(hole, vec=(1, 1.25, 1), verts=hole.verts[:])
        p.add(hole, SHOE_INSIDE, (x, 0.045, 0.1155))
        for y in (-0.015, -0.035, -0.055):  # laces
            t = min(1.0, max(0.0, (-0.02 - y) / 0.08))
            p.add(rbox(0.05, 0.009, 0.008, 0.003, 2), SHOE, (x, y, 0.03 + 0.07 * (1 - 0.3 * t) + 0.002))
    return p


# ---- bedroom ----
def nightstand():
    p = Prop('prop_nightstand')  # 0.48 × 0.42, 0.51 high
    p.add(rbox(0.45, 0.38, 0.34, 0.01, 2), WOOD, (0, 0.01, 0.33))
    p.add(soft_plate(0.48, 0.42, 0.025, 0.02, 0.008), WOOD, (0, 0, 0.5))
    for z in (0.405, 0.255):
        shaker(p, 0.4, 0.135, CREAM, 0, -0.18, z, 0.022)
        p.add(ball(0.012, 0.012, 0.012), BLACK, (0, -0.215, z))
    four_legs(p, LEG, 0.19, 0.15, 0.17, y0=0.01)
    return p


def table_lamp():
    p = Prop('prop_table_lamp')  # 0.24 wide, 0.36 high
    p.add(cyl(0.07, 0.055, 0.03, round_top=0.01), WOOD, (0, 0, 0.015))
    p.add(ball(0.05, 0.05, 0.06), MINT, (0, 0, 0.08))
    p.add(cyl(0.012, 0.012, 0.14, segs=8), WOOD, (0, 0, 0.17))
    p.add(cyl(0.12, 0.075, 0.16, segs=20), SHADE, (0, 0, 0.28))
    return p


def wardrobe():
    p = Prop('prop_wardrobe')  # 1.26 × 0.6, 1.9 high
    p.add(rbox(1.2, 0.54, 1.74, 0.012, 2), WOOD, (0, 0.02, 0.95))
    p.add(rbox(1.16, 0.5, 0.09, 0.006, 1), WOOD, (0, 0.03, 0.045))      # plinth
    p.add(rbox(1.26, 0.6, 0.05, 0.015), WOOD, (0, 0, 1.845))            # cornice
    for s in (-1, 1):
        shaker(p, 0.585, 1.66, CREAM, s * 0.2975, -0.25, 0.95, 0.07)
        bar_handle(p, s * 0.06, -0.277, 1.0, 0.26)
    return p


def desk():
    p = Prop('prop_desk')  # 1.1 × 0.55, 0.62 high; drawers on the right
    p.add(soft_plate(1.1, 0.55, 0.035, 0.02, 0.01), WOOD, (0, 0, 0.6025))
    for y in (-0.23, 0.23):  # rails under the top
        p.add(rbox(0.98, 0.02, 0.06, 0.006, 1), WOOD, (0, y, 0.555))
    p.add(rbox(0.34, 0.48, 0.42, 0.01, 2), WOOD, (0.34, 0, 0.375))      # drawer unit
    for z in (0.475, 0.28):
        shaker(p, 0.3, 0.17, CREAM, 0.34, -0.24, z, 0.025)
        p.add(ball(0.012, 0.012, 0.012), BLACK, (0.34, -0.275, z))
    four_legs(p, WOOD, 0.5, 0.225, 0.59, 0.016, 0.024)
    p.add(rbox(0.2, 0.14, 0.03, 0.008, 1), BOOK_BLUE, (-0.15, -0.03, 0.635), (0, 0, 15))
    p.add(rbox(0.18, 0.13, 0.025, 0.008, 1), BOOK_YELLOW, (-0.14, -0.02, 0.662), (0, 0, -8))
    p.add(cyl(0.03, 0.035, 0.08, round_bottom=0.008, segs=12), MINT, (-0.42, 0.16, 0.66))
    return p


def bookshelf():
    p = Prop('prop_bookshelf')  # 0.9 × 0.32, 1.6 high
    p.add(rbox(0.9, 0.03, 1.56, 0.012), WOOD, (0, 0.145, 0.8))
    for s in (-1, 1):
        p.add(rbox(0.05, 0.32, 1.6, 0.02), WOOD, (s * 0.425, 0, 0.8))
    for z in (0.06, 0.44, 0.82, 1.2, 1.57):
        p.add(rbox(0.86, 0.31, 0.05, 0.015), WOOD, (0, 0, z))
    n = 0
    for shelf_top in (0.085, 0.465, 0.845, 1.225):
        x = -0.385
        while x < 0.3:
            w = 0.045 + 0.02 * ((n * 7) % 3)
            h = 0.2 + 0.03 * ((n * 5) % 4)
            p.add(rbox(w, 0.2, h, 0.008, 1), BOOKS[n % 5], (x + w / 2, -0.02, shelf_top + h / 2))
            x += w + 0.006
            n += 1
            if n % 6 == 5:
                x += 0.12  # a gap now and then
    return p


def teddy():
    p = Prop('prop_teddy')  # 0.25 wide, 0.33 high, sitting
    p.add(ball(0.09, 0.08, 0.1), TEDDY, (0, 0, 0.1))
    p.add(ball(0.085, 0.08, 0.08), TEDDY, (0, 0, 0.235))
    p.add(ball(0.04, 0.035, 0.03), CREAM, (0, -0.065, 0.22))
    p.add(ball(0.013, 0.01, 0.01), DARK, (0, -0.098, 0.228))
    for s in (-1, 1):
        p.add(ball(0.032, 0.02, 0.032), TEDDY, (s * 0.062, 0, 0.3))
        p.add(ball(0.01, 0.008, 0.01), DARK, (s * 0.032, -0.072, 0.255))
        p.add(ball(0.032, 0.032, 0.06), TEDDY, (s * 0.095, -0.02, 0.13), (0, s * -25, 0))
        p.add(ball(0.042, 0.065, 0.04), TEDDY, (s * 0.055, -0.075, 0.04))
    return p


# ---- living room and decorations ----
def rug():
    p = Prop('prop_rug')  # 2.0 × 1.4
    p.add(plate(2.0, 1.4, 0.012, 0.12), RUG_PINK, (0, 0, 0.006))
    p.add(plate(1.76, 1.16, 0.012, 0.08), RUG_CREAM, (0, 0, 0.009))
    return p


def rug_round():
    p = Prop('prop_rug_round')  # 1.8 across
    p.add(cyl(0.9, 0.9, 0.012, segs=40), RUG_BLUE, (0, 0, 0.006))
    p.add(cyl(0.76, 0.76, 0.012, segs=40), RUG_CREAM, (0, 0, 0.009))
    p.add(cyl(0.4, 0.4, 0.012, segs=32), RUG_BLUE, (0, 0, 0.012))
    return p


def plant():
    p = Prop('prop_plant')  # 0.5 wide, 1.0 high
    p.add(lathe([(0.1, 0), (0.13, 0.01), (0.15, 0.06), (0.185, 0.25), (0.2, 0.26), (0.205, 0.29), (0.195, 0.32),
                 (0.17, 0.32), (0.165, 0.3)]), POT)
    p.add(cyl(0.168, 0.168, 0.02), SOIL, (0, 0, 0.3))
    p.add(cyl(0.016, 0.01, 0.66, segs=8), BARK, (0, 0, 0.63))
    for k in range(18):  # broad leaves spiralling up the stem
        turn = k * 137.5
        tilt = math.radians(38 + (k % 4) * 12)
        a = math.radians(turn)
        base = 0.42 + 0.03 * k
        length = 0.15 - 0.003 * k
        out = Vector((math.sin(tilt) * math.sin(a), -math.sin(tilt) * math.cos(a), math.cos(tilt)))
        p.add(ball(0.065 - 0.001 * k, 0.01, length, 8, 6), LEAF, Vector((0, 0, base)) + out * length * 0.9,
              (math.degrees(tilt), 0, turn))
    return p


def floor_lamp():
    p = Prop('prop_floor_lamp')  # 0.4 wide, 1.5 high
    p.add(cyl(0.15, 0.13, 0.04, round_top=0.015, segs=20), WOOD, (0, 0, 0.02))
    p.add(cyl(0.015, 0.015, 1.2, segs=8), WOOD, (0, 0, 0.63))
    p.add(cyl(0.2, 0.13, 0.28, segs=20), SHADE, (0, 0, 1.36))
    return p


def tv():
    p = Prop('prop_tv')  # stand 1.4 × 0.4, screen on top; 1.2 high
    p.add(rbox(1.4, 0.38, 0.28, 0.01, 2), WOOD, (0, 0.01, 0.31))
    p.add(soft_plate(1.44, 0.42, 0.025, 0.02, 0.008), WOOD, (0, 0, 0.4625))
    for x in (-0.46, 0, 0.46):
        shaker(p, 0.44, 0.24, CREAM, x, -0.18, 0.31, 0.03)
        bar_handle(p, x, -0.207, 0.385, 0.1, upright=False)
    four_legs(p, LEG, 0.62, 0.14, 0.17, y0=0.01)
    p.add(rbox(0.34, 0.18, 0.015, 0.006, 1), DARK, (0, 0, 0.482))       # foot of the screen
    p.add(rbox(0.05, 0.03, 0.1, 0.008, 1), DARK, (0, 0.012, 0.53))
    p.add(rbox(1.12, 0.035, 0.65, 0.012, 2), DARK, (0, 0, 0.88))
    p.add(rbox(1.08, 0.006, 0.6, 0.002, 1), SCREEN, (0, -0.017, 0.885))
    return p


def vase():
    p = Prop('prop_vase')  # 0.2 wide, 0.36 high
    p.add(lathe([(0.03, 0), (0.045, 0.005), (0.068, 0.05), (0.07, 0.085), (0.05, 0.14), (0.03, 0.18), (0.032, 0.2),
                 (0.042, 0.215), (0.036, 0.22), (0.024, 0.2)], 4), WHITE)
    for i, (dx, dy, colour) in enumerate(((0.05, 0.0, PINK), (-0.04, 0.03, BOOK_YELLOW), (-0.01, -0.05, BOOK_PURPLE))):
        top = 0.3 + i * 0.02
        p.add(cyl(0.004, 0.004, top - 0.14, segs=6), LEAF, (dx * 0.6, dy * 0.6, (top + 0.14) / 2))
        p.add(ball(0.036, 0.036, 0.026), colour, (dx, dy, top + 0.01))
        p.add(ball(0.014, 0.014, 0.014), CREAM, (dx, dy, top + 0.03))
    return p


def picture():
    p = Prop('prop_picture')  # 0.6 × 0.45 on a wall; origin at the bottom centre
    p.add(rbox(0.6, 0.03, 0.45, 0.012), WOOD, (0, 0, 0.225))
    p.add(rbox(0.52, 0.01, 0.37, 0.003, 1), SKY, (0, -0.014, 0.225))
    p.add(slab([(-0.26, 0), (0.26, 0), (0.26, 0.1), (0.1, 0.16), (-0.05, 0.09), (-0.26, 0.17)], 0.004), LEAF,
          (0, -0.02, 0.04), smooth=False)
    p.add(cyl(0.045, 0.045, 0.004), BOOK_YELLOW, (0.13, -0.02, 0.31), (90, 0, 0), smooth=False)
    return p


def clock():
    p = Prop('prop_clock')  # 0.36 across on a wall; origin at the bottom centre
    p.add(cyl(0.18, 0.18, 0.04, round_bottom=0.012, round_top=0.012, segs=24), MINT, (0, 0, 0.18), (90, 0, 0))
    p.add(cyl(0.15, 0.15, 0.006, segs=24), CREAM, (0, -0.019, 0.18), (90, 0, 0))
    for k in range(12):  # hour marks
        a = math.radians(30 * k)
        p.add(rbox(0.006, 0.004, 0.022 if k % 3 == 0 else 0.012, 0.001, 1), DARK,
              (0.128 * math.sin(a), -0.023, 0.18 + 0.128 * math.cos(a)), (0, 30 * k, 0))
    p.add(rbox(0.014, 0.006, 0.1, 0.002, 1), DARK, (0, -0.024, 0.225))
    p.add(rbox(0.014, 0.006, 0.075, 0.002, 1), DARK, (0.03, -0.024, 0.195), (0, 60, 0))
    p.add(ball(0.012, 0.006, 0.012), PINK, (0, -0.026, 0.18))
    return p


def pendant():
    p = Prop('prop_pendant')  # hangs from the ceiling; origin at the top
    p.add(cyl(0.05, 0.04, 0.03, segs=12), WOOD, (0, 0, -0.015))
    p.add(cyl(0.006, 0.006, 0.5, segs=6), DARK, (0, 0, -0.26))
    p.add(cyl(0.22, 0.08, 0.2, segs=20), SHADE, (0, 0, -0.58))
    p.add(ball(0.05, 0.05, 0.05), BULB, (0, 0, -0.66))
    return p


# ---- kitchen ----
def dining_table():
    p = Prop('prop_dining_table')  # 1.4 × 0.85, 0.62 high
    p.add(soft_plate(1.4, 0.85, 0.04, 0.03, 0.012), WOOD, (0, 0, 0.6))
    for y in (-0.33, 0.33):  # the frame under the top
        p.add(rbox(1.16, 0.022, 0.07, 0.006, 1), WOOD, (0, y, 0.545))
    for x in (-0.6, 0.6):
        p.add(rbox(0.022, 0.64, 0.07, 0.006, 1), WOOD, (x, 0, 0.545))
    four_legs(p, WOOD, 0.6, 0.33, 0.58, 0.02, 0.03)
    return p


def counter_front(p):
    p.add(rbox(0.96, 0.5, 0.1, 0.006, 1), DARK, (0, 0.04, 0.05))          # toe kick
    p.add(rbox(1.0, 0.02, 0.1, 0.005, 1), WORKTOP, (0, 0.3, 0.85))        # splashback
    for s in (-1, 1):
        shaker(p, 0.485, 0.62, MINT, s * 0.2475, -0.26, 0.43, 0.06)
        bar_handle(p, s * 0.07, -0.287, 0.64, 0.14)


def counter():
    p = Prop('prop_counter')  # 1.0 × 0.62, 0.8 high (0.9 with the splashback)
    p.add(rbox(1.0, 0.56, 0.66, 0.006, 1), CABINET, (0, 0.02, 0.43))
    p.add(rbox(1.0, 0.62, 0.04, 0.008, 2), WORKTOP, (0, 0, 0.78))
    counter_front(p)
    return p


def counter_sink():
    p = Prop('prop_counter_sink')  # the same counter with a basin and a tap
    p.add(rbox(1.0, 0.56, 0.52, 0.006, 1), CABINET, (0, 0.02, 0.36))
    # The top is built around the basin: left, right, front and back pieces.
    for z, h, material, d, y in ((0.69, 0.14, CABINET, 0.56, 0.02), (0.78, 0.04, WORKTOP, 0.62, 0.0)):
        for s in (-1, 1):
            p.add(rbox(0.27, d, h, 0), material, (s * 0.365, y, z), smooth=False)
        front = y - d / 2
        back = y + d / 2
        p.add(rbox(0.46, -0.17 - front, h, 0), material, (0, (front - 0.17) / 2, z), smooth=False)
        p.add(rbox(0.46, back - 0.17, h, 0), material, (0, (back + 0.17) / 2, z), smooth=False)
    p.add(tub(0.5, 0.38, 0.16, 0.07, 0.022, 0.13, 5), METAL, (0, 0, 0.73))
    p.add(cyl(0.016, 0.016, 0.16, segs=10), METAL, (0, 0.24, 0.88))
    p.add(rbox(0.03, 0.14, 0.03, 0.01, 2), METAL, (0, 0.18, 0.96))
    for s in (-1, 1):
        p.add(ball(0.022, 0.022, 0.022), PINK if s < 0 else BOOK_BLUE, (s * 0.07, 0.24, 0.83))
    counter_front(p)
    return p


def stove():
    """A freestanding cooker in the counters' style: 0.68 wide, its hob at the worktop's height (0.8)."""
    p = Prop('prop_stove')
    p.add(rbox(0.68, 0.56, 0.66, 0.006, 1), CABINET, (0, 0.02, 0.43))
    p.add(rbox(0.66, 0.5, 0.1, 0.006, 1), DARK, (0, 0.04, 0.05))                 # toe kick
    p.add(rbox(0.68, 0.62, 0.04, 0.008, 2), WORKTOP, (0, 0, 0.78))
    p.add(rbox(0.6, 0.52, 0.006, 0.002, 1), BLACK, (0, 0.0, 0.803))               # the glass hob
    for x, y, r in ((0, -0.02, 0.11), (-0.2, 0.17, 0.065), (0.2, 0.17, 0.065)):  # the big ring takes the pan
        ring = [(r * math.cos(a), r * math.sin(a), 0) for a in (2 * math.pi * k / 32 for k in range(32))]
        p.add(rope(ring + ring[:1], 0.004, 5), PINK, (x, y, 0.807))
    # The oven: a door with a window and a bar handle, and the knobs above it.
    p.add(rbox(0.6, 0.03, 0.48, 0.012, 2), MINT, (0, -0.265, 0.36))
    p.add(rbox(0.44, 0.012, 0.24, 0.02, 3), SCREEN, (0, -0.282, 0.38))
    p.add(cyl(0.012, 0.012, 0.46, segs=10), METAL, (0, -0.31, 0.56), (0, 90, 0))
    for s in (-1, 1):
        p.add(rbox(0.02, 0.04, 0.02, 0.006, 1), METAL, (s * 0.2, -0.292, 0.56))
    for k in range(4):
        p.add(cyl(0.022, 0.02, 0.025, round_top=0.006, segs=12), CREAM, (-0.21 + 0.14 * k, -0.29, 0.68), (90, 0, 0))
    p.add(rbox(0.68, 0.02, 0.1, 0.005, 1), WORKTOP, (0, 0.3, 0.85))               # splashback
    return p


LOUNGER_BACK = 35          # the backrest's angle above the flat part, in degrees
LOUNGER_HINGE = (0.2, 0.3)  # where the backrest turns up: y (towards the back) and height of the frame


def lounger_line():
    """The middle of the lounger's lying surface, foot to head, in the Y/Z plane: flat, then up the back."""
    hy, hz = LOUNGER_HINGE
    a = math.radians(LOUNGER_BACK)
    pts = [(y, hz) for y in (-0.8, -0.4, 0.0, hy - 0.04)]
    pts.append((hy + 0.04 * math.cos(a / 2), hz + 0.04 * math.sin(a / 2)))   # rounds the bend a little
    pts += [(hy + d * math.cos(a), hz + d * math.sin(a)) for d in (0.12, 0.36, 0.62)]
    return pts


def strip_along(line, width, thick, round_r, x=0.0, lift=0.0):
    """A board of `width` × `thick` swept along a Y/Z line, its underside `lift` above the line, ends capped."""
    bm = bmesh.new()
    rings = []
    n = len(line)
    for i, (y, z) in enumerate(line):
        ya, za = line[max(i - 1, 0)]
        yb, zb = line[min(i + 1, n - 1)]
        ty, tz = yb - ya, zb - za
        length = math.hypot(ty, tz)
        ty, tz = ty / length, tz / length
        ny, nz = -tz, ty                                   # up, away from the surface
        ring = []
        for cx, cz in outline(width / 2, thick / 2, round_r, 3):
            ring.append(bm.verts.new((x + cx, y + ny * (lift + thick / 2 + cz), z + nz * (lift + thick / 2 + cz))))
        rings.append(ring)
    m = len(rings[0])
    for r0, r1 in zip(rings, rings[1:]):
        for j in range(m):
            bm.faces.new((r0[j], r0[(j + 1) % m], r1[(j + 1) % m], r1[j]))
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def lounger():
    """A sun lounger, 1.7 long and 0.6 wide: a slatted wooden frame on four legs with a raised back,
    and one cushion that follows it from foot to head. The head end is at +Y."""
    p = Prop('prop_lounger')
    line = lounger_line()
    hy, hz = LOUNGER_HINGE
    a = math.radians(LOUNGER_BACK)
    # Frame: two side rails along the flat part, two along the back, joined at the hinge.
    for sx in (-1, 1):
        p.add(rbox(0.04, 0.05, 0.06, 0.01, 2), WOOD, (sx * 0.28, -0.82, 0.27))
        p.add(strip_along([(-0.84, hz - 0.06), (hy, hz - 0.06)], 0.04, 0.06, 0.012, x=sx * 0.28), WOOD)
        p.add(strip_along([(hy, hz - 0.06), (hy + 0.62 * math.cos(a), hz - 0.06 + 0.62 * math.sin(a))], 0.04, 0.06, 0.012,
                          x=sx * 0.28), WOOD)
        for y in (-0.74, 0.12):
            p.add(rbox(0.045, 0.045, hz - 0.03, 0.01, 1), WOOD, (sx * 0.28, y, (hz - 0.03) / 2))
        # A prop under the raised back, from the frame to the middle of the backrest.
        top = (hy + 0.42 * math.cos(a), hz - 0.06 + 0.42 * math.sin(a))
        foot = (hy + 0.05, hz - 0.03)
        p.add(strip_along([foot, top], 0.03, 0.03, 0.008, x=sx * 0.24), WOOD)
    # Slats under the cushion, across the frame.
    for k in range(12):
        t = k / 11
        idx = t * (len(line) - 1)
        i0 = min(int(idx), len(line) - 2)
        f = idx - i0
        y = line[i0][0] * (1 - f) + line[i0 + 1][0] * f
        z = line[i0][1] * (1 - f) + line[i0 + 1][1] * f
        tilt = 0 if y < hy - 0.05 else LOUNGER_BACK
        p.add(rbox(0.6, 0.07, 0.02, 0.006, 1), WOOD, (0, y, z - 0.01), (tilt, 0, 0))
    # The cushion, all one piece, and a pillow lying on it at the head.
    p.add(strip_along(line, 0.52, 0.07, 0.025, lift=0.0), CUSHION)
    end_y, end_z = line[-1]
    py, pz = end_y - 0.12 * math.cos(a), end_z - 0.12 * math.sin(a)
    pillow = puff(0.36, 0.14, 0.09, 3.0, 4)
    p.add(pillow, LINEN, (0, py - math.sin(a) * 0.115, pz + math.cos(a) * 0.115), (LOUNGER_BACK, 0, 0))
    return p


def patio_set():
    """A round garden table under a parasol: the table is 0.8 across; the canopy 2.0 across, 2.2 up."""
    p = Prop('prop_patio_set')
    p.add(cyl(0.4, 0.4, 0.03, round_top=0.01, segs=28), WOOD, (0, 0, 0.72))
    for k in range(4):
        a = math.radians(45 + 90 * k)
        p.add(rbox(0.04, 0.04, 0.72, 0.01, 1), WOOD, (0.28 * math.cos(a), 0.28 * math.sin(a), 0.36),
              (math.degrees(math.sin(a)) * 0.15, -math.degrees(math.cos(a)) * 0.15, 0))
    p.add(cyl(0.022, 0.022, 2.2, segs=10), CREAM, (0, 0, 1.1))
    p.add(cyl(0.16, 0.2, 0.05, segs=16), CREAM, (0, 0, 0.025))                    # the parasol's foot
    canopy = lathe([(1.0, 1.82), (0.75, 1.98), (0.4, 2.1), (0.03, 2.18), (0.001, 2.2)], 8)
    p.add(canopy, PINK)
    p.add(ball(0.035, 0.035, 0.035), CREAM, (0, 0, 2.22))
    return p


def wall_shelf():
    p = Prop('prop_wall_shelf')  # 0.8 × 0.2 board with jars; origin under the board
    p.add(rbox(0.8, 0.2, 0.03, 0.01), WOOD, (0, 0, 0.015))
    for s in (-1, 1):
        p.add(slab([(0, 0), (0.14, 0), (0, -0.14)], 0.03, 0.004), WOOD, (s * 0.3, 0.09, 0.0), (0, 0, 90))
    for x, colour, h in ((-0.28, BOOK_RED, 0.12), (-0.14, BOOK_YELLOW, 0.1), (0.0, BOOK_GREEN, 0.13)):
        p.add(cyl(0.045, 0.045, h, round_bottom=0.01, round_top=0.012, segs=12), colour, (x, 0, 0.03 + h / 2))
        p.add(cyl(0.04, 0.04, 0.02, round_top=0.006, segs=12), CREAM, (x, 0, 0.035 + h))
    p.add(cyl(0.04, 0.05, 0.07, round_bottom=0.01, segs=12), POT, (0.25, 0, 0.065))
    p.add(ball(0.07, 0.07, 0.06), LEAF, (0.25, 0, 0.14))
    return p


def trash_bin():
    p = Prop('prop_trash_bin')  # 0.32 across, 0.4 high
    p.add(cyl(0.12, 0.15, 0.34, round_bottom=0.03), MINT, (0, 0, 0.17))
    p.add(cyl(0.158, 0.158, 0.035, round_top=0.012), CREAM, (0, 0, 0.35))
    p.add(ball(0.025, 0.025, 0.018), PINK, (0, 0, 0.375))
    return p


# ---- bathroom ----
def toilet():
    p = Prop('prop_toilet')  # 0.4 × 0.63, 0.75 high
    p.add(rbox(0.38, 0.18, 0.36, 0.04), WHITE, (0, 0.22, 0.54))
    p.add(rbox(0.4, 0.2, 0.04, 0.015), WHITE, (0, 0.22, 0.73))
    p.add(ball(0.02, 0.02, 0.012), METAL, (0.1, 0.22, 0.752))
    p.add(cyl(0.12, 0.11, 0.14, round_bottom=0.02), WHITE, (0, -0.02, 0.07))
    for part, z, material in ((cyl(0.13, 0.19, 0.28, round_bottom=0.05, segs=20), 0.25, WHITE),
                              (cyl(0.2, 0.2, 0.035, round_bottom=0.012, round_top=0.012, segs=20), 0.405, WHITE),
                              (cyl(0.12, 0.12, 0.006, segs=20), 0.4245, WATER)):
        bmesh.ops.scale(part, vec=(1, 1.25, 1), verts=part.verts[:])
        p.add(part, material, (0, -0.07, z))
    return p


def bathtub():
    p = Prop('prop_bathtub')  # 0.8 wide, 1.7 long, 0.56 high
    p.add(tub(0.8, 1.7, 0.5, 0.3, 0.075, 0.38), WHITE, (0, 0, 0.31))
    p.add(plate(0.66, 1.56, 0.01, 0.23, 8), WATER, (0, 0, 0.44), smooth=False)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.add(ball(0.06, 0.06, 0.05), METAL, (sx * 0.26, sy * 0.68, 0.045))
    p.add(cyl(0.016, 0.016, 0.2, segs=10), METAL, (0, 0.8, 0.64))
    p.add(rbox(0.03, 0.16, 0.03, 0.01, 2), METAL, (0, 0.73, 0.74))
    return p


def vanity():
    p = Prop('prop_vanity')  # 0.6 × 0.42 cabinet with a basin; 0.9 high with the tap
    p.add(rbox(0.6, 0.4, 0.46, 0.008, 1), CABINET, (0, 0, 0.37))
    p.add(rbox(0.64, 0.44, 0.035, 0.008, 2), WORKTOP, (0, 0, 0.6125))
    for s in (-1, 1):
        shaker(p, 0.29, 0.42, MINT, s * 0.148, -0.2, 0.37, 0.04)
        p.add(ball(0.012, 0.012, 0.012), BLACK, (s * 0.04, -0.235, 0.46))
    four_legs(p, LEG, 0.26, 0.16, 0.15)
    p.add(tub(0.44, 0.3, 0.12, 0.12, 0.025, 0.09, 6), WHITE, (0, -0.03, 0.685))
    p.add(plate(0.385, 0.245, 0.006, 0.095, 6), WATER, (0, -0.03, 0.705), smooth=False)
    p.add(cyl(0.014, 0.014, 0.2, segs=10), METAL, (0, 0.17, 0.72))
    p.add(rbox(0.026, 0.12, 0.026, 0.008, 2), METAL, (0, 0.12, 0.82))
    return p


def mirror():
    p = Prop('prop_mirror')  # 0.5 × 0.65 on a wall; origin at the bottom centre
    p.add(slab(rounded_rect(0.5, 0.65, 0.12), 0.03, 0.008), WOOD)
    p.add(slab(rounded_rect(0.42, 0.57, 0.09), 0.01), MIRROR, (0, -0.012, 0.04), smooth=False)
    return p


def bath_mat():
    p = Prop('prop_bath_mat')  # 0.7 × 0.45
    p.add(plate(0.7, 0.45, 0.02, 0.12), RUG_BLUE, (0, 0, 0.01))
    p.add(plate(0.56, 0.31, 0.02, 0.08), LINEN, (0, 0, 0.013))
    return p


def basket():
    p = Prop('prop_basket')  # laundry basket, 0.44 across, 0.48 high
    p.add(cyl(0.17, 0.21, 0.4, round_bottom=0.04), BASKET, (0, 0, 0.2))
    p.add(cyl(0.22, 0.22, 0.04, round_bottom=0.015, round_top=0.015), BASKET, (0, 0, 0.4))
    p.add(ball(0.18, 0.18, 0.08), LINEN, (0, 0, 0.41))
    return p


# ---- entry ----
def little_shoe(p, x, z, colour):
    p.add(rbox(0.07, 0.17, 0.02, 0.008, 1), SHOE, (x, 0, z + 0.01))
    p.add(rbox(0.065, 0.16, 0.055, 0.025), colour, (x, 0.003, z + 0.045))


def shoe_rack():
    p = Prop('prop_shoe_rack')  # 0.8 × 0.3, 0.5 high
    for s in (-1, 1):
        p.add(rbox(0.04, 0.3, 0.5, 0.015), WOOD, (s * 0.38, 0, 0.25))
    for z in (0.1, 0.3, 0.485):
        p.add(rbox(0.76, 0.28, 0.03, 0.01), WOOD, (0, 0, z))
    for x, z, colour in ((-0.24, 0.115, PINK), (-0.15, 0.115, PINK), (0.1, 0.115, BOOK_BLUE), (0.19, 0.115, BOOK_BLUE),
                         (-0.05, 0.315, BOOK_YELLOW), (0.04, 0.315, BOOK_YELLOW)):
        little_shoe(p, x, z, colour)
    return p


def coat_rack():
    p = Prop('prop_coat_rack')  # 0.4 across, 1.6 high
    p.add(cyl(0.2, 0.17, 0.04, round_top=0.015, segs=20), WOOD, (0, 0, 0.02))
    p.add(cyl(0.022, 0.022, 1.52, segs=10), WOOD, (0, 0, 0.8))
    p.add(ball(0.04, 0.04, 0.04), PINK, (0, 0, 1.58))
    for k in range(4):
        a = math.radians(45 + 90 * k)
        axis = Vector((0.819 * math.sin(a), -0.819 * math.cos(a), 0.574))
        p.add(cyl(0.012, 0.012, 0.18, round_top=0.006, segs=8), WOOD, Vector((0, 0, 1.4)) + axis * 0.08,
              (55, 0, 45 + 90 * k))
    return p


def doormat():
    p = Prop('prop_doormat')  # 0.8 × 0.5
    p.add(plate(0.8, 0.5, 0.015, 0.06), MAT_BROWN, (0, 0, 0.0075))
    p.add(plate(0.68, 0.38, 0.015, 0.04), MAT_TAN, (0, 0, 0.0105))
    return p


BUILDERS = [
    bed, sofa, armchair, fridge, coffee_table, chair, broom, mop, sneakers,
    nightstand, table_lamp, wardrobe, desk, bookshelf, teddy,
    rug, rug_round, plant, floor_lamp, tv, vase, picture, clock, pendant,
    dining_table, counter, counter_sink, wall_shelf, trash_bin,
    toilet, bathtub, vanity, mirror, bath_mat, basket,
    shoe_rack, coat_rack, doormat, stove, lounger, patio_set,
]
# Modelled from an image in assets/concepts: these also get a GLB there.
FROM_CONCEPT = {'prop_bed', 'prop_sofa', 'prop_fridge', 'prop_coffee_table', 'prop_chair', 'prop_broom',
                'shoes_sneakers'}
# Made elsewhere (Tripo models, reduced by hand). This script cannot rebuild
# them, so it leaves them alone and only lines them up with the rest.
IMPORTED = ['prop_cake']

# ---- build into a "Nongs Props" collection, in rows south of the lawn ----
ROW_Y, SPACING, PER_ROW = -26, 3.0, 10
props = bpy.data.collections.get('Nongs Props')
if props:
    for o in list(props.objects):
        if o.name not in IMPORTED:
            bpy.data.objects.remove(o, do_unlink=True)
else:
    props = bpy.data.collections.new('Nongs Props')
    bpy.context.scene.collection.children.link(props)
for me in list(bpy.data.meshes):
    if me.users == 0:
        bpy.data.meshes.remove(me)


def slot(i):
    return ((i % PER_ROW - (PER_ROW - 1) / 2) * SPACING, ROW_Y - (i // PER_ROW) * SPACING, 0)


objects = []
for i, build in enumerate(BUILDERS):
    o = build().finish(props)
    o.location = slot(i)
    objects.append(o)
    print('built', o.name, sum(len(f.vertices) - 2 for f in o.data.polygons), 'triangles')
resized = []
for i, name in enumerate(IMPORTED):
    o = bpy.data.objects.get(name)
    if o:
        o.location = slot(len(BUILDERS) + i)
        # The mesh remembers how much it was enlarged, so running this twice does not enlarge it twice.
        had = o.data.get('nongs_scale', 1.0)
        if abs(had - SCALE) > 1e-6:
            o.data.transform(Matrix.Scale(SCALE / had, 4))
            o.data['nongs_scale'] = SCALE
            resized.append(o)


def export_all():
    """Writes one GLB per prop, each centred on the origin."""
    if not bpy.data.filepath:
        print('Not exported: open assets/blender/house.blend first.')
        return
    assets = os.path.normpath(os.path.join(os.path.dirname(bpy.data.filepath), '..'))
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objects + resized:
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        saved = o.location.copy()
        o.location = (0, 0, 0)
        path = os.path.join(assets, 'converted', o.name + '.glb')
        # Selected and visible: objects in collections outside the scene (the headphones) can still count as selected.
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, use_visible=True,
                                  export_apply=True, export_yup=True,
                                  export_image_format='JPEG', export_jpeg_quality=85)  # keeps the textures small
        o.location = saved
        o.select_set(False)
        if o.name in FROM_CONCEPT:
            shutil.copyfile(path, os.path.join(assets, 'concepts', o.name + '.glb'))
        print('exported', o.name, os.path.getsize(path), 'bytes')
    bpy.ops.wm.save_mainfile()


if globals().get('EXPORT', True):
    export_all()
