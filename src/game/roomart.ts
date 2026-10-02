// Room background art: Isaac-style perspective "box" walls (tall top face, slanted
// side faces, a short bottom lip, mitred corners), themed floors with edge shadows,
// auto-tiled pits (chasm / lava / water / ice / void), obstacles with cast shadows
// and kind-specific door frames.
//
// Themes describe their look with `defineThemeArt(themeId, art)` (see ThemeArt) in
// addition to the gameplay-facing ThemeDef. Everything is painted with PixelPainter
// into a cached canvas: the static base (walls / floor / pits) is cached per room and
// obstacles (rocks, pots, spikes ...) are re-composited when tiles change.

import { TILE } from './constants';
import { Tile } from './tiles';
import type { Room, Door, DoorKind } from './room';
import type { ThemeDef, ThemePalette } from './defs';
import type { Renderer } from '../engine/renderer';
import { RNG } from '../engine/rng';
import { PixelPainter, bayer, darken, lighten, packColor, ramp } from '../engine/painter';
import { defineDrawnSprite, hasSprite } from '../engine/sprites';
import { clamp, hexToRgb } from '../engine/math';

// ======================================================================
// Theme art registry
// ======================================================================

export type WallKind = 'brick' | 'rough' | 'plate' | 'ice' | 'void';
export type PitKind = 'chasm' | 'lava' | 'water' | 'ice' | 'void';

export interface DoorLook {
  /** frame ramp dark -> light (4 colors) */
  frame: string[];
  /** closing panel base color */
  leaf: string;
  /** metal bands / studs */
  metal: string;
  /** passage darkness */
  inner: string;
}

export interface WallGeo {
  /** room size in px */
  W: number;
  H: number;
  /** floor rect (X1 / Y1 exclusive) */
  X0: number;
  Y0: number;
  X1: number;
  Y1: number;
  /** visible face depth of the top / side / bottom walls in px */
  DT: number;
  DS: number;
  DB: number;
  /** rim rect (where the faces meet the wall tops) */
  RX0: number;
  RY0: number;
  RX1: number;
  RY1: number;
}

export type Face = 'top' | 'left' | 'right' | 'bottom';

export interface ThemeArt {
  /** wall face texture style */
  wall: WallKind;
  /** wall face ramp, dark -> light (5 colors) */
  face: string[];
  /** wall top (cap) ramp, dark -> light (4 colors) */
  cap: string[];
  /** mortar / seam color */
  mortar: string;
  /** moss / rust / frost accents growing near the wall base (ramp, 3 colors) */
  growth?: string[];
  /** emissive color used by the style (forge heat seams, abyss void veins) */
  glow?: string;
  pit: PitKind;
  /** pit ramp, darkest -> lighter (4 colors); defaults from the palette */
  pitRamp?: string[];
  /** look of normal doors on this floor */
  door?: Partial<DoorLook>;
  /** spike trap colors */
  spikes?: { plate: string; metal: string[] };
  /** metal block ramp (5 colors) */
  block?: string[];
  /** pot body colors per variant (2) */
  pots?: string[];
  /** large-scale floor detail painted after the per-tile floor (stains, cracks, moss ...) */
  paintFloorDecor?(p: PixelPainter, room: Room, rng: RNG, isFloor: (tx: number, ty: number) => boolean): void;
  /** detail painted on top of the walls (niches, roots, icicles ...) */
  paintWallDecor?(p: PixelPainter, room: Room, rng: RNG, g: WallGeo): void;
  /** custom pot sprite (16x18, base at the bottom row) */
  paintPot?(p: PixelPainter, variant: number): void;
  /** custom metal block sprite (16x18) */
  paintBlock?(p: PixelPainter): void;
}

const artMap = new Map<string, ThemeArt>();

export function defineThemeArt(themeId: string, art: ThemeArt): ThemeArt {
  artMap.set(themeId, art);
  return art;
}

const derived = new Map<string, ThemeArt>();
export function themeArt(theme: ThemeDef): ThemeArt {
  const a = artMap.get(theme.id);
  if (a) return a;
  let d = derived.get(theme.id);
  if (!d) {
    const pal = theme.palette;
    d = {
      wall: 'brick',
      face: ramp(pal.wall[2] ?? pal.wall[0], 5),
      cap: [pal.dark, pal.wall[0], pal.wall[1], pal.wall[2] ?? pal.wall[1]],
      mortar: pal.wall[0],
      growth: pal.accent,
      pit: 'chasm',
    };
    derived.set(theme.id, d);
  }
  return d;
}

// ======================================================================
// Pixel helpers (exported for theme painters)
// ======================================================================

export function hash2(x: number, y: number, s = 0): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s + 40503, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) * 2.3283064365386963e-10;
}

/** Smooth value noise in [0,1). */
export function vnoise(x: number, y: number, s = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s);
  const b = hash2(xi + 1, yi, s);
  const c = hash2(xi, yi + 1, s);
  const d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal value noise in ~[0,1). */
export function fbm(x: number, y: number, s = 0, oct = 3): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x, y, s + i * 101) * amp;
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

const BAYER = new Float32Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16));

/** Pick a ramp color for a fractional shade index with ordered dithering. */
export function rampPick(r: string[], shade: number, x: number, y: number): string {
  const i = Math.floor(shade + BAYER[((y & 3) << 2) | (x & 3)]);
  return r[i < 0 ? 0 : i >= r.length ? r.length - 1 : i];
}

function packRGB(r: number, g: number, b: number): number {
  return ((255 << 24) | (clamp(Math.round(b), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(r), 0, 255)) >>> 0;
}

/** Darken an already painted pixel by k (0..1) with a slight cool shift. */
export function shadePx(p: PixelPainter, x: number, y: number, k: number): void {
  x = Math.floor(x);
  y = Math.floor(y);
  if (!p.inBounds(x, y) || k <= 0) return;
  const i = y * p.w + x;
  const v = p.data[i];
  if (!(v >>> 24)) return;
  const m = 1 - Math.min(1, k);
  p.data[i] = packRGB((v & 255) * m, ((v >>> 8) & 255) * m, ((v >>> 16) & 255) * m + 10 * k);
}

/** Blend an already painted pixel toward `color` by a (0..1). */
export function blendPx(p: PixelPainter, x: number, y: number, color: string, a: number): void {
  x = Math.floor(x);
  y = Math.floor(y);
  if (!p.inBounds(x, y) || a <= 0) return;
  const i = y * p.w + x;
  const v = p.data[i];
  if (!(v >>> 24)) {
    if (a >= 0.5) p.data[i] = packColor(color);
    return;
  }
  const [r, g, b] = hexToRgb(color);
  const k = Math.min(1, a);
  const r0 = v & 255;
  const g0 = (v >>> 8) & 255;
  const b0 = (v >>> 16) & 255;
  p.data[i] = packRGB(r0 + (r - r0) * k, g0 + (g - g0) * k, b0 + (b - b0) * k);
}

/** Additively brighten a pixel with `color` * a. */
export function addPx(p: PixelPainter, x: number, y: number, color: string, a: number): void {
  x = Math.floor(x);
  y = Math.floor(y);
  if (!p.inBounds(x, y) || a <= 0) return;
  const i = y * p.w + x;
  const v = p.data[i];
  const [r, g, b] = hexToRgb(color);
  p.data[i] = packRGB((v & 255) + r * a, ((v >>> 8) & 255) + g * a, ((v >>> 16) & 255) + b * a);
}

/** Darken pixels inside an ellipse (soft shadow with a dithered rim). */
export function shadowEllipse(p: PixelPainter, cx: number, cy: number, rx: number, ry: number, k: number): void {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      const edge = d > 0.6 ? (bayer(x, y) < 0.5 ? 0.5 : 0) : 1;
      if (edge > 0) shadePx(p, x, y, k * edge);
    }
  }
}

// ======================================================================
// Geometry
// ======================================================================

export const FACE_TOP = 24;
export const FACE_SIDE = 13;
export const FACE_BOTTOM = 9;
/** texture height of a wall face (px of "brick space") */
const FH = 24;

export function wallGeo(room: { pxW: number; pxH: number }): WallGeo {
  const W = room.pxW;
  const H = room.pxH;
  const X0 = 2 * TILE;
  const Y0 = 2 * TILE;
  const X1 = W - 2 * TILE;
  const Y1 = H - 2 * TILE;
  return {
    W, H, X0, Y0, X1, Y1, DT: FACE_TOP, DS: FACE_SIDE, DB: FACE_BOTTOM,
    RX0: X0 - FACE_SIDE, RY0: Y0 - FACE_TOP, RX1: X1 + FACE_SIDE, RY1: Y1 + FACE_BOTTOM,
  };
}

/**
 * Screen point on a wall face. `along` is the floor-space coordinate along the wall
 * (x for top/bottom, y for left/right), `t` the height fraction (0 = floor, 1 = rim).
 */
