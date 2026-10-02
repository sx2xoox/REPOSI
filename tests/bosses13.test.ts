import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Enemies, Floors } from '../src/game/defs';
import { Enemy } from '../src/game/enemy';
import { Entity } from '../src/game/entity';
import { GroundWarning } from '../src/game/effects';
import { Projectile } from '../src/game/projectile';
import { getAnim, hasAnim, hasSprite } from '../src/engine/sprites';
import { RNG } from '../src/engine/rng';
import { angleDiff, TAU } from '../src/engine/math';
import type { World } from '../src/game/world';
import { Hazard, Lob } from '../src/content/enemies/shared';
import {
  arcZ, clearEnemyShots, Eruption, Faller, gapRing, inGap, phaseFor, pickPattern, Shockwave, summonMinion, Trail,
} from '../src/content/bosses/kit13';
import { ImugiPart } from '../src/content/bosses/slag-imugi';

loadContent();

/** The six floor 1–3 bosses (two per floor). */
const BOSSES: Record<string, { floor: number; prefixes: string[]; states: string[] }> = {
  bone_colossus: { floor: 1, prefixes: ['bcol', 'bcol2'], states: ['idle', 'crawl', 'raise', 'slam', 'roar', 'retch', 'charge', 'crouch', 'air', 'stagger'] },
  bell_keeper: { floor: 1, prefixes: ['bkeep', 'bkeep2'], states: ['float', 'swing', 'toll', 'cast', 'spin', 'hurt'] },
  spore_mother: { floor: 2, prefixes: ['smom', 'smom2'], states: ['idle', 'inhale', 'exhale', 'spit', 'roots', 'sink', 'emerge', 'hurt'] },
  slime_queen: { floor: 2, prefixes: ['squeen0', 'squeen1', 'squeen2'], states: ['idle', 'crouch', 'air', 'land', 'spit', 'hurt'] },
  chain_smith: { floor: 3, prefixes: ['csmith', 'csmith2'], states: ['idle', 'walk', 'raise', 'slam', 'hookwind', 'throw', 'spin', 'vent', 'hurt'] },
  slag_imugi: { floor: 3, prefixes: ['imugi', 'imugi2'], states: ['side', 'down', 'up', 'rear', 'hurt', 'seg_l', 'seg_m', 'seg_s', 'tail'] },
};

function spriteDefined(name: string): boolean {
  if (hasAnim(name)) {
    const a = getAnim(name)!;
    return a.frames.length > 0 && a.frames.every((f) => hasSprite(f));
  }
  return hasSprite(name);
}

