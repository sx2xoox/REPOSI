// Lockstep seam: everything the simulation takes from outside, as plain data.
//
// `PlayerInput` is one keeper's input for one fixed step. The simulation reads
// it only through `Player.input`, which `World.inputSource` fills at the start of
// the keeper's update: in single-player from the local devices (`readLocalInput`,
// keyboard / mouse / gamepad / touch via the `input` singleton), in tests from a
// script, in multiplayer from the network frame of that tick
// (`encodeInput` / `decodeInput` give a compact payload whose first 4 bytes are
// the EDGE region of net/wire's `edgeMergeCodec(4)`).
//
// `SimRules` are the few options that change the simulation (not just its
// presentation): every peer must use the same values, so multiplayer fixes them
// at run start; single-player follows the live settings (`localRules`).

import type { World } from './world';
import type { Player } from './player';
import { input } from '../engine/input';
import { save } from '../engine/save';

/** Level (held) buttons. */
export const HELD = {
  /** attack button held (mouse / RT / touch attack in cursor-or-manual aim) */
  fire: 1,
  /** aiming with the cursor (mouse mode): the keeper faces `cx, cy`; else the last aim is kept */
  cursorAim: 2,
} as const;

/** Edge buttons: pressed since the previous step. */
export const PRESS = {
  dash: 1,
  bomb: 2,
  active: 4,
  potion: 8,
  /** 등불 해방 (F) */
  release: 16,
  swap: 32,
  interact: 64,
} as const;

export interface PlayerInput {
  /** movement, length <= 1 */
  mx: number;
  my: number;
  /** aim-stick / arrow-key direction (unit vector): aims and fires; (0, 0) = none */
  ax: number;
  ay: number;
  /** cursor in world px (mouse aim, aimed actives / launchers) */
  cx: number;
  cy: number;
  /** HELD bits */
  held: number;
  /** PRESS bits (buttons pressed since the previous step) */
  pressed: number;
}

export function emptyInput(): PlayerInput {
  return { mx: 0, my: 0, ax: 0, ay: 0, cx: 0, cy: 0, held: 0, pressed: 0 };
}

export function clearInput(o: PlayerInput): PlayerInput {
  o.mx = o.my = o.ax = o.ay = o.cx = o.cy = 0;
  o.held = o.pressed = 0;
  return o;
}

export function copyInput(dst: PlayerInput, src: PlayerInput): PlayerInput {
  dst.mx = src.mx;
  dst.my = src.my;
  dst.ax = src.ax;
  dst.ay = src.ay;
  dst.cx = src.cx;
  dst.cy = src.cy;
  dst.held = src.held;
  dst.pressed = src.pressed;
  return dst;
}

/** Fills a keeper's input for the current step (`World.inputSource`). */
export type InputSource = (w: World, p: Player, out: PlayerInput) => void;

/**
 * Single-player source: the local devices through the `input` singleton (called
 * once per step, from the keeper's update). Aim priority as always: arrow keys >
 * gamepad / touch aim stick > mouse cursor.
 */
export function readLocalInput(w: World, _p: Player, out: PlayerInput): void {
  const mv = input.moveVector();
  out.mx = mv.x;
  out.my = mv.y;
  const aim = input.keyAim() ?? input.padAimVector();
  out.ax = aim ? aim.x : 0;
  out.ay = aim ? aim.y : 0;
  const r = w.renderer;
  if (r) {
    const m = r.displayToWorld(input.mouseX, input.mouseY);
    out.cx = m.x;
    out.cy = m.y;
  }
  out.held = (input.held('fire') ? HELD.fire : 0) | (input.aimMode === 'mouse' ? HELD.cursorAim : 0);
  out.pressed =
    (input.pressed('dash') ? PRESS.dash : 0) |
    (input.pressed('bomb') ? PRESS.bomb : 0) |
    (input.pressed('active') ? PRESS.active : 0) |
    (input.pressed('consumable') ? PRESS.potion : 0) |
    (input.pressed('special') ? PRESS.release : 0) |
    (input.pressed('swap') ? PRESS.swap : 0) |
    (input.pressed('interact') ? PRESS.interact : 0);
}

// ------------------------------------------------------------------ wire format
/** encoded size: 4 EDGE bytes (pressed), 1 held byte, 6 int16 axes */
export const INPUT_BYTES = 17;
const AXIS = 32767;
/** cursor resolution: 1/8 px (range +-4096 px) */
const CURSOR = 8;

function q16(v: number, scale: number): number {
  const n = Math.trunc(v * scale);
  return n > 32767 ? 32767 : n < -32768 ? -32768 : n;
}

/**
 * Compact payload (little endian): [0..3] pressed bits (EDGE region of
 * edgeMergeCodec(4)), [4] held bits, then int16 move x/y and aim x/y
 * (x 1/32767, truncated toward zero so |move| stays <= 1) and cursor x/y (1/8 px).
 * Quantizes: the local keeper must simulate the decoded values too
 * (`quantizeInput`), so every peer sees exactly the same input.
 */
export function encodeInput(i: PlayerInput, out: Uint8Array = new Uint8Array(INPUT_BYTES)): Uint8Array {
  const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
  v.setUint32(0, i.pressed >>> 0, true);
  v.setUint8(4, i.held & 0xff);
  v.setInt16(5, q16(i.mx, AXIS), true);
  v.setInt16(7, q16(i.my, AXIS), true);
  v.setInt16(9, q16(i.ax, AXIS), true);
  v.setInt16(11, q16(i.ay, AXIS), true);
  v.setInt16(13, q16(i.cx, CURSOR), true);
  v.setInt16(15, q16(i.cy, CURSOR), true);
  return out;
}

/** Decode `encodeInput`'s payload (a short / empty payload decodes as no input). */
export function decodeInput(b: Uint8Array, out: PlayerInput = emptyInput()): PlayerInput {
  if (b.length < INPUT_BYTES) return clearInput(out);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  out.pressed = v.getUint32(0, true);
  out.held = v.getUint8(4);
  out.mx = v.getInt16(5, true) / AXIS;
  out.my = v.getInt16(7, true) / AXIS;
  out.ax = v.getInt16(9, true) / AXIS;
  out.ay = v.getInt16(11, true) / AXIS;
  out.cx = v.getInt16(13, true) / CURSOR;
  out.cy = v.getInt16(15, true) / CURSOR;
  return out;
}

const qbuf = new Uint8Array(INPUT_BYTES);
/** Round-trip through the wire format in place (what remote peers will simulate). */
export function quantizeInput(i: PlayerInput): PlayerInput {
  return decodeInput(encodeInput(i, qbuf), i);
}

// ------------------------------------------------------------------ rules
/** Options that change the simulation itself: identical on every peer. */
export interface SimRules {
  /** brief simulation freezes on heavy hits / kills / explosions (설정 > 역경직) */
  hitStop: boolean;
}

/** Single-player: follow the live settings (toggling 역경직 mid-run applies at once). */
export const localRules: SimRules = {
  get hitStop() {
    return save.settings.hitStop;
  },
};

/** Fixed rules for a lockstep run (host decides; sent with the run start). */
export function fixedRules(o: Partial<SimRules> = {}): SimRules {
  return { hitStop: o.hitStop ?? true };
}
