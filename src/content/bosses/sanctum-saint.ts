import { prismLattice } from './laser-patterns';
import { pickBossPattern } from './tactics';
// Floor 4 boss: 빙결 성녀 (the frozen saint) — 얼어붙은 마지막 찬송.
// A hovering saint of ice whose last hymn froze the whole sanctum. A halo of
// eight ice lances turns behind her head; her robe dissolves into frost mist.
// Phase 1: hymn streams (wavering rose notes), halo lances (each lance aims with a
// lane warning, then launches), frost bloom (rings of ice spikes with gaps around
// her), a choir of acolytes that orbit her.
// Phase 2 (≤50%): her eyes open and the porcelain face cracks — the halo shatters
// outward, a blizzard pushes the keeper sideways while walls of shards (with a gap)
// sweep across the nave, a rose requiem spiral, and everything comes faster.

import { defineBoss } from '../../game/defs';
import { PixelPainter, bayer } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { clamp, TAU } from '../../engine/math';
import { RingFx } from '../../game/effects';
import type { Enemy, ShootOpts } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Script } from '../../engine/script';
import type { ProjBehavior } from '../../game/projectile';
import { BUL, frames, gather, gapStartFor, laneWarning, shard, wallSlots } from '../enemies/shared';
import {
  ball, bossDeathBurst, crack, dissolveMinions, gapRing, inRoom, insideRoom, limb, lum, minionCount, phaseDone, phaseGate, phaseShift, pickPattern,
  beamToWall, Spike, summonMinion,
} from './final-kit';

// ------------------------------------------------------------------ palette
const ROBE = ['#0e1c38', '#1c3866', '#2f5b9a', '#5289c8', '#8cbde8', '#cfe9fb', '#ffffff'];
const VEIL = ['#22385e', '#3a5a8a', '#5e84b4', '#8cb0d8'];
const HOOD = ['#3a5a8a', '#6890bc', '#9cc0e2', '#d4eafa'];
const MANTLE = ['#4a74a6', '#7aa4d0', '#aecfec', '#e0f2ff'];
const SKIN = ['#9a96b8', '#d0cce2', '#f0ecf8', '#ffffff'];
const ROSEC = ['#3e0820', '#8a1440', '#d83a72', '#ff7aa6', '#ffd0e0'];
const ICEC = ['#1a3a78', '#4a86d0', '#8cc8f8', '#e8faff'];
const DEEP = '#061026';

const W = 56;
const H = 80;
const CX = 28;
/** sprite pivot = the saint's torso (entity position) */
const ORIGIN: [number, number] = [28, 38];
/** head centre relative to the pivot */
const HEAD_DY = -23;

type V = [number, number];
type Arms = 'pray' | 'raise' | 'cast' | 'spread';
interface SaintPose {
  arms: Arms;
  head?: V;
  mouth?: boolean;
  hem: number;
  /** the frozen rose at her chest glows (charging) */
  glow?: boolean;
}

// ------------------------------------------------------------------ painting
/** half width of the dress at row y (below the mantle) */
function dressHalf(y: number): number {
  if (y < 28) return -1;
  if (y < 36) return 9.5 + (y - 28) * 0.1;
  return 10.3 + (y - 36) * 0.4;
}

function paintVeilBack(p: PixelPainter, hx: number, hy: number, hem: number): void {
  const s = [0, 1, 0, -1][hem % 4];
  // long veil falling behind the shoulders, its tips fluttering
  p.poly([hx - 6, hy - 7, hx + 6, hy - 7, hx + 12, hy + 10, hx + 16, hy + 30, hx + 18 + s, hy + 42, hx + 12, hy + 39, hx + 8, hy + 44,
    hx, hy + 38, hx - 8, hy + 44, hx - 12, hy + 39, hx - 18 + s, hy + 42, hx - 16, hy + 30, hx - 12, hy + 10], VEIL[1]);
  for (let y = hy - 7; y < hy + 46; y++) {
    for (let x = hx - 19; x < hx + 20; x++) {
      if (!p.isSet(x, y)) continue;
      const fold = Math.sin((x - hx) * 0.8 + hem * 0.7) * 0.5 + 0.5;
      const l = 0.62 - (x - hx) / 40 + (fold - 0.5) * 0.5 - (y - hy) / 110;
      p.px(x, y, VEIL[clamp(Math.floor(l * 4 + (bayer(x, y) - 0.5) * 0.6), 0, 3)]);
    }
  }
}

