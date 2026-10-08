// Favoured weapons of the five refuge keepers (토브 / 루엔 / 베스 / 오르트 / 미라). Each class is a
// set of weapon families (game/weapon-families.ts) and is named after them, so the family on a
// weapon's info line tells whose weapon it is: 토브 총 / 폭약·포, 루엔 마법봉 / 사슬·채찍,
// 베스 검 / 단검, 오르트 창 / 방패 (starter 투창 묶음), 미라 총 / 종·향로.
// Holding a weapon of the keeper's class upgrades the keeper's own device, never the
// weapon's damage: 토브's charges relay (full on the new carrier, a weaker splash around it),
// 루엔 ties a double knot over five links, 베스's other hand repeats every support technique
// on the same enemy, 오르트's shield grows broader with a third plate and sends blocked shots
// back, 미라's seal pins the enemy it opened on and writes down a share of her hits on it.
// The measured gain is about +20-25 % over the same keeper and weapon without the affinity
// (short runs here; the full dps bench over every weapon of each class:
// AFFINITY_BENCH=1 npx vitest run tests/affinity-c; 오르트's is measured in boss fights, see the
// comment on its gain test).

import './headless';
import { fakeDisplay } from './headless';
import { describe, it, expect } from 'vitest';
import { Characters, Enemies, RARITY_WEIGHT, Artifacts, Weapons, defineCharacter, defineEnemy, weaponMatchesAffinity } from '../src/game/defs';
import { WEAPON_FAMILIES, familyMembers, weaponFamily } from '../src/game/weapon-families';
import { Projectile } from '../src/game/projectile';
import { FIXED_DT } from '../src/game/constants';
import { Tile } from '../src/game/tiles';
import { RNG } from '../src/engine/rng';
import { swapWeapons } from '../src/game/weaponslots';
import { stateHash } from '../src/game/statehash';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Renderer } from '../src/engine/renderer';
import { HELD, PRESS, fixedRules, type PlayerInput } from '../src/game/seam';
import type { Enemy } from '../src/game/enemy';
import { DUMMY_ID, measureDps } from './dpsharness';
import { REFUGE_AFFINITIES, REFUGE_DASHES, RefugeCharge, RefugeWeave, RefugeSupport, RefugeGuard, RefugeSeal } from '../src/content/characters/refuge-kits';
import {
  LUEN_KNOT_AFFINITY, LUEN_LINKS, LUEN_LINKS_AFFINITY, MIRA_PIN_AFFINITY, MIRA_PIN_RECORD, MIRA_PIN_SHARE, MIRA_PULSE, ORT_CHARGES, ORT_CHARGES_AFFINITY,
  ORT_REFLECT_AFFINITY, ORT_WIDTH, ORT_WIDTH_AFFINITY, TOVE_MINES, TOVE_MINES_AFFINITY, TOVE_RELAY_SHARE, TOVE_RELAY_SPLASH, VES_ECHO_AFFINITY, VES_ECHO_SPLASH,
} from '../src/content/characters/refuge-devices';

const IDS = ['tove', 'luen', 'ves', 'ort', 'mira'];
/** a weapon outside all five favoured classes */
const NEUTRAL = 'lantern_bolt';

function idle(w: World, frames: number): void {
  w.inputSource = (_w, p, o) => {
    o.mx = o.my = o.ax = o.ay = o.held = o.pressed = 0;
    o.cx = p.x + 80; o.cy = p.y - 6;
  };
  for (let i = 0; i < frames; i++) w.update(FIXED_DT);
}
function sim(id: string, weapon = Characters.must(id).weapon): { w: World; target: Enemy } {
  const result = measureDps({ character: id, weapon, seconds: 0, dist: 55 });
  const w = result.world;
  for (let y = 2; y < w.room.h - 2; y++) for (let x = 2; x < w.room.w - 2; x++) w.room.setTile(x, y, Tile.FLOOR);
  w.player.x = 80; w.player.y = 96; w.player.aim = 0;
  w.player.stats.critChance = 0;
  result.dummies[0].x = 135; result.dummies[0].y = 96;
  idle(w, 2);
  return { w, target: result.dummies[0] };
}
function deal(w: World, target: Enemy, amount = 10): void {
  w.withIds(() => w.applyHit(target, { damage: amount, kind: 'melee', attacker: w.player }));
}
function dummy(w: World, x: number, y: number): Enemy {
  const e = w.withIds(() => w.spawnEnemy(DUMMY_ID, x, y))!;
  e.dormant = 0;
  return e;
}
const live = <T>(w: World, Class: abstract new (...args: never[]) => T): T[] =>
  w.entities.filter((e) => e instanceof Class && !e.dead) as T[];

