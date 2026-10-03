// Art for the final boss 무명 (the darkness that swallowed the lantern) and its arena.
// The boss is assembled from separately animated layers drawn by its custom draw():
//   chains -> thorn crown (P2) -> lantern cage body -> captive lights -> eye (sclera +
//   tracking iris, lids) -> tendrils; two shadow hands are their own entities.
//   Phase 3 swaps the cage for the black-sun core with orbiting cage shards.
// Everything is painted procedurally with PixelPainter (lazily compiled).

import { PixelPainter, bayer } from '../../engine/painter';
import { defineAnim, defineDrawnSprite, hasSprite } from '../../engine/sprites';
import { clamp, TAU } from '../../engine/math';
import { ball, crack, hash2, limb, lum } from './final-kit';

// ------------------------------------------------------------------ palette
/** dark violet iron of the great lantern (darkest -> lightest) */
export const IRON = ['#05030a', '#120c20', '#221836', '#372852', '#54407a', '#7e68aa', '#b4a4dc'];
/** shadow flesh (hands, lids, tendrils) */
export const SHADE = ['#06030c', '#140a24', '#2a1442', '#462266', '#6e3a96', '#a060d0'];
/** hot void magenta */
export const VMAG = ['#3a0628', '#7a0a4a', '#c01870', '#ff4fae', '#ffb0e0', '#ffe6f4'];
export const GLASS = ['#2a1a4a', '#5a3a8a', '#a080e0', '#e0d0ff'];
export const SCLERA = ['#4a3a5e', '#8a7aa2', '#c8bcd8', '#ece4f4'];
export const EMBER = ['#5a1a08', '#b0400c', '#ff8a24', '#ffd060', '#fff4c0'];
export const OUT = '#05020a';

// ------------------------------------------------------------------ lantern body
export const BODY_W = 88;
export const BODY_H = 78;
/** pivot = the eye centre */
export const BODY_ORIGIN: [number, number] = [44, 40];

function capHalf(y: number): number {
  if (y < 9 || y > 23) return -1;
  return 7 + 21 * Math.sqrt((y - 9) / 14);
}

function baseHalf(y: number): number {
  if (y < 58 || y > 69) return -1;
  return 30 - (y - 58) * 1.1;
}

/**
 * The great lantern. `k` = animation frame (glow pulse / smoke), `cracked` = phase 2
 * (glowing fissures), `strain` 0..1 = shell about to burst (phase-3 transition).
 */
