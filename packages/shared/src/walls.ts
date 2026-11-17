import { DOOR_HEIGHT, WALL_HEIGHT, WALL_THICKNESS, type Door, type Wall } from './house.js';

/** A solid box: centre position and full size on each axis. */
export interface Box {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
}

const EPS = 1e-6;

function doorsOnWall(wall: Wall, doors: readonly Door[]): Door[] {
  const alongX = Math.abs(wall.z1 - wall.z2) < EPS;
  return doors.filter((door) => {
    if (alongX) {
      const lo = Math.min(wall.x1, wall.x2);
      const hi = Math.max(wall.x1, wall.x2);
      return door.along === 'x' && Math.abs(door.z - wall.z1) < EPS && door.x > lo && door.x < hi;
    }
    const lo = Math.min(wall.z1, wall.z2);
    const hi = Math.max(wall.z1, wall.z2);
    return door.along === 'z' && Math.abs(door.x - wall.x1) < EPS && door.z > lo && door.z < hi;
  });
}

/**
 * Turns wall lines into solid boxes, leaving a gap for every door and
 * adding a lintel above each gap.
 */
export function buildWallBoxes(walls: readonly Wall[], doors: readonly Door[]): Box[] {
  const boxes: Box[] = [];

  for (const wall of walls) {
    const alongX = Math.abs(wall.z1 - wall.z2) < EPS;
    if (!alongX && Math.abs(wall.x1 - wall.x2) >= EPS) {
      throw new Error(`Wall is not axis-aligned: ${JSON.stringify(wall)}`);
    }

    const start = alongX ? Math.min(wall.x1, wall.x2) : Math.min(wall.z1, wall.z2);
    const end = alongX ? Math.max(wall.x1, wall.x2) : Math.max(wall.z1, wall.z2);
    const fixed = alongX ? wall.z1 : wall.x1;

    const push = (from: number, to: number, y0: number, y1: number) => {
      const length = to - from;
      if (length < EPS) return;
      const centre = (from + to) / 2;
      boxes.push({
        x: alongX ? centre : fixed,
        y: (y0 + y1) / 2,
        z: alongX ? fixed : centre,
        sx: alongX ? length : WALL_THICKNESS,
        sy: y1 - y0,
        sz: alongX ? WALL_THICKNESS : length,
      });
    };

    const gaps = doorsOnWall(wall, doors)
      .map((door) => {
        const centre = alongX ? door.x : door.z;
        return { from: centre - door.width / 2, to: centre + door.width / 2 };
      })
      .sort((a, b) => a.from - b.from);

    let cursor = start;
    for (const gap of gaps) {
      push(cursor, gap.from, 0, WALL_HEIGHT);
      push(gap.from, gap.to, DOOR_HEIGHT, WALL_HEIGHT);
      cursor = gap.to;
    }
    push(cursor, end, 0, WALL_HEIGHT);
  }

  return boxes;
}