/** The same keeper without its favoured class (kit code never compares character ids). */
function noAffinity(id: string): string {
  const cid = '__noaff_' + id;
  if (!Characters.has(cid)) defineCharacter({ ...Characters.must(id), id: cid, affinity: undefined });
  return cid;
}
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const melee = (id: string) => Weapons.must(id).kind === 'melee';
/** best of a near and a far engagement (melee walks in anyway) */
function dps(character: string, weapon: string, seconds: number, artifacts: string[] = [], crowd = false, seed = `AFFC-${weapon}`): number {
  const a = measureDps({ character, weapon, seconds, artifacts, crowd, seed }).dps;
  return melee(weapon) ? a : Math.max(a, measureDps({ character, weapon, seconds, artifacts, crowd, seed, dist: 40 }).dps);
}
/** the affinity's gain: same keeper, same weapon, same seed, with vs without the favoured class */
function gain(id: string, weapon: string, seconds: number, artifacts: string[] = [], crowd = false, seed?: string): number {
  return dps(id, weapon, seconds, artifacts, crowd, seed) / dps(noAffinity(id), weapon, seconds, artifacts, crowd, seed);
}

/** the bosses of floors 1–4 (each fought on its own floor) */
const DRILL_BOSSES = ['bell_keeper', 'bone_colossus', 'slime_queen', 'spore_mother', 'chain_smith', 'slag_imugi', 'frost_saint', 'frost_commander'];
/** floor -> keeper damage scale (a build growing floor by floor; the same as tests/affinity-b) */
const DRILL_POWER: Record<number, number> = { 1: 1.5, 2: 2.1, 3: 3, 4: 4.2 };
let drillRenderer: Renderer | null = null;
/** `character` with its base damage x `k` (the returned shot is sized from keeper damage, so it grows too) */
function powered(character: string, k: number): string {
  const nid = `${character}__x${k}`;
  if (!Characters.has(nid)) {
    const c = Characters.must(character);
    defineCharacter({ ...c, id: nid, unlocked: false, baseStats: { ...(c.baseStats ?? {}), damage: (c.baseStats?.damage ?? 10) * k } });
  }
  return nid;
}
/**
 * One boss fight on its floor under the boss-bench bot (strafes, dashes off bullets; a ranged weapon
 * holds 70-120 px, a melee one 14-28 px off the boss's edge), with the keeper's real hearts: a death
 * refills them. Returns the fight time and the hearts lost net of healing (½♥ units).
 */
function bossDrill(bossId: string, character: string, weapon: string, seed: string): { time: number; net: number } {
  if (!drillRenderer) drillRenderer = new Renderer(fakeDisplay(1280, 720));
  const floor = Enemies.must(bossId).bossFloors![0];
  const run = new RunState(`${seed}-${bossId}`, powered(character, DRILL_POWER[floor]));
  run.seeded = true;
  const w = new World(drillRenderer, run, { openInventory() {}, onGameOver() {} });
  w.setQuality({ lighting: false, particles: 0 });
  w.rules = fixedRules({ hitStop: false });
  const close = Weapons.must(weapon).kind === 'melee';
  const strafe = { dir: 1, t: 0 };
  w.inputSource = (ww: World, _p: unknown, out: PlayerInput) => {
    const p = ww.player;
    out.mx = out.my = out.ax = out.ay = out.held = out.pressed = 0;
    out.cx = p.x + 30; out.cy = p.y;
    let t: Enemy | null = null, bd = Infinity;
    for (const e of ww.enemies) {
      if (!e.alive || e.hidden || !e.vulnerable) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y) - (e.mem.ward ? 400 : 0);
      if (d < bd) { bd = d; t = e; }
    }
    if (!t) return;
    const boss0 = ww.enemies.find((e) => e.isBoss && e.alive);
    strafe.t -= FIXED_DT;
    if (strafe.t <= 0) { strafe.dir = -strafe.dir; strafe.t = 0.8 + ((ww.time * 7) % 1) * 0.8; }
    const dx = t.x - p.x, dy = t.y - (p.y - 4), d = Math.hypot(dx, dy) || 1;
    const near = boss0?.def.id === 'mumyeong' ? 50 : close ? 14 + t.r : 70;
    const want = d < near ? -1 : d > near + (close ? 14 : 50) ? 1 : 0;
    let mx = (dx / d) * want - (dy / d) * strafe.dir, my = (dy / d) * want + (dx / d) * strafe.dir;
    for (const q of ww.projectiles) {
      if (q.dead || q.team !== 'enemy') continue;
      const qx = p.x - q.x, qy = p.y - q.y, qd = Math.hypot(qx, qy);
      if (qd < 34 && q.vx * qx + q.vy * qy > 0) {
        const sp = Math.hypot(q.vx, q.vy) || 1;
        mx += (-q.vy / sp) * 1.5; my += (q.vx / sp) * 1.5;
        if (qd < 20) out.pressed |= PRESS.dash;
        break;
      }
    }
    const ml = Math.hypot(mx, my);
    if (ml > 1e-6) { out.mx = mx / ml; out.my = my / ml; }
    out.held = (boss0?.mem.wdMirror === 2 ? 0 : HELD.fire) | HELD.cursorAim;
    out.cx = t.x; out.cy = t.y - 4;
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
  return { time: i * FIXED_DT, net: w.run.stats.damageTaken - taken0 - healed };
}
/** Boss drill ratios, without / with the class: fight time and net hearts lost per boss (> 1 = the class helps). */
function drillGain(id: string, weapon: string, bosses: string[], seeds: string[]): { ttk: number; net: number } {
  const a = { t: 0, n: 0 }, b = { t: 0, n: 0 };
  for (const boss of bosses) for (const s of seeds) {
    const x = bossDrill(boss, id, weapon, s), y = bossDrill(boss, noAffinity(id), weapon, s);
    a.t += x.time; a.n += x.net; b.t += y.time; b.n += y.net;
  }
  return { ttk: b.t / a.t, net: b.n / Math.max(1, a.n) };
}

