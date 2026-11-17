"""Builds the Nongs house in Blender and exports it for the game.

Run it inside Blender with assets/blender/house.blend open (Scripting tab, or
through the Blender MCP):

    exec(open(r"<repo>/tools/blender/build_house.py").read())

It rebuilds the "Nongs House" collection, saves the .blend and writes
assets/converted/house.glb, which the client loads.

The layout numbers below are a copy of packages/shared/src/house.ts. The game
takes its collision from that file, so change both together.
Game coordinates are metres with Y up; Blender is Z up: game (x, y, z) -> (x, -z, y).
"""
import json
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

# ---- layout (copy of packages/shared/src/house.ts) ----
H, T, DH, DW = 2.8, 0.15, 2.1, 1.1
MINX, MAXX, MINZ, MAXZ = -14, 14, -10, 10
WX, EX = -6, 6
ZONES = [
    ('living', 'Living Room', WX, EX, MINZ, MAXZ, 0xf6c9b8),
    ('entry', 'Entry', MINX, WX, -2, 2, 0xe9e2d5),
    ('kitchen', 'Kitchen', EX, MAXX, MINZ, -1, 0xf7e3a6),
    ('bedroom1', 'Bedroom 1', MINX, WX, MINZ, -2, 0xbcd9f2),
    ('bedroom2', 'Bedroom 2', MINX, WX, 2, MAXZ, 0xd7c6f0),
    ('bedroom3', 'Bedroom 3', EX, MAXX, 3, MAXZ, 0xf3bfd6),
    ('bathroom', 'Bathroom', EX, MAXX, -1, 3, 0xbfe3c8),
]
WALLS = [
    (MINX, MINZ, MAXX, MINZ), (MINX, MAXZ, MAXX, MAXZ), (MINX, MINZ, MINX, MAXZ), (MAXX, MINZ, MAXX, MAXZ),
    (WX, MINZ, WX, -2), (MINX, -2, WX, -2), (WX, 2, WX, MAXZ), (MINX, 2, WX, 2),
    (EX, -1, EX, MAXZ), (EX, -1, MAXX, -1), (EX, 3, MAXX, 3),
]
# (id, x, z, along) — ids match DOORS in house.ts; the game swings these objects.
DOORS = [
    ('door-front', MINX, 0, 'z'), ('door-bedroom1', WX, -6, 'z'), ('door-bedroom2', WX, 6, 'z'),
    ('door-bathroom', EX, 1, 'z'), ('door-bedroom3', EX, 6.5, 'z'),
]
# Sliding glass doors: (id, x, z, along, width). The panel on the low side is fixed; the game slides the other.
SLIDERS = [('door-backyard', MAXX, -3, 'z', 2.0)]
LAWN = (-30, 36, -18, 18)  # minX, maxX, minZ, maxZ
# The pool: minX, maxX, minZ, maxZ, height of the bottom, height of the water.
POOL = (21, 27, -8, 4, -1.3, -0.15)
# Steps down into the pool from its south (maxZ) end: how many, top of the first, drop and depth of each.
POOL_STEPS = (4, -0.25, 0.25, 0.45)
PATIO = (MAXX, 28.9, -9.9, 5.9)  # the paved terrace: minX, maxX, minZ, maxZ
# The water slide beside the pool (copy of SLIDE in house.ts). A tower with a ladder on its south face;
# the chute leaves the platform northwards, curls round to the west and drops into the pool.
SLIDE_TOWER = (30.5, 31.5, -4.4, -3.4, 2.6)  # minX, maxX, minZ, maxZ, height of the platform
SLIDE_LADDER = (31.0, -3.4)                  # middle of the ladder's foot
SLIDE_PATH = [  # the sliding surface, game (x, y, z), through which a Catmull-Rom curve runs
    (31.0, 2.6, -4.2), (31.0, 2.42, -4.7), (30.719, 2.12, -5.75), (29.95, 1.82, -6.519), (28.9, 1.52, -6.8),
    (27.85, 1.22, -6.519), (27.081, 0.94, -5.75), (26.8, 0.68, -4.7), (26.55, 0.45, -3.75), (26.1, 0.32, -3.05),
]
SLIDE_POSTS = [2, 3, 4, 5]                   # control points that stand on a post
# Furniture and decorations come from the file the game reads, so the two cannot drift apart.
# Each piece: model, x, z, quarter turns (0 faces south/+z, 1 east, 2 north, -1 west), height.
FURNITURE = []
if bpy.data.filepath:
    with open(os.path.join(os.path.dirname(bpy.data.filepath), '..', '..', 'packages', 'shared', 'src',
                           'furniture.data.json'), encoding='utf-8') as f:
        FURNITURE = [(p['model'], p['x'], p['z'], p['turns'], p.get('y', 0)) for p in json.load(f)['pieces']]
else:
    print('No furniture placed: save the .blend as assets/blender/house.blend first.')
SPAWN = (-12, 0)

