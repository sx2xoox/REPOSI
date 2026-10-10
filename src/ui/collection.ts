// Collection / bestiary (도감) from the title: artifacts, actives, weapons,
// enemies & bosses, and run records. Seen entries show their icon & details;
// unseen ones are dark silhouettes. Tabs: Q/E, mouse, pad X/Y.

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W, UI_W_BASE, uiCenterX } from '../engine/renderer';
import { app } from '../game/app';
import { input } from '../engine/input';
import { sfx } from '../audio/audio';
import { Actives, Artifacts, Characters, Enemies, Floors, RARITY_COLOR, RARITY_NAME, Sets, Weapons, floorAt, type Rarity } from '../game/defs';
import { save } from '../engine/save';
import { animFrame } from '../engine/sprites';
import { clamp } from '../engine/math';
import { C, formatTime } from './theme';
import { divider, fitScale, frame, gauge, iconSlot, keyHintRow, spriteCentered } from './frame';
import { Repeater, Spring, appear } from './anim';
import { favouringKeepers, gridMove, scrollToRow, weaponClassText } from './logic';
import { touchUiActive } from './touch-mode';

type TabId = 'artifact' | 'active' | 'weapon' | 'enemy' | 'record';

type Fact = [string, string] | [string, string, string];

interface Entry {
  id: string;
  name: string;
  /** sprite or animation name */
  sprite: string;
  seen: boolean;
  rarity?: Rarity;
  boss?: boolean;
  /** facts: [label, value, value colour (default C.textDim)] rows at the bottom of the detail panel */
  lines: () => { title: string; sub: string; body: string; quote?: string; tags?: { icon: string; name: string; color: string }[]; facts: Fact[] };
}

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'artifact', label: '유물', icon: 'ui_gem' },
  { id: 'active', label: '액티브', icon: 'ui_bell' },
  { id: 'weapon', label: '무기', icon: 'st_damage' },
  { id: 'enemy', label: '적', icon: 'ui_skull' },
  { id: 'record', label: '기록', icon: 'ui_book' },
];

const RAR_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
const POOL_NAME: Record<string, string> = {
  treasure: '보물방', shop: '상점', boss: '보스', secret: '비밀방', challenge: '도전방', curse: '저주방', shrine: '성소',
};

const COLS = 10;
const CELL = 38;
const VISIBLE_ROWS = 7;

function poolText(pools: string[]): string {
  return pools.map((p) => POOL_NAME[p] ?? p).join(' · ') || '특수';
}

