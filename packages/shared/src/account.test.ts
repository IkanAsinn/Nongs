import { describe, expect, it } from 'vitest';
import { passwordProblem, usernameKey, usernameProblem } from './account.js';

describe('accounts', () => {
  it('take usernames of 3 to 16 letters, numbers and _', () => {
    expect(usernameProblem('nong_01')).toBeNull();
    expect(usernameProblem('ab')).not.toBeNull();
    expect(usernameProblem('a'.repeat(17))).not.toBeNull();
    expect(usernameProblem('no spaces')).not.toBeNull();
    expect(usernameProblem('émile')).not.toBeNull();
  });

  it('treat usernames the same in any case', () => {
    expect(usernameKey('NongNong')).toBe(usernameKey('nongnong'));
  });

  it('want passwords of at least 8 characters', () => {
    expect(passwordProblem('1234567')).not.toBeNull();
    expect(passwordProblem('12345678')).toBeNull();
    expect(passwordProblem('x'.repeat(129))).not.toBeNull();
  });
});