/** each keeper's class: its families (named in this order), and nothing else */
const FAMILIES: Record<string, string[]> = {
  tove: ['gun', 'launcher'], luen: ['wand', 'chain'], ves: ['sword', 'dagger'], ort: ['spear', 'shield'], mira: ['gun', 'ritual'],
};
const NAMES: Record<string, string> = { tove: '총 / 폭약·포', luen: '마법봉 / 사슬·채찍', ves: '검 / 단검', ort: '창 / 방패', mira: '총 / 종·향로' };
/** favoured weapons of the class, spelled out (one or more of every family) */
const FAVOURED: Record<string, string[]> = {
  tove: ['nail_carbine', 'brass_revolver', 'sunset_rifle', 'gatekeeper_shotgun', 'bell_blunderbuss', 'ember_musket', 'harpoon_gun', 'scatter_horn', 'firework_barrel', 'thunder_mortar', 'comet_tube', 'saw_launcher'],
  luen: ['amber_wand', 'tide_staff', 'cinder_sceptre', 'stormhorn_rod', 'frost_wand', 'bubble_wand', 'thorn_whip', 'chain_sickle'],
  ves: ['copper_sabre', 'rose_rapier', 'moon_katana', 'sentinel_blade', 'obsidian_cleaver', 'titan_greatsword', 'fang_blade', 'twin_daggers'],
  ort: ['javelin_bundle', 'iron_spear', 'fang_spear', 'dawn_pike', 'comet_pike', 'mirror_buckler', 'aegis_cannon'],
  mira: ['brass_revolver', 'nail_carbine', 'sunset_rifle', 'gatekeeper_shotgun', 'bell_blunderbuss', 'ember_musket', 'harpoon_gun', 'scatter_horn', 'resonance_bell', 'smoke_censer'],
};
/** outside the class, including weapons the old (pre-family) classes listed by id or tag */
const OTHERS: Record<string, string[]> = {
  tove: ['sticky_crossbow', 'mine_lantern', 'amber_wand', 'copper_sabre', 'hunter_bow', 'crescent_bow', NEUTRAL],
  luen: ['ink_brush', 'shepherd_crook', 'constellation_staff', 'prism_staff', 'nail_carbine', NEUTRAL],
  ves: ['throwing_knives', 'dusk_knives', 'return_blade', 'iron_spear', 'brass_revolver', NEUTRAL],
  ort: ['crescent_bow', 'rose_rapier', 'hunter_bow', 'pearl_crossbow', 'sentinel_blade', 'nail_carbine', 'great_hammer', NEUTRAL],
  mira: ['twin_lamp', 'stasis_arbalest', 'gravity_orb', 'ink_brush', 'firefly_tome', 'constellation_staff', 'prism_staff', 'amber_wand', 'hunter_bow', NEUTRAL],
};
/** every weapon of the keeper's class (the families' members) */
const classOf = (id: string): string[] => FAMILIES[id].flatMap((f) => familyMembers(f));

