// "등불의 축복" overlay: at the start of every floor the keeper picks one of
// three blessings. Cards with icon, name and description; keyboard (←/→ +
// Enter), mouse (hover + click), gamepad (d-pad / stick + A) and touch (tap a
// card) all work. The world stays paused while it is open.

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import type { GameScene } from './game-scene';
import { input } from '../engine/input';
import { app } from '../game/app';
import { Artifacts } from '../game/defs';
import { sfx } from '../audio/audio';
import { clamp, ease } from '../engine/math';
import { C } from './theme';
import { divider, frame, glow, keyHintRow, spriteCentered } from './frame';
import { Repeater, appear } from './anim';
import { actionLabel } from './keys';
import { touchUiActive } from './touch-mode';
import { blessingRole, blessingChoices, blessingCompatibility, canRerollBlessing, rerollBlessings } from '../game/blessings';

const CARD_W = 178;
const CARD_H = 230;
const GAP = 18;

export class BlessingOverlay implements Scene {
  transparent = true;
  touchBack = false as const;
  private t = 0;
  private sel = 0;
  private chosen = -1;
  private chosenT = 0;
  private hover = -1;
  private readonly rl = new Repeater();
  private readonly rr = new Repeater();
  private readonly floor: number;
  private pendingReroll = false;
  private serial: number;

  constructor(private readonly game: GameScene, private choices: string[]) {
    this.floor = game.world.run.floor;
    this.serial = game.world.local.vars.__blessOfferSerial ?? 0;
  }

  enter(): void {
    sfx('ui_open');
    sfx('power_up', { vol: 0.5, pitch: 0.8 });
  }

  private cardRect(i: number): { x: number; y: number; w: number; h: number } {
    const n = this.choices.length;
    const total = n * CARD_W + (n - 1) * GAP;
    const x = UI_W / 2 - total / 2 + i * (CARD_W + GAP);
    return { x, y: UI_H / 2 - CARD_H / 2 + 14, w: CARD_W, h: CARD_H };
  }

  private choose(i: number): void {
    if (this.pendingReroll || this.chosen >= 0 || i < 0 || i >= this.choices.length) return;
    this.chosen = i;
    this.chosenT = 0;
    this.sel = i;
    sfx('ui_select');
  }

  private reroll(): void {
    const w = this.game.world;
    if (this.chosen >= 0 || this.pendingReroll || !w.asPlayer(w.local, () => canRerollBlessing(w))) return;
    if (this.game.online) {
      this.pendingReroll = true;
      this.game.command({ type: 'bless_reroll', floor: this.floor, serial: this.serial });
    } else if (w.asPlayer(w.local, () => rerollBlessings(w, this.floor, this.serial))) this.game.persistBlessingDecision();
    sfx('ui_select');
  }

  update(dt: number): void {
    if (this.game.online && this.game.world.run.floor !== this.floor) {
      this.game.closeOverlay(this);
      return;
    }
    this.t += dt;
    const w = this.game.world, serial = w.local.vars.__blessOfferSerial ?? 0;
    if (serial !== this.serial) {
      this.serial = serial;
      this.choices = w.asPlayer(w.local, () => blessingChoices(w));
      this.pendingReroll = false;
      this.sel = 0;
      this.t = 0;
    }
    if (this.chosen >= 0) {
      this.chosenT += dt;
      if (this.chosenT > 0.42) {
        this.game.closeOverlay(this);
        // single-player: applied now; co-op: a lockstep command
        this.game.chooseBlessing(this.choices[this.chosen], this.floor);
      }
      return;
    }
    if (this.t < 0.35) return; // ignore inputs held from gameplay
    if (input.pressed('tabNext')) { this.reroll(); return; }
    const n = this.choices.length;
    if (this.rl.update(input.held('uiLeft'), dt)) {
      this.sel = (this.sel + n - 1) % n;
      sfx('ui_move');
    }
    if (this.rr.update(input.held('uiRight'), dt)) {
      this.sel = (this.sel + 1) % n;
      sfx('ui_move');
    }
    const m = app.renderer.displayToUI(input.mouseX, input.mouseY);
    this.hover = -1;
    for (let i = 0; i < n; i++) {
      const c = this.cardRect(i);
      if (m.x >= c.x && m.x <= c.x + c.w && m.y >= c.y && m.y <= c.y + c.h) this.hover = i;
    }
    if (this.hover >= 0 && input.mouseMoved && this.sel !== this.hover) {
      this.sel = this.hover;
      sfx('ui_move', { vol: 0.5 });
    }
    const rerollY = this.cardRect(0).y + CARD_H + 12;
    if (input.pressed('fire') && m.x >= UI_W / 2 - 122 && m.x <= UI_W / 2 + 122 && m.y >= rerollY && m.y <= rerollY + 27) this.reroll();
    else if (this.hover >= 0 && input.pressed('fire')) this.choose(this.hover);
    else if (input.pressed('confirm')) this.choose(this.sel);
  }

