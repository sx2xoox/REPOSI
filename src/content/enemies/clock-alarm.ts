// Floor 7 — 멈춘 태엽탑 (stopped clockwork spire), part 3: two basic enemies that keep
// the floor's beat (BEAT = 0.75 s, see clock-shared.ts):
//  - 자명종 폭탄 (alarm bomber): a twin-bell alarm clock on spindly legs. It runs at the
//    keeper and, on a beat, starts RINGING: it carries a clock-dial warning (a hand sweeps
//    once around it), creeps on for exactly two beats and goes off on the beat (a blast and
//    a ring of cogs). Killed while ringing it JAMS: no blast, its mainspring pops out and
//    bounces away harmlessly — the counterplay reward. Killed earlier it simply breaks.
//  - 시곗바늘 방패병 (clock-hand guardian): a verdigris knight whose chest is a clock
//    face. A brass shield arc orbits the dial like a clock hand, ticking a quarter turn on
//    every beat (a full turn per 4 beats), and swallows the keeper's shots that touch it;
//    hits through the open side land normally. When the keeper stands on the open side (as
//    the hand will stand on the next beat) it marks the lanes and fires a cog fan through the
//    gap on that beat, then marches two beats before it looks again (so at most one fan per
//    turn of the hand); otherwise it marches on the beat. Champions carry two arcs (two
//    narrow gaps) and fire tighter 5-cog fans.
// Pure helpers (`handAngle`, `arcBlocks`, `arcCovers`, `gapAim`) are unit-tested in
// tests/enemies-new-f7.test.ts.

import { defineEnemy } from '../../game/defs';
import { Entity } from '../../game/entity';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer, DrawOpts } from '../../engine/renderer';
import { PixelPainter } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { GroundWarning, RingFx } from '../../game/effects';
import { fanAngles } from '../../game/projectile';
import { fx } from '../../engine/rng';
import { angleDiff, clamp, ease, TAU } from '../../engine/math';
import { CLOCK, paintDial, steamPuff } from '../props/clock';
import { appliedDamage, frames, hurtFrame, laneWarning, rayFree, sphere, WARN_RED } from './shared';
import {
  AMBER, BEAT, beatCrossed, beatIndex, BRASS, cogShot, COUT, PLUM, PORC, shards, sparks, springPop, VERD,
} from './clock-shared';

const WOOD = CLOCK.wood;

// ================================================================== 자명종 폭탄 (alarm bomber)
/** Blast radius of a ringing alarm (champion: ALARM_R_CHAMP). */
export const ALARM_R = 34;
export const ALARM_R_CHAMP = 40;
/** It starts ringing within this distance of its keeper ... */
export const ALARM_TRIGGER = 46;
/** ... or after chasing this long. */
export const ALARM_PATIENCE = 5;
/** Beats it rings before it goes off. */
export const RING_BEATS = 2;

type AlarmMode = 'walk' | 'wind' | 'ring' | 'panic' | 'hurt';

/** A small brass bell dome centred at (bx, by), its lip on row `by + 1`. */
function paintBell(p: PixelPainter, bx: number, by: number, struck: boolean): void {
  const x = Math.round(bx);
  const y = Math.round(by);
  // a round dome on a flared lip, with a knob on top
  p.rect(x - 1, y - 2, 3, 1, BRASS[3]);
  p.rect(x - 2, y - 1, 5, 2, BRASS[3]);
  p.rect(x - 3, y + 1, 7, 1, BRASS[2]);
  p.px(x, y - 3, BRASS[4]);
  // light from the top-left
  p.px(x - 1, y - 2, BRASS[5]);
  p.px(x - 2, y - 1, BRASS[5]);
  p.px(x - 1, y - 1, BRASS[4]);
  p.px(x + 2, y, BRASS[1]);
  p.px(x + 1, y, BRASS[2]);
  p.px(x - 3, y + 1, BRASS[4]);
  if (struck) {
    p.px(x - 1, y - 1, '#fff6d0');
    p.px(x, y - 2, '#fff6d0');
  }
}

