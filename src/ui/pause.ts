// Pause menu (Esc): resume / settings / quit (with confirm), plus a run card
// (keeper, floor, time, kills, seed, collected items) and a controls reference.
// Speedrun: the card shows the run clock (m:ss.cc) and a strip of the floor
// splits so far (floors 1..7, the current one highlighted).
// Online co-op: the world keeps running behind it; 계속 / 설정 / 방 나가기, and
// for the host 하강 종료 (ends the run for everyone, a lockstep command).

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W, UI_W_BASE, uiCenterX } from '../engine/renderer';
import type { GameScene } from './game-scene';
import { Menu } from './widgets';
import { input } from '../engine/input';
import { app } from '../game/app';
import { SettingsOverlay } from './settings';
import { sfx } from '../audio/audio';
import { Actives, Weapons } from '../game/defs';
import { clamp } from '../engine/math';
import { animFrame, hasAnim } from '../engine/sprites';
import { C, formatSplit, formatTime, splitFloorName } from './theme';
import { ticksToMs } from '../game/speedrun';
import { lastFloorIndex } from '../game/defs';
import { speedrunStore } from '../engine/speedrun-store';
import { divider, fitScale, frame, glow, keycap, spriteCentered } from './frame';
import { appear } from './anim';
import { CONTROL_ROWS, PAD_NAMES, controlKeys, touchControlRows } from './keys';
import { save } from '../engine/save';
import { storyObjective } from '../game/story';
import { StoryOverlay } from './story';
import { touchUiActive } from './touch-mode';
import { AbandonExpeditionOverlay } from './abandon-expedition';

export class PauseOverlay implements Scene {
  transparent = true;
  touchBack = 'close' as const;
  private menu: Menu;
  private game: GameScene;
  private t = 0;
  private confirmQuit = false;
  private confirmEnd = false;
  private closing = -1;
  /** speedrun: this device's best clear time of the current floor (ms), read once */
  private floorBest: number | null = null;

  constructor(game: GameScene) {
    this.game = game;
    if (game.run.speedrun) this.floorBest = speedrunStore.best(game.run.floor)?.splitMs ?? null;
    if (game.online) {
      const host = !!game.net?.isHost;
      const items: ConstructorParameters<typeof Menu>[0] = [
        { label: '계속', action: () => this.close(), hint: '하강을 이어갑니다.' },
        { label: '설정', action: () => app.scenes.push(new SettingsOverlay()), hint: '소리, 화면, 조작 설정.' },
        {
          label: () => (this.confirmQuit ? '정말 나갈까요?' : '방 나가기'),
          danger: true,
          action: () => this.quit(),
          hint: () => (this.confirmQuit ? '한 번 더 누르면 방에서 나갑니다.' : host ? '방을 닫고 타이틀로 갑니다.' : '방에서 나가 타이틀로 갑니다.'),
        },
      ];
      if (host) {
        items.splice(2, 0, {
          label: () => (this.confirmEnd ? '정말 끝낼까요?' : '하강 종료'),
          danger: true,
          action: () => this.endForAll(),
          hint: () => (this.confirmEnd ? '한 번 더 누르면 모두 결과 화면으로.' : '모두의 하강을 여기서 끝냅니다.'),
        });
      }
      this.menu = new Menu(items, 150, 150, { width: 220, lineH: 30, size: 14, hintY: 262 });
      return;
    }
    this.menu = new Menu([
      { label: '계속하기', action: () => this.close(), hint: '하강을 이어갑니다.' },
      ...(game.run.campaign ? [{ label: '현재 목표', hint: '이번 원정에서 해야 할 일을 확인합니다.', action: () => {
        const objective=storyObjective(save.progress.campaign!);
        app.scenes.push(new StoryOverlay({title:objective.title,lines:[{who:'기록',text:objective.detail},{who:'기록',text:'각 층의 세 번째 구역에 보스가 있다. 방을 정리하고 열린 통로를 따라 진행하자. 발견한 기록은 마을 기록실에서 다시 읽을 수 있다.'}]},()=>{}));
      } }] : []),
      { label: '설정', action: () => app.scenes.push(new SettingsOverlay()), hint: '소리, 화면, 조작 설정.' },
      game.run.speedrun ? { label: '스피드런 포기', danger: true, hint: '지금까지의 층 기록은 남기고 마을로 돌아갑니다.', action: () => {
        app.scenes.push(new AbandonExpeditionOverlay(() => app.goTown(), 'speedrun'));
      } } : { label: '원정 포기', danger: true, hint: '이번 원정의 장비와 중간 저장을 버립니다.', action: () => {
        app.scenes.push(new AbandonExpeditionOverlay(() => {
          if (game.run.campaign) { save.abandonExpedition(); app.goTown(); }
          else app.goTitle();
        }, game.run.campaign ? 'town' : 'title'));
      } },
      ...(game.run.campaign ? [{
        label: '저장하고 마을로',
        action: () => this.quit(),
        hint: '현재 스테이지 입구의 상태부터 다시 이어집니다.',
      }] : []),
    ], 150, 150, { width: 220, lineH: 30, size: 14, hintY: 262 });
  }

