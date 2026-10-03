// Floor 4 — 얼어붙은 성소 (frozen sanctum), part 1:
//  - 서리 망령 (frost wraith): its shards freeze in mid-air, turn to face you, then launch
//  - 서리 기사 (frost knight): plants an ice greatsword and sends a rolling line of ice spikes
//  - 깨어난 성상 (saint statue): stone while you look at it, slides at you when you look away
//  - 설원 늑대 (snow hound): pack hunter; hounds take turns pouncing, landing in a shard burst
// Shared floor-4 pieces (palettes, freezing puddle, ice-spike eruption) are exported for
// the other sanctum*.ts files.

import { defineEnemy } from '../../game/defs';
import { Entity } from '../../game/entity';
import { PixelPainter } from '../../engine/painter';
import { AnimEffect, GroundWarning, RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { rotateToward, TAU } from '../../engine/math';
import { fanAngles, type ProjBehavior } from '../../game/projectile';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import {
  dust, fadeTo, frames, gather, hurtFrame, inAimCone, landingSpot, laneWarning, lineSpots, rayFree, shard, bullet,
  sphere, spotAround, stepToward, WARN_RED,
} from './shared';

// ------------------------------------------------------------------ floor-4 palette
/** Glacial ice, darkest first. */
export const ICE = ['#1e3a7a', '#3a72c4', '#6cb6ee', '#b6e8ff', '#ffffff'];
/** Snow / frost particle colors. */
export const SNOWDUST = ['#ffffff', '#d4f4ff', '#8cdcff'];
/** Rose stained-glass light used for the sanctum's holy attacks. */
export const ROSE = { hot: '#fff0f6', mid: '#ff5c8e', low: '#a8164c' };
const DEEP = '#061430';

// ------------------------------------------------------------------ freezing puddle
/**
 * Sheet of black ice left by frost creatures. Arms after a short fade-in; while the
 * player stands on it they are chilled (slowed), which is dangerous among bullets.
 */
export class FrostPatch extends Entity {
  radius: number;
  life: number;
  arm = 0.45;
  private blobs: { dx: number; dy: number; r: number }[] = [];
  private flakes: { dx: number; dy: number; ph: number }[] = [];

  constructor(x: number, y: number, radius: number, life: number) {
    super();
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.life = life;
    this.layer = 0;
    this.tileCollide = false;
    this.enemyHazard = true;
    const n = 3 + Math.floor(radius / 5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + fx.range(-0.4, 0.4);
      const d = radius * fx.range(0.25, 0.5);
      this.blobs.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.6, r: radius * fx.range(0.45, 0.62) });
    }
    for (let i = 0; i < 3 + Math.floor(radius / 4); i++) {
      const a = fx.angle();
      const d = fx.next() * radius * 0.75;
      this.flakes.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.6, ph: fx.range(0, TAU) });
    }
  }

  get fade(): number {
    return Math.max(0, Math.min(1, this.age / this.arm, (this.life - this.age) / 0.5));
  }

  get armed(): boolean {
    return this.age > this.arm && this.age < this.life - 0.3;
  }

  /** Erased by a bullet-clear: disarms at once and fades out. */
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
      const rr = this.radius * 0.9;
      if (dx * dx + dy * dy < rr * rr) {
        p.applyStatus({ kind: 'slow', duration: 0.35, power: 0.45 }, () => 0);
        if (fx.chance(dt * 12)) {
          w.particles.spawn({ x: p.x + fx.range(-4, 4), y: p.y + 3, vy: -fx.range(6, 16), life: fx.range(0.3, 0.5), colors: SNOWDUST, size: 1 });
        }
      }
    }
    if (fx.chance(dt * 2.5 * (this.radius / 12))) {
      const f = this.flakes[Math.floor(fx.next() * this.flakes.length)];
      w.particles.spawn({ x: this.x + f.dx, y: this.y + f.dy - 1, vy: -fx.range(2, 6), life: fx.range(0.3, 0.6), colors: ['#ffffff', '#bfefff'], size: 1, additive: true });
    }
  }

  override draw(r: Renderer, w: World): void {
    const f = this.fade;
    for (const b of this.blobs) r.circle(this.x + b.dx, this.y + b.dy, b.r, '#7ccaf4', 0.3 * f);
    r.circle(this.x, this.y, this.radius * 0.6, '#d8f6ff', (this.armed ? 0.32 : 0.12) * f);
    if (!this.armed && this.age < this.arm) r.ring(this.x, this.y, this.radius * 0.9, '#e8faff', 1, 0.7 * f);
    for (const fl of this.flakes) {
      const tw = 0.5 + 0.5 * Math.sin(w.time * 5 + fl.ph);
      r.rect(this.x + fl.dx, this.y + fl.dy, 1, 1, '#ffffff', tw * 0.8 * f);
    }
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y, this.radius * 2.2, '#8adcff', { intensity: 0.4 * this.fade });
  }
}

