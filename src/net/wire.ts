// Binary wire format of the lockstep layer + the input merge contract.
// All integers little-endian. Every message starts with a u8 type.
//
//   FRAME   host → all   u8 1 · u32 tick · u8 n · n × entry
//            entry: u8 slot · u8 flags (1 INPUT, 2 LEFT, 4 JOINED)
//                   [INPUT: u8 len · len bytes] · u8 ncmd · ncmd × (u16 len · UTF-8 JSON)
//   INPUT   client → host u8 2 · u32 seq · u32 ack (last frame tick + 1, 0 = none) · u8 len · bytes
//   CMD     client → host u8 3 · u32 seq · u16 len · UTF-8 JSON
//   HASH    client → host u8 4 · u32 tick · u32 hash
//   LEAVE   client → host u8 5
//   DESYNC  host → all   u8 6 · u32 tick · u8 slot · u32 hostHash · u32 peerHash
//   PING    either       u8 7 · u32 id        PONG  u8 8 · u32 id
//   END     host → all   u8 9 · u8 reason (0 closed, 1 kicked)

export const MSG = { FRAME: 1, INPUT: 2, CMD: 3, HASH: 4, LEAVE: 5, DESYNC: 6, PING: 7, PONG: 8, END: 9 } as const;

export const MAX_SLOTS = 4;
/** max bytes of one player's input payload */
export const MAX_INPUT_BYTES = 32;
/** max UTF-8 bytes of one serialized command */
export const MAX_COMMAND_BYTES = 4096;

const F_INPUT = 1;
const F_LEFT = 2;
const F_JOINED = 4;

/** A reliable per-player command (any JSON object with a `type`), e.g. {type:'bless', pick:1}. */
export interface NetCommand {
  type: string;
  [k: string]: unknown;
}

export interface FrameCommand {
  slot: number;
  cmd: NetCommand;
}

/** One sealed lockstep frame: everything every peer needs to simulate `tick`. */
export interface Frame {
  tick: number;
  /** per slot 0..3: that player's input for this tick, or null when the slot is not in the game */
  inputs: (Uint8Array | null)[];
  /** commands to apply at this tick, in order (slot ascending, then submission order) */
  commands: FrameCommand[];
  /** slots that join at this tick (reserved: mid-run joins are rejected today) */
  joined: number[];
  /** slots that leave at this tick: drop them before simulating it (they have no input) */
  left: number[];
}

// ---------------------------------------------------------------- input merge contract
/**
 * Per-player input payloads are opaque to the network (≤ 32 bytes). The merge
 * rule needs one convention, the EDGE / HELD split:
 *
 *   bytes [0, edgeBytes)   EDGE: bits for buttons *pressed since the previous sample*
 *   bytes [edgeBytes, len) HELD: level state (held buttons, move / aim axes, ...)
 *
 * Clients send one sample per local fixed step. When several samples reach the
 * host before it seals a tick they collapse into that tick: EDGE bytes are
 * OR-ed (a tap is never lost) and HELD comes from the latest sample. A tick
 * with no new sample repeats the last HELD with EDGE cleared (no phantom
 * re-press). Samples arriving after a seal go into the next unsealed tick.
 * A player silent for `staleInputMs` gets the `neutral` payload.
 *
 * Custom layouts can pass their own `merge` / `repeat` instead.
 */
export interface InputCodec {
  /** combine an accumulated sample with a newer one (must not mutate its arguments) */
  merge(acc: Uint8Array, next: Uint8Array): Uint8Array;
  /** the payload for a tick without a new sample, from the last one (must not mutate) */
  repeat(last: Uint8Array): Uint8Array;
  /** payload of a player with no input yet / gone silent */
  neutral: Uint8Array;
}

