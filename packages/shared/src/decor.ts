/**
 * Decorating: which pieces of furniture can be moved, and where a piece may
 * stand. The client uses these rules to show whether a spot is allowed; the
 * server will use the same rules to accept or refuse a move.
 */
import { FURNITURE_MODELS, furnitureFootprint, type Furniture, type FurnitureModelId } from './furniture.js';
import { DOORS, HOUSE_BOUNDS, WALLS, WALL_HEIGHT, WALL_THICKNESS, WINDOWS } from './house.js';
import { buildWallBoxes } from './walls.js';

/**
 * How a model is placed. `floor` pieces stand on the floor, `top` pieces are
 * small things that stand on the floor or on a table, `wall` pieces hang on a
 * wall, and `fixed` pieces are plumbed or wired in and stay where they are.
 */
export type Mount = 'floor' | 'top' | 'wall' | 'fixed';

export const MOUNTS: Record<FurnitureModelId, Mount> = {
  prop_stove: 'fixed',
  prop_fridge: 'fixed',
  prop_counter: 'fixed',
  prop_counter_sink: 'fixed',
  prop_toilet: 'fixed',
  prop_bathtub: 'fixed',
  prop_vanity: 'fixed',
  prop_pendant: 'fixed',
  // The backyard furniture stays on the terrace: decorating only works inside the house for now.
  prop_lounger: 'fixed',
  prop_patio_set: 'fixed',

  prop_bed: 'floor',
  prop_sofa: 'floor',
  prop_armchair: 'floor',
  prop_coffee_table: 'floor',
  prop_chair: 'floor',
  prop_broom: 'floor',
  prop_mop: 'floor',
  prop_nightstand: 'floor',
  prop_wardrobe: 'floor',
  prop_desk: 'floor',
  prop_bookshelf: 'floor',
  prop_rug: 'floor',
  prop_rug_round: 'floor',
  prop_plant: 'floor',
  prop_floor_lamp: 'floor',
  prop_tv: 'floor',
  prop_dining_table: 'floor',
  prop_trash_bin: 'floor',
  prop_bath_mat: 'floor',
  prop_basket: 'floor',
  prop_shoe_rack: 'floor',
  prop_coat_rack: 'floor',
  prop_doormat: 'floor',

  prop_cake: 'top',
  prop_table_lamp: 'top',
  prop_teddy: 'top',
  prop_vase: 'top',
  shoes_sneakers: 'top',

  prop_picture: 'wall',
  prop_clock: 'wall',
  prop_mirror: 'wall',
  prop_wall_shelf: 'wall',
};

/** Models with a flat top that small things can stand on, and how high that top is. */
export const SURFACES: Partial<Record<FurnitureModelId, number>> = {
  prop_coffee_table: 0.45,
  prop_nightstand: 0.637,
  prop_desk: 0.875,
  prop_dining_table: 0.775,
  prop_counter: 1,
  prop_bed: 0.675,
  prop_shoe_rack: 0.625,
  prop_bookshelf: 2,
};

/** Where a piece stands: the same four numbers a `Furniture` has. */
export interface Placement {
  x: number;
  z: number;
  yaw: number;
  elevation: number;
}

/**
 * Why a piece cannot stand somewhere: it is fixed, it would be outside the
 * house, in a wall, in a doorway, on top of something else, or (for a wall
 * piece) not on a free stretch of wall.
 */
export type PlacementProblem = 'fixed' | 'outside' | 'wall' | 'doorway' | 'blocked' | 'no-wall';

/** A rectangle on the floor plan. */
export interface FloorRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Pieces may touch, and numbers saved with two decimals may overlap by a hair. */
const SLACK = 0.01;
/** Solid furniture keeps this far from a doorway on both sides of the wall. */
const DOORWAY_CLEARANCE = 0.5;
/** Wall pieces hang between these heights: clear of the skirting, and just under the ceiling. */
export const LOWEST_ON_WALL = 0.3;
export const HIGHEST_ON_WALL = WALL_HEIGHT - 0.05;
/** A wall piece counts as on the wall when its back is this close to it. */
const WALL_SNAP = 0.02;

