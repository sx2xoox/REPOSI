// Scene stack. The top scene receives update(); every scene marked
// `transparent` lets the one below it draw first (overlays).

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

export class SceneManager {
  stack: Scene[] = [];
  renderer: Renderer;

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

  /** Replace the whole stack with `s`. */
  set(s: Scene): void {
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

  update(dt: number): void {
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
  }
}
