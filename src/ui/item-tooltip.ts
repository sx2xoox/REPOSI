// Item preview card: when the keeper stands near an item pedestal, a shop ware, a
// potion or a weapon crate (World.focus, see game/interact.ts), a compact card
// with icon, name, rarity, description and context (weapon comparison, active
// charge, price, the interact key) floats above it. The card is anchored to the
// item in world space but drawn in the UI layer, kept inside the safe area and
// below the top HUD rows; its bitmap is cached (UiLayer) until its content changes.

import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import type { World } from '../game/world';
import { heartCostText } from '../game/heart-cost';
import type { Entity } from '../game/entity';
import { input } from '../engine/input';
import { clamp, ease } from '../engine/math';
import { Actives, Artifacts, Potions, RARITY_COLOR, RARITY_NAME, Sets, Weapons, weaponMatchesAffinity, type Rarity } from '../game/defs';
import { SYNERGIES, synergyActive } from '../game/synergies';
import { Pedestal, Pickup, itemInfo, potionSpriteFor, type PickupKind } from '../game/pickups';
import { BASE_STATS, StatMods, computeStats, type Stats } from '../game/stats';
import { frame, iconSlot, keyHintWidth, keycap } from './frame';
import { weaponClassRuns } from './logic';
import { C } from './theme';
import { actionLabel } from './keys';
import { touchUiActive } from './touch-mode';
import { UiLayer } from './layer-cache';
import { bannersBottom } from './cards';

const CARD_W = 214;
/** a long sub line (a weapon's "등급 · 계열 · 속성" beside the interact key) widens the card up to this */
const CARD_W_MAX = 280;
const PAD = 9;
const LINE = 13;
/** the HUD's top rows (hearts, artifact row) end about here (UI units below the safe top) */
const HUD_TOP = 58;

interface Seg {
  t: string;
  c: string;
}

export interface ItemCard {
  icon: string;
  name: string;
  color: string;
  sub: Seg[];
  desc: string;
  extra: Seg[][];
  /** interact key hint ('' key = touch button label only) */
  action: { key: string; label: string; pad: boolean; ok: boolean } | null;
  /** hint when the item is taken on touch instead */
  note: string;
  price: { icon: string; text: string; ok: boolean } | null;
}

const PICKUP_TEXT: Partial<Record<PickupKind, [string, string]>> = {
  heart_half: ['체력 반 칸', '체력을 반 칸 회복한다'],
  heart: ['체력 한 칸', '체력을 한 칸 회복한다'],
  blue_flame: ['푸른 불꽃', '체력보다 먼저 타는 불꽃 한 칸'],
  blue_flame_half: ['작은 푸른 불꽃', '체력보다 먼저 타는 불꽃 반 칸'],
  match: ['성냥', '봉인된 문·상자와 꺼진 등에 불을 붙인다'],
  matchbox: ['성냥갑', '성냥 3개'],
  coin: ['동전', '동전 1개'],
  coin_string: ['동전 꾸러미', '동전 4개'],
};
const PICKUP_ICON: Partial<Record<PickupKind, string>> = {
  heart_half: 'pk_heart_half', heart: 'pk_heart', blue_flame: 'pk_blue_flame', blue_flame_half: 'pk_blue_flame_half',
  match: 'pk_match', matchbox: 'pk_matchbox', coin: 'pk_coin', coin_string: 'pk_coin_string',
};
const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

const statCache = new Map<string, Stats>();
/** Base stats with only weapon `id`'s modifiers applied (comparison basis). */
function weaponStats(id: string): Stats {
  let s = statCache.get(id);
  if (!s) {
    const m = new StatMods();
    Weapons.get(id)?.stats?.(m);
    s = computeStats(BASE_STATS, m);
    statCache.set(id, s);
  }
  return s;
}

function arrow(label: string, ratio: number): Seg | null {
  if (ratio > 1.03) return { t: `${label} ▲`, c: C.good };
  if (ratio < 0.97) return { t: `${label} ▼`, c: C.bad };
  return null;
}

