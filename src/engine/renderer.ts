// Renderer: a low-resolution "world" canvas (VIEW_W x VIEW_H) that is scaled up
// with nearest-neighbour filtering, plus a high-resolution UI layer drawn directly
// on the display canvas in a virtual UI_W x UI_H coordinate space.
//
// Adaptive viewport: the world is always 216 px tall (consistent pixel size) and
// its WIDTH follows the screen's aspect ratio (VIEW_W_MIN..VIEW_W_MAX), so wide
// phones (19.5:9, 20:9, 21:9) are filled edge to edge instead of letterboxed.
// VIEW_W / UI_W are live ES-module bindings updated by `Renderer.resize()`; read
// them at use time (never cache them at module load). On 16:9 they are exactly
// 384 / 768 as before. Taller-than-16:9 screens (tablets) narrow the world down
// to VIEW_W_MIN (a 1x1 room's interior always stays visible) while the UI keeps a
// 768x432 band centered vertically; `uiSafe` holds the device safe-area insets
// (rounded corners, notch, home indicator) in UI units for edge-anchored HUD.

import { getFlash, getSprite, getTintCanvas, animFrame, type Sprite } from './sprites';
import { clamp, TAU } from './math';
import { fx } from './rng';
import { cssViewportSize, safeInsets, type Insets } from './viewport';
import { PIXEL_GLYPHS, fontTextBitmap, fontTextStyle, fontTextWidth, pixelFontCovers } from './worldtext';

export const VIEW_H = 216;
export const UI_H = 432;
/** the classic 16:9 world width (and UI width) the game was laid out for */
export const VIEW_W_BASE = 384;
export const UI_W_BASE = 768;
/** narrowest world view: a 1x1 room's interior (+ part of its walls) always fits */
export const VIEW_W_MIN = 304;
/** widest world view (~2.37:1, e.g. 2560x1080); wider screens are pillarboxed */
export const VIEW_W_MAX = 512;
/** current world view width in px (live binding; even, VIEW_W_MIN..VIEW_W_MAX) */
export let VIEW_W = VIEW_W_BASE;
/** current UI space width (live binding; max(768, 2 * VIEW_W)) */
export let UI_W = UI_W_BASE;

export interface ViewportFit {
  viewW: number;
  uiW: number;
  /** display px per world px */
  scale: number;
  offsetX: number;
  offsetY: number;
  /** display px per UI unit */
  uiScale: number;
  uiOffsetX: number;
  uiOffsetY: number;
}

/**
 * Fit the world (VIEW_H tall, adaptive width) and the UI space into a display
 * of w x h backing pixels. Pure (unit-tested).
 */
export function fitViewport(w: number, h: number, pixelPerfect = false): ViewportFit {
  w = Math.max(1, w);
  h = Math.max(1, h);
  let s = h / VIEW_H;
  if (pixelPerfect && s >= 1) s = Math.floor(s);
  const raw = w / s;
  // fill the width (crop < 1 world px); screens within half a pixel of 16:9 stay exactly 384
  let viewW = Math.abs(raw - VIEW_W_BASE) < 0.5 ? VIEW_W_BASE : Math.ceil(raw - 1e-6);
  viewW += viewW & 1;
  if (viewW > VIEW_W_MAX) viewW = VIEW_W_MAX;
  if (viewW < VIEW_W_MIN) {
    viewW = VIEW_W_MIN;
    s = Math.min(s, w / VIEW_W_MIN);
    if (pixelPerfect && s >= 1) s = Math.floor(s);
  }
  const offsetX = Math.round((w - viewW * s) / 2);
  const offsetY = Math.round((h - VIEW_H * s) / 2);
  if (viewW * 2 >= UI_W_BASE) {
    return { viewW, uiW: viewW * 2, scale: s, offsetX, offsetY, uiScale: s / 2, uiOffsetX: offsetX, uiOffsetY: offsetY };
  }
  // taller than 16:9: the UI keeps its 768x432 layout in a band as wide as the world image
  const uiScale = (viewW * s) / UI_W_BASE;
  return { viewW, uiW: UI_W_BASE, scale: s, offsetX, offsetY, uiScale, uiOffsetX: offsetX, uiOffsetY: Math.round((h - UI_H * uiScale) / 2) };
}

/** x offset that centers a 768-wide (16:9) layout in the current UI space (full-panel overlays). */
export function uiCenterX(): number {
  return Math.max(0, Math.round((UI_W - UI_W_BASE) / 2));
}

/** Override the live view size (tests / tools); the renderer calls this on resize. */
export function setViewSize(viewW: number, uiW = Math.max(UI_W_BASE, viewW * 2)): void {
  VIEW_W = viewW;
  UI_W = uiW;
}

