// Status overlay (Tab): artifact grid with a detail card (name, rarity, tags,
// description, quote, copies), equipped weapon / active / potion, lantern
// resonance with tier progress pips, and the full stat sheet.

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import type { GameScene } from './game-scene';
import { input } from '../engine/input';
import { app } from '../game/app';
import { Actives, Potions, RARITY_COLOR, RARITY_NAME, Sets, Weapons } from '../game/defs';
import { sfx } from '../audio/audio';
import { clamp, ease } from '../engine/math';
import { BASE_STATS } from '../game/stats';
import { potionSpriteFor } from '../game/pickups';
import { C, formatTime, roman, splitFloorName } from './theme';
import { divider, fitScale, frame, gauge, iconSlot, keyHintRow, spriteCentered } from './frame';
import { Repeater, Spring, appear } from './anim';
import { fullStatRows, gridMove, scrollToRow } from './logic';

const COLS = 10;
const CELL = 40;
const ROWS = 5;
const GX = 30;
const GY = 86;
const WEAPON_KIND: Record<string, string> = { ranged: '원거리', melee: '근접', charge: '차지', beam: '광선' };

export class StatusOverlay implements Scene {
  transparent = true;
  private game: GameScene;
  private sel = 0;
  private selT = 0;
  private t = 0;
  private scroll = 0;
  private scrollS = new Spring(0, 300, 30);
  private closing = -1;
  private rep = { l: new Repeater(), r: new Repeater(), u: new Repeater(), d: new Repeater() };
  private resScroll = 0;

  constructor(game: GameScene) {
    this.game = game;
  }

  enter(): void {
    sfx('ui_open');
  }

  private close(): void {
    if (this.closing >= 0) return;
    sfx('ui_close');
    this.closing = 0;
  }

  private cellPos(i: number): { x: number; y: number } {
    return { x: GX + (i % COLS) * CELL, y: GY + (Math.floor(i / COLS) - this.scrollS.value) * CELL };
  }

  update(dt: number): void {
    this.t += dt;
    this.selT += dt;
    this.scrollS.target = this.scroll;
    this.scrollS.update(dt);
    if (this.closing >= 0) {
      this.closing += dt;
      if (this.closing > 0.14) this.game.closeOverlay(this);
      return;
    }
    if (input.pressed('inventory') || input.pressed('cancel') || input.pressed('pause')) {
      this.close();
      return;
    }
    const n = this.game.world.items.computed?.artifacts.length ?? 0;
    const old = this.sel;
    if (n > 0) {
      if (this.rep.r.update(input.held('uiRight'), dt)) this.sel = gridMove(this.sel, n, COLS, 1, 0);
      if (this.rep.l.update(input.held('uiLeft'), dt)) this.sel = gridMove(this.sel, n, COLS, -1, 0);
      if (this.rep.d.update(input.held('uiDown'), dt)) this.sel = gridMove(this.sel, n, COLS, 0, 1);
      if (this.rep.u.update(input.held('uiUp'), dt)) this.sel = gridMove(this.sel, n, COLS, 0, -1);
      const m = app.renderer.displayToUI(input.mouseX, input.mouseY);
      if (input.mouseMoved) {
        for (let i = 0; i < n; i++) {
          const { x, y } = this.cellPos(i);
          if (y < GY - 4 || y > GY + (ROWS - 1) * CELL + 4) continue;
          if (m.x >= x && m.x < x + CELL - 2 && m.y >= y && m.y < y + CELL - 2) this.sel = i;
        }
      }
      if (input.wheel) {
        if (m.x > 460) this.resScroll = Math.max(0, this.resScroll + Math.sign(input.wheel));
        else this.scroll = clamp(this.scroll + Math.sign(input.wheel), 0, Math.max(0, Math.ceil(n / COLS) - ROWS));
      }
    }
    if (this.sel !== old) {
      sfx('ui_move', { vol: 0.5 });
      this.selT = 0;
      this.scroll = scrollToRow(this.scroll, Math.floor(this.sel / COLS), ROWS);
    }
  }

