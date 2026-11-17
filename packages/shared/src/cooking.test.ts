import { describe, expect, it } from 'vitest';
import { RECIPES, closeness, dishHunger, heatAt, recipeById, stars, stepCount, type CookStep } from './cooking.js';

describe('recipes', () => {
  it('have unique ids and at least four steps', () => {
    expect(new Set(RECIPES.map((recipe) => recipe.id)).size).toBe(RECIPES.length);
    for (const recipe of RECIPES) expect(recipe.steps.length, recipe.id).toBeGreaterThanOrEqual(4);
  });

  it('give each gesture what it needs', () => {
    for (const recipe of RECIPES) {
      for (const step of recipe.steps) {
        const where = `${recipe.id}: ${step.text}`;
        if (step.gesture === 'chop') expect(step.item, where).toBeDefined();
        if (step.gesture === 'drag') expect(step.from && step.to, where).toBeTruthy();
        if (step.gesture === 'shake') expect(step.seasoning && step.on, where).toBeTruthy();
        if (step.gesture === 'circle' || step.gesture === 'flip') expect(step.on, where).toBeDefined();
        expect(stepCount(step), where).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('only use the stove when they have a pan or pot, and time every step on it', () => {
    for (const recipe of RECIPES) {
      for (const step of recipe.steps) {
        if (recipe.vessel === 'bowl') expect(step.at, recipe.id).toBe('board');
        if (step.at === 'stove') expect(step.burn, `${recipe.id}: ${step.text}`).toBeGreaterThan(step.ready ?? 0);
        else expect(step.burn, `${recipe.id}: ${step.text}`).toBeUndefined();
      }
    }
  });

  it('chop before cooking the vegetables, and fill the bowl before pouring from it', () => {
    for (const recipe of RECIPES) {
      recipe.steps.forEach((step, i) => {
        const before = recipe.steps.slice(0, i);
        if (step.from === 'bowl') expect(before.some((s) => s.fill), recipe.id).toBe(true);
        if (step.from === 'board' && !recipe.onBoard) expect(before.some((s) => s.gesture === 'chop'), recipe.id).toBe(true);
      });
    }
  });

  it('serve from the pan at the end of a stove recipe', () => {
    for (const recipe of RECIPES.filter((r) => r.vessel !== 'bowl')) {
      const last = recipe.steps[recipe.steps.length - 1]!;
      expect([last.from, last.to], recipe.id).toEqual(['vessel', 'plate']);
    }
  });
});

describe('the stove', () => {
  const flip: CookStep = { gesture: 'flip', at: 'stove', on: 'vessel', ready: 4, burn: 10, text: '' };

  it('is too early, then ready, then burnt', () => {
    expect(heatAt(flip, 1)).toBe('early');
    expect(heatAt(flip, 4)).toBe('ready');
    expect(heatAt(flip, 9.9)).toBe('ready');
    expect(heatAt(flip, 10)).toBe('burnt');
    expect(heatAt({ gesture: 'chop', at: 'board', item: 'carrot', text: '' }, 1e6)).toBe('ready');
  });

  it('rates a dish by the step that came closest to burning', () => {
    expect(closeness(flip, 4)).toBe(0);
    expect(closeness(flip, 7)).toBeCloseTo(0.5);
    expect(stars([0.1, 0.4])).toBe(3);
    expect(stars([0.1, 0.7])).toBe(2);
    expect(stars([0.95])).toBe(1);
    expect(stars([])).toBe(3);
    const steak = recipeById('steak');
    expect(dishHunger(steak, 3)).toBeGreaterThan(dishHunger(steak, 1));
  });
});
