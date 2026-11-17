/**
 * The database. In production it is PostgreSQL (DATABASE_URL). Without one it
 * is PGlite: the same PostgreSQL, compiled to WebAssembly and running inside
 * the server, saved in `apps/server/data`. Both take the same SQL.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export interface Database {
  query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<Row[]>;
  close(): Promise<void>;
}

/** The tables, created when missing. Later changes are added as new statements at the end. */
const SCHEMA = `
create table if not exists users (
  id serial primary key,
  username text not null,
  username_key text not null unique,
  password_hash text not null,
  birthday date not null,
  created_at timestamptz not null default now()
);
create table if not exists avatars (
  user_id integer primary key references users(id) on delete cascade,
  config jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists sessions (
  token_hash text primary key,
  user_id integer not null references users(id) on delete cascade,
  expires_at timestamptz not null
);
create index if not exists sessions_user on sessions(user_id);
create table if not exists player_stats (
  user_id integer primary key references users(id) on delete cascade,
  energy real not null,
  hunger real not null,
  updated_at timestamptz not null default now()
);
create table if not exists house (
  id integer primary key,
  litter jsonb not null default '[]',
  cake jsonb,
  last_online_at timestamptz not null default now()
);
create table if not exists furniture (
  piece_id text primary key,
  x real not null,
  z real not null,
  turns integer not null,
  y real not null,
  placed_by integer references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists pictures (
  piece_id text primary key,
  image bytea not null,
  placed_by integer references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
`;

/** `dataDir` "memory://" keeps everything in memory, for tests. */
export async function openDatabase(options: { url?: string; dataDir?: string } = {}): Promise<Database> {
  const database = options.url ? postgres(options.url) : await pglite(options.dataDir ?? 'data/pglite');
  for (const statement of SCHEMA.split(';').map((text) => text.trim()).filter(Boolean)) {
    await database.query(statement);
  }
  return database;
}

function postgres(url: string): Database {
  const pool = new pg.Pool({ connectionString: url });
  return {
    query: async <Row>(sql: string, params: readonly unknown[] = []) => (await pool.query(sql, [...params])).rows as Row[],
    close: () => pool.end(),
  };
}

async function pglite(dataDir: string): Promise<Database> {
  // PGlite makes its own folder but not the ones above it.
  if (!dataDir.includes('://')) mkdirSync(dirname(dataDir), { recursive: true });
  const db = await PGlite.create(dataDir);
  return {
    query: async <Row>(sql: string, params: readonly unknown[] = []) => (await db.query<Row>(sql, [...params])).rows,
    close: () => db.close(),
  };
}
