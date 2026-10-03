// Floor 6 boss: 가라앉은 등대 (the Sunken Lighthouse) — 물속에서도 꺼지지 않는 빛.
// A living drowned lighthouse: a barnacled stone tower whose lamp still turns. Its
// rotating beam is a lethal sweep of light — hide behind the collapsed bookshelves
// (they cast real shadows) or keep circling it faster than the lamp turns.
// Phase 1: 등불 회전 (the beam charges, then sweeps a full turn while wisps are
//   lobbed), 익사한 혼불 (lobbed wisps that become slow homing lights), 조류 고리 (it
//   lurches up and slams down: a gapped tidal ring), 섬광 (fan-telegraphed flashes of
//   the lens aimed at the keeper), 무적 (the foghorn: gapped rings of lamp-gold shots),
//   가라앉은 선원 (drowned sailors wade out of the water).
// Phase 2 (≤50%): the dome blows off — the beam splits in two, stops and reverses
//   mid-sweep, slams collapse the shelves, and 암전: the whole archive goes dark except
//   where the beam passes and the keeper's own lantern reaches.

import { defineBoss, defineEnemy } from '../../game/defs';
import { Entity } from '../../game/entity';
import { PixelPainter, bayer } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { angleDiff, clamp, ease, TAU } from '../../engine/math';
import { VIEW_H, VIEW_W, type Renderer } from '../../engine/renderer';
import { GroundWarning, RingFx } from '../../game/effects';
import { Projectile } from '../../game/projectile';
import { TILE } from '../../game/constants';
import { Tile } from '../../game/tiles';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Script } from '../../engine/script';
import { frames, gather, Lob, lob, spotAround, WARN_RED } from '../enemies/shared';
import {
  ball, bossDeathBurst, clearEnemyShots, crack, dissolveMinions, gapRing, hash2, hitPlayerCircle, inRoom, insideRoom, limb, lum, minionCount,
  phaseDone, phaseGate, phaseShift, pickPattern, ShockRing,
} from './final-kit';
import { bullet6, CYAN, DROWNED, GOLD6, INDIGO, INKC, inWedge, OUTLINE6, PARCH, rayBlocked, shadowLen, splash, summonMinion6, TEAL } from './kit6';

// ------------------------------------------------------------------ palette
const STONE = ['#0e1a22', '#1c303c', '#2e4c58', '#497078', '#6e9398', '#9ab8b8'];
const IRON = ['#1a1410', '#3a2c20', '#5c4634', '#7a6248'];
const BRASS = ['#3a2408', '#7a5016', '#b88a2e', '#e8c050', '#fff0a8'];
const PATINA = ['#1e5a52', '#3a8a78'];
const GLASS = ['#0a1430', '#162454', '#2a3c86'];
const LAMP = ['#8a5a10', '#e8b030', '#ffe080', '#fff8d0', '#ffffff'];
const BARN = ['#5a4a3a', '#8a7658', '#c0a880'];
const DEEP = '#04060c';

const W = 48;
const H = 86;
/** pivot = the waterline at the tower's foot (entity position) */
const ORIGIN: [number, number] = [24, 72];
const CX = 24;
/** lens centre above the pivot */
const LENS_DY = -61;

interface TowerPose {
  /** sway of the upper tower (px) */
  sway: number;
  /** squash of the whole tower (slam wind-up / landing) */
  crouch?: number;
  /** lamp charging */
  bright?: boolean;
  /** water ripple frame */
  rip: number;
}

// ------------------------------------------------------------------ painting
/** half width of the shaft at row y */
function shaftHalf(y: number): number {
  return 9 + ((y - 20) / 44) * 4.5;
}

function paintShaft(p: PixelPainter, sway: number, crouch: number, p2: boolean): void {
  const top = 20 + crouch * 6;
  const bot = 66;
  for (let y = top; y <= bot; y++) {
    const k = (y - top) / (bot - top);
    const cx = CX + sway * (1 - k);
    const hw = shaftHalf(20 + k * 44);
    for (let x = Math.floor(cx - hw - 1); x <= Math.ceil(cx + hw + 1); x++) {
      const nx = (x + 0.5 - cx) / hw;
      if (Math.abs(nx) > 1) continue;
      // cylinder shading, courses of stone every 6 rows, staggered mortar
      let idx = lum(nx * 0.95, 0, STONE.length, x, y, true, -0.08);
      const course = Math.floor((y - top) / 6);
      const mortarY = (y - top) % 6 === 5;
      const mortarX = ((x + course * 5) % 9) === 0;
      if (mortarY || mortarX) idx = Math.max(0, idx - 2);
      let col = STONE[idx];
      // waterlogged below the old tide mark, patina streaks, a missing stone or two
      if (y > bot - 16 && hash2(x, y, 11) < 0.35) col = STONE[Math.max(0, idx - 1)];
      if (hash2(Math.floor(x / 2), Math.floor(y / 5), 5) < 0.09 && !mortarY) col = PATINA[idx > 2 ? 1 : 0];
      p.px(x, y, col);
    }
  }
  // the mouth: a wide jagged crack near the foot, glowing with the drowned light inside
  const my = 56;
  crack(p, CX - 7, my, CX + 7, my + 1, DEEP, 3, 1.4);
  crack(p, CX - 6, my + 1, CX + 6, my + 2, p2 ? CYAN[2] : INKC[3], 4, 1.0);
  if (p2) {
    crack(p, CX - 2, 30, CX - 5, 52, CYAN[1], 6, 1.3);
    crack(p, CX + 3, 34, CX + 6, 50, CYAN[1], 8, 1.1);
    p.px(CX - 4, 46, CYAN[3]);
    p.px(CX + 5, 42, CYAN[3]);
  }
  // a barred window
  // Worn stone lintel and sill separate the window from the wet masonry.
  const wx = CX + Math.round(sway * 0.5);
  p.line(wx - 3, 35, wx + 2, 35, STONE[5]);
  p.line(wx - 3, 42, wx + 3, 42, STONE[1]);
  p.rect(CX - 2 + Math.round(sway * 0.5), 36, 4, 5, DEEP);
  p.line(CX + Math.round(sway * 0.5), 36, CX + Math.round(sway * 0.5), 40, IRON[2]);
  p.px(CX - 1 + Math.round(sway * 0.5), 37, p2 ? CYAN[2] : INKC[3]);
}

function paintFoot(p: PixelPainter, rip: number, p2: boolean): void {
  // broken masonry footing spreading into the water, barnacles, kelp, the waterline
  p.poly([CX - 15, 66, CX + 15, 66, CX + 20, 76, CX + 16, 82, CX - 16, 82, CX - 20, 76], STONE[2]);
  for (let y = 66; y <= 82; y++) {
    for (let x = 2; x < 46; x++) {
      if (!p.isSet(x, y)) continue;
      const nx = (x + 0.5 - CX) / 19;
      let idx = lum(nx * 0.9, (y - 66) / 16, STONE.length, x, y, true, -0.2);
      if ((y - 66) % 5 === 4) idx = Math.max(0, idx - 2);
      p.px(x, y, STONE[idx]);
    }
  }
  // barnacle clusters
  for (const [bx, by, n] of [[CX - 12, 70, 3], [CX + 10, 69, 4], [CX - 3, 76, 3], [CX + 14, 75, 2], [CX - 16, 78, 2]] as const) {
    for (let i = 0; i < n; i++) {
      const x = bx + (i % 2) * 3;
      const y = by + Math.floor(i / 2) * 3;
      p.rect(x, y, 3, 2, BARN[1]);
      p.px(x + 1, y, BARN[2]);
      p.px(x + 1, y + 1, p2 ? CYAN[2] : BARN[0]);
    }
  }
  // kelp hanging / drifting off the stones
  for (const [kx, len, ph] of [[CX - 18, 7, 0], [CX + 19, 6, 1], [CX + 4, 5, 2]] as const) {
    let px = kx;
    let py = 78;
    for (let k = 1; k <= len; k++) {
      const nx = kx + Math.round(Math.sin(k * 0.8 + ph + rip * 1.3) * 1.5);
      const ny = 78 - k;
      p.line(px, py, nx, ny, k > len - 2 ? TEAL[4] : TEAL[3]);
      px = nx;
      py = ny;
    }
  }
  // waterline: ripples lapping at the stone
  for (let x = 1; x < 47; x++) {
    const yy = 74 + Math.round(Math.sin(x * 0.7 + rip * 1.6) * 1.2);
    if (p.isSet(x, yy)) p.px(x, yy, TEAL[5]);
    if (p.isSet(x, yy + 1) && (x + rip) % 3 === 0) p.px(x, yy + 1, TEAL[4]);
  }
  // the foot dissolves into the water
  for (let y = 78; y < 86; y++) for (let x = 0; x < W; x++) if (p.isSet(x, y) && bayer(x, y) < (y - 77) / 8) p.px(x, y, null);
}

