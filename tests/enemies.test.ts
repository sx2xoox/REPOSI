import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Enemies } from '../src/game/defs';
import { Enemy } from '../src/game/enemy';
import { Entity } from '../src/game/entity';
import { GroundWarning } from '../src/game/effects';
import { getAnim, hasAnim, hasSprite } from '../src/engine/sprites';
import { RNG } from '../src/engine/rng';
import type { World } from '../src/game/world';
import { appliedDamage, isFrontalHit, rayFree, stepToward, volleyTargets } from '../src/content/enemies/shared';

loadContent();

/** Regular enemies owned by the floors 1–3 enemy workstream. */
const FLOOR_ENEMIES: Record<string, number[]> = {
  gloom_fly: [1, 2],
  bone_walker: [1],
  crypt_bat: [1],
  grave_rat: [1],
  rat_nest: [1],
  cursed_candle: [1],
  wailing_shade: [1, 2],
  urn_mimic: [1, 2],
  bell_ringer: [1],
  bone_archer: [1],
  grave_robber: [1],
  spore_shroom: [2],
  cave_slime: [2],
  slimeling: [2],
  spore_pod: [2],
  dust_moth: [2],
  cave_leech: [2],
  gas_bloater: [2],
  tongue_toad: [2],
  pill_beetle: [2],
  fungus_ant: [2],
  fire_imp: [3],
  forge_sentinel: [3],
  bellows_turret: [3],
  ember_wisp: [3],
  ember_mote: [3],
  chain_hound: [3],
  slag_golem: [3],
  slag_lump: [3],
  anvil_mortar: [3],
  welder_automaton: [3],
  powder_porter: [3],
  hammer_tinker: [3],
};

function spriteDefined(name: string): boolean {
  if (hasAnim(name)) {
    const a = getAnim(name)!;
    return a.frames.length > 0 && a.frames.every((f) => hasSprite(f));
  }
  return hasSprite(name);
}

