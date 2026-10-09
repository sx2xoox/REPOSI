// Floor 6 (수몰된 서고) extra regular enemy: 제본 거미 (binding_spider), the floor's support.
// Definition / sprites / spawn pool, the pure helpers, a 20 s headless run in the real World,
// the needle on a thread (telegraphed out, stuck with a return lane, reeled back, hurts both
// ways at base strength, sticks short of rocks), mending (three stitches, capped, never itself
// or another spider, snapped by a hit -> dazed), clean death, draw purity and lockstep.

import './headless';
import { fakeDisplay } from './headless';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Enemies, Floors } from '../src/game/defs';
import { Enemy } from '../src/game/enemy';
import { GroundWarning } from '../src/game/effects';
import { Projectile } from '../src/game/projectile';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Renderer } from '../src/engine/renderer';
import { FIXED_DT, TILE } from '../src/game/constants';
import { clearInput, fixedRules } from '../src/game/seam';
import { stateHash } from '../src/game/statehash';
import { Tile } from '../src/game/tiles';
import { getAnim, hasAnim, hasSprite } from '../src/engine/sprites';
import { RNG, fx } from '../src/engine/rng';
import { coverSpot, handPos, MEND, NEEDLE, pickMendTarget, type MendCandidate } from '../src/content/enemies/archive-extra';

loadContent();

const ID = 'binding_spider';

// ---------------------------------------------------------------- real World harness
let renderer: Renderer | null = null;

/** A fresh run standing in the start room of `floor`, no enemies, the keeper idle. */
function world(floor: number, seed: string): World {
  renderer ??= new Renderer(fakeDisplay(1280, 720));
  const run = new RunState(seed, 'ria');
  run.seeded = true;
  const w = new World(renderer, run, { openInventory() {}, onGameOver() {} });
  w.rules = fixedRules({ hitStop: false });
  w.inputSource = (_w, _p, o) => clearInput(o);
  w.start();
  if (w.run.floor !== floor) w.startFloor(floor);
  steps(w, 30);
  for (const e of [...w.enemies]) w.killEnemy(e);
  const p = w.player;
  p.x = w.room.centerX;
  p.y = w.room.centerY;
  p.soul = 60;
  steps(w, 2);
  return w;
}

function steps(w: World, n: number, each?: (i: number) => void): void {
  for (let i = 0; i < n; i++) {
    w.update(FIXED_DT);
    each?.(i);
  }
}
const secs = (s: number) => Math.round(s / FIXED_DT);

/** Keeper keeps strafing around the room centre (never walks out of a door). */
function strafe(w: World): void {
  const cx = w.room.centerX;
  const cy = w.room.centerY;
  w.inputSource = (ww, p, o) => {
    clearInput(o);
    const gx = cx + Math.cos(ww.time * 0.9) * 50;
    const gy = cy + Math.sin(ww.time * 1.3) * 26;
    const dx = gx - p.x;
    const dy = gy - p.y;
    const l = Math.hypot(dx, dy);
    if (l > 3) {
      o.mx = dx / l;
      o.my = dy / l;
    }
  };
}

function spawn(w: World, id: string, dx = 80, dy = -20): Enemy {
  const p = w.player;
  const e = w.spawnEnemy(id, p.x + dx, p.y + dy)!;
  expect(e, id).toBeTruthy();
  return e;
}

const hp = (w: World) => w.player.red + w.player.soul;
const needles = (w: World) => w.projectiles.filter((p) => p.team === 'enemy' && !p.dead && p.behaviors.some((b) => b.id === 'bspider-needle'));
const warnings = (w: World) => w.entities.filter((x) => x instanceof GroundWarning && !x.dead) as GroundWarning[];

function spriteDefined(name: string): boolean {
  if (hasAnim(name)) {
    const a = getAnim(name)!;
    return a.frames.length > 0 && a.frames.every((f) => hasSprite(f));
  }
  return hasSprite(name);
}

