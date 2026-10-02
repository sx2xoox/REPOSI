// Death / victory screen: dying (or blazing) lantern title, cause of death with
// the killer's sprite, run summary with counting numbers, every item carried
// (staggered pop-in), seed & time, and retry / same seed / title.

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import type { GameScene } from './game-scene';
import type { GameOverInfo } from '../game/world';
import { Menu } from './widgets';
import { app } from '../game/app';
import { randomSeedString } from '../engine/rng';
import { clamp, ease } from '../engine/math';
import { Actives, Enemies, Weapons, lastFloorIndex } from '../game/defs';
import { animFrame, hasAnim, hasSprite } from '../engine/sprites';
import { sfx } from '../audio/audio';
import { C, formatTime, splitFloorName } from './theme';
import { divider, fitScale, frame, glow, spriteCentered } from './frame';
import { appear } from './anim';
import { SYNERGIES, synergyActive } from '../game/synergies';

/** Pick a sprite for the cause of death (enemy sprite by name, else a themed icon). */
export function killerSprite(source: string): string {
  const e = Enemies.all().find((d) => d.name === source);
  if (e) return e.portrait ?? e.sprite;
  if (/화상|불|용암/.test(source)) return 'ui_flame';
  if (/폭발|폭탄/.test(source)) return 'hud_bomb';
  if (/가시|함정/.test(source)) return 'ui_swords';
  if (/독/.test(source) && hasSprite('res_venom')) return 'res_venom';
  return 'ui_skull';
}

export class GameOverOverlay implements Scene {
  transparent = true;
  private menu: Menu;
  private t = 0;
  private game: GameScene;
  private info: GameOverInfo;
  private items: string[] = [];
  private menuShown = false;

  constructor(game: GameScene, info: GameOverInfo) {
    this.game = game;
    this.info = info;
    this.menu = new Menu([
      { label: '다시 도전', action: () => app.startRun(randomSeedString(), game.run.characterId), hint: '같은 등불지기로 새로운 시드에 도전합니다.' },
      { label: '같은 시드로 다시', action: () => app.startRun(game.run.seed, game.run.characterId, true), hint: '같은 던전을 다시 내려갑니다. (기록되지 않음)' },
      { label: '타이틀로', action: () => app.goTitle() },
    ], UI_W / 2, 330, { width: 220, lineH: 24, size: 13, hintY: UI_H - 18 });
    const w = game.world;
    const p = w.player;
    const wdef = Weapons.get(p.weaponId);
    if (wdef) this.items.push(wdef.icon);
    const w2 = p.weapon2Id ? Weapons.get(p.weapon2Id) : undefined;
    if (w2) this.items.push(w2.icon);
    const act = p.activeId ? Actives.get(p.activeId) : undefined;
    if (act) this.items.push(act.icon);
    for (const a of w.items.computed?.artifacts ?? []) for (let i = 0; i < Math.min(3, a.power); i++) this.items.push(a.def.icon);
  }

  enter(): void {
    sfx(this.info.won ? 'item_get_rare' : 'ui_open', { vol: 0.5 });
  }

  update(dt: number): void {
    this.t += dt;
    if (this.t > 1.3) {
      if (!this.menuShown) {
        this.menuShown = true;
        this.menu.t = 0;
      }
      this.menu.update(app.renderer, dt);
    }
  }