function paintAlarm(p: PixelPainter, k: number, mode: AlarmMode): void {
  const walk = mode === 'walk';
  const ring = mode === 'ring' || mode === 'panic';
  const panic = mode === 'panic';
  const hurt = mode === 'hurt';
  const bob = walk ? [0, -1, 0, -1][k] : panic ? -k : 0;
  // ringing shakes the whole clock (harder in a panic)
  const sx = ring ? (panic ? (k ? 1 : -1) : k) : hurt ? -1 : 0;
  const cx = 7.5 + sx;
  const cy = 10 + bob;
  const ix = Math.floor(cx);
  const iy = Math.floor(cy);
  // spindly brass legs on little feet (one lifted per step while walking, splayed while ringing)
  const ly = walk && k === 0 ? 14 : 15;
  const ry = walk && k === 2 ? 14 : 15;
  const lx = ring ? 3 - (panic ? k : 0) : 4;
  const rx = ring ? 11 + (panic ? 1 - k : 0) : 10;
  p.line(ix - 2, iy + 4, lx + 1, ly, BRASS[2]);
  p.line(ix + 2, iy + 4, rx + 1, ry, BRASS[1]);
  p.rect(lx, ly + 1, 3, 1, BRASS[3]);
  p.rect(rx, ry + 1, 3, 1, BRASS[2]);
  p.px(lx, ly + 1, BRASS[5]);
  // twin bells on stalks, angled out like ears (the struck one jumps)
  const hitL = ring && k === 0;
  const hitR = ring && (k === 1 || panic);
  const blx = 3 + sx - (hitL ? 1 : 0) + (hurt ? 1 : 0);
  const bly = 3 + bob - (hitL ? 1 : 0) + (hurt ? 1 : 0);
  const brx = 12 + sx + (hitR ? 1 : 0);
  const bry = 3 + bob - (hitR ? 1 : 0);
  p.line(ix - 2, iy - 3, blx + 1, bly + 2, BRASS[1]);
  p.line(ix + 2, iy - 3, brx - 1, bry + 2, BRASS[1]);
  paintBell(p, blx, bly, hitL);
  paintBell(p, brx, bry, hitR);
  // the striker between the bells: hammering left / right while ringing
  const top = iy - 5;
  const hx = ring ? (k === 0 ? ix - 2 : ix + 2) : ix;
  p.line(ix, top, hx, top - 2, BRASS[2]);
  p.rect(hx - 1 + (ring && k === 1 ? 1 : 0), top - 3, 2, 1, BRASS[4]);
  // brass case: a round drum lit from the top-left
  p.circle(cx, cy, 5.4, BRASS[3]);
  sphere(p, cx - 0.3, cy - 0.3, 5.6, 5.6, BRASS, false);
  // porcelain face (a panicking alarm blushes hot)
  const face = hurt ? '#ffffff' : panic ? '#fbd6c8' : PORC[3];
  const shade = hurt ? PORC[2] : panic ? '#e8b0a0' : PORC[2];
  p.circle(cx, cy, 3.5, face);
  for (let x = ix - 3; x <= ix + 3; x++) p.pxIn(x, iy + 3, shade);
  p.pxIn(ix + 3, iy + 2, shade);
  p.px(ix, iy - 3, PLUM[1]);
  if (hurt) {
    // knocked silly: x eyes
    p.px(ix - 2, iy - 1, PLUM[0]);
    p.px(ix - 1, iy, PLUM[0]);
    p.px(ix - 1, iy - 1, PLUM[0]);
    p.px(ix - 2, iy, PLUM[0]);
    p.px(ix + 1, iy - 1, PLUM[0]);
    p.px(ix + 2, iy, PLUM[0]);
    p.px(ix + 2, iy - 1, PLUM[0]);
    p.px(ix + 1, iy, PLUM[0]);
    p.px(ix, iy + 2, '#c02a30');
  } else {
    // eyes (an angry slant on the inner corners)
    p.rect(ix - 2, iy - 1, 1, 2, PLUM[0]);
    p.rect(ix + 2, iy - 1, 1, 2, PLUM[0]);
    p.px(ix - 1, iy - 2, PLUM[1]);
    p.px(ix + 1, iy - 2, PLUM[1]);
    if (ring) {
      // screaming: mouth wide open
      p.rect(ix - 1, iy + 1, 3, 2, PLUM[0]);
      p.px(ix, iy + 2, '#d02a34');
    } else p.rect(ix - 1, iy + 2, 3, 1, PLUM[1]);
    if (mode === 'wind') {
      // the red alarm hand spins round the pivot
      const a = k ? 0.5 : 3.6;
      p.line(ix, iy, Math.round(ix + Math.cos(a) * 2), Math.round(iy + Math.sin(a) * 2), '#d02a34');
      p.px(ix, iy, BRASS[4]);
    }
  }
  // verdigris on the case
  p.pxIn(ix + 4, iy + 2, VERD[1]);
  p.pxIn(ix - 4, iy + 1, VERD[2]);
  // vibration ticks off the struck bells
  if (ring) {
    if (hitL) {
      p.px(0, bly - 2, PORC[3]);
      p.px(0, bly + 1, PORC[3]);
    }
    if (hitR) {
      p.px(14, bry - 2, PORC[3]);
      p.px(14, bry + 1, PORC[3]);
    }
  }
}
frames('ckalarm', 'walk', 4, 15, 17, (p, i) => paintAlarm(p, i, 'walk'), { anchor: 'bottom', fps: 9, outline: COUT });
frames('ckalarm', 'wind', 2, 15, 17, (p, i) => paintAlarm(p, i, 'wind'), { anchor: 'bottom', fps: 10, outline: COUT });
frames('ckalarm', 'ring', 2, 15, 17, (p, i) => paintAlarm(p, i, 'ring'), { anchor: 'bottom', fps: 14, outline: COUT });
frames('ckalarm', 'panic', 2, 15, 17, (p, i) => paintAlarm(p, i, 'panic'), { anchor: 'bottom', fps: 22, outline: COUT });
frames('ckalarm', 'hurt', 1, 15, 17, (p) => paintAlarm(p, 0, 'hurt'), { anchor: 'bottom', outline: COUT });
defineDrawnSprite('ckalarm_spring', 9, 5, (p) => {
  // the mainspring that pops out of a jammed alarm: a little brass coil
  for (let i = 0; i < 4; i++) {
    p.line(i * 2, 4, i * 2 + 1, 0, BRASS[4]);
    p.line(i * 2 + 1, 0, i * 2 + 2, 4, BRASS[2]);
  }
  p.px(1, 1, BRASS[5]);
  p.px(5, 1, BRASS[5]);
}, { outline: COUT });

/**
 * The dial a ringing alarm carries under itself: the blast zone, with twelve ticks and
 * a hand that sweeps once around it over the two beats (`progress` 0..1, set by the
 * alarm's script). It follows its alarm and vanishes with it.
 */
export class AlarmWarning extends GroundWarning {
  owner: Enemy;
  progress = 0;

  constructor(owner: Enemy, radius: number) {
    super(owner.x, owner.y, radius, RING_BEATS * BEAT, undefined, WARN_RED);
    this.owner = owner;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    const o = this.owner;
    if (o.dead || this.age > this.time + 6) {
      this.dead = true;
      return;
    }
    this.x = o.x;
    this.y = o.y;
  }

