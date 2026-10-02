// Small animation helpers for UI: critically-damped springs, value trackers
// that "pop" when a number changes, and envelope / easing shortcuts.

import { clamp, ease } from '../engine/math';

/** Spring toward a target (semi-implicit Euler). Good for cursors and panels. */
export class Spring {
  value: number;
  target: number;
  vel = 0;
  stiffness: number;
  damping: number;

  constructor(value = 0, stiffness = 260, damping = 26) {
    this.value = value;
    this.target = value;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  set(v: number): void {
    this.value = this.target = v;
    this.vel = 0;
  }

  update(dt: number): number {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = (this.target - this.value) * this.stiffness - this.vel * this.damping;
      this.vel += a * h;
      this.value += this.vel * h;
    }
    return this.value;
  }
}

/** Exponential approach (frame-rate independent). */
export function follow(cur: number, target: number, rate: number, dt: number): number {
  return target + (cur - target) * Math.exp(-rate * dt);
}

/**
 * Tracks a number and remembers how it changed: `pop` (0..1, decays) and the
 * sign / amount of the last change. Used for counters, hearts and stats.
 */
export class ChangeTracker {
  value: number;
  /** 1 right after a change, decays to 0 */
  pop = 0;
  /** +1 increase, -1 decrease, 0 none yet */
  dir = 0;
  /** amount of the last change (accumulates while popping) */
  delta = 0;
  /** seconds since the last change */
  age = 99;
  private decay: number;
  private initialized = false;

  constructor(value = 0, decay = 3) {
    this.value = value;
    this.decay = decay;
  }

  /** Feed the current value; returns true when it changed. */
  update(v: number, dt: number): boolean {
    this.age += dt;
    this.pop = Math.max(0, this.pop - dt * this.decay);
    if (!this.initialized) {
      this.initialized = true;
      this.value = v;
      return false;
    }
    if (Math.abs(v - this.value) < 1e-6) return false;
    const d = v - this.value;
    if (this.age > 1.2 || Math.sign(d) !== this.dir) this.delta = 0;
    this.delta += d;
    this.dir = Math.sign(d);
    this.value = v;
    this.pop = 1;
    this.age = 0;
    return true;
  }

  /** Reset without producing a pop (e.g. new run). */
  reset(v: number): void {
    this.value = v;
    this.pop = 0;
    this.dir = 0;
    this.delta = 0;
    this.age = 99;
    this.initialized = true;
  }
}

/** Scale factor for a "pop" bump: 1 -> 1+amount -> 1 with overshoot. */
export function popScale(pop: number, amount = 0.35): number {
  if (pop <= 0) return 1;
  const t = 1 - pop; // 0 at change
  if (t < 0.15) return 1 + amount * ease.outQuad(t / 0.15);
  return 1 + amount * (1 - ease.outBack(clamp((t - 0.15) / 0.85, 0, 1)));
}

/** Envelope 0..1: fade in over `a`, hold until `total - b`, fade out over `b`. */
export function envelope(t: number, total: number, a: number, b: number): number {
  if (t < 0 || t > total) return 0;
  if (t < a) return t / a;
  if (t > total - b) return clamp((total - t) / b, 0, 1);
  return 1;
}

/** Eased 0..1 progress of `t` over `dur` seconds (after `delay`). */
export function appear(t: number, dur: number, delay = 0, fn: (x: number) => number = ease.outCubic): number {
  return fn(clamp((t - delay) / dur, 0, 1));
}

/** 0..1 sine pulse with frequency `hz`. */
export function pulse(t: number, hz = 1): number {
  return 0.5 + 0.5 * Math.sin(t * hz * Math.PI * 2);
}

/** Heartbeat curve (double thump per period) 0..1. */
export function heartbeat(t: number, period = 0.9): number {
  const p = (t % period) / period;
  const thump = (c: number, w: number) => Math.max(0, 1 - Math.abs(p - c) / w);
  return Math.max(thump(0.08, 0.08), thump(0.26, 0.08) * 0.7);
}

/** Held-key auto-repeat: returns true on the press and then every `rate` s after `delay`. */
export class Repeater {
  private t = 0;
  private held = false;
  constructor(private delay = 0.32, private rate = 0.07) {}
  update(isHeld: boolean, dt: number): boolean {
    if (!isHeld) {
      this.held = false;
      this.t = 0;
      return false;
    }
    if (!this.held) {
      this.held = true;
      this.t = -this.delay;
      return true;
    }
    this.t += dt;
    if (this.t >= this.rate) {
      this.t -= this.rate;
      return true;
    }
    return false;
  }
}
