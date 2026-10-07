// The keeper's life as a lantern flame laid along a glass tube (HUD, UI space).
// Red life is the lamp's own fire; soul hearts are translucent blue fire laid
// over it; one-hit wards are riveted iron plates bolted over both. Every layer
// starts at the left on the same scale, and the one spent first is in front
// (wards, then soul, then red). Whole hearts are told apart by soft, smoky
// gaps in the fire rather than hard walls. When a hit takes life, that stretch
// of fire gutters, chars and smokes out; when the last of it goes the lamp is
// dark. Drawing only: nothing here touches the simulation.

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

/** Trough depth, frame and how far flame tips may rise above the trough (art px). */
const CH = 6;
const RIM = 2;
const CAP = 3;
const LIFT = 5;

/** Art-px geometry of the gauge for the current capacity. */
export function fireGaugeLayout(s: Pick<FireGaugeState, 'red' | 'maxRed' | 'soul' | 'shields'>): { hearts: number; cw: number; inner: number; w: number; h: number } {
  const hearts = Math.max(1, Math.ceil(Math.max(2, s.maxRed, s.red, s.soul, s.shields * 2) / 2));
  const cw = hearts <= 6 ? 10 : hearts <= 8 ? 8 : hearts <= 12 ? 6 : 4;
  const inner = hearts * cw;
  // h includes the headroom the flame tips use above the trough
  return { hearts, cw, inner, w: inner + CAP * 2, h: LIFT + CH + RIM * 2 };
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

const RED_RAMP = ['#6a1a14', '#b8361e', '#f08a32', '#ffc860', '#fff2c0'];
const SOUL_RAMP = ['#0e1a5c', '#1f3cc0', '#3f7cff', '#8cb8ff', '#e8f4ff'];

/** Flame column height (art px) at column i: a burning bed with tongues licking above the trough, dipping at heart boundaries. */
function tongue(i: number, cw: number, t: number, phase: number, low: boolean, tall = 0): number {
  const n = Math.sin(t * 9.1 + i * 1.73 + phase) * .5 + Math.sin(t * 5.3 - i * .91 + phase * 2) * .3 + Math.sin(t * 13.7 + i * 2.9 + phase) * .2;
  const d = Math.min(i % cw, cw - (i % cw));
  const dip = d === 0 ? 4 : d === 1 ? 2 : 0;
  // a crest in the middle of each heart, like one flame per wick
  const crest = Math.cos(((i % cw) / cw - .5) * Math.PI) * 2.2;
  const base = low ? CH - 1.5 : CH + 1 + tall;
  return clamp(Math.round(base + crest + n * 2.2 - dip), 1, CH + LIFT);
}

/** One burning column from the channel bottom (UI y), colored bottom → tip by `ramp`. */
function column(r: Renderer, x: number, bottom: number, h: number, ramp: string[], alpha: number, char = 0): void {
  if (h <= 0 || alpha <= 0) return;
  for (let j = 0; j < h; j++) {
    const k = h <= 1 ? 2 : j === 0 ? 0 : j === 1 ? 1 : j >= h - 1 && h > 3 ? 4 : j >= h - 2 ? 3 : 2;
    const c = char > 0 ? mixColor(ramp[k], '#3a1a1a', char) : ramp[k];
    r.uiRect(x, bottom - (j + 1) * PX, PX, PX, c, alpha);
  }
}

/** Draw the gauge with its top-left at UI (x, y). */
export function drawFireGauge(r: Renderer, x: number, y: number, s: FireGaugeState, fx: FireGaugeFx, alpha: number): void {
  if (alpha <= .01) return;
  const L = fireGaugeLayout(s);
  const { cw, inner } = L;
  y += LIFT * PX;
  const gx = x + CAP * PX, top = y + RIM * PX, bottom = top + CH * PX;
  const unitPx = cw / 2;
  const t = s.t;

  // ---- frame: soot-dark glass channel between brass rims and end caps
  const fh = CH + RIM * 2;
  r.uiRect(x, y + PX, L.w * PX, (fh - 2) * PX, C.ink, alpha);
  r.uiRect(x + PX, y, (L.w - 2) * PX, fh * PX, C.ink, alpha);
  r.uiRect(gx, y + PX, inner * PX, PX, '#e0b064', alpha);
  r.uiRect(gx, bottom, inner * PX, PX, '#7a4e1c', alpha);
  r.uiRect(gx, top, inner * PX, CH * PX, '#140a10', alpha);
  r.uiRect(gx, top, inner * PX, PX, '#24161e', alpha);
  for (const cx of [x + PX, x + (L.w - CAP) * PX]) {
    r.uiRect(cx, y + PX, (CAP - 1) * PX, (fh - 2) * PX, '#b8843c', alpha);
    r.uiRect(cx, y + PX, (CAP - 1) * PX, PX, '#ffe09a', alpha);
    r.uiRect(cx, y + (fh - 2) * PX, (CAP - 1) * PX, PX, '#5a3814', alpha);
  }

  // ---- red fire (the lamp's own life), with dying stretches drawn from their animation
  const dying = (u: number, kind: FxKind): FireFx | undefined => fx.list.find(f => f.kind === kind && u >= f.from && u < f.to);
  for (let i = 0; i < inner; i++) {
    const u = (i + .5) / unitPx, cx = gx + i * PX;
    if (u < s.red) {
      const h = tongue(i, cw, t, 0, s.low);
      const gain = fx.list.find(f => f.kind === 'gain' && u >= f.from && u < f.to);
      const sputter = s.low && Math.sin(t * 23 + i) > .6 ? .55 : 1;
      column(r, cx, bottom, h, RED_RAMP, alpha * sputter);
      if (gain) r.uiRect(cx, bottom - h * PX, PX, h * PX, '#fff6dc', alpha * (1 - gain.t / FX_LIFE.gain) * .8);
    } else {
      const f = dying(u, 'red');
      if (f) drawDying(r, cx, bottom, i, cw, f, RED_RAMP, alpha);
    }
  }
  // soft, smoky gaps between whole hearts (over the red, under soul and wards)
  for (let k = 1; k < L.hearts; k++) {
    const bx = gx + k * cw * PX;
    for (const [dx, a] of [[-1, .5], [0, .5], [-2, .24], [1, .24], [-3, .1], [2, .1]] as const)
      r.uiRect(bx + dx * PX, top, PX, CH * PX, '#120810', alpha * a);
  }

  // ---- soul: translucent blue fire laid over the red from the left
  for (let i = 0; i < inner; i++) {
    const u = (i + .5) / unitPx, cx = gx + i * PX;
    if (u < s.soul) {
      const h = tongue(i, cw, t * 1.2, 2.1, false, 1);
      column(r, cx, bottom, h, SOUL_RAMP, alpha * .74);
      // the tips burn clearer so the blue reads as fire, not a tint
      r.uiRect(cx, bottom - h * PX, PX, PX, SOUL_RAMP[4], alpha * .9);
      if (h > 2) r.uiRect(cx, bottom - (h - 1) * PX, PX, PX, SOUL_RAMP[3], alpha * .75);
    }
    else {
      const f = dying(u, 'soul');
      if (f) drawDying(r, cx, bottom, i, cw, f, SOUL_RAMP, alpha * .74);
    }
  }

  // ---- smoke from stretches that just went out (above the tube)
  for (const f of fx.list) {
    if (f.kind !== 'red' && f.kind !== 'soul') continue;
    const k = f.t / FX_LIFE[f.kind], a0 = f.from * unitPx, a1 = Math.max(a0 + 1, f.to * unitPx);
    for (let p = 0; p < 4; p++) {
      const sx = gx + (a0 + (a1 - a0) * ((p + .5) / 4)) * PX + Math.round(Math.sin(k * 6 + p + f.seed) * 2) * PX;
      const sy = top - Math.round(k * (9 + p * 3)) * PX;
      const fade = Math.max(0, 1 - k) * (k > .1 ? 1 : k / .1);
      const color = f.kind === 'soul' ? '#a8b8e8' : '#8a7a80';
      // a smoke puff that grows as it rises
      const size = (2 + Math.round(k * 2)) * PX;
      r.uiRect(sx, sy, size, size, color, alpha * fade * .5);
      r.uiRect(sx + PX, sy - PX, size - PX, PX, color, alpha * fade * .35);
      // embers thrown up as the flame dies
      if (k < .45) {
        const ex = gx + (a0 + (a1 - a0) * ((p * 2 + 1) / 6)) * PX + Math.round((p - 1) * k * 8) * PX;
        const ey = top - Math.round(k * (16 + p * 6) - k * k * 20) * PX;
        r.uiRect(ex, ey, PX, PX, f.kind === 'soul' ? '#dfe8ff' : p % 2 ? '#ffd27a' : '#ff8a3a', alpha * (1 - k / .45));
      }
    }
  }

  // ---- wards: riveted iron plates bolted over the fire, one heart wide each
  for (let k = 0; k < s.shields; k++) {
    drawPlate(r, gx + k * cw * PX, y, cw, alpha);
    // the fire's heat glows at the seam between plates
    r.uiRect(gx + (k + 1) * cw * PX - PX, top + PX, PX, (CH - 2) * PX, '#ff9a3a', alpha * (.35 + .25 * Math.sin(t * 6 + k)));
  }
  for (const f of fx.list) if (f.kind === 'ward') drawBrokenPlate(r, gx + f.from * cw * PX, y, cw, f.t / FX_LIFE.ward, alpha);
}

/** A stretch of fire that was just lost: the flame shrinks, chars, and leaves a dying ember line. */
function drawDying(r: Renderer, cx: number, bottom: number, i: number, cw: number, f: FireFx, ramp: string[], alpha: number): void {
  const k = f.t / FX_LIFE[f.kind];
  const h = Math.round(tongue(i, cw, f.t * 3, 0, false) * Math.max(0, 1 - k * 1.9));
  if (k < .08) r.uiRect(cx, bottom - CH * PX, PX, CH * PX, '#ffffff', alpha * (1 - k / .08) * .5);
  column(r, cx, bottom, h, ramp, alpha, Math.min(1, k * 1.6));
  const ember = Math.max(0, 1 - Math.max(0, k - .3) / .7);
  if (ember > 0 && (i + f.seed) % 3 !== 0) r.uiRect(cx, bottom - PX, PX, PX, ramp[1], alpha * ember * .9);
}

/** Dark riveted steel, bevelled light top-left, bolted over the rims. */
function drawPlate(r: Renderer, x: number, y: number, cw: number, alpha: number): void {
  const w = (cw - 1) * PX, h = (CH + RIM * 2) * PX;
  r.uiRect(x, y, w, h, C.ink, alpha);
  r.uiRect(x + PX, y + PX, w - 2 * PX, h - 2 * PX, '#4e5666', alpha);
  r.uiRect(x + PX, y + PX, w - 2 * PX, PX, '#b4bece', alpha);
  r.uiRect(x + PX, y + PX, PX, h - 2 * PX, '#8a94a6', alpha);
  r.uiRect(x + PX, y + h - 2 * PX, w - 2 * PX, PX, '#2e3340', alpha);
  r.uiRect(x + w - 2 * PX, y + 2 * PX, PX, h - 3 * PX, '#363c4a', alpha);
  // a raised centre band and four rivets
  r.uiRect(x + 2 * PX, y + Math.floor(h / PX / 2) * PX - PX, w - 4 * PX, PX, '#6c7686', alpha);
  r.uiRect(x + 2 * PX, y + Math.floor(h / PX / 2) * PX, w - 4 * PX, PX, '#3a404e', alpha);
  for (const [rx, ry] of [[2, 2], [w / PX - 3, 2], [2, h / PX - 3], [w / PX - 3, h / PX - 3]]) {
    r.uiRect(x + rx * PX, y + ry * PX, PX, PX, '#e4eaf2', alpha);
  }
}

/** A plate that just took a hit: it splits and the halves drop away with a few sparks. */
function drawBrokenPlate(r: Renderer, x: number, y: number, cw: number, k: number, alpha: number): void {
  const w = (cw - 1) * PX, h = (CH + RIM * 2) * PX, half = Math.floor(w / PX / 2) * PX;
  const fade = alpha * Math.max(0, 1 - k), drop = Math.round(k * k * 14) * PX, spread = Math.round(k * 4) * PX;
  r.uiRect(x - spread, y + drop, half, h, C.ink, fade);
  r.uiRect(x - spread + PX, y + drop + PX, half - PX, h - 2 * PX, '#4e5666', fade);
  r.uiRect(x - spread + PX, y + drop + PX, half - PX, PX, '#b4bece', fade);
  r.uiRect(x + half + spread, y + drop + PX, w - half, h, C.ink, fade);
  r.uiRect(x + half + spread, y + drop + 2 * PX, w - half - PX, h - 2 * PX, '#4e5666', fade);
  if (k < .35) for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + .4, d = (4 + k * 22) * PX;
    r.uiRect(x + half + Math.round(Math.cos(a) * d / PX) * PX, y + h / 2 + Math.round(Math.sin(a) * d / PX * .6) * PX, PX, PX, i % 2 ? '#ffe09a' : '#ffffff', alpha * (1 - k / .35));
  }
}

/** UI point at the front of the burning life (for effects that leave from it). */
export function fireGaugeFront(x: number, y: number, s: Pick<FireGaugeState, 'red' | 'maxRed' | 'soul' | 'shields'>): { x: number; y: number } {
  const L = fireGaugeLayout(s);
  const units = Math.max(s.red, s.soul, s.shields * 2);
  return { x: x + (CAP + (units * L.cw) / 2) * PX, y: y + (LIFT + RIM + CH / 2) * PX };
}
