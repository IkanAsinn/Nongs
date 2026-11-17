/** What a player can do with each kind of furniture. */
import type { FurnitureModelId } from './furniture.js';

export type UseKind = 'sleep' | 'sit' | 'bathe' | 'fridge' | 'counter' | 'stove' | 'broom' | 'mop' | 'cake' | 'wardrobe' | 'picture';

/** A place on a piece where a body rests, relative to the piece's centre. */
export interface Spot {
  /** To the piece's left as you face its front. */
  side: number;
  /** Out of the piece's front. */
  front: number;
  /** Height of the surface the body rests on. */
  height: number;
  /** True on a deep seat: the body sits back with the legs out along the cushion. */
  lounge?: boolean;
  /** Lying back: how far the upper body leans back from sitting up, in radians. */
  recline?: number;
  /** Which way the body faces, as an angle from the piece's front. Left out, it faces the front. */
  turn?: number;
}

export interface Use {
  kind: UseKind;
  /** Where to sit or lie; the nearest one to the player is taken. */
  spots?: readonly Spot[];
}

/*
 * The characters are 1.4 m tall with short legs, and the furniture is a
 * quarter larger than full size. On a chair the spot is near the front edge: the hips are about 0.2 m
 * behind it, so the knees clear the edge and the shins hang in front. A sofa
 * is too deep for that, so there the body sits back with its legs out.
 */
export const USES: Partial<Record<FurnitureModelId, Use>> = {
  prop_bed: { kind: 'sleep', spots: [{ side: 0, front: 0.125, height: 0.725 }] },
  prop_chair: { kind: 'sit', spots: [{ side: 0, front: 0.11, height: 0.55 }] },
  prop_armchair: { kind: 'sit', spots: [{ side: 0, front: 0, height: 0.625, lounge: true }] },
  prop_sofa: {
    kind: 'sit',
    spots: [
      { side: -0.44, front: 0, height: 0.625, lounge: true },
      { side: 0.44, front: 0, height: 0.625, lounge: true },
    ],
  },
  // On a sun lounger the body lies back along the raised end (35° up) with its legs out along the cushion.
  prop_lounger: { kind: 'sit', spots: [{ side: 0, front: -0.2, height: 0.46, lounge: true, recline: 1.0 }] },
  prop_toilet: { kind: 'sit', spots: [{ side: 0, front: 0.2, height: 0.525 }] },
  // The taps are at the back of the tub, so the bather leans on the front end and faces them.
  prop_bathtub: { kind: 'bathe', spots: [{ side: 0, front: 0.525, height: 0.23, lounge: true, turn: Math.PI }] },
  prop_fridge: { kind: 'fridge' },
  prop_counter: { kind: 'counter' },
  prop_stove: { kind: 'stove' },
  prop_broom: { kind: 'broom' },
  prop_mop: { kind: 'mop' },
  prop_cake: { kind: 'cake' },
  prop_wardrobe: { kind: 'wardrobe' },
  prop_picture: { kind: 'picture' },
};

/** How close a player must be to a piece to use it, in metres from its edge. */
export const USE_REACH = 0.9;