/** The default codec: the first `edgeBytes` bytes are the EDGE region (see InputCodec). */
export function edgeMergeCodec(edgeBytes = 4, neutral: Uint8Array = new Uint8Array(0)): InputCodec {
  return {
    neutral,
    merge(acc, next) {
      const out = next.slice();
      const n = Math.min(edgeBytes, acc.length, out.length);
      for (let i = 0; i < n; i++) out[i] |= acc[i];
      return out;
    },
    repeat(last) {
      const out = last.slice();
      out.fill(0, 0, Math.min(edgeBytes, out.length));
      return out;
    },
  };
}

// ---------------------------------------------------------------- byte helpers
const enc = new TextEncoder();
const dec = new TextDecoder();

class Writer {
  private buf: Uint8Array;
  private view: DataView;
  pos = 0;

  constructor(size = 256) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }

  private need(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const nb = new Uint8Array(size);
    nb.set(this.buf);
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }

  u8(v: number): this {
    this.need(1);
    this.view.setUint8(this.pos, v);
    this.pos += 1;
    return this;
  }

  u16(v: number): this {
    this.need(2);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
    return this;
  }

  u32(v: number): this {
    this.need(4);
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
    return this;
  }

  bytes(b: Uint8Array): this {
    this.need(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
    return this;
  }

  done(): ArrayBuffer {
    return this.buf.buffer.slice(0, this.pos) as ArrayBuffer;
  }
}

class Reader {
  private view: DataView;
  private u8a: Uint8Array;
  pos = 0;

  constructor(buf: ArrayBuffer) {
    this.view = new DataView(buf);
    this.u8a = new Uint8Array(buf);
  }

  private check(n: number): void {
    if (this.pos + n > this.u8a.length) throw new RangeError('truncated message');
  }

  u8(): number {
    this.check(1);
    return this.view.getUint8(this.pos++);
  }

