// Shared pieces of the floor-6 enemies (수몰된 서고):
//  - palettes, the flat-book / book-stack painters (also used by the theme's rocks, so a
//    책 더미 미믹 is pixel-identical to a real book pile)
//  - `InkPool`: slowing puddle of ink left by ink creatures
//  - glyph / page bullets (rune sprites, fluttering pages) and the `inkGlyph` behavior
//    that holds a bullet in the air and launches it at the player on cue
//  - `InkDarkness`: screen-space ink fog that closes in around the player while a
//    젖은 등불 유령 is near (drawn after the light pass)
//  - `shelfCrash`: a shelf board slamming down (the 서가 골렘's toppled shelf line)
// Pure helpers are unit-tested in tests/floor6.test.ts.

import { Entity } from '../../game/entity';
import type { World } from '../../game/world';
import type { ShootOpts } from '../../game/enemy';
import type { Renderer } from '../../engine/renderer';
import type { PixelPainter } from '../../engine/painter';
import type { ProjBehavior } from '../../game/projectile';
import { defineDrawnSprite, hasSprite } from '../../engine/sprites';
import { AnimEffect, RingFx } from '../../game/effects';
import { VIEW_H, VIEW_W } from '../../engine/renderer';
import { fx } from '../../engine/rng';
import { clamp, TAU } from '../../engine/math';
import { pageSprite } from '../props/archive';
import { BUL, frames } from './shared';

// ------------------------------------------------------------------ palette
/** Glossy ink, darkest first (deep blue-black with a cold sheen). */
export const INKB = ['#02040a', '#0a1020', '#141c36', '#24305a', '#3a4c80'];
/** Bioluminescent cyan. */
export const CYAN = { hot: '#f0ffff', mid: '#56e8ff', low: '#1a7a88' };
/** Old parchment, darkest first. */
export const PAPER = ['#7a6a48', '#a89468', '#d8c8a0', '#efe4c4'];
export const GOLD = '#c8a048';
/** Book spine colors. */
export const SPINES = ['#2a2f6a', '#5a1e2a', '#1e4a3a', '#6a4a1e', '#3a2448', '#16181e', '#7a2a1e'];
export const AOUT = '#070c12';
/** Ink splash particle colors. */
export const INKDUST = ['#56e8ff', '#141c36', '#0a1020', '#02040a'];

/** Shift a hex color toward another by k (0..1). */
export function toward(c: string, to: string, k: number): string {
  const a = parseInt(c.slice(1, 7), 16);
  const b = parseInt(to.slice(1, 7), 16);
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * k);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

// ------------------------------------------------------------------ books
/** A flat book seen from above: cover with a lit top row, dark bottom row, cream fore-edge. */
export function flatBook(p: PixelPainter, x: number, y: number, w: number, h: number, color: string, edgeRight = true): void {
  const lit = toward(color, '#ffffff', 0.28);
  const dark = toward(color, '#000000', 0.4);
  p.rect(x, y, w, h, color);
  p.rect(x, y, w, 1, lit);
  p.rect(x, y + h - 1, w, 1, dark);
  if (edgeRight) {
    p.rect(x + w - 1, y, 1, h, PAPER[2]);
    p.px(x + w - 1, y, PAPER[3]);
  } else {
    p.rect(x, y, 1, h, PAPER[2]);
  }
}

/**
 * The archive's standard four-book pile (16x18, base at the bottom). `open` lifts the top
 * two books like a jaw (0 closed .. 1 wide) and shows the mimic's maw; `k` picks the eye blink.
 */
