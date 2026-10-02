// Floor 2 boss: 포자 어미 (the spore mother) — 썩은 빛의 어머니.
// A rooted giant mushroom with a gaping mouth in its fleshy stalk, a violet cap
// studded with glowing pustules and a brood of spore shrooms at its feet.
// Phase 1: spore bursts (rings with gaps), spore-sack lobs that leave poison
// puddles, root lances erupting across the floor, burrowing relocation, brood.
// Phase 2 (≤50%): the cap tears open over glowing gills — spore spirals, five
// root lances, more sacks, and it resurfaces with a burst every time.

import { defineBoss } from '../../game/defs';
import { PixelPainter, bayer } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { clamp } from '../../engine/math';
import { GroundWarning, RingFx } from '../../game/effects';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { Script } from '../../engine/script';
import { BUL, bullet, dust, frames, gather, Hazard, landingSpot, lob, spotAround, volleyTargets } from '../enemies/shared';
import {
  ball, bossDeathBurst, crack, dissolveMinions, eruptLine, inRoom, limb, minionCount, OUTLINE, phaseShift, pickPattern,
  shootGapRing, summonMinion, tintIn,
  clearArena,
} from './kit13';

// ------------------------------------------------------------------ palette
const CAP = ['#1a0a2c', '#32124a', '#521e6a', '#74308c', '#9a4cae', '#c07ccc'];
const GILL = ['#1a0a24', '#3a1a44', '#5a2a5a'];
const STALK = ['#36282e', '#5e4a50', '#8a7472', '#b29e90', '#d4c4b0'];
const SPORE = '#d6ff5a';
const SPORE_HOT = '#f6ffd0';
const SOIL = ['#140e14', '#241a22', '#3a2a30'];
const ROOT = ['#2a1c1c', '#4a3428', '#6a4c34', '#8a6a44'];
const MYCEL = '#c8c0a8';

const W = 70;
const H = 64;
const CX = 35;
const GROUND = 58;
const ORIGIN: [number, number] = [35, 46];

interface MomPose {
  capRx?: number;
  capRy?: number;
  capDy?: number;
  lean?: number;
  /** mouth opening px */
  mouth?: number;
  eyes?: 'open' | 'squint' | 'glow';
  /** pustule glow 0..2 */
  glow?: number;
  /** roots lifted out of the soil */
  roots?: boolean;
  /** px sunk into the ground (burrow) */
  sink?: number;
  /** spore puff drawn around the cap rim */
  puff?: boolean;
}

// fixed pustule layout on the cap (relative to cap centre, in cap radii)
const PUSTULES: [number, number, number][] = [
  [-0.62, -0.1, 2.2], [-0.3, -0.55, 2.6], [0.12, -0.7, 1.8], [0.45, -0.38, 2.4], [0.72, 0.05, 1.7],
  [-0.05, -0.2, 1.5], [-0.82, 0.32, 1.4], [0.3, 0.12, 1.3], [0.55, -0.72, 1.2], [-0.45, 0.2, 1.1],
];

function paintGroundMat(p: PixelPainter, roots: boolean): void {
  ball(p, CX, GROUND, 27, 5.5, SOIL, true);
  const lift = roots ? -2 : 0;
  const R: [number, number, number, number][] = [[24, 55, 6, 60], [27, 57, 13, 63], [44, 57, 58, 63], [46, 55, 65, 59], [30, 58, 22, 63], [41, 58, 49, 63]];
  for (const [x0, y0, x1, y1] of R) limb(p, x0, y0 + lift, 2.2, x1, y1 + lift * 0.5, 0.8, ROOT);
  // pale mycelium threads
  for (let i = 0; i < 7; i++) {
    const a = -0.3 + i * 0.55;
    p.line(CX + Math.cos(a) * 12, GROUND + 1, CX + Math.cos(a) * 25, GROUND + 2 + (i % 2), MYCEL);
  }
}

