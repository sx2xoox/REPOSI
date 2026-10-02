// Visual-only entities: floating numbers/text, one-shot animations, ground
// warnings (telegraphed attack areas), shockwave rings, afterimages.

import { Entity } from './entity';
import type { World } from './world';
import type { Renderer } from '../engine/renderer';
import { animDuration, animFrame, getSprite } from '../engine/sprites';
import { clamp, ease, TAU } from '../engine/math';
import { fx } from '../engine/rng';

export class FloatingText extends Entity {
  text: string;
  color: string;
  life: number;
  scale: number;
  constructor(x: number, y: number, text: string, color = '#ffffff', scale = 1, life = 0.7) {
    super();
    this.x = x + fx.range(-3, 3);
    this.y = y;
    this.text = text;
    this.color = color;
    this.scale = scale;
    this.life = life;
    this.vy = -55;
    this.vx = fx.range(-15, 15);
    this.layer = 2;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += 120 * dt;
    this.vx *= Math.exp(-dt * 4);
    if (this.age >= this.life) this.dead = true;
  }

  override draw(r: Renderer): void {
    const t = this.age / this.life;
    const pop = this.age < 0.08 ? 1 + (1 - this.age / 0.08) * 0.6 : 1;
    r.pixelText(this.text, this.x, this.y, this.color, {
      align: 'center',
      outline: '#140c1c',
      scale: Math.max(1, Math.round(this.scale * pop)),
      alpha: t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1,
    });
  }
}

/** Plays an animation (or static sprite) once, then disappears. */
export class AnimEffect extends Entity {
  anim: string;
  duration: number;
  rot: number;
  scale: number;
  additive: boolean;
  lightR: number;
  lightColor: string;
  follow: Entity | null = null;
  constructor(anim: string, x: number, y: number, o: { duration?: number; rot?: number; scale?: number; layer?: number; additive?: boolean; light?: number; lightColor?: string } = {}) {
    super();
    this.anim = anim;
    this.x = x;
    this.y = y;
    this.duration = o.duration ?? (animDuration(anim) || 0.3);
    this.rot = o.rot ?? 0;
    this.scale = o.scale ?? 1;
    this.layer = o.layer ?? 2;
    this.additive = o.additive ?? false;
    this.lightR = o.light ?? 0;
    this.lightColor = o.lightColor ?? '#ffd080';
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.follow) {
      this.x = this.follow.x;
      this.y = this.follow.y;
    }
    if (this.age >= this.duration) this.dead = true;
  }

  override draw(r: Renderer): void {
    r.sprite(animFrame(this.anim, this.age), this.x, this.y - this.z, { rot: this.rot, sx: this.scale, sy: this.scale, additive: this.additive });
  }

  override light(w: World): void {
    if (this.lightR > 0) w.lights.add(this.x, this.y, this.lightR * (1 - this.age / this.duration), this.lightColor);
  }
}

/**
 * Telegraphed danger zone drawn on the floor. Calls `onDone` when the timer expires
 * (typically to deal damage in the area).
 */
export class GroundWarning extends Entity {
  radius: number;
  time: number;
  color: string;
  onDone?: (w: World) => void;
  /** rectangle mode (w/h) instead of circle */
  rw = 0;
  rh = 0;
  angle = 0;
  constructor(x: number, y: number, radius: number, time: number, onDone?: (w: World) => void, color = '#ff3040') {
    super();
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.time = time;
    this.onDone = onDone;
    this.color = color;
    this.layer = 0;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.age >= this.time) {
      this.dead = true;
      this.onDone?.(w);
    }
  }

  override draw(r: Renderer): void {
    const t = clamp(this.age / this.time, 0, 1);
    const blink = 0.25 + 0.2 * Math.sin(this.age * 25);
    if (this.rw > 0) {
      const c = r.ctx;
      c.save();
      c.translate(Math.round(this.x - r.viewX), Math.round(this.y - r.viewY));
      c.rotate(this.angle);
      c.globalAlpha = blink;
      c.fillStyle = this.color;
      c.fillRect(0, -this.rh / 2, this.rw, this.rh);
      c.globalAlpha = 0.6;
      c.fillRect(0, -this.rh / 2, this.rw * t, this.rh);
      c.restore();
      return;
    }
    r.circle(this.x, this.y, this.radius, this.color, blink * 0.6);
    r.circle(this.x, this.y, this.radius * ease.outCubic(t), this.color, 0.35);
    r.ring(this.x, this.y, this.radius, this.color, 1, 0.9);
  }
}

