import type { Scene, TouchButtonSpec } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_W, UI_H } from '../engine/renderer';
import { input } from '../engine/input';
import { app } from '../game/app';
import { frame } from './frame';
import { C } from './theme';
import type { StoryEvent } from '../game/story';
import { DialoguePlayback } from '../game/dialogue';
import { townPortrait, keeperPortrait, preloadTownPortraits, RESIDENTS } from './town-portraits';
import { animFrame } from '../engine/sprites';
import { Characters } from '../game/defs';
import { save } from '../engine/save';
import { sfx } from '../audio/audio';

export class StoryOverlay implements Scene {
  transparent = true;
  private playback: DialoguePlayback;
  private delay = 0;
  private age = 0;
  constructor(private event: StoryEvent, private done: () => void) { this.playback = new DialoguePlayback(event); }
  enter(): void { preloadTownPortraits(); input.releaseAll(); sfx('ui_open', { vol: .45 }); }
  private next(): void {
    if (this.delay < .15) return;
    this.delay = 0;
    const action = this.playback.advance();
    if (action === 'end') { app.scenes.pop(); input.releaseAll(); this.done(); sfx('ui_close', { vol: .4 }); }
    else if (action === 'line') sfx('ui_move', { vol: .35 });
  }
  update(dt: number): void {
    this.delay += dt; this.age += dt; this.playback.update(dt);
    const m = app.renderer.displayToUI(input.mouseX, input.mouseY);
    if (input.pressed('confirm') || input.pressed('interact') || input.pressed('fire') && Math.abs(m.x - UI_W / 2) < 352 && m.y > UI_H - 192) this.next();
  }
  touchButtons(): TouchButtonSpec[] { return [{ x: UI_W / 2 - 352, y: UI_H - 192, w: 704, h: 174, tap: () => this.next(), ghost: true }]; }
  draw(r: Renderer): void {
    const line = this.playback.line; if (!line) return;
    const npc = RESIDENTS.findIndex(n => line.who.startsWith(n.name));
    const speaker = npc >= 0 ? RESIDENTS[npc] : null;
    const accent = speaker?.accent ?? C.gold;
    const entrance = Math.max(0, 1 - this.age / .22);
    const x = UI_W / 2 - 352, y = UI_H - 192 + Math.round(entrance * entrance * 12);
    r.beginUI(); r.uiRect(0, 0, UI_W, UI_H, '#06040c', .34 * (1 - entrance));
    frame(r, x, y, 704, 174, 'panel');
    r.uiRect(x + 164, y + 20, 2, 119, accent, .5);
    frame(r, x + 12, y - 20, 140, 164, 'inset');
    r.uiRect(x + 18, y - 14, 128, 152, '#14101f');
    const ctx = r.dctx;
    if (npc >= 0) {
      const blink = (this.age + npc * .8) % 4.3 > 4.12;
      const talking = !this.playback.complete && Math.floor(this.age * 7) % 2 === 0;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(townPortrait(npc, blink, talking), x + 18, y - 6, 128, 144);
    } else {
      const ch = line.who === '니엘' ? Characters.get('niel') : line.who === '등불지기' ? Characters.get(save.progress.campaign?.character ?? 'ria') : null;
      const portrait=ch?keeperPortrait(ch.id,this.age%4.3>4.12,!this.playback.complete&&Math.floor(this.age*7)%2===0):null;
      if(portrait){ctx.imageSmoothingEnabled=false;ctx.drawImage(portrait,x+18,y-6,128,144);}
      else if (ch) r.uiSprite(animFrame(`${ch.spritePrefix}_idle_down`, this.age), x + 82, y + 116, 5);
      else {
        r.uiSprite(animFrame('ui_lantern', this.age), x + 82, y + 63, 4);
        r.uiText(line.who === '기록' ? '되찾은 기억' : '희미한 목소리', x + 82, y + 112, { size: 10, color: C.textDim, align: 'center' });
      }
    }
    r.uiText(this.event.title, x + 182, y - 20, { size: 10, color: C.textDim, outline: C.ink });
    r.uiText(speaker?.name ?? line.who, x + 182, y + 17, { size: 19, color: accent });
    if (speaker) r.uiText(speaker.role, x + 267, y + 23, { size: 10, color: C.textDim });
    // Wrap before revealing so previously displayed text never shifts to another row.
    const lines = r.wrapText(line.text, 492, 14);
    let available = this.playback.revealed;
    for (let i = 0; i < lines.length; i++) {
      const chars = Array.from(lines[i]);
      r.uiText(chars.slice(0, Math.max(0, available)).join(''), x + 182, y + 55 + i * 21, { size: 14, color: C.text });
      available -= chars.length;
    }
    for (let i = 0; i < this.event.lines.length; i++) r.uiRect(x + 184 + i * 9, y + 151, 4, 4, i === this.playback.index ? accent : C.rim);
    const hint = this.playback.complete ? (this.playback.index === this.event.lines.length - 1 ? '대화 마치기' : '다음 이야기') : '한 번 눌러 전체 보기';
    r.uiText('Enter / G · ' + hint, x + 666, y + 148, { size: 10, align: 'right', color: C.textDim });
    if (this.playback.complete) r.uiText('▼', x + 681, y + 146 + Math.round(Math.sin(this.age * 4) * 2), { size: 10, align: 'center', color: accent });
  }
}
