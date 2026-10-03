// Transition enemies that bridge the late floors:
//  - 향로 수도승 (censer monk, floors 3–4): swings a burning censer on a chain (an orbiting
//    hazard); winds it up into a whirl that sprays a spiral of embers
//  - 별빛 해파리 (star jelly, floors 4–5): drifts in pulses, releasing rings of stars that
//    slow down and linger before fading
//  - 거울 그림자 (mirror shade, floors 4–5): a glassy reflection of the player that stands
//    at the player's mirror point across the room and returns their fire (mirrored aim)

import { defineEnemy } from '../../game/defs';
import { Entity } from '../../game/entity';
import { PixelPainter } from '../../engine/painter';
import { animFrame, defineDrawnSprite, hasAnim, hasSprite } from '../../engine/sprites';
import { RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { clamp, TAU } from '../../engine/math';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { bullet, frames, gather, hurtFrame, mirrorPoint, sphere, starShot } from './shared';

// ================================================================== 향로 수도승 (censer monk)
const MONK = ['#241c2a', '#40364a', '#62566c', '#8a7e92', '#b4aabc'];
const BRASS = ['#5a3a14', '#8a5a20', '#c08a3a', '#f0c060'];
const EMBER = { hot: '#fff0a0', mid: '#ffa424', low: '#e0480c' };

function paintMonk(p: PixelPainter, k: number, mode: 'walk' | 'swing' | 'hurt'): void {
  const step = mode === 'walk' ? [1, 0, -1, 0][k] : 0;
  const bob = mode === 'walk' ? [0, -1, 0, -1][k] : 0;
  // feet
  p.rect(5 + step, 19, 3, 2, MONK[0]);
  p.rect(9 - step, 19, 3, 2, MONK[0]);
  // robe (bell-shaped, hem sways)
  p.poly([5, 8 + bob, 12, 8 + bob, 14 + step * 0.5, 19, 2 + step * 0.5, 19], MONK[2]);
  p.shadeVertical(2, 8 + bob, 13, 11, [MONK[3], MONK[2], MONK[2], MONK[1]], false);
  p.line(8, 11 + bob, 7 + step, 18, MONK[1]);
  p.rect(13, 12, 1, 7, MONK[1]);
  // rope belt with a tassel
  p.rect(4, 13 + bob, 9, 1, BRASS[2]);
  p.px(5, 14 + bob, BRASS[3]);
  p.line(5, 15 + bob, 5, 17 + bob, BRASS[2]);
  // back arm
  p.line(5, 10 + bob, 4, 13 + bob, MONK[1]);
  // hood
  p.circle(8.5, 5.5 + bob, 4.4, MONK[3]);
  sphere(p, 8.5, 5.5 + bob, 4.4, 4.4, MONK, false);
  p.poly([6, 1 + bob, 7, -1 + bob, 9, 1 + bob], MONK[3]);
  p.ellipse(10, 6.5 + bob, 2.6, 2.4, '#0c0810');
  // ember eyes
  const eye = mode === 'swing' ? EMBER.hot : EMBER.mid;
  if (mode === 'hurt') {
    p.px(9, 6 + bob, MONK[2]);
    p.px(11, 6 + bob, MONK[2]);
  } else {
    p.px(9, 6 + bob, eye);
    p.px(11, 6 + bob, eye);
  }
  // front arm holding the chain handle
  if (mode === 'swing') {
    p.line(11, 9 + bob, 14, 3 + bob, MONK[3]);
    p.rect(14, 2 + bob, 2, 2, '#c8b8a8');
  } else {
    p.line(11, 9 + bob, 14, 11 + bob, MONK[3]);
    p.rect(14, 10 + bob, 2, 2, '#c8b8a8');
  }
}
frames('cmonk', 'walk', 4, 17, 21, (p, i) => paintMonk(p, i, 'walk'), { anchor: 'bottom', fps: 6 });
frames('cmonk', 'swing', 2, 17, 21, (p, i) => paintMonk(p, i, 'swing'), { anchor: 'bottom', fps: 8 });
frames('cmonk', 'hurt', 1, 17, 21, (p) => paintMonk(p, 0, 'hurt'), { anchor: 'bottom' });

defineDrawnSprite('cmonk_censer', 7, 8, (p) => {
  p.rect(3, 0, 1, 1, BRASS[2]);
  p.ellipse(3.5, 4.5, 3.4, 3.2, BRASS[2]);
  sphere(p, 3.5, 4.5, 3.4, 3.2, BRASS, false);
  p.rect(1, 3, 5, 1, BRASS[0]);
  p.px(2, 5, EMBER.hot);
  p.px(4, 5, EMBER.mid);
  p.px(3, 6, EMBER.low);
}, { outline: '#160600' });

/** The censer on its chain: an orbiting hazard owned by a censer monk. */
class Censer extends Entity {
  owner: Enemy;
  a = 0;
  rad = 15;
  spin = 2.6;
  targetRad = 15;
  targetSpin = 2.6;
  gx = 0;
  gy = 0;
  hx = 0;
  hy = 0;
  smokeT = 0;

  constructor(owner: Enemy) {
    super();
    this.owner = owner;
    this.layer = 1;
    this.tileCollide = false;
    this.place();
  }

  private place(): void {
    const e = this.owner;
    const up = e.anim === 'cmonk_swing';
    this.hx = e.x + e.facing * 6;
    this.hy = e.y + 5 - (up ? 17 : 10) - e.z;
    this.gx = this.hx + Math.cos(this.a) * this.rad;
    this.gy = e.y + Math.sin(this.a) * this.rad * 0.7;
    this.x = this.gx;
    this.y = this.gy;
  }

  override update(w: World, dt: number): void {
    const e = this.owner;
    if (!e.alive) {
      this.dead = true;
      w.particles.burst(this.gx, this.gy - 4, { count: 10, speed: [30, 80], life: [0.3, 0.6], colors: [EMBER.hot, EMBER.mid, BRASS[2]], size: [1, 2], gravity: 260, vz: [30, 80] });
      return;
    }
    const sdt = dt * w.enemyTimeScale * (e.hasStatus('freeze') || e.hasStatus('stun') ? 0 : 1);
    this.rad += (this.targetRad - this.rad) * Math.min(1, sdt * 4);
    this.spin += (this.targetSpin - this.spin) * Math.min(1, sdt * 3);
    this.a += this.spin * sdt;
    this.place();
    for (const p of w.targets()) {
      if (e.dormant <= 0 && p.alive && p.z < 8) {
        const d = Math.hypot(p.x - this.gx, p.y - this.gy);
        if (d < 4 + p.r) {
          if (p.hurt(w, 1, e.def.name)) p.knock((p.x - this.gx) / (d || 1), (p.y - this.gy) / (d || 1), 150);
        }
      }
    }
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = this.spin > 4 ? 0.03 : 0.08;
      w.particles.spawn({
        x: this.gx + fx.range(-1, 1), y: this.gy - 6, vy: -fx.range(8, 18), vx: fx.range(-4, 4), life: fx.range(0.5, 0.9),
        colors: ['#8a8090', '#5a5262', '#3a3440'], size: 2, sizeEnd: 4, alpha: 0.45,
      });
      if (fx.chance(0.4)) {
        w.particles.spawn({ x: this.gx, y: this.gy - 6, vy: -fx.range(6, 14), vx: fx.range(-6, 6), life: fx.range(0.2, 0.4), colors: [EMBER.hot, EMBER.mid], size: 1, additive: true });
      }
    }
  }

  override draw(r: Renderer, w: World): void {
    if (this.owner.hidden) return;
    const cx = this.gx;
    const cy = this.gy - 6;
    // chain: a few links between the hand and the censer
    const n = 5;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const lx = this.hx + (cx - this.hx) * t;
      const ly = this.hy + (cy - this.hy) * t + Math.sin(t * Math.PI) * 2;
      r.rect(lx - 0.5, ly - 0.5, 2, 2, i % 2 ? '#8a7a5a' : '#c8b88a');
    }
    r.shadow(this.gx, this.gy + 1, 6, 2.5, 0.25);
    const hot = this.spin > 4;
    r.sprite('cmonk_censer', cx, cy, { rot: this.a * 0.5, flash: hot && Math.floor(w.time * 12) % 2 === 0 ? 0.35 : 0 });
  }

  override light(w: World): void {
    w.lights.add(this.gx, this.gy - 6, this.spin > 4 ? 34 : 24, '#ff9a40', { intensity: 0.85 });
  }
}

