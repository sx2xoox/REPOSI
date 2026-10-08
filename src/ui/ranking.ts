// 랭킹 (speedrun ranking), opened from the title menu and from a speedrun's game-over screen.
//
// One board per floor N, chosen with the floor dropdown ("N층까지 ▾"): the time is the clear
// time of floors 1..N (from the start of floor 1 to floor N's boss falling), never floor N
// alone. Two views: 전체 랭킹 (the online board, each player's best) and 내 기록 (this
// device's records). Selecting a row expands it (accordion) into that run's per-floor
// breakdown: cumulative time, the floor's own segment and the boss fight.
//
// Network: nothing at boot or from the title; the queue is flushed once when this screen
// opens and boards are fetched on open / floor change, cached per floor while it is open.
// UI only: reads the local store and the board, never the simulation.

import type { Scene, TouchButtonSpec } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W, UI_W_BASE, uiCenterX } from '../engine/renderer';
import { app } from '../game/app';
import { input } from '../engine/input';
import { sfx } from '../audio/audio';
import { clamp, ease, mixColor } from '../engine/math';
import { animFrame } from '../engine/sprites';
import { Characters, Floors, Weapons, lastFloorIndex } from '../game/defs';
import { speedrunStore } from '../engine/speedrun-store';
import { SEASON, canRead, fetchTop, flushQueue, leaderboardUrl, type OnlineEntry } from '../net/leaderboard';
import { C, formatSplit, splitFloorName } from './theme';
import { fitScale, frame, glow, keyHintRow, spriteCentered } from './frame';
import { Repeater, Spring, appear, follow, pulse } from './anim';
import { actionLabel } from './keys';
import { touchUiActive } from './touch-mode';
import { NicknamePrompt, speedrunName } from './nickname-prompt';
import { breakdown, dateLabel, deepestFloor, localRows, onlineRows, rowOffsets, scrollToShow, stepFloor, type RankRow } from './ranking-data';

export interface RankingOptions {
  /** floor tab to open (1..last floor) */
  floor?: number;
  /** highlight this device's run (just finished) */
  highlightRun?: string;
  /** keep the scene below updating (title backdrop); false over the game-over screen */
  passUpdate?: boolean;
}

type View = 'online' | 'local';
type Board = { state: 'loading' } | { state: 'ok'; entries: OnlineEntry[] } | { state: 'error'; error: string };
interface Rect { x: number; y: number; w: number; h: number }

// ---------------------------------------------------------------- layout (768-wide space, centered)
const L = 30;
const R = UI_W_BASE - 30;
const TOOL_Y = 56;
const TOOL_H = 26;
const NOTE_Y = 92;
const HEAD_Y = 110;
const LIST_Y = 126;
const LIST_H = 246;
const FOOT_Y = 381;
/** row pitch (the row plate is 2 px shorter) */
const ROW_H = 28;
/** expanded per-floor breakdown under a row */
const EXP_H = 108;
const DD_W = 304;
const DD_ITEM = 30;
/** the dropdown list's header line */
const DD_HEAD = 18;
const CLOSE: Rect = { x: 712, y: 18, w: 26, h: 24 };
const TABS: { view: View; label: string; icon: string; w: number }[] = [
  { view: 'online', label: '전체 랭킹', icon: 'ui_crown', w: 128 },
  { view: 'local', label: '내 기록', icon: 'ui_hourglass', w: 100 },
];
const MEDAL = ['#ffd24a', '#cfd6e6', '#e0925a'];
/** per-floor tint (breakdown chips and the pace bar): crypt, spores, embers, frost, void, archive, clockwork ... */
const FLOOR_TINT = ['#c8b498', '#8ec86a', '#ff8a3a', '#8ac8f0', '#b07af0', '#5ab0b8', '#e0c060', '#e86a8a', '#7a9af8', '#f0ece0'];
/** column x positions */
const COL = { rank: L + 22, name: L + 50, portrait: L + 258, char: L + 274, seed: L + 404, time: R - 26 };

/** this session's last choice (reopening the screen keeps it) */
const memory: { floor: number; view: View | null } = { floor: 0, view: null };

/** The online board can be read on this page. */
function onlineAvailable(): boolean {
  return leaderboardUrl() !== '' && canRead();
}

/** Trim a string with '…' so it fits `max` UI units. */
function fitText(r: Renderer, s: string, max: number, size: number, bold = false, font: 'main' | 'small' = 'main'): string {
  if (r.measureText(s, size, bold, font) <= max) return s;
  const ch = Array.from(s);
  while (ch.length > 1 && r.measureText(`${ch.join('')}…`, size, bold, font) > max) ch.pop();
  return `${ch.join('')}…`;
}

/**
 * Right-aligned text with fixed-advance digits (Galmuri's '1' is narrower than the other
 * digits), so times line up column by column. Returns the width used.
 */
function tabular(r: Renderer, s: string, right: number, y: number, o: { size: number; font?: 'main' | 'small'; bold?: boolean; color: string; alpha: number }): number {
  const font = o.font ?? 'main';
  const bold = !!o.bold;
  let dw = 0;
  for (let d = 0; d < 10; d++) dw = Math.max(dw, r.measureText(String(d), o.size, bold, font));
  let x = right;
  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i];
    const w = r.measureText(ch, o.size, bold, font);
    const adv = ch >= '0' && ch <= '9' ? dw : w;
    x -= adv;
    r.uiText(ch, Math.round(x + (adv - w) / 2), y, { size: o.size, bold, font, color: o.color, alpha: o.alpha });
  }
  return right - x;
}

function floorTitle(n: number): string {
  const f = Floors.all().find((x) => x.index === n);
  return f ? splitFloorName(f.name)[1] : '';
}

const inRect = (m: { x: number; y: number }, q: Rect) => m.x >= q.x && m.x < q.x + q.w && m.y >= q.y && m.y < q.y + q.h;

export class RankingScene implements Scene {
  transparent = true;
  touchBack = 'close' as const;
  passUpdate: boolean;

