// Regular enemies of floors 4–5 (얼어붙은 성소 / 공허의 심장) and the transition enemies:
// registry + balance checks, the shared geometry helpers, and a headless AI simulation
// that exercises every script plus the signature mechanics (shield link, eyelid armor,
// splitting, mirror, gravity, swallowing shots ...).

import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Enemies } from '../src/game/defs';
import { Enemy } from '../src/game/enemy';
import { Entity } from '../src/game/entity';
import { GroundWarning } from '../src/game/effects';
import { Projectile } from '../src/game/projectile';
import { getAnim, hasAnim, hasSprite, listSprites } from '../src/engine/sprites';
import { RNG } from '../src/engine/rng';
import { hexToRgb } from '../src/engine/math';
import type { World } from '../src/game/world';
import {
  BUL, gapStartFor, inAimCone, lineSpots, mirrorPoint, pullSpeed, shardSprite, starSprite, wallSlots,
} from '../src/content/enemies/shared';
import { FrostPatch, hangAndAim } from '../src/content/enemies/sanctum';
import { mirrorSpot } from '../src/content/enemies/sanctum-bridge';
import { orbitThenRelease } from '../src/content/enemies/abyss-deep';

loadContent();

/** Floor 4–5 regular enemies (+ transition enemies) and their floors. */
const LATE_ENEMIES: Record<string, number[]> = {
  frost_wraith: [4],
  frost_knight: [4],
  saint_statue: [4],
  snow_hound: [4],
  frost_crystal: [4],
  choir_cantor: [4],
  rime_slime: [4],
  snowflake_sprite: [4],
  censer_monk: [3, 4],
  star_jelly: [4, 5],
  mirror_shade: [4, 5],
  void_eye: [5],
  void_tentacle: [5],
  shadow_double: [5],
  warp_stalker: [5],
  gravity_well: [5],
  abyss_maw: [5],
  star_eater: [5],
  abyss_larva: [5],
};
/** Spawned only by scripts. */
const MINIONS = ['choir_acolyte'];
const ALL = [...Object.keys(LATE_ENEMIES), ...MINIONS];

