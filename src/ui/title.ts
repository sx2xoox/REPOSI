// Title screen: animated stairwell backdrop, glowing pixel logo, main menu
// (새 게임 / 시드 입력 / 도감 / 설정 / 크레딧), custom-seed entry modal, run
// record line and version text. Character select lives in charselect.ts.

import type { Scene, TouchButtonSpec } from './scene';
import { softKeyboard, touchUiActive } from './touch-mode';
import { fullscreenSupported, iosBrowserTab, isFullscreen, toggleFullscreen } from './fullscreen';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import { Menu, applyTyped } from './widgets';
import { app } from '../game/app';
import { input } from '../engine/input';
import { audio, sfx } from '../audio/audio';
import { SettingsOverlay } from './settings';
import { save } from '../engine/save';
import { clamp, ease } from '../engine/math';
import { backdrop } from './backdrop';
import { drawLogo } from './logo';
import { C, VERSION, formatTime } from './theme';
import { divider, frame, glow, keyHintRow } from './frame';
import { CharacterSelectScene } from './charselect';
import { CollectionScene } from './collection';
import { CreditsScene } from './credits';
import { LobbyScene, consumeRoomLink } from './lobby';
import { Characters } from '../game/defs';
import { appear } from './anim';

export { CharacterSelectScene } from './charselect';

export class TitleScene implements Scene {
  private menu: Menu;
  private t = 0;
  private chrome = 0;
  private seedOpen = false;
  private seedT = 0;
  private seed = '';
  private linkChecked = false;

  /** touch: ✕ closes the seed box */
  get touchBack(): 'close' | false {
    return this.seedOpen ? 'close' : false;
  }

  touchButtons(): TouchButtonSpec[] {
    if (this.seedOpen) {
      // inside the seed box (where the key hints are on desktop)
      const y = UI_H / 2 - 60 + 80;
      return [
        // tapping the text box (re)opens the phone keyboard
        { x: UI_W / 2 - 116, y: UI_H / 2 - 18, w: 232, h: 30, tap: () => softKeyboard.request(), ghost: true },
        { x: UI_W / 2 - 116, y, w: 108, h: 28, label: '취소', tap: 'cancel' },
        { x: UI_W / 2 + 8, y, w: 108, h: 28, label: '시작', tap: 'confirm', primary: true },
      ];
    }
    if (app.scenes.top !== this) return [];
    if (fullscreenSupported() && !isFullscreen()) {
      const sa = app.renderer.uiSafe;
      return [{ x: UI_W - 44 - sa.r, y: 10 + sa.t, w: 34, h: 30, icon: 'tc_full', tap: () => toggleFullscreen() }];
    }
    return [];
  }

  constructor() {
    this.menu = new Menu([
      { label: '새 게임', action: () => app.scenes.set(new CharacterSelectScene()), hint: '무작위 시드로 새로운 하강을 시작합니다.' },
      { label: '함께하기', action: () => app.scenes.set(new LobbyScene()), hint: '시험 운영: 최대 4명이 같은 시드로 각자 플레이합니다. 협동 전투는 준비 중입니다.' },
      { label: '시드 입력', action: () => this.openSeed(), hint: '같은 시드는 같은 던전을 만듭니다. (기록에는 남지 않음)' },
      { label: '도감', action: () => app.scenes.push(new CollectionScene()), hint: '발견한 유물과 마주친 적들의 기록.' },
      { label: '설정', action: () => app.scenes.push(new SettingsOverlay({ fromTitle: true })), hint: '소리, 화면, 조작 설정.' },
      { label: '크레딧', action: () => app.scenes.push(new CreditsScene()), hint: '등불지기를 만든 사람들.' },
    ], UI_W / 2, 226, { width: 196, size: 13, lineH: 25, hintY: 382 });
    const last = save.history[0]?.character;
    const ch = (last && Characters.get(last)) || Characters.all()[0];
    if (ch) backdrop().keeper = ch.spritePrefix;
    installUiDebug(this);
  }

  enter(): void {
    audio.playMusic('title');
    backdrop().setDim(0);
  }

