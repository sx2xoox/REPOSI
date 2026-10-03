// Shared toolkit for the floor 1–3 bosses (해골 거상, 조종지기, 포자 어미, 점액 여왕,
// 사슬 대장장이, 쇳물 이무기):
//  - pure helpers (phase thresholds, ring-with-gaps angles, pattern picking, path
//    trails for segmented bodies) — unit-tested in tests/bosses13.test.ts
//  - art helpers for big hand-painted sprites (shaded tapered limbs, shaded blobs, cracks)
//  - telegraphed attack entities: expanding Shockwave rings (with gaps to slip
//    through), Eruption pillars (bone / root / fire) and Faller debris from the ceiling
//  - script helpers: phase-change moment, minion bookkeeping, bullet clearing
// Only lazily-compiled sprites are defined here, so the module is safe in node tests.

import { Entity } from '../../game/entity';
import type { World } from '../../game/world';
import type { Enemy } from '../../game/enemy';
import type { Renderer } from '../../engine/renderer';
import type { RNG } from '../../engine/rng';
import type { Script } from '../../engine/script';
import { Projectile, type ProjBehavior } from '../../game/projectile';
import { GroundWarning, RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { angleDiff, clamp, ease, TAU } from '../../engine/math';
import { bayer, PixelPainter } from '../../engine/painter';
import { defineDrawnSprite, hasSprite } from '../../engine/sprites';
import { frames, Hazard, Lob, OUTLINE, WARN_RED } from '../enemies/shared';

export { OUTLINE, WARN_RED };

// ================================================================== pure helpers
/**
 * Phase index for an HP fraction. `thresholds` are descending fractions; every
 * threshold the HP is at or below adds one phase (e.g. [0.6, 0.3]: 0, 1 or 2).
 */
export function phaseFor(frac: number, thresholds: readonly number[]): number {
  let ph = 0;
  for (const t of thresholds) if (frac <= t) ph++;
  return ph;
}

/**
 * Angles of a ring of `count` evenly spaced shots (starting at `offset`) with
 * every shot within `gapWidth / 2` of a gap centre removed — a guaranteed hole
 * the player can slip through.
 */
export function gapRing(count: number, offset: number, gaps: readonly number[], gapWidth: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = offset + (i / count) * TAU;
    if (gaps.some((g) => Math.abs(angleDiff(a, g)) < gapWidth / 2)) continue;
    out.push(a);
  }
  return out;
}

/** Is angle `a` inside one of the gaps (centres `gaps`, total width `gapWidth`)? */
export function inGap(a: number, gaps: readonly number[], gapWidth: number): boolean {
  return gaps.some((g) => Math.abs(angleDiff(a, g)) < gapWidth / 2);
}

export interface PatternOpt<T> {
  id: T;
  w: number;
  /** false = not available right now */
  when?: boolean;
}

/** Weighted pick among available patterns, avoiding an immediate repeat of `last` when possible. */
export function pickPattern<T>(rng: RNG, opts: readonly PatternOpt<T>[], last: T | null): T {
  const avail = opts.filter((o) => o.w > 0 && o.when !== false);
  if (!avail.length) return opts[0].id;
  const pool = avail.length > 1 ? avail.filter((o) => o.id !== last) : avail;
  return (rng.weighted(pool, (o) => o.w) ?? pool[0]).id;
}

export interface TrailPoint {
  x: number;
  y: number;
  z: number;
  /** above ground (drawn / hittable) */
  up: boolean;
}

/**
 * Position history of a moving head; body segments sample it at a fixed
 * distance behind the head (measured along the path in 3D, so a rearing head
 * pulls its neck up into a column).
 */
export class Trail {
  pts: TrailPoint[] = [];
  /** stop recording once the path is this long */
  maxLen: number;
  constructor(maxLen = 200) {
    this.maxLen = maxLen;
  }

