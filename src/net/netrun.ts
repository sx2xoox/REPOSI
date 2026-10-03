// NetRun: one co-op run on top of a NetSession — the lockstep loop around the
// shared World.
//
// Every local fixed step (the game scene's update):
//   1. sample this peer's input (keyboard / mouse / pad / touch, incl. touch
//      auto-aim, all resolved locally into a PlayerInput) and quantize it into
//      the 17-byte payload (game/seam encodeInput);
//   2. host: seal the next frame with it (+ queued commands) and simulate it;
//      client: send it, then simulate every frame the jitter buffer releases
//      (0, 1 or 2 — the World interpolates whatever ran in this step);
//   3. per frame: drop `left` keepers, decode every slot's payload into that
//      keeper's input (World.inputSource), apply the frame's commands
//      (game/coop.ts), step the world, and every HASH_INTERVAL ticks report
//      stateHash(world) (desyncs come back through onDesync).
// No local UI touches the world: overlays call `sendCommand`.

import type { NetSession } from './session';
import type { StartInfo } from './lobby';
import type { DesyncEvent, ClientEndReason } from './lockstep';
import { shouldHash } from './lockstep';
import type { Frame, NetCommand } from './wire';
import type { World } from '../game/world';
import { FIXED_DT } from '../game/constants';
import { clearInput, decodeInput, emptyInput, encodeInput, INPUT_BYTES, type PlayerInput } from '../game/seam';
import { stateHash, stateHashParts } from '../game/statehash';
import { applyCoopCommand, isCoopCommand, type CoopCommand } from '../game/coop';

export type NetRunState =
  /** playing */
  | 'running'
  /** a peer's state hash differed from the host's: the run cannot continue */
  | 'desync'
  /** the session ended under us (host gone, room closed, dropped) */
  | 'ended'
  /** the host took the party back to the lobby (the scene hands the transport over) */
  | 'lobby';

const EMPTY_PAYLOAD = new Uint8Array(INPUT_BYTES);
/** recent hashed ticks kept for desync diagnostics */
const PARTS_KEEP = 8;

export class NetRun {
  readonly session: NetSession;
  readonly start: StartInfo;
  readonly world: World;
  state: NetRunState = 'running';
  /** why the session ended (state 'ended') */
  endReason: ClientEndReason | null = null;
  desync: DesyncEvent | null = null;
  /** frames simulated so far (= next tick) */
  ticks = 0;
  /** per slot: this tick's decoded input (World.inputSource reads it) */
  private readonly inputs: PlayerInput[] = [emptyInput(), emptyInput(), emptyInput(), emptyInput()];
  private readonly payload = new Uint8Array(INPUT_BYTES);
  /** host: commands for the next sealed frame */
  private hostCmds: NetCommand[] = [];
  private observers = new Set<(f: Frame) => void>();
  private parts = new Map<number, Record<string, number>>();
  /** hash per hashed tick (diagnostics / tests) */
  readonly hashes = new Map<number, number>();
  /**
   * Tests / tools: deterministic world changes right before a frame's step
   * (must depend only on the tick and the world, so every peer does the same).
   */
  beforeStep: ((w: World, tick: number) => void) | null = null;

  constructor(session: NetSession, start: StartInfo, world: World) {
    this.session = session;
    this.start = start;
    this.world = world;
    world.inputSource = (_w, p, out) => {
      const src = this.inputs[p.slot];
      out.mx = src.mx;
      out.my = src.my;
      out.ax = src.ax;
      out.ay = src.ay;
      out.cx = src.cx;
      out.cy = src.cy;
      out.held = src.held;
      out.pressed = src.pressed;
    };
    const onDesync = (e: DesyncEvent) => this.onDesync(e);
    if (session.host) session.host.onDesync = onDesync;
    if (session.client) {
      session.client.onDesync = onDesync;
      session.client.onEnd = (reason) => {
        if (this.state === 'running') {
          this.state = 'ended';
          this.endReason = reason;
        }
      };
    }
    session.game = {
      observe: (fn) => {
        this.observers.add(fn);
        return () => this.observers.delete(fn);
      },
      sendCommand: (cmd) => this.sendCommand(cmd as NetCommand),
    };
  }

