/**
 * What the gameplay looks like in the scene: the thing in the player's hands
 * and what the hands do with it, the hands on the slide's ladder, splashes in
 * the pool and the litter on the floors. It only reads the game state. Cooking
 * draws itself (cooking.ts).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LITTER_KINDS, POOL, isTool, type Carried, type Food, type Furniture, type LitterKind, type Tool } from '@nongs/shared';
import type { Avatar } from '../player/avatar';
import type { Player } from '../player/player';
import type { FurnitureView } from '../world/furniture';
import type { Kit } from './cooking';
import type { Game } from './game';

/*
 * Points below are relative to the player's feet, in the body's own axes:
 * X is the body's left, Y is up, Z is its front. The arms are about 0.32 m
 * long, so everything a hand holds has to be close to the shoulders.
 */

/** Where carried food is held, from the point between the shoulders. */
const CARRY = new THREE.Vector3(0, -0.17, 0.19);
/** Half the distance between the hands under a plate. */
const GRIP = 0.1;
/** The mouth, from the point where the head joins the neck. */
const MOUTH = new THREE.Vector3(0, 0.07, 0.15);
const BITES = 3;
/** A finished dish is carried a little smaller than it is served, so it fits between the hands. */
const DISH_CARRY_SCALE = 0.75;

/** The broom carried upright at the right side: its foot, and the height of the hand on it. */
const BROOM_CARRY = new THREE.Vector3(-0.22, 0.03, 0.12);
const BROOM_CARRY_GRIP = 0.63;
/**
 * Sweeping: the brush swings left and right on the floor in front, and the
 * top of the handle stays beside the right ear, clear of the big head.
 */
const SWEEP_SECONDS = 1.1;
const SWEEP_REACH = 0.22;
const SWEEP_BRUSH = new THREE.Vector3(-0.04, 0.02, 0.42);
const SWEEP_TOP = new THREE.Vector3(-0.2, 1.19, 0.04);
/** Where the hands hold the handle, as a share of its length from the brush. */
const SWEEP_GRIP = { left: 0.62, right: 0.72 };

/** The ladder's rungs are this far apart, the first one this high; hands hold them this far apart. */
const RUNG = 0.3;
const HAND_SPREAD = 0.17;
/** How far in front of the climbing body the rungs are (the body climbs 0.3 m out from the ladder's foot). */
const RUNG_FRONT = 0.27;
/** On the chute the hands hold its rims, beside the hips. */
const RIM_HOLD = new THREE.Vector3(0.3, 0.32, 0.05);

const UP = new THREE.Vector3(0, 1, 0);
const QUARTER_TURN = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2);

const material = (color: number, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness });

function part(geometry: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material(color));
  mesh.position.set(x, y, z);
  return mesh;
}

function group(...parts: THREE.Object3D[]): THREE.Group {
  const result = new THREE.Group();
  if (parts.length > 0) result.add(...parts);
  return result;
}

const plate = () => part(new THREE.CylinderGeometry(0.115, 0.08, 0.016, 20), 0xfff8ee);

function buildFood(): Record<Food, THREE.Group> {
  const carrot = part(new THREE.ConeGeometry(0.02, 0.11, 10), 0xe8963a, 0.02, 0.07, 0.035);
  carrot.rotation.z = 1.1;
  const slice = new THREE.CylinderGeometry(0.1, 0.1, 0.07, 10, 1, false, 0, Math.PI / 3);
  const icing = new THREE.CylinderGeometry(0.102, 0.102, 0.014, 10, 1, false, 0, Math.PI / 3);

  return {
    ingredients: group(
      part(new THREE.CylinderGeometry(0.11, 0.07, 0.065, 20), 0xc99a6b, 0, 0.03),
      part(new THREE.SphereGeometry(0.04, 14, 10), 0xd9483b, -0.04, 0.075, -0.01),
      part(new THREE.SphereGeometry(0.045, 14, 10), 0x7fb069, 0.035, 0.07, -0.03),
      carrot,
    ),
    // The dish itself is put in when the meal is known.
    meal: group(),
    cake: group(plate(), part(slice, 0xfff1dc, -0.03, 0.045, -0.04), part(icing, 0xf3a6b8, -0.03, 0.085, -0.04)),
  };
}