function paintBaby(p: PixelPainter, x: number, y: number, s: number, glow: number): void {
  p.rect(x - 1, y - 3 * s, 3, 3 * s, STALK[3]);
  ball(p, x + 0.5, y - 3 * s - 1, 4 * s, 2.6 * s, CAP.slice(1), false);
  p.px(x - 1, y - 3 * s - 2, glow > 0 ? SPORE_HOT : SPORE);
  p.px(x + 2, y - 3 * s - 1, SPORE);
}

function paintStalk(p: PixelPainter, o: MomPose): void {
  const lean = o.lean ?? 0;
  const top = 31 + (o.capDy ?? 0) * 0.5;
  // trunk (wider at the base)
  p.poly([CX - 13, GROUND, CX - 10 + lean * 0.5, top + 8, CX - 8 + lean, top, CX + 8 + lean, top, CX + 10 + lean * 0.5, top + 8, CX + 13, GROUND], STALK[2]);
  for (let y = Math.floor(top); y <= GROUND; y++) {
    for (let x = CX - 14; x <= CX + 14; x++) {
      if (!p.isSet(x, y) || y < top) continue;
      const n = (x - CX - lean * (1 - (y - top) / (GROUND - top))) / 12;
      const lum = 0.62 - n * 0.42 - Math.abs(n) ** 4 * 0.3 + (y - top) / 160;
      p.px(x, y, STALK[clamp(Math.floor(lum * 5 + bayer(x, y) - 0.5), 0, 4)]);
    }
  }
  // fibrous streaks
  for (const dx of [-7, -3, 4, 8]) p.line(CX + dx + lean * 0.6, top + 4, CX + dx * 1.2, GROUND - 3, STALK[1]);
  // eyes: sunken pits with glowing pupils
  const ey = top + 7;
  const ex = CX + lean * 0.8;
  for (const s of [-1, 1]) {
    p.ellipse(ex + s * 5, ey, 2.6, 2, STALK[0]);
    if (o.eyes === 'squint') p.line(ex + s * 5 - 2, ey, ex + s * 5 + 2, ey, '#1a0a14');
    else {
      p.ellipse(ex + s * 5, ey, 1.6, 1.2, '#1a0a14');
      p.px(ex + s * 5, ey, o.eyes === 'glow' ? SPORE_HOT : SPORE);
      if (o.eyes === 'glow') p.px(ex + s * 5 - 1, ey, SPORE);
    }
  }
  // mouth: a ragged gash that splits open
  const m = o.mouth ?? 0;
  const my = top + 15;
  if (m <= 0) {
    p.line(ex - 7, my, ex + 7, my, '#2a1018');
    p.px(ex - 8, my - 1, '#2a1018');
    p.px(ex + 8, my - 1, '#2a1018');
  } else {
    p.ellipse(ex, my, 8, m * 0.6 + 0.5, '#1a0610');
    p.ellipse(ex, my + m * 0.15, 6, m * 0.4, '#5a1a3a');
    if (m >= 3) p.ellipse(ex, my + m * 0.2, 3, m * 0.22, SPORE);
    for (let i = -3; i <= 3; i++) {
      p.px(ex + i * 2, my - Math.round(m * 0.55), STALK[4]);
      p.px(ex + i * 2 + 1, my + Math.round(m * 0.55), STALK[4]);
    }
  }
}

