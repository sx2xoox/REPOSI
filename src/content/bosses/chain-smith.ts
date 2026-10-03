// Floor 3 boss: 사슬 대장장이 (the chain smith) — 식지 않는 모루.
// A towering iron automaton in a scorched leather apron: a furnace burns in its
// grated belly, a war hammer in one fist, a hooked chain wound round the other.
// Phase 1: anvil strike (hammer slam -> fire lines along the floor), hook throw
// (lane-telegraphed, embeds in the wall), molten slag lobs that leave fire,
// bellows vent (rings of molten shot with gaps).
// Phase 2 (≤50%): it overheats — red-hot plates; chain cyclone (two rotating
// chains), the hook drags it across the room, eight fire lines, fire imps.

import { defineBoss } from '../../game/defs';
import { PixelPainter, bayer } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { clamp, distToSegment, TAU } from '../../engine/math';
import { Entity } from '../../game/entity';
import { GroundWarning, RingFx } from '../../game/effects';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { Script } from '../../engine/script';
import { bullet, BUL, dust, frames, gather, Hazard, landingSpot, lob, rayFree, spotAround, volleyTargets } from '../enemies/shared';
import {
  ball, bossDeathBurst, crack, dissolveMinions, eruptLine, faceTarget, hitPlayerCircle, insideRoom, laneWarning, limb, minionCount,
  OUTLINE, phaseShift, pickPattern, shootGapRing, Shockwave, summonMinion, WARN_RED,
  clearArena,
} from './kit13';

// ------------------------------------------------------------------ palette
const IRON = ['#121018', '#26222c', '#403a46', '#625a66', '#8a8090', '#b0a6b0'];
const HOT = ['#3a0a06', '#7a1a0a', '#b8340e', '#e8641a', '#ffa040', '#ffe0a0'];
const LEATHER = ['#22120a', '#3e2212', '#5e361c', '#7e4c2a', '#9a6438'];
const FIRE = ['#8a1a06', '#d84a0e', '#ffa424', '#fff0a0', '#ffffff'];
const CHAIN = ['#2a2630', '#5a5462', '#8a8292'];

const W = 70;
const H = 86;
const CX = 35;
/** extra headroom above the body for the raised hammer */
const OY = 14;
const ORIGIN: [number, number] = [35, 60];

type V = [number, number];
interface SmithPose {
  /** hammer hand + hammer angle (direction from hand to head) */
  rh: V;
  ham: number;
  /** chain hand */
  lh: V;
  /** hook dangling from the chain hand (false = thrown) */
  hook?: boolean;
  /** legs: step offset -1..1 */
  step?: number;
  /** body vertical offset (bob / crouch) */
  body?: number;
  /** head offset */
  head?: V;
  /** furnace intensity 0..2 */
  fire?: number;
  /** belly grate swung open */
  open?: boolean;
  visor?: 'glow' | 'flare';
}

// ------------------------------------------------------------------ painting
function plateCol(ramp: readonly string[], lum: number, x: number, y: number): string {
  return ramp[clamp(Math.floor(lum * ramp.length + (bayer(x, y) - 0.5) * 0.55), 0, ramp.length - 1)];
}

function paintHammer(p: PixelPainter, hx: number, hy: number, a: number, hot: boolean): void {
  const len = 22;
  const ex = hx + Math.cos(a) * len;
  const ey = hy + Math.sin(a) * len;
  // haft (wood wrapped in iron bands)
  limb(p, hx - Math.cos(a) * 4, hy - Math.sin(a) * 4, 1.6, ex, ey, 1.6, LEATHER.slice(1));
  for (const t of [0.25, 0.55, 0.85]) p.px(hx + Math.cos(a) * len * t, hy + Math.sin(a) * len * t, IRON[4]);
  // head: a heavy sledge perpendicular to the haft
  const px = -Math.sin(a);
  const py = Math.cos(a);
  const hw = 10;
  const hd = 6;
  const corners = [
    [ex - px * hw - Math.cos(a) * hd * 0.3, ey - py * hw - Math.sin(a) * hd * 0.3],
    [ex + px * hw - Math.cos(a) * hd * 0.3, ey + py * hw - Math.sin(a) * hd * 0.3],
    [ex + px * hw + Math.cos(a) * hd, ey + py * hw + Math.sin(a) * hd],
    [ex - px * hw + Math.cos(a) * hd, ey - py * hw + Math.sin(a) * hd],
  ];
  p.poly(corners.flat(), IRON[3]);
  const bx0 = Math.floor(ex - 14);
  const by0 = Math.floor(ey - 14);
  for (let y = by0; y < by0 + 29; y++) {
    for (let x = bx0; x < bx0 + 29; x++) {
      if (!p.isSet(x, y)) continue;
      const u = (x + 0.5 - ex) * px + (y + 0.5 - ey) * py; // along the head
      const v = (x + 0.5 - ex) * Math.cos(a) + (y + 0.5 - ey) * Math.sin(a); // along the haft
      if (Math.abs(u) > hw + 0.6 || v < -hd * 0.3 - 0.6 || v > hd + 0.6) continue;
      // bevelled block lit from the upper left
      const edge = Math.max(Math.abs(u) / hw, Math.abs(v - hd * 0.35) / (hd * 0.65));
      const lum = 0.62 - (u / hw) * 0.22 * Math.sign(px || 1) - edge * 0.25 + (edge > 0.85 ? 0.12 : 0);
      // the striking faces glow
      const face = Math.abs(u) > hw - 2.2;
      p.px(x, y, face && hot ? plateCol(HOT.slice(2), lum + 0.2, x, y) : face ? plateCol(IRON.slice(2), lum + 0.1, x, y) : plateCol(IRON.slice(1), lum, x, y));
    }
  }
  // bands + rivets
  p.line(ex + px * 4, ey + py * 4, ex + px * 4 + Math.cos(a) * hd, ey + py * 4 + Math.sin(a) * hd, IRON[1]);
  p.line(ex - px * 4, ey - py * 4, ex - px * 4 + Math.cos(a) * hd, ey - py * 4 + Math.sin(a) * hd, IRON[1]);
  p.px(ex + px * 6 + Math.cos(a) * 2, ey + py * 6 + Math.sin(a) * 2, IRON[5]);
  p.px(ex - px * 6 + Math.cos(a) * 2, ey - py * 6 + Math.sin(a) * 2, IRON[5]);
}

