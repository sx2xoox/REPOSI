// The keeper's life as fire filling a slim brass-edged gauge (HUD, UI space).
// One cell per heart, told apart by soft smoky gaps. A burning cell is filled
// to the brim: a deep red-orange body with brighter tongues flickering up
// through it, so it reads as fire without leaving empty room. A half heart
// fills half a cell, and spent cells stay as dark empty glass, so the amount
// left reads without numbers. Red life is the lamp's own fire; soul hearts are translucent
// blue fire laid over it from the left (the red bed still glows under them);
// one-hit wards are clean light-grey steel plates covering whole cells. The
// layer spent first is in front (wards, then soul, then red). A hit makes that
// stretch gutter, char and smoke out inside its cells; when the last of it goes
// the lamp is dark. Drawing only: nothing here touches the simulation.

import type { Renderer } from '../engine/renderer';
import { clamp, mixColor } from '../engine/math';
import { C, PX } from './theme';

export interface FireGaugeState {
  /** half hearts */
  red: number;
  maxRed: number;
  soul: number;
  /** one-hit wards */
  shields: number;
  /** HUD time (s) */
  t: number;
  /** a heart or less left: the flame sputters */
  low: boolean;
}

/** Cell height and frame thickness (art px): a 1 px ink line and a 1 px brass edge. */
const CH = 8;
const EDGE = 2;

/** Art-px geometry of the gauge for the current capacity. */
export function fireGaugeLayout(s: Pick<FireGaugeState, 'red' | 'maxRed' | 'soul' | 'shields'>): { hearts: number; cw: number; inner: number; w: number; h: number } {
  const hearts = Math.max(1, Math.ceil(Math.max(2, s.maxRed, s.red, s.soul, s.shields * 2) / 2));
  const cw = hearts <= 6 ? 10 : hearts <= 8 ? 8 : hearts <= 12 ? 6 : 4;
  const inner = hearts * cw;
  return { hearts, cw, inner, w: inner + EDGE * 2, h: CH + EDGE * 2 };
}

type FxKind = 'red' | 'soul' | 'ward' | 'gain';
interface FireFx {
  kind: FxKind;
  /** affected stretch, in half hearts (wards: plate index in `from`) */
  from: number;
  to: number;
  t: number;
  seed: number;
}

const FX_LIFE: Record<FxKind, number> = { red: .75, soul: .75, ward: .5, gain: .35 };

/** Remembers the last values and turns losses / gains into short animations. */
export class FireGaugeFx {
  readonly list: FireFx[] = [];
  private last: { red: number; soul: number; shields: number } | null = null;
  private seq = 0;

  update(red: number, soul: number, shields: number, dt: number): void {
    for (const f of this.list) f.t += dt;
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].t >= FX_LIFE[this.list[i].kind]) this.list.splice(i, 1);
    const l = this.last;
    if (l) {
      if (red < l.red) this.push('red', red, l.red);
      if (soul < l.soul) this.push('soul', soul, l.soul);
      for (let k = shields; k < l.shields; k++) this.push('ward', k, k + 1);
      if (red > l.red) this.push('gain', l.red, red);
    }
    this.last = { red, soul, shields };
  }

  private push(kind: FxKind, from: number, to: number): void {
    if (this.list.length > 24) this.list.shift();
    this.list.push({ kind, from, to, t: 0, seed: this.seq++ });
  }
}

/** One fire's colors, from the cell's brim down to its white-hot bed. */
interface FirePalette {
  /** the flame's deep body above the tongues (two tones that shimmer) */
  body: [string, string];
  tongue: string;
  mid: string;
  core: string;
}
const RED: FirePalette = { body: ['#9c2a18', '#b8361c'], tongue: '#ee7428', mid: '#ffb444', core: '#ffe8a4' };
const SOUL: FirePalette = { body: ['#1a2c98', '#2440bc'], tongue: '#3c74ee', mid: '#88b6ff', core: '#e6f2ff' };

/**
 * Tongue height inside a cell (art px, 1..CH): two pointed tongues per heart
 * whose tips flicker on their own, lower toward the gaps between hearts.
 */
function tongue(i: number, cw: number, t: number, phase: number, low: boolean): number {
  const local = i % cw, half = cw / 2;
  const which = Math.floor(i / half), q = ((local % half) + .5) / half;
  const shape = 1 - Math.abs(q * 2 - 1);
  const flick = Math.sin(t * 8.3 + which * 2.37 + phase) * .6 + Math.sin(t * 13.1 + which * 1.21 + phase * 2) * .4;
  const peak = CH - .4 + flick * 1.05, trough = CH - 4.2 + Math.sin(t * 6.1 + i * 1.9 + phase) * .5;
  const edge = local === 0 || local === cw - 1 ? 1.2 : 0;
  return clamp(Math.round(trough + (peak - trough) * shape - edge - (low ? 2.5 : 0)), 1, CH);
}

/**
 * One full-height burning column from the cell bottom (UI y): a white-hot bed,
 * a bright middle and the tongue up to height `h`, and above it the flame's
 * deep body up to the brim, so a burning cell never shows empty room. `skip`
 * leaves bottom rows to the layer underneath; `char` darkens a dying column.
 */
