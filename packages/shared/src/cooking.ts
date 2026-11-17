/**
 * Recipes for the cooking minigame. A recipe is a list of steps; each step is
 * one mouse gesture at the chopping board or at the stove. Steps on the stove
 * are timed: some cannot be done until the food is ready, and every one burns
 * the meal if the cook is too slow. A burnt meal is thrown away and the cook
 * starts again from the fridge.
 *
 * Pure data and pure functions, so the server can check a cook's timing later.
 */

/** Things that are cut on the board. The kit has a model `kit_<name>` and a cut piece for each. */
export type Ingredient = 'carrot' | 'scallion' | 'tomato' | 'cucumber' | 'lettuce' | 'mushroom';

/** Places a gesture works on. `vessel` is the pan or pot on the stove; `plate` is where the meal is served. */
export type Place = 'board' | 'bowl' | 'rice' | 'vessel' | 'plate';

/** What shows in the pan or pot after a step. Each has a kit model; the game tints it as it cooks. */
export type PanFood = 'scramble' | 'rice_pile' | 'pancake' | 'steak' | 'omelette' | 'soup' | 'veg';

/**
 * The mouse gestures, all made with the left button held:
 * - `chop`: swipe down across the ingredient, once per cut;
 * - `circle`: draw circles over the bowl or the pan (whisk, stir, toss);
 * - `drag`: pick something up and drop it somewhere else;
 * - `shake`: move left and right quickly over the food (seasoning);
 * - `flip`: flick the mouse up quickly (flip or fold what is in the pan).
 */
export type Gesture = 'chop' | 'circle' | 'drag' | 'shake' | 'flip';

export interface CookStep {
  gesture: Gesture;
  /** Where the cook stands for this step. */
  at: 'board' | 'stove';
  /** The instruction shown to the cook. */
  text: string;
  /** Cuts, turns or shakes needed. One when left out. */
  count?: number;
  /** chop: what lies on the board. */
  item?: Ingredient;
  /** circle, shake, flip: what the gesture works on. */
  on?: Place;
  /** drag: what is picked up, and where it goes. */
  from?: Place;
  to?: Place;
  /** shake: what is shaken. */
  seasoning?: 'salt' | 'soy';
  /** What shows in the pan or pot after this step. */
  puts?: PanFood;
  /** What the bowl holds once this step starts. */
  fill?: 'egg' | 'batter';
  /** Stove steps: seconds before the food is ready for this step, and seconds until it burns. */
  ready?: number;
  burn?: number;
}

export type RecipeId = 'fried_rice' | 'pancakes' | 'steak' | 'omelette' | 'soup' | 'salad';

export interface Recipe {
  id: RecipeId;
  name: string;
  /** One line for the recipe picker. */
  blurb: string;
  /** 1 (easy) to 3 (busy). */
  difficulty: 1 | 2 | 3;
  /** What cooks on the stove; `bowl` for a dish made without the stove. */
  vessel: 'pan' | 'pot' | 'bowl';
  /** Hunger restored by eating the finished dish. */
  hunger: number;
  /** Something on the board before the first step that is not cut: the steak. */
  onBoard?: 'steak';
  steps: readonly CookStep[];
}

const chop = (item: Ingredient, count: number, name: string = item): CookStep => ({
  gesture: 'chop',
  at: 'board',
  item,
  count,
  text: `Chop the ${name}`,
});
const serve = (ready: number, burn: number, text = 'Serve it on the plate'): CookStep => ({
  gesture: 'drag',
  at: 'stove',
  from: 'vessel',
  to: 'plate',
  ready,
  burn,
  text,
});