function paintChainLine(p: PixelPainter, x0: number, y0: number, x1: number, y1: number): void {
  const l = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.floor(l / 2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    p.px(x, y, i % 2 ? CHAIN[1] : CHAIN[2]);
    if (i % 2 === 0) p.px(x + 1, y, CHAIN[0]);
  }
}

function paintHook(p: PixelPainter, x: number, y: number): void {
  limb(p, x, y - 2, 1.2, x, y + 3, 1.2, IRON.slice(2));
  p.ring(x + 2.5, y + 3, 3, 1.4, IRON[4]);
  p.rect(x, y - 1, 5, 6, null as unknown as string);
  limb(p, x + 5, y + 3, 1.2, x + 5, y - 1, 0.5, IRON.slice(2));
  p.px(x + 5, y - 1, '#ffffff');
}

function arm(p: PixelPainter, sh: V, el: V, hand: V): void {
  // dark rim first so the limb separates from the body
  limb(p, sh[0], sh[1], 4.4, el[0], el[1], 4, [IRON[0]]);
  limb(p, el[0], el[1], 4, hand[0], hand[1], 4.2, [IRON[0]]);
  limb(p, sh[0], sh[1], 3.4, el[0], el[1], 3, IRON.slice(1));
  ball(p, el[0], el[1], 3, 3, IRON.slice(1), false);
  limb(p, el[0], el[1], 3, hand[0], hand[1], 3.2, IRON.slice(1));
}

