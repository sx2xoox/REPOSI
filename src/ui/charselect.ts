// Character select: a carousel of keepers on lit pedestals over the stairwell.
// Every keeper shows why to pick it: a one-line pitch and the story (left),
// stat bars and consumables (right), playstyle tags + difficulty under the name,
// and the kit strip (signature passive, dash, lantern release) at the bottom;
// the starting weapon and the favoured weapon class sit under the story.
// Locked keepers show a silhouette with the unlock hint. Mouse, keys, pad and
// touch (phone layouts shift the strip up and the buttons down).

import type { Scene, TouchButtonSpec } from './scene';
import { touchUiActive } from './touch-mode';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W, UI_W_BASE, uiCenterX } from '../engine/renderer';
import { app } from '../game/app';
import { input } from '../engine/input';
import { sfx } from '../audio/audio';
import { Weapons, type CharacterDef } from '../game/defs';
import { save } from '../engine/save';
import { randomSeedString } from '../engine/rng';
import { animFrame, hasAnim, hasSprite } from '../engine/sprites';
import { clamp, ease } from '../engine/math';
import { backdrop } from './backdrop';
import { Repeater, Spring, appear } from './anim';
import { C, PX } from './theme';
import { divider, drawRuns, fitScale, frame, gauge, glow, iconSlot, keyHintRow, spriteCentered } from './frame';
import { characterKitRows, characterOrder, characterStatRows, characterStats, isUnlocked, DIFFICULTY_LABELS, weaponClassRuns } from './logic';
import { AbandonExpeditionOverlay } from './abandon-expedition';
import { FireGaugeFx, drawFireGauge, fireGaugeLayout } from './hud-fire';

const KIT_LABEL_COLORS = { passive: C.goldHi, dash: C.info, release: C.emberHi } as const;

export class CharacterSelectScene implements Scene {
  private idx = 0;
  private t = 0;
  /** never fed: the stats panel shows a steady gauge */
  private readonly lifeFx = new FireGaugeFx();
  private sel = new Spring(0, 180, 22);
  private selT = 0;
  private starting = -1;
  private seed: string | undefined;
  private chars: CharacterDef[];
  private rl = new Repeater(0.35, 0.16);
  private rr = new Repeater(0.35, 0.16);
  private shake = 0;
  touchBack = 'back' as const;
  touchBackAt = 'left' as const;

  constructor(seed?: string, private onChoose?: (id: string) => void) {
    this.seed = seed;
    this.chars = characterOrder(save.progress.flags);
    const last = save.history[0]?.character;
    const i = this.chars.findIndex((c) => c.id === last && this.open(c));
    this.idx = Math.max(0, i);
    this.sel.set(this.idx);
  }

  enter(): void {
    backdrop().setDim(0.55);
    backdrop().showKeeper = false;
  }

  exit(): void {
    backdrop().showKeeper = true;
  }

  private open(c: CharacterDef): boolean {
    return isUnlocked(c, save.progress.flags);
  }

  private choose(i: number): void {
    const n = this.chars.length;
    const ni = ((i % n) + n) % n;
    if (ni !== this.idx) {
      this.idx = ni;
      this.selT = 0;
      sfx('ui_move');
    }
  }

  /** Unlocked later in the save and never looked at yet? */
  private isNew(c: CharacterDef): boolean {
    return !c.unlocked && this.open(c) && !save.hasFlag(`seenchar:${c.id}`);
  }

  private start(): void {
    const c = this.chars[this.idx];
    if (!c) return;
    if (!this.open(c)) {
      sfx('ui_error');
      this.shake = 0.35;
      return;
    }
    if (this.hasExpedition()) { this.abandon(); return; }
    sfx('ui_select');
    sfx('floor_start', { vol: 0.5 });
    this.starting = 0;
  }

  private hasExpedition(): boolean { return !this.seed && save.activeSlot >= 0 && !!save.progress.campaign?.checkpoint; }
  private abandon(): void {
    if (this.hasExpedition()) app.scenes.push(new AbandonExpeditionOverlay(() => save.abandonExpedition(), 'select'));
  }

  /** Layout that depends on the touch chrome (the strip moves up, the buttons down). */
  private layout(): { baseY: number; panelH: number; stripY: number; stripH: number } {
    const touch = touchUiActive();
    const stripY = touch ? 280 : 292;
    return { baseY: touch ? 214 : 226, panelH: stripY - 66 - 6, stripY, stripH: 88 };
  }

