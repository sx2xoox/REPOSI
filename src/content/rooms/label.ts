// Floating Korean label shown above an interactive object while the player is near.

import { Entity } from '../../game/entity';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { dist } from '../../engine/math';
import { pixelTextCanvas } from './floortext';

export class HintLabel extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  text: string;
  color: string;
  near: number;
  visible: (w: World) => boolean;
  private a = 0;
  constructor(x: number, y: number, text: string, visible: (w: World) => boolean = () => true, color = '#f4ecdc', near = 64) {
    super();
    this.x = x;
    this.y = y;
    this.text = text;
    this.color = color;
    this.near = near;
    this.visible = visible;
    this.layer = 3;
    this.persistent = true;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const on = this.visible(w) && dist(this.x, this.y, w.player.x, w.player.y) < this.near;
    this.a = Math.max(0, Math.min(1, this.a + (on ? dt * 5 : -dt * 4)));
  }

  override draw(r: Renderer): void {
    if (this.a <= 0 || typeof document === 'undefined') return;
    const tc = pixelTextCanvas(this.text, { size: 12, font: 'Galmuri11', color: this.color, outline: '#0c0810' });
    const c = r.ctx;
    c.save();
    c.globalAlpha = this.a;
    const bob = Math.round(Math.sin(this.age * 3) * 1);
    c.drawImage(tc, Math.round(this.x - tc.width / 2 - r.viewX), Math.round(this.y - tc.height + bob - r.viewY));
    c.restore();
  }
}
