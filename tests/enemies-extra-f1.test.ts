// Floor 1 extra enemy: 무덤 도굴꾼 (grave robber, crypt-extra.ts). Definition and art, the
// spawn pool, a headless 20 s run, telegraph timing, the jaw traps (arming, bite, dash /
// air / shots / bullet-clears / old age / the robber's death), the dirt fling, real-World
// damage at base strength and draw purity.

import './headless';
import { describe, expect, it } from 'vitest';
import { measureDps } from './dpsharness';
import { Enemies, Floors } from '../src/game/defs';
import { Enemy } from '../src/game/enemy';
import { Entity } from '../src/game/entity';
import { GroundWarning } from '../src/game/effects';
import { Projectile } from '../src/game/projectile';
import { Lob } from '../src/content/enemies/shared';
import { getAnim, hasAnim, hasSprite, listSprites } from '../src/engine/sprites';
import { RNG } from '../src/engine/rng';
import { FIXED_DT } from '../src/game/constants';
import { stateHash } from '../src/game/statehash';
import type { World } from '../src/game/world';
import {
  FLING_COUNT, FLING_NEAR, FLING_RANGE, FLING_WIND, GOLD, JawTrap, PLANT_TIME, ROBBER_H, ROBBER_NAME, ROBBER_POSES, ROBBER_W, TOSS_FLIGHT, TOSS_MAX,
  TOSS_MIN, TOSS_WIND, TRAP_ARM, TRAP_LIFE, TRAP_MAX, TRAP_SLOW, TRAP_TRIGGER, liveTraps, paintRobber,
} from '../src/content/enemies/crypt-extra';
import { PixelPainter } from '../src/engine/painter';
import { HELD, type PlayerInput } from '../src/game/seam';
import { fx } from '../src/engine/rng';

const ID = 'grave_robber';

function spriteDefined(name: string): boolean {
  if (hasAnim(name)) {
    const a = getAnim(name)!;
    return a.frames.length > 0 && a.frames.every((f) => hasSprite(f));
  }
  return hasSprite(name);
}