function buildEntries(tab: TabId): Entry[] {
  const seenItems = new Set(save.progress.seenItems);
  const seenEnemies = new Set(save.progress.seenEnemies);
  const byRarity = <T extends { rarity: Rarity; name: string }>(a: T, b: T) => RAR_ORDER.indexOf(a.rarity) - RAR_ORDER.indexOf(b.rarity) || a.name.localeCompare(b.name, 'ko');
  switch (tab) {
    case 'artifact':
      return Artifacts.all().filter((d) => !d.hidden || seenItems.has(d.id)).sort(byRarity).map((d) => ({
        id: d.id, name: d.name, sprite: d.icon, seen: seenItems.has(d.id), rarity: d.rarity,
        lines: () => ({
          title: d.name, sub: RARITY_NAME[d.rarity], body: [d.desc, d.detail].filter(Boolean).join(' '), quote: d.quote,
          tags: d.tags.map((t) => Sets.get(t)).filter((s): s is NonNullable<typeof s> => !!s).map((s) => ({ icon: s.icon, name: s.name, color: s.color })),
          facts: [['등장', poolText(d.pools)], ...(d.unique ? [['특성', '한 번만 등장'] as [string, string]] : [])],
        }),
      }));
    case 'active':
      return Actives.all().sort(byRarity).map((d) => ({
        id: d.id, name: d.name, sprite: d.icon, seen: seenItems.has(d.id), rarity: d.rarity,
        lines: () => ({
          title: d.name, sub: `${RARITY_NAME[d.rarity]} · 액티브`, body: d.desc, quote: d.quote,
          facts: [['충전', d.timed ? `${d.charge}초` : `방 ${d.charge}개`], ['등장', poolText(d.pools)]],
        }),
      }));
    case 'weapon': {
      const starters = new Set(Characters.all().map((c) => c.weapon));
      return Weapons.all().sort(byRarity).map((d) => ({
        id: d.id, name: d.name, sprite: d.icon, seen: seenItems.has(d.id) || starters.has(d.id) && Characters.all().some((c) => c.weapon === d.id && (c.unlocked || save.hasFlag(`unlock:${c.id}`))), rarity: d.rarity,
        lines: () => {
          // 등급 · 계열 · 속성, and the keepers whose favoured class holds the family (green, as in a run)
          const fans = favouringKeepers(d, save.progress.flags);
          return {
            title: d.name, sub: `${RARITY_NAME[d.rarity]} · ${weaponClassText(d)}`, body: d.desc,
            facts: [
              ['선호 등불지기', fans.length ? fans.join(' · ') : '없음', fans.length ? C.good : C.textDim],
              ['등장', starters.has(d.id) ? '시작 무기' : poolText(d.pools)],
            ],
          };
        },
      }));
    }
    case 'enemy': {
      const all = Enemies.all();
      const list = [...all.filter((e) => !e.boss), ...all.filter((e) => e.boss)];
      return list.map((d) => {
        const floors = (d.boss ? d.bossFloors : d.floors) ?? [];
        return {
          id: d.id, name: d.name, sprite: d.portrait ?? d.sprite, seen: seenEnemies.has(d.id), boss: !!d.boss,
          lines: () => ({
            title: d.name, sub: d.boss ? d.bossTitle ?? '보스' : '적',
            body: d.boss ? '층의 끝에서 등불지기를 기다리는 존재.' : '',
            facts: [
              ['체력', bestiaryHp(d.hp, !!d.boss, floors[0] ?? 1)],
              ['출현', floors.length ? floors.map((f) => Floors.all().find((x) => x.index === f)?.name.split('·')[1]?.trim() ?? `${f}층`).join(' · ') : '특수'],
              ...(d.flying ? [['특성', '비행'] as [string, string]] : []),
            ],
          }),
        };
      });
    }
    default:
      return [];
  }
}

export class CollectionScene implements Scene {
  transparent = true;
  touchBack = 'close' as const;
  passUpdate = true;
  private t = 0;
  private tab = 0;
  private tabT = 0;
  private entries: Entry[] = [];
  private sel = 0;
  private scroll = 0;
  private scrollS = new Spring(0, 300, 30);
  private closing = -1;
  private rep = { l: new Repeater(), r: new Repeater(), u: new Repeater(), d: new Repeater() };

  constructor() {
    this.setTab(0);
  }

  enter(): void {
    sfx('ui_open');
    input.releaseAll();
  }

  private setTab(i: number): void {
    this.tab = (i + TABS.length) % TABS.length;
    this.entries = buildEntries(TABS[this.tab].id);
    this.sel = 0;
    this.scroll = 0;
    this.scrollS.set(0);
    this.tabT = 0;
  }

  private close(): void {
    if (this.closing >= 0) return;
    sfx('ui_back');
    this.closing = 0;
  }

  private cellPos(i: number): { x: number; y: number } {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    return { x: 30 + col * CELL, y: 112 + (row - this.scrollS.value) * CELL };
  }

