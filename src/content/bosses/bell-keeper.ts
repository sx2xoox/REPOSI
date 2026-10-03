// Floor 1 boss: 조종지기 (the funeral-bell keeper) — 꺼진 등불을 세는 자.
// A hooded mourning wraith in a porcelain mask that tolls a huge bronze funeral
// bell; a string of dead lanterns hangs from its belt.
// Phase 1: tolls (expanding rings of soul bullets with gaps), a procession of
// soul wisps released one by one at the player, a bell drop (vanishes, its
// shadow hunts the player, then it slams down), summoned wailing shades.
// Phase 2 (≤50%): the bell and the mask crack — double tolls with fast/slow
// rings, a spinning requiem spiral, chained bell drops.

import { defineBoss } from '../../game/defs';
import { PixelPainter, bayer } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { clamp, ease } from '../../engine/math';
import { GroundWarning, RingFx } from '../../game/effects';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Script } from '../../engine/script';
import { bullet, frames, gather, landingSpot, spotAround } from '../enemies/shared';
import {
  aimOnRelease, ball, bossDeathBurst, crack, dissolveMinions, faceTarget, hitPlayerCircle, inRoom, limb, minionCount, OUTLINE,
  phaseShift, pickPattern, shootGapRing, ShiftedPainter, Shockwave, summonMinion,
  clearArena,
} from './kit13';

// ------------------------------------------------------------------ palette
const ROBE = ['#120e1e', '#221a34', '#383052', '#56507a', '#7c76a0'];
const HOOD_IN = '#07040c';
const MASK = ['#8e8690', '#c8c0bc', '#ece6dc', '#fffaf0'];
const TEAR = '#a01830';
const BRONZE = ['#2e1a0c', '#5a3818', '#8a5a26', '#bc8a3e', '#e8c070', '#fff0b8'];
const PATINA = ['#2e6a5e', '#58a08a'];
const HAND = ['#3a3a58', '#6a6a8e', '#a0a0c0'];
const SOULBLUE = ['#2a4aa0', '#5a8aff', '#b0d0ff', '#ffffff'];
const LANT = ['#1a1418', '#3a3034', '#5e5258'];

const W = 60;
const H = 70;
const CX = 30;
const ORIGIN: [number, number] = [30, 40];

// ------------------------------------------------------------------ the bell
/** half width of the bell profile at local depth ly (0 = crown shoulder, 18 = lip) */
function bellHalf(ly: number): number {
  if (ly < 0 || ly > 19) return -1;
  if (ly < 3) return 4 + ly * 0.8;
  if (ly < 13) return 6.4 + (ly - 3) * 0.17;
  if (ly < 17) return 8.1 + (ly - 13) * 0.55;
  return 10.3;
}

function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * Bronze funeral bell hanging from its crown at (cx, cy), rotated by `ang`
 * (0 = mouth down, + = clockwise). Shaded per pixel in bell-local space.
 */
function paintBell(p: PixelPainter, cx: number, cy: number, ang: number, cracked: boolean, ringing = false): void {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  // crown loop
  const lx0 = cx + s * 2;
  const ly0 = cy - c * 2;
  p.ring(lx0, ly0, 2.4, 1.3, BRONZE[2]);
  p.px(lx0 - 1, ly0 - 2, BRONZE[4]);
  for (let y = Math.floor(cy - 22); y <= cy + 22; y++) {
    for (let x = Math.floor(cx - 22); x <= cx + 22; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      // inverse rotate into bell space
      const lx = dx * c + dy * s;
      const ly = -dx * s + dy * c;
      const hw = bellHalf(ly);
      if (hw < 0 || Math.abs(lx) > hw) continue;
      const n = lx / hw; // -1..1 across the bell
      // cylinder lighting from the upper left, rotated with the bell
      const wl = -(n * 0.9) * c + 0.2 * s;
      let lum = 0.55 + wl * 0.45 - Math.abs(n) ** 3 * 0.35;
      if (ly < 1.5) lum += 0.1;
      let idx = clamp(Math.floor(lum * 5 + bayer(x, y) - 0.5), 0, 4);
      // decorative bands + lip
      if (Math.abs(ly - 4) < 0.6 || Math.abs(ly - 14.5) < 0.6) idx = Math.max(0, idx - 2);
      if (ly > 17.6) idx = Math.min(5, idx + 1);
      let col = BRONZE[idx];
      // verdigris patina blotches
      const hp = hash2(Math.floor(lx * 0.7 + 20), Math.floor(ly * 0.7 + 3));
      if (hp < 0.12 && ly > 1 && ly < 17) col = PATINA[idx > 2 ? 1 : 0];
      // engraved band of dots
      if (Math.abs(ly - 9.5) < 0.5 && Math.round(lx) % 3 === 0) col = BRONZE[Math.max(0, idx - 1)];
      p.px(x, y, col);
    }
  }
  // mouth rim + clapper when it swings
  const mx = cx - s * 18.6;
  const my = cy + c * 18.6;
  if (Math.abs(ang) > 0.25) {
    const k = Math.sign(ang);
    const cpx = mx + c * k * 3;
    const cpy = my + s * k * 3;
    p.circle(cpx, cpy, 2, BRONZE[1]);
    p.px(cpx - 1, cpy - 1, BRONZE[3]);
  }
  if (cracked) {
    // crack in bell space, glowing with trapped soul-light
    const pts: [number, number][] = [[1.5, 0.5], [-1, 5], [2.5, 9], [-0.5, 13.5], [2, 18.5]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const X = (lx: number, ly: number) => cx + lx * c - ly * s;
      const Y = (lx: number, ly: number) => cy + lx * s + ly * c;
      p.line(X(ax + 1, ay), Y(ax + 1, ay), X(bx + 1, by), Y(bx + 1, by), SOULBLUE[1]);
      p.line(X(ax, ay), Y(ax, ay), X(bx, by), Y(bx, by), '#0a0610');
    }
  }
  if (ringing) {
    // motion arcs at the lip
    for (const k of [-1, 1]) {
      p.px(mx + c * k * 12, my + s * k * 12, '#fff0b8');
      p.px(mx + c * k * 13, my + s * k * 13 - 2, '#fff0b8');
    }
  }
}

