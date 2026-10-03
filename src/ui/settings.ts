// Settings overlay: audio / display / gameplay options with sliders and
// toggles, progress reset (double confirm), and a full controls reference for
// keyboard + mouse and gamepad. Used from the title and from the pause menu.

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import { Menu, pct, type MenuItem } from './widgets';
import { input } from '../engine/input';
import { app } from '../game/app';
import { save } from '../engine/save';
import { clamp } from '../engine/math';
import { audio, sfx } from '../audio/audio';
import { C } from './theme';
import { fitScale, frame, keycap } from './frame';
import { appear } from './anim';
import { CONTROL_ROWS, PAD_NAMES, controlKeys, touchControlRows } from './keys';
import { touchUiActive } from './touch-mode';
import { applyGraphics } from './quality';
import { QUALITY_LABEL, QUALITY_ORDER, TOUCH_SCHEMES, TOUCH_SCHEME_LABEL, touchScheme } from './touch-logic';
import { isFullscreen, toggleFullscreen, fullscreenSupported } from './fullscreen';
import { FRAME_CAPS, effectiveMaxFps, type TouchControlsMode } from '../engine/save';

const TOUCH_LABEL: Record<TouchControlsMode, string> = { auto: '자동', on: '항상', off: '끄기' };
const TOUCH_ORDER: TouchControlsMode[] = ['auto', 'on', 'off'];

function cycle<T>(order: T[], cur: T, d: number): T {
  const i = Math.max(0, order.indexOf(cur));
  return order[(i + d + order.length) % order.length];
}



type NumKey = 'masterVolume' | 'musicVolume' | 'sfxVolume' | 'screenShake' | 'screenFlash' | 'teammateProjectileOpacity' | 'particles';
type BoolKey = 'pixelPerfect' | 'damageNumbers' | 'showFps' | 'hitStop';

export class SettingsOverlay implements Scene {
  transparent = true;
  passUpdate: boolean;
  private menu: Menu;
  private t = 0;
  private closing = -1;
  private resetStage = 0;
  private touch: boolean;
  touchBack = 'close' as const;

