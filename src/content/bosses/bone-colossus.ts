// Floor 1 boss: 해골 거상 (bone colossus) — 지하묘지의 문지기.
// A giant skeletal torso that drags itself out of a heap of grave bones, a rusted
// gate key hanging from its neck and a captive soul flame burning in its ribcage.
// Patterns (phase 1): twin-arm slam + shockwave, bone retch fans, heave leap +
// shockwave, skull-first charge into a wall (stagger + ceiling rubble).
// Phase 2 (≤50%): the ribcage bursts, the soul flame spills out — soul spirals,
// double shockwaves, double leaps, risen bone walkers.

import { defineBoss } from '../../game/defs';
import { packColor, PixelPainter } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { GroundWarning, RingFx } from '../../game/effects';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Script } from '../../engine/script';
import { bullet, dizzy, dust, frames, gather, landingSpot, rayFree, spinDraw, spotAround } from '../enemies/shared';
import {
  ball, boneShardSprite, bossDeathBurst, crack, dissolveMinions, dropFaller, faceTarget, hitPlayerCircle, laneWarning, limb,
  minionCount, OUTLINE, phaseShift, pickPattern, shootGapRing, ShiftedPainter, Shockwave, summonMinion, tintIn,
  clearArena,
} from './kit13';

// ------------------------------------------------------------------ palette
const BONE = ['#3a2e3e', '#665a64', '#988a7c', '#c6b99c', '#ece2c6'];
const BONE_D = ['#2e2434', '#4e4250', '#776a62', '#9a8c7c'];
const CAVITY = '#120a14';
const CAVITY_GLOW = ['#1c1030', '#2c1a52', '#46308a'];
/** bone lit by the soul flame from inside the ribcage */
const BONE_SOUL = ['#3a2e5e', '#6a5a9a', '#a898d0', '#d8d0f0'];
const RUST = ['#2a1a14', '#5a3422', '#8a5634', '#c08a54'];
const DIRT = ['#1e1824', '#2e2634', '#3e3446', '#544a5c'];
const SOUL = ['#3a2a8a', '#6a4ae0', '#a890ff', '#e0d8ff', '#ffffff'];
const EYE = '#ff3a2a';
const EYE_HOT = '#ffd0a0';

type V = [number, number];

const BONE_PACKED = new Set(BONE.map((c) => packColor(c)));
const BONE_BY_PACKED = new Map(BONE.map((c) => [packColor(c), c] as const));
interface ColPose {
  /** hands (screen-left / screen-right) */
  lh: V;
  rh: V;
  /** elbow bend (px pushed outward) */
  bend?: number;
  /** torso vertical offset */
  body?: number;
  /** head offset */
  head?: V;
  jaw?: number;
  eyes?: 'glow' | 'flare' | 'dim' | 'stun';
  /** soul flame size 0..2 */
  flame?: number;
  /** fingers curled into fists */
  fist?: boolean;
  /** horns pointing forward (charge) */
  gore?: boolean;
}

const CX = 36;
const W = 72;
const H = 62;
const ORIGIN: V = [36, 40];

// ------------------------------------------------------------------ painting
function miniSkull(p: PixelPainter, x: number, y: number, flip = false): void {
  ball(p, x, y, 3, 2.6, BONE_D, false);
  p.px(x - 1 + (flip ? 1 : 0), y, CAVITY);
  p.px(x + 1 + (flip ? 1 : 0), y, CAVITY);
  p.px(x - 1, y - 1, BONE[3]);
  p.rect(x - 1, y + 2, 3, 1, BONE_D[1]);
}

function paintHeap(p: PixelPainter, body: number): void {
  // grave dirt mound the torso is dragged through
  ball(p, CX, 54, 25, 7.5, DIRT, true);
  // ribs and long bones jutting out of the mound (behind the torso)
  limb(p, 14, 52, 1.3, 7, 47, 1, BONE_D);
  limb(p, 58, 53, 1.3, 66, 49, 1, BONE_D);
  limb(p, 22, 56, 1.2, 15, 58, 1, BONE_D);
  limb(p, 50, 57, 1.2, 58, 59, 1, BONE_D);
  miniSkull(p, 12, 56);
  miniSkull(p, 60, 55, true);
  // lumbar spine sinking into the mound
  for (let i = 0; i < 3; i++) ball(p, CX, 47 + body + i * 2.5, 3 - i * 0.4, 1.6, BONE_D, false);
}

function paintSoul(p: PixelPainter, cy: number, flame: number, burst: boolean): void {
  // a tongue-shaped soul flame; when the ribcage bursts it roars up past the ribs
  const h = burst ? 22 + flame * 2 : 9 + flame * 1.5;
  const w = burst ? 9 : 6 + flame * 0.4;
  const base = cy + 6;
  const sw = [0, 1, -1][flame % 3];
  const layer = (k: number, col: string) => {
    const hw = w * k;
    const hh = h * k;
    p.ellipse(CX, base - hw * 0.35, hw, hw * 0.75, col);
    p.poly([
      CX - hw, base - hw * 0.3,
      CX - hw * 0.8 + sw, base - hh * 0.55,
      CX - hw * 0.45 + sw, base - hh * 0.8,
      CX - hw * 0.15, base - hh * 0.5,
      CX + sw * 1.5, base - hh,
      CX + hw * 0.3, base - hh * 0.55,
      CX + hw * 0.6 - sw, base - hh * 0.82,
      CX + hw * 0.85, base - hh * 0.45,
      CX + hw, base - hw * 0.3,
    ], col);
  };
  layer(1, SOUL[0]);
  layer(0.82, SOUL[1]);
  layer(0.58, SOUL[2]);
  layer(0.34, SOUL[3]);
  p.rect(CX - 1, base - Math.round(w * 0.6), 2, 2, SOUL[4]);
  if (burst) p.px(CX + sw, base - Math.round(h * 0.45), SOUL[4]);
}