function column(r: Renderer, x: number, bottom: number, h: number, pal: FirePalette, alpha: number, char = 0, skip = 0, i = 0, t = 0): void {
  if (alpha <= 0) return;
  const core = Math.max(1, Math.round(h * .34)), mid = Math.max(core + 1, Math.round(h * .68));
  for (let j = skip; j < CH; j++) {
    let c = j < core ? pal.core : j < mid ? pal.mid : j < h ? pal.tongue : pal.body[Math.sin(t * 7 + i * 1.3 + j * 2.1) > .1 ? 1 : 0];
    if (char > 0) c = mixColor(c, '#1e1014', char);
    r.uiRect(x, bottom - (j + 1) * PX, PX, PX, c, alpha);
  }
}

/** Draw the gauge with its top-left at UI (x, y). */
export function drawFireGauge(r: Renderer, x: number, y: number, s: FireGaugeState, fx: FireGaugeFx, alpha: number): void {
  if (alpha <= .01) return;
  const L = fireGaugeLayout(s);
  const { cw, inner } = L;
  const gx = x + EDGE * PX, top = y + EDGE * PX, bottom = top + CH * PX;
  const unitPx = cw / 2;
  const t = s.t;

  // ---- frame: a 1 px ink line and a thin brass edge (light on top, dark below)
  r.uiRect(x + PX, y, (L.w - 2) * PX, L.h * PX, C.ink, alpha);
  r.uiRect(x, y + PX, L.w * PX, (L.h - 2) * PX, C.ink, alpha);
  r.uiRect(gx - PX, top - PX, (inner + 2) * PX, PX, '#d8a858', alpha);
  r.uiRect(gx - PX, bottom, (inner + 2) * PX, PX, '#6a4218', alpha);
  r.uiRect(gx - PX, top, PX, CH * PX, '#a0702e', alpha);
  r.uiRect(gx + inner * PX, top, PX, CH * PX, '#7a4e1c', alpha);
  // empty glass: dark, with a faint floor line so every empty cell still reads as a slot
  r.uiRect(gx, top, inner * PX, CH * PX, '#120a10', alpha);
  r.uiRect(gx, bottom - PX, inner * PX, PX, '#24161c', alpha);

  // ---- red fire (the lamp's own life); dying stretches play their animation
  const dying = (u: number, kind: FxKind): FireFx | undefined => fx.list.find(f => f.kind === kind && u >= f.from && u < f.to);
  for (let i = 0; i < inner; i++) {
    const u = (i + .5) / unitPx, cx = gx + i * PX;
    if (u < s.red) {
      const h = tongue(i, cw, t, 0, s.low);
      const sputter = s.low && Math.sin(t * 23 + i) > .6 ? .55 : 1;
      column(r, cx, bottom, h, RED, alpha * sputter, 0, 0, i, t);
      const gain = fx.list.find(f => f.kind === 'gain' && u >= f.from && u < f.to);
      if (gain) r.uiRect(cx, top, PX, CH * PX, '#fff6dc', alpha * (1 - gain.t / FX_LIFE.gain) * .7);
    } else {
      const f = dying(u, 'red');
      if (f) drawDying(r, cx, bottom, i, cw, f, RED, alpha);
    }
  }

  // ---- soul: translucent blue fire over the red; where red lies under it, its glowing bed stays visible
  for (let i = 0; i < inner; i++) {
    const u = (i + .5) / unitPx, cx = gx + i * PX;
    if (u < s.soul) {
      const h = tongue(i, cw, t * 1.2, 2.1, false);
      column(r, cx, bottom, h, SOUL, alpha * .8, 0, u < s.red ? 1 : 0, i, t * 1.2);
    } else {
      const f = dying(u, 'soul');
      if (f) drawDying(r, cx, bottom, i, cw, f, SOUL, alpha * .8);
    }
  }

  // ---- soft, smoky gaps between burning hearts; spent slots keep a faint seam
  // and the brass edge a small notch, so the capacity reads even when dark
  const lit = Math.max(s.red, s.soul);
  for (let k = 1; k < L.hearts; k++) {
    const bx = gx + k * cw * PX;
    r.uiRect(bx - PX, top - PX, PX, PX, '#8a5c26', alpha);
    if (k * 2 - .5 < lit) {
      for (const [dx, a] of [[-1, .5], [0, .5], [-2, .22], [1, .22], [-3, .08], [2, .08]] as const)
        r.uiRect(bx + dx * PX, top, PX, CH * PX, '#0e070c', alpha * a);
    } else if (!fx.list.some(f => (f.kind === 'red' || f.kind === 'soul') && f.from < k * 2 && f.to > k * 2 - 1)) {
      r.uiRect(bx - PX, top + PX, PX, (CH - 2) * PX, '#2e1e26', alpha);
    }
  }

  // ---- embers and a thin wisp from stretches that just went out
  for (const f of fx.list) {
    if (f.kind !== 'red' && f.kind !== 'soul') continue;
    const k = f.t / FX_LIFE[f.kind], a0 = f.from * unitPx, a1 = Math.max(a0 + 1, f.to * unitPx);
    for (let p = 0; p < 3; p++) {
      const ex = gx + Math.round(a0 + (a1 - a0) * ((p + .5) / 3)) * PX;
      const ey = bottom - Math.round(2 + k * (CH - 2) * (.6 + p * .2)) * PX;
      if (ey > top) r.uiRect(ex, ey, PX, PX, f.kind === 'soul' ? '#dfe8ff' : p % 2 ? '#ffd27a' : '#ff8a3a', alpha * Math.max(0, 1 - k * 1.4));
      const wisp = Math.max(0, 1 - k) * Math.min(1, k * 6);
      r.uiRect(ex + Math.round(Math.sin(k * 6 + p + f.seed)) * PX, top - Math.round(k * (6 + p * 2)) * PX, PX, PX * 2, f.kind === 'soul' ? '#a8b8e8' : '#8a7a80', alpha * wisp * .45);
    }
  }

  // ---- wards: clean light-grey steel plates covering whole cells
  for (let k = 0; k < s.shields; k++) drawPlate(r, gx + k * cw * PX, top, cw, alpha);
  for (const f of fx.list) if (f.kind === 'ward') drawBrokenPlate(r, gx + f.from * cw * PX, top, cw, f.t / FX_LIFE.ward, alpha);
}