function paintGallery(p: PixelPainter, sway: number, crouch: number, p2: boolean): void {
  const y = 20 + crouch * 6;
  const cx = CX + sway;
  // platform
  p.rect(cx - 14, y - 2, 29, 4, STONE[3]);
  p.rect(cx - 14, y - 2, 29, 1, STONE[5]);
  p.rect(cx - 14, y + 1, 29, 1, STONE[1]);
  // rusted iron railing
  for (let x = cx - 13; x <= cx + 13; x += 4) {
    p.line(x, y - 3, x, y - 8, IRON[2]);
    p.px(x, y - 8, IRON[3]);
  }
  p.line(cx - 13, y - 8, cx + 13, y - 8, IRON[1]);
  p.line(cx - 13, y - 5, cx + 13, y - 5, IRON[2]);
  if (p2) {
    // bent, half torn away
    p.line(cx + 8, y - 8, cx + 15, y - 12, IRON[2]);
    p.px(cx + 15, y - 12, IRON[3]);
  }
}

function paintLampRoom(p: PixelPainter, sway: number, crouch: number, bright: boolean, p2: boolean): void {
  const base = 20 + crouch * 6;
  const cx = CX + sway;
  const top = base - 16;
  // glass housing (the lens itself is a separate rotating sprite)
  p.rect(cx - 9, top, 19, 16 - 3, GLASS[1]);
  for (let y = top; y < base - 3; y++) {
    for (let x = cx - 9; x <= cx + 9; x++) {
      const nx = (x + 0.5 - cx) / 9;
      const idx = lum(nx, (y - top) / 13 - 0.5, GLASS.length, x, y, true, 0.05);
      p.px(x, y, GLASS[idx]);
    }
  }
  // mullions
  for (const dx of [-6, -2, 2, 6]) p.line(cx + dx, top, cx + dx, base - 4, IRON[1]);
  p.line(cx - 9, top + 6, cx + 9, top + 6, IRON[1]);
  // the lamp glow behind the glass
  const g = bright || p2 ? LAMP[3] : LAMP[2];
  p.ellipse(cx, top + 6.5, 5.5, 4.5, bright ? LAMP[4] : g);
  p.ellipse(cx, top + 6.5, 3.5, 3, LAMP[4]);
  if (bright) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      p.line(cx + Math.cos(a) * 7, top + 6.5 + Math.sin(a) * 6, cx + Math.cos(a) * 11, top + 6.5 + Math.sin(a) * 9, LAMP[2]);
    }
  }
  if (!p2) {
    // brass dome with verdigris and a finial
    ball(p, cx, top - 1, 10, 5, BRASS, true);
    p.px(cx - 3, top - 4, PATINA[1]);
    p.px(cx + 5, top - 2, PATINA[0]);
    p.rect(cx - 10, top - 1, 21, 2, BRASS[1]);
    p.line(cx - 10, top - 1, cx + 10, top - 1, BRASS[3]);
    p.line(cx, top - 6, cx, top - 10, BRASS[2]);
    p.px(cx, top - 10, BRASS[4]);
  } else {
    // dome gone: twisted frame, the bare lamp blazing upward
    p.rect(cx - 10, top - 1, 21, 2, BRASS[1]);
    p.line(cx - 8, top - 1, cx - 11, top - 7, IRON[2]);
    p.line(cx + 7, top - 1, cx + 9, top - 6, IRON[2]);
    for (let i = 0; i < 5; i++) {
      const x = cx - 6 + i * 3;
      p.line(x, top - 2, x + (i - 2), top - 8 - (i % 2) * 3, i % 2 ? LAMP[2] : LAMP[3]);
    }
    p.px(cx, top - 12, LAMP[4]);
  }
}

function paintTower(p: PixelPainter, o: TowerPose, p2: boolean): void {
  const crouch = o.crouch ?? 0;
  paintFoot(p, o.rip, p2);
  paintShaft(p, o.sway, crouch, p2);
  paintGallery(p, o.sway, crouch, p2);
  paintLampRoom(p, o.sway, crouch, !!o.bright, p2);
}

// ------------------------------------------------------------------ frames
const POSES: Record<string, TowerPose[]> = {
  idle: [0, 1, 2, 3].map((i) => ({ sway: [0, 1, 0, -1][i], rip: i })),
  charge: [
    { sway: 0, rip: 1, bright: true },
    { sway: 1, rip: 2, bright: false },
  ],
  crouch: [{ sway: 0, rip: 0, crouch: 1 }, { sway: 0, rip: 2, crouch: 1.3 }],
  hurt: [{ sway: 2, rip: 1, crouch: 0.4, bright: true }],
};
const FPS: Record<string, number> = { idle: 4, charge: 10, crouch: 6, hurt: 1 };

for (const [state, poses] of Object.entries(POSES)) {
  for (const [pre, p2] of [['lh', false], ['lh2', true]] as const) {
    frames(pre, state, poses.length, W, H, (p, i) => paintTower(p, poses[i], p2), { origin: ORIGIN, fps: FPS[state] ?? 6, outline: OUTLINE6 });
  }
}

// the lens: a fresnel eye, bright on the side it faces (points right at rot 0)
for (const [name, p2] of [['lh_lens', false], ['lh_lens2', true]] as const) {
  defineDrawnSprite(name, 13, 13, (p) => {
    const c = 6.5;
    p.circle(c, c, 6, p2 ? CYAN[1] : LAMP[1]);
    p.ring(c, c, 6, 1.2, p2 ? CYAN[0] : LAMP[0]);
    p.ring(c, c, 4, 1, p2 ? CYAN[2] : LAMP[2]);
    p.circle(c + 2, c, 2.2, p2 ? CYAN[3] : LAMP[3]);
    p.circle(c + 2.5, c, 1.2, '#ffffff');
    p.px(c - 3, c - 2, p2 ? CYAN[2] : LAMP[2]);
  }, { outline: p2 ? '#06202a' : '#2a1a04' });
}

// a drowned wisp (lobbed, then a homing light)
defineDrawnSprite('lh_wisp', 9, 11, (p) => {
  p.poly([1, 7, 4.5, 0, 8, 7, 7, 10, 2, 10], LAMP[1]);
  p.poly([2.5, 7, 4.5, 2.5, 6.5, 7, 6, 9, 3, 9], LAMP[3]);
  p.px(4, 6, '#ffffff');
  p.px(3, 8, INKC[1]);
  p.px(6, 8, INKC[1]);
}, { outline: '#2a1a04' });

// collapsed bookshelf cover: standing (two tiles wide) and fallen
defineDrawnSprite('lh_shelf', 32, 28, (p) => {
  // waterlogged shelf: dark frame, rows of swollen books in teal / indigo / gold
  p.rect(0, 2, 32, 26, IRON[1]);
  p.rect(1, 3, 30, 24, STONE[0]);
  p.rect(0, 0, 32, 3, IRON[2]);
  p.rect(0, 0, 32, 1, IRON[3]);
  for (let row = 0; row < 3; row++) {
    const y = 4 + row * 8;
    p.rect(1, y + 7, 30, 1, IRON[2]);
    let x = 2;
    let i = row * 7;
    while (x < 29) {
      const w = 2 + (i % 3);
      const h = 5 + (i % 2);
      const col = [TEAL[3], INDIGO[2], GOLD6[2], TEAL[2], INDIGO[3], PARCH[2]][i % 6];
      p.rect(x, y + 7 - h, w, h, col);
      p.px(x, y + 7 - h, [TEAL[5], INDIGO[4], GOLD6[3], TEAL[4], INDIGO[4], PARCH[4]][i % 6]);
      if (i % 4 === 1) p.rect(x + w - 1, y + 9 - h, 1, h - 3, PARCH[3]);
      x += w + 1;
      i++;
    }
  }
  // a toppled book and dripping weed on top
  p.rect(20, 1, 7, 2, GOLD6[2]);
  p.px(21, 1, GOLD6[3]);
  p.line(5, 3, 5, 9, TEAL[3]);
  p.px(5, 9, TEAL[4]);
  p.line(27, 3, 28, 7, TEAL[3]);
  // ink bleeding from the lower shelf, barnacles at the waterline
  p.rect(8, 24, 6, 2, INKC[2]);
  p.px(10, 25, CYAN[1]);
  p.rect(1, 26, 3, 2, BARN[1]);
  p.rect(26, 26, 3, 2, BARN[1]);
}, { outline: OUTLINE6, anchor: 'bottom' });

