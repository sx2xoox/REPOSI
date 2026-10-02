// Scene stack. The top scene receives update(); every scene marked
// `transparent` lets the one below it draw first (overlays).
// Replacing the whole stack (`set`) cross-fades from a snapshot of the last
// frame, so every screen change (title -> select -> run -> results) is smooth.

import type { Renderer } from '../engine/renderer';

export interface Scene {
  /** draw the scene below as well (overlays) */
  transparent?: boolean;
  /** keep updating the scene below (rare) */
  passUpdate?: boolean;
  enter?(): void;
  exit?(): void;
  update(dt: number): void;
  draw(r: Renderer): void;
}

/** Cross-fade duration in seconds for `set()`. */
export const FADE_TIME = 0.4;

export class SceneManager {
  stack: Scene[] = [];
  renderer: Renderer;
  private snap: HTMLCanvasElement | null = null;
  private fadeT = FADE_TIME;
  private fromBlack = false;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
  }

  get top(): Scene | undefined {
    return this.stack[this.stack.length - 1];
  }

  push(s: Scene): void {
    this.stack.push(s);
    s.enter?.();
  }

  pop(): Scene | undefined {
    const s = this.stack.pop();
    s?.exit?.();
    return s;
  }

  /** Replace the whole stack with `s` (cross-fades from the current frame). */
  set(s: Scene): void {
    this.capture();
    while (this.stack.length) this.pop();
    this.push(s);
  }

  /** Remove a specific scene wherever it is. */
  remove(s: Scene): void {
    const i = this.stack.indexOf(s);
    if (i >= 0) {
      this.stack.splice(i, 1);
      s.exit?.();
    }
  }

  private capture(): void {
    const disp = this.renderer?.display;
    this.fadeT = 0;
    if (!disp || typeof document === 'undefined' || !this.stack.length) {
      this.fromBlack = true;
      return;
    }
    try {
      if (!this.snap) this.snap = document.createElement('canvas');
      if (this.snap.width !== disp.width || this.snap.height !== disp.height) {
        this.snap.width = disp.width;
        this.snap.height = disp.height;
      }
      const c = this.snap.getContext('2d')!;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(disp, 0, 0);
      this.fromBlack = false;
    } catch {
      this.fromBlack = true;
    }
  }

  update(dt: number): void {
    this.fadeT = Math.min(FADE_TIME, this.fadeT + dt);
    const top = this.top;
    if (!top) return;
    top.update(dt);
    if (top.passUpdate) {
      const below = this.stack[this.stack.length - 2];
      below?.update(dt);
    }
  }

  draw(): void {
    // find the lowest scene that must be drawn
    let start = this.stack.length - 1;
    while (start > 0 && this.stack[start].transparent) start--;
    for (let i = Math.max(0, start); i < this.stack.length; i++) this.stack[i].draw(this.renderer);
    if (this.fadeT < FADE_TIME) this.drawFade();
  }

  private drawFade(): void {
    const d = this.renderer.dctx;
    const t = this.fadeT / FADE_TIME;
    const a = 1 - t * t * (3 - 2 * t); // smoothstep out
    d.save();
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = 'source-over';
    d.globalAlpha = a;
    if (this.fromBlack || !this.snap) {
      d.fillStyle = '#000';
      d.fillRect(0, 0, this.renderer.display.width, this.renderer.display.height);
    } else {
      d.drawImage(this.snap, 0, 0);
    }
    d.restore();
  }
}