  openSeed(): void {
    this.seedOpen = true;
    this.seedT = 0;
    this.seed = '';
    input.textCapture = true;
    input.releaseAll();
    sfx('ui_open');
    if (touchUiActive()) softKeyboard.open('', (v) => { this.seed = v; });
  }

  private closeSeed(): void {
    this.seedOpen = false;
    softKeyboard.close();
    input.textCapture = false;
    input.releaseAll();
  }

  private isTop(): boolean {
    return app.scenes.top === this;
  }

  update(dt: number): void {
    if (!this.linkChecked) {
      // a co-op share link (?room=CODE) opens the join box directly
      this.linkChecked = true;
      const code = consumeRoomLink();
      if (code) {
        app.scenes.set(new LobbyScene({ join: code }));
        return;
      }
    }
    this.t += dt;
    const bd = backdrop();
    bd.update(dt);
    const top = this.isTop();
    this.chrome = clamp(this.chrome + (top ? dt * 3 : -dt * 5), 0, 1);
    if (top) bd.setDim(this.seedOpen ? 0.5 : 0);
    if (!top) return;
    if (this.seedOpen) {
      this.seedT += dt;
      const typed = input.typed;
      this.seed = applyTyped(this.seed, typed);
      if (typed.length) sfx('ui_move', { vol: 0.5, pitch: 1.2 });
      if (input.pressed('cancel') && !typed.includes('\b')) {
        sfx('ui_back');
        this.closeSeed();
        return;
      }
      if (input.pressed('confirm') && !typed.includes(' ')) {
        sfx('ui_select');
        const seed = this.seed;
        this.closeSeed();
        app.scenes.set(new CharacterSelectScene(seed || undefined));
      }
      return;
    }
    this.menu.update(app.renderer, dt);
  }

  draw(r: Renderer): void {
    r.beginWorld('#05030a');
    backdrop().draw(r);
    r.presentWorld();
    r.beginUI();
    const a = ease.inOutQuad(this.chrome);
    if (a <= 0.01) return;
    // logo
    const intro = appear(this.t, 1.2, 0.1);
    const ly = 34 - (1 - intro) * 12;
    const { h } = drawLogo(r, UI_W / 2 + 8, ly, this.t, { alpha: a * intro, scale: 4 });
    const sub = appear(this.t, 0.8, 0.6);
    r.uiText('L A N T E R N K E E P E R', UI_W / 2, ly + h + 4, { size: 10, font: 'small', align: 'center', color: '#c8a070', alpha: a * sub });
    divider(r, UI_W / 2 - 132, ly + h + 9, 70, C.goldDark, a * sub);
    divider(r, UI_W / 2 + 132, ly + h + 9, 70, C.goldDark, a * sub);
    r.uiText('— 꺼져가는 등불을 들고, 아래로 —', UI_W / 2, ly + h + 22, { size: 10, font: 'small', align: 'center', color: C.textFaint, alpha: a * sub });

    // menu backing: soft darkness pooled over the abyss
    const mA = a * appear(this.t, 0.6, 0.5);
    const d = r.dctx;
    d.save();
    const grd = d.createRadialGradient(UI_W / 2, 296, 10, UI_W / 2, 296, 150);
    grd.addColorStop(0, 'rgba(5,3,10,0.8)');
    grd.addColorStop(1, 'rgba(5,3,10,0)');
    d.globalAlpha = mA;
    d.fillStyle = grd;
    d.fillRect(UI_W / 2 - 200, 150, 400, 300);
    d.restore();
    if (this.t > 0.5) this.menu.draw(r, mA);

    // footer
    const p = save.progress;
    const rec = p.runs > 0
      ? `하강 ${p.runs}회 · 귀환 ${p.wins}회 · 최고 ${p.bestFloor}층${p.bestTimeSec ? ` · 최단 ${formatTime(p.bestTimeSec)}` : ''}`
      : '첫 하강을 기다리는 중';
    const sa = r.uiSafe;
    r.uiText(rec, 12 + sa.l, UI_H - 16 - sa.b, { size: 10, font: 'small', color: C.textFaint, alpha: mA });
    r.uiText(VERSION, UI_W - 12 - sa.r, UI_H - 16 - sa.b, { size: 10, font: 'small', align: 'right', color: C.textMute, alpha: mA });
    // iPhone Safari has no fullscreen API: point to the home-screen app (fullscreen, no browser bars)
    if (iosBrowserTab()) r.uiText('공유 버튼 → 홈 화면에 추가하면 주소창 없이 전체 화면으로 즐길 수 있어요', UI_W / 2, 6 + sa.t, { size: 10, font: 'small', align: 'center', color: C.textFaint, alpha: mA * 0.9 });
    if (!this.seedOpen && !touchUiActive()) keyHintRow(r, [['↑↓', '선택'], ['Enter', '결정']], UI_W / 2, UI_H - 10, { alpha: mA * 0.8, pad: input.aimMode === 'pad' });

    if (this.seedOpen) this.drawSeed(r);
  }