/** Weapon comparison vs the held weapon: "피해 ▲  공속 ▼  등급 ▲". */
export function weaponCompare(newId: string, heldId: string): Seg[] {
  if (newId === heldId) return [{ t: '들고 있는 무기와 같다', c: C.textFaint }];
  const a = weaponStats(newId);
  const b = weaponStats(heldId);
  const out: Seg[] = [];
  const dmg = arrow('피해', a.damage / Math.max(0.01, b.damage));
  const spd = arrow('공속', a.fireRate / Math.max(0.01, b.fireRate));
  const rng = arrow('사거리', a.range / Math.max(0.01, b.range));
  for (const s of [dmg, spd, rng]) if (s) out.push(s);
  const ra = RARITY_ORDER.indexOf(Weapons.get(newId)?.rarity ?? 'common');
  const rb = RARITY_ORDER.indexOf(Weapons.get(heldId)?.rarity ?? 'common');
  if (ra !== rb) out.push(ra > rb ? { t: '등급 ▲', c: C.good } : { t: '등급 ▼', c: C.bad });
  if (!out.length) out.push({ t: '비슷한 기본 능력치', c: C.textDim });
  return out;
}

/** Card content for a focused entity (null if it shows nothing). */
export function buildCard(w: World, e: Entity): ItemCard | null {
  const p = w.player;
  const pad = input.aimMode === 'pad';
  // '' on touch screens: the card then shows the hand of the on-screen "줍기" button
  const keyOf = () => actionLabel(input.bindings, 'interact', pad);
  if (e.interactionInfo) {
    const info = e.interactionInfo(w);
    if (info.compactHint) return null;
    return { icon:info.icon, name:info.name, color:C.gold, sub:[], desc:info.desc, extra:[],
      action:{ key:touchUiActive() ? '' : keyOf(), label:info.actionLabel ?? '사용', pad, ok:info.available ?? true }, note:'', price:info.price ?? null };
  }
  if (e instanceof Pedestal && e.item) {
    const it = e.item;
    const info = itemInfo(it);
    const col = RARITY_COLOR[info.rarity];
    const sub: Seg[] = [{ t: RARITY_NAME[info.rarity], c: col }];
    const extra: Seg[][] = [];
    let label = '줍기';
    if (it.kind === 'artifact') {
      const def = Artifacts.get(it.id);
      sub.push({ t: ' · 유물', c: C.textDim });
      const owned = w.items.powerOf(it.id);
      if (owned > 0) sub.push({ t: `  보유 x${owned}`, c: C.goldHi });
      const counts = w.items.computed?.tagCounts ?? {};
      const after = { ...counts };
      for (const tag of def?.tags ?? []) {
        const s = Sets.get(tag);
        if (!s) continue;
        const count = counts[tag] ?? 0;
        after[tag] = count + (owned ? 0 : 1);
        const next = [...s.tiers].sort((a, b) => a.count - b.count).find((t) => t.count > count);
        const unlocked = next && after[tag] >= next.count;
        extra.push([{ t: `공명 ${s.name} ${count} → ${after[tag]}${next ? ` / ${next.count}` : ' (완성)'}${unlocked ? ' 달성!' : ''}`, c: s.color }]);
        if (next) extra.push([{ t: next.desc, c: unlocked ? C.goldHi : C.textFaint }]);
      }
      if (owned) extra.push([{ t: '중복은 효과 강화 · 공명 개수 유지', c: C.textFaint }]);
      for (const s of SYNERGIES) {
        if (!s.tags.some((t) => def?.tags.includes(t))) continue;
        if (!s.tags.every((t) => (after[t] ?? 0) > 0)) continue;
        const active = synergyActive(after, s.tags);
        extra.push([{ t: `혼합 · ${s.name} ${active ? '발동 가능' : s.tags.map((t) => `${Sets.get(t)?.name} ${after[t] ?? 0}/2`).join(' · ')}`, c: s.color }]);
        if (active) extra.push([{ t: s.desc, c: C.textDim }]);
      }
    } else if (it.kind === 'active') {
      const def = Actives.get(it.id);
      sub.push({ t: ' · 액티브', c: C.textDim });
      if (def) extra.push([{ t: def.timed ? `충전 ${def.charge}초` : `충전 방 ${def.charge}개`, c: C.info }]);
      const cur = p.activeId ? Actives.get(p.activeId) : undefined;
      if (cur && cur.id !== it.id) {
        extra[extra.length - 1]?.push({ t: `  ·  ${cur.name}와 교체`, c: C.textFaint });
        label = '교체';
      }
    } else {
      const def = Weapons.get(it.id);
      // 등급 · 계열 · 속성: the family is green when it is this keeper's favoured weapon
      if (def) sub.push({ t: ' · ', c: C.textDim }, ...weaponClassRuns(def, p.character, C.textDim, C.good));
      extra.push(weaponCompare(it.id, p.weaponId));
      extra.push([{ t: '기본 능력치 비교 · 연타/폭발 별도', c: C.textFaint }]);
      if (p.character.affinity && weaponMatchesAffinity(p.character.affinity, def)) {
        extra.push([{ t: `${p.character.name}의 선호 무기 (${p.character.affinity.name})`, c: C.good }]);
      }
      if (p.weapon2Id || it.id === p.weaponId) {
        const held = Weapons.get(it.id === p.weapon2Id ? p.weapon2Id : p.weaponId);
        if (held) extra.push([{ t: `${held.name}을(를) 내려놓는다`, c: C.textFaint }]);
        label = '교체';
      } else extra.push([{ t: '빈 무기 칸에 든다', c: C.textFaint }]);
    }
    const ok = e.affordable(w);
    let price: ItemCard['price'] = null;
    if (e.price > 0) {
      price = { icon: 'hud_coin', text: `${e.price}`, ok: p.coins >= e.price };
      label = '구매';
    } else if (e.heartPrice > 0) {
      price = { icon: 'hud_heart_full', text: `${e.heartPrice}`, ok };
      extra.push([{ t: heartCostText(p, e.heartPrice), c: C.bad }]);
      extra.push([{ t: '최대 체력 부족 시 푸른 불꽃으로 지불', c: C.textFaint }]);
      label = '거래';
    }
    return { icon: info.icon, name: info.name, color: col, sub, desc: [info.desc, info.detail].filter(Boolean).join(' '), extra, action: { key: keyOf(), label, pad, ok }, note: '', price };
  }
  if (e instanceof Pickup) {
    if (e.kind === 'potion') {
      const def = Potions.get(e.potionId);
      const known = w.run.identified.has(e.potionId) && !!def;
      return {
        icon: potionSpriteFor(w, e.potionId),
        name: known ? def!.name : '정체불명의 물약',
        color: '#e0c0ff',
        sub: [{ t: known ? '물약 · 감정됨' : '물약 · 미감정', c: C.textDim }],
        desc: known ? def!.desc : '마셔 봐야 정체를 안다',
        extra: e.price > 0 && p.potionId ? [[{ t:'들고 있는 물약과 교체', c:C.textFaint }]] : [],
        action: e.price > 0 ? { key:touchUiActive() ? '' : keyOf(), label:'구매', pad, ok:p.coins >= e.price && e.canCollect(w) } : null,
        note: e.price > 0 ? (p.potionId ? '들고 있는 물약과 교체' : '') : (p.potionId ? '닿으면 들고 있는 물약과 교체' : '닿으면 줍기'),
        price: e.price > 0 ? { icon: 'hud_coin', text: `${e.price}`, ok: p.coins >= e.price } : null,
      };
    }
    const tx = PICKUP_TEXT[e.kind] ?? [e.kind, ''];
    return {
      icon: PICKUP_ICON[e.kind] ?? 'pk_coin',
      name: tx[0],
      color: C.text,
      sub: [{ t: '상점 물건', c: C.textDim }],
      desc: tx[1],
      extra: e.canCollect(w) ? [] : [[{ t:'지금은 살 필요가 없다', c:C.textFaint }]],
      action: { key:touchUiActive() ? '' : keyOf(), label:'구매', pad, ok:p.coins >= e.price && e.canCollect(w) },
      note: e.canCollect(w) ? '' : '지금은 살 필요가 없다',
      price: { icon: 'hud_coin', text: `${e.price}`, ok: p.coins >= e.price },
    };
  }
  // weapon crate (content/weapons/drops.ts): rarity is visible on its lock gem
  const crate = e as Entity & { weaponId?: string; rarity?: Rarity; opened?: boolean };
  if (typeof crate.weaponId === 'string' && crate.rarity && !crate.opened) {
    return {
      icon: 'weapon_chest',
      name: '무기 상자',
      color: RARITY_COLOR[crate.rarity],
      sub: [{ t: `${RARITY_NAME[crate.rarity]} 무기`, c: RARITY_COLOR[crate.rarity] }],
      desc: '열어 보면 무기가 들어 있다',
      extra: [],
      action: null,
      note: '닿으면 열림',
      price: null,
    };
  }
  return null;
}

