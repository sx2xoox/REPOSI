// Shared helpers for the regular enemies of floors 1–3:
//  - `frames()`      : define an animation from a parametrised PixelPainter draw
//  - per-floor bullet sprites (bright core + dark rim) and `bullet()` shoot options
//  - `Lob`            : arcing artillery shot with a landing warning
//  - `Hazard`         : short-lived floor puddle (poison / fire) that hurts the player
//  - small pure helpers (frontal-hit test, ray casting, volley targets ...) that are
//    unit-tested in tests/enemies.test.ts
// This module only defines helpers and lazily-compiled sprites (safe in node tests).

import { Entity, type HitInfo } from '../../game/entity';
import type { World } from '../../game/world';
import type { Enemy, ShootOpts } from '../../game/enemy';
import type { Renderer } from '../../engine/renderer';
import type { PixelPainter } from '../../engine/painter';
import type { ProjBehavior } from '../../game/projectile';
import type { Script } from '../../engine/script';
import { defineAnim, defineDrawnSprite, hasSprite, type SpriteOptions } from '../../engine/sprites';
import { GroundWarning, RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { clamp, TAU } from '../../engine/math';

export const OUTLINE = '#0c0810';
export const WARN_RED = '#ff3040';

// ------------------------------------------------------------------ sprites
export interface FrameOpts {
  fps?: number;
  loop?: boolean;
  anchor?: SpriteOptions['anchor'];
  origin?: [number, number];
  outline?: string | null;
}

/**
 * Define `n` frames `${prefix}_${state}_${i}` drawn by `draw(p, i)` and an animation
 * named `${prefix}_${state}`. Returns the animation name.
 */
export function frames(
  prefix: string,
  state: string,
  n: number,
  w: number,
  h: number,
  draw: (p: PixelPainter, i: number) => void,
  o: FrameOpts = {},
): string {
  const names: string[] = [];
  for (let i = 0; i < n; i++) {
    names.push(
      defineDrawnSprite(`${prefix}_${state}_${i}`, w, h, (p) => draw(p, i), {
        outline: o.outline === null ? undefined : o.outline ?? OUTLINE,
        anchor: o.anchor,
        origin: o.origin,
      }),
    );
  }
  return defineAnim(`${prefix}_${state}`, names, o.fps ?? 8, o.loop ?? true);
}

/** Sphere shading lit from the top-left (PixelPainter.shadeSphere default light). */
export function sphere(p: PixelPainter, cx: number, cy: number, rx: number, ry: number, colors: string[], dither = true): void {
  p.shadeSphere(cx, cy, rx, ry, colors, { dither });
}

/** Two-pixel glowing eye: bright pupil + soft halo pixel. */
export function glowEye(p: PixelPainter, x: number, y: number, core: string, halo?: string): void {
  if (halo) p.px(x, y + 1, halo);
  p.px(x, y, core);
}

// ------------------------------------------------------------------ bullets
export interface BulletPal {
  color: string;
  core: string;
  rim: string;
  outline: string;
}

/** Enemy bullet palettes: crypt red, spirit magenta, toxic green, molten orange, bone. */
export const BUL = {
  crypt: { color: '#ff3a4c', core: '#ffd8dc', rim: '#a0102c', outline: '#22040c' },
  spirit: { color: '#ff56dc', core: '#ffe6fa', rim: '#9a1a92', outline: '#200420' },
  toxic: { color: '#a8ff3c', core: '#f6ffd6', rim: '#46940e', outline: '#0a1e04' },
  molten: { color: '#ffcf4a', core: '#fffbe4', rim: '#c8300c', outline: '#160300' },
  // floors 4–5 (sanctum: frost shards + rose hymns; abyss: hot void pink, eldritch teal, stars)
  frost: { color: '#8cf2ff', core: '#ffffff', rim: '#2856e8', outline: '#020820' },
  hymn: { color: '#ff5c8e', core: '#fff0f6', rim: '#a8164c', outline: '#1e0410' },
  void: { color: '#ff4fae', core: '#ffe6f4', rim: '#a0105e', outline: '#14000a' },
  eldritch: { color: '#3cffc4', core: '#eafff8', rim: '#0a8a6c', outline: '#001410' },
  star: { color: '#ffec50', core: '#ffffff', rim: '#ff8a1a', outline: '#1c0a00' },
  // floor 6 (drowned archive): glowing ink glyphs, old parchment pages
  glyph: { color: '#56e8ff', core: '#f0ffff', rim: '#1a3a9a', outline: '#040a18' },
  page: { color: '#ffd978', core: '#fff8e0', rim: '#a0601a', outline: '#1a0e02' },
} satisfies Record<string, BulletPal>;
export type BulletKind = keyof typeof BUL;

/** Lazily define a round enemy bullet sprite of diameter `d` (outline adds 2px). */
export function bulletSprite(kind: BulletKind, d: number): string {
  d = Math.max(3, Math.min(15, Math.round(d)));
  const name = `__ebul_${kind}_${d}`;
  if (hasSprite(name)) return name;
  const pal = BUL[kind];
  defineDrawnSprite(name, d, d, (p) => {
    const r = d / 2;
    p.circle(r, r, r, pal.rim);
    p.circle(r - 0.35, r - 0.35, r - 1, pal.color);
    p.circle(r - 0.8, r - 0.8, Math.max(0.8, r * 0.5), pal.core);
    p.px(Math.floor(r - r * 0.55), Math.floor(r - r * 0.55), '#ffffff');
  }, { outline: pal.outline });
  return name;
}

/** Shoot options for a readable floor-themed bullet of collision radius `size`. */
export function bullet<T extends ShootOpts>(kind: BulletKind, size = 3, extra: T = {} as T): ShootOpts & T {
  return {
    color: BUL[kind].color,
    sprite: bulletSprite(kind, size * 2 + 1),
    spriteRotates: false,
    radius: size,
    light: 14 + size * 2,
    ...extra,
  };
}

/** Projectile behavior: draw a spinning sprite (use with style 'none'). */
export function spinDraw(sprite: string, spin = 14): ProjBehavior {
  return {
    id: 'spin-draw',
    draw(p, r) {
      r.shadow(p.x, p.y + 1, p.r * 1.8, p.r * 0.8, 0.28);
      if (p.delay > 0 && Math.floor(p.age * 20) % 2 === 1) return;
      r.sprite(sprite, p.x, p.y - p.z, { rot: p.age * spin * (p.mem.spinDir || 1) });
    },
  };
}

// ------------------------------------------------------------------ pure helpers
/**
 * Does a hit travelling along (dirX, dirY) strike the front of something facing `face`?
 * `cone` is the minimum cosine (0.35 ≈ a 140° frontal arc).
 */
export function isFrontalHit(face: number, dirX: number | undefined, dirY: number | undefined, cone = 0.35): boolean {
  if (dirX === undefined || dirY === undefined) return false;
  const l = Math.hypot(dirX, dirY);
  if (l < 1e-6) return false;
  return (dirX * Math.cos(face) + dirY * Math.sin(face)) / l < -cone;
}

/** Damage `Enemy.takeHit` applies for `hit` (mirrors its status multipliers). */
export function appliedDamage(hit: HitInfo, weak: boolean, frozen: boolean): number {
  let d = hit.damage;
  if (weak) d *= 1.35;
  if (frozen && hit.kind !== 'status') d *= 1.2;
  return d;
}

export interface BlockQuery {
  boxBlocked(x: number, y: number, r: number, flying: boolean, phasing: boolean): boolean;
}

/** How far a mover of radius `r` can travel from (x, y) along `angle` (capped at `max`). */
export function rayFree(room: BlockQuery, x: number, y: number, angle: number, r: number, max: number, flying = false, step = 4): number {
  const cx = Math.cos(angle);
  const cy = Math.sin(angle);
  let d = 0;
  while (d + step <= max) {
    if (room.boxBlocked(x + cx * (d + step), y + cy * (d + step), r, flying, false)) return d;
    d += step;
  }
  return max;
}

/** Artillery volley: the target point plus `count-1` points spread perpendicular to the firing line. */
export function volleyTargets(fromX: number, fromY: number, tx: number, ty: number, count: number, spacing: number): { x: number; y: number }[] {
  const a = Math.atan2(ty - fromY, tx - fromX);
  const px = -Math.sin(a);
  const py = Math.cos(a);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const k = i - (count - 1) / 2;
    out.push({ x: tx + px * k * spacing, y: ty + py * k * spacing });
  }
  // the exact target first (most dangerous shot lands first)
  out.sort((a2, b) => Math.hypot(a2.x - tx, a2.y - ty) - Math.hypot(b.x - tx, b.y - ty));
  return out;
}

