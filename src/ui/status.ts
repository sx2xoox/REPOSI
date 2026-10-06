// Status overlay (Tab): artifacts, floor blessings, and full character abilities.
// each with its own grid and detail card (name, rarity, tags, description, quote,
// copies; blessings: the floor they came from). An artifact can be discarded
// (X / Del / pad X / the "버리기" button, pressed twice) back onto a pedestal.
// Also: equipped weapon / active / potion, lantern resonance with tier progress
// pips, and the full stat sheet.

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W, UI_W_BASE, uiCenterX } from '../engine/renderer';
import type { GameScene } from './game-scene';
import { input } from '../engine/input';
import { app } from '../game/app';
import { Actives, Floors, Potions, RARITY_COLOR, RARITY_NAME, Sets, Weapons } from '../game/defs';
import type { ComputedArtifact } from '../game/inventory';
import { discardArtifact, discardBlockFor } from '../game/interact';
import { blessingFloor } from '../game/blessings';
import { sfx } from '../audio/audio';
import { clamp } from '../engine/math';
import { BASE_STATS } from '../game/stats';
import { potionSpriteFor } from '../game/pickups';
import { C, formatTime, roman, splitFloorName } from './theme';
import { fitScale, frame, gauge, iconSlot, keyHintRow, keyHintWidth, keycap, spriteCentered } from './frame';
import { Repeater, Spring, appear } from './anim';
import { characterKitRows, fullStatRows, gridMove, scrollToRow } from './logic';
import { actionLabel } from './keys';
import { touchUiActive } from './touch-mode';
import { estimateDps, powerScore } from '../game/power';
import { SYNERGIES, synergyActive } from '../game/synergies';
import { RELEASE_COOLDOWN } from '../game/ember';

const COLS = 10;
const CELL = 40;
const ROWS = 4;
const GX = 30;
const GY = 90;
/** detail card height (below the grid) */
const DETAIL_H = 136;
const TABS = [
  { label: '유물', icon: 'ui_gem' },
  { label: '축복', icon: 'ui_flame' },
  { label: '캐릭터', icon: 'st_dash' },
] as const;
/** seconds the discard stays armed ("한 번 더 눌러 버리기") */
const ARM_TIME = 3;
/** equipment panel height (weapon / active row + the keeper's passive row) */
const EQUIP_H = 154;
const RES_H = 80;
const WEAPON_KIND: Record<string, string> = { ranged: '원거리', melee: '근접', charge: '차지', beam: '광선' };

export class StatusOverlay implements Scene {
  transparent = true;
  touchBack = 'close' as const;
  private game: GameScene;
  private sel = 0;
  private selT = 0;
  private t = 0;
  private scroll = 0;
  private scrollS = new Spring(0, 300, 30);
  private closing = -1;
  private rep = { l: new Repeater(), r: new Repeater(), u: new Repeater(), d: new Repeater() };
  private resScroll = 0;
  private hover = -1;
  /** 0 = 유물, 1 = 축복, 2 = 캐릭터 */
  private tab = 0;
  private tabT = 9;
  /** artifact id armed for discarding (second press discards) and when */
  private armedId = '';
  private armedT = -9;
  /** feedback line under the detail card */
  private msg: { text: string; color: string; t: number } | null = null;

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

  /** Entries of the current tab (artifacts incl. innate traits, or blessings). */
  private list(): ComputedArtifact[] {
    if (this.tab === 2) return [];
    const all = this.game.world.items.computed?.artifacts ?? [];
    return all.filter((a) => !!a.def.blessing === (this.tab === 1));
  }

  private tabRect(i: number): { x: number; y: number; w: number; h: number } {
    return { x: GX + i * 96, y: 56, w: 92, h: 26 };
  }

  private discardRect(): { x: number; y: number; w: number; h: number } {
    const dy = GY + ROWS * CELL + 6;
    const armed = this.isArmed();
    const w = armed ? 150 : 92;
    return { x: GX + COLS * CELL - 2 - 10 - w, y: dy + DETAIL_H - 34, w, h: 24 };
  }

