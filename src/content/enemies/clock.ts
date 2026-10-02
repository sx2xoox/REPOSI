// Floor 7 — 멈춘 태엽탑 (stopped clockwork spire), part 1:
//  - 태엽 쥐 (wind-up mouse): fodder that winds its key, zips down a telegraphed line
//    and stops dead when the spring runs down (then it is easy prey)
//  - 뻐꾸기 시계 (cuckoo clock, floors 7–8): a standing clock that opens its door on one
//    beat of the floor's rhythm and fires on the next; every fourth call is a full ring
//  - 톱니 굴렁쇠 (rolling gear): a loose cog that rolls and ricochets off walls along a
//    path shown before it moves, then wobbles to a dizzy stop
//  - 도자기 인형 (porcelain doll): waltzes closer on the beat, spins a ring of cogs;
//    cracks as it is hurt and finally runs wild with its gears showing

import { defineEnemy } from '../../game/defs';
import { PixelPainter } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { GroundWarning, RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { paintDial, paintGear } from '../props/clock';
import { frames, hurtFrame, laneWarning, rayFree, sphere, WARN_RED } from './shared';
import {
  AMBER, beatIndex, bouncePath, BRASS, cogShot, COUT, paintKey, PLUM, PORC, reflectAngle, shards, sparks, springPop, VERD,
} from './clock-shared';

// ================================================================== 태엽 쥐 (wind-up mouse)
function paintMouse(p: PixelPainter, k: number, mode: 'idle' | 'wind' | 'zip' | 'down' | 'hurt'): void {
  const zip = mode === 'zip';
  const wind = mode === 'wind';
  const down = mode === 'down';
  const rx = zip ? 5.6 : wind ? 4.2 : 4.8;
  const ry = zip ? 2.5 : wind ? 2.6 : 3;
  const cx = 6.5;
  const cy = 9 + (wind ? 0.5 : 0) + (down ? 0.5 : 0);
  // tail
  if (zip) p.line(0, 9, cx - rx + 1, 9, BRASS[2]);
  else {
    p.px(2, 9, BRASS[2]);
    p.px(1, 8, BRASS[2]);
    p.px(1, 7, BRASS[3]);
    p.px(2, 6, BRASS[3]);
  }
  // riveted brass body
  p.ellipse(cx, cy, rx, ry, BRASS[3]);
  sphere(p, cx, cy, rx, ry, BRASS, false);
  for (let x = Math.round(cx - rx) + 1; x < cx + rx - 1; x += 2) p.pxIn(x, Math.round(cy) + 1, BRASS[1]);
  p.pxIn(Math.round(cx - 2), Math.round(cy - 1), VERD[1]);
  // head with an ear, an eye and a porcelain nose
  const hx = cx + rx - 1;
  const hy = cy - 1.2;
  p.ellipse(hx, hy, 2.4, 2, BRASS[3]);
  sphere(p, hx, hy, 2.4, 2, BRASS, false);
  p.px(Math.round(hx) - 1, Math.round(hy) - 3, BRASS[2]);
  p.px(Math.round(hx) - 1, Math.round(hy) - 2, BRASS[4]);
  if (mode === 'hurt') {
    p.px(Math.round(hx), Math.round(hy) - 1, '#ffffff');
  } else {
    p.px(Math.round(hx), Math.round(hy) - 1, PLUM[0]);
    p.px(Math.round(hx) + 1, Math.round(hy) - 1, AMBER.mid);
  }
  p.px(Math.round(hx) + 2, Math.round(hy), PORC[3]);
  // feet
  p.px(Math.round(cx) - 2, 12, BRASS[1]);
  p.px(Math.round(cx) + 1, 12, BRASS[1]);
  if (zip) p.px(Math.round(cx) - 4, 12, BRASS[1]);
  // the key on its back: turns while winding, droops when run down
  if (down) {
    p.line(Math.round(cx) - 1, Math.round(cy - ry), Math.round(cx) - 4, Math.round(cy - ry) - 3, BRASS[3]);
    p.rect(Math.round(cx) - 6, Math.round(cy - ry) - 5, 3, 2, BRASS[2]);
    p.px(Math.round(cx) - 6, Math.round(cy - ry) - 5, BRASS[5]);
  } else paintKey(p, Math.round(cx) - 1, Math.round(cy - ry) + 1, wind ? k : 0);
}
frames('ckmouse', 'idle', 2, 13, 13, (p, i) => paintMouse(p, i, 'idle'), { anchor: 'bottom', fps: 3, outline: COUT });
frames('ckmouse', 'wind', 2, 13, 13, (p, i) => paintMouse(p, i, 'wind'), { anchor: 'bottom', fps: 12, outline: COUT });
frames('ckmouse', 'zip', 1, 13, 13, (p) => paintMouse(p, 0, 'zip'), { anchor: 'bottom', outline: COUT });
frames('ckmouse', 'down', 1, 13, 13, (p) => paintMouse(p, 0, 'down'), { anchor: 'bottom', outline: COUT });
frames('ckmouse', 'hurt', 1, 13, 13, (p) => paintMouse(p, 0, 'hurt'), { anchor: 'bottom', outline: COUT });

defineEnemy({
  id: 'windup_mouse',
  name: '태엽 쥐',
  hp: 14,
  radius: 5,
  speed: 30,
  sprite: 'ckmouse_idle',
  spriteYOffset: 3,
  shadow: 11,
  cost: 0.7,
  floors: [7],
  weight: 1.3,
  champion: true,
  deathFx: 'metal',
  bloodColor: '#9a7430',
  hurtSfx: 'hit_metal',
  light: { radius: 8, color: AMBER.mid },
  *script(e, w) {
    yield w.rng.range(0.2, 0.7);
    while (true) {
      // idle: a few ticks of the key
      e.setAnim('ckmouse_idle');
      e.halt();
      yield w.rng.range(0.4, 0.9);
      // winding: the key spins, the line it will take lights up
      e.setAnim('ckmouse_wind');
      const a = e.angleToTarget(w);
      e.facing = Math.cos(a) >= 0 ? 1 : -1;
      const len = Math.min(190, rayFree(w.room, e.x, e.y, a, e.r, 190) + 8);
      laneWarning(w, e.x, e.y, a, len, 9, 0.45);
      e.telegraph(0.45);
      w.sfx('clock_spring', { vol: 0.4, pitch: fx.range(1.1, 1.4) });
      yield 0.45;
      // zip!
      e.setAnim('ckmouse_zip');
      w.sfx('clock_ratchet', { vol: 0.35, pitch: 1.5 });
      yield* e.charge(w, a, e.champion ? 240 : 205, 0.85);
      if (e.mem.__bumped) {
        sparks(w, e.x + Math.cos(a) * 4, e.y + Math.sin(a) * 4, 5, 70);
        e.squash(1.3, 0.75);
        w.sfx('hit_metal', { vol: 0.25, pitch: 1.4 });
      }
      // the spring ran down: it sits there, key drooping, until it is wound again
      e.setAnim('ckmouse_down');
      e.halt();
      w.sfx('clock_tick', { vol: 0.3, pitch: 0.8 });
      yield w.rng.range(1.0, 1.3);
    }
  },
  update(e, w) {
    if (e.anim === 'ckmouse_zip' && fx.chance(0.5)) {
      w.particles.spawn({ x: e.x - e.facing * 4 + fx.range(-2, 2), y: e.y + 2, life: 0.25, colors: [BRASS[5], BRASS[3]], size: 1, alpha: 0.8 });
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'ckmouse_hurt_0'));
  },
  onDeath(e, w) {
    springPop(w, e.x, e.y - 3, 2);
    sparks(w, e.x, e.y - 2, 6, 80);
    w.particles.burst(e.x, e.y - 3, { count: 8, speed: [30, 90], life: [0.3, 0.6], colors: [BRASS[3], BRASS[1], VERD[1]], size: [1, 2], gravity: 320, vz: [30, 100], shape: 'square', vrot: 8 });
  },
});

