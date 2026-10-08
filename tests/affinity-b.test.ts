// 선호 무기 (CharacterDef.affinity) for 보리 / 백구 / 모리: the favoured class matches the
// right weapons (starters included), the 'affinity' flag follows weapon swaps, and the bonus
// upgrades each keeper's own kit instead of adding flat damage:
//   보리 묵직한 무기 — the body block's wall stands longer and wider and shoves harder, and every
//     weapon hit pours a little into the rescue barrel (by the hit's size)
//   백구 단도·도   — wider perfect-dodge window, wider bullet return, a second crossing
//     counter slash, a longer 반격
//   모리 지팡이    — a third sheep, faster headbutts, and a headbutted enemy counts as herded
//     even alone (the +25 % herd bonus reaches bosses and stragglers)
// The gain is checked against a clone of the keeper without the affinity, on short runs:
// training dummies for 모리 (single target), a bullet duel for 백구 (perfect dodges on a
// clock) and a short boss drill (boss-bench bot, real hearts: fight time and hearts lost net
// of healing) for 보리 and 백구. The full measurement (312 boss fights per variant against
// +20 % / +25 % damage references, mid builds) is in the commit report.

import './headless';
import { fakeDisplay } from './headless';
import { describe, expect, it } from 'vitest';
import { Characters, Enemies, Weapons, defineCharacter, weaponMatchesAffinity } from '../src/game/defs';
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
  BAEKGU_COUNTER_TIME, BAEKGU_COUNTER_TIME_AFFINITY, BAEKGU_REFLECT_RADIUS, BAEKGU_REFLECT_RADIUS_AFFINITY, BAEKGU_STRIKE2_DELAY, inCounter,
} from '../src/content/characters/kit-baekgu';
import { MORI_GROUP_BONUS, MORI_MARK_TIME, MORI_SHEEP, MORI_SHEEP_AFFINITY, SpiritSheep, isHerded, isMarked } from '../src/content/characters/kit-mori';
import { familiarsOf } from '../src/content/items/lib';
import { measureDps } from './dpsharness';

const HANGUL = /[가-힣]/;
const KEEPERS = ['bori', 'baekgu', 'mori'] as const;

/** The favoured class of each keeper (every matching weapon in the game) and a few that must not match. */
const CLASS: Record<(typeof KEEPERS)[number], { yes: string[]; no: string[] }> = {
  bori: {
    yes: ['lantern_flail', 'great_hammer', 'quake_mace', 'titan_greatsword', 'reaper_scythe', 'smoke_censer', 'mirror_buckler', 'saw_launcher', 'gatebreaker_maul', 'anchor_axe', 'cathedral_mace', 'obsidian_cleaver'],
    no: ['lantern_bolt', 'fang_blade', 'shepherd_crook', 'hunter_bow', 'copper_sabre', 'iron_spear'],
  },
  baekgu: {
    yes: ['fang_blade', 'twin_daggers', 'moon_katana', 'chain_sickle', 'return_blade', 'spin_top_yoyo', 'badminton_racket'],
    no: ['lantern_bolt', 'sentinel_blade', 'copper_sabre', 'great_hammer', 'shepherd_crook'],
  },
  mori: {
    yes: ['shepherd_crook', 'amber_wand', 'tide_staff', 'cinder_sceptre', 'stormhorn_rod', 'constellation_staff', 'ink_brush', 'prism_staff', 'crystal_gatling', 'dragon_breath', 'thunder_rod', 'meteor_staff', 'flame_staff'],
    no: ['lantern_bolt', 'frost_wand', 'hunter_bow', 'fang_blade', 'lantern_flail'],
  },
};

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
 * One boss fight on its floor under the boss-bench bot (strafes, closes in with a melee weapon,
 * dashes off bullets), with the keeper's real hearts: a death refills them. Returns the fight
 * time and the hearts lost net of healing (½♥ units).
 */
