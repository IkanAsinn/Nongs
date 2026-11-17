/**
 * What the game server and the browsers say to each other. Everybody shares one
 * house (one Colyseus room). The server owns the state that everyone sees the
 * same way: who is where, doors and locks, litter, the cake, the furniture and
 * the pictures, and each player's stats. A browser sends what its own player
 * does; the server checks it with the rules in this package before it counts.
 */
import { BACKYARD, LAWN, ZONES, zoneAt } from './house.js';

/** The Colyseus room name. There is only ever one house. */
export const HOUSE_ROOM = 'house';
export const MAX_PLAYERS = 16;
/** How often a browser sends where its player is, per second. */
export const SEND_RATE = 20;
/** The path the game server answers on, beside /api. */
export const GAME_PATH = '/colyseus';

/** The fastest anyone moves (the slide, a run), in metres per second, with room for a late packet. */
export const MAX_SPEED = 14;
/** How far from a door, a piece of litter or the cake a player can work it, in metres. */
export const REACH = 2.5;

/** The animations other players can be shown in. */
export const MOTION_ANIMATIONS = ['idle', 'walk', 'run', 'jump', 'sit', 'lounge', 'sleep'] as const;
export type MotionAnimation = (typeof MOTION_ANIMATIONS)[number];
export const SWIM_STYLES = ['', 'tread', 'stroke'] as const;
export type SwimStyle = (typeof SWIM_STYLES)[number];
export const CARRIED_THINGS = ['', 'ingredients', 'meal', 'cake', 'broom', 'mop'] as const;
export type CarriedThing = (typeof CARRIED_THINGS)[number];

/** The reactions and the yawn, by name, that one player can show the others. */
export const GESTURE_NAMES = ['wave', 'clap', 'cheer', 'shrug', 'laugh', 'dance', 'blow_kiss', 'yawn'] as const;

/** Where a player is and how they look this moment. Sent `SEND_RATE` times a second. */
export interface Motion {
  x: number;
  y: number;
  z: number;
  facing: number;
  anim: MotionAnimation;
  /** Movement speed in m/s, for the step rate. */
  speed: number;
  /** How far back the upper body leans, in radians (a sun lounger). */
  recline: number;
  swim: SwimStyle;
  /** Clothes off: in the bath or deep in the pool. */
  bare: boolean;
  carrying: CarriedThing;
  muted: boolean;
  deafened: boolean;
  /** In the bath, where nothing is heard or said. */
  inPrivate: boolean;
}

/** Messages from a browser to the server. */
export interface ClientMessages {
  move: Motion;
  /** A reaction or a yawn, shown to everyone else. */
  react: { name: string };
  door: { id: string; open: boolean };
  lock: { id: string; locked: boolean };
  knock: { id: string };
  /** A piece of litter this player has swept or mopped up. */
  swept: { id: string };
  /** One slice of birthday cake taken. */
  slice: Record<string, never>;
  /** The candles blown out. */
  blow: Record<string, never>;
  /** Something eaten: a meal by recipe and stars, or a slice of cake. */
  eat: { food: 'meal' | 'cake'; recipe?: string; rating?: number };
  /** A piece of furniture put down somewhere new. */
  place: { id: string; x: number; z: number; turns: number; y: number };
  /** Puts a piece away in storage (see STORAGE in decor.ts). Placing it again takes it out. */
  store: { id: string };
  /** The player's new look, already saved on the account. */
  look: Record<string, never>;
}

/** Messages from the server to one browser or to everybody. */
export interface ServerMessages {
  /** Someone reacted. */
  react: { sessionId: string; name: string };
  /** Someone knocked on the door of the room this player is in. */
  knock: { id: string; by: string };
  /** The server would not take that: the reason, for the prompt line. */
  refused: { message: string };
  /** Go back here: the move was not allowed (into a locked room, or too far at once). */
  correct: { x: number; y: number; z: number };
  /** Smoke where the candles were. */
  blown: { by: string };
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T => list.includes(value as T);

/** The world's edges: the fields around the house go out this far. */
const WORLD = 300;

/** A `Motion` from the wire, checked field by field; null when anything is off. */
export function readMotion(raw: unknown): Motion | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (![m.x, m.y, m.z, m.facing, m.speed, m.recline].every(finite)) return null;
  const x = m.x as number;
  const y = m.y as number;
  const z = m.z as number;
  if (Math.abs(x) > WORLD || Math.abs(z) > WORLD || y < -5 || y > 30) return null;
  if (!oneOf(MOTION_ANIMATIONS, m.anim) || !oneOf(SWIM_STYLES, m.swim) || !oneOf(CARRIED_THINGS, m.carrying)) return null;
  if (![m.bare, m.muted, m.deafened, m.inPrivate].every((flag) => typeof flag === 'boolean')) return null;
  return {
    x,
    y,
    z,
    facing: m.facing as number,
    anim: m.anim,
    speed: Math.min(Math.abs(m.speed as number), MAX_SPEED),
    recline: Math.min(Math.max(m.recline as number, 0), 1.5),
    swim: m.swim,
    bare: m.bare as boolean,
    carrying: m.carrying,
    muted: m.muted as boolean,
    deafened: m.deafened as boolean,
    inPrivate: m.inPrivate as boolean,
  };
}

/**
 * Whether a player may go from one point to another in `seconds`: not faster
 * than anyone can move, and not into a room someone else has locked. A move
 * that starts inside the room is fine (a player can always walk about in a room
 * they are in). `lockedZones` has the ids of the rooms that are locked.
 */
export function moveProblem(
  from: { x: number; z: number },
  to: { x: number; z: number },
  seconds: number,
  lockedZones: ReadonlySet<string>,
): 'too-fast' | 'locked' | null {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  // A frame or two of slack, so a late packet after a pause is not refused.
  if (distance > MAX_SPEED * Math.max(seconds, 0.25) + 0.5) return 'too-fast';
  const before = zoneAt(from.x, from.z)?.id;
  const after = zoneAt(to.x, to.z)?.id;
  if (after && after !== before && lockedZones.has(after)) return 'locked';
  return null;
}

/** The name of the LiveKit room for a zone: one voice channel per room or open area. */
export const voiceRoomFor = (zoneId: string): string => `nongs-${zoneId}`;

/** The zone ids that have voice channels: every room and open area, and the garden. Beyond the fence nobody is heard. */
export const VOICE_ZONES: readonly string[] = [...ZONES.map((zone) => zone.id), LAWN.id, BACKYARD.id];

/** In an open area, voices fade with distance: full volume close by, silent this far away. */
export const VOICE_FALLOFF = { full: 1, silent: 12, listen: 15 } as const;

/** How loud a voice is at `distance` metres in an open area, from 1 to 0. */
export function voiceVolume(distance: number): number {
  if (distance <= VOICE_FALLOFF.full) return 1;
  if (distance >= VOICE_FALLOFF.silent) return 0;
  const t = (distance - VOICE_FALLOFF.full) / (VOICE_FALLOFF.silent - VOICE_FALLOFF.full);
  return (1 - t) * (1 - t);
}
