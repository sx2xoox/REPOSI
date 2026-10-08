// 충전 유물 (charge arts, src/content/items/charge-arts.ts): 시위 밀랍, 숨 고르기, 독 깃, 낙뢰 깃털,
// 별똥 시위. Each works on the charge weapons (hold to charge: hunter bow, volley crossbow, titan
// greatsword; full-auto: silvermoon longbow, ember musket, glacier arbalest), does nothing on a plain
// ranged weapon, stacks sanely and sits in its rarity band on top of late builds (few seeds, short
// fights; the full numbers come from the same procedure with more seeds and longer fights).

import './headless';
import { describe, expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { World, type WorldHost } from '../src/game/world';
import { RunState } from '../src/game/run';
import { FIXED_DT } from '../src/game/constants';
import { Artifacts, RARITY_WEIGHT, Weapons } from '../src/game/defs';
import { HELD, fixedRules, type PlayerInput } from '../src/game/seam';
import { MeleeSwing } from '../src/game/melee';
import { Projectile } from '../src/game/projectile';
import { lookIsVisible } from '../src/game/look';
import { hasSprite } from '../src/engine/sprites';
import { RNG } from '../src/engine/rng';
import type { Enemy } from '../src/game/enemy';
import type { Entity, HitInfo } from '../src/game/entity';
import { DUMMY_ID, PLAIN_ID } from './dpsharness';
import {
  BOLT_DMG, BREATH_R, BREATH_SLOW, OVER_AMP, OVER_BLAST, OVER_SPLASH, VENOM_DPS, VENOM_T, WAX_BONUS, MeteorWave, overchargeTime,
} from '../src/content/items/charge-arts';

const IDS = ['bowstring_wax', 'steady_breath', 'venom_fletch', 'thunder_fletching', 'meteor_string'];
/** charge weapons that are held and released */
const HOLD = ['hunter_bow', 'volley_crossbow', 'titan_greatsword'];
/** charge weapons that fire by themselves the instant they are full */
const AUTO = ['silvermoon_longbow', 'ember_musket', 'glacier_arbalest'];
const CHARGE = [...HOLD, ...AUTO];
const host: WorldHost = { openInventory() {}, onGameOver() {} };
let renderer: Renderer | null = null;

const swings = (id: string) => { const d = Weapons.get(id); return !!d && (d.kind === 'melee' || id === 'titan_greatsword'); };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

interface Opts {
  weapon: string;
  artifacts?: string[];
  seconds?: number;
  seed?: string;
  crowd?: boolean;
  /**
   * how the keeper fires a charge weapon: 'full' releases the moment the charge is full (auto-firing
   * weapons: just hold), 'over' releases once 별똥 시위 has overcharged, 'half' releases at half charge,
   * 'hold' never lets go
   */
  policy?: 'full' | 'over' | 'half' | 'hold';
  /** a shooter behind the targets fires a 4-bullet fan at the keeper every `bullets` s */
  bullets?: number;
  /** keep this distance to the target (default 16 for swings, 70 for shots) */
  standoff?: number;
}

/** The real World on a training floor: a scripted keeper (base stats, no kit) fights immovable dummies. */
function fight(o: Opts): { w: World; dps: number; dummies: Enemy[]; shooter: Enemy | null } {
  if (!renderer) renderer = new Renderer(fakeDisplay(1280, 720));
  const run = new RunState(o.seed ?? `CHARGE-${o.weapon}`, PLAIN_ID);
  run.seeded = true;
  const w = new World(renderer, run, host);
  w.setQuality({ lighting: false, particles: 0 });
  w.rules = fixedRules({ hitStop: false });
  let dummies: Enemy[] = [];
  let shooter: Enemy | null = null;
  let shotT = o.bullets ?? 0;
  let held = false;
  let rest = 0;
  w.inputSource = (ww: World, _p: unknown, out: PlayerInput) => {
    const p = ww.player;
    out.mx = out.my = out.ax = out.ay = 0;
    out.held = 0;
    out.pressed = 0;
    const t = dummies[0];
    out.cx = t ? t.x : p.x + 40;
    out.cy = t ? t.y : p.y;
    if (!t) return;
    const dx = t.x - p.x;
    const dy = t.y - (p.y - 4);
    const d = Math.hypot(dx, dy) || 1;
    const want = o.standoff ?? (swings(p.weaponId) ? 16 : 70);
    if (d > want + 4) { out.mx = dx / d; out.my = dy / d; } else if (d < want - 4) { out.mx = -dx / d; out.my = -dy / d; }
    let firing = true;
    const pol = o.policy ?? 'full';
    if (Weapons.get(p.weaponId)?.kind === 'charge' && pol !== 'hold') {
      if (rest > 0) {
        rest -= FIXED_DT;
        firing = false;
      } else {
        const goal = pol === 'over' ? (ww.vars.__meteorReady ?? 0) > 0 : p.weapon.charge >= (pol === 'half' ? 0.5 : 1);
        if (held && goal) {
          firing = false;
          rest = FIXED_DT * 1.5;
          held = false;
        } else held = true;
      }
    }
    out.held = (firing ? HELD.fire : 0) | HELD.cursorAim;
    if (shooter && o.bullets) {
      shotT -= FIXED_DT;
      if (shotT <= 0) {
        shotT = o.bullets;
        for (const off of [-0.24, -0.08, 0.08, 0.24]) {
          const a = Math.atan2(p.y - 4 - shooter.y, p.x - shooter.x) + off;
          ww.spawn(new Projectile({ team: 'enemy', x: shooter.x - 10, y: shooter.y, angle: a, speed: 100, damage: 1, radius: 3, owner: shooter, range: 400 }));
        }
      }
    }
  };
  w.start();
  const p = w.player;
  for (const e of [...w.enemies]) w.killEnemy(e);
  if (p.weaponId !== o.weapon) p.equipWeapon(w, o.weapon);
  for (const id of o.artifacts ?? []) w.items.give(id);
  p.god = true;
  const cx = p.x + (swings(o.weapon) ? 40 : 70);
  const spots = o.crowd ? [[0, 0], [18, 0], [-18, 0], [0, 18], [0, -18]] : [[0, 0]];
  for (const [ox, oy] of spots) {
    const e = w.spawnEnemy(DUMMY_ID, cx + ox, p.y + oy);
    if (e) { e.dormant = 0; dummies.push(e); }
  }
  if (o.bullets) {
    shooter = w.spawnEnemy(DUMMY_ID, p.x + 110, p.y - 20);
    if (shooter) shooter.dormant = 0;
  }
  const all = [...dummies];
  const T = o.seconds ?? 6;
  for (let i = 0, n = Math.round(T / FIXED_DT); i < n; i++) {
    w.update(FIXED_DT);
    dummies = dummies.filter((e) => e.alive);
  }
  return { w, dps: w.run.stats.damageDealt / T, dummies: all, shooter };
}

/** dps with the artifacts (best of the policies) over dps without them (released at full) */
function gain(o: Opts, arts: string[], pols: ('full' | 'over')[] = ['full']): number {
  const base = fight({ ...o, policy: 'full' }).dps;
  return Math.max(...pols.map((policy) => fight({ ...o, policy, artifacts: [...(o.artifacts ?? []), ...arts] }).dps)) / base;
}

/** late builds of 10 visible artifacts (loot rarity weights), none of ours */
function lateBuilds(n: number): string[][] {
  const pool = Artifacts.all().filter((a) => !a.hidden && !a.blessing && !IDS.includes(a.id));
  const rng = new RNG('CHARGE-LATE');
  return Array.from({ length: n }, () => {
    const left = [...pool];
    const pick: string[] = [];
    for (let i = 0; i < 10 && left.length; i++) {
      const c = rng.weighted(left, (a) => RARITY_WEIGHT[a.rarity]);
      if (!c) break;
      pick.push(c.id);
      left.splice(left.indexOf(c), 1);
    }
    return pick;
  });
}

/** median over the charge weapons of the median late-build gain of `id` */
function lateGain(id: string, n = 4, pols: ('full' | 'over')[] = ['full']): number {
  const builds = lateBuilds(n);
  return median(CHARGE.map((weapon) => median(builds.map((b, i) => gain({ weapon, artifacts: b, seed: `L${i}-${weapon}` }, [id], pols)))));
}

/** run `fn` while recording every entity the world spawns */
function recording<T>(fn: () => T): { out: T; spawned: Entity[] } {
  const spawned: Entity[] = [];
  const orig = World.prototype.spawn;
  World.prototype.spawn = function <E extends Entity>(this: World, e: E): E {
    spawned.push(e);
    return orig.call(this, e) as E;
  };
  try {
    return { out: fn(), spawned };
  } finally {
    World.prototype.spawn = orig;
  }
}

const weaponShots = (spawned: Entity[]) => spawned.filter((e): e is Projectile => e instanceof Projectile && e.team === 'player' && e.fromWeapon && e.generation === 0);

/** every hit applied during a fight (the hit info after item bonuses) */
function hitsOf(o: Opts): { w: World; hits: HitInfo[] } {
  const hits: HitInfo[] = [];
  const orig = World.prototype.applyHit;
  World.prototype.applyHit = function (this: World, t, hit) {
    const ok = orig.call(this, t, hit);
    if (ok && t.team !== 'player') hits.push(hit);
    return ok;
  };
  try {
    return { w: fight(o).w, hits };
  } finally {
    World.prototype.applyHit = orig;
  }
}

describe('charge arts: definitions', () => {
  it('have Korean texts, icons, looks, tags and pools', { timeout: 60000 }, () => {
    const want: Record<string, [string, string]> = {
      bowstring_wax: ['common', 'venom'], steady_breath: ['rare', 'frost'], venom_fletch: ['rare', 'venom'],
      thunder_fletching: ['epic', 'storm'], meteor_string: ['legendary', 'star'],
    };
    for (const id of IDS) {
      const a = Artifacts.must(id);
      expect(a.name, id).toMatch(/[가-힣]/);
      expect(a.desc.length, id).toBeLessThanOrEqual(36);
      expect(a.desc, id).toMatch(/^충전 무기: /);
      expect(a.detail ?? '', id).toMatch(/[가-힣]/);
      expect(a.quote ?? '', id).toMatch(/[가-힣]/);
      expect(hasSprite(a.icon), id).toBe(true);
      expect(lookIsVisible(a.look), id).toBe(true);
      expect([a.rarity, ...a.tags], id).toEqual(want[id]);
      expect(a.pools.length, id).toBeGreaterThan(0);
    }
    expect(Artifacts.must('meteor_string').unique).toBe(true);
    for (const w of CHARGE) expect(Weapons.must(w).kind, w).toBe('charge');
  });
});

describe('charge arts: mechanics', () => {
  it('시위 밀랍 strengthens fully charged shots and spins only', { timeout: 60000 }, () => {
    for (const weapon of ['hunter_bow', 'volley_crossbow', 'ember_musket']) {
      const full = weaponShots(recording(() => fight({ weapon, seconds: 3, artifacts: ['bowstring_wax'] })).spawned);
      expect(full.length, weapon).toBeGreaterThan(1);
      for (const s of full) expect(Number(s.mem.amp ?? 0), weapon).toBeCloseTo(WAX_BONUS, 6);
      const two = weaponShots(recording(() => fight({ weapon, seconds: 2, artifacts: ['bowstring_wax', 'bowstring_wax'] })).spawned);
      expect(Number(two[0].mem.amp ?? 0), weapon).toBeCloseTo(2 * WAX_BONUS, 6);
    }
    // a half-drawn release gets nothing
    const half = weaponShots(recording(() => fight({ weapon: 'hunter_bow', seconds: 3, policy: 'half', artifacts: ['bowstring_wax'] })).spawned);
    expect(half.length).toBeGreaterThan(2);
    for (const s of half) expect(Number(s.mem.amp ?? 0)).toBe(0);
    // the greatsword's full spin
    const sw = recording(() => fight({ weapon: 'titan_greatsword', seconds: 3, artifacts: ['bowstring_wax'] })).spawned
      .filter((e): e is MeleeSwing => e instanceof MeleeSwing);
    expect(sw.length).toBeGreaterThan(0);
    for (const s of sw) expect(s.o.amp).toBeCloseTo(WAX_BONUS, 6);
    const { w } = fight({ weapon: 'hunter_bow', seconds: 2, artifacts: ['bowstring_wax'] });
    expect(w.items.lastProc('bowstring_wax')).toBeGreaterThan(0);
  });

  it('숨 고르기 lets out a frost breath when the charge fills: slows enemies and bullets near the keeper', { timeout: 60000 }, () => {
    const { w, dummies } = fight({ weapon: 'hunter_bow', seconds: 0.3, policy: 'hold', bullets: 0.4, artifacts: ['steady_breath'] });
    const p = w.player;
    // close the dummy in, then hold the draw until it fills
    const d = dummies[0];
    d.x = p.x + 40;
    d.y = p.y;
    let at = -1;
    for (let i = 0; i < 90 && at < 0; i++) {
      w.update(FIXED_DT);
      if ((w.vars.__breathEnd ?? 0) > w.time) at = w.time;
    }
    expect(at).toBeGreaterThan(0);
    expect(p.weapon.charge).toBe(1);
    expect(w.items.lastProc('steady_breath')).toBeGreaterThan(0);
    w.update(FIXED_DT);
    expect(d.hasStatus('slow')).toBe(true);
    expect(d.statuses.get('slow')!.power).toBeCloseTo(BREATH_SLOW, 6);
    // a bullet inside the field moves at half speed, one outside at full speed
    const inside = new Projectile({ team: 'enemy', x: p.x + 30, y: p.y - 6, angle: Math.PI, speed: 60, damage: 1, radius: 3, owner: null, range: 400 });
    const outside = new Projectile({ team: 'enemy', x: p.x + BREATH_R + 60, y: p.y - 6, angle: 0, speed: 60, damage: 1, radius: 3, owner: null, range: 400 });
    w.spawn(inside);
    w.spawn(outside);
    w.update(FIXED_DT);
    const x0 = inside.x;
    const o0 = outside.x;
    w.update(FIXED_DT);
    const k = w.floor?.shotSpeed ?? 1;
    expect(x0 - inside.x).toBeCloseTo(60 * FIXED_DT * k * (1 - BREATH_SLOW), 3);
    expect(outside.x - o0).toBeCloseTo(60 * FIXED_DT * k, 3);
    // once per 3 s, and the field ends
    for (let i = 0; i < 70; i++) w.update(FIXED_DT);
    expect((w.vars.__breathEnd ?? 0) <= w.time).toBe(true);
    // auto-firing weapons breathe at the shot that fills them
    const auto = fight({ weapon: 'ember_musket', seconds: 1.5, bullets: 0.5, artifacts: ['steady_breath'] });
    expect(auto.w.items.lastProc('steady_breath')).toBeGreaterThan(0);
    // no charge weapon, no breath
    const plain = fight({ weapon: 'lantern_bolt', seconds: 3, bullets: 0.5, artifacts: ['steady_breath'] });
    expect(plain.w.vars.__breathEnd ?? 0).toBe(0);
  });

  it('독 깃 poisons everything a charged release hits, by how full the charge was', { timeout: 60000 }, () => {
    const full = fight({ weapon: 'hunter_bow', seconds: 2.2, artifacts: ['venom_fletch'] });
    const dmg = full.w.player.stats.damage;
    const ps = full.dummies[0].statuses.get('poison');
    expect(ps).toBeTruthy();
    expect(ps!.power).toBeCloseTo(dmg * VENOM_DPS, 6);
    expect(full.w.items.lastProc('venom_fletch')).toBeGreaterThan(0);
    const half = fight({ weapon: 'hunter_bow', seconds: 2.2, policy: 'half', artifacts: ['venom_fletch'] });
    const hs = half.dummies[0].statuses.get('poison');
    expect(hs).toBeTruthy();
    expect(hs!.power).toBeGreaterThan(dmg * VENOM_DPS * 0.45);
    expect(hs!.power).toBeLessThan(dmg * VENOM_DPS * 0.6);
    // the shots carry the poison (with its own once-per-0.5 s key); copies lengthen it
    const shots = weaponShots(recording(() => fight({ weapon: 'volley_crossbow', seconds: 2, artifacts: ['venom_fletch', 'venom_fletch'] })).spawned);
    const v = shots[0].statuses.find((s) => s.procKey === 'item:venom_fletch:poison');
    expect(v?.duration).toBeCloseTo(VENOM_T * 1.5, 6);
    // a piercing full arrow poisons the whole line
    const crowd = fight({ weapon: 'hunter_bow', seconds: 2.2, crowd: true, artifacts: ['venom_fletch'] });
    expect(crowd.dummies.filter((e) => e.hasStatus('poison')).length).toBeGreaterThanOrEqual(3);
  });

  it('낙뢰 깃털 strikes once per fully charged attack and chains to two more', { timeout: 60000 }, () => {
    const { w, hits } = hitsOf({ weapon: 'hunter_bow', seconds: 4, crowd: true, artifacts: ['thunder_fletching'] });
    const d = w.player.stats.damage;
    const chain = hits.filter((h) => h.procs?.includes('chain'));
    const attacks = w.vars.__chgAtkN ?? 0;
    expect(attacks).toBeGreaterThanOrEqual(3);
    // bolt + 2 jumps per attack at most
    expect(chain.length).toBeGreaterThanOrEqual(attacks * 2);
    expect(chain.length).toBeLessThanOrEqual(attacks * 3);
    const bolts = chain.filter((h) => h.dirX === undefined || h.knockback === 0);
    for (const b of bolts) expect([d * BOLT_DMG, d * BOLT_DMG * w.player.stats.critMult].some((x) => Math.abs(b.damage - x) < 1e-6)).toBe(true);
    expect(w.items.lastProc('thunder_fletching')).toBeGreaterThan(0);
    // partial releases call nothing
    const half = hitsOf({ weapon: 'hunter_bow', seconds: 3, policy: 'half', artifacts: ['thunder_fletching'] });
    expect(half.hits.filter((h) => h.procs?.includes('chain')).length).toBe(0);
    // the greatsword's full spin calls it too
    const titan = hitsOf({ weapon: 'titan_greatsword', seconds: 3, artifacts: ['thunder_fletching'] });
    expect(titan.hits.filter((h) => h.procs?.includes('chain')).length).toBeGreaterThan(0);
  });

  it('별똥 시위 overcharges half a second past full: a big meteor that bursts', { timeout: 60000 }, () => {
    const { out, spawned } = recording(() => fight({ weapon: 'hunter_bow', seconds: 4, policy: 'over', artifacts: ['meteor_string'] }));
    const w = out.w;
    const shots = weaponShots(spawned);
    const meteors = shots.filter((s) => s.mem.metDmg);
    expect(meteors.length).toBeGreaterThanOrEqual(2);
    // the meteor keeps the full arrow's own pierce (no extra pierce: crowds stay under the cap)
    const fullPierce = weaponShots(recording(() => fight({ weapon: 'hunter_bow', seconds: 2 })).spawned)[0].pierce;
    for (const m of meteors) {
      expect(m.scale).toBe(2);
      expect(m.pierce).toBe(fullPierce);
      expect(Number(m.mem.amp ?? 0)).toBeCloseTo(OVER_AMP, 6);
      expect(m.mem.metBoom).toBe(1);
    }
    expect(w.items.lastProc('meteor_string')).toBeGreaterThan(0);
    // released right at full: ordinary shots
    const plain = weaponShots(recording(() => fight({ weapon: 'hunter_bow', seconds: 3, policy: 'full', artifacts: ['meteor_string'] })).spawned);
    expect(plain.length).toBeGreaterThan(2);
    expect(plain.filter((s) => s.mem.metDmg).length).toBe(0);
    // the overcharge takes OVER_T past full (scaled like the charge) and holding longer adds nothing
    const held = fight({ weapon: 'hunter_bow', seconds: 0.2, policy: 'hold', artifacts: ['meteor_string'] });
    const hw = held.w;
    let fullAt = -1;
    let readyAt = -1;
    for (let i = 0; i < 240; i++) {
      hw.update(FIXED_DT);
      if (fullAt < 0 && hw.player.weapon.charge >= 1) fullAt = hw.time;
      if (readyAt < 0 && (hw.vars.__meteorReady ?? 0) > 0) readyAt = hw.time;
    }
    expect(readyAt - fullAt).toBeCloseTo(overchargeTime(hw), 1);
    expect(hw.vars.__meteorReady).toBe(1);
    expect(hw.vars.__meteorHold).toBeCloseTo(overchargeTime(hw), 1);
    // the burst around the first hit: OVER_BLAST of the shot's damage on the struck enemy, OVER_SPLASH on the others
    const { w: cw, hits } = hitsOf({ weapon: 'hunter_bow', seconds: 4, policy: 'over', crowd: true, artifacts: ['meteor_string'] });
    const bursts = hits.filter((h) => h.procs?.includes('meteor'));
    expect(bursts.length).toBeGreaterThanOrEqual(5);
    const m0 = Number(meteors[0].mem.metDmg);
    const crit = cw.player.stats.critMult;
    const is = (h: HitInfo, k: number) => [1, crit].some((c) => Math.abs(h.damage - m0 * k * c) < 1e-6);
    expect(bursts.some((h) => is(h, OVER_BLAST))).toBe(true);
    expect(bursts.some((h) => is(h, OVER_SPLASH))).toBe(true);
    expect(bursts.every((h) => is(h, OVER_BLAST) || is(h, OVER_SPLASH))).toBe(true);
    expect(bursts.filter((h) => is(h, OVER_BLAST)).length * 4).toBeLessThanOrEqual(bursts.filter((h) => is(h, OVER_SPLASH)).length);
  });

  it('별똥 시위 makes auto-firing weapons wait, merges volleys and gives the greatsword a shockwave', { timeout: 60000 }, () => {
    // the musket holds its fire at full until overcharged, then fires by itself
    const { out, spawned } = recording(() => fight({ weapon: 'ember_musket', seconds: 4, policy: 'hold', artifacts: ['meteor_string'] }));
    const shots = weaponShots(spawned);
    expect(shots.length).toBeGreaterThanOrEqual(2);
    expect(shots.every((s) => s.mem.metDmg)).toBe(true);
    expect(out.w.items.lastProc('meteor_string')).toBeGreaterThan(0);
    // ... and lets go right at full when the trigger is released
    const quick = weaponShots(recording(() => fight({ weapon: 'ember_musket', seconds: 3, policy: 'full', artifacts: ['meteor_string'] })).spawned);
    expect(quick.length).toBeGreaterThanOrEqual(3);
    expect(quick.filter((s) => s.mem.metDmg).length).toBe(0);
    const base = weaponShots(recording(() => fight({ weapon: 'ember_musket', seconds: 3 })).spawned);
    expect(quick.length).toBeGreaterThanOrEqual(base.length - 1);
    // the volley's bolts merge into one meteor carrying all their damage
    const vol = weaponShots(recording(() => fight({ weapon: 'volley_crossbow', seconds: 3, policy: 'over', artifacts: ['meteor_string'] })).spawned);
    const live = vol.filter((s) => s.mem.metDmg);
    expect(live.length).toBeGreaterThan(0);
    expect(Number(live[0].mem.merged)).toBeGreaterThanOrEqual(4);
    expect(vol.filter((s) => s.damage === 0 && s.mem.chgO).length).toBeGreaterThanOrEqual(3);
    // the greatsword's overcharged spin sends out a star shockwave
    const titan = recording(() => fight({ weapon: 'titan_greatsword', seconds: 4, policy: 'over', artifacts: ['meteor_string'] })).spawned;
    expect(titan.filter((e) => e instanceof MeteorWave).length).toBeGreaterThanOrEqual(1);
  });
});

describe('charge arts: power budget', () => {
  it('does nothing on a plain ranged weapon (nor on melee or beam weapons)', { timeout: 60000 }, () => {
    for (const weapon of ['lantern_bolt', 'moon_katana', 'void_gaze']) {
      const base = fight({ weapon, seconds: 4 }).dps;
      expect(base, weapon).toBeGreaterThan(0);
      for (const id of IDS) expect(fight({ weapon, seconds: 4, artifacts: [id] }).dps / base, `${weapon} ${id}`).toBeCloseTo(1, 9);
    }
    // a shooter firing at the keeper: no breath, no slowed bullets either
    expect(fight({ weapon: 'lantern_bolt', bullets: 0.5, artifacts: ['steady_breath'] }).dps / fight({ weapon: 'lantern_bolt', bullets: 0.5 }).dps).toBeCloseTo(1, 9);
  });

  it('copies stack about linearly or less, crowds stay under the caps', { timeout: 60000 }, () => {
    const cases: [string, number][] = [['bowstring_wax', 1.5], ['venom_fletch', 1.8], ['thunder_fletching', 2.0]];
    for (const [id, cap] of cases) {
      const o = { weapon: 'hunter_bow' };
      const r1 = gain(o, [id]);
      const r3 = gain(o, [id, id, id]);
      expect(r1, id).toBeGreaterThan(1.02);
      expect(r3, id).toBeGreaterThan(r1);
      expect(r3 - 1, id).toBeLessThanOrEqual(3.15 * (r1 - 1) + 0.03);
      expect(gain({ ...o, crowd: true }, [id]), id).toBeLessThan(cap);
    }
    // the meteor is unique; its crowd value stays under the legendary cap on every charge weapon
    for (const weapon of CHARGE) {
      expect(gain({ weapon, crowd: true }, ['meteor_string'], ['full', 'over']), weapon).toBeLessThan(2.3);
    }
  });

  it('late-build gains sit in their rarity bands on the charge weapons', { timeout: 60000 }, () => {
    // bands: common 1.04-1.12, rare 1.08-1.16, epic 1.12-1.22, legendary 1.15-1.26 (few seeds -> small tolerance)
    const gains = {
      bowstring_wax: lateGain('bowstring_wax'),
      venom_fletch: lateGain('venom_fletch'),
      thunder_fletching: lateGain('thunder_fletching'),
      // the keeper overcharges every attack when that is better (it is on every charge weapon)
      meteor_string: lateGain('meteor_string', 4, ['full', 'over']),
    };
    const band: Record<string, [number, number]> = {
      bowstring_wax: [1.035, 1.13], venom_fletch: [1.07, 1.17], thunder_fletching: [1.11, 1.23], meteor_string: [1.14, 1.27],
    };
    if (process.env.CHARGE_GAINS) console.log(gains);
    for (const [id, g] of Object.entries(gains)) {
      expect(g, id).toBeGreaterThan(band[id][0]);
      expect(g, id).toBeLessThan(band[id][1]);
    }
  });
});