// ------------------------------------------------------------------ ice spike eruption
function paintSpike(p: PixelPainter, k: number): void {
  const H = [5, 15, 17, 16, 0][k];
  const C = ICE;
  if (k === 4) {
    // shattered stub + fragments
    p.poly([3, 18, 5, 14, 7, 18], C[2]);
    p.poly([6, 18, 8, 15, 10, 18], C[3]);
    p.px(2, 12, C[4]);
    p.px(10, 11, C[3]);
    p.px(6, 9, C[4]);
    return;
  }
  const top = 18 - H;
  // side spikes
  if (k > 0) {
    p.poly([1, 18, 3, 18 - H * 0.45, 5, 18], C[2]);
    p.poly([8, 18, 10, 18 - H * 0.55, 12, 18], C[1]);
    p.line(3, 18 - H * 0.45 + 1, 3, 17, C[3]);
  }
  // main spike
  p.poly([4, 18, 6.5, top, 9, 18], C[2]);
  p.poly([4.5, 18, 6.5, top + 1, 6.5, 18], C[3]);
  p.line(6, top + 2, 6, 17, C[4]);
  p.px(7, 18 - Math.floor(H * 0.4), C[1]);
  if (k === 3) {
    // cracking just before it shatters
    p.line(5, top + 4, 8, top + 8, '#ffffff');
    p.line(8, top + 8, 6, top + 12, C[1]);
  }
}
frames('icespk', 'burst', 5, 13, 19, paintSpike, { origin: [6, 18], fps: 14, loop: false, outline: DEEP });

/** An ice spike erupts at (x, y): hurts the player within `radius`. */
export function iceSpike(w: World, x: number, y: number, radius: number, source: string, damage = 1): void {
  w.spawn(new AnimEffect('icespk_burst', x, y, { layer: 1 }));
  for (const p of w.targets()) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (damage > 0 && p.alive && p.z < 8 && d < radius + p.r * 0.5) {
      if (p.hurt(w, damage, source)) p.knock((p.x - x) / (d || 1), (p.y - y) / (d || 1), 150);
    }
  }
  w.particles.burst(x, y - 4, { count: 7, speed: [30, 90], life: [0.25, 0.5], colors: SNOWDUST, size: [1, 2], gravity: 280, vz: [30, 90] });
  w.sfx('spike', { vol: 0.3, pitch: fx.range(1.15, 1.35) });
}

// ================================================================== 서리 망령 (frost wraith)
const WR = ['#2c4a8a', '#5a8cc8', '#9ccaf0', '#d8f2ff', '#ffffff'];

function paintWraith(p: PixelPainter, k: number, mode: 'float' | 'cast' | 'hurt'): void {
  const bob = mode === 'float' ? [0, -1, -1, 0][k] : mode === 'hurt' ? 1 : -1;
  const sway = mode === 'float' ? [0, 1, 0, -1][k] : 0;
  // cloak: a flared trapezoid ending in hanging icicles
  p.poly([5, 9 + bob, 13, 9 + bob, 17 + sway * 0.5, 19, 1 + sway * 0.5, 19], WR[2]);
  p.shadeVertical(1, 9 + bob, 17, 11 - bob, [WR[3], WR[2], WR[2], WR[1], WR[0]], false);
  // carve the ragged hem
  for (let i = 0; i < 4; i++) {
    const x = 3.5 + i * 3.6 + sway * 0.5;
    p.poly([x, 20, x + 1.8, 16 + ((i + k) % 2), x + 3.6, 20], null);
  }
  // icicle tails
  for (let i = 0; i < 5; i++) {
    const x = 1.5 + i * 3.6 + sway * 0.5;
    const len = 2 + ((i * 7 + k) % 3);
    p.poly([x, 18.5, x + 2, 18.5, x + 1, 18.5 + len], i % 2 ? WR[1] : WR[2]);
  }
  // arms
  if (mode === 'cast') {
    p.line(5, 11 + bob, 1, 4 + bob, WR[3]);
    p.line(13, 11 + bob, 17, 4 + bob, WR[3]);
    p.px(0, 3 + bob, '#ffffff');
    p.px(1, 2 + bob, '#ffffff');
    p.px(17, 3 + bob, '#ffffff');
    p.px(16, 2 + bob, '#ffffff');
  } else if (mode === 'hurt') {
    p.line(5, 11 + bob, 2, 9 + bob, WR[2]);
    p.line(13, 11 + bob, 16, 9 + bob, WR[2]);
  } else {
    p.line(5, 11 + bob, 2, 15 + bob - sway, WR[3]);
    p.line(13, 11 + bob, 16, 15 + bob + sway, WR[1]);
    p.px(1, 16 + bob - sway, WR[4]);
    p.px(16, 16 + bob + sway, WR[2]);
  }
  // hood
  p.circle(9, 7 + bob, 4.8, WR[3]);
  sphere(p, 9, 7 + bob, 4.8, 4.8, WR, false);
  // icicle crown on a dark circlet
  p.poly([4.5, 4 + bob, 5.5, -1 + bob, 7, 3.5 + bob], '#bff6ff');
  p.poly([7.5, 3 + bob, 9, -3 + bob + (mode === 'cast' ? 0 : 1), 10.5, 3 + bob], '#ffffff');
  p.poly([11, 3.5 + bob, 12.5, -1 + bob, 13.5, 4 + bob], '#8cf2ff');
  p.line(5, 4 + bob, 13, 4 + bob, '#2856e8');
  p.px(9, 4 + bob, '#8cf2ff');
  // hollow face
  p.ellipse(9.5, 8 + bob, 3.2, 3, DEEP);
  const eye = mode === 'cast' ? '#ffffff' : '#8cf2ff';
  if (mode === 'hurt') {
    p.line(7, 7 + bob, 8, 8 + bob, '#8cf2ff');
    p.line(11, 7 + bob, 10, 8 + bob, '#8cf2ff');
  } else {
    p.px(8, 7 + bob, eye);
    p.px(11, 7 + bob, eye);
    p.px(8, 8 + bob, '#2a9ad0');
    p.px(11, 8 + bob, '#2a9ad0');
  }
  if (mode === 'cast') p.rect(9, 9 + bob, 2, 2, '#2a9ad0');
}
frames('fwraith', 'float', 4, 19, 23, (p, i) => paintWraith(p, i, 'float'), { fps: 7, outline: DEEP });
frames('fwraith', 'cast', 2, 19, 23, (p, i) => paintWraith(p, i, 'cast'), { fps: 10, outline: DEEP });
frames('fwraith', 'hurt', 1, 19, 23, (p) => paintWraith(p, 0, 'hurt'), { outline: DEEP });

