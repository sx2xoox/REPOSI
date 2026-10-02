// In-process transport for unit tests: a virtual network with a virtual clock.
// Every directed link has a one-way latency, uniform jitter and a loss rate.
// Channels are reliable + ordered like a WebRTC data channel, so a "dropped"
// packet is retransmitted after `rtoMs` and holds back everything behind it on
// that link (head-of-line blocking); jitter never reorders a link.
// `cut(peer)` silently blackholes a peer (pulled cable: no events, only
// timeouts notice); `disconnect(peer)` closes it cleanly (leave events).
// Time only moves with `advance(ms)`, which delivers due messages in order.

import { BaseTransport, NetError, type NetData, type Transport, type TransportFactory } from './transport';

export interface LinkOptions {
  /** one-way base latency in ms (default 30) */
  latencyMs?: number;
  /** extra uniform random delay 0..jitterMs (default 0) */
  jitterMs?: number;
  /** probability a packet is lost on the wire and retransmitted (default 0) */
  drop?: number;
  /** retransmission delay for a lost packet in ms (default 200) */
  rtoMs?: number;
}

export interface MemoryNetworkOptions extends LinkOptions {
  /** PRNG seed (deterministic tests) */
  seed?: number;
  /** initial virtual time in ms */
  startTime?: number;
}

type Ev =
  | { kind: 'msg'; at: number; seq: number; from: string; to: string; data: NetData }
  | { kind: 'join'; at: number; seq: number; from: string; to: string }
  | { kind: 'leave'; at: number; seq: number; from: string; to: string; reason: string };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cloneData(d: NetData): NetData {
  if (d instanceof ArrayBuffer) return d.slice(0);
  return JSON.parse(JSON.stringify(d));
}

export class MemoryNetwork {
  time: number;
  /** clock for the code under test */
  readonly now = (): number => this.time;
  readonly defaults: Required<LinkOptions>;
  readonly stats = { sent: 0, delivered: 0, retransmits: 0 };
  private rand: () => number;
  private queue: Ev[] = [];
  private seq = 0;
  private links = new Map<string, LinkOptions>();
  private lastAt = new Map<string, number>();
  private endpoints = new Map<string, MemoryTransport>();
  private rooms = new Map<string, string>();
  private cutPeers = new Set<string>();
  private nextId = 1;

  constructor(o: MemoryNetworkOptions = {}) {
    this.time = o.startTime ?? 0;
    this.rand = mulberry32(o.seed ?? 1);
    this.defaults = { latencyMs: o.latencyMs ?? 30, jitterMs: o.jitterMs ?? 0, drop: o.drop ?? 0, rtoMs: o.rtoMs ?? 200 };
  }

  /** Override the options of the directed link a → b (both directions with `both`). */
  setLink(a: string, b: string, o: LinkOptions, both = true): void {
    this.links.set(`${a}>${b}`, { ...this.links.get(`${a}>${b}`), ...o });
    if (both) this.links.set(`${b}>${a}`, { ...this.links.get(`${b}>${a}`), ...o });
  }

  /** Change the defaults for every link without an override. */
  setDefaults(o: LinkOptions): void {
    Object.assign(this.defaults, o);
  }

  private link(a: string, b: string): Required<LinkOptions> {
    return { ...this.defaults, ...this.links.get(`${a}>${b}`) } as Required<LinkOptions>;
  }

  /** Delivery time for the next packet on a → b (ordered, with jitter and retransmits). */
  private schedule(from: string, to: string): number {
    const l = this.link(from, to);
    let at = this.time + l.latencyMs + this.rand() * l.jitterMs;
    while (l.drop > 0 && this.rand() < l.drop) {
      at += l.rtoMs;
      this.stats.retransmits++;
    }
    const key = `${from}>${to}`;
    at = Math.max(at, this.lastAt.get(key) ?? -Infinity);
    this.lastAt.set(key, at);
    return at;
  }

