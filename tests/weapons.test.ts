import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Artifacts, Characters, GlobalHooks, Weapons, type WeaponDef, type WeaponState } from '../src/game/defs';
import { Player, newWeaponState } from '../src/game/player';
import { Projectile } from '../src/game/projectile';
import { MeleeSwing, smearSprite } from '../src/game/melee';
import { BASE_STATS, StatMods, computeStats } from '../src/game/stats';
import { getAnim, hasAnim, hasSprite } from '../src/engine/sprites';
import { RNG } from '../src/engine/rng';
import type { Entity } from '../src/game/entity';
import type { World } from '../src/game/world';
import { validateSpec } from '../src/content/characters/look';
import { RIA } from '../src/content/characters/ria';
import { BERN } from '../src/content/characters/bern';
import { SERIN } from '../src/content/characters/serin';
import { NIEL } from '../src/content/characters/niel';
import { bossUnlocksNiel } from '../src/content/characters/unlocks';
import { bowDamageMult } from '../src/content/weapons/hunter-bow';
import { beamTickMult } from '../src/content/weapons/void-gaze';
import { bladeOutDistance } from '../src/content/weapons/return-blade';
import { maxOrbs } from '../src/content/weapons/void-orbs';
import { angleNorm, segDist } from '../src/content/weapons/common';

loadContent();

const PLAYABLE = ['ria', 'bern', 'serin', 'niel'];
const STARTERS = ['lantern_bolt', 'sentinel_blade', 'hunter_bow', 'void_gaze'];
const EXTRA = ['twin_daggers', 'iron_spear', 'great_hammer', 'return_blade', 'repeater_crossbow', 'flame_staff', 'chain_sickle', 'void_orbs'];

function spriteOrAnim(name: string): boolean {
  if (hasAnim(name)) {
    const a = getAnim(name)!;
    return a.frames.length > 0 && a.frames.every((f) => hasSprite(f));
  }
  return hasSprite(name);
}

describe('characters', () => {
  it('registers the four keepers with valid weapons, artifacts and releases', () => {
    for (const id of PLAYABLE) {
      const c = Characters.get(id);
      expect(c, id).toBeDefined();
      expect(Weapons.has(c!.weapon), `${id} weapon`).toBe(true);
      for (const a of c!.artifacts ?? []) expect(Artifacts.has(a), `${id} artifact ${a}`).toBe(true);
      expect(c!.release, `${id} release`).toBeTypeOf('function');
      expect(c!.releaseDesc?.length ?? 0, `${id} releaseDesc`).toBeGreaterThan(5);
      expect(c!.hearts).toBeGreaterThanOrEqual(2);
    }
  });

  it('has distinct stat profiles (tanky melee, fragile fast hunter)', () => {
    const bern = Characters.must('bern');
    const serin = Characters.must('serin');
    const ria = Characters.must('ria');
    expect(bern.hearts).toBeGreaterThan(ria.hearts);
    expect(bern.baseStats?.moveSpeed ?? 92).toBeLessThan(92);
    expect(serin.hearts).toBeLessThan(ria.hearts);
    expect(serin.baseStats?.moveSpeed ?? 92).toBeGreaterThan(92);
  });

  it('roster order on character select is 리아, 베른, 세린, 니엘', () => {
    expect(Characters.all().map((c) => c.id).filter((id) => PLAYABLE.includes(id))).toEqual(PLAYABLE);
    expect(Characters.all()[0].id).toBe('ria');
  });

  it('only 니엘 is locked, with an unlock hint', () => {
    expect(Characters.must('niel').unlocked).toBe(false);
    expect(Characters.must('niel').unlockHint?.length ?? 0).toBeGreaterThan(5);
    for (const id of ['ria', 'bern', 'serin']) expect(Characters.must(id).unlocked, id).toBe(true);
  });

  it('ASCII poses are well-formed', () => {
    for (const spec of [RIA, BERN, SERIN, NIEL]) expect(validateSpec(spec), spec.prefix).toEqual([]);
  });

  it('defines every animation the player renderer looks for', () => {
    for (const id of PLAYABLE) {
      const pre = Characters.must(id).spritePrefix;
      for (const f of ['down', 'up', 'side']) {
        expect(spriteOrAnim(`${pre}_idle_${f}`), `${pre}_idle_${f}`).toBe(true);
        expect(spriteOrAnim(`${pre}_walk_${f}`), `${pre}_walk_${f}`).toBe(true);
        expect(spriteOrAnim(`${pre}_dash_${f}`), `${pre}_dash_${f}`).toBe(true);
      }
      expect(spriteOrAnim(`${pre}_dash`)).toBe(true);
      expect(spriteOrAnim(`${pre}_hurt`)).toBe(true);
      expect(hasSprite(Characters.must(id).portrait)).toBe(true);
    }
  });

  it('unlock rule: floor 3+ boss, not minions, last boss standing', () => {
    expect(bossUnlocksNiel(3, true, false, 0)).toBe(true);
    expect(bossUnlocksNiel(5, true, false, 0)).toBe(true);
    expect(bossUnlocksNiel(2, true, false, 0)).toBe(false);
    expect(bossUnlocksNiel(3, false, false, 0)).toBe(false);
    expect(bossUnlocksNiel(3, true, true, 0)).toBe(false);
    expect(bossUnlocksNiel(3, true, false, 1)).toBe(false);
    expect(GlobalHooks.has('character_unlocks')).toBe(true);
    expect(GlobalHooks.has('boss_weapon_drop')).toBe(true);
  });
});