# ---- visual only (not in house.ts) ----
SILL, WTOP = 0.9, 2.1
# (x, z, along, width, sill height)
WINDOWS = [
    (-10, MINZ, 'x', 1.8, SILL), (0, MINZ, 'x', 2.4, SILL), (10, MINZ, 'x', 1.6, 1.1),
    (-10, MAXZ, 'x', 1.8, SILL), (0, MAXZ, 'x', 2.4, SILL), (10, MAXZ, 'x', 1.8, SILL),
    (MINX, -6, 'z', 1.8, SILL), (MINX, 6, 'z', 1.8, SILL),
    (MAXX, -5.5, 'z', 1.6, 1.1), (MAXX, 1, 'z', 0.8, 1.5), (MAXX, 6.5, 'z', 1.8, SILL),
]
TREES = [(-24, -12, 1.0), (-25, 11, 1.2), (-19, -15, 0.8), (18, -14, 1.1), (18, 14, 0.9), (0, -14.5, 0.8), (-5, 15, 1.0),
         (32.5, -13, 1.0), (33, 12, 1.2), (33.5, -1.5, 0.9), (26, 13.5, 0.8)]
COPING = 0.5         # width of the stone edge around the pool
POOL_WALL = 0.25     # thickness of the pool's sides
FR = 0.06            # door and window frame thickness
CEILING = 0.2        # slab on top of the walls
ROOF_OVERHANG = 0.7
ROOF_RISE = 3.4

# ---- start clean ----
old = bpy.data.collections.get('Nongs House')
if old:
    for c in list(old.children_recursive) + [old]:
        for o in list(c.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(c)
for blk in (bpy.data.meshes, bpy.data.lights, bpy.data.materials):
    for d in list(blk):
        if d.users == 0:
            blk.remove(d)

scene = bpy.context.scene
root = bpy.data.collections.new('Nongs House')
scene.collection.children.link(root)


def coll(name):
    c = bpy.data.collections.new(name)
    root.children.link(c)
    return c


C_FLOOR, C_WALL, C_DOOR, C_WIN, C_ROOF, C_LAWN, C_POOL, C_SCENE, C_FURN, C_LIGHT = map(
    coll, ['Floors', 'Walls', 'Doors', 'Windows', 'Roof', 'Lawn', 'Pool', 'Scenery', 'Furniture', 'Lights'])


def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def mat(name, hexc, rough=0.8, alpha=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    rgb = [lin(((hexc >> s) & 255) / 255) for s in (16, 8, 0)]
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Alpha'].default_value = alpha
    m.diffuse_color = (*rgb, alpha)
    return m


# ---- textured materials: the texture helpers of build_props.py, kept in their own namespace ----
_PROPS = {}
if bpy.data.filepath:
    _props_path = os.path.join(os.path.dirname(bpy.data.filepath), '..', '..', 'tools', 'blender', 'build_props.py')
    with open(_props_path, encoding='utf-8') as _f:
        _props_src = _f.read()
    exec(_props_src[:_props_src.index('# ---- shape helpers')], _PROPS)


def house_textures():
    """Floorboards and tiles, light like the prop textures, so each floor's colour still shows."""
    np, rng = _PROPS['np'], _PROPS['np'].random.default_rng(11)
    n = 512
    u = np.arange(n) / n
    # Boards: four rows to the image, each with its own shade, a dark seam and staggered ends.
    row = np.floor(u * 4)[:, None]
    shade = 1 - 0.05 * rng.random(4)[row.astype(int)]
    grain = 0.5 * _PROPS['value_noise'](n, 6, 96, rng) + 0.5 * _PROPS['value_noise'](n, 24, 256, rng)
    seam = (np.abs((u * 4) % 1 - 0.5)[:, None] > 0.485)
    ends = ((u[None, :] + 0.37 * row) % 1 < 0.008)
    val = shade - 0.1 * grain - 0.25 * (seam | ends)
    planks = _PROPS['image']('tex_planks', np.stack([val, val * 0.97, val * 0.93], -1))
    # Tiles: a grid of four with pale grout and a faint mottling.
    tile = (np.abs((u * 4) % 1 - 0.5) > 0.47)
    grout = tile[:, None] | tile[None, :]
    val = 1 - 0.05 * _PROPS['value_noise'](n, 16, 16, rng) - 0.16 * grout
    tiles = _PROPS['image']('tex_tiles', np.stack([val] * 3, -1))
    _PROPS['TEXTURES']['planks'] = (planks, None)
    _PROPS['TEXTURES']['tiles'] = (tiles, None)


def tmat(name, hexc, rough, tex, tile):
    """A textured material (see mat in build_props.py); falls back to a plain colour without the .blend."""
    if not _PROPS:
        return mat(name, hexc, rough)
    return _PROPS['mat'](name, hexc, rough, tex=tex, tile=tile)


def world_uv(me, tile):
    """Texture coordinates in metres, projected from the side each face looks at."""
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        axis = max(range(3), key=lambda i: abs(poly.normal[i]))
        a, b = [i for i in range(3) if i != axis]
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = (co[a] / tile, co[b] / tile)


if _PROPS:
    house_textures()


def add_box(bm, x, y, z, sx, sy, sz):
    """A box given in game coordinates (centre and full size)."""
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sz, sy), verts=r['verts'])
    bmesh.ops.translate(bm, vec=(x, -z, y), verts=r['verts'])