  update(dt: number): void {
    this.t += dt;
    this.tabT += dt;
    this.scrollS.target = this.scroll;
    this.scrollS.update(dt);
    if (this.closing >= 0) {
      this.closing += dt;
      if (this.closing > 0.16) app.scenes.remove(this);
      return;
    }
    if (input.pressed('cancel') || input.pressed('pause')) {
      this.close();
      return;
    }
    if (input.pressed('active')) { this.setTab(this.tab - 1); sfx('ui_move'); }
    if (input.pressed('tabNext')) { this.setTab(this.tab + 1); sfx('ui_move'); }
    const n = this.entries.length;
    const old = this.sel;
    if (n) {
      if (this.rep.r.update(input.held('uiRight'), dt)) this.sel = gridMove(this.sel, n, COLS, 1, 0);
      if (this.rep.l.update(input.held('uiLeft'), dt)) this.sel = gridMove(this.sel, n, COLS, -1, 0);
      if (this.rep.d.update(input.held('uiDown'), dt)) this.sel = gridMove(this.sel, n, COLS, 0, 1);
      if (this.rep.u.update(input.held('uiUp'), dt)) this.sel = gridMove(this.sel, n, COLS, 0, -1);
      if (input.wheel) this.scroll = clamp(this.scroll + Math.sign(input.wheel), 0, Math.max(0, Math.ceil(n / COLS) - VISIBLE_ROWS));
    }
    const m = app.renderer.displayToUI(input.mouseX, input.mouseY);
    m.x -= uiCenterX();
    // tabs
    for (let i = 0; i < TABS.length; i++) {
      const tx = 30 + i * 84;
      if (input.pressed('fire') && m.x >= tx && m.x < tx + 80 && m.y >= 64 && m.y < 88) {
        if (i !== this.tab) { this.setTab(i); sfx('ui_move'); }
      }
    }
    // cells
    if (input.mouseMoved && TABS[this.tab].id !== 'record') {
      for (let i = 0; i < n; i++) {
        const p = this.cellPos(i);
        if (p.y < 100 || p.y > 112 + VISIBLE_ROWS * CELL) continue;
        if (m.x >= p.x && m.x < p.x + CELL - 2 && m.y >= p.y && m.y < p.y + CELL - 2) this.sel = i;
      }
    }
    if (this.sel !== old) {
      sfx('ui_move', { vol: 0.5 });
      this.scroll = scrollToRow(this.scroll, Math.floor(this.sel / COLS), VISIBLE_ROWS);
    }
  }

  draw(r: Renderer): void {
    r.beginUI();
    const k = this.closing >= 0 ? 1 - clamp(this.closing / 0.16, 0, 1) : appear(this.t, 0.25);
    r.uiRect(0, 0, UI_W, UI_H, C.void, 0.8 * k);
    r.dctx.translate(uiCenterX(), 0); // 768-wide layout centered on wide screens
    frame(r, 14, 10 + (1 - k) * 10, UI_W_BASE - 28, UI_H - 40, 'ornate', { alpha: k });
    r.uiText('도감', 34, 26, { size: 24, bold: true, color: C.text, outline: C.ink, alpha: k });
    r.uiText('등불이 비춘 것들의 기록', 102, 36, { size: 10, font: 'small', color: C.textFaint, alpha: k });
    // tabs
    TABS.forEach((tb, i) => {
      const tx = 30 + i * 84;
      const on = i === this.tab;
      frame(r, tx, 64, 80, 24, on ? 'buttonHi' : 'button', { alpha: k });
      r.uiSprite(tb.icon, tx + 14, 76, 2, { alpha: k * (on ? 1 : 0.6) });
      r.uiText(tb.label, tx + 26, 70, { size: 12, color: on ? C.goldHi : C.textDim, alpha: k });
    });
    if (!touchUiActive()) keyHintRow(r, [['Q', '이전'], ['E', '다음']], 30 + TABS.length * 84 + 52, 76, { alpha: k * 0.7 });
    const id = TABS[this.tab].id;
    const tk = appear(this.tabT, 0.25) * k;
    if (id === 'record') {
      this.drawRecords(r, tk);
    } else {
      this.drawGrid(r, tk);
      this.drawDetail(r, tk);
    }
    if (!touchUiActive()) keyHintRow(r, [['방향키', '이동'], ['Q/E', '분류'], ['Esc', '닫기']], UI_W_BASE / 2, UI_H - 15, { alpha: k * 0.8 });
  }

