"""Models the hats and glasses a character can wear, and exports them.

Run it inside Blender with assets/blender/house.blend open, after build_gear.py
(it uses that script's reference bodies in the "Nongs Gear" scene):

    exec(open(r"<repo>/tools/blender/build_accessories.py").read())

Writes assets/converted/gear_accessories.glb. Like the headphones, everything
is modelled in "head units": the origin is the middle of the head, and the
head's half-width, half-height and half-depth are each 1; the game scales each
piece by the size of each body's head. The front faces -Y and Z is up.

Each piece is an empty named after its id in packages/shared/src/avatar.ts
(`hat-beanie`, `glasses-round`…), with its meshes under it.
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(bpy.data.filepath))))
OUT = os.path.join(ROOT, 'assets', 'converted', 'gear_accessories.glb')
COLL_NAME = 'Gear Accessories'

# The head is not a ball: these fit the hair cap (a shell a few mm over the skull).
HAT_RX, HAT_RY, HAT_RZ = 1.1, 1.12, 1.12   # the inside of a hat, a little over the hair
HAT_BOTTOM = 0.12                            # where a hat's edge comes down to, above the middle
# Glasses: the eyes' height and how far apart they are, and where the face is.
EYE_Z = -0.08
EYE_X = 0.42
FACE_Y = -1.04


def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name, hex_colour, roughness, metallic=0.0, alpha=1.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    rgb = [lin(((hex_colour >> s) & 255) / 255) for s in (16, 8, 0)]
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Alpha'].default_value = alpha
    if alpha < 1:
        mat.surface_render_method = 'BLENDED'
    return mat


def finish(name, bm, mat, parent, bevel=0.0, smooth=True):
    old = bpy.data.meshes.get(name)
    if old:
        bpy.data.meshes.remove(old)
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = smooth
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


def piece(name):
    obj = bpy.data.objects.new(name, None)
    COLL.objects.link(obj)
    obj.parent = ROOT_OBJ
    return obj


def dome(bm, rx, ry, rz, bottom, thickness, segments=48, rings=16, front_lift=0.0):
    """A shell over the top of an ellipsoid, from z = bottom up, `thickness` thick.
    `front_lift` raises the edge at the front (so a hat clears the eyes)."""
    def ring(scale, k):
        t = k / rings
        out = []
        for i in range(segments):
            a = 2 * math.pi * i / segments
            front = max(0.0, -math.sin(a))          # 1 at the front (-Y), 0 at the sides and back
            z0 = bottom + front_lift * front ** 2
            # From the edge (t = 0) to the top (t = 1), along the ellipsoid.
            lat0 = math.asin(max(-1.0, min(1.0, z0 / rz)))
            lat = lat0 + (math.pi / 2 - lat0) * t
            r = math.cos(lat)
            out.append((rx * scale * r * math.cos(a), ry * scale * r * math.sin(a), rz * scale * math.sin(lat)))
        return out

    outer = [[bm.verts.new(p) for p in ring(1 + thickness, k)] for k in range(rings)]
    inner = [[bm.verts.new(p) for p in ring(1.0, k)] for k in range(rings)]
    top_o = bm.verts.new((0, 0, rz * (1 + thickness)))
    top_i = bm.verts.new((0, 0, rz))
    n = segments
    for k in range(rings - 1):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((outer[k][i], outer[k][j], outer[k + 1][j], outer[k + 1][i]))
            bm.faces.new((inner[k][i], inner[k + 1][i], inner[k + 1][j], inner[k][j]))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((outer[-1][i], outer[-1][j], top_o))
        bm.faces.new((inner[-1][j], inner[-1][i], top_i))
        bm.faces.new((outer[0][j], outer[0][i], inner[0][i], inner[0][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return outer[0]


def band(bm, rx, ry, z0, z1, thickness, segments=48):
    """A thick ring around the head between two heights: a turned-up cuff."""
    rows = []
    for z, s in ((z0, 1.0), (z1, 1.0), (z1, 1.0 + thickness), (z0, 1.0 + thickness)):
        rows.append([bm.verts.new((rx * s * math.cos(2 * math.pi * i / segments),
                                   ry * s * math.sin(2 * math.pi * i / segments), z)) for i in range(segments)])
    for r in range(4):
        a, b = rows[r], rows[(r + 1) % 4]
        for i in range(segments):
            j = (i + 1) % segments
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


def ball(bm, centre, radius):
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=radius, matrix=Matrix.Translation(centre))


def torus_y(bm, x, y, z, major, minor, sx=1.0, sz=1.0, segments=36, rings=10):
    """A ring facing forward (its hole along Y), stretched by sx and sz."""
    verts = []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        ring = []
        for j in range(rings):
            b = 2 * math.pi * j / rings
            r = major + minor * math.cos(b)
            ring.append(bm.verts.new((x + sx * r * math.cos(a), y + minor * math.sin(b), z + sz * r * math.sin(a))))
        verts.append(ring)
    for i in range(segments):
        for j in range(rings):
            a, b = verts[i][j], verts[(i + 1) % segments][j]
            c, d = verts[(i + 1) % segments][(j + 1) % rings], verts[i][(j + 1) % rings]
            bm.faces.new((a, b, c, d))


def rounded_rect_rim(bm, x, y, z, w, h, corner, tube, segments_per_corner=6, rings=8):
    """A rim around a rounded rectangle in the XZ plane, w × h, its hole along Y."""
    path = []
    for c, (cx, cz, a0) in enumerate(((w / 2 - corner, h / 2 - corner, 0), (-w / 2 + corner, h / 2 - corner, 90),
                                      (-w / 2 + corner, -h / 2 + corner, 180), (w / 2 - corner, -h / 2 + corner, 270))):
        for k in range(segments_per_corner + 1):
            a = math.radians(a0 + 90 * k / segments_per_corner)
            path.append((cx + corner * math.cos(a), cz + corner * math.sin(a), math.cos(a), math.sin(a)))
    verts = []
    for px, pz, nx, nz in path:
        ring = []
        for j in range(rings):
            b = 2 * math.pi * j / rings
            ring.append(bm.verts.new((x + px + nx * tube * math.cos(b), y + tube * math.sin(b), z + pz + nz * tube * math.cos(b))))
        verts.append(ring)
    n = len(verts)
    for i in range(n):
        for j in range(rings):
            a, b = verts[i][j], verts[(i + 1) % n][j]
            c, d = verts[(i + 1) % n][(j + 1) % rings], verts[i][(j + 1) % rings]
            bm.faces.new((a, b, c, d))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


def lens(bm, x, y, z, w, h, corner, segments_per_corner=6):
    """A flat lens filling a rounded rectangle (corner = h/2 = w/2 makes it round)."""
    pts = []
    for cx, cz, a0 in ((w / 2 - corner, h / 2 - corner, 0), (-w / 2 + corner, h / 2 - corner, 90),
                       (-w / 2 + corner, -h / 2 + corner, 180), (w / 2 - corner, -h / 2 + corner, 270)):
        for k in range(segments_per_corner + 1):
            a = math.radians(a0 + 90 * k / segments_per_corner)
            pts.append(bm.verts.new((x + cx + corner * math.cos(a), y, z + cz + corner * math.sin(a))))
    bm.faces.new(pts)


def bar(bm, a, b, radius):
    """A thin rod from a to b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=radius, radius2=radius, depth=d.length,
                          matrix=Matrix.Translation((a + b) / 2) @ rot)


