// "등불 해방" — the playable characters' special moves (F with a full ember
// gauge). Every release opens with a protective flash that erases nearby enemy
// bullets, then plays a character-specific spectacle. Release damage never
// procs items or refills the ember gauge (noProc).

import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import { Entity } from '../../game/entity';
import { Enemy } from '../../game/enemy';
import { RingFx, GroundWarning } from '../../game/effects';
import { orbSprite } from '../../game/projectile';
import { MeleeSwing, SMEAR_FRAMES, smearSprite } from '../../game/melee';
import { BASE_STATS } from '../../game/stats';
import { angleTo, clamp, dist, rotateToward, TAU } from '../../engine/math';
import { fx } from '../../engine/rng';
import { registerWarmup } from '../../engine/sprites';
import { prewarmLight } from '../../engine/lighting';
import { swordWaveSprite } from '../weapons/sprites';
import { glowSprite } from '../weapons/common';

// ------------------------------------------------------------------ warm caches
// Every sprite / light gradient a release uses is created at load (the boot
// warm-up compiles them), so pressing F never builds canvases mid-frame.
const BLOOM_BOLT = orbSprite(7, '#ffd078');
const BLOOM_PETAL = glowSprite(7, '#ffd078');
const BLOOM_HALO = glowSprite(34, '#ffb040');
const WHIRL_WAVE = swordWaveSprite('#ffe2a0');
const WHIRL_COLORS = ['#cfe0ff', '#ffe2a0'];
/** whirlwind swing reach (see releaseWhirlwind) */
const whirlReach = (range: number) => 38 + range * 0.03;
// full-circle smears of the whirlwind at the base range (other ranges compile on first use)
for (const c of WHIRL_COLORS) for (let f = 0; f < SMEAR_FRAMES; f++) smearSprite(whirlReach(BASE_STATS.range), TAU, c, f);
registerWarmup(() => {
  prewarmLight('#ffc050', 22); // bloom bolts
  prewarmLight('#ffc070', 30, 120); // bloom halo (shrinks to 36)
  prewarmLight('#ffe2a0', 22); // sword waves
  prewarmLight('#b8d0ff', 90); // whirlwind
  prewarmLight('#ffe08a', 18); // falling arrows
  prewarmLight('#9a50ff', 110); // abyss
  prewarmLight('#ffffff', 5, 14); // burst / spark particle lights
});

// ====================================================================== shared
/** Erase enemy bullets (and lobbed shots / puddles) within `radius` of (x, y) with a little spark each. */
export function clearBullets(w: World, x: number, y: number, radius: number): number {
  return w.clearEnemyBullets(x, y, radius);
}

/** A special-move hit on an enemy (no item procs, no ember). */
export function releaseHit(w: World, e: Enemy, damage: number, fromX: number, fromY: number, knockback = 120, statuses?: { kind: 'burn' | 'slow' | 'fear'; duration: number; power?: number }[]): boolean {
  const d = Math.hypot(e.x - fromX, e.y - fromY) || 1;
  return w.applyHit(e, {
    damage, kind: 'explosion', attacker: w.player, dirX: (e.x - fromX) / d, dirY: (e.y - fromY) / d, knockback, noProc: true, release: true, statuses,
  });
}

/**
 * Per-target diminishing returns for a release that lands many hits: the n-th
 * hit on the same enemy deals `decay^n` of the base (never below `min`). A crowd
 * still takes the whole storm at full strength; a lone target (a boss) can't
 * soak every bolt, so single-target burst stays in line across characters.
 */
export class HitFalloff {
  private hits = new Map<number, number>();
  constructor(readonly decay: number, readonly min = 0.1) {}

  /** Damage multiplier for the next hit on `e` (counts that hit). */
  next(e: Enemy): number {
    const n = this.hits.get(e.id) ?? 0;
    this.hits.set(e.id, n + 1);
    return Math.max(this.min, Math.pow(this.decay, n));
  }
}

/** 리아's bloom bolts / 세린's falling arrows on one target: see HitFalloff. */
export const BLOOM_FALLOFF = 0.85;
export const ARROW_FALLOFF = 0.9;