// ================================================================== 뻐꾸기 시계 (cuckoo clock)
function paintCuckoo(p: PixelPainter, k: number, mode: 'idle' | 'open' | 'hurt'): void {
  const open = mode === 'open';
  // brass gable roof
  p.poly([8, 0, 15, 6.5, 1, 6.5], BRASS[3]);
  p.line(1, 6, 8, 0, BRASS[5]);
  p.line(8, 0, 15, 6, BRASS[1]);
  p.px(8, 1, BRASS[4]);
  // plum wood case with brass trims
  p.rect(2, 6, 12, 20, PLUM[2]);
  p.rect(2, 6, 1, 20, PLUM[3]);
  p.rect(13, 6, 1, 20, PLUM[1]);
  p.rect(2, 25, 12, 1, PLUM[0]);
  p.rect(2, 6, 12, 1, BRASS[4]);
  p.rect(2, 15, 12, 1, BRASS[3]);
  p.px(2, 15, BRASS[5]);
  // the dial, stopped at a quarter to four
  paintDial(p, 8, 11, 3.8, 3, 45, { second: null });
  if (mode === 'hurt') {
    p.px(7, 9, PLUM[0]);
    p.px(9, 12, PLUM[0]);
    p.px(8, 10, '#ffffff');
  }
  // the bird's door
  if (!open) {
    p.rect(5, 16, 6, 4, PLUM[1]);
    p.rect(5, 16, 6, 1, BRASS[2]);
    p.rect(5, 16, 1, 4, BRASS[2]);
    p.px(9, 18, BRASS[4]);
  } else {
    p.rect(5, 16, 6, 4, PLUM[0]);
    p.rect(4, 20, 8, 1, BRASS[3]);
    // the cuckoo, verdigris green with an amber beak
    p.ellipse(8, 18.2, 2.3, 1.7, VERD[2]);
    p.px(8, 17, VERD[3]);
    p.px(10, 17, VERD[2]);
    p.px(10, 16, VERD[2]);
    p.px(11, 17, AMBER.mid);
    p.px(10, 16, k ? PLUM[0] : VERD[2]);
    if (k) {
      p.px(6, 16, VERD[3]);
      p.px(7, 15, VERD[3]);
    } else p.px(6, 17, VERD[1]);
    p.px(11, 16, PLUM[0]);
  }
  // pendulum window with the pendulum mid-swing
  p.rect(5, 21, 6, 4, PLUM[0]);
  const px = 8 + (k ? 1 : -1);
  p.line(8, 21, px, 23, BRASS[4]);
  p.rect(px - 1, 23, 2, 2, BRASS[5]);
  // weights on chains at the sides
  p.rect(3, 17, 1, 6, BRASS[2]);
  p.rect(12, 17, 1, 7, BRASS[2]);
  p.rect(3, 22, 2, 3, BRASS[4]);
  p.rect(11, 23, 2, 2, BRASS[4]);
  p.px(3, 22, BRASS[5]);
  p.px(12, 20, VERD[1]);
  p.px(3, 9, VERD[1]);
}
frames('ckcuckoo', 'idle', 2, 16, 26, (p, i) => paintCuckoo(p, i, 'idle'), { anchor: 'bottom', fps: 1.35, outline: COUT });
frames('ckcuckoo', 'open', 2, 16, 26, (p, i) => paintCuckoo(p, i, 'open'), { anchor: 'bottom', fps: 6, outline: COUT });
frames('ckcuckoo', 'hurt', 1, 16, 26, (p) => paintCuckoo(p, 0, 'hurt'), { anchor: 'bottom', outline: COUT });

