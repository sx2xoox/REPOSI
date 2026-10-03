// Online co-op UI: teammate panels, name tags over the keepers, arrows to
// teammates off screen, "OO님이 쓰러졌어요" toasts and the downed banner (CoopHud,
// drawn by the HUD); the "연결 대기 중…" overlay; the connection notices
// (desync, host lost, room closed); and the party summary after the run.
// Everything here only reads the world.

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import type { GameScene } from './game-scene';
import type { GameOverInfo, World } from '../game/world';
import type { Player } from '../game/player';
import { EMBER_MAX } from '../game/player';
import { Actives, Weapons } from '../game/defs';
import { Menu } from './widgets';
import { app } from '../game/app';
import { clamp, ease } from '../engine/math';
import { animFrame, hasAnim } from '../engine/sprites';
import { sfx } from '../audio/audio';
import { C, formatTime, splitFloorName } from './theme';
import { divider, fitScale, frame, glow, spriteCentered } from './frame';
import { appear, envelope } from './anim';
import { keeperName, slotColor, slotDark, slotLabel } from '../game/coopfx';
import { REVIVE_TIME } from '../game/coop';
import { netErrorText, type NetErrorCode } from '../net/transport';
import { touchUiActive } from './touch-mode';

/** A keeper's face for panels (idle animation, else the portrait). */
function face(p: Player, t: number): string {
  const ch = p.character;
  const idle = `${ch.spritePrefix}_idle_down`;
  return hasAnim(idle) ? animFrame(idle, t) : ch.portrait;
}

// ---------------------------------------------------------------- HUD
const PANEL_W = 128;
const PANEL_H = 36;
const TOAST_TIME = 3.2;

/** Co-op parts of the HUD (drawn on top of the regular one, in the safe area). */
export class CoopHud {
  private t = 0;
  /** last coop event drawn as a toast */
  private seen = 0;
  private toasts: { text: string; color: string; t: number }[] = [];
  private hearts = new Map<number, number>();
  private hurtT = new Map<number, number>();

  update(w: World, dt: number): void {
    this.t += dt;
    // new events → toasts
    const ev = w.coopEvents;
    const fresh = ev.filter((e) => e.t > this.seen || (e.t === this.seen && false));
    for (const e of fresh) {
      this.seen = Math.max(this.seen, e.t + 1e-9);
      const name = e.name || slotLabel(e.slot);
      const mine = e.slot === w.local.slot;
      const text = e.kind === 'down' ? (mine ? '쓰러졌어요!' : `${name}님이 쓰러졌어요`)
        : e.kind === 'revive' ? (mine ? '다시 일어났어요!' : `${name}님이 일어났어요`)
          : `${name}님이 나갔어요`;
      this.toasts.push({ text, color: e.kind === 'down' ? '#ff9aa0' : e.kind === 'revive' ? '#fff0a0' : C.textDim, t: this.t });
      if (e.kind === 'down') sfx('warn', { vol: 0.35 });
    }
    this.toasts = this.toasts.filter((x) => this.t - x.t < TOAST_TIME);
    if (this.toasts.length > 3) this.toasts.splice(0, this.toasts.length - 3);
    for (const p of w.players) {
      const hp = p.red + p.soul;
      const before = this.hearts.get(p.slot);
      if (before !== undefined && hp < before) this.hurtT.set(p.slot, this.t);
      this.hearts.set(p.slot, hp);
    }
  }

  /** Teammate panels (right edge, under the minimap), tags, arrows, toasts. `ox/oy`: safe-area origin, `W/H`: HUD area. */
  draw(r: Renderer, w: World, A: number, ox: number, oy: number, W: number, H: number, panelTop: number): void {
    this.drawTags(r, w, A);
    const mates = w.players.filter((p) => p !== w.local);
    const touch = touchUiActive();
    // phones: the panels shrink to a narrow column so the touch buttons stay clear
    const pw = touch ? 104 : PANEL_W;
    mates.forEach((p, i) => this.drawPanel(r, w, p, ox + W - pw - 8, oy + panelTop + i * (PANEL_H + 4), pw, A));
    this.drawToasts(r, w, A, ox + W / 2, oy + (touch ? 58 : 46));
    if (w.local.downed) this.drawDowned(r, w, A, ox + W / 2, oy + H * 0.68);
  }