export function facePoint(g: WallGeo, face: Face, along: number, t: number): { x: number; y: number } {
  switch (face) {
    case 'top': {
      const x0 = g.X0 - t * g.DS;
      const x1 = g.X1 + t * g.DS;
      return { x: x0 + ((along - g.X0) / (g.X1 - g.X0)) * (x1 - x0), y: g.Y0 - t * g.DT };
    }
    case 'bottom': {
      const x0 = g.X0 - t * g.DS;
      const x1 = g.X1 + t * g.DS;
      return { x: x0 + ((along - g.X0) / (g.X1 - g.X0)) * (x1 - x0), y: g.Y1 + t * g.DB };
    }
    case 'left':
    case 'right': {
      const y0 = g.Y0 - t * g.DT;
      const y1 = g.Y1 + t * g.DB;
      const y = y0 + ((along - g.Y0) / (g.Y1 - g.Y0)) * (y1 - y0);
      return { x: face === 'left' ? g.X0 - t * g.DS : g.X1 + t * g.DS, y };
    }
  }
}

/** Is a point (floor-space along a face) within `margin` px of a doorway? */
export function nearDoor(room: Room, face: Face, along: number, margin: number): boolean {
  for (const d of room.doors) {
    const f: Face = d.dir === 'N' ? 'top' : d.dir === 'S' ? 'bottom' : d.dir === 'W' ? 'left' : 'right';
    if (f !== face) continue;
    const c = f === 'top' || f === 'bottom' ? d.x : d.y;
    if (Math.abs(c - along) < margin) return true;
  }
  return false;
}

// ======================================================================
// Background
// ======================================================================

interface BaseCache {
  sig: number;
  p: PixelPainter;
}
/**
 * The expensive part of a room background (floor, pits, AO, walls) only depends on
 * the node (seed, theme, door positions) and its pit/wall/door layout, so it is
 * cached per *node*: a Room rebuilt for the same node (pre-render in idle time,
 * re-entering) reuses it.
 */
const baseCache = new WeakMap<object, BaseCache>();

function baseSignature(room: Room): number {
  let h = 2166136261;
  for (let i = 0; i < room.tiles.length; i++) {
    const t = room.tiles[i];
    const v = t === Tile.PIT ? 1 : t === Tile.WALL || t === Tile.DOOR ? 2 : 0;
    h = Math.imul(h ^ (v + i * 3), 16777619);
  }
  return h >>> 0;
}

export function renderRoomBackground(room: Room): HTMLCanvasElement {
  return renderRoomPainter(room).toCanvas();
}

/** Full background (walls, floor, pits, obstacles) as pixels; works without a DOM. */
export function renderRoomPainter(room: Room): PixelPainter {
  const sig = baseSignature(room);
  let base = baseCache.get(room.node);
  if (!base || base.sig !== sig) {
    base = { sig, p: runSteps(buildBaseSteps(room)) };
    baseCache.set(room.node, base);
  }
  const p = new PixelPainter(room.pxW, room.pxH);
  p.data.set(base.p.data);
  paintObstacles(p, room);
  paintHiddenDoorHints(p, room);
  return p;
}

/** Is the expensive background base of this room already cached? */
export function roomBaseReady(room: Room): boolean {
  const base = baseCache.get(room.node);
  return !!base && base.sig === baseSignature(room);
}

/**
 * Time-sliceable pre-render of a room's background base: every `next()` does a
 * small chunk of work (a row of floor tiles, a few rows of wall pixels ...).
 * When done, `renderRoomPainter` for the same node is cheap (~1 ms).
 * Pure function of the room (room-seeded RNGs only; never touches gameplay RNG).
 */
export function* roomBaseJob(room: Room): Generator<void, void, void> {
  const sig = baseSignature(room);
  const cached = baseCache.get(room.node);
  if (cached && cached.sig === sig) return;
  const p = yield* buildBaseSteps(room);
  baseCache.set(room.node, { sig, p });
}

