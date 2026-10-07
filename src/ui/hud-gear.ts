// Lantern-keeper HUD chrome, painted at art resolution (1 art px = PX UI units)
// like the other UI frames and cached per size / variant:
//   - the brass lantern whose glass is the ember (등불 해방) gauge,
//   - the keeper plate behind the hearts and the purse (coins / bombs / keys),
//   - the gear rack behind the weapons, active item and potion,
//   - small rarity gems for equipment slots.
// Only the static chrome is cached here; the HUD draws the live parts (glass
// fill, flame, numbers) on top every frame.

import { PixelPainter, bayer } from '../engine/painter';
import type { Renderer } from '../engine/renderer';
import { clamp, mixColor } from '../engine/math';
import { C, PX } from './theme';

// ---------------------------------------------------------------- lanterns
/**
 * Two lanterns sit in the top-left corner: the release lantern (ember gauge)
 * and, to its right, the larger health lantern whose glass holds the keeper's
 * life. Both are framed procedurally from the same parts (ring handle, stepped
 * cap, posts around the glass, stepped base) so they read as a pair; generated
 * PixelLab art can replace either frame (see setLanternArt / pixellab-hud.ts).
 */
export type LanternKind = 'release' | 'health';

export interface LanternSpec {
  /** art size (px) */
  w: number;
  h: number;
  /** glass chamber, art px relative to the lantern's top-left */
  glass: { x: number; y: number; w: number; h: number };
}

/** Lantern frame rows (art px): k ink, Y/y/d brass ramp, G glass back, R/r cap jewel. */
function lanternRows(w: number, glassH: number, jewel: boolean): string[] {
  const c = w / 2;
  const row = (fill: (x: number) => string) => Array.from({ length: w }, (_, x) => fill(x)).join('');
  const rows: string[] = [];
  rows.push(row((x) => (x >= c - 3 && x <= c + 2 ? 'k' : '.')));
  rows.push(row((x) => (x === c - 4 || x === c + 3 ? 'k' : x === c - 3 ? 'Y' : x === c + 2 ? 'd' : x > c - 3 && x < c + 2 ? 'y' : '.')));
  for (let i = 0; i < 2; i++) rows.push(row((x) => (x === c - 4 || x === c - 2 || x === c + 1 || x === c + 3 ? 'k' : x === c - 3 ? 'y' : x === c + 2 ? 'd' : '.')));
  rows.push(row((x) => (x >= c - 4 && x <= c + 3 ? 'k' : '.')));
  rows.push(row((x) => {
    if (x === c - 5 || x === c + 4) return 'k';
    if (jewel && (x === c - 1 || x === c)) return x === c - 1 ? 'R' : 'r';
    if (x >= c - 4 && x <= c - 2) return 'Y';
    if (x >= c - 1 && x <= c + 2) return 'y';
    return x === c + 3 ? 'd' : '.';
  }));
  rows.push(row((x) => (x === 1 || x === 2 || x === w - 3 || x === w - 2 ? 'k' : x === 3 ? 'Y' : x >= w - 5 && x <= w - 4 ? 'd' : x > 3 && x < w - 5 ? 'y' : '.')));
  rows.push(row((x) => (x >= 1 && x <= w - 2 ? 'k' : '.')));
  for (let i = 0; i < glassH; i++) {
    rows.push(row((x) => (x === 1 || x === 3 || x === w - 4 || x === w - 2 ? 'k' : x === 2 ? 'Y' : x === w - 3 ? 'd' : x > 3 && x < w - 4 ? 'G' : '.')));
  }
  rows.push(row((x) => (x >= 1 && x <= w - 2 ? 'k' : '.')));
  rows.push(row((x) => (x === 1 || x === w - 2 ? 'k' : x >= 2 && x <= 6 ? 'Y' : x === w - 3 ? 'd' : x > 6 && x < w - 3 ? 'y' : '.')));
  rows.push(row((x) => (x === 2 || x === w - 3 ? 'k' : x > 2 && x < w - 3 ? 'y' : '.')));
  rows.push(row((x) => (x === 3 || x === w - 3 ? 'k' : x > 3 && x < w - 3 ? 'd' : '.')));
  rows.push(row((x) => (x >= 4 && x <= w - 5 ? 'k' : '.')));
  return rows;
}

function makeSpec(w: number, glassH: number): LanternSpec {
  return { w, h: glassH + 13, glass: { x: 4, y: 8, w: w - 8, h: glassH } };
}

