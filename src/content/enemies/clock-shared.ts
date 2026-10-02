// Shared pieces of the floor-7 enemies (멈춘 태엽탑):
//  - palettes (brass, verdigris, porcelain, plum), the floor's beat (every enemy that
//    "ticks" shares it, so a room full of clockwork fires in rhythm)
//  - cog bullets (hot brass gears) and tick bullets (pale verdigris second hands)
//  - `TimeField`: a zone where bullets crawl, then snap back to full speed (and faster)
//    when it collapses; `timeSlow` is the projectile behavior it drives
//  - `SteamLane`: a lane of scalding steam vented by the 증기 골렘
//  - `bouncePath`: the ricochet path of a rolling gear (pure, unit-tested)
//  - small effects: brass sparks, porcelain shards, a spring popping out
// Pure helpers are unit-tested in tests/floor7.test.ts.

import { Entity } from '../../game/entity';
import type { World } from '../../game/world';
import type { ShootOpts } from '../../game/enemy';
import type { Renderer } from '../../engine/renderer';
import type { PixelPainter } from '../../engine/painter';
import type { ProjBehavior } from '../../game/projectile';
import { defineDrawnSprite, hasSprite } from '../../engine/sprites';
import { RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { clamp, TAU } from '../../engine/math';
import { CLOCK, paintGear } from '../props/clock';
import { BUL, type BlockQuery } from './shared';

// ------------------------------------------------------------------ palette
export const BRASS = CLOCK.brass;
export const VERD = CLOCK.verd;
export const PORC = CLOCK.porc;
export const PLUM = CLOCK.plum;
export const AMBER = CLOCK.amber;
export const TIME = CLOCK.time;
export const COUT = CLOCK.out;
/** brass spark colors */
export const SPARK = ['#fff6d0', '#ffc850', '#c46a1a'];

/** The floor's beat (s): wind-up things tick, cuckoos fire and dolls step on it. */
export const BEAT = 0.75;

/** Index of the beat `t` falls in. */
export function beatIndex(t: number, period = BEAT): number {
  return Math.floor(t / period + 1e-7);
}

/** Did a beat boundary pass between `prev` and `now`? */
export function beatCrossed(prev: number, now: number, period = BEAT): boolean {
  return beatIndex(now, period) > beatIndex(prev, period);
}

// ------------------------------------------------------------------ bullets
/** Lazily define a hot brass cog bullet sprite of diameter `d` (odd, 5..13). */
export function cogSprite(d = 7): string {
  d = Math.max(5, Math.min(13, Math.round(d))) | 1;
  const name = `__cog_${d}`;
  if (hasSprite(name)) return name;
  const pal = BUL.cog;
  defineDrawnSprite(name, d, d, (p) => {
    const c = (d - 1) / 2;
    const r = c - 1.2;
    paintGear(p, c + 0.5, c + 0.5, r, d >= 9 ? 8 : 6, [pal.rim, pal.rim, pal.color, pal.color, pal.core], 0, { spokes: 0, tooth: 1.3, hub: 1 });
    p.circle(c + 0.5, c + 0.5, Math.max(1, r * 0.45), pal.core);
    p.px(c, c, '#ffffff');
    if (d >= 9) p.px(c - 1, c - 1, '#ffffff');
  }, { outline: pal.outline });
  return name;
}

/** Shoot options for a hot brass cog of collision radius `size`. */
export function cogShot<T extends ShootOpts>(size = 3, extra: T = {} as T): ShootOpts & T {
  return {
    color: BUL.cog.color,
    sprite: cogSprite(size * 2 + 1),
    spriteRotates: false,
    radius: size,
    light: 14 + size * 2,
    ...extra,
  };
}

/** Lazily define a "second hand" needle bullet sprite of length `len` (points right). */
export function tickSprite(len = 9): string {
  len = Math.max(5, Math.min(15, Math.round(len)));
  const name = `__tick_${len}`;
  if (hasSprite(name)) return name;
  const pal = BUL.tick;
  const h = 5;
  defineDrawnSprite(name, len, h, (p) => {
    // a thin needle with a round bright head, like a loose clock hand
    p.poly([0, 2.5, len * 0.6, 0.5, len, 2.5, len * 0.6, 4.5], pal.rim);
    p.poly([1, 2.5, len * 0.6, 1.2, len - 1, 2.5, len * 0.6, 3.8], pal.color);
    p.line(len * 0.45, 2, len - 2, 2, pal.core);
    p.circle(len * 0.3, 2.5, 2.1, pal.rim);
    p.circle(len * 0.3, 2.5, 1.5, pal.core);
    p.px(Math.floor(len * 0.3) - 1, 1, '#ffffff');
  }, { outline: pal.outline });
  return name;
}

/** Shoot options for a verdigris tick needle of collision radius `size`. */
export function tickShot<T extends ShootOpts>(size = 3, extra: T = {} as T): ShootOpts & T {
  return {
    color: BUL.tick.color,
    sprite: tickSprite(size * 3),
    spriteRotates: true,
    radius: size,
    light: 12 + size * 2,
    ...extra,
  };
}

// ------------------------------------------------------------------ time field
/**
 * Projectile behavior driven by `TimeField`: while a field stamps the shot (every
 * step), it moves at `__tzK`; for a short while after a field snapped it, it races.
 */
export const timeSlow: ProjBehavior = {
  id: 'time-slow',
  update(p, w) {
    let k = 1;
    if (w.time - (p.mem.__tzT ?? -9) < 0.03) k = p.mem.__tzK ?? 1;
    const b = p.mem.__tzB;
    if (b !== undefined && w.time - b < 0.45) k *= 1.75;
    if (k !== 1) {
      p.vx *= k;
      p.vy *= k;
    }
  },
  draw(p, r, w) {
    if (w.time - (p.mem.__tzT ?? -9) < 0.03) r.ring(p.x, p.y - p.z, p.r + 2.5, TIME.mid, 1, 0.45);
    else if (p.mem.__tzB !== undefined && w.time - p.mem.__tzB < 0.3) r.line(p.x, p.y - p.z, p.x - p.vx * 0.05, p.y - p.z - p.vy * 0.05, TIME.hot, 1, 0.6);
  },
};

/**
 * Behavior of an echo left by the 되감기 유령: the needle hangs where the ghost was,
 * then at `release` seconds turns toward the keeper and launches at `speed`.
 */
export function echoTick(release: number, speed: number): ProjBehavior {
  return {
    id: 'echo-tick',
    update(p, w) {
      if (p.mem.go) return;
      p.vx = p.vy = 0;
      if (p.age >= release) {
        p.mem.go = 1;
        const pl = w.player;
        p.angle = Math.atan2(pl.y - 4 - p.y, pl.x - p.x);
        p.speed = speed;
        p.syncVel();
        w.particles.burst(p.x, p.y - p.z, { count: 4, speed: [20, 60], life: [0.15, 0.3], colors: [TIME.hot, TIME.mid], size: [1, 1], additive: true });
        w.sfx('clock_tick', { vol: 0.3, pitch: 1.6, x: p.x });
      }
    },
    draw(p, r) {
      if (p.mem.go) return;
      const k = clamp(p.age / release, 0, 1);
      r.ring(p.x, p.y - p.z, 2 + (1 - k) * 6, TIME.mid, 1, 0.3 + 0.5 * k);
    },
  };
}

/** Speed factor a `TimeField` of `slowK` applies to a projectile of `team`. */
export function fieldFactor(team: string, slowK: number): number {
  return team === 'enemy' ? slowK : Math.max(slowK, 0.55);
}

/**
 * A pocket of stopped time: after an arming ring, every bullet inside crawls for
 * `hold` seconds; when the field collapses they snap back to full speed and race.
 * Bullet-clears dispel it (no snap). One of the 시간 고정체's tricks.
 */
export class TimeField extends Entity {
  radius: number;
  arm = 0.45;
  hold: number;
  slowK: number;
  snapped = false;
  dispelled = false;
  private motes: { dx: number; dy: number; ph: number }[] = [];

  constructor(x: number, y: number, radius: number, hold: number, slowK = 0.32) {
    super();
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.hold = hold;
    this.slowK = slowK;
    this.layer = 0;
    this.tileCollide = false;
    this.enemyHazard = true;
    for (let i = 0; i < 7; i++) {
      const a = fx.angle();
      const d = radius * fx.range(0.2, 0.85);
      this.motes.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.8, ph: fx.range(0, 6) });
    }
  }

  get active(): boolean {
    return this.age >= this.arm && this.age < this.arm + this.hold && !this.dispelled;
  }

  /** 0..1 visual strength */
  get k(): number {
    if (this.dispelled) return clamp(1 - (this.age - this.dispelledAt) / 0.3, 0, 1) * 0.6;
    const end = this.arm + this.hold;
    return clamp(Math.min(this.age / this.arm, (end + 0.35 - this.age) / 0.35), 0, 1);
  }

  private dispelledAt = 0;

  override onCleared(_w?: World): void {
    if (this.dispelled) return;
    this.dispelled = true;
    this.dispelledAt = this.age;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const end = this.arm + this.hold;
    if (this.dispelled) {
      if (this.age - this.dispelledAt > 0.3) this.dead = true;
      return;
    }
    if (!this.snapped && this.age >= end) this.snap(w);
    if (this.age >= end + 0.35) {
      this.dead = true;
      return;
    }
    if (!this.active) return;
    const r2 = this.radius * this.radius;
    for (const pr of w.projectiles) {
      if (pr.dead) continue;
      const dx = pr.x - this.x;
      const dy = pr.y - this.y;
      if (dx * dx + dy * dy > r2) continue;
      pr.mem.__tzK = fieldFactor(pr.team, this.slowK);
      pr.mem.__tzT = w.time;
      pr.addBehavior(timeSlow);
    }
    if (fx.chance(dt * 6)) {
      const a = fx.angle();
      const d = fx.next() * this.radius;
      w.particles.spawn({ x: this.x + Math.cos(a) * d, y: this.y + Math.sin(a) * d * 0.8, life: fx.range(0.8, 1.4), colors: [TIME.hot, TIME.mid], size: 1, alpha: 0.7, additive: true });
    }
  }

  private snap(w: World): void {
    this.snapped = true;
    const r2 = this.radius * this.radius;
    for (const pr of w.projectiles) {
      if (pr.dead || pr.team !== 'enemy') continue;
      const dx = pr.x - this.x;
      const dy = pr.y - this.y;
      if (dx * dx + dy * dy > r2) continue;
      pr.mem.__tzB = w.time;
      pr.addBehavior(timeSlow);
    }
    w.spawn(new RingFx(this.x, this.y, this.radius + 6, 0.3, TIME.hot, 2));
    w.particles.burst(this.x, this.y, { count: 12, speed: [40, 120], life: [0.2, 0.45], colors: [TIME.hot, TIME.mid], size: [1, 2], additive: true });
    w.sfx('clock_snap', { vol: 0.5, x: this.x });
  }

  override draw(r: Renderer, w: World): void {
    const k = this.k;
    if (k <= 0.01) return;
    const R = this.radius;
    if (this.age < this.arm && !this.dispelled) {
      // arming: a ring tightens onto the zone
      const t = this.age / this.arm;
      r.ring(this.x, this.y, R + (1 - t) * 14, TIME.mid, 1, 0.5 + 0.4 * t);
      r.circle(this.x, this.y, R * t, TIME.low, 0.18 * t);
      return;
    }
    r.circle(this.x, this.y, R, TIME.low, 0.22 * k);
    r.circle(this.x, this.y, R * 0.6, TIME.mid, 0.08 * k);
    r.ring(this.x, this.y, R, TIME.mid, 1, 0.75 * k);
    // the field's own clock hand, crawling backwards
    const a = -w.time * 0.9;
    r.line(this.x, this.y, this.x + Math.cos(a) * R * 0.85, this.y + Math.sin(a) * R * 0.85, TIME.mid, 1, 0.5 * k);
    for (const m of this.motes) {
      const b = 0.5 + 0.5 * Math.sin(w.time * 1.3 + m.ph);
      r.rect(this.x + m.dx, this.y + m.dy, 1, 1, TIME.hot, b * 0.8 * k);
    }
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y, this.radius * 1.6, TIME.mid, { intensity: 0.3 * this.k });
  }
}

