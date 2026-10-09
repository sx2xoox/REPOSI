// Lantern-keeper HUD chrome, painted at art resolution (1 art px = PX UI units)
// like the other UI frames and cached per size / variant:
//   - the brass lantern whose glass is the ember (등불 해방) gauge,
//   - the keeper plate behind the hearts and the purse (coins / bombs / keys),
//   - the gear rack behind the weapons, active item and potion,
//   - small rarity gems for equipment slots.
// Only the static chrome is cached here; the HUD draws the live parts (glass
// fill, flame, numbers) on top every frame.

import { PixelPainter, bayer } from '../engine/painter';
import type { Renderer } from '../engine/renderer';
import { clamp, mixColor } from '../engine/math';
import { C, PX } from './theme';

// ---------------------------------------------------------------- lanterns
/**
 * The release lantern (ember gauge) stands in the HUD's bottom-left corner; the
 * keeper's life is the fire gauge in hud-fire.ts. Lantern frames are built
 * procedurally (ring handle, stepped cap, posts around the glass, stepped base;
 * bosses reuse them through paintLantern); generated PixelLab art can replace a
 * frame (see setLanternArt / pixellab-hud.ts). The 'health' kind remains for
 * that art and the procedural pair, but the HUD no longer draws it.
 */
export type LanternKind = 'release' | 'health';

export interface LanternSpec {
  /** art size (px) */
  w: number;
  h: number;
  /** glass chamber, art px relative to the lantern's top-left */
  glass: { x: number; y: number; w: number; h: number };
}

/** Lantern frame rows (art px): k ink, Y/y/d brass ramp, G glass back, R/r cap jewel. */
function lanternRows(w: number, glassH: number, jewel: boolean): string[] {
  const c = w / 2;
  const row = (fill: (x: number) => string) => Array.from({ length: w }, (_, x) => fill(x)).join('');
  const rows: string[] = [];
  rows.push(row((x) => (x >= c - 3 && x <= c + 2 ? 'k' : '.')));
  rows.push(row((x) => (x === c - 4 || x === c + 3 ? 'k' : x === c - 3 ? 'Y' : x === c + 2 ? 'd' : x > c - 3 && x < c + 2 ? 'y' : '.')));
  for (let i = 0; i < 2; i++) rows.push(row((x) => (x === c - 4 || x === c - 2 || x === c + 1 || x === c + 3 ? 'k' : x === c - 3 ? 'y' : x === c + 2 ? 'd' : '.')));
  rows.push(row((x) => (x >= c - 4 && x <= c + 3 ? 'k' : '.')));
  rows.push(row((x) => {
    if (x === c - 5 || x === c + 4) return 'k';
    if (jewel && (x === c - 1 || x === c)) return x === c - 1 ? 'R' : 'r';
    if (x >= c - 4 && x <= c - 2) return 'Y';
    if (x >= c - 1 && x <= c + 2) return 'y';
    return x === c + 3 ? 'd' : '.';
  }));
  rows.push(row((x) => (x === 1 || x === 2 || x === w - 3 || x === w - 2 ? 'k' : x === 3 ? 'Y' : x >= w - 5 && x <= w - 4 ? 'd' : x > 3 && x < w - 5 ? 'y' : '.')));
  rows.push(row((x) => (x >= 1 && x <= w - 2 ? 'k' : '.')));
  for (let i = 0; i < glassH; i++) {
    rows.push(row((x) => (x === 1 || x === 3 || x === w - 4 || x === w - 2 ? 'k' : x === 2 ? 'Y' : x === w - 3 ? 'd' : x > 3 && x < w - 4 ? 'G' : '.')));
  }
  rows.push(row((x) => (x >= 1 && x <= w - 2 ? 'k' : '.')));
  rows.push(row((x) => (x === 1 || x === w - 2 ? 'k' : x >= 2 && x <= 6 ? 'Y' : x === w - 3 ? 'd' : x > 6 && x < w - 3 ? 'y' : '.')));
  rows.push(row((x) => (x === 2 || x === w - 3 ? 'k' : x > 2 && x < w - 3 ? 'y' : '.')));
  rows.push(row((x) => (x === 3 || x === w - 3 ? 'k' : x > 3 && x < w - 3 ? 'd' : '.')));
  rows.push(row((x) => (x >= 4 && x <= w - 5 ? 'k' : '.')));
  return rows;
}

function makeSpec(w: number, glassH: number): LanternSpec {
  return { w, h: glassH + 13, glass: { x: 4, y: 8, w: w - 8, h: glassH } };
}

const PROC_SPEC: Record<LanternKind, LanternSpec> = {
  release: makeSpec(18, 15),
  health: makeSpec(22, 22),
};

