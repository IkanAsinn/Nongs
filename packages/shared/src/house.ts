/**
 * The house layout. Units are metres, Y is up. The floor is the X/Z plane.
 * Client rendering, collision, and (later) server zone checks all read this.
 */

export const WALL_HEIGHT = 2.8;
export const WALL_THICKNESS = 0.15;
export const DOOR_HEIGHT = 2.1;
export const DOOR_WIDTH = 1.1;

/** A `room` is closed and has one door. An `open` area is shared space with no door. */
export type ZoneKind = 'room' | 'open';

/** A voice zone: one closed room, or an open area. Axis-aligned rectangle on the floor. */
export interface Zone {
  id: string;
  name: string;
  kind: ZoneKind;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Floor colour for the blockout. */
  color: number;
}

/** An axis-aligned wall line on the floor plan. */
export interface Wall {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/** A door in a wall. `along` is the axis its wall runs along. */
export interface Door {
  id: string;
  /** The room this door belongs to (the room that can lock it). */
  zoneId: string;
  x: number;
  z: number;
  along: 'x' | 'z';
  width: number;
  /** What the prompt calls this door. Defaults to the zone's name. */
  label?: string;
  /**
   * A sliding glass door has two panels, each half the width. The one on the
   * low side of `along` is fixed; the other slides over it, so only the high
   * half can be walked through. Left out, the door swings on a hinge.
   */
  kind?: 'slide';
}

/** How far a sliding door's panel moves when it opens. The panels overlap a little where they meet. */
export const slideTravel = (door: Door): number => door.width / 2 - 0.09;

const MIN_X = -14;
const MAX_X = 14;
const MIN_Z = -10;
const MAX_Z = 10;
/** The living room fills the centre strip, between these two lines. */
const WEST_X = -6;
const EAST_X = 6;

export const ZONES: readonly Zone[] = [
  // Centre and west: open shared space
  { id: 'living', name: 'Living Room', kind: 'open', minX: WEST_X, maxX: EAST_X, minZ: MIN_Z, maxZ: MAX_Z, color: 0xf6c9b8 },
  { id: 'entry', name: 'Entry', kind: 'open', minX: MIN_X, maxX: WEST_X, minZ: -2, maxZ: 2, color: 0xe9e2d5 },
  { id: 'kitchen', name: 'Kitchen', kind: 'open', minX: EAST_X, maxX: MAX_X, minZ: MIN_Z, maxZ: -1, color: 0xf7e3a6 },
  // Closed rooms: three corners and the east side
  { id: 'bedroom1', name: 'Bedroom 1', kind: 'room', minX: MIN_X, maxX: WEST_X, minZ: MIN_Z, maxZ: -2, color: 0xbcd9f2 },
  { id: 'bedroom2', name: 'Bedroom 2', kind: 'room', minX: MIN_X, maxX: WEST_X, minZ: 2, maxZ: MAX_Z, color: 0xd7c6f0 },
  { id: 'bedroom3', name: 'Bedroom 3', kind: 'room', minX: EAST_X, maxX: MAX_X, minZ: 3, maxZ: MAX_Z, color: 0xf3bfd6 },
  { id: 'bathroom', name: 'Bathroom', kind: 'room', minX: EAST_X, maxX: MAX_X, minZ: -1, maxZ: 3, color: 0xbfe3c8 },
];

export const WALLS: readonly Wall[] = [
  // Outer walls
  { x1: MIN_X, z1: MIN_Z, x2: MAX_X, z2: MIN_Z },
  { x1: MIN_X, z1: MAX_Z, x2: MAX_X, z2: MAX_Z },
  { x1: MIN_X, z1: MIN_Z, x2: MIN_X, z2: MAX_Z },
  { x1: MAX_X, z1: MIN_Z, x2: MAX_X, z2: MAX_Z },
  // Bedroom 1 (north-west corner)
  { x1: WEST_X, z1: MIN_Z, x2: WEST_X, z2: -2 },
  { x1: MIN_X, z1: -2, x2: WEST_X, z2: -2 },
  // Bedroom 2 (south-west corner)
  { x1: WEST_X, z1: 2, x2: WEST_X, z2: MAX_Z },
  { x1: MIN_X, z1: 2, x2: WEST_X, z2: 2 },
  // Bathroom and bedroom 3 (east side). The kitchen stays open to the living room.
  { x1: EAST_X, z1: -1, x2: EAST_X, z2: MAX_Z },
  { x1: EAST_X, z1: -1, x2: MAX_X, z2: -1 },
  { x1: EAST_X, z1: 3, x2: MAX_X, z2: 3 },
];

export const DOORS: readonly Door[] = [
  // The front door leads from the entry out to the lawn.
  { id: 'door-front', zoneId: 'entry', x: MIN_X, z: 0, along: 'z', width: DOOR_WIDTH, label: 'front' },
  { id: 'door-bedroom1', zoneId: 'bedroom1', x: WEST_X, z: -6, along: 'z', width: DOOR_WIDTH },
  { id: 'door-bedroom2', zoneId: 'bedroom2', x: WEST_X, z: 6, along: 'z', width: DOOR_WIDTH },
  { id: 'door-bathroom', zoneId: 'bathroom', x: EAST_X, z: 1, along: 'z', width: DOOR_WIDTH },
  { id: 'door-bedroom3', zoneId: 'bedroom3', x: EAST_X, z: 6.5, along: 'z', width: DOOR_WIDTH },
  // Glass doors from the kitchen out to the backyard and the pool.
  { id: 'door-backyard', zoneId: 'kitchen', x: MAX_X, z: -3, along: 'z', width: 2, label: 'sliding', kind: 'slide' },
];

/** A window in an outer wall. Nothing can hang on the wall there. */
export interface WindowOpening {
  x: number;
  z: number;
  along: 'x' | 'z';
  width: number;
  /** Height of the bottom and the top of the opening. */
  sill: number;
  top: number;
}

const WINDOW_TOP = 2.1;
const opening = (x: number, z: number, along: 'x' | 'z', width: number, sill = 0.9): WindowOpening => ({
  x,
  z,
  along,
  width,
  sill,
  top: WINDOW_TOP,
});

/** The same list as WINDOWS in tools/blender/build_house.py, which cuts them into the model. */
export const WINDOWS: readonly WindowOpening[] = [
  opening(-10, MIN_Z, 'x', 1.8),
  opening(0, MIN_Z, 'x', 2.4),
  opening(10, MIN_Z, 'x', 1.6, 1.1),
  opening(-10, MAX_Z, 'x', 1.8),
  opening(0, MAX_Z, 'x', 2.4),
  opening(10, MAX_Z, 'x', 1.8),
  opening(MIN_X, -6, 'z', 1.8),
  opening(MIN_X, 6, 'z', 1.8),
  opening(MAX_X, -5.5, 'z', 1.6, 1.1),
  opening(MAX_X, 1, 'z', 0.8, 1.5),
  opening(MAX_X, 6.5, 'z', 1.8),
];

export const HOUSE_BOUNDS ={ minX: MIN_X, maxX: MAX_X, minZ: MIN_Z, maxZ: MAX_Z } as const;

/** The garden around the house. It lies under the house too, so it is not in ZONES. */
export const LAWN: Zone = { id: 'lawn', name: 'Lawn', kind: 'open', minX: -30, maxX: 36, minZ: -18, maxZ: 18, color: 0x9fd68a };

/** The part of the garden behind the house (east of it), where the pool is. */
export const BACKYARD: Zone = { id: 'backyard', name: 'Backyard', kind: 'open', minX: MAX_X, maxX: LAWN.maxX, minZ: LAWN.minZ, maxZ: LAWN.maxZ, color: 0x9fd68a };

/**
 * The swimming pool: a basin sunk into the backyard. Heights are relative to
 * the ground (0). Steps the full width of the pool lead down into it from the
 * south end (`maxZ`): the first tread is `steps.top` high, and each one after
 * it is `steps.rise` lower and `steps.run` further in.
 */
export const POOL = {
  minX: 21,
  maxX: 27,
  minZ: -8,
  maxZ: 4,
  /** Height of the bottom. */
  floor: -1.3,
  /** Height of the water surface. */
  water: -0.15,
  steps: { count: 4, top: -0.25, rise: 0.25, run: 0.45 },
} as const;

/** The paved terrace between the house and the pool, and around the pool. */
export const PATIO = { minX: MAX_X, maxX: 28.9, minZ: -9.9, maxZ: 5.9 } as const;

/** True over the pool basin (the steps included). */
export function inPool(x: number, z: number): boolean {
  return x > POOL.minX && x < POOL.maxX && z > POOL.minZ && z < POOL.maxZ;
}

/** Height of the pool's bottom at a point in the basin: the steps at the south end, the floor elsewhere. */
export function poolFloorAt(z: number): number {
  const { count, top, rise, run } = POOL.steps;
  const step = Math.floor((POOL.maxZ - z) / run);
  return step >= 0 && step < count ? top - step * rise : POOL.floor;
}

/** The fence on the edge of the lawn. Players cannot leave the lawn. */
export const FENCES: readonly Wall[] = [
  { x1: LAWN.minX, z1: LAWN.minZ, x2: LAWN.maxX, z2: LAWN.minZ },
  { x1: LAWN.minX, z1: LAWN.maxZ, x2: LAWN.maxX, z2: LAWN.maxZ },
  { x1: LAWN.minX, z1: LAWN.minZ, x2: LAWN.minX, z2: LAWN.maxZ },
  { x1: LAWN.maxX, z1: LAWN.minZ, x2: LAWN.maxX, z2: LAWN.maxZ },
];

/** Where new players appear: in the entry, just inside the front door, facing the living room. */
export const SPAWN = { x: -12, z: 0, yaw: -Math.PI / 2 } as const;

/**
 * The zone containing a floor position, or null outside the lawn fence.
 * Outside the house but inside the fence is the lawn, or the backyard behind
 * the house.
 * Closed rooms are checked before open areas, so a point exactly on a
 * shared edge (a doorway) belongs to the room.
 */
/**
 * True when a straight line across the floor from (ax, az) to (bx, bz) passes
 * through a wall. Doorways let it through.
 */
export function wallBetween(ax: number, az: number, bx: number, bz: number): boolean {
  for (const wall of WALLS) {
    const alongX = wall.z1 === wall.z2;
    // Across the wall's line (a) and along it (b), for both ends of the line of sight.
    const [a0, a1, b0, b1, line] = alongX ? [az, bz, ax, bx, wall.z1] : [ax, bx, az, bz, wall.x1];
    if ((a0 - line) * (a1 - line) >= 0) continue;
    const at = b0 + ((line - a0) / (a1 - a0)) * (b1 - b0);
    const [from, to] = alongX ? [wall.x1, wall.x2] : [wall.z1, wall.z2];
    if (at < Math.min(from, to) || at > Math.max(from, to)) continue;
    const doorway = DOORS.some((door) =>
      alongX
        ? door.along === 'x' && door.z === line && Math.abs(at - door.x) < door.width / 2
        : door.along === 'z' && door.x === line && Math.abs(at - door.z) < door.width / 2,
    );
    if (!doorway) return true;
  }
  return false;
}

export function zoneAt(x: number, z: number, zones: readonly Zone[] = ZONES): Zone | null {
  let open: Zone | null = null;
  for (const zone of zones) {
    if (x < zone.minX || x > zone.maxX || z < zone.minZ || z > zone.maxZ) continue;
    if (zone.kind === 'room') return zone;
    open ??= zone;
  }
  if (open) return open;
  const onLawn = x >= LAWN.minX && x <= LAWN.maxX && z >= LAWN.minZ && z <= LAWN.maxZ;
  if (zones !== ZONES || !onLawn) return null;
  return x > BACKYARD.minX ? BACKYARD : LAWN;
}

type Point3 = readonly [x: number, y: number, z: number];

/**
 * The water slide beside the pool (copied in tools/blender/build_house.py,
 * which models it). A tower stands on the lawn east of the pool with a ladder
 * on its south face. The chute leaves the platform northwards, curls round to
 * the west and drops into the pool. `path` is the sliding surface; a
 * Catmull-Rom curve runs through its points.
 */
export const SLIDE = {
  tower: { minX: 30.5, maxX: 31.5, minZ: -4.4, maxZ: -3.4, top: 2.6 },
  /** The middle of the ladder's foot. The climber faces north (−Z) up it. */
  ladder: { x: 31, z: -3.4 },
  path: [
    [31.0, 2.6, -4.2],
    [31.0, 2.42, -4.7],
    [30.719, 2.12, -5.75],
    [29.95, 1.82, -6.519],
    [28.9, 1.52, -6.8],
    [27.85, 1.22, -6.519],
    [27.081, 0.94, -5.75],
    [26.8, 0.68, -4.7],
    [26.55, 0.45, -3.75],
    [26.1, 0.32, -3.05],
  ] as readonly Point3[],
  /** The path points that stand on a post. */
  posts: [2, 3, 4, 5] as readonly number[],
} as const;

const CURVE_STEPS = 16;

/** A point on a uniform Catmull-Rom curve through `points`, at `t` from 0 (first point) to 1 (last). */
export function curvePoint(points: readonly Point3[], t: number): { x: number; y: number; z: number } {
  const segments = points.length - 1;
  const scaled = Math.min(Math.max(t, 0), 1) * segments;
  const i = Math.min(Math.floor(scaled), segments - 1);
  const u = scaled - i;
  const at = (k: number) => points[Math.min(Math.max(k, 0), segments)]!;
  const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
  const axis = (a: number) =>
    0.5 *
    (2 * p1[a]! +
      (p2[a]! - p0[a]!) * u +
      (2 * p0[a]! - 5 * p1[a]! + 4 * p2[a]! - p3[a]!) * u * u +
      (3 * p1[a]! - p0[a]! - 3 * p2[a]! + p3[a]!) * u * u * u);
  return { x: axis(0), y: axis(1), z: axis(2) };
}

/** The slide's surface as closely spaced points, with the distance along it to each one. */
export const SLIDE_TRACK: readonly { x: number; y: number; z: number; distance: number }[] = (() => {
  const count = (SLIDE.path.length - 1) * CURVE_STEPS;
  const track: { x: number; y: number; z: number; distance: number }[] = [];
  for (let k = 0; k <= count; k += 1) {
    const point = curvePoint(SLIDE.path, k / count);
    const last = track[track.length - 1];
    const distance = last ? last.distance + Math.hypot(point.x - last.x, point.y - last.y, point.z - last.z) : 0;
    track.push({ ...point, distance });
  }
  return track;
})();

export const SLIDE_LENGTH = SLIDE_TRACK[SLIDE_TRACK.length - 1]!.distance;

/** Where a rider is after sliding `distance` metres, and the way they face (0 faces +Z). */
export function slideAt(distance: number): { x: number; y: number; z: number; facing: number } {
  const d = Math.min(Math.max(distance, 0), SLIDE_LENGTH);
  let i = 1;
  while (i < SLIDE_TRACK.length - 1 && SLIDE_TRACK[i]!.distance < d) i += 1;
  const a = SLIDE_TRACK[i - 1]!;
  const b = SLIDE_TRACK[i]!;
  const u = b.distance > a.distance ? (d - a.distance) / (b.distance - a.distance) : 0;
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    z: a.z + (b.z - a.z) * u,
    facing: Math.atan2(b.x - a.x, b.z - a.z),
  };
}
