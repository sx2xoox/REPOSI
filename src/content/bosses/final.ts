// Floor 5 final boss: 무명 (無明) — 등불을 삼킨 어둠.
// A great iron lantern whose flame was eaten by a single void eye, with two shadow
// hands and four braziers (the last lights of the abyss) burning in the arena corners.
// Phase 1: hand slams (warned circles), the gaze (tracking laser that sweeps), star
//   rings with gaps, void eyes summoned from its palms.
// Phase 2 (≤66%): the cage cracks and a thorn crown rises — claw swipes (fan
//   telegraphs), void spirals, void moths that fly to the braziers and snuff them,
//   and 빛 삼키기: the eye snuffs every brazier and grows an eclipse orb. Relight two
//   braziers (touch them) or use 등불 해방 to blind it (stunned, takes +50% damage);
//   otherwise the orb bursts into a gapped eclipse wave and the room stays dark.
// Phase 3 (≤33%): the lantern bursts — the eye now sits inside a black sun ringed by
//   cage shards; everything is faster (triple beams, five slams with shock rings).
// When it falls, FinalDawn floods the arena with light before the victory screen.

import { defineBoss, defineEnemy } from '../../game/defs';
import { Entity } from '../../game/entity';
import { GroundWarning, RingFx } from '../../game/effects';
import { Projectile } from '../../game/projectile';
import { audio } from '../../audio/audio';
import { fx } from '../../engine/rng';
import { angleDiff, clamp, ease, TAU } from '../../engine/math';
import { VIEW_H, VIEW_W, type Renderer } from '../../engine/renderer';
import type { Enemy, ShootOpts } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Script } from '../../engine/script';
import { bullet, gather } from '../enemies/shared';
import {
  Beam, bossDeathBurst, clearEnemyShots, dissolveMinions, gapRing, hitPlayerCircle, inRoom, minionCount, phaseDone, phaseGate,
  phaseShift, pickPattern, Sector, ShockRing, spiralAngles, summonMinion,
} from './final-kit';
import { EMBER, eyeSprite, GLASS, IRON, SHADE, VMAG, defineFinalArt, type EyeState, type HandPose } from './final-art';

defineFinalArt();

const NAME = '무명';
const VMAG_FX = [VMAG[5], VMAG[4], VMAG[3], VMAG[2]];
const EMBER_FX = [EMBER[4], EMBER[3], EMBER[2]];
/** eye height above the arena top (entity position = eye centre) */
const HOME_DY = 34;

type HandEnt = InstanceType<typeof Hand>;
type BrazierEnt = InstanceType<typeof Brazier>;

function hands(e: Enemy): HandEnt[] {
  return (e.mem.hands as HandEnt[] | undefined) ?? [];
}
function braziers(e: Enemy): BrazierEnt[] {
  return (e.mem.braziers as BrazierEnt[] | undefined) ?? [];
}
function eyeY(e: Enemy): number {
  return e.y + (e.mem.bob ?? 0);
}
function voidShot(speed: number, size = 3, extra: ShootOpts = {}): ShootOpts {
  return bullet('void', size, { speed, z: 6, ...extra });
}
function starShot(speed: number, extra: ShootOpts = {}): ShootOpts {
  return { color: VMAG[3], sprite: 'mmy_star', spriteRotates: false, radius: 3.5, light: 18, speed, z: 6, ...extra };
}

// ================================================================== arena pieces
/** A shadow hand of the boss (own entity so it y-sorts with the keeper). */
class Hand extends Entity {
  owner: Enemy;
  side: number;
  tx = 0;
  ty = 0;
  tz = 0;
  rate = 6;
  zrate = 8;
  pose: HandPose = 'open';
  busy = false;
  constructor(owner: Enemy, side: number) {
    super();
    this.owner = owner;
    this.side = side;
    this.x = owner.x + side * 54;
    this.y = owner.y + 18;
    this.z = 10;
    this.tileCollide = false;
    this.layer = 1;
  }

  /** Release the hand back to its resting place beside the lantern. */
  rest(): void {
    this.busy = false;
    this.pose = 'open';
    this.rate = 6;
    this.zrate = 8;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const o = this.owner;
    if (!o.alive) {
      w.particles.burst(this.x, this.y - this.z - 4, { count: 22, speed: [20, 90], life: [0.5, 1.1], colors: [SHADE[4], SHADE[3], VMAG[3]], size: [1, 3], gravity: -40, drag: 2 });
      this.dead = true;
      return;
    }
    if (!this.busy) {
      const core = !!o.mem.core;
      this.tx = o.x + this.side * (core ? 60 : 54) + Math.sin(this.age * 1.3 + this.side) * 3;
      this.ty = eyeY(o) + 20 + Math.sin(this.age * 1.9 + this.side * 2) * 3;
      this.tz = 10 + Math.sin(this.age * 2.3 + this.side) * 3;
    }
    const k = Math.min(1, dt * this.rate);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.z += (this.tz - this.z) * Math.min(1, dt * this.zrate);
    if (fx.chance(0.15)) {
      w.particles.spawn({ x: this.x + fx.range(-6, 6), y: this.y - this.z - 12, vy: fx.range(-16, -6), life: fx.range(0.4, 0.8), colors: [SHADE[3], SHADE[2]], size: fx.range(1, 2), alpha: 0.8 });
    }
  }

  override draw(r: Renderer): void {
    const o = this.owner;
    const sh = clamp(1 - this.z / 60, 0.4, 1);
    r.shadow(this.x, this.y + 6, 22 * sh, 7 * sh, 0.35);
    const flash = o.flash > 0 ? 0.8 : o.telegraphT > 0 && Math.floor(o.telegraphT * 16) % 2 === 0 ? 0.45 : 0;
    r.anim(`mmy_hand_${this.pose}`, this.age, this.x, this.y - this.z - 4, { flipX: this.side < 0, flash, alpha: o.alpha });
  }
}

/** One of the four arena braziers. The boss snuffs them; the keeper relights them by touch. */
class Brazier extends Entity {
  owner: Enemy | null;
  lit = true;
  flare = 0;
  lance = 0;
  constructor(x: number, y: number, owner: Enemy | null) {
    super();
    this.x = x;
    this.y = y;
    this.owner = owner;
    this.tileCollide = false;
    this.layer = 1;
  }

