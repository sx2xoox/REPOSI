// Shared toolkit for the floor 7 bosses (시계장인, 태엽 무희) — 멈춘 태엽탑:
//  - the clockwork-spire palette (aged brass, verdigris, cream porcelain, warm amber,
//    plum shadow, porcelain rose) and three high-contrast bullet families
//  - time tricks as projectile behaviors: `tickFreeze` (a shot stops mid-flight and only
//    moves again on the clock's next tick) and `rewind` (a shot flies back along its own
//    path, telegraphed by afterimages)
//  - ClockHand: a giant clock hand sweeping the arena as a blade (dial telegraph first)
//  - TimeWell: a slow-time zone on the floor
//  - pure helpers (tick arithmetic, pin rows with a gap) — unit-tested in tests/bosses7.test.ts
// Only lazily-compiled sprites are defined here, so the module is safe in node tests.

import { Entity } from '../../game/entity';
import type { World } from '../../game/world';
import type { Enemy, ShootOpts } from '../../game/enemy';
import type { Renderer } from '../../engine/renderer';
import type { ProjBehavior } from '../../game/projectile';
import { defineDrawnSprite, hasSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { angleDiff, clamp, distToSegment, TAU } from '../../engine/math';
import { WARN_RED } from '../enemies/shared';
import { beamToWall, summonMinion as summonBase } from './final-kit';

// ================================================================== palette
/** darkest -> lightest */
export const BRASS7 = ['#2a1808', '#5c3a12', '#9c6a22', '#d4a040', '#f2d078', '#fff4c0'];
export const VERD = ['#0a2e2a', '#145048', '#237a6a', '#3aa88e', '#6ad8b8', '#b8fff0'];
export const PORC = ['#5a504c', '#948478', '#c4b8a8', '#e4dccc', '#f6f0e4', '#fffdf6'];
export const AMBER = ['#6a2c06', '#b85a12', '#ec9a2c', '#ffcc60', '#fff0b8'];
export const PLUM = ['#100818', '#22122e', '#3a2048', '#563268', '#78508c'];
export const ROSE = ['#5a1430', '#a0264e', '#e0507e', '#ff8fb4', '#ffd0e0'];
export const OUTLINE7 = '#0e0814';

// ================================================================== bullets
export interface BulletPal7 {
  color: string;
  core: string;
  rim: string;
  outline: string;
}

/** Floor-7 enemy bullet palettes: hot brass, verdigris glass, porcelain rose. */
export const BUL7 = {
  brass: { color: '#ffb438', core: '#fff6dc', rim: '#9a3c0c', outline: '#200a02' },
  verd: { color: '#5cf2cc', core: '#f0fffa', rim: '#0e6a58', outline: '#031a14' },
  rose: { color: '#ff6ea6', core: '#fff2f6', rim: '#a01c50', outline: '#22040e' },
} satisfies Record<string, BulletPal7>;
export type BulletKind7 = keyof typeof BUL7;

/** Lazily define a round floor-7 bullet sprite of diameter `d` (bright core, dark rim, outline). */
export function bulletSprite7(kind: BulletKind7, d: number): string {
  d = Math.max(3, Math.min(15, Math.round(d)));
  const name = `__ebul7_${kind}_${d}`;
  if (hasSprite(name)) return name;
  const pal = BUL7[kind];
  defineDrawnSprite(name, d, d, (p) => {
    const r = d / 2;
    p.circle(r, r, r, pal.rim);
    p.circle(r - 0.35, r - 0.35, r - 1, pal.color);
    p.circle(r - 0.8, r - 0.8, Math.max(0.8, r * 0.5), pal.core);
    p.px(Math.floor(r - r * 0.55), Math.floor(r - r * 0.55), '#ffffff');
  }, { outline: pal.outline });
  return name;
}

/** Shoot options for a readable floor-7 bullet of collision radius `size`. */
export function bullet7<T extends ShootOpts>(kind: BulletKind7, size = 3, extra: T = {} as T): ShootOpts & T {
  return {
    color: BUL7[kind].color,
    sprite: bulletSprite7(kind, size * 2 + 1),
    spriteRotates: false,
    radius: size,
    light: 14 + size * 2,
    ...extra,
  };
}

/** Lazily define a brass cog sprite of outer diameter `d` (teeth included). */
export function gearSprite(d: number, lit = false): string {
  d = Math.max(7, Math.min(21, Math.round(d))) | 1;
  const name = `__gear7_${d}_${lit ? 'l' : 'd'}`;
  if (hasSprite(name)) return name;
  defineDrawnSprite(name, d, d, (p) => {
    const c = d / 2;
    const r = c - 1.6;
    paintGear(p, c, c, r, Math.max(6, Math.round(d * 0.5)), 0, BRASS7, lit ? AMBER[3] : undefined);
  }, { outline: OUTLINE7 });
  return name;
}

/**
 * Paint a cog: shaded disc, `teeth` teeth of ~1.6px, a dark hub (optionally lit).
 * `phase` (0..1) rotates the teeth — step it per frame for turning gears.
 */
export function paintGear(p: { px(x: number, y: number, c: string | null): void; isSet(x: number, y: number): boolean }, cx: number, cy: number, r: number, teeth: number, phase: number, cols: readonly string[], hub?: string): void {
  const rr = r + 1.6;
  for (let y = Math.floor(cy - rr - 1); y <= Math.ceil(cy + rr + 1); y++) {
    for (let x = Math.floor(cx - rr - 1); x <= Math.ceil(cx + rr + 1); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d > rr) continue;
      if (d > r) {
        // tooth?
        const a = Math.atan2(dy, dx);
        const k = ((a / TAU) * teeth + phase * teeth) % 1;
        if (((k + 1) % 1) > 0.5) continue;
      }
      // light from the top-left
      const l = clamp(0.5 - (dx + dy) / (r * 2.2), 0, 0.999);
      const idx = Math.min(cols.length - 1, Math.floor(l * (cols.length - 1)) + 1);
      p.px(x, y, cols[idx]);
    }
  }
  const hr = Math.max(1, r * 0.3);
  for (let y = Math.floor(cy - hr); y <= Math.ceil(cy + hr); y++) {
    for (let x = Math.floor(cx - hr); x <= Math.ceil(cx + hr); x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= hr) p.px(x, y, hub ?? cols[0]);
    }
  }
}

