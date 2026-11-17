/**
 * Where litter turns up. The server drops new pieces on its own clock (see
 * `litterDue` in rules.ts); this decides where a piece lands: somewhere free
 * on the room's floor, away from the walls, solid furniture and other litter.
 */
import { FURNITURE_MODELS, furnitureFootprint, type Furniture } from './furniture.js';
import { ZONES, zoneAt } from './house.js';
import { LITTER_KINDS, litterCapacity, spillChance, type LitterKind } from './rules.js';

/** Litter keeps this far from the walls and this far clear of solid furniture. */
const LITTER_MARGIN = 0.4;
const LITTER_CLEARANCE = 0.25;
/** Two pieces are at least this far apart. */
const LITTER_SPACING = 1;
const TRIES = 30;

export interface LitterPiece {
  id: string;
  kind: LitterKind;
  zone: string;
  x: number;
  z: number;
  yaw: number;
}

/** The zones that collect litter: the rooms and open areas inside the house, not the garden. */
export const LITTER_ZONES: readonly string[] = ZONES.map((zone) => zone.id);

/**
 * A new piece of litter for a zone, or null when the zone already holds all it
 * can or no free spot turned up. `random` gives numbers in [0, 1).
 */
export function placeLitter(
  zoneId: string,
  existing: readonly LitterPiece[],
  furniture: readonly Furniture[],
  id: string,
  random: () => number = Math.random,
): LitterPiece | null {
  const zone = ZONES.find((each) => each.id === zoneId);
  if (!zone) return null;
  const here = existing.filter((piece) => piece.zone === zoneId);
  if (here.length >= litterCapacity((zone.maxX - zone.minX) * (zone.maxZ - zone.minZ))) return null;
  const solid = furniture.filter((piece) => FURNITURE_MODELS[piece.model].solid).map(furnitureFootprint);
  const pad = LITTER_CLEARANCE;
  for (let tries = 0; tries < TRIES; tries += 1) {
    const x = zone.minX + LITTER_MARGIN + (zone.maxX - zone.minX - 2 * LITTER_MARGIN) * random();
    const z = zone.minZ + LITTER_MARGIN + (zone.maxZ - zone.minZ - 2 * LITTER_MARGIN) * random();
    if (zoneAt(x, z)?.id !== zoneId) continue;
    if (solid.some((box) => x > box.minX - pad && x < box.maxX + pad && z > box.minZ - pad && z < box.maxZ + pad)) continue;
    if (here.some((other) => Math.hypot(other.x - x, other.z - z) < LITTER_SPACING)) continue;
    const dry = LITTER_KINDS.filter((kind) => kind !== 'spill');
    const kind: LitterKind = random() < spillChance(zoneId) ? 'spill' : dry[Math.floor(random() * dry.length)]!;
    return { id, kind, zone: zoneId, x, z, yaw: random() * Math.PI * 2 };
  }
  return null;
}