function paintDress(p: PixelPainter, hem: number, p2: boolean): void {
  const bottom = 64;
  for (let y = 28; y <= bottom + 2; y++) {
    const hw = dressHalf(y);
    for (let x = Math.floor(CX - hw - 1); x <= Math.ceil(CX + hw + 1); x++) {
      const dx = x + 0.5 - CX;
      if (Math.abs(dx) > hw) continue;
      // scalloped, swaying hem
      const sc = Math.abs(Math.sin((dx + hem * 0.8) * 0.55));
      if (y > bottom - 2 + sc * 3) continue;
      const nx = dx / hw;
      const pleat = Math.sin(dx * 1.05 + hem * 0.35) * 0.32;
      let idx = lum(nx * 0.85 + pleat, -0.2 + (y - 28) / 120, ROBE.length - 1, x, y, false, 0.04);
      if (y > bottom - 4 + sc * 3) idx = Math.min(ROBE.length - 1, idx + 2); // frosted frill
      p.px(x, y, ROBE[idx]);
    }
  }
  // icicles under the frill
  const ic = [-17, -12, -6, 0, 6, 11, 16];
  for (let i = 0; i < ic.length; i++) {
    const x = CX + ic[i] + ((hem + i) % 2 ? 0.5 : 0);
    const top = bottom + 1 + (i % 2);
    const len = 3 + ((i * 5 + hem) % 4);
    p.poly([x - 1.5, top, x + 1.5, top, x, top + len], ICEC[1]);
    p.line(x - 0.5, top, x - 0.5, top + len - 2, ICEC[3]);
  }
  // embroidered rose panel down the front, edged in silver
  for (let y = 33; y <= 61; y++) {
    const pw = 2.2 + (y - 33) * 0.06;
    for (let x = Math.floor(CX - pw - 1); x <= Math.ceil(CX + pw); x++) {
      const dx = x + 0.5 - CX;
      if (Math.abs(dx) > pw + 0.9) continue;
      if (Math.abs(dx) > pw) p.px(x, y, ICEC[2]);
      else p.px(x, y, ROSEC[clamp(3 - Math.floor((dx + pw) / (pw * 2) * 3 + (bayer(x, y) - 0.5) * 0.5), 1, 3)]);
    }
    if (y % 7 === 5) {
      p.px(CX, y - 1, ICEC[3]);
      p.px(CX - 1, y, ICEC[3]);
      p.px(CX + 1, y, ICEC[2]);
      p.px(CX, y + 1, ICEC[2]);
      p.px(CX, y, '#ffffff');
    }
  }
  if (p2) {
    // cracks with rose light seeping out
    crack(p, CX - 7, 40, CX - 14, 58, ROSEC[3], 3, 1.2);
    crack(p, CX + 6, 44, CX + 13, 60, ROSEC[3], 7, 1.1);
    crack(p, CX - 3, 48, CX + 1, 62, ROSEC[4], 5, 0.8);
  }
}

function paintMantle(p: PixelPainter, hem: number, p2: boolean): void {
  // short capelet over the shoulders with a scalloped edge and a rose clasp
  const top = 22;
  const bot = 32;
  for (let y = top; y <= bot + 2; y++) {
    const hw = 6 + (y - top) * 0.75;
    for (let x = Math.floor(CX - hw); x <= Math.ceil(CX + hw); x++) {
      const dx = x + 0.5 - CX;
      if (Math.abs(dx) > hw) continue;
      const sc = Math.abs(Math.sin(dx * 0.62 + hem * 0.2));
      if (y > bot - 1 + sc * 2.5) continue;
      const idx = lum(dx / hw, -0.5 + (y - top) / 14, MANTLE.length, x, y, true, 0.05);
      p.px(x, y, y > bot - 2.2 + sc * 2.5 ? ICEC[3] : MANTLE[idx]);
    }
  }
  ball(p, CX, 25.5, 1.8, 1.6, p2 ? ['#a8164c', '#ff5c8e', '#ffd0e0', '#ffffff'] : ROSEC.slice(1), false);
  p.px(CX - 1, 25, '#ffffff');
}

function paintSleeve(p: PixelPainter, sh: V, el: V, hand: V): void {
  // upper arm under the mantle, a flaring bell sleeve, a small pale hand
  limb(p, sh[0], sh[1], 3.2, el[0], el[1], 3, [DEEP]);
  limb(p, sh[0], sh[1], 2.4, el[0], el[1], 2.2, ROBE.slice(2, 6));
  const dx = hand[0] - el[0];
  const dy = hand[1] - el[1];
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const cx = el[0] + ux * l * 0.78;
  const cy = el[1] + uy * l * 0.78;
  const nx = -uy;
  const ny = ux;
  const poly = [el[0] + nx * 2.4, el[1] + ny * 2.4, cx + nx * 4.6, cy + ny * 4.6, cx - nx * 4.6, cy - ny * 4.6, el[0] - nx * 2.4, el[1] - ny * 2.4];
  // dark rim, sleeve body, frosted cuff
  const rim = poly.map((v, i) => v + (i % 2 ? (i === 3 || i === 5 ? uy : 0) : (i === 2 || i === 4 ? ux : 0)));
  p.poly(rim, DEEP);
  p.poly(poly, ROBE[3]);
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    const w = 2.4 + (4.6 - 2.4) * t;
    const mx = el[0] + ux * l * 0.78 * t;
    const my = el[1] + uy * l * 0.78 * t;
    p.px(mx + nx * (w - 0.8), my + ny * (w - 0.8), ROBE[5]);
    p.px(mx - nx * (w - 0.8), my - ny * (w - 0.8), ROBE[1]);
  }
  p.line(cx + nx * 4.2, cy + ny * 4.2, cx - nx * 4.2, cy - ny * 4.2, ICEC[3]);
  // hand
  ball(p, hand[0], hand[1], 1.6, 1.6, SKIN, false);
  p.px(hand[0] - 0.5, hand[1] - 0.5, '#ffffff');
}