/** Point `dist` px from (x0,y0) toward (x1,y1), never beyond (x1,y1). */
export function stepToward(x0: number, y0: number, x1: number, y1: number, dist: number): { x: number; y: number } {
  const d = Math.hypot(x1 - x0, y1 - y0);
  if (d <= dist || d < 1e-6) return { x: x1, y: y1 };
  return { x: x0 + ((x1 - x0) / d) * dist, y: y0 + ((y1 - y0) / d) * dist };
}

// ------------------------------------------------------------------ world helpers
/** Clamp (x, y) into the room interior and onto a free tile for a ground mover. */
export function landingSpot(w: World, x: number, y: number, r: number): { x: number; y: number } {
  const room = w.room;
  const cx = clamp(x, room.interiorX + r + 1, room.interiorX + room.interiorW - r - 1);
  const cy = clamp(y, room.interiorY + r + 1, room.interiorY + room.interiorH - r - 1);
  if (room.isFree(cx, cy, r)) return { x: cx, y: cy };
  return room.nearestFree(cx, cy, r);
}

/** A free spot at distance [minD, maxD] from (x, y), preferring open floor; null if none. */
export function spotAround(w: World, x: number, y: number, minD: number, maxD: number, r: number, flying = false): { x: number; y: number } | null {
  const room = w.room;
  for (let i = 0; i < 24; i++) {
    const a = w.rng.angle();
    const d = w.rng.range(minD, maxD);
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d;
    if (px < room.interiorX + r || px > room.interiorX + room.interiorW - r) continue;
    if (py < room.interiorY + r || py > room.interiorY + room.interiorH - r) continue;
    if (flying ? room.boxBlocked(px, py, r, true, false) : !room.isFree(px, py, r)) continue;
    return { x: px, y: py };
  }
  return null;
}

