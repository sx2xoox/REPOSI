// Host-paced deterministic lockstep (pure logic over a Transport).
//
// Every peer runs the full simulation; only inputs travel.
//   HOST    each fixed step: `sealFrame(tick, localPayload)` merges whatever input
//           samples / commands the clients sent since the previous seal into
//           frame F(tick), broadcasts it and returns it for local simulation.
//           The host never waits for anyone (zero added latency).
//   CLIENT  each fixed step: `sendInput(payload)` (one sample per local step),
//           then `stepsDue()` → run that many sim steps with `nextFrame()`.
//           Frames are buffered behind an adaptive jitter buffer (1–4 frames,
//           from the measured spread of frame arrival times): on schedule it
//           runs 1 step, 2 when it fell well behind (catch-up), 0 when the next
//           frame is missing (stall) or it is ahead of schedule.
//
// Ticks start at 0 and every peer simulates exactly the sealed frames, in order.
// Commands (reliable JSON, e.g. {type:'bless', pick:1}) ride in the next sealed
// frame for their player, so they apply on the same tick everywhere. A player
// who leaves / times out becomes a `left` marker in a sealed frame, so every
// sim drops them at the same tick. Every `hashInterval` ticks peers report a
// state hash; the host compares and broadcasts desyncs.
//
// Integration sketch (the game loop, once per fixed step):
//   host:   const f = host.sealFrame(tick, encodeMyInput()); sim(f); if (shouldHash(f.tick)) host.submitHash(f.tick, hash());
//   client: client.sendInput(encodeMyInput());
//           for (let n = client.stepsDue(); n > 0; n--) { const f = client.nextFrame(); sim(f); if (shouldHash(f.tick)) client.submitHash(f.tick, hash()); }
// plus `poll()` from a ~10 Hz timer on both (keepalive pings, timeouts) — NetSession does that.

import type { Transport } from './transport';
import {
  checkCommand, decodeMessage, edgeMergeCodec, encodeCommand, encodeDesync, encodeEnd, encodeFrame, encodeHash, encodeInput,
  encodeLeave, encodePing, decodeFrame, emptyFrame, MAX_SLOTS, type Frame, type InputCodec, type NetCommand,
} from './wire';

export type { Frame, FrameCommand, InputCodec, NetCommand } from './wire';
export { edgeMergeCodec } from './wire';

export const STEP_MS = 1000 / 60;
export const HASH_INTERVAL = 60;

export interface LockstepOptions {
  /** clock in ms (default performance.now) */
  now?: () => number;
  /** fixed step length in ms (default 1000/60) */
  stepMs?: number;
  /** input merge rule (default edgeMergeCodec(4): 4 EDGE bytes, then HELD bytes) */
  codec?: InputCodec;
  /** state hashes are exchanged every N ticks (default 60) */
  hashInterval?: number;
  /** a peer silent this long is gone (host: drops the client; client: host lost). default 5000 */
  timeoutMs?: number;
  /** client: `waitingForHost` after this long without frames. default 500 */
  waitingMs?: number;
  /** host: a client with no input sample this long gets the neutral payload. default 600 */
  staleInputMs?: number;
  /** keepalive / RTT ping period. default 1000 */
  pingIntervalMs?: number;
  /** client jitter buffer bounds in frames (default 1..4) */
  minBuffer?: number;
  maxBuffer?: number;
  /** client: initial buffer target before jitter has been measured (StartInfo.inputDelayHint) */
  initialBuffer?: number;
}

/** Should peers exchange a state hash after simulating `tick`? */
export function shouldHash(tick: number, interval = HASH_INTERVAL): boolean {
  return tick % interval === 0;
}

export interface LockstepPlayer {
  slot: number;
  /** transport peer id (the host's own entry uses transport.localId) */
  peer: string;
}

