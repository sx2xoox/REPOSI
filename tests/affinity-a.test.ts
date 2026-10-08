// Favoured weapon classes of 리아 / 베른 / 세린 / 니엘 (CharacterDef.affinity, user 2026-10-08:
// weapons -15 %, a keeper holding its favoured class is 20–25 % more effective — through an
// upgrade of the keeper's own kit, not a flat damage bonus). Each class is made only of weapon
// families (game/weapon-families.ts) and named after them, so the green family label on a
// weapon's info line ("등급 · 계열 · 속성") tells the player whether it is favoured
// (user: "잘 나눠라 위에 무기 분류로 이해할 수 있게 해야한다"):
//   리아 등불              — the ember marks ignite on the 3rd hit and the spark bursts / burns 75 % harder
//   베른 검                — every momentum stack is worth +13.5 % attack speed instead of +6 %, held 2.4 s
//   세린 활·쇠뇌           — scent marks expose a weak spot: a 36 % critical roll on scented enemies
//   니엘 주술구 / 마도서·붓 — the void echo answers every 2nd attack and is a larger orb (90 % damage);
//                           attacks count on the keeper's beat, a slow one up to twice
// Each keeper: the class is exactly its families (starter included), the flag follows weapon
// swaps, the upgrade only works with the flag, and the measured gain against the same keeper
// without its affinity (same weapon, same seeds) sits in the band over every weapon of the class.

import './headless';
import { describe, expect, it } from 'vitest';
import { Artifacts, Characters, RARITY_WEIGHT, Weapons, defineCharacter, weaponMatchesAffinity } from '../src/game/defs';
import { WEAPON_FAMILIES, familyMembers, weaponFamily } from '../src/game/weapon-families';
import { RNG } from '../src/engine/rng';
import { StatMods, WEAPON_DAMAGE_SCALE } from '../src/game/stats';
import { FIXED_DT } from '../src/game/constants';
import { HELD } from '../src/game/seam';
import { Projectile } from '../src/game/projectile';
import { RELEASE_WEAPONS, measureDps } from './dpsharness';
import { isAttack } from '../src/content/items/lib';
import {
  RIA_LANTERN_WEAPONS, RIA_SPARK_DMG, RIA_SPARK_DMG_AFFINITY, RIA_SPARK_EMBER, RIA_SPARK_HITS, RIA_SPARK_HITS_AFFINITY, emberSpark, sparkHits,
} from '../src/content/characters/kit-ria';
import { BERN_DECAY_DELAY, BERN_DECAY_DELAY_AFFINITY, BERN_MAX_STACKS, BERN_STACK_FIRE, BERN_STACK_FIRE_AFFINITY, momentum, stackFire } from '../src/content/characters/kit-bern';
import { SERIN_MARK_CRIT_AFFINITY, isScented } from '../src/content/characters/kit-serin';
import {
  NIEL_BEAT_MAX, NIEL_ECHO_DMG, NIEL_ECHO_DMG_AFFINITY, NIEL_ECHO_EVERY, NIEL_ECHO_EVERY_AFFINITY, echoBeat, echoEvery, spawnEcho,
} from '../src/content/characters/kit-niel';
import type { World } from '../src/game/world';
import type { Enemy } from '../src/game/enemy';

const HANGUL = /[가-힣]/;