  override draw(r: Renderer): void {
    const t = clamp(this.progress, 0, 1);
    const R = this.radius;
    const { x, y } = this;
    const blink = 0.25 + 0.2 * Math.sin(this.age * 25);
    r.circle(x, y, R, this.color, blink * 0.5);
    r.circle(x, y, R * ease.outCubic(t), this.color, 0.3);
    r.ring(x, y, R, this.color, 1, 0.9);
    // the dial: twelve ticks (longer at the quarters)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const inner = R - (i % 3 === 0 ? 5 : 3);
      r.pixelLine(x + c * inner, y + s * inner, x + c * (R - 1.5), y + s * (R - 1.5), '#ffd6d0', 1, 0.75);
    }
    // the countdown hand: once around, and the alarm goes off
    const ha = -Math.PI / 2 + t * TAU;
    r.pixelLine(x, y, x + Math.cos(ha) * (R - 4), y + Math.sin(ha) * (R - 4), '#ffffff', 1, 0.85);
    r.pixelDisc(x, y, 1, '#ffffff', 0.85);
    // a bright pulse on every beat it rings through
    const f = (t * RING_BEATS) % 1;
    if (t > 0.02 && f < 0.22) r.ring(x, y, R + 3 * (1 - f / 0.22), '#ffffff', 1, 0.8 * (1 - f / 0.22));
  }
}

/** The bouncing mainspring of a jammed alarm (purely visual). */
export class JamSpring extends Entity {
  static override readonly cosmetic = true;
  rot = 0;
  spin: number;
  life = 2.6;

  constructor(x: number, y: number) {
    super();
    this.x = x;
    this.y = y;
    this.z = 6;
    const a = fx.angle();
    const sp = fx.range(26, 46);
    this.vx = Math.cos(a) * sp;
    this.vy = Math.sin(a) * sp * 0.7;
    this.vz = fx.range(120, 160);
    this.spin = fx.range(10, 16) * (fx.chance(0.5) ? 1 : -1);
    this.layer = 1;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.age >= this.life) {
      this.dead = true;
      return;
    }
    if (this.z > 0 || this.vz > 0) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.rot += this.spin * dt;
      this.vz -= 520 * dt;
      this.z += this.vz * dt;
      if (this.z <= 0) {
        this.z = 0;
        if (this.vz < -40) {
          // boing
          this.vz = -this.vz * 0.55;
          this.vx *= 0.6;
          this.vy *= 0.6;
          this.spin *= 0.6;
          w.particles.burst(this.x, this.y, { count: 2, speed: [10, 30], life: [0.15, 0.3], colors: [BRASS[5], BRASS[3]], size: [1, 1] });
        } else {
          this.vz = 0;
          this.rot = Math.round(this.rot / Math.PI) * Math.PI;
        }
      }
    }
  }

  override draw(r: Renderer): void {
    const a = Math.min(1, (this.life - this.age) / 0.5);
    r.shadow(this.x, this.y + 1, 7, 2.5, 0.3 * a);
    r.sprite('ckalarm_spring', this.x, this.y - this.z - 2, { rot: this.rot, alpha: a });
  }
}

/** A jammed alarm's blast zone: the dial greys and folds into the clock, its hand stopped (purely visual). */
class DefuseFx extends Entity {
  static override readonly cosmetic = true;
  radius: number;
  hand: number;
  dur = 0.45;

  constructor(x: number, y: number, radius: number, progress: number) {
    super();
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.hand = -Math.PI / 2 + clamp(progress, 0, 1) * TAU;
    this.layer = 0;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.age >= this.dur) this.dead = true;
  }

  override draw(r: Renderer): void {
    const t = clamp(this.age / this.dur, 0, 1);
    const R = Math.max(2, this.radius * (1 - ease.inCubic(t)));
    const a = 1 - t;
    r.circle(this.x, this.y, R, PORC[1], 0.22 * a);
    r.ring(this.x, this.y, R, PORC[3], 1, 0.9 * a);
    r.pixelLine(this.x, this.y, this.x + Math.cos(this.hand) * (R - 2), this.y + Math.sin(this.hand) * (R - 2), '#ffffff', 1, 0.9 * a);
  }
}

/** The warning each ringing alarm carries (removed when the alarm dies). */
const CARRIED = new WeakMap<Enemy, AlarmWarning>();

/** The alarm goes off: a blast around it and a ring of hot cogs. */
function alarmBlast(e: Enemy, w: World, R: number): void {
  const { x, y } = e;
  for (const p of w.targets()) {
    if (!p.alive || p.z >= 8) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < R + p.r * 0.5 && p.hurt(w, 1, e.def.name, false, { x, y })) {
      const n = d || 1;
      p.knock((p.x - x) / n, (p.y - y) / n, 200);
    }
  }
  e.shootRing(w, e.champion ? 12 : 8, cogShot(3, { speed: 82, offset: w.rng.angle(), z: 6, range: 250 }));
  // cosmetics
  w.spawn(new RingFx(x, y, R + 4, 0.3, AMBER.hot, 2));
  w.spawn(new RingFx(x, y, R * 0.6, 0.22, '#ffffff', 1));
  w.particles.burst(x, y - 5, { count: 22, speed: [50, 160], life: [0.2, 0.5], colors: ['#ffffff', AMBER.hot, AMBER.mid, AMBER.low], size: [1, 3], sizeEnd: 0.5, additive: true, light: 6 });
  w.particles.burst(x, y - 4, { count: 12, speed: [40, 120], life: [0.4, 0.8], colors: [BRASS[4], BRASS[2], PORC[2]], size: [1, 2], gravity: 320, vz: [40, 130], shape: 'square', vrot: 9, bounce: 0.3 });
  springPop(w, x, y - 4, 3);
  sparks(w, x, y - 4, 10, 120);
  w.lights.glow(x, y, R * 1.8, AMBER.mid, 0.7);
  w.decal(x, y, '#1a0c08', R * 0.45, 0.45);
  w.shake(0.3);
  w.sfx('explosion', { vol: 0.5, pitch: 1.25, x });
  w.sfx('clock_snap', { vol: 0.5, pitch: 1.2, x });
}

