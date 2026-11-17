import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_AVATAR } from '@nongs/shared';
import { SESSION_COOKIE, buildApp } from './app.js';
import { openDatabase, type Database } from './db.js';

let db: Database;
let app: FastifyInstance;

beforeAll(async () => {
  db = await openDatabase({ dataDir: 'memory://' });
  app = await buildApp({ db, secureCookies: false });
});

afterAll(async () => {
  await app.close();
  await db.close();
});

const post = (url: string, payload: unknown, cookie?: string) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers: cookie ? { cookie } : {} });
const sessionOf = (response: { cookies: { name: string; value: string }[] }) => {
  const found = response.cookies.find((c) => c.name === SESSION_COOKIE);
  return found ? `${SESSION_COOKIE}=${found.value}` : '';
};

describe('accounts', () => {
  let session = '';

  it('register with a username, password and birthday', async () => {
    const response = await post('/api/auth/register', { username: 'Nong_1', password: 'cozy-house', birthday: '17-11-2005' });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ username: 'Nong_1', birthday: '17-11-2005', avatar: null });
    session = sessionOf(response);
    expect(session).not.toBe('');
    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
  });

  it('keep usernames unique in any case', async () => {
    const response = await post('/api/auth/register', { username: 'nong_1', password: 'another-one', birthday: '01-01-2000' });
    expect(response.statusCode).toBe(409);
  });

  it('turn away bad usernames, passwords and birthdays', async () => {
    expect((await post('/api/auth/register', { username: 'a b', password: 'cozy-house', birthday: '01-01-2000' })).statusCode).toBe(400);
    expect((await post('/api/auth/register', { username: 'newbie', password: 'short', birthday: '01-01-2000' })).statusCode).toBe(400);
    expect((await post('/api/auth/register', { username: 'newbie', password: 'cozy-house', birthday: '31-02-2000' })).statusCode).toBe(400);
    expect((await post('/api/auth/register', { username: 'newbie' })).statusCode).toBe(400);
  });

  it('save the character and give it back', async () => {
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/me/avatar',
      payload: { avatar: { ...DEFAULT_AVATAR, hairColor: '#123456', extra: 'ignored' } },
      headers: { cookie: session },
    });
    expect(saved.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: session } });
    expect(me.json().avatar).toEqual({ ...DEFAULT_AVATAR, hairColor: '#123456' });
  });

  it('log in with the right password only', async () => {
    expect((await post('/api/auth/login', { username: 'NONG_1', password: 'wrong-password' })).statusCode).toBe(401);
    expect((await post('/api/auth/login', { username: 'nobody', password: 'cozy-house' })).statusCode).toBe(401);
    const response = await post('/api/auth/login', { username: 'NONG_1', password: 'cozy-house' });
    expect(response.statusCode).toBe(200);
    expect(response.json().username).toBe('Nong_1');
  });

  it('log out by ending the session', async () => {
    expect((await post('/api/auth/logout', {}, session)).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: session } })).statusCode).toBe(401);
  });

  it('slow down repeated log in tries', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await post('/api/auth/login', { username: 'x_' + i, password: 'whatever!' })).statusCode);
    expect(codes).toContain(429);
  });
});

describe('pictures', () => {
  // A house of its own: the log in limit above is used up.
  let pictureDb: Database;
  let pictureApp: FastifyInstance;
  let session = '';
  // A 2 × 2 red PNG.
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAwMDAxAADAA4AAf4MQx8AAAAASUVORK5CYII=';

  beforeAll(async () => {
    pictureDb = await openDatabase({ dataDir: 'memory://' });
    pictureApp = await buildApp({ db: pictureDb, secureCookies: false });
    const response = await pictureApp.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'Painter', password: 'cozy-house', birthday: '01-02-2003' },
    });
    session = sessionOf(response);
  });

  afterAll(async () => {
    await pictureApp.close();
    await pictureDb.close();
  });

  const put = (id: string, image: unknown, cookie = session) =>
    pictureApp.inject({ method: 'PUT', url: `/api/pictures/${id}`, payload: { image }, headers: cookie ? { cookie } : {} });

  it('go up, re-encoded as a JPEG, and come back', async () => {
    expect((await put('picture-1', PNG)).statusCode).toBe(200);
    const image = await pictureApp.inject({ method: 'GET', url: '/api/pictures/picture-1' });
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect([...image.rawPayload.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it('need an account, a real frame and a real picture', async () => {
    expect((await put('picture-1', PNG, '')).statusCode).toBe(401);
    expect((await put('sofa-1', PNG)).statusCode).toBe(404);
    expect((await put('picture-1', 'data:image/png;base64,bm90IGFuIGltYWdl')).statusCode).toBe(400);
    expect((await put('picture-1', 'https://example.com/a.png')).statusCode).toBe(400);
  });

  it('can be taken down by anyone in the house', async () => {
    const response = await pictureApp.inject({ method: 'DELETE', url: '/api/pictures/picture-1', headers: { cookie: session } });
    expect(response.statusCode).toBe(200);
    expect((await pictureApp.inject({ method: 'GET', url: '/api/pictures/picture-1' })).statusCode).toBe(404);
  });
});