// ---------------------------------------------------------------- definition
describe('제본 거미 definition', () => {
  it('is a regular floor-6 enemy with a Korean name, light, death look and a script', () => {
    const d = Enemies.must(ID);
    expect(d.floors).toEqual([6]);
    expect(d.boss).toBeFalsy();
    expect(d.name).toBe('제본 거미');
    expect(d.champion).toBe(true);
    expect(d.light?.radius).toBeGreaterThan(0);
    expect(d.light?.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(d.deathFx).toBeDefined();
    expect(d.bloodColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(d.script).toBeTypeOf('function');
    expect(d.onHurt).toBeTypeOf('function');
  });

  it('follows the stat guide: regular HP, under the keeper speed on floor 6, base-strength contact', () => {
    const d = Enemies.must(ID);
    expect(d.hp).toBeGreaterThanOrEqual(25);
    expect(d.hp).toBeLessThanOrEqual(45);
    const f6 = Floors.all().find((f) => f.index === 6)!;
    expect((d.speed ?? 40) * (f6.enemySpeed ?? 1)).toBeLessThan(92);
    expect(d.contactDamage ?? 1).toBeLessThanOrEqual(1);
    expect(d.radius).toBeGreaterThanOrEqual(4);
    expect(d.radius).toBeLessThanOrEqual(8);
  });

  it('cost and weight sit inside the range of the floor\'s other regulars; it is in the floor-6 pool', () => {
    const others = Enemies.all().filter((e) => !e.boss && e.id !== ID && e.floors?.includes(6));
    expect(others.length).toBeGreaterThanOrEqual(8);
    const d = Enemies.must(ID);
    const costs = others.map((e) => e.cost ?? 1);
    const weights = others.map((e) => e.weight ?? 1);
    expect(d.cost ?? 1).toBeGreaterThanOrEqual(Math.min(...costs));
    expect(d.cost ?? 1).toBeLessThanOrEqual(Math.max(...costs));
    expect(d.weight ?? 1).toBeGreaterThanOrEqual(Math.min(...weights));
    expect(d.weight ?? 1).toBeLessThanOrEqual(Math.max(...weights));
    const w = world(6, 'xf6-pool');
    const pool = w.enemyPool();
    expect(pool[ID]).toBe(d.weight);
    const total = Object.values(pool).reduce((a, b) => a + b, 0);
    expect(pool[ID] / total).toBeGreaterThan(0.04);
    expect(pool[ID] / total).toBeLessThan(0.15);
  });

  it('has idle / walk / wind-up / reel / sew / daze / hurt animations and a needle sprite', () => {
    for (const s of ['idle', 'walk', 'aim', 'reel', 'sew', 'daze', 'hurt']) expect(spriteDefined(`bspider_${s}`), s).toBe(true);
    expect(getAnim('bspider_walk')!.frames.length).toBeGreaterThanOrEqual(4);
    expect(getAnim('bspider_aim')!.frames.length).toBeGreaterThanOrEqual(2);
    expect(getAnim('bspider_sew')!.frames.length).toBeGreaterThanOrEqual(2);
    expect(spriteDefined(Enemies.must(ID).sprite)).toBe(true);
    expect(hasSprite('__bspider_needle')).toBe(true);
  });

  it('every telegraph is at least 0.3 s', () => {
    expect(NEEDLE.windup).toBeGreaterThanOrEqual(0.3);
    expect(NEEDLE.stuck).toBeGreaterThanOrEqual(0.3);
  });
});

// ---------------------------------------------------------------- pure helpers
describe('제본 거미 helpers', () => {
  it('coverSpot stands behind the ally, on the far side from the keeper', () => {
    const s = coverSpot(100, 50, 40, 50, 20);
    expect(s.x).toBeCloseTo(120);
    expect(s.y).toBeCloseTo(50);
    const t = coverSpot(0, 0, 0, -30, 10);
    expect(t.x).toBeCloseTo(0);
    expect(t.y).toBeCloseTo(10);
    // degenerate: keeper on the ally
    expect(Number.isFinite(coverSpot(5, 5, 5, 5).x)).toBe(true);
  });

  it('pickMendTarget takes the most torn-up ally in range, never a spider, a hidden one or a fresh mend', () => {
    const c = (o: Partial<MendCandidate>): MendCandidate => ({ id: 'shelf_golem', hp: 50, maxHp: 100, x: 10, y: 0, ok: true, mendedAt: -99, ...o });
    expect(pickMendTarget([c({ hp: 70 }), c({ hp: 40 }), c({ hp: 60 })], 0, 0, 10)).toBe(1);
    // above the threshold: nobody
    expect(pickMendTarget([c({ hp: 85 }), c({ hp: 100 })], 0, 0, 10)).toBe(-1);
    // another spider, a not-ok one (hidden / boss / dormant), out of range, mended a moment ago
    expect(pickMendTarget([c({ id: 'binding_spider', hp: 10 })], 0, 0, 10)).toBe(-1);
    expect(pickMendTarget([c({ ok: false, hp: 10 })], 0, 0, 10)).toBe(-1);
    expect(pickMendTarget([c({ x: MEND.range + 5, hp: 10 })], 0, 0, 10)).toBe(-1);
    expect(pickMendTarget([c({ hp: 10, mendedAt: 9 })], 0, 0, 10)).toBe(-1);
    expect(pickMendTarget([c({ hp: 10, mendedAt: 10 - MEND.again - 0.1 })], 0, 0, 10)).toBe(0);
  });
});

// ---------------------------------------------------------------- headless run
describe('제본 거미 headless run (real World, floor 6)', () => {
  it('20 s alone with a strafing keeper: stays in the room, telegraphs ≥ 0.3 s before every needle, hits at base strength', () => {
    const w = world(6, 'xf6-run');
    const room = w.room;
    strafe(w);
    const e = spawn(w, ID, 90, -20);
    const seen = new Set<Projectile>();
    let throws = 0;
    let telStart = -1;
    const gaps: number[] = [];
    let lastStuck = new Map<Projectile, number>();
    const stuckFor: number[] = [];
    let stuckWarned = 0;
    let stuckSeen = 0;
    steps(w, secs(20), (i) => {
      for (const o of w.enemies) {
        expect(Number.isFinite(o.x) && Number.isFinite(o.y), o.def.id).toBe(true);
        expect(o.x).toBeGreaterThan(room.interiorX - 4);
        expect(o.y).toBeGreaterThan(room.interiorY - 4);
        expect(o.x).toBeLessThan(room.interiorX + room.interiorW + 4);
        expect(o.y).toBeLessThan(room.interiorY + room.interiorH + 4);
      }
      if (e.telegraphT > 0 && telStart < 0) telStart = i;
      const ns = needles(w);
      const fresh = ns.filter((n) => !seen.has(n));
      if (fresh.length) {
        throws++;
        expect(telStart, 'telegraph before the throw').toBeGreaterThanOrEqual(0);
        gaps.push((i - telStart) * FIXED_DT);
        telStart = -1;
        for (const n of fresh) {
          seen.add(n);
          expect(n.damage).toBe(1);
          expect(n.owner).toBe(e);
        }
      }
      // the stuck phase: a return lane is on the floor and it lasts ≥ 0.3 s before the reel
      for (const n of ns) {
        const st = n.mem.st ?? 0;
        if (st === 1) {
          if (!lastStuck.has(n)) {
            lastStuck.set(n, i);
            stuckSeen++;
            if (warnings(w).some((g) => g.rw > 0)) stuckWarned++;
          }
        } else if (st === 2 && lastStuck.has(n) && lastStuck.get(n)! >= 0) {
          stuckFor.push((i - lastStuck.get(n)!) * FIXED_DT);
          lastStuck.set(n, -1);
        }
      }
      w.player.soul = Math.max(w.player.soul, 40);
    });
    lastStuck = new Map();
    expect(throws).toBeGreaterThanOrEqual(3);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(stuckSeen).toBeGreaterThanOrEqual(1);
    expect(stuckWarned).toBe(stuckSeen);
    for (const s of stuckFor) expect(s).toBeGreaterThanOrEqual(0.3);
    // it can die, and leaves nothing behind
    e.takeHit(w, { damage: 1e6, kind: 'projectile', dirX: 1, dirY: 0 });
    steps(w, 2);
    expect(e.dead).toBe(true);
    expect(needles(w)).toHaveLength(0);
    steps(w, secs(1));
    expect(warnings(w)).toHaveLength(0);
    expect(w.enemies.filter((o) => o.alive)).toHaveLength(0);
  }, 30000);
});

// ---------------------------------------------------------------- the needle on a thread
describe('needle on a thread', () => {
  /** Run until the first needle exists (keeper stays put during the wind-up). */
  function untilThrow(w: World, max = 8): Projectile {
    let n: Projectile | undefined;
    for (let i = 0; i < secs(max) && !n; i++) {
      w.update(FIXED_DT);
      n = needles(w)[0];
    }
    expect(n, 'a needle was thrown').toBeDefined();
    return n!;
  }

  it('flies out along the lane, sticks still, then is reeled back to the spider and caught', () => {
    const w = world(6, 'xf6-needle');
    const p = w.player;
    p.god = true;
    const e = spawn(w, ID, 100, 0);
    const n = untilThrow(w);
    const a = n.angle;
    // the keeper sidesteps: the needle flies its full length
    p.y -= 40;
    let stuckAt: { x: number; y: number } | null = null;
    let maxOut = 0;
    let caught = false;
    let prevD = Infinity;
    let returning = 0;
    for (let i = 0; i < secs(4) && !n.dead; i++) {
      w.update(FIXED_DT);
      const d = Math.hypot(n.x - e.x, n.y - e.y);
      const st = n.mem.st ?? 0;
      if (st === 0) maxOut = Math.max(maxOut, d);
      if (st === 1) {
        stuckAt ??= { x: n.x, y: n.y };
        expect(n.x).toBeCloseTo(stuckAt.x, 6);
        expect(n.y).toBeCloseTo(stuckAt.y, 6);
        const off = Math.atan2(n.y - e.y, n.x - e.x) - a;
        expect(Math.abs(Math.atan2(Math.sin(off), Math.cos(off)))).toBeLessThan(0.05);
      }
      if (st === 2) {
        // reeled straight back to the spider's front legs
        const h = handPos(e);
        const dh = Math.hypot(n.x - h.x, n.y - h.y);
        returning++;
        expect(dh).toBeLessThanOrEqual(prevD + 1e-6);
        prevD = dh;
      }
      if (n.dead) caught = st === 2;
    }
    expect(stuckAt).not.toBeNull();
    expect(maxOut).toBeGreaterThan(NEEDLE.reach * 0.7);
    expect(maxOut).toBeLessThanOrEqual(NEEDLE.reach + 12);
    expect(returning).toBeGreaterThan(5);
    expect(n.dead).toBe(true);
    expect(caught).toBe(true);
    expect(prevD).toBeLessThan(NEEDLE.catchR + 5);
  });

  it('hurts a keeper standing on the line on the way back, for one half-heart (base strength)', () => {
    const w = world(6, 'xf6-back');
    const p = w.player;
    const e = spawn(w, ID, 100, 0);
    p.god = true;
    const n = untilThrow(w);
    p.y -= 40;
    // wait until it is stuck, then stand on the line between it and the spider
    for (let i = 0; i < secs(2) && (n.mem.st ?? 0) !== 1; i++) w.update(FIXED_DT);
    expect(n.mem.st).toBe(1);
    p.god = false;
    p.invuln = 0;
    const h = handPos(e);
    // (a keeper is hit around 4 px above its feet)
    p.x = (n.x + h.x) / 2;
    p.y = (n.y + h.y) / 2 + 4;
    const before = hp(w);
    let hit = false;
    for (let i = 0; i < secs(2) && !n.dead; i++) {
      w.update(FIXED_DT);
      if (hp(w) < before) hit = true;
    }
    expect(hit).toBe(true);
    expect(before - hp(w)).toBe(1);
    expect(n.dead).toBe(true);
  });

  it('sticks short of a rock instead of breaking, and still comes back', () => {
    const w = world(6, 'xf6-rock');
    const p = w.player;
    p.god = true;
    const e = spawn(w, ID, 70, 0);
    // a column of book piles behind the keeper (the line of sight to the keeper stays clear)
    const tx = Math.floor((p.x - 34) / TILE);
    for (let ty = 0; ty < w.room.h; ty++) if (w.room.tileAt(tx, ty) === Tile.FLOOR) w.room.setTile(tx, ty, Tile.ROCK);
    const n = untilThrow(w);
    p.y -= 40;
    let stuck: { x: number; y: number; traveled: number } | null = null;
    for (let i = 0; i < secs(4) && !n.dead; i++) {
      w.update(FIXED_DT);
      if ((n.mem.st ?? 0) === 1 && !stuck) stuck = { x: n.x, y: n.y, traveled: n.traveled };
    }
    expect(stuck).not.toBeNull();
    expect(stuck!.traveled).toBeLessThan(NEEDLE.reach - 4);
    expect(w.room.tileAt(Math.floor(stuck!.x / TILE), Math.floor(stuck!.y / TILE))).not.toBe(Tile.ROCK);
    expect(n.dead).toBe(true);
    expect(e.alive).toBe(true);
  });

  it('a champion throws two needles, one either side of the keeper', () => {
    const w = world(6, 'xf6-champ');
    w.player.god = true;
    const e = spawn(w, ID, 100, 0);
    e.champion = true;
    e.championColor = '#ff4040';
    const first = untilThrow(w);
    const all = needles(w);
    expect(all).toHaveLength(2);
    const aim = Math.atan2(w.player.y - e.y, w.player.x - e.x);
    const rel = all.map((n) => Math.atan2(Math.sin(n.angle - aim), Math.cos(n.angle - aim))).sort((a, b) => a - b);
    expect(rel[0]).toBeLessThan(-0.15);
    expect(rel[1]).toBeGreaterThan(0.15);
    expect(first.damage).toBe(1);
  });

  it('when the spider dies its needles go slack and vanish', () => {
    const w = world(6, 'xf6-slack');
    w.player.god = true;
    const e = spawn(w, ID, 100, 0);
    untilThrow(w);
    w.player.y -= 40;
    steps(w, 10);
    expect(needles(w).length).toBeGreaterThan(0);
    e.takeHit(w, { damage: 1e6, kind: 'projectile', dirX: 1, dirY: 0 });
    steps(w, 2);
    expect(needles(w)).toHaveLength(0);
    steps(w, secs(1));
    expect(warnings(w)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- mending
describe('mending', () => {
  /** Golem at `frac` of its HP 60 px from the keeper, spider behind it. */
  function scene(seed: string, frac: number): { w: World; e: Enemy; g: Enemy } {
    const w = world(6, seed);
    w.player.god = true;
    const g = spawn(w, 'shelf_golem', 60, -30);
    const e = spawn(w, ID, 100, -10);
    g.hp = g.maxHp * frac;
    return { w, e, g };
  }

  it('sews a torn ally: three stitches, each restoring 8 % of its max HP', () => {
    const { w, e, g } = scene('xf6-mend', 0.5);
    const start = g.hp;
    const rises: number[] = [];
    let prev = g.hp;
    let sewing = false;
    steps(w, secs(5), () => {
      if (e.mem.sewing) sewing = true;
      if (g.hp > prev + 1e-9) rises.push(g.hp - prev);
      prev = g.hp;
    });
    expect(sewing).toBe(true);
    expect(rises).toHaveLength(MEND.stitches);
    for (const r of rises) expect(r).toBeCloseTo(g.maxHp * MEND.stitch, 6);
    expect(g.hp).toBeCloseTo(start + MEND.stitches * MEND.stitch * g.maxHp, 6);
    expect(g.mem.__mendedAt).toBeGreaterThan(0);
  });

  it('never sews past full health', () => {
    const { w, g } = scene('xf6-cap', 0.78);
    let max = 0;
    steps(w, secs(6), () => (max = Math.max(max, g.hp)));
    expect(max).toBeLessThanOrEqual(g.maxHp);
    expect(g.hp).toBe(g.maxHp);
  });

  it('a direct hit while it sews snaps the thread: no more stitches, the spider is dazed and harmless for a moment', () => {
    const { w, e, g } = scene('xf6-snap', 0.5);
    for (let i = 0; i < secs(5) && !(e.mem.sewing && e.mem.sewK >= 1); i++) w.update(FIXED_DT);
    expect(e.mem.sewing).toBe(1);
    const hpAtHit = g.hp;
    e.takeHit(w, { damage: 1, kind: 'projectile', dirX: 1, dirY: 0 });
    steps(w, 2);
    expect(e.mem.sewing).toBe(0);
    expect(e.mem.dazed).toBe(1);
    expect(e.anim).toBe('bspider_daze');
    const dazeSteps = secs(MEND.daze) - 4;
    steps(w, dazeSteps, () => {
      expect(g.hp).toBe(hpAtHit);
      expect(needles(w)).toHaveLength(0);
      expect(e.telegraphT).toBeLessThanOrEqual(0);
    });
    steps(w, secs(0.3));
    expect(e.mem.dazed).toBe(0);
  });

  it('a damage-over-time tick does not snap the thread', () => {
    const { w, e, g } = scene('xf6-dot', 0.5);
    for (let i = 0; i < secs(5) && !(e.mem.sewing && e.mem.sewK >= 1); i++) w.update(FIXED_DT);
    const start = g.hp;
    e.takeHit(w, { damage: 1, kind: 'status', dirX: 0, dirY: 0 });
    steps(w, secs(1.5));
    expect(g.hp).toBeGreaterThan(start);
  });

  it('never mends another binding spider, and leaves healthy allies alone', () => {
    const w = world(6, 'xf6-self');
    w.player.god = true;
    const a = spawn(w, ID, 90, -20);
    const b = spawn(w, ID, 110, 10);
    b.hp = b.maxHp * 0.3;
    const g = spawn(w, 'shelf_golem', 50, -40);
    let sewing = false;
    let bMax = b.hp;
    steps(w, secs(8), () => {
      if (a.mem.sewing || b.mem.sewing) sewing = true;
      bMax = Math.max(bMax, b.hp);
    });
    expect(g.hp).toBe(g.maxHp);
    expect(sewing).toBe(false);
    expect(bMax).toBeCloseTo(b.maxHp * 0.3, 6);
  });

  it('killed mid-stitch: the ally stops healing and nothing is left behind', () => {
    const { w, e, g } = scene('xf6-kill', 0.5);
    for (let i = 0; i < secs(5) && !(e.mem.sewing && e.mem.sewK >= 1); i++) w.update(FIXED_DT);
    e.takeHit(w, { damage: 1e6, kind: 'projectile', dirX: 1, dirY: 0 });
    steps(w, 2);
    const after = g.hp;
    steps(w, secs(2));
    expect(e.dead).toBe(true);
    expect(g.hp).toBeLessThanOrEqual(after);
    expect(needles(w)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- purity / lockstep
describe('제본 거미 draw purity and lockstep', () => {
  it('drawing never changes the simulation state', () => {
    const w = world(6, 'xf6-pure');
    w.player.god = true;
    strafe(w);
    const g = spawn(w, 'shelf_golem', 50, -40);
    g.hp = g.maxHp * 0.5;
    spawn(w, ID, 80, -10);
    for (let i = 0; i < 480; i++) {
      w.update(FIXED_DT);
      if (i % 3 !== 0) continue;
      const before = stateHash(w);
      w.draw(1);
      expect(stateHash(w), `step ${i}`).toBe(before);
    }
  }, 60000);

  it('the simulation does not depend on the cosmetic rng or on drawing', () => {
    const run = (fxSeed: number, draw: boolean): number[] => {
      fx.setState(new RNG(fxSeed).getState());
      const w = world(6, 'xf6-det');
      w.player.god = true;
      strafe(w);
      const g = spawn(w, 'shelf_golem', 50, -40);
      g.hp = g.maxHp * 0.5;
      spawn(w, ID, 80, -10);
      const hs: number[] = [];
      for (let i = 0; i < 600; i++) {
        w.update(FIXED_DT);
        if (draw && i % 2) w.draw(1);
        hs.push(stateHash(w));
      }
      return hs;
    };
    const a = run(1, false);
    const b = run(0x9e3779b9, true);
    const first = a.findIndex((h, i) => h !== b[i]);
    expect(first, `diverged at step ${first}`).toBe(-1);
  }, 60000);
});