export interface DesyncEvent {
  tick: number;
  slot: number;
  hostHash: number;
  peerHash: number;
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

interface Resolved {
  now: () => number;
  stepMs: number;
  codec: InputCodec;
  hashInterval: number;
  timeoutMs: number;
  waitingMs: number;
  staleInputMs: number;
  pingIntervalMs: number;
  minBuffer: number;
  maxBuffer: number;
  initialBuffer: number;
}

function resolve(o: LockstepOptions): Resolved {
  const minBuffer = Math.max(1, Math.floor(o.minBuffer ?? 1));
  const maxBuffer = Math.max(minBuffer, Math.floor(o.maxBuffer ?? 4));
  return {
    now: o.now ?? defaultNow,
    stepMs: o.stepMs ?? STEP_MS,
    codec: o.codec ?? edgeMergeCodec(4),
    hashInterval: o.hashInterval ?? HASH_INTERVAL,
    timeoutMs: o.timeoutMs ?? 5000,
    waitingMs: o.waitingMs ?? 500,
    staleInputMs: o.staleInputMs ?? 600,
    pingIntervalMs: o.pingIntervalMs ?? 1000,
    minBuffer,
    maxBuffer,
    initialBuffer: Math.min(maxBuffer, Math.max(minBuffer, Math.round(o.initialBuffer ?? 2))),
  };
}

const HASH_KEEP = 64;

// ================================================================ host
interface Remote {
  slot: number;
  peer: string;
  /** samples merged since the last seal */
  acc: Uint8Array | null;
  /** payload sealed last (for repeats) */
  last: Uint8Array;
  lastSampleAt: number;
  lastRecvAt: number;
  cmds: NetCommand[];
  /** highest frame tick the client reported having (+1) */
  ack: number;
  rtt: number;
}

export class LockstepHost {
  readonly localSlot: number;
  private o: Resolved;
  private t: Transport;
  private remotes = new Map<number, Remote>();
  private byPeer = new Map<string, number>();
  private active: number[] = [];
  private leaving = new Map<number, string>();
  private localCmds: NetCommand[] = [];
  private lastTick = -1;
  private ownHashes = new Map<number, number>();
  private peerHashes = new Map<number, Map<number, number>>();
  private pingId = 1;
  private pings = new Map<number, { slot: number; at: number }>();
  private lastPingAt = -Infinity;
  private unlisten: () => void;
  private closed = false;
  /** a client's hash differed from the host's */
  onDesync: ((e: DesyncEvent) => void) | null = null;
  /** a player's `left` marker was sealed (reason: 'left' | 'timeout' | transport reason) */
  onPlayerLeft: ((slot: number, reason: string) => void) | null = null;

  constructor(transport: Transport, players: LockstepPlayer[], localSlot: number, opts: LockstepOptions = {}) {
    this.o = resolve(opts);
    this.t = transport;
    this.localSlot = localSlot;
    const now = this.o.now();
    for (const p of [...players].sort((a, b) => a.slot - b.slot)) {
      if (p.slot < 0 || p.slot >= MAX_SLOTS || this.active.includes(p.slot)) continue;
      this.active.push(p.slot);
      if (p.slot === localSlot) continue;
      this.remotes.set(p.slot, { slot: p.slot, peer: p.peer, acc: null, last: this.o.codec.neutral, lastSampleAt: -Infinity, lastRecvAt: now, cmds: [], ack: 0, rtt: 0 });
      this.byPeer.set(p.peer, p.slot);
    }
    this.unlisten = transport.listen({
      message: (from, data) => {
        if (data instanceof ArrayBuffer) this.onMessage(from, data);
      },
      peerLeave: (peer, reason) => {
        const slot = this.byPeer.get(peer);
        if (slot !== undefined) this.markLeaving(slot, reason || 'left');
      },
    });
  }

  /** Slots in the game (as of the last sealed frame, plus pending leaves). */
  get slots(): number[] {
    return [...this.active];
  }

  /** Last sealed tick (-1 before the first). */
  get tick(): number {
    return this.lastTick;
  }

  /** Round-trip time to a client in ms (0 for the host itself / unknown). */
  rtt(slot: number): number {
    return this.remotes.get(slot)?.rtt ?? 0;
  }