describe('weapon definitions', () => {
  it('has at least 8 weapons with art, Korean text and pools', () => {
    const all = Weapons.all();
    expect(all.length).toBeGreaterThanOrEqual(12);
    for (const id of [...STARTERS, ...EXTRA]) {
      const d = Weapons.get(id);
      expect(d, id).toBeDefined();
      expect(d!.name.length, id).toBeGreaterThan(1);
      expect(/[가-힣]/.test(d!.desc), `${id} desc is Korean`).toBe(true);
      expect(hasSprite(d!.icon), `${id} icon`).toBe(true);
      if (d!.heldSprite) expect(hasSprite(d!.heldSprite), `${id} held`).toBe(true);
      expect(['ranged', 'melee', 'charge', 'beam']).toContain(d!.kind);
    }
    for (const id of EXTRA) expect(Weapons.must(id).pools.length, id).toBeGreaterThan(0);
    // weapons can come out of the treasure and boss pools
    expect(all.filter((d) => d.pools.includes('treasure')).length).toBeGreaterThanOrEqual(6);
    expect(all.filter((d) => d.pools.includes('boss')).length).toBeGreaterThanOrEqual(4);
  });

  it('charge, beam, orbit and boomerang tuning curves are sane', () => {
    expect(bowDamageMult(0)).toBeCloseTo(bowDamageMult(0.12));
    expect(bowDamageMult(1)).toBeCloseTo(2.4);
    for (let c = 0.15; c <= 1; c += 0.05) expect(bowDamageMult(c)).toBeGreaterThan(bowDamageMult(c - 0.05) - 1e-9);
    expect(bowDamageMult(0.12)).toBeLessThan(0.75);
    expect(beamTickMult(0)).toBeLessThan(beamTickMult(1));
    expect(beamTickMult(5)).toBeCloseTo(beamTickMult(1));
    expect(bladeOutDistance(185)).toBeGreaterThan(60);
    expect(bladeOutDistance(10)).toBe(60);
    expect(maxOrbs(1)).toBe(3);
    expect(maxOrbs(99)).toBe(7);
  });

  it('geometry helpers', () => {
    expect(angleNorm(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(angleNorm(-Math.PI * 2.5)).toBeCloseTo(-Math.PI / 2);
    const s = segDist(5, 3, 0, 0, 10, 0);
    expect(s.d).toBeCloseTo(3);
    expect(s.t).toBeCloseTo(0.5);
    expect(segDist(-4, 0, 0, 0, 10, 0).d).toBeCloseTo(4);
  });

  it('smear sprites are bucketed and cached', () => {
    const a = smearSprite(27, 2.2, '#ffffff', 0);
    const b = smearSprite(28, 2.24, '#ffffff', 0);
    expect(a).toBe(b);
    expect(hasSprite(a)).toBe(true);
  });
});

// ---------------------------------------------------------------- headless weapon simulation
interface Sim {
  w: World;
  p: Player;
  st: WeaponState;
  events: string[];
  spawned: Entity[];
  hits: number;
}

function sim(def: WeaponDef, charId = 'ria'): Sim {
  const ch = Characters.must(charId);
  const p = new Player(ch);
  p.x = 120;
  p.y = 100;
  const m = new StatMods();
  def.stats?.(m);
  p.stats = computeStats({ ...BASE_STATS, ...(ch.baseStats ?? {}) }, m);
  p.weaponId = def.id;
  const s: Sim = { w: null as unknown as World, p, st: newWeaponState(), events: [], spawned: [], hits: 0 };
  const enemy = { alive: true, hidden: false, z: 0, x: 160, y: 95, r: 6, flash: 0, id: 999 };
  const w = {
    time: 0, dt: 1 / 60, rng: new RNG('weapons'), player: p, node: { id: 1, kind: 'normal' },
    enemies: [enemy], hittables: [], projectiles: [],
    room: {
      tileAt: () => 0, tileAtPx: () => 0, damageTile() {}, destroyTile() {},
      nearestFree: (x: number, y: number) => ({ x, y }), boxBlocked: () => false,
    },
    items: {
      onAttack: () => s.events.push('attack'),
      onShoot: () => s.events.push('shoot'),
      onDeflect() {},
    },
    sfx() {}, shake() {}, hitstop() {}, decal() {},
    renderer: { kick() {}, screenFlash() {} },
    particles: { burst() {}, spawn() {} },
    lights: { add() {}, glow() {} },
    spawn<T extends Entity>(e: T): T {
      s.spawned.push(e);
      if (e instanceof Projectile && !e.mem.orb) s.events.push('projectile');
      if (e instanceof MeleeSwing) s.events.push('swing');
      return e;
    },
    applyHit: () => {
      s.hits++;
      return true;
    },
  };
  s.w = w as unknown as World;
  return s;
}

function run(s: Sim, def: WeaponDef, seconds: number, firing: (t: number) => boolean): void {
  const w = s.w as unknown as { time: number };
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    w.time += dt;
    const st = s.st;
    st.cooldown -= dt;
    st.sinceAttack += dt;
    if (st.comboTimer > 0) st.comboTimer -= dt;
    else st.combo = 0;
    def.update(s.w, s.p, st, dt, firing(w.time), 0);
  }
}

describe('weapon behaviour (headless)', () => {
  for (const id of [...STARTERS, ...EXTRA]) {
    it(`${id}: attacks fire onAttack first and produce hits`, () => {
      const def = Weapons.must(id);
      const s = sim(def);
      if (def.kind === 'charge') {
        // hold for a full draw, then release; then two quick taps
        run(s, def, 1.0, () => true);
        expect(s.events.filter((e) => e === 'attack').length).toBe(0);
        run(s, def, 0.5, () => false);
        run(s, def, 0.1, () => true);
        run(s, def, 0.5, () => false);
        expect(s.events.filter((e) => e === 'attack').length).toBe(2);
      } else {
        run(s, def, 3, () => true);
      }
      const attacks = s.events.filter((e) => e === 'attack').length;
      expect(attacks, 'attacks').toBeGreaterThanOrEqual(1);
      // never more than ~2.5 attacks per fire-rate interval
      expect(attacks, 'attack spam').toBeLessThanOrEqual(Math.ceil(3 * s.p.stats.fireRate * 2.5) + 2);
      expect(s.events[0], 'onAttack comes first').toBe('attack');
      // (flung orbit orbs are re-used projectiles: they show up as onShoot)
      const outputs = s.events.filter((e) => e === 'projectile' || e === 'swing' || (id === 'void_orbs' && e === 'shoot')).length + s.hits;
      expect(outputs, 'attacks produce something').toBeGreaterThanOrEqual(attacks);
      // projectiles created by an attack trigger onShoot (except orbit orbs, which fire it on fling)
      const proj = s.events.filter((e) => e === 'projectile').length;
      const shots = s.events.filter((e) => e === 'shoot').length;
      if (id !== 'void_orbs') expect(shots).toBe(proj);
      else expect(shots).toBe(attacks);
    });
  }

  it('sentinel blade cycles a 3-hit combo with a heavier finisher', () => {
    const def = Weapons.must('sentinel_blade');
    const s = sim(def, 'bern');
    run(s, def, 1.6, () => true);
    const swings = s.spawned.filter((e): e is MeleeSwing => e instanceof MeleeSwing);
    expect(swings.length).toBeGreaterThanOrEqual(3);
    expect(swings[2].o.damage).toBeGreaterThan(swings[0].o.damage * 1.5);
    expect(swings[2].o.reach).toBeGreaterThan(swings[0].o.reach);
    expect(swings[0].o.swingDir).toBe(-swings[1].o.swingDir);
    expect(swings.every((sw) => sw.o.reflect)).toBe(true);
    // the finisher also throws a sword wave
    expect(s.spawned.some((e) => e instanceof Projectile)).toBe(true);
  });

  it('melee input is buffered: a click during the cooldown still attacks', () => {
    const def = Weapons.must('sentinel_blade');
    const s = sim(def, 'bern');
    run(s, def, 1 / 60, () => true); // first swing
    expect(s.events.filter((e) => e === 'attack').length).toBe(1);
    const cd = s.st.cooldown;
    expect(cd).toBeGreaterThan(0.12);
    run(s, def, cd - 0.1, () => false);
    run(s, def, 2 / 60, () => true); // quick click while still cooling down
    run(s, def, 0.25, () => false);
    expect(s.events.filter((e) => e === 'attack').length).toBe(2);
  });

  it('hunter bow: full draw is far stronger and pierces', () => {
    const def = Weapons.must('hunter_bow');
    const s = sim(def, 'serin');
    run(s, def, 0.05, () => true);
    run(s, def, 0.4, () => false);
    run(s, def, 1.2, () => true);
    run(s, def, 0.1, () => false);
    const arrows = s.spawned.filter((e): e is Projectile => e instanceof Projectile);
    expect(arrows.length).toBe(2);
    expect(arrows[1].damage).toBeGreaterThan(arrows[0].damage * 2.5);
    expect(arrows[1].pierce).toBeGreaterThan(arrows[0].pierce);
    expect(arrows[1].speed).toBeGreaterThan(arrows[0].speed);
  });

  it('void gaze ramps up while channeling', () => {
    const def = Weapons.must('void_gaze');
    const s = sim(def, 'niel');
    run(s, def, 0.5, () => true);
    const early = s.hits;
    run(s, def, 1.5, () => true);
    expect(early).toBeGreaterThan(0);
    expect(s.hits).toBeGreaterThan(early * 2);
  });
});