  enter(): void {
    sfx('ui_open');
  }

  private close(): void {
    if (this.closing >= 0) return;
    sfx('ui_close');
    this.closing = 0;
  }

  private quit(): void {
    if (this.game.run.campaign) { app.goTown(); return; }
    if (!this.confirmQuit) {
      this.confirmQuit = true;
      sfx('warn', { vol: 0.4 });
      return;
    }
    if (this.game.online) this.game.leaveOnline('title');
    else app.goTitle();
  }

  /** Co-op host: end the run for everyone (a lockstep command; the summary follows). */
  private endForAll(): void {
    if (!this.confirmEnd) {
      this.confirmEnd = true;
      sfx('warn', { vol: 0.4 });
      return;
    }
    this.game.command({ type: 'end' });
    this.close();
  }

  update(dt: number): void {
    this.t += dt;
    if (this.closing >= 0) {
      this.closing += dt;
      if (this.closing > 0.14) this.game.closeOverlay(this);
      return;
    }
    if (input.pressed('pause') || input.pressed('cancel')) {
      this.close();
      return;
    }
    const quitIndex = this.menu.items.length - 1;
    if (this.confirmQuit && this.menu.index !== quitIndex) this.confirmQuit = false;
    if (this.confirmEnd && this.menu.index !== 2) this.confirmEnd = false;
    this.menu.update(app.renderer, dt);
  }