const LANTERN_PAL = {
  dim: { k: C.ink, Y: '#f0c87a', y: '#b8843c', d: '#6a4218', G: '#160d14', R: '#ff8a8a', r: '#b81830' },
  lit: { k: C.ink, Y: '#fff4c8', y: '#ffc860', d: '#b07028', G: '#2a140c', R: '#ff8a8a', r: '#b81830' },
  health: { k: C.ink, Y: '#f0c87a', y: '#b8843c', d: '#6a4218', G: '#1a0c10', R: '#ffb0b0', r: '#d0283c' },
} as const;

/**
 * PixelLab frames, when generated, split at the glass window: `back` holds the
 * panes' own pixels (dark glass, wick cup) and is drawn under the ember / life,
 * so the light covers what sits behind the glass; `front` is the frame with the
 * panes cleared, drawn over the light. `bars` are the art columns inside the
 * window that stay in front (the posts between the panes of a many-sided
 * lantern), so the light shows through the panes rather than as one block.
 */
const lanternArt = new Map<LanternKind, { front: HTMLCanvasElement; back: HTMLCanvasElement; spec: LanternSpec }>();

/** Install a generated lantern (whole image, native pixels), its glass window and the posts inside it (art px). */
export function setLanternArt(kind: LanternKind, canvas: HTMLCanvasElement, glass: LanternSpec['glass'], bars: readonly number[] = []): void {
  const make = () => {
    const cv = document.createElement('canvas');
    cv.width = canvas.width;
    cv.height = canvas.height;
    return cv;
  };
  const front = make();
  const fx = front.getContext('2d')!;
  fx.drawImage(canvas, 0, 0);
  const back = make();
  const bx = back.getContext('2d')!;
  for (let x = glass.x; x < glass.x + glass.w; x++) {
    if (bars.includes(x)) continue;
    fx.clearRect(x, glass.y, 1, glass.h);
    bx.drawImage(canvas, x, glass.y, 1, glass.h, x, glass.y, 1, glass.h);
  }
  lanternArt.set(kind, { front, back, spec: { w: canvas.width, h: canvas.height, glass } });
}

/** Active spec (art px) for a lantern kind. */
export function lanternSpec(kind: LanternKind): LanternSpec {
  return lanternArt.get(kind)?.spec ?? PROC_SPEC[kind];
}

/** Back-compat sizes of the release lantern. */
export const LANTERN_W = PROC_SPEC.release.w;
export const LANTERN_H = PROC_SPEC.release.h;
export const LANTERN_GLASS = PROC_SPEC.release.glass;

// ---------------------------------------------------------------- canvas cache
const cache = new Map<string, HTMLCanvasElement>();

function cached(key: string, paint: () => PixelPainter): HTMLCanvasElement {
  let cv = cache.get(key);
  if (!cv) {
    if (cache.size > 64) cache.clear();
    cv = paint().toCanvas();
    cache.set(key, cv);
  }
  return cv;
}

/** Blit a cached art-pixel canvas at UI (x, y), scaled to the UI grid. */
export function blitArt(r: Renderer, cv: HTMLCanvasElement, x: number, y: number, alpha = 1): void {
  if (alpha <= 0) return;
  const d = r.dctx;
  d.globalAlpha = clamp(alpha, 0, 1);
  d.imageSmoothingEnabled = false;
  d.drawImage(cv, Math.round(x), Math.round(y), cv.width * PX, cv.height * PX);
  d.globalAlpha = 1;
}

/** Pure painter for a procedural lantern frame (tests / cache). */
export function paintLantern(kind: LanternKind | boolean, lit = false): PixelPainter {
  const k: LanternKind = typeof kind === 'boolean' ? 'release' : kind;
  const isLit = typeof kind === 'boolean' ? kind : lit;
  const spec = PROC_SPEC[k];
  const p = new PixelPainter(spec.w, spec.h);
  const pal = k === 'health' ? LANTERN_PAL.health : isLit ? LANTERN_PAL.lit : LANTERN_PAL.dim;
  p.stamp(0, 0, lanternRows(spec.w, spec.glass.h, k === 'health'), pal);
  return p;
}

export function lanternCanvas(kind: LanternKind | boolean, lit = false): HTMLCanvasElement {
  const k: LanternKind = typeof kind === 'boolean' ? 'release' : kind;
  const isLit = typeof kind === 'boolean' ? kind : lit;
  return cached(`lantern|${k}|${isLit ? 1 : 0}`, () => paintLantern(k, isLit));
}

/** Frame of a lantern: generated art (front layer) when installed, else the procedural one. */
function blitFrame(r: Renderer, kind: LanternKind, lit: boolean, x: number, y: number, alpha: number): void {
  const art = lanternArt.get(kind);
  blitArt(r, art ? art.front : lanternCanvas(kind, lit), x, y, alpha);
}

