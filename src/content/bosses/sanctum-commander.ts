import { bossIntercept, pickBossPattern } from './tactics';
// Floor 4 boss: 서리 기사단장 (the frost knight-commander) — 맹세에 얼어붙은 검.
// The last commander of the sanctum guard, frozen to his oath. A towering knight in
// rimed plate with a horned great helm and a greatsword of solid ice, drawn as a
// separate sprite so every swing sweeps through a real arc.
// Phase 1: shoulder charge across the nave (stuns himself on the wall, icicles
// rain down), leaping slam (shock ring with gaps + spike cross), sweeping slash
// (fan telegraph, then the blade sweeps the sector and throws shards), glacier
// wall (lines of ice spikes racing out from the planted sword), rallying knights.
// Phase 2 (≤50%): the plate cracks and his visor burns with cold fire — slash
// combos, chained charges that leave frost behind, icicle storms, wider walls.

import { defineBoss } from '../../game/defs';
import { PixelPainter, bayer } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { angleDiff, clamp, TAU } from '../../engine/math';
import { GroundWarning, RingFx } from '../../game/effects';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { Script } from '../../engine/script';
import { dizzy, frames, gather, landingSpot, laneWarning, shard, spotAround } from '../enemies/shared';
import {
  ball, beamToWall, bossDeathBurst, crack, dissolveMinions, Faller, hitPlayerCircle, icicleSprite, limb, lum, minionCount,
  phaseDone, phaseGate, phaseShift, pickPattern, Sector, ShockRing, spikeLine, Spike, summonMinion,
} from './final-kit';

// ------------------------------------------------------------------ palette
const STEEL = ['#121828', '#232e48', '#3a4c6e', '#5c7398', '#90a8c8', '#d0def0'];
const CLOTH = ['#0a1230', '#18285a', '#2a468c', '#466abc'];
const GOLD = ['#4a300c', '#8a5c1c', '#c8983a', '#ffe08a'];
const ICEC = ['#1a3a78', '#4a86d0', '#8cc8f8', '#e8faff'];
const VISOR = '#8cf2ff';
const DEEP = '#070b18';

const W = 54;
const H = 62;
/** pivot = the knight's waist (entity position); feet are 18 px below */
const ORIGIN: [number, number] = [27, 42];
const FEET = 18;

type V = [number, number];
interface KnightPose {
  /** hands (sword grip) */
  hand: V;
  /** body lean / bob */
  body?: V;
  /** leg stance: stride amount -1..1 and lift */
  stride?: number;
  kneel?: boolean;
  cape: number;
  /** torso twist toward the back (sweep wind-up) */
  twist?: boolean;
}

// ------------------------------------------------------------------ painting
function paintCape(p: PixelPainter, bx: number, by: number, k: number): void {
  const s = [0, 1, 2, 1][k % 4];
  const pts = [bx - 2, by, bx + 8, by, bx + 7, by + 32, bx + 2, by + 36 - s, bx - 2, by + 33, bx - 6 - s, by + 38, bx - 9 - s, by + 32, bx - 12 - s, by + 36 + s, bx - 11, by + 14];
  p.poly(pts, CLOTH[1]);
  for (let y = by; y < by + 42; y++) {
    for (let x = bx - 16; x < bx + 10; x++) {
      if (!p.isSet(x, y)) continue;
      const fold = Math.sin((x - bx) * 0.9 + k * 0.8 + y * 0.1) * 0.5 + 0.5;
      const l = 0.5 + (fold - 0.5) * 0.7 - (y - by) / 80 + (x - bx) / 60;
      p.px(x, y, CLOTH[clamp(Math.floor(l * 4), 0, 3)]);
    }
  }
  // gold hem
  p.line(bx - 12 - s, by + 36 + s, bx - 9 - s, by + 32, GOLD[2]);
  p.line(bx - 2, by + 33, bx + 2, by + 36 - s, GOLD[2]);
}

function paintLeg(p: PixelPainter, hip: V, foot: V, front: boolean): void {
  const knee: V = [(hip[0] + foot[0]) / 2 + (front ? 1 : -1), (hip[1] + foot[1]) / 2 - 1];
  const ramp = front ? STEEL.slice(1) : STEEL.slice(0, 5);
  limb(p, hip[0], hip[1], 3.6, knee[0], knee[1], 3.1, [DEEP]);
  limb(p, knee[0], knee[1], 3.1, foot[0], foot[1] - 2, 3.0, [DEEP]);
  limb(p, hip[0], hip[1], 2.9, knee[0], knee[1], 2.4, ramp);
  limb(p, knee[0], knee[1], 2.4, foot[0], foot[1] - 2, 2.4, ramp);
  // knee cop
  ball(p, knee[0], knee[1], 2.4, 2.1, front ? STEEL.slice(2) : STEEL.slice(1, 5), false);
  p.px(knee[0] - 1, knee[1] - 1, front ? STEEL[5] : STEEL[4]);
  // sabaton
  p.poly([foot[0] - 3, foot[1], foot[0] - 3, foot[1] - 3, foot[0] + 2, foot[1] - 4, foot[0] + 6, foot[1]], front ? STEEL[3] : STEEL[2]);
  p.line(foot[0] - 3, foot[1] - 3, foot[0] + 2, foot[1] - 4, front ? STEEL[5] : STEEL[4]);
}

