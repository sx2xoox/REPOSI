// Floor 6 boss: 대서기관 (the Grand Archivist) — 수몰된 서고의 필경사.
// A towering drowned scribe in a waterlogged scholar's robe, a chained tome open in
// one hand and a quill-staff in the other; its hair drifts as if still underwater.
// Whatever it writes becomes the bullet pattern.
// Phase 1: 필사 (a row of glyphs is written across the room, holds, then fires in
//   reading order at the keeper), 밑줄 (a lane warning across the room, then an ink
//   stroke sweeps along it), 책장 방벽 (page walls rise between it and the keeper, soak
//   up shots, then burst into glyph rings), 먹물 방울 (lobbed ink blots that leave
//   luminous puddles), 낱장 소환 (torn pages that hunt the keeper).
// Phase 2 (≤50%): the hood falls back, the tome blazes — 먹물 범람 (the ink rises and
//   only a few floating islands stay safe while it keeps writing), 낱장 소용돌이 (a
//   three-armed spiral of glyphs), double rows written back and forth, double underlines.

import { defineBoss, defineEnemy } from '../../game/defs';
import { Actor, Entity, type HitInfo } from '../../game/entity';
import { PixelPainter, bayer } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { clamp, TAU } from '../../engine/math';
import { GroundWarning, RingFx } from '../../game/effects';
import { Projectile } from '../../game/projectile';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { Script } from '../../engine/script';
import { frames, gather, laneWarning, lob, Lob } from '../enemies/shared';
import {
  ball, bossDeathBurst, clearEnemyShots, crack, dissolveMinions, gapRing, hash2, inRoom, insideRoom, limb, lum, minionCount,
  phaseDone, phaseGate, phaseShift, pickPattern, ShockRing, spiralAngles,
} from './final-kit';
import {
  aimAtRelease, CYAN, DROWNED, GLYPH_COUNT, GOLD6, glyphShot, glyphSprite, INDIGO, InkPool, INKC, islandSpots, OUTLINE6, PARCH, rowSpots, splash,
  summonMinion6, TEAL,
} from './kit6';

// ------------------------------------------------------------------ palette
const ROBE = ['#0a1228', '#142440', '#1e3a5a', '#2c5a74', '#3e7c8c'];
const HOOD = ['#2e2618', '#4e4028', '#726040', '#9a8456'];
const STAFF = ['#120c06', '#2e2010', '#4c3a1c'];
const QUILL = ['#04060c', '#101628', '#222c4c', '#3a4878'];
const TOME = ['#140c2a', '#28184c', '#3e2a70'];
const DEEP = '#04060c';

const W = 60;
const H = 80;
const CX = 30;
/** pivot = the scribe's chest (entity position) */
const ORIGIN: [number, number] = [30, 46];
const HEAD_Y = 15;

type V = [number, number];
interface ArchPose {
  head?: V;
  eyes?: 'calm' | 'glare';
  hem: number;
  /** tome hand */
  lh: V;
  /** staff hand */
  rh: V;
  /** staff direction (grip -> quill) */
  staffAng: number;
  tomeUp?: boolean;
  mouth?: boolean;
}

// ------------------------------------------------------------------ painting
function paintRobe(p: PixelPainter, hem: number, p2: boolean): void {
  const n = 12;
  const hemPts: number[] = [];
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    const x = 9 + 42 * t;
    const wave = Math.sin(t * 9 + hem * 1.5) * 2.5;
    hemPts.push(x, 66 + (i % 2 ? 9 : 3) + wave);
  }
  p.poly([19, 26, 41, 26, 46, 38, 51, 60, ...hemPts, 9, 60, 14, 38], ROBE[2]);
  for (let y = 25; y < H; y++) {
    for (let x = 2; x < 58; x++) {
      if (!p.isSet(x, y)) continue;
      const fold = Math.sin((x - CX) * 0.58 + hem * 0.3 + y * 0.05) * 0.5 + 0.5;
      const side = (x - CX) / 22;
      let l = 0.56 - side * 0.3 + (fold - 0.5) * 0.45 - (y - 26) / 90;
      // waterlogged: the lower robe darkens and ink stains bloom in phase 2
      if (y > 50) l -= (y - 50) / 60;
      if (p2 && hash2(Math.floor(x / 3), Math.floor(y / 3), 7) < 0.14 && y > 40) l -= 0.5;
      const idx = clamp(Math.floor(l * 5 + bayer(x, y) - 0.5), 0, 4);
      p.px(x, y, ROBE[idx]);
      // the hem dissolves into the water
      if (y > 68 && bayer(x, y) < (y - 68) / 12) p.px(x, y, null);
    }
  }
  // old-gold trim down the front and a chain belt
  for (let y = 30; y <= 64; y++) {
    const w = 1 + (y - 30) / 34;
    p.px(CX - 4 - w, y, y % 5 === 0 ? GOLD6[3] : GOLD6[2]);
    p.px(CX + 4 + w, y, y % 5 === 2 ? GOLD6[3] : GOLD6[1]);
  }
  p.line(13, 45, 47, 45, INKC[1]);
  for (let x = 14; x < 47; x += 2) p.px(x, 45, x % 4 ? STAFF[2] : GOLD6[2]);
  p.rect(CX - 1, 44, 3, 3, GOLD6[2]);
  p.px(CX, 45, GOLD6[4]);
  if (p2) {
    // luminous ink seeping down the robe
    for (let i = 0; i < 4; i++) {
      const x = 16 + i * 9 + (hem % 2);
      p.line(x, 48 + (i % 2) * 6, x + (i % 2 ? 1 : -1), 62 + (i % 3) * 4, CYAN[1]);
      p.px(x + (i % 2 ? 1 : -1), 62 + (i % 3) * 4, CYAN[3]);
    }
  }
}

function paintHair(p: PixelPainter, hx: number, hy: number, hem: number, p2: boolean): void {
  // drowned hair drifting upward as if still underwater
  const strands = p2 ? [-5, -3, -1, 1, 3, 5] : [-6, 6];
  for (let i = 0; i < strands.length; i++) {
    const sx = hx + strands[i];
    const sy = p2 ? hy - 9 : hy - 2;
    const len = p2 ? 10 + (i % 3) * 3 : 7;
    let px = sx;
    let py = sy;
    for (let k = 1; k <= len; k++) {
      const nx = sx + Math.round(Math.sin(k * 0.55 + hem * 0.9 + i * 1.3) * 1.6 + strands[i] * k * 0.06);
      const ny = sy - k;
      p.line(px, py, nx, ny, k > len - 3 ? DROWNED[4] : DROWNED[3]);
      px = nx;
      py = ny;
    }
  }
}