function paintSmith(p: PixelPainter, o: SmithPose, p2: boolean): void {
  const body = o.body ?? 0;
  const B = body + OY;
  const step = o.step ?? 0;
  const head = o.head ?? [0, 0];
  const rh: V = [o.rh[0], o.rh[1] + OY];
  const lh: V = [o.lh[0], o.lh[1] + OY];
  // --- legs + boots
  for (const s of [-1, 1]) {
    const lift = s * step;
    const hipX = CX + s * 6;
    const hipY = 50 + B;
    const footX = CX + s * 8 + lift;
    const footY = 66 + OY - Math.max(0, lift) * 3;
    limb(p, hipX, hipY, 4.6, footX, footY - 3, 4, [IRON[0]]);
    limb(p, hipX, hipY, 3.8, footX, footY - 3, 3.4, IRON.slice(1));
    ball(p, footX + s, footY, 5.4, 3, IRON.slice(0, 4), false);
    p.line(footX - 4 + s, footY + 2, footX + 5 + s, footY + 2, IRON[0]);
  }
  // --- chain arm geometry + dangling chain/hook (behind the apron)
  const lsh: V = [CX - 15, 27 + B];
  const lel: V = [(lsh[0] + lh[0]) / 2 - 4, (lsh[1] + lh[1]) / 2 + 1];
  if (o.hook !== false) {
    paintChainLine(p, lh[0], lh[1] + 2, lh[0] - 2, 63 + OY);
    paintHook(p, lh[0] - 3, 63 + OY);
  }
  // --- torso: barrel chest of riveted plates
  const ty = 34 + B;
  p.ellipse(CX, ty, 14, 12, IRON[2]);
  for (let y = ty - 13; y <= ty + 13; y++) {
    for (let x = CX - 15; x <= CX + 15; x++) {
      if (!p.isSet(x, y)) continue;
      const nx = (x + 0.5 - CX) / 14;
      const ny = (y + 0.5 - ty) / 12;
      if (nx * nx + ny * ny > 1.02) continue;
      const lum = 0.62 - nx * 0.35 - ny * 0.28 - (nx * nx + ny * ny) * 0.22;
      p.px(x, y, plateCol(IRON.slice(1), lum, x, y));
    }
  }
  // plate seams + rivets (seams glow when overheated)
  const seam = p2 ? HOT[3] : IRON[0];
  p.line(CX - 13, ty - 4, CX + 13, ty - 4, seam);
  p.line(CX, ty - 12, CX, ty - 4, seam);
  p.line(CX - 9, ty - 11, CX - 12, ty - 4, seam);
  p.line(CX + 9, ty - 11, CX + 12, ty - 4, seam);
  for (const [rx, ry] of [[-10, -6], [-4, -9], [4, -9], [10, -6], [-12, -2], [12, -2]]) p.px(CX + rx, ty + ry, IRON[5]);
  // furnace grate in the belly
  const gx = CX - 6;
  const gy = ty - 2;
  const f = o.fire ?? 1;
  p.rect(gx - 1, gy - 1, 14, 11, IRON[0]);
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 12; x++) {
      const heat = 1 - y / 12 + (bayer(gx + x, gy + y) - 0.5) * 0.4 + f * 0.12 + (p2 ? 0.15 : 0);
      p.px(gx + x, gy + y, FIRE[clamp(Math.floor(heat * 3.2), 0, o.open ? 4 : 3)]);
    }
  }
  if (!o.open) {
    for (let x = 1; x < 12; x += 3) p.rect(gx + x, gy, 1, 9, IRON[1]);
    p.rect(gx, gy + 4, 12, 1, IRON[1]);
  } else {
    p.rect(gx + 13, gy - 1, 3, 11, IRON[3]);
    p.rect(gx + 14, gy, 1, 9, IRON[1]);
    p.rect(gx + 3, gy + 2, 6, 4, FIRE[4]);
  }
  // --- leather apron over the lower body
  const ab = 58 + OY + body * 0.5;
  p.poly([CX - 11, ty + 6, CX + 11, ty + 6, CX + 13, ab, CX - 13, ab], LEATHER[2]);
  for (let y = ty + 6; y <= ab; y++) {
    for (let x = CX - 13; x <= CX + 13; x++) {
      if (!p.isSet(x, y)) continue;
      const nx = (x - CX) / 13;
      const lum = 0.6 - nx * 0.35 + Math.sin(x * 0.9) * 0.08 - (y - ty) / 80;
      p.px(x, y, plateCol(LEATHER, lum, x, y));
    }
  }
  p.line(CX - 11, ty + 6, CX + 11, ty + 6, LEATHER[0]);
  p.line(CX - 13, ab, CX + 13, ab, LEATHER[0]);
  p.ellipse(CX + 5, ab - 5, 2.5, 1.5, LEATHER[0]);
  p.px(CX - 6, ab - 8, '#1a0c06');
  p.px(CX - 5, ab - 7, '#1a0c06');
  if (p2) {
    p.ellipse(CX - 4, ab - 3, 3, 1.6, '#1a0806');
    p.px(CX - 4, ab - 3, HOT[4]);
    p.px(CX + 6, ab - 2, HOT[3]);
  }
  // diagonal chain across the chest
  paintChainLine(p, CX - 13, ty - 9, CX + 12, ty + 7);
  // --- shoulders (pauldrons)
  const rsh: V = [CX + 15, 27 + B];
  ball(p, lsh[0], lsh[1], 7, 6, IRON.slice(0, 5), false);
  ball(p, rsh[0], rsh[1], 7, 6, IRON.slice(0, 5), false);
  p.line(lsh[0] - 5, lsh[1] + 2, lsh[0] + 4, lsh[1] + 3, p2 ? HOT[3] : IRON[0]);
  p.line(rsh[0] - 4, rsh[1] + 3, rsh[0] + 5, rsh[1] + 2, p2 ? HOT[3] : IRON[0]);
  p.px(lsh[0] - 2, lsh[1] - 3, IRON[5]);
  p.px(rsh[0] - 2, rsh[1] - 3, IRON[5]);
  // --- chain arm (wrapped forearm)
  arm(p, [lsh[0], lsh[1] + 3], lel, lh);
  for (let i = 0; i < 4; i++) {
    const t = 0.15 + i * 0.22;
    const x = lel[0] + (lh[0] - lel[0]) * t;
    const y = lel[1] + (lh[1] - lel[1]) * t;
    p.line(x - 3, y - 1, x + 3, y + 1, CHAIN[2]);
  }
  ball(p, lh[0], lh[1], 3.6, 3.2, IRON.slice(1), false);
  // --- head: bucket helm with a T-visor and a little smokestack
  const hx = CX + head[0];
  const hy = 15 + B + head[1];
  limb(p, hx + 6, hy - 6, 1.6, hx + 7, hy - 12, 1.8, IRON.slice(1));
  p.rect(hx + 5, hy - 13, 5, 2, IRON[1]);
  p.rect(hx - 7, hy - 7, 14, 14, IRON[2]);
  for (let y = hy - 7; y < hy + 7; y++) {
    for (let x = hx - 7; x < hx + 7; x++) {
      const lum = 0.64 - ((x - hx) / 9) * 0.38 - (y - hy) / 20;
      p.px(x, y, plateCol(IRON.slice(1), lum, x, y));
    }
  }
  p.rect(hx - 8, hy - 8, 16, 2, IRON[3]);
  p.rect(hx - 8, hy - 8, 16, 1, IRON[4]);
  p.rect(hx - 8, hy + 6, 16, 1, IRON[1]);
  // Riveted cheek plates and a bevel across the brow.
  p.line(hx - 6, hy - 5, hx - 3, hy - 5, IRON[5]);
  p.line(hx + 4, hy - 5, hx + 4, hy + 4, IRON[1]);
  for (const dy of [-5, 3]) {
    p.px(hx - 6, hy + dy, IRON[5]);
    p.px(hx + 5, hy + dy, IRON[4]);
  }
  // T visor
  const flare = o.visor === 'flare' || p2;
  p.rect(hx - 5, hy - 2, 10, 2, '#0a0606');
  p.rect(hx - 1, hy, 2, 5, '#0a0606');
  p.rect(hx - 4, hy - 2, 8, 1, flare ? FIRE[3] : FIRE[2]);
  p.rect(hx - 1, hy, 1, 4, flare ? FIRE[2] : FIRE[1]);
  p.px(hx - 3, hy - 2, '#ffffff');
  if (p2) p.px(hx + 2, hy - 2, '#ffffff');
  p.px(hx - 6, hy + 4, IRON[5]);
  p.px(hx + 5, hy + 4, IRON[4]);
  // --- hammer arm (screen right), drawn last so the hammer reads in front
  const rel: V = [(rsh[0] + rh[0]) / 2 + 4, (rsh[1] + rh[1]) / 2 + 1];
  arm(p, [rsh[0], rsh[1] + 3], rel, rh);
  paintHammer(p, rh[0], rh[1], o.ham, p2);
  ball(p, rh[0], rh[1], 3.6, 3.2, IRON.slice(1), false);
  if (p2) {
    // glowing seams + molten drips
    crack(p, hx - 5, hy - 5, hx - 1, hy - 3, HOT[4], 8, 0.5);
    crack(p, lsh[0] - 4, lsh[1] - 2, lsh[0] + 1, lsh[1] + 3, HOT[4], 4, 0.6);
    crack(p, rsh[0] + 4, rsh[1] - 2, rsh[0] - 1, rsh[1] + 3, HOT[4], 9, 0.6);
    p.px(CX + 8, ty + 10, HOT[4]);
    p.px(CX + 8, ty + 11, HOT[3]);
    p.px(CX - 10, ty + 4, HOT[4]);
  }
}

