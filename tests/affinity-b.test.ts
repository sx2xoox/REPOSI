// 선호 무기 (CharacterDef.affinity) for 보리 / 백구 / 모리: the favoured class is made of weapon
// families only (game/weapon-families.ts) and named after them, so the green family label on a
// weapon's info line tells the player what counts; the 'affinity' flag follows weapon swaps, and
// the bonus upgrades each keeper's own kit instead of adding flat damage:
//   보리 둔기·도끼 / 방패 — the body block's wall stands longer and wider and shoves harder, and
//     every weapon hit pours a little into the rescue barrel (by the hit's size)
//   백구 단검 / 투척      — wider perfect-dodge window, wider bullet return, a second crossing
//     counter slash, a longer and stronger 반격 (x1.5 -> x1.62)
//   모리 지팡이           — a third sheep, faster headbutts, and a headbutted enemy counts as
//     herded even alone (the +25 % herd bonus reaches bosses and stragglers)
// The gain is checked against a clone of the keeper without the affinity, on short runs:
// training dummies for 모리 (single target), a bullet duel for 백구 (perfect dodges on a
// clock) and a short boss drill (boss-bench bot, real hearts: fight time and hearts lost net
// of healing) for 보리 and 백구. The full measurement (416 boss fights per weapon and variant,
// four favoured weapons each, against +20 % / +25 % damage references; dummies with mid
// builds for 모리) is in the commit message.

import './headless';
import { fakeDisplay } from './headless';
import { describe, expect, it } from 'vitest';
import { Artifacts, Characters, Enemies, RARITY_WEIGHT, Weapons, defineCharacter, weaponMatchesAffinity } from '../src/game/defs';
import { RNG } from '../src/engine/rng';
import { Renderer } from '../src/engine/renderer';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { FIXED_DT } from '../src/game/constants';
import { StatMods } from '../src/game/stats';
import { HELD, PRESS, fixedRules, type PlayerInput } from '../src/game/seam';
import { Projectile } from '../src/game/projectile';
import type { Enemy } from '../src/game/enemy';
import {
  BORI_BLOCK_RADIUS, BORI_BLOCK_RADIUS_AFFINITY, BORI_BLOCK_TIME, BORI_BLOCK_TIME_AFFINITY, BORI_SHOVE_DMG, BORI_SHOVE_DMG_AFFINITY,
  BodyBlock, barrel,
} from '../src/content/characters/kit-bori';
import {
  BAEKGU_COUNTER_DMG, BAEKGU_COUNTER_DMG_AFFINITY, BAEKGU_COUNTER_TIME, BAEKGU_COUNTER_TIME_AFFINITY, BAEKGU_REFLECT_RADIUS, BAEKGU_REFLECT_RADIUS_AFFINITY,
  BAEKGU_STRIKE2_DELAY, BAEKGU_STRIKE2_DMG, counterThrows, inCounter,
} from '../src/content/characters/kit-baekgu';
import { MORI_GROUP_BONUS, MORI_MARK_TIME, MORI_SHEEP, MORI_SHEEP_AFFINITY, SpiritSheep, isHerded, isMarked } from '../src/content/characters/kit-mori';
import { familiarsOf } from '../src/content/items/lib';
import { WEAPON_FAMILIES, familyMembers, weaponFamily } from '../src/game/weapon-families';
import { measureDps } from './dpsharness';

const HANGUL = /[가-힣]/;
const KEEPERS = ['bori', 'baekgu', 'mori'] as const;

/**
 * The favoured class of each keeper: its families, its name (the family labels), every matching
 * weapon in the game, and weapons that must not match (the old tag / id members among them:
 * a heavy-tagged greatsword or censer, a katana, a staff-named wand no longer count).
 */
const CLASS: Record<(typeof KEEPERS)[number], { families: string[]; name: string; yes: string[]; no: string[] }> = {
  bori: {
    families: ['heavy', 'shield'],
    name: '둔기·도끼 / 방패',
    yes: ['great_hammer', 'quake_mace', 'cathedral_mace', 'gatebreaker_maul', 'anchor_axe', 'lantern_flail', 'reaper_scythe', 'mirror_buckler', 'aegis_cannon'],
    no: ['lantern_bolt', 'fang_blade', 'shepherd_crook', 'hunter_bow', 'copper_sabre', 'iron_spear', 'titan_greatsword', 'obsidian_cleaver', 'smoke_censer', 'saw_launcher', 'chain_sickle'],
  },
  baekgu: {
    families: ['dagger', 'thrown'],
    name: '단검 / 투척',
    yes: ['fang_blade', 'twin_daggers', 'throwing_knives', 'dusk_knives', 'pinwheel_boomerang', 'ricochet_chakram', 'return_blade', 'spin_top_yoyo'],
    no: ['lantern_bolt', 'sentinel_blade', 'copper_sabre', 'great_hammer', 'shepherd_crook', 'moon_katana', 'chain_sickle', 'badminton_racket', 'gale_fan'],
  },
  mori: {
    families: ['staff'],
    name: '지팡이',
    yes: ['shepherd_crook', 'flame_staff', 'meteor_staff', 'constellation_staff', 'crystal_gatling', 'dragon_breath', 'prism_staff', 'thunder_rod'],
    no: ['lantern_bolt', 'frost_wand', 'hunter_bow', 'fang_blade', 'lantern_flail', 'amber_wand', 'tide_staff', 'cinder_sceptre', 'stormhorn_rod', 'ink_brush'],
  },
};
/** a weapon that counted before the families (by tag or id) and no longer does */
const OLD_MEMBER: Record<(typeof KEEPERS)[number], string> = { bori: 'titan_greatsword', baekgu: 'moon_katana', mori: 'amber_wand' };

