/**
 * Daily life in the house for the local player: energy and hunger, resting on
 * furniture, cooking, eating, sweeping and the water slide. The numbers come
 * from the shared rules; this file decides when they apply. What everyone
 * shares (the litter, the cake, everyone's stats) belongs to the server: this
 * file reports what the player did through `HouseActions` and is brought in
 * line with the server's copy.
 */
import * as THREE from 'three';
import {
  FULL_STATS,
  FURNITURE_MODELS,
  SLIDE,
  SLIDE_LENGTH,
  SWEEP_REACH,
  SWEEP_SECONDS,
  USES,
  USE_REACH,
  VOICE_OPEN,
  ZONES,
  dishHunger,
  distanceToPiece,
  eat,
  furnitureFootprint,
  isEdible,
  isTool,
  pieceToWorld,
  setPrivate,
  slideAt,
  speedFactor,
  tickStats,
  toolFor,
  toggleDeafen,
  toggleMute,
  wallBetween,
  zoneAt,
  type Activity,
  type Carried,
  type Furniture,
  type Tool,
  type LitterKind,
  type Recipe,
  type Spot,
  type Stats,
  type Use,
  type Voice,
} from '@nongs/shared';
import type { AnimationName, Avatar } from '../player/avatar';
import type { Player } from '../player/player';

/** How far the hip joint sits above the surface a body rests on. */
const HIP_LIFT = 0.08;
/** Metres added to a thing's distance for each radian it is away from where the camera points. */
const OFF_AIM_PENALTY = 0.5;
/** The camera looks at least this high, so it starts above the furniture the body is on. */
const MIN_FOCUS_HEIGHT = 1.3;
const EYE_HEIGHT = 1.22;
/** How far from a worktop's edge the body stands to work at it, and how far in the work lies. */
const STAND_OFF = 0.17;
const WORK_DEPTH = 0.2;
const EAT_SECONDS = 2.6;
/** At a wardrobe: how far in front of it the body stands, how fast it turns, and how the camera frames it. */
const DRESSING_STAND_OFF = 0.7;
const DRESSING_TURN_SPEED = 2.5;
const DRESSING_CAMERA = { distance: 2.2, height: 0.72 };

/** The slide: how close to the ladder E works, how far from the ladder the body climbs, and the speeds. */
const LADDER_REACH = 0.9;
const LADDER_GAP = 0.3;
const CLIMB_SPEED = 0.9;
/** Sliding starts at this speed (m/s), gains speed downhill and is capped. */
const SLIDE_START_SPEED = 1.2;
const SLIDE_GRAVITY = 9.81;
const SLIDE_FRICTION = 0.12;
const SLIDE_MAX_SPEED = 6.5;
/** How far past the end of the chute the rider lands in the water. */
const SLIDE_LAUNCH = 0.9;

/** What a player can be doing on the slide. */
/** How far in front of the feet the broom's brush sweeps. */
const BRUSH_FRONT = 0.45;

/** A piece of litter on the floor. `swept` runs from 0 to 1 while the broom works on it. */
export interface Litter {
  id: string;
  kind: LitterKind;
  x: number;
  z: number;
  yaw: number;
  swept: number;
}

export interface Riding {
  phase: 'climb' | 'top' | 'slide';
  /** Height of the feet on the ladder. */
  height: number;
  /** Climbing speed this frame, for the stepping animation: up is positive. */
  climbing: number;
  /** Metres down the chute, and the speed. */
  distance: number;
  speed: number;
}

/** What the E key would do right now. `run` is null when the line only informs. */
export interface Offer {
  label: string;
  run: (() => void) | null;
  /** What the Q key does instead of acting on what is in hand, when the offer has a second action. */
  alt?: () => void;
}

/** The player's own pictures in the frames on the walls. The game only asks for them to be changed. */
export interface PictureFrames {
  has(id: string): boolean;
  choose(id: string): void;
  clear(id: string): void;
}

