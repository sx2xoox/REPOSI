// Floor 7 (멈춘 태엽탑) basic enemies added in clock-alarm.ts: 자명종 폭탄 (alarm bomber) and
// 시곗바늘 방패병 (clock-hand guardian). Definitions and sprites, the pure shield / beat
// helpers, a headless AI simulation (the floor-7 fake world), the signature mechanics
// (the alarm rings two beats and goes off on the beat or jams when killed mid-ring; the
// shield ticks with the beat, swallows the keeper's shots and the fan goes out through the
// gap) on the real World, and draw purity.

import './headless';
import { describe, expect, it } from 'vitest';
import { measureDps } from './dpsharness';
import { Enemies } from '../src/game/defs';
import { Enemy } from '../src/game/enemy';
import { Entity } from '../src/game/entity';
import { GroundWarning } from '../src/game/effects';
import { Projectile } from '../src/game/projectile';
import { FIXED_DT } from '../src/game/constants';
import { stateHash } from '../src/game/statehash';
import { getAnim, hasAnim, hasSprite, listSprites } from '../src/engine/sprites';
import { RNG, fx } from '../src/engine/rng';
import type { World } from '../src/game/world';
import { BEAT, beatIndex } from '../src/content/enemies/clock-shared';
import {
  ALARM_R, ALARM_TRIGGER, AlarmWarning, ARC_HALF, ARC_R, arcBlocks, arcCovers, gapAim, handAngle, JamSpring, RING_BEATS,
} from '../src/content/enemies/clock-alarm';

const FLOOR = 7;
const NEW = ['alarm_bomber', 'hand_guardian'] as const;
/** fodder 12–22, regular 25–45 (floor-1 HP units) */
const HP_BAND: Record<string, [number, number]> = { alarm_bomber: [12, 22], hand_guardian: [25, 45] };

function spriteDefined(name: string): boolean {
  if (hasAnim(name)) {
    const a = getAnim(name)!;
    return a.frames.length > 0 && a.frames.every((f) => hasSprite(f));
  }
  return hasSprite(name);
}

/** fractional position of `t` inside its beat */
const beatFrac = (t: number) => t / BEAT - beatIndex(t);
/** `t` sits on a beat boundary (within a frame) */
const onBeat = (t: number) => beatFrac(t) < 1.5 / 60 || beatFrac(t) > 1 - 0.5 / 60;

