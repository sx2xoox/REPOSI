// Title screen and character select.

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import { Menu } from './widgets';
import { app } from '../game/app';
import { input } from '../engine/input';
import { audio, sfx } from '../audio/audio';
import { SettingsOverlay } from './settings';
import { Characters } from '../game/defs';
import { save } from '../engine/save';
import { randomSeedString } from '../engine/rng';

export class TitleScene implements Scene {
  private menu: Menu;
  private t = 0;

  constructor() {
    this.menu = new Menu([
      { label: '새 게임', action: () => app.goCharacterSelect() },
      { label: '설정', action: () => app.scenes.push(new SettingsOverlay()) },
    ], UI_W / 2, UI_H * 0.6, { width: 240, size: 16, lineH: 32 });
  }

  enter(): void {
    audio.playMusic('title');
  }

  update(dt: number): void {
    this.t += dt;
    this.menu.update(app.renderer);
  }

  draw(r: Renderer): void {
    r.beginWorld('#07050c');
    r.presentWorld();
    r.beginUI();
    r.uiText('등불지기', UI_W / 2, UI_H * 0.25, { size: 48, align: 'center', bold: true, color: '#ffe0a0', outline: '#3a1a08' });
    r.uiText('LANTERNKEEPER', UI_W / 2, UI_H * 0.25 + 58, { size: 12, align: 'center', color: '#a08870' });
    this.menu.draw(r);
    r.uiText('WASD 이동 · 마우스/방향키 공격 · Space 대시 · E 폭탄 · Q 액티브 · F 등불 해방', UI_W / 2, UI_H - 24, { size: 10, align: 'center', color: '#6a6078' });
  }
}

export class CharacterSelectScene implements Scene {
  private idx = 0;
  private t = 0;

  private get chars() {
    return Characters.all();
  }

  private unlocked(id: string): boolean {
    const c = Characters.get(id);
    return !!c && (c.unlocked || save.hasFlag(`unlock:${id}`));
  }

  update(dt: number): void {
    this.t += dt;
    const n = this.chars.length;
    if (input.pressed('uiRight')) { this.idx = (this.idx + 1) % n; sfx('ui_move'); }
    if (input.pressed('uiLeft')) { this.idx = (this.idx - 1 + n) % n; sfx('ui_move'); }
    if (input.pressed('cancel')) { sfx('ui_back'); app.goTitle(); return; }
    if (input.pressed('confirm')) {
      const c = this.chars[this.idx];
      if (c && this.unlocked(c.id)) {
        sfx('ui_select');
        app.startRun(randomSeedString(), c.id);
      } else sfx('ui_error');
    }
  }

  draw(r: Renderer): void {
    r.beginWorld('#07050c');
    r.presentWorld();
    r.beginUI();
    r.uiText('등불지기를 선택하세요', UI_W / 2, 40, { size: 18, align: 'center', bold: true, color: '#f8e8c8' });
    const cs = this.chars;
    cs.forEach((c, i) => {
      const x = UI_W / 2 + (i - (cs.length - 1) / 2) * 150;
      const sel = i === this.idx;
      const open = this.unlocked(c.id);
      r.uiPanel(x - 60, 90, 120, 150, { alpha: sel ? 0.95 : 0.6, border: sel ? c.color : undefined });
      r.uiSprite(c.portrait, x, 160, 4, { tint: open ? undefined : '#000000', tintAmount: 1 });
      r.uiText(open ? c.name : '???', x, 206, { size: 13, align: 'center', bold: true, color: sel ? c.color : '#b8acc8' });
      r.uiText(open ? c.title : '잠김', x, 222, { size: 10, align: 'center', color: '#8a7f9a' });
    });
    const c = cs[this.idx];
    if (c) {
      const open = this.unlocked(c.id);
      const lines = r.wrapText(open ? c.desc : c.unlockHint ?? '아직 잠겨 있습니다.', 460, 12);
      lines.forEach((l, k) => r.uiText(l, UI_W / 2, 270 + k * 16, { size: 12, align: 'center', color: '#d8d0c8' }));
      if (open && c.releaseDesc) r.uiText(`등불 해방 — ${c.releaseDesc}`, UI_W / 2, 280 + lines.length * 16, { size: 11, align: 'center', color: '#ffd080' });
    }
    r.uiText('◀ ▶ 선택 · Enter 시작 · Esc 뒤로', UI_W / 2, UI_H - 30, { size: 10, align: 'center', color: '#6a6078' });
  }
}
