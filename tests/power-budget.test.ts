// Power budget rules (user 2026-10-08: "lower weapons and artifacts overall, a good nail-gun
// setup must not chew through the floor-7 bosses"): item bonuses pool with diminishing
// returns, penalties stay multiplicative, extra shots split an attack, procs / ember / DoT
// follow damage dealt rather than hit count, weapon factors stay on the weapon, and every
// keeper starts with a common weapon.

import './headless';
import { describe, expect, it } from 'vitest';
import { measureDps, PLAIN_ID } from './dpsharness';
import { Characters, Weapons } from '../src/game/defs';
import { BONUS_KNEE, extraShotShare, multishotShare, softBonus } from '../src/game/stats';
import { attackEmber } from '../src/game/ember';
import { hitShare } from '../src/content/items/lib';
import { MAX_DOT_STACKS } from '../src/game/entity';
import { TWIN_SHADOW_DAMAGE } from '../src/content/items/familiars';

const solo = (weapon = 'lantern_bolt') => measureDps({ character: PLAIN_ID, weapon, seconds: 0 }).world;

describe('power budget', () => {
  it('every keeper starts with a common weapon', () => {
    for (const c of Characters.all()) expect(Weapons.must(c.weapon).rarity, c.id).toBe('common');
  });

  it('pooled bonuses count half past the knee', () => {
    expect(softBonus(0.5)).toBeCloseTo(0.5);
    expect(softBonus(BONUS_KNEE)).toBeCloseTo(BONUS_KNEE);
    expect(softBonus(BONUS_KNEE + 1)).toBeCloseTo(BONUS_KNEE + 0.5);
  });

  it('damage bonuses add up, penalties multiply, weapon factors stay on the weapon', () => {
    const w = solo();
    const p = w.player;
    const base = p.stats.damage;
    w.items.give('blood_pact');
    expect(p.stats.damage / base).toBeCloseTo(1.25);
    w.items.give('paper_fan');
    // the fan's x0.75 is not watered down by the pact's +25 %
    expect(p.stats.damage / base).toBeCloseTo(1.25 * 0.75);
    expect(p.stats.shots).toBe(3);
    // a weapon's damage factor shapes its own attacks only, never the keeper's stats
    const v = solo('void_gaze');
    expect(v.player.weaponStats.damage).toBeLessThan(v.player.stats.damage);
  });

  it('extra shots split the attack', () => {
    expect(multishotShare(1)).toBe(1);
    expect(3 * multishotShare(3)).toBeCloseTo(1.8);
    expect(5 * extraShotShare(5, 0)).toBeCloseTo(5);
    expect(7 * extraShotShare(5, 2)).toBeCloseTo(5.8);
  });

  it('per-hit procs and the ember flat charge follow the hit size', () => {
    const w = solo();
    const d = w.player.stats.damage;
    expect(hitShare(w, { kind: 'projectile', damage: d, attacker: w.player })).toBeCloseTo(1);
    expect(hitShare(w, { kind: 'projectile', damage: d * 0.4, attacker: w.player })).toBeCloseTo(0.4);
    expect(hitShare(w, { kind: 'projectile', damage: d * 0.01, attacker: w.player })).toBeCloseTo(0.25);
    // five fifth-size hits charge about one whole hit, not five
    const whole = attackEmber(d, d, false, false, d);
    const fifth = attackEmber(d, d / 5, false, false, d / 5);
    expect(5 * fifth).toBeLessThan(whole * 1.25);
  });

  it('poison and bleed stacks expire one by one', () => {
    const r = measureDps({ character: PLAIN_ID, weapon: 'lantern_bolt', seconds: 0 });
    const w = r.world;
    const e = r.dummies[0];
    const roll = () => 0;
    e.applyStatus({ kind: 'bleed', duration: 3, power: 1 }, roll);
    e.updateStatuses(w, 2);
    e.applyStatus({ kind: 'bleed', duration: 3, power: 1 }, roll);
    expect(e.statuses.get('bleed')?.stacks).toBe(2);
    e.updateStatuses(w, 1.1); // the first stack ran out, the refresh did not keep it alive
    expect(e.statuses.get('bleed')?.stacks).toBe(1);
    for (let i = 0; i < 20; i++) e.applyStatus({ kind: 'bleed', duration: 3, power: 1 }, roll);
    expect(e.statuses.get('bleed')?.stacks).toBe(MAX_DOT_STACKS);
    e.updateStatuses(w, 3.1);
    expect(e.statuses.has('bleed')).toBe(false);
  });

  it('the twin shadow mimics at the keeper cadence, not the weapon cadence', () => {
    expect(TWIN_SHADOW_DAMAGE).toBeLessThanOrEqual(0.35);
    const w = solo('nail_carbine');
    w.items.give('twin_shadow');
    const fired: number[] = [];
    const def = w.items.effects.find((x) => x.key === 'a:twin_shadow')!;
    for (let t = 0; t < 2; t += 0.05) {
      w.time = t;
      const before = w.vars.__cd_twin_shadow ?? -99;
      def.hooks.onAttack!(w, 0, 1);
      if ((w.vars.__cd_twin_shadow ?? -99) !== before) fired.push(t);
    }
    // keeper fire rate 2.6/s: at most ~6 mimics in 2 s however fast the weapon swings
    expect(fired.length).toBeLessThanOrEqual(6);
  });
});