const litterUrls = import.meta.glob('../../../../assets/converted/litter.glb', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** The litter models by kind. Each piece on the floor is a copy of one. */
export type LitterModels = ReadonlyMap<LitterKind, THREE.Object3D>;

export async function loadLitter(): Promise<LitterModels> {
  const url = Object.values(litterUrls)[0];
  if (!url) throw new Error('Missing asset: litter.glb (run tools/blender/build_litter.py in Blender)');
  const gltf = await new GLTFLoader().loadAsync(url);
  const models = new Map<LitterKind, THREE.Object3D>();
  for (const kind of LITTER_KINDS) {
    const model = gltf.scene.getObjectByName(`litter_${kind}`);
    if (!model) throw new Error(`litter.glb has no litter_${kind}`);
    model.position.set(0, 0, 0);
    models.set(kind, model);
  }
  return models;
}

/** Rings and drops on the water where someone lands off the slide. */
class Splash {
  private readonly ring: THREE.Mesh;
  private readonly drops: THREE.InstancedMesh;
  private readonly velocities: THREE.Vector3[] = [];
  private age = Infinity;
  private readonly transform = new THREE.Object3D();
  private readonly at = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }),
    );
    this.drops = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.035, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xe6f8ff, transparent: true, opacity: 0.85 }),
      28,
    );
    this.ring.visible = this.drops.visible = false;
    this.drops.frustumCulled = false;
    scene.add(this.ring, this.drops);
  }

  start(x: number, y: number, z: number): void {
    this.age = 0;
    this.at.set(x, y, z);
    this.velocities.length = 0;
    for (let i = 0; i < this.drops.count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const out = 0.6 + Math.random() * 1.4;
      this.velocities.push(new THREE.Vector3(Math.cos(angle) * out, 2.2 + Math.random() * 2, Math.sin(angle) * out));
    }
  }

  update(dt: number): void {
    this.age += dt;
    const live = this.age < 1.2;
    this.ring.visible = this.drops.visible = live;
    if (!live) return;
    const t = this.age / 1.2;
    this.ring.position.copy(this.at).setY(this.at.y + 0.01);
    this.ring.scale.setScalar(0.3 + 1.6 * t);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
    for (let i = 0; i < this.drops.count; i += 1) {
      const v = this.velocities[i]!;
      this.transform.position.set(
        this.at.x + v.x * this.age,
        Math.max(this.at.y, this.at.y + v.y * this.age - 4.9 * this.age * this.age),
        this.at.z + v.z * this.age,
      );
      this.transform.updateMatrix();
      this.drops.setMatrixAt(i, this.transform.matrix);
    }
    this.drops.instanceMatrix.needsUpdate = true;
  }
}

export class GameView {
  private readonly food: Record<Food, THREE.Group>;
  /** Holds the food. It is placed in the house, not on the body. */
  private readonly held = new THREE.Group();
  /** The litter on show, by piece id. */
  private readonly litter = new Map<string, THREE.Object3D>();
  private readonly litterGroup = new THREE.Group();
  /**
   * The broom and the mop: the object in the scene, and the piece of furniture
   * it goes back to when put away. They can be moved like the rest.
   */
  private readonly tools = new Map<Tool, { object: THREE.Object3D; home: Furniture }>();
  private readonly cake: THREE.Object3D | undefined;
  private readonly splash: Splash;
  private shownCarried: Carried | null = null;
  private shownDish: string | null = null;
  private sweepTime = 0;
  private splashes = 0;
  private splashWaiting = false;

  // Scratch values for sync().
  private readonly left = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly tray = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly along = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();

  constructor(
    scene: THREE.Scene,
    furniture: FurnitureView,
    pieces: readonly Furniture[],
    private readonly kit: Kit,
    private readonly litterModels: LitterModels,
  ) {
    for (const tool of ['broom', 'mop'] as const) {
      const object = furniture.objects.get(tool);
      const home = pieces.find((piece) => piece.id === tool);
      if (object && home) this.tools.set(tool, { object, home });
    }
    this.cake = furniture.objects.get('cake');
    this.food = buildFood();
    for (const item of Object.values(this.food)) {
      item.visible = false;
      this.held.add(item);
    }
    this.held.visible = false;
    scene.add(this.held);
    this.splash = new Splash(scene);
    scene.add(this.litterGroup);
  }

  /** Shows the dish the player made on the plate in their hands. */
  private showDish(name: string | null): void {
    if (name === this.shownDish) return;
    this.shownDish = name;
    const meal = this.food.meal;
    meal.clear();
    const model = name ? this.kit.get(name) : undefined;
    if (!model) {
      meal.add(plate());
      return;
    }
    const copy = model.clone();
    copy.scale.setScalar(DISH_CARRY_SCALE);
    meal.add(copy);
  }