  /** Record the head position (skips sub-pixel moves). */
  push(x: number, y: number, z: number, up: boolean): void {
    const h = this.pts[0];
    if (h && Math.hypot(h.x - x, h.y - y, h.z - z) < 0.5) {
      h.up = up;
      return;
    }
    this.pts.unshift({ x, y, z, up });
    // trim to maxLen
    let acc = 0;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1];
      const b = this.pts[i];
      acc += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (acc > this.maxLen) {
        this.pts.length = i + 1;
        break;
      }
    }
  }

  /** Point `d` px behind the head along the recorded path (clamped to the oldest point). */
  sample(d: number): TrailPoint {
    const pts = this.pts;
    if (!pts.length) return { x: 0, y: 0, z: 0, up: false };
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const l = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (acc + l >= d) {
        const t = l > 0 ? (d - acc) / l : 0;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, up: t < 0.5 ? a.up : b.up };
      }
      acc += l;
    }
    const last = pts[pts.length - 1];
    return { ...last };
  }

  /** Reset to a single point (teleport). */
  reset(x: number, y: number, z: number, up: boolean): void {
    this.pts = [{ x, y, z, up }];
  }
}

/** Parabolic hop height: 0 at both ends, `h` in the middle (t in 0..1). */
export function arcZ(t: number, h: number): number {
  const k = clamp(t, 0, 1);
  return 4 * h * k * (1 - k);
}

// ================================================================== art helpers
const LX = -0.55;
const LY = -0.65;

function lumIndex(nx: number, ny: number, n: number, x: number, y: number, dither: boolean): number {
  const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, nx * nx + ny * ny)));
  let lum = (nx * LX + ny * LY) * 0.75 + nz * 0.55;
  lum = clamp((lum + 0.35) / 1.35, 0, 0.9999);
  let f = lum * n;
  if (dither) f += bayer(x, y) - 0.5;
  return clamp(Math.floor(f), 0, n - 1);
}

/**
 * Tapered, cylinder-shaded capsule from (x0,y0) radius r0 to (x1,y1) radius r1 —
 * bones, arms, horns, roots, chains. `colors` is a ramp darkest -> lightest.
 */
export function limb(p: PixelPainter, x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, colors: readonly string[], dither = false): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  const rm = Math.max(r0, r1);
  const bx0 = Math.floor(Math.min(x0, x1) - rm - 1);
  const bx1 = Math.ceil(Math.max(x0, x1) + rm + 1);
  const by0 = Math.floor(Math.min(y0, y1) - rm - 1);
  const by1 = Math.ceil(Math.max(y0, y1) + rm + 1);
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let t = l2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / l2 : 0;
      t = clamp(t, 0, 1);
      const cx = x0 + dx * t;
      const cy = y0 + dy * t;
      const r = Math.max(0.5, r0 + (r1 - r0) * t);
      const ex = px - cx;
      const ey = py - cy;
      if (ex * ex + ey * ey > r * r) continue;
      p.px(x, y, colors[lumIndex(ex / r, ey / r, colors.length, x, y, dither)]);
    }
  }
}

/** Filled + sphere-shaded ellipse. */
export function ball(p: PixelPainter, cx: number, cy: number, rx: number, ry: number, colors: readonly string[], dither = true): void {
  p.ellipse(cx, cy, rx, ry, colors[Math.floor(colors.length / 2)]);
  p.shadeSphere(cx, cy, rx, ry, colors as string[], { dither });
}

/** Jagged crack: a polyline that wobbles deterministically between two points. */
export function crack(p: PixelPainter, x0: number, y0: number, x1: number, y1: number, color: string, seed = 1, jag = 1.2): void {
  const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 3));
  let px = x0;
  let py = y0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const h = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    const j = (h - Math.floor(h) - 0.5) * 2 * jag * (i < n ? 1 : 0);
    const nx = x0 + (x1 - x0) * t + j * -(y1 - y0) / Math.max(1, Math.hypot(x1 - x0, y1 - y0));
    const ny = y0 + (y1 - y0) * t + j * (x1 - x0) / Math.max(1, Math.hypot(x1 - x0, y1 - y0));
    p.line(px, py, nx, ny, color);
    px = nx;
    py = ny;
  }
}

/**
 * A painter that shifts everything it draws down by `dy` px (all primitives route
 * through px / get / pxIn) — lets a composition use negative y for overhangs.
 */
export class ShiftedPainter extends PixelPainter {
  readonly dy: number;
  constructor(w: number, h: number, dy: number) {
    super(w, h);
    this.dy = dy;
  }

