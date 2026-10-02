// Expanded arsenal + two weapon slots: registry sanity, sprites, rarity spread,
// headless firing of every weapon against a dummy (with a tiny collision pass),
// a single-target DPS ladder by rarity, swap / pickup logic and the drop tables.

import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Characters, Weapons, type Rarity, type WeaponDef } from '../src/game/defs';
import { Player } from '../src/game/player';
import { Projectile } from '../src/game/projectile';
import { MeleeSwing } from '../src/game/melee';
import { BASE_STATS, StatMods, computeStats } from '../src/game/stats';
import { getAnim, hasAnim, hasSprite } from '../src/engine/sprites';
import { RNG } from '../src/engine/rng';
import type { Entity } from '../src/game/entity';
import type { World } from '../src/game/world';
import { equipWeapon, swapWeapons } from '../src/game/weaponslots';
import { WEAPON_RARITY_BY_FLOOR, pickWeapon, weaponPrice, weaponRarityWeights } from '../src/content/weapons/drops';
import { hornPellets } from '../src/content/weapons/casters';
import { volleyCapacity } from '../src/content/weapons/crossbows';
import { chainFalloff } from '../src/content/weapons/staves';
import { greatswordMult } from '../src/content/weapons/blades';
import { whipReach } from '../src/content/weapons/polearms';
import { GAME_BUTTONS } from '../src/ui/touch-logic';
import { DEFAULT_BINDINGS } from '../src/engine/input';

loadContent();

const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
/** weapons whose attack fires on release (hold = charge / load) */
const RELEASE = new Set(['hunter_bow', 'volley_crossbow', 'titan_greatsword']);

function spriteOk(name: string | undefined): boolean {
  if (!name) return false;
  if (hasAnim(name)) return getAnim(name)!.frames.every((f) => hasSprite(f));
  return hasSprite(name);
}

// ---------------------------------------------------------------- headless world
interface Sim {
  w: World;
  p: Player;
  events: string[];
  damage: number;
  entities: Entity[];
}

function makeSim(def: WeaponDef, enemyDist: number): Sim {
  const ch = Characters.must('ria');
  const p = new Player(ch);
  p.x = 120;
  p.y = 100;
  const base = { ...BASE_STATS, ...(ch.baseStats ?? {}) };
  const recompute = () => {
    const m = new StatMods();
    Weapons.get(p.weaponId)?.stats?.(m);
    p.stats = computeStats(base, m);
  };
  p.weaponId = def.id;
  recompute();
  const enemy = {
    id: 99999, alive: true, hidden: false, vulnerable: true, z: 0, x: p.x + enemyDist, y: p.y - 4, r: 8, flash: 0, team: 'enemy', flying: false, isBoss: false,
  };
  const s: Sim = { w: null as unknown as World, p, events: [], damage: 0, entities: [] };
  const w = {
    time: 0, dt: 1 / 60, rng: new RNG('weapons2'), player: p, node: { id: 1, kind: 'normal', seed: 1 }, flags: new Set<string>(),
    enemies: [enemy], hittables: [], projectiles: [] as Projectile[],
    room: {
      tileAt: () => 0, tileAtPx: () => 0, damageTile() {}, destroyTile() {}, centerX: 200, centerY: 100,
      nearestFree: (x: number, y: number) => ({ x, y }), boxBlocked: () => false,
    },
    items: {
      onAttack: () => s.events.push('attack'),
      onShoot: () => s.events.push('shoot'),
      onDeflect() {},
      recompute,
    },
    sfx() {}, shake() {}, hitstop() {}, decal() {}, floatText() {},
    clearEnemyBullets: () => 0,
    nearestEnemy: (x: number, y: number, max = Infinity, exclude?: Set<number>) => {
      const d = Math.hypot(enemy.x - x, enemy.y - y);
      return d <= max && !exclude?.has(enemy.id) ? enemy : null;
    },
    enemiesInRadius: (x: number, y: number, r: number) => (Math.hypot(enemy.x - x, enemy.y - y) < r + enemy.r ? [enemy] : []),
    renderer: { kick() {}, screenFlash() {} },
    particles: { burst() {}, spawn() {} },
    lights: { add() {}, glow() {} },
    spawn<T extends Entity>(e: T): T {
      s.entities.push(e);
      if (e instanceof Projectile) {
        w.projectiles.push(e);
        if (!e.mem.orb && e.fromWeapon) s.events.push('projectile');
      }
      if (e instanceof MeleeSwing) s.events.push('swing');
      return e;
    },
    applyHit: (_t: unknown, hit: { damage: number }) => {
      s.damage += hit.damage;
      s.events.push('hit');
      return true;
    },
  };
  s.w = w as unknown as World;
  return s;
}

