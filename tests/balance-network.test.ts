// Local lockstep transport coverage, not an Internet/WebRTC or mobile FPS test.
import './headless';
import { fakeDisplay } from './headless';
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { runCoop, type CoopResult } from './coopsim';
import { DUMMY_ID, measureDps } from './dpsharness';
import { World } from '../src/game/world';
import { Projectile } from '../src/game/projectile';
import { Weapons } from '../src/game/defs';
import { Tile } from '../src/game/tiles';
import { FIXED_DT } from '../src/game/constants';
import { EMBER_MAX } from '../src/game/player';
import { RunState } from '../src/game/run';
import { Renderer } from '../src/engine/renderer';
import { HELD, PRESS, emptyInput, fixedRules } from '../src/game/seam';
import { blessingChoices } from '../src/game/blessings';
import { stateHash } from '../src/game/statehash';
import { runProc } from '../src/game/procs';
import { captureCheckpoint, restoreCheckpoint } from '../src/game/checkpoint';
import { LockstepHost } from '../src/net/lockstep';
import type { CoopCommand } from '../src/game/coop';
import { RefugeOwned } from '../src/content/characters/refuge-common';
import { RefugeCharge } from '../src/content/characters/refuge-devices';
import { RefugeRelease } from '../src/content/characters/refuge-release';

const artifacts = ['viper_fang', 'crimson_edge', 'tinder_pouch', 'rime_shard', 'rusted_nail',
  'constellation_needle', 'copper_coil', 'toxin_splitter', 'bless_reaction'];
const scenarios = [
  { name: 'devices-and-melee', chars: ['tove', 'luen', 'ves', 'ort'],
    weapons: ['sunset_rifle', 'gatekeeper_shotgun', 'dawn_pike', 'gatebreaker_maul'], leaveAt: 0 },
  { name: 'seal-and-charge', chars: ['mira', 'tove', 'luen', 'ves'],
    weapons: ['silvermoon_longbow', 'gatekeeper_shotgun', 'sunset_rifle', 'dawn_pike'], leaveAt: 1300 },
];

function sameHashes(result: CoopResult): number {
  const reference = result.peers[0].hashes;
  let checked = 0;
  for (const peer of result.peers.slice(1)) {
    const n = Math.min(reference.length, peer.hashes.length);
    expect(n, `slot ${peer.slot} has enough shared frames`).toBeGreaterThan(1200);
    for (let tick = 0; tick < n; tick++) {
      if (reference[tick] === undefined || peer.hashes[tick] === undefined) continue;
      if (reference[tick] !== peer.hashes[tick]) throw Error(`slot ${peer.slot} diverged at tick ${tick}`);
      checked++;
    }
    expect(peer.desyncs).toEqual([]);
  }
  expect(result.peers[0].desyncs).toEqual([]);
  return checked;
}

function arena(w: World): void {
  for (const e of w.entities) if (!w.players.some(p => p === e)) e.dead = true;
  for (let y = 2; y < w.room.h - 2; y++) for (let x = 2; x < w.room.w - 2; x++) w.room.setTile(x, y, Tile.FLOOR);
  for (const p of w.players) { p.x = 122; p.y = 66 + p.slot * 24; p.aim = 0; }
  for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) {
    const e = w.spawnEnemy(DUMMY_ID, 154 + col * 20, 66 + row * 24)!;
    e.dormant = 0;
  }
}

function quantile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))].toFixed(3));
}

