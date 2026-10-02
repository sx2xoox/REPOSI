// Shared toolkit for the floor 6 bosses (대서기관, 가라앉은 등대) — 수몰된 서고:
//  - the drowned-archive palette (deep teal water, indigo shadow, parchment / old gold,
//    ink black, bioluminescent cyan) and two high-contrast bullet families (ink / gold)
//  - glyph bullets: little luminous runes that hold in place while "written", then fly
//  - InkPool: a puddle of luminous ink that hurts the keeper standing in it
//  - pure geometry helpers (ray occlusion by shot-blocking tiles, wedge tests, evenly
//    spaced rows, island picking) — unit-tested in tests/bosses6.test.ts
// Only lazily-compiled sprites are defined here, so the module is safe in node tests.

import { Entity } from '../../game/entity';
import type { World } from '../../game/world';
import type { Enemy, ShootOpts } from '../../game/enemy';
import type { Renderer } from '../../engine/renderer';
import type { RNG } from '../../engine/rng';
import type { ProjBehavior } from '../../game/projectile';
import { defineDrawnSprite, definePixelSprite, hasSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { angleDiff, clamp, TAU } from '../../engine/math';
import { tileProps } from '../../game/tiles';
import { RingFx } from '../../game/effects';
import { summonMinion as summonBase } from './final-kit';

// ================================================================== palette
/** darkest -> lightest */
export const TEAL = ['#061a22', '#0c2e3a', '#14484f', '#1e6a6a', '#2f948a', '#5cc4b0'];
export const INDIGO = ['#0a0a22', '#161a44', '#242c6a', '#3a4690', '#5a66b4'];
export const PARCH = ['#5a4a30', '#8a7448', '#b8a070', '#dcc896', '#f2e6c0', '#fff8e4'];
export const GOLD6 = ['#3a2408', '#7a5016', '#b88a2e', '#e8c050', '#fff0a8'];
export const INKC = ['#030509', '#0a1024', '#14204a', '#1e3270'];
export const CYAN = ['#0a5a7a', '#1aa8c8', '#48e8ff', '#c8ffff', '#ffffff'];
export const DROWNED = ['#1c2a30', '#36505a', '#5a7c84', '#8aacb0', '#c0dcd8'];
export const OUTLINE6 = '#040812';

// ================================================================== bullets
export interface BulletPal6 {
  color: string;
  core: string;
  rim: string;
  outline: string;
}

/** Floor-6 enemy bullet palettes: luminous ink (cyan on indigo) and drowned lamp gold. */
export const BUL6 = {
  ink: { color: '#48e8ff', core: '#f0ffff', rim: '#1e2a9a', outline: '#040818' },
  gold: { color: '#ffd058', core: '#fff8dc', rim: '#a05a10', outline: '#1a0c00' },
} satisfies Record<string, BulletPal6>;
export type BulletKind6 = keyof typeof BUL6;

/** Lazily define a round floor-6 bullet sprite of diameter `d` (bright core, dark rim, outline). */
export function bulletSprite6(kind: BulletKind6, d: number): string {
  d = Math.max(3, Math.min(15, Math.round(d)));
  const name = `__ebul6_${kind}_${d}`;
  if (hasSprite(name)) return name;
  const pal = BUL6[kind];
  defineDrawnSprite(name, d, d, (p) => {
    const r = d / 2;
    p.circle(r, r, r, pal.rim);
    p.circle(r - 0.35, r - 0.35, r - 1, pal.color);
    p.circle(r - 0.8, r - 0.8, Math.max(0.8, r * 0.5), pal.core);
    p.px(Math.floor(r - r * 0.55), Math.floor(r - r * 0.55), '#ffffff');
  }, { outline: pal.outline });
  return name;
}

/** Shoot options for a readable floor-6 bullet of collision radius `size`. */
export function bullet6<T extends ShootOpts>(kind: BulletKind6, size = 3, extra: T = {} as T): ShootOpts & T {
  return {
    color: BUL6[kind].color,
    sprite: bulletSprite6(kind, size * 2 + 1),
    spriteRotates: false,
    radius: size,
    light: 14 + size * 2,
    ...extra,
  };
}

// ================================================================== glyphs
const GLYPH_PAL = { o: INKC[1], c: CYAN[2], w: CYAN[3] };
const GLYPH_ROWS: string[][] = [
  ['.ooooo.', 'oocoooo', 'oocwooo', 'oocwwco', 'oocwooo', 'oocoooo', '.ooooo.'],
  ['.ooooo.', 'ocwwwco', 'ooooooo', 'oocwooo', 'ooooooo', 'ocwwwco', '.ooooo.'],
  ['.ooooo.', 'oocoooo', 'ooocooo', 'ooocwoo', 'ooocooo', 'ocwwwoo', '.ooooo.'],
  ['.ooooo.', 'ocooooo', 'oocwooo', 'ooocwco', 'oocwooo', 'ocooooo', '.ooooo.'],
  ['.ooooo.', 'oocwcoo', 'ocoooco', 'ocowoco', 'ocoooco', 'oocwcoo', '.ooooo.'],
  ['.ooooo.', 'ocwowco', 'oocwcoo', 'ooocooo', 'oocwcoo', 'ocwowco', '.ooooo.'],
];
export const GLYPH_COUNT = GLYPH_ROWS.length;
for (let i = 0; i < GLYPH_COUNT; i++) definePixelSprite(`g6_glyph_${i}`, GLYPH_PAL, GLYPH_ROWS[i], { outline: OUTLINE6 });

/** Sprite name of glyph `i` (wraps). */
export function glyphSprite(i: number): string {
  return `g6_glyph_${((i % GLYPH_COUNT) + GLYPH_COUNT) % GLYPH_COUNT}`;
}

/**
 * Projectile behavior: draw a written glyph. While the shot is delayed (held on the
 * page) it pulses in place; once released it flies with a cyan halo.
 */
export function glyphDraw(sprite: string): ProjBehavior {
  return {
    id: 'glyph-draw',
    draw(p, r) {
      const y = p.y - p.z;
      r.shadow(p.x, p.y + 1, p.r * 1.6, p.r * 0.7, 0.22);
      if (p.delay > 0) {
        const k = 0.5 + 0.5 * Math.sin(p.age * 11);
        // the last half second before release blinks hard: "about to fly"
        const soon = p.delay < 0.45 && Math.floor(p.age * 16) % 2 === 0;
        r.sprite(sprite, p.x, y, { alpha: 0.55 + 0.45 * k, flash: soon ? 0.6 : 0 });
        return;
      }
      r.circle(p.x, y, p.r + 2.5, CYAN[2], 0.22);
      r.sprite(sprite, p.x, y);
    },
  };
}

/** Shoot options for glyph `i` of speed `speed` (collision radius 3). */
export function glyphShot<T extends ShootOpts>(i: number, speed: number, extra: T = {} as T): ShootOpts & T {
  return {
    color: CYAN[2],
    radius: 3,
    light: 20,
    speed,
    z: 6,
    ...extra,
    style: 'none',
    behaviors: [glyphDraw(glyphSprite(i)), ...(extra.behaviors ?? [])],
  };
}

/** Projectile behavior: the moment a held shot is released, re-aim it at the keeper. */
export function aimAtRelease(lead = 0): ProjBehavior {
  return {
    id: 'aim-at-release',
    update(p, w) {
      if (p.mem.aimed) return;
      p.mem.aimed = 1;
      const t = w.player;
      p.angle = Math.atan2(t.y - 4 + t.vy * lead - p.y, t.x + t.vx * lead - p.x);
      p.syncVel();
    },
  };
}

// ================================================================== ink pool
/** Puddle of luminous ink: arms after a short rise, then hurts the keeper standing in it. */
export class InkPool extends Entity {
  radius: number;
  life: number;
  source: string;
  arm = 0.5;
  private blobs: { dx: number; dy: number; r: number }[] = [];

  constructor(x: number, y: number, radius: number, life: number, source: string) {
    super();
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.life = life;
    this.source = source;
    this.layer = 0;
    this.tileCollide = false;
    this.enemyHazard = true;
    const n = 3 + Math.floor(radius / 5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + fx.range(-0.4, 0.4);
      const d = radius * fx.range(0.2, 0.5);
      this.blobs.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.6, r: radius * fx.range(0.45, 0.62) });
    }
  }

  get fade(): number {
    return Math.max(0, Math.min(1, this.age / this.arm, (this.life - this.age) / 0.4));
  }

  get armed(): boolean {
    return this.age > this.arm && this.age < this.life - 0.25;
  }

  /** Erased by a bullet-clear: disarms at once and fades out. */
  override onCleared(): void {
    this.life = Math.min(this.life, this.age + 0.25);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.age >= this.life) {
      this.dead = true;
      return;
    }
    if (fx.chance(dt * 5 * (this.radius / 12))) {
      const a = fx.angle();
      const d = fx.next() * this.radius * 0.8;
      w.particles.spawn({
        x: this.x + Math.cos(a) * d, y: this.y + Math.sin(a) * d * 0.6, vy: -fx.range(4, 12), life: fx.range(0.4, 0.9),
        colors: [CYAN[3], CYAN[2], INDIGO[3]], size: 1, additive: true, light: 3,
      });
    }
    const p = w.player;
    if (this.armed && p.alive && p.z < 4) {
      const dx = p.x - this.x;
      const dy = (p.y - this.y) / 0.7;
      if (dx * dx + dy * dy < (this.radius * 0.85) ** 2) p.hurt(w, 1, this.source);
    }
  }

  override draw(r: Renderer): void {
    const f = this.fade;
    if (f <= 0) return;
    for (const b of this.blobs) r.circle(this.x + b.dx, this.y + b.dy, b.r, INKC[1], 0.85 * f);
    for (const b of this.blobs) r.circle(this.x + b.dx, this.y + b.dy - 1, b.r * 0.7, INKC[2], 0.5 * f);
    // luminous ink: a cyan rim shimmer and a few glowing motes
    const sh = 0.35 + 0.15 * Math.sin(this.age * 5);
    r.ring(this.x, this.y, this.radius * 0.8, CYAN[1], 1, (this.armed ? sh : 0.75) * f);
    if (!this.armed) r.ring(this.x, this.y, this.radius * 0.95, CYAN[2], 1, 0.6 * f);
    r.circle(this.x - this.radius * 0.25, this.y - 1, 1.5, CYAN[3], 0.8 * f);
    r.circle(this.x + this.radius * 0.3, this.y + 2, 1, CYAN[3], 0.6 * f);
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y, this.radius * 2.2, '#30c0ff', { intensity: 0.45 * this.fade });
  }
}