function paintRose(p: PixelPainter, x: number, y: number, glow: boolean): void {
  p.line(x, y + 1, x, y + 5, '#3a8a6a');
  p.px(x + 1, y + 3, '#5ac08a');
  ball(p, x, y, 2.2, 2, glow ? ['#ff7aa6', '#ffb0c8', '#ffd0e0', '#ffffff'] : ROSEC.slice(1), false);
  p.px(x, y, glow ? '#ffffff' : ROSEC[4]);
  p.px(x - 1, y - 1, ROSEC[1]);
}

function paintArms(p: PixelPainter, o: SaintPose): void {
  const ls: V = [21, 27];
  const rs: V = [35, 27];
  switch (o.arms) {
    case 'pray':
      paintSleeve(p, ls, [19, 35], [27, 34]);
      paintSleeve(p, rs, [37, 35], [29, 34]);
      paintRose(p, CX, 31, !!o.glow);
      break;
    case 'raise':
      paintSleeve(p, ls, [15, 22], [11, 12]);
      paintSleeve(p, rs, [41, 22], [45, 12]);
      break;
    case 'cast':
      paintSleeve(p, ls, [19, 35], [26, 35]);
      paintSleeve(p, rs, [41, 30], [50, 25]);
      paintRose(p, 51, 21, true);
      break;
    case 'spread':
      paintSleeve(p, ls, [15, 32], [7, 31]);
      paintSleeve(p, rs, [41, 32], [49, 31]);
      break;
  }
}

function paintHead(p: PixelPainter, o: SaintPose, p2: boolean): void {
  const hx = CX + (o.head?.[0] ?? 0);
  const hy = ORIGIN[1] + HEAD_DY + (o.head?.[1] ?? 0);
  // pointed veil hood
  const hood = new PixelPainter(W, H);
  hood.poly([hx - 7.5, hy + 7, hx - 7.5, hy - 2, hx - 3, hy - 8, hx, hy - 11, hx + 3, hy - 8, hx + 7.5, hy - 2, hx + 7.5, hy + 7], HOOD[2]);
  for (let y = hy - 11; y <= hy + 8; y++) {
    for (let x = hx - 8; x <= hx + 8; x++) {
      if (!hood.isSet(x, y)) continue;
      p.px(x, y, HOOD[lum((x + 0.5 - hx) / 8, (y - hy) / 10, HOOD.length, x, y, true, 0.05)]);
    }
  }
  // face opening in deep shadow, porcelain face inside (flat, softly shaded at the rim)
  p.ellipse(hx, hy + 2, 5, 6, '#101a34');
  p.ellipse(hx, hy + 2.5, 4, 5, SKIN[2]);
  for (let y = hy - 3; y <= hy + 8; y++) {
    for (let x = hx - 5; x <= hx + 5; x++) {
      const nx = (x + 0.5 - hx) / 4;
      const ny = (y + 0.5 - hy - 2.5) / 5;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      if (d > 0.62 && nx + ny * 0.6 > 0.1) p.px(x, y, SKIN[1]);
      else if (d < 0.25 && nx + ny < -0.2) p.px(x, y, SKIN[3]);
    }
  }
  // the hood's brim casts a shadow on the brow
  p.line(hx - 3, hy - 2, hx + 3, hy - 2, SKIN[0]);
  // Frost beads on the veil, kept outside the expressive eye area.
  p.line(hx - 6, hy, hx - 6, hy + 4, ICEC[2]);
  p.px(hx - 6, hy + 5, ICEC[3]);
  p.px(hx + 6, hy + 3, ICEC[3]);
  const ey = hy + 2;
  if (p2) {
    // eyes open, burning rose; the porcelain cracks
    p.line(hx - 3, ey - 1, hx - 1, ey - 1, '#1c1a3a');
    p.line(hx + 1, ey - 1, hx + 3, ey - 1, '#1c1a3a');
    p.line(hx - 3, ey, hx - 2, ey, ROSEC[3]);
    p.line(hx + 2, ey, hx + 3, ey, ROSEC[3]);
    p.px(hx - 2, ey, '#ffffff');
    p.px(hx + 2, ey, '#ffffff');
    crack(p, hx + 1, hy - 2, hx + 3, hy + 6, '#3a3858', 9, 0.8);
    p.px(hx - 3, ey + 1, ROSEC[2]);
    p.px(hx - 3, ey + 2, ROSEC[1]);
  } else {
    // serene closed eyes (downward arcs with lashes), frozen tears
    p.line(hx - 3, ey, hx - 1, ey, '#1c1a3a');
    p.px(hx - 3, ey - 1, '#1c1a3a');
    p.line(hx + 1, ey, hx + 3, ey, '#1c1a3a');
    p.px(hx + 3, ey - 1, '#1c1a3a');
    p.px(hx - 2, ey + 2, ICEC[1]);
    p.px(hx + 2, ey + 3, ICEC[1]);
  }
  // cheeks + lips
  p.px(hx - 3, ey + 2, '#f0b8d0');
  p.px(hx + 3, ey + 2, '#e0a8c4');
  if (o.mouth) {
    p.rect(hx - 1, ey + 3, 2, 2, '#2a0a1a');
    p.px(hx, ey + 4, ROSEC[3]);
  } else {
    p.px(hx - 1, ey + 4, ROSEC[2]);
    p.px(hx, ey + 4, ROSEC[3]);
  }
  // crown of ice spikes over the hood
  for (const [dx, h] of [[-5, 2], [-3, 4], [0, 6], [3, 4], [5, 2]] as const) {
    const bx = hx + dx;
    const by = hy - 8 + Math.abs(dx) * 0.6;
    p.poly([bx - 1, by, bx, by - h, bx + 1, by], dx === 0 ? ICEC[3] : ICEC[2]);
    p.px(bx, by - h + 1, '#ffffff');
  }
  p.px(hx, hy - 8, p2 ? '#ffffff' : ROSEC[3]);
}

