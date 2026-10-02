// Status overlay (Tab): collected artifacts with descriptions, lantern
// resonance progress, weapon, active item and character stats.

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import type { GameScene } from './game-scene';
import { input } from '../engine/input';
import { app } from '../game/app';
import { Actives, RARITY_COLOR, RARITY_NAME, Weapons } from '../game/defs';
import { sfx } from '../audio/audio';

export class StatusOverlay implements Scene {
  transparent = true;
  private game: GameScene;
  private sel = 0;

  constructor(game: GameScene) {
    this.game = game;
  }

  enter(): void {
    sfx('ui_open');
  }

  private close(): void {
    sfx('ui_close');
    this.game.closeOverlay(this);
  }

  update(): void {
    if (input.pressed('inventory') || input.pressed('cancel') || input.pressed('pause')) {
      this.close();
      return;
    }
    const n = this.game.world.items.computed?.artifacts.length ?? 0;
    if (n > 0) {
      if (input.pressed('uiRight')) { this.sel = (this.sel + 1) % n; sfx('ui_move'); }
      if (input.pressed('uiLeft')) { this.sel = (this.sel - 1 + n) % n; sfx('ui_move'); }
      if (input.pressed('uiDown')) { this.sel = Math.min(n - 1, this.sel + 8); sfx('ui_move'); }
      if (input.pressed('uiUp')) { this.sel = Math.max(0, this.sel - 8); sfx('ui_move'); }
      // mouse hover
      const m = app.renderer.displayToUI(input.mouseX, input.mouseY);
      for (let i = 0; i < n; i++) {
        const { x, y } = this.cellPos(i);
        if (m.x >= x && m.x < x + 40 && m.y >= y && m.y < y + 40 && input.mouseMoved) this.sel = i;
      }
    }
  }

  private cellPos(i: number): { x: number; y: number } {
    return { x: 40 + (i % 8) * 44, y: 96 + Math.floor(i / 8) * 44 };
  }

  draw(r: Renderer): void {
    const w = this.game.world;
    const p = w.player;
    const comp = w.items.computed;
    r.beginUI();
    r.uiRect(0, 0, UI_W, UI_H, '#05030a', 0.82);
    r.uiText('소지품', 40, 40, { size: 20, bold: true, color: '#f8e8c8' });
    r.uiText('Tab 닫기', UI_W - 40, 46, { size: 10, align: 'right', color: '#8a7f9a' });

    // weapon & active
    const wdef = Weapons.get(p.weaponId);
    if (wdef) {
      r.uiPanel(40, 64 - 2, 168, 26, { alpha: 0.6 });
      r.uiSprite(wdef.icon, 54, 75, 1.5);
      r.uiText(wdef.name, 70, 68, { size: 11, color: '#f0e0c0' });
    }
    if (p.activeId) {
      const a = Actives.get(p.activeId);
      if (a) {
        r.uiPanel(216, 62, 176, 26, { alpha: 0.6 });
        r.uiSprite(a.icon, 230, 75, 1.5);
        r.uiText(a.name, 246, 68, { size: 11, color: '#c0e0ff' });
      }
    }

    // artifacts grid
    const arts = comp?.artifacts ?? [];
    if (!arts.length) r.uiText('아직 유물이 없습니다.', 40, 110, { size: 12, color: '#6a6078' });
    arts.forEach((a, i) => {
      const { x, y } = this.cellPos(i);
      const sel = i === this.sel;
      r.uiPanel(x, y, 40, 40, { alpha: sel ? 0.95 : 0.6, border: sel ? '#ffd080' : undefined });
      r.uiSprite(a.def.icon, x + 20, y + 20, 2);
      if (a.power > 1) r.uiText(`x${a.power}`, x + 36, y + 26, { size: 10, align: 'right', color: '#ffe080' });
    });
    const cur = arts[this.sel];
    if (cur) {
      const y = 96 + Math.ceil(arts.length / 8) * 44 + 8;
      r.uiPanel(40, y, 348, 74, { alpha: 0.9 });
      r.uiText(cur.def.name, 52, y + 10, { size: 14, bold: true, color: RARITY_COLOR[cur.def.rarity] });
      r.uiText(RARITY_NAME[cur.def.rarity], 376, y + 12, { size: 10, align: 'right', color: RARITY_COLOR[cur.def.rarity] });
      const lines = r.wrapText(cur.def.desc, 320, 11);
      lines.slice(0, 3).forEach((l, k) => r.uiText(l, 52, y + 32 + k * 14, { size: 11, color: '#d8d0c8' }));
    }

    // resonance
    const rx = 420;
    r.uiText('등불 공명', rx, 64, { size: 14, bold: true, color: '#ffd080' });
    let ry = 88;
    for (const s of comp?.sets ?? []) {
      r.uiSprite(s.def.icon, rx + 10, ry + 8, 2);
      r.uiText(`${s.def.name}  ${s.count}${s.next ? `/${s.next.count}` : ''}`, rx + 26, ry, { size: 12, color: s.active.length ? s.def.color : '#8a7f9a' });
      ry += 18;
      for (const t of s.def.tiers) {
        const on = s.count >= t.count;
        r.uiText(`(${t.count}) ${t.desc}`, rx + 26, ry, { size: 10, color: on ? '#e8e0d0' : '#5a5068' });
        ry += 14;
      }
      ry += 6;
      if (ry > UI_H - 150) break;
    }
    if (!comp?.sets.length) r.uiText('같은 속성의 유물을 모으면 공명이 깨어납니다.', rx, 90, { size: 10, color: '#6a6078' });

    // stats
    const st = p.stats;
    const lines: [string, string][] = [
      ['공격력', st.damage.toFixed(1)], ['공격 속도', `${st.fireRate.toFixed(2)}/s`], ['사거리', (st.range / 37).toFixed(1)],
      ['탄속', (st.shotSpeed / 230).toFixed(2)], ['이동 속도', (st.moveSpeed / 92).toFixed(2)], ['행운', st.luck.toFixed(0)],
      ['치명타', `${Math.round(st.critChance * 100)}% x${st.critMult.toFixed(1)}`],
    ];
    lines.forEach(([k, v], i) => {
      r.uiText(k, rx, UI_H - 130 + i * 15, { size: 11, color: '#8a7f9a' });
      r.uiText(v, rx + 110, UI_H - 130 + i * 15, { size: 11, color: '#e8e0d0' });
    });
  }
}
