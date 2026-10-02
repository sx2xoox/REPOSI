// Online co-op network configuration: which transport to use, the PeerJS
// signaling server and the ICE (STUN / TURN) servers handed to WebRTC.
//
// Defaults cost nothing to run: the free public PeerJS cloud (0.peerjs.com) only
// brokers the WebRTC handshake, Google's public STUN servers tell each browser
// its public address, and then game traffic flows directly peer to peer.
//
// URL overrides (handy for a self-hosted / local PeerServer and for tests):
//   ?net=bc                 same-origin tabs over BroadcastChannel (dev / tests, no network)
//   ?net=peerjs             (default) WebRTC via PeerJS
//   ?peerHost=localhost&peerPort=9000&peerPath=/lk&peerSecure=0&peerKey=peerjs
//   ?turn=turn:turn.example.com:3478&turnUser=name&turnPass=secret
//   ?ice=none               no STUN at all (LAN / same machine only)

export type TransportKind = 'peerjs' | 'bc' | 'memory';

export interface PeerServerConfig {
  host: string;
  port: number;
  path: string;
  secure: boolean;
  key: string;
}

/** Every room registers the PeerJS id `${PEER_ID_PREFIX}${CODE}` on the signaling server. */
export const PEER_ID_PREFIX = 'lanternkeeper-';

/** The free public PeerJS cloud server. */
export const DEFAULT_PEER_SERVER: PeerServerConfig = {
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  key: 'peerjs',
};

/** Free public STUN servers (address discovery only; they never carry game traffic). */
export const STUN_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

/**
 * Optional TURN relays. Empty by default (there is no free, unlimited public TURN).
 *
 * Without TURN, two players behind symmetric NATs (some mobile-data carriers,
 * strict corporate / campus networks) cannot connect directly; the join then
 * times out and the lobby suggests switching to Wi-Fi. Adding a TURN server
 * here (or via `?turn=`) relays such sessions, e.g.:
 *   { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'secret' }
 * Keep credentials out of the repository if they cost money: TURN credentials
 * shipped in a static site are public.
 */
export const TURN_SERVERS: RTCIceServer[] = [];

export interface NetConfig {
  kind: TransportKind;
  peer: PeerServerConfig;
  iceServers: RTCIceServer[];
  /** PeerJS debug level 0..3 (`?peerDebug=2`) */
  debug: number;
}

/** Resolve the network config from a URL query string (pure; unit-tested). */
export function netConfigFromSearch(search: string): NetConfig {
  const q = new URLSearchParams(search);
  const kindParam = (q.get('net') ?? '').toLowerCase();
  const kind: TransportKind = kindParam === 'bc' || kindParam === 'broadcast' ? 'bc' : 'peerjs';
  const peer: PeerServerConfig = { ...DEFAULT_PEER_SERVER };
  const host = q.get('peerHost');
  if (host) {
    peer.host = host;
    // a custom server defaults to plain ws on localhost, TLS elsewhere
    peer.secure = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host);
    peer.port = peer.secure ? 443 : 9000;
  }
  const port = Number(q.get('peerPort'));
  if (Number.isFinite(port) && port > 0) peer.port = Math.floor(port);
  const path = q.get('peerPath');
  if (path) peer.path = path.startsWith('/') ? path : `/${path}`;
  const secure = q.get('peerSecure');
  if (secure !== null) peer.secure = secure === '1' || secure === 'true';
  const key = q.get('peerKey');
  if (key) peer.key = key;
  let iceServers: RTCIceServer[] = q.get('ice') === 'none' ? [] : [...STUN_SERVERS];
  iceServers = [...iceServers, ...TURN_SERVERS];
  const turn = q.get('turn');
  if (turn) {
    iceServers.push({ urls: turn, username: q.get('turnUser') ?? undefined, credential: q.get('turnPass') ?? undefined });
  }
  const debug = Math.max(0, Math.min(3, Number(q.get('peerDebug')) || 0));
  return { kind, peer, iceServers, debug };
}

/** The config for the current page (or the defaults outside a browser). */
export function currentNetConfig(): NetConfig {
  const search = typeof location !== 'undefined' ? location.search : '';
  return netConfigFromSearch(search);
}

/**
 * URL params that must travel with a share link so the friend ends up on the
 * same transport / signaling server (dev and self-hosted setups).
 */
export const SHARED_URL_PARAMS = ['net', 'peerHost', 'peerPort', 'peerPath', 'peerSecure', 'peerKey', 'ice'] as const;