function paintSaint(p: PixelPainter, o: SaintPose, p2: boolean): void {
  const hx = CX + (o.head?.[0] ?? 0);
  const hy = ORIGIN[1] + HEAD_DY + (o.head?.[1] ?? 0);
  paintVeilBack(p, hx, hy, o.hem);
  // Pointed stained-glass panels attached to the frost veil.
  for (const s of [-1, 1]) {
    p.poly([hx + s * 6, hy + 3, hx + s * 15, hy - 8, hx + s * 18, hy + 5, hx + s * 12, hy + 21], '#304d76');
    p.line(hx + s * 15, hy - 7, hx + s * 17, hy + 5, '#a3ccde');
    p.line(hx + s * 17, hy + 5, hx + s * 12, hy + 19, '#759ec2');
    p.poly([hx + s * 12, hy + 1, hx + s * 15, hy + 5, hx + s * 12, hy + 12, hx + s * 10, hy + 6], p2 ? '#cc739d' : '#7394bb');
  }
  paintDress(p, o.hem, p2);
  paintArms(p, o);
  paintMantle(p, o.hem, p2);
  if (o.arms === 'pray' || o.arms === 'cast') {
    // hands + rose sit in front of the mantle edge
    if (o.arms === 'pray') paintRose(p, CX, 31, !!o.glow);
  }
  paintHead(p, o, p2);
}

// ------------------------------------------------------------------ frames
const POSES: Record<string, SaintPose[]> = {
  idle: [0, 1, 2, 3].map((i) => ({ arms: 'pray' as Arms, hem: i })),
  sing: [
    { arms: 'raise', head: [0, -1], mouth: true, hem: 1 },
    { arms: 'raise', head: [0, -1], mouth: false, hem: 2 },
  ],
  cast: [
    { arms: 'cast', head: [1, 0], hem: 0 },
    { arms: 'cast', head: [1, 0], hem: 1 },
  ],
  charge: [
    { arms: 'pray', hem: 0, glow: true },
    { arms: 'pray', hem: 1, glow: false },
  ],
  hurt: [{ arms: 'spread', head: [1, 1], hem: 2 }],
};
const FPS: Record<string, number> = { idle: 5, sing: 6, cast: 8, charge: 12, hurt: 1 };

for (const [state, poses] of Object.entries(POSES)) {
  for (const [pre, p2] of [['fsaint', false], ['fsaint2', true]] as const) {
    frames(pre, state, poses.length, W, H, (p, i) => paintSaint(p, poses[i], p2), { origin: ORIGIN, fps: FPS[state] ?? 6, outline: DEEP });
  }
}

// halo ring (behind the head) and the lances that ride on it
function paintHaloRing(p: PixelPainter, p2: boolean): void {
  const c = 17.5;
  p.ring(c, c, 14, 2, p2 ? '#ff9ab8' : ICEC[2]);
  p.ring(c, c, 13, 1, p2 ? ROSEC[2] : ICEC[1]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + TAU / 16;
    const x = c + Math.cos(a) * 13.5;
    const y = c + Math.sin(a) * 13.5;
    p.rect(Math.round(x) - 1, Math.round(y) - 1, 2, 2, p2 ? '#ffffff' : ROSEC[3]);
  }
}
defineDrawnSprite('fsaint_halo', 35, 35, (p) => paintHaloRing(p, false), { outline: DEEP });
defineDrawnSprite('fsaint_halo2', 35, 35, (p) => paintHaloRing(p, true), { outline: '#2a0614' });
defineDrawnSprite('fsaint_lance', 5, 13, (p) => {
  p.poly([0, 13, 2.5, 0, 5, 13], ICEC[1]);
  p.poly([1, 13, 2.5, 1, 2.5, 13], ICEC[3]);
  p.line(2, 2, 2, 11, '#ffffff');
  p.rect(1, 11, 3, 2, ROSEC[2]);
}, { outline: DEEP, origin: [2, 12] });

// musical-note bullet (rose)
defineDrawnSprite('fsaint_note', 7, 9, (p) => {
  p.line(5, 0, 5, 6, BUL.hymn.rim);
  p.line(5, 0, 6, 1, BUL.hymn.rim);
  p.line(6, 1, 6, 3, BUL.hymn.rim);
  p.ellipse(3, 6.5, 3, 2.4, BUL.hymn.color);
  p.ellipse(2.6, 6.2, 1.6, 1.2, BUL.hymn.core);
  p.px(2, 6, '#ffffff');
}, { outline: BUL.hymn.outline });