const PROC_SPEC: Record<LanternKind, LanternSpec> = {
  release: makeSpec(18, 15),
  health: makeSpec(22, 22),
};

const LANTERN_PAL = {
  dim: { k: C.ink, Y: '#f0c87a', y: '#b8843c', d: '#6a4218', G: '#160d14', R: '#ff8a8a', r: '#b81830' },
  lit: { k: C.ink, Y: '#fff4c8', y: '#ffc860', d: '#b07028', G: '#2a140c', R: '#ff8a8a', r: '#b81830' },
  health: { k: C.ink, Y: '#f0c87a', y: '#b8843c', d: '#6a4218', G: '#1a0c10', R: '#ffb0b0', r: '#d0283c' },
} as const;

/** PixelLab frames, when generated: canvas + its glass rect (art px). */
const lanternArt = new Map<LanternKind, { canvas: HTMLCanvasElement; spec: LanternSpec }>();

/** Install a generated lantern frame (its glass window must be transparent; the HUD paints the contents under it). */
export function setLanternArt(kind: LanternKind, canvas: HTMLCanvasElement, glass: LanternSpec['glass']): void {
  lanternArt.set(kind, { canvas, spec: { w: canvas.width, h: canvas.height, glass } });
}

/** Active spec (art px) for a lantern kind. */
export function lanternSpec(kind: LanternKind): LanternSpec {
  return lanternArt.get(kind)?.spec ?? PROC_SPEC[kind];
}

/** Back-compat sizes of the release lantern. */
export const LANTERN_W = PROC_SPEC.release.w;
export const LANTERN_H = PROC_SPEC.release.h;
export const LANTERN_GLASS = PROC_SPEC.release.glass;

// ---------------------------------------------------------------- canvas cache
const cache = new Map<string, HTMLCanvasElement>();

function cached(key: string, paint: () => PixelPainter): HTMLCanvasElement {
  let cv = cache.get(key);
  if (!cv) {
    if (cache.size > 64) cache.clear();
    cv = paint().toCanvas();
    cache.set(key, cv);
  }
  return cv;
}

/** Blit a cached art-pixel canvas at UI (x, y), scaled to the UI grid. */
export function blitArt(r: Renderer, cv: HTMLCanvasElement, x: number, y: number, alpha = 1): void {
  if (alpha <= 0) return;
  const d = r.dctx;
  d.globalAlpha = clamp(alpha, 0, 1);
  d.imageSmoothingEnabled = false;
  d.drawImage(cv, Math.round(x), Math.round(y), cv.width * PX, cv.height * PX);
  d.globalAlpha = 1;
}

/** Pure painter for a procedural lantern frame (tests / cache). */
export function paintLantern(kind: LanternKind | boolean, lit = false): PixelPainter {
  const k: LanternKind = typeof kind === 'boolean' ? 'release' : kind;
  const isLit = typeof kind === 'boolean' ? kind : lit;
  const spec = PROC_SPEC[k];
  const p = new PixelPainter(spec.w, spec.h);
  const pal = k === 'health' ? LANTERN_PAL.health : isLit ? LANTERN_PAL.lit : LANTERN_PAL.dim;
  p.stamp(0, 0, lanternRows(spec.w, spec.glass.h, k === 'health'), pal);
  return p;
}

export function lanternCanvas(kind: LanternKind | boolean, lit = false): HTMLCanvasElement {
  const k: LanternKind = typeof kind === 'boolean' ? 'release' : kind;
  const isLit = typeof kind === 'boolean' ? kind : lit;
  return cached(`lantern|${k}|${isLit ? 1 : 0}`, () => paintLantern(k, isLit));
}

/** Frame of a lantern: generated art when installed, else the procedural one. Returns whether it is art. */
function blitFrame(r: Renderer, kind: LanternKind, lit: boolean, x: number, y: number, alpha: number): void {
  const art = lanternArt.get(kind);
  blitArt(r, art ? art.canvas : lanternCanvas(kind, lit), x, y, alpha);
}

// ---------------------------------------------------------------- plates
function roundBox(p: PixelPainter, w: number, h: number, outline: string, fill: string): void {
  p.rect(2, 0, w - 4, h, outline);
  p.rect(0, 2, w, h - 4, outline);
  p.px(1, 1, outline);
  p.px(w - 2, 1, outline);
  p.px(1, h - 2, outline);
  p.px(w - 2, h - 2, outline);
  p.rect(2, 1, w - 4, h - 2, fill);
  p.rect(1, 2, w - 2, h - 4, fill);
}