const rectOfBox = (box: { x: number; z: number; sx: number; sz: number }): FloorRect => ({
  minX: box.x - box.sx / 2,
  maxX: box.x + box.sx / 2,
  minZ: box.z - box.sz / 2,
  maxZ: box.z + box.sz / 2,
});

const overlaps = (a: FloorRect, b: FloorRect, slack = SLACK) =>
  a.minX < b.maxX - slack && a.maxX > b.minX + slack && a.minZ < b.maxZ - slack && a.maxZ > b.minZ + slack;

const holds = (rect: FloorRect, x: number, z: number) => x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;

/** The parts of the walls that stand on the floor (not the bits above the doors), on the floor plan. */
export const STANDING_WALLS: readonly FloorRect[] = buildWallBoxes(WALLS, DOORS)
  .filter((box) => box.y - box.sy / 2 < SLACK)
  .map(rectOfBox);

const DOORWAYS: readonly FloorRect[] = DOORS.map((door) => {
  const across = WALL_THICKNESS / 2 + DOORWAY_CLEARANCE;
  const along = door.width / 2;
  return door.along === 'x'
    ? { minX: door.x - along, maxX: door.x + along, minZ: door.z - across, maxZ: door.z + across }
    : { minX: door.x - across, maxX: door.x + across, minZ: door.z - along, maxZ: door.z + along };
});

export const mountOf = (piece: Furniture): Mount => MOUNTS[piece.model];
export const isMovable = (piece: Furniture): boolean => mountOf(piece) !== 'fixed';

/**
 * Where a piece put away in storage is kept: far outside the house, so every
 * rule that looks at the furniture around a place (walking into it, sitting,
 * reaching, room for another piece) leaves it alone without asking.
 */
export const STORAGE = { x: 500, z: 500 } as const;
export const isStored = (piece: { x: number; z: number }): boolean => piece.x === STORAGE.x && piece.z === STORAGE.z;
/** The broom and mop are the house's only cleaning tools, and the cake belongs to the birthday. */
const NEVER_STORED: readonly FurnitureModelId[] = ['prop_broom', 'prop_mop', 'prop_cake'];
export const canStore = (piece: Furniture): boolean => isMovable(piece) && !NEVER_STORED.includes(piece.model);

/** The height a small thing would stand at here: on the highest table top under it, or on the floor. */
export function restingHeight(x: number, z: number, pieces: readonly Furniture[]): number {
  let height = 0;
  for (const piece of pieces) {
    const top = SURFACES[piece.model];
    if (top === undefined || !holds(furnitureFootprint(piece), x, z)) continue;
    height = Math.max(height, piece.elevation + top);
  }
  return height;
}

/** The small things standing on a piece. They move with it. */
export function ridersOf(piece: Furniture, pieces: readonly Furniture[]): Furniture[] {
  const top = SURFACES[piece.model];
  if (top === undefined) return [];
  const footprint = furnitureFootprint(piece);
  return pieces.filter(
    (other) =>
      other.id !== piece.id &&
      mountOf(other) === 'top' &&
      Math.abs(other.elevation - (piece.elevation + top)) < 0.05 &&
      holds(footprint, other.x, other.z),
  );
}

/** Where a rider ends up when the piece under it goes from one place to another. */
export function carried(rider: Placement, from: Placement, to: Placement): Placement {
  const turn = to.yaw - from.yaw;
  const sin = Math.sin(turn);
  const cos = Math.cos(turn);
  const dx = rider.x - from.x;
  const dz = rider.z - from.z;
  return {
    x: to.x + dx * cos + dz * sin,
    z: to.z - dx * sin + dz * cos,
    yaw: rider.yaw + turn,
    elevation: rider.elevation + (to.elevation - from.elevation),
  };
}