/** Count living enemies with def id `id` whose `mem.owner` is `owner`. */
export function countChildren(w: World, owner: Enemy, id: string): number {
  let n = 0;
  for (const o of w.enemies) if (o.alive && o.def.id === id && o.mem.owner === owner) n++;
  return n;
}

/** Puff of dust / debris particles on the floor. */
export function dust(w: World, x: number, y: number, colors: string[], n = 6, speed = 50): void {
  w.particles.burst(x, y, { count: n, speed: [speed * 0.3, speed], life: [0.25, 0.55], colors, size: [1, 2], gravity: 260, vz: [20, 70], drag: 3 });
}

/** Particles converging on (x, y) — a charge-up telegraph. */
export function gather(w: World, x: number, y: number, colors: string[], n = 8, radius = 16, additive = true): void {
  for (let i = 0; i < n; i++) {
    const a = fx.angle();
    const d = radius * fx.range(0.7, 1.2);
    const life = fx.range(0.25, 0.4);
    w.particles.spawn({
      x: x + Math.cos(a) * d, y: y + Math.sin(a) * d,
      vx: (-Math.cos(a) * d) / life, vy: (-Math.sin(a) * d) / life,
      life, colors, size: fx.range(1, 2), sizeEnd: 0.5, additive, light: additive ? 6 : 0,
    });
  }
}

