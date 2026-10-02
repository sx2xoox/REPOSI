// Death / victory screen with run summary.

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import type { GameScene } from './game-scene';
import type { GameOverInfo } from '../game/world';
import { Menu } from './widgets';
import { app } from '../game/app';
import { randomSeedString } from '../engine/rng';
import { clamp } from '../engine/math';

export class GameOverOverlay implements Scene {
  transparent = true;
  private menu: Menu;
  private t = 0;
  private game: GameScene;
  private info: GameOverInfo;

  constructor(game: GameScene, info: GameOverInfo) {
    this.game = game;
    this.info = info;
    this.menu = new Menu([
      { label: '다시 도전', action: () => app.startRun(randomSeedString(), game.run.characterId) },
      { label: '같은 시드로 다시', action: () => app.startRun(game.run.seed, game.run.characterId, true) },
      { label: '타이틀로', action: () => app.goTitle() },
    ], UI_W / 2, UI_H - 130, { width: 260 });
  }

  update(dt: number): void {
    this.t += dt;
    if (this.t > 0.8) this.menu.update(app.renderer);
  }

  draw(r: Renderer): void {
    r.beginUI();
    const a = clamp(this.t / 0.8, 0, 1);
    r.uiRect(0, 0, UI_W, UI_H, '#05030a', 0.82 * a);
    const won = this.info.won;
    r.uiText(won ? '등불이 심연을 밝혔다' : '등불이 꺼졌다', UI_W / 2, 60, { size: 28, align: 'center', bold: true, alpha: a, color: won ? '#ffe080' : '#ff6a70' });
    const s = this.game.run.stats;
    const t = Math.floor(s.timeSec);
    const lines: [string, string][] = [
      ['도달 층', `${this.game.run.floor}층`],
      ['플레이 시간', `${Math.floor(t / 60)}분 ${t % 60}초`],
      ['처치', `${s.kills}`],
      ['획득 아이템', `${s.itemsTaken}`],
      ['보스 처치', `${s.bossesKilled}`],
      ['비밀 발견', `${s.secretsFound}`],
    ];
    if (!won) lines.push(['사망 원인', this.info.source || '???']);
    lines.forEach(([k, v], i) => {
      r.uiText(k, UI_W / 2 - 110, 120 + i * 20, { size: 12, color: '#8a7f9a', alpha: a });
      r.uiText(v, UI_W / 2 + 110, 120 + i * 20, { size: 12, align: 'right', color: '#e8e0d0', alpha: a });
    });
    r.uiText(`시드 ${this.game.run.seed}`, UI_W / 2, UI_H - 160, { size: 10, align: 'center', color: '#6a6078', alpha: a });
    if (this.t > 0.8) this.menu.draw(r);
  }
}