describe('balance rework through local four-peer lockstep transport', () => {
  for (const scenario of scenarios) it(scenario.name, () => {
    const decisions = new WeakMap<World, { serial: number; old: string[]; phase: number; at: number }>();
    const sent: { slot: number; type: string; floor?: number; serial?: number; id?: string | null }[] = [];
    const delivered: { slot: number; type: string; floor?: number; serial?: number; id?: string | null }[] = [];
    const observedDevices = new Set<string>(), observedStatuses = new Set<string>(), attacked = new Set<string>();
    const updates: number[] = [];
    let peakEntities = 0, peakShots = 0, peakParticles = 0, peakProcKeys = 0, drawChecks = 0;
    const originalUpdate = World.prototype.update, originalSeal = LockstepHost.prototype.sealFrame;
    const updateSpy = vi.spyOn(World.prototype, 'update').mockImplementation(function(this: World, dt) {
      if (this.local.slot !== 0) return originalUpdate.call(this, dt);
      const began = performance.now();
      const value = originalUpdate.call(this, dt);
      updates.push(performance.now() - began);
      return value;
    });
    const sealSpy = vi.spyOn(LockstepHost.prototype, 'sealFrame').mockImplementation(function(this: LockstepHost, ...args) {
      const frame = originalSeal.apply(this, args);
      for (const { slot, cmd } of frame.commands) if (cmd.type === 'bless_reroll' || cmd.type === 'bless') delivered.push({ slot, ...cmd });
      return frame;
    });
    const started = performance.now(), memoryBefore = process.memoryUsage().heapUsed;
    let result: CoopResult;
    try {
      result = runCoop({
        name: scenario.name, seed: `BALANCE-NET-${scenario.name}`, chars: scenario.chars,
        ms: 25_000, link: { latencyMs: 60, jitterMs: 35, drop: .06, rtoMs: 170 },
        drift: [.002, -.003, .004], bossAt: 0, downAt: 900,
        leaveAt: scenario.leaveAt, discardAt: 0, stayInRoom: true,
        commands(w, step) {
          let d = decisions.get(w);
          if (!d) { d = { serial: w.local.vars.__blessOfferSerial, old: blessingChoices(w), phase: 0, at: 0 }; decisions.set(w, d); }
          const commands: CoopCommand[] = [];
          if (d.phase === 0) {
            commands.push({ type: 'bless_reroll', floor: w.run.floor + 1, serial: d.serial },
              { type: 'bless_reroll', floor: w.run.floor, serial: d.serial + 10 });
            d.phase = 1;
          } else if (d.phase === 1 && step >= 35) {
            expect(w.local.vars.__blessRerollUsed).toBeUndefined();
            commands.push({ type: 'bless_reroll', floor: w.run.floor, serial: d.serial });
            d.phase = 2;
          } else if (d.phase === 2 && w.local.vars.__blessRerollUsed === 1) {
            expect(w.local.vars.__blessOfferSerial).toBe(d.serial + 1);
            expect(blessingChoices(w).some(id => d!.old.includes(id))).toBe(false);
            commands.push({ type: 'bless_reroll', floor: w.run.floor, serial: d.serial },
              { type: 'bless_reroll', floor: w.run.floor, serial: d.serial + 1 },
              { type: 'bless', floor: w.run.floor, id: d.old[0] });
            d.phase = 3; d.at = step;
          } else if (d.phase === 3 && step >= d.at + 40) {
            expect(w.local.vars.__blessedFloor ?? 0).toBeLessThan(w.run.floor);
            expect(w.local.vars.__blessOfferSerial).toBe(d.serial + 1);
            commands.push({ type: 'bless', floor: w.run.floor, id: blessingChoices(w)[0] });
            d.phase = 4;
          }
          for (const cmd of commands) sent.push({ slot: w.local.slot, ...cmd });
          return commands;
        },
        input(w, step, out) {
          Object.assign(out, emptyInput());
          out.cx = 165; out.cy = 66 + w.local.slot * 24;
          out.held = HELD.fire | HELD.cursorAim;
          if (step % 180 === 90) out.pressed |= PRESS.release;
          if (step % 240 === 150) out.pressed |= PRESS.dash;
        },
        extraStep(w, tick) {
          if (w.floorCard && tick < 300) w.floorCard.t = -100; // Keep the harness auto-pick behind our transported decisions.
          if (tick === 1) { w.rules = fixedRules({ hitStop: false }); arena(w); }
          if (tick === 4) for (const p of w.players) w.asPlayer(p, () => {
            p.god = true; p.equipWeapon(w, scenario.weapons[p.slot]);
            for (const id of artifacts) p.items.give(id);
          });
          if (tick > 4 && tick % 180 === 5) for (const p of w.players) { p.ember = EMBER_MAX; p.releaseCooldown = 0; }
          if (tick > 4 && tick % 30 === 0) for (const p of w.players) {
            w.spawn(new Projectile({ team: 'enemy', x: 225, y: p.y, angle: Math.PI, speed: 120, damage: 1, range: 260 }));
          }
          if (tick === 600) {
            w.teleportTo(w.map.nodes.find(n => n !== w.node && n.kind === 'normal')!);
            arena(w);
          }
          if (w.local.slot === 0) {
            peakEntities = Math.max(peakEntities, w.entities.length);
            peakShots = Math.max(peakShots, w.projectiles.length);
            peakParticles = Math.max(peakParticles, w.particles.list.length);
            peakProcKeys = Math.max(peakProcKeys, ...w.players.map(p => Object.keys(p.vars).filter(k => k.startsWith('__proc')).length));
            for (const e of w.entities) if (e instanceof RefugeOwned) {
              observedDevices.add(e.constructor.name);
              expect(e.ctxP).toBe(e.owner);
            }
            for (const e of w.enemies) for (const status of e.statuses.keys()) observedStatuses.add(status);
            for (const p of w.players) if (p.weapon.combo > 0) attacked.add(p.weaponId);
          }
          if (w.local.slot === 2 && tick % 41 === 0) {
            const hash = stateHash(w), opacity = w.renderer.worldOpacity;
            for (const e of w.entities) if (e instanceof RefugeOwned) e.draw(w.renderer, w);
            for (const p of w.players) Weapons.must(p.weaponId).draw?.(w, p, w.renderer, p.weapon);
            expect(stateHash(w)).toBe(hash); expect(w.renderer.worldOpacity).toBe(opacity); drawChecks++;
          }
        },
      });
    } finally { updateSpy.mockRestore(); sealSpy.mockRestore(); }
    const checked = sameHashes(result!);
    const host = result!.peers[0];
    for (const peer of result!.peers) {
      expect(peer.net.state).toBe('running');
      for (const p of peer.world.players) {
        expect(Number.isFinite(p.ember)).toBe(true);
        expect(p.vars.__blessRerollUsed).toBe(1);
        expect(p.vars.__blessOfferSerial).toBe(2);
        expect(p.vars.__blessedFloor).toBe(1);
      }
    }
    // Every request, including rejects, was sealed into the actual transport frames.
    expect(delivered).toHaveLength(sent.length);
    for (let slot = 0; slot < 4; slot++) {
      expect(delivered.filter(c => c.slot === slot && c.type === 'bless_reroll')).toHaveLength(5);
      expect(delivered.filter(c => c.slot === slot && c.type === 'bless')).toHaveLength(2);
    }
    expect(host.log.some(s => s.endsWith(':downed'))).toBe(true);
    expect(host.log.some(s => s.endsWith(':revived'))).toBe(true);
    expect(host.world.players).toHaveLength(scenario.leaveAt ? 3 : 4);
    for (const weapon of scenario.weapons) expect(attacked.has(weapon), weapon + ' actually attacked').toBe(true);
    expect(observedDevices.has('RefugeRelease')).toBe(true);
    expect(observedStatuses.size).toBeGreaterThanOrEqual(4);
    expect(peakProcKeys).toBeGreaterThan(5);
    expect(result!.net.stats.retransmits).toBeGreaterThan(0);
    const report = { scenario: scenario.name, scope: 'Node headless, real lockstep code over MemoryTransport; no Internet/WebRTC or device FPS claim',
      virtualSeconds: 25, chars: scenario.chars, weapons: scenario.weapons, frames: result!.peers.map(p => p.hashes.length),
      checked, commandsSealed: delivered.length, network: result!.net.stats, drawChecks,
      devices: [...observedDevices], statuses: [...observedStatuses], damage: host.world.run.stats.damageDealt,
      peakEntities, peakShots, peakParticles, peakProcKeys,
      hostWorldUpdateMs: { median: quantile(updates, .5), p95: quantile(updates, .95), p99: quantile(updates, .99), max: Math.max(...updates) },
      wallMs: Math.round(performance.now() - started), heapDeltaMiB: Number(((process.memoryUsage().heapUsed - memoryBefore) / 1048576).toFixed(2)) };
    mkdirSync('test-results/balance-network', { recursive: true });
    writeFileSync(`test-results/balance-network/${scenario.name}.json`, JSON.stringify(report, null, 2));
    console.log('[balance-network]', JSON.stringify(report));
  }, 90_000);

  it('hashes pending device memory, ownership and proc budgets; removes pending devices on departure', () => {
    const w = measureDps({ character: 'tove', weapon: 'sunset_rifle', seconds: 0 }).world;
    w.startParty(['tove', 'mira', 'ort', 'luen'].map((characterId, slot) => ({ characterId, slot, name: '' })), 0);
    const a = w.players[0], b = w.players[1];
    const charge = w.withIds(() => w.spawn(new RefugeCharge(w, a, a.x, a.y, 10)));
    expect(w.entities).not.toContain(charge); expect(w.entityById(charge.id)).toBe(charge);
    const original = stateHash(w);
    charge.mem.damage += 1; expect(stateHash(w)).not.toBe(original); charge.mem.damage -= 1;
    charge.owner = b; expect(stateHash(w)).not.toBe(original); charge.owner = a;
    charge.ctxP = b; expect(stateHash(w)).not.toBe(original); charge.ctxP = a;
    expect(stateHash(w)).toBe(original);
    w.asPlayer(a, () => runProc(w, 'network-audit', () => true));
    const withBudget = stateHash(w); expect(withBudget).not.toBe(original);
    expect(w.asPlayer(b, () => runProc(w, 'network-audit', () => true))).toBe(true);
    expect(stateHash(w)).not.toBe(withBudget);
    w.removePlayer(a.slot); expect(charge.dead).toBe(true); expect(w.entityById(charge.id)).toBeUndefined();
  });

  it('queued releases stop after their owner dies and cannot cross a room boundary', () => {
    for (const [mode, character] of ['tove', 'luen', 'ves', 'ort', 'mira'].entries()) {
      const { world: w, dummies } = measureDps({ character, weapon: 'sunset_rifle', seconds: 0 });
      const release = w.withIds(() => w.spawn(new RefugeRelease(w.player, mode, w)));
      const hp = dummies[0].hp;
      w.player.dead = true; release.update(w, FIXED_DT);
      expect(release.dead).toBe(true); expect(dummies[0].hp).toBe(hp);
      w.player.dead = false;
      const second = w.withIds(() => w.spawn(new RefugeRelease(w.player, mode, w)));
      w.withIds(() => w.teleportTo(w.map.nodes.find(n => n !== w.node && n.kind === 'normal')!));
      expect(w.entityById(second.id)).toBeUndefined();
      second.update(w, FIXED_DT); expect(second.dead).toBe(true);
    }
  });

  it('checkpoint JSON preserves proc deadlines and blessing decisions without persisting active entities', () => {
    const { world: w } = measureDps({ character: 'mira', weapon: 'silvermoon_longbow', seconds: 0 });
    w.time = 15; runProc(w, 'checkpoint', () => true, 2);
    w.vars.__blessRerollUsed = 1; w.vars.__blessRevision = 1;
    const c = JSON.parse(JSON.stringify(captureCheckpoint(w)));
    const { world: resumed } = measureDps({ character: 'mira', weapon: 'lantern_bolt', seconds: 0 });
    restoreCheckpoint(resumed, c);
    expect(resumed.player.weaponId).toBe('silvermoon_longbow');
    expect(resumed.vars.__blessRerollUsed).toBe(1);
    expect(resumed.vars['__proc:checkpoint']).toBe(17);
    expect(runProc(resumed, 'checkpoint', () => true)).toBe(false);
    resumed.time = 17; expect(runProc(resumed, 'checkpoint', () => true)).toBe(true);
    expect(resumed.entities.some(e => e instanceof RefugeOwned)).toBe(false);
  });

  it('all five keepers resume a stage-start checkpoint into fresh, identical worlds', () => {
    const fresh = (character: string, stage: number) => {
      const run = new RunState('BALANCE-STAGE-RESTORE', character);
      run.staged = true; run.stage = stage;
      const w = new World(new Renderer(fakeDisplay(1280, 720)), run, { openInventory() {}, onGameOver() {} });
      w.rules = fixedRules({ hitStop: false });
      w.inputSource = (_w, _p, out) => Object.assign(out, emptyInput());
      w.start();
      return w;
    };
    for (const character of ['tove', 'luen', 'ves', 'ort', 'mira']) {
      const source = fresh(character, 1);
      for (let tick = 0; tick < 20; tick++) source.update(FIXED_DT);
      source.run.stage = 2;
      source.withIds(() => source.startFloor(1));
      source.update(FIXED_DT); // GameScene saves after the update that crossed the stage boundary.
      const checkpoint = JSON.parse(JSON.stringify(captureCheckpoint(source)));
      const a = fresh(character, 2), b = fresh(character, 2);
      restoreCheckpoint(a, checkpoint); restoreCheckpoint(b, checkpoint);
      const choices = blessingChoices(a);
      for (let tick = 0; tick < 90; tick++) {
        a.update(FIXED_DT); b.update(FIXED_DT);
        expect(stateHash(a), character + ' restored tick ' + tick).toBe(stateHash(b));
      }
      expect(blessingChoices(a)).toEqual(choices);
      if (character === 'ort') expect(a.entities.filter(e => e instanceof RefugeOwned && !e.dead)).toHaveLength(1);
    }
  });
});
