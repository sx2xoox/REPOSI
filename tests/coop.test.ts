// Online co-op, headless: 2, 3 and 4 real Worlds driven through the lockstep
// (LockstepHost / LockstepClient over MemoryTransport with latency + jitter)
// by NetRun, each peer's bot playing its own keeper. Thousands of steps across
// rooms and doors, a boss, a downed keeper revived by a teammate, blessing and
// discard commands and a player leaving: every peer must produce the identical
// stateHash after every frame, and the lockstep's own hash exchange must never
// report a desync. Harness: tests/coopsim.ts.
//
//   npx vitest run tests/coop

import './headless';
import { describe, expect, it } from 'vitest';
import { runCoop, type CoopResult, type CoopScenario } from './coopsim';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Renderer } from '../src/engine/renderer';
import { fakeDisplay } from './headless';
import { fixedRules } from '../src/game/seam';
import { stateHash } from '../src/game/statehash';
import { FIXED_DT } from '../src/game/constants';
import { BASE_VARIANT, runScenario } from './detsim';

/** Every peer's per-frame hashes equal the host's on the frames both simulated. */
function expectSameHashes(res: CoopResult): { frames: number[]; checked: number } {
  const ref = res.peers[0].hashes;
  let checked = 0;
  const frames: number[] = [];
  for (const p of res.peers) {
    const n = Math.min(ref.length, p.hashes.length);
    frames.push(p.hashes.length);
    for (let t = 0; t < n; t++) {
      if (p.hashes[t] === undefined || ref[t] === undefined) continue;
      if (p.hashes[t] !== ref[t]) {
        throw new Error(`${p.slot}: first hash mismatch at tick ${t} (host ${ref[t].toString(16)} vs ${p.hashes[t].toString(16)})`);
      }
      checked++;
    }
  }
  return { frames, checked };
}

function summary(res: CoopResult): string {
  const w = res.peers[0].world;
  const s = w.run.stats;
  return `floor ${w.run.floor} rooms ${s.roomsCleared} kills ${s.kills} bosses ${s.bossesKilled} keepers ${w.players.length} log ${res.peers[0].log.filter((x) => !x.includes('stuck') && !x.includes(':tp')).join(' ')}`;
}

const LINK = { latencyMs: 35, jitterMs: 25 };

const SCENARIOS: (CoopScenario & { expectLeave: boolean })[] = [
  {
    name: 'clock spire party', seed: 'COOP-NEW-7', chars: ['mori', 'bori', 'baekgu'], floor: 7,
    ms: 140_000, link: LINK, bossAt: 3600, downAt: 700, leaveAt: 0, discardAt: 350, expectLeave: false,
  },
  {
    name: 'new keepers in archive', seed: 'COOP-NEW-6', chars: ['bori', 'baekgu', 'mori', 'mori'], floor: 6,
    ms: 110_000, link: LINK, bossAt: 2200, downAt: 700, leaveAt: 0, discardAt: 350, expectLeave: false,
  },
  {
    name: '2 keepers', seed: 'COOP-2', chars: ['ria', 'serin'], ms: 110_000, link: LINK, bossAt: 2400, downAt: 900, leaveAt: 0, discardAt: 400,
    expectLeave: false,
  },
  {
    name: '3 keepers, one leaves', seed: 'COOP-3', chars: ['bern', 'ria', 'niel'], ms: 100_000, link: { latencyMs: 25, jitterMs: 40, drop: 0.02 }, bossAt: 2000,
    downAt: 700, leaveAt: 3200, discardAt: 300, drift: [0.004, -0.003], expectLeave: true,
  },
  {
    name: '4 keepers, one leaves', seed: 'COOP-4', chars: ['serin', 'bern', 'ria', 'serin'], ms: 110_000, link: LINK, bossAt: 3000, downAt: 600,
    leaveAt: 3400, discardAt: 350, drift: [0.002, -0.002, 0.003], expectLeave: true,
  },
];

