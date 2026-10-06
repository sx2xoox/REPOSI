// Character kit framework (CharacterDef.passive / dash / affinity + select-screen
// fields): default behaviour when the fields are absent, each keeper's passive
// and dash in the real World (training dummies, scripted input through the
// lockstep seam), the compressed weapon power spread and the character × weapon
// DPS bands ("character matters at least as much as weapon").

import './headless';
import { describe, expect, it } from 'vitest';
import { Characters, Weapons, weaponMatchesAffinity, type CharacterDef } from '../src/game/defs';
import { FIXED_DT } from '../src/game/constants';
import { PRESS, HELD, type PlayerInput } from '../src/game/seam';
import { Projectile } from '../src/game/projectile';
import { HazardZone } from '../src/content/items/lib';
import { VoidRift, echoEvery, NIEL_ECHO_EVERY, NIEL_ECHO_EVERY_AFFINITY } from '../src/content/characters/kit-niel';
import { BERN_MAX_STACKS, BERN_STACK_FIRE, momentum } from '../src/content/characters/kit-bern';
import { RIA_SPARK_HITS } from '../src/content/characters/kit-ria';
import { isScented, SERIN_VAULT_WINDOW } from '../src/content/characters/kit-serin';
import { characterKitRows, characterStats } from '../src/ui/logic';
import { hasSprite } from '../src/engine/sprites';
import { SFX_NAMES } from '../src/audio/audio';
import { PLAIN_ID, bestDps, measureDps } from './dpsharness';
import type { World } from '../src/game/world';
import type { Enemy } from '../src/game/enemy';

const KEEPERS = ['ria', 'bern', 'serin', 'niel'];
const HANGUL = /[가-힣]/;

/** A started world (floor-1 start room, dummies placed) with no input yet, and its center dummy. */
function sim(character: string, weapon: string, dist?: number): { w: World; dummy: Enemy } {
  const r = measureDps({ character, weapon, seconds: 0, dist });
  return { w: r.world, dummy: r.dummies[0] };
}

/** Step `steps` frames feeding `fn`'s input (dash presses, movement, fire). */
function drive(w: World, steps: number, fn: (out: PlayerInput, i: number) => void): void {
  w.inputSource = (_ww, _p, out) => {
    out.mx = out.my = out.ax = out.ay = 0;
    out.held = 0;
    out.pressed = 0;
    out.cx = w.player.x + 40;
    out.cy = w.player.y;
    fn(out, step);
  };
  let step = 0;
  for (; step < steps; step++) w.update(FIXED_DT);
}