/**
 * Shard behavior: decelerates to a stop, hangs, turns to face the player during the
 * last `turn` seconds before `release`, then launches at `speed`.
 */
export function hangAndAim(release: number, speed: number, turn = 0.3): ProjBehavior {
  return {
    id: 'hang-aim',
    update(p, w, dt) {
      if (p.mem.go) return;
      const p2 = w.player;
      const want = Math.atan2(p2.y - 4 - p.y, p2.x - p.x);
      if (p.age >= release - turn) p.angle = rotateToward(p.angle, want, 9 * dt);
      if (p.age >= release) {
        p.mem.go = 1;
        p.angle = want;
        p.accel = 160;
        p.minSpeed = 0;
        p.maxSpeed = speed;
        p.speed = speed * 0.45;
        p.syncVel();
        w.particles.burst(p.x, p.y - p.z, { count: 3, speed: [20, 50], life: [0.15, 0.3], colors: SNOWDUST, size: [1, 1] });
      } else if (p.speed < 1) {
        p.vx = p.vy = 0;
      }
    },
    draw(p, r) {
      if (p.mem.go || p.speed > 30) return;
      const k = (p.age * 3) % 1;
      r.ring(p.x, p.y - p.z, 2 + k * 5, '#ffffff', 1, 0.7 * (1 - k));
    },
  };
}

defineEnemy({
  id: 'frost_wraith',
  name: '서리 망령',
  hp: 34,
  radius: 6,
  speed: 36,
  flying: true,
  phasing: true,
  sprite: 'fwraith_float',
  shadow: 11,
  spriteYOffset: -9,
  cost: 2,
  floors: [4],
  weight: 1,
  champion: true,
  deathFx: 'ice',
  bloodColor: '#bfefff',
  light: { radius: 26, color: '#8adcff' },
  dieSfx: 'freeze',
  init(e) {
    e.alpha = 0.92;
  },
  *script(e, w) {
    let side = w.rng.sign();
    yield w.rng.range(0.2, 0.8);
    while (true) {
      e.setAnim('fwraith_float');
      const t = w.rng.range(1.3, 2.0);
      for (let el = 0; el < t; el += w.dt) {
        const tg = e.target(w);
        const a = Math.atan2(e.y - tg.y, e.x - tg.x) + side * 0.9 * w.dt;
        const gx = tg.x + Math.cos(a) * 82;
        const gy = tg.y + Math.sin(a) * 64;
        e.moveDir(gx - e.x, gy - e.y, Math.min(e.speed, Math.hypot(gx - e.x, gy - e.y) * 2));
        yield;
      }
      // frozen volley: shards stop in mid-air, turn to face the player, then launch
      e.stop();
      e.setAnim('fwraith_cast');
      e.facing = w.player.x >= e.x ? 1 : -1;
      e.telegraph(0.5);
      gather(w, e.x, e.y - 12, SNOWDUST, 10, 18);
      w.sfx('freeze', { vol: 0.35, pitch: 1.4 });
      yield 0.5;
      const base = e.angleToTarget(w);
      const n = e.champion ? 7 : 5;
      const angs = fanAngles(base, n, 0.36);
      for (let i = 0; i < angs.length; i++) {
        // the outer shards hang a little longer so they launch in a ripple
        const rel = 0.95 + Math.abs(i - (n - 1) / 2) * 0.08;
        e.shoot(w, angs[i], shard('frost', 3, { speed: 125, accel: -270, minSpeed: 0, z: 8, life: 5, behaviors: [hangAndAim(rel, 150)] }));
      }
      w.sfx('enemy_shoot', { vol: 0.45, pitch: 1.3 });
      yield 0.8;
      // blink: dissolve into snow and re-form elsewhere
      e.vulnerable = false;
      e.harmful = false;
      w.sfx('teleport', { vol: 0.3, pitch: 1.5 });
      w.particles.burst(e.x, e.y - 9, { count: 14, speed: [20, 60], life: [0.3, 0.6], colors: SNOWDUST, size: [1, 2] });
      yield* fadeTo(e, w, 0, 0.25);
      e.hidden = true;
      const spot = spotAround(w, w.player.x, w.player.y, 70, 110, 6, true) ?? { x: e.x, y: e.y };
      for (let el = 0; el < 0.45; el += w.dt) {
        if (fx.chance(0.5)) {
          w.particles.spawn({ x: spot.x + fx.range(-6, 6), y: spot.y - 9 + fx.range(-5, 5), vy: fx.range(4, 14), life: fx.range(0.3, 0.5), colors: SNOWDUST, size: 1, additive: true, light: 4 });
        }
        yield;
      }
      e.x = spot.x;
      e.y = spot.y;
      e.hidden = false;
      yield* fadeTo(e, w, 0.92, 0.3);
      e.vulnerable = true;
      e.harmful = true;
      side = w.rng.sign();
    }
  },
  update(e, w) {
    if (!e.hidden && fx.chance(0.2)) {
      w.particles.spawn({ x: e.x + fx.range(-6, 6), y: e.y - 2 + fx.range(-2, 2), vy: fx.range(4, 12), vx: fx.range(-4, 4), life: fx.range(0.4, 0.8), colors: ['#ffffff', '#bfefff', '#6cb6ee'], size: 1, alpha: 0.8 });
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'fwraith_hurt_0'), -9 + Math.sin(e.age * 2.6) * 1.5);
  },
});

