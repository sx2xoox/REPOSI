// UI design tokens: palette, type scale, version string and small text helpers
// shared by every screen so the whole UI reads as one system.
//
// Type scale (UI space 768x432, Galmuri):
//   TITLE 24 bold · H2 16 bold · BODY 12 · SMALL 10 (Galmuri9) · LOGO 48 bold

import type { Renderer, TextOpts } from '../engine/renderer';

export const VERSION = 'v0.1.0';

/** UI units per art pixel: frames and icons are drawn on this grid so they match world pixels. */
export const PX = 2;

export const C = {
  ink: '#0c0810',
  void: '#05030a',
  bg: '#07050c',
  panel: '#1b1424',
  panelHi: '#261c32',
  rim: '#4a3a5c',
  rimDark: '#2a1f36',
  slot: '#110c17',
  gold: '#e0a848',
  goldHi: '#ffe09a',
  goldDark: '#7a4e1c',
  text: '#f4ead8',
  textDim: '#b4a8c0',
  textFaint: '#7a7090',
  textMute: '#4e4660',
  ember: '#ff9a3a',
  emberHi: '#ffe080',
  emberDeep: '#c04010',
  heart: '#e8283c',
  soul: '#7a9af8',
  good: '#8ee07a',
  bad: '#ff6a70',
  info: '#7ac8ff',
  parchment: '#e8d4a6',
  parchmentInk: '#3a2414',
  parchmentDim: '#7a5a3a',
} as const;

export const FONT = {
  logo: 48,
  title: 24,
  h2: 16,
  body: 12,
  small: 10,
} as const;

/** Body text. */
export function text(r: Renderer, s: string, x: number, y: number, o: TextOpts = {}): void {
  r.uiText(s, x, y, { size: FONT.body, color: C.text, ...o });
}

/** Small (Galmuri9) text. */
export function small(r: Renderer, s: string, x: number, y: number, o: TextOpts = {}): void {
  r.uiText(s, x, y, { size: FONT.small, color: C.textDim, font: 'small', ...o });
}

/** Screen / panel title (24 bold, warm with dark outline). */
export function title(r: Renderer, s: string, x: number, y: number, o: TextOpts = {}): void {
  r.uiText(s, x, y, { size: FONT.title, bold: true, color: C.text, outline: C.ink, ...o });
}

/** Section header (16 bold). */
export function heading(r: Renderer, s: string, x: number, y: number, o: TextOpts = {}): void {
  r.uiText(s, x, y, { size: FONT.h2, bold: true, color: C.goldHi, ...o });
}

/** Format seconds as m:ss (or h:mm:ss). */
export function formatTime(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Roman numerals for tier labels (1..10). */
export function roman(n: number): string {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n);
}

/** Split "1층 · 잊혀진 지하묘지" into ["1층", "잊혀진 지하묘지"]. */
export function splitFloorName(name: string): [string, string] {
  const i = name.indexOf('·');
  if (i < 0) return ['', name.trim()];
  return [name.slice(0, i).trim(), name.slice(i + 1).trim()];
}
