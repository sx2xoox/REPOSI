// Floor 5 — 공허의 심장 (void abyss), part 1:
//  - 공허의 눈 (void eye): eyelid armor while closed; opens to loose slow homing orbs
//  - 공허 촉수 (void tentacle): travels under the floor as a visible rift, erupts under
//    the player after a warning, then lashes before sinking again
//  - 그림자 분신 (shadow double): dash-slashing shadow that splits in two at half health
//  - 차원 추적자 (warp stalker): vanishes and re-forms beside the player (marked circle),
//    slashing on arrival; dazed afterwards
// Shared floor-5 pieces (palette, void pool) are exported for abyss-*.ts.

import { defineEnemy } from '../../game/defs';
import { Entity } from '../../game/entity';
import { PixelPainter } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { Afterimage, GroundWarning, RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { TAU } from '../../engine/math';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import {
  appliedDamage, bullet, fadeTo, frames, gather, hurtFrame, landingSpot, laneWarning, rayFree, sphere, WARN_RED,
} from './shared';

// ------------------------------------------------------------------ floor-5 palette
/** Void flesh, darkest first (bright top so it reads on the black floor). */
export const VFLESH = ['#1e0a30', '#3e1660', '#6a2a94', '#a050c8', '#d898f0'];
export const VPINK = { hot: '#ffe6f4', mid: '#ff4fae', low: '#a0105e' };
export const VTEAL = { hot: '#eafff8', mid: '#3cffc4', low: '#0a8a6c' };
export const VOIDDUST = ['#ffffff', '#ffb0e0', '#c060ff', '#5a1a9a'];
const VOUT = '#08020f';

// ------------------------------------------------------------------ void pool
/** Pool of liquid void left by abyss creatures: arms after a fade-in, then hurts the player. */
export class VoidPool extends Entity {
  radius: number;
  life: number;
  source: string;
  arm = 0.45;
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
    if (fx.chance(dt * 7 * (this.radius / 12))) {
      const a = fx.angle();
      const d = fx.next() * this.radius * 0.8;
      w.particles.spawn({
        x: this.x + Math.cos(a) * d, y: this.y + Math.sin(a) * d * 0.6, vy: -fx.range(6, 16), life: fx.range(0.4, 0.8),
        colors: ['#ffffff', VPINK.mid, '#8a2ad0'], size: 1, additive: true, light: 3,
      });
    }
    for (const p of w.targets()) {
      if (this.armed && p.alive && p.z < 4) {
        const dx = p.x - this.x;
        const dy = (p.y - this.y) / 0.7;
        const rr = this.radius * 0.85;
        if (dx * dx + dy * dy < rr * rr) p.hurt(w, 1, this.source);
      }
    }
  }

  override draw(r: Renderer, w: World): void {
    const f = this.fade;
    for (const b of this.blobs) r.circle(this.x + b.dx, this.y + b.dy, b.r, '#3a0a50', 0.6 * f);
    r.circle(this.x, this.y, this.radius * 0.55, '#a020c0', (this.armed ? 0.45 : 0.15) * f);
    const blink = this.armed ? 0.55 : 0.4 + 0.4 * Math.sin(this.age * 30);
    r.ring(this.x, this.y, this.radius * 0.88, VPINK.mid, 1, blink * f);
    const s = w.time * 2;
    r.rect(this.x + Math.cos(s) * this.radius * 0.4, this.y + Math.sin(s) * this.radius * 0.25, 1, 1, '#ffffff', 0.8 * f);
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y, this.radius * 2.4, '#c040ff', { intensity: 0.5 * this.fade });
  }
}

// ================================================================== 공허의 눈 (void eye)
const EYEW = ['#7a6a98', '#b8acd4', '#ece6fa', '#ffffff'];