// ------------------------------------------------------------------ the keeper
type V = [number, number];
interface KeepPose {
  /** bell crown position + angle */
  bell: V;
  ang: number;
  /** hands */
  lh: V;
  rh: V;
  /** hood offset */
  head?: V;
  /** hem wave frame */
  hem?: number;
  ringing?: boolean;
  /** draw the bell behind the robe */
  bellBack?: boolean;
  /** robe flare (spin) */
  flare?: number;
  eyes?: 'calm' | 'glare';
}

function paintLantern(p: PixelPainter, x: number, y: number, lit = false): void {
  // a cold, dead lantern (hook, cap, cage bars, sooty glass) — relit by stolen souls in phase 2
  p.line(x, y - 6, x, y - 4, LANT[2]);
  p.rect(x - 1, y - 4, 3, 1, LANT[2]);
  p.rect(x - 2, y - 3, 5, 6, LANT[1]);
  p.rect(x - 1, y - 2, 3, 4, lit ? SOULBLUE[0] : '#0c0a12');
  p.px(x, y - 2, lit ? SOULBLUE[2] : '#2a2a3a');
  p.px(x, y, lit ? SOULBLUE[3] : '#3a3448');
  p.rect(x - 2, y + 3, 5, 1, LANT[0]);
  p.px(x - 2, y - 3, LANT[2]);
}

function paintRobe(p: PixelPainter, hem: number, flare: number, p2: boolean): void {
  const f = flare;
  // long ragged hem
  const hemPts: number[] = [];
  const n = 11;
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    const x = 9 - f * 5 + (42 + f * 10) * t;
    const wave = Math.sin(t * 11 + hem * 1.6) * 2.2;
    const y = 59 + (i % 2 ? 8 : 1) + wave + Math.sin(i * 2.3) * 1.5;
    hemPts.push(x, y);
  }
  p.poly([22, 26, 38, 26, 44 + f * 2, 36, 50 + f * 5, 56, ...hemPts, 10 - f * 5, 56, 16 - f * 2, 36], ROBE[2]);
  // deep folds (lit from the upper left) + ghostly fade toward the hem
  for (let y = 25; y < 70; y++) {
    for (let x = 2; x < 58; x++) {
      if (!p.isSet(x, y)) continue;
      const fold = Math.sin((x - CX) * 0.62 + hem * 0.35 + y * 0.04) * 0.5 + 0.5;
      const side = (x - CX) / 22;
      const lum = 0.58 - side * 0.32 + (fold - 0.5) * 0.5 - (y - 25) / 80;
      const idx = clamp(Math.floor(lum * 5 + bayer(x, y) - 0.5), 0, 4);
      p.px(x, y, ROBE[idx]);
      if (y > 57 && bayer(x, y) < (y - 57) / 13) p.px(x, y, null);
    }
  }
  // robe opening + trim
  p.line(CX, 30, CX, 56, ROBE[0]);
  p.line(CX + 1, 30, CX + 1, 56, ROBE[3]);
  // belt of dead lanterns
  p.rect(15, 42, 30, 1, ROBE[0]);
  paintLantern(p, 15, 49, p2);
  paintLantern(p, 45, 50, p2);
  paintLantern(p, 20, 53, p2);
  paintLantern(p, 41, 53, p2);
  if (p2) {
    // pale soul-fire licking the hem
    for (let i = 0; i < 6; i++) {
      const x = 13 + i * 7 + (hem % 2);
      const y = 58 + (i % 2) * 2;
      p.poly([x - 2, y + 3, x + (i % 2 ? 1 : -1), y - 5, x + 2, y + 3], SOULBLUE[1]);
      p.poly([x - 1, y + 3, x, y - 2, x + 1, y + 3], SOULBLUE[2]);
    }
  }
}