/** Advance the sim: weapon update (like Player.update), entities, a tiny collision pass. */
function step(s: Sim, def: WeaponDef, dt: number, firing: boolean): void {
  const w = s.w as unknown as { time: number; enemies: { x: number; y: number; r: number; id: number }[]; projectiles: Projectile[] };
  w.time += dt;
  const p = s.p;
  const st = p.weapon;
  st.cooldown -= dt;
  st.sinceAttack += dt;
  if (st.comboTimer > 0) st.comboTimer -= dt;
  else st.combo = 0;
  // the player's own dash (katana iai) moves it like Player.update would
  if (p.dashT > 0) {
    p.dashT -= dt;
    p.x += p.dashDX * p.stats.dashSpeed * dt;
    p.y += p.dashDY * p.stats.dashSpeed * dt;
    // after the dash the player turns around and re-engages from the same spot
    if (p.dashT <= 0) {
      p.x = 120;
      p.y = 100;
    }
  } else def.update(s.w, p, st, dt, firing, 0);
  for (const e of [...s.entities]) if (!e.dead) e.update(s.w, dt);
  const enemy = w.enemies[0];
  for (const pr of w.projectiles) {
    if (pr.dead || pr.delay > 0 || pr.team !== 'player' || pr.hitIds.has(enemy.id)) continue;
    const rr = pr.r + enemy.r;
    if ((pr.x - enemy.x) ** 2 + (pr.y - enemy.y) ** 2 < rr * rr) pr.hitActor(s.w, enemy as never);
  }
  s.entities = s.entities.filter((e) => !e.dead);
  w.projectiles = w.projectiles.filter((e) => !e.dead);
}

/** Fire for `seconds` (release weapons: hold for a full draw, release, repeat). */
function fight(def: WeaponDef, enemyDist: number, seconds: number): Sim {
  const s = makeSim(def, enemyDist);
  const dt = 1 / 60;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    let firing = true;
    if (RELEASE.has(def.id)) {
      const t = (i * dt) % 1.1;
      firing = t < 0.95;
    }
    step(s, def, dt, firing);
  }
  return s;
}

/** Best single-target DPS over a near (melee) and a mid (ranged) dummy. */
function dps(def: WeaponDef): number {
  const T = 8;
  return Math.max(fight(def, 22, T).damage, fight(def, 70, T).damage) / T;
}

// ---------------------------------------------------------------- registry
describe('arsenal registry', () => {
  const all = Weapons.all();
  it('has at least 36 weapons with unique ids and names', () => {
    expect(all.length).toBeGreaterThanOrEqual(36);
    expect(new Set(all.map((d) => d.id)).size).toBe(all.length);
    expect(new Set(all.map((d) => d.name)).size).toBe(all.length);
  });

  it('every weapon has a 16x16-ish icon, a held sprite, Korean text and a pool', () => {
    for (const d of all) {
      expect(spriteOk(d.icon), `${d.id} icon`).toBe(true);
      expect(spriteOk(d.heldSprite), `${d.id} held`).toBe(true);
      expect(/[가-힣]/.test(d.name), `${d.id} name`).toBe(true);
      expect(d.desc.length, `${d.id} desc`).toBeGreaterThan(10);
      expect(d.pools.length, `${d.id} pools`).toBeGreaterThan(0);
      expect(typeof d.update).toBe('function');
    }
  });

  it('spreads across rarity tiers', () => {
    const by = (r: Rarity) => all.filter((d) => d.rarity === r).length;
    expect(by('common')).toBeGreaterThanOrEqual(8);
    expect(by('rare')).toBeGreaterThanOrEqual(10);
    expect(by('epic')).toBeGreaterThanOrEqual(6);
    expect(by('legendary')).toBeGreaterThanOrEqual(3);
  });

  it('covers many archetypes (labels on the new weapons)', () => {
    const labels = new Set(all.map((d) => d.archetype).filter(Boolean));
    expect(labels.size).toBeGreaterThanOrEqual(24);
  });
});

