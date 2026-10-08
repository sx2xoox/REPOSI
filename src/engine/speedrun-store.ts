// This device's speedrun records (one entry per run and floor) and the queue of entries still
// to send to the online leaderboard (net/leaderboard.ts). Global, not per save slot: its own
// localStorage key, a validating loader (bad entries are dropped one by one, a corrupt file
// reads as empty), re-read before every write so two tabs merge instead of overwriting.
//
// Ranking of floor N = splitMs, the clear time of floors 1..N (game/speedrun.ts).

export const SPEEDRUN_KEY = 'lanternkeeper.speedrun.v1';
/** best runs kept per floor (every floor of a kept run stays, for the per-floor breakdown) */
export const SPEEDRUN_KEEP = 30;

export interface SpeedrunEntry {
  runId: string;
  floor: number;
  /** clear time of floors 1..floor (ms, in-game time) */
  splitMs: number;
  /** that floor's boss fight alone (ms) */
  bossMs: number;
  bossId: string;
  character: string;
  weapon: string;
  seed: string;
  name: string;
  /** ISO date (UI side) */
  date: string;
  build: string;
  season: number;
  /** online state: 0 waiting to be sent, 1 accepted, 2 refused (never retried) */
  sent: 0 | 1 | 2;
  /** online rank on its floor when accepted */
  rank?: number;
}

export interface AddResult {
  added: boolean;
  /** 1-based place among this device's records of the floor */
  localRank: number;
  /** faster than every earlier record of the floor on this device */
  personalBest: boolean;
  /** this device's best before this entry (ms) */
  previousBestMs?: number;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface FileV1 { v: 1; device: string; entries: SpeedrunEntry[] }

const TOKEN = /^[A-Za-z0-9_-]{8,64}$/;
const ID = /^[a-z0-9_]{1,32}$/;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const str = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

function validEntry(e: unknown): SpeedrunEntry | null {
  if (!e || typeof e !== 'object') return null;
  const o = e as Record<string, unknown>;
  if (!str(o.runId) || !TOKEN.test(o.runId)) return null;
  if (!isInt(o.floor) || o.floor < 1 || o.floor > 99) return null;
  if (!isInt(o.splitMs) || !isInt(o.bossMs) || o.bossMs < 0 || o.splitMs < o.bossMs) return null;
  if (!str(o.character) || !ID.test(o.character) || !str(o.weapon) || !ID.test(o.weapon)) return null;
  if (!str(o.seed, 32) || !str(o.name, 32) || !str(o.date) || !str(o.build)) return null;
  const sent = o.sent === 1 || o.sent === 2 ? o.sent : 0;
  return {
    runId: o.runId, floor: o.floor, splitMs: o.splitMs, bossMs: o.bossMs, bossId: typeof o.bossId === 'string' ? o.bossId.slice(0, 32) : '',
    character: o.character, weapon: o.weapon, seed: o.seed, name: o.name, date: o.date, build: o.build,
    season: isInt(o.season) && o.season > 0 ? o.season : 1, sent, rank: isInt(o.rank) && o.rank > 0 ? o.rank : undefined,
  };
}

/** Fastest first; ties by date, then run id (a total order). */
export function compareEntries(a: SpeedrunEntry, b: SpeedrunEntry): number {
  return a.splitMs - b.splitMs || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0);
}

