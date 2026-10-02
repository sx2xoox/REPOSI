// Floor 7 theme "멈춘 태엽탑": the clock tower that stopped the moment the lantern went
// dark. Walnut parquet floors with brass inlay strips and inlaid clock dials (hands stuck
// at different hours), riveted brass walkways, gearwork walls (big frozen cogs, clock
// faces and steam pipes painted over the top wall face, verdigris creeping up from the
// floor), gear-shaft pits, gear stacks and broken porcelain automatons as rocks, pendulum
// pillars as blocks, porcelain vases as pots, amber lamps, pendulum wall clocks, steam
// vents, drifting dust and brass flecks.

import { defineTheme } from '../../game/defs';
import { defineThemeArt, facePoint, nearDoor, type WallGeo } from '../../game/roomart';
import { TILE } from '../../game/constants';
import { Tile } from '../../game/tiles';
import { PixelPainter } from '../../engine/painter';
import { fx } from '../../engine/rng';
import type { RNG } from '../../engine/rng';
import type { Room } from '../../game/room';
import { DoorGlow } from '../props/ambient';
import { AmberLamp, CLOCK, GearShaftFx, paintDial, paintGear, SteamVent, WallClock } from '../props/clock';
import { wallPos, wallSlots } from '../props/prop';
import { slotRoll } from './common';
import {
  addPx, blendPx, floorPx, hash2, randomFloorPx, rampPick, shadePx, stain, vnoise, type FloorTest,
} from './paint';

// ------------------------------------------------------------------ palette
const W = CLOCK.wood;
const B = CLOCK.brass;
const V = CLOCK.verd;
const P = CLOCK.plum;
const PORC = CLOCK.porc;
const OUT = CLOCK.out;
/** gear-shaft darkness, darkest first */
const SHAFT = ['#0c0610', '#160c1c', '#241428', '#3a2438'];

/** Shift a hex color toward another by k (0..1). */
function toward(c: string, to: string, k: number): string {
  const a = parseInt(c.slice(1, 7), 16);
  const b = parseInt(to.slice(1, 7), 16);
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * k);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

/** Brass color at a floor pixel: aged, with verdigris blooming where it is damp. */
function brassPx(X: number, Y: number, s: number, seed = 21): string {
  const pat = vnoise(X / 6, Y / 6, seed);
  if (pat > 0.74) return rampPick(V, (pat - 0.74) * 9 + (hash2(X, Y, 3) - 0.5), X, Y);
  return rampPick(B, s + (hash2(X, Y, 2) - 0.5) * 0.6, X, Y);
}

// ------------------------------------------------------------------ floor tiles
function paintFloor(p: PixelPainter, tx: number, ty: number): void {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const X = tx * TILE + x;
      const Y = ty * TILE + y;
      const gx = ((X % 48) + 48) % 48;
      const gy = ((Y % 48) + 48) % 48;
      let c: string;
      if (gx < 2 || gy < 2) {
        // brass inlay strips on a three-tile grid: lit upper / left edge, dark seam
        const edge = gx === 0 || gy === 0;
        c = brassPx(X, Y, edge ? 3.4 : 2.1);
      } else {
        // basket-weave parquet: 8px blocks of two 4px boards, alternating direction
        const cx = Math.floor(X / 8);
        const cy = Math.floor(Y / 8);
        const horiz = ((cx + cy) & 1) === 0;
        const lx = X - cx * 8;
        const ly = Y - cy * 8;
        const across = horiz ? ly : lx;
        const along = horiz ? lx : ly;
        const board = Math.floor(across / 4);
        const inB = across - board * 4;
        const bh = hash2(cx * 2 + board, cy * 3 + (horiz ? 0 : 1), 7);
        let s = 2.6 + (bh - 0.5) * 1.5 + (vnoise(along / 5 + bh * 9, across / 3 + cy, 3) - 0.5) * 0.9;
        if (inB === 0) s += 0.9;
        else if (inB === 3) s -= 0.9;
        if (along === 0) s -= 1.1;
        // grain flecks and a few darker knots
        if (hash2(X, Y, 11) < 0.07) s -= 0.6;
        if (bh > 0.94 && hash2(along, board, 13) < 0.2) s -= 1.2;
        // worn, dusty patches
        const wear = vnoise(X / 17, Y / 15, 29);
        if (wear > 0.64) s += (wear - 0.64) * 3.5;
        c = rampPick(W, s, X, Y);
        if (hash2(X, Y, 9) < 0.0015) c = B[5];
      }
      p.px(x, y, c);
    }
  }
}

