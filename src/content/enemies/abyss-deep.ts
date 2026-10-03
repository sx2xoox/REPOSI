// Floor 5 — 공허의 심장 (void abyss), part 2:
//  - 중력 구체 (gravity well): drags the player toward it while spinning out a slow spiral
//  - 심연의 아가리 (abyss maw): floor maw; lobs globs that leave void pools, bites if you
//    stand too close
//  - 별 포식자 (star-eater): big drifting leviathan; gathers orbiting stars and flings
//    them outward, or opens its maw to swallow your shots and spit them back as stars
//  - 심연 유충 (abyss larva): crawling fodder with a short telegraphed lunge

import { defineEnemy } from '../../game/defs';
import { PixelPainter } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { GroundWarning, RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { rotateToward, TAU } from '../../engine/math';
import type { ProjBehavior } from '../../game/projectile';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import {
  bullet, BUL, dust, frames, gather, hurtFrame, landingSpot, laneWarning, lob, pullSpeed, rayFree, sphere, starShot,
  volleyTargets, WARN_RED,
} from './shared';
import { VOIDDUST, VoidPool, VPINK, VTEAL } from './abyss';

const VOUT = '#08020f';

// ================================================================== 중력 구체 (gravity well)
function paintWell(p: PixelPainter, k: number, mode: 'idle' | 'pull' | 'hurt'): void {
  const c = 11;
  const ry = mode === 'pull' ? 4.2 : 3.4;
  const rx = 10.5;
  const hot = mode === 'pull';
  const spin = (k / 4) * TAU;
  const disk = (front: boolean) => {
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * TAU;
      const y = c + Math.sin(a) * ry;
      if ((Math.sin(a) >= 0) !== front) continue;
      const x = c + Math.cos(a) * rx;
      // bright streaks travel around the disk
      const s = Math.cos(a - spin) * 0.5 + 0.5;
      const col = s > 0.85 ? '#ffffff' : s > 0.55 ? (hot ? '#bffff0' : VTEAL.mid) : s > 0.25 ? VTEAL.low : '#0a4a3c';
      p.px(x, y, col);
      if (front) p.px(x, y + 1, s > 0.55 ? VTEAL.low : '#062a22');
    }
  };
  disk(false);
  // the black core with a violet event-horizon rim
  p.circle(c, c - 1, 6.4, '#7a30d0');
  p.circle(c, c - 1, 5.4, '#05020a');
  p.px(c - 3, c - 4, '#c070ff');
  p.px(c - 2, c - 5, '#e0b0ff');
  if (mode === 'hurt') {
    p.px(c, c - 1, '#ffffff');
    p.px(c + 1, c - 2, VTEAL.mid);
  } else {
    p.px(c, c - 1, hot ? '#3a1a5a' : '#140a22');
  }
  disk(true);
}
frames('gwell', 'idle', 4, 22, 20, (p, i) => paintWell(p, i, 'idle'), { fps: 8, outline: VOUT });
frames('gwell', 'pull', 4, 22, 20, (p, i) => paintWell(p, i, 'pull'), { fps: 16, outline: VOUT });
frames('gwell', 'hurt', 1, 22, 20, (p) => paintWell(p, 1, 'hurt'), { outline: VOUT });

const PULL_R = 150;
const PULL_MAX = 40;

