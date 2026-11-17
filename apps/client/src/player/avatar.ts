import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AvatarConfig, Gender, VoiceSigns } from '@nongs/shared';
import { Outfit } from './outfit';

export type { Gender };
export type Locomotion = 'idle' | 'walk' | 'run' | 'jump';
/**
 * Ways the body rests. `sit` is on the edge of a seat with the shins hanging
 * down; `lounge` is sat back on a deep seat with the legs out along the cushion.
 */
export type Pose = 'sit' | 'lounge' | 'sleep';
export type AnimationName = Locomotion | Pose;
export type Side = 'left' | 'right';
/** In water: upright and treading, or lying forward and swimming a stroke. */
export type Swim = 'tread' | 'stroke';

export const PLAYER_HEIGHT = 1.4;

/**
 * Reactions a player can show. Most are keyframed in Blender on the game's rig
 * (tools/blender/build_reactions.py, files react_<name>.glb); dance and
 * blow_kiss are Mixamo clips.
 */
export const REACTIONS = ['wave', 'clap', 'cheer', 'shrug', 'laugh', 'dance', 'blow_kiss'] as const;
export type Reaction = (typeof REACTIONS)[number];
/** Reactions plus the ones the body does by itself: a yawn when tired (Mixamo clip). */
export type Gesture = Reaction | 'yawn';
const GESTURES: readonly Gesture[] = [...REACTIONS, 'yawn'];
const REACTION_FILES: Record<Gesture, string> = {
  wave: 'react_wave',
  clap: 'react_clap',
  cheer: 'react_cheer',
  shrug: 'react_shrug',
  laugh: 'react_laugh',
  dance: 'dance',
  blow_kiss: 'blow_kiss',
  yawn: 'yawn',
};
/** How long a reaction takes to blend in from what the body was doing, and back out. */
const REACTION_FADE = 0.25;

/** Clips that are a Mixamo file in assets/converted. The others are built from these. */
type FileClip = Exclude<AnimationName, 'lounge'>;
const POSES: readonly Pose[] = ['sit', 'lounge', 'sleep'];

/** How far one walk or run cycle carries the body, in metres. Sets the playback speed. */
const CYCLE_DISTANCE = { walk: 1.2, run: 2.4 } as const;
const FADE_SECONDS = 0.2;
const JUMP_FADE_SECONDS = 0.08;
/**
 * The part of Mixamo's "Jumping" clip that is used: push-off, in the air and
 * landing, as frames at 24 fps. It lasts 0.75 s, about as long as a jump.
 */
const JUMP_FRAMES = { start: 18, end: 36, fps: 24 };
/** How fast the upper body leans back on to a lounger and comes up again, as a share per second. */
const RECLINE_RATE = 4;
/** How fast a hand moves on to and off a reach target, as a share per second. */
const REACH_RATE = 9;
/** Where the elbow points while a hand reaches: down, back and a little out. X is mirrored for the right arm. */
const ELBOW = new THREE.Vector3(0.45, -1, -0.5);

/*
 * Swimming is posed in code on top of the idle animation: the body tips
 * forward around the chest, the head lifts, the hands follow a path and the
 * legs kick. Heights are above the feet with the body upright.
 */
const SWIM = {
  /** The height of the point the body tips around. */
  pivot: 0.72,
  /** How far forward the body tips for a stroke, in radians. */
  lean: 1.2,
  /** How far the head tips back so the face stays out of the water. */
  headUp: 0.95,
  /** How much higher the chest rides when lying forward. */
  rise: 0.1,
  strokeSeconds: 1.5,
  treadSeconds: 2.2,
  kick: 0.32,
  /** How fast the body goes into and out of the swimming pose, as a share per second. */
  rate: 3.5,
  /** The height of the shoulders, which the hands are placed from. */
  shoulder: 0.8,
};

/**
 * Where the mouth is painted on each body, below the middle of the head as a
 * share of half the head's height. Measured on the textures in Blender.
 */
