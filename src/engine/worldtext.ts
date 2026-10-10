// World-space pixel text glyphs (Renderer.pixelText).
//
// The 3x5 bitmap font draws numbers and short Latin words (damage numbers, '+1',
// 'MISS'). Any text it cannot draw (Hangul, '…' ...) goes through the bundled
// Galmuri pixel font instead: rasterized once at world-pixel resolution, alpha
// thresholded to hard pixels, given the same 8-way outline as the 3x5 font and
// blitted on the world canvas like a sprite (nearest-neighbour, integer scale), so
// it stays anchored, lit and ordered exactly like the 3x5 text it replaces.
//
// The pure parts (coverage check, style per scale, cache key, bounded LRU) run in
// node; rasterizing needs a DOM and returns null without one, and also while the web
// font is still loading (nothing is cached then, so a text never stays blank).

/** 3x5 glyphs (upper-case; the text is upper-cased before lookup). */
export const PIXEL_GLYPHS: Readonly<Record<string, readonly string[]>> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '011', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
  '-': ['000', '000', '111', '000', '000'],
  '!': ['010', '010', '010', '000', '010'],
  '.': ['000', '000', '000', '000', '010'],
  '%': ['101', '001', '010', '100', '101'],
  'x': ['000', '101', '010', '101', '000'],
  // 'x' above is never reached (lookups are upper-cased): 'X' is the same small cross
  'X': ['000', '101', '010', '101', '000'],
  '/': ['001', '001', '010', '100', '100'],
  // mission readouts ('1/3 · 45%') separate their parts with a middle dot
  '·': ['000', '000', '010', '000', '000'],
  ' ': ['000', '000', '000', '000', '000'],
  'A': ['010', '101', '111', '101', '101'],
  'B': ['110', '101', '110', '101', '110'],
  'C': ['011', '100', '100', '100', '011'],
  'D': ['110', '101', '101', '101', '110'],
  'E': ['111', '100', '110', '100', '111'],
  'F': ['111', '100', '110', '100', '100'],
  'G': ['011', '100', '101', '101', '011'],
  'H': ['101', '101', '111', '101', '101'],
  'I': ['111', '010', '010', '010', '111'],
  'K': ['101', '101', '110', '101', '101'],
  'L': ['100', '100', '100', '100', '111'],
  'M': ['101', '111', '111', '101', '101'],
  'N': ['110', '101', '101', '101', '101'],
  'O': ['010', '101', '101', '101', '010'],
  'P': ['110', '101', '110', '100', '100'],
  'R': ['110', '101', '110', '101', '101'],
  'S': ['011', '100', '010', '001', '110'],
  'T': ['111', '010', '010', '010', '010'],
  'U': ['101', '101', '101', '101', '111'],
  'V': ['101', '101', '101', '101', '010'],
  'W': ['101', '101', '111', '111', '101'],
  'Y': ['101', '101', '010', '010', '010'],
};

/** ASCII code -> drawable by the 3x5 font (after upper-casing) */
const ASCII_COVERED: boolean[] = [];
for (let c = 0; c < 128; c++) ASCII_COVERED[c] = PIXEL_GLYPHS[String.fromCharCode(c).toUpperCase()] !== undefined;

/**
 * True when the 3x5 font can draw every character of `str` (it is upper-case only;
 * lower-case Latin maps onto it). False for Hangul and any other missing glyph: such
 * a text is drawn with the Galmuri path.
 */
export function pixelFontCovers(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 128) {
      if (!ASCII_COVERED[c]) return false;
      continue;
    }
    const up = str[i].toUpperCase();
    if (up.length !== 1 || PIXEL_GLYPHS[up] === undefined) return false;
  }
  return true;
}

// ---------------------------------------------------------------- style per scale
export type WorldFontFace = 'Galmuri9' | 'Galmuri11';

