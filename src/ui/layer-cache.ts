// Cached UI layers: a group of ordinary UI draw calls (frames, sprites, outlined
// text ...) is painted once into an offscreen canvas at the exact display
// resolution and then blitted with a single drawImage every frame, until its
// key (the inputs it depends on) changes. Used for the mostly static HUD parts
// (stats column, counters, hearts, minimap, slots) so the per-frame UI pass
// stays cheap on high-DPI phones and 120 Hz screens.

import type { Renderer } from '../engine/renderer';

type Swappable = { dctx: CanvasRenderingContext2D };

export class UiLayer {
  private cv: HTMLCanvasElement | null = null;
  private g: CanvasRenderingContext2D | null = null;
  private key = '';
  private s = 0;
  private fx = -1;
  private fy = -1;
  /** how many times the layer was (re)painted (debug / tests) */
  paints = 0;

  /** Forget the cached bitmap (next draw repaints). */
  invalidate(): void {
    this.key = '';
  }

  /** Free the bitmap now (a closed overlay's big layer) instead of waiting for GC; the next draw repaints. */
  release(): void {
    if (this.cv) {
      this.cv.width = 0;
      this.cv.height = 0;
    }
    this.cv = null;
    this.g = null;
    this.key = '';
  }

  /**
   * Draw the UI-space rect (x, y, w, h) — in a UI space translated by (ox, oy)
   * units — from the cache; `paint` (normal UI drawing calls in the same
   * coordinates) runs only when `key`, the UI scale or the sub-pixel position
   * changes. `alpha` is applied when blitting.
   */
  draw(r: Renderer, key: string, ox: number, oy: number, x: number, y: number, w: number, h: number, alpha: number, paint: () => void): void {
    if (alpha <= 0.003 || typeof document === 'undefined') return;
    const s = r.uiScale;
    const px = r.uiOffsetX + (ox + x) * s;
    const py = r.uiOffsetY + (oy + y) * s;
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const fx = Math.round((px - ix) * 64) / 64;
    const fy = Math.round((py - iy) * 64) / 64;
    if (!this.cv || key !== this.key || s !== this.s || fx !== this.fx || fy !== this.fy) {
      const cw = Math.max(1, Math.ceil(w * s + fx) + 1);
      const ch = Math.max(1, Math.ceil(h * s + fy) + 1);
      if (!this.cv) {
        this.cv = document.createElement('canvas');
        this.g = this.cv.getContext('2d')!;
      }
      const cv = this.cv;
      const g = this.g!;
      if (cv.width !== cw || cv.height !== ch) {
        cv.width = cw;
        cv.height = ch;
      } else {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, cw, ch);
      }
      g.setTransform(s, 0, 0, s, fx - x * s, fy - y * s);
      g.imageSmoothingEnabled = false;
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      // UI helpers draw on renderer.dctx: point it at the layer while painting
      const rr = r as unknown as Swappable;
      const prev = rr.dctx;
      rr.dctx = g;
      try {
        paint();
      } finally {
        rr.dctx = prev;
      }
      this.key = key;
      this.s = s;
      this.fx = fx;
      this.fy = fy;
      this.paints++;
    }
    const d = r.dctx;
    d.save();
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalAlpha = alpha > 1 ? 1 : alpha;
    d.drawImage(this.cv, ix, iy);
    d.restore();
  }
}
