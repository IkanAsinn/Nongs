/**
 * The HTTP API: register, log in, log out, who am I, and save my character.
 *
 * Passwords are hashed with argon2id. A session is a random token in an
 * httpOnly cookie; the database keeps only its SHA-256, so a leaked table does
 * not let anyone in.
 */
import { randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { hash, verify } from '@node-rs/argon2';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import sharp from 'sharp';
import {
  FURNITURE,
  formatBirthday,
  parseBirthday,
  passwordProblem,
  sanitizeAvatar,
  usernameKey,
  usernameProblem,
  type Account,
  type AvatarConfig,
} from '@nongs/shared';
import type { Database } from './db.js';
import { houses } from './house.js';
import { SESSION_COOKIE, sha256, userForToken } from './sessions.js';

export { SESSION_COOKIE };
const SESSION_DAYS = 30;
/** Tries per address per minute on log in and register. */
const AUTH_TRIES_PER_MINUTE = 10;
/** argon2id, as OWASP suggests: 19 MiB, 2 passes. */
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
/** A player's own picture is stored at the frame's size, as a JPEG. */
const PICTURE = { width: 512, height: 364, quality: 82 } as const;
/** The largest picture upload taken, as a data URL. The browser shrinks pictures before sending them. */
const PICTURE_UPLOAD_BYTES = 2 * 1024 * 1024;
const PICTURE_FRAMES = new Set(FURNITURE.filter((piece) => piece.model === 'prop_picture').map((piece) => piece.id));

export interface AppOptions {
  db: Database;
  /** Send the cookie only over HTTPS. On in production. */
  secureCookies: boolean;
  logger?: boolean;
  /** Behind a proxy (Traefik), take the client's address from X-Forwarded-For, so each player has their own log in limit. */
  trustProxy?: boolean;
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  birthday: string;
}

export async function buildApp({ db, secureCookies, logger = false, trustProxy = false }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger, bodyLimit: 16 * 1024, trustProxy });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  const authLimit = { rateLimit: { max: AUTH_TRIES_PER_MINUTE, timeWindow: '1 minute' } };

  /** A hash to check against when the username does not exist, so a wrong name takes as long as a wrong password. */
  const decoy = await hash('not a real password', ARGON);

  const startSession = async (reply: FastifyReply, userId: number) => {
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await db.query('insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)', [sha256(token), userId, expires]);
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      expires,
    });
  };

  /** The signed-in user, or null. */
  const sessionUser = (request: FastifyRequest): Promise<number | null> => userForToken(db, request.cookies[SESSION_COOKIE]);

  const account = async (userId: number): Promise<Account> => {
    const [user] = await db.query<{ username: string; birthday: string; config: AvatarConfig | null }>(
      `select u.username, to_char(u.birthday, 'DD-MM-YYYY') as birthday, a.config
       from users u left join avatars a on a.user_id = u.id where u.id = $1`,
      [userId],
    );
    if (!user) throw new Error(`user ${userId} has a session but no row`);
    return { username: user.username, birthday: user.birthday, avatar: user.config ? sanitizeAvatar(user.config) : null };
  };

  app.post('/api/auth/register', { config: authLimit }, async (request, reply) => {
    const body = fields(request.body, ['username', 'password', 'birthday']);
    if (!body) return fail(reply, 400, 'Fill in a username, a password and your birthday.');
    const problem = usernameProblem(body.username) ?? passwordProblem(body.password);
    if (problem) return fail(reply, 400, problem);
    const birthday = parseBirthday(body.birthday);
    if (!birthday) return fail(reply, 400, 'Write your birthday as DD-MM-YYYY, for example 17-11-2005.');
    const iso = `${birthday.year}-${pad(birthday.month)}-${pad(birthday.day)}`;
    const passwordHash = await hash(body.password, ARGON);
    const [created] = await db.query<{ id: number }>(
      `insert into users (username, username_key, password_hash, birthday) values ($1, $2, $3, $4)
       on conflict (username_key) do nothing returning id`,
      [body.username, usernameKey(body.username), passwordHash, iso],
    );
    if (!created) return fail(reply, 409, 'That username is taken. Try another one.');
    await startSession(reply, created.id);
    return reply.code(201).send({ ...(await account(created.id)), birthday: formatBirthday(birthday) });
  });

  app.post('/api/auth/login', { config: authLimit }, async (request, reply) => {
    const body = fields(request.body, ['username', 'password']);
    if (!body) return fail(reply, 400, 'Fill in your username and password.');
    const [user] = await db.query<UserRow>('select id, password_hash from users where username_key = $1', [
      usernameKey(body.username),
    ]);
    const matches = await verify(user?.password_hash ?? decoy, body.password).catch(() => false);
    if (!user || !matches) return fail(reply, 401, 'That username and password do not match.');
    await startSession(reply, user.id);
    return account(user.id);
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await db.query('delete from sessions where token_hash = $1', [sha256(token)]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/me', async (request, reply) => {
    const userId = await sessionUser(request);
    if (userId === null) return fail(reply, 401, 'Not logged in.');
    return account(userId);
  });

  app.put('/api/me/avatar', async (request, reply) => {
    const userId = await sessionUser(request);
    if (userId === null) return fail(reply, 401, 'Not logged in.');
    const config = sanitizeAvatar((request.body as { avatar?: unknown } | null)?.avatar);
    await db.query(
      `insert into avatars (user_id, config) values ($1, $2)
       on conflict (user_id) do update set config = excluded.config, updated_at = now()`,
      [userId, JSON.stringify(config)],
    );
    return { avatar: config };
  });

  // ---- pictures in the frames: one per frame, for everybody ----

  app.get<{ Params: { id: string } }>('/api/pictures/:id', async (request, reply) => {
    const [row] = await db.query<{ image: Uint8Array }>('select image from pictures where piece_id = $1', [request.params.id]);
    if (!row) return fail(reply, 404, 'No picture in that frame.');
    // The address carries the version, so a picture never changes under it.
    return reply.type('image/jpeg').header('cache-control', 'public, max-age=31536000, immutable').send(Buffer.from(row.image));
  });

  app.put<{ Params: { id: string } }>('/api/pictures/:id', { bodyLimit: PICTURE_UPLOAD_BYTES }, async (request, reply) => {
    const userId = await sessionUser(request);
    if (userId === null) return fail(reply, 401, 'Not logged in.');
    if (!PICTURE_FRAMES.has(request.params.id)) return fail(reply, 404, 'There is no picture frame like that.');
    const image = (request.body as { image?: unknown } | null)?.image;
    const match = typeof image === 'string' ? /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image) : null;
    if (!match) return fail(reply, 400, 'Send the picture as a JPEG, PNG or WebP data URL.');
    // Decoded and written out again, so only plain pixels are kept: no metadata, nothing hidden.
    let jpeg: Buffer;
    try {
      jpeg = await sharp(Buffer.from(match[1]!, 'base64'), { limitInputPixels: 4096 * 4096 })
        .rotate()
        .resize(PICTURE.width, PICTURE.height, { fit: 'cover' })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: PICTURE.quality, mozjpeg: true })
        .toBuffer();
    } catch {
      return fail(reply, 400, 'That file could not be read as a picture.');
    }
    const [saved] = await db.query<{ version: string }>(
      `insert into pictures (piece_id, image, placed_by) values ($1, $2, $3)
       on conflict (piece_id) do update set image = excluded.image, placed_by = excluded.placed_by, updated_at = now()
       returning (extract(epoch from updated_at) * 1000)::bigint::text as version`,
      [request.params.id, jpeg, userId],
    );
    houses.current?.pictureChanged(request.params.id, saved!.version);
    return { version: saved!.version };
  });

  // Anyone in the house can take a picture down, so a bad one does not stay up.
  app.delete<{ Params: { id: string } }>('/api/pictures/:id', async (request, reply) => {
    const userId = await sessionUser(request);
    if (userId === null) return fail(reply, 401, 'Not logged in.');
    await db.query('delete from pictures where piece_id = $1', [request.params.id]);
    houses.current?.pictureChanged(request.params.id, null);
    return { ok: true };
  });

  // ---- voice: a token for the zone the server has this player in ----

  app.post('/api/voice/token', async (request, reply) => {
    const userId = await sessionUser(request);
    if (userId === null) return fail(reply, 401, 'Not logged in.');
    const house = houses.current;
    if (!house?.hasVoice) return fail(reply, 503, 'Voice chat is not set up on this server.');
    const grant = await house.voiceFor(userId);
    if (!grant) return fail(reply, 403, 'No voice here.');
    return grant;
  });

  return app;
}

const pad = (n: number) => String(n).padStart(2, '0');

function fail(reply: FastifyReply, code: number, error: string) {
  return reply.code(code).send({ error });
}

/** The named string fields of a JSON body, trimmed except the password; null when one is missing. */
function fields<K extends string>(body: unknown, keys: readonly K[]): Record<K, string> | null {
  if (typeof body !== 'object' || body === null) return null;
  const out = {} as Record<K, string>;
  for (const key of keys) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value !== 'string' || value.trim() === '') return null;
    out[key] = key === 'password' ? value : value.trim();
  }
  return out;
}