export const RECIPES: readonly Recipe[] = [
  {
    id: 'pancakes',
    name: 'Pancakes',
    blurb: 'Whisk, pour, flip at the right moment.',
    difficulty: 1,
    vessel: 'pan',
    hunger: 45,
    steps: [
      { gesture: 'circle', at: 'board', on: 'bowl', count: 4, fill: 'batter', text: 'Whisk the batter' },
      { gesture: 'drag', at: 'stove', from: 'bowl', to: 'vessel', puts: 'pancake', burn: 8, text: 'Pour the batter into the hot pan' },
      { gesture: 'flip', at: 'stove', on: 'vessel', ready: 4, burn: 10, text: 'Flip it once it turns golden' },
      serve(3, 9),
    ],
  },
  {
    id: 'salad',
    name: 'Garden Salad',
    blurb: 'Lots of chopping, no stove. Nothing can burn.',
    difficulty: 1,
    vessel: 'bowl',
    hunger: 35,
    steps: [
      chop('lettuce', 4),
      chop('cucumber', 4),
      chop('tomato', 3),
      { gesture: 'drag', at: 'board', from: 'board', to: 'bowl', text: 'Tip the vegetables into the bowl' },
      { gesture: 'circle', at: 'board', on: 'bowl', count: 3, text: 'Toss the salad' },
      { gesture: 'shake', at: 'board', on: 'bowl', seasoning: 'salt', count: 4, text: 'Season with salt' },
    ],
  },
  {
    id: 'steak',
    name: 'Pan Steak',
    blurb: 'Season, sear, flip — and take it off in time.',
    difficulty: 2,
    vessel: 'pan',
    hunger: 60,
    onBoard: 'steak',
    steps: [
      { gesture: 'shake', at: 'board', on: 'board', seasoning: 'salt', count: 5, text: 'Season the steak' },
      { gesture: 'drag', at: 'stove', from: 'board', to: 'vessel', puts: 'steak', burn: 7, text: 'Lay the steak in the hot pan' },
      { gesture: 'flip', at: 'stove', on: 'vessel', ready: 5, burn: 10, text: 'Flip it when the underside is brown' },
      serve(4, 9, 'Take it off onto the plate'),
    ],
  },
  {
    id: 'omelette',
    name: 'Tomato Omelette',
    blurb: 'Soften the tomato, pour the egg, fold it over.',
    difficulty: 2,
    vessel: 'pan',
    hunger: 50,
    steps: [
      chop('tomato', 4),
      { gesture: 'circle', at: 'board', on: 'bowl', count: 3, fill: 'egg', text: 'Beat the eggs' },
      { gesture: 'drag', at: 'stove', from: 'board', to: 'vessel', puts: 'veg', burn: 7, text: 'Add the tomato to the pan' },
      { gesture: 'circle', at: 'stove', on: 'vessel', count: 2, burn: 8, text: 'Stir the tomato' },
      { gesture: 'drag', at: 'stove', from: 'bowl', to: 'vessel', puts: 'omelette', burn: 7, text: 'Pour in the eggs' },
      { gesture: 'flip', at: 'stove', on: 'vessel', ready: 4, burn: 9, text: 'Fold it over once it sets' },
      serve(1, 7),
    ],
  },
  {
    id: 'fried_rice',
    name: 'Fried Rice',
    blurb: 'A busy pan: egg, rice, vegetables, soy — keep it moving.',
    difficulty: 3,
    vessel: 'pan',
    hunger: 55,
    steps: [
      chop('carrot', 4),
      chop('scallion', 5, 'spring onion'),
      { gesture: 'circle', at: 'board', on: 'bowl', count: 2, fill: 'egg', text: 'Beat the egg' },
      { gesture: 'drag', at: 'stove', from: 'bowl', to: 'vessel', puts: 'scramble', burn: 7, text: 'Pour the egg into the hot pan' },
      { gesture: 'circle', at: 'stove', on: 'vessel', count: 2, burn: 8, text: 'Scramble the egg' },
      { gesture: 'drag', at: 'stove', from: 'rice', to: 'vessel', puts: 'rice_pile', burn: 7, text: 'Add the rice' },
      { gesture: 'drag', at: 'stove', from: 'board', to: 'vessel', puts: 'veg', burn: 7, text: 'Add the vegetables' },
      { gesture: 'circle', at: 'stove', on: 'vessel', count: 3, burn: 10, text: 'Stir-fry everything' },
      { gesture: 'shake', at: 'stove', on: 'vessel', seasoning: 'soy', count: 3, burn: 7, text: 'Splash in the soy sauce' },
      serve(1, 7),
    ],
  },
  {
    id: 'soup',
    name: 'Vegetable Soup',
    blurb: 'Three vegetables, one pot, and a lot of stirring.',
    difficulty: 3,
    vessel: 'pot',
    hunger: 55,
    steps: [
      chop('carrot', 4),
      chop('mushroom', 4),
      chop('tomato', 3),
      { gesture: 'drag', at: 'stove', from: 'board', to: 'vessel', puts: 'soup', burn: 8, text: 'Tip the vegetables into the pot' },
      { gesture: 'circle', at: 'stove', on: 'vessel', count: 3, burn: 9, text: 'Stir so nothing sticks' },
      { gesture: 'shake', at: 'stove', on: 'vessel', seasoning: 'salt', count: 3, burn: 7, text: 'Season with salt' },
      { gesture: 'circle', at: 'stove', on: 'vessel', count: 2, burn: 8, text: 'Stir as it thickens' },
      serve(2, 8, 'Ladle it into the bowl'),
    ],
  },
];

export const recipeById = (id: RecipeId): Recipe => RECIPES.find((recipe) => recipe.id === id)!;

/** How many cuts, turns or shakes a step needs. */
export const stepCount = (step: CookStep): number => step.count ?? 1;

/** True for a step the stove times: it can burn. */
export const isTimed = (step: CookStep): boolean => step.burn !== undefined;

/** `early`: the food is not ready for this step yet. `ready`: do it now. `burnt`: too late. */
export type Heat = 'early' | 'ready' | 'burnt';

export function heatAt(step: CookStep, seconds: number): Heat {
  if (step.burn !== undefined && seconds >= step.burn) return 'burnt';
  return seconds < (step.ready ?? 0) ? 'early' : 'ready';
}

/** How close to burning a step was finished: 0 (at once) to 1 (at the last moment). */
export function closeness(step: CookStep, seconds: number): number {
  if (step.burn === undefined) return 0;
  const ready = step.ready ?? 0;
  return Math.min(Math.max((seconds - ready) / Math.max(step.burn - ready, 1e-6), 0), 1);
}

/**
 * Stars for a finished dish, from how close each timed step came to burning:
 * three when nothing was more than half way to burning, one when something was nearly burnt.
 */
export function stars(closenesses: readonly number[]): 1 | 2 | 3 {
  const worst = Math.max(0, ...closenesses);
  if (worst <= 0.5) return 3;
  return worst <= 0.8 ? 2 : 1;
}

/** Hunger restored by a dish: the recipe's value, a little more for a well-cooked one. */
export const dishHunger = (recipe: Recipe, rating: 1 | 2 | 3): number => Math.round(recipe.hunger * (0.8 + 0.1 * rating));
