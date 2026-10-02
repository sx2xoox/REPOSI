// 2D light map: the world is multiplied by a canvas that starts at the room's
// ambient color, and every light adds a radial gradient on top (additively).
// Bright emissive things can additionally draw an additive glow on the world.
//
// Performance: the light map is rendered at half resolution (lights are soft
// gradients, so it is upscaled with smoothing at no visible cost), lights that
// are off-screen or too faint are skipped, gradients are cached per color, and
// with `enabled = false` (low quality) the whole light pass is skipped.

import { VIEW_H, VIEW_W, type Renderer } from './renderer';

const GRAD_SIZE = 128;
/** light map resolution relative to the world canvas */
const LIGHT_SCALE = 0.5;
/** light map size (follows the adaptive VIEW_W; refreshed in `begin`) */
let LW = Math.ceil(VIEW_W * LIGHT_SCALE);
let LH = Math.ceil(VIEW_H * LIGHT_SCALE);
const gradCache = new Map<string, HTMLCanvasElement>();

function gradientCanvas(color: string): HTMLCanvasElement {
  let c = gradCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = GRAD_SIZE;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(GRAD_SIZE / 2, GRAD_SIZE / 2, 0, GRAD_SIZE / 2, GRAD_SIZE / 2, GRAD_SIZE / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.35, color + 'b0');
  g.addColorStop(0.7, color + '38');
  g.addColorStop(1, color + '00');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, GRAD_SIZE, GRAD_SIZE);
  gradCache.set(color, c);
  return c;
}

/** small lights are pre-rendered at their exact (half-res) size: unscaled blits are ~2x cheaper */
const SIZED_MAX = 48;
const sizedCache = new Map<string, (HTMLCanvasElement | undefined)[]>();

function sizedGradient(color: string, size: number): HTMLCanvasElement {
  let row = sizedCache.get(color);
  if (!row) sizedCache.set(color, (row = []));
  let c = row[size];
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const h = size / 2;
  const g = ctx.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0, color);
  g.addColorStop(0.35, color + 'b0');
  g.addColorStop(0.7, color + '38');
  g.addColorStop(1, color + '00');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  row[size] = c;
  return c;
}

/**
 * Pre-build the gradient canvases a light of `color` with radii in
 * [minRadius, maxRadius] (world px) will use, so a burst of new lights (a
 * 등불 해방) never creates canvases mid-frame. Call at load (needs a DOM).
 */
export function prewarmLight(color: string, minRadius: number, maxRadius = minRadius): void {
  if (typeof document === 'undefined') return;
  const lo = Math.max(2, Math.round(minRadius * 2 * LIGHT_SCALE));
  const hi = Math.round(maxRadius * 2 * LIGHT_SCALE);
  for (let s = lo; s <= Math.min(hi, SIZED_MAX); s++) sizedGradient(color, s);
  if (maxRadius * 2 * LIGHT_SCALE > SIZED_MAX) gradientCanvas(color);
}

export interface LightOpts {
  /** 0..1 (multiplies the light's alpha) */
  intensity?: number;
  /** squash vertically (perspective) */
  squash?: number;
}

interface Glow {
  x: number;
  y: number;
  radius: number;
  color: string;
  alpha: number;
}

export class Lighting {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** false = no light map at all (flat lit world; cheap "low quality" mode) */
  enabled = true;
  ambient = '#3a3248';
  private r: Renderer | null = null;
  private glows: Glow[] = [];
  private glowCount = 0;
  /** lights drawn into the map this frame (debug / profiling) */
  count = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = LW;
    this.canvas.height = LH;
    this.ctx = this.canvas.getContext('2d')!;
  }

  begin(r: Renderer, ambient: string): void {
    this.r = r;
    this.ambient = ambient;
    this.glowCount = 0;
    this.count = 0;
    if (!this.enabled) return;
    LW = Math.ceil(VIEW_W * LIGHT_SCALE);
    LH = Math.ceil(VIEW_H * LIGHT_SCALE);
    if (this.canvas.width !== LW || this.canvas.height !== LH) {
      this.canvas.width = LW;
      this.canvas.height = LH;
    }
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = ambient;
    c.fillRect(0, 0, LW, LH);
    c.globalCompositeOperation = 'lighter';
  }

  /**
   * Add a light at world position (x, y). `color` must be "#rrggbb".
   * Radius is in world pixels.
   */
  add(x: number, y: number, radius: number, color = '#ffe6b0', o?: LightOpts): void {
    if (!this.enabled || !this.r || !(radius > 0.5)) return;
    const intensity = o?.intensity ?? 1;
    if (!(intensity > 0.015)) return;
    const squash = o?.squash ?? 1;
    const sx = x - this.r.viewX;
    const sy = y - this.r.viewY;
    const ry = radius * squash;
    if (sx < -radius || sy < -ry || sx > VIEW_W + radius || sy > VIEW_H + ry) return;
    const c = this.ctx;
    c.globalAlpha = intensity > 1 ? 1 : intensity;
    const dw = radius * 2 * LIGHT_SCALE;
    if (squash === 1 && dw <= SIZED_MAX) {
      const size = Math.max(2, Math.round(dw));
      c.drawImage(sizedGradient(color, size), Math.round(sx * LIGHT_SCALE - size / 2), Math.round(sy * LIGHT_SCALE - size / 2));
    } else {
      c.drawImage(gradientCanvas(color), (sx - radius) * LIGHT_SCALE, (sy - ry) * LIGHT_SCALE, dw, ry * 2 * LIGHT_SCALE);
    }
    this.count++;
  }

  /** Additive glow drawn over the lit world (for very bright emissive things). */
  glow(x: number, y: number, radius: number, color: string, alpha = 0.5): void {
    if (radius <= 0 || alpha <= 0.01) return;
    let g = this.glows[this.glowCount];
    if (!g) {
      g = { x: 0, y: 0, radius: 0, color: '', alpha: 0 };
      this.glows.push(g);
    }
    g.x = x;
    g.y = y;
    g.radius = radius;
    g.color = color;
    g.alpha = alpha;
    this.glowCount++;
  }

  /** Multiply the light map onto the world canvas, then draw additive glows. */
  apply(): void {
    if (!this.r) return;
    const w = this.r.ctx;
    if (this.enabled) {
      this.ctx.globalAlpha = 1;
      w.save();
      w.setTransform(1, 0, 0, 1, 0, 0);
      w.globalCompositeOperation = 'multiply';
      w.imageSmoothingEnabled = true;
      w.drawImage(this.canvas, 0, 0, LW, LH, 0, 0, LW / LIGHT_SCALE, LH / LIGHT_SCALE);
      w.restore();
      w.imageSmoothingEnabled = false;
    }
    if (this.glowCount) {
      w.save();
      w.setTransform(1, 0, 0, 1, 0, 0);
      w.globalCompositeOperation = 'lighter';
      const vx = this.r.viewX;
      const vy = this.r.viewY;
      for (let i = 0; i < this.glowCount; i++) {
        const g = this.glows[i];
        const sx = g.x - vx;
        const sy = g.y - vy;
        if (sx < -g.radius || sy < -g.radius || sx > VIEW_W + g.radius || sy > VIEW_H + g.radius) continue;
        w.globalAlpha = Math.min(1, g.alpha);
        w.drawImage(gradientCanvas(g.color), sx - g.radius, sy - g.radius, g.radius * 2, g.radius * 2);
      }
      w.restore();
    }
  }
}
