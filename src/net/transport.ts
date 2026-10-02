// Transport abstraction for online co-op: a star of reliable, ordered message
// channels between one host and up to three clients. Messages are either an
// ArrayBuffer (lockstep traffic) or a small JSON object with a `t` type field
// (lobby traffic). Implementations:
//   - PeerJsTransport           WebRTC data channels, PeerJS cloud signaling (transport-peerjs.ts)
//   - BroadcastChannelTransport same-origin tabs, dev / e2e (`?net=bc`, transport-bc.ts)
//   - MemoryTransport           in-process with simulated latency / jitter / loss (transport-memory.ts)
//
// Topology: the host registers the room id; clients connect only to the host.
// Peer ids are opaque strings; on a client `hostId` is the only peer.
// (The implementations import this module, so it does not import them statically.)

import type { NetConfig, TransportKind } from './config';
import { randomRoomCode } from './code';

/** A small JSON message (lobby protocol); `t` is its type. */
export interface NetJson {
  t: string;
  [k: string]: unknown;
}

export type NetData = ArrayBuffer | NetJson;

export type NetErrorCode =
  /** the room id is registered already (host: retry with a new code) */
  | 'id-taken'
  /** there is no room with that code */
  | 'not-found'
  /** the direct connection did not come up in time (NAT / firewall / mobile data) */
  | 'timeout'
  /** signaling server unreachable / offline */
  | 'network'
  /** browser without WebRTC / BroadcastChannel */
  | 'unsupported'
  /** lobby rejections */
  | 'full'
  | 'started'
  | 'version'
  /** the host closed the room */
  | 'closed'
  /** the host vanished (connection lost / timed out) */
  | 'host-lost'
  /** the host dropped this player */
  | 'kicked'
  /** the newer build could not be loaded (stale page after a deploy) */
  | 'stale'
  | 'error';

export class NetError extends Error {
  readonly code: NetErrorCode;
  constructor(code: NetErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'NetError';
  }
}

/** Player-facing (Korean) title + hint for an error code. */
export function netErrorText(code: NetErrorCode): { title: string; hint: string } {
  switch (code) {
    case 'not-found':
      return { title: '방을 찾을 수 없어요', hint: '코드를 다시 확인해 주세요. 방장이 방을 열어 두고 있어야 해요.' };
    case 'full':
      return { title: '방이 가득 찼어요', hint: '한 방에는 최대 4명까지 들어갈 수 있어요.' };
    case 'started':
      return { title: '이미 시작된 방이에요', hint: '하강이 끝나면 방장이 새 방을 열어 줄 거예요.' };
    case 'version':
      return { title: '게임 버전이 달라요 — 새로고침 해주세요', hint: '모두 같은 버전이어야 함께 할 수 있어요.' };
    case 'stale':
      return { title: '새 버전이 나왔어요 — 새로고침 해주세요', hint: '새로고침하면 최신 버전으로 바뀌어요.' };
    case 'timeout':
      return { title: '연결 시간이 초과됐어요', hint: '일부 모바일 데이터 망은 기기 간 직접 연결을 막아요. Wi-Fi로 바꿔 다시 시도해 보세요.' };
    case 'network':
      return { title: '연결 서버에 접속할 수 없어요', hint: '인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.' };
    case 'unsupported':
      return { title: '이 브라우저는 온라인 협동을 지원하지 않아요', hint: '최신 Chrome, Safari, Firefox에서 시도해 주세요.' };
    case 'closed':
      return { title: '방장이 방을 닫았어요', hint: '새 방을 만들거나 다른 코드로 참가해 보세요.' };
    case 'host-lost':
      return { title: '방장과의 연결이 끊어졌어요', hint: '네트워크가 불안정하면 Wi-Fi로 바꿔 보세요.' };
    case 'kicked':
      return { title: '방과의 연결이 끊어졌어요', hint: '네트워크 상태를 확인하고 다시 참가해 주세요.' };
    case 'id-taken':
      return { title: '방을 만들지 못했어요', hint: '잠시 후 다시 시도해 주세요.' };
    default:
      return { title: '연결 오류가 발생했어요', hint: '잠시 후 다시 시도해 주세요.' };
  }
}

