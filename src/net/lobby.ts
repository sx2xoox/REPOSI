// Lobby protocol (pure logic over a Transport, JSON messages):
//
//   client → host  hello {name, build, unlocked[], ch, proto}   pick {ch}   ready {on}   leave
//   host → client  welcome {slot}   reject {reason}   roster {players[]}   start {seed, roster, build, inputDelayHint}   closed
//   both           ping {id} / pong {id}  (RTT; also keepalive)
//
// The host is slot 0 and always ready; clients get the lowest free slot 1..3.
// Joining a full room, a started room or with a different build is rejected
// with a reason. Picks are validated against the characters the player says
// they unlocked (duplicates allowed). The host may start once every client is
// ready (alone too). After 'start' the transport belongs to the lockstep
// session; the host's lobby keeps answering late hellos with 'started'.

import type { NetErrorCode, NetJson, Transport } from './transport';
import { isJson } from './transport';

export const LOBBY_PROTO = 1;
export const MAX_PLAYERS = 4;

export interface LobbyPlayer {
  slot: number;
  /** transport peer id */
  peer: string;
  name: string;
  characterId: string;
  ready: boolean;
  /** round-trip time to the host in ms (0 for the host / not measured yet, -1 = not responding) */
  ping: number;
  host: boolean;
}

/** What every peer gets when the host starts: enough to build the same run. */
export interface StartInfo {
  seed: string;
  roster: LobbyPlayer[];
  buildId: string;
  /** suggested initial client jitter buffer in frames (1..4), from lobby RTT jitter */
  inputDelayHint: number;
  /** the host's simulation options for this run (game/seam SimRules; absent = defaults) */
  rules?: { hitStop?: boolean };
}

export type LobbyState = 'joining' | 'open' | 'started' | 'closed';

export interface LobbyOptions {
  name: string;
  buildId: string;
  /** character ids this player may pick */
  unlocked: string[];
  /** initial pick */
  characterId: string;
  now?: () => number;
  maxPlayers?: number;
  pingIntervalMs?: number;
  /** host: a connection that does not say hello in time is dropped */
  helloTimeoutMs?: number;
  /**
   * a peer silent this long is gone (generous: on phones the page freezes while
   * the player switches to a messenger to share the code)
   */
  silenceTimeoutMs?: number;
  /** client: no welcome / reject within this time → 'timeout' */
  joinTimeoutMs?: number;
  /** delay before closing the transport after a goodbye message (lets it flush) */
  closeDelayMs?: number;
  stepMs?: number;
}

interface HostPeer {
  slot: number;
  /** last pick / ready message seq processed */
  seq: number;
  name: string;
  unlocked: string[];
  ch: string;
  ready: boolean;
  rtts: number[];
  ping: number;
  lastRecv: number;
}

function str(v: unknown, max = 64): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function cleanName(v: unknown): string {
  const s = str(v, 40).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return [...s].slice(0, 10).join('') || '등불지기';
}

export class Lobby {
  readonly role: 'host' | 'client';
  readonly transport: Transport;
  state: LobbyState;
  roster: LobbyPlayer[] = [];
  /** our slot (-1 until welcomed) */
  localSlot: number;
  closeReason: NetErrorCode | null = null;
  startInfo: StartInfo | null = null;
  onChange: (() => void) | null = null;
  onStart: ((info: StartInfo) => void) | null = null;
  onClosed: ((reason: NetErrorCode) => void) | null = null;

  private o: Required<Omit<LobbyOptions, 'now'>> & { now: () => number };
  private unlisten: () => void;
  // host
  private peers = new Map<string, HostPeer>();
  private pending = new Map<string, number>();
  private kicks = new Map<string, number>();
  // both
  private pingId = 1;
  private pings = new Map<number, { peer: string; at: number }>();
  private lastPing = -Infinity;
  private hostLastRecv = 0;
  private joinAt = 0;
  private rttMs = 0;
  // client: optimistic local pick / ready until the host has processed message `seq`
  private seq = 0;
  private ackedSeq = 0;
  private localReady = false;