  private drawPanel(r: Renderer, w: World, p: Player, x: number, y: number, pw: number, A: number): void {
    const col = slotColor(p.slot);
    const down = p.downed;
    const a = A * (down ? 0.85 : 1);
    frame(r, x, y, pw, PANEL_H, 'panel', { alpha: a * 0.92 });
    r.uiRect(x + 2, y + 2, 3, PANEL_H - 4, col, a);
    // face
    const hurt = this.t - (this.hurtT.get(p.slot) ?? -9) < 0.3;
    spriteCentered(r, face(p, this.t + p.slot * 0.37), x + 18, y + PANEL_H / 2 + 1, 1.5, {
      alpha: a * (down ? 0.5 : 1), tint: down ? '#a8d8ff' : undefined, tintAmount: down ? 0.6 : undefined, flash: hurt ? 0.7 : 0,
    });
    // name (+ the keeper's character, faint, when there is room)
    const name = keeperName(p);
    r.uiText(name, x + 32, y + 4, { size: 10, font: 'small', color: col, alpha: a, outline: C.ink });
    if (!down && pw >= 120) r.uiText(p.character.name, x + pw - 7, y + 4, { size: 10, font: 'small', align: 'right', color: C.textFaint, alpha: a * 0.9 });
    if (down) {
      // revive progress bar
      const f = clamp(p.reviveT / REVIVE_TIME, 0, 1);
      r.uiText(f > 0 ? '부활 중' : '쓰러짐', x + pw - 6, y + 4, { size: 10, font: 'small', align: 'right', color: f > 0 ? C.emberHi : '#a8d8ff', alpha: a, outline: C.ink });
      r.uiRect(x + 32, y + 22, pw - 40, 5, C.ink, a);
      r.uiRect(x + 33, y + 23, (pw - 42) * f, 3, '#fff0a0', a);
      return;
    }
    // hearts: one small pip per half heart (red, then soul)
    const pip = 5;
    const maxPips = Math.floor((pw - 40) / (pip + 1));
    const total = Math.min(maxPips, Math.max(p.maxRed, p.red) + p.soul);
    for (let i = 0; i < total; i++) {
      const hx = x + 32 + i * (pip + 1);
      const hy = y + 18;
      const isRed = i < p.maxRed;
      const filled = isRed ? i < p.red : i - p.maxRed < p.soul;
      const c = !filled ? '#3a2430' : isRed ? C.heart : C.soul;
      r.uiRect(hx, hy, pip, 6, C.ink, a);
      r.uiRect(hx + 1, hy + 1, pip - 2, 4, c, a);
      if (filled && i % 2 === 0) r.uiRect(hx + 1, hy + 1, 1, 1, '#ffffff', a * 0.6);
    }
    // ember
    const ef = clamp(p.ember / EMBER_MAX, 0, 1);
    r.uiRect(x + 32, y + 27, pw - 40, 4, C.ink, a);
    r.uiRect(x + 33, y + 28, (pw - 42) * ef, 2, ef >= 1 ? C.emberHi : C.ember, a);
    if (ef >= 1) glow(r, x + 32 + (pw - 40), y + 29, 8, C.ember, 0.35 * a * (0.6 + 0.4 * Math.sin(this.t * 7)));
  }

  /** Name tags over teammates on screen, arrows at the edge for those off screen. */
  private drawTags(r: Renderer, w: World, A: number): void {
    const sa = r.uiSafe;
    for (const tag of w.coopTags) {
      const p = w.players.find((q) => q.slot === tag.slot);
      if (!p) continue;
      const col = slotColor(p.slot);
      const mine = p === w.local;
      if (tag.onScreen) {
        if (!mine) r.uiText(keeperName(p), tag.x, tag.y - 12, { size: 10, font: 'small', align: 'center', color: col, outline: C.ink, alpha: A });
        if (p.downed) {
          const f = clamp(p.reviveT / REVIVE_TIME, 0, 1);
          const label = f > 0 ? `부활 ${Math.round(f * 100)}%` : '쓰러짐';
          r.uiText(label, tag.x, tag.y - (mine ? 12 : 24), { size: 10, font: 'small', align: 'center', color: f > 0 ? C.emberHi : '#a8d8ff', outline: C.ink, alpha: A * (0.75 + 0.25 * Math.sin(this.t * 4)) });
        }
        continue;
      }
      if (mine) continue;
      // off screen: a colored arrow on the screen edge pointing at the teammate
      const cx = UI_W / 2;
      const cy = UI_H / 2;
      const dx = tag.x - cx;
      const dy = tag.y + 12 - cy;
      const ang = Math.atan2(dy, dx);
      const mx = UI_W / 2 - 22 - Math.max(sa.l, sa.r);
      const my = UI_H / 2 - 30 - Math.max(sa.t, sa.b);
      const k = Math.min(mx / Math.max(1e-6, Math.abs(Math.cos(ang))), my / Math.max(1e-6, Math.abs(Math.sin(ang))));
      const ax = cx + Math.cos(ang) * k;
      const ay = cy + Math.sin(ang) * k;
      this.drawArrow(r, ax, ay, ang, col, slotDark(p.slot), A);
      r.uiText(keeperName(p), ax - Math.cos(ang) * 16, ay - Math.sin(ang) * 16 - 5, { size: 10, font: 'small', align: 'center', color: col, outline: C.ink, alpha: A });
    }
  }

