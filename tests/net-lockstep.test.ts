import { describe, expect, it } from 'vitest';
import { MemoryNetwork, type LinkOptions } from '../src/net/transport-memory';
import { LockstepClient, LockstepHost, STEP_MS, shouldHash, type DesyncEvent } from '../src/net/lockstep';
import { frameDigest, type Frame, type NetCommand } from '../src/net/wire';

// ---------------------------------------------------------------- harness
// Virtual time in 1 ms ticks; the host steps every STEP_MS, each client every
// STEP_MS with its own phase (and optional clock drift). Inputs: byte 0 = EDGE
// (one bit per tap), byte 4.. = HELD (slot, step counter).

interface Peer {
  slot: number;
  frames: Frame[];
  nextAt: number;
  period: number;
  step: number;
  paused: number;
  taps: number[];
  lastTap: number;
  sentCmds: NetCommand[];
}

function makeSim(nClients: number, link: LinkOptions, seed = 1, opts: { initialBuffer?: number; drift?: number[] } = {}) {
  const net = new MemoryNetwork({ seed, ...link });
  const ht = net.hostSync('TEST');
  const cts = Array.from({ length: nClients }, () => net.joinSync('TEST'));
  net.advance(300);
  const players = [{ slot: 0, peer: ht.localId }, ...cts.map((t, i) => ({ slot: i + 1, peer: t.localId }))];
  const host = new LockstepHost(ht, players, 0, { now: net.now });
  const clients = cts.map((t, i) => new LockstepClient(t, i + 1, { now: net.now, initialBuffer: opts.initialBuffer ?? 2 }));
  let r = seed * 9301 + 49297;
  const rand = () => ((r = (r * 233280 + 49297) % 2147483647) / 2147483647);
  const mk = (slot: number, phase: number, period = STEP_MS): Peer => ({
    slot, frames: [], nextAt: net.time + phase, period, step: 0, paused: 0, taps: new Array(8).fill(0), lastTap: -99, sentCmds: [],
  });
  const hp = mk(0, 0);
  const cps = clients.map((_, i) => mk(i + 1, 1 + rand() * STEP_MS, STEP_MS * (1 + (opts.drift?.[i] ?? 0))));
  let tapping = true;
  let hostPaused = 0;
  let hostCut = false;
  const hostCmds: { at: number; cmd: NetCommand }[] = [];
  const clientHooks: ((i: number, p: Peer) => void)[] = [];

  function sample(p: Peer): Uint8Array {
    const b = new Uint8Array(8);
    if (tapping && p.step - p.lastTap >= 3 && rand() < 0.15) {
      const tapIndex = p.taps.reduce((a, v) => a + v, 0);
      const bit = tapIndex % 8;
      b[0] = 1 << bit;
      p.taps[bit]++;
      p.lastTap = p.step;
    }
    b[4] = p.slot;
    b[5] = p.step & 0xff;
    b[6] = rand() < 0.5 ? 1 : 0; // held button flickers
    return b;
  }

  function hostStep(): void {
    host.poll();
    if (hostPaused > 0 || hostCut) {
      hostPaused = Math.max(0, hostPaused - 1);
      return;
    }
    hp.step++;
    const cmds = hostCmds.filter((c) => c.at === hp.step).map((c) => c.cmd);
    const f = host.sealFrame(host.tick + 1, sample(hp), cmds);
    hp.frames.push(f);
    if (shouldHash(f.tick)) host.submitHash(f.tick, frameDigest(f));
  }

  function clientStep(i: number): void {
    const c = clients[i];
    const p = cps[i];
    c.poll();
    if (p.paused > 0) {
      p.paused--;
      return;
    }
    p.step++;
    for (const h of clientHooks) h(i, p);
    c.sendInput(sample(p));
    for (let n = c.stepsDue(); n > 0; n--) {
      const f = c.nextFrame();
      p.frames.push(f);
      if (shouldHash(f.tick)) c.submitHash(f.tick, frameDigest(f));
    }
  }

  function run(ms: number): void {
    const end = net.time + ms;
    while (net.time < end) {
      net.advance(1);
      while (hp.nextAt <= net.time) {
        hostStep();
        hp.nextAt += hp.period;
      }
      cps.forEach((p, i) => {
        while (p.nextAt <= net.time) {
          clientStep(i);
          p.nextAt += p.period;
        }
      });
    }
  }

  return {
    net, host, clients, hp, cps, run,
    stopTapping: () => { tapping = false; },
    pauseHost: (steps: number) => { hostPaused = steps; },
    cutHost: () => { hostCut = true; },
    hostCommand: (at: number, cmd: NetCommand) => hostCmds.push({ at, cmd }),
    onClientStep: (h: (i: number, p: Peer) => void) => clientHooks.push(h),
  };
}