def glasses(name, w, h, corner, frame_mat, lens_mat, tube=0.035):
    obj = piece(name)
    bm = bmesh.new()
    for side in (-1, 1):
        rounded_rect_rim(bm, side * EYE_X, FACE_Y, EYE_Z, w, h, corner, tube)
    # The bridge over the nose, and the arms back to the ears.
    bar(bm, (-EYE_X + w / 2, FACE_Y, EYE_Z + h * 0.18), (EYE_X - w / 2, FACE_Y, EYE_Z + h * 0.18), tube * 0.8)
    for side in (-1, 1):
        hinge = (side * (EYE_X + w / 2 + tube * 0.5), FACE_Y, EYE_Z + h * 0.25)
        ear = (side * 1.04, 0.05, EYE_Z + h * 0.05)
        bar(bm, hinge, (side * 1.04, FACE_Y + 0.25, hinge[2]), tube * 0.8)
        bar(bm, (side * 1.04, FACE_Y + 0.25, hinge[2]), ear, tube * 0.8)
    finish(f'{name}-frame', bm, frame_mat, obj)
    bm = bmesh.new()
    for side in (-1, 1):
        lens(bm, side * EYE_X, FACE_Y + 0.005, EYE_Z, w - tube, h - tube, max(0.001, corner - tube / 2))
    finish(f'{name}-lens', bm, lens_mat, obj, smooth=False)
    return obj