// ------------------------------------------------------------------ obstacles
/** Gear stacks, a leaning cog, a broken porcelain automaton and a coiled pendulum chain. */
function paintRock(r: PixelPainter, rng: RNG, variant: number): void {
  if (variant === 2) {
    // broken porcelain automaton slumped on the floor: head, cracked torso, gears spilling
    r.ellipse(8.5, 12, 6.5, 4.5, PORC[2]);
    r.rect(3, 9, 11, 5, PORC[2]);
    r.shadeSphere(8.5, 10.5, 7, 6.5, PORC, { dither: false });
    r.ellipse(5, 5.5, 3.6, 3.8, PORC[2]);
    r.shadeSphere(5, 5.5, 3.6, 3.8, [PORC[1], PORC[2], PORC[3], PORC[3], '#ffffff'], { dither: false });
    // painted face: closed eyes, rosy cheeks, teal collar
    r.px(4, 5, P[1]);
    r.px(6, 5, P[1]);
    r.px(3, 7, '#d88a90');
    r.px(7, 7, '#d88a90');
    r.rect(3, 9, 5, 1, V[1]);
    r.px(5, 10, V[2]);
    // cracks (plum) running down the torso
    r.line(10, 9, 12, 13, P[1]);
    r.line(9, 11, 8, 14, P[1]);
    r.px(11, 10, P[0]);
    // the chest is open: dark cavity with brass gears inside
    r.rect(10, 11, 4, 3, P[0]);
    paintGear(r, 11.5, 12.5, 1.6, 6, B, 0.4, { spokes: 0 });
    paintGear(r, 14.5, 15, 2, 7, B, 0, { spokes: 0 });
    // a hand reaching out
    r.rect(1, 14, 3, 2, PORC[2]);
    r.px(1, 14, PORC[3]);
    r.px(13, 8, B[4]);
    r.innerShadow(P[0]);
    r.outline(OUT);
    return;
  }
  if (variant === 3) {
    // pendulum bob lying in its coiled chain
    for (let i = 0; i < 14; i++) {
      const a = i * 0.55;
      const x = 8 + Math.cos(a) * (5.5 - i * 0.18);
      const y = 13 + Math.sin(a) * (3 - i * 0.1);
      r.rect(Math.round(x), Math.round(y), 2, 1, i % 2 ? B[2] : B[3]);
    }
    r.ellipse(7.5, 9, 5, 4.6, B[3]);
    r.shadeSphere(7.5, 9, 5, 4.6, B, { dither: true });
    r.rect(7, 2, 2, 4, B[2]);
    r.px(7, 2, B[4]);
    r.px(5, 7, CLOCK.goldHot);
    r.px(6, 6, B[5]);
    r.px(10, 11, V[1]);
    r.px(11, 10, V[2]);
    r.innerShadow(B[0]);
    r.outline(OUT);
    return;
  }
  if (variant === 1) {
    // one big cog leaning against a smaller one
    paintGear(r, 6, 10, 5.2, 10, B, 0.2, { spokes: 4 });
    paintGear(r, 12, 13, 3.2, 8, [B[0], B[1], B[2], B[3], B[4]], 0.5, { spokes: 0 });
    for (const [x, y] of [[3, 7], [4, 13], [9, 5]] as [number, number][]) r.pxIn(x, y, V[1]);
    r.pxIn(5, 6, V[2]);
    r.innerShadow(B[0]);
    r.outline(OUT);
    void rng;
    return;
  }
  // gear stack: three cogs piled up, verdigris in the teeth
  paintGear(r, 8, 14, 5.5, 11, B, 0.1, { spokes: 0 });
  r.rect(1, 14, 14, 3, B[1]);
  paintGear(r, 7.5, 10, 4.3, 9, B, 0.45, { spokes: 0 });
  for (let x = 3; x <= 12; x++) r.pxIn(x, 12, B[0]);
  paintGear(r, 8.5, 6.5, 3.2, 8, B, 0.9, { spokes: 0 });
  for (let x = 5; x <= 11; x++) r.pxIn(x, 8, B[1]);
  r.pxIn(8, 6, CLOCK.goldHot);
  for (const [x, y] of [[2, 15], [13, 13], [4, 10], [12, 9]] as [number, number][]) r.pxIn(x, y, V[1]);
  r.pxIn(3, 14, V[2]);
  r.innerShadow(B[0]);
  r.outline(OUT);
}