defineEnemy({
  id: 'cuckoo_clock',
  name: '뻐꾸기 시계',
  hp: 32,
  radius: 6,
  speed: 0,
  mass: Infinity,
  contactDamage: 0,
  sprite: 'ckcuckoo_idle',
  spriteYOffset: 7,
  shadow: 14,
  cost: 1.5,
  floors: [7, 8],
  weight: 0.9,
  champion: true,
  deathFx: 'bone',
  bloodColor: '#48304c',
  hurtSfx: 'hit_metal',
  dieSfx: 'pot_break',
  light: { radius: 12, color: AMBER.mid },
  init(e, w) {
    e.mem.calls = 0;
    e.mem.beat = beatIndex(w.time);
    e.facing = 1;
  },
  *script(e, w) {
    while (true) {
      // wait for the next beat of the floor
      while (beatIndex(w.time) === e.mem.beat) yield;
      e.mem.beat = beatIndex(w.time);
      e.mem.calls++;
      if (e.mem.calls % 2 === 1) {
        // the door opens: the next beat is the shot
        e.setAnim('ckcuckoo_open', true);
        e.telegraph(0.72);
        w.sfx('clock_tick', { vol: 0.42, pitch: 1.2 });
        w.spawn(new RingFx(e.x, e.y - 10, 10, 0.3, AMBER.mid, 1));
        continue;
      }
      // cuckoo!
      e.squash(1.15, 0.9);
      w.sfx('clock_chime', { vol: 0.45, pitch: fx.range(0.95, 1.05) });
      if (e.mem.calls % 8 === 0) {
        e.shootRing(w, e.champion ? 12 : 10, cogShot(3, { speed: 78, offset: w.rng.angle(), z: 10, range: 300 }));
      } else {
        const tg = e.target(w);
        e.shootAt(w, { x: tg.x, y: tg.y - 4 }, cogShot(3, { count: e.champion ? 4 : 3, spread: 0.26, speed: 100, z: 10, range: 320 }));
      }
      yield 0.2;
      e.setAnim('ckcuckoo_idle');
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'ckcuckoo_hurt_0'));
  },
  onDeath(e, w) {
    w.particles.burst(e.x, e.y - 10, { count: 16, speed: [40, 120], life: [0.4, 0.8], colors: [PLUM[2], PLUM[1], BRASS[3], PORC[2]], size: [1, 3], gravity: 320, vz: [40, 130], shape: 'square', vrot: 8, bounce: 0.3 });
    springPop(w, e.x, e.y - 8, 3);
    sparks(w, e.x, e.y - 8, 6, 70);
    w.sfx('clock_chime', { vol: 0.4, pitch: 0.6 });
  },
});