  constructor(o: { fromTitle?: boolean } = {}) {
    this.touch = touchUiActive();
    this.passUpdate = !!o.fromTitle;
    const s = save.settings;
    s.screenFlash ??= 1;
    s.teammateProjectileOpacity ??= 0.5;
    const step = (k: NumKey, min: number, max: number, inc = 0.1) => (d: number) => {
      s[k] = clamp(Math.round(((s[k] ?? 1) + d * inc) * 100) / 100, min, max);
      app.applySettings();
      if (k === 'particles') applyGraphics();
      save.saveSettings();
      if (k === 'sfxVolume' || k === 'masterVolume') sfx('coin', { vol: 0.5 });
    };
    const toggle = (k: BoolKey) => () => {
      s[k] = !s[k];
      app.applySettings();
      save.saveSettings();
    };
    const slider = (label: string, k: NumKey, min: number, max: number, hint: string, inc = 0.1): MenuItem => ({
      label, adjust: step(k, min, max, inc), value: () => ((s[k] ?? 1) - min) / (max - min), valueText: () => pct(s[k] ?? 1), hint,
      setValue: (f) => {
        s[k] = clamp(Math.round((min + f * (max - min)) / inc) * inc, min, max);
        s[k] = Math.round(s[k] * 100) / 100;
        app.applySettings();
        if (k === 'particles') applyGraphics();
        save.saveSettings();
      },
    });
    const choice = <T,>(label: string, order: T[], get: () => T, set: (v: T) => void, text: (v: T) => string, hint: string): MenuItem => ({
      label, hint, valueText: () => text(get()),
      adjust: (d) => {
        set(cycle(order, get(), d));
        save.saveSettings();
      },
    });
    const sw = (label: string, k: BoolKey, hint: string): MenuItem => ({ label, adjust: toggle(k), action: toggle(k), toggle: () => s[k], hint });
    this.menu = new Menu([
      { label: '소리', header: true },
      slider('전체 음량', 'masterVolume', 0, 1, '모든 소리의 크기.'),
      slider('음악', 'musicVolume', 0, 1, '배경 음악의 크기.'),
      slider('효과음', 'sfxVolume', 0, 1, '공격, 피격, 아이템 등 효과음의 크기.'),
      { label: '화면', header: true },
      slider('화면 흔들림', 'screenShake', 0, 1.5, '폭발과 피격 시 화면 흔들림 강도.'),
      slider('화면 섬광', 'screenFlash', 0, 1, '피격·해방 시 화면 전체가 번쩍이는 강도. 공격 예고 표시는 유지됩니다.'),
      slider('팀원 투사체 불투명도', 'teammateProjectileOpacity', 0, 1, '팀원 탄환과 탄환 빛의 표시 농도. 0% 숨김 · 100% 선명. 내 탄환과 적 탄환은 그대로입니다.'),
      slider('파티클 양', 'particles', 0.3, 1, '파편, 불꽃 등 입자 효과의 양. 낮추면 가벼워집니다.'),
      choice('그래픽 품질', QUALITY_ORDER, () => s.graphicsQuality, (v) => { s.graphicsQuality = v; applyGraphics(); }, (v) => QUALITY_LABEL[v],
        '해상도와 파티클 양. 휴대폰에서 끊기거나 뜨거워지면 낮추세요.'),
      choice('최대 프레임', FRAME_CAPS, () => effectiveMaxFps(s), (v) => { s.maxFps = v; }, (v) => (v === 0 ? '디스플레이 최대' : `${v}`),
        '초당 화면을 그리는 최대 횟수. 낮추면 배터리를 아낍니다.'),
      sw('정수배 픽셀', 'pixelPerfect', '픽셀을 정수배로만 확대해 가장 선명하게 보여줍니다.'),
      sw('FPS 표시', 'showFps', '오른쪽 아래에 프레임 수를 표시합니다.'),
      { label: '게임플레이', header: true },
      sw('역경직 (히트스톱)', 'hitStop', '강한 타격 순간 화면이 잠깐 멈춰 타격감을 살립니다.'),
      sw('데미지 숫자', 'damageNumbers', '적에게 준 피해량을 숫자로 띄웁니다.'),
      { label: '조작', header: true },
      choice('터치 조작', TOUCH_ORDER, () => s.touchControls ?? 'auto', (v) => { s.touchControls = v; }, (v) => TOUCH_LABEL[v],
        '화면 조이스틱과 버튼. 자동: 터치하면 나타나고 키보드·마우스를 쓰면 숨깁니다.'),
      choice('터치 조작 방식', TOUCH_SCHEMES, () => touchScheme(s.touchScheme), (v) => { s.touchScheme = v; }, (v) => TOUCH_SCHEME_LABEL[v],
        '자동 조준: 공격 버튼을 누르면 가까운 적을 자동으로 노리고, 끌면 직접 조준합니다. 듀얼 스틱: 오른쪽 스틱으로 조준·사격.'),
      ...(fullscreenSupported() ? [{
        label: '전체 화면', toggle: () => isFullscreen(), action: () => toggleFullscreen(), adjust: () => toggleFullscreen(),
        hint: '브라우저 주소창을 숨기고 화면 전체를 씁니다.',
      } as MenuItem] : []),
      { label: '기록', header: true },
      {
        label: () => (this.resetStage === 0 ? '모든 기록 초기화' : this.resetStage === 1 ? '정말 지울까요? (한 번 더)' : '초기화 완료'),
        danger: true,
        hint: '도감, 해금, 기록과 설정을 모두 지웁니다. 되돌릴 수 없습니다.',
        action: () => this.reset(),
      },
      { label: '돌아가기', action: () => this.close() },
    ], 196, 74, { width: 300, lineH: this.touch ? 24 : 19, size: 12, align: 'left', hintY: UI_H - 44, maxRows: this.touch ? 12 : 16 });
  }

  enter(): void {
    sfx('ui_open', { vol: 0.6 });
    input.releaseAll();
  }

