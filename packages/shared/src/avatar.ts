/**
 * What a character looks like: body, skin, hair and clothes. Players change
 * it at a wardrobe. The server will store one of these per account, so
 * anything that arrives from outside goes through `sanitizeAvatar` first.
 */

export const GENDERS = ['female', 'male'] as const;
export const HAIR_STYLES = ['none', 'short', 'bob', 'long', 'ponytail', 'buns', 'buzz', 'sidepart', 'quiff', 'curly'] as const;
export const TOP_STYLES = ['tshirt', 'tank', 'sweater'] as const;
export const TOP_PATTERNS = ['plain', 'stripes'] as const;
export const BOTTOM_STYLES = ['shorts', 'trousers'] as const;
export const SHOE_STYLES = ['none', 'sneakers', 'boots'] as const;
/** Worn on the head; the models come from tools/blender/build_accessories.py. */
export const HAT_STYLES = ['none', 'beanie', 'cap'] as const;
export const GLASSES_STYLES = ['none', 'round', 'square', 'sun'] as const;

export type Gender = (typeof GENDERS)[number];
export type HairStyle = (typeof HAIR_STYLES)[number];
export type TopStyle = (typeof TOP_STYLES)[number];
export type TopPattern = (typeof TOP_PATTERNS)[number];
export type BottomStyle = (typeof BOTTOM_STYLES)[number];
export type ShoeStyle = (typeof SHOE_STYLES)[number];
export type HatStyle = (typeof HAT_STYLES)[number];
export type GlassesStyle = (typeof GLASSES_STYLES)[number];

/** The hair styles each body can have, in the order the wardrobe shows them. */
export const HAIR_FOR: Record<Gender, readonly HairStyle[]> = {
  female: ['none', 'short', 'bob', 'long', 'ponytail', 'buns'],
  male: ['none', 'buzz', 'short', 'sidepart', 'quiff', 'curly'],
};
/** The style a body gets when it has none, or one that belongs to the other body. */
export const DEFAULT_HAIR: Record<Gender, HairStyle> = { female: 'bob', male: 'short' };

/** Colours the wardrobe offers. A config may hold any `#rrggbb` colour. */
export const SKIN_TONES = ['#ffe9dc', '#f6cfb4', '#e2a983', '#bd8660', '#8a5a3f', '#5e3c2a'] as const;
export const HAIR_COLORS = ['#2b1a10', '#5a3a22', '#8c5a2e', '#c98a3c', '#e9cf8a', '#b8433a', '#e88fb0', '#6d7fd1', '#ececec'] as const;
export const CLOTHING_COLORS = [
  '#f4f1ea', '#3b3f4a', '#e85d75', '#f2994a', '#f2c94c', '#7fb069',
  '#4fa3a5', '#5b7fd1', '#9b6fd1', '#e8a3c0', '#8a6a4f', '#3b4a6b',
] as const;

export interface AvatarConfig {
  gender: Gender;
  skin: string;
  hair: HairStyle;
  hairColor: string;
  top: TopStyle;
  topColor: string;
  topPattern: TopPattern;
  bottom: BottomStyle;
  bottomColor: string;
  shoes: ShoeStyle;
  shoesColor: string;
  hat: HatStyle;
  hatColor: string;
  glasses: GlassesStyle;
}

export const DEFAULT_AVATAR: AvatarConfig = {
  gender: 'female',
  skin: '#f6cfb4',
  hair: 'bob',
  hairColor: '#5a3a22',
  top: 'tshirt',
  topColor: '#e85d75',
  topPattern: 'plain',
  bottom: 'shorts',
  bottomColor: '#3b4a6b',
  shoes: 'sneakers',
  shoesColor: '#f4f1ea',
  hat: 'none',
  hatColor: '#e85d75',
  glasses: 'none',
};

const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** A valid config made from anything: unknown or broken fields fall back to the default look. */
export function sanitizeAvatar(input: unknown): AvatarConfig {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const base = DEFAULT_AVATAR;
  const color = (value: unknown, fallback: string) => (isColor(value) ? value.toLowerCase() : fallback);
  const gender = oneOf(raw.gender, GENDERS, base.gender);
  return {
    gender,
    skin: color(raw.skin, base.skin),
    hair: oneOf(raw.hair, HAIR_FOR[gender], DEFAULT_HAIR[gender]),
    hairColor: color(raw.hairColor, base.hairColor),
    top: oneOf(raw.top, TOP_STYLES, base.top),
    topColor: color(raw.topColor, base.topColor),
    topPattern: oneOf(raw.topPattern, TOP_PATTERNS, base.topPattern),
    bottom: oneOf(raw.bottom, BOTTOM_STYLES, base.bottom),
    bottomColor: color(raw.bottomColor, base.bottomColor),
    shoes: oneOf(raw.shoes, SHOE_STYLES, base.shoes),
    shoesColor: color(raw.shoesColor, base.shoesColor),
    hat: oneOf(raw.hat, HAT_STYLES, base.hat),
    hatColor: color(raw.hatColor, base.hatColor),
    glasses: oneOf(raw.glasses, GLASSES_STYLES, base.glasses),
  };
}