  update(dt: number): void {
    this.t += dt;
    this.selT += dt;
    this.shake = Math.max(0, this.shake - dt);
    backdrop().update(dt);
    this.sel.target = this.idx;
    this.sel.update(dt);
    if (this.starting >= 0) {
      this.starting += dt;
      if (this.starting > 0.85) {
        const c = this.chars[this.idx];
        const seeded = !!this.seed;
        if (this.onChoose) this.onChoose(c.id);
        else app.startRun(this.seed ?? randomSeedString(), c.id, seeded);
      }
      return;
    }
    const curC = this.chars[this.idx];
    if (curC && this.isNew(curC) && this.selT > 1.2) save.setFlag(`seenchar:${curC.id}`);
    if (this.rr.update(input.held('uiRight'), dt)) this.choose(this.idx + 1);
    if (this.rl.update(input.held('uiLeft'), dt)) this.choose(this.idx - 1);
    if (input.pressed('cancel')) {
      sfx('ui_back');
      if (this.onChoose) app.goTown(); else app.goTitle();
      return;
    }
    if (input.pressed('confirm')) { this.start(); return; }
    // mouse: click a side character to select it, click the center one to start
    const m = app.renderer.displayToUI(input.mouseX, input.mouseY);
    m.x -= uiCenterX();
    if (input.pressed('fire')) {
      if (this.hasExpedition() && m.x >= 566 && m.x <= 756 && m.y >= 8 && m.y <= 52) { this.abandon(); return; }
      const { baseY } = this.layout();
      for (let i = 0; i < this.chars.length; i++) {
        const { x, s } = this.slotPos(i);
        if (Math.abs(m.x - x) < 10 * s && m.y > baseY - 120 && m.y < baseY + 14) {
          if (i === this.idx) this.start();
          else this.choose(i);
          break;
        }
      }
    }
  }

  touchButtons(): TouchButtonSpec[] {
    if (this.starting >= 0) return [];
    const sa = app.renderer.uiSafe;
    const y = UI_H - 42 - Math.min(sa.b, 24);
    const ox = uiCenterX();
    return [
      ...(this.hasExpedition() ? [{ x: ox + 566, y: 8, w: 190, h: 44, label: '기존 원정 포기', ghost: true, tap: () => this.abandon() }] : []),
      { x: ox + 196, y, w: 64, h: 40, icon: 'tc_arrow_l', tap: 'uiLeft' },
      { x: ox + 274, y, w: 220, h: 40, label: this.onChoose ? '이 등불지기로 준비' : '하강 시작', tap: 'confirm', primary: true },
      { x: ox + 508, y, w: 64, h: 40, icon: 'tc_arrow_r', tap: 'uiRight' },
    ];
  }

  /** Carousel slot position for character i given the animated selection. */
  private slotPos(i: number): { x: number; s: number; a: number; d: number } {
    const n = this.chars.length;
    let d = i - this.sel.value;
    // wrap to the nearest side
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    const ad = Math.abs(d);
    const x = UI_W_BASE / 2 + Math.sign(d) * (ad <= 1 ? ad * 104 : 104 + (ad - 1) * 64);
    const s = 6 - Math.min(1, ad) * 3 - Math.max(0, ad - 1) * 0.8;
    const a = clamp(1.2 - ad * 0.45, 0, 1);
    return { x, s: Math.max(2, s), a, d };
  }