// ================================================================== 톱니 굴렁쇠 (rolling gear)
function paintRollingGear(p: PixelPainter, k: number, mode: 'roll' | 'wobble' | 'hurt'): void {
  paintGear(p, 7.5, 7.5, 5, 10, BRASS, mode === 'wobble' ? k * 0.3 : 0, { spokes: 4, open: true, hub: 2.4, tooth: 2 });
  for (const [x, y] of [[3, 4], [11, 10], [12, 4]] as [number, number][]) p.pxIn(x, y, VERD[1]);
  p.pxIn(4, 11, VERD[2]);
  // the eye in the hub
  p.circle(7.5, 7.5, 1.9, PLUM[0]);
  if (mode === 'hurt') p.px(7, 7, '#ffffff');
  else {
    p.px(7, 7, AMBER.mid);
    p.px(7, 6, AMBER.hot);
  }
}
frames('ckgear', 'roll', 1, 15, 15, (p) => paintRollingGear(p, 0, 'roll'), { outline: COUT });
frames('ckgear', 'wobble', 2, 15, 15, (p, i) => paintRollingGear(p, i, 'wobble'), { fps: 7, outline: COUT });
frames('ckgear', 'hurt', 1, 15, 15, (p) => paintRollingGear(p, 0, 'hurt'), { outline: COUT });

