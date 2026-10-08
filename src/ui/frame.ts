// Procedural pixel-art frames ("9-slice" panels composed per size and cached),
// gauges, key caps, dividers and icon slots. Frames are painted at art
// resolution (1 art pixel = PX UI units = 1 world pixel) with PixelPainter so
// borders, corner studs and textures stay crisp at any size.

import { PixelPainter, bayer } from '../engine/painter';
import type { DrawOpts, Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import { getSprite } from '../engine/sprites';
import { clamp, mixColor } from '../engine/math';
import { C, PX } from './theme';

export type FrameStyle =
  | 'panel' | 'panelHi' | 'ornate' | 'inset' | 'slot' | 'slotHi' | 'parchment'
  | 'tooltip' | 'button' | 'buttonHi' | 'glass' | 'ribbon' | 'key' | 'keyDown';

type Paint = (p: PixelPainter, w: number, h: number, color: string) => void;

// ---------------------------------------------------------------- painting helpers
/** Paint a box with a 1px outline and 1px-rounded corners; returns nothing. */
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

/** Bevel just inside the outline: lit top/left, dark bottom/right. */
function bevel(p: PixelPainter, w: number, h: number, lit: string, dark: string): void {
  p.rect(2, 1, w - 4, 1, lit);
  p.rect(1, 2, 1, h - 4, lit);
  p.rect(2, h - 2, w - 4, 1, dark);
  p.rect(w - 2, 2, 1, h - 4, dark);
}

/** Ordered-dither vertical gradient of the interior (x0..x1, y0..y1). */
function ditherFill(p: PixelPainter, x0: number, y0: number, x1: number, y1: number, top: string, bottom: string, amount = 0.55): void {
  const h = Math.max(1, y1 - y0);
  for (let y = y0; y < y1; y++) {
    const t = (y - y0) / h;
    for (let x = x0; x < x1; x++) p.px(x, y, bayer(x, y) < (1 - t) * amount ? top : bottom);
  }
}

function hash(x: number, y: number): number {
  let n = x * 374761393 + y * 668265263;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const STUD = ['kkkk', 'kYyk', 'kydk', 'kkkk'];
const GEM = [
  '.kkkkk.',
  'kYYYYyk',
  'kYrRryk',
  'kYRrrdk',
  'kYrrrdk',
  'kyyyddk',
  '.kkkkk.',
];

function studs(p: PixelPainter, w: number, h: number, pal: Record<string, string>): void {
  p.stamp(1, 1, STUD, pal);
  p.stamp(w - 5, 1, STUD, pal);
  p.stamp(1, h - 5, STUD, pal);
  p.stamp(w - 5, h - 5, STUD, pal);
}

// ---------------------------------------------------------------- styles
const STYLES: Record<FrameStyle, Paint> = {
  panel(p, w, h) {
    roundBox(p, w, h, C.ink, C.panel);
    bevel(p, w, h, C.rim, C.rimDark);
    ditherFill(p, 2, 2, w - 2, h - 2, C.panelHi, C.panel, 0.5);
    p.rect(2, 2, w - 4, 1, '#30243e');
    if (w >= 10 && h >= 10) studs(p, w, h, { k: C.ink, Y: '#8a6a9a', y: '#5a4670', d: '#3a2c48' });
  },
  panelHi(p, w, h) {
    roundBox(p, w, h, C.ink, C.panelHi);
    bevel(p, w, h, C.goldHi, C.goldDark);
    ditherFill(p, 2, 2, w - 2, h - 2, '#33263f', '#251b30', 0.5);
    if (w >= 10 && h >= 10) studs(p, w, h, { k: C.ink, Y: C.goldHi, y: C.gold, d: C.goldDark });
  },
  ornate(p, w, h) {
    roundBox(p, w, h, C.ink, C.panel);
    bevel(p, w, h, '#ffd98a', '#9a6a2a');
    // ink gap + inner thin rim
    p.rectOutline(2, 2, w - 4, h - 4, C.ink);
    p.rectOutline(3, 3, w - 6, h - 6, '#3c2c4c');
    ditherFill(p, 4, 4, w - 4, h - 4, '#241a2e', '#160f1e', 0.6);
    if (w >= 16 && h >= 16) {
      const pal = { k: C.ink, Y: '#fff0b8', y: '#e0a848', d: '#8a5a20', r: '#ff9a3a', R: '#ffe080' };
      p.stamp(0, 0, GEM, pal);
      p.stamp(w - 7, 0, GEM, pal);
      p.stamp(0, h - 7, GEM, pal);
      p.stamp(w - 7, h - 7, GEM, pal);
    }
  },
  inset(p, w, h) {
    roundBox(p, w, h, C.ink, C.slot);
    p.rect(2, 1, w - 4, 1, '#050308');
    p.rect(1, 2, 1, h - 4, '#050308');
    p.rect(2, h - 2, w - 4, 1, '#2e2340');
    p.rect(w - 2, 2, 1, h - 4, '#2e2340');
  },
  slot(p, w, h) {
    roundBox(p, w, h, C.ink, '#140f1b');
    p.rect(2, 1, w - 4, 1, '#06040a');
    p.rect(1, 2, 1, h - 4, '#06040a');
    p.rect(2, h - 2, w - 4, 1, '#3a2c4a');
    p.rect(w - 2, 2, 1, h - 4, '#3a2c4a');
    ditherFill(p, 2, 2, w - 2, h - 2, '#0e0a14', '#1a1424', 0.5);
  },
  slotHi(p, w, h) {
    roundBox(p, w, h, C.ink, '#2a2034');
    bevel(p, w, h, C.goldHi, C.gold);
    p.rectOutline(2, 2, w - 4, h - 4, '#6a4a24');
    ditherFill(p, 3, 3, w - 3, h - 3, '#3a2c40', '#251c30', 0.5);
  },
  parchment(p, w, h) {
    roundBox(p, w, h, '#2a1608', '#a07a48');
    // burnt edge band then paper with fibre speckle
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        const edge = Math.min(x - 2, y - 2, w - 3 - x, h - 3 - y);
        const n = hash(x, y);
        let c: string = C.parchment;
        if (edge === 0) c = n < 0.5 ? '#c8a870' : '#bf9c64';
        else if (edge === 1 && n < 0.35) c = '#dcc494';
        else if (n < 0.07) c = '#dcc494';
        else if (n > 0.95) c = '#f4e6c4';
        p.px(x, y, c);
      }
    }
    p.rect(2, 1, w - 4, 1, '#d8b47c');
  },
  tooltip(p, w, h, color) {
    const rim = color || C.rim;
    roundBox(p, w, h, C.ink, '#120d18');
    bevel(p, w, h, rim, mixColor(rim, '#000000', 0.45));
    ditherFill(p, 2, 2, w - 2, h - 2, '#1c1524', '#120d18', 0.45);
  },
  button(p, w, h) {
    roundBox(p, w, h, C.ink, '#1f1729');
    bevel(p, w, h, '#3e3050', '#160f1e');
  },
  buttonHi(p, w, h) {
    roundBox(p, w, h, C.ink, '#2e2238');
    bevel(p, w, h, C.goldHi, '#8a5a20');
    ditherFill(p, 2, 2, w - 2, h - 2, '#3e2e44', '#2a1f34', 0.55);
  },
  glass(p, w, h) {
    roundBox(p, w, h, '#05030ad0', '#0a0710b0');
    bevel(p, w, h, '#5a4a6ca0', '#1a1424a0');
    p.rect(2, 2, w - 4, 1, '#ffffff14');
  },
  ribbon(p, w, h, color) {
    const rim = color || C.gold;
    roundBox(p, w, h, C.ink, '#140e1a');
    p.rect(2, 1, w - 4, 1, rim);
    p.rect(2, h - 2, w - 4, 1, mixColor(rim, '#000000', 0.5));
    ditherFill(p, 1, 2, w - 1, h - 2, '#221a2c', '#140e1a', 0.5);
    p.rect(1, 2, 1, h - 4, rim);
    p.rect(w - 2, 2, 1, h - 4, mixColor(rim, '#000000', 0.5));
  },
  key(p, w, h) {
    roundBox(p, w, h, C.ink, '#d8d0e4');
    p.rect(2, 1, w - 4, 1, '#ffffff');
    p.rect(2, h - 2, w - 4, 1, '#8a7ea0');
    p.px(1, h - 3, '#b0a6c4');
    p.px(w - 2, h - 3, '#b0a6c4');
  },
  keyDown(p, w, h) {
    roundBox(p, w, h, C.ink, '#ffe8a8');
    p.rect(2, 1, w - 4, 1, '#ffffff');
    p.rect(2, h - 2, w - 4, 1, '#c08a3a');
  },
};