function runSteps<T>(g: Generator<void, T, void>): T {
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

export function hasThemeArt(themeId: string): boolean {
  return artMap.has(themeId);
}

function* buildBaseSteps(room: Room): Generator<void, PixelPainter, void> {
  const p = new PixelPainter(room.pxW, room.pxH);
  const theme = room.theme;
  const art = themeArt(theme);
  const pal = theme.palette;
  const g = wallGeo(room);
  const tileP = new PixelPainter(TILE, TILE);
  const seed = room.node.seed;

  // floor tiles
  for (let ty = 2; ty < room.h - 2; ty++) {
    for (let tx = 2; tx < room.w - 2; tx++) {
      const trng = new RNG((seed * 31 + tx * 977 + ty * 7919) >>> 0);
      tileP.clear();
      if (theme.paintFloor) theme.paintFloor(tileP, tx, ty, trng);
      else paintDefaultFloor(tileP, pal, tx, ty, trng, room.variant[ty * room.w + tx]);
      p.blit(tileP, tx * TILE, ty * TILE);
    }
    yield;
  }
  const isFloor = (tx: number, ty: number) => {
    const t = room.tileAt(tx, ty);
    return t !== Tile.PIT && t !== Tile.WALL && t !== Tile.DOOR;
  };
  art.paintFloorDecor?.(p, room, new RNG(seed ^ 0xf100), isFloor);
  yield;

  // pits
  for (let ty = 2; ty < room.h - 2; ty++) {
    let any = false;
    for (let tx = 2; tx < room.w - 2; tx++) {
      if (room.tileAt(tx, ty) === Tile.PIT) {
        paintPit(p, room, art, pal, tx, ty);
        any = true;
      }
    }
    if (any) yield;
  }

  // ambient occlusion: walls cast soft shadows onto the floor edges
  const topAO = [0.5, 0.4, 0.31, 0.23, 0.16, 0.1, 0.06, 0.03];
  for (let i = 0; i < topAO.length; i++) for (let x = g.X0; x < g.X1; x++) shadePx(p, x, g.Y0 + i, topAO[i]);
  const sideAO = [0.36, 0.24, 0.14, 0.07, 0.03];
  for (let i = 0; i < sideAO.length; i++) {
    for (let y = g.Y0; y < g.Y1; y++) {
      shadePx(p, g.X0 + i, y, sideAO[i] * (1 - Math.max(0, (g.Y0 + 8 - y) / 8) * 0.5));
      shadePx(p, g.X1 - 1 - i, y, sideAO[i] * 0.75);
    }
  }
  const botAO = [0.28, 0.14, 0.05];
  for (let i = 0; i < botAO.length; i++) for (let x = g.X0; x < g.X1; x++) shadePx(p, x, g.Y1 - 1 - i, botAO[i]);
  yield;

  if (theme.paintWall && !artMap.has(theme.id)) paintLegacyWalls(p, room, theme);
  else yield* paintWalls(p, art, g, seed);
  yield;
  art.paintWallDecor?.(p, room, new RNG(seed ^ 0xa11), g);
  return p;
}

/** Themes without ThemeArt but with the per-tile `paintWall` hook keep the flat tile walls. */
function paintLegacyWalls(p: PixelPainter, room: Room, theme: ThemeDef): void {
  const tileP = new PixelPainter(TILE, TILE);
  for (let ty = 0; ty < room.h; ty++) {
    for (let tx = 0; tx < room.w; tx++) {
      const left = tx < 2;
      const right = tx >= room.w - 2;
      const top = ty < 2;
      const bottom = ty >= room.h - 2;
      if (!left && !right && !top && !bottom) continue;
      const face = (left || right) && (top || bottom) ? 'corner' : top ? (ty === 1 ? 'front' : 'top') : bottom ? 'bottom' : 'side';
      tileP.clear();
      theme.paintWall!(tileP, tx, ty, new RNG((room.node.seed * 31 + tx * 977 + ty * 7919) >>> 0), face);
      p.blit(tileP, tx * TILE, ty * TILE);
    }
  }
}

// ---------------------------------------------------------------- walls
interface WallSample {
  /** 0 top, 1 left, 2 right, 3 bottom */
  face: number;
  along: number;
  da: number;
  h: number;
  dh: number;
  t: number;
  x: number;
  y: number;
  shade: number;
  seed: number;
}

const FACE_SHADE = [2.25, 1.45, 2.55, 1.55];

function* paintWalls(p: PixelPainter, art: ThemeArt, g: WallGeo, seed: number): Generator<void, void, void> {
  const s: WallSample = { face: 0, along: 0, da: 1, h: 0, dh: 1, t: 0, x: 0, y: 0, shade: 0, seed: seed & 0xffff };
  const tex = WALL_TEX[art.wall] ?? texBrick;
  const depth = [g.DT, g.DS, g.DS, g.DB];
  for (let y = 0; y < g.H; y++) {
    // time-slice point (pre-rendering); interior rows only touch the side walls
    if ((y & 7) === 7) yield;
    for (let x = 0; x < g.W; x++) {
      if (x >= g.X0 && x < g.X1 && y >= g.Y0 && y < g.Y1) continue;
      const tT = (g.Y0 - 0.5 - y) / g.DT;
      const tL = (g.X0 - 0.5 - x) / g.DS;
      const tR = (x + 0.5 - g.X1) / g.DS;
      const tB = (y + 0.5 - g.Y1) / g.DB;
      let face = 0;
      let t = tT;
      let t2 = -9;
      if (tL > t) { t2 = t; face = 1; t = tL; } else t2 = Math.max(t2, tL);
      if (tR > t) { t2 = t; face = 2; t = tR; } else t2 = Math.max(t2, tR);
      if (tB > t) { t2 = t; face = 3; t = tB; } else t2 = Math.max(t2, tB);
      if (t >= 1) {
        // wall top (cap)
        const edge = (t - 1) * depth[face];
        let c: string;
        if (x === 0 || y === 0 || x === g.W - 1 || y === g.H - 1) c = art.mortar;
        else if (edge < 1) c = art.cap[3];
        else if (edge < 2) c = art.cap[2];
        else c = capColor(art, x, y, edge, s.seed);
        // corner seams on the caps (box edges)
        if (t2 >= 1 && Math.abs(t - t2) * Math.min(depth[face], 13) < 0.6) c = art.cap[0];
        p.px(x, y, c);
        continue;
      }
      s.face = face;
      s.t = t;
      s.x = x;
      s.y = y;
      s.h = t * FH;
      s.dh = FH / depth[face];
      if (face === 0 || face === 3) {
        const span = g.X1 - g.X0 + 2 * t * g.DS;
        s.along = g.X0 + ((x + 0.5 - (g.X0 - t * g.DS)) / span) * (g.X1 - g.X0);
        s.da = (g.X1 - g.X0) / span;
      } else {
        const y0 = g.Y0 - t * g.DT;
        const span = g.Y1 + t * g.DB - y0;
        s.along = g.Y0 + ((y + 0.5 - y0) / span) * (g.Y1 - g.Y0);
        s.da = (g.Y1 - g.Y0) / span;
      }
      let sh = FACE_SHADE[face];
      if (t < 0.22) sh -= (0.22 - t) * 5.5; // contact shadow at the base
      if (t > 0.8) sh += (t - 0.8) * 2.5;
      s.shade = sh;
      let c = tex(art, s);
      // concave corner seam
      if (t2 > 0 && (t - t2) * Math.min(depth[face], 13) < 0.7) c = darken(art.mortar, 0.25);
      // rim highlight (top edge of every face)
      else if ((1 - t) * depth[face] < 1) c = art.face[4];
      p.px(x, y, c);
    }
  }
}

type WallTex = (a: ThemeArt, s: WallSample) => string;

function growthAt(a: ThemeArt, s: WallSample, maxH: number, scale = 5): string | null {
  if (!a.growth || s.h > maxH) return null;
  const n = vnoise(s.along / scale, s.h / 3, s.seed + 11 + s.face) - s.h / (maxH * 3.2);
  if (n <= 0.5) return null;
  return rampPick(a.growth, (n - 0.5) * 9, s.x, s.y);
}

function texBrick(a: ThemeArt, s: WallSample): string {
  const CH = s.face === 3 ? 8 : 6;
  const LEN = 16;
  const course = Math.floor(s.h / CH);
  const inC = s.h - course * CH;
  const off = (course & 1 ? LEN / 2 : 0) + (s.face === 1 || s.face === 2 ? 5 : 0);
  const u = s.along + off;
  const bi = Math.floor(u / LEN);
  const inB = u - bi * LEN;
  const bh = hash2(bi, course, s.seed + s.face * 977);
  const g = growthAt(a, s, 9);
  if (inC < s.dh * 0.999 || inB < s.da * 0.999) {
    if (g && hash2(s.x, s.y, 5) < 0.6) return g;
    return hash2(s.x, s.y, 7) < 0.07 ? a.face[1] : a.mortar;
  }
  if (g) return g;
  // cracked / chipped bricks
  if (bh < 0.09 && Math.abs(inB - 3 - inC * 1.5) < 0.75 * Math.max(1, s.da)) return a.mortar;
  if (bh > 0.93 && inB > LEN - 5 && inC > CH - 3) return a.face[0];
  let sh = s.shade + (bh - 0.5) * 1.0;
  if (inC >= CH - s.dh) sh += 0.95;
  else if (inC < s.dh * 2) sh -= 0.5;
  if (inB < s.da * 2) sh += 0.35;
  else if (inB > LEN - s.da * 1.5) sh -= 0.35;
  sh += (hash2(s.x, s.y, 3) - 0.5) * 0.7;
  return rampPick(a.face, sh, s.x, s.y);
}

function texRough(a: ThemeArt, s: WallSample): string {
  const warp = vnoise(s.along / 16, s.face * 7.3, s.seed) * 7;
  const L = Math.floor((s.h + warp) / 7);
  const Lp = Math.floor((s.h - s.dh + warp) / 7);
  const g = growthAt(a, s, 11, 6);
  if (g) return g;
  if (L !== Lp && hash2(Math.floor(s.along / 5), L, s.seed) > 0.3) return a.mortar;
  const lh = hash2(L, Math.floor((s.along + L * 13) / 26), s.seed + 5);
  let sh = s.shade + (lh - 0.5) * 1.1;
  const b1 = vnoise(s.along / 4.5, s.h / 3.2, s.seed + 9);
  const b2 = vnoise((s.along - s.da) / 4.5, (s.h + s.dh) / 3.2, s.seed + 9);
  sh += (b1 - 0.5) * 1.2 + (b1 - b2) * 5;
  const fc = Math.floor(s.along / 11);
  const fxp = fc * 11 + hash2(fc, 3, s.seed) * 11;
  if (hash2(fc, L, s.seed + 2) < 0.24 && Math.abs(s.along - fxp) < s.da * 0.8) return a.mortar;
  if (hash2(Math.floor(s.along), 9, s.seed) < 0.05 && s.h > 8) sh += 1.1; // wet streaks
  sh += (hash2(s.x, s.y, 3) - 0.5) * 0.5;
  return rampPick(a.face, sh, s.x, s.y);
}

function texPlate(a: ThemeArt, s: WallSample): string {
  const PH = s.face === 3 ? 24 : 12;
  const PL = 28;
  const row = Math.floor(s.h / PH);
  const inR = s.h - row * PH;
  const off = row & 1 ? 14 : 0;
  const u = s.along + off;
  const col = Math.floor(u / PL);
  const inC = u - col * PL;
  const ph = hash2(col, row, s.seed);
  // glowing heat seam right above the floor
  if (a.glow && s.h < 2.2 * s.dh && s.face !== 3) {
    const k = vnoise(s.along / 6, 1, s.seed + 31);
    if (k > 0.42) return rampPick([darken(a.glow, 0.55), darken(a.glow, 0.25), a.glow, lighten(a.glow, 0.4)], (k - 0.42) * 7 + (s.h < s.dh ? 1 : 0), s.x, s.y);
  }
  if (inR < s.dh * 0.999 || inC < s.da * 0.999) return a.mortar;
  const rx = [3, PL - 4];
  const ry = [PH - 3, 3];
  for (const cx of rx) {
    for (const cy of ry) {
      const dx = Math.abs(inC - cx);
      const dy = Math.abs(inR - cy);
      if (dx < 0.6 * Math.max(1, s.da) && dy < 0.6 * Math.max(1, s.dh)) return a.face[4];
      if (dx < 1.6 * Math.max(1, s.da) && dy < 1.6 * Math.max(1, s.dh) && inC > cx && inR < cy) return a.face[0];
    }
  }
  // rust streaks dripping from rivets
  if (a.growth && ph < 0.4) {
    const sx = rx[ph < 0.2 ? 0 : 1];
    if (Math.abs(inC - sx) < 1.1 && inR < PH - 4 && vnoise(s.along, s.h / 2, s.seed + 5) > 0.35 - inR / 30) return rampPick(a.growth, 1 + inR / PH, s.x, s.y);
  }
  let sh = s.shade + (ph - 0.5) * 0.9;
  if (inR >= PH - s.dh) sh += 1.1;
  else if (inR < s.dh * 2) sh -= 0.6;
  if (inC < s.da * 2) sh += 0.45;
  else if (inC > PL - s.da * 2) sh -= 0.45;
  sh += (vnoise(s.along / 10, s.h * 1.6, s.seed + 4) - 0.5) * 0.9;
  return rampPick(a.face, sh, s.x, s.y);
}

function texIce(a: ThemeArt, s: WallSample): string {
  const CH = s.face === 3 ? 12 : 8;
  const LEN = 22;
  const course = Math.floor(s.h / CH);
  const inC = s.h - course * CH;
  const off = course & 1 ? 11 : 0;
  const u = s.along + off;
  const bi = Math.floor(u / LEN);
  const inB = u - bi * LEN;
  const bh = hash2(bi, course, s.seed + s.face * 31);
  // snow on the rim
  if (s.t > 0.86) {
    const n = vnoise(s.along / 3, 2, s.seed + 3);
    if (s.t > 0.94 - n * 0.12) return rampPick(a.face, 3.4 + n, s.x, s.y);
  }
  if (inC < s.dh * 0.999 || inB < s.da * 0.999) return a.mortar;
  let sh = s.shade + (bh - 0.5) * 0.8;
  if (inC >= CH - s.dh) sh += 1.5;
  else if (inC < s.dh * 1.5) sh -= 0.4;
  const d = (inB + inC * 1.35 + bh * 17) % 19;
  if (d < 1.5) sh += 1.7;
  else if (d < 3) sh += 0.8;
  if (bh > 0.82 && Math.abs(inB - 5 - (CH - inC) * 0.9) < 0.6 * Math.max(1, s.da)) return a.face[4];
  const g = growthAt(a, s, 6, 4);
  if (g) return g;
  sh += (hash2(s.x, s.y, 3) - 0.5) * 0.4;
  return rampPick(a.face, sh, s.x, s.y);
}

function texVoid(a: ThemeArt, s: WallSample): string {
  const CH = s.face === 3 ? 12 : 8;
  const course = Math.floor(s.h / CH);
  const inC = s.h - course * CH;
  const LEN = 15;
  const off = hash2(course, 1, s.seed + s.face) * LEN;
  const u = s.along + off;
  const bi = Math.floor(u / LEN);
  const inB = u - bi * LEN;
  const bh = hash2(bi, course, s.seed + s.face * 7);
  // glowing veins
  if (a.glow && vnoise(s.along / 28, s.face * 5.1, s.seed + 3) > 0.52) {
    const n = vnoise(s.along / 9, s.h / 5 + s.face * 3, s.seed + 21);
    if (Math.abs(n - 0.5) < 0.018 * Math.max(1, s.dh)) return a.glow;
    if (Math.abs(n - 0.5) < 0.04 * Math.max(1, s.dh)) return darken(a.glow, 0.55);
  }
  if (bh < 0.05) {
    // missing block: the void shows through
    if (inC < s.dh || inB < s.da) return a.mortar;
    return hash2(s.x, s.y, 13) < 0.04 ? (a.glow ?? '#ffffff') : '#040208';
  }
  if (inC < s.dh * 0.999 || inB < s.da * 0.999) return a.mortar;
  let sh = s.shade + (bh - 0.5) * 0.9;
  if (inC >= CH - s.dh) sh += 1.4;
  else if (inC >= CH - s.dh * 2) sh += 0.5;
  else if (inC < s.dh * 1.5) sh -= 0.5;
  if (inB < s.da * 1.5) sh += 0.4;
  sh += (vnoise(s.along / 3, s.h / 3, s.seed + 7) - 0.5) * 0.8;
  return rampPick(a.face, sh, s.x, s.y);
}

const WALL_TEX: Record<WallKind, WallTex> = { brick: texBrick, rough: texRough, plate: texPlate, ice: texIce, void: texVoid };

function capColor(a: ThemeArt, x: number, y: number, edge: number, seed: number): string {
  const c = a.cap;
  switch (a.wall) {
    case 'brick': {
      // rough flagstones on top of the wall
      const sx = Math.floor((x + (Math.floor(y / 6) & 1) * 5) / 10);
      const sy = Math.floor(y / 6);
      const lx = (x + (Math.floor(y / 6) & 1) * 5) - sx * 10;
      const ly = y - sy * 6;
      if (lx === 0 || ly === 0) return c[0];
      const h = hash2(sx, sy, seed);
      return rampPick(c, 1 + (h - 0.5) * 1.1 + (ly === 1 ? 0.6 : 0) + (hash2(x, y, 1) - 0.5) * 0.6 - (edge > 10 ? 0.3 : 0), x, y);
    }
    case 'rough': {
      const n = fbm(x / 9, y / 9, seed, 3);
      const n2 = fbm((x - 1) / 9, (y - 1) / 9, seed, 3);
      return rampPick(c, 0.8 + (n - 0.5) * 2 + (n - n2) * 9, x, y);
    }
    case 'plate': {
      if (((x + y) & 3) === 0 && ((x - y) & 7) === 0) return c[2];
      const n = vnoise(x / 6, y / 6, seed);
      return rampPick(c, 0.7 + (n - 0.5) * 1.2, x, y);
    }
    case 'ice': {
      const n = fbm(x / 7, y / 5, seed, 2);
      if (hash2(x, y, 9) < 0.012) return '#ffffff';
      return rampPick(c, 1.2 + (n - 0.5) * 2.4, x, y);
    }
    case 'void': {
      if (hash2(x, y, 17) < 0.008) return a.glow ?? c[3];
      const n = fbm(x / 10, y / 10, seed, 3);
      return rampPick(c, 0.5 + (n - 0.5) * 2, x, y);
    }
  }
}

// ---------------------------------------------------------------- floor
export function paintDefaultFloor(p: PixelPainter, pal: { floor: string[]; accent: string[]; dark: string }, tx: number, ty: number, rng: RNG, v: number): void {
  const f = pal.floor;
  const base = f[Math.min(f.length - 1, 2)];
  p.rect(0, 0, TILE, TILE, base);
  const slabX = tx % 2 === 0;
  const slabY = ty % 2 === 0;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const n = rng.next();
      if (n < 0.08) p.px(x, y, f[1]);
      else if (n < 0.12) p.px(x, y, f[3] ?? f[2]);
    }
  }
  if (slabX) for (let y = 0; y < TILE; y++) p.px(0, y, f[0]);
  if (slabY) for (let x = 0; x < TILE; x++) p.px(x, 0, f[0]);
  if (slabX) for (let y = 1; y < TILE; y++) p.px(1, y, f[3] ?? f[2]);
  if (slabY) for (let x = 1; x < TILE; x++) p.px(x, 1, f[3] ?? f[2]);
  if (v < 26) {
    let x = rng.int(3, 12);
    let y = rng.int(3, 12);
    for (let i = 0; i < 6; i++) {
      p.px(x, y, f[0]);
      x += rng.int(-1, 1);
      y += rng.int(0, 1);
    }
  } else if (v < 40) {
    const x = rng.int(3, 12);
    const y = rng.int(3, 12);
    p.px(x, y, pal.accent[1] ?? pal.accent[0]);
    p.px(x + 1, y, pal.accent[0]);
    p.px(x, y + 1, f[0]);
  }
}