// ================================================================== 서리 기사 (frost knight)
const ARM = ['#1a2240', '#344670', '#5a76a4', '#90b0d4', '#d4e8f8'];
const CRIM = ['#4a0a1e', '#8a1a34', '#c8304a', '#f06070'];
const BLADE = ['#2a6ad0', '#6cc4f4', '#c4f0ff', '#ffffff'];

function paintKnight(p: PixelPainter, k: number, mode: 'walk' | 'raise' | 'plunge' | 'hurt'): void {
  const step = mode === 'walk' ? [1, 0, -1, 0][k] : 0;
  const bob = mode === 'walk' ? [0, -1, 0, -1][k] : mode === 'plunge' ? 2 : 0;
  const by = 11 + bob; // torso top
  // cape (behind)
  const flow = mode === 'walk' ? [0, 1, 0, -1][k] : mode === 'raise' ? -1 : 1;
  p.poly([6, by, 9, by, 8, by + 12, 3 + flow, by + 13 - bob, 4, by + 4], '#1c2c6c');
  p.line(5, by + 2, 4 + flow, by + 12 - bob, '#2e44a0');
  // legs
  if (mode === 'plunge') {
    p.rect(6, 21, 3, 4, ARM[1]);
    p.rect(11, 22, 4, 3, ARM[1]);
    p.rect(5, 24, 4, 1, ARM[0]);
    p.rect(11, 24, 5, 1, ARM[0]);
  } else {
    p.rect(7 + step, 20, 3, 5, ARM[1]);
    p.rect(11 - step, 20, 3, 5, ARM[2]);
    p.rect(6 + step, 24, 4, 1, ARM[0]);
    p.rect(11 - step, 24, 4, 1, ARM[0]);
    p.px(12 - step, 21, ARM[3]);
  }
  // torso plate
  p.rect(6, by, 9, 10, ARM[2]);
  p.shadeVertical(6, by, 9, 10, [ARM[4], ARM[3], ARM[2], ARM[1]]);
  p.rect(14, by, 1, 10, ARM[1]);
  // crimson tabard + star emblem
  p.rect(9, by + 2, 4, 10, CRIM[2]);
  p.rect(9, by + 2, 1, 10, CRIM[3]);
  p.rect(12, by + 2, 1, 10, CRIM[1]);
  p.px(10, by + 4, '#ffffff');
  p.px(11, by + 5, '#ffffff');
  p.px(10, by + 5, BLADE[2]);
  p.px(11, by + 4, BLADE[2]);
  // belt
  p.rect(6, by + 7, 9, 1, ARM[0]);
  p.px(11, by + 7, BLADE[2]);
  // frost crust on the shoulders
  p.rect(6, by, 3, 1, '#ffffff');
  p.px(13, by, '#e8f8ff');
  // helm
  const hy = by - 5;
  p.ellipse(10.5, hy, 4.2, 4.4, ARM[2]);
  sphere(p, 10.5, hy, 4.2, 4.4, ARM, false);
  p.rect(9, hy, 6, 1, '#060a18');
  p.rect(11, hy, 3, 1, mode === 'raise' ? '#ffffff' : '#8cf2ff');
  p.px(10, hy + 2, ARM[1]);
  p.px(12, hy + 2, ARM[1]);
  // plume streaming back
  p.poly([9, hy - 4, 11, hy - 5, 8, hy - 3 + flow, 4, hy - 1 + flow, 6, hy - 4], CRIM[2]);
  p.line(6, hy - 3, 9, hy - 5, CRIM[3]);
  // pauldron (front)
  p.ellipse(13.5, by + 1, 2.6, 2, ARM[3]);
  p.px(13, by, ARM[4]);
  // greatsword of ice + gauntlet
  if (mode === 'raise') {
    // (the blade itself is drawn above the canvas top by knightFrame)
    p.rect(13, by - 4, 4, 2, ARM[2]); // hands overhead
    p.rect(12, by - 3, 6, 1, ARM[3]); // crossguard
    p.px(12, by - 3, BLADE[2]);
    p.px(17, by - 3, BLADE[2]);
  } else if (mode === 'plunge') {
    p.rect(15, by + 1, 4, 3, ARM[2]);
    p.rect(14, by + 4, 6, 1, ARM[3]);
    p.poly([15, by + 5, 19, by + 5, 18.5, 25, 15.5, 25], BLADE[1]);
    p.rect(16, by + 5, 2, 20 - by, BLADE[2]);
    p.line(17, by + 5, 17, 24, BLADE[3]);
    p.px(14, 24, '#ffffff');
    p.px(20, 23, '#ffffff');
    p.px(13, 25, BLADE[2]);
    p.px(21, 25, BLADE[2]);
  } else {
    // held low and forward
    const sy = by + 6 + (mode === 'hurt' ? -2 : 0);
    p.rect(14, sy - 1, 3, 3, ARM[2]);
    p.line(14, sy - 3, 17, sy + 1, ARM[3]); // crossguard
    p.poly([15.5, sy + 0.5, 18.5, sy - 1.5, 22.5, sy + 8, 20.5, sy + 9.5], BLADE[1]);
    p.line(17, sy, 21, sy + 8, BLADE[2]);
    p.line(17, sy - 1, 21, sy + 7, BLADE[3]);
    p.px(21, sy + 8, '#ffffff');
  }
}
/** Knight frame on a 23x30 canvas: the body is painted 4px down to leave room for the raised blade. */
function knightFrame(p: PixelPainter, k: number, mode: 'walk' | 'raise' | 'plunge' | 'hurt'): void {
  const t = new PixelPainter(23, 26);
  paintKnight(t, k, mode);
  if (mode === 'raise') {
    // blade overhead (drawn under the hands)
    const top = 0;
    const base = 11 - 5 + 4;
    p.poly([13, base, 17, base, 16.5, top + 2, 15, top, 13.5, top + 2], BLADE[1]);
    p.rect(14, top + 2, 2, base - top - 2, BLADE[2]);
    p.line(15, top + 1, 15, base - 1, BLADE[3]);
    p.px(15, top, '#ffffff');
    if (k) p.px(13, top + 3, '#ffffff');
  }
  p.blit(t, 0, 4);
}
frames('fknight', 'walk', 4, 23, 30, (p, i) => knightFrame(p, i, 'walk'), { anchor: 'bottom', fps: 5, outline: DEEP });
frames('fknight', 'raise', 2, 23, 30, (p, i) => knightFrame(p, i, 'raise'), { anchor: 'bottom', fps: 8, outline: DEEP });
frames('fknight', 'plunge', 1, 23, 30, (p) => knightFrame(p, 0, 'plunge'), { anchor: 'bottom', outline: DEEP });
frames('fknight', 'hurt', 1, 23, 30, (p) => knightFrame(p, 1, 'hurt'), { anchor: 'bottom', outline: DEEP });