// ---------------------------------------------------------------- cache
const cache = new Map<string, HTMLCanvasElement>();
const MAX_CACHE = 240;

/** Paint a frame into a PixelPainter (pure; usable from tests). */
export function paintFrame(style: FrameStyle, pw: number, ph: number, color = ''): PixelPainter {
  const p = new PixelPainter(pw, ph);
  STYLES[style](p, pw, ph, color);
  return p;
}

function frameCanvas(style: FrameStyle, pw: number, ph: number, color: string): HTMLCanvasElement {
  const key = `${style}|${pw}|${ph}|${color}`;
  let cv = cache.get(key);
  if (cv) return cv;
  if (cache.size >= MAX_CACHE) {
    // drop the oldest half (insertion order)
    let n = 0;
    for (const k of cache.keys()) {
      cache.delete(k);
      if (++n >= MAX_CACHE / 2) break;
    }
  }
  cv = paintFrame(style, pw, ph, color).toCanvas();
  cache.set(key, cv);
  return cv;
}

export interface FrameOpts {
  /** rim color for 'tooltip' / 'ribbon' */
  color?: string;
  alpha?: number;
}

/** Draw a pixel-art frame filling the UI rect (x, y, w, h). */
export function frame(r: Renderer, x: number, y: number, w: number, h: number, style: FrameStyle = 'panel', o: FrameOpts = {}): void {
  const pw = Math.max(4, Math.round(w / PX));
  const ph = Math.max(4, Math.round(h / PX));
  const a = o.alpha ?? 1;
  if (a <= 0) return;
  const d = r.dctx;
  d.globalAlpha = clamp(a, 0, 1);
  d.imageSmoothingEnabled = false;
  d.drawImage(frameCanvas(style, pw, ph, o.color ?? ''), Math.round(x), Math.round(y), pw * PX, ph * PX);
  d.globalAlpha = 1;
}