# ---- scene ----
HOUSE_SCENE = bpy.context.window.scene
scene = bpy.data.scenes.get('Nongs Gear') or bpy.data.scenes.new('Nongs Gear')
bpy.context.window.scene = scene

COLL = bpy.data.collections.get(COLL_NAME)
if COLL:
    for obj in list(COLL.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
else:
    COLL = bpy.data.collections.new(COLL_NAME)
    scene.collection.children.link(COLL)
bpy.context.view_layer.layer_collection.children[COLL_NAME].hide_viewport = False

knit = material('Hat Knit', 0xe85d75, 0.95)            # soft wool; the game tints it to the chosen colour
knit_pom = material('Hat Pompom', 0xf4f1ea, 1.0)
cap_cloth = material('Cap Cloth', 0x5b7fd1, 0.85)      # cotton twill; tinted in the game
cap_button = material('Cap Button', 0xf4f1ea, 0.6)
frame_dark = material('Glasses Frame', 0x2a2420, 0.35)
frame_gold = material('Glasses Wire', 0xc9a24a, 0.3, metallic=1.0)
lens_clear = material('Glasses Lens', 0xdfeef5, 0.05, alpha=0.18)
lens_dark = material('Glasses Shade', 0x1d2430, 0.1, alpha=0.82)

ROOT_OBJ = bpy.data.objects.new('accessories', None)
COLL.objects.link(ROOT_OBJ)

# Beanie: a knitted dome with a turned-up cuff and a pompom.
beanie = piece('hat-beanie')
bm = bmesh.new()
dome(bm, HAT_RX, HAT_RY, HAT_RZ * 1.06, HAT_BOTTOM + 0.12, 0.05, front_lift=0.05)
finish('hat-beanie-crown', bm, knit, beanie)
bm = bmesh.new()
band(bm, HAT_RX * 1.02, HAT_RY * 1.02, HAT_BOTTOM + 0.08, HAT_BOTTOM + 0.42, 0.08)
finish('hat-beanie-cuff', bm, knit, beanie, bevel=0.03)
bm = bmesh.new()
ball(bm, (0, 0, HAT_RZ * 1.06 * 1.05 + 0.12), 0.22)
finish('hat-beanie-pompom', bm, knit_pom, beanie)

# Cap: six-panel crown, a curved peak at the front, and a button on top.
cap = piece('hat-cap')
bm = bmesh.new()
dome(bm, HAT_RX, HAT_RY, HAT_RZ * 0.98, HAT_BOTTOM + 0.1, 0.04, front_lift=0.12)
finish('hat-cap-crown', bm, cap_cloth, cap)
bm = bmesh.new()
peak_z = HAT_BOTTOM + 0.22
rows = []
for k in range(3):             # from the crown's edge outward
    reach = [0.0, 0.38, 0.75][k]
    row = []
    for i in range(17):
        a = math.radians(200 + 140 * i / 16)          # the front half of the head, -Y
        r_x, r_y = HAT_RX * 1.04 + reach * 0.75, HAT_RY * 1.04 + reach
        droop = 0.16 * (reach / 0.75) ** 2 + 0.1 * abs(math.cos(a)) * (reach / 0.75)
        row.append((r_x * math.cos(a), r_y * math.sin(a), peak_z - droop))
    rows.append(row)
top = [[bm.verts.new((x, y, z + 0.025)) for x, y, z in row] for row in rows]
bot = [[bm.verts.new((x, y, z - 0.025)) for x, y, z in row] for row in rows]
for k in range(2):
    for i in range(16):
        bm.faces.new((top[k][i], top[k + 1][i], top[k + 1][i + 1], top[k][i + 1]))
        bm.faces.new((bot[k][i], bot[k][i + 1], bot[k + 1][i + 1], bot[k + 1][i]))
for i in range(16):
    bm.faces.new((top[-1][i], bot[-1][i], bot[-1][i + 1], top[-1][i + 1]))
    bm.faces.new((top[0][i], top[0][i + 1], bot[0][i + 1], bot[0][i]))
for k in range(2):
    bm.faces.new((top[k][0], bot[k][0], bot[k + 1][0], top[k + 1][0]))
    bm.faces.new((top[k][-1], top[k + 1][-1], bot[k + 1][-1], bot[k][-1]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
finish('hat-cap-peak', bm, cap_cloth, cap)
bm = bmesh.new()
ball(bm, (0, 0, HAT_RZ * 0.98 * 1.04), 0.09)
finish('hat-cap-button', bm, cap_button, cap)

# Glasses: round wire-rimmed, square dark-rimmed, and sunglasses.
glasses('glasses-round', 0.62, 0.62, 0.31, frame_gold, lens_clear, tube=0.028)
glasses('glasses-square', 0.7, 0.52, 0.12, frame_dark, lens_clear, tube=0.045)
glasses('glasses-sun', 0.72, 0.56, 0.2, frame_dark, lens_dark, tube=0.045)

# ---- export ----
# select_all leaves hidden objects (the headphones) selected, so clear every object by hand.
for obj in scene.objects:
    obj.select_set(False)
for obj in COLL.objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = ROOT_OBJ
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True,
                          export_cameras=False, export_lights=False, export_animations=False)
print('exported', OUT, os.path.getsize(OUT))

# ---- previews on the reference bodies from build_gear.py: female in a beanie and round
# glasses, male in a cap and square glasses ----
def measure_head(prefix):
    mesh = next(o for o in scene.objects if o.name.startswith(prefix) and o.type == 'MESH' and o.vertex_groups)
    heads = {g.index for g in mesh.vertex_groups if 'Head' in g.name}
    shown = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    points = [mesh.matrix_world @ shown.vertices[v.index].co for v in mesh.data.vertices
              if sum(g.weight for g in v.groups if g.group in heads) > 0.5]
    low = Vector([min(p[i] for p in points) for i in range(3)])
    high = Vector([max(p[i] for p in points) for i in range(3)])
    return (low + high) / 2, (high - low) / 2


for old in [o for o in scene.objects if o.name.startswith('acc-preview-')]:
    bpy.data.objects.remove(old, do_unlink=True)
for gender, wear in (('female', ('hat-beanie', 'glasses-round')), ('male', ('hat-cap', 'glasses-square'))):
    prefix = f'ref-{gender}-'
    if not any(o.name.startswith(prefix) for o in scene.objects):
        continue
    bpy.context.view_layer.update()
    centre, half = measure_head(prefix)
    for name in wear:
        src = bpy.data.objects[name]
        holder = bpy.data.objects.new(f'acc-preview-{gender}-{name}', None)
        scene.collection.objects.link(holder)
        holder.location = centre
        holder.scale = half
        for child in src.children:
            copy = child.copy()
            scene.collection.objects.link(copy)
            copy.name = f'acc-preview-{gender}-{child.name}'
            copy.parent = holder
# The collection stays at the origin; hide it so only the fitted previews show.
bpy.context.view_layer.layer_collection.children[COLL_NAME].hide_viewport = True
# Hide the headphones previews while looking at these.
for name in ('preview-female', 'preview-male'):
    if bpy.data.objects.get(name):
        bpy.data.objects[name].hide_viewport = True