const MOUTH: Record<Gender, number> = { female: -0.6, male: -0.7 };

const isFinger = (track: THREE.KeyframeTrack) => /Hand(Thumb|Index|Middle|Ring|Pinky)/.test(track.name);
const isHipsPosition = (track: THREE.KeyframeTrack) => /Hips\.position$/.test(track.name);
const isKnee = (track: THREE.KeyframeTrack) => /(Left|Right)Leg\.quaternion$/.test(track.name);

const assetUrls = import.meta.glob('../../../../assets/converted/*.glb', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function assetUrl(name: string): string {
  const key = Object.keys(assetUrls).find((path) => path.endsWith(`/${name}.glb`));
  const url = key ? assetUrls[key] : undefined;
  if (!url) throw new Error(`Missing asset: ${name}.glb (run tools/convert-mixamo.sh)`);
  return url;
}

const loader = new GLTFLoader();

const reactionCache = new Map<Gesture, Promise<THREE.AnimationClip>>();
function loadReaction(name: Gesture): Promise<THREE.AnimationClip> {
  let clip = reactionCache.get(name);
  if (!clip) {
    clip = Promise.all([loader.loadAsync(assetUrl(REACTION_FILES[name])), loadClip('idle')]).then(([gltf, idle]) => {
      const found = gltf.animations[0];
      if (!found) throw new Error(`${REACTION_FILES[name]}.glb has no animation`);
      found.name = name;
      // The female rig has no finger bones.
      found.tracks = found.tracks.filter((track) => !isFinger(track));
      if (REACTION_FILES[name].startsWith('react_')) fromBlender(found, idle);
      return found;
    });
    reactionCache.set(name, clip);
  }
  return clip;
}

/**
 * Blender exports the hips where they rest in the skin's bind pose, not at
 * standing height as the Mixamo clips have them. The rotations are fine as
 * they are; the hips are put at the idle clip's standing height plus the
 * clip's own movement (a hop). Other position and scale tracks only repeat
 * the rest pose and are dropped.
 */
function fromBlender(clip: THREE.AnimationClip, idle: THREE.AnimationClip): void {
  const standing = idle.tracks.find(isHipsPosition);
  clip.tracks = clip.tracks.filter((track) => {
    if (track.name.endsWith('.quaternion')) return true;
    if (!isHipsPosition(track) || !standing) return false;
    const values = track.values;
    const first = [values[0]!, values[1]!, values[2]!];
    for (let i = 0; i < values.length; i += 1) {
      values[i] = standing.values[i % 3]! + (values[i]! - first[i % 3]!);
    }
    return true;
  });
}

const clipCache = new Map<string, Promise<THREE.AnimationClip>>();
/**
 * One skin texture per body for everybody: each character has its own copy of
 * the body, but a 2048 × 2048 texture is about 20 MB on the graphics card, so
 * sixteen copies would not fit on a laptop.
 */
const skinTextures = new Map<Gender, THREE.Texture>();
let headphones: Promise<THREE.Object3D> | null = null;
let accessories: Promise<THREE.Object3D> | null = null;

/** The hats and glasses from tools/blender/build_accessories.py, loaded once and copied for each body. */
async function loadAccessories(): Promise<THREE.Object3D> {
  accessories ??= loader.loadAsync(assetUrl('gear_accessories')).then((gltf) => gltf.scene);
  return (await accessories).clone();
}

/** The headphones from tools/blender/build_gear.py, loaded once and copied for each body. */
async function loadHeadphones(): Promise<THREE.Object3D> {
  headphones ??= loader.loadAsync(assetUrl('gear_headphones')).then((gltf) => gltf.scene);
  return (await headphones).clone();
}

/**
 * Animation clips are shared by every character. They target bones by name,
 * so one clip drives both the male and the female body.
 */
function loadClip(name: AnimationName): Promise<THREE.AnimationClip> {
  let clip = clipCache.get(name);
  if (!clip) {
    clip = name === 'jump' ? loadJumpClip() : name === 'lounge' ? loadLoungeClip() : loadRawClip(name);
    clipCache.set(name, clip);
  }
  return clip;
}

async function loadRawClip(name: FileClip): Promise<THREE.AnimationClip> {
  const found = (await loader.loadAsync(assetUrl(name))).animations[0];
  if (!found) throw new Error(`${name}.glb has no animation`);
  found.name = name;
  // The female rig has no finger bones, so finger tracks would only log warnings.
  if ((POSES as readonly string[]).includes(name)) found.tracks = found.tracks.filter((track) => !isFinger(track));
  return found;
}

/**
 * The jump clip moves the hips down and forward (it is a hop off a ledge).
 * The physics already moves the body, so the hips are pinned where the idle
 * clip holds them and only the pose is kept.
 */
async function loadJumpClip(): Promise<THREE.AnimationClip> {
  const [raw, idle] = await Promise.all([loadRawClip('jump'), loadClip('idle')]);
  const clip = THREE.AnimationUtils.subclip(raw, 'jump', JUMP_FRAMES.start, JUMP_FRAMES.end, JUMP_FRAMES.fps);
  const standing = idle.tracks.find(isHipsPosition);
  if (!standing) throw new Error('idle.glb has no hips position track');
  clip.tracks = clip.tracks.filter((track) => !isHipsPosition(track) && !isFinger(track));
  clip.tracks.push(new THREE.VectorKeyframeTrack(standing.name, [0], Array.from(standing.values.slice(0, 3))));
  clip.resetDuration();
  return clip;
}

/**
 * Sitting with the legs out: the sit clip with the knees held as straight as
 * they are when standing. The characters' legs are too short to hang over the
 * edge of a sofa, so this is how they sit on one.
 */
async function loadLoungeClip(): Promise<THREE.AnimationClip> {
  const [sit, idle] = await Promise.all([loadClip('sit'), loadClip('idle')]);
  const clip = sit.clone();
  clip.name = 'lounge';
  clip.tracks = clip.tracks.map((track) => {
    const straight = isKnee(track) ? idle.tracks.find((other) => other.name === track.name) : undefined;
    return straight
      ? new THREE.QuaternionKeyframeTrack(track.name, [0], Array.from(straight.values.slice(0, 4)))
      : track;
  });
  return clip;
}

interface Arm {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  hand: THREE.Object3D;
  /** Where the hand should be, relative to the feet and in the body's own axes. */
  target: THREE.Vector3;
  wanted: boolean;
  /** 0 leaves the arm to the animation, 1 puts the hand on the target. */
  weight: number;
}

// Scratch values for the arm solver.
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();
const T = new THREE.Vector3();
const U = new THREE.Vector3();
const V = new THREE.Vector3();
const AXIS = new THREE.Vector3();
const TURN = new THREE.Quaternion();
const PARENT = new THREE.Quaternion();
const UPPER_BEFORE = new THREE.Quaternion();
const LOWER_BEFORE = new THREE.Quaternion();
const UPPER_AFTER = new THREE.Quaternion();
const LOWER_AFTER = new THREE.Quaternion();

/** Turns a bone by a rotation given in world axes. */
function turnInWorld(bone: THREE.Object3D, turn: THREE.Quaternion): void {
  bone.parent!.getWorldQuaternion(PARENT);
  bone.quaternion.premultiply(PARENT).premultiply(turn).premultiply(PARENT.invert());
}

const safeAcos = (value: number) => Math.acos(THREE.MathUtils.clamp(value, -1, 1));

/** An animated character body. */
export class Avatar {
  /** Add this to the scene. The feet are at its origin. */
  readonly root = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<AnimationName, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private readonly reactions = new Map<Gesture, THREE.AnimationAction>();
  /** The reaction playing now, over the faded-out current animation. */
  private reacting: THREE.AnimationAction | null = null;
  private readonly hips: THREE.Object3D;
  private readonly head: THREE.Object3D;
  private readonly arms: Record<Side, Arm>;
  private readonly outfit: Outfit;
  /** Between the root and the model: it tips the whole body forward to swim. */
  private readonly lean = new THREE.Group();
  private readonly legs: Record<Side, THREE.Object3D>;
  private readonly spine: THREE.Object3D;
  /** How far the upper body leans back from the pose, in radians: wanted, and shown (it eases there). */
  private recline = 0;
  private reclined = 0;
  private swim: Swim | null = null;
  /** 0 on land, 1 in the swimming pose; and the same for lying forward. */
  private afloat = 0;
  private forward = 0;
  private swimPhase = 0;

  private constructor(
    readonly gender: Gender,
    private readonly model: THREE.Object3D,
    headphones: THREE.Object3D,
    accessories: THREE.Object3D,
  ) {
    this.root.add(this.lean);
    this.lean.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    this.outfit = new Outfit(model, PLAYER_HEIGHT, MOUTH[gender], headphones, accessories);
    const bone = (pattern: RegExp): THREE.Object3D => {
      const matches: THREE.Object3D[] = [];
      model.traverse((object) => {
        if (object instanceof THREE.Bone && pattern.test(object.name)) matches.push(object);
      });
      const found = matches[0];
      if (!found) throw new Error(`body_${gender}.glb has no bone matching ${pattern}`);
      return found;
    };
    const arm = (side: 'Left' | 'Right'): Arm => ({
      upper: bone(new RegExp(`${side}Arm$`)),
      lower: bone(new RegExp(`${side}ForeArm$`)),
      hand: bone(new RegExp(`${side}Hand$`)),
      target: new THREE.Vector3(),
      wanted: false,
      weight: 0,
    });
    this.hips = bone(/Hips$/);
    this.head = bone(/Head$/);
    this.arms = { left: arm('Left'), right: arm('Right') };
    this.legs = { left: bone(/LeftUpLeg$/), right: bone(/RightUpLeg$/) };
    this.spine = bone(/Spine$/);
  }

  /** Leans the upper body back from the waist by `angle` radians, for lying back on a sun lounger. */
  setRecline(angle: number): void {
    this.recline = angle;
  }

  /** Puts the body in the water, treading or swimming a stroke; null takes it out. */
  setSwim(swim: Swim | null): void {
    this.swim = swim;
  }

  /** Where the hips are in the current pose, relative to the feet origin and in the body's own axes. */
  hipsOffset(target: THREE.Vector3): THREE.Vector3 {
    return this.root.worldToLocal(this.hips.getWorldPosition(target));
  }

  /** The same for the head: the point where it joins the neck. */
  headOffset(target: THREE.Vector3): THREE.Vector3 {
    return this.root.worldToLocal(this.head.getWorldPosition(target));
  }

  /** The same for the point half way between the shoulders. */
  chestOffset(target: THREE.Vector3): THREE.Vector3 {
    this.arms.left.upper.getWorldPosition(target);
    target.add(this.arms.right.upper.getWorldPosition(V)).multiplyScalar(0.5);
    return this.root.worldToLocal(target);
  }

  /** Dresses the body: skin, hair and clothes. The config's gender is not looked at. */
  wear(config: AvatarConfig): void {
    this.outfit.apply(config);
  }

  /** Takes the clothes off for a bath, or puts them back on. */
  bare(on: boolean): void {
    this.outfit.setBare(on);
  }

  /** Tape over the mouth while muted, headphones while deafened. */
  showVoice(signs: VoiceSigns): void {
    this.outfit.showSigns(signs);
  }

  /** The same for a wrist. */
  handOffset(side: Side, target: THREE.Vector3): THREE.Vector3 {
    return this.root.worldToLocal(this.arms[side].hand.getWorldPosition(target));
  }

  /**
   * Asks a hand to be at a point relative to the feet, in the body's own axes
   * (X is the body's left, Z its front), whatever the animation does with the
   * arm. Null gives the arm back to the animation.
   */
  reach(side: Side, point: THREE.Vector3 | null): void {
    const arm = this.arms[side];
    arm.wanted = point !== null;
    if (point) arm.target.copy(point);
  }

  static async load(gender: Gender): Promise<Avatar> {
    const [gltf, headphones, accessories, ...clips] = await Promise.all([
      loader.loadAsync(assetUrl(`body_${gender}`)),
      loadHeadphones(),
      loadAccessories(),
      loadClip('idle'),
      loadClip('walk'),
      loadClip('run'),
      loadClip('jump'),
      ...POSES.map(loadClip),
    ]);
    const reactionClips = await Promise.all(GESTURES.map(loadReaction));
    const model = gltf.scene;
    model.traverse((object) => {
      const material = (object as THREE.Mesh).isMesh ? ((object as THREE.Mesh).material as THREE.MeshStandardMaterial) : null;
      if (!material?.map) return;
      const shared = skinTextures.get(gender);
      if (shared) {
        material.map.dispose();
        material.map = shared;
      } else skinTextures.set(gender, material.map);
    });

    // A bone-driven mesh moves outside its bind-pose bounds, so never cull it.
    model.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) object.frustumCulled = false;
    });

    // Scale to the player height, measured in bind pose. The position is left
    // alone on purpose: Mixamo's clips place the hips at standing height above
    // y = 0, so the animation itself puts the feet on the ground. Re-centring
    // the bind pose here would lift the body by the same amount a second time.
    model.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    model.scale.setScalar(PLAYER_HEIGHT / size.y);

    const avatar = new Avatar(gender, model, headphones as THREE.Object3D, accessories as THREE.Object3D);
    for (const clip of clips) {
      const action = avatar.mixer.clipAction(clip);
      if (clip.name === 'jump') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      avatar.actions.set(clip.name as AnimationName, action);
    }
    for (const clip of reactionClips) {
      const action = avatar.mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      avatar.reactions.set(clip.name as Gesture, action);
    }
    avatar.mixer.addEventListener('finished', (event) => {
      if (event.action === avatar.reacting) avatar.endReaction(REACTION_FADE);
    });
    avatar.play('idle', 0);
    return avatar;
  }

  /**
   * Blends to an animation. `speed` is the movement speed in m/s that sets the
   * step rate. `fade` is the blend time; 0 switches at once.
   */
  play(name: AnimationName, speed: number, fade = name === 'jump' ? JUMP_FADE_SECONDS : FADE_SECONDS): void {
    const next = this.actions.get(name);
    if (!next) return;
    // Standing still keeps a reaction going; anything else stops it.
    if (this.reacting) {
      if (name === 'idle' && next === this.current) return;
      this.endReaction(fade, false);
    }
    next.timeScale = name === 'walk' || name === 'run' ? speed / CYCLE_DISTANCE[name] : 1;
    if (next === this.current) return;

    next.reset().play();
    if (this.current) {
      if (fade > 0) next.crossFadeFrom(this.current, fade, false);
      else this.current.stop();
    }
    this.current = next;
  }

  /** Plays a reaction once over standing still, then goes back to what the body was doing. */
  react(name: Gesture): void {
    const action = this.reactions.get(name);
    if (!action || !this.current) return;
    if (this.reacting && this.reacting !== action) this.reacting.fadeOut(REACTION_FADE);
    else if (!this.reacting) this.current.fadeOut(REACTION_FADE);
    action.reset().fadeIn(REACTION_FADE).play();
    this.reacting = action;
  }

  get reaction(): Gesture | null {
    if (!this.reacting) return null;
    for (const [name, action] of this.reactions) if (action === this.reacting) return name;
    return null;
  }

  /** Fades the reaction out; `back` fades the animation under it back in. */
  private endReaction(fade: number, back = true): void {
    const action = this.reacting;
    if (!action) return;
    this.reacting = null;
    action.fadeOut(fade);
    if (back && this.current) this.current.enabled = true;
    if (back) this.current?.fadeIn(fade);
  }

  update(dt: number): void {
    this.mixer.update(dt);
    this.poseSwim(dt);
    this.poseRecline(dt);
    const step = Math.min(1, REACH_RATE * dt);
    for (const side of ['left', 'right'] as const) {
      const arm = this.arms[side];
      arm.weight = THREE.MathUtils.clamp(arm.weight + (arm.wanted ? step : -step), 0, 1);
      if (arm.weight > 0) this.solveArm(arm, side === 'left' ? 1 : -1);
    }
  }

  /**
   * Turns the spine back about the body's left–right axis, after the clip has
   * posed it, so the back lies along a raised backrest while the legs stay out.
   */
  private poseRecline(dt: number): void {
    this.reclined += (this.recline - this.reclined) * Math.min(1, RECLINE_RATE * dt);
    if (Math.abs(this.reclined) < 1e-3) return;
    const parent = this.spine.parent;
    if (!parent) return;
    this.root.updateWorldMatrix(true, true);
    AXIS.set(1, 0, 0).transformDirection(this.root.matrixWorld);
    AXIS.applyQuaternion(parent.getWorldQuaternion(PARENT).invert());
    // Turning about the body's left (+X) tips the top forward, so lying back is the other way.
    TURN.setFromAxisAngle(AXIS, -this.reclined);
    this.spine.quaternion.premultiply(TURN);
  }

  /** Tips the body, lifts the head, moves the hands and kicks the legs for swimming. */
  private poseSwim(dt: number): void {
    const ease = Math.min(1, SWIM.rate * dt);
    this.afloat += ((this.swim ? 1 : 0) - this.afloat) * ease;
    this.forward += ((this.swim === 'stroke' ? 1 : 0) - this.forward) * ease;
    if (!this.swim && this.afloat < 0.01) {
      if (this.afloat === 0) return;
      this.afloat = 0;
      this.forward = 0;
    }

    this.swimPhase += (dt * 2 * Math.PI) / THREE.MathUtils.lerp(SWIM.treadSeconds, SWIM.strokeSeconds, this.forward);
    const phase = this.swimPhase;
    const bob = 0.025 * Math.sin(phase) * this.afloat;
    this.lean.position.set(0, SWIM.pivot + SWIM.rise * this.forward + bob, 0);
    this.lean.rotation.x = SWIM.lean * this.forward;
    this.model.position.y = -SWIM.pivot;
    if (this.afloat === 0) return;
    this.lean.updateMatrix();
    this.root.updateWorldMatrix(true, true);

    // The body's own left-to-right axis, in the world. Turning forward around it is a positive angle.
    const across = AXIS.set(1, 0, 0).transformDirection(this.root.matrixWorld).clone();
    turnInWorld(this.head, TURN.setFromAxisAngle(across, -SWIM.headUp * this.forward));
    const kick = Math.sin(phase * 2) * SWIM.kick * this.afloat;
    turnInWorld(this.legs.left, TURN.setFromAxisAngle(across, kick));
    turnInWorld(this.legs.right, TURN.setFromAxisAngle(across, -kick));

    // Treading: the hands scull out to the sides. A stroke: they reach ahead, sweep out and come back under the chest.
    const sweep = Math.max(0, Math.sin(phase));
    for (const side of ['left', 'right'] as const) {
      const out = side === 'left' ? 1 : -1;
      const arm = this.arms[side];
      const tread = U.set(out * (0.36 + 0.05 * Math.cos(phase)), SWIM.shoulder - 0.1, 0.12 + 0.07 * Math.sin(phase));
      // Along the body the hands go up past the head; with the body tipped forward that is ahead.
      const stroke = V.set(
        out * (0.07 + 0.3 * sweep),
        SWIM.shoulder + 0.14 + 0.13 * Math.cos(phase) - SWIM.pivot,
        0.08 + 0.06 * Math.max(0, -Math.sin(phase)),
      ).applyMatrix4(this.lean.matrix);
      arm.target.lerpVectors(tread, stroke, this.forward);
      arm.wanted = this.swim !== null;
    }
  }

  /**
   * Bends the shoulder and elbow so the wrist lands on the arm's target: the
   * elbow angle sets how far the hand is from the shoulder, then the whole arm
   * swings to point at the target and rolls so the elbow hangs down.
   */
  private solveArm(arm: Arm, mirror: number): void {
    const { upper, lower, hand } = arm;
    UPPER_BEFORE.copy(upper.quaternion);
    LOWER_BEFORE.copy(lower.quaternion);

    const a = upper.getWorldPosition(A);
    const b = lower.getWorldPosition(B);
    const c = hand.getWorldPosition(C);
    const t = this.root.localToWorld(T.copy(arm.target));
    const upperLength = a.distanceTo(b);
    const lowerLength = b.distanceTo(c);
    const reach = THREE.MathUtils.clamp(a.distanceTo(t), 0.02, (upperLength + lowerLength) * 0.999);

    // 1. Open or close the elbow, in the plane the arm is already bent in.
    const toHand = U.subVectors(c, a);
    const toElbow = V.subVectors(b, a);
    AXIS.crossVectors(toHand, toElbow);
    if (AXIS.lengthSq() < 1e-10) AXIS.set(1, 0, 0).transformDirection(this.root.matrixWorld);
    AXIS.normalize();
    const shoulderNow = toHand.angleTo(toElbow);
    const elbowNow = V.subVectors(a, b).angleTo(U.subVectors(c, b));
    const shoulderWanted = safeAcos(
      (lowerLength ** 2 - upperLength ** 2 - reach ** 2) / (-2 * upperLength * reach),
    );
    const elbowWanted = safeAcos(
      (reach ** 2 - upperLength ** 2 - lowerLength ** 2) / (-2 * upperLength * lowerLength),
    );
    turnInWorld(upper, TURN.setFromAxisAngle(AXIS, shoulderWanted - shoulderNow));
    turnInWorld(lower, TURN.setFromAxisAngle(AXIS, elbowWanted - elbowNow));

    // 2. Swing the arm so the wrist is on the line to the target.
    hand.getWorldPosition(c);
    const aim = V.subVectors(t, a).normalize();
    turnInWorld(upper, TURN.setFromUnitVectors(U.subVectors(c, a).normalize(), aim));

    // 3. Roll the arm around that line so the elbow points the natural way.
    lower.getWorldPosition(b);
    const elbow = U.subVectors(b, a).addScaledVector(aim, -U.dot(aim));
    const wanted = AXIS.set(ELBOW.x * mirror, ELBOW.y, ELBOW.z).transformDirection(this.root.matrixWorld);
    wanted.addScaledVector(aim, -wanted.dot(aim));
    if (elbow.lengthSq() > 1e-8 && wanted.lengthSq() > 1e-8) {
      const roll = Math.atan2(aim.dot(C.crossVectors(elbow, wanted)), elbow.dot(wanted));
      turnInWorld(upper, TURN.setFromAxisAngle(aim, roll));
    }

    if (arm.weight < 1) {
      UPPER_AFTER.copy(upper.quaternion);
      LOWER_AFTER.copy(lower.quaternion);
      upper.quaternion.slerpQuaternions(UPPER_BEFORE, UPPER_AFTER, arm.weight);
      lower.quaternion.slerpQuaternions(LOWER_BEFORE, LOWER_AFTER, arm.weight);
    }
  }
}
