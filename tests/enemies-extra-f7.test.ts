// Floor 7 (멈춘 태엽탑) extra enemy in clock-extra.ts: 걸음쇠 (walking compass). Definition
// and sprites, the floor-7 spawn pool, the pure helpers (hinge height, circle fitting,
// arc coverage, step choice), a headless AI simulation on the floor-7 fake world (it walks
// by steps no faster than the keeper, warns the band before it cuts, the cut burns once at
// base strength, the fence holds then goes out, a keeper penned inside is safe from it,
// killing it snuffs the line, nothing is left behind), and on the real World: draw purity
// and independence from the cosmetic RNG next to two of the floor's own enemies.

import './headless';
import { describe, expect, it } from 'vitest';
import { measureDps } from './dpsharness';
import { Enemies, Floors } from '../src/game/defs';
import { Enemy } from '../src/game/enemy';
import { Entity } from '../src/game/entity';
import { GroundWarning } from '../src/game/effects';
import { Projectile } from '../src/game/projectile';
import { FIXED_DT } from '../src/game/constants';
import { stateHash } from '../src/game/statehash';
import { getAnim, hasAnim, hasSprite } from '../src/engine/sprites';
import { RNG, fx } from '../src/engine/rng';
import { TAU } from '../src/engine/math';
import type { World } from '../src/game/world';
import {
  arcCovered, CompassWreck, FENCE_FADE, FENCE_HOLD, hingeHeight, KEEP_OFF, LEG, pickStep, SCRIBE_DRAW, SCRIBE_R, SCRIBE_R_CHAMP,
  SCRIBE_TELE, ScribeLine, scribeRadius, ScribeWarning, STEP_SPAN, stepGoal, type StepPick,
} from '../src/content/enemies/clock-extra';

const FLOOR = 7;
const ID = 'walking_compass';
const KEEPER_SPEED = 92;

function spriteDefined(name: string): boolean {
  if (hasAnim(name)) {
    const a = getAnim(name)!;
    return a.frames.length > 0 && a.frames.every((f) => hasSprite(f));
  }
  return hasSprite(name);
}

