// Small immediate-mode UI helpers shared by menus: vertical button lists with
// keyboard/gamepad/mouse navigation, sliders and toggles.

import type { Renderer } from '../engine/renderer';
import { input } from '../engine/input';
import { sfx } from '../audio/audio';

export interface MenuItem {
  label: string | (() => string);
  /** called on confirm */
  action?: () => void;
  /** left/right adjust (sliders, toggles) */
  adjust?: (dir: number) => void;
  disabled?: boolean;
  hint?: string;
}

export class Menu {
  items: MenuItem[];
  index = 0;
  x: number;
  y: number;
  width: number;
  lineH: number;
  size: number;
  private hover = -1;

  constructor(items: MenuItem[], x: number, y: number, o: { width?: number; lineH?: number; size?: number } = {}) {
    this.items = items;
    this.x = x;
    this.y = y;
    this.width = o.width ?? 240;
    this.lineH = o.lineH ?? 28;
    this.size = o.size ?? 14;
  }

  labelOf(it: MenuItem): string {
    return typeof it.label === 'function' ? it.label() : it.label;
  }

  /** Handle input. `r` is needed to map the mouse into UI space. */
  update(r: Renderer): void {
    const n = this.items.length;
    if (input.pressed('uiDown')) { this.index = (this.index + 1) % n; sfx('ui_move'); }
    if (input.pressed('uiUp')) { this.index = (this.index - 1 + n) % n; sfx('ui_move'); }
    const it = this.items[this.index];
    if (it?.adjust) {
      if (input.pressed('uiLeft')) { it.adjust(-1); sfx('ui_move'); }
      if (input.pressed('uiRight')) { it.adjust(1); sfx('ui_move'); }
    }
    // mouse
    const m = r.displayToUI(input.mouseX, input.mouseY);
    this.hover = -1;
    for (let i = 0; i < n; i++) {
      const top = this.y + i * this.lineH - 4;
      if (m.x >= this.x - this.width / 2 && m.x <= this.x + this.width / 2 && m.y >= top && m.y < top + this.lineH) {
        this.hover = i;
        if (input.mouseMoved && this.index !== i) {
          this.index = i;
          sfx('ui_move', { vol: 0.5 });
        }
      }
    }
    const clicked = this.hover >= 0 && input.pressed('fire');
    if (clicked) this.index = this.hover;
    if ((input.pressed('confirm') || clicked) && it && !it.disabled) {
      const cur = this.items[this.index];
      if (cur.action) {
        sfx('ui_select');
        cur.action();
      } else if (cur.adjust) {
        cur.adjust(1);
        sfx('ui_move');
      }
    }
  }

  draw(r: Renderer, alpha = 1): void {
    this.items.forEach((it, i) => {
      const sel = i === this.index;
      const y = this.y + i * this.lineH;
      if (sel) {
        r.uiRect(this.x - this.width / 2, y - 4, this.width, this.lineH - 4, '#ffffff', 0.08 * alpha);
        r.uiText('▶', this.x - this.width / 2 + 8, y, { size: this.size - 2, color: '#ffd080', alpha });
      }
      r.uiText(this.labelOf(it), this.x, y, {
        size: this.size, align: 'center', alpha,
        color: it.disabled ? '#5a5068' : sel ? '#fff4d8' : '#b8acc8',
      });
    });
    const cur = this.items[this.index];
    if (cur?.hint) r.uiText(cur.hint, this.x, this.y + this.items.length * this.lineH + 8, { size: 10, align: 'center', color: '#8a7f9a', alpha });
  }
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
