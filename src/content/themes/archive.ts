// Floor 6 theme "수몰된 서고": a library that sank beneath the abyss. Wet slate
// flagstones with teal water in the seams, rotting plank walkways, flooded channels,
// bookshelf walls (painted over the top wall face) with a tide line and algae below it,
// book-pile rocks, standing bookcases as blocks, ink jars as pots, drowned reading lamps
// still faintly burning, coral-crusted globes, drifting pages, bubbles and drips.

import { defineTheme } from '../../game/defs';
import { defineThemeArt, type WallGeo } from '../../game/roomart';
import { TILE } from '../../game/constants';
import { Tile } from '../../game/tiles';
import { fx } from '../../engine/rng';
import type { PixelPainter } from '../../engine/painter';
import type { RNG } from '../../engine/rng';
import type { Room } from '../../game/room';
import { DoorGlow, Drip, PitFx } from '../props/ambient';
import { ARCHIVE, CoralGlobe, DrownedLamp, FloodGlow, pageSprite } from '../props/archive';
import { flatBook, paintBookStack, SPINES } from '../enemies/archive-shared';
import { wallPos, wallSlots } from '../props/prop';
import { slotRoll } from './common';
import {
  addPx, blendPx, floorPx, hash2, puddle, randomFloorPx, rampPick, shadePx, stain, vnoise, worley, type FloorTest,
} from './paint';

// ------------------------------------------------------------------ palette
/** Wet blue-teal slate, darkest first. */
const F = ['#101a28', '#172636', '#1f3344', '#284354', '#335566', '#44707e'];
/** Water in the seams / channels. */
const WATER = ['#06161e', '#0a2a34', '#0f4450', '#1e7684', '#5ad0dc'];
/** Rotting walkway planks. */
const PLANK = ['#160f0a', '#271a10', '#382818', '#4a3822', '#5e4a2c'];
const ROCK = ['#1a1410', '#2e2218', '#4a3a28', '#6a5a3c', '#9a8a60'];
const INK = '#05070c';
const ALGAE = ['#0e3a3c', '#1a5c58', '#2a8a80'];
const OUT = '#070c12';

/** Shift a hex color toward another by k (0..1). */
function toward(c: string, to: string, k: number): string {
  const a = parseInt(c.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * k);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

// ------------------------------------------------------------------ floor tiles
function paintFloor(p: PixelPainter, tx: number, ty: number): void {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const X = tx * TILE + x;
      const Y = ty * TILE + y;
      const w = worley(X, Y, 15, 12, 71);
      const edge = w.d2 - w.d1;
      let c: string;
      if (edge < 1.1) {
        // seams between the slabs hold standing water
        const gl = hash2(X, Y, 4);
        c = gl < 0.035 ? WATER[4] : gl < 0.2 ? WATER[2] : WATER[1];
      } else {
        let s = 2.3 + (w.id - 0.5) * 1.5 + (vnoise(X / 7, Y / 7, 5) - 0.5) * 0.8 + (hash2(X, Y, 1) - 0.5) * 0.5;
        if (edge < 2.3 && Y < w.fy) s += 0.9; // lit upper rim of every slab
        else if (edge < 2.3) s -= 0.8;
        // wet gloss: diagonal reflections of the lamps
        const gloss = (X - Y * 2 + Math.floor(w.id * 40)) % 29;
        if (gloss === 0 && edge > 3) s += 1.4;
        else if (gloss === 1 && edge > 3) s += 0.6;
        c = rampPick(F, s, X, Y);
        // damp patches tinted by the water below
        const damp = vnoise(X / 13, Y / 11, 23);
        if (damp > 0.62) c = toward(c, '#145058', (damp - 0.62) * 1.6);
        if (hash2(X, Y, 9) < 0.0012) c = '#6af0ff';
      }
      p.px(x, y, c);
    }
  }
}

