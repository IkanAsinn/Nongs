import { describe, expect, it } from 'vitest';
import {
  DOORS,
  DOOR_HEIGHT,
  PATIO,
  POOL,
  SLIDE,
  SLIDE_LENGTH,
  WALLS,
  WALL_HEIGHT,
  ZONES,
  curvePoint,
  inPool,
  poolFloorAt,
  slideAt,
  slideTravel,
  zoneAt,
  type Door,
  type Wall,
  wallBetween,
} from './house.js';
import { buildWallBoxes } from './walls.js';

describe('zoneAt', () => {
  it('finds closed rooms and open areas', () => {
    expect(zoneAt(0, 0)?.id).toBe('living');
    expect(zoneAt(10, -5)?.id).toBe('kitchen');
    expect(zoneAt(-10, -6)?.id).toBe('bedroom1');
    expect(zoneAt(10, 1)?.id).toBe('bathroom');
    expect(zoneAt(-12, 0)?.id).toBe('entry');
  });

  it('finds the lawn outside the house', () => {
    expect(zoneAt(-20, 0)?.id).toBe('lawn');
    expect(zoneAt(20, 0)?.id).toBe('backyard');
    expect(zoneAt(0, 14)?.id).toBe('lawn');
  });

  it('returns null outside the fence', () => {
    expect(zoneAt(50, 0)).toBeNull();
  });

  it('gives a shared edge to the closed room, not the open area', () => {
    expect(zoneAt(-6, -6)?.id).toBe('bedroom1');
  });

  it('has no overlapping zones', () => {
    for (const a of ZONES) {
      for (const b of ZONES) {
        if (a === b) continue;
        const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
        const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
        expect(overlapX > 0 && overlapZ > 0, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });
});

describe('buildWallBoxes', () => {
  const wall: Wall = { x1: 0, z1: 0, x2: 10, z2: 0 };
  const door: Door = { id: 'd', zoneId: 'r', x: 4, z: 0, along: 'x', width: 1 };

  it('makes one full box for a wall without doors', () => {
    const boxes = buildWallBoxes([wall], []);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ x: 5, sx: 10, sy: WALL_HEIGHT });
  });

  it('leaves a gap for a door and adds a lintel above it', () => {
    const boxes = buildWallBoxes([wall], [door]);
    expect(boxes).toHaveLength(3);
    const [left, lintel, right] = boxes;
    expect(left).toMatchObject({ x: 1.75, sx: 3.5, sy: WALL_HEIGHT });
    expect(lintel).toMatchObject({ x: 4, sx: 1, sy: WALL_HEIGHT - DOOR_HEIGHT });
    expect(lintel!.y - lintel!.sy / 2).toBeCloseTo(DOOR_HEIGHT);
    expect(right).toMatchObject({ x: 7.25, sx: 5.5, sy: WALL_HEIGHT });
  });

  it('handles walls that run along Z', () => {
    const boxes = buildWallBoxes(
      [{ x1: 2, z1: 0, x2: 2, z2: 6 }],
      [{ id: 'd', zoneId: 'r', x: 2, z: 3, along: 'z', width: 1 }],
    );
    expect(boxes).toHaveLength(3);
    expect(boxes[0]).toMatchObject({ x: 2, z: 1.25, sz: 2.5 });
  });

  it('ignores doors that are not on the wall', () => {
    expect(buildWallBoxes([wall], [{ ...door, z: 3 }])).toHaveLength(1);
  });

  it('places every door of the real house in a wall', () => {
    const withDoors = buildWallBoxes(WALLS, DOORS);
    const withoutDoors = buildWallBoxes(WALLS, []);
    // Each door splits one wall box into three.
    expect(withDoors.length).toBe(withoutDoors.length + DOORS.length * 2);
  });

  it('gives every closed room exactly one door', () => {
    for (const zone of ZONES.filter((z) => z.kind === 'room')) {
      expect(DOORS.filter((d) => d.zoneId === zone.id), zone.id).toHaveLength(1);
    }
  });
});

describe('the backyard', () => {
  it('has the pool inside the terrace, behind the house', () => {
    expect(zoneAt(POOL.minX + 1, POOL.minZ + 1)?.id).toBe('backyard');
    expect(POOL.minX).toBeGreaterThan(PATIO.minX);
    expect(POOL.maxX).toBeLessThan(PATIO.maxX);
    expect(POOL.minZ).toBeGreaterThan(PATIO.minZ);
    expect(POOL.maxZ).toBeLessThan(PATIO.maxZ);
  });

  it('knows where the water is', () => {
    expect(inPool(24, 0)).toBe(true);
    expect(inPool(20, 0)).toBe(false);
    expect(inPool(24, 5)).toBe(false);
  });

  it('has steps at the south end that go down to the bottom', () => {
    const { count, top, rise, run } = POOL.steps;
    expect(poolFloorAt(POOL.maxZ - 0.1)).toBeCloseTo(top);
    expect(poolFloorAt(POOL.maxZ - run * (count - 0.5))).toBeCloseTo(top - (count - 1) * rise);
    expect(poolFloorAt(POOL.maxZ - run * count - 0.1)).toBe(POOL.floor);
    expect(poolFloorAt(POOL.minZ + 1)).toBe(POOL.floor);
    // No step is too high to walk up, and the lowest is within reach of a floating body.
    expect(rise).toBeLessThanOrEqual(0.3);
    expect(-top).toBeLessThanOrEqual(0.3);
  });

  it('opens a sliding door wide enough to walk through', () => {
    const slider = DOORS.find((door) => door.kind === 'slide')!;
    expect(slider.zoneId).toBe('kitchen');
    expect(slideTravel(slider)).toBeGreaterThan(0.8);
    expect(slideTravel(slider)).toBeLessThan(slider.width / 2);
  });
});

describe('the water slide', () => {
  it('starts on the tower platform and ends over the water, going downhill all the way', () => {
    const top = slideAt(0);
    const end = slideAt(SLIDE_LENGTH);
    expect(top.y).toBeCloseTo(SLIDE.tower.top);
    expect(top.x).toBeGreaterThan(SLIDE.tower.minX);
    expect(top.z).toBeGreaterThan(SLIDE.tower.minZ);
    expect(inPool(end.x, end.z)).toBe(true);
    expect(end.y).toBeGreaterThan(POOL.water);
    for (let d = 0.2; d <= SLIDE_LENGTH; d += 0.2) expect(slideAt(d).y).toBeLessThan(slideAt(d - 0.2).y + 1e-6);
  });

  it('has its tower on the lawn beside the patio, clear of the pool', () => {
    expect(SLIDE.tower.minX).toBeGreaterThan(PATIO.maxX);
    expect(zoneAt(SLIDE.ladder.x, SLIDE.ladder.z + 0.5)?.id).toBe('backyard');
  });

  it('runs through its own points', () => {
    const [x, y, z] = SLIDE.path[4]!;
    const point = curvePoint(SLIDE.path, 4 / (SLIDE.path.length - 1));
    expect(point.x).toBeCloseTo(x);
    expect(point.y).toBeCloseTo(y);
    expect(point.z).toBeCloseTo(z);
  });
});

describe('wallBetween', () => {
  it('sees across a room but not through a wall', () => {
    expect(wallBetween(-9, -1.5, -9, 1.5)).toBe(false);
    // From the entry to a picture hung on the bedroom side of their shared wall.
    expect(wallBetween(-9, -1.5, -9, -2.08)).toBe(true);
  });

  it('sees through a doorway', () => {
    expect(wallBetween(-5.5, -6, -6.5, -6)).toBe(false);
    expect(wallBetween(-5.5, -4, -6.5, -4)).toBe(true);
  });
});
