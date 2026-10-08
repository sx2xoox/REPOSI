// Favoured weapon classes of 리아 / 베른 / 세린 / 니엘 (CharacterDef.affinity, user 2026-10-08:
// weapons -15 %, a keeper holding its favoured class is 20–25 % more effective — through an
// upgrade of the keeper's own kit, not a flat damage bonus):
//   리아 등불 무기  — the ember marks ignite on the 3rd hit and the spark bursts / burns 85 % harder
//                    (lantern weapons by id: lantern_bolt, twin_lamp, wandering_lamp, dawn_lantern, lantern_flail)
//   베른 근접 무기  — every momentum stack is worth +13.5 % attack speed instead of +6 %, held 2.4 s
//   세린 활·쇠뇌    — scent marks expose a weak spot: a 40 % critical roll on scented enemies
//   니엘 마법 무기  — the void echo answers every 2nd attack and is a larger orb (90 % damage)
// Each keeper: the class matches the right weapons (incl. the starter), the flag follows weapon
// swaps, the upgrade only works with the flag, and the measured gain against the same keeper
// without its affinity (same weapon, same seeds) sits in the band.

import './headless';
import { describe, expect, it } from 'vitest';
import { Artifacts, Characters, RARITY_WEIGHT, Weapons, defineCharacter, weaponMatchesAffinity } from '../src/game/defs';
import { RNG } from '../src/engine/rng';
import { StatMods, WEAPON_DAMAGE_SCALE } from '../src/game/stats';
import { FIXED_DT } from '../src/game/constants';
import { measureDps } from './dpsharness';
import { isAttack } from '../src/content/items/lib';
import {
  RIA_LANTERN_WEAPONS, RIA_SPARK_DMG, RIA_SPARK_DMG_AFFINITY, RIA_SPARK_EMBER, RIA_SPARK_HITS, RIA_SPARK_HITS_AFFINITY, emberSpark, sparkHits,
} from '../src/content/characters/kit-ria';
import { BERN_DECAY_DELAY, BERN_DECAY_DELAY_AFFINITY, BERN_MAX_STACKS, BERN_STACK_FIRE, BERN_STACK_FIRE_AFFINITY, momentum, stackFire } from '../src/content/characters/kit-bern';
import { SERIN_MARK_CRIT_AFFINITY, isScented } from '../src/content/characters/kit-serin';
import { NIEL_ECHO_DMG, NIEL_ECHO_DMG_AFFINITY, NIEL_ECHO_EVERY, NIEL_ECHO_EVERY_AFFINITY, echoEvery, spawnEcho } from '../src/content/characters/kit-niel';
import type { World } from '../src/game/world';
import type { Enemy } from '../src/game/enemy';

const HANGUL = /[가-힣]/;

/** keeper -> [favoured weapons (starter first), weapons outside the class] */
const CLASSES: Record<string, [string[], string[]]> = {
  // 지뢰 등잔 is lantern-shaped but its mine blasts are not attacks (no marks to upgrade); the
  // firefly tome is a book of firefly spirits, not a lantern
  ria: [['lantern_bolt', 'twin_lamp', 'wandering_lamp', 'dawn_lantern', 'lantern_flail'], ['mine_lantern', 'firefly_tome', 'void_gaze', 'hunter_bow', 'sentinel_blade']],
  bern: [['sentinel_blade', 'copper_sabre', 'twin_daggers', 'moon_katana', 'titan_greatsword', 'gatebreaker_maul'], ['lantern_bolt', 'hunter_bow', 'void_gaze']],
  serin: [['hunter_bow', 'crescent_bow', 'repeater_crossbow', 'star_piercer', 'pearl_crossbow', 'silvermoon_longbow'], ['twin_daggers', 'lantern_bolt', 'brass_revolver']],
  niel: [['void_gaze', 'lantern_bolt', 'amber_wand', 'frost_wand', 'prism_staff'], ['great_hammer', 'hunter_bow', 'sentinel_blade']],
};
/** a weapon outside each keeper's class, for swap tests */
const OTHER: Record<string, string> = { ria: 'hunter_bow', bern: 'lantern_bolt', serin: 'lantern_bolt', niel: 'great_hammer' };