/** Breastplate from `top` to `bot` around cx (clean banded shading, no dither). */
function paintTorso(p: PixelPainter, cx: number, top: number, bot: number, p2: boolean, twist: boolean): void {
  for (let y = top; y <= bot; y++) {
    const t = (y - top) / (bot - top);
    const hw = t < 0.35 ? 8.5 + t * 2.5 : 9.4 - (t - 0.35) * 4;
    for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
      const dx = x + 0.5 - cx - (twist ? -1 : 0.5);
      if (Math.abs(dx) > hw) continue;
      const nx = dx / hw;
      const ny = t < 0.15 ? -0.8 + t * 3 : (t - 0.5) * 0.6;
      p.px(x, y, STEEL[1 + lum(nx, ny, 5, x, y, false, 0.08)]);
    }
  }
  const rx = cx + (twist ? -1.5 : 1.5);
  // central ridge and pectoral line
  p.line(rx, top + 2, rx, bot - 6, STEEL[5]);
  p.line(rx + 1, top + 3, rx + 1, bot - 6, STEEL[2]);
  // faulds: overlapping lames at the waist
  for (let k = 0; k < 2; k++) {
    const y = bot - 5 + k * 3;
    p.line(cx - 8 + k, y, cx + 8 - k, y, STEEL[0]);
    p.line(cx - 8 + k, y + 1, cx + 8 - k, y + 1, STEEL[4]);
  }
  // frozen sanctum emblem: a cyan star-cross
  // Heraldic enamel framed in old silver on the breastplate.
  p.poly([rx - 8, top + 3, rx, top + 3, rx - 1, top + 11, rx - 4, top + 14, rx - 7, top + 11], '#203d67');
  p.line(rx - 8, top + 3, rx - 7, top + 10, '#94aec2');
  p.line(rx - 7, top + 10, rx - 4, top + 13, '#94aec2');
  const ex = rx - 4;
  const ey = top + 7;
  p.line(ex, ey - 3, ex, ey + 3, ICEC[1]);
  p.line(ex - 3, ey, ex + 3, ey, ICEC[1]);
  p.line(ex, ey - 2, ex, ey + 2, ICEC[2]);
  p.px(ex, ey, '#ffffff');
  // rime on the steel
  for (const [dx, dy] of [[-7, 2], [-8, 6], [6, 1], [7, 9]] as const) p.pxIn(cx + dx, top + dy, ICEC[3]);
  if (p2) {
    crack(p, rx - 1, top + 2, rx + 5, bot - 6, VISOR, 4, 1.1);
    crack(p, cx - 7, top + 5, cx - 3, bot - 7, ICEC[2], 8, 1);
    p.px(rx + 2, top + 8, '#ffffff');
  }
}

function paintPauldron(p: PixelPainter, x: number, y: number, r: number, front: boolean, broken: boolean, crystals: boolean): void {
  if (broken) {
    // shattered: a frost core shows through
    ball(p, x, y + 1, r * 0.75, r * 0.65, ['#1a3a78', '#4a86d0', VISOR, '#ffffff'], false);
    p.poly([x - r, y + 3, x - r + 1, y - r + 3, x - 1, y - 2, x - 2, y + 3], STEEL[2]);
    p.px(x, y, '#ffffff');
    return;
  }
  // three overlapping lames, each a banded half-dome
  const ramp = front ? STEEL : STEEL.slice(0, 5);
  for (let k = 2; k >= 0; k--) {
    const ly = y + k * 2.6;
    const lr = r - k * 0.6;
    for (let yy = Math.floor(ly - lr * 0.75); yy <= ly + 1; yy++) {
      for (let xx = Math.floor(x - lr); xx <= x + lr; xx++) {
        const nx = (xx + 0.5 - x) / lr;
        const ny = (yy + 0.5 - ly) / (lr * 0.75);
        if (nx * nx + ny * ny > 1) continue;
        p.px(xx, yy, ramp[1 + lum(nx, ny, ramp.length - 1, xx, yy, false, 0.1 - k * 0.12)]);
      }
    }
    p.line(x - lr + 1, ly + 1, x + lr - 1, ly + 1, ramp[0]);
  }
  if (crystals) {
    // ice crystals grown on the shoulder
    const top = y - r * 0.7;
    p.poly([x - 2.5, top + 2, x - 1, top - 6, x + 1, top + 2], ICEC[2]);
    p.line(x - 1, top - 4, x - 1, top + 1, ICEC[3]);
    p.poly([x + 1, top + 2, x + 3, top - 3, x + 4.5, top + 2], ICEC[1]);
  }
}