function paintRibs(p: PixelPainter, cy: number, flame: number, broken: boolean): void {
  paintCavity(p, cy, flame);
  paintRibBands(p, cy, flame, broken);
}

function paintCavity(p: PixelPainter, cy: number, flame: number): void {
  // cavity, lit purple from the flame below
  p.ellipse(CX, cy, 13, 10.5, CAVITY);
  p.ellipse(CX, cy + 3, 10, 7, CAVITY_GLOW[0]);
  p.ellipse(CX, cy + 4, 7.5 + flame * 0.5, 5.5, CAVITY_GLOW[1]);
  p.ellipse(CX, cy + 5, 5 + flame * 0.6, 3.6, CAVITY_GLOW[2]);
  // spine behind
  for (let i = 0; i < 5; i++) ball(p, CX, cy - 8 + i * 4, 1.8, 1.4, BONE_D, false);
  paintSoul(p, cy + 1, flame, false);
}

function paintRibBands(p: PixelPainter, cy: number, flame: number, broken: boolean): void {
  // ribs: curved bands left and right of the sternum
  for (let i = 0; i < 4; i++) {
    const y = cy - 7 + i * 4.2;
    const reach = 13 - Math.abs(i - 1.2) * 1.2;
    for (const side of [-1, 1]) {
      if (broken && i < 3 && side === (i % 2 ? 1 : -1)) {
        // shattered stub
        limb(p, CX + side * 2, y, 1.6, CX + side * 6, y + 1.5, 1.1, BONE);
        p.px(CX + side * 7, y + 2, BONE[4]);
        continue;
      }
      limb(p, CX + side * 2, y, 1.7, CX + side * (reach * 0.6), y - 1, 1.6, BONE);
      limb(p, CX + side * (reach * 0.6), y - 1, 1.6, CX + side * reach, y + 2.5, 1.2, BONE);
      limb(p, CX + side * reach, y + 2.5, 1.2, CX + side * (reach - 2.5), y + 4.5, 0.8, BONE);
    }
  }
  // the flame lights the lower ribs from inside
  for (let y = Math.floor(cy - 1); y <= cy + 10; y++) {
    for (let x = CX - 14; x <= CX + 14; x++) {
      const d = Math.hypot(x + 0.5 - CX, (y + 0.5 - (cy + 4)) * 1.4);
      const lim = 8 + flame * 1.5 + (broken ? 3 : 0);
      if (d > lim || !p.isSet(x, y)) continue;
      const v = p.get(x, y);
      // only recolor bone pixels (skip cavity / flame)
      if (BONE_PACKED.has(v)) p.px(x, y, BONE_SOUL[Math.min(3, Math.max(0, BONE.indexOf(BONE_BY_PACKED.get(v)!) - 1))]);
    }
  }
  // sternum plate
  if (!broken) {
    limb(p, CX, cy - 9, 2.2, CX, cy + 5, 1.6, BONE);
  } else {
    limb(p, CX, cy - 9, 2.2, CX, cy - 4, 1.8, BONE);
    p.px(CX - 1, cy - 3, BONE[4]);
    p.px(CX + 1, cy - 2, BONE[2]);
  }
}

function elbow(sh: V, hand: V, bend: number, side: number): V {
  const mx = (sh[0] + hand[0]) / 2;
  const my = (sh[1] + hand[1]) / 2;
  const dx = hand[0] - sh[0];
  const dy = hand[1] - sh[1];
  const l = Math.hypot(dx, dy) || 1;
  // perpendicular that points away from the body centre
  let px = -dy / l;
  let py = dx / l;
  if (px * side < 0) {
    px = -px;
    py = -py;
  }
  return [mx + px * bend, my + py * bend - bend * 0.3];
}

function paintArm(p: PixelPainter, sh: V, hand: V, side: number, bend: number, fist: boolean): void {
  const el = elbow(sh, hand, bend, side);
  // upper arm (humerus)
  limb(p, sh[0], sh[1], 3.6, el[0], el[1], 3, BONE);
  ball(p, el[0], el[1], 3.2, 3, BONE, false);
  // forearm: two bones
  const dx = hand[0] - el[0];
  const dy = hand[1] - el[1];
  const l = Math.hypot(dx, dy) || 1;
  const ox = (-dy / l) * 1.4;
  const oy = (dx / l) * 1.4;
  limb(p, el[0] - ox, el[1] - oy, 2, hand[0] - ox, hand[1] - oy, 1.7, BONE_D);
  limb(p, el[0] + ox, el[1] + oy, 2.2, hand[0] + ox, hand[1] + oy, 1.9, BONE);
  // hand: knuckle mass + long claw fingers splayed away from the arm
  const ha = Math.atan2(dy, dx);
  ball(p, hand[0], hand[1], 3.8, 3.2, BONE, false);
  const n = 4;
  for (let i = 0; i < n; i++) {
    const a = ha + (i - (n - 1) / 2) * (fist ? 0.35 : 0.55);
    const len = fist ? 3 : 6.5 - Math.abs(i - 1.5) * 0.8;
    const fx0 = hand[0] + Math.cos(a) * 2.5;
    const fy0 = hand[1] + Math.sin(a) * 2.5;
    const fx1 = hand[0] + Math.cos(a) * (2.5 + len);
    const fy1 = hand[1] + Math.sin(a) * (2.5 + len);
    limb(p, fx0, fy0, 1.2, fx1, fy1, 0.6, BONE);
    if (!fist) p.px(fx1, fy1, '#ffffff');
  }
  // thumb
  const ta = ha - side * 1.3;
  limb(p, hand[0], hand[1], 1.2, hand[0] + Math.cos(ta) * 5, hand[1] + Math.sin(ta) * 5, 0.6, BONE);
}