function paintHead(p: PixelPainter, o: ArchPose, p2: boolean): void {
  const hx = CX + (o.head?.[0] ?? 0);
  const hy = HEAD_Y + (o.head?.[1] ?? 0);
  if (!p2) {
    // scholar's hood: pointed, falling onto the shoulders
    p.poly([hx - 11, hy + 15, hx - 12, hy - 1, hx - 7, hy - 11, hx - 1, hy - 16, hx + 5, hy - 13, hx + 11, hy - 2, hx + 11, hy + 15], HOOD[2]);
    for (let y = hy - 16; y <= hy + 15; y++) {
      for (let x = hx - 12; x <= hx + 12; x++) {
        if (!p.isSet(x, y) || y > hy + 14) continue;
        p.px(x, y, HOOD[lum((x + 0.5 - hx) / 11, (y + 0.5 - hy) / 14, HOOD.length, x, y, true, -0.05)]);
      }
    }
    // gold edging of the hood
    p.line(hx - 7, hy + 9, hx - 4, hy - 7, GOLD6[2]);
    p.line(hx + 7, hy + 9, hx + 4, hy - 7, GOLD6[1]);
    // Broken gold stitches in the scholar's hood.
    for (let y = -5; y <= 7; y += 4) p.px(hx - 8, hy + y, GOLD6[3]);
    paintHair(p, hx, hy, o.hem, false);
    // the face sits in deep shadow
    p.ellipse(hx, hy + 3, 7, 9, DEEP);
  } else {
    // hood thrown back: a dark collar behind the neck
    p.poly([hx - 12, hy + 15, hx - 10, hy + 4, hx - 4, hy + 8, hx + 4, hy + 8, hx + 10, hy + 4, hx + 12, hy + 15], HOOD[1]);
    p.line(hx - 9, hy + 6, hx - 4, hy + 9, GOLD6[1]);
    paintHair(p, hx, hy, o.hem, true);
  }
  // long drowned face, set back in the hood's shadow
  ball(p, hx, hy + 3, 4.6, 7.2, DROWNED, false);
  p.line(hx, hy + 2, hx - 1, hy + 5, DROWNED[DROWNED.length - 1]);
  // the brow is lost in shadow; sunken cheeks
  for (let y = hy - 4; y <= hy - 2; y++) for (let x = hx - 5; x <= hx + 5; x++) p.pxIn(x, y, y < hy - 3 ? DEEP : DROWNED[0]);
  p.rect(hx - 4, hy + 5, 2, 2, DROWNED[1]);
  p.rect(hx + 3, hy + 5, 2, 2, DROWNED[1]);
  p.px(hx - 4, hy + 6, DROWNED[0]);
  p.px(hx + 4, hy + 6, DROWNED[0]);
  // deep eye sockets with glowing, pupil-less eyes; brighter when glaring
  const glow = o.eyes === 'glare' ? CYAN[4] : CYAN[3];
  const ey = hy + 1;
  p.rect(hx - 4, ey - 1, 3, 3, DEEP);
  p.rect(hx + 2, ey - 1, 3, 3, DEEP);
  p.rect(hx - 3, ey, 2, 1, glow);
  p.rect(hx + 2, ey, 2, 1, glow);
  p.px(hx - 3, ey - 1, CYAN[2]);
  p.px(hx + 3, ey - 1, CYAN[2]);
  p.px(hx - 3, ey + 1, CYAN[1]);
  p.px(hx + 3, ey + 1, CYAN[1]);
  if (p2) {
    // ink weeps from the eyes
    p.line(hx - 3, ey + 1, hx - 3, ey + 6, INKC[1]);
    p.line(hx + 3, ey + 1, hx + 3, ey + 5, INKC[1]);
    p.px(hx - 3, ey + 7, CYAN[2]);
    p.px(hx + 3, ey + 6, CYAN[2]);
  }
  // mouth: slack, a trickle of ink from the corner; bubbles when it speaks
  if (o.mouth) {
    p.rect(hx - 1, ey + 7, 3, 2, DEEP);
    p.px(hx + 4, ey + 5, CYAN[3]);
    p.px(hx + 5, ey + 3, CYAN[2]);
  } else {
    p.line(hx - 1, ey + 7, hx + 1, ey + 7, DEEP);
  }
  p.line(hx + 1, ey + 8, hx + 2, ey + 10, INKC[1]);
}

function paintSleeve(p: PixelPainter, sh: V, hand: V): void {
  const mx = (sh[0] + hand[0]) / 2 + (hand[0] < sh[0] ? -1 : 1);
  const my = (sh[1] + hand[1]) / 2 + 2;
  limb(p, sh[0], sh[1], 4.6, mx, my, 4.4, [ROBE[0]]);
  limb(p, mx, my, 4.4, hand[0], hand[1], 4, [ROBE[0]]);
  limb(p, sh[0], sh[1], 3.6, mx, my, 3.4, ROBE.slice(1));
  limb(p, mx, my, 3.4, hand[0], hand[1], 3.1, ROBE.slice(1));
  // gold cuff + drowned hand
  p.ellipse(hand[0], hand[1], 3.4, 1.5, GOLD6[1]);
  p.px(hand[0] - 2, hand[1], GOLD6[3]);
  ball(p, hand[0], hand[1] + 1.5, 2.2, 1.8, DROWNED, false);
  p.px(hand[0] - 1, hand[1] + 3, DROWNED[2]);
  p.px(hand[0] + 1, hand[1] + 3, DROWNED[2]);
}

function paintTome(p: PixelPainter, x: number, y: number, p2: boolean): void {
  // cover with gold corners, spine, two parchment pages
  p.rect(x - 10, y - 6, 20, 13, TOME[1]);
  p.rect(x - 10, y - 6, 20, 1, TOME[2]);
  p.rect(x - 10, y + 6, 20, 1, TOME[0]);
  for (const [cx, cy] of [[x - 10, y - 6], [x + 8, y - 6], [x - 10, y + 5], [x + 8, y + 5]] as const) {
    p.rect(cx, cy, 2, 2, GOLD6[2]);
    p.px(cx, cy, GOLD6[3]);
  }
  p.rect(x - 8, y - 5, 7, 10, PARCH[4]);
  p.rect(x + 1, y - 5, 7, 10, PARCH[3]);
  p.line(x - 8, y + 4, x - 2, y + 4, PARCH[2]);
  p.line(x + 1, y + 4, x + 7, y + 4, PARCH[1]);
  p.line(x, y - 5, x, y + 4, TOME[0]);
  // text lines + a luminous glyph on each page
  for (let r = 0; r < 4; r++) {
    p.line(x - 7, y - 3 + r * 2, x - 3 - (r % 2), y - 3 + r * 2, INKC[2]);
    p.line(x + 2, y - 3 + r * 2, x + 6 - (r % 2), y - 3 + r * 2, INKC[2]);
  }
  const g = p2 ? CYAN[3] : CYAN[2];
  p.px(x - 5, y, g);
  p.px(x + 4, y + 2, g);
  if (p2) {
    p.rect(x - 7, y - 4, 6, 8, CYAN[3]);
    p.rect(x + 2, y - 4, 5, 8, CYAN[2]);
    p.px(x - 5, y - 1, '#ffffff');
    p.px(x + 4, y + 1, '#ffffff');
    // light spilling up from the pages
    for (let i = 0; i < 3; i++) p.line(x - 6 + i * 5, y - 7, x - 6 + i * 5 + (i - 1), y - 11 - i, CYAN[1]);
  }
  // the chain that binds it to the belt
  p.line(x + 6, y + 7, CX - 2, 45, STAFF[2]);
}

function paintStaff(p: PixelPainter, gx: number, gy: number, ang: number, p2: boolean, flourish: boolean): void {
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const bx = gx - dx * 21;
  const by = gy - dy * 21;
  const tx = gx + dx * 20;
  const ty = gy + dy * 20;
  limb(p, bx, by, 1.6, tx, ty, 1.3, STAFF);
  // gold ferrule and bands
  p.circle(bx, by, 1.4, GOLD6[2]);
  p.px(bx, by - 1, GOLD6[4]);
  p.circle(gx + dx * 6, gy + dy * 6, 1.6, GOLD6[2]);
  // the quill: a long black feather, barbs shimmering indigo, nib glowing with ink
  const nx = -dy;
  const ny = dx;
  const len = 15;
  const ex = tx + dx * len;
  const ey = ty + dy * len;
  p.poly([
    tx, ty, tx + dx * 4 + nx * 2.4, ty + dy * 4 + ny * 2.4, tx + dx * 9 + nx * 3.2, ty + dy * 9 + ny * 3.2, ex + nx * 0.6, ey + ny * 0.6,
    ex - nx * 0.6, ey - ny * 0.6, tx + dx * 9 - nx * 3.2, ty + dy * 9 - ny * 3.2, tx + dx * 4 - nx * 2.4, ty + dy * 4 - ny * 2.4,
  ], QUILL[1]);
  p.line(tx, ty, ex, ey, QUILL[2]);
  for (let k = 3; k < len - 2; k += 3) {
    const sx = tx + dx * k;
    const sy = ty + dy * k;
    p.line(sx, sy, sx + nx * 2.6 + dx * 1.5, sy + ny * 2.6 + dy * 1.5, QUILL[3]);
    p.line(sx, sy, sx - nx * 2.2 + dx * 1.5, sy - ny * 2.2 + dy * 1.5, QUILL[0]);
  }
  p.px(ex, ey, p2 || flourish ? CYAN[4] : CYAN[2]);
  p.px(ex + dx, ey + dy, CYAN[3]);
  if (flourish) {
    p.px(ex + dx * 2 + nx, ey + dy * 2 + ny, CYAN[2]);
    p.px(ex + dx * 3 - nx, ey + dy * 3 - ny, CYAN[2]);
  }
}