// portrait: arms raised in song, halo + lances, larger canvas
defineDrawnSprite('fsaint_portrait', 64, 86, (p) => {
  const ox = 4;
  const oy = 6;
  const halo = new PixelPainter(35, 35);
  paintHaloRing(halo, false);
  p.blit(halo, ox + CX - 17, oy + ORIGIN[1] + HEAD_DY - 18);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU - Math.PI / 2;
    const bx = ox + CX + Math.cos(a) * 17;
    const by = oy + ORIGIN[1] + HEAD_DY - 1 + Math.sin(a) * 17;
    const tx = bx + Math.cos(a) * 8;
    const ty = by + Math.sin(a) * 8;
    limb(p, bx, by, 1.6, tx, ty, 0.4, ICEC);
  }
  const body = new PixelPainter(W, H);
  paintSaint(body, POSES.sing[0], false);
  p.blit(body, ox, oy);
}, { outline: DEEP });

// ------------------------------------------------------------------ behaviour
const NAME = '빙결 성녀';
const ROSE_FX = ['#ffffff', '#ffb0c8', '#ff5c8e'];
const ICE_FX = ['#ffffff', '#c4f0ff', '#6aa8e8'];
const LANCES = 8;

function anim(e: Enemy, state: string, restart = false): void {
  e.setAnim(`${e.mem.p2 ? 'fsaint2' : 'fsaint'}_${state}`, restart);
}

function headPos(e: Enemy): { x: number; y: number } {
  return { x: e.x, y: e.y + HEAD_DY + (e.mem.bob ?? 0) };
}

/** World position of halo lance `i`. */
function lancePos(e: Enemy, i: number): { x: number; y: number; a: number } {
  const h = headPos(e);
  const a = (e.mem.haloA ?? 0) + (i / LANCES) * TAU - Math.PI / 2;
  return { x: h.x + Math.cos(a) * 17, y: h.y - 1 + Math.sin(a) * 17, a };
}

/** Projectile behavior: snake left/right around the launch heading. */
function waver(amp: number, freq: number, phase: number): ProjBehavior {
  return {
    id: 'waver',
    update(p) {
      if (p.mem.base === undefined) p.mem.base = p.angle;
      p.angle = p.mem.base + Math.sin(p.age * freq + phase) * amp;
    },
  };
}

function noteShot(speed: number, extra: ShootOpts = {}): ShootOpts {
  return { color: BUL.hymn.color, sprite: 'fsaint_note', spriteRotates: false, radius: 3, light: 18, speed, z: 8, ...extra };
}

/** Glide to a spot in the upper part of the nave, keeping a respectful distance. */
function* glide(e: Enemy, w: World, time: number): Script {
  anim(e, 'idle');
  const room = w.room;
  const side = w.rng.sign();
  for (let el = 0; el < time; el += w.dt) {
    const t = e.target(w);
    const gx = clamp(t.x + side * 70 + Math.sin(e.age * 0.7) * 20, room.interiorX + 30, room.interiorX + room.interiorW - 30);
    const gy = clamp(Math.min(t.y - 60, room.interiorY + 46), room.interiorY + 34, room.interiorY + room.interiorH - 50);
    const d = Math.hypot(gx - e.x, gy - e.y);
    e.moveDir(gx - e.x, gy - e.y, Math.min(e.speed * (e.mem.p2 ? 1.3 : 1), d * 2.2));
    e.facing = t.x >= e.x ? 1 : -1;
    yield;
  }
  e.stop();
}

function* hymn(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  anim(e, 'sing', true);
  e.telegraph(0.6);
  w.sfx('beam_charge', { vol: 0.4, pitch: 1.6 });
  const h = headPos(e);
  gather(w, h.x, h.y + 5, ROSE_FX, 12, 22);
  yield 0.6;
  const streams = p2 ? 5 : 3;
  const shots = p2 ? 7 : 6;
  const base = Math.atan2(w.player.y - h.y, w.player.x - h.x);
  for (let k = 0; k < shots; k++) {
    for (let s = 0; s < streams; s++) {
      const a = base + (s - (streams - 1) / 2) * (p2 ? 0.36 : 0.44);
      const pr = e.shoot(w, a, noteShot(p2 ? 86 : 76, { behaviors: [waver(0.32, 6, s * 1.3)] }));
      pr.x = h.x + Math.cos(a) * 6;
      pr.y = h.y + 6;
    }
    w.sfx('enemy_shoot', { vol: 0.3, pitch: 1.5 + (k % 3) * 0.12 });
    yield 0.14;
  }
  anim(e, 'idle');
  yield 0.4;
}