// ---------------------------------------------------------------- firing
describe('every weapon fires (headless)', () => {
  for (const def of Weapons.all()) {
    it(`${def.id}: onAttack first, attacks produce damage`, () => {
      const s = fight(def, def.kind === 'melee' || def.id === 'titan_greatsword' ? 22 : 70, 4);
      const attacks = s.events.filter((e) => e === 'attack').length;
      expect(attacks, 'attacks').toBeGreaterThanOrEqual(1);
      expect(s.events[0], 'onAttack comes first').toBe('attack');
      expect(attacks, 'attack spam').toBeLessThanOrEqual(Math.ceil(4 * s.p.stats.fireRate * 2.5) + 2);
      expect(s.damage, 'damage').toBeGreaterThan(0);
      if (def.id !== 'void_orbs') {
        const proj = s.events.filter((e) => e === 'projectile').length;
        const shots = s.events.filter((e) => e === 'shoot').length;
        expect(shots, 'onShoot per weapon projectile').toBe(proj);
      }
    });
  }
});

describe('balance ladder (single-target DPS vs the starter lantern)', () => {
  const base = dps(Weapons.must('lantern_bolt'));
  const table = Weapons.all().map((d) => ({ id: d.id, rarity: d.rarity, k: dps(d) / base }));
  const mean = (r: Rarity) => {
    const l = table.filter((t) => t.rarity === r);
    return l.reduce((a, t) => a + t.k, 0) / l.length;
  };
  // Weapon power is compressed on purpose (the keeper's kit carries the identity;
  // see tests/characters-kit.test.ts for the real-world bands): tiers still step
  // up, but gently. This fake-world ladder only guards against gross outliers.
  it('tiers step up gently: common < legendary', () => {
    // printed for tuning
    console.log(table.sort((a, b) => RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity) || a.k - b.k).map((t) => `${t.rarity.padEnd(9)} ${t.id.padEnd(20)} ${t.k.toFixed(2)}`).join('\n'));
    const m = RARITIES.map(mean);
    console.log('tier means', m.map((v) => v.toFixed(2)).join(' / '));
    expect(m[0]).toBeLessThan(m[3]);
    expect(m[0]).toBeGreaterThan(0.7);
    expect(m[0]).toBeLessThan(1.3);
    expect(m[3]).toBeGreaterThan(0.9);
    expect(m[3]).toBeLessThan(1.8);
  });
  it('no weapon is useless or absurd', () => {
    for (const t of table) {
      expect(t.k, t.id).toBeGreaterThan(0.45);
      expect(t.k, t.id).toBeLessThan(2.0);
    }
  });
});

describe('tuning helpers', () => {
  it('scale with stats', () => {
    expect(hornPellets(1)).toBe(5);
    expect(hornPellets(2)).toBe(7);
    expect(volleyCapacity(1)).toBe(4);
    expect(volleyCapacity(3)).toBe(6);
    expect(chainFalloff(0)).toBe(1);
    expect(chainFalloff(2)).toBeLessThan(chainFalloff(1));
    expect(greatswordMult(1)).toBeCloseTo(3);
    expect(greatswordMult(0)).toBeCloseTo(1.2);
    expect(whipReach(185)).toBeGreaterThan(60);
  });
});

