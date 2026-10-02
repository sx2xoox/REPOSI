// Full floor map (M): every known room on a parchment-dark board, current room
// pulsing, door bridges, special-room icons, a legend of what was found and
// floor progress (rooms visited / cleared).

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import type { GameScene } from './game-scene';
import { input } from '../engine/input';
import { sfx } from '../audio/audio';
import { clamp } from '../engine/math';
import type { RoomKind } from '../game/constants';
import { drawRooms, knownBounds, nodeKnown } from './minimap';
import { C, splitFloorName } from './theme';
import { frame, keyHintRow } from './frame';
import { appear } from './anim';
import { ROOM_ICONS, ROOM_LABELS } from './logic';
import { actionLabel } from './keys';
import { touchUiActive } from './touch-mode';

const LEGEND: RoomKind[] = ['boss', 'treasure', 'shop', 'secret', 'challenge', 'shrine', 'curse'];

export class MapOverlay implements Scene {
  transparent = true;
  touchBack = 'close' as const;
  private game: GameScene;
  private t = 0;
  private closing = -1;

  constructor(game: GameScene) {
    this.game = game;
  }

  enter(): void {
    sfx('ui_open', { vol: 0.5 });
  }

  update(dt: number): void {
    this.t += dt;
    if (this.closing >= 0) {
      this.closing += dt;
      if (this.closing > 0.14) this.game.closeOverlay(this);
      return;
    }
    if (input.pressed('map') || input.pressed('cancel') || input.pressed('pause') || input.pressed('inventory')) {
      sfx('ui_close', { vol: 0.5 });
      this.closing = 0;
    }
  }

  draw(r: Renderer): void {
    r.beginUI();
    const w = this.game.world;
    const k = this.closing >= 0 ? 1 - clamp(this.closing / 0.14, 0, 1) : appear(this.t, 0.22);
    r.uiRect(0, 0, UI_W, UI_H, C.void, 0.72 * k);
    const W = 640;
    const H = 380;
    const x = UI_W / 2 - W / 2;
    const y = UI_H / 2 - H / 2 + (1 - k) * 12;
    frame(r, x, y, W, H, 'ornate', { alpha: k });
    const [no, name] = splitFloorName(w.floor.name);
    r.uiText(no, x + 24, y + 16, { size: 12, color: C.gold, alpha: k });
    r.uiText(name, x + 24 + r.measureText(no, 12) + 8, y + 10, { size: 24, bold: true, color: C.text, outline: C.ink, alpha: k });
    r.uiText(w.floor.subtitle, x + 24, y + 40, { size: 10, font: 'small', color: C.textFaint, alpha: k });

    // board
    const bx = x + 20;
    const by = y + 58;
    const bw = 440;
    const bh = H - 78;
    frame(r, bx, by, bw, bh, 'inset', { alpha: k });
    const b = knownBounds(w);
    const cw = b.x1 - b.x0;
    const chh = b.y1 - b.y0;
    const cell = Math.max(14, Math.min(30, Math.floor(Math.min((bw - 30) / cw, (bh - 30) / chh))));
    const d = r.dctx;
    d.save();
    d.beginPath();
    d.rect(bx + 4, by + 4, bw - 8, bh - 8);
    d.clip();
    // faint grid
    d.globalAlpha = 0.08 * k;
    d.fillStyle = '#8a7ea0';
    for (let gx = bx + 6; gx < bx + bw; gx += cell) d.fillRect(gx, by + 4, 1, bh - 8);
    for (let gy = by + 6; gy < by + bh; gy += cell) d.fillRect(bx + 4, gy, bw - 8, 1);
    d.globalAlpha = 1;
    const reveal = appear(this.t, 0.35);
    drawRooms(r, w, bx + bw / 2, by + bh / 2, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, { cell, t: this.t, marker: true, alpha: k * reveal });
    d.restore();

    // legend + progress
    const lx = bx + bw + 14;
    const lw = x + W - 20 - lx;
    frame(r, lx, by, lw, 196, 'panel', { alpha: k });
    r.uiText('범례', lx + 12, by + 10, { size: 10, font: 'small', color: C.gold, alpha: k });
    const known = w.map.nodes.filter((n) => nodeKnown(w, n));
    const kinds = new Set(known.map((n) => n.kind));
    let ly = by + 30;
    // current position + room states
    const swatch = (fill: string, top: string, label: string) => {
      r.uiRect(lx + 12, ly - 1, 14, 12, C.ink, k);
      r.uiRect(lx + 13, ly, 12, 10, fill, k);
      r.uiRect(lx + 13, ly, 12, 2, top, k);
      r.uiText(label, lx + 34, ly, { size: 10, font: 'small', color: C.textDim, alpha: k });
      ly += 18;
    };
    swatch('#e8dcc8', '#ffffff', '현재 위치');
    swatch('#5e5276', '#7a6e94', '방문한 방');
    swatch('#241c30', '#30283e', '발견한 방');
    for (const kd of LEGEND) {
      const found = kinds.has(kd);
      const icon = ROOM_ICONS[kd];
      if (!icon) continue;
      if (!found && (kd === 'secret' || kd === 'curse' || kd === 'shrine' || kd === 'challenge')) continue;
      r.uiSprite(icon, lx + 19, ly + 5, 2, { alpha: k * (found ? 1 : 0.3) });
      r.uiText(ROOM_LABELS[kd], lx + 34, ly, { size: 10, font: 'small', color: found ? C.text : C.textMute, alpha: k });
      ly += 18;
    }
    const py = by + 204;
    frame(r, lx, py, lw, bh - 204, 'panel', { alpha: k });
    const total = w.map.nodes.filter((n) => n.kind !== 'secret').length;
    const visited = w.map.nodes.filter((n) => n.visited).length;
    const cleared = w.map.nodes.filter((n) => n.cleared && n.visited).length;
    r.uiText(`방문 ${visited} / ${total}`, lx + 12, py + 12, { size: 10, font: 'small', color: C.textDim, alpha: k });
    r.uiText(`정화 ${cleared}`, lx + 12, py + 28, { size: 10, font: 'small', color: C.textDim, alpha: k });
    r.uiText(`시드 ${w.run.seed}`, lx + 12, py + 44, { size: 10, font: 'small', color: C.textMute, alpha: k });
    if (!touchUiActive()) keyHintRow(r, [[actionLabel(input.bindings, 'map', input.aimMode === 'pad'), '닫기']], x + W - 50, y + 24, { alpha: k * 0.85, pad: input.aimMode === 'pad' });
  }
}