// ------------------------------------------------------------------ steam lane
/**
 * A lane of scalding steam (from a telegraphed vent): hurts the keeper standing in
 * it for its short life. Bullet-clears blow it away.
 */
export class SteamLane extends Entity {
  angle: number;
  len: number;
  width: number;
  life: number;
  source: string;
  constructor(x: number, y: number, angle: number, len: number, width: number, source: string, life = 0.55) {
    super();
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.len = len;
    this.width = width;
    this.source = source;
    this.life = life;
    this.layer = 0;
    this.tileCollide = false;
    this.enemyHazard = true;
  }

  override onCleared(_w?: World): void {
    this.dead = true;
  }

  /** Is (px, py) inside the lane (with `pad` extra width)? */
  contains(px: number, py: number, pad = 0): boolean {
    const dx = px - this.x;
    const dy = py - this.y;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const along = dx * c + dy * s;
    const perp = Math.abs(-dx * s + dy * c);
    return along >= -2 && along <= this.len && perp <= this.width / 2 + pad;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.age >= this.life) {
      this.dead = true;
      return;
    }
    const p = w.player;
    if (p.alive && p.z < 8 && this.contains(p.x, p.y, p.r * 0.4)) p.hurt(w, 1, this.source);
    // billowing steam along the lane
    const n = Math.ceil(this.len / 10);
    for (let i = 0; i < n; i++) {
      if (!fx.chance(dt * 9)) continue;
      const d = fx.next() * this.len;
      const off = fx.range(-this.width / 2, this.width / 2) * 0.7;
      const c = Math.cos(this.angle);
      const s = Math.sin(this.angle);
      w.particles.spawn({
        x: this.x + c * d - s * off, y: this.y + s * d + c * off, vx: c * 40 + fx.range(-8, 8), vy: s * 40 - fx.range(6, 16), life: fx.range(0.4, 0.8), drag: 2.5,
        size: fx.range(2, 4), sizeEnd: 7, colors: ['#fff8f0', '#d8ccd0', '#8a7e8c'], shape: 'circle', alpha: 0.55,
      });
    }
  }

  override draw(r: Renderer): void {
    const t = this.age / this.life;
    const a = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
    const c = r.ctx;
    c.save();
    c.translate(Math.round(this.x - r.viewX), Math.round(this.y - r.viewY));
    c.rotate(this.angle);
    c.globalAlpha = 0.32 * a;
    c.fillStyle = '#e8dcd8';
    c.fillRect(0, -this.width / 2, this.len, this.width);
    c.globalAlpha = 0.28 * a;
    c.fillStyle = '#ffffff';
    c.fillRect(0, -this.width / 4, this.len * 0.9, this.width / 2);
    c.restore();
  }
}