/**
 * Card width: wide enough for the sub line and the interact hint beside it on one row (as
 * paintCard lays them out), so a weapon's 속성 is never cut off; CARD_W..CARD_W_MAX.
 */
export function cardWidth(r: Renderer, c: ItemCard): number {
  const sub = c.sub.reduce((s, sg) => s + r.measureText(sg.t, 10, false, 'small'), 0);
  const a = c.action;
  // keycap + label, or the touch hand (14) + label; 6 = gap to the sub text
  const act = a ? (a.key ? keyHintWidth(r, a.key, a.label, a.pad) : 14 + 4 + r.measureText(a.label, 10, false, 'small')) + 6
    : c.note ? r.measureText(c.note, 10, false, 'small') + 6 : 0;
  return clamp(Math.ceil(PAD + 38 + sub + act + PAD), CARD_W, CARD_W_MAX);
}

/** Cache signature of everything a card shows (cheap; rebuilt only when it changes). */
function signature(w: World, e: Entity): string {
  const p = w.player;
  let s = `${e.id}|${p.weaponId}|${p.weapon2Id ?? ''}|${p.activeId ?? ''}|${p.potionId ?? ''}|${input.aimMode === 'pad' ? 1 : 0}|${touchUiActive() ? 1 : 0}`;
  if (e instanceof Pedestal) s += `|${e.item?.kind}:${e.item?.id}|${e.price}|${e.heartPrice}|${e.affordable(w) ? 1 : 0}|${p.coins >= e.price ? 1 : 0}|${e.item ? w.items.powerOf(e.item.id) : 0}`;
  else if (e instanceof Pickup) s += `|${e.kind}|${e.potionId}|${w.run.identified.has(e.potionId) ? 1 : 0}|${e.price}|${p.coins >= e.price ? 1 : 0}|${e.canCollect(w) ? 1 : 0}`;
  if (e.interactionInfo) {
    const i = e.interactionInfo(w);
    s += `|${i.name}|${i.desc}|${i.icon}|${i.actionLabel ?? ''}|${i.available ?? 1}|${i.price ? `${i.price.text}:${i.price.ok}` : ''}`;
  }
  return `${s}|${w.items.revision}|${p.maxRed}|${p.soul}|${p.coins}|${p.matches}`;
}