describe('refuge keepers: favoured weapon classes', () => {
  it('each class is made of weapon families and named after them, with a short description of its upgrade', () => {
    for (const [i, id] of IDS.entries()) {
      const aff = Characters.must(id).affinity!;
      expect(aff, id).toBe(REFUGE_AFFINITIES[i]);
      expect(aff.families, id).toEqual(FAMILIES[id]);
      // the class is the families alone: no ids, tags or kinds on the side
      expect(aff.ids, id).toBeUndefined();
      expect(aff.tags, id).toBeUndefined();
      expect(aff.kinds, id).toBeUndefined();
      // the name is the family labels the weapon info lines show ("등급 · 계열 · 속성")
      expect(aff.name, id).toBe(NAMES[id]);
      expect(aff.name, id).toBe(aff.families!.map((f) => WEAPON_FAMILIES.find((x) => x.id === f)!.name).join(' / '));
      expect(aff.desc, id).toMatch(/[가-힣]/);
      expect(aff.desc.length, id).toBeLessThanOrEqual(45); // two short lines on the select screen
      // the upgrade is the keeper's own device, not a weapon stat bonus
      expect(aff.stats, id).toBeUndefined();
    }
  });

  it('the favoured class is exactly its families (starter included), and the starter shows that family', () => {
    for (const id of IDS) {
      const c = Characters.must(id);
      const aff = c.affinity;
      const starter = Weapons.must(c.weapon);
      expect(weaponMatchesAffinity(aff, starter), `${id} starter`).toBe(true);
      expect(FAMILIES[id], `${id} starter family`).toContain(weaponFamily(starter.id)?.id);
      const all = Weapons.all().filter((wd) => weaponMatchesAffinity(aff, wd)).map((wd) => wd.id).sort();
      expect(all, id).toEqual([...classOf(id)].sort());
      expect([...FAVOURED[id]].sort(), id).toEqual([...classOf(id)].sort());
      for (const wid of all) expect(FAMILIES[id], `${id} ${wid}`).toContain(weaponFamily(wid)?.id);
      for (const wid of OTHERS[id]) expect(weaponMatchesAffinity(aff, Weapons.must(wid)), `${id} ${wid}`).toBe(false);
    }
    // 오르트 starts with the javelins (창): no bow in 창 / 방패
    expect(Characters.must('ort').weapon).toBe('javelin_bundle');
  });

  it('the affinity flag follows the held weapon through pick-ups and swaps', () => {
    for (const id of IDS) {
      const { w } = sim(id);
      const p = w.player;
      expect(p.flags.has('affinity'), id).toBe(true);
      expect(w.items.affinityActive, id).toBe(true);
      p.equipWeapon(w, NEUTRAL);
      expect(p.flags.has('affinity'), id).toBe(false);
      swapWeapons(w, p, true);
      expect(p.weaponId).toBe(Characters.must(id).weapon);
      expect(p.flags.has('affinity'), id).toBe(true);
      // a weapon of every family in the class turns it on; one the old classes listed does not
      for (const f of FAMILIES[id]) {
        const wid = familyMembers(f).find((x) => x !== Characters.must(id).weapon)!;
        p.equipWeapon(w, wid);
        expect(p.flags.has('affinity'), `${id} ${wid}`).toBe(true);
        p.equipWeapon(w, OTHERS[id][0]);
        expect(p.flags.has('affinity'), `${id} ${OTHERS[id][0]}`).toBe(false);
      }
      // the keeper's own stats stay those of the plain kit (no stat bonus rides on the affinity)
      expect(p.stats.damage, id).toBe(sim(id, NEUTRAL).w.player.stats.damage);
    }
  });
});

describe('토브 — 연쇄 폭약', () => {
  it('a blast hands a 1.2x charge to an enemy it caught; that one does not hand on again', () => {
    const { w, target } = sim('tove');
    const p = w.player;
    deal(w, target);
    p.ember = 0; // the direct hit's own charge
    idle(w, 1);
    const first = live(w, RefugeCharge);
    expect(first).toHaveLength(1);
    const damage = first[0].mem.damage;
    let hp = target.hp;
    idle(w, 45);
    expect(first[0].mem.fired).toBe(1);
    expect(hp - target.hp).toBeCloseTo(damage, 5);
    const relay = live(w, RefugeCharge).filter((c) => !c.mem.fired);
    expect(relay).toHaveLength(1);
    expect(relay[0].mem.relay).toBe(1);
    expect(relay[0].mem.targetId).toBe(target.id);
    expect(relay[0].mem.damage).toBeCloseTo(damage * TOVE_RELAY_SHARE, 5);
    hp = target.hp;
    idle(w, 60);
    expect(hp - target.hp).toBeCloseTo(damage * TOVE_RELAY_SHARE, 5);
    idle(w, 60);
    expect(live(w, RefugeCharge).filter((c) => !c.mem.fired)).toHaveLength(0);
    expect(p.ember).toBe(0);
  });

  it('the relay prefers a neighbour caught in the blast', () => {
    const { w, target } = sim('tove');
    const other = dummy(w, target.x + 14, target.y);
    deal(w, target);
    idle(w, 46);
    const relay = live(w, RefugeCharge).filter((c) => c.mem.relay && !c.mem.fired);
    expect(relay).toHaveLength(1);
    expect(relay[0].mem.targetId).toBe(other.id);
    // its blast hits the carrier in full and the rest of what it catches at the splash share
    const damage = relay[0].mem.damage, hp = target.hp, hpOther = other.hp;
    idle(w, 40);
    expect(relay[0].mem.fired).toBe(1);
    expect(hpOther - other.hp).toBeCloseTo(damage, 5);
    expect(hp - target.hp).toBeCloseTo(damage * TOVE_RELAY_SPLASH, 5);
  });

  it('without a favoured weapon: no relay, and two mines instead of three', () => {
    const { w, target } = sim('tove', NEUTRAL);
    deal(w, target);
    idle(w, 46);
    expect(live(w, RefugeCharge).filter((c) => !c.mem.fired)).toHaveLength(0);
    target.x = 300;
    for (let i = 0; i < 4; i++) { w.withIds(() => REFUGE_DASHES[0].start!(w, w.player)); idle(w, 14); }
    expect(live(w, RefugeCharge).filter((c) => c.mem.mine)).toHaveLength(TOVE_MINES);
    w.player.equipWeapon(w, 'nail_carbine');
    for (let i = 0; i < 4; i++) { w.withIds(() => REFUGE_DASHES[0].start!(w, w.player)); idle(w, 14); }
    expect(live(w, RefugeCharge).filter((c) => c.mem.mine)).toHaveLength(TOVE_MINES_AFFINITY);
    // back to two: the oldest go first
    w.player.equipWeapon(w, NEUTRAL);
    w.withIds(() => REFUGE_DASHES[0].start!(w, w.player)); idle(w, 1);
    expect(live(w, RefugeCharge).filter((c) => c.mem.mine)).toHaveLength(TOVE_MINES);
  });
});