  override px(x: number, y: number, c: string | null): void {
    super.px(x, y + this.dy, c);
  }

  override get(x: number, y: number): number {
    return super.get(Math.floor(x), Math.floor(y) + this.dy);
  }

  override pxIn(x: number, y: number, c: string): void {
    const xx = Math.floor(x);
    const yy = Math.floor(y) + this.dy;
    if (super.get(xx, yy) >>> 24) super.px(xx, yy, c);
  }
}

/** Paint only over already-set pixels inside a circle (glow spots on a shape). */
export function tintIn(p: PixelPainter, cx: number, cy: number, r: number, color: string): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) p.pxIn(x, y, color);
    }
  }
}

// ================================================================== bullets
/** Spinning bone shard (crypt bosses): bone white with a blood-red rim. */
export function boneShardSprite(): string {
  const name = 'k13_bone_shard';
  if (!hasSprite(name)) {
    defineDrawnSprite(name, 9, 5, (p) => {
      p.rect(2, 1, 5, 3, '#b8203a');
      p.circle(1.5, 1.5, 1.4, '#e8dcc0');
      p.circle(1.5, 3.5, 1.4, '#e8dcc0');
      p.circle(7.5, 1.5, 1.4, '#e8dcc0');
      p.circle(7.5, 3.5, 1.4, '#e8dcc0');
      p.rect(2, 2, 5, 1, '#fff8ea');
      p.px(1, 1, '#ffffff');
      p.px(7, 1, '#ffffff');
      p.px(2, 3, '#ff6a6a');
      p.px(6, 3, '#ff6a6a');
    }, { outline: '#2a040c' });
  }
  return name;
}

/** Projectile behavior: re-aim at the player the moment a delayed shot is released. */
export function aimOnRelease(speedJitter = 0): ProjBehavior {
  return {
    id: 'aim-on-release',
    update(p, w) {
      if (p.mem.aimed) return;
      p.mem.aimed = 1;
      p.angle = Math.atan2(w.player.y - 4 - p.y, w.player.x - p.x);
      if (speedJitter) p.speed *= 1 + (w.rng.next() - 0.5) * speedJitter;
      p.syncVel();
    },
  };
}

/** Expire every enemy projectile (phase changes clear the screen — fairness). */
export function clearEnemyShots(w: World): void {
  for (const e of w.entities) if (e instanceof Projectile && e.team === 'enemy' && !e.dead) e.expire(w, false);
}

// ================================================================== player hits
/** Hurt the player if (px,py) is within `r` of (x,y) on the ground. Returns true if damage applied. */
export function hitPlayerCircle(w: World, x: number, y: number, r: number, dmg: number, source: string, knock = 150): boolean {
  // every keeper in reach (co-op); single-player: the keeper
  let any = false;
  for (const p of w.targets()) {
    if (!p.alive || p.z > 8) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d > r + p.r * 0.6) continue;
    if (!p.hurt(w, dmg, source)) continue;
    const n = d || 1;
    p.knock((p.x - x) / n, (p.y - y) / n, knock);
    any = true;
  }
  return any;
}

/** Rectangular lane warning (bat-dive style) from (x,y) along `angle`. */
export function laneWarning(w: World, x: number, y: number, angle: number, length: number, width: number, time: number, color = WARN_RED): GroundWarning {
  const g = w.spawn(new GroundWarning(x, y, 6, time, undefined, color));
  g.rw = length;
  g.rh = width;
  g.angle = angle;
  return g;
}

/** Clamp a point into the room interior with a margin. */
export function inRoom(w: World, x: number, y: number, margin: number): { x: number; y: number } {
  const r = w.room;
  return {
    x: clamp(x, r.interiorX + margin, r.interiorX + r.interiorW - margin),
    y: clamp(y, r.interiorY + margin, r.interiorY + r.interiorH - margin),
  };
}

/** Is (x,y) inside the room interior (walls excluded)? */
export function insideRoom(w: World, x: number, y: number, margin = 0): boolean {
  const r = w.room;
  return x >= r.interiorX + margin && x <= r.interiorX + r.interiorW - margin && y >= r.interiorY + margin && y <= r.interiorY + r.interiorH - margin;
}

