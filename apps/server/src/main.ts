/**
 * Starts the server: the API under /api and the game (Colyseus) under
 * /colyseus, on one port. In development Vite forwards both, so the browser
 * sees one address and the session cookie just works. In production this
 * process also serves the built game from apps/client/dist.
 *
 *   PORT          default 5181
 *   DATABASE_URL  a PostgreSQL server; without it PGlite keeps data in apps/server/data
 *   PGLITE_DIR    where PGlite keeps it instead (default data/pglite)
 *   NODE_ENV      "production" sends the cookie over HTTPS only and serves the game
 *   CLIENT_DIST   where the built game is, default ../client/dist
 *   LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET   voice chat, see voice.ts
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import fastifyStatic from '@fastify/static';
import { HOUSE_ROOM } from '@nongs/shared';
import { buildApp } from './app.js';
import { openDatabase } from './db.js';
import { HouseRoom, type HouseOptions } from './house.js';
import { voiceFromEnv } from './voice.js';

const port = Number(process.env.PORT ?? 5181);
const production = process.env.NODE_ENV === 'production';

const db = await openDatabase({ url: process.env.DATABASE_URL, dataDir: process.env.PGLITE_DIR });
const app = await buildApp({ db, secureCookies: production, logger: true, trustProxy: production });

const clientDist = resolve(process.env.CLIENT_DIST ?? '../client/dist');
if (production && existsSync(clientDist)) {
  await app.register(fastifyStatic, { root: clientDist, wildcard: false });
  // Everything that is not a file or the API is the game's page.
  app.setNotFoundHandler((request, reply) =>
    request.url.startsWith('/api') ? reply.code(404).send({ error: 'Not found.' }) : reply.sendFile('index.html'),
  );
}
await app.ready();

// The game shares the API's HTTP server: Colyseus answers its own paths and passes the rest on.
const voice = voiceFromEnv();
const game = new Server({ transport: new WebSocketTransport({ server: app.server }), greet: false });
const houseOptions: HouseOptions = { db, voice, allowTestBirthday: !production };
HouseRoom.database = db;
game.define(HOUSE_ROOM, HouseRoom, houseOptions);
if (!voice) app.log.info('Voice chat is off: LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are not set.');

await game.listen(port, production ? '0.0.0.0' : '127.0.0.1');
// There is one house, made now and kept open. Players join it; when it is full, joining fails.
await matchMaker.createRoom(HOUSE_ROOM, {});

const stop = async () => {
  await game.gracefullyShutdown(false);
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
