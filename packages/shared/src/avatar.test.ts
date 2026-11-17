import { describe, expect, it } from 'vitest';
import { DEFAULT_AVATAR, DEFAULT_HAIR, GENDERS, HAIR_FOR, sanitizeAvatar } from './avatar.js';

describe('avatar config', () => {
  it('keeps a valid config as it is', () => {
    const config = { ...DEFAULT_AVATAR, gender: 'male', hair: 'quiff', topPattern: 'stripes', shoes: 'none' } as const;
    expect(sanitizeAvatar(config)).toEqual(config);
  });

  it('falls back to the default look for anything that is not a config', () => {
    for (const junk of [null, undefined, 7, 'hello', []]) expect(sanitizeAvatar(junk)).toEqual(DEFAULT_AVATAR);
  });

  it('replaces unknown styles and broken colours field by field', () => {
    const fixed = sanitizeAvatar({ gender: 'male', hair: 'mohawk', topColor: 'red', bottomColor: '#ABCDEF', extra: 1 });
    expect(fixed.gender).toBe('male');
    expect(fixed.hair).toBe(DEFAULT_HAIR.male);
    expect(fixed.topColor).toBe(DEFAULT_AVATAR.topColor);
    expect(fixed.bottomColor).toBe('#abcdef');
    expect(fixed).not.toHaveProperty('extra');
  });

  it('gives each body only its own hair styles', () => {
    expect(sanitizeAvatar({ gender: 'male', hair: 'bob' }).hair).toBe(DEFAULT_HAIR.male);
    expect(sanitizeAvatar({ gender: 'female', hair: 'buzz' }).hair).toBe(DEFAULT_HAIR.female);
    for (const gender of GENDERS) {
      expect(HAIR_FOR[gender]).toContain(DEFAULT_HAIR[gender]);
      for (const hair of HAIR_FOR[gender]) expect(sanitizeAvatar({ gender, hair }).hair).toBe(hair);
    }
  });
});