// ------------------------------------------------------------------ frames
const POSES: Record<string, SmithPose[]> = {
  idle: [
    { rh: [54, 46], ham: 1.2, lh: [15, 46], fire: 0 },
    { rh: [54, 47], ham: 1.2, lh: [15, 47], body: 1, fire: 1 },
    { rh: [54, 47], ham: 1.2, lh: [15, 47], body: 1, fire: 2 },
  ],
  walk: [
    { rh: [54, 45], ham: 1.1, lh: [15, 47], step: 1, fire: 1 },
    { rh: [54, 46], ham: 1.2, lh: [15, 46], step: 0, body: 1, fire: 2 },
    { rh: [54, 47], ham: 1.3, lh: [15, 45], step: -1, fire: 1 },
    { rh: [54, 46], ham: 1.2, lh: [15, 46], step: 0, body: 1, fire: 0 },
  ],
  raise: [
    { rh: [50, 14], ham: -1.95, lh: [13, 40], head: [-1, -1], body: -1, fire: 2, visor: 'flare' },
    { rh: [49, 13], ham: -2.05, lh: [13, 41], head: [-1, -1], body: -2, fire: 1, visor: 'flare' },
  ],
  slam: [{ rh: [44, 45], ham: 1.2, lh: [14, 48], head: [1, 3], body: 3, fire: 2, visor: 'flare' }],
  hookwind: [{ rh: [54, 46], ham: 1.2, lh: [7, 32], head: [-2, 0], fire: 1, visor: 'flare' }],
  throw: [{ rh: [54, 47], ham: 1.2, lh: [22, 50], hook: false, head: [1, 1], body: 1, fire: 2, visor: 'flare' }],
  spin: [
    { rh: [64, 34], ham: 0.05, lh: [6, 34], hook: false, fire: 2, visor: 'flare' },
    { rh: [62, 38], ham: 0.45, lh: [8, 30], hook: false, fire: 1, visor: 'flare', body: 1 },
  ],
  vent: [
    { rh: [58, 42], ham: 1.0, lh: [11, 42], head: [0, -2], body: -1, fire: 2, open: true, visor: 'flare' },
    { rh: [58, 41], ham: 1.0, lh: [11, 41], head: [0, -3], body: -2, fire: 1, open: true, visor: 'flare' },
  ],
  hurt: [{ rh: [56, 48], ham: 1.25, lh: [14, 50], head: [2, 2], body: 2, fire: 0 }],
};
const FPS: Record<string, number> = { idle: 4, walk: 6, raise: 12, spin: 12, vent: 10 };

for (const [state, poses] of Object.entries(POSES)) {
  for (const [pre, p2] of [['csmith', false], ['csmith2', true]] as const) {
    frames(pre, state, poses.length, W, H, (p, i) => paintSmith(p, poses[i], p2), { origin: ORIGIN, fps: FPS[state] ?? 8 });
  }
}