export function paintLantern(p: PixelPainter, k: number, cracked: boolean, strain = 0): void {
  const cx = 44;
  const ecy = 40;
  // ring handle
  p.ring(cx, 5, 4.5, 2, IRON[3]);
  p.px(cx - 3, 2, IRON[6]);
  p.px(cx - 4, 3, IRON[5]);
  p.px(cx + 3, 7, IRON[1]);
  // ---- chamber interior: deep darkness with a violet-magenta glow around the eye
  const pulse = [0, 0.04, 0.07, 0.04][k % 4] + strain * 0.35;
  for (let y = 24; y <= 59; y++) {
    for (let x = 18; x <= 70; x++) {
      const d = Math.hypot((x + 0.5 - cx) / 27, (y + 0.5 - ecy) / 20) - pulse;
      const f = d + (bayer(x, y) - 0.5) * 0.12;
      let c = f < 0.3 ? '#7a32aa' : f < 0.46 ? '#5a2088' : f < 0.62 ? '#3e1266' : f < 0.8 ? '#260a44' : f < 0.98 ? '#160528' : '#0a0314';
      if (strain > 0.4 && d < 0.2 + strain * 0.35) c = strain > 0.8 ? '#ffe6f4' : f < 0.25 ? '#ffb0e0' : '#ff4fae';
      p.px(x, y, c);
    }
  }
  // curling smoke inside the cage
  for (let i = 0; i < 3; i++) {
    const ph = k * 0.8 + i * 2.1;
    for (let t = 0; t < 1; t += 0.04) {
      const x = 24 + i * 16 + Math.sin(t * 5 + ph) * 4;
      const y = 57 - t * 30;
      if (Math.hypot((x - cx) / 27, (y - ecy) / 20) < 0.5) continue;
      p.px(x, y, t < 0.5 ? '#3a1660' : '#2a0e4a');
    }
  }
  // jagged remnants of the broken glass panes along each frame cell
  const faces: [number, number][] = [[21, 29], [32, 56], [59, 67]];
  for (const [x0, x1] of faces) {
    for (let x = x0; x <= x1; x++) {
      const tTop = Math.floor(hash2(x, 1, x0) * 4 + (x % 3 === 0 ? 2 : 0));
      const tBot = Math.floor(hash2(x, 2, x0) * 3 + (x % 4 === 1 ? 2 : 0));
      for (let y = 0; y < tTop; y++) p.px(x, 26 + y, y === tTop - 1 ? GLASS[3] : GLASS[1]);
      for (let y = 0; y < tBot; y++) p.px(x, 57 - y, y === tBot - 1 ? GLASS[2] : GLASS[1]);
    }
    for (let y = 26; y <= 57; y++) {
      if (hash2(x0, y, 7) < 0.55) p.px(x0, y, GLASS[1]);
      if (hash2(x1, y, 9) < 0.45) p.px(x1, y, GLASS[1]);
    }
  }
  // posts: lit from the left, magenta rim light on the edges facing the glow
  const posts: [number, number, number][] = [[16, 4, 3], [29, 3, 4], [56, 3, 3], [67, 4, 2]];
  for (const [x, w, shade] of posts) {
    for (let y = 23; y <= 60; y++) {
      for (let i = 0; i < w; i++) {
        let c = IRON[clamp(shade + (i === 0 ? 2 : i === w - 1 ? -1 : 0), 0, 6)];
        const facesGlow = (x < cx && i === w - 1) || (x > cx && i === 0);
        if (facesGlow && y > 30 && y < 52) c = Math.abs(y - ecy) < 7 ? VMAG[3] : VMAG[2];
        p.px(x + i, y, c);
      }
    }
    for (const y of [28, 41, 54]) {
      p.px(x + 1, y, IRON[6]);
      p.px(x + 1, y + 1, IRON[1]);
    }
  }
  // crossbars on the side faces
  // Pale chipped edges around the cage frame sharpen its silhouette.
  p.line(16, 25, 16, 31, IRON[6]);
  p.line(29, 48, 29, 55, GLASS[3]);
  p.line(68, 25, 68, 28, IRON[4]);
  for (const [x0, x1] of [[20, 28], [59, 66]] as const) {
    p.line(x0, 41, x1, 41, IRON[3]);
    p.line(x0, 42, x1, 42, IRON[1]);
  }
  // ---- domed cap
  for (let y = 9; y <= 23; y++) {
    const hw = capHalf(y);
    for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
      const dx = x + 0.5 - cx;
      if (Math.abs(dx) > hw) continue;
      const nx = dx / hw;
      const ny = -0.75 + ((y - 9) / 14) * 0.95;
      let idx = lum(nx, ny, IRON.length, x, y, false, 0.02);
      // ribs
      const rib = Math.abs(((Math.atan2(y - 30, dx) + TAU) % (TAU / 10)) - TAU / 20);
      if (rib < 0.045) idx = Math.min(6, idx + 2);
      else if (rib < 0.1) idx = Math.max(0, idx - 1);
      p.px(x, y, IRON[idx]);
    }
  }
  // glowing vents in the cap
  for (const vx of [27, 35.5, 44, 52.5, 61]) {
    const vy = 18;
    p.rect(vx - 1, vy - 1, 2, 3, OUT);
    p.px(vx - 1, vy, VMAG[2]);
    p.px(vx, vy, VMAG[3]);
    p.px(vx - 1, vy + 1, VMAG[3]);
    p.px(vx, vy + 1, VMAG[4]);
  }
  // rim band + rivets
  for (let x = 13; x <= 75; x++) {
    p.px(x, 22, IRON[5]);
    p.px(x, 23, IRON[3]);
    p.px(x, 24, IRON[2]);
    p.px(x, 25, VMAG[1]);
  }
  for (let x = 16; x <= 72; x += 7) {
    p.px(x, 23, IRON[6]);
    p.px(x + 1, 24, IRON[0]);
  }
  // curved horn spikes on the cap corners
  limb(p, 15, 22, 2.6, 9, 14, 0.6, IRON.slice(1));
  limb(p, 9, 14, 0.8, 10, 9, 0.4, IRON.slice(2));
  limb(p, 73, 22, 2.6, 79, 14, 0.6, IRON.slice(0, 5));
  limb(p, 79, 14, 0.8, 78, 9, 0.4, IRON.slice(1, 5));
  // finial on top of the cap
  p.poly([cx - 3, 10, cx, 6, cx + 3, 10], IRON[4]);
  p.px(cx - 1, 8, IRON[6]);
  // ---- base
  for (let y = 58; y <= 69; y++) {
    const hw = baseHalf(y);
    for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
      const dx = x + 0.5 - cx;
      if (Math.abs(dx) > hw) continue;
      const idx = lum(dx / hw, 0.1 + (y - 58) / 14, IRON.length, x, y, false, 0.05);
      p.px(x, y, IRON[idx]);
    }
  }
  for (let x = 15; x <= 73; x++) {
    p.px(x, 58, VMAG[1]);
    p.px(x, 59, IRON[5]);
    p.px(x, 60, IRON[3]);
  }
  for (let x = 20; x <= 68; x += 6) {
    p.px(x, 63, IRON[6]);
    p.px(x + 1, 64, IRON[0]);
  }
  // bottom finial + dripping void tar
  // Shackles and burial seals leave the eye aperture clear.
  for (const s of [-1, 1]) {
    const x = cx + s * 31;
    for (let i = 0; i < 4; i++) p.ring(x + s * Math.sin(i) * 2, 29 + i * 4, 2, 1, IRON[4]);
    p.poly([x - 3, 43, x + 3, 43, x + 4, 55, x + 1, 53, x - 2, 57], cracked ? '#65446f' : '#9c8290');
    p.line(x, 45, x + 1, 51, cracked ? VMAG[3] : '#443047');
    p.line(x - 1, 47, x + 2, 47, cracked ? VMAG[4] : '#443047');
  }
  p.poly([cx - 5, 69, cx, 77, cx + 5, 69], IRON[3]);
  p.line(cx - 2, 70, cx - 1, 74, IRON[5]);
  const drips: [number, number][] = [[24, 4], [33, 6], [54, 5], [63, 3]];
  for (const [x, l] of drips) {
    const len = l + ((k + x) % 3 === 0 ? 1 : 0) + (k % 2);
    const y0 = Math.floor(61 + (58 + 11 - 61) * (Math.abs(x - cx) / 29 < 0.6 ? 0.6 : 0.2));
    p.line(x, y0, x, y0 + len, SHADE[2]);
    p.px(x, y0 + len, VMAG[3]);
    p.px(x, y0 + len + 1, VMAG[2]);
  }
  if (cracked || strain > 0) {
    // glowing fissures through the iron
    const col = strain > 0.5 ? '#ffffff' : VMAG[3];
    crack(p, 24, 12, 33, 21, col, 2, 1.1);
    crack(p, 62, 13, 54, 21, col, 5, 1.1);
    crack(p, 17, 44, 17, 58, col, 7, 0.8);
    crack(p, 69, 28, 69, 46, col, 9, 0.8);
    crack(p, 30, 61, 38, 68, col, 11, 1);
    crack(p, 60, 61, 52, 67, col, 13, 1);
    if (strain > 0.3) {
      crack(p, 44, 10, 40, 21, col, 15, 1.2);
      crack(p, 30, 28, 30, 52, col, 17, 1);
      crack(p, 57, 26, 57, 50, col, 19, 1);
    }
  }
}

