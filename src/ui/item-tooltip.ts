// Item preview card: when the keeper stands near an item pedestal, a shop ware, a
// potion or a weapon crate (World.focus, see game/interact.ts), a compact card
// with icon, name, rarity, description and context (weapon comparison, active
// charge, price, the interact key) floats above it. The card is anchored to the
// item in world space but drawn in the UI layer, kept inside the safe area and
// below the top HUD rows; its bitmap is cached (UiLayer) until its content changes.

import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import type { World } from '../game/world';
import type { Entity } from '../game/entity';
import { input } from '../engine/input';
import { clamp, ease } from '../engine/math';
import { Actives, Artifacts, Potions, RARITY_COLOR, RARITY_NAME, Sets, Weapons, type Rarity } from '../game/defs';
import { Pedestal, Pickup, itemInfo, potionSpriteFor, type PickupKind } from '../game/pickups';
import { BASE_STATS, StatMods, computeStats, type Stats } from '../game/stats';
import { frame, iconSlot, keycap } from './frame';
import { C } from './theme';
import { actionLabel } from './keys';
import { touchUiActive } from './touch-mode';
import { UiLayer } from './layer-cache';

const CARD_W = 214;
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
  heart_half: ['빨간 반 하트', '체력을 반 칸 회복한다'],
  heart: ['빨간 하트', '체력을 한 칸 회복한다'],
  soul_heart: ['영혼 하트', '푸른 보호막 하트 한 칸'],
  soul_half: ['영혼 반 하트', '푸른 보호막 하트 반 칸'],
  bomb: ['폭탄', '폭탄 1개'],
  bomb2: ['폭탄 묶음', '폭탄 2개'],
  key: ['열쇠', '잠긴 문과 상자를 연다'],
  coin: ['동전', '1코인'],
  nickel: ['은화', '5코인'],
  dime: ['금화', '10코인'],
};
const PICKUP_ICON: Partial<Record<PickupKind, string>> = {
  heart_half: 'pk_heart_half', heart: 'pk_heart', soul_heart: 'pk_soul', soul_half: 'pk_soul_half',
  bomb: 'pk_bomb', bomb2: 'pk_bomb2', key: 'pk_key', coin: 'pk_coin', nickel: 'pk_nickel', dime: 'pk_dime',
};
const WEAPON_KIND: Record<string, string> = { ranged: '원거리', melee: '근접', charge: '차지', beam: '광선' };
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
  if (!out.length) out.push({ t: '비슷한 위력', c: C.textDim });
  return out;
}

