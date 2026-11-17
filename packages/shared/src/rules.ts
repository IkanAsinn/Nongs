/**
 * The rules of daily life in the house: energy and hunger, eating, and litter.
 * Everything here is a pure function of its inputs, so the client can run it
 * today and the server can own it once the game is multiplayer.
 */

/** Both run from 0 (empty) to 100 (full). A hunger of 100 means well fed. */
export interface Stats {
  energy: number;
  hunger: number;
}

export const FULL_STATS: Stats = { energy: 100, hunger: 100 };

export type Activity = 'idle' | 'walking' | 'running' | 'sitting' | 'sleeping';

/** Change per second. A full energy bar lasts about 20 minutes of walking around. */
const ENERGY_RATE: Record<Activity, number> = {
  idle: -100 / 1500,
  walking: -100 / 1200,
  running: -100 / 500,
  sitting: 100 / 900,
  sleeping: 100 / 45,
};
/** A full stomach lasts about 15 minutes awake, and twice as long asleep. */
const HUNGER_RATE: Record<Activity, number> = {
  idle: -100 / 900,
  walking: -100 / 900,
  running: -100 / 600,
  sitting: -100 / 900,
  sleeping: -100 / 1800,
};

/** Below this a stat counts as low: the player slows down. */
export const LOW_STAT = 20;

const clamp = (value: number) => Math.min(100, Math.max(0, value));

export function tickStats(stats: Stats, activity: Activity, seconds: number): Stats {
  return {
    energy: clamp(stats.energy + ENERGY_RATE[activity] * seconds),
    hunger: clamp(stats.hunger + HUNGER_RATE[activity] * seconds),
  };
}

/** How fast a player moves: 1 normally, down to 0.6 when exhausted and starving. */
export function speedFactor(stats: Stats): number {
  const weakest = Math.min(stats.energy, stats.hunger);
  if (weakest >= LOW_STAT) return 1;
  return 0.6 + 0.4 * (weakest / LOW_STAT);
}

/** Things a player can hold. A meal is whatever was cooked last (see cooking.ts). */
export type Food = 'ingredients' | 'meal' | 'cake';
/** The cleaning tools: the broom sweeps up dry litter, the mop wipes up spills. */
export type Tool = 'broom' | 'mop';
export type Carried = Food | Tool;

export const isTool = (carried: Carried): carried is Tool => carried === 'broom' || carried === 'mop';

/** Slices in a birthday cake. When the last one is taken the cake is gone. */
export const CAKE_SLICES = 8;

/** Hunger restored by eating. Raw ingredients have to be cooked first; a meal's value depends on the dish. */
export const FOOD_VALUE: Record<Food, number> = { ingredients: 0, meal: 50, cake: 20 };

export const isEdible = (food: Food) => FOOD_VALUE[food] > 0;

export function eat(stats: Stats, food: Food, amount = FOOD_VALUE[food]): Stats {
  return { ...stats, hunger: clamp(stats.hunger + amount) };
}

/** The kinds of litter that turn up on the floors; each has a model in litter.glb (litter_<kind>). */
export const LITTER_KINDS = ['paper', 'can', 'peel', 'wrapper', 'crumbs', 'spill'] as const;
export type LitterKind = (typeof LITTER_KINDS)[number];

/** A room holds at most one piece of litter for about this much floor, in square metres (and at least two). */
const FLOOR_PER_LITTER = 9;
/** While someone is in a room, a new piece of litter turns up about this often, in seconds. */
const LITTER_SECONDS = 240;
/** While nobody is in a room it gathers litter much more slowly: one piece in about eight hours. */
const LITTER_SECONDS_AWAY = 8 * 3600;
/** The broom or mop cleans up litter this close to its head, in metres. */
export const SWEEP_REACH = 0.55;
/** Seconds of sweeping over a piece before it is gone. */
export const SWEEP_SECONDS = 0.7;

/** Which tool cleans up a kind of litter. */
export const toolFor = (kind: LitterKind): Tool => (kind === 'spill' ? 'mop' : 'broom');
/** The share of new litter that is a spill: more where there is food and water. */
export const spillChance = (zoneId: string) => (zoneId === 'kitchen' || zoneId === 'bathroom' ? 0.5 : 0.15);

export const litterCapacity = (area: number) => Math.max(2, Math.round(area / FLOOR_PER_LITTER));
/** How much of a new piece of litter builds up in a room over some seconds (1 is a whole piece). */
export const litterDue = (seconds: number, occupied: boolean) => seconds / (occupied ? LITTER_SECONDS : LITTER_SECONDS_AWAY);