defineEnemy({
  id: 'censer_monk',
  name: '향로 수도승',
  hp: 40,
  radius: 6,
  speed: 30,
  mass: 1.5,
  sprite: 'cmonk_walk',
  spriteYOffset: 5,
  shadow: 12,
  cost: 2,
  floors: [3, 4],
  weight: 0.6,
  champion: true,
  deathFx: 'blood',
  bloodColor: '#7a2a3a',
  light: { radius: 12, color: '#ffa424' },
  init(e, w) {
    e.mem.censer = w.spawn(new Censer(e));
  },
  *script(e, w) {
    const c = e.mem.censer as Censer;
    yield w.rng.range(0.3, 0.9);
    while (true) {
      e.setAnim('cmonk_walk');
      c.targetRad = 15;
      c.targetSpin = 2.6;
      const t = w.rng.range(1.5, 2.2);
      for (let el = 0; el < t; el += w.dt) {
        if (e.distToTarget(w) > 44) e.chase(w, e.speed);
        else e.stop();
        yield;
      }
      // whirl: the censer speeds up and widens, then sprays a spiral of embers
      e.halt();
      e.setAnim('cmonk_swing');
      e.facing = w.player.x >= e.x ? 1 : -1;
      c.targetRad = 24;
      c.targetSpin = 6.5;
      e.telegraph(0.65);
      w.sfx('whoosh', { vol: 0.4, pitch: 0.7 });
      yield 0.65;
      w.sfx('fire', { vol: 0.5, pitch: 1.1 });
      const dur = e.champion ? 1.6 : 1.2;
      for (let el = 0; el < dur; el += 0.1) {
        e.shoot(w, c.a, bullet('molten', 3, { x: c.gx, y: c.gy, z: 6, speed: 78, range: 260 }));
        if (Math.round(el * 10) % 4 === 0) w.sfx('whoosh', { vol: 0.25, pitch: 1.4 });
        yield 0.1;
      }
      c.targetRad = 15;
      c.targetSpin = 2.6;
      yield 0.6;
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'cmonk_hurt_0'));
  },
});