function paintArch(p: PixelPainter, o: ArchPose, p2: boolean): void {
  paintRobe(p, o.hem, p2);
  paintSleeve(p, [21, 29], o.lh);
  paintSleeve(p, [39, 29], o.rh);
  paintHead(p, o, p2);
  paintTome(p, o.lh[0] - 2, o.lh[1] + (o.tomeUp ? -2 : 4), p2);
  paintStaff(p, o.rh[0], o.rh[1] + 1, o.staffAng, p2, o.eyes === 'glare');
  if (p2) {
    // the lit tome throws light on the robe
    for (let y = 30; y < 58; y++) {
      for (let x = 4; x < 26; x++) {
        if (!p.isSet(x, y) || hash2(x, y, 3) > 0.22) continue;
        const c = p.get(x, y);
        if (c === 0) continue;
        if ((y + x) % 3 === 0) p.pxIn(x, y, ROBE[4]);
      }
    }
  }
}

// ------------------------------------------------------------------ frames
const POSES: Record<string, ArchPose[]> = {
  float: [0, 1, 2, 3].map((i) => ({ hem: i, head: [0, [0, -1, -1, 0][i]] as V, lh: [16, 38] as V, rh: [43, 38] as V, staffAng: -1.25 + [0, 0.04, 0, -0.04][i] })),
  write: [
    { hem: 1, head: [1, -1], eyes: 'glare', lh: [15, 38], rh: [46, 30], staffAng: -0.55, mouth: true },
    { hem: 2, head: [1, -1], eyes: 'glare', lh: [15, 38], rh: [49, 31], staffAng: -0.25, mouth: true },
  ],
  cast: [
    { hem: 0, head: [0, -2], eyes: 'glare', lh: [12, 29], rh: [48, 26], staffAng: -1.45, tomeUp: true, mouth: true },
    { hem: 1, head: [0, -2], eyes: 'glare', lh: [12, 28], rh: [48, 25], staffAng: -1.5, tomeUp: true, mouth: true },
  ],
  slam: [
    { hem: 2, head: [0, -1], eyes: 'glare', lh: [16, 38], rh: [44, 22], staffAng: -1.57 },
    { hem: 3, head: [1, 1], eyes: 'glare', lh: [16, 40], rh: [46, 40], staffAng: -1.25 },
  ],
  hurt: [{ hem: 2, head: [2, 2], eyes: 'glare', lh: [14, 42], rh: [41, 43], staffAng: -0.9, mouth: true }],
};
const FPS: Record<string, number> = { float: 5, write: 9, cast: 7, slam: 8, hurt: 1 };

for (const [state, poses] of Object.entries(POSES)) {
  for (const [pre, p2] of [['arch', false], ['arch2', true]] as const) {
    frames(pre, state, poses.length, W, H, (p, i) => paintArch(p, poses[i], p2), { origin: ORIGIN, fps: FPS[state] ?? 7, outline: OUTLINE6 });
  }
}

// orbiting loose pages (three variants)
for (let i = 0; i < 3; i++) {
  defineDrawnSprite(`arch_page_${i}`, 9, 11, (p) => {
    p.poly([0, 1, 7, 0, 9, 9, 1, 11], PARCH[4]);
    p.line(1, 2, 2, 10, PARCH[2]);
    for (let r = 0; r < 4; r++) p.line(3, 2 + r * 2, 6 + (r % 2), 2 + r * 2, INKC[2]);
    p.px(4 + i, 3 + i, CYAN[2]);
    if (i === 1) p.px(2, 1, PARCH[1]);
  }, { outline: OUTLINE6 });
}

// page wall: a tall sheet standing in the water, fluttering (two frames)
for (let i = 0; i < 2; i++) {
  defineDrawnSprite(`arch_pagewall_${i}`, 16, 24, (p) => {
    const s = i ? 1 : -1;
    p.poly([1, 2 + s, 14, 1 - s, 15, 22 + s, 2, 23 - s], PARCH[4]);
    for (let y = 2; y < 23; y++) {
      for (let x = 1; x < 15; x++) {
        if (!p.isSet(x, y)) continue;
        const k = 0.65 + Math.sin(x * 0.8 + i) * 0.15 - y / 80;
        p.px(x, y, PARCH[clamp(Math.floor(k * 6 + bayer(x, y) - 0.5), 1, 5)]);
      }
    }
    for (let r = 0; r < 6; r++) p.line(3, 5 + r * 3, 11 + (r % 2), 5 + r * 3, INKC[2]);
    p.px(5, 8, CYAN[2]);
    p.px(9, 14, CYAN[2]);
    p.px(6, 17, CYAN[3]);
    // torn, waterlogged lower edge
    p.line(2, 22, 5, 23, TEAL[3]);
    p.line(10, 23, 14, 22, TEAL[3]);
  }, { outline: OUTLINE6, anchor: 'bottom' });
}

// lobbed ink blot
defineDrawnSprite('arch_inkdrop', 9, 9, (p) => {
  // a blot of luminous ink: dark heart, glowing rim so it reads in the air
  p.circle(4.5, 4.5, 4, CYAN[1]);
  p.circle(4.5, 4.5, 3, INKC[2]);
  p.circle(4, 4, 1.8, INKC[1]);
  p.px(3, 3, CYAN[3]);
  p.px(6, 6, CYAN[2]);
  p.px(2, 2, CYAN[4]);
}, { outline: OUTLINE6 });

// minion: a torn page that flies (two flutter frames)
for (let i = 0; i < 2; i++) {
  defineDrawnSprite(`apage_fly_${i}`, 13, 14, (p) => {
    const s = i ? 1 : 0;
    p.poly([1, 1 + s, 12, 0, 11, 12 + s, 2, 13 - s], PARCH[4]);
    for (let y = 1; y < 13; y++) for (let x = 1; x < 12; x++) if (p.isSet(x, y) && x > 8) p.px(x, y, PARCH[3]);
    for (let r = 0; r < 3; r++) p.line(3, 3 + r * 3, 8, 3 + r * 3, INKC[2]);
    // a single glyph-eye watches
    p.rect(5, 6, 3, 2, INKC[1]);
    p.px(6, 6, CYAN[3]);
    p.px(6, 7, CYAN[2]);
    p.line(1, 12 - s, 4, 13 - s, TEAL[3]);
  }, { outline: OUTLINE6 });
}

