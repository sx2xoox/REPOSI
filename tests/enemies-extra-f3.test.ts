// Floor 3 (잿불 대장간) extra regular enemy: 망치 땜장이 (hammer tinker) — the floor's support.
// Definition and spawn pool, pure helpers, a 20 s headless run in the real World, the
// boomerang hammer (telegraph, out / hang / back, one hit per leg, base damage), the iron
// patch (temporary armour on an ally, breaks / expires / pops off when the tinker dies),
// clean death, draw purity and lockstep determinism (solo across fx seeds, online co-op).

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
import { GroundWarning } from '../src/game/effects';
import { Projectile } from '../src/game/projectile';
import { getAnim, hasAnim, hasSprite, listSprites } from '../src/engine/sprites';
import { fx, RNG } from '../src/engine/rng';
import { stateHash } from '../src/game/statehash';
import { runCoop } from './coopsim';
import {
  boomerangPos, HAMMER_R, LANE_W, PATCH_COOLDOWN, PATCH_LIFE, PATCH_SHARE, PATCH_WIND, patchOn, patchScore, pickPatchTarget,
  THROW_HANG, THROW_OUT, THROW_REACH_MAX, THROW_REACH_MIN, THROW_WIND, throwReach, TINKER_ID, TINKER_NAME, TinkerHammer, TinkerPatch,
} from '../src/content/enemies/forge-extra';

loadContent();

function spriteDefined(name: string): boolean {
  if (hasAnim(name)) {
    const a = getAnim(name)!;
    return a.frames.length > 0 && a.frames.every((f) => hasSprite(f));
  }
  return hasSprite(name);
}

// ---------------------------------------------------------------- real-World arena
const host: WorldHost = { openInventory() {}, onGameOver() {} };
let renderer: Renderer | null = null;

interface Hurt { t: number; src: string; n: number; x: number; y: number }

/** A real World on floor 3 (its start room, emptied), keeper idle, hurts logged instead of applied. */
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
  w.startFloor(3);
  for (let i = 0; i < 40; i++) w.update(FIXED_DT);
  for (const e of [...w.enemies]) w.killEnemy(e);
  w.room.setDoorsClosed(true);
  const p = w.player;
  const hurts: Hurt[] = [];
  p.hurt = ((ww: World, n: number, src = '???') => {
    if (!p.alive || p.invuln > 0) return false;
    hurts.push({ t: ww.time, src, n, x: p.x, y: p.y });
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
    spawn(id: string, x: number, y: number, champion = false): Enemy {
      const e = w.spawnEnemy(id, x, y)!;
      if (champion) {
        e.champion = true;
        e.championColor = '#ffba60';
      }
      e.dormant = 0;
      return e;
    },
  };
}
type Arena = ReturnType<typeof arena>;

/** Keep the keeper at (x, y) (teleports it there before every step). */
function pin(a: Arena, x: number, y: number): () => void {
  return () => {
    a.p.x = x;
    a.p.y = y;
    a.p.vx = a.p.vy = 0;
    a.p.kbx = a.p.kby = 0;
  };
}

const all = (w: World) => [...w.entities, ...((w as unknown as { pending: Entity[] }).pending ?? [])].filter((e) => !e.dead);
const of = <T extends Entity>(w: World, cls: abstract new (...a: never[]) => T): T[] => all(w).filter((e): e is T => e instanceof cls);

/** A stationary ally (it keeps its place: speed 0, its own script still runs). */
function ally(a: Arena, id: string, x: number, y: number): Enemy {
  const e = a.spawn(id, x, y);
  e.speed = 0;
  return e;
}

