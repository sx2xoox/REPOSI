// Painting helpers shared by the floor themes: cracks, cobwebs, bones, stains,
// puddles, moss, snow drifts, runes and glowing fissures. All work in room pixel
// coordinates on the background PixelPainter.

import type { PixelPainter } from '../../engine/painter';
import { darken, lighten } from '../../engine/painter';
import type { RNG } from '../../engine/rng';
import type { Room } from '../../game/room';
import { TILE } from '../../game/constants';
import { addPx, blendPx, fbm, hash2, rampPick, shadePx, vnoise, wallGeo } from '../../game/roomart';

export type FloorTest = (tx: number, ty: number) => boolean;

/** Random floor pixel position (tile is floor), optionally away from the room edges. */
export function randomFloorPx(room: Room, rng: RNG, isFloor: FloorTest, inset = 6): { x: number; y: number } | null {
  const g = wallGeo(room);
  for (let i = 0; i < 40; i++) {
    const x = rng.range(g.X0 + inset, g.X1 - inset);
    const y = rng.range(g.Y0 + inset, g.Y1 - inset);
    if (isFloor(Math.floor(x / TILE), Math.floor(y / TILE))) return { x, y };
  }
  return null;
}

/** Is a pixel on plain floor (not pit / wall)? */
export function floorPx(isFloor: FloorTest, x: number, y: number): boolean {
  return isFloor(Math.floor(x / TILE), Math.floor(y / TILE));
}

/** Meandering crack with a lit lower edge. */
export function crack(p: PixelPainter, isFloor: FloorTest, x: number, y: number, len: number, rng: RNG, dark: string, lit?: string, branch = true): void {
  let a = rng.angle();
  for (let i = 0; i < len; i++) {
    if (!floorPx(isFloor, x, y)) return;
    p.px(x, y, dark);
    if (lit) blendPx(p, x + 1, y + 1, lit, 0.35);
    a += rng.range(-0.6, 0.6);
    x += Math.cos(a);
    y += Math.sin(a) * 0.8;
    if (branch && i > 3 && rng.chance(0.08)) crack(p, isFloor, x, y, Math.floor(len / 3), rng, dark, lit, false);
  }
}

/** Glowing fissure (lava / void) with a hot core, a dim halo and dark rims. */
export function glowCrack(p: PixelPainter, isFloor: FloorTest, x: number, y: number, len: number, rng: RNG, r: string[], width = 1): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  let a = rng.angle();
  for (let i = 0; i < len; i++) {
    if (!floorPx(isFloor, x, y)) break;
    pts.push({ x, y });
    a += rng.range(-0.5, 0.5);
    x += Math.cos(a);
    y += Math.sin(a) * 0.75;
  }
  // halo first, then rims, then core
  for (const q of pts) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const d = Math.abs(dx) + Math.abs(dy);
    if (d >= 2 && d <= 3) blendPx(p, q.x + dx, q.y + dy, r[0], 0.25);
  }
  for (const q of pts) {
    shadePx(p, q.x - 1, q.y, 0.5);
    shadePx(p, q.x, q.y - 1, 0.5);
  }
  pts.forEach((q, i) => {
    const t = Math.min(i, pts.length - 1 - i) / Math.max(1, pts.length / 2);
    p.px(q.x, q.y, rampPick(r, 1 + t * 3 + (hash2(i, 3) - 0.5), q.x, q.y));
    if (width > 1 && t > 0.35) p.px(q.x + 1, q.y, r[1]);
  });
  return pts;
}