// intro-card portrait: the drowned face half out of its hood, the tome glowing below, the quill raised
defineDrawnSprite('arch_portrait', 66, 86, (p) => {
  const cx = 31;
  // shoulders / robe
  p.poly([2, 86, 6, 60, 18, 50, 44, 50, 58, 60, 64, 86], ROBE[2]);
  for (let y = 50; y < 86; y++) {
    for (let x = 0; x < 66; x++) {
      if (!p.isSet(x, y)) continue;
      const fold = Math.sin((x - cx) * 0.4) * 0.5 + 0.5;
      const l = 0.55 - (x - cx) / 44 + (fold - 0.5) * 0.4 - (y - 50) / 70;
      p.px(x, y, ROBE[clamp(Math.floor(l * 5 + bayer(x, y) - 0.5), 0, 4)]);
    }
  }
  for (let y = 56; y < 86; y++) {
    p.px(cx - 6 - (y - 56) / 10, y, y % 5 ? GOLD6[2] : GOLD6[3]);
    p.px(cx + 6 + (y - 56) / 10, y, y % 5 ? GOLD6[1] : GOLD6[3]);
  }
  // hood
  p.poly([cx - 21, 52, cx - 23, 24, cx - 14, 6, cx - 2, -2, cx + 10, 2, cx + 22, 22, cx + 21, 52], HOOD[2]);
  for (let y = 0; y < 52; y++) {
    for (let x = 4; x < 60; x++) {
      if (!p.isSet(x, y)) continue;
      p.px(x, y, HOOD[lum((x + 0.5 - cx) / 22, (y + 0.5 - 26) / 26, HOOD.length, x, y, true, -0.05)]);
    }
  }
  p.line(cx - 14, 46, cx - 9, 14, GOLD6[2]);
  p.line(cx + 14, 46, cx + 9, 14, GOLD6[1]);
  // face void + drowned face
  p.ellipse(cx, 30, 13, 18, DEEP);
  ball(p, cx, 32, 9.4, 14, DROWNED, false);
  // sunken cheeks, the hood's shadow on the brow
  for (let y = 18; y <= 24; y++) for (let x = cx - 9; x <= cx + 9; x++) p.pxIn(x, y, y < 21 ? DROWNED[0] : DROWNED[1]);
  p.ellipse(cx - 5, 36, 2.5, 3, DROWNED[1]);
  p.ellipse(cx + 5, 36, 2.5, 3, DROWNED[1]);
  // glowing eyes
  for (const sd of [-1, 1]) {
    const ex = cx + sd * 4;
    p.rect(ex - 2, 27, 4, 2, CYAN[3]);
    p.rect(ex - 1, 27, 2, 1, CYAN[4]);
    p.rect(ex - 2, 26, 4, 1, CYAN[1]);
    p.rect(ex - 2, 29, 4, 1, CYAN[1]);
    // ink weeping down the cheek
    p.line(ex + sd, 30, ex + sd, 38, INKC[1]);
    p.px(ex + sd, 39, CYAN[2]);
  }
  // slack mouth with bubbles
  p.rect(cx - 2, 41, 5, 2, DEEP);
  p.px(cx - 1, 41, DROWNED[0]);
  p.line(cx + 3, 43, cx + 5, 47, INKC[1]);
  for (const [bx, by, br] of [[cx + 9, 36, 1], [cx + 12, 31, 1.5], [cx + 15, 24, 1]] as const) {
    p.ring(bx, by, br + 0.6, 1, CYAN[2]);
    p.px(bx - 1, by - 1, CYAN[4]);
  }
  // hair drifting out of the hood
  for (let i = 0; i < 4; i++) {
    const sx = cx - 11 + i * 7;
    let px = sx;
    let py = 12;
    for (let k = 1; k <= 10; k++) {
      const nx = sx + Math.round(Math.sin(k * 0.6 + i) * 2);
      const ny = 12 - k;
      p.line(px, py, nx, ny, k > 7 ? DROWNED[4] : DROWNED[3]);
      px = nx;
      py = ny;
    }
  }
  // the quill-staff raised on the right, the tome glowing bottom left
  limb(p, 60, 84, 1.8, 50, 20, 1.4, STAFF);
  p.circle(50, 20, 1.8, GOLD6[2]);
  p.poly([50, 20, 54, 10, 57, 2, 52, 4, 47, 12], QUILL[1]);
  p.line(50, 20, 56, 3, QUILL[2]);
  p.px(56, 2, CYAN[4]);
  p.px(57, 1, CYAN[3]);
  p.px(55, 6, CYAN[2]);
  paintTome(p, 12, 76, true);
  crack(p, cx - 8, 16, cx - 12, 28, HOOD[0], 5, 0.6);
}, { outline: OUTLINE6 });

// ------------------------------------------------------------------ arena pieces
const NAME = '대서기관';
const INK_FX = [CYAN[4], CYAN[2], INDIGO[3]];
const PAPER_FX = [PARCH[5], PARCH[3], PARCH[1]];

/** A standing page: soaks up the keeper's shots, then bursts into a ring of glyphs. */
class PageWall extends Actor {
  owner: Enemy;
  life: number;
  constructor(x: number, y: number, owner: Enemy, life: number) {
    super();
    this.x = x;
    this.y = y;
    this.owner = owner;
    this.life = life;
    this.team = 'neutral';
    this.r = 7;
    this.hp = this.maxHp = 60;
    this.layer = 1;
    this.tileCollide = false;
    this.enemyHazard = true;
  }

  override get sortY(): number {
    return this.y + 4;
  }

  /** Erased by a bullet-clear: tears apart harmlessly. */
  override onCleared(w: World): void {
    this.tear(w);
  }

  override takeHit(w: World, hit: HitInfo): boolean {
    if (this.dead) return false;
    this.hp -= hit.damage;
    this.flash = 0.08;
    this.squash(1.15, 0.9);
    w.particles.burst(this.x, this.y - 10, { count: 4, speed: [30, 80], life: [0.2, 0.4], colors: PAPER_FX, size: [1, 2], gravity: 200, vz: [20, 60] });
    if (this.hp <= 0) this.tear(w);
    return true;
  }

  tear(w: World): void {
    if (this.dead) return;
    this.dead = true;
    w.particles.burst(this.x, this.y - 10, { count: 16, speed: [30, 110], life: [0.4, 0.9], colors: PAPER_FX, size: [1, 3], gravity: 120, vz: [20, 90], shape: 'square', vrot: 9, drag: 2 });
    w.sfx('page_rip', { vol: 0.5, pitch: fx.range(0.9, 1.2) });
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.flash > 0) this.flash -= dt;
    this.updateSquash(dt);
    if (!this.owner.alive) {
      this.tear(w);
      return;
    }
    if (this.age >= this.life) {
      this.dead = true;
      // the page bursts into glyphs — a gapped ring, the gap facing the keeper's side is random
      const p = w.player;
      const g = Math.atan2(p.y - this.y, p.x - this.x) + w.rng.range(-0.9, 0.9);
      let i = 0;
      for (const a of gapRing(10, w.rng.range(0, 0.6), [g], 1.1)) {
        w.spawn(new Projectile({ ...glyphShot(i++, 82), team: 'enemy', x: this.x + Math.cos(a) * 4, y: this.y - 8 + Math.sin(a) * 4, angle: a, speed: 82, damage: 1, owner: this.owner }));
      }
      w.particles.burst(this.x, this.y - 10, { count: 14, speed: [40, 120], life: [0.3, 0.7], colors: PAPER_FX, size: [1, 2], gravity: 160, vz: [20, 80], shape: 'square', vrot: 8 });
      w.spawn(new RingFx(this.x, this.y - 8, 18, 0.3, CYAN[2], 2));
      w.sfx('page_rip', { vol: 0.6, pitch: 0.8 });
      w.sfx('enemy_shoot', { vol: 0.4, pitch: 0.9 });
    }
  }

  override draw(r: Renderer): void {
    r.shadow(this.x, this.y + 1, 14, 5, 0.3);
    const soon = this.life - this.age < 0.6;
    const blink = soon && Math.floor(this.age * 16) % 2 === 0;
    const f = Math.floor(this.age * 6) % 2;
    r.sprite(`arch_pagewall_${f}`, this.x, this.y - 1, { sx: this.squashX, sy: this.squashY, flash: this.flash > 0 ? 0.9 : blink ? 0.55 : 0, tint: soon ? CYAN[2] : undefined, tintAmount: soon ? 0.25 : 0 });
    if (soon) r.ring(this.x, this.y - 8, 10 + (0.6 - (this.life - this.age)) * 12, CYAN[2], 1, 0.6);
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 10, 24, '#60d0ff', { intensity: this.life - this.age < 0.6 ? 0.8 : 0.35 });
  }
}

