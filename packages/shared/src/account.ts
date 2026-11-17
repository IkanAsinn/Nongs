/**
 * Account rules shared by the sign-in form and the server, so a player sees the
 * same message the server would give before anything is sent.
 */
import type { AvatarConfig } from './avatar.js';

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;
export const PASSWORD_MIN = 8;
/** Long enough for a passphrase, short enough that hashing it stays cheap. */
export const PASSWORD_MAX = 128;

/** Null when the username is fine, otherwise what is wrong with it. */
export function usernameProblem(username: string): string | null {
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return `Usernames are ${USERNAME_MIN} to ${USERNAME_MAX} characters long.`;
  }
  if (!/^[A-Za-z0-9_]+$/.test(username)) return 'Use only letters, numbers and _ in a username.';
  return null;
}

/** Null when the password is fine, otherwise what is wrong with it. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Passwords need at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Passwords are at most ${PASSWORD_MAX} characters.`;
  return null;
}

/** Usernames are unique without regard to case: "Nong" and "nong" are the same player. */
export const usernameKey = (username: string): string => username.toLowerCase();

/** What the server says about the signed-in player. */
export interface Account {
  username: string;
  /** "DD-MM-YYYY". */
  birthday: string;
  /** Null until the player has made their character, right after registering. */
  avatar: AvatarConfig | null;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest extends LoginRequest {
  /** "DD-MM-YYYY". */
  birthday: string;
}

/** Every failed request answers with this. */
export interface ApiError {
  error: string;
}