export function paintBookStack(p: PixelPainter, open = 0, k = 0, hurt = false): void {
  const spine = (i: number) => SPINES[(i * 3) % SPINES.length];
  const lift = Math.round(open * 5);
  // lower two books stay put
  flatBook(p, 2, 15, 11, 3, spine(0), true);
  p.px(5, 16, GOLD);
  flatBook(p, 3, 12, 12, 3, spine(1), false);
  if (open > 0) {
    // the maw: ink-black gullet lined with torn paper teeth, two cyan eyes
    p.rect(3, 12 - lift, 11, lift, '#03050a');
    p.rect(4, 12 - lift, 9, 1, '#101a3a');
    for (let x = 4; x <= 12; x += 2) {
      p.px(x, 12 - lift, PAPER[3]);
      p.px(x + 1, 11, PAPER[2]);
    }
    const ec = hurt ? INKB[3] : k ? CYAN.mid : CYAN.hot;
    p.px(5, 12 - Math.max(1, lift - 1), ec);
    p.px(10, 12 - Math.max(1, lift - 1), ec);
    if (lift > 3) {
      p.px(6, 12 - lift + 1, CYAN.low);
      p.px(9, 12 - lift + 1, CYAN.low);
    }
  }
  flatBook(p, 1, 9 - lift, 11, 3, spine(2), true);
  flatBook(p, 3, 6 - lift, 12, 3, spine(3), false);
  p.px(6, 7 - lift, GOLD);
  if (open > 0.3) {
    // top book tilted up like an upper jaw
    p.px(14, 6 - lift, toward(spine(3), '#ffffff', 0.3));
  }
  if (hurt) {
    p.px(4, 10 - lift, '#ffffff');
    p.px(12, 7 - lift, '#ffffff');
  }
  // water stains at the base
  for (let x = 0; x < 16; x++) for (let y = 14; y < 18; y++) if (p.isSet(x, y) && ((x * 7 + y * 13) % 11) < 4) p.px(x, y, toward('#2a3a44', '#0e3a40', 0.5));
}

// ------------------------------------------------------------------ ink pool
/**
 * Puddle of ink. Arms after a short fade-in; a player standing in it is slowed
 * (dangerous among glyphs and lunging eels). Cleared by bullet-clears.
 */
export class InkPool extends Entity {
  radius: number;
  life: number;
  arm = 0.3;
  private blobs: { dx: number; dy: number; r: number }[] = [];
  private sheen: number;

  constructor(x: number, y: number, radius: number, life: number) {
    super();
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.life = life;
    this.layer = 0;
    this.tileCollide = false;
    this.enemyHazard = true;
    this.sheen = fx.angle();
    const n = 3 + Math.floor(radius / 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + fx.range(-0.4, 0.4);
      const d = radius * fx.range(0.2, 0.5);
      this.blobs.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.6, r: radius * fx.range(0.45, 0.62) });
    }
  }

  get fade(): number {
    return Math.max(0, Math.min(1, this.age / this.arm, (this.life - this.age) / 0.5));
  }

  get armed(): boolean {
    return this.age > this.arm && this.age < this.life - 0.3;
  }

  override onCleared(): void {
    this.life = Math.min(this.life, this.age + 0.3);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.age >= this.life) {
      this.dead = true;
      return;
    }
    const p = w.player;
    if (this.armed && p.alive && p.z < 4) {
      const dx = p.x - this.x;
      const dy = (p.y - this.y) / 0.7;
      if (dx * dx + dy * dy < (this.radius * 0.9) ** 2) {
        p.applyStatus({ kind: 'slow', duration: 0.35, power: 0.42 }, () => 0);
        if (fx.chance(dt * 10)) {
          w.particles.spawn({ x: p.x + fx.range(-4, 4), y: p.y + 3, vy: -fx.range(4, 10), life: fx.range(0.3, 0.5), colors: [INKB[2], INKB[1]], size: 1 });
        }
      }
    }
  }

  override draw(r: Renderer, w: World): void {
    const f = this.fade;
    for (const b of this.blobs) r.circle(this.x + b.dx, this.y + b.dy, b.r, '#03050c', 0.78 * f);
    r.circle(this.x, this.y, this.radius * 0.55, '#0c1430', 0.5 * f);
    // cold sheen sliding over the surface
    const s = this.sheen + w.time * 0.8;
    r.rect(this.x + Math.cos(s) * this.radius * 0.35 - 1, this.y + Math.sin(s) * this.radius * 0.2, 3, 1, '#4a6aa8', 0.6 * f);
    if (!this.armed && this.age < this.arm) r.ring(this.x, this.y, this.radius * 0.9, CYAN.mid, 1, 0.6 * f);
  }
}