// ================================================================== shockwave
export interface ShockOpts {
  speed: number;
  maxR: number;
  color: string;
  /** gap centres (radians) and total gap width */
  gaps?: number[];
  gapWidth?: number;
  damage?: number;
  source: string;
  /** half thickness of the damaging band */
  thick?: number;
  /** debris colors kicked up by the wavefront */
  debris?: string[];
}

/**
 * Expanding ground ring. Hurts a grounded player once when the wavefront passes
 * over them — jump it with a dash, stand in a gap, or stay out of reach.
 */
export class Shockwave extends Entity {
  radius = 4;
  o: ShockOpts;
  hit = false;
  constructor(x: number, y: number, o: ShockOpts) {
    super();
    this.x = x;
    this.y = y;
    this.o = o;
    this.layer = 0;
    this.tileCollide = false;
    this.team = 'enemy';
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    this.radius += this.o.speed * dt;
    const o = this.o;
    const gaps = o.gaps ?? [];
    const gw = o.gapWidth ?? 0;
    // the wave stops hurting just before it fades out (never invisible + dangerous)
    for (const p of w.targets()) {
      if (!this.hit && p.alive && p.z < 4 && this.radius < o.maxR * 0.9) {
        const dx = p.x - this.x;
        const dy = p.y - this.y;
        const d = Math.hypot(dx, dy);
        const band = (o.thick ?? 4) + p.r * 0.5;
        if (Math.abs(d - this.radius) < band && !inGap(Math.atan2(dy, dx), gaps, gw)) {
          if (p.hurt(w, o.damage ?? 1, o.source)) {
            p.knock(dx / (d || 1), dy / (d || 1), 170);
            this.hit = true;
          }
        }
      }
    }
    // debris along the front
    const n = Math.min(6, Math.ceil(this.radius / 18));
    for (let i = 0; i < n; i++) {
      const a = fx.angle();
      if (inGap(a, gaps, gw) || !fx.chance(0.5)) continue;
      const x = this.x + Math.cos(a) * this.radius;
      const y = this.y + Math.sin(a) * this.radius;
      if (!insideRoom(w, x, y, 2)) continue;
      w.particles.spawn({
        x, y, vx: Math.cos(a) * 20, vy: Math.sin(a) * 20, vz: fx.range(20, 60), gravity: 300, life: fx.range(0.2, 0.4),
        colors: o.debris ?? ['#ffffff', o.color], size: fx.range(1, 2),
      });
    }
    if (this.radius >= o.maxR) this.dead = true;
  }

  override draw(r: Renderer): void {
    const o = this.o;
    const t = this.radius / o.maxR;
    // fully visible while dangerous, quick fade over the last 10% (harmless)
    const a = t < 0.9 ? 1 - t * 0.25 : Math.max(0, (1 - t) / 0.1) * 0.75;
    const c = r.ctx;
    const gaps = o.gaps ?? [];
    const gw = o.gapWidth ?? 0;
    // split the circle into arcs that skip the gaps
    const segs: [number, number][] = [];
    if (!gaps.length) segs.push([0, TAU]);
    else {
      const sorted = [...gaps].map((g) => ((g % TAU) + TAU) % TAU).sort((x, y) => x - y);
      for (let i = 0; i < sorted.length; i++) {
        const s = sorted[i] + gw / 2;
        let e = sorted[(i + 1) % sorted.length] - gw / 2;
        if (i === sorted.length - 1) e += TAU;
        if (e > s) segs.push([s, e]);
      }
    }
    const cx = Math.round(this.x - r.viewX) + 0.5;
    const cy = Math.round(this.y - r.viewY) + 0.5;
    c.save();
    for (const [s, e] of segs) {
      c.globalAlpha = 0.35 * a;
      c.strokeStyle = o.color;
      c.lineWidth = (o.thick ?? 4) * 2;
      c.beginPath();
      c.arc(cx, cy, Math.max(1, this.radius), s, e);
      c.stroke();
      c.globalAlpha = 0.95 * a;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(cx, cy, Math.max(1, this.radius), s, e);
      c.stroke();
      c.globalAlpha = 0.9 * a;
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1;
      c.beginPath();
      c.arc(cx, cy, Math.max(1, this.radius - 1), s, e);
      c.stroke();
    }
    c.restore();
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y, this.radius + 10, this.o.color.slice(0, 7), { intensity: 0.25 * (1 - this.radius / this.o.maxR) });
  }
}

