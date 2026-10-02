// Renderer: a low-resolution "world" canvas (VIEW_W x VIEW_H) that is scaled up
// with nearest-neighbour filtering, plus a high-resolution UI layer drawn directly
// on the display canvas in a virtual UI_W x UI_H coordinate space.

import { getFlash, getSprite, getTintCanvas, animFrame, type Sprite } from './sprites';
import { clamp, TAU } from './math';
import { fx } from './rng';

export const VIEW_W = 384;
export const VIEW_H = 216;
export const UI_W = 768;
export const UI_H = 432;

export interface DrawOpts {
  flipX?: boolean;
  flipY?: boolean;
  /** rotation in radians around the pivot */
  rot?: number;
  sx?: number;
  sy?: number;
  alpha?: number;
  /** 0..1 white flash amount */
  flash?: number;
  /** silhouette tint color + amount 0..1 */
  tint?: string;
  tintAmount?: number;
  additive?: boolean;
}

export interface TextOpts {
  size?: number;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  bold?: boolean;
  /** drop shadow color, or false. default '#000000aa' style shadow */
  shadow?: string | false;
  outline?: string;
  alpha?: number;
  font?: 'main' | 'small';
}

// ---------------------------------------------------------------- tiny world font
// 3x5 bitmap glyphs for numbers / short words drawn in world space (damage numbers etc.)
const GLYPHS: Record<string, string[]> = {
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
  '/': ['001', '001', '010', '100', '100'],
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

export class Renderer {
  readonly display: HTMLCanvasElement;
  readonly dctx: CanvasRenderingContext2D;
  readonly world: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  /** display pixels per world pixel */
  scale = 1;
  /** display pixels per UI unit */
  uiScale = 0.5;
  offsetX = 0;
  offsetY = 0;
  pixelPerfect = false;

  // camera (world coords of the view's top-left corner)
  camX = 0;
  camY = 0;
  private shakeTrauma = 0;
  private kickX = 0;
  private kickY = 0;
  shakeX = 0;
  shakeY = 0;
  shakeIntensity = 1; // settings multiplier
  private time = 0;

  // full-screen overlays
  flashColor = '#ffffff';
  flashAlpha = 0;

  constructor(display: HTMLCanvasElement) {
    this.display = display;
    this.dctx = display.getContext('2d', { alpha: false })!;
    this.world = document.createElement('canvas');
    this.world.width = VIEW_W;
    this.world.height = VIEW_H;
    this.ctx = this.world.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (this.display.width !== w || this.display.height !== h) {
      this.display.width = w;
      this.display.height = h;
    }
    let s = Math.min(w / VIEW_W, h / VIEW_H);
    if (this.pixelPerfect && s >= 1) s = Math.floor(s);
    this.scale = s;
    this.uiScale = s * (VIEW_W / UI_W);
    this.offsetX = Math.floor((w - VIEW_W * s) / 2);
    this.offsetY = Math.floor((h - VIEW_H * s) / 2);
    this.dctx.imageSmoothingEnabled = false;
  }

  /** Convert display (canvas backing) coords to UI coords. */
  displayToUI(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.offsetX) / this.uiScale, y: (y - this.offsetY) / this.uiScale };
  }

  /** Convert display coords to world coords (camera applied). */
  displayToWorld(x: number, y: number): { x: number; y: number } {
    return {
      x: (x - this.offsetX) / this.scale + this.camX,
      y: (y - this.offsetY) / this.scale + this.camY,
    };
  }

  // ------------------------------------------------------------ camera / shake
  /** Add screen shake trauma (0..1). Shake magnitude ~ trauma^2. */
  shake(amount: number): void {
    this.shakeTrauma = clamp(this.shakeTrauma + amount * this.shakeIntensity, 0, 1);
  }

  /** Directional camera kick (e.g. recoil). */
  kick(dx: number, dy: number): void {
    this.kickX += dx * this.shakeIntensity;
    this.kickY += dy * this.shakeIntensity;
  }

  screenFlash(color: string, alpha: number): void {
    this.flashColor = color;
    this.flashAlpha = Math.max(this.flashAlpha, alpha);
  }

  updateEffects(dt: number): void {
    this.time += dt;
    this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 1.6);
    const t = this.shakeTrauma * this.shakeTrauma;
    const mag = 7 * t;
    this.shakeX = (fx.next() * 2 - 1) * mag + this.kickX;
    this.shakeY = (fx.next() * 2 - 1) * mag + this.kickY;
    const k = Math.exp(-dt * 18);
    this.kickX *= k;
    this.kickY *= k;
    this.flashAlpha = Math.max(0, this.flashAlpha - dt * 3);
  }

  /** Integer camera offset actually used for drawing this frame. */
  get viewX(): number {
    return Math.round(this.camX + this.shakeX);
  }

  get viewY(): number {
    return Math.round(this.camY + this.shakeY);
  }

  // ------------------------------------------------------------ world drawing
  beginWorld(clearColor = '#0b0710'): void {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = clearColor;
    c.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  /** Draw a sprite with its pivot at world position (x, y). */
  sprite(name: string, x: number, y: number, o?: DrawOpts): void {
    this.drawSprite(getSprite(name), x - this.viewX, y - this.viewY, o);
  }

  /** Draw a frame of an animation. */
  anim(anim: string, t: number, x: number, y: number, o?: DrawOpts): void {
    this.sprite(animFrame(anim, t), x, y, o);
  }

  /** Draw a sprite at *screen* position (no camera). */
  spriteScreen(name: string, x: number, y: number, o?: DrawOpts): void {
    this.drawSprite(getSprite(name), x, y, o);
  }

  private drawSprite(s: Sprite, x: number, y: number, o?: DrawOpts): void {
    const c = this.ctx;
    const alpha = o?.alpha ?? 1;
    if (alpha <= 0) return;
    const simple = !o || (!o.flipX && !o.flipY && !o.rot && (o.sx ?? 1) === 1 && (o.sy ?? 1) === 1);
    c.globalAlpha = alpha;
    if (o?.additive) c.globalCompositeOperation = 'lighter';
    if (simple) {
      const dx = Math.round(x - s.ox);
      const dy = Math.round(y - s.oy);
      c.drawImage(s.canvas, dx, dy);
      if (o?.tint && (o.tintAmount ?? 1) > 0) {
        c.globalAlpha = alpha * (o.tintAmount ?? 1);
        c.drawImage(getTintCanvas(s, o.tint), dx, dy);
      }
      if (o?.flash && o.flash > 0) {
        c.globalAlpha = alpha * clamp(o.flash, 0, 1);
        c.drawImage(getFlash(s), dx, dy);
      }
    } else {
      c.save();
      c.translate(Math.round(x), Math.round(y));
      if (o!.rot) c.rotate(o!.rot);
      c.scale((o!.flipX ? -1 : 1) * (o!.sx ?? 1), (o!.flipY ? -1 : 1) * (o!.sy ?? 1));
      c.drawImage(s.canvas, -s.ox, -s.oy);
      if (o!.tint && (o!.tintAmount ?? 1) > 0) {
        c.globalAlpha = alpha * (o!.tintAmount ?? 1);
        c.drawImage(getTintCanvas(s, o!.tint), -s.ox, -s.oy);
      }
      if (o!.flash && o!.flash > 0) {
        c.globalAlpha = alpha * clamp(o!.flash, 0, 1);
        c.drawImage(getFlash(s), -s.ox, -s.oy);
      }
      c.restore();
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  rect(x: number, y: number, w: number, h: number, color: string, alpha = 1): void {
    const c = this.ctx;
    c.globalAlpha = alpha;
    c.fillStyle = color;
    c.fillRect(Math.round(x - this.viewX), Math.round(y - this.viewY), Math.round(w), Math.round(h));
    c.globalAlpha = 1;
  }

  circle(x: number, y: number, r: number, color: string, alpha = 1): void {
    const c = this.ctx;
    c.globalAlpha = alpha;
    c.fillStyle = color;
    c.beginPath();
    c.arc(Math.round(x - this.viewX), Math.round(y - this.viewY), Math.max(0.5, r), 0, TAU);
    c.fill();
    c.globalAlpha = 1;
  }

  ring(x: number, y: number, r: number, color: string, width = 1, alpha = 1): void {
    const c = this.ctx;
    c.globalAlpha = alpha;
    c.strokeStyle = color;
    c.lineWidth = width;
    c.beginPath();
    c.arc(Math.round(x - this.viewX) + 0.5, Math.round(y - this.viewY) + 0.5, Math.max(0.5, r), 0, TAU);
    c.stroke();
    c.globalAlpha = 1;
  }

  line(x0: number, y0: number, x1: number, y1: number, color: string, width = 1, alpha = 1): void {
    const c = this.ctx;
    c.globalAlpha = alpha;
    c.strokeStyle = color;
    c.lineWidth = width;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x0 - this.viewX, y0 - this.viewY);
    c.lineTo(x1 - this.viewX, y1 - this.viewY);
    c.stroke();
    c.globalAlpha = 1;
  }

  /** Soft elliptical ground shadow. */
  shadow(x: number, y: number, w: number, h = w * 0.4, alpha = 0.35): void {
    const c = this.ctx;
    c.globalAlpha = alpha;
    c.fillStyle = '#000000';
    c.beginPath();
    c.ellipse(Math.round(x - this.viewX), Math.round(y - this.viewY), Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, TAU);
    c.fill();
    c.globalAlpha = 1;
  }

  /** Tiny 3x5 bitmap text in world space. Returns width in pixels. */
  pixelText(str: string, x: number, y: number, color: string, opts: { align?: 'left' | 'center' | 'right'; outline?: string; scale?: number; alpha?: number } = {}): number {
    const s = opts.scale ?? 1;
    const up = str.toUpperCase();
    const width = (up.length * 4 - 1) * s;
    let sx = Math.round(x - this.viewX);
    const sy = Math.round(y - this.viewY);
    if (opts.align === 'center') sx -= Math.floor(width / 2);
    else if (opts.align === 'right') sx -= width;
    const c = this.ctx;
    c.globalAlpha = opts.alpha ?? 1;
    const drawGlyphs = (ox: number, oy: number, col: string) => {
      c.fillStyle = col;
      for (let i = 0; i < up.length; i++) {
        const g = GLYPHS[up[i]];
        if (!g) continue;
        for (let r = 0; r < 5; r++) {
          for (let k = 0; k < 3; k++) {
            if (g[r][k] === '1') c.fillRect(sx + ox + (i * 4 + k) * s, sy + oy + r * s, s, s);
          }
        }
      }
    };
    if (opts.outline) {
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) drawGlyphs(ox * s, oy * s, opts.outline);
    }
    drawGlyphs(0, 0, color);
    c.globalAlpha = 1;
    return width;
  }

  /** Blit the world canvas (and screen flash) to the display. */
  presentWorld(): void {
    const d = this.dctx;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalAlpha = 1;
    d.globalCompositeOperation = 'source-over';
    d.fillStyle = '#000';
    d.fillRect(0, 0, this.display.width, this.display.height);
    d.imageSmoothingEnabled = false;
    d.drawImage(this.world, this.offsetX, this.offsetY, Math.round(VIEW_W * this.scale), Math.round(VIEW_H * this.scale));
    if (this.flashAlpha > 0) {
      d.globalAlpha = clamp(this.flashAlpha, 0, 1);
      d.fillStyle = this.flashColor;
      d.fillRect(this.offsetX, this.offsetY, VIEW_W * this.scale, VIEW_H * this.scale);
      d.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------ UI layer
  /** Set the display context transform for UI drawing (UI_W x UI_H virtual units). */
  beginUI(): CanvasRenderingContext2D {
    const d = this.dctx;
    d.setTransform(this.uiScale, 0, 0, this.uiScale, this.offsetX, this.offsetY);
    d.imageSmoothingEnabled = false;
    d.globalAlpha = 1;
    d.globalCompositeOperation = 'source-over';
    return d;
  }

  fontString(size: number, bold = false, font: 'main' | 'small' = 'main'): string {
    const fam = font === 'small' ? "'Galmuri9', 'Galmuri11', monospace" : "'Galmuri11', monospace";
    return `${bold ? 'bold ' : ''}${size}px ${fam}`;
  }

  uiText(str: string, x: number, y: number, o: TextOpts = {}): void {
    const d = this.dctx;
    const size = o.size ?? 12;
    d.font = this.fontString(size, o.bold, o.font);
    d.textAlign = o.align ?? 'left';
    d.textBaseline = o.baseline ?? 'top';
    d.globalAlpha = o.alpha ?? 1;
    if (o.outline) {
      d.strokeStyle = o.outline;
      d.lineWidth = Math.max(2, size / 5);
      d.lineJoin = 'round';
      d.strokeText(str, x, y);
    }
    const shadow = o.shadow === undefined ? 'rgba(0,0,0,0.65)' : o.shadow;
    if (shadow) {
      d.fillStyle = shadow;
      const off = Math.max(1, Math.round(size / 12));
      d.fillText(str, x + off, y + off);
    }
    d.fillStyle = o.color ?? '#f4ecdc';
    d.fillText(str, x, y);
    d.globalAlpha = 1;
  }

  measureText(str: string, size = 12, bold = false, font: 'main' | 'small' = 'main'): number {
    this.dctx.font = this.fontString(size, bold, font);
    return this.dctx.measureText(str).width;
  }

  /** Word-wrap text (Korean-aware: breaks on spaces, falls back to characters). */
  wrapText(str: string, maxWidth: number, size = 12, bold = false, font: 'main' | 'small' = 'main'): string[] {
    const lines: string[] = [];
    for (const para of str.split('\n')) {
      const words = para.split(' ');
      let line = '';
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (this.measureText(test, size, bold, font) <= maxWidth) {
          line = test;
          continue;
        }
        if (line) lines.push(line);
        // word itself too long: break by characters
        if (this.measureText(word, size, bold, font) > maxWidth) {
          let chunk = '';
          for (const ch of word) {
            if (this.measureText(chunk + ch, size, bold, font) > maxWidth) {
              lines.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else line = word;
      }
      lines.push(line);
    }
    return lines;
  }

  uiRect(x: number, y: number, w: number, h: number, color: string, alpha = 1): void {
    const d = this.dctx;
    d.globalAlpha = alpha;
    d.fillStyle = color;
    d.fillRect(x, y, w, h);
    d.globalAlpha = 1;
  }

  uiStrokeRect(x: number, y: number, w: number, h: number, color: string, width = 2, alpha = 1): void {
    const d = this.dctx;
    d.globalAlpha = alpha;
    d.strokeStyle = color;
    d.lineWidth = width;
    d.strokeRect(x + width / 2, y + width / 2, w - width, h - width);
    d.globalAlpha = 1;
  }

  /** Draw a sprite in UI space; `scale` 2 == same pixel size as the world layer. */
  uiSprite(name: string, x: number, y: number, scale = 2, o: DrawOpts = {}): void {
    const s = getSprite(name);
    const d = this.dctx;
    d.save();
    d.globalAlpha = o.alpha ?? 1;
    d.translate(x, y);
    if (o.rot) d.rotate(o.rot);
    d.scale(scale * (o.flipX ? -1 : 1) * (o.sx ?? 1), scale * (o.sy ?? 1));
    d.imageSmoothingEnabled = false;
    d.drawImage(s.canvas, -s.ox, -s.oy);
    if (o.tint && (o.tintAmount ?? 1) > 0) {
      d.globalAlpha = (o.alpha ?? 1) * (o.tintAmount ?? 1);
      d.drawImage(getTintCanvas(s, o.tint), -s.ox, -s.oy);
    }
    if (o.flash && o.flash > 0) {
      d.globalAlpha = (o.alpha ?? 1) * clamp(o.flash, 0, 1);
      d.drawImage(getFlash(s), -s.ox, -s.oy);
    }
    d.restore();
  }

  /** Standard dark panel with a pixel border, used by menus and tooltips. */
  uiPanel(x: number, y: number, w: number, h: number, o: { fill?: string; border?: string; highlight?: string; alpha?: number } = {}): void {
    const d = this.dctx;
    const a = o.alpha ?? 0.94;
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    d.globalAlpha = a;
    d.fillStyle = o.border ?? '#0c0810';
    d.fillRect(x + 2, y, w - 4, h);
    d.fillRect(x, y + 2, w, h - 4);
    d.fillStyle = o.fill ?? '#241a2e';
    d.fillRect(x + 2, y + 2, w - 4, h - 4);
    d.fillStyle = o.highlight ?? '#4a3a5c';
    d.fillRect(x + 4, y + 2, w - 8, 2);
    d.fillStyle = '#00000055';
    d.fillRect(x + 4, y + h - 4, w - 8, 2);
    d.globalAlpha = 1;
  }

  endFrame(): void {
    // nothing for now; hook for post effects
  }
}