// ================================================================== 별빛 해파리 (star jelly)
const JELLY = ['#2a2a7a', '#3e4ea8', '#5a80d0', '#8ab8f0', '#d0ecff'];
const STAR = '#ffec50';

function paintJelly(p: PixelPainter, k: number, mode: 'drift' | 'pulse' | 'hurt'): void {
  const squeeze = mode === 'pulse' ? 1 : mode === 'hurt' ? 0.5 : [0, 0.4, 0.8, 0.4][k];
  const rx = 7.4 - squeeze * 1.3;
  const ry = 7.2 + squeeze * 0.8;
  const cy = 9;
  const rim = cy + 2;
  // bell: upper part of an ellipse with a scalloped rim
  p.ellipse(8.5, cy, rx, ry, JELLY[2]);
  for (let y = rim; y < 22; y++) for (let x = 0; x < 17; x++) p.px(x, y, null);
  sphere(p, 8.5, cy - 1, rx, ry * 0.9, JELLY, true);
  for (let x = 0; x < 17; x++) {
    if (!p.isSet(x, rim - 1)) continue;
    p.px(x, rim - 1, JELLY[4]);
    if (Math.sin(x * 1.4 + k) > -0.2) p.px(x, rim, JELLY[3]);
  }
  // trailing tentacles (wave with the animation)
  for (let i = 0; i < 5; i++) {
    const x0 = 8.5 + (i - 2) * (rx * 0.36);
    const len = 8 + ((i * 3 + k) % 3);
    for (let y = rim + 1; y < Math.min(22, rim + 1 + len); y++) {
      const x = x0 + Math.sin(y * 0.65 + k * 1.6 + i * 1.3) * (0.6 + (y - rim) * 0.12);
      p.px(x, y, (y + i) % 4 === 0 ? JELLY[4] : i % 2 ? JELLY[3] : JELLY[2]);
    }
  }
  // starry speckles inside
  for (const [sx, sy] of [[5, 6], [11, 5], [6, 9], [12, 8], [4, 8]]) if (p.isSet(sx, sy)) p.px(sx, sy, (sx + k) % 3 ? '#ffffff' : STAR);
  // nucleus star
  const nc = mode === 'pulse' ? '#ffffff' : STAR;
  const ny = cy - 2;
  p.px(8, ny, nc);
  p.px(9, ny, nc);
  p.px(8, ny - 1, STAR);
  p.px(9, ny + 1, STAR);
  p.px(7, ny, '#ff8a1a');
  p.px(10, ny, '#ff8a1a');
  if (mode === 'pulse') {
    p.px(8, ny - 2, STAR);
    p.px(9, ny + 2, STAR);
    p.px(6, ny, STAR);
    p.px(11, ny, STAR);
  }
}
frames('sjelly', 'drift', 4, 17, 22, (p, i) => paintJelly(p, i, 'drift'), { fps: 6, outline: '#0a0a2a' });
frames('sjelly', 'pulse', 2, 17, 22, (p, i) => paintJelly(p, i, 'pulse'), { fps: 10, outline: '#0a0a2a' });
frames('sjelly', 'hurt', 1, 17, 22, (p) => paintJelly(p, 1, 'hurt'), { outline: '#0a0a2a' });