defineDrawnSprite('lh_shelf_broken', 32, 14, (p) => {
  p.poly([0, 6, 10, 2, 22, 5, 32, 3, 31, 13, 1, 13], IRON[1]);
  p.poly([2, 7, 10, 4, 21, 6, 29, 5, 29, 12, 3, 12], STONE[0]);
  for (let i = 0; i < 7; i++) {
    const x = 3 + i * 4;
    p.rect(x, 8 - (i % 2), 3, 3 + (i % 2), [TEAL[3], INDIGO[2], GOLD6[2], PARCH[2]][i % 4]);
  }
  p.rect(12, 3, 6, 2, GOLD6[2]);
  p.rect(1, 11, 30, 2, TEAL[3]);
  for (let x = 2; x < 30; x += 3) p.px(x, 11, TEAL[5]);
}, { outline: OUTLINE6, anchor: 'bottom' });

// minion: a drowned sailor with a dead lantern (two walk frames)
for (let i = 0; i < 2; i++) {
  defineDrawnSprite(`dsailor_walk_${i}`, 14, 18, (p) => {
    const step = i ? 1 : -1;
    // boots / legs
    p.rect(4 + (step > 0 ? 1 : 0), 14, 3, 4, IRON[1]);
    p.rect(8 - (step > 0 ? 1 : 0), 14, 3, 4, IRON[1]);
    // oilskin coat, bloated
    p.poly([3, 6, 11, 6, 13, 15, 1, 15], PARCH[1]);
    for (let y = 6; y < 15; y++) for (let x = 1; x < 13; x++) if (p.isSet(x, y)) p.px(x, y, PARCH[lum((x + 0.5 - 7) / 6, 0, 3, x, y, true, -0.2)]);
    p.line(7, 7, 7, 14, PARCH[0]);
    // drowned head with a sou'wester
    ball(p, 7, 4, 3.2, 3, DROWNED, false);
    p.rect(3, 1, 9, 2, IRON[2]);
    p.rect(4, 0, 7, 1, IRON[3]);
    p.px(5, 4, CYAN[2]);
    p.px(9, 4, CYAN[2]);
    // the lantern on a pole, lit faintly
    p.line(12, 8 + step, 12, 12, IRON[2]);
    p.rect(11, 12, 3, 3, IRON[1]);
    p.px(12, 13, LAMP[1]);
    p.px(12, 11, IRON[3]);
  }, { outline: OUTLINE6, anchor: 'bottom' });
}

// intro-card portrait: the lamp room looming, the great lens staring, barnacled stone and water below
defineDrawnSprite('lh_portrait', 62, 86, (p) => {
  const cx = 31;
  // shaft
  for (let y = 36; y < 78; y++) {
    const hw = 13 + ((y - 36) / 42) * 8;
    for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
      const nx = (x + 0.5 - cx) / hw;
      if (Math.abs(nx) > 1) continue;
      let idx = lum(nx * 0.95, 0, STONE.length, x, y, true, -0.08);
      const course = Math.floor((y - 36) / 7);
      if ((y - 36) % 7 === 6 || ((x + course * 6) % 11) === 0) idx = Math.max(0, idx - 2);
      let col = STONE[idx];
      if (hash2(Math.floor(x / 2), Math.floor(y / 5), 9) < 0.08) col = PATINA[idx > 2 ? 1 : 0];
      p.px(x, y, col);
    }
  }
  // the mouth-crack glowing
  crack(p, cx - 10, 66, cx + 10, 67, DEEP, 3, 1.6);
  crack(p, cx - 9, 67, cx + 9, 68, CYAN[2], 4, 1.2);
  p.px(cx - 4, 68, CYAN[3]);
  p.px(cx + 3, 67, CYAN[3]);
  // gallery + railing
  p.rect(cx - 20, 32, 41, 5, STONE[3]);
  p.rect(cx - 20, 32, 41, 1, STONE[5]);
  p.rect(cx - 20, 36, 41, 1, STONE[1]);
  for (let x = cx - 19; x <= cx + 19; x += 5) p.line(x, 31, x, 25, IRON[2]);
  p.line(cx - 19, 25, cx + 19, 25, IRON[1]);
  p.line(cx - 19, 28, cx + 19, 28, IRON[2]);
  // lamp room glass
  p.rect(cx - 15, 8, 31, 24, GLASS[1]);
  for (let y = 8; y < 32; y++) for (let x = cx - 15; x <= cx + 15; x++) p.px(x, y, GLASS[lum((x + 0.5 - cx) / 15, (y - 20) / 12, GLASS.length, x, y, true, 0.05)]);
  for (const dx of [-10, -5, 5, 10]) p.line(cx + dx, 8, cx + dx, 31, IRON[1]);
  // the lens-eye staring out
  p.circle(cx, 20, 9.5, LAMP[0]);
  p.circle(cx, 20, 8.2, LAMP[1]);
  p.ring(cx, 20, 6.2, 1.2, LAMP[2]);
  p.ring(cx, 20, 3.6, 1, LAMP[2]);
  p.circle(cx, 20, 2.6, LAMP[3]);
  p.circle(cx - 1, 19, 1.3, '#ffffff');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.2;
    p.line(cx + Math.cos(a) * 10, 20 + Math.sin(a) * 10, cx + Math.cos(a) * 14, 20 + Math.sin(a) * 14, i % 2 ? LAMP[2] : LAMP[3]);
  }
  // dome
  ball(p, cx, 6, 17, 7, BRASS, true);
  p.px(cx - 6, 2, PATINA[1]);
  p.px(cx + 8, 4, PATINA[0]);
  p.rect(cx - 17, 7, 35, 2, BRASS[1]);
  p.line(cx - 17, 7, cx + 17, 7, BRASS[3]);
  p.line(cx, 0, cx, -1, BRASS[4]);
  // barnacles + kelp + water at the bottom
  for (const [bx, by] of [[cx - 16, 70], [cx + 12, 72], [cx - 6, 76], [cx + 17, 76]] as const) {
    p.rect(bx, by, 4, 3, BARN[1]);
    p.px(bx + 1, by, BARN[2]);
    p.px(bx + 2, by + 1, BARN[0]);
  }
  for (let x = 0; x < 62; x++) {
    const yy = 78 + Math.round(Math.sin(x * 0.5) * 1.5);
    for (let y = yy; y < 86; y++) p.px(x, y, y === yy ? TEAL[5] : y < yy + 3 ? TEAL[3] : TEAL[1]);
  }
  for (const [kx, len] of [[8, 9], [52, 7], [20, 5]] as const) {
    for (let k = 1; k <= len; k++) p.px(kx + Math.round(Math.sin(k * 0.8) * 1.5), 78 - k, k > len - 2 ? TEAL[4] : TEAL[3]);
  }
}, { outline: OUTLINE6 });

// ------------------------------------------------------------------ arena pieces
const NAME = '가라앉은 등대';
const LAMP_FX = [LAMP[4], LAMP[3], LAMP[1]];
const STONE_FX = [STONE[5], STONE[3], STONE[1]];

/** Cover: a collapsed bookshelf standing on two BLOCK tiles; the beam cannot pass it. A slam may topple it. */
class Shelf extends Entity {
  tx: number;
  ty: number;
  standing = true;
  constructor(tx: number, ty: number) {
    super();
    this.tx = tx;
    this.ty = ty;
    this.x = (tx + 1) * TILE;
    this.y = (ty + 1) * TILE;
    this.layer = 1;
    this.tileCollide = false;
    this.persistent = true;
  }

  override get sortY(): number {
    return this.y - 1;
  }

  place(w: World): void {
    w.room.setTile(this.tx, this.ty, Tile.BLOCK);
    w.room.setTile(this.tx + 1, this.ty, Tile.BLOCK);
  }