function paintKey(p: PixelPainter, cy: number, swing: number): void {
  // chain from both collarbones to the key ring
  const ky = cy + 2;
  const kx = CX + swing;
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const lx = CX - 9 + (kx - (CX - 9)) * t;
    const rx = CX + 9 + (kx - (CX + 9)) * t;
    const yy = cy - 12 + (ky - 4 - (cy - 12)) * t + Math.sin(t * Math.PI) * 2;
    p.px(lx, yy, i % 2 ? RUST[1] : RUST[2]);
    p.px(rx, yy, i % 2 ? RUST[2] : RUST[1]);
  }
  // key: bow (ring), shaft, bit
  p.ring(kx, ky - 1, 3.2, 1.6, RUST[2]);
  p.px(kx - 2, ky - 3, RUST[3]);
  p.rect(kx - 1, ky + 2, 2, 11, RUST[1]);
  p.rect(kx - 1, ky + 2, 1, 11, RUST[2]);
  p.rect(kx + 1, ky + 9, 3, 2, RUST[1]);
  p.rect(kx + 1, ky + 12, 4, 1, RUST[1]);
  p.px(kx + 3, ky + 11, RUST[0]);
  p.px(kx - 1, ky + 4, RUST[3]);
}

function paintHorn(p: PixelPainter, x: number, y: number, side: number, gore: boolean, broken: boolean): void {
  if (gore) {
    limb(p, x, y, 2.6, x + side * 5, y - 2, 1.9, BONE);
    limb(p, x + side * 5, y - 2, 1.9, x + side * 6, y + 5, 0.6, BONE);
    p.px(x + side * 6, y + 5, '#ffffff');
    return;
  }
  if (broken) {
    limb(p, x, y, 2.6, x + side * 4, y - 3, 2, BONE);
    p.px(x + side * 4, y - 4, BONE[4]);
    p.px(x + side * 5, y - 3, BONE[1]);
    return;
  }
  limb(p, x, y, 2.6, x + side * 6, y - 4, 2, BONE);
  limb(p, x + side * 6, y - 4, 2, x + side * 7, y - 10, 1.2, BONE);
  limb(p, x + side * 7, y - 10, 1.2, x + side * 5, y - 13, 0.5, BONE);
  p.px(x + side * 5, y - 13, '#ffffff');
}

function paintSkull(p: PixelPainter, hx: number, hy: number, jaw: number, eyes: ColPose['eyes'], gore: boolean, cracked: boolean): void {
  const x = CX + hx;
  const y = 14 + hy;
  // neck vertebrae
  for (let i = 0; i < 3; i++) ball(p, CX + hx * (0.3 + i * 0.2), 27 - i * 2.4, 2.3, 1.5, BONE_D, false);
  // horns behind
  paintHorn(p, x - 7, y - 3, -1, gore, false);
  paintHorn(p, x + 7, y - 3, 1, gore, cracked);
  // lower jaw — hinges open downward, with two tusks
  const jy = y + 7 + jaw;
  ball(p, x, jy, 6.2, 3, BONE, false);
  p.rect(x - 5, jy - 3, 11, 2, CAVITY);
  for (let i = 0; i < 5; i++) p.px(x - 4 + i * 2, jy - 2, BONE[4]);
  p.line(x - 5, jy - 2, x - 5, jy - 4, BONE[4]);
  p.line(x + 5, jy - 2, x + 5, jy - 4, BONE[4]);
  p.rect(x - 4, jy + 2, 9, 1, BONE[1]);
  if (jaw >= 2) {
    // throat glow
    p.rect(x - 4, y + 5, 9, jaw, '#2a0a1a');
    p.rect(x - 2, y + 5 + Math.floor(jaw / 2), 5, Math.max(1, jaw - 2), '#7a1a3a');
    p.px(x, y + 5 + Math.floor(jaw / 2), '#ff6a5a');
  }
  // cranium: long and heavy
  ball(p, x, y - 2, 9.5, 8.2, BONE, true);
  // cheekbones + maxilla
  ball(p, x - 5.5, y + 3, 3.2, 2.2, BONE, false);
  ball(p, x + 5.5, y + 3, 3.2, 2.2, BONE, false);
  ball(p, x, y + 4, 5.5, 2.6, BONE, false);
  // upper teeth with fangs
  p.rect(x - 5, y + 5, 11, 1, BONE[4]);
  for (let i = 0; i < 6; i++) p.px(x - 5 + i * 2, y + 6, BONE[2]);
  p.rect(x - 4, y + 6, 1, 2, BONE[4]);
  p.rect(x + 4, y + 6, 1, 2, BONE[4]);
  // slanted (angry) eye sockets under a heavy brow
  p.poly([x - 8, y - 2.5, x - 1, y - 0.5, x - 1.5, y + 2.6, x - 6.5, y + 2.2], CAVITY);
  p.poly([x + 8, y - 2.5, x + 1, y - 0.5, x + 1.5, y + 2.6, x + 6.5, y + 2.2], CAVITY);
  p.line(x - 8, y - 3, x - 1, y - 1, BONE[4]);
  p.line(x + 1, y - 1, x + 8, y - 3, BONE[3]);
  p.px(x, y - 1, BONE[2]);
  // forehead ridge
  p.line(x, y - 9, x, y - 4, BONE[2]);
  // nasal cavity
  p.poly([x - 1.5, y + 4.2, x, y + 1.2, x + 1.5, y + 4.2], CAVITY);
  // eye lights
  const ey = y + 1;
  if (eyes === 'flare') {
    p.rect(x - 5, ey - 1, 3, 2, EYE);
    p.rect(x + 3, ey - 1, 3, 2, EYE);
    p.px(x - 4, ey - 1, '#ffffff');
    p.px(x + 4, ey - 1, '#ffffff');
    p.px(x - 3, ey, EYE_HOT);
    p.px(x + 3, ey, EYE_HOT);
  } else if (eyes === 'dim') {
    p.px(x - 4, ey, '#8a1a1a');
    p.px(x + 4, ey, '#8a1a1a');
  } else if (eyes === 'stun') {
    p.px(x - 4, ey, '#6a1a1a');
    p.px(x + 4, ey - 1, EYE);
    p.px(x + 5, ey, EYE);
  } else {
    p.rect(x - 4, ey, 2, 1, EYE);
    p.rect(x + 3, ey, 2, 1, EYE);
    p.px(x - 3, ey, EYE_HOT);
    p.px(x + 3, ey, EYE_HOT);
  }
  if (cracked) {
    crack(p, x + 2, y - 9, x + 6, y - 2, BONE[0], 3, 0.8);
    crack(p, x - 3, y - 10, x - 1, y - 5, BONE[1], 7, 0.6);
    tintIn(p, x + 4, y - 5, 0.8, SOUL[3]);
  }
}