// ---------------------------------------------------------------- pits
function defaultPitRamp(art: ThemeArt, pal: ThemePalette): string[] {
  if (art.pitRamp) return art.pitRamp;
  switch (art.pit) {
    case 'lava': return ['#5a0a04', '#b8280a', '#f0700a', '#ffd040'];
    case 'water': return ['#041418', '#0a2a30', '#14444a', '#3a8a8a'];
    case 'ice': return ['#040a1c', '#0c1c3a', '#1a3a6a', '#4a8ac8'];
    case 'void': return ['#020104', '#0c0618', '#24103e', '#7a3ac8'];
    default: return [pal.pit, darken(pal.floor[0], 0.6), darken(pal.floor[0], 0.35), pal.floor[0]];
  }
}

function paintPit(p: PixelPainter, room: Room, art: ThemeArt, pal: ThemePalette, tx: number, ty: number): void {
  const isPit = (x: number, y: number) => room.tileAt(x, y) === Tile.PIT;
  const n = !isPit(tx, ty - 1);
  const s = !isPit(tx, ty + 1);
  const w = !isPit(tx - 1, ty);
  const e = !isPit(tx + 1, ty);
  const nw = !isPit(tx - 1, ty - 1);
  const ne = !isPit(tx + 1, ty - 1);
  const pr = defaultPitRamp(art, pal);
  const f = pal.floor;
  const px0 = tx * TILE;
  const py0 = ty * TILE;
  const seed = room.node.seed & 0xffff;
  const CLIFF = art.pit === 'lava' || art.pit === 'water' ? 4 : 6;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const X = px0 + x;
      const Y = py0 + y;
      // distance to open (floor) edges -> depth
      let d = 9;
      if (n) d = Math.min(d, y - CLIFF);
      if (w) d = Math.min(d, x);
      if (e) d = Math.min(d, TILE - 1 - x);
      if (s) d = Math.min(d, TILE - 1 - y + 2);
      if (nw && !n && !w) d = Math.min(d, Math.max(x, y));
      if (ne && !n && !e) d = Math.min(d, Math.max(TILE - 1 - x, y));
      let c: string;
      switch (art.pit) {
        case 'lava': {
          const fl = fbm(X / 11, Y / 7, seed, 3);
          const vein = Math.abs(vnoise(X / 7, Y / 5, seed + 9) - 0.5);
          let sh = 1.2 + (fl - 0.5) * 2.4 + (vein < 0.06 ? 1.6 : 0);
          if (d < 2) sh -= (2 - d) * 0.9; // cooler crust at the rim
          c = rampPick(pr, sh, X, Y);
          if (d < 1) c = darken(pr[0], 0.3);
          break;
        }
        case 'water': {
          const wave = Math.sin(X * 0.45 + Math.sin(Y * 0.7) * 2 + seed) + Math.sin(Y * 1.3 + X * 0.15);
          let sh = 1.15 + (wave > 1.5 ? 1.4 : wave > 1.1 ? 0.7 : 0) + (fbm(X / 14, Y / 10, seed, 2) - 0.5);
          if (d < 1) sh = 3.2; // foam line
          else if (d < 2.5) sh += 0.6;
          c = rampPick(pr, sh, X, Y);
          break;
        }
        case 'void': {
          let sh = 0.6 - Math.min(d, 6) * 0.12 + (fbm(X / 12, Y / 12, seed, 3) - 0.5) * 1.6;
          if (d < 1) sh = 3.3;
          else if (d < 3) sh = Math.max(sh, 2.4 - d * 0.6);
          c = rampPick(pr, sh, X, Y);
          if (d > 2 && hash2(X, Y, 23) < 0.012) c = hash2(X, Y, 29) < 0.5 ? '#e0c0ff' : '#8a6ad0';
          break;
        }
        case 'ice': {
          let sh = 2.2 - Math.min(d, 7) * 0.33 + (vnoise(X / 5, Y / 9, seed) - 0.5) * 0.8;
          if (d < 1) sh = 3.4;
          c = rampPick(pr, sh, X, Y);
          break;
        }
        default: {
          const sh = 2.4 - Math.min(d, 6) * 0.45 + (hash2(X, Y, 5) - 0.5) * 0.4;
          c = rampPick(pr, sh, X, Y);
        }
      }
      // cliff face below a floor tile (the floor's thickness)
      if (n && y < CLIFF) {
        const k = y / CLIFF;
        if (y === 0) c = f[3] ?? f[2];
        else if (art.pit === 'lava') c = rampPick(['#1a0a08', '#3a1610', '#7a2a10', '#d05a10'], 0.4 + k * 2.6 + (hash2(X, 1, seed) - 0.5) * 0.6, X, Y);
        else if (art.pit === 'ice') c = rampPick(['#2a4a7a', '#4a7ab0', '#8ac0e8', '#d8f0ff'], 3 - k * 2.6 + ((X + y) % 7 === 0 ? 1 : 0), X, Y);
        else if (art.pit === 'void') c = rampPick([pr[0], pr[1], darken(f[1], 0.3), f[1]], 3 - k * 3.2, X, Y);
        else {
          const strata = (y === 2 || y === 4) && hash2(X >> 1, y, seed) < 0.7;
          c = strata ? darken(f[0], 0.45) : rampPick([pr[0], darken(f[0], 0.4), f[0], f[1]], 3 - k * 3 + (hash2(X, Y, 3) - 0.5) * 0.8, X, Y);
        }
      }
      p.px(X, Y, c);
    }
  }
  // lips where the floor ends (left / right / bottom edges)
  const lip = f[3] ?? f[2];
  const glowLip = art.pit === 'void' ? (art.glow ?? '#a060ff') : art.pit === 'lava' ? '#ffb040' : null;
  if (w) for (let y = n ? 1 : 0; y < TILE; y++) p.px(px0, py0 + y, glowLip && y > CLIFF ? darken(glowLip, 0.2) : f[0]);
  if (e) for (let y = n ? 1 : 0; y < TILE; y++) p.px(px0 + TILE - 1, py0 + y, glowLip && y > CLIFF ? darken(glowLip, 0.3) : f[0]);
  if (s) {
    for (let x = 0; x < TILE; x++) {
      p.px(px0 + x, py0 + TILE - 1, lip);
      if (glowLip) p.px(px0 + x, py0 + TILE - 2, glowLip);
      else shadePx(p, px0 + x, py0 + TILE - 2, 0.3);
    }
  }
}