/** keeper -> its families, the class label, every favoured weapon (starter first) and look-alikes outside it */
const CLASSES: Record<string, { families: string[]; name: string; yes: string[]; no: string[] }> = {
  ria: {
    families: ['lantern'],
    name: '등불',
    yes: ['lantern_bolt', 'twin_lamp', 'wandering_lamp', 'dawn_lantern', 'mine_lantern'],
    // the rescue-lantern flail is a 둔기·도끼, the firefly tome a 마도서·붓
    no: ['lantern_flail', 'firefly_tome', 'void_gaze', 'hunter_bow', 'sentinel_blade'],
  },
  bern: {
    families: ['sword'],
    name: '검',
    yes: ['sentinel_blade', 'copper_sabre', 'moon_katana', 'obsidian_cleaver', 'rose_rapier', 'titan_greatsword'],
    // daggers, axes, chains and spears are other families, however close they fight
    no: ['twin_daggers', 'fang_blade', 'gatebreaker_maul', 'reaper_scythe', 'iron_spear', 'chain_sickle', 'lantern_bolt', 'hunter_bow'],
  },
  serin: {
    families: ['bow'],
    name: '활·쇠뇌',
    yes: [
      'hunter_bow', 'volley_crossbow', 'glacier_arbalest', 'silvermoon_longbow', 'repeater_crossbow', 'star_piercer',
      'sticky_crossbow', 'stasis_arbalest', 'crescent_bow', 'pearl_crossbow', 'thorn_shortbow',
    ],
    // the harpoon gun is a 총, javelins and knives are 투척
    no: ['harpoon_gun', 'javelin_bundle', 'throwing_knives', 'twin_daggers', 'lantern_bolt', 'brass_revolver'],
  },
  niel: {
    families: ['occult', 'tome'],
    name: '주술구 / 마도서·붓',
    yes: ['void_gaze', 'void_orbs', 'gravity_orb', 'star_launcher', 'tesla_stake', 'firefly_tome', 'ink_brush'],
    // wands and staves (the old 마법 무기 tag) are 마법봉 / 지팡이 now
    no: ['amber_wand', 'frost_wand', 'prism_staff', 'twin_lamp', 'lantern_bolt', 'great_hammer', 'hunter_bow', 'sentinel_blade'],
  },
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
  it('each class is exactly its families: every weapon of them (the starter included) and nothing else', () => {
    for (const [id, cls] of Object.entries(CLASSES)) {
      const c = Characters.must(id);
      const aff = c.affinity;
      expect(aff, `${id} affinity`).toBeDefined();
      // families only: the class reads from the family label on every weapon
      expect(aff!.families, `${id} families`).toEqual(cls.families);
      expect(aff!.ids ?? aff!.kinds ?? aff!.tags, `${id} has no id / kind / tag rule`).toBeUndefined();
      expect(cls.yes[0]).toBe(c.weapon);
      expect(cls.families.flatMap((f) => familyMembers(f)).sort(), `${id} class`).toEqual([...cls.yes].sort());
      for (const wid of cls.yes) {
        expect(Weapons.has(wid), wid).toBe(true);
        expect(weaponMatchesAffinity(aff, Weapons.must(wid)), `${id} ${wid}`).toBe(true);
      }
      for (const wid of cls.no) expect(weaponMatchesAffinity(aff, Weapons.must(wid)), `${id} ${wid}`).toBe(false);
      for (const d of Weapons.all()) {
        const f = weaponFamily(d.id);
        expect(weaponMatchesAffinity(aff, d), `${id} ${d.id} (${f?.name})`).toBe(!!f && cls.families.includes(f.id));
      }
    }
    // 리아's lantern weapons are the 등불 family
    expect(RIA_LANTERN_WEAPONS).toEqual(familyMembers('lantern'));
  });

  it('classes are named after their families, with one-line descriptions and no flat damage or attack-speed bonus', () => {
    for (const [id, cls] of Object.entries(CLASSES)) {
      const aff = Characters.must(id).affinity!;
      expect(aff.name).toBe(cls.name);
      expect(aff.name).toBe(aff.families!.map((f) => WEAPON_FAMILIES.find((x) => x.id === f)!.name).join(' / '));
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
    for (const [id, { yes, no }] of Object.entries(CLASSES)) {
      const { w } = sim(id, yes[0]);
      const p = w.player;
      expect(p.flags.has('affinity'), `${id} starter`).toBe(true);
      expect(w.items.affinityActive).toBe(true);
      p.equipWeapon(w, OTHER[id]);
      expect(p.flags.has('affinity'), `${id} ${OTHER[id]}`).toBe(false);
      for (const wid of yes.slice(1)) {
        p.equipWeapon(w, wid);
        expect(p.flags.has('affinity'), `${id} ${wid}`).toBe(true);
      }
      // a look-alike from another family turns it off again
      p.equipWeapon(w, no[0]);
      expect(p.flags.has('affinity'), `${id} ${no[0]}`).toBe(false);
    }
  });
});