export interface DrawOpts {
  flipX?: boolean;
  flipY?: boolean;
  /** rotation in radians around the pivot */
  rot?: number;
  sx?: number;
  sy?: number;
  alpha?: number;
  /** 0..1 white flash amount */
  flash?: number;
  /** silhouette tint color + amount 0..1 */
  tint?: string;
  tintAmount?: number;
  additive?: boolean;
}

export interface TextOpts {
  size?: number;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  bold?: boolean;
  /** drop shadow color, or false. default '#000000aa' style shadow */
  shadow?: string | false;
  outline?: string;
  alpha?: number;
  font?: 'main' | 'small';
}

// ---------------------------------------------------------------- tiny world font
// 3x5 bitmap glyphs for numbers / short words drawn in world space (damage numbers
// etc.) live in ./worldtext with the Galmuri path for texts they cannot draw (Hangul).

// ---------------------------------------------------------------- measure cache
/**
 * Measured text widths: text -> flat [styleKey, width, styleKey, width ...]
 * (a lookup builds no key string; UI layout measures every frame).
 */
const widthCache = new Map<string, number[]>();
let widthCount = 0;
const WIDTH_CACHE_MAX = 3000;
/** wrapText results: text -> [styleKey, maxWidth, lines, ...] (dropped together with the widths) */
const wrapCache = new Map<string, (number | string[])[]>();
const WRAP_CACHE_MAX = 600;
let fontsWatched = false;

function clearTextMetrics(): void {
  widthCache.clear();
  widthCount = 0;
  wrapCache.clear();
}

/** Widths measured before the web fonts loaded are wrong: drop the cache when fonts finish loading. */
function watchFonts(): void {
  if (fontsWatched || typeof document === 'undefined' || !document.fonts) return;
  fontsWatched = true;
  document.fonts.addEventListener?.('loadingdone', clearTextMetrics);
  void document.fonts.ready?.then(clearTextMetrics);
}

/** Number identifying a (size, bold, font) text style (sizes are < 1e6 UI units, fractions allowed). */
function styleKey(size: number, bold: boolean, font: 'main' | 'small'): number {
  return size + (bold ? 1e6 : 0) + (font === 'small' ? 2e6 : 0);
}

// ---------------------------------------------------------------- bitmap caches
/** one cached pixel-text bitmap: the (raw) text in a style */
interface TextEntry {
  s: number;
  color: string;
  outline: string;
  canvas: HTMLCanvasElement;
  /** rendered (upper-cased) length */
  len: number;
}
/**
 * Pixel-text bitmaps keyed by the raw text, then a short list of styles: a hit
 * builds no key string and upper-cases nothing (damage numbers draw every frame).
 */
const textCache = new Map<string, TextEntry[]>();
let textCount = 0;
const TEXT_CACHE_MAX = 400;

function textEntry(str: string, color: string, outline: string | undefined, s: number): TextEntry {
  const ol = outline ?? '';
  let list = textCache.get(str);
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.s === s && e.color === color && e.outline === ol) {
        // LRU: move the text to the newest end (only when it is not already there)
        if (textCache.size > 1) {
          textCache.delete(str);
          textCache.set(str, list);
        }
        return e;
      }
    }
  }
  if (textCount >= TEXT_CACHE_MAX) {
    // evict the least recently used quarter (not the whole cache)
    let n = 0;
    for (const [k, l] of textCache) {
      textCache.delete(k);
      textCount -= l.length;
      n += l.length;
      if (n >= TEXT_CACHE_MAX / 4) break;
    }
    list = textCache.get(str);
  }
  if (!list) textCache.set(str, (list = []));
  const up = str.toUpperCase();
  const e: TextEntry = { s, color, outline: ol, canvas: textBitmap(up, color, outline, s), len: up.length };
  list.push(e);
  textCount++;
  return e;
}

/** Pixel text (with optional 8-way outline) rendered once into a canvas with a `scale` px margin. */
function textBitmap(up: string, color: string, outline: string | undefined, s: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, (up.length * 4 - 1) * s + 2 * s);
  cv.height = 7 * s;
  const c = cv.getContext('2d')!;
  const glyphs = (ox: number, oy: number, col: string) => {
    c.fillStyle = col;
    for (let i = 0; i < up.length; i++) {
      const g = PIXEL_GLYPHS[up[i]];
      if (!g) continue;
      for (let r = 0; r < 5; r++) {
        for (let k = 0; k < 3; k++) {
          if (g[r][k] === '1') c.fillRect(s + ox + (i * 4 + k) * s, s + oy + r * s, s, s);
        }
      }
    }
  };
  if (outline) {
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) glyphs(ox * s, oy * s, outline);
  }
  glyphs(0, 0, color);
  return cv;
}

const NO_TEXT_OPTS = {};
const NO_COVERS: readonly number[] = [];

const shadowCache = new Map<number, { canvas: HTMLCanvasElement; cx: number; cy: number }>();