  /** How many ticks a client is behind the host (by its acks). */
  clientLag(slot: number): number {
    const r = this.remotes.get(slot);
    return r ? Math.max(0, this.lastTick + 1 - r.ack) : 0;
  }

  /** Queue a host-side command; it rides in the next sealed frame. */
  sendCommand(cmd: NetCommand): void {
    checkCommand(cmd);
    this.localCmds.push(cmd);
  }

  private markLeaving(slot: number, reason: string): void {
    if (!this.active.includes(slot) || slot === this.localSlot || this.leaving.has(slot)) return;
    this.leaving.set(slot, reason);
  }

  /** Drop a player at the next sealed frame (e.g. kicked by the host). */
  removePlayer(slot: number, reason = 'kicked'): void {
    this.markLeaving(slot, reason);
  }

  private checkTimeouts(now: number): void {
    for (const r of this.remotes.values()) {
      if (this.active.includes(r.slot) && now - r.lastRecvAt > this.o.timeoutMs) this.markLeaving(r.slot, 'timeout');
    }
  }

  /**
   * Seal tick `tick` (must be the previous tick + 1, starting at 0) with the
   * host's own input; broadcast it and return it for local simulation.
   */
  sealFrame(tick: number, localPayload: Uint8Array, localCommands: NetCommand[] = []): Frame {
    if (tick !== this.lastTick + 1) throw new Error(`sealFrame: expected tick ${this.lastTick + 1}, got ${tick}`);
    for (const c of localCommands) checkCommand(c);
    const now = this.o.now();
    this.checkTimeouts(now);
    const f = emptyFrame(tick);
    const leftNow: [number, string][] = [];
    for (const slot of this.active) {
      const why = this.leaving.get(slot);
      if (why !== undefined) {
        f.left.push(slot);
        leftNow.push([slot, why]);
        continue;
      }
      if (slot === this.localSlot) {
        f.inputs[slot] = localPayload.slice();
        for (const cmd of this.localCmds) f.commands.push({ slot, cmd });
        for (const cmd of localCommands) f.commands.push({ slot, cmd });
        this.localCmds = [];
        continue;
      }
      const r = this.remotes.get(slot)!;
      let payload: Uint8Array;
      if (r.acc) payload = r.acc;
      else if (now - r.lastSampleAt > this.o.staleInputMs) payload = this.o.codec.neutral;
      else payload = this.o.codec.repeat(r.last);
      r.acc = null;
      r.last = payload;
      f.inputs[slot] = payload;
      for (const cmd of r.cmds) f.commands.push({ slot, cmd });
      r.cmds = [];
    }
    for (const [slot] of leftNow) {
      this.active = this.active.filter((s) => s !== slot);
      this.leaving.delete(slot);
    }
    this.lastTick = tick;
    const buf = encodeFrame(f);
    if (!this.closed) {
      for (const slot of this.active) {
        const r = this.remotes.get(slot);
        if (r) this.t.send(r.peer, buf);
      }
    }
    for (const [slot, why] of leftNow) {
      const r = this.remotes.get(slot);
      if (r) {
        this.t.send(r.peer, encodeEnd('kicked'));
        this.t.kick(r.peer);
        this.byPeer.delete(r.peer);
        this.remotes.delete(slot);
      }
      this.onPlayerLeft?.(slot, why);
    }
    // every peer simulates the decoded bytes, so the host does too
    return decodeFrame(buf);
  }

  /** Report the host's own state hash after simulating `tick`. */
  submitHash(tick: number, hash: number): void {
    hash >>>= 0;
    this.ownHashes.set(tick, hash);
    const peers = this.peerHashes.get(tick);
    if (peers) {
      for (const [slot, h] of peers) this.compare(tick, slot, hash, h);
      this.peerHashes.delete(tick);
    }
    this.prune();
  }