  draw(r: Renderer): void {
    r.beginUI();
    const won = this.info.won;
    const a = clamp(this.t / 0.8, 0, 1);
    r.uiRect(0, 0, UI_W, UI_H, won ? '#0a0604' : '#0e0306', 0.93 * a);
    if (won) this.drawRays(r, a);
    const run = this.game.run;
    const w = this.game.world;

    // ---- title
    const ta = appear(this.t, 0.7, 0.2);
    const titleText = won ? '등불이 심연을 밝혔다' : '등불이 꺼졌다';
    const col = won ? C.goldHi : '#ff7a7a';
    const ty = 26 + (1 - ta) * 10;
    const tw = r.measureText(titleText, 32, true);
    const flick = won ? 1 : Math.max(0, Math.sin(this.t * 13) * 0.5 + 0.5) * Math.max(0, 1 - this.t / 2.2);
    const lx = UI_W / 2 - tw / 2 - 26;
    if (won) glow(r, lx, ty + 18, 70, '#ffb040', 0.4 * ta);
    else glow(r, lx, ty + 18, 40, '#ff8030', 0.4 * flick * ta);
    r.uiSprite(won ? animFrame('ui_lantern', this.t) : flick > 0.3 ? 'ui_lantern_0' : 'ui_lantern_off', lx, ty + 18, 2.5, { alpha: ta });
    r.uiText(titleText, UI_W / 2 + 10, ty, { size: 32, bold: true, align: 'center', color: col, outline: won ? '#4a2a06' : '#3a0408', alpha: ta });
    const [no, fname] = splitFloorName(w.floor.name);
    const sub = won ? `${countWord(lastFloorIndex())} 개의 층을 모두 정화하고, 마을로 돌아간다.` : `${no} ${fname}에서 쓰러졌다.`;
    r.uiText(sub, UI_W / 2, ty + 44, { size: 12, align: 'center', color: C.textDim, alpha: ta });
    divider(r, UI_W / 2, ty + 64, 320, won ? C.gold : '#7a2a30', ta);

    // ---- cards
    const ca = appear(this.t, 0.5, 0.45);
    const cy = 112 + (1 - ca) * 14;
    const cw = 220;
    const gap = 14;
    const x0 = UI_W / 2 - (cw * 3 + gap * 2) / 2;
    this.drawCause(r, x0, cy, cw, ca);
    this.drawSummary(r, x0 + cw + gap, cy, cw, ca);
    this.drawItems(r, x0 + (cw + gap) * 2, cy, cw, ca);

    // ---- footer
    const ch = w.player.character;
    r.uiText(`${ch.name} · 시드 ${run.seed}${run.seeded ? ' (지정)' : ''}`, UI_W / 2, 302, { size: 10, font: 'small', align: 'center', color: C.textFaint, alpha: ca });
    if (this.menuShown) this.menu.draw(r, appear(this.menu.t, 0.3));
  }

  private drawRays(r: Renderer, a: number): void {
    const d = r.dctx;
    d.save();
    d.globalCompositeOperation = 'lighter';
    d.translate(UI_W / 2, 40);
    d.rotate(this.t * 0.08);
    for (let i = 0; i < 14; i++) {
      d.rotate((Math.PI * 2) / 14);
      d.globalAlpha = 0.05 * a;
      d.fillStyle = '#ffc060';
      d.beginPath();
      d.moveTo(0, 0);
      d.lineTo(-30, 600);
      d.lineTo(30, 600);
      d.closePath();
      d.fill();
    }
    d.restore();
  }

  private drawCause(r: Renderer, x: number, y: number, w: number, a: number): void {
    const won = this.info.won;
    const h = 176;
    frame(r, x, y, w, h, won ? 'tooltip' : 'panel', { alpha: a, color: won ? C.gold : undefined });
    const p = this.game.world.player;
    if (won) {
      r.uiText('귀환한 등불지기', x + w / 2, y + 12, { size: 10, font: 'small', align: 'center', color: C.gold, alpha: a });
      const ch = p.character;
      const idle = hasAnim(`${ch.spritePrefix}_idle_down`) ? animFrame(`${ch.spritePrefix}_idle_down`, this.t) : ch.portrait;
      glow(r, x + w / 2, y + 80, 60, ch.color, 0.25 * a);
      spriteCentered(r, idle, x + w / 2, y + 82, 4, { alpha: a });
      r.uiText(ch.name, x + w / 2, y + 132, { size: 16, bold: true, align: 'center', color: ch.color, alpha: a });
      r.uiText(ch.title, x + w / 2, y + 152, { size: 10, font: 'small', align: 'center', color: C.textFaint, alpha: a });
      return;
    }
    r.uiText('사망 원인', x + w / 2, y + 12, { size: 10, font: 'small', align: 'center', color: '#c86a70', alpha: a });
    const source = this.info.source || '알 수 없는 것';
    const spr = killerSprite(source);
    const name = hasAnim(spr) ? animFrame(spr, this.t) : spr;
    frame(r, x + w / 2 - 44, y + 32, 88, 88, 'slot', { alpha: a });
    spriteCentered(r, name, x + w / 2, y + 76, fitScale(name, 76, 4), { alpha: a });
    r.uiText(source, x + w / 2, y + 130, { size: 16, bold: true, align: 'center', color: C.text, alpha: a });
    r.uiText('에게 등불을 빼앗겼다', x + w / 2, y + 152, { size: 10, font: 'small', align: 'center', color: C.textFaint, alpha: a });
  }

