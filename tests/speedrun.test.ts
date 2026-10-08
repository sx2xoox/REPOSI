// Speedrun mode (user 2026-10-08): timing, splits, the local record store and what the online
// board receives.
import './headless';
import { describe, expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { World, type WorldHost } from '../src/game/world';
import { RunState } from '../src/game/run';
import { FIXED_DT } from '../src/game/constants';
import { Enemies, lastFloorIndex } from '../src/game/defs';
import { SpeedrunRun, TICKS_PER_SEC, taintSpeedrun, ticksToMs, type BossSplit } from '../src/game/speedrun';
import { stateHash } from '../src/game/statehash';
import { formatSplit } from '../src/ui/theme';
import { SPEEDRUN_KEEP, SPEEDRUN_KEY, compareEntries, createSpeedrunStore, newRunId, type SpeedrunEntry } from '../src/engine/speedrun-store';
import { submission } from '../src/net/leaderboard';
import { FLOORS, validate } from '../server/leaderboard/src/logic';
import { PLAIN_ID } from './dpsharness';

class MemStorage {
  map = new Map<string, string>();
  fail = false;
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { if (this.fail) throw new Error('quota'); this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
}

const entry = (o: Partial<SpeedrunEntry> = {}): SpeedrunEntry => ({
  runId: 'r0000000001', floor: 1, splitMs: 90_000, bossMs: 40_000, bossId: 'bell_keeper', character: 'ria', weapon: 'lantern_bolt',
  seed: 'ABCD-1234', name: '등불여우', date: '2026-10-08T03:00:00.000Z', build: 'e1e1631-202610080300', season: 1, sent: 0, ...o,
});

describe('speedrun timing', () => {
  it('formats centiseconds and converts ticks', () => {
    expect(TICKS_PER_SEC).toBe(60);
    expect(ticksToMs(60)).toBe(1000);
    expect(ticksToMs(1)).toBe(17);
    expect(formatSplit(0)).toBe('0:00.00');
    expect(formatSplit(83_456)).toBe('1:23.45');
    expect(formatSplit(3_723_450)).toBe('1:02:03.45');
  });

  it('every floor 1..7 has a boss and the server knows the same floor count', () => {
    expect(lastFloorIndex()).toBe(FLOORS);
    for (let f = 1; f <= FLOORS; f++) expect(Enemies.all().some((d) => d.boss && d.bossFloors?.includes(f)), `floor ${f}`).toBe(true);
  });
});

describe('speedrun splits in the world', () => {
  const renderer = new Renderer(fakeDisplay(1280, 720));
  const make = (seed = 'SPEED-1') => {
    const splits: BossSplit[] = [];
    const events: string[] = [];
    const host: WorldHost = {
      openInventory() {},
      onGameOver(info) { events.push(`over:${info.won}`); },
      onBossSplit(s) { splits.push(s); events.push(`split:${s.floor}`); },
    };
    const run = new RunState(seed, PLAIN_ID);
    run.staged = true;
    run.speedrun = new SpeedrunRun();
    const w = new World(renderer, run, host);
    w.start();
    w.player.god = true;
    return { w, run, splits, events };
  };
  /** Go to floor `f` stage 3, step into the boss room and let the fight start. */
  const toBoss = (w: World, f: number) => {
    w.run.stage = 3;
    w.startFloor(f);
    const node = w.map.nodes.find((n) => n.kind === 'boss')!;
    w.enterRoom(node, null);
    for (let i = 0; i < 30; i++) w.update(FIXED_DT);
    return w.bosses[0];
  };

  it('records exactly one split per floor, in order, with that floor\'s boss', () => {
    const { w, run, splits } = make();
    for (let f = 1; f <= FLOORS; f++) {
      const boss = toBoss(w, f);
      expect(boss, `floor ${f} boss`).toBeTruthy();
      expect(boss.def.bossFloors).toContain(f);
      for (let i = 0; i < 90; i++) w.update(FIXED_DT);
      w.killEnemy(boss);
      w.update(FIXED_DT);
      expect(splits.length).toBe(f);
      const s = splits[f - 1];
      expect(s.floor).toBe(f);
      expect(s.bossId).toBe(boss.def.id);
      expect(s.bossTicks).toBeGreaterThanOrEqual(90);
      expect(s.splitTicks).toBeGreaterThan(f > 1 ? splits[f - 2].splitTicks : 0);
      // the same floor never splits twice
      const again = w.spawnEnemy(boss.def.id, w.room.centerX, w.room.centerY);
      if (again) w.killEnemy(again);
      expect(splits.length).toBe(f);
    }
    expect(run.speedrun!.splits.map((s) => s.floor)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('the floor-7 split comes before the victory, and pausing or hit-stop never adds time', () => {
    const { w, events } = make('SPEED-7');
    const boss = toBoss(w, FLOORS);
    const t0 = w.run.speedrun!.ticks;
    w.paused = true;
    for (let i = 0; i < 120; i++) w.update(FIXED_DT);
    expect(w.run.speedrun!.ticks).toBe(t0);
    w.paused = false;
    w.killEnemy(boss);
    for (let i = 0; i < 60 * 8 && !w.gameOver; i++) w.update(FIXED_DT);
    expect(events[0]).toBe(`split:${FLOORS}`);
    expect(events).toContain('over:true');
  });

  it('no split for a boss outside the boss room, after the keeper fell, or outside speedrun mode', () => {
    const a = make('SPEED-X');
    const id = Enemies.all().find((d) => d.boss && d.bossFloors?.includes(1))!.id;
    const stray = a.w.spawnEnemy(id, a.w.room.centerX, a.w.room.centerY)!;
    a.w.killEnemy(stray);
    expect(a.splits.length).toBe(0);

    const b = make('SPEED-Y');
    const boss = toBoss(b.w, 1);
    (b.w as unknown as { deathT: number }).deathT = 0.1;
    b.w.killEnemy(boss);
    expect(b.splits.length).toBe(0);

    const c = make('SPEED-Z');
    c.run.speedrun = null;
    const boss2 = toBoss(c.w, 1);
    c.w.killEnemy(boss2);
    expect(c.splits.length).toBe(0);
  });

  it('hashes the clock only for speedruns; the taint stays out of the hash', () => {
    const a = make('SPEED-H');
    const h1 = stateHash(a.w);
    taintSpeedrun(a.run, 'debug:god');
    expect(stateHash(a.w)).toBe(h1);
    a.w.update(FIXED_DT);
    const h2 = stateHash(a.w);
    a.run.speedrun!.ticks++;
    expect(stateHash(a.w)).not.toBe(h2);
  });
});

describe('speedrun record store', () => {
  it('reads corrupt or foreign data as empty and drops bad entries one by one', () => {
    const s = new MemStorage();
    s.setItem(SPEEDRUN_KEY, '{nope');
    expect(createSpeedrunStore(() => s).list(1)).toEqual([]);
    s.setItem(SPEEDRUN_KEY, JSON.stringify({ v: 2, entries: [entry()] }));
    expect(createSpeedrunStore(() => s).list(1)).toEqual([]);
    s.setItem(SPEEDRUN_KEY, JSON.stringify({ v: 1, device: 'dAAAAAAAAAA', entries: [entry(), entry({ runId: 'r0000000002', floor: 0 }), entry({ runId: 'r0000000003', bossMs: 99_000 }), entry(), entry({ runId: 'x', splitMs: 1 })] }));
    const st = createSpeedrunStore(() => s);
    expect(st.list(1).length).toBe(1);
    expect(st.device()).toBe('dAAAAAAAAAA');
    expect(createSpeedrunStore(() => null).list(1)).toEqual([]);
  });

  it('adds once per run and floor, ranks fastest first and reports personal bests', () => {
    const s = new MemStorage();
    const st = createSpeedrunStore(() => s);
    const a = st.add(entry({ runId: 'r0000000001', splitMs: 90_000 }));
    expect(a).toMatchObject({ added: true, localRank: 1, personalBest: true });
    const b = st.add(entry({ runId: 'r0000000002', splitMs: 95_000, date: '2026-10-08T04:00:00.000Z' }));
    expect(b).toMatchObject({ added: true, localRank: 2, personalBest: false, previousBestMs: 90_000 });
    const c = st.add(entry({ runId: 'r0000000003', splitMs: 80_000 }));
    expect(c).toMatchObject({ added: true, localRank: 1, personalBest: true });
    expect(st.add(entry({ runId: 'r0000000003', splitMs: 80_000 })).added).toBe(false);
    expect(st.list(1).map((e) => e.splitMs)).toEqual([80_000, 90_000, 95_000]);
    // ties: earlier date, then run id
    const t = [entry({ runId: 'r2', date: 'b' }), entry({ runId: 'r1', date: 'b' }), entry({ runId: 'r3', date: 'a' })].sort(compareEntries);
    expect(t.map((e) => e.runId)).toEqual(['r3', 'r1', 'r2']);
    // a second tab sees the first one's records
    expect(createSpeedrunStore(() => s).list(1).length).toBe(3);
  });

  it('keeps the best runs per floor (with all their floors) and every unsent one', () => {
    const s = new MemStorage();
    const st = createSpeedrunStore(() => s);
    for (let i = 0; i < SPEEDRUN_KEEP + 10; i++) {
      const runId = `r${String(i).padStart(10, '0')}`;
      st.add(entry({ runId, floor: 1, splitMs: 60_000 + i * 1000, sent: 1 }));
      st.add(entry({ runId, floor: 2, splitMs: 200_000 + i * 1000, sent: 1 }));
    }
    expect(st.list(1).length).toBe(SPEEDRUN_KEEP);
    expect(st.run(st.list(1)[0].runId).map((e) => e.floor)).toEqual([1, 2]);
    st.add(entry({ runId: 'rzzzzzzzzzz', splitMs: 999_000, sent: 0 }));
    expect(st.pending().map((e) => e.runId)).toEqual(['rzzzzzzzzzz']);
    st.markSent('rzzzzzzzzzz', 1, true, 7);
    expect(st.pending()).toEqual([]);
  });

  it('survives a storage that refuses writes, and clear() forgets the records', () => {
    const s = new MemStorage();
    s.fail = true;
    const st = createSpeedrunStore(() => s);
    st.add(entry());
    expect(st.list(1).length).toBe(1);
    st.clear();
    expect(st.list(1)).toEqual([]);
  });
});

describe('what the online board receives', () => {
  it('a recorded split passes the server rules', () => {
    const st = createSpeedrunStore(() => new MemStorage());
    const runId = newRunId();
    for (let f = 1; f <= FLOORS; f++) {
      const e = entry({ runId, floor: f, splitMs: ticksToMs(f * 60 * 95), bossMs: ticksToMs(60 * 38) });
      const v = validate(submission(e, st.device()));
      expect(v.ok, `floor ${f}: ${JSON.stringify(v)}`).toBe(true);
    }
    expect(validate(submission(entry({ name: '' }), st.device())).ok).toBe(false);
  });
});
