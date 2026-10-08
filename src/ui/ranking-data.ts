// 랭킹 data: pure helpers that turn this device's records (engine/speedrun-store) and the
// online board (net/leaderboard) into the ranking screen's rows, per-floor breakdowns and
// scroll math. No DOM, storage or network here (unit-tested in tests/ranking.test.ts).
//
// Ranking of floor N = clear time of floors 1..N (split), never floor N alone.

import type { SpeedrunEntry } from '../engine/speedrun-store';
import type { OnlineEntry } from '../net/leaderboard';

export interface FloorTime {
  floor: number;
  /** clear time of floors 1..floor (ms) */
  splitMs: number;
  /** that floor's boss fight alone (ms) */
  bossMs: number;
}

export interface RankRow {
  /** stable key for selection / expansion (run id locally; player + run online) */
  key: string;
  rank: number;
  name: string;
  character: string;
  weapon: string;
  seed: string;
  /** clear time of floors 1..N (ms) */
  ms: number;
  /** epoch ms the record was made (0: unknown) */
  at: number;
  /** the run's floors, in order (for the breakdown) */
  floors: FloorTime[];
  /** the viewer's own row (highlighted) */
  mine: boolean;
  /** local rows: online state of this floor's entry (0 waiting, 1 accepted, 2 refused) */
  sent?: 0 | 1 | 2;
  /** local rows: online rank when it was accepted */
  onlineRank?: number;
}

export interface BreakdownCell {
  floor: number;
  /** cumulative clear time of floors 1..floor (null: no record) */
  splitMs: number | null;
  /** this floor alone: its split minus the previous floor's split */
  segmentMs: number | null;
  /** this floor's boss fight */
  bossMs: number | null;
}

const okMs = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Floors 1..upTo of a run: cumulative time, the floor's own segment and its boss fight. */
export function breakdown(floors: readonly FloorTime[], upTo: number): BreakdownCell[] {
  const by = new Map<number, FloorTime>();
  for (const f of floors) {
    if (!f || !Number.isInteger(f.floor) || f.floor < 1 || f.floor > upTo || by.has(f.floor) || !okMs(f.splitMs)) continue;
    by.set(f.floor, f);
  }
  const out: BreakdownCell[] = [];
  for (let n = 1; n <= upTo; n++) {
    const cur = by.get(n);
    const prevSplit = n === 1 ? 0 : by.get(n - 1)?.splitMs;
    const seg = cur && prevSplit !== undefined ? cur.splitMs - prevSplit : null;
    out.push({
      floor: n,
      splitMs: cur ? cur.splitMs : null,
      segmentMs: seg !== null && seg >= 0 ? seg : null,
      bossMs: cur && okMs(cur.bossMs) ? cur.bossMs : null,
    });
  }
  return out;
}

/** Two ranking names are the same player (spaces and letter case ignored). */
export function sameName(a: string, b: string): boolean {
  const n = (s: string) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const x = n(a);
  return !!x && x === n(b);
}

function isoToMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** 내 기록: this device's records of one floor (already fastest first), with each run's floors. */
export function localRows(list: readonly SpeedrunEntry[], runOf: (runId: string) => SpeedrunEntry[], highlightRun?: string): RankRow[] {
  return list.map((e, i) => ({
    key: `l:${e.runId}`,
    rank: i + 1,
    name: e.name,
    character: e.character,
    weapon: e.weapon,
    seed: e.seed,
    ms: e.splitMs,
    at: isoToMs(e.date),
    floors: runOf(e.runId).map((f) => ({ floor: f.floor, splitMs: f.splitMs, bossMs: f.bossMs })),
    mine: !!highlightRun && e.runId === highlightRun,
    sent: e.sent,
    onlineRank: e.rank,
  }));
}

/** 전체 랭킹: the online board of one floor (each player's best), highlighting the viewer's name. */
export function onlineRows(entries: readonly OnlineEntry[], myName: string): RankRow[] {
  const seen = new Map<string, number>();
  return entries.map((e, i) => {
    const floors = (Array.isArray(e.floors) ? e.floors : [])
      .filter((f) => f && Number.isInteger(f.floor) && okMs(f.splitMs))
      .map((f) => ({ floor: f.floor, splitMs: f.splitMs, bossMs: okMs(f.bossMs) ? f.bossMs : -1 }))
      .sort((a, b) => a.floor - b.floor);
    let key = `o:${e.name}|${e.seed}|${e.char}`;
    const dup = seen.get(key) ?? 0;
    seen.set(key, dup + 1);
    if (dup) key += `#${dup}`;
    return {
      key,
      rank: Number.isInteger(e.rank) && e.rank > 0 ? e.rank : i + 1,
      name: String(e.name ?? ''),
      character: String(e.char ?? ''),
      weapon: String(e.weapon ?? ''),
      seed: String(e.seed ?? ''),
      ms: e.ms,
      at: okMs(e.at) ? e.at : 0,
      floors,
      mine: sameName(e.name, myName),
    };
  });
}

/** 'YYYY.MM.DD' in local time ('' when unknown). UI only. */
export function dateLabel(at: number): string {
  if (!okMs(at) || at <= 0) return '';
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/** Next floor of the dropdown (clamped to 1..last). */
export function stepFloor(floor: number, dir: number, last: number): number {
  return Math.max(1, Math.min(Math.max(1, last), floor + dir));
}

/** The deepest floor with at least one record (0: none), from a per-floor count. */
export function deepestFloor(countOf: (floor: number) => number, last: number): number {
  for (let f = last; f >= 1; f--) if (countOf(f) > 0) return f;
  return 0;
}

/** Top offset of every row given each row's height (plus the total height at the end). */
export function rowOffsets(heights: readonly number[]): number[] {
  const out: number[] = [0];
  for (const h of heights) out.push(out[out.length - 1] + h);
  return out;
}

/**
 * Scroll (px) so that [top, bottom] of the content is visible in a window of `view` px,
 * moving as little as possible; the top wins when the span is taller than the window.
 */
export function scrollToShow(scroll: number, top: number, bottom: number, view: number, max: number): number {
  let s = scroll;
  if (bottom > s + view) s = bottom - view;
  if (top < s) s = top;
  return Math.max(0, Math.min(Math.max(0, max), s));
}