describe('enemy definitions', () => {
  it('all floor 1–3 enemies are registered with the expected floors', () => {
    for (const [id, floors] of Object.entries(FLOOR_ENEMIES)) {
      const d = Enemies.get(id);
      expect(d, id).toBeDefined();
      expect(d!.floors, id).toEqual(floors);
      expect(d!.boss, id).toBeFalsy();
    }
  });

  it('every regular enemy has a defined sprite / animation and floors in 1..10', () => {
    for (const d of Enemies.all()) {
      if (d.boss) continue;
      expect(spriteDefined(d.sprite), `${d.id} sprite "${d.sprite}"`).toBe(true);
      if (FLOOR_ENEMIES[d.id]) expect(d.floors?.length, d.id).toBeGreaterThan(0);
      for (const f of d.floors ?? []) {
        expect(Number.isInteger(f), d.id).toBe(true);
        expect(f, d.id).toBeGreaterThanOrEqual(1);
        expect(f, d.id).toBeLessThanOrEqual(10);
      }
    }
  });

  it('has a varied pool of at least 6 regular enemies on each of floors 1–3', () => {
    for (const floor of [1, 2, 3]) {
      const pool = Enemies.all().filter((d) => !d.boss && d.floors?.includes(floor));
      expect(pool.length, `floor ${floor}`).toBeGreaterThanOrEqual(6);
    }
    expect(Object.keys(FLOOR_ENEMIES).length).toBeGreaterThanOrEqual(17);
  });

  it('every animation / sprite name referenced by enemy scripts exists', () => {
    const sources = import.meta.glob('../src/content/enemies/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(4);
    const names = new Set<string>();
    for (const src of Object.values(sources)) {
      for (const m of src.matchAll(/setAnim\('([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/r\.sprite\('([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/sprite: '([a-z0-9_]+)'/g)) names.add(m[1]);
    }
    // dynamic names built from template strings
    for (const v of [0, 1]) for (const st of ['pot', 'peek', 'chomp', 'hop']) names.add(`urnmimic_${st}${v}`);
    for (const pre of ['cslime', 'slimelet']) for (const st of ['idle', 'crouch', 'air']) names.add(`${pre}_${st}`);
    for (const n of ['fsentinel_shield_face', 'fsentinel_shield_hot', 'fsentinel_shield_back', 'fsentinel_shield_side']) names.add(n);
    expect(names.size).toBeGreaterThan(40);
    for (const n of names) expect(spriteDefined(n), n).toBe(true);
  });

  it('stats follow the balance guide', () => {
    for (const id of Object.keys(FLOOR_ENEMIES)) {
      const d = Enemies.must(id);
      expect(d.hp, id).toBeGreaterThanOrEqual(5);
      expect(d.hp, id).toBeLessThanOrEqual(120);
      expect(d.cost ?? 1, id).toBeGreaterThan(0);
      expect(d.cost ?? 1, id).toBeLessThanOrEqual(4);
      expect(d.speed ?? 40, id).toBeLessThan(92); // never outruns the player
      expect(d.contactDamage ?? 1, id).toBeLessThanOrEqual(2);
      expect(d.radius, id).toBeGreaterThan(2);
      expect(d.deathFx, id).toBeDefined();
      expect(d.bloodColor, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(d.script, id).toBeTypeOf('function');
    }
  });
});

describe('enemy helpers', () => {
  it('isFrontalHit detects hits coming at the facing side', () => {
    // facing right (+x): a shot travelling left (-x) hits the front
    expect(isFrontalHit(0, -1, 0)).toBe(true);
    // travelling right hits the back
    expect(isFrontalHit(0, 1, 0)).toBe(false);
    // from the side (travelling down)
    expect(isFrontalHit(0, 0, 1)).toBe(false);
    // facing down, shot travelling up
    expect(isFrontalHit(Math.PI / 2, 0, -1)).toBe(true);
    // unknown direction never blocks
    expect(isFrontalHit(0, undefined, undefined)).toBe(false);
    expect(isFrontalHit(0, 0, 0)).toBe(false);
  });

  it('appliedDamage mirrors status multipliers', () => {
    expect(appliedDamage({ damage: 10, kind: 'projectile' }, false, false)).toBe(10);
    expect(appliedDamage({ damage: 10, kind: 'projectile' }, true, false)).toBeCloseTo(13.5);
    expect(appliedDamage({ damage: 10, kind: 'projectile' }, false, true)).toBeCloseTo(12);
    expect(appliedDamage({ damage: 10, kind: 'status' }, false, true)).toBe(10);
  });

  it('rayFree stops in front of walls', () => {
    const room = { boxBlocked: (x: number, _y: number, r: number) => x + r > 100 };
    expect(rayFree(room, 0, 0, 0, 4, 300)).toBeLessThanOrEqual(96);
    expect(rayFree(room, 0, 0, 0, 4, 300)).toBeGreaterThan(88);
    expect(rayFree(room, 0, 0, Math.PI, 4, 50)).toBe(50);
  });

  it('volleyTargets spreads shots across the firing line, exact target first', () => {
    const pts = volleyTargets(0, 0, 100, 0, 3, 30);
    expect(pts).toHaveLength(3);
    expect(pts[0].x).toBeCloseTo(100);
    expect(pts[0].y).toBeCloseTo(0);
    const ys = pts.map((p) => Math.round(p.y)).sort((a, b) => a - b);
    expect(ys).toEqual([-30, 0, 30]);
    for (const p of pts) expect(p.x).toBeCloseTo(100);
  });

  it('stepToward never overshoots', () => {
    expect(stepToward(0, 0, 10, 0, 50)).toEqual({ x: 10, y: 0 });
    const s = stepToward(0, 0, 100, 0, 40);
    expect(s.x).toBeCloseTo(40);
  });
});

// ---------------------------------------------------------------- headless AI simulation
interface FakeWorld {
  w: World;
  entities: Entity[];
  hurts: number;
  explosions: number;
}

function fakeWorld(seed: string): FakeWorld {
  const IX = 32;
  const IY = 32;
  const IW = 272;
  const IH = 144;
  const inside = (x: number, y: number, r: number) => x - r >= IX && y - r >= IY && x + r <= IX + IW && y + r <= IY + IH;
  const fw: FakeWorld = { w: null as unknown as World, entities: [], hurts: 0, explosions: 0 };
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
    x: IX + IW / 2, y: IY + IH - 30, vx: 0, vy: 0, r: 5, z: 0, alive: true, statuses: new Map(),
    hurt: () => { fw.hurts++; return true; },
    knock: () => {},
    hasStatus: () => false,
    // grave_robber's traps slow the keeper
    applyStatus: () => true,
  };
  const enemies: Enemy[] = [];
  const w = {
    rng: new RNG(seed),
    dt: 1 / 60,
    time: 0,
    roomTime: 0,
    enemyTimeScale: 1,
    player,
    targets: () => [player],
    room,
    enemies,
    get entities() { return fw.entities; },
    flow: { dirAt: () => null },
    particles: { burst: () => {}, spawn: () => {} },
    lights: { add: () => {}, glow: () => {} },
    spawn<T extends Entity>(e: T): T {
      fw.entities.push(e);
      if (e instanceof Enemy) enemies.push(e);
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
    explode: () => { fw.explosions++; },
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
    // the player strafes around so aimed attacks change direction
    w.player.x = 168 + Math.cos(w.time * 0.8) * 90;
    w.player.y = 104 + Math.sin(w.time * 1.1) * 45;
    for (const e of [...fw.entities]) if (!e.dead) e.update(fw.w, w.dt);
    for (const e of w.enemies) if (!e.dead && e.hp <= 0) fw.w.killEnemy(e);
    fw.entities = fw.entities.filter((e) => !e.dead);
    w.enemies.splice(0, w.enemies.length, ...w.enemies.filter((e) => !e.dead));
    onFrame?.(w.time);
  }
}

describe('enemy AI (headless simulation)', () => {
  for (const id of Object.keys(FLOOR_ENEMIES)) {
    it(`${id} runs its script for 12s without errors and stays in the room`, () => {
      const fw = fakeWorld(`sim-${id}`);
      const e = fw.w.spawnEnemy(id, 120, 70)!;
      expect(e).toBeTruthy();
      step(fw, 12, () => {
        for (const o of fw.w.enemies) {
          expect(Number.isFinite(o.x) && Number.isFinite(o.y), `${o.def.id} position`).toBe(true);
          expect(o.x).toBeGreaterThan(0);
          expect(o.y).toBeGreaterThan(0);
          expect(o.x).toBeLessThan(400);
          expect(o.y).toBeLessThan(260);
        }
      });
      // it must be able to die (and its death hooks must not throw)
      if (e.alive) {
        e.vulnerable = true;
        e.hidden = false;
        fw.w.killEnemy(e);
      }
      step(fw, 1.5);
    });
  }

  it('attackers produce telegraphed danger (bullets, lobs, ground warnings) within 12s', () => {
    // contact-only fodder and the summoner are exempt
    const passive = new Set(['rat_nest', 'grave_rat', 'gloom_fly', 'ember_mote']);
    for (const id of Object.keys(FLOOR_ENEMIES)) {
      if (passive.has(id)) continue;
      const fw = fakeWorld(`danger-${id}`);
      fw.w.spawnEnemy(id, 120, 70);
      let dangerous = 0;
      step(fw, 12, () => {
        dangerous = Math.max(
          dangerous,
          fw.entities.filter((x) => (x.team === 'enemy' && !(x instanceof Enemy)) || x instanceof GroundWarning || (x instanceof Enemy && x.mem.mode === 'fling')).length,
        );
      });
      expect(dangerous, id).toBeGreaterThan(0);
    }
  });

  it('cave slime splits into two slimelings, slag golem into two lumps', () => {
    for (const [id, child] of [['cave_slime', 'slimeling'], ['slag_golem', 'slag_lump']] as const) {
      const fw = fakeWorld(`split-${id}`);
      const e = fw.w.spawnEnemy(id, 150, 90)!;
      step(fw, 0.5);
      fw.w.killEnemy(e);
      expect(fw.w.enemies.filter((o) => o.def.id === child && !o.dead).length, id).toBe(2);
    }
  });

  it('rat nest spawns at most three rats', () => {
    const fw = fakeWorld('nest');
    fw.w.spawnEnemy('rat_nest', 150, 90);
    step(fw, 20);
    expect(fw.w.enemies.filter((o) => o.def.id === 'grave_rat').length).toBeLessThanOrEqual(3);
    expect(fw.w.enemies.filter((o) => o.def.id === 'grave_rat').length).toBeGreaterThan(0);
  });

  it('ember wisp keeps orbiting motes; they are released when it dies', () => {
    const fw = fakeWorld('wisp');
    const wisp = fw.w.spawnEnemy('ember_wisp', 150, 90)!;
    step(fw, 1);
    const motes = () => fw.w.enemies.filter((o) => o.def.id === 'ember_mote' && !o.dead);
    expect(motes().length).toBe(4);
    for (const m of motes()) expect(m.mem.owner).toBe(wisp);
    fw.w.killEnemy(wisp);
    step(fw, 4);
    expect(motes().length).toBe(0); // orphaned motes burn out
  });

  it('forge sentinel blocks most frontal damage but not hits from behind', () => {
    const fw = fakeWorld('sentinel');
    const e = fw.w.spawnEnemy('forge_sentinel', 150, 90)!;
    e.mem.shieldA = 0; // shield faces +x
    e.mem.lock = true;
    const hp0 = e.hp;
    e.takeHit(fw.w, { damage: 20, kind: 'projectile', dirX: -1, dirY: 0 });
    expect(hp0 - e.hp).toBeCloseTo(3, 5);
    const hp1 = e.hp;
    e.takeHit(fw.w, { damage: 20, kind: 'projectile', dirX: 1, dirY: 0 });
    expect(hp1 - e.hp).toBeCloseTo(20, 5);
  });

  it('urn mimic stays disguised until provoked, then becomes harmful', () => {
    const fw = fakeWorld('mimic');
    const m = fw.w.spawnEnemy('urn_mimic', 60, 50)!;
    fw.w.spawnEnemy('rat_nest', 280, 60); // another enemy so it does not wake up from being alone
    (fw.w.player as { x: number }).x = 280;
    m.dormant = 0;
    m.update(fw.w, 1 / 60);
    expect(m.mem.disguised).toBe(true);
    expect(m.harmful).toBe(false);
    m.takeHit(fw.w, { damage: 1, kind: 'projectile', dirX: 1, dirY: 0 });
    let wasHarmful = false;
    for (let i = 0; i < 90; i++) {
      m.update(fw.w, 1 / 60);
      if (m.harmful) wasHarmful = true;
    }
    expect(m.mem.disguised).toBe(false);
    expect(wasHarmful).toBe(true);
  });

  it('spore shroom is untouchable while burrowed', () => {
    const fw = fakeWorld('shroom');
    const e = fw.w.spawnEnemy('spore_shroom', 150, 90)!;
    expect(e.hidden).toBe(true);
    expect(e.vulnerable).toBe(false);
    expect(e.takeHit(fw.w, { damage: 5, kind: 'projectile' })).toBe(false);
    let surfaced = false;
    step(fw, 4, () => {
      if (!e.hidden && e.vulnerable) surfaced = true;
    });
    expect(surfaced).toBe(true);
  });

  it('gas bloater explodes near the player (or when popped)', () => {
    const fw = fakeWorld('bloater');
    const e = fw.w.spawnEnemy('gas_bloater', 150, 90)!;
    step(fw, 12);
    const popped = fakeWorld('bloater2');
    const b = popped.w.spawnEnemy('gas_bloater', 60, 50)!;
    popped.w.killEnemy(b);
    step(popped, 1);
    expect(fw.explosions + popped.explosions).toBeGreaterThan(0);
    expect(popped.explosions).toBe(1);
    void e;
  });
});
