/**
 * Decorate mode: the player looks at a piece of furniture, picks it up, aims
 * where it should go and puts it down. The shared rules say where a piece may
 * stand; this file turns where the camera points into a place to try.
 */
import * as THREE from 'three';
import { PROXY_LAYER } from '../world/batches';
import {
  DOORS,
  FURNITURE_MODELS,
  HOUSE_BOUNDS,
  HIGHEST_ON_WALL,
  LOWEST_ON_WALL,
  STANDING_WALLS,
  SURFACES,
  WALLS,
  buildWallBoxes,
  carried,
  checkPlacement,
  furnitureFootprint,
  mountOf,
  restingHeight,
  ridersOf,
  type Furniture,
  type Placement,
  type PlacementProblem,
  canStore,
  isStored,
  STORAGE,
} from '@nongs/shared';
import type { Player } from '../player/player';
import type { FurnitureView } from '../world/furniture';
import { pieceName } from './game';

/** How far from the player a piece can be picked up or put down. */
const REACH = 4.5;
/** Places snap to this grid, in metres. Small things use a finer one. */
const GRID = 0.05;
const FINE_GRID = 0.025;
/** A solid piece cannot be put down this close to where the player stands. */
const BODY_ROOM = 0.3;
const FREE = 0x4caf6a;
const WRONG = 0xd9483b;
const LOOKED_AT = 0xffffff;
/** The middle of the view, where the player aims. */
const CENTRE = new THREE.Vector2(0, 0);

const WHY_NOT: Record<PlacementProblem, string> = {
  fixed: 'That stays where it is',
  outside: 'It has to stay inside the house',
  wall: 'A wall is in the way',
  doorway: 'It would block a door',
  blocked: 'Something is in the way',
  'no-wall': 'Aim at a free bit of wall',
};

export interface DecorControls {
  /** E: pick up, or put down. */
  use: boolean;
  /** R: a quarter turn. */
  turn: boolean;
  /** Q: put the piece back where it was. */
  cancel: boolean;
  /** X: put the piece in hand away in storage. */
  store: boolean;
  /** C: take the next piece out of storage. */
  takeOut: boolean;
}

interface Held {
  piece: Furniture;
  home: Placement;
  /** The small things standing on the piece. They move with it. */
  riders: { piece: Furniture; home: Placement }[];
  at: Placement;
}

const placementOf = (piece: Furniture): Placement => ({ x: piece.x, z: piece.z, yaw: piece.yaw, elevation: piece.elevation });
/** A length as a whole number of millimetres, so stored places stay tidy. */
const millimetres = (value: number) => Math.round(value * 1000) / 1000;

/** The nearest point of a grid. */
const snap = (value: number, grid: number) => millimetres(Math.round(value / grid) * grid);

/** The walls that stand on the floor, as boxes to aim at. */
const WALL_BOXES = buildWallBoxes(WALLS, DOORS)
  .filter((box) => box.y - box.sy / 2 < 0.01)
  .map((box) => new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(box.x, box.y, box.z), new THREE.Vector3(box.sx, box.sy, box.sz)));

export class Decorator {
  active = false;
  /** What the prompt line should say. */
  prompt = '';

  private held: Held | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly outline: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  private readonly fill: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private readonly roots: THREE.Object3D[] = [];
  private readonly byRoot = new Map<THREE.Object3D, Furniture>();
  private readonly surfaceHeights: number[];
  private readonly feet = new THREE.Vector3();
  private readonly point = new THREE.Vector3();