// ------------------------------------------------------------------ eye
export type EyeState = 'open' | 'half' | 'closed' | 'wide';
const EYE_W = 30;
const EYE_H = 22;

function scleraRy(state: EyeState): number {
  return state === 'wide' ? 9 : state === 'open' ? 7 : state === 'half' ? 3.5 : 0;
}

/** Paint the eye with the iris offset (ix, iy) inside an almond sclera. */
export function paintEye(p: PixelPainter, state: EyeState, ix: number, iy: number, rage = false): void {
  const cx = EYE_W / 2;
  const cy = EYE_H / 2;
  const rx = state === 'wide' ? 13 : 12;
  const ry = scleraRy(state);
  // lids (shadow flesh) around the opening
  const lidRy = Math.max(ry + 2.5, 4);
  for (let y = 0; y < EYE_H; y++) {
    for (let x = 0; x < EYE_W; x++) {
      const nx = (x + 0.5 - cx) / (rx + 2.5);
      const ny = (y + 0.5 - cy) / lidRy;
      const almond = Math.abs(ny) + nx * nx * 0.85;
      if (almond > 1) continue;
      p.px(x, y, SHADE[lum(nx, ny, 5, x, y, true, 0.1) + 1]);
    }
  }
  if (state === 'closed') {
    p.line(cx - rx, cy, cx + rx, cy, OUT);
    p.line(cx - rx + 2, cy + 1, cx + rx - 2, cy + 1, VMAG[2]);
    for (let i = -2; i <= 2; i++) p.line(cx + i * 4, cy + 1, cx + i * 4 + i * 0.5, cy + 3, SHADE[4]);
    return;
  }
  // sclera (almond)
  const inSclera = (x: number, y: number) => {
    const nx = (x + 0.5 - cx) / rx;
    const ny = (y + 0.5 - cy) / ry;
    return Math.abs(ny) + nx * nx * 0.9 <= 1;
  };
  for (let y = 0; y < EYE_H; y++) {
    for (let x = 0; x < EYE_W; x++) {
      if (!inSclera(x, y)) continue;
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      // shadowed under the upper lid
      let idx = 3 - (ny < -0.45 ? 2 : ny < -0.1 ? 1 : 0) - (Math.abs(nx) > 0.75 ? 1 : 0);
      if (rage && hash2(x, y, 3) < 0.12) idx = 0;
      p.px(x, y, SCLERA[clamp(idx, 0, 3)]);
    }
  }
  // veins
  for (const [x0, y0, x1, y1] of [[2, cy, 7, cy - 1], [3, cy + 1, 7, cy + 2], [EYE_W - 3, cy, EYE_W - 8, cy + 1], [EYE_W - 4, cy - 1, EYE_W - 8, cy - 2]] as const) {
    for (let t = 0; t <= 1; t += 0.2) {
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      if (inSclera(x, y)) p.px(x, y, rage ? VMAG[3] : VMAG[2]);
    }
  }
  // iris + pupil, clipped to the sclera
  const icx = cx + ix;
  const icy = cy + iy;
  const ir = state === 'wide' ? 5 : 5.5;
  for (let y = 0; y < EYE_H; y++) {
    for (let x = 0; x < EYE_W; x++) {
      if (!inSclera(x, y)) continue;
      const dx = x + 0.5 - icx;
      const dy = y + 0.5 - icy;
      const d = Math.hypot(dx, dy);
      if (d > ir) continue;
      let c = d > ir - 1 ? VMAG[1] : d > ir * 0.55 ? VMAG[3] : VMAG[2];
      if (dx < -1 && dy < -1 && d > ir * 0.4) c = VMAG[4];
      // slit pupil (thin when wide: the eye is focused)
      const pw = state === 'wide' ? 0.6 : 1.2;
      if (Math.abs(dx) < pw && Math.abs(dy) < ir * 0.85) c = OUT;
      p.px(x, y, c);
    }
  }
  // glint
  if (inSclera(Math.round(icx - 2), Math.round(icy - 2))) p.px(Math.round(icx - 2), Math.round(icy - 2), '#ffffff');
  // lash tendrils on the upper lid
  for (let i = -3; i <= 3; i++) {
    const x = cx + i * 3.5;
    const y = cy - ry - 1.5 + Math.abs(i) * 0.4;
    p.line(x, y, x + i * 0.6, y - 2, SHADE[1]);
  }
}