/** Pendulum pillar: a brass column with a dial on top and the pendulum hanging in its slot. */
function paintBlock(b: PixelPainter): void {
  // column body
  b.rect(2, 7, 12, 11, B[2]);
  b.rect(2, 7, 1, 11, B[4]);
  b.rect(3, 7, 1, 11, B[3]);
  b.rect(13, 7, 1, 11, B[0]);
  b.rect(12, 7, 1, 11, B[1]);
  // capital + base plinth
  b.rect(1, 6, 14, 2, B[3]);
  b.rect(1, 6, 14, 1, B[5]);
  b.rect(0, 16, 16, 2, B[1]);
  b.rect(0, 16, 16, 1, B[3]);
  // pendulum slot with the bob frozen mid-swing
  b.rect(5, 9, 6, 7, P[0]);
  b.rect(5, 9, 1, 7, P[1]);
  b.line(8, 9, 9, 13, B[4]);
  b.rect(8, 13, 3, 2, B[4]);
  b.px(9, 13, CLOCK.goldHot);
  // dial on top
  paintDial(b, 8, 3.5, 3.4, 10, 10, { second: null });
  // patina on the base
  b.px(1, 17, V[1]);
  b.px(2, 16, V[1]);
  b.px(13, 17, V[1]);
  b.px(12, 16, V[2]);
  b.outline(OUT);
}

/** Porcelain vase with a verdigris pattern, and a brass oil canister. */
function paintPot(p: PixelPainter, variant: number): void {
  if (variant === 0) {
    p.rect(5, 2, 6, 3, PORC[2]);
    p.ellipse(8, 11.5, 6, 5.5, PORC[2]);
    p.rect(3, 7, 10, 6, PORC[2]);
    p.shadeSphere(8, 10.5, 6.5, 6.5, [PORC[0], PORC[1], PORC[2], PORC[3], '#ffffff'], { dither: false });
    // gold lip and foot, painted teal pattern
    p.rect(4, 2, 8, 1, B[5]);
    p.rect(5, 3, 6, 1, PORC[1]);
    for (let x = 3; x <= 12; x++) p.pxIn(x, 14, B[4]);
    for (let x = 4; x <= 12; x += 2) p.pxIn(x, 9 + ((x >> 1) & 1), V[1]);
    p.pxIn(6, 11, V[2]);
    p.pxIn(9, 12, V[2]);
    p.pxIn(10, 10, V[1]);
    p.px(4, 7, '#ffffff');
    p.px(4, 8, PORC[3]);
  } else {
    // brass canister: cylinder with a spout and a riveted band
    p.rect(3, 5, 10, 11, B[3]);
    p.rect(3, 5, 10, 1, B[5]);
    p.rect(3, 5, 2, 11, B[4]);
    p.rect(11, 5, 2, 11, B[1]);
    p.rect(3, 15, 10, 1, B[0]);
    p.rect(3, 10, 10, 1, B[1]);
    p.px(4, 10, B[4]);
    p.px(11, 10, B[4]);
    p.line(12, 6, 15, 2, B[3]);
    p.px(15, 2, B[5]);
    p.rect(6, 2, 4, 3, B[2]);
    p.rect(6, 2, 4, 1, B[4]);
    p.px(5, 13, V[1]);
    p.px(6, 14, V[2]);
    p.px(10, 12, V[1]);
  }
  p.innerShadow(P[0]);
  p.outline(OUT);
}

// ------------------------------------------------------------------ floor decor
/** Riveted brass walkway across the room. */
function brassWalk(p: PixelPainter, room: Room, rng: RNG, isFloor: FloorTest): void {
  const vertical = rng.chance(0.3);
  const seed = rng.int(0, 9999);
  const g = { x0: 2 * TILE, y0: 2 * TILE, x1: room.pxW - 2 * TILE, y1: room.pxH - 2 * TILE };
  const band = vertical ? rng.int(2, room.w - 5) * TILE : rng.int(2, room.h - 5) * TILE;
  const thick = TILE * 2;
  const PL = 24;
  for (let y = g.y0; y < g.y1; y++) {
    for (let x = g.x0; x < g.x1; x++) {
      const across = vertical ? x - band : y - band;
      if (across < 0 || across >= thick) continue;
      if (!floorPx(isFloor, x, y)) continue;
      const along = vertical ? y : x;
      const row = Math.floor(across / 16);
      const inR = across - row * 16;
      const off = row ? PL / 2 : 0;
      const seg = Math.floor((along + off) / PL);
      const inS = along + off - seg * PL;
      const ph = hash2(seg, row, seed);
      if (ph < 0.05) continue; // a missing plate: parquet shows through
      let s = 2.3 + (ph - 0.5) * 1.1 + (vnoise(along / 9, across / 7, seed) - 0.5) * 0.7;
      if (inR === 0 || inS === 0) s -= 1.6; // seams
      else if (inR === 1 || inS === 1) s += 0.9; // lit edge
      else if (inR === 15 || inS === PL - 1) s -= 0.7;
      // rivets in the corners
      if ((inR === 3 || inR === 12) && (inS === 3 || inS === PL - 4)) s = 5.2;
      else if ((inR === 4 || inR === 13) && (inS === 4 || inS === PL - 3)) s = 0.4;
      p.px(x, y, brassPx(x, y, s, seed + 5));
      // scuffs along the middle
      if (vnoise(along / 4, across, seed + 9) > 0.8 && inR > 4 && inR < 12) blendPx(p, x, y, B[1], 0.4);
    }
  }
  for (let i = 0; i < 3; i++) {
    const k = 0.28 - i * 0.09;
    if (vertical) for (let y = g.y0; y < g.y1; y++) shadePx(p, band + thick + i, y, k);
    else for (let x = g.x0; x < g.x1; x++) shadePx(p, x, band + thick + i, k);
  }
}

