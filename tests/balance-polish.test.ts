import { describe, expect, it } from 'vitest';
import { measureDps, PLAIN_ID } from './dpsharness';
import { Artifacts, GlobalHooks } from '../src/game/defs';
import { blessingRole, rollBlessings } from '../src/game/blessings';
import { Inventory, makeItem } from '../src/game/inventory';
import { SYNERGIES, synergyActive } from '../src/game/synergies';
import type { HitInfo } from '../src/game/entity';
import { buildCard } from '../src/ui/item-tooltip';
import { Pedestal } from '../src/game/pickups';

const setup = () => measureDps({ character: PLAIN_ID, weapon: 'lantern_bolt', seconds: 0 });


/** Damage of a hit after its item bonus pool (World.applyHit applies HitInfo.amp once). */
const eff = (h: HitInfo): number => h.damage * (1 + (h.amp ?? 0));
describe('blessing choices and recovery economy', () => {
  it('offers deterministic, distinct roles and exhausts the remaining pool safely', () => {
    for (let i = 0; i < 100; i++) {
      const ids = rollBlessings(`BAL-${i}`, 1, () => false);
      expect(ids).toEqual(rollBlessings(`BAL-${i}`, 1, () => false));
      expect(new Set(ids.map(blessingRole)).size).toBe(3);
    }
    expect(rollBlessings('last', 9, (id) => id !== 'bless_might')).toEqual(['bless_might']);
    expect(rollBlessings('empty', 9, () => true)).toEqual([]);
  });

  it('hearth heals missing health without stockpiling soul hearts at full health', () => {
    const { world: w } = setup();
    const b = Artifacts.must('bless_hearth');
    for (let i = 0; i < 30; i++) b.onRoomClear!(w, 1);
    expect(w.player.soul).toBe(0);
    w.player.red -= 2;
    for (let i = 0; i < 3; i++) b.onRoomClear!(w, 1);
    expect(w.player.red).toBe(w.player.maxRed - 1);
  });

  it('release healing cannot be repeated in the same room', () => {
    const { world: w } = setup();
    w.player.red = 1;
    const b = Artifacts.must('bless_release_heal');
    b.onRelease!(w, 1); b.onRelease!(w, 1);
    expect(w.player.red).toBe(2);
  });

  it('soul-only recovery stops at two hearts and never removes existing protection', () => {
    const { world: w } = setup();
    w.player.stats.maxHearts = 0; w.player.red = 0; w.player.soul = 3;
    const b = Artifacts.must('bless_hearth');
    for (let i = 0; i < 30; i++) b.onRoomClear!(w, 1);
    expect(w.player.soul).toBe(4);
    w.player.soul = 8;
    for (let i = 0; i < 3; i++) b.onRoomClear!(w, 1);
    expect(w.player.soul).toBe(8);
  });

  it('kindle adds the same 35% to normal and boss damage-based ember gain', () => {
    for (const boss of [false, true]) {
      const result: number[] = [];
      for (const blessed of [false, true]) {
        const { world: w, dummies } = setup();
        if (blessed) w.items.give('bless_kindle');
        const target = dummies[0]; Object.defineProperty(target, 'isBoss', { value: boss });
        w.player.ember = 0;
        w.applyHit(target, { damage: 10, kind: 'projectile', attacker: w.player });
        result.push(w.player.ember);
      }
      expect(result[1] / result[0]).toBeCloseTo(1.35);
    }
  });
});

