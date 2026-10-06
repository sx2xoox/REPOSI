import './headless';
import { describe, expect, it, vi } from 'vitest';
import { measureDps, PLAIN_ID } from './dpsharness';
import { FIXED_DT } from '../src/game/constants';
import { blast, FirePatch, strike } from '../src/content/weapons/kit';
import type { StatusApply } from '../src/game/entity';
import { stateHash } from '../src/game/statehash';

function setup(weapon = 'lantern_bolt', crowd = false) {
  const result = measureDps({ character: PLAIN_ID, weapon, seconds: 0, crowd, dist: weapon === 'twin_daggers' ? 20 : 45 });
  result.world.enemies = result.dummies;
  return result;
}

describe('native weapon status cadence', () => {
  it('native projectiles share a 0.5s status gate per weapon/owner/target without gating direct damage', () => {
    const { world: w, dummies } = setup('thorn_shortbow', true), enemy = dummies[0];
    const statuses: StatusApply[] = [{ kind: 'poison', duration: 2, power: 1 }];
    const hit = (index: number) => {
      const projectile = w.player.fireProjectiles(w, 0, { count: 1, statuses, damage: 2 })[0];
      expect(projectile.statuses[0].procKey).toBe('weapon:thorn_shortbow:poison');
      projectile.hitActor(w, dummies[index]);
    };
    const hp = enemy.hp; hit(0); expect(enemy.statuses.get('poison')?.stacks).toBe(1);
    w.time = .49; hit(0); expect(enemy.statuses.get('poison')?.stacks).toBe(1); expect(enemy.hp).toBeLessThan(hp - 2);
    hit(1); expect(dummies[1].statuses.get('poison')?.stacks).toBe(1);
    w.time = .5; hit(0); expect(enemy.statuses.get('poison')?.stacks).toBe(2);
  });

  it('melee, direct strikes and AoE tag native statuses; one AoE can affect all targets once', () => {
    const { world: w, dummies } = setup('twin_daggers', true);
    const statuses: StatusApply[] = [{ kind: 'bleed', duration: 2, power: 1 }];
    const swing = w.player.swing(w, { angle: 0, damage: 2, statuses });
    expect(swing.o.statuses?.[0].procKey).toBe('weapon:twin_daggers:bleed');
    blast(w, dummies[0].x, dummies[0].y, 80, 2, { statuses, shake: 0, sfx: false });
    expect(dummies.map(e => e.statuses.get('bleed')?.stacks)).toEqual([1, 1, 1, 1, 1]);
    strike(w, dummies[0], 2, 1, 0, 0, { statuses });
    expect(dummies[0].statuses.get('bleed')?.stacks).toBe(1);
    w.time = .5; strike(w, dummies[0], 2, 1, 0, 0, { statuses });
    expect(dummies[0].statuses.get('bleed')?.stacks).toBe(2);
  });

  it.each(['dragon_breath', 'frost_wand', 'twin_daggers', 'thunder_rod'])('%s limits successful native status applications in actual fixed-step firing', weapon => {
    const { world: w, dummies } = setup(weapon), enemy = dummies[0];
    const samples = new Map<string, number[]>(), original = enemy.applyStatus.bind(enemy);
    const observed = vi.spyOn(enemy, 'applyStatus').mockImplementation((status, _roll) => {
      const success = original(status, () => 0); // Always succeed to test the cadence rather than RNG luck.
      if (success) { const key = status.procKey ?? `MISSING:${status.kind}`; const times = samples.get(key) ?? []; times.push(w.time); samples.set(key, times); }
      return success;
    });
    try {
      for (let i = 0; i < 240; i++) w.update(FIXED_DT);
      expect(samples.size, weapon).toBeGreaterThan(0);
      for (const [key, times] of samples) {
        expect(key, `${weapon}: missing native status identity`).toMatch(/^weapon:/);
        expect(times.length, key).toBeGreaterThan(1);
        for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1], `${weapon}/${key}/${i}`).toBeGreaterThanOrEqual(.5 - 1e-8);
      }
    } finally { observed.mockRestore(); }
  });

  it('overlapping fire patches preserve normal damage ticks but cannot refresh burn faster than 0.5s', () => {
    const { world: w, dummies } = setup('dragon_breath'), enemy = dummies[0];
    const times: number[] = [], original = enemy.applyStatus.bind(enemy);
    vi.spyOn(enemy, 'applyStatus').mockImplementation((status, _roll) => { const ok = original(status, () => 0); if (ok) times.push(w.time); return ok; });
    const patches = [new FirePatch(enemy.x, enemy.y, 24, 1), new FirePatch(enemy.x, enemy.y, 24, 1)];
    const hp = enemy.hp;
    for (let i = 0; i < 60; i++) { w.time = i * FIXED_DT; for (const patch of patches) patch.update(w, FIXED_DT); }
    expect(enemy.hp).toBeLessThan(hp - 4); expect(times.length).toBeGreaterThan(1);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(.5 - 1e-8);
    const hash = stateHash(w); patches[0].draw(w.renderer, w); expect(stateHash(w)).toBe(hash);
  });
});