function paintCap(p: PixelPainter, o: MomPose, p2: boolean): void {
  const lean = o.lean ?? 0;
  const rx = o.capRx ?? 31;
  const ry = o.capRy ?? 15;
  const cx = CX + lean;
  const cy = 18 + (o.capDy ?? 0);
  // gill skirt underneath
  p.ellipse(cx, cy + ry * 0.55, rx * 0.95, 5, GILL[1]);
  for (let i = -6; i <= 6; i++) p.line(cx + i * rx * 0.11, cy + ry * 0.55 - 3, cx + i * rx * 0.15, cy + ry * 0.55 + 3, GILL[2]);
  p.ellipse(cx, cy + ry * 0.55 + 2, rx * 0.45, 2.2, GILL[0]);
  // dome
  p.ellipse(cx, cy, rx, ry, CAP[2]);
  for (let y = Math.floor(cy - ry - 1); y <= cy + ry * 0.6; y++) {
    for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      // flatten the underside
      if (y > cy + ry * 0.45) p.pxIn(x, y, CAP[1]);
    }
  }
  p.shadeSphere(cx, cy, rx, ry, CAP, { dither: true });
  // rim lip
  for (let x = Math.floor(cx - rx + 2); x <= cx + rx - 2; x++) {
    const t = (x - cx) / rx;
    const y = cy + ry * 0.45 + Math.sqrt(Math.max(0, 1 - t * t)) * 1.5;
    p.px(x, y, CAP[0]);
  }
  // pustules
  const g = o.glow ?? 0;
  PUSTULES.forEach(([px, py, r], i) => {
    const x = cx + px * rx;
    const y = cy + py * ry;
    if (p2 && i % 3 === 0) {
      // burst crater
      p.circle(x, y, r + 0.5, CAP[0]);
      p.ring(x, y, r + 0.5, 1, SPORE);
      return;
    }
    p.circle(x, y, r + 0.6, CAP[1]);
    p.circle(x, y, r, (i + g) % 3 === 0 ? SPORE_HOT : SPORE);
    p.px(x - r * 0.4, y - r * 0.4, '#ffffff');
    if (r > 2) p.px(x + 1, y + 1, '#8ac040');
  });
  if (p2) {
    // a great rip across the cap: glowing gills breathe inside
    const pts: [number, number][] = [[cx - rx * 0.78, cy + 1], [cx - rx * 0.45, cy - 4], [cx - rx * 0.12, cy - 1], [cx + rx * 0.2, cy - 6], [cx + rx * 0.52, cy - 2], [cx + rx * 0.8, cy - 5]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      for (let k = -2; k <= 2; k++) p.line(ax, ay + k, bx, by + k, k === -2 || k === 2 ? CAP[0] : k === 0 ? SPORE_HOT : SPORE);
    }
    crack(p, cx - rx * 0.3, cy - 3, cx - rx * 0.2, cy - ry + 2, CAP[0], 5, 1);
    crack(p, cx + rx * 0.35, cy - 3, cx + rx * 0.55, cy - ry + 4, CAP[0], 9, 1);
    tintIn(p, cx, cy - 3, 3, SPORE_HOT);
  }
  if (o.puff) {
    for (let i = 0; i < 12; i++) {
      const a = Math.PI + (i / 11) * Math.PI;
      const x = cx + Math.cos(a) * (rx + 2);
      const y = cy + Math.sin(a) * (ry + 2);
      p.circle(x, y, 1.5 + (i % 3) * 0.5, i % 2 ? SPORE : '#a8d040');
    }
  }
}

function paintMother(p: PixelPainter, o: MomPose, p2: boolean): void {
  const sink = o.sink ?? 0;
  const draw = (q: PixelPainter) => {
    paintStalk(q, o);
    paintCap(q, o, p2);
  };
  paintGroundMat(p, !!o.roots);
  if (sink <= 0) {
    draw(p);
    paintBaby(p, 12, 58, 1, o.glow ?? 0);
    paintBaby(p, 58, 59, 0.8, (o.glow ?? 0) + 1);
    paintBaby(p, 20, 62, 0.7, 0);
    return;
  }
  // sinking: shift the body down and clip it at the ground
  const tmp = new PixelPainter(W, H);
  draw(tmp);
  for (let y = 0; y < H; y++) {
    const ty = y + sink;
    if (ty >= GROUND || ty >= H) continue;
    for (let x = 0; x < W; x++) {
      const v = tmp.data[y * W + x];
      if (v >>> 24) p.data[ty * W + x] = v;
    }
  }
  // churned soil lip
  ball(p, CX, GROUND - 1, 18, 3, SOIL, false);
  for (let i = 0; i < 8; i++) p.px(CX - 16 + i * 4.3, GROUND - 3 + (i % 2), ROOT[3]);
}