interface StrokeOpts {
  source: string;
  sweep?: number;
  linger?: number;
  half?: number;
  damage?: number;
}

/** An ink stroke the quill drags across the floor: the drawn part hurts, once. */
class InkStroke extends Entity {
  angle: number;
  len: number;
  o: StrokeOpts;
  hit = false;
  constructor(x: number, y: number, angle: number, len: number, o: StrokeOpts) {
    super();
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.len = len;
    this.o = o;
    this.layer = 0;
    this.tileCollide = false;
    this.team = 'enemy';
  }

  get sweep(): number {
    return this.o.sweep ?? 0.32;
  }

  /** drawn length so far */
  get head(): number {
    return this.len * clamp(this.age / this.sweep, 0, 1);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    for (const p of w.targets()) {
      if (!this.hit && this.age < this.sweep + 0.12 && p.alive && p.z < 6) {
        const t = (p.x - this.x) * c + (p.y - this.y) * s;
        const d = Math.abs(-(p.x - this.x) * s + (p.y - this.y) * c);
        if (t >= -4 && t <= this.head + 4 && d < (this.o.half ?? 7) + p.r * 0.6) {
          if (p.hurt(w, this.o.damage ?? 1, this.o.source)) {
            const side = -(p.x - this.x) * s + (p.y - this.y) * c >= 0 ? 1 : -1;
            p.knock(-s * side, c * side, 200);
            this.hit = true;
          }
        }
      }
    }
    if (this.age < this.sweep) {
      const hx = this.x + c * this.head;
      const hy = this.y + s * this.head;
      w.particles.burst(hx, hy, { count: 2, speed: [20, 70], life: [0.2, 0.4], colors: INK_FX, size: [1, 2], gravity: 240, vz: [20, 60] });
    }
    if (this.age >= this.sweep + (this.o.linger ?? 0.6)) this.dead = true;
  }

  override draw(r: Renderer): void {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const hx = this.x + c * this.head;
    const hy = this.y + s * this.head;
    const t = (this.age - this.sweep) / (this.o.linger ?? 0.6);
    const a = this.age < this.sweep ? 1 : clamp(1 - t, 0, 1);
    const half = this.o.half ?? 7;
    r.line(this.x, this.y, hx, hy, INKC[1], half * 2 * (0.8 + 0.2 * a), 0.9 * a);
    r.line(this.x, this.y, hx, hy, INDIGO[2], half * 1.1, 0.8 * a);
    r.line(this.x, this.y, hx, hy, CYAN[2], 1.5, (0.55 + 0.35 * Math.sin(this.age * 30)) * a);
    // splatter along the stroke (deterministic)
    for (let k = 8; k < this.head; k += 11) {
      const j = (hash2(k, Math.round(this.y), 2) - 0.5) * half * 2.6;
      r.circle(this.x + c * k - s * j, this.y + s * k + c * j, 1 + hash2(k, 1, 4) * 1.5, INKC[1], 0.8 * a);
    }
    if (this.age < this.sweep) {
      r.circle(hx, hy, 4, CYAN[3], 0.9);
      r.circle(hx, hy, 2, '#ffffff', 1);
    }
  }

  override light(w: World): void {
    const n = Math.max(1, Math.floor(this.head / 40));
    const a = this.age < this.sweep ? 1 : clamp(1 - (this.age - this.sweep) / (this.o.linger ?? 0.6), 0, 1);
    for (let i = 0; i <= n; i++) {
      const k = (i / n) * this.head;
      w.lights.add(this.x + Math.cos(this.angle) * k, this.y + Math.sin(this.angle) * k, 26, '#40c8ff', { intensity: 0.5 * a });
    }
  }
}

interface FloodOpts {
  rise: number;
  hold: number;
  drain: number;
  source: string;
  islandR: number;
}

/** 먹물 범람: the ink rises over the whole floor; only the islands stay safe. */
class InkFlood extends Entity {
  owner: Enemy;
  islands: { x: number; y: number }[];
  o: FloodOpts;
  level = 0;
  draining = false;
  private drainT = 0;
  constructor(owner: Enemy, islands: { x: number; y: number }[], o: FloodOpts) {
    super();
    this.owner = owner;
    this.islands = islands;
    this.o = o;
    this.layer = 0;
    this.tileCollide = false;
    this.team = 'enemy';
  }

  get armed(): boolean {
    return !this.draining && this.age >= this.o.rise;
  }

  get done(): boolean {
    return this.dead;
  }

  drain(): void {
    if (this.draining) return;
    this.draining = true;
    this.drainT = 0;
  }

  onIsland(x: number, y: number, slack = 0): boolean {
    return this.islands.some((i) => Math.hypot(x - i.x, y - i.y) <= this.o.islandR + slack);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (!this.owner.alive) this.drain();
    if (!this.draining && this.age >= this.o.rise + this.o.hold) this.drain();
    if (this.draining) {
      this.drainT += dt;
      this.level = Math.max(0, 1 - this.drainT / this.o.drain);
      if (this.drainT >= this.o.drain) this.dead = true;
    } else this.level = clamp(this.age / this.o.rise, 0, 1);
    for (const p of w.targets()) {
      if (this.armed && p.alive && p.z < 4 && insideRoom(w, p.x, p.y, -4) && !this.onIsland(p.x, p.y, p.r * 0.5)) {
        if (p.hurt(w, 1, this.o.source)) {
          // pushed toward the nearest island so a hit also helps you out
          let best = this.islands[0];
          for (const i of this.islands) if (Math.hypot(i.x - p.x, i.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y)) best = i;
          const d = Math.hypot(best.x - p.x, best.y - p.y) || 1;
          p.knock((best.x - p.x) / d, (best.y - p.y) / d, 120);
        }
      }
    }
    // floating paper on the ink
    if (this.level > 0.3 && fx.chance(0.5)) {
      const room = w.room;
      w.particles.spawn({
        x: room.interiorX + fx.range(0, room.interiorW), y: room.interiorY + fx.range(0, room.interiorH), vx: fx.range(-6, 6), vy: fx.range(-4, 4),
        life: fx.range(0.8, 1.6), colors: [PARCH[4], PARCH[3], CYAN[2]], size: fx.range(1, 2), alpha: 0.8, fade: true,
      });
    }
  }

  override draw(r: Renderer, w: World): void {
    if (this.level <= 0.01) return;
    const room = w.room;
    const c = r.ctx;
    const vx = r.viewX;
    const vy = r.viewY;
    const R = this.o.islandR;
    const lv = this.level;
    c.save();
    // ink sheet with island holes (even-odd), rising from dark teal to ink black
    c.globalAlpha = 0.82 * lv;
    c.fillStyle = INKC[1];
    c.beginPath();
    c.rect(room.interiorX - vx - 2, room.interiorY - vy - 2, room.interiorW + 4, room.interiorH + 4);
    for (const i of this.islands) {
      c.moveTo(i.x - vx + R, i.y - vy);
      c.arc(i.x - vx, i.y - vy, R, 0, TAU);
    }
    c.fill('evenodd');
    // slow highlight waves on the surface
    c.globalAlpha = 0.18 * lv;
    c.strokeStyle = INDIGO[3];
    c.lineWidth = 1;
    for (let k = 0; k < 6; k++) {
      const y = room.interiorY + ((k + 0.5) / 6) * room.interiorH + Math.sin(this.age * 0.8 + k) * 4;
      c.beginPath();
      for (let x = room.interiorX; x <= room.interiorX + room.interiorW; x += 8) {
        const yy = y + Math.sin(x * 0.08 + this.age * 1.6 + k * 2) * 2;
        if (x === room.interiorX) c.moveTo(x - vx, yy - vy);
        else c.lineTo(x - vx, yy - vy);
      }
      c.stroke();
    }
    c.restore();
    // islands: a cyan rim, glowing brighter while the ink still rises (find them!)
    const rising = !this.armed && !this.draining;
    for (const i of this.islands) {
      const pulse = rising ? 0.6 + 0.4 * Math.sin(this.age * 14) : 0.55 + 0.15 * Math.sin(this.age * 4);
      r.ring(i.x, i.y, R, CYAN[2], rising ? 2 : 1, pulse * lv);
      r.ring(i.x, i.y, R - 2, CYAN[1], 1, 0.5 * lv);
      if (rising) r.ring(i.x, i.y, R + 6 + Math.sin(this.age * 6) * 3, CYAN[3], 1, 0.4 * lv);
      // a few floating books mark the island
      r.sprite('arch_page_0', i.x - 9, i.y + 3, { rot: 0.3, alpha: lv });
      r.sprite('arch_page_2', i.x + 8, i.y - 5, { rot: -0.5, alpha: lv });
      r.sprite('arch_page_1', i.x + 2, i.y + 9, { rot: 0.9, alpha: lv });
    }
  }