def along_box(bm, al, x, z, u, y, su, sy, depth):
    """A box on a wall: u and su run along the wall, depth goes across it."""
    if al == 'x':
        add_box(bm, x + u, y, z, su, sy, depth)
    else:
        add_box(bm, x, y, z + u, depth, sy, su)


def across_box(bm, al, x, z, u, off, y, su, sy, depth):
    """Like along_box, but moved `off` across the wall (towards +x or +z)."""
    if al == 'x':
        add_box(bm, x + u, y, z + off, su, sy, depth)
    else:
        add_box(bm, x + off, y, z + u, depth, sy, su)


def make_obj(name, bm, material, collection, origin=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    collection.objects.link(o)
    me.materials.append(material)
    if material.get('tile'):
        world_uv(me, material['tile'])
    if origin:  # game coordinates
        ov = Vector((origin[0], -origin[2], origin[1]))
        me.transform(Matrix.Translation(-ov))
        o.location = ov
    return o


# ---- floors: boards in the living room and bedrooms, tiles where it gets wet or muddy ----
TILED = {'kitchen': 1.6, 'bathroom': 1.2, 'entry': 2.0}  # floors with tiles, and the size of four tiles in metres


def warm(col, k=0.45):
    """The room's colour moved towards honey-coloured wood."""
    return sum(int(((col >> s) & 255) * (1 - k) + ((0xdcb58a >> s) & 255) * k) << s for s in (16, 8, 0))


for zid, zname, x0, x1, z0, z1, col in ZONES:
    bm = bmesh.new()
    add_box(bm, (x0 + x1) / 2, -0.05, (z0 + z1) / 2, x1 - x0, 0.1, z1 - z0)
    if zid in TILED:
        material = tmat('Floor ' + zname, col, 0.45, 'tiles', TILED[zid])
    else:
        material = tmat('Floor ' + zname, warm(col), 0.6, 'planks', 3.2)
    make_obj('floor-' + zid, bm, material, C_FLOOR)

# ---- walls, with door and window openings ----
bm = bmesh.new()
for x1, z1, x2, z2 in WALLS:
    al = 'x' if abs(z1 - z2) < 1e-6 else 'z'
    a, b = (min(x1, x2), max(x1, x2)) if al == 'x' else (min(z1, z2), max(z1, z2))
    fixed = z1 if al == 'x' else x1

    def pos(x, z):
        return (x, z) if al == 'x' else (z, x)  # (along, across)

    ops = []
    for _, dx, dz, dal in DOORS:
        u, f = pos(dx, dz)
        if dal == al and abs(f - fixed) < 1e-6 and a < u < b:
            ops.append((u - DW / 2, u + DW / 2, 0, DH))
    for _, dx, dz, dal, w in SLIDERS:
        u, f = pos(dx, dz)
        if dal == al and abs(f - fixed) < 1e-6 and a < u < b:
            ops.append((u - w / 2, u + w / 2, 0, DH))
    for wx, wz, wal, w, sill in WINDOWS:
        u, f = pos(wx, wz)
        if wal == al and abs(f - fixed) < 1e-6 and a < u < b:
            ops.append((u - w / 2, u + w / 2, sill, WTOP))
    ops.sort()

    def push(f, t, y0, y1):
        if t - f < 1e-6 or y1 - y0 < 1e-6:
            return
        c = (f + t) / 2
        if al == 'x':
            add_box(bm, c, (y0 + y1) / 2, fixed, t - f, y1 - y0, T)
        else:
            add_box(bm, fixed, (y0 + y1) / 2, c, T, y1 - y0, t - f)

    cur = a - T / 2  # half a thickness extra so corners are filled
    for f, t, bot, top in ops:
        push(cur, f, 0, H)
        push(f, t, 0, bot)
        push(f, t, top, H)
        cur = t
    push(cur, b + T / 2, 0, H)
make_obj('walls', bm, tmat('Wall', 0xfbf6ee, 0.9, 'speckle', 1.5), C_WALL)  # a faint plaster texture

# ---- doors: frames, and leaves whose origin is on the hinge ----
# The leaf runs from its origin towards +along, which the game relies on.
m_door, m_trim = mat('Door', 0xb9824f, 0.6), mat('Trim', 0xffffff, 0.5)
bmf = bmesh.new()
for did, dx, dz, al in DOORS:
    for s in (-1, 1):
        along_box(bmf, al, dx, dz, s * (DW / 2 - FR / 2), DH / 2, FR, DH, T + 0.04)
    along_box(bmf, al, dx, dz, 0, DH - FR / 2, DW, FR, T + 0.04)
    lw, lh = DW - 2 * FR - 0.01, DH - FR - 0.01
    bml = bmesh.new()
    along_box(bml, al, dx, dz, 0, lh / 2, lw, lh, 0.05)
    along_box(bml, al, dx, dz, lw / 2 - 0.1, 1.0, 0.04, 0.04, 0.14)  # handle
    origin = (dx - lw / 2, 0, dz) if al == 'x' else (dx, 0, dz - lw / 2)
    make_obj(did, bml, m_door, C_DOOR, origin=origin)
make_obj('door-frames', bmf, m_trim, C_DOOR)

# ---- windows: frame, cross bars, sill, glass ----
bmw, bmg = bmesh.new(), bmesh.new()
for wx, wz, al, w, sill in WINDOWS:
    hgt = WTOP - sill
    cy = (sill + WTOP) / 2
    for s in (-1, 1):
        along_box(bmw, al, wx, wz, s * (w / 2 - FR / 2), cy, FR, hgt, T + 0.04)
        along_box(bmw, al, wx, wz, 0, cy + s * (hgt / 2 - FR / 2), w, FR, T + 0.04)
    along_box(bmw, al, wx, wz, 0, cy, 0.04, hgt, 0.05)
    if hgt > 0.8:
        along_box(bmw, al, wx, wz, 0, cy, w, 0.04, 0.05)
    along_box(bmw, al, wx, wz, 0, sill - 0.02, w + 0.2, 0.04, T + 0.14)
    along_box(bmg, al, wx, wz, 0, cy, w - 2 * FR, hgt - 2 * FR, 0.01)
make_obj('window-frames', bmw, m_trim, C_WIN)
glass = mat('Glass', 0xcfe9f7, 0.05, 0.25)
if hasattr(glass, 'surface_render_method'):
    glass.surface_render_method = 'BLENDED'
make_obj('window-glass', bmg, glass, C_WIN)

# ---- sliding glass doors: a frame, a fixed panel, and a panel the game slides ----
# The sliding panel is an object named after the door, with its origin on the
# floor under its middle. Its glass and handle are its children, so they move with it.
RAIL = 0.07   # width of a panel's own frame
TRACK = 0.03  # each panel sits this far from the middle of the wall


def glass_panel(bm_frame, bm_glass, al, x, z, u, off, width, height):
    for s in (-1, 1):
        across_box(bm_frame, al, x, z, u + s * (width / 2 - RAIL / 2), off, height / 2, RAIL, height, 0.045)
    for y in (RAIL / 2, height - RAIL / 2):
        across_box(bm_frame, al, x, z, u, off, y, width, RAIL, 0.045)
    across_box(bm_glass, al, x, z, u, off, height / 2, width - 2 * RAIL + 0.02, height - 2 * RAIL + 0.02, 0.012)


bms, bmsg = bmesh.new(), bmesh.new()
for sid, sx, sz, al, w in SLIDERS:
    for s in (-1, 1):
        along_box(bms, al, sx, sz, s * (w / 2 - FR / 2), DH / 2, FR, DH, T + 0.04)
    along_box(bms, al, sx, sz, 0, DH - FR / 2, w, FR, T + 0.04)
    along_box(bms, al, sx, sz, 0, 0.012, w, 0.024, T + 0.04)  # the track on the floor
    pw = (w - 2 * FR) / 2 + 0.03   # the panels overlap where they meet
    ph = DH - FR - 0.03
    centre = (w / 2 - FR) - pw / 2
    glass_panel(bms, bmsg, al, sx, sz, -centre, -TRACK, pw, ph)   # fixed
    bml, bmlg, bmh = bmesh.new(), bmesh.new(), bmesh.new()
    glass_panel(bml, bmlg, al, sx, sz, centre, TRACK, pw, ph)     # sliding
    for off in (TRACK + 0.04, TRACK - 0.04):                      # a wooden pull on each face
        across_box(bmh, al, sx, sz, centre + pw / 2 - RAIL / 2, off, 1.0, 0.035, 0.32, 0.035)
    origin = (sx + centre, 0, sz) if al == 'x' else (sx, 0, sz + centre)
    leaf = make_obj(sid, bml, m_trim, C_DOOR, origin=origin)
    for name, part, material in ((sid + '-glass', bmlg, glass), (sid + '-handle', bmh, m_door)):
        child = make_obj(name, part, material, C_DOOR, origin=origin)
        child.parent = leaf
        child.location = (0, 0, 0)
make_obj('slider-frames', bms, m_trim, C_DOOR)
make_obj('slider-glass', bmsg, glass, C_DOOR)

# ---- ceiling slab and hip roof (untick the Roof collection in the outliner to see inside) ----
bm = bmesh.new()
add_box(bm, 0, H + CEILING / 2, 0, MAXX - MINX + T, CEILING, MAXZ - MINZ + T)
make_obj('ceiling', bm, mat('Ceiling', 0xfffaf2, 0.9), C_ROOF)

bm = bmesh.new()
hx = (MAXX - MINX) / 2 + ROOF_OVERHANG
hy = (MAXZ - MINZ) / 2 + ROOF_OVERHANG
z0, z1 = H + CEILING, H + CEILING + ROOF_RISE
ridge = hx - hy  # 45° hips seen from above
eave = 0.18      # thickness of the roof edge
low = [bm.verts.new(p) for p in ((-hx, -hy, z0), (hx, -hy, z0), (hx, hy, z0), (-hx, hy, z0))]
top = [bm.verts.new((v.co.x, v.co.y, z0 + eave)) for v in low]
r0, r1 = bm.verts.new((-ridge, 0, z1)), bm.verts.new((ridge, 0, z1))
bm.faces.new(low[::-1])
for i in range(4):
    j = (i + 1) % 4
    bm.faces.new((low[i], low[j], top[j], top[i]))
bm.faces.new((top[0], top[1], r1, r0))  # front slope
bm.faces.new((top[2], top[3], r0, r1))  # back slope
bm.faces.new((top[1], top[2], r1))      # east hip
bm.faces.new((top[3], top[0], r0))      # west hip
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
make_obj('roof', bm, mat('Roof Tiles', 0xd9795f, 0.85), C_ROOF)

# ---- lawn: grass, path to the front door, fence, trees ----
lx0, lx1, lz0, lz1 = LAWN
px0, px1, pz0, pz1, pool_floor, pool_water = POOL


def around(bm, outer, hole, y, height):
    """A slab covering `outer` except for `hole` (both minX, maxX, minZ, maxZ)."""
    ox0, ox1, oz0, oz1 = outer
    hx0, hx1, hz0, hz1 = hole
    for x0, x1, z0, z1 in ((ox0, hx0, oz0, oz1), (hx1, ox1, oz0, oz1), (hx0, hx1, oz0, hz0), (hx0, hx1, hz1, oz1)):
        add_box(bm, (x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0, height, z1 - z0)


bm = bmesh.new()
basin = (px0 - POOL_WALL, px1 + POOL_WALL, pz0 - POOL_WALL, pz1 + POOL_WALL)
around(bm, LAWN, basin, -0.11, 0.2)
make_obj('lawn', bm, mat('Grass', 0x9fd68a, 0.95), C_LAWN)

# ---- backyard: the pool, its stone edge, and a paved terrace from the kitchen doors ----
bm = bmesh.new()
depth = -pool_floor + 0.1
around(bm, basin, (px0, px1, pz0, pz1), -depth / 2, depth)                                  # sides
add_box(bm, (px0 + px1) / 2, pool_floor - 0.05, (pz0 + pz1) / 2, px1 - px0, 0.1, pz1 - pz0)  # bottom
make_obj('pool-basin', bm, mat('Pool Tile', 0xa9dcea, 0.35), C_POOL)

bm = bmesh.new()
band = 0.22  # a darker line of tiles at the water's edge
around(bm, (px0 - 0.01, px1 + 0.01, pz0 - 0.01, pz1 + 0.01), (px0 + 0.012, px1 - 0.012, pz0 + 0.012, pz1 - 0.012),
       pool_water - band / 2 + 0.08, band)
make_obj('pool-band', bm, mat('Pool Band', 0x5aa6c9, 0.3), C_POOL)

bm = bmesh.new()
count, first, rise, run = POOL_STEPS
for i in range(count):
    top = first - i * rise
    add_box(bm, (px0 + px1) / 2, (top + pool_floor) / 2, pz1 - run * (i + 0.5), px1 - px0, top - pool_floor, run)
make_obj('pool-steps', bm, mat('Pool Step', 0xe4f3f6, 0.4), C_POOL)

bm = bmesh.new()
edge = (px0 - COPING, px1 + COPING, pz0 - COPING, pz1 + COPING)
around(bm, edge, (px0 - 0.04, px1 + 0.04, pz0 - 0.04, pz1 + 0.04), 0.015, 0.07)
make_obj('pool-coping', bm, mat('Coping', 0xf4efe6, 0.75), C_POOL)

bm = bmesh.new()
add_box(bm, (px0 + px1) / 2, pool_water - 0.005, (pz0 + pz1) / 2, px1 - px0, 0.01, pz1 - pz0)
water = mat('Pool Water', 0x7fd0e6, 0.08, 0.6)
if hasattr(water, 'surface_render_method'):
    water.surface_render_method = 'BLENDED'
make_obj('pool-water', bm, water, C_POOL)  # the game gives this one moving ripples

# Paving: square slabs with a narrow joint, laid on a darker bed.
tx0, tx1, tz0, tz1 = PATIO
tx0 += T / 2 + 0.01  # start at the outside face of the house wall
bm, bmj = bmesh.new(), bmesh.new()
SLAB, JOINT = 1.3, 0.03
for x0, x1, z0, z1 in ((tx0, edge[0], tz0, tz1), (edge[1], tx1, tz0, tz1), (edge[0], edge[1], tz0, edge[2]),
                       (edge[0], edge[1], edge[3], tz1)):
    add_box(bmj, (x0 + x1) / 2, -0.005, (z0 + z1) / 2, x1 - x0, 0.03, z1 - z0)
    nx, nz = max(1, round((x1 - x0) / SLAB)), max(1, round((z1 - z0) / SLAB))
    sx, sz = (x1 - x0) / nx, (z1 - z0) / nz
    for i in range(nx):
        for j in range(nz):
            add_box(bm, x0 + (i + 0.5) * sx, 0.0, z0 + (j + 0.5) * sz, sx - JOINT, 0.04, sz - JOINT)
make_obj('patio', bm, mat('Paving', 0xe3dccf, 0.9), C_POOL)
make_obj('patio-joints', bmj, mat('Paving Joint', 0xc4baa9, 0.95), C_POOL)


# ---- the water slide ----
def catmull(points, per=16):
    """Points along a uniform Catmull-Rom curve through `points` (the same curve as slidePoint in house.ts)."""
    pts = [Vector(p) for p in points]
    out = []
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, len(pts) - 1)]
        for k in range(per):
            t = k / per
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t))
    out.append(pts[-1])
    return out


