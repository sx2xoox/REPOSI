// Floor count & difficulty: the descent supports N floors (the last defined one
// ends the run), and every floor follows the per-floor DIFFICULTY table.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadContent } from '../src/content';
import { DIFFICULTY } from '../src/content/floors';
import { Enemies, Floors, defineFloor, enemyHitDamage, floorAt, isLastFloor, lastFloorIndex, type FloorDef } from '../src/game/defs';
import { generateFloor } from '../src/game/dungeon';
import { roomHandler } from '../src/game/roomkinds';
import { Trapdoor } from '../src/game/pickups';
import { World } from '../src/game/world';
import { FinalDawn } from '../src/content/bosses/final';
import { audio } from '../src/audio/audio';
import { RNG } from '../src/engine/rng';
import { Entity } from '../src/game/entity';

loadContent();

/** QA bot median boss dps per floor (measured; re-measure when weapons / items change). */
const BOT_BOSS_DPS: Record<number, number> = { 1: 31, 2: 44, 3: 71, 4: 87, 5: 141, 6: 156 };

const KNOBS = ['hpMult', 'bossHpMult', 'enemyDamage', 'enemySpeed', 'shotSpeed', 'budget', 'championChance', 'roomCount'] as const;

describe('difficulty table', () => {
  const rows = Object.entries(DIFFICULTY).map(([k, v]) => ({ f: Number(k), ...v })).sort((a, b) => a.f - b.f);

  it('covers floors 1-10', () => {
    expect(rows.map((r) => r.f)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('every floor is harder than the one above', () => {
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1];
      const b = rows[i];
      const tag = `floor ${b.f}`;
      expect(b.hpMult / a.hpMult, tag).toBeGreaterThan(1.1);
      expect(b.bossHpMult, tag).toBeGreaterThan(a.bossHpMult);
      expect(b.enemyDamage[0], tag).toBeGreaterThanOrEqual(a.enemyDamage[0]);
      expect(b.enemyDamage[1], tag).toBeGreaterThanOrEqual(a.enemyDamage[1]);
      expect(b.enemySpeed, tag).toBeGreaterThanOrEqual(a.enemySpeed);
      expect(b.shotSpeed, tag).toBeGreaterThanOrEqual(a.shotSpeed);
      expect(b.budget[0] + b.budget[1], tag).toBeGreaterThanOrEqual(a.budget[0] + a.budget[1]);
      expect(b.championChance, tag).toBeGreaterThan(a.championChance);
    }
  });

  it('keeps hits fair: half a heart early, at most 2 hearts, speeds within +20%', () => {
    for (const r of rows) {
      expect(r.bossHpMult).toBeGreaterThanOrEqual(r.hpMult);
      expect(r.enemyDamage[1]).toBeGreaterThanOrEqual(Math.max(2, r.enemyDamage[0]));
      expect(r.enemyDamage[1]).toBeLessThanOrEqual(4);
      expect(r.enemySpeed).toBeLessThanOrEqual(1.2);
      expect(r.shotSpeed).toBeLessThanOrEqual(1.2);
      if (r.f <= 5) expect(r.enemyDamage).toEqual([1, 2]);
    }
  });

  it('no regular enemy outruns the keeper (92 px/s) with its floor speed bonus', () => {
    for (const e of Enemies.all()) {
      if (e.boss) continue;
      for (const f of e.floors ?? []) {
        const fl = floorAt(f);
        if (fl) expect((e.speed ?? 40) * (fl.enemySpeed ?? 1), `${e.id} on floor ${f}`).toBeLessThan(92);
      }
    }
  });

  it('bosses last ~40-100 s of baseline damage (HP x1.5 at the user\'s request, floors 1–2 x1.3, 2026-10-07)', () => {
    // the QA bot's median boss dps per floor (scripts/qa-run.mjs --suite balance, 4 characters x
    // 15 seeds; blessings, items, releases and dodging included): it grows ~1.45x per floor.
    for (const e of Enemies.all()) {
      if (!e.boss) continue;
      for (const fl of e.bossFloors ?? []) {
        const f = floorAt(fl);
        const dps = BOT_BOSS_DPS[fl];
        if (!f || !dps) continue;
        const seconds = (e.hp * (f.bossHpMult ?? f.hpMult)) / dps;
        expect(seconds, `${e.id} on floor ${fl}`).toBeGreaterThan(35);
        expect(seconds, `${e.id} on floor ${fl}`).toBeLessThan(105);
      }
    }
  });

  it('every defined floor uses its table row', () => {
    const fs = Floors.all().sort((a, b) => a.index - b.index);
    fs.forEach((f, i) => expect(f.index, f.id).toBe(i + 1));
    for (const f of fs) for (const k of KNOBS) expect(f[k], `${f.id}.${k}`).toEqual(DIFFICULTY[f.index][k]);
  });

  it('maps base hits to the floor damage', () => {
    const at = (d: [number, number]) => ({ enemyDamage: d }) as FloorDef;
    expect(enemyHitDamage(undefined, 1)).toBe(1);
    expect(enemyHitDamage(undefined, 2)).toBe(2);
    expect(enemyHitDamage(at([1, 2]), 1)).toBe(1);
    expect(enemyHitDamage(at([1, 2]), 2)).toBe(2);
    expect(enemyHitDamage(at([1, 3]), 1)).toBe(1);
    expect(enemyHitDamage(at([1, 3]), 2)).toBe(3);
    expect(enemyHitDamage(at([2, 3]), 1)).toBe(2);
    expect(enemyHitDamage(at([2, 3]), 2)).toBe(3);
    expect(enemyHitDamage(at([2, 4]), 0.4)).toBe(2);
    expect(enemyHitDamage(at([2, 4]), 3)).toBe(5);
  });
});

describe('shipped descent', () => {
  it('ends on the deepest defined floor (5 until deeper floors exist)', () => {
    const last = Math.max(...Floors.all().map((f) => f.index));
    expect(last).toBeGreaterThanOrEqual(5);
    expect(lastFloorIndex()).toBe(last);
    expect(isLastFloor(last)).toBe(true);
    expect(isLastFloor(last - 1)).toBe(false);
  });
});

// ------------------------------------------------------------------ deeper floors
/** Fake world for the boss room handler / descend logic. */
function fakeWorld(floor: number) {
  const ents: Entity[] = [];
  const w = {
    floor: floorAt(floor)!,
    run: { floor, lootRng: new RNG(1) },
    loot: { rollItem: () => null },
    transitioning: false,
    floorCard: null,
    spawn<T extends Entity>(e: T): T { ents.push(e); return e; },
    spawnEnemy(id: string) { return { def: Enemies.must(id), dormant: 0 }; },
    sfx() {},
    victory: vi.fn(),
    startFloor: vi.fn(),
    beginTransition() {},
    bossIntro: null as unknown,
  };
  const room = { centerX: 200, centerY: 120, markers: [] };
  return { w, room, ents };
}

describe('deeper floors (defined at runtime past the shipped last floor)', () => {
  // with today's content: L = 5, the test floors are 6 and 7
  const L = lastFloorIndex();
  const A = L + 1;
  const B = L + 2;
  beforeAll(() => {
    // the extra floors reuse the deepest floor's theme, music and enemies
    const deep = floorAt(L)!;
    const pool: Record<string, number> = {};
    for (const e of Enemies.all()) if (!e.boss && e.floors?.includes(L)) pool[e.id] = e.weight ?? 1;
    for (const i of [A, B]) {
      defineFloor({ index: i, id: `test_deep_${i}`, name: `${i}층 · 시험`, subtitle: '시험', theme: deep.theme, music: deep.music, enemies: pool, ...DIFFICULTY[Math.min(10, i)] });
    }
  });

  it('the last floor moves down', () => {
    expect(lastFloorIndex()).toBe(B);
    for (const f of [1, 5, L, A]) expect(isLastFloor(f), `floor ${f}`).toBe(false);
    expect(isLastFloor(B)).toBe(true);
  });

  it('generates valid deeper maps', () => {
    for (const i of [A, B]) {
      const f = floorAt(i)!;
      for (let s = 0; s < 40; s++) {
        const map = generateFloor(f, new RNG(`deep-${i}-${s}`));
        for (const k of ['start', 'boss', 'treasure', 'shop'] as const) expect(map.nodes.filter((n) => n.kind === k).length, `${i}/${s} ${k}`).toBe(1);
        const cells = map.nodes.filter((n) => n.kind !== 'secret').reduce((a, n) => a + n.cw * n.ch, 0);
        expect(cells).toBeGreaterThanOrEqual(f.roomCount[0]);
        expect(cells).toBeLessThanOrEqual(f.roomCount[1]);
      }
    }
  });

  it('descending continues past floor 5; only the last floor wins', () => {
    for (let from = 4; from < B; from++) {
      const { w } = fakeWorld(from);
      World.prototype.descend.call(w as unknown as World);
      expect(w.startFloor, `from ${from}`).toHaveBeenCalledWith(from + 1);
      expect(w.victory).not.toHaveBeenCalled();
    }
    const { w } = fakeWorld(B);
    World.prototype.descend.call(w as unknown as World);
    expect(w.startFloor).not.toHaveBeenCalled();
    expect(w.victory).toHaveBeenCalled();
  });

  it('the floor-5 boss (무명) leaves a trapdoor; only the last boss plays the victory cinematic', () => {
    const h = roomHandler('boss')!;
    const play = vi.spyOn(audio, 'playMusic').mockImplementation(() => {});
    for (const f of [5, A]) {
      const { w, room, ents } = fakeWorld(f);
      h.onClear!(w as unknown as World, room as never, new RNG(f));
      expect(ents.some((e) => e instanceof Trapdoor), `floor ${f}`).toBe(true);
      expect(ents.some((e) => e instanceof FinalDawn), `floor ${f}`).toBe(false);
    }
    const last = fakeWorld(B);
    h.onClear!(last.w as unknown as World, last.room as never, new RNG(7));
    expect(last.ents.some((e) => e instanceof FinalDawn)).toBe(true);
    expect(last.ents.some((e) => e instanceof Trapdoor)).toBe(false);
    // boss_final music only on the last floor (무명 is floor 5's boss)
    play.mockClear();
    const f5 = fakeWorld(5);
    h.spawnEnemies!(f5.w as unknown as World, f5.room as never, new RNG(3));
    expect(play).toHaveBeenCalledWith('boss');
    play.mockClear();
    const fb = fakeWorld(B);
    h.spawnEnemies!(fb.w as unknown as World, fb.room as never, new RNG(3));
    expect(play).toHaveBeenCalledWith('boss_final');
    play.mockRestore();
  });
});
