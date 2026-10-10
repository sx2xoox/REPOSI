// Visual-only entities: floating numbers/text, one-shot animations, ground
// warnings (telegraphed attack areas), shockwave rings, afterimages.

import { Entity } from './entity';
import type { World } from './world';
import type { Renderer } from '../engine/renderer';
import { animDuration, animFrame, getSprite } from '../engine/sprites';
import { clamp, ease, TAU } from '../engine/math';
import { fx } from '../engine/rng';
import { dodgeCovers } from '../engine/worldtext';

/**
 * Health in float texts: no hearts, a tiny flame written after the number
 * ("-1" + flame). Warm for the lamp's own fire, blue for 푸른 불꽃.
 */
export const LIFE_ICON = 'fx_life_flame';
export const BLUE_FLAME_ICON = 'fx_blue_flame';
/** float text colors: life lost (warm red-orange), life gained (gold-orange), blue flame lost */
export const LIFE_HURT_TEXT = '#ff6a3a';
export const LIFE_HEAL_TEXT = '#ffb24a';
export const BLUE_FLAME_TEXT = '#a8c8ff';

export class FloatingText extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  text: string;
  color: string;
  life: number;
  scale: number;
  /** optional small sprite written right after the text (bottom-aligned, e.g. LIFE_ICON) */
  icon: string | null;
  constructor(x: number, y: number, text: string, color = '#ffffff', scale = 1, life = 0.7, icon: string | null = null) {
    super();
    this.x = x + fx.range(-3, 3);
    this.y = y;
    this.text = text;
    this.color = color;
    this.scale = scale;
    this.life = life;
    this.icon = icon;
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
    const s = Math.max(1, Math.round(this.scale * pop));
    const alpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
    // text + icon centered together; the icon's ink sits one glyph gap after the
    // text and shares its baseline (the icon's own origin is its ink bottom-left;
    // a Hangul text stands on the same baseline, see Renderer.pixelText)
    const tw = this.text ? r.pixelTextWidth(this.text, s) : -s;
    const iw = this.icon ? (getSprite(this.icon).w - 2) * s : 0;
    const total = this.icon ? tw + s + iw : tw;
    const th = Math.max(this.text ? r.pixelTextHeight(this.text, s) : 0, this.icon ? 7 * s : 0);
    let x = this.x;
    let y = this.y;
    // draw-only placement (world canvas px, with the outline): a long text near a wall
    // stays on screen, and a UI card over this spot (the item / fixture card of the
    // keeper who pressed) is stepped out from under
    const vw = r.world.width;
    const bw = total + 2 * s;
    let left = Math.round(x - r.viewX) - Math.floor(total / 2) - s;
    if (bw < vw) {
      const fit = Math.min(Math.max(left, 1), vw - 1 - bw);
      x += fit - left;
      left = fit;
    }
    const covers = r.worldCovers();
    if (covers.length) {
      const top = Math.round(y - r.viewY) + 5 * s - th - s;
      const [dx, dy, dir] = dodgeCovers(left, top, bw, th + 3 * s, covers, vw, r.world.height, this.dodge);
      this.dodge = dir;
      x += dx;
      y += dy;
    } else this.dodge = -1;
    if (!this.icon) {
      r.pixelText(this.text, x, y, this.color, { align: 'center', outline: '#140c1c', scale: s, alpha });
      return;
    }
    const lx = Math.round(x - total / 2);
    if (this.text) r.pixelText(this.text, lx, y, this.color, { outline: '#140c1c', scale: s, alpha });
    r.sprite(this.icon, lx + tw + s, y + 5 * s, { alpha, sx: s, sy: s });
  }

  /** draw only: the side it stepped out of a UI card last frame (-1 none) */
  private dodge = -1;
}

/** Seconds a damage number stays after its last hit (then fades). */
const DMG_HOLD = 0.55;
const DMG_FADE = 0.25;

/**
 * Damage number that accumulates rapid hits on the same enemy (beams, flames,
 * DoT): it hovers over the target, grows and pops on every increase, then
 * drifts up and fades once the hits stop.
 */