// ================================================================== eruptions
export type EruptKind = 'bone' | 'root' | 'fire';

const ERUPT_COLORS: Record<EruptKind, { debris: string[]; light: string; sfx: 'spike' | 'fire' }> = {
  bone: { debris: ['#fff8ea', '#d8ccb0', '#8a7a64'], light: '#ff6050', sfx: 'spike' },
  root: { debris: ['#e8ffb0', '#6a8a3a', '#4a3424'], light: '#a0ff60', sfx: 'spike' },
  fire: { debris: ['#fff4b0', '#ffa424', '#d0400c'], light: '#ff7020', sfx: 'fire' },
};

function paintBoneSpike(p: PixelPainter, h: number): void {
  // jagged bone spike rising out of a cracked floor
  const base = 17;
  const top = base - h;
  p.poly([1, base, 4.5, top, 8, base], '#d8ccb0');
  p.poly([3, base, 4.5, top + 1, 5, base], '#fff8ea');
  p.poly([5.5, base, 7, base - h * 0.45, 8.5, base], '#b4a688');
  p.px(4, top + 1, '#ffffff');
  if (h > 8) {
    p.px(5, top + 5, '#8a7a64');
    p.px(3, top + 8, '#8a7a64');
  }
  p.rect(0, base - 1, 9, 2, '#5a4a40');
  p.px(2, base - 1, '#8a7a64');
  p.px(7, base - 1, '#8a7a64');
}

function paintRootSpike(p: PixelPainter, h: number): void {
  const base = 17;
  const top = base - h;
  limb(p, 4.5, base, 2.6, 5 + (h > 8 ? 1 : 0), top + 1, 0.6, ['#2a1c18', '#4a3424', '#6a4c30', '#8a6a40']);
  if (h > 6) {
    p.line(5, base - h * 0.4, 8, base - h * 0.6, '#4a3424');
    p.px(8, Math.round(base - h * 0.6), '#c8ff60');
    p.line(4, base - h * 0.65, 1, base - h * 0.8, '#4a3424');
    p.px(1, Math.round(base - h * 0.8), '#c8ff60');
  }
  p.px(5 + (h > 8 ? 1 : 0), top + 1, '#e8ffb0');
  p.ellipse(4.5, base, 4.5, 1.2, '#3a2a1e');
}

function paintFirePillar(p: PixelPainter, h: number, k: number): void {
  const base = 22;
  const top = base - h;
  const sway = [0, 1, 0, -1][k % 4];
  p.poly([1, base, 11, base, 9 + sway * 0.5, top + h * 0.4, 6 + sway, top, 3 + sway * 0.5, top + h * 0.45], '#d0400c');
  p.poly([3, base, 9, base, 8 + sway * 0.4, top + h * 0.5, 6 + sway * 0.8, top + 3, 4 + sway * 0.3, top + h * 0.55], '#ffa424');
  p.poly([4.5, base, 7.5, base, 7, top + h * 0.6, 6 + sway * 0.5, top + h * 0.3, 5, top + h * 0.65], '#fff4b0');
  p.ellipse(6, base, 6, 1.5, '#ffd060');
}

let eruptSpritesReady = false;
function ensureEruptSprites(): void {
  if (eruptSpritesReady) return;
  eruptSpritesReady = true;
  frames('k13erupt', 'bone', 3, 9, 18, (p, i) => paintBoneSpike(p, [6, 11, 16][i]), { anchor: 'bottom', outline: OUTLINE });
  frames('k13erupt', 'root', 3, 10, 18, (p, i) => paintRootSpike(p, [6, 11, 16][i]), { anchor: 'bottom', outline: OUTLINE });
  frames('k13erupt', 'fire', 4, 12, 23, (p, i) => paintFirePillar(p, 18 + (i % 2) * 3, i), { anchor: 'bottom', outline: '#3a0800', fps: 14 });
}

export interface EruptOpts {
  radius?: number;
  damage?: number;
  source: string;
  /** how long the spike / pillar stays up */
  linger?: number;
  onErupt?: (w: World, x: number, y: number) => void;
}