// ------------------------------------------------------------------ lobbed shots
export interface LobOpts {
  /** flight time (s) */
  time?: number;
  height?: number;
  sprite: string;
  /** trail / impact color "#rrggbb" */
  color: string;
  /** landing warning radius (0 = none) */
  warn?: number;
  warnColor?: string;
  /** rotation speed of the sprite while flying */
  spin?: number;
  /** half-hearts dealt when the player is within hitRadius on landing (0 = none) */
  damage?: number;
  hitRadius?: number;
  /** death-screen source name */
  source?: string;
  light?: number;
  onLand?: (w: World, x: number, y: number) => void;
}

/** Arcing artillery shot: harmless in the air, hits around its landing point. */
export class Lob extends Entity {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  o: LobOpts;
  time: number;
  height: number;
  trailT = 0;
  /** floor warning under the landing point (removed if the shot is cleared) */
  warning: GroundWarning | null = null;

  constructor(x0: number, y0: number, x1: number, y1: number, o: LobOpts) {
    super();
    this.sx = this.x = x0;
    this.sy = this.y = y0;
    this.tx = x1;
    this.ty = y1;
    this.o = o;
    this.time = o.time ?? 0.9;
    this.height = o.height ?? 46;
    this.layer = 1;
    this.tileCollide = false;
    this.team = 'enemy';
    this.enemyHazard = true;
  }

  override get sortY(): number {
    return this.y + 4;
  }

  /** Erased by a bullet-clear: vanish mid-air, no landing hit. */
  override onCleared(): void {
    this.dead = true;
    if (this.warning) this.warning.dead = true;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const t = clamp(this.age / this.time, 0, 1);
    this.x = this.sx + (this.tx - this.sx) * t;
    this.y = this.sy + (this.ty - this.sy) * t;
    this.z = Math.sin(t * Math.PI) * this.height + (1 - t) * 6;
    this.trailT += dt;
    if (this.trailT > 0.04) {
      this.trailT = 0;
      w.particles.spawn({
        x: this.x + fx.range(-1, 1), y: this.y - this.z + fx.range(-1, 1), life: fx.range(0.2, 0.35),
        colors: ['#ffffff', this.o.color, this.o.color + '80'], size: 2, sizeEnd: 0.5, vy: fx.range(-8, 2),
      });
    }
    if (t >= 1) this.land(w);
  }

  private land(w: World): void {
    if (this.dead) return;
    this.dead = true;
    const { x, y } = this;
    const p = w.player;
    const dmg = this.o.damage ?? 1;
    if (dmg > 0 && p.alive && p.z < 8 && Math.hypot(p.x - x, p.y - y) < (this.o.hitRadius ?? 11) + p.r * 0.5) {
      if (p.hurt(w, dmg, this.o.source ?? '포탄')) {
        const d = Math.hypot(p.x - x, p.y - y) || 1;
        p.knock((p.x - x) / d, (p.y - y) / d, 140);
      }
    }
    w.particles.burst(x, y - 2, { count: 14, speed: [30, 110], life: [0.25, 0.5], colors: ['#ffffff', this.o.color, this.o.color], size: [1, 3], gravity: 280, vz: [30, 100] });
    w.spawn(new RingFx(x, y, (this.o.hitRadius ?? 11) + 4, 0.25, this.o.color, 2));
    w.sfx('splat', { vol: 0.45, pitch: fx.range(0.8, 1.0) });
    this.o.onLand?.(w, x, y);
  }

  override draw(r: Renderer): void {
    const k = Math.min(0.6, this.z / 90);
    r.shadow(this.x, this.y + 1, 8 * (1 - k), 3.5 * (1 - k), 0.35);
    r.sprite(this.o.sprite, this.x, this.y - this.z, { rot: this.age * (this.o.spin ?? 8) });
  }

