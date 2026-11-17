/**
 * Draws only the rooms the player could see into. The open areas (living
 * room, entry, kitchen) and the garden always see each other. A closed room
 * (a bedroom or the bathroom) is drawn when the player is inside it, or when
 * its door is open and the player is in the open part of the house. From
 * inside a closed room with its door shut, nothing else is drawn.
 *
 * Only furniture and the other players are hidden: the walls themselves are
 * one model, and they stand in the way of the rest anyway.
 */
import type * as THREE from 'three';
import { ZONES, zoneAt, type Furniture } from '@nongs/shared';
import type { DoorInstance } from './buildHouse';

const CLOSED_ROOMS = new Set(ZONES.filter((zone) => zone.kind === 'room').map((zone) => zone.id));
/** Never hidden here: the cake shows only on a birthday (the game view decides), and a broom or mop may be in hand anywhere. */
const ALWAYS_DRAWN = new Set(['prop_cake', 'prop_broom', 'prop_mop']);

/** The zones the player can see from `here` (a zone id, or null outside the house). Open areas and the garden are '' together. */
export function visibleZones(here: string | null, doors: readonly DoorInstance[]): Set<string> {
  const openDoors = new Set(doors.filter((door) => door.isOpen && CLOSED_ROOMS.has(door.def.zoneId)).map((door) => door.def.zoneId));
  if (here && CLOSED_ROOMS.has(here)) {
    // Shut in: only this room. With the door open, the open areas and the rooms open onto them too.
    return openDoors.has(here) ? new Set(['', ...openDoors]) : new Set([here]);
  }
  return new Set(['', ...openDoors]);
}

/** A zone id for drawing: closed rooms by id, everything else (open areas, garden, outside) as ''. */
export const drawZoneAt = (x: number, z: number): string => {
  const zone = zoneAt(x, z)?.id ?? '';
  return CLOSED_ROOMS.has(zone) ? zone : '';
};

export class RoomVisibility {
  constructor(
    private readonly pieces: readonly Furniture[],
    private readonly objects: ReadonlyMap<string, THREE.Object3D>,
    private readonly doors: readonly DoorInstance[],
  ) {}

  /** Shows the furniture of the rooms in view and hides the rest. Returns the zones in view, for other things to follow. */
  update(feetX: number, feetZ: number): Set<string> {
    const here = drawZoneAt(feetX, feetZ);
    const visible = visibleZones(here || null, this.doors);
    for (const piece of this.pieces) {
      if (ALWAYS_DRAWN.has(piece.model)) continue;
      const object = this.objects.get(piece.id);
      // Pieces move when decorating, so their room is worked out each time.
      if (object) object.visible = visible.has(drawZoneAt(piece.x, piece.z));
    }
    return visible;
  }
}