/** The cooking minigame, as the game sees it (see cooking.ts). */
/** What the player did that everyone in the house shares; the server is told. */
export interface HouseActions {
  swept(id: string): void;
  slice(): void;
  ate(food: 'meal' | 'cake', recipe?: string, rating?: number): void;
}

/** The birthday as the server has it: whose it is, and the cake. */
export interface CakeState {
  /** Names of the players whose birthday it is, or '' when it is nobody's. */
  birthday: string;
  /** True when this player is one of them. */
  mine: boolean;
  slices: number;
  candlesLit: boolean;
}

export interface KitchenLink {
  readonly active: boolean;
  readonly prompt: string;
  begin(recipe: Recipe, counter: Furniture, stove: Furniture | null, x: number, z: number): void;
  quit(): void;
}

export interface Controls {
  /** E was pressed this frame. */
  use: boolean;
  /** Q was pressed this frame. */
  alt: boolean;
  /** F is held. */
  sweep: boolean;
  /** A movement or jump key is held. */
  wantsToMove: boolean;
  /** Forward and back keys as a number from -1 to 1, to climb a ladder. */
  forward: number;
  /** Left and right keys as a number from -1 to 1, to turn in front of the wardrobe. */
  turn: number;
  /** The mute key or the deafen key was pressed this frame. */
  mute: boolean;
  deafen: boolean;
}

interface Resting {
  piece: Furniture;
  spot: Spot;
  kind: 'sit' | 'sleep' | 'bathe';
  facing: number;
}

/** A short action with the hands that holds the player in place. */
export type ActionKind = 'eat';

/** A place at a worktop where the player stands to work. */
export interface Station {
  /** Where the feet are, and the way the body faces. */
  x: number;
  z: number;
  facing: number;
  /** The point on the worktop in front of the body. */
  top: THREE.Vector3;
}

/** Standing in front of a wardrobe to change the character's look. */
export interface Dressing {
  x: number;
  z: number;
  /** The way the body faces; the player can turn it to look at all sides. */
  facing: number;
  /** The camera angle that shows the body from the front. */
  cameraYaw: number;
}

/** A finished dish in the player's hands. */
export interface Meal {
  recipe: Recipe;
  rating: 1 | 2 | 3;
}

/** What a piece is called in a prompt: "coffee table", "rug". */
export const pieceName = (piece: Furniture) => piece.model.replace(/^prop_/, '').replace(/_/g, ' ');

/** The place to stand at a piece, straight in front of a point near it. */
export function stationAt(piece: Furniture, x: number, z: number): Station {
  const box = furnitureFootprint(piece);
  const nearX = THREE.MathUtils.clamp(x, box.minX, box.maxX);
  const nearZ = THREE.MathUtils.clamp(z, box.minZ, box.maxZ);
  let towardX = nearX - x;
  let towardZ = nearZ - z;
  const distance = Math.hypot(towardX, towardZ);
  if (distance < 1e-3) {
    // Standing inside the footprint: work towards the back of the piece.
    towardX = -Math.sin(piece.yaw);
    towardZ = -Math.cos(piece.yaw);
  } else {
    towardX /= distance;
    towardZ /= distance;
  }
  return {
    x: nearX - towardX * STAND_OFF,
    z: nearZ - towardZ * STAND_OFF,
    facing: Math.atan2(towardX, towardZ),
    top: new THREE.Vector3(
      nearX + towardX * WORK_DEPTH,
      piece.elevation + FURNITURE_MODELS[piece.model].height,
      nearZ + towardZ * WORK_DEPTH,
    ),
  };
}

export class Game {
  stats: Stats = { ...FULL_STATS };
  carried: Carried | null = null;
  /** The recipe the ingredients in hand are for. */
  recipe: Recipe | null = null;
  /** The dish in hand when `carried` is a meal. */
  meal: Meal | null = null;
  /** True while the fridge's recipe list is open. */
  choosing = false;
  /** The litter on each room's floor, by zone id. */
  readonly litter = new Map<string, Litter[]>();
  resting: Resting | null = null;
  /** Set while the player works at a counter or the stove. */
  station: Station | null = null;
  /** Set while the player changes their look at a wardrobe. */
  dressing: Dressing | null = null;
  /** Set while the player is on the water slide. */
  riding: Riding | null = null;
  /** Goes up by one each time someone lands in the pool off the slide. */
  splashes = 0;
  sweeping = false;
  /** What E would do, for the prompt. */
  offer: Offer | null = null;
  /** The microphone and sound switches. A bath closes both. */
  voice: Voice = VOICE_OPEN;
  /** Tells the player something that happened, in the prompt line. */
  onNotice: (message: string) => void = () => {};

