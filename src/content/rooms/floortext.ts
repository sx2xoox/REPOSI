// Crisp Korean pixel text for the world layer (floor hints, speech bubbles).
// Text is rasterized with the bundled Galmuri font, then the alpha is thresholded
// so it stays pixel-sharp when the world canvas is scaled up.

import type { Room } from '../../game/room';

export interface PixelTextOpts {
  /** css px size; Galmuri11 is crisp at 12, Galmuri9 at 10 */
  size?: number;
  font?: 'Galmuri11' | 'Galmuri9';
  bold?: boolean;
  color?: string;
  /** 1px outline around the glyphs */
  outline?: string;
  /** drop shadow one pixel down */
  shadow?: string;
}

const cache = new Map<string, HTMLCanvasElement>();

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Rasterize `text` into a small canvas (cached). */
export function pixelTextCanvas(text: string, o: PixelTextOpts = {}): HTMLCanvasElement {
  const size = o.size ?? 12;
  const font = o.font ?? 'Galmuri11';
  const key = `${text}|${size}|${font}|${o.bold}|${o.color}|${o.outline}|${o.shadow}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const fontStr = `${o.bold ? 'bold ' : ''}${size}px '${font}', monospace`;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = fontStr;
  const w = Math.ceil(probe.measureText(text).width) + 4;
  const h = size + 6;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.font = fontStr;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 2, 2);
  const img = ctx.getImageData(0, 0, w, h);
  const src = img.data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = src[i * 4 + 3] > 110 ? 1 : 0;
  const out = ctx.createImageData(w, h);
  const d = out.data;
  const put = (i: number, c: [number, number, number]) => {
    d[i * 4] = c[0];
    d[i * 4 + 1] = c[1];
    d[i * 4 + 2] = c[2];
    d[i * 4 + 3] = 255;
  };
  const isOn = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  if (o.shadow) {
    const c = hex(o.shadow);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isOn(x, y - 1) || isOn(x - 1, y - 1)) put(y * w + x, c);
  }
  if (o.outline) {
    const c = hex(o.outline);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (isOn(x, y)) continue;
        if (isOn(x - 1, y) || isOn(x + 1, y) || isOn(x, y - 1) || isOn(x, y + 1)) put(y * w + x, c);
      }
    }
  }
  const fc = hex(o.color ?? '#ffffff');
  for (let i = 0; i < w * h; i++) if (mask[i]) put(i, fc);
  ctx.clearRect(0, 0, w, h);
  ctx.putImageData(out, 0, 0);
  cache.set(key, cv);
  return cv;
}

let fontsReady: Promise<void> | null = null;
/** Resolves once the Galmuri fonts are usable on canvas. */
export function whenFontsReady(): Promise<void> {
  if (!fontsReady) {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts) fontsReady = Promise.resolve();
    else {
      fontsReady = Promise.all([fonts.load("12px 'Galmuri11'"), fonts.load("bold 12px 'Galmuri11'"), fonts.load("10px 'Galmuri9'")])
        .then(() => undefined)
        .catch(() => undefined);
    }
  }
  return fontsReady;
}

/** Keycap + label hint ("[WASD] 이동") painted onto the room floor, centred at (cx, y). */
export function paintKeyHint(room: Room, cx: number, y: number, keys: string[], label: string, alpha = 0.85): void {
  const ctx = room.ensureDecals().getContext('2d')!;
  const caps = keys.map((k) => pixelTextCanvas(k, { size: 10, font: 'Galmuri9', color: '#f4ecff' }));
  const lab = pixelTextCanvas(label, { size: 12, font: 'Galmuri11', color: '#d8d0ec', shadow: '#0c0a14' });
  const capW = caps.map((c) => Math.max(c.width + 2, 13));
  const total = capW.reduce((a, b) => a + b + 2, 0) + 3 + lab.width;
  let x = Math.round(cx - total / 2);
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < caps.length; i++) {
    const w = capW[i];
    // keycap: dark body, light rim, thicker front edge
    ctx.fillStyle = '#0c0a14';
    ctx.fillRect(x - 1, y - 1, w + 2, 16);
    ctx.fillStyle = '#5a5474';
    ctx.fillRect(x, y, w, 14);
    ctx.fillStyle = '#2a2638';
    ctx.fillRect(x + 1, y + 1, w - 2, 10);
    ctx.fillStyle = '#9a94b8';
    ctx.fillRect(x + 1, y, w - 2, 1);
    ctx.drawImage(caps[i], Math.round(x + (w - caps[i].width) / 2), y - 1);
    x += w + 2;
  }
  ctx.drawImage(lab, x + 2, y - 1);
  ctx.restore();
}
