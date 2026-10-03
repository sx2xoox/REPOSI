// Shared toolkit for the floor 4–5 bosses (빙결 성녀, 서리 기사단장, 무명):
//  - pure helpers (phase thresholds, gapped rings, pattern picking, sector / beam
//    hit tests, ray-to-room-edge, spirals) — unit-tested in tests/bosses45.test.ts
//  - telegraphed hazards: Spike (ice crystal / void tendril eruptions), ShockRing
//    (expanding ground ring with gaps), Sector (fan-shaped wind-up + slash), Beam
//    (aim line -> lock flash -> laser), Icicle (falls from the ceiling onto a warned spot)
//  - script helpers: the phase-change moment, minion bookkeeping, bullet clearing
// Only lazily-compiled sprites are defined here, so the module is safe in node tests.

import { Entity } from '../../game/entity';
import type { World } from '../../game/world';
import type { Enemy } from '../../game/enemy';
import type { Renderer } from '../../engine/renderer';
import type { RNG } from '../../engine/rng';
import type { Script } from '../../engine/script';
import type { PixelPainter } from '../../engine/painter';
import { bayer } from '../../engine/painter';
import { Projectile } from '../../game/projectile';
import { RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { angleDiff, clamp, distToSegment, ease, TAU } from '../../engine/math';
import { defineAnim, defineDrawnSprite, hasSprite } from '../../engine/sprites';
import { OUTLINE, WARN_RED } from '../enemies/shared';

export { OUTLINE, WARN_RED };

// ================================================================== pure helpers
/** Phase index for an HP fraction: one extra phase per threshold reached (thresholds descending). */
export function phaseFor(frac: number, thresholds: readonly number[]): number {
  let ph = 0;
  for (const t of thresholds) if (frac <= t) ph++;
  return ph;
}

/** Is angle `a` inside one of the gaps (centres `gaps`, total width `gapWidth`)? */
export function inGap(a: number, gaps: readonly number[], gapWidth: number): boolean {
  return gaps.some((g) => Math.abs(angleDiff(a, g)) < gapWidth / 2);
}

/** Angles of an evenly spaced ring of `count` shots with every shot inside a gap removed. */
export function gapRing(count: number, offset: number, gaps: readonly number[], gapWidth: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = offset + (i / count) * TAU;
    if (!inGap(a, gaps, gapWidth)) out.push(a);
  }
  return out;
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

/** Is (px, py) inside the circular sector at (cx, cy) facing `angle` (± `half`), between `inner` and `radius`? */
export function inSector(px: number, py: number, cx: number, cy: number, angle: number, half: number, radius: number, inner = 0): boolean {
  const d = Math.hypot(px - cx, py - cy);
  if (d > radius || d < inner) return false;
  if (d < 1e-6) return true;
  return Math.abs(angleDiff(angle, Math.atan2(py - cy, px - cx))) <= half;
}

/** Does a circle (px, py, pr) touch a beam from (x0, y0) along `angle` of length `len` and half width `halfW`? */
export function onBeam(px: number, py: number, pr: number, x0: number, y0: number, angle: number, len: number, halfW: number): boolean {
  const x1 = x0 + Math.cos(angle) * len;
  const y1 = y0 + Math.sin(angle) * len;
  return distToSegment(px, py, x0, y0, x1, y1) < halfW + pr;
}

/**
 * Distance from (x, y) along `angle` to the border of the rectangle (rx, ry, rw, rh).
 * The point is assumed inside; returns 0 if it is not.
 */
export function rayToRect(x: number, y: number, angle: number, rx: number, ry: number, rw: number, rh: number): number {
  if (x < rx || y < ry || x > rx + rw || y > ry + rh) return 0;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let t = Infinity;
  if (c > 1e-9) t = Math.min(t, (rx + rw - x) / c);
  else if (c < -1e-9) t = Math.min(t, (rx - x) / c);
  if (s > 1e-9) t = Math.min(t, (ry + rh - y) / s);
  else if (s < -1e-9) t = Math.min(t, (ry - y) / s);
  return isFinite(t) ? Math.max(0, t) : 0;
}

/** Angles of an `arms`-armed spiral at step `k` (each step turns by `turn` radians). */
export function spiralAngles(base: number, arms: number, k: number, turn: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < arms; i++) out.push(base + k * turn + (i / arms) * TAU);
  return out;
}