  private drawSeed(r: Renderer): void {
    const k = appear(this.seedT, 0.25, 0, ease.outBack);
    const w = 300;
    const h = 120;
    const x = UI_W / 2 - w / 2;
    const y = UI_H / 2 - h / 2 + (1 - k) * 16;
    r.uiRect(0, 0, UI_W, UI_H, C.void, 0.5 * clamp(this.seedT / 0.2, 0, 1));
    frame(r, x, y, w, h, 'ornate', { alpha: clamp(k, 0, 1) });
    r.uiText('시드 입력', UI_W / 2, y + 14, { size: 16, bold: true, align: 'center', color: C.goldHi });
    const bx = x + 34;
    const bw = w - 68;
    frame(r, bx, y + 42, bw, 30, 'inset');
    const shown = this.seed || '';
    r.uiText(shown, UI_W / 2, y + 50, { size: 16, align: 'center', color: C.text });
    const touchUi = touchUiActive();
    if (!shown) r.uiText(touchUi ? '눌러서 입력 · 비우면 무작위' : '비워두면 무작위', UI_W / 2, y + 51, { size: 12, align: 'center', color: C.textMute });
    const caretX = UI_W / 2 + r.measureText(shown, 16) / 2 + 2;
    if (Math.floor(this.seedT * 2.2) % 2 === 0 && shown) r.uiRect(caretX, y + 49, 2, 16, C.goldHi);
    if (!touchUi) keyHintRow(r, [['Enter', '시작'], ['Esc', '취소']], UI_W / 2, y + h - 22);
    glow(r, UI_W / 2, y + 57, 90, '#ffb050', 0.06);
  }
}

// ---------------------------------------------------------------- debug hooks (screenshots / automation)
interface UiDebug {
  openSeed(): void;
  openCollection(): void;
  openCredits(): void;
  openSettings(): void;
  openCharSelect(): void;
  seedCollection(): void;
}

function installUiDebug(title: TitleScene): void {
  if (typeof window === 'undefined') return;
  const api: UiDebug = {
    openSeed: () => title.openSeed(),
    openCollection: () => app.scenes.push(new CollectionScene()),
    openCredits: () => app.scenes.push(new CreditsScene()),
    openSettings: () => app.scenes.push(new SettingsOverlay({ fromTitle: true })),
    openCharSelect: () => app.scenes.set(new CharacterSelectScene()),
    seedCollection: () => {
      // mark a sample of content as discovered (debug only)
      void import('../game/defs').then(({ Artifacts, Enemies, Weapons, Actives }) => {
        const pick = <T extends { id: string }>(arr: T[], k: number) => arr.filter((_, i) => i % k === 0).map((d) => d.id);
        for (const id of [...pick(Artifacts.all(), 2), ...pick(Weapons.all(), 2), ...pick(Actives.all(), 1)]) save.markSeenItem(id);
        for (const id of pick(Enemies.all(), 2)) save.markSeenEnemy(id);
      });
    },
  };
  (window as unknown as { __lkui: UiDebug }).__lkui = api;
}