function flareOpen(w: World, p: Player, color: string, radius: number): void {
  w.renderer.screenFlash(color, 0.3);
  w.shake(0.35);
  w.spawn(new RingFx(p.x, p.y - 6, radius, 0.4, color, 3));
  w.spawn(new RingFx(p.x, p.y - 6, radius * 0.6, 0.3, '#ffffff', 2));
  clearBullets(w, p.x, p.y, radius * 1.3);
}

/**
 * Lightweight seeking shot used by releases: moves, optionally homes, and
 * applies noProc hits (so it never refills the gauge it came from).
 */
export class ReleaseShot extends Entity {
  ang: number;
  speed: number;
  damage: number;
  homing: number;
  sprite: string;
  color: string;
  life: number;
  pierce: number;
  spin: number;
  falloff: HitFalloff | null;
  hit = new Set<number>();
  /** color arrays / light color resolved once (no per-frame string building) */
  private trailCols: string[];
  private burstCols: string[];
  private lightCol: string;
  constructor(x: number, y: number, ang: number, o: { speed: number; damage: number; homing?: number; sprite: string; color: string; life?: number; radius?: number; pierce?: number; spin?: number; falloff?: HitFalloff }) {
    super();
    this.x = x;
    this.y = y;
    this.ang = ang;
    this.speed = o.speed;
    this.damage = o.damage;
    this.homing = o.homing ?? 0;
    this.sprite = o.sprite;
    this.color = o.color;
    this.life = o.life ?? 1.6;
    this.r = o.radius ?? 4;
    this.pierce = o.pierce ?? 0;
    this.spin = o.spin ?? 0;
    this.falloff = o.falloff ?? null;
    this.trailCols = [this.color, this.color + '80'];
    this.burstCols = ['#ffffff', this.color];
    this.lightCol = this.color.slice(0, 7);
    this.team = 'player';
    this.tileCollide = false;
    this.layer = 1;
    this.z = 5;
  }

  override get sortY(): number {
    return this.y + 2;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.age >= this.life) {
      this.vanish(w);
      return;
    }
    if (this.homing > 0 && this.age > 0.12) {
      const t = w.nearestEnemy(this.x, this.y, 220, this.hit);
      if (t) this.ang = rotateToward(this.ang, angleTo(this.x, this.y, t.x, t.y), this.homing * dt);
    }
    this.ang += this.spin * dt;
    this.x += Math.cos(this.ang) * this.speed * dt;
    this.y += Math.sin(this.ang) * this.speed * dt;
    if (w.room.tileAtPx(this.x, this.y) === 1) {
      this.vanish(w);
      return;
    }
    if (fx.chance(0.6)) {
      w.particles.spawn({ x: this.x, y: this.y - this.z, life: 0.2, colors: this.trailCols, size: 1.5, sizeEnd: 0.5, additive: true });
    }
    for (const e of w.enemies) {
      if (!e.alive || e.hidden || this.hit.has(e.id)) continue;
      if (dist(this.x, this.y, e.x, e.y - e.z * 0.3) > this.r + e.r) continue;
      this.hit.add(e.id);
      releaseHit(w, e, this.damage * (this.falloff?.next(e) ?? 1), this.x - Math.cos(this.ang) * 8, this.y - Math.sin(this.ang) * 8, 90);
      if (this.pierce-- <= 0) {
        this.vanish(w);
        return;
      }
    }
  }

  vanish(w: World): void {
    if (this.dead) return;
    this.dead = true;
    w.particles.burst(this.x, this.y - this.z, { count: 5, speed: [20, 70], life: [0.1, 0.3], colors: this.burstCols, size: [1, 2], additive: true });
  }

  override draw(r: Renderer): void {
    r.shadow(this.x, this.y + 1, this.r * 1.4, this.r * 0.6, 0.2);
    r.sprite(this.sprite, this.x, this.y - this.z, { rot: this.ang });
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - this.z, 22, this.lightCol, SHOT_LIGHT);
  }
}

const SHOT_LIGHT = { intensity: 0.8 };