/** Translucent cobweb anchored in a corner; (sx, sy) point away from the corner. */
export function cobweb(p: PixelPainter, cx: number, cy: number, sx: number, sy: number, size: number, color = '#c8c8d8', alpha = 0.55): void {
  const strands = 5;
  const ends: { x: number; y: number }[][] = [];
  for (let i = 0; i < strands; i++) {
    const a = (i / (strands - 1)) * (Math.PI / 2);
    const dx = Math.cos(a) * sx;
    const dy = Math.sin(a) * sy;
    const line: { x: number; y: number }[] = [];
    for (let r = 0; r <= size; r += 0.5) {
      const x = cx + dx * r;
      const y = cy + dy * r;
      blendPx(p, x, y, color, alpha);
      line.push({ x, y });
    }
    ends.push(line);
  }
  for (const k of [0.35, 0.65, 0.95]) {
    for (let i = 0; i < strands - 1; i++) {
      const A = ends[i][Math.floor((ends[i].length - 1) * k)];
      const B = ends[i + 1][Math.floor((ends[i + 1].length - 1) * k)];
      for (let s = 0; s <= 1; s += 0.12) {
        const sag = Math.sin(s * Math.PI) * 1.2;
        blendPx(p, A.x + (B.x - A.x) * s - sx * sag * 0.5, A.y + (B.y - A.y) * s - sy * sag * 0.5, color, alpha * 0.8);
      }
    }
  }
}

/** A scatter of small bones, sometimes with a skull. */
export function bones(p: PixelPainter, isFloor: FloorTest, x: number, y: number, rng: RNG, c: string[] = ['#5a5446', '#a8a08a', '#e0d8c4']): void {
  const n = rng.int(2, 4);
  for (let i = 0; i < n; i++) {
    const bx = Math.round(x + rng.range(-6, 6));
    const by = Math.round(y + rng.range(-4, 4));
    if (!floorPx(isFloor, bx, by)) continue;
    const len = rng.int(3, 6);
    const horiz = rng.chance(0.6);
    for (let k = 0; k < len; k++) {
      const px = horiz ? bx + k : bx + Math.floor(k / 2);
      const py = horiz ? by + (k === Math.floor(len / 2) && rng.chance(0.3) ? 1 : 0) : by + k;
      shadePx(p, px + 1, py + 1, 0.4);
      p.px(px, py, c[1]);
    }
    // knobs
    const ex = horiz ? bx + len - 1 : bx + Math.floor((len - 1) / 2);
    const ey = horiz ? by : by + len - 1;
    p.px(bx, by - 1, c[2]);
    p.px(ex, ey + 1, c[0]);
    p.px(bx - (horiz ? 1 : 0), by, c[2]);
  }
  if (rng.chance(0.4)) skull(p, Math.round(x + rng.range(-5, 5)), Math.round(y + rng.range(-3, 3)), c);
}

export function skull(p: PixelPainter, x: number, y: number, c: string[] = ['#5a5446', '#a8a08a', '#e0d8c4']): void {
  // 5x5 skull, lit from top-left
  for (let dy = 0; dy < 5; dy++) for (let dx = -2; dx <= 3; dx++) shadePx(p, x + dx + 1, y + dy + 1, 0.3);
  const rows = ['.xxx.', 'xhxxx', 'xoxox', '.xxx.', '.x.x.'];
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < 5; dx++) {
      const ch = row[dx];
      if (ch === '.') continue;
      p.px(x + dx - 2, y + dy, ch === 'o' ? '#140c10' : ch === 'h' ? c[2] : dy >= 3 ? c[0] : c[1]);
    }
  });
}

/** Irregular darkening blob (old stains, soot, wet spots). */
export function stain(p: PixelPainter, isFloor: FloorTest, cx: number, cy: number, r: number, k: number, seed: number, tint?: string): void {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r * 1.4); x <= cx + r * 1.4; x++) {
      if (!floorPx(isFloor, x, y)) continue;
      const d = Math.hypot((x - cx) / 1.4, y - cy) / r;
      const n = fbm(x / 5, y / 5, seed, 2);
      const v = 1 - d + (n - 0.5) * 0.9;
      if (v <= 0) continue;
      if (tint) blendPx(p, x, y, tint, Math.min(1, v) * k);
      else shadePx(p, x, y, Math.min(1, v * 1.5) * k);
    }
  }
}

