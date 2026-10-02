// Big in-game announcements: the item plaque (a parchment scroll that unrolls
// between two wooden rollers), small ribbon notices, the boss intro card
// (letterbox + keeper vs boss), the floor title card and room-clear feedback.

import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import type { World, Banner } from '../game/world';
import type { Enemy } from '../game/enemy';
import { clamp, ease } from '../engine/math';
import { animFrame, getSprite, hasAnim } from '../engine/sprites';
import { C, splitFloorName } from './theme';
import { divider, fitScale, frame, glow, spriteCentered } from './frame';
import { envelope } from './anim';

// ---------------------------------------------------------------- item plaque
const BANNER_LIFE = 3.2;

function roller(r: Renderer, x: number, y: number, h: number, a: number): void {
  r.uiRect(x - 5, y - 6, 10, h + 12, C.ink, a);
  r.uiRect(x - 4, y - 5, 8, h + 10, '#6a3e1e', a);
  r.uiRect(x - 4, y - 5, 3, h + 10, '#a0683a', a);
  r.uiRect(x + 2, y - 5, 2, h + 10, '#3a200e', a);
  // brass caps
  for (const cy of [y - 9, y + h + 5]) {
    r.uiRect(x - 4, cy, 8, 4, C.ink, a);
    r.uiRect(x - 3, cy + 1, 6, 2, '#e0a848', a);
    r.uiRect(x - 3, cy + 1, 2, 1, '#fff0b8', a);
  }
}

/** Isaac-style item plaque: unrolls, shows name / desc / quote, rolls back up. */
export function drawPlaque(r: Renderer, b: Banner, y: number): void {
  const t = b.t;
  const unroll = ease.outCubic(clamp(t / 0.32, 0, 1));
  const rollUp = t > 2.65 ? ease.inCubic(clamp((t - 2.65) / 0.35, 0, 1)) : 0;
  const open = unroll * (1 - rollUp);
  const fade = t > 2.95 ? clamp(1 - (t - 2.95) / 0.25, 0, 1) : clamp(t / 0.1, 0, 1);
  if (fade <= 0) return;
  const lines = r.wrapText(b.desc, 300, 12);
  const hasQuote = !!b.quote;
  const h = 36 + lines.length * 15 + (hasQuote ? 17 : 0);
  const fullW = Math.max(240, Math.min(380, Math.max(r.measureText(b.title, 16, true) + (b.icon ? 56 : 30), ...lines.map((l) => r.measureText(l, 12) + 40), hasQuote ? r.measureText(`“${b.quote}”`, 10, false, 'small') + 40 : 0)));
  const w = Math.max(12, fullW * open);
  const x = UI_W / 2 - w / 2;
  const drop = (1 - ease.outBack(clamp(t / 0.3, 0, 1))) * -10;
  const yy = y + drop;
  frame(r, x, yy, w, h, 'parchment', { alpha: fade });
  // rarity ribbon along the top edge
  r.uiRect(x + 4, yy + 4, w - 8, 2, b.color, fade * 0.85);
  const ca = fade * clamp((open - 0.55) / 0.35, 0, 1);
  if (ca > 0) {
    const titleW = r.measureText(b.title, 16, true);
    const iconW = b.icon ? 26 : 0;
    const tx = UI_W / 2 + iconW / 2;
    if (b.icon) {
      const ix = tx - titleW / 2 - 18;
      spriteCentered(r, b.icon, ix, yy + 22, fitScale(b.icon, 24, 1.5), { alpha: ca });
    }
    r.uiText(b.title, tx, yy + 12, { size: 16, bold: true, align: 'center', color: C.parchmentInk, alpha: ca, shadow: '#f4e6c480' });
    lines.forEach((l, i) => r.uiText(l, UI_W / 2, yy + 34 + i * 15, { size: 12, align: 'center', color: '#5a3a1e', alpha: ca, shadow: false }));
    if (hasQuote) r.uiText(`“${b.quote}”`, UI_W / 2, yy + 36 + lines.length * 15, { size: 10, font: 'small', align: 'center', color: '#8a6a44', alpha: ca, shadow: false });
  }
  roller(r, x, yy + 3, h - 6, fade);
  roller(r, x + w, yy + 3, h - 6, fade);
}

/** Smaller dark ribbon notice (potions, resonance tiers, unlocks). */
export function drawRibbon(r: Renderer, b: Banner, y: number): void {
  const t = b.t;
  const a = envelope(t, BANNER_LIFE, 0.2, 0.4);
  if (a <= 0) return;
  const slide = (1 - ease.outCubic(clamp(t / 0.3, 0, 1))) * 24;
  const tw = Math.max(r.measureText(b.title, 12, true), r.measureText(b.desc, 10, false, 'small'));
  const w = Math.min(420, tw + (b.icon ? 54 : 30));
  const h = 36;
  const x = UI_W / 2 - w / 2;
  const yy = y - slide;
  frame(r, x, yy, w, h, 'ribbon', { color: b.color, alpha: a });
  let tx = x + 14;
  if (b.icon) {
    spriteCentered(r, b.icon, x + 22, yy + h / 2, fitScale(b.icon, 22, 1.5), { alpha: a });
    tx = x + 40;
  }
  r.uiText(b.title, tx, yy + 5, { size: 12, bold: true, color: b.color, alpha: a });
  r.uiText(b.desc, tx, yy + 20, { size: 10, font: 'small', color: C.textDim, alpha: a });
}