  draw(r: Renderer): void {
    const w = this.game.world;
    const p = w.player;
    const comp = w.items.computed;
    r.beginUI();
    const k = this.closing >= 0 ? 1 - clamp(this.closing / 0.14, 0, 1) : appear(this.t, 0.2);
    r.uiRect(0, 0, UI_W, UI_H, C.void, 0.8 * k);
    const oy = (1 - k) * 10;
    frame(r, 12, 8 + oy, UI_W - 24, UI_H - 16, 'ornate', { alpha: k });

    // header
    r.uiText('소지품', 30, 20 + oy, { size: 24, bold: true, color: C.text, outline: C.ink, alpha: k });
    const ch = p.character;
    r.uiSprite(ch.portrait, 136, 34 + oy, 1.5, { alpha: k });
    r.uiText(ch.name, 156, 22 + oy, { size: 12, bold: true, color: ch.color, alpha: k });
    r.uiText(ch.title, 156, 37 + oy, { size: 10, font: 'small', color: C.textFaint, alpha: k });
    const [no, fname] = splitFloorName(w.floor.name);
    r.uiText(`${no} · ${fname}`, UI_W - 30, 20 + oy, { size: 12, align: 'right', color: C.textDim, alpha: k });
    r.uiText(`${formatTime(w.run.stats.timeSec)}  ·  처치 ${w.run.stats.kills}  ·  시드 ${w.run.seed}`, UI_W - 30, 37 + oy, { size: 10, font: 'small', align: 'right', color: C.textFaint, alpha: k });

    this.drawArtifacts(r, k, oy);
    this.drawEquipment(r, k, oy);
    this.drawResonance(r, k, oy);
    this.drawStats(r, k, oy);
    void comp;
  }

  // ---------------------------------------------------------------- artifacts
  private drawArtifacts(r: Renderer, k: number, oy: number): void {
    const w = this.game.world;
    const arts = w.items.computed?.artifacts ?? [];
    const total = arts.reduce((s, a) => s + a.power, 0);
    r.uiText('유물', GX, 64 + oy, { size: 12, bold: true, color: C.goldHi, alpha: k });
    r.uiText(`${arts.length}종 · ${total}개`, GX + 34, 66 + oy, { size: 10, font: 'small', color: C.textFaint, alpha: k });
    keyHintRow(r, [['방향키', '선택'], ['Tab', '닫기']], GX + COLS * CELL - 80, 71 + oy, { alpha: k * 0.8, pad: input.aimMode === 'pad' });
    const d = r.dctx;
    d.save();
    d.beginPath();
    d.rect(GX - 4, GY - 4 + oy, COLS * CELL + 8, ROWS * CELL + 6);
    d.clip();
    for (let i = 0; i < COLS * Math.max(ROWS, Math.ceil(arts.length / COLS)); i++) {
      const { x, y } = this.cellPos(i);
      if (y < GY - CELL || y > GY + ROWS * CELL) continue;
      const a = arts[i];
      const isSel = i === this.sel && !!a;
      const stagger = clamp(k * 1.5 - (i % 40) * 0.015, 0, 1);
      const cx = x + (CELL - 2) / 2;
      const cy = y + (CELL - 2) / 2 + oy;
      if (!a) {
        frame(r, x, y + oy, CELL - 2, CELL - 2, 'inset', { alpha: stagger * 0.5 });
        continue;
      }
      const pop = isSel ? 1 + 0.12 * Math.max(0, 1 - this.selT * 5) : 1;
      iconSlot(r, null, cx, cy, CELL - 2, { selected: isSel, alpha: stagger });
      spriteCentered(r, a.def.icon, cx, cy, fitScale(a.def.icon, CELL - 8, 2) * pop, { alpha: stagger });
      r.uiSprite(`ui_rarity_${a.def.rarity}`, x + CELL - 9, y + 7 + oy, 1.5, { alpha: stagger });
      if (a.power > 1) r.uiText(`x${a.power}`, x + CELL - 5, y + CELL - 16 + oy, { size: 10, font: 'small', align: 'right', color: C.goldHi, alpha: stagger, outline: C.ink });
    }
    d.restore();
    const rows = Math.ceil(arts.length / COLS);
    if (rows > ROWS) {
      const sx = GX + COLS * CELL + 2;
      const th = ROWS * CELL - 4;
      r.uiRect(sx, GY + oy, 3, th, '#1a1424', k);
      r.uiRect(sx, GY + oy + (this.scrollS.value / rows) * th, 3, (ROWS / rows) * th, C.gold, k);
    }
    // detail card
    const dy = GY + ROWS * CELL + 6 + oy;
    const dw = COLS * CELL - 2;
    frame(r, GX, dy, dw, 106, 'panel', { alpha: k });
    const cur = arts[this.sel];
    if (!cur) {
      r.uiText('아직 유물이 없습니다.', GX + 16, dy + 20, { size: 12, color: C.textDim, alpha: k });
      r.uiText('보물방, 상점, 보스에게서 유물을 찾아 등불을 키우세요.', GX + 16, dy + 40, { size: 10, font: 'small', color: C.textFaint, alpha: k });
      return;
    }
    const def = cur.def;
    const col = RARITY_COLOR[def.rarity];
    const ka = k * appear(this.selT, 0.18);
    frame(r, GX + 12, dy + 12, 52, 52, 'slot', { alpha: k });
    spriteCentered(r, def.icon, GX + 38, dy + 38, fitScale(def.icon, 44, 2.5), { alpha: ka });
    r.uiText(def.name, GX + 76, dy + 12, { size: 16, bold: true, color: col, alpha: ka });
    r.uiSprite(`ui_rarity_${def.rarity}`, GX + dw - 64, dy + 19, 2, { alpha: ka });
    r.uiText(RARITY_NAME[def.rarity], GX + dw - 56, dy + 13, { size: 10, font: 'small', color: col, alpha: ka });
    if (cur.power > 1) r.uiText(`보유 x${cur.power}`, GX + dw - 14, dy + 13, { size: 10, font: 'small', align: 'right', color: C.goldHi, alpha: ka });
    // tags
    let tx = GX + 76;
    for (const tag of def.tags) {
      const s = Sets.get(tag);
      if (!s) continue;
      const tw = r.measureText(s.name, 10, false, 'small') + 24;
      frame(r, tx, dy + 34, tw, 18, 'tooltip', { color: s.color, alpha: ka });
      r.uiSprite(s.icon, tx + 9, dy + 43, 1.5, { alpha: ka });
      r.uiText(s.name, tx + 17, dy + 37, { size: 10, font: 'small', color: s.color, alpha: ka });
      tx += tw + 4;
    }
    const lines = r.wrapText(def.desc, dw - 92, 12);
    lines.slice(0, 2).forEach((l, i) => r.uiText(l, GX + 76, dy + 56 + i * 15, { size: 12, color: C.text, alpha: ka }));
    if (def.quote) r.uiText(`“${def.quote}”`, GX + 76, dy + 58 + Math.min(2, lines.length) * 15, { size: 10, font: 'small', color: '#a89878', alpha: ka });
  }