// intro-card portrait: helm and blazing visor, the sledge hoisted over a shoulder,
// the furnace belly roaring below
function paintPortrait(p: PixelPainter): void {
  const cx = 32;
  // torso + furnace grate
  p.ellipse(cx, 74, 27, 20, IRON[2]);
  for (let y = 52; y < 82; y++) {
    for (let x = 0; x < 72; x++) {
      if (!p.isSet(x, y)) continue;
      const nx = (x + 0.5 - cx) / 27;
      const lum = 0.62 - nx * 0.35 - (y - 54) / 60;
      p.px(x, y, plateCol(IRON.slice(1), lum, x, y));
    }
  }
  p.rect(cx - 12, 64, 24, 16, IRON[0]);
  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < 22; x++) {
      const heat = 1 - y / 17 + (bayer(cx - 11 + x, 65 + y) - 0.5) * 0.4 + 0.2;
      p.px(cx - 11 + x, 65 + y, FIRE[clamp(Math.floor(heat * 3.4), 0, 4)]);
    }
  }
  for (let x = 1; x < 22; x += 4) p.rect(cx - 11 + x, 65, 1, 14, IRON[1]);
  p.rect(cx - 11, 71, 22, 1, IRON[1]);
  paintChainLine(p, cx - 25, 58, cx + 22, 80);
  // gorget
  p.ellipse(cx, 50, 15, 5, IRON[1]);
  p.line(cx - 13, 49, cx + 13, 49, IRON[3]);
  // pauldrons
  for (const sd of [-1, 1]) {
    ball(p, cx + sd * 25, 57, 12, 10, IRON.slice(0, 5), false);
    p.line(cx + sd * 25 - 9, 61, cx + sd * 25 + 9, 62, IRON[0]);
    p.line(cx + sd * 25 - 8, 53, cx + sd * 25 + 6, 51, IRON[4]);
    for (const dx of [-5, 0, 5]) p.px(cx + sd * 25 + dx, 58, IRON[5]);
  }
  // the helm
  limb(p, cx + 9, 14, 2.4, cx + 11, 5, 2.8, IRON.slice(1));
  p.rect(cx + 7, 3, 8, 3, IRON[1]);
  p.rect(cx - 13, 14, 26, 34, IRON[2]);
  for (let y = 14; y < 48; y++) {
    for (let x = cx - 13; x < cx + 13; x++) {
      const lum = 0.66 - ((x - cx) / 16) * 0.42 - (y - 14) / 55;
      p.px(x, y, plateCol(IRON.slice(1), lum, x, y));
    }
  }
  p.rect(cx - 15, 12, 30, 4, IRON[3]);
  p.rect(cx - 15, 12, 30, 1, IRON[5]);
  p.rect(cx - 14, 46, 28, 2, IRON[1]);
  // T visor, blazing
  p.rect(cx - 10, 24, 20, 5, '#0a0606');
  p.rect(cx - 2, 28, 5, 12, '#0a0606');
  p.rect(cx - 9, 25, 18, 3, FIRE[2]);
  p.rect(cx - 7, 26, 14, 1, FIRE[3]);
  p.rect(cx - 1, 29, 3, 10, FIRE[1]);
  p.rect(cx, 29, 1, 8, FIRE[2]);
  p.px(cx - 6, 26, '#ffffff');
  p.px(cx + 5, 26, '#ffffff');
  for (const [x, y] of [[-11, 18], [11, 18], [-11, 40], [11, 40], [-6, 44], [6, 44]] as const) p.px(cx + x, y, IRON[5]);
  crack(p, cx - 9, 32, cx - 5, 38, IRON[0], 5, 0.6);
  // the sledge hoisted over the right shoulder, gripped by an iron fist
  paintHammer(p, 54, 58, -1.05, true);
  ball(p, 54, 58, 5, 4.4, IRON.slice(1), false);
  p.line(51, 57, 57, 59, IRON[0]);
  // smoke puffs
  for (const [x, y, r] of [[47, 2, 2.6], [52, 0, 3.2]] as const) ball(p, x, y, r, r * 0.8, ['#2a2428', '#3a3438', '#4a4248', '#5a5258'], true);
}

defineDrawnSprite('csmith_portrait', 74, 82, (p) => paintPortrait(p), { outline: OUTLINE });
defineDrawnSprite('csmith_hookshot', 9, 9, (p) => {
  p.ring(4, 5, 3.4, 1.6, IRON[4]);
  p.rect(1, 1, 7, 4, null as unknown as string);
  limb(p, 0.5, 5, 1.2, 0.5, 1, 0.5, IRON.slice(2));
  limb(p, 7.5, 5, 1.2, 7.5, 1, 0.5, IRON.slice(2));
  p.px(0, 1, '#ffffff');
  p.px(7, 1, '#ffffff');
  p.rect(3, 7, 3, 2, IRON[3]);
}, { outline: OUTLINE });
defineDrawnSprite('csmith_link', 4, 3, (p) => {
  p.rect(0, 0, 4, 3, CHAIN[1]);
  p.rect(1, 1, 2, 1, CHAIN[0]);
  p.px(0, 0, CHAIN[2]);
}, { outline: '#0a080c' });
defineDrawnSprite('csmith_link_hot', 4, 3, (p) => {
  p.rect(0, 0, 4, 3, HOT[3]);
  p.rect(1, 1, 2, 1, HOT[1]);
  p.px(0, 0, HOT[5]);
}, { outline: '#2a0602' });
defineDrawnSprite('csmith_slag', 9, 9, (p) => {
  ball(p, 4.5, 4.5, 4, 4, HOT.slice(1), true);
  p.px(3, 3, '#ffffff');
  p.px(6, 6, HOT[1]);
}, { outline: '#160300' });

// ------------------------------------------------------------------ hook projectile
const NAME = '사슬 대장장이';

/** The thrown hook: flies along a lane, embeds in the wall, then is reeled back in. */
class HookShot extends Entity {
  owner: Enemy;
  angle: number;
  speed = 400;
  state: 'fly' | 'stuck' | 'reel' | 'done' = 'fly';
  stuckT = 0;
  hitDone = false;
  constructor(owner: Enemy, x: number, y: number, angle: number) {
    super();
    this.owner = owner;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.layer = 1;
    this.tileCollide = false;
    this.team = 'enemy';
  }

  hand(): { x: number; y: number } {
    return { x: this.owner.x - 18 * (this.owner.facing < 0 ? -1 : 1), y: this.owner.y + 2 };
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.owner.dead) {
      this.dead = true;
      return;
    }
    if (this.state === 'fly') {
      const nx = this.x + Math.cos(this.angle) * this.speed * dt;
      const ny = this.y + Math.sin(this.angle) * this.speed * dt;
      if (!insideRoom(w, nx, ny, 2) || w.room.boxBlocked(nx, ny, 2, true, false)) {
        this.state = 'stuck';
        w.sfx('hit_metal', { vol: 0.8, pitch: 0.7 });
        w.shake(0.25);
        w.particles.burst(this.x, this.y, { count: 14, speed: [40, 140], life: [0.15, 0.35], colors: ['#ffffff', '#ffe0a0', '#ffa424'], shape: 'spark', size: [1, 2] });
      } else {
        this.x = nx;
        this.y = ny;
      }
      if (!this.hitDone && hitPlayerCircle(w, this.x, this.y, 7, 1, NAME)) this.hitDone = true;
    } else if (this.state === 'stuck') {
      this.stuckT += dt;
    } else if (this.state === 'reel') {
      const h = this.hand();
      const d = Math.hypot(h.x - this.x, h.y - this.y);
      const sp = 360 * dt;
      if (d <= sp + 2) {
        this.state = 'done';
        this.dead = true;
      } else {
        this.x += ((h.x - this.x) / d) * sp;
        this.y += ((h.y - this.y) / d) * sp;
      }
    }
  }

  override draw(r: Renderer): void {
    const h = this.hand();
    const d = Math.hypot(this.x - h.x, this.y - h.y);
    const a = Math.atan2(this.y - h.y, this.x - h.x);
    for (let t = 0; t < d; t += 4) {
      r.sprite('csmith_link', h.x + Math.cos(a) * t, h.y + Math.sin(a) * t - 3, { rot: a + (Math.floor(t / 4) % 2 ? 0 : 0.0) });
    }
    r.sprite('csmith_hookshot', this.x, this.y - 3, { rot: a + Math.PI / 2 });
  }

  override get sortY(): number {
    return this.y;
  }
}