// ---------------------------------------------------------------- gauges
export interface GaugeOpts {
  fill: string;
  hi?: string;
  lo?: string;
  back?: string;
  /** draw tick marks dividing the bar into n segments */
  segments?: number;
  /** fraction of a trailing (recently lost) section, drawn behind the fill */
  trail?: number;
  trailColor?: string;
  alpha?: number;
  /** extra white flash over the fill 0..1 */
  flash?: number;
}

/** Pixel gauge with outline, recessed back, lit fill, optional damage trail and ticks. */
export function gauge(r: Renderer, x: number, y: number, w: number, h: number, frac: number, o: GaugeOpts): void {
  const a = o.alpha ?? 1;
  const f = clamp(frac, 0, 1);
  x = Math.round(x);
  y = Math.round(y);
  r.uiRect(x, y + PX, w, h - PX * 2, C.ink, a);
  r.uiRect(x + PX, y, w - PX * 2, h, C.ink, a);
  const ix = x + PX;
  const iy = y + PX;
  const iw = w - PX * 2;
  const ih = h - PX * 2;
  r.uiRect(ix, iy, iw, ih, o.back ?? '#1a1020', a);
  r.uiRect(ix, iy, iw, PX, '#00000080', a);
  if (o.trail !== undefined && o.trail > f) {
    r.uiRect(ix, iy, Math.round(iw * clamp(o.trail, 0, 1)), ih, o.trailColor ?? '#fff0d0', a);
  }
  const fw = Math.round(iw * f);
  if (fw > 0) {
    r.uiRect(ix, iy, fw, ih, o.fill, a);
    r.uiRect(ix, iy, fw, Math.max(PX, Math.round(ih * 0.3)), o.hi ?? mixColor(o.fill, '#ffffff', 0.45), a);
    r.uiRect(ix, iy + ih - PX, fw, PX, o.lo ?? mixColor(o.fill, '#000000', 0.4), a);
    if (o.flash && o.flash > 0) r.uiRect(ix, iy, fw, ih, '#ffffff', a * clamp(o.flash, 0, 1));
  }
  if (o.segments && o.segments > 1) {
    for (let i = 1; i < o.segments; i++) {
      const sx = ix + Math.round((iw * i) / o.segments) - 1;
      r.uiRect(sx, iy, PX, ih, C.ink, a * 0.85);
    }
  }
}