  private prune(): void {
    const minTick = this.lastTick - HASH_KEEP * this.o.hashInterval;
    for (const k of this.ownHashes.keys()) if (k < minTick) this.ownHashes.delete(k);
    for (const k of this.peerHashes.keys()) if (k < minTick) this.peerHashes.delete(k);
  }

  private compare(tick: number, slot: number, hostHash: number, peerHash: number): void {
    if (hostHash === peerHash) return;
    const e: DesyncEvent = { tick, slot, hostHash, peerHash };
    this.t.broadcast(encodeDesync(tick, slot, hostHash, peerHash));
    this.onDesync?.(e);
  }

  /** Keepalive pings + timeouts; call from a timer (~10 Hz) and/or every step. */
  poll(): void {
    if (this.closed) return;
    const now = this.o.now();
    this.checkTimeouts(now);
    if (now - this.lastPingAt < this.o.pingIntervalMs) return;
    this.lastPingAt = now;
    for (const r of this.remotes.values()) {
      const id = this.pingId++ >>> 0;
      this.pings.set(id, { slot: r.slot, at: now });
      this.t.send(r.peer, encodePing(id));
    }
    for (const [id, p] of this.pings) if (now - p.at > this.o.timeoutMs) this.pings.delete(id);
  }

  private onMessage(from: string, buf: ArrayBuffer): void {
    if (this.closed) return;
    const slot = this.byPeer.get(from);
    if (slot === undefined) return;
    const r = this.remotes.get(slot);
    if (!r) return;
    const now = this.o.now();
    r.lastRecvAt = now;
    const m = decodeMessage(buf);
    if (!m || this.leaving.has(slot)) return;
    switch (m.type) {
      case 'input':
        r.acc = r.acc ? this.o.codec.merge(r.acc, m.payload) : m.payload;
        r.lastSampleAt = now;
        r.ack = Math.max(r.ack, m.ack);
        return;
      case 'cmd':
        if (m.cmd && typeof m.cmd.type === 'string') r.cmds.push(m.cmd);
        return;
      case 'hash': {
        const own = this.ownHashes.get(m.tick);
        if (own !== undefined) this.compare(m.tick, slot, own, m.hash >>> 0);
        else {
          let map = this.peerHashes.get(m.tick);
          if (!map) this.peerHashes.set(m.tick, (map = new Map()));
          map.set(slot, m.hash >>> 0);
        }
        return;
      }
      case 'leave':
        this.markLeaving(slot, 'left');
        return;
      case 'ping':
        this.t.send(from, encodePing(m.id, true));
        return;
      case 'pong': {
        const p = this.pings.get(m.id);
        if (p) {
          this.pings.delete(m.id);
          const sample = now - p.at;
          r.rtt = r.rtt ? r.rtt * 0.7 + sample * 0.3 : sample;
        }
        return;
      }
      default:
        return;
    }
  }

  /** Stop: tell clients the session ended (the transport is closed by the owner). */
  close(): void {
    if (this.closed) return;
    this.t.broadcast(encodeEnd('closed'));
    this.closed = true;
    this.unlisten();
  }
}

// ================================================================ client
export interface ClientStats {
  /** frames received */
  frames: number;
  /** contiguous frames buffered right now */
  depth: number;
  /** current jitter buffer target in frames */
  target: number;
  /** spread of frame arrival times over the window (ms) */
  jitterMs: number;
  /** times the buffer ran dry while playing */
  underruns: number;
  /** double steps taken to catch up */
  catchUps: number;
  /** steps skipped because playback ran ahead of schedule */
  stretches: number;
  /** RTT to the host (ms) */
  rtt: number;
}

const WINDOW = 120;
/** an arrival gap this long (host paused / route change) re-anchors the schedule */
const REANCHOR_GAP_MS = 250;

export type ClientEndReason = 'closed' | 'kicked' | 'host-lost';

export class LockstepClient {
  readonly localSlot: number;
  private o: Resolved;
  private t: Transport;
  private frames = new Map<number, Frame>();
  private next = 0;
  private seq = 0;
  private cmdSeq = 0;
  private highest = -1;
  private transits: number[] = [];
  private anchor: number | null = null;
  private target: number;
  private spread = 0;
  private stalled = true;
  private started = false;
  private lastFrameAt: number;
  private lastRecvAt: number;
  private pingId = 1;
  private pings = new Map<number, number>();
  private lastPingAt = -Infinity;
  private rttMs = 0;
  private unlisten: () => void;
  private ended: ClientEndReason | null = null;
  readonly stats: ClientStats;
  onDesync: ((e: DesyncEvent) => void) | null = null;
  /** the session ended for this client (host closed it, dropped us, or vanished) */
  onEnd: ((reason: ClientEndReason) => void) | null = null;

