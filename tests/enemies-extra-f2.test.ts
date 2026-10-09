// 버섯개미 (fungus ant, floor 2, src/content/enemies/caves-extra.ts): definition and art,
// the fairy-ring slot layout, a 20 s headless run, the telegraphs, the ring's sprouts
// (harmless while growing, a soft stinging fence once grown), the converging spores,
// one ring per room, a clean death, a real-World hit and draw purity; fair play (it slips
// out of corners instead of pinning itself, a rush during the wind-up stops the drum, no
// rings without a line of sight or while charmed, a time stop freezes the ring, stepping
// into the gap answers every ring, elite damage carries over).

import './headless';
import { describe, expect, it } from 'vitest';
import { measureDps } from './dpsharness';
import { Enemies, Floors } from '../src/game/defs';
import { Enemy } from '../src/game/enemy';
import { Entity } from '../src/game/entity';
import { GroundWarning } from '../src/game/effects';
import { Projectile } from '../src/game/projectile';
import { World } from '../src/game/world';
import { getAnim, hasAnim, hasSprite } from '../src/engine/sprites';
import { fx, RNG } from '../src/engine/rng';
import { EnemyOverlay } from '../src/content/enemies/crypt-toll';
import { TAU } from '../src/engine/math';
import { FIXED_DT } from '../src/game/constants';
import { stateHash } from '../src/game/statehash';
import {
  CAST_MAX, CAST_MIN, DRUM_MIN, FENCE_END, PUFF_AT, PUFF_WARN, RING_GAP, RING_R, RING_SLOTS, RING_WINDUP, RingSprout, SPORE_SPEED,
  SPROUT_GROW, SPROUT_HIT, SporeRing, VOLLEY_GAP, WITHER, ringSlots, scuttleGait,
} from '../src/content/enemies/caves-extra';

const ID = 'fungus_ant';

function spriteDefined(name: string): boolean {
  if (hasAnim(name)) {
    const a = getAnim(name)!;
    return a.frames.length > 0 && a.frames.every((f) => hasSprite(f));
  }
  return hasSprite(name);
}