function rivet(p: PixelPainter, x: number, y: number): void {
  p.px(x, y, '#ffe09a');
  p.px(x + 1, y, '#b8843c');
  p.px(x, y + 1, '#b8843c');
  p.px(x + 1, y + 1, '#5a3814');
}

/**
 * Keeper plate / gear rack: a dark plum plate with a brass top rail, a soot
 * bottom edge and brass rivets; `divRow` (art px, optional) adds a stitched
 * divider between the plate's two rows.
 */
export function paintPlate(pw: number, ph: number, divRow = -1): PixelPainter {
  const p = new PixelPainter(pw, ph);
  roundBox(p, pw, ph, C.ink, '#18111e');
  for (let y = 3; y < ph - 2; y++) {
    const t = (y - 3) / Math.max(1, ph - 5);
    for (let x = 2; x < pw - 2; x++) p.px(x, y, bayer(x, y) < (1 - t) * 0.6 ? '#241a2d' : '#17111d');
  }
  // brass rail along the top, soot along the bottom, cool rim on the sides
  p.rect(2, 1, pw - 4, 1, '#e0b064');
  p.rect(2, 2, pw - 4, 1, '#7a4e1c');
  p.px(1, 2, '#b8843c');
  p.px(pw - 2, 2, '#5a3814');
  p.rect(1, 3, 1, ph - 5, '#33263f');
  p.rect(pw - 2, 3, 1, ph - 5, '#0e0a12');
  p.rect(2, ph - 2, pw - 4, 1, '#0e0a12');
  if (divRow > 2 && divRow < ph - 3) {
    for (let x = 4; x < pw - 4; x++) {
      p.px(x, divRow, x % 3 === 0 ? '#6a4a2a' : '#2a1f34');
      p.px(x, divRow + 1, '#0e0a12');
    }
  }
  if (pw >= 12) {
    rivet(p, pw - 5, 4);
    if (ph >= 12) rivet(p, pw - 5, ph - 5);
  }
  return p;
}

export function plateCanvas(pw: number, ph: number, divRow = -1): HTMLCanvasElement {
  return cached(`plate|${pw}|${ph}|${divRow}`, () => paintPlate(pw, ph, divRow));
}

// ---------------------------------------------------------------- rarity gem
const GEM = ['..k..', '.kYk.', 'kYcdk', '.kdk.', '..k..'];

export function gemCanvas(color: string): HTMLCanvasElement {
  return cached(`gem|${color}`, () => {
    const p = new PixelPainter(5, 5);
    p.stamp(0, 0, GEM, { k: C.ink, Y: mixColor(color, '#ffffff', 0.55), c: color, d: mixColor(color, '#000000', 0.45) });
    return p;
  });
}

/** Rarity accent for an equipment slot (UI rect): an inner colored rim and a gem on the top-left corner. */
export function rarityAccent(r: Renderer, x: number, y: number, s: number, color: string, alpha = 1): void {
  const a = alpha * 0.75;
  r.uiRect(x + 4, y + 4, s - 8, PX, color, a);
  r.uiRect(x + 4, y + s - 4 - PX, s - 8, PX, mixColor(color, '#000000', 0.35), a);
  r.uiRect(x + 4, y + 4, PX, s - 8, color, a);
  r.uiRect(x + s - 4 - PX, y + 4, PX, s - 8, mixColor(color, '#000000', 0.35), a);
  blitArt(r, gemCanvas(color), x - 3, y - 3, alpha);
}

// ---------------------------------------------------------------- lantern glass (live)
export interface LanternState {
  /** ember fill 0..1 */
  fill: number;
  /** gauge full and release allowed */
  ready: boolean;
  /** release cooldown seconds left (0 = none) */
  cooldown: number;
  /** HUD time (s), for the flame flicker */
  t: number;
  /** white flash 0..1 when the gauge just filled */
  flash: number;
}

/** Glass rect of a lantern drawn at UI (x, y), in UI units. */
function glassRect(kind: LanternKind, x: number, y: number): { gx: number; gy: number; gw: number; gh: number; rows: number } {
  const g = lanternSpec(kind).glass;
  return { gx: x + g.x * PX, gy: y + g.y * PX, gw: g.w * PX, gh: g.h * PX, rows: g.h };
}