  private readonly last = Math.max(1, lastFloorIndex());
  private floor: number;
  private view: View;
  private readonly online = onlineAvailable();
  private boards = new Map<number, Board>();
  private rows: RankRow[] = [];
  /** selected row (-1: the floor dropdown has the focus) */
  private sel = -1;
  /** key of the selected row (kept while a board loads) */
  private selKey: string | null = null;
  /** expanded row (accordion) */
  private openKey: string | null = null;
  /** expansion amount per row key (0..1, animated) */
  private expand = new Map<string, number>();
  private scroll = 0;
  private scrollS = new Spring(0, 320, 34);
  /** scroll to show the selected row (+ expansion) once the layout settles */
  private follow = false;
  private dd = false;
  private ddHi = 1;
  private ddT = 0;
  private t = 0;
  private viewT = 0;
  private closing = -1;
  private alive = false;
  private flushing: Promise<void> | null = null;
  private rep = { u: new Repeater(), d: new Repeater(), l: new Repeater(0.4, 0.16), r: new Repeater(0.4, 0.16) };
  private hover = -1;
  private viewChosen = false;

  constructor(readonly o: RankingOptions = {}) {
    this.passUpdate = o.passUpdate ?? true;
    const deepest = deepestFloor((f) => speedrunStore.list(f).length, this.last);
    this.floor = clamp(Math.round(o.floor ?? (memory.floor || deepest || 1)), 1, this.last);
    this.view = o.highlightRun ? 'local' : memory.view ?? (this.online ? 'online' : 'local');
    if (!this.online) this.view = 'local';
    this.rebuild();
    // the run that just ended: selected, expanded and scrolled into view
    if (o.highlightRun) {
      const i = this.rows.findIndex((r) => r.mine);
      if (i >= 0) {
        this.sel = i;
        this.selKey = this.openKey = this.rows[i].key;
        this.follow = true;
      }
    }
  }

  enter(): void {
    this.alive = true;
    input.releaseAll();
    sfx('ui_open');
    if (!this.online) return;
    // records still queued (a closed tab, a network error) go out first; boards wait a moment
    // for them so a just-sent time shows up
    const accepted = new Set<number>();
    this.flushing = flushQueue((e, res) => {
      if (res.ok) accepted.add(e.floor);
    }).catch(() => undefined).then(() => {
      this.flushing = null;
      if (!this.alive) return;
      for (const f of accepted) {
        if (!this.boards.has(f)) continue;
        this.boards.delete(f);
        if (f === this.floor && this.view === 'online') this.load(f);
      }
      if (accepted.size) this.rebuild();
    });
    this.load(this.floor);
  }

  exit(): void {
    this.alive = false;
    memory.floor = this.floor;
    // a just-finished run opens 내 기록; that is not the viewer's choice of view
    if (!this.o.highlightRun || this.viewChosen) memory.view = this.view;
  }

  // ---------------------------------------------------------------- data
  private load(floor: number, force = false): void {
    if (!this.online) return;
    const cur = this.boards.get(floor);
    if (cur && !force && cur.state !== 'error') return;
    const token: Board = { state: 'loading' };
    this.boards.set(floor, token);
    const wait = this.flushing ? Promise.race([this.flushing, new Promise<void>((res) => setTimeout(res, 1500))]) : Promise.resolve();
    void wait.then(() => fetchTop(floor)).then((res) => {
      if (!this.alive || this.boards.get(floor) !== token) return;
      this.boards.set(floor, res.ok ? { state: 'ok', entries: res.entries } : { state: 'error', error: res.error });
      if (floor === this.floor) {
        this.rebuild();
        this.viewT = Math.min(this.viewT, 0.05);
      }
    });
  }

  private board(): Board | null {
    return this.view === 'online' && this.online ? this.boards.get(this.floor) ?? { state: 'loading' } : null;
  }

  private rebuild(): void {
    if (this.view === 'local') {
      this.rows = localRows(speedrunStore.list(this.floor), (id) => speedrunStore.run(id), this.o.highlightRun);
    } else {
      const b = this.board();
      this.rows = b?.state === 'ok' ? onlineRows(b.entries, speedrunName()) : [];
    }
    const want = this.selKey;
    const i = want ? this.rows.findIndex((r) => r.key === want) : -1;
    if (i >= 0) this.sel = i;
    else if (this.sel >= this.rows.length) this.sel = this.rows.length - 1;
    if (this.sel >= 0) this.selKey = this.rows[this.sel].key;
    if (this.sel >= 0 && this.openKey === this.rows[this.sel].key) this.follow = true;
  }

  private setFloor(f: number): void {
    const n = stepFloor(f, 0, this.last);
    if (n === this.floor) return;
    this.floor = n;
    sfx('ui_move');
    this.viewT = 0;
    this.scroll = 0;
    this.scrollS.set(0);
    if (this.view === 'online') this.load(n);
    this.rebuild();
    if (this.sel >= 0) this.follow = true;
  }

  private setView(v: View): void {
    if (v === this.view) return;
    sfx('ui_move');
    this.view = v;
    this.viewChosen = true;
    this.viewT = 0;
    this.scroll = 0;
    this.scrollS.set(0);
    this.sel = -1;
    this.selKey = null;
    this.openKey = null;
    this.expand.clear();
    if (v === 'online') this.load(this.floor);
    this.rebuild();
  }

  private retry(): void {
    sfx('ui_select');
    this.load(this.floor, true);
    this.rebuild();
    this.viewT = 0;
  }

  private openNickname(): void {
    sfx('ui_select');
    app.scenes.push(new NicknamePrompt((name) => {
      if (name) this.rebuild();
    }, { title: speedrunName() ? '닉네임 바꾸기' : '랭킹 닉네임', note: '최대 10자 · 다음 기록부터 이 이름으로 랭킹에 올라가요' }));
  }

  private close(): void {
    if (this.closing >= 0) return;
    sfx('ui_back');
    this.closing = 0;
    this.dd = false;
  }

  /** Toggle the selected row's breakdown. */
  private toggle(i: number): void {
    const row = this.rows[i];
    if (!row) return;
    this.sel = i;
    this.selKey = row.key;
    if (this.openKey === row.key) {
      this.openKey = null;
      sfx('ui_back', { vol: 0.6 });
    } else {
      this.openKey = row.key;
      this.follow = true;
      sfx('ui_select', { vol: 0.8 });
    }
  }

  private openDropdown(): void {
    this.dd = true;
    this.ddT = 0;
    this.ddHi = this.floor;
    sfx('ui_open', { vol: 0.6 });
  }