/** Killed mid-ring: the striker seizes, the spring pops out, nothing goes off. */
function alarmJam(e: Enemy, w: World, warn: AlarmWarning | undefined): void {
  const { x, y } = e;
  if (warn) w.spawn(new DefuseFx(x, y, warn.radius, warn.progress));
  w.spawn(new JamSpring(x, y));
  springPop(w, x, y - 6, 2);
  sparks(w, x, y - 6, 5, 60);
  steamPuff(w, x, y - 8, 3, 14, 2);
  w.spawn(new RingFx(x, y, 12, 0.25, PORC[3], 1));
  w.particles.burst(x, y - 6, { count: 8, speed: [30, 80], life: [0.3, 0.6], colors: [BRASS[4], BRASS[2], PORC[2]], size: [1, 2], gravity: 320, vz: [30, 90], shape: 'square', vrot: 8 });
  w.sfx('clock_spring', { vol: 0.55, pitch: 0.55, x });
  w.sfx('clock_crack', { vol: 0.35, pitch: 1.3, x });
}

defineEnemy({
  id: 'alarm_bomber',
  name: '자명종 폭탄',
  hp: 22,
  radius: 5,
  speed: 46,
  mass: 0.8,
  sprite: 'ckalarm_walk',
  spriteYOffset: 3,
  shadow: 11,
  cost: 1,
  floors: [7],
  weight: 1.1,
  champion: true,
  deathFx: 'metal',
  bloodColor: '#c49a44',
  hurtSfx: 'hit_metal',
  light: { radius: 10, color: AMBER.mid },
  init(e) {
    // 0 = running, 1 = ringing, 2 = gone off
    e.mem.ring = 0;
    e.mem.rung = 0;
  },
  *script(e, w) {
    yield w.rng.range(0.1, 0.4);
    // run at the keeper
    e.setAnim('ckalarm_walk');
    let chased = 0;
    while (e.distToTarget(w) >= ALARM_TRIGGER && chased < ALARM_PATIENCE) {
      e.chase(w, e.speed);
      chased += w.dt;
      yield;
    }
    // the alarm is set: the red hand spins until the next beat
    e.setAnim('ckalarm_wind', true);
    w.sfx('clock_spring', { vol: 0.4, pitch: 1.5 });
    const b0 = beatIndex(w.time);
    while (beatIndex(w.time) === b0) {
      e.chase(w, e.speed * 0.8);
      yield;
    }
    // RING for exactly two beats, carrying the blast zone along
    const R = e.champion ? ALARM_R_CHAMP : ALARM_R;
    e.mem.ring = 1;
    e.mem.rung = 0;
    const warn = w.spawn(new AlarmWarning(e, R));
    CARRIED.set(e, warn);
    e.setAnim('ckalarm_ring', true);
    e.squash(1.25, 0.8);
    w.sfx('warn', { vol: 0.5, pitch: 1.1 });
    let last = w.time;
    let flashed = false;
    let hammer = 0;
    while (true) {
      const now = w.time;
      if (beatCrossed(last, now)) {
        // only beats it actually rang through count (a frozen clock skips them)
        if (now - last <= w.dt * 1.5 + 1e-9) e.mem.rung++;
        if (e.mem.rung >= RING_BEATS) break;
        if (e.mem.rung === 1) {
          e.setAnim('ckalarm_panic', true);
          e.squash(1.3, 0.75);
          w.sfx('warn', { vol: 0.55, pitch: 1.3 });
        }
      }
      last = now;
      const f = now / BEAT - beatIndex(now);
      warn.progress = clamp((e.mem.rung + f) / RING_BEATS, 0, 1);
      if (!flashed && e.mem.rung === RING_BEATS - 1 && f > 0.45) {
        flashed = true;
        e.telegraph(BEAT * (1 - f));
      }
      // it creeps on while it rings
      e.chase(w, e.speed * 0.3);
      hammer -= w.dt;
      if (hammer <= 0) {
        hammer = e.mem.rung ? 0.06 : 0.09;
        w.sfx('clock_tick', { vol: 0.2, pitch: fx.range(2.1, 2.5) });
      }
      yield;
    }
    // ... and goes off, on the beat
    e.mem.ring = 2;
    warn.dead = true;
    CARRIED.delete(e);
    alarmBlast(e, w, R);
    e.mem.exploded = 1;
    w.killEnemy(e);
  },
  update(e, w, dt) {
    // ringing: sound rings fly off the bells
    if (e.mem.ring === 1 && fx.chance(dt * (e.mem.rung ? 16 : 9))) {
      const side = fx.chance(0.5) ? -1 : 1;
      w.particles.spawn({ x: e.x + side * 6, y: e.y - 13, vx: side * fx.range(20, 40), vy: -fx.range(10, 25), life: fx.range(0.2, 0.35), colors: ['#ffffff', AMBER.hot], size: 1, additive: true, alpha: 0.9 });
    }
  },
  draw(e, r, w) {
    // shaking harder on every beat it rings (draw-only nudge, restored below)
    const x0 = e.x;
    if (e.mem.ring === 1) e.x += Math.sin(w.time * 70) * (0.6 + e.mem.rung * 0.7);
    e.drawDefault(r, hurtFrame(e, w, 'ckalarm_hurt_0'));
    e.x = x0;
  },
  onDeath(e, w) {
    const warn = CARRIED.get(e);
    if (warn) warn.dead = true;
    CARRIED.delete(e);
    if (e.mem.exploded) return;
    if (e.mem.ring === 1) {
      alarmJam(e, w, warn);
      return;
    }
    // shot down before it rang: it just breaks apart
    springPop(w, e.x, e.y - 5, 3);
    sparks(w, e.x, e.y - 5, 6, 80);
    w.particles.burst(e.x, e.y - 5, { count: 10, speed: [30, 90], life: [0.3, 0.6], colors: [BRASS[3], BRASS[1], PORC[2], VERD[1]], size: [1, 2], gravity: 320, vz: [30, 100], shape: 'square', vrot: 8 });
    w.sfx('clock_tick', { vol: 0.35, pitch: 0.7 });
  },
});