/** Entity that runs a timed callback every frame for `dur` seconds, following the player. */
class Timeline extends Entity {
  dur: number;
  fn: (w: World, t: number, dt: number, self: Timeline) => void;
  end?: (w: World) => void;
  drawFn?: (r: Renderer, w: World, t: number) => void;
  lightFn?: (w: World, t: number) => void;
  constructor(dur: number, fn: Timeline['fn'], o: { end?: (w: World) => void; draw?: Timeline['drawFn']; light?: Timeline['lightFn']; layer?: number } = {}) {
    super();
    this.dur = dur;
    this.fn = fn;
    this.end = o.end;
    this.drawFn = o.draw;
    this.lightFn = o.light;
    this.layer = o.layer ?? 2;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    this.x = w.player.x;
    this.y = w.player.y;
    this.fn(w, this.age, dt, this);
    if (this.age >= this.dur && !this.dead) {
      this.dead = true;
      this.end?.(w);
    }
  }

  override draw(r: Renderer, w: World): void {
    this.drawFn?.(r, w, this.age);
  }

  override light(w: World): void {
    this.lightFn?.(w, this.age);
  }
}

// ====================================================================== 리아: 등불 개화
/**
 * Lantern Bloom: a warm flare clears bullets and scorches everything close,
 * then the lantern blooms — two counter-rotating spirals of homing flame bolts
 * for 1.4 seconds.
 */
export function releaseLanternBloom(w: World, p: Player): void {
  flareOpen(w, p, '#ffd080', 100);
  w.sfx('fire', { vol: 1 });
  w.sfx('explosion', { vol: 0.5, pitch: 1.4 });
  w.particles.burst(p.x, p.y - 6, { count: 50, speed: [60, 220], life: [0.3, 0.7], colors: ['#ffffff', '#ffe080', '#ff9a30', '#c04010'], size: [1, 3], additive: true, light: 6 });
  for (const e of w.enemiesInRadius(p.x, p.y, 60)) {
    releaseHit(w, e, p.stats.damage * 2.5, p.x, p.y, 260, [{ kind: 'burn', duration: 3, power: p.stats.damage * 0.5 }]);
  }
  // 리아 fills the gauge fastest (her passive), so each bloom bolt hits a little softer
  const dmg = p.stats.damage * 0.85;
  const falloff = new HitFalloff(BLOOM_FALLOFF);
  let acc = 0;
  let k = 0;
  w.spawn(new Timeline(1.4, (ww, t, dt) => {
    acc += dt;
    const pl = ww.player;
    while (acc >= 0.05) {
      acc -= 0.05;
      k++;
      const base = t * 5.2;
      for (let i = 0; i < 2; i++) {
        const a = (i === 0 ? base : -base * 1.15 + Math.PI) + k * 0.06;
        ww.spawn(new ReleaseShot(pl.x + Math.cos(a) * 8, pl.y - 6 + Math.sin(a) * 6, a, {
          speed: 170, damage: dmg, homing: 5.5, sprite: BLOOM_BOLT, color: '#ffc050', life: 1.5, radius: 4, falloff,
        }));
      }
      if (k % 3 === 0) ww.sfx('shoot_magic', { vol: 0.35, pitch: 1.2 + fx.range(-0.1, 0.1) });
    }
  }, {
    draw(r, ww, t) {
      const pl = ww.player;
      const a = 1 - t / 1.4;
      // rotating petal halo around Ria
      for (let i = 0; i < 6; i++) {
        const an = t * 4 + (i / 6) * TAU;
        r.sprite(BLOOM_PETAL, pl.x + Math.cos(an) * 14, pl.y - 6 + Math.sin(an) * 10, { alpha: 0.9 * a, additive: true });
      }
      r.sprite(BLOOM_HALO, pl.x, pl.y - 6, { alpha: 0.45 * a, additive: true });
    },
    light(ww, t) {
      ww.lights.add(ww.player.x, ww.player.y - 6, 120 * (1 - t / 2), '#ffc070', { intensity: 0.9 });
    },
  }));
}

// ====================================================================== 베른: 등불 회전베기
/**
 * Whirlwind: Bern spins with a lantern-lit blade for one second (full-circle
 * swings that reflect bullets, the player can steer), then ends with eight
 * sword waves radiating outward.
 */
