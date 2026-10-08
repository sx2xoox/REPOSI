// Favoured weapons of the five refuge keepers (토브 / 루엔 / 베스 / 오르트 / 미라).
// Holding a weapon of the keeper's class upgrades the keeper's own device, never the
// weapon's damage: 토브's charges relay (full on the new carrier, a weaker splash around it),
// 루엔 ties a double knot over five links, 베스's other hand repeats every support technique
// on the same enemy, 오르트's shield grows broader with a third plate and sends blocked shots
// back, 미라's seal pins the enemy it opened on and writes down a share of her hits on it.
// The measured gain is about +20-25 % over the same keeper and weapon without the affinity
// (short runs here; the full dps bench: AFFINITY_BENCH=1 npx vitest run tests/affinity-c;
// 오르트's is measured in boss fights, see the comment on its gain test).

import './headless';
import { describe, it, expect } from 'vitest';
import { Characters, Enemies, RARITY_WEIGHT, Artifacts, Weapons, defineCharacter, defineEnemy, weaponMatchesAffinity } from '../src/game/defs';
import { Projectile } from '../src/game/projectile';
import { FIXED_DT } from '../src/game/constants';
import { Tile } from '../src/game/tiles';
import { RNG } from '../src/engine/rng';
import { swapWeapons } from '../src/game/weaponslots';
import { stateHash } from '../src/game/statehash';
import type { World } from '../src/game/world';
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

const FAVOURED: Record<string, string[]> = {
  tove: ['nail_carbine', 'brass_revolver', 'sunset_rifle', 'gatekeeper_shotgun', 'bell_blunderbuss', 'ember_musket', 'harpoon_gun', 'firework_barrel', 'sticky_crossbow', 'mine_lantern', 'thunder_mortar', 'comet_tube'],
  luen: ['amber_wand', 'tide_staff', 'cinder_sceptre', 'stormhorn_rod', 'frost_wand', 'bubble_wand', 'ink_brush', 'thorn_whip', 'chain_sickle'],
  ves: ['copper_sabre', 'rose_rapier', 'moon_katana', 'fang_blade', 'twin_daggers', 'throwing_knives', 'dusk_knives', 'return_blade'],
  ort: ['crescent_bow', 'mirror_buckler', 'aegis_cannon', 'iron_spear', 'fang_spear', 'dawn_pike', 'comet_pike', 'javelin_bundle', 'rose_rapier'],
  mira: ['brass_revolver', 'twin_lamp', 'stasis_arbalest', 'gravity_orb', 'ink_brush', 'firefly_tome', 'constellation_staff'],
};
const OTHERS: Record<string, string[]> = {
  tove: ['amber_wand', 'copper_sabre', 'hunter_bow', 'crescent_bow', 'scatter_horn', NEUTRAL],
  luen: ['shepherd_crook', 'constellation_staff', 'prism_staff', 'nail_carbine', NEUTRAL],
  ves: ['sentinel_blade', 'iron_spear', 'obsidian_cleaver', 'brass_revolver', NEUTRAL],
  ort: ['hunter_bow', 'pearl_crossbow', 'sentinel_blade', 'nail_carbine', NEUTRAL],
  mira: ['nail_carbine', 'prism_staff', 'amber_wand', 'hunter_bow', NEUTRAL],
};