/** Splash of ink at (x, y): droplets, a ring, and a dark stain on the floor. */
export function inkSplash(w: World, x: number, y: number, size = 1): void {
  w.particles.burst(x, y - 2, { count: Math.round(10 * size), speed: [30, 90 * size], life: [0.25, 0.5], colors: INKDUST, size: [1, 2], gravity: 260, vz: [20, 70] });
  w.spawn(new RingFx(x, y, 10 * size, 0.25, INKB[3], 1));
  w.decal(x, y, '#04060c', 2.5 * size, 0.6);
}

// ------------------------------------------------------------------ glyph bullets
/** Lazily define a glowing rune bullet sprite (variant 0..2, size d odd 5..11). */
export function glyphSprite(v: number, d = 7): string {
  v = ((v % 3) + 3) % 3;
  d = Math.max(5, Math.min(11, Math.round(d))) | 1;
  const name = `__glyph_${v}_${d}`;
  if (hasSprite(name)) return name;
  const pal = BUL.glyph;
  defineDrawnSprite(name, d, d, (p) => {
    const c = (d - 1) / 2;
    const m = d >= 9 ? 2 : 1;
    // rune body: a lozenge / cross / bracket shape on a dark plate
    p.circle(c, c, c, pal.rim);
    if (v === 0) {
      p.poly([c, 0, d - 1, c, c, d - 1, 0, c], pal.color);
      p.rect(c - m, c - m, m * 2 + 1, m * 2 + 1, pal.core);
    } else if (v === 1) {
      p.rect(c, 0, 1, d, pal.color);
      p.rect(0, c, d, 1, pal.color);
      p.rect(c - m, c - m, m * 2 + 1, m * 2 + 1, pal.core);
      p.px(1, 1, pal.color);
      p.px(d - 2, d - 2, pal.color);
    } else {
      p.rect(1, 1, d - 2, d - 2, pal.color);
      p.rect(2, 2, d - 4, d - 4, pal.rim);
      p.rect(c - m, c - m, m * 2 + 1, m * 2 + 1, pal.core);
      p.px(1, c, pal.core);
      p.px(d - 2, c, pal.core);
    }
    p.px(c, c, '#ffffff');
  }, { outline: pal.outline });
  return name;
}

/** Shoot options for a glowing ink glyph of collision radius `size`. */
export function glyphShot<T extends ShootOpts>(size = 3, variant = 0, extra: T = {} as T): ShootOpts & T {
  return {
    color: BUL.glyph.color,
    sprite: glyphSprite(variant, size * 2 + 1),
    spriteRotates: false,
    radius: size,
    light: 16 + size * 2,
    ...extra,
  };
}

/**
 * Behavior of a "written" glyph: it hangs in the air where it was written, then at
 * `release` seconds turns toward the player and launches at `speed`.
 */
export function inkGlyph(release: number, speed: number): ProjBehavior {
  return {
    id: 'ink-glyph',
    update(p, w) {
      if (p.mem.go) return;
      p.vx = p.vy = 0;
      if (p.age >= release) {
        p.mem.go = 1;
        const pl = w.player;
        p.angle = Math.atan2(pl.y - 4 - p.y, pl.x - p.x);
        p.speed = speed;
        p.syncVel();
        w.particles.burst(p.x, p.y - p.z, { count: 4, speed: [20, 60], life: [0.15, 0.3], colors: [CYAN.hot, CYAN.mid], size: [1, 1], additive: true });
        w.sfx('enemy_shoot', { vol: 0.3, pitch: 1.5, x: p.x });
      }
    },
    draw(p, r) {
      if (p.mem.go) return;
      const k = clamp(p.age / release, 0, 1);
      // the glyph "fills in" as it is written: a ring tightens onto it
      r.ring(p.x, p.y - p.z, 2 + (1 - k) * 6, CYAN.mid, 1, 0.35 + 0.4 * k);
    },
  };
}