/** The same keeper without its favoured class (the measuring baseline). */
function noAffinity(id: string): string {
  const cid = `__noaff_${id}`;
  if (!Characters.has(cid)) defineCharacter({ ...Characters.must(id), id: cid, affinity: undefined });
  return cid;
}

/** A started world (floor-1 start room, dummies placed) with no input yet, and its center dummy. */
function sim(character: string, weapon: string, crowd = false): { w: World; dummy: Enemy } {
  const r = measureDps({ character, weapon, seconds: 0, crowd });
  return { w: r.world, dummy: r.dummies[0] };
}

function step(w: World, seconds: number): void {
  for (let i = 0, n = Math.round(seconds / FIXED_DT); i < n; i++) w.update(FIXED_DT);
}

describe('favoured weapon classes (리아 / 베른 / 세린 / 니엘)', () => {
  it('each class matches its weapons, the starter included, and nothing outside it', () => {
    for (const [id, [yes, no]] of Object.entries(CLASSES)) {
      const c = Characters.must(id);
      const aff = c.affinity;
      expect(aff, `${id} affinity`).toBeDefined();
      expect(yes[0]).toBe(c.weapon);
      for (const wid of yes) expect(weaponMatchesAffinity(aff, Weapons.must(wid)), `${id} ${wid}`).toBe(true);
      for (const wid of no) expect(weaponMatchesAffinity(aff, Weapons.must(wid)), `${id} ${wid}`).toBe(false);
    }
    // 리아's lantern weapons are named by id: every lantern / lamp weapon and nothing else
    expect(Characters.must('ria').affinity!.ids).toEqual(RIA_LANTERN_WEAPONS);
    for (const wid of RIA_LANTERN_WEAPONS) expect(Weapons.has(wid), wid).toBe(true);
  });

  it('short Korean names, one-line descriptions, and no flat damage or attack-speed bonus', () => {
    for (const id of Object.keys(CLASSES)) {
      const aff = Characters.must(id).affinity!;
      expect(aff.name).toMatch(HANGUL);
      expect(aff.name.length, `${id} name`).toBeLessThanOrEqual(6);
      expect(aff.desc).toMatch(HANGUL);
      expect(aff.desc.length, `${id} desc fits two select-screen lines`).toBeLessThanOrEqual(60);
      const m = new StatMods();
      aff.stats?.(m);
      for (const k of ['damage', 'fireRate', 'pierce', 'shots'] as const) {
        expect(m.mul[k] ?? 1, `${id} ${k} x`).toBe(1);
        expect(m.add[k] ?? 0, `${id} ${k} +`).toBe(0);
      }
    }
  });

  it('the affinity flag follows the held weapon through swaps', () => {
    for (const [id, [yes]] of Object.entries(CLASSES)) {
      const { w } = sim(id, yes[0]);
      const p = w.player;
      expect(p.flags.has('affinity'), `${id} starter`).toBe(true);
      expect(w.items.affinityActive).toBe(true);
      p.equipWeapon(w, OTHER[id]);
      expect(p.flags.has('affinity'), `${id} ${OTHER[id]}`).toBe(false);
      p.equipWeapon(w, yes[1]);
      expect(p.flags.has('affinity'), `${id} ${yes[1]}`).toBe(true);
    }
  });
});