/** Generated art only: dark glass and the window's own pixels, under the light. */
function blitBack(r: Renderer, kind: LanternKind, x: number, y: number, alpha: number): void {
  const art = lanternArt.get(kind);
  if (!art) return;
  const g = art.spec.glass;
  r.uiRect(x + g.x * PX, y + g.y * PX, g.w * PX, g.h * PX, '#160d14', alpha);
  blitArt(r, art.back, x, y, alpha);
}

// ---------------------------------------------------------------- plates
function roundBox(p: PixelPainter, w: number, h: number, outline: string, fill: string): void {
  p.rect(2, 0, w - 4, h, outline);
  p.rect(0, 2, w, h - 4, outline);
  p.px(1, 1, outline);
  p.px(w - 2, 1, outline);
  p.px(1, h - 2, outline);
  p.px(w - 2, h - 2, outline);
  p.rect(2, 1, w - 4, h - 2, fill);
  p.rect(1, 2, w - 2, h - 4, fill);
}

/** Brass rivet (2x2 art) of the HUD plates (also the minimap plate's window bolts). */
export function rivet(p: PixelPainter, x: number, y: number): void {
  p.px(x, y, '#ffe09a');
  p.px(x + 1, y, '#b8843c');
  p.px(x, y + 1, '#b8843c');
  p.px(x + 1, y + 1, '#5a3814');
}

/**
 * Keeper plate / gear rack: a dark plum plate with a brass top rail, a soot
 * bottom edge and brass rivets; `divRow` (art px, optional) adds a stitched
 * divider between the plate's two rows.
 */
export function paintPlate(pw: number, ph: number, divRow = -1): PixelPainter {
  const p = new PixelPainter(pw, ph);
  roundBox(p, pw, ph, C.ink, '#18111e');
  for (let y = 3; y < ph - 2; y++) {
    const t = (y - 3) / Math.max(1, ph - 5);
    for (let x = 2; x < pw - 2; x++) p.px(x, y, bayer(x, y) < (1 - t) * 0.6 ? '#241a2d' : '#17111d');
  }
  // brass rail along the top, soot along the bottom, cool rim on the sides
  p.rect(2, 1, pw - 4, 1, '#e0b064');
  p.rect(2, 2, pw - 4, 1, '#7a4e1c');
  p.px(1, 2, '#b8843c');
  p.px(pw - 2, 2, '#5a3814');
  p.rect(1, 3, 1, ph - 5, '#33263f');
  p.rect(pw - 2, 3, 1, ph - 5, '#0e0a12');
  p.rect(2, ph - 2, pw - 4, 1, '#0e0a12');
  if (divRow > 2 && divRow < ph - 3) {
    for (let x = 4; x < pw - 4; x++) {
      p.px(x, divRow, x % 3 === 0 ? '#6a4a2a' : '#2a1f34');
      p.px(x, divRow + 1, '#0e0a12');
    }
  }
  if (pw >= 12) {
    rivet(p, pw - 5, 4);
    if (ph >= 12) rivet(p, pw - 5, ph - 5);
  }
  return p;
}

export function plateCanvas(pw: number, ph: number, divRow = -1): HTMLCanvasElement {
  return cached(`plate|${pw}|${ph}|${divRow}`, () => paintPlate(pw, ph, divRow));
}

// ---------------------------------------------------------------- rarity gem
const GEM = ['..k..', '.kYk.', 'kYcdk', '.kdk.', '..k..'];

export function gemCanvas(color: string): HTMLCanvasElement {
  return cached(`gem|${color}`, () => {
    const p = new PixelPainter(5, 5);
    p.stamp(0, 0, GEM, { k: C.ink, Y: mixColor(color, '#ffffff', 0.55), c: color, d: mixColor(color, '#000000', 0.45) });
    return p;
  });
}

/** Rarity accent for an equipment slot (UI rect): an inner colored rim and a gem on the top-left corner. */
export function rarityAccent(r: Renderer, x: number, y: number, s: number, color: string, alpha = 1): void {
  const a = alpha * 0.75;
  r.uiRect(x + 4, y + 4, s - 8, PX, color, a);
  r.uiRect(x + 4, y + s - 4 - PX, s - 8, PX, mixColor(color, '#000000', 0.35), a);
  r.uiRect(x + 4, y + 4, PX, s - 8, color, a);
  r.uiRect(x + s - 4 - PX, y + 4, PX, s - 8, mixColor(color, '#000000', 0.35), a);
  blitArt(r, gemCanvas(color), x - 3, y - 3, alpha);
}

// ---------------------------------------------------------------- lantern glass (live)
export interface LanternState {
  /** ember fill 0..1 */
  fill: number;
  /** gauge full and release allowed */
  ready: boolean;
  /** release cooldown seconds left (0 = none) */
  cooldown: number;
  /** HUD time (s), for the flame flicker */
  t: number;
  /** white flash 0..1 when the gauge just filled */
  flash: number;
}