/** The same keeper with no favoured class (the baseline every gain is measured against). */
function noAff(id: string): string {
  const nid = `__noaff_${id}`;
  if (!Characters.has(nid)) defineCharacter({ ...Characters.must(id), id: nid, affinity: undefined, unlocked: false });
  return nid;
}

/** A started world (floor-1 start room, dummies placed) with no input yet, and its center dummy. */
function sim(character: string, weapon: string, dist?: number, crowd = false): { w: World; dummy: Enemy } {
  const r = measureDps({ character, weapon, seconds: 0, dist, crowd });
  return { w: r.world, dummy: r.dummies[0] };
}

/** Step `steps` frames feeding `fn`'s input. */
function drive(w: World, steps: number, fn: (out: PlayerInput, i: number) => void = () => {}): void {
  let step = 0;
  w.inputSource = (_ww, _p, out) => {
    out.mx = out.my = out.ax = out.ay = 0;
    out.held = 0;
    out.pressed = 0;
    out.cx = w.player.x + 40;
    out.cy = w.player.y;
    fn(out, step);
  };
  for (; step < steps; step++) w.update(FIXED_DT);
}

/** An enemy bullet flying from (x, y) toward the keeper (or along `angle`). */
function bulletAt(w: World, x: number, y: number, speed = 150, angle?: number): Projectile {
  const p = w.player;
  const pr = new Projectile({ team: 'enemy', x, y, angle: angle ?? Math.atan2(p.y - 4 - y, p.x - x), speed, damage: 1, radius: 3, range: 600 });
  w.spawn(pr);
  return pr;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** `n` builds of 6 distinct visible artifacts drawn with the loot rarity weights (as tests/item-audit). */
function midBuilds(seed: string, n: number): string[][] {
  const pool = Artifacts.all().filter((a) => !a.hidden && !a.blessing);
  const rng = new RNG(seed);
  return Array.from({ length: n }, () => {
    const left = [...pool];
    return Array.from({ length: 6 }, () => {
      const c = rng.weighted(left, (a) => RARITY_WEIGHT[a.rarity as keyof typeof RARITY_WEIGHT])!;
      left.splice(left.indexOf(c), 1);
      return c.id;
    });
  });
}

/**
 * Training dummy plus a bullet at the keeper on a clock (speeds and directions cycle): the bot
 * closes in and attacks, and dashes sideways when a bullet comes within 20 px (like the
 * boss-bench bot). Returns damage dealt per second and the perfect dodges.
 */
function bulletDrill(character: string, weapon: string, o: { seconds: number; every: number }): { dps: number; dodges: number } {
  const { w, dummy } = sim(character, weapon);
  const p = w.player;
  p.god = false;
  w.playerDied = () => { p.red = p.maxRed; };
  const melee = Weapons.must(weapon).kind === 'melee';
  const speeds = [120, 160, 200];
  let dodges = 0;
  let lastDodge = -1;
  w.inputSource = (ww, _p, out) => {
    out.mx = out.my = out.ax = out.ay = 0;
    out.held = HELD.fire | HELD.cursorAim;
    out.pressed = 0;
    out.cx = dummy.x;
    out.cy = dummy.y;
    const dx = dummy.x - p.x;
    const dy = dummy.y - (p.y - 4);
    const d = Math.hypot(dx, dy) || 1;
    if (d > (melee ? 16 : 70) + 4) { out.mx = dx / d; out.my = dy / d; }
    for (const q of ww.projectiles) {
      if (q.dead || q.team !== 'enemy') continue;
      const qx = p.x - q.x;
      const qy = p.y - q.y;
      const qd = Math.hypot(qx, qy);
      if (qd < 34 && q.vx * qx + q.vy * qy > 0) {
        const sp = Math.hypot(q.vx, q.vy) || 1;
        out.mx = -q.vy / sp;
        out.my = q.vx / sp;
        if (qd < 20) out.pressed |= PRESS.dash;
        break;
      }
    }
  };
  const d0 = w.run.stats.damageDealt;
  let next = 0.6;
  let n = 0;
  const steps = Math.round(o.seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    if (w.time >= next) {
      next += o.every;
      const a = (n * 2.39996) % (Math.PI * 2);
      const sx = p.x + Math.cos(a) * 64;
      const sy = p.y - 4 + Math.sin(a) * 64;
      w.spawn(new Projectile({ team: 'enemy', x: sx, y: sy, angle: Math.atan2(p.y - 4 - sy, p.x - sx), speed: speeds[n % speeds.length], damage: 1, radius: 3, range: 400 }));
      n++;
    }
    w.update(FIXED_DT);
    const at = w.vars.__bgDodgeAt ?? -1;
    if (at !== lastDodge && at >= 0) { dodges++; lastDodge = at; }
  }
  return { dps: (w.run.stats.damageDealt - d0) / o.seconds, dodges };
}

/** the bosses of floors 1–4 (the boss drill fights each on its own floor) */
const DRILL_BOSSES = ['bell_keeper', 'bone_colossus', 'slime_queen', 'spore_mother', 'chain_smith', 'slag_imugi', 'frost_saint', 'frost_commander'];
/** floor -> damage scale for the boss drill (a stand-in for a build growing floor by floor) */
const DRILL_POWER: Record<number, number> = { 1: 1.5, 2: 2.1, 3: 3, 4: 4.2, 5: 5.4, 6: 8.25, 7: 9.75 };
let drillRenderer: Renderer | null = null;

/**
 * `character` with its base damage x `k`: the drill's build stands in as real keeper damage, so
 * effects sized by the hit (hitShare: 보리's barrel, ember, procs) see hits of their natural size.
 * (Scaling hit.damage inside applyHit instead would make every hit look up to 2x "bigger".)
 */
function powered(character: string, k: number): string {
  const nid = `${character}__x${k}`;
  if (!Characters.has(nid)) {
    const c = Characters.must(character);
    defineCharacter({ ...c, id: nid, unlocked: false, baseStats: { ...(c.baseStats ?? {}), damage: (c.baseStats?.damage ?? 10) * k } });
  }
  return nid;
}

/**
 * One boss fight on its floor under the boss-bench bot (strafes, closes in with a melee weapon,
 * dashes off bullets), with the keeper's real hearts: a death refills them. Returns the fight
 * time and the hearts lost net of healing (½♥ units).
 */
function bossDrill(bossId: string, character: string, weapon: string, seed: string): { time: number; net: number; killed: boolean } {
  if (!drillRenderer) drillRenderer = new Renderer(fakeDisplay(1280, 720));
  const def = Enemies.must(bossId);
  const floor = def.bossFloors![0];
  const run = new RunState(`${seed}-${bossId}`, powered(character, DRILL_POWER[floor]));
  run.seeded = true;
  const w = new World(drillRenderer, run, { openInventory() {}, onGameOver() {} });
  w.setQuality({ lighting: false, particles: 0 });
  w.rules = fixedRules({ hitStop: false });
  const melee = Weapons.must(weapon).kind === 'melee';
  const strafe = { dir: 1, t: 0 };
  w.inputSource = (ww: World, _p: unknown, out: PlayerInput) => {
    const p = ww.player;
    out.mx = out.my = out.ax = out.ay = 0;
    out.held = 0;
    out.pressed = 0;
    out.cx = p.x + 30;
    out.cy = p.y;
    let t: Enemy | null = null;
    let bd = Infinity;
    for (const e of ww.enemies) {
      if (!e.alive || e.hidden || !e.vulnerable) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y) - (e.mem.ward ? 400 : 0);
      if (d < bd) { bd = d; t = e; }
    }
    if (!t) return;
    const boss0 = ww.enemies.find((e) => e.isBoss && e.alive);
    strafe.t -= FIXED_DT;
    if (strafe.t <= 0) { strafe.dir = -strafe.dir; strafe.t = 0.8 + ((ww.time * 7) % 1) * 0.8; }
    const dx = t.x - p.x;
    const dy = t.y - (p.y - 4);
    const d = Math.hypot(dx, dy) || 1;
    const close = boss0?.def.id === 'mumyeong' ? 50 : melee ? 30 : 70;
    const want = d < close ? -1 : d > close + (melee ? 20 : 50) ? 1 : 0;
    let mx = (dx / d) * want - (dy / d) * strafe.dir;
    let my = (dy / d) * want + (dx / d) * strafe.dir;
    for (const q of ww.projectiles) {
      if (q.dead || q.team !== 'enemy') continue;
      const qx = p.x - q.x;
      const qy = p.y - q.y;
      const qd = Math.hypot(qx, qy);
      if (qd < 34 && q.vx * qx + q.vy * qy > 0) {
        const sp = Math.hypot(q.vx, q.vy) || 1;
        mx += (-q.vy / sp) * 1.5;
        my += (q.vx / sp) * 1.5;
        if (qd < 20) out.pressed |= PRESS.dash;
        break;
      }
    }
    const ml = Math.hypot(mx, my);
    if (ml > 1e-6) { out.mx = mx / ml; out.my = my / ml; }
    out.held = (boss0?.mem.wdMirror === 2 ? 0 : HELD.fire) | HELD.cursorAim;
    out.cx = t.x;
    out.cy = t.y - 4;
  };
  w.start();
  if (floor > 1) w.startFloor(floor);
  const p = w.player;
  if (p.weaponId !== weapon) p.equipWeapon(w, weapon);
  const node = w.map.nodes.find((n) => n.kind === 'boss')!;
  const orig = w.spawnEnemy.bind(w);
  w.spawnEnemy = (id: string, x: number, y: number) => orig(Enemies.get(id)?.boss ? bossId : id, x, y);
  w.enterRoom(node, null);
  w.spawnEnemy = orig;
  let healed = 0;
  const heal = p.heal.bind(p);
  p.heal = (k: number) => { const h = heal(k); healed += h; return h; };
  w.playerDied = () => { p.red = p.maxRed; };
  w.update(FIXED_DT);
  const boss = w.enemies.find((e) => e.isBoss)!;
  const taken0 = w.run.stats.damageTaken;
  let i = 0;
  for (; i < Math.round(150 / FIXED_DT) && boss.alive; i++) w.update(FIXED_DT);
  return { time: i * FIXED_DT, net: w.run.stats.damageTaken - taken0 - healed, killed: !boss.alive };
}