function spriteDefined(name: string): boolean {
  if (hasAnim(name)) {
    const a = getAnim(name)!;
    return a.frames.length > 0 && a.frames.every((f) => hasSprite(f));
  }
  return hasSprite(name);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('floor 4–5 enemy definitions', () => {
  it('registers every late enemy with the expected floors', () => {
    for (const [id, floors] of Object.entries(LATE_ENEMIES)) {
      const d = Enemies.get(id);
      expect(d, id).toBeDefined();
      expect(d!.floors, id).toEqual(floors);
      expect(d!.boss, id).toBeFalsy();
    }
    for (const id of MINIONS) {
      expect(Enemies.get(id), id).toBeDefined();
      expect(Enemies.get(id)!.floors, id).toBeUndefined();
    }
    expect(Object.keys(LATE_ENEMIES).length).toBeGreaterThanOrEqual(17);
    // 2–3 transition enemies smooth the floor boundaries
    const bridges = Object.values(LATE_ENEMIES).filter((f) => f.length > 1);
    expect(bridges.length).toBeGreaterThanOrEqual(2);
  });

  it('has a varied pool of at least 7 own regular enemies on floors 4 and 5', () => {
    for (const floor of [4, 5]) {
      const own = Object.entries(LATE_ENEMIES).filter(([, f]) => f.length === 1 && f[0] === floor);
      expect(own.length, `floor ${floor}`).toBeGreaterThanOrEqual(7);
      const pool = Enemies.all().filter((d) => !d.boss && d.floors?.includes(floor));
      expect(pool.length, `floor ${floor} pool`).toBeGreaterThanOrEqual(9);
      // the pool mixes cheap fodder with heavier hitters
      const costs = pool.map((d) => d.cost ?? 1);
      expect(Math.min(...costs), `floor ${floor} fodder`).toBeLessThanOrEqual(1);
      expect(Math.max(...costs), `floor ${floor} heavy`).toBeGreaterThanOrEqual(3);
    }
  });

  it('stats follow the balance guide (floor-1 scale numbers)', () => {
    for (const id of ALL) {
      const d = Enemies.must(id);
      expect(d.hp, id).toBeGreaterThanOrEqual(10);
      expect(d.hp, id).toBeLessThanOrEqual(120);
      expect(d.cost ?? 1, id).toBeGreaterThan(0);
      expect(d.cost ?? 1, id).toBeLessThanOrEqual(4);
      expect(d.speed ?? 40, id).toBeLessThan(92); // never outruns the player
      expect(d.contactDamage ?? 1, id).toBeLessThanOrEqual(2);
      expect(d.radius, id).toBeGreaterThan(2);
      expect(d.deathFx, id).toBeDefined();
      expect(d.bloodColor, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(d.light, id).toBeDefined();
      expect(d.script, id).toBeTypeOf('function');
      expect(spriteDefined(d.sprite), `${id} sprite "${d.sprite}"`).toBe(true);
      if (!MINIONS.includes(id)) expect(d.champion, id).toBe(true);
    }
    // late-game: regular enemies are sturdier than floor-1 fodder on average
    const avg = Object.keys(LATE_ENEMIES).reduce((s, id) => s + Enemies.must(id).hp, 0) / Object.keys(LATE_ENEMIES).length;
    expect(avg).toBeGreaterThan(35);
  });

  it('every enemy has move / attack / hurt animation frames, and every referenced sprite exists', () => {
    const sources = import.meta.glob(['../src/content/enemies/sanctum*.ts', '../src/content/enemies/abyss*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(4);
    const names = new Set<string>();
    for (const src of Object.values(sources)) {
      for (const m of src.matchAll(/setAnim\('([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/r\.sprite\('([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/sprite: '([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/hurtFrame\(e, w, '([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/new AnimEffect\('([a-z0-9_]+)'/g)) names.add(m[1]);
    }
    expect(names.size).toBeGreaterThan(60);
    for (const n of names) expect(spriteDefined(n), n).toBe(true);
    // each enemy's sprite prefix has at least 3 animated states (move + attack + hurt)
    const all = listSprites();
    for (const id of ALL) {
      const d = Enemies.must(id);
      const prefix = d.sprite.split('_')[0];
      const states = new Set(all.filter((n) => n.startsWith(prefix + '_') && hasAnim(n.replace(/_\d+$/, ''))).map((n) => n.split('_')[1]));
      expect(states.has('hurt'), `${id} hurt frame`).toBe(true);
      expect(states.size, `${id} states ${[...states]}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('late-floor bullets are high-contrast (bright core, dark rim)', () => {
    for (const k of ['frost', 'hymn', 'void', 'eldritch', 'star'] as const) {
      const pal = BUL[k];
      expect(contrast(pal.color, pal.outline), k).toBeGreaterThan(6);
      expect(contrast(pal.core, pal.outline), k).toBeGreaterThan(12);
      expect(luminance(pal.core), k).toBeGreaterThan(0.7);
    }
    // the abyss floor is nearly black: its bullets must pop against it
    for (const k of ['void', 'eldritch', 'star'] as const) expect(contrast(BUL[k].color, '#181224'), k).toBeGreaterThan(4.5);
    // sanctum bullets read against its mid-blue ice floor
    for (const k of ['frost', 'hymn'] as const) expect(contrast(BUL[k].color, '#283e5a'), k).toBeGreaterThan(3);
    expect(hasSprite(shardSprite('frost', 11))).toBe(true);
    expect(hasSprite(starSprite('star', 9))).toBe(true);
  });
});

describe('floor 4–5 helpers', () => {
  it('wallSlots leaves exactly one gap of the requested width', () => {
    const slots = wallSlots(15, 4, 3);
    expect(slots).toHaveLength(12);
    const idx = slots.map((s) => s + 7);
    for (const i of [4, 5, 6]) expect(idx).not.toContain(i);
    for (const i of [0, 3, 7, 14]) expect(idx).toContain(i);
  });

  it('gapStartFor keeps the gap inside the wall and off-center when asked', () => {
    for (let off = -10; off <= 10; off += 0.5) {
      const g = gapStartFor(15, 3, off);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(12);
    }
    // offsets of ≥1.5 slots move the hole away from the center slot (the player must move)
    for (const off of [1.5, 2, 3.5, -1.5, -2, -3.5]) {
      const g = gapStartFor(15, 3, off);
      expect(g <= 7 && 7 < g + 3, `offset ${off}`).toBe(false);
    }
  });

  it('mirrorPoint reflects through the center', () => {
    expect(mirrorPoint(10, 20, 100, 50)).toEqual({ x: 190, y: 80 });
    expect(mirrorPoint(100, 50, 100, 50)).toEqual({ x: 100, y: 50 });
  });

  it('inAimCone detects targets in front of the aim direction', () => {
    expect(inAimCone(0, 0, 0, 50, 5, 0.6)).toBe(true);
    expect(inAimCone(0, 0, 0, -50, 0, 0.6)).toBe(false);
    expect(inAimCone(Math.PI, 0, 0, -50, 1, 0.6)).toBe(true);
    expect(inAimCone(-Math.PI + 0.1, 0, 0, -50, 1, 0.6)).toBe(true); // wraps around ±π
    expect(inAimCone(Math.PI / 2, 0, 0, 0, 40, 0.3)).toBe(true);
  });

  it('pullSpeed is zero outside the radius, strongest at the center, always escapable', () => {
    expect(pullSpeed(200, 150, 40)).toBe(0);
    expect(pullSpeed(150, 150, 40)).toBe(0);
    let last = Infinity;
    for (let d = 0; d < 150; d += 10) {
      const s = pullSpeed(d, 150, 40);
      expect(s).toBeLessThanOrEqual(last);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(92 * 0.5);
      last = s;
    }
  });

  it('lineSpots walks along a ray at even spacing', () => {
    const pts = lineSpots(10, 10, 0, 4, 15, 16);
    expect(pts.map((p) => Math.round(p.x))).toEqual([26, 41, 56, 71]);
    for (const p of pts) expect(p.y).toBeCloseTo(10);
  });
});

// ---------------------------------------------------------------- headless AI simulation
interface FakePlayer {
  x: number; y: number; vx: number; vy: number; r: number; z: number; alive: boolean; aim: number;
  kbx: number; kby: number; lastAttackAt: number; statuses: Map<string, unknown>; hurts: number;
  facing: string; flip: boolean; moving: boolean; animT: number; character: { spritePrefix: string };
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

function fakeWorld(seed: string, floor = 4): FakeWorld {
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
    statuses: new Map(), hurts: 0, facing: 'down', flip: false, moving: false, animT: 0, character: { spritePrefix: 'ria' },
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
    floor: { index: floor, hpMult: 1 },
    vars: {} as Record<string, number>,
    player,
    room,
    enemies,
    projectiles,
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

/** Advance the fake world. By default the player strafes around the room. */
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
    fw.player.kbx *= Math.exp(-w.dt * 10);
    fw.player.kby *= Math.exp(-w.dt * 10);
    for (const e of [...fw.entities]) if (!e.dead) e.update(fw.w, w.dt);
    for (const e of w.enemies) if (!e.dead && e.hp <= 0) fw.w.killEnemy(e);
    const alive = fw.entities.filter((e) => !e.dead);
    fw.entities.splice(0, fw.entities.length, ...alive);
    w.enemies.splice(0, w.enemies.length, ...w.enemies.filter((e) => !e.dead));
    w.projectiles.splice(0, w.projectiles.length, ...w.projectiles.filter((e) => !e.dead));
    onFrame?.(w.time);
  }
}

describe('floor 4–5 enemy AI (headless simulation)', () => {
  for (const id of ALL) {
    it(`${id} runs its script for 12s without errors and stays in the room`, () => {
      const fw = fakeWorld(`sim45-${id}`, LATE_ENEMIES[id]?.[LATE_ENEMIES[id].length - 1] ?? 4);
      const e = fw.w.spawnEnemy(id, 120, 70)!;
      expect(e).toBeTruthy();
      step(fw, 12, (t) => {
        fw.player.lastAttackAt = Math.floor(t * 2) / 2; // the player attacks twice a second
        for (const o of fw.w.enemies) {
          expect(Number.isFinite(o.x) && Number.isFinite(o.y), `${o.def.id} position`).toBe(true);
          expect(o.x).toBeGreaterThan(0);
          expect(o.y).toBeGreaterThan(0);
          expect(o.x).toBeLessThan(400);
          expect(o.y).toBeLessThan(260);
        }
      });
      if (e.alive) {
        e.vulnerable = true;
        e.hidden = false;
        fw.w.killEnemy(e);
      }
      step(fw, 1.5);
    });
  }

  it('every attacker produces telegraphed danger (bullets, lobs, warnings) within 12s', () => {
    // the saint statue only hurts by touch unless it is stared at (tested separately)
    for (const id of Object.keys(LATE_ENEMIES).filter((x) => x !== 'saint_statue')) {
      const fw = fakeWorld(`danger45-${id}`, LATE_ENEMIES[id][LATE_ENEMIES[id].length - 1]);
      fw.w.spawnEnemy(id, 120, 70);
      let dangerous = 0;
      step(fw, 12, (t) => {
        fw.player.lastAttackAt = Math.floor(t * 2) / 2;
        dangerous = Math.max(dangerous, fw.entities.filter((x) => (x.team === 'enemy' && !(x instanceof Enemy)) || x instanceof GroundWarning).length);
      });
      expect(dangerous, id).toBeGreaterThan(0);
    }
  });

  it('choir cantor is warded while its two acolytes live', () => {
    const fw = fakeWorld('choir');
    const c = fw.w.spawnEnemy('choir_cantor', 150, 90)!;
    step(fw, 1);
    const acolytes = fw.w.enemies.filter((o) => o.def.id === 'choir_acolyte');
    expect(acolytes.length).toBe(2);
    for (const a of acolytes) expect(a.mem.owner).toBe(c);
    const hp0 = c.hp;
    c.takeHit(fw.w, { damage: 20, kind: 'projectile', dirX: 1, dirY: 0 });
    expect(c.hp).toBeCloseTo(hp0, 5);
    fw.w.killEnemy(acolytes[0]);
    step(fw, 0.1);
    c.takeHit(fw.w, { damage: 20, kind: 'projectile', dirX: 1, dirY: 0 });
    expect(c.hp).toBeCloseTo(hp0, 5); // one left: still warded
    fw.w.killEnemy(acolytes[1]);
    step(fw, 0.1);
    expect(c.mem.enraged).toBe(true);
    c.takeHit(fw.w, { damage: 20, kind: 'projectile', dirX: 1, dirY: 0 });
    expect(hp0 - c.hp).toBeCloseTo(20, 5);
  });

  it('void eye takes a quarter damage while closed, full damage while open', () => {
    const fw = fakeWorld('eye', 5);
    const e = fw.w.spawnEnemy('void_eye', 150, 90)!;
    e.mem.open = 0;
    const hp0 = e.hp;
    e.takeHit(fw.w, { damage: 20, kind: 'projectile', dirX: 1, dirY: 0 });
    expect(hp0 - e.hp).toBeCloseTo(5, 5);
    e.mem.open = 1;
    const hp1 = e.hp;
    e.takeHit(fw.w, { damage: 20, kind: 'projectile', dirX: 1, dirY: 0 });
    expect(hp1 - e.hp).toBeCloseTo(20, 5);
  });

  it('shadow double splits once at half health; the twins do not split again', () => {
    const fw = fakeWorld('split', 5);
    const e = fw.w.spawnEnemy('shadow_double', 150, 90)!;
    e.takeHit(fw.w, { damage: e.maxHp * 0.3, kind: 'projectile', dirX: 1, dirY: 0 });
    expect(fw.w.enemies.filter((o) => o.def.id === 'shadow_double').length).toBe(1);
    e.takeHit(fw.w, { damage: e.maxHp * 0.3, kind: 'projectile', dirX: 1, dirY: 0 });
    const twins = fw.w.enemies.filter((o) => o.def.id === 'shadow_double');
    expect(twins.length).toBe(2);
    for (const t of twins) expect(t.mem.gen).toBe(1);
    expect(twins[1].hp).toBeCloseTo(e.hp, 5);
    for (const t of twins) t.takeHit(fw.w, { damage: 1, kind: 'projectile', dirX: 1, dirY: 0 });
    expect(fw.w.enemies.filter((o) => o.def.id === 'shadow_double').length).toBe(2);
  });

  it('saint statue stays still while watched and slides in when the player looks away', () => {
    const fw = fakeWorld('statue');
    const e = fw.w.spawnEnemy('saint_statue', 168, 50)!;
    fw.player.x = 168;
    fw.player.y = 150;
    fw.player.aim = -Math.PI / 2; // looking straight at it
    step(fw, 1.5, undefined, false);
    expect(Math.hypot(e.x - 168, e.y - 50)).toBeLessThan(2);
    expect(e.harmful).toBe(false);
    fw.player.aim = Math.PI / 2; // turn around
    step(fw, 0.8, undefined, false);
    expect(e.y).toBeGreaterThan(70);
    expect(e.harmful).toBe(true);
    // stared at for too long, it weeps a ring of light
    fw.player.aim = -Math.PI / 2;
    let shots = 0;
    step(fw, 4, () => {
      shots = Math.max(shots, fw.entities.filter((x) => x instanceof Projectile).length);
    }, false);
    expect(shots).toBeGreaterThanOrEqual(8);
  });

  it('snow hounds take turns: never two pouncing at once', () => {
    const fw = fakeWorld('pack');
    for (const [x, y] of [[80, 60], [250, 60], [168, 50]]) fw.w.spawnEnemy('snow_hound', x, y);
    let maxLeaping = 0;
    let leaps = 0;
    let was = 0;
    step(fw, 14, () => {
      const n = fw.w.enemies.filter((o) => o.anim === 'shound_leap').length;
      maxLeaping = Math.max(maxLeaping, n);
      if (n > was) leaps++;
      was = n;
    });
    expect(maxLeaping).toBe(1);
    expect(leaps).toBeGreaterThan(2);
  });

  it('gravity well drags the player while pulling, but slower than they can walk', () => {
    const fw = fakeWorld('well', 5);
    const e = fw.w.spawnEnemy('gravity_well', 168, 60)!;
    fw.player.x = 168;
    fw.player.y = 150;
    let maxPull = 0;
    step(fw, 6, () => {
      fw.player.x = 168;
      fw.player.y = 150;
      if (e.mem.pulling) maxPull = Math.max(maxPull, -fw.player.kby);
    }, false);
    expect(maxPull).toBeGreaterThan(10); // pulled up toward the well
    expect(maxPull).toBeLessThan(46);
  });

  it('void tentacle cannot be hit while burrowed', () => {
    const fw = fakeWorld('tent', 5);
    const e = fw.w.spawnEnemy('void_tentacle', 150, 90)!;
    expect(e.mem.under).toBe(1);
    expect(e.takeHit(fw.w, { damage: 20, kind: 'projectile' })).toBe(false);
    let surfaced = false;
    step(fw, 4, () => {
      if (!e.mem.under) surfaced = true;
    });
    expect(surfaced).toBe(true);
  });

  it('mirror shade answers the player\'s attacks with a mirrored shot', () => {
    const fw = fakeWorld('mirror', 4);
    const e = fw.w.spawnEnemy('mirror_shade', 200, 60)!;
    step(fw, 1.5, undefined, false);
    const before = fw.entities.filter((x) => x instanceof Projectile).length;
    expect(before).toBe(0); // no attack from the player, no shot
    fw.player.aim = 0; // shooting right
    fw.player.lastAttackAt = (fw.w as unknown as { time: number }).time;
    step(fw, 0.4, undefined, false);
    const shots = fw.entities.filter((x): x is Projectile => x instanceof Projectile);
    expect(shots.length).toBe(1);
    expect(Math.cos(shots[0].angle)).toBeCloseTo(-1, 3); // mirrored: flies left
    expect(e.alive).toBe(true);
  });

  it('mirrorSpot is the point reflection, kept inside and within melee reach', () => {
    const fw = fakeWorld('mspot');
    fw.player.x = IX + 40;
    fw.player.y = IY + 30;
    const s = mirrorSpot(fw.w, 6);
    expect(s.x).toBeCloseTo(IX + IW - 40);
    expect(s.y).toBeCloseTo(IY + IH - 30);
    fw.player.x = IX + IW / 2 + 3;
    fw.player.y = IY + IH / 2;
    const c = mirrorSpot(fw.w, 6);
    expect(Math.hypot(c.x - fw.player.x, c.y - fw.player.y)).toBeGreaterThanOrEqual(29.9);
    expect(c.x).toBeGreaterThanOrEqual(IX);
    expect(c.x).toBeLessThanOrEqual(IX + IW);
  });

  it('star-eater swallows player shots that fly into its open maw', () => {
    const fw = fakeWorld('eater', 5);
    const e = fw.w.spawnEnemy('star_eater', 168, 90)!;
    e.speed = 0;
    step(fw, 1, undefined, false);
    e.facing = 1;
    e.mem.devour = 1;
    e.mem.eaten = 0;
    const shot = fw.w.spawn(new Projectile({ team: 'player', x: e.x - 30, y: e.y + 6, angle: 0, speed: 200, damage: 10 }));
    step(fw, 0.5, undefined, false);
    expect(shot.dead).toBe(true);
    expect(e.mem.eaten).toBe(1);
  });

  it('frost patch slows the player only once armed', () => {
    const fw = fakeWorld('patch');
    fw.player.x = 100;
    fw.player.y = 100;
    const patch = fw.w.spawn(new FrostPatch(100, 100, 14, 2));
    patch.update(fw.w, 0.1);
    expect(fw.player.statuses.has('slow')).toBe(false);
    patch.update(fw.w, 0.5);
    expect(fw.player.statuses.has('slow')).toBe(true);
  });

  it('hanging frost shards stop, then launch at the player', () => {
    const fw = fakeWorld('hang');
    fw.player.x = 100;
    fw.player.y = 200;
    const p = new Projectile({ team: 'enemy', x: 100, y: 50, angle: 0, speed: 125, damage: 1, accel: -270, minSpeed: 0, behaviors: [hangAndAim(0.9, 150)] });
    fw.w.spawn(p);
    step(fw, 0.6, undefined, false);
    expect(p.speed).toBeLessThan(1);
    const d0 = Math.hypot(p.x - 100, p.y - 196);
    step(fw, 0.6, undefined, false);
    expect(p.mem.go).toBe(1);
    expect(Math.sin(p.angle)).toBeGreaterThan(0.95); // aimed down at the player
    expect(Math.hypot(p.x - 100, p.y - 196)).toBeLessThan(d0 - 20);
  });

  it('orbiting stars circle their owner, then fly outward', () => {
    const owner = { x: 100, y: 100, age: 0, alive: true } as unknown as Enemy;
    const b = orbitThenRelease(owner, 0, 8, 1.0, 30);
    const p = new Projectile({ team: 'enemy', x: 100, y: 100, angle: 0, speed: 0, damage: 1, behaviors: [b] });
    p.age = 0.5;
    b.update!(p, {} as World, 1 / 60);
    expect(Math.hypot(p.x - 100, (p.y - 100) / 0.75)).toBeCloseTo(36, 0);
    expect(p.mem.free).toBeUndefined();
    p.age = 1.1;
    b.update!(p, {} as World, 1 / 60);
    expect(p.mem.free).toBe(1);
    expect(p.speed).toBeGreaterThan(0);
  });
});