function paintColossus(p: PixelPainter, o: ColPose, p2: boolean): void {
  const body = o.body ?? 0;
  const head = o.head ?? [0, 0];
  const bend = o.bend ?? 5;
  paintHeap(p, body);
  // shoulder girdle + collarbones
  const shY = 27 + body;
  const lsh: V = [CX - 15, shY];
  const rsh: V = [CX + 15, shY];
  // arms (behind the shoulder knobs, in front of the mound)
  paintArm(p, lsh, o.lh, -1, bend, !!o.fist);
  paintArm(p, rsh, o.rh, 1, bend, !!o.fist);
  paintRibs(p, 38 + body, o.flame ?? 1, p2);
  limb(p, lsh[0] + 2, shY - 1, 2.4, CX - 2, shY - 3, 1.8, BONE);
  limb(p, rsh[0] - 2, shY - 1, 2.4, CX + 2, shY - 3, 1.8, BONE);
  ball(p, lsh[0], lsh[1], 5, 4.4, BONE, true);
  ball(p, rsh[0], rsh[1], 5, 4.4, BONE, true);
  // scapula spikes over the shoulders
  limb(p, lsh[0] - 1, lsh[1] - 3, 1.8, lsh[0] - 5, lsh[1] - 8, 0.5, BONE);
  limb(p, rsh[0] + 1, rsh[1] - 3, 1.8, rsh[0] + 5, rsh[1] - 8, 0.5, BONE);
  if (p2) paintSoul(p, 38 + body + 1, o.flame ?? 1, true);
  if (!p2) paintKey(p, 38 + body - 6, head[0] * 0.5);
  paintSkull(p, head[0], head[1] + body, o.jaw ?? 0, o.eyes ?? 'glow', !!o.gore, p2);
  if (p2) {
    // the broken key hangs from one strand of chain
    p.line(CX - 9, shY - 2, CX - 12, shY + 8, RUST[1]);
    p.rect(CX - 13, shY + 8, 2, 6, RUST[1]);
    p.px(CX - 13, shY + 9, RUST[3]);
    // cracks over the shoulders, soul-light leaking out
    crack(p, lsh[0] - 3, lsh[1] - 2, lsh[0] + 2, lsh[1] + 3, BONE[0], 11, 0.7);
    crack(p, rsh[0] + 3, rsh[1] - 2, rsh[0] - 1, rsh[1] + 3, BONE[0], 5, 0.7);
  }
}

// ------------------------------------------------------------------ frames
const POSES: Record<string, ColPose[]> = {
  idle: [
    { lh: [9, 52], rh: [63, 52], body: 0, flame: 0 },
    { lh: [9, 52], rh: [63, 52], body: 1, flame: 1, jaw: 1 },
    { lh: [9, 52], rh: [63, 52], body: 1, flame: 2, jaw: 1 },
    { lh: [9, 52], rh: [63, 52], body: 0, flame: 1 },
  ],
  crawl: [
    { lh: [11, 40], rh: [63, 54], body: 0, head: [-1, 0], flame: 0, fist: true },
    { lh: [7, 56], rh: [64, 50], body: 1, head: [-1, 1], flame: 1 },
    { lh: [9, 54], rh: [61, 40], body: 0, head: [1, 0], flame: 2, fist: true },
    { lh: [8, 50], rh: [65, 56], body: 1, head: [1, 1], flame: 1 },
  ],
  raise: [
    { lh: [15, 5], rh: [57, 5], bend: 6, body: -1, jaw: 2, eyes: 'flare', flame: 2, fist: true },
    { lh: [14, 4], rh: [58, 6], bend: 6, body: -2, jaw: 3, eyes: 'flare', flame: 1, fist: true },
  ],
  slam: [{ lh: [21, 56], rh: [51, 56], bend: 7, body: 2, head: [0, 2], jaw: 4, eyes: 'flare', flame: 2, fist: true }],
  roar: [
    { lh: [4, 30], rh: [68, 30], bend: 3, body: -1, head: [0, -2], jaw: 6, eyes: 'flare', flame: 2 },
    { lh: [3, 28], rh: [69, 31], bend: 3, body: -2, head: [0, -3], jaw: 7, eyes: 'flare', flame: 1 },
  ],
  retch: [
    { lh: [9, 53], rh: [63, 53], head: [0, 3], body: 1, jaw: 6, eyes: 'flare', flame: 2 },
    { lh: [9, 53], rh: [63, 53], head: [0, 2], body: 1, jaw: 5, eyes: 'flare', flame: 1 },
  ],
  charge: [
    { lh: [5, 46], rh: [67, 46], head: [0, 4], body: 2, jaw: 2, eyes: 'flare', gore: true, flame: 2, fist: true },
    { lh: [6, 49], rh: [66, 44], head: [0, 5], body: 2, jaw: 2, eyes: 'flare', gore: true, flame: 1, fist: true },
  ],
  crouch: [{ lh: [6, 55], rh: [66, 55], bend: 9, body: 3, head: [0, 2], jaw: 1, eyes: 'flare', flame: 2 }],
  air: [{ lh: [7, 24], rh: [65, 24], bend: 4, body: -3, head: [0, -2], jaw: 3, eyes: 'flare', flame: 1, fist: true }],
  stagger: [
    { lh: [13, 57], rh: [60, 54], head: [3, 3], body: 2, jaw: 3, eyes: 'stun', flame: 0 },
    { lh: [12, 57], rh: [61, 55], head: [2, 4], body: 2, jaw: 2, eyes: 'stun', flame: 1 },
  ],
};