// ------------------------------------------------------------------ behaviour
const EMBERS = ['#ffffff', '#fff0a0', '#ffa424', '#d84a0e'];

function anim(e: Enemy, state: string, restart = false): void {
  e.setAnim(`${e.mem.p2 ? 'csmith2' : 'csmith'}_${state}`, restart);
}

function* walkTo(e: Enemy, w: World, time: number, near: number): Script {
  anim(e, 'walk');
  for (let el = 0; el < time; el += w.dt) {
    if (e.distToTarget(w) < near) break;
    e.chase(w, e.speed * (e.mem.p2 ? 1.3 : 1));
    faceTarget(e, w);
    if (Math.floor(e.animT * 6) % 2 === 0 && fx.chance(0.08)) {
      w.sfx('step', { vol: 0.5, pitch: 0.5 });
      dust(w, e.x + fx.range(-8, 8), e.y + 20, ['#5a4a44', '#3a302c'], 2, 30);
    }
    yield;
  }
  e.stop();
}

function* anvilStrike(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  yield* walkTo(e, w, 1.0, 60);
  e.halt();
  faceTarget(e, w);
  const t = e.target(w);
  const a = Math.atan2(t.y - e.y, t.x - e.x);
  const ix = e.x + Math.cos(a) * 26;
  const iy = e.y + 16 + Math.sin(a) * 16;
  anim(e, 'raise', true);
  e.telegraph(0.75);
  w.spawn(new GroundWarning(ix, iy, 24, 0.75));
  w.sfx('enemy_charge', { vol: 0.7, pitch: 0.55 });
  gather(w, e.x + 13 * e.facing, e.y - 40, EMBERS, 10, 18);
  yield 0.75;
  anim(e, 'slam', true);
  w.sfx('slam', { vol: 1, pitch: 0.6 });
  w.sfx('hit_metal', { vol: 0.9, pitch: 0.5 });
  w.shake(0.75);
  hitPlayerCircle(w, ix, iy, 24, 2, NAME);
  w.particles.burst(ix, iy, { count: 24, speed: [50, 160], life: [0.15, 0.4], colors: EMBERS, shape: 'spark', size: [1, 2] });
  w.decal(ix, iy, '#1a0c0a', 10, 0.5);
  const dirs = p2 ? 8 : 4;
  const off = p2 ? 0 : (w.rng.chance(0.5) ? 0 : Math.PI / 4);
  for (let i = 0; i < dirs; i++) {
    const da = off + (i / dirs) * TAU;
    eruptLine(w, ix + Math.cos(da) * 18, iy + Math.sin(da) * 18, da, 11, 16, 0.5, 0.07, 'fire', { radius: 9, source: NAME, linger: 0.35 });
  }
  yield p2 ? 0.6 : 0.9;
  anim(e, 'idle');
  yield 0.3;
}

function* hookThrow(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  faceTarget(e, w);
  anim(e, 'hookwind', true);
  const hx = e.x - 18 * e.facing;
  const hy = e.y + 2;
  const t = e.target(w);
  const a = Math.atan2(t.y - hy, t.x - hx);
  const len = rayFree(w.room, hx, hy, a, 3, 400, true);
  laneWarning(w, hx, hy, a, len + 4, 12, 0.7);
  e.telegraph(0.7);
  w.sfx('whoosh', { vol: 0.5, pitch: 0.5 });
  yield 0.7;
  anim(e, 'throw', true);
  w.sfx('whoosh', { vol: 0.8, pitch: 1.1 });
  const hook = w.spawn(new HookShot(e, hx, hy, a));
  while (hook.state === 'fly' && !hook.dead) yield;
  yield 0.2;
  if (p2 && hook.state === 'stuck') {
    // reel itself in along the chain — a charge down the warned lane
    const tx = hook.x;
    const ty = hook.y;
    const ca = Math.atan2(ty - e.y, tx - e.x);
    const clen = rayFree(w.room, e.x, e.y, ca, e.r, 400);
    laneWarning(w, e.x, e.y, ca, clen + e.r, e.r * 2 + 4, 0.45);
    e.telegraph(0.45);
    w.sfx('enemy_charge', { vol: 0.8, pitch: 0.7 });
    yield 0.45;
    e.contactDamage = 2;
    e.mem.__bumped = 0;
    for (let el = 0; el < 1.4; el += w.dt) {
      const d = Math.hypot(tx - e.x, ty - e.y);
      if (d < e.r + 6 || e.mem.__bumped) break;
      e.accel = 4000;
      e.moveAngle(ca, 300);
      if (fx.chance(0.6)) w.particles.spawn({ x: e.x + fx.range(-8, 8), y: e.y + 18, vx: -Math.cos(ca) * 40, vy: -Math.sin(ca) * 40, life: 0.3, colors: EMBERS, size: 1, additive: true });
      yield;
    }
    e.accel = 900;
    e.halt();
    e.contactDamage = 1;
    hook.dead = true;
    w.sfx('slam', { vol: 1, pitch: 0.65 });
    w.shake(0.7);
    const g = w.rng.angle();
    w.spawn(new Shockwave(e.x, e.y + 16, { speed: 125, maxR: 120, color: '#ffa424', gaps: [g, g + Math.PI], gapWidth: 1.0, source: NAME, debris: EMBERS }));
    anim(e, 'hurt', true);
    yield 0.7;
  } else {
    hook.state = 'reel';
    while (!hook.dead) yield;
  }
  anim(e, 'idle');
  yield 0.4;
}