// ================================================================== geometry (pure)
export interface TileQuery {
  tileAtPx(x: number, y: number): number;
}

/**
 * Distance along a ray from (x, y) at `angle` until a shot-blocking tile (walls,
 * rocks, blocks, shelves) — the length a beam of light travels. Capped at `maxLen`.
 */
export function shadowLen(room: TileQuery, x: number, y: number, angle: number, maxLen: number, step = 4): number {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (let d = step; d <= maxLen; d += step) {
    if (tileProps(room.tileAtPx(x + c * d, y + s * d)).blocksShots) return d - step * 0.5;
  }
  return maxLen;
}

/** Is there a shot-blocking tile strictly between (x0, y0) and (x1, y1)? (A shelf shades the keeper.) */
export function rayBlocked(room: TileQuery, x0: number, y0: number, x1: number, y1: number, step = 4): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(d / step);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (tileProps(room.tileAtPx(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)).blocksShots) return true;
  }
  return false;
}

/** Is (px, py) inside the wedge at (cx, cy) facing `angle`, half-angle `half`, out to `len` (and past `inner`)? */
export function inWedge(px: number, py: number, cx: number, cy: number, angle: number, half: number, len: number, inner = 0): boolean {
  const d = Math.hypot(px - cx, py - cy);
  if (d > len || d < inner) return false;
  if (d < 1e-6) return true;
  return Math.abs(angleDiff(angle, Math.atan2(py - cy, px - cx))) <= half;
}