/** Cage bars, a brass band round the glass's middle and the gleam (procedural frames only). */
function glassCage(r: Renderer, gx: number, gy: number, gw: number, gh: number, bright: boolean, alpha: number, band = true): void {
  const cols = gw / PX;
  r.uiRect(gx + Math.floor(cols / 3) * PX, gy, PX, gh, C.ink, alpha * 0.5);
  r.uiRect(gx + Math.ceil((cols * 2) / 3 - 1) * PX, gy, PX, gh, C.ink, alpha * 0.5);
  if (band) {
    const by = gy + Math.floor(gh / PX / 2) * PX;
    r.uiRect(gx - PX, by, gw + 2 * PX, PX, bright ? '#ffc860' : '#b8843c', alpha);
    r.uiRect(gx - PX, by + PX, gw + 2 * PX, PX, C.ink, alpha * 0.8);
  }
  r.uiRect(gx + PX, gy + PX, PX, PX * 4, '#ffffff', alpha * 0.3);
}

/** A small flame (art px grid) whose base sits on `surf`, centered on cx. */
function flame(r: Renderer, cx: number, surf: number, top: number, rows: number, outer: string, mid: string, core: string, alpha: number): void {
  const fh = rows * PX;
  const fy = Math.max(top, surf - fh);
  r.uiRect(cx - 2 * PX, surf - Math.min(fh, 2 * PX), PX * 4, Math.min(fh, 2 * PX), outer, alpha * 0.9);
  r.uiRect(cx - PX, fy + PX, PX * 2, surf - fy - PX, mid, alpha);
  r.uiRect(cx - PX, fy + 2 * PX, PX, Math.max(0, surf - fy - 3 * PX), core, alpha);
  r.uiRect(cx - PX, fy, PX, PX, mid, alpha);
}

/**
 * Release lantern at UI (x, y): ember filling the glass from the bottom (hottest
 * in the middle) with a flame riding its surface; bright glow when ready;
 * shutters while the release recovers.
 */
export function drawLantern(r: Renderer, x: number, y: number, s: LanternState, alpha: number): void {
  if (alpha <= 0.01) return;
  const art = lanternArt.has('release');
  if (!art) blitFrame(r, 'release', s.ready, x, y, alpha);
  const { gx, gy, gw, gh, rows: glassRows } = glassRect('release', x, y);
  const f = clamp(s.fill, 0, 1);
  const rows = Math.round(glassRows * f);
  const pulse = 0.5 + 0.5 * Math.sin(s.t * 7);
  if (rows > 0) {
    const fh = rows * PX;
    const top = gy + gh - fh;
    const ramp = s.ready
      ? [pulse > 0.5 ? '#fff8dc' : '#fff0b0', '#ffc850', '#ff8a28']
      : ['#ffb060', '#ee6428', '#a8341a'];
    r.uiRect(gx, top, gw, fh, ramp[2], alpha);
    r.uiRect(gx + PX, top, gw - 2 * PX, fh, ramp[1], alpha);
    r.uiRect(gx + 3 * PX, top, gw - 6 * PX, fh, ramp[0], alpha);
    r.uiRect(gx, gy + gh - PX, gw, PX, s.ready ? '#c86a18' : '#6a1e0c', alpha);
    r.uiRect(gx + PX, top, gw - 2 * PX, PX, s.ready ? '#ffffff' : '#ffd080', alpha * 0.9);
  }
  if (!s.ready && s.cooldown <= 0) {
    const surf = gy + gh - rows * PX;
    const flick = Math.sin(s.t * 13) > 0.2 ? 1 : 0;
    const sway = Math.sin(s.t * 5) > 0.6 ? PX : 0;
    flame(r, gx + gw / 2 + sway, surf, gy, (rows > 0 ? 4 : 3) + flick, '#ff7a2a', '#ffb848', '#fff0b8', alpha);
  }
  if (!art) glassCage(r, gx, gy, gw, gh, s.ready, alpha);
  if (s.flash > 0) r.uiRect(gx, gy, gw, gh, '#ffffff', alpha * s.flash * 0.7);
  if (s.cooldown > 0) for (let i = 0; i < glassRows; i += 3) r.uiRect(gx, gy + i * PX, gw, PX, '#05030a', alpha * 0.55);
  if (art) blitFrame(r, 'release', s.ready, x, y, alpha);
}