defineEnemy({
  id: 'star_jelly',
  name: '별빛 해파리',
  hp: 34,
  radius: 7,
  speed: 40,
  flying: true,
  sprite: 'sjelly_drift',
  shadow: 12,
  spriteYOffset: -8,
  cost: 2,
  floors: [4, 5],
  weight: 0.75,
  champion: true,
  deathFx: 'void',
  bloodColor: '#9ab8ff',
  light: { radius: 30, color: '#8ab8ff' },
  *script(e, w) {
    yield w.rng.range(0.3, 1.0);
    let ring = 0;
    while (true) {
      e.setAnim('sjelly_drift');
      const t = w.rng.range(2.0, 2.6);
      for (let el = 0; el < t; el += w.dt) {
        // jet propulsion: short pushes toward a spot near the player
        const push = Math.max(0, Math.sin(e.age * 4.2));
        const tg = e.target(w);
        const d = Math.hypot(tg.x - e.x, tg.y - e.y);
        const k = d > 60 ? 1 : -0.5;
        e.moveDir((tg.x - e.x) * k, (tg.y - e.y) * k, 10 + e.speed * push);
        yield;
      }
      e.halt();
      e.setAnim('sjelly_pulse');
      e.telegraph(0.55);
      gather(w, e.x, e.y - 8, ['#ffffff', STAR, '#8ab8f0'], 10, 18);
      w.sfx('orb', { vol: 0.4, pitch: 1.3 });
      yield 0.55;
      const n = 10;
      const off = (ring % 2) * (Math.PI / n) + w.rng.range(-0.1, 0.1);
      const o = { speed: 125, accel: -110, minSpeed: 16, life: 3.2, range: 400, z: 8 };
      for (let i = 0; i < n; i++) e.shoot(w, off + (i / n) * TAU, starShot('star', 3, o));
      w.sfx('enemy_shoot', { vol: 0.45, pitch: 1.2 });
      w.spawn(new RingFx(e.x, e.y - 8, 22, 0.3, '#d0ecff', 2));
      e.squash(1.25, 0.8);
      if (e.champion) {
        yield 0.3;
        for (let i = 0; i < n; i++) e.shoot(w, off + Math.PI / n + (i / n) * TAU, starShot('star', 3, o));
      }
      ring++;
      yield 0.6;
    }
  },
  update(e, w) {
    if (fx.chance(0.12)) {
      w.particles.spawn({ x: e.x + fx.range(-5, 5), y: e.y - 2 + fx.range(-3, 6), vy: fx.range(4, 10), life: fx.range(0.4, 0.8), colors: ['#ffffff', STAR, '#8ab8f0'], size: 1, additive: true });
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'sjelly_hurt_0'), -8 + Math.sin(e.age * 2.1) * 2);
  },
});

// ================================================================== 거울 그림자 (mirror shade)
const GLASS = ['#2a3a6a', '#5a80b8', '#a8d4f4', '#e8f8ff'];
const ROSE_GLINT = '#ff5c8e';

