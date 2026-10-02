// Animated title backdrop: looking down a spiral stairwell that descends into
// darkness. Pre-painted pixel layers (top floor with the shaft opening, then
// ledges + brick walls for every level, each deeper and darker) drift with
// parallax; a keeper stands at the rim with a flickering lantern, embers rise
// out of the abyss, dust falls through a pale light shaft, candles flicker on
// the ledges and sometimes a pair of eyes opens far below.
//
// One shared instance keeps time & particles continuous across the title,
// character select, collection and credits screens.

import type { Renderer } from '../engine/renderer';
import { VIEW_H, VIEW_W } from '../engine/renderer';
import { PixelPainter, bayer } from '../engine/painter';
import { clamp, mixColor, TAU } from '../engine/math';
import { fx } from '../engine/rng';
import { animFrame, hasAnim } from '../engine/sprites';
import { input } from '../engine/input';
import { app } from '../game/app';

// composed for the 384 px wide 16:9 view; wider / narrower views keep it centered
// (`ox`) and the top floor is repainted to cover the whole width
const BASE_W = 384;
const CX = 192;
const CY0 = 78;
const RX0 = 152;
const SQ = 0.54;
const SHRINK = 0.8;
const LEVELS = 7;
const MARGIN = 14;

const STONE = ['#211c2c', '#2e2840', '#3e3654', '#4e4668', '#655c80', '#7e74a0'];
const MORTAR = '#15111d';
const VOID = '#05030a';

interface Level {
  /** center y of this level's ledge */
  cy: number;
  rx: number;
  ry: number;
  /** wall top center (previous level's ledge height) */
  topCy: number;
  canvas: HTMLCanvasElement | null;
  ox: number;
  oy: number;
  depth: number;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  kind: 'ember' | 'dust';
  size: number;
}