function paintHood(p: PixelPainter, hx: number, hy: number, eyes: KeepPose['eyes'], p2: boolean): void {
  const x = CX + hx;
  const y = 18 + hy;
  // hood: drooping pointed tip and fabric falling onto the shoulders
  p.poly([x - 9, y + 10, x - 11, y - 2, x - 5, y - 11, x + 2, y - 15, x + 7, y - 17, x + 6, y - 12, x + 11, y - 3, x + 10, y + 10], ROBE[3]);
  ball(p, x, y - 1, 10.5, 10.5, ROBE, false);
  limb(p, x + 3, y - 10, 2.8, x + 7, y - 17, 0.8, ROBE.slice(1));
  p.poly([x - 13, y + 11, x - 8, y + 4, x + 8, y + 4, x + 13, y + 11, x + 9, y + 13, x - 9, y + 13], ROBE[2]);
  p.line(x - 12, y + 11, x - 7, y + 5, ROBE[4]);
  // face opening (deep shadow)
  p.line(x - 8, y - 5, x - 4, y - 10, '#938192');
  p.poly([x - 2, y - 12, x + 2, y - 12, x + 1, y - 7, x - 1, y - 7], '#bbaa85');
  p.px(x, y - 10, p2 ? '#b9edff' : '#513348');
  p.ellipse(x, y + 1.5, 7, 8, HOOD_IN);
  // porcelain mask, half lost in the hood's shadow
  ball(p, x, y + 3.5, 4.2, 5.6, MASK, false);
  // the hood's brim throws a shadow across the brow
  p.ellipse(x, y - 2.2, 7, 3.2, HOOD_IN);
  p.line(x - 4, y + 1, x + 4, y + 1, MASK[1]);
  // Porcelain ridge and a chipped cheek catch the lantern light.
  p.line(x, y + 3, x, y + 5, MASK[MASK.length - 1]);
  p.px(x - 3, y + 6, MASK[MASK.length - 1]);
  // painted eye slits + crimson tears
  const glow = eyes === 'glare' ? '#ffffff' : '#c8d8ff';
  const ey = y + 2;
  p.rect(x - 3, ey, 2, 1, '#14101c');
  p.rect(x + 2, ey, 2, 1, '#14101c');
  p.px(x - 2, ey, glow);
  p.line(x - 3, ey + 2, x - 3, ey + 5, TEAR);
  p.line(x + 3, ey + 2, x + 3, ey + 4, TEAR);
  p.rect(x - 1, ey + 5, 3, 1, '#7a7078');
  if (p2) {
    // a chunk of the mask has broken away: a blue eye burns in the dark
    p.poly([x + 1, ey - 4, x + 5, ey - 3, x + 5, ey + 3, x + 2, ey + 2, x + 1, ey - 1], '#0a0612');
    crack(p, x + 1, ey - 1, x - 2, ey + 6, '#3a3040', 4, 0.7);
    p.rect(x + 2, ey, 2, 2, SOULBLUE[1]);
    p.px(x + 3, ey, SOULBLUE[3]);
    p.px(x + 2, ey - 1, SOULBLUE[2]);
  } else {
    p.px(x + 3, ey, glow);
  }
}

function paintSleeve(p: PixelPainter, sh: V, hand: V): void {
  const mx = (sh[0] + hand[0]) / 2 + (hand[0] < sh[0] ? -1 : hand[0] > sh[0] ? 1 : 0);
  const my = (sh[1] + hand[1]) / 2 + 2;
  // dark rim first so the sleeve separates from the robe
  limb(p, sh[0], sh[1], 4.8, mx, my, 4.6, [ROBE[0]]);
  limb(p, mx, my, 4.6, hand[0], hand[1], 4.2, [ROBE[0]]);
  limb(p, sh[0], sh[1], 3.8, mx, my, 3.6, ROBE.slice(1));
  limb(p, mx, my, 3.6, hand[0], hand[1], 3.4, ROBE.slice(1));
  // wide cuff + bony fingers
  p.ellipse(hand[0], hand[1], 3.6, 1.6, ROBE[1]);
  ball(p, hand[0], hand[1] + 1.5, 1.8, 1.6, HAND, false);
  p.px(hand[0] - 1, hand[1] + 3, HAND[1]);
  p.px(hand[0] + 1, hand[1] + 3, HAND[1]);
  p.px(hand[0], hand[1] + 4, HAND[2]);
}