/** Bottom (UI y) of the banner stack drawn by drawBanners(), or 0 when no banner shows. */
export function bannersBottom(r: Renderer, w: World): number {
  if (!w.banners.length) return 0;
  let y = 58;
  for (const b of w.banners) {
    if (!b.small && b.icon) y += 36 + r.wrapText(b.desc, 300, 12).length * 15 + (b.quote ? 17 : 0) + 12;
    else y += 44;
  }
  return y - 6;
}

/** Draw the world's banner queue: the first non-small one as a plaque, others as ribbons. */
export function drawBanners(r: Renderer, w: World): void {
  let y = 58;
  for (const b of w.banners) {
    if (!b.small && b.icon) {
      drawPlaque(r, b, y);
      y += 36 + r.wrapText(b.desc, 300, 12).length * 15 + (b.quote ? 17 : 0) + 12;
    } else {
      drawRibbon(r, b, y);
      y += 44;
    }
  }
}

// ---------------------------------------------------------------- floor card
export function drawFloorCard(r: Renderer, card: { name: string; subtitle: string; t: number }): void {
  const t = card.t;
  const a = envelope(t, 3, 0.45, 0.7);
  if (a <= 0) return;
  const [floorNo, name] = splitFloorName(card.name);
  const y = UI_H * 0.3;
  // dark band with soft edges
  const d = r.dctx;
  d.save();
  const g = d.createLinearGradient(0, y - 30, 0, y + 90);
  g.addColorStop(0, 'rgba(5,3,10,0)');
  g.addColorStop(0.3, 'rgba(5,3,10,0.72)');
  g.addColorStop(0.7, 'rgba(5,3,10,0.72)');
  g.addColorStop(1, 'rgba(5,3,10,0)');
  d.globalAlpha = a;
  d.fillStyle = g;
  d.fillRect(0, y - 30, UI_W, 120);
  d.restore();
  const spread = ease.outCubic(clamp(t / 0.9, 0, 1));
  if (floorNo) r.uiText(floorNo, UI_W / 2, y - 6, { size: 12, align: 'center', color: C.gold, alpha: a });
  divider(r, UI_W / 2 - 90 - 40 * spread, y + 1, 60 + 40 * spread, C.goldDark, a);
  divider(r, UI_W / 2 + 90 + 40 * spread, y + 1, 60 + 40 * spread, C.goldDark, a);
  // name revealed letter by letter
  const chars = [...name];
  const shown = Math.min(chars.length, Math.floor(clamp((t - 0.15) / 0.55, 0, 1) * chars.length + 0.999));
  const full = r.measureText(name, 24, true);
  const part = chars.slice(0, shown).join('');
  glow(r, UI_W / 2, y + 28, 160, '#ff9a3a', 0.08 * a);
  r.uiText(part, UI_W / 2 - full / 2, y + 14, { size: 24, bold: true, color: C.text, outline: C.ink, alpha: a });
  const sa = a * clamp((t - 0.7) / 0.5, 0, 1);
  r.uiText(card.subtitle, UI_W / 2, y + 48, { size: 12, align: 'center', color: C.textDim, alpha: sa });
}

// ---------------------------------------------------------------- boss intro
export const BOSS_INTRO_LIFE = 2.2;