function* slagLob(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  anim(e, 'vent', true);
  e.telegraph(0.5);
  w.sfx('fire', { vol: 0.6, pitch: 0.7 });
  gather(w, e.x, e.y - 8, EMBERS, 10, 22);
  yield 0.5;
  const n = p2 ? 5 : 3;
  const p = w.player;
  const pts = volleyTargets(e.x, e.y, p.x + p.vx * 0.3, p.y + p.vy * 0.3, n, 30);
  for (const pt of pts) {
    const land = landingSpot(w, pt.x, pt.y, 4);
    lob(w, e.x, e.y - 8, land.x, land.y, {
      sprite: 'csmith_slag', color: BUL.molten.color, time: 1.0, height: 70, warn: 14, hitRadius: 12, source: NAME, spin: 5,
      onLand: (ww, x, y) => {
        ww.spawn(new Hazard(x, y, 14, p2 ? 4 : 3.2, 'fire', NAME));
        ww.sfx('fire', { vol: 0.4, pitch: 1.2 });
      },
    });
    e.squash(0.9, 1.1);
    yield 0.16;
  }
  anim(e, 'idle');
  yield 0.6;
}

function* bellows(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  anim(e, 'vent', true);
  e.telegraph(0.65);
  w.sfx('beam_charge', { vol: 0.6, pitch: 0.6 });
  for (let k = 0; k < 3; k++) {
    gather(w, e.x, e.y - 8, EMBERS, 8, 26);
    yield 0.22;
  }
  let g = w.rng.angle();
  const waves = p2 ? 3 : 2;
  for (let k = 0; k < waves; k++) {
    w.sfx('fire', { vol: 0.8, pitch: 0.6 });
    w.particles.burst(e.x, e.y - 8, { count: 18, speed: [30, 90], life: [0.4, 0.9], colors: ['#d8d0d0', '#a8a0a8', '#706870'], size: [2, 4], sizeEnd: 6, drag: 2, gravity: -40 });
    shootGapRing(e, w, 18, k * 0.17, [g, g + Math.PI], 0.85, bullet('molten', 3, { speed: 74 + k * 10, z: 8 }));
    g += 0.6;
    yield 0.4;
  }
  anim(e, 'idle');
  yield 0.5;
}

function* chainCyclone(e: Enemy, w: World): Script {
  e.halt();
  anim(e, 'spin', true);
  const L = 92;
  const dir = w.rng.sign();
  let a = e.angleToTarget(w) + Math.PI / 2;
  // show where the chains will start
  for (const k of [0, Math.PI]) laneWarning(w, e.x, e.y + 4, a + k, L, 10, 0.85);
  e.telegraph(0.85);
  w.sfx('whoosh', { vol: 0.6, pitch: 0.45 });
  yield 0.85;
  e.mem.spin = 1;
  e.mem.spinA = a;
  e.mem.spinL = L;
  e.mem.spinDir = dir;
  let speed = 0.6;
  for (let el = 0; el < 3.4; el += w.dt) {
    speed = Math.min(1.5, speed + w.dt * 1.2);
    a += dir * speed * w.dt;
    e.mem.spinA = a;
    // slow drift toward the player
    e.chase(w, 14);
    if (Math.floor(el / 0.3) !== Math.floor((el - w.dt) / 0.3)) w.sfx('whoosh', { vol: 0.45, pitch: 0.7 });
    for (const p of w.targets()) {
      if (p.alive && p.z < 6) {
        for (const k of [0, Math.PI]) {
          const ex = e.x + Math.cos(a + k) * L;
          const ey = e.y + 4 + Math.sin(a + k) * L;
          if (distToSegment(p.x, p.y - 3, e.x, e.y + 4, ex, ey) < 5 + p.r * 0.5 && p.hurt(w, 1, NAME)) {
            p.knock(Math.cos(a + k + dir * Math.PI / 2), Math.sin(a + k + dir * Math.PI / 2), 180);
          }
        }
      }
    }
    yield;
  }
  e.mem.spin = 0;
  e.stop();
  anim(e, 'hurt', true);
  yield 0.6;
  anim(e, 'idle');
}

function* phaseTwo(e: Enemy, w: World): Script {
  yield* phaseShift(e, w, {
    anim: 'csmith_vent',
    color: '#ff7020',
    time: 1.5,
    onPeak: () => {
      e.mem.p2 = true;
      anim(e, 'vent', true);
      w.sfx('beam_charge', { vol: 0.9, pitch: 1.4 });
      w.particles.burst(e.x, e.y - 20, { count: 30, speed: [30, 110], life: [0.5, 1.2], colors: ['#e8e0e0', '#b0a8b0', '#706870'], size: [2, 5], sizeEnd: 8, drag: 2, gravity: -50 });
      const g = w.rng.angle();
      shootGapRing(e, w, 24, 0, [g, g + Math.PI], 0.85, bullet('molten', 3, { speed: 80, z: 8 }));
      for (let i = 0; i < Math.max(0, 2 - minionCount(w, e)); i++) {
        const s = spotAround(w, e.x, e.y, 40, 80, 6) ?? { x: e.x + (i ? 40 : -40), y: e.y + 10 };
        w.spawn(new GroundWarning(s.x, s.y, 10, 0.6, (ww) => summonMinion(e, ww, 'fire_imp', s.x, s.y, EMBERS), WARN_RED));
      }
    },
  });
}