// ---------------------------------------------------------------- health lantern
export interface HealthState {
  /** half hearts */
  red: number;
  maxRed: number;
  soul: number;
  /** one-hit wards */
  shields: number;
  /** smoothed red + soul capacity the glass is scaled to (half hearts) */
  scale: number;
  t: number;
  /** white flash 0..1 after a hit / gain */
  flash: number;
  /** low health: the flame gutters */
  low: boolean;
}

const RED = { hi: '#ff8a7a', body: '#d81f34', shade: '#8a0e1e', deep: '#5a0812', top: '#ffc0b0' };
const SOUL = { hi: '#d6e2ff', body: '#6a8cf6', shade: '#2c3c9c', deep: '#1e2a70', top: '#f0f4ff' };
/** art px of glass each ward band takes */
const WARD_ROWS = 3;

/**
 * Health lantern at UI (x, y). The glass holds the keeper's life as layers that
 * stack upward in the order they are spent, so a hit always takes the top
 * layer first: red lamp-oil (hearts) at the bottom, blue spirit-light (soul
 * hearts) on it, silver ward bands (one-hit shields) on top, and a flame on
 * the very top of the stack. Faint lines split the liquid into whole hearts; a
 * brass notch on the right post marks the red capacity.
 */
export function drawHealthLantern(r: Renderer, x: number, y: number, s: HealthState, alpha: number): void {
  if (alpha <= 0.01) return;
  const art = lanternArt.has('health');
  if (!art) blitFrame(r, 'health', false, x, y, alpha);
  const { gx, gy, gw, gh, rows: glassRows } = glassRect('health', x, y);
  const wards = Math.max(0, Math.min(s.shields, Math.floor((glassRows - 8) / WARD_ROWS)));
  const lifeRows = glassRows - wards * WARD_ROWS;
  const unit = (lifeRows * PX) / Math.max(2, s.scale);
  const bottom = gy + gh;
  const redTop = bottom - Math.round((s.red * unit) / PX) * PX;
  const soulTop = bottom - Math.round(((s.red + s.soul) * unit) / PX) * PX;
  const layer = (top: number, bot: number, c: typeof RED) => {
    if (bot - top <= 0) return;
    r.uiRect(gx, top, gw, bot - top, c.body, alpha);
    r.uiRect(gx, top, PX, bot - top, c.hi, alpha);
    r.uiRect(gx + gw - PX, top, PX, bot - top, c.shade, alpha);
    r.uiRect(gx + PX, top, gw - 2 * PX, PX, c.top, alpha * 0.9);
  };
  layer(redTop, bottom, RED);
  if (redTop < bottom) r.uiRect(gx, bottom - PX, gw, PX, RED.deep, alpha);
  layer(soulTop, redTop, SOUL);
  if (s.soul > 0 && soulTop < redTop) {
    // motes of spirit-light rising through the blue layer
    for (let i = 0; i < 2; i++) {
      const k = ((s.t * 0.6 + i * 0.5) % 1 + 1) % 1;
      const my = Math.round(redTop - PX - k * Math.max(0, redTop - soulTop - 2 * PX));
      r.uiRect(gx + (i ? gw - 3 * PX : 2 * PX), my, PX, PX, '#ffffff', alpha * (1 - k) * 0.85);
    }
  }
  // whole-heart lines across the liquid
  for (let k = 2; k < s.red + s.soul; k += 2) {
    const ly = bottom - Math.round((k * unit) / PX) * PX;
    if (ly > soulTop && ly < bottom) r.uiRect(gx + PX, ly, gw - 2 * PX, PX, C.ink, alpha * 0.32);
  }
  // ward bands stacked on top
  let top = soulTop;
  for (let i = 0; i < wards; i++) {
    const bt = top - WARD_ROWS * PX;
    r.uiRect(gx, bt, gw, WARD_ROWS * PX, '#c8d2e6', alpha);
    r.uiRect(gx, bt, gw, PX, '#ffffff', alpha);
    r.uiRect(gx, bt + (WARD_ROWS - 1) * PX, gw, PX, '#7a86a0', alpha);
    const glint = 0.5 + 0.5 * Math.sin(s.t * 4 + i * 1.7);
    r.uiRect(gx + gw / 2 - PX, bt + PX, PX * 2, PX, '#ffd060', alpha * (0.5 + 0.5 * glint));
    top = bt;
  }
  // the flame burns on top of whatever the keeper has left
  if (s.red + s.soul > 0) {
    const sway = Math.sin(s.t * 5) > 0.6 ? PX : 0;
    const gutter = s.low ? (Math.sin(s.t * 17) > 0 ? 2 : 3) : 4 + (Math.sin(s.t * 13) > 0.2 ? 1 : 0);
    const kind = wards > 0 ? 'ward' : s.soul > 0 ? 'soul' : 'red';
    const tone = kind === 'ward' ? ['#c8d2e6', '#fff4c8', '#ffffff'] : kind === 'soul' ? ['#6a8cf6', '#b8ccff', '#f0f6ff'] : ['#ff5a2a', '#ffb848', '#fff0b8'];
    flame(r, gx + gw / 2 + sway, top, gy, gutter, tone[0], tone[1], tone[2], alpha);
  }
  // red capacity notch on the right post
  const capY = bottom - Math.round((s.maxRed * unit) / PX) * PX;
  if (!art && capY >= gy) {
    r.uiRect(gx + gw, capY - PX, 2 * PX, PX * 2, C.ink, alpha);
    r.uiRect(gx + gw, capY - PX, PX, PX, '#ffe09a', alpha);
  }
  // bars only: a band across the middle would read as a layer boundary
  if (!art) glassCage(r, gx, gy, gw, gh, false, alpha, false);
  if (s.flash > 0) r.uiRect(gx, gy, gw, gh, '#ffffff', alpha * Math.min(1, s.flash) * 0.65);
  if (art) blitFrame(r, 'health', false, x, y, alpha);
}