describe('리아 — 등불', () => {
  it('lantern weapons ignite the marks on the 3rd hit; others (the lantern flail too) keep the 4th', () => {
    const { w } = sim('ria', 'lantern_bolt');
    expect(sparkHits(w)).toBe(RIA_SPARK_HITS_AFFINITY);
    w.player.equipWeapon(w, 'hunter_bow');
    expect(sparkHits(w)).toBe(RIA_SPARK_HITS);
    w.player.equipWeapon(w, 'mine_lantern');
    expect(sparkHits(w)).toBe(RIA_SPARK_HITS_AFFINITY);
    w.player.equipWeapon(w, 'lantern_flail');
    expect(sparkHits(w)).toBe(RIA_SPARK_HITS);
  });

  it('the lantern spark bursts and burns 75 % harder, and the ember refund per mark stays the same', () => {
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
    expect(RIA_SPARK_DMG_AFFINITY / RIA_SPARK_DMG).toBeCloseTo(1.75, 5);
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

describe('베른 — 검', () => {
  it('each momentum stack is worth +13.5 % attack speed with a sword, +6 % otherwise (daggers too)', () => {
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
    p.equipWeapon(w, 'twin_daggers');
    expect(stackFire(w)).toBe(BERN_STACK_FIRE);
    p.equipWeapon(w, 'titan_greatsword'); // a charge weapon but a 검: the stacks speed up its heave
    expect(stackFire(w)).toBe(BERN_STACK_FIRE_AFFINITY);
  });

  it('momentum holds on longer with a sword before it starts to drop', () => {
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
    expect(hold('rose_rapier')).toBe(BERN_MAX_STACKS);
    expect(hold('lantern_bolt')).toBeLessThan(BERN_MAX_STACKS);
    expect(hold('twin_daggers')).toBeLessThan(BERN_MAX_STACKS);
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

  it('a bow or crossbow adds a weak-spot critical chance on scented enemies only', () => {
    for (const weapon of ['hunter_bow', 'pearl_crossbow']) {
      const bow = critRate(weapon, true);
      const expected = bow.base + (1 - bow.base) * SERIN_MARK_CRIT_AFFINITY;
      expect(bow.rate, weapon).toBeGreaterThan(expected - 0.06);
      expect(bow.rate, weapon).toBeLessThan(expected + 0.06);
    }
    const unmarked = critRate('hunter_bow', false);
    expect(unmarked.rate).toBeLessThan(unmarked.base + 0.05);
    const lantern = critRate('lantern_bolt', true);
    expect(lantern.rate).toBeLessThan(lantern.base + 0.05);
    const harpoon = critRate('harpoon_gun', true); // a 총, not a bow
    expect(harpoon.rate).toBeLessThan(harpoon.base + 0.05);
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

describe('니엘 — 주술구 / 마도서·붓', () => {
  it('occult weapons and tomes call the echo every 2nd attack, a larger orb that bites harder', () => {
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
    p.equipWeapon(w, 'ink_brush');
    expect(echoEvery(w)).toBe(NIEL_ECHO_EVERY_AFFINITY);
  });

  it("attacks count on the keeper's beat: fast ones no faster than the beat, a slow one up to twice", () => {
    /** attacks `gaps` keeper beats apart (the first right away): echoes called and the counter left */
    const echoes = (weapon: string, gaps: number[]): { n: number; counter: number } => {
      const { w } = sim('niel', weapon);
      for (const e of [...w.enemies]) w.killEnemy(e);
      w.inputSource = (_ww, _p, out) => {
        out.mx = out.my = out.ax = out.ay = 0;
        out.held = 0;
        out.pressed = 0;
      };
      w.update(FIXED_DT);
      let n = 0;
      const spawn = w.spawn.bind(w);
      w.spawn = ((e: Parameters<World['spawn']>[0]) => {
        if (e instanceof Projectile && e.behaviors.some((b) => b.id === 'void_echo')) n++;
        return spawn(e);
      }) as World['spawn'];
      for (const gap of gaps) {
        step(w, gap * echoBeat(w));
        w.items.onAttack(0);
      }
      return { n, counter: w.vars.__nielAtk ?? 0 };
    };
    expect(NIEL_BEAT_MAX).toBe(2);
    // outside the class (every 4th): eleven quick attacks over ~2.4 beats count as ~3.4 — no echo yet
    const quick = echoes('great_hammer', [0, ...Array(10).fill(0.25)]);
    expect(quick.n).toBe(0);
    expect(quick.counter).toBeGreaterThanOrEqual(3);
    expect(quick.counter).toBeLessThan(4);
    // slow, heavy attacks count two beats each (capped however long the gap): every 2nd one echoes
    expect(echoes('great_hammer', [0, 3, 3, 3, 3])).toEqual({ n: 2, counter: 1 });
    expect(echoes('great_hammer', [0, 9, 9, 9, 9])).toEqual({ n: 2, counter: 1 });
    // the favoured gravity orb (one slow orb at a time) echoes on every attack after the first
    expect(echoes('gravity_orb', [0, 3, 3, 3, 3]).n).toBe(4);
    expect(echoes('void_gaze', [0, 1.05, 1.05, 1.05]).n).toBe(2);
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

/**
 * Hold-and-release weapons (the harness bot lets go on a fixed 1.1 s cycle, which hides any
 * faster draw): hold until fully drawn, let go for a frame, as a player answering the ready sound.
 */
function releaseDps(character: string, weapon: string, artifacts: string[], crowd: boolean, seed: string, dist?: number): number {
  const w = measureDps({ character, weapon, artifacts, crowd, seconds: 0, seed, dist }).world;
  const bot = w.inputSource;
  let release = false;
  w.inputSource = (ww, p, out) => {
    bot(ww, p, out);
    const st = ww.player.weapon;
    if (release) {
      out.held &= ~HELD.fire;
      release = false;
      return;
    }
    out.held |= HELD.fire;
    if (st.mem.drawing && st.charge >= 1) release = true;
  };
  const d0 = w.run.stats.damageDealt;
  step(w, SECS);
  return (w.run.stats.damageDealt - d0) / SECS;
}

function dps(character: string, weapon: string, artifacts: string[], seed: string, crowd = false): number {
  const d = Weapons.must(weapon);
  const close = d.kind === 'melee' || weapon === 'titan_greatsword';
  let sum = 0;
  for (const s of [`${seed}-a`, `${seed}-b`]) {
    if (RELEASE_WEAPONS.has(weapon)) {
      const a = releaseDps(character, weapon, artifacts, crowd, s);
      sum += close ? a : Math.max(a, releaseDps(character, weapon, artifacts, crowd, s, 40));
      continue;
    }
    const a = measureDps({ character, weapon, artifacts, crowd, seconds: SECS, seed: s }).dps;
    sum += close ? a : Math.max(a, measureDps({ character, weapon, artifacts, crowd, seconds: SECS, dist: 40, seed: s }).dps);
  }
  return sum / 2;
}

describe('measured gain of the favoured class: same keeper and weapon, with vs without the affinity, every weapon of the class', () => {
  const mids = builds('AFF-A-MID', 6, 6);
  for (const [id, { yes: weapons }] of Object.entries(CLASSES)) {
    it(`${id}: single target and mid builds land in the 20–25 % band, and no favoured weapon is left without the upgrade`, () => {
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
      const row = weapons.map((wid, i) => `${wid} ${single[i].toFixed(3)}/${crowd[i].toFixed(3)}/${mid[i].toFixed(3)}`);
      console.log(`[affinity-a] ${id} (single/crowd/mid) ${row.join(' | ')} -> median single ${s.toFixed(3)} crowd ${median(crowd).toFixed(3)} mid ${m.toFixed(3)}`);
      // the 1.20–1.25 target with a little room for these shorter runs
      expect(s).toBeGreaterThanOrEqual(1.17);
      expect(s).toBeLessThanOrEqual(1.29);
      expect(m).toBeGreaterThanOrEqual(1.17);
      expect(m).toBeLessThanOrEqual(1.29);
      // every favoured weapon really gets the upgrade (no dead member of the class)
      for (let i = 0; i < weapons.length; i++) expect(Math.max(single[i], mid[i]), `${id} ${weapons[i]}`).toBeGreaterThanOrEqual(1.1);
    }, 300_000);
  }
});
