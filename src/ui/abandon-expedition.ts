import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_W, UI_H } from '../engine/renderer';
import { input } from '../engine/input';
import { app } from '../game/app';
import { Menu } from './widgets';
import { frame } from './frame';
import { C } from './theme';

/** Cancel is selected first. Abandoning is never treated as a death. */
export class AbandonExpeditionOverlay implements Scene {
  transparent = true;
  touchBack = 'close' as const;
  private done = false;
  private menu: Menu;
  constructor(private accept: () => void, private destination: 'town' | 'select' | 'title' | 'speedrun' = 'town') {
    this.menu = new Menu([
      { label: '돌아가기', action: () => this.cancel() },
      { label: destination === 'speedrun' ? '스피드런 포기' : '원정 포기', danger: true, action: () => {
        if (this.done) return;
        this.done = true;
        app.scenes.pop();
        this.accept();
      } },
    ], UI_W / 2, 255, { width: 280, lineH: 34, size: 14 });
  }
  private cancel(): void { if (!this.done) { this.done = true; app.scenes.pop(); } }
  update(dt: number): void {
    if (input.pressed('cancel') || input.pressed('pause')) { this.cancel(); return; }
    this.menu.update(app.renderer, dt);
  }
  draw(r: Renderer): void {
    r.beginUI();
    r.uiRect(0, 0, UI_W, UI_H, C.void, 0.8);
    const x = UI_W / 2;
    frame(r, x - 248, 104, 496, 224, 'ornate');
    const speedrun = this.destination === 'speedrun';
    r.uiText(speedrun ? '스피드런을 포기할까요?' : '이번 원정을 포기할까요?', x, 126, { size: 20, align: 'center', color: C.gold });
    const lines = speedrun ? [
      '지금까지 쓰러뜨린 층 보스 기록은 랭킹에 남습니다.',
      '보관 중인 원정(이어가기)은 그대로 유지됩니다.',
      '마을로 돌아갑니다.',
    ] : [
      '이번 원정의 장비와 중간 저장이 사라집니다.',
      '이야기 진행과 해금 기록은 유지됩니다.',
      this.destination === 'select' ? '새 등불지기를 고른 뒤 1-1부터 출발할 수 있습니다.' :
        this.destination === 'town' ? '마을로 돌아갑니다. 다음 원정은 1-1부터 시작합니다.' : '타이틀로 돌아갑니다.',
    ];
    lines.forEach((line, i) => r.uiText(line, x, 171 + i * 22, { size: 12, align: 'center', color: i === 0 ? C.text : C.textDim }));
    this.menu.x = x;
    this.menu.draw(r);
  }
}