/** Clock dial inlaid into the parquet: brass ring and ticks, dark hands stuck at some hour. */
function dialInlay(p: PixelPainter, isFloor: FloorTest, cx: number, cy: number, r: number, rng: RNG): void {
  const hour = rng.int(0, 11);
  const minute = rng.int(0, 59);
  const seed = rng.int(0, 999);
  for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++) {
    for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x++) {
      if (!floorPx(isFloor, x, y)) continue;
      const dx = x + 0.5 - cx;
      const dy = (y + 0.5 - cy) * 1.15;
      const d = Math.hypot(dx, dy);
      if (d > r + 1.6) continue;
      if (d > r - 1.4) {
        // the ring, lit from the top-left
        const s = 2.4 + (-dx * 0.6 - dy * 0.7) / r * 1.8;
        p.px(x, y, brassPx(x, y, s, seed));
      } else if (d > r - 2.4) {
        shadePx(p, x, y, 0.35);
      } else {
        // inner field: a little lighter wood, like a worn inlay
        blendPx(p, x, y, W[5], 0.12);
      }
    }
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const big = i % 3 === 0;
    for (let k = 0; k < (big ? 3 : 1); k++) {
      const rr = r - 3.2 - k;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr / 1.15;
      if (floorPx(isFloor, x, y)) blendPx(p, x, y, big ? B[4] : B[3], 0.9);
    }
  }
  const hand = (ang: number, len: number, w: number) => {
    for (let s = 0; s <= 1; s += 0.5 / len) {
      const x = cx + Math.cos(ang) * len * s;
      const y = cy + Math.sin(ang) * len * s / 1.15;
      if (!floorPx(isFloor, x, y)) continue;
      blendPx(p, x, y, P[0], 0.9);
      if (w > 1) blendPx(p, x + 1, y, P[0], 0.5);
    }
  };
  hand(-Math.PI / 2 + ((hour / 12) + minute / 720) * Math.PI * 2, r * 0.5, 2);
  hand(-Math.PI / 2 + (minute / 60) * Math.PI * 2, r - 4.5, 1);
  // centre pin
  blendPx(p, cx, cy, B[5], 1);
  blendPx(p, cx + 1, cy, B[3], 1);
  blendPx(p, cx, cy + 1, B[2], 1);
}

/** A loose cog, screw or spring lying on the floor. */
function debris(p: PixelPainter, isFloor: FloorTest, x: number, y: number, rng: RNG): void {
  const kind = rng.int(0, 2);
  if (!floorPx(isFloor, x - 4, y - 4) || !floorPx(isFloor, x + 4, y + 4)) return;
  if (kind === 0) {
    const r = rng.range(1.8, 3.2);
    const tmp = new PixelPainter(11, 11);
    paintGear(tmp, 5.5, 5.5, r, rng.int(6, 9), B, rng.angle(), { spokes: 0 });
    for (let yy = 0; yy < 11; yy++) for (let xx = 0; xx < 11; xx++) if (tmp.isSet(xx, yy)) shadePx(p, x - 5 + xx + 1, y - 5 + yy + 1, 0.4);
    for (let yy = 0; yy < 11; yy++) for (let xx = 0; xx < 11; xx++) if (tmp.isSet(xx, yy)) p.data[(y - 5 + yy) * p.w + (x - 5 + xx)] = tmp.data[yy * 11 + xx];
  } else if (kind === 1) {
    // screw: head + shaft
    shadePx(p, x + 1, y + 1, 0.4);
    shadePx(p, x + 2, y + 1, 0.4);
    p.px(x, y, B[4]);
    p.px(x + 1, y, B[2]);
    p.px(x + 2, y, B[1]);
    p.px(x, y - 1, B[5]);
  } else {
    // coil spring
    for (let i = 0; i < 5; i++) {
      shadePx(p, x + i + 1, y + 2, 0.35);
      p.px(x + i, y + (i & 1), i & 1 ? B[2] : B[4]);
      p.px(x + i, y + 1 + (i & 1), B[1]);
    }
  }
}