  private isArmed(): boolean {
    const cur = this.list()[this.sel];
    return !!cur && this.armedId === cur.def.id && this.t - this.armedT < ARM_TIME;
  }

  private setTab(i: number): void {
    const n = (i + TABS.length) % TABS.length;
    if (n === this.tab) return;
    this.tab = n;
    this.tabT = 0;
    this.sel = 0;
    this.selT = 0;
    this.scroll = 0;
    this.armedId = '';
    this.msg = null;
    sfx('ui_move');
  }

  private say(text: string, color: string): void {
    this.msg = { text, color, t: this.t };
  }

  /** First press arms, second press (within ARM_TIME) discards one copy. */
  private tryDiscard(): void {
    const w = this.game.world;
    const cur = this.list()[this.sel];
    if (!cur) return;
    const why = discardBlockFor(w, cur.def.id);
    if (why) {
      sfx('ui_error');
      this.say(why, C.bad);
      return;
    }
    if (!this.isArmed()) {
      this.armedId = cur.def.id;
      this.armedT = this.t;
      this.msg = null;
      sfx('ui_select', { vol: 0.7 });
      return;
    }
    this.armedId = '';
    if (this.game.online) {
      // co-op: the discard is a lockstep command (applied on every peer at the same tick)
      this.game.command({ type: 'discard', id: cur.def.id });
      sfx('ui_place');
      this.say(`${cur.def.name}을(를) 곁에 내려놓았다`, C.textDim);
      return;
    }
    const ped = discardArtifact(w, cur.def.id);
    if (!ped) {
      sfx('ui_error');
      return;
    }
    sfx('ui_place');
    w.particles.burst(ped.x, ped.y - 10, { count: 12, speed: [20, 60], life: [0.3, 0.6], colors: ['#ffffff', RARITY_COLOR[cur.def.rarity]], size: [1, 2] });
    this.say(`${cur.def.name}을(를) 곁에 내려놓았다`, C.textDim);
    const n = this.list().length;
    if (this.sel >= n) this.sel = Math.max(0, n - 1);
    this.selT = 0;
  }

  update(dt: number): void {
    this.t += dt;
    this.selT += dt;
    this.tabT += dt;
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
    const m = app.renderer.displayToUI(input.mouseX, input.mouseY);
    m.x -= uiCenterX();
    const click = input.pressed('fire');
    const inRect = (q: { x: number; y: number; w: number; h: number }) => m.x >= q.x && m.x < q.x + q.w && m.y >= q.y && m.y < q.y + q.h;
    // tabs: Q / E (pad LB / RB), or click / tap a tab
    if (input.pressed('tabPrev')) this.setTab(this.tab - 1);
    else if (input.pressed('tabNext')) this.setTab(this.tab + 1);
    if (click) for (let i = 0; i < TABS.length; i++) if (inRect(this.tabRect(i))) this.setTab(i);
    const n = this.list().length;
    const old = this.sel;
    if (n > 0) {
      if (this.rep.r.update(input.held('uiRight'), dt)) this.sel = gridMove(this.sel, n, COLS, 1, 0);
      if (this.rep.l.update(input.held('uiLeft'), dt)) this.sel = gridMove(this.sel, n, COLS, -1, 0);
      if (this.rep.d.update(input.held('uiDown'), dt)) this.sel = gridMove(this.sel, n, COLS, 0, 1);
      if (this.rep.u.update(input.held('uiUp'), dt)) this.sel = gridMove(this.sel, n, COLS, 0, -1);
      this.hover = -1;
      for (let i = 0; i < n; i++) {
        const { x, y } = this.cellPos(i);
        if (y < GY - 4 || y > GY + (ROWS - 1) * CELL + 4) continue;
        if (m.x >= x && m.x < x + CELL - 2 && m.y >= y && m.y < y + CELL - 2) {
          this.hover = i;
          if (input.mouseMoved || click) this.sel = i;
        }
      }
      if (input.wheel) {
        if (m.x > 460) this.resScroll = Math.max(0, this.resScroll + Math.sign(input.wheel));
        else this.scroll = clamp(this.scroll + Math.sign(input.wheel), 0, Math.max(0, Math.ceil(n / COLS) - ROWS));
      }
    } else this.hover = -1;
    if (this.sel !== old) {
      sfx('ui_move', { vol: 0.5 });
      this.selT = 0;
      this.armedId = '';
      this.msg = null;
      this.scroll = scrollToRow(this.scroll, Math.floor(this.sel / COLS), ROWS);
    }
    // discard (artifacts tab): key / pad X, or click / tap the button
    if (this.tab === 0 && n > 0 && (input.pressed('discard') || (click && inRect(this.discardRect())))) this.tryDiscard();
    else if (this.tab === 1 && input.pressed('discard') && n > 0) {
      sfx('ui_error');
      this.say('축복은 등불에 새겨져 버릴 수 없다', C.bad);
    }
  }

