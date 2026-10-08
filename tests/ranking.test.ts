// 랭킹 screen data (user 2026-10-08): floor N's board is the clear time of floors 1..N, rows
// carry the run's per-floor breakdown (cumulative, the floor's own segment, the boss fight).
import { describe, expect, it } from 'vitest';
import { breakdown, dateLabel, deepestFloor, localRows, onlineRows, rowOffsets, sameName, scrollToShow, stepFloor } from '../src/ui/ranking-data';
import type { SpeedrunEntry } from '../src/engine/speedrun-store';
import type { OnlineEntry } from '../src/net/leaderboard';

const entry = (o: Partial<SpeedrunEntry> = {}): SpeedrunEntry => ({
  runId: 'r0000000001', floor: 1, splitMs: 90_000, bossMs: 40_000, bossId: 'bell_keeper', character: 'ria', weapon: 'lantern_bolt',
  seed: 'ABCD-1234', name: '등불여우', date: '2026-10-08T03:00:00.000Z', build: 'dev', season: 1, sent: 0, ...o,
});

describe('per-floor breakdown', () => {
  it('cumulative time, own segment and boss fight for floors 1..N', () => {
    const cells = breakdown([
      { floor: 1, splitMs: 95_000, bossMs: 42_000 },
      { floor: 2, splitMs: 210_000, bossMs: 51_000 },
      { floor: 3, splitMs: 330_500, bossMs: 47_250 },
    ], 3);
    expect(cells).toEqual([
      { floor: 1, splitMs: 95_000, segmentMs: 95_000, bossMs: 42_000 },
      { floor: 2, splitMs: 210_000, segmentMs: 115_000, bossMs: 51_000 },
      { floor: 3, splitMs: 330_500, segmentMs: 120_500, bossMs: 47_250 },
    ]);
  });

  it('stops at the ranked floor and leaves gaps empty instead of guessing', () => {
    const cells = breakdown([
      { floor: 3, splitMs: 300_000, bossMs: 40_000 },
      { floor: 1, splitMs: 90_000, bossMs: 40_000 },
      { floor: 4, splitMs: 400_000, bossMs: 40_000 },
    ], 3);
    expect(cells.map((c) => c.floor)).toEqual([1, 2, 3]);
    expect(cells[1]).toEqual({ floor: 2, splitMs: null, segmentMs: null, bossMs: null });
    // floor 3's segment needs floor 2's split
    expect(cells[2].segmentMs).toBeNull();
    expect(cells[2].splitMs).toBe(300_000);
  });

  it('ignores broken server rows', () => {
    const cells = breakdown([
      { floor: 1, splitMs: Number.NaN, bossMs: 1 },
      { floor: 1.5, splitMs: 10, bossMs: 1 },
      { floor: 2, splitMs: 50_000, bossMs: -1 },
    ], 2);
    expect(cells[0].splitMs).toBeNull();
    expect(cells[1]).toEqual({ floor: 2, splitMs: 50_000, segmentMs: null, bossMs: null });
  });
});

describe('ranking rows', () => {
  it('내 기록: device records with their runs, the given run highlighted', () => {
    const a1 = entry({ runId: 'raaaaaaaa1', floor: 1, splitMs: 80_000 });
    const a2 = entry({ runId: 'raaaaaaaa1', floor: 2, splitMs: 200_000, bossMs: 50_000, sent: 1, rank: 4 });
    const b2 = entry({ runId: 'rbbbbbbbb1', floor: 2, splitMs: 230_000, bossMs: 60_000, character: 'bern' });
    const runs = new Map([['raaaaaaaa1', [a1, a2]], ['rbbbbbbbb1', [b2]]]);
    const rows = localRows([a2, b2], (id) => runs.get(id) ?? [], 'rbbbbbbbb1');
    expect(rows.map((r) => [r.rank, r.ms, r.character, r.mine])).toEqual([[1, 200_000, 'ria', false], [2, 230_000, 'bern', true]]);
    expect(rows[0].floors).toEqual([{ floor: 1, splitMs: 80_000, bossMs: 40_000 }, { floor: 2, splitMs: 200_000, bossMs: 50_000 }]);
    expect(rows[0].sent).toBe(1);
    expect(rows[0].onlineRank).toBe(4);
    expect(rows[0].at).toBe(Date.parse('2026-10-08T03:00:00.000Z'));
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it('전체 랭킹: server rows, the viewer found by nickname, keys stay unique', () => {
    const e = (o: Partial<OnlineEntry>): OnlineEntry => ({ rank: 1, name: 'a', seed: 'S', char: 'ria', weapon: 'lantern_bolt', ms: 80_000, at: 1_791_427_148_841, floors: [], ...o });
    const rows = onlineRows([
      e({ rank: 1, name: '토베장인', floors: [{ floor: 1, splitMs: 80_000, bossMs: 36_000 }] }),
      e({ rank: 2, name: ' 등불여우 ', ms: 95_000 }),
      e({ rank: 3, name: '토베장인', ms: 120_000 }),
    ], '등불여우');
    expect(rows.map((r) => r.mine)).toEqual([false, true, false]);
    expect(rows[0].floors).toEqual([{ floor: 1, splitMs: 80_000, bossMs: 36_000 }]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
    expect(rows[0].sent).toBeUndefined();
    expect(onlineRows([e({ name: '누군가' })], '').every((r) => !r.mine)).toBe(true);
  });

  it('names compare without spaces or letter case', () => {
    expect(sameName('Abc  Def', 'abc def')).toBe(true);
    expect(sameName('', '')).toBe(false);
    expect(sameName('등불', '등불여우')).toBe(false);
  });
});

describe('ranking screen helpers', () => {
  it('floor stepping stays inside 1..last', () => {
    expect(stepFloor(1, -1, 7)).toBe(1);
    expect(stepFloor(7, 1, 7)).toBe(7);
    expect(stepFloor(3, 1, 7)).toBe(4);
    expect(stepFloor(9, 0, 7)).toBe(7);
  });

  it('opens on the deepest floor this device reached', () => {
    const counts: Record<number, number> = { 1: 4, 2: 2, 3: 1 };
    expect(deepestFloor((f) => counts[f] ?? 0, 7)).toBe(3);
    expect(deepestFloor(() => 0, 7)).toBe(0);
  });

  it('scrolls just enough to show a row and its breakdown', () => {
    expect(rowOffsets([28, 136, 28])).toEqual([0, 28, 164, 192]);
    // already visible
    expect(scrollToShow(0, 28, 164, 246, 500)).toBe(0);
    // below the window: bottom aligned
    expect(scrollToShow(0, 300, 436, 246, 500)).toBe(190);
    // above: top aligned; never past the ends
    expect(scrollToShow(200, 28, 56, 246, 500)).toBe(28);
    expect(scrollToShow(0, 600, 700, 246, 300)).toBe(300);
  });

  it('dates read as YYYY.MM.DD', () => {
    expect(dateLabel(0)).toBe('');
    expect(dateLabel(new Date(2026, 9, 8, 12).getTime())).toBe('2026.10.08');
  });
});
