/** Calls to the game's HTTP API (apps/server). The session is an httpOnly cookie the browser sends by itself. */
import type { Account, AvatarConfig, LoginRequest, RegisterRequest } from '@nongs/shared';

/** A request the server turned down; `message` is meant for the player. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'The game server cannot be reached. Is it running?');
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    const fallback = response.status === 429 ? 'Too many tries. Wait a minute and try again.' : 'Something went wrong. Try again.';
    throw new ApiError(response.status, data.error ?? fallback);
  }
  return data;
}

export const api = {
  /** The signed-in account, or null when there is no session. */
  async me(): Promise<Account | null> {
    try {
      return await call<Account>('GET', '/me');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  login: (request: LoginRequest) => call<Account>('POST', '/auth/login', request),
  register: (request: RegisterRequest) => call<Account>('POST', '/auth/register', request),
  logout: () => call<{ ok: true }>('POST', '/auth/logout', {}),
  saveAvatar: (avatar: AvatarConfig) => call<{ avatar: AvatarConfig }>('PUT', '/me/avatar', { avatar }),
  /** Puts a picture (a data URL) in a frame for everybody. */
  putPicture: (pieceId: string, image: string) => call<{ version: string }>('PUT', `/pictures/${encodeURIComponent(pieceId)}`, { image }),
  removePicture: (pieceId: string) => call<{ ok: true }>('DELETE', `/pictures/${encodeURIComponent(pieceId)}`),
  /** Where a frame's picture is, by its version. */
  pictureUrl: (pieceId: string, version: string) => `/api/pictures/${encodeURIComponent(pieceId)}?v=${encodeURIComponent(version)}`,
  /** A voice token for the zone the server has this player in. */
  voiceToken: () => call<{ url: string; token: string; room: string; canPublish: boolean }>('POST', '/voice/token', {}),
};