function digests(frames: Frame[]): number[] {
  return frames.map(frameDigest);
}

/** Every client's frame sequence equals the host's prefix of the same length. */
function expectIdentical(sim: ReturnType<typeof makeSim>): void {
  const ref = digests(sim.hp.frames);
  for (const p of sim.cps) {
    expect(p.frames.length).toBeGreaterThan(0);
    expect(p.frames.map((f) => f.tick)).toEqual(p.frames.map((_, i) => i));
    expect(digests(p.frames)).toEqual(ref.slice(0, p.frames.length));
  }
}

/** Every tap a peer sent shows up in exactly one sealed tick (by bit). */
function expectTapsKept(sim: ReturnType<typeof makeSim>): void {
  for (const p of sim.cps) {
    const seen = new Array(8).fill(0);
    for (const f of sim.hp.frames) {
      const inp = f.inputs[p.slot];
      if (!inp) continue;
      for (let b = 0; b < 8; b++) if (inp[0] & (1 << b)) seen[b]++;
    }
    expect(seen).toEqual(p.taps);
    expect(p.taps.reduce((a, v) => a + v, 0)).toBeGreaterThan(20);
  }
}

// ---------------------------------------------------------------- tests
describe('lockstep: identical frames, no lost taps', () => {
  for (const n of [1, 2, 3]) {
    it(`${n + 1} peers with latency + jitter`, () => {
      const sim = makeSim(n, { latencyMs: 35, jitterMs: 25 }, n);
      sim.run(12000);
      sim.stopTapping();
      sim.run(1500);
      expectIdentical(sim);
      expectTapsKept(sim);
      // clients stay close behind the host
      for (const p of sim.cps) expect(sim.hp.frames.length - p.frames.length).toBeLessThan(12);
    });
  }

  it('survives packet loss (retransmits) with uneven links', () => {
    const sim = makeSim(3, { latencyMs: 30, jitterMs: 15, drop: 0.03, rtoMs: 150 }, 11);
    sim.net.setLink(sim.host['t'].localId, sim.clients[2]['t'].localId, { latencyMs: 120, jitterMs: 40 });
    sim.run(10000);
    sim.stopTapping();
    sim.run(2000);
    expectIdentical(sim);
    expectTapsKept(sim);
    for (const c of sim.clients) expect(c.stats.target).toBeGreaterThanOrEqual(2);
  });

  it('collapses several samples into one tick: edges OR-ed, latest held', () => {
    const net = new MemoryNetwork({ latencyMs: 10 });
    const ht = net.hostSync('M');
    const ct = net.joinSync('M');
    net.advance(50);
    const host = new LockstepHost(ht, [{ slot: 0, peer: ht.localId }, { slot: 1, peer: ct.localId }], 0, { now: net.now, staleInputMs: 600 });
    const c = new LockstepClient(ct, 1, { now: net.now });
    host.sealFrame(0, new Uint8Array(0));
    c.sendInput(new Uint8Array([0b001, 0, 0, 0, 1]));
    c.sendInput(new Uint8Array([0b000, 0, 0, 0, 2]));
    c.sendInput(new Uint8Array([0b100, 0, 0, 0, 3]));
    net.advance(20);
    const f1 = host.sealFrame(1, new Uint8Array(0));
    expect([...f1.inputs[1]!]).toEqual([0b101, 0, 0, 0, 3]);
    // no new sample: held repeats, edges cleared
    net.advance(17);
    const f2 = host.sealFrame(2, new Uint8Array(0));
    expect([...f2.inputs[1]!]).toEqual([0, 0, 0, 0, 3]);
    // a sample arriving after a seal lands in the next tick
    c.sendInput(new Uint8Array([0b010, 0, 0, 0, 4]));
    const f3 = host.sealFrame(3, new Uint8Array(0));
    expect([...f3.inputs[1]!]).toEqual([0, 0, 0, 0, 3]);
    net.advance(20);
    const f4 = host.sealFrame(4, new Uint8Array(0));
    expect([...f4.inputs[1]!]).toEqual([0b010, 0, 0, 0, 4]);
    // silent for longer than staleInputMs → neutral input
    net.advance(700);
    const f5 = host.sealFrame(5, new Uint8Array(0));
    expect(f5.inputs[1]!.length).toBe(0);
    expect(() => host.sealFrame(7, new Uint8Array(0))).toThrow();
  });
});