  override light(w: World): void {
    if ((this.o.light ?? 18) > 0) w.lights.add(this.x, this.y - this.z, this.o.light ?? 18, this.o.color.slice(0, 7), { intensity: 0.8 });
  }
}

/** Launch an arcing shot from (x0,y0) to (x1,y1) with a floor warning for its whole flight. */
export function lob(w: World, x0: number, y0: number, x1: number, y1: number, o: LobOpts): Lob {
  const time = o.time ?? 0.9;
  const warning = (o.warn ?? 12) > 0 ? w.spawn(new GroundWarning(x1, y1, o.warn ?? 12, time, undefined, o.warnColor ?? WARN_RED)) : null;
  const l = new Lob(x0, y0, x1, y1, o);
  l.warning = warning;
  w.spawn(l);
  w.sfx('whoosh', { vol: 0.35, pitch: fx.range(1.1, 1.3) });
  return l;
}

// ------------------------------------------------------------------ hazards
export type HazardKind = 'poison' | 'fire';

const HAZARD_COLORS: Record<HazardKind, { base: string; light: string; bubble: string[] }> = {
  poison: { base: '#5ac02a', light: '#b4ff5a', bubble: ['#e8ffb0', '#a8ff3c', '#5ac02a'] },
  fire: { base: '#d0400c', light: '#ffb030', bubble: ['#fff4b0', '#ffa424', '#d0400c'] },
};

/** Short-lived floor puddle. Arms after a short fade-in, then hurts the player standing in it. */
export class Hazard extends Entity {
  radius: number;
  life: number;
  kind: HazardKind;
  source: string;
  arm = 0.4;
  private blobs: { dx: number; dy: number; r: number }[] = [];

  constructor(x: number, y: number, radius: number, life: number, kind: HazardKind, source: string) {
    super();
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.life = life;
    this.kind = kind;
    this.source = source;
    this.layer = 0;
    this.tileCollide = false;
    this.enemyHazard = true;
    const n = 4 + Math.floor(radius / 5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + fx.range(-0.4, 0.4);
      const d = radius * fx.range(0.25, 0.55);
      this.blobs.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.6, r: radius * fx.range(0.45, 0.65) });
    }
  }

  get fade(): number {
    return Math.min(1, this.age / this.arm, (this.life - this.age) / 0.4);
  }

  /** Erased by a bullet-clear: stops hurting at once and fades out. */
  override onCleared(): void {
    this.life = Math.min(this.life, this.age + 0.25);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.age >= this.life) {
      this.dead = true;
      return;
    }
    const c = HAZARD_COLORS[this.kind];
    if (fx.chance(dt * (this.kind === 'fire' ? 14 : 6) * (this.radius / 12))) {
      const a = fx.angle();
      const d = fx.next() * this.radius * 0.8;
      w.particles.spawn({
        x: this.x + Math.cos(a) * d, y: this.y + Math.sin(a) * d * 0.6, vy: this.kind === 'fire' ? -fx.range(12, 26) : -fx.range(3, 8),
        life: fx.range(0.3, 0.7), colors: c.bubble, size: fx.range(1, 2), additive: this.kind === 'fire', light: this.kind === 'fire' ? 5 : 0,
      });
    }
    const p = w.player;
    if (this.age > this.arm && this.age < this.life - 0.25 && p.alive && p.z < 4) {
      const dx = p.x - this.x;
      const dy = (p.y - this.y) / 0.7;
      if (dx * dx + dy * dy < (this.radius * 0.85) ** 2) p.hurt(w, 1, this.source);
    }
  }

  override draw(r: Renderer): void {
    const c = HAZARD_COLORS[this.kind];
    const f = Math.max(0, this.fade);
    const armed = this.age > this.arm;
    for (const b of this.blobs) r.circle(this.x + b.dx, this.y + b.dy, b.r, c.base, 0.45 * f);
    r.circle(this.x, this.y, this.radius * 0.55, c.light, (armed ? 0.35 : 0.15) * f);
    if (!armed) r.ring(this.x, this.y, this.radius * 0.9, c.light, 1, 0.6 * f);
  }

  override light(w: World): void {
    if (this.kind === 'fire') w.lights.add(this.x, this.y, this.radius * 2.6, '#ff7020', { intensity: 0.7 * Math.max(0, this.fade) });
    else w.lights.add(this.x, this.y, this.radius * 2, '#80ff40', { intensity: 0.35 * Math.max(0, this.fade) });
  }
}