function paintMirror(p: PixelPainter, k: number, cracked: boolean, glint = false): void {
  // a floating shard of mirror reflecting a dog-shaped shadow
  p.poly([7, 0, 13, 5, 12, 17, 6, 21, 1, 15, 2, 4], GLASS[2]);
  p.shadeVertical(1, 0, 13, 21, [GLASS[3], GLASS[2], GLASS[1]], false);
  // reflection silhouette
  p.ellipse(7, 12, 3.6, 4.2, '#1a1030');
  p.circle(7, 8, 3, '#1a1030');
  p.poly([4, 7, 4, 3, 6, 6], '#1a1030');
  p.poly([10, 7, 10, 3, 8, 6], '#1a1030');
  p.px(6, 8, '#bff6ff');
  p.px(8, 8, '#bff6ff');
  // shine streak
  const sx = 3 + k * 4;
  p.line(sx, 3, sx + 3, 0, '#ffffff');
  p.line(sx + 1, 16, sx + 5, 10, '#ffffffa0');
  if (glint) {
    // the reflection's eyes flare before it returns fire
    p.rect(5, 7, 2, 2, '#ffffff');
    p.rect(8, 7, 2, 2, '#ffffff');
    p.px(6, 9, ROSE_GLINT);
    p.px(8, 9, ROSE_GLINT);
    p.line(1, 15, 6, 21, '#ffffff');
  }
  if (cracked) {
    p.line(9, 2, 7, 9, '#ffffff');
    p.line(7, 9, 10, 14, GLASS[0]);
    p.line(7, 9, 3, 11, '#ffffff');
  }
}
frames('mshade', 'idle', 2, 14, 22, (p, i) => paintMirror(p, i, false), { fps: 2, outline: '#0a0a1e' });
frames('mshade', 'cast', 2, 14, 22, (p, i) => paintMirror(p, i, false, true), { fps: 14, outline: '#0a0a1e' });
frames('mshade', 'hurt', 1, 14, 22, (p) => paintMirror(p, 1, true), { outline: '#0a0a1e' });
defineDrawnSprite('mshade_shard', 4, 6, (p) => {
  p.poly([2, 0, 4, 2, 3, 6, 0, 4], GLASS[2]);
  p.px(1, 2, '#ffffff');
  p.px(2, 1, '#ffffff');
}, { outline: '#0a0a1e' });

/** Frame name of the player sprite as seen in a point mirror (up/down swapped). */
function mirroredFrame(w: World): { frame: string; flip: boolean } {
  const p = w.player;
  const pre = p.character.spritePrefix;
  const face = p.facing === 'up' ? 'down' : p.facing === 'down' ? 'up' : 'side';
  let name = `${pre}_${p.moving ? 'walk' : 'idle'}_${face}`;
  if (!hasAnim(name) && !hasSprite(name)) name = `${pre}_idle_down`;
  if (!hasAnim(name) && !hasSprite(name)) return { frame: 'mshade_idle_0', flip: false };
  return { frame: hasAnim(name) ? animFrame(name, p.animT) : name, flip: !p.flip };
}

/** Where the mirror shade wants to stand: the player's point reflection, kept inside and just within melee reach. */
export function mirrorSpot(w: World, r: number): { x: number; y: number } {
  const p = w.player;
  const room = w.room;
  const m = mirrorPoint(p.x, p.y, room.centerX, room.centerY);
  let x = clamp(m.x, room.interiorX + r + 4, room.interiorX + room.interiorW - r - 4);
  let y = clamp(m.y, room.interiorY + r + 4, room.interiorY + room.interiorH - r - 4);
  const d = Math.hypot(x - p.x, y - p.y);
  if (d < 30) {
    const a = d > 1 ? Math.atan2(y - p.y, x - p.x) : -Math.PI / 2;
    x = clamp(p.x + Math.cos(a) * 30, room.interiorX + r + 4, room.interiorX + room.interiorW - r - 4);
    y = clamp(p.y + Math.sin(a) * 30, room.interiorY + r + 4, room.interiorY + room.interiorH - r - 4);
  }
  return { x, y };
}

