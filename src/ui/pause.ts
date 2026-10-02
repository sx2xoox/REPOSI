// Pause menu (Esc) with resume / settings / quit, plus run info.

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import type { GameScene } from './game-scene';
import { Menu } from './widgets';
import { input } from '../engine/input';
import { app } from '../game/app';
import { SettingsOverlay } from './settings';
import { sfx } from '../audio/audio';
import { Characters } from '../game/defs';

export class PauseOverlay implements Scene {
  transparent = true;
  private menu: Menu;
  private game: GameScene;
  private t = 0;
  private confirmQuit = false;

  constructor(game: GameScene) {
    this.game = game;
    this.menu = new Menu([
      { label: '계속하기', action: () => this.close() },
      { label: '설정', action: () => app.scenes.push(new SettingsOverlay()) },
      { label: () => (this.confirmQuit ? '정말 포기할까요? (확인)' : '타이틀로 나가기'), action: () => this.quit() },
    ], UI_W / 2, UI_H / 2 - 10, { width: 300 });
  }

  enter(): void {
    sfx('ui_open');
  }

  private close(): void {
    sfx('ui_close');
    this.game.closeOverlay(this);
  }

  private quit(): void {
    if (!this.confirmQuit) {
      this.confirmQuit = true;
      return;
    }
    app.goTitle();
  }

  update(dt: number): void {
    this.t += dt;
    if (input.pressed('pause') || input.pressed('cancel')) {
      this.close();
      return;
    }
    this.menu.update(app.renderer);
  }

  draw(r: Renderer): void {
    r.beginUI();
    r.uiRect(0, 0, UI_W, UI_H, '#05030a', 0.7);
    r.uiText('일시정지', UI_W / 2, UI_H / 2 - 80, { size: 24, align: 'center', bold: true, color: '#f8e8c8' });
    this.menu.draw(r);
    const run = this.game.run;
    const ch = Characters.get(run.characterId);
    const t = Math.floor(run.stats.timeSec);
    r.uiText(`${ch?.name ?? ''}  ·  ${run.floor}층  ·  ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}  ·  처치 ${run.stats.kills}`, UI_W / 2, UI_H - 56, { size: 10, align: 'center', color: '#8a7f9a' });
    r.uiText(`시드  ${run.seed}`, UI_W / 2, UI_H - 40, { size: 10, align: 'center', color: '#6a6078' });
  }
}
