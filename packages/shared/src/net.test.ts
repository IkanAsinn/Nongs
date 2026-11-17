import { describe, expect, it } from 'vitest';
import { DOORS } from './house.js';
import { FURNITURE } from './furniture.js';
import { placeLitter, type LitterPiece } from './litter.js';
import { doorBlockedBy } from './locks.js';
import { moveProblem, readMotion, voiceVolume, type Motion } from './net.js';

const motion: Motion = {
  x: 1,
  y: 0,
  z: 2,
  facing: 0,
  anim: 'walk',
  speed: 2,
  recline: 0,
  swim: '',
  bare: false,
  carrying: '',
  muted: false,
  deafened: false,
  inPrivate: false,
};

describe('moves from a browser', () => {
  it('are taken when every field is sensible', () => {
    expect(readMotion(motion)).toEqual(motion);
    expect(readMotion({ ...motion, speed: 500 })?.speed).toBe(14);
  });

  it('are thrown away when anything is off', () => {
    expect(readMotion(null)).toBeNull();
    expect(readMotion({ ...motion, x: Number.NaN })).toBeNull();
    expect(readMotion({ ...motion, x: 10_000 })).toBeNull();
    expect(readMotion({ ...motion, anim: 'fly' })).toBeNull();
    expect(readMotion({ ...motion, carrying: 'sword' })).toBeNull();
    expect(readMotion({ ...motion, muted: 'yes' })).toBeNull();
  });

  it('may not be faster than anyone can go, or into a room someone locked', () => {
    const none = new Set<string>();
    expect(moveProblem({ x: 0, z: 0 }, { x: 0.5, z: 0 }, 0.05, none)).toBeNull();
    expect(moveProblem({ x: -12, z: 0 }, { x: 4, z: 1 }, 0.05, none)).toBe('too-fast');
    // Through the bathroom door (x = 6) into the bathroom.
    expect(moveProblem({ x: 5.8, z: 1 }, { x: 6.3, z: 1 }, 0.1, new Set(['bathroom']))).toBe('locked');
    // Inside the locked room already: walking about is fine.
    expect(moveProblem({ x: 7, z: 1 }, { x: 7.3, z: 1 }, 0.1, new Set(['bathroom']))).toBeNull();
  });
});

describe('a door', () => {
  const bathroom = DOORS.find((door) => door.id === 'door-bathroom')!;
  const sliding = DOORS.find((door) => door.kind === 'slide')!;

  it('does not shut on someone in the doorway', () => {
    expect(doorBlockedBy(bathroom, bathroom.x + 0.2, bathroom.z)).toBe(true);
    expect(doorBlockedBy(bathroom, bathroom.x + 2, bathroom.z)).toBe(false);
  });

  it('that slides is only blocked in the half that opens', () => {
    expect(doorBlockedBy(sliding, sliding.x, sliding.z + sliding.width / 4)).toBe(true);
    expect(doorBlockedBy(sliding, sliding.x, sliding.z - sliding.width / 2)).toBe(false);
  });
});

describe('litter', () => {
  // A fixed sequence instead of Math.random, so the test always sees the same floor.
  const seeded = (seed: number) => () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  it('lands on free floor in its own room, apart from other litter', () => {
    const pieces: LitterPiece[] = [];
    const random = seeded(7);
    for (let i = 0; i < 5; i += 1) {
      const piece = placeLitter('living', pieces, FURNITURE, `l${i}`, random);
      if (piece) pieces.push(piece);
    }
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.zone).toBe('living');
    for (const a of pieces) for (const b of pieces) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(1);
  });

  it('stops once a room holds all it can', () => {
    const pieces: LitterPiece[] = [];
    const random = seeded(3);
    for (let i = 0; i < 40; i += 1) {
      const piece = placeLitter('bathroom', pieces, FURNITURE, `l${i}`, random);
      if (piece) pieces.push(piece);
    }
    expect(placeLitter('bathroom', pieces, FURNITURE, 'one-more', random)).toBeNull();
  });
});

describe('voices in an open area', () => {
  it('are loud close by and silent far away', () => {
    expect(voiceVolume(0.5)).toBe(1);
    expect(voiceVolume(6)).toBeGreaterThan(0);
    expect(voiceVolume(6)).toBeLessThan(1);
    expect(voiceVolume(12)).toBe(0);
  });
});

describe('storage', () => {
  it('keeps a stored piece far outside the house and brings it back from a saved layout', async () => {
    const { FURNITURE, STORAGE, canStore, isStored, layoutWith } = await import('./index.js');
    const chair = FURNITURE.find((piece) => piece.model === 'prop_chair')!;
    const pieces = layoutWith(FURNITURE, { [chair.id]: { x: STORAGE.x, z: STORAGE.z, turns: 0, y: 0 } });
    const stored = pieces.find((piece) => piece.id === chair.id)!;
    expect(isStored(stored)).toBe(true);
    expect(canStore(chair)).toBe(true);
    expect(canStore(FURNITURE.find((piece) => piece.model === 'prop_broom')!)).toBe(false);
  });
});