  // ---------------------------------------------------------------- layout helpers
  private heights(): number[] {
    return this.rows.map((r) => ROW_H + EXP_H * ease.outCubic(this.expand.get(r.key) ?? 0));
  }

  private nickRect(): Rect {
    const right = touchUiActive() ? R - 46 : CLOSE.x - 8;
    return { x: right - 112, y: 18, w: 112, h: 24 };
  }

  private tabRect(i: number): Rect {
    let x = L;
    for (let k = 0; k < i; k++) x += TABS[k].w + 4;
    return { x, y: TOOL_Y, w: TABS[i].w, h: TOOL_H };
  }

  private ddRect(): Rect {
    return { x: R - 184, y: TOOL_Y, w: 184, h: TOOL_H };
  }

  private ddListRect(): Rect {
    const b = this.ddRect();
    return { x: b.x + b.w - DD_W, y: b.y + b.h + 4, w: DD_W, h: DD_HEAD + this.last * DD_ITEM + 10 };
  }

  private ddItemRect(f: number): Rect {
    const l = this.ddListRect();
    return { x: l.x + 5, y: l.y + 5 + DD_HEAD + (f - 1) * DD_ITEM, w: l.w - 10, h: DD_ITEM - 2 };
  }

  /** the state button in the list area (retry / switch to 내 기록), when one is shown */
  private stateButton(): { rect: Rect; label: string; act: () => void } | null {
    const cy = LIST_Y + LIST_H / 2;
    const b = this.board();
    if (this.view === 'online' && !this.online) return { rect: { x: UI_W_BASE / 2 - 60, y: cy + 22, w: 120, h: 26 }, label: '내 기록 보기', act: () => this.setView('local') };
    if (b?.state === 'error') return { rect: { x: UI_W_BASE / 2 - 60, y: cy + 22, w: 120, h: 26 }, label: '다시 시도', act: () => this.retry() };
    return null;
  }

  touchButtons(): TouchButtonSpec[] {
    if (this.closing >= 0 || this.dd) return [];
    // the nickname box opens the phone keyboard: run it inside the touch gesture
    const q = this.nickRect();
    return [{ x: q.x + uiCenterX(), y: q.y, w: q.w, h: q.h, tap: () => this.openNickname(), ghost: true }];
  }

  // ---------------------------------------------------------------- update
  update(dt: number): void {
    // the scene manager runs `passUpdate` on the scene under the top one: right after this
    // screen pushes the nickname box that is this screen again (same step), so skip it
    if (app.scenes.top !== this) return;
    this.t += dt;
    this.viewT += dt;
    this.ddT += dt;
    for (const r of this.rows) {
      const target = r.key === this.openKey ? 1 : 0;
      const cur = this.expand.get(r.key) ?? 0;
      if (cur === target) continue;
      const v = Math.abs(target - cur) < 0.004 ? target : follow(cur, target, 16, dt);
      if (v === 0) this.expand.delete(r.key);
      else this.expand.set(r.key, v);
    }
    const hs = this.heights();
    const offs = rowOffsets(hs);
    const maxScroll = Math.max(0, offs[offs.length - 1] - LIST_H);
    if (this.follow && this.sel >= 0) {
      // follow the selected row and its breakdown (by the target height)
      const top = offs[this.sel];
      const full = this.openKey === this.rows[this.sel]?.key ? ROW_H + EXP_H : ROW_H;
      const fullMax = Math.max(maxScroll, offs[offs.length - 1] - hs[this.sel] + full - LIST_H);
      // a little of the next row shows under an opened breakdown (clear of the edge fade)
      const margin = this.sel < this.rows.length - 1 ? (full > ROW_H ? 16 : 6) : 0;
      this.scroll = scrollToShow(this.scroll, top - (this.sel > 0 ? 6 : 0), top + full + margin, LIST_H, fullMax);
      if ((this.expand.get(this.rows[this.sel].key) ?? 0) === (full > ROW_H ? 1 : 0)) this.follow = false;
    } else {
      this.scroll = clamp(this.scroll, 0, maxScroll);
    }
    this.scrollS.target = this.scroll;
    this.scrollS.update(dt);

    if (this.closing >= 0) {
      this.closing += dt;
      if (this.closing > 0.16) app.scenes.remove(this);
      return;
    }
    const m = this.mouseUI();
    const click = input.pressed('fire') && input.lastDevice !== 'pad';
    const mouse = input.lastDevice === 'mouse';
    if (this.dd) {
      this.updateDropdown(dt, m, click, mouse);
      return;
    }
    if (input.pressed('cancel') || input.pressed('pause')) {
      this.close();
      return;
    }
    // floors: ← / → , Q / E, LB / RB step directly
    const lf = this.rep.l.update(input.held('uiLeft'), dt);
    const rt = this.rep.r.update(input.held('uiRight'), dt);
    if (input.pressed('tabPrev') || lf) this.setFloor(this.floor - 1);
    else if (input.pressed('tabNext') || rt) this.setFloor(this.floor + 1);
    if (input.pressed('inventory')) this.setView(this.view === 'online' ? 'local' : 'online');
    if (input.pressed('special')) {
      this.openNickname();
      return;
    }
    // rows: -1 is the dropdown
    const n = this.rows.length;
    const old = this.sel;
    if (this.rep.d.update(input.held('uiDown'), dt) && n) this.sel = Math.min(n - 1, this.sel + 1);
    if (this.rep.u.update(input.held('uiUp'), dt)) this.sel = Math.max(-1, this.sel - 1);
    if (this.sel !== old) {
      sfx('ui_move', { vol: 0.5 });
      this.selKey = this.sel >= 0 ? this.rows[this.sel].key : null;
      if (this.sel >= 0) this.follow = true;
      else this.scroll = 0;
    }
    if (input.wheel && n) {
      this.scroll = clamp(this.scroll + Math.sign(input.wheel) * ROW_H, 0, maxScroll);
      this.follow = false;
    }
    if (input.pressed('confirm')) {
      const sb = this.stateButton();
      if (this.sel >= 0) this.toggle(this.sel);
      else if (sb) sb.act();
      else this.openDropdown();
      return;
    }
    // pointer
    this.hover = -1;
    if (m.y >= LIST_Y && m.y < LIST_Y + LIST_H && m.x >= L && m.x < R) {
      const y = m.y - LIST_Y + this.scrollS.value;
      for (let i = 0; i < n; i++) {
        if (y >= offs[i] && y < offs[i + 1]) this.hover = i;
      }
    }
    if (mouse && input.mouseMoved && this.hover >= 0 && this.hover !== this.sel) {
      this.sel = this.hover;
      this.selKey = this.rows[this.sel].key;
      sfx('ui_move', { vol: 0.4 });
    }
    if (!click) return;
    if (!touchUiActive() && inRect(m, CLOSE)) { this.close(); return; }
    if (inRect(m, this.nickRect())) { this.openNickname(); return; }
    for (let i = 0; i < TABS.length; i++) if (inRect(m, this.tabRect(i))) { this.setView(TABS[i].view); return; }
    if (inRect(m, this.ddRect())) { this.openDropdown(); return; }
    const sb = this.stateButton();
    if (sb && inRect(m, sb.rect)) { sb.act(); return; }
    if (this.hover >= 0) this.toggle(this.hover);
  }