// ---------------------------------------------------------------- obstacles
function paintObstacles(p: PixelPainter, room: Room): void {
  const theme = room.theme;
  const art = themeArt(theme);
  const pal = theme.palette;
  // pass 1: flat things (spikes, rubble)
  for (let ty = 2; ty < room.h - 2; ty++) {
    for (let tx = 2; tx < room.w - 2; tx++) {
      const t = room.tileAt(tx, ty);
      const px = tx * TILE;
      const py = ty * TILE;
      if (t === Tile.SPIKES) p.blit(getSpikePainter(theme, art), px, py);
      else if (t === Tile.RUBBLE) paintRubble(p, px, py, pal, new RNG((room.node.seed + tx * 131 + ty * 7121) >>> 0));
    }
  }
  // pass 2: raised obstacles, top to bottom so lower ones overlap
  for (let ty = 2; ty < room.h - 2; ty++) {
    for (let tx = 2; tx < room.w - 2; tx++) {
      const t = room.tileAt(tx, ty);
      const v = room.variant[ty * room.w + tx];
      const px = tx * TILE;
      const py = ty * TILE;
      let spr: PixelPainter | null = null;
      switch (t) {
        case Tile.ROCK: spr = getRockPainter(theme, v % 4, false); break;
        case Tile.SKULL_ROCK: spr = getRockPainter(theme, 4, false); break;
        case Tile.TINTED: spr = getRockPainter(theme, v % 4, true); break;
        case Tile.BLOCK: spr = getBlockPainter(theme, art); break;
        case Tile.POT: spr = getPotPainter(theme, art, v % 2); break;
      }
      if (!spr) continue;
      // cast shadow toward the bottom-right
      shadowEllipse(p, px + 10, py + 14.5, 8, 3.2, 0.45);
      p.blit(spr, px, py - 2);
    }
  }
}

function paintRubble(p: PixelPainter, px: number, py: number, pal: ThemePalette, rng: RNG): void {
  // dusty scorch + scattered stones of the broken obstacle
  shadowEllipse(p, px + 8, py + 9, 7.5, 5, 0.28);
  const rk = pal.rock;
  for (let i = 0; i < 8; i++) {
    const x = px + rng.int(2, 12);
    const y = py + rng.int(4, 13);
    const big = i < 3;
    shadePx(p, x + 1, y + 1, 0.35);
    p.px(x, y, rk[2]);
    p.px(x + 1, y, rk[1]);
    p.px(x, y - 1, rk[3] ?? rk[2]);
    if (big) {
      p.px(x - 1, y, rk[2]);
      p.px(x - 1, y - 1, rk[4] ?? rk[3]);
      p.px(x + 1, y - 1, rk[2]);
      p.px(x, y + 1, rk[0]);
      p.px(x + 1, y + 1, rk[0]);
    }
  }
}

const rockCache = new Map<string, PixelPainter>();
function getRockPainter(theme: ThemeDef, variant: number, tinted: boolean): PixelPainter {
  const key = `${theme.id}:${variant}:${tinted}`;
  let r = rockCache.get(key);
  if (r) return r;
  r = new PixelPainter(TILE, TILE + 2);
  const pal = theme.palette;
  const rng = new RNG(variant * 977 + 13);
  if (variant === 4) paintSkullRock(r, pal);
  else if (theme.paintRock) theme.paintRock(r, rng, variant);
  else paintDefaultRock(r, pal, rng, variant);
  if (tinted) paintTintMark(r);
  rockCache.set(key, r);
  return r;
}

/** Generic chunky boulder in the theme's rock ramp (variants 0..3). */
export function paintDefaultRock(r: PixelPainter, pal: ThemePalette, rng: RNG, variant: number): void {
  const rk = pal.rock;
  const base = rk[2];
  switch (variant % 4) {
    case 0:
      r.ellipse(8, 11.5, 7.2, 5.8, base);
      r.ellipse(6, 8.5, 4.8, 4.2, base);
      r.ellipse(10.5, 9, 4.2, 3.8, base);
      break;
    case 1:
      r.ellipse(8, 12, 7.3, 5.3, base);
      r.ellipse(8.5, 7.5, 4.6, 4.5, base);
      break;
    case 2:
      r.ellipse(5, 12.5, 4.8, 4.2, base);
      r.ellipse(11, 12.5, 4.6, 4, base);
      r.ellipse(8, 8.5, 4.4, 4.2, base);
      break;
    default:
      r.poly([0.5, 17, 1.5, 9, 5, 4, 11, 3.5, 15, 8, 15.5, 17], base);
  }
  r.shadeSphere(7, 9, 8.5, 8, rk);
  // flat lit top + cracks
  for (let i = 0; i < 4; i++) r.pxIn(5 + i, 6 + (i & 1), rk[4]);
  r.pxIn(4, 7, rk[3]);
  const cx = rng.int(5, 10);
  let y = 9;
  let x = cx;
  for (let i = 0; i < 5; i++) {
    r.pxIn(x, y, rk[0]);
    r.pxIn(x + 1, y, rk[1]);
    x += rng.int(-1, 1);
    y += 1;
  }
  r.pxIn(12, 11, rk[1]);
  r.pxIn(3, 13, rk[1]);
  // dark base row (contact)
  r.innerShadow(rk[0]);
  r.outline(pal.dark);
}