// ================================================================== 시곗바늘 방패병 (clock-hand guardian)
/** Radius of the shield plates' centre line around the chest dial (px). */
export const ARC_R = 13;
/** Half the plates' thickness for blocking (the drawn plates are 4 px + outline). */
export const ARC_T = 2.5;
/** Half the angular width of one shield arc (~110° wide). */
export const ARC_HALF = (55 * Math.PI) / 180;
/** The arc is drawn around the chest dial, at the height the keeper's shots fly. */
const ARC_LIFT = 5;
const ARC_STEPS = 64;
const ARC_SIZE = 39;
/** Fan of cogs fired through the gap: [count, spread] (champion: 5 tighter cogs). */
const FAN = { normal: [3, 0.22], champion: [5, 0.12] } as const;

/**
 * Angle of the shield hand at time `t`: it holds still most of a beat, then ticks a
 * quarter turn clockwise, landing on the beat (one full turn every four beats).
 */
export function handAngle(base: number, t: number): number {
  const i = beatIndex(t);
  const f = clamp(t / BEAT - i, 0, 1);
  const u = f < 0.65 ? 0 : (f - 0.65) / 0.35;
  return base + (i + u * u * (3 - 2 * u)) * (Math.PI / 2);
}

/** Centre angles of the shield arcs (one, or two opposite ones for a champion). */
export function arcAngles(hand: number, champion: boolean): number[] {
  return champion ? [hand, hand + Math.PI] : [hand];
}

/** Does the direction `a` (seen from the guardian) fall on a shield arc (± `pad` rad)? */
export function arcCovers(a: number, hand: number, champion: boolean, pad = 0): boolean {
  for (const c of arcAngles(hand, champion)) if (Math.abs(angleDiff(c, a)) <= ARC_HALF + pad) return true;
  return false;
}

/**
 * Does a shot of radius `pr` moving from (x0, y0) to (x1, y1) touch the shield arc
 * centred on angle `arcA` around (cx, cy)? Samples the path every ~2 px.
 */
export function arcBlocks(cx: number, cy: number, arcA: number, x0: number, y0: number, x1: number, y1: number, pr: number): boolean {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(len / 2));
  const lo = ARC_R - ARC_T - pr;
  const hi = ARC_R + ARC_T + pr;
  const pad = pr / ARC_R;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const dx = x0 + (x1 - x0) * t - cx;
    const dy = y0 + (y1 - y0) * t - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < lo * lo || d2 > hi * hi) continue;
    if (Math.abs(angleDiff(arcA, Math.atan2(dy, dx))) <= ARC_HALF + pad) return true;
  }
  return false;
}

/**
 * Where to aim a fan of half-width `fanHalf` at a keeper in direction `ta` when the
 * shield stands at `hand`; null when the keeper is not on an open side. A single arc
 * leaves the whole opposite half open; a champion's two arcs leave two narrow gaps and
 * the fan is kept inside the gap it fires through.
 */
export function gapAim(ta: number, hand: number, champion: boolean, fanHalf: number): number | null {
  if (!champion) return Math.abs(angleDiff(hand + Math.PI, ta)) <= Math.PI / 2 ? ta : null;
  const gapHalf = Math.PI / 2 - ARC_HALF;
  const lim = Math.max(0, gapHalf - fanHalf - 0.05);
  for (const g of [hand + Math.PI / 2, hand - Math.PI / 2]) {
    const d = angleDiff(g, ta);
    if (Math.abs(d) <= gapHalf) return g + clamp(d, -lim, lim);
  }
  return null;
}

/** The shield is seized (neither turning nor blocking) while its knight is stopped. */
function shieldInert(e: Enemy): boolean {
  return e.dormant > 0 || !!e.mem.siege || e.hasStatus('freeze') || e.hasStatus('stun') || e.hasStatus('fear');
}

// ------------------------------------------------------------------ guardian sprites
type GuardMode = 'walk' | 'brace' | 'fire' | 'hurt';