/** Card content for a focused entity (null if it shows nothing). */
export function buildCard(w: World, e: Entity): ItemCard | null {
  const p = w.player;
  const pad = input.aimMode === 'pad';
  const keyOf = () => {
    const k = actionLabel(input.bindings, 'interact', pad);
    return k || (touchUiActive() ? '줍기' : 'G');
  };
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
      const tags: Seg[] = [];
      for (const tag of def?.tags ?? []) {
        const s = Sets.get(tag);
        if (!s) continue;
        tags.push({ t: tags.length ? ` · ${s.name}` : `공명 ${s.name}`, c: s.color });
      }
      if (tags.length) extra.push(tags);
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
      sub.push({ t: ` · 무기 · ${def?.archetype ?? WEAPON_KIND[def?.kind ?? ''] ?? ''}`, c: C.textDim });
      extra.push(weaponCompare(it.id, p.weaponId));
      if (p.weapon2Id) {
        const held = Weapons.get(p.weaponId);
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
      label = '거래';
    }
    return { icon: info.icon, name: info.name, color: col, sub, desc: info.desc, extra, action: { key: keyOf(), label, pad, ok }, note: '', price };
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
        extra: [],
        action: null,
        note: p.potionId ? '닿으면 들고 있는 물약과 교체' : '닿으면 줍기',
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
      extra: [],
      action: null,
      note: e.canCollect(w) ? '닿으면 구매' : '지금은 살 필요가 없다',
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

/** Cache signature of everything a card shows (cheap; rebuilt only when it changes). */
function signature(w: World, e: Entity): string {
  const p = w.player;
  let s = `${e.id}|${p.weaponId}|${p.weapon2Id ?? ''}|${p.activeId ?? ''}|${p.potionId ?? ''}|${input.aimMode === 'pad' ? 1 : 0}|${touchUiActive() ? 1 : 0}`;
  if (e instanceof Pedestal) s += `|${e.item?.kind}:${e.item?.id}|${e.price}|${e.heartPrice}|${e.affordable(w) ? 1 : 0}|${p.coins >= e.price ? 1 : 0}|${e.item ? w.items.powerOf(e.item.id) : 0}`;
  else if (e instanceof Pickup) s += `|${e.kind}|${e.potionId}|${w.run.identified.has(e.potionId) ? 1 : 0}|${e.price}|${p.coins >= e.price ? 1 : 0}|${e.canCollect(w) ? 1 : 0}`;
  return s;
}

export class ItemTooltip {
  private readonly ly = new UiLayer();
  /** entity whose card is shown (kept while fading out) */
  private cur: Entity | null = null;
  private card: ItemCard | null = null;
  private sig = '';
  private lines: string[] = [];
  private h = 0;
  /** 0..1 appear progress */
  private a = 0;
  private t = 0;
  private pr: Renderer | null = null;
  private readonly paint = () => this.paintCard(this.pr!);

  update(w: World, dt: number): void {
    this.t += dt;
    const hidden = !!w.bossIntro || w.transitioning || !!w.descending || !w.player?.alive;
    const f = hidden ? null : w.focus;
    if (f && f.dead) this.cur = null;
    if (f === this.cur && f) this.a = Math.min(1, this.a + dt * 7);
    else if (!f || this.a > 0.05) {
      // fade out (quickly when another item takes over)
      this.a = Math.max(0, this.a - dt * (f ? 12 : 6));
      if (this.a <= 0) this.cur = f;
    } else this.cur = f;
    if (this.cur?.dead) this.cur = null;
  }

  /** True while a card is (partly) visible. */
  get visible(): boolean {
    return !!this.cur && this.a > 0.01;
  }

  draw(r: Renderer, w: World, alpha = 1): void {
    const e = this.cur;
    if (!e || this.a <= 0.01 || alpha <= 0.01) return;
    const sig = signature(w, e);
    if (sig !== this.sig || !this.card) {
      this.sig = sig;
      this.card = buildCard(w, e);
      if (this.card) {
        const c = this.card;
        this.lines = r.wrapText(c.desc, CARD_W - PAD * 2, 10, false, 'small').slice(0, 3);
        this.h = PAD + 30 + 4 + this.lines.length * LINE + c.extra.length * LINE + (c.action || c.note || c.price ? 24 : 2) + 4;
      }
    }
    const c = this.card;
    if (!c) return;
    const k = ease.outCubic(clamp(this.a, 0, 1));
    const sa = r.uiSafe;
    // anchor: the item's top in world space -> UI units
    const top = e instanceof Pedestal ? e.y - 22 : e instanceof Pickup ? e.y - 9 : e.y - 10;
    const bottom = e instanceof Pedestal ? e.y + 14 : e.y + 8;
    const at = r.displayToUI(...xy(r.worldToDisplay(e.x, top)));
    const ab = r.displayToUI(...xy(r.worldToDisplay(e.x, bottom)));
    const W = CARD_W;
    const H = this.h;
    let below = false;
    let y = at.y - 8 - H;
    if (y < sa.t + HUD_TOP) {
      below = true;
      y = ab.y + 8;
    }
    y = clamp(y, sa.t + 6, UI_H - sa.b - 6 - H);
    const x = clamp(at.x - W / 2, sa.l + 6, UI_W - sa.r - 6 - W);
    const slide = (1 - k) * (below ? -6 : 6);
    // snap to whole display pixels so the cached bitmap is reused while the camera moves
    const s = r.uiScale;
    const ox = (Math.round(r.uiOffsetX + x * s) - r.uiOffsetX) / s;
    const oy = (Math.round(r.uiOffsetY + (y + slide) * s) - r.uiOffsetY) / s;
    const A = k * alpha;
    // pointer tail toward the item (live: two tiny rects)
    const tx = clamp(at.x, ox + 12, ox + W - 12);
    const rim = c.color;
    const d = r.dctx;
    d.globalAlpha = A;
    for (let i = 0; i < 4; i++) {
      const wdt = (4 - i) * 2;
      const ty = below ? oy - 1 - i : oy + H - 1 + i;
      d.fillStyle = i === 3 ? C.ink : rim;
      d.fillRect(Math.round(tx - wdt / 2), Math.round(ty), wdt, 1);
    }
    d.globalAlpha = 1;
    this.pr = r;
    this.ly.draw(r, `${this.sig}|${H}`, ox, oy, 0, 0, W, H, A, this.paint);
    this.pr = null;
    // "can't pay" shake hint: the price blinks red right after a refused press
    const deny = e instanceof Pedestal ? e.mem.denyT : undefined;
    if (deny !== undefined && w.time - deny < 0.5 && c.price) {
      const bl = 0.5 + 0.5 * Math.sin(this.t * 40);
      r.uiRect(ox + W - 60, oy + H - 24, 52, 18, C.bad, 0.25 * bl * A);
    }
  }

  private paintCard(r: Renderer): void {
    const c = this.card!;
    const W = CARD_W;
    const H = this.h;
    frame(r, 0, 0, W, H, 'tooltip', { color: c.color });
    iconSlot(r, c.icon, PAD + 14, PAD + 14, 30);
    r.uiText(c.name, PAD + 36, PAD, { size: 12, bold: true, color: c.color });
    let sx = PAD + 36;
    for (const s of c.sub) {
      r.uiText(s.t, sx, PAD + 16, { size: 10, font: 'small', color: s.c });
      sx += r.measureText(s.t, 10, false, 'small');
    }
    let y = PAD + 34;
    for (const l of this.lines) {
      r.uiText(l, PAD, y, { size: 10, font: 'small', color: C.text });
      y += LINE;
    }
    for (const row of c.extra) {
      let ex = PAD;
      for (const s of row) {
        r.uiText(s.t, ex, y, { size: 10, font: 'small', color: s.c });
        ex += r.measureText(s.t, 10, false, 'small') + (s.t.endsWith('▲') || s.t.endsWith('▼') ? 8 : 0);
      }
      y += LINE;
    }
    if (!(c.action || c.note || c.price)) return;
    // footer: interact key (or how it is taken) + price
    const fy = H - 22;
    r.uiRect(PAD, fy - 3, W - PAD * 2, 1, C.rimDark);
    const cy = fy + 9;
    if (c.action) {
      const a = c.action;
      const kw = keycap(r, a.key, PAD, cy, { align: 'left', pad: a.pad });
      r.uiText(a.label, PAD + kw + 5, cy - 6, { size: 10, font: 'small', color: a.ok ? C.goldHi : C.textFaint });
    } else if (c.note) {
      r.uiText(c.note, PAD, cy - 6, { size: 10, font: 'small', color: C.textFaint });
    }
    if (c.price) {
      const pc = c.price.ok ? C.goldHi : C.bad;
      r.uiText(c.price.text, W - PAD, cy - 7, { size: 12, bold: true, align: 'right', color: pc });
      const tw = r.measureText(c.price.text, 12, true);
      r.uiSprite(c.price.icon, W - PAD - tw - 18, cy - 8, 2);
      if (!c.price.ok) r.uiText('부족', W - PAD - tw - 24, cy - 6, { size: 10, font: 'small', align: 'right', color: C.bad });
    }
  }
}

function xy(p: { x: number; y: number }): [number, number] {
  return [p.x, p.y];
}