describe('루엔 — 겹매듭', () => {
  it('links five enemies with a favoured weapon, three without', () => {
    for (const [weapon, links] of [['amber_wand', LUEN_LINKS_AFFINITY], [NEUTRAL, LUEN_LINKS]] as const) {
      const { w, target } = sim('luen', weapon);
      for (let i = 0; i < 6; i++) dummy(w, target.x + 12 + i * 9, target.y + (i % 2 ? 16 : -16));
      idle(w, 1);
      deal(w, target);
      idle(w, 1);
      const weave = w.entityById(w.vars.rfLuenWeave) as RefugeWeave;
      expect(weave.targets(w), weapon).toHaveLength(links);
    }
  });

  it('every transfer also pulls a knot tight on the struck enemy; the transfer to the others is unchanged', () => {
    for (const [weapon, knot] of [['amber_wand', LUEN_KNOT_AFFINITY], [NEUTRAL, 0]] as const) {
      // alone: the transfer comes back as a knot, and the double knot doubles it
      const { w, target } = sim('luen', weapon);
      const pool = Math.min(w.player.stats.damage * 2, 100 * .28);
      let hp = target.hp;
      deal(w, target, 100);
      idle(w, 2);
      expect(hp - target.hp - 100, weapon).toBeCloseTo(pool * (1 + knot), 5);
      // with others linked, they share the same transfer and the struck one gets the knot
      const others = [dummy(w, 152, 96), dummy(w, 135, 116)];
      idle(w, 100); // past the 1.4 s re-tie window, so the next hit links the newcomers
      const before = others.map((e) => e.hp);
      hp = target.hp;
      deal(w, target, 100);
      idle(w, 2);
      expect(others.reduce((s, e, i) => s + before[i] - e.hp, 0), weapon).toBeCloseTo(pool, 5);
      expect(hp - target.hp - 100, weapon).toBeCloseTo(pool * knot, 5);
    }
  });
});

describe('베스 — 반대 손 연계', () => {
  it('each support technique is followed by the other hand, only with a favoured weapon', () => {
    for (const [weapon, echo] of [['copper_sabre', VES_ECHO_AFFINITY], [NEUTRAL, 0]] as const) {
      const { w, target } = sim('ves', weapon);
      w.player.weapon2Id = null; // the dagger fallback (교차 베기) either way
      const p = w.player;
      const hp = target.hp;
      deal(w, target);
      p.ember = 0; // the direct hit's own charge
      idle(w, 1);
      const supports = live(w, RefugeSupport);
      expect(supports, weapon).toHaveLength(echo ? 2 : 1);
      const base = supports[0].mem.damage;
      if (echo) {
        expect(supports[1].mem.echo).toBe(1);
        expect(supports[1].mem.wait).toBeGreaterThan(0);
        expect(supports[1].mem.damage).toBeCloseTo(base * echo, 5);
      }
      idle(w, 60);
      expect(hp - target.hp - 10, weapon).toBeCloseTo(base * (1 + echo), 5);
      expect(p.ember).toBe(0);
    }
  });

  it('the follow-up strikes the first technique\'s enemy in full, bystanders at the splash share', () => {
    const { w, target } = sim('ves');
    w.player.weapon2Id = null; // 교차 베기 around the struck enemy
    const near = dummy(w, target.x, target.y + 12);
    idle(w, 1);
    deal(w, target);
    idle(w, 1);
    const [first, echo] = live(w, RefugeSupport);
    expect(echo.mem.echo).toBe(1);
    const base = first.mem.damage;
    const hp = target.hp, hpNear = near.hp;
    idle(w, 10); // the first technique lands
    expect(hpNear - near.hp).toBeCloseTo(base, 5);
    const hp2 = target.hp, hpNear2 = near.hp;
    expect(hp - hp2).toBeCloseTo(base, 5);
    idle(w, 40); // the other hand
    expect(hp2 - target.hp).toBeCloseTo(base * VES_ECHO_AFFINITY, 5);
    expect(hpNear2 - near.hp).toBeCloseTo(base * VES_ECHO_AFFINITY * VES_ECHO_SPLASH, 5);
  });

  it('the follow-up re-aims at its target when it starts and draws nothing before', () => {
    const { w, target } = sim('ves');
    deal(w, target);
    idle(w, 1);
    const echo = live(w, RefugeSupport).find((s) => s.mem.echo)!;
    const before = stateHash(w);
    echo.draw(w.renderer, w);
    expect(stateHash(w)).toBe(before);
    target.y += 12;
    idle(w, 14);
    expect(echo.mem.wait).toBe(0);
    expect(echo.mem.ty).toBeGreaterThan(97);
  });
});