/** Quantized iris offsets used by the eye sprites. */
export const IRIS_X = [-4, -2, 0, 2, 4];
export const IRIS_Y = [-1, 0, 1];

/** Name of the eye sprite for a state and an iris offset (lazily defined). */
export function eyeSprite(state: EyeState, ix: number, iy: number, rage = false): string {
  const qx = IRIS_X.reduce((a, b) => (Math.abs(b - ix) < Math.abs(a - ix) ? b : a));
  const qy = state === 'half' ? 0 : IRIS_Y.reduce((a, b) => (Math.abs(b - iy) < Math.abs(a - iy) ? b : a));
  const name = `mmy_eye_${state}_${qx}_${qy}${rage ? '_r' : ''}`;
  if (!hasSprite(name)) defineDrawnSprite(name, EYE_W, EYE_H, (p) => paintEye(p, state, state === 'closed' ? 0 : qx, qy, rage), { outline: OUT });
  return name;
}

// ------------------------------------------------------------------ hands
export type HandPose = 'open' | 'fist' | 'claw';
const HAND_W = 34;
const HAND_H = 32;

function paintClaw(p: PixelPainter, x: number, y: number, a: number, len: number): void {
  const tx = x + Math.cos(a) * len;
  const ty = y + Math.sin(a) * len;
  limb(p, x, y, 1.1, tx, ty, 0.3, [VMAG[2], VMAG[3], VMAG[4]]);
  p.px(tx, ty, VMAG[5]);
}