/** A stretch of fire that was just lost: the flame shrinks, chars, and leaves a dying ember line. */
function drawDying(r: Renderer, cx: number, bottom: number, i: number, cw: number, f: FireFx, pal: FirePalette, alpha: number): void {
  const k = f.t / FX_LIFE[f.kind];
  const h = Math.round(tongue(i, cw, f.t * 3, 0, false) * Math.max(0, 1 - k * 1.9));
  if (k < .08) r.uiRect(cx, bottom - CH * PX, PX, CH * PX, '#ffffff', alpha * (1 - k / .08) * .5);
  // the whole cell chars and fades out from the top as the fire dies
  column(r, cx, bottom, h, pal, alpha * Math.max(0, 1 - k * 1.25), Math.min(1, k * 1.6), 0, i, f.t);
  const ember = Math.max(0, 1 - Math.max(0, k - .3) / .7);
  if (ember > 0 && (i + f.seed) % 3 !== 0) r.uiRect(cx, bottom - PX, PX, PX, pal.tongue, alpha * ember * .9);
}

/** A plain light-grey steel plate over one cell: soft top light, a darker lower edge, nothing else. */
function drawPlate(r: Renderer, x: number, top: number, cw: number, alpha: number): void {
  const w = cw * PX, h = CH * PX;
  r.uiRect(x, top, w, h, '#c4c9d2', alpha);
  r.uiRect(x, top, w, PX, '#eef1f5', alpha);
  r.uiRect(x, top + PX, PX, h - 2 * PX, '#dde1e8', alpha);
  r.uiRect(x, top + h - PX, w, PX, '#8e949f', alpha);
  r.uiRect(x + w - PX, top + PX, PX, h - 2 * PX, '#a7adb8', alpha);
  // a faint diagonal sheen
  r.uiRect(x + 2 * PX, top + 2 * PX, PX, PX, '#f4f6f9', alpha * .8);
  r.uiRect(x + 3 * PX, top + PX * 1, PX, PX, '#f4f6f9', alpha * .5);
  // the seam to the next cell
  r.uiRect(x + w - PX, top, PX, h, '#6c727c', alpha * .7);
}

/** A plate that just took a hit: it splits and the halves drop away with a few sparks. */
function drawBrokenPlate(r: Renderer, x: number, top: number, cw: number, k: number, alpha: number): void {
  const w = cw * PX, h = CH * PX, half = Math.floor(cw / 2) * PX;
  const fade = alpha * Math.max(0, 1 - k), drop = Math.round(k * k * 12) * PX, spread = Math.round(k * 4) * PX;
  r.uiRect(x - spread, top + drop, half, h, '#c4c9d2', fade);
  r.uiRect(x - spread, top + drop, half, PX, '#eef1f5', fade);
  r.uiRect(x + half + spread, top + drop + PX, w - half, h, '#b4bac4', fade);
  if (k < .35) for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + .4, d = 3 + k * 20;
    r.uiRect(x + half + Math.round(Math.cos(a) * d) * PX, top + h / 2 + Math.round(Math.sin(a) * d * .6) * PX, PX, PX, i % 2 ? '#ffffff' : '#e4e8ee', alpha * (1 - k / .35));
  }
}

/** UI point at the front of the burning life (for effects that leave from it). */
export function fireGaugeFront(x: number, y: number, s: Pick<FireGaugeState, 'red' | 'maxRed' | 'soul' | 'shields'>): { x: number; y: number } {
  const L = fireGaugeLayout(s);
  const units = Math.max(s.red, s.soul, s.shields * 2);
  return { x: x + (EDGE + (units * L.cw) / 2) * PX, y: y + (EDGE + CH / 2) * PX };
}
