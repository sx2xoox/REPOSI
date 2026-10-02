// Floor 3 — 잿불 대장간 (ember forge): fire imps, a shield-guarded sentinel, a bellows
// flame turret, an ember wisp with orbiting motes, a chained hound that charges, a
// slag golem that splits into molten lumps, and an anvil mortar (artillery).

import { defineEnemy } from '../../game/defs';
import { PixelPainter, ramp } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { GroundWarning, RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { rotateToward, TAU } from '../../engine/math';
import type { Enemy } from '../../game/enemy';
import {
  appliedDamage, bullet, BUL, dizzy, dust, frames, gather, Hazard, isFrontalHit, landingSpot, lob, rayFree, sphere,
  stepToward, volleyTargets, WARN_RED,
} from './shared';

const SOOT = ['#4a3a34', '#2a2024', '#6a5a50'];
const MAGMA = { hot: '#fff0a0', mid: '#ffa424', low: '#e0480c' };

// ================================================================== 불씨 도깨비 (fire imp) — skirmisher
const IMP = ramp('#d8422a', 5);
const HORN = '#f2d48a';

function paintImp(p: PixelPainter, k: number, mode: 'run' | 'wind' | 'throw'): void {
  const step = mode === 'run' ? [0, 1, 2][k] : 0;
  // tail
  const tw = [0, 1, 0][k % 3];
  p.line(3, 11, 1, 9 - tw, IMP[1]);
  p.poly([0, 7 - tw, 2, 8 - tw, 1, 10 - tw], IMP[3]);
  // legs
  const la = [-1, 0, 1][step];
  p.rect(5 + la, 13, 2, 3, IMP[0]);
  p.rect(8 - la, 13, 2, 3, IMP[0]);
  p.px(4 + la, 15, IMP[0]);
  p.px(10 - la, 15, IMP[0]);
  // torso
  p.ellipse(7.5, 11, 3.4, 2.9, IMP[2]);
  sphere(p, 7.5, 11, 3.4, 2.9, IMP, false);
  // back arm
  p.line(5, 10, 4, 12, IMP[1]);
  // head
  p.circle(8, 6.5, 3.8, IMP[2]);
  sphere(p, 8, 6.5, 3.8, 3.8, IMP, false);
  // horns
  p.line(5, 3, 4, 1, HORN);
  p.px(5, 4, HORN);
  p.line(10, 3, 11, 1, HORN);
  p.px(10, 4, HORN);
  // flame hair
  const fl = k % 3;
  p.poly([6, 3, 7 + (fl === 1 ? 1 : 0), -0.5, 8, 2.5, 9 - (fl === 2 ? 1 : 0), 0, 10, 3], MAGMA.mid);
  p.px(8, 1, MAGMA.hot);
  // face: big eye + grin
  p.px(9, 6, '#fff060');
  p.px(10, 6, '#fff060');
  p.px(10, 5, '#2a0808');
  p.rect(8, 8, 4, 1, '#2a0808');
  p.px(9, 8, '#ffffff');
  p.px(11, 8, '#ffffff');
  // front arm (+ fireball)
  if (mode === 'wind') {
    p.line(10, 10, 12, 6, IMP[3]);
    p.circle(12.5, 4, 2, MAGMA.mid);
    p.px(12, 3, MAGMA.hot);
    p.px(13, 4, MAGMA.hot);
  } else if (mode === 'throw') {
    p.line(10, 10, 13, 10, IMP[3]);
    p.px(13, 9, IMP[3]);
  } else {
    p.line(10, 10, 11, 12 - (step === 1 ? 1 : 0), IMP[3]);
  }
}
frames('fimp', 'run', 3, 15, 16, (p, i) => paintImp(p, i, 'run'), { anchor: 'bottom', fps: 12 });
frames('fimp', 'wind', 2, 15, 16, (p, i) => paintImp(p, i, 'wind'), { anchor: 'bottom', fps: 10 });
frames('fimp', 'throw', 1, 15, 16, (p) => paintImp(p, 0, 'throw'), { anchor: 'bottom' });

defineEnemy({
  id: 'fire_imp',
  name: '불씨 도깨비',
  hp: 20,
  radius: 5,
  speed: 64,
  sprite: 'fimp_run',
  spriteYOffset: 5,
  shadow: 9,
  cost: 1,
  floors: [3],
  weight: 1.2,
  champion: true,
  deathFx: 'ember',
  bloodColor: '#ff7a2a',
  light: { radius: 22, color: '#ff8030' },
  *script(e, w) {
    let side = w.rng.sign();
    while (true) {
      e.setAnim('fimp_run');
      const t = w.rng.range(1.1, 1.8);
      for (let el = 0; el < t; el += w.dt) {
        const d = e.distToTarget(w);
        const a = e.angleToTarget(w);
        if (d < 56) e.moveAngle(a + Math.PI + side * 0.6, e.speed);
        else if (d > 120) e.moveAngle(a + side * 0.5, e.speed * 0.9);
        else e.moveAngle(a + side * Math.PI / 2, e.speed * 0.85);
        if (e.mem.__bumped || w.rng.chance(0.01)) side = -side;
        yield;
      }
      // wind-up + throw a fan of fireballs
      e.halt();
      e.facing = w.player.x >= e.x ? 1 : -1;
      e.setAnim('fimp_wind');
      e.telegraph(0.42);
      w.sfx('fire', { vol: 0.35, pitch: 1.4 });
      yield 0.42;
      e.setAnim('fimp_throw');
      e.shootAt(w, null, bullet('molten', 3, { count: e.champion ? 5 : 3, spread: 0.22, speed: 92, accel: 70, maxSpeed: 170, z: 8 }));
      yield 0.3;
    }
  },
  update(e, w) {
    if (fx.chance(0.25)) {
      w.particles.spawn({
        x: e.x + fx.range(-1.5, 1.5), y: e.y - 15, vy: -fx.range(10, 22), vx: fx.range(-4, 4), life: fx.range(0.2, 0.4),
        colors: [MAGMA.hot, MAGMA.mid, '#801808'], size: 1, additive: true,
      });
    }
  },
});

// ================================================================== 방패 파수꾼 (forge sentinel) — front-guarded
// Advances behind a riveted tower shield that slowly turns toward the player.
// Frontal hits deal only 15%; flank it. Telegraphed shield-bash.
const IRON = ramp('#55505e', 5);
const BRASS = ramp('#c08a3a', 4);

function paintSentinel(p: PixelPainter, k: number, mode: 'walk' | 'brace'): void {
  const bob = mode === 'walk' ? [0, -1, 0, -1][k] : 1;
  const step = mode === 'walk' ? [1, 0, -1, 0][k] : 0;
  // legs
  p.rect(5 + step, 15, 3, 4, IRON[1]);
  p.rect(10 - step, 15, 3, 4, IRON[1]);
  p.rect(4 + step, 18, 4, 1, IRON[0]);
  p.rect(10 - step, 18, 4, 1, IRON[0]);
  // hammer on the back (behind)
  const hy = mode === 'brace' ? 3 : 5 + bob;
  p.line(4, 12 + bob, 2, hy + 2, '#6a4a2a');
  p.rect(0, hy - 1, 5, 3, IRON[2]);
  p.rect(0, hy - 1, 5, 1, IRON[4]);
  // torso: furnace-plated barrel
  p.rect(4, 7 + bob, 10, 9, IRON[2]);
  p.shadeVertical(4, 7 + bob, 10, 9, [IRON[4], IRON[3], IRON[2], IRON[1]]);
  p.rect(4, 7 + bob, 1, 9, IRON[3]);
  p.rect(13, 7 + bob, 1, 9, IRON[1]);
  // glowing belly grate
  p.rect(7, 11 + bob, 5, 3, '#2a0c06');
  p.px(8, 12 + bob, MAGMA.mid);
  p.px(10, 12 + bob, MAGMA.mid);
  p.px(9, 13 + bob, MAGMA.low);
  // rivets
  for (const [x, y] of [[5, 8], [12, 8], [5, 14], [12, 14]]) p.px(x, y + bob, BRASS[3]);
  // helm
  p.ellipse(9, 5 + bob, 4.4, 3.8, IRON[2]);
  sphere(p, 9, 5 + bob, 4.4, 3.8, IRON, false);
  p.rect(7, 5 + bob, 6, 1, '#1a0c08');
  p.rect(9, 5 + bob, 3, 1, mode === 'brace' ? '#ffffff' : MAGMA.mid);
  p.px(9, 1 + bob, BRASS[2]);
  p.px(9, 0 + bob, BRASS[3]);
}
frames('fsentinel', 'walk', 4, 18, 20, (p, i) => paintSentinel(p, i, 'walk'), { anchor: 'bottom', fps: 5 });
frames('fsentinel', 'brace', 1, 18, 20, (p) => paintSentinel(p, 0, 'brace'), { anchor: 'bottom' });

// shield seen from the front (face) and from the side (edge)
function paintShieldFace(p: PixelPainter, hot: boolean, back: boolean): void {
  const c = back ? ramp('#3e3846', 4) : ramp('#6e6878', 4);
  p.rect(0, 0, 12, 14, c[1]);
  p.rect(1, 1, 10, 12, c[2]);
  p.shadeVertical(1, 1, 10, 12, [c[3], c[2], c[2], c[1]]);
  p.rect(0, 0, 12, 1, c[3]);
  if (back) {
    p.rect(5, 2, 2, 10, '#6a4a2a');
    p.rect(2, 6, 8, 2, '#6a4a2a');
    return;
  }
  for (const [x, y] of [[1, 1], [10, 1], [1, 12], [10, 12], [5, 1], [6, 12]]) p.px(x, y, BRASS[3]);
  // forge emblem: an anvil with an ember
  p.rect(3, 6, 6, 2, BRASS[1]);
  p.rect(5, 8, 2, 2, BRASS[1]);
  p.rect(3, 6, 6, 1, BRASS[3]);
  p.px(6, 4, hot ? '#ffffff' : MAGMA.mid);
  p.px(6, 3, hot ? MAGMA.hot : MAGMA.low);
}
defineDrawnSprite('fsentinel_shield_face', 12, 14, (p) => paintShieldFace(p, false, false), { outline: '#0c0810', origin: [6, 13] });
defineDrawnSprite('fsentinel_shield_hot', 12, 14, (p) => paintShieldFace(p, true, false), { outline: '#0c0810', origin: [6, 13] });
defineDrawnSprite('fsentinel_shield_back', 12, 14, (p) => paintShieldFace(p, false, true), { outline: '#0c0810', origin: [6, 13] });
defineDrawnSprite('fsentinel_shield_side', 5, 16, (p) => {
  p.rect(0, 0, 5, 16, IRON[2]);
  p.rect(0, 0, 2, 16, IRON[3]);
  p.rect(4, 0, 1, 16, IRON[1]);
  p.px(1, 3, BRASS[3]);
  p.px(1, 12, BRASS[3]);
  p.px(2, 7, MAGMA.mid);
}, { outline: '#0c0810', origin: [2, 15] });

defineEnemy({
  id: 'forge_sentinel',
  name: '방패 파수꾼',
  hp: 52,
  radius: 7,
  speed: 24,
  mass: 3,
  sprite: 'fsentinel_walk',
  spriteYOffset: 6,
  shadow: 16,
  cost: 2,
  floors: [3],
  weight: 0.8,
  champion: true,
  deathFx: 'metal',
  bloodColor: '#9098a8',
  hurtSfx: 'hit_metal',
  light: { radius: 14, color: '#ff9a40' },
  init(e, w) {
    e.mem.shieldA = Math.atan2(w.player.y - e.y, w.player.x - e.x);
  },
  *script(e, w) {
    while (true) {
      e.setAnim('fsentinel_walk');
      yield* e.chaseFor(w, w.rng.range(1.6, 2.4), e.speed);
      const p = w.player;
      if (e.distToTarget(w) < 115 && w.room.lineOfSight(e.x, e.y, p.x, p.y)) {
        e.halt();
        e.setAnim('fsentinel_brace');
        // lock the shield onto the player, show the lane, then bash
        e.mem.lock = true;
        const a = e.angleToTarget(w);
        e.mem.shieldA = a;
        const len = rayFree(w.room, e.x, e.y, a, e.r, 80);
        const g = w.spawn(new GroundWarning(e.x, e.y, 6, 0.65, undefined, WARN_RED));
        g.rw = len + 8;
        g.rh = 14;
        g.angle = a;
        e.telegraph(0.65);
        w.sfx('enemy_charge', { vol: 0.5 });
        yield 0.65;
        e.mem.bash = true;
        yield* e.charge(w, a, e.speed * 7.5, 0.45);
        e.mem.bash = false;
        if (e.mem.__bumped) {
          w.shake(0.25);
          w.sfx('slam', { vol: 0.5 });
          dust(w, e.x + Math.cos(a) * 8, e.y + Math.sin(a) * 6, SOOT, 8, 60);
        }
        yield 0.55;
        e.mem.lock = false;
      }
    }
  },
  update(e, w, dt) {
    if (!e.mem.lock) {
      const want = e.angleToTarget(w);
      e.mem.shieldA = rotateToward(e.mem.shieldA, want, 1.7 * dt);
    }
    if (e.mem.blockT > 0) e.mem.blockT -= dt;
  },
  onHurt(e, w, hit) {
    if (hit.kind === 'status' || !isFrontalHit(e.mem.shieldA, hit.dirX, hit.dirY, 0.3)) return;
    const d = appliedDamage(hit, e.hasStatus('weak'), e.hasStatus('freeze'));
    e.hp += d * 0.85;
    e.squash(1, 1);
    e.kbx *= 0.3;
    e.kby *= 0.3;
    e.mem.blockT = 0.12;
    const sx = e.x + Math.cos(e.mem.shieldA) * 8;
    const sy = e.y - 6 + Math.sin(e.mem.shieldA) * 5;
    w.particles.burst(sx, sy, { count: 6, speed: [40, 120], life: [0.1, 0.25], colors: ['#ffffff', '#ffe080', MAGMA.mid], shape: 'spark', size: [1, 2] });
    w.sfx('shield_block', { vol: 0.45, pitch: fx.range(0.95, 1.15) });
  },
  draw(e, r) {
    const a = e.mem.shieldA ?? 0;
    const c = Math.cos(a);
    const s = Math.sin(a);
    e.facing = c >= 0 ? 1 : -1;
    const sx = e.x + c * 7;
    const sy = e.y + 4 + s * 4 - e.z;
    const hot = e.mem.bash || e.telegraphT > 0 || e.mem.blockT > 0;
    const face = Math.abs(s) > 0.62;
    const name = face ? (s < 0 ? 'fsentinel_shield_back' : hot ? 'fsentinel_shield_hot' : 'fsentinel_shield_face') : 'fsentinel_shield_side';
    const opts = { flipX: c < 0, flash: e.mem.blockT > 0 ? 0.8 : e.flash > 0 ? 0.5 : 0 };
    if (s < -0.2) r.sprite(name, sx, sy, opts);
    e.drawDefault(r);
    if (s >= -0.2) r.sprite(name, sx, sy, opts);
  },
});

// ================================================================== 풀무 포대 (bellows turret) — cone sprayer
const LEATHER = ramp('#7a4a2c', 4);

function paintBellows(p: PixelPainter, k: number, mode: 'idle' | 'inhale' | 'exhale'): void {
  // furnace box
  p.rect(2, 9, 16, 9, IRON[1]);
  p.shadeVertical(2, 9, 16, 9, [IRON[3], IRON[2], IRON[1], IRON[0]]);
  p.rect(2, 9, 16, 1, IRON[4]);
  p.rect(1, 16, 18, 2, IRON[0]);
  // glowing grate
  const glow = mode === 'inhale' ? MAGMA.hot : k ? MAGMA.mid : '#ff8a20';
  p.rect(6, 12, 8, 4, '#2a0a04');
  for (let x = 7; x < 14; x += 2) p.rect(x, 13, 1, 2, glow);
  // rivets
  for (const x of [3, 16]) {
    p.px(x, 11, BRASS[3]);
    p.px(x, 15, BRASS[3]);
  }
  // leather bellows on top (folds)
  const h = mode === 'inhale' ? 7 : mode === 'exhale' ? 3 : 5 - k * 0.5;
  const top = 9 - h;
  p.poly([4, 9, 16, 9, 14, top, 6, top], LEATHER[2]);
  for (let i = 1; i < 3; i++) {
    const y = Math.round(9 - (h * i) / 3);
    p.line(5, y, 15, y, LEATHER[0]);
  }
  p.rect(6, Math.round(top), 8, 1, LEATHER[3]);
  p.rect(8, Math.round(top) - 1, 4, 1, BRASS[2]);
}
frames('fbellows', 'idle', 2, 20, 18, (p, i) => paintBellows(p, i, 'idle'), { anchor: 'bottom', fps: 4 });
frames('fbellows', 'inhale', 1, 20, 18, (p) => paintBellows(p, 0, 'inhale'), { anchor: 'bottom' });
frames('fbellows', 'exhale', 2, 20, 18, (p, i) => paintBellows(p, i, 'exhale'), { anchor: 'bottom', fps: 14 });
defineDrawnSprite('fbellows_nozzle', 11, 7, (p) => {
  p.poly([0, 1, 8, 2, 11, 0, 11, 7, 8, 5, 0, 6], BRASS[2]);
  p.shadeVertical(0, 0, 11, 7, [BRASS[3], BRASS[2], BRASS[1], BRASS[0]], false);
  p.rect(9, 1, 2, 5, BRASS[0]);
  p.px(10, 3, '#2a0a04');
  p.rect(3, 1, 1, 5, BRASS[3]);
}, { outline: '#0c0810', origin: [1, 3] });

function nozzleTip(e: Enemy): { x: number; y: number } {
  const a = e.mem.aim ?? 0;
  return { x: e.x + Math.cos(a) * 12, y: e.y + Math.sin(a) * 8 };
}

defineEnemy({
  id: 'bellows_turret',
  name: '풀무 포대',
  hp: 42,
  radius: 8,
  speed: 0,
  mass: Infinity,
  sprite: 'fbellows_idle',
  spriteYOffset: 7,
  shadow: 18,
  cost: 2,
  floors: [3],
  weight: 0.7,
  champion: true,
  deathFx: 'metal',
  bloodColor: '#ff7a2a',
  hurtSfx: 'hit_metal',
  light: { radius: 30, color: '#ff7020' },
  init(e, w) {
    e.mem.aim = Math.atan2(w.player.y - e.y, w.player.x - e.x);
    e.mem.turn = 1.3;
  },
  *script(e, w) {
    yield w.rng.range(0.4, 1.2);
    while (true) {
      e.setAnim('fbellows_idle');
      e.mem.turn = 1.3;
      yield w.rng.range(1.4, 2.0);
      // inhale
      e.setAnim('fbellows_inhale');
      e.telegraph(0.7);
      w.sfx('beam_charge', { vol: 0.3, pitch: 0.7 });
      for (let el = 0; el < 0.7; el += 0.1) {
        const t = nozzleTip(e);
        gather(w, t.x, t.y - 10, ['#ffffff', MAGMA.hot, MAGMA.mid], 3, 14);
        yield 0.1;
      }
      // exhale: a sweeping cone of flame
      e.setAnim('fbellows_exhale');
      e.mem.turn = 0.45;
      w.sfx('fire', { vol: 0.6, pitch: 0.8 });
      const n = e.champion ? 16 : 12;
      for (let i = 0; i < n; i++) {
        const t = nozzleTip(e);
        const a = e.mem.aim + w.rng.range(-0.26, 0.26);
        e.shoot(w, a, bullet('molten', i % 3 === 0 ? 4 : 3, { x: t.x, y: t.y, z: 10, speed: w.rng.range(92, 128), accel: -45, minSpeed: 60, range: 220 }));
        if (i % 3 === 0) w.sfx('fire', { vol: 0.3, pitch: fx.range(1.1, 1.4) });
        yield 0.06;
      }
      e.squash(1.15, 0.85);
    }
  },
  update(e, w, dt) {
    e.mem.aim = rotateToward(e.mem.aim, e.angleToTarget(w), e.mem.turn * dt);
    if (fx.chance(0.06)) {
      w.particles.spawn({ x: e.x + fx.range(-4, 4), y: e.y - 16, vy: -fx.range(8, 16), vx: fx.range(-3, 3), life: fx.range(0.8, 1.4), colors: ['#6a6060', '#3a3434'], size: 2, sizeEnd: 4, alpha: 0.5 });
    }
  },
  draw(e, r) {
    const a = e.mem.aim ?? 0;
    const behind = Math.sin(a) < -0.3;
    const nz = { rot: a, flipY: Math.cos(a) < 0, flash: e.flash > 0 ? 1 : 0 };
    if (behind) r.sprite('fbellows_nozzle', e.x, e.y - 10 - e.z, nz);
    e.facing = 1;
    e.drawDefault(r);
    if (!behind) r.sprite('fbellows_nozzle', e.x, e.y - 10 - e.z, nz);
  },
});

// ================================================================== 잿불 도깨비불 (ember wisp) + 잿불 티끌 (ember mote)
// A drifting flame spirit circled by four motes. On a flare it flings the motes at
// the player one by one; they return and it slowly regrows lost ones.
function paintWisp(p: PixelPainter, k: number, flare: boolean): void {
  const sway = [0, 1, 0, -1][k];
  const tall = flare ? 2 : 0;
  // flame tongues
  p.poly([3, 12, 13, 12, 12 + sway, 6, 10 + sway, 3 - tall, 9, 6, 8 + sway, 0 - tall, 7, 5, 5 + sway, 2 - tall, 4, 7], MAGMA.low);
  p.poly([4.5, 12, 11.5, 12, 11 + sway, 7, 9.5 + sway, 5 - tall, 8 + sway, 2 - tall, 6.5 + sway, 5, 5, 7], MAGMA.mid);
  // core orb
  p.circle(8, 11.5, 4.6, MAGMA.mid);
  sphere(p, 8, 11.5, 4.6, 4.6, [MAGMA.low, MAGMA.mid, '#ffd060', MAGMA.hot, '#ffffff'], false);
  // face
  p.px(6, 11, '#3a0a04');
  p.px(10, 11, '#3a0a04');
  p.px(6, 10, flare ? '#ffffff' : '#7a1a04');
  p.px(10, 10, flare ? '#ffffff' : '#7a1a04');
  p.rect(7, 13, 3, flare ? 2 : 1, '#5a1004');
}
frames('ewisp', 'idle', 4, 16, 17, (p, i) => paintWisp(p, i, false), { fps: 10, outline: '#2a0802' });
frames('ewisp', 'flare', 4, 16, 17, (p, i) => paintWisp(p, i, true), { fps: 16, outline: '#2a0802' });

function paintMote(p: PixelPainter, k: number, hot: boolean): void {
  const sway = [0, 1, -1][k];
  p.poly([1, 7, 7, 7, 6 + sway * 0.5, 3, 4 + sway, 0, 2 + sway * 0.5, 3], hot ? MAGMA.mid : MAGMA.low);
  p.circle(4, 6, 2.6, hot ? MAGMA.hot : MAGMA.mid);
  p.circle(3.6, 5.6, 1.2, '#ffffff');
}
frames('emote', 'fly', 3, 8, 9, (p, i) => paintMote(p, i, false), { fps: 12, outline: '#2a0802' });
frames('emote', 'hot', 3, 8, 9, (p, i) => paintMote(p, i, true), { fps: 18, outline: '#2a0802' });

const MOTES = 4;

defineEnemy({
  id: 'ember_wisp',
  name: '잿불 도깨비불',
  hp: 30,
  radius: 6,
  speed: 30,
  flying: true,
  sprite: 'ewisp_idle',
  shadow: 10,
  spriteYOffset: -8,
  cost: 3,
  floors: [3],
  weight: 0.55,
  champion: true,
  deathFx: 'ember',
  bloodColor: '#ffa424',
  light: { radius: 34, color: '#ff8a30' },
  dieSfx: 'fire',
  init(e, w) {
    for (let i = 0; i < MOTES; i++) {
      const a = (i / MOTES) * TAU;
      const m = e.summon(w, 'ember_mote', e.x + Math.cos(a) * 14, e.y + Math.sin(a) * 10);
      if (m) {
        m.mem.owner = e;
        m.mem.slot = i;
        m.dormant = e.dormant;
      }
    }
  },
  *script(e, w) {
    let side = w.rng.sign();
    while (true) {
      e.setAnim('ewisp_idle');
      const t = w.rng.range(2.0, 2.8);
      for (let el = 0; el < t; el += w.dt) {
        const tg = e.target(w);
        const a = Math.atan2(e.y - tg.y, e.x - tg.x) + side * 0.6 * w.dt;
        const gx = tg.x + Math.cos(a + side * 0.4) * 78;
        const gy = tg.y + Math.sin(a + side * 0.4) * 60;
        e.moveDir(gx - e.x, gy - e.y + Math.sin(e.age * 3) * 20, Math.min(e.speed, Math.hypot(gx - e.x, gy - e.y) * 2));
        if (e.mem.__bumped) side = -side;
        yield;
      }
      e.stop();
      // regrow one lost mote
      const kids = w.enemies.filter((o) => o.alive && o.def.id === 'ember_mote' && o.mem.owner === e);
      if (kids.length < MOTES) {
        const used = new Set(kids.map((k) => k.mem.slot));
        let slot = 0;
        while (used.has(slot)) slot++;
        const m = e.summon(w, 'ember_mote', e.x, e.y);
        if (m) {
          m.mem.owner = e;
          m.mem.slot = slot;
          w.sfx('fire', { vol: 0.3, pitch: 1.6 });
        }
      }
      // flare and fling the motes one by one
      const orbiting = w.enemies.filter((o) => o.alive && o.def.id === 'ember_mote' && o.mem.owner === e && o.mem.mode !== 'fling');
      e.setAnim('ewisp_flare');
      e.telegraph(0.55);
      for (const m of orbiting) m.telegraph(0.55);
      gather(w, e.x, e.y - 8, ['#ffffff', MAGMA.hot, MAGMA.mid], 10, 20);
      w.sfx('fire', { vol: 0.5, pitch: 0.7 });
      yield 0.55;
      if (!orbiting.length) {
        // no motes left to throw: it spits a slow ring of embers instead
        e.shootRing(w, 6, bullet('molten', 3, { speed: 64, offset: w.rng.angle(), z: 8 }));
        yield 0.5;
        continue;
      }
      for (const m of orbiting) {
        if (!m.alive) continue;
        m.mem.mode = 'fling';
        yield 0.18;
      }
      yield 0.4;
    }
  },
  onDeath(e, w) {
    w.particles.burst(e.x, e.y - 8, { count: 20, speed: [40, 140], life: [0.3, 0.7], colors: ['#ffffff', MAGMA.hot, MAGMA.mid], size: [1, 3], additive: true, light: 8 });
    for (const o of w.enemies) if (o.alive && o.def.id === 'ember_mote' && o.mem.owner === e) o.mem.orphanT = 3.5;
  },
});

defineEnemy({
  id: 'ember_mote',
  name: '잿불 티끌',
  hp: 6,
  radius: 3,
  speed: 52,
  flying: true,
  sprite: 'emote_fly',
  shadow: 5,
  spriteYOffset: -8,
  cost: 0.5,
  floors: [3],
  weight: 0.25,
  champion: false,
  deathFx: 'ember',
  bloodColor: '#ffa424',
  light: { radius: 14, color: '#ff8a30' },
  dieSfx: 'fire',
  *script(e, w) {
    while (true) {
      const owner = e.mem.owner as Enemy | undefined;
      if (owner && owner.alive && e.mem.mode === 'fling') {
        // dash at the player
        e.setAnim('emote_hot');
        const a = e.angleToTarget(w);
        w.sfx('whoosh', { vol: 0.25, pitch: 1.6 });
        yield* e.charge(w, a, 150, 0.75);
        e.mem.mode = 'orbit';
        yield 0.2;
      } else if (owner && owner.alive) {
        // orbit the wisp
        e.setAnim('emote_fly');
        const ang = owner.age * 2.4 + (e.mem.slot ?? 0) * (TAU / MOTES);
        const gx = owner.x + Math.cos(ang) * 16;
        const gy = owner.y + Math.sin(ang) * 12;
        const d = Math.hypot(gx - e.x, gy - e.y);
        e.moveDir(gx - e.x, gy - e.y, Math.min(170, d * 9));
        yield;
      } else {
        // feral: erratic chase (burns out if its wisp died)
        e.setAnim('emote_hot');
        const a = e.angleToTarget(w) + w.rng.range(-0.9, 0.9);
        e.moveAngle(a, e.speed);
        yield w.rng.range(0.15, 0.3);
      }
    }
  },
  update(e, w, dt) {
    if (e.mem.orphanT !== undefined) {
      e.mem.orphanT -= dt;
      if (e.mem.orphanT <= 0) w.killEnemy(e);
    }
    if (fx.chance(0.3)) {
      w.particles.spawn({ x: e.x + fx.range(-1, 1), y: e.y - 8, vy: -fx.range(6, 16), life: fx.range(0.15, 0.3), colors: [MAGMA.hot, MAGMA.mid], size: 1, additive: true });
    }
  },
  draw(e, r) {
    e.drawDefault(r, e.frame(), -8 + Math.sin(e.age * 7 + e.id) * 1.2);
  },
});

// ================================================================== 사슬 사냥개 (chain hound) — telegraphed charger
const HOUND = ramp('#625866', 5);

function paintHound(p: PixelPainter, k: number, mode: 'run' | 'crouch' | 'charge' | 'dazed'): void {
  // gallop leg poses [backLeg dx, frontLeg dx]
  const pose = mode === 'run' ? [[-2, 2], [0, 0], [2, -2], [0, 0]][k] : mode === 'charge' ? [-3, 3] : [0, 0];
  const low = mode === 'crouch' ? 2 : mode === 'dazed' ? 1 : 0;
  const bob = mode === 'run' ? [0, -1, 0, -1][k] : 0;
  const by = 8 + low + bob;
  // legs
  const leg = (x: number, dx: number, c: string) => {
    p.line(x, by + 2, x + dx, 13, c);
    p.px(x + dx + 1, 13, c);
  };
  leg(5, pose[0], HOUND[1]);
  leg(14, pose[1], HOUND[1]);
  leg(7, -pose[0], HOUND[0]);
  leg(16, -pose[1], HOUND[0]);
  // tail
  p.line(3, by - 1, 0, by - 4 + (mode === 'charge' ? 3 : 0), HOUND[2]);
  // body
  p.ellipse(10, by, 7, 3.2, HOUND[2]);
  sphere(p, 10, by - 0.5, 7, 3.4, HOUND, false);
  // magma cracks along the flank
  p.line(6, by, 9, by - 1, MAGMA.mid);
  p.line(9, by - 1, 11, by + 1, MAGMA.low);
  p.px(13, by, MAGMA.mid);
  // head + snout
  const hy = mode === 'crouch' ? by + 1 : mode === 'dazed' ? by - 3 : by - 2;
  const hx = mode === 'charge' ? 18 : 17;
  p.circle(hx, hy, 3, HOUND[2]);
  sphere(p, hx, hy, 3, 3, HOUND, false);
  p.poly([hx + 1, hy - 1, hx + 5, hy + 0.5, hx + 1, hy + 2], HOUND[3]);
  p.px(hx + 4, Math.round(hy), '#1a0c0c');
  // ear
  p.poly([hx - 2, hy - 2, hx - 3, hy - 5, hx, hy - 3], HOUND[1]);
  // eye
  p.px(Math.round(hx), Math.round(hy - 1), mode === 'dazed' ? '#a0a0a0' : '#ffd040');
  // teeth
  if (mode === 'crouch' || mode === 'charge') {
    p.px(Math.round(hx + 2), Math.round(hy + 1), '#ffffff');
    p.px(Math.round(hx + 4), Math.round(hy + 1), '#ffffff');
  }
  // collar
  p.line(hx - 3, hy - 1, hx - 2, hy + 2, '#9a929e');
  p.px(hx - 3, hy + 2, '#c8c0d0');
}
frames('chound', 'run', 4, 22, 14, (p, i) => paintHound(p, i, 'run'), { anchor: 'bottom', fps: 12 });
frames('chound', 'crouch', 2, 22, 14, (p) => paintHound(p, 0, 'crouch'), { anchor: 'bottom', fps: 8 });
frames('chound', 'charge', 1, 22, 14, (p) => paintHound(p, 0, 'charge'), { anchor: 'bottom' });
frames('chound', 'dazed', 1, 22, 14, (p) => paintHound(p, 0, 'dazed'), { anchor: 'bottom' });
defineDrawnSprite('chound_link', 4, 3, (p) => {
  p.rectOutline(0, 0, 4, 3, '#9a929e');
  p.px(1, 0, '#d8d0e0');
}, { outline: '#140c1c' });

defineEnemy({
  id: 'chain_hound',
  name: '사슬 사냥개',
  hp: 36,
  radius: 6,
  speed: 44,
  mass: 1.5,
  sprite: 'chound_run',
  spriteYOffset: 5,
  shadow: 16,
  cost: 2,
  floors: [3],
  weight: 1,
  champion: true,
  deathFx: 'blood',
  bloodColor: '#8a2a1a',
  light: { radius: 12, color: '#ff8a30' },
  *script(e, w) {
    while (true) {
      e.setAnim('chound_run');
      yield* e.chaseFor(w, w.rng.range(1.0, 1.8), e.speed);
      const p = w.player;
      if (e.distToTarget(w) > 160 || !w.room.lineOfSight(e.x, e.y, p.x, p.y)) continue;
      e.halt();
      e.setAnim('chound_crouch');
      const a = e.angleToTarget(w);
      e.facing = Math.cos(a) >= 0 ? 1 : -1;
      const len = rayFree(w.room, e.x, e.y, a, e.r, 260);
      const g = w.spawn(new GroundWarning(e.x, e.y, 6, 0.65, undefined, WARN_RED));
      g.rw = len + 8;
      g.rh = 12;
      g.angle = a;
      e.telegraph(0.65);
      w.sfx('enemy_roar', { vol: 0.45, pitch: 0.8 });
      yield 0.65;
      e.setAnim('chound_charge');
      w.sfx('enemy_charge', { vol: 0.5 });
      yield* e.charge(w, a, e.speed * 5.4, 1.3);
      if (e.mem.__bumped) {
        // slammed into a wall: dazed (punish window)
        w.shake(0.3);
        w.sfx('slam', { vol: 0.6 });
        dust(w, e.x + Math.cos(a) * 6, e.y, SOOT, 10, 70);
        e.knock(-Math.cos(a), -Math.sin(a), 120);
        e.setAnim('chound_dazed');
        e.mem.dazed = 1.0;
        yield 1.0;
        e.mem.dazed = 0;
      } else {
        yield 0.35;
      }
    }
  },
  update(e, w, dt) {
    if (e.mem.dazed > 0) {
      e.mem.dazed -= dt;
      dizzy(w, e);
    }
    if (e.anim === 'chound_charge' && fx.chance(0.6)) {
      w.particles.spawn({ x: e.x - e.facing * 6, y: e.y + 2, vx: -e.facing * fx.range(10, 30), vy: fx.range(-10, 0), life: fx.range(0.2, 0.4), colors: ['#ffd060', MAGMA.mid, '#5a2010'], size: 1, additive: true });
    }
  },
  draw(e, r, w) {
    // broken chain trailing from the collar
    const back = -e.facing;
    for (let i = 0; i < 4; i++) {
      const lx = e.x + back * (2 + i * 3.5);
      const ly = e.y - 3 + i * 1.5 + Math.sin(w.time * 14 + i * 1.3) * (e.anim === 'chound_charge' ? 0.5 : 1.2);
      r.sprite('chound_link', lx, ly - e.z);
    }
    e.drawDefault(r);
  },
});

// ================================================================== 쇳물 골렘 (slag golem) — tough slammer, splits on death
const BASALT = ramp('#3e3438', 5);

function paintGolem(p: PixelPainter, k: number, mode: 'walk' | 'raise' | 'slam'): void {
  const step = mode === 'walk' ? (k ? 1 : -1) : 0;
  const bodyY = mode === 'slam' ? 15 : mode === 'raise' ? 12 : 13 + (k ? 0 : -1) * 0;
  // legs
  p.rect(8, 21, 4, 5 - (step > 0 ? 1 : 0), BASALT[1]);
  p.rect(15, 21, 4, 5 - (step < 0 ? 1 : 0), BASALT[1]);
  // torso
  p.ellipse(13.5, bodyY, 9, mode === 'slam' ? 7 : 8, BASALT[2]);
  sphere(p, 13.5, bodyY, 9, mode === 'slam' ? 7 : 8, BASALT);
  // glowing magma cracks
  p.line(9, bodyY - 3, 12, bodyY + 1, MAGMA.mid);
  p.line(12, bodyY + 1, 11, bodyY + 5, MAGMA.low);
  p.line(17, bodyY - 4, 16, bodyY, MAGMA.mid);
  p.line(16, bodyY, 19, bodyY + 3, MAGMA.low);
  p.px(13, bodyY + 3, MAGMA.hot);
  p.px(10, bodyY - 1, MAGMA.hot);
  // head with an eye slit
  const hy = bodyY - 8;
  p.ellipse(13.5, hy, 4, 3, BASALT[3]);
  sphere(p, 13.5, hy, 4, 3, BASALT, false);
  p.rect(11, hy, 6, 1, '#1a0806');
  p.rect(12, hy, 4, 1, mode === 'raise' ? MAGMA.hot : MAGMA.mid);
  // fists
  const fist = (x: number, y: number) => {
    p.circle(x, y, 3.6, BASALT[2]);
    sphere(p, x, y, 3.6, 3.6, BASALT, false);
    p.px(Math.round(x - 1), Math.round(y + 1), MAGMA.mid);
    p.px(Math.round(x + 1), Math.round(y + 1), MAGMA.low);
  };
  if (mode === 'raise') {
    fist(6, 4);
    fist(21, 4);
    p.line(7, 8, 9, bodyY - 3, BASALT[1]);
    p.line(20, 8, 18, bodyY - 3, BASALT[1]);
  } else if (mode === 'slam') {
    fist(3.5, 22);
    fist(23.5, 22);
  } else {
    fist(4, 15 + step);
    fist(23, 15 - step);
  }
}
frames('sgolem', 'walk', 2, 27, 27, (p, i) => paintGolem(p, i, 'walk'), { anchor: 'bottom', fps: 3 });
frames('sgolem', 'raise', 2, 27, 27, (p) => paintGolem(p, 0, 'raise'), { anchor: 'bottom', fps: 10 });
frames('sgolem', 'slam', 1, 27, 27, (p) => paintGolem(p, 0, 'slam'), { anchor: 'bottom' });

defineEnemy({
  id: 'slag_golem',
  name: '쇳물 골렘',
  hp: 80,
  radius: 10,
  speed: 22,
  mass: 4,
  sprite: 'sgolem_walk',
  spriteYOffset: 9,
  shadow: 24,
  cost: 3,
  floors: [3],
  weight: 0.5,
  champion: true,
  deathFx: 'ember',
  bloodColor: '#ff7a2a',
  dieSfx: 'enemy_die_big',
  light: { radius: 28, color: '#ff6020' },
  *script(e, w) {
    while (true) {
      e.setAnim('sgolem_walk');
      yield* e.chaseFor(w, w.rng.range(1.6, 2.6), e.speed);
      if (e.distToTarget(w) > 72) continue;
      // raise fists, warn, slam
      e.halt();
      e.setAnim('sgolem_raise');
      const R = 38;
      w.spawn(new GroundWarning(e.x, e.y, R, 0.8, undefined, WARN_RED));
      e.telegraph(0.8);
      w.sfx('enemy_roar', { vol: 0.5, pitch: 0.55 });
      yield 0.8;
      e.setAnim('sgolem_slam');
      w.shake(0.45);
      w.sfx('slam', { vol: 0.9 });
      const p = w.player;
      if (p.alive && p.z < 8 && Math.hypot(p.x - e.x, p.y - e.y) < R + p.r * 0.5) {
        if (p.hurt(w, 2, e.def.name)) {
          const d = Math.hypot(p.x - e.x, p.y - e.y) || 1;
          p.knock((p.x - e.x) / d, (p.y - e.y) / d, 220);
        }
      }
      w.spawn(new RingFx(e.x, e.y, R + 4, 0.35, MAGMA.mid, 3));
      dust(w, e.x, e.y + 2, SOOT, 16, 110);
      e.shootRing(w, e.champion ? 14 : 10, bullet('molten', 3, { speed: 74, offset: w.rng.angle() }));
      yield 0.9;
    }
  },
  onDeath(e, w) {
    w.spawn(new Hazard(e.x, e.y, 14, 2.2, 'fire', e.def.name));
    for (const s of [-1, 1]) {
      const m = e.summon(w, 'slag_lump', e.x + s * 8, e.y);
      if (m) m.knock(s, 0.3, 160);
    }
  },
});

// ================================================================== 쇳물 덩이 (slag lump)
function paintLump(p: PixelPainter, k: number, mode: 'idle' | 'hop'): void {
  const sx = mode === 'hop' ? 0.8 : k ? 1.08 : 1;
  const sy = mode === 'hop' ? 1.3 : k ? 0.88 : 1;
  const rx = 5.6 * sx;
  const ry = 7.5 * sy;
  const base = 10;
  // molten dome, widest on the floor
  p.ellipse(6.5, base, rx, ry, MAGMA.low);
  for (let x = 0; x < 13; x++) p.px(x, base + 1, null);
  sphere(p, 6.5, base - ry * 0.3, rx * 1.05, ry * 0.9, [MAGMA.low, '#ff6a14', MAGMA.mid, '#ffd060', MAGMA.hot], false);
  // dark cooling crust plates
  const top = base - ry;
  p.poly([2, base - 2, 4, top + 2.5, 7, top + 1.5, 6, base - 4], BASALT[1]);
  p.poly([8, top + 2, 11, base - 3, 9, base - 2], BASALT[2]);
  p.px(5, Math.round(top + 2), BASALT[3]);
  // eyes
  p.px(7, Math.round(base - ry * 0.45), '#2a0806');
  p.px(9, Math.round(base - ry * 0.45), '#2a0806');
  for (let x = 0; x < 13; x++) if (p.isSet(x, base)) p.px(x, base, MAGMA.low);
}
frames('slump', 'idle', 2, 13, 11, (p, i) => paintLump(p, i, 'idle'), { anchor: 'bottom', fps: 5, outline: '#2a0802' });
frames('slump', 'hop', 1, 13, 11, (p) => paintLump(p, 0, 'hop'), { anchor: 'bottom', outline: '#2a0802' });

defineEnemy({
  id: 'slag_lump',
  name: '쇳물 덩이',
  hp: 14,
  radius: 4,
  speed: 0,
  sprite: 'slump_idle',
  spriteYOffset: 4,
  shadow: 10,
  cost: 0.7,
  floors: [3],
  weight: 0.4,
  champion: true,
  deathFx: 'ember',
  bloodColor: '#ffa424',
  light: { radius: 16, color: '#ff7020' },
  *script(e, w) {
    yield w.rng.range(0.2, 0.5);
    while (true) {
      e.setAnim('slump_idle');
      yield w.rng.range(0.45, 0.8);
      e.telegraph(0.25);
      const tg = e.target(w);
      const s = stepToward(e.x, e.y, tg.x, tg.y, 40);
      const land = landingSpot(w, s.x, s.y, e.r);
      w.spawn(new GroundWarning(land.x, land.y, 7, 0.25 + 0.4, undefined, WARN_RED));
      yield 0.25;
      e.setAnim('slump_hop');
      yield* e.jumpTo(w, land.x, land.y, 0.4, 14);
      w.particles.burst(e.x, e.y, { count: 6, speed: [30, 70], life: [0.2, 0.4], colors: [MAGMA.hot, MAGMA.mid], size: [1, 1], additive: true, gravity: 200, vz: [20, 50] });
      w.decal(e.x, e.y + 1, '#1a0c0c', 2.5, 0.4);
    }
  },
});

// ================================================================== 모루 박격포 (anvil mortar) — artillery
function paintMortar(p: PixelPainter, k: number, mode: 'idle' | 'load' | 'fire'): void {
  // anvil base
  p.rect(4, 15, 13, 3, IRON[0]);
  p.rect(7, 12, 7, 3, IRON[1]);
  p.rect(1, 9, 17, 3, IRON[2]);
  p.poly([17, 9, 21, 9.5, 17, 12], IRON[2]);
  p.rect(1, 9, 17, 1, IRON[4]);
  p.px(19, 9, IRON[4]);
  // barrel
  const lift = mode === 'load' ? 2 : mode === 'fire' ? -1 : 0;
  const top = 2 + lift;
  p.rect(6, top + 1, 9, 9 - lift, IRON[1]);
  p.shadeVertical(6, top + 1, 9, 9 - lift, [IRON[3], IRON[2], IRON[1], IRON[0]]);
  p.rect(6, top + 1, 1, 9 - lift, IRON[3]);
  p.rect(5, top + 4, 11, 2, BRASS[1]);
  p.rect(5, top + 4, 11, 1, BRASS[3]);
  // molten mouth
  const glow = mode === 'load' ? MAGMA.hot : mode === 'fire' ? '#ffffff' : k ? MAGMA.mid : '#ff8a20';
  p.ellipse(10.5, top + 1, 4.6, 1.6, IRON[3]);
  p.ellipse(10.5, top + 1, 3.4, 1, glow);
}
frames('amortar', 'idle', 2, 22, 18, (p, i) => paintMortar(p, i, 'idle'), { anchor: 'bottom', fps: 3 });
frames('amortar', 'load', 2, 22, 18, (p, i) => paintMortar(p, i, 'load'), { anchor: 'bottom', fps: 10 });
frames('amortar', 'fire', 1, 22, 18, (p) => paintMortar(p, 0, 'fire'), { anchor: 'bottom' });
defineDrawnSprite('amortar_glob', 8, 8, (p) => {
  p.circle(4, 4, 4, MAGMA.mid);
  sphere(p, 4, 4, 4, 4, [MAGMA.low, MAGMA.mid, '#ffd060', MAGMA.hot], false);
  p.px(5, 5, BASALT[1]);
  p.px(2, 5, BASALT[1]);
  p.px(2, 2, '#ffffff');
}, { outline: '#260a02' });

defineEnemy({
  id: 'anvil_mortar',
  name: '모루 박격포',
  hp: 44,
  radius: 8,
  speed: 0,
  mass: Infinity,
  sprite: 'amortar_idle',
  spriteYOffset: 7,
  shadow: 20,
  cost: 2,
  floors: [3],
  weight: 0.6,
  champion: true,
  deathFx: 'metal',
  bloodColor: '#9098a8',
  hurtSfx: 'hit_metal',
  light: { radius: 22, color: '#ff7020' },
  *script(e, w) {
    yield w.rng.range(0.6, 1.6);
    while (true) {
      e.setAnim('amortar_idle');
      yield w.rng.range(2.0, 2.8);
      e.setAnim('amortar_load');
      e.telegraph(0.6);
      w.sfx('fuse', { vol: 0.4, pitch: 0.8 });
      gather(w, e.x, e.y - 16, ['#ffffff', MAGMA.hot], 6, 12);
      yield 0.6;
      e.setAnim('amortar_fire');
      const p = w.player;
      const n = e.champion ? 4 : 3;
      const pts = volleyTargets(e.x, e.y, p.x + p.vx * 0.4, p.y + p.vy * 0.4, n, 34);
      for (const pt of pts) {
        const land = landingSpot(w, pt.x + w.rng.range(-6, 6), pt.y + w.rng.range(-6, 6), 3);
        lob(w, e.x, e.y - 16, land.x, land.y, {
          sprite: 'amortar_glob', color: BUL.molten.color, time: 1.05, height: 64, warn: 13, hitRadius: 12, source: e.def.name, spin: 6,
          onLand: (ww, x, y) => ww.spawn(new Hazard(x, y, 11, 1.8, 'fire', '모루 박격포')),
        });
        w.sfx('explosion', { vol: 0.25, pitch: 1.8 });
        w.particles.burst(e.x, e.y - 18, { count: 8, speed: [20, 60], angle: -Math.PI / 2, spread: 1.2, life: [0.4, 0.9], colors: ['#8a8080', '#4a4444'], size: [2, 3], sizeEnd: 5, drag: 2 });
        e.squash(1.2, 0.8);
        yield 0.22;
      }
      yield 0.3;
    }
  },
});