/** A right shadow hand, palm down, fingers pointing down (wrist at the top). */
export function paintHand(p: PixelPainter, pose: HandPose, k: number): void {
  const cx = 17;
  const sway = [0, 0.6, 0, -0.6][k % 4];
  // smoky wrist dissolving upward
  limb(p, cx + 1, 0, 3.5, cx, 11, 5.5, SHADE.slice(0, 4), true);
  for (let i = 0; i < 4; i++) {
    const x = cx - 3 + i * 2 + sway;
    for (let y = 0; y < 5; y++) if (bayer(x, y) < 0.5 - y * 0.1) p.px(x, y, null);
  }
  if (pose === 'fist') {
    ball(p, cx, 17, 9, 8, SHADE.slice(1), true);
    // knuckles in a row, glowing claw tips folded under
    for (let i = 0; i < 4; i++) {
      const x = cx - 6 + i * 4;
      ball(p, x, 23, 2.4, 2.2, SHADE.slice(2), false);
      p.px(x, 25, VMAG[3]);
    }
    limb(p, cx - 9, 15, 2.6, cx - 7, 21, 2.2, SHADE.slice(1, 5));
    return;
  }
  // palm
  ball(p, cx, 14, 8.5, 7.5, SHADE.slice(1), true);
  const curl = pose === 'claw' ? 0.55 : 0;
  // four fingers (index .. little), spreading downward
  const fingers: [number, number, number][] = [[-6, 2.1, 11], [-2, 1.75, 13], [2.5, 1.6, 12], [6.5, 1.35, 10]];
  for (const [ox, a0, len] of fingers) {
    const bx = cx + ox;
    const by = 19;
    const a = a0 - curl * (ox > 0 ? -0.3 : 0.3) + sway * 0.04;
    const midx = bx + Math.cos(a) * len * 0.55;
    const midy = by + Math.sin(a) * len * 0.55;
    const a2 = a + (pose === 'claw' ? (ox < 0 ? 0.7 : -0.7) : 0.1 * Math.sign(ox));
    const l2 = len * (pose === 'claw' ? 0.35 : 0.45);
    const tipx = midx + Math.cos(a2) * l2;
    const tipy = midy + Math.sin(a2) * l2;
    limb(p, bx, by, 2.2, midx, midy, 1.8, SHADE.slice(1, 6));
    limb(p, midx, midy, 1.8, tipx, tipy, 1.3, SHADE.slice(1, 6));
    paintClaw(p, tipx, tipy, a2, 3.2);
  }
  // thumb (on the left for a right hand seen from above)
  limb(p, cx - 7, 12, 2.4, cx - 12, 18, 1.8, SHADE.slice(1, 6));
  paintClaw(p, cx - 12, 18, 2.4, 2.6);
  // glowing sigil on the back of the hand
  p.px(cx, 13, VMAG[3]);
  p.px(cx - 1, 14, VMAG[2]);
  p.px(cx + 1, 14, VMAG[2]);
  p.px(cx, 15, VMAG[3]);
}

// ------------------------------------------------------------------ black sun core
export const CORE_SIZE = 84;