def to_blender(v):
    return Vector((v.x, -v.z, v.y))


CHUTE_R, CHUTE_WALL = 0.38, 0.035
curve = catmull(SLIDE_PATH)
bm = bmesh.new()
rings = []
for i, p in enumerate(curve):
    t = (curve[min(i + 1, len(curve) - 1)] - curve[max(i - 1, 0)])
    t.y = 0
    t.normalize()
    side = Vector((t.z, 0, -t.x))          # horizontal, square to the way down
    up = Vector((0, 1, 0))
    centre = p + up * CHUTE_R
    ring = []
    angles = [math.radians(a) for a in range(200, 341, 10)]
    for a in angles:                        # inside of the U, left rim to right rim
        ring.append(centre + CHUTE_R * (math.cos(a) * side + math.sin(a) * up))
    for a in reversed(angles):              # outside, back again
        ring.append(centre + (CHUTE_R + CHUTE_WALL) * (math.cos(a) * side + math.sin(a) * up))
    rings.append([bm.verts.new(to_blender(v)) for v in ring])
n = len(rings[0])
for a, b in zip(rings, rings[1:]):
    for k in range(n):
        bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
bm.faces.new(rings[0][::-1])
bm.faces.new(rings[-1])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
chute = make_obj('pool-slide-chute', bm, mat('Slide Plastic', 0x4aa8e8, 0.3), C_POOL)
for f in chute.data.polygons:
    f.use_smooth = True