const FPS: Record<string, number> = { idle: 4, crawl: 7, raise: 14, roar: 10, retch: 10, charge: 10, stagger: 3 };

for (const [state, poses] of Object.entries(POSES)) {
  for (const [pre, p2] of [['bcol', false], ['bcol2', true]] as const) {
    frames(pre, state, poses.length, W, H, (p, i) => paintColossus(p, poses[i], p2), { origin: ORIGIN, fps: FPS[state] ?? 8 });
  }
}

// intro-card portrait: a close-up of the roaring horned skull framed by raised claws,
// the soul flame blazing in the ribcage below
function paintPortrait(p: PixelPainter): void {
  const cx = 38;
  // soul flame glow behind the ribs
  for (const [k, col] of [[1, SOUL[0]], [0.8, SOUL[1]], [0.55, SOUL[2]], [0.3, SOUL[3]]] as const) {
    const w = 15 * k;
    const h = 26 * k;
    p.ellipse(cx, 70 - w * 0.4, w, w * 0.8, col);
    p.poly([cx - w, 70, cx - w * 0.7, 70 - h * 0.6, cx - w * 0.3, 70 - h * 0.85, cx, 70 - h * 0.55, cx + w * 0.2, 70 - h, cx + w * 0.55, 70 - h * 0.7, cx + w, 70], col);
  }
  // upper ribs arcing over the flame
  for (let i = 0; i < 3; i++) {
    const y = 58 + i * 6;
    for (const sd of [-1, 1]) {
      limb(p, cx + sd * 3, y, 2.4, cx + sd * 13, y - 2, 2.2, BONE);
      limb(p, cx + sd * 13, y - 2, 2.2, cx + sd * 20, y + 4, 1.6, BONE);
    }
  }
  // shoulders + raised arms with claws framing the skull
  for (const sd of [-1, 1]) {
    const sh: V = [cx + sd * 26, 52];
    const el: V = [cx + sd * 33, 38];
    const hand: V = [cx + sd * 30, 20];
    limb(p, sh[0], sh[1], 5, el[0], el[1], 4, BONE);
    limb(p, el[0], el[1], 3.4, hand[0], hand[1], 3, BONE);
    ball(p, el[0], el[1], 4, 3.6, BONE, false);
    ball(p, hand[0], hand[1], 5, 4.4, BONE, true);
    for (let k = 0; k < 4; k++) {
      const a = -Math.PI / 2 + sd * (-0.15 + k * 0.32);
      limb(p, hand[0] + Math.cos(a) * 3, hand[1] + Math.sin(a) * 3, 1.5, hand[0] + Math.cos(a) * 11, hand[1] + Math.sin(a) * 11, 0.6, BONE);
      p.px(hand[0] + Math.cos(a) * 11, hand[1] + Math.sin(a) * 11, '#ffffff');
    }
    ball(p, sh[0], sh[1], 8, 7, BONE, true);
    limb(p, sh[0] - sd * 5, sh[1] - 3, 2.6, cx + sd * 4, 46, 2, BONE);
  }
  // the soul flame blazes up through the ribs
  for (const [k, col] of [[1, SOUL[1]], [0.72, SOUL[2]], [0.45, SOUL[3]], [0.2, SOUL[4]]] as const) {
    const w = 8 * k + 1;
    const h = 22 * k + 2;
    p.ellipse(cx, 76 - w * 0.5, w, w * 0.8, col);
    p.poly([cx - w, 76, cx - w * 0.6, 76 - h * 0.65, cx - w * 0.2, 76 - h * 0.5, cx + w * 0.1, 76 - h, cx + w * 0.45, 76 - h * 0.6, cx + w, 76], col);
  }
  // key on its chain
  p.ring(cx, 56, 3.6, 1.8, RUST[2]);
  p.rect(cx - 1, 59, 3, 12, RUST[1]);
  p.rect(cx - 1, 59, 1, 12, RUST[3]);
  p.rect(cx + 2, 66, 4, 2, RUST[1]);
  // horns: huge, sweeping out and up to the corners
  for (const sd of [-1, 1]) {
    limb(p, cx + sd * 12, 14, 4.2, cx + sd * 22, 8, 3.4, BONE);
    limb(p, cx + sd * 22, 8, 3.4, cx + sd * 28, -2, 2.2, BONE);
    limb(p, cx + sd * 28, -2, 2.2, cx + sd * 26, -8, 0.8, BONE);
    p.px(cx + sd * 26, -7, '#ffffff');
    p.line(cx + sd * 16, 9, cx + sd * 24, 4, BONE[1]);
  }
  // lower jaw, roaring open
  ball(p, cx, 43, 11, 5, BONE, false);
  p.rect(cx - 9, 37, 19, 6, CAVITY);
  p.rect(cx - 7, 38, 15, 4, '#3a0a1e');
  p.ellipse(cx, 40, 5, 2, '#a01a3a');
  p.px(cx, 40, '#ff8a6a');
  for (let i = 0; i < 6; i++) p.px(cx - 7 + i * 3, 42, BONE[4]);
  p.rect(cx - 8, 39, 1, 4, BONE[4]);
  p.rect(cx + 8, 39, 1, 4, BONE[4]);
  // cranium
  ball(p, cx, 20, 16, 14, BONE, true);
  ball(p, cx - 9, 28, 5, 3.4, BONE, false);
  ball(p, cx + 9, 28, 5, 3.4, BONE, false);
  ball(p, cx, 31, 9, 4, BONE, false);
  // upper teeth + fangs
  p.rect(cx - 9, 34, 19, 2, BONE[4]);
  for (let i = 0; i < 9; i++) p.px(cx - 9 + i * 2, 36, BONE[2]);
  p.poly([cx - 8, 35, cx - 6, 35, cx - 7, 40], BONE[4]);
  p.poly([cx + 6, 35, cx + 8, 35, cx + 7, 40], BONE[4]);
  // slanted sockets under a heavy brow, eyes ablaze
  p.poly([cx - 14, 15, cx - 2, 19, cx - 3, 25, cx - 11, 24], CAVITY);
  p.poly([cx + 14, 15, cx + 2, 19, cx + 3, 25, cx + 11, 24], CAVITY);
  p.line(cx - 14, 14, cx - 2, 18, BONE[4]);
  p.line(cx + 2, 18, cx + 14, 14, BONE[3]);
  for (const sd of [-1, 1]) {
    const ex = cx + sd * 7;
    p.ellipse(ex, 21, 3, 2.2, '#8a1010');
    p.ellipse(ex, 21, 2, 1.4, EYE);
    p.rect(ex - 1, 20, 2, 1, EYE_HOT);
    p.px(ex - sd, 20, '#ffffff');
  }
  // nasal cavity + cracks + forehead ridge
  p.poly([cx - 2.5, 31, cx, 26, cx + 2.5, 31], CAVITY);
  p.line(cx, 6, cx, 16, BONE[2]);
  crack(p, cx + 4, 7, cx + 10, 15, BONE[0], 3, 0.9);
  crack(p, cx - 6, 8, cx - 3, 14, BONE[1], 9, 0.7);
}

