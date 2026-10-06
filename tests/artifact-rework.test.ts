import { describe, expect, it, vi } from 'vitest';
import { measureDps, PLAIN_ID } from './dpsharness';
import { Projectile } from '../src/game/projectile';
import { Pickup } from '../src/game/pickups';
import { Artifacts } from '../src/game/defs';
import type { HitInfo } from '../src/game/entity';
import { mkdirSync, writeFileSync } from 'node:fs';

function setup(id: string) {
  const r = measureDps({ character: PLAIN_ID, weapon: 'lantern_bolt', seconds: 0, crowd: true });
  const w = r.world;
  w.enemies = r.dummies;
  w.items.give(id);
  w.player.stats.critChance = 0;
  return r;
}
const hit = (damage = 10): HitInfo => ({ kind: 'projectile', damage, dealtDamage: damage });

describe('artifact reworks in the real item system', () => {
  it.skipIf(!process.env.PROC_BALANCE_REPORT)('reports equal-investment kiln/status comparisons without ranking utility items', () => {
    const rows: { weapon: string; crowd: boolean; plain: number; kiln: number; kilnRatio: number; status: number }[] = [];
    for (const weapon of ['lantern_bolt', 'dragon_breath', 'titan_greatsword', 'brass_revolver', 'bell_blunderbuss', 'void_gaze']) {
      for (const crowd of [false, true]) {
        const builds = [[], ['kiln_core'], ['tinder_pouch', 'viper_fang', 'rusted_nail']];
        const means = builds.map(artifacts => ['proc-a', 'proc-b'].reduce((sum, seed) => sum + measureDps({ character: PLAIN_ID, weapon, artifacts, crowd, seconds: 12, seed }).dps, 0) / 2);
        expect(means.every(Number.isFinite)).toBe(true);
        const row = { weapon, crowd, plain: +means[0].toFixed(2), kiln: +means[1].toFixed(2), kilnRatio: +(means[1] / means[0]).toFixed(2), status: +means[2].toFixed(2) };
        rows.push(row);
        console.log(JSON.stringify(row));
      }
    }
    mkdirSync('test-results/balance-audit', { recursive: true });
    writeFileSync('test-results/balance-audit/proc-rework.json', JSON.stringify({
      method: { character: PLAIN_ID, seconds: 12, seeds: ['proc-a', 'proc-b'], targets: 'stationary single / five-target crowd',
        builds: { plain: [], kiln: ['kiln_core'], status: ['tinder_pouch', 'viper_fang', 'rusted_nail'] } },
      limitations: 'Two-seed stationary comparison only. Compare each build across weapons with identical investment; kiln and status builds have different rarity/count budgets and are not a direct ranking. No survival, utility, economy or boss-clear verdict.',
      rows,
    }, null, 2));
  }, 120_000);
  it('a basic zero-pierce shot survives its first hit, returns once at 65%, and cannot proc again', () => {
    const { world: w, dummies } = setup('pendulum_weight');
    const p = w.player.fireProjectiles(w, 0)[0];
    expect(p.pierce).toBe(0);
    const hp = dummies[0].hp;
    const outgoing = p.damage;
    p.hitActor(w, dummies[0]);
    expect(p.dead).toBe(false);
    expect(p.generation).toBe(1);
    expect(p.damage).toBeCloseTo(outgoing * 0.65);
    p.hitActor(w, dummies[0]);
    expect(hp - dummies[0].hp).toBeCloseTo(outgoing * 1.65);
    const after = dummies[0].hp;
    p.hitActor(w, dummies[0]);
    expect(dummies[0].hp).toBe(after);
    const behavior = p.behaviors.find(b => b.id === 'boomerang')!;
    behavior.onWall!(p, w); p.hitActor(w, dummies[0]);
    expect(dummies[0].hp).toBe(after);
  });

  it('crystal spiral preserves the aimed projectile and produces a separate, cooldown-limited side volley', () => {
    const { world: w } = setup('crystal_spiral');
    const spawned = vi.spyOn(w, 'spawn');
    const p = w.player.fireProjectiles(w, 0, { count: 1 })[0];
    expect(p.angle).toBe(0);
    expect(p.behaviors.some(b => b.id === 'sine')).toBe(false);
    w.items.onAttack(0);
    const shards = () => spawned.mock.calls.map(c => c[0]).filter(e => e instanceof Projectile && e.generation > 0) as Projectile[];
    expect(shards()).toHaveLength(2);
    expect(shards().map(s => Math.sign(s.angle))).toEqual([-1, 1]);
    w.time = 0.3; w.items.onAttack(0); expect(shards()).toHaveLength(2);
    w.time = 0.8; w.items.onAttack(0); expect(shards()).toHaveLength(4);
  });

  it('crystal spiral no longer erases all damage at the audited 70px distance', () => {
    for (const seed of ['spiral-a', 'spiral-b']) {
      const plain = measureDps({ character: PLAIN_ID, weapon: 'lantern_bolt', dist: 70, seconds: 4, seed });
      const spiral = measureDps({ character: PLAIN_ID, weapon: 'lantern_bolt', dist: 70, seconds: 4, seed, artifacts: ['crystal_spiral'] });
      expect(spiral.damage, seed).toBeGreaterThanOrEqual(plain.damage * 0.9);
    }
  });

  it('thunder drum waits for combat and hits the entire first wave exactly once per room', () => {
    const { world: w, dummies } = setup('thunder_drum');
    w.node.cleared = false;
    w.enemies = [];
    w.items.onRoomEnter();
    w.time = 10; w.items.update(0.1);
    const hp = dummies.map(e => e.hp);
    w.enemies = dummies; dummies.forEach(e => { e.dormant = 0; });
    w.items.update(0.1);
    expect(dummies.every((e, i) => e.hp < hp[i])).toBe(true);
    const after = dummies.map(e => e.hp);
    w.time = 11; w.items.onRoomEnter(); w.items.update(0.1);
    expect(dummies.map(e => e.hp)).toEqual(after);
    w.run.stage++; w.items.onRoomEnter(); w.items.update(0.1);
    expect(dummies.every((e, i) => e.hp < after[i])).toBe(true);
  });

  it('alchemist scale counts coin value, shows progress, alternates supplies, and retains progress across equipment changes', () => {
    const { world: w } = setup('alchemist_scale');
    const spawned = vi.spyOn(w, 'spawn');
    const text = vi.spyOn(w, 'floatText');
    const supplies = () => spawned.mock.calls.map(c => c[0]).filter((e): e is Pickup => e instanceof Pickup && ['bomb', 'key'].includes(e.kind));
    w.items.onPickup('dime');
    expect(supplies()).toHaveLength(0);
    expect(text.mock.calls.some(c => c[2] === '보급 10/20')).toBe(true);
    w.player.equipWeapon(w, 'dragon_breath');
    w.items.onPickup('dime');
    expect(supplies().map(e => e.kind)).toEqual(['bomb']);
    w.items.onRoomEnter();
    w.items.onPickup('nickel'); w.items.onPickup('dime');
    expect(w.vars.__scaleGold).toBe(15);
    w.items.onPickup('nickel');
    expect(supplies().map(e => e.kind)).toEqual(['bomb', 'key']);
    w.items.onPickup('key');
    expect(w.vars.__scaleGold).toBe(0);
  });

  it('sachet skips bosses, lethal hits and wounded enemies without spending its six-second opportunity', () => {
    const { world: w, dummies } = setup('sweet_sachet');
    const modify = (i: number, damage = 10) => { const h = hit(damage); w.items.modifyHit(dummies[i], h); return h; };
    Object.defineProperty(dummies[0], 'isBoss', { value: true });
    expect(modify(0).statuses).toBeUndefined();
    expect(modify(1, dummies[1].hp + 1).statuses).toBeUndefined();
    const hp = dummies[1].hp;
    dummies[1].hp = dummies[1].maxHp * 0.4;
    expect(modify(1).statuses).toBeUndefined();
    dummies[1].hp = hp;
    expect(modify(1).statuses?.[0].kind).toBe('charm');
    w.time = 5.99; expect(modify(2).statuses).toBeUndefined();
    w.time = 6; expect(modify(2).statuses?.[0].kind).toBe('charm');
  });

  it('kiln accumulates rapid small hits between procs and rewards an isolated heavy hit with a larger blast', () => {
    const { world: w, dummies } = setup('kiln_core');
    const target = dummies[0];
    const firstHp = target.hp;
    w.items.onHit(target, hit(2));
    const small = firstHp - target.hp;
    const hp = target.hp;
    for (let i = 1; i < 12; i++) { w.time = i / 60; w.items.onHit(target, hit(2)); }
    expect(target.hp).toBe(hp);
    w.time = 0.2; w.items.onHit(target, hit(2));
    expect(hp - target.hp).toBeGreaterThan(small);
    w.time = 1;
    const beforeHeavy = target.hp;
    w.items.onHit(target, hit(100));
    expect(beforeHeavy - target.hp).toBeGreaterThan(small * 2);
    expect(w.vars.__kilnBank).toBe(0);
  });

  it('retains the longer frost mantle cooldown and affects all nearby enemies', () => {
    const { world: w, dummies } = setup('hoarfrost_mantle');
    w.items.onHurt(1);
    expect(dummies.every(e => e.hasStatus('freeze'))).toBe(true);
    dummies.forEach(e => e.statuses.clear());
    w.time = 1.49; w.items.onHurt(1);
    expect(dummies.every(e => !e.hasStatus('freeze'))).toBe(true);
    w.time = 1.5; w.items.onHurt(1);
    expect(dummies.every(e => e.hasStatus('freeze'))).toBe(true);
    expect(Artifacts.must('hoarfrost_mantle').detail).toContain('0.5초');
  });
});