  private drawArrow(r: Renderer, x: number, y: number, ang: number, col: string, dark: string, A: number): void {
    const d = r.dctx;
    d.save();
    d.globalAlpha = A * (0.8 + 0.2 * Math.sin(this.t * 5));
    d.translate(Math.round(x), Math.round(y));
    d.rotate(ang);
    d.beginPath();
    d.moveTo(9, 0);
    d.lineTo(-5, -7);
    d.lineTo(-2, 0);
    d.lineTo(-5, 7);
    d.closePath();
    d.fillStyle = col;
    d.strokeStyle = dark;
    d.lineWidth = 2;
    d.stroke();
    d.fill();
    d.restore();
  }

  private drawToasts(r: Renderer, _w: World, A: number, cx: number, y: number): void {
    this.toasts.forEach((x, i) => {
      const age = this.t - x.t;
      const a = envelope(age, TOAST_TIME, 0.15, 0.6) * A;
      const ty = y + i * 18 - (1 - ease.outCubic(clamp(age / 0.25, 0, 1))) * 6;
      const tw = r.measureText(x.text, 12, true) + 24;
      r.uiRect(cx - tw / 2, ty - 3, tw, 17, C.ink, 0.7 * a);
      r.uiText(x.text, cx, ty, { size: 12, bold: true, align: 'center', color: x.color, alpha: a, outline: C.ink });
    });
  }

  private drawDowned(r: Renderer, w: World, A: number, cx: number, y: number): void {
    const p = w.local;
    const f = clamp(p.reviveT / REVIVE_TIME, 0, 1);
    const a = A * (0.85 + 0.15 * Math.sin(this.t * 3));
    const msg = f > 0 ? '동료가 일으켜 세우는 중…' : '쓰러졌어요 — 동료 곁에 머무르거나 방을 정리하면 일어나요';
    const tw = r.measureText(msg, 12, true) + 30;
    r.uiRect(cx - tw / 2, y - 4, tw, 30, C.ink, 0.65 * a);
    r.uiText(msg, cx, y, { size: 12, bold: true, align: 'center', color: '#a8d8ff', alpha: a, outline: C.ink });
    r.uiRect(cx - 80, y + 17, 160, 4, '#2a2238', a);
    r.uiRect(cx - 80, y + 17, 160 * f, 4, '#fff0a0', a);
  }
}

// ---------------------------------------------------------------- waiting
/** "연결 대기 중…": the client has had no frame from the host for a while (`t` s, already past 0.5 s). */
export function drawWaiting(r: Renderer, t: number, W: number, H: number): void {
  r.beginUI();
  const a = clamp(t / 0.25, 0, 1);
  r.uiRect(0, 0, W, H, C.void, 0.45 * a);
  const pw = 230;
  const ph = 54;
  const x = W / 2 - pw / 2;
  const y = H / 2 - ph / 2 - 20;
  frame(r, x, y, pw, ph, 'panel', { alpha: a });
  const dots = '.'.repeat(1 + (Math.floor(t * 3) % 3));
  r.uiText(`연결 대기 중${dots}`, W / 2, y + 12, { size: 16, bold: true, align: 'center', color: C.text, alpha: a, outline: C.ink });
  r.uiText('방장의 신호를 기다리고 있어요', W / 2, y + 34, { size: 10, font: 'small', align: 'center', color: C.textFaint, alpha: a });
  for (let i = 0; i < 3; i++) {
    const k = 0.5 + 0.5 * Math.sin(t * 6 - i * 0.9);
    r.uiRect(x + 20 + i * 8, y + 22, 4, 4, C.goldHi, a * (0.3 + 0.7 * k));
  }
}

// ---------------------------------------------------------------- notices
type NoticeKind = 'desync' | NetErrorCode;

/** The run cannot go on (out of sync, host gone, room closed): a clear message and the way out. */
export class NetNoticeOverlay implements Scene {
  transparent = true;
  touchBack = false as const;
  private t = 0;
  private menu: Menu;
  private title: string;
  private hint: string;