defineEnemy({
  id: 'rolling_gear',
  name: '톱니 굴렁쇠',
  hp: 28,
  radius: 6,
  speed: 30,
  mass: 2,
  sprite: 'ckgear_wobble',
  spriteYOffset: -2,
  shadow: 12,
  cost: 1.2,
  floors: [7, 8],
  weight: 1,
  champion: true,
  deathFx: 'metal',
  bloodColor: '#c49a44',
  hurtSfx: 'hit_metal',
  light: { radius: 10, color: AMBER.mid },
  init(e, w) {
    e.rot = w.rng.angle();
    e.mem.spin = 0;
  },
  *script(e, w) {
    yield w.rng.range(0.3, 0.8);
    while (true) {
      // resting on its rim, wobbling
      e.setAnim('ckgear_wobble');
      e.halt();
      e.mem.spin = 0;
      yield w.rng.range(0.6, 1.0);
      // the path it will take, bounces included
      let a = e.angleToTarget(w) + w.rng.range(-0.18, 0.18);
      const path = bouncePath(w.room, e.x, e.y, a, e.r, 3, 300);
      for (const s of path) {
        const d = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
        if (d > 4) laneWarning(w, s.x0, s.y0, s.angle, d + 6, 12, 0.55);
      }
      e.telegraph(0.55);
      w.sfx('clock_ratchet', { vol: 0.4, pitch: 0.8 });
      yield 0.55;
      // roll!
      e.setAnim('ckgear_roll');
      const speed = e.champion ? 175 : 150;
      e.accel = 2600;
      e.mem.__bumpX = 0;
      e.mem.__bumpY = 0;
      e.mem.spin = Math.cos(a) >= 0 ? 1 : -1;
      let bounces = 0;
      w.sfx('clock_ratchet', { vol: 0.35, pitch: 1.3 });
      for (let el = 0; el < 2.6; el += w.dt) {
        if (e.mem.__bumpX || e.mem.__bumpY) {
          a = reflectAngle(w.room, e.x, e.y, a, e.r);
          e.mem.__bumpX = 0;
          e.mem.__bumpY = 0;
          e.mem.spin = Math.cos(a) >= 0 ? 1 : -1;
          bounces++;
          sparks(w, e.x, e.y, 6, 80);
          e.squash(1.25, 0.8);
          w.shake(0.12);
          w.sfx('hit_metal', { vol: 0.3, pitch: fx.range(0.9, 1.2) });
          if (bounces > 3) break;
        }
        e.moveAngle(a, speed);
        yield;
      }
      e.accel = 900;
      e.halt();
      w.sfx('clock_tick', { vol: 0.3, pitch: 0.7 });
      yield 0.2;
    }
  },
  update(e, w, dt) {
    if (e.mem.spin) {
      e.rot += e.mem.spin * 14 * dt;
      if (fx.chance(0.3)) w.particles.spawn({ x: e.x + fx.range(-5, 5), y: e.y + 5, vy: -fx.range(2, 6), life: 0.3, colors: ['#e8d8b0', BRASS[3]], size: 1, alpha: 0.7 });
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'ckgear_hurt_0'));
  },
  onDeath(e, w) {
    sparks(w, e.x, e.y, 10, 100);
    w.particles.burst(e.x, e.y - 4, { count: 10, speed: [40, 110], life: [0.3, 0.6], colors: [BRASS[4], BRASS[2], VERD[1]], size: [1, 3], gravity: 320, vz: [40, 120], shape: 'square', vrot: 10 });
  },
});