function paintEye(p: PixelPainter, k: number, open: number, hurt = false): void {
  const cx = 9;
  const cy = 8.5;
  // tendrils hanging below
  for (let i = 0; i < 3; i++) {
    const x0 = 6 + i * 3;
    for (let y = 14; y < 21; y++) {
      const x = x0 + Math.sin(y * 0.8 + k * 1.5 + i * 2) * (y - 13) * 0.25;
      p.px(x, y, y > 18 ? VPINK.mid : i === 1 ? VFLESH[3] : VFLESH[2]);
    }
  }
  // fleshy socket
  p.circle(cx, cy, 7.4, VFLESH[2]);
  sphere(p, cx, cy, 7.4, 7.4, VFLESH, false);
  // eyeball
  p.circle(cx, cy, 6, EYEW[2]);
  sphere(p, cx, cy, 6, 6, EYEW, false);
  // veins
  for (const [x, y] of [[4, 9], [5, 11], [13, 7], [14, 9], [12, 12]]) p.px(x, y, '#ff6a9a');
  // lids
  const half = open * 5.2;
  for (let y = 0; y < 18; y++) {
    for (let x = 0; x < 18; x++) {
      const inBall = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= 36;
      if (!inBall) continue;
      const dy = y + 0.5 - cy;
      if (Math.abs(dy) > half) p.px(x, y, dy < 0 ? (y < cy - 4 ? VFLESH[4] : VFLESH[3]) : VFLESH[2]);
    }
  }
  // lid rims
  if (open > 0) {
    for (let x = 3; x < 15; x++) {
      const yt = Math.floor(cy - half);
      const yb = Math.floor(cy + half);
      if (p.isSet(x, yt) && (x + 0.5 - cx) ** 2 + (yt + 0.5 - cy) ** 2 <= 36) p.px(x, yt, VFLESH[1]);
      if (p.isSet(x, yb) && (x + 0.5 - cx) ** 2 + (yb + 0.5 - cy) ** 2 <= 36) p.px(x, yb, VFLESH[1]);
    }
  } else {
    p.line(4, Math.floor(cy), 14, Math.floor(cy), hurt ? VPINK.mid : VFLESH[0]);
    p.px(5, Math.floor(cy) + 1, VFLESH[0]);
    p.px(13, Math.floor(cy) + 1, VFLESH[0]);
    if (hurt) {
      p.line(4, Math.floor(cy) - 2, 7, Math.floor(cy) - 1, VFLESH[0]);
      p.line(14, Math.floor(cy) - 2, 11, Math.floor(cy) - 1, VFLESH[0]);
    }
  }
}
frames('veye', 'closed', 2, 18, 21, (p, i) => paintEye(p, i, 0), { fps: 4, outline: VOUT });
frames('veye', 'half', 1, 18, 21, (p) => paintEye(p, 0, 0.45), { outline: VOUT });
frames('veye', 'open', 2, 18, 21, (p, i) => paintEye(p, i, 0.8), { fps: 6, outline: VOUT });
frames('veye', 'hurt', 1, 18, 21, (p) => paintEye(p, 1, 0, true), { outline: VOUT });
defineDrawnSprite('veye_iris', 5, 5, (p) => {
  p.circle(2.5, 2.5, 2.5, VTEAL.mid);
  p.px(1, 1, VTEAL.hot);
  p.rect(2, 1, 1, 3, '#04120c');
  p.px(0, 2, VTEAL.low);
  p.px(4, 2, VTEAL.low);
}, { outline: '#0a3a2c' });