function paintGuardian(p: PixelPainter, k: number, mode: GuardMode): void {
  const walk = mode === 'walk';
  const brace = mode === 'brace';
  const fire = mode === 'fire';
  const hurt = mode === 'hurt';
  const bob = walk ? [0, 1, 0, 1][k] : fire ? 1 : 0;
  // greaves and brass sabatons (a foot lifts on each stride)
  const liftL = walk && k === 0 ? 1 : 0;
  const liftR = walk && k === 2 ? 1 : 0;
  p.rect(6, 16, 3, 5 - liftL, VERD[1]);
  p.rect(10, 16, 3, 5 - liftR, VERD[0]);
  p.px(6, 17, VERD[2]);
  p.px(6, 18, VERD[2]);
  p.px(10, 17, VERD[1]);
  p.rect(5, 20 - liftL, 4, 2, BRASS[3]);
  p.rect(10, 20 - liftR, 4, 2, BRASS[2]);
  p.rect(5, 20 - liftL, 4, 1, BRASS[4]);
  p.rect(10, 20 - liftR, 4, 1, BRASS[3]);
  p.px(7, 18 - liftL, BRASS[4]);
  p.px(11, 18 - liftR, BRASS[3]);
  // walnut tassets under the breastplate, a brass buckle
  p.rect(5, 14 + bob, 9, 3, WOOD[3]);
  p.rect(5, 16 + bob, 9, 1, WOOD[1]);
  p.px(5, 14 + bob, WOOD[5]);
  p.rect(8, 14 + bob, 3, 2, BRASS[3]);
  p.px(8, 14 + bob, BRASS[5]);
  // arms: hanging (raised outward while bracing, flung back on the shot)
  const armY = brace ? 6 : 9;
  const ax = brace || fire ? 1 : 0;
  p.rect(2 - ax, armY + bob, 2, 5, VERD[2]);
  p.rect(15 + ax, armY + bob, 2, 5, VERD[0]);
  p.px(2 - ax, armY + bob, VERD[3]);
  // brass gauntlets
  p.rect(1 - ax, armY + 4 + bob, 3, 2, BRASS[3]);
  p.rect(15 + ax, armY + 4 + bob, 3, 2, BRASS[2]);
  p.px(1 - ax, armY + 4 + bob, BRASS[5]);
  // verdigris breastplate behind the dial
  p.ellipse(9.5, 10.5 + bob, 5.6, 4.8, VERD[1]);
  sphere(p, 9.5, 10.5 + bob, 5.6, 4.8, VERD, false);
  // round pauldrons with brass rims
  p.ellipse(3.5, 7.5 + bob, 2.4, 2.1, VERD[2]);
  sphere(p, 3.5, 7.5 + bob, 2.4, 2.1, VERD, false);
  p.ellipse(15.5, 7.5 + bob, 2.4, 2.1, VERD[1]);
  sphere(p, 15.5, 7.5 + bob, 2.4, 2.1, VERD, false);
  p.rect(2, 9 + bob, 4, 1, BRASS[3]);
  p.rect(14, 9 + bob, 4, 1, BRASS[2]);
  p.px(2, 6 + bob, VERD[3]);
  // the chest IS the clock: a big porcelain dial (its minute hand is drawn live, pointing at the shield)
  const glow = brace || fire;
  const face = fire ? ['#ffe8b0', '#fff4d8', '#ffffff', '#ffffff'] : glow ? [AMBER.low, AMBER.mid, '#ffd27a', AMBER.hot] : undefined;
  const hour = brace ? (k ? 7 : 2) : hurt ? 5 : 0;
  const minute = brace ? (k ? 40 : 10) : hurt ? 35 : 0;
  paintDial(p, 9.5, 11.5 + bob, 3.8, hour, minute, { face });
  if (hurt) p.line(7, 9 + bob, 10, 12 + bob, PLUM[1]);
  // domed brass helm with a finial and a glowing visor slit
  p.ellipse(9.5, 4 + bob, 3.9, 3.5, BRASS[3]);
  sphere(p, 9.5, 4 + bob, 3.9, 3.5, BRASS, false);
  p.px(9, bob, BRASS[5]);
  p.px(9, 1 + bob, BRASS[4]);
  p.rect(6, 4 + bob, 7, 1, PLUM[0]);
  p.rect(7, 5 + bob, 5, 1, BRASS[2]);
  if (hurt) {
    p.px(7, 4 + bob, '#ffffff');
    p.px(11, 4 + bob, '#ffffff');
  } else {
    p.px(7, 4 + bob, glow ? AMBER.hot : AMBER.mid);
    p.px(11, 4 + bob, glow ? AMBER.hot : AMBER.mid);
    if (glow) {
      p.px(8, 4 + bob, AMBER.mid);
      p.px(10, 4 + bob, AMBER.mid);
    }
  }
  // patina
  p.pxIn(4, 13 + bob, VERD[3]);
  p.pxIn(14, 12 + bob, VERD[0]);
  p.pxIn(12, 2 + bob, VERD[2]);
  p.pxIn(7, 2 + bob, VERD[1]);
}
frames('ckguard', 'walk', 4, 19, 22, (p, i) => paintGuardian(p, i, 'walk'), { anchor: 'bottom', fps: 4 / (2 * BEAT), outline: COUT });
frames('ckguard', 'brace', 2, 19, 22, (p, i) => paintGuardian(p, i, 'brace'), { anchor: 'bottom', fps: 8, outline: COUT });
frames('ckguard', 'fire', 1, 19, 22, (p) => paintGuardian(p, 0, 'fire'), { anchor: 'bottom', outline: COUT });
frames('ckguard', 'hurt', 1, 19, 22, (p) => paintGuardian(p, 0, 'hurt'), { anchor: 'bottom', outline: COUT });

/** Paint one ~110° arc of riveted brass plates (with a clock hand's pointed tip) centred on `a0`. */
function paintArc(p: PixelPainter, c: number, a0: number): void {
  const plates = 5;
  const span = (2 * ARC_HALF) / plates;
  const rIn = ARC_R - 2;
  const rOut = ARC_R + 2;
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const da = angleDiff(a0, a);
      // light from the top-left: how much the outward face of the plate turns toward it
      const lit = -(Math.cos(a) * 0.6 + Math.sin(a) * 0.8);
      // the hand's spade tip, pointing outward from the middle plate
      if (d > rOut && d <= rOut + 3 && Math.abs(da) * d <= (rOut + 3 - d) * 0.9 + 0.3) {
        p.px(x, y, lit > 0.1 ? CLOCK.goldHot : BRASS[5]);
        continue;
      }
      if (Math.abs(da) > ARC_HALF || d < rIn || d > rOut) continue;
      const u = (d - rIn) / (rOut - rIn);
      let col: string;
      if (u > 0.74) col = lit > 0.25 ? CLOCK.goldHot : lit > -0.35 ? BRASS[5] : BRASS[4];
      else if (u < 0.26) col = lit < -0.3 ? BRASS[4] : BRASS[2];
      else col = lit > -0.1 ? BRASS[5] : BRASS[4];
      // seams between the plates, a rivet in the middle of each
      const s = (da + ARC_HALF) / span;
      const edge = Math.min(s - Math.floor(s), Math.ceil(s) - s) * span * d;
      if (s > 0.5 && s < plates - 0.5 && edge < 0.75) col = BRASS[2];
      else if (Math.abs(s - Math.floor(s) - 0.5) * span * d < 0.6 && Math.abs(u - 0.5) < 0.2) col = lit > -0.2 ? '#ffffff' : CLOCK.goldHot;
      p.px(x, y, col);
    }
  }
}