  private readonly usable: readonly { piece: Furniture; use: Use }[];

  /** The last piece the player tried to clean with the wrong tool, so the notice is not repeated. */
  private wrongToolFor: Litter | null = null;
  /** The birthday cake, as the server last said. */
  cake: CakeState = { birthday: '', mine: false, slices: 0, candlesLit: false };
  private busy: { kind: ActionKind; seconds: number; total: number; done?: () => void } | null = null;
  private readonly here = new THREE.Vector3();
  private readonly hips = new THREE.Vector3();
  private readonly head = new THREE.Vector3();

  /** @param pieces The furniture as it stands now. Pieces may move while the game runs. */
  constructor(
    private readonly pieces: readonly Furniture[],
    private readonly pictures: PictureFrames,
    private readonly kitchen: KitchenLink,
    private readonly house: HouseActions,
  ) {
    this.usable = pieces.flatMap((piece) => {
      const use = USES[piece.model];
      return use ? [{ piece, use }] : [];
    });
    for (const zone of ZONES) this.litter.set(zone.id, []);
  }

  /**
   * Brings the litter in line with the server's: new pieces appear, swept ones
   * go. How far the broom has got on a piece is kept.
   */
  syncLitter(pieces: Iterable<{ id: string; kind: string; zone: string; x: number; z: number; yaw: number }>): void {
    const before = new Map<string, Litter>();
    for (const list of this.litter.values()) for (const piece of list) before.set(piece.id, piece);
    for (const list of this.litter.values()) list.length = 0;
    for (const piece of pieces) {
      const list = this.litter.get(piece.zone);
      if (!list) continue;
      const kind = piece.kind as LitterKind;
      list.push({ id: piece.id, kind, x: piece.x, z: piece.z, yaw: piece.yaw, swept: before.get(piece.id)?.swept ?? 0 });
    }
  }

  get cooking(): boolean {
    return this.kitchen.active;
  }

  get canMove(): boolean {
    return !this.resting && !this.busy && !this.sweeping && !this.station && !this.dressing && !this.cooking && !this.riding && !this.choosing;
  }

  /** Furniture can be moved while the player is on their feet with empty hands. */
  get canDecorate(): boolean {
    return this.canMove && !this.carried;
  }

  get bathing(): boolean {
    return this.resting?.kind === 'bathe';
  }

  get speedScale(): number {
    return speedFactor(this.stats);
  }

  /** The animation that replaces walking and standing, if any. */
  get animation(): AnimationName | null {
    if (this.riding) return this.riding.phase === 'climb' ? (this.riding.climbing !== 0 ? 'walk' : 'idle') : 'lounge';
    if (!this.resting) return null;
    if (this.resting.kind === 'sleep') return 'sleep';
    return this.resting.spot.lounge ? 'lounge' : 'sit';
  }

  /** A pace for the animation when the body moves without walking: stepping up a ladder. */
  /** How far the body leans back while resting, in radians (on a sun lounger). */
  get recline(): number {
    return this.resting?.spot.recline ?? 0;
  }

  get animationSpeed(): number | null {
    return this.riding?.phase === 'climb' ? Math.abs(this.riding.climbing) * 1.6 : null;
  }

  /** The action in progress, and how far through it is (0 to 1). */
  get doing(): { kind: ActionKind; progress: number } | null {
    if (!this.busy) return null;
    return { kind: this.busy.kind, progress: THREE.MathUtils.clamp(1 - this.busy.seconds / this.busy.total, 0, 1) };
  }