// ---------------------------------------------------------------- definitions
describe('floor 1–3 boss definitions', () => {
  it('registers two bosses per floor with Korean names, titles, portraits and death fx', () => {
    for (const [id, b] of Object.entries(BOSSES)) {
      const d = Enemies.get(id);
      expect(d, id).toBeDefined();
      expect(d!.boss, id).toBe(true);
      expect(d!.bossFloors, id).toEqual([b.floor]);
      expect(d!.name, id).toMatch(/[가-힣]/);
      expect(d!.bossTitle, id).toMatch(/[가-힣]/);
      expect(d!.portrait, id).toBeTruthy();
      expect(hasSprite(d!.portrait!), `${id} portrait`).toBe(true);
      expect(spriteDefined(d!.sprite), `${id} sprite`).toBe(true);
      expect(d!.deathFx, id).toBeDefined();
      expect(d!.bloodColor, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(d!.script, id).toBeTypeOf('function');
      expect(d!.floors, `${id} must never spawn as a regular enemy`).toBeUndefined();
    }
    for (const floor of [1, 2, 3]) {
      const ids = Enemies.all().filter((e) => e.boss && e.bossFloors?.includes(floor) && BOSSES[e.id]).map((e) => e.id);
      expect(ids.length, `floor ${floor}`).toBe(2);
    }
  });

  it('every animation state exists for every phase variant (multi-frame idles)', () => {
    for (const [id, b] of Object.entries(BOSSES)) {
      for (const pre of b.prefixes) {
        for (const s of b.states) expect(spriteDefined(`${pre}_${s}`), `${id}: ${pre}_${s}`).toBe(true);
      }
      const idle = getAnim(`${b.prefixes[0]}_${b.states[0]}`);
      expect(idle?.frames.length ?? 0, `${id} idle frames`).toBeGreaterThanOrEqual(2);
    }
  });

  it('boss hp scales so fights last ~45–90 s on their floor', () => {
    // typical player dps on the boss's floor (base 26, ~1.6x by floor 2, ~2.5x by floor 3), ~60 % uptime
    const dps: Record<number, number> = { 1: 26 * 1.1, 2: 26 * 1.6, 3: 26 * 2.5 };
    for (const [id, b] of Object.entries(BOSSES)) {
      const d = Enemies.must(id);
      const mult = Floors.all().find((f) => f.index === b.floor)?.hpMult ?? 1;
      const seconds = (d.hp * mult) / (dps[b.floor] * 0.6);
      expect(seconds, id).toBeGreaterThan(38);
      expect(seconds, id).toBeLessThan(95);
    }
  });

  it('boss sources only reference defined sprites / animations', () => {
    const sources = import.meta.glob('../src/content/bosses/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const names = new Set<string>();
    for (const src of Object.values(sources)) {
      for (const m of src.matchAll(/(?:setAnim|r\.sprite|r\.anim)\('([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/sprite: '([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/portrait: '([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/anim: '([a-z0-9_]+)'/g)) names.add(m[1]);
    }
    expect(names.size).toBeGreaterThan(12);
    for (const n of names) expect(spriteDefined(n), n).toBe(true);
  });
});

// ---------------------------------------------------------------- pure helpers
describe('boss kit helpers', () => {
  it('phaseFor counts the thresholds crossed', () => {
    expect(phaseFor(1, [0.5])).toBe(0);
    expect(phaseFor(0.51, [0.5])).toBe(0);
    expect(phaseFor(0.5, [0.5])).toBe(1);
    expect(phaseFor(0.7, [0.6, 0.3])).toBe(0);
    expect(phaseFor(0.45, [0.6, 0.3])).toBe(1);
    expect(phaseFor(0.1, [0.6, 0.3])).toBe(2);
  });

  it('gapRing always leaves a real hole around each gap centre', () => {
    const rng = new RNG('gaps');
    for (let k = 0; k < 50; k++) {
      const count = rng.int(10, 30);
      const off = rng.angle();
      const g = rng.angle();
      const gaps = [g, g + Math.PI];
      const width = rng.range(0.7, 1.1);
      const angles = gapRing(count, off, gaps, width);
      expect(angles.length).toBeLessThan(count);
      for (const a of angles) for (const c of gaps) expect(Math.abs(angleDiff(a, c))).toBeGreaterThanOrEqual(width / 2 - 1e-9);
      // the opening is wide enough for the player (r≈5) between bullets (r=3) at 50 px
      const sorted = angles.map((a) => ((a % TAU) + TAU) % TAU).sort((x, y) => x - y);
      let widest = 0;
      for (let i = 0; i < sorted.length; i++) widest = Math.max(widest, ((sorted[(i + 1) % sorted.length] - sorted[i]) + TAU) % TAU);
      expect(widest * 50).toBeGreaterThan(2 * (5 + 3));
    }
    expect(inGap(0.1, [0], 0.5)).toBe(true);
    expect(inGap(0.3, [0], 0.5)).toBe(false);
    expect(inGap(TAU - 0.1, [0], 0.5)).toBe(true);
  });

  it('pickPattern respects availability and avoids immediate repeats', () => {
    const rng = new RNG('pick');
    for (let i = 0; i < 200; i++) {
      const id = pickPattern(rng, [{ id: 'a', w: 5 }, { id: 'b', w: 1 }, { id: 'c', w: 3, when: false }], 'a');
      expect(id).toBe('b');
    }
    expect(pickPattern(rng, [{ id: 'only', w: 1 }], 'only')).toBe('only');
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(pickPattern(rng, [{ id: 'x', w: 1 }, { id: 'y', w: 1 }, { id: 'z', w: 1 }], null));
    expect(seen.size).toBe(3);
  });

  it('Trail samples positions behind the head along the path', () => {
    const t = new Trail(100);
    for (let x = 0; x <= 60; x++) t.push(x, 0, 0, x > 20);
    expect(t.sample(0).x).toBeCloseTo(60);
    expect(t.sample(10).x).toBeCloseTo(50);
    expect(t.sample(30).up).toBe(true);
    expect(t.sample(50).up).toBe(false);
    // vertical rise counts as path length (a rearing neck forms a column)
    for (let z = 1; z <= 20; z++) t.push(60, 0, z, true);
    const s = t.sample(10);
    expect(s.x).toBeCloseTo(60);
    expect(s.z).toBeCloseTo(10);
    // trimmed to maxLen
    for (let x = 61; x < 400; x++) t.push(x, 0, 20, true);
    expect(t.sample(1000).x).toBeGreaterThan(250);
  });

  it('arcZ is a parabola peaking at h', () => {
    expect(arcZ(0, 40)).toBe(0);
    expect(arcZ(1, 40)).toBe(0);
    expect(arcZ(0.5, 40)).toBeCloseTo(40);
    expect(arcZ(0.25, 40)).toBeCloseTo(30);
  });
});

// ---------------------------------------------------------------- headless world
interface FakeWorld {
  w: World;
  entities: Entity[];
  hurts: number;
  warnTimes: number[];
}

function fakeWorld(seed: string): FakeWorld {
  const IX = 32;
  const IY = 32;
  const IW = 272;
  const IH = 144;
  const inside = (x: number, y: number, r: number) => x - r >= IX && y - r >= IY && x + r <= IX + IW && y + r <= IY + IH;
  const fw: FakeWorld = { w: null as unknown as World, entities: [], hurts: 0, warnTimes: [] };
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
  const player = {
    x: IX + IW / 2, y: IY + IH - 30, vx: 0, vy: 0, r: 5, z: 0, alive: true, invuln: 0, statuses: new Map(),
    hurt: () => { fw.hurts++; return true; },
    knock: () => {},
    hasStatus: () => false,
    stats: { damage: 10, critChance: 0, critMult: 1.8, bossDamage: 0 },
  };
  const enemies: Enemy[] = [];
  const w = {
    rng: new RNG(seed),
    dt: 1 / 60,
    time: 0,
    roomTime: 0,
    enemyTimeScale: 1,
    player,
    room,
    enemies,
    get entities() { return fw.entities; },
    get projectiles() { return fw.entities.filter((e) => e instanceof Projectile) as Projectile[]; },
    flow: { dirAt: () => null },
    particles: { burst: () => {}, spawn: () => {} },
    lights: { add: () => {}, glow: () => {} },
    renderer: { screenFlash: () => {}, kick: () => {} },
    spawn<T extends Entity>(e: T): T {
      fw.entities.push(e);
      if (e instanceof Enemy) enemies.push(e);
      if (e instanceof GroundWarning) fw.warnTimes.push(e.time);
      if (e instanceof Eruption) fw.warnTimes.push(e.warn);
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
    applyHit(target: Enemy, hit: { damage: number }) {
      if (!target.alive || !target.vulnerable || target.hidden) return false;
      const ok = target.takeHit(w as unknown as World, hit as never);
      if (ok && target.hp <= 0) w.killEnemy(target);
      return ok;
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
  return fw;
}

function step(fw: FakeWorld, seconds: number, onFrame?: (t: number) => void): void {
  const w = fw.w as unknown as { time: number; roomTime: number; dt: number; enemies: Enemy[]; player: { x: number; y: number } };
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) {
    w.time += w.dt;
    w.roomTime += w.dt;
    // the player strafes around the room so aimed attacks change direction
    w.player.x = 168 + Math.cos(w.time * 0.8) * 100;
    w.player.y = 104 + Math.sin(w.time * 1.1) * 50;
    for (const e of [...fw.entities]) if (!e.dead) e.update(fw.w, w.dt);
    for (const e of w.enemies) if (!e.dead && e.hp <= 0) fw.w.killEnemy(e);
    fw.entities = fw.entities.filter((e) => !e.dead);
    w.enemies.splice(0, w.enemies.length, ...w.enemies.filter((e) => !e.dead));
    onFrame?.(w.time);
  }
}

function danger(fw: FakeWorld): number {
  return fw.entities.filter((x) => !x.dead && (
    (x instanceof Projectile && x.team === 'enemy') || x instanceof GroundWarning || x instanceof Eruption || x instanceof Shockwave
    || x instanceof Lob || x instanceof Faller || x instanceof Hazard)).length;
}

// ---------------------------------------------------------------- simulations
describe('boss AI (headless simulation)', () => {
  for (const id of Object.keys(BOSSES)) {
    it(`${id}: attacks with telegraphs, changes phase, dies cleanly`, () => {
      const fw = fakeWorld(`boss-${id}`);
      const boss = fw.w.spawnEnemy(id, 168, 80)!;
      expect(boss).toBeTruthy();
      boss.dormant = 0;
      let maxDanger = 0;
      const checkBounds = () => {
        for (const e of fw.w.enemies) {
          expect(Number.isFinite(e.x) && Number.isFinite(e.y), `${e.def.id} position`).toBe(true);
          expect(e.x).toBeGreaterThan(0);
          expect(e.x).toBeLessThan(340);
          expect(e.y).toBeGreaterThan(-40);
          expect(e.y).toBeLessThan(210);
        }
      };
      step(fw, 20, () => {
        maxDanger = Math.max(maxDanger, danger(fw));
        checkBounds();
      });
      expect(maxDanger, `${id} produces telegraphed danger`).toBeGreaterThan(0);
      expect(boss.phase, `${id} stays in phase 1 at full hp`).toBe(0);
      expect(boss.alive).toBe(true);

      // drop below the phase threshold: a phase-change moment must follow
      boss.hp = boss.maxHp * 0.45;
      step(fw, 12, checkBounds);
      expect(boss.phase, `${id} enters phase 2`).toBeGreaterThanOrEqual(1);
      if (id === 'slime_queen') {
        boss.hp = boss.maxHp * 0.25;
        step(fw, 12, checkBounds);
        expect(boss.phase).toBe(2);
        expect(boss.r).toBeLessThan(Enemies.must(id).radius);
      }
      step(fw, 10, () => {
        maxDanger = Math.max(maxDanger, danger(fw));
        checkBounds();
      });

      // every area telegraph gives the player time to react
      expect(fw.warnTimes.length, `${id} uses ground warnings`).toBeGreaterThan(0);
      for (const t of fw.warnTimes) expect(t, `${id} warning time`).toBeGreaterThanOrEqual(0.3);

      // death: minions and body parts go with it, nothing throws afterwards
      boss.vulnerable = true;
      boss.hidden = false;
      fw.w.killEnemy(boss);
      // the arena is cleared with it: no posthumous bullets, eruptions or telegraphs
      expect(danger(fw), `${id} leaves no live attacks behind`).toBe(0);
      step(fw, 2);
      const leftovers = fw.w.enemies.filter((e) => e.alive && e.mem.owner === boss);
      expect(leftovers.length, `${id} minions dissolve`).toBe(0);
      expect(fw.entities.filter((e) => e instanceof ImugiPart && !e.dead).length).toBe(0);
    });
  }

  it('summoners keep their minion count bounded', () => {
    for (const id of ['bone_colossus', 'bell_keeper', 'spore_mother', 'slime_queen', 'chain_smith', 'slag_imugi']) {
      const fw = fakeWorld(`minions-${id}`);
      const boss = fw.w.spawnEnemy(id, 168, 80)!;
      boss.dormant = 0;
      boss.hp = boss.maxHp * 0.2;
      let most = 0;
      step(fw, 40, () => {
        most = Math.max(most, fw.w.enemies.filter((e) => e.alive && e.mem.owner === boss).length);
      });
      expect(most, id).toBeLessThanOrEqual(4);
    }
  });
});

// ---------------------------------------------------------------- mechanics
describe('boss mechanics', () => {
  it('shockwaves hurt only at the wavefront, never in a gap, never once faded', () => {
    const run = (px: number, py: number, gaps: number[], start = 4) => {
      const fw = fakeWorld('shock');
      const p = fw.w.player as unknown as { x: number; y: number };
      p.x = px;
      p.y = py;
      const s = new Shockwave(100, 100, { speed: 100, maxR: 100, color: '#ffffff', gaps, gapWidth: 1, source: 'test' });
      s.radius = start;
      fw.w.spawn(s);
      for (let i = 0; i < 120 && !s.dead; i++) s.update(fw.w, 1 / 60);
      return fw.hurts;
    };
    expect(run(150, 100, [])).toBe(1); // in the path
    expect(run(150, 100, [0])).toBe(0); // standing in the gap (angle 0)
    expect(run(100, 160, [0])).toBe(1); // outside the gap
    expect(run(199, 100, [])).toBe(0); // beyond 90 % of the max radius: faded, harmless
    expect(run(120, 100, [], 40)).toBe(0); // already inside the ring: it passed
  });

  it('eruptions only hurt once they erupt, and only nearby', () => {
    const fw = fakeWorld('erupt');
    const p = fw.w.player as unknown as { x: number; y: number };
    p.x = 100;
    p.y = 100;
    const e = fw.w.spawn(new Eruption(100, 100, 'fire', 0.5, { source: 'test' }));
    for (let i = 0; i < 25; i++) e.update(fw.w, 1 / 60);
    expect(fw.hurts).toBe(0);
    for (let i = 0; i < 20; i++) e.update(fw.w, 1 / 60);
    expect(fw.hurts).toBe(1);
    const fw2 = fakeWorld('erupt2');
    (fw2.w.player as unknown as { x: number }).x = 140;
    const e2 = fw2.w.spawn(new Eruption(100, 100, 'bone', 0.3, { source: 'test' }));
    for (let i = 0; i < 60; i++) e2.update(fw2.w, 1 / 60);
    expect(fw2.hurts).toBe(0);
  });

  it('a summon telegraphed before the boss fell does not appear afterwards', () => {
    const fw = fakeWorld('posthumous');
    const boss = fw.w.spawnEnemy('bell_keeper', 168, 80)!;
    expect(summonMinion(boss, fw.w, 'wailing_shade', 100, 100, ['#ffffff'])).toBeTruthy();
    fw.w.killEnemy(boss);
    expect(summonMinion(boss, fw.w, 'wailing_shade', 120, 100, ['#ffffff'])).toBeNull();
  });

  it('phase changes clear enemy bullets from the screen', () => {
    const fw = fakeWorld('clear');
    const boss = fw.w.spawnEnemy('bone_colossus', 168, 80)!;
    for (let i = 0; i < 10; i++) boss.shoot(fw.w, i, { speed: 50 });
    expect(fw.entities.filter((e) => e instanceof Projectile && !e.dead).length).toBe(10);
    clearEnemyShots(fw.w);
    expect(fw.entities.filter((e) => e instanceof Projectile && !e.dead).length).toBe(0);
  });

  it('imugi body segments forward damage to the head once per hit source', () => {
    const fw = fakeWorld('imugi-hit');
    const head = fw.w.spawnEnemy('slag_imugi', 168, 90)!;
    const parts = fw.entities.filter((e) => e instanceof ImugiPart) as ImugiPart[];
    expect(parts.length).toBeGreaterThanOrEqual(6);
    const up = parts.find((p) => p.up)!;
    expect(up, 'reared at spawn: some segments are above ground').toBeTruthy();
    const hp0 = head.hp;
    const src = new Projectile({ team: 'player', x: 0, y: 0, angle: 0, speed: 0, damage: 12 });
    expect(up.takeHit(fw.w, { damage: 12, kind: 'projectile', source: src })).toBe(true);
    expect(head.hp).toBeCloseTo(hp0 - 12);
    // the same source touching another segment in the same frame does not double-dip
    const other = parts.find((p) => p.up && p !== up);
    if (other) {
      other.takeHit(fw.w, { damage: 12, kind: 'projectile', source: src });
      expect(head.hp).toBeCloseTo(hp0 - 12);
    }
    // a blast that hits the head directly does not also count through the body this frame
    const hp1 = head.hp;
    (fw.w as unknown as { time: number }).time += 1;
    head.takeHit(fw.w, { damage: 20, kind: 'explosion' });
    up.takeHit(fw.w, { damage: 20, kind: 'explosion' });
    expect(head.hp).toBeCloseTo(hp1 - 20);
    // a buried segment cannot be hit
    const down = parts.find((p) => !p.up);
    if (down) expect(down.takeHit(fw.w, { damage: 12, kind: 'projectile' })).toBe(false);
  });
});