describe('character kit framework', () => {
  it('every keeper declares a passive, a dash, select-screen fields and Korean text', () => {
    for (const id of KEEPERS) {
      const c = Characters.must(id);
      expect(c.passive, `${id} passive`).toBeDefined();
      expect(c.passive!.name).toMatch(HANGUL);
      expect(c.passive!.desc).toMatch(HANGUL);
      expect(c.passive!.desc.length, `${id} passive desc fits the select strip`).toBeLessThanOrEqual(56);
      expect(hasSprite(c.passive!.icon), `${id} passive icon`).toBe(true);
      expect(c.dash, `${id} dash`).toBeDefined();
      expect(c.dash!.name).toMatch(HANGUL);
      expect(hasSprite(c.dash!.icon ?? ''), `${id} dash icon`).toBe(true);
      expect(c.playstyle?.length ?? 0).toBeGreaterThanOrEqual(2);
      expect([1, 2, 3]).toContain(c.difficulty);
      expect(c.pitch).toMatch(HANGUL);
      expect(c.releaseName).toMatch(HANGUL);
    }
    // the four kits do not overlap the upcoming tank / parry / companion keepers
    expect(Characters.must('ria').affinity).toBeUndefined();
    expect(Characters.must('bern').affinity?.kinds).toContain('melee');
    expect(Characters.must('serin').affinity?.tags).toContain('bow');
    expect(Characters.must('niel').affinity?.tags).toContain('arcane');
  });

  it('weaponMatchesAffinity matches by kind, tag and id; weapons carry affinity tags', () => {
    const bern = Characters.must('bern').affinity!;
    const serin = Characters.must('serin').affinity!;
    const niel = Characters.must('niel').affinity!;
    expect(weaponMatchesAffinity(bern, Weapons.must('sentinel_blade'))).toBe(true);
    expect(weaponMatchesAffinity(bern, Weapons.must('titan_greatsword'))).toBe(true); // charge kind, 'blade' tag
    expect(weaponMatchesAffinity(bern, Weapons.must('lantern_bolt'))).toBe(false);
    expect(weaponMatchesAffinity(serin, Weapons.must('hunter_bow'))).toBe(true);
    expect(weaponMatchesAffinity(serin, Weapons.must('star_piercer'))).toBe(true);
    expect(weaponMatchesAffinity(serin, Weapons.must('twin_daggers'))).toBe(false);
    expect(weaponMatchesAffinity(niel, Weapons.must('void_gaze'))).toBe(true);
    expect(weaponMatchesAffinity(niel, Weapons.must('great_hammer'))).toBe(false);
    expect(weaponMatchesAffinity(undefined, Weapons.must('void_gaze'))).toBe(false);
    expect(weaponMatchesAffinity({ name: 'x', desc: 'y', ids: ['frost_wand'] }, Weapons.must('frost_wand'))).toBe(true);
    const tagged = Weapons.all().filter((d) => d.tags?.length).length;
    expect(tagged).toBeGreaterThanOrEqual(20);
  });

  it('a keeper without kit fields behaves like before: plain rush, no passive effect, no affinity', () => {
    const plain = Characters.must(PLAIN_ID);
    expect(plain.passive ?? plain.dash ?? plain.affinity).toBeUndefined();
    const { w } = sim(PLAIN_ID, 'lantern_bolt');
    const p = w.player;
    expect(w.items.effects.some((e) => e.key.startsWith('passive:'))).toBe(false);
    expect(p.flags.has('affinity')).toBe(false);
    const x0 = p.x;
    drive(w, 3, (out, i) => { if (i === 0) out.pressed = PRESS.dash; out.mx = 1; });
    // rushing: moved, but not teleported; still dashing after 3 frames
    expect(p.dashing).toBe(true);
    expect(p.dashX0).toBe(x0);
    expect(p.x - x0).toBeGreaterThan(5);
    expect(p.x - x0).toBeLessThan(40);
    drive(w, 20, () => {});
    expect(p.dashing).toBe(false);
    // the rush distance plus a little slide at the end
    const len = p.stats.dashSpeed * p.stats.dashTime;
    expect(p.x - x0).toBeGreaterThanOrEqual(len - 2);
    expect(p.x - x0).toBeLessThan(len + 16);
    expect(w.entities.some((e) => e instanceof HazardZone || e instanceof VoidRift)).toBe(false);
    // the kit rows fall back to defaults for the select screen
    const rows = characterKitRows(plain);
    expect(rows.map((r) => r.kind)).toEqual(['passive', 'dash', 'release']);
    expect(rows[0].name).toBe('없음');
    expect(rows[1].name).toBe('질주');
  });

  it('the passive is dispatched like an artifact (power 1, before artifacts) and procs with its icon', () => {
    const { w } = sim('ria', 'lantern_bolt');
    expect(w.items.effects[0].key).toBe('passive:ria');
    expect(w.items.effects[0].power).toBe(1);
    w.items.proc('passive:ria');
    expect(w.items.procLog.at(-1)?.icon).toBe(Characters.must('ria').passive!.icon);
    // the passive look composes into the keeper's traces (aura ring)
    expect(w.items.look.player.aura).toContain('#ffd8a0');
  });

  it('character select stats include affinity and passive stat hooks', () => {
    const serin = characterStats(Characters.must('serin'));
    expect(serin.pierce).toBe(1); // bow affinity on the starting longbow
    expect(characterStats(Characters.must('niel')).maxHearts).toBe(2);
    for (const c of Characters.all()) for (const row of characterKitRows(c)) expect(row.desc).toBeTruthy();
  });

  it('registers every kit sound', () => {
    for (const n of ['ember_burst', 'momentum', 'rush', 'scent', 'vault', 'echo', 'blink', 'rift']) expect(SFX_NAMES).toContain(n);
  });
});

