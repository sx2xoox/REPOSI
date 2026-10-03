import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_W, UI_H } from '../engine/renderer';
import { save } from '../engine/save';
import { app } from '../game/app';
import { input } from '../engine/input';
import { Menu } from './widgets';
import { backdrop } from './backdrop';
import { frame } from './frame';
import { C } from './theme';
import { TownScene } from './town';

export class SaveSlotsScene implements Scene {
  touchBack = 'back' as const;
  private registering = -1;
  private menu: Menu;
  private confirm?: Menu;
  constructor(private join?: string) {
    this.menu = new Menu(Array.from({ length: 4 }, (_, i) => ({
      label: () => save.slots[i] ? `${i + 1}  ${save.slots[i]!.name}  ·  ${save.slots[i]!.progress.campaign?.cleared ?? 0}층의 기억` : `${i + 1}  비어 있는 등불`,
      action: () => {
        if (save.slots[i]) this.open(i);
        else {
          this.registering = i;
          this.confirm = new Menu([{ label: `등불 ${i + 1} 등록하고 시작`, action: () => this.open(i) }, { label: '돌아가기', action: () => { this.registering = -1; } }], UI_W / 2, 240, { width: 310 });
          input.releaseAll();
        }
      },
      hint: () => save.slots[i] ? '이 등불의 마을로 돌아갑니다.' : i === 0 && save.progress.runs > 0 ? '기존 해금과 도감 기록을 이 칸에 보존합니다.' : '독립된 마을과 이야기 기록을 새로 만듭니다.',
    })), UI_W / 2, 139, { width: 480, lineH: 57, size: 15, hintY: 365 });
  }
  private open(i: number): void { save.openSlot(i); input.releaseAll(); app.scenes.set(new TownScene(this.join)); }
  update(dt: number): void {
    backdrop().update(dt);
    if (input.pressed('cancel')) { if (this.registering >= 0) this.registering = -1; else app.goTitle(); return; }
    (this.registering >= 0 ? this.confirm! : this.menu).update(app.renderer, dt);
  }
  draw(r: Renderer): void {
    r.beginWorld('#090b12'); backdrop().draw(r); r.presentWorld(); r.beginUI();
    frame(r, UI_W / 2 - 285, 40, 570, 355, 'panel');
    r.uiText('네 개의 등불', UI_W / 2, 61, { size: 26, bold: true, color: C.goldHi, align: 'center' });
    r.uiText('각 칸에 마을 · 해금 · 이야기 · 원정 준비가 따로 저장됩니다', UI_W / 2, 99, { size: 11, color: C.textDim, align: 'center' });
    if (this.registering >= 0) {
      r.uiText(`새로운 등불 ${this.registering + 1}을 켤까요?`, UI_W / 2, 175, { size: 18, color: C.text, align: 'center' });
      this.confirm!.draw(r);
    } else {
      for (let i = 0; i < 4; i++) frame(r, UI_W / 2 - 240, this.menu.rowY(i) - 5, 480, 53, 'inset', { alpha: 0.8 });
      this.menu.draw(r);
    }
    r.uiText('이 브라우저에 자동 저장 · 탐험은 현재 스테이지 입구부터 이어집니다', UI_W / 2, UI_H - 20, { size: 10, color: C.textFaint, align: 'center' });
  }
}
