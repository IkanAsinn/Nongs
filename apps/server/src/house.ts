/**
 * The house: one Colyseus room that everybody shares, up to 16 players.
 *
 * The server owns what everyone must see the same way and checks every
 * request with the rules in @nongs/shared: where each player is (no running
 * through walls of a locked room, no teleporting), doors and locks, the
 * litter, the birthday cake, the furniture, the pictures, and each player's
 * energy and hunger, which are kept while they are away.
 */
import { Room, type AuthContext, type Client } from '@colyseus/core';
import { schema, type SchemaType } from '@colyseus/schema';
import {
  BIRTHDAY_CAKE,
  CAKE_SLICES,
  DOORS,
  FOOD_VALUE,
  FULL_STATS,
  FURNITURE,
  GESTURE_NAMES,
  LITTER_ZONES,
  MAX_PLAYERS,
  REACH,
  RECIPES,
  carried,
  canStore,
  checkPlacement,
  isStored,
  STORAGE,
  dishHunger,
  doorBlockedBy,
  doorChoices,
  eat,
  isBirthday,
  isMovable,
  layoutWith,
  litterDue,
  locksAfterLeaving,
  moveProblem,
  parseBirthday,
  placeLitter,
  readMotion,
  ridersOf,
  sanitizeAvatar,
  tickStats,
  toolFor,
  zoneAt,
  type Activity,
  type Furniture,
  type LitterPiece,
  type Motion,
  type Stats,
  type Voice,
} from '@nongs/shared';
import type { Database } from './db.js';
import { SESSION_COOKIE, cookieFrom, userForToken } from './sessions.js';
import type { VoiceService } from './voice.js';

// ---- the state every browser gets a copy of ----

