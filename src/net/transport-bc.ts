// Same-origin tabs over BroadcastChannel (`?net=bc`): the dev / e2e transport.
// One channel per room; every packet carries {from, to} and endpoints ignore
// packets addressed to someone else. Handshake:
//   host:   'probe' → any 'here' reply within PROBE_MS means the code is taken
//   client: 'knock' → host answers 'accept' (else not-found after KNOCK_MS)
//   either: 'bye' on close / page hide; 'ka' keepalives detect crashed tabs.

import { BaseTransport, NetError, type NetData, type TransportFactory } from './transport';

const PROBE_MS = 250;
const KNOCK_MS = 1500;
const KEEPALIVE_MS = 1000;
const DEAD_MS = 6000;

type Packet =
  | { k: 'probe'; from: string }
  | { k: 'here'; from: string; to: string }
  | { k: 'knock'; from: string }
  | { k: 'accept'; from: string; to: string }
  | { k: 'msg'; from: string; to: string; d: NetData }
  | { k: 'ka'; from: string; to: string }
  | { k: 'bye'; from: string; to?: string; reason?: string };

function channelName(code: string): string {
  return `lanternkeeper-net-${code}`;
}

function newId(): string {
  return `bc-${Math.random().toString(36).slice(2, 10)}`;
}

export class BroadcastChannelTransport extends BaseTransport {
  readonly kind = 'bc' as const;
  private ch: BroadcastChannel;
  private connected = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private onHide = () => this.close('closed');

  /** @internal use BroadcastChannelFactory */
  constructor(role: 'host' | 'client', code: string, localId: string, hostId: string, ch: BroadcastChannel) {
    super(role, code, localId, hostId);
    this.ch = ch;
    ch.onmessage = (e) => this.onPacket(e.data as Packet);
    this.timer = setInterval(() => this.keepalive(), KEEPALIVE_MS);
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.onHide);
  }

  /** @internal client: mark the host connected after 'accept' */
  _accepted(): void {
    this.connected.set(this.hostId, Date.now());
  }

  peers(): string[] {
    return [...this.connected.keys()];
  }

  private post(p: Packet): void {
    try {
      this.ch.postMessage(p);
    } catch (e) {
      console.error('[net] BroadcastChannel post failed', e);
    }
  }

  send(to: string, data: NetData): void {
    if (this.closed || !this.connected.has(to)) return;
    this.post({ k: 'msg', from: this.localId, to, d: data });
  }

  kick(peer: string): void {
    if (!this.connected.has(peer)) return;
    this.connected.delete(peer);
    this.post({ k: 'bye', from: this.localId, to: peer, reason: 'kicked' });
  }

  close(reason = 'closed'): void {
    if (this.closed) return;
    this.post({ k: 'bye', from: this.localId, reason });
    this.shutdown(reason);
  }

  private shutdown(reason: string): void {
    this.closed = true;
    this.connected.clear();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onHide);
    try {
      this.ch.close();
    } catch {
      // already closed
    }
    this.emitClose(reason);
  }

  private keepalive(): void {
    const now = Date.now();
    for (const [p, last] of [...this.connected]) {
      if (now - last > DEAD_MS) {
        this.connected.delete(p);
        this.emitLeave(p, 'timeout');
        if (this.role === 'client') {
          this.shutdown('host-lost');
          return;
        }
        continue;
      }
      this.post({ k: 'ka', from: this.localId, to: p });
    }
  }

  private onPacket(p: Packet): void {
    if (this.closed || !p || p.from === this.localId) return;
    if ('to' in p && p.to !== undefined && p.to !== this.localId) return;
    if (this.connected.has(p.from)) this.connected.set(p.from, Date.now());
    switch (p.k) {
      case 'probe':
        if (this.role === 'host') this.post({ k: 'here', from: this.localId, to: p.from });
        return;
      case 'knock':
        if (this.role !== 'host') return;
        if (!this.connected.has(p.from)) {
          this.connected.set(p.from, Date.now());
          this.post({ k: 'accept', from: this.localId, to: p.from });
          this.emitJoin(p.from);
        }
        return;
      case 'msg':
        if (this.connected.has(p.from)) this.emitMessage(p.from, p.d);
        return;
      case 'bye':
        if (!this.connected.has(p.from)) return;
        this.connected.delete(p.from);
        this.emitLeave(p.from, p.reason ?? 'closed');
        if (this.role === 'client' && p.from === this.hostId) this.shutdown(p.reason === 'kicked' ? 'kicked' : 'closed');
        return;
      default:
        return;
    }
  }
}

export class BroadcastChannelFactory implements TransportFactory {
  readonly kind = 'bc' as const;

  private open(code: string): BroadcastChannel {
    if (typeof BroadcastChannel === 'undefined') throw new NetError('unsupported');
    return new BroadcastChannel(channelName(code));
  }

  host(code: string): Promise<BroadcastChannelTransport> {
    return new Promise((resolve, reject) => {
      let ch: BroadcastChannel;
      try {
        ch = this.open(code);
      } catch (e) {
        reject(e);
        return;
      }
      const id = newId();
      let taken = false;
      ch.onmessage = (e) => {
        const p = e.data as Packet;
        if (p?.k === 'here' && p.to === id) taken = true;
      };
      ch.postMessage({ k: 'probe', from: id } satisfies Packet);
      setTimeout(() => {
        if (taken) {
          ch.close();
          reject(new NetError('id-taken'));
          return;
        }
        resolve(new BroadcastChannelTransport('host', code, id, id, ch));
      }, PROBE_MS);
    });
  }

  join(code: string): Promise<BroadcastChannelTransport> {
    return new Promise((resolve, reject) => {
      let ch: BroadcastChannel;
      try {
        ch = this.open(code);
      } catch (e) {
        reject(e);
        return;
      }
      const id = newId();
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        ch.close();
        reject(new NetError('not-found'));
      }, KNOCK_MS);
      ch.onmessage = (e) => {
        const p = e.data as Packet;
        if (done || p?.k !== 'accept' || p.to !== id) return;
        done = true;
        clearTimeout(timer);
        const t = new BroadcastChannelTransport('client', code, id, p.from, ch);
        t._accepted();
        resolve(t);
      };
      ch.postMessage({ k: 'knock', from: id } satisfies Packet);
    });
  }
}