  private reset(): void {
    if (this.resetStage === 0) {
      this.resetStage = 1;
      sfx('warn', { vol: 0.5 });
      return;
    }
    if (this.resetStage === 1) {
      save.resetAll();
      app.applySettings();
      audio.applyVolumes();
      this.resetStage = 2;
      sfx('explosion', { vol: 0.4 });
    }
  }

  private close(): void {
    if (this.closing >= 0) return;
    sfx('ui_back');
    audio.applyVolumes();
    this.closing = 0;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.closing >= 0) {
      this.closing += dt;
      if (this.closing > 0.14) {
        app.scenes.remove(this);
        input.releaseAll();
      }
      return;
    }
    if (input.pressed('cancel') || input.pressed('pause')) {
      this.close();
      return;
    }
    if (this.resetStage === 1 && this.menu.index !== this.menu.items.length - 2) this.resetStage = 0;
    this.menu.update(app.renderer, dt);
  }

  draw(r: Renderer): void {
    r.beginUI();
    const k = this.closing >= 0 ? 1 - clamp(this.closing / 0.14, 0, 1) : appear(this.t, 0.22);
    r.uiRect(0, 0, UI_W, UI_H, C.void, 0.72 * k);
    const W = 700;
    const H = 404;
    const x = UI_W / 2 - W / 2;
    const y = UI_H / 2 - H / 2 + (1 - k) * 12;
    frame(r, x, y, W, H, 'ornate', { alpha: k });
    r.uiText('설정', x + 24, y + 14, { size: 24, bold: true, color: C.text, outline: C.ink, alpha: k });
    if (!this.touch) r.uiText('Esc  닫기', x + W - 22, y + 22, { size: 10, font: 'small', align: 'right', color: C.textFaint, alpha: k });
    this.menu.y = y + 56;
    this.menu.x = x + 24 + 150;
    this.menu.hintY = y + H - 26;
    this.menu.draw(r, k);
    // controls reference
    const cx = x + 360;
    const cy = y + 54;
    frame(r, cx, cy, W - 384, 270, 'inset', { alpha: k });
    if (this.touch) {
      r.uiText('터치 조작', cx + 14, cy + 10, { size: 12, bold: true, color: C.goldHi, alpha: k });
      touchControlRows().forEach(([icon, label, desc], i) => {
        const ry = cy + 38 + i * Math.min(25, 222 / Math.max(1, touchControlRows().length - 1));
        if (icon) r.uiSprite(icon, cx + 24, ry, fitScale(icon, 18, 2), { alpha: k });
        else r.uiRect(cx + 18, ry - 6, 12, 12, C.rim, k * 0.6);
        r.uiText(label, cx + 42, ry - 7, { size: 12, color: C.text, alpha: k });
        if (desc) r.uiText(desc, cx + W - 384 - 14, ry - 6, { size: 10, font: 'small', align: 'right', color: C.textDim, alpha: k });
      });
      return;
    }
    r.uiText('조작키', cx + 14, cy + 10, { size: 12, bold: true, color: C.goldHi, alpha: k });
    r.uiSprite('ui_gamepad', cx + W - 384 - 64, cy + 16, 2, { alpha: k * 0.9 });
    r.uiText('패드', cx + W - 384 - 40, cy + 10, { size: 10, font: 'small', color: C.textFaint, alpha: k });
    CONTROL_ROWS.forEach((row, i) => {
      const ry = cy + 36 + i * Math.min(22, 222 / Math.max(1, CONTROL_ROWS.length - 1));
      r.uiText(row.label, cx + 14, ry - 6, { size: 12, color: C.textDim, alpha: k });
      const keys = controlKeys(input.bindings, row.actions);
      r.uiText(keys, cx + 112, ry - 6, { size: 10, font: 'small', color: C.text, alpha: k });
      const pad = row.padLabel ?? PAD_NAMES[row.actions[0]] ?? '';
      if (pad) keycap(r, pad, cx + W - 384 - 14, ry, { align: 'right', alpha: k, pad: true });
    });
  }
}