  constructor(private readonly game: GameScene, readonly kind: NoticeKind) {
    if (kind === 'desync') {
      this.title = '게임 상태가 어긋났어요';
      this.hint = '모두의 하강이 서로 달라져 더 이어갈 수 없어요.\n로비로 돌아가 다시 시작해 주세요.';
    } else {
      const txt = netErrorText(kind);
      this.title = txt.title;
      this.hint = txt.hint;
    }
    const toLobby = kind === 'desync';
    this.menu = new Menu([
      toLobby
        ? { label: '로비로', action: () => this.game.leaveOnline('lobby'), hint: '함께하기 화면으로 돌아갑니다.' }
        : { label: '타이틀로', action: () => this.game.leaveOnline('title'), hint: '타이틀 화면으로 돌아갑니다.' },
    ], UI_W / 2, UI_H / 2 + 46, { width: 200, lineH: 28, size: 14, showHint: false });
  }

  enter(): void {
    sfx('ui_error');
  }

  update(dt: number): void {
    this.t += dt;
    if (this.t > 0.4) this.menu.update(app.renderer, dt);
  }

  draw(r: Renderer): void {
    r.beginUI();
    const a = appear(this.t, 0.3);
    r.uiRect(0, 0, UI_W, UI_H, C.void, 0.8 * a);
    const pw = 440;
    const ph = 170;
    const x = UI_W / 2 - pw / 2;
    const y = UI_H / 2 - ph / 2 - 16 + (1 - a) * 10;
    frame(r, x, y, pw, ph, 'ornate', { alpha: a });
    r.uiSprite(this.kind === 'desync' ? 'ui_hourglass' : 'ui_skull', x + 34, y + 30, 2, { alpha: a });
    r.uiText(this.title, UI_W / 2 + 10, y + 20, { size: 16, bold: true, align: 'center', color: C.bad, alpha: a, outline: C.ink });
    this.hint.split('\n').forEach((line, i) => r.uiText(line, UI_W / 2, y + 54 + i * 18, { size: 12, align: 'center', color: C.textDim, alpha: a }));
    this.menu.y = y + ph - 32;
    this.menu.draw(r, a);
  }
}

// ---------------------------------------------------------------- party summary
/** After the run: the party (every keeper and what they carried), the shared record, and what's next. */
export class CoopSummaryOverlay implements Scene {
  transparent = true;
  touchBack = false as const;
  private t = 0;
  private menu: Menu;
  private menuShown = false;
  private items = new Map<number, string[]>();

  constructor(private readonly game: GameScene, private readonly info: GameOverInfo) {
    const host = !!game.net?.isHost;
    this.menu = new Menu(host
      ? [
        { label: '다시 함께 (로비로)', action: () => this.lobby(), hint: '모두 함께 같은 방의 로비로 돌아갑니다.' },
        { label: '타이틀로', action: () => this.game.leaveOnline('title'), hint: '방을 닫고 타이틀로 돌아갑니다.' },
      ]
      : [{ label: '타이틀로', action: () => this.game.leaveOnline('title'), hint: '방에서 나가 타이틀로 돌아갑니다.' }],
    UI_W / 2, 352, { width: 240, lineH: 26, size: 13, hintY: UI_H - 16 });
    for (const p of game.world.players) {
      const list: string[] = [];
      const wd = Weapons.get(p.weaponId);
      if (wd) list.push(wd.icon);
      const act = p.activeId ? Actives.get(p.activeId) : undefined;
      if (act) list.push(act.icon);
      for (const a of p.items.computed?.artifacts ?? []) if (!a.def.hidden || a.def.blessing) list.push(a.def.icon);
      this.items.set(p.slot, list);
    }
  }

  private lobby(): void {
    sfx('ui_select');
    this.game.command({ type: 'lobby' });
  }

  enter(): void {
    sfx(this.info.won ? 'item_get_rare' : 'ui_open', { vol: 0.5 });
  }

  update(dt: number): void {
    this.t += dt;
    if (this.t > 1.2) {
      if (!this.menuShown) {
        this.menuShown = true;
        this.menu.t = 0;
      }
      this.menu.update(app.renderer, dt);
    }
  }