  draw(r: Renderer): void {
    r.beginUI();
    const k = this.closing >= 0 ? 1 - clamp(this.closing / 0.14, 0, 1) : appear(this.t, 0.2);
    r.uiRect(0, 0, UI_W, UI_H, C.void, 0.74 * k);
    const w = this.game.world;
    const run = this.game.run;
    const p = w.player;
    // ---- left: title + menu
    const ox = uiCenterX(); // 768-wide layout centered on wide screens
    const lx = ox + 30;
    const ly = 60 + (1 - k) * 10;
    const extra = Math.max(0, this.menu.items.length - 3) * 30;
    frame(r, lx, ly, 240, 236 + extra, 'ornate', { alpha: k });
    r.uiText(this.game.online ? '메뉴' : '일시정지', lx + 120, ly + 16, { size: 24, bold: true, align: 'center', color: C.text, outline: C.ink, alpha: k });
    divider(r, lx + 120, ly + 52, 180, C.goldDark, k);
    this.menu.x = lx + 120;
    this.menu.y = ly + 78;
    this.menu.hintY = ly + 186 + extra;
    this.menu.draw(r, k);
    if (this.game.online) r.uiText('함께하는 중에는 게임이 멈추지 않아요', lx + 120, ly + 212 + extra, { size: 10, font: 'small', align: 'center', color: C.textFaint, alpha: k });

    // ---- right: run card
    const rx = ox + 290;
    const ry = 24 + (1 - k) * 10;
    const rw = UI_W_BASE - 30 - 290;
    frame(r, rx, ry, rw, 196, 'panel', { alpha: k });
    const ch = p.character;
    frame(r, rx + 14, ry + 14, 64, 64, 'slot', { alpha: k });
    glow(r, rx + 46, ry + 46, 40, ch.color, 0.15 * k);
    const idle = hasAnim(`${ch.spritePrefix}_idle_down`) ? animFrame(`${ch.spritePrefix}_idle_down`, this.t) : ch.portrait;
    spriteCentered(r, idle, rx + 46, ry + 46, 2.5, { alpha: k });
    r.uiText(ch.name, rx + 90, ry + 16, { size: 16, bold: true, color: ch.color, alpha: k });
    r.uiText(ch.title, rx + 90, ry + 36, { size: 10, font: 'small', color: C.textFaint, alpha: k });
    const [no, fname] = splitFloorName(w.floor.name);
    const sr = run.speedrun;
    const facts: [string, string, string][] = [
      ['ui_door', '층', `${no} ${fname}`],
      sr ? ['ui_hourglass', '기록', formatSplit(ticksToMs(sr.ticks))] : ['ui_hourglass', '시간', formatTime(run.stats.timeSec)],
      ['ui_swords', '처치', `${run.stats.kills}`],
      ['ui_flame', '해방', `${run.stats.releases}회`],
    ];
    facts.forEach(([icon, label, val], i) => {
      const fx = rx + 90 + (i % 2) * 170;
      const fy = ry + 54 + Math.floor(i / 2) * 18;
      r.uiSprite(icon, fx + 6, fy + 6, 1.5, { alpha: k });
      r.uiText(label, fx + 16, fy, { size: 10, font: 'small', color: C.textFaint, alpha: k });
      r.uiText(val, fx + 46, fy, { size: 10, font: 'small', color: C.text, alpha: k });
    });
    r.uiText(`시드  ${run.seed}${run.seeded ? '  (지정)' : ''}`, rx + rw - 14 - (touchUiActive() ? 40 : 0), ry + 18, { size: 10, font: 'small', align: 'right', color: C.textMute, alpha: k });
    // collected items row
    const items: string[] = [];
    const wdef = Weapons.get(p.weaponId);
    if (wdef) items.push(wdef.icon);
    const w2 = p.weapon2Id ? Weapons.get(p.weapon2Id) : undefined;
    if (w2) items.push(w2.icon);
    const act = p.activeId ? Actives.get(p.activeId) : undefined;
    if (act) items.push(act.icon);
    for (const a of w.items.computed?.artifacts ?? []) items.push(a.def.icon);
    const gear = (wdef ? 1 : 0) + (w2 ? 1 : 0) + (act ? 1 : 0);
    if (sr) {
      // speedrun: the floor splits so far, then the items in two rows beside their label
      this.drawSplitStrip(r, rx, ry + 92, rw, k);
      const iy = ry + 144;
      r.uiText('지닌 것', rx + 14, iy, { size: 10, font: 'small', color: C.gold, alpha: k });
      const perRow = Math.floor((rw - 76) / 24);
      items.slice(0, perRow * 2).forEach((icon, i) => {
        const cx = rx + 74 + (i % perRow) * 24;
        const cy = iy + 6 + Math.floor(i / perRow) * 24;
        frame(r, cx - 11, cy - 11, 22, 22, i < gear ? 'slotHi' : 'slot', { alpha: k });
        spriteCentered(r, icon, cx, cy, fitScale(icon, 18, 1), { alpha: k });
      });
      if (items.length > perRow * 2) r.uiText(`+${items.length - perRow * 2}`, rx + 14, iy + 24, { size: 10, font: 'small', color: C.textDim, alpha: k });
    } else {
      const iy = ry + 100;
      r.uiText('지닌 것', rx + 14, iy, { size: 10, font: 'small', color: C.gold, alpha: k });
      const perRow = Math.floor((rw - 28) / 24);
      items.slice(0, perRow * 3).forEach((icon, i) => {
        const cx = rx + 26 + (i % perRow) * 24;
        const cy = iy + 24 + Math.floor(i / perRow) * 24;
        frame(r, cx - 11, cy - 11, 22, 22, i < gear ? 'slotHi' : 'slot', { alpha: k });
        spriteCentered(r, icon, cx, cy, fitScale(icon, 18, 1), { alpha: k });
      });
      if (items.length > perRow * 3) r.uiText(`+${items.length - perRow * 3}`, rx + rw - 14, iy, { size: 10, font: 'small', align: 'right', color: C.textDim, alpha: k });
    }

    // ---- controls
    const cy0 = ry + 204;
    frame(r, rx, cy0, rw, UI_H - 24 - cy0, 'panel', { alpha: k });
    r.uiText('조작법', rx + 14, cy0 + 10, { size: 10, font: 'small', color: C.gold, alpha: k });
    const pad = input.aimMode === 'pad';
    const colW = (rw - 28) / 2;
    if (touchUiActive()) {
      touchControlRows().forEach(([icon, label, desc], i) => {
        const cx = rx + 14 + (i % 2) * colW;
        const cyy = cy0 + 34 + Math.floor(i / 2) * 26;
        if (icon) r.uiSprite(icon, cx + 8, cyy, fitScale(icon, 15, 1.5), { alpha: k });
        r.uiText(label, cx + 22, cyy - 6, { size: 10, font: 'small', color: C.text, alpha: k });
        if (desc) r.uiText(desc, cx + 22 + r.measureText(label, 10, false, 'small') + 6, cyy - 6, { size: 10, font: 'small', color: C.textFaint, alpha: k });
      });
      return;
    }
    CONTROL_ROWS.forEach((row, i) => {
      const cx = rx + 14 + (i % 2) * colW;
      const cyy = cy0 + 34 + Math.floor(i / 2) * 22;
      const keys = pad ? row.padLabel ?? PAD_NAMES[row.actions[0]] ?? '' : controlKeys(input.bindings, row.actions).split(' / ')[0];
      const kw = keycap(r, keys, cx, cyy, { align: 'left', alpha: k, pad });
      r.uiText(row.label, cx + kw + 6, cyy - 6, { size: 10, font: 'small', color: C.textDim, alpha: k });
    });
  }

