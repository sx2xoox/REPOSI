// NetSession: what the lobby hands to the game when the host starts a co-op run
// (transport + lockstep role + roster + local slot + RTT), and the integration
// hook `startNetRun(session, start)` every peer calls with the same StartInfo.
//
// The default `startNetRun` below just starts a normal single-player run with
// the shared seed and the local player's character, so the lobby flow is
// testable end to end; the multiplayer world integration replaces it.

import { app } from '../game/app';
import { LockstepClient, LockstepHost, shouldHash, type LockstepOptions } from './lockstep';
import type { Lobby, LobbyPlayer, StartInfo } from './lobby';
import type { Transport } from './transport';
import { frameDigest, type Frame } from './wire';

export type { StartInfo, LobbyPlayer } from './lobby';

export interface NetSession {
  readonly transport: Transport;
  /** the lobby that started it (the host's keeps rejecting late joiners) */
  readonly lobby: Lobby;
  readonly role: 'host' | 'client';
  readonly code: string;
  /** players at start (slot 0 = host) */
  readonly roster: LobbyPlayer[];
  readonly localSlot: number;
  readonly start: StartInfo;
  /** lockstep scheduler: exactly one of host / client is set */
  readonly host: LockstepHost | null;
  readonly client: LockstepClient | null;
  /** RTT in ms: client → to the host; host → to `slot` (0 when unknown) */
  rtt(slot?: number): number;
  readonly closed: boolean;
  /** leave / end the session and close the transport */
  close(): void;
}

let active: NetSession | null = null;

/** The running co-op session, if any. */
export function activeSession(): NetSession | null {
  return active && !active.closed ? active : null;
}

/** Build the session (lockstep host or client) for a started lobby. */
export function createNetSession(lobby: Lobby, start: StartInfo, opts: LockstepOptions = {}): NetSession {
  const transport = lobby.transport;
  const role = lobby.role;
  const localSlot = lobby.localSlot;
  const lsOpts: LockstepOptions = { initialBuffer: start.inputDelayHint, ...opts };
  const host = role === 'host' ? new LockstepHost(transport, start.roster.map((p) => ({ slot: p.slot, peer: p.peer })), localSlot, lsOpts) : null;
  const client = role === 'client' ? new LockstepClient(transport, localSlot, lsOpts) : null;
  if (role === 'client') lobby.dispose();
  let closed = false;
  const timer = typeof setInterval !== 'undefined' && typeof window !== 'undefined'
    ? setInterval(() => (host ?? client)?.poll(), 100)
    : null;
  const session: NetSession = {
    transport,
    lobby,
    role,
    code: transport.code,
    roster: start.roster.map((p) => ({ ...p })),
    localSlot,
    start,
    host,
    client,
    rtt: (slot?: number) => (client ? client.rtt : host && slot !== undefined ? host.rtt(slot) : 0),
    get closed() {
      return closed;
    },
    close() {
      if (closed) return;
      closed = true;
      if (timer) clearInterval(timer);
      host?.close();
      client?.leave();
      lobby.dispose();
      setTimeout(() => transport.close('closed'), 250);
      if (active === session) active = null;
    },
  };
  active = session;
  return session;
}

/**
 * Integration hook: called on every peer when the host starts, with the same
 * StartInfo. DEFAULT: a normal single-player run with the shared seed and the
 * local player's character (the co-op world integration replaces this body).
 */
export function startNetRun(session: NetSession, start: StartInfo): void {
  const me = start.roster.find((p) => p.slot === session.localSlot);
  app.startRun(start.seed, me?.characterId ?? start.roster[0]?.characterId ?? '', true);
}

// ---------------------------------------------------------------- e2e probe
export interface ProbeResult {
  role: 'host' | 'client';
  frames: number;
  digest: number;
  /** ticks at which commands were applied, as "tick:slot:type" */
  commands: string[];
  underruns: number;
  catchUps: number;
  target: number;
  rtt: number;
}

/**
 * Drive the session's lockstep for `ticks` fixed steps with synthetic inputs
 * (timers, independent of the game loop) and digest the frame sequence. Every
 * peer must report the same digest: used by scripts/net-e2e.mjs to check the
 * real transports end to end. Each peer also sends one command at tick 30.
 */
export function probeLockstep(session: NetSession, ticks = 180): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    let digest = 0x811c9dc5;
    let done = 0;
    let step = 0;
    const commands: string[] = [];
    const eat = (f: Frame) => {
      digest = Math.imul(digest ^ frameDigest(f), 0x01000193) >>> 0;
      for (const c of f.commands) commands.push(`${f.tick}:${c.slot}:${c.cmd.type}`);
      done++;
      if (shouldHash(f.tick)) (session.host ?? session.client)?.submitHash(f.tick, f.tick * 7919);
    };
    const payload = (n: number) => new Uint8Array([n & 1 ? 1 : 0, 0, 0, 0, session.localSlot, n & 0xff, (n >> 8) & 0xff]);
    const started = performance.now();
    const timer = setInterval(() => {
      // fixed steps from wall time (setInterval is coarse)
      const want = Math.floor((performance.now() - started) / (1000 / 60));
      while (step < want && done < ticks) {
        step++;
        if (session.host) {
          if (step === 30) session.host.sendCommand({ type: 'probe' });
          eat(session.host.sealFrame(session.host.tick + 1, payload(step)));
        } else if (session.client) {
          if (step === 30) session.client.sendCommand({ type: 'probe' });
          session.client.sendInput(payload(step));
          for (let n = session.client.stepsDue(); n > 0 && done < ticks; n--) eat(session.client.nextFrame());
        }
      }
      if (done >= ticks) {
        clearInterval(timer);
        const st = session.client?.stats;
        resolve({
          role: session.role, frames: done, digest, commands,
          underruns: st?.underruns ?? 0, catchUps: st?.catchUps ?? 0, target: st?.target ?? 0, rtt: Math.round(session.rtt(1)),
        });
      } else if (performance.now() - started > ticks * 50 + 10000) {
        clearInterval(timer);
        reject(new Error(`probe timed out after ${done}/${ticks} frames`));
      }
    }, 8);
  });
}
