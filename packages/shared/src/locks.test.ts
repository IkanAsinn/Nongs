import { describe, expect, it } from 'vitest';
import { DOORS } from './house.js';
import { doorChoices, isLockable, locksAfterLeaving } from './locks.js';

const door = (id: string) => DOORS.find((each) => each.id === id)!;

describe('door locks', () => {
  it('fit the doors into closed rooms only', () => {
    expect(isLockable(door('door-bathroom'))).toBe(true);
    expect(isLockable(door('door-bedroom1'))).toBe(true);
    expect(isLockable(door('door-front'))).toBe(false);
    expect(isLockable(door('door-backyard'))).toBe(false);
  });

  it('are worked from inside, with the door shut', () => {
    const bathroom = door('door-bathroom');
    expect(doorChoices(bathroom, { isOpen: false, locked: false, inside: true })).toEqual({ use: 'open', lock: 'lock' });
    expect(doorChoices(bathroom, { isOpen: false, locked: false, inside: false })).toEqual({ use: 'open', lock: null });
    expect(doorChoices(bathroom, { isOpen: true, locked: false, inside: true })).toEqual({ use: 'close', lock: null });
  });

  it('keep people out, who can only knock, and always let people out', () => {
    const bathroom = door('door-bathroom');
    expect(doorChoices(bathroom, { isOpen: false, locked: true, inside: false })).toEqual({ use: 'knock', lock: null });
    expect(doorChoices(bathroom, { isOpen: false, locked: true, inside: true })).toEqual({ use: 'open', lock: 'unlock' });
  });

  it('come undone when the room is empty', () => {
    const locks = new Map([['door-bathroom', 'ana'], ['door-bedroom1', 'ben']]);
    const kept = locksAfterLeaving(locks, DOORS, new Set(['bedroom1']));
    expect([...kept.keys()]).toEqual(['door-bedroom1']);
  });
});