describe('오르트 — 되받아치는 방벽', () => {
  const shot = (w: World, g: RefugeGuard) => w.withIds(() => w.spawn(new Projectile({ team: 'enemy', x: g.x + 4, y: g.y, angle: Math.PI, speed: 100, damage: 1 })));

  it('three plates refilling every 1.8 s with a favoured weapon, two every 2.4 s without', () => {
    // a favoured weapon of each family (창: the starter javelins, 방패: the aegis cannon), then a weapon outside
    for (const [weapon, max] of [['javelin_bundle', ORT_CHARGES_AFFINITY], ['aegis_cannon', ORT_CHARGES_AFFINITY], [NEUTRAL, ORT_CHARGES]] as const) {
      const { w } = sim('ort', weapon);
      const g = w.entityById(w.vars.rfOrtGuard) as RefugeGuard;
      expect(g.maxCharges(), weapon).toBe(max);
      idle(w, 130);
      expect(w.vars.rfOrtCharges, weapon).toBe(max);
      for (let i = 0; i < max; i++) { const b = shot(w, g); idle(w, 14); expect(b.dead, weapon).toBe(true); }
      expect(w.vars.rfOrtCharges, weapon).toBe(0);
      const leak = shot(w, g); idle(w, 1);
      expect(leak.dead, weapon).toBe(false);
      leak.dead = true;
    }
    // swapping off the favoured weapon drops the third plate
    const { w } = sim('ort');
    idle(w, 130);
    expect(w.vars.rfOrtCharges).toBe(ORT_CHARGES_AFFINITY);
    w.player.equipWeapon(w, NEUTRAL); idle(w, 1);
    expect(w.vars.rfOrtCharges).toBe(ORT_CHARGES);
  });

  it('the favoured shield is broader: a shot 22 px off-centre is caught only with it', () => {
    for (const [weapon, caught] of [['javelin_bundle', true], ['mirror_buckler', true], ['crescent_bow', false], [NEUTRAL, false]] as const) {
      const { w } = sim('ort', weapon);
      const g = w.entityById(w.vars.rfOrtGuard) as RefugeGuard;
      expect(g.width(), weapon).toBe(caught ? ORT_WIDTH_AFFINITY : ORT_WIDTH);
      const b = w.withIds(() => w.spawn(new Projectile({ team: 'enemy', x: g.x + 4, y: g.y + 22, angle: Math.PI, speed: 100, damage: 1 })));
      idle(w, 1);
      expect(b.dead, weapon).toBe(caught);
    }
  });

  it('a blocked shot flies back at the nearest enemy ahead (3x), only with a favoured weapon', () => {
    for (const [weapon, k] of [['iron_spear', ORT_REFLECT_AFFINITY], ['mirror_buckler', ORT_REFLECT_AFFINITY], [NEUTRAL, 0]] as const) {
      const { w, target } = sim('ort', weapon);
      const g = w.entityById(w.vars.rfOrtGuard) as RefugeGuard;
      const behind = dummy(w, 30, 96);
      w.player.ember = 0;
      const hp = target.hp, hpBehind = behind.hp;
      const b = shot(w, g);
      idle(w, 1);
      expect(b.dead).toBe(true);
      expect(hp - target.hp, weapon).toBeCloseTo(w.player.stats.damage * k, 5);
      expect(behind.hp).toBe(hpBehind);
      expect(w.player.ember).toBe(4); // the block's own charge, nothing from the returned shot
      const before = stateHash(w);
      g.draw(w.renderer, w);
      expect(stateHash(w)).toBe(before);
    }
  });
});