describe('리아 — 등불 무기', () => {
  it('lantern weapons ignite the marks on the 3rd hit; others keep the 4th', () => {
    const { w } = sim('ria', 'lantern_bolt');
    expect(sparkHits(w)).toBe(RIA_SPARK_HITS_AFFINITY);
    w.player.equipWeapon(w, 'hunter_bow');
    expect(sparkHits(w)).toBe(RIA_SPARK_HITS);
  });

  it('the lantern spark bursts and burns 85 % harder, and the ember refund per mark stays the same', () => {
    const burst = (weapon: string) => {
      const { w, dummy } = sim('ria', weapon);
      w.update(FIXED_DT);
      const p = w.player;
      p.stats.critChance = 0; // compare the bursts themselves
      p.ember = 0;
      const d0 = w.run.stats.damageDealt;
      emberSpark(w, dummy);
      return { dealt: w.run.stats.damageDealt - d0, ember: p.ember, marks: sparkHits(w), dmg: p.stats.damage };
    };
    const lantern = burst('lantern_bolt');
    const bow = burst('hunter_bow');
    expect(lantern.dealt / lantern.dmg).toBeCloseTo((bow.dealt / bow.dmg) * (RIA_SPARK_DMG_AFFINITY / RIA_SPARK_DMG), 5);
    expect(bow.ember).toBeCloseTo(RIA_SPARK_EMBER, 5);
    expect(lantern.ember / lantern.marks).toBeCloseTo(bow.ember / bow.marks, 5);
  });

  it('twelve plain weapon shots ignite four sparks with a lantern, three without', () => {
    const sparks = (weapon: string) => {
      const { w, dummy } = sim('ria', weapon);
      w.update(FIXED_DT);
      const p = w.player;
      p.stats.critChance = 0;
      let n = 0;
      for (let i = 0; i < 12; i++) {
        // one plain weapon shot (weapons deal WEAPON_DAMAGE_SCALE of the keeper's damage)
        w.applyHit(dummy, { damage: p.stats.damage * WEAPON_DAMAGE_SCALE, kind: 'projectile', attacker: p });
        if (dummy.mem.__riaMarks === 0) n++;
      }
      return n;
    };
    expect(sparks('lantern_bolt')).toBe(12 / RIA_SPARK_HITS_AFFINITY);
    expect(sparks('hunter_bow')).toBe(12 / RIA_SPARK_HITS);
  });

  it('the real hand lantern ignites on its 3rd shot, the 4th without the class', () => {
    // shots fired at the dummy until two sparks: the weapon damage scale must not stretch the count
    const shotsPerSpark = (character: string) => {
      const { w, dummy } = sim(character, 'lantern_bolt');
      const p = w.player;
      const seq: string[] = [];
      const orig = w.applyHit.bind(w);
      w.applyHit = (target, hit) => {
        if (target === dummy && hit.procs?.includes('ria_spark')) seq.push('s');
        else if (target === dummy && isAttack(hit)) seq.push('a');
        return orig(target, hit);
      };
      for (let i = 0; i < Math.round(8 / FIXED_DT) && seq.filter((x) => x === 's').length < 2; i++) {
        p.stats.critChance = 0;
        w.update(FIXED_DT);
      }
      return seq.join('').split('s').slice(0, 2).map((run) => run.length);
    };
    expect(shotsPerSpark('ria')).toEqual([RIA_SPARK_HITS_AFFINITY, RIA_SPARK_HITS_AFFINITY]);
    expect(shotsPerSpark(noAffinity('ria'))).toEqual([RIA_SPARK_HITS, RIA_SPARK_HITS]);
  });
});

