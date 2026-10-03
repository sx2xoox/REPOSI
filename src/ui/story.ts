import type { Scene, TouchButtonSpec } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_W, UI_H } from '../engine/renderer';
import { input } from '../engine/input';
import { app } from '../game/app';
import { frame } from './frame';
import { C } from './theme';
import type { StoryEvent } from '../game/story';

export class StoryOverlay implements Scene {
  transparent = true;
  private index = 0;
  private delay = 0;
  constructor(private event: StoryEvent, private done: () => void) {}
  private next(): void {
    if (this.delay < 0.18) return;
    this.delay = 0;
    if (++this.index >= this.event.lines.length) { app.scenes.pop(); input.releaseAll(); this.done(); }
  }
  update(dt: number): void {
    this.delay += dt;
    const m = app.renderer.displayToUI(input.mouseX, input.mouseY);
    if (input.pressed('confirm') || input.pressed('interact') || input.pressed('fire') && Math.abs(m.x - UI_W / 2) < 320 && m.y > UI_H - 166) this.next();
  }
  touchButtons(): TouchButtonSpec[] { return [{ x: UI_W / 2 - 320, y: UI_H - 162, w: 640, h: 142, tap: () => this.next(), ghost: true }]; }
  draw(r: Renderer): void {
    r.beginUI(); r.uiRect(0, 0, UI_W, UI_H, '#05050c', 0.25);
    const x = UI_W / 2 - 320, y = UI_H - 166;
    frame(r, x, y, 640, 146, 'panel');
    r.uiText(this.event.title, x + 22, y + 13, { size: 11, color: C.gold });
    const line = this.event.lines[this.index]; if (!line) return;
    r.uiText(line.who, x + 22, y + 35, { size: 14, bold: true, color: C.goldHi });
    const lines = r.wrapText(line.text, 594, 13);
    lines.forEach((text, i) => r.uiText(text, x + 22, y + 62 + i * 19, { size: 13, color: C.text }));
    r.uiText(`${this.index + 1}/${this.event.lines.length}  ·  Enter / 대화창 클릭으로 계속`, x + 615, y + 124, { size: 10, align: 'right', color: C.textFaint });
  }
}