export const PlayerState = schema(
  {
    name: 'string',
    look: 'string',
    x: 'number',
    y: 'number',
    z: 'number',
    facing: 'number',
    anim: 'string',
    speed: 'number',
    recline: 'number',
    swim: 'string',
    bare: 'boolean',
    carrying: 'string',
    muted: 'boolean',
    deafened: 'boolean',
    inPrivate: 'boolean',
    zone: 'string',
    energy: 'number',
    hunger: 'number',
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const LitterState = schema({ kind: 'string', zone: 'string', x: 'number', z: 'number', yaw: 'number' }, 'LitterState');
export type LitterState = SchemaType<typeof LitterState>;

export const PlacementState = schema({ x: 'number', z: 'number', turns: 'number', y: 'number' }, 'PlacementState');
export type PlacementState = SchemaType<typeof PlacementState>;

export const HouseState = schema(
  {
    players: { map: PlayerState },
    /** Open doors are true. */
    doors: { map: 'boolean' },
    /** Who locked each locked door, by door id. */
    locks: { map: 'string' },
    litter: { map: LitterState },
    /** Furniture moved from where the house was built with it, by piece id. */
    layout: { map: PlacementState },
    /** A version for each picture frame with a player's own picture in it, by piece id. */
    pictures: { map: 'string' },
    /** The names of the players in the house whose birthday it is today, or ''. */
    birthday: 'string',
    cakeSlices: 'number',
    candlesLit: 'boolean',
  },
  'HouseState',
);
export type HouseState = SchemaType<typeof HouseState>;

// ---- what only the server keeps ----

interface Member {
  userId: number;
  username: string;
  birthdayToday: boolean;
  /** When the last move came in, in ms. */
  movedAt: number;
  stats: Stats;
  /** The voice zone they were last given a token for. */
  voiceZone: string | null;
  /** Closed because the same account logged in again: no coming back on this connection. */
  replaced?: boolean;
}

interface CakeDay {
  day: string;
  slices: number;
  lit: boolean;
}

export interface HouseOptions {
  db: Database;
  voice: VoiceService | null;
  /** Lets ?birthday in a browser start the birthday, for trying it out. Off in production. */
  allowTestBirthday: boolean;
}

/** Litter, stats and locks are worked out this often, in ms. */
const TICK_MS = 1000;
/** The house and everyone's stats are written to the database this often, in ms. */
const SAVE_MS = 30_000;
/** A new log in closes the older connection of the same account with this code. */
export const REPLACED_CODE = 4001;
const HOUSE_ROW = 1;
const RECONNECT_SECONDS = 20;

const activityFor = (anim: string): Activity => {
  switch (anim) {
    case 'walk':
    case 'jump':
      return 'walking';
    case 'run':
      return 'running';
    case 'sit':
    case 'lounge':
      return 'sitting';
    case 'sleep':
      return 'sleeping';
    default:
      return 'idle';
  }
};

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
const quarter = (turns: number) => ((Math.round(turns) % 4) + 4) % 4;
const near = (a: { x: number; z: number }, b: { x: number; z: number }, reach = REACH) => Math.hypot(a.x - b.x, a.z - b.z) <= reach;

/** The house that is open now, so the HTTP routes can reach it. */
export const houses: { current: HouseRoom | null } = { current: null };

export class HouseRoom extends Room<HouseState, Member, Member> {
  maxClients = MAX_PLAYERS;
  autoDispose = false;

  private db!: Database;
  private voice: VoiceService | null = null;
  private allowTestBirthday = false;
  /** The furniture as it stands now, for the placement and litter rules. */
  private pieces: Furniture[] = [];
  private readonly litterProgress = new Map<string, number>();
  private nextLitter = 1;
  private cake: CakeDay | null = null;

  async onCreate(options: HouseOptions): Promise<void> {
    this.db = options.db;
    this.voice = options.voice;
    this.allowTestBirthday = options.allowTestBirthday;
    this.setState(new HouseState());
    this.state.cakeSlices = 0;
    this.state.candlesLit = false;
    this.state.birthday = '';
    for (const door of DOORS) this.state.doors.set(door.id, false);
    await this.load();
    houses.current = this;

    this.onMessage('move', (client, raw) => this.move(client, raw));
    this.onMessage('react', (client, raw: { name?: unknown }) => {
      if (!GESTURE_NAMES.includes(raw?.name as (typeof GESTURE_NAMES)[number])) return;
      this.broadcast('react', { sessionId: client.sessionId, name: raw.name }, { except: client });
    });
    this.onMessage('door', (client, raw: { id?: unknown; open?: unknown }) => this.door(client, raw));
    this.onMessage('lock', (client, raw: { id?: unknown; locked?: unknown }) => this.lockDoor(client, raw));
    this.onMessage('knock', (client, raw: { id?: unknown }) => this.knock(client, raw));
    this.onMessage('swept', (client, raw: { id?: unknown }) => this.swept(client, raw));
    this.onMessage('slice', (client) => this.slice(client));
    this.onMessage('blow', (client) => this.blow(client));
    this.onMessage('eat', (client, raw: { food?: unknown; recipe?: unknown; rating?: unknown }) => this.eaten(client, raw));
    this.onMessage('place', (client, raw: Record<string, unknown>) => void this.place(client, raw));
    this.onMessage('store', (client, raw: Record<string, unknown>) => void this.store(client, raw));
    this.onMessage('look', (client) => void this.lookChanged(client));

    this.clock.setInterval(() => this.tick(TICK_MS / 1000), TICK_MS);
    this.clock.setInterval(() => void this.save(), SAVE_MS);
  }

  /** The database for `onAuth`, which runs before there is a room instance. Set once at start-up. */
  static database: Database | null = null;

  /**
   * Checks the session cookie while matchmaking, before a seat is kept, so
   * nobody without an account can take one of the 16 places.
   */
  static async onAuth(_token: string, _options: unknown, context: AuthContext): Promise<Member> {
    const db = HouseRoom.database;
    if (!db) throw new Error('The house is not open yet.');
    const userId = await userForToken(db, cookieFrom(context.headers.cookie, SESSION_COOKIE));
    if (userId === null) throw new Error('Not logged in.');
    const [user] = await db.query<{ username: string; birthday: string }>(
      `select username, to_char(birthday, 'DD-MM-YYYY') as birthday from users where id = $1`,
      [userId],
    );
    if (!user) throw new Error('Not logged in.');
    const [saved] = await db.query<{ energy: number; hunger: number }>('select energy, hunger from player_stats where user_id = $1', [userId]);
    return {
      userId,
      username: user.username,
      birthdayToday: isBirthday(parseBirthday(user.birthday), new Date()),
      movedAt: Date.now(),
      // Stats stand still while a player is away.
      stats: saved ? { energy: saved.energy, hunger: saved.hunger } : { ...FULL_STATS },
      voiceZone: null,
    };
  }

  async onJoin(client: Client<Member, Member>, options: { birthday?: unknown } | undefined, auth: Member): Promise<void> {
    const member: Member = { ...auth, birthdayToday: auth.birthdayToday || (this.allowTestBirthday && options?.birthday === true) };
    // One connection per account: a new log in replaces the older one, and carries on with its stats.
    for (const other of this.clients) {
      if (other !== client && other.userData?.userId === auth.userId) {
        member.stats = { ...other.userData.stats };
        other.userData.replaced = true;
        other.leave(REPLACED_CODE);
      }
    }
    client.userData = member;

    const [avatar] = await this.db.query<{ config: unknown }>('select config from avatars where user_id = $1', [auth.userId]);
    const player = new PlayerState();
    Object.assign(player, {
      name: auth.username,
      look: JSON.stringify(sanitizeAvatar(avatar?.config ?? null)),
      x: 0,
      y: 0,
      z: 0,
      facing: 0,
      anim: 'idle',
      speed: 0,
      recline: 0,
      swim: '',
      bare: false,
      carrying: '',
      muted: false,
      deafened: false,
      inPrivate: false,
      zone: '',
      energy: member.stats.energy,
      hunger: member.stats.hunger,
    });
    // Nobody is placed until their first move arrives; until then they are not drawn.
    player.anim = '';
    this.state.players.set(client.sessionId, player);
    this.updateBirthday();
  }

  async onLeave(client: Client<Member, Member>, consented: boolean): Promise<void> {
    const member = client.userData;
    // A dropped connection (a train tunnel, a laptop lid) gets a moment to come back as the same player.
    if (!consented && member && !member.replaced) {
      try {
        await this.allowReconnection(client, RECONNECT_SECONDS);
        return;
      } catch {
        // Not back in time: they leave as usual.
      }
    }
    // Their locks go on the next tick, once the room is seen to be empty.
    this.state.players.delete(client.sessionId);
    if (member) {
      await this.saveStats(member);
      if (member.voiceZone) await this.voice?.evict(member.username, member.voiceZone);
    }
    this.updateBirthday();
  }

  async onDispose(): Promise<void> {
    await this.save();
    if (houses.current === this) houses.current = null;
  }

  // ---- for the HTTP routes ----

  get hasVoice(): boolean {
    return this.voice !== null;
  }

  /** The connected player of an account, for voice tokens. */
  memberOf(userId: number): { member: Member; player: PlayerState } | null {
    for (const client of this.clients) {
      const member = client.userData;
      const player = this.state.players.get(client.sessionId);
      if (member?.userId === userId && player) return { member, player };
    }
    return null;
  }

  /** A picture frame now shows a new picture, or none (version null). */
  pictureChanged(pieceId: string, version: string | null): void {
    if (version === null) this.state.pictures.delete(pieceId);
    else this.state.pictures.set(pieceId, version);
  }

  // ---- what players do ----

  private move(client: Client<Member, Member>, raw: unknown): void {
    const member = client.userData;
    const player = this.state.players.get(client.sessionId);
    const motion = readMotion(raw);
    if (!member || !player || !motion) return;
    const now = Date.now();
    const placed = player.anim !== '';
    if (placed) {
      const problem = moveProblem(player, motion, (now - member.movedAt) / 1000, this.lockedZones(player.name));
      if (problem) {
        client.send('correct', { x: player.x, y: player.y, z: player.z });
        return;
      }
    }
    member.movedAt = now;
    const zone = zoneAt(motion.x, motion.z)?.id ?? '';
    Object.assign(player, motion satisfies Motion, { zone });
    // Leaving a zone, or getting into the bath, ends that zone's voice for them.
    if (member.voiceZone && (member.voiceZone !== zone || motion.inPrivate || motion.deafened)) {
      const left = member.voiceZone;
      member.voiceZone = null;
      void this.voice?.evict(member.username, left);
    }
  }

  /** Grants a voice token for the zone the server has this player in. */
  async voiceFor(userId: number) {
    const found = this.memberOf(userId);
    if (!found || !this.voice || !found.player.zone) return null;
    const voice: Voice = { muted: found.player.muted, deafened: found.player.deafened, inPrivate: found.player.inPrivate };
    const grant = await this.voice.grant(found.member.username, found.player.zone, voice);
    if (grant) found.member.voiceZone = found.player.zone;
    return grant;
  }

  private door(client: Client<Member, Member>, raw: { id?: unknown; open?: unknown }): void {
    const player = this.state.players.get(client.sessionId);
    const door = DOORS.find((each) => each.id === raw?.id);
    if (!player || !door || typeof raw.open !== 'boolean' || !near(player, door)) return;
    const isOpen = this.state.doors.get(door.id) ?? false;
    if (raw.open === isOpen) return;
    const locked = this.state.locks.has(door.id);
    const choices = doorChoices(door, { isOpen, locked, inside: player.zone === door.zoneId });
    if (choices.use === 'knock') {
      client.send('refused', { message: 'That door is locked.' });
      return;
    }
    // A door does not shut on anybody standing in the doorway.
    if (!raw.open) {
      for (const other of this.state.players.values()) {
        if (other.anim !== '' && doorBlockedBy(door, other.x, other.z)) return;
      }
    }
    // Opening from inside unlocks the door first.
    if (raw.open && locked) this.state.locks.delete(door.id);
    this.state.doors.set(door.id, raw.open);
  }

  private lockDoor(client: Client<Member, Member>, raw: { id?: unknown; locked?: unknown }): void {
    const player = this.state.players.get(client.sessionId);
    const door = DOORS.find((each) => each.id === raw?.id);
    if (!player || !door || typeof raw.locked !== 'boolean' || !near(player, door)) return;
    const choices = doorChoices(door, {
      isOpen: this.state.doors.get(door.id) ?? false,
      locked: this.state.locks.has(door.id),
      inside: player.zone === door.zoneId,
    });
    if (raw.locked && choices.lock === 'lock') this.state.locks.set(door.id, player.name);
    else if (!raw.locked && choices.lock === 'unlock') this.state.locks.delete(door.id);
  }

  private knock(client: Client<Member, Member>, raw: { id?: unknown }): void {
    const player = this.state.players.get(client.sessionId);
    const door = DOORS.find((each) => each.id === raw?.id);
    if (!player || !door || !near(player, door) || !this.state.locks.has(door.id)) return;
    for (const other of this.clients) {
      if (this.state.players.get(other.sessionId)?.zone === door.zoneId) other.send('knock', { id: door.id, by: player.name });
    }
  }

  private swept(client: Client<Member, Member>, raw: { id?: unknown }): void {
    const player = this.state.players.get(client.sessionId);
    const id = typeof raw?.id === 'string' ? raw.id : '';
    const piece = this.state.litter.get(id);
    if (!player || !piece) return;
    const kind = piece.kind as LitterPiece['kind'];
    if (piece.zone !== player.zone || !near(player, piece) || player.carrying !== toolFor(kind)) return;
    this.state.litter.delete(id);
  }

  private slice(client: Client<Member, Member>): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !this.state.birthday || !this.cake || !near(player, BIRTHDAY_CAKE)) return;
    if (this.cake.lit) {
      client.send('refused', { message: 'Blow out the candles first.' });
      return;
    }
    if (this.cake.slices <= 0) return;
    this.cake.slices -= 1;
    this.state.cakeSlices = this.cake.slices;
  }

  private blow(client: Client<Member, Member>): void {
    const member = client.userData;
    const player = this.state.players.get(client.sessionId);
    if (!member || !player || !this.cake?.lit || !near(player, BIRTHDAY_CAKE)) return;
    if (!member.birthdayToday) {
      client.send('refused', { message: 'The birthday Nong blows out the candles.' });
      return;
    }
    this.cake.lit = false;
    this.state.candlesLit = false;
    this.broadcast('blown', { by: member.username });
  }

  private eaten(client: Client<Member, Member>, raw: { food?: unknown; recipe?: unknown; rating?: unknown }): void {
    const member = client.userData;
    const player = this.state.players.get(client.sessionId);
    if (!member || !player) return;
    if (raw?.food === 'cake') member.stats = eat(member.stats, 'cake', FOOD_VALUE.cake);
    else if (raw?.food === 'meal') {
      const recipe = RECIPES.find((each) => each.id === raw.recipe);
      const rating = Math.min(3, Math.max(1, Math.round(Number(raw.rating) || 1))) as 1 | 2 | 3;
      if (!recipe) return;
      member.stats = eat(member.stats, 'meal', dishHunger(recipe, rating));
    } else return;
    player.energy = member.stats.energy;
    player.hunger = member.stats.hunger;
  }

  private async place(client: Client<Member, Member>, raw: Record<string, unknown>): Promise<void> {
    const member = client.userData;
    const piece = this.pieces.find((each) => each.id === raw?.id);
    const numbers = [raw?.x, raw?.z, raw?.turns, raw?.y].every((value) => typeof value === 'number' && Number.isFinite(value));
    if (!member || !piece || !numbers || !isMovable(piece)) return;
    const turns = quarter(raw.turns as number);
    const at = { x: raw.x as number, z: raw.z as number, yaw: (turns * Math.PI) / 2, elevation: raw.y as number };
    const riders = ridersOf(piece, this.pieces);
    const problem = checkPlacement(piece, at, this.pieces, riders);
    if (problem) {
      client.send('refused', { message: 'That piece does not fit there.' });
      // The layout is sent again as it stands, so the mover's copy goes back.
      this.setPlacement(piece);
      return;
    }
    const home = { x: piece.x, z: piece.z, yaw: piece.yaw, elevation: piece.elevation };
    Object.assign(piece, at);
    for (const rider of riders) Object.assign(rider, carried(rider, home, at));
    for (const moved of [piece, ...riders]) await this.savePlacement(moved, member.userId);
  }

  /** Puts a piece away. Things standing on it must be taken off first, so nothing is put away by surprise. */
  private async store(client: Client<Member, Member>, raw: Record<string, unknown>): Promise<void> {
    const member = client.userData;
    const piece = this.pieces.find((each) => each.id === raw?.id);
    if (!member || !piece || !canStore(piece) || isStored(piece)) return;
    if (ridersOf(piece, this.pieces).length > 0) {
      client.send('refused', { message: 'Take the things off it first.' });
      this.setPlacement(piece);
      return;
    }
    Object.assign(piece, { x: STORAGE.x, z: STORAGE.z, elevation: 0 });
    await this.savePlacement(piece, member.userId);
  }

  private async savePlacement(piece: Furniture, userId: number): Promise<void> {
    this.setPlacement(piece);
    await this.db.query(
      `insert into furniture (piece_id, x, z, turns, y, placed_by) values ($1, $2, $3, $4, $5, $6)
       on conflict (piece_id) do update set x = excluded.x, z = excluded.z, turns = excluded.turns, y = excluded.y,
         placed_by = excluded.placed_by, updated_at = now()`,
      [piece.id, piece.x, piece.z, quarter(piece.yaw / (Math.PI / 2)), piece.elevation, userId],
    );
  }

  private async lookChanged(client: Client<Member, Member>): Promise<void> {
    const member = client.userData;
    const player = this.state.players.get(client.sessionId);
    if (!member || !player) return;
    const [avatar] = await this.db.query<{ config: unknown }>('select config from avatars where user_id = $1', [member.userId]);
    player.look = JSON.stringify(sanitizeAvatar(avatar?.config ?? null));
  }

  // ---- the clock ----

  private tick(seconds: number): void {
    const occupied = new Set<string>();
    for (const client of this.clients) {
      const member = client.userData;
      const player = this.state.players.get(client.sessionId);
      if (!member || !player || player.anim === '') continue;
      if (player.zone) occupied.add(player.zone);
      member.stats = tickStats(member.stats, activityFor(player.anim), seconds);
      player.energy = Math.round(member.stats.energy * 10) / 10;
      player.hunger = Math.round(member.stats.hunger * 10) / 10;
    }
    // A lock goes once nobody is left in its room.
    const kept = locksAfterLeaving(new Map(this.state.locks.entries()), DOORS, occupied);
    for (const id of [...this.state.locks.keys()]) if (!kept.has(id)) this.state.locks.delete(id);
    // Litter builds up quickly where people are, and slowly in empty rooms.
    for (const zone of LITTER_ZONES) {
      let due = (this.litterProgress.get(zone) ?? 0) + litterDue(seconds, occupied.has(zone));
      while (due >= 1) {
        due -= 1;
        this.dropLitter(zone);
      }
      this.litterProgress.set(zone, due);
    }
    this.updateBirthday();
  }

  private dropLitter(zone: string): void {
    const existing = [...this.state.litter.entries()].map(([id, piece]) => ({ id, ...piece }) as LitterPiece);
    const piece = placeLitter(zone, existing, this.pieces, `l${this.nextLitter}`);
    if (!piece) return;
    this.nextLitter += 1;
    this.addLitter(piece);
  }

  private addLitter(piece: LitterPiece): void {
    const state = new LitterState();
    Object.assign(state, { kind: piece.kind, zone: piece.zone, x: piece.x, z: piece.z, yaw: piece.yaw });
    this.state.litter.set(piece.id, state);
  }

  private lockedZones(name: string): Set<string> {
    const zones = new Set<string>();
    for (const [doorId, by] of this.state.locks.entries()) {
      const zone = DOORS.find((door) => door.id === doorId)?.zoneId;
      if (zone && by !== name) zones.add(zone);
    }
    return zones;
  }

  /** The birthday is on while someone whose birthday it is today is in the house. The cake comes back each new birthday. */
  private updateBirthday(): void {
    const names = this.clients.flatMap((client) => (client.userData?.birthdayToday ? [client.userData.username] : []));
    const birthday = [...new Set(names)].sort().join(', ');
    if (birthday && this.cake?.day !== dayKey(new Date())) {
      this.cake = { day: dayKey(new Date()), slices: CAKE_SLICES, lit: true };
      }
    if (this.state.birthday !== birthday) this.state.birthday = birthday;
    const slices = birthday && this.cake ? this.cake.slices : 0;
    if (this.state.cakeSlices !== slices) this.state.cakeSlices = slices;
    const lit = Boolean(birthday && this.cake?.lit);
    if (this.state.candlesLit !== lit) this.state.candlesLit = lit;
    this.setCakeInPieces(Boolean(birthday) && slices > 0);
  }

  private setCakeInPieces(on: boolean): void {
    const has = this.pieces.some((piece) => piece.id === BIRTHDAY_CAKE.id);
    if (on && !has) this.pieces.push({ ...BIRTHDAY_CAKE });
    if (!on && has) this.pieces = this.pieces.filter((piece) => piece.id !== BIRTHDAY_CAKE.id);
  }

  private setPlacement(piece: Furniture): void {
    const home = FURNITURE.find((each) => each.id === piece.id);
    if (!home) return;
    const state = new PlacementState();
    Object.assign(state, { x: piece.x, z: piece.z, turns: quarter(piece.yaw / (Math.PI / 2)), y: piece.elevation });
    this.state.layout.set(piece.id, state);
  }

  // ---- the database ----

  private async load(): Promise<void> {
    const rows = await this.db.query<{ piece_id: string; x: number; z: number; turns: number; y: number }>(
      'select piece_id, x, z, turns, y from furniture',
    );
    const saved = Object.fromEntries(rows.map((row) => [row.piece_id, { x: row.x, z: row.z, turns: row.turns, y: row.y }]));
    this.pieces = layoutWith(FURNITURE, saved);
    for (const row of rows) {
      const piece = this.pieces.find((each) => each.id === row.piece_id);
      if (piece) this.setPlacement(piece);
    }

    const pictures = await this.db.query<{ piece_id: string; version: string }>(
      `select piece_id, (extract(epoch from updated_at) * 1000)::bigint::text as version from pictures`,
    );
    for (const row of pictures) this.state.pictures.set(row.piece_id, row.version);

    const [house] = await this.db.query<{ litter: LitterPiece[]; cake: CakeDay | null; away: number }>(
      `select litter, cake, extract(epoch from now() - last_online_at)::float as away from house where id = $1`,
      [HOUSE_ROW],
    );
    if (!house) {
      // A new house starts a little lived-in, so there is something to sweep.
      LITTER_ZONES.forEach((zone, i) => {
        if (i % 2 === 0) this.dropLitter(zone);
      });
      await this.db.query('insert into house (id, litter) values ($1, $2)', [HOUSE_ROW, JSON.stringify(this.litterList())]);
      return;
    }
    for (const piece of Array.isArray(house.litter) ? house.litter : []) {
      if (typeof piece?.id !== 'string') continue;
      this.addLitter(piece);
      this.nextLitter = Math.max(this.nextLitter, Number(piece.id.slice(1)) + 1 || this.nextLitter);
    }
    this.cake = house.cake;
    // The litter that built up while the server was not running.
    for (const zone of LITTER_ZONES) {
      let due = litterDue(Math.max(0, house.away), false) + Math.random();
      while (due >= 1) {
        due -= 1;
        this.dropLitter(zone);
      }
    }
  }

  private litterList(): LitterPiece[] {
    return [...this.state.litter.entries()].map(([id, piece]) => ({
      id,
      kind: piece.kind as LitterPiece['kind'],
      zone: piece.zone,
      x: piece.x,
      z: piece.z,
      yaw: piece.yaw,
    }));
  }

  private async saveStats(member: Member): Promise<void> {
    await this.db.query(
      `insert into player_stats (user_id, energy, hunger) values ($1, $2, $3)
       on conflict (user_id) do update set energy = excluded.energy, hunger = excluded.hunger, updated_at = now()`,
      [member.userId, member.stats.energy, member.stats.hunger],
    );
  }

  private async save(): Promise<void> {
    for (const client of this.clients) if (client.userData) await this.saveStats(client.userData);
    // The time is saved every round, so a restart adds only the litter of the time it was down.
    await this.db.query('update house set litter = $2, cake = $3, last_online_at = now() where id = $1', [
      HOUSE_ROW,
      JSON.stringify(this.litterList()),
      this.cake ? JSON.stringify(this.cake) : null,
    ]);
  }
}