defineDrawnSprite('bcol_portrait', 76, 80, (p) => {
  // shifted down so the horn tips fit
  const tmp = new ShiftedPainter(76, 80, 10);
  paintPortrait(tmp);
  p.blit(tmp, 0, 0);
}, { outline: OUTLINE });

// rubble chunk that falls from the ceiling after a charge
defineDrawnSprite('bcol_rubble', 11, 9, (p) => {
  ball(p, 5.5, 4.5, 5, 4, DIRT, true);
  ball(p, 4, 3.5, 2.5, 2, BONE_D, false);
  p.px(3, 2, BONE[4]);
}, { outline: OUTLINE });

// ------------------------------------------------------------------ behaviour
const NAME = '해골 거상';
/** spiral rotation per volley (0.12 rad / 0.13 s ≈ 0.9 rad/s) */
const SPIRAL_STEP = 0.12;

function anim(e: Enemy, state: string, restart = false): void {
  e.setAnim(`${e.mem.p2 ? 'bcol2' : 'bcol'}_${state}`, restart);
}

function shard(speed: number) {
  return { style: 'none' as const, behaviors: [spinDraw(boneShardSprite(), 13)], radius: 3, color: '#ff4a5a', light: 14, speed, z: 8 };
}

/** Lurch toward the player: surges on the arm-pull frames. */
function* crawl(e: Enemy, w: World, time: number, near = 56): Script {
  anim(e, 'crawl');
  const spd = e.speed * (e.mem.p2 ? 1.3 : 1);
  for (let el = 0; el < time; el += w.dt) {
    if (e.distToTarget(w) < near) break;
    const f = Math.floor(e.animT * 7) % 2;
    e.chase(w, spd * (f ? 1.6 : 0.35));
    faceTarget(e, w);
    if (f && fx.chance(0.15)) dust(w, e.x + fx.range(-20, 20), e.y + 16, ['#544a5c', '#3e3446'], 2, 30);
    yield;
  }
  e.stop();
}

function* slam(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  yield* crawl(e, w, 1.1, 64);
  const t = e.target(w);
  const a = Math.atan2(t.y - e.y, t.x - e.x);
  const ix = e.x + Math.cos(a) * 24;
  const iy = e.y + 14 + Math.sin(a) * 18;
  anim(e, 'raise', true);
  e.telegraph(0.75);
  w.spawn(new GroundWarning(ix, iy, 30, 0.75));
  w.sfx('enemy_roar', { vol: 0.5, pitch: 0.6 });
  yield 0.75;
  anim(e, 'slam', true);
  w.sfx('slam', { vol: 1, pitch: 0.8 });
  w.shake(0.6);
  hitPlayerCircle(w, ix, iy, 30, 2, NAME);
  dust(w, ix, iy, ['#d6caae', '#7a6e72', '#544a5c'], 16, 110);
  const g = w.rng.angle();
  w.spawn(new Shockwave(ix, iy, { speed: 125, maxR: 150, color: '#e0d0b0', gaps: [g, g + Math.PI], gapWidth: 0.95, source: NAME, debris: ['#f2ead4', '#ab9f8e'] }));
  if (p2) {
    yield 0.4;
    w.sfx('slam', { vol: 0.7, pitch: 1 });
    w.spawn(new Shockwave(ix, iy, { speed: 125, maxR: 150, color: '#a890ff', gaps: [g + Math.PI / 2, g - Math.PI / 2], gapWidth: 0.95, source: NAME, debris: ['#e0d8ff', '#6a4ae0'] }));
    yield 0.5;
  } else yield 0.8;
}

