// Online speedrun leaderboard client (server: server/leaderboard, a Cloudflare Worker + D1).
//
// The game only knows the Worker's URL: no keys. Every floor clear of an eligible speedrun is
// written to the local store first (engine/speedrun-store.ts) and sent from its queue, so a
// closed tab or a network error loses nothing; the server ignores duplicates (run + floor).
// Nothing here runs at boot: the queue is flushed after a boss split, and boards are fetched
// when the ranking screen asks. Network results never reach the simulation.
//
// URL overrides for testing: `?lb=http://127.0.0.1:8787` (also enables sending from dev builds
// and automated browsers, which are otherwise kept off the public board), `?lb=off`.

import { BUILD_ID } from './build';
import { speedrunStore, type SpeedrunEntry } from '../engine/speedrun-store';
import { FLOORS, validate, type Submission } from '../../server/leaderboard/src/logic';

/** The deployed Worker (empty until the server is set up: rankings then show this device only). */
export const LEADERBOARD_URL = 'https://lanternkeeper-ranking.lanternkeeper.workers.dev';
/** Bump when balance changes make old times incomparable (the server keeps seasons apart). */
export const SEASON = 5;
export const LEADERBOARD_FLOORS = FLOORS;

const TIMEOUT_MS = 7000;

function queryOverride(): string | null {
  try {
    if (typeof location === 'undefined') return null;
    return new URLSearchParams(location.search).get('lb');
  } catch {
    return null;
  }
}

/** Base URL of the board, or '' when there is none. */
export function leaderboardUrl(): string {
  const q = queryOverride();
  if (q === 'off') return '';
  return (q || LEADERBOARD_URL).replace(/\/+$/, '');
}

/** May this page send records? (a board exists, a real build, not a file:// page or a test bot) */
export function canSubmit(): boolean {
  const url = leaderboardUrl();
  if (!url || typeof fetch === 'undefined' || typeof location === 'undefined') return false;
  if (location.protocol === 'file:') return false;
  if (queryOverride()) return true;
  if (BUILD_ID === 'dev') return false;
  const nav = (globalThis as { navigator?: { webdriver?: boolean } }).navigator;
  return !nav?.webdriver;
}

/** Can the ranking screen read the online board? */
export function canRead(): boolean {
  return !!leaderboardUrl() && typeof fetch !== 'undefined' && typeof location !== 'undefined' && location.protocol !== 'file:';
}

export interface OnlineFloor { floor: number; splitMs: number; bossMs: number }
export interface OnlineEntry { rank: number; name: string; seed: string; char: string; weapon: string; ms: number; at: number; floors: OnlineFloor[] }
export type TopResult = { ok: true; entries: OnlineEntry[] } | { ok: false; error: string };

async function call(path: string, init?: RequestInit): Promise<Response> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
  try {
    return await fetch(`${leaderboardUrl()}${path}`, { ...init, signal: ctl?.signal, cache: 'no-store' });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The online ranking of floor N (each player's best clear of floors 1..N). */
export async function fetchTop(floor: number, limit = 50): Promise<TopResult> {
  if (!canRead()) return { ok: false, error: 'off' };
  try {
    const r = await call(`/v1/top?season=${SEASON}&floor=${floor}&limit=${limit}`);
    if (!r.ok) return { ok: false, error: `http ${r.status}` };
    const j = (await r.json()) as { entries?: OnlineEntry[] };
    const entries = Array.isArray(j.entries) ? j.entries.filter((e) => e && typeof e.ms === 'number' && typeof e.name === 'string') : [];
    return { ok: true, entries };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.name === 'AbortError' ? 'timeout' : e) };
  }
}

/** The payload the server expects for one stored entry. */
export function submission(e: SpeedrunEntry, device: string): Submission {
  return { season: e.season, build: e.build, device, runId: e.runId, name: e.name, seed: e.seed, char: e.character, weapon: e.weapon, floor: e.floor, bossMs: e.bossMs, splitMs: e.splitMs };
}

export interface SubmitResult { ok: boolean; rank?: number; bestMs?: number; retry?: boolean; error?: string }

/** Send one entry. Refusals are final (marked, never retried); network trouble is retried later. */
export async function submitEntry(e: SpeedrunEntry): Promise<SubmitResult> {
  const body = submission(e, speedrunStore.device());
  const v = validate(body);
  if (!v.ok) {
    speedrunStore.markSent(e.runId, e.floor, false);
    return { ok: false, error: v.error };
  }
  try {
    const r = await call('/v1/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 429 || r.status >= 500) return { ok: false, retry: true, error: `http ${r.status}` };
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; rank?: number; bestMs?: number; error?: string };
    if (!r.ok || !j.ok) {
      speedrunStore.markSent(e.runId, e.floor, false);
      return { ok: false, error: j.error ?? `http ${r.status}` };
    }
    speedrunStore.markSent(e.runId, e.floor, true, j.rank);
    return { ok: true, rank: j.rank, bestMs: j.bestMs };
  } catch (err) {
    return { ok: false, retry: true, error: String(err) };
  }
}

let flushing: Promise<void> | null = null;

/**
 * Send everything still queued (oldest first). `onResult` hears each answer (the HUD shows the
 * rank of the split it just announced). Concurrent calls share one pass.
 */
export function flushQueue(onResult?: (e: SpeedrunEntry, r: SubmitResult) => void): Promise<void> {
  if (!canSubmit()) return Promise.resolve();
  if (flushing) return flushing.then(() => flushQueue(onResult));
  flushing = (async () => {
    for (const e of speedrunStore.pending()) {
      const r = await submitEntry(e);
      onResult?.(e, r);
      if (r.retry) break;
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