defineEnemy({
  id: 'void_eye',
  name: '공허의 눈',
  hp: 38,
  radius: 7,
  speed: 30,
  flying: true,
  sprite: 'veye_closed',
  shadow: 12,
  spriteYOffset: -9,
  cost: 2,
  floors: [5],
  weight: 1,
  champion: true,
  deathFx: 'void',
  bloodColor: '#c050ff',
  light: { radius: 22, color: '#3cffc4' },
  dieSfx: 'splat',
  *script(e, w) {
    yield w.rng.range(0.3, 1.0);
    let side = w.rng.sign();
    while (true) {
      // closed: drift at mid range
      e.mem.open = 0;
      e.setAnim('veye_closed');
      const t = w.rng.range(1.6, 2.4);
      for (let el = 0; el < t; el += w.dt) {
        const tg = e.target(w);
        const a = Math.atan2(e.y - tg.y, e.x - tg.x) + side * 0.5 * w.dt;
        const gx = tg.x + Math.cos(a) * 90;
        const gy = tg.y + Math.sin(a) * 70;
        e.moveDir(gx - e.x, gy - e.y, Math.min(e.speed, Math.hypot(gx - e.x, gy - e.y) * 2));
        if (e.mem.__bumped) side = -side;
        yield;
      }
      // opening
      e.stop();
      e.setAnim('veye_half');
      e.mem.open = 0.5;
      e.telegraph(0.5);
      w.sfx('orb', { vol: 0.4, pitch: 0.6 });
      gather(w, e.x, e.y - 10, ['#ffffff', VTEAL.mid, VTEAL.low], 8, 16);
      yield 0.5;
      e.setAnim('veye_open');
      e.mem.open = 1;
      yield 0.2;
      const n = e.champion ? 4 : 3;
      for (let i = 0; i < n; i++) {
        e.shootAt(w, null, bullet('eldritch', 4, { speed: 50, homing: 1.5, life: 4.2, range: 400, z: 10 }));
        e.squash(1.15, 0.9);
        yield 0.38;
      }
      yield 0.9;
      e.setAnim('veye_half');
      e.mem.open = 0.5;
      yield 0.15;
    }
  },
  onHurt(e, w, hit) {
    if (e.mem.open >= 1 || hit.kind === 'status') return;
    // the eyelid is armored: closed it takes only a quarter of the damage
    e.hp += appliedDamage(hit, e.hasStatus('weak'), e.hasStatus('freeze')) * 0.75;
    e.mem.blockT = 0.12;
    w.particles.burst(e.x, e.y - 10, { count: 4, speed: [30, 90], life: [0.1, 0.25], colors: ['#ffffff', VFLESH[4]], shape: 'spark', size: [1, 2] });
    if ((e.mem.blockSfxT ?? 0) < w.time) {
      e.mem.blockSfxT = w.time + 0.15;
      w.sfx('shield_block', { vol: 0.25, pitch: 0.7 });
    }
  },
  draw(e, r, w) {
    const yo = -9 + Math.sin(e.age * 2.4) * 1.5;
    e.drawDefault(r, hurtFrame(e, w, 'veye_hurt_0'), yo);
    if (e.mem.open > 0 && w.time - e.lastHurtAt >= 0.24 && !e.hidden) {
      // the iris tracks the player
      const p = w.player;
      const a = Math.atan2(p.y - 6 - (e.y + yo), p.x - e.x);
      const k = e.mem.open >= 1 ? 1 : 0.5;
      r.sprite('veye_iris', e.x + Math.cos(a) * 2.2, e.y + yo - 1.5 + Math.sin(a) * 1.6 * k, { sy: k, flash: e.flash > 0 ? 1 : 0, alpha: e.alpha });
    }
  },
});

// ================================================================== 공허 촉수 (void tentacle)
const TENT = ['#2a0c44', '#4e1a7a', '#7a30b0', '#b060e0', '#e0a0ff'];

/** Tentacle rising `h` px out of the floor; `bend` curls it sideways (+ = forward). */
function paintTentacle(p: PixelPainter, k: number, h: number, bend: number, hurt = false): void {
  const bottom = 29;
  for (let i = 0; i <= h; i++) {
    const t = i / Math.max(1, h);
    const y = bottom - i;
    const cx = 7 + Math.sin(t * Math.PI * 0.9 + k * 0.9) * 2.2 * t + bend * t * t * 5;
    const hw = 3.1 * (1 - t * 0.55) + 0.5;
    for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
      const dx = x + 0.5 - cx;
      if (Math.abs(dx) > hw) continue;
      const c = dx < -hw * 0.45 ? TENT[3] : dx > hw * 0.45 ? TENT[1] : TENT[2];
      p.px(x, y, c);
    }
    // suckers on the inner side
    if (i % 3 === 1 && t < 0.85) p.px(Math.round(cx + hw * 0.6), y, TENT[4]);
    if (i === h) {
      // glowing tip
      p.px(Math.round(cx), y, hurt ? '#ffffff' : VPINK.mid);
      p.px(Math.round(cx), y + 1, VPINK.low);
    }
  }
  if (h > 4) {
    const t = 1;
    const cx = 7 + Math.sin(t * Math.PI * 0.9 + k * 0.9) * 2.2 + bend * 5;
    p.circle(cx, bottom - h + 1.5, 2.2, VPINK.mid);
    p.px(Math.round(cx) - 1, bottom - h + 1, VPINK.hot);
  }
}
frames('vtent', 'rise', 3, 14, 30, (p, i) => paintTentacle(p, 0, [8, 16, 24][i], 0), { anchor: 'bottom', fps: 10, loop: false, outline: VOUT });
frames('vtent', 'sway', 4, 14, 30, (p, i) => paintTentacle(p, i, 26, [0, 0.3, 0, -0.3][i]), { anchor: 'bottom', fps: 7, outline: VOUT });
frames('vtent', 'lash', 2, 14, 30, (p, i) => paintTentacle(p, 1, 24 - i * 3, 0.9 + i * 0.3), { anchor: 'bottom', fps: 12, loop: false, outline: VOUT });
frames('vtent', 'sink', 3, 14, 30, (p, i) => paintTentacle(p, 0, [20, 12, 4][i], 0), { anchor: 'bottom', fps: 9, loop: false, outline: VOUT });
frames('vtent', 'hurt', 1, 14, 30, (p) => paintTentacle(p, 2, 24, -0.5, true), { anchor: 'bottom', outline: VOUT });
defineDrawnSprite('vtent_hole', 18, 7, (p) => {
  p.ellipse(9, 3.5, 9, 3.5, VPINK.low);
  p.ellipse(9, 3.8, 7.6, 2.6, '#0a0212');
  p.ellipse(9, 4.2, 5, 1.6, '#000000');
  p.px(3, 2, VPINK.mid);
  p.px(14, 2, VPINK.mid);
  p.px(9, 0, VPINK.mid);
}, { outline: VOUT });