/** The boss drill over a few bosses and seeds: (fight time, net hearts lost) ratios, no class / class. */
function drillGain(id: string, weapon: string, bosses: string[], seeds: string[]): { ttk: number; net: number } {
  const sum = { a: { t: 0, n: 0 }, b: { t: 0, n: 0 } };
  for (const boss of bosses) {
    for (const s of seeds) {
      const a = bossDrill(boss, id, weapon, s);
      const b = bossDrill(boss, noAff(id), weapon, s);
      sum.a.t += a.time; sum.a.n += a.net;
      sum.b.t += b.time; sum.b.n += b.net;
    }
  }
  return { ttk: sum.b.t / sum.a.t, net: sum.b.n / Math.max(1, sum.a.n) };
}

// ====================================================================== the favoured classes
describe('favoured weapon classes (보리 / 백구 / 모리)', () => {
  it('each class is made of weapon families only, named after them, and holds the starter', () => {
    for (const id of KEEPERS) {
      const c = Characters.must(id);
      const aff = c.affinity!;
      expect(aff, id).toBeDefined();
      // families only: no stray kinds / tags / ids that the family label would not show
      expect(aff.families, id).toEqual(CLASS[id].families);
      expect(aff.kinds, id).toBeUndefined();
      expect(aff.tags, id).toBeUndefined();
      expect(aff.ids, id).toBeUndefined();
      // the class name is the family labels, as the weapon info line prints them
      const labels = CLASS[id].families.map((f) => WEAPON_FAMILIES.find((x) => x.id === f)!.name);
      expect(aff.name, id).toBe(CLASS[id].name);
      expect(aff.name, id).toBe(labels.join(' / '));
      expect(aff.desc).toMatch(HANGUL);
      // the character select shows two lines of it (186 px of the small font, ~22 characters a line;
      // checked in the browser 2026-10-08): a longer text loses its end there
      expect(aff.desc.length, `${id} desc`).toBeLessThanOrEqual(46);
      // every favoured weapon shows one of the class's family labels
      for (const wid of CLASS[id].yes) expect(labels, `${id} / ${wid}`).toContain(weaponFamily(wid)?.name);
      expect([...CLASS[id].yes].sort(), id).toEqual(CLASS[id].families.flatMap((f) => [...familyMembers(f)]).sort());
      expect(weaponFamily(c.weapon) && CLASS[id].families.includes(weaponFamily(c.weapon)!.id), `${id} starter's family`).toBe(true);
      // flavour stats only (knockback, move speed): never damage or attack speed
      const m = new StatMods();
      aff.stats?.(m);
      for (const k of ['damage', 'fireRate', 'critChance', 'critMult'] as const) {
        expect(m.mul[k], `${id} ${k}`).toBeUndefined();
        expect(m.add[k], `${id} ${k}`).toBeUndefined();
      }
      expect(weaponMatchesAffinity(aff, Weapons.must(c.weapon)), `${id} starter`).toBe(true);
      const all = Weapons.all().filter((wd) => weaponMatchesAffinity(aff, wd)).map((wd) => wd.id).sort();
      expect(all, id).toEqual([...CLASS[id].yes].sort());
      for (const wid of CLASS[id].no) expect(weaponMatchesAffinity(aff, Weapons.must(wid)), `${id} / ${wid}`).toBe(false);
    }
  });

  it('the flag follows the held weapon: on with the starter, off after a swap, back on', () => {
    for (const id of KEEPERS) {
      const c = Characters.must(id);
      const { w } = sim(id, c.weapon);
      const p = w.player;
      expect(p.flags.has('affinity'), `${id} starter`).toBe(true);
      expect(w.items.affinityActive).toBe(true);
      p.equipWeapon(w, 'lantern_bolt');
      drive(w, 1);
      expect(p.flags.has('affinity'), `${id} lantern`).toBe(false);
      // a weapon of every family in the class turns it on; an old tag / id member turns it off
      for (const f of CLASS[id].families) {
        const wid = familyMembers(f).find((x) => x !== c.weapon)!;
        p.equipWeapon(w, wid);
        drive(w, 1);
        expect(p.flags.has('affinity'), `${id} ${wid} (${f})`).toBe(true);
        p.equipWeapon(w, OLD_MEMBER[id]);
        drive(w, 1);
        expect(p.flags.has('affinity'), `${id} ${OLD_MEMBER[id]}`).toBe(false);
      }
      // the second slot: a plain weapon in hand, the starter holstered; the swap key flips the flag
      p.equipWeapon(w, 'lantern_bolt');
      drive(w, Math.round(0.2 / FIXED_DT));
      expect(p.weapon2Id, id).toBe(c.weapon);
      expect(p.flags.has('affinity'), `${id} lantern, starter in slot 2`).toBe(false);
      expect(p.swapWeapon(w), id).toBe(true);
      drive(w, 1);
      expect(p.flags.has('affinity'), `${id} swapped to the starter`).toBe(true);
      drive(w, Math.round(0.2 / FIXED_DT));
      expect(p.swapWeapon(w), id).toBe(true);
      drive(w, 1);
      expect(p.flags.has('affinity'), `${id} swapped back to the lantern`).toBe(false);
      // never a flat damage bonus: the weapon hits exactly as hard as on the keeper without a class
      const plain = sim(noAff(id), c.weapon).w.player;
      const own = sim(id, c.weapon).w.player;
      expect(own.weaponStats.damage, id).toBeCloseTo(plain.weaponStats.damage, 6);
      expect(own.stats.damage, id).toBeCloseTo(plain.stats.damage, 6);
    }
  });
});

