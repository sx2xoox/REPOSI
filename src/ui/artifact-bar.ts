// HUD artifact row (Soul Knight buff-bar style): every collected artifact and
// floor blessing as a small icon along the top edge, between the hearts and
// the minimap — stack counts, a pop when taken, a flash whenever its effect
// procs — plus the "위력" (power) readout that ticks up as the keeper grows.
// Also draws the proc icon pops above the keeper. The static part is painted
// into a cached UiLayer; only animating cells are drawn live.

import type { Renderer } from '../engine/renderer';
import type { World } from '../game/world';
import { RARITY_COLOR, type ArtifactDef } from '../game/defs';
import { defineDrawnSprite } from '../engine/sprites';
import { clamp, ease } from '../engine/math';
import { UiLayer } from './layer-cache';
import { ChangeTracker, popScale } from './anim';
import { glow, spriteCentered } from './frame';
import { C } from './theme';
import { touchUiActive } from './touch-mode';
import { powerScore } from '../game/power';
import type { InvComputed } from '../game/inventory';

/** cell pitch / icon size (UI units) */
export const BAR_CELL = 18;
const ICON = 16;
const BADGE_W = 58;
const MAX_ROWS = 2;
const NEW_POP = 0.55;
const FLASH = 0.45;
const POP_LIFE = 0.95;

defineDrawnSprite('hud_power', 9, 9, (p) => {
  p.poly([4.5, 0, 5.8, 3.2, 9, 3.4, 6.5, 5.6, 7.4, 9, 4.5, 7.1, 1.6, 9, 2.5, 5.6, 0, 3.4, 3.2, 3.2], '#ffd040');
  p.poly([4.5, 0, 5.8, 3.2, 9, 3.4, 4.5, 4.6], '#fff2a0');
  p.px(4, 4, '#ffffff');
}, { outline: '#3a2008' });

interface Entry {
  def: ArtifactDef;
  power: number;
}

export interface BarLayout {
  /** icons per row */
  cols: number;
  rows: number;
  /** icons drawn (the rest is summarized as "+N") */
  shown: number;
}

/** How many icons fit between `left` and `right` (UI units) in at most MAX_ROWS rows. */
export function artifactBarLayout(count: number, left: number, right: number): BarLayout {
  const cols = Math.max(1, Math.floor((right - left - BADGE_W - 6) / BAR_CELL));
  const rows = Math.min(MAX_ROWS, Math.max(1, Math.ceil(count / cols)));
  const cap = cols * MAX_ROWS;
  const shown = count > cap ? cap - 1 : count;
  return { cols, rows, shown };
}

/**
 * UI units to keep free left of the minimap for the touch system buttons
 * (pause / map / inventory row, see touch-logic.ts) in touch mode.
 */
function touchReserve(r: Renderer): number {
  if (!touchUiActive() || typeof document === 'undefined') return 0;
  const cv = r.display;
  const cssW = cv.clientWidth || cv.width;
  const cssH = cv.clientHeight || cv.height;
  const k = cv.width / Math.max(1, cssW);
  const u = clamp(Math.min(cssW, cssH) / 380, 0.8, 1.3);
  return (3 * 34 + 2 * 10 + 12) * u * (k / r.uiScale);
}

export class ArtifactBar {
  private readonly ly = new UiLayer();
  private comp: InvComputed | null = null;
  private entries: Entry[] = [];
  private idsKey = '';
  /** HUD time each artifact was first shown (pop-in) */
  private seen = new Map<string, number>();
  private t = 0;
  private started = false;
  readonly power = new ChangeTracker(0, 1.6);
  private powerVal = 0;
  // prebound paint callback inputs
  private pr: Renderer | null = null;
  private px0 = 0;
  private py0 = 0;
  private play: BarLayout = { cols: 1, rows: 1, shown: 0 };
  private readonly paint = () => this.paintStatic(this.pr!);