// ---------------------------------------------------------------- two slots
describe('two weapon slots', () => {
  function slotSim(): Sim {
    const s = makeSim(Weapons.must('lantern_bolt'), 70);
    return s;
  }

  it('picking up fills the empty slot first, then replaces the held weapon', () => {
    const s = slotSim();
    const { p, w } = s;
    expect(p.weapon2Id).toBe(null);
    const firstState = p.weapon;
    firstState.mem.marker = 7;
    expect(equipWeapon(w, p, 'titan_greatsword')).toBe(null);
    expect(p.weaponId).toBe('titan_greatsword');
    expect(p.weapon2Id).toBe('lantern_bolt');
    expect(p.weapon2).toBe(firstState);
    // weapon stats follow the held weapon only
    expect(p.stats.damage).toBeCloseTo(BASE_STATS.damage * 1.6);
    // both full: the held weapon is dropped
    expect(equipWeapon(w, p, 'moon_katana')).toBe('titan_greatsword');
    expect(p.weaponId).toBe('moon_katana');
    expect(p.weapon2Id).toBe('lantern_bolt');
  });

  it('swapping exchanges ids and keeps each weapon state', () => {
    const s = slotSim();
    const { p, w } = s;
    equipWeapon(w, p, 'scatter_horn');
    const horn = p.weapon;
    horn.mem.tag = 1;
    horn.cooldown = 0.5;
    const lantern = p.weapon2;
    lantern.mem.tag = 2;
    (w as unknown as { time: number }).time = 5;
    expect(swapWeapons(w, p)).toBe(true);
    expect(p.weaponId).toBe('lantern_bolt');
    expect(p.weapon2Id).toBe('scatter_horn');
    expect(p.weapon.mem.tag).toBe(2);
    expect(p.weapon2.mem.tag).toBe(1);
    expect(p.stats.fireRate).toBeCloseTo(BASE_STATS.fireRate);
    // spam guard, then swap back
    expect(swapWeapons(w, p)).toBe(false);
    (w as unknown as { time: number }).time = 6;
    expect(swapWeapons(w, p)).toBe(true);
    expect(p.weaponId).toBe('scatter_horn');
    expect(p.weapon).toBe(horn);
    expect(p.stats.fireRate).toBeCloseTo(BASE_STATS.fireRate * 0.55);
  });

  it('cannot swap with an empty second slot; a draw is cancelled when holstered', () => {
    const s = slotSim();
    const { p, w } = s;
    expect(swapWeapons(w, p)).toBe(false);
    equipWeapon(w, p, 'titan_greatsword');
    p.weapon.mem.drawing = 1;
    p.weapon.charge = 0.8;
    (w as unknown as { time: number }).time = 9;
    swapWeapons(w, p);
    expect(p.weapon2.mem.drawing).toBe(0);
    expect(p.weapon2.charge).toBe(0);
  });

  it('has a swap binding (C + wheel, pad R3) and a touch button', () => {
    expect(DEFAULT_BINDINGS.swap).toContain('KeyC');
    expect(DEFAULT_BINDINGS.swap).toContain('Wheel');
    expect(GAME_BUTTONS).toContain('swap');
  });
});

// ---------------------------------------------------------------- drops
describe('weapon drops', () => {
  const rank = (id: string) => RARITIES.indexOf(Weapons.must(id).rarity);
  it('rarity odds shift toward stronger weapons on deeper floors', () => {
    const avg = (floor: number) => {
      const rng = new RNG(`drops${floor}`);
      let sum = 0;
      for (let i = 0; i < 400; i++) sum += rank(pickWeapon(rng, floor, 0, [], new Set())!);
      return sum / 400;
    };
    expect(avg(1)).toBeLessThan(avg(3));
    expect(avg(3)).toBeLessThan(avg(5));
    for (let f = 1; f <= 5; f++) {
      const t = WEAPON_RARITY_BY_FLOOR[f];
      expect(t.common + t.rare + t.epic + t.legendary).toBe(100);
    }
    expect(weaponRarityWeights(1, 5).legendary).toBeGreaterThan(weaponRarityWeights(1, 0).legendary);
  });

  it('is deterministic per seed and never offers held weapons', () => {
    const a = new RNG('same');
    const b = new RNG('same');
    for (let i = 0; i < 20; i++) expect(pickWeapon(a, 2, 0, ['twin_lamp', 'frost_wand'], new Set())).toBe(pickWeapon(b, 2, 0, ['twin_lamp', 'frost_wand'], new Set()));
    const rng = new RNG('held');
    for (let i = 0; i < 200; i++) {
      const id = pickWeapon(rng, 1, 0, ['twin_lamp', 'frost_wand'], new Set());
      expect(id).not.toBe('twin_lamp');
      expect(id).not.toBe('frost_wand');
    }
  });

  it('prices weapons by rarity', () => {
    const ps = RARITIES.map(weaponPrice);
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThan(ps[i - 1]);
  });
});