  private drawGrid(r: Renderer, k: number): void {
    const n = this.entries.length;
    const seen = this.entries.filter((e) => e.seen).length;
    // progress
    r.uiText(`발견 ${seen} / ${n}`, 30, 96 - 4, { size: 10, font: 'small', color: C.textDim, alpha: k });
    gauge(r, 110, 92, 120, 8, n ? seen / n : 0, { fill: C.gold, alpha: k });
    const d = r.dctx;
    d.save();
    d.beginPath();
    d.rect(24, 106, COLS * CELL + 12, VISIBLE_ROWS * CELL + 6);
    d.clip();
    for (let i = 0; i < n; i++) {
      const e = this.entries[i];
      const p = this.cellPos(i);
      if (p.y < 70 || p.y > 112 + VISIBLE_ROWS * CELL) continue;
      const isSel = i === this.sel;
      const cx = p.x + (CELL - 2) / 2;
      const cy = p.y + (CELL - 2) / 2;
      const stagger = clamp(k * 1.4 - (i % 30) * 0.012, 0, 1);
      const spr = animFrame(e.sprite, this.t);
      iconSlot(r, null, cx, cy, CELL - 2, { selected: isSel, alpha: stagger });
      const s = fitScale(spr, CELL - 10, 2);
      spriteCentered(r, spr, cx, cy, s, { alpha: stagger * (e.seen ? 1 : 0.85), tint: e.seen ? undefined : '#2c2440', tintAmount: e.seen ? 0 : 1 });
      if (e.seen && e.rarity) r.uiSprite(`ui_rarity_${e.rarity}`, p.x + CELL - 9, p.y + 7, 1.5, { alpha: stagger });
      if (e.boss) r.uiSprite('ui_crown', p.x + 8, p.y + 6, 1, { alpha: stagger * (e.seen ? 1 : 0.4) });
    }
    d.restore();
    const rows = Math.ceil(n / COLS);
    if (rows > VISIBLE_ROWS) {
      const sx = 30 + COLS * CELL + 4;
      r.uiRect(sx, 112, 3, VISIBLE_ROWS * CELL - 4, '#1a1424', k);
      const h = ((VISIBLE_ROWS / rows) * (VISIBLE_ROWS * CELL - 4));
      r.uiRect(sx, 112 + (this.scrollS.value / rows) * (VISIBLE_ROWS * CELL - 4), 3, h, C.gold, k);
    }
  }

  private drawDetail(r: Renderer, k: number): void {
    const e = this.entries[this.sel];
    const x = 444;
    const y = 96;
    const w = UI_W_BASE - 30 - x;
    const h = 286;
    frame(r, x, y, w, h, 'panel', { alpha: k });
    if (!e) return;
    const spr = animFrame(e.sprite, this.t);
    const big = fitScale(spr, 64, 4);
    frame(r, x + 14, y + 14, 76, 76, 'slot', { alpha: k });
    spriteCentered(r, spr, x + 52, y + 52, big, { alpha: k, tint: e.seen ? undefined : '#2c2440', tintAmount: e.seen ? 0 : 1 });
    if (!e.seen) {
      r.uiText('???', x + 102, y + 22, { size: 16, bold: true, color: C.textFaint, alpha: k });
      r.uiText('아직 발견하지 못했다.', x + 102, y + 46, { size: 12, color: C.textMute, alpha: k });
      r.uiText(TABS[this.tab].id === 'enemy' ? '쓰러뜨리면 기록된다.' : '손에 넣으면 기록된다.', x + 102, y + 64, { size: 10, font: 'small', color: C.textMute, alpha: k });
      return;
    }
    const L = e.lines();
    const col = e.rarity ? RARITY_COLOR[e.rarity] : e.boss ? '#ff8a8a' : C.text;
    const tl = r.wrapText(L.title, w - 116, 16, true);
    tl.slice(0, 2).forEach((l, i) => r.uiText(l, x + 102, y + 18 + i * 18, { size: 16, bold: true, color: col, alpha: k }));
    const subY = y + 22 + Math.min(2, tl.length) * 18;
    if (e.rarity) r.uiSprite(`ui_rarity_${e.rarity}`, x + 107, subY + 6, 2, { alpha: k });
    r.uiText(L.sub, x + (e.rarity ? 116 : 102), subY, { size: 10, font: 'small', color: col, alpha: k * 0.85 });
    let ty = y + 102;
    if (L.tags?.length) {
      let tx = x + 14;
      for (const tg of L.tags) {
        const tw = r.measureText(tg.name, 10, false, 'small') + 24;
        frame(r, tx, ty - 2, tw, 18, 'tooltip', { color: tg.color, alpha: k });
        r.uiSprite(tg.icon, tx + 9, ty + 7, 1.5, { alpha: k });
        r.uiText(tg.name, tx + 17, ty + 1, { size: 10, font: 'small', color: tg.color, alpha: k });
        tx += tw + 4;
      }
      ty += 24;
    }
    if (L.body) {
      const lines = r.wrapText(L.body, w - 28, 12);
      lines.slice(0, 5).forEach((l) => {
        r.uiText(l, x + 14, ty, { size: 12, color: C.text, alpha: k });
        ty += 16;
      });
      ty += 4;
    }
    if (L.quote) {
      const ql = r.wrapText(`“${L.quote}”`, w - 28, 10, false, 'small');
      ql.slice(0, 3).forEach((l) => {
        r.uiText(l, x + 14, ty, { size: 10, font: 'small', color: '#a89878', alpha: k });
        ty += 13;
      });
      ty += 4;
    }
    divider(r, x + w / 2, Math.max(ty + 2, y + h - 18 - L.facts.length * 15 - 6), w - 40, C.goldDark, k * 0.7);
    L.facts.forEach(([a, b, bc], i) => {
      const fy = y + h - 18 - (L.facts.length - i) * 15 + 4;
      r.uiText(a, x + 14, fy, { size: 10, font: 'small', color: C.textFaint, alpha: k });
      r.uiText(b, x + w - 14, fy, { size: 10, font: 'small', align: 'right', color: bc ?? C.textDim, alpha: k });
    });
  }