defineEnemy({
  id: 'void_tentacle',
  name: '공허 촉수',
  hp: 44,
  radius: 6,
  speed: 62,
  mass: Infinity,
  sprite: 'vtent_sway',
  shadow: 0,
  spriteYOffset: 2,
  cost: 2,
  floors: [5],
  weight: 0.9,
  champion: true,
  deathFx: 'void',
  bloodColor: '#b040e0',
  light: { radius: 20, color: '#ff4fae' },
  dieSfx: 'splat',
  init(e) {
    e.mem.under = 1;
    e.vulnerable = false;
    e.harmful = false;
    e.solid = false;
    e.flying = true;
    e.phasing = true;
  },
  *script(e, w) {
    yield w.rng.range(0.2, 0.8);
    while (true) {
      // burrowed: the rift crawls toward the player
      e.mem.under = 1;
      e.vulnerable = false;
      e.harmful = false;
      e.solid = false;
      e.flying = true;
      e.phasing = true;
      const t = w.rng.range(1.0, 1.6);
      for (let el = 0; el < t; el += w.dt) {
        if (e.distToTarget(w) < 14) break;
        e.chase(w, e.speed);
        yield;
      }
      e.halt();
      const spot = landingSpot(w, e.x, e.y, 6);
      e.x = spot.x;
      e.y = spot.y;
      // warning, then erupt
      const R = 16;
      w.spawn(new GroundWarning(e.x, e.y, R, 0.7, undefined, WARN_RED));
      w.sfx('enemy_charge', { vol: 0.4, pitch: 0.55 });
      yield 0.7;
      e.mem.under = 0;
      e.flying = false;
      e.phasing = false;
      e.solid = true;
      e.vulnerable = true;
      e.harmful = true;
      e.setAnim('vtent_rise', true);
      w.shake(0.25);
      w.sfx('splat', { vol: 0.7, pitch: 0.6 });
      for (const p of w.targets()) {
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (p.alive && p.z < 8 && d < R + p.r * 0.5) {
          if (p.hurt(w, 1, e.def.name)) p.knock((p.x - e.x) / (d || 1), (p.y - e.y) / (d || 1), 200);
        }
      }
      w.particles.burst(e.x, e.y, { count: 16, speed: [40, 120], life: [0.3, 0.6], colors: VOIDDUST, size: [1, 2], gravity: 260, vz: [40, 120] });
      w.spawn(new RingFx(e.x, e.y, R + 4, 0.3, VPINK.mid, 2));
      e.shootRing(w, e.champion ? 8 : 6, bullet('void', 3, { speed: 78, offset: w.rng.angle(), z: 6 }));
      yield 0.3;
      // lash a few times
      for (let i = 0; i < 3; i++) {
        e.setAnim('vtent_sway');
        yield 0.5;
        e.facing = w.player.x >= e.x ? 1 : -1;
        e.setAnim('vtent_lash', true);
        e.telegraph(0.3);
        yield 0.3;
        e.shootAt(w, null, bullet('void', 3, { speed: 96, count: 3, spread: 0.24, z: 18 }));
        yield 0.25;
      }
      e.setAnim('vtent_sway');
      yield 0.4;
      // sink back into the floor
      e.setAnim('vtent_sink', true);
      e.harmful = false;
      yield 0.33;
      e.vulnerable = false;
      e.mem.under = 1;
      yield 0.2;
    }
  },
  update(e, w) {
    if (e.mem.under && fx.chance(0.5)) {
      w.particles.spawn({
        x: e.x + fx.range(-5, 5), y: e.y + fx.range(-2, 2), vy: -fx.range(4, 14), life: fx.range(0.25, 0.5),
        colors: ['#ffffff', VPINK.mid, '#6a1aa0'], size: 1, additive: true, light: 3,
      });
    }
  },
  draw(e, r, w) {
    if (e.mem.under) {
      // a crawling rift in the floor
      const k = w.time * 6;
      r.shadow(e.x, e.y, 18, 7, 0.5);
      r.circle(e.x, e.y, 7, '#0a0212', 0.85);
      r.line(e.x - 7, e.y, e.x - 2, e.y - 1, VPINK.low, 1, 0.9);
      r.line(e.x + 2, e.y + 1, e.x + 7, e.y, VPINK.low, 1, 0.9);
      for (let i = 0; i < 5; i++) {
        const a = k + i * 1.26;
        r.rect(e.x + Math.cos(a) * 6, e.y + Math.sin(a) * 3, 1, 1, i % 2 ? VPINK.mid : '#e0a0ff', 1);
      }
      r.ring(e.x, e.y, 7 + Math.sin(k) * 0.8, VPINK.mid, 1, 0.85);
      return;
    }
    r.sprite('vtent_hole', e.x, e.y + 2);
    e.drawDefault(r, hurtFrame(e, w, 'vtent_hurt_0'));
  },
});