defineEnemy({
  id: 'gravity_well',
  name: '중력 구체',
  hp: 52,
  radius: 8,
  speed: 22,
  mass: 3,
  flying: true,
  sprite: 'gwell_idle',
  shadow: 14,
  spriteYOffset: -10,
  cost: 3,
  floors: [5],
  weight: 0.7,
  champion: true,
  deathFx: 'void',
  bloodColor: '#8a5aff',
  light: { radius: 34, color: '#5affd0' },
  dieSfx: 'enemy_die_big',
  *script(e, w) {
    yield w.rng.range(0.4, 1.0);
    let spin = w.rng.angle();
    while (true) {
      e.setAnim('gwell_idle');
      const t = w.rng.range(1.6, 2.2);
      for (let el = 0; el < t; el += w.dt) {
        const d = e.distToTarget(w);
        if (d > 100) e.chase(w, e.speed);
        else if (d < 70) e.flee(w, e.speed);
        else e.stop();
        yield;
      }
      // gather, then pull + spiral
      e.halt();
      e.setAnim('gwell_pull');
      e.telegraph(0.7);
      w.sfx('beam_charge', { vol: 0.4, pitch: 0.5 });
      for (let el = 0; el < 0.7; el += 0.1) {
        gather(w, e.x, e.y - 10, ['#ffffff', VTEAL.mid, '#7a30d0'], 8, 40);
        yield 0.1;
      }
      e.mem.pulling = 1;
      w.spawn(new RingFx(e.x, e.y - 10, PULL_R * 0.6, 0.5, VTEAL.mid, 2));
      w.sfx('orb', { vol: 0.5, pitch: 0.4 });
      const arms = e.champion ? 3 : 2;
      for (let el = 0; el < 2.4; el += 0.2) {
        for (let i = 0; i < arms; i++) e.shoot(w, spin + (i / arms) * TAU, bullet('eldritch', 3, { speed: 56, z: 10, range: 280 }));
        spin += 0.42;
        if (Math.round(el * 5) % 3 === 0) w.sfx('enemy_shoot', { vol: 0.25, pitch: 0.8 });
        yield 0.2;
      }
      e.mem.pulling = 0;
      yield 0.8;
    }
  },
  update(e, w, dt) {
    if (!e.mem.pulling) return;
    const p = w.player;
    if (!p.alive) return;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const s = pullSpeed(d, PULL_R, PULL_MAX);
    if (s > 0 && d > e.r + 4) {
      // steady drag: knockback decays at 10/s, so this settles near `s` px/s
      p.kbx += (dx / d) * s * 10 * dt;
      p.kby += (dy / d) * s * 10 * dt;
    }
    // streaks being sucked in
    if (fx.chance(0.7)) {
      const a = fx.angle();
      const rr = fx.range(40, 90);
      w.particles.spawn({
        x: e.x + Math.cos(a) * rr, y: e.y - 10 + Math.sin(a) * rr * 0.7, vx: -Math.cos(a) * rr * 1.6, vy: -Math.sin(a) * rr * 1.1,
        life: 0.55, colors: ['#ffffff', VTEAL.mid, '#3a1a6a'], size: 1, additive: true,
      });
    }
  },
  draw(e, r, w) {
    if (e.mem.pulling) {
      const k = (w.time * 1.5) % 1;
      r.ring(e.x, e.y - 10, PULL_R * 0.55 * (1 - k), VTEAL.mid, 1, 0.35 * k);
    }
    e.drawDefault(r, hurtFrame(e, w, 'gwell_hurt_0'), -10 + Math.sin(e.age * 1.8) * 1.5);
  },
  onDeath(e, w) {
    w.spawn(new RingFx(e.x, e.y - 10, 30, 0.35, '#ffffff', 3));
    w.particles.burst(e.x, e.y - 10, { count: 24, speed: [60, 180], life: [0.3, 0.7], colors: ['#ffffff', VTEAL.mid, '#7a30d0'], size: [1, 2], additive: true, light: 6 });
  },
});

// ================================================================== 심연의 아가리 (abyss maw)
const MAW = ['#3a0618', '#6a1030', '#a02050', '#d84a7a', '#ff8ab0'];