  /**
   * @param pieces The furniture as it stands. Putting a piece down changes it here.
   * @param onChange Called with the piece just put down somewhere new (the things on it moved too).
   * @param onStore Called with a piece just put away in storage.
   */
  constructor(
    scene: THREE.Scene,
    private readonly pieces: Furniture[],
    private readonly furniture: FurnitureView,
    private readonly onChange: (piece: Furniture) => void,
    private readonly onStore: (piece: Furniture) => void,
  ) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: LOOKED_AT }));
    this.fill = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: LOOKED_AT, transparent: true, opacity: 0.14, depthWrite: false }));
    this.outline.visible = false;
    this.fill.visible = false;
    scene.add(this.outline, this.fill);

    for (const piece of pieces) {
      const root = furniture.objects.get(piece.id);
      if (!root) continue;
      this.roots.push(root);
      this.byRoot.set(root, piece);
    }
    // Table tops are tried from the highest down, so a vase lands on the table the player looks at.
    this.surfaceHeights = [...new Set(Object.values(SURFACES))].sort((a, b) => b - a);
    this.raycaster.far = 12;
    // The furniture meshes are stand-ins on their own layer (see world/batches.ts); the ray must still hit them.
    this.raycaster.layers.enable(PROXY_LAYER);
  }

  get holding(): boolean {
    return this.held !== null;
  }

  /** The ids of the piece in hand and the things standing on it, which the server must not move under the player. */
  get inHand(): string[] {
    const held = this.held;
    return held ? [held.piece.id, ...held.riders.map((rider) => rider.piece.id)] : [];
  }

  start(): void {
    this.active = true;
  }

  /** Leaves decorate mode. A piece still in hand goes back where it was. */
  stop(): void {
    if (this.held) this.putBack(this.held);
    this.active = false;
    this.outline.visible = false;
    this.fill.visible = false;
    this.prompt = '';
  }

  /** Runs one frame. Call after the camera has been placed. */
  update(camera: THREE.PerspectiveCamera, player: Player, controls: DecorControls): void {
    if (!this.active) return;
    camera.updateMatrixWorld();
    this.raycaster.setFromCamera(CENTRE, camera);
    const ray = this.raycaster.ray;
    player.standing(this.feet);

    const stored = this.pieces.filter(isStored);
    const held = this.held;
    if (!held) {
      const seen = this.lookedAt();
      const piece = seen && mountOf(seen) !== 'fixed' ? seen : null;
      if (piece) this.frame(piece, piece, LOOKED_AT);
      else this.outline.visible = this.fill.visible = false;
      if (piece) this.prompt = `E — move the ${pieceName(piece)}`;
      else this.prompt = seen ? `The ${pieceName(seen)} stays where it is` : 'Look at a piece of furniture to move it';
      if (stored.length > 0) this.prompt += ` · C — take something out of storage (${stored.length})`;
      if (controls.takeOut && stored[0]) this.pickUp(stored[0]);
      else if (piece && controls.use) this.pickUp(piece);
      return;
    }

    if (controls.takeOut && isStored(held.home)) {
      // Still on its way out of storage: it goes back, and the next stored piece comes out instead.
      const next = stored[(stored.indexOf(held.piece) + 1) % stored.length]!;
      this.putBack(held);
      if (next !== held.piece) this.pickUp(next);
      return;
    }
    if (controls.store && canStore(held.piece)) {
      if (held.riders.length > 0) {
        this.prompt = 'Take the things off it first';
        return;
      }
      this.putAway(held);
      return;
    }

    const mount = mountOf(held.piece);
    if (controls.turn && mount !== 'wall') held.at.yaw += Math.PI / 2;
    const aimed = this.aim(ray, held);
    if (aimed) held.at = aimed;
    let problem: PlacementProblem | null = aimed
      ? checkPlacement(held.piece, held.at, this.pieces, held.riders.map((rider) => rider.piece))
      : mount === 'wall'
        ? 'no-wall'
        : 'outside';
    if (!problem && this.onPlayer(held)) problem = 'blocked';

    this.furniture.show(held.piece, held.at);
    for (const rider of held.riders) this.furniture.show(rider.piece, carried(rider.home, held.home, held.at));
    this.frame(held.piece, held.at, problem ? WRONG : FREE);
    let keys = mount === 'wall' ? 'Q — put it back' : 'R — turn · Q — put it back';
    if (isStored(held.home)) keys += stored.length > 1 ? ' · C — something else' : '';
    else if (canStore(held.piece)) keys += ' · X — put it away';
    this.prompt = problem ? `${WHY_NOT[problem]} · ${keys}` : `E — put it here · ${keys}`;

    if (controls.cancel) this.putBack(held);
    else if (controls.use && !problem) this.putDown(held);
  }

  /** The piece in the middle of the view: the first one the eye meets, if no wall hides it. */
  private lookedAt(): Furniture | null {
    const wall = this.wallHit(this.raycaster.ray);
    for (const hit of this.raycaster.intersectObjects(this.roots, true)) {
      if (wall && hit.distance > wall.distance + 0.2) return null;
      if (Math.hypot(hit.point.x - this.feet.x, hit.point.z - this.feet.z) > REACH) return null;
      for (let object: THREE.Object3D | null = hit.object; object; object = object.parent) {
        const piece = this.byRoot.get(object);
        if (piece) return piece;
      }
    }
    return null;
  }

  private pickUp(piece: Furniture): void {
    const riders = ridersOf(piece, this.pieces).map((rider) => ({ piece: rider, home: placementOf(rider) }));
    this.held = { piece, home: placementOf(piece), riders, at: placementOf(piece) };
    this.furniture.setSolid(piece, false);
  }

  private putDown(held: Held): void {
    Object.assign(held.piece, held.at);
    for (const rider of held.riders) Object.assign(rider.piece, carried(rider.home, held.home, held.at));
    this.release(held);
    this.onChange(held.piece);
  }

  private putBack(held: Held): void {
    this.release(held);
  }

  private putAway(held: Held): void {
    Object.assign(held.piece, { x: STORAGE.x, z: STORAGE.z, elevation: 0 });
    this.release(held);
    this.onStore(held.piece);
  }

  private release(held: Held): void {
    this.furniture.place(held.piece);
    for (const rider of held.riders) this.furniture.place(rider.piece);
    this.furniture.setSolid(held.piece, true);
    this.held = null;
  }

  /** Where the piece in hand would go for where the camera points, or null when it points at nothing usable. */
  private aim(ray: THREE.Ray, held: Held): Placement | null {
    const piece = held.piece;
    const mount = mountOf(piece);
    const model = FURNITURE_MODELS[piece.model];

    if (mount === 'wall') {
      const hit = this.wallHit(ray);
      if (!hit || Math.hypot(hit.point.x - this.feet.x, hit.point.z - this.feet.z) > REACH) return null;
      const { point, normal } = hit;
      const elevation = THREE.MathUtils.clamp(
        snap(point.y - model.height / 2, GRID),
        LOWEST_ON_WALL,
        HIGHEST_ON_WALL - model.height,
      );
      // Flat against the wall face, at a snapped distance along it.
      const alongX = normal.z !== 0;
      return {
        x: alongX ? snap(point.x, GRID) : millimetres(point.x + (normal.x * model.depth) / 2),
        z: alongX ? millimetres(point.z + (normal.z * model.depth) / 2) : snap(point.z, GRID),
        yaw: Math.atan2(normal.x, normal.z),
        elevation,
      };
    }

    if (mount === 'top') {
      const others = this.pieces.filter((other) => other !== piece);
      for (const height of [...this.surfaceHeights, 0]) {
        const spot = this.onLevel(ray, height, FINE_GRID);
        if (!spot) continue;
        if (Math.abs(restingHeight(spot.x, spot.z, others) - height) < 0.01) return { ...spot, yaw: held.at.yaw, elevation: height };
      }
      return null;
    }

    const spot = this.onLevel(ray, 0, GRID);
    if (!spot) return null;
    const at: Placement = { ...spot, yaw: held.at.yaw, elevation: 0 };
    this.slideOffWalls(piece, at);
    return at;
  }

  /** Where the ray meets a level surface at some height, kept within reach of the player and inside the house. */
  private onLevel(ray: THREE.Ray, height: number, grid: number): { x: number; z: number } | null {
    const point = this.point;
    if (ray.direction.y > -0.03) {
      // Looking level or up: as far away as the player can reach.
      point.copy(ray.direction).setY(0);
      if (point.lengthSq() < 1e-6) return null;
      point.normalize().multiplyScalar(REACH).add(this.feet);
    } else {
      const distance = (height - ray.origin.y) / ray.direction.y;
      if (distance < 0) return null;
      ray.at(distance, point);
    }
    const dx = point.x - this.feet.x;
    const dz = point.z - this.feet.z;
    const away = Math.hypot(dx, dz);
    if (away > REACH) {
      point.x = this.feet.x + (dx / away) * REACH;
      point.z = this.feet.z + (dz / away) * REACH;
    }
    return {
      x: THREE.MathUtils.clamp(snap(point.x, grid), HOUSE_BOUNDS.minX, HOUSE_BOUNDS.maxX),
      z: THREE.MathUtils.clamp(snap(point.z, grid), HOUSE_BOUNDS.minZ, HOUSE_BOUNDS.maxZ),
    };
  }

  /** Moves a place out of any wall it overlaps, so furniture can be pushed up against a wall. */
  private slideOffWalls(piece: Furniture, at: Placement): void {
    for (let pass = 0; pass < 3; pass += 1) {
      const box = furnitureFootprint({ ...piece, ...at });
      let moved = false;
      for (const wall of STANDING_WALLS) {
        const left = box.maxX - wall.minX;
        const right = wall.maxX - box.minX;
        const back = box.maxZ - wall.minZ;
        const front = wall.maxZ - box.minZ;
        if (left <= 0 || right <= 0 || back <= 0 || front <= 0) continue;
        const least = Math.min(left, right, back, front);
        if (least === left) at.x = millimetres(at.x - left);
        else if (least === right) at.x = millimetres(at.x + right);
        else if (least === back) at.z = millimetres(at.z - back);
        else at.z = millimetres(at.z + front);
        moved = true;
        break;
      }
      if (!moved) return;
    }
  }

  /** The first wall face the ray meets from outside: the point, and which way the face looks. */
  private wallHit(ray: THREE.Ray): { point: THREE.Vector3; normal: { x: number; z: number }; distance: number } | null {
    let best: { point: THREE.Vector3; normal: { x: number; z: number }; distance: number } | null = null;
    const point = new THREE.Vector3();
    for (const box of WALL_BOXES) {
      if (box.containsPoint(ray.origin) || !ray.intersectBox(box, point)) continue;
      const distance = point.distanceTo(ray.origin);
      if (best && distance >= best.distance) continue;
      // The face that was hit is the one the point lies on.
      const edge = 1e-4;
      let normal: { x: number; z: number } | null = null;
      if (Math.abs(point.x - box.min.x) < edge) normal = { x: -1, z: 0 };
      else if (Math.abs(point.x - box.max.x) < edge) normal = { x: 1, z: 0 };
      else if (Math.abs(point.z - box.min.z) < edge) normal = { x: 0, z: -1 };
      else if (Math.abs(point.z - box.max.z) < edge) normal = { x: 0, z: 1 };
      if (normal) best = { point: point.clone(), normal, distance };
    }
    return best;
  }

  /** True if a solid piece would be put down on the player. */
  private onPlayer(held: Held): boolean {
    if (!FURNITURE_MODELS[held.piece.model].solid) return false;
    const box = furnitureFootprint({ ...held.piece, ...held.at });
    return (
      this.feet.x > box.minX - BODY_ROOM &&
      this.feet.x < box.maxX + BODY_ROOM &&
      this.feet.z > box.minZ - BODY_ROOM &&
      this.feet.z < box.maxZ + BODY_ROOM
    );
  }

  /** Draws a box around a piece at a place. */
  private frame(piece: Furniture, at: Placement, color: number): void {
    const model = FURNITURE_MODELS[piece.model];
    for (const shape of [this.outline, this.fill]) {
      shape.visible = true;
      shape.position.set(at.x, at.elevation + model.height / 2, at.z);
      shape.rotation.y = at.yaw;
      shape.scale.set(model.width + 0.04, model.height + 0.04, model.depth + 0.04);
      shape.material.color.setHex(color);
    }
  }
}