export function releaseWhirlwind(w: World, p: Player): void {
  flareOpen(w, p, '#b8d0ff', 80);
  w.sfx('swing_heavy', { vol: 1 });
  const dur = 1.05;
  p.weapon.mem.hideUntil = w.time + dur;
  let acc = 0.12;
  let n = 0;
  w.spawn(new Timeline(dur, (ww, t, dt) => {
    const pl = ww.player;
    pl.invuln = Math.max(pl.invuln, dur - t + 0.15);
    acc += dt;
    while (acc >= 0.12) {
      acc -= 0.12;
      n++;
      ww.spawn(new MeleeSwing(pl, {
        angle: t * 22, arc: TAU, reach: whirlReach(pl.stats.range), damage: pl.stats.damage * 1.1, knockback: 160,
        color: WHIRL_COLORS[n % 2 ? 0 : 1], reflect: true, visual: 0.14, duration: 0.08, noProc: true, release: true, hitKick: 0.8,
        swingDir: 1,
      }));
      ww.sfx('swing', { vol: 0.5, pitch: 0.9 + (n % 3) * 0.08 });
      if (n % 2 === 0) ww.shake(0.08);
    }
    if (fx.chance(0.8)) {
      const a = fx.angle();
      ww.particles.spawn({ x: pl.x + Math.cos(a) * 30, y: pl.y - 4 + Math.sin(a) * 22, vx: -Math.sin(a) * 120, vy: Math.cos(a) * 90, life: 0.2, colors: ['#ffffff', '#b8d0ff'], size: 1, additive: true, light: 10 });
    }
  }, {
    end(ww) {
      const pl = ww.player;
      ww.sfx('slam', { vol: 0.9 });
      ww.sfx('whoosh', { vol: 0.6 });
      ww.shake(0.4);
      ww.renderer.screenFlash('#ffe2a0', 0.25);
      ww.spawn(new RingFx(pl.x, pl.y - 4, 60, 0.35, '#ffe2a0', 3));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        ww.spawn(new ReleaseShot(pl.x + Math.cos(a) * 10, pl.y - 6 + Math.sin(a) * 8, a, {
          speed: 260, damage: pl.stats.damage * 1.8, sprite: WHIRL_WAVE, color: '#ffe2a0', life: 0.65, radius: 7, pierce: 99,
        }));
      }
    },
    draw(r, ww, t) {
      // the spinning blade itself
      const pl = ww.player;
      const a = t * 22;
      const rr = 14;
      r.sprite('w_sentinel_blade', pl.x + Math.cos(a) * 3, pl.y - 5 + Math.sin(a) * 2.4, { rot: a, sx: 1.25, sy: 1.25 });
      r.ring(pl.x, pl.y - 4, rr + 18, '#cfe0ff', 1, 0.25 + 0.15 * Math.sin(t * 40));
    },
    light(ww) {
      ww.lights.add(ww.player.x, ww.player.y - 6, 90, '#b8d0ff', { intensity: 0.8 });
    },
  }));
}

// ====================================================================== 세린: 별똥 화살비
/** One falling arrow: a streak from the sky, then a small piercing impact. */
class FallingArrow extends Entity {
  delay: number;
  fall = 0.2;
  damage: number;
  falloff: HitFalloff | null;
  constructor(x: number, y: number, delay: number, damage: number, falloff: HitFalloff | null = null) {
    super();
    this.x = x;
    this.y = y;
    this.delay = delay;
    this.damage = damage;
    this.falloff = falloff;
    this.layer = 1;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.age < this.delay + this.fall) return;
    this.dead = true;
    w.particles.burst(this.x, this.y, { count: 8, speed: [30, 110], life: [0.12, 0.3], colors: ['#ffffff', '#ffe08a', '#a8e070'], shape: 'spark', size: [1, 2], light: 6 });
    w.particles.burst(this.x, this.y, { count: 4, speed: [10, 40], life: [0.3, 0.6], colors: ['#8a7a6a', '#5a4a3a'], size: [1, 2], gravity: 200, vz: [30, 70] });
    w.decal(this.x, this.y, '#1a1410', 1.5, 0.4);
    w.sfx('hit', { vol: 0.25, pitch: 1.4 + fx.range(-0.1, 0.1) });
    for (const e of w.enemiesInRadius(this.x, this.y, 11)) releaseHit(w, e, this.damage * (this.falloff?.next(e) ?? 1), this.x, this.y - 10, 50);
  }

  override get sortY(): number {
    return this.y;
  }

  override draw(r: Renderer): void {
    if (this.age < this.delay) {
      // target marker
      const t = this.age / Math.max(0.01, this.delay);
      r.ring(this.x, this.y, 7 - t * 4, '#ffe08a', 1, 0.3 + t * 0.5);
      return;
    }
    const t = clamp((this.age - this.delay) / this.fall, 0, 1);
    const h = (1 - t) * 110;
    r.shadow(this.x, this.y, Math.round(6 * t + 2), 2, 0.3 * t);
    r.line(this.x + 2, this.y - h - 26, this.x, this.y - h, '#fff0c0', 1, 0.5);
    r.sprite('proj_arrow_glow', this.x, this.y - h, { rot: Math.PI / 2 + 0.08 });
  }

  override light(w: World): void {
    if (this.age >= this.delay) w.lights.add(this.x, this.y - (1 - (this.age - this.delay) / this.fall) * 110, 18, '#ffe08a', { intensity: 0.7 });
  }
}