/** Puddle of water: dark body, lighter rim, sky-light streaks. */
export function puddle(p: PixelPainter, isFloor: FloorTest, cx: number, cy: number, rx: number, ry: number, c: string[], seed: number): void {
  for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) {
    for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      if (!floorPx(isFloor, x, y)) continue;
      const n = vnoise(x / 4, y / 3, seed);
      const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry) + (n - 0.5) * 0.45;
      if (d > 1) continue;
      let col = d > 0.82 ? c[1] : c[0];
      if (d <= 0.82 && (x + y * 2 + seed) % 9 === 0 && y < cy) col = c[2];
      if (d <= 0.82 && y === Math.round(cy - ry * 0.4) && Math.abs(x - cx + rx * 0.2) < rx * 0.35) col = c[2];
      p.px(x, y, col);
    }
  }
}

/** Moss / lichen patch with a lighter top edge. */
export function moss(p: PixelPainter, isFloor: FloorTest, cx: number, cy: number, r: number, c: string[], seed: number): void {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r * 1.5); x <= cx + r * 1.5; x++) {
      if (!floorPx(isFloor, x, y)) continue;
      const n = fbm(x / 4, y / 4, seed, 2);
      const v = 1 - Math.hypot((x - cx) / 1.5, y - cy) / r + (n - 0.5) * 1.1;
      if (v <= 0.15) continue;
      if (v < 0.3 && hash2(x, y, seed) < 0.5) continue;
      const top = !(1 - Math.hypot((x - cx) / 1.5, y - 1 - cy) / r + (fbm(x / 4, (y - 1) / 4, seed, 2) - 0.5) * 1.1 > 0.15);
      p.px(x, y, top ? c[2] : rampPick(c, 0.3 + v * 1.6, x, y));
    }
  }
}

/** Snow banked up along the floor edges (thicker in corners). */
export function snowDrifts(p: PixelPainter, room: Room, isFloor: FloorTest, c: string[], seed: number): void {
  const g = wallGeo(room);
  for (let y = g.Y0; y < g.Y1; y++) {
    for (let x = g.X0; x < g.X1; x++) {
      if (!floorPx(isFloor, x, y)) continue;
      const dl = x - g.X0;
      const dr = g.X1 - 1 - x;
      const dt = y - g.Y0;
      const db = g.Y1 - 1 - y;
      const corner = Math.min(dl, dr) < 18 && Math.min(dt, db) < 18 ? 4 : 0;
      const depth = 3 + corner + vnoise(x / 9, y / 9, seed) * 7;
      const d = Math.min(dl * 1.2, dr * 1.2, dt * 0.9, db * 1.5);
      if (d > depth) continue;
      const k = 1 - d / depth;
      p.px(x, y, rampPick(c, k * 3 + (hash2(x, y, seed) - 0.5) * 0.6, x, y));
    }
  }
}

/** Arcane circle with glyph ticks. */
export function rune(p: PixelPainter, cx: number, cy: number, r: number, color: string, alpha = 0.6, seed = 0): void {
  for (let a = 0; a < Math.PI * 2; a += 0.6 / r) {
    blendPx(p, cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.6, color, alpha);
    blendPx(p, cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2) * 0.6, color, alpha * 0.6);
  }
  const n = 5 + (seed % 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed;
    const x0 = cx + Math.cos(a) * (r - 4);
    const y0 = cy + Math.sin(a) * (r - 4) * 0.6;
    const x1 = cx + Math.cos(a + 2.2) * (r - 4);
    const y1 = cy + Math.sin(a + 2.2) * (r - 4) * 0.6;
    for (let s = 0; s <= 1; s += 0.08) blendPx(p, x0 + (x1 - x0) * s, y0 + (y1 - y0) * s, color, alpha * 0.7);
  }
}

