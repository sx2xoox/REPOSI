// New basic enemies (f12): 종지기 해골 + 해골 석궁수 (floor 1, crypt-toll.ts) and
// 혀날름 두꺼비 + 공벌레 (floor 2, caves-marsh.ts). Definitions and art, a headless
// 12 s run of every script, a focused test of each signature mechanic and draw purity.

import './headless';
import { describe, expect, it } from 'vitest';
import { measureDps } from './dpsharness';
import { Enemies, Floors } from '../src/game/defs';
import { Enemy } from '../src/game/enemy';
import { Entity } from '../src/game/entity';
import { GroundWarning } from '../src/game/effects';
import { Projectile } from '../src/game/projectile';
import { getAnim, hasAnim, hasSprite, listSprites } from '../src/engine/sprites';
import { RNG } from '../src/engine/rng';
import { FIXED_DT } from '../src/game/constants';
import { stateHash } from '../src/game/statehash';
import type { World } from '../src/game/world';
import {
  ARCHER_BOLT_SPEED, ARCHER_LOCK, ARCHER_TRACK, BellToll, EnemyOverlay, TOLL_BAND, TOLL_REACH, TOLL_START, TOLL_TIME, TollReach,
} from '../src/content/enemies/crypt-toll';
import {
  CURL_TAKEN, DIZZY_TAKEN, ROLL_SPEED, TONGUE_MIN, TONGUE_REACH, YANK_PX, tongueTouches, yankSpeed,
} from '../src/content/enemies/caves-marsh';

/** id -> its single floor */
const NEW: Record<string, number> = { bell_ringer: 1, bone_archer: 1, tongue_toad: 2, pill_beetle: 2 };
const IDS = Object.keys(NEW);

function spriteDefined(name: string): boolean {
  if (hasAnim(name)) {
    const a = getAnim(name)!;
    return a.frames.length > 0 && a.frames.every((f) => hasSprite(f));
  }
  return hasSprite(name);
}