// ------------------------------------------------------------------ ricochet path
export interface PathSeg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  angle: number;
}

/**
 * The path a rolling thing of radius `r` takes from (x, y) along `angle`, bouncing
 * off blocking tiles (walls, rocks, pits) up to `segments` times or `maxLen` px.
 */
export function bouncePath(room: BlockQuery, x: number, y: number, angle: number, r: number, segments: number, maxLen: number, step = 4): PathSeg[] {
  const out: PathSeg[] = [];
  let a = angle;
  let total = 0;
  for (let s = 0; s < segments && total < maxLen; s++) {
    const x0 = x;
    const y0 = y;
    let d = 0;
    while (total + d + step <= maxLen) {
      const nx = x + Math.cos(a) * step;
      const ny = y + Math.sin(a) * step;
      if (room.boxBlocked(nx, ny, r, false, false)) break;
      x = nx;
      y = ny;
      d += step;
    }
    total += d;
    out.push({ x0, y0, x1: x, y1: y, angle: a });
    if (total >= maxLen) break;
    a = reflectAngle(room, x, y, a, r, step);
    if (d === 0 && s > 0) break;
  }
  return out;
}

/** Angle after bouncing at (x, y): mirrored on the blocked axis (both when cornered). */
export function reflectAngle(room: BlockQuery, x: number, y: number, a: number, r: number, step = 4): number {
  const bx = room.boxBlocked(x + Math.cos(a) * step, y, r, false, false);
  const by = room.boxBlocked(x, y + Math.sin(a) * step, r, false, false);
  if (bx && !by) return Math.PI - a;
  if (by && !bx) return -a;
  return a + Math.PI;
}

