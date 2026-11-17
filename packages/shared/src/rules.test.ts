import { describe, expect, it } from 'vitest';
import {
  FULL_STATS,
  LOW_STAT,
  eat,
  isEdible,
  litterCapacity,
  litterDue,
  spillChance,
  toolFor,
  speedFactor,
  tickStats,
} from './rules.js';

describe('stats', () => {
  it('drain while awake and never leave 0–100', () => {
    const later = tickStats(FULL_STATS, 'walking', 60);
    expect(later.energy).toBeLessThan(100);
    expect(later.hunger).toBeLessThan(100);
    expect(tickStats(FULL_STATS, 'running', 1e6)).toEqual({ energy: 0, hunger: 0 });
    expect(tickStats({ energy: 99, hunger: 50 }, 'sleeping', 1e3).energy).toBe(100);
  });

  it('running tires faster than walking', () => {
    expect(tickStats(FULL_STATS, 'running', 60).energy).toBeLessThan(tickStats(FULL_STATS, 'walking', 60).energy);
  });

  it('sleeping restores energy and sitting restores it slowly', () => {
    const tired = { energy: 10, hunger: 80 };
    const slept = tickStats(tired, 'sleeping', 10);
    const sat = tickStats(tired, 'sitting', 10);
    expect(slept.energy).toBeGreaterThan(sat.energy);
    expect(sat.energy).toBeGreaterThan(tired.energy);
    expect(slept.hunger).toBeLessThan(tired.hunger); // you still get hungry in bed
  });

  it('slow the player only when a stat is low', () => {
    expect(speedFactor(FULL_STATS)).toBe(1);
    expect(speedFactor({ energy: LOW_STAT, hunger: 100 })).toBe(1);
    expect(speedFactor({ energy: 0, hunger: 100 })).toBeCloseTo(0.6);
    expect(speedFactor({ energy: 100, hunger: LOW_STAT / 2 })).toBeCloseTo(0.8);
  });
});

describe('food', () => {
  it('only cooked food and cake can be eaten', () => {
    expect(isEdible('ingredients')).toBe(false);
    expect(isEdible('meal')).toBe(true);
    expect(isEdible('cake')).toBe(true);
  });

  it('a meal fills you up, by its own amount when given, and never past full', () => {
    const hungry = { energy: 50, hunger: 20 };
    expect(eat(hungry, 'meal').hunger).toBe(70);
    expect(eat(hungry, 'meal', 30).hunger).toBe(50);
    expect(eat({ energy: 50, hunger: 90 }, 'meal').hunger).toBe(100);
    expect(eat(hungry, 'meal').energy).toBe(50);
  });
});

describe('litter', () => {
  it('fits a few pieces in each room, at least two', () => {
    expect(litterCapacity(1)).toBe(2);
    expect(litterCapacity(36)).toBe(4);
  });

  it('turns up every few minutes in a lived-in room, and slowly in an empty one', () => {
    expect(litterDue(60, true)).toBeLessThan(1);
    expect(litterDue(600, true)).toBeGreaterThan(1);
    expect(litterDue(3600, false)).toBeLessThan(litterDue(3600, true));
    expect(litterDue(24 * 3600, false)).toBeGreaterThan(1);
  });

  it('needs the mop for spills and the broom for the rest', () => {
    expect(toolFor('spill')).toBe('mop');
    expect(toolFor('paper')).toBe('broom');
    expect(spillChance('kitchen')).toBeGreaterThan(spillChance('living'));
  });
});