// ---------------------------------------------------------------- definition & pool
describe('망치 땜장이: definition and spawn pool', () => {
  it('is a floor-3 regular with basic-enemy stats', () => {
    const d = Enemies.must(TINKER_ID);
    expect(d.name).toBe(TINKER_NAME);
    expect(d.name).toMatch(/^[가-힣 ]+$/);
    expect(d.floors).toEqual([3]);
    expect(d.boss).toBeFalsy();
    expect(d.hp).toBeGreaterThanOrEqual(25);
    expect(d.hp).toBeLessThanOrEqual(45);
    expect(d.cost ?? 1).toBeGreaterThanOrEqual(1);
    expect(d.cost ?? 1).toBeLessThanOrEqual(2);
    const fl = Floors.all().find((f) => f.index === 3)!;
    // it hurries toward allies at 115 % of its speed
    expect((d.speed ?? 40) * 1.15 * (fl.enemySpeed ?? 1)).toBeLessThan(92);
    expect(d.contactDamage ?? 1).toBe(1);
    expect(d.radius).toBeGreaterThan(2);
    expect(d.champion).toBe(true);
    expect(d.deathFx).toBeDefined();
    expect(d.bloodColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(d.light?.radius).toBeGreaterThan(0);
    expect(d.script).toBeTypeOf('function');
    expect(spriteDefined(d.sprite)).toBe(true);
  });

  it('has idle/move, telegraph wind-ups, attack and hurt frames; every referenced sprite exists', () => {
    const src = Object.values(import.meta.glob('../src/content/enemies/forge-extra.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0];
    const names = new Set<string>();
    for (const m of src.matchAll(/setAnim\('([a-z0-9_]+)'/g)) names.add(m[1]);
    for (const m of src.matchAll(/r\.sprite\('([a-z0-9_]+)'/g)) names.add(m[1]);
    for (const m of src.matchAll(/'(tinker_[a-z_0-9]+)'/g)) names.add(m[1]);
    expect(names.size).toBeGreaterThan(12);
    for (const n of names) expect(spriteDefined(n), n).toBe(true);
    const states = new Set(listSprites().filter((n) => /^tinker_[a-z]+_\d+$/.test(n)).map((n) => n.split('_')[1]));
    for (const s of ['walk', 'wind', 'strike', 'cock', 'throw', 'wait', 'hurt']) expect(states.has(s), s).toBe(true);
    // the walk cycle and both wind-ups are animated
    for (const s of ['walk', 'wind', 'cock', 'wait']) expect(getAnim(`tinker_${s}`)!.frames.length, s).toBeGreaterThanOrEqual(2);
  });

  it("is in floor 3's spawn pool (and only there) with a sane weight", () => {
    const a = arena('f3x-pool');
    const pool = a.w.enemyPool();
    expect(pool[TINKER_ID]).toBe(Enemies.must(TINKER_ID).weight);
    const regular = Object.entries(pool).filter(([id]) => id !== TINKER_ID).map(([, v]) => v);
    expect(pool[TINKER_ID]).toBeGreaterThanOrEqual(Math.min(...regular.filter((v) => v >= 0.5)));
    expect(pool[TINKER_ID]).toBeLessThanOrEqual(Math.max(...regular));
    const total = Object.values(pool).reduce((s, v) => s + v, 0);
    expect(pool[TINKER_ID] / total).toBeGreaterThan(0.04);
    expect(pool[TINKER_ID] / total).toBeLessThan(0.12);
    for (const f of Floors.all()) {
      if (f.index === 3) continue;
      expect(Enemies.must(TINKER_ID).floors?.includes(f.index), `floor ${f.index}`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------- pure helpers
describe('망치 땜장이: helpers', () => {
  it('patchScore prefers battered, close and champion allies', () => {
    expect(patchScore(0.5, 60)).toBeGreaterThan(patchScore(0.1, 60));
    expect(patchScore(0.3, 20)).toBeGreaterThan(patchScore(0.3, 140));
    expect(patchScore(0.3, 60, true)).toBeGreaterThan(patchScore(0.3, 60));
    // a half-dead ally across the room beats an unhurt one next door
    expect(patchScore(0.5, 140)).toBeGreaterThan(patchScore(0, 10));
  });

  it('throwReach flies past the keeper within its band', () => {
    expect(throwReach(10)).toBe(THROW_REACH_MIN);
    expect(throwReach(60)).toBe(88);
    expect(throwReach(400)).toBe(THROW_REACH_MAX);
  });

  it('boomerangPos: starts at the hand, slows down, stops at the reach', () => {
    const s = boomerangPos(10, 20, Math.PI / 2, 100, 0);
    expect(s.x).toBeCloseTo(10);
    expect(s.y).toBeCloseTo(20);
    const e = boomerangPos(10, 20, Math.PI / 2, 100, 1);
    expect(e.y).toBeCloseTo(120);
    expect(boomerangPos(10, 20, Math.PI / 2, 100, 2).y).toBeCloseTo(120);
    let prev = 20;
    let prevStep = Infinity;
    for (let u = 0.1; u <= 1.0001; u += 0.1) {
      const y = boomerangPos(10, 20, Math.PI / 2, 100, u).y;
      expect(y).toBeGreaterThan(prev);
      expect(y - prev).toBeLessThan(prevStep + 1e-9);
      prevStep = y - prev;
      prev = y;
    }
  });
});

// ---------------------------------------------------------------- headless run
describe('망치 땜장이: 20 s in the real World', () => {
  for (const withAlly of [false, true]) {
    it(`${withAlly ? 'with allies' : 'alone'}: acts, stays in the room, telegraphs before it hurts, hits at base strength, dies cleanly`, () => {
      const a = arena(`f3x-run-${withAlly}`);
      const { w, room } = a;
      a.setMove((t) => [Math.cos(t * 0.9), Math.sin(t * 1.3) * 0.8]);
      const e = a.spawn(TINKER_ID, a.cx - 70, a.cy - 20);
      if (withAlly) {
        const h = a.spawn('forge_sentinel', a.cx - 40, a.cy + 30);
        h.hp = h.maxHp * 0.5;
        a.spawn('anvil_mortar', a.cx - 100, a.cy + 20);
      }
      let firstTell = Infinity;
      let danger = 0;
      let hammers = 0;
      let patches = 0;
      const errors: unknown[] = [];
      const orig = console.error;
      console.error = (...m: unknown[]) => errors.push(m);
      try {
        a.step(20 * 60, () => {
          const ents = all(w);
          danger = Math.max(danger, ents.filter((x) => x.enemyHazard || x instanceof GroundWarning).length);
          if (firstTell === Infinity && (e.telegraphT > 0 || ents.some((x) => x instanceof GroundWarning))) firstTell = w.time;
          hammers = Math.max(hammers, ents.filter((x) => x instanceof TinkerHammer).length);
          patches = Math.max(patches, ents.filter((x) => x instanceof TinkerPatch).length);
          expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
          expect(e.x).toBeGreaterThanOrEqual(room.interiorX - 1);
          expect(e.x).toBeLessThanOrEqual(room.interiorX + room.interiorW + 1);
          expect(e.y).toBeGreaterThanOrEqual(room.interiorY - 1);
          expect(e.y).toBeLessThanOrEqual(room.interiorY + room.interiorH + 1);
          for (const hm of ents) {
            if (!(hm instanceof TinkerHammer)) continue;
            expect(hm.x).toBeGreaterThanOrEqual(room.interiorX - HAMMER_R);
            expect(hm.x).toBeLessThanOrEqual(room.interiorX + room.interiorW + HAMMER_R);
            expect(hm.y).toBeGreaterThanOrEqual(room.interiorY - HAMMER_R);
            expect(hm.y).toBeLessThanOrEqual(room.interiorY + room.interiorH + HAMMER_R);
          }
        });
      } finally {
        console.error = orig;
      }
      expect(errors).toEqual([]);
      expect(e.alive).toBe(true);
      expect(danger).toBeGreaterThan(0);
      expect(hammers).toBe(1);
      expect(patches > 0).toBe(withAlly);
      // fairness: its first hit only after a visible warning of at least 0.3 s
      const own = a.hurts.filter((h) => h.src === TINKER_NAME);
      if (own.length) expect(own[0].t).toBeGreaterThan(firstTell + 0.3);
      if (!withAlly) expect(own.length).toBe(a.hurts.length);
      for (const h of a.hurts) {
        expect(h.n, h.src).toBe(1);
        expect([TINKER_NAME, Enemies.must('forge_sentinel').name, Enemies.must('anvil_mortar').name, '포탄']).toContain(h.src);
      }
      // it can die, and nothing of it stays behind
      w.killEnemy(e);
      a.step(2 * 60);
      expect(e.dead).toBe(true);
      expect(of(w, TinkerHammer)).toHaveLength(0);
      expect(of(w, TinkerPatch)).toHaveLength(0);
      for (const o of w.enemies) expect(o.hp, o.def.id).toBeLessThanOrEqual(o.maxHp);
    });
  }
});

// ---------------------------------------------------------------- the boomerang hammer
describe('망치 땜장이: boomerang hammer', () => {
  function throwSetup(seed: string, champion = false) {
    const a = arena(seed);
    const e = a.spawn(TINKER_ID, a.cx - 60, a.cy, champion);
    e.speed = 0;
    return { a, e };
  }

  it('warns its lane ≥ 0.3 s first, flies out, hangs with the way back marked, and returns to be caught', () => {
    const { a, e } = throwSetup('f3x-throw');
    const keep = pin(a, a.cx + 10, a.cy);
    let lane: GroundWarning | undefined;
    let hammer: TinkerHammer | undefined;
    let laneAt = -1;
    let throwAt = -1;
    for (let i = 0; i < 8 * 60 && !hammer; i++) {
      a.step(1, keep);
      if (!lane) {
        lane = of(a.w, GroundWarning).find((g) => g.rw > 0);
        if (lane) laneAt = a.w.time;
      }
      hammer = of(a.w, TinkerHammer)[0];
      if (hammer) throwAt = a.w.time;
    }
    expect(lane && hammer).toBeTruthy();
    expect(throwAt - laneAt).toBeGreaterThanOrEqual(THROW_WIND - FIXED_DT * 1.5);
    expect(THROW_WIND).toBeGreaterThanOrEqual(0.3);
    expect(lane!.rh).toBe(LANE_W);
    expect(lane!.rw).toBeLessThanOrEqual(THROW_REACH_MAX + HAMMER_R);
    expect(hammer!.reach).toBeLessThanOrEqual(THROW_REACH_MAX);
    expect(hammer!.reach).toBeGreaterThanOrEqual(THROW_REACH_MIN);
    // out along the lane, never farther than the reach
    const x0 = e.x;
    const y0 = e.y;
    const seen = new Set<string>();
    let maxD = 0;
    let backLane: GroundWarning | undefined;
    let tinkerMoved = 0;
    const ex = e.x;
    const ey = e.y;
    while (!hammer!.dead) {
      a.step(1, keep);
      seen.add(hammer!.state);
      maxD = Math.max(maxD, Math.hypot(hammer!.x - x0, hammer!.y - y0));
      if (hammer!.state === 'hang') backLane ??= hammer!.warning ?? undefined;
      tinkerMoved = Math.max(tinkerMoved, Math.hypot(e.x - ex, e.y - ey));
      // its line of flight is the warned lane
      if (hammer!.state === 'out') expect(Math.abs(Math.sin(Math.atan2(hammer!.y - y0, hammer!.x - x0) - lane!.angle) * Math.hypot(hammer!.y - y0, hammer!.x - x0))).toBeLessThan(LANE_W / 2);
    }
    expect([...seen].sort()).toEqual(['back', 'hang', 'out']);
    expect(maxD).toBeLessThanOrEqual(hammer!.reach + 1e-6);
    expect(maxD).toBeGreaterThan(hammer!.reach - 1);
    expect(backLane).toBeDefined();
    expect(backLane!.time).toBeGreaterThanOrEqual(THROW_HANG);
    expect(hammer!.caught).toBe(true);
    // the tinker stood still, empty-handed, while the hammer was away
    expect(tinkerMoved).toBeLessThan(1);
    // flight time: out + hang + back
    expect(a.w.time - throwAt).toBeGreaterThan(THROW_OUT + THROW_HANG);
    expect(a.w.time - throwAt).toBeLessThan(THROW_OUT + THROW_HANG + 1.2);
  });

  it('hits a keeper standing in the lane once on the way out and once on the way back, for 1 (base strength)', () => {
    const { a } = throwSetup('f3x-throw-hit');
    const keep = pin(a, a.cx + 10, a.cy);
    // short i-frames so the return leg can land too
    const p = a.p;
    const hurt0 = p.hurt;
    p.hurt = ((ww: World, n: number, src?: string, raw?: boolean, origin?: { x: number; y: number }) => {
      const ok = hurt0(ww, n, src, raw, origin);
      if (ok) p.invuln = 0.1;
      return ok;
    }) as typeof p.hurt;
    let h: TinkerHammer | undefined;
    for (let i = 0; i < 8 * 60 && !h; i++) {
      a.step(1, keep);
      h = of(a.w, TinkerHammer)[0];
    }
    expect(h).toBeDefined();
    while (!h!.dead) a.step(1, keep);
    const mine = a.hurts.filter((x) => x.src === TINKER_NAME);
    expect(mine.length).toBe(2);
    for (const x of mine) expect(x.n).toBe(1);
  });

  it('a champion throws twice in a row (the second with a shorter but still fair wind-up)', () => {
    const { a } = throwSetup('f3x-throw-champ', true);
    const keep = pin(a, a.cx + 10, a.cy);
    const ids: number[] = [];
    const lanes: { t: number; time: number }[] = [];
    const seenW = new Set<number>();
    for (let i = 0; i < 9 * 60 && ids.length < 2; i++) {
      a.step(1, keep);
      for (const g of of(a.w, GroundWarning)) {
        if (g.rw > 0 && !seenW.has(g.id) && g.time >= 0.3 && g.rh === LANE_W && !of(a.w, TinkerHammer).length) {
          seenW.add(g.id);
          lanes.push({ t: a.w.time, time: g.time });
        }
      }
      for (const h of of(a.w, TinkerHammer)) if (!ids.includes(h.id)) ids.push(h.id);
    }
    expect(ids.length).toBe(2);
    expect(lanes.length).toBeGreaterThanOrEqual(2);
    for (const l of lanes) expect(l.time).toBeGreaterThanOrEqual(0.3);
  });

  it('a bullet-clear drops the hammer harmlessly; the tinker digs out a spare and throws again', () => {
    const { a } = throwSetup('f3x-throw-clear');
    const keep = pin(a, a.cx + 40, a.cy + 40);
    let h: TinkerHammer | undefined;
    for (let i = 0; i < 8 * 60 && !h; i++) {
      a.step(1, keep);
      h = of(a.w, TinkerHammer)[0];
    }
    expect(h).toBeDefined();
    a.step(5, keep);
    a.w.clearEnemyBullets(a.cx, a.cy);
    expect(h!.state).toBe('drop');
    expect(h!.enemyHazard).toBe(false);
    const n = a.hurts.length;
    pin(a, h!.x, h!.y)();
    a.step(60, pin(a, h!.x, h!.y));
    expect(a.hurts.length).toBe(n);
    expect(h!.dead).toBe(true);
    let again: TinkerHammer | undefined;
    for (let i = 0; i < 8 * 60 && !again; i++) {
      a.step(1, keep);
      again = of(a.w, TinkerHammer).find((x) => x !== h);
    }
    expect(again).toBeDefined();
  });

  it('a hammer in flight clatters down when its tinker dies', () => {
    const { a, e } = throwSetup('f3x-throw-die');
    const keep = pin(a, a.cx + 10, a.cy);
    let h: TinkerHammer | undefined;
    for (let i = 0; i < 8 * 60 && !h; i++) {
      a.step(1, keep);
      h = of(a.w, TinkerHammer)[0];
    }
    a.step(10, keep);
    a.w.killEnemy(e);
    expect(h!.state).toBe('drop');
    const n = a.hurts.length;
    a.step(60, pin(a, h!.x, h!.y));
    expect(a.hurts.length).toBe(n);
    expect(of(a.w, TinkerHammer)).toHaveLength(0);
    expect(of(a.w, GroundWarning).filter((g) => g.rh === LANE_W)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- the patch
describe('망치 땜장이: iron patch', () => {
  /** A tinker next to a half-dead ally; returns once the patch is on. */
  function patched(seed: string, id = 'chain_hound') {
    const a = arena(seed);
    const keep = pin(a, a.cx + 110, a.cy + 50);
    const al = ally(a, id, a.cx - 30, a.cy);
    al.hp = Math.round(al.maxHp * 0.5);
    const e = a.spawn(TINKER_ID, a.cx - 80, a.cy - 10);
    const hp0 = al.hp;
    let windAt = -1;
    let pt: TinkerPatch | undefined;
    for (let i = 0; i < 8 * 60 && !pt; i++) {
      a.step(1, keep);
      if (windAt < 0 && e.anim === 'tinker_wind') windAt = a.w.time;
      pt = of(a.w, TinkerPatch)[0];
    }
    return { a, e, al, hp0, pt: pt!, windAt, keep };
  }

  it('walks to a hurt ally, winds up (telegraph + mark), then rivets 40 % of its max HP onto it', () => {
    const { a, e, al, hp0, pt, windAt } = patched('f3x-patch');
    expect(pt).toBeDefined();
    expect(pt.ally).toBe(al);
    expect(pt.owner).toBe(e);
    expect(windAt).toBeGreaterThan(0);
    expect(a.w.time - windAt).toBeGreaterThanOrEqual(PATCH_WIND - FIXED_DT * 1.5);
    expect(PATCH_WIND).toBeGreaterThanOrEqual(0.3);
    expect(pt.amount).toBe(Math.round(al.maxHp * PATCH_SHARE));
    expect(pt.guard).toBe(hp0);
    expect(al.hp).toBe(hp0 + pt.amount);
    expect(Math.hypot(e.x - al.x, e.y - al.y)).toBeLessThan(al.r + e.r + 24);
    expect(patchOn(a.w, al)).toBe(pt);
    // never two patches on one ally
    a.step(6 * 60, () => expect(of(a.w, TinkerPatch).filter((x) => x.ally === al).length).toBeLessThanOrEqual(1));
  });

  it('soaks damage first and breaks once its share is spent', () => {
    const { a, al, pt, keep } = patched('f3x-patch-soak');
    const amount = pt.amount;
    al.takeHit(a.w, { damage: amount * 0.5, kind: 'projectile', dirX: 1, dirY: 0 });
    a.step(1, keep);
    expect(pt.dead).toBe(false);
    expect(pt.left).toBeCloseTo(0.5, 5);
    expect(al.hp).toBeGreaterThan(pt.guard);
    al.takeHit(a.w, { damage: amount * 0.5 + 3, kind: 'projectile', dirX: 1, dirY: 0 });
    a.step(1, keep);
    expect(pt.dead).toBe(true);
    expect(al.hp).toBeCloseTo(pt.guard - 3, 5);
    expect(al.alive).toBe(true);
  });

  it(`falls off after ${PATCH_LIFE} s, taking what is left of it`, () => {
    const { a, al, pt, keep } = patched('f3x-patch-expire');
    const t0 = pt.age;
    a.step(Math.round((PATCH_LIFE - t0 - 0.2) * 60), keep);
    expect(pt.dead).toBe(false);
    a.step(30, keep);
    expect(pt.dead).toBe(true);
    expect(al.hp).toBeLessThanOrEqual(pt.guard);
  });

  it('every patch pops off the moment its tinker dies', () => {
    const { a, e, al, pt, keep } = patched('f3x-patch-pop');
    expect(al.hp).toBeGreaterThan(pt.guard);
    a.w.killEnemy(e);
    expect(pt.dead).toBe(true);
    expect(al.hp).toBe(pt.guard);
    a.step(30, keep);
    expect(of(a.w, TinkerPatch)).toHaveLength(0);
  });

  it('waits out a cooldown between repairs and alternates them with throws', () => {
    const a = arena('f3x-patch-cd');
    const keep = pin(a, a.cx + 60, a.cy + 30);
    const allies = [ally(a, 'chain_hound', a.cx - 40, a.cy - 30), ally(a, 'forge_sentinel', a.cx - 40, a.cy + 30), ally(a, 'fire_imp', a.cx - 90, a.cy + 40)];
    for (const x of allies) x.hp = x.maxHp * 0.4;
    const e = a.spawn(TINKER_ID, a.cx - 80, a.cy);
    const events: { t: number; kind: 'patch' | 'throw' }[] = [];
    const seen = new Set<number>();
    a.step(20 * 60, () => {
      keep();
      for (const x of all(a.w)) {
        if (seen.has(x.id)) continue;
        if (x instanceof TinkerPatch) events.push({ t: a.w.time, kind: 'patch' });
        else if (x instanceof TinkerHammer) events.push({ t: a.w.time, kind: 'throw' });
        else continue;
        seen.add(x.id);
      }
    });
    expect(e.alive).toBe(true);
    const ps = events.filter((x) => x.kind === 'patch');
    expect(ps.length).toBeGreaterThanOrEqual(2);
    expect(events.some((x) => x.kind === 'throw')).toBe(true);
    for (let i = 1; i < ps.length; i++) expect(ps[i].t - ps[i - 1].t).toBeGreaterThanOrEqual(PATCH_COOLDOWN - 1e-6);
    // never two repairs back to back without a throw in between (when the keeper is in range)
    for (let i = 1; i < events.length; i++) if (events[i].kind === 'patch') expect(events[i - 1].kind).toBe('throw');
  });

  it('never patches bosses, other tinkers or small fry', () => {
    const a = arena('f3x-patch-who');
    const e = a.spawn(TINKER_ID, a.cx - 40, a.cy);
    const other = ally(a, TINKER_ID, a.cx - 20, a.cy);
    const mote = ally(a, 'ember_mote', a.cx - 50, a.cy + 10);
    const lump = ally(a, 'slag_lump', a.cx - 60, a.cy - 10);
    for (const x of [other, mote, lump]) x.hp = x.maxHp * 0.3;
    a.step(1);
    expect(pickPatchTarget(a.w, e)).toBeNull();
    const boss = a.w.spawnEnemy(Enemies.all().find((d) => d.boss && d.bossFloors?.includes(3))!.id, a.cx - 70, a.cy)!;
    boss.hp = boss.maxHp * 0.3;
    a.step(1);
    expect(a.w.enemies).toContain(boss);
    expect(pickPatchTarget(a.w, e)).toBeNull();
    const imp = ally(a, 'fire_imp', e.x + 20, e.y + 20);
    a.step(1);
    expect(pickPatchTarget(a.w, e)).toBe(imp);
    // out of reach: ignored
    imp.x = a.cx + 140;
    expect(pickPatchTarget(a.w, e)).toBeNull();
  });
});

// ---------------------------------------------------------------- draw purity
describe('망치 땜장이: drawing never changes the simulation', () => {
  it('stateHash is unchanged by w.draw(1) (throws, patches, marks)', () => {
    const a = arena('f3x-draw');
    a.setMove((t) => [Math.cos(t * 1.1), Math.sin(t * 0.7)]);
    a.spawn(TINKER_ID, a.cx - 60, a.cy - 15, true);
    a.spawn(TINKER_ID, a.cx + 60, a.cy + 15);
    const h = ally(a, 'chain_hound', a.cx - 30, a.cy + 30);
    h.hp = h.maxHp * 0.5;
    let sawPatch = false;
    let sawHammer = false;
    for (let i = 0; i < 600; i++) {
      a.w.update(FIXED_DT);
      sawPatch ||= of(a.w, TinkerPatch).length > 0;
      sawHammer ||= of(a.w, TinkerHammer).length > 0;
      const before = stateHash(a.w);
      a.w.draw(1);
      expect(stateHash(a.w), `step ${i}`).toBe(before);
    }
    expect(sawPatch && sawHammer).toBe(true);
  });
});

// ---------------------------------------------------------------- lockstep determinism
describe('망치 땜장이: lockstep determinism', () => {
  it('identical state hashes across fx seeds, particle density and drawing', () => {
    const run = (fxSeed: number, drawEvery: number, particles: number): number[] => {
      fx.setState(new RNG(fxSeed).getState());
      const a = arena('f3x-lockstep');
      a.w.setQuality({ particles });
      a.setMove((t) => [Math.cos(t * 1.3), Math.sin(t * 0.9)]);
      // the keeper fires at whatever is nearest
      const inp = a.w.inputSource!;
      a.w.inputSource = (ww, p, o) => {
        inp(ww, p, o);
        o.held = 1 | 2;
        const t = ww.enemies[0];
        o.cx = t ? t.x : p.x + 20;
        o.cy = t ? t.y : p.y;
      };
      a.spawn('slag_golem', a.cx + 50, a.cy - 20);
      a.spawn('chain_hound', a.cx - 20, a.cy + 30);
      a.spawn(TINKER_ID, a.cx - 70, a.cy - 20, true);
      a.spawn(TINKER_ID, a.cx + 80, a.cy + 20);
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

  it('online co-op: two keepers over the lockstep stay identical with tinkers and their allies in the room', () => {
    let spawned = 0;
    const seen = new Set<string>();
    const res = runCoop({
      name: 'f3x coop', seed: 'F3X-COOP', chars: ['ria', 'serin'], floor: 3,
      ms: 24_000, link: { latencyMs: 30, jitterMs: 20 }, bossAt: 1e9, downAt: 0, leaveAt: 0, discardAt: 0, stayInRoom: true,
      extraStep(w, tick) {
        for (const x of w.entities) if (x instanceof TinkerHammer || x instanceof TinkerPatch) seen.add(x.constructor.name);
        if (tick < 120 || tick % 420 !== 0 || w.transitioning) return;
        const r = w.room;
        w.withIds(() => {
          const t = w.spawnEnemy(TINKER_ID, r.interiorX + 30, r.interiorY + 30);
          // (from the tick, not a counter: extraStep runs once per peer)
          if (t) t.champion = (tick / 420) % 2 === 1;
          const h = w.spawnEnemy('forge_sentinel', r.interiorX + 60, r.interiorY + 40);
          if (h) h.hp = h.maxHp * 0.5;
        });
        spawned++;
      },
    });
    const ref = res.peers[0].hashes;
    expect(ref.length).toBeGreaterThan(1000);
    for (const p of res.peers) {
      expect(p.desyncs, `slot ${p.slot} desync`).toEqual([]);
      const n = Math.min(ref.length, p.hashes.length);
      let checked = 0;
      for (let t = 0; t < n; t++) {
        if (p.hashes[t] === undefined || ref[t] === undefined) continue;
        expect(p.hashes[t], `slot ${p.slot} tick ${t}`).toBe(ref[t]);
        checked++;
      }
      expect(checked).toBeGreaterThan(900);
    }
    expect(spawned).toBeGreaterThan(2);
    expect([...seen].sort()).toEqual(['TinkerHammer', 'TinkerPatch']);
  }, 120_000);
});

// keep the Projectile import used (enemy bullets are not part of this enemy's kit)
describe('망치 땜장이: no stray bullets', () => {
  it('its attack is the hammer itself (no enemy projectiles of its own)', () => {
    const a = arena('f3x-nobullets');
    a.spawn(TINKER_ID, a.cx - 60, a.cy);
    let shots = 0;
    a.step(10 * 60, () => {
      pin(a, a.cx + 20, a.cy)();
      shots = Math.max(shots, of(a.w, Projectile).filter((p) => p.team === 'enemy').length);
    });
    expect(shots).toBe(0);
  });
});