// ---------------------------------------------------------------- key caps
const PAD_COLORS: Record<string, string> = { A: '#4ac060', B: '#e04a4a', X: '#4a8ae0', Y: '#e0c040' };

/**
 * Draw a key / button glyph with its label centered at (x, y) (vertical center).
 * Returns the width used. `align` decides whether x is the left edge or center.
 */
export function keycap(r: Renderer, label: string, x: number, y: number, o: { align?: 'left' | 'center' | 'right'; alpha?: number; down?: boolean; pad?: boolean } = {}): number {
  if (!label) return 0; // no key (touch mode)
  const a = o.alpha ?? 1;
  const isPadFace = !!o.pad && PAD_COLORS[label] !== undefined;
  const tw = r.measureText(label, 10, false, 'small');
  const w = isPadFace ? 18 : Math.max(18, Math.ceil((tw + 10) / PX) * PX);
  const h = 18;
  let lx = x;
  if (o.align === 'center' || o.align === undefined) lx = x - w / 2;
  else if (o.align === 'right') lx = x - w;
  const ty = Math.round(y - h / 2);
  if (isPadFace) {
    const d = r.dctx;
    d.globalAlpha = a;
    d.fillStyle = C.ink;
    d.beginPath();
    d.arc(lx + w / 2, ty + h / 2, 9, 0, Math.PI * 2);
    d.fill();
    d.fillStyle = PAD_COLORS[label];
    d.beginPath();
    d.arc(lx + w / 2, ty + h / 2 - 0.5, 7.5, 0, Math.PI * 2);
    d.fill();
    d.globalAlpha = 1;
    r.uiText(label, lx + w / 2, ty + 4, { size: 10, font: 'small', align: 'center', color: '#ffffff', alpha: a, shadow: C.ink });
  } else {
    frame(r, lx, ty, w, h, o.down ? 'keyDown' : 'key', { alpha: a });
    r.uiText(label, lx + w / 2, ty + 3, { size: 10, font: 'small', align: 'center', color: '#140c1c', alpha: a, shadow: false });
  }
  return w;
}

/** A key cap followed by a label; returns total width. */
export function keyHint(r: Renderer, key: string, label: string, x: number, y: number, o: { alpha?: number; color?: string; pad?: boolean } = {}): number {
  const kw = keycap(r, key, x, y, { align: 'left', alpha: o.alpha, pad: o.pad });
  r.uiText(label, x + (kw ? kw + 4 : 0), y - 5, { size: 10, font: 'small', color: o.color ?? C.textDim, alpha: o.alpha });
  return kw + 4 + r.measureText(label, 10, false, 'small');
}

/** Measure what keyHint() would use without drawing. */
export function keyHintWidth(r: Renderer, key: string, label: string, pad = false): number {
  if (!key) return r.measureText(label, 10, false, 'small');
  const tw = r.measureText(key, 10, false, 'small');
  const kw = pad && PAD_COLORS[key] !== undefined ? 18 : Math.max(18, Math.ceil((tw + 10) / PX) * PX);
  return kw + 4 + r.measureText(label, 10, false, 'small');
}

/** Draw a row of key hints centered at cx. */
export function keyHintRow(r: Renderer, hints: [string, string][], cx: number, y: number, o: { alpha?: number; gap?: number; pad?: boolean } = {}): void {
  const gap = o.gap ?? 14;
  const widths = hints.map(([k, l]) => keyHintWidth(r, k, l, o.pad));
  const total = widths.reduce((s, v) => s + v, 0) + gap * (hints.length - 1);
  let x = cx - total / 2;
  hints.forEach(([k, l], i) => {
    keyHint(r, k, l, x, y, { alpha: o.alpha, pad: o.pad });
    x += widths[i] + gap;
  });
}

// ---------------------------------------------------------------- ornaments
/** Horizontal ornament line fading at both ends with a diamond in the middle. */
/** Draw coloured text runs left to right (one line); returns the width used. */
export function drawRuns(r: Renderer, runs: readonly { t: string; c: string }[], x: number, y: number, o: { size: number; font?: 'main' | 'small'; bold?: boolean; alpha?: number }): number {
  const font = o.font ?? 'main';
  let cx = x;
  for (const s of runs) {
    r.uiText(s.t, cx, y, { size: o.size, font, bold: o.bold, color: s.c, alpha: o.alpha });
    cx += r.measureText(s.t, o.size, !!o.bold, font);
  }
  return cx - x;
}

