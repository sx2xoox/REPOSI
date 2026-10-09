// The extra floor-4 enemy (얼어붙은 성소): 얼음 순례자, a procession of four pilgrims that
// walks as one line around the keeper and chants a ripple of candle flames out of both
// sides of the line. Definition, the line (spawn, follow, split, detach), the chant
// (telegraph before every flame, perpendicular to the line, base-strength hits), 20 s in
// the real World, clean deaths, draw purity and lockstep determinism (solo + co-op).

import './headless';
import { fakeDisplay } from './headless';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Renderer } from '../src/engine/renderer';
import { World, type WorldHost } from '../src/game/world';
import { RunState } from '../src/game/run';
import { FIXED_DT } from '../src/game/constants';
import { fixedRules } from '../src/game/seam';
import { Enemies, Floors } from '../src/game/defs';
import { Enemy } from '../src/game/enemy';
import { Entity } from '../src/game/entity';
import { Projectile } from '../src/game/projectile';
import { getAnim, getSprite, hasAnim, hasSprite } from '../src/engine/sprites';
import { fx, RNG } from '../src/engine/rng';
import { angleDiff } from '../src/engine/math';
import { stateHash } from '../src/game/statehash';
import { runCoop } from './coopsim';
import {
  CHANT_REST, CHANT_STAGGER, CHANT_TELL, FLAME_SPEED, PILGRIM_ID, PROC_DETACH, PROC_GAP, PROC_LEN, followSpeed, lineNormals,
  orbitGoal, procession,
} from '../src/content/enemies/sanctum-extra';

loadContent();

const FLOOR = 4;

// ---------------------------------------------------------------- real-World arena
const host: WorldHost = { openInventory() {}, onGameOver() {} };
let renderer: Renderer | null = null;

interface Hurt { t: number; src: string }

/** A real World on floor 4 (its start room, emptied), keeper idle, hurts logged instead of applied. */
function arena(seed: string) {
  renderer ??= new Renderer(fakeDisplay(1280, 720));
  const run = new RunState(seed, 'ria');
  run.seeded = true;
  const w = new World(renderer, run, host);
  w.setQuality({ lighting: true, particles: 0.25 });
  w.rules = fixedRules({ hitStop: false });
  let move = (_t: number): [number, number] => [0, 0];
  w.inputSource = (ww, p, o) => {
    const [mx, my] = move(ww.time);
    o.mx = mx;
    o.my = my;
    o.ax = o.ay = 0;
    o.held = 0;
    o.pressed = 0;
    o.cx = p.x + 10;
    o.cy = p.y;
  };
  w.start();
  w.startFloor(FLOOR);
  for (let i = 0; i < 40; i++) w.update(FIXED_DT);
  for (const e of [...w.enemies]) w.killEnemy(e);
  w.room.setDoorsClosed(true);
  const p = w.player;
  const hurts: Hurt[] = [];
  p.hurt = ((ww: World, _n: number, src = '???') => {
    if (!p.alive || p.invuln > 0) return false;
    hurts.push({ t: ww.time, src });
    p.invuln = 0.6;
    return true;
  }) as typeof p.hurt;
  const room = w.room;
  const cx = room.interiorX + room.interiorW / 2;
  const cy = room.interiorY + room.interiorH / 2;
  return {
    w, p, hurts, cx, cy, room,
    setMove(f: (t: number) => [number, number]) { move = f; },
    step(n = 1, each?: () => void) {
      for (let i = 0; i < n; i++) {
        w.update(FIXED_DT);
        each?.();
      }
    },
    /** Spawn a procession (its leader); the line files in behind it. */
    spawn(x: number, y: number, champion = false): Enemy {
      const e = w.spawnEnemy(PILGRIM_ID, x, y)!;
      if (champion) {
        e.champion = true;
        e.championColor = '#ffba60';
      }
      for (const m of procession(e)) m.dormant = 0;
      return e;
    },
  };
}