function hash(a: number, b: number, c = 0): number {
  let n = a * 374761393 + b * 668265263 + c * 2147483647;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function shade(c: string, k: number): string {
  return mixColor(c, VOID, clamp(k, 0, 1));
}

export class StairwellBackdrop {
  t = 0;
  private built = false;
  private levels: Level[] = [];
  private top: HTMLCanvasElement | null = null;
  /** VIEW_W the top floor / light map / vignette were built for */
  private builtW = 0;
  private lightCv: HTMLCanvasElement | null = null;
  private vignette: HTMLCanvasElement | null = null;
  private motes: Mote[] = [];
  private eyes: { x: number; y: number; t: number; dur: number } | null = null;
  private eyeCD = 4;
  private camX = 0;
  private camY = 0;
  /** character sprite prefix of the keeper standing at the rim */
  keeper = 'ria';
  /** draw the keeper + hand lantern at the rim */
  showKeeper = true;
  /** 0..1 extra darkness (sub-screens) */
  dim = 0;
  private dimTarget = 0;

  setDim(v: number): void {
    this.dimTarget = clamp(v, 0, 1);
  }

  // ---------------------------------------------------------------- geometry
  private geometry(): void {
    this.levels = [];
    let rx = RX0;
    let cy = CY0;
    for (let j = 1; j <= LEVELS; j++) {
      const outer = rx * SHRINK; // ledge j hugs the wall below the previous opening
      const ry = outer * SQ;
      const dy = Math.max(4, ry * 0.34);
      const topCy = cy;
      cy += dy;
      this.levels.push({ cy, rx: outer, ry, topCy, canvas: null, ox: 0, oy: 0, depth: j });
      rx = outer;
    }
  }

  /** Abyss center (deepest level). */
  get abyss(): { x: number; y: number } {
    const l = this.levels[this.levels.length - 1];
    return { x: CX, y: l ? l.cy : CY0 + 80 };
  }

  /** x offset that centers the 384-wide composition in the current view */
  private get ox(): number {
    return Math.round((VIEW_W - BASE_W) / 2);
  }

  private build(): void {
    if (typeof document === 'undefined') return;
    if (this.built && this.builtW === VIEW_W) return;
    const first = !this.built;
    this.built = true;
    this.builtW = VIEW_W;
    if (first) {
      this.geometry();
      for (const l of this.levels) this.paintLevel(l);
    }
    this.paintTop();
    this.lightCv = document.createElement('canvas');
    this.lightCv.width = VIEW_W;
    this.lightCv.height = VIEW_H;
    const v = document.createElement('canvas');
    v.width = VIEW_W;
    v.height = VIEW_H;
    const g = v.getContext('2d')!;
    const grd = g.createRadialGradient(VIEW_W / 2, VIEW_H * 0.55, VIEW_H * 0.3, VIEW_W / 2, VIEW_H * 0.55, VIEW_W * 0.62);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.7)');
    g.fillStyle = grd;
    g.fillRect(0, 0, VIEW_W, VIEW_H);
    this.vignette = v;
    // pre-warm particles so the first frame already looks alive
    if (first) for (let i = 0; i < 240; i++) this.updateMotes(1 / 30);
  }

  private paintLevel(l: Level): void {
    const wallRx = l.rx;
    const wallRy = l.ry;
    const x0 = Math.floor(CX - wallRx - 2);
    const x1 = Math.ceil(CX + wallRx + 2);
    const y0 = Math.floor(l.topCy - wallRy - 4);
    const y1 = Math.ceil(l.cy + l.ry + 2);
    const w = x1 - x0;
    const h = y1 - y0;
    const p = new PixelPainter(w, h);
    const depthK = (l.depth - 1) / LEVELS;
    const dark = 0.12 + depthK * 0.72;
    // ---- wall: swept ellipse from the opening down to this ledge
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const nx = (x + 0.5 - CX) / wallRx;
        if (Math.abs(nx) >= 1) continue;
        const hh = wallRy * Math.sqrt(1 - nx * nx);
        const top = l.topCy - 3 - hh;
        const bottom = l.cy + hh;
        if (y < top || y > bottom) continue;
        // the hole inside this level's ledge stays open (deeper levels show through)
        const hx = (x + 0.5 - CX) / (l.rx * SHRINK);
        const hy = (y + 0.5 - l.cy) / (l.ry * SHRINK);
        if (hx * hx + hy * hy < 1) continue;
        const u = Math.acos(nx); // 0..PI
        const arc = u * wallRx;
        const v = y - (l.topCy - hh);
        const row = Math.floor(v / 4);
        const bx = arc + (row % 2) * 3.5;
        const mortar = ((v % 4) + 4) % 4 < 1 || ((bx % 7) + 7) % 7 < 1;
        const curve = nx * nx * 0.55;
        const vert = clamp(v / Math.max(8, l.cy - l.topCy + 6), 0, 1) * 0.35;
        const n = hash(Math.floor(bx / 7), row, l.depth);
        let base = n < 0.2 ? STONE[2] : n < 0.75 ? STONE[3] : STONE[4];
        if (mortar) base = MORTAR;
        else if (((v % 4) + 4) % 4 === 1 && n > 0.3) base = STONE[4];
        p.px(x - x0, y - y0, shade(base, dark + 0.18 + curve + vert));
      }
    }
    // ---- ledge (spiral steps) on top
    const steps = 16;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const nx = (x + 0.5 - CX) / l.rx;
        const ny = (y + 0.5 - l.cy) / l.ry;
        const d = Math.sqrt(nx * nx + ny * ny);
        if (d > 1 || d < SHRINK) continue;
        const q = (d - SHRINK) / (1 - SHRINK); // 0 lip .. 1 wall
        const phi = Math.atan2(ny, nx);
        const s = ((phi + Math.PI) / TAU) * steps + l.depth * 3.7;
        const idx = Math.floor(s);
        const frac = s - idx;
        const n = hash(idx, l.depth, 7);
        let c = n < 0.33 ? STONE[3] : n < 0.66 ? STONE[4] : STONE[5];
        if (frac < 0.07) c = STONE[1];
        else if (frac < 0.14) c = STONE[2];
        if (q < 0.16) c = STONE[5];
        if (q > 0.84) c = STONE[1];
        if (bayer(x, y) < 0.18 && q > 0.2 && q < 0.8) c = STONE[2];
        // stair descends along the spiral: later steps a little darker
        const desc = ((s % steps) / steps) * 0.12;
        const near = ny > 0 ? 0.12 : 0; // near side faces away from the light shaft
        p.px(x - x0, y - y0, shade(c, dark + desc + near));
      }
    }
    l.canvas = p.toCanvas();
    l.ox = x0;
    l.oy = y0;
  }

  private paintTop(): void {
    const w = VIEW_W + MARGIN * 2;
    const h = VIEW_H + MARGIN * 2;
    const p = new PixelPainter(w, h);
    const ry0 = RX0 * SQ;
    const ox = this.ox;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx0 = x - MARGIN; // screen x
        const wx = sx0 - ox; // composition x
        const wy = y - MARGIN;
        const nx = (wx + 0.5 - CX) / RX0;
        const ny = (wy + 0.5 - CY0) / ry0;
        const d = Math.sqrt(nx * nx + ny * ny);
        if (d < 1) continue;
        // flagstones (staggered 18x11)
        const row = Math.floor(wy / 14);
        const sx = wx + (row % 2) * 12 + (row % 3) * 5;
        const col = Math.floor(sx / 24);
        const gx = ((sx % 24) + 24) % 24;
        const gy = ((wy % 14) + 14) % 14;
        const n = hash(col, row, 3);
        let c = n < 0.35 ? STONE[2] : n < 0.85 ? STONE[3] : STONE[4];
        if (gx === 0 || gy === 0) c = MORTAR;
        else if (gy === 1 || gx === 1) c = mixColor(c, '#8a80a8', 0.18);
        else if (gy === 13 || gx === 23) c = STONE[1];
        const crack = hash(Math.floor(wx / 3), Math.floor(wy / 3), 9);
        if (crack < 0.02 && gx > 2 && gy > 2) c = MORTAR;
        if (bayer(wx, wy) < 0.12) c = mixColor(c, STONE[1], 0.5);
        // moss toward the corners
        const mossN = hash(Math.floor(wx / 4), Math.floor(wy / 4), 5);
        if (mossN < 0.08 && (wy < 30 || sx0 < 40 || sx0 > VIEW_W - 40)) c = mossN < 0.04 ? '#2e4a2e' : '#3a5a32';
        // rim stones around the opening
        if (d < 1.07) {
          const a = Math.atan2(ny, nx);
          const seg = Math.floor(((a + Math.PI) / TAU) * 42);
          const sn = hash(seg, 1, 11);
          c = d < 1.025 ? '#8a80a8' : sn < 0.5 ? STONE[4] : STONE[5];
          const frac = (((a + Math.PI) / TAU) * 42) % 1;
          if (frac < 0.08) c = MORTAR;
          if (d < 1.012 && ny > 0) c = STONE[2];
        }
        // outer darkness toward the screen edges
        const edge = Math.min(sx0 + 10, wy + 10, VIEW_W + 10 - sx0, VIEW_H + 10 - wy);
        const fade = edge < 30 ? (30 - edge) / 30 : 0;
        p.px(x, y, shade(c, 0.3 + fade * 0.55));
      }
    }
    // a few scattered bones and pebbles
    const rnd = (i: number, k: number) => hash(i, k, 21);
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(rnd(i, 1) * w);
      const y = Math.floor(rnd(i, 2) * h);
      const nx = (x - MARGIN - ox - CX) / RX0;
      const ny = (y - MARGIN - CY0) / ry0;
      if (nx * nx + ny * ny < 1.25) continue;
      if (rnd(i, 3) < 0.35) {
        p.rect(x, y, 4, 1, '#b8ae98');
        p.px(x - 1, y - 1, '#b8ae98');
        p.px(x + 4, y + 1, '#b8ae98');
        p.rect(x, y + 1, 4, 1, '#5a5048');
      } else {
        p.px(x, y, STONE[5]);
        p.px(x + 1, y, STONE[3]);
        p.px(x, y + 1, STONE[1]);
      }
    }
    this.top = p.toCanvas();
  }

  // ---------------------------------------------------------------- update
  private keeperPos(): { x: number; y: number } {
    const a = 1.98; // radians, lower-left of the rim
    return { x: Math.round(CX + Math.cos(a) * (RX0 + 6)), y: Math.round(CY0 + Math.sin(a) * RX0 * SQ + 16) };
  }

  update(dt: number): void {
    this.build();
    this.t += dt;
    this.dim += (this.dimTarget - this.dim) * Math.min(1, dt * 4);
    // parallax camera: slow drift + a hint of mouse
    // mouse coords are display-canvas pixels (its size follows the capped DPR)
    const disp = app.renderer?.display;
    const mx = input.mouseX && disp ? input.mouseX / Math.max(1, disp.width) - 0.5 : 0;
    const my = input.mouseY && disp ? input.mouseY / Math.max(1, disp.height) - 0.5 : 0;
    const tx = Math.sin(this.t * 0.13) * 5 + clamp(mx, -0.5, 0.5) * 8;
    const ty = Math.sin(this.t * 0.09 + 1) * 3 + clamp(my, -0.5, 0.5) * 5;
    const k = Math.min(1, dt * 2.5);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    this.updateMotes(dt);
    this.eyeCD -= dt;
    if (this.eyes) {
      this.eyes.t += dt;
      if (this.eyes.t > this.eyes.dur) this.eyes = null;
    } else if (this.eyeCD <= 0) {
      const ab = this.abyss;
      this.eyes = { x: ab.x + fx.range(-14, 14), y: ab.y + fx.range(-5, 6), t: 0, dur: fx.range(1.4, 2.4) };
      this.eyeCD = fx.range(6, 11);
    }
  }

  private updateMotes(dt: number): void {
    if (!this.levels.length) this.geometry();
    const ab = this.abyss;
    if (fx.chance(dt * 6)) {
      this.motes.push({
        x: ab.x + fx.range(-18, 18), y: ab.y + fx.range(-6, 6), vx: fx.range(-5, 5), vy: -fx.range(12, 30),
        life: fx.range(4, 8), age: 0, kind: 'ember', size: fx.chance(0.12) ? 2 : 1,
      });
    }
    if (fx.chance(dt * 6)) {
      this.motes.push({
        x: fx.range(150, 330), y: -4, vx: fx.range(-3, 1), vy: fx.range(4, 9),
        life: fx.range(10, 20), age: 0, kind: 'dust', size: 1,
      });
    }
    for (const m of this.motes) {
      m.age += dt;
      if (m.kind === 'ember') {
        m.vx += Math.sin(m.age * 2.3 + m.y * 0.05) * dt * 10;
        m.vy -= dt * 2;
      } else {
        m.vx = Math.sin(m.age * 0.8 + m.x) * 3;
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
    }
    this.motes = this.motes.filter((m) => m.age < m.life && m.y > -10 && m.y < VIEW_H + 10);
    if (this.motes.length > 260) this.motes.splice(0, this.motes.length - 260);
  }

  // ---------------------------------------------------------------- draw
  /** Draw into the world canvas (call between beginWorld / presentWorld). */
  draw(r: Renderer): void {
    this.build();
    const c = r.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = VOID;
    c.fillRect(0, 0, VIEW_W, VIEW_H);
    const ox = this.ox;
    c.setTransform(1, 0, 0, 1, ox, 0); // composition space (384 wide, centered)
    const par = (depth: number) => {
      const k = 1 - depth / (LEVELS + 2);
      return { x: Math.round(this.camX * k), y: Math.round(this.camY * k) };
    };
    // abyss glow (behind everything)
    const ab = this.abyss;
    const deep = par(LEVELS + 1);
    const pulseA = 0.35 + 0.12 * Math.sin(this.t * 0.7);
    const g = c.createRadialGradient(ab.x + deep.x, ab.y + deep.y, 0, ab.x + deep.x, ab.y + deep.y, 40);
    g.addColorStop(0, `rgba(160,60,20,${pulseA})`);
    g.addColorStop(1, 'rgba(160,60,20,0)');
    c.fillStyle = g;
    c.fillRect(-ox, 0, VIEW_W, VIEW_H);

    // levels deepest first
    for (let i = this.levels.length - 1; i >= 0; i--) {
      const l = this.levels[i];
      const o = par(l.depth);
      if (l.canvas) c.drawImage(l.canvas, l.ox + o.x, l.oy + o.y);
      this.drawLevelProps(r, l, o);
    }
    // chains hanging into the shaft from the far rim
    this.drawChains(r, par(0.5));
    // top floor
    const o0 = par(0);
    if (this.top) c.drawImage(this.top, -MARGIN - ox + o0.x, -MARGIN + o0.y);
    // keeper at the rim
    const kp = this.keeperPos();
    const kx = kp.x + o0.x;
    const ky = kp.y + o0.y;
    const lx = kx + 8;
    const ly = ky - 9 + Math.round(Math.sin(this.t * 1.7) * 0.6);
    if (this.showKeeper) {
      c.globalAlpha = 0.45;
      c.fillStyle = '#000000';
      c.beginPath();
      c.ellipse(kx, ky, 6, 2, 0, 0, TAU);
      c.fill();
      c.globalAlpha = 1;
      const anim = hasAnim(`${this.keeper}_idle_up`) ? `${this.keeper}_idle_up` : `${this.keeper}_idle_down`;
      if (hasAnim(anim)) r.spriteScreen(animFrame(anim, this.t), kx, ky);
      // hand lantern
      c.fillStyle = '#0c0810';
      c.fillRect(lx - 2, ly - 3, 5, 7);
      c.fillStyle = '#ffd070';
      c.fillRect(lx - 1, ly - 2, 3, 4);
      c.fillStyle = '#fff4c0';
      c.fillRect(lx, ly - 1, 1, 2);
      c.fillStyle = '#3a3046';
      c.fillRect(lx - 1, ly - 4, 3, 1);
    }

    // dust (lit by the light map)
    for (const m of this.motes) {
      if (m.kind !== 'dust') continue;
      const a = Math.min(1, m.age / 1.5) * Math.min(1, (m.life - m.age) / 2) * 0.55;
      c.globalAlpha = a;
      c.fillStyle = '#e8e0f8';
      c.fillRect(Math.round(m.x + o0.x * 0.5), Math.round(m.y + o0.y * 0.5), 1, 1);
    }
    c.globalAlpha = 1;

    // ---- lighting (multiply)
    const flick = 0.86 + 0.08 * Math.sin(this.t * 13.1) + 0.06 * Math.sin(this.t * 7.3 + 1.1);
    const lc = this.lightCv!;
    const L = lc.getContext('2d')!;
    L.setTransform(1, 0, 0, 1, ox, 0);
    L.globalCompositeOperation = 'source-over';
    L.globalAlpha = 1;
    L.fillStyle = mixColor('#2a2440', '#000000', this.dim * 0.5);
    L.fillRect(-ox, 0, VIEW_W, VIEW_H);
    L.globalCompositeOperation = 'lighter';
    const light = (x: number, y: number, rad: number, col: string, a: number) => {
      const gg = L.createRadialGradient(x, y, 0, x, y, rad);
      gg.addColorStop(0, col);
      gg.addColorStop(0.45, col + '90');
      gg.addColorStop(1, col + '00');
      L.globalAlpha = clamp(a, 0, 1);
      L.fillStyle = gg;
      L.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    };
    if (this.showKeeper) {
      light(lx, ly, 120 * (0.95 + 0.05 * flick), '#ffcf8a', 0.95 * flick);
      light(lx, ly, 34, '#fff0c0', 0.6 * flick);
    } else {
      light(CX + o0.x, VIEW_H * 0.55, 150, '#c89a6a', 0.5);
    }
    light(ab.x + deep.x, ab.y + deep.y, 70, '#ff7a30', 0.45 + 0.1 * Math.sin(this.t * 0.7));
    light(296 + o0.x, 4 + o0.y, 120, '#5a68b0', 0.45);
    for (const l of this.levels) {
      for (const cd of this.candleSpots(l)) {
        const o = par(l.depth);
        light(cd.x + o.x, cd.y + o.y - 3, 26, '#ffb060', (0.5 + 0.1 * Math.sin(this.t * 9 + cd.x)) * (1 - l.depth / (LEVELS + 2)));
      }
    }
    for (const m of this.motes) if (m.kind === 'ember') light(m.x, m.y, 7, '#ff9040', 0.4 * this.emberAlpha(m));
    L.globalAlpha = 1;
    c.globalCompositeOperation = 'multiply';
    c.drawImage(lc, -ox, 0);
    c.globalCompositeOperation = 'source-over';

    // ---- emissive on top: candle flames, embers, eyes, light shaft
    for (const l of this.levels) {
      const o = par(l.depth);
      for (const cd of this.candleSpots(l)) {
        const fl = Math.sin(this.t * 11 + cd.x) > 0 ? 1 : 0;
        c.fillStyle = '#ff9a3a';
        c.fillRect(cd.x + o.x, cd.y + o.y - 4 - fl, 1, 2 + fl);
        c.fillStyle = '#fff0b0';
        c.fillRect(cd.x + o.x, cd.y + o.y - 3, 1, 1);
      }
    }
    c.globalCompositeOperation = 'lighter';
    for (const m of this.motes) {
      if (m.kind !== 'ember') continue;
      const a = this.emberAlpha(m);
      c.globalAlpha = a;
      c.fillStyle = m.age / m.life < 0.5 ? '#ffd070' : '#ff7030';
      c.fillRect(Math.round(m.x), Math.round(m.y), m.size, m.size);
      c.globalAlpha = a * 0.35;
      c.fillStyle = '#ff6020';
      c.fillRect(Math.round(m.x) - 1, Math.round(m.y) - 1, m.size + 2, m.size + 2);
    }
    // light shaft from the upper right
    c.globalAlpha = 0.07 + 0.015 * Math.sin(this.t * 0.5);
    const sg = c.createLinearGradient(300, 0, 200, VIEW_H);
    sg.addColorStop(0, '#c8d0ff');
    sg.addColorStop(1, 'rgba(200,208,255,0)');
    c.fillStyle = sg;
    c.beginPath();
    c.moveTo(262 + o0.x, -4);
    c.lineTo(338 + o0.x, -4);
    c.lineTo(250 + o0.x * 0.5, VIEW_H);
    c.lineTo(150 + o0.x * 0.5, VIEW_H);
    c.closePath();
    c.fill();
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    if (this.eyes) {
      const e = this.eyes;
      const open = Math.min(1, e.t / 0.25) * Math.min(1, (e.dur - e.t) / 0.25);
      const blink = Math.abs(e.t - e.dur * 0.55) < 0.06 ? 0 : 1;
      if (open * blink > 0.05) {
        c.globalAlpha = open;
        c.fillStyle = '#ff4030';
        const ex = Math.round(e.x + deep.x);
        const ey = Math.round(e.y + deep.y);
        c.fillRect(ex, ey, 1, 1);
        c.fillRect(ex + 4, ey, 1, 1);
        c.globalAlpha = open * 0.3;
        c.fillRect(ex - 1, ey - 1, 3, 3);
        c.fillRect(ex + 3, ey - 1, 3, 3);
        c.globalAlpha = 1;
      }
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (this.vignette) c.drawImage(this.vignette, 0, 0);
    if (this.dim > 0.01) {
      c.globalAlpha = this.dim * 0.55;
      c.fillStyle = VOID;
      c.fillRect(0, 0, VIEW_W, VIEW_H);
      c.globalAlpha = 1;
    }
  }

  private emberAlpha(m: Mote): number {
    return Math.min(1, m.age / 0.8) * Math.min(1, (m.life - m.age) / 1.5);
  }

  private candleSpots(l: Level): { x: number; y: number }[] {
    // candles on the far half of the ledge (visible), two per level
    const out: { x: number; y: number }[] = [];
    if (l.depth > 5) return out;
    for (const a of [-2.35 + l.depth * 0.31, -0.62 - l.depth * 0.23]) {
      const rr = (1 + SHRINK) / 2;
      out.push({ x: Math.round(CX + Math.cos(a) * l.rx * rr), y: Math.round(l.cy + Math.sin(a) * l.ry * rr) });
    }
    return out;
  }

  private drawLevelProps(r: Renderer, l: Level, o: { x: number; y: number }): void {
    const c = r.ctx;
    for (const cd of this.candleSpots(l)) {
      c.fillStyle = '#0c0810';
      c.fillRect(cd.x + o.x - 1, cd.y + o.y - 2, 3, 4);
      c.fillStyle = '#d8ccb0';
      c.fillRect(cd.x + o.x, cd.y + o.y - 2, 1, 3);
    }
  }

  private drawChains(r: Renderer, o: { x: number; y: number }): void {
    const c = r.ctx;
    const ry0 = RX0 * SQ;
    for (const [ax, len, ph] of [[128, 70, 0], [246, 96, 1.7]] as const) {
      const nx = (ax - CX) / RX0;
      const topY = CY0 - ry0 * Math.sqrt(Math.max(0, 1 - nx * nx)) - 2;
      const sway = Math.sin(this.t * 0.6 + ph) * 2;
      for (let i = 0; i < len; i += 3) {
        const k = i / len;
        const x = Math.round(ax + o.x + sway * k * k);
        const y = Math.round(topY + o.y + i);
        c.fillStyle = shade(i % 6 === 0 ? '#6a6080' : '#4a4260', 0.2 + k * 0.6);
        c.fillRect(x - (i % 6 === 0 ? 1 : 0), y, i % 6 === 0 ? 3 : 1, 2);
      }
    }
  }
}

let shared: StairwellBackdrop | null = null;
/** The shared title backdrop (continuous across menu screens). */
export function backdrop(): StairwellBackdrop {
  if (!shared) shared = new StairwellBackdrop();
  return shared;
}