// ------------------------------------------------------------------ obstacles
/** Book piles (variants 0–2; 0 is the stack a 책 더미 미믹 imitates) and an open book on a stack (3). */
function paintRock(r: PixelPainter, rng: RNG, variant: number): void {
  const spine = (i: number) => SPINES[(i * 3 + variant * 5) % SPINES.length];
  if (variant === 0) {
    paintBookStack(r, 0, 0);
    r.innerShadow(ROCK[0]);
    r.outline(OUT);
    return;
  }
  if (variant === 3) {
    flatBook(r, 2, 12, 12, 3, spine(2));
    flatBook(r, 3, 9, 11, 3, spine(5), false);
    // open book: two cream pages with a dark gutter and faint text
    r.rect(1, 4, 14, 6, '#c8b890');
    r.rect(1, 4, 14, 1, ARCHIVE.parchmentHot);
    r.rect(8, 4, 1, 6, '#5a4a3a');
    for (let y = 6; y <= 8; y += 2) {
      r.rect(2, y, 5, 1, '#6a6078');
      r.rect(10, y, 4, 1, '#6a6078');
    }
    r.px(12, 6, '#8a3a3a');
    r.rect(1, 9, 14, 1, '#8a7a58');
  } else if (variant === 2) {
    // messy heap
    flatBook(r, 1, 13, 10, 3, spine(0));
    flatBook(r, 5, 12, 10, 3, spine(1), false);
    flatBook(r, 2, 9, 11, 3, spine(2));
    flatBook(r, 6, 7, 8, 3, spine(3), false);
    r.poly([9, 7, 14, 3, 15, 4, 11, 7], spine(4));
    r.px(14, 3, toward(spine(4), '#ffffff', 0.4));
  } else {
    // three books with one leaning upright against the stack
    for (let i = 0; i < 3; i++) {
      const off = [1, 2, 0][i];
      const w = 11 + ((i + variant) % 2);
      flatBook(r, 2 + off, 15 - i * 3, w, 3, spine(i), i % 2 === 0);
      if ((i + variant) % 2 === 0) r.px(5 + off + (i % 3), 16 - i * 3, ARCHIVE.gold);
    }
    r.rect(1, 5, 3, 11, spine(6));
    r.rect(1, 5, 1, 11, toward(spine(6), '#ffffff', 0.3));
    r.rect(3, 6, 1, 9, ARCHIVE.parchment);
    r.px(2, 8, ARCHIVE.gold);
    r.px(2, 12, ARCHIVE.gold);
  }
  // water stains at the bottom
  for (let x = 0; x < 16; x++) for (let y = 14; y < 18; y++) if (r.isSet(x, y) && hash2(x, y, variant) < 0.35) r.px(x, y, toward('#2a3a44', '#0e3a40', 0.5));
  r.innerShadow(ROCK[0]);
  r.outline(OUT);
  void rng;
}

/** Standing bookcase: the archive's indestructible block. */
function paintBlock(b: PixelPainter): void {
  const W = ARCHIVE.wood;
  b.rect(0, 0, 16, 18, W[1]);
  // top plank (lit) + sides
  b.rect(0, 0, 16, 2, W[3]);
  b.rect(0, 0, 16, 1, W[4]);
  b.rect(0, 2, 1, 16, W[2]);
  b.rect(15, 2, 1, 16, W[0]);
  // two shelves of books (front view)
  const rows: [number, number][] = [[3, 7], [10, 7]];
  rows.forEach(([y0, h], ri) => {
    b.rect(1, y0 + h - 1, 14, 1, W[3]); // shelf board
    b.rect(1, y0, 14, h - 1, '#0a0c14'); // dark back
    let x = 1;
    let i = 0;
    while (x < 15) {
      const w = 2 + ((i + ri) % 3 === 0 ? 1 : 0);
      const hh = h - 1 - ((i * 7 + ri * 3) % 3);
      if ((i + ri * 2) % 7 !== 5) {
        const c = SPINES[(i + ri * 2) % SPINES.length];
        b.rect(x, y0 + (h - 1 - hh), w, hh, c);
        b.px(x, y0 + (h - 1 - hh), toward(c, '#ffffff', 0.35));
        if (i % 2 === 0) b.px(x, y0 + h - 3, ARCHIVE.gold);
      }
      x += w;
      i++;
    }
  });
  // water line + algae on the lower third
  b.rect(0, 12, 16, 1, toward('#8aa8a4', W[2], 0.35));
  for (let y = 13; y < 18; y++) for (let x = 0; x < 16; x++) if (hash2(x, y, 7) < 0.3) b.px(x, y, toward(W[1], ALGAE[0], 0.6));
  b.px(2, 15, ALGAE[2]);
  b.px(12, 16, ALGAE[1]);
  b.outline(OUT);
}