  private constructor(role: 'host' | 'client', transport: Transport, o: LobbyOptions) {
    this.role = role;
    this.transport = transport;
    this.o = {
      name: cleanName(o.name),
      buildId: o.buildId,
      unlocked: [...o.unlocked],
      characterId: o.characterId,
      now: o.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now())),
      maxPlayers: Math.min(MAX_PLAYERS, o.maxPlayers ?? MAX_PLAYERS),
      pingIntervalMs: o.pingIntervalMs ?? 1000,
      helloTimeoutMs: o.helloTimeoutMs ?? 5000,
      silenceTimeoutMs: o.silenceTimeoutMs ?? 20000,
      joinTimeoutMs: o.joinTimeoutMs ?? 10000,
      closeDelayMs: o.closeDelayMs ?? 250,
      stepMs: o.stepMs ?? 1000 / 60,
    };
    if (!this.o.unlocked.includes(this.o.characterId) && this.o.unlocked.length) this.o.characterId = this.o.unlocked[0];
    this.state = role === 'host' ? 'open' : 'joining';
    this.localSlot = role === 'host' ? 0 : -1;
    const now = this.o.now();
    this.hostLastRecv = now;
    this.joinAt = now;
    this.unlisten = transport.listen({
      message: (from, data) => {
        if (isJson(data)) this.onMessage(from, data);
      },
      peerJoin: (peer) => {
        if (this.role === 'host') this.pending.set(peer, this.o.now());
      },
      peerLeave: (peer) => this.onPeerLeave(peer),
      close: (reason) => {
        if (this.state === 'started') return;
        this.close(reason === 'kicked' ? 'kicked' : reason === 'closed' ? 'closed' : 'host-lost', false);
      },
    });
  }

  /** Open a lobby as the host of an already registered room transport. */
  static host(transport: Transport, o: LobbyOptions): Lobby {
    const l = new Lobby('host', transport, o);
    l.rebuildRoster();
    return l;
  }

  /** Join through a connected client transport (sends hello; welcome / reject follow). */
  static join(transport: Transport, o: LobbyOptions): Lobby {
    const l = new Lobby('client', transport, o);
    l.send(transport.hostId, { t: 'hello', proto: LOBBY_PROTO, name: l.o.name, build: l.o.buildId, unlocked: l.o.unlocked, ch: l.o.characterId });
    return l;
  }

  get code(): string {
    return this.transport.code;
  }

  get me(): LobbyPlayer | undefined {
    return this.roster.find((p) => p.slot === this.localSlot);
  }

  get unlocked(): readonly string[] {
    return this.o.unlocked;
  }

  /** Client: RTT to the host in ms (host: 0). */
  rtt(): number {
    return this.rttMs;
  }

  private send(to: string, m: NetJson): void {
    this.transport.send(to, m);
  }

  private changed(): void {
    this.onChange?.();
  }

  /** Client: show our own pick / ready immediately (the host echoes them later). */
  private applyLocal(): void {
    const me = this.me;
    if (!me || this.role === 'host') return;
    me.characterId = this.o.characterId;
    me.ready = this.localReady;
  }

  // ------------------------------------------------------------ actions
  /** Pick a character (must be one this player unlocked); un-readies. */
  pick(characterId: string): void {
    if (this.state !== 'open' || !this.o.unlocked.includes(characterId)) return;
    this.o.characterId = characterId;
    if (this.role === 'host') {
      this.rebuildRoster();
      this.broadcastRoster();
    } else {
      this.localReady = false;
      this.applyLocal();
      this.send(this.transport.hostId, { t: 'pick', ch: characterId, seq: ++this.seq });
    }
    this.changed();
  }

  /** Client: toggle ready (the host is always ready). */
  setReady(on: boolean): void {
    if (this.state !== 'open' || this.role === 'host') return;
    this.localReady = on;
    this.applyLocal();
    this.send(this.transport.hostId, { t: 'ready', on, seq: ++this.seq });
    this.changed();
  }

  /** Host: may start (every client ready)? */
  canStart(): boolean {
    return this.role === 'host' && this.state === 'open' && this.roster.every((p) => p.host || p.ready);
  }

  /** Host: start the run with `seed` (and the host's sim `rules`); every peer receives the same StartInfo. */
  start(seed: string, rules?: StartInfo['rules']): StartInfo {
    if (!this.canStart()) throw new Error('lobby: cannot start yet');
    this.rebuildRoster();
    const info: StartInfo = {
      seed,
      roster: this.roster.map((p) => ({ ...p })),
      buildId: this.o.buildId,
      inputDelayHint: this.inputDelayHint(),
    };
    if (rules) info.rules = { ...rules };
    this.state = 'started';
    this.startInfo = info;
    for (const peer of this.peers.keys()) this.send(peer, { t: 'start', ...info });
    this.onStart?.(info);
    this.changed();
    return info;
  }

  /** Initial client jitter buffer (frames) from the RTT spread measured in the lobby. */
  inputDelayHint(): number {
    let worst = 0;
    let any = false;
    for (const p of this.peers.values()) {
      if (p.rtts.length < 2) continue;
      any = true;
      worst = Math.max(worst, Math.max(...p.rtts) - Math.min(...p.rtts));
    }
    if (!any) return this.peers.size ? 2 : 1;
    const oneWay = worst / 2;
    return Math.min(4, Math.max(1, Math.ceil((oneWay + this.o.stepMs / 2) / this.o.stepMs)));
  }

  /** Leave (client) or close the room (host). */
  leave(): void {
    if (this.state === 'closed') return;
    if (this.role === 'host') {
      for (const peer of this.peers.keys()) this.send(peer, { t: 'closed' });
    } else {
      this.send(this.transport.hostId, { t: 'leave' });
    }
    this.close('closed', false);
  }

  /** Stop listening (after start the session owns the transport). */
  dispose(): void {
    this.unlisten();
  }

  private close(reason: NetErrorCode, notify = true): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.closeReason = reason;
    this.unlisten();
    const t = this.transport;
    if (!t.closed) {
      if (this.o.closeDelayMs > 0) setTimeout(() => t.close('closed'), this.o.closeDelayMs);
      else t.close('closed');
    }
    if (notify) this.onClosed?.(reason);
    this.changed();
  }

  // ------------------------------------------------------------ periodic
  /** Pings, timeouts and deferred kicks; call every frame (or from a timer). */
  update(): void {
    if (this.state === 'closed') return;
    const now = this.o.now();
    if (this.role === 'host') {
      for (const [peer, at] of this.kicks) {
        if (now >= at) {
          this.kicks.delete(peer);
          this.transport.kick(peer);
        }
      }
      for (const [peer, at] of this.pending) {
        if (now - at > this.o.helloTimeoutMs) {
          this.pending.delete(peer);
          this.transport.kick(peer);
        }
      }
      if (this.state !== 'open') return;
      for (const [peer, p] of this.peers) {
        if (now - p.lastRecv > this.o.silenceTimeoutMs) {
          this.removePeer(peer);
          this.transport.kick(peer);
        }
      }
    } else {
      if (this.state === 'joining' && now - this.joinAt > this.o.joinTimeoutMs) {
        this.close('timeout');
        return;
      }
      if (this.state !== 'open') return;
      if (now - this.hostLastRecv > this.o.silenceTimeoutMs) {
        this.close('host-lost');
        return;
      }
    }
    if (now - this.lastPing >= this.o.pingIntervalMs) {
      this.lastPing = now;
      for (const [id, p] of this.pings) if (now - p.at > this.o.silenceTimeoutMs) this.pings.delete(id);
      const targets = this.role === 'host' ? [...this.peers.keys()] : [this.transport.hostId];
      for (const peer of targets) {
        const id = this.pingId++;
        this.pings.set(id, { peer, at: now });
        this.send(peer, { t: 'ping', id });
      }
      if (this.role === 'host' && this.peers.size) {
        this.rebuildRoster();
        this.broadcastRoster();
        this.changed();
      }
    }
  }

  // ------------------------------------------------------------ host side
  private freeSlot(): number {
    const used = new Set([0, ...[...this.peers.values()].map((p) => p.slot)]);
    for (let s = 1; s < this.o.maxPlayers; s++) if (!used.has(s)) return s;
    return -1;
  }

  private reject(peer: string, reason: NetErrorCode): void {
    this.send(peer, { t: 'reject', reason });
    this.pending.delete(peer);
    this.kicks.set(peer, this.o.now() + Math.max(this.o.closeDelayMs, 1));
  }

  private rebuildRoster(): void {
    const host: LobbyPlayer = {
      slot: 0, peer: this.transport.localId, name: this.o.name, characterId: this.o.characterId, ready: true, ping: 0, host: true,
    };
    const now = this.o.now();
    const rest = [...this.peers.entries()].map(([peer, p]): LobbyPlayer => ({
      slot: p.slot, peer, name: p.name, characterId: p.ch, ready: p.ready, ping: now - p.lastRecv > 3000 ? -1 : Math.round(p.ping), host: false,
    }));
    this.roster = [host, ...rest].sort((a, b) => a.slot - b.slot);
  }

  private broadcastRoster(): void {
    const acks: Record<string, number> = {};
    for (const p of this.peers.values()) acks[p.slot] = p.seq;
    const m: NetJson = { t: 'roster', players: this.roster, acks };
    for (const peer of this.peers.keys()) this.send(peer, m);
  }

  private removePeer(peer: string): void {
    if (!this.peers.delete(peer)) return;
    this.rebuildRoster();
    this.broadcastRoster();
    this.changed();
  }

  private onHostMessage(from: string, m: NetJson): void {
    const p = this.peers.get(from);
    if (p) p.lastRecv = this.o.now();
    if (m.t === 'hello') {
      if (p) return;
      if (this.state !== 'open') return this.reject(from, 'started');
      if (m.proto !== LOBBY_PROTO || m.build !== this.o.buildId) return this.reject(from, 'version');
      const slot = this.freeSlot();
      if (slot < 0) return this.reject(from, 'full');
      const unlocked = Array.isArray(m.unlocked) ? m.unlocked.filter((x): x is string => typeof x === 'string').slice(0, 64) : [];
      const want = str(m.ch);
      const ch = unlocked.includes(want) ? want : unlocked[0] ?? this.o.characterId;
      this.pending.delete(from);
      this.peers.set(from, { slot, seq: 0, name: cleanName(m.name), unlocked, ch, ready: false, rtts: [], ping: 0, lastRecv: this.o.now() });
      this.send(from, { t: 'welcome', slot });
      this.rebuildRoster();
      this.broadcastRoster();
      this.changed();
      return;
    }
    if (!p || this.state !== 'open') {
      if (p && m.t === 'ping') this.send(from, { t: 'pong', id: m.id });
      return;
    }
    switch (m.t) {
      case 'pick': {
        p.seq = Math.max(p.seq, Number(m.seq) || 0);
        const ch = str(m.ch);
        if (p.unlocked.includes(ch)) {
          p.ch = ch;
          p.ready = false;
        }
        break;
      }
      case 'ready':
        p.seq = Math.max(p.seq, Number(m.seq) || 0);
        p.ready = !!m.on;
        break;
      case 'leave':
        this.removePeer(from);
        this.kicks.set(from, this.o.now() + Math.max(this.o.closeDelayMs, 1));
        return;
      case 'ping':
        this.send(from, { t: 'pong', id: m.id });
        return;
      case 'pong': {
        const ping = this.pings.get(Number(m.id));
        if (!ping) return;
        this.pings.delete(Number(m.id));
        const s = this.o.now() - ping.at;
        p.rtts.push(s);
        if (p.rtts.length > 10) p.rtts.shift();
        p.ping = p.ping ? p.ping * 0.6 + s * 0.4 : s;
        return; // the roster (with pings) goes out with the next ping round
      }
      default:
        return;
    }
    this.rebuildRoster();
    this.broadcastRoster();
    this.changed();
  }

  // ------------------------------------------------------------ client side
  private onClientMessage(m: NetJson): void {
    this.hostLastRecv = this.o.now();
    switch (m.t) {
      case 'welcome':
        if (this.state !== 'joining') return;
        this.localSlot = Number(m.slot);
        this.state = 'open';
        this.changed();
        return;
      case 'reject':
        this.close((typeof m.reason === 'string' ? m.reason : 'error') as NetErrorCode);
        return;
      case 'roster': {
        if (this.state !== 'open' || !Array.isArray(m.players)) return;
        this.roster = (m.players as LobbyPlayer[]).map((p) => ({ ...p }));
        const acks = (m.acks ?? {}) as Record<string, number>;
        this.ackedSeq = Math.max(this.ackedSeq, Number(acks[this.localSlot]) || 0);
        const me = this.me;
        if (me && this.ackedSeq >= this.seq) {
          // the host has seen all our changes: its view is authoritative
          this.o.characterId = me.characterId;
          this.localReady = me.ready;
        }
        this.applyLocal();
        this.changed();
        return;
      }
      case 'start': {
        if (this.state !== 'open') return;
        const info: StartInfo = {
          seed: str(m.seed, 64),
          roster: Array.isArray(m.roster) ? (m.roster as LobbyPlayer[]) : [],
          buildId: str(m.buildId, 64),
          inputDelayHint: Number(m.inputDelayHint) || 2,
        };
        if (m.rules && typeof m.rules === 'object') {
          const r = m.rules as Record<string, unknown>;
          info.rules = typeof r.hitStop === 'boolean' ? { hitStop: r.hitStop } : {};
        }
        if (info.buildId !== this.o.buildId) {
          this.close('version');
          return;
        }
        this.state = 'started';
        this.startInfo = info;
        this.roster = info.roster.map((p) => ({ ...p }));
        this.unlisten();
        this.onStart?.(info);
        this.changed();
        return;
      }
      case 'closed':
        this.close('closed');
        return;
      case 'ping':
        this.send(this.transport.hostId, { t: 'pong', id: m.id });
        return;
      case 'pong': {
        const ping = this.pings.get(Number(m.id));
        if (!ping) return;
        this.pings.delete(Number(m.id));
        const s = this.o.now() - ping.at;
        this.rttMs = this.rttMs ? this.rttMs * 0.6 + s * 0.4 : s;
        return;
      }
      default:
        return;
    }
  }

  private onMessage(from: string, m: NetJson): void {
    if (this.state === 'closed') return;
    if (this.role === 'host') this.onHostMessage(from, m);
    else if (from === this.transport.hostId) this.onClientMessage(m);
  }

  private onPeerLeave(peer: string): void {
    if (this.role === 'host') {
      this.pending.delete(peer);
      if (this.state === 'open') this.removePeer(peer);
      return;
    }
    if (peer === this.transport.hostId && this.state !== 'started') this.close('host-lost');
  }
}