function paintMaw(p: PixelPainter, k: number, open: number, mode: 'idle' | 'open' | 'spit' | 'chomp' | 'hurt'): void {
  const cx = 13;
  const cy = 8;
  const breath = mode === 'idle' ? k * 0.4 : 0;
  // lips
  p.ellipse(cx, cy, 12.2 + breath, 7 + breath * 0.5, MAW[2]);
  sphere(p, cx, cy - 1, 12.2 + breath, 7.4, MAW, false);
  // fleshy folds
  p.line(3, cy + 2, 6, cy + 5, MAW[1]);
  p.line(23, cy + 2, 20, cy + 5, MAW[1]);
  // little eyes ringing the maw
  const eye = (x: number, y: number) => {
    p.px(x, y, mode === 'hurt' ? MAW[1] : '#ffec50');
    p.px(x + 1, y, mode === 'hurt' ? MAW[1] : '#ffffff');
    p.px(x, y + 1, '#2a0408');
  };
  eye(4, cy - 4);
  eye(12, cy - 6);
  eye(20, cy - 4);
  // gullet
  const ry = 1 + open * 3.8;
  p.ellipse(cx, cy + 0.5, 8.5, ry + 0.6, MAW[0]);
  p.ellipse(cx, cy + 0.8, 7.2, ry, '#0a0006');
  if (open > 0.5) {
    p.ellipse(cx, cy + 1.6, 3.5, ry * 0.45, mode === 'spit' ? VPINK.mid : '#5a0a3a');
    if (mode === 'spit') p.px(cx, Math.round(cy + 1), '#ffffff');
  }
  // teeth
  for (let i = 0; i < 6; i++) {
    const x = cx - 6.5 + i * 2.6;
    const top = cy + 0.8 - ry - 0.5;
    const bot = cy + 0.8 + ry + 0.5;
    const tl = open > 0.3 ? 2.2 : 1.2;
    p.poly([x - 1, top, x + 1, top, x, top + tl], '#f4eef0');
    p.poly([x + 0.3, bot, x + 2.3, bot, x + 1.3, bot - tl], i % 2 ? '#d8d0d8' : '#f4eef0');
  }
  if (mode === 'chomp') {
    p.line(cx - 7, cy + 1, cx + 7, cy + 1, '#f4eef0');
  }
}
frames('amaw', 'idle', 2, 26, 16, (p, i) => paintMaw(p, i, 0.1, 'idle'), { fps: 2, outline: VOUT });
frames('amaw', 'open', 2, 26, 16, (p, i) => paintMaw(p, i, 0.75 + i * 0.25, 'open'), { fps: 8, outline: VOUT });
frames('amaw', 'spit', 1, 26, 16, (p) => paintMaw(p, 0, 1, 'spit'), { outline: VOUT });
frames('amaw', 'chomp', 1, 26, 16, (p) => paintMaw(p, 0, 0, 'chomp'), { outline: VOUT });
frames('amaw', 'hurt', 1, 26, 16, (p) => paintMaw(p, 0, 0.3, 'hurt'), { outline: VOUT });
defineDrawnSprite('amaw_glob', 8, 8, (p) => {
  p.circle(4, 4, 4, VPINK.mid);
  sphere(p, 4, 4, 4, 4, [VPINK.low, '#d02a8a', VPINK.mid, '#ff9ad0', VPINK.hot], false);
  p.px(5, 5, '#3a0628');
  p.px(2, 2, '#ffffff');
}, { outline: '#14000a' });