function* retch(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  anim(e, 'retch', true);
  e.telegraph(0.55);
  faceTarget(e, w);
  for (let k = 0; k < 4; k++) {
    gather(w, e.x, e.y - 14, ['#ffffff', '#ffb0a0', '#ff3a2a'], 6, 18);
    yield 0.14;
  }
  w.sfx('enemy_roar', { vol: 0.5, pitch: 0.9 });
  const bursts = p2 ? 4 : 3;
  for (let k = 0; k < bursts; k++) {
    const t = e.target(w);
    const base = Math.atan2(t.y - (e.y - 12), t.x - e.x);
    const n = p2 ? 6 : 5;
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * 0.21 + (k % 2 ? 0.1 : 0);
      const pr = e.shoot(w, a, shard(118 + k * 6));
      pr.y = e.y - 10;
    }
    w.sfx('enemy_shoot', { vol: 0.6, pitch: 0.7 });
    w.particles.burst(e.x, e.y - 12, { count: 6, speed: [30, 80], angle: base, spread: 0.6, life: [0.2, 0.4], colors: ['#f2ead4', '#ab9f8e'], size: [1, 2] });
    yield 0.34;
  }
  anim(e, 'idle');
  yield 0.5;
}

function* leap(e: Enemy, w: World, short: boolean): Script {
  const p2 = !!e.mem.p2;
  const t = e.target(w);
  const land = landingSpot(w, t.x, t.y, e.r);
  anim(e, 'crouch', true);
  const wind = short ? 0.4 : 0.55;
  const air = 0.85;
  e.telegraph(wind);
  w.spawn(new GroundWarning(land.x, land.y + 8, 34, wind + air));
  dust(w, e.x, e.y + 16, ['#544a5c', '#3e3446'], 10, 60);
  yield wind;
  anim(e, 'air');
  e.facing = land.x >= e.x ? 1 : -1;
  yield* e.jumpTo(w, land.x, land.y, air, 70);
  anim(e, 'slam', true);
  w.sfx('slam', { vol: 1, pitch: 0.7 });
  w.shake(0.85);
  hitPlayerCircle(w, e.x, e.y + 8, 34, 2, NAME);
  dust(w, e.x, e.y + 14, ['#d6caae', '#7a6e72', '#544a5c'], 20, 130);
  const g = w.rng.angle();
  w.spawn(new Shockwave(e.x, e.y + 8, {
    speed: 140, maxR: 170, color: p2 ? '#a890ff' : '#e0d0b0', gaps: p2 ? [g] : [g, g + Math.PI], gapWidth: 1.0, source: NAME,
    debris: p2 ? ['#e0d8ff', '#6a4ae0'] : ['#f2ead4', '#ab9f8e'],
  }));
  yield short ? 0.3 : 0.7;
}

function* charge(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  faceTarget(e, w);
  anim(e, 'charge', true);
  const a = e.angleToTarget(w);
  const len = rayFree(w.room, e.x, e.y, a, e.r, 320);
  laneWarning(w, e.x, e.y, a, len + e.r, e.r * 2 + 4, 0.8);
  e.telegraph(0.8);
  w.sfx('enemy_charge', { vol: 0.8, pitch: 0.6 });
  for (let k = 0; k < 4; k++) {
    dust(w, e.x - Math.cos(a) * 14, e.y + 14, ['#544a5c', '#3e3446'], 3, 40);
    yield 0.2;
  }
  e.mem.__bumped = 0;
  yield* e.charge(w, a, p2 ? 270 : 235, 1.6);
  if (!e.mem.__bumped) {
    anim(e, 'idle');
    yield 0.4;
    return;
  }
  // crash into the wall: stagger + rubble rains from the ceiling
  w.sfx('slam', { vol: 1, pitch: 0.55 });
  w.sfx('rock_break', { vol: 0.8 });
  w.shake(1);
  e.squash(0.8, 1.2);
  anim(e, 'stagger', true);
  e.knock(-Math.cos(a), -Math.sin(a), 120);
  const n = p2 ? 7 : 4;
  for (let i = 0; i < n; i++) {
    const s = i === 0 ? { x: w.player.x, y: w.player.y } : spotAround(w, w.player.x, w.player.y, 20, 110, 6);
    if (!s) continue;
    dropFaller(w, s.x, s.y, { sprite: 'bcol_rubble', time: 0.9 + i * 0.12, radius: 11, damage: 1, source: NAME, color: '#8a7a6a', spin: 3 });
  }
  for (let el = 0; el < 1.5; el += w.dt) {
    dizzy(w, e);
    yield;
  }
  anim(e, 'idle');
  yield 0.2;
}