// ------------------------------------------------------------------ page bullets
defineDrawnSprite('__page_shot', 8, 7, (p) => {
  const pal = BUL.page;
  p.rect(0, 1, 7, 5, pal.rim);
  p.rect(1, 0, 6, 6, pal.color);
  p.rect(1, 0, 6, 1, pal.core);
  p.rect(2, 2, 3, 1, '#5a4030');
  p.rect(2, 4, 4, 1, '#5a4030');
  p.px(6, 5, pal.rim);
  p.px(7, 2, pal.color);
}, { outline: BUL.page.outline });

/** Sinusoidal angle wobble: a fluttering sheet of paper. */
export function flutter(amp = 1.6, rate = 9): ProjBehavior {
  return {
    id: 'flutter',
    update(p, _w, dt) {
      // the phase is gameplay state (it steers the shot): derive it from the id, never from `fx`
      if (!p.mem.ph) p.mem.ph = ((p.id * 2.399963) % TAU) + 0.01;
      p.angle += Math.cos(p.age * rate + p.mem.ph) * amp * dt;
    },
  };
}

/** Shoot options for a fluttering page of collision radius `size`. */
export function pageShot<T extends ShootOpts>(size = 3, extra: T = {} as T): ShootOpts & T {
  return {
    color: BUL.page.color,
    sprite: '__page_shot',
    spriteRotates: true,
    radius: size,
    light: 10 + size * 2,
    ...extra,
    behaviors: [flutter(), ...(extra.behaviors ?? [])],
  };
}

// ------------------------------------------------------------------ ink darkness
/** Strength (0..1) of the ink fog for a wraith `d` px from the player. */
export function fogStrength(d: number, near = 60, far = 180): number {
  return clamp(1 - (d - near) / (far - near), 0, 1);
}

/**
 * Screen-space ink fog closing in on the player while 젖은 등불 유령 are near. Drawn on
 * layer 3 (after the light pass) so the whole lit world darkens except a shrinking
 * circle around the keeper. One per room; it fades out and removes itself when no wraith lives.
 */
export class InkDarkness extends Entity {
  k = 0;
  constructor() {
    super();
    this.layer = 3;
    this.tileCollide = false;
  }

  /** Target strength: the nearest living wraith's fog. */
  target(w: World): number {
    const p = w.player;
    let k = 0;
    for (const e of w.enemies) {
      if (!e.alive || e.hidden || e.def.id !== 'lantern_wraith') continue;
      k = Math.max(k, fogStrength(Math.hypot(e.x - p.x, e.y - p.y)));
    }
    return k;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const t = this.target(w);
    this.k += (t - this.k) * Math.min(1, dt * 3);
    const any = w.enemies.some((e) => e.alive && e.def.id === 'lantern_wraith');
    if (!any && this.k < 0.02) this.dead = true;
  }