defineEnemy({
  id: 'frost_knight',
  name: '서리 기사',
  hp: 72,
  radius: 8,
  speed: 24,
  mass: 3.5,
  sprite: 'fknight_walk',
  spriteYOffset: 7,
  shadow: 16,
  cost: 3,
  floors: [4],
  weight: 0.75,
  champion: true,
  deathFx: 'metal',
  bloodColor: '#a8d8ff',
  hurtSfx: 'hit_metal',
  dieSfx: 'enemy_die_big',
  light: { radius: 16, color: '#8adcff' },
  *script(e, w) {
    yield w.rng.range(0.3, 0.9);
    while (true) {
      e.setAnim('fknight_walk');
      yield* e.chaseFor(w, w.rng.range(1.4, 2.2), e.speed);
      const p = w.player;
      const d = e.distToTarget(w);
      if (d < 38) {
        // close: frost nova around the knight
        e.halt();
        e.setAnim('fknight_raise');
        const R = 30;
        w.spawn(new GroundWarning(e.x, e.y, R, 0.6, undefined, WARN_RED));
        e.telegraph(0.6);
        w.sfx('enemy_charge', { vol: 0.45, pitch: 1.2 });
        yield 0.6;
        e.setAnim('fknight_plunge');
        w.shake(0.3);
        w.sfx('slam', { vol: 0.6 });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU;
          iceSpike(w, e.x + Math.cos(a) * 18, e.y + Math.sin(a) * 12, 0, e.def.name, 0);
        }
        for (const q of w.targets()) {
          if (q.alive && q.z < 8 && Math.hypot(q.x - e.x, q.y - e.y) < R + q.r * 0.5) {
            if (q.hurt(w, 1, e.def.name)) {
              const dd = Math.hypot(q.x - e.x, q.y - e.y) || 1;
              q.knock((q.x - e.x) / dd, (q.y - e.y) / dd, 200);
            }
          }
        }
        w.spawn(new FrostPatch(e.x, e.y + 2, 20, 3));
        yield 0.9;
      } else if (d < 165 && w.room.lineOfSight(e.x, e.y, p.x, p.y)) {
        // plant the sword: a rolling line of ice spikes toward the player
        e.halt();
        e.setAnim('fknight_raise');
        e.facing = p.x >= e.x ? 1 : -1;
        const a0 = e.angleToTarget(w);
        const lines = e.champion ? [a0 - 0.38, a0, a0 + 0.38] : [a0];
        for (const a of lines) laneWarning(w, e.x, e.y, a, Math.min(150, rayFree(w.room, e.x, e.y, a, 4, 150, true)), 12, 0.65);
        e.telegraph(0.65);
        gather(w, e.x + e.facing * 4, e.y - 26, SNOWDUST, 10, 14);
        w.sfx('freeze', { vol: 0.4, pitch: 0.8 });
        yield 0.65;
        e.setAnim('fknight_plunge');
        w.shake(0.25);
        w.sfx('slam', { vol: 0.55, pitch: 1.1 });
        dust(w, e.x + e.facing * 8, e.y + 4, SNOWDUST, 10, 60);
        const spots = lines.map((a) => lineSpots(e.x, e.y, a, 9, 15, 16).filter((s) => s.x > w.room.interiorX && s.x < w.room.interiorX + w.room.interiorW && s.y > w.room.interiorY && s.y < w.room.interiorY + w.room.interiorH));
        for (let i = 0; i < 9; i++) {
          for (const line of spots) {
            const s = line[i];
            if (!s) continue;
            w.spawn(new GroundWarning(s.x, s.y, 8, 0.3, (ww) => iceSpike(ww, s.x, s.y, 8, '서리 기사'), WARN_RED));
          }
          yield 0.06;
        }
        yield 0.75;
      }
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'fknight_hurt_0'));
  },
});

// ================================================================== 깨어난 성상 (saint statue)
// A winged marble saint. While the player aims at it, it is still (and harmless to
// touch); the moment the player looks away it grinds across the floor toward them.
// Stared at for too long, it weeps a ring of rose light.
const MARBLE = ['#3a3e58', '#6a7090', '#9ea6c0', '#ccd4e4', '#f2f6fc'];