function paintKeeper(p: PixelPainter, o: KeepPose, p2: boolean): void {
  const head = o.head ?? [0, 0];
  if (o.bellBack) {
    paintBell(p, o.bell[0], o.bell[1], o.ang, p2, o.ringing);
  }
  paintRobe(p, o.hem ?? 0, o.flare ?? 0, p2);
  // A mourning stole follows the robe's sway.
  for (const s of [-1, 1]) {
    const x = CX + s * 10;
    const hem = o.hem ?? 0;
    p.poly([x - 2, 27, x + 2, 27, x + s * 3 + 2, 57 + hem, x + s * 3, 54 + hem, x + s * 3 - 2, 58 + hem], '#72627c');
    p.line(x - 1, 29, x + s * 3 - 1, 52 + hem, '#b6a0a6');
    for (let y = 33; y < 50; y += 5) p.line(x, y, x + s * 2, y + 1, p2 ? '#99d4ef' : '#49354e');
  }
  // rope from hands to the bell crown
  if (!o.bellBack) {
    p.line(o.lh[0], o.lh[1] + 1, o.bell[0], o.bell[1] - 2, '#6a5a40');
    p.line(o.rh[0], o.rh[1] + 1, o.bell[0], o.bell[1] - 2, '#8a7a58');
  }
  paintSleeve(p, [21, 29 + head[1] * 0.3], o.lh);
  paintSleeve(p, [39, 29 + head[1] * 0.3], o.rh);
  paintHood(p, head[0], head[1], o.eyes ?? 'calm', p2);
  if (!o.bellBack) paintBell(p, o.bell[0], o.bell[1], o.ang, p2, o.ringing);
}

// ------------------------------------------------------------------ frames
const POSES: Record<string, KeepPose[]> = {
  float: [0, 1, 2, 3].map((i) => ({ bell: [30, 38] as V, ang: [0.06, 0.02, -0.06, -0.02][i], lh: [26, 35] as V, rh: [34, 35] as V, hem: i, head: [0, [0, -1, -1, 0][i]] as V })),
  swing: [
    { bell: [17, 30], ang: 1.15, lh: [19, 28], rh: [23, 30], hem: 1, head: [-1, 0], eyes: 'glare' },
    { bell: [16, 28], ang: 1.3, lh: [18, 26], rh: [22, 28], hem: 2, head: [-1, 0], eyes: 'glare' },
  ],
  toll: [
    { bell: [42, 31], ang: -1.25, lh: [40, 29], rh: [37, 31], hem: 3, head: [1, 1], eyes: 'glare', ringing: true },
    { bell: [41, 33], ang: -0.95, lh: [39, 30], rh: [36, 32], hem: 0, head: [1, 1], eyes: 'glare', ringing: true },
  ],
  cast: [
    { bell: [42, 34], ang: -0.15, lh: [15, 9], rh: [40, 32], hem: 1, head: [-1, -1], eyes: 'glare' },
    { bell: [42, 34], ang: -0.05, lh: [14, 8], rh: [40, 32], hem: 2, head: [-1, -2], eyes: 'glare' },
  ],
  spin: [
    { bell: [44, 30], ang: -1.57, lh: [38, 29], rh: [41, 30], hem: 0, flare: 1, eyes: 'glare' },
    { bell: [30, 28], ang: 3.14, lh: [26, 31], rh: [34, 31], hem: 1, flare: 1.5, eyes: 'glare', bellBack: true },
    { bell: [16, 30], ang: 1.57, lh: [19, 30], rh: [22, 29], hem: 2, flare: 1, eyes: 'glare' },
    { bell: [30, 40], ang: 0, lh: [26, 36], rh: [34, 36], hem: 3, flare: 1.5, eyes: 'glare' },
  ],
  hurt: [{ bell: [32, 39], ang: -0.35, lh: [22, 36], rh: [37, 36], hem: 2, head: [2, 1], eyes: 'glare' }],
};
const FPS: Record<string, number> = { float: 6, swing: 10, toll: 12, cast: 8, spin: 14, hurt: 1 };

for (const [state, poses] of Object.entries(POSES)) {
  for (const [pre, p2] of [['bkeep', false], ['bkeep2', true]] as const) {
    frames(pre, state, poses.length, W, H, (p, i) => paintKeeper(p, poses[i], p2), { origin: ORIGIN, fps: FPS[state] ?? 8 });
  }
}