// ================================================================== 그림자 분신 (shadow double)
const SHADE = ['#06020c', '#120826', '#22103e'];
const SRIM = '#a868ff';

function paintShadow(p: PixelPainter, k: number, mode: 'stalk' | 'crouch' | 'dash' | 'hurt'): void {
  const step = mode === 'stalk' ? [1, 0, -1, 0][k] : 0;
  const bob = mode === 'stalk' ? [0, -1, 0, -1][k] : mode === 'crouch' ? 2 : 0;
  const lean = mode === 'dash' ? 2 : mode === 'hurt' ? -1 : 0;
  // smoky legs
  p.poly([5 + step, 15 + bob, 7, 15 + bob, 6 + step * 2, 21, 4 + step * 2, 21], SHADE[1]);
  p.poly([8, 15 + bob, 10 - step, 15 + bob, 11 - step * 2, 21, 9 - step * 2, 21], SHADE[1]);
  // torso
  p.poly([4 + lean, 7 + bob, 11 + lean, 7 + bob, 10, 16 + bob, 5, 16 + bob], SHADE[0]);
  // long arms with claws
  if (mode === 'dash') {
    p.line(5 + lean, 9 + bob, 0, 12 + bob, SHADE[1]);
    p.line(10 + lean, 9 + bob, 14, 7 + bob, SHADE[1]);
    p.px(14, 6 + bob, '#ffffff');
    p.px(13, 6 + bob, SRIM);
  } else if (mode === 'crouch') {
    p.line(4, 9 + bob, 1, 14 + bob, SHADE[1]);
    p.line(11, 9 + bob, 13, 14 + bob, SHADE[1]);
    p.px(1, 15 + bob, SRIM);
    p.px(13, 15 + bob, SRIM);
  } else {
    p.line(4 + lean, 8 + bob, 2, 15 + bob - step, SHADE[1]);
    p.line(11 + lean, 8 + bob, 13, 15 + bob + step, SHADE[1]);
    p.px(2, 16 + bob - step, SRIM);
    p.px(13, 16 + bob + step, SRIM);
  }
  // head with wispy smoke top
  p.circle(7.5 + lean, 4.5 + bob, 3.6, SHADE[0]);
  const wisp = [0, 1, 0, -1][k % 4];
  p.poly([5 + lean, 2 + bob, 6 + lean + wisp, -1 + bob, 7.5 + lean, 1.5 + bob], SHADE[1]);
  p.poly([8 + lean, 1.5 + bob, 10 + lean - wisp, -1 + bob, 10.5 + lean, 2.5 + bob], SHADE[1]);
  // rim light on the left/top edges so it reads on the dark floor
  const src = new PixelPainter(p.w, p.h);
  src.blit(p, 0, 0);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (!src.isSet(x, y)) continue;
      if (!src.isSet(x, y - 1) && y < 12) p.px(x, y, SRIM);
      else if (!src.isSet(x - 1, y) && src.isSet(x + 1, y)) p.px(x, y, SHADE[2]);
    }
  }
  // eyes
  const ex = Math.round(7 + lean);
  if (mode === 'hurt') {
    p.px(ex - 1, 4 + bob, '#ff6ad0');
    p.px(ex + 2, 4 + bob, '#ff6ad0');
  } else {
    p.px(ex - 1, 4 + bob, '#ffffff');
    p.px(ex + 2, 4 + bob, '#ffffff');
    p.px(ex - 1, 5 + bob, VPINK.mid);
    p.px(ex + 2, 5 + bob, VPINK.mid);
  }
}
frames('sdouble', 'stalk', 4, 15, 22, (p, i) => paintShadow(p, i, 'stalk'), { anchor: 'bottom', fps: 7, outline: '#7a40c8' });
frames('sdouble', 'crouch', 1, 15, 22, (p) => paintShadow(p, 0, 'crouch'), { anchor: 'bottom', outline: '#7a40c8' });
frames('sdouble', 'dash', 1, 15, 22, (p) => paintShadow(p, 0, 'dash'), { anchor: 'bottom', outline: '#7a40c8' });
frames('sdouble', 'hurt', 1, 15, 22, (p) => paintShadow(p, 0, 'hurt'), { anchor: 'bottom', outline: '#7a40c8' });