/** Ink jars: a tall stoppered bottle and a squat inkwell with a quill. */
function paintPot(p: PixelPainter, variant: number): void {
  if (variant === 0) {
    const G = ['#0e1c2a', '#1a3448', '#2a5068', '#3a7088', '#6ab0c8'];
    p.rect(5, 3, 6, 3, G[2]);
    p.ellipse(8, 11.5, 6, 5.5, G[2]);
    p.rect(3, 7, 10, 6, G[2]);
    p.shadeSphere(8, 10.5, 6.5, 6.5, G);
    // ink inside (dark), filling to a line
    p.ellipse(8, 12.5, 4.6, 3.6, INK);
    p.rect(4, 11, 8, 1, '#141a30');
    // cork + gold label
    p.rect(5, 2, 6, 2, '#8a6a3a');
    p.rect(5, 2, 6, 1, '#b08a4a');
    p.rect(5, 8, 6, 3, ARCHIVE.parchment);
    p.rect(6, 9, 4, 1, '#5a5068');
    p.px(5, 8, ARCHIVE.parchmentHot);
    p.px(4, 7, '#c8ecff');
    p.px(4, 8, '#9ad0e8');
  } else {
    const G = ['#0e1428', '#1c2444', '#2e3a66', '#445488', '#7a8ec0'];
    p.ellipse(8, 12, 7, 4.8, G[2]);
    p.rect(4, 7, 8, 5, G[2]);
    p.shadeSphere(8, 11, 7.5, 5.5, G);
    p.rect(4, 7, 8, 1, G[4]);
    p.ellipse(8, 8, 3, 1.4, INK);
    p.px(7, 8, '#2a3a6a');
    // quill
    p.line(10, 8, 15, 1, ARCHIVE.parchment);
    p.line(11, 6, 15, 1, '#c0b090');
    p.px(15, 1, '#ffffff');
    p.px(10, 8, INK);
    // gold rim band
    for (let x = 3; x <= 13; x++) p.pxIn(x, 13, ARCHIVE.gold);
  }
  p.innerShadow('#0a0c14');
  p.outline(OUT);
}