  /**
   * Speedrun: one cell per floor (1..last) with the clear time of floors 1..N, gold for a new
   * personal best; the current floor highlighted, floors ahead dashed out.
   */
  private drawSplitStrip(r: Renderer, x: number, y: number, w: number, k: number): void {
    const run = this.game.run;
    const sr = run.speedrun;
    if (!sr) return;
    const last = lastFloorIndex();
    const boss = sr.bossStartTick >= 0;
    const cur = sr.has(run.floor) ? run.floor + 1 : run.floor;
    const pbs = new Set(this.game.hud.splitNotices.filter((e) => e.n.personalBest).map((e) => e.n.floor));
    r.uiText('구간 기록', x + 14, y, { size: 10, font: 'small', color: C.gold, alpha: k });
    if (this.floorBest !== null && !sr.has(run.floor)) {
      r.uiText(`${run.floor}층 최고 ${formatSplit(this.floorBest)}`, x + w - 14, y, { size: 10, font: 'small', align: 'right', color: C.textFaint, alpha: k });
    }
    const gap = 4;
    const cw = Math.floor((w - 28 - gap * (last - 1)) / last);
    const x0 = x + 14 + Math.floor((w - 28 - (cw * last + gap * (last - 1))) / 2);
    const cy = y + 13;
    const ch = 32;
    for (let f = 1; f <= last; f++) {
      const cx = x0 + (f - 1) * (cw + gap);
      const split = sr.splits.find((s) => s.floor === f);
      const now = !split && f === cur;
      frame(r, cx, cy, cw, ch, now ? 'slotHi' : 'slot', { alpha: k * (split || now ? 1 : 0.55) });
      r.uiText(`${f}층`, cx + cw / 2, cy + 5, { align: 'center', size: 10, font: 'small', color: now ? C.goldHi : split ? C.textDim : C.textMute, alpha: k });
      if (split && pbs.has(f)) r.uiSprite('ui_crown', cx + cw - 11, cy + 9, 1, { alpha: k });
      const v = split ? formatSplit(ticksToMs(split.splitTicks)) : now ? (boss ? '보스전' : '진행 중') : '—';
      const col = split ? (pbs.has(f) ? C.goldHi : C.text) : now ? (boss ? '#ff9aa0' : C.emberHi) : C.textMute;
      r.uiText(v, cx + cw / 2, cy + 17, { size: 10, font: 'small', align: 'center', color: col, alpha: k });
    }
  }
}