  collapse(w: World): void {
    if (!this.standing) return;
    this.standing = false;
    w.room.setTile(this.tx, this.ty, Tile.RUBBLE);
    w.room.setTile(this.tx + 1, this.ty, Tile.RUBBLE);
    w.particles.burst(this.x, this.y - 10, { count: 26, speed: [40, 130], life: [0.4, 0.9], colors: [...STONE_FX, PARCH[4], TEAL[3]], size: [1, 3], gravity: 300, vz: [40, 140], shape: 'square', vrot: 8, bounce: 0.3 });
    splash(w, this.x, this.y + 2, 1.6);
    w.sfx('rock_break', { vol: 0.8, pitch: 0.8 });
    w.sfx('page_rip', { vol: 0.5, pitch: 0.7 });
    w.shake(0.25);
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
  }

  override draw(r: Renderer): void {
    r.shadow(this.x, this.y + 1, 30, 7, 0.3);
    r.sprite(this.standing ? 'lh_shelf' : 'lh_shelf_broken', this.x, this.y + 2);
    if (this.standing && Math.floor(this.age * 0.7) % 3 === 0) {
      // a drip from the top shelf
      const k = (this.age * 0.7) % 1;
      r.rect(this.x - 10, this.y - 24 + k * 20, 1, 2, TEAL[5], 1 - k);
    }
  }

  override light(w: World): void {
    if (this.standing) w.lights.add(this.x - 6, this.y - 4, 14, '#40c0ff', { intensity: 0.3 });
  }
}

function shelves(w: World): Shelf[] {
  return w.entities.filter((x): x is Shelf => x instanceof Shelf && !x.dead);
}

interface BeamOpts {
  source: string;
  /** charge time: the dim cone shows where it will start (not yet lethal) */
  warn: number;
  /** lethal sweep time */
  duration: number;
  /** angular speed rad/s (sign = direction) */
  omega: number;
  /** half angle of the lethal cone */
  half: number;
  /** second beam opposite the first */
  split?: boolean;
  /** time into the sweep when it halts, flashes and reverses */
  reverseAt?: number;
  damage?: number;
  rehit?: number;
}

const BEAM_LEN = 360;
const FAN_RAYS = 13;

/**
 * The lamp beam: a wedge of light from the tower's foot that sweeps around the
 * arena. Shot-blocking tiles (shelves, rocks, walls) cast real shadows; the keeper
 * is only hurt standing in lit water.
 */
class LampBeam extends Entity {
  owner: Enemy;
  angle: number;
  o: BeamOpts;
  omega: number;
  /** seconds left of the reversal pause (0 = sweeping) */
  pause = 0;
  reversed = false;
  private hitT = -9;
  constructor(owner: Enemy, angle: number, o: BeamOpts) {
    super();
    this.owner = owner;
    this.angle = angle;
    this.o = o;
    this.omega = o.omega;
    this.x = owner.x;
    this.y = owner.y + 2;
    this.layer = 0;
    this.tileCollide = false;
    this.team = 'enemy';
  }

  get on(): boolean {
    return this.age >= this.o.warn && this.age < this.o.warn + this.o.duration;
  }

  get fading(): boolean {
    return this.age >= this.o.warn + this.o.duration;
  }

  angles(): number[] {
    return this.o.split ? [this.angle, this.angle + Math.PI] : [this.angle];
  }

  /** Fan vertices (world coords) of the lit wedge around `a`, clipped by shadows. */
  fan(w: World, a: number, half = this.o.half): number[] {
    const pts: number[] = [this.x, this.y];
    for (let i = 0; i <= FAN_RAYS; i++) {
      const ra = a - half + (i / FAN_RAYS) * half * 2;
      const l = shadowLen(w.room, this.x, this.y, ra, BEAM_LEN, 4);
      pts.push(this.x + Math.cos(ra) * l, this.y + Math.sin(ra) * l);
    }
    return pts;
  }

  override update(w: World, dt: number): void {
    const o = this.owner;
    if (!o.alive) {
      this.dead = true;
      return;
    }
    this.x = o.x;
    this.y = o.y + 2;
    const wasOn = this.on;
    this.age += dt;
    const op = this.o;
    if (this.on && !wasOn) {
      w.sfx('laser', { vol: 0.7, pitch: 0.55 });
      w.sfx('foghorn', { vol: 0.35, pitch: 1.6 });
      w.shake(0.2);
    }
    if (this.on) {
      const t = this.age - op.warn;
      if (op.reverseAt !== undefined && !this.reversed && t >= op.reverseAt) {
        this.reversed = true;
        this.pause = 0.55;
        w.sfx('warn', { vol: 0.5, pitch: 0.7 });
        w.sfx('lamp_hum', { vol: 0.6, pitch: 1.3 });
      }
      if (this.pause > 0) {
        this.pause -= dt;
        if (this.pause <= 0) {
          this.omega = -this.omega;
          w.sfx('laser', { vol: 0.6, pitch: 0.7 });
          w.shake(0.2);
        }
      } else this.angle += this.omega * dt;
      // hit: inside a lit wedge, no shelf between the lamp and the keeper
      for (const p of w.targets()) {
        if (p.alive && p.z < 10 && w.time - this.hitT >= (op.rehit ?? 0.7)) {
          for (const a of this.angles()) {
            const d = Math.hypot(p.x - this.x, p.y - this.y);
            const tol = Math.atan2(p.r * 0.7, Math.max(8, d));
            if (d < 14 || !inWedge(p.x, p.y - 2, this.x, this.y, a, op.half + tol, BEAM_LEN)) continue;
            if (rayBlocked(w.room, this.x, this.y, p.x, p.y - 2)) continue;
            if (p.hurt(w, op.damage ?? 1, op.source)) {
              this.hitT = w.time;
              const side = angleDiff(a, Math.atan2(p.y - this.y, p.x - this.x)) >= 0 ? 1 : -1;
              p.knock(-Math.sin(a) * side, Math.cos(a) * side, 190);
            }
            break;
          }
        }
      }
      // glitter where the light meets the water and sparks at its end
      for (const a of this.angles()) {
        if (!fx.chance(0.7)) continue;
        const l = shadowLen(w.room, this.x, this.y, a, BEAM_LEN, 4);
        const k = fx.range(0.2, 1);
        w.particles.spawn({
          x: this.x + Math.cos(a) * l * k + fx.range(-4, 4), y: this.y + Math.sin(a) * l * k + fx.range(-3, 3), vy: -fx.range(4, 14), life: fx.range(0.2, 0.4),
          colors: LAMP_FX, size: 1, additive: true, light: 3,
        });
      }
    } else if (!this.fading && fx.chance(0.3)) {
      gather(w, this.x, this.y - 60, LAMP_FX, 2, 20);
    }
    if (this.age >= op.warn + op.duration + 0.3) this.dead = true;
  }

  override draw(r: Renderer, w: World): void {
    const c = r.ctx;
    const vx = r.viewX;
    const vy = r.viewY;
    const op = this.o;
    const fade = this.fading ? clamp(1 - (this.age - op.warn - op.duration) / 0.3, 0, 1) : 1;
    const charging = this.age < op.warn;
    const k = charging ? clamp(this.age / op.warn, 0, 1) : 1;
    const flashing = this.pause > 0 && Math.floor(this.age * 18) % 2 === 0;
    c.save();
    for (const a of this.angles()) {
      // dim spill, then the lethal core wedge
      const spill = this.fan(w, a, op.half * 1.9);
      c.globalAlpha = (charging ? 0.07 * k : 0.12) * fade;
      c.fillStyle = LAMP[2];
      c.beginPath();
      c.moveTo(spill[0] - vx, spill[1] - vy);
      for (let i = 2; i < spill.length; i += 2) c.lineTo(spill[i] - vx, spill[i + 1] - vy);
      c.closePath();
      c.fill();
      const core = this.fan(w, a);
      c.beginPath();
      c.moveTo(core[0] - vx, core[1] - vy);
      for (let i = 2; i < core.length; i += 2) c.lineTo(core[i] - vx, core[i + 1] - vy);
      c.closePath();
      // only the front of the wedge is outlined: a mostly shaded wedge must not read as a laser line
      const front = () => {
        c.beginPath();
        c.moveTo(core[2] - vx, core[3] - vy);
        for (let i = 4; i < core.length; i += 2) c.lineTo(core[i] - vx, core[i + 1] - vy);
        c.stroke();
      };
      if (charging) {
        // warning: red, blinking, filling up as the lamp charges
        const blink = 0.18 + 0.14 * Math.sin(this.age * 22);
        c.globalAlpha = blink * fade;
        c.fillStyle = WARN_RED;
        c.fill();
        c.globalAlpha = 0.3 * k * fade;
        c.fillStyle = LAMP[3];
        c.fill();
        c.globalAlpha = 0.85 * fade;
        c.strokeStyle = WARN_RED;
        c.lineWidth = 1;
        front();
      } else {
        c.globalAlpha = (flashing ? 0.75 : 0.42) * fade;
        c.fillStyle = flashing ? '#ffffff' : LAMP[2];
        c.fill();
        c.globalAlpha = 0.9 * fade;
        c.strokeStyle = LAMP[3];
        c.lineWidth = 1;
        front();
        // the bright centre line of the beam
        const l = shadowLen(w.room, this.x, this.y, a, BEAM_LEN, 4);
        c.globalAlpha = (0.55 + 0.25 * Math.sin(this.age * 40)) * fade;
        c.strokeStyle = flashing ? WARN_RED : '#ffffff';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(this.x - vx, this.y - vy);
        c.lineTo(this.x + Math.cos(a) * l - vx, this.y + Math.sin(a) * l - vy);
        c.stroke();
      }
    }
    c.restore();
  }