/** Glass rect of a lantern drawn at UI (x, y), in UI units. */
function glassRect(kind: LanternKind, x: number, y: number): { gx: number; gy: number; gw: number; gh: number; rows: number } {
  const g = lanternSpec(kind).glass;
  return { gx: x + g.x * PX, gy: y + g.y * PX, gw: g.w * PX, gh: g.h * PX, rows: g.h };
}

/** Cage bars, a brass band round the glass's middle and the gleam (procedural frames only). */
function glassCage(r: Renderer, gx: number, gy: number, gw: number, gh: number, bright: boolean, alpha: number, band = true): void {
  const cols = gw / PX;
  r.uiRect(gx + Math.floor(cols / 3) * PX, gy, PX, gh, C.ink, alpha * 0.5);
  r.uiRect(gx + Math.ceil((cols * 2) / 3 - 1) * PX, gy, PX, gh, C.ink, alpha * 0.5);
  if (band) {
    const by = gy + Math.floor(gh / PX / 2) * PX;
    r.uiRect(gx - PX, by, gw + 2 * PX, PX, bright ? '#ffc860' : '#b8843c', alpha);
    r.uiRect(gx - PX, by + PX, gw + 2 * PX, PX, C.ink, alpha * 0.8);
  }
  r.uiRect(gx + PX, gy + PX, PX, PX * 4, '#ffffff', alpha * 0.3);
}

/** A small flame (art px grid) whose base sits on `surf`, centered on cx. */
function flame(r: Renderer, cx: number, surf: number, top: number, rows: number, outer: string, mid: string, core: string, alpha: number): void {
  const fh = rows * PX;
  const fy = Math.max(top, surf - fh);
  r.uiRect(cx - 2 * PX, surf - Math.min(fh, 2 * PX), PX * 4, Math.min(fh, 2 * PX), outer, alpha * 0.9);
  r.uiRect(cx - PX, fy + PX, PX * 2, surf - fy - PX, mid, alpha);
  r.uiRect(cx - PX, fy + 2 * PX, PX, Math.max(0, surf - fy - 3 * PX), core, alpha);
  r.uiRect(cx - PX, fy, PX, PX, mid, alpha);
}

/**
 * Release lantern at UI (x, y): ember filling the glass from the bottom (hottest
 * in the middle) with a flame riding its surface; bright glow when ready;
 * shutters while the release recovers.
 */
export function drawLantern(r: Renderer, x: number, y: number, s: LanternState, alpha: number): void {
  if (alpha <= 0.01) return;
  const art = lanternArt.has('release');
  if (!art) blitFrame(r, 'release', s.ready, x, y, alpha);
  else blitBack(r, 'release', x, y, alpha);
  const { gx, gy, gw, gh, rows: glassRows } = glassRect('release', x, y);
  const f = clamp(s.fill, 0, 1);
  const rows = Math.round(glassRows * f);
  const pulse = 0.5 + 0.5 * Math.sin(s.t * 7);
  if (rows > 0) {
    const fh = rows * PX;
    const top = gy + gh - fh;
    const ramp = s.ready
      ? [pulse > 0.5 ? '#fff8dc' : '#fff0b0', '#ffc850', '#ff8a28']
      : ['#ffb060', '#ee6428', '#a8341a'];
    r.uiRect(gx, top, gw, fh, ramp[2], alpha);
    r.uiRect(gx + PX, top, gw - 2 * PX, fh, ramp[1], alpha);
    r.uiRect(gx + 3 * PX, top, gw - 6 * PX, fh, ramp[0], alpha);
    r.uiRect(gx, gy + gh - PX, gw, PX, s.ready ? '#c86a18' : '#6a1e0c', alpha);
    r.uiRect(gx + PX, top, gw - 2 * PX, PX, s.ready ? '#ffffff' : '#ffd080', alpha * 0.9);
  }
  if (!s.ready && s.cooldown <= 0) {
    const surf = gy + gh - rows * PX;
    const flick = Math.sin(s.t * 13) > 0.2 ? 1 : 0;
    const sway = Math.sin(s.t * 5) > 0.6 ? PX : 0;
    flame(r, gx + gw / 2 + sway, surf, gy, (rows > 0 ? 4 : 3) + flick, '#ff7a2a', '#ffb848', '#fff0b8', alpha);
  }
  if (!art) glassCage(r, gx, gy, gw, gh, s.ready, alpha);
  if (s.flash > 0) r.uiRect(gx, gy, gw, gh, '#ffffff', alpha * s.flash * 0.7);
  if (s.cooldown > 0) for (let i = 0; i < glassRows; i += 3) r.uiRect(gx, gy + i * PX, gw, PX, '#05030a', alpha * 0.55);
  if (art) blitFrame(r, 'release', s.ready, x, y, alpha);
}
