// Character select: a carousel of keepers on lit pedestals over the stairwell,
// with name / story, stat bars, starting kit icons, the lantern-release
// description, and locked silhouettes with unlock hints. Mouse, keys and pad.

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import { app } from '../game/app';
import { input } from '../engine/input';
import { sfx } from '../audio/audio';
import { Actives, Artifacts, Weapons, type CharacterDef } from '../game/defs';
import { save } from '../engine/save';
import { randomSeedString } from '../engine/rng';
import { animFrame, hasAnim } from '../engine/sprites';
import { clamp, ease } from '../engine/math';
import { backdrop } from './backdrop';
import { Repeater, Spring, appear } from './anim';
import { C } from './theme';
import { divider, frame, gauge, glow, iconSlot, keyHintRow } from './frame';
import { characterOrder, characterStatRows, characterStats, isUnlocked } from './logic';

const WEAPON_KIND: Record<string, string> = { ranged: '원거리', melee: '근접', charge: '차지', beam: '광선' };

export class CharacterSelectScene implements Scene {
  private idx = 0;
  private t = 0;
  private sel = new Spring(0, 180, 22);
  private selT = 0;
  private starting = -1;
  private seed: string | undefined;
  private chars: CharacterDef[];
  private rl = new Repeater(0.35, 0.16);
  private rr = new Repeater(0.35, 0.16);
  private shake = 0;