// ================================================================== time tricks (pure)
/**
 * Time of the first clock tick at or after `now + minDelay`, given the clock
 * last ticked at `lastTick` and ticks every `period` seconds.
 */
export function nextTick(now: number, lastTick: number, period: number, minDelay = 0): number {
  const target = now + minDelay;
  const k = Math.max(1, Math.ceil((target - lastTick) / period - 1e-9));
  return lastTick + k * period;
}

/** `n` slots evenly spaced along the row (x0, y) -> (x1, y), skipping the `gapW` slots from `gapStart`. */
export function rowWithGap(x0: number, x1: number, y: number, n: number, gapStart: number, gapW: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (n <= 0) return out;
  for (let i = 0; i < n; i++) {
    if (i >= gapStart && i < gapStart + gapW) continue;
    out.push({ x: n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1), y });
  }
  return out;
}

/** Slot index of the `gapW`-wide hole that keeps a point at `px` (within x0..x1) covered by the hole — or the nearest legal one. */
export function gapSlotFor(x0: number, x1: number, n: number, gapW: number, px: number): number {
  if (n <= gapW) return 0;
  const t = clamp((px - x0) / (x1 - x0 || 1), 0, 1);
  const slot = Math.round(t * (n - 1));
  return clamp(slot - Math.floor(gapW / 2), 0, n - gapW);
}

// ================================================================== projectile behaviors
export interface FreezeOpts {
  /** seconds of flight before the shot stops */
  after: number;
  /** world time at which it moves again (a clock tick) */
  resumeAt: number;
  /** re-aim at the keeper when released (+ `off` radians) */
  reaim?: boolean;
  off?: number;
  /** speed after release (default: its speed before freezing) */
  speed?: number;
}

/**
 * The shot flies for `after` seconds, freezes in place (a ticking verdigris ring marks
 * it) and resumes at `resumeAt` — the clock's next tick. Frozen shots still hurt.
 */