/**
 * Arrow Rain: Serin looses a lantern-lit arrow straight up; it bursts into a
 * shower of falling arrows that seek out every enemy in the room for ~1.6s.
 */
export function releaseArrowRain(w: World, p: Player): void {
  flareOpen(w, p, '#d8f0b0', 80);
  w.sfx('shoot_arrow', { vol: 1, pitch: 0.7 });
  w.sfx('whoosh', { vol: 0.6, pitch: 0.7 });
  const sx = p.x;
  const sy = p.y;
  const falloff = new HitFalloff(ARROW_FALLOFF);
  let acc = 0;
  let idx = 0;
  w.spawn(new Timeline(2.0, (ww, t, dt) => {
    if (t < 0.32) return;
    if (t - dt < 0.32) {
      ww.renderer.screenFlash('#fff0c0', 0.2);
      ww.sfx('lightning', { vol: 0.5, pitch: 1.6 });
    }
    if (t > 1.95) return;
    acc += dt;
    while (acc >= 0.045) {
      acc -= 0.045;
      idx++;
      const foes = ww.enemies.filter((e) => e.alive && !e.hidden);
      let tx: number;
      let ty: number;
      if (foes.length && idx % 4 !== 0) {
        const e = foes[idx % foes.length];
        tx = e.x + ww.rng.range(-7, 7) + e.vx * 0.2;
        ty = e.y + ww.rng.range(-5, 5) + e.vy * 0.2;
      } else {
        const pos = ww.room.randomFreePos(ww.rng, 6);
        tx = pos.x;
        ty = pos.y;
      }
      ww.spawn(new FallingArrow(tx, ty, 0.12, ww.player.stats.damage * 1.25, falloff));
    }
  }, {
    draw(r, _ww, t) {
      if (t < 0.32) {
        const h = (t / 0.32) * 160;
        r.sprite('proj_arrow_glow', sx, sy - 10 - h, { rot: -Math.PI / 2 });
        r.line(sx, sy - 10 - h + 6, sx, sy - 10 - h + 30, '#fff0c0', 1, 0.6);
      }
    },
  }));
}

// ====================================================================== 니엘: 심연 개방
/** The black hole of Niel's release. */
class AbyssFx extends Entity {
  dur = 2.1;
  dmg: number;
  tick = 0;
  constructor(x: number, y: number, dmg: number) {
    super();
    this.x = x;
    this.y = y;
    this.dmg = dmg;
    this.layer = 0;
    this.tileCollide = false;
  }