// ------------------------------------------------------------------ floor decor
/** Rotting plank walkway across the room (a band of horizontal boards). */
function planks(p: PixelPainter, room: Room, rng: RNG, isFloor: FloorTest): void {
  const vertical = rng.chance(0.3);
  const seed = rng.int(0, 9999);
  const g = { x0: 2 * TILE, y0: 2 * TILE, x1: room.pxW - 2 * TILE, y1: room.pxH - 2 * TILE };
  const bandA = vertical ? rng.int(2, room.w - 5) * TILE : rng.int(2, room.h - 5) * TILE;
  const thick = TILE * 2;
  for (let y = g.y0; y < g.y1; y++) {
    for (let x = g.x0; x < g.x1; x++) {
      const across = vertical ? x - bandA : y - bandA;
      if (across < 0 || across >= thick) continue;
      if (!floorPx(isFloor, x, y)) continue;
      const along = vertical ? y : x;
      // boards: 4px wide across (3px wood + 1px seam), staggered joints along
      const bi = Math.floor(across / 4);
      const inB = across - bi * 4;
      const LEN = 26;
      const off = hash2(bi, seed, 3) * LEN;
      const seg = Math.floor((along + off) / LEN);
      const inS = along + off - seg * LEN;
      const bh = hash2(seg, bi, seed);
      if (bh < 0.08) continue; // missing plank: stone / water shows
      if (inB === 3 || inS < 1) {
        p.px(x, y, PLANK[0]);
        continue;
      }
      let s = 2.1 + (bh - 0.5) * 1.6 + (vnoise(along / 5, across / 3, seed) - 0.5) * 0.8;
      if (inB === 0) s += 0.9; // lit upper edge of each board
      if (bh > 0.86) s -= 1.3; // water-logged board
      let c = rampPick(PLANK, s, x, y);
      // grain
      if (hash2(Math.floor(along / 3), bi, seed + 1) < 0.18 && inB === 1) c = PLANK[Math.max(0, Math.floor(s) - 1)];
      // nails near the joints
      if ((inS === 3 || inS === LEN - 4) && inB === 1) c = '#6a6a74';
      // rot: greenish stains
      const rot = vnoise(along / 9, across / 6, seed + 7);
      if (rot > 0.72) c = toward(c, ALGAE[0], (rot - 0.72) * 2.2);
      p.px(x, y, c);
    }
  }
  // the walkway casts a soft shadow on the stone beside it
  for (let i = 0; i < 3; i++) {
    const k = 0.26 - i * 0.08;
    if (vertical) for (let y = g.y0; y < g.y1; y++) shadePx(p, bandA + thick + i, y, k);
    else for (let x = g.x0; x < g.x1; x++) shadePx(p, x, bandA + thick + i, k);
  }
}

/** A shelf board lying on the floor with spilled books. */
function fallenShelf(p: PixelPainter, isFloor: FloorTest, cx: number, cy: number, rng: RNG): void {
  const len = rng.int(20, 30);
  const slope = rng.range(-0.25, 0.25);
  const x0 = Math.round(cx - len / 2);
  for (let i = 0; i < len; i++) {
    const x = x0 + i;
    const y = Math.round(cy + (i - len / 2) * slope);
    if (!floorPx(isFloor, x, y)) continue;
    shadePx(p, x, y + 4, 0.35);
    shadePx(p, x + 1, y + 4, 0.2);
    p.px(x, y, PLANK[4]);
    p.px(x, y + 1, PLANK[3]);
    p.px(x, y + 2, PLANK[2]);
    p.px(x, y + 3, PLANK[1]);
    if (i % 9 === 4) p.px(x, y + 1, PLANK[0]);
  }
  for (let k = 0; k < rng.int(2, 4); k++) {
    const bx = Math.round(cx + rng.range(-len / 2, len / 2));
    const by = Math.round(cy + rng.range(4, 9));
    const w = rng.int(5, 8);
    if (!floorPx(isFloor, bx, by) || !floorPx(isFloor, bx + w, by + 2)) continue;
    for (let dx = 0; dx <= w; dx++) shadePx(p, bx + dx + 1, by + 3, 0.35);
    flatBook(p, bx, by, w, 3, rng.pick(SPINES), rng.chance(0.5));
  }
}

/** A loose page on the floor (parchment with faded lines), sometimes torn. */
function page(p: PixelPainter, isFloor: FloorTest, x: number, y: number, rng: RNG): void {
  const w = rng.int(4, 6);
  const h = rng.int(5, 7);
  if (!floorPx(isFloor, x, y) || !floorPx(isFloor, x + w, y + h)) return;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (dy === h - 1 && hash2(dx, dy, x) < 0.3) continue; // torn edge
      shadePx(p, x + dx + 1, y + dy + 1, 0.3);
    }
  }
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (dy === h - 1 && hash2(dx, dy, x) < 0.3) continue;
      const wet = vnoise((x + dx) / 3, (y + dy) / 3, y) > 0.6;
      p.px(x + dx, y + dy, dy === 0 ? ARCHIVE.parchmentHot : wet ? '#b0a888' : ARCHIVE.parchment);
    }
  }
  for (let dy = 1; dy < h - 1; dy += 2) p.rect(x + 1, y + dy, w - 2 - ((dy + x) % 2), 1, '#5a5068');
  if (rng.chance(0.3)) p.px(x + 1, y + 1, '#8a3a3a');
}