defineEnemy({
  id: 'mirror_shade',
  name: '거울 그림자',
  hp: 30,
  radius: 6,
  speed: 80,
  flying: true,
  phasing: true,
  contactDamage: 0,
  sprite: 'mshade_idle',
  shadow: 10,
  cost: 2,
  floors: [4, 5],
  weight: 0.6,
  champion: true,
  deathFx: 'ice',
  bloodColor: '#e0f4ff',
  hurtSfx: 'hit_metal',
  dieSfx: 'rock_break',
  light: { radius: 22, color: '#bfe8ff' },
  init(e, w) {
    e.mem.seen = w.player.lastAttackAt;
    e.mem.cd = 0.6;
    e.mem.cracks = [0, 1, 2].map(() => ({ x: fx.range(-4, 4), y: fx.range(-14, -4), a: fx.angle(), l: fx.range(4, 7) }));
  },
  *script(e, w) {
    while (true) {
      const s = mirrorSpot(w, e.r);
      const d = Math.hypot(s.x - e.x, s.y - e.y);
      e.moveDir(s.x - e.x, s.y - e.y, Math.min(e.speed, d * 4));
      yield;
    }
  },
  update(e, w, dt) {
    const p = w.player;
    e.mem.cd -= dt;
    // the player attacked: the reflection answers with the mirrored shot
    if (p.lastAttackAt > e.mem.seen) {
      e.mem.seen = p.lastAttackAt;
      if (e.mem.cd <= 0 && !(e.mem.pending > 0)) {
        e.mem.pending = 0.22;
        e.mem.aim = p.aim + Math.PI;
        e.telegraph(0.22);
        w.sfx('orb', { vol: 0.25, pitch: 2 });
      }
    }
    if (e.mem.pending > 0) {
      e.mem.pending -= dt;
      if (e.mem.pending <= 0) {
        const kind = w.floor.index >= 5 ? 'void' : 'hymn';
        e.shoot(w, e.mem.aim, bullet(kind, 3, { speed: 118, z: 8 }));
        if (e.champion) {
          e.shoot(w, e.mem.aim - 0.22, bullet(kind, 3, { speed: 118, z: 8 }));
          e.shoot(w, e.mem.aim + 0.22, bullet(kind, 3, { speed: 118, z: 8 }));
        }
        w.sfx('enemy_shoot', { vol: 0.4, pitch: 1.6 });
        e.mem.cd = e.champion ? 0.55 : 0.8;
      }
    }
    if (fx.chance(0.1)) {
      w.particles.spawn({ x: e.x + fx.range(-6, 6), y: e.y - fx.range(2, 14), vy: -fx.range(4, 10), life: fx.range(0.3, 0.6), colors: ['#ffffff', '#bfe8ff'], size: 1, additive: true });
    }
  },
  draw(e, r, w) {
    const bob = 2 + Math.sin(e.age * 3) * 1.2;
    const tel = e.telegraphT > 0 && Math.floor(e.telegraphT * 16) % 2 === 0;
    const { frame, flip } = mirroredFrame(w);
    // orbiting mirror shards (behind half)
    const shards = [0, 1, 2].map((i) => {
      const a = e.age * 2 + (i * TAU) / 3;
      return { x: e.x + Math.cos(a) * 11, y: e.y - 8 - bob + Math.sin(a) * 4, front: Math.sin(a) > 0, rot: a };
    });
    for (const s of shards) if (!s.front) r.sprite('mshade_shard', s.x, s.y, { rot: s.rot, alpha: 0.85 });
    r.ring(e.x, e.y + 3, 7 + Math.sin(e.age * 4), '#bfe8ff', 1, 0.35);
    if (e.mem.pending > 0) {
      // the mirror it lives in flares up behind it before it returns fire
      r.sprite(animFrame('mshade_cast', w.time), e.x, e.y - 9 - bob, { alpha: 0.75, sx: 1.3, sy: 1.3 });
    }
    r.sprite(frame, e.x, e.y + 5 - bob, {
      flipX: flip,
      sx: e.squashX,
      sy: e.squashY,
      alpha: e.alpha * (e.dormant > 0.3 ? 0.5 : 0.92),
      flash: e.flash > 0 ? 1 : tel ? 0.6 : 0,
      tint: e.champion ? e.championColor : '#9ad0ff',
      tintAmount: 0.62,
    });
    // glassy shimmer + cracks that grow as it is damaged
    r.sprite(frame, e.x, e.y + 5 - bob, { flipX: flip, alpha: 0.18 + 0.12 * Math.sin(w.time * 6), additive: true, tint: '#ffffff', tintAmount: 1 });
    const dmg = 1 - e.hp / Math.max(1, e.maxHp);
    const cracks = e.mem.cracks as { x: number; y: number; a: number; l: number }[];
    for (let i = 0; i < cracks.length && i < Math.floor(dmg * 4); i++) {
      const c = cracks[i];
      const x0 = e.x + c.x;
      const y0 = e.y + c.y - bob;
      r.line(x0, y0, x0 + Math.cos(c.a) * c.l, y0 + Math.sin(c.a) * c.l, '#ffffff', 1, 0.9);
    }
    for (const s of shards) if (s.front) r.sprite('mshade_shard', s.x, s.y, { rot: s.rot });
  },
  onDeath(e, w) {
    w.particles.burst(e.x, e.y - 8, { count: 22, speed: [50, 160], life: [0.3, 0.7], colors: ['#ffffff', '#e8f8ff', '#a8d4f4', '#5a80b8'], size: [1, 2], shape: 'spark', gravity: 200, vz: [20, 90] });
    w.spawn(new RingFx(e.x, e.y - 6, 20, 0.3, '#e8f8ff', 2));
  },
});