function paintStatue(p: PixelPainter, k: number, mode: 'still' | 'move' | 'cast' | 'hurt'): void {
  const glow = mode === 'move' || mode === 'cast';
  const lean = mode === 'move' ? 1 : 0;
  // plinth
  p.rect(3, 23, 13, 4, MARBLE[1]);
  p.rect(3, 23, 13, 1, MARBLE[3]);
  p.rect(3, 26, 13, 1, MARBLE[0]);
  p.rect(5, 24, 9, 1, MARBLE[2]);
  // wings (behind)
  const spread = mode === 'cast' ? 3 : 0;
  p.poly([6, 11, 1 - spread, 3 - spread, 0 - spread, 9, 2, 16, 5, 18], MARBLE[2]);
  p.poly([13, 11, 18 + spread, 3 - spread, 19 + spread, 9, 17, 16, 14, 18], MARBLE[1]);
  for (let i = 0; i < 3; i++) {
    p.line(5 - i, 10 + i * 2, 2 - spread * 0.5, 6 + i * 3, MARBLE[1]);
    p.line(14 + i, 10 + i * 2, 17 + spread * 0.5, 6 + i * 3, MARBLE[0]);
  }
  p.line(1 - spread, 3 - spread, 0 - spread, 9, MARBLE[4]);
  // robe
  p.poly([6 + lean, 10, 13 + lean, 10, 16, 23, 3, 23], MARBLE[2]);
  p.shadeVertical(3, 10, 13, 13, [MARBLE[4], MARBLE[3], MARBLE[2], MARBLE[1]]);
  p.line(8 + lean, 13, 6, 22, MARBLE[1]);
  p.line(11 + lean, 13, 12, 22, MARBLE[1]);
  p.rect(15, 14, 1, 9, MARBLE[1]);
  // clasped hands holding a rose crystal
  const hy = mode === 'cast' ? 10 : 13;
  p.rect(8 + lean, hy, 4, 3, MARBLE[3]);
  p.poly([10 + lean, hy - 3, 11.5 + lean, hy - 1, 10 + lean, hy + 1, 8.5 + lean, hy - 1], glow ? ROSE.mid : '#c87a96');
  p.px(10 + lean, hy - 2, glow ? '#ffffff' : '#e8b8c8');
  // head + veil
  p.circle(9.5 + lean, 7, 3.4, MARBLE[3]);
  sphere(p, 9.5 + lean, 7, 3.4, 3.4, MARBLE, false);
  p.poly([5.5 + lean, 8, 6.5 + lean, 3.5, 9.5 + lean, 2.5, 12.5 + lean, 3.5, 13.5 + lean, 8, 12.5 + lean, 11, 6.5 + lean, 11], MARBLE[2]);
  p.ellipse(9.8 + lean, 7.4, 2.4, 2.5, MARBLE[3]);
  // face
  if (glow) {
    p.px(8 + lean, 7, '#ffffff');
    p.px(11 + lean, 7, '#ffffff');
    p.px(8 + lean, 8, ROSE.mid);
    p.px(11 + lean, 8, ROSE.mid);
    if (mode === 'cast') {
      p.px(8 + lean, 9, ROSE.mid);
      p.px(11 + lean, 9, ROSE.mid);
    }
  } else {
    p.px(8 + lean, 7, MARBLE[0]);
    p.px(11 + lean, 7, MARBLE[0]);
    p.px(9 + lean, 7, MARBLE[1]);
    p.px(10 + lean, 7, MARBLE[1]);
  }
  // halo
  const hc = glow ? ROSE.hot : '#e0f4ff';
  for (let x = 6; x <= 13; x++) {
    p.px(x + lean, x === 6 || x === 13 ? 1 : 0, hc);
  }
  if (mode === 'still' && k === 1) p.px(7 + lean, 0, '#ffffff');
  // cracks (glowing while animated)
  const cc = glow ? (k ? ROSE.hot : ROSE.mid) : MARBLE[0];
  p.line(4, 19, 6, 16, cc);
  p.line(6, 16, 5, 14, cc);
  p.line(13, 21, 14, 18, cc);
  p.px(11 + lean, 4, cc);
  if (mode === 'hurt') {
    p.px(16, 12, MARBLE[4]);
    p.px(2, 15, MARBLE[4]);
    p.line(7, 6, 12, 8, MARBLE[0]);
  }
}
frames('sstatue', 'still', 2, 19, 27, (p, i) => paintStatue(p, i, 'still'), { anchor: 'bottom', fps: 1.5, outline: DEEP });
frames('sstatue', 'move', 2, 19, 27, (p, i) => paintStatue(p, i, 'move'), { anchor: 'bottom', fps: 10, outline: DEEP });
frames('sstatue', 'cast', 2, 19, 27, (p, i) => paintStatue(p, i, 'cast'), { anchor: 'bottom', fps: 12, outline: DEEP });
frames('sstatue', 'hurt', 1, 19, 27, (p) => paintStatue(p, 0, 'hurt'), { anchor: 'bottom', outline: DEEP });

/** Is the player looking at (aiming toward) enemy `e` with a clear line of sight? */
export function playerWatches(w: World, e: Enemy, half = 0.6): boolean {
  const p = w.player;
  if (!p.alive) return false;
  return inAimCone(p.aim, p.x, p.y - 4, e.x, e.y - 8, half) && w.room.lineOfSight(p.x, p.y, e.x, e.y);
}