  update(w: World, dt: number): void {
    this.t += dt;
    const comp = w.items.computed;
    if (comp !== this.comp) {
      this.comp = comp;
      this.entries = (comp?.artifacts ?? []).map((a) => ({ def: a.def, power: a.power }));
      this.idsKey = this.entries.map((e) => `${e.def.id}:${e.power}`).join(',');
      for (const e of this.entries) if (!this.seen.has(e.def.id)) this.seen.set(e.def.id, this.started ? this.t : -9);
    }
    this.started = true;
    const p = w.player;
    if (p?.stats) this.powerVal = powerScore(p.weaponStats, comp);
    this.power.update(this.powerVal, dt);
  }

  /**
   * Draw the row in the HUD space translated by (ox, oy) (the safe-area inset),
   * between x = `left` and `right`; then the proc pops above the keeper.
   */
  draw(r: Renderer, w: World, A: number, ox: number, oy: number, left: number, right: number): void {
    const p = w.player;
    if (!p) return;
    if (A > 0.01) {
      const lim = right - touchReserve(r);
      const L = artifactBarLayout(this.entries.length, left, lim);
      this.play = L;
      this.px0 = left;
      this.py0 = 8;
      this.pr = r;
      const wpx = BADGE_W + 6 + Math.max(1, Math.min(this.entries.length, L.cols)) * BAR_CELL;
      const hpx = L.rows * BAR_CELL + 6;
      const key = `${this.idsKey}|${L.cols}|${this.powerVal}`;
      const d = r.dctx;
      d.save();
      d.translate(ox, oy);
      const busy = this.power.pop > 0 || this.power.age < 1.4;
      if (!busy) this.ly.draw(r, key, ox, oy, left - 4, 4, wpx + 8, hpx + 4, A, this.paint);
      else this.paintStatic(r, A);
      this.drawLive(r, w, A);
      d.restore();
      this.pr = null;
    }
    this.drawPops(r, w);
  }

  private cellPos(i: number): { x: number; y: number } {
    const L = this.play;
    return { x: this.px0 + BADGE_W + 6 + (i % L.cols) * BAR_CELL + BAR_CELL / 2, y: this.py0 + Math.floor(i / L.cols) * BAR_CELL + BAR_CELL / 2 };
  }

  private paintStatic(r: Renderer, A = 1): void {
    const L = this.play;
    const x0 = this.px0;
    const y0 = this.py0;
    // power badge
    this.drawBadge(r, A, 1);
    const n = this.entries.length;
    if (!n) return;
    const cols = Math.min(n, L.cols);
    // translucent backing strip per row
    for (let row = 0; row < L.rows; row++) {
      const inRow = Math.min(cols, n - row * L.cols);
      if (inRow <= 0) break;
      r.uiRect(x0 + BADGE_W + 4, y0 + row * BAR_CELL - 1, inRow * BAR_CELL + 4, BAR_CELL + 2, C.ink, 0.5 * A);
    }
    for (let i = 0; i < Math.min(n, L.shown); i++) this.drawCell(r, i, A, 1, 0);
    if (L.shown < n) {
      const c = this.cellPos(L.shown);
      r.uiText(`+${n - L.shown}`, c.x, c.y - 6, { size: 10, font: 'small', align: 'center', color: C.goldHi, alpha: A, outline: C.ink });
    }
  }

  private drawCell(r: Renderer, i: number, A: number, scale: number, flash: number): void {
    const e = this.entries[i];
    const c = this.cellPos(i);
    const col = e.def.blessing ? '#ffd060' : RARITY_COLOR[e.def.rarity];
    // rarity underline (blessings: gold corners)
    if (e.def.blessing) {
      r.uiRect(c.x - 8, c.y - 8, 3, 1, col, 0.9 * A);
      r.uiRect(c.x - 8, c.y - 8, 1, 3, col, 0.9 * A);
      r.uiRect(c.x + 5, c.y + 7, 3, 1, col, 0.9 * A);
      r.uiRect(c.x + 7, c.y + 5, 1, 3, col, 0.9 * A);
    } else r.uiRect(c.x - 6, c.y + 8, 12, 1, col, 0.75 * A);
    spriteCentered(r, e.def.icon, c.x, c.y, scale, { alpha: A, flash });
    if (e.power > 1) r.uiText(`${e.power}`, c.x + 9, c.y + 1, { size: 10, font: 'small', align: 'right', color: C.goldHi, alpha: A, outline: C.ink });
  }