/** Top of the health lantern's life stack (UI y), for effects that leave from it. */
export function healthStackTop(x: number, y: number, s: Pick<HealthState, 'red' | 'soul' | 'shields' | 'scale'>): { x: number; y: number } {
  const { gx, gw, gh, gy, rows } = glassRect('health', x, y);
  const wards = Math.max(0, Math.min(s.shields, Math.floor((rows - 8) / WARD_ROWS)));
  const unit = ((rows - wards * WARD_ROWS) * PX) / Math.max(2, s.scale);
  return { x: gx + gw / 2, y: Math.max(gy, gy + gh - (s.red + s.soul) * unit - wards * WARD_ROWS * PX) };
}

// ---------------------------------------------------------------- life cells
/**
 * Life is shown as a row of small lamp cells (생명 등잔) instead of hearts: a
 * glass vial with brass caps per heart container, filled with red lamp-oil
 * (half a heart = filled halfway), soul hearts as blue spirit-light, and one-hit
 * wards as silver diamonds.
 */
export type LifeCell = 'full' | 'half' | 'empty' | 'soul' | 'soulHalf' | 'ward';

/** Cell footprint (UI units, the lamp body; its flame burns FLAME_H above it) and the step between cells. */
export const CELL_W = 14;
export const CELL_H = 22;
export const CELL_STEP = 16;
export const FLAME_H = 8;

/** Lamp cell, art pixels: k ink, Y/y brass cap, d brass base, g glass (colored per kind). */
const CELL = [
  '..kkk..',
  '.kYyyk.',
  'kYYyydk',
  'kgggggk',
  'kgggggk',
  'kgggggk',
  'kgggggk',
  'kgggggk',
  'kgggggk',
  'kdddddk',
  '.kkkkk.',
];
const GLASS_TOP = 3;
const GLASS_ROWS = 6;

const WARD = [
  '...k...',
  '..kWk..',
  '.kWwwk.',
  'kWwywsk',
  '.kwssk.',
  '..ksk..',
  '...k...',
];
const WARD_PAL: Record<string, string> = { k: C.ink, W: '#ffffff', w: '#dfe6f4', s: '#9aa6c0', y: '#ffd060' };

const TONES = {
  red: { hi: '#ff9a8a', body: '#e2283a', shade: '#8e0f20', top: '#ffd0c4', flame: '#ff7a2a', core: '#ffe890' },
  soul: { hi: '#d4e0ff', body: '#6c8cf6', shade: '#2c3c9c', top: '#f0f4ff', flame: '#7a9af8', core: '#f0f6ff' },
} as const;

/** Flames (art px, 3 wide): a tall and a short frame for the flicker. */
const FLAME_TALL = ['.o.', '.c.', 'oco', '.o.'];
const FLAME_SHORT = ['...', '.o.', 'oco', '.o.'];