function paintHelm(p: PixelPainter, cx: number, cy: number, p2: boolean): void {
  // short ice horns curling out of the temples
  limb(p, cx - 5, cy - 2, 1.8, cx - 9, cy - 8, 0.6, ICEC);
  limb(p, cx - 9, cy - 8, 0.8, cx - 8, cy - 12, 0.4, ICEC);
  limb(p, cx + 5, cy - 2, 1.8, cx + 9, cy - 8, 0.6, ICEC);
  limb(p, cx + 9, cy - 8, 0.8, cx + 8, cy - 12, 0.4, ICEC);
  // great helm: flat-sided bucket with a rounded crown
  const top = cy - 7;
  const bot = cy + 7;
  for (let y = top; y <= bot; y++) {
    const t = (y - top) / (bot - top);
    const hw = t < 0.2 ? 4 + t * 12 : 6.5;
    for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
      const dx = x + 0.5 - cx;
      if (Math.abs(dx) > hw) continue;
      p.px(x, y, STEEL[1 + lum(dx / hw, t < 0.2 ? -0.7 : (t - 0.5) * 0.5, 5, x, y, false, 0.1)]);
    }
  }
  // visor: a burning T slit (offset toward the facing side)
  const vx = cx + 1;
  p.line(vx - 5, cy - 1, vx + 4, cy - 1, DEEP);
  p.line(vx - 5, cy, vx + 4, cy, DEEP);
  p.rect(vx - 1, cy + 1, 2, 4, DEEP);
  p.line(vx - 4, cy - 1, vx + 3, cy - 1, p2 ? '#ffffff' : VISOR);
  p.line(vx - 1, cy + 1, vx - 1, cy + 3, VISOR);
  // breathing holes, brow band, rim
  p.px(vx + 3, cy + 3, DEEP);
  p.px(vx + 3, cy + 5, DEEP);
  p.line(cx - 6, cy - 3, cx + 6, cy - 3, STEEL[5]);
  p.line(cx - 6, bot, cx + 6, bot, STEEL[0]);
  // Etched frost along the temple and a bright cheek bevel.
  p.line(cx - 5, cy + 2, cx - 5, cy + 5, STEEL[5]);
  p.px(cx - 4, cy + 4, ICEC[3]);
  p.line(cx + 3, top + 1, cx + 4, top + 3, ICEC[2]);
  // ice crest
  for (const [dx, h] of [[-2, 2], [0, 4], [2, 2]] as const) p.line(cx + dx, top - 1, cx + dx, top - 1 - h, dx === 0 ? ICEC[3] : ICEC[2]);
  if (p2) crack(p, cx - 4, top + 1, cx - 2, bot - 1, VISOR, 6, 0.8);
}

function paintArm(p: PixelPainter, sh: V, hand: V, front: boolean): void {
  const el: V = [(sh[0] + hand[0]) / 2 + (front ? 2.5 : -2.5), (sh[1] + hand[1]) / 2 + 2];
  const ramp = front ? STEEL.slice(1) : STEEL.slice(0, 5);
  limb(p, sh[0], sh[1], 3.2, el[0], el[1], 2.9, [DEEP]);
  limb(p, el[0], el[1], 2.9, hand[0], hand[1], 3.0, [DEEP]);
  limb(p, sh[0], sh[1], 2.5, el[0], el[1], 2.2, ramp);
  limb(p, el[0], el[1], 2.2, hand[0], hand[1], 2.4, ramp);
  ball(p, el[0], el[1], 2, 1.8, ramp, false);
  // gauntlet
  ball(p, hand[0], hand[1], 2.8, 2.5, front ? STEEL.slice(1) : STEEL.slice(0, 5), false);
  p.px(hand[0] - 1, hand[1] - 1, front ? STEEL[5] : STEEL[4]);
}

function paintKnight(p: PixelPainter, o: KnightPose, p2: boolean): void {
  const [bx, by] = o.body ?? [0, 0];
  const cx = ORIGIN[0] + bx;
  const waist = ORIGIN[1] + by;
  const feetY = ORIGIN[1] + FEET;
  const chestTop = waist - 21;
  const s = o.stride ?? 0;
  // cape behind everything
  paintCape(p, cx - 6, chestTop + 1, o.cape);
  // legs
  if (o.kneel) {
    paintLeg(p, [cx - 4, waist + 1], [cx - 9, feetY], false);
    limb(p, cx + 4, waist + 1, 3.5, cx + 9, feetY - 4, 3.1, [DEEP]);
    limb(p, cx + 4, waist + 1, 2.8, cx + 9, feetY - 4, 2.4, STEEL.slice(1));
    ball(p, cx + 9, feetY - 4, 2.4, 2.1, STEEL.slice(2), false);
    p.poly([cx + 7, feetY, cx + 9, feetY - 3, cx + 15, feetY - 2, cx + 16, feetY], STEEL[2]);
  } else {
    paintLeg(p, [cx - 4, waist + 1], [cx - 7 - s * 4, feetY - Math.max(0, s) * 2], false);
    paintLeg(p, [cx + 4, waist + 1], [cx + 7 + s * 4, feetY - Math.max(0, -s) * 2], true);
  }
  // tabard with gold trim hanging between the legs
  p.poly([cx - 5, waist - 2, cx + 6, waist - 2, cx + 5, waist + 11, cx + 1, waist + 13, cx - 4, waist + 11], CLOTH[2]);
  for (let y = waist - 2; y <= waist + 13; y++) for (let x = cx - 5; x <= cx + 6; x++) if (p.isSet(x, y) && x < cx - 2) p.pxIn(x, y, CLOTH[3]);
  p.line(cx - 4, waist + 11, cx + 1, waist + 13, GOLD[2]);
  p.line(cx + 1, waist + 13, cx + 5, waist + 11, GOLD[1]);
  p.line(cx, waist + 1, cx, waist + 9, GOLD[2]);
  p.px(cx - 1, waist + 4, GOLD[2]);
  p.px(cx + 1, waist + 4, GOLD[2]);
  // back arm + back pauldron behind the torso
  const shB: V = [cx - 9, chestTop + 3];
  const shF: V = [cx + 9, chestTop + 3];
  paintArm(p, shB, [o.hand[0] - 4, o.hand[1] + 1], false);
  paintPauldron(p, shB[0] - 1, shB[1], 6, false, p2, false);
  paintTorso(p, cx, chestTop, waist, p2, !!o.twist);
  // belt
  p.rect(cx - 7, waist - 2, 15, 3, STEEL[1]);
  p.rect(cx - 7, waist - 2, 15, 1, GOLD[1]);
  p.rect(cx, waist - 2, 3, 3, GOLD[2]);
  p.px(cx + 1, waist - 1, GOLD[3]);
  // gorget + helm
  p.rect(cx - 4, chestTop - 2, 9, 3, STEEL[2]);
  p.line(cx - 4, chestTop - 2, cx + 4, chestTop - 2, STEEL[4]);
  paintHelm(p, cx + (o.twist ? -1 : 1), chestTop - 9, p2);
  // front arm + pauldron
  paintArm(p, shF, o.hand, true);
  paintPauldron(p, shF[0] + 1, shF[1], 7, true, false, true);
}