// intro-card portrait: the masked face under the hood, the bell raised beside it
function paintPortrait(p: PixelPainter): void {
  const cx = 30;
  // shoulders / robe drape
  p.poly([2, 76, 8, 56, 20, 48, 40, 48, 52, 56, 60, 76], ROBE[2]);
  for (let y = 46; y < 76; y++) {
    for (let x = 0; x < 62; x++) {
      if (!p.isSet(x, y) || y < 47) continue;
      const fold = Math.sin((x - cx) * 0.45) * 0.5 + 0.5;
      const lum = 0.55 - (x - cx) / 40 + (fold - 0.5) * 0.4 - (y - 46) / 70;
      p.px(x, y, ROBE[clamp(Math.floor(lum * 5 + bayer(x, y) - 0.5), 0, 4)]);
    }
  }
  // hood with a drooping tip
  p.poly([cx - 19, 46, cx - 21, 22, cx - 12, 6, cx, -2, cx + 10, -6, cx + 9, 2, cx + 20, 18, cx + 19, 46], ROBE[3]);
  ball(p, cx, 26, 19, 21, ROBE, false);
  limb(p, cx + 6, 2, 4, cx + 12, -6, 1, ROBE.slice(1));
  p.line(cx - 18, 40, cx - 10, 14, ROBE[4]);
  p.line(cx - 15, 44, cx - 8, 20, ROBE[3]);
  // face void + porcelain mask, its brow dimmed by the hood
  p.ellipse(cx, 31, 13, 16, HOOD_IN);
  p.ellipse(cx - 1, 30, 12, 15, '#0e0816');
  ball(p, cx, 34, 8.6, 11.4, MASK, false);
  // the hood's shadow falls across the brow, following the curve of the mask
  for (let y = 22; y <= 32; y++) {
    for (let x = cx - 10; x <= cx + 10; x++) {
      const nx = (x + 0.5 - cx) / 8.6;
      const ny = (y + 0.5 - 34) / 11.4;
      const edge = -0.5 - nx * nx * 0.35;
      if (ny < edge - 0.12) p.pxIn(x, y, '#4a4450');
      else if (ny < edge) p.pxIn(x, y, MASK[0]);
    }
  }
  // mournful, downturned eye slits with a cold glow
  for (const sd of [-1, 1]) {
    const ex = cx + sd * 4;
    p.line(ex - 2, 31 - (sd < 0 ? 1 : 0), ex + 2, 31 - (sd < 0 ? 0 : 1), '#14101c');
    p.line(ex - 2, 32, ex + 2, 32, '#14101c');
    p.px(ex, 31, '#c8d8ff');
    // crimson tears
    p.rect(ex - 1, 34, 2, 6, TEAR);
    p.rect(ex - 1 + sd, 40, 1, 3, TEAR);
    p.px(ex, 44, TEAR);
  }
  // stitched mouth + hairline cracks
  p.line(cx - 3, 41, cx + 3, 41, '#6a6070');
  for (let i = -2; i <= 2; i += 2) p.px(cx + i, 42, '#6a6070');
  crack(p, cx + 2, 25, cx + 6, 33, '#8e8690', 4, 0.6);
  // dead lanterns on a chain, bottom left (in front of the robe)
  p.line(2, 50, 16, 64, LANT[2]);
  for (const [x, y] of [[7, 59], [15, 68]] as const) {
    p.line(x, y - 7, x, y - 5, LANT[2]);
    p.rect(x - 3, y - 4, 7, 9, LANT[1]);
    p.rect(x - 2, y - 3, 5, 7, '#0c0a12');
    p.rect(x - 3, y - 5, 7, 1, LANT[2]);
    p.rect(x - 3, y + 5, 7, 1, LANT[0]);
    p.px(x, y - 2, '#2a2a3a');
    p.px(x, y, '#3a3448');
  }
  // the funeral bell raised beside the face, its rope in a bony hand
  p.line(53, 8, 50, 28, '#6a5a40');
  p.line(54, 8, 51, 28, '#8a7a58');
  ball(p, 53, 6, 3.6, 3, HAND, false);
  for (let i = 0; i < 3; i++) p.line(51 + i * 2, 8, 51 + i * 2, 10, HAND[1]);
  p.px(56, 6, HAND[2]);
  limb(p, 60, 14, 3.6, 55, 5, 2.6, ROBE.slice(1));
  paintBell(p, 50, 30, -0.35, false, true);
  // soul wisps
  for (const [x, y] of [[6, 24], [12, 10], [60, 64]] as const) {
    p.poly([x - 2, y + 3, x, y - 4, x + 2, y + 3], SOULBLUE[1]);
    p.px(x, y, SOULBLUE[3]);
  }
}

defineDrawnSprite('bkeep_portrait', 66, 80, (p) => {
  const tmp = new ShiftedPainter(66, 80, 6);
  paintPortrait(tmp);
  p.blit(tmp, 0, 0);
}, { outline: OUTLINE });