/** `n` points evenly spaced on a circle. */
export function ringSpots(cx: number, cy: number, r: number, n: number, offset = 0): { x: number; y: number; a: number }[] {
  const out: { x: number; y: number; a: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = offset + (i / n) * TAU;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, a });
  }
  return out;
}

/** Linear blend of two "#rrggbb" colors (t = 0 -> a). */
export function blendHex(a: string, b: string, t: number): string {
  const k = clamp(t, 0, 1);
  const pa = parseInt(a.slice(1, 7), 16);
  const pb = parseInt(b.slice(1, 7), 16);
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - k) + ((pb >> sh) & 255) * k);
  return `#${[ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// ================================================================== art helpers
const LX = -0.55;
const LY = -0.65;

/** Ramp index for a surface normal (lit from the top-left), optionally dithered. */
export function lum(nx: number, ny: number, n: number, x: number, y: number, dither = true, bias = 0): number {
  const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, nx * nx + ny * ny)));
  let l = (nx * LX + ny * LY) * 0.75 + nz * 0.55 + bias;
  l = clamp((l + 0.35) / 1.35, 0, 0.9999);
  let f = l * n;
  if (dither) f += bayer(x, y) - 0.5;
  return clamp(Math.floor(f), 0, n - 1);
}

/** Tapered, cylinder-shaded capsule (arms, horns, tendrils). `colors` darkest -> lightest. */
export function limb(p: PixelPainter, x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, colors: readonly string[], dither = false): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  const rm = Math.max(r0, r1);
  for (let y = Math.floor(Math.min(y0, y1) - rm - 1); y <= Math.ceil(Math.max(y0, y1) + rm + 1); y++) {
    for (let x = Math.floor(Math.min(x0, x1) - rm - 1); x <= Math.ceil(Math.max(x0, x1) + rm + 1); x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const t = l2 > 0 ? clamp(((px - x0) * dx + (py - y0) * dy) / l2, 0, 1) : 0;
      const cx = x0 + dx * t;
      const cy = y0 + dy * t;
      const r = Math.max(0.5, r0 + (r1 - r0) * t);
      const ex = px - cx;
      const ey = py - cy;
      if (ex * ex + ey * ey > r * r) continue;
      p.px(x, y, colors[lum(ex / r, ey / r, colors.length, x, y, dither)]);
    }
  }
}

/** Filled + sphere-shaded ellipse. */
export function ball(p: PixelPainter, cx: number, cy: number, rx: number, ry: number, colors: readonly string[], dither = true): void {
  p.ellipse(cx, cy, rx, ry, colors[Math.floor(colors.length / 2)]);
  p.shadeSphere(cx, cy, rx, ry, colors as string[], { dither });
}

/** Deterministic jagged crack between two points. */
export function crack(p: PixelPainter, x0: number, y0: number, x1: number, y1: number, color: string, seed = 1, jag = 1.2): void {
  const len = Math.max(1, Math.hypot(x1 - x0, y1 - y0));
  const n = Math.max(2, Math.round(len / 3));
  let px = x0;
  let py = y0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const h = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    const j = (h - Math.floor(h) - 0.5) * 2 * jag * (i < n ? 1 : 0);
    const nx = x0 + (x1 - x0) * t - (j * (y1 - y0)) / len;
    const ny = y0 + (y1 - y0) * t + (j * (x1 - x0)) / len;
    p.line(px, py, nx, ny, color);
    px = nx;
    py = ny;
  }
}

/** Repaint already-set pixels within a circle. */
export function tintIn(p: PixelPainter, cx: number, cy: number, r: number, color: string): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) p.pxIn(x, y, color);
    }
  }
}

/** Deterministic 0..1 hash of two ints. */
export function hash2(x: number, y: number, seed = 0): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

// ================================================================== world helpers
/** Hurt the grounded player if within `r` of (x, y). Returns true if damage was applied. */
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

/** Expire every enemy projectile (phase changes clear the screen — fairness). */
export function clearEnemyShots(w: World): void {
  for (const e of w.entities ?? []) if (e instanceof Projectile && e.team === 'enemy' && !e.dead) e.expire(w, false);
  for (const e of w.projectiles) if (e.team === 'enemy' && !e.dead) e.expire(w, false);
}

/** Clamp a point into the room interior with a margin. */
export function inRoom(w: World, x: number, y: number, margin: number): { x: number; y: number } {
  const r = w.room;
  return {
    x: clamp(x, r.interiorX + margin, r.interiorX + r.interiorW - margin),
    y: clamp(y, r.interiorY + margin, r.interiorY + r.interiorH - margin),
  };
}

/** Is (x, y) inside the room interior (walls excluded)? */
export function insideRoom(w: World, x: number, y: number, margin = 0): boolean {
  const r = w.room;
  return x >= r.interiorX + margin && x <= r.interiorX + r.interiorW - margin && y >= r.interiorY + margin && y <= r.interiorY + r.interiorH - margin;
}

/** Length from (x, y) along `angle` to the room interior edge. */
export function beamToWall(w: World, x: number, y: number, angle: number): number {
  const r = w.room;
  return rayToRect(x, y, angle, r.interiorX, r.interiorY, r.interiorW, r.interiorH);
}

/** Turn to face the target (for flipped sprites). */
export function faceTarget(e: Enemy, w: World): void {
  const t = e.target(w);
  e.facing = t.x >= e.x ? 1 : -1;
}

/** Summon a minion owned by `e` with a little spawn burst. */
export function summonMinion(e: Enemy, w: World, id: string, x: number, y: number, colors: string[]): Enemy | null {
  const m = e.summon(w, id, x, y);
  if (!m) return null;
  m.mem.owner = e;
  m.mem.bossMinion = 1;
  w.particles.burst(m.x, m.y, { count: 12, speed: [30, 90], life: [0.25, 0.5], colors, size: [1, 2], gravity: 250, vz: [20, 80] });
  w.spawn(new RingFx(m.x, m.y, 16, 0.3, colors[0], 1));
  return m;
}

/** Living minions owned by `owner` (optionally of one enemy id). */
export function minionCount(w: World, owner: Enemy, id?: string): number {
  let n = 0;
  for (const o of w.enemies) if (o.alive && o.mem.owner === owner && (!id || o.def.id === id)) n++;
  return n;
}

/** When the boss falls, its minions crumble too (no drops). */
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

export interface PhaseShiftOpts {
  /** animation held while the moment plays */
  anim?: string;
  color: string;
  /** seconds the boss holds the pose (default 1.4) */
  time?: number;
  onPeak?: () => void;
}

/**
 * Phase-change moment: the boss stops and becomes briefly invulnerable, the screen
 * clears of enemy bullets, then roar + shake + flash + shock rings. `e.phase` += 1.
 */
export function* phaseShift(e: Enemy, w: World, o: PhaseShiftOpts): Script {
  e.halt();
  e.phase++;
  e.vulnerable = false;
  clearEnemyShots(w);
  if (o.anim) e.setAnim(o.anim, true);
  e.telegraph(0.5);
  w.sfx('enemy_roar', { vol: 0.7, pitch: 0.55 });
  yield 0.5;
  w.sfx('boss_phase');
  w.shake(0.9);
  w.hitstop(0.08);
  w.renderer?.screenFlash(o.color, 0.4);
  for (let i = 0; i < 3; i++) w.spawn(new RingFx(e.x, e.y - 8, 40 + i * 26, 0.35 + i * 0.12, i % 2 ? o.color : '#ffffff', 3 - i));
  w.particles.burst(e.x, e.y - 12, { count: 30, speed: [60, 200], life: [0.3, 0.7], colors: ['#ffffff', o.color, o.color], size: [1, 3], shape: 'spark' });
  o.onPeak?.();
  yield Math.max(0.1, (o.time ?? 1.4) - 0.5);
  e.vulnerable = true;
}

/**
 * Interrupt the running boss script for a phase change the moment HP crosses
 * `threshold` (call from `EnemyDef.update`). `run` builds the replacement script
 * (transition + the new pattern loop). Returns true when it switched.
 */
export function phaseGate(e: Enemy, threshold: number, phase: number, run: () => Script): boolean {
  if (e.phase >= phase || e.mem.__shifting || !e.alive || e.hp > e.maxHp * threshold) return false;
  e.mem.__shifting = 1;
  e.script.set(run());
  return true;
}

/** Mark the end of a phase transition started by `phaseGate`. */
export function phaseDone(e: Enemy): void {
  e.mem.__shifting = 0;
}

/** Big extra debris burst for boss deaths. */
export function bossDeathBurst(w: World, x: number, y: number, colors: string[], parts = 28): void {
  w.particles.burst(x, y - 10, { count: parts, speed: [60, 220], life: [0.5, 1.2], colors, size: [2, 4], gravity: 320, vz: [60, 180], bounce: 0.35, shape: 'square', vrot: 8 });
  w.particles.burst(x, y - 10, { count: 18, speed: [20, 70], life: [0.8, 1.6], colors: ['#706878', '#504858', '#302838'], size: [3, 6], sizeEnd: 9, drag: 3, fade: true });
}

// ================================================================== spikes (ice crystal / void tendril)
export type SpikeKind = 'ice' | 'void';

const SPIKE_COL: Record<SpikeKind, { debris: string[]; light: string; warn: string }> = {
  ice: { debris: ['#ffffff', '#c4f0ff', '#6aa8e8'], light: '#8cf2ff', warn: WARN_RED },
  void: { debris: ['#ffe6f4', '#ff4fae', '#5a1a9a'], light: '#ff4fae', warn: WARN_RED },
};

function paintIceSpike(p: PixelPainter, h: number): void {
  const base = 21;
  const top = base - h;
  // main crystal + two side shards; lit facet left, dark facet right
  p.poly([2, base, 6.5, top, 11, base], '#4a86d0');
  p.poly([3.5, base, 6.5, top + 1, 6.5, base], '#c4f0ff');
  p.poly([6.5, top + 1, 9.5, base, 6.5, base], '#2a5aa8');
  p.line(6, top + 2, 6, base - 2, '#ffffff');
  if (h > 8) {
    p.poly([0, base, 2, base - h * 0.45, 4.5, base], '#6aa8e8');
    p.poly([0.5, base, 2, base - h * 0.45 + 1, 2.2, base], '#e8faff');
    p.poly([9, base, 11.5, base - h * 0.55, 13, base], '#2a5aa8');
    p.poly([10.5, base, 11.5, base - h * 0.55 + 1, 11.8, base], '#8cc8f8');
  }
  p.px(6, top + 1, '#ffffff');
  p.rect(1, base - 1, 11, 1, '#1a3a78');
}

function paintVoidSpike(p: PixelPainter, h: number, k: number): void {
  const base = 21;
  const sway = [0, 1, 0, -1][k % 4] * (h / 18);
  // a curling tendril rising out of a rift
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const x0 = 6.5 + Math.sin(t0 * 3 + k) * sway * 2;
    const x1 = 6.5 + Math.sin(t1 * 3 + k) * sway * 2;
    limb(p, x0, base - h * t0, 3.2 * (1 - t0) + 0.6, x1, base - h * t1, 3.2 * (1 - t1) + 0.4, ['#1e0a30', '#3e1660', '#6a2a94', '#a050c8']);
  }
  // hooked thorn tip + pink suckers
  const tx = 6.5 + Math.sin(3 + k) * sway * 2;
  p.px(tx, base - h, '#ff4fae');
  p.px(tx + 1, base - h + 1, '#ffe6f4');
  for (let i = 1; i < 4; i++) p.px(6.5 + Math.sin((i / 4) * 3 + k) * sway * 2 + 1, base - h * (i / 4), '#ff4fae');
  p.ellipse(6.5, base, 6, 1.6, '#08020f');
  p.px(3, base - 1, '#ff4fae');
  p.px(10, base, '#a0105e');
}

let spikeArtReady = false;
function ensureSpikeArt(): void {
  if (spikeArtReady) return;
  spikeArtReady = true;
  const ice: string[] = [];
  [6, 12, 18].forEach((h, i) => ice.push(defineDrawnSprite(`b45spike_ice_${i}`, 13, 22, (p) => paintIceSpike(p, h), { anchor: 'bottom', outline: '#06102a' })));
  defineAnim('b45spike_ice', ice, 1, false);
  const vd: string[] = [];
  for (let i = 0; i < 4; i++) vd.push(defineDrawnSprite(`b45spike_void_${i}`, 13, 22, (p) => paintVoidSpike(p, i < 2 ? 9 + i * 5 : 18, i), { anchor: 'bottom', outline: '#08020f' }));
  defineAnim('b45spike_void', vd, 12, true);
}

export interface SpikeOpts {
  radius?: number;
  damage?: number;
  source: string;
  /** how long it stays up after erupting */
  linger?: number;
}

/** A single telegraphed floor eruption: warning circle, then a spike that hurts on the way up. */
export class Spike extends Entity {
  kind: SpikeKind;
  warn: number;
  o: SpikeOpts;
  erupted = false;
  struck = false;
  constructor(x: number, y: number, kind: SpikeKind, warn: number, o: SpikeOpts) {
    super();
    ensureSpikeArt();
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
    const c = SPIKE_COL[this.kind];
    if (!this.erupted && this.age >= this.warn) {
      this.erupted = true;
      this.layer = 1;
      w.particles.burst(this.x, this.y, { count: 8, speed: [30, 90], life: [0.25, 0.5], colors: c.debris, size: [1, 2], gravity: 300, vz: [40, 110] });
      if (fx.chance(0.45)) w.sfx(this.kind === 'ice' ? 'freeze' : 'spike', { vol: 0.3, pitch: fx.range(1.0, 1.3) });
    }
    if (this.erupted && !this.struck && this.age < this.warn + 0.16) {
      if (hitPlayerCircle(w, this.x, this.y, this.radius * 0.8, this.o.damage ?? 1, this.o.source)) this.struck = true;
    }
    if (this.age >= this.warn + (this.o.linger ?? 0.45) + 0.2) this.dead = true;
  }

  override get sortY(): number {
    return this.y;
  }

  override draw(r: Renderer): void {
    if (!this.erupted) {
      const t = clamp(this.age / this.warn, 0, 1);
      const blink = 0.3 + 0.2 * Math.sin(this.age * 26);
      const col = SPIKE_COL[this.kind].warn;
      r.circle(this.x, this.y, this.radius, col, blink * 0.5);
      r.circle(this.x, this.y, this.radius * ease.outCubic(t), col, 0.3);
      r.ring(this.x, this.y, this.radius, col, 1, 0.85);
      return;
    }
    const el = this.age - this.warn;
    const linger = this.o.linger ?? 0.45;
    const sink = el > linger ? clamp((el - linger) / 0.2, 0, 1) : 0;
    r.shadow(this.x, this.y, this.radius * 1.5, 4, 0.35);
    if (this.kind === 'ice') {
      const f = el < 0.1 ? Math.min(2, Math.floor((el / 0.1) * 3)) : sink > 0 ? Math.max(0, 2 - Math.floor(sink * 3)) : 2;
      r.sprite(`b45spike_ice_${f}`, this.x, this.y + 1, { alpha: 1 - sink * 0.5 });
    } else {
      const f = el < 0.1 ? Math.min(1, Math.floor((el / 0.1) * 2)) : 2 + (Math.floor(el * 10) % 2);
      r.sprite(`b45spike_void_${f}`, this.x, this.y + 1, { alpha: 1 - sink * 0.6, sy: 1 - sink * 0.7 });
    }
  }

  override light(w: World): void {
    const c = SPIKE_COL[this.kind];
    if (!this.erupted) w.lights.add(this.x, this.y, this.radius * 1.6, '#ff3040', { intensity: 0.35 * clamp(this.age / this.warn, 0, 1) });
    else w.lights.add(this.x, this.y - 6, 20, c.light, { intensity: 0.7 });
  }
}

/** A line of spikes from (x0, y0) along `angle`, each erupting `stagger` s after the previous. Stops at walls. */
export function spikeLine(w: World, x0: number, y0: number, angle: number, n: number, spacing: number, warn: number, stagger: number, kind: SpikeKind, o: SpikeOpts): number {
  let made = 0;
  for (let i = 0; i < n; i++) {
    const x = x0 + Math.cos(angle) * spacing * i;
    const y = y0 + Math.sin(angle) * spacing * i;
    if (!insideRoom(w, x, y, 4)) break;
    w.spawn(new Spike(x, y, kind, warn + stagger * i, o));
    made++;
  }
  return made;
}

// ================================================================== shock ring
export interface ShockOpts {
  speed: number;
  maxR: number;
  color: string;
  gaps?: number[];
  gapWidth?: number;
  damage?: number;
  source: string;
  thick?: number;
  debris?: string[];
}

/** Expanding ground ring with gaps: hurts a grounded player once when the front passes. */
export class ShockRing extends Entity {
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
    for (const p of w.targets()) {
      if (!this.hit && p.alive && p.z < 4 && this.radius < o.maxR * 0.9) {
        const dx = p.x - this.x;
        const dy = p.y - this.y;
        const d = Math.hypot(dx, dy);
        if (Math.abs(d - this.radius) < (o.thick ?? 4) + p.r * 0.5 && !inGap(Math.atan2(dy, dx), gaps, gw)) {
          if (p.hurt(w, o.damage ?? 1, o.source)) {
            p.knock(dx / (d || 1), dy / (d || 1), 170);
            this.hit = true;
          }
        }
      }
    }
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
    const a = t < 0.9 ? 1 - t * 0.25 : Math.max(0, (1 - t) / 0.1) * 0.75;
    const gaps = o.gaps ?? [];
    const gw = o.gapWidth ?? 0;
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
    const c = r.ctx;
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

// ================================================================== sector (fan) attack
export interface SectorOpts {
  radius: number;
  half: number;
  warn: number;
  inner?: number;
  damage?: number;
  source: string;
  color?: string;
  /** slash smear color when it strikes */
  slash?: string;
  /** swing direction of the smear (+1 clockwise) */
  dir?: number;
  onStrike?: (w: World) => void;
}

/** Fan-shaped telegraph that fills up, then strikes the whole sector at once. */
export class Sector extends Entity {
  angle: number;
  o: SectorOpts;
  struck = false;
  constructor(x: number, y: number, angle: number, o: SectorOpts) {
    super();
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.o = o;
    this.layer = 0;
    this.tileCollide = false;
    this.team = 'enemy';
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const o = this.o;
    if (!this.struck && this.age >= o.warn) {
      this.struck = true;
      for (const p of w.targets()) {
        if (p.alive && p.z < 8 && inSector(p.x, p.y, this.x, this.y, this.angle, o.half + 0.08, o.radius + p.r * 0.6, o.inner ?? 0)) {
          const d = Math.hypot(p.x - this.x, p.y - this.y) || 1;
          if (p.hurt(w, o.damage ?? 1, o.source)) p.knock((p.x - this.x) / d, (p.y - this.y) / d, 200);
        }
      }
      o.onStrike?.(w);
    }
    if (this.age >= o.warn + 0.24) this.dead = true;
  }

  override draw(r: Renderer): void {
    const o = this.o;
    const c = r.ctx;
    const cx = this.x - r.viewX;
    const cy = this.y - r.viewY;
    c.save();
    if (!this.struck) {
      const t = clamp(this.age / o.warn, 0, 1);
      const col = o.color ?? WARN_RED;
      const blink = 0.22 + 0.16 * Math.sin(this.age * 25);
      c.fillStyle = col;
      c.globalAlpha = blink;
      c.beginPath();
      c.moveTo(cx, cy);
      c.arc(cx, cy, o.radius, this.angle - o.half, this.angle + o.half);
      c.closePath();
      c.fill();
      c.globalAlpha = 0.35;
      c.beginPath();
      c.moveTo(cx, cy);
      c.arc(cx, cy, Math.max(1, o.radius * ease.outCubic(t)), this.angle - o.half, this.angle + o.half);
      c.closePath();
      c.fill();
      c.globalAlpha = 0.85;
      c.strokeStyle = col;
      c.lineWidth = 1;
      c.beginPath();
      c.arc(cx, cy, o.radius, this.angle - o.half, this.angle + o.half);
      c.stroke();
    } else {
      // slash smear sweeping across the sector
      const k = clamp((this.age - o.warn) / 0.24, 0, 1);
      const dir = o.dir ?? 1;
      const a0 = this.angle - o.half * dir;
      const a1 = a0 + o.half * 2 * dir * ease.outCubic(Math.min(1, k * 2.2));
      c.globalAlpha = (1 - k) * 0.9;
      c.strokeStyle = o.slash ?? '#e8faff';
      for (let i = 0; i < 3; i++) {
        c.lineWidth = 5 - i * 1.5;
        c.globalAlpha = (1 - k) * (0.4 + i * 0.25);
        c.strokeStyle = i === 2 ? '#ffffff' : o.slash ?? '#8cf2ff';
        c.beginPath();
        c.arc(cx, cy, o.radius * (0.62 + i * 0.12), Math.min(a0, a1), Math.max(a0, a1));
        c.stroke();
      }
    }
    c.restore();
  }
}

// ================================================================== beam
export interface BeamOpts {
  /** aim phase (tracking, thin warning line) */
  aim: number;
  /** lock phase (bright flashing line, no more tracking) */
  lock: number;
  /** active (damaging) phase */
  fire: number;
  width: number;
  color: string;
  core?: string;
  damage?: number;
  source: string;
  /** called every frame of the aim phase (track), and of the fire phase if `sweep` is set */
  track?: (b: Beam, w: World, dt: number) => void;
  /** angular velocity while firing (rad/s) */
  sweep?: number;
  /** keep the origin glued to something (eye, hand ...) */
  follow?: (b: Beam, w: World) => void;
  /** fixed length (default: to the room wall) */
  length?: number;
  /** allow more than one hit per beam (cooldown s); default single hit */
  rehit?: number;
}

/** Telegraphed laser: aim line that tracks, lock flash, then a damaging beam. */
export class Beam extends Entity {
  angle: number;
  o: BeamOpts;
  len = 0;
  private hitT = -1;
  private hits = 0;
  constructor(x: number, y: number, angle: number, o: BeamOpts) {
    super();
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.o = o;
    this.layer = 2;
    this.tileCollide = false;
    this.team = 'enemy';
  }

  get state(): 'aim' | 'lock' | 'fire' | 'fade' {
    const o = this.o;
    if (this.age < o.aim) return 'aim';
    if (this.age < o.aim + o.lock) return 'lock';
    if (this.age < o.aim + o.lock + o.fire) return 'fire';
    return 'fade';
  }

  override update(w: World, dt: number): void {
    const prev = this.state;
    this.age += dt;
    const o = this.o;
    o.follow?.(this, w);
    const st = this.state;
    if (st === 'aim') o.track?.(this, w, dt);
    if (st === 'fire' && o.sweep) this.angle += o.sweep * dt;
    this.len = o.length ?? beamToWall(w, this.x, this.y, this.angle);
    if (st === 'lock' && prev === 'aim') w.sfx('beam_charge', { vol: 0.45, pitch: 1.3 });
    if (st === 'fire' && prev !== 'fire') {
      w.sfx('laser', { vol: 0.8, pitch: 0.8 });
      w.shake(0.25);
    }
    if (st === 'fire') {
      const canHit = o.rehit ? w.time - this.hitT >= o.rehit : this.hits === 0;
      for (const p of w.targets()) {
        if (canHit && p.alive && p.z < 12 && onBeam(p.x, p.y - 4, p.r * 0.7, this.x, this.y, this.angle, this.len, o.width / 2)) {
          if (p.hurt(w, o.damage ?? 1, o.source)) {
            this.hits++;
            this.hitT = w.time;
            const nx = -Math.sin(this.angle);
            const ny = Math.cos(this.angle);
            const side = (p.x - this.x) * nx + (p.y - this.y) * ny >= 0 ? 1 : -1;
            p.knock(nx * side, ny * side, 180);
          }
        }
      }
      // sparks where the beam meets the wall
      if (fx.chance(0.6)) {
        const ex = this.x + Math.cos(this.angle) * this.len;
        const ey = this.y + Math.sin(this.angle) * this.len;
        w.particles.burst(ex, ey, { count: 2, speed: [30, 90], life: [0.15, 0.3], colors: ['#ffffff', o.color], size: [1, 2], additive: true });
      }
    }
    if (this.age >= o.aim + o.lock + o.fire + 0.18) this.dead = true;
  }

  override draw(r: Renderer): void {
    const o = this.o;
    const st = this.state;
    const x1 = this.x + Math.cos(this.angle) * this.len;
    const y1 = this.y + Math.sin(this.angle) * this.len;
    if (st === 'aim') {
      const blink = Math.floor(this.age * 14) % 2 === 0;
      r.line(this.x, this.y, x1, y1, WARN_RED, 1, blink ? 0.9 : 0.5);
      r.line(this.x, this.y, x1, y1, WARN_RED, o.width, 0.08);
    } else if (st === 'lock') {
      const blink = Math.floor(this.age * 24) % 2 === 0;
      r.line(this.x, this.y, x1, y1, blink ? '#ffffff' : WARN_RED, 2, 0.95);
      r.line(this.x, this.y, x1, y1, WARN_RED, o.width, 0.18);
    } else {
      const k = st === 'fade' ? Math.max(0, 1 - (this.age - o.aim - o.lock - o.fire) / 0.18) : 1;
      const wob = 1 + Math.sin(this.age * 60) * 0.12;
      r.line(this.x, this.y, x1, y1, o.color, (o.width + 6) * k * wob, 0.3);
      r.line(this.x, this.y, x1, y1, o.color, o.width * k * wob, 0.95);
      r.line(this.x, this.y, x1, y1, o.core ?? '#ffffff', Math.max(1, o.width * 0.4 * k), 1);
      r.circle(this.x, this.y, (o.width * 0.8 + 2) * k, o.core ?? '#ffffff', 0.9);
    }
  }

  override light(w: World): void {
    const st = this.state;
    if (st === 'aim') return;
    const n = Math.max(1, Math.floor(this.len / 36));
    const col = st === 'lock' ? '#ff3040' : this.o.color.slice(0, 7);
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      w.lights.add(this.x + Math.cos(this.angle) * this.len * k, this.y + Math.sin(this.angle) * this.len * k, st === 'lock' ? 14 : 34, col, { intensity: st === 'lock' ? 0.4 : 0.8 });
    }
  }
}

// ================================================================== icicle / debris faller
export interface FallerOpts {
  sprite: string;
  time?: number;
  height?: number;
  radius?: number;
  damage?: number;
  source: string;
  color: string;
  spin?: number;
  onLand?: (w: World, x: number, y: number) => void;
}

/** Something dropping from the ceiling onto a warned spot. */
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
    this.height = o.height ?? 160;
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
      const R = this.o.radius ?? 11;
      hitPlayerCircle(w, this.x, this.y, R, this.o.damage ?? 1, this.o.source);
      w.particles.burst(this.x, this.y - 2, { count: 14, speed: [30, 120], life: [0.25, 0.55], colors: ['#ffffff', this.o.color, this.o.color], size: [1, 3], gravity: 300, vz: [40, 130], shape: 'square', vrot: 9 });
      w.spawn(new RingFx(this.x, this.y, R + 4, 0.25, this.o.color, 2));
      w.sfx('rock_break', { vol: 0.35, pitch: fx.range(1.2, 1.5) });
      w.shake(0.12);
      this.o.onLand?.(w, this.x, this.y);
    }
  }

  override draw(r: Renderer): void {
    const t = clamp(this.age / this.time, 0, 1);
    const R = this.o.radius ?? 11;
    const blink = 0.3 + 0.2 * Math.sin(this.age * 24);
    r.circle(this.x, this.y, R, WARN_RED, blink * 0.5);
    r.ring(this.x, this.y, R, WARN_RED, 1, 0.85);
    r.shadow(this.x, this.y, R * (0.5 + t * 1.1), R * (0.25 + t * 0.45), 0.25 + t * 0.3);
    r.sprite(this.o.sprite, this.x, this.y - this.z - 3, { rot: this.age * (this.o.spin ?? 0) });
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y, (this.o.radius ?? 11) * 1.8, '#ff3040', { intensity: 0.3 });
  }
}

/** Lazily-defined falling icicle sprite. */
export function icicleSprite(): string {
  const name = 'b45_icicle';
  if (!hasSprite(name)) {
    defineDrawnSprite(name, 9, 20, (p) => {
      p.poly([0, 0, 9, 0, 4.5, 20], '#4a86d0');
      p.poly([1.5, 0, 4.5, 0, 4.5, 18], '#c4f0ff');
      p.poly([4.5, 0, 7.5, 0, 4.5, 18], '#2a5aa8');
      p.line(3, 1, 4, 12, '#ffffff');
      p.rect(0, 0, 9, 2, '#e8faff');
      p.px(1, 2, '#8cc8f8');
      p.px(7, 2, '#8cc8f8');
    }, { outline: '#06102a', anchor: 'bottom' });
  }
  return name;
}