  constructor(transport: Transport, localSlot: number, opts: LockstepOptions = {}) {
    this.o = resolve(opts);
    this.t = transport;
    this.localSlot = localSlot;
    this.target = this.o.initialBuffer;
    const now = this.o.now();
    this.lastFrameAt = now;
    this.lastRecvAt = now;
    this.stats = { frames: 0, depth: 0, target: this.target, jitterMs: 0, underruns: 0, catchUps: 0, stretches: 0, rtt: 0 };
    this.unlisten = transport.listen({
      message: (from, data) => {
        if (from === transport.hostId && data instanceof ArrayBuffer) this.onMessage(data);
      },
      peerLeave: (peer) => {
        if (peer === transport.hostId) this.end('host-lost');
      },
      close: (reason) => this.end(reason === 'kicked' ? 'kicked' : reason === 'closed' ? 'closed' : 'host-lost'),
    });
  }

  /** Why the session ended, or null while it runs. */
  get endReason(): ClientEndReason | null {
    return this.ended;
  }

  /** The next tick this client will simulate. */
  get tick(): number {
    return this.next;
  }

  /** No frame from the host for `waitingMs` (show "방장을 기다리는 중…"). */
  get waitingForHost(): boolean {
    return !this.ended && this.o.now() - this.lastFrameAt > this.o.waitingMs;
  }

  get rtt(): number {
    return this.rttMs;
  }

  /** Contiguous frames available from the next tick on. */
  depth(): number {
    let n = 0;
    while (this.frames.has(this.next + n)) n++;
    return n;
  }

  /** Send this step's local input sample (≤ 32 bytes, see InputCodec). */
  sendInput(payload: Uint8Array): void {
    if (this.ended) return;
    this.seq = (this.seq + 1) >>> 0;
    this.t.send(this.t.hostId, encodeInput(this.seq, this.highest + 1, payload));
  }

  /** Send a reliable command; it lands in the next frame the host seals for us. */
  sendCommand(cmd: NetCommand): void {
    if (this.ended) return;
    checkCommand(cmd);
    this.cmdSeq = (this.cmdSeq + 1) >>> 0;
    this.t.send(this.t.hostId, encodeCommand(this.cmdSeq, cmd));
  }

  /** Report this client's state hash after simulating `tick` (see shouldHash). */
  submitHash(tick: number, hash: number): void {
    if (this.ended) return;
    this.t.send(this.t.hostId, encodeHash(tick, hash >>> 0));
  }

  /**
   * Sim steps to run now (0, 1 or 2). Call once per local fixed step, then call
   * `nextFrame()` that many times.
   */
  stepsDue(): number {
    if (this.ended) return 0;
    const d = this.depth();
    this.stats.depth = d;
    if (this.anchor === null) return 0;
    const lag = (this.o.now() - this.anchor) / this.o.stepMs - this.target - this.next;
    if (d === 0) {
      if (!this.stalled && lag >= -0.5) {
        this.stalled = true;
        this.stats.underruns++;
      }
      return 0;
    }
    if (this.stalled) {
      // (re)start once the schedule says the next frame is due: the buffer refilled
      if (lag < 0) return 0;
      this.stalled = false;
      this.started = true;
    }
    if (lag < -0.5) {
      // ahead of schedule (the buffer target grew): let the buffer fill
      this.stats.stretches++;
      return 0;
    }
    if (lag > 2 && d >= 2) {
      this.stats.catchUps++;
      return 2;
    }
    return 1;
  }