export interface TransportHandlers {
  /** a message from a connected peer */
  message?(from: string, data: NetData): void;
  /** host: a client connected (transport level; the lobby handshake follows) */
  peerJoin?(peer: string): void;
  /** a peer disconnected (client: the host is gone) */
  peerLeave?(peer: string, reason: string): void;
  /** non-fatal transport error */
  error?(err: NetError): void;
  /** this endpoint was closed (locally or because the host went away) */
  close?(reason: string): void;
}

export interface Transport {
  readonly kind: TransportKind;
  readonly role: 'host' | 'client';
  /** the room code */
  readonly code: string;
  /** this endpoint's peer id */
  readonly localId: string;
  /** the host's peer id (== localId on the host) */
  readonly hostId: string;
  readonly closed: boolean;
  /** connected remote peers (host: its clients; client: [hostId] while connected) */
  peers(): string[];
  /** send to one peer (reliable, ordered); silently dropped when not connected */
  send(to: string, data: NetData): void;
  /** send to every connected peer (except `except`) */
  broadcast(data: NetData, except?: string): void;
  /** host: drop a client */
  kick(peer: string): void;
  /** close this endpoint (host: closes the room) */
  close(reason?: string): void;
  /** subscribe; returns an unsubscribe function */
  listen(h: TransportHandlers): () => void;
}

/** Creates host / client endpoints for one transport kind. */
export interface TransportFactory {
  readonly kind: TransportKind;
  /** register room `code` as host; rejects with NetError('id-taken') when it is in use */
  host(code: string): Promise<Transport>;
  /** connect to the host of room `code`; rejects with not-found / timeout / network */
  join(code: string): Promise<Transport>;
}

/** Shared listener bookkeeping for the implementations. */
export abstract class BaseTransport implements Transport {
  abstract readonly kind: TransportKind;
  readonly role: 'host' | 'client';
  readonly code: string;
  localId: string;
  hostId: string;
  closed = false;
  private handlers = new Set<TransportHandlers>();

  constructor(role: 'host' | 'client', code: string, localId: string, hostId: string) {
    this.role = role;
    this.code = code;
    this.localId = localId;
    this.hostId = hostId;
  }

  abstract peers(): string[];
  abstract send(to: string, data: NetData): void;
  abstract kick(peer: string): void;
  abstract close(reason?: string): void;

  broadcast(data: NetData, except?: string): void {
    for (const p of this.peers()) if (p !== except) this.send(p, data);
  }

  listen(h: TransportHandlers): () => void {
    this.handlers.add(h);
    return () => {
      this.handlers.delete(h);
    };
  }

  private each(fn: (h: TransportHandlers) => void): void {
    for (const h of [...this.handlers]) {
      try {
        fn(h);
      } catch (e) {
        console.error('[net] handler failed', e);
      }
    }
  }

  protected emitMessage(from: string, data: NetData): void {
    this.each((h) => h.message?.(from, data));
  }

  protected emitJoin(peer: string): void {
    this.each((h) => h.peerJoin?.(peer));
  }

  protected emitLeave(peer: string, reason: string): void {
    this.each((h) => h.peerLeave?.(peer, reason));
  }

  protected emitError(err: NetError): void {
    this.each((h) => h.error?.(err));
  }

  protected emitClose(reason: string): void {
    this.each((h) => h.close?.(reason));
  }
}

/** Is this a JSON message (as opposed to binary lockstep traffic)? */
export function isJson(data: NetData): data is NetJson {
  return !(data instanceof ArrayBuffer) && typeof data === 'object' && data !== null && typeof (data as NetJson).t === 'string';
}

/**
 * Host a room with a fresh random code, retrying with a new code while the
 * signaling server reports the id as taken.
 */
export async function hostRoom(factory: TransportFactory, makeCode: () => string = randomRoomCode, attempts = 6): Promise<Transport> {
  let last: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await factory.host(makeCode());
    } catch (e) {
      last = e;
      if (!(e instanceof NetError) || e.code !== 'id-taken') throw e;
    }
  }
  throw last instanceof NetError ? last : new NetError('id-taken');
}

/** The transport factory for a network config (`?net=bc` → BroadcastChannel, else PeerJS). */
export async function transportFactory(cfg: NetConfig): Promise<TransportFactory> {
  if (cfg.kind === 'bc') {
    const { BroadcastChannelFactory } = await import('./transport-bc');
    return new BroadcastChannelFactory();
  }
  const { PeerJsFactory } = await import('./transport-peerjs');
  return new PeerJsFactory(cfg);
}