export function paintCore(p: PixelPainter, k: number, pulse = 0): void {
  const c = CORE_SIZE / 2;
  const R = 19 + pulse;
  // corona: flame tongues radiating out of the black disc
  for (let y = 0; y < CORE_SIZE; y++) {
    for (let x = 0; x < CORE_SIZE; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.hypot(dx, dy);
      if (d < R || d > R + 22) continue;
      const a = Math.atan2(dy, dx);
      const n = Math.sin(a * 7 + k * 1.6) * 0.5 + Math.sin(a * 13 - k * 2.3) * 0.3 + Math.sin(a * 3 + k) * 0.2;
      const len = 9 + n * 7 + (hash2(Math.round(a * 20), k) - 0.5) * 3;
      const t = (d - R) / Math.max(1, len);
      if (t > 1) continue;
      const f = (1 - t) * 4 + (bayer(x, y) - 0.5) * 0.8;
      const col = f > 3.3 ? VMAG[5] : f > 2.5 ? VMAG[4] : f > 1.7 ? VMAG[3] : f > 0.9 ? VMAG[2] : '#4a1a7a';
      p.px(x, y, col);
    }
  }
  // the black disc with a burning rim
  p.circle(c, c, R, '#020104');
  p.ring(c, c, R, 1.5, '#ffffff');
  p.ring(c, c, R - 1.5, 1.2, VMAG[3]);
  // faint inner swirl
  for (let i = 0; i < 3; i++) {
    const a0 = k * 0.4 + (i / 3) * TAU;
    for (let t = 0; t < 1; t += 0.05) {
      const a = a0 + t * 2.4;
      const r = R * (0.85 - t * 0.6);
      p.px(c + Math.cos(a) * r, c + Math.sin(a) * r, t < 0.5 ? '#2a0a3a' : '#160620');
    }
  }
}

// ------------------------------------------------------------------ small parts
function paintShard(p: PixelPainter, v: number): void {
  // broken piece of the cage: an iron bar with a pane of glass
  const shapes = [
    [1, 2, 9, 0, 11, 9, 4, 13],
    [0, 4, 7, 0, 12, 6, 6, 12],
    [2, 0, 10, 3, 9, 13, 0, 10],
    [0, 1, 12, 2, 8, 12, 3, 9],
  ];
  p.poly(shapes[v % 4], GLASS[1]);
  p.line(shapes[v % 4][0], shapes[v % 4][1], shapes[v % 4][2], shapes[v % 4][3], GLASS[3]);
  p.line(2 + v, 0, 4 + v, 13, IRON[3]);
  p.line(3 + v, 0, 5 + v, 13, IRON[4]);
  p.px(3 + v, 4, IRON[5]);
}

function paintCrown(p: PixelPainter): void {
  // ring of black thorns (behind the lantern in phase 2)
  const c = 55;
  p.ring(c, c, 44, 3, SHADE[2]);
  p.ring(c, c, 43, 1, SHADE[4]);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    const long = i % 2 === 0;
    const r0 = 44;
    const r1 = long ? 55 : 50;
    const x0 = c + Math.cos(a) * r0;
    const y0 = c + Math.sin(a) * r0;
    const x1 = c + Math.cos(a + 0.08) * r1;
    const y1 = c + Math.sin(a + 0.08) * r1;
    limb(p, x0, y0, long ? 2.6 : 2, x1, y1, 0.4, SHADE.slice(1, 5));
    if (long) p.px(x1, y1, VMAG[3]);
  }
}

function paintBrazier(p: PixelPainter, lit: boolean): void {
  // tripod stand + iron bowl (fire is drawn separately)
  limb(p, 7, 10, 1, 3, 19, 0.8, IRON.slice(2));
  limb(p, 9, 10, 1, 13, 19, 0.8, IRON.slice(1));
  limb(p, 8, 10, 1, 8, 19, 0.8, IRON.slice(2));
  p.poly([1, 6, 15, 6, 13, 11, 3, 11], IRON[3]);
  p.line(1, 6, 15, 6, IRON[5]);
  p.line(3, 11, 13, 11, IRON[1]);
  p.px(4, 8, IRON[5]);
  p.px(12, 8, IRON[4]);
  // coals
  p.line(3, 5, 13, 5, lit ? EMBER[2] : '#2a2430');
  p.px(5, 4, lit ? EMBER[3] : '#3a3440');
  p.px(9, 4, lit ? EMBER[3] : '#3a3440');
  p.px(11, 5, lit ? EMBER[4] : '#4a4450');
}

