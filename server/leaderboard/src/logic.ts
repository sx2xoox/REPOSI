// Pure rules of the speedrun leaderboard (no Workers APIs: unit-tested from tests/).
//
// One row per (run, floor): the keeper killed that floor's boss in a speedrun-mode run.
// `splitMs` = the run clock from the start of floor 1 to that boss's death (the ranking of
// floor N is the time to clear floors 1..N, user 2026-10-08), `bossMs` = that boss fight
// alone (shown in the per-floor breakdown). Rankings keep each device's best time.

export const FLOORS = 7;

export interface Submission {
  season: number;
  build: string;
  device: string;
  runId: string;
  name: string;
  seed: string;
  char: string;
  weapon: string;
  floor: number;
  bossMs: number;
  splitMs: number;
}

/** Lower bounds no legitimate run beats (boss skills, phase gates and the damage budget). */
export const MIN_BOSS_MS = 5_000;
export const MIN_SPLIT_PER_FLOOR_MS = 30_000;
export const MAX_RUN_MS = 6 * 60 * 60 * 1000;
export const MAX_NAME = 12;

const ID = /^[a-z0-9_]{1,32}$/;
const TOKEN = /^[A-Za-z0-9_-]{8,64}$/;
const SEED = /^[A-Za-z0-9_-]{1,32}$/;

/** Control, zero-width and bidi characters (written as escapes: some are line separators). */
const INVISIBLE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]', 'g');

/** Trim, drop control / zero-width characters, cap the length; '' when nothing usable is left. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, MAX_NAME).join('');
}

const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && Math.floor(v) === v ? v : null);

/** A validated submission, or the reason it was refused. */
export function validate(body: unknown): { ok: true; value: Submission } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body' };
  const b = body as Record<string, unknown>;
  const season = int(b.season);
  const floor = int(b.floor);
  const bossMs = int(b.bossMs);
  const splitMs = int(b.splitMs);
  const name = cleanName(b.name);
  if (season === null || season < 1 || season > 999) return { ok: false, error: 'season' };
  if (floor === null || floor < 1 || floor > FLOORS) return { ok: false, error: 'floor' };
  if (typeof b.build !== 'string' || !b.build || b.build.length > 48) return { ok: false, error: 'build' };
  if (typeof b.device !== 'string' || !TOKEN.test(b.device)) return { ok: false, error: 'device' };
  if (typeof b.runId !== 'string' || !TOKEN.test(b.runId)) return { ok: false, error: 'runId' };
  if (!name) return { ok: false, error: 'name' };
  if (typeof b.seed !== 'string' || !SEED.test(b.seed)) return { ok: false, error: 'seed' };
  if (typeof b.char !== 'string' || !ID.test(b.char)) return { ok: false, error: 'char' };
  if (typeof b.weapon !== 'string' || !ID.test(b.weapon)) return { ok: false, error: 'weapon' };
  if (bossMs === null || bossMs < MIN_BOSS_MS || bossMs > MAX_RUN_MS) return { ok: false, error: 'bossMs' };
  if (splitMs === null || splitMs < bossMs || splitMs < floor * MIN_SPLIT_PER_FLOOR_MS || splitMs > MAX_RUN_MS) return { ok: false, error: 'splitMs' };
  return { ok: true, value: { season, build: b.build, device: b.device, runId: b.runId, name, seed: b.seed, char: b.char, weapon: b.weapon, floor, bossMs, splitMs } };
}

export function parseFloor(v: string | null): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= FLOORS ? n : null;
}

export function parseLimit(v: string | null, def = 50): number {
  if (v === null || v === '') return def;
  const n = Number(v);
  return Number.isInteger(n) ? Math.max(1, Math.min(100, n)) : def;
}

/** Each device's best clear time of floors 1..N (its fastest run), fastest first. */
export const TOP_SQL = 'SELECT name, seed, char, weapon, run_id, MIN(split_ms) AS ms, at FROM runs WHERE season = ?1 AND floor = ?2 GROUP BY device ORDER BY ms ASC, at ASC LIMIT ?3';

/** 1-based rank of a clear time among the devices' bests on one floor. */
export const RANK_SQL = 'SELECT COUNT(*) + 1 AS rank FROM (SELECT MIN(split_ms) AS m FROM runs WHERE season = ?1 AND floor = ?2 GROUP BY device) WHERE m < ?3';

/** `n` numbered SQL parameters starting at `from` ("?2, ?3, ..."). */
export function params(from: number, n: number): string {
  return Array.from({ length: n }, (_, i) => `?${from + i}`).join(', ');
}

/** Submissions allowed per device / per address in one minute. */
export const RATE_DEVICE = 20;
export const RATE_IP = 60;

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season INTEGER NOT NULL,
    floor INTEGER NOT NULL,
    boss_ms INTEGER NOT NULL,
    split_ms INTEGER NOT NULL,
    name TEXT NOT NULL,
    seed TEXT NOT NULL,
    device TEXT NOT NULL,
    run_id TEXT NOT NULL,
    char TEXT NOT NULL,
    weapon TEXT NOT NULL,
    build TEXT NOT NULL,
    ip TEXT NOT NULL,
    at INTEGER NOT NULL,
    UNIQUE (run_id, floor)
  )`,
  'CREATE INDEX IF NOT EXISTS runs_split ON runs (season, floor, split_ms)',
  'CREATE INDEX IF NOT EXISTS runs_run ON runs (run_id)',
  'CREATE INDEX IF NOT EXISTS runs_device ON runs (device, at)',
  'CREATE INDEX IF NOT EXISTS runs_ip ON runs (ip, at)',
];