/** Keep the keeper at (x, y) (teleports it there before every step). */
function pin(a: ReturnType<typeof arena>, x: number, y: number): () => void {
  return () => {
    a.p.x = x;
    a.p.y = y;
    a.p.vx = a.p.vy = 0;
    a.p.kbx = a.p.kby = 0;
  };
}

const all = (w: World) => [...w.entities, ...((w as unknown as { pending: Entity[] }).pending ?? [])].filter((e) => !e.dead);
const pilgrims = (w: World) => w.enemies.filter((e) => e.def.id === PILGRIM_ID && e.alive);
const flames = (w: World) => all(w).filter((x): x is Projectile => x instanceof Projectile && x.team === 'enemy');

function spriteDefined(name: string): boolean {
  if (hasAnim(name)) {
    const a = getAnim(name)!;
    return a.frames.length > 0 && a.frames.every((f) => hasSprite(f));
  }
  return hasSprite(name);
}

/** Track telegraph starts per pilgrim and every flame cast, with the time since its pilgrim's warning began. */
function watchChants(w: World) {
  const tellStart = new Map<number, number>();
  const prevTel = new Map<number, number>();
  const seen = new Set<Projectile>();
  const casts: { t: number; since: number; owner: Enemy; angle: number; damage: number; speed: number; face: number }[] = [];
  return {
    casts,
    tellStart,
    tick() {
      for (const e of pilgrims(w)) {
        const before = prevTel.get(e.id) ?? 0;
        if (e.telegraphT > before + 1e-6 && e.telegraphT > 0.05) tellStart.set(e.id, w.time);
        prevTel.set(e.id, e.telegraphT);
      }
      for (const f of flames(w)) {
        if (seen.has(f)) continue;
        seen.add(f);
        const o = f.owner as Enemy;
        casts.push({ t: w.time, since: w.time - (tellStart.get(o.id) ?? Infinity), owner: o, angle: f.angle, damage: f.damage, speed: f.speed, face: o.mem.face });
      }
    },
  };
}