/** `n` points evenly spaced along the segment (x0, y) -> (x1, y) — a written row. */
export function rowSpots(x0: number, x1: number, y: number, n: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (n <= 0) return out;
  if (n === 1) return [{ x: (x0 + x1) / 2, y }];
  for (let i = 0; i < n; i++) out.push({ x: x0 + ((x1 - x0) * i) / (n - 1), y });
  return out;
}

/**
 * Pick `n` island centres inside a rect (inset by `margin`) at least `minDist`
 * apart, the first one near `near` (the keeper always gets a reachable island).
 */
export function islandSpots(
  rng: RNG, rx: number, ry: number, rw: number, rh: number, n: number, minDist: number, margin: number, near?: { x: number; y: number },
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const cx = (x: number) => clamp(x, rx + margin, rx + rw - margin);
  const cy = (y: number) => clamp(y, ry + margin, ry + rh - margin);
  if (near) out.push({ x: cx(near.x + rng.range(-12, 12)), y: cy(near.y + rng.range(-10, 10)) });
  for (let tries = 0; tries < 200 && out.length < n; tries++) {
    const p = { x: cx(rx + rng.next() * rw), y: cy(ry + rng.next() * rh) };
    if (out.every((o) => Math.hypot(o.x - p.x, o.y - p.y) >= minDist)) out.push(p);
  }
  return out;
}

// ================================================================== script helpers
/** Summon a minion owned by `e` — never after the boss has fallen. */
export function summonMinion6(e: Enemy, w: World, id: string, x: number, y: number, colors: string[]): Enemy | null {
  if (e.dead || e.hp <= 0) return null;
  return summonBase(e, w, id, x, y, colors);
}

/** Splash of water + a ring where something strikes the flooded floor. */
export function splash(w: World, x: number, y: number, size = 1, color = TEAL[5]): void {
  w.particles.burst(x, y, {
    count: Math.round(10 * size), speed: [30, 90 * size], life: [0.25, 0.5], colors: ['#ffffff', color, TEAL[4]], size: [1, 2], gravity: 300, vz: [40, 110 * size],
  });
  w.spawn(new RingFx(x, y, 14 * size, 0.3, color, 1));
}