  /** What the player holds and which keys act on it, for the HUD. */
  get carriedHint(): string | null {
    if (!this.carried || this.cooking) return null;
    switch (this.carried) {
      case 'broom':
        return 'Holding the broom · hold F by litter to sweep it up · Q to put it away';
      case 'mop':
        return 'Holding the mop · hold F on a spill to mop it up · Q to put it away';
      case 'ingredients':
        return `Holding the ingredients for ${this.recipe?.name ?? 'a meal'} · cook them at a counter · Q to put them back`;
      case 'meal': {
        const meal = this.meal;
        const rating = meal ? ` ${'★'.repeat(meal.rating)}` : '';
        return `Holding ${meal ? meal.recipe.name : 'a meal'}${rating} · Q to eat`;
      }
      case 'cake':
        return 'Holding a slice of cake · Q to eat';
    }
  }

  /** Takes the ingredients for a recipe out of the fridge. */
  takeIngredients(recipe: Recipe): void {
    this.carried = 'ingredients';
    this.recipe = recipe;
    this.choosing = false;
  }

  // ---- what the kitchen reports back ----
  /** Stands the body at a worktop for the next cooking step. */
  standAt(station: Station, player: Player): void {
    this.station = station;
    player.face(station.facing);
  }

  served(recipe: Recipe, rating: 1 | 2 | 3, player: Player): void {
    this.carried = 'meal';
    this.meal = { recipe, rating };
    this.recipe = null;
    this.leaveStation(player);
  }

  spoiled(player: Player): void {
    this.carried = null;
    this.recipe = null;
    this.leaveStation(player);
    this.onNotice('The meal burnt and went in the bin. Take fresh ingredients from the fridge to try again.');
  }

  stoppedCooking(player: Player): void {
    this.carried = null;
    this.recipe = null;
    this.leaveStation(player);
  }

  /** Runs one frame. Returns true if it used the E press. */
  update(dt: number, player: Player, controls: Controls): boolean {
    let usedKey = false;
    const here = player.standing(this.here);
    const zone = zoneAt(here.x, here.z);

    if (this.busy) {
      this.busy.seconds -= dt;
      if (this.busy.seconds <= 0) {
        const done = this.busy.done;
        this.busy = null;
        done?.();
      }
    }
    if (this.riding) this.ride(dt, player, controls.forward);

    this.offer = this.busy || this.choosing ? null : this.findOffer(here.x, here.z, player);
    if (this.dressing) this.dressing.facing -= controls.turn * DRESSING_TURN_SPEED * dt;
    else if (!this.busy && !this.cooking && !this.riding && controls.wantsToMove) {
      if (this.resting) this.getUp(player);
      this.leaveStation(player);
    }
    if (controls.use && this.offer?.run) {
      this.offer.run();
      usedKey = true;
    }
    if (controls.alt && this.offer?.alt) this.offer.alt();
    else if (controls.alt && !this.busy && !this.cooking && !this.riding && this.resting?.kind !== 'sleep') this.useCarried();

    if (controls.mute) this.voice = toggleMute(this.voice);
    if (controls.deafen) this.voice = toggleDeafen(this.voice);
    this.voice = setPrivate(this.voice, this.bathing);
    // Nothing left to work on: step back from the worktop.
    if (!this.busy && !this.cooking && !this.carried) this.leaveStation(player);

    const indoors = zone !== null && this.litter.has(zone.id);
    const tool = this.carried && isTool(this.carried) ? this.carried : null;
    this.sweeping = this.canSweep && tool !== null && controls.sweep && indoors;
    if (this.sweeping && zone && tool) this.sweep(zone.id, tool, here, player.heading, dt);
    this.stats = tickStats(this.stats, this.activity(player), dt);
    return usedKey;
  }