export class ItemTooltip {
  private readonly ly = new UiLayer();
  /** entity whose card is shown (kept while fading out) */
  private cur: Entity | null = null;
  private card: ItemCard | null = null;
  private sig = '';
  private lines: string[] = [];
  private extraLines: Seg[][] = [];
  private h = 0;
  private w = CARD_W;
  /** 0..1 appear progress */
  private a = 0;
  private t = 0;
  private pr: Renderer | null = null;
  /** smoothed card offset from the anchor; reset when a new card appears */
  private offX = 0;
  private offY = 0;
  private fresh = true;
  private lastDraw = 0;
  private readonly paint = () => this.paintCard(this.pr!);

  update(w: World, dt: number): void {
    this.t += dt;
    const prev = this.cur;
    const hidden = !!w.bossIntro || w.transitioning || !!w.descending || !w.player?.alive;
    const f = hidden || !w.focus?.previewable(w) ? null : w.focus;
    // Mission devices lose their full card immediately when combat begins.
    if (this.cur && !this.cur.previewable(w)) { this.cur = null; this.a = 0; }
    if (f && f.dead) this.cur = null;
    if (f === this.cur && f) this.a = Math.min(1, this.a + dt * 7);
    else if (!f || this.a > 0.05) {
      // fade out (quickly when another item takes over)
      this.a = Math.max(0, this.a - dt * (f ? 12 : 6));
      if (this.a <= 0) this.cur = f;
    } else this.cur = f;
    if (this.cur?.dead) this.cur = null;
    if (this.cur !== prev || this.a <= 0) this.fresh = true;
  }

  /** True while a card is (partly) visible. */
  get visible(): boolean {
    return !!this.cur && this.a > 0.01;
  }

  /** Bottom interaction prompts take priority over the general control hints. */
  hasCompactHint(w: World): boolean {
    return this.visible && !!this.cur?.interactionInfo?.(w).compactHint;
  }