defineEnemy({
  id: 'abyss_maw',
  name: '심연의 아가리',
  hp: 58,
  radius: 9,
  speed: 0,
  mass: Infinity,
  contactDamage: 0,
  sprite: 'amaw_idle',
  shadow: 0,
  cost: 2.5,
  floors: [5],
  weight: 0.7,
  champion: true,
  deathFx: 'void',
  bloodColor: '#d02a6a',
  light: { radius: 22, color: '#ff4fae' },
  dieSfx: 'splat',
  *script(e, w) {
    yield w.rng.range(0.5, 1.2);
    while (true) {
      e.setAnim('amaw_idle');
      // idle: bite anything that comes close
      let bit = false;
      const t = w.rng.range(1.6, 2.2);
      for (let el = 0; el < t; el += w.dt) {
        if (e.distToTarget(w) < 40) {
          bit = true;
          break;
        }
        yield;
      }
      if (bit) {
        const R = 34;
        e.setAnim('amaw_open');
        w.spawn(new GroundWarning(e.x, e.y, R, 0.55, undefined, WARN_RED));
        e.telegraph(0.55);
        w.sfx('enemy_roar', { vol: 0.4, pitch: 1.1 });
        yield 0.55;
        e.setAnim('amaw_chomp');
        e.squash(1.3, 0.7);
        w.shake(0.25);
        w.sfx('slam', { vol: 0.6, pitch: 1.3 });
        for (const p of w.targets()) {
          const d = Math.hypot(p.x - e.x, p.y - e.y);
          if (p.alive && p.z < 8 && d < R + p.r * 0.5) {
            if (p.hurt(w, 2, e.def.name)) p.knock((p.x - e.x) / (d || 1), (p.y - e.y) / (d || 1), 200);
          }
        }
        w.particles.burst(e.x, e.y, { count: 10, speed: [40, 100], life: [0.2, 0.4], colors: ['#ffffff', MAW[3], MAW[2]], size: [1, 2], gravity: 260, vz: [30, 80] });
        yield 0.7;
        continue;
      }
      // spit globs that leave pools of void
      e.setAnim('amaw_open');
      e.telegraph(0.55);
      gather(w, e.x, e.y, ['#ffffff', VPINK.mid, MAW[2]], 8, 14);
      w.sfx('enemy_roar', { vol: 0.35, pitch: 0.6 });
      yield 0.55;
      e.setAnim('amaw_spit');
      const p = w.player;
      const pts = volleyTargets(e.x, e.y, p.x + p.vx * 0.35, p.y + p.vy * 0.35, e.champion ? 4 : 3, 32);
      for (const pt of pts) {
        const land = landingSpot(w, pt.x + w.rng.range(-5, 5), pt.y + w.rng.range(-5, 5), 3);
        lob(w, e.x, e.y - 4, land.x, land.y, {
          sprite: 'amaw_glob', color: BUL.void.color, time: 0.95, height: 54, warn: 12, hitRadius: 11, source: e.def.name, spin: 5,
          onLand: (ww, x, y) => ww.spawn(new VoidPool(x, y, 12, 2.6, '심연의 아가리')),
        });
        e.squash(1.2, 0.8);
        yield 0.22;
      }
      yield 0.4;
    }
  },
  update(e, w) {
    if (fx.chance(0.05)) {
      w.particles.spawn({ x: e.x + fx.range(-6, 6), y: e.y, vy: -fx.range(6, 14), life: fx.range(0.5, 0.9), colors: ['#ff8ab0', '#6a1030'], size: 1, alpha: 0.8 });
    }
  },
  draw(e, r, w) {
    const facing0 = e.facing;
    e.facing = 1;
    r.shadow(e.x, e.y + 2, 26, 9, 0.4);
    e.drawDefault(r, hurtFrame(e, w, 'amaw_hurt_0'));
    e.facing = facing0;
  },
});

// ================================================================== 별 포식자 (star-eater)
const SB = ['#0c0a2a', '#1a1a4a', '#2a2e70', '#4a5aa8', '#8ab0e8'];
const FIN = '#8af0ff';

function paintEater(p: PixelPainter, k: number, mode: 'glide' | 'gather' | 'devour' | 'spit' | 'hurt'): void {
  const flap = mode === 'glide' ? [0, -2, -3, -1][k] : mode === 'gather' ? -4 : mode === 'hurt' ? 2 : 0;
  // whip tail
  p.line(6, 13, 0, 15 + (k % 2), SB[3]);
  p.px(0, 16, FIN);
  // far wing: swept back like a manta's
  const ft = 2 + flap * 0.7;
  p.poly([10, 10, 20, 10, 9, ft + 2, 3, ft], SB[1]);
  p.line(20, 10, 4, ft, FIN);
  // body
  p.ellipse(15, 13, 10, 5.6, SB[2]);
  sphere(p, 15, 12, 10, 5.6, SB, true);
  // near wing
  const fb = 23 - flap;
  p.poly([9, 15, 20, 15, 9, fb - 2, 2, fb], SB[2]);
  p.shadeVertical(2, 15, 18, fb - 14, [SB[3], SB[2], SB[1]], false);
  p.line(20, 15, 3, fb, FIN);
  p.px(2, fb, '#ffffff');
  // starfield speckles
  for (const [x, y, c] of [[9, 11, '#ffffff'], [13, 9, '#ffec50'], [17, 14, '#ffffff'], [11, 15, '#ffffff'], [19, 11, '#ffec50'], [14, 17, '#8ab0e8'], [10, 19, '#ffffff'], [7, 5, '#ffffff'], [6, 20, '#ffec50'], [15, 12, '#8ab0e8']] as [number, number, string][]) {
    if (p.isSet(x, y)) p.px(x, y, (x + y + k) % 4 === 0 && mode === 'glide' ? SB[4] : c);
  }
  // head / mouth (faces right)
  const open = mode === 'devour' ? 4 : mode === 'spit' ? 3 : mode === 'gather' ? 1 : 0;
  p.ellipse(23, 13, 5, 4.5, SB[3]);
  sphere(p, 23, 12.5, 5, 4.5, SB, false);
  if (open > 0) {
    p.poly([28.5, 13 - open * 0.6, 22, 13, 28.5, 13 + open * 0.8], '#05020a');
    if (mode === 'devour') {
      p.px(25, 13, '#ffec50');
      p.px(26, 12, '#ffffff');
    }
    p.px(27, 13 - Math.round(open * 0.6), '#f4eef0');
    p.px(27, 13 + Math.round(open * 0.8), '#f4eef0');
  } else {
    p.line(23, 14, 28, 14, '#05020a');
  }
  // three eyes on the brow
  const ec = mode === 'hurt' ? SB[1] : mode === 'gather' || mode === 'devour' ? '#ffffff' : '#ffec50';
  p.px(22, 10, ec);
  p.px(24, 9, ec);
  p.px(26, 10, ec);
}
frames('seater', 'glide', 4, 30, 25, (p, i) => paintEater(p, i, 'glide'), { fps: 5, outline: '#04020e' });
frames('seater', 'gather', 2, 30, 25, (p, i) => paintEater(p, i, 'gather'), { fps: 8, outline: '#04020e' });
frames('seater', 'devour', 2, 30, 25, (p, i) => paintEater(p, i, 'devour'), { fps: 10, outline: '#04020e' });
frames('seater', 'spit', 1, 30, 25, (p) => paintEater(p, 0, 'spit'), { outline: '#04020e' });
frames('seater', 'hurt', 1, 30, 25, (p) => paintEater(p, 0, 'hurt'), { outline: '#04020e' });