describe('베른 — 근접 무기', () => {
  it('each momentum stack is worth +13.5 % attack speed with a melee weapon, +6 % otherwise', () => {
    const { w } = sim('bern', 'sentinel_blade');
    const p = w.player;
    expect(stackFire(w)).toBe(BERN_STACK_FIRE_AFFINITY);
    const base = p.stats.fireRate;
    w.vars.__bernStacks = BERN_MAX_STACKS;
    w.items.recomputeStats();
    expect(p.stats.fireRate / base).toBeCloseTo(1 + BERN_MAX_STACKS * BERN_STACK_FIRE_AFFINITY, 5);
    p.equipWeapon(w, 'lantern_bolt');
    expect(stackFire(w)).toBe(BERN_STACK_FIRE);
    expect(p.stats.fireRate / base).toBeCloseTo(1 + BERN_MAX_STACKS * BERN_STACK_FIRE, 5);
  });

  it('momentum holds on longer with a melee weapon before it starts to drop', () => {
    const hold = (weapon: string) => {
      const { w } = sim('bern', weapon);
      for (const e of [...w.enemies]) w.killEnemy(e);
      w.inputSource = (_ww, _p, out) => {
        out.mx = out.my = out.ax = out.ay = 0;
        out.held = 0;
        out.pressed = 0;
      };
      w.vars.__bernStacks = BERN_MAX_STACKS;
      w.vars.__bernHitAt = w.time;
      w.items.recomputeStats();
      step(w, (BERN_DECAY_DELAY + BERN_DECAY_DELAY_AFFINITY) / 2);
      return momentum(w);
    };
    expect(hold('sentinel_blade')).toBe(BERN_MAX_STACKS);
    expect(hold('lantern_bolt')).toBeLessThan(BERN_MAX_STACKS);
  });
});

describe('세린 — 활·쇠뇌', () => {
  function critRate(weapon: string, scented: boolean): { rate: number; base: number } {
    const { w, dummy } = sim('serin', weapon);
    w.update(FIXED_DT);
    const p = w.player;
    dummy.mem.__serinOpened = 1; // past the opening shot
    let crits = 0;
    const N = 600;
    for (let i = 0; i < N; i++) {
      dummy.mem.__scentUntil = scented ? w.time + 4 : -1;
      const hit: { damage: number; kind: 'projectile'; attacker: typeof p; crit?: boolean } = { damage: 10, kind: 'projectile', attacker: p };
      w.applyHit(dummy, hit);
      if (hit.crit) crits++;
    }
    return { rate: crits / N, base: p.stats.critChance };
  }

  it('a bow adds a weak-spot critical chance on scented enemies only', () => {
    const bow = critRate('hunter_bow', true);
    const expected = bow.base + (1 - bow.base) * SERIN_MARK_CRIT_AFFINITY;
    expect(bow.rate).toBeGreaterThan(expected - 0.06);
    expect(bow.rate).toBeLessThan(expected + 0.06);
    const unmarked = critRate('hunter_bow', false);
    expect(unmarked.rate).toBeLessThan(unmarked.base + 0.05);
    const lantern = critRate('lantern_bolt', true);
    expect(lantern.rate).toBeLessThan(lantern.base + 0.05);
  });

  it('the bow keeps only a flavour range bonus (no pierce from the class)', () => {
    const { w } = sim('serin', 'hunter_bow');
    const { w: w0 } = sim(noAffinity('serin'), 'hunter_bow');
    expect(w.player.weaponStats.pierce).toBe(w0.player.weaponStats.pierce);
    expect(w.player.weaponStats.range / w0.player.weaponStats.range).toBeCloseTo(1.1, 5);
    expect(w.player.stats.range).toBe(w0.player.stats.range);
  });

  it('scent still marks with any weapon', () => {
    const { w, dummy } = sim('serin', 'lantern_bolt');
    w.update(FIXED_DT);
    w.applyHit(dummy, { damage: 10, kind: 'projectile', attacker: w.player });
    expect(isScented(w, dummy)).toBe(true);
  });
});