describe('mixed resonance', () => {
  it('requires distinct artifacts, not duplicate copies', () => {
    const inv = new Inventory();
    for (const id of ['tinder_pouch', 'tinder_pouch', 'rime_shard', 'rime_shard']) inv.add(makeItem(id));
    expect(synergyActive(inv.compute().tagCounts, SYNERGIES[0].tags)).toBe(false);
    inv.add(makeItem('smoldering_coal')); inv.add(makeItem('frostbite_ring'));
    expect(synergyActive(inv.compute().tagCounts, SYNERGIES[0].tags)).toBe(true);
  });

  it('thermal only boosts primary attacks on enemies with both statuses', () => {
    const { world: w, dummies } = setup();
    for (const id of ['tinder_pouch', 'smoldering_coal', 'rime_shard', 'frostbite_ring']) w.items.give(id);
    const target = dummies[0];
    const hooks = GlobalHooks.must('mixed_resonance');
    const hit = (noProc = false): HitInfo => ({ kind: 'melee', damage: 100, noProc });
    let h = hit(); hooks.modifyHit!(w, target, h, 1); expect(eff(h)).toBe(100);
    target.applyStatus({ kind: 'burn', duration: 2, power: 1 }, () => 0);
    target.applyStatus({ kind: 'slow', duration: 2, power: 0.4 }, () => 0);
    h = hit(); hooks.modifyHit!(w, target, h, 1); expect(eff(h)).toBeCloseTo(112);
    h = hit(true); hooks.modifyHit!(w, target, h, 1); expect(eff(h)).toBe(100);
    w.items.take('rime_shard');
    h = hit(); hooks.modifyHit!(w, target, h, 1); expect(eff(h)).toBe(100);
  });

  it('previews a completed tier and explains duplicate counting without changing inventory', () => {
    const { world: w } = setup();
    w.items.give('tinder_pouch');
    const c = buildCard(w, new Pedestal(0, 0, { kind: 'artifact', id: 'smoldering_coal' }))!;
    expect(c.extra.flat().map((s) => s.t).join(' ')).toContain('1 → 2 / 2 달성!');
    expect(w.items.powerOf('smoldering_coal')).toBe(0);
    const dup = buildCard(w, new Pedestal(0, 0, { kind: 'artifact', id: 'tinder_pouch' }))!;
    expect(dup.extra.flat().map((s) => s.t).join(' ')).toContain('1 → 1');
  });

  it('wound synergy requires both statuses; eclipse expires and only benefits critical hits', () => {
    for (const s of SYNERGIES.slice(1)) {
      const { world: w, dummies } = setup();
      for (const tag of s.tags) for (const a of Artifacts.all().filter((a) => a.tags.includes(tag)).slice(0, 2)) w.items.give(a.id);
      const target = dummies[0], hooks = GlobalHooks.must('mixed_resonance');
      const h: HitInfo = { kind: 'projectile', damage: 100, crit: true };
      if (s.id === 'sepsis') {
        target.applyStatus({ kind: 'poison', duration: 2, power: 1 }, () => 0);
        hooks.modifyHit!(w, target, h, 1); expect(eff(h)).toBe(100);
        target.applyStatus({ kind: 'bleed', duration: 2, power: 1 }, () => 0);
      } else {
        hooks.onDash!(w, 1);
        const noncrit: HitInfo = { kind: 'melee', damage: 100 };
        hooks.modifyHit!(w, target, noncrit, 1); expect(eff(noncrit)).toBe(100);
      }
      hooks.modifyHit!(w, target, h, 1);
      expect(eff(h)).toBeCloseTo(s.id === 'sepsis' ? 112 : 110);
      if (s.id === 'eclipse') {
        w.time += 2; h.damage = 100; h.amp = 0;
        hooks.modifyHit!(w, target, h, 1); expect(eff(h)).toBe(100);
      }
    }
  });

  it('records repeatable multi-seed DPS for ordinary, status and critical builds', () => {
    const builds = [[], ['tinder_pouch', 'smoldering_coal', 'rime_shard', 'frostbite_ring'], ['bless_might', 'bless_haste', 'bless_keen']];
    for (const weapon of ['lantern_bolt', 'twin_daggers', 'void_gaze']) {
      const values = builds.map((artifacts) => [1, 2, 3].map((i) => measureDps({ character: PLAIN_ID, weapon, artifacts, seed: `BAL-${i}`, seconds: 24 }).dps));
      const avg = values.map((row) => row.reduce((a, b) => a + b, 0) / row.length);
      console.log('BUILD DPS', weapon, avg.map((v) => v.toFixed(2)).join(' / '));
      expect(avg[1]).toBeGreaterThan(avg[0]);
      expect(avg[1] / avg[0]).toBeLessThan(2.8);
      expect(avg[2] / avg[0]).toBeGreaterThan(1.1);
      expect(avg[2] / avg[0]).toBeLessThan(1.8);
    }
  });
});
