/**
 * Sessions: a random token in an httpOnly cookie, stored only as its SHA-256.
 * The API and the game server both use this to find out who is asking.
 */
import { createHash } from 'node:crypto';
import type { Database } from './db.js';

export const SESSION_COOKIE = 'nongs_session';

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** The signed-in user for a session token, or null. */
export async function userForToken(db: Database, token: string | undefined): Promise<number | null> {
  if (!token) return null;
  const rows = await db.query<{ user_id: number }>('select user_id from sessions where token_hash = $1 and expires_at > now()', [
    sha256(token),
  ]);
  return rows[0]?.user_id ?? null;
}

/** One cookie's value from a Cookie header. */
export function cookieFrom(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) {
      try {
        return decodeURIComponent(part.slice(at + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