/** Star bullet behavior: orbit `owner` in slot `slot`/`n`, then fly outward at `release` seconds. */
export function orbitThenRelease(owner: Enemy, slot: number, n: number, release: number, radius = 30): ProjBehavior {
  return {
    id: 'orbit-release',
    update(p) {
      if (p.mem.free) return;
      const a = owner.age * 2.4 + (slot / n) * TAU;
      if (!owner.alive || p.age >= release) {
        p.mem.free = 1;
        p.angle = a + 0.45;
        p.speed = 50;
        p.accel = 70;
        p.maxSpeed = 120;
        p.syncVel();
        return;
      }
      const rad = 6 + radius * Math.min(1, p.age / 0.35);
      p.x = owner.x + Math.cos(a) * rad;
      p.y = owner.y + Math.sin(a) * rad * 0.75;
      p.vx = 0;
      p.vy = 0;
    },
  };
}

/** Mouth position (ground coordinates) of a star-eater. */
function mouth(e: Enemy): { x: number; y: number } {
  return { x: e.x + e.facing * 12, y: e.y + 1 };
}

defineEnemy({
  id: 'star_eater',
  name: '별 포식자',
  hp: 92,
  radius: 11,
  speed: 26,
  mass: 4,
  flying: true,
  sprite: 'seater_glide',
  shadow: 24,
  spriteYOffset: -10,
  cost: 4,
  floors: [5],
  weight: 0.45,
  champion: true,
  deathFx: 'void',
  bloodColor: '#5a7aff',
  light: { radius: 36, color: '#7aa0ff' },
  dieSfx: 'enemy_die_big',
  *script(e, w) {
    yield w.rng.range(0.4, 1.0);
    let cycle = w.rng.int(0, 1);
    let side = w.rng.sign();
    while (true) {
      e.setAnim('seater_glide');
      const t = w.rng.range(1.8, 2.6);
      for (let el = 0; el < t; el += w.dt) {
        const tg = e.target(w);
        const a = Math.atan2(e.y - tg.y, e.x - tg.x) + side * 0.35 * w.dt;
        const gx = tg.x + Math.cos(a) * 100;
        const gy = tg.y + Math.sin(a) * 76;
        e.moveDir(gx - e.x, gy - e.y, Math.min(e.speed, Math.hypot(gx - e.x, gy - e.y) * 1.5));
        if (e.mem.__bumped) side = -side;
        yield;
      }
      e.halt();
      e.facing = w.player.x >= e.x ? 1 : -1;
      if (cycle % 2 === 0) {
        // gather a ring of stars, spin them, fling them out in a spiral
        e.setAnim('seater_gather');
        e.telegraph(0.6);
        w.sfx('orb', { vol: 0.45, pitch: 1.5 });
        gather(w, e.x, e.y - 10, ['#ffffff', '#ffec50', FIN], 14, 30);
        yield 0.6;
        const n = e.champion ? 10 : 8;
        for (let i = 0; i < n; i++) e.shoot(w, 0, starShot('star', 3, { x: e.x, y: e.y, speed: 0, z: 10, life: 6, range: 500, behaviors: [orbitThenRelease(e, i, n, 1.3)] }));
        w.sfx('summon', { vol: 0.35, pitch: 1.6 });
        yield 1.4;
        w.sfx('whoosh', { vol: 0.45, pitch: 0.8 });
        yield 0.5;
      } else {
        // open wide and swallow the player's shots, then spit them back as stars
        e.setAnim('seater_devour');
        e.telegraph(0.5);
        w.sfx('beam_charge', { vol: 0.4, pitch: 0.4 });
        yield 0.5;
        e.mem.eaten = 0;
        e.mem.devour = 1;
        yield 1.7;
        e.mem.devour = 0;
        e.setAnim('seater_spit');
        e.facing = w.player.x >= e.x ? 1 : -1;
        const m = mouth(e);
        const eaten = Math.min(10, e.mem.eaten);
        const count = Math.max(3, eaten);
        const a = Math.atan2(w.player.y - m.y, w.player.x - m.x);
        for (let i = 0; i < count; i++) {
          const off = (i - (count - 1) / 2) * (eaten > 5 ? 0.16 : 0.24);
          e.shoot(w, a + off, starShot('star', 3, { x: m.x, y: m.y, speed: 105 + (i % 2) * 15, z: 10 }));
        }
        w.sfx('enemy_shoot', { vol: 0.55, pitch: 0.9 });
        e.squash(0.85, 1.15);
        yield 0.7;
      }
      cycle++;
    }
  },
  update(e, w, dt) {
    if (!e.mem.devour) return;
    const m = mouth(e);
    for (const pr of w.projectiles) {
      if (pr.team !== 'player' || pr.dead || Math.hypot(pr.vx, pr.vy) < 30) continue;
      const d = Math.hypot(pr.x - m.x, pr.y - m.y);
      if (d < 12) {
        pr.dead = true;
        e.mem.eaten = (e.mem.eaten ?? 0) + 1;
        w.particles.burst(m.x, m.y - 10, { count: 4, speed: [20, 50], life: [0.15, 0.3], colors: ['#ffffff', '#ffec50'], size: [1, 1], additive: true });
        if ((e.mem.gulpT ?? 0) < w.time) {
          e.mem.gulpT = w.time + 0.12;
          w.sfx('splat', { vol: 0.25, pitch: 1.6 });
        }
      } else if (d < 60) {
        pr.angle = rotateToward(pr.angle, Math.atan2(m.y - pr.y, m.x - pr.x), 7 * dt);
        pr.syncVel();
      }
    }
    if (fx.chance(0.8)) {
      const a = fx.angle();
      const rr = fx.range(22, 50);
      w.particles.spawn({
        x: m.x + Math.cos(a) * rr, y: m.y - 10 + Math.sin(a) * rr * 0.6, vx: -Math.cos(a) * rr * 2.4, vy: -Math.sin(a) * rr * 1.5,
        life: 0.4, colors: ['#ffffff', FIN, '#4a5aa8'], size: 1, additive: true,
      });
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'seater_hurt_0'), -10 + Math.sin(e.age * 1.6) * 2);
    if (e.mem.devour) {
      const m = mouth(e);
      const k = (w.time * 3) % 1;
      r.ring(m.x, m.y - 10, 40 * (1 - k) + 6, FIN, 1, 0.4 * k);
    }
  },
});