// ====================================================================== 보리
describe('보리 둔기·도끼 / 방패: a longer, wider body block and a barrel that fills while she fights', () => {
  it('the body block stands longer and wider and shoves harder only with a favoured weapon', () => {
    const wall = (character: string, weapon: string): BodyBlock => {
      const { w } = sim(character, weapon, 120);
      drive(w, 1);
      drive(w, 2, (out, i) => { if (i === 0) out.pressed = PRESS.dash; out.mx = 1; });
      const b = w.entities.find((e) => e instanceof BodyBlock) as BodyBlock | undefined;
      expect(b, `${character} ${weapon}`).toBeDefined();
      return b!;
    };
    // a flail (둔기·도끼) and a shield (방패) both raise the big wall
    for (const weapon of ['lantern_flail', 'mirror_buckler', 'aegis_cannon']) {
      const big = wall('bori', weapon);
      expect(big.life, weapon).toBe(BORI_BLOCK_TIME_AFFINITY);
      expect(big.R, weapon).toBe(BORI_BLOCK_RADIUS_AFFINITY);
      expect(big.shove, weapon).toBe(BORI_SHOVE_DMG_AFFINITY);
    }
    for (const b of [wall('bori', 'lantern_bolt'), wall('bori', 'titan_greatsword'), wall(noAff('bori'), 'lantern_flail')]) {
      expect(b.life).toBe(BORI_BLOCK_TIME);
      expect(b.R).toBe(BORI_BLOCK_RADIUS);
      expect(b.shove).toBe(BORI_SHOVE_DMG);
    }
    expect(BORI_BLOCK_TIME_AFFINITY).toBeGreaterThan(BORI_BLOCK_TIME);
  });

  it('the wider wall stops a bullet the plain one does not reach', () => {
    const blocked = (character: string): boolean => {
      const { w } = sim(character, 'lantern_flail', 120);
      const p = w.player;
      drive(w, 1);
      // shove to the right, then (wall still up) a bullet creeps in 25 px in front of her
      drive(w, Math.round(0.2 / FIXED_DT), (out, i) => { if (i === 0) out.pressed = PRESS.dash; out.mx = i === 0 ? 1 : 0; });
      expect(w.entities.some((e) => e instanceof BodyBlock && !e.dead), character).toBe(true);
      const pr = bulletAt(w, p.x + 25, p.y - 4, 5);
      drive(w, 2);
      return pr.dead && pr.team === 'enemy';
    };
    expect(blocked('bori')).toBe(true);
    expect(blocked(noAff('bori'))).toBe(false);
  });

  it('weapon hits pour into the barrel with every favoured weapon, and only with one', () => {
    const fill = (character: string, weapon: string) => barrel(measureDps({ character, weapon, seconds: 6 }).world);
    // every 둔기·도끼 and 방패 fills it at a similar pace (6 s on a dummy: 0.18 hammer .. 0.31 anchor axe),
    // the slow big swings included (hitShare caps a hit at 2 plain hits)
    for (const weapon of CLASS.bori.yes) {
      const k = fill('bori', weapon);
      expect(k, weapon).toBeGreaterThan(0.12);
      expect(k, weapon).toBeLessThan(0.6);
    }
    expect(fill(noAff('bori'), 'lantern_flail')).toBe(0);
    expect(fill('bori', 'lantern_bolt')).toBe(0);
    expect(fill('bori', 'titan_greatsword')).toBe(0);
  });

  it('boss drill: she loses clearly fewer hearts per boss (net of healing), with no faster kills', () => {
    const g = drillGain('bori', 'lantern_flail', DRILL_BOSSES, ['A', 'B']);
    console.log(`보리 boss drill: ttk x${g.ttk.toFixed(3)} net hearts x${g.net.toFixed(3)}`);
    expect(g.ttk).toBeGreaterThan(0.94);
    expect(g.ttk).toBeLessThan(1.1);
    expect(g.net).toBeGreaterThan(1.04);
    // 16 fights on floors 1–4 only (x1.58 here, where a hit costs ½♥ and a barrel charge heals a lot):
    // the full bench (2026-10-08: 13 bosses x 8 seeds, all nine 둔기·도끼 / 방패, 936 fights per variant)
    // puts the class at net hearts x1.165 (weapons x1.11-1.26), between what +20 % (x1.141) and
    // +25 % (x1.175) damage would save: about +23.5 %. The ceiling only catches a runaway.
    expect(g.net).toBeLessThan(2);
  }, 120_000);
});