  snuff(w: World): void {
    if (!this.lit) return;
    this.lit = false;
    w.sfx('fire', { vol: 0.4, pitch: 0.5 });
    const o = this.owner;
    // embers are pulled toward the eye
    for (let i = 0; i < 10; i++) {
      const tx = o ? o.x : this.x;
      const ty = o ? eyeY(o) : this.y - 40;
      const life = fx.range(0.35, 0.6);
      w.particles.spawn({
        x: this.x + fx.range(-3, 3), y: this.y - 16 + fx.range(-3, 3), vx: (tx - this.x) / life, vy: (ty - this.y + 16) / life,
        life, colors: EMBER_FX, size: fx.range(1, 2), additive: true, light: 5,
      });
    }
    w.particles.burst(this.x, this.y - 16, { count: 8, speed: [8, 30], life: [0.6, 1.2], colors: ['#3a3440', '#2a2430'], size: [2, 3], sizeEnd: 5, gravity: -40, fade: true });
  }

  relight(w: World, quiet = false): void {
    if (this.lit) return;
    this.lit = true;
    this.flare = 1;
    if (!quiet) w.sfx('fire', { vol: 0.7, pitch: 1.3 });
    w.particles.burst(this.x, this.y - 16, { count: 16, speed: [30, 100], life: [0.3, 0.7], colors: EMBER_FX, size: [1, 2], additive: true, light: 6, gravity: -60 });
    w.spawn(new RingFx(this.x, this.y - 12, 22, 0.3, EMBER[3], 2));
    const o = this.owner;
    if (o && o.alive && o.mem.charging) {
      o.mem.relit = (o.mem.relit ?? 0) + 1;
      o.mem.charge = Math.max(0, (o.mem.charge ?? 0) - 0.18);
      o.flash = 0.12;
      this.lance = 0.3;
      w.sfx('laser', { vol: 0.4, pitch: 1.8 });
    }
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    this.flare = Math.max(0, this.flare - dt * 1.5);
    this.lance = Math.max(0, this.lance - dt);
    const p = w.player;
    if (!this.lit && p.alive && Math.hypot(p.x - this.x, p.y - (this.y - 4)) < 14) this.relight(w);
    if (this.lit && fx.chance(0.25)) {
      w.particles.spawn({ x: this.x + fx.range(-3, 3), y: this.y - 24, vy: fx.range(-30, -12), vx: fx.range(-6, 6), life: fx.range(0.3, 0.6), colors: EMBER_FX, size: 1, additive: true });
    } else if (!this.lit && fx.chance(0.06)) {
      w.particles.spawn({ x: this.x + fx.range(-2, 2), y: this.y - 16, vy: -12, life: 1, colors: ['#4a4450', '#2a2430'], size: fx.range(1, 2), sizeEnd: 3, alpha: 0.6, fade: true });
    }
  }

  override draw(r: Renderer, w: World): void {
    r.shadow(this.x, this.y, 12, 4, 0.3);
    r.sprite(this.lit ? 'mmy_brazier' : 'mmy_brazier_off', this.x, this.y);
    if (this.lit) {
      const s = 1 + this.flare * 0.5;
      r.anim('mmy_flame', this.age + this.x * 0.01, this.x, this.y - 14, { sx: s, sy: s });
    } else {
      // a faint blinking ember: "touch me"
      const blink = 0.5 + 0.4 * Math.sin(this.age * 5);
      r.circle(this.x, this.y - 16, 3, EMBER[1], blink * 0.5);
      r.circle(this.x, this.y - 16, 1.5, EMBER[3], blink);
    }
    const o = this.owner;
    if (this.lance > 0 && o) r.line(this.x, this.y - 18, o.x, eyeY(o), EMBER[4], 1 + this.lance * 10, Math.min(1, this.lance * 4));
    void w;
  }

  override light(w: World): void {
    if (!this.lit) {
      w.lights.add(this.x, this.y - 16, 16, '#ff6a20', { intensity: 0.5 + 0.3 * Math.sin(this.age * 5) });
      return;
    }
    const f = 0.85 + Math.sin(this.age * 13 + this.x) * 0.06 + this.flare * 0.4;
    w.lights.add(this.x, this.y - 16, 74 * f, '#ff9a3a', { intensity: 0.95 });
    w.lights.glow(this.x, this.y - 18, 14 + this.flare * 20, '#ff8a24', 0.35 + this.flare * 0.4);
  }
}

/** Darkness that rises as the braziers go out; holes keep the keeper, lights and every threat visible. */
class VoidDark extends Entity {
  owner: Enemy;
  level = 0;
  private cv: HTMLCanvasElement | null = null;
  constructor(owner: Enemy) {
    super();
    this.owner = owner;
    this.layer = 3;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    const target = this.owner.alive ? (this.owner.mem.dark ?? 0) : 0;
    this.level += (target - this.level) * Math.min(1, dt * 3);
    if (!this.owner.alive && this.level < 0.01) this.dead = true;
    void w;
  }