/** Ink spilled on the stone: a black blot with a few drips and a faint blue sheen. */
function inkBlot(p: PixelPainter, isFloor: FloorTest, cx: number, cy: number, r: number, rng: RNG): void {
  stain(p, isFloor, cx, cy, r, 0.85, rng.int(0, 999), INK);
  stain(p, isFloor, cx, cy, r * 0.55, 0.4, rng.int(0, 999), '#101a3a');
  const a = rng.angle();
  for (let k = 0; k < 3; k++) {
    let x = cx + Math.cos(a + k * 1.9) * r * 0.6;
    let y = cy + Math.sin(a + k * 1.9) * r * 0.4;
    const len = rng.int(3, 7);
    for (let i = 0; i < len; i++) {
      if (floorPx(isFloor, x, y)) blendPx(p, x, y, INK, 0.75);
      x += rng.range(-0.4, 0.4);
      y += 1;
    }
  }
}

function floorDecor(p: PixelPainter, room: Room, rng: RNG, isFloor: FloorTest): void {
  const cells = room.node.cw * room.node.ch;
  if (rng.chance(0.75)) planks(p, room, rng, isFloor);
  for (let i = 0; i < 1 + cells; i++) {
    const q = randomFloorPx(room, rng, isFloor, 14);
    if (q) puddle(p, isFloor, q.x, q.y, rng.range(6, 12), rng.range(3, 5), [WATER[1], WATER[2], WATER[4]], rng.int(0, 99));
  }
  for (let i = 0; i < cells; i++) {
    const q = randomFloorPx(room, rng, isFloor, 10);
    if (q) inkBlot(p, isFloor, q.x, q.y, rng.range(4, 8), rng);
  }
  if (rng.chance(0.6)) {
    const q = randomFloorPx(room, rng, isFloor, 22);
    if (q) fallenShelf(p, isFloor, q.x, q.y, rng);
  }
  for (let i = 0; i < 3 + cells * 3; i++) {
    const q = randomFloorPx(room, rng, isFloor, 6);
    if (q) page(p, isFloor, Math.round(q.x), Math.round(q.y), rng);
  }
  // gold glints + plankton specks
  for (let i = 0; i < 8 * cells; i++) {
    const q = randomFloorPx(room, rng, isFloor, 2);
    if (q) addPx(p, q.x, q.y, rng.chance(0.4) ? ARCHIVE.gold : '#4ad8e8', 0.3);
  }
}

// ------------------------------------------------------------------ wall decor
/** Texture height of a wall face in "brick space" (matches roomart's FH). */
const FH = 24;
const TIDE = 8.6;