function randomToken(prefix: string): string {
  const b = new Uint8Array(12);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  return prefix + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** A fresh run id (UI side only; never from the simulation). */
export function newRunId(): string {
  return randomToken('r');
}

export function createSpeedrunStore(getStorage: () => Store | null) {
  let file: FileV1 | null = null;

  const parse = (raw: string | null): FileV1 => {
    const empty: FileV1 = { v: 1, device: '', entries: [] };
    if (!raw) return empty;
    try {
      const o = JSON.parse(raw) as Partial<FileV1>;
      if (!o || typeof o !== 'object' || o.v !== 1) return empty;
      const seen = new Set<string>();
      const entries: SpeedrunEntry[] = [];
      for (const e of Array.isArray(o.entries) ? o.entries : []) {
        const v = validEntry(e);
        if (!v || seen.has(`${v.runId}|${v.floor}`)) continue;
        seen.add(`${v.runId}|${v.floor}`);
        entries.push(v);
      }
      return { v: 1, device: typeof o.device === 'string' && TOKEN.test(o.device) ? o.device : '', entries };
    } catch {
      return empty;
    }
  };

  const read = (): FileV1 => {
    let raw: string | null = null;
    try {
      raw = getStorage()?.getItem(SPEEDRUN_KEY) ?? null;
    } catch {
      raw = null;
    }
    const f = parse(raw);
    if (file) {
      // keep anything only this tab knows (e.g. a write that failed on quota)
      const have = new Set(f.entries.map((e) => `${e.runId}|${e.floor}`));
      for (const e of file.entries) if (!have.has(`${e.runId}|${e.floor}`)) f.entries.push(e);
      if (!f.device) f.device = file.device;
    }
    if (!f.device) f.device = randomToken('d');
    return f;
  };

  const load = (): FileV1 => (file ??= read());

  /** Drop runs that are no longer among the best SPEEDRUN_KEEP of any floor they reached. */
  const prune = (f: FileV1): void => {
    const keep = new Set<string>();
    const floors = new Set(f.entries.map((e) => e.floor));
    for (const fl of floors) {
      const list = f.entries.filter((e) => e.floor === fl).sort(compareEntries);
      for (const e of list.slice(0, SPEEDRUN_KEEP)) keep.add(e.runId);
      // unsent entries stay until the server has seen them
      for (const e of list) if (e.sent === 0) keep.add(e.runId);
    }
    f.entries = f.entries.filter((e) => keep.has(e.runId));
  };

  const write = (f: FileV1): boolean => {
    file = f;
    try {
      const s = getStorage();
      if (!s) return false;
      s.setItem(SPEEDRUN_KEY, JSON.stringify(f));
      return true;
    } catch {
      return false;
    }
  };

  return {
    /** this device's id for the online board (random, created once) */
    device(): string {
      const f = load();
      if (!f.device) f.device = randomToken('d');
      return f.device;
    },
    /** this device's records of one floor, fastest first */
    list(floor: number): SpeedrunEntry[] {
      return load().entries.filter((e) => e.floor === floor).sort(compareEntries);
    },
    /** every floor of one run, in order */
    run(runId: string): SpeedrunEntry[] {
      return load().entries.filter((e) => e.runId === runId).sort((a, b) => a.floor - b.floor);
    },
    best(floor: number): SpeedrunEntry | undefined {
      return this.list(floor)[0];
    },
    add(entry: SpeedrunEntry): AddResult {
      const f = read();
      const valid = validEntry(entry);
      const before = f.entries.filter((e) => e.floor === entry.floor).sort(compareEntries);
      const previousBestMs = before[0]?.splitMs;
      if (!valid || f.entries.some((e) => e.runId === entry.runId && e.floor === entry.floor)) {
        file = f;
        const rank = 1 + before.filter((e) => compareEntries(e, entry) < 0).length;
        return { added: false, localRank: rank, personalBest: false, previousBestMs };
      }
      f.entries.push(valid);
      prune(f);
      write(f);
      const localRank = 1 + before.filter((e) => compareEntries(e, valid) < 0).length;
      return { added: true, localRank, personalBest: previousBestMs === undefined || valid.splitMs < previousBestMs, previousBestMs };
    },
    /** entries still to send online, oldest first */
    pending(): SpeedrunEntry[] {
      return load().entries.filter((e) => e.sent === 0).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.floor - b.floor));
    },
    /** the server answered for one entry */
    markSent(runId: string, floor: number, ok: boolean, rank?: number): void {
      const f = read();
      const e = f.entries.find((x) => x.runId === runId && x.floor === floor);
      if (!e) return;
      e.sent = ok ? 1 : 2;
      if (ok && rank) e.rank = rank;
      write(f);
    },
    clear(): void {
      const device = load().device;
      file = { v: 1, device, entries: [] };
      try {
        getStorage()?.removeItem(SPEEDRUN_KEY);
      } catch {
        // storage unavailable
      }
    },
    /** forget the cached copy (tests; another tab wrote) */
    reload(): void {
      file = null;
    },
  };
}

export type SpeedrunStore = ReturnType<typeof createSpeedrunStore>;

export const speedrunStore: SpeedrunStore = createSpeedrunStore(() => (typeof localStorage !== 'undefined' ? localStorage : null));