// ------------------------------------------------------------------ frames
const GRIP_IDLE: V = [37, 41];
const POSES: Record<string, KnightPose[]> = {
  idle: [0, 1, 2, 3].map((i) => ({ hand: [GRIP_IDLE[0], GRIP_IDLE[1] + [0, 0, 1, 1][i]] as V, body: [0, [0, 0, 1, 1][i]] as V, cape: i })),
  walk: [0, 1, 2, 3].map((i) => ({ hand: [GRIP_IDLE[0], GRIP_IDLE[1] + [0, 1, 0, 1][i]] as V, body: [0, [0, 1, 0, 1][i]] as V, stride: [1, 0, -1, 0][i], cape: i })),
  raise: [{ hand: [29, 16], body: [-1, 0], cape: 1 }],
  low: [{ hand: [42, 38], body: [2, 2], stride: 0.8, cape: 2 }],
  back: [{ hand: [15, 40], body: [-2, 1], stride: -0.6, cape: 3, twist: true }],
  kneel: [{ hand: [36, 42], body: [0, 6], kneel: true, cape: 2 }],
};
/** where the hands hold the sword, per pose (relative to the pivot) */
const GRIP: Record<string, V> = {
  idle: [GRIP_IDLE[0] - ORIGIN[0], GRIP_IDLE[1] - ORIGIN[1]],
  walk: [GRIP_IDLE[0] - ORIGIN[0], GRIP_IDLE[1] - ORIGIN[1]],
  raise: [29 - ORIGIN[0], 16 - ORIGIN[1]],
  low: [42 - ORIGIN[0], 38 - ORIGIN[1]],
  back: [15 - ORIGIN[0], 40 - ORIGIN[1]],
  kneel: [36 - ORIGIN[0], 42 - ORIGIN[1]],
};
const FPS: Record<string, number> = { idle: 4, walk: 6 };

for (const [state, poses] of Object.entries(POSES)) {
  for (const [pre, p2] of [['fcmd', false], ['fcmd2', true]] as const) {
    frames(pre, state, poses.length, W, H, (p, i) => paintKnight(p, poses[i], p2), { origin: ORIGIN, fps: FPS[state] ?? 6, outline: DEEP });
  }
}

/** The greatsword (blade up, pivot at the grip). */
function paintSword(p: PixelPainter, p2: boolean): void {
  const cx = 6;
  // blade of ice
  const tip = 1;
  const base = 36;
  p.poly([cx - 3.5, base, cx - 3.5, 9, cx, tip, cx + 3.5, 9, cx + 3.5, base], ICEC[1]);
  p.poly([cx - 2.5, base, cx - 2.5, 9, cx, tip + 1, cx, base], ICEC[2]);
  p.line(cx - 3, 10, cx - 3, base - 1, ICEC[3]);
  p.line(cx, tip + 2, cx, base - 2, '#ffffff');
  p.line(cx + 2, 10, cx + 2, base - 1, ICEC[0]);
  if (p2) {
    // jagged frost growth along the edges
    for (const y of [12, 19, 26]) {
      p.poly([cx - 3.5, y + 3, cx - 6.5, y - 1, cx - 3.5, y], ICEC[2]);
      p.poly([cx + 3.5, y + 5, cx + 6.5, y + 1, cx + 3.5, y + 2], ICEC[1]);
    }
    p.px(cx - 1, 15, VISOR);
    p.px(cx - 1, 24, VISOR);
  }
  // crossguard, grip, pommel
  p.rect(cx - 6, base, 13, 3, GOLD[1]);
  p.rect(cx - 6, base, 13, 1, GOLD[3]);
  p.px(cx - 6, base + 2, GOLD[0]);
  p.px(cx + 6, base + 2, GOLD[0]);
  p.rect(cx - 1, base + 3, 3, 8, CLOTH[1]);
  for (let y = base + 3; y < base + 11; y += 2) p.px(cx - 1, y, CLOTH[3]);
  ball(p, cx, base + 13, 2.2, 2.2, GOLD, false);
  p.px(cx, base + 13, ICEC[3]);
}
const SWORD_PIVOT: V = [6, 43];
defineDrawnSprite('fcmd_sword', 13, 52, (p) => paintSword(p, false), { outline: DEEP, origin: SWORD_PIVOT });
defineDrawnSprite('fcmd_sword2', 13, 52, (p) => paintSword(p, true), { outline: DEEP, origin: SWORD_PIVOT });

/** Paint the sword rotated by `ang` (0 = blade up, clockwise) with its grip at (gx, gy). */
function stampSword(p: PixelPainter, gx: number, gy: number, ang: number): void {
  const src = new PixelPainter(13, 52);
  paintSword(src, false);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  for (let y = -50; y <= 50; y++) {
    for (let x = -50; x <= 50; x++) {
      // inverse rotate into sword space
      const lx = Math.round(x * c + y * s + SWORD_PIVOT[0]);
      const ly = Math.round(-x * s + y * c + SWORD_PIVOT[1]);
      if (lx < 0 || ly < 0 || lx >= 13 || ly >= 52) continue;
      const v = src.data[ly * 13 + lx];
      if (v >>> 24) {
        const tx = gx + x;
        const ty = gy + y;
        if (p.inBounds(tx, ty)) p.data[ty * p.w + tx] = v;
      }
    }
  }
}

