/**
 * Door locks. Only someone inside a closed room (a bedroom or the bathroom)
 * can lock its door, and only while the door is shut. Nobody can open a
 * locked door from outside, but they can knock. Someone inside can always
 * leave: opening the door from inside unlocks it. A room whose last person
 * has left unlocks by itself.
 *
 * The client uses these rules for its prompts; the server will use the same
 * rules to refuse entry and voice to a locked room.
 */
import { ZONES, type Door } from './house.js';

/** A door does not shut on someone standing this close to its doorway. */
export const DOOR_BLOCK_RADIUS = 0.75;

/**
 * True when someone at (x, z) stands in the way of shutting a door: in a
 * swinging door's doorway, or in the half of a sliding door that opens.
 */
export function doorBlockedBy(door: Door, x: number, z: number): boolean {
  const shift = door.kind === 'slide' ? door.width / 4 : 0;
  const gapX = door.x + (door.along === 'x' ? shift : 0);
  const gapZ = door.z + (door.along === 'x' ? 0 : shift);
  return Math.hypot(x - gapX, z - gapZ) < DOOR_BLOCK_RADIUS;
}

/** Who locked each locked door, by door id. */
export type Locks = ReadonlyMap<string, string>;

/** True for doors into a closed room. The front door and the doors to open areas have no lock. */
export function isLockable(door: Door): boolean {
  return ZONES.find((zone) => zone.id === door.zoneId)?.kind === 'room';
}

export type DoorUse = 'open' | 'close' | 'knock';
export type LockUse = 'lock' | 'unlock';

/**
 * What a player can do at a door: the main action (E) and the lock (L), or
 * null when there is no lock to work. `inside` is true when they stand in the
 * door's room.
 */
export function doorChoices(
  door: Door,
  state: { isOpen: boolean; locked: boolean; inside: boolean },
): { use: DoorUse; lock: LockUse | null } {
  if (state.isOpen) return { use: 'close', lock: null };
  if (state.locked) return state.inside ? { use: 'open', lock: 'unlock' } : { use: 'knock', lock: null };
  return { use: 'open', lock: state.inside && isLockable(door) ? 'lock' : null };
}

/**
 * The locks that still hold: a lock goes when nobody who could have locked it
 * is in its room any more. `occupied` has the ids of the rooms with someone in.
 */
export function locksAfterLeaving(locks: Locks, doors: readonly Door[], occupied: ReadonlySet<string>): Map<string, string> {
  const kept = new Map<string, string>();
  for (const [doorId, by] of locks) {
    const door = doors.find((each) => each.id === doorId);
    if (door && occupied.has(door.zoneId)) kept.set(doorId, by);
  }
  return kept;
}