/** A single telegraphed floor eruption: warning circle, then a spike / fire pillar that hurts on the way up. */
export class Eruption extends Entity {
  kind: EruptKind;
  warn: number;
  o: EruptOpts;
  erupted = false;
  struck = false;
  constructor(x: number, y: number, kind: EruptKind, warn: number, o: EruptOpts) {
    super();
    ensureEruptSprites();
    this.x = x;
    this.y = y;
    this.kind = kind;
    this.warn = warn;
    this.o = o;
    this.layer = 0;
    this.tileCollide = false;
    this.team = 'enemy';
  }

  get radius(): number {
    return this.o.radius ?? 9;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const c = ERUPT_COLORS[this.kind];
    if (!this.erupted && this.age >= this.warn) {
      this.erupted = true;
      this.layer = 1;
      w.particles.burst(this.x, this.y, { count: 8, speed: [30, 90], life: [0.25, 0.5], colors: c.debris, size: [1, 2], gravity: 300, vz: [40, 110] });
      if (fx.chance(0.5)) w.sfx(c.sfx, { vol: 0.35, pitch: fx.range(0.9, 1.2) });
      this.o.onErupt?.(w, this.x, this.y);
    }
    if (this.erupted && !this.struck && this.age < this.warn + 0.16) {
      if (hitPlayerCircle(w, this.x, this.y, this.radius * 0.8, this.o.damage ?? 1, this.o.source)) this.struck = true;
    }
    if (this.erupted && this.kind === 'fire' && fx.chance(0.4)) {
      w.particles.spawn({
        x: this.x + fx.range(-3, 3), y: this.y - fx.range(4, 16), vy: -fx.range(20, 40), life: fx.range(0.2, 0.4),
        colors: ['#fff4b0', '#ffa424', '#d0400c'], size: 1, additive: true, light: 4,
      });
    }
    if (this.age >= this.warn + (this.o.linger ?? 0.4) + 0.18) this.dead = true;
  }

  override get sortY(): number {
    return this.y;
  }

  override draw(r: Renderer): void {
    if (!this.erupted) {
      const t = clamp(this.age / this.warn, 0, 1);
      const blink = 0.3 + 0.2 * Math.sin(this.age * 26);
      r.circle(this.x, this.y, this.radius, WARN_RED, blink * 0.55);
      r.circle(this.x, this.y, this.radius * ease.outCubic(t), WARN_RED, 0.3);
      r.ring(this.x, this.y, this.radius, WARN_RED, 1, 0.85);
      // rumbling cracks
      if (t > 0.4) {
        const k = (t - 0.4) / 0.6;
        r.line(this.x - 4 * k, this.y - 1, this.x + 3 * k, this.y + 1, '#1a0c0c', 1, 0.8);
      }
      return;
    }
    const el = this.age - this.warn;
    const linger = this.o.linger ?? 0.4;
    const n = this.kind === 'fire' ? 4 : 3;
    let f: number;
    if (this.kind === 'fire') f = Math.floor(el * 14) % 4;
    else if (el < 0.09) f = Math.min(2, Math.floor((el / 0.09) * 3));
    else if (el < linger) f = 2;
    else f = Math.max(0, 2 - Math.floor(((el - linger) / 0.18) * 3));
    const sink = el > linger ? clamp((el - linger) / 0.18, 0, 1) : 0;
    r.shadow(this.x, this.y, this.radius * 1.4, 4, 0.35);
    r.sprite(`k13erupt_${this.kind}_${Math.min(n - 1, f)}`, this.x, this.y + 1, {
      alpha: 1 - sink * 0.6,
      sy: this.kind === 'fire' ? 1 - sink : 1,
      additive: false,
    });
  }

  override light(w: World): void {
    const c = ERUPT_COLORS[this.kind];
    if (!this.erupted) {
      w.lights.add(this.x, this.y, this.radius * 1.6, '#ff3040', { intensity: 0.35 * clamp(this.age / this.warn, 0, 1) });
    } else w.lights.add(this.x, this.y - 6, this.kind === 'fire' ? 34 : 16, c.light, { intensity: 0.8 });
  }
}

