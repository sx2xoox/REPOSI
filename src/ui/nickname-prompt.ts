// "랭킹 닉네임": the name shown on the speedrun ranking (the same stored nickname as co-op,
// save.settings.nickname). Asked once before the first speedrun; editable from the ranking
// screen. The text goes through the DOM text field (softKeyboard), so Hangul / IME works on
// desktop and phones alike.

import type { Scene, TouchButtonSpec } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W, UI_W_BASE, uiCenterX } from '../engine/renderer';
import { input } from '../engine/input';
import { app } from '../game/app';
import { sfx } from '../audio/audio';
import { save } from '../engine/save';
import { clamp, ease } from '../engine/math';
import { appear } from './anim';
import { C } from './theme';
import { frame, keyHintRow } from './frame';
import { softKeyboard, touchUiActive } from './touch-mode';
import { finalNickname, sanitizeNickname } from '../net/code';

/** The ranking name, or '' when none has been chosen yet. */
export function speedrunName(): string {
  return finalNickname(save.settings.nickname ?? '', '');
}

const BOX_W = 360;
const BOX_H = 176;

export class NicknamePrompt implements Scene {
  transparent = true;
  touchBack = 'close' as const;
  private t = 0;
  private edit: string;
  private shake = 0;
  private closing = -1;
  private result: string | null = null;

  constructor(private readonly onDone: (name: string | null) => void, private readonly o: { title?: string; note?: string } = {}) {
    this.edit = speedrunName();
  }

  enter(): void {
    input.textCapture = true;
    input.releaseAll();
    sfx('ui_open');
    this.focus();
  }

  exit(): void {
    softKeyboard.close();
    input.textCapture = false;
    input.releaseAll();
  }

  private focus(): void {
    softKeyboard.open(this.edit, (v) => { this.edit = v; }, { sanitize: sanitizeNickname, maxLength: 24, label: '닉네임', capitalize: 'off' });
  }

  private box(): { x: number; y: number; w: number; h: number } {
    return { x: UI_W_BASE / 2 - BOX_W / 2, y: UI_H / 2 - BOX_H / 2 - 10, w: BOX_W, h: BOX_H };
  }

  private buttons(): { x: number; y: number; w: number; h: number; label: string; ok: boolean }[] {
    const b = this.box();
    return [
      { x: b.x + b.w / 2 - 128, y: b.y + b.h - 42, w: 120, h: 28, label: '확인', ok: true },
      { x: b.x + b.w / 2 + 8, y: b.y + b.h - 42, w: 120, h: 28, label: '취소', ok: false },
    ];
  }

  touchButtons(): TouchButtonSpec[] {
    const b = this.box();
    const ox = uiCenterX();
    return [{ x: ox + b.x + 30, y: b.y + 40, w: b.w - 60, h: 44, tap: () => softKeyboard.request(), ghost: true }];
  }

  private confirm(): void {
    const name = finalNickname(this.edit, '');
    if (!name) {
      this.shake = 0.35;
      sfx('ui_error');
      return;
    }
    save.settings.nickname = name;
    save.saveSettings();
    sfx('ui_select');
    this.close(name);
  }

  private close(result: string | null): void {
    if (this.closing >= 0) return;
    this.result = result;
    this.closing = 0;
    softKeyboard.close();
    input.textCapture = false;
  }

  update(dt: number): void {
    this.t += dt;
    this.shake = Math.max(0, this.shake - dt);
    if (this.closing >= 0) {
      this.closing += dt;
      if (this.closing > 0.14) {
        app.scenes.remove(this);
        this.onDone(this.result);
        this.closing = -2;
      }
      return;
    }
    if (this.closing === -2) return;
    if (!touchUiActive() && typeof document !== 'undefined' && document.activeElement?.id !== 'lk-text') this.focus();
    const typed = input.typed;
    if (input.pressed('cancel') && !typed.includes('\b')) {
      sfx('ui_back');
      this.close(null);
      return;
    }
    if (input.pressed('confirm') && !typed.includes(' ')) {
      this.confirm();
      return;
    }
    if (input.pressed('fire')) {
      const m = app.renderer.displayToUI(input.mouseX, input.mouseY);
      m.x -= uiCenterX();
      for (const bt of this.buttons()) {
        if (m.x < bt.x || m.x > bt.x + bt.w || m.y < bt.y || m.y > bt.y + bt.h) continue;
        if (bt.ok) this.confirm();
        else { sfx('ui_back'); this.close(null); }
      }
    }
  }

  draw(r: Renderer): void {
    r.beginUI();
    const k = this.closing >= 0 ? 1 - clamp(this.closing / 0.14, 0, 1) : appear(this.t, 0.25, 0, ease.outBack);
    const a = clamp(k, 0, 1);
    r.uiRect(0, 0, UI_W, UI_H, C.void, 0.6 * a);
    r.dctx.save();
    r.dctx.translate(uiCenterX(), 0);
    const b = this.box();
    const sx = this.shake > 0 ? Math.sin(this.shake * 60) * 4 * (this.shake / 0.35) : 0;
    const y = b.y + (1 - k) * 14;
    frame(r, b.x, y, b.w, b.h, 'ornate', { alpha: a });
    r.uiText(this.o.title ?? '랭킹 닉네임', UI_W_BASE / 2, y + 14, { size: 16, bold: true, align: 'center', color: C.goldHi, alpha: a });
    frame(r, b.x + 34 + sx, y + 44, b.w - 68, 34, 'inset', { alpha: a });
    const shown = this.edit;
    const touchUi = touchUiActive();
    if (shown) r.uiText(shown, UI_W_BASE / 2 + sx, y + 53, { size: 16, align: 'center', color: C.text, alpha: a });
    else r.uiText(touchUi ? '눌러서 입력' : '닉네임을 입력하세요', UI_W_BASE / 2 + sx, y + 55, { size: 12, align: 'center', color: C.textMute, alpha: a });
    if (shown && Math.floor(this.t * 2.2) % 2 === 0) r.uiRect(UI_W_BASE / 2 + sx + r.measureText(shown, 16) / 2 + 2, y + 52, 2, 18, C.goldHi, a);
    const note = (this.o.note ?? '최대 10자 · 스피드런 랭킹에 모두에게 보이는 이름이에요').split('\n');
    note.forEach((line, i) => r.uiText(line, UI_W_BASE / 2, y + 86 + i * 12 - (note.length - 1) * 4, { size: 10, font: 'small', align: 'center', color: C.textFaint, alpha: a }));
    for (const bt of this.buttons()) {
      const by = bt.y + (1 - k) * 14;
      frame(r, bt.x, by, bt.w, bt.h, bt.ok ? 'buttonHi' : 'button', { alpha: a });
      r.uiText(bt.label, bt.x + bt.w / 2, by + 8, { size: 12, bold: bt.ok, align: 'center', color: bt.ok ? C.goldHi : C.textDim, alpha: a });
    }
    if (!touchUi) keyHintRow(r, [['Enter', '확인'], ['Esc', '취소']], UI_W_BASE / 2, UI_H - 15);
    r.dctx.restore();
  }
}