// portrait: sword raised high
defineDrawnSprite('fcmd_portrait', 70, 84, (p) => {
  const ox = 8;
  const oy = 20;
  const body = new PixelPainter(W, H);
  paintKnight(body, { hand: [33, 30], body: [0, 0], cape: 1, stride: 0.5 }, false);
  p.blit(body, ox, oy);
  stampSword(p, ox + 33, oy + 30, 0.35);
  // re-paint the front gauntlet over the hilt
  ball(p, ox + 33, oy + 30, 2.6, 2.4, STEEL.slice(1), false);
}, { outline: DEEP });

// ------------------------------------------------------------------ behaviour
const NAME = '서리 기사단장';
const ICE_FX = ['#ffffff', '#c4f0ff', '#6aa8e8'];
const METAL_FX = ['#ffffff', '#90a8c8', '#3a4c6e'];

function anim(e: Enemy, state: string, restart = false): void {
  e.mem.pose = state;
  e.setAnim(`${e.mem.p2 ? 'fcmd2' : 'fcmd'}_${state}`, restart);
}

/** Aim the sword (facing-relative: 0 = up, + = toward the facing side). */
function swordTo(e: Enemy, a: number, snap = false): void {
  e.mem.swordT = a;
  if (snap) e.mem.swordA = a;
}

function face(e: Enemy, x: number): void {
  e.facing = x >= e.x ? 1 : -1;
}

/** World position of the sword tip for the current pose. */
function swordTip(e: Enemy): { x: number; y: number } {
  const g = GRIP[e.mem.pose as string] ?? GRIP.idle;
  const a = (e.mem.swordA ?? 2.3) * e.facing;
  const gx = e.x + g[0] * e.facing;
  const gy = e.y + g[1] - e.z;
  return { x: gx + Math.sin(a) * 40, y: gy - Math.cos(a) * 40 };
}

function stepFx(e: Enemy, w: World): void {
  w.sfx('enemy_land', { vol: 0.25, pitch: 0.6 });
  w.shake(0.08);
  w.particles.burst(e.x, e.y + FEET, { count: 4, speed: [10, 40], life: [0.2, 0.4], colors: ['#e8faff', '#8cc8f8'], size: [1, 2], gravity: 200, vz: [10, 40] });
}

function* approach(e: Enemy, w: World, time: number, near = 0): Script {
  anim(e, 'walk');
  swordTo(e, 2.3);
  let lastStep = 0;
  for (let el = 0; el < time; el += w.dt) {
    const t = e.target(w);
    if (near > 0 && Math.hypot(t.x - e.x, t.y - e.y) < near) break;
    e.chase(w, e.speed * (e.mem.p2 ? 1.3 : 1));
    face(e, t.x);
    const st = Math.floor(e.animT * 6 / 2);
    if (st !== lastStep) {
      lastStep = st;
      stepFx(e, w);
    }
    yield;
  }
  e.stop();
  anim(e, 'idle');
}

function* charge(e: Enemy, w: World, n: number): Script {
  const p2 = !!e.mem.p2;
  for (let k = 0; k < n; k++) {
    e.halt();
    const t = e.target(w);
    face(e, t.x);
    anim(e, 'low', true);
    swordTo(e, Math.PI / 2);
    const a = Math.atan2(t.y - e.y, t.x - e.x);
    const wind = k === 0 ? 0.75 : 0.5;
    e.telegraph(wind);
    laneWarning(w, e.x, e.y, a, Math.max(30, beamToWall(w, e.x, e.y, a)), 30, wind);
    w.sfx('enemy_charge', { vol: 0.6, pitch: 0.6 });
    for (let el = 0; el < wind; el += w.dt) {
      // scrape sparks off the floor
      if (fx.chance(0.5)) {
        const tip = swordTip(e);
        w.particles.spawn({ x: tip.x, y: tip.y, vx: fx.range(-40, 40), vy: -fx.range(10, 50), life: 0.25, colors: ['#ffffff', VISOR], size: 1, additive: true });
      }
      yield;
    }
    w.sfx('whoosh', { vol: 0.7, pitch: 0.5 });
    let trail = 0;
    e.mem.charging = 1;
    const sx = e.x;
    const sy = e.y;
    yield* chargeRun(e, w, a, p2 ? 250 : 225, (dt) => {
      trail -= dt;
      if (p2 && trail <= 0 && Math.hypot(e.x - sx, e.y - sy) > 30) {
        trail = 0.11;
        w.spawn(new Spike(e.x, e.y + 8, 'ice', 0.55, { radius: 8, source: NAME, linger: 0.5 }));
      }
      w.particles.spawn({ x: e.x + fx.range(-6, 6), y: e.y + FEET, vx: -Math.cos(a) * 40, vy: -Math.sin(a) * 40, life: 0.35, colors: ICE_FX, size: fx.range(1, 2) });
    });
    e.mem.charging = 0;
    if (e.mem.__bumped) {
      // slammed into the wall: the whole sanctum shudders
      w.sfx('slam', { vol: 1, pitch: 0.6 });
      w.sfx('hit_metal', { vol: 0.7, pitch: 0.5 });
      w.shake(0.7);
      e.squash(0.75, 1.25);
      w.particles.burst(e.x + Math.cos(a) * 14, e.y + Math.sin(a) * 10, { count: 18, speed: [40, 140], life: [0.3, 0.6], colors: ICE_FX, size: [1, 2], gravity: 260, vz: [30, 120], shape: 'square' });
      const drops = p2 ? 5 : 3;
      for (let i = 0; i < drops; i++) {
        const s = i === 0 ? landingSpot(w, w.player.x, w.player.y, 8) : spotAround(w, w.player.x, w.player.y, 20, 80, 8) ?? landingSpot(w, w.player.x + 30, w.player.y, 8);
        w.spawn(new Faller(s.x, s.y, { sprite: icicleSprite(), time: 0.9 + i * 0.14, radius: 10, source: NAME, color: '#8cc8f8' }));
      }
      if (k === n - 1) {
        anim(e, 'kneel', true);
        swordTo(e, Math.PI * 0.9);
        for (let el = 0; el < (p2 ? 0.8 : 1.1); el += w.dt) {
          dizzy(w, e);
          yield;
        }
      } else yield 0.25;
    } else yield 0.25;
  }
  anim(e, 'idle');
  swordTo(e, 2.3);
  yield 0.3;
}