  override draw(r: Renderer, w: World): void {
    if (this.k < 0.02) return;
    const p = w.player;
    const ctx = r.ctx;
    const cx = p.x - r.viewX;
    const cy = p.y - 6 - r.viewY;
    const r0 = 84 - 46 * this.k;
    const r1 = r0 + 54;
    const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
    const a = 0.8 * this.k;
    g.addColorStop(0, 'rgba(2,4,10,0)');
    g.addColorStop(0.55, `rgba(2,4,10,${(a * 0.55).toFixed(3)})`);
    g.addColorStop(1, `rgba(2,4,10,${a.toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // ink wisps at the edge of the light
    const n = 6;
    for (let i = 0; i < n; i++) {
      const ang = w.time * 0.6 + (i / n) * TAU;
      const rr = r0 + 6 + Math.sin(w.time * 1.7 + i) * 5;
      ctx.globalAlpha = 0.35 * this.k;
      ctx.fillStyle = '#060a18';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr * 0.8, 6 + (i % 2) * 3, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/** Make sure the room has an ink darkness overlay (spawned by the first wraith). */
export function ensureDarkness(w: World): void {
  if (w.entities.some((e) => e instanceof InkDarkness && !e.dead)) return;
  w.spawn(new InkDarkness());
}

// ------------------------------------------------------------------ shelf crash
function paintCrash(p: PixelPainter, k: number): void {
  const W = ['#1a120c', '#2e1f14', '#45301e', '#5e452a', '#7a5c38'];
  if (k === 4) {
    // splinters and spilled books on the floor
    flatBook(p, 3, 17, 7, 3, SPINES[0]);
    flatBook(p, 10, 18, 6, 3, SPINES[2], false);
    p.rect(1, 20, 5, 1, W[2]);
    p.rect(12, 20, 6, 1, W[3]);
    p.px(7, 15, W[4]);
    p.px(14, 14, W[4]);
    return;
  }
  const y = [0, 5, 11, 16][k];
  // falling shelf board (seen edge-on, tilting as it comes down) with books tumbling under it
  p.rect(1, y, 17, 3, W[2]);
  p.rect(1, y, 17, 1, W[4]);
  p.rect(1, y + 2, 17, 1, W[0]);
  if (k < 3) {
    flatBook(p, 4, y + 4 + k, 6, 3, SPINES[k % SPINES.length]);
    flatBook(p, 10, y + 3 + k * 2, 5, 3, SPINES[(k + 3) % SPINES.length], false);
  } else {
    flatBook(p, 3, 18, 7, 3, SPINES[0]);
    flatBook(p, 10, 18, 6, 3, SPINES[2], false);
  }
  if (k === 3) {
    // impact: splinters
    p.px(0, 14, W[4]);
    p.px(18, 15, W[4]);
    p.px(9, 12, W[4]);
  }
}
frames('shcrash', 'fall', 5, 19, 22, paintCrash, { origin: [9, 21], fps: 14, loop: false, outline: AOUT });

/** A shelf slams down at (x, y): hurts the player within `radius`, scatters books. */
export function shelfCrash(w: World, x: number, y: number, radius: number, source: string, damage = 1): void {
  w.spawn(new AnimEffect('shcrash_fall', x, y, { layer: 1 }));
  for (const p of w.targets()) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (damage > 0 && p.alive && p.z < 8 && d < radius + p.r * 0.5) {
      if (p.hurt(w, damage, source)) p.knock((p.x - x) / (d || 1), (p.y - y) / (d || 1), 150);
    }
  }
  w.particles.burst(x, y - 3, { count: 6, speed: [30, 80], life: [0.25, 0.5], colors: [PAPER[2], PAPER[1], '#5e452a'], size: [1, 2], gravity: 280, vz: [30, 90] });
  w.sfx('rock_break', { vol: 0.3, pitch: fx.range(1.2, 1.4) });
}

/** Flurry of page particles. */
export function pages(w: World, x: number, y: number, n = 4, speed = 40): void {
  for (let i = 0; i < n; i++) {
    const a = fx.angle();
    w.particles.spawn({
      x, y, vx: Math.cos(a) * speed * fx.range(0.4, 1), vy: Math.sin(a) * speed * fx.range(0.4, 1) - 10, life: fx.range(0.8, 1.6), drag: 1.2,
      colors: ['#ffffff'], shape: 'sprite', sprite: pageSprite(fx.int(0, 2)), vrot: fx.range(-5, 5), alpha: 0.95, fade: true, z: 8,
    });
  }
}