function arcSpriteName(i: number, front: boolean): string {
  return `ckshield_arc_${i}${front ? 'f' : 'b'}`;
}
for (let i = 0; i < ARC_STEPS; i++) {
  for (const front of [false, true]) {
    defineDrawnSprite(arcSpriteName(i, front), ARC_SIZE, ARC_SIZE, (p) => {
      const c = ARC_SIZE / 2;
      paintArc(p, c, (i / ARC_STEPS) * TAU);
      p.outline(COUT);
      // split at the dial's height: the far half is drawn behind the knight, the near half in front
      const cut = Math.floor(c);
      for (let y = 0; y < ARC_SIZE; y++) {
        if (front ? y >= cut : y < cut) continue;
        for (let x = 0; x < ARC_SIZE; x++) p.px(x, y, null);
      }
    });
  }
}

/** Sprite of the arc half nearest to angle `a`. */
function arcSprite(a: number, front: boolean): string {
  const i = ((Math.round((a / TAU) * ARC_STEPS) % ARC_STEPS) + ARC_STEPS) % ARC_STEPS;
  return arcSpriteName(i, front);
}

/** Destroy the keeper's shots that run into the shield this step (persistent orbs are only turned aside). */
function blockShots(e: Enemy, w: World): void {
  const hand = e.mem.hand;
  const champ = e.champion;
  const k = w.dt * 1.5;
  for (const pr of w.projectiles) {
    if (pr.dead || pr.team !== 'player' || pr.delay > 0 || pr.hitIds.has(e.id)) continue;
    const dx = pr.x - e.x;
    const dy = pr.y - e.y;
    const reach = ARC_R + ARC_T + pr.r + Math.hypot(pr.vx, pr.vy) * k + 2;
    if (dx * dx + dy * dy > reach * reach) continue;
    const x1 = pr.x + pr.vx * k;
    const y1 = pr.y + pr.vy * k;
    let hit = false;
    for (const a of arcAngles(hand, champ)) if (arcBlocks(e.x, e.y, a, pr.x, pr.y, x1, y1, pr.r)) hit = true;
    if (!hit) continue;
    e.mem.blocks++;
    e.mem.blockT = 0.12;
    sparks(w, pr.x, pr.y - pr.z, 4, 70);
    w.sfx('clock_tick', { vol: 0.4, pitch: fx.range(1.5, 1.8), x: e.x });
    w.sfx('hit_metal', { vol: 0.18, pitch: fx.range(1.3, 1.5), x: e.x });
    if (pr.life > 60) pr.hitIds.add(e.id);
    else pr.expire(w, true);
  }
}

const ARC_DRAW: DrawOpts = {};

function drawArcs(e: Enemy, r: Renderer, front: boolean): void {
  const o = ARC_DRAW;
  o.alpha = shieldInert(e) ? 0.45 : 1;
  o.flash = e.mem.blockT > 0 ? 0.8 : 0;
  for (const a of arcAngles(e.mem.hand ?? 0, e.champion)) r.sprite(arcSprite(a, front), e.x, e.y - e.z - ARC_LIFT, o);
}