  u16(): number {
    this.check(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.check(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  bytes(n: number): Uint8Array {
    this.check(n);
    const out = this.u8a.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

function encodeJson(cmd: NetCommand): Uint8Array {
  const b = enc.encode(JSON.stringify(cmd));
  if (b.length > MAX_COMMAND_BYTES) throw new RangeError(`command too large (${b.length} bytes)`);
  return b;
}

function decodeJson(b: Uint8Array): NetCommand {
  return JSON.parse(dec.decode(b)) as NetCommand;
}

/** Size-check a command before it is queued (throws on oversize / non-JSON). */
export function checkCommand(cmd: NetCommand): void {
  if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') throw new TypeError('command needs a string `type`');
  encodeJson(cmd);
}

// ---------------------------------------------------------------- frames
export function emptyFrame(tick: number): Frame {
  return { tick, inputs: [null, null, null, null], commands: [], joined: [], left: [] };
}

export function encodeFrame(f: Frame): ArrayBuffer {
  const w = new Writer(64);
  w.u8(MSG.FRAME).u32(f.tick);
  const slots: number[] = [];
  for (let s = 0; s < MAX_SLOTS; s++) {
    if (f.inputs[s] || f.left.includes(s) || f.joined.includes(s) || f.commands.some((c) => c.slot === s)) slots.push(s);
  }
  w.u8(slots.length);
  for (const s of slots) {
    const input = f.inputs[s];
    let flags = 0;
    if (input) flags |= F_INPUT;
    if (f.left.includes(s)) flags |= F_LEFT;
    if (f.joined.includes(s)) flags |= F_JOINED;
    w.u8(s).u8(flags);
    if (input) {
      if (input.length > MAX_INPUT_BYTES) throw new RangeError(`input payload too large (${input.length} bytes)`);
      w.u8(input.length).bytes(input);
    }
    const cmds = f.commands.filter((c) => c.slot === s);
    w.u8(cmds.length);
    for (const c of cmds) {
      const b = encodeJson(c.cmd);
      w.u16(b.length).bytes(b);
    }
  }
  return w.done();
}

/** Decode a FRAME message (throws on malformed input). */
export function decodeFrame(buf: ArrayBuffer): Frame {
  const r = new Reader(buf);
  if (r.u8() !== MSG.FRAME) throw new TypeError('not a frame');
  const f = emptyFrame(r.u32());
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    const s = r.u8();
    if (s >= MAX_SLOTS) throw new RangeError('bad slot');
    const flags = r.u8();
    if (flags & F_INPUT) f.inputs[s] = r.bytes(r.u8());
    if (flags & F_LEFT) f.left.push(s);
    if (flags & F_JOINED) f.joined.push(s);
    const nc = r.u8();
    for (let k = 0; k < nc; k++) f.commands.push({ slot: s, cmd: decodeJson(r.bytes(r.u16())) });
  }
  return f;
}

// ---------------------------------------------------------------- small messages
export type WireMsg =
  | { type: 'frame'; frame: Frame }
  | { type: 'input'; seq: number; ack: number; payload: Uint8Array }
  | { type: 'cmd'; seq: number; cmd: NetCommand }
  | { type: 'hash'; tick: number; hash: number }
  | { type: 'leave' }
  | { type: 'desync'; tick: number; slot: number; hostHash: number; peerHash: number }
  | { type: 'ping'; id: number }
  | { type: 'pong'; id: number }
  | { type: 'end'; reason: 'closed' | 'kicked' };

export function encodeInput(seq: number, ack: number, payload: Uint8Array): ArrayBuffer {
  if (payload.length > MAX_INPUT_BYTES) throw new RangeError(`input payload too large (${payload.length} bytes)`);
  return new Writer(12 + payload.length).u8(MSG.INPUT).u32(seq).u32(ack).u8(payload.length).bytes(payload).done();
}

export function encodeCommand(seq: number, cmd: NetCommand): ArrayBuffer {
  const b = encodeJson(cmd);
  return new Writer(8 + b.length).u8(MSG.CMD).u32(seq).u16(b.length).bytes(b).done();
}

export function encodeHash(tick: number, hash: number): ArrayBuffer {
  return new Writer(9).u8(MSG.HASH).u32(tick).u32(hash).done();
}

export function encodeLeave(): ArrayBuffer {
  return new Writer(1).u8(MSG.LEAVE).done();
}

export function encodeDesync(tick: number, slot: number, hostHash: number, peerHash: number): ArrayBuffer {
  return new Writer(14).u8(MSG.DESYNC).u32(tick).u8(slot).u32(hostHash).u32(peerHash).done();
}

export function encodePing(id: number, pong = false): ArrayBuffer {
  return new Writer(5).u8(pong ? MSG.PONG : MSG.PING).u32(id).done();
}

export function encodeEnd(reason: 'closed' | 'kicked'): ArrayBuffer {
  return new Writer(2).u8(MSG.END).u8(reason === 'kicked' ? 1 : 0).done();
}

/** Decode any lockstep message; null for unknown / malformed data. */
export function decodeMessage(buf: ArrayBuffer): WireMsg | null {
  try {
    const r = new Reader(buf);
    switch (r.u8()) {
      case MSG.FRAME:
        return { type: 'frame', frame: decodeFrame(buf) };
      case MSG.INPUT: {
        const seq = r.u32();
        const ack = r.u32();
        return { type: 'input', seq, ack, payload: r.bytes(r.u8()) };
      }
      case MSG.CMD: {
        const seq = r.u32();
        return { type: 'cmd', seq, cmd: decodeJson(r.bytes(r.u16())) };
      }
      case MSG.HASH:
        return { type: 'hash', tick: r.u32(), hash: r.u32() };
      case MSG.LEAVE:
        return { type: 'leave' };
      case MSG.DESYNC:
        return { type: 'desync', tick: r.u32(), slot: r.u8(), hostHash: r.u32(), peerHash: r.u32() };
      case MSG.PING:
        return { type: 'ping', id: r.u32() };
      case MSG.PONG:
        return { type: 'pong', id: r.u32() };
      case MSG.END:
        return { type: 'end', reason: r.u8() === 1 ? 'kicked' : 'closed' };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Stable 32-bit FNV-1a digest of an encoded frame (tests / diagnostics). */
export function frameDigest(f: Frame): number {
  const b = new Uint8Array(encodeFrame(f));
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) {
    h ^= b[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
