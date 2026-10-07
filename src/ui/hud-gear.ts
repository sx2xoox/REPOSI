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

// ---------------------------------------------------------------- lantern
/** Lantern housing in art pixels: k ink, Y/y/d brass ramp, G glass back. */
const LANTERN = [
  '......kkkkkk......',
  '.....kYyyyydk.....',
  '.....kyk..kdk.....',
  '.....kyk..kdk.....',
  '.....kkkkkkkk.....',
  '....kYYYyyyydk....',
  '..kkYyyyyyyyyddkk.',
  '.kkkkkkkkkkkkkkkk.',
  ...Array.from({ length: 15 }, () => '.kYkGGGGGGGGGGkdk.'),
  '.kkkkkkkkkkkkkkkk.',
  '.kYYYYYyyyyyyyydk.',
  '..kyyyyyyyyyyyyk..',
  '...kdddddddddddk..',
  '....kkkkkkkkkk....',
];

/** Lantern size and its glass chamber (art pixels, relative to the lantern's top-left). */
export const LANTERN_W = 18;
export const LANTERN_H = LANTERN.length;
export const LANTERN_GLASS = { x: 4, y: 8, w: 10, h: 15 } as const;

const LANTERN_PAL = {
  dim: { k: C.ink, Y: '#f0c87a', y: '#b8843c', d: '#6a4218', G: '#160d14' },
  lit: { k: C.ink, Y: '#fff4c8', y: '#ffc860', d: '#b07028', G: '#2a140c' },
} as const;

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

/** Pure painter for the lantern housing (tests / cache). */
export function paintLantern(lit: boolean): PixelPainter {
  const p = new PixelPainter(LANTERN_W, LANTERN_H);
  p.stamp(0, 0, LANTERN, lit ? LANTERN_PAL.lit : LANTERN_PAL.dim);
  return p;
}

export function lanternCanvas(lit: boolean): HTMLCanvasElement {
  return cached(`lantern|${lit ? 1 : 0}`, () => paintLantern(lit));
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

/**
 * Draw the lantern at UI (x, y): housing, ember filling the glass from the
 * bottom with a flame riding its surface, the cage bars and the glass gleam.
 */
export function drawLantern(r: Renderer, x: number, y: number, s: LanternState, alpha: number): void {
  if (alpha <= 0.01) return;
  blitArt(r, lanternCanvas(s.ready), x, y, alpha);
  const g = LANTERN_GLASS;
  const gx = x + g.x * PX;
  const gy = y + g.y * PX;
  const gw = g.w * PX;
  const gh = g.h * PX;
  const f = clamp(s.fill, 0, 1);
  const rows = Math.round(g.h * f);
  const pulse = 0.5 + 0.5 * Math.sin(s.t * 7);
  if (rows > 0) {
    // the ember glows hottest in the middle of the glass and darkest at its rim
    const fh = rows * PX;
    const top = gy + gh - fh;
    const ramp = s.ready
      ? [pulse > 0.5 ? '#fff8dc' : '#fff0b0', '#ffc850', '#ff8a28']
      : ['#ffb060', '#ee6428', '#a8341a'];
    r.uiRect(gx, top, gw, fh, ramp[2], alpha);
    r.uiRect(gx + PX, top, gw - 2 * PX, fh, ramp[1], alpha);
    r.uiRect(gx + 3 * PX, top, gw - 6 * PX, fh, ramp[0], alpha);
    // embers settle darker at the bottom; the surface line is the brightest
    r.uiRect(gx, gy + gh - PX, gw, PX, s.ready ? '#c86a18' : '#6a1e0c', alpha);
    r.uiRect(gx + PX, top, gw - 2 * PX, PX, s.ready ? '#ffffff' : '#ffd080', alpha * 0.9);
  }
  // the flame: a small teardrop riding the ember surface (a wick flame when empty)
  if (!s.ready && s.cooldown <= 0) {
    const surf = gy + gh - rows * PX;
    const flick = Math.sin(s.t * 13) > 0.2 ? PX : 0;
    const sway = Math.sin(s.t * 5) > 0.6 ? PX : 0;
    const cx = gx + gw / 2 + sway;
    const fh = (rows > 0 ? 4 : 3) * PX + flick;
    const fy = Math.max(gy, surf - fh);
    r.uiRect(cx - 2 * PX, surf - Math.min(fh, 2 * PX), PX * 4, Math.min(fh, 2 * PX), '#ff7a2a', alpha * 0.9);
    r.uiRect(cx - PX, fy + PX, PX * 2, surf - fy - PX, '#ffb848', alpha);
    r.uiRect(cx - PX, fy + 2 * PX, PX, Math.max(0, surf - fy - 3 * PX), '#fff0b8', alpha);
    r.uiRect(cx - PX, fy, PX, PX, '#ffd070', alpha);
  }
  // cage: two thin bars and a brass band around the glass's middle, then the gleam
  r.uiRect(gx + 3 * PX, gy, PX, gh, C.ink, alpha * 0.5);
  r.uiRect(gx + 6 * PX, gy, PX, gh, C.ink, alpha * 0.5);
  const band = gy + 7 * PX;
  r.uiRect(gx - PX, band, gw + 2 * PX, PX, s.ready ? '#ffc860' : '#b8843c', alpha);
  r.uiRect(gx - PX, band + PX, gw + 2 * PX, PX, C.ink, alpha * 0.8);
  r.uiRect(gx + PX, gy + PX, PX, PX * 4, '#ffffff', alpha * 0.3);
  if (s.flash > 0) r.uiRect(gx, gy, gw, gh, '#ffffff', alpha * s.flash * 0.7);
  if (s.cooldown > 0) {
    // shutter hatch while the release recovers
    for (let i = 0; i < g.h; i += 3) r.uiRect(gx, gy + i * PX, gw, PX, '#05030a', alpha * 0.55);
  }
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