defineEnemy({
  id: 'hand_guardian',
  name: '시곗바늘 방패병',
  hp: 44,
  radius: 7,
  speed: 26,
  mass: 2.5,
  sprite: 'ckguard_walk',
  spriteYOffset: 6,
  shadow: 15,
  cost: 2,
  floors: [7],
  weight: 0.8,
  champion: true,
  deathFx: 'metal',
  bloodColor: '#48b094',
  hurtSfx: 'hit_metal',
  dieSfx: 'enemy_die_big',
  light: { radius: 14, color: AMBER.mid },
  init(e, w) {
    e.mem.base = w.rng.angle();
    e.mem.hand = handAngle(e.mem.base, w.time);
    e.mem.blockT = 0;
    e.mem.blocks = 0;
    e.mem.fans = 0;
  },
  *script(e, w) {
    yield w.rng.range(0.15, 0.45);
    /** March on the beat (a stride in the first half of each beat) until the next beat. */
    const march = function* (): Generator<number | void, void, void> {
      const b = beatIndex(w.time);
      if (e.anim !== 'ckguard_walk' || b % 2 === 0) e.setAnim('ckguard_walk', true);
      while (beatIndex(w.time) === b) {
        const f = w.time / BEAT - b;
        if (f < 0.5 && e.distToTarget(w) > 14) e.chase(w, e.speed * 1.7);
        else e.stop();
        yield;
      }
    };
    // beats to march after a shot before it looks for an opening again
    let reload = 1;
    while (true) {
      yield* march();
      const B = beatIndex(w.time);
      if (reload > 0) {
        reload--;
        continue;
      }
      const tg = e.target(w);
      const ta = Math.atan2(tg.y - e.y, tg.x - e.x);
      const [n, spread] = e.champion ? FAN.champion : FAN.normal;
      const fanHalf = ((n - 1) / 2) * spread;
      // where the hand will stand when the shot goes off (the next beat)
      const handAtShot = e.mem.base + (B + 1) * (Math.PI / 2);
      const near = Math.hypot(tg.x - e.x, tg.y - e.y) < 210 && w.room.lineOfSight(e.x, e.y, tg.x, tg.y);
      const aim = near ? gapAim(ta, handAtShot, e.champion, fanHalf) : null;
      if (aim === null) continue;
      // brace: the dial winds up and the lanes light one beat ahead
      e.halt();
      e.setAnim('ckguard_brace', true);
      e.facing = Math.cos(aim) >= 0 ? 1 : -1;
      const angles = fanAngles(aim, n, spread);
      for (const a of angles) {
        const len = Math.min(120, rayFree(w.room, e.x, e.y, a, 2, 120) + 6);
        laneWarning(w, e.x + Math.cos(a) * 6, e.y + Math.sin(a) * 6, a, Math.max(10, len - 6), 6, BEAT);
      }
      e.telegraph(BEAT);
      w.sfx('clock_ratchet', { vol: 0.4, pitch: 0.9 });
      while (beatIndex(w.time) === B) yield;
      // on the beat: the fan goes out through the gap (skipped if a stop threw it off the beat)
      const handNow = e.mem.base + beatIndex(w.time) * (Math.PI / 2);
      if (angles.every((a) => !arcCovers(a, handNow, e.champion, 0.02))) {
        e.setAnim('ckguard_fire', true);
        for (const a of angles) e.shoot(w, a, cogShot(3, { speed: 100, z: 6, range: 270 }));
        e.mem.fans++;
        reload = 2;
        e.squash(1.2, 0.85);
        w.sfx('enemy_shoot', { vol: 0.45, pitch: 0.8 });
        w.sfx('clock_chime', { vol: 0.3, pitch: 1.6 });
        sparks(w, e.x + Math.cos(aim) * 6, e.y - 5 + Math.sin(aim) * 6, 4, 60);
        yield 0.3;
      }
    }
  },
  update(e, w, dt) {
    e.mem.hand = handAngle(e.mem.base, w.time);
    if (e.mem.blockT > 0) e.mem.blockT -= dt;
    // the hand lands its quarter turn on the beat with a click
    const b = beatIndex(w.time);
    if (e.mem.tick !== b) {
      e.mem.tick = b;
      w.sfx('clock_tick', { vol: 0.15, pitch: 1.25, x: e.x });
    }
    blockShots(e, w);
  },
  onHurt(e, w, hit) {
    // blades and beams striking from the shield's side glance off the plates
    if ((hit.kind !== 'melee' && hit.kind !== 'laser') || hit.release || shieldInert(e)) return;
    if (hit.dirX === undefined || hit.dirY === undefined || (hit.dirX === 0 && hit.dirY === 0)) return;
    const from = Math.atan2(-hit.dirY, -hit.dirX);
    if (!arcCovers(from, e.mem.hand, e.champion, 0.1)) return;
    const d = appliedDamage(hit, e.hasStatus('weak'), e.hasStatus('freeze'));
    e.hp += d * (hit.kind === 'melee' ? 0.8 : 1);
    e.squash(1, 1);
    e.kbx *= 0.3;
    e.kby *= 0.3;
    e.mem.blockT = 0.12;
    sparks(w, e.x + Math.cos(from) * ARC_R, e.y - ARC_LIFT + Math.sin(from) * ARC_R, 6, 90);
    w.sfx('shield_block', { vol: 0.35, pitch: fx.range(1.2, 1.4) });
  },
  draw(e, r, w) {
    drawArcs(e, r, false);
    // a front-view knight lit from the top-left: never mirrored (restored below)
    const f0 = e.facing;
    e.facing = 1;
    e.drawDefault(r, hurtFrame(e, w, 'ckguard_hurt_0'));
    e.facing = f0;
    // the dial's minute hand points at the shield
    if (e.anim === 'ckguard_walk' && Math.abs(e.squashX - 1) < 0.03 && Math.abs(e.squashY - 1) < 0.03 && w.time - e.lastHurtAt >= 0.24) {
      const bob = Math.floor(e.animT * (4 / (2 * BEAT))) % 2;
      const cx = e.x;
      const cy = e.y - e.z - ARC_LIFT + bob;
      const a = e.mem.hand ?? 0;
      r.pixelLine(cx, cy, cx + Math.cos(a) * 3, cy + Math.sin(a) * 3, PLUM[0], 1, 1);
    }
    drawArcs(e, r, true);
  },
  onDeath(e, w) {
    // the plates fly off and the dial shatters
    for (const a of arcAngles(e.mem.hand ?? 0, e.champion)) {
      w.particles.burst(e.x + Math.cos(a) * ARC_R, e.y - ARC_LIFT + Math.sin(a) * ARC_R, { count: 8, speed: [40, 110], life: [0.4, 0.8], colors: [BRASS[5], BRASS[4], BRASS[2]], size: [2, 3], gravity: 320, vz: [40, 120], shape: 'square', vrot: 10, bounce: 0.3 });
    }
    shards(w, e.x, e.y - 6, 10, 90);
    springPop(w, e.x, e.y - 8, 3);
    sparks(w, e.x, e.y - 6, 10, 100);
    w.particles.burst(e.x, e.y - 8, { count: 10, speed: [30, 90], life: [0.3, 0.7], colors: [VERD[2], VERD[1], VERD[0]], size: [1, 2], gravity: 320, vz: [30, 100], shape: 'square', vrot: 8 });
    w.sfx('clock_crack', { vol: 0.45, pitch: 0.8 });
  },
});