// ------------------------------------------------------------------ frames
const POSES: Record<string, MomPose[]> = {
  idle: [
    { glow: 0 },
    { capRy: 15.5, capDy: -0.5, glow: 1 },
    { capRy: 15.8, capDy: -1, glow: 2, mouth: 1 },
    { capRy: 15.4, capDy: -0.5, glow: 1 },
  ],
  inhale: [
    { capRx: 30, capRy: 17, capDy: -3, eyes: 'squint', glow: 2 },
    { capRx: 29.5, capRy: 17.8, capDy: -4, eyes: 'squint', glow: 0 },
  ],
  exhale: [
    { capRx: 33, capRy: 13, capDy: 2, mouth: 6, eyes: 'glow', glow: 1, puff: true },
    { capRx: 32.5, capRy: 13.5, capDy: 1.5, mouth: 5, eyes: 'glow', glow: 2, puff: true },
  ],
  spit: [
    { lean: 2, capDy: 1, mouth: 7, eyes: 'glow', glow: 2 },
    { lean: 1, capDy: 0, mouth: 4, eyes: 'glow', glow: 1 },
  ],
  roots: [
    { roots: true, capDy: 2, capRy: 14, eyes: 'glow', mouth: 2, glow: 2 },
    { roots: true, capDy: 1, capRy: 14.5, eyes: 'glow', mouth: 3, glow: 0 },
  ],
  sink: [{ sink: 8, eyes: 'squint' }, { sink: 22, eyes: 'squint' }, { sink: 40, eyes: 'squint' }],
  emerge: [{ sink: 40, eyes: 'glow' }, { sink: 20, eyes: 'glow' }, { sink: 6, eyes: 'glow', mouth: 4 }],
  hurt: [{ lean: -3, capDy: 2, capRy: 14, eyes: 'squint', mouth: 3, glow: 2 }],
};
const FPS: Record<string, number> = { idle: 4, inhale: 6, exhale: 10, spit: 8, roots: 12, sink: 7, emerge: 7, hurt: 1 };
const NOLOOP = new Set(['sink', 'emerge']);

for (const [state, poses] of Object.entries(POSES)) {
  for (const [pre, p2] of [['smom', false], ['smom2', true]] as const) {
    frames(pre, state, poses.length, W, H, (p, i) => paintMother(p, poses[i], p2), { origin: ORIGIN, fps: FPS[state] ?? 8, loop: !NOLOOP.has(state) });
  }
}