export function divider(r: Renderer, cx: number, y: number, w: number, color: string = C.gold, alpha = 1): void {
  const d = r.dctx;
  const half = w / 2;
  const steps = 8;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const a = alpha * (1 - t0) * 0.9;
    const seg = half / steps;
    r.uiRect(Math.round(cx + 6 + i * seg), Math.round(y), Math.ceil(seg), PX, color, a);
    r.uiRect(Math.round(cx - 6 - (i + 1) * seg), Math.round(y), Math.ceil(seg), PX, color, a);
  }
  d.globalAlpha = alpha;
  d.fillStyle = C.ink;
  d.fillRect(cx - 5, y - 3, 10, 8);
  d.fillStyle = color;
  d.fillRect(cx - 3, y - 1, 6, 4);
  d.fillRect(cx - 1, y - 3, 2, 8);
  d.globalAlpha = 1;
}

/** Item / icon slot: frame + centered sprite. `size` is the slot size in UI units. */
export function iconSlot(r: Renderer, icon: string | null, cx: number, cy: number, size: number, o: { selected?: boolean; alpha?: number; silhouette?: boolean; scale?: number; dim?: boolean } = {}): void {
  frame(r, cx - size / 2, cy - size / 2, size, size, o.selected ? 'slotHi' : 'slot', { alpha: o.alpha });
  if (!icon) return;
  const s = o.scale ?? fitScale(icon, size - 10, 2);
  spriteCentered(r, icon, cx, cy, s, {
    alpha: (o.alpha ?? 1) * (o.dim ? 0.45 : 1),
    tint: o.silhouette ? '#05030a' : undefined,
    tintAmount: o.silhouette ? 1 : 0,
  });
}

/** Draw a sprite so its bounding box (not its pivot) is centered at (cx, cy). */
export function spriteCentered(r: Renderer, name: string, cx: number, cy: number, scale: number, o: DrawOpts = {}): void {
  const s = getSprite(name);
  r.uiSprite(name, cx + (s.ox - s.w / 2) * scale, cy + (s.oy - s.h / 2) * scale, scale, o);
}

/** Largest scale (multiple of 0.5, at most `max`) so the sprite fits a `box` UI-unit square. */
export function fitScale(icon: string, box: number, max = 2): number {
  const s = getSprite(icon);
  const m = Math.max(s.w, s.h, 1);
  let k = Math.min(max, box / m);
  k = Math.max(0.5, Math.floor(k * 2) / 2);
  return k;
}

const glowCache = new Map<string, HTMLCanvasElement>();
const GLOW_SIZE = 128;

/** Radial glow bitmap per color (drawn scaled: no gradient object per frame). */
function glowSprite(color: string): HTMLCanvasElement {
  let c = glowCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = GLOW_SIZE;
  const g = c.getContext('2d')!;
  const h = GLOW_SIZE / 2;
  const gr = g.createRadialGradient(h, h, 0, h, h, h);
  gr.addColorStop(0, color);
  gr.addColorStop(0.4, color + '80');
  gr.addColorStop(1, color + '00');
  g.fillStyle = gr;
  g.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
  glowCache.set(color, c);
  return c;
}

/** Soft radial glow (additive) in UI space — used behind logos, ready icons, flares. */
export function glow(r: Renderer, x: number, y: number, radius: number, color: string, alpha = 0.5): void {
  if (alpha <= 0 || radius <= 0) return;
  const d = r.dctx;
  const op = d.globalCompositeOperation;
  const ga = d.globalAlpha;
  const sm = d.imageSmoothingEnabled;
  d.globalCompositeOperation = 'lighter';
  d.globalAlpha = clamp(alpha, 0, 1);
  d.imageSmoothingEnabled = true;
  d.drawImage(glowSprite(color), x - radius, y - radius, radius * 2, radius * 2);
  d.imageSmoothingEnabled = sm;
  d.globalAlpha = ga;
  d.globalCompositeOperation = op;
}

/** Full-screen dim layer with a soft vignette (overlays). */
export function dimScreen(r: Renderer, alpha: number, color: string = C.void): void {
  r.uiRect(0, 0, UI_W, UI_H, color, clamp(alpha, 0, 1)); // full UI space = whole screen (see Renderer.uiRect)
}