/** Split a shadow double in two (once): the twin copies its current health. */
function splitShadow(e: Enemy, w: World, hitDirX: number, hitDirY: number): void {
  e.mem.gen = 1;
  const px = -hitDirY;
  const py = hitDirX;
  const twin = e.summon(w, 'shadow_double', e.x + px * 10, e.y + py * 10);
  w.sfx('teleport', { vol: 0.45, pitch: 0.8 });
  w.spawn(new RingFx(e.x, e.y - 8, 22, 0.35, SRIM, 2));
  w.particles.burst(e.x, e.y - 8, { count: 18, speed: [40, 120], life: [0.3, 0.6], colors: VOIDDUST, size: [1, 2], additive: true });
  e.scale = 0.88;
  e.knock(-px, -py, 140);
  if (!twin) return;
  twin.mem.gen = 1;
  twin.mem.side = -(e.mem.side ?? 1);
  twin.maxHp = e.maxHp;
  twin.hp = Math.max(1, e.hp);
  twin.scale = 0.88;
  twin.dormant = 0.5;
  twin.knock(px, py, 140);
}

defineEnemy({
  id: 'shadow_double',
  name: '그림자 분신',
  hp: 44,
  radius: 5,
  speed: 42,
  sprite: 'sdouble_stalk',
  spriteYOffset: 5,
  shadow: 11,
  cost: 2.5,
  floors: [5],
  weight: 1,
  champion: true,
  deathFx: 'void',
  bloodColor: '#7a3ad0',
  light: { radius: 22, color: '#a868ff' },
  init(e, w) {
    e.mem.gen = e.mem.gen ?? 0;
    e.mem.side = w.rng.sign();
  },
  *script(e, w) {
    yield w.rng.range(0.2, 0.6);
    while (true) {
      e.setAnim('sdouble_stalk');
      // stalk: twins flank from opposite sides
      const t = w.rng.range(1.0, 1.6);
      for (let el = 0; el < t; el += w.dt) {
        const tg = e.target(w);
        const a = Math.atan2(e.y - tg.y, e.x - tg.x) + e.mem.side * 0.5;
        const gx = tg.x + Math.cos(a) * 44;
        const gy = tg.y + Math.sin(a) * 36;
        if (e.mem.gen) e.moveDir(gx - e.x, gy - e.y, e.speed);
        else e.chase(w, e.speed);
        yield;
      }
      const p = w.player;
      if (e.distToTarget(w) > 140 || !w.room.lineOfSight(e.x, e.y, p.x, p.y)) continue;
      // telegraphed dash-slash
      e.halt();
      e.setAnim('sdouble_crouch');
      const a = e.angleToTarget(w);
      e.facing = Math.cos(a) >= 0 ? 1 : -1;
      const len = rayFree(w.room, e.x, e.y, a, e.r, 120);
      laneWarning(w, e.x, e.y, a, len + 8, 10, 0.5);
      e.telegraph(0.5);
      w.sfx('enemy_charge', { vol: 0.35, pitch: 1.3 });
      yield 0.5;
      e.setAnim('sdouble_dash');
      w.sfx('whoosh', { vol: 0.45, pitch: 0.9 });
      e.mem.dashing = 1;
      yield* e.charge(w, a, 240, 0.42);
      e.mem.dashing = 0;
      e.setAnim('sdouble_crouch');
      yield 0.45;
    }
  },
  update(e, w, dt) {
    e.mem.afterT = (e.mem.afterT ?? 0) - dt;
    if (e.mem.dashing && e.mem.afterT <= 0) {
      e.mem.afterT = 0.035;
      w.spawn(new Afterimage(e.frame(), e.x, e.y + 5, e.facing < 0, '#a868ff', 0.3));
    }
    if (fx.chance(0.2)) {
      w.particles.spawn({ x: e.x + fx.range(-4, 4), y: e.y - 16 + fx.range(-2, 2), vy: -fx.range(6, 14), life: fx.range(0.3, 0.6), colors: ['#3a1a6a', '#1a0a30'], size: 2, sizeEnd: 0.5, alpha: 0.7 });
    }
  },
  onHurt(e, w, hit) {
    if (!e.mem.gen && e.alive && e.hp <= e.maxHp * 0.5) splitShadow(e, w, hit.dirX ?? 1, hit.dirY ?? 0);
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'sdouble_hurt_0'));
  },
});