/** Color of the bookshelf covering the top wall face at face coords (along, h). */
function shelfPixel(along: number, h: number, da: number, seed: number, x: number, y: number): string | null {
  const W = ARCHIVE.wood;
  const UP = 36;
  const seg = Math.floor(along / UP);
  const inSeg = along - seg * UP;
  const sh = hash2(seg, 1, seed);
  if (h >= 22.4) {
    // cornice: lit moulding
    if (h >= 23.4) return W[4];
    return (Math.floor(along / 3) & 1) ? W[3] : W[2];
  }
  if (inSeg < 2 * Math.max(1, da)) return inSeg < Math.max(1, da) ? W[3] : W[1]; // uprights
  // shelf boards
  const boards: [number, number][] = [[0, 1.6], [7.0, 8.4], [14.5, 15.9]];
  for (const [b0, b1] of boards) {
    if (h >= b0 && h < b1) return h >= b1 - 0.7 ? W[4] : h < b0 + 0.5 ? W[0] : W[2];
  }
  const collapsed = sh < 0.14;
  const rowTop = h < 7 ? 7.0 : h < 14.5 ? 14.5 : 22.4;
  const rowBot = h < 7 ? 1.6 : h < 14.5 ? 8.4 : 15.9;
  if (collapsed && h >= 8.4) {
    // the upper shelves gave way: a diagonal board and the dark back
    const d = h - (9 + inSeg * 0.36);
    if (d > -0.7 && d < 0.7) return W[3];
    if (d > -1.3 && d < 1.3) return W[1];
    if (h < 11 && hash2(Math.floor(inSeg / 3), 2, seed + seg) < 0.5) {
      const c = SPINES[(seg + Math.floor(inSeg / 3)) % SPINES.length];
      return h < 9.6 ? c : null;
    }
    return null;
  }
  // books in 4px slots
  const slot = Math.floor((inSeg - 2) / 4);
  const inSlot = inSeg - 2 - slot * 4;
  const bh = hash2(seg * 8 + slot, Math.floor(rowBot), seed);
  if (bh < 0.09) return null; // gap
  const lean = bh > 0.93;
  const top = rowTop - 0.6 - Math.floor(bh * 3.2) * 0.8 - (lean ? 1.4 : 0);
  if (h > top) return null;
  const c = SPINES[Math.floor(bh * 97) % SPINES.length];
  // left edge lit, right edge dark; gold bands
  if (inSlot < Math.max(1, da) * 0.999) return toward(c, '#ffffff', 0.3);
  if (inSlot >= 4 - Math.max(1, da) * 0.999) return toward(c, '#000000', 0.35);
  if (bh > 0.4 && bh < 0.75 && (Math.abs(h - (rowBot + 1.3)) < 0.5 || Math.abs(h - (top - 1.6)) < 0.5)) return ARCHIVE.gold;
  return c;
}