export function tickFreeze(o: FreezeOpts): ProjBehavior {
  return {
    id: 'tick-freeze',
    update(p, w) {
      const st = p.mem.fz ?? 0;
      if (st === 0) {
        if (p.age >= o.after) {
          p.mem.fz = 1;
          p.mem.fzSpeed = p.speed;
          p.speed = 0;
          p.syncVel();
        }
      } else if (st === 1 && w.time >= o.resumeAt) {
        p.mem.fz = 2;
        p.speed = o.speed ?? p.mem.fzSpeed;
        if (o.reaim) {
          const t = w.player;
          p.angle = Math.atan2(t.y - 4 - p.y, t.x - p.x) + (o.off ?? 0);
        }
        p.syncVel();
      }
    },
    draw(p, r, w) {
      if (p.mem.fz !== 1) return;
      const left = o.resumeAt - w.time;
      const soon = left < 0.35 && Math.floor(p.age * 16) % 2 === 0;
      const y = p.y - p.z;
      r.ring(p.x, y, p.r + 3 + Math.sin(p.age * 9) * 0.8, VERD[5], 1, soon ? 0.95 : 0.5);
      // a tiny clock hand ticking round the frozen shot
      const a = -Math.PI / 2 + Math.floor(p.age * 8) * (TAU / 8);
      r.line(p.x, y, p.x + Math.cos(a) * (p.r + 3), y + Math.sin(a) * (p.r + 3), VERD[4], 1, soon ? 0.9 : 0.45);
      if (soon) r.circle(p.x, y, p.r + 1, '#ffffff', 0.25);
    },
  };
}

/**
 * At world time `at` the shot turns around and flies back along its path until it
 * reaches where it was fired. Afterimages behind it announce the rewind. A shot that
 * meets a wall first waits there, pressed against it, until the rewind.
 */
export function rewind(at: number): ProjBehavior {
  return {
    id: 'rewind',
    update(p, w) {
      if (p.mem.rw === undefined) {
        p.mem.rw = 0;
        p.mem.rx = p.x;
        p.mem.ry = p.y;
      }
      if ((p.mem.rw === 0 || p.mem.rw === 3) && w.time >= at) {
        if (p.mem.rw === 3) p.speed = p.mem.rwSpeed;
        p.mem.rw = 1;
        p.angle += Math.PI;
        p.syncVel();
        p.mem.rwd = Math.hypot(p.x - p.mem.rx, p.y - p.mem.ry) + 1;
      } else if (p.mem.rw === 1) {
        const d = Math.hypot(p.x - p.mem.rx, p.y - p.mem.ry);
        if (d < 6 || d > p.mem.rwd + 0.5) {
          p.expire(w, false);
          return;
        }
        p.mem.rwd = d;
      }
    },
    onWall(p) {
      // on the way out: stop against the wall and wait for the rewind; on the way back: leaving the wall tile
      if (p.mem.rw === 0) {
        p.mem.rw = 3;
        p.mem.rwSpeed = p.speed;
        p.speed = 0;
        p.syncVel();
      }
      return p.mem.rw === 3 || p.mem.rw === 1;
    },
    draw(p, r, w) {
      const spr = p.sprite;
      if (!spr) return;
      const y = p.y - p.z;
      const c = Math.cos(p.angle);
      const s = Math.sin(p.angle);
      if (p.mem.rw === 0 || p.mem.rw === 3) {
        const left = at - w.time;
        if (left > 0.6) return;
        // afterimages trailing back toward where it came from: "it will come back this way"
        const k = clamp(1 - left / 0.6, 0, 1);
        const blink = Math.floor(p.age * 14) % 2 === 0;
        for (let i = 1; i <= 3; i++) r.sprite(spr, p.x - c * i * 9, y - s * i * 9, { alpha: (0.55 - i * 0.13) * k * (blink ? 1 : 0.6) });
        r.ring(p.x, y, p.r + 3, AMBER[3], 1, (blink ? 0.85 : 0.35) * k);
      } else if (p.mem.rw === 1) {
        for (let i = 1; i <= 2; i++) r.sprite(spr, p.x - c * i * 7, y - s * i * 7, { alpha: 0.32 - i * 0.1 });
      }
    },
  };
}

// ================================================================== dial telegraph
/** A faint clock dial on the floor: ring + 12 ticks (quarters longer). */
export function drawDial(r: Renderer, x: number, y: number, R: number, color: string, alpha: number, rot = 0): void {
  r.ring(x, y, R, color, 1, alpha);
  for (let i = 0; i < 12; i++) {
    const a = rot + (i / 12) * TAU;
    const len = i % 3 === 0 ? 6 : 3;
    r.line(x + Math.cos(a) * (R - len), y + Math.sin(a) * (R - len), x + Math.cos(a) * (R - 1), y + Math.sin(a) * (R - 1), color, i % 3 === 0 ? 2 : 1, alpha);
  }
}

// ================================================================== clock hand
export interface HandOpts {
  source: string;
  /** dial telegraph time (not yet lethal) */
  warn: number;
  /** lethal sweep time */
  duration: number;
  /** angular speed rad/s (sign = direction) */
  omega: number;
  /** half width of the blade */
  half?: number;
  /** number of hands */
  hands?: number;
  /** angle between hands (default: evenly spaced) */
  spacing?: number;
  damage?: number;
  rehit?: number;
}