// intro-card portrait: the gaping maw in the stalk, the pustuled cap looming above
function paintPortrait(p: PixelPainter): void {
  const cx = 38;
  // stalk (fills the frame)
  p.poly([cx - 22, 78, cx - 17, 30, cx + 17, 30, cx + 22, 78], STALK[2]);
  for (let y = 28; y < 80; y++) {
    for (let x = 0; x < 76; x++) {
      if (!p.isSet(x, y)) continue;
      const n = (x - cx) / 20;
      const lum = 0.62 - n * 0.4 - Math.abs(n) ** 4 * 0.3 + (y - 30) / 160;
      p.px(x, y, STALK[clamp(Math.floor(lum * 5 + bayer(x, y) - 0.5), 0, 4)]);
    }
  }
  for (const dx of [-13, -7, 8, 14]) p.line(cx + dx, 34, cx + dx * 1.2, 78, STALK[1]);
  // sunken eyes glowing in pits
  for (const sd of [-1, 1]) {
    const ex = cx + sd * 9;
    p.ellipse(ex, 40, 4.6, 3.6, STALK[0]);
    p.ellipse(ex, 40, 3, 2.4, '#1a0a14');
    p.ellipse(ex, 40, 1.8, 1.4, SPORE);
    p.px(ex - 1, 39, SPORE_HOT);
    p.line(ex - 5, 35 + (sd < 0 ? 1 : 0), ex + 4, 36 - (sd < 0 ? 0 : 1), STALK[0]);
  }
  // the maw
  p.ellipse(cx, 58, 15, 10, '#1a0610');
  p.ellipse(cx, 59, 12, 7.5, '#5a1a3a');
  p.ellipse(cx, 61, 7, 4.5, '#8ac040');
  p.ellipse(cx, 61.5, 4.5, 2.6, SPORE);
  p.ellipse(cx, 62, 2, 1.2, SPORE_HOT);
  for (let i = -5; i <= 5; i++) {
    const tx = cx + i * 2.6;
    const top = 49 + Math.abs(i) * 0.5;
    const bot = 67 - Math.abs(i) * 0.5;
    p.poly([tx - 1, top, tx + 1, top, tx, top + 3 + (i % 2 ? 1 : 0)], STALK[4]);
    p.poly([tx - 1, bot, tx + 1, bot, tx, bot - 3 - (i % 2 ? 0 : 1)], STALK[4]);
  }
  // drool of spores
  p.line(cx - 6, 66, cx - 7, 72, SPORE);
  p.px(cx - 7, 73, SPORE_HOT);
  // gill skirt + cap
  p.ellipse(cx, 27, 36, 6, GILL[1]);
  for (let i = -9; i <= 9; i++) p.line(cx + i * 3.6, 23, cx + i * 4.2, 31, GILL[2]);
  p.ellipse(cx, 13, 40, 18, CAP[2]);
  for (let y = 0; y < 30; y++) for (let x = 0; x < 76; x++) if (y > 22) p.pxIn(x, y, CAP[1]);
  p.shadeSphere(cx, 13, 40, 18, CAP, { dither: true });
  for (let x = 0; x < 76; x++) {
    const t = (x - cx) / 40;
    p.px(x, 13 + 18 * 0.48 + Math.sqrt(Math.max(0, 1 - t * t)) * 2, CAP[0]);
  }
  const pts: [number, number, number][] = [[10, 12, 3.4], [22, 4, 4], [36, 9, 2.6], [50, 3, 3.6], [64, 11, 3.2], [30, 18, 2], [58, 19, 2.2], [16, 20, 1.8], [44, 16, 1.6]];
  pts.forEach(([x, y, r], i) => {
    p.circle(x, y, r + 0.8, CAP[1]);
    p.circle(x, y, r, i % 3 === 0 ? SPORE_HOT : SPORE);
    p.px(x - r * 0.4, y - r * 0.4, '#ffffff');
  });
  // drifting spores
  for (const [x, y] of [[4, 40], [70, 46], [8, 62], [68, 66], [62, 36]] as const) {
    p.circle(x, y, 1.2, SPORE);
    p.px(x, y, SPORE_HOT);
  }
}

defineDrawnSprite('smom_portrait', 76, 78, (p) => paintPortrait(p), { outline: OUTLINE });

defineDrawnSprite('smom_sack', 9, 10, (p) => {
  ball(p, 4.5, 5.5, 4, 4.2, CAP.slice(1), true);
  p.circle(3, 6, 1.2, SPORE);
  p.circle(6, 4.5, 1, SPORE);
  p.px(2, 3, '#ffffff');
  p.rect(4, 0, 1, 2, CAP[0]);
}, { outline: '#0a0410' });

// ------------------------------------------------------------------ behaviour
const NAME = '포자 어미';
const SPORE_COLS = ['#ffffff', SPORE, '#8ac040'];

function anim(e: Enemy, state: string, restart = false): void {
  e.setAnim(`${e.mem.p2 ? 'smom2' : 'smom'}_${state}`, restart);
}

function hazardCount(w: World): number {
  let n = 0;
  for (const x of w.entities) if (x instanceof Hazard && !x.dead) n++;
  return n;
}

function sporeCloud(w: World, x: number, y: number, n = 16): void {
  w.particles.burst(x, y, { count: n, speed: [20, 70], life: [0.6, 1.3], colors: ['#f6ffd0', '#d6ff5a', '#8ac040', '#4a6a20'], size: [1, 3], sizeEnd: 0.5, drag: 2.5, gravity: -15 });
}