/** Straight-line charge (like Enemy.charge) with a per-frame callback. */
function* chargeRun(e: Enemy, w: World, angle: number, speed: number, each: (dt: number) => void): Script {
  e.accel = 4000;
  e.mem.__bumped = 0;
  for (let el = 0; el < 1.8; el += w.dt) {
    e.moveAngle(angle, speed);
    each(w.dt);
    yield;
    if (e.mem.__bumped) break;
  }
  e.accel = 900;
  e.halt();
}

function* leapSlam(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  face(e, w.player.x);
  anim(e, 'kneel', true);
  swordTo(e, -0.6);
  e.telegraph(0.45);
  w.sfx('enemy_charge', { vol: 0.5, pitch: 0.5 });
  yield 0.45;
  anim(e, 'raise', true);
  const aim = bossIntercept(e.target(w));
  const land = landingSpot(w, aim.x, aim.y - FEET * 0.5, e.r);
  const time = p2 ? 0.7 : 0.8;
  w.spawn(new GroundWarning(land.x, land.y + FEET * 0.6, 30, time));
  face(e, land.x);
  yield* e.jumpTo(w, land.x, land.y, time, 74);
  // SLAM
  anim(e, 'low', true);
  swordTo(e, 2.2, true);
  w.sfx('slam', { vol: 1, pitch: 0.55 });
  w.sfx('freeze', { vol: 0.7, pitch: 0.7 });
  w.shake(0.85);
  w.hitstop(0.05);
  const gy = e.y + FEET * 0.6;
  hitPlayerCircle(w, e.x, gy, 30, 2, NAME, 220);
  w.particles.burst(e.x, gy, { count: 26, speed: [40, 160], life: [0.3, 0.7], colors: ICE_FX, size: [1, 3], gravity: 300, vz: [40, 140], shape: 'square', vrot: 8 });
  w.decal(e.x, gy, '#c4e8ff', 12, 0.35);
  const g = w.rng.angle();
  w.spawn(new ShockRing(e.x, gy, { speed: 130, maxR: 150, color: '#8cf2ff', gaps: p2 ? [g, g + 2.2, g + 4.2] : [g, g + Math.PI], gapWidth: 0.85, source: NAME, debris: ICE_FX }));
  const dirs = p2 ? 6 : 4;
  const off = w.rng.range(0, TAU);
  for (let i = 0; i < dirs; i++) {
    const a = off + (i / dirs) * TAU;
    spikeLine(w, e.x + Math.cos(a) * 20, gy + Math.sin(a) * 16, a, 7, 15, 0.35, 0.07, 'ice', { radius: 8, source: NAME, linger: 0.35 });
  }
  yield recover(e, p2 ? 0.7 : 0.95);
  anim(e, 'idle');
  swordTo(e, 2.3);
}

function* sweep(e: Enemy, w: World, n: number): Script {
  const p2 = !!e.mem.p2;
  yield* approach(e, w, 1.4, 54);
  let dir = 1;
  for (let k = 0; k < n; k++) {
    e.halt();
    const t = e.target(w);
    face(e, t.x);
    const a = Math.atan2(t.y - e.y, t.x - e.x);
    anim(e, 'back', true);
    swordTo(e, -2.1);
    const warn = k === 0 ? (p2 ? 0.5 : 0.62) : 0.42;
    e.telegraph(warn);
    w.sfx('swing_heavy', { vol: 0.4, pitch: 0.5 });
    w.spawn(new Sector(e.x, e.y + 4, a, {
      radius: 64, half: 1.15, warn, damage: 1, source: NAME, slash: '#8cf2ff', dir: (Math.cos(a) >= 0 ? 1 : -1) * dir,
      onStrike: (ww) => {
        ww.sfx('swing_heavy', { vol: 1, pitch: 0.7 });
        ww.sfx('freeze', { vol: 0.5, pitch: 1.3 });
        ww.shake(0.35);
        const nShards = p2 ? 7 : 5;
        for (let i = 0; i < nShards; i++) {
          const sa = a + (i - (nShards - 1) / 2) * 0.24;
          const pr = e.shoot(ww, sa, shard('frost', 3, { speed: 125, z: 8 }));
          pr.x = e.x + Math.cos(sa) * 30;
          pr.y = e.y + 4 + Math.sin(sa) * 30;
        }
      },
    }));
    yield warn;
    // the blade sweeps across the arc
    anim(e, 'low', true);
    e.mem.swing = { from: -2.1, to: 2.5, t: 0, dur: 0.12 };
    e.moveAngle(a, 140);
    yield 0.1;
    e.halt();
    yield p2 ? 0.3 : 0.45;
    dir = -dir;
  }
  anim(e, 'idle');
  swordTo(e, 2.3);
  yield 0.35;
}