  draw(r: Renderer): void {
    r.beginUI();
    const k = appear(this.t, 0.3);
    const out = this.chosen >= 0 ? clamp(this.chosenT / 0.42, 0, 1) : 0;
    const A = k * (1 - out * 0.9);
    r.uiRect(0, 0, UI_W, UI_H, C.void, 0.72 * A);
    glow(r, UI_W / 2, UI_H / 2 - 40, 260, '#ffb040', 0.12 * A);
    const ty = 34 + (1 - k) * 10;
    r.uiText('등불의 축복', UI_W / 2, ty, { size: 24, bold: true, align: 'center', color: C.goldHi, outline: C.ink, alpha: A });
    divider(r, UI_W / 2, ty + 36, 220, C.goldDark, A);
    r.uiText('이번 층을 함께할 축복을 하나 고르세요. 축복은 이번 하강이 끝날 때까지 이어집니다.', UI_W / 2, ty + 44, { size: 10, font: 'small', align: 'center', color: C.textDim, alpha: A });
    this.choices.forEach((id, i) => this.drawCard(r, id, i, A));
    const pad = input.aimMode === 'pad';
    const c0 = this.cardRect(0);
    const w = this.game.world;
    const rerollY = c0.y + c0.h + 12;
    const canReroll = w.asPlayer(w.local, () => canRerollBlessing(w));
    frame(r, UI_W / 2 - 122, rerollY, 244, 27, canReroll ? 'buttonHi' : 'button', { alpha: A * (canReroll ? 1 : .55) });
    const key = touchUiActive() ? '' : `${actionLabel(input.bindings, 'tabNext', pad)} · `;
    r.uiText(this.pendingReroll ? '새 선택지를 기다리는 중…' : canReroll ? `${key}다시 고르기 · 원정당 1회` : '이번 원정의 다시 고르기 사용 완료', UI_W / 2, rerollY + 8, { size: 10, font: 'small', align: 'center', color: C.goldHi, alpha: A });
    const hy = rerollY + 46;
    if (!touchUiActive()) {
      keyHintRow(r, [[actionLabel(input.bindings, 'uiLeft', pad) + ' ' + actionLabel(input.bindings, 'uiRight', pad), '고르기'], [actionLabel(input.bindings, 'confirm', pad), '받기']], UI_W / 2, hy, { alpha: A * 0.9, pad });
    } else r.uiText('카드를 눌러 축복을 받으세요', UI_W / 2, hy - 6, { size: 10, font: 'small', align: 'center', color: C.textDim, alpha: A });
  }

  private drawCard(r: Renderer, id: string, i: number, A: number): void {
    const def = Artifacts.get(id);
    if (!def) return;
    const c = this.cardRect(i);
    const enter = ease.outBack(clamp((this.t - 0.08 * i) / 0.45, 0, 1));
    const sel = i === this.sel;
    const picked = i === this.chosen;
    const lift = sel ? -6 - Math.sin(this.t * 3) * 1.5 : 0;
    const y = c.y + (1 - enter) * 40 + lift - (picked ? this.chosenT * 30 : 0);
    const a = A * clamp(enter * 1.4, 0, 1) * (this.chosen >= 0 && !picked ? 0.35 : 1);
    if (a <= 0.01) return;
    const cx = c.x + c.w / 2;
    if (sel) glow(r, cx, y + 60, 110, '#ffd060', (0.22 + 0.08 * Math.sin(this.t * 4)) * a);
    frame(r, c.x, y, c.w, c.h, sel ? 'ornate' : 'panel', { alpha: a });
    r.uiText(blessingRole(id), cx, y + 13, { size: 10, font: 'small', align: 'center', color: C.gold, alpha: a });
    // icon medallion
    glow(r, cx, y + 52, 40, '#ffe080', 0.3 * a);
    spriteCentered(r, def.icon, cx, y + 52, 3, { alpha: a, flash: picked ? Math.max(0, 0.8 - this.chosenT * 2) : 0 });
    r.uiText(def.name, cx, y + 92, { size: 14, bold: true, align: 'center', color: sel ? C.goldHi : C.text, outline: C.ink, alpha: a });
    divider(r, cx, y + 114, 100, C.goldDark, a * 0.8);
    const lines = r.wrapText(def.desc, c.w - 24, 11);
    lines.slice(0, 6).forEach((l, j) => r.uiText(l, cx, y + 124 + j * 13, { size: 11, align: 'center', color: '#e8e0d0', alpha: a }));
    const p = this.game.world.local;
    const compatible = blessingCompatibility(id, [p.weaponId, p.weapon2Id].filter((v): v is string => !!v));
    r.uiText(compatible, cx, y + c.h - 18, { size: 9, font: 'small', align: 'center', color: '#c5b68e', alpha: a });
    if (picked) {
      const f = 1 - clamp(this.chosenT / 0.3, 0, 1);
      r.uiRect(c.x + 3, y + 3, c.w - 6, c.h - 6, '#fff4c0', 0.35 * f * a);
    }
  }
}