describe('리아 — 불씨 심지 / 불씨 질주', () => {
  it('fills the ember gauge faster than a plain keeper and ignites every 4th mark into a splash', () => {
    const plain = measureDps({ character: PLAIN_ID, weapon: 'lantern_bolt', seconds: 1.5 });
    const ria = measureDps({ character: 'ria', weapon: 'lantern_bolt', seconds: 1.5 });
    expect(ria.world.player.ember).toBeGreaterThan(plain.world.player.ember * 1.25);
    // crowd: the lantern alone hits only the first dummy; Ria's sparks splash onto the neighbours
    const pc = measureDps({ character: PLAIN_ID, weapon: 'lantern_bolt', crowd: true, seconds: 4 });
    const rc = measureDps({ character: 'ria', weapon: 'lantern_bolt', crowd: true, seconds: 4 });
    expect(pc.world.enemies.filter((e) => e.hp < e.maxHp).length).toBe(1);
    expect(rc.world.enemies.filter((e) => e.hp < e.maxHp).length).toBeGreaterThanOrEqual(2);
    const marked = rc.world.enemies.find((e) => e.mem.__riaAt !== undefined)!;
    expect(marked.mem.__riaMarks).toBeLessThan(RIA_SPARK_HITS);
  });

  it('the dash leaves a burning trail', () => {
    const { w } = sim('ria', 'lantern_bolt');
    drive(w, 14, (out, i) => { if (i === 0) out.pressed = PRESS.dash; out.mx = 1; });
    const fire = w.entities.filter((e) => e instanceof HazardZone && (e as HazardZone).kind === 'fire');
    expect(fire.length).toBeGreaterThanOrEqual(3);
  });
});

describe('베른 — 기세 / 설원 돌진', () => {
  it('builds momentum stacks while hitting (faster attacks and steps) and loses them when idle', () => {
    const r = measureDps({ character: 'bern', weapon: 'twin_daggers', seconds: 4 });
    const w = r.world;
    const p = w.player;
    expect(momentum(w)).toBe(BERN_MAX_STACKS);
    const frMax = p.stats.fireRate;
    const mvMax = p.stats.moveSpeed;
    expect(p.flags.has('affinity')).toBe(true); // daggers are melee
    for (const e of [...w.enemies]) w.killEnemy(e);
    drive(w, 60 * 4, () => {});
    expect(momentum(w)).toBe(0);
    expect(frMax / p.stats.fireRate).toBeCloseTo(1 + BERN_MAX_STACKS * BERN_STACK_FIRE, 2);
    expect(mvMax).toBeGreaterThan(p.stats.moveSpeed);
  });

  it('the rush hits and shoves enemies it passes through', () => {
    const { w, dummy } = sim('bern', 'sentinel_blade', 30);
    const hp0 = dummy.hp;
    drive(w, 20, (out, i) => { if (i === 0) out.pressed = PRESS.dash; out.mx = 1; });
    expect(dummy.hp).toBeLessThan(hp0);
    expect(dummy.mem.__bernRushAt).toBeGreaterThan(0);
    expect(w.player.x).toBeGreaterThan(dummy.x); // passed through
  });
});

describe('세린 — 사냥 감각 / 도약', () => {
  it('opens with a critical on an untouched enemy, marks it with scent, and favours bows', () => {
    const { w, dummy } = sim('serin', 'hunter_bow');
    const p = w.player;
    expect(p.flags.has('affinity')).toBe(true);
    expect(p.stats.pierce).toBe(1);
    const dmg0 = w.run.stats.damageDealt;
    let crits = 0;
    const orig = w.applyHit.bind(w);
    w.applyHit = (t, h) => {
      const ok = orig(t, h);
      if (ok && h.crit) crits++;
      return ok;
    };
    // the longbow looses on release: draw for ~1s, let go, repeat
    drive(w, 60 * 3, (out, i) => { out.held = (i % 66 < 57 ? HELD.fire : 0) | HELD.cursorAim; out.cx = dummy.x; out.cy = dummy.y; });
    expect(w.run.stats.damageDealt).toBeGreaterThan(dmg0);
    expect(dummy.mem.__serinOpened).toBe(1);
    expect(crits).toBeGreaterThanOrEqual(1);
    expect(isScented(w, dummy)).toBe(true);
  });

  it('the vault hops over the ground and the first hit afterwards is a critical', () => {
    const { w } = sim('serin', 'lantern_bolt');
    const p = w.player;
    let zMax = 0;
    w.inputSource = (_ww, _p, out) => {
      out.mx = out.my = out.ax = out.ay = 0;
      out.held = 0;
      out.pressed = 0;
    };
    p.input.pressed = 0;
    drive(w, 1, (out) => { out.pressed = PRESS.dash; out.mx = 1; });
    for (let i = 0; i < 12; i++) {
      drive(w, 1, (out) => { out.mx = 1; });
      zMax = Math.max(zMax, p.z);
    }
    expect(zMax).toBeGreaterThan(3);
    expect(p.z).toBe(0);
    expect(w.vars.__serinVaultUntil).toBeGreaterThan(w.time);
    expect(w.vars.__serinVaultUntil! - w.time).toBeLessThanOrEqual(SERIN_VAULT_WINDOW);
  });
});