  /**
   * Litter within reach of the tool's head, in front of the feet, goes after a
   * moment's work, if it is the right tool for it: the broom leaves spills
   * alone and the mop leaves dry litter.
   */
  private sweep(zoneId: string, tool: Tool, feet: THREE.Vector3, heading: number, dt: number): void {
    const pieces = this.litter.get(zoneId);
    if (!pieces) return;
    const brushX = feet.x + Math.sin(heading) * BRUSH_FRONT;
    const brushZ = feet.z + Math.cos(heading) * BRUSH_FRONT;
    let wrong: Litter | null = null;
    for (let i = pieces.length - 1; i >= 0; i -= 1) {
      const piece = pieces[i]!;
      if (Math.hypot(piece.x - brushX, piece.z - brushZ) > SWEEP_REACH) continue;
      if (toolFor(piece.kind) !== tool) {
        wrong = piece;
        continue;
      }
      piece.swept += dt / SWEEP_SECONDS;
      if (piece.swept >= 1) {
        pieces.splice(i, 1);
        this.house.swept(piece.id);
      }
    }
    // Say so once per piece, not every frame.
    if (wrong && wrong !== this.wrongToolFor) {
      this.onNotice(tool === 'broom' ? 'A broom only spreads a spill around. Fetch the mop for it.' : 'The mop cannot pick that up. Sweep it with the broom.');
    }
    this.wrongToolFor = wrong ?? this.wrongToolFor;
  }

  private get canSweep(): boolean {
    return !this.resting && !this.busy && !this.station && !this.dressing && !this.riding && !this.cooking;
  }

  /** Climbing the ladder, waiting at the top, and going down the chute. */
  private ride(dt: number, player: Player, forward: number): void {
    const riding = this.riding!;
    if (riding.phase === 'climb') {
      riding.climbing = forward;
      riding.height = Math.min(SLIDE.tower.top, riding.height + forward * CLIMB_SPEED * dt);
      if (riding.height <= 0 && forward < 0) this.leaveSlide(player);
      else if (riding.height >= SLIDE.tower.top) riding.phase = 'top';
      return;
    }
    if (riding.phase === 'top') {
      if (forward < 0) Object.assign(riding, { phase: 'climb', height: SLIDE.tower.top - 0.05 });
      return;
    }
    // Downhill the rider speeds up; friction holds them back a little.
    const ahead = slideAt(riding.distance + 0.1);
    const now = slideAt(riding.distance);
    const slope = Math.max(0, (now.y - ahead.y) / 0.1);
    riding.speed = Math.min(SLIDE_MAX_SPEED, riding.speed + (SLIDE_GRAVITY * slope - SLIDE_FRICTION * riding.speed) * dt);
    riding.distance += riding.speed * dt;
    if (riding.distance >= SLIDE_LENGTH) {
      const end = slideAt(SLIDE_LENGTH);
      const launch = SLIDE_LAUNCH + riding.speed * 0.15;
      this.leaveSlide(player, end.x + Math.sin(end.facing) * launch, end.z + Math.cos(end.facing) * launch);
      player.face(end.facing);
      this.splashes += 1;
    }
  }

  /** Gets off the slide: at the foot of the ladder, or in the water at the bottom. */
  private leaveSlide(player: Player, x?: number, z?: number): void {
    this.riding = null;
    player.pinned = null;
    if (x !== undefined && z !== undefined) player.place(x, z);
  }