// ================================================================== 차원 추적자 (warp stalker)
const STALK = ['#1a1236', '#2c2254', '#443a7c', '#6a5aa8'];
const MASK = ['#8a8098', '#c8c0d4', '#f0ecf4'];

function paintStalker(p: PixelPainter, k: number, mode: 'walk' | 'strike' | 'dazed' | 'hurt'): void {
  const step = mode === 'walk' ? [2, 0, -2, 0][k] : 0;
  const bob = mode === 'walk' ? [0, -1, 0, -1][k] : mode === 'dazed' ? 3 : 0;
  // long spindly legs
  p.line(7, 18 + bob, 5 + step, 27, STALK[2]);
  p.line(9, 18 + bob, 11 - step, 27, STALK[1]);
  p.px(4 + step, 27, STALK[3]);
  p.px(12 - step, 27, STALK[2]);
  // tattered body
  p.poly([5, 8 + bob, 11, 8 + bob, 12, 19 + bob, 10, 21 + bob, 8, 19 + bob, 6, 21 + bob, 4, 19 + bob], STALK[1]);
  p.line(5, 9 + bob, 4, 19 + bob, STALK[3]);
  p.line(8, 10 + bob, 8, 18 + bob, STALK[0]);
  // scythe arms (teal blades)
  const blade = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) => {
    p.line(x0, y0, x1, y1, STALK[3]);
    // crescent blade: belly bulges away from the body's center line
    const l = Math.hypot(x2 - x1, y2 - y1) || 1;
    let nx = -(y2 - y1) / l;
    let ny = (x2 - x1) / l;
    if (((x1 + x2) / 2 - 8) * nx < 0) { nx = -nx; ny = -ny; }
    p.poly([x1, y1, (x1 + x2) / 2 + nx * 2.5, (y1 + y2) / 2 + ny * 2.5, x2, y2], VTEAL.low);
    p.line(x1, y1, x2, y2, VTEAL.mid);
    p.px(x2, y2, VTEAL.hot);
    p.px(Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2), VTEAL.hot);
  };
  if (mode === 'strike') {
    const s = k ? 1 : 0;
    blade(5, 10 + bob, 1, 7 + bob, 0, 0 + s * 3);
    blade(11, 10 + bob, 14, 7 + bob, 15, 0 + s * 3);
  } else if (mode === 'dazed') {
    blade(5, 10 + bob, 3, 15 + bob, 1, 24);
    blade(11, 10 + bob, 13, 15 + bob, 14, 24);
  } else {
    blade(5, 10 + bob, 2, 14 + bob, 1, 20 + bob - step * 0.5);
    blade(11, 10 + bob, 14, 13 + bob, 14, 19 + bob + step * 0.5);
  }
  // bone mask
  const hy = 4 + bob;
  p.ellipse(8, hy, 3.4, 4.2, MASK[1]);
  sphere(p, 8, hy, 3.4, 4.2, MASK, false);
  p.px(6, hy + 3, MASK[0]);
  p.px(10, hy + 3, MASK[0]);
  // single slit eye
  const eye = mode === 'dazed' || mode === 'hurt' ? VTEAL.low : VTEAL.mid;
  p.rect(8, hy - 2, 1, 4, '#04120c');
  p.px(8, hy - 1, eye);
  p.px(8, hy, mode === 'strike' ? VTEAL.hot : eye);
  // horns
  p.line(6, hy - 3, 4, hy - 6, STALK[3]);
  p.line(10, hy - 3, 12, hy - 6, STALK[3]);
}
frames('wstalker', 'walk', 4, 16, 28, (p, i) => paintStalker(p, i, 'walk'), { anchor: 'bottom', fps: 6, outline: '#24104a' });
frames('wstalker', 'strike', 2, 16, 28, (p, i) => paintStalker(p, i, 'strike'), { anchor: 'bottom', fps: 14, loop: false, outline: '#24104a' });
frames('wstalker', 'dazed', 1, 16, 28, (p) => paintStalker(p, 0, 'dazed'), { anchor: 'bottom', outline: '#24104a' });
frames('wstalker', 'hurt', 1, 16, 28, (p) => paintStalker(p, 0, 'hurt'), { anchor: 'bottom', outline: '#24104a' });