// ================================================================== 심연 유충 (abyss larva)
const LARVA = ['#4a2a6a', '#7a5aa0', '#b090d0', '#e0c8f4'];

function paintLarva(p: PixelPainter, k: number, mode: 'crawl' | 'prep' | 'lunge' | 'hurt'): void {
  const stretch = mode === 'crawl' ? [0, 1, 2, 1][k] : mode === 'lunge' ? 3 : mode === 'prep' ? -1 : 0;
  const rear = mode === 'prep' ? 2 : 0;
  const seg = 3.2 + stretch * 0.3;
  // segments from tail (left) to head (right)
  for (let i = 0; i < 3; i++) {
    const x = 2.5 + i * seg;
    const y = 6 - (i === 2 ? rear : 0) - (mode === 'crawl' && (i + k) % 2 === 0 ? 0.5 : 0);
    p.ellipse(x, y, 2.6, 2.4 - (i === 0 ? 0.4 : 0), LARVA[2]);
    sphere(p, x, y, 2.6, 2.4, LARVA, false);
    p.px(Math.round(x), Math.round(y) - 2, VPINK.mid);
  }
  // head
  const hx = 2.5 + 3 * seg + 0.5;
  const hy = 5.5 - rear * 1.5;
  p.circle(hx, hy, 2.6, LARVA[1]);
  sphere(p, hx, hy, 2.6, 2.6, LARVA, false);
  p.px(Math.round(hx), Math.round(hy) - 1, mode === 'hurt' ? LARVA[3] : VPINK.mid);
  p.px(Math.round(hx) + 1, Math.round(hy) - 1, '#ffffff');
  // mandibles
  const open = mode === 'lunge' || mode === 'prep' ? 1 : 0;
  p.line(hx + 2, hy, hx + 3.5, hy - 1 - open, '#1a0a20');
  p.line(hx + 2, hy + 1, hx + 3.5, hy + 2 + open, '#1a0a20');
  // stubby legs
  for (let i = 0; i < 3; i++) p.px(Math.round(2.5 + i * seg) + ((k + i) % 2), 8, LARVA[0]);
}
frames('alarva', 'crawl', 4, 17, 9, (p, i) => paintLarva(p, i, 'crawl'), { anchor: 'bottom', fps: 10, outline: '#1a0628' });
frames('alarva', 'prep', 1, 17, 9, (p) => paintLarva(p, 0, 'prep'), { anchor: 'bottom', outline: '#1a0628' });
frames('alarva', 'lunge', 1, 17, 9, (p) => paintLarva(p, 0, 'lunge'), { anchor: 'bottom', outline: '#1a0628' });
frames('alarva', 'hurt', 1, 17, 9, (p) => paintLarva(p, 0, 'hurt'), { anchor: 'bottom', outline: '#1a0628' });