export interface FontTextStyle {
  readonly font: WorldFontFace;
  /** css px size the face is drawn pixel-exact at */
  readonly size: number;
  readonly bold: boolean;
  /** integer pixel multiplier of the 1x raster */
  readonly k: number;
  /** ink rows of a Hangul syllable at 1x (it sits on the baseline) */
  readonly ink: number;
  /** CSS font string (falls back to monospace while the face is missing; also the face part of cache keys) */
  readonly css: string;
}

const G9 = { font: 'Galmuri9', size: 10, bold: false, ink: 9 } as const;
const G11B = { font: 'Galmuri11', size: 12, bold: true, ink: 11 } as const;
const STYLES: FontTextStyle[] = [];

/**
 * Galmuri style for a pixelText `scale` (integer >= 1). Hangul cannot be read at the
 * 3x5 font's 5 px, so scale 1 is Galmuri9 (9 px syllables, the face of the world
 * labels); larger scales follow the 3x5 height of 5 x scale: 2 is Galmuri11 Bold
 * (11 px, heavy strokes like the doubled 3x5 crit numbers), 3 Galmuri9 x2 (18 px),
 * 4 Galmuri11 Bold x2 (22 px) ... so a pop / an emphasis still reads bigger.
 */
export function fontTextStyle(scale: number): FontTextStyle {
  const s = Math.max(1, Math.round(scale) || 1);
  let st = STYLES[s];
  if (!st) {
    const f = s % 2 === 1 ? G9 : G11B;
    const css = `${f.bold ? 'bold ' : ''}${f.size}px '${f.font}', monospace`;
    st = STYLES[s] = { ...f, k: s % 2 === 1 ? (s + 1) / 2 : s / 2, css };
  }
  return st;
}

/** Cache key of one colored raster (the separator cannot occur in a color / CSS font). */
export function fontTextKey(text: string, css: string, color: string, outline: string | undefined): string {
  return `${css}\u0001${color}\u0001${outline ?? ''}\u0001${text}`;
}

// ---------------------------------------------------------------- stepping out of UI panels
/** dodge directions: up, down, left, right */
export type DodgeDir = 0 | 1 | 2 | 3;

/**
 * Smallest move that takes a box (x, y, w, h) out of every cover (flat x, y, w, h
 * list, same space) while it stays inside (0, 0, viewW, viewH). `prefer` (the
 * previous frame's direction) is kept while it costs at most a few px more, so a
 * popup gliding along a panel edge does not flip sides. Returns [dx, dy, dir]
 * ([0, 0, -1] when nothing covers it or no move fits).
 */
export function dodgeCovers(x: number, y: number, w: number, h: number, covers: readonly number[], viewW: number, viewH: number, prefer = -1): [number, number, number] {
  let dx = 0;
  let dy = 0;
  let dir = -1;
  for (let i = 0; i + 3 < covers.length; i += 4) {
    const cx = covers[i];
    const cy = covers[i + 1];
    const cw = covers[i + 2];
    const ch = covers[i + 3];
    const bx = x + dx;
    const by = y + dy;
    if (bx >= cx + cw || bx + w <= cx || by >= cy + ch || by + h <= cy) continue;
    const moves: [number, number][] = [
      [0, cy - (by + h)],
      [0, cy + ch - by],
      [cx - (bx + w), 0],
      [cx + cw - bx, 0],
    ];
    let best = -1;
    let bestCost = Infinity;
    for (let d = 0; d < 4; d++) {
      const [mx, my] = moves[d];
      const nx = bx + mx;
      const ny = by + my;
      if (nx < 0 || ny < 0 || nx + w > viewW || ny + h > viewH) continue;
      const cost = Math.abs(mx) + Math.abs(my) - (d === prefer ? 4 : 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = d;
      }
    }
    if (best < 0) continue;
    dx += moves[best][0];
    dy += moves[best][1];
    dir = best;
  }
  return [dx, dy, dir];
}

// ---------------------------------------------------------------- bounded LRU
/** Small least-recently-used map: at most `cap` entries, the oldest is dropped first. */
export class LruCache<V> {
  private readonly map = new Map<string, V>();
  constructor(readonly cap: number) {}