/** Little dizzy stars over a stunned enemy (cosmetic). */
export function dizzy(w: World, e: Enemy): void {
  const a = w.time * 8;
  for (let i = 0; i < 2; i++) {
    const k = a + i * Math.PI;
    w.particles.spawn({
      x: e.x + Math.cos(k) * 6, y: e.y - e.r * 2 - 4 + Math.sin(k) * 2, life: 0.12,
      colors: ['#fff6a0'], size: 1, z: 0,
    });
  }
}

// ================================================================== floors 4–5 additions
// Shaped enemy bullets (crystal shards that point along their flight, spinning stars),
// small pure geometry helpers for the sanctum / abyss enemies (unit-tested in
// tests/enemies45.test.ts) and a few shared script snippets.

/** Lazily define an elongated crystal-shard bullet sprite of length `len` (points right). */
export function shardSprite(kind: BulletKind, len: number): string {
  len = Math.max(5, Math.min(15, Math.round(len)));
  const name = `__eshard_${kind}_${len}`;
  if (hasSprite(name)) return name;
  const pal = BUL[kind];
  const h = Math.max(3, Math.round(len * 0.42)) | 1;
  const mid = h / 2;
  const wide = Math.round(len * 0.38);
  defineDrawnSprite(name, len, h, (p) => {
    p.poly([0, mid, wide, 0, len, mid, wide, h], pal.rim);
    p.poly([1.5, mid, wide, 1, len - 1.5, mid, wide, h - 1], pal.color);
    p.line(wide - 1, Math.floor(mid), len - 2, Math.floor(mid), pal.core);
    p.px(len - 2, Math.floor(mid), '#ffffff');
    p.px(wide, Math.floor(mid) - (h >= 5 ? 1 : 0), '#ffffff');
  }, { outline: pal.outline });
  return name;
}

/** Lazily define a four-pointed star bullet sprite of size `d` (odd, 5..15). */
export function starSprite(kind: BulletKind, d: number): string {
  d = Math.max(5, Math.min(15, Math.round(d))) | 1;
  const name = `__estar_${kind}_${d}`;
  if (hasSprite(name)) return name;
  const pal = BUL[kind];
  const c = d / 2;
  const t = Math.max(1, d * 0.16);
  defineDrawnSprite(name, d, d, (p) => {
    p.poly([0, c, c - t, c - t, c, 0, c + t, c - t, d, c, c + t, c + t, c, d, c - t, c + t], pal.rim);
    p.poly([1.5, c, c - t * 0.6, c - t * 0.6, c, 1.5, c + t * 0.6, c - t * 0.6, d - 1.5, c, c + t * 0.6, c + t * 0.6, c, d - 1.5, c - t * 0.6, c + t * 0.6], pal.color);
    p.circle(c, c, Math.max(1, d * 0.17), pal.core);
    p.px(Math.floor(c), Math.floor(c), '#ffffff');
  }, { outline: pal.outline });
  return name;
}

/** Shoot options for a crystal shard of collision radius `size` that points along its flight. */
export function shard<T extends ShootOpts>(kind: BulletKind, size = 3, extra: T = {} as T): ShootOpts & T {
  return {
    color: BUL[kind].color,
    sprite: shardSprite(kind, size * 3 + 2),
    spriteRotates: true,
    radius: size,
    light: 14 + size * 2,
    ...extra,
  };
}