// ====================================================================== 백구
describe('백구 단검 / 투척: a second counter slash, a longer 반격, a wider bullet return', () => {
  /** A perfect dodge of a bullet 36 px to the left; returns the world, its dummy and its HP right before. */
  function dodge(character: string, extra?: (w: World) => void, weapon = 'fang_blade'): { w: World; dummy: Enemy; hp0: number } {
    const { w, dummy } = sim(character, weapon, 30);
    const p = w.player;
    p.god = false;
    extra?.(w);
    const hp0 = dummy.hp;
    bulletAt(w, p.x - 30, p.y - 4, 150);
    drive(w, 1);
    drive(w, 1, (out) => { out.pressed = PRESS.dash; out.my = 1; });
    expect(w.vars.__bgDodged, character).toBe(1);
    return { w, dummy, hp0 };
  }

  it('the counter slash crosses twice with a dagger or a thrown weapon (both critical), once without', () => {
    /** HP lost and the counter strikes that landed (the slashes / the thrown fang), each with its crit flag. */
    const counter = (character: string, weapon: string): { lost: number; strikes: boolean[] } => {
      const strikes: boolean[] = [];
      const { w, dummy, hp0 } = dodge(character, (ww) => {
        const orig = ww.applyHit.bind(ww);
        ww.applyHit = (t, hit) => {
          const ok = orig(t, hit);
          const id = hit.source?.id;
          if (ok && id && (id === ww.vars.__bgStrikeId || id === ww.vars.__bgStrike2Id)) strikes.push(!!hit.crit);
          return ok;
        };
      }, weapon);
      // (the thrown fang needs a moment to fly)
      drive(w, Math.round((BAEKGU_STRIKE2_DELAY + 0.4) / FIXED_DT));
      if (character === 'baekgu' && weapon !== 'moon_katana') expect(w.vars.__bgStrike2Id, weapon).toBeGreaterThan(0);
      else expect(w.vars.__bgStrike2Id ?? 0, weapon).toBe(0);
      return { lost: hp0 - dummy.hp, strikes };
    };
    for (const weapon of ['fang_blade', 'twin_daggers', 'throwing_knives', 'ricochet_chakram']) {
      const two = counter('baekgu', weapon);
      const one = counter(noAff('baekgu'), weapon);
      expect(two.strikes, weapon).toEqual([true, true]);
      expect(one.strikes, weapon).toEqual([true]);
      expect(one.lost, weapon).toBeGreaterThan(0);
      // (both include the reflected bullet; the second crit strike adds about as much again as the first)
      if (weapon === 'fang_blade') expect(two.lost, weapon).toBeGreaterThan(one.lost * 1.5);
    }
    // a katana is a 검 now: one slash
    expect(counter('baekgu', 'moon_katana').strikes).toEqual([true]);
  });

  it('반격 hits harder with a favoured weapon in hand (x1.62 instead of x1.5), and only while it is held', () => {
    const counterMul = (character: string, weapon = 'fang_blade'): { w: World; base: number; mul: number } => {
      const { w } = sim(character, weapon, 30);
      const base = w.player.stats.damage;
      const { w: w2 } = dodge(character, undefined, weapon);
      drive(w2, 1);
      expect(inCounter(w2), character).toBe(true);
      return { w: w2, base, mul: w2.player.stats.damage / base };
    };
    const blade = counterMul('baekgu');
    expect(blade.mul).toBeCloseTo(BAEKGU_COUNTER_DMG_AFFINITY, 6);
    expect(counterMul('baekgu', 'pinwheel_boomerang').mul).toBeCloseTo(BAEKGU_COUNTER_DMG_AFFINITY, 6);
    expect(counterMul('baekgu', 'moon_katana').mul).toBeCloseTo(BAEKGU_COUNTER_DMG, 6);
    expect(counterMul(noAff('baekgu')).mul).toBeCloseTo(BAEKGU_COUNTER_DMG, 6);
    // swapping to a plain weapon mid-반격 drops it back to x1.5 (the keeper's damage, not the weapon's)
    const p = blade.w.player;
    p.equipWeapon(blade.w, 'lantern_bolt');
    drive(blade.w, 1);
    expect(inCounter(blade.w)).toBe(true);
    expect(p.flags.has('affinity')).toBe(false);
    expect(p.stats.damage / blade.base).toBeCloseTo(BAEKGU_COUNTER_DMG, 6);
  });

  it('with a thrown weapon the second counter is a thrown fang: it reaches a target out of slash range', () => {
    // a thrown weapon keeps its distance (100 px here): the slashes cannot reach, the fang can
    const lost = (character: string, weapon: string): number => {
      const { w, dummy } = sim(character, weapon, 100);
      const p = w.player;
      p.god = false;
      const hp0 = dummy.hp;
      bulletAt(w, p.x - 30, p.y - 4, 150);
      drive(w, 1);
      drive(w, 1, (out) => { out.pressed = PRESS.dash; out.my = 1; });
      expect(w.vars.__bgDodged, `${character} ${weapon}`).toBe(1);
      drive(w, Math.round((BAEKGU_STRIKE2_DELAY + 0.6) / FIXED_DT));
      const id = w.vars.__bgStrike2Id ?? 0;
      if (character === 'baekgu' && weapon !== 'fang_blade') {
        expect(id, weapon).toBeGreaterThan(0);
        expect(counterThrows(w), weapon).toBe(true);
      } else expect(id, `${character} ${weapon}`).toBe(0);
      return hp0 - dummy.hp;
    };
    const base = sim('baekgu', 'throwing_knives', 100).w.player.stats.damage;
    for (const weapon of ['throwing_knives', 'pinwheel_boomerang', 'spin_top_yoyo']) {
      const thrown = lost('baekgu', weapon);
      const plain = lost(noAff('baekgu'), weapon);
      // one critical fang at 반격 strength on top of the returned bullet both of them get
      expect(thrown - plain, weapon).toBeGreaterThan(base * BAEKGU_STRIKE2_DMG * 1.5 * BAEKGU_COUNTER_DMG_AFFINITY * 0.9);
    }
    // a dagger still slashes (it closes in): at 100 px only the returned bullet lands, no critical strike
    expect(lost('baekgu', 'fang_blade')).toBeLessThan(base * BAEKGU_STRIKE2_DMG * 1.5);
  });

  it('반격 lasts longer and the dodge returns bullets from farther away', () => {
    const run = (character: string) => {
      let far: Projectile | null = null;
      const { w } = dodge(character, (ww) => {
        // a bullet 60 px above, flying away: only the wider return catches it
        far = bulletAt(ww, ww.player.x, ww.player.y - 4 - 60, 60, -Math.PI / 2);
      });
      const team = far!.team;
      drive(w, Math.round((BAEKGU_COUNTER_TIME + 0.3) / FIXED_DT));
      return { team, counter: inCounter(w) };
    };
    expect(BAEKGU_REFLECT_RADIUS_AFFINITY).toBeGreaterThan(60);
    expect(BAEKGU_REFLECT_RADIUS).toBeLessThan(60);
    expect(BAEKGU_COUNTER_TIME_AFFINITY).toBeGreaterThan(0.3);
    expect(run('baekgu')).toEqual({ team: 'player', counter: true });
    expect(run(noAff('baekgu'))).toEqual({ team: 'enemy', counter: false });
  });

  it('with perfect dodges on a clock, every dagger and thrown weapon deals clearly more (bullet duel)', () => {
    // all eight (2026-10-08, 반격 x1.62): x1.33-1.55, median x1.38; a thrown weapon keeps its distance,
    // its second counter is thrown and 반격 is keeper damage, so it gains as much as a dagger
    const gains: number[] = [];
    for (const weapon of CLASS.baekgu.yes) {
      const a = bulletDrill('baekgu', weapon, { seconds: 100, every: 5 });
      const b = bulletDrill(noAff('baekgu'), weapon, { seconds: 100, every: 5 });
      console.log(`백구 bullet duel ${weapon}: x${(a.dps / b.dps).toFixed(3)} (perfect dodges ${a.dodges} / ${b.dodges})`);
      expect(a.dodges, weapon).toBeGreaterThanOrEqual(5);
      expect(b.dodges, weapon).toBeGreaterThanOrEqual(5);
      gains.push(a.dps / b.dps);
      expect(a.dps / b.dps, weapon).toBeGreaterThan(1.12);
    }
    expect(median(gains)).toBeGreaterThan(1.12);
    expect(median(gains)).toBeLessThan(1.45);
    // without perfect dodges the class adds no damage (the upgrade lives in the counter)
    const calm = measureDps({ character: 'baekgu', weapon: 'fang_blade', seconds: 8, seed: 'AFFB' }).dps / measureDps({ character: noAff('baekgu'), weapon: 'fang_blade', seconds: 8, seed: 'AFFB' }).dps;
    expect(calm).toBeGreaterThan(0.95);
    expect(calm).toBeLessThan(1.05);
  }, 60_000);

  it('boss drill: the counter upgrades shorten boss fights, with a dagger and with a thrown weapon', () => {
    // 16 fights per weapon only. The full bench (2026-10-08: 13 bosses x 16 seeds, all eight 단검 / 투척,
    // 208 fights per weapon and variant, 반격 x1.62) puts the class at fight time x1.166 (what +22 %
    // damage gives; weapons +17..+29 %) and hearts lost x1.236 (+28 %). Before the thrown fang a thrown
    // weapon (the bot keeps 70-120 px off the boss) landed the second slash on ~30 % of perfect dodges
    // (daggers ~85 %): fight time only +16 % for the six thrown weapons.
    for (const weapon of ['fang_blade', 'throwing_knives']) {
      const g = drillGain('baekgu', weapon, DRILL_BOSSES, ['A', 'B']);
      console.log(`백구 boss drill ${weapon}: ttk x${g.ttk.toFixed(3)} net hearts x${g.net.toFixed(3)}`);
      expect(g.ttk, weapon).toBeGreaterThan(1.04);
      expect(g.ttk, weapon).toBeLessThan(1.4);
    }
  }, 120_000);
});