// ---------------------------------------------------------------- definitions
describe('floor 7 new basic enemies: definitions', () => {
  it('are registered for floor 7 only, with Korean names and basic-enemy numbers', () => {
    for (const id of NEW) {
      const d = Enemies.must(id);
      expect(d.name, id).toMatch(/^[가-힣 ]+$/);
      expect(d.floors, id).toEqual([FLOOR]);
      expect(d.boss, id).toBeFalsy();
      const [lo, hi] = HP_BAND[id];
      expect(d.hp, id).toBeGreaterThanOrEqual(lo);
      expect(d.hp, id).toBeLessThanOrEqual(hi);
      expect(d.cost ?? 1, id).toBeGreaterThanOrEqual(0.7);
      expect(d.cost ?? 1, id).toBeLessThanOrEqual(2);
      expect(d.weight ?? 1, id).toBeGreaterThanOrEqual(0.8);
      expect(d.weight ?? 1, id).toBeLessThanOrEqual(1.1);
      expect(d.speed ?? 40, id).toBeLessThan(84);
      expect(d.contactDamage ?? 1, id).toBeLessThanOrEqual(2);
      expect(d.radius, id).toBeGreaterThan(2);
      expect(d.champion, id).toBe(true);
      expect(d.deathFx, id).toBeDefined();
      expect(d.bloodColor, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(d.light?.radius, id).toBeGreaterThan(0);
      expect(d.light?.color, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(d.script, id).toBeTypeOf('function');
      expect(spriteDefined(d.sprite), `${id} sprite`).toBe(true);
    }
  });

  it('each has a hurt frame and at least three animated states; every referenced sprite exists', () => {
    const all = listSprites();
    for (const id of NEW) {
      const prefix = Enemies.must(id).sprite.split('_')[0];
      const states = new Set(all.filter((n) => n.startsWith(prefix + '_') && hasAnim(n.replace(/_\d+$/, ''))).map((n) => n.split('_')[1]));
      expect(states.has('hurt'), `${id} hurt`).toBe(true);
      expect(states.size, `${id} states ${[...states]}`).toBeGreaterThanOrEqual(3);
      // walking / attacking animate (more than one frame)
      const animated = [...states].filter((s) => (getAnim(`${prefix}_${s}`)?.frames.length ?? 0) > 1);
      expect(animated.length, `${id} animated states`).toBeGreaterThanOrEqual(2);
    }
    for (const n of ['ckalarm_walk', 'ckalarm_wind', 'ckalarm_ring', 'ckalarm_panic', 'ckalarm_hurt', 'ckalarm_spring', 'ckguard_walk', 'ckguard_brace', 'ckguard_fire', 'ckguard_hurt']) {
      expect(spriteDefined(n), n).toBe(true);
    }
    for (let i = 0; i < 64; i++) for (const s of ['b', 'f']) expect(hasSprite(`ckshield_arc_${i}${s}`)).toBe(true);
  });
});

// ---------------------------------------------------------------- pure helpers
describe('clock-hand guardian helpers', () => {
  it('handAngle holds most of a beat, then ticks a quarter turn clockwise onto the beat', () => {
    const b = 0.3;
    const t0 = BEAT * 8;
    expect(handAngle(b, t0)).toBeCloseTo(b + 8 * (Math.PI / 2));
    expect(handAngle(b, t0 + BEAT * 0.5)).toBeCloseTo(b + 8 * (Math.PI / 2));
    const mid = handAngle(b, t0 + BEAT * 0.82);
    expect(mid).toBeGreaterThan(b + 8 * (Math.PI / 2));
    expect(mid).toBeLessThan(b + 9 * (Math.PI / 2));
    expect(handAngle(b, t0 + BEAT * 0.999)).toBeCloseTo(b + 9 * (Math.PI / 2), 3);
    // one full turn every four beats, and it never runs backwards
    expect(handAngle(b, t0 + 4 * BEAT) - handAngle(b, t0)).toBeCloseTo(Math.PI * 2);
    let prev = handAngle(b, t0);
    for (let t = t0; t < t0 + 4 * BEAT; t += 1 / 60) {
      const a = handAngle(b, t);
      expect(a).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = a;
    }
  });

  it('arcBlocks catches a shot crossing the plates, not one on the open side or passing wide', () => {
    // shield facing west (π); a shot from the west running east into it
    expect(arcBlocks(100, 100, Math.PI, 70, 100, 92, 100, 3)).toBe(true);
    // a shot from the east (open side) heading west toward the body
    expect(arcBlocks(100, 100, Math.PI, 130, 100, 108, 100, 3)).toBe(false);
    // a shot passing far below
    expect(arcBlocks(100, 100, Math.PI, 70, 140, 130, 140, 3)).toBe(false);
    // near the arc's edge (~55°) still blocks, well past it does not
    const a = Math.PI + ARC_HALF * 0.9;
    expect(arcBlocks(100, 100, Math.PI, 100 + Math.cos(a) * 25, 100 + Math.sin(a) * 25, 100 + Math.cos(a) * ARC_R, 100 + Math.sin(a) * ARC_R, 2)).toBe(true);
    const b = Math.PI + ARC_HALF + 0.6;
    expect(arcBlocks(100, 100, Math.PI, 100 + Math.cos(b) * 25, 100 + Math.sin(b) * 25, 100 + Math.cos(b) * 9, 100 + Math.sin(b) * 9, 2)).toBe(false);
    // a fast shot that would jump over the band within one step is still caught
    expect(arcBlocks(100, 100, Math.PI, 78, 100, 96, 100, 3)).toBe(true);
  });

  it('gapAim: the whole far half is open to a single arc; a champion keeps its fan inside a narrow gap', () => {
    const hand = 0.4;
    expect(gapAim(hand + Math.PI, hand, false, 0.22)).toBeCloseTo(hand + Math.PI);
    expect(gapAim(hand + Math.PI + 1.2, hand, false, 0.22)).toBeCloseTo(hand + Math.PI + 1.2);
    expect(gapAim(hand, hand, false, 0.22)).toBeNull();
    expect(gapAim(hand + 1.0, hand, false, 0.22)).toBeNull();
    // champion: arcs at hand and hand + π, gaps at hand ± π/2 (70° each)
    expect(gapAim(hand, hand, true, 0.24)).toBeNull();
    expect(gapAim(hand + Math.PI, hand, true, 0.24)).toBeNull();
    const g = hand + Math.PI / 2;
    expect(gapAim(g, hand, true, 0.24)).toBeCloseTo(g);
    const edge = gapAim(g + 0.55, hand, true, 0.24)!;
    expect(edge).not.toBeNull();
    // clamped so the outer cogs stay clear of both arcs
    expect(arcCovers(edge + 0.24, hand, true)).toBe(false);
    expect(arcCovers(edge - 0.24, hand, true)).toBe(false);
    expect(arcCovers(hand + 0.3, hand, false)).toBe(true);
    expect(arcCovers(hand + Math.PI, hand, false)).toBe(false);
    expect(arcCovers(hand + Math.PI, hand, true)).toBe(true);
  });
});

// ---------------------------------------------------------------- fake world (as tests/floor7.test.ts)
interface FakePlayer {
  x: number; y: number; vx: number; vy: number; r: number; z: number; alive: boolean; aim: number;
  kbx: number; kby: number; lastAttackAt: number; statuses: Map<string, unknown>; hurts: number;
  hurt(): boolean; knock(): void; hasStatus(k: string): boolean; applyStatus(s: { kind: string }): boolean;
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
  const player: FakePlayer = {
    x: IX + IW / 2, y: IY + IH - 30, vx: 0, vy: 0, r: 5, z: 0, alive: true, aim: 0, kbx: 0, kby: 0, lastAttackAt: -99,
    statuses: new Map(), hurts: 0,
    hurt() { player.hurts++; return true; },
    knock() {},
    hasStatus: (k: string) => player.statuses.has(k),
    applyStatus(s: { kind: string }) { player.statuses.set(s.kind, s); return true; },
  };
  const entities: Entity[] = [];
  const enemies: Enemy[] = [];
  const projectiles: Projectile[] = [];
  const w = {
    rng: new RNG(seed),
    dt: 1 / 60,
    time: 0,
    roomTime: 0,
    enemyTimeScale: 1,
    floor: { index: FLOOR, hpMult: 1 },
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
  return { w: w as unknown as World, entities, player };
}

function step(fw: FakeWorld, seconds: number, onFrame?: (t: number) => void, strafe = true): void {
  const w = fw.w as unknown as { time: number; roomTime: number; dt: number; enemies: Enemy[]; projectiles: Projectile[] };
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) {
    w.time += w.dt;
    w.roomTime += w.dt;
    if (strafe) {
      fw.player.x = 168 + Math.cos(w.time * 0.8) * 90;
      fw.player.y = 104 + Math.sin(w.time * 1.1) * 45;
    }
    for (const e of [...fw.entities]) if (!e.dead) e.update(fw.w, w.dt);
    for (const e of w.enemies) if (!e.dead && e.hp <= 0) fw.w.killEnemy(e);
    const alive = fw.entities.filter((e) => !e.dead);
    fw.entities.splice(0, fw.entities.length, ...alive);
    w.enemies.splice(0, w.enemies.length, ...w.enemies.filter((e) => !e.dead));
    w.projectiles.splice(0, w.projectiles.length, ...w.projectiles.filter((e) => !e.dead));
    onFrame?.(w.time);
  }
}

const enemyShots = (fw: FakeWorld) => fw.entities.filter((x): x is Projectile => x instanceof Projectile && x.team === 'enemy');

describe('floor 7 new basic enemies: headless AI', () => {
  for (const id of NEW) {
    it(`${id} runs 12 s without errors, stays in the room and can die`, () => {
      const fw = fakeWorld(`sim7n-${id}`);
      const e = fw.w.spawnEnemy(id, 120, 70)!;
      expect(e).toBeTruthy();
      step(fw, 12, () => {
        for (const o of fw.w.enemies) {
          expect(Number.isFinite(o.x) && Number.isFinite(o.y), `${o.def.id} position`).toBe(true);
          expect(o.x).toBeGreaterThanOrEqual(IX);
          expect(o.y).toBeGreaterThanOrEqual(IY);
          expect(o.x).toBeLessThanOrEqual(IX + IW);
          expect(o.y).toBeLessThanOrEqual(IY + IH);
        }
      });
      // a fresh one dies to damage like any enemy
      const f2 = fakeWorld(`die7n-${id}`);
      const e2 = f2.w.spawnEnemy(id, 120, 70)!;
      step(f2, 1, undefined, false);
      e2.takeHit(f2.w, { damage: 999, kind: 'explosion' });
      step(f2, 0.5, undefined, false);
      expect(e2.dead).toBe(true);
    });

    it(`${id} creates telegraphed danger within 12 s (a ground warning before any damage)`, () => {
      const fw = fakeWorld(`danger7n-${id}`);
      fw.w.spawnEnemy(id, 120, 70);
      let firstWarn = -1;
      let firstDanger = -1;
      let firstHurt = -1;
      step(fw, 12, (t) => {
        if (firstWarn < 0 && fw.entities.some((x) => x instanceof GroundWarning)) firstWarn = t;
        if (firstDanger < 0 && enemyShots(fw).length) firstDanger = t;
        if (firstHurt < 0 && fw.player.hurts > 0) firstHurt = t;
      });
      expect(firstWarn, `${id} warning`).toBeGreaterThan(0);
      expect(firstDanger, `${id} bullets`).toBeGreaterThan(0);
      expect(firstDanger).toBeGreaterThan(firstWarn + 0.4);
      if (firstHurt >= 0) expect(firstHurt).toBeGreaterThan(firstWarn + 0.4);
    });
  }
});

// ---------------------------------------------------------------- 자명종 폭탄
describe('alarm bomber: rings two beats, goes off on the beat, jams if killed mid-ring', () => {
  /** Spawn a bomber next to a standing keeper and run it until it starts ringing. */
  function ringing(seed: string, gap = 30): { fw: FakeWorld; e: Enemy; t0: number; warn: AlarmWarning } {
    const fw = fakeWorld(seed);
    fw.player.x = 200;
    fw.player.y = 104;
    const e = fw.w.spawnEnemy('alarm_bomber', 200 - gap, 104)!;
    let t0 = -1;
    for (let i = 0; i < 360 && t0 < 0; i++) {
      step(fw, 1 / 60, (t) => {
        if (e.mem.ring === 1) t0 = t;
      }, false);
    }
    expect(t0, 'started ringing').toBeGreaterThan(0);
    const warn = fw.entities.find((x): x is AlarmWarning => x instanceof AlarmWarning)!;
    return { fw, e, t0, warn };
  }

  it('starts ringing on a beat once close, and carries its blast zone along', () => {
    const fw = fakeWorld('alarm-close');
    fw.player.x = 250;
    fw.player.y = 104;
    const e = fw.w.spawnEnemy('alarm_bomber', 80, 104)!;
    let t0 = -1;
    let distAtStart = 0;
    step(fw, 6, (t) => {
      if (t0 < 0 && e.mem.ring === 1) {
        t0 = t;
        distAtStart = Math.hypot(fw.player.x - e.x, fw.player.y - e.y);
      }
    }, false);
    expect(t0).toBeGreaterThan(0);
    // it ran in first, then set its alarm, ringing on the beat
    expect(distAtStart).toBeLessThan(ALARM_TRIGGER);
    expect(onBeat(t0), `rang at ${t0}`).toBe(true);
    // (the run of 170 px at ~46 px/s took a few seconds)
    expect(t0).toBeGreaterThan(2);
  });

  it('a lone runner that never reaches its keeper still rings after ~5 s', () => {
    const fw = fakeWorld('alarm-patience');
    const e = fw.w.spawnEnemy('alarm_bomber', 60, 60)!;
    let t0 = -1;
    // the keeper keeps running away along the far wall
    step(fw, 8, (t) => {
      fw.player.x = 290;
      fw.player.y = t % 2 < 1 ? 50 : 160;
      if (t0 < 0 && e.mem.ring === 1) t0 = t;
    }, false);
    expect(t0).toBeGreaterThan(0);
    expect(t0).toBeLessThan(5 + 0.4 + BEAT + 0.1);
  });

  it('rings exactly two beats with a carried dial warning, then blasts the keeper in range and rings out 8 cogs', () => {
    const { fw, e, t0, warn } = ringing('alarm-blast');
    expect(warn).toBeTruthy();
    expect(warn.radius).toBe(ALARM_R);
    let boom = -1;
    let cogs = 0;
    let maxSpeed = 0;
    let lastProgress = 0;
    const hurtsBefore = fw.player.hurts;
    step(fw, 3, (t) => {
      if (!e.dead) {
        // the warning stays centred on the alarm and fills toward the blast
        expect(warn.x).toBeCloseTo(e.x, 6);
        expect(warn.y).toBeCloseTo(e.y, 6);
        expect(warn.progress).toBeGreaterThanOrEqual(lastProgress - 1e-9);
        lastProgress = warn.progress;
        maxSpeed = Math.max(maxSpeed, Math.hypot(e.vx, e.vy));
      } else if (boom < 0) {
        boom = t;
        cogs = enemyShots(fw).length;
      }
    }, false);
    expect(boom).toBeGreaterThan(0);
    expect(boom - t0).toBeCloseTo(RING_BEATS * BEAT, 1);
    expect(onBeat(boom), `went off at ${boom}`).toBe(true);
    expect(e.mem.exploded).toBe(1);
    expect(warn.dead).toBe(true);
    expect(lastProgress).toBeGreaterThan(0.9);
    // it creeps while it rings (~30% speed)
    expect(maxSpeed).toBeLessThan(Enemies.must('alarm_bomber').speed! * 0.4);
    // the keeper stood inside the zone: one hit; and a ring of cogs flew out
    expect(fw.player.hurts - hurtsBefore).toBe(1);
    expect(cogs).toBe(8);
  });

  it('the blast spares a keeper who stepped out of the zone', () => {
    const { fw, e } = ringing('alarm-escape');
    fw.player.x = e.x + ALARM_R + 30;
    fw.player.y = e.y;
    step(fw, 2, undefined, false);
    expect(e.dead).toBe(true);
    expect(e.mem.exploded).toBe(1);
    expect(fw.player.hurts).toBe(0);
  });

  it('killed while ringing it JAMS: no blast, no cogs, the warning goes, a spring pops out', () => {
    const { fw, e, warn } = ringing('alarm-jam');
    step(fw, 0.4, undefined, false);
    expect(e.mem.ring).toBe(1);
    e.takeHit(fw.w, { damage: 999, kind: 'projectile', dirX: 1, dirY: 0 });
    step(fw, 2, undefined, false);
    expect(e.dead).toBe(true);
    expect(e.mem.exploded).toBeFalsy();
    expect(warn.dead).toBe(true);
    expect(fw.player.hurts).toBe(0);
    expect(enemyShots(fw).length).toBe(0);
    expect(fw.entities.some((x) => x instanceof AlarmWarning)).toBe(false);
    // the spring is purely visual
    const fw2 = ringing('alarm-jam2');
    fw2.fw.w.killEnemy(fw2.e);
    const springs = fw2.fw.entities.filter((x) => x instanceof JamSpring);
    expect(springs.length).toBe(1);
    expect((springs[0].constructor as typeof Entity).cosmetic).toBe(true);
    expect(springs[0].id).toBeLessThan(0);
  });

  it('killed before it rings it simply breaks (no warning, no blast)', () => {
    const fw = fakeWorld('alarm-early');
    fw.player.x = 280;
    fw.player.y = 104;
    const e = fw.w.spawnEnemy('alarm_bomber', 60, 104)!;
    step(fw, 0.8, undefined, false);
    expect(e.mem.ring).toBe(0);
    e.takeHit(fw.w, { damage: 999, kind: 'projectile' });
    step(fw, 2, undefined, false);
    expect(e.dead).toBe(true);
    expect(fw.entities.some((x) => x instanceof GroundWarning || x instanceof JamSpring)).toBe(false);
    expect(enemyShots(fw).length).toBe(0);
  });
});

// ---------------------------------------------------------------- 시곗바늘 방패병
describe('clock-hand guardian: beat-ticking shield and fans through the gap', () => {
  it('fires its fan on the beat, through the gap, one beat after the lanes light up', () => {
    for (const champion of [false, true]) {
      const fw = fakeWorld(`guard-fan-${champion}`);
      fw.player.x = 260;
      fw.player.y = 104;
      const e = fw.w.spawnEnemy('hand_guardian', 90, 104)!;
      e.champion = champion;
      // champion gaps sit on the dial's quarter lines: put one on the keeper's side
      if (champion) e.mem.base = 0;
      e.speed = 0;
      const seen = new Set<number>();
      const volleys = new Map<number, number[]>();
      let lanesAt: number[] = [];
      step(fw, 12, (t) => {
        if (fw.entities.some((x) => x instanceof GroundWarning && x.rw > 0)) lanesAt.push(t);
        for (const p of enemyShots(fw)) {
          if (seen.has(p.id)) continue;
          seen.add(p.id);
          const b = beatIndex(t);
          volleys.set(b, [...(volleys.get(b) ?? []), p.angle]);
          expect(onBeat(t), `shot at ${t}`).toBe(true);
          // clear of every shield plate at that moment
          expect(arcCovers(p.angle, handAngle(e.mem.base, t), champion), `angle ${p.angle} at ${t}`).toBe(false);
          // lanes were shown during the beat before
          expect(lanesAt.some((l) => t - l > 0.35 && t - l < BEAT + 0.05)).toBe(true);
        }
        lanesAt = lanesAt.filter((l) => t - l < 2);
      }, false);
      expect(volleys.size, `champion ${champion}`).toBeGreaterThanOrEqual(2);
      for (const angles of volleys.values()) expect(angles.length).toBe(champion ? 5 : 3);
      // at most one fan per turn of the hand (four beats)
      const beats = [...volleys.keys()].sort((a, b) => a - b);
      for (let i = 1; i < beats.length; i++) expect(beats[i] - beats[i - 1]).toBeGreaterThanOrEqual(4);
      expect(e.mem.fans).toBe(volleys.size);
    }
  });

  it('marches on the beat toward a keeper hiding behind its shield', () => {
    const fw = fakeWorld('guard-march');
    fw.player.x = 280;
    fw.player.y = 104;
    const e = fw.w.spawnEnemy('hand_guardian', 60, 104)!;
    const x0 = e.x;
    let moving = 0;
    let still = 0;
    step(fw, 6, (t) => {
      const sp = Math.hypot(e.vx, e.vy);
      const f = beatFrac(t);
      if (e.anim === 'ckguard_walk') {
        if (f > 0.1 && f < 0.45 && sp > 20) moving++;
        if (f > 0.75 && sp < 2) still++;
      }
    }, false);
    expect(e.x).toBeGreaterThan(x0 + 40);
    expect(moving).toBeGreaterThan(20);
    expect(still).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------- real World: the shield swallows shots
describe('clock-hand guardian on the real World', () => {
  function setup(seed: string) {
    const r = measureDps({ character: 'ria', weapon: 'lantern_bolt', seconds: 0, seed });
    const w = r.world;
    w.inputSource = (_w, _p, o) => { o.mx = o.my = o.ax = o.ay = o.held = o.pressed = 0; };
    // the harness's training dummy is still pending (not yet in w.enemies): remove it
    for (const e of r.dummies) w.killEnemy(e);
    for (let i = 0; i < 5; i++) w.update(FIXED_DT);
    const p = w.player;
    p.god = true;
    const g = w.spawnEnemy('hand_guardian', p.x + 70, p.y)!;
    g.speed = 0;
    // past the spawn grace, and just after a beat (the hand holds still ~0.49 s)
    for (let i = 0; i < 240 && (g.dormant > 0 || beatFrac(w.time) > 0.05 || beatFrac(w.time) < 0.01); i++) w.update(FIXED_DT);
    expect(g.dormant).toBeLessThanOrEqual(0);
    return { w, p, g };
  }
  /** Turn the guardian's shield to `a` (the hand holds there for the rest of this beat). */
  const faceShield = (w: World, g: Enemy, a: number) => {
    g.mem.base = a - handAngle(0, w.time + FIXED_DT);
  };
  const shoot = (w: World, g: Enemy, from: number) => w.spawn(new Projectile({
    team: 'player', x: g.x + Math.cos(from) * 40, y: g.y + Math.sin(from) * 40, angle: from + Math.PI, speed: 240, damage: 7, radius: 3, owner: w.player,
  }));

  it('a shot that runs into the plates is destroyed and does no damage', () => {
    const { w, g } = setup('guard-block');
    const from = Math.PI; // the keeper's side (west)
    faceShield(w, g, from);
    const hp = g.hp;
    const pr = shoot(w, g, from);
    for (let i = 0; i < 20; i++) w.update(FIXED_DT);
    expect(pr.dead).toBe(true);
    expect(g.hp).toBe(hp);
    expect(g.mem.blocks).toBe(1);
  });

  it('a shot through the open side hits normally', () => {
    const { w, g } = setup('guard-open');
    const from = Math.PI;
    faceShield(w, g, 0);
    const hp = g.hp;
    const pr = shoot(w, g, from);
    for (let i = 0; i < 20; i++) w.update(FIXED_DT);
    expect(pr.dead).toBe(true);
    expect(g.hp).toBeCloseTo(hp - 7, 5);
    expect(g.mem.blocks).toBe(0);
  });

  it('a champion\'s second arc guards the opposite side; side shots slip through its gaps', () => {
    const { w, g } = setup('guard-champ');
    g.champion = true;
    faceShield(w, g, 0);
    const hp = g.hp;
    const back = shoot(w, g, Math.PI);
    for (let i = 0; i < 20; i++) w.update(FIXED_DT);
    expect(back.dead).toBe(true);
    expect(g.hp).toBe(hp);
    expect(g.mem.blocks).toBe(1);
    faceShield(w, g, 0);
    const side = shoot(w, g, Math.PI / 2);
    for (let i = 0; i < 20; i++) w.update(FIXED_DT);
    expect(side.dead).toBe(true);
    expect(g.hp).toBeLessThan(hp);
  });

  it('blades striking from the shield side glance off; from the open side they cut', () => {
    const { w, g } = setup('guard-melee');
    faceShield(w, g, Math.PI);
    w.update(FIXED_DT);
    const hp = g.hp;
    // a swing from the west travels east (dir +x)
    g.takeHit(w, { damage: 20, kind: 'melee', dirX: 1, dirY: 0, attacker: w.player });
    expect(hp - g.hp).toBeCloseTo(4, 5);
    const hp2 = g.hp;
    g.takeHit(w, { damage: 20, kind: 'melee', dirX: -1, dirY: 0, attacker: w.player });
    expect(hp2 - g.hp).toBeCloseTo(20, 5);
    // releases are never blocked
    const hp3 = g.hp;
    g.takeHit(w, { damage: 20, kind: 'melee', dirX: 1, dirY: 0, attacker: w.player, release: true });
    expect(hp3 - g.hp).toBeCloseTo(20, 5);
  });

  it('a frozen guardian\'s shield is seized: shots pass', () => {
    const { w, g } = setup('guard-frozen');
    faceShield(w, g, Math.PI);
    w.update(FIXED_DT);
    g.applyStatus({ kind: 'freeze', duration: 2 }, () => 0);
    const hp = g.hp;
    shoot(w, g, Math.PI);
    for (let i = 0; i < 20; i++) w.update(FIXED_DT);
    expect(g.hp).toBeLessThan(hp);
    expect(g.mem.blocks).toBe(0);
  });
});

// ---------------------------------------------------------------- draw purity / determinism
/** A real World with both enemies (and a champion guardian) under a bot that keeps shooting the guardian. */
function arena(seed: string): World {
  const r = measureDps({ character: 'ria', weapon: 'lantern_bolt', seconds: 0, seed });
  const w = r.world;
  for (const e of r.dummies) w.killEnemy(e);
  const p = w.player;
  p.god = true;
  const bot = w.inputSource;
  w.inputSource = (ww, pp, o) => {
    bot(ww, pp, o);
    const g = ww.enemies.find((e) => e.def.id === 'hand_guardian');
    if (g) { o.cx = g.x; o.cy = g.y; }
  };
  w.spawnEnemy('hand_guardian', p.x + 60, p.y - 20);
  w.spawnEnemy('alarm_bomber', p.x + 40, p.y + 30);
  const champ = w.spawnEnemy('hand_guardian', p.x - 60, p.y + 10)!;
  champ.champion = true;
  return w;
}

describe('floor 7 new basic enemies: drawing never changes the simulation', () => {
  it('stateHash is unchanged by draw() with both enemies active (ringing, bracing, blocking)', () => {
    const w = arena('f7-draw');
    let ringing = false;
    let blocked = 0;
    for (let i = 0; i < 420; i++) {
      w.update(FIXED_DT);
      if (w.enemies.some((e) => e.def.id === 'alarm_bomber' && e.mem.ring === 1)) ringing = true;
      for (const e of w.enemies) if (e.def.id === 'hand_guardian') blocked = Math.max(blocked, e.mem.blocks);
      const before = stateHash(w);
      w.draw(1);
      expect(stateHash(w), `step ${i}`).toBe(before);
    }
    expect(ringing).toBe(true);
    expect(blocked).toBeGreaterThan(0);
  });

  it('the simulation does not depend on the cosmetic RNG', () => {
    const run = (fxSeed: number): number[] => {
      fx.setState(new RNG(fxSeed).getState());
      const w = arena('f7-det');
      const out: number[] = [];
      for (let i = 0; i < 360; i++) {
        w.update(FIXED_DT);
        if (i % 3 === 0) w.draw(1);
        out.push(stateHash(w));
      }
      return out;
    };
    const a = run(1);
    const b = run(0x9e3779b9);
    expect(b).toEqual(a);
  });
});