/** Pure painter of a lamp cell (tests / cache). */
export function paintLifeCell(kind: LifeCell): PixelPainter {
  const p = new PixelPainter(7, CELL.length + 2);
  if (kind === 'ward') {
    p.stamp(0, 3, WARD, WARD_PAL);
    return p;
  }
  p.stamp(0, 0, CELL, { k: C.ink, Y: '#ffe09a', y: '#e0a848', d: '#7a4e1c', g: '#21141b' });
  const soul = kind === 'soul' || kind === 'soulHalf';
  const t = soul ? TONES.soul : TONES.red;
  const level = kind === 'full' || kind === 'soul' ? GLASS_ROWS : kind === 'half' || kind === 'soulHalf' ? GLASS_ROWS / 2 : 0;
  for (let j = 0; j < GLASS_ROWS; j++) {
    const y = GLASS_TOP + j;
    const filled = j >= GLASS_ROWS - level;
    const surface = filled && j === GLASS_ROWS - level;
    for (let i = 1; i <= 5; i++) {
      let c: string;
      if (filled) c = surface && i > 1 && i < 5 ? t.top : i === 1 ? t.hi : i === 5 ? t.shade : t.body;
      else c = i === 1 ? '#3a2632' : '#21141b';
      p.px(i, y, c);
    }
  }
  if (level < GLASS_ROWS) p.px(2, GLASS_TOP + 1, '#5a3e4c');
  return p;
}

const cellCache = new Map<LifeCell, HTMLCanvasElement>();

function cellCanvas(kind: LifeCell): HTMLCanvasElement {
  let cv = cellCache.get(kind);
  if (!cv) {
    cv = paintLifeCell(kind).toCanvas();
    cellCache.set(kind, cv);
  }
  return cv;
}

/**
 * Draw one life cell with its body's top-left at UI (x, y) — a small oil lamp:
 * red lamp-oil per heart container (half a heart = half full) under a flame,
 * soul hearts as blue spirit-light, wards as silver diamonds. `scale` pops it
 * around its center, `flash` whitens it, `t` animates the flame / shimmer.
 */
export function drawLifeCell(r: Renderer, x: number, y: number, kind: LifeCell, o: { alpha?: number; scale?: number; flash?: number; t?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const sc = o.scale ?? 1;
  const t = o.t ?? 0;
  const d = r.dctx;
  d.save();
  d.translate(x + CELL_W / 2, y + CELL_H / 2);
  if (sc !== 1) d.scale(sc, sc);
  const L = -CELL_W / 2;
  const T = -CELL_H / 2;
  const cv = cellCanvas(kind);
  d.globalAlpha = clamp(a, 0, 1);
  d.imageSmoothingEnabled = false;
  d.drawImage(cv, L, T, cv.width * PX, cv.height * PX);
  d.globalAlpha = 1;
  if (kind !== 'ward' && kind !== 'empty') {
    // the lamp's flame (a small one for half a heart), flickering out of step with its neighbours
    const soul = kind === 'soul' || kind === 'soulHalf';
    const tone = soul ? TONES.soul : TONES.red;
    const half = kind === 'half' || kind === 'soulHalf';
    const tall = !half && Math.sin(t * 6 + x * 0.37) > -0.3;
    const rows = tall ? FLAME_TALL : FLAME_SHORT;
    const fx = L + 2 * PX;
    const fy = T - rows.length * PX + PX;
    for (let j = 0; j < rows.length; j++) {
      for (let i = 0; i < 3; i++) {
        const ch = rows[j][i];
        if (ch === '.') continue;
        r.uiRect(fx + i * PX, fy + j * PX, PX, PX, ch === 'c' ? tone.core : tone.flame, a);
      }
    }
    if (soul) {
      // a mote of spirit-light drifting up the glass
      const k = ((t * 0.7 + x * 0.013) % 1 + 1) % 1;
      const gy = T + GLASS_TOP * PX;
      r.uiRect(L + 3 * PX, Math.round(gy + (GLASS_ROWS - 1) * PX - k * (GLASS_ROWS - 1) * PX * (half ? 0.5 : 1)), PX, PX, '#ffffff', a * (1 - k) * 0.85);
    }
  } else if (kind === 'ward') {
    r.uiRect(L + 2 * PX, T + 3 * PX + 2 * PX, PX, PX, '#ffffff', a * (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 4))));
  }
  if (o.flash) r.uiRect(L, T, CELL_W, CELL_H, '#ffffff', a * Math.min(1, o.flash) * 0.6);
  d.restore();
}
