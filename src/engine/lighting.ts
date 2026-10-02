// 2D light map: the world is multiplied by a canvas that starts at the room's
// ambient color, and every light adds a radial gradient on top (additively).
// Bright emissive things can additionally draw an additive glow on the world.

import { VIEW_H, VIEW_W, type Renderer } from './renderer';

const GRAD_SIZE = 128;
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

export interface LightOpts {
  /** 0..1 (multiplies the light's alpha) */
  intensity?: number;
  /** squash vertically (perspective) */
  squash?: number;
}

export class Lighting {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  enabled = true;
  ambient = '#3a3248';
  private r: Renderer | null = null;
  private glows: { x: number; y: number; radius: number; color: string; alpha: number }[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = VIEW_W;
    this.canvas.height = VIEW_H;
    this.ctx = this.canvas.getContext('2d')!;
  }

  begin(r: Renderer, ambient: string): void {
    this.r = r;
    this.ambient = ambient;
    this.glows.length = 0;
    const c = this.ctx;
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = ambient;
    c.fillRect(0, 0, VIEW_W, VIEW_H);
    c.globalCompositeOperation = 'lighter';
  }

  /**
   * Add a light at world position (x, y). `color` must be "#rrggbb".
   * Radius is in world pixels.
   */
  add(x: number, y: number, radius: number, color = '#ffe6b0', o: LightOpts = {}): void {
    if (!this.r || radius <= 0) return;
    const sx = x - this.r.viewX;
    const sy = y - this.r.viewY;
    if (sx < -radius || sy < -radius || sx > VIEW_W + radius || sy > VIEW_H + radius) return;
    const c = this.ctx;
    c.globalAlpha = Math.min(1, o.intensity ?? 1);
    const squash = o.squash ?? 1;
    c.drawImage(gradientCanvas(color), sx - radius, sy - radius * squash, radius * 2, radius * 2 * squash);
    c.globalAlpha = 1;
  }

  /** Additive glow drawn over the lit world (for very bright emissive things). */
  glow(x: number, y: number, radius: number, color: string, alpha = 0.5): void {
    this.glows.push({ x, y, radius, color, alpha });
  }

  /** Multiply the light map onto the world canvas, then draw additive glows. */
  apply(): void {
    if (!this.r) return;
    const w = this.r.ctx;
    if (this.enabled) {
      w.save();
      w.setTransform(1, 0, 0, 1, 0, 0);
      w.globalCompositeOperation = 'multiply';
      w.drawImage(this.canvas, 0, 0);
      w.restore();
    }
    if (this.glows.length) {
      w.save();
      w.setTransform(1, 0, 0, 1, 0, 0);
      w.globalCompositeOperation = 'lighter';
      for (const g of this.glows) {
        w.globalAlpha = Math.min(1, g.alpha);
        const sx = g.x - this.r.viewX;
        const sy = g.y - this.r.viewY;
        w.drawImage(gradientCanvas(g.color), sx - g.radius, sy - g.radius, g.radius * 2, g.radius * 2);
      }
      w.restore();
    }
  }
}