defineEnemy({
  id: 'warp_stalker',
  name: '차원 추적자',
  hp: 46,
  radius: 6,
  speed: 34,
  sprite: 'wstalker_walk',
  spriteYOffset: 5,
  shadow: 12,
  cost: 3,
  floors: [5],
  weight: 0.8,
  champion: true,
  deathFx: 'void',
  bloodColor: '#3cffc4',
  light: { radius: 26, color: '#3cffc4' },
  *script(e, w) {
    yield w.rng.range(0.3, 0.8);
    while (true) {
      e.setAnim('wstalker_walk');
      yield* e.chaseFor(w, w.rng.range(1.0, 1.6), e.speed);
      const strikes = e.champion ? 3 : 2;
      for (let s = 0; s < strikes; s++) {
        // phase out
        e.vulnerable = false;
        e.harmful = false;
        w.sfx('teleport', { vol: 0.4, pitch: 0.9 });
        w.particles.burst(e.x, e.y - 12, { count: 12, speed: [20, 70], life: [0.3, 0.5], colors: ['#ffffff', VTEAL.mid, '#4a3c88'], size: [1, 2], additive: true });
        yield* fadeTo(e, w, 0, 0.2);
        e.hidden = true;
        // mark the arrival point beside the player
        const p = w.player;
        const a = w.rng.angle();
        const spot = landingSpot(w, p.x + Math.cos(a) * 18, p.y + Math.sin(a) * 14, e.r);
        const R = 26;
        w.spawn(new GroundWarning(spot.x, spot.y, R, 0.75, undefined, WARN_RED));
        w.sfx('warn', { vol: 0.3, pitch: 1.2 });
        for (let el = 0; el < 0.75; el += w.dt) {
          if (fx.chance(0.6)) {
            const q = fx.angle();
            w.particles.spawn({
              x: spot.x + Math.cos(q) * 10, y: spot.y - 10 + Math.sin(q) * 10, vx: -Math.cos(q) * 30, vy: -Math.sin(q) * 30,
              life: 0.3, colors: ['#ffffff', VTEAL.mid], size: 1, additive: true, light: 3,
            });
          }
          yield;
        }
        // re-form and slash
        e.x = spot.x;
        e.y = spot.y;
        e.hidden = false;
        e.alpha = 1;
        e.vulnerable = true;
        e.harmful = true;
        e.facing = w.player.x >= e.x ? 1 : -1;
        e.setAnim('wstalker_strike', true);
        w.sfx('swing_heavy', { vol: 0.55, pitch: 0.8 });
        w.shake(0.2);
        for (const pl of w.targets()) {
          const d = Math.hypot(pl.x - e.x, pl.y - e.y);
          if (pl.alive && pl.z < 8 && d < R + pl.r * 0.5) {
            if (pl.hurt(w, 2, e.def.name)) pl.knock((pl.x - e.x) / (d || 1), (pl.y - e.y) / (d || 1), 220);
          }
        }
        w.spawn(new RingFx(e.x, e.y - 6, R, 0.25, VTEAL.mid, 3));
        w.particles.burst(e.x, e.y - 8, { count: 14, speed: [80, 180], life: [0.15, 0.3], colors: ['#ffffff', VTEAL.hot, VTEAL.mid], shape: 'spark', size: [1, 2] });
        yield 0.45;
      }
      // exhausted: a punish window
      e.setAnim('wstalker_dazed');
      e.mem.dazed = 1;
      yield e.champion ? 0.8 : 1.1;
      e.mem.dazed = 0;
    }
  },
  update(e, w) {
    if (e.mem.dazed && fx.chance(0.3)) {
      w.particles.spawn({ x: e.x + fx.range(-5, 5), y: e.y - 20, vy: -fx.range(4, 10), life: 0.4, colors: [VTEAL.mid, '#4a3c88'], size: 1, additive: true });
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'wstalker_hurt_0'));
  },
});