  get size(): number {
    return this.map.size;
  }

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined && this.map.size > 1) {
      // refresh: move to the newest end
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: string, v: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else {
      while (this.map.size >= this.cap) {
        const oldest = this.map.keys().next();
        if (oldest.done) break;
        this.map.delete(oldest.value);
      }
    }
    this.map.set(key, v);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  clear(): void {
    this.map.clear();
  }
}

/** Colored rasters kept (one per text x face x color x outline; a few KB each). */
export const FONT_TEXT_CACHE_MAX = 96;
/** Thresholded masks kept (one per text x face; give widths without a color). */
export const FONT_MASK_CACHE_MAX = 128;

// ---------------------------------------------------------------- rasterizing
/** Hard-pixel ink of a text at 1x, cropped to the ink box plus a 1 px outline margin. */
interface FontMask {
  /** 1 = ink, cropped box `cw` x `ch` (ink box + 1 px all round) */
  bits: Uint8Array;
  cw: number;
  ch: number;
  /** ink width (0 when nothing drew) */
  w: number;
  /** cropped box top-left relative to (ink left, baseline) */
  dx: number;
  dy: number;
}

/** One cached colored raster (1x; the renderer scales it by the style's `k`). */
export interface FontTextBitmap {
  /** null when the text has no ink (only spaces) */
  readonly canvas: HTMLCanvasElement | null;
  /** ink width in 1x px */
  readonly w: number;
  /** canvas top-left relative to (ink left, baseline) in 1x px */
  readonly dx: number;
  readonly dy: number;
}

const masks = new LruCache<FontMask>(FONT_MASK_CACHE_MAX);
const bitmaps = new LruCache<FontTextBitmap>(FONT_TEXT_CACHE_MAX);
/** font string -> true (usable) / false (load requested, not there yet) */
const fontState = new Map<string, boolean>();
let scratch: CanvasRenderingContext2D | null = null;

function hasDom(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/**
 * True once the face can be drawn (loaded, or settled as missing: then the fallback
 * draws). The first miss asks the browser to load it; until then nothing is cached.
 */
function fontUsable(font: string): boolean {
  if (fontState.get(font)) return true;
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts || typeof fonts.check !== 'function') {
    fontState.set(font, true);
    return true;
  }
  let ok: boolean;
  try {
    ok = fonts.check(font);
  } catch {
    ok = true;
  }
  if (ok) {
    fontState.set(font, true);
    return true;
  }
  if (!fontState.has(font)) {
    fontState.set(font, false);
    const settle = (): void => {
      fontState.set(font, true);
    };
    try {
      void fonts.load(font).then(settle, settle);
    } catch {
      settle();
    }
  }
  return false;
}

function scratchContext(w: number, h: number): CanvasRenderingContext2D | null {
  if (!scratch) {
    const cv = document.createElement('canvas');
    scratch = (cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null) ?? null;
    if (!scratch) return null;
  }
  const cv = scratch.canvas;
  // resizing clears the canvas and resets its state
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  } else scratch.clearRect(0, 0, w, h);
  return scratch;
}

function rasterMask(text: string, st: FontTextStyle): FontMask | null {
  const font = st.css;
  let c = scratchContext(8, 8);
  if (!c) return null;
  c.font = font;
  const adv = Math.ceil(c.measureText(text).width || 0);
  const pad = 2;
  const w = Math.max(1, adv + pad * 2);
  const h = st.size + 6;
  const base = st.size + 2;
  c = scratchContext(w, h);
  if (!c) return null;
  c.font = font;
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.fillStyle = '#ffffff';
  c.fillText(text, pad, base);
  const src = c.getImageData(0, 0, w, h).data;
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[(y * w + x) * 4 + 3] < 128) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { bits: new Uint8Array(0), cw: 0, ch: 0, w: 0, dx: 0, dy: 0 };
  const cw = maxX - minX + 3;
  const ch = maxY - minY + 3;
  const bits = new Uint8Array(cw * ch);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) if (src[(y * w + x) * 4 + 3] >= 128) bits[(y - minY + 1) * cw + (x - minX + 1)] = 1;
  }
  return { bits, cw, ch, w: maxX - minX + 1, dx: -1, dy: minY - 1 - base };
}