/**
 * The spire's clock hand, grown huge: a brass blade from the clockmaker's dial to the
 * wall that sweeps round the arena. A dial overlay shows where it starts and which way
 * it turns before it becomes lethal.
 */
export class ClockHand extends Entity {
  owner: Enemy;
  angle: number;
  o: HandOpts;
  private hitT = -9;
  mem?: Record<string, number>;
  constructor(owner: Enemy, angle: number, o: HandOpts) {
    super();
    this.owner = owner;
    this.angle = angle;
    this.o = o;
    this.x = owner.x;
    this.y = owner.y + 2;
    this.layer = 0;
    this.tileCollide = false;
    this.team = 'enemy';
  }

  get on(): boolean {
    return this.age >= this.o.warn && this.age < this.o.warn + this.o.duration;
  }

  get fading(): boolean {
    return this.age >= this.o.warn + this.o.duration;
  }

  get half(): number {
    return this.o.half ?? 5;
  }

  angles(): number[] {
    const n = this.o.hands ?? 1;
    const sp = this.o.spacing ?? TAU / n;
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(this.angle + i * sp);
    return out;
  }

  override update(w: World, dt: number): void {
    const o = this.owner;
    if (!o.alive) {
      this.dead = true;
      return;
    }
    this.x = o.x;
    this.y = o.y + 2;
    const wasOn = this.on;
    this.age += dt;
    const op = this.o;
    if (this.on && !wasOn) {
      w.sfx('clockboss_sweep', { vol: 0.9, pitch: 0.8 });
      w.sfx('clockboss_tick', { vol: 0.8, pitch: 0.7 });
      w.shake(0.2);
    }
    if (this.on) {
      this.angle += op.omega * dt;
      for (const p of w.targets()) {
        const lastHit = w.coop ? this.mem?.[`hit:${p.slot}`] ?? -9 : this.hitT;
        if (p.alive && p.z < 10 && w.time - lastHit >= (op.rehit ?? 0.8)) {
          for (const a of this.angles()) {
            const len = beamToWall(w, this.x, this.y, a);
            const c = Math.cos(a);
            const s = Math.sin(a);
            if (distToSegment(p.x, p.y - 2, this.x + c * 16, this.y + s * 16, this.x + c * len, this.y + s * len) > this.half + p.r * 0.6) continue;
            if (p.hurt(w, op.damage ?? 1, op.source)) {
              if (w.coop) (this.mem ??= {})[`hit:${p.slot}`] = w.time;
              else this.hitT = w.time;
              // thrown along the sweep direction
              const dir = Math.sign(op.omega) || 1;
              p.knock(-s * dir, c * dir, 210);
            }
            break;
          }
        }
      }
      // sparks grinding along the floor at each tip
      for (const a of this.angles()) {
        if (!fx.chance(0.6)) continue;
        const len = beamToWall(w, this.x, this.y, a);
        const k = fx.range(0.5, 1);
        w.particles.spawn({
          x: this.x + Math.cos(a) * len * k, y: this.y + Math.sin(a) * len * k, vx: -Math.sin(a) * op.omega * 30, vy: Math.cos(a) * op.omega * 30, vz: fx.range(20, 60), gravity: 300,
          life: fx.range(0.2, 0.4), colors: [AMBER[4], AMBER[3], BRASS7[4]], size: 1, additive: true, light: 3,
        });
      }
    }
    if (this.age >= op.warn + op.duration + 0.3) this.dead = true;
  }

