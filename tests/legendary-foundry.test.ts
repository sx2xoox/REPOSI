import { describe, expect, it, vi } from 'vitest';
import { measureDps, PLAIN_ID } from './dpsharness';
import { Weapons, type Rarity } from '../src/game/defs';
import { FOUNDRY_WEAPONS } from '../src/content/weapons/legendary-foundry';
import * as presentation from '../src/content/weapons/foundry-presentation';
import { pickWeapon, weaponPrice } from '../src/content/weapons/drops';
import { weaponCandidates } from '../src/game/facilities';
import { RNG } from '../src/engine/rng';
import { Projectile } from '../src/game/projectile';
import { freshState } from '../src/game/weaponslots';
import { FIXED_DT } from '../src/game/constants';
import { HELD } from '../src/game/seam';

describe('foundry weapon roles and access', () => {
  it('offers the two rare and three epic weapons through their actual rarity, shop price and crafting pools', () => {
    const expected: Record<string, Rarity> = {
      sunset_rifle: 'rare', gatebreaker_maul: 'rare',
      gatekeeper_shotgun: 'epic', dawn_pike: 'epic', silvermoon_longbow: 'epic',
    };
    const seen = new Set<string>(), rng = new RNG('FOUNDRY-ACCESS');
    for (let i = 0; i < Weapons.all().length; i++) {
      const id = pickWeapon(rng, 3, 0, [], seen);
      if (id) seen.add(id);
    }
    for (const spec of FOUNDRY_WEAPONS) {
      const d = Weapons.must(spec.id), rarity = expected[d.id];
      expect(d.rarity, d.id).toBe(rarity);
      expect(weaponPrice(d.rarity), d.id).toBe(rarity === 'rare' ? 18 : 26);
      expect(d.pools).toContain('shop');
      expect(seen.has(d.id), d.id).toBe(true);
      expect(weaponCandidates(rarity).some(candidate => candidate.id === d.id), d.id).toBe(true);
      expect(weaponCandidates('legendary').some(candidate => candidate.id === d.id), d.id).toBe(false);
    }
  });

  it.each(FOUNDRY_WEAPONS.map(d => d.id))('%s works without a character passive or required relic', id => {
    const at = (weapon: string, dist: number) => measureDps({ character: PLAIN_ID, weapon, seconds: 8, dist, seed: 'FOUNDRY-BARE' }).dps;
    // Compare useful engagement distances under identical seed and investment.
    const result = Math.max(at(id, 40), at(id, 70));
    const starter = Math.max(at('lantern_bolt', 40), at('lantern_bolt', 70));
    expect(result).toBeGreaterThanOrEqual(starter);
    expect(result / starter).toBeLessThanOrEqual(1.35);
    expect(Weapons.must(id).pools).toContain('treasure');
  });

  it('continuous spear attacks retain their combo through real Player.update frames and land a stronger third thrust', () => {
    const { world: w, dummies } = measureDps({ character: PLAIN_ID, weapon: 'dawn_pike', seconds: 0 });
    const swings = vi.spyOn(w.player, 'swing');
    for (let frame = 0; frame < 180; frame++) w.update(FIXED_DT);
    const strikes = swings.mock.calls.map(c => c[1]);
    expect(strikes.length).toBeGreaterThanOrEqual(3);
    expect(strikes[0].damage).toBeGreaterThan(0);
    expect(strikes[1].damage).toBeCloseTo(strikes[0].damage!);
    expect(strikes[2].damage).toBeCloseTo(strikes[0].damage! * 2);
    expect(strikes[2].reach).toBeGreaterThan(strikes[0].reach!);
    expect(dummies[0].hp).toBeLessThan(dummies[0].maxHp);
  });

  it('pausing spear attacks expires the combo before the next real attack', () => {
    const { world: w } = measureDps({ character: PLAIN_ID, weapon: 'dawn_pike', seconds: 0 });
    const swings = vi.spyOn(w.player, 'swing');
    const firingInput = w.inputSource!;
    for (let frame = 0; frame < 180 && swings.mock.calls.length < 2; frame++) w.update(FIXED_DT);
    expect(swings.mock.calls).toHaveLength(2);
    expect(w.player.weapon.combo).toBe(2);
    w.inputSource = (ww, p, out) => {
      firingInput(ww, p, out);
      out.held &= ~HELD.fire;
    };
    for (let frame = 0; frame < 120; frame++) w.update(FIXED_DT);
    expect(w.player.weapon.combo).toBe(0);
    expect(swings.mock.calls).toHaveLength(2);
    w.inputSource = firingInput;
    w.update(FIXED_DT);
    expect(swings.mock.calls).toHaveLength(3);
    expect(w.player.weapon.combo).toBe(1);
    expect(swings.mock.calls[2][1].damage).toBeCloseTo(swings.mock.calls[0][1].damage!);
    expect(swings.mock.calls[2][1].reach).toBeCloseTo(swings.mock.calls[0][1].reach!);
  });

  it('the shotgun rewards close range while the rifle reaches a distant target', () => {
    const close = measureDps({ character: PLAIN_ID, weapon: 'gatekeeper_shotgun', seconds: 8, dist: 35 });
    const far = measureDps({ character: PLAIN_ID, weapon: 'gatekeeper_shotgun', seconds: 8, dist: 135 });
    const rifle = measureDps({ character: PLAIN_ID, weapon: 'sunset_rifle', seconds: 8, dist: 135 });
    expect(close.dps).toBeGreaterThan(far.dps * 1.5);
    expect(rifle.dps).toBeGreaterThan(far.dps * 1.5);
  });

  it('the shotgun exposes first shot, second shot and reload in step with the real six-pellet attacks', () => {
    const { world: w } = measureDps({ character: PLAIN_ID, weapon: 'gatekeeper_shotgun', seconds: 0 });
    const shots = vi.spyOn(w.player, 'fireProjectiles');
    // Let the real room-entry input lock finish before inspecting the first volley.
    for (let i = 0; i < 120 && shots.mock.calls.length === 0; i++) w.update(FIXED_DT);
    expect(shots.mock.calls).toHaveLength(6);
    expect(w.player.weapon.mem.shotIndex).toBe(1);
    expect(w.player.weapon.mem.shells).toBe(1);
    expect(w.player.weapon.mem.reloadUntil).toBe(0);
    for (let i = 0; i < 120 && shots.mock.calls.length < 12; i++) w.update(FIXED_DT);
    expect(shots.mock.calls).toHaveLength(12);
    expect(w.player.weapon.mem.shotIndex).toBe(2);
    expect(w.player.weapon.mem.shells).toBe(0);
    expect(w.player.weapon.mem.reloadStart).toBeCloseTo(w.time);
    expect(w.player.weapon.mem.reloadUntil - w.player.weapon.mem.reloadStart).toBeCloseTo(w.player.weapon.cooldown);
    for (let i = 0; i < 120 && shots.mock.calls.length < 18; i++) w.update(FIXED_DT);
    expect(shots.mock.calls).toHaveLength(18);
    expect(w.player.weapon.mem.shotIndex).toBe(1);
    expect(w.player.weapon.mem.reloadUntil).toBe(0);
  });

  it.each(FOUNDRY_WEAPONS.map(d => d.id))('%s impact feedback follows real hits without changing damage, hit count or gameplay RNG', id => {
    const opts = { character: PLAIN_ID, weapon: id, seconds: 3, dist: 40, seed: 'FOUNDRY-FEEDBACK' };
    const impact = vi.spyOn(presentation, 'foundryImpact');
    try {
      const shown = measureDps(opts);
      expect(impact).toHaveBeenCalled();
      expect(impact.mock.calls.every(call => call[0] === shown.world && call[1] === shown.world.player)).toBe(true);
      expect(impact.mock.calls.length).toBe(shown.hits);
      impact.mockImplementation(() => {});
      const silent = measureDps(opts);
      expect(shown.damage).toBeCloseTo(silent.damage);
      expect(shown.hits).toBe(silent.hits);
      expect(shown.world.rng.snapshot()).toEqual(silent.world.rng.snapshot());
    } finally { impact.mockRestore(); }
  });

  it('full draws earn more damage than repeatedly tapping the longbow', () => {
    const full = measureDps({ character: PLAIN_ID, weapon: 'silvermoon_longbow', seconds: 8 });
    const taps = measureDps({ character: PLAIN_ID, weapon: 'silvermoon_longbow', seconds: 8, fireCycle: { hold: .08, period: .25 } });
    expect(full.dps).toBeGreaterThan(taps.dps * 1.5);
  });

  it('holstering cancels an uncommitted maul windup and bow draw', () => {
    for (const id of ['gatebreaker_maul', 'silvermoon_longbow']) {
      const { world: w } = measureDps({ character: PLAIN_ID, weapon: id, seconds: 0 });
      const p = w.player, d = Weapons.must(id), st = freshState();
      d.update(w, p, st, FIXED_DT, true, 0);
      expect(id === 'gatebreaker_maul' ? st.mem.winding : st.charge).toBeGreaterThan(0);
      d.onHolster!(w, p, st);
      expect(st.charge).toBe(0);
      expect(st.mem.winding).toBe(0);
    }
  });

  it('multishot reaches the flame weapon instead of applying only the fan penalties', () => {
    const { world: w } = measureDps({ character: PLAIN_ID, weapon: 'dragon_breath', seconds: 0 });
    const p = w.player, d = Weapons.must('dragon_breath');
    const spawned: Projectile[] = [];
    const spawn = w.spawn.bind(w);
    w.spawn = function<T extends import('../src/game/entity').Entity>(entity: T): T {
      if (entity instanceof Projectile && entity.fromWeapon) spawned.push(entity);
      return spawn(entity);
    };
    d.update(w, p, freshState(), FIXED_DT, true, 0);
    const before = spawned.length;
    spawned.length = 0;
    w.items.give('paper_fan');
    d.update(w, p, freshState(), FIXED_DT, true, 0);
    expect(before).toBe(1);
    expect(spawned.length).toBe(p.weaponStats.shots);
    expect(spawned.length).toBeGreaterThan(before);
    expect(new Set(spawned.map(s => s.angle)).size).toBeGreaterThan(1);
  });
});