function bossDrill(bossId: string, character: string, weapon: string, seed: string): { time: number; net: number; killed: boolean } {
  if (!drillRenderer) drillRenderer = new Renderer(fakeDisplay(1280, 720));
  const def = Enemies.must(bossId);
  const floor = def.bossFloors![0];
  const run = new RunState(`${seed}-${bossId}`, character);
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
  const power = DRILL_POWER[floor];
  const applyHit = w.applyHit.bind(w);
  w.applyHit = (target, hit) => {
    if (hit.attacker === p || (hit.source && 'team' in hit.source && (hit.source as { team: string }).team === 'player')) hit.damage *= power;
    return applyHit(target, hit);
  };
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
  it('each class holds the starter and its whole weapon family, and nothing else', () => {
    for (const id of KEEPERS) {
      const c = Characters.must(id);
      const aff = c.affinity!;
      expect(aff, id).toBeDefined();
      expect(aff.name).toMatch(HANGUL);
      expect(aff.desc).toMatch(HANGUL);
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
      p.equipWeapon(w, CLASS[id].yes[1]);
      drive(w, 1);
      expect(p.flags.has('affinity'), `${id} ${CLASS[id].yes[1]}`).toBe(true);
      // never a flat damage bonus: the weapon hits exactly as hard as on the keeper without a class
      const plain = sim(noAff(id), c.weapon).w.player;
      const own = sim(id, c.weapon).w.player;
      expect(own.weaponStats.damage, id).toBeCloseTo(plain.weaponStats.damage, 6);
      expect(own.stats.damage, id).toBeCloseTo(plain.stats.damage, 6);
    }
  });
});