/** Black anti-aliased ellipse (radii quantized to 0.25 px), centered on an integer pixel. */
function shadowSprite(rx: number, ry: number): { canvas: HTMLCanvasElement; cx: number; cy: number } {
  const qx = Math.round(rx * 4);
  const qy = Math.round(ry * 4);
  const key = qx * 1024 + qy;
  let s = shadowCache.get(key);
  if (s) return s;
  const cx = Math.ceil(qx / 4) + 1;
  const cy = Math.ceil(qy / 4) + 1;
  const canvas = document.createElement('canvas');
  canvas.width = cx * 2;
  canvas.height = cy * 2;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#000000';
  c.beginPath();
  c.ellipse(cx, cy, qx / 4, qy / 4, 0, 0, TAU);
  c.fill();
  s = { canvas, cx, cy };
  shadowCache.set(key, s);
  return s;
}

export class Renderer {
  readonly display: HTMLCanvasElement;
  readonly dctx: CanvasRenderingContext2D;
  readonly world: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  /** display pixels per world pixel */
  scale = 1;
  /** display pixels per UI unit */
  uiScale = 0.5;
  /** display px position of the world image's top-left corner */
  offsetX = 0;
  offsetY = 0;
  /** display px position of the UI space's (0, 0) */
  uiOffsetX = 0;
  uiOffsetY = 0;
  /** device safe-area insets in UI units (inside the UI space; 0 on desktop) */
  uiSafe: Insets = { l: 0, r: 0, t: 0, b: 0 };
  /** bumped whenever VIEW_W changes (consumers with view-sized canvases can compare) */
  viewVersion = 0;
  pixelPerfect = false;
  /** cap on window.devicePixelRatio for the display canvas (graphics quality); call resize() after changing */
  maxDpr = 2;

  // camera (world coords of the view's top-left corner)
  camX = 0;
  camY = 0;
  private shakeTrauma = 0;
  private kickX = 0;
  private kickY = 0;
  shakeX = 0;
  shakeY = 0;
  shakeIntensity = 1; // settings multiplier
  private time = 0;

  // full-screen overlays
  flashColor = '#ffffff';
  flashAlpha = 0;
  flashIntensity = 1;

  /**
   * Frame interpolation (set by the main loop for each drawn frame): the
   * fraction (0..1) of a fixed simulation step elapsed since the latest step.
   * 1 = draw the latest simulated state as is.
   */
  alpha = 1;
  /** Draw-only multiplier for world primitives; scoped by projectile drawing. */
  worldOpacity = 1;
  /**
   * Fixed simulation steps run so far (incremented by the main loop before
   * each step), so a simulation can tell whether it was stepped in the latest
   * one (a paused / covered world must not interpolate).
   */
  simStep = 0;
  /** world frames begun (beginWorld); dates the UI covers below */
  drawFrame = 0;
  /** UI rects drawn over the world (world canvas px, flat x, y, w, h) by the UI pass of frame `coversFrame` */
  private covers: number[] = [];
  private coversFrame = -1;