function* sporeBurst(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  anim(e, 'inhale', true);
  e.telegraph(0.8);
  w.sfx('charge', { vol: 0.5, pitch: 0.5 });
  for (let k = 0; k < 4; k++) {
    gather(w, e.x, e.y - 24, ['#ffffff', SPORE, '#8ac040'], 8, 40, true);
    yield 0.2;
  }
  anim(e, 'exhale', true);
  w.sfx('poison', { vol: 0.9, pitch: 0.6 });
  w.shake(0.3);
  sporeCloud(w, e.x, e.y - 24, 30);
  if (!p2) {
    const g = w.rng.angle();
    for (let k = 0; k < 2; k++) {
      shootGapRing(e, w, 20, k * 0.16, [g + k * 0.5, g + Math.PI + k * 0.5], 0.85, bullet('toxic', 3, { speed: 62 + k * 14, z: 10 }));
      yield 0.32;
    }
  } else {
    // spiral bloom
    let a = w.rng.angle();
    const dir = w.rng.sign();
    for (let el = 0; el < 1.9; el += 0.12) {
      for (let k = 0; k < 3; k++) e.shoot(w, a + (k * Math.PI * 2) / 3, bullet('toxic', 3, { speed: 70, z: 10 }));
      if (Math.floor(el / 0.12) % 3 === 0) w.sfx('enemy_shoot', { vol: 0.3, pitch: 0.9 });
      a += dir * 0.11;
      yield 0.12;
    }
    const g = w.rng.angle();
    shootGapRing(e, w, 22, 0, [g, g + Math.PI], 0.85, bullet('toxic', 3, { speed: 58, z: 10 }));
  }
  yield 0.4;
  anim(e, 'idle');
  yield 0.5;
}

function* sackLob(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  anim(e, 'spit', true);
  e.telegraph(0.5);
  w.sfx('charge', { vol: 0.35, pitch: 0.8 });
  yield 0.5;
  const n = p2 ? 6 : 4;
  const p = w.player;
  const pts = volleyTargets(e.x, e.y, p.x + p.vx * 0.3, p.y + p.vy * 0.3, Math.min(3, n), 34);
  while (pts.length < n) {
    const s = spotAround(w, p.x, p.y, 30, 90, 6) ?? { x: p.x, y: p.y };
    pts.push(s);
  }
  for (const pt of pts) {
    const land = landingSpot(w, pt.x, pt.y, 4);
    const puddle = hazardCount(w) < 7;
    lob(w, e.x, e.y - 8, land.x, land.y, {
      sprite: 'smom_sack', color: BUL.toxic.color, time: 1.05, height: 64, warn: 14, hitRadius: 12, source: NAME, spin: 6,
      onLand: (ww, x, y) => {
        sporeCloud(ww, x, y, 10);
        if (puddle) ww.spawn(new Hazard(x, y, 14, p2 ? 5 : 4, 'poison', NAME));
      },
    });
    e.squash(0.85, 1.15);
    w.sfx('splat', { vol: 0.5, pitch: 1.1 });
    yield 0.18;
  }
  anim(e, 'idle');
  yield 0.7;
}

function* rootLances(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  anim(e, 'roots', true);
  e.telegraph(0.55);
  w.sfx('enemy_roar', { vol: 0.5, pitch: 0.75 });
  for (let k = 0; k < 3; k++) {
    dust(w, e.x + fx.range(-20, 20), e.y + 12, ['#6a4c34', '#3a2a30'], 4, 50);
    yield 0.12;
  }
  const t = e.target(w);
  const base = Math.atan2(t.y - (e.y + 12), t.x - e.x);
  const offs = p2 ? [-0.84, -0.42, 0, 0.42, 0.84] : [-0.45, 0, 0.45];
  for (const o of offs) {
    const a = base + o;
    eruptLine(w, e.x + Math.cos(a) * 22, e.y + 12 + Math.sin(a) * 14, a, 12, 15, 0.55, 0.075, 'root', { radius: 9, source: NAME, linger: 0.45 });
  }
  w.shake(0.25);
  yield 1.2;
  anim(e, 'idle');
  yield 0.4;
}