// ------------------------------------------------------------------ behaviour
const NAME = '조종지기';
const SOUL_COLS = ['#ffffff', '#ff9af0', '#ff56dc'];

function anim(e: Enemy, state: string, restart = false): void {
  e.setAnim(`${e.mem.p2 ? 'bkeep2' : 'bkeep'}_${state}`, restart);
}

/** World position of the bell mouth for the current pose (approx.). */
function bellPos(e: Enemy): { x: number; y: number } {
  return { x: e.x, y: e.y + 4 + (e.mem.bob ?? 0) };
}

function bellSound(w: World, big: boolean): void {
  w.sfx('hit_metal', { vol: 1, pitch: big ? 0.32 : 0.42 });
  w.sfx('slam', { vol: big ? 0.6 : 0.35, pitch: 1.5 });
}

function* fade(e: Enemy, w: World, to: number, time: number): Script {
  const from = e.alpha;
  for (let el = 0; el < time; el += w.dt) {
    e.alpha = from + (to - from) * Math.min(1, el / time);
    yield;
  }
  e.alpha = to;
}

/** Drift to a spot at mid range from the player. */
function* drift(e: Enemy, w: World, time: number): Script {
  anim(e, 'float');
  const side = w.rng.sign();
  for (let el = 0; el < time; el += w.dt) {
    const t = e.target(w);
    const a = Math.atan2(e.y - t.y, e.x - t.x) + side * 0.6 * w.dt;
    const goal = inRoom(w, t.x + Math.cos(a) * 84, t.y + Math.sin(a) * 64 - 10, 26);
    const d = Math.hypot(goal.x - e.x, goal.y - e.y);
    e.moveDir(goal.x - e.x, goal.y - e.y, Math.min(e.speed * (e.mem.p2 ? 1.35 : 1), d * 2.5));
    faceTarget(e, w);
    yield;
  }
  e.stop();
}

function* toll(e: Enemy, w: World, n: number): Script {
  const p2 = !!e.mem.p2;
  let gap = w.rng.angle();
  e.halt();
  for (let k = 0; k < n; k++) {
    anim(e, 'swing', true);
    const wind = p2 ? 0.42 : 0.6;
    e.telegraph(wind);
    w.sfx('whoosh', { vol: 0.45, pitch: 0.6 });
    gather(w, e.x - 12, e.y - 8, ['#ffffff', '#ffe0a0', '#c08a3e'], 8, 18);
    yield wind;
    anim(e, 'toll', true);
    bellSound(w, true);
    w.shake(0.3);
    const b = bellPos(e);
    for (let i = 0; i < 2; i++) w.spawn(new RingFx(b.x, b.y, 44 + i * 30, 0.35 + i * 0.15, i ? '#ff9af0' : '#fff0b8', 2));
    const fast = p2 && k % 2 === 1;
    const gaps = p2 ? [gap] : [gap, gap + Math.PI];
    shootGapRing(e, w, 26, w.rng.range(0, 0.2), gaps, 0.8, bullet('spirit', 3, { speed: fast ? 92 : 64, z: 6 }));
    gap += Math.PI / 2 + w.rng.range(-0.4, 0.4);
    yield p2 ? 0.35 : 0.55;
  }
  anim(e, 'float');
  yield 0.4;
}

function* procession(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  anim(e, 'cast', true);
  e.telegraph(0.5);
  w.sfx('orb', { vol: 0.6, pitch: 0.55 });
  yield 0.5;
  const n = p2 ? 9 : 6;
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (i / (n - 1)) * Math.PI; // upper half circle
    const x = e.x + Math.cos(a) * 30;
    const y = e.y - 8 + Math.sin(a) * 22;
    const pr = e.shoot(w, a, bullet('crypt', 3, { speed: p2 ? 120 : 105, delay: 0.55 + i * (p2 ? 0.14 : 0.2), z: 6, behaviors: [aimOnRelease(0.1)] }));
    pr.x = x;
    pr.y = y;
    w.particles.burst(x, y, { count: 5, speed: [10, 30], life: [0.2, 0.4], colors: ['#ffffff', '#ff8a7a', '#ff3a4c'], size: [1, 2] });
    w.sfx('enemy_shoot', { vol: 0.2, pitch: 1.6 + i * 0.05 });
    yield 0.07;
  }
  yield 0.55 + n * (p2 ? 0.14 : 0.2) - n * 0.07;
  anim(e, 'float');
  yield 0.3;
}