defineBoss({
  id: 'chain_smith',
  name: NAME,
  bossTitle: '식지 않는 모루',
  bossFloors: [3],
  hp: 950,
  radius: 16,
  speed: 32,
  mass: 10,
  sprite: 'csmith_idle',
  portrait: 'csmith_portrait',
  shadow: 0,
  deathFx: 'metal',
  bloodColor: '#8a8090',
  contactDamage: 1,
  hurtSfx: 'hit_metal',
  light: { radius: 60, color: '#ff8a3a' },
  init(e) {
    e.mem.last = null;
  },
  *script(e, w) {
    anim(e, 'idle');
    yield 0.3;
    while (true) {
      if (e.phase === 0 && e.hp <= e.maxHp * 0.5) yield* phaseTwo(e, w);
      const p2 = !!e.mem.p2;
      const id = pickPattern(w.rng, [
        { id: 'strike', w: 3 },
        { id: 'hook', w: 2.2 },
        { id: 'slag', w: 2 },
        { id: 'bellows', w: 2 },
        { id: 'cyclone', w: 2.4, when: p2 },
        { id: 'imps', w: 1, when: p2 && minionCount(w, e) === 0 && w.enemies.length < 4 },
      ], e.mem.last as string | null);
      e.mem.last = id;
      if (id === 'strike') yield* anvilStrike(e, w);
      else if (id === 'hook') yield* hookThrow(e, w);
      else if (id === 'slag') yield* slagLob(e, w);
      else if (id === 'bellows') yield* bellows(e, w);
      else if (id === 'cyclone') yield* chainCyclone(e, w);
      else {
        anim(e, 'vent', true);
        e.telegraph(0.4);
        yield 0.4;
        for (let i = 0; i < 2; i++) {
          const s = spotAround(w, e.x, e.y, 40, 80, 6) ?? { x: e.x + (i ? 40 : -40), y: e.y + 10 };
          w.spawn(new GroundWarning(s.x, s.y, 10, 0.6, (ww) => summonMinion(e, ww, 'fire_imp', s.x, s.y, EMBERS), WARN_RED));
        }
        yield 0.8;
      }
      anim(e, 'idle');
      yield p2 ? 0.35 : 0.6;
      yield* walkTo(e, w, p2 ? 0.5 : 0.8, 70);
    }
  },
  update(e, w) {
    // smokestack puffs + embers from the grate
    if (fx.chance(e.mem.p2 ? 0.25 : 0.12)) {
      w.particles.spawn({ x: e.x + 7 * (e.facing < 0 ? -1 : 1), y: e.y - 44 - e.z, vx: fx.range(-4, 4), vy: -fx.range(10, 20), life: fx.range(0.8, 1.4), colors: ['#5a5058', '#3a3438', '#2a2428'], size: 2, sizeEnd: 5, alpha: 0.6 });
    }
    if (fx.chance(e.mem.p2 ? 0.5 : 0.2)) {
      w.particles.spawn({ x: e.x + fx.range(-5, 5), y: e.y - 8 - e.z, vx: fx.range(-10, 10), vy: -fx.range(10, 30), life: fx.range(0.3, 0.7), colors: EMBERS, size: 1, additive: true, light: 3 });
    }
  },
  draw(e, r) {
    r.shadow(e.x, e.y + 20, 44, 11, 0.42);
    if (e.mem.spin) {
      const a = e.mem.spinA as number;
      const L = e.mem.spinL as number;
      const dir = (e.mem.spinDir as number) || 1;
      for (const k of [0, Math.PI]) {
        // motion smear trailing the chain
        for (let j = 1; j <= 3; j++) {
          const b = a + k - dir * 0.09 * j;
          r.line(e.x + Math.cos(b) * 12, e.y + 2 + Math.sin(b) * 12, e.x + Math.cos(b) * L, e.y + 2 + Math.sin(b) * L, '#ff6a1a', 3 - j * 0.6, 0.3 / j);
        }
        for (let t = 10; t < L; t += 4) r.sprite('csmith_link_hot', e.x + Math.cos(a + k) * t, e.y + 4 + Math.sin(a + k) * t - 2, { rot: a + k });
        r.sprite(k ? 'csmith_slag' : 'csmith_hookshot', e.x + Math.cos(a + k) * L, e.y + 4 + Math.sin(a + k) * L - 2, { rot: a + k + Math.PI / 2 });
      }
    }
    e.drawDefault(r);
  },
  onDeath(e, w) {
    clearArena(w);
    dissolveMinions(w, e);
    e.mem.spin = 0;
    w.sfx('explosion', { vol: 0.8, pitch: 0.7 });
    bossDeathBurst(w, e.x, e.y, ['#b0a6b0', '#8a8090', '#625a66', '#403a46', '#ffa424']);
    w.particles.burst(e.x, e.y - 8, { count: 40, speed: [60, 200], life: [0.3, 0.8], colors: EMBERS, shape: 'spark', size: [1, 2], light: 4 });
    for (let i = 0; i < 3; i++) w.spawn(new RingFx(e.x, e.y, 34 + i * 24, 0.5 + i * 0.15, '#ffa424', 2));
    w.decal(e.x, e.y + 16, '#1a0c0a', 20, 0.55);
  },
});
