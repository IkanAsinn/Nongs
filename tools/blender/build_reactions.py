"""
Reactions (emotes) for the Nongs, keyframed on the game's own rig.

Run in Blender (house.blend open), e.g. through the MCP add-on:
    exec(open(r'tools/blender/build_reactions.py').read())

It imports body_male.glb into the "Nongs Reactions" collection (once), keys
one action per reaction on its armature, and exports each as an armature-only
clip: assets/converted/react_<name>.glb. The clips use the Mixamo bone names,
so the game plays them on both bodies like the Mixamo clips.

Poses are written as directions in world space, which reads naturally:
the body faces -Y, +X is its left, +Z is up. `aim(bone, d)` turns a bone so it
points along d; `turn(bone, axis, degrees)` rotates it about a world axis.
"""
import math
import os

import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = r'C:\Users\LEGION 5\Documents\Codes\Nongs'
BODY = os.path.join(ROOT, 'assets', 'converted', 'body_male.glb')
OUT = os.path.join(ROOT, 'assets', 'converted')
COLLECTION = 'Nongs Reactions'
PREFIX = 'react-'
FPS = 24

# Directions, in the body's frame.
LEFT, RIGHT = Vector((1, 0, 0)), Vector((-1, 0, 0))
FORWARD, BACK = Vector((0, -1, 0)), Vector((0, 1, 0))
UP, DOWN = Vector((0, 0, 1)), Vector((0, 0, -1))

# The bones the clips drive: the same 25 the Mixamo clips have (no fingers).
BONES = [
    'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
    'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
    'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
    'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
]


def v(x, y, z):
    return Vector((x, y, z)).normalized()


# ---------------------------------------------------------------- the rig --

def rig():
    """The reaction armature, imported once into its own collection."""
    scene = bpy.context.scene
    coll = bpy.data.collections.get(COLLECTION)
    if coll is None:
        coll = bpy.data.collections.new(COLLECTION)
        scene.collection.children.link(coll)
    found = [o for o in coll.all_objects if o.type == 'ARMATURE']
    if found:
        return found[0]
    bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children[COLLECTION]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=BODY)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        o.name = PREFIX + o.name
    arm = next(o for o in new if o.type == 'ARMATURE')
    arm.location = (0, -50, 0)
    return arm


class Poser:
    def __init__(self, arm):
        self.arm = arm
        self.to_arm = arm.matrix_world.inverted().to_3x3()
        for pb in arm.pose.bones:
            pb.rotation_mode = 'QUATERNION'

    def bone(self, name):
        return self.arm.pose.bones['mixamorig:' + name]

    def update(self):
        bpy.context.view_layer.update()

    def rest(self):
        for pb in self.arm.pose.bones:
            pb.matrix_basis = Matrix.Identity(4)
        self.update()

    def _rotate(self, name, q):
        pb = self.bone(name)
        m = pb.matrix.copy()
        head = m.translation.copy()
        pb.matrix = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head) @ m
        self.update()

    def aim(self, name, direction):
        """Turns the bone the shortest way so it points along `direction` (world)."""
        pb = self.bone(name)
        current = (pb.matrix.to_3x3() @ Vector((0, 1, 0))).normalized()
        wanted = (self.to_arm @ Vector(direction)).normalized()
        self._rotate(name, current.rotation_difference(wanted))

    def turn(self, name, axis, degrees):
        """Rotates the bone (and what hangs from it) about a world axis through its head."""
        axis = (self.to_arm @ Vector(axis)).normalized()
        self._rotate(name, Quaternion(axis, math.radians(degrees)))

    def lift(self, metres):
        """Moves the whole body up (a hop), in world metres."""
        pb = self.bone('Hips')
        m = pb.matrix.copy()
        m.translation += self.to_arm @ Vector((0, 0, metres))
        pb.matrix = m
        self.update()

    def key(self, frame):
        for name in BONES:
            pb = self.bone(name)
            pb.keyframe_insert('rotation_quaternion', frame=frame)
        self.bone('Hips').keyframe_insert('location', frame=frame)


# ---------------------------------------------------------- shared poses --

def arms_down(p, spread=0.22):
    """Standing at ease, like the idle clip: arms hanging, a little away from the body."""
    p.aim('LeftArm', v(spread, 0.02, -1))
    p.aim('LeftForeArm', v(spread * 0.6, -0.12, -1))
    p.aim('RightArm', v(-spread, 0.02, -1))
    p.aim('RightForeArm', v(-spread * 0.6, -0.12, -1))


def neutral(p):
    p.rest()
    arms_down(p)


# ------------------------------------------------------------- reactions --
# Each returns a list of (time in seconds, pose function). The first and last
# poses are the neutral one, so the game can blend in and out of idle.

def wave():
    def raised(sway):
        def pose(p):
            neutral(p)
            p.turn('Spine1', FORWARD, -3)
            p.aim('RightArm', v(-0.75, -0.15, 0.45))
            p.aim('RightForeArm', v(-0.25 + sway, -0.2, 1))
            p.turn('Head', FORWARD, 8)
        return pose
    keys = [(0, neutral), (0.3, raised(0))]
    t = 0.3
    for i in range(4):
        t += 0.22
        keys.append((t, raised(-0.55 if i % 2 == 0 else 0.25)))
    keys += [(t + 0.25, raised(0)), (t + 0.6, neutral)]
    return keys