  override light(w: World): void {
    if (this.age < this.o.warn * 0.5) return;
    const on = this.on;
    for (const a of this.angles()) {
      const l = shadowLen(w.room, this.x, this.y, a, BEAM_LEN, 8);
      const n = Math.max(1, Math.floor(l / 34));
      for (let i = 1; i <= n; i++) {
        const k = (i / n) * l;
        w.lights.add(this.x + Math.cos(a) * k, this.y + Math.sin(a) * k, on ? 38 + k * 0.12 : 20, on ? '#ffd060' : '#ff6040', { intensity: on ? 0.9 : 0.35 });
      }
    }
  }
}

interface FlashOpts {
  source: string;
  warn: number;
  half: number;
  damage?: number;
}

/** 섬광: the lens aims at the keeper (fan telegraph), then the light snaps on for an instant. Shelves shade. */
class LampFlash extends Entity {
  owner: Enemy;
  angle: number;
  o: FlashOpts;
  struck = false;
  constructor(owner: Enemy, angle: number, o: FlashOpts) {
    super();
    this.owner = owner;
    this.angle = angle;
    this.o = o;
    this.x = owner.x;
    this.y = owner.y + 2;
    this.layer = 0;
    this.tileCollide = false;
    this.team = 'enemy';
  }

  fan(w: World, half = this.o.half): number[] {
    const pts: number[] = [this.x, this.y];
    for (let i = 0; i <= FAN_RAYS; i++) {
      const ra = this.angle - half + (i / FAN_RAYS) * half * 2;
      const l = shadowLen(w.room, this.x, this.y, ra, BEAM_LEN, 4);
      pts.push(this.x + Math.cos(ra) * l, this.y + Math.sin(ra) * l);
    }
    return pts;
  }

  override update(w: World, dt: number): void {
    if (!this.owner.alive) {
      this.dead = true;
      return;
    }
    this.x = this.owner.x;
    this.y = this.owner.y + 2;
    this.age += dt;
    const o = this.o;
    // the lens tracks a little during the first half of the warning
    if (this.age < o.warn * 0.5) {
      const want = Math.atan2(w.player.y - 2 - this.y, w.player.x - this.x);
      this.angle += clamp(angleDiff(this.angle, want), -1.6 * dt, 1.6 * dt);
    }
    if (!this.struck && this.age >= o.warn) {
      this.struck = true;
      for (const p of w.targets()) {
        const d = Math.hypot(p.x - this.x, p.y - this.y);
        const tol = Math.atan2(p.r * 0.7, Math.max(8, d));
        if (p.alive && p.z < 10 && d >= 14 && inWedge(p.x, p.y - 2, this.x, this.y, this.angle, o.half + tol, BEAM_LEN) && !rayBlocked(w.room, this.x, this.y, p.x, p.y - 2)) {
          if (p.hurt(w, o.damage ?? 1, o.source)) p.knock(Math.cos(this.angle), Math.sin(this.angle), 200);
        }
      }
      w.sfx('laser', { vol: 0.7, pitch: 1.1 });
      w.sfx('lightning', { vol: 0.25, pitch: 1.5 });
      w.shake(0.22);
      w.renderer?.screenFlash(LAMP[3], 0.12);
      const l = shadowLen(w.room, this.x, this.y, this.angle, BEAM_LEN, 4);
      for (let i = 0; i < 10; i++) {
        const k = fx.range(0.1, 1);
        w.particles.spawn({ x: this.x + Math.cos(this.angle) * l * k, y: this.y + Math.sin(this.angle) * l * k, vy: -fx.range(10, 30), life: fx.range(0.2, 0.5), colors: LAMP_FX, size: fx.range(1, 2), additive: true, light: 4 });
      }
    }
    if (this.age >= o.warn + 0.22) this.dead = true;
  }

  override draw(r: Renderer, w: World): void {
    const c = r.ctx;
    const vx = r.viewX;
    const vy = r.viewY;
    const pts = this.fan(w);
    c.save();
    c.beginPath();
    c.moveTo(pts[0] - vx, pts[1] - vy);
    for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i] - vx, pts[i + 1] - vy);
    c.closePath();
    if (!this.struck) {
      const t = clamp(this.age / this.o.warn, 0, 1);
      c.globalAlpha = 0.2 + 0.14 * Math.sin(this.age * 25);
      c.fillStyle = WARN_RED;
      c.fill();
      c.globalAlpha = 0.8;
      c.strokeStyle = t > 0.7 && Math.floor(this.age * 20) % 2 === 0 ? '#ffffff' : WARN_RED;
      c.lineWidth = 1;
      // outline the front only (the shaded part of a fan must not read as laser lines)
      c.beginPath();
      c.moveTo(pts[2] - vx, pts[3] - vy);
      for (let i = 4; i < pts.length; i += 2) c.lineTo(pts[i] - vx, pts[i + 1] - vy);
      c.stroke();
      // the aim line brightens as it locks
      const l = shadowLen(w.room, this.x, this.y, this.angle, BEAM_LEN, 4);
      c.globalAlpha = 0.3 + 0.6 * t;
      c.strokeStyle = LAMP[3];
      c.beginPath();
      c.moveTo(this.x - vx, this.y - vy);
      c.lineTo(this.x + Math.cos(this.angle) * l - vx, this.y + Math.sin(this.angle) * l - vy);
      c.stroke();
    } else {
      const k = clamp((this.age - this.o.warn) / 0.22, 0, 1);
      c.globalAlpha = (1 - k) * 0.9;
      c.fillStyle = k < 0.3 ? '#ffffff' : LAMP[3];
      c.fill();
    }
    c.restore();
  }

  override light(w: World): void {
    if (!this.struck) return;
    const k = clamp((this.age - this.o.warn) / 0.22, 0, 1);
    const l = shadowLen(w.room, this.x, this.y, this.angle, BEAM_LEN, 8);
    for (let i = 1; i <= 4; i++) w.lights.add(this.x + Math.cos(this.angle) * l * (i / 4), this.y + Math.sin(this.angle) * l * (i / 4), 50, '#ffe080', { intensity: (1 - k) * 0.9 });
  }
}

/** 암전: darkness over the archive; only the beam, the keeper's lantern and every threat stay visible. */
class Blackout extends Entity {
  owner: Enemy;
  level = 0;
  lifting = false;
  private cv: HTMLCanvasElement | null = null;
  constructor(owner: Enemy) {
    super();
    this.owner = owner;
    this.layer = 3;
    this.tileCollide = false;
  }

  lift(): void {
    this.lifting = true;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (!this.owner.alive) this.lifting = true;
    const target = this.lifting ? 0 : 0.86;
    this.level += (target - this.level) * Math.min(1, dt * (this.lifting ? 4 : 1.6));
    if (this.lifting && this.level < 0.01) this.dead = true;
    void w;
  }