/**
 * A line of eruptions from (x0,y0) along `angle`: `n` pillars `spacing` px apart,
 * each erupting `stagger` s after the previous one. Stops at the room walls.
 */
export function eruptLine(w: World, x0: number, y0: number, angle: number, n: number, spacing: number, warn: number, stagger: number, kind: EruptKind, o: EruptOpts): number {
  let made = 0;
  for (let i = 0; i < n; i++) {
    const x = x0 + Math.cos(angle) * spacing * i;
    const y = y0 + Math.sin(angle) * spacing * i;
    if (!insideRoom(w, x, y, 4)) break;
    w.spawn(new Eruption(x, y, kind, warn + stagger * i, o));
    made++;
  }
  return made;
}

// ================================================================== fallers
export interface FallerOpts {
  sprite: string;
  /** fall time (warning shown for the whole fall) */
  time?: number;
  height?: number;
  radius?: number;
  damage?: number;
  source: string;
  color: string;
  spin?: number;
  onLand?: (w: World, x: number, y: number) => void;
}

/** Debris dropping from the ceiling onto a warned spot. */
export class Faller extends Entity {
  o: FallerOpts;
  time: number;
  height: number;
  constructor(x: number, y: number, o: FallerOpts) {
    super();
    this.x = x;
    this.y = y;
    this.o = o;
    this.time = o.time ?? 1.0;
    this.height = o.height ?? 150;
    this.layer = 1;
    this.tileCollide = false;
    this.team = 'enemy';
  }

  override get sortY(): number {
    return this.y + 2;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const t = clamp(this.age / this.time, 0, 1);
    this.z = this.height * (1 - ease.inQuad(t));
    if (t >= 1 && !this.dead) {
      this.dead = true;
      const R = this.o.radius ?? 12;
      hitPlayerCircle(w, this.x, this.y, R, this.o.damage ?? 1, this.o.source);
      w.particles.burst(this.x, this.y - 2, { count: 12, speed: [30, 110], life: [0.25, 0.55], colors: ['#ffffff', this.o.color, this.o.color], size: [1, 3], gravity: 300, vz: [40, 120] });
      w.spawn(new RingFx(this.x, this.y, R + 4, 0.25, this.o.color, 2));
      w.sfx('rock_break', { vol: 0.4, pitch: fx.range(0.8, 1.1) });
      w.shake(0.12);
      this.o.onLand?.(w, this.x, this.y);
    }
  }

  override draw(r: Renderer): void {
    const t = clamp(this.age / this.time, 0, 1);
    const R = this.o.radius ?? 12;
    // warning on the floor
    const blink = 0.3 + 0.2 * Math.sin(this.age * 24);
    r.circle(this.x, this.y, R, WARN_RED, blink * 0.5);
    r.ring(this.x, this.y, R, WARN_RED, 1, 0.85);
    r.shadow(this.x, this.y, R * (0.5 + t * 1.1), R * (0.25 + t * 0.45), 0.25 + t * 0.3);
    r.sprite(this.o.sprite, this.x, this.y - this.z - 3, { rot: this.age * (this.o.spin ?? 0) });
  }
}

/** Drop a faller (helper with ground warning built in). */
export function dropFaller(w: World, x: number, y: number, o: FallerOpts): Faller {
  return w.spawn(new Faller(x, y, o));
}

// ================================================================== bosses: phases & minions
export interface PhaseShiftOpts {
  /** roar / phase animation while the moment plays */
  anim?: string;
  /** flash + ring color */
  color: string;
  /** seconds the boss holds the pose (default 1.3) */
  time?: number;
  /** called at the peak (e.g. summon, swap sprites) */
  onPeak?: () => void;
}

/**
 * The phase-change moment: the boss stops, the screen clears of enemy bullets,
 * roar + shake + flash + shock rings. `e.phase` is incremented.
 */