  /** Is the next frame available right now (ignoring the jitter schedule)? */
  canStep(): boolean {
    return !this.ended && this.frames.has(this.next);
  }

  /** Take the next frame (throws when it is not available: check canStep / stepsDue). */
  nextFrame(): Frame {
    const f = this.frames.get(this.next);
    if (!f) throw new Error(`nextFrame: frame ${this.next} not received yet`);
    this.frames.delete(this.next);
    this.next++;
    this.started = true;
    if (f.left.includes(this.localSlot)) this.end('kicked');
    return f;
  }

  /** Keepalive pings + host timeout; call from a timer (~10 Hz) and/or every step. */
  poll(): void {
    if (this.ended) return;
    const now = this.o.now();
    if (now - this.lastRecvAt > this.o.timeoutMs) {
      this.end('host-lost');
      return;
    }
    if (now - this.lastPingAt >= this.o.pingIntervalMs) {
      this.lastPingAt = now;
      const id = this.pingId++ >>> 0;
      this.pings.set(id, now);
      this.t.send(this.t.hostId, encodePing(id));
      for (const [k, at] of this.pings) if (now - at > this.o.timeoutMs) this.pings.delete(k);
    }
  }

  /** Leave the session (the host seals a `left` marker for this slot). */
  leave(): void {
    if (this.ended) return;
    this.t.send(this.t.hostId, encodeLeave());
    this.end('closed', false);
  }

  private end(reason: ClientEndReason, notify = true): void {
    if (this.ended) return;
    this.ended = reason;
    this.unlisten();
    if (notify) this.onEnd?.(reason);
  }

  private onMessage(buf: ArrayBuffer): void {
    if (this.ended) return;
    const now = this.o.now();
    this.lastRecvAt = now;
    const m = decodeMessage(buf);
    if (!m) return;
    switch (m.type) {
      case 'frame':
        this.onFrame(m.frame, now);
        return;
      case 'ping':
        this.t.send(this.t.hostId, encodePing(m.id, true));
        return;
      case 'pong': {
        const at = this.pings.get(m.id);
        if (at !== undefined) {
          this.pings.delete(m.id);
          const s = now - at;
          this.rttMs = this.rttMs ? this.rttMs * 0.7 + s * 0.3 : s;
          this.stats.rtt = this.rttMs;
        }
        return;
      }
      case 'desync':
        this.onDesync?.({ tick: m.tick, slot: m.slot, hostHash: m.hostHash, peerHash: m.peerHash });
        return;
      case 'end':
        this.end(m.reason);
        return;
      default:
        return;
    }
  }

  private onFrame(f: Frame, now: number): void {
    if (f.tick < this.next || this.frames.has(f.tick)) return;
    this.frames.set(f.tick, f);
    this.stats.frames++;
    while (this.frames.has(this.highest + 1)) this.highest++;
    const gap = now - this.lastFrameAt;
    this.lastFrameAt = now;
    // jitter: relative transit (arrival - nominal send time) over a sliding window
    const transit = now - f.tick * this.o.stepMs;
    if (this.anchor !== null && this.stalled && this.started && gap > REANCHOR_GAP_MS) this.transits = [];
    this.transits.push(transit);
    if (this.transits.length > WINDOW) this.transits.shift();
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of this.transits) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    this.anchor = lo;
    this.spread = hi - lo;
    // enough buffer to absorb the spread even when playing half a frame early
    const measured = Math.ceil((this.spread + this.o.stepMs / 2) / this.o.stepMs);
    // trust the lobby's hint until a second of frames has been measured
    const want = this.transits.length < 60 ? Math.max(measured, this.o.initialBuffer) : measured;
    this.target = Math.min(this.o.maxBuffer, Math.max(this.o.minBuffer, want));
    this.stats.target = this.target;
    this.stats.jitterMs = this.spread;
  }
}