  private updateDropdown(dt: number, m: { x: number; y: number }, click: boolean, mouse: boolean): void {
    if (input.pressed('cancel') || input.pressed('pause')) {
      this.dd = false;
      sfx('ui_back', { vol: 0.7 });
      return;
    }
    const old = this.ddHi;
    const dn = this.rep.d.update(input.held('uiDown'), dt);
    const rt = this.rep.r.update(input.held('uiRight'), dt);
    const up = this.rep.u.update(input.held('uiUp'), dt);
    const lf = this.rep.l.update(input.held('uiLeft'), dt);
    if (dn || rt || input.pressed('tabNext')) this.ddHi++;
    if (up || lf || input.pressed('tabPrev')) this.ddHi--;
    if (input.wheel) this.ddHi += Math.sign(input.wheel);
    let over = -1;
    for (let f = 1; f <= this.last; f++) if (inRect(m, this.ddItemRect(f))) over = f;
    if (mouse && input.mouseMoved && over > 0) this.ddHi = over;
    this.ddHi = clamp(this.ddHi, 1, this.last);
    if (this.ddHi !== old) sfx('ui_move', { vol: 0.5 });
    const pick = (f: number) => {
      this.dd = false;
      if (f === this.floor) sfx('ui_back', { vol: 0.6 });
      this.setFloor(f);
    };
    if (input.pressed('confirm')) {
      pick(this.ddHi);
      return;
    }
    if (click) {
      if (over > 0) pick(over);
      else if (!inRect(m, this.ddListRect())) {
        // a click outside closes the list without changing anything
        this.dd = false;
        sfx('ui_back', { vol: 0.6 });
      }
    }
  }

  // ---------------------------------------------------------------- draw
  draw(r: Renderer): void {
    r.beginUI();
    const k = this.closing >= 0 ? 1 - clamp(this.closing / 0.16, 0, 1) : appear(this.t, 0.25);
    // over the game-over screen (which stops updating) the dim is deeper: its texts stay out of the way
    r.uiRect(0, 0, UI_W, UI_H, C.void, (this.passUpdate ? 0.8 : 0.92) * k);
    const d = r.dctx;
    d.save();
    d.translate(uiCenterX(), 0);
    const oy = Math.round((1 - k) * 10);
    d.translate(0, oy);
    frame(r, 14, 10, UI_W_BASE - 28, UI_H - 40, 'ornate', { alpha: k });
    this.drawHeader(r, k);
    this.drawToolbar(r, k);
    const ck = k * appear(this.viewT, 0.22);
    this.drawList(r, k, ck);
    this.drawFooter(r, ck);
    if (this.dd) this.drawDropdown(r, k);
    d.restore();
    // key hints only while this screen has the input (the nickname box brings its own)
    if (!touchUiActive() && app.scenes.top === this) this.drawKeys(r, k);
  }

  private drawHeader(r: Renderer, k: number): void {
    r.uiText('랭킹', 34, 22, { size: 24, bold: true, color: C.text, outline: C.ink, alpha: k });
    r.uiText(`스피드런 · 시즌 ${SEASON}`, 94, 33, { size: 10, font: 'small', color: C.textFaint, alpha: k });
    // nickname + change button
    const nb = this.nickRect();
    const name = speedrunName();
    const hot = !touchUiActive() && input.lastDevice === 'mouse' && inRect(this.mouseUI(), nb);
    const shown = name ? fitText(r, name, 150, 12, true) : '아직 없음';
    r.uiText(shown, nb.x - 10, nb.y + 6, { size: 12, bold: !!name, align: 'right', color: name ? C.goldHi : C.textMute, alpha: k });
    r.uiText('랭킹 닉네임', nb.x - 18 - r.measureText(shown, 12, !!name), nb.y + 8, { size: 10, font: 'small', align: 'right', color: C.textFaint, alpha: k });
    frame(r, nb.x, nb.y, nb.w, nb.h, hot ? 'buttonHi' : 'button', { alpha: k });
    r.uiText(name ? '닉네임 바꾸기' : '닉네임 정하기', nb.x + nb.w / 2, nb.y + 6, { size: 12, align: 'center', color: hot ? C.goldHi : C.textDim, alpha: k });
    if (!touchUiActive()) {
      const hotX = input.lastDevice === 'mouse' && inRect(this.mouseUI(), CLOSE);
      frame(r, CLOSE.x, CLOSE.y, CLOSE.w, CLOSE.h, hotX ? 'buttonHi' : 'button', { alpha: k });
      // a pixel ✕ (5x5 art pixels)
      const cx = CLOSE.x + CLOSE.w / 2 - 5;
      const cy = CLOSE.y + CLOSE.h / 2 - 5;
      for (let i = 0; i < 5; i++) {
        r.uiRect(cx + i * 2, cy + i * 2, 2, 2, hotX ? C.goldHi : C.textDim, k);
        r.uiRect(cx + 8 - i * 2, cy + i * 2, 2, 2, hotX ? C.goldHi : C.textDim, k);
      }
    }
  }

  private mouseUI(): { x: number; y: number } {
    const m = app.renderer.displayToUI(input.mouseX, input.mouseY);
    return { x: m.x - uiCenterX(), y: m.y - this.oyNow() };
  }