sx0, sx1, sz0, sz1, stop = SLIDE_TOWER
scx = (sx0 + sx1) / 2
POST = 0.1
RAIL_TOP = 0.95
bm = bmesh.new()
for x in (sx0 + POST / 2, sx1 - POST / 2):  # corner posts, up to the railing
    for z in (sz0 + POST / 2, sz1 - POST / 2):
        add_box(bm, x, (stop + RAIL_TOP) / 2, z, POST, stop + RAIL_TOP, POST)
for x in (sx0 + POST / 2, sx1 - POST / 2):  # railings on the east and west sides
    for y in (stop + 0.5, stop + RAIL_TOP):
        add_box(bm, x, y, (sz0 + sz1) / 2, 0.06, 0.05, sz1 - sz0)
for i in SLIDE_POSTS:                       # posts under the chute
    x, y, z = SLIDE_PATH[i]
    add_box(bm, x, (y - 0.02) / 2, z, 0.09, y - 0.02, 0.09)
    add_box(bm, x, 0.02, z, 0.24, 0.04, 0.24)
make_obj('pool-slide-frame', bm, mat('Slide Frame', 0xf4f1ea, 0.6), C_POOL)

bm = bmesh.new()
add_box(bm, scx, stop - 0.04, (sz0 + sz1) / 2, sx1 - sx0, 0.08, sz1 - sz0)  # platform
for y in (0.6, 1.4, 2.2):                   # cross braces between the posts
    add_box(bm, scx, y, sz0 + POST / 2, sx1 - sx0 - POST, 0.06, 0.04)
    add_box(bm, sx0 + POST / 2, y, (sz0 + sz1) / 2, 0.04, 0.06, sz1 - sz0 - POST)
    add_box(bm, sx1 - POST / 2, y, (sz0 + sz1) / 2, 0.04, 0.06, sz1 - sz0 - POST)