  get radius(): number {
    const t = this.age / this.dur;
    return 10 + 20 * Math.min(1, this.age / 0.3) * (t > 0.9 ? Math.max(0, 1 - (t - 0.9) * 10) : 1);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const pull = 95;
    // drag enemies in
    for (const e of w.enemies) {
      if (!e.alive || e.hidden) continue;
      const d = dist(e.x, e.y, this.x, this.y);
      if (d > pull || d < 2) continue;
      const k = (1 - d / pull) * (e.isBoss ? 120 : 520) * dt;
      e.knock((this.x - e.x) / d, (this.y - e.y) / d, k * Math.max(0.2, e.mass));
    }
    // swallow bullets
    for (const pr of w.projectiles) {
      if (pr.team !== 'enemy' || pr.dead) continue;
      const d = dist(pr.x, pr.y, this.x, this.y);
      if (d > pull * 1.2) continue;
      if (d < this.radius) {
        pr.expire(w, false);
        continue;
      }
      pr.angle = rotateToward(pr.angle, angleTo(pr.x, pr.y, this.x, this.y), 8 * dt);
      pr.syncVel();
    }
    // grinding damage
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.32;
      for (const e of w.enemiesInRadius(this.x, this.y, this.radius + 10)) releaseHit(w, e, this.dmg * 0.8, this.x, this.y, -40, [{ kind: 'slow', duration: 0.5, power: 0.5 }]);
    }
    // inward spiral particles
    for (let i = 0; i < 2; i++) {
      const a = fx.angle();
      const r = fx.range(30, 80);
      w.particles.spawn({
        x: this.x + Math.cos(a) * r, y: this.y + Math.sin(a) * r * 0.7,
        vx: -Math.cos(a) * r * 2.2 - Math.sin(a) * 60, vy: -Math.sin(a) * r * 1.5 + Math.cos(a) * 40,
        life: 0.4, colors: ['#e8d0ff', '#a060ff', '#3a1870'], size: 1.5, sizeEnd: 0.5, additive: true,
      });
    }
    if (this.age >= this.dur) {
      this.dead = true;
      this.collapse(w);
    }
  }

  collapse(w: World): void {
    w.sfx('explosion', { vol: 1, pitch: 0.7 });
    w.sfx('boss_phase', { vol: 0.5, pitch: 1.4 });
    w.shake(0.7);
    w.hitstop(0.06);
    w.renderer.screenFlash('#e8d0ff', 0.45);
    for (let i = 0; i < 3; i++) w.spawn(new RingFx(this.x, this.y, 50 + i * 22, 0.3 + i * 0.12, i === 1 ? '#ffffff' : '#a060ff', 3));
    w.particles.burst(this.x, this.y, { count: 60, speed: [60, 260], life: [0.3, 0.8], colors: ['#ffffff', '#e8d0ff', '#a060ff', '#3a1870'], size: [1, 3], additive: true, light: 8 });
    w.decal(this.x, this.y, '#140a20', 16, 0.6);
    for (const e of w.enemiesInRadius(this.x, this.y, 72)) releaseHit(w, e, this.dmg * 4.5, this.x, this.y, 320);
    clearBullets(w, this.x, this.y, 110);
  }

  override draw(r: Renderer, w: World): void {
    const rad = this.radius;
    const t = w.time;
    r.circle(this.x, this.y, rad + 6, '#a060ff', 0.18);
    r.circle(this.x, this.y, rad + 2, '#5a20c0', 0.5);
    r.circle(this.x, this.y, rad, '#05020a', 1);
    for (let i = 0; i < 3; i++) r.ring(this.x, this.y, rad + 8 + ((t * 40 + i * 12) % 36) * -1 + 30, '#c890ff', 1, 0.35);
    r.ring(this.x, this.y, rad, '#e8d0ff', 1, 0.9);
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y, 110, '#9a50ff', { intensity: 0.9 });
  }
}

/**
 * Abyss: Niel tears open a black hole where it aims (up to ~90px away). It drags
 * enemies in, swallows bullets and grinds for ~2s, then collapses in a burst.
 */
export function releaseAbyss(w: World, p: Player): void {
  flareOpen(w, p, '#c8a0ff', 70);
  w.sfx('beam_charge', { vol: 0.9, pitch: 0.6 });
  w.sfx('summon', { vol: 0.6, pitch: 0.8 });
  const d = 70;
  let x = p.x + Math.cos(p.aim) * d;
  let y = p.y - 2 + Math.sin(p.aim) * d;
  const free = w.room.nearestFree(x, y, 6);
  x = free.x;
  y = free.y;
  w.spawn(new GroundWarning(x, y, 30, 0.25, undefined, '#a060ff'));
  w.spawn(new AbyssFx(x, y, p.stats.damage));
}