function maskFor(text: string, st: FontTextStyle): FontMask | null {
  const key = fontTextKey(text, st.css, '', undefined);
  const hit = masks.get(key);
  if (hit) return hit;
  if (!hasDom() || !fontUsable(st.css)) return null;
  const m = rasterMask(text, st);
  if (m) masks.set(key, m);
  return m;
}

const colors = new LruCache<[number, number, number, number]>(64);

/** [r, g, b, a] of any CSS color: '#rrggbb' parsed, anything else resolved by the canvas itself. */
function rgba(color: string): [number, number, number, number] {
  const hit = colors.get(color);
  if (hit) return hit;
  let v: [number, number, number, number];
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    const n = parseInt(color.slice(1), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  } else {
    const c = scratchContext(1, 1);
    if (!c) return [255, 255, 255, 255];
    c.fillStyle = '#000000';
    c.fillStyle = color;
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    v = [d[0], d[1], d[2], d[3]];
  }
  colors.set(color, v);
  return v;
}

function colorize(m: FontMask, color: string, outline: string | undefined): FontTextBitmap {
  if (!m.w) return { canvas: null, w: 0, dx: 0, dy: 0 };
  const { cw, ch, bits } = m;
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const ctx = cv.getContext('2d');
  if (!ctx) return { canvas: null, w: m.w, dx: m.dx, dy: m.dy };
  const img = ctx.createImageData(cw, ch);
  const d = img.data;
  const put = (i: number, c: [number, number, number, number]): void => {
    d[i * 4] = c[0];
    d[i * 4 + 1] = c[1];
    d[i * 4 + 2] = c[2];
    d[i * 4 + 3] = c[3];
  };
  const on = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < cw && y < ch && bits[y * cw + x] === 1;
  if (outline) {
    // 8-way, like the 3x5 font's outline
    const oc = rgba(outline);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (bits[y * cw + x]) continue;
        if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1) || on(x - 1, y - 1) || on(x + 1, y - 1) || on(x - 1, y + 1) || on(x + 1, y + 1)) put(y * cw + x, oc);
      }
    }
  }
  const fc = rgba(color);
  for (let i = 0; i < cw * ch; i++) if (bits[i]) put(i, fc);
  ctx.putImageData(img, 0, 0);
  return { canvas: cv, w: m.w, dx: m.dx, dy: m.dy };
}

/**
 * Colored 1x raster of `text` in a style (cached, LRU-bounded). Null without a DOM or
 * while the face is still loading (try again next frame; nothing blank is cached).
 */
export function fontTextBitmap(text: string, st: FontTextStyle, color: string, outline: string | undefined): FontTextBitmap | null {
  const key = fontTextKey(text, st.css, color, outline);
  const hit = bitmaps.get(key);
  if (hit) return hit;
  const m = maskFor(text, st);
  if (!m) return null;
  const b = colorize(m, color, outline);
  bitmaps.set(key, b);
  return b;
}

/**
 * Ink width of `text` at 1x in a style. Rough (syllables a full em, the rest half)
 * until the face is ready, then exact.
 */
export function fontTextWidth(text: string, st: FontTextStyle): number {
  const m = maskFor(text, st);
  if (m) return m.w;
  let w = 0;
  for (let i = 0; i < text.length; i++) w += text.charCodeAt(i) >= 0x1100 ? st.size : st.size / 2;
  return Math.max(0, Math.round(w) - 2);
}

/** Cached raster / mask counts (perf checks, tests). */
export function fontTextCacheSize(): { bitmaps: number; masks: number } {
  return { bitmaps: bitmaps.size, masks: masks.size };
}