// ====================================================================== 보리
describe('보리 묵직한 무기: a longer, wider body block and a barrel that fills while she fights', () => {
  it('the body block stands longer and wider and shoves harder only with a heavy weapon', () => {
    const wall = (character: string, weapon: string): BodyBlock => {
      const { w } = sim(character, weapon, 120);
      drive(w, 1);
      drive(w, 2, (out, i) => { if (i === 0) out.pressed = PRESS.dash; out.mx = 1; });
      const b = w.entities.find((e) => e instanceof BodyBlock) as BodyBlock | undefined;
      expect(b, `${character} ${weapon}`).toBeDefined();
      return b!;
    };
    const heavy = wall('bori', 'lantern_flail');
    expect(heavy.life).toBe(BORI_BLOCK_TIME_AFFINITY);
    expect(heavy.R).toBe(BORI_BLOCK_RADIUS_AFFINITY);
    expect(heavy.shove).toBe(BORI_SHOVE_DMG_AFFINITY);
    for (const b of [wall('bori', 'lantern_bolt'), wall(noAff('bori'), 'lantern_flail')]) {
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

  it('weapon hits pour into the barrel only with a heavy weapon', () => {
    const fill = (character: string, weapon: string) => barrel(measureDps({ character, weapon, seconds: 6 }).world);
    const heavy = fill('bori', 'lantern_flail');
    expect(heavy).toBeGreaterThan(0.08);
    expect(heavy).toBeLessThan(0.6);
    expect(fill(noAff('bori'), 'lantern_flail')).toBe(0);
    expect(fill('bori', 'lantern_bolt')).toBe(0);
  });

  it('boss drill: she loses clearly fewer hearts per boss (net of healing), with no faster kills', () => {
    const g = drillGain('bori', 'lantern_flail', DRILL_BOSSES, ['A', 'B']);
    console.log(`보리 boss drill: ttk x${g.ttk.toFixed(3)} net hearts x${g.net.toFixed(3)}`);
    expect(g.ttk).toBeGreaterThan(0.94);
    expect(g.ttk).toBeLessThan(1.1);
    expect(g.net).toBeGreaterThan(1.04);
    // 16 fights only: the full bench (312 fights per variant) puts it at about x1.12, the gain of +20–25 % damage
    expect(g.net).toBeLessThan(1.6);
  }, 120_000);
});

// ====================================================================== 백구
describe('백구 단도·도: a second counter slash, a longer 반격, a wider bullet return', () => {
  /** A perfect dodge of a bullet 36 px to the left; returns the world, its dummy and its HP right before. */
  function dodge(character: string, extra?: (w: World) => void): { w: World; dummy: Enemy; hp0: number } {
    const { w, dummy } = sim(character, 'fang_blade', 30);
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

  it('the counter slash crosses twice with a short blade (both critical), once without', () => {
    const lost = (character: string): number => {
      const { w, dummy, hp0 } = dodge(character);
      drive(w, Math.round((BAEKGU_STRIKE2_DELAY + 0.15) / FIXED_DT));
      if (character === 'baekgu') expect(w.vars.__bgStrike2Id).toBeGreaterThan(0);
      else expect(w.vars.__bgStrike2Id ?? 0).toBe(0);
      return hp0 - dummy.hp;
    };
    const two = lost('baekgu');
    const one = lost(noAff('baekgu'));
    expect(one).toBeGreaterThan(0);
    // (both include the reflected bullet; the second crit slash adds about as much again as the first)
    expect(two).toBeGreaterThan(one * 1.5);
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

  it('with perfect dodges on a clock, short blades deal clearly more (bullet duel)', () => {
    const gains: number[] = [];
    for (const weapon of ['fang_blade', 'twin_daggers']) {
      const a = bulletDrill('baekgu', weapon, { seconds: 100, every: 5 });
      const b = bulletDrill(noAff('baekgu'), weapon, { seconds: 100, every: 5 });
      console.log(`백구 bullet duel ${weapon}: x${(a.dps / b.dps).toFixed(3)} (perfect dodges ${a.dodges} / ${b.dodges})`);
      expect(a.dodges, weapon).toBeGreaterThanOrEqual(5);
      expect(b.dodges, weapon).toBeGreaterThanOrEqual(5);
      gains.push(a.dps / b.dps);
    }
    expect(median(gains)).toBeGreaterThan(1.12);
    expect(median(gains)).toBeLessThan(1.45);
    // without perfect dodges the class adds no damage (the upgrade lives in the counter)
    const calm = measureDps({ character: 'baekgu', weapon: 'fang_blade', seconds: 8, seed: 'AFFB' }).dps / measureDps({ character: noAff('baekgu'), weapon: 'fang_blade', seconds: 8, seed: 'AFFB' }).dps;
    expect(calm).toBeGreaterThan(0.95);
    expect(calm).toBeLessThan(1.05);
  }, 60_000);

  it('boss drill: the counter upgrades shorten boss fights', () => {
    const g = drillGain('baekgu', 'fang_blade', DRILL_BOSSES, ['A', 'B']);
    console.log(`백구 boss drill: ttk x${g.ttk.toFixed(3)} net hearts x${g.net.toFixed(3)}`);
    // 16 fights only: the full bench (312 fights per variant) puts the fight time at about x1.14,
    // between what +20 % (x1.12) and +25 % (x1.16) damage would give
    expect(g.ttk).toBeGreaterThan(1.04);
    expect(g.ttk).toBeLessThan(1.4);
  }, 120_000);
});

// ====================================================================== 모리
describe('모리 지팡이: three sheep, and a headbutted enemy counts as herded even alone', () => {
  it('three sheep with a staff, two without', () => {
    const { w } = sim('mori', 'shepherd_crook');
    drive(w, 2);
    expect(familiarsOf<SpiritSheep>(w, 'mori_sheep').length).toBe(MORI_SHEEP_AFFINITY);
    const plain = sim(noAff('mori'), 'shepherd_crook').w;
    drive(plain, 2);
    expect(familiarsOf<SpiritSheep>(plain, 'mori_sheep').length).toBe(MORI_SHEEP);
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

  it('single-target gain lands in the 20–25 % band; a herded crowd gains little', () => {
    const single: number[] = [];
    const crowd: number[] = [];
    for (const weapon of ['shepherd_crook', 'amber_wand']) {
      const seed = `AFFB-${weapon}`;
      single.push(measureDps({ character: 'mori', weapon, seconds: 16, seed }).dps / measureDps({ character: noAff('mori'), weapon, seconds: 16, seed }).dps);
      crowd.push(measureDps({ character: 'mori', weapon, seconds: 8, crowd: true, seed }).dps / measureDps({ character: noAff('mori'), weapon, seconds: 8, crowd: true, seed }).dps);
    }
    expect(median(single)).toBeGreaterThanOrEqual(1.18);
    expect(median(single)).toBeLessThanOrEqual(1.28);
    expect(median(crowd)).toBeGreaterThan(0.95);
    expect(median(crowd)).toBeLessThan(1.12);
  }, 60_000);
});