describe('lockstep: client pacing', () => {
  it('never stalls under modest jitter once buffered', () => {
    for (const seed of [1, 2, 3, 4]) {
      const sim = makeSim(3, { latencyMs: 40, jitterMs: 20 }, seed);
      sim.run(20000);
      for (const c of sim.clients) {
        expect(c.stats.underruns).toBe(0);
        expect(c.stats.target).toBeGreaterThanOrEqual(1);
        expect(c.stats.target).toBeLessThanOrEqual(3);
      }
      expectIdentical(sim);
    }
  });

  it('keeps a small buffer on a clean link', () => {
    const sim = makeSim(1, { latencyMs: 25, jitterMs: 0 }, 5, { initialBuffer: 1 });
    sim.run(5000);
    const c = sim.clients[0];
    expect(c.stats.underruns).toBe(0);
    expect(c.stats.target).toBe(1);
    // latency behind the host ≈ one-way delay + buffer (in ticks)
    expect(sim.hp.frames.length - sim.cps[0].frames.length).toBeLessThanOrEqual(4);
  });

  it('adapts to clock drift between host and client', () => {
    const sim = makeSim(2, { latencyMs: 30, jitterMs: 10 }, 9, { drift: [0.01, -0.01] });
    sim.run(20000);
    expectIdentical(sim);
    for (const [i, p] of sim.cps.entries()) {
      expect(sim.hp.frames.length - p.frames.length).toBeLessThan(10);
      expect(sim.clients[i].stats.underruns).toBeLessThan(5);
    }
    // the fast client (+1% period = slower clock) needs catch-ups, the other stretches
    expect(sim.clients[0].stats.catchUps).toBeGreaterThan(0);
    expect(sim.clients[1].stats.stretches).toBeGreaterThan(0);
  });

  it('catches up with double steps after a hiccup', () => {
    const sim = makeSim(1, { latencyMs: 30, jitterMs: 5 }, 4);
    sim.run(2000);
    sim.cps[0].paused = 30; // the client's tab hitched for half a second
    sim.run(3000);
    const c = sim.clients[0];
    expect(c.stats.catchUps).toBeGreaterThan(10);
    expect(sim.hp.frames.length - sim.cps[0].frames.length).toBeLessThan(8);
    expectIdentical(sim);
  });

  it('reports waiting for the host and resumes', () => {
    const sim = makeSim(2, { latencyMs: 30, jitterMs: 5 }, 6);
    sim.run(2000);
    expect(sim.clients.every((c) => !c.waitingForHost)).toBe(true);
    sim.pauseHost(90); // host tab stalls 1.5 s (its timer keeps pinging)
    sim.run(1000);
    expect(sim.clients.every((c) => c.waitingForHost)).toBe(true);
    sim.run(2500);
    expect(sim.clients.every((c) => !c.waitingForHost && c.endReason === null)).toBe(true);
    sim.run(2000);
    expectIdentical(sim);
    for (const p of sim.cps) expect(sim.hp.frames.length - p.frames.length).toBeLessThan(10);
  });
});

describe('lockstep: commands', () => {
  it('land on the same tick everywhere', () => {
    const sim = makeSim(3, { latencyMs: 40, jitterMs: 30 }, 7);
    sim.onClientStep((i, p) => {
      if (i === 0 && p.step === 100) sim.clients[0].sendCommand({ type: 'bless', pick: 1 });
      if (i === 1 && p.step === 150) sim.clients[1].sendCommand({ type: 'discard', id: 'lamp' });
      if (i === 1 && p.step === 151) sim.clients[1].sendCommand({ type: 'discard', id: 'mask' });
    });
    sim.hostCommand(120, { type: 'host-cmd', n: 5 });
    sim.run(6000);
    const list = (frames: Frame[]) => frames.flatMap((f) => f.commands.map((c) => `${f.tick}/${c.slot}/${JSON.stringify(c.cmd)}`));
    const ref = list(sim.hp.frames);
    expect(ref).toHaveLength(4);
    expect(ref.filter((s) => s.includes('"discard"')).map((s) => s.split('/')[2])).toEqual(['{"type":"discard","id":"lamp"}', '{"type":"discard","id":"mask"}']);
    for (const p of sim.cps) expect(list(p.frames)).toEqual(ref);
    expect(() => sim.clients[0].sendCommand({ type: 'x', blob: 'y'.repeat(9000) })).toThrow();
  });
});