  override draw(r: Renderer, w: World): void {
    if (this.level < 0.02 || typeof document === 'undefined') return;
    if (!this.cv || this.cv.width !== VIEW_W) {
      this.cv = document.createElement('canvas');
      this.cv.width = VIEW_W;
      this.cv.height = VIEW_H;
    }
    const g = this.cv.getContext('2d')!;
    const vx = r.viewX;
    const vy = r.viewY;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, VIEW_W, VIEW_H);
    g.fillStyle = `rgba(2,4,10,${this.level.toFixed(3)})`;
    g.fillRect(0, 0, VIEW_W, VIEW_H);
    g.globalCompositeOperation = 'destination-out';
    const hole = (x: number, y: number, rad: number, k = 1) => {
      const sx = x - vx;
      const sy = y - vy;
      if (sx < -rad || sy < -rad || sx > VIEW_W + rad || sy > VIEW_H + rad) return;
      const grd = g.createRadialGradient(sx, sy, rad * 0.3, sx, sy, rad);
      grd.addColorStop(0, `rgba(0,0,0,${k})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
    };
    const poly = (pts: number[], k: number) => {
      g.fillStyle = `rgba(0,0,0,${k})`;
      g.beginPath();
      g.moveTo(pts[0] - vx, pts[1] - vy);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i] - vx, pts[i + 1] - vy);
      g.closePath();
      g.fill();
    };
    const p = w.player;
    hole(p.x, p.y - 6, 54, 1);
    const o = this.owner;
    hole(o.x, o.y + LENS_DY, 34, 0.9);
    hole(o.x, o.y, 26, 0.5);
    for (const e of w.enemies) if (e.alive && e !== o) hole(e.x, e.y - 4, e.r + 12, 0.75);
    for (const e of w.entities) {
      if (e.dead) continue;
      if (e instanceof Projectile) {
        if (e.team === 'enemy') hole(e.x, e.y - e.z, 11, 1);
      } else if (e instanceof GroundWarning) hole(e.x, e.y, e.radius + 10, 0.9);
      else if (e instanceof Lob) hole(e.x, e.y - e.z, 12, 0.9);
      else if (e instanceof Shelf) hole(e.x, e.y - 8, 24, 0.55);
      else if (e instanceof LampBeam) {
        for (const a of e.angles()) poly(e.fan(w, a, e.o.half * 1.9), 0.75);
        for (const a of e.angles()) poly(e.fan(w, a), 1);
      } else if (e instanceof LampFlash) poly(e.fan(w), 0.9);
      else if (e instanceof ShockRing) {
        g.strokeStyle = 'rgba(0,0,0,0.9)';
        g.lineWidth = 14;
        g.beginPath();
        g.arc(e.x - vx, e.y - vy, Math.max(1, e.radius), 0, TAU);
        g.stroke();
      }
    }
    for (const e of w.projectiles) if (!e.dead && e.team === 'enemy') hole(e.x, e.y - e.z, 11, 1);
    const c = r.ctx;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.cv, 0, 0);
    c.restore();
  }
}

// ------------------------------------------------------------------ minion: 가라앉은 선원
defineEnemy({
  id: 'drowned_sailor',
  name: '가라앉은 선원',
  hp: 34,
  radius: 6,
  speed: 38,
  mass: 2,
  sprite: 'dsailor_walk_0',
  shadow: 12,
  deathFx: 'goo',
  bloodColor: '#2f948a',
  contactDamage: 1,
  light: { radius: 22, color: '#e8b030' },
  *script(e, w) {
    while (true) {
      // wade after the keeper, then a short telegraphed lunge
      for (let el = 0; el < w.rng.range(1.4, 2.2); el += w.dt) {
        e.chase(w, e.speed);
        e.setAnim(`dsailor_walk_${Math.floor(e.age * 5) % 2}`);
        yield;
      }
      e.stop();
      e.telegraph(0.5);
      w.sfx('warn', { vol: 0.2, pitch: 0.8 });
      yield 0.5;
      const a = e.angleToTarget(w);
      w.sfx('whoosh', { vol: 0.4, pitch: 0.7 });
      yield* e.charge(w, a, 150, 0.4);
      splash(w, e.x, e.y + 4, 0.8);
      yield 0.5;
    }
  },
});

// ------------------------------------------------------------------ behaviour
function anim(e: Enemy, state: string, restart = false): void {
  e.setAnim(`${e.mem.p2 ? 'lh2' : 'lh'}_${state}`, restart);
}

function lensPos(e: Enemy): { x: number; y: number } {
  return { x: e.x, y: e.y - e.z + LENS_DY };
}

/** Wade slowly toward a spot that keeps the beam covering the arena (just above the centre). */
function* wade(e: Enemy, w: World, time: number): Script {
  anim(e, 'idle');
  const room = w.room;
  for (let el = 0; el < time; el += w.dt) {
    const t = e.target(w);
    const gx = clamp(room.centerX + (t.x - room.centerX) * 0.25, room.interiorX + 60, room.interiorX + room.interiorW - 60);
    const gy = clamp(room.centerY - 12 + (t.y - room.centerY) * 0.15, room.interiorY + 40, room.interiorY + room.interiorH - 40);
    const d = Math.hypot(gx - e.x, gy - e.y);
    e.moveDir(gx - e.x, gy - e.y, Math.min(e.speed * (e.mem.p2 ? 1.4 : 1), d * 1.5));
    if (d > 2 && fx.chance(0.3)) splash(w, e.x + fx.range(-10, 10), e.y + 4, 0.4, TEAL[4]);
    yield;
  }
  e.stop();
}

/** Lob a drowned wisp at a spot near the keeper; where it lands a slow homing light is born. */
function lobWisp(e: Enemy, w: World, spread: number): void {
  const t = e.target(w);
  const a = w.rng.angle();
  const s = inRoom(w, t.x + Math.cos(a) * spread, t.y + Math.sin(a) * spread * 0.7, 14);
  const l = lensPos(e);
  lob(w, l.x, l.y, s.x, s.y, {
    sprite: 'lh_wisp', color: LAMP[2], warn: 12, time: 1.0, height: 70, spin: 0, damage: 0, hitRadius: 0, source: NAME, light: 20,
    onLand: (ww, x, y) => {
      if (!e.alive) return;
      ww.spawn(new Projectile({
        ...bullet6('gold', 3, { z: 8, light: 24 }),
        team: 'enemy', x, y, angle: Math.atan2(ww.player.y - y, ww.player.x - x), speed: 44, damage: 1, owner: e, homing: 1.5, life: 4.2, range: 900,
      }));
      ww.particles.burst(x, y - 6, { count: 8, speed: [20, 60], life: [0.3, 0.6], colors: LAMP_FX, size: [1, 2], additive: true, light: 4 });
      ww.sfx('orb', { vol: 0.35, pitch: 1.4 });
    },
  });
}

/** 등불 회전: the lamp charges, then the beam sweeps a full turn (P2: it halts and reverses). */
function* sweep(e: Enemy, w: World, split: boolean): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  anim(e, 'charge', true);
  e.telegraph(0.9);
  w.sfx('lamp_hum', { vol: 0.8, pitch: 0.9 });
  const dir = w.rng.sign();
  // start a little behind the keeper so the light reaches them about a second in
  const t = e.target(w);
  const a0 = Math.atan2(t.y - e.y, t.x - e.x) - dir * (split ? 0.7 : 1.0);
  const warn = 0.9;
  const omega = dir * (split ? 0.95 : p2 ? 1.2 : 1.0);
  const duration = split ? 5.6 : p2 ? 6.0 : 6.6;
  const beam = w.spawn(new LampBeam(e, a0, {
    source: NAME, warn, duration, omega, half: 0.15, split, reverseAt: p2 && !split ? w.rng.range(2.2, 3.2) : undefined, damage: 1, rehit: 0.7,
  }));
  e.mem.beam = beam;
  yield warn;
  anim(e, 'idle');
  // wisps keep coming while the lamp turns
  let next = 1.4;
  for (let el = 0; el < duration; el += w.dt) {
    next -= w.dt;
    if (next <= 0) {
      next = p2 ? 1.6 : 2.2;
      lobWisp(e, w, 36);
    }
    yield;
  }
  e.mem.beam = null;
  yield 0.6;
}

/** 익사한 혼불: a volley of wisps around the keeper. */
function* wisps(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  anim(e, 'charge', true);
  e.telegraph(0.5);
  w.sfx('orb', { vol: 0.5, pitch: 0.7 });
  yield 0.5;
  const n = p2 ? 5 : 3;
  for (let k = 0; k < n; k++) {
    lobWisp(e, w, k === 0 ? 0 : 30 + k * 8);
    yield 0.2;
  }
  anim(e, 'idle');
  yield 1.4;
}

/** 조류 고리: the tower lurches up and slams down — a gapped tidal ring (P2: two, and a shelf topples). */
function* tidalSlam(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  anim(e, 'crouch', true);
  e.telegraph(0.8);
  w.spawn(new GroundWarning(e.x, e.y + 2, 36, 0.8));
  w.sfx('enemy_charge', { vol: 0.6, pitch: 0.6 });
  yield 0.5;
  e.vz = 175;
  e.z = 0.1;
  w.sfx('whoosh', { vol: 0.6, pitch: 0.5 });
  while (e.z > 0 || e.vz > 0) yield;
  e.z = 0;
  e.vz = 0;
  anim(e, 'idle', true);
  e.squash(1.25, 0.8);
  w.sfx('tide_slam', { vol: 1, pitch: 0.9 });
  w.shake(0.65);
  w.hitstop(0.04);
  hitPlayerCircle(w, e.x, e.y + 2, 34, 1, NAME, 180);
  splash(w, e.x, e.y + 4, 2.4);
  const g = w.rng.angle();
  w.spawn(new ShockRing(e.x, e.y + 2, { speed: 125, maxR: 170, color: TEAL[5], gaps: [g, g + Math.PI], gapWidth: 1.0, damage: 1, source: NAME, thick: 5, debris: [TEAL[5], TEAL[4], '#ffffff'] }));
  if (p2) {
    yield 0.35;
    w.spawn(new ShockRing(e.x, e.y + 2, { speed: 150, maxR: 190, color: LAMP[2], gaps: [g + Math.PI / 2, g - Math.PI / 2], gapWidth: 1.0, damage: 1, source: NAME, thick: 5, debris: LAMP_FX }));
    w.sfx('tide_slam', { vol: 0.6, pitch: 1.2 });
    // the slam topples the nearest standing shelf (at most two per fight)
    if ((e.mem.collapsed ?? 0) < 2) {
      const up = shelves(w).filter((s) => s.standing).sort((a, b) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y));
      if (up.length > 2) {
        up[0].collapse(w);
        e.mem.collapsed = (e.mem.collapsed ?? 0) + 1;
      }
    }
  }
  yield 0.9;
}

/** 섬광: the lens aims (fan telegraph) and flashes, several times. */
function* flashes(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  anim(e, 'charge', true);
  w.sfx('lamp_hum', { vol: 0.5, pitch: 1.2 });
  const n = p2 ? 4 : 3;
  const warn = p2 ? 0.55 : 0.65;
  for (let k = 0; k < n; k++) {
    e.telegraph(warn);
    const t = e.target(w);
    const a = Math.atan2(t.y - 2 - e.y, t.x - e.x);
    const f = w.spawn(new LampFlash(e, a, { source: NAME, warn, half: p2 ? 0.3 : 0.26, damage: 1 }));
    e.mem.flash = f;
    w.sfx('warn', { vol: 0.3, pitch: 1.3 });
    yield warn + 0.2;
    e.mem.flash = null;
    yield p2 ? 0.25 : 0.35;
  }
  anim(e, 'idle');
  yield 0.5;
}

/** 무적: the foghorn — gapped rings of lamp-gold shots roll out with every blast. */
function* foghorn(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  anim(e, 'charge', true);
  e.telegraph(0.7);
  gather(w, e.x, e.y - 30, LAMP_FX, 12, 28);
  w.sfx('lamp_hum', { vol: 0.5, pitch: 0.6 });
  yield 0.7;
  const n = p2 ? 4 : 3;
  let g = Math.atan2(w.player.y - e.y, w.player.x - e.x) + w.rng.range(-0.5, 0.5);
  const dir = w.rng.sign();
  for (let k = 0; k < n; k++) {
    w.sfx('foghorn', { vol: 0.9, pitch: 1 + k * 0.04 });
    w.shake(0.18);
    for (let i = 0; i < 2; i++) w.spawn(new RingFx(e.x, e.y - 30, 30 + i * 26, 0.4 + i * 0.15, i ? LAMP[2] : '#ffffff', 2));
    const count = p2 ? 22 : 18;
    for (const a of gapRing(count, w.rng.range(0, 0.3), [g, g + Math.PI], 0.78)) {
      const pr = e.shoot(w, a, bullet6('gold', 3, { speed: k % 2 ? 78 : 62, z: 6 }));
      pr.x = e.x + Math.cos(a) * 14;
      pr.y = e.y + 2 + Math.sin(a) * 10;
    }
    g += dir * 0.5;
    yield p2 ? 0.4 : 0.5;
  }
  anim(e, 'idle');
  yield 0.8;
}

/** 가라앉은 선원: drowned sailors wade out of the water at the room's edge. */
function* summonSailors(e: Enemy, w: World, n: number): Script {
  e.halt();
  anim(e, 'charge', true);
  e.telegraph(0.5);
  w.sfx('foghorn', { vol: 0.5, pitch: 0.8 });
  yield 0.5;
  for (let i = 0; i < n; i++) {
    const s = spotAround(w, w.player.x, w.player.y, 70, 120, 7) ?? inRoom(w, e.x + (i ? 50 : -50), e.y + 30, 14);
    w.spawn(new GroundWarning(s.x, s.y, 10, 0.7, (ww) => {
      summonMinion6(e, ww, 'drowned_sailor', s.x, s.y, [TEAL[5], TEAL[4], PARCH[3]]);
      splash(ww, s.x, s.y, 1.2);
    }, TEAL[5]));
  }
  yield 0.9;
  anim(e, 'idle');
}

/** 암전 (P2): the archive goes dark; the beam sweeps slowly through the blackness. */
function* blackout(e: Enemy, w: World): Script {
  e.mem.darkAt = e.age;
  e.halt();
  anim(e, 'charge', true);
  e.telegraph(0.8);
  w.sfx('lamp_hum', { vol: 0.7, pitch: 0.5 });
  w.sfx('foghorn', { vol: 0.6, pitch: 0.7 });
  if (!e.mem.taught) {
    e.mem.taught = 1;
    w.banner('서고가 어둠에 잠긴다', '등대의 빛을 피해 그림자 속으로', { color: LAMP[2], small: true });
  }
  const dark = w.spawn(new Blackout(e));
  e.mem.dark = dark;
  yield 0.8;
  const dir = w.rng.sign();
  const t = e.target(w);
  const a0 = Math.atan2(t.y - e.y, t.x - e.x) - dir * 1.1;
  const duration = 7.2;
  const beam = w.spawn(new LampBeam(e, a0, { source: NAME, warn: 0.9, duration, omega: dir * 0.85, half: 0.17, damage: 1, rehit: 0.7, reverseAt: w.rng.range(3.0, 4.2) }));
  e.mem.beam = beam;
  yield 0.9;
  anim(e, 'idle');
  let next = 1.2;
  for (let el = 0; el < duration; el += w.dt) {
    next -= w.dt;
    if (next <= 0) {
      next = 1.9;
      lobWisp(e, w, 40);
    }
    yield;
  }
  e.mem.beam = null;
  dark.lift();
  e.mem.dark = null;
  yield 0.7;
}

function* phaseTwo(e: Enemy, w: World): Script {
  yield* phaseShift(e, w, {
    anim: 'lh_hurt',
    color: LAMP[2],
    time: 1.7,
    onPeak: () => {
      e.mem.p2 = true;
      anim(e, 'charge', true);
      const l = lensPos(e);
      w.sfx('explosion', { vol: 0.7, pitch: 0.7 });
      w.sfx('foghorn', { vol: 1, pitch: 0.9 });
      // the dome blows off
      w.particles.burst(l.x, l.y - 8, { count: 30, speed: [60, 200], life: [0.5, 1.2], colors: [BRASS[3], BRASS[2], PATINA[1], STONE[4]], size: [2, 4], gravity: 320, vz: [80, 220], bounce: 0.3, shape: 'square', vrot: 9 });
      w.particles.burst(l.x, l.y, { count: 30, speed: [30, 140], life: [0.4, 1.0], colors: LAMP_FX, size: [1, 2], additive: true, light: 6, gravity: -40 });
      const g = w.rng.angle();
      for (const a of gapRing(20, 0, [g, g + Math.PI], 0.9)) {
        const pr = e.shoot(w, a, bullet6('gold', 3, { speed: 86, z: 6 }));
        pr.x = e.x + Math.cos(a) * 14;
        pr.y = e.y + 2 + Math.sin(a) * 10;
      }
    },
  });
}

function* patterns(e: Enemy, w: World): Script {
  while (true) {
    const p2 = !!e.mem.p2;
    const sinceDark = e.age - (e.mem.darkAt ?? -99);
    const id = pickPattern(w.rng, [
      { id: 'sweep', w: 3.2 },
      { id: 'split', w: 2.4, when: p2 },
      { id: 'blackout', w: 3.2, when: p2 && sinceDark > 22 },
      { id: 'wisps', w: p2 ? 1.8 : 2.2 },
      { id: 'slam', w: 2.4, when: e.distToTarget(w) < 120 },
      { id: 'flash', w: 2.4 },
      { id: 'horn', w: 2 },
      { id: 'summon', w: 1.1, when: minionCount(w, e) === 0 && w.enemies.length < 4 },
    ], e.mem.last as string | null);
    e.mem.last = id;
    if (id === 'sweep') yield* sweep(e, w, false);
    else if (id === 'split') yield* sweep(e, w, true);
    else if (id === 'blackout') yield* blackout(e, w);
    else if (id === 'wisps') yield* wisps(e, w);
    else if (id === 'slam') yield* tidalSlam(e, w);
    else if (id === 'flash') yield* flashes(e, w);
    else if (id === 'horn') yield* foghorn(e, w);
    else yield* summonSailors(e, w, 2);
    yield* wade(e, w, p2 ? w.rng.range(0.8, 1.2) : w.rng.range(1.1, 1.6));
  }
}

/** Everything it had in the air or on the water goes with it. */
function clearArena(w: World): void {
  clearEnemyShots(w);
  for (const x of w.entities) {
    if (x.dead) continue;
    if (x instanceof GroundWarning || x instanceof LampBeam || x instanceof LampFlash || x instanceof Lob || x instanceof ShockRing) x.dead = true;
    else if (x instanceof Blackout) x.lift();
  }
}

/** Place the collapsed-shelf cover around the arena (only on clear floor, away from doors). */
function placeCover(e: Enemy, w: World): void {
  const room = w.room;
  const spots: [number, number][] = [[-72, -34], [72, -34], [-72, 36], [72, 36]];
  if (room.interiorW > 300) spots.push([-150, 0], [150, 0]);
  if (room.interiorH > 160) spots.push([0, -80], [0, 80]);
  for (const [dx, dy] of spots) {
    const tx = Math.floor((room.centerX + dx) / TILE) - 1;
    const ty = Math.floor((room.centerY + dy) / TILE);
    const cx = (tx + 1) * TILE;
    const cy = (ty + 0.5) * TILE;
    if (!insideRoom(w, cx - TILE, cy, 8) || !insideRoom(w, cx + TILE, cy, 8)) continue;
    if (room.tileAt(tx, ty) !== Tile.FLOOR || room.tileAt(tx + 1, ty) !== Tile.FLOOR) continue;
    if (room.doors.some((d) => Math.hypot(d.x - cx, d.y - cy) < 40)) continue;
    if (Math.hypot(w.player.x - cx, w.player.y - cy) < 22 || Math.hypot(e.x - cx, e.y - cy) < 40) continue;
    const s = new Shelf(tx, ty);
    s.place(w);
    w.spawn(s);
  }
}

// ------------------------------------------------------------------ definition
defineBoss({
  id: 'sunken_lighthouse',
  name: NAME,
  bossTitle: '물속에서도 꺼지지 않는 빛',
  bossFloors: [6],
  bossMusic: 'boss_drowned',
  hp: 880,
  radius: 15,
  speed: 16,
  mass: Infinity,
  phasing: true,
  sprite: 'lh_idle',
  portrait: 'lh_portrait',
  shadow: 0,
  deathFx: 'metal',
  bloodColor: '#9ab8b8',
  contactDamage: 1,
  hurtSfx: 'hit_metal',
  light: { radius: 84, color: '#e8b030' },
  init(e, w) {
    e.mem.last = null;
    e.mem.lensAng = Math.PI / 2;
    e.mem.beam = null;
    e.mem.flash = null;
    e.mem.collapsed = 0;
    if (w.room) placeCover(e, w);
    // every attack by name (debug console / screenshot tooling: `e.script.set(e.mem.attacks.sweep(e, w))`)
    e.mem.attacks = {
      sweep: (b: Enemy, ww: World) => sweep(b, ww, false), split: (b: Enemy, ww: World) => sweep(b, ww, true), blackout, wisps, slam: tidalSlam,
      flash: flashes, horn: foghorn, summon: (b: Enemy, ww: World) => summonSailors(b, ww, 2), patterns,
    } satisfies Record<string, (b: Enemy, ww: World) => Script>;
  },
  *script(e, w) {
    anim(e, 'idle');
    yield 0.3;
    yield* patterns(e, w);
  },
  update(e, w, dt) {
    phaseGate(e, 0.5, 1, function* () {
      e.mem.beam = null;
      yield* phaseTwo(e, w);
      phaseDone(e);
      yield* blackout(e, w);
      yield* patterns(e, w);
    });
    // the lens follows the beam, the flash, or watches the keeper
    const beam = e.mem.beam as LampBeam | null;
    const flash = e.mem.flash as LampFlash | null;
    let want: number;
    if (beam && !beam.dead) want = beam.angle;
    else if (flash && !flash.dead) want = flash.angle;
    else want = Math.atan2(w.player.y - e.y, w.player.x - e.x);
    e.mem.lensAng = (e.mem.lensAng ?? 0) + clamp(angleDiff(e.mem.lensAng ?? 0, want), -4 * dt, 4 * dt);
    // the water laps at its foot; the lamp sheds motes
    if (fx.chance(0.25)) {
      w.particles.spawn({ x: e.x + fx.range(-18, 18), y: e.y + 4 + fx.range(-2, 3), vx: fx.range(-6, 6), life: fx.range(0.4, 0.8), colors: [TEAL[5], TEAL[4]], size: 1, alpha: 0.7 });
    }
    if (fx.chance(e.mem.p2 ? 0.5 : 0.2)) {
      const l = lensPos(e);
      w.particles.spawn({ x: l.x + fx.range(-5, 5), y: l.y + fx.range(-4, 2), vy: -fx.range(6, 16), life: fx.range(0.4, 0.9), colors: LAMP_FX, size: 1, additive: true, light: 3, alpha: 0.8 });
    }
  },
  draw(e, r, w) {
    if (e.hidden) return;
    const k = Math.min(0.6, e.z / 60);
    r.shadow(e.x, e.y + 4, 44 * (1 - k), 12 * (1 - k), 0.35 * e.alpha);
    // light pouring down the tower while the beam is on
    const beam = e.mem.beam as LampBeam | null;
    const l = lensPos(e);
    if (beam && !beam.dead && beam.on) r.line(l.x, l.y, e.x, e.y + 2 - e.z, LAMP[2], 3, 0.18 + 0.08 * Math.sin(e.age * 30));
    e.drawDefault(r, e.frame(), 0);
    // the lens, turned toward where the light goes
    const p2 = !!e.mem.p2;
    const bright = (beam && !beam.dead) || e.anim.endsWith('charge_0');
    r.circle(l.x, l.y, bright ? 11 : 8, LAMP[2], bright ? 0.22 : 0.12);
    r.sprite(p2 ? 'lh_lens2' : 'lh_lens', l.x, l.y, { rot: e.mem.lensAng ?? 0, flash: e.flash > 0 ? 0.8 : 0 });
    void w;
  },
  onDeath(e, w) {
    clearArena(w);
    dissolveMinions(w, e);
    const l = lensPos(e);
    w.sfx('foghorn', { vol: 1, pitch: 0.55 });
    w.sfx('explosion', { vol: 0.9, pitch: 0.6 });
    w.sfx('tide_slam', { vol: 1, pitch: 0.7 });
    bossDeathBurst(w, e.x, e.y - 20, [...STONE_FX, BRASS[3], BRASS[2], TEAL[4]], 40);
    // the lamp bursts: a last flare of light, glass and brass raining into the water
    w.particles.burst(l.x, l.y, { count: 40, speed: [40, 180], life: [0.6, 1.4], colors: [GLASS[2], LAMP[3], BRASS[3], '#ffffff'], size: [1, 3], gravity: 320, vz: [60, 200], bounce: 0.3, shape: 'square', vrot: 9 });
    w.particles.burst(l.x, l.y, { count: 44, speed: [20, 120], life: [0.8, 1.8], colors: LAMP_FX, size: [1, 2], additive: true, light: 6, gravity: -30 });
    for (let i = 0; i < 5; i++) w.spawn(new RingFx(l.x, l.y, 36 + i * 32, 0.6 + i * 0.18, i % 2 ? LAMP[2] : '#ffffff', 2));
    splash(w, e.x, e.y + 4, 3);
    for (let i = 0; i < 3; i++) w.spawn(new RingFx(e.x, e.y + 2, 50 + i * 36, 0.5 + i * 0.15, i % 2 ? '#ffffff' : TEAL[5], 2));
  },
});

export { LampBeam, LampFlash, Shelf, Blackout };