describe('미라 — 묶는 인장', () => {
  it('the enemy the seal opened on is pulsed every 0.2 s; the rest of the seal keeps 0.5 s', () => {
    for (const [weapon, pinned] of [['brass_revolver', true], [NEUTRAL, false]] as const) {
      const { w, target } = sim('mira', weapon);
      const other = dummy(w, target.x + 12, target.y + 10);
      idle(w, 1);
      deal(w, target);
      idle(w, 1);
      const seal = w.entityById(w.vars.rfMiraSeal) as RefugeSeal;
      expect(seal.mem.anchor).toBe(target.id);
      expect(seal.pinned(w) === target, weapon).toBe(pinned);
      const hp = target.hp, hpOther = other.hp, pulse = seal.mem.damage * .2;
      idle(w, 120); // two seconds, inside the seal's 2.8 s
      const span = 2;
      const pinPulses = (hp - target.hp) / (pulse * MIRA_PIN_SHARE);
      if (pinned) expect(pinPulses, weapon).toBeGreaterThanOrEqual(span / MIRA_PIN_AFFINITY - 1);
      else expect((hp - target.hp) / pulse, weapon).toBeLessThanOrEqual(span / MIRA_PULSE + 1);
      expect((hpOther - other.hp) / pulse, weapon).toBeLessThanOrEqual(span / MIRA_PULSE + 1);
    }
  });

  it('the seal writes down a share of Mira\'s hits on the pinned enemy; its next pin pulse carries them', () => {
    for (const [weapon, share] of [['brass_revolver', MIRA_PIN_RECORD], [NEUTRAL, 0]] as const) {
      const { w, target } = sim('mira', weapon);
      const other = dummy(w, target.x + 12, target.y + 10);
      idle(w, 1);
      deal(w, target);
      idle(w, 13); // the pin pulse right after the seal opened has gone off
      const seal = w.entityById(w.vars.rfMiraSeal) as RefugeSeal;
      expect(seal.mem.written, weapon).toBe(0);
      deal(w, other, 50); // not the pinned one: nothing written
      expect(seal.mem.written, weapon).toBe(0);
      deal(w, target, 50);
      expect(seal.mem.written, weapon).toBeCloseTo(50 * share, 5);
      if (!share) continue;
      // exactly one pin pulse later: it carried the written share, and the page is blank again
      const hp = target.hp, pin = seal.mem.pin;
      while (seal.mem.pin === pin) idle(w, 1);
      expect(hp - target.hp, weapon).toBeCloseTo(seal.mem.damage * .2 * MIRA_PIN_SHARE + 50 * share, 5);
      expect(seal.mem.written).toBe(0);
      // a seal moved off its enemy (the dash) starts a blank page
      deal(w, target, 50);
      expect(seal.mem.written).toBeGreaterThan(0);
      w.withIds(() => REFUGE_DASHES[4].end!(w, w.player));
      expect(seal.mem.anchor).toBe(0);
      expect(seal.mem.written).toBe(0);
    }
  });

  it('a seal placed by the dash pins nobody; an anchor that walks out is released', () => {
    const { w, target } = sim('mira');
    w.withIds(() => REFUGE_DASHES[4].end!(w, w.player));
    idle(w, 1);
    const seal = w.entityById(w.vars.rfMiraSeal) as RefugeSeal;
    expect(seal.mem.anchor).toBe(0);
    expect(seal.pinned(w)).toBeUndefined();
    deal(w, target);
    idle(w, 1);
    expect(seal.pinned(w)).toBe(target);
    target.x = seal.x + 120;
    expect(seal.pinned(w)).toBeUndefined();
    const before = stateHash(w);
    seal.draw(w.renderer, w);
    expect(stateHash(w)).toBe(before);
  });
});

describe('the gain: +20-25 % over the same keeper and weapon without the affinity', () => {
  // short runs (6 s, the starter + a weapon of the class's other family); the full bench over
  // every weapon of each class lands each keeper's single-target and mid-build medians at
  // 1.20-1.25 (미라's 종·향로 are melee weapons: the seal opens on the swing or the ring)
  const pick: Record<string, string[]> = { tove: ['nail_carbine', 'thunder_mortar'], luen: ['amber_wand', 'chain_sickle'], ves: ['copper_sabre', 'twin_daggers'], mira: ['brass_revolver', 'resonance_bell'] };
  for (const id of Object.keys(pick)) it(`${id}: single target`, () => {
    const g = median(pick[id].map((wid) => gain(id, wid, 6)));
    if (process.env.AFFC_PRINT) console.log(`${id} single ${g.toFixed(3)}`);
    expect(g, id).toBeGreaterThanOrEqual(1.18);
    expect(g, id).toBeLessThanOrEqual(1.27);
  }, 60_000);

  // the same with a mid build (10 random 6-artifact builds): the upgrades are
  // kit effects, so they must keep their share when artifacts raise the weapon's output
  const mid = (seed: string) => {
    const pool = Artifacts.all().filter((a) => !a.hidden && !a.blessing);
    const rng = new RNG(seed);
    return Array.from({ length: 10 }, () => {
      const left = [...pool];
      return Array.from({ length: 6 }, () => {
        const c = rng.weighted(left, (a) => RARITY_WEIGHT[a.rarity as keyof typeof RARITY_WEIGHT])!;
        left.splice(left.indexOf(c), 1);
        return c.id;
      });
    });
  };
  for (const id of Object.keys(pick)) it(`${id}: mid build`, () => {
    const builds = mid('AFFC-MID');
    const g = median(pick[id].map((wid) => median(builds.map((b, i) => gain(id, wid, 8, b, false, `AFFC-MID-${wid}-${i}`)))));
    if (process.env.AFFC_PRINT) console.log(`${id} mid ${g.toFixed(3)}`);
    expect(g, id).toBeGreaterThanOrEqual(1.185);
    expect(g, id).toBeLessThanOrEqual(1.27);
  }, 120_000);

  // 오르트's value is the shield, so it is measured in boss fights (the boss drill above, as for
  // 보리 / 백구 in tests/affinity-b: floor 1-4 bosses at the floor's drill power, real hearts).
  // Full bench (ORT_BENCH=1: all seven 창 / 방패 weapons x 8 bosses x 6 seeds, 672 fights a
  // variant): fight time median x1.20 (x1.15 dawn_pike - x1.22 iron_spear), hearts lost per boss
  // median x1.21 (x1.15 - x1.23 javelin_bundle). At a flat x2 / x1.5 on floors 1-3 many fights
  // run into the 150 s cap and the ratios shrink (fight time x1.16 / x1.11, hearts x1.13 / x1.11;
  // the old starter crescent_bow: x1.13 / x1.07 at x2).
  // The shield is rarely saturated in boss fights (about 0.2 returned shots a second); a lone
  // shooter that keeps it saturated (below) shows the ceiling, x1.3-1.9 depending on the weapon.
  it('오르트: in boss fights the class shortens the fight and costs fewer hearts (short drill)', () => {
    const g = drillGain('ort', 'javelin_bundle', DRILL_BOSSES, ['A', 'B']);
    if (process.env.AFFC_PRINT) console.log(`ort drill javelin_bundle: ttk x${g.ttk.toFixed(3)} hearts x${g.net.toFixed(3)}`);
    expect(g.ttk).toBeGreaterThan(1.08);
    expect(g.net).toBeGreaterThan(1.05);
    // the ceiling only catches a runaway
    expect(g.ttk).toBeLessThan(1.5);
    expect(g.net).toBeLessThan(1.8);
  }, 180_000);

  // Here: the returned shots only exist when something shoots at the shield.
  it('오르트: with shots coming at the shield, the returned shots add damage (and nothing without them)', () => {
    if (!Enemies.has('__affc_turret')) {
      defineEnemy({
        ...Enemies.must(DUMMY_ID), id: '__affc_turret',
        *script(e, w) { for (;;) { yield .6; e.shootAt(w); } },
      });
    }
    // no shots: the shield has nothing to send back
    expect(gain('ort', 'javelin_bundle', 6)).toBeCloseTo(1, 2);
    const duel = (character: string, weapon: string) => {
      const r = measureDps({ character, weapon, seconds: 0, seed: 'AFFC-DUEL' });
      const w = r.world;
      const t = r.dummies[0];
      const turret = w.withIds(() => w.spawnEnemy('__affc_turret', t.x + 30, t.y))!;
      turret.dormant = 0;
      const before = w.run.stats.damageDealt;
      for (let i = 0; i < Math.round(8 / FIXED_DT); i++) w.update(FIXED_DT);
      return w.run.stats.damageDealt - before;
    };
    for (const weapon of ['javelin_bundle', 'iron_spear', 'aegis_cannon']) {
      const k = duel('ort', weapon) / duel(noAffinity('ort'), weapon);
      if (process.env.AFFC_PRINT) console.log(`ort duel ${weapon} ${k.toFixed(3)}`);
      expect(k, weapon).toBeGreaterThan(1.15);
    }
  }, 60_000);
});