  /**
   * Places the body where its activity needs it: hips on the furniture while
   * resting, or up against the worktop while working. Call after the animation
   * has been updated, and before the player copies its position.
   */
  pin(player: Player, avatar: Avatar): void {
    const rest = this.resting;
    if (this.riding) {
      this.pinRiding(player, avatar, this.riding);
      return;
    }
    if (!rest && this.dressing) {
      const { x, z, facing } = this.dressing;
      const floor = player.standing(this.here).y;
      player.pinned = {
        position: new THREE.Vector3(x, floor, z),
        facing,
        eye: new THREE.Vector3(x, floor + EYE_HEIGHT, z),
        focus: new THREE.Vector3(x, floor + DRESSING_CAMERA.height, z),
        distance: DRESSING_CAMERA.distance,
      };
      return;
    }
    if (!rest) {
      const station = this.station;
      if (!station) return;
      const floor = player.standing(this.here).y;
      player.pinned = {
        position: new THREE.Vector3(station.x, floor, station.z),
        facing: station.facing,
        eye: new THREE.Vector3(station.x, floor + EYE_HEIGHT, station.z),
        focus: new THREE.Vector3(station.x, floor + EYE_HEIGHT, station.z),
      };
      return;
    }

    if (rest.kind === 'sleep') {
      // Turn the body so the head points at the head of the bed, whichever way the clip lies.
      const hips = avatar.hipsOffset(this.hips);
      const head = avatar.headOffset(this.head);
      const dx = head.x - hips.x;
      const dz = head.z - hips.z;
      if (Math.hypot(dx, dz) > 0.2) rest.facing = rest.piece.yaw + Math.PI - Math.atan2(dx, dz);
    }
    const at = pieceToWorld(rest.piece, rest.spot.side, rest.spot.front);
    this.seat(player, avatar, at.x, rest.piece.elevation + rest.spot.height, at.z, rest.facing);
  }

  /** Puts the hips at a point on a surface, the body turned to `facing`. */
  private seat(player: Player, avatar: Avatar, x: number, surface: number, z: number, facing: number): void {
    const hips = avatar.hipsOffset(this.hips);
    const head = avatar.headOffset(this.head);
    const sin = Math.sin(facing);
    const cos = Math.cos(facing);
    const turned = (v: THREE.Vector3) => ({ x: v.x * cos + v.z * sin, z: -v.x * sin + v.z * cos });
    const hipsTurned = turned(hips);
    const position = new THREE.Vector3(x - hipsTurned.x, surface + HIP_LIFT - hips.y, z - hipsTurned.z);
    const headTurned = turned(head);
    const eye = new THREE.Vector3(position.x + headTurned.x, position.y + head.y, position.z + headTurned.z);
    const focus = eye.clone().setY(Math.max(eye.y, MIN_FOCUS_HEIGHT));
    player.pinned = { position, facing, eye, focus };
  }

  private pinRiding(player: Player, avatar: Avatar, riding: Riding): void {
    if (riding.phase === 'climb') {
      const { x, z } = SLIDE.ladder;
      const feet = new THREE.Vector3(x, riding.height, z + LADDER_GAP);
      const eye = feet.clone().setY(feet.y + EYE_HEIGHT);
      player.pinned = { position: feet, facing: Math.PI, eye, focus: eye.clone() };
      return;
    }
    const at = slideAt(riding.phase === 'top' ? 0 : riding.distance);
    this.seat(player, avatar, at.x, at.y, at.z, at.facing);
  }

  private activity(player: Player): Activity {
    if (this.resting) return this.resting.kind === 'sleep' ? 'sleeping' : 'sitting';
    if (this.sweeping || this.riding) return 'walking';
    if (player.locomotion === 'run') return 'running';
    return player.locomotion === 'idle' ? 'idle' : 'walking';
  }

  /** Steps away from the wardrobe. */
  stopDressing(player: Player): void {
    if (!this.dressing) return;
    player.face(this.dressing.cameraYaw);
    this.dressing = null;
    if (!this.resting) player.pinned = null;
  }

  private getUp(player: Player): void {
    this.resting = null;
    player.pinned = null;
  }

  private leaveStation(player: Player): void {
    if (!this.station) return;
    this.station = null;
    if (!this.resting) player.pinned = null;
  }

  private act(kind: ActionKind, seconds: number, done?: () => void): void {
    this.busy = { kind, seconds, total: seconds, done };
  }

  /** Q: eat what is in hand, or put it away. */
  private useCarried(): void {
    const carried = this.carried;
    if (!carried) return;
    if (!isTool(carried) && isEdible(carried)) {
      const meal = this.meal;
      this.act('eat', EAT_SECONDS, () => {
        this.stats = carried === 'meal' && meal ? eat(this.stats, 'meal', dishHunger(meal.recipe, meal.rating)) : eat(this.stats, carried);
        if (carried === 'meal' && meal) this.house.ate('meal', meal.recipe.id, meal.rating);
        else if (carried === 'cake') this.house.ate('cake');
        this.carried = null;
        this.meal = null;
      });
      return;
    }
    this.carried = null;
    this.recipe = null;
  }