  private push(ev: Ev): void {
    // keep sorted by (at, seq): binary search for the insertion point
    let lo = 0;
    let hi = this.queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const q = this.queue[mid];
      if (q.at < ev.at || (q.at === ev.at && q.seq < ev.seq)) lo = mid + 1;
      else hi = mid;
    }
    this.queue.splice(lo, 0, ev);
  }

  /** @internal */
  _send(from: string, to: string, data: NetData): void {
    if (this.cutPeers.has(from) || this.cutPeers.has(to)) return;
    this.stats.sent++;
    this.push({ kind: 'msg', at: this.schedule(from, to), seq: this.seq++, from, to, data: cloneData(data) });
  }

  /** @internal */
  _leave(from: string, to: string, reason: string): void {
    if (this.cutPeers.has(from) || this.cutPeers.has(to)) return;
    this.push({ kind: 'leave', at: this.schedule(from, to), seq: this.seq++, from, to, reason });
  }

  // ------------------------------------------------------------ endpoints
  /** Register room `code` (throws NetError('id-taken') when it exists). */
  hostSync(code: string): MemoryTransport {
    if (this.rooms.has(code)) throw new NetError('id-taken');
    const id = `host-${code}`;
    const t = new MemoryTransport(this, 'host', code, id, id);
    this.rooms.set(code, id);
    this.endpoints.set(id, t);
    return t;
  }

  /** Connect to room `code` (throws NetError('not-found')). */
  joinSync(code: string): MemoryTransport {
    const hostId = this.rooms.get(code);
    const host = hostId ? this.endpoints.get(hostId) : undefined;
    if (!hostId || !host || host.closed) throw new NetError('not-found');
    const id = `peer-${this.nextId++}`;
    const t = new MemoryTransport(this, 'client', code, id, hostId);
    this.endpoints.set(id, t);
    t._connected.add(hostId);
    host._connected.add(id);
    this.push({ kind: 'join', at: this.schedule(id, hostId), seq: this.seq++, from: id, to: hostId });
    return t;
  }

  /** TransportFactory view (promises settle immediately; time still only moves with advance). */
  factory(): TransportFactory {
    return {
      kind: 'memory',
      host: async (code: string): Promise<Transport> => this.hostSync(code),
      join: async (code: string): Promise<Transport> => this.joinSync(code),
    };
  }

  /** @internal */
  _closeRoom(code: string, id: string): void {
    if (this.rooms.get(code) === id) this.rooms.delete(code);
  }

  /** Blackhole a peer: nothing in or out, no events (like a pulled cable). */
  cut(peer: string, on = true): void {
    if (on) this.cutPeers.add(peer);
    else this.cutPeers.delete(peer);
    if (on) this.queue = this.queue.filter((e) => e.from !== peer && e.to !== peer);
  }

  /** Cleanly disconnect a peer: everyone connected to it gets a leave event. */
  disconnect(peer: string): void {
    this.endpoints.get(peer)?.close('disconnected');
  }

  endpoint(id: string): MemoryTransport | undefined {
    return this.endpoints.get(id);
  }

  /** Pending (undelivered) events. */
  get pending(): number {
    return this.queue.length;
  }

  /** Advance virtual time by `ms`, delivering every due event in order. */
  advance(ms: number): void {
    const end = this.time + ms;
    while (this.queue.length && this.queue[0].at <= end) {
      const ev = this.queue.shift()!;
      this.time = Math.max(this.time, ev.at);
      this.deliver(ev);
    }
    this.time = end;
  }

  private deliver(ev: Ev): void {
    const to = this.endpoints.get(ev.to);
    if (!to || to.closed || this.cutPeers.has(ev.to) || this.cutPeers.has(ev.from)) return;
    if (ev.kind === 'join') {
      to._join(ev.from);
      return;
    }
    if (ev.kind === 'leave') {
      to._peerGone(ev.from, ev.reason);
      return;
    }
    if (!to._connected.has(ev.from)) return;
    this.stats.delivered++;
    to._message(ev.from, ev.data);
  }
}

export class MemoryTransport extends BaseTransport {
  readonly kind = 'memory' as const;
  /** @internal peers this endpoint is connected to */
  _connected = new Set<string>();
  /** @internal host: clients whose join event has been delivered */
  private announced = new Set<string>();
  private net: MemoryNetwork;

  constructor(net: MemoryNetwork, role: 'host' | 'client', code: string, localId: string, hostId: string) {
    super(role, code, localId, hostId);
    this.net = net;
  }

  peers(): string[] {
    if (this.role === 'client') return this._connected.has(this.hostId) ? [this.hostId] : [];
    return [...this.announced].filter((p) => this._connected.has(p));
  }

  send(to: string, data: NetData): void {
    if (this.closed || !this._connected.has(to)) return;
    this.net._send(this.localId, to, data);
  }

  kick(peer: string): void {
    if (this.role !== 'host' || !this._connected.has(peer)) return;
    this._connected.delete(peer);
    this.announced.delete(peer);
    this.net._leave(this.localId, peer, 'kicked');
  }

  close(reason = 'closed'): void {
    if (this.closed) return;
    for (const p of this._connected) this.net._leave(this.localId, p, reason);
    this._connected.clear();
    this.announced.clear();
    this.closed = true;
    if (this.role === 'host') this.net._closeRoom(this.code, this.localId);
    this.emitClose(reason);
  }

  /** @internal */
  _join(peer: string): void {
    if (!this._connected.has(peer)) return;
    this.announced.add(peer);
    this.emitJoin(peer);
  }

  /** @internal */
  _message(from: string, data: NetData): void {
    if (this.role === 'host' && !this.announced.has(from)) return;
    this.emitMessage(from, data);
  }

  /** @internal */
  _peerGone(peer: string, reason: string): void {
    if (!this._connected.has(peer)) return;
    this._connected.delete(peer);
    this.announced.delete(peer);
    this.emitLeave(peer, reason);
    if (this.role === 'client' && peer === this.hostId) {
      this.closed = true;
      this.emitClose(reason === 'kicked' ? 'kicked' : 'host-lost');
    }
  }
}