make_obj('pool-slide-deck', bm, mat('Slide Deck', 0xe2b98a, 0.7), C_POOL)

lx, lz = SLIDE_LADDER
bm = bmesh.new()
for s in (-1, 1):                           # ladder rails, rising above the platform as handles
    add_box(bm, lx + s * 0.26, (stop + RAIL_TOP) / 2, lz + 0.03, 0.05, stop + RAIL_TOP, 0.05)
rung = 0.3
y = rung
while y < stop - 0.1:
    add_box(bm, lx, y, lz + 0.03, 0.5, 0.04, 0.05)
    y += rung
make_obj('pool-slide-ladder', bm, mat('Slide Ladder', 0xf2c84b, 0.5), C_POOL)

bm = bmesh.new()
x = MINX - 1.0
while x > lx0 + 0.8:
    add_box(bm, x, 0.0, 0, 1.0, 0.04, 1.5)
    x -= 1.3
add_box(bm, MINX - 0.45, 0.05, 0, 0.9, 0.1, 2.0)  # doorstep
make_obj('path', bm, mat('Stone', 0xd9d2c5, 0.9), C_LAWN)

bm = bmesh.new()
for fx1, fz1, fx2, fz2 in [(lx0, lz0, lx1, lz0), (lx0, lz1, lx1, lz1), (lx0, lz0, lx0, lz1), (lx1, lz0, lx1, lz1)]:
    al = 'x' if fz1 == fz2 else 'z'
    length = (fx2 - fx1) if al == 'x' else (fz2 - fz1)
    cx, cz = (fx1 + fx2) / 2, (fz1 + fz2) / 2
    for y in (0.35, 0.75):
        along_box(bm, al, cx, cz, 0, y, length, 0.08, 0.04)
    n = int(round(length / 2))
    for i in range(n + 1):
        along_box(bm, al, cx, cz, -length / 2 + i * length / n, 0.5, 0.1, 1.0, 0.1)