function* haloLances(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  anim(e, 'cast', true);
  e.telegraph(0.45);
  w.sfx('freeze', { vol: 0.5, pitch: 1.4 });
  yield 0.45;
  const order = [...Array(LANCES).keys()];
  w.rng.shuffle(order);
  const aimT = p2 ? 0.45 : 0.55;
  for (const i of order) {
    if (!e.mem.lances[i]) continue;
    const lp = lancePos(e, i);
    const p = w.player;
    const a = Math.atan2(p.y - 4 - lp.y, p.x - lp.x);
    e.mem.lances[i] = 0;
    e.mem.aiming.push({ i, a, t: aimT, x: lp.x, y: lp.y });
    const inside = inRoom(w, lp.x, lp.y, 2);
    laneWarning(w, lp.x, lp.y, a, Math.max(20, beamToWall(w, inside.x, inside.y, a) + Math.hypot(inside.x - lp.x, inside.y - lp.y)), 7, aimT);
    w.sfx('warn', { vol: 0.25, pitch: 1.6 });
    yield p2 ? 0.15 : 0.24;
  }
  yield aimT + 0.2;
  anim(e, 'idle');
  e.mem.regrow = 1.2;
  yield 0.3;
}

function* frostBloom(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  anim(e, 'sing', true);
  e.telegraph(0.55);
  w.sfx('freeze', { vol: 0.6, pitch: 0.7 });
  gather(w, e.x, e.y + 10, ICE_FX, 14, 30);
  yield 0.55;
  const radii = p2 ? [32, 58, 84, 110, 136] : [34, 62, 90, 118];
  let gap = Math.atan2(w.player.y - e.y, w.player.x - e.x) + w.rng.range(-0.6, 0.6);
  for (let k = 0; k < radii.length; k++) {
    const r = radii[k];
    const n = Math.max(8, Math.round((TAU * r) / 17));
    const gaps = [gap, gap + Math.PI + w.rng.range(-0.5, 0.5)];
    for (const a of gapRing(n, w.rng.range(0, 0.3), gaps, 46 / r + 0.25)) {
      const x = e.x + Math.cos(a) * r;
      const y = e.y + 14 + Math.sin(a) * r * 0.8;
      if (!insideRoom(w, x, y, 5)) continue;
      w.spawn(new Spike(x, y, 'ice', 0.8 + k * (p2 ? 0.32 : 0.4), { radius: 8, source: NAME, linger: 0.4 }));
    }
    gap += w.rng.sign() * w.rng.range(0.9, 1.4);
  }
  w.sfx('enemy_shoot', { vol: 0.3, pitch: 0.6 });
  yield 0.6;
  anim(e, 'idle');
  yield 0.8 + radii.length * 0.35;
}

function* choir(e: Enemy, w: World): Script {
  e.halt();
  anim(e, 'sing', true);
  e.telegraph(0.5);
  for (let i = 0; i < 3; i++) {
    w.sfx('orb', { vol: 0.35, pitch: 1.3 + i * 0.2 });
    yield 0.17;
  }
  let slot = 0;
  for (const side of [-1, 1]) {
    if (minionCount(w, e, 'choir_acolyte') >= 2) break;
    const m = summonMinion(e, w, 'choir_acolyte', e.x + side * 22, e.y - 4, ROSE_FX);
    if (m) m.mem.slot = slot++;
  }
  yield 0.5;
  anim(e, 'idle');
}

function* blizzard(e: Enemy, w: World): Script {
  const room = w.room;
  anim(e, 'idle');
  // drift to the top centre of the nave
  const gx = room.centerX;
  const gy = room.interiorY + 30;
  for (let el = 0; el < 0.9; el += w.dt) {
    e.moveDir(gx - e.x, gy - e.y, Math.min(90, Math.hypot(gx - e.x, gy - e.y) * 3));
    yield;
  }
  e.halt();
  anim(e, 'sing', true);
  e.telegraph(0.6);
  const side = w.rng.sign();
  w.sfx('whoosh', { vol: 0.7, pitch: 0.5 });
  e.mem.wind = side * 0.35;
  yield 0.6;
  e.mem.wind = side;
  const slots = 12;
  const gap = 3;
  const startX = side > 0 ? room.interiorX + 6 : room.interiorX + room.interiorW - 6;
  const dir = side > 0 ? 0 : Math.PI;
  let last = 0;
  for (let k = 0; k < 3; k++) {
    // the hole moves every wall: you have to cross the nave against the wind
    const off = (k === 0 ? w.rng.range(-3, 3) : last + w.rng.sign() * w.rng.range(2.5, 4));
    const gs = gapStartFor(slots, gap, clamp(off, -4.5, 4.5));
    last = gs - (slots - 1) / 2 + (gap - 1) / 2;
    for (const s of wallSlots(slots, gs, gap)) {
      const y = room.centerY + s * (room.interiorH / slots);
      const pr = e.shoot(w, dir, shard('frost', 3, { speed: 82, delay: 0.55, range: room.interiorW + 20, z: 6 }));
      pr.x = startX;
      pr.y = y;
    }
    w.sfx('freeze', { vol: 0.45, pitch: 1.2 });
    yield 1.25;
  }
  yield 1.6;
  e.mem.wind = 0;
  anim(e, 'idle');
  yield 0.3;
}

