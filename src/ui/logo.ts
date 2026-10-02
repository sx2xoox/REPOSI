// Pixel logo "등불지기": the title text is rasterized once at the font's native
// pixel size, thresholded to crisp pixels, then re-colored with a warm
// lantern gradient, top highlight, dark outline and drop shadow. Drawn scaled
// up on the UI grid with a flickering glow and a swinging lantern.

import type { Renderer } from '../engine/renderer';
import { animFrame } from '../engine/sprites';
import { C } from './theme';
import { glow } from './frame';

const RAMP = ['#fff6d6', '#ffe9a8', '#ffd27a', '#ffb850', '#f09238', '#d8702a'];

let cached: HTMLCanvasElement | null = null;
let cachedText = '';

function fontReady(): boolean {
  try {
    return typeof document !== 'undefined' && document.fonts.check("bold 12px 'Galmuri11'");
  } catch {
    return false;
  }
}

/** Build the logo canvas (art pixels; 1px = one font pixel). */
export function buildLogo(textStr: string): HTMLCanvasElement {
  if (cached && cachedText === textStr) return cached;
  const src = document.createElement('canvas');
  const ctx = src.getContext('2d')!;
  ctx.font = "bold 12px 'Galmuri11', monospace";
  const tw = Math.ceil(ctx.measureText(textStr).width);
  const pad = 3;
  const W = tw + pad * 2;
  const H = 12 + pad * 2 + 2;
  src.width = W;
  src.height = H;
  ctx.font = "bold 12px 'Galmuri11', monospace";
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#fff';
  ctx.fillText(textStr, pad, pad);
  const img = ctx.getImageData(0, 0, W, H);
  const mask = new Uint8Array(W * H);
  let top = H;
  let bottom = 0;
  for (let i = 0; i < W * H; i++) {
    if (img.data[i * 4 + 3] > 110) {
      mask[i] = 1;
      const y = Math.floor(i / W);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? mask[y * W + x] : 0);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const o = out.getContext('2d')!;
  const px = (x: number, y: number, c: string) => {
    o.fillStyle = c;
    o.fillRect(x, y, 1, 1);
  };
  // shadow (2px down), outline, fill
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(x, y - 2) || at(x - 1, y - 2) || at(x + 1, y - 2)) px(x, y, '#140608');
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (at(x, y)) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n |= at(x + dx, y + dy);
      if (n) px(x, y, '#3a1606');
    }
  }
  const span = Math.max(1, bottom - top);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!at(x, y)) continue;
      const t = (y - top) / span;
      let c = RAMP[Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))];
      if (!at(x, y - 1)) c = '#ffffff';
      else if (!at(x, y + 1)) c = '#a8501c';
      px(x, y, c);
    }
  }
  if (fontReady()) {
    cached = out;
    cachedText = textStr;
  }
  return out;
}

/**
 * Draw the logo centered at (cx, y top) in UI space. `scale` = UI units per
 * font pixel. `t` = time for the glow flicker and the lantern swing.
 */
export function drawLogo(r: Renderer, cx: number, y: number, t: number, o: { scale?: number; alpha?: number; lantern?: boolean } = {}): { w: number; h: number } {
  const s = o.scale ?? 4;
  const a = o.alpha ?? 1;
  const cv = buildLogo('등불지기');
  const w = cv.width * s;
  const h = cv.height * s;
  const flick = 0.82 + 0.1 * Math.sin(t * 9.3) + 0.08 * Math.sin(t * 5.1 + 2);
  glow(r, cx, y + h * 0.5, w * 0.62, '#ff9a3a', 0.22 * a * flick);
  glow(r, cx, y + h * 0.45, w * 0.38, '#ffd27a', 0.12 * a * flick);
  const d = r.dctx;
  d.globalAlpha = a;
  d.imageSmoothingEnabled = false;
  d.drawImage(cv, Math.round(cx - w / 2), Math.round(y), w, h);
  d.globalAlpha = 1;
  if (o.lantern !== false) {
    // a little lantern hanging off the first syllable, swinging gently
    const lx = cx - w / 2 - 18;
    const ly = y + 6;
    const ang = Math.sin(t * 1.6) * 0.12;
    r.uiRect(lx - 1, ly - 30, 2, 22, C.ink, a);
    r.uiRect(lx - 0.5, ly - 30, 1, 22, '#5a4a6a', a);
    glow(r, lx + Math.sin(ang) * 22, ly + 26, 34, '#ffb050', 0.4 * a * flick);
    r.uiSprite(animFrame('ui_lantern', t), lx + Math.sin(ang) * 20, ly + 10, 2.5, { rot: ang, alpha: a });
  }
  return { w, h };
}