// ================================================================== 도자기 인형 (porcelain doll)
function paintDoll(p: PixelPainter, k: number, mode: 'idle' | 'step' | 'spin' | 'hurt'): void {
  const step = mode === 'step';
  const spin = mode === 'spin';
  const sway = mode === 'idle' && k ? 1 : 0;
  // bell skirt: cream porcelain with a teal scallop and a gold hem
  const flare = spin ? 2 : 0;
  p.poly([5, 13, 10, 13, 13 + flare, 22, 1 - flare, 22], PORC[2]);
  for (let y = 13; y < 22; y++) {
    for (let x = 0; x < 14; x++) {
      if (!p.isSet(x, y)) continue;
      if (x < 4 + (y - 13) * 0.15 && y < 20) p.px(x, y, PORC[3]);
      else if (x > 10 + (y - 13) * 0.2) p.px(x, y, PORC[1]);
    }
  }
  for (let x = 1 - flare; x <= 13 + flare; x += 3) {
    p.pxIn(x + 1, 19, VERD[1]);
    p.pxIn(x + 2, 20, VERD[2]);
  }
  for (let x = 0; x < 14; x++) if (p.isSet(x, 21)) p.px(x, 21, BRASS[4]);
  // bodice with brass buttons
  p.rect(5, 9 + sway, 5, 4, VERD[1]);
  p.rect(5, 9 + sway, 5, 1, VERD[2]);
  p.px(7, 10 + sway, BRASS[5]);
  p.px(7, 12, BRASS[5]);
  // the key in its back, seen from the side
  p.rect(2, 11, 3, 1, BRASS[3]);
  p.rect(0, 10, 2, 3, BRASS[2]);
  p.px(0, 10, BRASS[5]);
  // arms with brass ball joints
  if (spin) {
    p.line(4, 9, 1, 4, PORC[2]);
    p.line(10, 9, 13, 4, PORC[2]);
    p.px(1, 4, PORC[3]);
    p.px(13, 4, PORC[3]);
  } else if (step) {
    p.line(4, 10, 1, 12, PORC[2]);
    p.line(10, 10, 13, 8, PORC[2]);
    p.px(1, 12, PORC[3]);
    p.px(13, 8, PORC[3]);
  } else {
    p.line(4, 10 + sway, 3, 14, PORC[2]);
    p.line(10, 10 + sway, 11, 14, PORC[2]);
  }
  p.px(4, 9 + sway, BRASS[4]);
  p.px(10, 9 + sway, BRASS[4]);
  // porcelain head with a painted face and a plum hair cap
  const hy = 5 + sway;
  p.ellipse(7.5, hy, 3.4, 3.4, PORC[2]);
  sphere(p, 7.5, hy, 3.4, 3.4, [PORC[1], PORC[2], PORC[3], PORC[3], '#ffffff'], false);
  p.rect(4, hy - 3, 7, 2, PLUM[1]);
  p.rect(5, hy - 4, 5, 1, PLUM[1]);
  p.px(4, hy - 1, PLUM[1]);
  p.px(10, hy - 1, PLUM[1]);
  p.px(10, hy - 3, BRASS[5]);
  p.px(11, hy - 2, BRASS[4]);
  if (mode === 'hurt') {
    p.px(6, hy, '#ffffff');
    p.px(9, hy, '#ffffff');
    p.px(8, hy - 2, PLUM[0]);
  } else {
    p.px(6, hy, PLUM[0]);
    p.px(9, hy, PLUM[0]);
  }
  p.px(5, hy + 1, '#e09aa0');
  p.px(10, hy + 1, '#e09aa0');
  p.px(7, hy + 2, '#c05060');
  p.px(8, hy + 2, '#c05060');
  // feet under the hem (one lifted while stepping)
  p.px(6, 22, PLUM[1]);
  p.px(9, 22 - (step && k ? 1 : 0), PLUM[1]);
}
frames('ckdoll', 'idle', 2, 14, 23, (p, i) => paintDoll(p, i, 'idle'), { anchor: 'bottom', fps: 2.5, outline: COUT });
frames('ckdoll', 'step', 2, 14, 23, (p, i) => paintDoll(p, i, 'step'), { anchor: 'bottom', fps: 6, outline: COUT });
frames('ckdoll', 'spin', 2, 14, 23, (p, i) => paintDoll(p, i, 'spin'), { anchor: 'bottom', fps: 12, outline: COUT });
frames('ckdoll', 'hurt', 1, 14, 23, (p) => paintDoll(p, 0, 'hurt'), { anchor: 'bottom', outline: COUT });
defineDrawnSprite('ckdoll_hole', 7, 6, (p) => {
  // a hole in the porcelain with the gears inside
  p.ellipse(3.5, 3, 3.3, 2.8, PLUM[0]);
  paintGear(p, 2.5, 3, 1.4, 6, BRASS, 0, { spokes: 0 });
  paintGear(p, 5, 3.5, 1.1, 5, BRASS, 0.5, { spokes: 0 });
  p.px(1, 1, PORC[1]);
  p.px(6, 5, PORC[1]);
}, { outline: PORC[0] });

/** Crack level (0..2) of a doll at `hp` of `maxHp`. */
export function dollCrack(hp: number, maxHp: number): number {
  const k = hp / maxHp;
  return k <= 0.35 ? 2 : k <= 0.68 ? 1 : 0;
}