/** The way a piece's front points, as a step of one along X or Z. */
function facing(yaw: number): { x: number; z: number } {
  return { x: Math.round(Math.sin(yaw)), z: Math.round(Math.cos(yaw)) };
}

/** Where a wall piece is on its wall: the wall's line, and the stretch and heights it covers. */
function wallSpan(piece: Furniture) {
  const model = FURNITURE_MODELS[piece.model];
  const front = facing(piece.yaw);
  const alongX = front.x === 0;
  const centre = alongX ? piece.x : piece.z;
  return {
    front,
    alongX,
    /** The plane of the wall face behind the piece. */
    face: alongX ? piece.z - (front.z * model.depth) / 2 : piece.x - (front.x * model.depth) / 2,
    from: centre - model.width / 2,
    to: centre + model.width / 2,
    bottom: piece.elevation,
    top: piece.elevation + model.height,
  };
}

function problemOnWall(moved: Furniture, others: readonly Furniture[]): PlacementProblem | null {
  const span = wallSpan(moved);
  if (span.bottom < LOWEST_ON_WALL - SLACK || span.top > HIGHEST_ON_WALL + SLACK) return 'no-wall';

  // The back of the piece must lie on the face of one stretch of wall, and all of it.
  const wall = STANDING_WALLS.find((rect) => {
    const face = span.alongX ? (span.front.z > 0 ? rect.maxZ : rect.minZ) : span.front.x > 0 ? rect.maxX : rect.minX;
    const from = span.alongX ? rect.minX : rect.minZ;
    const to = span.alongX ? rect.maxX : rect.maxZ;
    return Math.abs(face - span.face) <= WALL_SNAP && span.from >= from - SLACK && span.to <= to + SLACK;
  });
  if (!wall) return 'no-wall';

  // It must not stick into another wall at a corner.
  const footprint = furnitureFootprint(moved);
  if (STANDING_WALLS.some((rect) => rect !== wall && overlaps(footprint, rect))) return 'wall';

  const onWindow = WINDOWS.some((opening) => {
    if ((opening.along === 'x') !== span.alongX) return false;
    const line = span.alongX ? opening.z : opening.x;
    if (Math.abs(line - span.face) > WALL_THICKNESS) return false;
    const centre = span.alongX ? opening.x : opening.z;
    return (
      span.from < centre + opening.width / 2 &&
      span.to > centre - opening.width / 2 &&
      span.bottom < opening.top &&
      span.top > opening.sill
    );
  });
  if (onWindow) return 'blocked';

  const taken = others.some((other) => {
    if (mountOf(other) !== 'wall') return false;
    const there = wallSpan(other);
    return (
      there.alongX === span.alongX &&
      there.front.x === span.front.x &&
      there.front.z === span.front.z &&
      Math.abs(there.face - span.face) <= WALL_SNAP * 2 &&
      there.from < span.to - SLACK &&
      there.to > span.from + SLACK &&
      there.bottom < span.top - SLACK &&
      there.top > span.bottom + SLACK
    );
  });
  return taken ? 'blocked' : null;
}

/**
 * Says what is wrong with putting a piece somewhere, or null when it may
 * stand there. `pieces` is everything in the house; the piece itself is
 * left out of the comparison, and so is `ignore` (the things standing on it).
 */