  draw(r: Renderer, w: World, alpha = 1): void {
    const e = this.cur;
    if (!e || this.a <= 0.01 || alpha <= 0.01) return;
    const compact=e.interactionInfo?.(w).compactHint;
    if(compact){
      const key=touchUiActive()?'사용':actionLabel(input.bindings,'interact',input.aimMode==='pad');
      r.uiText(`${key} · ${compact}`,UI_W/2,UI_H-28-r.uiSafe.b,{size:10,align:'center',color:C.gold,outline:C.ink,alpha:alpha*this.a});
      return;
    }
    const sig = signature(w, e) + (e.interactionInfo?.(w).desc ?? '');
    if (sig !== this.sig || !this.card) {
      this.sig = sig;
      this.card = buildCard(w, e);
      if (this.card) {
        const c = this.card;
        this.w = cardWidth(r, c);
        this.lines = r.wrapText(c.desc, this.w - PAD * 2, 10, false, 'small');
        this.extraLines = c.extra.flatMap((row) => {
          if (row.length !== 1) return [row];
          return r.wrapText(row[0].t, this.w - PAD * 2, 10, false, 'small').map((t) => [{ t, c: row[0].c }]);
        });
        this.h = PAD + 32 + 3 + this.lines.length * LINE + this.extraLines.length * LINE + 5;
      }
    }
    const c = this.card;
    if (!c) return;
    const k = ease.outCubic(clamp(this.a, 0, 1));
    const sa = r.uiSafe;
    // anchor: the item's top / bottom in world space -> UI units
    const top = e instanceof Pedestal ? e.y - 22 : e instanceof Pickup ? e.y - 9 : e.y - 10;
    const bottom = e instanceof Pedestal ? e.y + 14 : e.y + 8;
    const at = r.displayToUI(...xy(r.worldToDisplay(e.x, top)));
    const ab = r.displayToUI(...xy(r.worldToDisplay(e.x, bottom)));
    const W = this.w;
    const H = this.h;
    const maxY = UI_H - sa.b - 6 - H;
    const minX = sa.l + 6;
    const maxX = UI_W - sa.r - 6 - W;
    // above the item; else beside it (never over the keeper, who usually stands below); else below
    let side: 'up' | 'left' | 'right' | 'down' = 'up';
    let x = at.x - W / 2;
    let y = at.y - 8 - H;
    // stay below the top HUD rows, and below item banners when they are over the card
    let minY = sa.t + HUD_TOP;
    const bb = bannersBottom(r, w);
    if (bb > 0 && clamp(x, minX, maxX) < UI_W / 2 + 215 && clamp(x, minX, maxX) + W > UI_W / 2 - 215) minY = Math.max(minY, bb);
    if (y < minY) {
      const mid = (at.y + ab.y) / 2;
      y = clamp(mid - H / 2, minY, maxY);
      if (at.x + 20 + W <= UI_W - sa.r - 6) {
        side = 'right';
        x = at.x + 20;
      } else if (at.x - 20 - W >= minX) {
        side = 'left';
        x = at.x - 20 - W;
      } else {
        side = 'down';
        x = at.x - W / 2;
        y = ab.y + 8;
      }
    }
    // glide between placements (relative to the anchor, so camera motion never lags)
    if (this.fresh) {
      this.lastDraw = typeof performance !== 'undefined' ? performance.now() : 0;
      this.offX = x - at.x;
      this.offY = y - at.y;
      this.fresh = false;
    } else {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      const f = 1 - Math.exp(-Math.min(0.1, Math.max(0, now - this.lastDraw) / 1000) * 16);
      this.offX += (x - at.x - this.offX) * f;
      this.offY += (y - at.y - this.offY) * f;
    }
    this.lastDraw = typeof performance !== 'undefined' ? performance.now() : 0;
    x = clamp(at.x + this.offX, minX, maxX);
    y = clamp(at.y + this.offY, sa.t + 6, maxY);
    const off = (1 - k) * 6;
    const sx = side === 'right' ? -off : side === 'left' ? off : 0;
    const sy = side === 'up' ? off : side === 'down' ? -off : 0;
    // snap to whole display pixels so the cached bitmap is reused while the camera moves
    const s = r.uiScale;
    const ox = (Math.round(r.uiOffsetX + (x + sx) * s) - r.uiOffsetX) / s;
    const oy = (Math.round(r.uiOffsetY + (y + sy) * s) - r.uiOffsetY) / s;
    const A = k * alpha;
    // pointer tail toward the item (live: a few 1-unit rects)
    const d = r.dctx;
    d.globalAlpha = A;
    const ty0 = clamp((at.y + ab.y) / 2, oy + 10, oy + H - 10);
    const tx0 = clamp(at.x, ox + 12, ox + W - 12);
    for (let i = 0; i < 4; i++) {
      const len = (4 - i) * 2;
      d.fillStyle = i === 3 ? C.ink : c.color;
      if (side === 'up') d.fillRect(Math.round(tx0 - len / 2), Math.round(oy + H - 1 + i), len, 1);
      else if (side === 'down') d.fillRect(Math.round(tx0 - len / 2), Math.round(oy - i), len, 1);
      else if (side === 'right') d.fillRect(Math.round(ox - i), Math.round(ty0 - len / 2), 1, len);
      else d.fillRect(Math.round(ox + W - 1 + i), Math.round(ty0 - len / 2), 1, len);
    }
    d.globalAlpha = 1;
    this.pr = r;
    this.ly.draw(r, `${this.sig}|${W}x${H}`, ox, oy, 0, 0, W, H, A, this.paint);
    this.pr = null;
    // a refused press (can't pay): the price blinks red for a moment
    const deny = e instanceof Pedestal ? e.mem.denyT : undefined;
    if (deny !== undefined && w.time - deny < 0.5 && c.price) {
      const bl = 0.5 + 0.5 * Math.sin(this.t * 40);
      r.uiRect(ox + W - 64, oy + PAD - 2, 58, 16, C.bad, 0.3 * bl * A);
    }
  }