function* glacierWall(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  face(e, w.player.x);
  anim(e, 'raise', true);
  swordTo(e, 0);
  e.telegraph(0.6);
  gather(w, e.x + 2 * e.facing, e.y - 50, ICE_FX, 12, 20);
  w.sfx('beam_charge', { vol: 0.45, pitch: 0.7 });
  yield 0.6;
  anim(e, 'low', true);
  swordTo(e, Math.PI, true);
  w.sfx('slam', { vol: 0.9, pitch: 0.7 });
  w.shake(0.5);
  const gy = e.y + FEET * 0.6;
  const base = Math.atan2(w.player.y - gy, w.player.x - e.x);
  const lines = p2 ? 5 : 3;
  for (let i = 0; i < lines; i++) {
    const a = base + (i - (lines - 1) / 2) * (p2 ? 0.4 : 0.5);
    spikeLine(w, e.x + Math.cos(a) * 18, gy + Math.sin(a) * 14, a, 14, 15, 0.45, 0.065, 'ice', { radius: 8, source: NAME, linger: 0.55 });
  }
  if (p2) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      w.spawn(new Spike(e.x + Math.cos(a) * 34, gy + Math.sin(a) * 26, 'ice', 1.3, { radius: 8, source: NAME, linger: 0.4 }));
    }
  }
  yield recover(e, p2 ? 1.6 : 1.3);
  anim(e, 'idle');
  swordTo(e, 2.3);
}

function* rally(e: Enemy, w: World): Script {
  e.halt();
  anim(e, 'raise', true);
  swordTo(e, 0);
  e.telegraph(0.6);
  w.sfx('enemy_roar', { vol: 0.8, pitch: 0.7 });
  yield 0.4;
  e.mem.rallied = e.phase + 1;
  for (const side of [-1, 1]) {
    const s = spotAround(w, e.x + side * 60, e.y, 0, 40, 9) ?? landingSpot(w, e.x + side * 50, e.y, 9);
    w.spawn(new GroundWarning(s.x, s.y, 12, 0.7, (ww) => {
      summonMinion(e, ww, 'frost_knight', s.x, s.y, ICE_FX);
      ww.sfx('freeze', { vol: 0.6, pitch: 0.8 });
    }, '#8cf2ff'));
  }
  yield recover(e, 1.0);
  anim(e, 'idle');
  swordTo(e, 2.3);
}

function* icicleStorm(e: Enemy, w: World): Script {
  e.halt();
  anim(e, 'raise', true);
  swordTo(e, 0);
  e.telegraph(0.6);
  w.sfx('beam_charge', { vol: 0.6, pitch: 0.5 });
  gather(w, e.x, e.y - 55, ICE_FX, 16, 26);
  yield 0.6;
  w.sfx('freeze', { vol: 0.8, pitch: 0.5 });
  w.shake(0.3);
  const room = w.room;
  for (let i = 0; i < 13; i++) {
    let s: { x: number; y: number };
    if (i % 4 === 0) {
      // aimed at where the keeper stands / is heading
      const p = w.player;
      s = landingSpot(w, p.x + p.vx * 0.5, p.y + p.vy * 0.5, 8);
    } else {
      s = landingSpot(w, room.interiorX + w.rng.range(16, room.interiorW - 16), room.interiorY + w.rng.range(16, room.interiorH - 16), 8);
    }
    w.spawn(new Faller(s.x, s.y, { sprite: icicleSprite(), time: 0.95, radius: 10, source: NAME, color: '#8cc8f8' }));
    yield 0.16;
  }
  yield recover(e, 0.8);
  anim(e, 'idle');
  swordTo(e, 2.3);
}

function* phaseTwo(e: Enemy, w: World): Script {
  // undo anything an interrupted pattern left behind
  e.z = 0;
  e.flying = false;
  e.harmful = true;
  e.accel = 900;
  e.mem.charging = 0;
  anim(e, 'kneel', true);
  swordTo(e, Math.PI * 0.9);
  yield* phaseShift(e, w, {
    anim: 'fcmd_kneel',
    color: '#8cf2ff',
    time: 1.6,
    onPeak: () => {
      e.mem.p2 = true;
      anim(e, 'raise', true);
      swordTo(e, 0, true);
      w.sfx('hit_metal', { vol: 1, pitch: 0.4 });
      w.sfx('rock_break', { vol: 0.8, pitch: 0.9 });
      w.particles.burst(e.x, e.y - 14, { count: 26, speed: [50, 170], life: [0.4, 0.9], colors: METAL_FX, size: [1, 3], gravity: 300, vz: [40, 160], shape: 'square', vrot: 10 });
      const g = w.rng.angle();
      w.spawn(new ShockRing(e.x, e.y + FEET * 0.6, { speed: 120, maxR: 160, color: '#8cf2ff', gaps: [g, g + Math.PI], gapWidth: 0.9, source: NAME, debris: ICE_FX }));
    },
  });
  if (minionCount(w, e) === 0) yield* rally(e, w);
}

/** Floor 4: the pause after an attack, a little shorter than the shallower floors' (shorter still in phase 2). */
function recover(e: Enemy, t: number): number {
  return t * (e.mem.p2 ? 0.6 : 0.72);
}