function* bellDrop(e: Enemy, w: World, follow: number): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  anim(e, 'cast', true);
  e.telegraph(0.35);
  yield 0.35;
  // vanish
  e.vulnerable = false;
  e.harmful = false;
  w.sfx('teleport', { vol: 0.5, pitch: 0.7 });
  yield* fade(e, w, 0, 0.3);
  e.hidden = true;
  // a shadow hunts the player, then locks
  const t0 = e.target(w);
  let gx = t0.x;
  let gy = t0.y;
  const lock = 0.6;
  const g = w.spawn(new GroundWarning(gx, gy, 30, follow + lock, undefined, '#ff3040'));
  for (let el = 0; el < follow; el += w.dt) {
    const t = e.target(w);
    const d = Math.hypot(t.x - gx, t.y - gy);
    const sp = Math.min(d, 150 * w.dt);
    if (d > 0.1) {
      gx += ((t.x - gx) / d) * sp;
      gy += ((t.y - gy) / d) * sp;
    }
    g.x = gx;
    g.y = gy;
    yield;
  }
  const land = landingSpot(w, gx, gy - 4, 8);
  g.x = land.x;
  g.y = land.y + 4;
  // fall from above for the last part of the lock
  yield lock - 0.32;
  e.x = land.x;
  e.y = land.y - 20;
  e.z = 150;
  e.alpha = 1;
  e.hidden = false;
  anim(e, 'float');
  w.sfx('whoosh', { vol: 0.6, pitch: 0.5 });
  for (let el = 0; el < 0.32; el += w.dt) {
    e.z = 150 * (1 - ease.inQuad(Math.min(1, el / 0.32)));
    yield;
  }
  e.z = 0;
  e.vulnerable = true;
  e.harmful = true;
  anim(e, 'toll', true);
  bellSound(w, true);
  w.sfx('slam', { vol: 1, pitch: 0.7 });
  w.shake(0.75);
  e.squash(1.3, 0.75);
  hitPlayerCircle(w, land.x, land.y + 4, 30, 2, NAME);
  w.particles.burst(land.x, land.y + 4, { count: 18, speed: [40, 130], life: [0.3, 0.6], colors: ['#ffffff', '#fff0b8', '#8a5a26'], size: [1, 2], gravity: 300, vz: [40, 120] });
  const ga = w.rng.angle();
  w.spawn(new Shockwave(land.x, land.y + 4, {
    speed: 120, maxR: 140, color: '#ff9af0', gaps: p2 ? [ga, ga + 2.1] : [ga, ga + Math.PI], gapWidth: 1.0, source: NAME, debris: SOUL_COLS,
  }));
  yield p2 ? 0.5 : 0.8;
}

function* requiem(e: Enemy, w: World): Script {
  // P2: drift to the middle and spin, the cracked bell spraying a 4-arm spiral
  const room = w.room;
  anim(e, 'float');
  for (let el = 0; el < 0.8; el += w.dt) {
    e.moveDir(room.centerX - e.x, room.centerY - 12 - e.y, Math.min(70, Math.hypot(room.centerX - e.x, room.centerY - 12 - e.y) * 3));
    yield;
  }
  e.halt();
  anim(e, 'spin', true);
  e.telegraph(0.6);
  gather(w, e.x, e.y, ['#ffffff', '#b0d0ff', '#5a8aff'], 14, 28);
  w.sfx('beam_charge', { vol: 0.6, pitch: 0.8 });
  yield 0.6;
  const dir = w.rng.sign();
  let a = w.rng.angle();
  for (let el = 0; el < 2.6; el += 0.12) {
    for (let k = 0; k < 3; k++) e.shoot(w, a + (k * Math.PI * 2) / 3, bullet('spirit', 3, { speed: 68, z: 6 }));
    if (Math.floor(el / 0.12) % 4 === 0) bellSound(w, false);
    // ≈0.85 rad/s: slow enough to walk around inside the gap between arms
    a += dir * 0.1;
    yield 0.12;
  }
  anim(e, 'float');
  yield 0.6;
}

function* summonShades(e: Enemy, w: World, n: number): Script {
  e.halt();
  anim(e, 'cast', true);
  e.telegraph(0.45);
  for (let i = 0; i < 3; i++) {
    w.sfx('hit_metal', { vol: 0.5, pitch: 1.2 + i * 0.25 });
    yield 0.15;
  }
  for (let i = 0; i < n; i++) {
    const s = spotAround(w, w.player.x, w.player.y, 60, 100, 6, true) ?? { x: e.x + (i ? 30 : -30), y: e.y };
    w.spawn(new GroundWarning(s.x, s.y, 10, 0.6, (ww) => {
      summonMinion(e, ww, 'wailing_shade', s.x, s.y, SOUL_COLS);
      ww.sfx('enemy_spawn', { vol: 0.5, pitch: 1.1 });
    }, '#c070ff'));
  }
  yield 0.8;
  anim(e, 'float');
}

