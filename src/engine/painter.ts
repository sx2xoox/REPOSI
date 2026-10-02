// PixelPainter: tiny software rasterizer for procedurally authored pixel art.
// Works on a plain RGBA buffer so it also runs in node (tests) — only
// `toCanvas()` needs a DOM. Content authors use it through `defineDrawnSprite`.
//
// Typical usage:
//   p.ellipse(8, 9, 6, 5, '#7a3b4f');                 // body
//   p.shadeSphere(8, 9, 6, 5, ramp('#c05a6a'));        // 3D-ish shading
//   p.px(6, 8, '#fff'); p.px(10, 8, '#fff');           // eyes
//   p.outline('#140c1c');                              // 1px dark outline

import { clamp, hexToRgb, lerp, rgbToHex } from './math';

export type Color = string | null; // null = transparent

function parseColor(c: string): number {
  // returns packed ABGR (little-endian RGBA bytes) for Uint32Array views
  if (c === 'transparent') return 0;
  let a = 255;
  let hex = c;
  if (c.startsWith('#') && (c.length === 9)) {
    a = parseInt(c.slice(7, 9), 16);
    hex = c.slice(0, 7);
  }
  const [r, g, b] = hexToRgb(hex);
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

const colorCache = new Map<string, number>();
export function packColor(c: string): number {
  let v = colorCache.get(c);
  if (v === undefined) {
    v = parseColor(c);
    colorCache.set(c, v);
  }
  return v;
}

/**
 * Build a hue-shifted color ramp from a base color, darkest first.
 * Shadows shift toward cool purple, highlights toward warm yellow — the
 * classic pixel-art trick that keeps shading lively instead of muddy.
 */
export function ramp(base: string, steps = 5, contrast = 1): string[] {
  const [r, g, b] = hexToRgb(base);
  const out: string[] = [];
  const mid = (steps - 1) / 2;
  for (let i = 0; i < steps; i++) {
    const t = ((i - mid) / Math.max(1, mid)) * 0.55 * contrast; // -0.55 .. 0.55
    let nr: number, ng: number, nb: number;
    if (t < 0) {
      const k = -t;
      // darken + shift to cool
      nr = lerp(r, 30, k) * (1 - k * 0.35);
      ng = lerp(g, 20, k) * (1 - k * 0.4);
      nb = lerp(b, 60, k * 0.8);
    } else {
      const k = t;
      nr = lerp(r, 255, k);
      ng = lerp(g, 245, k * 0.9);
      nb = lerp(b, 200, k * 0.6);
    }
    out.push(rgbToHex(nr, ng, nb));
  }
  return out;
}

export function darken(c: string, k: number): string {
  const [r, g, b] = hexToRgb(c);
  return rgbToHex(r * (1 - k), g * (1 - k), b * (1 - k) + 6 * k);
}

export function lighten(c: string, k: number): string {
  const [r, g, b] = hexToRgb(c);
  return rgbToHex(lerp(r, 255, k), lerp(g, 250, k), lerp(b, 235, k));
}

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Ordered-dither threshold in [0,1) for pixel (x, y). */
export function bayer(x: number, y: number): number {
  return (BAYER4[y & 3][x & 3] + 0.5) / 16;
}

export class PixelPainter {
  readonly w: number;
  readonly h: number;
  readonly data: Uint32Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint32Array(w * h);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.data[y * this.w + x];
  }

  isSet(x: number, y: number): boolean {
    return (this.get(x, y) >>> 24) > 0;
  }

  px(x: number, y: number, c: Color): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (!this.inBounds(x, y)) return;
    this.data[y * this.w + x] = c === null ? 0 : packColor(c);
  }

  /** Set pixel only if already non-transparent (paint "inside" the shape). */
  pxIn(x: number, y: number, c: string): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (this.isSet(x, y)) this.data[y * this.w + x] = packColor(c);
  }

  clear(): void {
    this.data.fill(0);
  }

  rect(x: number, y: number, w: number, h: number, c: Color): void {
    for (let yy = Math.floor(y); yy < y + h; yy++) for (let xx = Math.floor(x); xx < x + w; xx++) this.px(xx, yy, c);
  }

  rectOutline(x: number, y: number, w: number, h: number, c: Color): void {
    for (let i = 0; i < w; i++) { this.px(x + i, y, c); this.px(x + i, y + h - 1, c); }
    for (let i = 0; i < h; i++) { this.px(x, y + i, c); this.px(x + w - 1, y + i, c); }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: Color): void {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /** Filled ellipse centered at (cx, cy) with radii rx, ry (pixel centers). */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: Color): void {
    const x0 = Math.floor(cx - rx - 1);
    const x1 = Math.ceil(cx + rx + 1);
    const y0 = Math.floor(cy - ry - 1);
    const y1 = Math.ceil(cy + ry + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const nx = (x + 0.5 - cx) / Math.max(0.5, rx);
        const ny = (y + 0.5 - cy) / Math.max(0.5, ry);
        if (nx * nx + ny * ny <= 1) this.px(x, y, c);
      }
    }
  }

  circle(cx: number, cy: number, r: number, c: Color): void {
    this.ellipse(cx, cy, r, r, c);
  }

  ring(cx: number, cy: number, r: number, thickness: number, c: Color): void {
    const x0 = Math.floor(cx - r - 1);
    const x1 = Math.ceil(cx + r + 1);
    const y0 = Math.floor(cy - r - 1);
    const y1 = Math.ceil(cy + r + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= r && d > r - thickness) this.px(x, y, c);
      }
    }
  }

  /** Filled polygon (even-odd). points: [x0,y0,x1,y1,...] */
  poly(points: number[], c: Color): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < points.length; i += 2) { minY = Math.min(minY, points[i]); maxY = Math.max(maxY, points[i]); }
    const n = points.length / 2;
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < n; i++) {
        const ax = points[i * 2];
        const ay = points[i * 2 + 1];
        const bx = points[((i + 1) % n) * 2];
        const by = points[((i + 1) % n) * 2 + 1];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) {
          xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) this.px(x, y, c);
      }
    }
  }

  /**
   * Re-color the already painted pixels inside an ellipse with sphere-like shading.
   * `colors` is a ramp darkest->lightest. Light comes from the top-left.
   */
  shadeSphere(cx: number, cy: number, rx: number, ry: number, colors: string[], opts: { lightX?: number; lightY?: number; dither?: boolean } = {}): void {
    const lx = opts.lightX ?? -0.55;
    const ly = opts.lightY ?? -0.65;
    const dither = opts.dither ?? true;
    const x0 = Math.floor(cx - rx - 1);
    const x1 = Math.ceil(cx + rx + 1);
    const y0 = Math.floor(cy - ry - 1);
    const y1 = Math.ceil(cy + ry + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!this.isSet(x, y)) continue;
        const nx = (x + 0.5 - cx) / Math.max(0.5, rx);
        const ny = (y + 0.5 - cy) / Math.max(0.5, ry);
        const d2 = nx * nx + ny * ny;
        if (d2 > 1.05) continue;
        const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, d2)));
        let lum = (nx * lx + ny * ly) * 0.75 + nz * 0.55; // ~[-0.4, 1.2]; (lx,ly) points toward the light
        lum = clamp((lum + 0.35) / 1.35, 0, 0.9999);
        let f = lum * colors.length;
        if (dither) f += bayer(x, y) - 0.5;
        const idx = clamp(Math.floor(f), 0, colors.length - 1);
        this.px(x, y, colors[idx]);
      }
    }
  }

  /** Vertical gradient shading of existing pixels in a rect (top light -> bottom dark). */
  shadeVertical(x: number, y: number, w: number, h: number, colors: string[], dither = true): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (!this.isSet(xx, yy)) continue;
        let f = (1 - (yy - y) / Math.max(1, h - 1)) * colors.length;
        if (dither) f += bayer(xx, yy) - 0.5;
        this.px(xx, yy, colors[clamp(Math.floor(f), 0, colors.length - 1)]);
      }
    }
  }

  /** Add a 1px outline around all non-transparent pixels (4-neighborhood, or 8 when `corners`). */
  outline(c: string, corners = false): void {
    const src = this.data.slice();
    const col = packColor(c);
    const w = this.w;
    const h = this.h;
    const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? src[y * w + x] >>> 24 : 0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (at(x, y)) continue;
        let n = at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1);
        if (!n && corners) n = at(x - 1, y - 1) || at(x + 1, y - 1) || at(x - 1, y + 1) || at(x + 1, y + 1);
        if (n) this.data[y * w + x] = col;
      }
    }
  }

  /** Darken the bottom-most pixel row of each column of the shape (fake ambient occlusion). */
  innerShadow(c: string): void {
    const src = this.data.slice();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        if (!(src[i] >>> 24)) continue;
        const below = y + 1 < this.h ? src[i + this.w] >>> 24 : 0;
        if (!below) this.data[i] = packColor(c);
      }
    }
  }

  /** Highlight top-most pixels of the shape. */
  rimLight(c: string): void {
    const src = this.data.slice();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        if (!(src[i] >>> 24)) continue;
        const above = y > 0 ? src[i - this.w] >>> 24 : 0;
        if (!above) this.data[i] = packColor(c);
      }
    }
  }

  /** Mirror the left half onto the right half (for symmetric creatures). */
  mirrorX(): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < Math.floor(this.w / 2); x++) {
        this.data[y * this.w + (this.w - 1 - x)] = this.data[y * this.w + x];
      }
    }
  }

  /** Replace every pixel of color `from` with `to`. */
  replace(from: string, to: Color): void {
    const f = packColor(from);
    const t = to === null ? 0 : packColor(to);
    for (let i = 0; i < this.data.length; i++) if (this.data[i] === f) this.data[i] = t;
  }

  /** Stamp ASCII pixel rows at (x, y) with a palette. '.' and ' ' are transparent. */
  stamp(x: number, y: number, rows: string[], palette: Record<string, string>): void {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.' || ch === ' ') continue;
        const col = palette[ch];
        if (col) this.px(x + c, y + r, col);
      }
    }
  }

  /** Copy another painter's pixels onto this one (transparent pixels skipped). */
  blit(src: PixelPainter, x: number, y: number, flipX = false): void {
    for (let yy = 0; yy < src.h; yy++) {
      for (let xx = 0; xx < src.w; xx++) {
        const v = src.data[yy * src.w + (flipX ? src.w - 1 - xx : xx)];
        if (v >>> 24) {
          const tx = x + xx;
          const ty = y + yy;
          if (this.inBounds(tx, ty)) this.data[ty * this.w + tx] = v;
        }
      }
    }
  }

  /** Scatter noise-colored pixels over existing pixels (texture). */
  speckle(colors: string[], density: number, rand: () => number): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.isSet(x, y) && rand() < density) this.px(x, y, colors[Math.floor(rand() * colors.length)]);
      }
    }
  }

  toImageData(): ImageData {
    const bytes = new Uint8ClampedArray(this.w * this.h * 4);
    bytes.set(new Uint8Array(this.data.buffer, this.data.byteOffset, this.data.byteLength));
    return new ImageData(bytes, this.w, this.h);
  }

  toCanvas(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = this.w;
    cv.height = this.h;
    const ctx = cv.getContext('2d')!;
    ctx.putImageData(this.toImageData(), 0, 0);
    return cv;
  }
}
