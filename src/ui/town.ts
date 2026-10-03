import type { Scene, TouchButtonSpec } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_W, UI_H } from '../engine/renderer';
import { input } from '../engine/input';
import { save } from '../engine/save';
import { app } from '../game/app';
import { Characters } from '../game/defs';
import { randomSeedString } from '../engine/rng';
import { animFrame } from '../engine/sprites';
import { audio } from '../audio/audio';
import { Menu } from './widgets';
import { frame, glow } from './frame';
import { C } from './theme';
import { townArt, residentArt } from './town-art';
import { StoryOverlay } from './story';
import { INTRO, RETURNS, BOSS_STORIES } from '../game/story';
import { CharacterSelectScene } from './charselect';
import { CollectionScene } from './collection';
import { LobbyScene } from './lobby';

const ZONES = [
  { x: 384, y: 170, title: '중앙 등불', sub: '원정 출발', color: '#dfaf62' },
  { x: 155, y: 230, title: '등불지기의 집', sub: '캐릭터 준비', color: '#b6997a' },
  { x: 598, y: 210, title: '귀환 기록실', sub: '기억 · 도감', color: '#82adac' },
  { x: 560, y: 320, title: '동행의 부두', sub: '협동 방 만들기 · 참가', color: '#829cce' },
];

export class TownScene implements Scene {
  private x = 365; private y = 290; private t = 0;
  private menu: Menu | null = null;
  private checked = false;
  touchBack = 'back' as const;
  constructor(private join?: string) {}
  enter(): void { audio.playMusic('title'); input.releaseAll(); }
  private get c() { return save.progress.campaign!; }
  private story(): boolean {
    const id = !this.c.seen.includes('intro') ? 'intro' : this.c.pending ? `return:${this.c.pending}` : '';
    if (!id) return false;
    const floor = this.c.pending;
    app.scenes.push(new StoryOverlay(id === 'intro' ? INTRO : RETURNS[floor], () => {
      if (!this.c.seen.includes(id)) this.c.seen.push(id);
      if (id !== 'intro') this.c.pending = 0;
      save.saveProgress();
    })); return true;
  }
  private launch(): void {
    const cp = this.c.checkpoint;
    app.startRun(cp?.seed ?? randomSeedString(), cp?.character ?? this.c.character);
  }
  private resident(i: number): void {
    const names = ['나래', '도윤', '은서'];
    const memories = this.c.cleared >= 7
      ? ['불빛이 늘었다고 밤이 모두 같아지는 건 아니더라. 네가 돌아올 자리만은 비워 둘게.', '다리 경첩을 두 번 손봤어. 이번에는 어느 종에 돌아오든 열리도록.', '두 권의 장부를 나란히 두었어. 빈집의 문패 주인을 찾으면, 양쪽에 이름을 써 줄 거야.']
      : this.c.cleared >= 4
        ? ['난 분명 도윤의 말을 듣고 문을 닫았어. 그런데 그가 내민 열쇠에는 열라고 적혀 있더라.', '나래가 건너오는 걸 봤어. 그런데 나래는 내가 먼저 돌아갔다고 해. 기억 속 손이 너무 선명해서 더 무섭다.', '두 사람이 같은 말을 하게 만드는 건 해답이 아니야. 다른 말을 하게 된 이유를 찾아야지.']
        : ['여기 등불은 돌아오는 발소리에 밝아져. 심지를 찾으면 어떤 길이 이어지는지 알 수 있을 거야.', '출발 전엔 손에 익는 무기를 골라. 길에서 발견한 유물 때문에 쓰는 방식이 바뀔 수도 있어.', '같은 이야기를 두 사람이 다르게 하면, 나는 둘 다 적어 둬. 어느 쪽이 빠진 조각인지 아직 모르니까.'];
    app.scenes.push(new StoryOverlay({ title: '등불터의 사람들', lines: [{ who: names[i], text: memories[i] }] }, () => {}));
  }
  private zone(i: number): void {
    if (this.story()) return;
    input.releaseAll();
    if (i === 0) {
      const cp = this.c.checkpoint;
      this.menu = new Menu([
        { label: cp ? `${cp.floor}-${cp.stage} 원정 이어가기` : `1-1부터 ${Math.min(7, Math.max(4, this.c.cleared + 1))}-4까지 출발`, action: () => this.launch(), hint: cp ? '중단한 원정만 보관한 장비로 스테이지 입구에서 이어갑니다.' : '새 장비로 출발합니다. 목표 층 보스를 잡으면 마을로 귀환합니다.' },
        { label: '마을 둘러보기', action: () => { this.menu = null; } },
      ], UI_W / 2, 330, { width: 440, lineH: 27, hintY: 401 });
    } else if (i === 1) {
      if (this.c.checkpoint) {
        this.menu = new Menu([{ label: '현재 원정의 등불지기는 장비와 함께 보관됩니다', disabled: true }, { label: '돌아가기', action: () => { this.menu = null; } }], UI_W / 2, 335, { width: 520, size: 12 });
      } else app.scenes.set(new CharacterSelectScene(undefined, id => { this.c.character = id; save.saveProgress(); app.goTown(); }));
    } else if (i === 2) {
      this.menu = new Menu([
        { label: '유물 · 무기 도감', action: () => app.scenes.push(new CollectionScene()) },
        { label: '되찾은 기억 읽기', action: () => {
          this.menu = new Menu(this.c.seen.map(id => ({ label: id === 'intro' ? INTRO.title : (id.startsWith('return:') ? RETURNS : BOSS_STORIES)[Number(id.split(':')[1])]?.title ?? id, action: () => {
            const e = id === 'intro' ? INTRO : (id.startsWith('return:') ? RETURNS : BOSS_STORIES)[Number(id.split(':')[1])];
            if (e) app.scenes.push(new StoryOverlay(e, () => {}));
          } })), UI_W / 2, 316, { width: 440, maxRows: 3, lineH: 26, size: 12 });
        } },
        { label: '돌아가기', action: () => { this.menu = null; } },
      ], UI_W / 2, 316, { width: 440, lineH: 26 });
    } else app.scenes.set(new LobbyScene());
  }
  update(dt: number): void {
    this.t += dt;
    if (!this.checked) { this.checked = true; if (this.join) { app.scenes.set(new LobbyScene({ join: this.join })); return; } if (this.story()) return; }
    if (input.pressed('cancel')) { if (this.menu) this.menu = null; else app.goTitle(); return; }
    if (this.menu) { this.menu.update(app.renderer, dt); return; }
    const dx = Number(input.held('right') || input.held('uiRight')) - Number(input.held('left') || input.held('uiLeft'));
    const dy = Number(input.held('down') || input.held('uiDown')) - Number(input.held('up') || input.held('uiUp'));
    const n = Math.hypot(dx, dy) || 1;
    this.x = Math.max(80, Math.min(688, this.x + dx / n * dt * 155)); this.y = Math.max(130, Math.min(355, this.y + dy / n * dt * 155));
    if (input.pressed('confirm') || input.pressed('interact')) {
      const resident = [[294, 233], [194, 262], [642, 260]].findIndex(([x, y]) => Math.hypot(x - this.x, y - this.y) < 30);
      if (resident >= 0) { this.resident(resident); return; }
      const nearest = ZONES.map((z, i) => ({ i, d: Math.hypot(z.x - this.x, z.y - this.y) })).sort((a, b) => a.d - b.d)[0];
      if (nearest.d < 100) this.zone(nearest.i);
    }
    if (input.pressed('fire')) {
      const p = app.renderer.displayToUI(input.mouseX, input.mouseY); const ox = (UI_W - 768) / 2;
      const resident = [[294, 233], [194, 262], [642, 260]].findIndex(([x, y]) => Math.abs(p.x - ox - x) < 16 && Math.abs(p.y - y + 8) < 24);
      if (resident >= 0) { this.resident(resident); return; }
      ZONES.forEach((z, i) => { if (Math.abs(p.x - ox - z.x) < 84 && Math.abs(p.y - z.y) < 38) { this.x = z.x; this.y = z.y + 45; this.zone(i); } });
    }
  }
  touchButtons(): TouchButtonSpec[] {
    if (this.menu) return [];
    return [
      ...[[294, 233], [194, 262], [642, 260]].map(([x, y], i) => ({ x: (UI_W - 768) / 2 + x - 16, y: y - 32, w: 32, h: 48, ghost: true, tap: () => this.resident(i) })),
      ...ZONES.map((z, i) => ({ x: (UI_W - 768) / 2 + z.x - 84, y: z.y - 38, w: 168, h: 76, ghost: true, tap: () => { this.x = z.x; this.y = z.y + 45; this.zone(i); } })),
    ];
  }
  draw(r: Renderer): void {
    const light = Math.max(0, this.c.cleared - 3) / 4;
    r.beginWorld('#0b151c'); r.presentWorld(); r.beginUI();
    const ox = (UI_W - 768) / 2;
    r.uiRect(0, 0, UI_W, UI_H, light > 0 ? '#172b32' : '#101c26');
    r.dctx.imageSmoothingEnabled = false;
    r.dctx.drawImage(townArt(), ox, 0, 768, 432);
    r.uiRect(ox, 0, 768, 432, '#071122', 0.12 * (1 - light));
    // Gentle canal glints, chimney smoke and embers use scene time only.
    const ctx = r.dctx;
    ctx.save();
    for (let i = 0; i < 16; i++) {
      const x = 30 + (i * 47) % 705, y = 391 + (i * 7) % 32;
      r.uiRect(ox + x + Math.sin(this.t * .65 + i) * 4, y, 5 + i % 7, 1, '#739b9c', .12 + .12 * Math.sin(this.t + i));
    }
    for (const [cx, cy] of [[185, 91], [300, 51], [632, 67]]) {
      for (let j = 0; j < 4; j++) {
        const age = (this.t * 7 + j * 9) % 38;
        r.uiRect(ox + cx + Math.sin(age * .1 + j) * 5, cy - age, 4 + age * .18, 3 + age * .09, '#a3aaa0', .15 * (1 - age / 38));
      }
    }
    ctx.restore();
    for (const [x, y] of [[114, 180], [568, 156], [627, 157]]) glow(r, ox + x, y, 34, '#e5a662', .1 + light * .08);
    // Residents remain in the square between their one-time conversations.
    for (const [i, x, y, name] of [[0, 294, 233, '나래'], [1, 194, 262, '도윤'], [2, 642, 260, '은서']] as const) {
      r.dctx.drawImage(residentArt(i), ox + x - 16, y - 40, 32, 48);
      r.uiText(name, ox + x, y + 12, { size: 9, align: 'center', color: C.textDim, outline: C.ink });
    }
    for (let i = 0; i <= Math.max(0, this.c.cleared - 3); i++) {
      const x = [384, 230, 525, 115, 657][i], y = [174, 286, 276, 340, 340][i];
      glow(r, ox + x, y, i === 0 ? 115 : 63, '#f0b566', 0.18 + light * 0.1);
      r.uiSprite(animFrame('ui_lantern', this.t + i), ox + x, y, 2);
    }
    ZONES.forEach(z => {
      const near = Math.hypot(this.x - z.x, this.y - z.y) < 100;
      r.uiText(z.title, ox + z.x, z.y + 26, { size: 11, align: 'center', color: near ? '#f5d79b' : '#b5c3b8', outline: '#101e29' });
      if (near && !this.menu) r.uiText('G · ' + z.sub, ox + z.x, z.y + 41, { size: 9, align: 'center', color: '#d4c3a0', outline: '#101e29' });
    });
    const ch = Characters.get(this.c.checkpoint?.character ?? this.c.character) ?? Characters.all()[0];
    r.uiSprite(animFrame(`${ch.spritePrefix}_idle_down`, this.t), ox + this.x, this.y, 2);
    r.uiRect(0, 0, UI_W, 71, '#0b1722', .72);
    r.uiRect(28, 22, 2, 30, '#b8985f');
    r.uiText('마지막 등불터', 40, 19, { size: 19, color: C.goldHi });
    const cp = this.c.checkpoint;
    const objective = this.c.cleared >= 7 ? '1-1부터 7-4 · 서로 다른 밤의 기록을 모으자' : `1-1부터 ${Math.max(4, this.c.cleared + 1)}-4 · ${this.c.cleared >= 4 ? '새 기록을 찾아 귀환하기' : '성소의 기록을 찾아 귀환하기'}`;
    r.uiText(objective, 40, 47, { size: 10, color: C.textDim });
    r.uiText(`${save.slots[save.activeSlot]?.name ?? ''}${cp ? ` · 보관된 원정 ${cp.floor}-${cp.stage}` : ''}`, UI_W - 28, 28, { size: 11, align: 'right', color: C.textDim });
    r.uiRect(0, UI_H - 25, UI_W, 25, '#091621', .8);
    r.uiText('방향키 / WASD 이동 · Enter / G 대화 · 건물 클릭으로 이용 · Esc 타이틀', UI_W / 2, UI_H - 16, { size: 10, align: 'center', color: C.textFaint });
    if (this.menu) { frame(r, UI_W / 2 - 284, 297, 568, 116, 'panel'); this.menu.draw(r); }
  }
}