// ---------------------------------------------------------------- definition
describe('버섯개미: definition', () => {
  it('is a floor-2 regular within the balance guide', () => {
    const d = Enemies.must(ID);
    const f = Floors.all().find((x) => x.index === 2)!;
    expect(d.name).toBe('버섯개미');
    expect(d.name).toMatch(/^[가-힣 ]+$/);
    expect(d.floors).toEqual([2]);
    expect(d.boss).toBeFalsy();
    // regular: 25–45 floor-1 HP
    expect(d.hp).toBeGreaterThanOrEqual(25);
    expect(d.hp).toBeLessThanOrEqual(45);
    expect(d.cost ?? 1).toBeGreaterThanOrEqual(1);
    expect(d.cost ?? 1).toBeLessThanOrEqual(2);
    // under the keeper's 92 px/s, champion (x1.35) included
    expect((d.speed ?? 40) * (f.enemySpeed ?? 1)).toBeLessThan(92);
    expect((d.speed ?? 40) * 1.35 * (f.enemySpeed ?? 1)).toBeLessThan(92);
    expect(d.contactDamage ?? 1).toBe(1);
    expect(d.radius).toBeGreaterThanOrEqual(4);
    expect(d.radius).toBeLessThanOrEqual(8);
    expect(d.champion).toBe(true);
    expect(d.light?.radius).toBeGreaterThan(0);
    expect(d.deathFx).toBeDefined();
    expect(d.bloodColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(d.script).toBeTypeOf('function');
  });

  it('is in floor 2’s spawn pool with a weight in line with the floor’s other regulars, and nowhere else', () => {
    const pool = (index: number) => World.prototype.enemyPool.call({ floor: Floors.all().find((x) => x.index === index)! } as unknown as World);
    const p2 = pool(2);
    expect(p2[ID]).toBeGreaterThan(0);
    const others = Object.entries(p2).filter(([id]) => id !== ID && (Enemies.must(id).cost ?? 1) >= 1).map(([, wt]) => wt);
    expect(others.length).toBeGreaterThanOrEqual(8);
    expect(p2[ID]).toBeGreaterThanOrEqual(Math.min(...others));
    expect(p2[ID]).toBeLessThanOrEqual(Math.max(...others));
    for (const f of Floors.all()) if (f.index !== 2) expect(pool(f.index)[ID], `floor ${f.index}`).toBeUndefined();
  });

  it('has idle / run / rear (wind-up) / drum (attack) / hurt frames, and the sprouts grow / idle / puff / wither', () => {
    const anims = ['fant_idle', 'fant_run', 'fant_rear', 'fant_drum', 'fant_hurt', 'fsprout_grow', 'fsprout_idle', 'fsprout_puff', 'fsprout_wither'];
    for (const a of anims) expect(spriteDefined(a), a).toBe(true);
    expect(getAnim('fant_run')!.frames.length).toBe(4);
    for (const a of ['fant_idle', 'fant_rear', 'fant_drum', 'fsprout_idle']) expect(getAnim(a)!.frames.length, a).toBeGreaterThanOrEqual(2);
    expect(getAnim('fsprout_grow')!.frames.length).toBe(3);
    expect(spriteDefined(Enemies.must(ID).sprite)).toBe(true);
    // every animation the source names exists
    const src = Object.values(import.meta.glob('../src/content/enemies/caves-extra.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0];
    const names = new Set<string>();
    for (const m of src.matchAll(/setAnim\('([a-z0-9_]+)'/g)) names.add(m[1]);
    for (const m of src.matchAll(/hurtFrame\(e, w, '([a-z0-9_]+)'/g)) names.add(m[1]);
    expect(names.size).toBeGreaterThanOrEqual(5);
    for (const n of names) expect(spriteDefined(n), n).toBe(true);
  });
});

// ---------------------------------------------------------------- slot layout
describe('ringSlots: a ring open toward the ant, closing on the far side', () => {
  const ang = (a: number, b: number) => {
    let d = (a - b) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return Math.abs(d);
  };

  it('leaves out the slots facing the ant and puts the rest on the circle', () => {
    for (const [fx0, fy0] of [[200, 100], [100, 20], [37, 160], [100.5, 100]]) {
      const slots = ringSlots(100, 100, fx0, fy0);
      expect(slots.length).toBe(RING_SLOTS - RING_GAP);
      const toAnt = Math.atan2(fy0 - 100, fx0 - 100);
      const step = TAU / RING_SLOTS;
      for (const s of slots) {
        expect(Math.hypot(s.x - 100, s.y - 100)).toBeCloseTo(RING_R, 6);
        // nothing inside the gap: the nearest sprout is 1.5 slots from the ant's direction
        expect(ang(s.a, toAnt)).toBeGreaterThan(step * 1.4);
      }
      // the gap is a real opening: the two sprouts beside it stand 2.5 sprout spacings apart
      const near = slots.slice(0, 2);
      expect(Math.hypot(near[0].x - near[1].x, near[0].y - near[1].y)).toBeGreaterThan(2.5 * 2 * RING_R * Math.sin(step / 2));
      // planting order: pairs, mirror images across the ant's line, moving away from the gap
      for (let i = 0; i + 1 < slots.length; i += 2) {
        expect(ang(slots[i].a, toAnt)).toBeCloseTo(ang(slots[i + 1].a, toAnt), 6);
        if (i >= 2) expect(ang(slots[i].a, toAnt)).toBeGreaterThan(ang(slots[i - 2].a, toAnt));
      }
      // the last pair sits on the far side
      expect(ang(slots[slots.length - 1].a, toAnt)).toBeGreaterThan(Math.PI * 0.85);
    }
  });

  it('an odd gap keeps one slot exactly opposite the ant', () => {
    const slots = ringSlots(0, 0, 50, 0, 30, 10, 1);
    expect(slots.length).toBe(9);
    expect(slots.some((s) => Math.abs(s.x + 30) < 1e-6 && Math.abs(s.y) < 1e-6)).toBe(true);
  });

  it('telegraph times are all at least 0.3 s, and the fence comes down after the spores', () => {
    expect(RING_WINDUP).toBeGreaterThanOrEqual(0.3);
    expect(SPROUT_GROW).toBeGreaterThanOrEqual(0.3);
    expect(PUFF_WARN).toBeGreaterThanOrEqual(0.3);
    // the floor warning inside the ring runs from the drum to the puff
    expect(PUFF_AT).toBeGreaterThanOrEqual(RING_WINDUP + 0.3);
    expect(FENCE_END).toBeGreaterThan(PUFF_AT + VOLLEY_GAP + RING_R / SPORE_SPEED);
    expect(CAST_MIN).toBeGreaterThan(RING_R);
    expect(CAST_MAX).toBeGreaterThan(CAST_MIN);
    // the gap's way out must not lead straight into the ant's body: a keeper (r 5) walking
    // clear of the ring's edge (sprout sting reach) still has room before touching the ant (r 5)
    const keeperR = 5;
    expect(DRUM_MIN).toBeGreaterThanOrEqual(RING_R + SPROUT_HIT + keeperR * 0.6 + keeperR + Enemies.must(ID).radius);
    expect(CAST_MIN).toBeGreaterThan(DRUM_MIN);
  });

  it('the scuttle keeps one gait per burst: no dithering on the edge of its 70–120 px band', () => {
    // a burst picks its gait at the start ...
    expect(scuttleGait(130, null)).toBe(1);
    expect(scuttleGait(95, null)).toBe(0);
    expect(scuttleGait(65, null)).toBe(-1);
    // ... a sidle only turns into a retreat / approach past a margin, never back
    for (const d of [69, 68, 60, 121, 130]) expect(scuttleGait(d, 0), `${d}`).toBe(0);
    expect(scuttleGait(50, 0)).toBe(-1);
    expect(scuttleGait(140, 0)).toBe(1);
    for (const d of [40, 71, 95, 200]) expect(scuttleGait(d, -1), `${d}`).toBe(-1);
    expect(scuttleGait(100, 1)).toBe(1);
    expect(scuttleGait(60, 1)).toBe(-1);
  });
});

// ---------------------------------------------------------------- fake world (as in enemies-new-f12)
interface FakePlayer {
  x: number; y: number; vx: number; vy: number; r: number; z: number; alive: boolean; slot: number; dashing: boolean;
  kbx: number; kby: number; invuln: number; statuses: Map<string, unknown>; hurts: number; hurtLog: { t: number; n: number; src: string }[];
  hurt(w: unknown, n: number, src?: string): boolean; knock(): void; hasStatus(k: string): boolean; applyStatus(s: { kind: string }): boolean;
}
interface FakeWorld {
  w: World;
  entities: Entity[];
  player: FakePlayer;
}

const IX = 32;
const IY = 32;
const IW = 272;
const IH = 144;

function fakeWorld(seed: string): FakeWorld {
  const inside = (x: number, y: number, r: number) => x - r >= IX && y - r >= IY && x + r <= IX + IW && y + r <= IY + IH;
  const room = {
    interiorX: IX, interiorY: IY, interiorW: IW, interiorH: IH, centerX: IX + IW / 2, centerY: IY + IH / 2,
    boxBlocked: (x: number, y: number, r: number) => !inside(x, y, r),
    isFree: (x: number, y: number, r = 6) => inside(x, y, r),
    nearestFree: (x: number, y: number, r = 6) => ({ x: Math.min(IX + IW - r, Math.max(IX + r, x)), y: Math.min(IY + IH - r, Math.max(IY + r, y)) }),
    lineOfSight: () => true,
    tileAt: (tx: number, ty: number) => (inside(tx * 16 + 8, ty * 16 + 8, 0) ? 0 : 1),
    tileAtPx: (x: number, y: number) => (inside(x, y, 0) ? 0 : 1),
    destroyTile: () => {},
    damageTile: () => {},
    doors: [],
  };
  const fw = {} as FakeWorld;
  const player: FakePlayer = {
    x: IX + IW / 2, y: IY + IH - 30, vx: 0, vy: 0, r: 5, z: 0, alive: true, slot: 0, dashing: false, kbx: 0, kby: 0, invuln: 0,
    statuses: new Map(), hurts: 0, hurtLog: [],
    hurt(_w: unknown, n: number, src = '') {
      if (player.dashing || player.invuln > 0) return false;
      player.hurts++;
      // like the real keeper: a moment of invulnerability after a hit
      player.invuln = 0.8;
      player.hurtLog.push({ t: (fw.w as unknown as { time: number }).time, n, src });
      return true;
    },
    knock() {},
    hasStatus: (k: string) => player.statuses.has(k),
    applyStatus(s: { kind: string }) { player.statuses.set(s.kind, s); return true; },
  };
  const entities: Entity[] = [];
  const enemies: Enemy[] = [];
  const projectiles: Projectile[] = [];
  const w = {
    rng: new RNG(seed),
    dt: FIXED_DT,
    time: 0,
    roomTime: 0,
    enemyTimeScale: 1,
    floor: { index: 2, hpMult: 1, enemySpeed: 1 },
    vars: {} as Record<string, number>,
    player,
    targets: () => [player],
    room,
    enemies,
    projectiles,
    entities,
    flow: { dirAt: () => null },
    particles: { burst: () => {}, spawn: () => {} },
    lights: { add: () => {}, glow: () => {} },
    spawn<T extends Entity>(e: T): T {
      entities.push(e);
      if (e instanceof Enemy) enemies.push(e);
      if (e instanceof Projectile) projectiles.push(e);
      return e;
    },
    spawnEnemy(id: string, x: number, y: number): Enemy | null {
      const def = Enemies.get(id);
      if (!def) return null;
      const e = new Enemy(def, x, y, 1);
      w.spawn(e);
      e.start(w as unknown as World);
      return e;
    },
    killEnemy(e: Enemy) {
      if (e.dead) return;
      e.hp = Math.min(0, e.hp);
      e.dead = true;
      e.def.onDeath?.(e, w as unknown as World);
    },
    explode: () => {},
    sfx: () => {},
    shake: () => {},
    hitstop: () => {},
    decal: () => {},
    statusDamage: () => {},
    nearestEnemy: () => null,
  };
  fw.w = w as unknown as World;
  fw.entities = entities;
  fw.player = player;
  return fw;
}

/** Step the fake world; `move` (when given) places the keeper each frame. */
function step(fw: FakeWorld, seconds: number, onFrame?: (t: number) => void, move?: (t: number) => void): void {
  const w = fw.w as unknown as { time: number; roomTime: number; dt: number; enemies: Enemy[]; projectiles: Projectile[] };
  const frames = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < frames; i++) {
    w.time += w.dt;
    w.roomTime += w.dt;
    move?.(w.time);
    if (fw.player.invuln > 0) fw.player.invuln -= w.dt;
    for (const e of [...fw.entities]) if (!e.dead) e.update(fw.w, w.dt);
    for (const e of w.enemies) if (!e.dead && e.hp <= 0) fw.w.killEnemy(e);
    const alive = fw.entities.filter((e) => !e.dead);
    fw.entities.splice(0, fw.entities.length, ...alive);
    w.enemies.splice(0, w.enemies.length, ...w.enemies.filter((e) => !e.dead));
    w.projectiles.splice(0, w.projectiles.length, ...w.projectiles.filter((e) => !e.dead));
    onFrame?.(w.time);
  }
}

const strafe = (fw: FakeWorld) => (t: number) => {
  fw.player.x = 168 + Math.cos(t * 0.8) * 90;
  fw.player.y = 104 + Math.sin(t * 1.1) * 45;
};

const rings = (fw: FakeWorld) => fw.entities.filter((x): x is SporeRing => x instanceof SporeRing);
const sprouts = (fw: FakeWorld) => fw.entities.filter((x): x is RingSprout => x instanceof RingSprout);
const armed = (fw: FakeWorld) => sprouts(fw).filter((s) => s.armed);

/** Danger right now: enemy shots or a grown (stinging) sprout. */
function danger(fw: FakeWorld): boolean {
  return fw.w.projectiles.some((p) => !p.dead && p.team === 'enemy') || armed(fw).length > 0;
}

function telegraphing(fw: FakeWorld): boolean {
  return fw.entities.some((x) => x instanceof GroundWarning || (x instanceof Enemy && x.telegraphT > 0));
}

/** Spawn an awake ant and a still keeper `d` px to its right; returns the ant. */
function setup(seed: string, d = 100, champion = false): { fw: FakeWorld; e: Enemy } {
  const fw = fakeWorld(seed);
  const e = fw.w.spawnEnemy(ID, 100, 104)!;
  e.dormant = 0;
  e.champion = champion;
  Object.assign(fw.player, { x: 100 + d, y: 104 });
  return { fw, e };
}

/** Run until the ant's first ring appears; returns the time (or -1). */
function untilRing(fw: FakeWorld, max = 8, move?: (t: number) => void): number {
  let at = -1;
  const w = fw.w as unknown as { time: number };
  const end = w.time + max;
  while (at < 0 && w.time < end) {
    step(fw, FIXED_DT, undefined, move);
    if (rings(fw).length) at = w.time;
  }
  return at;
}

// ---------------------------------------------------------------- headless AI
describe('버섯개미: headless AI', () => {
  it('runs 20 s without errors, stays in the room, rings the keeper and can die cleanly', () => {
    for (const seed of ['a', 'b', 'c']) {
      const fw = fakeWorld(`fant-${seed}`);
      const e = fw.w.spawnEnemy(ID, 120, 70)!;
      let ringsSeen = 0;
      const seen = new Set<Entity>();
      step(fw, 20, () => {
        expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
        expect(e.x).toBeGreaterThanOrEqual(IX - 1);
        expect(e.y).toBeGreaterThanOrEqual(IY - 1);
        expect(e.x).toBeLessThanOrEqual(IX + IW + 1);
        expect(e.y).toBeLessThanOrEqual(IY + IH + 1);
        for (const r of rings(fw)) if (!seen.has(r)) {
          seen.add(r);
          ringsSeen++;
        }
      }, strafe(fw));
      expect(e.alive).toBe(true);
      // a ring every few seconds
      expect(ringsSeen, seed).toBeGreaterThanOrEqual(3);
      expect(ringsSeen, seed).toBeLessThanOrEqual(7);
      expect(fw.entities.some((x) => x instanceof EnemyOverlay)).toBe(true);
      fw.w.killEnemy(e);
      step(fw, WITHER + 0.1);
      expect(fw.entities.filter((x) => x instanceof SporeRing || x instanceof RingSprout || x instanceof GroundWarning || x instanceof EnemyOverlay)).toEqual([]);
    }
  });

  it('creates danger within 12 s, always telegraphed at least 0.3 s first', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const fw = fakeWorld(`fant-danger-${seed}`);
      fw.w.spawnEnemy(ID, 120, 70);
      let tTele = -1;
      let tDanger = -1;
      let tHurt = -1;
      step(fw, 12, (t) => {
        if (tTele < 0 && telegraphing(fw)) tTele = t;
        if (tDanger < 0 && danger(fw)) tDanger = t;
        if (tHurt < 0 && fw.player.hurts > 0) tHurt = t;
      }, strafe(fw));
      expect(tDanger, seed).toBeGreaterThan(0);
      expect(tTele, seed).toBeGreaterThan(0);
      expect(tDanger - tTele, `${seed}: warned ${tDanger - tTele}s ahead`).toBeGreaterThanOrEqual(0.3 + SPROUT_GROW);
      if (tHurt > 0) expect(tHurt).toBeGreaterThan(tTele);
    }
  });

  it('slips out of a corner or along a wall instead of grinding into it (regression)', () => {
    // a keeper planted 30–40 px away pins the ant against the walls: it used to flee straight
    // into the wall / corner and stay there, never far enough to drum again
    const cases: [string, number, number, number, number][] = [
      ['top-left corner', IX + 7, IY + 7, IX + 34, IY + 26],
      ['top-right corner', IX + IW - 7, IY + 7, IX + IW - 34, IY + 22],
      ['bottom-right corner', IX + IW - 7, IY + IH - 7, IX + IW - 30, IY + IH - 28],
      ['right wall', IX + IW - 7, IY + 20, IX + IW - 42, IY + 32],
      ['bottom wall', IX + 140, IY + IH - 7, IX + 128, IY + IH - 42],
    ];
    for (const [name, ax, ay, px, py] of cases) {
      for (const seed of ['a', 'b']) {
        const fw = fakeWorld(`fant-corner-${name}-${seed}`);
        const e = fw.w.spawnEnemy(ID, ax, ay)!;
        e.dormant = 0;
        Object.assign(fw.player, { x: px, y: py });
        // within a couple of seconds it has worked its way back out to drumming range
        let far = 0;
        step(fw, 3, () => {
          far = Math.max(far, Math.hypot(e.x - px, e.y - py));
        });
        expect(far, `${name}/${seed}: got only ${far.toFixed(0)} px from the keeper, at (${e.x.toFixed(0)}, ${e.y.toFixed(0)})`).toBeGreaterThanOrEqual(CAST_MIN);
      }
    }
  });

  it('keeps its distance: a keeper walking up to it does not catch it in the open', () => {
    const fw = fakeWorld('fant-space');
    const e = fw.w.spawnEnemy(ID, 168, 104)!;
    e.dormant = 0;
    Object.assign(fw.player, { x: 200, y: 104 });
    step(fw, 1.5);
    expect(Math.hypot(e.x - fw.player.x, e.y - fw.player.y)).toBeGreaterThan(55);
  });
});

// ---------------------------------------------------------------- the ring
describe('버섯개미: the fairy ring', () => {
  it('rears for its wind-up, then rings the spot where the keeper stands, open toward the ant', () => {
    const { fw, e } = setup('ring-shape', 100);
    let teleAt = -1;
    const at = untilRing(fw, 8, () => {
      if (teleAt < 0 && e.telegraphT > 0) teleAt = (fw.w as unknown as { time: number }).time;
    });
    expect(at).toBeGreaterThan(0);
    expect(at - teleAt).toBeGreaterThanOrEqual(RING_WINDUP - 0.02);
    expect(e.anim).toBe('fant_drum');
    const ring = rings(fw)[0];
    expect(ring.cx).toBeCloseTo(fw.player.x, 6);
    expect(ring.cy).toBeCloseTo(fw.player.y, 6);
    expect(ring.slots.length).toBe(RING_SLOTS - RING_GAP);
    // the danger zone is marked on the floor until the spores fly
    const warn = fw.entities.find((x) => x instanceof GroundWarning) as GroundWarning;
    expect(warn).toBeTruthy();
    expect(warn.time).toBeCloseTo(PUFF_AT, 6);
    expect(warn.radius).toBeLessThan(RING_R);
    // the opening faces the ant
    const toAnt = Math.atan2(e.y - ring.cy, e.x - ring.cx);
    for (const s of ring.slots) expect(Math.cos(s.a - toAnt)).toBeLessThan(Math.cos((TAU / RING_SLOTS) * 1.4));
    // sprouts pop up pair by pair, all of them within a few frames of PUFF_AT - PUFF_WARN - SPROUT_GROW
    step(fw, PUFF_AT - PUFF_WARN - SPROUT_GROW + 0.02);
    expect(sprouts(fw).length).toBe(RING_SLOTS - RING_GAP);
  });

  it('sprouts are harmless while they grow, then sting a keeper who walks into one (base strength 1), never one dashing', () => {
    for (const dashing of [false, true]) {
      const { fw } = setup(`ring-fence-${dashing}`, 100);
      expect(untilRing(fw)).toBeGreaterThan(0);
      const ring = rings(fw)[0];
      step(fw, FIXED_DT);
      const s = sprouts(fw)[0];
      // stand right on the first sprout while it grows
      Object.assign(fw.player, { x: s.x + 1, y: s.y, dashing });
      step(fw, SPROUT_GROW - 2 * FIXED_DT);
      expect(s.armed).toBe(false);
      expect(fw.player.hurts).toBe(0);
      step(fw, 4 * FIXED_DT);
      expect(s.armed).toBe(true);
      expect(fw.player.hurts).toBe(dashing ? 0 : 1);
      if (!dashing) {
        expect(fw.player.hurtLog[0].n).toBe(1);
        expect(fw.player.hurtLog[0].src).toBe('버섯개미');
      }
      // just outside its sting reach is safe
      Object.assign(fw.player, { x: s.x + SPROUT_HIT + fw.player.r * 0.6 + 1.5, y: s.y, dashing: false, invuln: 0 });
      const before = fw.player.hurts;
      step(fw, 0.2);
      expect(fw.player.hurts).toBe(before);
      expect(ring.dead).toBe(false);
    }
  });

  it('when the ring has closed, every sprout puffs one spore at its middle (base strength 1); champions puff twice', () => {
    for (const champ of [false, true]) {
      const { fw } = setup(`ring-puff-${champ}`, 100, champ);
      const at = untilRing(fw);
      expect(at).toBeGreaterThan(0);
      const ring = rings(fw)[0];
      const spawnedAt = new Map<Projectile, number>();
      step(fw, FENCE_END, (t) => {
        for (const p of fw.w.projectiles) if (!spawnedAt.has(p)) spawnedAt.set(p, t);
      });
      const shots = [...spawnedAt.keys()];
      expect(shots.length).toBe((RING_SLOTS - RING_GAP) * (champ ? 2 : 1));
      const first = Math.min(...spawnedAt.values());
      // the spores fly PUFF_AT after the drum (the inhale shows for PUFF_WARN before)
      expect(Math.abs(first - (at + PUFF_AT))).toBeLessThanOrEqual(FIXED_DT * 2.5);
      for (const p of shots) {
        expect(p.team).toBe('enemy');
        expect(p.damage).toBe(1);
        expect(p.speed).toBe(SPORE_SPEED);
        // gone before passing the middle
        expect(p.range).toBeLessThanOrEqual(RING_R);
        expect(p.range).toBeGreaterThan(RING_R - 6);
      }
      if (champ) {
        const times = [...new Set([...spawnedAt.values()].map((t) => Math.round(t * 100) / 100))].sort((x, y) => x - y);
        expect(times.length).toBe(2);
        expect(times[1] - times[0]).toBeCloseTo(VOLLEY_GAP, 1);
      }
    }
  });

  it('spores fly from the sprouts straight at the middle and stop there', () => {
    const { fw } = setup('ring-aim', 100);
    expect(untilRing(fw)).toBeGreaterThan(0);
    const ring = rings(fw)[0];
    const start = new Map<Projectile, { x: number; y: number }>();
    let maxRun = 0;
    step(fw, FENCE_END, () => {
      for (const p of fw.w.projectiles) {
        if (!start.has(p)) {
          start.set(p, { x: p.x, y: p.y });
          // starts on a sprout
          expect(Math.min(...ring.slots.map((s) => Math.hypot(s.x - p.x, s.y - p.y)))).toBeLessThan(3);
          // heads for the middle
          expect(Math.cos(p.angle - Math.atan2(ring.cy - p.y, ring.cx - p.x))).toBeGreaterThan(0.999);
        }
        maxRun = Math.max(maxRun, Math.hypot(p.x - start.get(p)!.x, p.y - start.get(p)!.y));
      }
    });
    expect(start.size).toBe(RING_SLOTS - RING_GAP);
    // they reach (almost) the middle and never fly on past it
    expect(maxRun).toBeGreaterThan(RING_R - 8);
    expect(maxRun).toBeLessThanOrEqual(RING_R);
    expect(fw.w.projectiles.length).toBe(0);
  });

  it('the fence withers at FENCE_END and the ant is free to ring again', () => {
    const { fw, e } = setup('ring-end', 100);
    expect(untilRing(fw)).toBeGreaterThan(0);
    expect(e.mem.ringing).toBe(1);
    step(fw, FENCE_END - FIXED_DT * 2);
    expect(armed(fw).length).toBe(RING_SLOTS - RING_GAP);
    step(fw, FIXED_DT * 4);
    expect(armed(fw).length).toBe(0);
    expect(e.mem.ringing).toBe(0);
    step(fw, WITHER + 0.05);
    expect(rings(fw).length + sprouts(fw).length).toBe(0);
  });

  it('killing the ant mid-ring withers it at once: no spores, no stings, nothing left over', () => {
    const { fw, e } = setup('ring-kill', 100);
    expect(untilRing(fw)).toBeGreaterThan(0);
    step(fw, SPROUT_GROW + 0.2);
    expect(armed(fw).length).toBeGreaterThan(0);
    fw.w.killEnemy(e);
    step(fw, FIXED_DT);
    expect(armed(fw).length).toBe(0);
    // walk over where the sprouts were
    const s = sprouts(fw)[0];
    Object.assign(fw.player, { x: s.x, y: s.y });
    step(fw, PUFF_AT + 0.5);
    expect(fw.player.hurts).toBe(0);
    expect(fw.w.projectiles.length).toBe(0);
    expect(fw.entities.filter((x) => x instanceof SporeRing || x instanceof RingSprout || x instanceof GroundWarning)).toEqual([]);
  });

  it('a bullet-clear withers the ring and its sprouts', () => {
    const { fw } = setup('ring-clear', 100);
    expect(untilRing(fw)).toBeGreaterThan(0);
    step(fw, SPROUT_GROW + 0.3);
    for (const x of [...fw.entities]) if (x.enemyHazard) x.onCleared?.(fw.w);
    step(fw, FIXED_DT);
    expect(armed(fw).length).toBe(0);
    step(fw, PUFF_AT);
    expect(fw.w.projectiles.length).toBe(0);
    expect(rings(fw).length + sprouts(fw).length).toBe(0);
  });

  it('a room’s ants take turns: never two rings at once', () => {
    const fw = fakeWorld('ring-colony');
    for (const [x, y] of [[60, 60], [280, 60], [170, 160]]) fw.w.spawnEnemy(ID, x, y)!.dormant = 0;
    let most = 0;
    let total = 0;
    const seen = new Set<Entity>();
    step(fw, 20, () => {
      const live = rings(fw).filter((r) => !r.ended);
      most = Math.max(most, live.length);
      for (const r of live) if (!seen.has(r)) {
        seen.add(r);
        total++;
      }
    }, strafe(fw));
    expect(most).toBe(1);
    expect(total).toBeGreaterThanOrEqual(5);
  });

  it('does not ring a keeper it cannot fit a ring around, or one too close / too far', () => {
    // too far
    const far = setup('ring-far', CAST_MAX + 40);
    step(far.fw, 4, () => {
      // pin the ant in place so it cannot walk into range
      far.e.x = 100;
      far.e.y = 104;
    });
    expect(rings(far.fw).length).toBe(0);
    // a keeper wedged into a corner: too few sprouts fit on open floor
    const corner = setup('ring-corner', 0);
    Object.assign(corner.fw.player, { x: IX + 6, y: IY + 6 });
    step(corner.fw, 4, () => {
      corner.e.x = IX + 80;
      corner.e.y = IY + 60;
    });
    for (const r of rings(corner.fw)) expect(r.slots.length).toBeGreaterThanOrEqual(4);
  });
});

describe('버섯개미: fair play', () => {
  /** Run until the ant starts rearing; returns false if it never does. */
  const untilRear = (fw: FakeWorld, e: Enemy, max = 8): boolean => {
    for (let t = 0; t < max && e.anim !== 'fant_rear'; t += FIXED_DT) step(fw, FIXED_DT);
    return e.anim === 'fant_rear';
  };

  it('a keeper who rushes the ant during its wind-up stops the drum: no ring, and it is free to try again', () => {
    const { fw, e } = setup('rush', 100);
    expect(untilRear(fw, e)).toBe(true);
    // charge at it during the wind-up
    step(fw, RING_WINDUP + 0.1, undefined, () => {
      const a = Math.atan2(e.y - fw.player.y, e.x - fw.player.x);
      if (Math.hypot(e.x - fw.player.x, e.y - fw.player.y) > 24) {
        fw.player.x += Math.cos(a) * 92 * FIXED_DT;
        fw.player.y += Math.sin(a) * 92 * FIXED_DT;
      }
    });
    expect(Math.hypot(e.x - fw.player.x, e.y - fw.player.y)).toBeLessThan(DRUM_MIN);
    expect(rings(fw).length).toBe(0);
    expect(e.mem.ringing).toBe(0);
    // the keeper backs off to the middle of the room: the next ring comes
    Object.assign(fw.player, { x: IX + IW / 2, y: IY + IH / 2 });
    expect(untilRing(fw, 8)).toBeGreaterThan(0);
  });

  it('does not drum without a line of sight to the keeper (no rings through rock walls)', () => {
    const { fw } = setup('blind', 100);
    (fw.w.room as unknown as { lineOfSight: () => boolean }).lineOfSight = () => false;
    step(fw, 8);
    expect(rings(fw).length).toBe(0);
  });

  it('a charmed ant does not drum at the keeper', () => {
    const { fw, e } = setup('charm', 100);
    e.applyStatus({ kind: 'charm', duration: 30 }, () => 0);
    step(fw, 8);
    expect(rings(fw).length).toBe(0);
  });

  it('a time stop freezes the ring like any enemy shot: no spores, no stings until time runs again', () => {
    const { fw } = setup('timestop', 100);
    expect(untilRing(fw)).toBeGreaterThan(0);
    const w = fw.w as unknown as { enemyTimeScale: number };
    const ring = rings(fw)[0];
    step(fw, 0.2);
    const age0 = ring.age;
    w.enemyTimeScale = 0.04;
    step(fw, 3);
    // barely aged; nothing puffed; the floor warning waits with it
    expect(ring.age - age0).toBeLessThan(0.15);
    expect(fw.w.projectiles.length).toBe(0);
    expect(ring.ended).toBe(false);
    const warn = fw.entities.find((x) => x instanceof GroundWarning) as GroundWarning;
    expect(warn).toBeTruthy();
    w.enemyTimeScale = 1;
    // the spores fly when the ring has aged PUFF_AT, and the warning ends with them
    let puffedAt = -1;
    step(fw, PUFF_AT, (t) => {
      if (puffedAt < 0 && fw.w.projectiles.length) puffedAt = t;
    });
    expect(puffedAt).toBeGreaterThan(0);
    expect(Math.abs(ring.age - PUFF_AT) < PUFF_AT).toBe(true);
    expect(warn.dead).toBe(true);
  });
});

// ---------------------------------------------------------------- real world
describe('버섯개미 in the real World', () => {
  it('a keeper who stands still is stung by the converging spores for one half-heart', () => {
    const { world: w, dummies } = measureDps({ character: 'ria', weapon: 'lantern_bolt', seconds: 0, dist: 60, seed: 'fant-real' });
    for (const d of dummies) w.killEnemy(d);
    w.inputSource = (_w, _p, o) => { o.mx = o.my = o.ax = o.ay = o.held = o.pressed = 0; };
    const p = w.player;
    p.god = false;
    p.invuln = 0;
    const ant = w.spawnEnemy(ID, p.x + 90, p.y)!;
    ant.dormant = 0;
    for (let i = 0; i < 2; i++) w.update(FIXED_DT);
    const hp0 = p.red + p.soul;
    let ringAt = -1;
    let hurtAt = -1;
    for (let i = 0; i < 60 * 10 && hurtAt < 0; i++) {
      w.update(FIXED_DT);
      if (ringAt < 0 && w.entities.some((x) => x instanceof SporeRing)) ringAt = w.time;
      if (p.red + p.soul < hp0) hurtAt = w.time;
    }
    expect(ringAt).toBeGreaterThan(0);
    expect(hurtAt).toBeGreaterThan(ringAt + PUFF_AT);
    expect(hp0 - (p.red + p.soul)).toBe(1);
    expect(w.run.lastDamageSource).toBe('버섯개미');
  });

  it('is fair: a keeper who answers each ring by stepping into its gap is never hurt by the ant', () => {
    for (const seed of ['fair-a', 'fair-b', 'fair-c']) {
      const { world: w, dummies } = measureDps({ character: 'ria', weapon: 'lantern_bolt', seconds: 0, dist: 60, seed });
      for (const d of dummies) w.killEnemy(d);
      w.floor = Floors.all().find((x) => x.index === 2)!;
      const p = w.player;
      p.god = false;
      const ant = w.spawnEnemy(ID, p.x + 100, p.y - 30)!;
      ant.dormant = 0;
      ant.hp = 1e6;
      let ringsSeen = 0;
      const seen = new Set<SporeRing>();
      // the answer: when a ring grows around you, step ~30 px into its gap (toward the ant) and wait
      w.inputSource = (ww, _p, o) => {
        o.mx = o.my = o.ax = o.ay = o.held = o.pressed = 0;
        const ring = ww.entities.find((x): x is SporeRing => x instanceof SporeRing && !x.ended);
        if (!ring) return;
        if (!seen.has(ring)) {
          seen.add(ring);
          ringsSeen++;
        }
        if (Math.hypot(ww.player.x - ring.cx, ww.player.y - ring.cy) > 30) return;
        const a = Math.atan2(ring.owner.y - ring.cy, ring.owner.x - ring.cx);
        o.mx = Math.cos(a);
        o.my = Math.sin(a);
      };
      for (let i = 0; i < 25 / FIXED_DT; i++) {
        p.red = Math.max(p.red, 6);
        w.update(FIXED_DT);
      }
      expect(ringsSeen, seed).toBeGreaterThanOrEqual(4);
      expect(w.run.stats.damageTaken, `${seed}: hurt by ${w.run.lastDamageSource}`).toBe(0);
    }
  });

  it('an elite ant (mission rooms) carries its damage scale into the ring, its sprouts and its spores', () => {
    const { world: w, dummies } = measureDps({ character: 'ria', weapon: 'lantern_bolt', seconds: 0, dist: 60, seed: 'fant-elite' });
    for (const d of dummies) w.killEnemy(d);
    w.inputSource = (_w, _p, o) => { o.mx = o.my = o.ax = o.ay = o.held = o.pressed = 0; };
    w.player.god = true;
    const ant = w.spawnEnemy(ID, w.player.x + 90, w.player.y)!;
    ant.dormant = 0;
    ant.enemyDamageScale = 1.5;
    let spores = 0;
    for (let i = 0; i < 60 * 8 && !spores; i++) {
      w.update(FIXED_DT);
      spores = w.projectiles.filter((x) => x.team === 'enemy').length;
    }
    expect(spores).toBeGreaterThan(0);
    for (const x of w.entities) {
      if (x instanceof SporeRing || x instanceof RingSprout || (x instanceof Projectile && x.team === 'enemy')) expect(x.enemyDamageScale).toBe(1.5);
    }
  });

  it('draws without touching the simulation (stateHash unchanged by w.draw)', () => {
    const { world: w, dummies } = measureDps({ character: 'ria', weapon: 'lantern_bolt', seconds: 0, dist: 60, seed: 'fant-draw' });
    for (const d of dummies) w.killEnemy(d);
    w.inputSource = (_w, _p, o) => { o.mx = o.my = o.ax = o.ay = o.held = o.pressed = 0; };
    const p = w.player;
    p.god = true;
    for (const [dx, dy, champ] of [[90, -20, false], [-80, 30, true]] as const) {
      const e = w.spawnEnemy(ID, p.x + dx, p.y + dy)!;
      e.dormant = 0;
      e.champion = champ;
    }
    let drawnRing = false;
    let drawnSpores = false;
    for (let i = 0; i < 480; i++) {
      w.update(FIXED_DT);
      if (w.entities.some((x) => x instanceof RingSprout)) drawnRing = true;
      if (w.projectiles.some((x) => x.team === 'enemy')) drawnSpores = true;
      const before = stateHash(w);
      w.draw(1);
      expect(stateHash(w), `step ${i}`).toBe(before);
    }
    expect(drawnRing && drawnSpores).toBe(true);
  });

  it('is lockstep-safe: the cosmetic RNG and drawing never change its simulation', () => {
    const run = (fxSeed: string, draw: boolean) => {
      fx.setState(new RNG(fxSeed).getState());
      const { world: w, dummies } = measureDps({ character: 'ria', weapon: 'lantern_bolt', seconds: 0, dist: 60, seed: 'fant-lockstep' });
      for (const d of dummies) w.killEnemy(d);
      // the keeper circles the room, firing at the ants
      w.inputSource = (ww, _p, o) => {
        o.mx = Math.cos(ww.time * 0.9);
        o.my = Math.sin(ww.time * 1.3);
        o.ax = o.ay = o.pressed = 0;
        o.held = 0;
      };
      w.player.god = true;
      for (const [dx, dy, champ] of [[90, -20, false], [-80, 30, true], [20, 50, false]] as const) {
        const e = w.spawnEnemy(ID, w.player.x + dx, w.player.y + dy)!;
        e.dormant = 0;
        e.champion = champ;
      }
      const hashes: number[] = [];
      let ringsSeen = 0;
      for (let i = 0; i < 900; i++) {
        w.update(FIXED_DT);
        if (w.entities.some((x) => x instanceof SporeRing && x.age < FIXED_DT * 1.5)) ringsSeen++;
        if (draw) w.draw(i % 2 ? 0.5 : 1);
        hashes.push(stateHash(w));
      }
      return { hashes, ringsSeen };
    };
    const a = run('fx-a', false);
    const b = run('fx-b', true);
    expect(a.ringsSeen).toBeGreaterThanOrEqual(3);
    expect(b.hashes).toEqual(a.hashes);
  });
});