function wallDecor(p: PixelPainter, room: Room, rng: RNG, g: WallGeo): void {
  const seed = room.node.seed & 0xffff;
  // ---- top face: bookshelves (same perspective mapping as the wall painter)
  for (let y = g.RY0; y < g.Y0; y++) {
    const t = (g.Y0 - 0.5 - y) / g.DT;
    if (t < 0 || t >= 1) continue;
    for (let x = g.RX0; x < g.RX1; x++) {
      const tL = (g.X0 - 0.5 - x) / g.DS;
      const tR = (x + 0.5 - g.X1) / g.DS;
      if (tL > t || tR > t) continue; // side faces
      const t2 = Math.max(tL, tR);
      if (t2 > 0 && (t - t2) * 13 < 0.7) continue; // keep the concave corner seam
      const span = g.X1 - g.X0 + 2 * t * g.DS;
      const along = g.X0 + ((x + 0.5 - (g.X0 - t * g.DS)) / span) * (g.X1 - g.X0);
      const da = (g.X1 - g.X0) / span;
      const h = t * FH;
      let c = shelfPixel(along, h, da, seed, x, y);
      if (c === null) c = hash2(x, y, 5) < 0.06 ? '#141826' : '#0a0c14'; // dark shelf back
      // below the tide line everything is water-stained and grows algae
      if (h < TIDE) {
        c = toward(c, '#0e3a40', 0.42 * (1 - h / TIDE) + 0.12);
        const al = vnoise(along / 5, h / 3, seed + 11) - h / (TIDE * 2.6);
        if (al > 0.55) c = rampPick(ALGAE, (al - 0.55) * 8, x, y);
      }
      if (Math.abs(h - TIDE) < 0.45) c = hash2(x, y, 8) < 0.7 ? '#8aa8a4' : '#5a7e7c'; // mineral tide line
      p.px(x, y, c);
    }
  }
  // ---- side and bottom faces: tide line + algae
  const sideAt = (x: number, y: number): { h: number; along: number } | null => {
    const tT = (g.Y0 - 0.5 - y) / g.DT;
    const tL = (g.X0 - 0.5 - x) / g.DS;
    const tR = (x + 0.5 - g.X1) / g.DS;
    const tB = (y + 0.5 - g.Y1) / g.DB;
    const t = Math.max(tT, tL, tR, tB);
    if (t < 0 || t >= 1 || t === tT) return null;
    if (t === tB) {
      const span = g.X1 - g.X0 + 2 * t * g.DS;
      return { h: t * FH, along: g.X0 + ((x + 0.5 - (g.X0 - t * g.DS)) / span) * (g.X1 - g.X0) };
    }
    const y0 = g.Y0 - t * g.DT;
    const span = g.Y1 + t * g.DB - y0;
    return { h: t * FH, along: g.Y0 + ((y + 0.5 - y0) / span) * (g.Y1 - g.Y0) };
  };
  for (let y = 0; y < g.H; y++) {
    for (let x = 0; x < g.W; x++) {
      if (x >= g.X0 && x < g.X1 && y >= g.Y0 && y < g.Y1) continue;
      if (y < g.Y0 && x >= g.RX0 && x < g.RX1 && (g.X0 - 0.5 - x) / g.DS <= (g.Y0 - 0.5 - y) / g.DT && (x + 0.5 - g.X1) / g.DS <= (g.Y0 - 0.5 - y) / g.DT) continue;
      const s = sideAt(x, y);
      if (!s) continue;
      if (Math.abs(s.h - TIDE) < 0.5) blendPx(p, x, y, '#8aa8a4', 0.6);
      else if (s.h < TIDE) {
        blendPx(p, x, y, '#0e3a40', 0.3 * (1 - s.h / TIDE));
        const al = vnoise(s.along / 5, s.h / 3, seed + 17) - s.h / (TIDE * 2.4);
        if (al > 0.56) p.px(x, y, rampPick(ALGAE, (al - 0.56) * 8, x, y));
      }
    }
  }
  // ---- wet streaks running down from the rim of the side walls
  for (let i = 0; i < 3 * room.node.ch; i++) {
    for (const left of [true, false]) {
      const y = rng.range(g.Y0 + 6, g.Y1 - 6);
      const x0 = left ? g.X0 - 1 : g.X1;
      for (let k = 0; k < 6; k++) blendPx(p, x0 + (left ? -k : k), y + rng.range(-0.5, 0.5), '#6ab8c4', 0.28 - k * 0.04);
    }
  }
  // ---- drips of ink down the bookshelf, under the plaques (ornament slots)
  for (const s of wallSlots(room)) {
    if (s.kind !== 'ornament' || s.face !== 'top' || slotRoll(room.node.seed, s) < 0.5) continue;
    const c = wallPos(room, 'top', s.along, 0.66);
    const x = Math.round(c.x);
    const y = Math.round(c.y);
    // a brass plaque with an engraved title
    p.rect(x - 7, y - 3, 15, 6, '#7a5a20');
    p.rect(x - 6, y - 2, 13, 4, ARCHIVE.gold);
    p.rect(x - 6, y - 2, 13, 1, ARCHIVE.goldHot);
    for (let k = -5; k <= 4; k += 2) p.px(x + k, y, '#5a4018');
    p.px(x + 6, y + 1, '#5a4018');
    for (let k = 0; k < 7; k++) blendPx(p, x - 3 + (k & 1), y + 3 + k, INK, 0.6 - k * 0.07);
  }
}

