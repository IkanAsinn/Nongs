"""Models the things a character wears on the head for the voice switches, and exports them.

Run it inside Blender with assets/blender/house.blend open:

    exec(open(r"<repo>/tools/blender/build_gear.py").read())

It works in its own scene, "Nongs Gear", so the house is left alone, and writes
assets/converted/gear_headphones.glb. The mouth tape is not here: it is drawn
by the game on the face itself (apps/client/src/player/outfit.ts), because it
has to follow each face exactly.

The headphones are modelled in "head units": the origin is the middle of the
head and the head's half-width, half-height and half-depth are each 1. The game
scales them by the size of each body's head, so one model fits both bodies.
As everywhere in this project, the front faces -Y and Z is up. The two
character bodies are imported into the scene as references, with a copy of the
headphones on each head, but only the headphones are exported.

The game measures the head the same way this script does: from the vertices
that mostly follow a head bone (`Outfit` in outfit.ts).
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(bpy.data.filepath))))
OUT = os.path.join(ROOT, 'assets', 'converted', 'gear_headphones.glb')

REF_SPACING = 0.6  # the male reference stands this far to the side

# The ears are a little below the middle of the head and reach out to x = 1.
CUP_X = 1.17          # middle of an ear cup, across
CUP_Z = -0.27         # and its height
CUP_Y = 0.04          # a little behind the middle, as the ears are
CUP_R = 0.34
CUP_DEPTH = 0.2
CUSHION_R, CUSHION_TUBE = 0.25, 0.075
# The band: half of an ellipse over the head, clear of the hair.
BAND_A, BAND_B = 1.17, 1.27
BAND_WIDTH, BAND_THICK = 0.17, 0.07
BAND_END_Z = 0.12     # where it meets the top of the cups


def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name, hex_colour, roughness):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    rgb = [lin(((hex_colour >> s) & 255) / 255) for s in (16, 8, 0)]
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


def finish(name, bm, mat, parent, bevel=0.0):
    old = bpy.data.meshes.get(name)
    if old:
        bpy.data.meshes.remove(old)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    COLL.objects.link(obj)
    obj.data.materials.append(mat)
    obj.parent = parent
    if bevel:
        mod = obj.modifiers.new('Bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = 'ANGLE'
    return obj


def cylinder_x(bm, x0, x1, radius, y, z, segments=32):
    """A closed cylinder lying along X."""
    geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius,
                                 depth=x1 - x0, matrix=Matrix.Translation(((x0 + x1) / 2, y, z)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
    return geom


def torus_x(bm, x, y, z, major, minor, segments=32, rings=12):
    """A ring standing upright, its hole along X."""
    verts = []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        ring = []
        for j in range(rings):
            b = 2 * math.pi * j / rings
            r = major + minor * math.cos(b)
            ring.append(bm.verts.new((x + minor * math.sin(b), y + r * math.cos(a), z + r * math.sin(a))))
        verts.append(ring)
    for i in range(segments):
        for j in range(rings):
            a, b = verts[i][j], verts[(i + 1) % segments][j]
            c, d = verts[(i + 1) % segments][(j + 1) % rings], verts[i][(j + 1) % rings]
            bm.faces.new((a, b, c, d))


def dome_x(bm, x, y, z, radius, height, side, segments=32, rings=8):
    """Half of a flattened ball, bulging out along X towards `side`."""
    top = bm.verts.new((x + side * height, y, z))
    rows = []
    for j in range(rings):
        b = math.pi / 2 * (j + 1) / rings
        r = radius * math.sin(b)
        h = height * math.cos(b)
        rows.append([bm.verts.new((x + side * h, y + r * math.cos(2 * math.pi * i / segments),
                                   z + r * math.sin(2 * math.pi * i / segments))) for i in range(segments)])
    for i in range(segments):
        bm.faces.new((top, rows[0][i], rows[0][(i + 1) % segments]) if side < 0 else (top, rows[0][(i + 1) % segments], rows[0][i]))
    for j in range(rings - 1):
        for i in range(segments):
            q = (rows[j][i], rows[j + 1][i], rows[j + 1][(i + 1) % segments], rows[j][(i + 1) % segments])
            bm.faces.new(q if side < 0 else tuple(reversed(q)))
    bm.faces.new(rows[-1] if side > 0 else list(reversed(rows[-1])))


def sweep_band(bm, t0, t1, a, b, width, thick, inset=0.0, steps=48):
    """A flat band of rectangular section along the ellipse (a cos t, b sin t) in the XZ plane."""
    rings = []
    for k in range(steps + 1):
        t = t0 + (t1 - t0) * k / steps
        p = Vector((a * math.cos(t), CUP_Y, b * math.sin(t)))
        n = Vector((b * math.cos(t), 0, a * math.sin(t))).normalized()  # outward
        p -= n * inset
        ring = []
        for du, dv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            ring.append(bm.verts.new(p + n * (du * thick / 2) + Vector((0, dv * width / 2, 0))))
        rings.append(ring)
    for k in range(steps):
        for i in range(4):
            bm.faces.new((rings[k][i], rings[k + 1][i], rings[k + 1][(i + 1) % 4], rings[k][(i + 1) % 4]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


# ---- scene ----
HOUSE_SCENE = bpy.context.window.scene
scene = bpy.data.scenes.get('Nongs Gear') or bpy.data.scenes.new('Nongs Gear')
bpy.context.window.scene = scene

COLL = bpy.data.collections.get('Gear Headphones')
if COLL:
    for obj in list(COLL.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
else:
    COLL = bpy.data.collections.new('Gear Headphones')
    scene.collection.children.link(COLL)
# Hidden objects cannot be selected for the export; the end of the script hides them again.
bpy.context.view_layer.layer_collection.children['Gear Headphones'].hide_viewport = False

shell = material('Headphone Shell', 0x5fb3b0, 0.45)       # matt teal plastic
cushion = material('Headphone Cushion', 0xf1e7d8, 0.9)    # cream fabric
accent = material('Headphone Accent', 0xf3efe8, 0.5)      # off-white plastic

root = bpy.data.objects.new('headphones', None)
COLL.objects.link(root)

for side in (-1, 1):
    x = side * CUP_X
    # The cup: a short round shell with a domed back.
    bm = bmesh.new()
    inner, outer = x - side * CUP_DEPTH / 2, x + side * CUP_DEPTH / 2
    cylinder_x(bm, min(inner, outer), max(inner, outer), CUP_R, CUP_Y, CUP_Z)
    dome_x(bm, outer - side * 0.01, CUP_Y, CUP_Z, CUP_R * 0.86, 0.07, side)
    finish(f'headphones-cup-{"l" if side > 0 else "r"}', bm, shell, root, bevel=0.03)

    # A cream ring around the plate on the back of the cup.
    bm = bmesh.new()
    torus_x(bm, outer + side * 0.005, CUP_Y, CUP_Z, CUP_R * 0.62, 0.025)
    finish(f'headphones-ring-{"l" if side > 0 else "r"}', bm, accent, root)

    # The soft cushion against the ear, and the cloth inside it.
    bm = bmesh.new()
    torus_x(bm, inner - side * CUSHION_TUBE * 0.7, CUP_Y, CUP_Z, CUSHION_R, CUSHION_TUBE)
    finish(f'headphones-cushion-{"l" if side > 0 else "r"}', bm, cushion, root)
    bm = bmesh.new()
    cylinder_x(bm, min(inner, inner - side * 0.03), max(inner, inner - side * 0.03), CUSHION_R, CUP_Y, CUP_Z)
    finish(f'headphones-cloth-{"l" if side > 0 else "r"}', bm, cushion, root)

    # The fork that holds the cup: a rounded block from the top of the cup up to the band.
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1, matrix=Matrix.LocRotScale(
        Vector((x, CUP_Y, CUP_Z + CUP_R + 0.03)), None, Vector((0.12, 0.2, 0.16))))
    finish(f'headphones-hinge-{"l" if side > 0 else "r"}', bm, accent, root, bevel=0.035)

# The band over the head, and the padding under its middle.
t0 = math.asin(BAND_END_Z / BAND_B)
bm = bmesh.new()
sweep_band(bm, t0, math.pi - t0, BAND_A, BAND_B, BAND_WIDTH, BAND_THICK)
finish('headphones-band', bm, shell, root, bevel=0.025)
bm = bmesh.new()
sweep_band(bm, math.radians(48), math.radians(132), BAND_A, BAND_B, BAND_WIDTH * 0.85, 0.07, inset=BAND_THICK * 0.8)
finish('headphones-pad', bm, cushion, root, bevel=0.03)

# ---- export: only the headphones, with the root where the head's middle is ----
bpy.ops.object.select_all(action='DESELECT')
root.select_set(True)
for child in root.children:
    child.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True,
                          export_cameras=False, export_lights=False, export_animations=False)
print('exported', OUT, os.path.getsize(OUT))

# ---- references: both bodies, each wearing a copy, to check the fit ----
def measure_head(prefix):
    """The middle and half size of the head as drawn: the vertices that mostly follow a head bone."""
    mesh = next(o for o in scene.objects if o.name.startswith(prefix) and o.type == 'MESH' and o.vertex_groups)
    heads = {g.index for g in mesh.vertex_groups if 'Head' in g.name}
    shown = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    points = [mesh.matrix_world @ shown.vertices[v.index].co for v in mesh.data.vertices
              if sum(g.weight for g in v.groups if g.group in heads) > 0.5]
    low = Vector([min(p[i] for p in points) for i in range(3)])
    high = Vector([max(p[i] for p in points) for i in range(3)])
    return (low + high) / 2, (high - low) / 2


for gender in ('female', 'male'):
    prefix = f'ref-{gender}-'
    if not any(o.name.startswith(prefix) for o in scene.objects):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'assets', 'converted', f'body_{gender}.glb'))
        for obj in set(bpy.data.objects) - before:
            obj.name = prefix + obj.name
            if obj.parent is None and gender == 'male':
                obj.location.x += REF_SPACING
    bpy.context.view_layer.update()
    centre, half = measure_head(prefix)
    name = f'preview-{gender}'
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    preview = bpy.data.objects.new(name, None)
    preview.instance_type = 'COLLECTION'
    preview.instance_collection = COLL
    preview.location = centre
    preview.scale = half
    scene.collection.objects.link(preview)
COLL.hide_render = False
# The collection itself stays at the origin; hide it in the view so only the fitted copies show.
bpy.context.view_layer.layer_collection.children['Gear Headphones'].hide_viewport = True
# Back to the house, which the other scripts build in. Pick "Nongs Gear" in the scene list to see the fit.
if HOUSE_SCENE is not scene:
    bpy.context.window.scene = HOUSE_SCENE
