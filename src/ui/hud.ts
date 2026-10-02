// In-game HUD (drawn in UI space 768x432): hearts, consumables, active item,
// potion, minimap, boss bar, item banners, floor title card.

import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import type { World } from '../game/world';
import { Actives, Potions } from '../game/defs';
import { clamp, ease } from '../engine/math';
import { drawMinimap } from './minimap';
import { save } from '../engine/save';
import { potionSpriteFor } from '../game/pickups';
import { STAT_LABELS, type StatKey } from '../game/stats';
import { EMBER_MAX } from '../game/player';

export function drawHud(r: Renderer, w: World, fps = 60): void {
  const p = w.player;
  r.beginUI();

  // ---- active item box
  const ax = 14;
  const ay = 12;
  r.uiPanel(ax, ay, 44, 44, { alpha: 0.75 });
  if (p.activeId) {
    const def = Actives.get(p.activeId);
    if (def) {
      const ready = p.activeCharge >= def.charge;
      r.uiSprite(def.icon, ax + 22, ay + 22, 2, { flash: ready ? 0.15 + 0.15 * Math.sin(w.time * 6) : 0, alpha: ready ? 1 : 0.6 });
      // charge bar
      const bh = 36;
      const fill = clamp(p.activeCharge / def.charge, 0, 1);
      r.uiRect(ax + 46, ay + 4, 6, bh, '#0c0810');
      r.uiRect(ax + 47, ay + 5 + (bh - 2) * (1 - fill), 4, (bh - 2) * fill, ready ? '#ffe060' : '#5ab0ff');
      if (!def.timed) for (let i = 1; i < def.charge; i++) r.uiRect(ax + 46, ay + 4 + (bh * i) / def.charge, 6, 1, '#0c0810');
      r.uiText('Q', ax + 2, ay + 32, { size: 10, color: '#a098b0' });
    }
  }

  // ---- hearts
  const hx = 76;
  const hy = 14;
  const totalHalf = p.maxRed + p.soul;
  const slots = Math.ceil(totalHalf / 2);
  for (let i = 0; i < slots; i++) {
    const x = hx + (i % 6) * 20;
    const y = hy + Math.floor(i / 6) * 18;
    const redIdx = i * 2;
    let spr: string;
    if (redIdx < p.maxRed) {
      const v = p.red - redIdx;
      spr = v >= 2 ? 'hud_heart_full' : v === 1 ? 'hud_heart_half' : 'hud_heart_empty';
    } else {
      const v = p.soul - (redIdx - p.maxRed);
      spr = v >= 2 ? 'hud_soul_full' : 'hud_soul_half';
    }
    const beat = p.red + p.soul <= 2 && i === 0 ? 1 + 0.12 * Math.max(0, Math.sin(w.time * 8)) : 1;
    r.uiSprite(spr, x, y, 2, { sx: beat, sy: beat, flash: p.flash > 0 ? 0.6 : 0 });
  }

  // ---- consumables
  const cy = 52;
  const items: [string, number][] = [['hud_coin', p.coins], ['hud_bomb', p.bombs], ['hud_key', p.keys]];
  items.forEach(([icon, n], i) => {
    const y = cy + i * 17;
    r.uiSprite(icon, 82, y + 6, 2);
    r.uiText(String(n).padStart(2, '0'), 94, y, { size: 12, color: '#f4ecdc' });
  });

  // ---- stats column (Isaac-style)
  const st = p.stats;
  const shown: [StatKey, string][] = [['moveSpeed', '🏃'], ['fireRate', ''], ['damage', ''], ['range', ''], ['shotSpeed', ''], ['luck', '']];
  let sy = 112;
  for (const [k] of shown) {
    const label = STAT_LABELS[k] ?? k;
    const v = st[k];
    const txt = k === 'moveSpeed' ? (v / 92).toFixed(2) : k === 'range' ? (v / 37).toFixed(1) : k === 'shotSpeed' ? (v / 230).toFixed(2) : k === 'fireRate' ? v.toFixed(2) : k === 'damage' ? v.toFixed(1) : v.toFixed(0);
    r.uiText(label, 14, sy, { size: 10, color: '#8a8098', font: 'small' });
    r.uiText(txt, 68, sy, { size: 10, color: '#e0d8c8', font: 'small' });
    sy += 13;
  }

  // ---- ember gauge (bottom left): "등불 해방" when full (F)
  {
    const gx = 16;
    const gy = UI_H - 28;
    const gw = 132;
    const f = clamp(p.ember / EMBER_MAX, 0, 1);
    const full = f >= 1;
    r.uiSprite('hud_ember', gx + 6, gy + 6, 2, { flash: full ? 0.3 + 0.3 * Math.sin(w.time * 8) : 0 });
    r.uiRect(gx + 16, gy + 1, gw, 10, '#0c0810');
    r.uiRect(gx + 17, gy + 2, (gw - 2) * f, 8, full ? '#ffd060' : '#e0702a');
    r.uiRect(gx + 17, gy + 2, (gw - 2) * f, 2, full ? '#fff4c0' : '#ffa060');
    if (full) r.uiText('F  등불 해방', gx + 22 + gw, gy - 1, { size: 10, color: '#ffe080', alpha: 0.7 + 0.3 * Math.sin(w.time * 6) });
  }

  // ---- potion (bottom right)
  if (p.potionId) {
    const def = Potions.get(p.potionId);
    const known = w.run.identified.has(p.potionId);
    r.uiPanel(UI_W - 54, UI_H - 54, 40, 40, { alpha: 0.75 });
    r.uiSprite(potionSpriteFor(w, p.potionId), UI_W - 34, UI_H - 34, 2);
    r.uiText('R', UI_W - 50, UI_H - 26, { size: 10, color: '#a098b0' });
    r.uiText(known && def ? def.name : '???', UI_W - 60, UI_H - 46, { size: 10, align: 'right', color: '#d0c8e0' });
  }

  // ---- minimap
  drawMinimap(r, w, UI_W - 132, 10, 120, 84);
  r.uiText(`${w.floor.name}`, UI_W - 12, 98, { size: 10, align: 'right', color: '#a098b0' });

  // ---- boss bar
  const bosses = w.bosses;
  if (bosses.length) {
    const hp = bosses.reduce((s, b) => s + Math.max(0, b.hp), 0);
    const max = bosses.reduce((s, b) => s + b.maxHp, 0);
    const bw = 300;
    const bx = (UI_W - bw) / 2;
    const by = UI_H - 30;
    r.uiText(bosses[0].def.name, UI_W / 2, by - 16, { size: 12, align: 'center', color: '#ffd0d0', bold: true });
    r.uiRect(bx - 2, by - 2, bw + 4, 14, '#0c0810');
    r.uiRect(bx, by, bw, 10, '#3a0c14');
    r.uiRect(bx, by, bw * clamp(hp / max, 0, 1), 10, '#d02838');
    r.uiRect(bx, by, bw * clamp(hp / max, 0, 1), 3, '#ff6a70');
  }

  // ---- banners
  w.banners.forEach((b, i) => drawBanner(r, b, i));

  // ---- floor card
  if (w.floorCard) {
    const t = w.floorCard.t;
    const a = t < 0.4 ? t / 0.4 : t > 2.4 ? Math.max(0, 1 - (t - 2.4) / 0.6) : 1;
    const y = UI_H * 0.32;
    r.uiRect(0, y - 8, UI_W, 64, '#000000', 0.55 * a);
    r.uiText(w.floorCard.name, UI_W / 2, y, { size: 24, align: 'center', bold: true, alpha: a, color: '#f8e8c8' });
    r.uiText(w.floorCard.subtitle, UI_W / 2, y + 32, { size: 12, align: 'center', alpha: a, color: '#b0a0c0' });
  }

  // ---- boss intro
  if (w.bossIntro) {
    const t = w.bossIntro.t;
    const e = w.bossIntro.enemy;
    const a = t < 0.3 ? t / 0.3 : t > 1.8 ? Math.max(0, 1 - (t - 1.8) / 0.4) : 1;
    const slide = ease.outCubic(clamp(t / 0.4, 0, 1));
    r.uiRect(0, UI_H * 0.36, UI_W, 90, '#000000', 0.7 * a);
    r.uiText(e.def.bossTitle ?? '', UI_W / 2 - 200 + 200 * slide, UI_H * 0.36 + 16, { size: 12, align: 'center', alpha: a, color: '#d08080' });
    r.uiText(e.def.name, UI_W / 2 + 200 - 200 * slide, UI_H * 0.36 + 40, { size: 28, align: 'center', bold: true, alpha: a, color: '#ffffff', outline: '#600010' });
  }

  if (save.settings.showFps) r.uiText(`${Math.round(fps)} FPS`, UI_W - 8, UI_H - 14, { size: 10, align: 'right', color: '#80ff80' });
}

function drawBanner(r: Renderer, b: World['banners'][number], i: number): void {
  const t = b.t;
  const a = t < 0.25 ? t / 0.25 : t > 2.6 ? Math.max(0, 1 - (t - 2.6) / 0.6) : 1;
  const y = 84 + i * 70 - (1 - ease.outCubic(clamp(t / 0.3, 0, 1))) * 20;
  const w = 380;
  const x = (UI_W - w) / 2;
  r.uiPanel(x, y, w, b.small ? 44 : 58, { alpha: 0.85 * a });
  let tx = x + 14;
  if (b.icon) {
    r.uiSprite(b.icon, x + 30, y + 29, 2, { alpha: a });
    tx = x + 54;
  }
  r.uiText(b.title, tx, y + 8, { size: b.small ? 12 : 16, bold: true, color: b.color, alpha: a });
  r.uiText(b.desc, tx, y + (b.small ? 26 : 32), { size: 12, color: '#d8d0c8', alpha: a });
}