// ---------------------------------------------------------------- definition
describe('무덤 도굴꾼: definition', () => {
  it('is a Korean-named floor-1 regular within the balance guide', () => {
    const d = Enemies.must(ID);
    const f1 = Floors.all().find((x) => x.index === 1)!;
    expect(d.name).toBe(ROBBER_NAME);
    expect(d.name).toMatch(/^[가-힣 ]+$/);
    expect(d.floors).toEqual([1]);
    expect(d.boss).toBeFalsy();
    // regular: 25–45 HP in floor-1 units
    expect(d.hp).toBeGreaterThanOrEqual(25);
    expect(d.hp).toBeLessThanOrEqual(45);
    expect(d.contactDamage ?? 1).toBe(1);
    expect(d.radius).toBeGreaterThanOrEqual(5);
    // never outruns the keeper: its fastest move (scurry x1.25) as a speed champion (x1.35)
    expect((d.speed ?? 40) * 1.25 * 1.35 * (f1.enemySpeed ?? 1)).toBeLessThan(92);
    for (const f of Floors.all()) expect((d.speed ?? 40) * 1.25 * (f.enemySpeed ?? 1)).toBeLessThan(92);
    expect(d.light?.radius).toBeGreaterThan(0);
    expect(d.champion).toBe(true);
    expect(d.deathFx).toBeDefined();
    expect(d.bloodColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(d.script).toBeTypeOf('function');
    expect(spriteDefined(d.sprite)).toBe(true);
  });

  it('joins floor 1’s spawn pool only, with a weight and cost in line with the floor’s regulars', () => {
    const pool = (floor: number) => Enemies.all().filter((d) => !d.boss && d.floors?.includes(floor));
    const f1 = pool(1);
    expect(f1.map((d) => d.id)).toContain(ID);
    for (const f of Floors.all()) if (f.index !== 1) expect(pool(f.index).map((d) => d.id), `floor ${f.index}`).not.toContain(ID);
    const others = f1.filter((d) => d.id !== ID);
    expect(others.length).toBeGreaterThanOrEqual(8);
    const me = Enemies.must(ID);
    const ws = others.map((d) => d.weight ?? 1);
    const cs = others.map((d) => d.cost ?? 1);
    expect(me.weight ?? 1).toBeGreaterThanOrEqual(Math.min(...ws));
    expect(me.weight ?? 1).toBeLessThanOrEqual(Math.max(...ws));
    expect(me.weight ?? 1).toBeGreaterThanOrEqual(0.8);
    expect(me.weight ?? 1).toBeLessThanOrEqual(1.1);
    expect(me.cost ?? 1).toBeGreaterThanOrEqual(Math.min(...cs));
    expect(me.cost ?? 1).toBeLessThanOrEqual(Math.max(...cs));
    // a fair share of the floor's spawns: between 4% and 12% of the pool's weight
    const share = (me.weight ?? 1) / f1.reduce((a, d) => a + (d.weight ?? 1), 0);
    expect(share).toBeGreaterThan(0.04);
    expect(share).toBeLessThan(0.12);
  });

  it('has idle / move / attack / wind-up / hurt frames; every referenced sprite exists', () => {
    const anims = new Set(listSprites().filter((n) => n.startsWith('grobber_') && hasAnim(n.replace(/_\d+$/, ''))).map((n) => n.replace(/_\d+$/, '')));
    const states = [...anims].map((a) => a.split('_')[1]);
    for (const s of ['idle', 'walk', 'run', 'plant', 'wind', 'fling', 'hurt']) expect(states, s).toContain(s);
    const moving = [...anims].filter((a) => getAnim(a)!.frames.length >= 2);
    expect(moving.length).toBeGreaterThanOrEqual(5);
    const src = Object.values(import.meta.glob('../src/content/enemies/crypt-extra.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0];
    const names = new Set<string>();
    for (const m of src.matchAll(/setAnim\('([a-z0-9_]+)'/g)) names.add(m[1]);
    for (const m of src.matchAll(/sprite: '([a-z0-9_]+)'/g)) names.add(m[1]);
    for (const m of src.matchAll(/hurtFrame\(e, w, '([a-z0-9_]+)'/g)) names.add(m[1]);
    for (const m of src.matchAll(/'(grobber_trap_[a-z]+|grobber_chip)'/g)) names.add(m[1]);
    expect(names.size).toBeGreaterThanOrEqual(12);
    for (const n of names) expect(spriteDefined(n), n).toBe(true);
  });
});

// ---------------------------------------------------------------- fake world
interface FakePlayer {
  x: number; y: number; vx: number; vy: number; r: number; z: number; alive: boolean; slot: number; dashing: boolean;
  invuln: number; statuses: Map<string, { kind: string; power?: number }>; hurts: number; hurtLog: { t: number; n: number; src: string }[];
  hurt(w: unknown, n: number, src?: string): boolean; knock(): void; hasStatus(k: string): boolean; applyStatus(s: { kind: string }): boolean;
}
interface FakeWorld {
  w: World;
  entities: Entity[];
  player: FakePlayer;
  /** what `room.lineOfSight` answers (cover between the robber and the keeper when false) */
  los: boolean;
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
    lineOfSight: () => fw.los,
    tileAt: (tx: number, ty: number) => (inside(tx * 16 + 8, ty * 16 + 8, 0) ? 0 : 1),
    tileAtPx: (x: number, y: number) => (inside(x, y, 0) ? 0 : 1),
    destroyTile: () => {},
    damageTile: () => {},
    doors: [],
  };
  const fw = {} as FakeWorld;
  const player: FakePlayer = {
    x: IX + IW / 2, y: IY + IH - 30, vx: 0, vy: 0, r: 5, z: 0, alive: true, slot: 0, dashing: false, invuln: 0,
    statuses: new Map(), hurts: 0, hurtLog: [],
    hurt(_w: unknown, n: number, src = '') {
      if (player.dashing || player.invuln > 0) return false;
      player.hurts++;
      player.hurtLog.push({ t: (fw.w as unknown as { time: number }).time, n, src });
      player.invuln = 1;
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
    floor: { index: 1, hpMult: 1, enemySpeed: 1 },
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
  fw.los = true;
  return fw;
}

/** Step the fake world; `move` (when given) places the keeper each frame. */
function step(fw: FakeWorld, seconds: number, onFrame?: (t: number) => void, move?: (t: number) => void): void {
  const w = fw.w as unknown as { time: number; roomTime: number; dt: number; enemies: Enemy[]; projectiles: Projectile[] };
  const n = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < n; i++) {
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

/** The keeper wanders the room: sometimes far from the robber, sometimes on top of it. */
const strafe = (fw: FakeWorld) => (t: number) => {
  fw.player.x = 168 + Math.cos(t * 0.8) * 90;
  fw.player.y = 104 + Math.sin(t * 1.1) * 45;
};

const traps = (fw: FakeWorld) => fw.entities.filter((x): x is JawTrap => x instanceof JawTrap && !x.dead);
const shots = (fw: FakeWorld) => fw.entities.filter((x): x is Projectile => x instanceof Projectile && x.team === 'enemy' && !x.dead);
const lobs = (fw: FakeWorld) => fw.entities.filter((x): x is Lob => x instanceof Lob && !x.dead);
/** Gameplay leftovers of a robber: traps, thrown traps, enemy shots, warnings, any enemy hazard. */
const leftovers = (fw: FakeWorld) => fw.entities.filter((x) => !x.dead && !(x.constructor as typeof Entity).cosmetic
  && (x instanceof JawTrap || x instanceof Projectile || x instanceof Lob || x instanceof GroundWarning || x.enemyHazard));

// ---------------------------------------------------------------- headless AI
describe('무덤 도굴꾼: AI (headless 20 s)', () => {
  for (const seed of ['a', 'b', 'c']) {
    it(`seed ${seed}: plants traps, flings, keeps to the room, never exceeds its trap cap, dies cleanly`, () => {
      const fw = fakeWorld(`robber-${seed}`);
      const e = fw.w.spawnEnemy(ID, 120, 70)!;
      let maxTraps = 0;
      const seenTraps = new Set<Entity>();
      let flings = 0;
      const seenShots = new Set<Entity>();
      step(fw, 20, () => {
        expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
        expect(e.x).toBeGreaterThanOrEqual(IX - 1);
        expect(e.y).toBeGreaterThanOrEqual(IY - 1);
        expect(e.x).toBeLessThanOrEqual(IX + IW + 1);
        expect(e.y).toBeLessThanOrEqual(IY + IH + 1);
        const t = traps(fw);
        maxTraps = Math.max(maxTraps, t.length);
        for (const x of t) seenTraps.add(x);
        const s = shots(fw);
        if (s.some((x) => !seenShots.has(x))) flings++;
        for (const x of s) seenShots.add(x);
      }, strafe(fw));
      expect(e.alive).toBe(true);
      expect(seenTraps.size, 'traps set').toBeGreaterThanOrEqual(2);
      expect(maxTraps).toBeLessThanOrEqual(TRAP_MAX);
      expect(flings, 'flings').toBeGreaterThanOrEqual(1);
      expect(fw.player.hurts, 'it can hurt').toBeGreaterThan(0);
      // every hurt is at base strength and credited to the robber
      for (const h of fw.player.hurtLog) {
        expect(h.n).toBe(1);
        expect(h.src).toBe(ROBBER_NAME);
      }
      // dies cleanly: its traps snap at once, its last chips fly out, nothing stays behind
      fw.w.killEnemy(e);
      step(fw, FIXED_DT);
      expect(traps(fw).length).toBe(0);
      step(fw, 1.5);
      expect(leftovers(fw)).toEqual([]);
    });
  }

  it('every trap, thrown trap and fling comes at least 0.3 s after a telegraph of the robber', () => {
    for (const seed of ['t1', 't2', 't3', 't4']) {
      const fw = fakeWorld(`robber-tele-${seed}`);
      const e = fw.w.spawnEnemy(ID, 120, 70)!;
      let lastTele = -1;
      let prevT = 0;
      const seen = new Set<Entity>();
      let checked = 0;
      step(fw, 20, (t) => {
        if (e.telegraphT > prevT + 1e-9) lastTele = t - FIXED_DT;
        prevT = e.telegraphT;
        for (const x of [...traps(fw), ...shots(fw), ...lobs(fw)]) {
          if (seen.has(x)) continue;
          seen.add(x);
          checked++;
          expect(lastTele, `${seed}: hazard before any telegraph`).toBeGreaterThan(0);
          expect(t - lastTele, `${seed}: warned ${t - lastTele}s ahead`).toBeGreaterThanOrEqual(0.3);
        }
      }, strafe(fw));
      expect(checked).toBeGreaterThan(3);
    }
  });

  it('plants when chased: a crouch of PLANT_TIME, the trap in front of it toward the keeper, then it scurries off', () => {
    const fw = fakeWorld('robber-plant');
    const e = fw.w.spawnEnemy(ID, 200, 100)!;
    e.dormant = 0;
    let crouchAt = -1;
    let trapAt = -1;
    let trap: JawTrap | null = null;
    let robberAt = { x: 0, y: 0 };
    let chasing = true;
    // the keeper dogs it from the right at 64 px: too far for the fling, too close for a toss
    const follow = () => {
      if (!chasing) return;
      fw.player.x = e.x + 64;
      fw.player.y = e.y;
    };
    step(fw, 5, (t) => {
      if (crouchAt < 0 && e.anim === 'grobber_plant') crouchAt = t;
      if (!trap && traps(fw).length) {
        trap = traps(fw)[0];
        trapAt = t;
        robberAt = { x: e.x, y: e.y };
        chasing = false;
      }
    }, follow);
    expect(crouchAt).toBeGreaterThan(0);
    expect(trap).not.toBeNull();
    expect(trapAt - crouchAt).toBeGreaterThanOrEqual(PLANT_TIME - 0.02);
    const tr = trap! as JawTrap;
    expect(tr.owner).toBe(e);
    expect(Math.hypot(tr.x - robberAt.x, tr.y - robberAt.y)).toBeLessThan(14);
    // toward the keeper (to its right)
    expect(tr.x).toBeGreaterThan(robberAt.x);
    // and then it scurries away, leaving the trap between them
    step(fw, 0.6);
    expect(Math.hypot(e.x - fw.player.x, e.y - fw.player.y)).toBeGreaterThan(Math.hypot(tr.x - fw.player.x, tr.y - fw.player.y) + 10);
  });

  it('keeps at most TRAP_MAX traps (a champion one more), even against a keeper who never springs one', () => {
    for (const champ of [false, true]) {
      const fw = fakeWorld(`robber-cap-${champ}`);
      const e = fw.w.spawnEnemy(ID, 90, 100)!;
      e.champion = champ;
      // a keeper forever mid-dash: no trap ever bites, so they pile up to the cap
      fw.player.dashing = true;
      let most = 0;
      step(fw, 30, () => { most = Math.max(most, traps(fw).length); }, strafe(fw));
      expect(most).toBeGreaterThanOrEqual(TRAP_MAX);
      expect(most).toBeLessThanOrEqual(champ ? TRAP_MAX + 1 : TRAP_MAX);
    }
  });
});

describe('무덤 도굴꾼: footwork and the trap toss', () => {
  it('keeps off the walls while it keeps its distance (strafing or standing keeper)', () => {
    for (const seed of ['w1', 'w2', 'w3']) {
      for (const mode of ['strafe', 'still'] as const) {
        const fw = fakeWorld(`robber-wall-${seed}-${mode}`);
        const e = fw.w.spawnEnemy(ID, 70, 60)!;
        let near = 0;
        let n = 0;
        step(fw, 20, () => {
          n++;
          if (e.x < IX + 12 || e.y < IY + 12 || e.x > IX + IW - 12 || e.y > IY + IH - 12) near++;
        }, mode === 'strafe' ? strafe(fw) : undefined);
        expect(near / n, `${seed} ${mode}`).toBeLessThan(0.25);
      }
    }
  });

  it('throws a trap at a keeper standing off: wind-up, a landing ring for the whole flight, a harmless landing, then it opens', () => {
    const fw = fakeWorld('robber-toss');
    const e = fw.w.spawnEnemy(ID, 70, 104)!;
    e.dormant = 0;
    Object.assign(fw.player, { x: 70 + (TOSS_MIN + TOSS_MAX) / 2 - 30, y: 104 });
    let windAt = -1;
    let lobAt = -1;
    let ringAt = -1;
    let landAt = -1;
    let ring: GroundWarning | null = null;
    let trap: JawTrap | null = null;
    let hurtsAtLanding = -1;
    step(fw, 5, (t) => {
      if (windAt < 0 && e.anim === 'grobber_toss') {
        windAt = t;
        expect(e.telegraphT).toBeGreaterThan(TOSS_WIND - 0.05);
      }
      if (lobAt < 0 && lobs(fw).length) lobAt = t;
      if (!ring) {
        ring = fw.entities.find((x): x is GroundWarning => x instanceof GroundWarning && !x.dead) ?? null;
        if (ring) ringAt = t;
      }
      if (!trap && traps(fw).length) {
        trap = traps(fw)[0];
        landAt = t;
        hurtsAtLanding = fw.player.hurts;
      }
    });
    expect(windAt).toBeGreaterThan(0);
    expect(lobAt - windAt).toBeGreaterThanOrEqual(TOSS_WIND - 0.02);
    expect(Math.abs(ringAt - lobAt)).toBeLessThanOrEqual(FIXED_DT + 1e-9);
    expect(landAt - lobAt).toBeGreaterThan(TOSS_FLIGHT - 0.05);
    expect(landAt - lobAt).toBeLessThan(TOSS_FLIGHT + 0.05);
    const tr = trap! as JawTrap;
    const rg = ring! as GroundWarning;
    // the ring marked the landing spot, at the keeper's feet
    expect(Math.hypot(rg.x - tr.x, rg.y - tr.y)).toBeLessThan(1);
    expect(Math.hypot(tr.x - fw.player.x, tr.y - fw.player.y)).toBeLessThan(12);
    // landing never hurts; the keeper who never moved is bitten once it has opened
    expect(hurtsAtLanding).toBe(0);
    expect(fw.player.hurts).toBe(1);
    expect(fw.player.hurtLog[0].t - landAt).toBeGreaterThanOrEqual(TRAP_ARM - 0.02);
  });

  it('a thrown trap whose robber dies in flight never lands', () => {
    const fw = fakeWorld('robber-toss-dies');
    const e = fw.w.spawnEnemy(ID, 70, 104)!;
    e.dormant = 0;
    Object.assign(fw.player, { x: 180, y: 104 });
    let killed = false;
    step(fw, 5, () => {
      if (!killed && lobs(fw).length) {
        fw.w.killEnemy(e);
        killed = true;
      }
    });
    expect(killed).toBe(true);
    expect(traps(fw).length).toBe(0);
    expect(leftovers(fw)).toEqual([]);
    expect(fw.player.hurts).toBe(0);
  });
});

// ---------------------------------------------------------------- the trap
describe('무덤 도굴꾼: jaw traps', () => {
  /** A robber kept dormant (it never acts) and one trap of its at (x, y). */
  const setup = (seed: string, x = 150, y = 100) => {
    const fw = fakeWorld(seed);
    const e = fw.w.spawnEnemy(ID, 60, 50)!;
    e.dormant = 1e9;
    const t = fw.w.spawn(new JawTrap(x, y, e));
    Object.assign(fw.player, { x: 260, y: 160 });
    return { fw, e, t };
  };

  it('is harmless while it opens, then bites a keeper standing on it: half a heart, a limp, gone', () => {
    const { fw, t } = setup('trap-bite');
    Object.assign(fw.player, { x: t.x, y: t.y });
    step(fw, TRAP_ARM - 0.05);
    expect(t.armed).toBe(false);
    expect(fw.player.hurts).toBe(0);
    expect(t.dead).toBe(false);
    step(fw, 0.1);
    expect(fw.player.hurts).toBe(1);
    expect(fw.player.hurtLog[0].n).toBe(1);
    expect(fw.player.hurtLog[0].src).toBe(ROBBER_NAME);
    expect(fw.player.statuses.get('slow')?.power).toBe(TRAP_SLOW);
    expect(t.dead).toBe(true);
  });

  it('bites only within its reach, and never a dashing or airborne keeper', () => {
    const { t } = setup('trap-reach');
    expect(t.reaches(t.x + TRAP_TRIGGER + 2, t.y, 5)).toBe(true);
    expect(t.reaches(t.x, t.y + TRAP_TRIGGER + 2, 5)).toBe(true);
    expect(t.reaches(t.x + TRAP_TRIGGER + 3, t.y, 5)).toBe(false);
    expect(t.reaches(t.x + 14, t.y + 4, 5)).toBe(false);
    for (const opts of [{ dashing: true }, { z: 6 }, { x: t.x + 14, y: t.y }]) {
      const s = setup(`trap-miss-${JSON.stringify(opts)}`);
      Object.assign(s.fw.player, { x: s.t.x, y: s.t.y }, opts);
      step(s.fw, TRAP_ARM + 1);
      expect(s.fw.player.hurts, JSON.stringify(opts)).toBe(0);
      expect(s.t.dead, JSON.stringify(opts)).toBe(false);
    }
  });

  it('a dash across it is safe; walking across it after the dash ends is not', () => {
    const { fw, t } = setup('trap-dash', 150, 100);
    step(fw, TRAP_ARM + 0.05);
    // dash over it from 30 px left to 30 px right in 0.2 s, then walk back
    Object.assign(fw.player, { x: 120, y: 100, dashing: true });
    step(fw, 0.2, undefined, (tt) => { fw.player.x = Math.min(180, fw.player.x + 300 * FIXED_DT); void tt; });
    expect(fw.player.hurts).toBe(0);
    expect(t.dead).toBe(false);
    fw.player.dashing = false;
    step(fw, 0.8, undefined, () => { fw.player.x -= 92 * FIXED_DT; });
    expect(fw.player.hurts).toBe(1);
    expect(t.dead).toBe(true);
  });

  it('keeper hits, bullet-clears and old age spring it harmlessly; enemy hits do nothing', () => {
    {
      const { fw, t } = setup('trap-hit');
      step(fw, TRAP_ARM + 0.1);
      expect(t.takeHit(fw.w, { damage: 1, kind: 'projectile', attacker: { team: 'enemy' } as never })).toBe(false);
      expect(t.dead).toBe(false);
      expect(t.takeHit(fw.w, { damage: 1, kind: 'projectile', attacker: { team: 'player' } as never })).toBe(true);
      expect(t.dead).toBe(true);
      expect(t.takeHit(fw.w, { damage: 1, kind: 'melee', attacker: { team: 'player' } as never })).toBe(false);
      expect(fw.player.hurts).toBe(0);
    }
    {
      const { fw, t } = setup('trap-clear');
      t.onCleared(fw.w);
      expect(t.dead).toBe(true);
    }
    {
      const { fw, t } = setup('trap-age');
      step(fw, TRAP_LIFE - 0.1);
      expect(t.dead).toBe(false);
      step(fw, 0.2);
      expect(t.dead).toBe(true);
      expect(fw.player.hurts).toBe(0);
    }
  });

  it('every trap of a robber snaps shut the moment it dies; another robber’s traps stay', () => {
    const fw = fakeWorld('trap-owner');
    const a = fw.w.spawnEnemy(ID, 60, 50)!;
    const b = fw.w.spawnEnemy(ID, 260, 50)!;
    a.dormant = b.dormant = 1e9;
    const mine = [fw.w.spawn(new JawTrap(100, 100, a)), fw.w.spawn(new JawTrap(130, 120, a))];
    const theirs = fw.w.spawn(new JawTrap(200, 120, b));
    Object.assign(fw.player, { x: 300, y: 170 });
    step(fw, 1);
    expect(liveTraps(fw.w, a).length).toBe(2);
    fw.w.killEnemy(a);
    step(fw, FIXED_DT);
    expect(mine.every((t) => t.dead)).toBe(true);
    expect(theirs.dead).toBe(false);
    expect(liveTraps(fw.w, b)).toEqual([theirs]);
  });
});

// ---------------------------------------------------------------- the fling
describe('무덤 도굴꾼: dirt fling when cornered', () => {
  it('a close keeper gets a FLING_WIND wind-up, then a short fan of base-strength chips aimed at them', () => {
    for (const champ of [false, true]) {
      const fw = fakeWorld(`fling-${champ}`);
      const e = fw.w.spawnEnemy(ID, 150, 100)!;
      e.dormant = 0;
      e.champion = champ;
      Object.assign(fw.player, { x: 150 + FLING_NEAR - 18, y: 104 });
      let windAt = -1;
      let firedAt = -1;
      let fired: Projectile[] = [];
      let toKeeper = NaN;
      step(fw, 3, (t) => {
        if (windAt < 0 && e.anim === 'grobber_wind') {
          windAt = t;
          expect(e.telegraphT).toBeGreaterThan(FLING_WIND - 0.05);
        }
        if (firedAt < 0 && shots(fw).length) {
          firedAt = t;
          fired = shots(fw);
          toKeeper = Math.atan2(fw.player.y - e.y, fw.player.x - e.x);
        }
      }, () => {
        // the keeper keeps hugging it
        const a = Math.atan2(fw.player.y - e.y, fw.player.x - e.x);
        fw.player.x = e.x + Math.cos(a) * 40;
        fw.player.y = e.y + Math.sin(a) * 40;
      });
      expect(windAt).toBeGreaterThan(0);
      expect(firedAt - windAt).toBeGreaterThanOrEqual(FLING_WIND - 0.02);
      expect(fired.length).toBe(champ ? FLING_COUNT + 2 : FLING_COUNT);
      for (const p of fired) {
        expect(p.damage).toBe(1);
        expect(p.range).toBe(FLING_RANGE);
      }
      // the fan is centred on the keeper (circular mean of the shot angles)
      const mid = Math.atan2(fired.reduce((s, p) => s + Math.sin(p.angle), 0), fired.reduce((s, p) => s + Math.cos(p.angle), 0));
      expect(Math.abs(Math.atan2(Math.sin(mid - toKeeper), Math.cos(mid - toKeeper)))).toBeLessThan(0.3);
      // and it spreads: the outer chips are well apart
      const spread = Math.max(...fired.map((p) => Math.abs(Math.atan2(Math.sin(p.angle - mid), Math.cos(p.angle - mid)))));
      expect(spread).toBeGreaterThan(0.35);
    }
  });
});

// ---------------------------------------------------------------- real World
function realWorld(seed: string) {
  const { world: w, dummies } = measureDps({ character: 'ria', weapon: 'lantern_bolt', seconds: 0, dist: 60, seed });
  for (const d of dummies) w.killEnemy(d);
  w.inputSource = (_w, _p, o) => { o.mx = o.my = o.ax = o.ay = o.held = o.pressed = 0; };
  return w;
}

describe('무덤 도굴꾼 in the real World', () => {
  it('is in floor 1’s enemy pool', () => {
    const w = realWorld('robber-pool');
    expect(w.floor.index).toBe(1);
    expect(w.enemyPool()[ID]).toBe(Enemies.must(ID).weight);
  });

  it('a trap bite costs the real keeper exactly half a heart and slows them', () => {
    const w = realWorld('robber-bite');
    const p = w.player;
    p.god = false;
    p.invuln = 0;
    const e = w.spawnEnemy(ID, p.x + 120, p.y - 30)!;
    e.dormant = 1e9;
    const t = w.spawn(new JawTrap(p.x + 30, p.y, e));
    for (let i = 0; i < Math.ceil((TRAP_ARM + 0.1) / FIXED_DT); i++) w.update(FIXED_DT);
    expect(t.armed).toBe(true);
    const hp0 = p.red + p.soul;
    p.x = t.x;
    p.y = t.y;
    w.update(FIXED_DT);
    w.update(FIXED_DT);
    expect(hp0 - (p.red + p.soul)).toBe(1);
    expect(p.speedMult()).toBeLessThan(0.6);
    expect(t.dead).toBe(true);
    expect(w.run.lastDamageSource).toBe(ROBBER_NAME);
  });

  it('a keeper shot springs a trap harmlessly (traps are hittable)', () => {
    const w = realWorld('robber-shoot');
    const p = w.player;
    p.god = false;
    p.invuln = 0;
    const e = w.spawnEnemy(ID, p.x + 120, p.y - 40)!;
    e.dormant = 1e9;
    const t = w.spawn(new JawTrap(p.x + 50, p.y, e));
    for (let i = 0; i < Math.ceil((TRAP_ARM + 0.1) / FIXED_DT); i++) w.update(FIXED_DT);
    const hp0 = p.red + p.soul;
    const shot = w.spawn(new Projectile({ team: 'player', x: p.x + 20, y: t.y, angle: 0, speed: 200, damage: 5, owner: p }));
    for (let i = 0; i < 40 && !t.dead; i++) w.update(FIXED_DT);
    expect(t.dead).toBe(true);
    expect(shot.dead).toBe(true);
    expect(p.red + p.soul).toBe(hp0);
  });

  it('killing the robber springs its traps; draw never touches the simulation', () => {
    const w = realWorld('robber-draw');
    const p = w.player;
    p.god = true;
    const e = w.spawnEnemy(ID, p.x + 90, p.y - 20)!;
    e.dormant = 0;
    w.spawnEnemy('bone_walker', p.x - 80, p.y - 30)!.dormant = 0;
    let sawTrap = false;
    let sawChip = false;
    for (let i = 0; i < 600; i++) {
      // the keeper drifts toward the robber in the second half (provokes the fling)
      if (i > 300 && e.alive) {
        const a = Math.atan2(p.y - e.y, p.x - e.x);
        p.x = e.x + Math.cos(a) * 40;
        p.y = e.y + Math.sin(a) * 40;
      }
      w.update(FIXED_DT);
      if (liveTraps(w, e).length) sawTrap = true;
      if (w.projectiles.some((x) => x.team === 'enemy' && x.owner === e)) sawChip = true;
      const before = stateHash(w);
      w.draw(1);
      expect(stateHash(w), `step ${i}`).toBe(before);
    }
    expect(sawTrap && sawChip).toBe(true);
    if (!e.alive) return;
    w.spawn(new JawTrap(e.x + 20, e.y, e));
    w.update(FIXED_DT);
    expect(liveTraps(w, e).length).toBeGreaterThan(0);
    w.killEnemy(e);
    w.update(FIXED_DT);
    expect(liveTraps(w, e).length).toBe(0);
    expect(w.entities.some((x) => x instanceof JawTrap && !x.dead)).toBe(false);
  });
});

// ---------------------------------------------------------------- review fixes
/** Packed pixel value of `c` as PixelPainter stores it. */
function packed(c: string): number {
  const q = new PixelPainter(1, 1);
  q.px(0, 0, c);
  return q.data[0];
}

describe('무덤 도굴꾼: review fixes', () => {
  it('the gold goblet shows whole in every frame (it used to be clipped off the high steps)', () => {
    const gold = new Set(GOLD.map(packed));
    let frames = 0;
    for (const [state, poses] of Object.entries(ROBBER_POSES)) {
      poses.forEach((pose, i) => {
        const p = new PixelPainter(ROBBER_W, ROBBER_H);
        paintRobber(p, pose);
        let n = 0;
        for (const v of p.data) if (gold.has(v)) n++;
        // rim 3 + cup 3 + stem 1
        expect(n, `${state}_${i}`).toBe(7);
        frames++;
      });
    }
    expect(frames).toBeGreaterThanOrEqual(18);
    // the trap held while planting keeps its right end (it was cut by the figure canvas)
    for (const pose of ROBBER_POSES.plant) {
      const p = new PixelPainter(ROBBER_W, ROBBER_H);
      paintRobber(p, pose);
      expect(p.data[22 * ROBBER_W + 21] >>> 24, 'held trap, right end').not.toBe(0);
    }
  });

  it('a flying keeper passes over an armed trap (like spikes); on foot it bites', () => {
    const fw = fakeWorld('trap-flying');
    const e = fw.w.spawnEnemy(ID, 60, 50)!;
    e.dormant = 1e9;
    const t = fw.w.spawn(new JawTrap(150, 100, e));
    Object.assign(fw.player, { x: 150, y: 100, flying: true });
    step(fw, TRAP_ARM + 1);
    expect(t.armed).toBe(true);
    expect(fw.player.hurts).toBe(0);
    expect(t.dead).toBe(false);
    Object.assign(fw.player, { flying: false });
    step(fw, 0.1);
    expect(fw.player.hurts).toBe(1);
    expect(t.dead).toBe(true);
  });

  it('with cover in between it works its way round instead of lurking, and never flings or throws blind', () => {
    for (const seed of ['c1', 'c2', 'c3']) {
      const fw = fakeWorld(`robber-cover-${seed}`);
      fw.los = false;
      // a keeper standing 110 px off: the lurk band, out of the plant band
      const e = fw.w.spawnEnemy(ID, 100, 104)!;
      e.dormant = 0;
      Object.assign(fw.player, { x: 210, y: 104 });
      let closest = Infinity;
      step(fw, 4, () => { closest = Math.min(closest, Math.hypot(e.x - fw.player.x, e.y - fw.player.y)); });
      // it closed in (it used to sidle at ~100 px behind the cover for as long as the keeper stood there)
      expect(closest, seed).toBeLessThan(80);
      expect(shots(fw).length + lobs(fw).length, seed).toBe(0);
    }
    // a keeper right next to it but behind cover: no chips into the rock
    const fw = fakeWorld('robber-cover-fling');
    fw.los = false;
    const e = fw.w.spawnEnemy(ID, 150, 100)!;
    e.dormant = 0;
    let fired = 0;
    step(fw, 4, () => { fired += shots(fw).length; }, () => {
      const a = Math.atan2(fw.player.y - e.y, fw.player.x - e.x);
      fw.player.x = e.x + Math.cos(a) * 40;
      fw.player.y = e.y + Math.sin(a) * 40;
    });
    expect(fired).toBe(0);
    // once the keeper is in sight, the same squeeze gets the fling
    fw.los = true;
    step(fw, 3, () => { fired += shots(fw).length; }, () => {
      const a = Math.atan2(fw.player.y - e.y, fw.player.x - e.x);
      fw.player.x = e.x + Math.cos(a) * 40;
      fw.player.y = e.y + Math.sin(a) * 40;
    });
    expect(fired).toBeGreaterThan(0);
  });

  it('a charmed robber only skulks: no traps, throws or chips that would bite the keeper', () => {
    const fw = fakeWorld('robber-charm');
    const e = fw.w.spawnEnemy(ID, 120, 70)!;
    e.dormant = 0;
    e.applyStatus({ kind: 'charm', duration: 100 }, () => 0);
    let seen = 0;
    step(fw, 12, () => { seen += traps(fw).length + shots(fw).length + lobs(fw).length; }, strafe(fw));
    expect(seen).toBe(0);
    expect(fw.player.hurts).toBe(0);
  });

  it('never stacks its trap on another robber’s', () => {
    for (const seed of ['s1', 's2', 's3']) {
      const fw = fakeWorld(`robber-stack-${seed}`);
      // a keeper forever mid-dash (no trap ever bites) standing on robber B's trap
      Object.assign(fw.player, { x: 220, y: 104, dashing: true });
      const b = fw.w.spawnEnemy(ID, 280, 50)!;
      b.dormant = 1e9;
      const theirs = fw.w.spawn(new JawTrap(220, 104, b));
      const a = fw.w.spawnEnemy(ID, 100, 104)!;
      a.dormant = 0;
      const mine = new Set<JawTrap>();
      step(fw, 9, () => { for (const t of liveTraps(fw.w, a)) mine.add(t); });
      expect(mine.size, seed).toBeGreaterThan(0);
      for (const t of mine) expect(Math.hypot(t.x - theirs.x, t.y - theirs.y), seed).toBeGreaterThanOrEqual(14);
    }
  });

  it('robbers throwing at the same keeper never land two traps on one spot (traps in the air count)', () => {
    let pairs = 0;
    for (const seed of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) {
      const fw = fakeWorld(`robber-pair-${seed}`);
      // a keeper standing still (and forever mid-dash, so no trap bites): every throw aims at its feet
      Object.assign(fw.player, { x: 168, y: 104, dashing: true });
      for (const [x, y] of [[60, 70], [276, 70], [60, 150], [276, 150]]) fw.w.spawnEnemy(ID, x, y)!.dormant = 0;
      step(fw, 10, () => {
        const t = traps(fw);
        for (let i = 0; i < t.length; i++) {
          for (let j = i + 1; j < t.length; j++) {
            pairs++;
            expect(Math.hypot(t[i].x - t[j].x, t[i].y - t[j].y), seed).toBeGreaterThanOrEqual(14);
          }
        }
      });
    }
    expect(pairs).toBeGreaterThan(100);
  });

  it('two Worlds on the same seed stay bit-identical with robbers fighting, whatever the cosmetic RNG and drawing do', () => {
    const run = (fxSeed: number, draw: boolean) => {
      fx.setState(new RNG(fxSeed).getState());
      const w = realWorld('robber-lockstep');
      const p = w.player;
      p.god = true;
      w.inputSource = (ww: World, _p: unknown, o: PlayerInput) => {
        const t = ww.time;
        o.mx = Math.cos(t * 0.7);
        o.my = Math.sin(t * 1.3) * 0.8;
        o.ax = o.ay = 0;
        o.pressed = 0;
        const e = ww.enemies[0];
        o.cx = e ? e.x : p.x + 30;
        o.cy = e ? e.y : p.y;
        o.held = (Math.floor(t * 0.5) % 2 ? HELD.fire : 0) | HELD.cursorAim;
      };
      w.spawnEnemy(ID, p.x + 100, p.y - 30)!.dormant = 0;
      w.spawnEnemy(ID, p.x - 90, p.y - 20)!.dormant = 0;
      w.spawnEnemy('bone_walker', p.x + 20, p.y - 60)!.dormant = 0;
      const hashes: string[] = [];
      for (let i = 0; i < 900; i++) {
        w.update(FIXED_DT);
        if (draw && i % 3 === 0) w.draw(1);
        hashes.push(String(stateHash(w)));
      }
      return hashes;
    };
    const a = run(1, false);
    const b = run(0x9e3779b9, true);
    const diverge = a.findIndex((h, i) => h !== b[i]);
    expect(diverge, `first diverging step ${diverge}`).toBe(-1);
  });
});