function floorDecor(p: PixelPainter, room: Room, rng: RNG, isFloor: FloorTest): void {
  const cells = room.node.cw * room.node.ch;
  if (rng.chance(0.65)) brassWalk(p, room, rng, isFloor);
  // one inlaid dial per cell (or so), away from the walls
  for (let i = 0; i < cells; i++) {
    if (!rng.chance(0.85)) continue;
    const q = randomFloorPx(room, rng, isFloor, 30);
    if (q) dialInlay(p, isFloor, Math.round(q.x), Math.round(q.y), rng.range(13, 19), rng);
  }
  // oil stains
  for (let i = 0; i < 1 + cells; i++) {
    const q = randomFloorPx(room, rng, isFloor, 10);
    if (q) stain(p, isFloor, q.x, q.y, rng.range(4, 9), 0.55, rng.int(0, 999), '#0e0810');
  }
  // dust drifts in the corners / along the walls
  for (let i = 0; i < 2 + cells; i++) {
    const q = randomFloorPx(room, rng, isFloor, 6);
    if (q) stain(p, isFloor, q.x, q.y, rng.range(5, 10), 0.22, rng.int(0, 999), '#b8a888');
  }
  // loose cogs, screws, springs
  for (let i = 0; i < 4 + cells * 3; i++) {
    const q = randomFloorPx(room, rng, isFloor, 8);
    if (q) debris(p, isFloor, Math.round(q.x), Math.round(q.y), rng);
  }
  // brass flecks and a few amber glints
  for (let i = 0; i < 8 * cells; i++) {
    const q = randomFloorPx(room, rng, isFloor, 2);
    if (q) addPx(p, q.x, q.y, rng.chance(0.7) ? B[5] : CLOCK.amber.mid, 0.3);
  }
}

// ------------------------------------------------------------------ wall decor
/** Texture height of a wall face in "brick space" (matches roomart's FH). */
const FH = 24;
/** height (0..FH) of the steam pipe that runs around the room */
const PIPE_H = 20.4;

/** Pixel of the horizontal steam pipe at face height h (null outside it). */
function pipePixel(h: number, along: number, dh: number, seed: number, x: number, y: number): string | null {
  const d = h - PIPE_H;
  const half = 1.2 * Math.max(1, dh * 0.55);
  if (Math.abs(d) > half) return null;
  const seg = Math.floor(along / 30);
  const inSeg = along - seg * 30;
  const coupling = inSeg < 3;
  const k = (d + half) / (2 * half); // 0 bottom .. 1 top
  if (coupling) return k > 0.75 ? B[5] : k > 0.3 ? B[3] : B[1];
  let c = k > 0.72 ? B[4] : k > 0.28 ? B[2] : B[0];
  // verdigris and soot patches along the pipe
  const n = vnoise(along / 7, h, seed + 41);
  if (n > 0.7 && k < 0.8) c = toward(c, V[1], (n - 0.7) * 2.5);
  if (hash2(x, y, 6) < 0.05 && k > 0.6) c = B[5];
  return c;
}