// ====================================================================== 모리
describe('모리 지팡이: three sheep, and a headbutted enemy counts as herded even alone', () => {
  it('three sheep with a staff, two without (a wand is a 마법봉, not a 지팡이)', () => {
    for (const weapon of CLASS.mori.yes) {
      const { w } = sim('mori', weapon);
      drive(w, 2);
      expect(familiarsOf<SpiritSheep>(w, 'mori_sheep').length, weapon).toBe(MORI_SHEEP_AFFINITY);
    }
    for (const [character, weapon] of [[noAff('mori'), 'shepherd_crook'], ['mori', 'amber_wand'], ['mori', 'tide_staff']]) {
      const plain = sim(character, weapon).w;
      drive(plain, 2);
      expect(familiarsOf<SpiritSheep>(plain, 'mori_sheep').length, `${character} ${weapon}`).toBe(MORI_SHEEP);
    }
  });

  it('a lone target the sheep bumped takes the herd bonus only with a staff', () => {
    const check = (character: string, weapon: string) => {
      const { w, dummy } = sim(character, weapon);
      drive(w, 60 * 2, (out) => { out.held = HELD.cursorAim; out.cx = dummy.x; out.cy = dummy.y; });
      const hp = dummy.hp;
      w.applyHit(dummy, { damage: 10, kind: 'projectile', attacker: w.player });
      return { marked: isMarked(w, dummy), herded: isHerded(w, dummy), lost: hp - dummy.hp };
    };
    const staff = check('mori', 'shepherd_crook');
    expect(staff.marked).toBe(true);
    expect(staff.herded).toBe(true);
    expect(staff.lost).toBeCloseTo(10 * (1 + MORI_GROUP_BONUS), 3);
    const plain = check(noAff('mori'), 'shepherd_crook');
    expect(plain.herded).toBe(false);
    expect(plain.lost).toBeCloseTo(10, 3);
    // a beam staff marks too; a wand does not
    expect(check('mori', 'thunder_rod').herded).toBe(true);
    const wand = check('mori', 'amber_wand');
    expect(wand.marked).toBe(false);
    expect(wand.lost).toBeCloseTo(10, 3);
    // the mark fades MORI_MARK_TIME s after the last bump
    const { w, dummy } = sim('mori', 'shepherd_crook');
    dummy.mem.__moriMark = w.time + MORI_MARK_TIME;
    drive(w, 1);
    expect(isMarked(w, dummy)).toBe(true);
    // without a staff the sheep's bumps no longer renew it
    w.player.equipWeapon(w, 'lantern_bolt');
    drive(w, Math.round((MORI_MARK_TIME + 0.1) / FIXED_DT));
    expect(isMarked(w, dummy)).toBe(false);
  });

  // every staff, single target and crowd (2026-10-08, headbutt cd x0.82): single x1.21-1.27,
  // median x1.24; crowd median x1.01. The full bench (8 / 12 / 16 s, three seed sets, 10 mid builds)
  // puts the class at single x1.24, mid x1.21, with no staff outside x1.18-1.30.
  it('single-target gain lands in the 20–25 % band with every staff; a herded crowd gains little', () => {
    const single: number[] = [];
    const crowd: number[] = [];
    for (const weapon of CLASS.mori.yes) {
      const seed = `AFFB-${weapon}`;
      single.push(measureDps({ character: 'mori', weapon, seconds: 16, seed }).dps / measureDps({ character: noAff('mori'), weapon, seconds: 16, seed }).dps);
      crowd.push(measureDps({ character: 'mori', weapon, seconds: 8, crowd: true, seed }).dps / measureDps({ character: noAff('mori'), weapon, seconds: 8, crowd: true, seed }).dps);
    }
    for (const [i, weapon] of CLASS.mori.yes.entries()) expect(single[i], weapon).toBeGreaterThan(1.15);
    expect(median(single)).toBeGreaterThanOrEqual(1.2);
    expect(median(single)).toBeLessThanOrEqual(1.27);
    expect(median(crowd)).toBeGreaterThan(0.95);
    expect(median(crowd)).toBeLessThan(1.12);
  }, 60_000);

  it('mid builds (6 artifacts) keep the gain in the band', () => {
    const mids = midBuilds('AFFB-MID', 6);
    const per = ['shepherd_crook', 'flame_staff', 'crystal_gatling', 'prism_staff', 'thunder_rod'].map((weapon) => median(mids.map((b, i) => {
      const seed = `AFFB-MID-${weapon}-${i}`;
      return measureDps({ character: 'mori', weapon, seconds: 8, artifacts: b, seed }).dps / measureDps({ character: noAff('mori'), weapon, seconds: 8, artifacts: b, seed }).dps;
    })));
    console.log(`모리 mid builds: ${per.map((g) => g.toFixed(3)).join(' ')} -> median ${median(per).toFixed(3)}`);
    expect(median(per)).toBeGreaterThanOrEqual(1.18);
    expect(median(per)).toBeLessThanOrEqual(1.27);
  }, 120_000);
});