def clap():
    def hands(apart):
        def pose(p):
            neutral(p)
            p.aim('LeftArm', v(0.3, -0.75, -0.55))
            p.aim('LeftForeArm', v(-0.75 + apart, -0.65, 0.25))
            p.aim('RightArm', v(-0.3, -0.75, -0.55))
            p.aim('RightForeArm', v(0.75 - apart, -0.65, 0.25))
            p.turn('Head', LEFT, -6)
        return pose
    keys = [(0, neutral), (0.25, hands(0.7))]
    t = 0.25
    for _ in range(4):
        keys += [(t + 0.13, hands(0.02)), (t + 0.3, hands(0.7))]
        t += 0.3
    keys += [(t + 0.35, neutral)]
    return keys


def cheer():
    def up(height, wide):
        def pose(p):
            neutral(p)
            p.lift(height)
            p.turn('Spine1', LEFT, -6)
            p.aim('LeftArm', v(wide, -0.1, 1))
            p.aim('LeftForeArm', v(wide * 0.6, -0.15, 1))
            p.aim('RightArm', v(-wide, -0.1, 1))
            p.aim('RightForeArm', v(-wide * 0.6, -0.15, 1))
            p.turn('Head', LEFT, -12)
        return pose

    def crouch(p):
        neutral(p)
        p.lift(-0.035)
        p.turn('LeftUpLeg', LEFT, -25)
        p.turn('LeftLeg', LEFT, 45)
        p.turn('RightUpLeg', LEFT, -25)
        p.turn('RightLeg', LEFT, 45)
        p.aim('LeftArm', v(0.3, -0.3, -1))
        p.aim('RightArm', v(-0.3, -0.3, -1))
    return [
        (0, neutral), (0.25, crouch), (0.45, up(0.07, 0.55)), (0.7, up(0.02, 0.5)),
        (0.95, up(0.06, 0.6)), (1.2, up(0, 0.5)), (1.6, neutral),
    ]


def shrug():
    def pose(p):
        neutral(p)
        p.turn('LeftShoulder', FORWARD, -10)
        p.turn('RightShoulder', FORWARD, 10)
        p.aim('LeftArm', v(0.35, -0.12, -1))
        p.aim('LeftForeArm', v(0.75, -0.75, 0.15))
        p.aim('RightArm', v(-0.35, -0.12, -1))
        p.aim('RightForeArm', v(-0.75, -0.75, 0.15))
        p.turn('LeftHand', FORWARD, 35)
        p.turn('RightHand', FORWARD, -35)
        p.turn('Head', FORWARD, 12)
    return [(0, neutral), (0.35, pose), (1.15, pose), (1.55, neutral)]


def laugh():
    def pose(back):
        def inner(p):
            neutral(p)
            p.turn('Spine1', LEFT, -back)
            p.turn('Spine2', LEFT, -back * 0.6)
            p.turn('Head', LEFT, -back * 1.4)
            p.aim('RightArm', v(-0.25, -0.35, -1))
            p.aim('RightForeArm', v(0.7, -0.7, 0.05))
            p.aim('LeftArm', v(0.25, -0.35, -1))
            p.aim('LeftForeArm', v(-0.7, -0.7, 0.05))
        return inner
    keys = [(0, neutral), (0.3, pose(10))]
    t = 0.3
    for i in range(7):
        t += 0.14
        keys.append((t, pose(14 if i % 2 == 0 else 7)))
    keys += [(t + 0.35, neutral)]
    return keys


REACTIONS = {'wave': wave, 'clap': clap, 'cheer': cheer, 'shrug': shrug, 'laugh': laugh}


# ---------------------------------------------------------------- build --

def build(arm, name, keys):
    p = Poser(arm)
    arm.animation_data_create()
    old = bpy.data.actions.get(PREFIX + name)
    if old:
        bpy.data.actions.remove(old)
    action = bpy.data.actions.new(PREFIX + name)
    action.use_fake_user = True
    arm.animation_data.action = action
    last = 0
    for seconds, pose in keys:
        frame = round(seconds * FPS)
        pose(p)
        p.key(frame)
        last = max(last, frame)
    # Smooth in and out of every key.
    for fcurve in action_curves(action):
        for point in fcurve.keyframe_points:
            point.interpolation = 'BEZIER'
            point.easing = 'AUTO'
    action.frame_range = (0, last)
    return action, last


def action_curves(action):
    # Blender 4.4+ keeps curves in layered channelbags; older versions on the action.
    if hasattr(action, 'fcurves') and len(action.fcurves):
        return list(action.fcurves)
    curves = []
    for layer in getattr(action, 'layers', []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                curves.extend(bag.fcurves)
    return curves


def export(arm, name, last):
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 0, last
    bpy.ops.object.select_all(action='DESELECT')
    arm.hide_set(False)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, f'react_{name}.glb'),
        export_format='GLB',
        use_selection=True,
        # The headphones' collection is not in the scene, so without this they would come along.
        use_visible=True,
        export_animations=True,
        export_animation_mode='ACTIVE_ACTIONS',
        export_force_sampling=True,
        export_skins=False,
        export_morph=False,
        export_materials='NONE',
        export_apply=False,
    )


def main():
    arm = rig()
    built = {}
    for name, make in REACTIONS.items():
        _action, last = build(arm, name, make())
        export(arm, name, last)
        built[name] = round(last / FPS, 2)
    # Leave the rig standing at rest.
    arm.animation_data.action = None
    Poser(arm).rest()
    return built


built = main()