/** The painted gearwork of the top wall face, pipes on every face, cogs in the gear shafts. */
function wallDecor(p: PixelPainter, room: Room, rng: RNG, g: WallGeo): void {
  const seed = room.node.seed & 0xffff;
  // ---- the steam pipe around the room (all faces) and verdigris on the side faces
  for (let y = 0; y < g.H; y++) {
    for (let x = 0; x < g.W; x++) {
      if (x >= g.X0 && x < g.X1 && y >= g.Y0 && y < g.Y1) continue;
      const tT = (g.Y0 - 0.5 - y) / g.DT;
      const tL = (g.X0 - 0.5 - x) / g.DS;
      const tR = (x + 0.5 - g.X1) / g.DS;
      const tB = (y + 0.5 - g.Y1) / g.DB;
      const t = Math.max(tT, tL, tR, tB);
      if (t <= 0 || t >= 1) continue;
      let along: number;
      let dh: number;
      if (t === tT || t === tB) {
        const span = g.X1 - g.X0 + 2 * t * g.DS;
        along = g.X0 + ((x + 0.5 - (g.X0 - t * g.DS)) / span) * (g.X1 - g.X0);
        dh = FH / (t === tT ? g.DT : g.DB);
      } else {
        const y0 = g.Y0 - t * g.DT;
        const span = g.Y1 + t * g.DB - y0;
        along = g.Y0 + ((y + 0.5 - y0) / span) * (g.Y1 - g.Y0);
        dh = FH / g.DS;
      }
      // concave corner seams stay dark
      const others = [tT, tL, tR, tB].filter((v) => v !== t);
      const t2 = Math.max(...others);
      if (t2 > 0 && (t - t2) * 13 < 0.7) continue;
      const h = t * FH;
      const c = pipePixel(h, along, dh, seed, x, y);
      if (c) {
        p.px(x, y, c);
        continue;
      }
      // drips of verdigris below the pipe couplings
      const seg = Math.floor(along / 30);
      if (along - seg * 30 < 3 && h < PIPE_H - 1.2 && h > PIPE_H - 1.2 - 4 * hash2(seg, 2, seed)) blendPx(p, x, y, V[1], 0.55);
    }
  }

  // ---- top face: frozen cogs, clock faces, valve pipes (painted in screen space, masked to the face)
  const tmp = new PixelPainter(g.W, g.Y0 + 2);
  const inTop = (x: number, y: number): boolean => {
    const tT = (g.Y0 - 0.5 - y) / g.DT;
    if (tT <= 0.02 || tT >= 0.985) return false;
    const tL = (g.X0 - 0.5 - x) / g.DS;
    const tR = (x + 0.5 - g.X1) / g.DS;
    if (tL > tT - 0.05 || tR > tT - 0.05) return false;
    return true;
  };
  const at = (along: number, h: number) => facePoint(g, 'top', along, h / FH);
  const SEG = 44;
  const n = Math.max(1, Math.round((g.X1 - g.X0) / SEG));
  // the wall clocks / vents hang in the ornament slots: nothing big painted under them
  const slots = wallSlots(room).filter((s) => s.face === 'top' && s.kind === 'ornament').map((s) => s.along);
  let prevGear: { x: number; y: number; r: number } | null = null;
  for (let i = 0; i < n; i++) {
    const along = g.X0 + ((i + 0.5) / n) * (g.X1 - g.X0) + (hash2(i, 1, seed) - 0.5) * 10;
    if (nearDoor(room, 'top', along, 30)) {
      prevGear = null;
      continue;
    }
    let roll = hash2(i, 2, seed);
    if (slots.some((s) => Math.abs(s - along) < 18)) roll = 0.8 + roll * 0.2;
    if (roll < 0.5) {
      // a big cog, often meshing with a smaller one
      const r = 6 + hash2(i, 3, seed) * 3;
      const c = at(along, 11.5 + (hash2(i, 4, seed) - 0.5) * 3);
      const cx = Math.round(c.x);
      const cy = Math.round(c.y);
      const rot = hash2(i, 5, seed) * 6;
      const teeth = 8 + Math.floor(hash2(i, 6, seed) * 4);
      shadowDisc(p, cx + 1, cy + 2, r + 2.5, inTop);
      paintGear(tmp, cx, cy, r, teeth, B, rot, { spokes: 4 });
      if (hash2(i, 7, seed) < 0.6) {
        const r2 = 3.5 + hash2(i, 8, seed) * 1.5;
        const a = hash2(i, 9, seed) < 0.5 ? -0.6 : -2.4;
        const x2 = Math.round(cx + Math.cos(a) * (r + r2 + 1.5));
        const y2 = Math.round(cy + Math.sin(a) * (r + r2 + 1.5));
        shadowDisc(p, x2 + 1, y2 + 2, r2 + 2, inTop);
        paintGear(tmp, x2, y2, r2, 7, B, rot + 0.3, { spokes: 0 });
      }
      // verdigris in a few teeth and a bright glint
      for (let k = 0; k < 4; k++) {
        const a = hash2(i, 20 + k, seed) * 6.28;
        tmp.pxIn(cx + Math.cos(a) * (r + 1), cy + Math.sin(a) * (r + 1), V[1]);
      }
      tmp.pxIn(cx - r * 0.55, cy - r * 0.6, CLOCK.goldHot);
      prevGear = { x: cx, y: cy, r };
    } else if (roll < 0.72) {
      // a clock face set into the wall, hands stopped at a different hour than the others
      const c = at(along, 12);
      const cx = Math.round(c.x);
      const cy = Math.round(c.y);
      shadowDisc(p, cx + 1, cy + 2, 8.5, inTop);
      paintDial(tmp, cx, cy, 7, Math.floor(hash2(i, 10, seed) * 12), Math.floor(hash2(i, 11, seed) * 60), { second: Math.floor(hash2(i, 12, seed) * 60) });
      // a crack across the glass
      if (hash2(i, 13, seed) < 0.4) {
        tmp.line(cx - 4, cy - 5, cx + 1, cy + 1, PORC[0]);
        tmp.line(cx + 1, cy + 1, cx + 3, cy + 5, PORC[0]);
      }
      prevGear = null;
    } else {
      // a vertical pipe dropping from the main pipe to the floor, with a valve wheel
      for (let h = 0; h < PIPE_H - 1; h += 0.5) {
        const c = at(along, h);
        const x = Math.round(c.x);
        const y = Math.round(c.y);
        tmp.px(x - 1, y, B[4]);
        tmp.px(x, y, B[2]);
        tmp.px(x + 1, y, B[0]);
        if (h < 1) {
          tmp.px(x - 2, y, B[3]);
          tmp.px(x + 2, y, B[1]);
        }
      }
      const vc = at(along, 8.5);
      paintGear(tmp, Math.round(vc.x), Math.round(vc.y), 2.6, 6, [B[1], B[2], B[3], B[4], B[5]], 0.3, { spokes: 3, open: true, hub: 1 });
      // a gauge above the valve
      const gc = at(along, 15);
      paintDial(tmp, Math.round(gc.x), Math.round(gc.y), 3, 3, 40, { second: null });
      prevGear = null;
    }
  }
  void prevGear;
  // composite the gearwork onto the face
  for (let y = 0; y < tmp.h; y++) {
    for (let x = 0; x < tmp.w; x++) {
      const v = tmp.data[y * tmp.w + x];
      if (!(v >>> 24) || !inTop(x, y)) continue;
      p.data[y * p.w + x] = v;
    }
  }
  // soot and amber sheen near the lamps' mounting height
  for (let i = 0; i < 3 * room.node.cw; i++) {
    const x = rng.range(g.X0, g.X1);
    for (let k = 0; k < 4; k++) blendPx(p, x, g.Y0 - 1 - k, CLOCK.amber.mid, 0.22 - k * 0.05);
  }

  // ---- gear shafts: frozen cogs far below the floor
  for (let ty = 2; ty < room.h - 2; ty++) {
    for (let tx = 2; tx < room.w - 2; tx++) {
      if (room.tileAt(tx, ty) !== Tile.PIT) continue;
      const north = room.tileAt(tx, ty - 1) !== Tile.PIT;
      for (let y = 0; y < TILE; y++) {
        if (north && y < 6) continue;
        for (let x = 0; x < TILE; x++) {
          const X = tx * TILE + x;
          const Y = ty * TILE + y;
          // big cogs on a jittered 40px grid
          const gx = Math.floor(X / 40);
          const gy = Math.floor(Y / 40);
          let best = 99;
          let bestA = 0;
          let bestR = 0;
          for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
              const cx = (gx + i) * 40 + 8 + hash2(gx + i, gy + j, seed) * 24;
              const cy = (gy + j) * 40 + 8 + hash2(gx + i, gy + j, seed + 1) * 24;
              const r = 9 + hash2(gx + i, gy + j, seed + 2) * 8;
              const d = Math.hypot(X - cx, Y - cy);
              if (Math.abs(d - r) < Math.abs(best - bestR)) {
                best = d;
                bestR = r;
                bestA = Math.atan2(Y - cy, X - cx);
              }
            }
          }
          const tooth = Math.cos(bestA * 10) > 0.2 ? 2.5 : 0;
          const dd = best - bestR;
          if ((dd > -1.4 && dd < 0.2) || (dd >= 0.2 && dd < tooth)) blendPx(p, X, Y, Math.sin(bestA) < -0.3 ? B[3] : B[2], 0.72);
          else if (dd > -2.6 && dd <= -1.4) blendPx(p, X, Y, B[0], 0.7);
          else if (Math.abs(best - bestR * 0.45) < 1.2) blendPx(p, X, Y, B[1], 0.5);
        }
      }
    }
  }
}