  private oyNow(): number {
    const k = this.closing >= 0 ? 1 - clamp(this.closing / 0.16, 0, 1) : appear(this.t, 0.25);
    return Math.round((1 - k) * 10);
  }

  private drawToolbar(r: Renderer, k: number): void {
    const pad = input.aimMode === 'pad';
    TABS.forEach((tb, i) => {
      const q = this.tabRect(i);
      const on = tb.view === this.view;
      const off = tb.view === 'online' && !this.online;
      frame(r, q.x, q.y, q.w, q.h, on ? 'buttonHi' : 'button', { alpha: k });
      spriteCentered(r, tb.icon, q.x + 16, q.y + 13, 2, { alpha: k * (on ? 1 : 0.55) });
      r.uiText(tb.label, q.x + 30, q.y + 6, { size: 12, bold: on, color: on ? C.goldHi : off ? C.textFaint : C.textDim, alpha: k });
      if (off) r.uiText('준비 중', q.x + q.w - 8, q.y + 8, { size: 10, font: 'small', align: 'right', color: C.textMute, alpha: k });
    });
    if (!touchUiActive()) {
      const t1 = this.tabRect(TABS.length - 1);
      keyHintRow(r, [[actionLabel(input.bindings, 'inventory', pad), '전환']], t1.x + t1.w + 36, TOOL_Y + 13, { alpha: k * 0.75, pad });
    }
    // floor dropdown
    const b = this.ddRect();
    const focus = this.sel < 0 || this.dd;
    const hot = !touchUiActive() && input.lastDevice === 'mouse' && inRect(this.mouseUI(), b);
    r.uiText('기록 구간', b.x - 10, b.y + 8, { size: 10, font: 'small', align: 'right', color: C.textFaint, alpha: k });
    if (focus && !this.dd) glow(r, b.x + b.w / 2, b.y + b.h / 2, 70, '#ffb050', 0.05 + 0.04 * pulse(this.t, 0.8));
    frame(r, b.x, b.y, b.w, b.h, focus || hot ? 'buttonHi' : 'button', { alpha: k });
    r.uiText(`${this.floor}층까지`, b.x + 12, b.y + 6, { size: 12, bold: true, color: C.goldHi, alpha: k });
    const fx = b.x + 12 + r.measureText(`${this.floor}층까지`, 12, true) + 7;
    r.uiText(fitText(r, floorTitle(this.floor), b.x + b.w - 26 - fx, 10, false, 'small'), fx, b.y + 8, { size: 10, font: 'small', color: C.textDim, alpha: k });
    r.uiSprite('ui_arrow_r', b.x + b.w - 14, b.y + 13, 2, { alpha: k, rot: this.dd ? -Math.PI / 2 : Math.PI / 2 });
    // what the time means
    r.uiSprite('ui_hourglass', L + 6, NOTE_Y + 6, 1, { alpha: k * 0.8 });
    r.uiText(`시간: 1층 시작부터 ${this.floor}층 보스를 쓰러뜨릴 때까지 · 일시정지와 메뉴 시간 제외`, L + 16, NOTE_Y, { size: 10, font: 'small', color: C.textFaint, alpha: k });
    const src = this.view === 'online' ? '플레이어별 최고 기록' : '이 기기의 모든 도전';
    r.uiText(src, R, NOTE_Y, { size: 10, font: 'small', align: 'right', color: C.textMute, alpha: k });
    // column headers
    const hy = HEAD_Y;
    const hc = { size: 10, font: 'small' as const, color: C.textFaint, alpha: k };
    r.uiText('순위', COL.rank, hy, { ...hc, align: 'center' });
    r.uiText('닉네임', COL.name, hy, hc);
    r.uiText('캐릭터', COL.portrait - 10, hy, hc);
    r.uiText('시드', COL.seed, hy, hc);
    r.uiText('시간', COL.time, hy, { ...hc, align: 'right' });
    r.uiRect(L, LIST_Y - 4, R - L, 2, C.rimDark, k);
  }

  private drawList(r: Renderer, k: number, ck: number): void {
    const d = r.dctx;
    const cy = LIST_Y + LIST_H / 2;
    const b = this.board();
    const touch = touchUiActive();
    // states
    if (this.view === 'online' && !this.online) {
      this.drawState(r, ck, 'ui_lantern', '온라인 랭킹 준비 중', '지금은 이 기기의 기록만 표시합니다.', C.textDim);
      return;
    }
    if (b?.state === 'loading') {
      // placeholder rows breathing while the board loads
      for (let i = 0; i < 8; i++) {
        const a = ck * (0.3 + 0.25 * pulse(this.t * 0.9 - i * 0.1, 1)) * (1 - i * 0.1);
        const y = LIST_Y + i * ROW_H;
        frame(r, L, y, R - L, ROW_H - 2, 'button', { alpha: a });
        r.uiRect(COL.rank - 6, y + 10, 12, 6, C.rimDark, a);
        r.uiRect(COL.name, y + 10, 70 + ((i * 37) % 50), 6, C.rimDark, a);
        r.uiRect(COL.char, y + 10, 34, 6, C.rimDark, a);
        r.uiRect(COL.time - 60, y + 10, 60, 6, C.rimDark, a);
      }
      // the hourglass turns over every 0.9 s
      const turn = Math.floor(this.t / 0.9) + ease.inOutCubic(clamp((this.t % 0.9) / 0.3, 0, 1));
      const label = '불러오는 중…';
      const lw = r.measureText(label, 12);
      frame(r, UI_W_BASE / 2 - lw / 2 - 30, cy - 16, lw + 50, 32, 'tooltip', { alpha: ck });
      r.uiSprite('ui_hourglass', UI_W_BASE / 2 - lw / 2 - 12, cy, 2, { alpha: ck, rot: turn * Math.PI });
      r.uiText(label, UI_W_BASE / 2 - lw / 2 + 2, cy - 7, { size: 12, color: C.textDim, alpha: ck });
      return;
    }
    if (b?.state === 'error') {
      this.drawState(r, ck, 'ui_skull', '연결할 수 없어요', touch ? '아래 버튼을 눌러 다시 시도하세요.' : 'Enter로 다시 시도', C.bad);
      return;
    }
    if (!this.rows.length) {
      if (this.view === 'local') {
        const any = deepestFloor((f) => speedrunStore.list(f).length, this.last);
        if (any) this.drawState(r, ck, 'ui_hourglass', `아직 ${this.floor}층까지 깬 기록이 없어요`, `이 기기의 가장 깊은 기록: ${any}층까지`, C.textDim);
        else this.drawState(r, ck, 'ui_hourglass', '아직 기록이 없어요.', '마을 중앙 등불에서 「스피드런 모드」로 출발해 보세요.', C.textDim);
      } else {
        this.drawState(r, ck, 'ui_crown', `아직 ${this.floor}층까지의 온라인 기록이 없어요`, '첫 번째 이름을 올려 보세요.', C.textDim);
      }
      return;
    }
    const hs = this.heights();
    const offs = rowOffsets(hs);
    const total = offs[offs.length - 1];
    const sc = this.scrollS.value;
    d.save();
    d.beginPath();
    d.rect(L - 4, LIST_Y - 2, R - L + 8, LIST_H + 2);
    d.clip();
    for (let i = 0; i < this.rows.length; i++) {
      const y = Math.round(LIST_Y + offs[i] - sc);
      if (y + hs[i] < LIST_Y - 4 || y > LIST_Y + LIST_H) continue;
      const stagger = clamp(ck * 1.5 - Math.min(i, 12) * 0.04, 0, 1);
      this.drawRow(r, this.rows[i], i, y, hs[i] - ROW_H, stagger);
    }
    d.restore();
    // scroll bar + fades at the clipped edges
    if (total > LIST_H + 1) {
      const sx = R + 4;
      r.uiRect(sx, LIST_Y, 3, LIST_H, '#1a1424', k);
      const h = Math.max(16, (LIST_H / total) * LIST_H);
      r.uiRect(sx, LIST_Y + (sc / (total - LIST_H)) * (LIST_H - h), 3, h, C.gold, k);
      if (sc > 2) this.edgeFade(r, LIST_Y - 2, 1, k);
      if (sc < total - LIST_H - 2) this.edgeFade(r, LIST_Y + LIST_H, -1, k);
    }
  }