  draw(r: Renderer): void {
    const w = this.game.world;
    const p = w.player;
    r.beginUI();
    const k = this.closing >= 0 ? 1 - clamp(this.closing / 0.14, 0, 1) : appear(this.t, 0.2);
    r.uiRect(0, 0, UI_W, UI_H, C.void, 0.8 * k);
    r.dctx.translate(uiCenterX(), 0); // 768-wide layout centered on wide screens
    const oy = (1 - k) * 10;
    frame(r, 12, 8 + oy, UI_W_BASE - 24, UI_H - 16, 'ornate', { alpha: k });

    // header
    r.uiText('소지품', 30, 20 + oy, { size: 24, bold: true, color: C.text, outline: C.ink, alpha: k });
    const ch = p.character;
    r.uiSprite(ch.portrait, 136, 34 + oy, 1.5, { alpha: k });
    r.uiText(ch.name, 156, 22 + oy, { size: 12, bold: true, color: ch.color, alpha: k });
    r.uiText(ch.title, 156, 37 + oy, { size: 10, font: 'small', color: C.textFaint, alpha: k });
    const [no, fname] = splitFloorName(w.floor.name);
    const hx = UI_W_BASE - 30 - (touchUiActive() ? 46 : 0); // leave room for the touch ✕ button
    r.uiText(`${no} · ${fname}`, hx, 20 + oy, { size: 12, align: 'right', color: C.textDim, alpha: k });
    r.uiText(`${formatTime(w.run.stats.timeSec)}  ·  처치 ${w.run.stats.kills}  ·  시드 ${w.run.seed}`, hx, 37 + oy, { size: 10, font: 'small', align: 'right', color: C.textFaint, alpha: k });

    // power: grows with every artifact / blessing (also shown in the HUD)
    const comp = w.items.computed;
    const nBless = comp?.artifacts.filter((a) => a.def.blessing).length ?? 0;
    const nArts = (comp?.artifacts.length ?? 0) - nBless;
    r.uiSprite('hud_power', 268, 32 + oy, 2, { alpha: k });
    r.uiText(`위력 ${powerScore(p.stats, comp)}`, 282, 18 + oy, { size: 16, bold: true, color: C.goldHi, outline: C.ink, alpha: k });
    r.uiText(`초당 피해 약 ${Math.round(estimateDps(p.stats))} · 유물 ${nArts} · 축복 ${nBless}`, 282, 38 + oy, { size: 10, font: 'small', color: C.textFaint, alpha: k });

    this.drawArtifacts(r, k, oy);
    this.drawEquipment(r, k, oy);
    this.drawResonance(r, k, oy);
    this.drawStats(r, k, oy);
  }