  // ---------------------------------------------------------------- equipment
  private drawEquipment(r: Renderer, k: number, oy: number): void {
    const w = this.game.world;
    const p = w.player;
    const x = 460;
    const y = 58 + oy;
    const ww = UI_W - 30 - x;
    frame(r, x, y, ww, 92, 'panel', { alpha: k });
    r.uiText('장비', x + 12, y + 8, { size: 10, font: 'small', color: C.gold, alpha: k });
    const wdef = Weapons.get(p.weaponId);
    if (wdef) {
      iconSlot(r, wdef.icon, x + 30, y + 42, 36, { alpha: k });
      r.uiText(wdef.name, x + 54, y + 24, { size: 12, bold: true, color: C.text, alpha: k });
      r.uiText(`무기 · ${WEAPON_KIND[wdef.kind] ?? ''}`, x + 54, y + 40, { size: 10, font: 'small', color: C.textFaint, alpha: k });
    }
    const half = x + ww / 2 + 6;
    const act = p.activeId ? Actives.get(p.activeId) : undefined;
    if (act) {
      const ready = p.activeCharge >= act.charge;
      iconSlot(r, act.icon, half + 18, y + 42, 36, { alpha: k, selected: ready });
      r.uiText(act.name, half + 42, y + 24, { size: 12, bold: true, color: '#c0e0ff', alpha: k });
      gauge(r, half + 42, y + 42, 70, 8, p.activeCharge / act.charge, { fill: ready ? '#ffd040' : '#5ab0ff', segments: act.timed ? 0 : act.charge, alpha: k });
    } else {
      iconSlot(r, null, half + 18, y + 42, 36, { alpha: k * 0.6 });
      r.uiText('액티브 없음', half + 42, y + 34, { size: 10, font: 'small', color: C.textMute, alpha: k });
    }
    // descriptions (one line each)
    const dl = (s: string) => r.wrapText(s, ww / 2 - 22, 10, false, 'small')[0] ?? '';
    if (wdef) r.uiText(dl(wdef.desc), x + 12, y + 70, { size: 10, font: 'small', color: C.textDim, alpha: k });
    if (act) r.uiText(dl(act.desc), half, y + 70, { size: 10, font: 'small', color: C.textDim, alpha: k });
    if (p.potionId) {
      const def = Potions.get(p.potionId);
      const known = w.run.identified.has(p.potionId);
      r.uiSprite(potionSpriteFor(w, p.potionId), x + ww - 22, y + 14, 1.5, { alpha: k });
      r.uiText(known && def ? def.name : '정체불명의 물약', x + ww - 34, y + 8, { size: 10, font: 'small', align: 'right', color: C.textFaint, alpha: k });
    }
  }