function paintFlame(p: PixelPainter, k: number, big: boolean): void {
  const h = big ? 16 : 12;
  const w = 12;
  const base = h + 1;
  const sway = [0, 1, 0, -1][k % 4];
  p.poly([1, base, w - 1, base, w - 3 + sway * 0.5, base - h * 0.5, w / 2 + sway, 1, 3 + sway * 0.5, base - h * 0.55], EMBER[1]);
  p.poly([2.5, base, w - 2.5, base, w - 4 + sway * 0.4, base - h * 0.45, w / 2 + sway * 0.8, 4, 4 + sway * 0.3, base - h * 0.5], EMBER[2]);
  p.poly([4, base, w - 4, base, w / 2 + sway * 0.5, base - h * 0.55], EMBER[3]);
  p.poly([5, base, w - 5, base, w / 2, base - h * 0.3], EMBER[4]);
}

function paintMoth(p: PixelPainter, k: number): void {
  // wings (up / mid / down)
  const up = [-3, 0, 3][k % 3];
  const W2 = 18;
  const cx = W2 / 2;
  for (const s of [-1, 1]) {
    const wx = cx + s * 1.5;
    p.poly([wx, 6, wx + s * 8, 2 + up, wx + s * 9, 7 + up * 0.5, wx + s * 6, 11, wx, 9], SHADE[3]);
    p.poly([wx, 7, wx + s * 7, 3.5 + up, wx + s * 7.5, 7 + up * 0.5, wx + s * 4, 9], SHADE[4]);
    // eye spot + pale edge
    p.px(wx + s * 5, 6 + up * 0.5, VMAG[3]);
    p.px(wx + s * 5, 5 + up * 0.5, VMAG[5]);
    p.line(wx + s * 8, 2 + up, wx + s * 9, 7 + up * 0.5, GLASS[3]);
  }
  // body + feathery antennae
  ball(p, cx, 7.5, 1.7, 4, SHADE.slice(0, 4), false);
  p.line(cx - 1, 3.5, cx - 3, 0, SHADE[4]);
  p.line(cx + 1, 3.5, cx + 3, 0, SHADE[4]);
  p.px(cx - 1, 5, VMAG[4]);
  p.px(cx + 1, 5, VMAG[4]);
}