/** Soft drop shadow of a mounted disc on the wall face. */
function shadowDisc(p: PixelPainter, cx: number, cy: number, r: number, inFace: (x: number, y: number) => boolean): void {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (!inFace(x, y)) continue;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d < 1) shadePx(p, x, y, 0.4 * (1 - d * d));
    }
  }
}

// ------------------------------------------------------------------ theme
defineTheme({
  id: 'clock',
  name: '멈춘 태엽탑',
  palette: {
    floor: W,
    wall: ['#140c12', '#241620', '#3a2626', '#56402e'],
    rock: [B[0], B[1], B[2], B[3], B[4]],
    pit: SHAFT[0],
    accent: [B[4], V[2], PORC[2]],
    dark: OUT,
  },
  ambient: '#8a7484',
  paintFloor: (p, tx, ty) => paintFloor(p, tx, ty),
  paintRock,
  decorate(w, rng) {
    const room = w.room;
    for (const s of wallSlots(room)) {
      if (s.kind === 'light') {
        const pos = wallPos(room, s.face, s.along, s.face === 'top' ? 0.58 : 0.5);
        w.spawn(new AmberLamp(Math.round(pos.x), Math.round(pos.y), s.face));
      } else if (s.face === 'top') {
        const roll = slotRoll(room.node.seed, s);
        if (roll < 0.55) {
          const pos = wallPos(room, 'top', s.along, 0.62);
          w.spawn(new WallClock(Math.round(pos.x), Math.round(pos.y), Math.floor(roll * 30)));
        } else {
          const pos = wallPos(room, 'top', s.along, 0.06);
          w.spawn(new SteamVent(Math.round(pos.x), Math.round(pos.y)));
        }
      } else if (slotRoll(room.node.seed, s) < 0.5) {
        const pos = wallPos(room, s.face, s.along, 0.1);
        w.spawn(new SteamVent(Math.round(pos.x) + (s.face === 'left' ? 2 : -2), Math.round(pos.y)));
      }
    }
    for (const d of room.doors) if (d.kind !== 'normal' && d.kind !== 'start') w.spawn(new DoorGlow(d));
    if (room.tiles.some((t) => t === Tile.PIT)) w.spawn(new GearShaftFx(w));
    void rng;
  },
  ambientFx(w, dt) {
    const r = w.room;
    const area = r.node.cw * r.node.ch;
    // dust hanging in the still air
    if (fx.chance(dt * 4 * area)) {
      w.particles.spawn({
        x: r.interiorX + fx.next() * r.interiorW, y: r.interiorY + fx.next() * r.interiorH,
        vx: fx.range(-3, 3), vy: fx.range(-2, 2), life: fx.range(3, 5), drag: 0.1,
        colors: ['#e8d8b0', '#a89878'], size: 1, alpha: 0.45,
      });
    }
    // brass flecks catching the lamp light
    if (fx.chance(dt * 1.6 * area)) {
      w.particles.spawn({
        x: r.interiorX + fx.next() * r.interiorW, y: r.interiorY + fx.next() * r.interiorH,
        vx: fx.range(-4, 4), vy: fx.range(-6, -1), life: fx.range(1.5, 3), drag: 0.3,
        colors: ['#fff0b0', '#e8c870', '#9a7430'], size: 1, additive: true, alpha: 0.9, light: fx.chance(0.3) ? 5 : 0, lightColor: CLOCK.amber.mid,
      });
    }
    // wisps of steam drifting from the cracked pipes
    if (fx.chance(dt * 0.8 * area)) {
      w.particles.spawn({
        x: r.interiorX + fx.next() * r.interiorW, y: r.interiorY + fx.next() * r.interiorH * 0.6,
        vx: fx.range(-5, 5), vy: -fx.range(3, 7), life: fx.range(2.5, 4), size: 3, sizeEnd: 9, colors: ['#e8e0e4'], alpha: 0.08, shape: 'circle',
      });
    }
  },
});

defineThemeArt('clock', {
  wall: 'plate',
  face: ['#241620', '#3a2826', '#54402c', '#705634', '#a0824a'],
  cap: ['#0c060c', '#160c14', '#22141e', '#3e2c30'],
  mortar: '#120a10',
  growth: V.slice(0, 3),
  pit: 'chasm',
  pitRamp: SHAFT,
  door: { frame: ['#2a1a12', '#5a3c1c', '#9a7430', '#e8c870'], leaf: '#3a2430', metal: '#e0b850', inner: '#0a0608' },
  spikes: { plate: '#2a1a22', metal: ['#4a3418', '#8a6a2c', '#c8a44a', '#fff0b0'] },
  pots: [PORC[2], B[3]],
  paintFloorDecor: floorDecor,
  paintWallDecor: wallDecor,
  paintBlock,
  paintPot,
});