  private drawSummary(r: Renderer, x: number, y: number, w: number, a: number): void {
    const run = this.game.run;
    const s = run.stats;
    frame(r, x, y, w, 176, 'panel', { alpha: a });
    r.uiText('하강 기록', x + w / 2, y + 12, { size: 10, font: 'small', align: 'center', color: C.gold, alpha: a });
    const rows: [string, string, number, (v: number) => string][] = [
      ['ui_door', '도달 층', run.floor, (v) => `${Math.round(v)}층`],
      ['ui_hourglass', '시간', s.timeSec, (v) => formatTime(v)],
      ['ui_swords', '처치', s.kills, (v) => `${Math.round(v)}`],
      ['ui_chest', '획득 아이템', s.itemsTaken, (v) => `${Math.round(v)}`],
      ['ui_crown', '보스 처치', s.bossesKilled, (v) => `${Math.round(v)}`],
      ['ui_eye', '비밀 발견', s.secretsFound, (v) => `${Math.round(v)}`],
      ['hud_coin', '모은 동전', s.coinsCollected, (v) => `${Math.round(v)}`],
    ];
    rows.forEach(([icon, label, target, fmt], i) => {
      const k = ease.outCubic(clamp((this.t - 0.7 - i * 0.08) / 0.7, 0, 1));
      const ry = y + 32 + i * 20;
      r.uiSprite(icon, x + 22, ry + 6, 1.5, { alpha: a * Math.min(1, k * 3) });
      r.uiText(label, x + 36, ry, { size: 12, color: C.textDim, alpha: a * Math.min(1, k * 3) });
      r.uiText(fmt(target * k), x + w - 16, ry, { size: 12, align: 'right', color: C.text, alpha: a * Math.min(1, k * 3) });
    });
  }

  private drawItems(r: Renderer, x: number, y: number, w: number, a: number): void {
    frame(r, x, y, w, 176, 'panel', { alpha: a });
    r.uiText(`지녔던 것 ${this.items.length}`, x + w / 2, y + 12, { size: 10, font: 'small', align: 'center', color: C.gold, alpha: a });
    const cols = 7;
    const cell = 28;
    const max = cols * 3;
    this.items.slice(0, max).forEach((icon, i) => {
      const k = clamp((this.t - 0.9 - i * 0.04) / 0.25, 0, 1);
      if (k <= 0) return;
      const cx = x + 18 + (i % cols) * cell + cell / 2 - 4;
      const cyy = y + 44 + Math.floor(i / cols) * cell;
      const sc = ease.outBack(k);
      frame(r, cx - 12, cyy - 12, 24, 24, 'slot', { alpha: a * k });
      spriteCentered(r, icon, cx, cyy, fitScale(icon, 20, 1) * sc, { alpha: a * k });
    });
    if (!this.items.length) r.uiText('빈손이었다.', x + w / 2, y + 80, { size: 12, align: 'center', color: C.textMute, alpha: a });
    if (this.items.length > max) r.uiText(`+${this.items.length - max}`, x + w - 14, y + 158, { size: 10, font: 'small', align: 'right', color: C.textDim, alpha: a });
    const world = this.game.world;
    const p = world.player;
    [p.weaponId, p.weapon2Id].forEach((id, i) => {
      const weapon = id ? Weapons.get(id) : undefined;
      if (weapon) r.uiText(`${i + 1} · ${weapon.name}`, x + 14, y + 122 + i * 14, { size: 10, font: 'small', color: C.textDim, alpha: a });
    });
    const counts = world.items.computed?.tagCounts ?? {};
    const mixed = SYNERGIES.filter((s) => synergyActive(counts, s.tags)).map((s) => s.name);
    const active = world.items.computed?.sets.filter((s) => s.active.length).map((s) => s.def.name) ?? [];
    const build = mixed.length ? mixed.join(' · ') : active.length ? active.join(' · ') : '공명 없음';
    const line = r.wrapText(build, w - 54, 10, false, 'small')[0];
    r.uiText(line ?? '', x + 14, y + 155, { size: 10, font: 'small', color: C.goldHi, alpha: a });
  }
}

/** Native Korean count word ("다섯 개", "열 개") for small numbers; digits beyond. */
export function countWord(n: number): string {
  const words = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열', '열한', '열두'];
  return (n >= 1 && words[n]) || String(n);
}
