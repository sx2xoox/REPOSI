// Full floor map (M).

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import type { GameScene } from './game-scene';
import { input } from '../engine/input';
import { drawMinimap } from './minimap';
import { sfx } from '../audio/audio';

export class MapOverlay implements Scene {
  transparent = true;
  private game: GameScene;

  constructor(game: GameScene) {
    this.game = game;
  }

  enter(): void {
    sfx('ui_open', { vol: 0.5 });
  }

  update(): void {
    if (input.pressed('map') || input.pressed('cancel') || input.pressed('pause') || input.pressed('inventory')) {
      sfx('ui_close', { vol: 0.5 });
      this.game.closeOverlay(this);
    }
  }

  draw(r: Renderer): void {
    r.beginUI();
    r.uiRect(0, 0, UI_W, UI_H, '#05030a', 0.6);
    const w = this.game.world;
    drawMinimap(r, w, UI_W / 2 - 170, 50, 340, 320, true);
    r.uiText(`${w.floor.name}`, UI_W / 2, 24, { size: 16, align: 'center', bold: true, color: '#f8e8c8' });
  }
}
