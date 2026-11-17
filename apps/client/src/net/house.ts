/**
 * The connection to the shared house on the game server. The server sends a
 * copy of the house's state (players, doors, locks, litter, furniture,
 * pictures, the cake) and keeps it up to date; this player's own moves go the
 * other way, `SEND_RATE` times a second. A dropped connection is picked up
 * again for a short while before the game gives up.
 */
import { Client, type Room } from 'colyseus.js';
import { GAME_PATH, HOUSE_ROOM, SEND_RATE, type ClientMessages, type Motion, type ServerMessages } from '@nongs/shared';

/** The close code the server uses when the same account logs in somewhere else. */
const REPLACED_CODE = 4001;
const RECONNECT_TRIES = 8;
const RECONNECT_WAIT_MS = 2000;

/** The part of a synced map the game reads. */
export interface Synced<V> {
  get(key: string): V | undefined;
  has(key: string): boolean;
  forEach(callback: (value: V, key: string) => void): void;
  readonly size: number;
}

/** Another player as the server has them. `anim` is '' until their first move arrives. */
export interface PlayerView extends Omit<Motion, 'anim' | 'swim' | 'carrying'> {
  name: string;
  /** Their look, as JSON. */
  look: string;
  anim: Motion['anim'] | '';
  swim: Motion['swim'];
  carrying: Motion['carrying'];
  zone: string;
  energy: number;
  hunger: number;
}

export interface LitterView {
  kind: string;
  zone: string;
  x: number;
  z: number;
  yaw: number;
}

export interface PlacementView {
  x: number;
  z: number;
  turns: number;
  y: number;
}

export interface HouseView {
  players: Synced<PlayerView>;
  doors: Synced<boolean>;
  locks: Synced<string>;
  litter: Synced<LitterView>;
  layout: Synced<PlacementView>;
  pictures: Synced<string>;
  birthday: string;
  cakeSlices: number;
  candlesLit: boolean;
}

type Handlers = { [K in keyof ServerMessages]?: (message: ServerMessages[K]) => void };

export class HouseLink {
  /** Called when the connection is gone for good, with what to tell the player. */
  onClosed: (message: string) => void = () => {};
  readonly handlers: Handlers = {};

  private sendIn = 0;
  private closed = false;

  private constructor(
    private readonly client: Client,
    private room: Room<HouseView>,
  ) {
    this.bind(room);
  }

  /**
   * Joins the house. Rejects with a message for the player when it is full or
   * the server cannot be reached. Waits for the first copy of the state.
   */
  static async join(options: { birthday: boolean }): Promise<HouseLink> {
    const client = new Client(`${location.origin}${GAME_PATH}`);
    let room: Room<HouseView>;
    try {
      room = await client.join<HouseView>(HOUSE_ROOM, options);
    } catch (error) {
      const text = String((error as { message?: unknown })?.message ?? error);
      if (/locked|full|no rooms/i.test(text)) throw new Error('The house is full: 16 Nongs are in. Try again in a little while.');
      if (/logged in/i.test(text)) throw new Error('Your session has ended. Log in again.');
      throw new Error('The game server cannot be reached right now. Try again in a little while.');
    }
    await new Promise<void>((resolve) => {
      if (room.state?.players) resolve();
      else room.onStateChange.once(() => resolve());
    });
    return new HouseLink(client, room);
  }

  get state(): HouseView {
    return this.room.state;
  }

  get sessionId(): string {
    return this.room.sessionId;
  }

  /** This player as the server has them. */
  get me(): PlayerView | undefined {
    return this.room.state.players.get(this.room.sessionId);
  }

  send<K extends keyof ClientMessages>(type: K, message: ClientMessages[K]): void {
    if (!this.closed) this.room.send(type, message);
  }

  /** Sends where this player is, at most `SEND_RATE` times a second. */
  sendMotion(motion: Motion, dt: number): void {
    this.sendIn -= dt;
    if (this.sendIn > 0) return;
    this.sendIn += 1 / SEND_RATE;
    if (this.sendIn < 0) this.sendIn = 0;
    this.send('move', motion);
  }

  leave(): void {
    this.closed = true;
    void this.room.leave(true);
  }

  private bind(room: Room<HouseView>): void {
    const names: (keyof ServerMessages)[] = ['react', 'knock', 'refused', 'correct', 'blown'];
    for (const name of names) {
      room.onMessage(name, (message: never) => (this.handlers[name] as ((message: never) => void) | undefined)?.(message));
    }
    room.onLeave((code) => {
      if (this.closed) return;
      if (code === REPLACED_CODE) {
        this.closed = true;
        this.onClosed('You joined the house from somewhere else, so this window has left it.');
        return;
      }
      void this.reconnect();
    });
  }

  /** Tries to come back as the same player after the connection dropped. */
  private async reconnect(): Promise<void> {
    const token = this.room.reconnectionToken;
    for (let tries = 0; tries < RECONNECT_TRIES; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_WAIT_MS));
      try {
        this.room = await this.client.reconnect<HouseView>(token);
        this.bind(this.room);
        return;
      } catch {
        // The server is still away; try again.
      }
    }
    this.closed = true;
    this.onClosed('The connection to the house was lost. Reload the page to come back in.');
  }
}