function* requiem(e: Enemy, w: World): Script {
  e.halt();
  anim(e, 'charge', true);
  e.telegraph(0.6);
  gather(w, e.x, e.y - 6, ROSE_FX, 14, 28);
  w.sfx('beam_charge', { vol: 0.5, pitch: 0.9 });
  yield 0.6;
  anim(e, 'sing', true);
  const dir = w.rng.sign();
  let a = w.rng.angle();
  for (let k = 0; k < 24; k++) {
    for (let i = 0; i < 3; i++) e.shoot(w, a + (i / 3) * TAU, noteShot(62));
    if (k % 6 === 3) for (const b of gapRing(10, a + 0.3, [], 0)) e.shoot(w, b, shard('frost', 2, { speed: 54, z: 6 }));
    w.sfx('enemy_shoot', { vol: 0.2, pitch: 1.3 + (k % 4) * 0.1 });
    a += dir * 0.24;
    yield 0.11;
  }
  anim(e, 'idle');
  yield recover(e, 0.7);
}

function* phaseTwo(e: Enemy, w: World): Script {
  e.mem.wind = 0;
  e.mem.aiming = [];
  yield* phaseShift(e, w, {
    anim: 'fsaint_hurt',
    color: '#ff7aa6',
    time: 1.5,
    onPeak: () => {
      e.mem.p2 = true;
      anim(e, 'sing', true);
      // the halo shatters outward (a gapped ring of lances)
      const g = w.rng.angle();
      const h = headPos(e);
      for (const a of gapRing(16, 0, [g, g + Math.PI], 0.9)) {
        const pr = e.shoot(w, a, shard('frost', 3, { speed: 96, z: 8 }));
        pr.x = h.x + Math.cos(a) * 16;
        pr.y = h.y + Math.sin(a) * 16;
      }
      e.mem.lances = Array(LANCES).fill(0);
      e.mem.regrow = 1.4;
      w.sfx('rock_break', { vol: 0.7, pitch: 1.4 });
      w.particles.burst(h.x, h.y, { count: 24, speed: [50, 150], life: [0.4, 0.8], colors: ICE_FX, size: [1, 2], gravity: 200, vz: [20, 90], shape: 'square', vrot: 9 });
    },
  });
  if (minionCount(w, e) === 0) yield* choir(e, w);
}

/** Floor 4: the pause after an attack, a little shorter than the shallower floors' (shorter still in phase 2). */
function recover(e: Enemy, t: number): number {
  return t * (e.mem.p2 ? 0.6 : 0.72);
}

function* patterns(e: Enemy, w: World): Script {
  while (true) {
    const p2 = !!e.mem.p2;
    const lancesUp = (e.mem.lances as number[]).filter(Boolean).length;
    const id = pickBossPattern(e, w, [
      { id: 'hymn', w: 3 },
      { id: 'prisms', w: 2.8, when: e.age - (e.mem.lastLaserAt ?? -99) > 14 && minionCount(w, e, 'frost_prism') === 0 },
      { id: 'lances', w: 2.6, when: lancesUp >= 6 },
      { id: 'bloom', w: 2.4 },
      { id: 'choir', w: 1.2, when: minionCount(w, e) === 0 && w.enemies.length < 4 },
      { id: 'blizzard', w: 2.4, when: p2 },
      { id: 'requiem', w: 2, when: p2 },
    ], e.mem.last as string | null);
    e.mem.last = id;
    if (id === 'prisms') yield* prismLattice(e, w);
    else if (id === 'hymn') yield* hymn(e, w);
    else if (id === 'lances') yield* haloLances(e, w);
    else if (id === 'bloom') yield* frostBloom(e, w);
    else if (id === 'choir') yield* choir(e, w);
    else if (id === 'blizzard') yield* blizzard(e, w);
    else yield* requiem(e, w);
    yield* glide(e, w, p2 ? w.rng.range(0.3, 0.45) : w.rng.range(0.4, 0.6));
  }
}

