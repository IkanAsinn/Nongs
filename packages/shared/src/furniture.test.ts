import { describe, expect, it } from 'vitest';
import { FURNITURE, FURNITURE_MODELS, furnitureFootprint, pieceToWorld } from './furniture.js';
import { DOORS, HOUSE_BOUNDS, PATIO, SPAWN, WALLS, WALL_THICKNESS, zoneAt } from './house.js';

const solid = FURNITURE.filter((piece) => FURNITURE_MODELS[piece.model].solid);
/** Room for rounding: positions in the data file have three decimals. */
const EPSILON = 1e-6;

describe('furniture', () => {
  it('has unique ids and known models', () => {
    expect(new Set(FURNITURE.map((f) => f.id)).size).toBe(FURNITURE.length);
    for (const piece of FURNITURE) expect(FURNITURE_MODELS[piece.model], piece.id).toBeDefined();
  });

  it('stands inside the house, clear of the outer walls, or out on the terrace', () => {
    const margin = WALL_THICKNESS / 2 - EPSILON;
    for (const piece of FURNITURE) {
      const box = furnitureFootprint(piece);
      if (box.minX >= PATIO.minX + margin) {
        expect(box.maxX, piece.id).toBeLessThanOrEqual(PATIO.maxX);
        expect(box.minZ, piece.id).toBeGreaterThanOrEqual(PATIO.minZ);
        expect(box.maxZ, piece.id).toBeLessThanOrEqual(PATIO.maxZ);
        continue;
      }
      expect(box.minX, piece.id).toBeGreaterThanOrEqual(HOUSE_BOUNDS.minX + margin);
      expect(box.maxX, piece.id).toBeLessThanOrEqual(HOUSE_BOUNDS.maxX - margin);
      expect(box.minZ, piece.id).toBeGreaterThanOrEqual(HOUSE_BOUNDS.minZ + margin);
      expect(box.maxZ, piece.id).toBeLessThanOrEqual(HOUSE_BOUNDS.maxZ - margin);
    }
  });

  it('does not cross a wall line', () => {
    for (const piece of FURNITURE) {
      const box = furnitureFootprint(piece);
      for (const wall of WALLS) {
        const crossesX = wall.x1 === wall.x2 && box.minX < wall.x1 && box.maxX > wall.x1 &&
          box.maxZ > Math.min(wall.z1, wall.z2) && box.minZ < Math.max(wall.z1, wall.z2);
        const crossesZ = wall.z1 === wall.z2 && box.minZ < wall.z1 && box.maxZ > wall.z1 &&
          box.maxX > Math.min(wall.x1, wall.x2) && box.minX < Math.max(wall.x1, wall.x2);
        expect(crossesX || crossesZ, `${piece.id} crosses a wall`).toBe(false);
      }
    }
  });

  it('keeps doorways and the spawn point clear of solid pieces', () => {
    const clear = [...DOORS.map((d) => ({ x: d.x, z: d.z })), SPAWN];
    for (const piece of solid) {
      const box = furnitureFootprint(piece);
      for (const point of clear) {
        const dx = Math.max(box.minX - point.x, 0, point.x - box.maxX);
        const dz = Math.max(box.minZ - point.z, 0, point.z - box.maxZ);
        expect(Math.hypot(dx, dz), piece.id).toBeGreaterThan(1.2);
      }
    }
  });

  it('has no two solid pieces in the same place', () => {
    for (const a of solid) {
      for (const b of solid) {
        if (a === b) continue;
        const boxA = furnitureFootprint(a);
        const boxB = furnitureFootprint(b);
        const overlapX = Math.min(boxA.maxX, boxB.maxX) - Math.max(boxA.minX, boxB.minX);
        const overlapZ = Math.min(boxA.maxZ, boxB.maxZ) - Math.max(boxA.minZ, boxB.minZ);
        expect(overlapX > EPSILON && overlapZ > EPSILON, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it('is in a room, not on the lawn', () => {
    for (const piece of FURNITURE) {
      expect(zoneAt(piece.x, piece.z)?.id, piece.id).not.toBe('lawn');
    }
  });

  it('turns points with the piece', () => {
    const piece = { id: 't', model: 'prop_chair', x: 2, z: 3, yaw: Math.PI / 2, elevation: 0 } as const;
    const front = pieceToWorld(piece, 0, 1); // a piece facing east has its front towards +X
    expect(front.x).toBeCloseTo(3);
    expect(front.z).toBeCloseTo(3);
  });
});