export class DamageNumber extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  amount: number;
  color: string;
  /** seconds since the last added hit */
  sinceAdd = 0;
  hits = 1;
  private pop = 1;
  private rise = 0;
  private target: Entity | null;
  private ox: number;
  private baseY: number;
  /** extra vertical offset from the anchor (status numbers sit beside the hit number) */
  private oy: number;
  constructor(target: Entity | null, x: number, y: number, amount: number, color = '#ffffff', ox = fx.range(-3, 3), oy = 0) {
    super();
    this.target = target;
    this.ox = ox;
    this.oy = oy;
    this.x = x + this.ox;
    this.y = this.baseY = y + oy;
    this.amount = amount;
    this.color = color;
    this.layer = 2;
    this.tileCollide = false;
  }

  /** Merge another hit into this number. */
  add(amount: number): void {
    // discrete hits pop the number; a continuous stream (beam ticks) just flashes
    this.pop = this.sinceAdd > 0.12 ? 1 : Math.max(this.pop, 0.4);
    this.amount += amount;
    this.sinceAdd = 0;
    this.hits++;
  }

  get text(): string {
    return `${Math.max(1, Math.round(this.amount))}`;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    this.sinceAdd += dt;
    this.pop = Math.max(0, this.pop - dt * 9);
    const t = this.target;
    if (t && !t.dead) {
      const r = (t as { r?: number }).r ?? 6;
      this.x = t.x + this.ox;
      this.baseY = t.y - r - 6 - t.z + this.oy;
    }
    // quick initial hop, slow climb while hits keep coming, then drift away
    const speed = this.age < 0.12 ? 60 : this.sinceAdd < DMG_HOLD ? 6 : 26;
    this.rise = Math.min(this.rise + speed * dt, 26);
    this.y = this.baseY - this.rise;
    if (this.sinceAdd >= DMG_HOLD + DMG_FADE) this.dead = true;
  }

  override draw(r: Renderer): void {
    const fade = this.sinceAdd > DMG_HOLD ? 1 - (this.sinceAdd - DMG_HOLD) / DMG_FADE : 1;
    // pop: one size up for a moment; flash: brighter color + 1px hop
    const pop = this.pop > 0.6 ? 1 : 0;
    const flash = this.pop > 0.15;
    r.pixelText(this.text, this.x, this.y - (flash && !pop ? 1 : 0), flash ? '#fff6c8' : this.color, {
      align: 'center',
      outline: '#140c1c',
      scale: 1 + pop,
      alpha: clamp(fade, 0, 1),
    });
  }
}

/** Soft glow + sparkles in an opened doorway (room-clear moment). */
export class DoorClearGlow extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  private dx: number;
  private dy: number;
  private color: string;
  dur = 1.1;
  constructor(d: { x: number; y: number; dir: 'N' | 'S' | 'E' | 'W'; kind: string }) {
    super();
    // inward normal of the doorway
    this.dx = d.dir === 'W' ? 1 : d.dir === 'E' ? -1 : 0;
    this.dy = d.dir === 'N' ? 1 : d.dir === 'S' ? -1 : 0;
    this.x = d.x + this.dx * 4;
    this.y = d.y + this.dy * 4;
    this.color = d.kind === 'boss' ? '#ff8060' : d.kind === 'treasure' ? '#ffd860' : d.kind === 'secret' ? '#c0a0ff' : '#ffe0a0';
    this.layer = 2;
    this.tileCollide = false;
  }

  private get env(): number {
    const t = this.age / this.dur;
    return t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 0.85);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.age >= this.dur) {
      this.dead = true;
      return;
    }
    if (this.age < 0.6 && fx.chance(dt * 30)) {
      const side = fx.range(-9, 9);
      w.particles.spawn({
        x: this.x + (this.dy !== 0 ? side : 0), y: this.y + (this.dx !== 0 ? side : 0),
        vx: this.dx * fx.range(15, 45) + fx.range(-6, 6), vy: this.dy * fx.range(15, 45) + fx.range(-6, 6) - 6,
        life: fx.range(0.35, 0.7), colors: ['#ffffff', this.color, this.color + '80'], size: fx.range(1, 2), drag: 2, additive: true,
      });
    }
  }

  override draw(r: Renderer): void {
    const e = this.env;
    if (e <= 0) return;
    r.ring(this.x, this.y, 6 + (this.age / this.dur) * 18, this.color, 1, 0.5 * e);
  }

  override light(w: World): void {
    const e = this.env;
    if (e <= 0) return;
    w.lights.add(this.x, this.y, 46 + 20 * e, this.color, { intensity: 0.9 * e });
    w.lights.glow(this.x, this.y, 22, this.color, 0.35 * e);
  }
}

/** Plays an animation (or static sprite) once, then disappears. */
export class AnimEffect extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
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
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
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
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
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
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
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
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
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