function* burrow(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  anim(e, 'sink', true);
  e.harmful = false;
  w.sfx('enemy_spawn', { vol: 0.6, pitch: 0.6 });
  for (let k = 0; k < 4; k++) {
    dust(w, e.x + fx.range(-18, 18), e.y + 12, ['#6a4c34', '#3a2a30', '#241a22'], 6, 60);
    yield 0.11;
  }
  e.vulnerable = false;
  e.mem.burrow = 1;
  // tunnels under rocks and pits
  e.flying = true;
  e.phasing = true;
  // tunnel to a new spot away from the player
  const p = w.player;
  const dest0 = spotAround(w, p.x, p.y, 85, 130, 20) ?? { x: w.room.centerX, y: w.room.centerY - 20 };
  const dest = inRoom(w, dest0.x, dest0.y, 34);
  for (let el = 0; el < 2.5; el += w.dt) {
    const d = Math.hypot(dest.x - e.x, dest.y - e.y);
    if (d < 3) break;
    e.moveDir(dest.x - e.x, dest.y - e.y, Math.min(120, d * 4));
    if (fx.chance(0.5)) dust(w, e.x + fx.range(-6, 6), e.y + 12, ['#6a4c34', '#3a2a30'], 2, 40);
    yield;
  }
  e.halt();
  // surface on open floor
  const free = w.room.nearestFree(e.x, e.y, 14);
  e.x = free.x;
  e.y = free.y;
  e.flying = false;
  e.phasing = false;
  // surfacing warning
  w.spawn(new GroundWarning(e.x, e.y + 10, 30, 0.7));
  for (let k = 0; k < 5; k++) {
    dust(w, e.x + fx.range(-14, 14), e.y + 12, ['#8a6a44', '#3a2a30'], 4, 70);
    yield 0.14;
  }
  e.mem.burrow = 0;
  anim(e, 'emerge', true);
  w.sfx('slam', { vol: 0.7, pitch: 0.8 });
  w.shake(0.5);
  e.vulnerable = true;
  // erupting from under the player's feet hurts
  const pl = w.player;
  if (pl.alive && Math.hypot(pl.x - e.x, pl.y - (e.y + 10)) < 30 + pl.r && pl.hurt(w, 2, NAME)) {
    const d = Math.hypot(pl.x - e.x, pl.y - e.y) || 1;
    pl.knock((pl.x - e.x) / d, (pl.y - e.y) / d, 200);
  }
  sporeCloud(w, e.x, e.y, 20);
  yield 0.45;
  e.harmful = true;
  if (p2) {
    const g = w.rng.angle();
    shootGapRing(e, w, 18, 0, [g, g + Math.PI], 0.9, bullet('toxic', 3, { speed: 66, z: 10 }));
  }
  anim(e, 'idle');
  yield 0.5;
}

function* brood(e: Enemy, w: World, n: number): Script {
  anim(e, 'spit', true);
  e.telegraph(0.45);
  yield 0.45;
  for (let i = 0; i < n; i++) {
    const s = spotAround(w, e.x, e.y + 10, 40, 80, 7) ?? { x: e.x + (i ? 40 : -40), y: e.y + 20 };
    lob(w, e.x, e.y - 6, s.x, s.y, {
      sprite: 'smom_sack', color: BUL.toxic.color, time: 0.8, height: 50, warn: 10, hitRadius: 9, source: NAME, damage: 1,
      onLand: (ww, x, y) => {
        summonMinion(e, ww, 'spore_shroom', x, y, SPORE_COLS);
      },
    });
    yield 0.2;
  }
  anim(e, 'idle');
  yield 0.8;
}

function* phaseTwo(e: Enemy, w: World): Script {
  yield* phaseShift(e, w, {
    anim: 'smom_hurt',
    color: '#c0ff60',
    time: 1.5,
    onPeak: () => {
      e.mem.p2 = true;
      anim(e, 'exhale', true);
      w.sfx('poison', { vol: 1, pitch: 0.5 });
      sporeCloud(w, e.x, e.y - 24, 40);
      w.particles.burst(e.x, e.y - 24, { count: 24, speed: [40, 150], life: [0.4, 0.9], colors: ['#e8a8f0', '#9a46b4', '#44195e'], size: [1, 3], gravity: 280, vz: [40, 140], shape: 'square' });
      const g = w.rng.angle();
      shootGapRing(e, w, 24, 0, [g, g + Math.PI], 0.85, bullet('toxic', 3, { speed: 72, z: 10 }));
    },
  });
  anim(e, 'idle');
  if (minionCount(w, e) < 2) yield* brood(e, w, 2 - minionCount(w, e));
}