  override draw(r: Renderer, w: World): void {
    const op = this.o;
    const c = r.ctx;
    const vx = r.viewX;
    const vy = r.viewY;
    if (this.age < op.warn) {
      // telegraph: the dial, the hand's ghost at its start angle and a red wedge the way it will turn
      const t = clamp(this.age / op.warn, 0, 1);
      const blink = 0.45 + 0.25 * Math.sin(this.age * 22);
      drawDial(r, this.x, this.y, 60, BRASS7[4], 0.35 + 0.2 * t, -Math.PI / 2);
      drawDial(r, this.x, this.y, 110, BRASS7[3], 0.18 + 0.12 * t, -Math.PI / 2);
      c.save();
      for (const a of this.angles()) {
        const len = beamToWall(w, this.x, this.y, a);
        const dir = Math.sign(op.omega) || 1;
        const span = 0.8 * ease(t);
        c.globalAlpha = blink * 0.9;
        c.fillStyle = WARN_RED;
        c.beginPath();
        c.moveTo(this.x - vx, this.y - vy);
        c.arc(this.x - vx, this.y - vy, len, Math.min(a, a + dir * span), Math.max(a, a + dir * span));
        c.closePath();
        c.fill();
        r.line(this.x, this.y, this.x + Math.cos(a) * len, this.y + Math.sin(a) * len, blink > 0.5 ? '#ffffff' : WARN_RED, 2, 0.9);
        r.line(this.x, this.y, this.x + Math.cos(a) * len, this.y + Math.sin(a) * len, BRASS7[4], 1, 0.5 + 0.5 * t);
        // an arrow head showing the turn direction
        const ax = this.x + Math.cos(a + dir * span) * len * 0.8;
        const ay = this.y + Math.sin(a + dir * span) * len * 0.8;
        r.circle(ax, ay, 3, WARN_RED, blink + 0.3);
      }
      c.restore();
      return;
    }
    const fade = this.fading ? clamp(1 - (this.age - op.warn - op.duration) / 0.3, 0, 1) : 1;
    const dir = Math.sign(op.omega) || 1;
    c.save();
    for (const a of this.angles()) {
      const len = beamToWall(w, this.x, this.y, a);
      // the smear the blade just swept through
      c.globalAlpha = 0.22 * fade;
      c.fillStyle = AMBER[3];
      c.beginPath();
      c.moveTo(this.x - vx, this.y - vy);
      const back = a - dir * Math.abs(op.omega) * 0.16;
      c.arc(this.x - vx, this.y - vy, len, Math.min(a, back), Math.max(a, back));
      c.closePath();
      c.fill();
      const tx = this.x + Math.cos(a) * len;
      const ty = this.y + Math.sin(a) * len;
      // the hand: dark edge, brass body, bright spine, a diamond tip
      r.line(this.x, this.y, tx, ty, PLUM[0], this.half * 2 + 2, 0.9 * fade);
      r.line(this.x, this.y, tx, ty, BRASS7[3], this.half * 2 - 1, 0.95 * fade);
      r.line(this.x, this.y, tx, ty, BRASS7[5], 1.5, (0.6 + 0.3 * Math.sin(this.age * 40)) * fade);
      const k = 0.78;
      r.circle(this.x + Math.cos(a) * len * k, this.y + Math.sin(a) * len * k, this.half + 2, BRASS7[4], 0.9 * fade);
      r.circle(this.x + Math.cos(a) * len * k, this.y + Math.sin(a) * len * k, this.half - 1, '#ffffff', 0.9 * fade);
      r.circle(tx, ty, 3, AMBER[4], 0.8 * fade);
    }
    // the hub
    r.circle(this.x, this.y, this.half + 4, BRASS7[2], 0.9 * fade);
    r.ring(this.x, this.y, this.half + 4, BRASS7[5], 1, 0.9 * fade);
    c.restore();
  }

  override light(w: World): void {
    if (this.age < this.o.warn * 0.5) return;
    const on = this.on;
    for (const a of this.angles()) {
      const len = beamToWall(w, this.x, this.y, a);
      const n = Math.max(1, Math.floor(len / 40));
      for (let i = 1; i <= n; i++) {
        const k = (i / n) * len;
        w.lights.add(this.x + Math.cos(a) * k, this.y + Math.sin(a) * k, on ? 30 : 16, on ? '#ffc050' : '#ff6040', { intensity: on ? 0.8 : 0.3 });
      }
    }
  }
}