// Full measurement (opt-in): every weapon of each damage keeper's class, single / crowd / mid
// build (6 random artifacts).
describe.skipIf(!process.env.AFFINITY_BENCH)('affinity bench (refuge keepers)', () => {
  it('prints the gains', () => {
    const pool = Artifacts.all().filter((a) => !a.hidden && !a.blessing);
    const rng = new RNG('AUDIT-MID');
    const builds = Array.from({ length: 10 }, () => {
      const left = [...pool];
      return Array.from({ length: 6 }, () => {
        const c = rng.weighted(left, (a) => RARITY_WEIGHT[a.rarity as keyof typeof RARITY_WEIGHT])!;
        left.splice(left.indexOf(c), 1);
        return c.id;
      });
    });
    const weapons: Record<string, string[]> = Object.fromEntries(['tove', 'luen', 'ves', 'mira'].map((id) => [id, classOf(id)]));
    const lines: string[] = [];
    for (const id of Object.keys(weapons)) {
      const s: number[] = [], m: number[] = [], c: number[] = [];
      for (const wid of weapons[id]) {
        s.push(gain(id, wid, 8, [], false, `AFF-${wid}`));
        c.push(gain(id, wid, 8, [], true, `AFF-${wid}`));
        m.push(median(builds.map((b, i) => gain(id, wid, 8, b, false, `AFF-${wid}-B${i}`))));
        lines.push(`${id} ${wid}: single ${s.at(-1)!.toFixed(3)} crowd ${c.at(-1)!.toFixed(3)} mid ${m.at(-1)!.toFixed(3)}`);
      }
      lines.push(`${id} median: single ${median(s).toFixed(3)} crowd ${median(c).toFixed(3)} mid ${median(m).toFixed(3)}`);
    }
    console.log(lines.join('\n'));
  }, 3_600_000);
});

// 오르트's full boss drill (opt-in): every weapon of 창 / 방패, fight time and hearts lost per boss.
describe.skipIf(!process.env.ORT_BENCH)('affinity bench (오르트 boss drill)', () => {
  it('prints the gains', () => {
    const seeds = ['ORTB-0', 'ORTB-1', 'ORTB-2', 'ORTB-3', 'ORTB-4', 'ORTB-5'];
    const t: number[] = [], h: number[] = [];
    const lines: string[] = [];
    for (const wid of classOf('ort')) {
      const g = drillGain('ort', wid, DRILL_BOSSES, seeds);
      t.push(g.ttk); h.push(g.net);
      lines.push(`ort ${wid}: ttk x${g.ttk.toFixed(3)} hearts x${g.net.toFixed(3)}`);
    }
    lines.push(`ort median: ttk x${median(t).toFixed(3)} hearts x${median(h).toFixed(3)}`);
    console.log(lines.join('\n'));
  }, 7_200_000);
});