// ------------------------------------------------------------------ effects
/** Brass sparks flying off metal. */
export function sparks(w: World, x: number, y: number, n = 6, speed = 90): void {
  w.particles.burst(x, y, { count: n, speed: [speed * 0.4, speed], life: [0.15, 0.4], colors: SPARK, size: [1, 1], shape: 'spark', gravity: 300, vz: [20, 80], additive: true, light: 5 });
}

/** Porcelain shards: cream chips tumbling on the floor. */
export function shards(w: World, x: number, y: number, n = 8, speed = 80): void {
  w.particles.burst(x, y, { count: n, speed: [speed * 0.3, speed], life: [0.35, 0.7], colors: [PORC[3], PORC[2], PORC[1]], size: [1, 3], shape: 'square', gravity: 320, vz: [40, 120], bounce: 0.35, vrot: 9 });
}

/** A coil spring pops out and bounces away (particles). */
export function springPop(w: World, x: number, y: number, n = 3): void {
  for (let i = 0; i < n; i++) {
    const a = fx.angle();
    w.particles.spawn({
      x, y, vx: Math.cos(a) * fx.range(30, 70), vy: Math.sin(a) * fx.range(30, 70), vz: fx.range(80, 150), gravity: 400, bounce: 0.5, life: fx.range(0.6, 1), drag: 1,
      colors: [BRASS[4], BRASS[3]], size: 2, shape: 'square', vrot: fx.range(-12, 12),
    });
  }
}

/** Little wind-up key (seen from above, pointing up) at (x, y) — used by several sprites. */
export function paintKey(p: PixelPainter, x: number, y: number, turn = 0, ramp = BRASS): void {
  // shaft
  p.rect(x, y - 2, 1, 3, ramp[3]);
  // bow: a flat loop that turns (0 = flat, 1 = edge-on)
  const wdt = turn ? 1 : 3;
  p.rect(x - Math.floor(wdt / 2), y - 5, wdt, 3, ramp[2]);
  p.rect(x - Math.floor(wdt / 2), y - 5, wdt, 1, ramp[5]);
  if (!turn) p.px(x, y - 4, ramp[0]);
}