/** Bright additive speckles (glints, crystals). */
export function sparkles(p: PixelPainter, isFloor: FloorTest, room: Room, rng: RNG, n: number, color: string, a = 0.5): void {
  for (let i = 0; i < n; i++) {
    const q = randomFloorPx(room, rng, isFloor, 2);
    if (!q) continue;
    addPx(p, q.x, q.y, color, a);
  }
}

/** Darken + lighten a rectangle edge to make a recessed panel (niche) on a wall. */
export function niche(p: PixelPainter, x: number, y: number, w: number, h: number, inner: string, rim: string, rimDark: string): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      // arched top
      const ax = xx + 0.5 - (x + w / 2);
      const top = y + w / 2;
      if (yy < top && ax * ax + (yy + 0.5 - top) * (yy + 0.5 - top) > (w / 2) * (w / 2)) continue;
      p.px(xx, yy, inner);
    }
  }
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x - 1; xx <= x + w; xx++) {
      const isIn = (X: number, Y: number) => {
        if (X < x || X >= x + w || Y < y || Y >= y + h) return false;
        const ax = X + 0.5 - (x + w / 2);
        const top = y + w / 2;
        return !(Y < top && ax * ax + (Y + 0.5 - top) * (Y + 0.5 - top) > (w / 2) * (w / 2));
      };
      if (isIn(xx, yy)) continue;
      if (isIn(xx + 1, yy) || isIn(xx, yy + 1)) p.px(xx, yy, rimDark);
      else if (isIn(xx - 1, yy) || isIn(xx, yy - 1)) p.px(xx, yy, rim);
    }
  }
  for (let xx = x; xx < x + w; xx++) p.px(xx, y + h, rim);
}

export interface Worley {
  /** distance to the nearest / second nearest feature point */
  d1: number;
  d2: number;
  /** stable id of the nearest cell */
  id: number;
  /** nearest feature point */
  fx: number;
  fy: number;
}

const featureCache = new Map<string, Float64Array>();
function features(cw: number, ch: number, seed: number): Float64Array {
  const key = `${cw}:${ch}:${seed}`;
  let f = featureCache.get(key);
  if (!f) {
    // feature points for a 256x256 cell window (wraps), 3 values per cell: x, y, id
    f = new Float64Array(256 * 256 * 3);
    for (let cy = 0; cy < 256; cy++) {
      for (let cx = 0; cx < 256; cx++) {
        const i = (cy * 256 + cx) * 3;
        f[i] = (0.15 + hash2(cx, cy, seed) * 0.7) * cw;
        f[i + 1] = (0.15 + hash2(cx, cy, seed + 1) * 0.7) * ch;
        f[i + 2] = hash2(cx, cy, seed + 2);
      }
    }
    featureCache.set(key, f);
  }
  return f;
}

/** Cellular (Worley) noise on a jittered grid of `cw` x `ch` cells. */
export function worley(x: number, y: number, cw: number, ch: number, seed: number, out: Worley = { d1: 0, d2: 0, id: 0, fx: 0, fy: 0 }): Worley {
  const f = features(cw, ch, seed);
  const gx = Math.floor(x / cw);
  const gy = Math.floor(y / ch);
  let d1 = 1e9;
  let d2 = 1e9;
  for (let j = -1; j <= 1; j++) {
    const cy = gy + j;
    const row = ((cy & 255) * 256) * 3;
    for (let i = -1; i <= 1; i++) {
      const cx = gx + i;
      const k = row + (cx & 255) * 3;
      const px = cx * cw + f[k];
      const py = cy * ch + f[k + 1];
      const dx = x - px;
      const dy = y - py;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        out.id = f[k + 2];
        out.fx = px;
        out.fy = py;
      } else if (d < d2) d2 = d;
    }
  }
  out.d1 = d1;
  out.d2 = d2;
  return out;
}

export { darken, lighten, shadePx, blendPx, addPx, hash2, vnoise, fbm, rampPick };