function paintSkullRock(r: PixelPainter, pal: ThemePalette): void {
  const rk = pal.rock;
  r.ellipse(8, 10, 7, 6.2, rk[3]);
  r.rect(4, 12, 8, 5, rk[3]);
  r.shadeSphere(8, 10, 7.5, 7, [rk[1], rk[2], rk[3], rk[4], lighten(rk[4], 0.3)]);
  // eye sockets & nose
  r.ellipse(5.3, 10, 1.9, 2.2, '#140c14');
  r.ellipse(10.7, 10, 1.9, 2.2, '#140c14');
  r.px(5, 9, '#3a2a3a');
  r.px(10, 9, '#3a2a3a');
  r.px(8, 12, '#140c14');
  r.px(7, 13, '#140c14');
  r.px(9, 13, '#140c14');
  // teeth
  for (let x = 5; x <= 11; x += 2) r.px(x, 15, rk[1]);
  r.rect(5, 16, 7, 1, rk[1]);
  r.px(6, 5, lighten(rk[4], 0.5));
  r.px(7, 5, lighten(rk[4], 0.3));
  r.innerShadow(rk[0]);
  r.outline(pal.dark);
}

/** Golden rune on tinted rocks (bombing them reveals a reward). Same on every floor. */
function paintTintMark(r: PixelPainter): void {
  const gold = '#ffd84a';
  const hot = '#fff6c0';
  const pts: [number, number][] = [[8, 7], [7, 8], [9, 8], [6, 9], [10, 9], [7, 10], [9, 10], [8, 11]];
  for (const [x, y] of pts) r.pxIn(x, y, gold);
  r.pxIn(8, 9, hot);
  r.pxIn(8, 8, '#8a5a10');
  r.pxIn(8, 10, '#8a5a10');
  r.pxIn(5, 6, hot);
  r.pxIn(11, 12, gold);
}

const blockCache = new Map<string, PixelPainter>();
function getBlockPainter(theme: ThemeDef, art: ThemeArt): PixelPainter {
  let b = blockCache.get(theme.id);
  if (b) return b;
  b = new PixelPainter(TILE, TILE + 2);
  if (art.paintBlock) art.paintBlock(b);
  else paintDefaultBlock(b, art.block ?? ['#22202c', '#3e3c4e', '#62607a', '#8e8ca6', '#c4c2d8'], theme.palette.dark);
  blockCache.set(theme.id, b);
  return b;
}

/** Metal cube in 3/4 view: lit top face, darker front face, rivets. */
export function paintDefaultBlock(b: PixelPainter, k: string[], outline: string): void {
  // solid riveted metal cube: bevelled top face, darker front face
  b.rect(0, 0, 16, 18, k[1]);
  b.rect(0, 0, 16, 10, k[3]);
  b.rect(1, 1, 14, 8, k[2]);
  b.rect(2, 2, 12, 6, k[3]);
  b.rect(3, 3, 10, 4, k[2]);
  b.rect(0, 0, 16, 1, k[4]);
  b.rect(0, 0, 1, 10, k[4]);
  b.rect(0, 9, 16, 1, k[4]);
  // front face with vertical brushed bands
  b.rect(0, 10, 16, 8, k[1]);
  for (let x = 1; x < 15; x += 3) b.rect(x, 11, 1, 6, k[2]);
  b.rect(0, 17, 16, 1, k[0]);
  b.rect(15, 10, 1, 8, k[0]);
  // rivets
  for (const [x, y] of [[1, 1], [14, 1], [1, 8], [14, 8], [1, 11], [14, 11], [1, 15], [14, 15]] as [number, number][]) {
    b.px(x, y, k[4]);
  }
  b.outline(outline);
}

const potCache = new Map<string, PixelPainter>();
function getPotPainter(theme: ThemeDef, art: ThemeArt, variant: number): PixelPainter {
  const key = `${theme.id}:${variant}`;
  let p = potCache.get(key);
  if (p) return p;
  p = new PixelPainter(TILE, TILE + 2);
  if (art.paintPot) art.paintPot(p, variant);
  else paintDefaultPot(p, (art.pots ?? ['#8a6a4a', '#9a5a3a'])[variant % 2], variant, theme.palette.dark);
  potCache.set(key, p);
  return p;
}

/** Clay urn: round belly, neck, lip; variant 1 is squat with handles. */
export function paintDefaultPot(p: PixelPainter, base: string, variant: number, outline: string): void {
  const k = ramp(base, 5);
  if (variant === 0) {
    p.ellipse(8, 11.5, 6, 5.5, base);
    p.rect(5, 4, 6, 4, base);
    p.rect(4, 3, 8, 2, base);
    p.shadeSphere(8, 11, 6.5, 6, k);
    p.rect(4, 3, 8, 1, k[4]);
    p.rect(5, 4, 6, 1, k[1]);
    p.rect(5, 5, 6, 1, k[0]);
    // painted band
    for (let x = 3; x <= 13; x++) p.pxIn(x, 11, k[1]);
    for (let x = 4; x <= 12; x += 3) p.pxIn(x, 10, k[3]);
  } else {
    p.ellipse(8, 12.5, 7, 4.8, base);
    p.rect(5, 6, 6, 3, base);
    p.rect(4, 5, 8, 2, base);
    p.shadeSphere(8, 12, 7.5, 5.5, k);
    p.rect(4, 5, 8, 1, k[4]);
    p.rect(5, 7, 6, 1, k[0]);
    // handles
    p.px(1, 10, k[2]); p.px(1, 11, k[1]); p.px(2, 9, k[2]);
    p.px(14, 10, k[1]); p.px(14, 11, k[0]); p.px(13, 9, k[1]);
    for (let x = 3; x <= 13; x++) p.pxIn(x, 13, k[1]);
  }
  p.innerShadow(k[0]);
  p.outline(outline);
}

const spikeCache = new Map<string, PixelPainter>();
function getSpikePainter(theme: ThemeDef, art: ThemeArt): PixelPainter {
  let p = spikeCache.get(theme.id);
  if (p) return p;
  p = new PixelPainter(TILE, TILE);
  const plate = art.spikes?.plate ?? '#2a2430';
  const m = art.spikes?.metal ?? ['#3a3a4a', '#6a6a7e', '#a8a8bc', '#eeeef8'];
  // recessed plate
  p.rect(1, 1, 14, 14, darken(plate, 0.35));
  p.rect(2, 2, 12, 12, plate);
  p.rect(2, 13, 12, 1, lighten(plate, 0.15));
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]] as [number, number][]) p.px(x, y, m[1]);
  // 3 rows of cones
  const rows: [number, number][] = [[4, 6], [8, 6], [12, 6], [6, 10], [10, 10], [4, 14], [8, 14], [12, 14]];
  for (const [sx, sy] of rows) {
    p.px(sx - 1, sy, darken(plate, 0.5));
    p.px(sx, sy, darken(plate, 0.5));
    p.px(sx + 1, sy, darken(plate, 0.5));
    p.px(sx - 1, sy - 1, m[1]);
    p.px(sx, sy - 1, m[2]);
    p.px(sx + 1, sy - 1, m[0]);
    p.px(sx, sy - 2, m[2]);
    p.px(sx - 1, sy - 2, m[1]);
    p.px(sx, sy - 3, m[3]);
  }
  spikeCache.set(theme.id, p);
  return p;
}

