// Settings overlay (volume, screen shake, display, accessibility).

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import { Menu, pct } from './widgets';
import { input } from '../engine/input';
import { app } from '../game/app';
import { save } from '../engine/save';
import { clamp } from '../engine/math';
import { audio, sfx } from '../audio/audio';

export class SettingsOverlay implements Scene {
  transparent = true;
  private menu: Menu;

  constructor() {
    const s = save.settings;
    const step = (k: 'masterVolume' | 'musicVolume' | 'sfxVolume' | 'screenShake' | 'particles', min: number, max: number) => (d: number) => {
      s[k] = clamp(Math.round((s[k] + d * 0.1) * 10) / 10, min, max);
      app.applySettings();
      save.saveSettings();
    };
    const toggle = (k: 'pixelPerfect' | 'damageNumbers' | 'showFps' | 'hitStop') => () => {
      s[k] = !s[k];
      app.applySettings();
      save.saveSettings();
    };
    const onoff = (v: boolean) => (v ? '켜짐' : '꺼짐');
    this.menu = new Menu([
      { label: () => `전체 음량  ◀ ${pct(s.masterVolume)} ▶`, adjust: step('masterVolume', 0, 1) },
      { label: () => `음악  ◀ ${pct(s.musicVolume)} ▶`, adjust: step('musicVolume', 0, 1) },
      { label: () => `효과음  ◀ ${pct(s.sfxVolume)} ▶`, adjust: step('sfxVolume', 0, 1) },
      { label: () => `화면 흔들림  ◀ ${pct(s.screenShake)} ▶`, adjust: step('screenShake', 0, 1.5) },
      { label: () => `파티클 양  ◀ ${pct(s.particles)} ▶`, adjust: step('particles', 0.3, 1) },
      { label: () => `역경직 (히트스톱)  ${onoff(s.hitStop)}`, adjust: toggle('hitStop'), action: toggle('hitStop') },
      { label: () => `데미지 숫자  ${onoff(s.damageNumbers)}`, adjust: toggle('damageNumbers'), action: toggle('damageNumbers') },
      { label: () => `정수배 픽셀  ${onoff(s.pixelPerfect)}`, adjust: toggle('pixelPerfect'), action: toggle('pixelPerfect') },
      { label: () => `FPS 표시  ${onoff(s.showFps)}`, adjust: toggle('showFps'), action: toggle('showFps') },
      { label: '돌아가기', action: () => this.close() },
    ], UI_W / 2, 110, { width: 360, lineH: 26, size: 13 });
  }

  private close(): void {
    sfx('ui_back');
    audio.applyVolumes();
    app.scenes.remove(this);
    input.releaseAll();
  }

  update(): void {
    if (input.pressed('cancel') || input.pressed('pause')) {
      this.close();
      return;
    }
    this.menu.update(app.renderer);
  }

  draw(r: Renderer): void {
    r.beginUI();
    r.uiRect(0, 0, UI_W, UI_H, '#05030a', 0.8);
    r.uiText('설정', UI_W / 2, 60, { size: 24, align: 'center', bold: true, color: '#f8e8c8' });
    this.menu.draw(r);
  }
}
