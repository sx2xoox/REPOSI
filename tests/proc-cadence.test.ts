import { describe, expect, it, vi } from 'vitest';
import { measureDps, PLAIN_ID } from './dpsharness';
import { Artifacts } from '../src/game/defs';
import { Projectile } from '../src/game/projectile';
import { captureCheckpoint, restoreCheckpoint } from '../src/game/checkpoint';
import { stateHash } from '../src/game/statehash';
import { effectProc, pruneProcState, runProc, runProcStatus, withProcContext } from '../src/game/procs';
import { chainLightning, HazardZone, inflict, isPrimary, miniBlast } from '../src/content/items/lib';
import type { HitInfo } from '../src/game/entity';

function setup(artifact?: string) {
  const r = measureDps({ character: PLAIN_ID, weapon: 'lantern_bolt', seconds: 0, crowd: true });
  r.world.enemies = r.dummies;
  r.world.player.stats.critChance = 0;
  if (artifact) r.world.items.give(artifact);
  return r;
}
const hit = (damage = 10, kind: HitInfo['kind'] = 'projectile'): HitInfo => ({ damage, kind, dirX: 1, dirY: 0 });

describe('passive proc cadence', () => {
  it('keeps emitted zone damage ticks intact while limiting repeat status application', () => {
    const { world: w, dummies } = setup();
    const target = dummies[0];
    const zone = withProcContext(w, 'trail', () => HazardZone.add(w, new HazardZone(w, target.x, target.y, 'fire', {
      radius: 60, life: 3, tick: 0.1, damage: 2, statuses: [{ kind: 'poison', duration: 3, power: 1 }],
    }), 3));
    const hp = target.hp;
    for (let i = 0; i < 5; i++) { w.time = i / 10; zone.update(w, 0.1); }
    expect(hp - target.hp).toBe(10);
    expect(target.statuses.get('poison')?.stacks).toBe(1);
    w.time = 0.5; zone.update(w, 0.1);
    expect(hp - target.hp).toBe(12);
    expect(target.statuses.get('poison')?.stacks).toBe(2);
  });

  it('refunds a rejected status and permits different statuses within one accepted area activation', () => {
    const { world: w, dummies } = setup();
    withProcContext(w, 'status', () => {
      expect(inflict(w, dummies[0], { kind: 'slow', duration: 2, chance: 0 })).toBe(false);
    });
    expect(w.vars['__proc:status']).toBeUndefined();
    withProcContext(w, 'status', () => {
      expect(inflict(w, dummies[0], { kind: 'slow', duration: 2 })).toBe(true);
      expect(inflict(w, dummies[0], { kind: 'freeze', duration: 1 })).toBe(true);
    });
    expect(dummies[0].hasStatus('slow')).toBe(true);
    expect(dummies[0].hasStatus('freeze')).toBe(true);
  });
  it('first proc is immediate; failed callbacks, exceptions and recursion do not spend/reenter it', () => {
    const { world: w } = setup();
    expect(runProc(w, 'test', () => false)).toBe(false);
    expect(() => runProc(w, 'test', () => { throw Error('failed'); })).toThrow('failed');
    let calls = 0;
    expect(runProc(w, 'test', () => { calls++; expect(runProc(w, 'test', () => true)).toBe(false); return true; })).toBe(true);
    w.time = 0.199; expect(runProc(w, 'test', () => { calls++; return true; })).toBe(false);
    w.time = 0.2; expect(runProc(w, 'test', () => { calls++; return true; })).toBe(true);
    expect(calls).toBe(2);
  });

  it('preserves longer cooldowns, separates owners/effects, and retains them through checkpoints', () => {
    const { world: w } = setup();
    const before = stateHash(w);
    runProc(w, 'long', () => true, 2);
    expect(stateHash(w)).not.toBe(before);
    const checkpoint = captureCheckpoint(w);
    w.player.vars = {};
    expect(runProc(w, 'long', () => true)).toBe(true); // An independent owner's vars.
    restoreCheckpoint(w, checkpoint);
    w.time = 1.99; expect(runProc(w, 'long', () => true)).toBe(false);
    expect(runProc(w, 'other', () => true)).toBe(true);
    w.time = 2; expect(runProc(w, 'long', () => true)).toBe(true);
    runProcStatus(w, 's', 100, () => true);
    w.time = 4; pruneProcState(w);
    expect(Object.keys(w.vars).filter(k => k.startsWith('__procStatus:'))).toEqual([]);
  });

  it('spends no cooldown on a failed chance or a lightning search without targets', () => {
    const { world: w, dummies } = setup('copper_coil');
    const chance = vi.spyOn(w.rng, 'chance').mockReturnValue(false);
    w.items.onHit(dummies[0], hit());
    expect(w.vars['__proc:a:copper_coil']).toBeUndefined();
    chance.mockReturnValue(true);
    w.enemies = [dummies[0]];
    w.items.onHit(dummies[0], hit());
    expect(w.vars['__proc:a:copper_coil']).toBeUndefined();
    w.enemies = dummies;
    const hp = dummies[1].hp;
    w.items.onHit(dummies[0], hit());
    expect(dummies[1].hp).toBeLessThan(hp);
    expect(w.vars['__proc:a:copper_coil']).toBeCloseTo(0.2);
  });

  it('one AoE hits the entire cluster while a second activation cannot multiply by target count', () => {
    const { world: w, dummies } = setup();
    const hp = dummies.map(e => e.hp);
    withProcContext(w, 'blast', () => miniBlast(w, dummies[0].x, dummies[0].y, 80, 10));
    expect(dummies.map((e, i) => hp[i] - e.hp)).toEqual([10, 10, 10, 10, 10]);
    withProcContext(w, 'blast', () => miniBlast(w, dummies[0].x, dummies[0].y, 80, 10));
    expect(dummies.map((e, i) => hp[i] - e.hp)).toEqual([10, 10, 10, 10, 10]);
    const count = withProcContext(w, 'chain', () => chainLightning(w, dummies[0].x, dummies[0].y, { first: dummies[0], damage: 5, jumps: 4 }));
    expect(count).toBe(4);
  });

  it.each(['viper_fang', 'crimson_edge', 'tinder_pouch', 'rime_shard', 'rusted_nail', 'constellation_needle'])('%s shares 0.2s globally and 0.5s per enemy across copies and weapon changes', id => {
    const { world: w, dummies } = setup(id);
    vi.spyOn(w.rng, 'chance').mockReturnValue(true);
    const modify = (i: number) => { const h = hit(); w.items.modifyHit(dummies[i], h); return h.statuses?.length ?? 0; };
    expect(modify(0)).toBe(1);
    expect(modify(1)).toBe(0);
    w.items.give(id); w.player.equipWeapon(w, 'dragon_breath');
    w.time = 0.2;
    expect(modify(0)).toBe(0);
    expect(modify(1)).toBe(1);
    w.time = 0.5;
    expect(modify(0)).toBe(1);
  });

  it.each(['projectile', 'laser', 'melee'] as const)('caps %s-triggered shard emissions and prevents secondary cascades', kind => {
    const { world: w, dummies } = setup('toxin_splitter');
    const spawned = vi.spyOn(w, 'spawn');
    for (let i = 0; i < 30; i++) { w.time = i / 60; w.items.onHit(dummies[0], hit(2, kind)); }
    const shots = spawned.mock.calls.map(c => c[0]).filter(e => e instanceof Projectile && e.generation > 0) as Projectile[];
    expect(shots).toHaveLength(9); // t=0,.2,.4; 3 shots each, independent of target count.
    expect(shots.every(p => p.hitIds.has(dummies[0].id))).toBe(true);
    w.time = 1;
    w.items.onHit(dummies[1], { ...hit(), source: shots[0] });
    expect(spawned.mock.calls.map(c => c[0]).filter(e => e instanceof Projectile && e.generation > 0)).toHaveLength(9);
    shots[0].hitActor(w, dummies[1]); shots[1].hitActor(w, dummies[1]);
    expect(dummies[1].statuses.get('poison')?.stacks).toBe(1);
  });

  it('allows only identifiable primary projectile explosions, and ordinary damage modifiers remain unrestricted', () => {
    const { world: w, dummies } = setup('heartstring');
    const p = new Projectile({ team: 'player', x: 0, y: 0, angle: 0, speed: 100, damage: 5 });
    expect(isPrimary({ ...hit(10, 'explosion'), source: p })).toBe(true);
    p.generation = 1;
    expect(isPrimary({ ...hit(10, 'explosion'), source: p })).toBe(false);
    expect(isPrimary(hit(10, 'explosion'))).toBe(false);
    expect(isPrimary({ ...hit(10, 'explosion'), procs: ['weapon-primary'] })).toBe(true);
    expect(isPrimary({ ...hit(10, 'explosion'), procs: ['weapon-primary'], noProc: true })).toBe(false);
    for (let i = 0; i < 5; i++) { const h = hit(); w.items.modifyHit(dummies[0], h); expect(h.damage).toBeCloseTo(13); }
    expect(Artifacts.must('heartstring').desc).toContain('30%');
  });

  it('lets a marked primary weapon explosion receive an artifact status without allowing item explosions to do so', () => {
    const { world: w, dummies } = setup('viper_fang');
    vi.spyOn(w.rng, 'chance').mockReturnValue(true);
    const primary = { ...hit(10, 'explosion'), procs: ['weapon-primary'] };
    w.items.modifyHit(dummies[0], primary);
    expect(primary.statuses?.[0].kind).toBe('poison');
    w.time = 1;
    const secondary = { ...hit(10, 'explosion'), noProc: true };
    w.items.modifyHit(dummies[0], secondary);
    expect(secondary.statuses).toBeUndefined();
  });
});