  // ---------------------------------------------------------------- artifacts / blessings
  private drawArtifacts(r: Renderer, k: number, oy: number): void {
    const w = this.game.world;
    const arts = this.list();
    const all = w.items.computed?.artifacts ?? [];
    const pad = input.aimMode === 'pad';
    const touch = touchUiActive();
    // tabs
    TABS.forEach((tb, i) => {
      const q = this.tabRect(i);
      const on = i === this.tab;
      const count = all.filter((a) => !!a.def.blessing === (i === 1)).length;
      frame(r, q.x, q.y + oy, q.w, q.h, on ? 'buttonHi' : 'button', { alpha: k });
      spriteCentered(r, tb.icon, q.x + 15, q.y + 13 + oy, fitScale(tb.icon, 16, 2), { alpha: k * (on ? 1 : 0.55) });
      r.uiText(tb.label, q.x + 26, q.y + 6 + oy, { size: 12, bold: on, color: on ? C.goldHi : C.textDim, alpha: k });
      if (i < 2) r.uiText(`${count}`, q.x + q.w - 10, q.y + 8 + oy, { size: 10, font: 'small', align: 'right', color: on ? C.text : C.textFaint, alpha: k });
    });
    if (!touch) {
      const tabKey = pad ? 'LB/RB' : `${actionLabel(input.bindings, 'tabPrev')}/${actionLabel(input.bindings, 'tabNext')}`;
      const hints: [string, string][] = [[tabKey, '전환']];
      if (this.tab === 0) hints.push([actionLabel(input.bindings, 'discard', pad), '버리기']);
      hints.push([actionLabel(input.bindings, 'inventory', pad), '닫기']);
      const total = hints.reduce((sum, [kk, l]) => sum + keyHintWidth(r, kk, l, pad), 0) + 12 * (hints.length - 1);
      keyHintRow(r, hints, GX + COLS * CELL - 2 - total / 2, 407 + oy, { alpha: k * 0.8, pad, gap: 12 });
    }
    if (this.tab === 2) { this.drawCharacter(r, k, oy); return; }
    const tk = k * appear(this.tabT, 0.2);
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
      const stagger = clamp(tk * 1.5 - (i % 40) * 0.015, 0, 1);
      const cx = x + (CELL - 2) / 2;
      const cy = y + (CELL - 2) / 2 + oy;
      if (!a) {
        frame(r, x, y + oy, CELL - 2, CELL - 2, 'inset', { alpha: stagger * 0.5 });
        continue;
      }
      const pop = isSel ? 1 + 0.12 * Math.max(0, 1 - this.selT * 5) : 1;
      iconSlot(r, null, cx, cy, CELL - 2, { selected: isSel, alpha: stagger });
      spriteCentered(r, a.def.icon, cx, cy, fitScale(a.def.icon, CELL - 8, 2) * pop, { alpha: stagger });
      if (!a.def.blessing) r.uiSprite(`ui_rarity_${a.def.rarity}`, x + CELL - 9, y + 7 + oy, 1.5, { alpha: stagger });
      if (a.power > 1) r.uiText(`x${a.power}`, x + CELL - 5, y + CELL - 16 + oy, { size: 10, font: 'small', align: 'right', color: C.goldHi, alpha: stagger, outline: C.ink });
      // armed for discarding: red pulse on the cell
      if (isSel && this.isArmed()) r.uiStrokeRect(x + 1, y + 1 + oy, CELL - 4, CELL - 4, C.bad, 2, stagger * (0.6 + 0.4 * Math.sin(this.t * 12)));
    }
    d.restore();
    if (this.hover >= 0 && arts[this.hover] && input.aimMode === 'mouse') {
      const a = arts[this.hover];
      const { x, y } = this.cellPos(this.hover);
      const name = a.def.name;
      const sub = a.def.blessing ? '등불의 축복' : `${RARITY_NAME[a.def.rarity]}${a.power > 1 ? ` · x${a.power}` : ''}`;
      const tw = Math.max(r.measureText(name, 12, true), r.measureText(sub, 10, false, 'small')) + 20;
      const tx = Math.min(GX + COLS * CELL - tw, x + CELL / 2 - tw / 2);
      const ty = y + oy - 36;
      const col = a.def.blessing ? '#ffd060' : RARITY_COLOR[a.def.rarity];
      frame(r, tx, ty, tw, 32, 'tooltip', { color: col, alpha: k });
      r.uiText(name, tx + 10, ty + 4, { size: 12, bold: true, color: col, alpha: k });
      r.uiText(sub, tx + 10, ty + 18, { size: 10, font: 'small', color: C.textDim, alpha: k });
    }
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
    frame(r, GX, dy, dw, DETAIL_H, 'panel', { alpha: k });
    const cur = arts[this.sel];
    if (!cur) {
      if (this.tab === 1) {
        r.uiText('아직 받은 축복이 없습니다.', GX + 16, dy + 20, { size: 12, color: C.textDim, alpha: tk });
        r.uiText('층에 내려설 때마다 등불이 축복 하나를 내려 줍니다.', GX + 16, dy + 40, { size: 10, font: 'small', color: C.textFaint, alpha: tk });
      } else {
        r.uiText('아직 유물이 없습니다.', GX + 16, dy + 20, { size: 12, color: C.textDim, alpha: tk });
        r.uiText('보물방, 상점, 보스에게서 유물을 찾아 등불을 키우세요.', GX + 16, dy + 40, { size: 10, font: 'small', color: C.textFaint, alpha: tk });
      }
      return;
    }
    const def = cur.def;
    const col = def.blessing ? '#ffd060' : RARITY_COLOR[def.rarity];
    const ka = tk * appear(this.selT, 0.18);
    frame(r, GX + 12, dy + 12, 52, 52, 'slot', { alpha: k });
    spriteCentered(r, def.icon, GX + 38, dy + 38, fitScale(def.icon, 44, 2.5), { alpha: ka });
    r.uiText(def.name, GX + 76, dy + 10, { size: 16, bold: true, color: col, alpha: ka });
    if (cur.power > 1) r.uiText(`보유 x${cur.power}`, GX + dw - 14, dy + 13, { size: 10, font: 'small', align: 'right', color: C.goldHi, alpha: ka });
    // rarity + tags
    let tx = GX + 76;
    if (!def.blessing) {
      r.uiSprite(`ui_rarity_${def.rarity}`, GX + 81, dy + 39, 2, { alpha: ka });
      tx = GX + 90;
    }
    const rname = def.blessing ? '등불의 축복' : RARITY_NAME[def.rarity];
    r.uiText(rname, tx, dy + 33, { size: 10, font: 'small', color: col, alpha: ka });
    tx += 6 + r.measureText(rname, 10, false, 'small');
    for (const tag of def.tags) {
      const st = Sets.get(tag);
      if (!st) continue;
      const tw = r.measureText(st.name, 10, false, 'small') + 24;
      frame(r, tx, dy + 30, tw, 18, 'tooltip', { color: st.color, alpha: ka });
      r.uiSprite(st.icon, tx + 9, dy + 39, 1.5, { alpha: ka });
      r.uiText(st.name, tx + 17, dy + 33, { size: 10, font: 'small', color: st.color, alpha: ka });
      tx += tw + 4;
    }
    const lines = r.wrapText([def.desc, def.detail].filter(Boolean).join(' '), dw - 92, def.detail ? 10 : 12, false, def.detail ? 'small' : 'main');
    lines.slice(0, def.detail ? 4 : 2).forEach((l, i) => r.uiText(l, GX + 76, dy + 54 + i * (def.detail ? 11 : 15), { size: def.detail ? 10 : 12, font: def.detail ? 'small' : 'main', color: C.text, alpha: ka }));
    const qy = dy + 57 + Math.min(2, lines.length) * 15;
    if (!def.detail && def.signature) r.uiText(`특징 · ${def.signature}`, GX + 76, qy, { size: 10, font: 'small', color: C.info, alpha: ka });
    else if (!def.detail && def.quote) r.uiText(`“${def.quote}”`, GX + 76, qy, { size: 10, font: 'small', color: '#a89878', alpha: ka });
    // bottom strip: source / discard
    const by = dy + DETAIL_H - 34;
    r.uiRect(GX + 12, by - 6, dw - 24, 1, C.rimDark, ka);
    const msg = this.msg && this.t - this.msg.t < 3 ? this.msg : null;
    if (def.blessing) {
      const fl = blessingFloor(w, def.id);
      const fname = fl ? Floors.all().find((f) => f.index === fl)?.name : undefined;
      const src = fname ? `${fname}에서 받은 축복` : '등불이 내려 준 축복';
      r.uiSprite('ui_rarity_legendary', GX + 20, by + 12, 1.5, { alpha: ka });
      r.uiText(msg?.text ?? src, GX + 30, by + 6, { size: 10, font: 'small', color: msg?.color ?? '#e8d090', alpha: ka });
      r.uiText('버릴 수 없음', GX + dw - 14, by + 6, { size: 10, font: 'small', align: 'right', color: C.textMute, alpha: ka });
      return;
    }
    const why = discardBlockFor(w, def.id);
    if (why) {
      r.uiText(msg?.text ?? why, GX + 14, by + 6, { size: 10, font: 'small', color: msg?.color ?? C.textFaint, alpha: ka });
      r.uiText('버릴 수 없음', GX + dw - 14, by + 6, { size: 10, font: 'small', align: 'right', color: C.textMute, alpha: ka });
      return;
    }
    const armed = this.isArmed();
    const q = this.discardRect();
    const left = armed ? '버리면 곁의 받침대에 놓여 다시 주울 수 있다' : cur.power > 1 ? `한 개만 내려놓는다 (남은 수 x${cur.power - 1})` : '내려놓은 유물은 다시 주울 수 있다';
    r.uiText(msg?.text ?? left, GX + 14, by + 6, { size: 10, font: 'small', color: msg?.color ?? (armed ? C.textDim : C.textFaint), alpha: ka });
    const hot = this.hover < 0 && input.aimMode === 'mouse' && (() => {
      const m = app.renderer.displayToUI(input.mouseX, input.mouseY);
      m.x -= uiCenterX();
      return m.x >= q.x && m.x < q.x + q.w && m.y >= q.y && m.y < q.y + q.h;
    })();
    frame(r, q.x, q.y + oy, q.w, q.h, armed || hot ? 'buttonHi' : 'button', { alpha: ka });
    if (armed) r.uiStrokeRect(q.x, q.y + oy, q.w, q.h, C.bad, 2, ka * (0.5 + 0.5 * Math.sin(this.t * 10)));
    const key = touch ? '' : actionLabel(input.bindings, 'discard', pad);
    const label = armed ? '한 번 더 눌러 버리기' : '버리기';
    const lw = r.measureText(label, 10, false, 'small');
    const kw = key ? Math.max(18, Math.ceil((r.measureText(key, 10, false, 'small') + 10) / 2) * 2) + 4 : 0;
    const lx = q.x + (q.w - lw - kw) / 2;
    if (key) keycap(r, key, lx, q.y + q.h / 2 + oy, { align: 'left', alpha: ka, pad });
    r.uiText(label, lx + kw, q.y + 6 + oy, { size: 10, font: 'small', color: armed ? C.bad : C.text, alpha: ka });
  }

  private drawCharacter(r: Renderer, k: number, oy: number): void {
    const p = this.game.world.local;
    const ch = p.character;
    const touch = touchUiActive();
    const rows = characterKitRows(ch, true, touch);
    const cards = [
      ...rows.map(row => ({ title: `${row.label} · ${row.name}`, icon: row.icon, desc: row.desc,
        hint: row.kind === 'dash' ? `${touch ? '대시 버튼' : actionLabel(input.bindings, 'dash', input.aimMode === 'pad')} · 재사용 ${p.stats.dashCooldown.toFixed(2)}초`
          : row.kind === 'release' ? `${touch ? '해방 버튼' : actionLabel(input.bindings, 'special', input.aimMode === 'pad')} · 게이지 100 · 재사용 ${RELEASE_COOLDOWN}초` : '' })),
      { title: `선호 무기 · ${ch.affinity?.name ?? '없음'}`, icon: Weapons.get(p.weaponId)?.icon ?? 'ui_question',
        desc: ch.affinity?.desc ?? '모든 무기를 고르게 다룹니다.', hint: p.flags.has('affinity') ? '현재 적용 중' : '현재 미적용' },
    ];
    cards.forEach((card, i) => {
      const y = GY + i * 77 + oy;
      frame(r, GX, y, COLS * CELL - 2, 72, 'panel', { alpha: k });
      spriteCentered(r, card.icon, GX + 22, y + 22, fitScale(card.icon, 24, 2), { alpha: k });
      r.uiText(card.title, GX + 43, y + 8, { size: 12, bold: true, color: ch.color, alpha: k });
      r.wrapText(card.desc, 366, 10, false, 'small').forEach((line, j) => r.uiText(line, GX + 12, y + 29 + j * 12, { size: 10, font: 'small', color: C.textDim, alpha: k }));
      if (card.hint) r.uiText(card.hint, GX + 384, y + 58, { size: 10, font: 'small', align: 'right', color: C.gold, alpha: k });
    });
  }

  // ---------------------------------------------------------------- equipment
  private drawEquipment(r: Renderer, k: number, oy: number): void {
    const w = this.game.world;
    const p = w.player;
    const x = 460;
    const y = 58 + oy;
    const ww = UI_W_BASE - 30 - x;
    frame(r, x, y, ww, EQUIP_H, 'panel', { alpha: k });
    r.uiText('장비', x + 12, y + 8, { size: 10, font: 'small', color: C.gold, alpha: k });
    const truncate = (text: string, width: number) => {
      if (r.measureText(text, 10, false, 'small') <= width) return text;
      while (text.length && r.measureText(text + '…', 10, false, 'small') > width) text = text.slice(0, -1);
      return text + '…';
    };
    const rows = [
      { id: p.weaponId, state: p.weapon, label: '주무기', yy: y + 23 },
      { id: p.weapon2Id, state: p.weapon2, label: '보조무기', yy: y + 61 },
    ];
    for (const row of rows) {
      const def = row.id ? Weapons.get(row.id) : undefined;
      iconSlot(r, def?.icon ?? null, x + 28, row.yy + 14, 30, { alpha: k, selected: row.label === '주무기', scale: def ? fitScale(def.icon, 24, 2) : 1 });
      r.uiText(row.label, x + 51, row.yy, { size: 10, font: 'small', color: C.textFaint, alpha: k });
      const temper = Number(row.state.mem.temper ?? 0);
      const name = def ? def.name + (temper ? ' [' + (temper > 0 ? '+' : '') + temper + ']' : '') : '장착하지 않음';
      r.uiText(truncate(name, ww - 112), x + 106, row.yy, { size: 10, font: 'small', color: def ? RARITY_COLOR[def.rarity] : C.textMute, alpha: k });
      const detail = def ? (def.archetype ?? WEAPON_KIND[def.kind] ?? '') + (row.label === '주무기' && p.flags.has('affinity') ? ' · 선호 무기' : '') : '무기를 주우면 이 칸에 보관합니다';
      r.uiText(truncate(detail, ww - 66), x + 51, row.yy + 15, { size: 10, font: 'small', color: C.textDim, alpha: k });
    }
    r.uiRect(x + 12, y + 99, ww - 24, 1, C.rimDark, k);
    const act = p.activeId ? Actives.get(p.activeId) : undefined;
    iconSlot(r, act?.icon ?? null, x + 25, y + 117, 24, { alpha: k, scale: act ? fitScale(act.icon, 20, 1.5) : 1 });
    r.uiText(truncate(act ? '액티브 · ' + act.name : '액티브 없음', ww - 110), x + 45, y + 104, { size: 10, font: 'small', color: act ? '#c0e0ff' : C.textMute, alpha: k });
    if (act) gauge(r, x + 45, y + 118, ww - 64, 5, p.activeCharge / act.charge, { fill: '#ffd040', segments: act.timed ? 0 : act.charge, alpha: k });
    const ch = p.character;
    r.uiText(truncate('고유 능력 · ' + (ch.passive?.name ?? '없음') + '   /   대시 · ' + (ch.dash?.name ?? '질주'), ww - 24), x + 12, y + 136, { size: 10, font: 'small', color: ch.color, alpha: k });
    if (p.potionId) {
      const def = Potions.get(p.potionId);
      const known = w.run.identified.has(p.potionId);
      r.uiSprite(potionSpriteFor(w, p.potionId), x + ww - 20, y + 15, 1.5, { alpha: k });
      r.uiText(known && def ? def.name : '정체불명의 물약', x + ww - 32, y + 9, { size: 10, font: 'small', align: 'right', color: C.textFaint, alpha: k });
    }
  }

  // ---------------------------------------------------------------- resonance
  private drawResonance(r: Renderer, k: number, oy: number): void {
    const w = this.game.world;
    const x = 460;
    const y = 58 + EQUIP_H + 6 + oy;
    const ww = UI_W_BASE - 30 - x;
    const h = RES_H;
    frame(r, x, y, ww, h, 'panel', { alpha: k });
    r.uiText('등불 공명', x + 12, y + 8, { size: 12, bold: true, color: C.goldHi, alpha: k });
    const sets = [...(w.items.computed?.sets ?? [])].sort((a, b) => b.active.length - a.active.length || b.count - a.count);
    const counts = w.items.computed?.tagCounts ?? {};
    for (const s of SYNERGIES) {
      if (!s.tags.some((tag) => (counts[tag] ?? 0) > 0)) continue;
      const active = synergyActive(counts, s.tags);
      const tier = { count: 4, desc: s.desc, hooks: {} };
      const def = { tag: s.id, name: `혼합 · ${s.name}`, color: s.color, icon: `res_${s.tags[0]}`, tiers: [tier] };
      const count = s.tags.reduce((n, tag) => n + Math.min(2, counts[tag] ?? 0), 0);
      sets.unshift({ def, count, active: active ? [tier] : [], next: active ? undefined : { ...tier, desc: s.tags.map((t) => `${Sets.get(t)?.name} ${counts[t] ?? 0}/2`).join(' · ') } });
    }
    if (!sets.length) {
      r.uiText('같은 속성의 유물을 모으면', x + 12, y + 34, { size: 10, font: 'small', color: C.textFaint, alpha: k });
      r.uiText('공명이 깨어납니다.', x + 12, y + 48, { size: 10, font: 'small', color: C.textFaint, alpha: k });
      // show all tags dimly as a teaser
      Sets.all().slice(0, 8).forEach((s, i) => r.uiSprite(s.icon, x + 20 + i * 30, y + 64, 2, { alpha: k * 0.35 }));
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
    const y = 58 + EQUIP_H + 6 + RES_H + 6 + oy;
    const ww = UI_W_BASE - 30 - x;
    const h = UI_H - 30 - y + oy - 6;
    frame(r, x, y, ww, h, 'panel', { alpha: k });
    r.uiText('능력치', x + 12, y + 8, { size: 10, font: 'small', color: C.gold, alpha: k });
    const base = { ...BASE_STATS, ...(p.character.baseStats ?? {}) };
    const rows = fullStatRows(p.stats, base);
    // show the eight core stats + anything that differs from base
    const core = rows.slice(0, 8);
    const extra = rows.slice(8).filter((rr) => rr[2] !== 0);
    const list = [...core, ...extra].slice(0, 10);
    const colW = (ww - 24) / 2;
    list.forEach(([label, val, cmp], i) => {
      const cx = x + 12 + (i % 2) * colW;
      const cy = y + 24 + Math.floor(i / 2) * 13;
      r.uiText(label, cx, cy, { size: 10, font: 'small', color: C.textFaint, alpha: k });
      r.uiText(val, cx + colW - 10, cy, { size: 10, font: 'small', align: 'right', color: cmp > 0 ? C.good : cmp < 0 ? C.bad : C.text, alpha: k });
    });
  }
}
