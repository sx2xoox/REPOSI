// WebRTC transport over PeerJS (the default). The free PeerJS cloud server only
// brokers the handshake; game traffic flows directly between browsers.
//   host:   registers `lanternkeeper-<CODE>`; 'unavailable-id' → NetError('id-taken')
//   client: random id, connects to the host's id (star topology)
// Channels: PeerJS 1.5 maps `reliable` to the data channel's `ordered` flag only
// (it never sets maxRetransmits, so even reliable:false retransmits forever and
// just loses ordering). Everything therefore runs on one reliable + ordered
// channel with serialization 'raw': ArrayBuffers go out as-is (lockstep), JSON
// is stringified by us (lobby). No binarypack / msgpack overhead.
// The peerjs package is loaded lazily, only when online co-op is opened.

import type { DataConnection, Peer, PeerOptions } from 'peerjs';
import type { NetConfig } from './config';
import { roomPeerId } from './code';
import { BaseTransport, NetError, type NetData, type NetErrorCode, type TransportFactory } from './transport';

/** Signaling server must answer within this time. */
const OPEN_TIMEOUT_MS = 12000;
/** The direct (ICE) connection to the host must come up within this time. */
const CONNECT_TIMEOUT_MS = 15000;

type PeerCtor = typeof import('peerjs').Peer;
let peerLib: Promise<PeerCtor> | null = null;

/** Lazy-load PeerJS (a stale page after a deploy may fail to fetch the chunk). */
function loadPeer(): Promise<PeerCtor> {
  if (!peerLib) {
    peerLib = import('peerjs').then((m) => m.Peer).catch((e) => {
      peerLib = null;
      console.error('[net] could not load peerjs', e);
      throw new NetError('stale');
    });
  }
  return peerLib;
}

/** Preload the PeerJS chunk (the lobby calls this when it opens). */
export function preloadPeerJs(): void {
  void loadPeer().catch(() => undefined);
}

function errorType(err: unknown): string {
  return String((err as { type?: string })?.type ?? '');
}

/** Map a PeerJS error type to our error codes. */
export function mapPeerError(type: string): NetErrorCode {
  switch (type) {
    case 'unavailable-id':
      return 'id-taken';
    case 'peer-unavailable':
      return 'not-found';
    case 'browser-incompatible':
      return 'unsupported';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'ssl-unavailable':
    case 'invalid-key':
      return 'network';
    case 'webrtc':
      return 'timeout';
    default:
      return 'error';
  }
}

function webrtcSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined';
}

export class PeerJsTransport extends BaseTransport {
  readonly kind = 'peerjs' as const;
  private peer: Peer;
  private conns = new Map<string, DataConnection>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** @internal use PeerJsFactory */
  constructor(role: 'host' | 'client', code: string, peer: Peer, hostId: string) {
    super(role, code, peer.id, hostId);
    this.peer = peer;
    peer.on('disconnected', () => {
      // lost the signaling server: open data channels keep working; re-register
      // so the room stays joinable (host) — harmless for clients
      if (this.closed || this.reconnectTimer) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.closed && !this.peer.destroyed && this.peer.disconnected) {
          try {
            this.peer.reconnect();
          } catch {
            // retried on the next 'disconnected'
          }
        }
      }, 2000);
    });
    peer.on('error', (err) => {
      if (this.closed) return;
      const code = mapPeerError(errorType(err));
      // after setup, errors are reported but not fatal (the lockstep / lobby timeouts decide)
      this.emitError(new NetError(code, String((err as Error)?.message ?? err)));
    });
    if (role === 'host') {
      peer.on('connection', (conn) => this.adopt(conn));
    }
  }

  /** @internal register an open (client) or opening (host) data connection */
  adopt(conn: DataConnection): void {
    const ready = () => {
      if (this.closed) {
        conn.close();
        return;
      }
      this.conns.set(conn.peer, conn);
      if (this.role === 'host') this.emitJoin(conn.peer);
    };
    conn.on('data', (raw) => {
      if (this.closed) return;
      const data = decode(raw);
      if (data) this.emitMessage(conn.peer, data);
    });
    conn.on('close', () => this.dropConn(conn, 'closed'));
    conn.on('error', (e) => {
      console.warn('[net] data connection error', errorType(e), e);
      this.dropConn(conn, 'error');
    });
    if (conn.open) ready();
    else conn.on('open', ready);
  }

  private dropConn(conn: DataConnection, reason: string): void {
    if (this.conns.get(conn.peer) !== conn) return;
    this.conns.delete(conn.peer);
    if (this.closed) return;
    this.emitLeave(conn.peer, reason);
    if (this.role === 'client' && conn.peer === this.hostId) this.shutdown('host-lost');
  }

  peers(): string[] {
    return [...this.conns.keys()];
  }

  send(to: string, data: NetData): void {
    const c = this.conns.get(to);
    if (!c || this.closed) return;
    try {
      void c.send(data instanceof ArrayBuffer ? data : JSON.stringify(data));
    } catch (e) {
      console.warn('[net] send failed', e);
    }
  }

  kick(peer: string): void {
    const c = this.conns.get(peer);
    if (!c) return;
    this.conns.delete(peer);
    c.close();
  }

  close(reason = 'closed'): void {
    if (this.closed) return;
    this.shutdown(reason);
  }

  private shutdown(reason: string): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const c of this.conns.values()) {
      try {
        c.close();
      } catch {
        // ignore
      }
    }
    this.conns.clear();
    try {
      this.peer.destroy();
    } catch {
      // ignore
    }
    this.emitClose(reason);
  }
}