function* phaseTwo(e: Enemy, w: World): Script {
  e.hidden = false;
  e.vulnerable = true;
  e.alpha = 1;
  e.z = 0;
  yield* phaseShift(e, w, {
    anim: 'bkeep_hurt',
    color: '#80b0ff',
    time: 1.4,
    onPeak: () => {
      e.mem.p2 = true;
      anim(e, 'toll', true);
      bellSound(w, true);
      w.sfx('rock_break', { vol: 0.8, pitch: 0.7 });
      const g = w.rng.angle();
      shootGapRing(e, w, 30, 0, [g, g + Math.PI], 0.8, bullet('spirit', 3, { speed: 80, z: 6 }));
      w.particles.burst(e.x, e.y + 6, { count: 20, speed: [40, 140], life: [0.3, 0.8], colors: ['#fff0b8', '#bc8a3e', '#5a3818'], size: [1, 2], gravity: 260, vz: [30, 120], shape: 'square' });
    },
  });
  const room = Math.max(0, 2 - minionCount(w, e));
  if (room > 0) yield* summonShades(e, w, room);
}

defineBoss({
  id: 'bell_keeper',
  name: NAME,
  bossTitle: '꺼진 등불을 세는 자',
  bossFloors: [1],
  hp: 700,
  radius: 13,
  speed: 46,
  mass: 5,
  flying: true,
  phasing: true,
  sprite: 'bkeep_float',
  portrait: 'bkeep_portrait',
  shadow: 0,
  deathFx: 'void',
  bloodColor: '#b890ff',
  contactDamage: 1,
  hurtSfx: 'hit',
  light: { radius: 58, color: '#b0c0ff' },
  init(e) {
    e.mem.last = null;
  },
  *script(e, w) {
    anim(e, 'float');
    yield 0.2;
    while (true) {
      if (e.phase === 0 && e.hp <= e.maxHp * 0.5) yield* phaseTwo(e, w);
      const p2 = !!e.mem.p2;
      const id = pickPattern(w.rng, [
        { id: 'toll', w: 3 },
        { id: 'procession', w: 2.4 },
        { id: 'drop', w: 2.2 },
        { id: 'summon', w: p2 ? 1 : 1.2, when: minionCount(w, e) === 0 && w.enemies.length < 4 },
        { id: 'requiem', w: 2.4, when: p2 },
      ], e.mem.last as string | null);
      e.mem.last = id;
      if (id === 'toll') yield* toll(e, w, p2 ? 3 : 2);
      else if (id === 'procession') yield* procession(e, w);
      else if (id === 'drop') {
        yield* bellDrop(e, w, 1.1);
        if (p2) yield* bellDrop(e, w, 0.7);
      } else if (id === 'summon') yield* summonShades(e, w, p2 ? 2 : 1);
      else yield* requiem(e, w);
      yield* drift(e, w, p2 ? w.rng.range(0.7, 1.1) : w.rng.range(1.0, 1.6));
    }
  },
  update(e, w) {
    e.mem.bob = Math.sin(e.age * 2.4) * 2;
    if (!e.hidden && fx.chance(e.mem.p2 ? 0.45 : 0.25)) {
      const p2 = !!e.mem.p2;
      w.particles.spawn({
        x: e.x + fx.range(-14, 14), y: e.y + 18 + fx.range(-3, 3) - e.z, vy: -fx.range(8, 20), vx: fx.range(-4, 4), life: fx.range(0.5, 1),
        colors: p2 ? ['#ffffff', '#b0d0ff', '#5a8aff'] : ['#c8c0e0', '#7c76a0', '#383052'], size: 1, additive: p2, light: p2 ? 4 : 0, alpha: 0.7,
      });
    }
  },
  draw(e, r) {
    if (e.hidden) return;
    const k = Math.min(0.7, e.z / 100);
    r.shadow(e.x, e.y + 26, 34 * (1 - k), 9 * (1 - k), 0.32 * e.alpha);
    e.drawDefault(r, e.frame(), (e.mem.bob ?? 0) - 2);
  },
  onDeath(e, w) {
    clearArena(w);
    dissolveMinions(w, e);
    bellSound(w, true);
    bossDeathBurst(w, e.x, e.y, ['#e8c070', '#bc8a3e', '#5a3818', '#56507a', '#383052']);
    w.particles.burst(e.x, e.y - 6, { count: 40, speed: [20, 110], life: [0.8, 1.8], colors: ['#ffffff', '#b0d0ff', '#ff9af0'], size: [1, 2], additive: true, light: 5, gravity: -40 });
    for (let i = 0; i < 4; i++) w.spawn(new RingFx(e.x, e.y + 4, 40 + i * 30, 0.6 + i * 0.2, i % 2 ? '#ff9af0' : '#fff0b8', 2));
  },
});