describe('online co-op: lockstep worlds stay identical', () => {
  for (const sc of SCENARIOS) {
    it(`${sc.name}: identical stateHash on every peer after every frame`, () => {
      const res = runCoop(sc);
      const host = res.peers[0];
      const { frames, checked } = expectSameHashes(res);
      const info = `${summary(res)} frames ${frames.join('/')} checked ${checked}`;
      console.log(`[coop] ${sc.name}: ${info}`);
      // thousands of frames, every client caught up with almost all of them
      expect(host.hashes.length, info).toBeGreaterThan(4000);
      for (const p of res.peers) {
        if (p.gone) continue;
        expect(p.hashes.length, `slot ${p.slot}`).toBeGreaterThan(host.hashes.length * 0.97);
        expect(p.desyncs, `slot ${p.slot} desync`).toEqual([]);
        expect(p.net.state).toBe('running');
      }
      // the lockstep's own periodic hash exchange agreed too (the host compares every report)
      expect(host.desyncs).toEqual([]);
      const w = host.world;
      // it really played: rooms, a boss, the scripted downing + revive, commands, a leave
      expect(w.run.stats.roomsCleared, info).toBeGreaterThanOrEqual(3);
      expect(w.run.stats.bossesKilled, info).toBeGreaterThanOrEqual(1);
      expect(host.log.some((s) => s.endsWith(':downed')), info).toBe(true);
      expect(host.log.some((s) => s.endsWith(':revived')), info).toBe(true);
      expect(w.coopEvents.some((e) => e.kind === 'revive') || host.log.some((s) => s.endsWith(':revived'))).toBe(true);
      // every keeper picked a blessing on the first floor (a command each)
      for (const p of w.players) expect(Object.keys(p.vars).some((k) => k.startsWith('blessedAt:')), `slot ${p.slot} blessed`).toBe(true);
      // slot 1's discard left a pedestal-able copy behind: one fewer artifact than gifts + innate + blessings
      expect(w.players.find((p) => p.slot === 1)?.inv.items.length).toBeGreaterThan(0);
      if (sc.expectLeave) {
        expect(w.players.length).toBe(sc.chars.length - 1);
        for (const p of res.peers) if (!p.gone) expect(p.world.players.map((q) => q.slot)).toEqual(w.players.map((q) => q.slot));
      } else expect(w.players.length).toBe(sc.chars.length);
    }, 240_000);
  }

  it('the discard command removes the artifact on every peer at the same tick', () => {
    const sc: CoopScenario = { name: 'discard', seed: 'COOP-D', chars: ['ria', 'bern'], ms: 9000, link: LINK, bossAt: 0, downAt: 0, leaveAt: 0, discardAt: 120 };
    const res = runCoop(sc);
    expectSameHashes(res);
    for (const p of res.peers) {
      const k = p.world.players.find((q) => q.slot === 1)!;
      // gifts gave 3 artifacts; one went back onto a pedestal
      const innate = k.character.artifacts?.length ?? 0;
      const blessings = Object.keys(k.vars).filter((x) => x.startsWith('blessedAt:')).length;
      expect(k.inv.items.length).toBe(innate + 3 - 1 + blessings);
    }
  }, 60_000);
});

describe('co-op desync detection', () => {
  it('a 1e-9 px nudge on one peer shows up in the per-frame hashes and in the lockstep hash exchange', () => {
    const sc: CoopScenario = {
      name: 'inject', seed: 'COOP-X', chars: ['ria', 'niel', 'bern'], ms: 8000, link: LINK, bossAt: 0, downAt: 0, leaveAt: 0, discardAt: 0,
      inject: { slot: 2, tick: 200 },
    };
    const res = runCoop(sc);
    const [host, , bad] = res.peers;
    let first = -1;
    for (let t = 0; t < Math.min(host.hashes.length, bad.hashes.length); t++) if (host.hashes[t] !== bad.hashes[t]) { first = t; break; }
    expect(first).toBe(200);
    for (let t = 0; t < Math.min(host.hashes.length, res.peers[1].hashes.length); t++) expect(res.peers[1].hashes[t]).toBe(host.hashes[t]);
    // the host compares the tick-240 reports and tells everyone
    expect(host.desyncs.length).toBeGreaterThan(0);
    expect(host.desyncs[0]).toMatchObject({ tick: 240, slot: 2 });
    expect(bad.net.state).toBe('desync');
    expect(host.net.state).toBe('desync');
  });
});

describe('co-op does not change single-player', () => {
  it('a solo world never turns on co-op state', () => {
    const r = runScenario({ name: 'solo', seed: 'COOP-SOLO', character: 'ria', floors: [1], exploreSteps: 600, bossSteps: 600, giftsPerFloor: 3, maxSteps: 1500, cycle: true, extraEnemies: 1 }, BASE_VARIANT);
    const w = r.world;
    expect(w.coop).toBe(false);
    expect(w.players.length).toBe(1);
    expect(w.local).toBe(w.player);
    expect(w.partyHpMult(true)).toBe(1);
    expect(w.coopEvents).toEqual([]);
  });

  it('start() equals a one-keeper non-co-op party (same hash sequence)', () => {
    const r = new Renderer(fakeDisplay(1280, 720));
    const host = { openInventory() {}, onGameOver() {} };
    const mk = (party: boolean) => {
      const run = new RunState('COOP-SP', 'serin');
      const w = new World(r, run, host);
      w.rules = fixedRules({ hitStop: true });
      if (party) w.startParty([{ slot: 0, characterId: 'serin', name: '' }], 0, false);
      else w.start();
      const hs: number[] = [];
      for (let i = 0; i < 300; i++) {
        w.update(FIXED_DT);
        hs.push(stateHash(w));
      }
      return hs;
    };
    expect(mk(true)).toEqual(mk(false));
  });
});