  // ---------------------------------------------------------------- resonance
  private drawResonance(r: Renderer, k: number, oy: number): void {
    const w = this.game.world;
    const x = 460;
    const y = 156 + oy;
    const ww = UI_W - 30 - x;
    const h = 140;
    frame(r, x, y, ww, h, 'panel', { alpha: k });
    r.uiText('등불 공명', x + 12, y + 8, { size: 12, bold: true, color: C.goldHi, alpha: k });
    const sets = [...(w.items.computed?.sets ?? [])].sort((a, b) => b.active.length - a.active.length || b.count - a.count);
    if (!sets.length) {
      r.uiText('같은 속성의 유물을 모으면', x + 12, y + 34, { size: 10, font: 'small', color: C.textFaint, alpha: k });
      r.uiText('공명이 깨어납니다.', x + 12, y + 48, { size: 10, font: 'small', color: C.textFaint, alpha: k });
      // show all tags dimly as a teaser
      Sets.all().slice(0, 8).forEach((s, i) => r.uiSprite(s.icon, x + 20 + i * 30, y + 82, 2, { alpha: k * 0.35 }));
      return;
    }
    const rowH = 28;
    const visible = Math.floor((h - 30) / rowH);
    this.resScroll = Math.min(this.resScroll, Math.max(0, sets.length - visible));
    const d = r.dctx;
    d.save();
    d.beginPath();
    d.rect(x + 4, y + 26, ww - 8, h - 30);
    d.clip();
    sets.slice(this.resScroll, this.resScroll + visible + 1).forEach((s, i) => {
      const ry = y + 28 + i * rowH;
      const on = s.active.length > 0;
      const top = s.active[s.active.length - 1];
      r.uiSprite(s.def.icon, x + 18, ry + 9, 2, { alpha: k * (on ? 1 : 0.5) });
      r.uiText(s.def.name, x + 32, ry + 1, { size: 12, bold: on, color: on ? s.def.color : C.textFaint, alpha: k });
      // tier pips
      const tiers = [...s.def.tiers].sort((a, b) => a.count - b.count);
      const maxCount = tiers[tiers.length - 1]?.count ?? 1;
      let px = x + 32 + r.measureText(s.def.name, 12, on) + 8;
      for (let c = 1; c <= maxCount; c++) {
        const isTier = tiers.some((t) => t.count === c);
        const filled = s.count >= c;
        const sz = isTier ? 6 : 4;
        r.uiRect(px, ry + 7 - sz / 2 + 1, sz, sz, C.ink, k);
        r.uiRect(px + 1, ry + 7 - sz / 2 + 2, sz - 2, sz - 2, filled ? s.def.color : '#2a2236', k);
        px += sz + 2;
      }
      r.uiText(`${s.count}${s.next ? `/${s.next.count}` : ''}`, x + ww - 12, ry + 2, { size: 10, font: 'small', align: 'right', color: on ? C.text : C.textFaint, alpha: k });
      const t = top ?? s.next;
      if (t) {
        const label = top ? `${roman(s.active.length)} ${t.desc}` : `(${t.count}개) ${t.desc}`;
        const line = r.wrapText(label, ww - 44, 10, false, 'small')[0] ?? '';
        r.uiText(line, x + 32, ry + 15, { size: 10, font: 'small', color: top ? '#e8e0d0' : C.textMute, alpha: k });
      }
    });
    d.restore();
    if (sets.length > visible) r.uiText(`▼ ${sets.length - visible - this.resScroll > 0 ? sets.length - visible - this.resScroll : 0}`, x + ww - 12, y + 8, { size: 10, font: 'small', align: 'right', color: C.textFaint, alpha: k });
  }

  // ---------------------------------------------------------------- stats
  private drawStats(r: Renderer, k: number, oy: number): void {
    const w = this.game.world;
    const p = w.player;
    const x = 460;
    const y = 302 + oy;
    const ww = UI_W - 30 - x;
    const h = UI_H - 30 - y + oy - 6;
    frame(r, x, y, ww, h, 'panel', { alpha: k });
    r.uiText('능력치', x + 12, y + 8, { size: 10, font: 'small', color: C.gold, alpha: k });
    const base = { ...BASE_STATS, ...(p.character.baseStats ?? {}) };
    const rows = fullStatRows(p.stats, base);
    // show the eight core stats + anything that differs from base
    const core = rows.slice(0, 8);
    const extra = rows.slice(8).filter((rr) => rr[2] !== 0);
    const list = [...core, ...extra].slice(0, 12);
    const colW = (ww - 24) / 2;
    list.forEach(([label, val, cmp], i) => {
      const cx = x + 12 + (i % 2) * colW;
      const cy = y + 24 + Math.floor(i / 2) * 13;
      r.uiText(label, cx, cy, { size: 10, font: 'small', color: C.textFaint, alpha: k });
      r.uiText(val, cx + colW - 10, cy, { size: 10, font: 'small', align: 'right', color: cmp > 0 ? C.good : cmp < 0 ? C.bad : C.text, alpha: k });
    });
    void ease;
    void divider;
  }
}