function paintHiddenDoorHints(p: PixelPainter, room: Room): void {
  const g = wallGeo(room);
  const art = themeArt(room.theme);
  for (const d of room.doors) {
    if (d.state !== 'hidden') continue;
    const face: Face = d.dir === 'N' ? 'top' : d.dir === 'S' ? 'bottom' : d.dir === 'W' ? 'left' : 'right';
    const c = face === 'top' || face === 'bottom' ? d.x : d.y;
    const rng = new RNG((room.node.seed ^ (d.to * 7919)) >>> 0);
    // hairline cracks spreading from the hidden opening (a subtle hint to bomb here)
    for (let k = 0; k < 5; k++) {
      let along = c + rng.range(-7, 7);
      let t = rng.range(0.1, 0.45);
      const dir = rng.sign();
      for (let i = 0; i < 11; i++) {
        const pt = facePoint(g, face, along, t);
        shadePx(p, pt.x, pt.y, 0.6);
        blendPx(p, pt.x + 1, pt.y + 1, art.face[4], 0.3);
        along += dir * rng.range(0.4, 1.4);
        t += rng.range(0.02, 0.08) * (face === 'top' ? 1 : 1.7);
        if (t > 0.92) break;
      }
    }
    // a little crumbled mortar at the wall base
    for (let k = 0; k < 4; k++) {
      const pt = facePoint(g, face, c + rng.range(-8, 8), 0);
      const n = face === 'top' ? [0, 2] : face === 'bottom' ? [0, -2] : face === 'left' ? [2, 0] : [-2, 0];
      const x = Math.round(pt.x + n[0] + rng.range(-1, 1));
      const y = Math.round(pt.y + n[1] + rng.range(-1, 1));
      p.px(x, y, art.face[2]);
      p.px(x + 1, y, art.face[1]);
    }
  }
}

// ======================================================================
// Doors
// ======================================================================

const SPECIAL_DOOR: Partial<Record<DoorKind, DoorLook>> = {
  treasure: { frame: ['#4a2a08', '#9a6a18', '#e0a838', '#fff0a0'], leaf: '#7a4a1a', metal: '#ffd860', inner: '#120a02' },
  shop: { frame: ['#2a1a10', '#5a3a20', '#8a6038', '#c89a60'], leaf: '#5a3a1e', metal: '#ffd34a', inner: '#0a0604' },
  boss: { frame: ['#2a0608', '#6a1018', '#a83030', '#f07060'], leaf: '#4a0a10', metal: '#d8c8b0', inner: '#140204' },
  secret: { frame: ['#14101a', '#2a2433', '#4a4256', '#6e6680'], leaf: '#2a2433', metal: '#6a5a80', inner: '#06040a' },
  challenge: { frame: ['#1e1e28', '#4a4a5a', '#8a8aa0', '#dcdcf0'], leaf: '#3a3a48', metal: '#c8c8e0', inner: '#08080e' },
  shrine: { frame: ['#101838', '#2a3a80', '#5a78d0', '#b8ccff'], leaf: '#1e2a5a', metal: '#a8c0ff', inner: '#040820' },
  curse: { frame: ['#14040e', '#3a0e2a', '#7a2a5a', '#d060a0'], leaf: '#2a0a20', metal: '#e070b0', inner: '#0a0208' },
};

function doorLook(room: Room, kind: DoorKind): DoorLook {
  const sp = SPECIAL_DOOR[kind];
  if (sp) return sp;
  const art = themeArt(room.theme);
  const d = art.door ?? {};
  return {
    frame: d.frame ?? [art.mortar, art.face[1], art.face[3], art.face[4]],
    leaf: d.leaf ?? '#4a3426',
    metal: d.metal ?? '#8a8a9a',
    inner: d.inner ?? '#08060a',
  };
}

/** Door sprites are drawn for a door in the TOP wall; other walls rotate them. */
const DW = 40;
const DH = 35;
const DOX = 20;
const DOY = 32;
const OPEN_R = 9; // half width of the opening
const ARCH_CY = 18;

function inOpening(x: number, y: number): boolean {
  const cx = x + 0.5 - DOX;
  if (Math.abs(cx) > OPEN_R) return false;
  if (y + 0.5 >= ARCH_CY) return y < DOY + 1;
  const dy = y + 0.5 - ARCH_CY;
  return cx * cx + dy * dy <= OPEN_R * OPEN_R;
}

interface DoorSprites { back: string; front: string; leaf: string }
/** door sprite names per theme and kind (drawn every frame: no string building per draw) */
const doorSpriteCache = new Map<string, Map<DoorKind, DoorSprites>>();

function doorSprites(room: Room, kind: DoorKind): DoorSprites {
  let byKind = doorSpriteCache.get(room.theme.id);
  if (!byKind) doorSpriteCache.set(room.theme.id, (byKind = new Map()));
  let ds = byKind.get(kind);
  if (!ds) byKind.set(kind, (ds = buildDoorSprites(room, kind)));
  return ds;
}

function buildDoorSprites(room: Room, kind: DoorKind): DoorSprites {
  const look = doorLook(room, kind);
  const key = SPECIAL_DOOR[kind] ? kind : `${kind}_${room.theme.id}`;
  const back = `__door_${key}_back`;
  const front = `__door_${key}_front`;
  const leaf = `__door_${key}_leaf`;
  if (hasSprite(front)) return { back, front, leaf };
  const f = look.frame;

  defineDrawnSprite(back, DW, DH, (p) => {
    for (let y = 0; y < DH; y++) {
      for (let x = 0; x < DW; x++) {
        if (!inOpening(x, y)) continue;
        // passage: darkness with a faint floor continuing inward
        const k = (y - 9) / (DOY - 9);
        let c = look.inner;
        if (k > 0.72) c = rampPick([look.inner, lighten(look.inner, 0.06), lighten(look.inner, 0.12)], (k - 0.72) * 9, x, y);
        p.px(x, y, c);
      }
    }
    if (kind === 'secret') return;
    // side walls of the passage (perspective)
    for (let y = 12; y <= DOY; y++) {
      p.px(DOX - OPEN_R, y, lighten(look.inner, 0.1));
      p.px(DOX + OPEN_R - 1, y, lighten(look.inner, 0.05));
    }
  }, { origin: [DOX, DOY] });

  defineDrawnSprite(front, DW, DH, (p) => {
    if (kind === 'secret') {
      paintBrokenHole(p, look);
      return;
    }
    const outerR = 15;
    // silhouette: arch ring + pillars + bases
    for (let y = 0; y < DH; y++) {
      for (let x = 0; x < DW; x++) {
        const cx = x + 0.5 - DOX;
        const dy = y + 0.5 - ARCH_CY;
        const inArch = y + 0.5 < ARCH_CY ? cx * cx + dy * dy <= outerR * outerR : Math.abs(cx) <= outerR - 0.5 && y <= DOY;
        if (inArch && !inOpening(x, y)) p.px(x, y, f[2]);
      }
    }
    // pillar bases & capitals
    p.rect(DOX - outerR - 1, DOY - 3, 7, 4, f[2]);
    p.rect(DOX + outerR - 6, DOY - 3, 7, 4, f[2]);
    p.rect(DOX - outerR - 1, ARCH_CY - 1, 7, 2, f[3]);
    p.rect(DOX + outerR - 6, ARCH_CY - 1, 7, 2, f[2]);
    // threshold step on the floor
    p.rect(DOX - OPEN_R - 1, DOY + 1, OPEN_R * 2 + 2, 2, f[1]);
    p.rect(DOX - OPEN_R - 1, DOY + 1, OPEN_R * 2 + 2, 1, f[2]);
    // shading: light from the top-left
    for (let y = 0; y < DH; y++) {
      for (let x = 0; x < DW; x++) {
        if (!p.isSet(x, y)) continue;
        const cx = x + 0.5 - DOX;
        let sh = 2;
        if (cx < 0) sh += 0.4;
        else sh -= 0.3;
        if (y > DOY) sh -= 0.6;
        // inner bevel next to the opening
        if (inOpening(x + 1, y) || inOpening(x - 1, y) || inOpening(x, y + 1)) sh += cx < 0 ? -1 : -1.2;
        else if (inOpening(x + 2, y) || inOpening(x - 2, y)) sh += 0.6;
        p.px(x, y, rampPick(f, sh + (hash2(x, y, 3) - 0.5) * 0.5, x, y));
      }
    }
    // voussoir joints on the arch
    for (let i = 1; i < 7; i++) {
      const a = Math.PI + (i / 7) * Math.PI;
      for (let r = OPEN_R + 0.5; r < outerR; r += 0.5) p.pxIn(DOX - 0.5 + Math.cos(a) * r, ARCH_CY - 0.5 + Math.sin(a) * r, f[0]);
    }
    // pillar block joints
    for (const yy of [22, 27]) {
      p.rect(DOX - outerR, yy, outerR - OPEN_R, 1, f[0]);
      p.rect(DOX + OPEN_R, yy, outerR - OPEN_R, 1, f[0]);
    }
    // outer rim highlight
    for (let y = 0; y < DH; y++) {
      for (let x = 0; x < DW; x++) {
        if (p.isSet(x, y) && !p.isSet(x, y - 1) && !inOpening(x, y - 1)) p.px(x, y, f[3]);
      }
    }
    paintDoorOrnament(p, kind, look);
    p.outline('#0c0810');
  }, { origin: [DOX, DOY] });

  defineDrawnSprite(leaf, OPEN_R, DOY + 1 - 9, (p) => {
    // left panel of the closed door; the right one is drawn mirrored
    const H = DOY + 1 - 9;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < OPEN_R; x++) {
        if (!inOpening(x + DOX - OPEN_R, y + 9)) continue;
        p.px(x, y, look.leaf);
      }
    }
    const lk = ramp(look.leaf, 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < OPEN_R; x++) {
        if (!p.isSet(x, y)) continue;
        let sh = 1.6 + (x === OPEN_R - 1 ? -1 : 0) + (x % 3 === 0 ? -0.6 : 0.2) + (hash2(x, y, 9) - 0.5) * 0.5;
        if (!p.isSet(x, y - 1)) sh += 1;
        p.px(x, y, rampPick(lk, sh, x, y));
      }
    }
    // metal bands & studs
    for (const yy of [7, 17]) {
      for (let x = 0; x < OPEN_R; x++) if (p.isSet(x, yy)) { p.px(x, yy, look.metal); p.px(x, yy + 1, darken(look.metal, 0.45)); }
      p.px(2, yy, lighten(look.metal, 0.5));
      p.px(6, yy, lighten(look.metal, 0.5));
    }
    if (kind === 'boss') { p.px(5, 11, '#ff3020'); p.px(6, 11, '#ff9060'); }
    if (kind === 'curse') { p.px(6, 12, '#ff70c0'); p.px(5, 13, '#a03070'); }
    p.px(OPEN_R - 2, 12, look.metal);
  }, { origin: [0, DOY + 1 - 9] });
  return { back, front, leaf };
}