  draw(r: Renderer): void {
    r.beginUI();
    const w = this.game.world;
    const run = this.game.run;
    const won = this.info.won;
    const ended = !won && this.info.source === '하강 종료';
    const a = clamp(this.t / 0.7, 0, 1);
    r.uiRect(0, 0, UI_W, UI_H, won ? '#0a0604' : '#0e0306', 0.93 * a);
    const ta = appear(this.t, 0.6, 0.15);
    const title = won ? '함께 심연을 밝혔다' : ended ? '하강을 마쳤다' : '모두의 등불이 꺼졌다';
    const ty = 22 + (1 - ta) * 10;
    if (won) glow(r, UI_W / 2, ty + 16, 120, '#ffb040', 0.25 * ta);
    r.uiText(title, UI_W / 2, ty, { size: 28, bold: true, align: 'center', color: won ? C.goldHi : ended ? C.text : '#ff7a7a', outline: C.ink, alpha: ta });
    const [no, fname] = splitFloorName(w.floor.name);
    const s = run.stats;
    const line = `${no} ${fname} · ${formatTime(s.timeSec)} · 처치 ${s.kills} · 방 ${s.roomsCleared} · 보스 ${s.bossesKilled}`;
    r.uiText(line, UI_W / 2, ty + 38, { size: 12, align: 'center', color: C.textDim, alpha: ta });
    divider(r, UI_W / 2, ty + 58, 360, won ? C.gold : '#7a2a30', ta);

    // party cards
    const ps = w.players;
    const cw = Math.min(170, (UI_W - 60) / Math.max(1, ps.length) - 10);
    const gap = 10;
    const total = ps.length * cw + (ps.length - 1) * gap;
    const x0 = UI_W / 2 - total / 2;
    ps.forEach((p, i) => {
      const ca = appear(this.t, 0.45, 0.35 + i * 0.12);
      const x = x0 + i * (cw + gap);
      const y = 104 + (1 - ca) * 14;
      const col = slotColor(p.slot);
      frame(r, x, y, cw, 214, p === w.local ? 'panelHi' : 'panel', { alpha: ca });
      r.uiRect(x + 3, y + 3, cw - 6, 3, col, ca);
      glow(r, x + cw / 2, y + 44, 34, p.character.color, 0.15 * ca);
      spriteCentered(r, face(p, this.t + i * 0.3), x + cw / 2, y + 44, 2.5, { alpha: ca, tint: p.downed ? '#a8d8ff' : undefined, tintAmount: p.downed ? 0.5 : undefined });
      r.uiText(keeperName(p), x + cw / 2, y + 74, { size: 12, bold: true, align: 'center', color: col, alpha: ca, outline: C.ink });
      r.uiText(`${slotLabel(p.slot)} · ${p.character.name}${p === w.local ? ' (나)' : ''}`, x + cw / 2, y + 92, { size: 10, font: 'small', align: 'center', color: C.textFaint, alpha: ca });
      r.uiText(p.downed ? '쓰러진 채 끝났다' : '끝까지 버텼다', x + cw / 2, y + 106, { size: 10, font: 'small', align: 'center', color: p.downed ? '#a8d8ff' : C.good, alpha: ca });
      const icons = this.items.get(p.slot) ?? [];
      const cols = Math.max(1, Math.floor((cw - 16) / 24));
      icons.slice(0, cols * 3).forEach((icon, k) => {
        const kk = clamp((this.t - 0.8 - i * 0.1 - k * 0.03) / 0.25, 0, 1);
        if (kk <= 0) return;
        const cx = x + 8 + 12 + (k % cols) * 24 + ((cw - 16) - cols * 24) / 2;
        const cy = y + 136 + Math.floor(k / cols) * 24;
        frame(r, cx - 11, cy - 11, 22, 22, 'slot', { alpha: ca * kk });
        spriteCentered(r, icon, cx, cy, fitScale(icon, 18, 1) * ease.outBack(kk), { alpha: ca * kk });
      });
      if (icons.length > cols * 3) r.uiText(`+${icons.length - cols * 3}`, x + cw - 8, y + 198, { size: 10, font: 'small', align: 'right', color: C.textDim, alpha: ca });
    });
    r.uiText(`시드 ${run.seed}`, UI_W / 2, 326, { size: 10, font: 'small', align: 'center', color: C.textMute, alpha: a });
    if (!this.game.net?.isHost && this.menuShown) {
      r.uiText('방장이 다음을 정하면 함께 이동해요', UI_W / 2, 336 + 44, { size: 10, font: 'small', align: 'center', color: C.textFaint, alpha: appear(this.menu.t, 0.3) * (0.7 + 0.3 * Math.sin(this.t * 3)) });
    }
    if (this.menuShown) this.menu.draw(r, appear(this.menu.t, 0.3));
  }
}