// ---------------------------------------------------------------- definition
describe('얼음 순례자: definition', () => {
  it('registers on floor 4 only with fodder bodies that add up to a tough procession', () => {
    const d = Enemies.must(PILGRIM_ID);
    expect(d.name).toBe('얼음 순례자');
    expect(d.name).toMatch(/^[가-힣 ]+$/);
    expect(d.floors).toEqual([FLOOR]);
    expect(d.boss).toBeFalsy();
    // one pilgrim is fodder (10–20), the line of four is a tough enemy (60–120)
    expect(d.hp).toBeGreaterThanOrEqual(10);
    expect(d.hp).toBeLessThanOrEqual(20);
    expect(d.hp * PROC_LEN).toBeGreaterThanOrEqual(60);
    expect(d.hp * PROC_LEN).toBeLessThanOrEqual(120);
    const fl = Floors.all().find((f) => f.index === FLOOR)!;
    expect((d.speed ?? 40) * (fl.enemySpeed ?? 1)).toBeLessThan(92);
    // a straggler catching up stays under the keeper's speed too
    expect((d.speed ?? 40) * 2.2 * (fl.enemySpeed ?? 1)).toBeLessThan(92);
    expect(d.contactDamage ?? 1).toBe(1);
    expect(d.radius).toBeGreaterThanOrEqual(4);
    expect(d.radius).toBeLessThanOrEqual(7);
    expect(d.champion).toBe(true);
    expect(d.deathFx).toBeDefined();
    expect(d.bloodColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(d.light?.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(d.script).toBeTypeOf('function');
  });

  it('costs and weighs like the floor’s other group enemy (the choir), and sits in the floor-4 pool', () => {
    const d = Enemies.must(PILGRIM_ID);
    const choir = Enemies.must('choir_cantor');
    expect(d.cost).toBe(choir.cost);
    expect(d.weight).toBeGreaterThanOrEqual(0.4);
    expect(d.weight).toBeLessThanOrEqual(0.6);
    const a = arena('f4x-pool');
    const pool = a.w.enemyPool();
    expect(pool[PILGRIM_ID]).toBe(d.weight);
    const total = Object.values(pool).reduce((s, v) => s + v, 0);
    // a sane share of the floor's rooms: less common than a basic, never dominant
    expect(pool[PILGRIM_ID] / total).toBeGreaterThan(0.02);
    expect(pool[PILGRIM_ID] / total).toBeLessThan(0.08);
    // and it is not in any other floor's pool
    for (const f of Floors.all()) if (f.index !== FLOOR) expect(Enemies.must(PILGRIM_ID).floors).not.toContain(f.index);
  });

  it('has walk / idle / chant (wind-up) / hurt frames for pilgrims and the standard bearer, small-enemy sized', () => {
    for (const pre of ['ipilgrim', 'ipleader']) {
      for (const [st, n] of [['walk', 4], ['idle', 2], ['chant', 2], ['hurt', 1]] as const) {
        const name = `${pre}_${st}`;
        expect(spriteDefined(name), name).toBe(true);
        expect(getAnim(name)!.frames.length, name).toBe(n);
      }
      // the body (opaque pixels) fits a small enemy: 10–16 px wide, ≤ 20 px tall without the standard
      const s = getSprite(`${pre}_walk_0`);
      expect(s.w).toBeLessThanOrEqual(17);
      expect(s.h).toBeLessThanOrEqual(26);
    }
    expect(Enemies.must(PILGRIM_ID).sprite).toBe('ipilgrim_walk');
    expect(hasSprite('__eflame_hymn_9')).toBe(true);
  });
});

// ---------------------------------------------------------------- pure helpers
describe('얼음 순례자: pure helpers', () => {
  it('lineNormals: square to the walking direction at every point (front first)', () => {
    // walking right along y = 0: front at x = 30
    const straight = lineNormals([{ x: 30, y: 0 }, { x: 18, y: 0 }, { x: 6, y: 0 }, { x: -6, y: 0 }]);
    for (const n of straight) expect(Math.abs(angleDiff(n, Math.PI / 2))).toBeLessThan(1e-9);
    // walking down a quarter circle: each normal is square to the local tangent
    const arc = [0, 1, 2, 3].map((i) => ({ x: Math.cos(-i * 0.3) * 60, y: Math.sin(-i * 0.3) * 60 }));
    const ns = lineNormals(arc);
    for (let i = 1; i < 3; i++) {
      const t = Math.atan2(arc[i - 1].y - arc[i + 1].y, arc[i - 1].x - arc[i + 1].x);
      expect(Math.abs(Math.cos(ns[i] - t))).toBeLessThan(1e-9);
      // on a circle the normal points through the centre (inward or outward)
      const toCentre = Math.atan2(-arc[i].y, -arc[i].x);
      expect(Math.abs(Math.sin(angleDiff(ns[i], toCentre)))).toBeLessThan(0.02);
    }
    // a lone pilgrim fires square to its heading
    expect(lineNormals([{ x: 0, y: 0 }], 1)[0]).toBeCloseTo(1 + Math.PI / 2, 9);
  });

  it('followSpeed: still inside the gap, catching up beyond it, capped', () => {
    expect(followSpeed(PROC_GAP - 3, PROC_GAP, 70)).toBe(0);
    expect(followSpeed(PROC_GAP, PROC_GAP, 70)).toBe(0);
    expect(followSpeed(PROC_GAP + 4, PROC_GAP, 70)).toBeCloseTo(20, 9);
    expect(followSpeed(200, PROC_GAP, 70)).toBe(70);
  });

  it('orbitGoal: a step around an ellipse of the given radius', () => {
    const g = orbitGoal(100, 0, 0, 0, 80, 1);
    expect(Math.hypot(g.x, g.y / 0.85)).toBeCloseTo(80, 6);
    expect(Math.atan2(g.y / 0.85, g.x)).toBeCloseTo(0.75, 6);
    const h = orbitGoal(100, 0, 0, 0, 80, -1);
    expect(Math.atan2(h.y / 0.85, h.x)).toBeCloseTo(-0.75, 6);
  });
});

// ---------------------------------------------------------------- the line
describe('얼음 순례자: the procession', () => {
  it('a spawned leader brings its line: four pilgrims, one pace apart, followers are minions', () => {
    const a = arena('f4x-spawn');
    const head = a.w.spawnEnemy(PILGRIM_ID, a.cx - 60, a.cy)!;
    const line = procession(head);
    expect(line).toHaveLength(PROC_LEN);
    a.step(1);
    expect(pilgrims(a.w)).toHaveLength(PROC_LEN);
    expect(head.isMinion).toBe(false);
    expect(head.mem.lead).toBe(1);
    for (let i = 1; i < line.length; i++) {
      expect(line[i].isMinion).toBe(true);
      expect(line[i].mem.prev).toBe(line[i - 1]);
      expect(line[i].mem.lead).toBe(0);
      expect(line[i].dormant).toBe(head.dormant);
      expect(Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y)).toBeLessThan(PROC_GAP + 6);
    }
  });

  it('marches as one line: the leader circles the keeper, every follower stays a pace behind the one ahead', () => {
    const a = arena('f4x-march');
    const keep = pin(a, a.cx + 20, a.cy);
    const head = a.spawn(a.cx - 70, a.cy - 10);
    let maxGap = 0;
    let moved = 0;
    let prevX = head.x;
    let prevY = head.y;
    let angSum = 0;
    let lastAng = Math.atan2(head.y - a.p.y, head.x - a.p.x);
    a.step(12 * 60, () => {
      keep();
      const line = procession(head);
      expect(line).toHaveLength(PROC_LEN);
      if (!line.some((e) => e.mem.chant || e.mem.rest > 0)) {
        for (let i = 1; i < line.length; i++) maxGap = Math.max(maxGap, Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
      }
      moved += Math.hypot(head.x - prevX, head.y - prevY);
      prevX = head.x;
      prevY = head.y;
      const ang = Math.atan2(head.y - a.p.y, head.x - a.p.x);
      angSum += angleDiff(lastAng, ang);
      lastAng = ang;
    });
    expect(moved).toBeGreaterThan(150);
    expect(maxGap).toBeLessThan(PROC_GAP + 8);
    // it walks AROUND the keeper (not just at it)
    expect(Math.abs(angSum)).toBeGreaterThan(2);
  });

  it('cut in the middle, the rear half raises its own standard and walks (and chants) on its own', () => {
    const a = arena('f4x-split');
    const keep = pin(a, a.cx + 20, a.cy);
    const head = a.spawn(a.cx - 70, a.cy - 10);
    a.step(60, keep);
    const [, second, third, fourth] = procession(head);
    a.w.killEnemy(second);
    a.step(2, keep);
    expect(procession(head)).toEqual([head]);
    expect(third.mem.prev).toBeNull();
    expect(third.mem.lead).toBe(1);
    expect(procession(third)).toEqual([third, fourth]);
    expect(fourth.mem.prev).toBe(third);
    // both lines chant on their own
    const watch = watchChants(a.w);
    a.step(8 * 60, () => {
      keep();
      watch.tick();
    });
    const by = new Set(watch.casts.map((c) => c.owner));
    expect(by.has(head)).toBe(true);
    expect(by.has(third)).toBe(true);
    expect(by.has(fourth)).toBe(true);
  });

  it('the leader falls: the next in line takes the standard; a straggler stuck far behind walks alone', () => {
    const a = arena('f4x-lead');
    const keep = pin(a, a.cx + 20, a.cy);
    const head = a.spawn(a.cx - 70, a.cy - 10);
    a.step(30, keep);
    const [, second, third, fourth] = procession(head);
    a.w.killEnemy(head);
    a.step(2, keep);
    expect(second.mem.lead).toBe(1);
    expect(procession(second)).toEqual([second, third, fourth]);
    // the last one is dragged away (stuck behind a rock): it leaves the line
    fourth.x = third.x + (third.x < a.cx ? PROC_DETACH + 30 : -(PROC_DETACH + 30));
    a.step(2, keep);
    expect(fourth.mem.lead).toBe(1);
    expect(third.mem.next).toBeNull();
    expect(procession(second)).toEqual([second, third]);
  });
});

// ---------------------------------------------------------------- the chant
describe('얼음 순례자: the chant', () => {
  it('front to back, every flame is cast ≥ 0.3 s after its own pilgrim began to flare, out of both sides of the line, at base strength', () => {
    const a = arena('f4x-chant');
    const keep = pin(a, a.cx + 20, a.cy);
    const head = a.spawn(a.cx - 70, a.cy - 10);
    const line = procession(head);
    const watch = watchChants(a.w);
    a.step(10 * 60, () => {
      keep();
      watch.tick();
    });
    expect(watch.casts.length).toBeGreaterThanOrEqual(PROC_LEN * 2 * 2);
    for (const c of watch.casts) {
      expect(c.since, `flame from ${c.owner.id}`).toBeGreaterThanOrEqual(0.3 - 1e-6);
      expect(c.since).toBeLessThan(CHANT_TELL + 0.05);
      expect(c.damage).toBe(1);
      expect(c.speed).toBeCloseTo(FLAME_SPEED, 6);
      // square to the line: along the pilgrim's normal, either side
      expect(Math.abs(Math.sin(angleDiff(c.angle, c.face)))).toBeLessThan(1e-6);
    }
    // the first chant: each pilgrim casts two flames on opposite sides, rippling front to back
    const first = watch.casts.filter((c) => c.t < watch.casts[0].t + 1);
    expect(first).toHaveLength(PROC_LEN * 2);
    const t0 = new Map<Enemy, number>();
    for (const c of first) if (!t0.has(c.owner)) t0.set(c.owner, c.t);
    for (let i = 1; i < line.length; i++) expect(t0.get(line[i])! - t0.get(line[i - 1])!).toBeCloseTo(CHANT_STAGGER, 1);
    for (const e of line) {
      const two = first.filter((c) => c.owner === e);
      expect(two).toHaveLength(2);
      expect(Math.abs(angleDiff(two[0].angle, two[1].angle))).toBeCloseTo(Math.PI, 6);
    }
    // the line holds still while it chants, then walks on together
    expect(CHANT_REST).toBeGreaterThan(0.2);
  });

  it('a champion’s line casts two flames per side', () => {
    const a = arena('f4x-champ');
    const keep = pin(a, a.cx + 20, a.cy);
    a.spawn(a.cx - 70, a.cy - 10, true);
    const watch = watchChants(a.w);
    a.step(6 * 60, () => {
      keep();
      watch.tick();
    });
    const first = watch.casts.filter((c) => c.t < watch.casts[0].t + 1);
    expect(first).toHaveLength(PROC_LEN * 4);
  });

  it('frozen mid-chant, a pilgrim starts its warning over before it may cast', () => {
    const a = arena('f4x-freeze');
    const keep = pin(a, a.cx + 20, a.cy);
    const head = a.spawn(a.cx - 70, a.cy - 10);
    const line = procession(head);
    const last = line[line.length - 1];
    const watch = watchChants(a.w);
    // run until the last pilgrim has begun to flare
    for (let i = 0; i < 8 * 60 && !last.mem.told; i++) {
      a.step(1, keep);
      watch.tick();
    }
    expect(last.mem.told).toBe(1);
    a.step(6, () => {
      keep();
      watch.tick();
    });
    last.applyStatus({ kind: 'freeze', duration: 1.2 }, () => 0);
    expect(last.hasStatus('freeze')).toBe(true);
    const before = watch.casts.filter((c) => c.owner === last).length;
    a.step(4 * 60, () => {
      keep();
      watch.tick();
    });
    const after = watch.casts.filter((c) => c.owner === last).slice(before);
    expect(after.length).toBeGreaterThan(0);
    for (const c of after) expect(c.since).toBeGreaterThanOrEqual(0.3 - 1e-6);
  });
});

// ---------------------------------------------------------------- 20 s in the real World
describe('얼음 순례자: 20 s in the real World', () => {
  it('next to two floor-4 neighbours: acts, stays in the room, warns before it hurts, and dies without leftovers', () => {
    const a = arena('f4x-run');
    const { w, room } = a;
    a.setMove((t) => [Math.cos(t * 0.9), Math.sin(t * 1.3) * 0.8]);
    const head = a.spawn(a.cx - 80, a.cy - 20);
    const priest = w.spawnEnemy('icicle_priest', a.cx + 90, a.cy - 30)!;
    const knight = w.spawnEnemy('frost_knight', a.cx + 80, a.cy + 30)!;
    priest.dormant = knight.dormant = 0;
    const line = procession(head);
    const watch = watchChants(w);
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...m: unknown[]) => errors.push(m);
    let firstTell = Infinity;
    try {
      a.step(20 * 60, () => {
        watch.tick();
        if (firstTell === Infinity && line.some((e) => e.telegraphT > 0)) firstTell = w.time;
        for (const e of pilgrims(w)) {
          expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
          expect(e.x).toBeGreaterThanOrEqual(room.interiorX - 1);
          expect(e.x).toBeLessThanOrEqual(room.interiorX + room.interiorW + 1);
          expect(e.y).toBeGreaterThanOrEqual(room.interiorY - 1);
          expect(e.y).toBeLessThanOrEqual(room.interiorY + room.interiorH + 1);
        }
      });
    } finally {
      console.error = orig;
    }
    expect(errors).toEqual([]);
    expect(pilgrims(w)).toHaveLength(PROC_LEN);
    expect(watch.casts.length).toBeGreaterThanOrEqual(PROC_LEN * 2 * 3);
    for (const c of watch.casts) expect(c.since).toBeGreaterThanOrEqual(0.3 - 1e-6);
    const mine = a.hurts.filter((h) => h.src === '얼음 순례자');
    if (mine.length) expect(mine[0].t).toBeGreaterThan(firstTell + 0.3);
    // all four fall; nothing of theirs lingers
    for (const e of [...pilgrims(w)]) w.killEnemy(e);
    a.step(5 * 60);
    expect(pilgrims(w)).toHaveLength(0);
    expect(flames(w).filter((f) => (f.owner as Enemy).def.id === PILGRIM_ID)).toHaveLength(0);
    expect(all(w).filter((x) => x instanceof Enemy && x.def.id === PILGRIM_ID)).toHaveLength(0);
  });

  it('room spawns on floor 4 build whole processions', () => {
    const a = arena('f4x-rooms');
    const { w } = a;
    w.teleportTo(w.map.nodes.find((n) => n.kind === 'normal')!);
    a.step(120);
    expect(w.node.kind).toBe('normal');
    let lines = 0;
    for (let s = 0; s < 400 && lines < 2; s++) {
      for (const e of [...w.enemies]) w.killEnemy(e);
      a.step(1);
      w.withIds(() => w.spawnRoomEnemies(w.room, new RNG(`f4x-room-${s}`)));
      const heads = w.enemies.filter((e) => e.def.id === PILGRIM_ID && !e.isMinion);
      for (const h of heads) {
        expect(procession(h)).toHaveLength(PROC_LEN);
        lines++;
      }
    }
    expect(lines).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------- purity / determinism
describe('얼음 순례자: draw purity and lockstep determinism', () => {
  it('stateHash is unchanged by w.draw(1)', () => {
    const a = arena('f4x-draw');
    a.setMove((t) => [Math.cos(t * 1.1), Math.sin(t * 0.7)]);
    a.spawn(a.cx - 60, a.cy - 15, true);
    a.spawn(a.cx + 60, a.cy + 15);
    for (let i = 0; i < 480; i++) {
      a.w.update(FIXED_DT);
      const before = stateHash(a.w);
      a.w.draw(1);
      expect(stateHash(a.w), `step ${i}`).toBe(before);
    }
  });

  it('identical state hashes across fx seeds, particle density and drawing (the keeper shooting the line apart)', () => {
    const run = (fxSeed: number, drawEvery: number, particles: number): number[] => {
      fx.setState(new RNG(fxSeed).getState());
      const a = arena('f4x-lockstep');
      a.w.setQuality({ particles });
      a.setMove((t) => [Math.cos(t * 1.3), Math.sin(t * 0.9)]);
      const inp = a.w.inputSource!;
      a.w.inputSource = (ww, p, o) => {
        inp(ww, p, o);
        o.held = 1 | 2;
        const t = ww.enemies[0];
        o.cx = t ? t.x : p.x + 20;
        o.cy = t ? t.y : p.y;
      };
      a.spawn(a.cx - 70, a.cy - 20, true);
      a.spawn(a.cx + 70, a.cy + 20);
      const out: number[] = [];
      for (let i = 0; i < 14 * 60; i++) {
        a.w.update(FIXED_DT);
        if (drawEvery && i % drawEvery === 0) a.w.draw(1);
        out.push(stateHash(a.w));
      }
      return out;
    };
    const base = run(1, 0, 1);
    const other = run(0x9e3779b9, 2, 0.25);
    const first = base.findIndex((h, i) => h !== other[i]);
    expect(first, 'first diverging step').toBe(-1);
  });

  it('online co-op: two keepers over the lockstep stay identical with processions in the room', () => {
    let spawned = 0;
    let cast = 0;
    const res = runCoop({
      name: 'f4x coop', seed: 'F4X-COOP', chars: ['ria', 'serin'], floor: FLOOR,
      ms: 30_000, link: { latencyMs: 30, jitterMs: 20 }, bossAt: 1e9, downAt: 0, leaveAt: 0, discardAt: 0, stayInRoom: true,
      extraStep(w, tick) {
        for (const x of w.projectiles) if (x.team === 'enemy' && (x.owner as Enemy | null)?.def?.id === PILGRIM_ID && x.age === 0) cast++;
        if (tick < 120 || tick % 480 !== 0 || w.transitioning) return;
        const r = w.room;
        // (decided from the tick only: every peer runs this hook on its own world)
        w.withIds(() => {
          const e = w.spawnEnemy(PILGRIM_ID, r.interiorX + 40, r.interiorY + 30);
          if (e && (tick / 480) % 2 === 1) e.champion = true;
        });
        spawned++;
      },
    });
    const ref = res.peers[0].hashes;
    expect(ref.length).toBeGreaterThan(1200);
    for (const p of res.peers) {
      expect(p.desyncs, `slot ${p.slot} desync`).toEqual([]);
      const n = Math.min(ref.length, p.hashes.length);
      let checked = 0;
      for (let t = 0; t < n; t++) {
        if (p.hashes[t] === undefined || ref[t] === undefined) continue;
        expect(p.hashes[t], `slot ${p.slot} tick ${t}`).toBe(ref[t]);
        checked++;
      }
      expect(checked).toBeGreaterThan(1000);
    }
    expect(spawned).toBeGreaterThan(2);
    expect(cast).toBeGreaterThan(0);
  }, 120_000);
});