  constructor(seed?: string) {
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

  private start(): void {
    const c = this.chars[this.idx];
    if (!c) return;
    if (!this.open(c)) {
      sfx('ui_error');
      this.shake = 0.35;
      return;
    }
    sfx('ui_select');
    sfx('floor_start', { vol: 0.5 });
    this.starting = 0;
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
        app.startRun(this.seed ?? randomSeedString(), c.id, seeded);
      }
      return;
    }
    if (this.rr.update(input.held('uiRight'), dt)) this.choose(this.idx + 1);
    if (this.rl.update(input.held('uiLeft'), dt)) this.choose(this.idx - 1);
    if (input.pressed('cancel')) {
      sfx('ui_back');
      app.goTitle();
      return;
    }
    if (input.pressed('confirm')) this.start();
    // mouse: click a side character to select it, click the center one to start
    const m = app.renderer.displayToUI(input.mouseX, input.mouseY);
    if (input.pressed('fire')) {
      for (let i = 0; i < this.chars.length; i++) {
        const { x, s } = this.slotPos(i);
        if (Math.abs(m.x - x) < 10 * s && m.y > 120 && m.y < 250) {
          if (i === this.idx) this.start();
          else this.choose(i);
          break;
        }
      }
    }
  }

  /** Carousel slot position for character i given the animated selection. */
  private slotPos(i: number): { x: number; s: number; a: number; d: number } {
    const n = this.chars.length;
    let d = i - this.sel.value;
    // wrap to the nearest side
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    const ad = Math.abs(d);
    const x = UI_W / 2 + Math.sign(d) * (ad <= 1 ? ad * 104 : 104 + (ad - 1) * 64);
    const s = 6 - Math.min(1, ad) * 3 - Math.max(0, ad - 1) * 0.8;
    const a = clamp(1.2 - ad * 0.45, 0, 1);
    return { x, s: Math.max(2, s), a, d };
  }

  draw(r: Renderer): void {
    r.beginWorld('#05030a');
    backdrop().draw(r);
    r.presentWorld();
    r.beginUI();
    const intro = appear(this.t, 0.5);
    const out = this.starting >= 0 ? clamp(this.starting / 0.8, 0, 1) : 0;
    const A = intro * (1 - out * 0.85);
    const cur = this.chars[this.idx];
    if (!cur) return;
    const open = this.open(cur);

    // header
    r.uiText('등불지기 선택', UI_W / 2, 16, { size: 24, bold: true, align: 'center', color: C.text, outline: C.ink, alpha: A });
    divider(r, UI_W / 2, 48, 260, C.goldDark, A);
    if (this.seed) r.uiText(`시드  ${this.seed}`, UI_W - 16, 20, { size: 10, font: 'small', align: 'right', color: C.gold, alpha: A });
    else r.uiText('무작위 시드', UI_W - 16, 20, { size: 10, font: 'small', align: 'right', color: C.textFaint, alpha: A });

    // carousel (back to front)
    const order = this.chars.map((c, i) => ({ c, i, p: this.slotPos(i) })).sort((a, b) => Math.abs(b.p.d) - Math.abs(a.p.d));
    const baseY = 236;
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
      }
      if (!isSel && focus < 0.5) {
        r.uiText(unlocked ? c.name : '???', x, baseY + 12, { size: 10, font: 'small', align: 'center', color: unlocked ? C.textDim : C.textMute, alpha: A * p.a });
      }
    }
    // arrows
    const bob = Math.sin(this.t * 4) * 3;
    r.uiSprite('ui_arrow_l', UI_W / 2 - 66 - bob, 170, 3, { alpha: A * 0.9 });
    r.uiSprite('ui_arrow_r', UI_W / 2 + 66 + bob, 170, 3, { alpha: A * 0.9 });
    // name plate under the selected keeper
    const k = appear(this.selT, 0.3);
    r.uiText(open ? cur.name : '???', UI_W / 2, baseY + 12 + (1 - k) * 6, { size: 24, bold: true, align: 'center', color: open ? cur.color : C.textFaint, outline: C.ink, alpha: A * k });
    r.uiText(open ? cur.title : '잠긴 등불지기', UI_W / 2, baseY + 42, { size: 12, align: 'center', color: C.textDim, alpha: A * k });

    this.drawInfo(r, cur, open, A, k);
    this.drawStats(r, cur, open, A, k);
    this.drawRelease(r, cur, open, A, k);

    keyHintRow(r, [['←→', '선택'], ['Enter', '하강 시작'], ['Esc', '뒤로']], UI_W / 2, UI_H - 12, { alpha: A * 0.85, pad: input.aimMode === 'pad' });
    if (out > 0) r.uiRect(0, 0, UI_W, UI_H, '#000000', ease.inQuad(out) * 0.9);
  }

  private drawInfo(r: Renderer, c: CharacterDef, open: boolean, A: number, k: number): void {
    const x = 18;
    const y = 66;
    const w = 214;
    const h = 222;
    frame(r, x - (1 - k) * 10, y, w, h, 'panel', { alpha: A * 0.95 });
    const tx = x + 14 - (1 - k) * 10;
    r.uiText('이야기', tx, y + 12, { size: 10, font: 'small', color: C.gold, alpha: A });
    const desc = open ? c.desc : c.unlockHint ?? '아직 잠겨 있습니다.';
    const lines = r.wrapText(desc, w - 28, 12);
    lines.slice(0, 6).forEach((l, i) => r.uiText(l, tx, y + 28 + i * 16, { size: 12, color: open ? C.text : C.textFaint, alpha: A * k }));
    let ky = y + 30 + Math.min(6, lines.length) * 16 + 8;
    divider(r, x + w / 2, ky, w - 40, C.goldDark, A * 0.8);
    ky += 12;
    r.uiText('시작 장비', tx, ky, { size: 10, font: 'small', color: C.gold, alpha: A });
    ky += 16;
    if (!open) {
      r.uiSprite('ui_lock', tx + 10, ky + 14, 2, { alpha: A });
      r.uiText('해금 조건', tx + 26, ky + 2, { size: 12, color: C.textDim, alpha: A });
      r.uiText(c.unlockHint ? '위 조건을 달성하세요' : '???', tx + 26, ky + 18, { size: 10, font: 'small', color: C.textFaint, alpha: A });
      return;
    }
    const wdef = Weapons.get(c.weapon);
    const slots: { icon: string; name: string; sub: string }[] = [];
    if (wdef) slots.push({ icon: wdef.icon, name: wdef.name, sub: `무기 · ${WEAPON_KIND[wdef.kind] ?? ''}` });
    for (const id of c.artifacts ?? []) {
      const a = Artifacts.get(id);
      if (a) slots.push({ icon: a.icon, name: a.name, sub: '고유 유물' });
    }
    if (c.active) {
      const a = Actives.get(c.active);
      if (a) slots.push({ icon: a.icon, name: a.name, sub: '액티브' });
    }
    slots.slice(0, 3).forEach((s, i) => {
      const sy = ky + i * 40;
      iconSlot(r, s.icon, tx + 17, sy + 16, 36, { alpha: A, scale: 1.5 });
      r.uiText(s.name, tx + 42, sy + 3, { size: 12, color: C.text, alpha: A });
      r.uiText(s.sub, tx + 42, sy + 18, { size: 10, font: 'small', color: C.textFaint, alpha: A });
    });
  }

  private drawStats(r: Renderer, c: CharacterDef, open: boolean, A: number, k: number): void {
    const w = 214;
    const x = UI_W - 18 - w;
    const y = 66;
    const h = 222;
    frame(r, x + (1 - k) * 10, y, w, h, 'panel', { alpha: A * 0.95 });
    const tx = x + 14 + (1 - k) * 10;
    r.uiText('능력치', tx, y + 12, { size: 10, font: 'small', color: C.gold, alpha: A });
    // hearts
    const hy = y + 34;
    r.uiText('체력', tx + 22, hy - 6, { size: 12, color: C.textDim, alpha: A });
    r.uiSprite('st_heart', tx + 6, hy, 2, { alpha: A });
    const hearts = open ? c.hearts : 0;
    for (let i = 0; i < Math.max(hearts, open ? 0 : 3); i++) {
      r.uiSprite(open ? 'hud_heart_full' : 'hud_heart_empty', tx + 84 + i * 18, hy, 2, { alpha: A });
    }
    for (let i = 0; i < (open ? c.soulHearts ?? 0 : 0); i++) r.uiSprite('hud_soul_full', tx + 84 + (hearts + i) * 18, hy, 2, { alpha: A });
    const st = characterStats(c);
    const rows = characterStatRows(st);
    rows.forEach((row, i) => {
      const ry = hy + 24 + i * 24;
      r.uiSprite(row.icon, tx + 6, ry, 2, { alpha: A });
      r.uiText(row.label, tx + 22, ry - 6, { size: 12, color: C.textDim, alpha: A });
      const fill = open ? row.frac * appear(this.selT, 0.45, i * 0.04) : 0;
      gauge(r, tx + 92, ry - 5, 64, 10, fill, { fill: open ? c.color : '#3a3046', alpha: A, segments: 5 });
      r.uiText(open ? row.text : '?', tx + w - 28, ry - 6, { size: 10, font: 'small', align: 'right', color: C.text, alpha: A });
    });
    // consumables
    const cy = hy + 24 + rows.length * 24 + 4;
    const cons: [string, number][] = [['hud_coin', open ? c.coins ?? 0 : 0], ['hud_bomb', open ? c.bombs ?? 1 : 0], ['hud_key', open ? c.keys ?? 0 : 0]];
    cons.forEach(([icon, n], i) => {
      const cx = tx + 10 + i * 56;
      r.uiSprite(icon, cx, cy + 6, 2, { alpha: A });
      r.uiText(open ? `×${n}` : '?', cx + 12, cy, { size: 12, color: C.text, alpha: A });
    });
  }

  private drawRelease(r: Renderer, c: CharacterDef, open: boolean, A: number, k: number): void {
    const w = 460;
    const h = 52;
    const x = UI_W / 2 - w / 2;
    const y = 300;
    frame(r, x, y + (1 - k) * 8, w, h, 'tooltip', { alpha: A * 0.95, color: open ? '#c8662a' : C.rim });
    const fl = 0.8 + 0.2 * Math.sin(this.t * 8);
    if (open) glow(r, x + 22, y + 26, 30, '#ff8a30', 0.25 * A * fl);
    r.uiSprite(open ? 'ui_flame' : 'ui_question', x + 22, y + 26 + (1 - k) * 8, 2, { alpha: A });
    r.uiText('등불 해방', x + 42, y + 8 + (1 - k) * 8, { size: 12, bold: true, color: open ? C.emberHi : C.textFaint, alpha: A });
    r.uiText('게이지가 가득 차면 F', x + w - 12, y + 9 + (1 - k) * 8, { size: 10, font: 'small', align: 'right', color: C.textFaint, alpha: A });
    const desc = open ? c.releaseDesc ?? '등불을 터뜨려 주변의 적과 탄환을 태운다.' : '???';
    const lines = r.wrapText(desc, w - 60, 10, false, 'small');
    lines.slice(0, 2).forEach((l, i) => r.uiText(l, x + 42, y + 26 + i * 12 + (1 - k) * 8, { size: 10, font: 'small', color: open ? C.text : C.textMute, alpha: A * k }));
  }
}
