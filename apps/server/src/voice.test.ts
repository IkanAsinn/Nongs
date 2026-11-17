import { describe, expect, it } from 'vitest';
import { voiceFromEnv } from './voice.js';

const env = { LIVEKIT_URL: 'ws://localhost:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'a-secret-that-is-long-enough-for-hs256' };
const claims = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
    sub: string;
    video: { room: string; roomJoin: boolean; canPublish: boolean; canSubscribe: boolean };
  };

describe('voice tokens', () => {
  it('are off without LiveKit settings', () => {
    expect(voiceFromEnv({})).toBeNull();
  });

  it('let a player into their zone only', async () => {
    const voice = voiceFromEnv(env)!;
    const grant = await voice.grant('ana', 'kitchen', { muted: false, deafened: false, inPrivate: false });
    expect(grant?.room).toBe('nongs-kitchen');
    expect(claims(grant!.token).video).toMatchObject({ room: 'nongs-kitchen', roomJoin: true, canPublish: true, canSubscribe: true });
    expect(claims(grant!.token).sub).toBe('ana');
  });

  it('do not let a muted player speak', async () => {
    const grant = await voiceFromEnv(env)!.grant('ana', 'living', { muted: true, deafened: false, inPrivate: false });
    expect(claims(grant!.token).video.canPublish).toBe(false);
  });

  it('are not given in the bath or to a deafened player', async () => {
    const voice = voiceFromEnv(env)!;
    expect(await voice.grant('ana', 'bathroom', { muted: false, deafened: false, inPrivate: true })).toBeNull();
    expect(await voice.grant('ana', 'living', { muted: false, deafened: true, inPrivate: false })).toBeNull();
  });
});
