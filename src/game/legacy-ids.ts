// Retired content ids and per-keeper vars, and the one place old saves are
// migrated (checkpoint resume, the collection's seen list). Bombs and keys left
// the game (2026-10-10): their purse becomes matches, and the items built
// around them were renamed.

import type { Checkpoint } from './checkpoint';

/** = MATCH_CAP (game/matches.ts); repeated so engine/save can import this file without the game modules. */
const LEGACY_MATCH_CAP = 9;

/** Old item id -> current item id. */
export const LEGACY_ITEM_IDS: Readonly<Record<string, string>> = {
  tick_bomb: 'tick_stopper',
  wind_up_key: 'wind_up_matchbox',
  black_candle: 'soot_candle',
  bless_powder: 'bless_match_pouch',
};

/** Old per-keeper var -> current var (null: dropped). */
export const LEGACY_VARS: Readonly<Record<string, string | null>> = {
  __grant_wind_up_key: '__grant_wind_up_matchbox',
  __grant_bless_powder: '__grant_bless_match_pouch',
  __bloodOathFloor: '__lastStandFloor',
  __grant_tick_bomb: null,
  __grant_cluster_powder: null,
};

/** The current id of an item id that may come from an old save. */
export function normalizeItemId(id: string): string {
  return Object.prototype.hasOwnProperty.call(LEGACY_ITEM_IDS, id) ? LEGACY_ITEM_IDS[id] : id;
}

/** Old purses held bombs and keys: a key becomes a match, two bombs one (rounded up). */
export function migratePurse(purse: { coins?: number; matches?: number; bombs?: number; keys?: number } | undefined): { coins: number; matches: number } {
  const p = purse ?? {};
  const matches = typeof p.matches === 'number' ? p.matches : (p.keys ?? 0) + Math.ceil((p.bombs ?? 0) / 2);
  return { coins: p.coins ?? 0, matches: Math.max(0, Math.min(LEGACY_MATCH_CAP, matches)) };
}

/**
 * Bring a checkpoint from any older version up to date, in place (idempotent:
 * a second call changes nothing): item ids, renamed vars, the purse.
 */
export function migrateCheckpoint(c: Checkpoint): Checkpoint {
  c.items = (c.items ?? []).map(normalizeItemId);
  c.obtained = (c.obtained ?? []).map(normalizeItemId);
  c.seen = (c.seen ?? []).map(normalizeItemId);
  if (c.active) c.active = normalizeItemId(c.active);
  const vars: Record<string, number> = {};
  for (const [k, v] of Object.entries(c.vars ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(LEGACY_VARS, k)) {
      if (!(k in vars)) vars[k] = v;
      continue;
    }
    const to = LEGACY_VARS[k];
    if (to) vars[to] = v;
  }
  c.vars = vars;
  c.purse = migratePurse(c.purse);
  return c;
}