make_obj('fence', bm, m_trim, C_LAWN)

bmt, bml = bmesh.new(), bmesh.new()
for tx, tz, s in TREES:
    add_box(bmt, tx, 0.6 * s, tz, 0.3 * s, 1.2 * s, 0.3 * s)
    for r, yy in [(1.3, 1.9), (1.0, 2.7), (0.65, 3.4)]:
        res = bmesh.ops.create_icosphere(bml, subdivisions=2, radius=r * s)
        bmesh.ops.translate(bml, vec=(tx, -tz, yy * s), verts=res['verts'])
make_obj('tree-trunks', bmt, mat('Bark', 0x8a5a3b, 0.9), C_LAWN)
make_obj('tree-leaves', bml, mat('Leaves', 0x6fbf73, 0.9), C_LAWN)

# ---- scenery beyond the fence: only to look at, nobody can go there yet ----
# Open fields out to the fog, a road past the front of the house, scattered trees and a ring of mountains.
import random as _random
_rnd = _random.Random(5)
FIELD = 600                      # the fields reach this far from the middle in every direction
ROAD_X, ROAD_W = -36.0, 7.0      # the road runs north–south past the front gate
VERGE = (-32.5, -30.6)           # the pavement between the road and the fence (minX, maxX)

bm = bmesh.new()
around(bm, (-FIELD, FIELD, -FIELD, FIELD), LAWN, -0.13, 0.2)
make_obj('scenery-fields', bm, mat('Field', 0x8fca7f, 0.95), C_SCENE)

bm = bmesh.new()
add_box(bm, ROAD_X, -0.01, 0, ROAD_W, 0.06, 2 * FIELD)
make_obj('scenery-road', bm, mat('Asphalt', 0x6d6f76, 0.9), C_SCENE)
bm = bmesh.new()
z = -FIELD
while z < FIELD:
    add_box(bm, ROAD_X, 0.021, z + 1.5, 0.16, 0.004, 3.0)                    # dashes down the middle
    z += 7.0
for side in (-1, 1):
    add_box(bm, ROAD_X + side * (ROAD_W / 2 - 0.25), 0.021, 0, 0.12, 0.004, 2 * FIELD)  # edge lines
make_obj('scenery-road-lines', bm, mat('Road Paint', 0xf6f3ea, 0.7), C_SCENE)
bm = bmesh.new()
add_box(bm, (VERGE[0] + VERGE[1]) / 2, 0.0, 0, VERGE[1] - VERGE[0], 0.1, 2 * FIELD)
make_obj('scenery-pavement', bm, mat('Pavement', 0xd9d2c5, 0.9), C_SCENE)

# Trees out in the fields, kept off the road and away from the fence.
bmt, bml = bmesh.new(), bmesh.new()
placed = 0
while placed < 45:
    a, r = _rnd.uniform(0, 2 * math.pi), _rnd.uniform(45, 150)
    tx, tz = 3 + r * math.cos(a), r * math.sin(a)
    if ROAD_X - ROAD_W - 3 < tx < VERGE[1] + 2:
        continue
    sc = _rnd.uniform(0.9, 1.6)
    add_box(bmt, tx, 0.6 * sc, tz, 0.3 * sc, 1.2 * sc, 0.3 * sc)
    for rr, yy in [(1.3, 1.9), (1.0, 2.7), (0.65, 3.4)]:
        res = bmesh.ops.create_icosphere(bml, subdivisions=1, radius=rr * sc)
        bmesh.ops.translate(bml, vec=(tx, -tz, yy * sc), verts=res['verts'])
    placed += 1
make_obj('scenery-tree-trunks', bmt, mat('Bark', 0x8a5a3b, 0.9), C_SCENE)
make_obj('scenery-tree-leaves', bml, mat('Field Leaves', 0x67b46d, 0.9), C_SCENE)