function decode(raw: unknown): NetData | null {
  if (raw instanceof ArrayBuffer) return raw;
  if (ArrayBuffer.isView(raw)) return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === 'object' && typeof v.t === 'string' ? v : null;
    } catch {
      return null;
    }
  }
  return null;
}

export class PeerJsFactory implements TransportFactory {
  readonly kind = 'peerjs' as const;
  private cfg: NetConfig;

  constructor(cfg: NetConfig) {
    this.cfg = cfg;
    preloadPeerJs();
  }

  private options(): PeerOptions {
    const p = this.cfg.peer;
    return {
      host: p.host,
      port: p.port,
      path: p.path,
      secure: p.secure,
      key: p.key,
      debug: this.cfg.debug,
      config: { iceServers: this.cfg.iceServers },
    };
  }

  async host(code: string): Promise<PeerJsTransport> {
    if (!webrtcSupported()) throw new NetError('unsupported');
    const PeerC = await loadPeer();
    return new Promise((resolve, reject) => {
      const peer = new PeerC(roomPeerId(code), this.options());
      let done = false;
      const fail = (c: NetErrorCode) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        peer.destroy();
        reject(new NetError(c));
      };
      const timer = setTimeout(() => fail('network'), OPEN_TIMEOUT_MS);
      // connections arriving before 'open' resolves are adopted by the transport
      const early: DataConnection[] = [];
      const onConn = (c: DataConnection) => early.push(c);
      peer.on('connection', onConn);
      peer.on('error', (err) => fail(mapPeerError(errorType(err))));
      peer.on('open', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        peer.off('connection', onConn);
        const t = new PeerJsTransport('host', code, peer, peer.id);
        for (const c of early) t.adopt(c);
        resolve(t);
      });
    });
  }

  async join(code: string): Promise<PeerJsTransport> {
    if (!webrtcSupported()) throw new NetError('unsupported');
    const PeerC = await loadPeer();
    const hostId = roomPeerId(code);
    return new Promise((resolve, reject) => {
      const peer = new PeerC(this.options());
      let done = false;
      let signaled = false;
      const fail = (c: NetErrorCode) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        peer.destroy();
        reject(new NetError(c));
      };
      // no answer from the signaling server → 'network'; signaled but no direct link → 'timeout'
      const timer = setTimeout(() => fail(signaled ? 'timeout' : 'network'), OPEN_TIMEOUT_MS + CONNECT_TIMEOUT_MS);
      peer.on('error', (err) => fail(mapPeerError(errorType(err))));
      peer.on('open', () => {
        if (done) return;
        signaled = true;
        clearTimeout(timer);
        const connTimer = setTimeout(() => fail('timeout'), CONNECT_TIMEOUT_MS);
        const conn = peer.connect(hostId, { reliable: true, serialization: 'raw' });
        const pc = conn.peerConnection as RTCPeerConnection | undefined;
        pc?.addEventListener('iceconnectionstatechange', () => {
          if (pc.iceConnectionState === 'failed') {
            clearTimeout(connTimer);
            fail('timeout');
          }
        });
        conn.on('error', () => {
          clearTimeout(connTimer);
          fail('timeout');
        });
        conn.on('open', () => {
          clearTimeout(connTimer);
          if (done) {
            conn.close();
            return;
          }
          done = true;
          const t = new PeerJsTransport('client', code, peer, hostId);
          t.adopt(conn);
          resolve(t);
        });
      });
    });
  }
}