function ease(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

// ================================================================== time well
/**
 * 굼뜬 시간: a pool of slowed time on the floor. Arms after a short rise, then the
 * keeper standing in it moves at half speed. Erased by bullet-clears.
 */
export class TimeWell extends Entity {
  radius: number;
  life: number;
  slow: number;
  arm = 0.5;
  private cleared = false;
  constructor(x: number, y: number, radius: number, life: number, slow = 0.5) {
    super();
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.life = life;
    this.slow = slow;
    this.layer = 0;
    this.tileCollide = false;
    this.team = 'enemy';
    this.enemyHazard = true;
  }

  get fade(): number {
    return Math.max(0, Math.min(1, this.age / this.arm, (this.life - this.age) / 0.4));
  }

  get armed(): boolean {
    return !this.cleared && this.age > this.arm && this.age < this.life - 0.2;
  }

  /** Erased by a bullet-clear: disarms at once and fades out. */
  override onCleared(): void {
    this.cleared = true;
    this.life = Math.min(this.life, this.age + 0.25);
  }

  inside(x: number, y: number, slack = 0): boolean {
    const dx = x - this.x;
    const dy = (y - this.y) / 0.8;
    const rr = this.radius + slack;
    return dx * dx + dy * dy < rr * rr;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.age >= this.life) {
      this.dead = true;
      return;
    }
    const p = w.player;
    if (this.armed && p.alive && p.z < 6 && this.inside(p.x, p.y, p.r * 0.4)) {
      p.applyStatus({ kind: 'slow', duration: 0.14, power: this.slow }, () => 0);
    }
    // motes drifting very slowly inside: time is thick here
    if (fx.chance(dt * 6 * (this.radius / 30))) {
      const a = fx.angle();
      const d = fx.next() * this.radius * 0.85;
      w.particles.spawn({
        x: this.x + Math.cos(a) * d, y: this.y + Math.sin(a) * d * 0.8, vy: -fx.range(2, 5), life: fx.range(1.0, 1.8),
        colors: [VERD[5], VERD[4], BRASS7[4]], size: 1, additive: true, light: 3,
      });
    }
  }

  override draw(r: Renderer): void {
    const f = this.fade;
    if (f <= 0) return;
    const c = r.ctx;
    const R = this.radius;
    c.save();
    c.translate(this.x - r.viewX, this.y - r.viewY);
    c.scale(1, 0.8);
    c.globalAlpha = 0.22 * f;
    c.fillStyle = VERD[2];
    c.beginPath();
    c.arc(0, 0, R, 0, TAU);
    c.fill();
    c.globalAlpha = (this.armed ? 0.75 : 0.95) * f;
    c.strokeStyle = VERD[4];
    c.lineWidth = this.armed ? 1 : 2;
    c.beginPath();
    c.arc(0, 0, R, 0, TAU);
    c.stroke();
    // dial ticks and a hand that barely moves
    c.globalAlpha = 0.6 * f;
    c.strokeStyle = VERD[5];
    c.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const l = i % 3 === 0 ? 5 : 2;
      c.beginPath();
      c.moveTo(Math.cos(a) * (R - l), Math.sin(a) * (R - l));
      c.lineTo(Math.cos(a) * (R - 1), Math.sin(a) * (R - 1));
      c.stroke();
    }
    const ha = -Math.PI / 2 + this.age * 0.35;
    c.globalAlpha = 0.8 * f;
    c.strokeStyle = BRASS7[4];
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(Math.cos(ha) * R * 0.6, Math.sin(ha) * R * 0.6);
    c.stroke();
    c.restore();
    if (!this.armed) r.ring(this.x, this.y, R * 0.55 + (this.age / this.arm) * R * 0.4, VERD[5], 1, 0.7 * f);
    if (this.life - this.age < 0.6 && Math.floor(this.age * 12) % 2 === 0) r.ring(this.x, this.y, R * 0.9, VERD[5], 1, 0.5);
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y, this.radius * 2, '#40d0b0', { intensity: 0.4 * this.fade });
  }
}

// ================================================================== script helpers
/** Summon a minion owned by `e` — never after the boss has fallen. */
export function summonMinion7(e: Enemy, w: World, id: string, x: number, y: number, colors: string[]): Enemy | null {
  if (e.dead || e.hp <= 0) return null;
  return summonBase(e, w, id, x, y, colors);
}

/** Puff of brass filings + a glint where metal strikes. */
export function brassSparks(w: World, x: number, y: number, n = 8, speed = 90): void {
  w.particles.burst(x, y, { count: n, speed: [speed * 0.3, speed], life: [0.2, 0.45], colors: [AMBER[4], BRASS7[4], BRASS7[2]], size: [1, 2], gravity: 260, vz: [20, 80], additive: true, light: 3 });
}

/** Shards of cream porcelain / dial glass. */
export function porcelainShards(w: World, x: number, y: number, n = 14, speed = 120): void {
  w.particles.burst(x, y, { count: n, speed: [speed * 0.3, speed], life: [0.4, 0.9], colors: [PORC[5], PORC[3], VERD[4], BRASS7[3]], size: [1, 3], gravity: 320, vz: [40, 140], bounce: 0.3, shape: 'square', vrot: 9 });
}

/** Signed angular offset keeping `a` within ±`max` of `center`. */
export function clampAngle(a: number, center: number, max: number): number {
  return center + clamp(angleDiff(center, a), -max, max);
}