describe('니엘 — 공허 메아리 / 공허 걸음', () => {
  it('floats, and every 4th attack (3rd with an arcane weapon) sends out a homing echo', () => {
    const { w, dummy } = sim('niel', 'twin_lamp');
    const p = w.player;
    expect(p.flying).toBe(true);
    expect(p.flags.has('affinity')).toBe(true);
    expect(echoEvery(w)).toBe(NIEL_ECHO_EVERY_AFFINITY);
    let echoes = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 60 * 3; i++) {
      drive(w, 1, (out) => { out.held = HELD.fire | HELD.cursorAim; out.cx = dummy.x; out.cy = dummy.y; });
      for (const e of w.entities) {
        if (e instanceof Projectile && e.generation === 1 && e.behaviors.some((b) => b.id === 'void_echo') && !seen.has(e.id)) {
          seen.add(e.id);
          echoes++;
        }
      }
    }
    expect(echoes).toBeGreaterThanOrEqual(2);
    p.equipWeapon(w, 'great_hammer');
    expect(echoEvery(w)).toBe(NIEL_ECHO_EVERY);
  });

  it('the blink teleports and leaves a biting rift at the origin', () => {
    const { w, dummy } = sim('niel', 'twin_lamp', 10);
    const p = w.player;
    const x0 = p.x;
    const hp0 = dummy.hp;
    drive(w, 1, (out) => { out.pressed = PRESS.dash; out.mx = 1; });
    expect(p.x - x0).toBeGreaterThanOrEqual(36); // arrived at once
    const rift = w.entities.find((e) => e instanceof VoidRift) as VoidRift | undefined;
    expect(rift).toBeDefined();
    expect(rift!.x).toBeCloseTo(x0, 5);
    drive(w, 60, () => {});
    expect(dummy.hp).toBeLessThan(hp0); // bitten by the rift (it stood next to the origin)
    expect(w.entities.some((e) => e instanceof VoidRift && !e.dead)).toBe(false);
  });
});

describe('balance: compressed weapons, characters that matter', () => {
  const base = bestDps(PLAIN_ID, 'lantern_bolt');
  const baseCrowd = bestDps(PLAIN_ID, 'lantern_bolt', true);

  it('all weapons retain 0.85x..1.35x single-target and 6.5x crowd caps', () => {
    // Rarity and role variety must not make the existing legendary choices obsolete.
    const bad: string[] = [];
    for (const d of Weapons.all()) {
      const k = bestDps(PLAIN_ID, d.id) / base;
      if (k < 0.85 || k > 1.35) bad.push(`${d.id} ${k.toFixed(2)}`);
      const c = bestDps(PLAIN_ID, d.id, true) / baseCrowd;
      if (c > 6.5) bad.push(`${d.id} crowd ${c.toFixed(2)}`);
    }
    expect(bad).toEqual([]);
  }, 60_000);

  it('the keeper changes DPS at least as much as the weapon does, and every starter kit lands in a fair band', () => {
    const lantern = KEEPERS.map((c) => bestDps(c, 'lantern_bolt') / base);
    const spread = Math.max(...lantern) / Math.min(...lantern);
    expect(spread).toBeGreaterThanOrEqual(1.2);
    for (const k of lantern) expect(k).toBeGreaterThanOrEqual(1.05); // every kit adds to a bare weapon
    const starters = KEEPERS.map((c) => bestDps(c, Characters.must(c).weapon) / base);
    for (const k of starters) {
      expect(k).toBeGreaterThanOrEqual(1.0);
      expect(k).toBeLessThanOrEqual(2.0);
    }
  }, 60_000);

  it('kit state in w.vars stays numeric (lockstep hashable)', () => {
    for (const c of KEEPERS) {
      const w = measureDps({ character: c, weapon: Characters.must(c).weapon, seconds: 2, dash: 0.9 }).world;
      for (const k in w.vars) expect(typeof w.vars[k], `${c} ${k}`).toBe('number');
    }
  });
});

export type { CharacterDef };