defineEnemy({
  id: 'saint_statue',
  name: '깨어난 성상',
  hp: 60,
  radius: 7,
  speed: 64,
  mass: 6,
  contactDamage: 2,
  sprite: 'sstatue_still',
  spriteYOffset: 6,
  shadow: 16,
  cost: 2.5,
  floors: [4],
  weight: 0.6,
  champion: true,
  deathFx: 'bone',
  bloodColor: '#ccd4e4',
  hurtSfx: 'hit_metal',
  dieSfx: 'rock_break',
  light: { radius: 12, color: '#ff8ab0' },
  init(e) {
    e.mem.stare = 0;
    e.mem.still = 1;
  },
  *script(e, w) {
    while (true) {
      const watched = playerWatches(w, e) || e.hasStatus('charm');
      if (watched) {
        if (!e.mem.still) {
          // freezes mid-step with a little settle
          e.halt();
          e.squash(1.1, 0.92);
          dust(w, e.x, e.y + 5, ['#ccd4e4', '#9ea6c0'], 4, 30);
          w.sfx('hit_metal', { vol: 0.25, pitch: 0.6 });
        }
        e.mem.still = 1;
        e.harmful = false;
        e.setAnim('sstatue_still');
        e.mem.stare += w.dt;
        if (e.mem.stare > (e.champion ? 2.0 : 2.6)) {
          // weeping ring of rose light
          e.mem.stare = 0;
          e.setAnim('sstatue_cast');
          e.telegraph(0.6);
          gather(w, e.x, e.y - 14, ['#ffffff', ROSE.hot, ROSE.mid], 10, 16);
          w.sfx('beam_charge', { vol: 0.35, pitch: 1.5 });
          yield 0.6;
          const off = w.rng.angle();
          e.shootRing(w, 8, bullet('hymn', 3, { speed: 72, offset: off, z: 12 }));
          if (e.champion) e.shootRing(w, 8, bullet('hymn', 3, { speed: 52, offset: off + Math.PI / 8, z: 12 }));
          yield 0.4;
          continue;
        }
      } else {
        if (e.mem.still) {
          e.mem.still = 0;
          w.sfx('rock_break', { vol: 0.2, pitch: 0.55 });
        }
        e.harmful = true;
        e.mem.stare = Math.max(0, e.mem.stare - w.dt * 2);
        e.setAnim('sstatue_move');
        e.chase(w, e.speed);
        if (fx.chance(0.35)) dust(w, e.x + fx.range(-6, 6), e.y + 5, ['#ccd4e4', '#6a7090'], 1, 20);
      }
      yield;
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'sstatue_hurt_0'));
  },
  onDeath(e, w) {
    w.particles.burst(e.x, e.y - 10, { count: 16, speed: [40, 130], life: [0.4, 0.9], colors: MARBLE, size: [2, 3], gravity: 320, vz: [40, 130], bounce: 0.3 });
    w.particles.burst(e.x, e.y - 14, { count: 10, speed: [20, 60], life: [0.3, 0.6], colors: ['#ffffff', ROSE.hot, ROSE.mid], size: [1, 2], additive: true });
  },
});

// ================================================================== 설원 늑대 (snow hound)
const FUR = ['#3e4a6a', '#6e7e9e', '#a8b8d2', '#dde8f4', '#ffffff'];

function paintHound(p: PixelPainter, k: number, mode: 'run' | 'crouch' | 'leap' | 'hurt'): void {
  const pose = mode === 'run' ? [[-2, 2], [0, 0], [2, -2], [0, 0]][k] : mode === 'leap' ? [-3, 3] : [0, 0];
  const low = mode === 'crouch' ? 2 : mode === 'hurt' ? 1 : 0;
  const bob = mode === 'run' ? [0, -1, 0, -1][k] : 0;
  const by = 8 + low + bob;
  const leg = (x: number, dx: number, c: string) => {
    p.line(x, by + 1, x + dx, 13, c);
    p.line(x + 1, by + 1, x + dx + 1, 13, c);
    p.rect(x + dx, 14, 3, 1, c);
  };
  leg(5, pose[0], FUR[1]);
  leg(13, pose[1], FUR[1]);
  leg(7, -pose[0], FUR[2]);
  leg(15, -pose[1], FUR[2]);
  // bushy tail
  const tl = mode === 'leap' ? 2 : mode === 'crouch' ? -1 : [0, 1, 0, -1][k % 4];
  p.poly([4, by - 1, 0, by - 5 + tl, 1, by - 2 + tl, 4, by + 1], FUR[3]);
  p.px(0, by - 5 + tl, FUR[4]);
  // body
  p.ellipse(10.5, by, 7, 3.4, FUR[3]);
  sphere(p, 10.5, by - 0.5, 7, 3.6, FUR, false);
  // icy mane spikes along the back
  for (let i = 0; i < 4; i++) {
    const x = 7 + i * 2.6;
    const h = 3 + ((i + 1) % 2);
    p.poly([x - 1, by - 2, x + 0.5, by - 2 - h, x + 2, by - 2], i % 2 ? '#8cf2ff' : '#bff6ff');
    p.px(Math.round(x), by - 3, '#2856e8');
  }
  // head
  const hy = mode === 'crouch' ? by + 1 : mode === 'leap' ? by - 1 : by - 2;
  const hx = mode === 'leap' ? 18.5 : 17.5;
  p.circle(hx, hy, 3.2, FUR[3]);
  sphere(p, hx, hy, 3.2, 3.2, FUR, false);
  p.poly([hx + 1, hy - 1, hx + 5.5, hy + 0.5, hx + 1, hy + 2.5], FUR[3]);
  p.px(Math.round(hx + 4.5), Math.round(hy), '#141c30');
  p.poly([hx - 2, hy - 2, hx - 2.5, hy - 6, hx + 0.5, hy - 3], FUR[2]);
  p.px(Math.round(hx - 2), Math.round(hy - 4), '#8cf2ff');
  // eye
  if (mode === 'hurt') p.px(Math.round(hx), Math.round(hy - 1), '#6e7e9e');
  else {
    p.px(Math.round(hx), Math.round(hy - 1), '#8cf2ff');
    p.px(Math.round(hx + 1), Math.round(hy - 1), '#ffffff');
  }
  if (mode === 'crouch' || mode === 'leap') {
    p.px(Math.round(hx + 2), Math.round(hy + 1.5), '#ffffff');
    p.px(Math.round(hx + 4), Math.round(hy + 1.5), '#ffffff');
  }
  // frosted chest
  p.px(Math.round(hx - 3), Math.round(hy + 2), FUR[4]);
  p.px(Math.round(hx - 2), Math.round(hy + 3), FUR[4]);
}
frames('shound', 'run', 4, 23, 15, (p, i) => paintHound(p, i, 'run'), { anchor: 'bottom', fps: 12, outline: DEEP });
frames('shound', 'crouch', 1, 23, 15, (p) => paintHound(p, 0, 'crouch'), { anchor: 'bottom', outline: DEEP });
frames('shound', 'leap', 1, 23, 15, (p) => paintHound(p, 0, 'leap'), { anchor: 'bottom', outline: DEEP });
frames('shound', 'hurt', 1, 23, 15, (p) => paintHound(p, 0, 'hurt'), { anchor: 'bottom', outline: DEEP });