  /**
   * Shows the current game state, and tells the body where its hands belong.
   * Call every frame, after the player has been placed.
   */
  sync(game: Game, player: Player, avatar: Avatar, dt: number): void {
    const root = player.root;
    root.updateMatrixWorld(true);
    const carried = game.carried;
    const asleep = game.resting?.kind === 'sleep';
    const doing = game.doing;
    let left: THREE.Vector3 | null = null;
    let right: THREE.Vector3 | null = null;

    if (carried !== this.shownCarried) {
      if (this.shownCarried && isTool(this.shownCarried)) this.putBack(this.shownCarried);
      this.shownCarried = carried;
    }
    if (game.meal) this.showDish(`kit_dish_${game.meal.recipe.id}`);

    // While cooking, the kitchen shows the food on the worktop instead.
    const food = carried && !isTool(carried) && !asleep && !game.cooking ? carried : null;
    if (this.cake) this.cake.visible = game.cake.birthday !== '' && game.cake.slices > 0;
    for (const [name, item] of Object.entries(this.food)) item.visible = name === food;
    this.held.visible = food !== null;

    if (food) {
      // Carried in both hands in front of the chest.
      const tray = avatar.chestOffset(this.tray).add(CARRY);
      root.localToWorld(this.held.position.copy(tray));
      this.held.rotation.y = root.rotation.y;
      left = this.left.set(tray.x + GRIP, tray.y - 0.015, tray.z);
      right = this.right.set(tray.x - GRIP, tray.y - 0.015, tray.z);
      if (doing?.kind === 'eat') {
        // One hand goes from the plate to the mouth and back for each bite.
        const bite = 0.5 - 0.5 * Math.cos(doing.progress * BITES * 2 * Math.PI);
        const mouth = avatar.headOffset(this.point).add(MOUTH);
        left.x = tray.x + 0.04;
        right.set(tray.x - 0.03, tray.y + 0.05, tray.z).lerp(mouth, bite);
      }
    }

    const riding = game.riding;
    if (riding?.phase === 'climb') {
      // Each hand holds a rung above the head; they take turns as the body climbs.
      const shoulder = avatar.chestOffset(this.tray).y;
      const reach = riding.height + shoulder + 0.25;
      const rung = (offset: number) => Math.max(RUNG, Math.floor((reach + offset) / RUNG) * RUNG) - riding.height;
      left = this.left.set(HAND_SPREAD, rung(0), RUNG_FRONT);
      right = this.right.set(-HAND_SPREAD, rung(RUNG / 2), RUNG_FRONT);
    } else if (riding) {
      const hips = avatar.hipsOffset(this.point);
      left = this.left.set(hips.x + RIM_HOLD.x, hips.y + RIM_HOLD.y - 0.32, hips.z + RIM_HOLD.z);
      right = this.right.set(hips.x - RIM_HOLD.x, hips.y + RIM_HOLD.y - 0.32, hips.z + RIM_HOLD.z);
    }

    // The broom and the mop are carried and swung the same way.
    const broom = carried && isTool(carried) ? this.tools.get(carried)?.object : undefined;
    if (broom) {
      if (game.sweeping) {
        this.sweepTime += dt;
        const swing = Math.sin((this.sweepTime / SWEEP_SECONDS) * 2 * Math.PI);
        const brush = this.point.copy(SWEEP_BRUSH).setX(SWEEP_BRUSH.x + SWEEP_REACH * swing);
        const along = this.along.copy(SWEEP_TOP).setX(SWEEP_TOP.x - 0.05 * swing).sub(brush);
        left = this.left.copy(brush).addScaledVector(along, SWEEP_GRIP.left);
        right = this.right.copy(brush).addScaledVector(along, SWEEP_GRIP.right);
        // Lean the handle along that line, with the wide side of the brush across the swing.
        this.turn.setFromUnitVectors(UP, along.normalize()).multiply(QUARTER_TURN);
        broom.quaternion.copy(root.quaternion).multiply(this.turn);
        root.localToWorld(broom.position.copy(brush));
      } else {
        this.sweepTime = 0;
        broom.quaternion.copy(root.quaternion);
        root.localToWorld(broom.position.copy(BROOM_CARRY));
        right = this.right.copy(BROOM_CARRY).setY(BROOM_CARRY.y + BROOM_CARRY_GRIP);
      }
    }

    avatar.reach('left', asleep ? null : left);
    avatar.reach('right', asleep ? null : right);

    // Off the slide, the splash comes when the body reaches the water.
    if (game.splashes !== this.splashes) {
      this.splashes = game.splashes;
      this.splashWaiting = true;
    }
    const feet = player.standing(this.point);
    if (this.splashWaiting && (feet.y <= POOL.water || player.swimming)) {
      this.splashWaiting = false;
      this.splash.start(feet.x, POOL.water, feet.z);
    }
    this.splash.update(dt);

    this.syncLitter(game);
  }

  /** Adds and removes litter to match the game; a piece being swept shrinks and slides away from the brush. */
  private syncLitter(game: Game): void {
    const present = new Set<string>();
    for (const pieces of game.litter.values()) {
      for (const piece of pieces) {
        present.add(piece.id);
        let shown = this.litter.get(piece.id);
        if (!shown) {
          shown = this.litterModels.get(piece.kind)!.clone();
          shown.rotation.y = piece.yaw;
          this.litter.set(piece.id, shown);
          this.litterGroup.add(shown);
        }
        const gone = Math.min(1, piece.swept);
        shown.scale.setScalar(1 - 0.7 * gone);
        shown.position.set(piece.x + Math.sin(piece.yaw) * 0.12 * gone, 0.004, piece.z + Math.cos(piece.yaw) * 0.12 * gone);
      }
    }
    for (const [id, shown] of this.litter) {
      if (present.has(id)) continue;
      this.litterGroup.remove(shown);
      this.litter.delete(id);
    }
  }

  private putBack(tool: Tool): void {
    const held = this.tools.get(tool);
    if (!held) return;
    held.object.position.set(held.home.x, held.home.elevation, held.home.z);
    held.object.rotation.set(0, held.home.yaw, 0);
  }
}