  private drawRecords(r: Renderer, k: number): void {
    const p = save.progress;
    const x = 30;
    const y = 100;
    frame(r, x, y, 300, 286, 'panel', { alpha: k });
    r.uiText('누적 기록', x + 14, y + 12, { size: 12, bold: true, color: C.goldHi, alpha: k });
    const items = Artifacts.all().length + Actives.all().length + Weapons.all().length;
    const rows: [string, string, string][] = [
      ['ui_door', '하강 횟수', `${p.runs}`],
      ['ui_crown', '귀환 (승리)', `${p.wins}`],
      ['ui_skull', '사망', `${p.deaths}`],
      ['ui_flame', '최고 도달', p.bestFloor ? `${p.bestFloor}층` : '-'],
      ['ui_hourglass', '최단 귀환', p.bestTimeSec ? formatTime(p.bestTimeSec) : '-'],
      ['ui_swords', '처치한 적', `${p.totalKills}`],
      ['ui_chest', '발견한 아이템', `${p.seenItems.length} / ${items}`],
      ['ui_eye', '기록된 적', `${p.seenEnemies.length} / ${Enemies.all().length}`],
    ];
    rows.forEach(([icon, a, b], i) => {
      const ry = y + 44 + i * 28;
      r.uiSprite(icon, x + 24, ry + 6, 2, { alpha: k });
      r.uiText(a, x + 44, ry, { size: 12, color: C.textDim, alpha: k });
      r.uiText(b, x + 286, ry, { size: 12, align: 'right', color: C.text, alpha: k });
    });
    // recent runs
    const hx = 344;
    const hw = UI_W_BASE - 30 - hx;
    frame(r, hx, y, hw, 286, 'panel', { alpha: k });
    r.uiText('최근 하강', hx + 14, y + 12, { size: 12, bold: true, color: C.goldHi, alpha: k });
    if (!save.history.length) {
      r.uiText('아직 기록이 없습니다.', hx + 14, y + 44, { size: 12, color: C.textMute, alpha: k });
      return;
    }
    save.history.slice(0, 8).forEach((h, i) => {
      const ry = y + 40 + i * 30;
      const ch = Characters.get(h.character);
      frame(r, hx + 10, ry - 4, hw - 20, 28, h.won ? 'tooltip' : 'button', { alpha: k * 0.9, color: h.won ? C.gold : undefined });
      if (ch) r.uiSprite(ch.portrait, hx + 26, ry + 10, 1, { alpha: k });
      r.uiText(`${ch?.name ?? h.character} · ${h.floor}층`, hx + 42, ry, { size: 12, color: h.won ? C.goldHi : C.text, alpha: k });
      r.uiText(h.won ? '귀환' : `사망 — ${h.killedBy || '???'}`, hx + 42, ry + 13, { size: 10, font: 'small', color: h.won ? C.gold : C.bad, alpha: k * 0.85 });
      r.uiText(`${formatTime(h.timeSec)} · 처치 ${h.kills}`, hx + hw - 18, ry, { size: 10, font: 'small', align: 'right', color: C.textDim, alpha: k });
      r.uiText(h.seed, hx + hw - 18, ry + 13, { size: 10, font: 'small', align: 'right', color: C.textMute, alpha: k });
    });
  }
}

/** Bestiary HP line: the HP on the first floor the enemy appears on (floor HP scaling applied). */
export function bestiaryHp(hp: number, boss: boolean, floor: number): string {
  const f = floorAt(floor);
  const mult = f ? (boss ? f.bossHpMult ?? f.hpMult : f.hpMult) : 1;
  return `${Math.round(hp * mult)} (${f ? floor : 1}층 기준)`;
}