// ------------------------------------------------------------------ theme
defineTheme({
  id: 'archive',
  name: '수몰된 서고',
  palette: {
    floor: F,
    wall: ['#0c1018', '#161c2c', '#222a3e', '#2e3a54'],
    rock: ROCK,
    pit: '#04141c',
    accent: ['#1e7684', ARCHIVE.gold, ARCHIVE.parchment],
    dark: OUT,
  },
  ambient: '#6e8898',
  paintFloor: (p, tx, ty) => paintFloor(p, tx, ty),
  paintRock,
  decorate(w, rng) {
    const room = w.room;
    const slots = wallSlots(room);
    for (const s of slots) {
      if (s.kind === 'light') {
        const pos = wallPos(room, s.face, s.along, s.face === 'top' ? 0.6 : 0.5);
        w.spawn(new DrownedLamp(Math.round(pos.x), Math.round(pos.y), s.face));
      } else if (s.face === 'top' && slotRoll(room.node.seed, s) < 0.5) {
        const pos = wallPos(room, 'top', s.along, 0);
        w.spawn(new CoralGlobe(Math.round(pos.x), Math.round(pos.y) + 1));
      }
    }
    for (const d of room.doors) if (d.kind !== 'normal' && d.kind !== 'start') w.spawn(new DoorGlow(d));
    if (room.tiles.some((t) => t === Tile.PIT)) {
      w.spawn(new PitFx(w, 'water'));
      w.spawn(new FloodGlow(w));
    }
    // water dripping from the shelves above
    const x0 = 2 * TILE;
    const x1 = room.pxW - 2 * TILE;
    for (let i = 0; i < 1 + room.node.cw; i++) {
      const x = Math.round(rng.range(x0 + 12, x1 - 12));
      if (room.doors.some((d) => d.dir === 'N' && Math.abs(d.x - x) < 24)) continue;
      w.spawn(new Drip(x, 16, 2 * TILE + rng.range(6, 44)));
    }
  },
  ambientFx(w, dt) {
    const r = w.room;
    const area = r.node.cw * r.node.ch;
    // drifting pages
    if (fx.chance(dt * 1.1 * area)) {
      const dir = fx.sign();
      w.particles.spawn({
        x: r.interiorX + fx.next() * r.interiorW, y: r.interiorY + fx.next() * r.interiorH,
        vx: dir * fx.range(5, 12), vy: fx.range(-3, 3), life: fx.range(3.5, 6), drag: 0.15,
        colors: ['#ffffff'], shape: 'sprite', sprite: pageSprite(fx.int(0, 2)), vrot: fx.range(-1.4, 1.4) , alpha: 0.95, fade: true, z: fx.range(2, 10),
      });
    }
    // plankton motes drifting up through the air (the whole archive is under water)
    if (fx.chance(dt * 3.5 * area)) {
      w.particles.spawn({
        x: r.interiorX + fx.next() * r.interiorW, y: r.interiorY + fx.next() * r.interiorH,
        vx: fx.range(-3, 3), vy: -fx.range(3, 8), life: fx.range(2.5, 4.5), drag: 0.2,
        colors: ['#d8ffff', ARCHIVE.glow, ARCHIVE.glowLow], size: 1, additive: true, alpha: 0.8, light: fx.chance(0.2) ? 6 : 0, lightColor: ARCHIVE.glow,
      });
    }
    // slow ink clouds
    if (fx.chance(dt * 0.9 * area)) {
      w.particles.spawn({
        x: r.interiorX + fx.next() * r.interiorW, y: r.interiorY + fx.next() * r.interiorH,
        vx: fx.range(-6, 6), vy: fx.range(-2, 2), life: fx.range(2.5, 4), size: 3, sizeEnd: 8, colors: ['#02040a'], alpha: 0.1, shape: 'circle',
      });
    }
  },
});

defineThemeArt('archive', {
  wall: 'brick',
  face: ['#141a2a', '#1e2638', '#2a3448', '#394660', '#56688a'],
  cap: ['#060810', '#0c1018', '#141a26', '#2c384a'],
  mortar: '#0a0d16',
  growth: ALGAE,
  pit: 'water',
  pitRamp: [WATER[0], WATER[1], WATER[2], WATER[3]],
  door: { frame: ['#1a1410', '#4a3a24', '#8a6a3a', '#d8b870'], leaf: '#2e2418', metal: ARCHIVE.gold, inner: '#030a0e' },
  spikes: { plate: '#141a26', metal: ['#2a3a48', '#5a7a90', '#9ac0d0', '#e8f8ff'] },
  pots: ['#2a5068', '#2e3a66'],
  paintFloorDecor: floorDecor,
  paintWallDecor: wallDecor,
  paintBlock,
  paintPot,
});