  /** soft fade where rows run under the list's top / bottom edge (dir 1: top edge) */
  private edgeFade(r: Renderer, y: number, dir: 1 | -1, a: number): void {
    const d = r.dctx;
    const h = 14;
    const y0 = dir === 1 ? y : y - h;
    const g = d.createLinearGradient(0, dir === 1 ? y0 : y0 + h, 0, dir === 1 ? y0 + h : y0);
    g.addColorStop(0, 'rgba(22,15,30,0.95)');
    g.addColorStop(1, 'rgba(22,15,30,0)');
    d.globalAlpha = a;
    d.fillStyle = g;
    d.fillRect(L - 2, y0, R - L + 4, h);
    d.globalAlpha = 1;
  }

  private drawState(r: Renderer, a: number, icon: string, head: string, sub: string, color: string): void {
    const cy = LIST_Y + LIST_H / 2;
    const sb = this.stateButton();
    const top = cy - (sb ? 40 : 28);
    glow(r, UI_W_BASE / 2, top + 8, 60, '#ffb050', 0.05 * a);
    spriteCentered(r, animFrame(icon, this.t), UI_W_BASE / 2, top + 6, fitScale(animFrame(icon, this.t), 26, 2), { alpha: a * 0.9 });
    r.uiText(head, UI_W_BASE / 2, top + 26, { size: 12, bold: true, align: 'center', color, alpha: a });
    r.uiText(sub, UI_W_BASE / 2, top + 44, { size: 10, font: 'small', align: 'center', color: C.textFaint, alpha: a });
    if (sb) {
      const q = sb.rect;
      const hot = input.lastDevice === 'mouse' && inRect(this.mouseUI(), q);
      frame(r, q.x, q.y, q.w, q.h, hot || !touchUiActive() ? 'buttonHi' : 'button', { alpha: a });
      r.uiText(sb.label, q.x + q.w / 2, q.y + 7, { size: 12, align: 'center', color: C.goldHi, alpha: a });
    }
  }

  private drawRow(r: Renderer, row: RankRow, i: number, y: number, expH: number, a: number): void {
    if (a <= 0) return;
    const selected = i === this.sel;
    const h = ROW_H - 2;
    const mid = y + h / 2;
    // breakdown (under the row plate)
    if (expH > 1) this.drawBreakdown(r, row, y + h - 4, expH + 2, a);
    if (selected) frame(r, L, y, R - L, h, 'buttonHi', { alpha: a });
    else if (row.mine) frame(r, L, y, R - L, h, 'tooltip', { color: C.gold, alpha: a });
    else frame(r, L, y, R - L, h, 'button', { alpha: a * (i % 2 ? 0.5 : 0.75) });
    // rank
    const medal = row.rank <= 3 ? MEDAL[row.rank - 1] : null;
    if (medal) {
      this.coin(r, COL.rank, mid, medal, row.rank, a);
    } else {
      r.uiText(String(row.rank), COL.rank, mid - 6, { size: 12, align: 'center', color: C.textDim, alpha: a });
    }
    // name (+ a tag for the viewer's own row)
    const nameColor = row.mine ? C.goldHi : C.text;
    const tag = row.mine ? (this.view === 'local' ? '방금' : '나') : '';
    const tagW = tag ? r.measureText(tag, 10, false, 'small') + 10 : 0;
    const nm = fitText(r, row.name, COL.portrait - 22 - COL.name - (tag ? tagW + 6 : 0), 12, row.mine);
    r.uiText(nm, COL.name, mid - 6, { size: 12, bold: row.mine, color: nameColor, alpha: a });
    if (tag) {
      const tx = Math.round(COL.name + r.measureText(nm, 12, row.mine) + 7);
      const ty = Math.round(mid - 8);
      r.uiRect(tx + 2, ty, tagW - 4, 16, C.ink, a);
      r.uiRect(tx, ty + 2, tagW, 12, C.ink, a);
      r.uiRect(tx + 2, ty + 2, tagW - 4, 12, C.gold, a);
      r.uiRect(tx + 2, ty + 12, tagW - 4, 2, C.goldDark, a);
      r.uiText(tag, tx + tagW / 2, ty + 3, { size: 10, font: 'small', align: 'center', color: C.ink, alpha: a, shadow: false });
    }
    // keeper
    const ch = Characters.get(row.character);
    if (ch) {
      spriteCentered(r, ch.portrait, COL.portrait, mid, 1, { alpha: a });
      r.uiText(fitText(r, ch.name, COL.seed - COL.char - 12, 12), COL.char, mid - 6, { size: 12, color: ch.color, alpha: a });
    } else {
      spriteCentered(r, 'ui_question', COL.portrait, mid, 1, { alpha: a * 0.7 });
      r.uiText(fitText(r, row.character || '?', COL.seed - COL.char - 12, 10, false, 'small'), COL.char, mid - 4, { size: 10, font: 'small', color: C.textFaint, alpha: a });
    }
    // seed
    r.uiText(fitText(r, row.seed, COL.time - 110 - COL.seed, 10, false, 'small'), COL.seed, mid - 4, { size: 10, font: 'small', color: C.textFaint, alpha: a });
    // time
    tabular(r, formatSplit(row.ms), COL.time, mid - 6, { size: 12, bold: row.rank === 1 || selected, color: selected || row.mine ? C.goldHi : medal ?? C.text, alpha: a });
    // expand chevron
    const open = row.key === this.openKey;
    r.uiSprite('ui_arrow_r', R - 12, mid, 1, { alpha: a * (selected || open ? 0.95 : 0.3), rot: open ? -Math.PI / 2 : Math.PI / 2 });
  }