defineEnemy({
  id: 'abyss_larva',
  name: '심연 유충',
  hp: 13,
  radius: 4,
  speed: 50,
  sprite: 'alarva_crawl',
  spriteYOffset: 4,
  shadow: 12,
  cost: 0.7,
  floors: [5],
  weight: 1.1,
  champion: true,
  deathFx: 'goo',
  bloodColor: '#c06aff',
  light: { radius: 10, color: '#ff4fae' },
  *script(e, w) {
    yield w.rng.range(0.1, 0.5);
    while (true) {
      e.setAnim('alarva_crawl');
      const t = w.rng.range(0.9, 1.4);
      const wig = w.rng.range(0, TAU);
      for (let el = 0; el < t; el += w.dt) {
        e.chase(w, e.speed);
        // wriggle sideways a little
        const a = Math.atan2(e.wantVY, e.wantVX) + Math.sin(e.age * 9 + wig) * 0.5;
        e.moveAngle(a, e.speed);
        yield;
      }
      const p = w.player;
      if (e.distToTarget(w) > 64 || !w.room.lineOfSight(e.x, e.y, p.x, p.y)) continue;
      e.halt();
      e.setAnim('alarva_prep');
      const a = e.angleToTarget(w);
      e.facing = Math.cos(a) >= 0 ? 1 : -1;
      laneWarning(w, e.x, e.y, a, Math.min(64, rayFree(w.room, e.x, e.y, a, e.r, 64)) + 6, 8, 0.32);
      e.telegraph(0.32);
      w.sfx('enemy_charge', { vol: 0.25, pitch: 1.8 });
      yield 0.32;
      e.setAnim('alarva_lunge');
      yield* e.charge(w, a, 170, 0.3);
      dust(w, e.x, e.y + 2, ['#5a3a7a', '#3a1a4a'], 3, 30);
      yield 0.4;
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'alarva_hurt_0'));
  },
  onDeath(e, w) {
    w.particles.burst(e.x, e.y - 3, { count: 6, speed: [20, 60], life: [0.3, 0.5], colors: VOIDDUST, size: [1, 1], additive: true });
  },
});