function* patterns(e: Enemy, w: World): Script {
  while (true) {
    const p2 = !!e.mem.p2;
    const d = e.distToTarget(w);
    const id = pickBossPattern(e, w, [
      { id: 'charge', w: 2.6 },
      { id: 'leap', w: d > 70 ? 3 : 1.8 },
      { id: 'sweep', w: d < 90 ? 3.2 : 2 },
      { id: 'wall', w: 2.2 },
      { id: 'rally', w: 1.6, when: (e.mem.rallied ?? 0) <= e.phase && minionCount(w, e) === 0 && e.hp < e.maxHp * 0.85 },
      { id: 'storm', w: 2.2, when: p2 },
    ], e.mem.last as string | null);
    e.mem.last = id;
    if (id === 'charge') yield* charge(e, w, p2 ? 2 : 1);
    else if (id === 'leap') yield* leapSlam(e, w);
    else if (id === 'sweep') yield* sweep(e, w, p2 ? 3 : w.rng.chance(0.5) ? 2 : 1);
    else if (id === 'wall') yield* glacierWall(e, w);
    else if (id === 'rally') yield* rally(e, w);
    else yield* icicleStorm(e, w);
    yield* approach(e, w, p2 ? w.rng.range(0.22, 0.38) : w.rng.range(0.32, 0.5));
  }
}

defineBoss({
  id: 'frost_commander',
  name: NAME,
  bossTitle: '맹세에 얼어붙은 검',
  bossFloors: [4],
  hp: 1240,
  radius: 15,
  speed: 36,
  mass: 8,
  sprite: 'fcmd_idle',
  portrait: 'fcmd_portrait',
  shadow: 0,
  deathFx: 'ice',
  bloodColor: '#a8e2ff',
  contactDamage: 1,
  hurtSfx: 'hit_metal',
  light: { radius: 54, color: '#8cd8ff' },
  init(e) {
    e.mem.swordA = 2.3;
    e.mem.swordT = 2.3;
    e.mem.pose = 'idle';
    e.mem.last = null;
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
    // sword: scripted swings override the eased pose angle
    const sw = e.mem.swing as { from: number; to: number; t: number; dur: number } | null;
    if (sw) {
      sw.t += dt;
      const k = clamp(sw.t / sw.dur, 0, 1);
      e.mem.swordA = sw.from + (sw.to - sw.from) * (1 - (1 - k) * (1 - k));
      if (k >= 1) {
        e.mem.swing = null;
        e.mem.swordT = sw.to;
      }
    } else {
      const d = angleDiff(e.mem.swordA, e.mem.swordT);
      e.mem.swordA += d * (1 - Math.exp(-dt * 16));
    }
    if (e.mem.p2 && fx.chance(0.35)) {
      // cold fire leaking from the visor and cracks
      w.particles.spawn({
        x: e.x + fx.range(-3, 3) + e.facing, y: e.y - 27 - e.z + fx.range(-2, 2), vy: -fx.range(10, 26), vx: fx.range(-5, 5), life: fx.range(0.3, 0.6),
        colors: ['#ffffff', VISOR, '#2a6ad0'], size: 1, additive: true, light: 3,
      });
    }
  },
  draw(e, r: Renderer, w) {
    if (e.hidden) return;
    const k = Math.min(0.6, e.z / 100);
    r.shadow(e.x, e.y + FEET, 34 * (1 - k), 9 * (1 - k), 0.38);
    const pose = (e.mem.pose as string) ?? 'idle';
    const g = GRIP[pose] ?? GRIP.idle;
    const f = e.facing;
    const gx = e.x + g[0] * f;
    const gy = e.y + g[1] - e.z;
    const a = (e.mem.swordA ?? 2.3) * f;
    const sprite = e.mem.p2 ? 'fcmd_sword2' : 'fcmd_sword';
    const behind = pose === 'raise' || pose === 'back';
    const tel = e.telegraphT > 0 && Math.floor(e.telegraphT * 16) % 2 === 0;
    const swordOpts = { rot: a, flipX: f < 0, flash: e.flash > 0 ? 1 : tel ? 0.55 : 0 };
    if (behind) r.sprite(sprite, gx, gy, swordOpts);
    e.drawDefault(r);
    if (!behind) r.sprite(sprite, gx, gy, swordOpts);
    // swing trail
    if (e.mem.swing) {
      const tip = swordTip(e);
      w.particles.spawn({ x: tip.x, y: tip.y, life: 0.18, colors: ['#ffffff', VISOR], size: 3, sizeEnd: 0.5, additive: true });
    }
  },
  onDeath(e, w) {
    dissolveMinions(w, e);
    w.sfx('hit_metal', { vol: 1, pitch: 0.35 });
    w.sfx('rock_break', { vol: 1, pitch: 0.8 });
    bossDeathBurst(w, e.x, e.y, ['#ffffff', '#d0def0', '#90a8c8', '#5c7398', '#8cc8f8']);
    // the greatsword shatters
    const tip = swordTip(e);
    w.particles.burst((e.x + tip.x) / 2, (e.y + tip.y) / 2, { count: 34, speed: [60, 200], life: [0.5, 1.2], colors: ICE_FX, size: [1, 3], gravity: 300, vz: [60, 180], shape: 'square', vrot: 12, bounce: 0.4 });
    w.particles.burst(e.x, e.y - 20, { count: 24, speed: [20, 90], life: [0.6, 1.4], colors: ['#ffffff', VISOR], size: [1, 2], additive: true, light: 5, gravity: -30 });
    for (let i = 0; i < 4; i++) w.spawn(new RingFx(e.x, e.y + 6, 40 + i * 30, 0.6 + i * 0.2, i % 2 ? VISOR : '#ffffff', 2));
    w.decal(e.x, e.y + FEET, '#a8d8ff', 14, 0.4);
  },
});