  override draw(r: Renderer, w: World): void {
    if (this.level < 0.02) return;
    if (!this.cv || this.cv.width !== VIEW_W) {
      this.cv = document.createElement('canvas');
      this.cv.width = VIEW_W;
      this.cv.height = VIEW_H;
    }
    const g = this.cv.getContext('2d')!;
    const vx = r.viewX;
    const vy = r.viewY;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, VIEW_W, VIEW_H);
    g.fillStyle = `rgba(4,1,12,${this.level.toFixed(3)})`;
    g.fillRect(0, 0, VIEW_W, VIEW_H);
    g.globalCompositeOperation = 'destination-out';
    const hole = (x: number, y: number, rad: number, k = 1) => {
      const sx = x - vx;
      const sy = y - vy;
      if (sx < -rad || sy < -rad || sx > VIEW_W + rad || sy > VIEW_H + rad) return;
      const grd = g.createRadialGradient(sx, sy, rad * 0.3, sx, sy, rad);
      grd.addColorStop(0, `rgba(0,0,0,${k})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
    };
    const p = w.player;
    hole(p.x, p.y - 6, 62, 1);
    // lit braziers shine through; dead ones keep a faint glow so they can be found
    for (const b of braziers(this.owner)) hole(b.x, b.y - 12, b.lit ? 58 : 20, b.lit ? 1 : 0.75);
    hole(this.owner.x, eyeY(this.owner), 30, 0.8);
    for (const e of w.enemies) if (e.alive && e !== this.owner) hole(e.x, e.y - 4, e.r + 12, 0.7);
    for (const e of w.entities) {
      if (e.dead) continue;
      if (e instanceof Projectile) {
        if (e.team === 'enemy') hole(e.x, e.y - e.z, 11, 1);
      } else if (e instanceof GroundWarning) hole(e.x, e.y, e.radius + 10, 0.9);
      else if (e instanceof Hand) hole(e.x, e.y - e.z, 26, 0.6);
      else if (e instanceof Sector) hole(e.x, e.y, e.o.radius + 6, 0.8);
      else if (e instanceof Beam) {
        g.strokeStyle = 'rgba(0,0,0,0.9)';
        g.lineWidth = e.o.width + 14;
        g.beginPath();
        g.moveTo(e.x - vx, e.y - vy);
        g.lineTo(e.x - vx + Math.cos(e.angle) * e.len, e.y - vy + Math.sin(e.angle) * e.len);
        g.stroke();
      } else if (e instanceof ShockRing) {
        g.strokeStyle = 'rgba(0,0,0,0.9)';
        g.lineWidth = 14;
        g.beginPath();
        g.arc(e.x - vx, e.y - vy, Math.max(1, e.radius), 0, TAU);
        g.stroke();
      }
    }
    for (const e of w.projectiles) if (!e.dead && e.team === 'enemy') hole(e.x, e.y - e.z, 11, 1);
    const c = r.ctx;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.cv, 0, 0);
    c.restore();
  }
}

/** Victory cinematic: light floods the arena from where the darkness fell, then the run is won. */
export class FinalDawn extends Entity {
  static readonly DURATION = 2.6;
  private started = false;
  private ringT = 0;
  constructor(x: number, y: number) {
    super();
    this.x = x;
    this.y = y;
    this.layer = 3;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    const real = dt / Math.max(0.05, w.slowmo);
    if (!this.started) {
      this.started = true;
      w.player.frozen = true;
      clearEnemyShots(w);
      audio.stopMusic(1.6);
      w.sfx('power_up', { vol: 0.8, pitch: 0.6 });
      w.sfx('heal', { vol: 0.6, pitch: 0.5 });
      for (const e of w.entities) if (e instanceof Brazier) e.relight(w, true);
    }
    this.age += real;
    w.slowmo = 0.45;
    w.player.frozen = true;
    const t = this.age / FinalDawn.DURATION;
    this.ringT -= real;
    if (this.ringT <= 0) {
      this.ringT = 0.35;
      w.spawn(new RingFx(this.x, this.y, 50 + t * 160, 0.6, t > 0.5 ? '#ffffff' : '#ffe6a0', 2));
      w.sfx('orb', { vol: 0.3 + t * 0.4, pitch: 0.8 + t * 0.8 });
    }
    w.particles.spawn({
      x: this.x + fx.range(-80, 80) * (0.3 + t), y: this.y + fx.range(-40, 50), vy: fx.range(-60, -20), vx: fx.range(-8, 8),
      life: fx.range(0.6, 1.2), colors: ['#ffffff', '#fff4c0', '#ffd060'], size: fx.range(1, 2), additive: true, light: 4,
    });
    if (this.age > 1.3) w.shake(0.05);
    if (this.age >= FinalDawn.DURATION) {
      this.dead = true;
      w.slowmo = 1;
      w.renderer?.screenFlash('#ffffff', 1);
      w.victory();
    }
  }

  override draw(r: Renderer): void {
    const t = clamp(this.age / FinalDawn.DURATION, 0, 1);
    const c = r.ctx;
    const sx = this.x - r.viewX;
    const sy = this.y - r.viewY;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'lighter';
    // god rays
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + this.age * 0.35 + (i % 2) * 0.1;
      const len = 30 + ease.outCubic(t) * 420;
      c.globalAlpha = (0.12 + 0.3 * t) * (i % 2 ? 0.6 : 1);
      c.strokeStyle = i % 3 ? '#fff0c0' : '#ffffff';
      c.lineWidth = 2 + t * 16 + (i % 3) * 2;
      c.beginPath();
      c.moveTo(sx, sy);
      c.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len);
      c.stroke();
    }
    // light flood
    const R = 12 + ease.inCubic(t) * 460;
    const grd = c.createRadialGradient(sx, sy, 0, sx, sy, R);
    grd.addColorStop(0, `rgba(255,255,255,${Math.min(1, 0.4 + t)})`);
    grd.addColorStop(0.5, `rgba(255,240,200,${Math.min(1, t * 0.9)})`);
    grd.addColorStop(1, 'rgba(255,220,160,0)');
    c.globalAlpha = 1;
    c.fillStyle = grd;
    c.fillRect(sx - R, sy - R, R * 2, R * 2);
    c.globalCompositeOperation = 'source-over';
    if (t > 0.65) {
      c.globalAlpha = Math.min(1, (t - 0.65) / 0.35);
      c.fillStyle = '#fffdf4';
      c.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    c.restore();
  }

  override light(w: World): void {
    const t = clamp(this.age / FinalDawn.DURATION, 0, 1);
    w.lights.add(this.x, this.y, 40 + t * 400, '#fff4d8', { intensity: 1 });
  }
}

/** Called by the boss room's onClear on the last floor: delay the victory screen for the cinematic. */
export function finalVictory(w: World, x: number, y: number): void {
  w.spawn(new FinalDawn(x, y));
}

// ================================================================== void moth (phase 2+ minion)
defineEnemy({
  id: 'void_moth',
  name: '공허 나방',
  hp: 14,
  radius: 5,
  speed: 58,
  flying: true,
  sprite: 'vmoth_fly',
  shadow: 10,
  spriteYOffset: -8,
  deathFx: 'void',
  bloodColor: VMAG[3],
  contactDamage: 1,
  light: { radius: 20, color: '#ff4fae' },
  *script(e, w) {
    const ph = w.rng.angle();
    while (true) {
      const owner = e.mem.owner as Enemy | undefined;
      let goal: BrazierEnt | null = null;
      let best = Infinity;
      for (const b of owner ? braziers(owner) : []) {
        const d = Math.hypot(b.x - e.x, b.y - 16 - e.y);
        if (b.lit && d < best) {
          best = d;
          goal = b;
        }
      }
      const wob = Math.sin(e.age * 7 + ph) * 0.9;
      if (goal) {
        // drawn to the light: reaching a brazier snuffs it
        const a = Math.atan2(goal.y - 16 - e.y, goal.x - e.x) + wob * 0.6;
        e.moveAngle(a, e.speed);
        if (best < 9) goal.snuff(w);
      } else {
        const t = e.target(w);
        e.moveAngle(Math.atan2(t.y - e.y, t.x - e.x) + wob, e.speed * 0.9);
      }
      yield;
    }
  },
});

// ================================================================== patterns
function* hover(e: Enemy, w: World, time: number): Script {
  e.mem.eye = 'open';
  for (let t = 0; t < time; t += w.dt) {
    const room = w.room;
    const p = w.player;
    const gx = clamp(room.centerX + (p.x - room.centerX) * 0.35, room.interiorX + 70, room.interiorX + room.interiorW - 70);
    const gy = room.interiorY + HOME_DY;
    const d = Math.hypot(gx - e.x, gy - e.y);
    e.moveDir(gx - e.x, gy - e.y, Math.min(e.speed * (e.phase >= 2 ? 1.4 : 1), d * 2));
    yield;
  }
  e.stop();
}

function* moveTo(e: Enemy, w: World, x: number, y: number, time: number): Script {
  for (let t = 0; t < time; t += w.dt) {
    const d = Math.hypot(x - e.x, y - e.y);
    e.moveDir(x - e.x, y - e.y, Math.min(90, d * 3));
    yield;
  }
  e.halt();
}

/** 손바닥 내려치기: a hand hovers over a warned circle, then slams down. */
function* slams(e: Enemy, w: World): Script {
  const ph = e.phase;
  const n = [3, 4, 5][ph];
  const warn = [0.8, 0.68, 0.6][ph];
  const hs = hands(e);
  e.halt();
  e.mem.eye = 'wide';
  for (let k = 0; k < n; k++) {
    const h = hs[k % 2];
    if (!h) break;
    const p = w.player;
    const spot = inRoom(w, p.x + p.vx * 0.2, p.y + p.vy * 0.2, 14);
    h.busy = true;
    h.pose = 'open';
    h.rate = 7;
    h.zrate = 6;
    h.tx = spot.x;
    h.ty = spot.y;
    h.tz = 36;
    w.spawn(new GroundWarning(spot.x, spot.y, 22, warn));
    w.sfx('warn', { vol: 0.3, pitch: 0.9 });
    yield warn - 0.12;
    h.pose = 'fist';
    h.tz = 0;
    h.zrate = 40;
    yield 0.12;
    hitPlayerCircle(w, spot.x, spot.y, 22, 1, NAME, 190);
    w.sfx('slam', { vol: 0.8, pitch: 0.7 });
    w.shake(0.45);
    w.particles.burst(spot.x, spot.y, { count: 14, speed: [40, 120], life: [0.3, 0.6], colors: [SHADE[4], SHADE[3], VMAG[2]], size: [1, 3], gravity: 260, vz: [30, 100] });
    w.spawn(new RingFx(spot.x, spot.y, 26, 0.25, VMAG[3], 2));
    if (ph >= 1) {
      const g = w.rng.angle();
      w.spawn(new ShockRing(spot.x, spot.y, {
        speed: 115, maxR: ph >= 2 ? 96 : 76, color: VMAG[2], gaps: [g, g + Math.PI], gapWidth: 1.0, damage: 1, source: NAME, thick: 4,
      }));
    }
    if (ph >= 2) {
      for (const a of gapRing(8, w.rng.angle(), [], 0)) {
        const pr = e.shoot(w, a, voidShot(70));
        pr.x = spot.x;
        pr.y = spot.y;
      }
    }
    yield ph >= 2 ? 0.22 : 0.36;
    h.tz = 14;
    h.zrate = 6;
  }
  yield 0.3;
  for (const h of hs) h.rest();
  yield 0.4;
}

/** 응시: tracking lasers from the eye (aim line -> lock flash -> beam). */
function* gaze(e: Enemy, w: World): Script {
  const ph = e.phase;
  e.halt();
  e.mem.eye = 'wide';
  e.telegraph(0.5);
  w.sfx('beam_charge', { vol: 0.5, pitch: 0.7 });
  gather(w, e.x, eyeY(e), VMAG_FX, 14, 26);
  yield 0.45;
  const follow = (b: Beam) => {
    b.x = e.x;
    b.y = eyeY(e) + 1;
  };
  const fire = (off: number, sweep: number, aim: number) => {
    const a0 = Math.atan2(w.player.y - eyeY(e), w.player.x - e.x) + off;
    w.spawn(new Beam(e.x, eyeY(e), a0, {
      aim, lock: 0.38, fire: ph >= 2 ? 1.0 : 1.3, width: 8, color: VMAG[3], core: VMAG[5], damage: 1, source: NAME, sweep, follow,
      track: (b, ww, dt) => {
        const want = Math.atan2(ww.player.y - b.y, ww.player.x - b.x) + off;
        b.angle += clamp(angleDiff(b.angle, want), -2.2 * dt, 2.2 * dt);
      },
    }));
  };
  if (ph === 0) {
    fire(0, w.rng.sign() * 0.35, 1.0);
    yield 2.9;
  } else if (ph === 1) {
    const s = w.rng.sign();
    fire(0, s * 0.45, 0.9);
    yield 1.5;
    fire(0, -s * 0.45, 0.7);
    yield 2.6;
  } else {
    // a fan of three, then the fan again shifted into the gaps
    for (const off of [-0.7, 0, 0.7]) fire(off, 0, 0.85);
    yield 1.7;
    for (const off of [-0.35, 0.35]) fire(off, 0, 0.6);
    yield 2.2;
  }
  e.mem.eye = 'open';
}

/** 별의 고리: rings of void orbs and stars with two rotating gaps. */
function* starRings(e: Enemy, w: World): Script {
  const ph = e.phase;
  e.halt();
  e.mem.eye = 'wide';
  e.telegraph(0.55);
  w.sfx('orb', { vol: 0.5, pitch: 0.6 });
  gather(w, e.x, eyeY(e), VMAG_FX, 12, 24);
  yield 0.55;
  const n = ph >= 2 ? 5 : 4;
  let g = Math.atan2(w.player.y - eyeY(e), w.player.x - e.x) + w.rng.range(-0.8, 0.8);
  const dir = w.rng.sign();
  let off = w.rng.angle();
  for (let k = 0; k < n; k++) {
    const count = ph >= 1 ? 26 : 22;
    for (const a of gapRing(count, off, [g, g + Math.PI], 0.62)) {
      const pr = e.shoot(w, a, k % 2 ? starShot(62 + ph * 6) : voidShot(74 + ph * 6));
      pr.x = e.x + Math.cos(a) * 10;
      pr.y = eyeY(e) + Math.sin(a) * 10;
    }
    w.sfx('enemy_shoot', { vol: 0.4, pitch: 0.7 + k * 0.1 });
    g += dir * 0.38;
    off += 0.12;
    yield ph >= 2 ? 0.45 : 0.6;
  }
  e.mem.eye = 'open';
  yield 0.5;
}

/** 공허의 소용돌이: a slow multi-arm spiral; the hands add aimed teal shots. */
function* voidSpiral(e: Enemy, w: World): Script {
  const ph = e.phase;
  e.halt();
  e.mem.eye = 'wide';
  e.telegraph(0.6);
  w.sfx('beam_charge', { vol: 0.5, pitch: 1.0 });
  const hs = hands(e);
  for (const h of hs) {
    h.busy = true;
    h.pose = 'claw';
    h.tx = e.x + h.side * 64;
    h.ty = eyeY(e) + 6;
    h.tz = 18;
  }
  gather(w, e.x, eyeY(e), VMAG_FX, 16, 30);
  yield 0.6;
  const arms = ph >= 2 ? 4 : 3;
  const base = w.rng.angle();
  const turn = w.rng.sign() * 0.2;
  for (let k = 0; k < 30; k++) {
    for (const a of spiralAngles(base, arms, k, turn)) {
      const pr = e.shoot(w, a, voidShot(60));
      pr.y = eyeY(e) + Math.sin(a) * 8;
    }
    if (k % 10 === 5) {
      for (const h of hs) {
        const a0 = Math.atan2(w.player.y - (h.y - h.z), w.player.x - h.x);
        for (const s of [-0.22, 0, 0.22]) {
          const pr = e.shoot(w, a0 + s, bullet('eldritch', 3, { speed: 92, z: 6 }));
          pr.x = h.x;
          pr.y = h.y - h.z + 4;
        }
      }
      w.sfx('enemy_shoot', { vol: 0.4, pitch: 1.3 });
    }
    if (k % 3 === 0) w.sfx('enemy_shoot', { vol: 0.2, pitch: 0.9 });
    yield 0.1;
  }
  for (const h of hs) h.rest();
  e.mem.eye = 'open';
  yield 0.6;
}

/** 할퀴기: a hand slides beside the keeper and rakes a telegraphed fan. */
function* claws(e: Enemy, w: World): Script {
  const ph = e.phase;
  const hs = hands(e);
  const warn = ph >= 2 ? 0.55 : 0.7;
  for (let k = 0; k < (ph >= 2 ? 3 : 2); k++) {
    const h = hs[k % 2];
    if (!h) break;
    const p = w.player;
    const spot = inRoom(w, p.x - h.side * 46, p.y - 8, 10);
    h.busy = true;
    h.pose = 'claw';
    h.rate = 8;
    h.tx = spot.x;
    h.ty = spot.y;
    h.tz = 6;
    yield 0.35;
    const a = Math.atan2(w.player.y - h.y, w.player.x - h.x);
    w.spawn(new Sector(h.x, h.y, a, {
      radius: 72, half: 0.62, warn, damage: 1, source: NAME, color: VMAG[2], slash: VMAG[4], dir: k % 2 ? 1 : -1,
      onStrike: (ww) => {
        ww.sfx('swing_heavy', { vol: 0.7, pitch: 0.7 });
        ww.shake(0.25);
      },
    }));
    w.sfx('warn', { vol: 0.3, pitch: 1.2 });
    yield warn;
    h.tx = h.x + Math.cos(a) * 40;
    h.ty = h.y + Math.sin(a) * 40;
    h.rate = 14;
    yield 0.3;
  }
  for (const h of hs) h.rest();
  yield 0.4;
}

/** 심연의 부름: minions from the palms (eyes, then moths that hunt the light, then larvae). */
function* summon(e: Enemy, w: World): Script {
  e.halt();
  e.mem.eye = 'wide';
  e.telegraph(0.55);
  const hs = hands(e);
  for (const h of hs) {
    h.busy = true;
    h.pose = 'claw';
    h.tz = 20;
  }
  w.sfx('summon', { vol: 0.6, pitch: 0.7 });
  yield 0.55;
  const spot = (x: number, y: number) => inRoom(w, x, y, 16);
  if (e.phase === 0) {
    for (const h of hs) {
      const s = spot(h.x, h.y + 8);
      summonMinion(e, w, 'void_eye', s.x, s.y, VMAG_FX);
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const s = spot(e.x + (i - 1) * 30, eyeY(e) + 34);
      summonMinion(e, w, 'void_moth', s.x, s.y, VMAG_FX);
    }
    if (e.phase >= 2) {
      for (const h of hs) {
        const s = spot(h.x, h.y + 10);
        summonMinion(e, w, 'abyss_larva', s.x, s.y, VMAG_FX);
      }
    }
  }
  yield 0.5;
  for (const h of hs) h.rest();
  e.mem.eye = 'open';
  yield 0.3;
}

/** 빛 삼키기: the lantern mechanic (see header). */
function* devour(e: Enemy, w: World): Script {
  const room = w.room;
  e.mem.devourAt = e.age;
  yield* moveTo(e, w, room.centerX, room.interiorY + HOME_DY, 0.7);
  e.mem.eye = 'wide';
  e.telegraph(0.7);
  w.sfx('beam_charge', { vol: 0.7, pitch: 0.45 });
  w.sfx('enemy_roar', { vol: 0.5, pitch: 0.5 });
  if (!e.mem.taught) {
    e.mem.taught = 1;
    w.banner('무명이 빛을 삼킨다', '꺼진 화로에 다시 불을 붙이거나 등불을 해방하라', { color: '#ffd060', small: true });
  }
  const hs = hands(e);
  for (const h of hs) {
    h.busy = true;
    h.pose = 'claw';
    h.tx = e.x + h.side * 30;
    h.ty = eyeY(e) + 14;
    h.tz = 14;
  }
  for (const b of braziers(e)) {
    if (!b.lit) continue;
    b.snuff(w);
    yield 0.22;
  }
  e.mem.relit = 0;
  e.mem.charge = 0;
  e.mem.chargeDur = e.phase >= 2 ? 5.2 : 6;
  e.mem.broken = false;
  e.mem.charging = true;
  let ringT = 1.4;
  let warned = false;
  while (e.mem.charging) {
    ringT -= w.dt;
    if (ringT <= 0) {
      ringT = e.phase >= 2 ? 1.3 : 1.6;
      const g = w.rng.angle();
      for (const a of gapRing(16, w.rng.angle(), [g, g + TAU / 3, g + (2 * TAU) / 3], 0.75)) {
        const pr = e.shoot(w, a, voidShot(50));
        pr.y = eyeY(e);
      }
      w.sfx('enemy_shoot', { vol: 0.3, pitch: 0.6 });
    }
    if (!warned && e.mem.charge > 1 - 1 / e.mem.chargeDur) {
      warned = true;
      e.telegraph(1);
      w.sfx('warn', { vol: 0.6, pitch: 0.6 });
    }
    if (fx.chance(0.5)) gather(w, e.x, eyeY(e), [VMAG[3], '#2a0a3a', '#000000'], 1, 40, false);
    yield;
  }
  if (e.mem.broken) {
    yield* dazzled(e, w);
    return;
  }
  // 개기일식: the orb bursts into a gapped eclipse wave
  const g0 = w.rng.angle();
  const gaps = [g0, g0 + Math.PI + w.rng.range(-0.6, 0.6)];
  const oy = eyeY(e);
  w.spawn(new ShockRing(e.x, oy, { speed: 120, maxR: 320, color: VMAG[2], gaps, gapWidth: 0.75, damage: 2, source: NAME, thick: 7, debris: [SHADE[3], VMAG[3]] }));
  for (const a of gapRing(30, 0, gaps, 0.75)) {
    const pr = e.shoot(w, a, voidShot(96, 4));
    pr.x = e.x + Math.cos(a) * 12;
    pr.y = oy + Math.sin(a) * 12;
  }
  w.renderer?.screenFlash('#000000', 0.6);
  w.shake(0.9);
  w.sfx('explosion', { vol: 0.9, pitch: 0.4 });
  w.sfx('laser', { vol: 0.6, pitch: 0.4 });
  e.mem.charge = 0;
  for (const h of hs) h.rest();
  e.mem.eye = 'open';
  yield 1.2;
}

/** Blinded by the light: stunned, takes extra damage. */
function* dazzled(e: Enemy, w: World): Script {
  e.halt();
  e.mem.stun = 3.6;
  e.mem.broken = false;
  const hs = hands(e);
  for (const h of hs) {
    h.busy = true;
    h.pose = 'open';
    h.rate = 3;
    h.tx = e.x + h.side * 46;
    h.ty = eyeY(e) + 44;
    h.tz = 0;
  }
  w.floatText(e.x, eyeY(e) - 34, '눈이 멀었다!', '#fff4c0', 1.2);
  while (e.mem.stun > 0) {
    e.mem.stun -= w.dt;
    if (fx.chance(0.35)) {
      const a = w.time * 6 + fx.range(0, TAU);
      w.particles.spawn({ x: e.x + Math.cos(a) * 18, y: eyeY(e) - 22 + Math.sin(a) * 4, life: 0.3, colors: ['#fff6a0', '#ffffff'], size: 1, additive: true });
    }
    yield;
  }
  e.mem.stun = 0;
  for (const h of hs) h.rest();
  e.mem.eye = 'wide';
  w.sfx('enemy_roar', { vol: 0.6, pitch: 0.7 });
  e.telegraph(0.4);
  yield 0.5;
  e.mem.eye = 'open';
}

function breakDevour(e: Enemy, w: World, x: number, y: number): void {
  e.mem.charging = false;
  e.mem.broken = true;
  e.mem.charge = 0;
  w.renderer?.screenFlash('#fff4c0', 0.7);
  w.shake(0.7);
  w.hitstop(0.08);
  w.sfx('fire', { vol: 0.9, pitch: 0.6 });
  w.sfx('enemy_roar', { vol: 0.7, pitch: 1.4 });
  const ey = eyeY(e);
  for (let i = 0; i < 3; i++) w.spawn(new RingFx(e.x, ey, 30 + i * 22, 0.3 + i * 0.1, i % 2 ? EMBER[3] : '#ffffff', 2));
  w.particles.burst(e.x, ey, { count: 30, speed: [60, 200], life: [0.3, 0.7], colors: ['#ffffff', ...EMBER_FX], size: [1, 3], additive: true, light: 6 });
  void x;
  void y;
}

function resetDevour(e: Enemy): void {
  e.mem.charging = false;
  e.mem.broken = false;
  e.mem.charge = 0;
  e.mem.stun = 0;
  for (const h of hands(e)) h.rest();
}

// ------------------------------------------------------------------ phases
function* toPhase2(e: Enemy, w: World): Script {
  yield* phaseShift(e, w, {
    color: VMAG[3],
    time: 1.7,
    onPeak: () => {
      e.mem.cracked = true;
      e.mem.crownAt = e.age;
      e.mem.eye = 'wide';
      w.sfx('rock_break', { vol: 0.8, pitch: 0.6 });
      const g = w.rng.angle();
      for (const a of gapRing(20, 0, [g, g + Math.PI], 0.9)) {
        const pr = e.shoot(w, a, voidShot(80));
        pr.y = eyeY(e);
      }
    },
  });
}

function* toPhase3(e: Enemy, w: World): Script {
  e.halt();
  e.vulnerable = false;
  clearEnemyShots(w);
  e.mem.eye = 'wide';
  for (const h of hands(e)) {
    h.busy = true;
    h.pose = 'fist';
    h.rate = 5;
    h.tx = e.x + h.side * 34;
    h.ty = eyeY(e) + 4;
    h.tz = 30;
  }
  w.sfx('enemy_roar', { vol: 0.8, pitch: 0.4 });
  for (let i = 1; i <= 3; i++) {
    e.mem.strain = i;
    w.shake(0.25 + i * 0.1);
    w.sfx('rock_break', { vol: 0.5 + i * 0.1, pitch: 0.5 + i * 0.15 });
    w.particles.burst(e.x, eyeY(e), { count: 8 + i * 4, speed: [30, 110], life: [0.3, 0.6], colors: [VMAG[4], VMAG[3], '#ffffff'], size: [1, 2], additive: true });
    yield 0.45;
  }
  yield* phaseShift(e, w, {
    color: '#ffffff',
    time: 1.7,
    onPeak: () => {
      e.mem.core = true;
      e.mem.strain = 0;
      e.mem.coreAt = e.age;
      w.renderer?.screenFlash('#ffffff', 0.85);
      w.shake(1);
      w.sfx('explosion', { vol: 1, pitch: 0.5 });
      const ey = eyeY(e);
      w.particles.burst(e.x, ey, { count: 40, speed: [80, 260], life: [0.5, 1.1], colors: [IRON[3], IRON[4], IRON[5], GLASS[2], GLASS[3]], size: [2, 4], gravity: 300, vz: [60, 180], bounce: 0.3, shape: 'square', vrot: 9 });
      w.particles.burst(e.x, ey, { count: 30, speed: [40, 160], life: [0.4, 0.9], colors: VMAG_FX, size: [1, 3], additive: true, light: 6 });
      // the light it swallowed spills back out: every brazier flares up again
      for (const b of braziers(e)) b.relight(w, true);
      const g = w.rng.angle();
      for (const a of gapRing(18, 0, [g, g + Math.PI], 1.0)) {
        const pr = e.shoot(w, a, starShot(84));
        pr.y = ey;
      }
    },
  });
  for (const h of hands(e)) h.rest();
}

function* patterns(e: Enemy, w: World): Script {
  while (true) {
    const ph = e.phase;
    const since = e.age - (e.mem.devourAt ?? -99);
    const id = pickPattern(w.rng, [
      { id: 'slam', w: 3 },
      { id: 'gaze', w: 2.5 },
      { id: 'rings', w: 2.4 },
      { id: 'summon', w: 1.3, when: minionCount(w, e) === 0 && w.enemies.length < 4 },
      { id: 'claw', w: 2.3, when: ph >= 1 },
      { id: 'spiral', w: 2.2, when: ph >= 1 },
      { id: 'devour', w: 3.5, when: ph >= 1 && since > (ph >= 2 ? 15 : 19) },
    ], (e.mem.last as string | null) ?? null);
    e.mem.last = id;
    if (id === 'slam') yield* slams(e, w);
    else if (id === 'gaze') yield* gaze(e, w);
    else if (id === 'rings') yield* starRings(e, w);
    else if (id === 'summon') yield* summon(e, w);
    else if (id === 'claw') yield* claws(e, w);
    else if (id === 'spiral') yield* voidSpiral(e, w);
    else yield* devour(e, w);
    yield* hover(e, w, ph >= 2 ? w.rng.range(0.5, 0.8) : w.rng.range(0.8, 1.3));
  }
}

// ================================================================== drawing
function drawChain(r: Renderer, x: number, y0: number, y1: number, sway: number): void {
  let i = 0;
  for (let y = y1; y > y0; y -= 6) {
    const k = (y1 - y) / Math.max(1, y1 - y0);
    r.sprite(i % 2 ? 'mmy_link_b' : 'mmy_link_a', x + sway * (1 - k), y);
    i++;
  }
}

function drawTendril(r: Renderer, e: Enemy, x: number, y: number, n: number, seed: number, alpha: number): void {
  for (let i = 0; i < n; i++) {
    const sx = x + Math.sin(e.age * 2.2 + i * 0.7 + seed) * i * 0.9;
    const sy = y + i * 5;
    r.sprite(i === n - 1 ? 'mmy_seg_tip' : 'mmy_seg', sx, sy, { alpha });
  }
}

function drawBoss(e: Enemy, r: Renderer, w: World): void {
  if (e.hidden) return;
  const ey = eyeY(e);
  const core = !!e.mem.core;
  const tel = e.telegraphT > 0 && Math.floor(e.telegraphT * 16) % 2 === 0;
  const flash = e.flash > 0 ? 1 : tel ? 0.5 : 0;
  const alpha = e.alpha * (e.dormant > 0.3 ? 0.75 + 0.25 * Math.sin(e.age * 30) : 1);
  r.shadow(e.x, e.y + 54, core ? 50 : 64, 12, 0.32);
  if (!core) {
    drawChain(r, e.x, w.room.interiorY - 40, ey - 38, Math.sin(e.age * 1.6) * 2);
    for (const [ox, n, s] of [[-17, 5, 0], [0, 6, 1.7], [17, 5, 3.1]] as const) drawTendril(r, e, e.x + ox, ey + 33 + (ox === 0 ? 5 : 0), n, s, alpha);
  } else {
    for (let i = 0; i < 5; i++) {
      const a = Math.PI / 2 + (i - 2) * 0.42;
      drawTendril(r, e, e.x + Math.cos(a) * 18, ey + Math.sin(a) * 18, 6, i * 1.3, alpha);
    }
  }
  // thorn crown (phase 2+) turning slowly behind the lantern
  if (e.mem.cracked) {
    const k = clamp((e.age - (e.mem.crownAt ?? 0)) / 0.6, 0, 1);
    r.sprite('mmy_crown', e.x, ey, { rot: e.age * (core ? 0.5 : 0.18), alpha: alpha * k, sx: 0.6 + 0.4 * ease.outBack(k), sy: 0.6 + 0.4 * ease.outBack(k) });
  }
  if (core) {
    const k = clamp((e.age - (e.mem.coreAt ?? 0)) / 0.5, 0, 1);
    const pulse = 1 + Math.sin(e.age * 4) * 0.03;
    r.anim('mmy_core', e.age, e.x, ey, { alpha, flash, sx: pulse * (0.5 + 0.5 * k), sy: pulse * (0.5 + 0.5 * k) });
    // broken shards of the cage orbit the black sun
    for (let i = 0; i < 8; i++) {
      const a = e.age * 0.8 + (i / 8) * TAU;
      const rad = 44 + Math.sin(e.age * 2 + i) * 3;
      r.sprite(`mmy_shard_${i % 4}`, e.x + Math.cos(a) * rad, ey + Math.sin(a) * rad * 0.8, { rot: a + e.age, alpha, flash: flash * 0.6 });
    }
  } else {
    const strain = e.mem.strain ?? 0;
    const body = strain > 0 ? `mmy_strain_${Math.min(2, strain - 1)}` : null;
    const shake = strain > 0 ? fx.range(-1, 1) * strain * 0.6 : 0;
    if (body) r.sprite(body, e.x + shake, ey, { alpha, flash });
    else r.anim(e.mem.cracked ? 'mmy_body2' : 'mmy_body', e.age, e.x, ey, { alpha, flash });
  }
  // the eye
  let st: EyeState = (e.mem.eye as EyeState) ?? 'open';
  if (e.dormant > 0.7) st = 'closed';
  else if (e.dormant > 0) st = 'half';
  else if ((e.mem.stun ?? 0) > 0) st = 'closed';
  else if ((e.mem.blink ?? 0) > 0) st = st === 'wide' ? 'open' : 'half';
  const p = w.player;
  const ix = clamp((p.x - e.x) / 22, -4, 4);
  const iy = clamp((p.y - ey) / 30, -1, 1);
  r.sprite(eyeSprite(st, ix, iy, e.phase >= 2), e.x, ey, { alpha, flash: e.flash > 0 ? 0.7 : 0 });
  // eclipse orb growing over the eye while it devours the light
  const ch = e.mem.charging ? (e.mem.charge ?? 0) : 0;
  if (ch > 0) {
    const R = 3 + ch * 13;
    r.circle(e.x, ey, R + 2.5, VMAG[3], 0.5 + 0.4 * Math.sin(e.age * 20));
    r.circle(e.x, ey, R + 1, '#ffffff', 0.8);
    r.circle(e.x, ey, R, '#020104', 1);
    r.ring(e.x, ey, R - 2, '#2a0a3a', 1, 0.8);
  }
}

// ================================================================== definition
defineBoss({
  id: 'mumyeong',
  name: NAME,
  bossTitle: '등불을 삼킨 어둠',
  bossFloors: [5],
  bossMusic: 'boss_final',
  hp: 1150,
  radius: 22,
  speed: 40,
  mass: 30,
  flying: true,
  phasing: true,
  sprite: 'mmy_body',
  portrait: 'mmy_portrait',
  shadow: 0,
  deathFx: 'void',
  bloodColor: VMAG[3],
  contactDamage: 1,
  hurtSfx: 'hit',
  light: { radius: 96, color: '#b040c0' },
  init(e, w) {
    e.mem.eye = 'open';
    e.mem.blink = 0;
    e.mem.blinkT = 3;
    e.mem.dark = 0;
    e.mem.last = null;
    e.mem.lastRel = w.run?.stats?.releases ?? 0;
    const room = w.room;
    if (!room) return;
    e.mem.hands = [new Hand(e, -1), new Hand(e, 1)];
    for (const h of e.mem.hands as HandEnt[]) w.spawn(h);
    const bz: BrazierEnt[] = [];
    for (const [fxr, fyr] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const x = fxr ? room.interiorX + room.interiorW - 26 : room.interiorX + 26;
      const y = fyr ? room.interiorY + room.interiorH - 14 : room.interiorY + 30;
      const s = room.nearestFree(x, y, 6);
      const b = new Brazier(s.x, s.y, e);
      bz.push(b);
      w.spawn(b);
    }
    e.mem.braziers = bz;
    w.spawn(new VoidDark(e));
  },
  *script(e, w) {
    yield 0.3;
    yield* patterns(e, w);
  },
  update(e, w, dt) {
    phaseGate(e, 0.66, 1, function* () {
      resetDevour(e);
      yield* toPhase2(e, w);
      phaseDone(e);
      yield* devour(e, w);
      yield* patterns(e, w);
    });
    phaseGate(e, 0.33, 2, function* () {
      resetDevour(e);
      yield* toPhase3(e, w);
      phaseDone(e);
      yield* patterns(e, w);
    });
    e.mem.bob = Math.sin(e.age * 1.6) * 2.5;
    // blinking
    e.mem.blink = Math.max(0, (e.mem.blink ?? 0) - dt);
    e.mem.blinkT -= dt;
    if (e.mem.blinkT <= 0) {
      e.mem.blinkT = w.rng.range(2.5, 4.5);
      e.mem.blink = 0.14;
    }
    // eclipse charge
    if (e.mem.charging) {
      e.mem.charge = (e.mem.charge ?? 0) + dt / (e.mem.chargeDur ?? 6);
      if ((e.mem.relit ?? 0) >= 2) breakDevour(e, w, e.x, eyeY(e));
      else if (e.mem.charge >= 1) {
        e.mem.charge = 1;
        e.mem.charging = false;
      }
    }
    // 등불 해방 pushes the darkness back
    const rel = w.run.stats.releases;
    if (rel !== e.mem.lastRel) {
      e.mem.lastRel = rel;
      for (const b of braziers(e)) b.relight(w, true);
      w.spawn(new RingFx(w.player.x, w.player.y - 6, 60, 0.4, EMBER[3], 3));
      if (e.mem.charging) breakDevour(e, w, w.player.x, w.player.y);
      else {
        e.mem.blink = 0.8;
        e.flash = 0.15;
      }
    }
    // darkness follows the snuffed braziers (and the orb)
    const unlit = braziers(e).filter((b) => !b.lit).length;
    e.mem.dark = Math.min(0.62, unlit * 0.13 + (e.mem.charging ? (e.mem.charge ?? 0) * 0.14 : 0));
    // ambient void motes
    if (fx.chance(0.4)) {
      const a = fx.angle();
      const d = e.mem.core ? 30 : 36;
      w.particles.spawn({
        x: e.x + Math.cos(a) * d, y: eyeY(e) + Math.sin(a) * d * 0.8, vy: fx.range(-20, -6), life: fx.range(0.5, 1),
        colors: e.mem.core ? [VMAG[4], VMAG[3]] : [VMAG[3], SHADE[4]], size: 1, additive: true, alpha: 0.8,
      });
    }
  },
  onHurt(e, w, hit) {
    // blinded by the light: +50% damage
    if ((e.mem.stun ?? 0) > 0 && hit.kind !== 'status') {
      e.hp -= hit.damage * 0.5;
      if (fx.chance(0.5)) w.particles.burst(e.x, eyeY(e), { count: 3, speed: [30, 80], life: [0.2, 0.4], colors: ['#fff6a0', '#ffffff'], size: [1, 1], additive: true });
    }
  },
  draw: drawBoss,
  onDeath(e, w) {
    dissolveMinions(w, e);
    e.mem.charging = false;
    clearEnemyShots(w);
    const ey = eyeY(e);
    w.sfx('explosion', { vol: 1, pitch: 0.45 });
    w.sfx('rock_break', { vol: 0.9, pitch: 0.6 });
    bossDeathBurst(w, e.x, ey, [IRON[3], IRON[4], IRON[5], GLASS[2], VMAG[3], VMAG[4]], 40);
    w.particles.burst(e.x, ey, { count: 50, speed: [30, 160], life: [0.8, 1.8], colors: ['#ffffff', ...EMBER_FX], size: [1, 2], additive: true, light: 6, gravity: -40, drag: 1 });
    for (let i = 0; i < 5; i++) w.spawn(new RingFx(e.x, ey, 40 + i * 34, 0.6 + i * 0.18, i % 2 ? EMBER[3] : '#ffffff', 3));
    for (const b of braziers(e)) b.relight(w, true);
  },
});