  private paintCard(r: Renderer): void {
    const c = this.card!;
    const W = this.w;
    const H = this.h;
    frame(r, 0, 0, W, H, 'tooltip', { color: c.color });
    iconSlot(r, c.icon, PAD + 15, PAD + 15, 30);
    // right column: price (top) and the interact key / how it is taken (below)
    let right = W - PAD;
    if (c.price) {
      const pc = c.price.ok ? C.goldHi : C.bad;
      r.uiText(c.price.text, right, PAD - 1, { size: 12, bold: true, align: 'right', color: pc });
      const tw = r.measureText(c.price.text, 12, true);
      r.uiSprite(c.price.icon, right - tw - 16, PAD, 2);
      if (!c.price.ok) r.uiText('부족', right - tw - 25, PAD + 1, { size: 10, font: 'small', align: 'right', color: C.bad });
    }
    const subY = PAD + 17;
    if (c.action) {
      const a = c.action;
      const lw = r.measureText(a.label, 10, false, 'small');
      r.uiText(a.label, right, subY, { size: 10, font: 'small', align: 'right', color: a.ok ? C.goldHi : C.textFaint });
      let kw = 0;
      if (a.key) kw = keycap(r, a.key, right - lw - 4, subY + 6, { align: 'right', pad: a.pad });
      else {
        // touch: the hand icon of the contextual button
        kw = 14;
        r.uiSprite('tc_pick', right - lw - 4 - 7, subY + 6, 1.5, { alpha: a.ok ? 1 : 0.5 });
      }
      right -= lw + 4 + kw + 6;
    } else if (c.note) {
      r.uiText(c.note, right, subY, { size: 10, font: 'small', align: 'right', color: C.textFaint });
      right -= r.measureText(c.note, 10, false, 'small') + 6;
    }
    const nameRight = c.price ? W - PAD - 64 : W - PAD;
    let name = c.name;
    while (name.length > 2 && PAD + 38 + r.measureText(name, 12, true) > nameRight) name = name.slice(0, -1);
    r.uiText(name === c.name ? name : `${name}…`, PAD + 38, PAD, { size: 12, bold: true, color: c.color });
    let sx = PAD + 38;
    for (const sg of c.sub) {
      const tw = r.measureText(sg.t, 10, false, 'small');
      if (sx + tw > right) break;
      r.uiText(sg.t, sx, subY, { size: 10, font: 'small', color: sg.c });
      sx += tw;
    }
    let y = PAD + 35;
    for (const l of this.lines) {
      r.uiText(l, PAD, y, { size: 10, font: 'small', color: C.text });
      y += LINE;
    }
    for (const row of this.extraLines) {
      let ex = PAD;
      for (const sg of row) {
        r.uiText(sg.t, ex, y, { size: 10, font: 'small', color: sg.c });
        ex += r.measureText(sg.t, 10, false, 'small') + (sg.t.endsWith('▲') || sg.t.endsWith('▼') ? 8 : 0);
      }
      y += LINE;
    }
  }
}

function xy(p: { x: number; y: number }): [number, number] {
  return [p.x, p.y];
}