// ---------------------------------------------------------------- definition
describe('걸음쇠: definition', () => {
  it('is a floor-7 regular with Korean name and regular-enemy numbers', () => {
    const d = Enemies.must(ID);
    expect(d.name).toBe('걸음쇠');
    expect(d.name).toMatch(/^[가-힣 ]+$/);
    expect(d.floors).toEqual([FLOOR]);
    expect(d.boss).toBeFalsy();
    // regular band (floor-1 units): 25–45
    expect(d.hp).toBeGreaterThanOrEqual(25);
    expect(d.hp).toBeLessThanOrEqual(45);
    expect(d.cost ?? 1).toBeGreaterThanOrEqual(1.5);
    expect(d.cost ?? 1).toBeLessThanOrEqual(2.5);
    expect(d.contactDamage ?? 1).toBe(1);
    const floor = Floors.all().find((f) => f.index === FLOOR)!;
    expect((d.speed ?? 40) * (floor.enemySpeed ?? 1)).toBeLessThan(KEEPER_SPEED);
    expect(d.radius).toBeGreaterThan(2);
    expect(d.champion).toBe(true);
    expect(d.deathFx).toBe('metal');
    expect(d.bloodColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(d.light?.radius).toBeGreaterThan(0);
    expect(d.script).toBeTypeOf('function');
    expect(spriteDefined(d.sprite)).toBe(true);
  });

  it('has idle / step / wind-up / scribe / rest animations and a hurt frame (the head; legs are drawn live)', () => {
    for (const s of ['idle', 'step', 'wind', 'scribe', 'rest']) {
      const a = getAnim(`ckcomp_${s}`);
      expect(a, s).toBeTruthy();
      expect(a!.frames.length, s).toBe(2);
      for (const f of a!.frames) expect(hasSprite(f), f).toBe(true);
    }
    expect(spriteDefined('ckcomp_hurt')).toBe(true);
    expect(hasSprite('ckcomp_hurt_0')).toBe(true);
  });

  it('joins the floor-7 spawn pool with a weight in line with the floor\'s other regulars', () => {
    const r = measureDps({ character: 'ria', weapon: 'lantern_bolt', seconds: 0, seed: 'f7x-pool' });
    const w = r.world;
    w.startFloor(FLOOR);
    expect(w.floor.index).toBe(FLOOR);
    const pool = w.enemyPool();
    expect(pool[ID]).toBe(0.8);
    const others = Object.entries(pool).filter(([id]) => id !== ID).map(([, v]) => v);
    expect(others.length).toBeGreaterThanOrEqual(12);
    expect(pool[ID]).toBeGreaterThanOrEqual(Math.min(...others));
    expect(pool[ID]).toBeLessThanOrEqual(Math.max(...others));
    const total = Object.values(pool).reduce((a, b) => a + b, 0);
    const share = pool[ID] / total;
    expect(share).toBeGreaterThan(0.04);
    expect(share).toBeLessThan(0.1);
    // its cost sits among the floor's mid-weight regulars
    const costs = Object.keys(pool).map((id) => Enemies.must(id).cost ?? 1);
    expect(Enemies.must(ID).cost!).toBeGreaterThan(Math.min(...costs));
    expect(Enemies.must(ID).cost!).toBeLessThan(Math.max(...costs));
  });
});

// ---------------------------------------------------------------- pure helpers
interface FakeRoom {
  interiorX: number; interiorY: number; interiorW: number; interiorH: number;
  boxBlocked(x: number, y: number, r: number, flying?: boolean, phasing?: boolean): boolean;
  isFree(x: number, y: number, r?: number): boolean;
}
function openRoom(x0 = 32, y0 = 32, w = 272, h = 144, rocks: { x: number; y: number; w: number; h: number }[] = []): FakeRoom {
  const inside = (x: number, y: number, r: number) => x - r >= x0 && y - r >= y0 && x + r <= x0 + w && y + r <= y0 + h;
  const rock = (x: number, y: number, r: number) => rocks.some((k) => x + r > k.x && x - r < k.x + k.w && y + r > k.y && y - r < k.y + k.h);
  return {
    interiorX: x0, interiorY: y0, interiorW: w, interiorH: h,
    boxBlocked: (x, y, r, flying = false) => !inside(x, y, r) || (!flying && rock(x, y, r)),
    isFree: (x, y, r = 6) => inside(x, y, r) && !rock(x, y, r),
  };
}

describe('걸음쇠: helpers', () => {
  it('hingeHeight: tall while it walks, low when it opens wide, flat past twice its leg', () => {
    expect(hingeHeight(STEP_SPAN)).toBeCloseTo(Math.sqrt(LEG * LEG - 13 * 13), 6);
    expect(hingeHeight(STEP_SPAN)).toBeGreaterThan(18);
    expect(hingeHeight(SCRIBE_R)).toBeLessThan(hingeHeight(STEP_SPAN));
    expect(hingeHeight(SCRIBE_R_CHAMP)).toBeGreaterThan(0);
    expect(hingeHeight(LEG * 2)).toBe(0);
    expect(hingeHeight(LEG * 3)).toBe(0);
  });

  it('scribeRadius keeps the circle inside the room and never goes negative', () => {
    const room = openRoom();
    expect(scribeRadius(room, 168, 104, SCRIBE_R)).toBe(SCRIBE_R);
    // 30 px from the left wall: shrunk to 27
    expect(scribeRadius(room, 62, 104, SCRIBE_R)).toBeCloseTo(27, 6);
    expect(scribeRadius(room, 33, 33, SCRIBE_R)).toBe(0);
    expect(scribeRadius(room, 0, 0, SCRIBE_R)).toBe(0);
  });

  it('arcCovered follows the graver round from its start, either way', () => {
    expect(arcCovered(0, 1, 0, 0)).toBe(false);
    expect(arcCovered(0, 1, 0.25, 0.1)).toBe(true);
    expect(arcCovered(0, 1, 0.25, Math.PI / 2 - 0.05)).toBe(true);
    expect(arcCovered(0, 1, 0.25, Math.PI)).toBe(false);
    expect(arcCovered(0, 1, 0.25, -0.5)).toBe(false);
    expect(arcCovered(0, -1, 0.25, -0.5)).toBe(true);
    expect(arcCovered(0, -1, 0.25, 0.5)).toBe(false);
    // the tip's own width reaches a little ahead (and behind the start)
    expect(arcCovered(0, 1, 0.25, Math.PI / 2 + 0.08, 0.1)).toBe(true);
    expect(arcCovered(0, 1, 0.25, -0.05, 0.1)).toBe(true);
    for (let a = -3; a <= 3; a += 0.5) expect(arcCovered(1, 1, 1, a)).toBe(true);
    // wraps across ±π
    expect(arcCovered(3, 1, 0.1, -3.1)).toBe(true);
  });

  it('pickStep walks toward the goal, lands on floor inside the room, and gives up when boxed in', () => {
    const room = openRoom();
    // feet side by side (needle left, graver right), goal far right
    let ax = 100, ay = 100, bx = 126, by = 100;
    const gx = 280, gy = 100;
    let prefer: 0 | 1 = 0;
    let mid = (ax + bx) / 2;
    for (let i = 0; i < 6; i++) {
      const s: StepPick = pickStep(room, ax, ay, bx, by, prefer, gx, gy, 7)!;
      expect(s).toBeTruthy();
      const px = s.pivot === 0 ? ax : bx;
      const py = s.pivot === 0 ? ay : by;
      const sx = s.pivot === 0 ? bx : ax;
      const sy = s.pivot === 0 ? by : ay;
      const a = Math.atan2(sy - py, sx - px) + s.phi;
      const nx = px + Math.cos(a) * STEP_SPAN;
      const ny = py + Math.sin(a) * STEP_SPAN;
      if (s.pivot === 0) { bx = nx; by = ny; } else { ax = nx; ay = ny; }
      const m2 = (ax + bx) / 2;
      expect(m2).toBeGreaterThan(mid);
      mid = m2;
      // the span never changes as it walks
      expect(Math.hypot(bx - ax, by - ay)).toBeCloseTo(STEP_SPAN, 6);
      expect(room.boxBlocked(nx, ny, 1)).toBe(false);
      prefer = s.pivot === 0 ? 1 : 0;
    }
    // end over end: with nothing to choose between them it plants the requested foot
    expect(pickStep(room, 100, 100, 126, 100, 1, 113, 0, 7)!.pivot).toBe(1);
    expect(pickStep(room, 100, 100, 126, 100, 0, 113, 0, 7)!.pivot).toBe(0);
    // boxed in: rocks all round the body leave no landing spot
    const boxed = openRoom(32, 32, 272, 144, [{ x: 60, y: 60, w: 120, h: 30 }, { x: 60, y: 110, w: 120, h: 30 }, { x: 60, y: 90, w: 36, h: 20 }, { x: 144, y: 90, w: 36, h: 20 }]);
    expect(pickStep(boxed, 107, 100, 133, 100, 0, 280, 100, 7)).toBeNull();
    // stances hugging the walls: the swung foot always lands on floor inside the room
    const rng = new RNG('f7x-walls');
    for (let i = 0; i < 400; i++) {
      const x = 32 + 8 + rng.next() * 256;
      const y = 32 + 8 + rng.next() * 128;
      const a = rng.angle();
      const ax2 = x - Math.cos(a) * 13, ay2 = y - Math.sin(a) * 13;
      const bx2 = x + Math.cos(a) * 13, by2 = y + Math.sin(a) * 13;
      const prefer: 0 | 1 = rng.chance(0.5) ? 1 : 0;
      const pick: StepPick | null = pickStep(room, ax2, ay2, bx2, by2, prefer, rng.range(0, 340), rng.range(0, 210), 7);
      if (!pick) continue;
      const px = pick.pivot === 0 ? ax2 : bx2;
      const py = pick.pivot === 0 ? ay2 : by2;
      const a1 = Math.atan2((pick.pivot === 0 ? by2 : ay2) - py, (pick.pivot === 0 ? bx2 : ax2) - px) + pick.phi;
      const nx = px + Math.cos(a1) * STEP_SPAN;
      const ny = py + Math.sin(a1) * STEP_SPAN;
      expect(nx).toBeGreaterThanOrEqual(34);
      expect(nx).toBeLessThanOrEqual(302);
      expect(ny).toBeGreaterThanOrEqual(34);
      expect(ny).toBeLessThanOrEqual(174);
      expect(room.isFree((px + nx) / 2, (py + ny) / 2, 7)).toBe(true);
    }
  });

  it('stepGoal: straight in when the graver is ready, otherwise keeps its distance on its own side', () => {
    expect(stepGoal(10, 20, 100, 100, true)).toEqual({ x: 100, y: 100 });
    const g = stepGoal(0, 100, 100, 100, false);
    expect(g.x).toBeCloseTo(100 - KEEP_OFF, 6);
    expect(g.y).toBeCloseTo(100, 6);
    const g2 = stepGoal(100, 100, 100, 100, false);
    expect(Math.hypot(g2.x - 100, g2.y - 100)).toBeCloseTo(KEEP_OFF, 6);
  });
});

// ---------------------------------------------------------------- fake world (as tests/enemies-new-f7.test.ts)
interface FakePlayer {
  x: number; y: number; vx: number; vy: number; r: number; z: number; alive: boolean; aim: number;
  kbx: number; kby: number; lastAttackAt: number; statuses: Map<string, unknown>; hurts: number; damage: number[];
  knocks: { x: number; y: number }[]; iframes: number;
  hurt(w: World, n: number): boolean; knock(x: number, y: number, s: number): void; hasStatus(k: string): boolean; applyStatus(s: { kind: string }): boolean;
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
    statuses: new Map(), hurts: 0, damage: [], knocks: [], iframes: 0,
    // like Player.hurt: a hit grants a short invulnerability
    hurt(_w: World, n: number) {
      if (player.iframes > 0) return false;
      player.hurts++;
      player.damage.push(n);
      player.iframes = 0.6;
      return true;
    },
    knock(x: number, y: number) { player.knocks.push({ x, y }); },
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
    floor: { index: FLOOR, hpMult: 1, enemySpeed: 1 },
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

function step(fw: FakeWorld, seconds: number, onFrame?: (t: number) => void, strafe = false): void {
  const w = fw.w as unknown as { time: number; roomTime: number; dt: number; enemies: Enemy[]; projectiles: Projectile[] };
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) {
    w.time += w.dt;
    w.roomTime += w.dt;
    if (fw.player.iframes > 0) fw.player.iframes -= w.dt;
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

const lines = (fw: FakeWorld) => fw.entities.filter((x): x is ScribeLine => x instanceof ScribeLine);
const warnings = (fw: FakeWorld) => fw.entities.filter((x): x is ScribeWarning => x instanceof ScribeWarning);
/** Run until the compass starts its first scribe (its band warning appears). */
function untilWarning(fw: FakeWorld, max = 12): ScribeWarning {
  let warn: ScribeWarning | undefined;
  for (let i = 0; i < max * 60 && !warn; i++) step(fw, 1 / 60, () => { warn = warnings(fw)[0]; });
  expect(warn, 'band warning').toBeTruthy();
  return warn!;
}

describe('걸음쇠: headless AI', () => {
  it('runs 20 s against a strafing keeper without errors, feet and body inside the room, scribing several circles', () => {
    for (const champion of [false, true]) {
      const fw = fakeWorld(`f7x-sim-${champion}`);
      const e = fw.w.spawnEnemy(ID, 110, 80)!;
      e.champion = champion;
      let maxLines = 0;
      step(fw, 20, () => {
        const m = e.mem;
        for (const [x, y] of [[e.x, e.y], [m.ax, m.ay], [m.bx, m.by]]) {
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          expect(x).toBeGreaterThanOrEqual(IX);
          expect(y).toBeGreaterThanOrEqual(IY);
          expect(x).toBeLessThanOrEqual(IX + IW);
          expect(y).toBeLessThanOrEqual(IY + IH);
        }
        maxLines = Math.max(maxLines, lines(fw).length);
      }, true);
      expect(e.mem.steps, `champion ${champion}`).toBeGreaterThan(6);
      expect(e.mem.scribes, `champion ${champion}`).toBeGreaterThanOrEqual(2);
      // one fence at a time
      expect(maxLines).toBe(1);
      // it never shoots
      expect(fw.entities.some((x) => x instanceof Projectile)).toBe(false);
    }
  });

  it('walks end over end toward a distant keeper, never faster than the keeper while it can touch', () => {
    const fw = fakeWorld('f7x-walk');
    fw.player.x = 280;
    fw.player.y = 104;
    const e = fw.w.spawnEnemy(ID, 70, 104)!;
    const d0 = Math.hypot(fw.player.x - e.x, fw.player.y - e.y);
    let px = e.x;
    let py = e.y;
    let maxHarmful = 0;
    let swings = 0;
    let lastSwing = -1;
    step(fw, 4, () => {
      const v = Math.hypot(e.x - px, e.y - py) * 60;
      if (e.harmful && e.mem.ctl) maxHarmful = Math.max(maxHarmful, v);
      px = e.x;
      py = e.y;
      if (e.mem.swing !== lastSwing && e.mem.swing >= 0) swings++;
      lastSwing = e.mem.swing;
      // the feet stay a step apart while it walks
      if (e.mem.swing >= 0) expect(Math.hypot(e.mem.bx - e.mem.ax, e.mem.by - e.mem.ay)).toBeCloseTo(STEP_SPAN, 3);
    });
    expect(Math.hypot(fw.player.x - e.x, fw.player.y - e.y)).toBeLessThan(d0 - 60);
    expect(swings).toBeGreaterThanOrEqual(4);
    expect(maxHarmful).toBeGreaterThan(30);
    expect(maxHarmful).toBeLessThan(KEEPER_SPEED);
  });

  it('warns the band before it cuts: a ring of the right size and start, ≥ 0.3 s ahead, with the wind-up pose', () => {
    for (const champion of [false, true]) {
      const fw = fakeWorld(`f7x-warn-${champion}`);
      fw.player.x = 168;
      fw.player.y = 104;
      const e = fw.w.spawnEnemy(ID, 140, 104)!;
      e.champion = champion;
      const warn = untilWarning(fw);
      const t0 = (fw.w as unknown as { time: number }).time;
      expect(warn.time).toBeCloseTo(champion ? 0.5 : SCRIBE_TELE, 6);
      expect(warn.time).toBeGreaterThanOrEqual(0.3);
      expect(warn.radius).toBe(champion ? SCRIBE_R_CHAMP : SCRIBE_R);
      expect(e.telegraphT).toBeGreaterThan(0.3);
      expect(e.anim).toBe('ckcomp_wind');
      // centred on the planted needle
      expect(warn.x).toBeCloseTo(e.mem.ax, 6);
      expect(warn.y).toBeCloseTo(e.mem.ay, 6);
      let lineAt = -1;
      let line: ScribeLine | undefined;
      step(fw, 1.5, (t) => {
        const l = lines(fw)[0];
        if (l && l.progress > 0 && lineAt < 0) {
          lineAt = t;
          line = l;
        }
      });
      expect(line).toBeTruthy();
      expect(lineAt - t0).toBeGreaterThanOrEqual(warn.time - 1 / 60 - 1e-9);
      // the line is the circle that was shown
      expect(line!.x).toBe(warn.x);
      expect(line!.y).toBe(warn.y);
      expect(line!.R).toBe(warn.radius);
      expect(line!.a0).toBe(warn.a0);
      expect(line!.dir).toBe(warn.dir);
      // the graver bites on the far side of the keeper
      const ka = Math.atan2(fw.player.y - warn.y, fw.player.x - warn.x);
      expect(Math.abs(Math.cos(line!.a0 - ka) + 1)).toBeLessThan(0.05);
    }
  });

  it('the cut burns a keeper standing on the band once, at base strength (1), and throws them back to their side', () => {
    const fw = fakeWorld('f7x-cut');
    fw.player.x = 168;
    fw.player.y = 104;
    fw.w.spawnEnemy(ID, 140, 104);
    const warn = untilWarning(fw);
    // the keeper stands on the band, a quarter turn from where the graver starts
    const a = warn.a0 + warn.dir * (Math.PI / 2);
    fw.player.x = warn.x + Math.cos(a) * warn.radius;
    fw.player.y = warn.y + Math.sin(a) * warn.radius;
    let hurtAt = -1;
    const t0 = (fw.w as unknown as { time: number }).time;
    // (the fake keeper is not moved by the knock: stop once the cut has passed)
    step(fw, warn.time + SCRIBE_DRAW * 0.5, (t) => {
      if (hurtAt < 0 && fw.player.hurts > 0) hurtAt = t;
    });
    expect(fw.player.hurts).toBe(1);
    expect(fw.player.damage).toEqual([1]);
    // only once the graver came round (after the warning, about a quarter of the way)
    expect(hurtAt - t0).toBeGreaterThan(warn.time + SCRIBE_DRAW * 0.15);
    expect(hurtAt - t0).toBeLessThan(warn.time + SCRIBE_DRAW * 0.4);
    // thrown back outward or inward, along the radius
    const k = fw.player.knocks[0];
    expect(Math.abs(k.x * Math.cos(a) + k.y * Math.sin(a))).toBeGreaterThan(0.95);
  });

  it('a keeper who stepped inside is penned in safely; the fence holds, burns a crossing, then goes out', () => {
    const fw = fakeWorld('f7x-pen');
    fw.player.x = 168;
    fw.player.y = 104;
    const e = fw.w.spawnEnemy(ID, 140, 104)!;
    const warn = untilWarning(fw);
    const cx = warn.x;
    const cy = warn.y;
    const R = warn.radius;
    // stand inside, away from the needle and from the compass's body
    const ka = warn.a0 + Math.PI;
    const inside = { x: cx + Math.cos(ka) * R * 0.55, y: cy + Math.sin(ka) * R * 0.55 };
    fw.player.x = inside.x;
    fw.player.y = inside.y;
    step(fw, warn.time + SCRIBE_DRAW + 0.05);
    const line = lines(fw)[0];
    expect(line.complete).toBe(true);
    expect(fw.player.hurts).toBe(0);
    // resting on its needle: not harmful
    expect(e.harmful).toBe(false);
    expect(e.anim).toBe('ckcomp_rest');
    // wait inside: nothing burns
    step(fw, 0.5);
    expect(fw.player.hurts).toBe(0);
    // walk out across the line: it burns and throws the keeper back in
    fw.player.x = cx + Math.cos(ka) * (R - 2);
    fw.player.y = cy + Math.sin(ka) * (R - 2);
    fw.player.vx = Math.cos(ka) * KEEPER_SPEED;
    fw.player.vy = Math.sin(ka) * KEEPER_SPEED;
    step(fw, 1 / 60);
    expect(fw.player.hurts).toBe(1);
    const k = fw.player.knocks[0];
    expect(k.x * Math.cos(ka) + k.y * Math.sin(ka)).toBeLessThan(-0.95);
    // ... and it goes out by itself after its hold
    fw.player.x = inside.x;
    fw.player.y = inside.y;
    const held = line.held;
    step(fw, FENCE_HOLD - held + FENCE_FADE + 0.1);
    expect(line.dead).toBe(true);
    expect(lines(fw).length).toBe(0);
  });

  it('killing it snuffs its line at once; it leaves nothing behind but a cosmetic wreck', () => {
    const fw = fakeWorld('f7x-kill');
    fw.player.x = 168;
    fw.player.y = 104;
    const e = fw.w.spawnEnemy(ID, 140, 104)!;
    const warn = untilWarning(fw);
    // the keeper waits at the needle, well inside
    fw.player.x = warn.x;
    fw.player.y = warn.y + 3;
    step(fw, warn.time + SCRIBE_DRAW * 0.5);
    const line = lines(fw)[0];
    expect(line.burning).toBe(true);
    expect(fw.player.hurts).toBe(0);
    e.takeHit(fw.w, { damage: 999, kind: 'projectile', dirX: 1, dirY: 0 });
    step(fw, 1 / 60);
    expect(e.dead).toBe(true);
    // stops burning straight away: a keeper on the cut part is safe
    fw.player.x = line.x + Math.cos(line.a0) * line.R;
    fw.player.y = line.y + Math.sin(line.a0) * line.R;
    expect(line.burning).toBe(false);
    step(fw, FENCE_FADE + 0.2);
    expect(fw.player.hurts).toBe(0);
    expect(line.dead).toBe(true);
    // nothing of gameplay left: no line, no warning, no shots, no enemy
    const left = fw.entities.filter((x) => !(x.constructor as typeof Entity).cosmetic);
    expect(left.length).toBe(0);
    expect(fw.entities.every((x) => x instanceof CompassWreck)).toBe(true);
    // the wreck is purely visual and goes too
    step(fw, 1.5);
    expect(fw.entities.length).toBe(0);
    // a fresh one dies to plain damage before ever cutting
    const f2 = fakeWorld('f7x-die');
    const e2 = f2.w.spawnEnemy(ID, 120, 70)!;
    step(f2, 0.5);
    e2.takeHit(f2.w, { damage: 999, kind: 'explosion' });
    step(f2, 1.5);
    expect(e2.dead).toBe(true);
    expect(f2.entities.length).toBe(0);
  });

  it('a bullet-clear blows the line out; a frozen compass never leaves a half line burning for long', () => {
    const fw = fakeWorld('f7x-clear');
    fw.player.x = 168;
    fw.player.y = 104;
    fw.w.spawnEnemy(ID, 140, 104);
    const warn = untilWarning(fw);
    step(fw, warn.time + SCRIBE_DRAW * 0.5);
    const line = lines(fw)[0];
    expect(line.enemyHazard).toBe(true);
    line.onCleared(fw.w);
    expect(line.burning).toBe(false);
    step(fw, FENCE_FADE + 0.1);
    expect(line.dead).toBe(true);
    // frozen mid-cut: the half line goes out on its own
    const f2 = fakeWorld('f7x-freeze');
    f2.player.x = 168;
    f2.player.y = 104;
    const e2 = f2.w.spawnEnemy(ID, 140, 104)!;
    const w2 = untilWarning(f2);
    step(f2, w2.time + SCRIBE_DRAW * 0.3);
    e2.applyStatus({ kind: 'freeze', duration: 20 }, () => 0);
    const l2 = lines(f2)[0];
    expect(l2.complete).toBe(false);
    f2.player.x = 40;
    f2.player.y = 40;
    step(f2, 9);
    expect(l2.dead).toBe(true);
  });

  it('carried off its feet mid-move (fear) it stands down where it was left: no snap back, no half line left burning', () => {
    for (const phase of ['step', 'cut'] as const) {
      const fw = fakeWorld(`f7x-fear-${phase}`);
      fw.player.x = 168;
      fw.player.y = 104;
      const e = fw.w.spawnEnemy(ID, 120, 104)!;
      let ready = false;
      for (let i = 0; i < 900 && !ready; i++) {
        step(fw, 1 / 60);
        ready = phase === 'step' ? e.mem.swing >= 0 && e.anim === 'ckcomp_step' && e.mem.lift > 4 : lines(fw).some((l) => l.progress > 0.3);
      }
      expect(ready, phase).toBe(true);
      e.applyStatus({ kind: 'fear', duration: 0.8 }, () => 0);
      step(fw, 0.9);
      let px = e.x;
      let py = e.y;
      let maxJump = 0;
      step(fw, 1.5, () => {
        maxJump = Math.max(maxJump, Math.hypot(e.x - px, e.y - py));
        px = e.x;
        py = e.y;
      });
      expect(maxJump, phase).toBeLessThan(4);
      // the feet came with it
      expect(Math.hypot(e.x - (e.mem.ax + e.mem.bx) / 2, e.y - (e.mem.ay + e.mem.by) / 2)).toBeLessThan(0.01);
      if (phase === 'cut') expect(lines(fw).every((l) => !l.burning || l.complete)).toBe(true);
      expect(e.harmful || e.anim === 'ckcomp_scribe' || e.anim === 'ckcomp_rest').toBe(true);
    }
  });

  it('every telegraph it shows lasts ≥ 0.3 s, and it is never harmful while it cuts or rests', () => {
    const fw = fakeWorld('f7x-tele');
    const e = fw.w.spawnEnemy(ID, 100, 80)!;
    const seen = new Set<Entity>();
    step(fw, 16, () => {
      for (const g of fw.entities) {
        if (g instanceof GroundWarning && !seen.has(g)) {
          seen.add(g);
          expect(g.time).toBeGreaterThanOrEqual(0.3);
        }
      }
      if (e.anim === 'ckcomp_scribe' || e.anim === 'ckcomp_rest') expect(e.harmful).toBe(false);
    }, true);
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------- real World
/** A real World on floor 7 with the compass and two of the floor's own enemies around a god keeper. */
function arena(seed: string): World {
  const r = measureDps({ character: 'ria', weapon: 'lantern_bolt', seconds: 0, seed });
  const w = r.world;
  for (const e of r.dummies) w.killEnemy(e);
  const p = w.player;
  p.god = true;
  const bot = w.inputSource;
  w.inputSource = (ww, pp, o) => {
    bot(ww, pp, o);
    const c = ww.enemies.find((e) => e.def.id === ID);
    if (c) { o.cx = c.x; o.cy = c.y; }
    // hold fire for a while (let it walk and cut), then shoot it down (hit flashes, death, wreck)
    if (ww.time < 6) o.held = 0;
    // the keeper wanders a little (moves half a second, then holds a second) so the compass follows and cuts
    const moving = ww.time % 1.5 < 0.5;
    o.mx = moving ? Math.cos(ww.time * 0.7) : 0;
    o.my = moving ? Math.sin(ww.time * 0.7) : 0;
  };
  w.spawnEnemy(ID, p.x + 50, p.y - 10);
  w.spawnEnemy('cuckoo_clock', p.x - 70, p.y - 30);
  w.spawnEnemy('porcelain_doll', p.x + 60, p.y + 30);
  return w;
}

describe('걸음쇠 on the real World', () => {
  it('drawing never changes the simulation (walking, cutting, fence up, shot down)', () => {
    const w = arena('f7x-draw');
    let cut = false;
    let wreck = false;
    for (let i = 0; i < 720; i++) {
      w.update(FIXED_DT);
      if (w.entities.some((x) => x instanceof ScribeLine && x.progress > 0)) cut = true;
      if (w.entities.some((x) => x instanceof CompassWreck)) wreck = true;
      const before = stateHash(w);
      w.draw(1);
      expect(stateHash(w), `step ${i}`).toBe(before);
    }
    expect(cut).toBe(true);
    expect(wreck).toBe(true);
    expect(w.enemies.some((e) => e.def.id === ID)).toBe(false);
    // its line went out with it
    expect(w.entities.some((x) => x instanceof ScribeLine && x.burning)).toBe(false);
  });

  it('the simulation does not depend on the cosmetic RNG', () => {
    const run = (fxSeed: number): number[] => {
      fx.setState(new RNG(fxSeed).getState());
      const w = arena('f7x-det');
      const out: number[] = [];
      for (let i = 0; i < 480; i++) {
        w.update(FIXED_DT);
        if (i % 3 === 0) w.draw(1);
        out.push(stateHash(w));
      }
      return out;
    };
    expect(run(0x9e3779b9)).toEqual(run(1));
  });

  it('a full circle is TAU of arc: the line covers every angle once complete', () => {
    const w = arena('f7x-circle');
    let done: ScribeLine | undefined;
    for (let i = 0; i < 900 && !done; i++) {
      w.update(FIXED_DT);
      done = w.entities.find((x): x is ScribeLine => x instanceof ScribeLine && x.complete);
    }
    expect(done).toBeTruthy();
    for (let a = 0; a < TAU; a += 0.3) expect(arcCovered(done!.a0, done!.dir, done!.progress, a)).toBe(true);
    // the floor mask leaves the line off rocks and walls only
    expect(done!.mask.some((v) => v === 1)).toBe(true);
  });
});
