// Immediate-mode UI widgets shared by menus: a vertical menu with keyboard /
// gamepad / mouse navigation (auto-repeat, animated cursor, staggered entrance),
// sliders, toggles, section headers and a seed text box.

import type { Renderer } from '../engine/renderer';
import { input } from '../engine/input';
import { sfx } from '../audio/audio';
import { clamp, ease } from '../engine/math';
import { animFrame } from '../engine/sprites';
import { Repeater, Spring } from './anim';
import { frame, gauge } from './frame';
import { C, PX } from './theme';

export interface MenuItem {
  label: string | (() => string);
  /** called on confirm */
  action?: () => void;
  /** left/right adjust (sliders, toggles, choices) */
  adjust?: (dir: number) => void;
  disabled?: boolean;
  hint?: string | (() => string);
  /** slider fill 0..1 (draws a gauge) */
  value?: () => number;
  /** toggle state (draws a switch) */
  toggle?: () => boolean;
  /** right-aligned value text (choices, slider %) */
  valueText?: () => string;
  /** small icon drawn before the label */
  icon?: string;
  /** non-selectable section header */
  header?: boolean;
  /** draw in a warning color (destructive actions) */
  danger?: boolean;
}

export interface MenuOpts {
  width?: number;
  lineH?: number;
  size?: number;
  /** label alignment inside the row */
  align?: 'center' | 'left';
  /** show the selected item's hint under the menu */
  showHint?: boolean;
  /** custom hint position (UI y) */
  hintY?: number;
}

export class Menu {
  items: MenuItem[];
  index = 0;
  x: number;
  y: number;
  width: number;
  lineH: number;
  size: number;
  align: 'center' | 'left';
  showHint: boolean;
  hintY?: number;
  /** time since creation (entrance animation) */
  t = 0;
  /** input disabled (e.g. while a modal is open) */
  active = true;
  private hover = -1;
  private cursor = new Spring(0, 420, 34);
  private flashT = 0;
  private rUp = new Repeater();
  private rDown = new Repeater();
  private rLeft = new Repeater(0.3, 0.06);
  private rRight = new Repeater(0.3, 0.06);

  constructor(items: MenuItem[], x: number, y: number, o: MenuOpts = {}) {
    this.items = items;
    this.x = x;
    this.y = y;
    this.width = o.width ?? 240;
    this.lineH = o.lineH ?? 28;
    this.size = o.size ?? 14;
    this.align = o.align ?? 'center';
    this.showHint = o.showHint ?? true;
    this.hintY = o.hintY;
    while (this.items[this.index]?.header && this.index < this.items.length - 1) this.index++;
    this.cursor.set(this.rowY(this.index));
  }

  labelOf(it: MenuItem): string {
    return typeof it.label === 'function' ? it.label() : it.label;
  }

  private hintOf(it: MenuItem): string {
    return typeof it.hint === 'function' ? it.hint() : it.hint ?? '';
  }

  rowY(i: number): number {
    return this.y + i * this.lineH;
  }

  /** Row rect in UI space. */
  rowRect(i: number): { x: number; y: number; w: number; h: number } {
    return { x: this.x - this.width / 2, y: this.rowY(i) - 5, w: this.width, h: this.lineH - 4 };
  }

  get height(): number {
    return this.items.length * this.lineH;
  }

  private move(dir: number): void {
    const n = this.items.length;
    let i = this.index;
    for (let k = 0; k < n; k++) {
      i = (i + dir + n) % n;
      if (!this.items[i].header) break;
    }
    if (i !== this.index) {
      this.index = i;
      sfx('ui_move');
    }
  }

  select(i: number): void {
    if (i >= 0 && i < this.items.length && !this.items[i].header) this.index = i;
  }