  override light(w: World): void {
    for (const i of this.islands) w.lights.add(i.x, i.y, this.o.islandR * 2.4, '#30c0ff', { intensity: 0.55 * this.level });
  }
}

// ------------------------------------------------------------------ minion: 떠도는 낱장
defineEnemy({
  id: 'archive_page',
  name: '떠도는 낱장',
  hp: 18,
  radius: 5,
  speed: 50,
  flying: true,
  sprite: 'apage_fly_0',
  shadow: 8,
  spriteYOffset: -7,
  deathFx: 'bone',
  bloodColor: '#dcc896',
  contactDamage: 1,
  light: { radius: 18, color: '#60d0ff' },
  *script(e, w) {
    const ph = w.rng.angle();
    let side = w.rng.sign();
    while (true) {
      // circle the keeper at mid range, flapping
      for (let el = 0; el < w.rng.range(1.6, 2.4); el += w.dt) {
        const t = e.target(w);
        const a = Math.atan2(e.y - t.y, e.x - t.x) + side * 0.9 * w.dt;
        const gx = t.x + Math.cos(a) * 72;
        const gy = t.y + Math.sin(a) * 56;
        const d = Math.hypot(gx - e.x, gy - e.y);
        e.moveDir(gx - e.x, gy - e.y, Math.min(e.speed, d * 2.5));
        e.setAnim(`apage_fly_${Math.floor((e.age + ph) * 9) % 2}`);
        yield;
      }
      e.stop();
      e.telegraph(0.45);
      yield 0.45;
      e.shoot(w, e.angleToTarget(w), glyphShot(w.rng.int(0, GLYPH_COUNT - 1), 98));
      w.sfx('enemy_shoot', { vol: 0.3, pitch: 1.5 });
      if (w.rng.chance(0.4)) side = -side;
      yield 0.3;
    }
  },
});

// ------------------------------------------------------------------ behaviour
function anim(e: Enemy, state: string, restart = false): void {
  e.setAnim(`${e.mem.p2 ? 'arch2' : 'arch'}_${state}`, restart);
}

/** World position of the quill tip for the current pose (approx.). */
function quillTip(e: Enemy): { x: number; y: number } {
  return { x: e.x + e.facing * 20, y: e.y - 26 + (e.mem.bob ?? 0) };
}

function quillInk(w: World, x: number, y: number, n = 4): void {
  w.particles.burst(x, y, { count: n, speed: [10, 40], life: [0.2, 0.45], colors: INK_FX, size: [1, 2], additive: true, light: 4, gravity: 120 });
}

/** Drift to a spot at mid range from the keeper, mostly above it. */
function* drift(e: Enemy, w: World, time: number): Script {
  anim(e, 'float');
  const room = w.room;
  const side = w.rng.sign();
  for (let el = 0; el < time; el += w.dt) {
    const t = e.target(w);
    const gx = clamp(t.x + side * 64 + Math.sin(e.age * 0.9) * 16, room.interiorX + 30, room.interiorX + room.interiorW - 30);
    const gy = clamp(Math.min(t.y - 54, room.interiorY + 52), room.interiorY + 36, room.interiorY + room.interiorH - 44);
    const d = Math.hypot(gx - e.x, gy - e.y);
    e.moveDir(gx - e.x, gy - e.y, Math.min(e.speed * (e.mem.p2 ? 1.3 : 1), d * 2.2));
    e.facing = t.x >= e.x ? 1 : -1;
    yield;
  }
  e.stop();
}

function* moveTo(e: Enemy, w: World, x: number, y: number, time: number): Script {
  anim(e, 'float');
  for (let el = 0; el < time; el += w.dt) {
    const d = Math.hypot(x - e.x, y - e.y);
    e.moveDir(x - e.x, y - e.y, Math.min(100, d * 3));
    yield;
  }
  e.halt();
}

/**
 * 필사: the quill writes `rows` rows of glyphs across the room (back and forth).
 * Every glyph holds where it was written, then they fly at the keeper in reading order.
 */
function* transcribe(e: Enemy, w: World, rows: number, hold = 0.85): Script {
  const p2 = !!e.mem.p2;
  const room = w.room;
  e.halt();
  anim(e, 'write', true);
  e.telegraph(0.45);
  w.sfx('quill_write', { vol: 0.5, pitch: 0.8 });
  yield 0.45;
  const n = p2 ? 9 : 7;
  const stagger = p2 ? 0.11 : 0.13;
  let total = 0;
  for (let r = 0; r < rows; r++) {
    const t = e.target(w);
    const y = clamp(t.y + (r ? (r % 2 ? -46 : 46) : 0) + w.rng.range(-8, 8), room.interiorY + 14, room.interiorY + room.interiorH - 14);
    const dir = r % 2 ? -1 : 1;
    const spots = rowSpots(room.interiorX + 16, room.interiorX + room.interiorW - 16, y, n);
    if (dir < 0) spots.reverse();
    e.facing = dir;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      // the row waits `hold` after the last glyph is written, then fires one glyph per `stagger`
      const delay = (n - i) * 0.07 + hold + i * stagger;
      const pr = e.shoot(w, Math.PI / 2, glyphShot(w.rng.int(0, GLYPH_COUNT - 1), p2 ? 104 : 92, { delay, behaviors: [aimAtRelease(0.1)] }));
      pr.x = s.x;
      pr.y = s.y;
      quillInk(w, s.x, s.y, 3);
      w.sfx('quill_write', { vol: 0.3, pitch: 1.1 + i * 0.05 });
      total = Math.max(total, delay);
      yield 0.07;
    }
    if (r + 1 < rows) yield 0.2;
  }
  anim(e, 'float');
  yield Math.max(0.4, total - 0.3);
}

/** 밑줄: lane warnings across the room at the keeper's height, then ink strokes sweep along them. */
function* underline(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  const room = w.room;
  e.halt();
  anim(e, 'slam', true);
  e.telegraph(0.5);
  w.sfx('quill_write', { vol: 0.5, pitch: 0.6 });
  yield 0.3;
  const t = e.target(w);
  const ys = [clamp(t.y, room.interiorY + 12, room.interiorY + room.interiorH - 12)];
  if (p2) ys.push(clamp(t.y + (t.y > room.centerY ? -44 : 44), room.interiorY + 12, room.interiorY + room.interiorH - 12));
  const warn = p2 ? 0.7 : 0.8;
  for (const y of ys) laneWarning(w, room.interiorX, y, 0, room.interiorW, 14, warn);
  w.sfx('warn', { vol: 0.35, pitch: 0.8 });
  yield warn;
  const fromLeft = e.x < room.centerX;
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i];
    const x0 = fromLeft ? room.interiorX : room.interiorX + room.interiorW;
    w.spawn(new InkStroke(x0, y, fromLeft ? 0 : Math.PI, room.interiorW, { source: NAME, sweep: 0.3, half: 7 }));
    w.sfx('ink_burst', { vol: 0.7, pitch: 0.9 - i * 0.1 });
    w.shake(0.25);
    if (i + 1 < ys.length) yield 0.25;
  }
  yield 0.5;
  if (p2) {
    // a vertical margin line through the keeper's column
    const t2 = e.target(w);
    const x = clamp(t2.x, room.interiorX + 12, room.interiorX + room.interiorW - 12);
    laneWarning(w, x, room.interiorY, Math.PI / 2, room.interiorH, 14, 0.65);
    w.sfx('warn', { vol: 0.3, pitch: 1.0 });
    yield 0.65;
    w.spawn(new InkStroke(x, room.interiorY, Math.PI / 2, room.interiorH, { source: NAME, sweep: 0.26, half: 7 }));
    w.sfx('ink_burst', { vol: 0.6, pitch: 1.1 });
    yield 0.4;
  }
  anim(e, 'float');
  yield 0.3;
}