defineBoss({
  id: 'spore_mother',
  name: NAME,
  bossTitle: '썩은 빛의 어머니',
  bossFloors: [2],
  hp: 780,
  radius: 18,
  speed: 0,
  mass: Infinity,
  sprite: 'smom_idle',
  portrait: 'smom_portrait',
  shadow: 0,
  deathFx: 'spore',
  bloodColor: '#9a46b4',
  contactDamage: 1,
  hurtSfx: 'splat',
  light: { radius: 64, color: '#b0ff60' },
  init(e) {
    e.mem.last = null;
  },
  *script(e, w) {
    anim(e, 'idle');
    yield 0.3;
    let sinceBurrow = 0;
    while (true) {
      if (e.phase === 0 && e.hp <= e.maxHp * 0.5) yield* phaseTwo(e, w);
      const p2 = !!e.mem.p2;
      const close = e.distToTarget(w) < 58;
      const id = pickPattern(w.rng, [
        { id: 'burst', w: 3 },
        { id: 'sacks', w: 2.4 },
        { id: 'roots', w: 2.6 },
        { id: 'burrow', w: close ? 4 : 0.8 + sinceBurrow * 0.6 },
        { id: 'brood', w: 1.3, when: minionCount(w, e) < (p2 ? 2 : 1) && w.enemies.length < 5 },
      ], e.mem.last as string | null);
      e.mem.last = id;
      sinceBurrow = id === 'burrow' ? 0 : sinceBurrow + 1;
      if (id === 'burst') yield* sporeBurst(e, w);
      else if (id === 'sacks') yield* sackLob(e, w);
      else if (id === 'roots') yield* rootLances(e, w);
      else if (id === 'burrow') yield* burrow(e, w);
      else yield* brood(e, w, p2 ? 2 : 1);
      anim(e, 'idle');
      yield p2 ? 0.45 : 0.75;
    }
  },
  update(e, w) {
    if (e.mem.burrow) return;
    if (fx.chance(e.mem.p2 ? 0.45 : 0.22)) {
      // drifting spores off the cap
      w.particles.spawn({
        x: e.x + fx.range(-28, 28), y: e.y - 26 + fx.range(-6, 6), vx: fx.range(-6, 6), vy: fx.range(-12, -3), life: fx.range(1, 2),
        colors: ['#f6ffd0', '#d6ff5a', '#8ac040'], size: 1, additive: true, light: 3, alpha: 0.8,
      });
    }
  },
  draw(e: Enemy, r: Renderer) {
    if (e.mem.burrow) {
      // only a crawling mound of churned soil + glowing mycelium shows
      const t = e.age * 10;
      r.shadow(e.x, e.y + 12, 34, 10, 0.4);
      r.sprite('smom_mound', e.x, e.y + 10 + Math.sin(t) * 0.5);
      return;
    }
    r.shadow(e.x, e.y + 13, 58, 13, 0.4);
    e.drawDefault(r);
  },
  onDeath(e, w) {
    clearArena(w);
    dissolveMinions(w, e);
    bossDeathBurst(w, e.x, e.y - 10, ['#e8a8f0', '#9a46b4', '#6c2a88', '#d0c0ac']);
    sporeCloud(w, e.x, e.y - 20, 60);
    for (let i = 0; i < 3; i++) w.spawn(new RingFx(e.x, e.y, 34 + i * 24, 0.5 + i * 0.15, '#d6ff5a', 2));
  },
});

defineDrawnSprite('smom_mound', 30, 12, (p) => {
  ball(p, 15, 8, 14, 4.5, SOIL, true);
  ball(p, 13, 6, 8, 3.5, ROOT, true);
  for (let i = 0; i < 5; i++) p.px(5 + i * 5, 5 + (i % 2) * 2, SPORE);
  p.px(9, 4, SPORE_HOT);
  p.line(4, 9, 1, 11, MYCEL);
  p.line(26, 9, 29, 11, MYCEL);
}, { outline: OUTLINE });