defineEnemy({
  id: 'snow_hound',
  name: '설원 늑대',
  hp: 30,
  radius: 6,
  speed: 66,
  sprite: 'shound_run',
  spriteYOffset: 5,
  shadow: 16,
  cost: 1.5,
  floors: [4],
  weight: 1.1,
  champion: true,
  deathFx: 'ice',
  bloodColor: '#d8f0ff',
  light: { radius: 10, color: '#8adcff' },
  init(e, w) {
    e.mem.side = w.rng.sign();
    e.mem.orbit = w.rng.range(62, 82);
  },
  *script(e, w) {
    yield w.rng.range(0.2, 0.7);
    while (true) {
      e.setAnim('shound_run');
      // circle the player at a distance (each hound on its own lane)
      const t = w.rng.range(1.1, 1.9);
      for (let el = 0; el < t; el += w.dt) {
        const tg = e.target(w);
        const d = Math.hypot(tg.x - e.x, tg.y - e.y);
        if (d > 130 || !w.room.lineOfSight(e.x, e.y, tg.x, tg.y)) e.chase(w, e.speed);
        else {
          const a = Math.atan2(e.y - tg.y, e.x - tg.x) + e.mem.side * 0.9;
          e.moveDir(tg.x + Math.cos(a) * e.mem.orbit - e.x, tg.y + Math.sin(a) * e.mem.orbit * 0.8 - e.y, e.speed);
        }
        if (e.mem.__bumped && w.rng.chance(0.05)) e.mem.side = -e.mem.side;
        yield;
      }
      // the pack takes turns: only one hound pounces at a time
      const p = w.player;
      if (w.time < (w.vars.__houndPounceT ?? 0) || e.distToTarget(w) > 150 || !w.room.lineOfSight(e.x, e.y, p.x, p.y)) continue;
      w.vars.__houndPounceT = w.time + 1.15;
      e.halt();
      e.setAnim('shound_crouch');
      e.facing = p.x >= e.x ? 1 : -1;
      const aim = stepToward(e.x, e.y, p.x + p.vx * 0.3, p.y + p.vy * 0.3, 120);
      const land = landingSpot(w, aim.x, aim.y, e.r);
      w.spawn(new GroundWarning(land.x, land.y, 14, 0.55 + 0.45, undefined, WARN_RED));
      e.telegraph(0.55);
      w.sfx('enemy_roar', { vol: 0.35, pitch: 1.6 });
      yield 0.55;
      e.setAnim('shound_leap');
      e.facing = land.x >= e.x ? 1 : -1;
      yield* e.jumpTo(w, land.x, land.y, 0.45, 24);
      // landing burst of frost shards
      e.setAnim('shound_crouch');
      const off = w.rng.angle();
      for (let i = 0; i < 6; i++) e.shoot(w, off + (i / 6) * TAU, shard('frost', 2, { speed: 95, accel: -60, minSpeed: 45, range: 160, z: 4 }));
      w.sfx('freeze', { vol: 0.3, pitch: 1.6 });
      dust(w, e.x, e.y + 3, SNOWDUST, 10, 70);
      w.spawn(new RingFx(e.x, e.y, 16, 0.25, '#d8f6ff', 2));
      yield 0.45;
      // retreat a little
      e.setAnim('shound_run');
      const away = Math.atan2(e.y - p.y, e.x - p.x) + w.rng.range(-0.6, 0.6);
      for (let el = 0; el < 0.55; el += w.dt) {
        e.moveAngle(away, e.speed);
        yield;
      }
    }
  },
  update(e, w) {
    if (e.anim === 'shound_run' && fx.chance(0.25)) {
      w.particles.spawn({ x: e.x - e.facing * 6, y: e.y + 4, vx: -e.facing * fx.range(5, 20), vy: -fx.range(2, 8), life: fx.range(0.25, 0.45), colors: SNOWDUST, size: 1 });
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'shound_hurt_0'));
  },
});

