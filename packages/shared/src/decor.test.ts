import { describe, expect, it } from 'vitest';
import { carried, checkPlacement, isMovable, layoutWith, restingHeight, ridersOf, savedLayout, type Placement } from './decor.js';
import { BIRTHDAY_CAKE } from './birthday.js';
import { FURNITURE, type Furniture } from './furniture.js';

const piece = (id: string): Furniture => {
  const found = FURNITURE.find((other) => other.id === id);
  if (!found) throw new Error(`No piece called ${id}`);
  return found;
};
const at = (x: number, z: number, turns = 0, elevation = 0): Placement => ({ x, z, yaw: (turns * Math.PI) / 2, elevation });

describe('where furniture may stand', () => {
  it('accepts every movable piece where the house was built with it', () => {
    for (const each of FURNITURE.filter(isMovable)) {
      expect(checkPlacement(each, each, FURNITURE), each.id).toBeNull();
    }
  });

  it('never moves plumbing and kitchen fittings', () => {
    expect(checkPlacement(piece('bathtub-1'), at(0, 0), FURNITURE)).toBe('fixed');
    expect(checkPlacement(piece('stove'), at(0, 0), FURNITURE)).toBe('fixed');
  });

  it('lets a piece stand on a free bit of floor, and turn', () => {
    expect(checkPlacement(piece('sofa'), at(3.5, 0), FURNITURE)).toBeNull();
    expect(checkPlacement(piece('sofa'), at(3.5, 0, 1), FURNITURE)).toBeNull();
  });

  it('refuses a piece on top of another, in a wall, in a doorway or outside', () => {
    expect(checkPlacement(piece('sofa'), at(0, -5.6), FURNITURE)).toBe('blocked');
    // The entry is open to the living room: no wall and no door there.
    expect(checkPlacement(piece('sofa'), at(-6, 0, 1), FURNITURE)).toBeNull();
    expect(checkPlacement(piece('chair-west'), at(-6.3, -6), FURNITURE)).toBe('doorway');
    expect(checkPlacement(piece('chair-west'), at(-6, -4), FURNITURE)).toBe('wall');
    expect(checkPlacement(piece('chair-west'), at(-16, 0), FURNITURE)).toBe('outside');
  });

  it('lets rugs lie under furniture and in doorways', () => {
    expect(checkPlacement(piece('rug-1'), at(0, -7), FURNITURE)).toBeNull();
    expect(checkPlacement(piece('doormat-1'), at(-6.6, -6, 1), FURNITURE)).toBeNull();
  });
});

describe('small things', () => {
  it('stand on the floor or on a table top, not in between', () => {
    const vase = piece('vase-1');
    expect(restingHeight(3, 0, FURNITURE)).toBe(0);
    expect(checkPlacement(vase, at(3, 0), FURNITURE)).toBeNull();
    expect(checkPlacement(vase, at(3, 0, 0, 0.4), FURNITURE)).toBe('blocked');
    // The dining table is 0.775 m high.
    expect(restingHeight(9.6, -5, FURNITURE)).toBeCloseTo(0.775);
    expect(checkPlacement(vase, at(9.6, -5, 0, 0.775), FURNITURE)).toBeNull();
    expect(checkPlacement(vase, at(9.6, -5), FURNITURE)).toBe('blocked');
  });

  it('cannot be put inside a cupboard', () => {
    const wardrobe = piece('wardrobe-1');
    expect(checkPlacement(piece('vase-1'), at(wardrobe.x, wardrobe.z), FURNITURE)).toBe('blocked');
  });

  it('ride along when their table moves', () => {
    const table = piece('coffee-table');
    // The cake only stands on it during a birthday.
    const riders = ridersOf(table, [...FURNITURE, BIRTHDAY_CAKE]);
    expect(riders.map((rider) => rider.id)).toEqual(['cake']);
    // A quarter turn to the left around the table, and two metres along.
    const moved = carried({ x: table.x + 0.2, z: table.z, yaw: 0, elevation: 0.36 }, table, at(table.x + 2, table.z, 1));
    expect(moved.x).toBeCloseTo(table.x + 2);
    expect(moved.z).toBeCloseTo(table.z - 0.2);
    expect(moved.elevation).toBeCloseTo(0.36);
  });
});

describe('things on the wall', () => {
  const picture = piece('picture-1');
  // The north wall of bedroom 1 is at z = -10; its window is around x = -10.
  const onNorthWall = (x: number, y = 1.25) => at(x, -10 + 0.075 + 0.025, 0, y);

  it('hang flat on a free stretch of wall', () => {
    expect(checkPlacement(picture, onNorthWall(-7.5), FURNITURE)).toBeNull();
    expect(checkPlacement(picture, at(-7.5, -6, 0, 1.25), FURNITURE)).toBe('no-wall');
    expect(checkPlacement(picture, onNorthWall(-7.5, 0.1), FURNITURE)).toBe('no-wall');
    expect(checkPlacement(picture, onNorthWall(-7.5, 2.6), FURNITURE)).toBe('no-wall');
  });

  it('must face away from the wall', () => {
    expect(checkPlacement(picture, { ...onNorthWall(-7.5), yaw: Math.PI }, FURNITURE)).toBe('no-wall');
  });

  it('cannot cover a window, a corner or another picture', () => {
    expect(checkPlacement(picture, onNorthWall(-10), FURNITURE)).toBe('blocked');
    expect(checkPlacement(picture, onNorthWall(-6.2), FURNITURE)).not.toBeNull();
    const other = piece('picture-4');
    expect(checkPlacement(picture, { ...other, x: other.x, z: other.z + 0.3 }, FURNITURE)).toBe('blocked');
    expect(checkPlacement(picture, { ...other, x: other.x, z: other.z + 0.9 }, FURNITURE)).toBeNull();
  });
});

describe('a stored layout', () => {
  it('keeps only the pieces that were moved, and puts them back', () => {
    const moved = FURNITURE.map((each) => (each.id === 'sofa' ? { ...each, x: 3.5, z: 0, yaw: Math.PI / 2 } : { ...each }));
    const saved = savedLayout(FURNITURE, moved);
    expect(saved).toEqual({ sofa: { x: 3.5, z: 0, turns: 1, y: 0 } });
    const again = layoutWith(FURNITURE, JSON.parse(JSON.stringify(saved)));
    const sofa = again.find((each) => each.id === 'sofa')!;
    expect(sofa.x).toBe(3.5);
    expect(sofa.yaw).toBeCloseTo(Math.PI / 2);
    expect(savedLayout(FURNITURE, again)).toEqual(saved);
  });

  it('ignores anything that is not a sensible move', () => {
    const junk = {
      sofa: { x: 400, z: 0, turns: 0, y: 0 },
      'chair-west': { x: 'left', z: 0, turns: 0, y: 0 },
      'bathtub-1': { x: 0, z: 0, turns: 0, y: 0 },
      nothing: { x: 0, z: 0, turns: 0, y: 0 },
      'plant-1': null,
    };
    expect(savedLayout(FURNITURE, layoutWith(FURNITURE, junk))).toEqual({});
    for (const input of [null, 7, 'x', []]) expect(savedLayout(FURNITURE, layoutWith(FURNITURE, input))).toEqual({});
  });

  it('does not change the furniture it starts from', () => {
    const before = JSON.stringify(FURNITURE);
    layoutWith(FURNITURE, { sofa: { x: 3, z: 0, turns: 2, y: 0 } })[0]!.x = 99;
    expect(JSON.stringify(FURNITURE)).toBe(before);
  });
});