describe('refuge keepers: favoured weapon classes', () => {
  it('each keeper has a short Korean class name and a one-line description of its upgrade', () => {
    for (const [i, id] of IDS.entries()) {
      const aff = Characters.must(id).affinity!;
      expect(aff, id).toBe(REFUGE_AFFINITIES[i]);
      expect(aff.name.length, id).toBeLessThanOrEqual(6);
      expect(aff.name, id).toMatch(/[가-힣]/);
      expect(aff.desc, id).toMatch(/[가-힣]/);
      expect(aff.desc.length, id).toBeLessThanOrEqual(45); // two short lines on the select screen
      // the upgrade is the keeper's own device, not a weapon stat bonus
      expect(aff.stats, id).toBeUndefined();
      for (const wid of aff.ids ?? []) expect(Weapons.has(wid), `${id} ${wid}`).toBe(true);
    }
  });

  it('the favoured class matches the starter and the right weapons, nothing else listed here', () => {
    for (const id of IDS) {
      const aff = Characters.must(id).affinity;
      expect(weaponMatchesAffinity(aff, Weapons.must(Characters.must(id).weapon)), `${id} starter`).toBe(true);
      for (const wid of FAVOURED[id]) expect(weaponMatchesAffinity(aff, Weapons.must(wid)), `${id} ${wid}`).toBe(true);
      for (const wid of OTHERS[id]) expect(weaponMatchesAffinity(aff, Weapons.must(wid)), `${id} ${wid}`).toBe(false);
    }
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
    for (const [weapon, max] of [['crescent_bow', ORT_CHARGES_AFFINITY], [NEUTRAL, ORT_CHARGES]] as const) {
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
    for (const [weapon, caught] of [['crescent_bow', true], [NEUTRAL, false]] as const) {
      const { w } = sim('ort', weapon);
      const g = w.entityById(w.vars.rfOrtGuard) as RefugeGuard;
      expect(g.width(), weapon).toBe(caught ? ORT_WIDTH_AFFINITY : ORT_WIDTH);
      const b = w.withIds(() => w.spawn(new Projectile({ team: 'enemy', x: g.x + 4, y: g.y + 22, angle: Math.PI, speed: 100, damage: 1 })));
      idle(w, 1);
      expect(b.dead, weapon).toBe(caught);
    }
  });

  it('a blocked shot flies back at the nearest enemy ahead (3x), only with a favoured weapon', () => {
    for (const [weapon, k] of [['crescent_bow', ORT_REFLECT_AFFINITY], [NEUTRAL, 0]] as const) {
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
  // short runs (6 s, starter + one more favoured weapon); the full bench lands each keeper's
  // single-target and mid-build medians at 1.20-1.25 (미라's second weapon is one whose
  // artifacts outgrow a keeper-damage pulse; the written share of her hits keeps it in band)
  const pick: Record<string, string[]> = { tove: ['nail_carbine', 'thunder_mortar'], luen: ['amber_wand', 'frost_wand'], ves: ['copper_sabre', 'twin_daggers'], mira: ['brass_revolver', 'constellation_staff'] };
  for (const id of Object.keys(pick)) it(`${id}: single target`, () => {
    const g = median(pick[id].map((wid) => gain(id, wid, 6)));
    if (process.env.AFFC_PRINT) console.log(`${id} single ${g.toFixed(3)}`);
    expect(g, id).toBeGreaterThanOrEqual(1.18);
    expect(g, id).toBeLessThanOrEqual(1.27);
  }, 60_000);

  // the same with a mid build (10 random 6-artifact builds, starter weapon): the upgrades are
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

  // 오르트's value is the shield, so it is measured in boss fights (tests/boss-bench bossFight with
  // hearts and damage taken recorded, floor 1-3 bosses x 6 seeds, 3 ranged + 4 melee favoured
  // weapons; the melee bot holds 14-28 px): hearts lost per boss kill (= time to kill x damage
  // taken per second) median x1.22 at x2 power and x1.23 at x1.5, time to kill x1.19 / x1.24.
  // The shield is rarely saturated in boss fights (about 0.2 returned shots a second); a lone
  // shooter that keeps it saturated (below) shows the ceiling, x1.3-1.9 depending on the weapon.
  // Here: the returned shots only exist when something shoots at the shield.
  it('오르트: with shots coming at the shield, the returned shots add damage (and nothing without them)', () => {
    if (!Enemies.has('__affc_turret')) {
      defineEnemy({
        ...Enemies.must(DUMMY_ID), id: '__affc_turret',
        *script(e, w) { for (;;) { yield .6; e.shootAt(w); } },
      });
    }
    // no shots: the shield has nothing to send back
    expect(gain('ort', 'crescent_bow', 6)).toBeCloseTo(1, 2);
    const duel = (character: string) => {
      const r = measureDps({ character, weapon: 'crescent_bow', seconds: 0, seed: 'AFFC-DUEL' });
      const w = r.world;
      const t = r.dummies[0];
      const turret = w.withIds(() => w.spawnEnemy('__affc_turret', t.x + 30, t.y))!;
      turret.dormant = 0;
      const before = w.run.stats.damageDealt;
      for (let i = 0; i < Math.round(8 / FIXED_DT); i++) w.update(FIXED_DT);
      return w.run.stats.damageDealt - before;
    };
    expect(duel('ort') / duel(noAffinity('ort'))).toBeGreaterThan(1.15);
  }, 60_000);
});

// Full measurement (opt-in): per weapon single / crowd / mid build (6 random artifacts).
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
    const weapons: Record<string, string[]> = {
      tove: ['nail_carbine', 'brass_revolver', 'thunder_mortar', 'gatekeeper_shotgun'], luen: ['amber_wand', 'tide_staff', 'frost_wand', 'thorn_whip'],
      ves: ['copper_sabre', 'fang_blade', 'twin_daggers', 'throwing_knives'], mira: ['brass_revolver', 'gravity_orb', 'twin_lamp', 'ink_brush'],
    };
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