  private findOffer(x: number, z: number, player: Player): Offer | null {
    if (this.cooking) return { label: this.kitchen.prompt, run: null, alt: () => this.kitchen.quit() };
    if (this.riding) return this.ridingOffer();
    if (this.resting) {
      const label = { sleep: 'E — wake up', sit: 'E — get up', bathe: 'E — get out of the bath · your microphone and sound are off in here' }[this.resting.kind];
      return { label, run: () => this.getUp(player) };
    }
    if (this.dressing) return { label: 'E — close the wardrobe', run: () => this.stopDressing(player) };
    if (!player.swimming) {
      const ladder = SLIDE.ladder;
      if (Math.hypot(x - ladder.x, z - (ladder.z + LADDER_GAP)) < LADDER_REACH) {
        if (this.carried) return { label: 'Put down what you are holding to climb the slide', run: null };
        return {
          label: 'E — climb the water slide',
          run: () => (this.riding = { phase: 'climb', height: 0, climbing: 0, distance: 0, speed: 0 }),
        };
      }
    }
    // Of the things in reach, take the one the player looks at: the nearest,
    // with a penalty for being off to the side of where the camera points.
    const lookX = -Math.sin(player.yaw);
    const lookZ = -Math.cos(player.yaw);
    let best: Offer | null = null;
    let bestScore = Infinity;
    for (const { piece, use } of this.usable) {
      const distance = distanceToPiece(piece, x, z);
      if (distance > USE_REACH) continue;
      const box = furnitureFootprint(piece);
      const toX = THREE.MathUtils.clamp(x, box.minX, box.maxX) - x;
      const toZ = THREE.MathUtils.clamp(z, box.minZ, box.maxZ) - z;
      // Nothing is in reach through a wall, like a picture hung on the other side of it.
      if (wallBetween(x, z, x + toX, z + toZ)) continue;
      const angle = distance < 1e-3 ? 0 : Math.acos(THREE.MathUtils.clamp((toX * lookX + toZ * lookZ) / distance, -1, 1));
      const score = distance + angle * OFF_AIM_PENALTY;
      if (score >= bestScore) continue;
      const offer = this.offerFor(piece, use, x, z, player);
      if (!offer) continue;
      best = offer;
      bestScore = score;
    }
    return best;
  }

  private ridingOffer(): Offer {
    const riding = this.riding!;
    if (riding.phase === 'climb') return { label: 'W — climb up · S — climb down', run: null };
    if (riding.phase === 'top') {
      return {
        label: 'E — slide down! · S — climb back down',
        run: () => Object.assign(riding, { phase: 'slide', distance: 0, speed: SLIDE_START_SPEED }),
      };
    }
    return { label: 'Wheee!', run: null };
  }

  /** The stove nearest to a piece, for the steps that need the heat. */
  private stoveNear(piece: Furniture): Furniture | null {
    let best: Furniture | null = null;
    let bestDistance = Infinity;
    for (const other of this.pieces) {
      if (other.model !== 'prop_stove') continue;
      const distance = Math.hypot(other.x - piece.x, other.z - piece.z);
      if (distance < bestDistance) {
        best = other;
        bestDistance = distance;
      }
    }
    return best;
  }