export function* phaseShift(e: Enemy, w: World, o: PhaseShiftOpts): Script {
  e.halt();
  e.phase++;
  clearEnemyShots(w);
  if (o.anim) e.setAnim(o.anim, true);
  e.telegraph(0.45);
  w.sfx('enemy_roar', { vol: 0.7, pitch: 0.55 });
  yield 0.45;
  w.sfx('boss_phase');
  w.shake(0.9);
  w.hitstop(0.08);
  w.renderer?.screenFlash(o.color, 0.4);
  for (let i = 0; i < 3; i++) w.spawn(new RingFx(e.x, e.y - 6, 40 + i * 26, 0.35 + i * 0.12, i % 2 ? o.color : '#ffffff', 3 - i));
  w.particles.burst(e.x, e.y - 10, { count: 30, speed: [60, 200], life: [0.3, 0.7], colors: ['#ffffff', o.color, o.color], size: [1, 3], shape: 'spark' });
  o.onPeak?.();
  yield (o.time ?? 1.3) - 0.45;
}

/** Summon a minion owned by `e` with a little spawn burst. */
export function summonMinion(e: Enemy, w: World, id: string, x: number, y: number, colors: string[]): Enemy | null {
  // a summon telegraphed before the boss fell must not appear afterwards
  if (e.dead || e.hp <= 0) return null;
  const m = e.summon(w, id, x, y);
  if (!m) return null;
  m.mem.owner = e;
  m.mem.bossMinion = 1;
  w.particles.burst(m.x, m.y, { count: 10, speed: [30, 80], life: [0.25, 0.5], colors, size: [1, 2], gravity: 250, vz: [20, 80] });
  w.spawn(new RingFx(m.x, m.y, 14, 0.25, colors[0], 1));
  return m;
}

/** Living minions owned by `owner`. */
export function minionCount(w: World, owner: Enemy): number {
  let n = 0;
  for (const o of w.enemies) if (o.alive && o.mem.owner === owner) n++;
  return n;
}

/** When the boss falls, its minions crumble too (no drops, no split-on-death). */
export function dissolveMinions(w: World, owner: Enemy): void {
  for (const o of w.enemies) {
    if (o === owner || !o.alive || o.mem.owner !== owner) continue;
    o.dead = true;
    o.hp = 0;
    const col = o.def.bloodColor ?? '#c0c0c0';
    w.particles.burst(o.x, o.y - 3, { count: 14, speed: [30, 110], life: [0.3, 0.7], colors: ['#ffffff', col, col], size: [1, 2], gravity: 260, vz: [30, 100] });
    w.spawn(new RingFx(o.x, o.y, o.r * 2 + 6, 0.3, col, 1));
  }
}

/**
 * The boss fell: every pending attack goes with it — enemy bullets pop, warnings,
 * eruptions, shockwaves, lobs, fallers and hazards vanish (no posthumous hits).
 */
export function clearArena(w: World): void {
  for (const x of w.entities) {
    if (x.dead) continue;
    if (x instanceof Projectile) {
      if (x.team === 'enemy') x.expire(w, false);
    } else if (x instanceof GroundWarning || x instanceof Eruption || x instanceof Faller || x instanceof Shockwave || x instanceof Lob || x instanceof Hazard) {
      x.dead = true;
    }
  }
}

/** Turn to face the target (for flipped sprites). */
export function faceTarget(e: Enemy, w: World): void {
  const t = e.target(w);
  e.facing = t.x >= e.x ? 1 : -1;
}

/** Ring of shots with gaps, fired from the enemy. */
export function shootGapRing(e: Enemy, w: World, count: number, offset: number, gaps: number[], gapWidth: number, o: Parameters<Enemy['shoot']>[2]): Projectile[] {
  const out: Projectile[] = [];
  for (const a of gapRing(count, offset, gaps, gapWidth)) out.push(e.shoot(w, a, o));
  w.sfx('enemy_shoot', { vol: 0.5, pitch: 0.8 });
  return out;
}

/** Big extra death burst for bosses (on top of the world's boss death effects). */
export function bossDeathBurst(w: World, x: number, y: number, colors: string[], parts = 26): void {
  w.particles.burst(x, y - 10, { count: parts, speed: [60, 220], life: [0.5, 1.2], colors, size: [2, 4], gravity: 320, vz: [60, 180], bounce: 0.35, shape: 'square', vrot: 8 });
  w.particles.burst(x, y - 10, { count: 20, speed: [20, 70], life: [0.8, 1.6], colors: ['#706068', '#504448', '#302830'], size: [3, 6], sizeEnd: 9, drag: 3, fade: true });
}