  draw(r: Renderer): void {
    r.beginWorld('#05030a');
    backdrop().draw(r);
    r.presentWorld();
    r.beginUI();
    r.dctx.translate(uiCenterX(), 0); // 768-wide layout centered on wide screens
    const intro = appear(this.t, 0.5);
    const out = this.starting >= 0 ? clamp(this.starting / 0.8, 0, 1) : 0;
    const A = intro * (1 - out * 0.85);
    const cur = this.chars[this.idx];
    if (!cur) return;
    const open = this.open(cur);
    const L = this.layout();

    // header
    r.uiText('등불지기 선택', UI_W_BASE / 2, 16, { size: 24, bold: true, align: 'center', color: C.text, outline: C.ink, alpha: A });
    divider(r, UI_W_BASE / 2, 48, 260, C.goldDark, A);
    if (this.hasExpedition()) {
      frame(r, 566, 8, 190, 44, 'slot', { alpha: A });
      const cp = save.progress.campaign!.checkpoint!;
      r.uiText(`${cp.floor}-${cp.stage} 보관 중 · 기존 원정 포기`, 661, 24, { size: 10, align: 'center', color: C.gold, alpha: A });
    }
    else if (this.seed) r.uiText(`시드  ${this.seed}`, UI_W_BASE - 16, 20, { size: 10, font: 'small', align: 'right', color: C.gold, alpha: A });
    else r.uiText('무작위 시드', UI_W_BASE - 16, 20, { size: 10, font: 'small', align: 'right', color: C.textFaint, alpha: A });

    // carousel (back to front)
    const order = this.chars.map((c, i) => ({ c, i, p: this.slotPos(i) })).sort((a, b) => Math.abs(b.p.d) - Math.abs(a.p.d));
    const baseY = L.baseY;
    for (const { c, i, p } of order) {
      if (p.a <= 0) continue;
      const isSel = i === this.idx;
      const unlocked = this.open(c);
      const shakeX = isSel && this.shake > 0 ? Math.sin(this.shake * 60) * 4 * (this.shake / 0.35) : 0;
      const x = p.x + shakeX;
      const focus = clamp(1 - Math.abs(p.d), 0, 1);
      // pedestal
      const pw = 18 * p.s;
      r.dctx.globalAlpha = A * p.a;
      const d = r.dctx;
      d.fillStyle = '#0c0810';
      d.beginPath();
      d.ellipse(x, baseY + 2, pw / 2 + 4, pw / 6 + 3, 0, 0, Math.PI * 2);
      d.fill();
      d.fillStyle = unlocked ? '#2a2236' : '#18121e';
      d.beginPath();
      d.ellipse(x, baseY, pw / 2, pw / 6, 0, 0, Math.PI * 2);
      d.fill();
      d.fillStyle = unlocked ? '#3e3450' : '#221a2a';
      d.beginPath();
      d.ellipse(x, baseY - 2, pw / 2 - 3, pw / 6 - 2, 0, 0, Math.PI * 2);
      d.fill();
      d.globalAlpha = 1;
      if (unlocked && focus > 0.05) {
        const fl = 0.85 + 0.15 * Math.sin(this.t * 7.3);
        glow(r, x, baseY - 40, 90, c.color, 0.22 * focus * A * fl);
        glow(r, x, baseY, 50, c.color, 0.18 * focus * A);
      }
      // sprite
      const pre = c.spritePrefix;
      let anim = `${pre}_idle_down`;
      if (isSel && this.starting >= 0) anim = `${pre}_walk_up`;
      else if (isSel && this.selT < 0.9 && hasAnim(`${pre}_walk_down`)) anim = `${pre}_walk_down`;
      const name = hasAnim(anim) ? animFrame(anim, this.t) : c.portrait;
      const lift = isSel && this.starting >= 0 ? -ease.inCubic(out) * 26 : 0;
      const hop = isSel ? Math.max(0, Math.sin(clamp(this.selT / 0.3, 0, 1) * Math.PI)) * 8 : 0;
      if (!unlocked) {
        // faint rim so the locked silhouette reads against the dark
        for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          r.uiSprite(name, x + ox * p.s * 0.75, baseY - 2 + oy * p.s * 0.75, p.s, { alpha: A * p.a * 0.8, tint: '#4a3e5c', tintAmount: 1 });
        }
      }
      r.uiSprite(name, x, baseY - 2 + lift - hop, p.s, {
        alpha: A * p.a * (isSel && this.starting >= 0 ? 1 - out : 1),
        tint: unlocked ? (isSel ? undefined : '#05030a') : '#05030a',
        tintAmount: unlocked ? (isSel ? 0 : 0.35 * (1 - focus)) : 1,
        flash: isSel && this.starting >= 0 ? Math.max(0, 1 - this.starting * 4) : 0,
      });
      if (!unlocked) {
        r.uiSprite('ui_lock', x, baseY - 10 * p.s - 6, Math.max(2, p.s * 0.5), { alpha: A * p.a });
      } else if (this.isNew(c)) {
        const bob2 = Math.sin(this.t * 5) * 2;
        const ny = baseY - 21 * p.s - 10 + bob2;
        frame(r, x - 26, ny - 9, 52, 18, 'ribbon', { color: C.goldHi, alpha: A * p.a });
        r.uiText('새로운!', x, ny - 6, { size: 10, font: 'small', align: 'center', color: C.goldHi, alpha: A * p.a });
      }
      if (!isSel && focus < 0.5) {
        r.uiText(unlocked ? c.name : '???', x, baseY + 10, { size: 10, font: 'small', align: 'center', color: unlocked ? C.textDim : C.textMute, alpha: A * p.a });
      }
    }
    // arrows
    const bob = Math.sin(this.t * 4) * 3;
    r.uiSprite('ui_arrow_l', UI_W_BASE / 2 - 66 - bob, baseY - 66, 3, { alpha: A * 0.9 });
    r.uiSprite('ui_arrow_r', UI_W_BASE / 2 + 66 + bob, baseY - 66, 3, { alpha: A * 0.9 });
    // name plate under the selected keeper
    const k = appear(this.selT, 0.3);
    r.uiText(open ? cur.name : '???', UI_W_BASE / 2, baseY + 8 + (1 - k) * 6, { size: 24, bold: true, align: 'center', color: open ? cur.color : C.textFaint, outline: C.ink, alpha: A * k });
    r.uiText(open ? cur.title : '잠긴 등불지기', UI_W_BASE / 2, baseY + 36, { size: 12, align: 'center', color: C.textDim, alpha: A * k });
    this.drawTags(r, cur, open, A, k, baseY + 54);