  private offerFor(piece: Furniture, use: Use, x: number, z: number, player: Player): Offer | null {
    const face = () => player.face(Math.atan2(piece.x - x, piece.z - z));
    const name = pieceName(piece);

    switch (use.kind) {
      case 'sleep':
      case 'sit': {
        const kind = use.kind;
        if (kind === 'sleep' && this.carried) return { label: 'Put down what you are holding to sleep', run: null };
        if (this.carried && isTool(this.carried)) return { label: `Put the ${this.carried} away to sit down`, run: null };
        const spot = nearestSpot(piece, use.spots ?? [], x, z);
        if (!spot) return null;
        return {
          label: kind === 'sleep' ? 'E — sleep' : use.spots?.some((each) => each.recline) ? `E — lie on the ${name}` : `E — sit on the ${name}`,
          run: () => {
            this.leaveStation(player);
            this.resting = { piece, spot, kind, facing: piece.yaw + (spot.turn ?? 0) };
          },
        };
      }
      case 'bathe': {
        if (this.carried) return { label: 'Put down what you are holding to take a bath', run: null };
        const spot = nearestSpot(piece, use.spots ?? [], x, z);
        if (!spot) return null;
        return {
          label: 'E — take a bath',
          run: () => {
            this.leaveStation(player);
            this.resting = { piece, spot, kind: 'bathe', facing: piece.yaw + (spot.turn ?? 0) };
          },
        };
      }
      case 'picture': {
        if (this.carried) return null;
        const own = this.pictures.has(piece.id);
        return {
          label: own ? 'E — change the picture · Q — take it down' : 'E — put your own picture in this frame',
          run: () => this.pictures.choose(piece.id),
          alt: own ? () => this.pictures.clear(piece.id) : undefined,
        };
      }
      case 'fridge':
        if (this.carried === 'ingredients') return { label: 'E — choose another recipe', run: () => (this.choosing = true) };
        if (this.carried) return null;
        return {
          label: 'E — open the fridge and pick a recipe',
          run: () => {
            face();
            this.choosing = true;
          },
        };
      case 'counter': {
        const recipe = this.recipe;
        if (this.carried !== 'ingredients' || !recipe) return null;
        const stove = this.stoveNear(piece);
        if (recipe.vessel !== 'bowl' && !stove) return { label: 'This kitchen has no stove', run: null };
        return {
          label: `E — cook ${recipe.name} here`,
          run: () => this.kitchen.begin(recipe, piece, recipe.vessel === 'bowl' ? null : stove, x, z),
        };
      }
      case 'stove':
        if (this.carried === 'ingredients') return { label: 'Start at the counter beside the stove: prepare the ingredients first', run: null };
        return null;
      case 'broom':
      case 'mop': {
        const tool = use.kind;
        if (this.carried) return null;
        return { label: `E — take the ${tool}`, run: () => (this.carried = tool) };
      }
      case 'cake': {
        const cake = this.cake;
        if (!cake.birthday || cake.slices <= 0) return null;
        if (cake.candlesLit) {
          return cake.mine
            ? { label: 'Make a wish! Blow into your microphone, or hold F, to blow out the candles', run: null }
            : { label: `Happy birthday, ${cake.birthday}! Wait for the candles to be blown out`, run: null };
        }
        if (this.carried) return null;
        const left = cake.slices === 1 ? 'the last slice' : `${cake.slices} slices left`;
        return {
          label: `E — take a slice of birthday cake · ${left}`,
          run: () => {
            this.carried = 'cake';
            cake.slices -= 1;
            this.house.slice();
            if (cake.slices === 0) this.onNotice('That was the last slice. Happy birthday!');
          },
        };
      }
      case 'wardrobe': {
        if (this.carried) return { label: 'Put down what you are holding to change clothes', run: null };
        return {
          label: 'E — change your look',
          run: () => {
            // Stand in front of the wardrobe with the back to it, so the camera sees the front.
            const depth = FURNITURE_MODELS[piece.model].depth;
            const at = pieceToWorld(piece, 0, depth / 2 + DRESSING_STAND_OFF);
            this.leaveStation(player);
            this.dressing = { x: at.x, z: at.z, facing: piece.yaw, cameraYaw: piece.yaw };
          },
        };
      }
    }
  }
}

function nearestSpot(piece: Furniture, spots: readonly Spot[], x: number, z: number): Spot | null {
  let best: Spot | null = null;
  let bestDistance = Infinity;
  for (const spot of spots) {
    const at = pieceToWorld(piece, spot.side, spot.front);
    const distance = Math.hypot(at.x - x, at.z - z);
    if (distance < bestDistance) {
      best = spot;
      bestDistance = distance;
    }
  }
  return best;
}