# Mountains: a few low cones all round, each a base ring, a lumpy middle ring and a peak.
# The tall ones get a snow cap that follows the slope from three quarters of the way up.
bmm, bms = bmesh.new(), bmesh.new()
SIDES = 9
count = 18
for k in range(count):
    a = 2 * math.pi * (k + _rnd.uniform(-0.3, 0.3)) / count
    dist = _rnd.uniform(270, 380)
    h = _rnd.uniform(40, 100)
    base_r = h * _rnd.uniform(1.4, 2.0)
    cx, cz = 3 + dist * math.cos(a), dist * math.sin(a)
    peak = Vector((cx + _rnd.uniform(-0.1, 0.1) * base_r, -cz, h))
    base, mid = [], []
    for i in range(SIDES):
        t = 2 * math.pi * i / SIDES
        rb = base_r * _rnd.uniform(0.85, 1.1)
        rm = base_r * 0.5 * _rnd.uniform(0.75, 1.15)
        base.append(Vector((cx + rb * math.cos(t), -(cz + rb * math.sin(t)), -0.5)))
        mid.append(Vector((cx + rm * math.cos(t), -(cz + rm * math.sin(t)), h * _rnd.uniform(0.42, 0.55))))
    vb = [bmm.verts.new(v) for v in base]
    vm = [bmm.verts.new(v) for v in mid]
    vp = bmm.verts.new(peak)
    for i in range(SIDES):
        j = (i + 1) % SIDES
        bmm.faces.new((vb[i], vb[j], vm[j], vm[i]))
        bmm.faces.new((vm[i], vm[j], vp))
    if h > 75:
        cap = [bms.verts.new(m.lerp(peak, 0.55) + (m.lerp(peak, 0.55) - peak).normalized() * 0.6 + Vector((0, 0, 0.3)))
               for m in mid]
        top = bms.verts.new(peak + Vector((0, 0, 0.6)))
        for i in range(SIDES):
            bms.faces.new((cap[i], cap[(i + 1) % SIDES], top))
make_obj('scenery-mountains', bmm, mat('Mountain', 0x8aa79a, 0.95), C_SCENE)
make_obj('scenery-snow', bms, mat('Snow', 0xf4f6f8, 0.8), C_SCENE)
for o in C_SCENE.objects:
    for poly in o.data.polygons:
        poly.use_smooth = False

# ---- furniture and decorations: linked copies of the props, to see the rooms furnished ----
# Not exported with the house: the game places furniture itself from the same file.
for model, fx, fz, quarter_turns, height in FURNITURE:
    source = bpy.data.objects.get(model)
    if source is None:
        print('No furniture', model, '- run build_props.py first')
        continue
    piece = bpy.data.objects.new(model + '-placed', source.data)
    piece.location = (fx, -fz, height)
    piece.rotation_euler = (0, 0, quarter_turns * math.pi / 2)
    mod = piece.modifiers.new('Normals', 'WEIGHTED_NORMAL')
    mod.keep_sharp = False
    C_FURN.objects.link(piece)

# ---- lights and markers (for looking at the scene in Blender; not exported) ----
sd = bpy.data.lights.new('Sun', 'SUN')
sd.energy = 3
so = bpy.data.objects.new('Sun', sd)
C_LIGHT.objects.link(so)
so.rotation_euler = (math.radians(50), 0, math.radians(30))
so.location = (0, 0, 12)
for zid, zname, x0, x1, z0_, z1_, col in ZONES:
    ld = bpy.data.lights.new('lamp-' + zid, 'POINT')
    ld.color = (1, 0.93, 0.82)
    ld.energy = 12 * (x1 - x0) * (z1_ - z0_)
    ld.shadow_soft_size = 0.3
    lo = bpy.data.objects.new('lamp-' + zid, ld)
    C_LIGHT.objects.link(lo)
    lo.location = ((x0 + x1) / 2, -(z0_ + z1_) / 2, H - 0.3)

spawn = bpy.data.objects.new('spawn', None)
spawn.empty_display_type = 'ARROWS'
spawn.empty_display_size = 0.5
spawn.location = (SPAWN[0], -SPAWN[1], 0)
C_LIGHT.objects.link(spawn)

cam = bpy.data.objects.get('Camera')
if cam:
    target = Vector((3, 0, 0))
    cam.location = (3, -38, 46)
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 32

# ---- save and export ----
if bpy.data.filepath:
    bpy.ops.wm.save_mainfile()
    out = os.path.normpath(os.path.join(os.path.dirname(bpy.data.filepath), '..', 'converted', 'house.glb'))
    props = bpy.data.collections.get('Nongs Props')  # made by build_props.py; not part of the house
    if props:
        props.hide_viewport = True
    C_LIGHT.hide_viewport = True
    C_FURN.hide_viewport = True
    if cam:
        cam.hide_set(True)
    # Only the house's own collection: the props, the cooking kit, the litter and the headphones
    # live in the same .blend and have GLBs of their own.
    bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children[root.name]
    # No meshopt compression: it rounds positions to a share of each mesh's size, and on the
    # big flat meshes (lawn, fields) that rounding let floors poke through one another.
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_visible=True,
                              use_active_scene=True, use_active_collection=True, use_active_collection_with_nested=True,
                              export_apply=True, export_yup=True,
                              export_image_format='JPEG', export_jpeg_quality=85)
    if cam:
        cam.hide_set(False)
    C_LIGHT.hide_viewport = False
    C_FURN.hide_viewport = False
    if props:
        props.hide_viewport = False
    print('exported', out, os.path.getsize(out), 'bytes')
else:
    print('Not exported: save the .blend as assets/blender/house.blend first.')