/** 책장 방벽: pages rise between it and the keeper, soak up shots, then burst. */
function* pageWalls(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  anim(e, 'cast', true);
  e.telegraph(0.5);
  w.sfx('page_rip', { vol: 0.35, pitch: 1.4 });
  yield 0.5;
  const n = p2 ? 5 : 3;
  const t = e.target(w);
  const base = Math.atan2(t.y - e.y, t.x - e.x);
  const life = p2 ? 3.2 : 3.6;
  for (let k = 0; k < n; k++) {
    const a = base + (k - (n - 1) / 2) * (p2 ? 0.36 : 0.44);
    const s = inRoom(w, e.x + Math.cos(a) * 44, e.y + 8 + Math.sin(a) * 36, 14);
    w.spawn(new PageWall(s.x, s.y, e, life + k * 0.12));
    w.particles.burst(s.x, s.y, { count: 8, speed: [20, 60], life: [0.3, 0.5], colors: [TEAL[5], TEAL[4], '#ffffff'], size: [1, 2], gravity: 260, vz: [30, 90] });
    w.sfx('ink_burst', { vol: 0.3, pitch: 1.3 + k * 0.08 });
    yield 0.1;
  }
  anim(e, 'float');
  yield 0.6;
}

/** 먹물 방울: lobbed ink blots at and around the keeper, each leaving a luminous puddle. */
function* inkDrops(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  anim(e, 'slam', true);
  e.telegraph(0.45);
  w.sfx('quill_write', { vol: 0.4, pitch: 0.7 });
  yield 0.45;
  const n = p2 ? 6 : 4;
  for (let k = 0; k < n; k++) {
    const t = e.target(w);
    const spread = k === 0 ? 0 : 28 + k * 6;
    const a = w.rng.angle();
    const s = inRoom(w, t.x + Math.cos(a) * spread, t.y + Math.sin(a) * spread * 0.7, 14);
    const q = quillTip(e);
    lob(w, q.x, q.y, s.x, s.y, {
      sprite: 'arch_inkdrop', color: CYAN[2], warn: 13, time: p2 ? 0.8 : 0.95, height: 60, spin: 4, damage: 1, hitRadius: 12, source: NAME, light: 16,
      onLand: (ww, x, y) => {
        ww.spawn(new InkPool(x, y, 14, p2 ? 5.5 : 4, NAME));
        ww.sfx('ink_burst', { vol: 0.5, pitch: fx.range(0.9, 1.1) });
      },
    });
    quillInk(w, q.x, q.y, 5);
    yield p2 ? 0.16 : 0.22;
  }
  anim(e, 'float');
  yield 1.1;
}

/** 낱장 소환: torn pages tear themselves out of the tome and hunt the keeper. */
function* summonPages(e: Enemy, w: World, n: number): Script {
  e.halt();
  anim(e, 'cast', true);
  e.telegraph(0.5);
  w.sfx('page_rip', { vol: 0.5, pitch: 1.1 });
  yield 0.5;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.7;
    const s = inRoom(w, e.x - 12 + Math.cos(a) * 26, e.y - 4 + Math.sin(a) * 20, 12);
    summonMinion6(e, w, 'archive_page', s.x, s.y, PAPER_FX);
    w.sfx('enemy_spawn', { vol: 0.4, pitch: 1.3 });
    yield 0.14;
  }
  anim(e, 'float');
  yield 0.5;
}

/** 먹물 범람 (P2): the ink rises; islands of floating books are the only safe floor, and it keeps writing. */
function* inkFlood(e: Enemy, w: World): Script {
  const room = w.room;
  e.mem.floodAt = e.age;
  yield* moveTo(e, w, room.centerX, room.interiorY + 40, 0.7);
  anim(e, 'cast', true);
  e.telegraph(0.6);
  w.sfx('beam_charge', { vol: 0.5, pitch: 0.5 });
  gather(w, e.x, e.y + 20, INK_FX, 16, 34);
  if (!e.mem.taught) {
    e.mem.taught = 1;
    w.banner('먹물이 차오른다', '빛나는 고리 안, 떠 있는 책 위로 피하라', { color: CYAN[2], small: true });
  }
  yield 0.6;
  const area = room.interiorW * room.interiorH;
  const count = clamp(Math.round(area / 11000), 3, 6);
  const islands = islandSpots(w.rng, room.interiorX, room.interiorY, room.interiorW, room.interiorH, count, 76, 30, w.player);
  const flood = w.spawn(new InkFlood(e, islands, { rise: 1.7, hold: 7.5, drain: 0.9, source: NAME, islandR: 30 }));
  e.mem.flood = flood;
  w.sfx('ink_burst', { vol: 0.9, pitch: 0.5 });
  w.shake(0.3);
  yield 1.7;
  // it writes while the ink holds: glyphs rain over the islands
  yield* transcribe(e, w, 2, 1.0);
  yield* transcribe(e, w, 1, 1.0);
  while (!flood.dead) yield;
  e.mem.flood = null;
  anim(e, 'float');
  yield 0.5;
}

/** 낱장 소용돌이 (P2): pages whirl around it and a three-armed spiral of glyphs pours out. */
function* vortex(e: Enemy, w: World): Script {
  const room = w.room;
  yield* moveTo(e, w, room.centerX, room.centerY - 10, 0.8);
  anim(e, 'cast', true);
  e.telegraph(0.6);
  e.mem.spin = 3;
  gather(w, e.x, e.y - 6, INK_FX, 14, 30);
  w.sfx('beam_charge', { vol: 0.5, pitch: 0.9 });
  yield 0.6;
  const dir = w.rng.sign();
  const base = w.rng.angle();
  for (let k = 0; k < 28; k++) {
    for (const a of spiralAngles(base, 3, k, dir * 0.21)) {
      const pr = e.shoot(w, a, glyphShot(k % GLYPH_COUNT, 66));
      pr.x = e.x + Math.cos(a) * 12;
      pr.y = e.y - 4 + Math.sin(a) * 10;
    }
    if (k % 3 === 0) w.sfx('enemy_shoot', { vol: 0.22, pitch: 1.0 + (k % 6) * 0.05 });
    yield 0.11;
  }
  e.mem.spin = 1;
  anim(e, 'float');
  yield 0.7;
}

function* phaseTwo(e: Enemy, w: World): Script {
  yield* phaseShift(e, w, {
    anim: 'arch_hurt',
    color: CYAN[2],
    time: 1.6,
    onPeak: () => {
      e.mem.p2 = true;
      anim(e, 'cast', true);
      w.sfx('page_rip', { vol: 0.9, pitch: 0.7 });
      w.sfx('ink_burst', { vol: 0.8, pitch: 0.6 });
      const g = w.rng.angle();
      let i = 0;
      for (const a of gapRing(18, 0, [g, g + Math.PI], 0.9)) {
        const pr = e.shoot(w, a, glyphShot(i++, 86));
        pr.y = e.y - 6;
      }
      w.particles.burst(e.x, e.y - 10, { count: 30, speed: [40, 150], life: [0.5, 1.1], colors: PAPER_FX, size: [1, 3], gravity: 120, vz: [30, 120], shape: 'square', vrot: 9, drag: 1.5 });
      w.particles.burst(e.x, e.y + 10, { count: 24, speed: [20, 90], life: [0.4, 0.9], colors: INK_FX, size: [1, 2], additive: true, light: 5 });
    },
  });
}

