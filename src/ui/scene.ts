// Scene stack. The top scene receives update(); every scene marked
// `transparent` lets the one below it draw first (overlays).
// Replacing the whole stack (`set`) cross-fades from a snapshot of the last
// frame, so every screen change (title -> select -> run -> results) is smooth.

import type { Renderer } from '../engine/renderer';
import type { Action } from '../engine/input';

/** An extra on-screen button a scene shows in touch mode (see ui/touch.ts). */
export interface TouchButtonSpec {
  /** rect in UI space (768x432) */
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  icon?: string;
  /** action tapped on release, or a callback run inside the touch handler (a user gesture) */
  tap: Action | (() => void);
  /** highlighted call-to-action */
  primary?: boolean;
  /** hit area only (the scene draws it itself) */
  ghost?: boolean;
}

export interface Scene {
  /** Exploration scenes share the combat left stick without combat buttons. */
  touchMovement?: boolean;
  /** draw the scene below as well (overlays) */
  transparent?: boolean;
  /** keep updating the scene below (rare) */
  passUpdate?: boolean;
  /** keep updating even under other scenes (online co-op: the lockstep never stops for a menu) */
  alwaysUpdate?: boolean;
  /** touch mode: show a corner button that taps 'cancel' ('close' = ✕, 'back' = ◀) */
  touchBack?: 'close' | 'back' | false;
  /** which top corner the back button sits in (default right) */
  touchBackAt?: 'left' | 'right';
  /** touch mode: extra buttons for this screen */
  touchButtons?(): TouchButtonSpec[];
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
    // scenes that never stop (co-op game) run first, under whatever is on top
    for (let i = 0; i < this.stack.length - 1; i++) {
      const s = this.stack[i];
      if (s.alwaysUpdate) s.update(dt);
    }
    if (this.top !== top) return; // the update changed the stack
    top.update(dt);
    if (top.passUpdate) {
      const below = this.stack[this.stack.length - 2];
      if (below && !below.alwaysUpdate) below.update(dt);
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
