// Credits: slow scroll over the stairwell with the logo, sections and a
// closing line. Hold confirm / down to speed up, Esc to leave.

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import { app } from '../game/app';
import { input } from '../engine/input';
import { sfx } from '../audio/audio';
import { clamp } from '../engine/math';
import { C, VERSION } from './theme';
import { divider, keyHintRow } from './frame';
import { drawLogo } from './logo';
import { appear } from './anim';

type Line = { kind: 'logo' } | { kind: 'head'; text: string } | { kind: 'name'; text: string; sub?: string } | { kind: 'gap'; h: number } | { kind: 'note'; text: string };

const LINES: Line[] = [
  { kind: 'logo' },
  { kind: 'gap', h: 20 },
  { kind: 'note', text: '꺼져가는 마을의 등불을 되살리기 위한 하강' },
  { kind: 'gap', h: 40 },
  { kind: 'head', text: '기획 · 프로그래밍' },
  { kind: 'name', text: '등불지기 제작팀' },
  { kind: 'gap', h: 26 },
  { kind: 'head', text: '도트 그래픽' },
  { kind: 'name', text: '등불지기 제작팀', sub: '모든 그림은 코드로 한 점씩 찍었습니다' },
  { kind: 'gap', h: 26 },
  { kind: 'head', text: '음악 · 효과음' },
  { kind: 'name', text: '등불지기 제작팀', sub: 'Web Audio 신시사이저로 실시간 합성' },
  { kind: 'gap', h: 26 },
  { kind: 'head', text: '글꼴' },
  { kind: 'name', text: 'Galmuri', sub: '이민서 (quiple) · SIL Open Font License 1.1' },
  { kind: 'gap', h: 26 },
  { kind: 'head', text: '도구' },
  { kind: 'name', text: 'TypeScript · Vite · Canvas 2D', sub: 'Vitest · Playwright' },
  { kind: 'gap', h: 26 },
  { kind: 'head', text: '함께 하강한 이들' },
  { kind: 'name', text: '리아 · 베른 · 세린 · 니엘' },
  { kind: 'name', text: '그리고 어둠 속의 모든 것들' },
  { kind: 'gap', h: 50 },
  { kind: 'note', text: '플레이해 주셔서 감사합니다.' },
  { kind: 'gap', h: 12 },
  { kind: 'note', text: VERSION },
];

function lineHeight(l: Line): number {
  switch (l.kind) {
    case 'logo': return 70;
    case 'head': return 22;
    case 'name': return l.sub ? 34 : 20;
    case 'gap': return l.h;
    case 'note': return 18;
  }
}

export class CreditsScene implements Scene {
  transparent = true;
  passUpdate = true;
  private t = 0;
  private y = 0;
  private closing = -1;
  private total = LINES.reduce((s, l) => s + lineHeight(l), 0);

  enter(): void {
    sfx('ui_open', { vol: 0.5 });
    input.releaseAll();
  }

  update(dt: number): void {
    this.t += dt;
    if (this.closing >= 0) {
      this.closing += dt;
      if (this.closing > 0.2) app.scenes.remove(this);
      return;
    }
    if (input.pressed('cancel') || input.pressed('pause')) {
      sfx('ui_back');
      this.closing = 0;
      return;
    }
    const fast = input.held('confirm') || input.held('uiDown') || input.held('fire');
    const back = input.held('uiUp');
    this.y += dt * (back ? -60 : fast ? 90 : 22);
    const maxY = this.total + UI_H * 0.25;
    this.y = clamp(this.y, -40, maxY);
  }

  draw(r: Renderer): void {
    r.beginUI();
    const k = this.closing >= 0 ? 1 - clamp(this.closing / 0.2, 0, 1) : appear(this.t, 0.4);
    r.uiRect(0, 0, UI_W, UI_H, C.void, 0.6 * k);
    let y = UI_H * 0.62 - this.y;
    for (const l of LINES) {
      const h = lineHeight(l);
      if (y > -80 && y < UI_H + 20) {
        // fade near the top & bottom edges
        const edge = clamp(Math.min(y - 20, UI_H - 40 - y) / 60, 0, 1);
        const a = k * edge;
        switch (l.kind) {
          case 'logo':
            drawLogo(r, UI_W / 2 + 8, y, this.t, { alpha: a, scale: 4 });
            break;
          case 'head':
            r.uiText(l.text, UI_W / 2, y, { size: 12, align: 'center', color: C.gold, alpha: a });
            divider(r, UI_W / 2, y + 17, 120, C.goldDark, a * 0.8);
            break;
          case 'name':
            r.uiText(l.text, UI_W / 2, y, { size: 16, bold: true, align: 'center', color: C.text, alpha: a });
            if (l.sub) r.uiText(l.sub, UI_W / 2, y + 19, { size: 10, font: 'small', align: 'center', color: C.textFaint, alpha: a });
            break;
          case 'note':
            r.uiText(l.text, UI_W / 2, y, { size: 12, align: 'center', color: C.textDim, alpha: a });
            break;
          default:
            break;
        }
      }
      y += h;
    }
    keyHintRow(r, [['Enter', '빨리 감기'], ['Esc', '닫기']], UI_W / 2, UI_H - 14, { alpha: k * 0.7 });
  }
}