/** Expanding ring (shockwaves, pickups). Purely visual. */
export class RingFx extends Entity {
  radius: number;
  maxR: number;
  dur: number;
  color: string;
  width: number;
  constructor(x: number, y: number, maxR: number, dur = 0.35, color = '#ffffff', width = 2) {
    super();
    this.x = x;
    this.y = y;
    this.radius = 1;
    this.maxR = maxR;
    this.dur = dur;
    this.color = color;
    this.width = width;
    this.layer = 2;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    this.radius = 1 + (this.maxR - 1) * ease.outCubic(Math.min(1, this.age / this.dur));
    if (this.age >= this.dur) this.dead = true;
  }

  override draw(r: Renderer): void {
    const t = this.age / this.dur;
    r.ring(this.x, this.y, this.radius, this.color, Math.max(1, this.width * (1 - t)), 1 - t);
  }
}

/** Fading copy of a sprite (dash afterimages). */
export class Afterimage extends Entity {
  sprite: string;
  flipX: boolean;
  dur: number;
  color: string;
  constructor(sprite: string, x: number, y: number, flipX: boolean, color = '#7ad0ff', dur = 0.25) {
    super();
    this.sprite = sprite;
    this.x = x;
    this.y = y;
    this.flipX = flipX;
    this.color = color;
    this.dur = dur;
    this.layer = 1;
    this.tileCollide = false;
  }

  override get sortY(): number {
    return this.y - 1;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.age >= this.dur) this.dead = true;
  }

  override draw(r: Renderer): void {
    r.sprite(this.sprite, this.x, this.y, { flipX: this.flipX, alpha: 0.5 * (1 - this.age / this.dur), tint: this.color, tintAmount: 1 });
  }
}

/** Instant laser / beam visual between two points (damage is applied by the caller). */
export class BeamFx extends Entity {
  x2: number;
  y2: number;
  width: number;
  color: string;
  core: string;
  dur: number;
  constructor(x: number, y: number, x2: number, y2: number, width: number, color: string, dur = 0.15, core = '#ffffff') {
    super();
    this.x = x;
    this.y = y;
    this.x2 = x2;
    this.y2 = y2;
    this.width = width;
    this.color = color;
    this.core = core;
    this.dur = dur;
    this.layer = 2;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.age >= this.dur) this.dead = true;
  }

  override draw(r: Renderer): void {
    const t = 1 - this.age / this.dur;
    r.line(this.x, this.y, this.x2, this.y2, this.color, this.width * t + 1, 0.9);
    r.line(this.x, this.y, this.x2, this.y2, this.core, Math.max(1, this.width * 0.4 * t), 1);
  }

  override light(w: World): void {
    const n = Math.max(1, Math.floor(Math.hypot(this.x2 - this.x, this.y2 - this.y) / 40));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      w.lights.add(this.x + (this.x2 - this.x) * k, this.y + (this.y2 - this.y) * k, 26, this.color.slice(0, 7), { intensity: 0.7 });
    }
  }
}

/** Little decorative torch on a wall (theme decoration). */
export class Torch extends Entity {
  color: string;
  constructor(x: number, y: number, color = '#ffb050') {
    super();
    this.x = x;
    this.y = y;
    this.color = color;
    this.layer = 0;
    this.tileCollide = false;
    this.age = fx.range(0, 10);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (fx.chance(dt * 8)) {
      w.particles.spawn({
        x: this.x + fx.range(-1.5, 1.5), y: this.y - 6, vy: -fx.range(10, 25), vx: fx.range(-4, 4), life: fx.range(0.3, 0.6),
        colors: ['#fff0a0', this.color, '#a03010'], size: 1, additive: true,
      });
    }
  }

  override draw(r: Renderer): void {
    const flick = Math.floor(this.age * 10) % 3;
    r.rect(this.x - 1, this.y - 3, 3, 6, '#3a2a1a');
    r.rect(this.x - 2, this.y - 4, 5, 2, '#5a4a3a');
    r.rect(this.x - 1, this.y - 8 - flick, 3, 4 + flick, this.color);
    r.rect(this.x, this.y - 7 - flick, 1, 3, '#fff0b0');
  }

  override light(w: World): void {
    const fl = 1 + Math.sin(this.age * 13) * 0.06 + Math.sin(this.age * 31) * 0.04;
    w.lights.add(this.x, this.y - 4, 70 * fl, this.color, { intensity: 0.85 });
  }
}

export function spriteSize(name: string): { w: number; h: number } {
  const s = getSprite(name);
  return { w: s.w, h: s.h };
}

export { TAU };
