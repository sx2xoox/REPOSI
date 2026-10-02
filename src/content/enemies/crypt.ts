// Floor 1 — 잊혀진 지하묘지 (crypt): bats, rats, a rat nest, a blood candle turret,
// a blinking ghost caster and an urn mimic.

import { defineEnemy } from '../../game/defs';
import { PixelPainter, darken, lighten, ramp } from '../../engine/painter';
import { GroundWarning, RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import {
  bullet, countChildren, sphere, dust, frames, gather, landingSpot, OUTLINE, rayFree, spotAround, stepToward, WARN_RED,
} from './shared';

// ================================================================== 묘지 박쥐 (crypt bat)
// Flutters around the player, screeches (lane warning) and swoops in a straight line.
const BAT_FUR = ramp('#5a3a62', 5);
const BAT_SKIN = '#8e3a5e';
const BAT_SKIN_L = '#c05a7c';
const BAT_BONE = '#2a1426';

interface WingShape {
  w: [number, number];
  t: [number, number];
  f1: [number, number];
  f2: [number, number];
}
const WINGS: Record<string, WingShape> = {
  up: { w: [5, 2], t: [1, 0], f1: [1, 5], f2: [4, 6] },
  mid: { w: [4, 5], t: [0, 4], f1: [1, 9], f2: [4, 9] },
  down: { w: [5, 8], t: [1, 11], f1: [3, 12], f2: [6, 11] },
  wide: { w: [4, 3], t: [0, 1], f1: [0, 7], f2: [4, 8] },
  fold: { w: [6, 3], t: [6, 0], f1: [5, 5], f2: [7, 7] },
};

function paintBat(p: PixelPainter, wing: WingShape, screech: boolean): void {
  const S: [number, number] = [8, 6];
  const H: [number, number] = [8, 9];
  // membrane with a scalloped trailing edge
  const mid1: [number, number] = [(wing.t[0] + wing.f1[0]) / 2 + 1, (wing.t[1] + wing.f1[1]) / 2];
  const mid2: [number, number] = [(wing.f1[0] + wing.f2[0]) / 2 + 0.5, (wing.f1[1] + wing.f2[1]) / 2 - 0.5];
  const mid3: [number, number] = [(wing.f2[0] + H[0]) / 2, (wing.f2[1] + H[1]) / 2 - 0.5];
  p.poly([...S, ...wing.w, ...wing.t, ...mid1, ...wing.f1, ...mid2, ...wing.f2, ...mid3, ...H], BAT_SKIN);
  // lighter membrane near the arm
  p.poly([...S, ...wing.w, ...wing.f2, ...H], BAT_SKIN_L);
  p.line(S[0], S[1], wing.w[0], wing.w[1], BAT_BONE);
  p.line(wing.w[0], wing.w[1], wing.t[0], wing.t[1], BAT_BONE);
  p.line(wing.w[0], wing.w[1], wing.f1[0], wing.f1[1], BAT_BONE);
  p.line(wing.w[0], wing.w[1], wing.f2[0], wing.f2[1], BAT_BONE);
  p.px(wing.w[0], wing.w[1] - 1, '#e8b0c0');
  // ear
  p.poly([7, 5, 6.5, 0.5, 9, 3.5], BAT_FUR[2]);
  p.px(7, 3, '#e090a8');
  // body (left half, mirrored)
  p.ellipse(9.5, 7.5, 2.8, 3.4, BAT_FUR[2]);
  sphere(p, 9.5, 7.5, 2.8, 3.4, BAT_FUR, false);
  // eyes, fangs
  p.px(8, 6, screech ? '#ff6a3a' : '#ffe040');
  p.px(8, 5, screech ? '#ffd0a0' : '#fff8c0');
  if (screech) {
    p.rect(8, 8, 2, 2, '#2a0810');
    p.px(8, 8, '#ffffff');
  } else {
    p.px(8, 9, '#ffffff');
  }
  p.px(8, 11, BAT_BONE);
  p.mirrorX();
}
frames('cbat', 'fly', 4, 19, 13, (p, i) => paintBat(p, [WINGS.up, WINGS.mid, WINGS.down, WINGS.mid][i], false), { fps: 14 });
frames('cbat', 'screech', 2, 19, 13, (p, i) => paintBat(p, i ? WINGS.wide : WINGS.up, true), { fps: 16 });
frames('cbat', 'dive', 1, 19, 13, (p) => paintBat(p, WINGS.fold, true));

defineEnemy({
  id: 'crypt_bat',
  name: '묘지 박쥐',
  hp: 16,
  radius: 5,
  speed: 62,
  flying: true,
  sprite: 'cbat_fly',
  shadow: 9,
  spriteYOffset: -9,
  cost: 1,
  floors: [1],
  weight: 1.3,
  champion: true,
  deathFx: 'blood',
  bloodColor: '#7a1c3c',
  light: { radius: 12, color: '#ffd040' },
  *script(e, w) {
    let orbit = Math.atan2(e.y - w.player.y, e.x - w.player.x);
    let dir = w.rng.sign();
    while (true) {
      e.setAnim('cbat_fly');
      const t = w.rng.range(1.3, 2.3);
      for (let el = 0; el < t; el += w.dt) {
        orbit += dir * 1.2 * w.dt;
        const tg = e.target(w);
        const R = 62 + Math.sin(e.age * 2.7) * 14;
        const gx = tg.x + Math.cos(orbit) * R;
        const gy = tg.y + Math.sin(orbit) * R * 0.7;
        const d = Math.hypot(gx - e.x, gy - e.y);
        e.moveDir(gx - e.x, gy - e.y, Math.min(e.speed, d * 3));
        if (e.mem.__bumped) dir = -dir;
        yield;
      }
      if (e.distToTarget(w) > 150) continue;
      // screech + lane telegraph
      e.halt();
      e.setAnim('cbat_screech');
      const a = e.angleToTarget(w);
      const len = rayFree(w.room, e.x, e.y, a, e.r, 190, true);
      const g = w.spawn(new GroundWarning(e.x, e.y, 6, 0.55, undefined, WARN_RED));
      g.rw = len + 6;
      g.rh = 9;
      g.angle = a;
      e.telegraph(0.55);
      w.sfx('enemy_roar', { vol: 0.35, pitch: 2.2 });
      yield 0.55;
      e.setAnim('cbat_dive');
      e.facing = Math.cos(a) >= 0 ? 1 : -1;
      w.sfx('whoosh', { vol: 0.4, pitch: 1.3 });
      yield* e.charge(w, a, e.speed * 3.5, 0.8);
      e.setAnim('cbat_fly');
      orbit = Math.atan2(e.y - w.player.y, e.x - w.player.x);
      dir = w.rng.sign();
      yield 0.3;
    }
  },
  update(e, w) {
    // wing-beat dust while diving
    if (e.anim === 'cbat_dive' && fx.chance(0.5)) {
      w.particles.spawn({ x: e.x + fx.range(-3, 3), y: e.y - 9 + fx.range(-2, 2), life: 0.25, colors: ['#c05a7c', '#5a3a62'], size: 1 });
    }
  },
});

// ================================================================== 무덤 쥐 (grave rat)
// Skittering pack fodder: short zig-zag bursts, sniff pauses, a quick pounce up close.
const RAT_FUR = ramp('#7a6670', 5);
const RAT_PINK = '#e8a0a8';

function paintRat(p: PixelPainter, step: number, mode: 'run' | 'sniff' | 'pounce'): void {
  const lift = mode === 'pounce' ? -2 : 0;
  const headDy = mode === 'sniff' ? 1 : 0;
  // tail
  const tailY = [4, 6, 5][step % 3];
  p.line(4, 6, 2, 7, RAT_PINK);
  p.line(2, 7, 0, tailY, RAT_PINK);
  // legs
  const la = step % 2 === 0 ? 1 : -1;
  p.rect(5 + la, 8, 2, 1, RAT_PINK);
  p.rect(11 - la, 8, 2, 1, RAT_PINK);
  // body
  p.ellipse(8, 5.2 + lift * 0.5, 4.6, 2.9, RAT_FUR[2]);
  sphere(p, 8, 5 + lift * 0.5, 4.6, 2.9, RAT_FUR);
  p.line(5, 7 + lift * 0.5, 10, 7 + lift * 0.5, RAT_FUR[1]);
  // head
  const hy = 4.6 + headDy + lift;
  p.ellipse(12.6, hy, 2.6, 2.1, RAT_FUR[3]);
  sphere(p, 12.6, hy, 2.6, 2.1, RAT_FUR, false);
  p.poly([14, hy - 1.5, 17, hy + 0.5, 14, hy + 1.8], RAT_FUR[3]);
  p.px(16, Math.round(hy), RAT_PINK);
  // ear
  p.circle(11.2, hy - 2.2, 1.5, RAT_FUR[2]);
  p.px(11, Math.round(hy - 2.4), RAT_PINK);
  // eye
  p.px(13, Math.round(hy - 1), '#ff2a2a');
  // whisker
  p.px(16, Math.round(hy) + 1, '#d8d0d8');
}
frames('grat', 'run', 3, 17, 9, (p, i) => paintRat(p, i, 'run'), { anchor: 'bottom', fps: 14 });
frames('grat', 'sniff', 2, 17, 9, (p, i) => paintRat(p, i * 2, 'sniff'), { anchor: 'bottom', fps: 8 });
frames('grat', 'pounce', 1, 17, 9, (p) => paintRat(p, 1, 'pounce'), { anchor: 'bottom' });

defineEnemy({
  id: 'grave_rat',
  name: '무덤 쥐',
  hp: 10,
  radius: 4,
  speed: 82,
  sprite: 'grat_run',
  spriteYOffset: 3,
  shadow: 9,
  cost: 0.5,
  floors: [1],
  weight: 1.3,
  champion: true,
  deathFx: 'blood',
  bloodColor: '#9a1c2a',
  *script(e, w) {
    while (true) {
      e.setAnim('grat_run');
      const a = e.angleToTarget(w) + w.rng.range(-0.8, 0.8);
      e.moveAngle(a, e.speed);
      yield w.rng.range(0.28, 0.5);
      e.stop();
      e.setAnim('grat_sniff');
      yield w.rng.range(0.15, 0.4);
      if (e.distToTarget(w) < 56 && w.rng.chance(0.45)) {
        e.setAnim('grat_pounce');
        e.telegraph(0.3);
        e.facing = w.player.x >= e.x ? 1 : -1;
        yield 0.3;
        w.sfx('enemy_jump', { vol: 0.3, pitch: 1.8 });
        yield* e.charge(w, e.angleToTarget(w), e.speed * 2, 0.25);
        e.setAnim('grat_sniff');
        yield 0.35;
      }
    }
  },
});

// ================================================================== 쥐 둥지 (rat nest)
// A heap of rags and bones that keeps spitting out grave rats (max 3 alive).
const EARTH = ramp('#4a3a36', 5);
const RAG = ramp('#4c3456', 4);
const NB = ramp('#d8ccb0', 4);

const STRAW = ['#6a5428', '#9a7a3a', '#c8a85a', '#e8d08a'];

function paintNest(p: PixelPainter, frame: number, rustle: boolean): void {
  const up = rustle ? (frame ? -1 : 0) : 0;
  const sh = rustle ? (frame ? 1 : -1) : 0;
  // dirt mound
  p.ellipse(12, 12.5, 11.5, 3.8, EARTH[1]);
  sphere(p, 12, 11.5, 11.5, 4.8, EARTH);
  // woven straw heap
  p.ellipse(12 + sh * 0.5, 8.5 + up, 9, 4.6, STRAW[1]);
  sphere(p, 12 + sh * 0.5, 8 + up, 9, 4.6, STRAW, false);
  const strands: [number, number, number, number][] = [
    [4, 9, 10, 6], [8, 11, 15, 7], [13, 6, 20, 10], [6, 7, 12, 11], [15, 11, 20, 7], [3, 10, 7, 12],
  ];
  strands.forEach(([x0, y0, x1, y1], i) => p.line(x0 + sh, y0 + up, x1 + sh, y1 + up, i % 2 ? STRAW[0] : STRAW[3]));
  // rags
  p.poly([5 + sh, 6 + up, 9 + sh, 4 + up, 10 + sh, 7 + up, 7 + sh, 9 + up], RAG[1]);
  p.px(7 + sh, 6 + up, RAG[3]);
  // bones sticking out
  p.line(1 + sh, 10, 6 + sh, 7 + up, NB[2]);
  p.rect(0 + sh, 9, 2, 2, NB[3]);
  p.px(6 + sh, 6 + up, NB[3]);
  p.line(17 - sh, 5 + up, 22 - sh, 8, NB[2]);
  p.rect(21 - sh, 7, 2, 2, NB[3]);
  // skull on top
  p.circle(15 + sh, 4.5 + up, 2.8, NB[2]);
  sphere(p, 15 + sh, 4.5 + up, 2.8, 2.8, NB, false);
  p.px(14 + sh, 4 + up, '#1a0c10');
  p.px(16 + sh, 4 + up, '#1a0c10');
  p.px(15 + sh, 6 + up, '#1a0c10');
  // burrow hole with eyes
  p.ellipse(11.5, 12, 4.4, 2.9, EARTH[0]);
  p.ellipse(11.5, 12.4, 3.5, 2.1, '#06030a');
  const ex = rustle ? 0 : frame;
  p.px(10 + ex, 12, '#ff3a2a');
  p.px(13 + ex, 12, '#ff3a2a');
  if (rustle) {
    p.px(9, 12, '#ff3a2a');
    p.px(14, 12, '#ff3a2a');
    p.px(10, 13, '#ff3a2a');
  }
}
frames('ratnest', 'idle', 2, 24, 16, (p, i) => paintNest(p, i, false), { anchor: 'bottom', fps: 1.5 });
frames('ratnest', 'rustle', 2, 24, 16, (p, i) => paintNest(p, i, true), { anchor: 'bottom', fps: 14 });

defineEnemy({
  id: 'rat_nest',
  name: '쥐 둥지',
  hp: 40,
  radius: 9,
  speed: 0,
  mass: Infinity,
  contactDamage: 0,
  sprite: 'ratnest_idle',
  spriteYOffset: 5,
  shadow: 0,
  cost: 2,
  floors: [1],
  weight: 0.8,
  champion: true,
  deathFx: 'bone',
  bloodColor: '#6a5040',
  hurtSfx: 'hit',
  *script(e, w) {
    yield w.rng.range(0.4, 1.2);
    while (true) {
      if (countChildren(w, e, 'grave_rat') < 3 && w.enemies.length < 14) {
        e.setAnim('ratnest_rustle');
        e.telegraph(0.6);
        for (let k = 0; k < 4; k++) {
          dust(w, e.x + w.rng.range(-8, 8), e.y + 2, ['#6a5a50', '#4a3a36'], 3, 40);
          yield 0.15;
        }
        const rat = e.summon(w, 'grave_rat', e.x + w.rng.range(-2, 2), e.y + 9);
        if (rat) {
          rat.mem.owner = e;
          rat.knock(0, 1, 90);
          w.sfx('enemy_spawn', { vol: 0.4, pitch: 1.5 });
        }
        dust(w, e.x, e.y + 6, ['#8a7a6a', '#5a4a3a'], 8, 60);
        e.setAnim('ratnest_idle');
      }
      yield w.rng.range(2.4, 3.2);
    }
  },
});

// ================================================================== 핏빛 촛대 (blood candle)
// Stationary turret: alternating + / x volleys, every third volley a spiral.
const WAX = ramp('#e6d8c0', 5);
const IRON = ramp('#4a4258', 4);

function paintFlame(p: PixelPainter, k: number, big: boolean): void {
  const sway = [0, 1, 0, -1][k % 4];
  const top = big ? 0 : 3;
  const wide = big ? 1 : 0;
  const cx = 7.5;
  p.poly([cx - 3 - wide, 10, cx + 3 + wide, 10, cx + 2.5 + wide + sway * 0.5, 6, cx + sway, top, cx - 2.5 - wide + sway * 0.5, 6], '#b0102c');
  p.poly([cx - 2 - wide * 0.5, 10, cx + 2 + wide * 0.5, 10, cx + 1.5 + sway * 0.5, 7, cx + sway * 0.7, top + 2.5, cx - 1.5 + sway * 0.5, 7], '#ff4632');
  p.poly([cx - 1, 10, cx + 1.2, 10, cx + 1 + sway * 0.3, 8, cx + sway * 0.4, top + 5, cx - 0.8, 8], '#ffd08a');
  p.px(7, 9, '#ffffff');
}

function paintCandle(p: PixelPainter, k: number, big: boolean): void {
  // iron dish + foot
  p.rect(4, 24, 7, 2, IRON[0]);
  p.rect(1, 21, 13, 3, IRON[1]);
  p.rect(1, 21, 13, 1, IRON[3]);
  p.px(0, 21, IRON[2]);
  p.px(14, 21, IRON[2]);
  // wax column
  p.rect(4, 11, 7, 11, WAX[2]);
  p.shadeVertical(4, 11, 7, 11, [...WAX].reverse().slice(1));
  p.rect(4, 11, 1, 11, WAX[3]);
  p.rect(10, 11, 1, 11, WAX[1]);
  // melted top & drips
  p.ellipse(7.5, 11, 3.6, 1.3, WAX[4]);
  for (const [x, y0, l] of [[4, 12, 3], [10, 12, 5], [6, 12, 2], [3, 18, 3], [11, 17, 4]] as const) {
    for (let i = 0; i < l; i++) p.px(x, y0 + i, i === l - 1 ? WAX[2] : WAX[4]);
  }
  // dripping pool on the dish
  p.rect(2, 20, 4, 1, WAX[3]);
  p.rect(10, 20, 3, 1, WAX[3]);
  // cursed face
  p.rect(5, 14, 2, 2, '#3a0a18');
  p.rect(8, 14, 2, 2, '#3a0a18');
  p.px(6, 14, big ? '#ffd0a0' : '#ff3a2a');
  p.px(9, 14, big ? '#ffd0a0' : '#ff3a2a');
  p.line(5, 18, 9, 18, '#5a1a22');
  p.px(6, 17, '#5a1a22');
  p.px(8, 19, '#5a1a22');
  // wick + flame
  p.rect(7, 9, 1, 2, '#1a0c0c');
  paintFlame(p, k, big);
}
frames('ccandle', 'idle', 4, 15, 26, (p, i) => paintCandle(p, i, false), { anchor: 'bottom', fps: 9 });
frames('ccandle', 'flare', 4, 15, 26, (p, i) => paintCandle(p, i, true), { anchor: 'bottom', fps: 16 });

defineEnemy({
  id: 'cursed_candle',
  name: '핏빛 촛대',
  hp: 28,
  radius: 6,
  speed: 0,
  mass: Infinity,
  sprite: 'ccandle_idle',
  spriteYOffset: 4,
  shadow: 12,
  cost: 1.5,
  floors: [1],
  weight: 0.8,
  champion: true,
  deathFx: 'ember',
  bloodColor: '#e6d8c0',
  light: { radius: 48, color: '#ff4a30' },
  hurtSfx: 'hit',
  *script(e, w) {
    let volley = w.rng.int(0, 1);
    yield w.rng.range(0.3, 1.2);
    while (true) {
      e.setAnim('ccandle_idle');
      yield w.rng.range(1.5, 2.1);
      e.setAnim('ccandle_flare');
      e.telegraph(0.55);
      gather(w, e.x, e.y - 20, ['#ffffff', '#ff8a5a', '#ff3a2a'], 10, 18);
      w.sfx('fire', { vol: 0.45, pitch: 0.9 });
      yield 0.55;
      const o = bullet('crypt', 3, { z: 12, speed: 82 });
      if (volley % 3 === 2) {
        const base = e.angleToTarget(w);
        for (let k = 0; k < 14; k++) {
          e.shoot(w, base + k * 0.62, { ...o, speed: 74 });
          if (k % 2 === 0) w.sfx('enemy_shoot', { vol: 0.3, pitch: 1.2 });
          yield 0.07;
        }
      } else {
        e.shootRing(w, 4, { ...o, offset: volley % 2 ? Math.PI / 4 : 0 });
        yield 0.25;
        e.shootRing(w, 4, { ...o, speed: 60, offset: volley % 2 ? Math.PI / 4 : 0 });
      }
      volley++;
    }
  },
  update(e, w) {
    if (fx.chance(0.15)) {
      w.particles.spawn({
        x: e.x + fx.range(-1.5, 1.5), y: e.y - 22, vy: -fx.range(10, 24), vx: fx.range(-4, 4), life: fx.range(0.3, 0.6),
        colors: ['#fff0c0', '#ff5a3a', '#801020'], size: 1, additive: true, light: 4,
      });
    }
  },
});

// ================================================================== 곡하는 망령 (wailing shade)
// Drifts at mid range, casts homing spirit bolts, then blinks to a new spot
// (the destination shimmers before it reappears).
const SHADE = ramp('#cfc6ee', 5);

function paintShade(p: PixelPainter, k: number, cast: boolean): void {
  const bob = [0, -1, -1, 0][k % 4];
  // robe with tattered hem
  const hem = [
    [1, 18, 3, 16, 5, 19, 8, 17, 10, 20, 12, 17, 14, 19, 16, 17],
    [1, 17, 3, 19, 6, 17, 8, 20, 11, 17, 13, 19, 16, 18, 16, 17],
    [1, 19, 4, 17, 6, 20, 9, 17, 11, 19, 13, 17, 15, 20, 16, 17],
    [1, 17, 3, 18, 5, 17, 8, 19, 10, 17, 13, 20, 15, 17, 16, 18],
  ][k % 4];
  const hemPts: number[] = [];
  for (let i = hem.length - 2; i >= 0; i -= 2) hemPts.push(hem[i], hem[i + 1]);
  const pts = [4, 9 + bob, 13, 9 + bob, 16, 16, ...hemPts, 1, 16];
  p.poly(pts, SHADE[2]);
  p.shadeVertical(1, 9, 16, 12, [SHADE[3], SHADE[2], SHADE[1], SHADE[0]]);
  // sleeves / hands
  if (cast) {
    p.poly([2, 10 + bob, 0, 3 + bob, 3, 2 + bob, 5, 9 + bob], SHADE[3]);
    p.poly([15, 10 + bob, 17, 3 + bob, 14, 2 + bob, 12, 9 + bob], SHADE[3]);
    p.px(1, 2 + bob, '#ffe6fa');
    p.px(16, 2 + bob, '#ffe6fa');
  } else {
    p.poly([3, 10 + bob, 1, 15 + bob, 4, 14 + bob], SHADE[3]);
    p.poly([14, 10 + bob, 16, 15 + bob, 13, 14 + bob], SHADE[1]);
  }
  // hood
  p.circle(8.5, 6.5 + bob, 5.6, SHADE[3]);
  sphere(p, 8.5, 6.5 + bob, 5.6, 5.6, SHADE, false);
  p.poly([8, 0 + bob, 11, 2 + bob, 6, 2 + bob], SHADE[3]);
  // dark face
  p.ellipse(9, 7.5 + bob, 3.7, 3.4, '#140a22');
  // eyes
  const eye = cast ? '#ffffff' : '#ffb0f0';
  p.px(7, 6 + bob, '#ff52dc');
  p.px(10, 6 + bob, '#ff52dc');
  p.px(7, 6 + bob - (cast ? 1 : 0), eye);
  p.px(10, 6 + bob - (cast ? 1 : 0), eye);
  // wailing mouth
  p.rect(8, 9 + bob, 2, cast ? 2 : 1, '#3a1050');
}
frames('wshade', 'float', 4, 18, 21, (p, i) => paintShade(p, i, false), { fps: 7 });
frames('wshade', 'cast', 2, 18, 21, (p, i) => paintShade(p, i + 1, true), { fps: 10 });

function* shadeFade(e: Enemy, w: World, from: number, to: number, time: number) {
  for (let el = 0; el < time; el += w.dt) {
    e.alpha = from + (to - from) * Math.min(1, el / time);
    yield;
  }
  e.alpha = to;
}

defineEnemy({
  id: 'wailing_shade',
  name: '곡하는 망령',
  hp: 24,
  radius: 5,
  speed: 34,
  flying: true,
  phasing: true,
  sprite: 'wshade_float',
  shadow: 10,
  spriteYOffset: -8,
  cost: 1.5,
  floors: [1, 2],
  weight: 0.8,
  champion: true,
  deathFx: 'void',
  bloodColor: '#b890ff',
  light: { radius: 24, color: '#c070ff' },
  init(e) {
    e.alpha = 0.9;
  },
  *script(e, w) {
    while (true) {
      e.setAnim('wshade_float');
      const t = w.rng.range(1.2, 2.0);
      for (let el = 0; el < t; el += w.dt) {
        const tg = e.target(w);
        const a = Math.atan2(e.y - tg.y, e.x - tg.x);
        const gx = tg.x + Math.cos(a) * 74;
        const gy = tg.y + Math.sin(a) * 60;
        e.moveDir(gx - e.x, gy - e.y, Math.min(e.speed, Math.hypot(gx - e.x, gy - e.y) * 2));
        yield;
      }
      // cast homing spirit bolts
      e.stop();
      e.setAnim('wshade_cast');
      e.facing = w.player.x >= e.x ? 1 : -1;
      e.telegraph(0.6);
      gather(w, e.x, e.y - 8, ['#ffffff', '#ff9af0', '#ff52dc'], 12, 20);
      w.sfx('orb', { vol: 0.5, pitch: 0.7 });
      yield 0.6;
      e.shootAt(w, null, bullet('spirit', 3, { count: 3, spread: 0.32, speed: 76, homing: 0.75, life: 3.4, z: 8 }));
      yield 0.45;
      // blink: fade out, shimmer at the destination, fade back in
      e.setAnim('wshade_float');
      e.vulnerable = false;
      e.harmful = false;
      w.sfx('teleport', { vol: 0.35, pitch: 1.3 });
      yield* shadeFade(e, w, e.alpha, 0, 0.3);
      e.hidden = true;
      const spot = spotAround(w, w.player.x, w.player.y, 64, 104, 6, true) ?? { x: e.x, y: e.y };
      for (let el = 0; el < 0.5; el += w.dt) {
        if (fx.chance(0.6)) {
          w.particles.spawn({
            x: spot.x + fx.range(-6, 6), y: spot.y - 4 + fx.range(-4, 4), vy: -fx.range(10, 30), life: fx.range(0.3, 0.5),
            colors: ['#ffffff', '#e0a0ff', '#8a40ff'], size: fx.range(1, 2), additive: true, light: 5,
          });
        }
        yield;
      }
      e.x = spot.x;
      e.y = spot.y;
      e.hidden = false;
      yield* shadeFade(e, w, 0, 0.9, 0.35);
      e.vulnerable = true;
      e.harmful = true;
    }
  },
  draw(e, r) {
    e.drawDefault(r, e.frame(), -8 + Math.sin(e.age * 3) * 1.5);
  },
});

// ================================================================== 항아리 흉내쟁이 (urn mimic)
// Sits among the room's pots. Wakes when approached, shot, or left alone; then hops
// at the player, spitting pottery shards on every other landing.
function paintPot(p: PixelPainter, base: string, oy: number): void {
  // mirrors the room's pot tile painter so the disguise is convincing
  p.ellipse(8, 11 + oy, 6, 6, base);
  p.rect(5, 3 + oy, 6, 4, base);
  p.shadeSphere(8, 10 + oy, 7, 7, [darken(base, 0.5), darken(base, 0.25), base, lighten(base, 0.25)]);
  p.rect(4, 3 + oy, 8, 2, darken(base, 0.1));
  p.rect(5, 3 + oy, 6, 1, lighten(base, 0.3));
  p.line(3, 10 + oy, 13, 10 + oy, darken(base, 0.4));
}

const POT_BASES = ['#8a6a4a', '#9a5a3a'];
const MIMIC_OY = 4; // canvas head-room for the lifted lid

/** Paint the pot with its top (rows above `split`) lifted by `lift` px and a mouth in the gap. */
function paintMimic(p: PixelPainter, base: string, lift: number, legs: number, eyes: boolean, teeth = true): void {
  const tmp = new PixelPainter(16, 22);
  paintPot(tmp, base, MIMIC_OY);
  const split = 10 + MIMIC_OY;
  // legs first (behind the body)
  if (legs > 0) {
    p.rect(4, 15 + MIMIC_OY + legs - 1, 2, 2, '#5a3a24');
    p.rect(10, 15 + MIMIC_OY + legs - 1, 2, 2, '#5a3a24');
  }
  for (let y = 0; y < 22; y++) {
    for (let x = 0; x < 16; x++) {
      const v = tmp.data[y * 16 + x];
      if (!(v >>> 24)) continue;
      const ty = y < split ? y - lift : y;
      if (ty >= 0) p.data[ty * 16 + x] = v;
    }
  }
  if (lift > 0 && !teeth) {
    p.rect(3, split - lift, 10, lift, '#140608');
  } else if (lift > 0) {
    // mouth interior with teeth
    p.rect(3, split - lift, 10, lift, '#5a0a18');
    p.rect(4, split - lift + 1, 8, Math.max(1, lift - 2), '#a01a30');
    for (let x = 4; x < 13; x += 2) {
      p.px(x, split - lift, '#fff4e0');
      p.px(x - 1, split - 1, '#fff4e0');
    }
    if (lift >= 4) p.rect(6, split - 2, 4, 1, '#ff6a7a');
  }
  if (eyes && !teeth) {
    p.px(6, split - lift, '#ffe040');
    p.px(10, split - lift, '#ffe040');
    p.px(7, split - lift, '#fff8c0');
    p.px(11, split - lift, '#fff8c0');
  } else if (eyes) {
    const ey = split - lift - 1;
    p.px(6, Math.max(0, ey - 1), '#ffe040');
    p.px(10, Math.max(0, ey - 1), '#ffe040');
  }
  p.outline(OUTLINE);
}

for (let v = 0; v < 2; v++) {
  const base = POT_BASES[v];
  const o = { origin: [8, 15 + MIMIC_OY - 3] as [number, number], outline: null };
  frames('urnmimic', `pot${v}`, 1, 16, 22, (p) => {
    paintPot(p, base, MIMIC_OY);
    p.outline(OUTLINE);
  }, o);
  frames('urnmimic', `peek${v}`, 2, 16, 22, (p, i) => paintMimic(p, base, 2 + i, 0, true, false), { ...o, fps: 12 });
  frames('urnmimic', `chomp${v}`, 2, 16, 22, (p, i) => paintMimic(p, base, i ? 2 : 5, 1, true), { ...o, fps: 7 });
  frames('urnmimic', `hop${v}`, 1, 16, 22, (p) => paintMimic(p, base, 1, 2, true), o);
}

function mimicAnim(e: Enemy, state: string): void {
  e.setAnim(`urnmimic_${state}${e.mem.v}`);
}

defineEnemy({
  id: 'urn_mimic',
  name: '항아리 흉내쟁이',
  hp: 34,
  radius: 6,
  speed: 0,
  sprite: 'urnmimic_pot0',
  shadow: 0,
  cost: 1.5,
  floors: [1, 2],
  weight: 0.5,
  champion: false,
  deathFx: 'none',
  bloodColor: '#c08a5a',
  hurtSfx: 'hit',
  init(e) {
    e.mem.v = e.id % 2;
    e.mem.disguised = true;
    e.harmful = false;
    // below the spawn-flicker threshold so the disguise is not given away on room entry
    e.dormant = 0.25;
    mimicAnim(e, 'pot');
  },
  *script(e, w) {
    let alone = 0;
    while (e.mem.disguised) {
      const others = w.enemies.some((o) => o !== e && o.alive && !(o.def.id === 'urn_mimic' && o.mem.disguised));
      alone = others ? 0 : alone + w.dt;
      if (e.mem.provoked || e.distToTarget(w) < 36 || alone > 0.8) break;
      yield;
    }
    e.mem.disguised = false;
    // reveal: rattle and peek
    mimicAnim(e, 'peek');
    e.telegraph(0.6);
    w.sfx('enemy_roar', { vol: 0.45, pitch: 1.7 });
    for (let el = 0; el < 0.6; el += w.dt) {
      e.rot = Math.sin(el * 50) * 0.14;
      yield;
    }
    e.rot = 0;
    e.harmful = true;
    let hops = 0;
    while (true) {
      for (let k = 0; k < 3; k++) {
        mimicAnim(e, 'chomp');
        e.telegraph(0.28);
        const tg = e.target(w);
        const step = stepToward(e.x, e.y, tg.x, tg.y, 54);
        const land = landingSpot(w, step.x, step.y, e.r);
        w.spawn(new GroundWarning(land.x, land.y, 9, 0.28 + 0.46, undefined, WARN_RED));
        yield 0.28;
        mimicAnim(e, 'hop');
        e.facing = land.x >= e.x ? 1 : -1;
        yield* e.jumpTo(w, land.x, land.y, 0.46, 24);
        hops++;
        mimicAnim(e, 'chomp');
        dust(w, e.x, e.y + 4, ['#8a6a4a', '#5a4030'], 6, 50);
        if (hops % 2 === 0) {
          e.shootRing(w, 6, bullet('crypt', 3, { speed: 84, offset: w.rng.angle() }));
          w.spawn(new RingFx(e.x, e.y + 2, 18, 0.25, '#ffd0a0', 2));
        }
        yield 0.22;
      }
      yield 0.6;
    }
  },
  onHurt(e) {
    if (e.mem.disguised) e.mem.provoked = true;
  },
  onDeath(e, w) {
    w.sfx('pot_break', { vol: 0.8 });
    w.particles.burst(e.x, e.y - 2, {
      count: 18, speed: [40, 130], life: [0.3, 0.8], colors: ['#c08a5a', '#8a5a3a', '#5a3a2a'], size: [1, 3],
      gravity: 300, vz: [40, 130], shape: 'square', vrot: 10,
    });
    w.particles.burst(e.x, e.y - 2, { count: 8, speed: [30, 90], life: [0.3, 0.6], colors: ['#a01a30', '#5a0a18'], size: [1, 2], gravity: 300, vz: [30, 90] });
    for (let i = 0; i < 3; i++) w.decal(e.x + fx.range(-5, 5), e.y + fx.range(-2, 4), '#5a3a2a', fx.range(1.5, 3));
    w.decal(e.x, e.y + 2, '#7a1020', 3);
  },
  draw(e, r) {
    if (!e.mem.disguised) r.shadow(e.x, e.y + 5, 13 * (1 - Math.min(0.5, e.z / 60)), 5, 0.3);
    e.drawDefault(r);
  },
});