function* soulSpiral(e: Enemy, w: World): Script {
  anim(e, 'roar', true);
  e.telegraph(0.6);
  gather(w, e.x, e.y - 2, ['#ffffff', '#a890ff', '#6a4ae0'], 14, 26);
  w.sfx('orb', { vol: 0.7, pitch: 0.6 });
  yield 0.6;
  // three slow arms: the gaps between them rotate slower than the player walks
  const dir = w.rng.sign();
  let a = w.rng.angle();
  for (let el = 0; el < 2.6; el += 0.13) {
    for (let k = 0; k < 3; k++) {
      const pr = e.shoot(w, a + (k * Math.PI * 2) / 3, bullet('spirit', 3, { speed: 72, z: 6 }));
      pr.y = e.y - 2;
    }
    if (Math.floor(el / 0.13) % 3 === 0) w.sfx('enemy_shoot', { vol: 0.3, pitch: 1.3 });
    a += dir * SPIRAL_STEP;
    yield 0.13;
  }
  anim(e, 'idle');
  yield 0.6;
}

function* raiseDead(e: Enemy, w: World): Script {
  anim(e, 'slam', true);
  e.telegraph(0.4);
  yield 0.4;
  w.sfx('summon', { vol: 0.8 });
  w.shake(0.4);
  for (const side of [-1, 1]) {
    const s = spotAround(w, e.x + side * 46, e.y + 10, 0, 24, 7) ?? { x: e.x + side * 40, y: e.y + 12 };
    w.spawn(new GroundWarning(s.x, s.y, 12, 0.6, (ww) => {
      summonMinion(e, ww, 'bone_walker', s.x, s.y, ['#f2ead4', '#ab9f8e', '#6a4ae0']);
    }, '#a890ff'));
  }
  yield 0.9;
  anim(e, 'idle');
}

function* phaseTwo(e: Enemy, w: World): Script {
  yield* phaseShift(e, w, {
    anim: 'bcol_roar',
    color: '#a890ff',
    time: 1.5,
    onPeak: () => {
      e.mem.p2 = true;
      anim(e, 'roar', true);
      const g = w.rng.angle();
      shootGapRing(e, w, 22, g, [g + 0.4, g + Math.PI + 0.4], 0.9, bullet('spirit', 3, { speed: 78, z: 6 }));
      w.particles.burst(e.x, e.y - 2, { count: 26, speed: [40, 150], life: [0.4, 0.9], colors: ['#f2ead4', '#ab9f8e', '#7a6e72'], size: [1, 3], gravity: 300, vz: [60, 160], shape: 'square' });
      w.particles.burst(e.x, e.y - 2, { count: 20, speed: [20, 90], life: [0.5, 1.0], colors: ['#ffffff', '#a890ff', '#6a4ae0'], size: [1, 2], additive: true, light: 6 });
    },
  });
  yield* raiseDead(e, w);
}

defineBoss({
  id: 'bone_colossus',
  name: NAME,
  bossTitle: '지하묘지의 문지기',
  bossFloors: [1],
  hp: 720,
  radius: 17,
  speed: 30,
  mass: 8,
  sprite: 'bcol_idle',
  portrait: 'bcol_portrait',
  shadow: 0,
  deathFx: 'bone',
  bloodColor: '#d6caae',
  contactDamage: 1,
  hurtSfx: 'hit',
  light: { radius: 64, color: '#8a70ff' },
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
        { id: 'slam', w: 3 },
        { id: 'retch', w: 2.2 },
        { id: 'leap', w: 2, when: e.distToTarget(w) > 40 },
        { id: 'charge', w: 1.8 },
        { id: 'soul', w: 2, when: p2 },
        { id: 'raise', w: 1.4, when: p2 && minionCount(w, e) < 2 && w.enemies.length < 6 },
      ], e.mem.last as string | null);
      e.mem.last = id;
      if (id === 'slam') yield* slam(e, w);
      else if (id === 'retch') yield* retch(e, w);
      else if (id === 'leap') {
        yield* leap(e, w, false);
        if (p2) yield* leap(e, w, true);
      } else if (id === 'charge') yield* charge(e, w);
      else if (id === 'soul') yield* soulSpiral(e, w);
      else yield* raiseDead(e, w);
      anim(e, 'idle');
      yield p2 ? 0.35 : 0.6;
      yield* crawl(e, w, p2 ? 0.5 : 0.9, 70);
    }
  },
  update(e, w) {
    // soul embers drifting out of the ribcage
    if (!e.hidden && fx.chance(e.mem.p2 ? 0.5 : 0.2)) {
      w.particles.spawn({
        x: e.x + fx.range(-6, 6), y: e.y - e.z - 2 + fx.range(-3, 3), vy: -fx.range(10, 26), vx: fx.range(-6, 6), life: fx.range(0.4, 0.8),
        colors: ['#ffffff', '#a890ff', '#6a4ae0'], size: 1, additive: true, light: 4,
      });
    }
  },
  draw(e, r) {
    const k = Math.min(0.6, e.z / 90);
    r.shadow(e.x, e.y + 17, 60 * (1 - k), 14 * (1 - k), 0.4);
    e.drawDefault(r);
  },
  onDeath(e, w) {
    clearArena(w);
    dissolveMinions(w, e);
    bossDeathBurst(w, e.x, e.y, ['#f2ead4', '#d6caae', '#ab9f8e', '#7a6e72']);
    w.particles.burst(e.x, e.y - 2, { count: 30, speed: [30, 120], life: [0.6, 1.4], colors: ['#ffffff', '#a890ff', '#6a4ae0'], size: [1, 2], additive: true, light: 6, gravity: -30 });
    for (let i = 0; i < 3; i++) w.spawn(new RingFx(e.x, e.y, 30 + i * 22, 0.5 + i * 0.15, '#a890ff', 2));
    for (let i = 0; i < 10; i++) w.decal(e.x + fx.range(-22, 22), e.y + fx.range(-6, 16), '#d8d0b8', fx.range(1, 2.5));
  },
});