describe('lockstep: leaving', () => {
  function leftTicks(frames: Frame[], slot: number): number[] {
    return frames.filter((f) => f.left.includes(slot)).map((f) => f.tick);
  }

  it('turns a voluntary leave into a left marker everyone applies at the same tick', () => {
    const sim = makeSim(3, { latencyMs: 30, jitterMs: 15 }, 8);
    const left: [number, string][] = [];
    sim.host.onPlayerLeft = (slot, why) => left.push([slot, why]);
    sim.run(2000);
    sim.clients[1].leave();
    sim.cps[1].paused = 1e9;
    sim.run(2000);
    expect(left).toEqual([[2, 'left']]);
    const t = leftTicks(sim.hp.frames, 2);
    expect(t).toHaveLength(1);
    for (const i of [0, 2]) expect(leftTicks(sim.cps[i].frames, 2)).toEqual(t);
    for (const f of sim.hp.frames) if (f.tick >= t[0]) expect(f.inputs[2]).toBeNull();
    expect(sim.host.slots).toEqual([0, 1, 3]);
    const ref = digests(sim.hp.frames);
    for (const i of [0, 2]) expect(digests(sim.cps[i].frames)).toEqual(ref.slice(0, sim.cps[i].frames.length));
  });

  it('drops a client that disconnects or goes silent (5 s timeout)', () => {
    const sim = makeSim(3, { latencyMs: 30, jitterMs: 15 }, 12);
    const left: [number, string][] = [];
    sim.host.onPlayerLeft = (slot, why) => left.push([slot, why]);
    sim.run(2000);
    sim.net.disconnect(sim.clients[0]['t'].localId); // clean close: immediate
    sim.cps[0].paused = 1e9;
    sim.run(1000);
    expect(left).toEqual([[1, 'disconnected']]);
    sim.net.cut(sim.clients[2]['t'].localId); // pulled cable: only the timeout notices
    sim.cps[2].paused = 1e9;
    sim.run(4000);
    expect(left).toHaveLength(1);
    sim.run(2000);
    expect(left).toEqual([[1, 'disconnected'], [3, 'timeout']]);
    const t3 = leftTicks(sim.hp.frames, 3);
    expect(leftTicks(sim.cps[1].frames, 3)).toEqual(t3);
    expect(leftTicks(sim.cps[1].frames, 1)).toEqual(leftTicks(sim.hp.frames, 1));
    expect(sim.host.slots).toEqual([0, 2]);
    // the dropped (but alive) client learns it was removed
    expect(sim.clients[2].endReason === null || sim.clients[2].endReason === 'host-lost').toBe(true);
  });

  it('tells clients when the host is gone', () => {
    const sim = makeSim(2, { latencyMs: 30, jitterMs: 5 }, 13);
    const ends: string[] = [];
    for (const c of sim.clients) c.onEnd = (r) => ends.push(r);
    sim.run(1500);
    sim.net.cut(sim.host['t'].localId);
    sim.cutHost();
    sim.run(1000);
    expect(sim.clients.every((c) => c.waitingForHost)).toBe(true);
    expect(ends).toEqual([]);
    sim.run(5000);
    expect(ends).toEqual(['host-lost', 'host-lost']);

    const sim2 = makeSim(1, { latencyMs: 30 }, 14);
    const ends2: string[] = [];
    sim2.clients[0].onEnd = (r) => ends2.push(r);
    sim2.run(1000);
    sim2.host.close();
    sim2.run(200);
    expect(ends2).toEqual(['closed']);
  });
});

describe('lockstep: desync detection', () => {
  it('flags a mismatching state hash everywhere', () => {
    const sim = makeSim(2, { latencyMs: 30, jitterMs: 10 }, 15);
    const seen: (DesyncEvent & { who: string })[] = [];
    sim.host.onDesync = (e) => seen.push({ ...e, who: 'host' });
    sim.clients.forEach((c, i) => (c.onDesync = (e) => seen.push({ ...e, who: `c${i}` })));
    // client 2 diverges at tick 180: it reports a different hash from then on
    const orig = sim.clients[1].submitHash.bind(sim.clients[1]);
    sim.clients[1].submitHash = (tick, hash) => orig(tick, tick >= 180 ? hash ^ 1 : hash);
    sim.run(2500);
    expect(seen).toEqual([]);
    sim.run(1500);
    const first = seen.filter((e) => e.tick === 180);
    expect(first.map((e) => e.who).sort()).toEqual(['c0', 'c1', 'host']);
    for (const e of first) expect(e.slot).toBe(2);
    expect(seen.every((e) => e.slot === 2 && e.tick >= 180)).toBe(true);
  });
});