defineBoss({
  id: 'frost_saint',
  name: NAME,
  bossTitle: '얼어붙은 마지막 찬송',
  bossFloors: [4],
  hp: 1150,
  radius: 13,
  speed: 52,
  mass: 6,
  flying: true,
  phasing: true,
  sprite: 'fsaint_idle',
  portrait: 'fsaint_portrait',
  shadow: 0,
  deathFx: 'ice',
  bloodColor: '#a8e2ff',
  contactDamage: 1,
  hurtSfx: 'hit',
  light: { radius: 64, color: '#9cd8ff' },
  init(e) {
    e.mem.lances = Array(LANCES).fill(1);
    e.mem.aiming = [] as { i: number; a: number; t: number; x: number; y: number }[];
    e.mem.haloA = 0;
    e.mem.last = null;
    e.mem.wind = 0;
  },
  *script(e, w) {
    anim(e, 'idle');
    yield 0.3;
    yield* patterns(e, w);
  },
  update(e, w, dt) {
    phaseGate(e, 0.5, 1, function* () {
      yield* phaseTwo(e, w);
      phaseDone(e);
      yield* patterns(e, w);
    });
    e.mem.bob = Math.sin(e.age * 2.1) * 2;
    e.mem.haloA = (e.mem.haloA ?? 0) + dt * (e.mem.p2 ? 0.9 : 0.45);
    // aimed lances leave the halo after their warning
    const aiming = e.mem.aiming as { i: number; a: number; t: number; x: number; y: number }[];
    for (const l of aiming) {
      l.t -= dt;
      if (l.t <= 0) {
        const pr = e.shoot(w, l.a, shard('frost', 4, { speed: e.mem.p2 ? 270 : 240, z: 8, range: 420 }));
        pr.x = l.x;
        pr.y = l.y;
        w.sfx('shoot_arrow', { vol: 0.4, pitch: 0.8 });
        w.particles.burst(l.x, l.y, { count: 6, speed: [20, 60], life: [0.2, 0.4], colors: ICE_FX, size: [1, 2] });
      }
    }
    e.mem.aiming = aiming.filter((l) => l.t > 0);
    // lances grow back one by one
    if (e.mem.regrow > 0) {
      e.mem.regrow -= dt;
      if (e.mem.regrow <= 0) {
        const lances = e.mem.lances as number[];
        const i = lances.indexOf(0);
        if (i >= 0 && aiming.every((l) => l.i !== i)) {
          lances[i] = 1;
          const lp = lancePos(e, i);
          w.particles.burst(lp.x, lp.y, { count: 5, speed: [10, 40], life: [0.2, 0.4], colors: ICE_FX, size: [1, 1], additive: true });
          w.sfx('freeze', { vol: 0.15, pitch: 2 });
        }
        e.mem.regrow = lances.includes(0) ? 0.28 : 0;
      }
    }
    // blizzard wind pushes the keeper (always weaker than walking speed)
    const wind = e.mem.wind ?? 0;
    const p = w.player;
    if (wind && p.alive) {
      const dx = wind * 30 * dt;
      if (!w.room.boxBlocked(p.x + dx, p.y, p.r, p.flying, p.phasing)) p.x += dx;
      for (let i = 0; i < 3; i++) {
        const room = w.room;
        w.particles.spawn({
          x: wind > 0 ? room.interiorX + fx.range(0, 30) : room.interiorX + room.interiorW - fx.range(0, 30), y: room.interiorY + fx.range(0, room.interiorH),
          vx: wind * fx.range(160, 240), vy: fx.range(-10, 10), life: fx.range(0.8, 1.4), colors: ['#ffffff', '#c4f0ff'], size: 1, shape: 'pixel', alpha: 0.7,
        });
      }
    } else if (fx.chance(0.3)) {
      w.particles.spawn({
        x: e.x + fx.range(-12, 12), y: e.y + 22 + fx.range(-3, 3), vy: fx.range(4, 14), vx: fx.range(-6, 6), life: fx.range(0.5, 1),
        colors: e.mem.p2 ? ['#ffffff', '#ffb0c8'] : ['#ffffff', '#c4f0ff', '#6aa8e8'], size: 1, alpha: 0.8,
      });
    }
  },
  draw(e, r, w) {
    if (e.hidden) return;
    const bob = e.mem.bob ?? 0;
    r.shadow(e.x, e.y + 32, 30, 8, 0.3);
    const h = headPos(e);
    const p2 = !!e.mem.p2;
    r.sprite(p2 ? 'fsaint_halo2' : 'fsaint_halo', h.x, h.y - 1, { rot: e.mem.haloA ?? 0, alpha: e.alpha });
    const lances = e.mem.lances as number[];
    for (let i = 0; i < LANCES; i++) {
      if (!lances[i]) continue;
      const lp = lancePos(e, i);
      r.sprite('fsaint_lance', lp.x, lp.y, { rot: lp.a + Math.PI / 2, alpha: e.alpha });
    }
    // lances about to launch hover in place, pointing at their target, blinking
    for (const l of e.mem.aiming as { a: number; x: number; y: number; t: number }[]) {
      r.sprite('fsaint_lance', l.x, l.y, { rot: l.a + Math.PI / 2, flash: Math.floor(l.t * 20) % 2 ? 0.8 : 0 });
    }
    e.drawDefault(r, e.frame(), bob);
  },
  onDeath(e, w) {
    dissolveMinions(w, e);
    e.mem.wind = 0;
    w.sfx('freeze', { vol: 1, pitch: 0.6 });
    w.sfx('rock_break', { vol: 0.9, pitch: 1.2 });
    bossDeathBurst(w, e.x, e.y, ['#ffffff', '#e8faff', '#8cc8f8', '#4a86d0', '#ff7aa6']);
    // rose petals drifting down + a burst of light
    w.particles.burst(e.x, e.y - 10, { count: 36, speed: [20, 90], life: [1.0, 2.0], colors: ['#ffd0e0', '#ff7aa6', '#d83a72'], size: [1, 2], gravity: 40, drag: 1.5, vz: [20, 60] });
    w.particles.burst(e.x, e.y - 10, { count: 30, speed: [20, 120], life: [0.6, 1.4], colors: ['#ffffff', '#c4f0ff'], size: [1, 2], additive: true, light: 5, gravity: -30 });
    for (let i = 0; i < 4; i++) w.spawn(new RingFx(e.x, e.y, 40 + i * 30, 0.6 + i * 0.2, i % 2 ? '#ff7aa6' : '#e8faff', 2));
  },
});