  private drawBadge(r: Renderer, A: number, sc: number): void {
    const x = this.px0;
    const y = this.py0;
    r.uiRect(x, y - 1, BADGE_W, BAR_CELL + 2, C.ink, 0.62 * A);
    r.uiRect(x + 1, y + BAR_CELL, BADGE_W - 2, 1, C.goldDark, 0.9 * A);
    spriteCentered(r, 'hud_power', x + 9, y + 9, 1.5 * sc, { alpha: A });
    const hot = this.power.pop > 0.05 && this.power.dir > 0;
    r.uiText(String(this.powerVal), x + 19, y + 2, { size: 12, bold: true, color: hot ? C.good : C.goldHi, alpha: A, outline: C.ink });
  }

  /** Animated parts: new-item pops, proc flashes, the power tick. */
  private drawLive(r: Renderer, w: World, A: number): void {
    const L = this.play;
    const now = w.time;
    const n = Math.min(this.entries.length, L.shown);
    for (let i = 0; i < n; i++) {
      const e = this.entries[i];
      const age = this.t - (this.seen.get(e.def.id) ?? -9);
      const fl = now - w.items.lastProc(e.def.id);
      if (age >= NEW_POP && fl >= FLASH) continue;
      const c = this.cellPos(i);
      if (fl < FLASH) {
        const k = 1 - fl / FLASH;
        glow(r, c.x, c.y, 14, '#fff0c0', 0.5 * k * A);
        this.drawCell(r, i, A, 1 + 0.25 * k, k * 0.85);
      } else {
        const k = clamp(age / NEW_POP, 0, 1);
        glow(r, c.x, c.y, 16, '#ffe080', 0.6 * (1 - k) * A);
        this.drawCell(r, i, A, popScale(1 - k, 0.7), (1 - k) * 0.7);
      }
    }
    // power tick: "+N" rising next to the badge
    const tr = this.power;
    if (tr.pop > 0) {
      const k = popScale(tr.pop, 0.35);
      if (tr.dir > 0) glow(r, this.px0 + 9, this.py0 + 9, 18, '#ffd040', 0.5 * tr.pop * A);
      if (k !== 1) this.drawBadge(r, A, k);
    }
    if (tr.age < 1.4 && tr.delta !== 0) {
      const a = clamp(1 - tr.age / 1.4, 0, 1) * A;
      r.uiText(`${tr.delta > 0 ? '+' : ''}${Math.round(tr.delta)}`, this.px0 + BADGE_W - 3, this.py0 + 20 + tr.age * 6, { size: 10, font: 'small', align: 'right', color: tr.delta > 0 ? C.good : C.bad, alpha: a, outline: C.ink });
    }
  }

  /** Icon pops above the keeper for recent (non-quiet) procs. */
  private drawPops(r: Renderer, w: World): void {
    const log = w.items.procLog;
    if (!log.length) return;
    const now = w.time;
    let n = 0;
    for (let i = log.length - 1; i >= 0 && n < 3; i--) {
      const e = log[i];
      if (now - e.t > POP_LIFE) break;
      if (e.pop) n++;
    }
    if (!n) return;
    const p = w.player;
    const dp = r.worldToDisplay(p.x, p.y - 27);
    const base = r.displayToUI(dp.x, dp.y);
    let k = 0;
    for (let i = log.length - 1; i >= 0 && k < n; i--) {
      const e = log[i];
      if (!e.pop) continue;
      const age = now - e.t;
      if (age > POP_LIFE) break;
      const f = age / POP_LIFE;
      const a = f < 0.12 ? f / 0.12 : f > 0.7 ? (1 - f) / 0.3 : 1;
      const x = base.x + (k - (n - 1) / 2) * 22;
      const y = base.y - ease.outCubic(Math.min(1, f * 1.6)) * 12;
      const sc = popScale(Math.max(0, 1 - f * 3), 0.5);
      glow(r, x, y, 16, '#fff0c0', 0.45 * a);
      r.uiRect(x - 9, y - 9, 18, 18, C.ink, 0.45 * a);
      spriteCentered(r, e.icon, x, y, sc, { alpha: a, flash: f < 0.15 ? 0.6 : 0 });
      k++;
    }
  }
}