// ------------------------------------------------------------------ registration
let ready = false;
/** Define every final-boss sprite (idempotent; called at module load of the boss). */
export function defineFinalArt(): void {
  if (ready) return;
  ready = true;
  const body: string[] = [];
  const body2: string[] = [];
  for (let i = 0; i < 4; i++) {
    body.push(defineDrawnSprite(`mmy_body_${i}`, BODY_W, BODY_H, (p) => paintLantern(p, i, false), { outline: OUT, origin: BODY_ORIGIN }));
    body2.push(defineDrawnSprite(`mmy_body2_${i}`, BODY_W, BODY_H, (p) => paintLantern(p, i, true), { outline: OUT, origin: BODY_ORIGIN }));
  }
  defineAnim('mmy_body', body, 4, true);
  defineAnim('mmy_body2', body2, 4, true);
  for (let i = 0; i < 3; i++) {
    defineDrawnSprite(`mmy_strain_${i}`, BODY_W, BODY_H, (p) => paintLantern(p, i, true, 0.3 + i * 0.3), { outline: OUT, origin: BODY_ORIGIN });
  }
  for (const pose of ['open', 'fist', 'claw'] as HandPose[]) {
    const fr: string[] = [];
    for (let i = 0; i < 4; i++) fr.push(defineDrawnSprite(`mmy_hand_${pose}_${i}`, HAND_W, HAND_H, (p) => paintHand(p, pose, i), { outline: OUT, origin: [17, 12] }));
    defineAnim(`mmy_hand_${pose}`, fr, 6, true);
  }
  const core: string[] = [];
  for (let i = 0; i < 6; i++) core.push(defineDrawnSprite(`mmy_core_${i}`, CORE_SIZE, CORE_SIZE, (p) => paintCore(p, i), { origin: [CORE_SIZE / 2, CORE_SIZE / 2] }));
  defineAnim('mmy_core', core, 8, true);
  for (let i = 0; i < 4; i++) defineDrawnSprite(`mmy_shard_${i}`, 13, 14, (p) => paintShard(p, i), { outline: OUT });
  defineDrawnSprite('mmy_crown', 111, 111, (p) => paintCrown(p), { outline: OUT });
  defineDrawnSprite('mmy_link_a', 5, 7, (p) => {
    p.ring(2.5, 3.5, 2.5, 1, IRON[3]);
    p.px(1, 1, IRON[5]);
  }, { outline: OUT });
  defineDrawnSprite('mmy_link_b', 3, 7, (p) => {
    p.rect(1, 0, 1, 7, IRON[4]);
    p.px(1, 0, IRON[5]);
  }, { outline: OUT });
  defineDrawnSprite('mmy_seg', 7, 7, (p) => {
    ball(p, 3.5, 3.5, 3.4, 3.4, SHADE.slice(0, 5), false);
    p.px(2, 2, SHADE[5]);
  }, { outline: OUT });
  defineDrawnSprite('mmy_seg_tip', 5, 7, (p) => {
    p.poly([0, 0, 5, 0, 2.5, 7], SHADE[3]);
    p.px(2, 5, VMAG[3]);
    p.px(2, 6, VMAG[4]);
  }, { outline: OUT });
  defineDrawnSprite('mmy_brazier', 16, 20, (p) => paintBrazier(p, true), { outline: OUT, anchor: 'bottom' });
  defineDrawnSprite('mmy_brazier_off', 16, 20, (p) => paintBrazier(p, false), { outline: OUT, anchor: 'bottom' });
  const fl: string[] = [];
  for (let i = 0; i < 4; i++) fl.push(defineDrawnSprite(`mmy_flame_${i}`, 12, 18, (p) => paintFlame(p, i, true), { anchor: 'bottom' }));
  defineAnim('mmy_flame', fl, 10, true);
  const moth: string[] = [];
  for (let i = 0; i < 3; i++) moth.push(defineDrawnSprite(`vmoth_fly_${i}`, 18, 13, (p) => paintMoth(p, i), { outline: OUT }));
  defineAnim('vmoth_fly', [...moth, moth[1]], 16, true);
  defineDrawnSprite('mmy_star', 9, 9, (p) => {
    p.circle(4.5, 4.5, 4, VMAG[2]);
    p.circle(4, 4, 2.6, VMAG[3]);
    p.circle(3.6, 3.6, 1.3, VMAG[5]);
    p.px(2, 2, '#ffffff');
  }, { outline: OUT });
  // pre-define the common eye sprites
  for (const st of ['open', 'wide', 'half', 'closed'] as EyeState[]) eyeSprite(st, 0, 0);

  // portrait: the lantern, eye wide open, both hands raised beside it, chains above
  defineDrawnSprite('mmy_portrait', 132, 112, (p) => {
    const ox = 22;
    const oy = 22;
    for (let y = 0; y < oy + 6; y += 6) {
      p.ring(66, y + 3, 2.4, 1, IRON[3]);
      p.px(65, y + 1, IRON[5]);
    }
    const crown = new PixelPainter(111, 111);
    paintCrown(crown);
    p.blit(crown, 66 - 55, oy + 40 - 55);
    const lan = new PixelPainter(BODY_W, BODY_H);
    paintLantern(lan, 1, true);
    p.blit(lan, ox, oy);
    const eye = new PixelPainter(EYE_W, EYE_H);
    paintEye(eye, 'wide', 0, 1, false);
    eye.outline(OUT);
    p.blit(eye, ox + BODY_ORIGIN[0] - EYE_W / 2, oy + BODY_ORIGIN[1] - EYE_H / 2);
    const hand = new PixelPainter(HAND_W, HAND_H);
    paintHand(hand, 'claw', 1);
    hand.outline(OUT);
    p.blit(hand, 0, 58, true);
    p.blit(hand, 132 - HAND_W, 58);
    // tendrils hanging from the base
    for (const [x, len] of [[52, 14], [66, 18], [80, 13]] as const) {
      for (let i = 0; i < len; i += 2) {
        const sx = x + Math.sin(i * 0.5 + x) * 2;
        p.circle(sx, oy + 70 + i, 2.6 - i * 0.1, SHADE[2]);
        p.px(sx - 1, oy + 69 + i, SHADE[4]);
      }
      p.px(x, oy + 70 + len, VMAG[3]);
    }
  }, { outline: OUT });
}

defineFinalArt();