function paintBrokenHole(p: PixelPainter, look: DoorLook): void {
  const f = look.frame;
  // jagged rim of broken stones around the opening
  for (let y = 0; y < DH; y++) {
    for (let x = 0; x < DW; x++) {
      if (inOpening(x, y)) continue;
      const cx = x + 0.5 - DOX;
      const dy = y + 0.5 - ARCH_CY;
      const r = y + 0.5 < ARCH_CY ? Math.hypot(cx, dy) : Math.abs(cx);
      const jag = OPEN_R + 1.5 + hash2(Math.round(Math.atan2(dy, cx) * 6), 1, 3) * 3 + (y > DOY - 2 ? 2 : 0);
      if (r < jag && y <= DOY + 1) p.px(x, y, rampPick(f, 1.4 + (hash2(x, y, 5) - 0.5) * 1.6 + (cx < 0 ? 0.5 : 0), x, y));
    }
  }
  // rubble chunks at the threshold
  for (const [x, y] of [[DOX - 10, DOY], [DOX - 7, DOY + 1], [DOX + 8, DOY], [DOX + 5, DOY + 1], [DOX - 2, DOY + 1]] as [number, number][]) {
    p.rect(x, y, 3, 2, f[1]);
    p.px(x, y, f[3]);
  }
  p.outline('#0c0810');
}

function paintDoorOrnament(p: PixelPainter, kind: DoorKind, look: DoorLook): void {
  const m = look.metal;
  switch (kind) {
    case 'treasure': {
      // jewel keystone + gold studs
      p.rect(DOX - 3, 1, 6, 6, '#e0a838');
      p.rect(DOX - 2, 2, 4, 4, '#3ad0ff');
      p.px(DOX - 2, 2, '#e8ffff');
      p.px(DOX + 1, 5, '#1a6aa0');
      for (const x of [DOX - 13, DOX + 12]) { p.px(x, 24, '#fff0a0'); p.px(x, 29, '#fff0a0'); }
      break;
    }
    case 'shop': {
      // hanging coin sign
      p.rect(DOX - 6, 0, 12, 1, '#3a2414');
      p.circle(DOX, 4.5, 4, '#ffd34a');
      p.ring(DOX, 4.5, 4, 1, '#a07010');
      p.rect(DOX - 1, 2, 1, 5, '#a07010');
      p.px(DOX - 2, 3, '#fff6c0');
      break;
    }
    case 'boss': {
      // horned skull keystone + teeth along the opening
      p.ellipse(DOX, 4, 4.5, 3.8, '#e8dcc8');
      p.rect(DOX - 2, 6, 5, 2, '#e8dcc8');
      p.px(DOX - 2, 4, '#1a0406'); p.px(DOX - 1, 4, '#1a0406');
      p.px(DOX + 1, 4, '#1a0406'); p.px(DOX + 2, 4, '#1a0406');
      p.px(DOX - 2, 3, '#ff3020'); p.px(DOX + 2, 3, '#ff3020');
      p.px(DOX, 6, '#1a0406');
      p.line(DOX - 5, 3, DOX - 9, 0, '#d8c8b0');
      p.line(DOX + 5, 3, DOX + 9, 0, '#d8c8b0');
      for (let i = 0; i < 6; i++) {
        const y = ARCH_CY + 1 + i * 2.4;
        p.px(DOX - OPEN_R, y, '#f0e6d0');
        p.px(DOX + OPEN_R - 1, y + 1, '#f0e6d0');
      }
      break;
    }
    case 'challenge': {
      // crossed blades over the keystone
      p.line(DOX - 5, 7, DOX + 4, 0, '#dcdcf0');
      p.line(DOX + 5, 7, DOX - 4, 0, '#dcdcf0');
      p.px(DOX - 5, 7, '#8a5a2a'); p.px(DOX + 5, 7, '#8a5a2a');
      p.rect(DOX - 1, 2, 3, 3, '#ff4a4a');
      for (const x of [DOX - 14, DOX + 13]) { p.px(x, 13, m); p.px(x, 12, '#ffffff'); }
      break;
    }
    case 'shrine': {
      // small lantern flame
      p.rect(DOX - 2, 1, 5, 6, '#2a3a80');
      p.rect(DOX - 1, 2, 3, 4, '#bfe0ff');
      p.px(DOX, 3, '#ffffff');
      p.px(DOX, 0, '#a8c0ff');
      for (const x of [DOX - 13, DOX + 12]) { p.px(x, 16, '#a8d0ff'); p.px(x, 15, '#ffffff'); }
      break;
    }
    case 'curse': {
      // thorns + eye
      for (let i = 0; i < 9; i++) {
        const a = Math.PI + (i / 8) * Math.PI;
        p.px(DOX - 0.5 + Math.cos(a) * 16, ARCH_CY - 0.5 + Math.sin(a) * 16, '#5a1a3a');
        p.px(DOX - 0.5 + Math.cos(a) * 17, ARCH_CY - 0.5 + Math.sin(a) * 17, '#3a0a24');
      }
      p.ellipse(DOX, 4, 4, 2.5, '#f0d0e0');
      p.ellipse(DOX, 4, 1.6, 2.2, '#c02060');
      p.px(DOX, 4, '#140008');
      break;
    }
    default: {
      // plain keystone
      p.rect(DOX - 2, 3, 4, 5, look.frame[3]);
      p.rect(DOX - 2, 7, 4, 1, look.frame[1]);
    }
  }
}

/** reused draw options (doors are drawn every frame) */
const DOOR_OPTS: DrawOpts = { rot: 0 };
const LEAF_OPTS: DrawOpts = { rot: 0, sx: 1, flipX: false };

export function drawDoor(r: Renderer, room: Room, d: Door, _time: number): void {
  if (d.state === 'hidden') return;
  const sp = doorSprites(room, d.kind);
  const rot = d.dir === 'N' ? 0 : d.dir === 'S' ? Math.PI : d.dir === 'E' ? Math.PI / 2 : -Math.PI / 2;
  DOOR_OPTS.rot = rot;
  r.sprite(sp.back, d.x, d.y, DOOR_OPTS);
  const closed = 1 - d.open;
  if (closed > 0.02) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    // local (lx, ly) -> world; panels fold in from the jambs
    const k = Math.min(1, closed);
    const lo = LEAF_OPTS;
    lo.rot = rot;
    lo.sx = k;
    lo.flipX = false;
    r.sprite(sp.leaf, d.x - OPEN_R * c - s, d.y - OPEN_R * s + c, lo);
    lo.flipX = true;
    r.sprite(sp.leaf, d.x + OPEN_R * c - s, d.y + OPEN_R * s + c, lo);
    if (d.state === 'locked') r.sprite('__door_lock', d.x + 10 * s, d.y - 10 * c);
  }
  r.sprite(sp.front, d.x, d.y, DOOR_OPTS);
}

defineDrawnSprite('__door_lock', 9, 11, (p) => {
  p.ring(4.5, 3.5, 3.5, 1.4, '#b8b8c8');
  p.px(2, 2, '#e8e8f8');
  p.rect(0, 4, 9, 7, '#ffcc33');
  p.shadeVertical(0, 4, 9, 7, ['#8a5a08', '#d09a1a', '#ffcc33', '#ffe680']);
  p.rect(0, 4, 9, 1, '#fff2b0');
  p.rect(4, 6, 1, 3, '#3a2a0a');
  p.px(3, 6, '#3a2a0a');
  p.px(5, 6, '#3a2a0a');
}, { outline: '#1a1008' });