  get isHost(): boolean {
    return this.session.role === 'host';
  }

  /** Client: no frame from the host for a while (show "연결 대기 중…"). */
  get waiting(): boolean {
    return this.state === 'running' && !!this.session.client?.waitingForHost;
  }

  /** Queue a lockstep command (applied on every peer at the same tick). */
  sendCommand(cmd: CoopCommand | NetCommand): void {
    if (this.state !== 'running' && cmd.type !== 'lobby') return;
    if (this.session.host) this.hostCmds.push(cmd as NetCommand);
    else this.session.client?.sendCommand(cmd as NetCommand);
  }

  /**
   * One local fixed step: send `sample` (this peer's input, null = none: an
   * overlay is open) and simulate the frames that are due. Returns how many
   * world steps ran (0..2).
   */
  step(sample: PlayerInput | null): number {
    if (this.state !== 'running' || this.session.closed) return 0;
    const payload = sample ? encodeInput(sample, this.payload) : EMPTY_PAYLOAD;
    const host = this.session.host;
    if (host) {
      const cmds = this.hostCmds;
      this.hostCmds = [];
      this.apply(host.sealFrame(host.tick + 1, payload, cmds));
      return 1;
    }
    const client = this.session.client;
    if (!client) return 0;
    client.sendInput(payload);
    let n = 0;
    for (let k = client.stepsDue(); k > 0 && this.state === 'running'; k--) {
      this.apply(client.nextFrame());
      n++;
    }
    return n;
  }

  /** Simulate one sealed frame (identical on every peer). */
  private apply(f: Frame): void {
    this.world.withIds(() => this.apply1(f));
  }

  private apply1(f: Frame): void {
    const w = this.world;
    for (const slot of f.left) w.removePlayer(slot);
    for (let slot = 0; slot < this.inputs.length; slot++) {
      const b = f.inputs[slot];
      if (b) decodeInput(b, this.inputs[slot]);
      else clearInput(this.inputs[slot]);
    }
    let lobby = false;
    for (const { slot, cmd } of f.commands) {
      if (!isCoopCommand(cmd)) continue;
      if (cmd.type === 'lobby') {
        if (slot === 0) lobby = true;
        continue;
      }
      applyCoopCommand(w, slot, cmd);
    }
    // (outside the step the context keeper is this peer's own: scripted changes run as the party leader)
    if (this.beforeStep) w.asPlayer(w.lead(), () => this.beforeStep!(w, f.tick));
    w.update(FIXED_DT);
    this.ticks = f.tick + 1;
    if (shouldHash(f.tick)) {
      const h = stateHash(w);
      this.hashes.set(f.tick, h);
      if (this.hashes.size > 4096) this.hashes.delete(this.hashes.keys().next().value as number);
      this.parts.set(f.tick, stateHashParts(w));
      if (this.parts.size > PARTS_KEEP) this.parts.delete(this.parts.keys().next().value as number);
      (this.session.host ?? this.session.client)?.submitHash(f.tick, h);
    }
    for (const fn of this.observers) fn(f);
    if (lobby && this.state === 'running') this.state = 'lobby';
  }

  private onDesync(e: DesyncEvent): void {
    if (this.state !== 'running') return;
    this.state = 'desync';
    this.desync = e;
    // diagnostics: which part of our state the hash at that tick was made of
    console.warn(`[coop] desync at tick ${e.tick} (slot ${e.slot}: host ${e.hostHash.toString(16)} vs peer ${e.peerHash.toString(16)})`, {
      ourParts: this.parts.get(e.tick) ?? null,
      currentParts: stateHashParts(this.world),
      tick: this.ticks,
    });
  }

  /** Stop observing / sending (the scene is going away). */
  dispose(): void {
    this.observers.clear();
    if (this.session.game) this.session.game = null;
  }
}