  /** Handle input. `r` is needed to map the mouse into UI space. */
  update(r: Renderer, dt = 1 / 60): void {
    this.t += dt;
    this.flashT = Math.max(0, this.flashT - dt);
    this.cursor.target = this.rowY(this.index);
    this.cursor.update(dt);
    if (!this.active) return;
    const n = this.items.length;
    if (this.rDown.update(input.held('uiDown'), dt)) this.move(1);
    if (this.rUp.update(input.held('uiUp'), dt)) this.move(-1);
    const it = this.items[this.index];
    const left = this.rLeft.update(input.held('uiLeft'), dt);
    const right = this.rRight.update(input.held('uiRight'), dt);
    if (it?.adjust && !it.disabled) {
      if (left) { it.adjust(-1); sfx('ui_move', { pitch: 0.9 }); }
      if (right) { it.adjust(1); sfx('ui_move', { pitch: 1.1 }); }
    }
    // mouse
    const m = r.displayToUI(input.mouseX, input.mouseY);
    this.hover = -1;
    for (let i = 0; i < n; i++) {
      if (this.items[i].header) continue;
      const rr = this.rowRect(i);
      if (m.x >= rr.x && m.x <= rr.x + rr.w && m.y >= rr.y && m.y < rr.y + this.lineH) {
        this.hover = i;
        if (input.mouseMoved && this.index !== i) {
          this.index = i;
          sfx('ui_move', { vol: 0.5 });
        }
      }
    }
    const clicked = this.hover >= 0 && input.pressed('fire');
    if (clicked) this.index = this.hover;
    const cur = this.items[this.index];
    if (!cur || cur.header) return;
    if (clicked && cur.adjust && (cur.value || cur.valueText) && !cur.toggle) {
      // click on the left / right half of the value area adjusts
      const rr = this.rowRect(this.index);
      if (cur.disabled) sfx('ui_error');
      else {
        cur.adjust(m.x < rr.x + rr.w * 0.78 ? -1 : 1);
        sfx('ui_move');
      }
      return;
    }
    if (input.pressed('confirm') || clicked) {
      if (cur.disabled) {
        sfx('ui_error');
        return;
      }
      this.flashT = 0.25;
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
    const a0 = alpha;
    const left = this.x - this.width / 2;
    // selection plate (springs between rows)
    const sel = this.items[this.index];
    if (sel && !sel.header) {
      const appear = ease.outCubic(clamp((this.t - 0.05) / 0.3, 0, 1));
      const y = this.cursor.value - 5;
      const h = this.lineH - 4;
      frame(r, left, y, this.width, h, 'buttonHi', { alpha: a0 * appear });
      if (this.flashT > 0) r.uiRect(left + PX, y + PX, this.width - PX * 2, h - PX * 2, '#ffe8b0', a0 * (this.flashT / 0.25) * 0.35);
      const cx = this.align === 'center' ? left + 14 : left + 12;
      r.uiSprite(animFrame('ui_cursor', this.t), cx, y + h / 2 + 7, 2, { alpha: a0 * appear });
    }
    this.items.forEach((it, i) => {
      const stagger = ease.outCubic(clamp((this.t - Math.min(i * 0.04, 0.3)) / 0.28, 0, 1));
      const a = a0 * stagger;
      if (a <= 0) return;
      const dx = (1 - stagger) * -14;
      const y = this.rowY(i);
      const isSel = i === this.index;
      const label = this.labelOf(it);
      if (it.header) {
        r.uiText(label, left + 8 + dx, y + 2, { size: 10, font: 'small', color: C.gold, alpha: a });
        r.uiRect(left + 8 + dx + r.measureText(label, 10, false, 'small') + 6, y + 8, this.width - 24 - r.measureText(label, 10, false, 'small'), PX / 2, C.goldDark, a);
        return;
      }
      const color = it.disabled ? C.textMute : it.danger ? (isSel ? '#ff9a9a' : '#c86a70') : isSel ? '#fff4d8' : C.textDim;
      const hasValue = !!(it.value || it.toggle || it.valueText);
      const textY = y + (this.lineH - 4) / 2 - 5 - this.size / 2 + 1;
      let tx = this.align === 'center' && !hasValue ? this.x : left + 30;
      if (it.icon) {
        r.uiSprite(it.icon, (this.align === 'center' && !hasValue ? this.x - r.measureText(label, this.size) / 2 - 12 : left + 36) + dx, textY + this.size / 2, 2, { alpha: a * (it.disabled ? 0.4 : 1) });
        if (!(this.align === 'center' && !hasValue)) tx += 16;
      }
      r.uiText(label, tx + dx, textY, { size: this.size, align: this.align === 'center' && !hasValue ? 'center' : 'left', alpha: a, color });
      // value widgets on the right
      const right = left + this.width - 14;
      const midY = y + (this.lineH - 4) / 2 - 5;
      if (it.toggle) {
        const on = it.toggle();
        const sw = 30;
        const sx = right - sw;
        frame(r, sx, midY - 7, sw, 14, 'inset', { alpha: a });
        r.uiRect(sx + 4, midY - 3, sw - 8, 6, on ? '#c8862c' : '#2a2034', a);
        if (on) r.uiRect(sx + 4, midY - 3, sw - 8, 2, '#ffd27a', a);
        const kx = on ? sx + sw - 14 : sx + 2;
        frame(r, kx, midY - 6, 12, 12, on ? 'key' : 'button', { alpha: a });
        r.uiText(on ? '켜짐' : '꺼짐', sx - 6, midY - 6, { size: 10, font: 'small', align: 'right', color: on ? C.goldHi : C.textFaint, alpha: a });
      } else if (it.value) {
        const gw = Math.min(110, this.width * 0.34);
        const gx = right - gw - 36;
        gauge(r, gx, midY - 5, gw, 10, it.value(), { fill: isSel ? '#e0a848' : '#8a6a4a', segments: 10, alpha: a });
        r.uiText(it.valueText ? it.valueText() : `${Math.round(it.value() * 100)}%`, right, midY - 6, { size: 10, font: 'small', align: 'right', color: isSel ? C.goldHi : C.textDim, alpha: a });
        if (isSel) {
          r.uiSprite('ui_arrow_l', gx - 8, midY, 2, { alpha: a });
          r.uiSprite('ui_arrow_r', gx + gw + 8, midY, 2, { alpha: a });
        }
      } else if (it.valueText) {
        const vt = it.valueText();
        r.uiText(vt, right - (isSel ? 12 : 0), midY - 6, { size: 11, align: 'right', color: isSel ? C.goldHi : C.textDim, alpha: a });
        if (isSel && it.adjust) {
          const w = r.measureText(vt, 11);
          r.uiSprite('ui_arrow_l', right - 12 - w - 8, midY, 2, { alpha: a });
          r.uiSprite('ui_arrow_r', right - 2, midY, 2, { alpha: a });
        }
      }
    });
    const cur = this.items[this.index];
    const hint = cur ? this.hintOf(cur) : '';
    if (this.showHint && hint) {
      r.uiText(hint, this.x, this.hintY ?? this.y + this.items.length * this.lineH + 6, { size: 10, font: 'small', align: 'center', color: C.textFaint, alpha: a0 * ease.outCubic(clamp(this.t / 0.4, 0, 1)) });
    }
  }
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export { sanitizeSeed, applyTyped } from './logic';