  /** a pixel medal for ranks 1-3 */
  private coin(r: Renderer, cx: number, cy: number, color: string, rank: number, a: number): void {
    const d = r.dctx;
    const disc = (rad: number, c: string, ox = 0, oy = 0) => {
      d.fillStyle = c;
      d.beginPath();
      d.arc(cx + ox, cy + oy, rad, 0, Math.PI * 2);
      d.fill();
    };
    d.globalAlpha = a;
    disc(10, C.ink);
    disc(8.5, mixColor(color, '#000000', 0.45));
    disc(7.5, color, -0.5, -0.5);
    disc(5.5, mixColor(color, '#ffffff', 0.25), -1.5, -1.5);
    disc(5.5, color, -0.5, -0.5);
    d.globalAlpha = 1;
    r.uiText(String(rank), cx, cy - 6, { size: 12, bold: true, align: 'center', color: '#2a1608', alpha: a, shadow: false });
    if (rank === 1) r.uiSprite('ui_crown', cx + 11, cy - 8, 1, { alpha: a });
  }

  private drawBreakdown(r: Renderer, row: RankRow, y: number, h: number, a: number): void {
    const d = r.dctx;
    const x = L + 10;
    const w = R - L - 20;
    d.save();
    d.beginPath();
    d.rect(x - 2, y, w + 4, h);
    d.clip();
    frame(r, x, y, w, EXP_H + 2, 'inset', { alpha: a });
    const top = y + 11;
    // weapon · date · online state
    const wd = Weapons.get(row.weapon);
    let mx = x + 14;
    if (wd) {
      spriteCentered(r, wd.icon, mx + 8, top + 6, 1, { alpha: a });
      mx += 22;
      r.uiText(wd.name, mx, top, { size: 12, color: C.textDim, alpha: a });
      mx += r.measureText(wd.name, 12) + 10;
    }
    const date = dateLabel(row.at);
    if (date) r.uiText(date, mx, top + 2, { size: 10, font: 'small', color: C.textFaint, alpha: a });
    if (row.sent !== undefined) {
      const [txt, col] = row.sent === 1
        ? [row.onlineRank ? `온라인 등록 · 당시 ${row.onlineRank}위` : '온라인 등록', C.good]
        : row.sent === 2 ? ['온라인 랭킹에 오르지 않음', C.textMute]
          : this.online ? ['온라인 전송 대기 중', C.textFaint] : ['이 기기에만 저장됨', C.textFaint];
      r.uiText(txt, x + w - 14, top + 2, { size: 10, font: 'small', align: 'right', color: col, alpha: a });
    }
    // per-floor grid: columns 1..N (N = the ranked floor)
    const cells = breakdown(row.floors, this.floor);
    const labelW = 70;
    const colW = Math.min(88, Math.floor((w - 28 - labelW) / Math.max(1, cells.length)));
    const gx = x + 14 + labelW;
    const hy = top + 22;
    const lines: [string, 'splitMs' | 'segmentMs' | 'bossMs'][] = [['누적', 'splitMs'], ['층 구간', 'segmentMs'], ['보스전', 'bossMs']];
    const last = cells.length - 1;
    r.uiRect(gx + last * colW + 2, hy - 3, colW - 2, 14 * 4 + 2, C.gold, a * 0.08);
    cells.forEach((c, i) => {
      const right = gx + (i + 1) * colW - 8;
      const ranked = i === last;
      const head = `${c.floor}층`;
      r.uiText(head, right, hy, { size: 10, font: 'small', align: 'right', color: ranked ? C.goldHi : C.textFaint, alpha: a });
      r.uiRect(right - r.measureText(head, 10, false, 'small') - 9, hy + 2, 6, 6, FLOOR_TINT[(c.floor - 1) % FLOOR_TINT.length], a * 0.9);
      lines.forEach(([, key], li) => {
        const v = c[key];
        const ly = hy + 14 * (li + 1);
        if (v === null) r.uiText('—', right, ly, { size: 10, font: 'small', align: 'right', color: C.textMute, alpha: a });
        else tabular(r, formatSplit(v), right, ly, { size: 10, font: 'small', color: ranked && li === 0 ? C.goldHi : li === 0 ? C.text : C.textDim, alpha: a });
      });
    });
    lines.forEach(([label], li) => {
      r.uiText(label, x + 14, hy + 14 * (li + 1), { size: 10, font: 'small', color: li === 0 ? C.textDim : C.textFaint, alpha: a });
    });
    // pace bar: each floor's share of the time, its boss fight as the darker tail
    const by = hy + 64;
    const bx = gx + 2;
    const bw = x + w - 14 - 62 - bx;
    r.uiText('층별 비중', x + 14, by - 2, { size: 10, font: 'small', color: C.textFaint, alpha: a });
    r.uiRect(bx - 2, by - 2, bw + 4, 12, C.ink, a);
    r.uiRect(bx, by, bw, 8, '#140f1b', a);
    const segs = cells.filter((c) => c.segmentMs !== null && c.segmentMs > 0);
    const total = segs.reduce((sum, c) => sum + (c.segmentMs ?? 0), 0);
    if (total > 0) {
      let sx = bx;
      segs.forEach((c, i) => {
        const seg = c.segmentMs ?? 0;
        const sw = i === segs.length - 1 ? bx + bw - sx : Math.round((seg / total) * bw);
        if (sw <= 0) return;
        const tint = FLOOR_TINT[(c.floor - 1) % FLOOR_TINT.length];
        r.uiRect(sx, by, sw, 8, tint, a * 0.85);
        r.uiRect(sx, by, sw, 2, mixColor(tint, '#ffffff', 0.35), a * 0.85);
        const boss = Math.min(sw, Math.round(((c.bossMs ?? 0) / seg) * sw));
        if (boss > 0) r.uiRect(sx + sw - boss, by, boss, 8, mixColor(tint, '#000000', 0.45), a);
        if (i > 0) r.uiRect(sx, by - 1, 2, 10, C.ink, a);
        sx += sw;
      });
    }
    // legend: the darker tail
    const lx = bx + bw + 12;
    r.uiRect(lx, by, 8, 8, mixColor(FLOOR_TINT[0], '#000000', 0.45), a);
    r.uiRect(lx - 1, by - 1, 10, 1, C.ink, a);
    r.uiText('보스전', lx + 12, by - 2, { size: 10, font: 'small', color: C.textFaint, alpha: a });
    d.restore();
  }