export function drawBossIntro(r: Renderer, w: World, intro: { enemy: Enemy; t: number }): void {
  const t = intro.t;
  const e = intro.enemy;
  const inK = ease.outCubic(clamp(t / 0.3, 0, 1));
  const outK = t > 1.8 ? ease.inCubic(clamp((t - 1.8) / 0.4, 0, 1)) : 0;
  const k = inK * (1 - outK);
  if (k <= 0) return;
  // letterbox bars
  const bar = 44 * k;
  r.uiRect(0, 0, UI_W, bar, '#000000', 0.95);
  r.uiRect(0, UI_H - bar, UI_W, bar, '#000000', 0.95);
  // slanted band
  const cy = UI_H * 0.5;
  const bh = 128;
  const d = r.dctx;
  d.save();
  d.globalAlpha = 0.86 * k;
  d.fillStyle = '#12060c';
  d.beginPath();
  const skew = 26;
  const slideIn = (1 - inK) * UI_W;
  d.moveTo(-40 - slideIn, cy - bh / 2 + skew);
  d.lineTo(UI_W + 40 - slideIn, cy - bh / 2 - skew);
  d.lineTo(UI_W + 40 + slideIn, cy + bh / 2 - skew);
  d.lineTo(-40 + slideIn, cy + bh / 2 + skew);
  d.closePath();
  d.fill();
  d.globalAlpha = k;
  d.strokeStyle = '#a02030';
  d.lineWidth = 2;
  d.beginPath();
  d.moveTo(-40, cy - bh / 2 + skew);
  d.lineTo(UI_W + 40, cy - bh / 2 - skew);
  d.moveTo(-40, cy + bh / 2 + skew);
  d.lineTo(UI_W + 40, cy + bh / 2 - skew);
  d.stroke();
  // speed streaks
  d.globalAlpha = 0.18 * k;
  d.fillStyle = '#ff4050';
  for (let i = 0; i < 7; i++) {
    const sy = cy - 50 + i * 16;
    const sx = ((t * 900 + i * 173) % (UI_W + 200)) - 100;
    d.fillRect(UI_W - sx, sy, 60 + (i % 3) * 30, 2);
  }
  d.restore();

  // keeper (left)
  const ch = w.player.character;
  const pk = ease.outBack(clamp((t - 0.05) / 0.35, 0, 1)) * (1 - outK);
  const px = 150 - (1 - pk) * 220;
  glow(r, px, cy, 80, ch.color, 0.18 * k);
  const pName = hasAnim(`${ch.spritePrefix}_idle_side`) ? animFrame(`${ch.spritePrefix}_idle_side`, t) : ch.portrait;
  spriteCentered(r, pName, px, cy + 6, 5, { alpha: k });
  r.uiText(ch.name, px, cy + 62, { size: 12, bold: true, align: 'center', color: ch.color, alpha: k });

  // boss (right)
  const bk = ease.outBack(clamp((t - 0.12) / 0.35, 0, 1)) * (1 - outK);
  const bx = UI_W - 190 + (1 - bk) * 260;
  const sprName = e.def.portrait ?? animFrame(e.def.sprite, t);
  const sp = getSprite(sprName);
  const sc = Math.max(2, Math.min(5, Math.floor((150 / Math.max(sp.w, sp.h)) * 2) / 2));
  glow(r, bx, cy, 120, '#ff3040', 0.22 * k);
  const shake = t > 0.35 && t < 0.6 ? Math.sin(t * 90) * 3 : 0;
  spriteCentered(r, sprName, bx + shake, cy - 6, sc, { alpha: k, flash: t > 0.35 && t < 0.45 ? 0.7 : 0 });

  // VS emblem
  const vk = clamp((t - 0.3) / 0.25, 0, 1);
  if (vk > 0) {
    const s = 1 + (1 - ease.outBack(vk)) * 1.2;
    glow(r, UI_W / 2 - 40, cy - 8, 60 * s, '#ff7a30', 0.35 * k);
    d.save();
    d.translate(UI_W / 2 - 40, cy - 8);
    d.scale(s, s);
    r.uiText('VS', 0, -18, { size: 32, bold: true, align: 'center', color: C.emberHi, outline: '#5a0a10', alpha: k * vk });
    d.restore();
  }
  // names
  const nk = clamp((t - 0.4) / 0.3, 0, 1);
  const nx = UI_W / 2 + 70 + (1 - ease.outCubic(nk)) * 40;
  const title = e.def.bossTitle ?? '';
  if (title) r.uiText(title, nx, cy + 20, { size: 12, align: 'center', color: '#e08088', alpha: k * nk });
  r.uiText(e.def.name, nx, cy + 34, { size: 24, bold: true, align: 'center', color: '#ffffff', outline: '#5a0a10', alpha: k * nk });
}

// ---------------------------------------------------------------- room clear
export function drawRoomClear(r: Renderer, t: number, showText: boolean): void {
  const total = 1.7;
  if (t < 0 || t > total) return;
  // golden edge glow
  const ga = Math.max(0, 1 - t / 0.7) * 0.5;
  if (ga > 0) {
    const d = r.dctx;
    d.save();
    d.globalCompositeOperation = 'lighter';
    for (const [x0, y0, x1, y1] of [[0, 0, 0, 40], [0, UI_H, 0, UI_H - 40]] as const) {
      const g = d.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, `rgba(255,200,110,${ga})`);
      g.addColorStop(1, 'rgba(255,200,110,0)');
      d.fillStyle = g;
      d.fillRect(0, Math.min(y0, y1), UI_W, 40);
    }
    d.restore();
  }
  if (!showText) return;
  const a = envelope(t, total, 0.2, 0.6);
  const sp = ease.outCubic(clamp(t / 0.5, 0, 1));
  const y = 100;
  divider(r, UI_W / 2 - 50 - 30 * sp, y + 7, 40 + 30 * sp, C.gold, a);
  divider(r, UI_W / 2 + 50 + 30 * sp, y + 7, 40 + 30 * sp, C.gold, a);
  r.uiText('정화 완료', UI_W / 2, y, { size: 12, bold: true, align: 'center', color: C.goldHi, outline: C.ink, alpha: a });
}