// ---------------------------------------------------------------- definitions
describe('f12 enemy definitions', () => {
  it('are basic, single-floor, Korean-named and within the balance guide', () => {
    for (const [id, floor] of Object.entries(NEW)) {
      const d = Enemies.must(id);
      const f = Floors.all().find((x) => x.index === floor)!;
      expect(d.name, id).toMatch(/^[가-힣 ]+$/);
      expect(d.floors, id).toEqual([floor]);
      expect(d.boss, id).toBeFalsy();
      expect(d.hp, id).toBeGreaterThanOrEqual(12);
      expect(d.hp, id).toBeLessThanOrEqual(45);
      expect(d.cost ?? 1, id).toBeGreaterThanOrEqual(0.7);
      expect(d.cost ?? 1, id).toBeLessThanOrEqual(2);
      expect(d.weight ?? 1, id).toBeGreaterThanOrEqual(0.8);
      expect(d.weight ?? 1, id).toBeLessThanOrEqual(1.1);
      expect(d.speed ?? 40, id).toBeLessThan(84);
      expect((d.speed ?? 40) * (f.enemySpeed ?? 1), id).toBeLessThan(92);
      expect(d.contactDamage ?? 1, id).toBeLessThanOrEqual(1);
      expect(d.radius, id).toBeGreaterThanOrEqual(5);
      expect(d.light, id).toBeDefined();
      expect(d.light!.radius, id).toBeGreaterThan(0);
      expect(d.champion, id).toBe(true);
      expect(d.deathFx, id).toBeDefined();
      expect(d.bloodColor, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(d.script, id).toBeTypeOf('function');
      expect(spriteDefined(d.sprite), `${id} sprite`).toBe(true);
    }
  });

  it('every enemy has a hurt frame and at least three animated states; referenced sprites exist', () => {
    const all = listSprites();
    for (const id of IDS) {
      const prefix = Enemies.must(id).sprite.split('_')[0];
      const anims = new Set(all.filter((n) => n.startsWith(prefix + '_') && hasAnim(n.replace(/_\d+$/, ''))).map((n) => n.replace(/_\d+$/, '')));
      const states = [...anims].map((a) => a.split('_')[1]);
      expect(states, id).toContain('hurt');
      expect(states.length, `${id} states ${states}`).toBeGreaterThanOrEqual(4);
      const moving = [...anims].filter((a) => getAnim(a)!.frames.length >= 2);
      expect(moving.length, `${id} animated states`).toBeGreaterThanOrEqual(3);
    }
    const sources = import.meta.glob(['../src/content/enemies/crypt-toll.ts', '../src/content/enemies/caves-marsh.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const names = new Set<string>();
    for (const src of Object.values(sources)) {
      for (const m of src.matchAll(/setAnim\('([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/sprite: '([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/hurtFrame\(e, w, '([a-z0-9_]+)'/g)) names.add(m[1]);
    }
    expect(names.size).toBeGreaterThan(15);
    for (const n of names) expect(spriteDefined(n), n).toBe(true);
  });
});

// ---------------------------------------------------------------- fake world
interface FakePlayer {
  x: number; y: number; vx: number; vy: number; r: number; z: number; alive: boolean; slot: number; dashing: boolean;
  kbx: number; kby: number; invuln: number; statuses: Map<string, unknown>; hurts: number; hurtLog: { t: number; src: string }[];
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

function fakeWorld(seed: string, floor: number): FakeWorld {
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
    hurt(_w: unknown, _n: number, src = '') {
      if (player.dashing || player.invuln > 0) return false;
      player.hurts++;
      player.hurtLog.push({ t: (fw.w as unknown as { time: number }).time, src });
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
    floor: { index: floor, hpMult: 1, enemySpeed: 1 },
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

/** Danger right now: enemy shots / hazards, the toad's tongue, the bug's roll. */
function danger(fw: FakeWorld): boolean {
  for (const x of fw.entities) {
    if (x instanceof GroundWarning || (x.constructor as typeof Entity).cosmetic) continue;
    if (x instanceof Enemy) {
      if (x.mem.tOn || x.mem.rolling) return true;
      continue;
    }
    if (x.team === 'enemy' || x.enemyHazard) return true;
  }
  return false;
}

function telegraphing(fw: FakeWorld): boolean {
  return fw.entities.some((x) => x instanceof GroundWarning || (x instanceof Enemy && x.telegraphT > 0));
}

// ---------------------------------------------------------------- headless AI
describe('f12 enemy AI (headless simulation)', () => {
  for (const id of IDS) {
    it(`${id} runs 12 s without errors, stays in the room and can die`, () => {
      const fw = fakeWorld(`f12-${id}`, NEW[id]);
      const e = fw.w.spawnEnemy(id, 120, 70)!;
      expect(e).toBeTruthy();
      step(fw, 12, () => {
        for (const o of fw.w.enemies) {
          expect(Number.isFinite(o.x) && Number.isFinite(o.y), `${id} position`).toBe(true);
          expect(o.x).toBeGreaterThanOrEqual(IX - 1);
          expect(o.y).toBeGreaterThanOrEqual(IY - 1);
          expect(o.x).toBeLessThanOrEqual(IX + IW + 1);
          expect(o.y).toBeLessThanOrEqual(IY + IH + 1);
        }
      }, strafe(fw));
      expect(e.alive).toBe(true);
      fw.w.killEnemy(e);
      expect(e.dead).toBe(true);
      step(fw, 1.5);
      // its overlay (if any) and warnings go away with it
      expect(fw.entities.some((x) => x instanceof EnemyOverlay)).toBe(false);
      expect(fw.entities.some((x) => x instanceof TollReach)).toBe(false);
    });

    it(`${id} creates danger within 12 s, always telegraphed first`, () => {
      for (const seed of ['a', 'b', 'c']) {
        const fw = fakeWorld(`f12-danger-${id}-${seed}`, NEW[id]);
        fw.w.spawnEnemy(id, 120, 70);
        let tTele = -1;
        let tDanger = -1;
        let tHurt = -1;
        step(fw, 12, (t) => {
          if (tTele < 0 && telegraphing(fw)) tTele = t;
          if (tDanger < 0 && danger(fw)) tDanger = t;
          if (tHurt < 0 && fw.player.hurts > 0) tHurt = t;
        }, strafe(fw));
        expect(tDanger, `${id} danger`).toBeGreaterThan(0);
        expect(tTele, `${id} telegraph`).toBeGreaterThan(0);
        expect(tDanger - tTele, `${id}: warned ${tDanger - tTele}s ahead`).toBeGreaterThanOrEqual(0.3);
        if (tHurt > 0) expect(tHurt).toBeGreaterThan(tTele);
      }
    });
  }
});

// ---------------------------------------------------------------- signature mechanics
describe('종지기 해골: the toll only hurts on its band', () => {
  const ringAt = (dist: number, opts: Partial<FakePlayer> = {}) => {
    const fw = fakeWorld('toll', 1);
    Object.assign(fw.player, { x: 100 + dist, y: 100 }, opts);
    const ring = fw.w.spawn(new BellToll(100, 100, '종지기 해골'));
    const radii: number[] = [];
    const hurtAt: number[] = [];
    let last = fw.player.hurts;
    step(fw, TOLL_TIME + 0.3, () => {
      radii.push(ring.mem.rad);
      if (fw.player.hurts > last) hurtAt.push(ring.mem.rad);
      last = fw.player.hurts;
    });
    return { fw, ring, radii, hurtAt };
  };

  it('grows from its start radius to its reach in about TOLL_TIME, then ends', () => {
    const { ring, radii } = ringAt(500);
    expect(radii[0]).toBeGreaterThan(TOLL_START);
    expect(radii[0]).toBeLessThan(TOLL_START + 4);
    const reached = radii.findIndex((r) => r >= TOLL_REACH);
    expect(reached * FIXED_DT).toBeGreaterThan(TOLL_TIME - 0.05);
    expect(reached * FIXED_DT).toBeLessThan(TOLL_TIME + 0.05);
    expect(ring.dead).toBe(true);
  });

  it('hurts exactly once, while the band passes over the keeper', () => {
    for (const d of [20, 45, 70, 95]) {
      const { fw, hurtAt } = ringAt(d);
      expect(fw.player.hurts, `at ${d}px`).toBe(1);
      expect(Math.abs(hurtAt[0] - d), `band at ${d}px`).toBeLessThanOrEqual(TOLL_BAND + 1.5);
    }
  });

  it('misses a keeper outside its reach, inside its start, dashing through or in the air', () => {
    expect(ringAt(TOLL_REACH + 12).fw.player.hurts).toBe(0);
    expect(ringAt(2).fw.player.hurts).toBe(0);
    expect(ringAt(60, { dashing: true }).fw.player.hurts).toBe(0);
    expect(ringAt(60, { z: 6 }).fw.player.hurts).toBe(0);
  });

  it('a keeper briefly invulnerable when the band arrives can still be caught on its trailing edge, never twice', () => {
    const { fw } = ringAt(60, { invuln: (60 - TOLL_START) / ((TOLL_REACH - TOLL_START) / TOLL_TIME) - 0.02 });
    expect(fw.player.hurts).toBeLessThanOrEqual(1);
  });

  it('the ringer shows its reach for 0.7 s, then tolls two rings 0.45 s apart (champion: three)', () => {
    for (const champ of [false, true]) {
      const fw = fakeWorld(`ringer-${champ}`, 1);
      const e = fw.w.spawnEnemy('bell_ringer', 100, 100)!;
      e.champion = champ;
      e.dormant = 0;
      fw.player.x = 180;
      fw.player.y = 100;
      let reachAt = -1;
      const rings: number[] = [];
      const seen = new Set<Entity>();
      step(fw, 4, (t) => {
        for (const x of fw.entities) {
          if (x instanceof TollReach && reachAt < 0) {
            reachAt = t;
            expect(x.radius).toBe(TOLL_REACH);
          }
          if (x instanceof BellToll && !seen.has(x)) {
            seen.add(x);
            rings.push(t);
          }
        }
      });
      expect(reachAt).toBeGreaterThan(0);
      const first = rings.filter((t) => t < reachAt + 2.5);
      expect(first.length).toBe(champ ? 3 : 2);
      expect(first[0] - reachAt).toBeGreaterThanOrEqual(0.68);
      expect(first[1] - first[0]).toBeCloseTo(0.45, 1);
      // the keeper stood 80 px away: each ring of this toll hurt once
      expect(fw.player.hurts).toBeGreaterThanOrEqual(first.length);
    }
  });
});

describe('해골 석궁수: tracking sightline, lock, one fast bolt along the locked line', () => {
  it('tracks the keeper, then locks; the bolt flies along the locked line at bolt speed', () => {
    const fw = fakeWorld('archer', 1);
    const e = fw.w.spawnEnemy('bone_archer', 80, 70)!;
    e.dormant = 0;
    fw.player.x = 200;
    fw.player.y = 120;
    let aimStart = -1;
    let lockStart = -1;
    let trackA0 = NaN;
    let trackA1 = NaN;
    let lockA = NaN;
    let shot: Projectile | null = null;
    let shotAt = -1;
    const all = new Map<Projectile, number>();
    step(fw, 6, (t) => {
      for (const pr of fw.w.projectiles) if (!all.has(pr)) all.set(pr, t);
      if (e.mem.aim === 1 && aimStart < 0) {
        aimStart = t;
        trackA0 = e.mem.aimA;
      }
      if (e.mem.aim === 1) trackA1 = e.mem.aimA;
      if (e.mem.aim === 2 && lockStart < 0) {
        lockStart = t;
        lockA = e.mem.aimA;
        expect(e.telegraphT).toBeGreaterThan(0);
      }
      if (e.mem.aim === 2) expect(e.mem.aimA).toBe(lockA);
      if (!shot && fw.w.projectiles.length) {
        shot = fw.w.projectiles[0];
        shotAt = t;
      }
    }, (t) => {
      // the keeper walks sideways while being tracked, then keeps walking during the lock
      if (aimStart > 0 && !shot) fw.player.y = 120 + Math.min(40, (t - aimStart) * 30);
    });
    expect(aimStart).toBeGreaterThan(0);
    // the line followed the keeper while tracking
    expect(Math.abs(trackA1 - trackA0)).toBeGreaterThan(0.1);
    expect(lockStart - aimStart).toBeCloseTo(ARCHER_TRACK, 1);
    expect(shot).not.toBeNull();
    expect(shotAt - lockStart).toBeCloseTo(ARCHER_LOCK, 1);
    const p = shot! as Projectile;
    expect(p.speed).toBe(ARCHER_BOLT_SPEED);
    expect(p.angle).toBe(lockA);
    expect(p.damage).toBe(1);
    // a regular archer looses a single bolt per volley
    expect([...all.values()].filter((t) => t < shotAt + 0.6).length).toBe(1);
  });

  it('a champion looses a second bolt along the same locked line', () => {
    const fw = fakeWorld('archer-champ', 1);
    const e = fw.w.spawnEnemy('bone_archer', 80, 70)!;
    e.dormant = 0;
    e.champion = true;
    fw.player.x = 200;
    fw.player.y = 120;
    const shots: { a: number; t: number }[] = [];
    const seen = new Set<Projectile>();
    step(fw, 4, (t) => {
      for (const p of fw.w.projectiles) if (!seen.has(p)) {
        seen.add(p);
        shots.push({ a: p.angle, t });
      }
    });
    expect(shots.length).toBeGreaterThanOrEqual(2);
    expect(shots[1].a).toBe(shots[0].a);
    expect(shots[1].t - shots[0].t).toBeCloseTo(0.25, 1);
  });

  it('backs off a keeper who comes close and keeps its distance', () => {
    const fw = fakeWorld('archer-space', 1);
    const e = fw.w.spawnEnemy('bone_archer', 168, 104)!;
    e.dormant = 0;
    fw.player.x = 200;
    fw.player.y = 104;
    step(fw, 2.5);
    expect(Math.hypot(e.x - fw.player.x, e.y - fw.player.y)).toBeGreaterThan(55);
  });
});

describe('혀날름 두꺼비: lane, lash, yank', () => {
  it('tongueTouches: on the lane within the swept part of the tip, not beside or beyond it', () => {
    expect(tongueTouches(0, 0, 0, 0, 60, 50, 2, 5)).toBe(true);
    expect(tongueTouches(0, 0, 0, 0, 60, 50, 9, 5)).toBe(false);
    expect(tongueTouches(0, 0, 0, 0, 40, 80, 0, 5)).toBe(false);
    expect(tongueTouches(0, 0, 0, 40, 80, 60, 0, 5)).toBe(true);
    expect(tongueTouches(0, 0, Math.PI / 2, 0, 60, 0, 50, 5)).toBe(true);
    expect(yankSpeed(YANK_PX) * 0.0919).toBeCloseTo(YANK_PX, 5);
  });

  it('only lashes at 40–115 px, behind a lane warning, and does not catch a dashing keeper', () => {
    for (const dashing of [false, true]) {
      const fw = fakeWorld(`toad-${dashing}`, 2);
      const e = fw.w.spawnEnemy('tongue_toad', 100, 100)!;
      e.dormant = 0;
      Object.assign(fw.player, { x: 180, y: 104, dashing });
      let laneAt = -1;
      let outAt = -1;
      let maxL = 0;
      step(fw, 3, (t) => {
        if (laneAt < 0 && fw.entities.some((x) => x instanceof GroundWarning && x.rw > 0)) laneAt = t;
        if (e.mem.tOn && outAt < 0) {
          outAt = t;
          const d = Math.hypot(fw.player.x - e.x, fw.player.y - e.y);
          expect(d).toBeGreaterThanOrEqual(TONGUE_MIN);
          expect(d).toBeLessThanOrEqual(TONGUE_REACH + 8);
        }
        if (e.mem.tOn) maxL = Math.max(maxL, e.mem.tL);
      });
      expect(laneAt).toBeGreaterThan(0);
      expect(outAt - laneAt).toBeGreaterThanOrEqual(0.5);
      expect(maxL).toBeGreaterThan(60);
      expect(maxL).toBeLessThanOrEqual(TONGUE_REACH);
      expect(fw.player.hurts).toBe(dashing ? 0 : 1);
    }
  });

  it('a hit hurts the real keeper and yanks them ~25–30 px toward the toad', () => {
    const { world: w, dummies } = measureDps({ character: 'ria', weapon: 'lantern_bolt', seconds: 0, dist: 60 });
    for (const d of dummies) w.killEnemy(d);
    w.inputSource = (_w, _p, o) => { o.mx = o.my = o.ax = o.ay = o.held = o.pressed = 0; };
    const p = w.player;
    p.god = false;
    p.invuln = 0;
    const toad = w.spawnEnemy('tongue_toad', p.x + 85, p.y)!;
    toad.dormant = 0;
    for (let i = 0; i < 2; i++) w.update(FIXED_DT);
    const hp0 = p.red + p.soul;
    let hitX = NaN;
    let hitY = NaN;
    for (let i = 0; i < 360 && Number.isNaN(hitX); i++) {
      w.update(FIXED_DT);
      if (p.red + p.soul < hp0) {
        hitX = p.x;
        hitY = p.y;
      }
    }
    expect(Number.isNaN(hitX)).toBe(false);
    expect(hp0 - (p.red + p.soul)).toBe(1);
    for (let i = 0; i < 45; i++) w.update(FIXED_DT);
    const toward = ((p.x - hitX) * (toad.x - hitX) + (p.y - hitY) * (toad.y - hitY)) / Math.hypot(toad.x - hitX, toad.y - hitY);
    expect(toward).toBeGreaterThan(20);
    expect(toward).toBeLessThan(36);
    // it stops short of the toad's body
    expect(Math.hypot(p.x - toad.x, p.y - toad.y)).toBeGreaterThan(toad.r + p.r - 2);
  });
});

describe('공벌레: armour, roll, dizzy', () => {
  it('takes 20% damage curled, 150% dizzy, full damage otherwise', () => {
    const fw = fakeWorld('bug-dmg', 2);
    const e = fw.w.spawnEnemy('pill_beetle', 100, 100)!;
    const hit = (dmg: number) => {
      const hp = e.hp;
      e.takeHit(fw.w, { damage: dmg, kind: 'projectile', dirX: 1, dirY: 0 });
      return hp - e.hp;
    };
    expect(hit(10)).toBeCloseTo(10, 6);
    e.mem.curled = 1;
    expect(hit(10)).toBeCloseTo(10 * CURL_TAKEN, 6);
    e.mem.curled = 0;
    e.mem.dizzy = 1;
    expect(hit(10)).toBeCloseTo(10 * DIZZY_TAKEN, 6);
  });

  it('three quick hits make it curl, show its lane, roll fast with at most one ricochet, then lie dizzy', () => {
    const fw = fakeWorld('bug-roll', 2);
    const e = fw.w.spawnEnemy('pill_beetle', 90, 104)!;
    e.dormant = 0;
    // keeper out of rolling sight (beyond 130 px) so only the hits can trigger it
    Object.assign(fw.player, { x: 250, y: 160 });
    step(fw, 0.4);
    expect(e.mem.curled).toBe(0);
    e.hp = 1000;
    for (let i = 0; i < 3; i++) {
      e.takeHit(fw.w, { damage: 1, kind: 'projectile', dirX: 1, dirY: 0 });
      step(fw, 0.3);
    }
    let curledAt = -1;
    let laneAt = -1;
    let rollStart = -1;
    let rollEnd = -1;
    let dizzyAt = -1;
    let maxSpeed = 0;
    let turns = 0;
    let lastDir = NaN;
    let px = e.x;
    let py = e.y;
    step(fw, 4, (t) => {
      if (e.mem.curled && curledAt < 0) curledAt = t;
      if (laneAt < 0 && fw.entities.some((x) => x instanceof GroundWarning && x.rw > 0)) laneAt = t;
      if (e.mem.rolling) {
        if (rollStart < 0) rollStart = t;
        const v = Math.hypot(e.x - px, e.y - py) / FIXED_DT;
        maxSpeed = Math.max(maxSpeed, v);
        if (v > 50) {
          const dir = Math.atan2(e.y - py, e.x - px);
          if (!Number.isNaN(lastDir) && Math.cos(dir - lastDir) < 0.5) turns++;
          lastDir = dir;
        }
      } else if (rollStart > 0 && rollEnd < 0) rollEnd = t;
      if (e.mem.dizzy && dizzyAt < 0) {
        dizzyAt = t;
        expect(e.harmful).toBe(false);
      }
      px = e.x;
      py = e.y;
    });
    expect(curledAt).toBeGreaterThan(0);
    expect(laneAt).toBeGreaterThan(0);
    expect(rollStart - laneAt).toBeGreaterThanOrEqual(0.54);
    expect(maxSpeed).toBeGreaterThan(ROLL_SPEED * 0.9);
    expect(maxSpeed).toBeLessThan(ROLL_SPEED * 1.15);
    expect(turns).toBeLessThanOrEqual(1);
    expect(rollEnd).toBeGreaterThan(rollStart);
    expect(dizzyAt).toBeGreaterThanOrEqual(rollEnd - FIXED_DT);
    // and back to crawling, harmful again
    step(fw, 1);
    expect(e.mem.dizzy).toBe(0);
    expect(e.harmful).toBe(true);
  });

  it('a clear line to the keeper within 130 px makes it roll at them', () => {
    const fw = fakeWorld('bug-sight', 2);
    const e = fw.w.spawnEnemy('pill_beetle', 80, 104)!;
    e.dormant = 0;
    Object.assign(fw.player, { x: 190, y: 104 });
    let rolledToward = false;
    step(fw, 4, () => {
      if (e.mem.rolling && e.x > 100) rolledToward = true;
    });
    expect(rolledToward).toBe(true);
  });
});

// ---------------------------------------------------------------- draw purity
describe('f12 enemies draw without touching the simulation', () => {
  it('stateHash is unchanged by w.draw over a few hundred steps with all four active', () => {
    const { world: w, dummies } = measureDps({ character: 'ria', weapon: 'lantern_bolt', seconds: 0, dist: 60 });
    for (const d of dummies) w.killEnemy(d);
    w.inputSource = (_w, _p, o) => { o.mx = o.my = o.ax = o.ay = o.held = o.pressed = 0; };
    const p = w.player;
    p.god = true;
    const spots: [string, number, number][] = [['bell_ringer', 70, -20], ['bone_archer', -90, -30], ['tongue_toad', 60, 30], ['pill_beetle', -70, 25]];
    for (const [id, dx, dy] of spots) {
      const e = w.spawnEnemy(id, p.x + dx, p.y + dy)!;
      e.dormant = 0;
      if (id === 'bone_archer') e.champion = true;
    }
    let drawnRing = false;
    let drawnLine = false;
    let drawnTongue = false;
    for (let i = 0; i < 420; i++) {
      w.update(FIXED_DT);
      for (const e of w.enemies) {
        if (e.def.id === 'bone_archer' && e.mem.aim) drawnLine = true;
        if (e.def.id === 'tongue_toad' && e.mem.tOn) drawnTongue = true;
      }
      if (w.entities.some((x) => x instanceof BellToll)) drawnRing = true;
      const before = stateHash(w);
      w.draw(1);
      expect(stateHash(w), `step ${i}`).toBe(before);
    }
    expect(drawnRing && drawnLine && drawnTongue).toBe(true);
  });
});