/** Shoot options for a spinning star bullet of collision radius `size`. */
export function starShot<T extends ShootOpts>(kind: BulletKind, size = 3, extra: T = {} as T): ShootOpts & T {
  return {
    color: BUL[kind].color,
    radius: size,
    light: 16 + size * 2,
    ...extra,
    style: 'none',
    behaviors: [spinDraw(starSprite(kind, size * 2 + 3), 7), ...(extra.behaviors ?? [])],
  };
}

/**
 * Slot offsets (in slots from the wall's center) of a bullet wall of `count` slots
 * with a hole of `gap` slots starting at slot index `gapStart`.
 */
export function wallSlots(count: number, gapStart: number, gap: number): number[] {
  const out: number[] = [];
  const c = (count - 1) / 2;
  for (let i = 0; i < count; i++) if (i < gapStart || i >= gapStart + gap) out.push(i - c);
  return out;
}

/** First slot of a `gap`-wide hole about `offsetSlots` from the wall's center (rounded outward), kept inside the wall. */
export function gapStartFor(count: number, gap: number, offsetSlots: number): number {
  const c = (count - 1) / 2;
  const start = c + offsetSlots - (gap - 1) / 2;
  // round away from the center so the hole never drifts back over it
  const s = offsetSlots >= 0 ? Math.ceil(start - 1e-9) : Math.floor(start + 1e-9);
  return clamp(s, 0, Math.max(0, count - gap));
}

/** Point reflection of (px, py) through (cx, cy). */
export function mirrorPoint(px: number, py: number, cx: number, cy: number): { x: number; y: number } {
  return { x: 2 * cx - px, y: 2 * cy - py };
}

/** Is (tx, ty) inside the aiming cone (`aim` ± `half` radians) seen from (fx, fy)? */
export function inAimCone(aim: number, fx0: number, fy0: number, tx: number, ty: number, half: number): boolean {
  const a = Math.atan2(ty - fy0, tx - fx0);
  let d = (a - aim) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return Math.abs(d) <= half;
}

/** Gravity pull speed at distance `d`: 0 outside `radius`, rising linearly from 40% at the rim to `max` at the center. */
export function pullSpeed(d: number, radius: number, max: number): number {
  if (d >= radius || radius <= 0) return 0;
  return max * (0.4 + 0.6 * (1 - Math.max(0, d) / radius));
}

/** `count` points along a ray from (x0, y0), the first `start` px out, then every `spacing` px. */
export function lineSpots(x0: number, y0: number, angle: number, count: number, spacing: number, start = spacing): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const d = start + i * spacing;
    out.push({ x: x0 + Math.cos(angle) * d, y: y0 + Math.sin(angle) * d });
  }
  return out;
}

/** The hurt pose for a moment after a hit (after the white flash), else the current animation frame. */
export function hurtFrame(e: Enemy, w: World, hurt: string, window = 0.24): string {
  return w.time - e.lastHurtAt < window ? hurt : e.frame();
}

/** Script: fade an enemy's alpha to `to` over `time` seconds. */
export function* fadeTo(e: Enemy, w: World, to: number, time: number): Script {
  const from = e.alpha;
  for (let el = 0; el < time; el += w.dt) {
    e.alpha = from + (to - from) * Math.min(1, el / time);
    yield;
  }
  e.alpha = to;
}

/** Rectangular lane warning from (x, y) along `angle` (`len` long, `width` wide). */
export function laneWarning(w: World, x: number, y: number, angle: number, len: number, width: number, time: number, color = WARN_RED): GroundWarning {
  const g = w.spawn(new GroundWarning(x, y, 4, time, undefined, color));
  g.rw = len;
  g.rh = width;
  g.angle = angle;
  return g;
}
