// Sprite registry. Sprites are *defined* at module load (works in node/tests),
// and *compiled* to canvases lazily on first use (needs a DOM).
//
// Three ways to author art:
//  1. definePixelSprite  — ASCII rows + palette (best for small detailed sprites)
//  2. defineDrawnSprite  — draw with PixelPainter primitives (best for blobs, bosses, effects)
//  3. defineCanvasSprite — raw Canvas2D drawing (gradients, text, ... rarely needed)
// Animations are lists of sprite names + fps (defineAnim).

import { PixelPainter } from './painter';

export interface Sprite {
  name: string;
  w: number;
  h: number;
  /** pivot inside the sprite, in pixels. Drawing at (x,y) puts the pivot at (x,y). */
  ox: number;
  oy: number;
  canvas: HTMLCanvasElement;
  /** lazily created solid-white silhouette used for hit flashes */
  flash?: HTMLCanvasElement;
  tints?: Map<string, HTMLCanvasElement>;
}

export interface SpriteOptions {
  /** pivot; default: center of the sprite */
  origin?: [number, number];
  /** 'bottom' => pivot at bottom-center (good for characters standing on the ground) */
  anchor?: 'center' | 'bottom' | 'topleft';
  /** add a 1px outline in this color (canvas grows by 1px on every side) */
  outline?: string;
  outlineCorners?: boolean;
}

type SpriteDef =
  | { kind: 'pixel'; palette: Record<string, string>; rows: string[]; opts: SpriteOptions }
  | { kind: 'drawn'; w: number; h: number; draw: (p: PixelPainter) => void; opts: SpriteOptions }
  | { kind: 'canvas'; w: number; h: number; draw: (ctx: CanvasRenderingContext2D) => void; opts: SpriteOptions };

const defs = new Map<string, SpriteDef>();
const compiled = new Map<string, Sprite>();

export interface AnimDef {
  frames: string[];
  fps: number;
  loop: boolean;
}
const anims = new Map<string, AnimDef>();

function checkName(name: string) {
  if (defs.has(name) && import.meta.env?.DEV) {
    console.warn(`[sprites] sprite "${name}" defined twice — the later definition wins`);
  }
}

export function definePixelSprite(name: string, palette: Record<string, string>, rows: string[], opts: SpriteOptions = {}): string {
  checkName(name);
  defs.set(name, { kind: 'pixel', palette, rows, opts });
  compiled.delete(name);
  return name;
}

export function defineDrawnSprite(name: string, w: number, h: number, draw: (p: PixelPainter) => void, opts: SpriteOptions = {}): string {
  checkName(name);
  defs.set(name, { kind: 'drawn', w, h, draw, opts });
  compiled.delete(name);
  return name;
}

export function defineCanvasSprite(name: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, opts: SpriteOptions = {}): string {
  checkName(name);
  defs.set(name, { kind: 'canvas', w, h, draw, opts });
  compiled.delete(name);
  return name;
}

export function defineAnim(name: string, frames: string[], fps = 8, loop = true): string {
  anims.set(name, { frames, fps, loop });
  return name;
}

export function hasSprite(name: string): boolean {
  return defs.has(name);
}

export function hasAnim(name: string): boolean {
  return anims.has(name);
}

export function getAnim(name: string): AnimDef | undefined {
  return anims.get(name);
}

export function listSprites(): string[] {
  return [...defs.keys()];
}

/** Frame name of animation `anim` at time `t` seconds. Falls back to `anim` itself as a sprite name. */
export function animFrame(anim: string, t: number): string {
  const a = anims.get(anim);
  if (!a) return anim;
  const n = a.frames.length;
  let i = Math.floor(t * a.fps);
  i = a.loop ? ((i % n) + n) % n : Math.min(i, n - 1);
  return a.frames[i];
}

export function animDuration(anim: string): number {
  const a = anims.get(anim);
  return a ? a.frames.length / a.fps : 0;
}

function pivot(w: number, h: number, opts: SpriteOptions, pad: number): [number, number] {
  if (opts.origin) return [opts.origin[0] + pad, opts.origin[1] + pad];
  switch (opts.anchor) {
    case 'bottom': return [Math.floor(w / 2) + pad, h + pad];
    case 'topleft': return [pad, pad];
    default: return [Math.floor(w / 2) + pad, Math.floor(h / 2) + pad];
  }
}

function compile(name: string, def: SpriteDef): Sprite {
  const pad = def.opts.outline ? 1 : 0;
  let painter: PixelPainter | null = null;
  let w: number;
  let h: number;
  if (def.kind === 'pixel') {
    h = def.rows.length;
    w = def.rows.reduce((m, r) => Math.max(m, r.length), 0);
    painter = new PixelPainter(w + pad * 2, h + pad * 2);
    painter.stamp(pad, pad, def.rows, def.palette);
  } else if (def.kind === 'drawn') {
    w = def.w;
    h = def.h;
    if (pad) {
      const inner = new PixelPainter(w, h);
      def.draw(inner);
      painter = new PixelPainter(w + 2, h + 2);
      painter.blit(inner, 1, 1);
    } else {
      painter = new PixelPainter(w, h);
      def.draw(painter);
    }
  } else {
    w = def.w;
    h = def.h;
  }
  let canvas: HTMLCanvasElement;
  if (painter) {
    if (def.opts.outline) painter.outline(def.opts.outline, def.opts.outlineCorners);
    canvas = painter.toCanvas();
  } else {
    canvas = document.createElement('canvas');
    canvas.width = w + pad * 2;
    canvas.height = h + pad * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(pad, pad);
    (def as Extract<SpriteDef, { kind: 'canvas' }>).draw(ctx);
  }
  const [ox, oy] = pivot(w, h, def.opts, pad);
  return { name, w: canvas.width, h: canvas.height, ox, oy, canvas };
}

let missing: Sprite | null = null;
function missingSprite(name: string): Sprite {
  if (!missing) {
    const p = new PixelPainter(8, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) p.px(x, y, ((x >> 2) + (y >> 2)) % 2 ? '#ff00ff' : '#000000');
    missing = { name: '__missing', w: 8, h: 8, ox: 4, oy: 4, canvas: p.toCanvas() };
  }
  if (import.meta.env?.DEV) warnMissing(name);
  return missing;
}

const warned = new Set<string>();
function warnMissing(name: string) {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(`[sprites] missing sprite "${name}"`);
}

export function getSprite(name: string): Sprite {
  let s = compiled.get(name);
  if (s) return s;
  const def = defs.get(name);
  if (!def) return missingSprite(name);
  s = compile(name, def);
  compiled.set(name, s);
  return s;
}

/** White silhouette of a sprite (for hit flash). */
export function getFlash(s: Sprite): HTMLCanvasElement {
  if (s.flash) return s.flash;
  s.flash = getTintCanvas(s, '#ffffff');
  return s.flash;
}

/** Solid-color silhouette of a sprite (cached per color). */
export function getTintCanvas(s: Sprite, color: string): HTMLCanvasElement {
  if (!s.tints) s.tints = new Map();
  let c = s.tints.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = s.w;
  c.height = s.h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(s.canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, s.w, s.h);
  s.tints.set(color, c);
  return c;
}

/** Pre-compile every defined sprite (call during a loading screen to avoid hitches). */
export function warmAllSprites(): void {
  for (const [name, def] of defs) {
    if (!compiled.has(name)) {
      try {
        compiled.set(name, compile(name, def));
      } catch (e) {
        console.error(`[sprites] failed to compile "${name}"`, e);
      }
    }
  }
}