    this.drawInfo(r, cur, open, A, k, L.panelH);
    this.drawStats(r, cur, open, A, k, L.panelH);
    this.drawKit(r, cur, open, A, k, L.stripY, L.stripH);

    if (!touchUiActive()) keyHintRow(r, [['←→', '선택'], ['Enter', this.onChoose ? '준비 완료' : '하강 시작'], ['Esc', '뒤로']], UI_W_BASE / 2, UI_H - 12, { alpha: A * 0.85, pad: input.aimMode === 'pad' });
    if (out > 0) r.uiRect(0, 0, UI_W, UI_H, '#000000', ease.inQuad(out) * 0.9);
  }

  /** Playstyle pills + difficulty lanterns, centered under the title. */
  private drawTags(r: Renderer, c: CharacterDef, open: boolean, A: number, k: number, y: number): void {
    const tags = open ? c.playstyle ?? [] : [];
    const diff = open ? c.difficulty ?? 2 : 0;
    const diffLabel = diff ? `난이도 ${DIFFICULTY_LABELS[diff] ?? ''}` : '난이도 ?';
    const pillW = tags.map((t) => r.measureText(t, 10, false, 'small') + 14);
    const diffW = r.measureText(diffLabel, 10, false, 'small') + 6 + 3 * 7 + 2;
    const total = pillW.reduce((s, w) => s + w + 4, 0) + 10 + diffW;
    let x = UI_W_BASE / 2 - total / 2;
    const a = A * k;
    tags.forEach((t, i) => {
      frame(r, x, y - 8, pillW[i], 18, 'tooltip', { color: c.color, alpha: a * 0.9 });
      r.uiText(t, x + pillW[i] / 2, y - 5, { size: 10, font: 'small', align: 'center', color: C.text, alpha: a });
      x += pillW[i] + 4;
    });
    x += 10;
    r.uiText(diffLabel, x, y - 5, { size: 10, font: 'small', color: C.textDim, alpha: a });
    x += r.measureText(diffLabel, 10, false, 'small') + 8;
    for (let i = 0; i < 3; i++) {
      const on = i < diff;
      r.uiSprite('ui_flame', x + 4 + i * 11, y + 1, 1, { alpha: a * (on ? 1 : 0.3), tint: on ? undefined : '#2a2236', tintAmount: on ? 0 : 0.7 });
    }
  }

  private drawInfo(r: Renderer, c: CharacterDef, open: boolean, A: number, k: number, h: number): void {
    const x = 18;
    const y = 66;
    const w = 214;
    frame(r, x - (1 - k) * 10, y, w, h, 'panel', { alpha: A * 0.95 });
    const tx = x + 14 - (1 - k) * 10;
    const tw = w - 28;
    r.uiText('이야기', tx, y + 12, { size: 10, font: 'small', color: C.gold, alpha: A });
    let cy = y + 28;
    if (!open) {
      const lines = r.wrapText(c.unlockHint ?? '아직 잠겨 있습니다.', tw, 12);
      lines.slice(0, 5).forEach((l, i) => r.uiText(l, tx, cy + i * 16, { size: 12, color: C.textFaint, alpha: A * k }));
      cy += Math.min(5, lines.length) * 16 + 10;
      divider(r, x + w / 2, cy, w - 40, C.goldDark, A * 0.8);
      cy += 14;
      r.uiSprite('ui_lock', tx + 10, cy + 12, 2, { alpha: A });
      r.uiText(c.suspended ? '임시 잠금' : '해금 조건', tx + 26, cy, { size: 12, color: C.textDim, alpha: A });
      const requirement = c.suspended ? '점검 중 · 해금 기록 유지' : c.unlockRequirement ?? (c.unlockHint ? '위 조건을 달성하세요' : '???');
      r.wrapText(requirement, tw - 26, 10).forEach((line, i) =>
        r.uiText(line, tx + 26, cy + 16 + i * 14, { size: 10, font: 'small', color: C.textFaint, alpha: A }));
      return;
    }
    // the favoured class text is shown whole (it explains the green family labels); the
    // block under the story: divider + weapon row + class label + these lines
    const aff = c.affinity;
    const affLines = r.wrapText(aff ? aff.desc : '어떤 무기든 고르게 다룬다.', tw, 10, false, 'small').slice(0, 4);
    const bottom = 68 + affLines.length * 12;
    const storyRoom = (top: number) => Math.floor((h - (top - y) - bottom) / 16);
    // the pitch: why pick this keeper (gold): 3 lines while two story lines still fit, else 2 (an ellipsis when cut)
    if (c.pitch) {
      const all = r.wrapText(c.pitch, tw, 12, true);
      const n = all.length > 2 && storyRoom(cy + 3 * 16 + 4) >= 2 ? 3 : 2;
      const pl = all.slice(0, n);
      if (all.length > n) pl[n - 1] = `${pl[n - 1].replace(/[,.\s]+$/, '')}…`;
      pl.forEach((l, i) => r.uiText(l, tx, cy + i * 16, { size: 12, bold: true, color: C.goldHi, alpha: A * k }));
      cy += pl.length * 16 + 4;
    }
    // the story: as many lines as fit above the weapon block (an ellipsis when cut)
    const story = r.wrapText(c.desc, tw, 12);
    const maxStory = Math.max(2, storyRoom(cy));
    const shown = story.slice(0, maxStory);
    if (story.length > maxStory) shown[shown.length - 1] = `${shown[shown.length - 1].replace(/[,.\s]+$/, '')}…`;
    shown.forEach((l, i) => r.uiText(l, tx, cy + i * 16, { size: 12, color: C.text, alpha: A * k }));
    cy += shown.length * 16 + 4;
    divider(r, x + w / 2, cy, w - 40, C.goldDark, A * 0.8);
    cy += 8;
    // starting weapon
    const wdef = Weapons.get(c.weapon);
    if (wdef) {
      iconSlot(r, wdef.icon, tx + 15, cy + 15, 30, { alpha: A, scale: fitScale(wdef.icon, 22, 1.5) });
      r.uiText(wdef.name, tx + 38, cy + 2, { size: 12, color: C.text, alpha: A });
      r.uiText('시작 무기', tx + tw, cy + 4, { size: 10, font: 'small', align: 'right', color: C.textFaint, alpha: A });
      // 계열 · 속성 on its own line (the family green: every starter is in its keeper's class)
      drawRuns(r, weaponClassRuns(wdef, c, C.textDim, C.good), tx + 38, cy + 18, { size: 10, font: 'small', alpha: A });
    }
    cy += 36;
    // favoured weapon class (its families in green, as on every weapon's info line)
    r.uiText('선호 무기', tx, cy, { size: 10, font: 'small', color: C.gold, alpha: A });
    r.uiText(aff ? aff.name : '없음', tx + 50, cy, { size: 10, font: 'small', color: aff ? C.good : C.textDim, alpha: A });
    cy += 13;
    affLines.forEach((l, i) => r.uiText(l, tx, cy + i * 12, { size: 10, font: 'small', color: C.textDim, alpha: A * k }));
  }

  private drawStats(r: Renderer, c: CharacterDef, open: boolean, A: number, k: number, h: number): void {
    const w = 214;
    const x = UI_W_BASE - 18 - w;
    const y = 66;
    frame(r, x + (1 - k) * 10, y, w, h, 'panel', { alpha: A * 0.95 });
    const tx = x + 14 + (1 - k) * 10;
    r.uiText('능력치', tx, y + 12, { size: 10, font: 'small', color: C.gold, alpha: A });
    // life: the lamp's own fire (same flame as the health pickups)
    const hy = y + 34;
    r.uiText('체력', tx + 22, hy - 6, { size: 12, color: C.textDim, alpha: A });
    r.uiSprite('hud_flame', tx + 6, hy, 2, { alpha: A });
    // the same life gauge as in a run (locked keepers: three dark cells)
    const red = open ? c.hearts * 2 : 0;
    const life = { red, maxRed: open ? red : 6, soul: open ? (c.soulHearts ?? 0) * 2 : 0, shields: 0, t: this.t, low: false };
    drawFireGauge(r, tx + 56, hy - (fireGaugeLayout(life).h * PX) / 2, life, this.lifeFx, A);
    const st = characterStats(c);
    const rows = characterStatRows(st);
    const rowH = Math.min(24, Math.floor((h - 34 - 30 - 22) / rows.length));
    rows.forEach((row, i) => {
      const ry = hy + 24 + i * rowH;
      r.uiSprite(row.icon, tx + 6, ry, 2, { alpha: A });
      r.uiText(row.label, tx + 22, ry - 6, { size: 12, color: C.textDim, alpha: A });
      const fill = open ? row.frac * appear(this.selT, 0.45, i * 0.04) : 0;
      gauge(r, tx + 92, ry - 5, 64, 10, fill, { fill: open ? c.color : '#3a3046', alpha: A, segments: 5 });
      r.uiText(open ? row.text : '?', tx + w - 28, ry - 6, { size: 10, font: 'small', align: 'right', color: C.text, alpha: A });
    });
    // consumables
    const cy = hy + 24 + rows.length * rowH + 2;
    const cons: [string, number][] = [['hud_coin', open ? c.coins ?? 0 : 0], ['hud_match', open ? c.matches ?? 1 : 0]];
    cons.forEach(([icon, n], i) => {
      const cx = tx + 10 + i * 56;
      r.uiSprite(icon, cx, cy + 6, 2, { alpha: A });
      r.uiText(open ? `×${n}` : '?', cx + 12, cy, { size: 12, color: C.text, alpha: A });
    });
  }

  /** The kit strip: three rows — signature passive, dash, lantern release. */
  private drawKit(r: Renderer, c: CharacterDef, open: boolean, A: number, k: number, y: number, h: number): void {
    const w = 500;
    const x = UI_W_BASE / 2 - w / 2;
    const oy = (1 - k) * 8;
    frame(r, x, y + oy, w, h, 'tooltip', { alpha: A * 0.95, color: open ? c.color : C.rim });
    const rows = characterKitRows(c, open, touchUiActive(), true);
    const rowH = (h - 8) / rows.length;
    rows.forEach((row, i) => {
      const ry = y + oy + 5 + i * rowH;
      const col = KIT_LABEL_COLORS[row.kind];
      // icon
      const icon = open && hasSprite(row.icon) ? row.icon : 'ui_question';
      if (row.kind === 'release' && open) {
        const fl = 0.8 + 0.2 * Math.sin(this.t * 8);
        glow(r, x + 22, ry + rowH / 2, 22, '#ff8a30', 0.22 * A * fl);
      }
      spriteCentered(r, icon, x + 22, ry + rowH / 2, fitScale(icon, 20, 1.5), { alpha: A });
      // label · name
      r.uiText(row.label, x + 42, ry + 1, { size: 10, font: 'small', color: open ? col : C.textFaint, alpha: A });
      r.uiText(open ? row.name : '???', x + 42, ry + 12, { size: 12, bold: true, color: open ? C.text : C.textMute, alpha: A * k });
      // description (up to 2 small lines), the key hint to its right
      const dx = x + 176;
      const hintW = row.hint ? r.measureText(row.hint, 10, false, 'small') + 10 : 0;
      const lines = open ? r.wrapText(row.desc, x + w - 12 - hintW - dx, 10, false, 'small').slice(0, 2) : ['???'];
      lines.forEach((l, j) => r.uiText(l, dx, ry + 3 + j * 12, { size: 10, font: 'small', color: open ? C.text : C.textMute, alpha: A * k }));
      if (row.hint) r.uiText(row.hint, x + w - 12, ry + 3, { size: 10, font: 'small', align: 'right', color: C.textFaint, alpha: A * 0.9 });
      if (i > 0) r.uiRect(x + 10, Math.round(ry - 2), w - 20, 1, C.rimDark, A * 0.8);
    });
  }
}