export function checkPlacement(
  piece: Furniture,
  at: Placement,
  pieces: readonly Furniture[],
  ignore: readonly Furniture[] = [],
): PlacementProblem | null {
  const mount = mountOf(piece);
  if (mount === 'fixed') return 'fixed';
  const moved: Furniture = { ...piece, ...at };
  const others = pieces.filter((other) => other.id !== piece.id && !ignore.includes(other));
  if (mount === 'wall') return problemOnWall(moved, others);

  const footprint = furnitureFootprint(moved);
  const inside =
    footprint.minX >= HOUSE_BOUNDS.minX &&
    footprint.maxX <= HOUSE_BOUNDS.maxX &&
    footprint.minZ >= HOUSE_BOUNDS.minZ &&
    footprint.maxZ <= HOUSE_BOUNDS.maxZ;
  if (!inside) return 'outside';
  if (STANDING_WALLS.some((rect) => overlaps(footprint, rect))) return 'wall';

  const solidOnFloor = (other: Furniture) => {
    const kind = mountOf(other);
    return (kind === 'floor' || kind === 'fixed') && FURNITURE_MODELS[other.model].solid && other.elevation < SLACK;
  };

  if (mount === 'top') {
    if (Math.abs(at.elevation - restingHeight(at.x, at.z, others)) > SLACK) return 'blocked';
    // On the floor it must not be inside a cupboard or under a sofa.
    if (at.elevation < SLACK && others.some((other) => solidOnFloor(other) && holds(furnitureFootprint(other), at.x, at.z))) {
      return 'blocked';
    }
    return null;
  }

  if (Math.abs(at.elevation) > SLACK) return 'blocked';
  if (!FURNITURE_MODELS[piece.model].solid) return null;
  if (DOORWAYS.some((rect) => overlaps(footprint, rect))) return 'doorway';
  for (const other of others) {
    if (solidOnFloor(other) && overlaps(footprint, furnitureFootprint(other))) return 'blocked';
    // A small thing left on the floor would end up inside the piece.
    if (mountOf(other) === 'top' && other.elevation < SLACK && holds(footprint, other.x, other.z)) return 'blocked';
  }
  return null;
}

/** What is stored for a moved piece. Angles are kept as quarter turns, like in the furniture file. */
export interface SavedPlacement {
  x: number;
  z: number;
  turns: number;
  y: number;
}

/** Moved pieces by id. Pieces that stand where the house was built with them are left out. */
export type SavedLayout = Record<string, SavedPlacement>;

const round = (value: number) => Math.round(value * 1000) / 1000;
const quarterTurns = (yaw: number) => ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;

/** The pieces that are not where `base` has them, in the form that is stored. */
export function savedLayout(base: readonly Furniture[], pieces: readonly Furniture[]): SavedLayout {
  const saved: SavedLayout = {};
  for (const piece of pieces) {
    const home = base.find((other) => other.id === piece.id);
    if (!home) continue;
    const same =
      round(home.x) === round(piece.x) &&
      round(home.z) === round(piece.z) &&
      round(home.elevation) === round(piece.elevation) &&
      quarterTurns(home.yaw) === quarterTurns(piece.yaw);
    if (!same) saved[piece.id] = { x: round(piece.x), z: round(piece.z), turns: quarterTurns(piece.yaw), y: round(piece.elevation) };
  }
  return saved;
}

/**
 * A fresh copy of the furniture with a stored layout applied. Anything in the
 * stored layout that is not a sensible move of a movable piece is skipped.
 */
export function layoutWith(base: readonly Furniture[], saved: unknown): Furniture[] {
  const entries = (typeof saved === 'object' && saved !== null ? saved : {}) as Record<string, unknown>;
  return base.map((home) => {
    const piece = { ...home };
    const entry = entries[home.id] as Partial<SavedPlacement> | null | undefined;
    if (!entry || typeof entry !== 'object' || !isMovable(home)) return piece;
    const { x, z, turns, y } = entry;
    const numbers = [x, z, turns, y].every((value) => typeof value === 'number' && Number.isFinite(value));
    if (!numbers) return piece;
    if (isStored({ x: x!, z: z! })) return { ...piece, x: STORAGE.x, z: STORAGE.z, elevation: 0 };
    const sensible =
      x! >= HOUSE_BOUNDS.minX && x! <= HOUSE_BOUNDS.maxX && z! >= HOUSE_BOUNDS.minZ && z! <= HOUSE_BOUNDS.maxZ && y! >= 0 && y! <= WALL_HEIGHT;
    if (!sensible) return piece;
    return { ...piece, x: x!, z: z!, yaw: (quarterTurns((turns! * Math.PI) / 2) * Math.PI) / 2, elevation: y! };
  });
}
