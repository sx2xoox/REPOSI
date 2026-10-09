// Floor 6 (수몰된 서고) extra regular enemy: 제본 거미 (binding_spider), the floor's support.
// Definition / sprites / spawn pool, the pure helpers, a 20 s headless run in the real World,
// the needle on a thread (telegraphed out, stuck with a return lane, reeled back exactly along
// it even when shoved, hurts both ways at base strength, sticks short of rocks, champion fan),
// mending (three stitches, capped, never itself or another spider, snapped by a hit -> dazed,
// slips when the ally leaves reach), movement (routes round rock pockets / pits, seeks torn
// allies, leaves far cover to throw), clean death, draw purity and lockstep.

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
import { clearWalk, coverSpot, handPos, MEND, NEEDLE, openSpot, pickMendTarget, RESTLESS, walkRoute, type MendCandidate } from '../src/content/enemies/archive-extra';

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

  it('openSpot never asks the spider to stand inside a rock; walkRoute goes round a wall, or to the nearest reachable spot', () => {
    const w = world(6, 'xf6-route');
    const room = w.room;
    const tx = Math.floor(room.centerX / TILE);
    const ty = Math.floor(room.centerY / TILE);
    room.setTile(tx, ty, Tile.ROCK);
    const gx = (tx + 0.5) * TILE;
    const gy = (ty + 0.5) * TILE;
    const s = openSpot(room, gx, gy, gx + 48, gy, 6);
    expect(room.boxBlocked(s.x, s.y, 6, false, false)).toBe(false);
    expect(s.x).toBeGreaterThan(gx);
    expect(Math.abs(s.y - gy)).toBeLessThan(1e-6);
    // a free goal is kept as is
    expect(openSpot(room, gx + 40, gy, gx + 80, gy, 6)).toEqual({ x: gx + 40, y: gy });
    // a wall of rock between (left) start and (right) goal: no straight walk, but a route
    for (let y = ty - 2; y <= ty + 2; y++) room.setTile(tx, y, Tile.ROCK);
    const a = { x: gx - 40, y: gy };
    const b = { x: gx + 40, y: gy };
    expect(clearWalk(room, a.x, a.y, b.x, b.y, 6)).toBe(false);
    const route = walkRoute(room, a.x, a.y, b.x, b.y);
    expect(route.length).toBeGreaterThan(4);
    let prev = { x: (Math.floor(a.x / TILE) + 0.5) * TILE, y: (Math.floor(a.y / TILE) + 0.5) * TILE };
    for (const n of route) {
      expect(room.blocks(Math.floor(n.x / TILE), Math.floor(n.y / TILE), false, false)).toBe(false);
      // one tile at a time
      expect(Math.abs(Math.floor(n.x / TILE) - Math.floor(prev.x / TILE)) + Math.abs(Math.floor(n.y / TILE) - Math.floor(prev.y / TILE))).toBe(1);
      prev = n;
    }
    expect(route[route.length - 1]).toEqual(b);
    // a goal sealed off by rock: the route ends at the reachable tile nearest to it
    for (let y = ty - 1; y <= ty + 1; y++) for (let x = tx + 2; x <= tx + 4; x++) if (x !== tx + 3 || y !== ty) room.setTile(x, y, Tile.ROCK);
    const sealed = { x: (tx + 3.5) * TILE, y: (ty + 0.5) * TILE };
    const r2 = walkRoute(room, a.x, a.y, sealed.x, sealed.y);
    const end = r2[r2.length - 1];
    expect(room.blocks(Math.floor(end.x / TILE), Math.floor(end.y / TILE), false, false)).toBe(false);
    expect(Math.hypot(end.x - sealed.x, end.y - sealed.y)).toBeLessThanOrEqual(2 * TILE + 1);
    // ... and when the walker already stands on that nearest tile, it stays there (never walks into the rock)
    const shore = { x: (tx + 5.5) * TILE, y: (ty + 0.5) * TILE };
    expect(walkRoute(room, shore.x + 3, shore.y - 2, sealed.x, sealed.y)).toEqual([shore]);
    // already in the goal's tile: nothing to route
    expect(walkRoute(room, a.x, a.y, a.x + 2, a.y + 1)).toEqual([]);
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

  it('a champion throws three needles: the aimed one plus one either side (standing still is never safe)', () => {
    const w = world(6, 'xf6-champ');
    w.player.god = true;
    const e = spawn(w, ID, 100, 0);
    e.champion = true;
    e.championColor = '#ff4040';
    const first = untilThrow(w);
    const all = needles(w);
    expect(all).toHaveLength(3);
    const aim = Math.atan2(w.player.y - e.y, w.player.x - e.x);
    const rel = all.map((n) => Math.atan2(Math.sin(n.angle - aim), Math.cos(n.angle - aim))).sort((a, b) => a - b);
    expect(rel[0]).toBeLessThan(-0.15);
    expect(Math.abs(rel[1])).toBeLessThan(0.05);
    expect(rel[2]).toBeGreaterThan(0.15);
    for (const n of all) expect(n.damage).toBe(1);
    expect(first.damage).toBe(1);
  });

  it('the needle leaves along the warned lane even if a hit shoves the spider during the wind-up', () => {
    const w = world(6, 'xf6-shove');
    w.player.god = true;
    const e = spawn(w, ID, 100, 0);
    for (let i = 0; i < secs(8) && e.telegraphT <= 0; i++) w.update(FIXED_DT);
    expect(e.telegraphT).toBeGreaterThan(0);
    const lane = warnings(w).filter((g) => g.rw > 0).pop()!;
    expect(lane).toBeDefined();
    e.knock(0, 1, 250);
    let n: Projectile | undefined;
    for (let i = 0; i < secs(2) && !n; i++) {
      w.update(FIXED_DT);
      n = needles(w)[0];
    }
    expect(n).toBeDefined();
    expect(Math.abs(e.y - lane.y)).toBeGreaterThan(8);
    const perp = Math.abs(-Math.sin(lane.angle) * (n!.x - lane.x) + Math.cos(lane.angle) * (n!.y - lane.y));
    expect(perp).toBeLessThan(1.5);
  });

  it('the reel follows the warned return lane exactly, even if the spider is knocked aside meanwhile', () => {
    const w = world(6, 'xf6-reel-lane');
    const p = w.player;
    p.god = true;
    const e = spawn(w, ID, 100, 0);
    const n = untilThrow(w);
    p.y -= 40;
    for (let i = 0; i < secs(2) && (n.mem.st ?? 0) !== 1; i++) w.update(FIXED_DT);
    expect(n.mem.st).toBe(1);
    const back = warnings(w).filter((g) => g.rw > 0).pop()!;
    expect(back).toBeDefined();
    let knocked = false;
    let dev = 0;
    let reeled = 0;
    for (let i = 0; i < secs(3) && !n.dead; i++) {
      w.update(FIXED_DT);
      if ((n.mem.st ?? 0) !== 2) continue;
      if (!knocked) {
        e.knock(0, 1, 250);
        knocked = true;
      }
      reeled++;
      dev = Math.max(dev, Math.abs(-Math.sin(back.angle) * (n.x - back.x) + Math.cos(back.angle) * (n.y - back.y)));
      // never past the end of the warned lane
      expect((n.x - back.x) * Math.cos(back.angle) + (n.y - back.y) * Math.sin(back.angle)).toBeLessThanOrEqual(back.rw + 1);
    }
    expect(reeled).toBeGreaterThan(5);
    expect(dev).toBeLessThan(0.5);
    expect(n.dead).toBe(true);
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

  it('an ally that leaves the thread\'s reach slips it: no more stitches, no daze, and the thread is never drawn across the room', () => {
    const { w, e, g } = scene('xf6-slip', 0.4);
    for (let i = 0; i < secs(5) && !(e.mem.sewing && e.mem.sewK >= 1); i++) w.update(FIXED_DT);
    expect(e.mem.sewing).toBe(1);
    const room = w.room;
    g.x = room.interiorX + 20;
    g.y = room.interiorY + 20;
    e.x = room.interiorX + room.interiorW - 20;
    e.y = room.interiorY + room.interiorH - 20;
    const h0 = g.hp;
    let maxLen = 0;
    steps(w, secs(2), () => {
      if (e.mem.sewing) maxLen = Math.max(maxLen, Math.hypot(g.x - e.x, g.y - e.y));
      expect(e.mem.dazed ?? 0).toBe(0);
    });
    expect(g.hp).toBeLessThanOrEqual(h0);
    expect(maxLen).toBeLessThanOrEqual(MEND.range + 5);
    expect(e.mem.sewing).toBe(0);
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

// ---------------------------------------------------------------- moving around book piles
describe('제본 거미 movement', () => {
  it('walks out of a rock pocket around to its cover spot instead of pressing into the corner', () => {
    const w = world(6, 'xf6-pocket');
    const p = w.player;
    p.god = true;
    const room = w.room;
    const cx = Math.floor(p.x / TILE);
    const cy = Math.floor(p.y / TILE);
    // a stationary ally to hide behind, to the keeper's right
    const ty = w.spawnEnemy('ghost_typewriter', (cx + 4.5) * TILE, (cy + 0.5) * TILE)!;
    // the spider sits in a pocket that is closed toward its cover spot (up and to the right)
    const sx = cx + 2;
    const sy = cy + 3;
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [1, 0]]) room.setTile(sx + dx, sy + dy, Tile.ROCK);
    for (const [dx, dy] of [[0, 0], [0, 1], [-1, 0], [-1, 1], [1, 1], [2, 1], [2, 0], [2, -1]]) expect(room.tileAt(sx + dx, sy + dy), `${dx},${dy}`).toBe(Tile.FLOOR);
    const e = w.spawnEnemy(ID, (sx + 0.5) * TILE, (sy + 0.5) * TILE)!;
    const goal = { x: ty.x + 24 + ty.r, y: ty.y };
    let best = Infinity;
    let pressing = 0;
    let lx = e.x;
    let ly = e.y;
    steps(w, secs(8), () => {
      best = Math.min(best, Math.hypot(e.x - goal.x, e.y - goal.y));
      if (Math.hypot(e.wantVX, e.wantVY) > 1 && Math.hypot(e.x - lx, e.y - ly) < 0.05) pressing += FIXED_DT;
      lx = e.x;
      ly = e.y;
    });
    expect(best).toBeLessThan(16);
    expect(pressing).toBeLessThan(0.5);
  });

  it('heads over to a torn ally beyond the thread\'s reach (past nearer healthy cover) and sews it', () => {
    const w = world(6, 'xf6-farmend');
    const p = w.player;
    p.god = true;
    const room = w.room;
    // a stationary ally (typewriter) torn up at one end of the room, the spider at the other
    const t = w.spawnEnemy('ghost_typewriter', room.interiorX + 24, room.centerY)!;
    t.hp = t.maxHp * 0.4;
    const e = w.spawnEnemy(ID, room.interiorX + room.interiorW - 24, room.centerY + 20)!;
    // healthy cover right next to the spider (it would rather hide there if nobody needed sewing)
    w.spawnEnemy('ghost_typewriter', room.interiorX + room.interiorW - 50, room.centerY);
    p.x = room.centerX;
    p.y = room.interiorY + room.interiorH - 20;
    expect(Math.hypot(t.x - e.x, t.y - e.y)).toBeGreaterThan(MEND.range + 20);
    let healed = false;
    steps(w, secs(9), () => {
      if (t.hp > t.maxHp * 0.4 + 1) healed = true;
    });
    expect(healed).toBe(true);
  });

  it('a torn ally on an island past a pit: it walks to the shore, sews across, and never pushes into the pit', () => {
    const w = world(6, 'xf6-moat');
    const p = w.player;
    p.god = true;
    const room = w.room;
    // a pit ring (radius 4 tiles) around an island at the left of the room; the cover spot
    // behind the torn ally lies on the island, out of the spider's reach
    const tx = Math.floor(room.interiorX / TILE) + 4;
    const ty = Math.floor(room.centerY / TILE);
    for (let y = ty - 4; y <= ty + 4; y++) for (let x = tx - 4; x <= tx + 4; x++) if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) === 4 && room.tileAt(x, y) === Tile.FLOOR) room.setTile(x, y, Tile.PIT);
    const t = w.spawnEnemy('ghost_typewriter', (tx + 0.5) * TILE, (ty + 0.5) * TILE)!;
    t.hp = t.maxHp * 0.4;
    const e = w.spawnEnemy(ID, room.interiorX + room.interiorW - 20, room.centerY - 8)!;
    p.x = room.interiorX + room.interiorW - 60;
    p.y = room.interiorY + room.interiorH - 14;
    expect(Math.hypot(t.x - e.x, t.y - e.y)).toBeGreaterThan(MEND.range);
    let pressing = 0;
    let healed = false;
    let lx = e.x;
    let ly = e.y;
    steps(w, secs(10), () => {
      if (Math.hypot(e.wantVX, e.wantVY) > 1 && Math.hypot(e.x - lx, e.y - ly) < 0.05) pressing += FIXED_DT;
      lx = e.x;
      ly = e.y;
      if (t.hp > t.maxHp * 0.4 + 1) healed = true;
      expect(Math.max(Math.abs(Math.floor(e.x / TILE) - tx), Math.abs(Math.floor(e.y / TILE) - ty))).toBeGreaterThan(4);
    });
    expect(healed).toBe(true);
    expect(pressing).toBeLessThan(0.5);
  });

  it('does not sit behind far-off cover forever: with nothing to sew it comes out to throw', () => {
    const w = world(6, 'xf6-restless');
    const p = w.player;
    p.god = true;
    const room = w.room;
    // healthy, stationary cover far from the keeper
    w.spawnEnemy('ghost_typewriter', room.interiorX + room.interiorW - 40, room.interiorY + 24);
    p.x = room.interiorX + 30;
    p.y = room.interiorY + room.interiorH - 24;
    const e = w.spawnEnemy(ID, room.interiorX + room.interiorW - 20, room.interiorY + 20)!;
    expect(Math.hypot(e.x - p.x, e.y - p.y)).toBeGreaterThan(NEEDLE.reach + 40);
    let first = -1;
    steps(w, secs(RESTLESS + 7), (i) => {
      if (first < 0 && needles(w).length) first = i * FIXED_DT;
    });
    expect(first).toBeGreaterThan(0);
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