function* patterns(e: Enemy, w: World): Script {
  while (true) {
    const p2 = !!e.mem.p2;
    const walls = w.entities.some((x) => x instanceof PageWall && !x.dead);
    const sinceFlood = e.age - (e.mem.floodAt ?? -99);
    const id = pickPattern(w.rng, [
      { id: 'write', w: 3 },
      { id: 'underline', w: 2.4 },
      { id: 'pages', w: 2.1, when: !walls },
      { id: 'drops', w: 2.3 },
      { id: 'summon', w: 1.2, when: minionCount(w, e) === 0 && w.enemies.length < 4 },
      { id: 'flood', w: 3.2, when: p2 && sinceFlood > 18 },
      { id: 'vortex', w: 2.2, when: p2 },
    ], e.mem.last as string | null);
    e.mem.last = id;
    if (id === 'write') yield* transcribe(e, w, p2 ? 2 : 1);
    else if (id === 'underline') yield* underline(e, w);
    else if (id === 'pages') yield* pageWalls(e, w);
    else if (id === 'drops') yield* inkDrops(e, w);
    else if (id === 'summon') yield* summonPages(e, w, p2 ? 3 : 2);
    else if (id === 'flood') yield* inkFlood(e, w);
    else yield* vortex(e, w);
    yield* drift(e, w, p2 ? w.rng.range(0.7, 1.1) : w.rng.range(1.0, 1.5));
  }
}

/** Everything it had in the air or on the floor goes with it. */
function clearArena(w: World): void {
  clearEnemyShots(w);
  for (const x of w.entities) {
    if (x.dead) continue;
    if (x instanceof GroundWarning || x instanceof InkStroke || x instanceof InkPool || x instanceof Lob || x instanceof ShockRing) x.dead = true;
    else if (x instanceof PageWall) x.tear(w);
    else if (x instanceof InkFlood) x.drain();
  }
}

// ------------------------------------------------------------------ definition
defineBoss({
  id: 'grand_archivist',
  name: NAME,
  bossTitle: '수몰된 서고의 필경사',
  bossFloors: [6],
  bossMusic: 'boss_drowned',
  hp: 820,
  radius: 14,
  speed: 46,
  mass: 6,
  flying: true,
  phasing: true,
  sprite: 'arch_float',
  portrait: 'arch_portrait',
  shadow: 0,
  deathFx: 'void',
  bloodColor: '#48e8ff',
  contactDamage: 1,
  hurtSfx: 'hit',
  light: { radius: 68, color: '#40c8e8' },
  init(e) {
    e.mem.last = null;
    e.mem.orbit = 0;
    e.mem.spin = 1;
    e.mem.flood = null;
    // every attack by name (debug console / screenshot tooling: `e.script.set(e.mem.attacks.write(e, w))`)
    e.mem.attacks = {
      write: (b: Enemy, w: World) => transcribe(b, w, b.mem.p2 ? 2 : 1), underline, pages: pageWalls, drops: inkDrops,
      summon: (b: Enemy, w: World) => summonPages(b, w, 2), flood: inkFlood, vortex, patterns,
    } satisfies Record<string, (b: Enemy, w: World) => Script>;
  },
  *script(e, w) {
    anim(e, 'float');
    yield 0.3;
    yield* patterns(e, w);
  },
  update(e, w, dt) {
    phaseGate(e, 0.5, 1, function* () {
      yield* phaseTwo(e, w);
      phaseDone(e);
      yield* inkFlood(e, w);
      yield* patterns(e, w);
    });
    e.mem.bob = Math.sin(e.age * 2.2) * 2;
    e.mem.orbit = (e.mem.orbit ?? 0) + dt * (e.mem.p2 ? 1.9 : 1.2) * (e.mem.spin ?? 1);
    // the quill drips; the tome sheds motes in phase 2; bubbles rise from the hood
    if (fx.chance(0.3)) {
      const q = quillTip(e);
      w.particles.spawn({ x: q.x + fx.range(-1, 1), y: q.y, vy: fx.range(10, 24), life: fx.range(0.35, 0.6), colors: INK_FX, size: 1, additive: true, light: 3, gravity: 120 });
    }
    if (fx.chance(e.mem.p2 ? 0.45 : 0.18)) {
      w.particles.spawn({
        x: e.x + fx.range(-10, 10), y: e.y - 24 + fx.range(-6, 6), vy: -fx.range(8, 18), vx: fx.range(-3, 3), life: fx.range(0.6, 1.2),
        colors: e.mem.p2 ? [CYAN[3], CYAN[2]] : [TEAL[5], '#ffffff'], size: 1, alpha: 0.75, additive: e.mem.p2,
      });
    }
  },
  draw(e, r) {
    if (e.hidden) return;
    const bob = e.mem.bob ?? 0;
    r.shadow(e.x, e.y + 30, 36, 9, 0.3 * e.alpha);
    // loose pages orbit the scribe (behind, then in front)
    const orb = e.mem.orbit ?? 0;
    const pages: { x: number; y: number; k: number; i: number }[] = [];
    for (let i = 0; i < 3; i++) {
      const a = orb + (i / 3) * TAU;
      pages.push({ x: e.x + Math.cos(a) * 30, y: e.y - 8 + bob + Math.sin(a) * 12 + Math.sin(e.age * 3 + i) * 2, k: Math.sin(a), i });
    }
    for (const pg of pages) if (pg.k < 0) r.sprite(`arch_page_${pg.i}`, pg.x, pg.y, { rot: Math.sin(e.age * 2 + pg.i) * 0.5, alpha: 0.8 * e.alpha });
    e.drawDefault(r, e.frame(), bob);
    for (const pg of pages) if (pg.k >= 0) r.sprite(`arch_page_${pg.i}`, pg.x, pg.y, { rot: Math.sin(e.age * 2 + pg.i) * 0.5, alpha: e.alpha });
    // phase 2: the blazing tome
    if (e.mem.p2) r.circle(e.x - e.facing * 16, e.y - 4 + bob, 9 + Math.sin(e.age * 5) * 1.5, CYAN[2], 0.18);
  },
  onDeath(e, w) {
    clearArena(w);
    dissolveMinions(w, e);
    w.sfx('page_rip', { vol: 1, pitch: 0.6 });
    w.sfx('ink_burst', { vol: 1, pitch: 0.5 });
    bossDeathBurst(w, e.x, e.y, [PARCH[5], PARCH[3], GOLD6[3], ROBE[3], ROBE[1]], 34);
    // the tome slams shut: every page it ever wrote flies free and dissolves into light
    w.particles.burst(e.x, e.y - 6, { count: 40, speed: [30, 140], life: [0.9, 2.0], colors: PAPER_FX, size: [2, 3], gravity: 60, drag: 1.2, vz: [40, 140], shape: 'square', vrot: 7 });
    w.particles.burst(e.x, e.y - 6, { count: 36, speed: [20, 110], life: [0.8, 1.6], colors: [CYAN[4], CYAN[3], CYAN[2]], size: [1, 2], additive: true, light: 5, gravity: -50 });
    for (let i = 0; i < 4; i++) w.spawn(new RingFx(e.x, e.y + 4, 40 + i * 30, 0.6 + i * 0.2, i % 2 ? CYAN[2] : PARCH[5], 2));
    for (let i = 0; i < 6; i++) w.decal(e.x + fx.range(-30, 30), e.y + 20 + fx.range(-10, 14), INKC[1], fx.range(3, 7), 0.6);
    splash(w, e.x, e.y + 24, 2);
  },
});

export { PageWall, InkStroke, InkFlood };
