/**
 * Voice chat through LiveKit: one LiveKit room per zone of the house. The
 * server hands a player a token only for the zone it knows they stand in, and
 * removes them from a zone's room when they leave it or get into the bath, so
 * nobody receives audio they are not allowed to hear, whatever their browser
 * does.
 *
 *   LIVEKIT_URL         the address browsers connect to, e.g. wss://voice.example.com
 *   LIVEKIT_API_KEY     the key and secret given to LiveKit (LIVEKIT_KEYS in deploy/docker-compose.yml)
 *   LIVEKIT_API_SECRET
 *
 * Without these, voice is simply off and the game says so.
 */
import { canHear, canSpeak, voiceRoomFor, type Voice } from '@nongs/shared';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

/** A token only lets its holder in for this long; after that they need a new one. */
const TOKEN_SECONDS = 120;

export interface VoiceGrant {
  url: string;
  token: string;
  room: string;
  canPublish: boolean;
}

export interface VoiceService {
  /** A token for the zone's room, or null when this player may not listen there now. */
  grant(identity: string, zoneId: string, voice: Voice): Promise<VoiceGrant | null>;
  /** Takes a player out of a zone's room. Errors are swallowed: they may not have joined it. */
  evict(identity: string, zoneId: string): Promise<void>;
}

export function voiceFromEnv(env: NodeJS.ProcessEnv = process.env): VoiceService | null {
  const url = env.LIVEKIT_URL;
  const key = env.LIVEKIT_API_KEY;
  const secret = env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) return null;
  // The room service talks HTTP to the same server the browsers reach over WebSocket.
  const rooms = new RoomServiceClient(url.replace(/^ws/, 'http'), key, secret);
  return {
    async grant(identity, zoneId, voice) {
      if (!canHear(voice)) return null;
      const room = voiceRoomFor(zoneId);
      const token = new AccessToken(key, secret, { identity, name: identity, ttl: TOKEN_SECONDS });
      const canPublish = canSpeak(voice);
      token.addGrant({ roomJoin: true, room, canPublish, canSubscribe: true, canPublishData: false });
      return { url, token: await token.toJwt(), room, canPublish };
    },
    async evict(identity, zoneId) {
      await rooms.removeParticipant(voiceRoomFor(zoneId), identity).catch(() => undefined);
    },
  };
}