describe('니엘 — 마법 무기', () => {
  it('arcane weapons call the echo every 2nd attack, a larger orb that bites harder', () => {
    const { w } = sim('niel', 'void_gaze');
    const p = w.player;
    expect(echoEvery(w)).toBe(NIEL_ECHO_EVERY_AFFINITY);
    const deep = spawnEcho(w, 0);
    expect(deep.damage).toBeCloseTo(p.stats.damage * NIEL_ECHO_DMG_AFFINITY, 5);
    p.equipWeapon(w, 'great_hammer');
    expect(echoEvery(w)).toBe(NIEL_ECHO_EVERY);
    const plain = spawnEcho(w, 0);
    expect(plain.damage).toBeCloseTo(p.stats.damage * NIEL_ECHO_DMG, 5);
    expect(deep.r).toBeGreaterThan(plain.r);
  });
});

// ------------------------------------------------------------------ measured gain
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** `n` builds of `k` distinct visible artifacts drawn with the loot rarity weights (as tests/item-audit). */
function builds(seed: string, n: number, k: number): string[][] {
  const pool = Artifacts.all().filter((a) => !a.hidden && !a.blessing);
  const rng = new RNG(seed);
  const out: string[][] = [];
  for (let b = 0; b < n; b++) {
    const left = [...pool];
    const pick: string[] = [];
    for (let i = 0; i < k && left.length; i++) {
      const c = rng.weighted(left, (a) => RARITY_WEIGHT[a.rarity as keyof typeof RARITY_WEIGHT]);
      if (!c) break;
      pick.push(c.id);
      left.splice(left.indexOf(c), 1);
    }
    out.push(pick);
  }
  return out;
}

const SECS = 12;
function dps(character: string, weapon: string, artifacts: string[], seed: string, crowd = false): number {
  const melee = Weapons.must(weapon).kind === 'melee';
  let sum = 0;
  for (const s of [`${seed}-a`, `${seed}-b`]) {
    const a = measureDps({ character, weapon, artifacts, crowd, seconds: SECS, seed: s }).dps;
    sum += melee ? a : Math.max(a, measureDps({ character, weapon, artifacts, crowd, seconds: SECS, dist: 40, seed: s }).dps);
  }
  return sum / 2;
}

/** keeper -> favoured weapons measured (starter first) */
const MEASURED: Record<string, string[]> = {
  ria: ['lantern_bolt', 'twin_lamp', 'wandering_lamp'],
  bern: ['sentinel_blade', 'copper_sabre', 'gatebreaker_maul'],
  serin: ['hunter_bow', 'crescent_bow', 'repeater_crossbow'],
  niel: ['void_gaze', 'amber_wand', 'prism_staff'],
};

describe('measured gain of the favoured class: same keeper and weapon, with vs without the affinity', () => {
  const mids = builds('AFF-A-MID', 6, 6);
  for (const [id, weapons] of Object.entries(MEASURED)) {
    it(`${id}: single target and mid builds land in the 20–25 % band`, () => {
      const plain = noAffinity(id);
      const single: number[] = [];
      const crowd: number[] = [];
      const mid: number[] = [];
      for (const wid of weapons) {
        const seed = `AFF-A-${id}-${wid}`;
        single.push(dps(id, wid, [], seed) / dps(plain, wid, [], seed));
        crowd.push(dps(id, wid, [], seed, true) / dps(plain, wid, [], seed, true));
        mid.push(median(mids.map((b, i) => dps(id, wid, b, `${seed}-m${i}`) / dps(plain, wid, b, `${seed}-m${i}`))));
      }
      const s = median(single);
      const m = median(mid);
      console.log(`[affinity-a] ${id} single ${single.map((x) => x.toFixed(3)).join(' ')} | crowd ${crowd.map((x) => x.toFixed(3)).join(' ')} | mid ${mid.map((x) => x.toFixed(3)).join(' ')} -> median single ${s.toFixed(3)} mid ${m.toFixed(3)}`);
      // the 1.20–1.25 target with a little room for these shorter runs
      expect(s).toBeGreaterThanOrEqual(1.17);
      expect(s).toBeLessThanOrEqual(1.29);
      expect(m).toBeGreaterThanOrEqual(1.17);
      expect(m).toBeLessThanOrEqual(1.29);
    }, 120_000);
  }
});