defineEnemy({
  id: 'porcelain_doll',
  name: '도자기 인형',
  hp: 44,
  radius: 6,
  speed: 38,
  mass: 1.5,
  sprite: 'ckdoll_idle',
  spriteYOffset: 6,
  shadow: 12,
  cost: 2.2,
  floors: [7],
  weight: 0.9,
  champion: true,
  deathFx: 'bone',
  bloodColor: '#e2d8cc',
  dieSfx: 'pot_break',
  light: { radius: 14, color: '#ffd0c0' },
  init(e, w) {
    e.mem.crack = 0;
    e.mem.side = w.rng.sign();
    e.mem.beat = beatIndex(w.time);
  },
  *script(e, w) {
    yield w.rng.range(0.3, 0.9);
    const nextBeat = function* (): Generator<number | void, void, void> {
      while (beatIndex(w.time) === e.mem.beat) yield;
      e.mem.beat = beatIndex(w.time);
    };
    while (true) {
      // a waltz measure: ONE (toward), two (aside), three (a curtsy)
      const wild = e.mem.crack >= 2;
      const sp = e.speed * (wild ? 1.6 : 1);
      yield* nextBeat();
      e.setAnim('ckdoll_step', true);
      for (let el = 0; el < 0.42; el += w.dt) {
        e.chase(w, sp * 1.7);
        yield;
      }
      e.stop();
      yield* nextBeat();
      e.setAnim('ckdoll_step', true);
      const a = e.angleToTarget(w) + (e.mem.side * Math.PI) / 2;
      for (let el = 0; el < 0.3; el += w.dt) {
        e.moveAngle(a, sp);
        if (e.mem.__bumped) e.mem.side = -e.mem.side;
        yield;
      }
      e.stop();
      yield* nextBeat();
      e.setAnim('ckdoll_idle');
      e.halt();
      e.facing = w.player.x >= e.x ? 1 : -1;
      const d = e.distToTarget(w);
      if (d < 100 && w.room.lineOfSight(e.x, e.y, w.player.x, w.player.y)) {
        // the spin: a ring of cogs flung from the skirt
        e.setAnim('ckdoll_spin', true);
        const tele = wild ? 0.45 : 0.6;
        e.telegraph(tele);
        w.spawn(new GroundWarning(e.x, e.y, 22, tele, undefined, WARN_RED));
        w.sfx('clock_spring', { vol: 0.45, pitch: 0.9 });
        for (let el = 0; el < tele; el += w.dt) {
          e.rot = 0;
          if (fx.chance(0.5)) w.particles.spawn({ x: e.x + fx.range(-6, 6), y: e.y - 8 + fx.range(-6, 6), life: 0.3, colors: [PORC[3], BRASS[5]], size: 1, additive: true, alpha: 0.8 });
          yield;
        }
        const n = (wild ? 12 : 10) + (e.champion ? 2 : 0);
        const off = w.rng.angle();
        e.shootRing(w, n, cogShot(3, { speed: 82, offset: off, z: 8, range: 280 }));
        e.squash(1.3, 0.8);
        w.spawn(new RingFx(e.x, e.y - 6, 24, 0.3, PORC[3], 2));
        w.sfx('clock_chime', { vol: 0.4, pitch: 1.3 });
        if (e.champion || wild) {
          yield 0.3;
          e.shootRing(w, n, cogShot(3, { speed: 70, offset: off + Math.PI / n, z: 8, range: 260 }));
        }
        yield 0.45;
      } else {
        yield 0.25;
      }
    }
  },
  onHurt(e, w) {
    const c = dollCrack(e.hp, e.maxHp);
    if (c > e.mem.crack) {
      e.mem.crack = c;
      shards(w, e.x, e.y - 10, c === 2 ? 10 : 6, 80);
      w.sfx('clock_crack', { vol: 0.5, pitch: c === 2 ? 0.85 : 1.1 });
      if (c === 2) {
        springPop(w, e.x, e.y - 8, 2);
        w.spawn(new RingFx(e.x, e.y - 8, 18, 0.25, PORC[3], 1));
      }
    }
  },
  update(e, w) {
    if (e.mem.crack >= 2 && fx.chance(0.15)) {
      w.particles.spawn({ x: e.x + e.facing * 2 + fx.range(-2, 2), y: e.y - 9, vy: -fx.range(8, 16), life: fx.range(0.3, 0.6), colors: ['#e8e0e4', '#a89aa8'], size: 1, sizeEnd: 3, shape: 'circle', alpha: 0.4 });
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'ckdoll_hurt_0'));
    const c = e.mem.crack;
    if (!c) return;
    const f = e.facing;
    const x = e.x;
    const y = e.y - e.z + 6;
    r.line(x - 2 * f, y - 20, x + 1 * f, y - 16, PLUM[0], 1, 0.9);
    r.line(x + 1 * f, y - 16, x - 1 * f, y - 12, PLUM[0], 1, 0.9);
    if (c >= 2) {
      r.line(x + 2 * f, y - 9, x + 5 * f, y - 4, PLUM[0], 1, 0.9);
      r.sprite('ckdoll_hole', x + 2 * f, y - 7, { flipX: f < 0 });
    }
  },
  onDeath(e, w) {
    shards(w, e.x, e.y - 10, 16, 110);
    springPop(w, e.x, e.y - 8, 3);
    w.particles.burst(e.x, e.y - 8, { count: 8, speed: [30, 90], life: [0.3, 0.6], colors: [BRASS[4], BRASS[2]], size: [1, 2], gravity: 320, vz: [30, 100], shape: 'square', vrot: 8 });
    w.sfx('clock_crack', { vol: 0.5, pitch: 0.7 });
  },
});