  private drawFooter(r: Renderer, a: number): void {
    const y = FOOT_Y;
    r.uiRect(L, y - 6, R - L, 2, C.rimDark, a * 0.8);
    let left = '';
    let color: string = C.textDim;
    if (this.view === 'local') {
      if (!this.online) {
        left = '온라인 랭킹 준비 중 · 이 기기의 기록만 표시합니다';
        color = C.info;
      } else if (this.rows.length) left = `이 기기 기록 ${this.rows.length}개 · 최고 ${formatSplit(this.rows[0].ms)}`;
    } else {
      const b = this.board();
      if (b?.state === 'ok') {
        const me = this.rows.find((x) => x.mine);
        const name = speedrunName();
        if (me) { left = `내 순위 ${me.rank}위 · ${formatSplit(me.ms)}`; color = C.goldHi; }
        else if (name) left = `${name}님의 ${this.floor}층까지 기록은 아직 순위에 없어요`;
        else left = '닉네임을 정하면 기록이 랭킹에 올라가요';
      }
    }
    if (left) r.uiText(left, L + 4, y, { size: 10, font: 'small', color, alpha: a });
    if (this.rows.length) {
      const hint = touchUiActive() ? '줄을 누르면 층별 시간 · 끌어서 스크롤' : `${this.view === 'online' ? `상위 ${this.rows.length}명 · ` : ''}줄을 고르면 층별 시간`;
      r.uiText(hint, R - 4, y, { size: 10, font: 'small', align: 'right', color: C.textMute, alpha: a });
    }
  }

  private drawDropdown(r: Renderer, k: number): void {
    const a = k * appear(this.ddT, 0.14);
    // everything else steps back while the list is open
    r.uiRect(16, TOOL_Y + TOOL_H + 2, UI_W_BASE - 32, UI_H - 44 - TOOL_Y - TOOL_H, C.void, 0.45 * a);
    const l = this.ddListRect();
    const dy = Math.round((1 - a) * -6);
    frame(r, l.x, l.y + dy, l.w, l.h, 'panelHi', { alpha: a });
    for (let f = 1; f <= this.last; f++) {
      const q = this.ddItemRect(f);
      const y = q.y + dy;
      const hi = f === this.ddHi;
      const cur = f === this.floor;
      if (hi) frame(r, q.x, y, q.w, q.h, 'buttonHi', { alpha: a });
      if (cur) r.uiSprite('ui_check', q.x + 13, y + q.h / 2, 2, { alpha: a });
      r.uiText(`${f}층까지`, q.x + 28, y + 7, { size: 12, bold: cur || hi, color: hi ? C.goldHi : cur ? C.text : C.textDim, alpha: a });
      r.uiText(floorTitle(f), q.x + 28 + r.measureText(`${f}층까지`, 12, cur || hi) + 8, y + 9, { size: 10, font: 'small', color: C.textFaint, alpha: a });
      const best = speedrunStore.best(f);
      if (best) tabular(r, formatSplit(best.splitMs), q.x + q.w - 10, y + 9, { size: 10, font: 'small', color: hi ? C.goldHi : C.textDim, alpha: a });
      else r.uiText('기록 없음', q.x + q.w - 10, y + 9, { size: 10, font: 'small', align: 'right', color: C.textMute, alpha: a });
    }
    r.uiText('1층부터 이 층 보스까지', l.x + 33, l.y + dy + 8, { size: 10, font: 'small', color: C.textFaint, alpha: a });
    r.uiText('이 기기 최고', l.x + l.w - 15, l.y + dy + 8, { size: 10, font: 'small', align: 'right', color: C.textFaint, alpha: a });
    r.uiRect(l.x + 10, l.y + dy + DD_HEAD + 3, l.w - 20, 2, C.rimDark, a);
  }

  private drawKeys(r: Renderer, k: number): void {
    const pad = input.aimMode === 'pad';
    const hints: [string, string][] = this.dd
      ? [['↑↓', '구간 고르기'], [actionLabel(input.bindings, 'confirm', pad), '결정'], [actionLabel(input.bindings, 'cancel', pad), '닫기']]
      : [
        ['↑↓', '선택'],
        [actionLabel(input.bindings, 'confirm', pad), this.sel >= 0 ? '층별 시간' : this.stateButton()?.label ?? '구간 목록'],
        [pad ? 'LB/RB' : '←→', '구간'],
        [actionLabel(input.bindings, 'inventory', pad), '전체/내 기록'],
        [actionLabel(input.bindings, 'special', pad), '닉네임'],
        [actionLabel(input.bindings, 'cancel', pad), '닫기'],
      ];
    keyHintRow(r, hints, UI_W / 2, UI_H - 15, { alpha: k * 0.8, pad });
  }
}