  constructor(display: HTMLCanvasElement) {
    this.display = display;
    this.dctx = display.getContext('2d', { alpha: false })!;
    this.world = document.createElement('canvas');
    this.world.width = VIEW_W;
    this.world.height = VIEW_H;
    // opaque: beginWorld() fills it every frame, so the upscale blit needs no blending
    this.ctx = this.world.getContext('2d', { alpha: false })!;
    this.ctx.imageSmoothingEnabled = false;
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, Math.max(0.5, this.maxDpr));
    const css = cssViewportSize(this.display);
    const w = Math.max(1, Math.round(css.w * dpr));
    const h = Math.max(1, Math.round(css.h * dpr));
    if (this.display.width !== w || this.display.height !== h) {
      this.display.width = w;
      this.display.height = h;
    }
    const f = fitViewport(w, h, this.pixelPerfect);
    if (f.viewW !== VIEW_W || f.uiW !== UI_W) {
      setViewSize(f.viewW, f.uiW);
      this.viewVersion++;
    }
    if (this.world.width !== VIEW_W || this.world.height !== VIEW_H) {
      this.world.width = VIEW_W;
      this.world.height = VIEW_H;
      this.ctx.imageSmoothingEnabled = false;
    }
    this.scale = f.scale;
    this.offsetX = f.offsetX;
    this.offsetY = f.offsetY;
    this.uiScale = f.uiScale;
    this.uiOffsetX = f.uiOffsetX;
    this.uiOffsetY = f.uiOffsetY;
    // safe area (CSS px from the screen edges) -> UI units inside the UI space
    const sa = safeInsets();
    const k = w / Math.max(1, css.w); // backing px per CSS px
    const us = this.uiScale;
    this.uiSafe = {
      l: Math.max(0, (sa.l * k - this.uiOffsetX) / us),
      r: Math.max(0, (this.uiOffsetX + UI_W * us - (w - sa.r * k)) / us),
      t: Math.max(0, (sa.t * k - this.uiOffsetY) / us),
      b: Math.max(0, (this.uiOffsetY + UI_H * us - (h - sa.b * k)) / us),
    };
    this.dctx.imageSmoothingEnabled = false;
  }

  /** Convert display (canvas backing) coords to UI coords. */
  displayToUI(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.uiOffsetX) / this.uiScale, y: (y - this.uiOffsetY) / this.uiScale };
  }

  /** Convert world coords (camera applied) to display (canvas backing) coords. */
  worldToDisplay(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.viewX) * this.scale + this.offsetX, y: (y - this.viewY) * this.scale + this.offsetY };
  }

  /** Convert display coords to world coords (camera applied). */
  displayToWorld(x: number, y: number): { x: number; y: number } {
    return {
      x: (x - this.offsetX) / this.scale + this.camX,
      y: (y - this.offsetY) / this.scale + this.camY,
    };
  }

  // ------------------------------------------------------------ camera / shake
  /** Add screen shake trauma (0..1). Shake magnitude ~ trauma^2. */
  shake(amount: number): void {
    this.shakeTrauma = clamp(this.shakeTrauma + amount * this.shakeIntensity, 0, 1);
  }

  /** Directional camera kick (e.g. recoil). */
  kick(dx: number, dy: number): void {
    this.kickX += dx * this.shakeIntensity;
    this.kickY += dy * this.shakeIntensity;
  }

  screenFlash(color: string, alpha: number): void {
    this.flashColor = color;
    this.flashAlpha = Math.max(this.flashAlpha, alpha);
  }

  updateEffects(dt: number): void {
    this.time += dt;
    this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 1.6);
    const t = this.shakeTrauma * this.shakeTrauma;
    const mag = 7 * t;
    this.shakeX = (fx.next() * 2 - 1) * mag + this.kickX;
    this.shakeY = (fx.next() * 2 - 1) * mag + this.kickY;
    const k = Math.exp(-dt * 18);
    this.kickX *= k;
    this.kickY *= k;
    this.flashAlpha = Math.max(0, this.flashAlpha - dt * 3);
  }

  /** Integer camera offset actually used for drawing this frame. */
  get viewX(): number {
    return Math.round(this.camX + this.shakeX);
  }

  get viewY(): number {
    return Math.round(this.camY + this.shakeY);
  }

  // ------------------------------------------------------------ world drawing
  beginWorld(clearColor = '#0b0710'): void {
    this.drawFrame++;
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = clearColor;
    c.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  /** Draw a sprite with its pivot at world position (x, y). */
  sprite(name: string, x: number, y: number, o?: DrawOpts): void {
    this.drawSprite(getSprite(name), x - this.viewX, y - this.viewY, o);
  }

  /** Draw a frame of an animation. */
  anim(anim: string, t: number, x: number, y: number, o?: DrawOpts): void {
    this.sprite(animFrame(anim, t), x, y, o);
  }

  /** Draw a sprite at *screen* position (no camera). */
  spriteScreen(name: string, x: number, y: number, o?: DrawOpts): void {
    this.drawSprite(getSprite(name), x, y, o);
  }

  private drawSprite(s: Sprite, x: number, y: number, o?: DrawOpts): void {
    const c = this.ctx;
    const alpha = (o?.alpha ?? 1) * this.worldOpacity;
    if (alpha <= 0) return;
    const simple = !o || (!o.flipX && !o.flipY && !o.rot && (o.sx ?? 1) === 1 && (o.sy ?? 1) === 1);
    c.globalAlpha = alpha;
    if (o?.additive) c.globalCompositeOperation = 'lighter';
    if (simple) {
      const dx = Math.round(x - s.ox);
      const dy = Math.round(y - s.oy);
      c.drawImage(s.canvas, dx, dy);
      if (o?.tint && (o.tintAmount ?? 1) > 0) {
        c.globalAlpha = alpha * (o.tintAmount ?? 1);
        c.drawImage(getTintCanvas(s, o.tint), dx, dy);
      }
      if (o?.flash && o.flash > 0) {
        c.globalAlpha = alpha * clamp(o.flash, 0, 1);
        c.drawImage(getFlash(s), dx, dy);
      }
    } else {
      c.save();
      c.translate(Math.round(x), Math.round(y));
      if (o!.rot) c.rotate(o!.rot);
      c.scale((o!.flipX ? -1 : 1) * (o!.sx ?? 1), (o!.flipY ? -1 : 1) * (o!.sy ?? 1));
      c.drawImage(s.canvas, -s.ox, -s.oy);
      if (o!.tint && (o!.tintAmount ?? 1) > 0) {
        c.globalAlpha = alpha * (o!.tintAmount ?? 1);
        c.drawImage(getTintCanvas(s, o!.tint), -s.ox, -s.oy);
      }
      if (o!.flash && o!.flash > 0) {
        c.globalAlpha = alpha * clamp(o!.flash, 0, 1);
        c.drawImage(getFlash(s), -s.ox, -s.oy);
      }
      c.restore();
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  rect(x: number, y: number, w: number, h: number, color: string, alpha = 1): void {
    const c = this.ctx;
    c.globalAlpha = alpha * this.worldOpacity;
    c.fillStyle = color;
    c.fillRect(Math.round(x - this.viewX), Math.round(y - this.viewY), Math.round(w), Math.round(h));
    c.globalAlpha = 1;
  }

  circle(x: number, y: number, r: number, color: string, alpha = 1): void {
    const c = this.ctx;
    c.globalAlpha = alpha * this.worldOpacity;
    c.fillStyle = color;
    c.beginPath();
    c.arc(Math.round(x - this.viewX), Math.round(y - this.viewY), Math.max(0.5, r), 0, TAU);
    c.fill();
    c.globalAlpha = 1;
  }

  ring(x: number, y: number, r: number, color: string, width = 1, alpha = 1): void {
    const c = this.ctx;
    c.globalAlpha = alpha * this.worldOpacity;
    c.strokeStyle = color;
    c.lineWidth = width;
    c.beginPath();
    c.arc(Math.round(x - this.viewX) + 0.5, Math.round(y - this.viewY) + 0.5, Math.max(0.5, r), 0, TAU);
    c.stroke();
    c.globalAlpha = 1;
  }

  line(x0: number, y0: number, x1: number, y1: number, color: string, width = 1, alpha = 1): void {
    const c = this.ctx;
    c.globalAlpha = alpha * this.worldOpacity;
    c.strokeStyle = color;
    c.lineWidth = width;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x0 - this.viewX, y0 - this.viewY);
    c.lineTo(x1 - this.viewX, y1 - this.viewY);
    c.stroke();
    c.globalAlpha = 1;
  }

  /**
   * Crisp pixel line: Bresenham steps stamped with a `width` px square brush on
   * the world pixel grid, filled once so a translucent line keeps one alpha
   * where the brush overlaps (unlike `line`, which is anti-aliased and round-capped).
   */
  pixelLine(x0: number, y0: number, x1: number, y1: number, color: string, width = 1, alpha = 1): void {
    if (alpha <= 0 || !Number.isFinite(x0 + y0 + x1 + y1)) return;
    const c = this.ctx;
    const s = Math.max(1, Math.round(width));
    const off = Math.floor(s / 2);
    let ax = Math.round(x0 - this.viewX);
    let ay = Math.round(y0 - this.viewY);
    const bx = Math.round(x1 - this.viewX);
    const by = Math.round(y1 - this.viewY);
    const dx = Math.abs(bx - ax);
    const dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let err = dx + dy;
    c.globalAlpha = alpha * this.worldOpacity;
    c.fillStyle = color;
    c.beginPath();
    for (let n = 0; n < 2048; n++) {
      c.rect(ax - off, ay - off, s, s);
      if (ax === bx && ay === by) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        ax += sx;
      }
      if (e2 <= dx) {
        err += dx;
        ay += sy;
      }
    }
    c.fill();
    c.globalAlpha = 1;
  }

  /** Crisp filled disc on the world pixel grid (row spans, one fill). */
  pixelDisc(x: number, y: number, r: number, color: string, alpha = 1): void {
    if (alpha <= 0 || r <= 0 || !Number.isFinite(x + y + r)) return;
    const c = this.ctx;
    const cx = Math.round(x - this.viewX);
    const cy = Math.round(y - this.viewY);
    const rr = Math.min(256, r);
    const n = Math.ceil(rr);
    c.globalAlpha = alpha * this.worldOpacity;
    c.fillStyle = color;
    c.beginPath();
    for (let dy = -n; dy <= n; dy++) {
      const q = rr * rr - dy * dy;
      if (q < 0) continue;
      const half = Math.floor(Math.sqrt(q) + 0.35);
      c.rect(cx - half, cy + dy, half * 2 + 1, 1);
    }
    c.fill();
    c.globalAlpha = 1;
  }

  /** Crisp ring of `width` px on the world pixel grid (row spans, one fill). */
  pixelRing(x: number, y: number, r: number, color: string, width = 1, alpha = 1): void {
    if (alpha <= 0 || r <= 0 || !Number.isFinite(x + y + r + width)) return;
    const c = this.ctx;
    const cx = Math.round(x - this.viewX);
    const cy = Math.round(y - this.viewY);
    const ro = Math.min(256, r + Math.max(1, width) / 2);
    const ri = Math.max(0, ro - Math.max(1, width));
    const n = Math.ceil(ro);
    c.globalAlpha = alpha * this.worldOpacity;
    c.fillStyle = color;
    c.beginPath();
    for (let dy = -n; dy <= n; dy++) {
      const qo = ro * ro - dy * dy;
      if (qo < 0) continue;
      const xo = Math.floor(Math.sqrt(qo) + 0.35);
      const qi = ri * ri - dy * dy;
      if (qi <= 0) {
        c.rect(cx - xo, cy + dy, xo * 2 + 1, 1);
        continue;
      }
      const xi = Math.ceil(Math.sqrt(qi) - 0.35);
      if (xo < xi) continue;
      c.rect(cx - xo, cy + dy, xo - xi + 1, 1);
      c.rect(cx + xi, cy + dy, xo - xi + 1, 1);
    }
    c.fill();
    c.globalAlpha = 1;
  }

  /** Soft elliptical ground shadow (pre-rendered per size: one drawImage). */
  shadow(x: number, y: number, w: number, h = w * 0.4, alpha = 0.35): void {
    if (alpha <= 0) return;
    const c = this.ctx;
    const rx = Math.max(1, w / 2);
    const ry = Math.max(1, h / 2);
    c.globalAlpha = alpha * this.worldOpacity;
    if (rx > 64 || ry > 64) {
      c.fillStyle = '#000000';
      c.beginPath();
      c.ellipse(Math.round(x - this.viewX), Math.round(y - this.viewY), rx, ry, 0, 0, TAU);
      c.fill();
    } else {
      const s = shadowSprite(rx, ry);
      c.drawImage(s.canvas, Math.round(x - this.viewX) - s.cx, Math.round(y - this.viewY) - s.cy);
    }
    c.globalAlpha = 1;
  }

  /**
   * Tiny 3x5 bitmap text in world space (cached bitmaps). Returns width in pixels.
   * A text the 3x5 font cannot draw (Hangul ...) is drawn in the Galmuri pixel face
   * instead (engine/worldtext), standing on the same baseline (its ink bottom is the
   * 3x5 text's bottom row, taller glyphs grow upward), same outline / alpha / align.
   */
  pixelText(str: string, x: number, y: number, color: string, opts: { align?: 'left' | 'center' | 'right'; outline?: string; scale?: number; alpha?: number } = NO_TEXT_OPTS): number {
    const s = Math.max(1, Math.round(opts.scale ?? 1));
    const alpha = opts.alpha ?? 1;
    if (!str.length) return -s;
    if (!pixelFontCovers(str)) return this.fontText(str, x, y, color, opts, s, alpha);
    if (alpha <= 0) return (str.toUpperCase().length * 4 - 1) * s;
    const te = textEntry(str, color, opts.outline, s);
    const width = (te.len * 4 - 1) * s;
    let sx = Math.round(x - this.viewX);
    const sy = Math.round(y - this.viewY);
    if (opts.align === 'center') sx -= Math.floor(width / 2);
    else if (opts.align === 'right') sx -= width;
    const c = this.ctx;
    c.globalAlpha = alpha * this.worldOpacity;
    c.drawImage(te.canvas, sx - s, sy - s);
    c.globalAlpha = 1;
    return width;
  }

  /** Width in pixels `pixelText(str, ..., { scale })` draws (lay out text + icon before drawing). */
  pixelTextWidth(str: string, scale = 1): number {
    const s = Math.max(1, Math.round(scale));
    if (!str.length) return -s;
    if (pixelFontCovers(str)) return (str.toUpperCase().length * 4 - 1) * s;
    const st = fontTextStyle(s);
    return fontTextWidth(str, st) * st.k;
  }

  /** Ink rows `pixelText(str, x, y, ..., { scale })` draws above its baseline `y + 5 * scale` (outline not counted). */
  pixelTextHeight(str: string, scale = 1): number {
    const s = Math.max(1, Math.round(scale));
    if (!str.length || pixelFontCovers(str)) return 5 * s;
    const st = fontTextStyle(s);
    return st.ink * st.k;
  }

  /**
   * UI pass: a panel (UI units) drawn over the world this frame, e.g. the item card.
   * World-anchored popups (FloatingText) drawn in the next frame step out from under it.
   */
  coverWorld(x: number, y: number, w: number, h: number): void {
    if (this.coversFrame !== this.drawFrame) {
      this.covers.length = 0;
      this.coversFrame = this.drawFrame;
    }
    const k = this.uiScale / this.scale;
    this.covers.push((this.uiOffsetX - this.offsetX) / this.scale + x * k, (this.uiOffsetY - this.offsetY) / this.scale + y * k, w * k, h * k);
  }

  /** Panels the latest UI pass drew over the world (world canvas px, flat x, y, w, h); empty when it drew none. */
  worldCovers(): readonly number[] {
    return this.coversFrame >= this.drawFrame - 1 ? this.covers : NO_COVERS;
  }

  /** pixelText's Galmuri path: a cached hard-pixel raster blitted at an integer scale. */
  private fontText(str: string, x: number, y: number, color: string, opts: { align?: 'left' | 'center' | 'right'; outline?: string }, s: number, alpha: number): number {
    const st = fontTextStyle(s);
    const k = st.k;
    if (alpha <= 0) return fontTextWidth(str, st) * k;
    // null: no DOM, or the face is still loading (drawn from the next frame it is ready)
    const b = fontTextBitmap(str, st, color, opts.outline);
    if (!b) return fontTextWidth(str, st) * k;
    const width = b.w * k;
    if (!b.canvas) return width;
    let sx = Math.round(x - this.viewX);
    // baseline = the bottom edge of the 3x5 text's last row
    const base = Math.round(y - this.viewY) + 5 * s;
    if (opts.align === 'center') sx -= Math.floor(width / 2);
    else if (opts.align === 'right') sx -= width;
    const c = this.ctx;
    c.globalAlpha = alpha * this.worldOpacity;
    if (k === 1) c.drawImage(b.canvas, sx + b.dx, base + b.dy);
    else c.drawImage(b.canvas, sx + b.dx * k, base + b.dy * k, b.canvas.width * k, b.canvas.height * k);
    c.globalAlpha = 1;
    return width;
  }

  /** Blit the world canvas (and screen flash) to the display. */
  presentWorld(): void {
    const d = this.dctx;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalAlpha = 1;
    d.globalCompositeOperation = 'source-over';
    const ww = Math.round(VIEW_W * this.scale);
    const wh = Math.round(VIEW_H * this.scale);
    const ox = this.offsetX;
    const oy = this.offsetY;
    const dw = this.display.width;
    const dh = this.display.height;
    // black letterbox bars only: the opaque world image covers the rest (a
    // full-screen fill is a whole extra screen of pixels per frame on Retina)
    d.fillStyle = '#000';
    if (oy > 0) d.fillRect(0, 0, dw, oy);
    if (oy + wh < dh) d.fillRect(0, oy + wh, dw, dh - oy - wh);
    if (ox > 0) d.fillRect(0, oy, ox, wh);
    if (ox + ww < dw) d.fillRect(ox + ww, oy, dw - ox - ww, wh);
    d.imageSmoothingEnabled = false;
    d.drawImage(this.world, ox, oy, ww, wh);
    if (this.flashAlpha > 0) {
      d.globalAlpha = clamp(this.flashAlpha * this.flashIntensity, 0, 1);
      d.fillStyle = this.flashColor;
      d.fillRect(this.offsetX, this.offsetY, VIEW_W * this.scale, VIEW_H * this.scale);
      d.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------ UI layer
  /** Set the display context transform for UI drawing (UI_W x UI_H virtual units). */
  beginUI(): CanvasRenderingContext2D {
    const d = this.dctx;
    d.setTransform(this.uiScale, 0, 0, this.uiScale, this.uiOffsetX, this.uiOffsetY);
    d.imageSmoothingEnabled = false;
    d.globalAlpha = 1;
    d.globalCompositeOperation = 'source-over';
    return d;
  }

  fontString(size: number, bold = false, font: 'main' | 'small' = 'main'): string {
    const fam = font === 'small' ? "'Galmuri9', 'Galmuri11', monospace" : "'Galmuri11', monospace";
    return `${bold ? 'bold ' : ''}${size}px ${fam}`;
  }

  uiText(str: string, x: number, y: number, o: TextOpts = {}): void {
    const d = this.dctx;
    const size = o.size ?? 12;
    d.font = this.fontString(size, o.bold, o.font);
    d.textAlign = o.align ?? 'left';
    d.textBaseline = o.baseline ?? 'top';
    d.globalAlpha = o.alpha ?? 1;
    if (o.outline) {
      d.strokeStyle = o.outline;
      d.lineWidth = Math.max(2, size / 5);
      d.lineJoin = 'round';
      d.strokeText(str, x, y);
    }
    const shadow = o.shadow === undefined ? 'rgba(0,0,0,0.65)' : o.shadow;
    if (shadow) {
      d.fillStyle = shadow;
      const off = Math.max(1, Math.round(size / 12));
      d.fillText(str, x + off, y + off);
    }
    d.fillStyle = o.color ?? '#f4ecdc';
    d.fillText(str, x, y);
    d.globalAlpha = 1;
  }

  /** Text width in UI units (cached; the cache is dropped when web fonts finish loading). */
  measureText(str: string, size = 12, bold = false, font: 'main' | 'small' = 'main'): number {
    const k = styleKey(size, bold, font);
    let row = widthCache.get(str);
    if (row) {
      for (let i = 0; i < row.length; i += 2) if (row[i] === k) return row[i + 1];
    }
    watchFonts();
    this.dctx.font = this.fontString(size, bold, font);
    const wdt = this.dctx.measureText(str).width;
    if (widthCount >= WIDTH_CACHE_MAX) {
      clearTextMetrics();
      row = undefined;
    }
    if (!row) widthCache.set(str, (row = []));
    row.push(k, wdt);
    widthCount++;
    return wdt;
  }

  /**
   * Word-wrap text (Korean-aware: breaks on spaces, falls back to characters).
   * Results are cached: the returned array is shared, do not modify it.
   */
  wrapText(str: string, maxWidth: number, size = 12, bold = false, font: 'main' | 'small' = 'main'): string[] {
    const k = styleKey(size, bold, font);
    let row = wrapCache.get(str);
    if (row) {
      for (let i = 0; i < row.length; i += 3) if (row[i] === k && row[i + 1] === maxWidth) return row[i + 2] as string[];
    }
    const lines = this.wrapLines(str, maxWidth, size, bold, font);
    // measuring may have dropped the caches (fonts loaded / size cap): look the row up again
    row = wrapCache.get(str);
    if (!row) {
      if (wrapCache.size >= WRAP_CACHE_MAX) wrapCache.clear();
      wrapCache.set(str, (row = []));
    } else if (row.length >= 24) row.length = 0; // an animated width: keep the row short
    row.push(k, maxWidth, lines);
    return lines;
  }

  private wrapLines(str: string, maxWidth: number, size: number, bold: boolean, font: 'main' | 'small'): string[] {
    const lines: string[] = [];
    for (const para of str.split('\n')) {
      const words = para.split(' ');
      let line = '';
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (this.measureText(test, size, bold, font) <= maxWidth) {
          line = test;
          continue;
        }
        if (line) lines.push(line);
        // word itself too long: break by characters
        if (this.measureText(word, size, bold, font) > maxWidth) {
          let chunk = '';
          for (const ch of word) {
            if (this.measureText(chunk + ch, size, bold, font) > maxWidth) {
              lines.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else line = word;
      }
      lines.push(line);
    }
    return lines;
  }

  /** Filled rect in UI space. A rect covering the whole UI space (overlay dims, fades) fills the entire screen. */
  uiRect(x: number, y: number, w: number, h: number, color: string, alpha = 1): void {
    const d = this.dctx;
    d.globalAlpha = alpha;
    d.fillStyle = color;
    if (x <= 0 && y <= 0 && x + w >= UI_W && y + h >= UI_H) {
      d.save();
      d.setTransform(1, 0, 0, 1, 0, 0);
      d.fillRect(0, 0, this.display.width, this.display.height);
      d.restore();
    } else d.fillRect(x, y, w, h);
    d.globalAlpha = 1;
  }

  uiStrokeRect(x: number, y: number, w: number, h: number, color: string, width = 2, alpha = 1): void {
    const d = this.dctx;
    d.globalAlpha = alpha;
    d.strokeStyle = color;
    d.lineWidth = width;
    d.strokeRect(x + width / 2, y + width / 2, w - width, h - width);
    d.globalAlpha = 1;
  }

  /** Draw a sprite in UI space; `scale` 2 == same pixel size as the world layer. */
  uiSprite(name: string, x: number, y: number, scale = 2, o: DrawOpts = {}): void {
    const s = getSprite(name);
    const d = this.dctx;
    d.save();
    d.globalAlpha = o.alpha ?? 1;
    d.translate(x, y);
    if (o.rot) d.rotate(o.rot);
    d.scale(scale * (o.flipX ? -1 : 1) * (o.sx ?? 1), scale * (o.sy ?? 1));
    d.imageSmoothingEnabled = false;
    d.drawImage(s.canvas, -s.ox, -s.oy);
    if (o.tint && (o.tintAmount ?? 1) > 0) {
      d.globalAlpha = (o.alpha ?? 1) * (o.tintAmount ?? 1);
      d.drawImage(getTintCanvas(s, o.tint), -s.ox, -s.oy);
    }
    if (o.flash && o.flash > 0) {
      d.globalAlpha = (o.alpha ?? 1) * clamp(o.flash, 0, 1);
      d.drawImage(getFlash(s), -s.ox, -s.oy);
    }
    d.restore();
  }

  /** Standard dark panel with a pixel border, used by menus and tooltips. */
  uiPanel(x: number, y: number, w: number, h: number, o: { fill?: string; border?: string; highlight?: string; alpha?: number } = {}): void {
    const d = this.dctx;
    const a = o.alpha ?? 0.94;
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    d.globalAlpha = a;
    d.fillStyle = o.border ?? '#0c0810';
    d.fillRect(x + 2, y, w - 4, h);
    d.fillRect(x, y + 2, w, h - 4);
    d.fillStyle = o.fill ?? '#241a2e';
    d.fillRect(x + 2, y + 2, w - 4, h - 4);
    d.fillStyle = o.highlight ?? '#4a3a5c';
    d.fillRect(x + 4, y + 2, w - 8, 2);
    d.fillStyle = '#00000055';
    d.fillRect(x + 4, y + h - 4, w - 8, 2);
    d.globalAlpha = 1;
  }

  endFrame(): void {
    // nothing for now; hook for post effects
  }
}
