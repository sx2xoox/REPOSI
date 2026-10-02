// Floor 7 — 멈춘 태엽탑 (stopped clockwork spire), part 2:
//  - 진자 파수꾼 (pendulum warden): a brass automaton guard; it lunges down a telegraphed
//    line from afar and, up close, swings its pendulum blade through an arc of warnings
//    (and back again)
//  - 시간 고정체 (time anchor): a floating hourglass; it drops a pocket of stopped time on
//    the keeper where its needles crawl, then snap to full speed when the pocket collapses
//  - 증기 골렘 (steam golem): a tough boiler automaton that vents lanes of scalding
//    steam from its shoulders (telegraphed), stomps up close, and overheats afterwards
//  - 되감기 유령 (rewind ghost, floors 7–8): a porcelain-masked phantom that records its
//    drift, then rewinds along it leaving echoes that launch at the keeper

import { defineEnemy } from '../../game/defs';
import { PixelPainter } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { GroundWarning, RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { angleDiff, clamp, TAU } from '../../engine/math';
import type { Enemy } from '../../game/enemy';
import type { Renderer } from '../../engine/renderer';
import { paintDial, steamPuff } from '../props/clock';
import { dust, frames, gather, hurtFrame, landingSpot, laneWarning, rayFree, sphere, WARN_RED } from './shared';
import {
  AMBER, BRASS, COUT, echoTick, PLUM, PORC, shards, sparks, springPop, SteamLane, tickShot, TIME, TimeField, VERD,
} from './clock-shared';

// ================================================================== 진자 파수꾼 (pendulum warden)
const BLADE_LEN = 26;

function paintWarden(p: PixelPainter, k: number, mode: 'walk' | 'raise' | 'swing' | 'hurt'): void {
  const walk = mode === 'walk';
  const step = walk ? [2, 0, -2, 0][k] : 0;
  const bob = walk ? [0, -1, 0, -1][k] : mode === 'swing' ? 1 : 0;
  // piston legs
  p.rect(6 + step, 20, 3, 7, BRASS[2]);
  p.rect(11 - step, 20, 3, 7, BRASS[2]);
  p.rect(6 + step, 20, 1, 7, BRASS[4]);
  p.rect(11 - step, 20, 1, 7, BRASS[3]);
  p.rect(5 + step, 26, 5, 1, BRASS[0]);
  p.rect(10 - step, 26, 5, 1, BRASS[0]);
  p.px(7 + step, 22, BRASS[5]);
  p.px(12 - step, 22, BRASS[5]);
  // plated torso with a dial in the chest
  const ty = 8 + bob;
  p.rect(4, ty, 12, 12, BRASS[3]);
  p.rect(4, ty, 1, 12, BRASS[4]);
  p.rect(5, ty, 1, 12, BRASS[4]);
  p.rect(15, ty, 1, 12, BRASS[1]);
  p.rect(4, ty + 11, 12, 1, BRASS[1]);
  p.rect(4, ty, 12, 1, BRASS[5]);
  for (const [x, y] of [[5, ty + 1], [14, ty + 1], [5, ty + 10], [14, ty + 10]] as [number, number][]) p.px(x, y, BRASS[5]);
  p.rect(4, ty + 6, 12, 1, BRASS[2]);
  paintDial(p, 10, ty + 7, 2.8, 6, 30, { second: null });
  p.px(6, ty + 9, VERD[1]);
  p.px(13, ty + 3, VERD[1]);
  p.px(14, ty + 4, VERD[2]);
  // pauldrons
  p.rect(2, ty, 3, 4, BRASS[4]);
  p.rect(2, ty, 3, 1, BRASS[5]);
  p.rect(15, ty, 3, 4, BRASS[2]);
  p.rect(15, ty, 3, 1, BRASS[4]);
  // helmet with a glowing visor slit and a crest
  const hy = 2 + bob;
  p.rect(6, hy, 8, 6, BRASS[3]);
  p.rect(7, hy - 1, 6, 1, BRASS[4]);
  p.rect(6, hy, 1, 6, BRASS[4]);
  p.rect(13, hy, 1, 6, BRASS[1]);
  p.rect(6, hy + 5, 8, 1, BRASS[1]);
  p.px(10, hy - 2, BRASS[5]);
  p.px(9, hy - 1, BRASS[5]);
  p.rect(7, hy + 3, 6, 1, PLUM[0]);
  if (mode === 'hurt') {
    p.px(8, hy + 3, '#ffffff');
    p.px(11, hy + 3, '#ffffff');
  } else {
    p.px(8, hy + 3, AMBER.mid);
    p.px(11, hy + 3, AMBER.mid);
    if (mode !== 'walk') p.px(9, hy + 3, AMBER.hot);
  }
  // the right arm hangs (the left holds the pendulum rod, drawn live)
  if (mode === 'raise' || mode === 'swing') {
    p.rect(16, ty + 2, 3, 5, BRASS[2]);
    p.rect(16, ty + 2, 1, 5, BRASS[4]);
  } else {
    p.rect(16, ty + 4, 3, 8, BRASS[2]);
    p.rect(16, ty + 4, 1, 8, BRASS[4]);
    p.rect(16, ty + 11, 3, 2, BRASS[1]);
  }
  p.rect(1, ty + 4, 3, 5, BRASS[2]);
  p.rect(1, ty + 4, 1, 5, BRASS[4]);
}
frames('ckwarden', 'walk', 4, 20, 27, (p, i) => paintWarden(p, i, 'walk'), { anchor: 'bottom', fps: 5, outline: COUT });
frames('ckwarden', 'raise', 1, 20, 27, (p) => paintWarden(p, 0, 'raise'), { anchor: 'bottom', outline: COUT });
frames('ckwarden', 'swing', 1, 20, 27, (p) => paintWarden(p, 0, 'swing'), { anchor: 'bottom', outline: COUT });
frames('ckwarden', 'hurt', 1, 20, 27, (p) => paintWarden(p, 0, 'hurt'), { anchor: 'bottom', outline: COUT });
defineDrawnSprite('ckwarden_bob', 13, 13, (p) => {
  // pendulum bob: a brass disc with a crescent blade along its lower rim
  p.ellipse(6.5, 7.5, 6.3, 5.3, PORC[2]);
  for (let y = 0; y < 6; y++) for (let x = 0; x < 13; x++) p.px(x, y, null);
  p.circle(6.5, 6.5, 4.6, BRASS[3]);
  sphere(p, 6.5, 6.5, 4.6, 4.6, BRASS, false);
  p.circle(6.5, 6.5, 1.6, BRASS[1]);
  p.px(6, 6, BRASS[5]);
  // the honed edge
  for (let x = 2; x <= 10; x++) {
    let y = 12;
    while (y > 6 && !p.isSet(x, y)) y--;
    if (p.isSet(x, y)) p.px(x, y, '#ffffff');
  }
}, { outline: COUT });

/** Spots of a pendulum arc on the floor: `n` points from `a0` to `a1` around (x, y) at `len`. */
export function arcSpots(x: number, y: number, a0: number, a1: number, n: number, len: number, squash = 0.8): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / Math.max(1, n - 1);
    out.push({ x: x + Math.cos(a) * len, y: y + Math.sin(a) * len * squash });
  }
  return out;
}

/** Is the keeper at (px, py) under the blade of a warden at (x, y) whose blade points along `blade`? */
export function bladeHits(x: number, y: number, blade: number, px: number, py: number, len = BLADE_LEN, squash = 0.8): boolean {
  const dx = px - x;
  const dy = (py - y) / squash;
  const d = Math.hypot(dx, dy);
  if (d > len + 9 || d < 8) return false;
  return Math.abs(angleDiff(Math.atan2(dy, dx), blade)) < 0.42;
}

function drawPendulum(e: Enemy, r: Renderer): void {
  const f = e.facing;
  const px = e.x - f * 7;
  const py = e.y - e.z - 14;
  const a = e.mem.blade ?? Math.PI / 2;
  const bx = px + Math.cos(a) * BLADE_LEN;
  const by = py + Math.sin(a) * BLADE_LEN * 0.8;
  r.line(px, py, bx, by, BRASS[1], 2, 1);
  r.line(px, py, bx, by, BRASS[4], 1, 1);
  r.sprite('ckwarden_bob', bx, by, { rot: a + Math.PI / 2 });
}

defineEnemy({
  id: 'pendulum_warden',
  name: '진자 파수꾼',
  hp: 72,
  radius: 8,
  speed: 22,
  mass: 4,
  sprite: 'ckwarden_walk',
  spriteYOffset: 7,
  shadow: 18,
  cost: 3,
  floors: [7],
  weight: 0.7,
  champion: true,
  deathFx: 'metal',
  bloodColor: '#9a7430',
  hurtSfx: 'hit_metal',
  dieSfx: 'enemy_die_big',
  light: { radius: 14, color: AMBER.mid },
  init(e) {
    e.mem.blade = Math.PI / 2;
    e.mem.attack = 0;
  },
  *script(e, w) {
    yield w.rng.range(0.4, 1.0);
    const swing = function* (aim: number, side: number, tele: number): Generator<number | void, void, void> {
      // raise the blade to one side, warn along the arc, sweep it through
      const a0 = aim - side * 1.35;
      const a1 = aim + side * 1.35;
      e.setAnim('ckwarden_raise');
      e.mem.attack = 1;
      e.mem.blade = a0;
      for (const s of arcSpots(e.x, e.y, a0, a1, 6, BLADE_LEN)) w.spawn(new GroundWarning(s.x, s.y, 9, tele, undefined, WARN_RED));
      e.telegraph(tele);
      w.sfx('clock_ratchet', { vol: 0.35, pitch: 0.7 });
      yield tele;
      e.setAnim('ckwarden_swing', true);
      w.sfx('clock_pendulum', { vol: 0.55 });
      let hit = false;
      const T = 0.3;
      for (let el = 0; el < T; el += w.dt) {
        const t = clamp(el / T, 0, 1);
        const k = t * t * (3 - 2 * t);
        e.mem.blade = a0 + (a1 - a0) * k;
        const p = w.player;
        if (!hit && p.alive && p.z < 10 && bladeHits(e.x, e.y, e.mem.blade, p.x, p.y)) {
          hit = true;
          if (p.hurt(w, 2, e.def.name)) p.knock(Math.cos(e.mem.blade + side * 0.6), Math.sin(e.mem.blade + side * 0.6), 240);
        }
        if (fx.chance(0.6)) sparks(w, e.x + Math.cos(e.mem.blade) * BLADE_LEN, e.y + Math.sin(e.mem.blade) * BLADE_LEN * 0.8, 2, 50);
        yield;
      }
      w.shake(0.15);
    };
    while (true) {
      e.setAnim('ckwarden_walk');
      e.mem.attack = 0;
      yield* e.chaseFor(w, w.rng.range(1.3, 2.0), e.speed);
      const d = e.distToTarget(w);
      const p = w.player;
      if (d < 64) {
        e.halt();
        e.facing = p.x >= e.x ? 1 : -1;
        let side = w.rng.sign();
        const aim = e.angleToTarget(w);
        yield* swing(aim, side, 0.6);
        yield 0.2;
        // ... and back (a champion goes a third time)
        const passes = e.champion ? 2 : 1;
        for (let i = 0; i < passes; i++) {
          side = -side;
          yield* swing(e.angleToTarget(w), side, 0.38);
          yield 0.2;
        }
        e.mem.attack = 0;
        yield 0.6;
      } else if (d < 190 && w.room.lineOfSight(e.x, e.y, p.x, p.y) && w.rng.chance(0.75)) {
        // lunge down a line
        e.halt();
        e.setAnim('ckwarden_raise');
        const a = e.angleToTarget(w);
        e.facing = Math.cos(a) >= 0 ? 1 : -1;
        const len = Math.min(120, rayFree(w.room, e.x, e.y, a, e.r, 120) + 10);
        laneWarning(w, e.x, e.y, a, len, 16, 0.45);
        e.telegraph(0.45);
        w.sfx('clock_spring', { vol: 0.4, pitch: 0.8 });
        yield 0.45;
        e.setAnim('ckwarden_walk');
        e.contactDamage = 2;
        w.sfx('whoosh', { vol: 0.4, pitch: 0.8 });
        yield* e.charge(w, a, 170, Math.min(0.5, len / 170));
        e.contactDamage = 1;
        dust(w, e.x, e.y + 4, [BRASS[3], '#a89878'], 6, 50);
        yield 0.4;
      }
    }
  },
  update(e, w, dt) {
    if (!e.mem.attack) {
      // the blade hangs and sways with its stride
      const want = Math.PI / 2 + Math.sin(e.age * 2.4) * 0.28 * (e.facing >= 0 ? 1 : -1);
      e.mem.blade += (want - e.mem.blade) * Math.min(1, dt * 6);
    }
    if (e.anim === 'ckwarden_walk' && Math.hypot(e.vx, e.vy) > 4 && fx.chance(dt * 2.4)) {
      w.sfx('clock_tick', { vol: 0.18, pitch: 0.55, x: e.x });
      dust(w, e.x, e.y + 3, ['#a89878', BRASS[2]], 3, 30);
    }
  },
  draw(e, r, w) {
    const behind = Math.sin(e.mem.blade ?? Math.PI / 2) < 0;
    if (behind) drawPendulum(e, r);
    e.drawDefault(r, hurtFrame(e, w, 'ckwarden_hurt_0'));
    if (!behind) drawPendulum(e, r);
  },
  onDeath(e, w) {
    sparks(w, e.x, e.y - 8, 12, 110);
    springPop(w, e.x, e.y - 10, 4);
    w.particles.burst(e.x, e.y - 10, { count: 20, speed: [40, 130], life: [0.4, 0.9], colors: [BRASS[4], BRASS[2], BRASS[1], VERD[1]], size: [2, 3], gravity: 320, vz: [40, 140], bounce: 0.3, shape: 'square', vrot: 8 });
    w.sfx('clock_pendulum', { vol: 0.5, pitch: 0.6 });
  },
});

// ================================================================== 시간 고정체 (time anchor)
function paintHourglass(p: PixelPainter, k: number, mode: 'float' | 'cast' | 'hurt'): void {
  const cast = mode === 'cast';
  // brass plates and pillars
  p.rect(2, 0, 9, 2, BRASS[3]);
  p.rect(2, 0, 9, 1, BRASS[5]);
  p.rect(2, 18, 9, 2, BRASS[3]);
  p.rect(2, 18, 9, 1, BRASS[4]);
  p.rect(2, 19, 9, 1, BRASS[1]);
  p.rect(1, 2, 1, 16, BRASS[2]);
  p.rect(11, 2, 1, 16, BRASS[1]);
  p.px(1, 2, BRASS[4]);
  p.px(11, 17, BRASS[0]);
  // glass bulbs
  const glass = cast ? '#e0fff8' : '#cfe8e2';
  const edge = cast ? TIME.mid : '#8ab8b0';
  p.poly([3, 2, 10, 2, 7, 10, 6, 10], glass);
  p.poly([6, 10, 7, 10, 10, 18, 3, 18], glass);
  p.line(3, 2, 6, 10, edge);
  p.line(10, 2, 7, 10, edge);
  p.line(6, 10, 3, 18, edge);
  p.line(7, 10, 10, 18, edge);
  // sand: the upper bulb drains into the lower one over the frames (and runs back while casting)
  const lvl = cast ? [2, 3][k] : [3, 2, 1][k];
  for (let y = 10 - lvl; y < 10; y++) {
    const hw = 0.6 + (10 - y) * 0.42;
    for (let x = Math.ceil(6.5 - hw); x <= Math.floor(6.5 + hw); x++) if (p.isSet(x, y)) p.px(x, y, TIME.mid);
  }
  const heap = 4 - lvl;
  for (let y = 18 - heap; y < 18; y++) {
    const hw = 0.6 + (y - (18 - heap)) * 0.9 + 0.5;
    for (let x = Math.ceil(6.5 - hw); x <= Math.floor(6.5 + hw); x++) if (p.isSet(x, y)) p.px(x, y, TIME.mid);
  }
  p.px(6, 10, TIME.hot);
  p.px(6, 11 + (k % 2), TIME.hot);
  p.px(6, 13 + (k % 2), TIME.mid);
  if (cast) {
    p.px(6, 9, TIME.hot);
    p.px(6, 7, TIME.hot);
  }
  // highlight on the glass
  p.px(4, 4, '#ffffff');
  p.px(4, 14, '#ffffff');
  if (mode === 'hurt') {
    p.line(8, 3, 9, 6, PLUM[1]);
    p.px(8, 15, PLUM[1]);
  }
}
frames('ckhour', 'float', 3, 13, 20, (p, i) => paintHourglass(p, i, 'float'), { fps: 2.2, outline: COUT });
frames('ckhour', 'cast', 2, 13, 20, (p, i) => paintHourglass(p, i, 'cast'), { fps: 8, outline: COUT });
frames('ckhour', 'hurt', 1, 13, 20, (p) => paintHourglass(p, 0, 'hurt'), { outline: COUT });
defineDrawnSprite('ckhour_halo', 21, 9, (p) => {
  // the floating ring of brass ticks that holds the hourglass up
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const x = 10.5 + Math.cos(a) * 9.5;
    const y = 4.5 + Math.sin(a) * 3.6;
    p.px(x, y, i % 3 === 0 ? BRASS[5] : BRASS[3]);
    if (i % 3 === 0) p.px(x, y + 1, BRASS[2]);
  }
});

defineEnemy({
  id: 'time_anchor',
  name: '시간 고정체',
  hp: 34,
  radius: 6,
  speed: 32,
  flying: true,
  sprite: 'ckhour_float',
  shadow: 12,
  spriteYOffset: -9,
  cost: 2,
  floors: [7],
  weight: 0.8,
  champion: true,
  deathFx: 'metal',
  bloodColor: '#6af0d4',
  hurtSfx: 'hit_metal',
  light: { radius: 24, color: TIME.mid },
  init(e, w) {
    e.mem.side = w.rng.sign();
  },
  *script(e, w) {
    yield w.rng.range(0.4, 1.0);
    while (true) {
      e.setAnim('ckhour_float');
      const t = w.rng.range(2.0, 2.8);
      for (let el = 0; el < t; el += w.dt) {
        const tg = e.target(w);
        const d = Math.hypot(tg.x - e.x, tg.y - e.y);
        if (d > 135) e.chase(w, e.speed);
        else if (d < 85) e.flee(w, e.speed * 0.9);
        else {
          const a = Math.atan2(e.y - tg.y, e.x - tg.x) + e.mem.side * 0.5;
          e.moveDir(tg.x + Math.cos(a) * 110 - e.x, tg.y + Math.sin(a) * 85 - e.y, e.speed * 0.7);
        }
        if (e.mem.__bumped) e.mem.side = -e.mem.side;
        yield;
      }
      // the sand runs backwards: a pocket of stopped time falls on the keeper
      e.halt();
      e.setAnim('ckhour_cast');
      e.telegraph(0.5);
      gather(w, e.x, e.y - 9, [TIME.hot, TIME.mid, TIME.low], 10, 16);
      w.sfx('clock_rewind', { vol: 0.4, pitch: 1.2 });
      yield 0.5;
      const p = w.player;
      const spot = landingSpot(w, p.x + p.vx * 0.25, p.y + p.vy * 0.25, 4);
      const R = e.champion ? 54 : 46;
      const field = new TimeField(spot.x, spot.y, R, 2.3, 0.32);
      // the pocket is marked on the floor while it arms (teal: it is time, not fire)
      w.spawn(new GroundWarning(spot.x, spot.y, R, field.arm, undefined, TIME.mid));
      w.spawn(field);
      w.spawn(new RingFx(e.x, e.y - 9, 14, 0.25, TIME.hot, 1));
      // needles that crawl through the pocket, then race out of it
      const volleys = e.champion ? 4 : 3;
      for (let i = 0; i < volleys; i++) {
        e.squash(1.2, 0.85);
        e.shootAt(w, null, tickShot(3, { count: 3, spread: 0.3, speed: 118, z: 9, range: 320 }));
        yield 0.32;
      }
      e.setAnim('ckhour_float');
      yield 1.1;
    }
  },
  update(e, w) {
    if (fx.chance(0.1)) {
      w.particles.spawn({ x: e.x + fx.range(-5, 5), y: e.y - 9 + fx.range(-6, 6), vy: fx.range(-4, 4), life: fx.range(0.5, 0.9), colors: [TIME.hot, TIME.mid], size: 1, additive: true, alpha: 0.8 });
    }
  },
  draw(e, r, w) {
    const bob = Math.sin(e.age * 2.2) * 1.5;
    r.sprite('ckhour_halo', e.x, e.y - e.z + 2 + bob * 0.5, { rot: 0, alpha: 0.9 });
    e.drawDefault(r, hurtFrame(e, w, 'ckhour_hurt_0'), -9 + bob);
  },
  onDeath(e, w) {
    // the glass breaks and the sand spills, hanging in the air a moment
    w.particles.burst(e.x, e.y - 8, { count: 18, speed: [10, 50], life: [0.8, 1.4], colors: [TIME.hot, TIME.mid, TIME.low], size: [1, 2], additive: true, drag: 3 });
    w.particles.burst(e.x, e.y - 8, { count: 8, speed: [40, 100], life: [0.3, 0.6], colors: ['#e0fff8', BRASS[4], BRASS[2]], size: [1, 2], gravity: 300, vz: [30, 100], shape: 'square' });
    w.spawn(new RingFx(e.x, e.y - 8, 30, 0.4, TIME.mid, 2));
    w.sfx('clock_snap', { vol: 0.45, pitch: 0.8 });
  },
});

// ================================================================== 증기 골렘 (steam golem)
function paintSteamGolem(p: PixelPainter, k: number, mode: 'walk' | 'vent' | 'stomp' | 'hurt'): void {
  const walk = mode === 'walk';
  const step = walk ? [2, 0, -2, 0][k] : 0;
  const bob = walk ? [0, -1, 0, -1][k] : mode === 'stomp' ? 2 : 0;
  const vent = mode === 'vent';
  // stubby piston legs
  p.rect(7 + step, 23, 5, 7, BRASS[2]);
  p.rect(14 - step, 23, 5, 7, BRASS[2]);
  p.rect(7 + step, 23, 1, 7, BRASS[4]);
  p.rect(14 - step, 23, 1, 7, BRASS[4]);
  p.rect(6 + step, 28, 7, 2, BRASS[1]);
  p.rect(13 - step, 28, 7, 2, BRASS[1]);
  p.px(9 + step, 25, BRASS[5]);
  p.px(16 - step, 25, BRASS[5]);
  // boiler body
  const by = 15 + bob;
  p.ellipse(13, by, 8.5, 9, BRASS[3]);
  p.rect(5, by - 6, 17, 13, BRASS[3]);
  sphere(p, 13, by - 0.5, 8.6, 9.5, BRASS, true);
  for (let x = 6; x < 21; x += 3) {
    p.pxIn(x, by - 5, BRASS[5]);
    p.pxIn(x + 1, by - 4, BRASS[0]);
    p.pxIn(x, by + 6, BRASS[5]);
  }
  // furnace door: a dark round hatch with the fire inside
  p.circle(13, by + 2, 3.4, BRASS[1]);
  p.circle(13, by + 2, 2.6, PLUM[0]);
  const hot = vent || mode === 'stomp';
  p.px(12, by + 2, hot ? AMBER.hot : AMBER.mid);
  p.px(13, by + 2, AMBER.mid);
  p.px(13, by + 3, hot ? AMBER.mid : AMBER.low);
  p.px(12, by + 1, hot ? AMBER.mid : AMBER.low);
  if (hot) p.px(14, by + 1, AMBER.hot);
  // pressure gauge
  paintDial(p, 8, by - 2, 2.4, 9, 20, { second: null });
  if (hot) p.px(8, by - 3, '#c02a30');
  // eyes: two amber slits above the hatch
  if (mode === 'hurt') {
    p.px(11, by - 3, '#ffffff');
    p.px(15, by - 3, '#ffffff');
  } else {
    p.rect(10, by - 3, 2, 1, AMBER.mid);
    p.rect(15, by - 3, 2, 1, AMBER.mid);
  }
  // smokestack with its cap
  p.rect(16, bob + 1, 4, 8, BRASS[2]);
  p.rect(16, bob + 1, 1, 8, BRASS[4]);
  p.rect(19, bob + 1, 1, 8, BRASS[0]);
  p.rect(15, bob, 6, 1, BRASS[3]);
  p.px(15, bob, BRASS[5]);
  // shoulder vents (nozzles point outward; open and steaming while venting)
  const sy = by - 6;
  p.rect(1, sy, 5, 5, BRASS[4]);
  p.rect(1, sy, 5, 1, BRASS[5]);
  p.rect(20, sy, 5, 5, BRASS[2]);
  p.rect(20, sy, 5, 1, BRASS[4]);
  p.rect(0, sy + 1, 2, 3, BRASS[1]);
  p.rect(24, sy + 1, 2, 3, BRASS[1]);
  if (vent) {
    p.px(0, sy + 2, PORC[3]);
    p.px(25, sy + 2, PORC[3]);
    p.px(0, sy, PORC[2]);
    p.px(25, sy, PORC[2]);
  }
  // heavy arms (raised for the stomp)
  const ay = mode === 'stomp' ? by - 10 : by - 1;
  p.rect(1, ay, 4, 9, BRASS[2]);
  p.rect(21, ay, 4, 9, BRASS[2]);
  p.rect(1, ay, 1, 9, BRASS[4]);
  p.rect(21, ay, 1, 9, BRASS[4]);
  p.rect(0, ay + 8, 5, 3, BRASS[1]);
  p.rect(21, ay + 8, 5, 3, BRASS[1]);
  p.px(1, ay + 8, BRASS[4]);
  p.px(22, ay + 8, BRASS[4]);
  // verdigris and soot
  for (const [x, y] of [[6, by + 4], [9, by + 7], [19, by + 5], [17, by - 2]] as [number, number][]) p.pxIn(x, y, VERD[1]);
  p.pxIn(7, by + 5, VERD[2]);
  p.pxIn(18, bob + 2, PLUM[1]);
}
frames('cksteam', 'walk', 4, 26, 30, (p, i) => paintSteamGolem(p, i, 'walk'), { anchor: 'bottom', fps: 4.5, outline: COUT });
frames('cksteam', 'vent', 2, 26, 30, (p, i) => paintSteamGolem(p, i, 'vent'), { anchor: 'bottom', fps: 8, outline: COUT });
frames('cksteam', 'stomp', 1, 26, 30, (p) => paintSteamGolem(p, 0, 'stomp'), { anchor: 'bottom', outline: COUT });
frames('cksteam', 'hurt', 1, 26, 30, (p) => paintSteamGolem(p, 0, 'hurt'), { anchor: 'bottom', outline: COUT });

/** Vent lane angles for a golem aiming at `a0`: the aimed lane and `flank` lanes to each side. */
export function ventAngles(a0: number, flank: number, spread = 0.5): number[] {
  const out = [a0];
  for (let i = 1; i <= flank; i++) out.push(a0 - spread * i, a0 + spread * i);
  return out;
}

defineEnemy({
  id: 'steam_golem',
  name: '증기 골렘',
  hp: 110,
  radius: 10,
  speed: 18,
  mass: 5,
  sprite: 'cksteam_walk',
  spriteYOffset: 8,
  shadow: 24,
  cost: 3.5,
  floors: [7],
  weight: 0.55,
  champion: true,
  deathFx: 'metal',
  bloodColor: '#9a7430',
  hurtSfx: 'hit_metal',
  dieSfx: 'enemy_die_big',
  light: { radius: 22, color: AMBER.mid },
  init(e) {
    e.mem.hasteT = -9;
  },
  *script(e, w) {
    yield w.rng.range(0.4, 1.0);
    while (true) {
      e.setAnim('cksteam_walk');
      const sp = () => (w.time < e.mem.hasteT ? e.speed * 1.9 : e.speed);
      const t = w.rng.range(1.5, 2.3);
      for (let el = 0; el < t; el += w.dt) {
        e.chase(w, sp());
        yield;
      }
      const p = w.player;
      const d = e.distToTarget(w);
      if (d < 50) {
        // stomp
        e.halt();
        e.setAnim('cksteam_stomp');
        const R = 34;
        w.spawn(new GroundWarning(e.x, e.y, R, 0.65, undefined, WARN_RED));
        e.telegraph(0.65);
        w.sfx('enemy_charge', { vol: 0.45, pitch: 0.6 });
        yield 0.65;
        w.shake(0.4);
        w.sfx('slam', { vol: 0.7, pitch: 0.9 });
        dust(w, e.x, e.y + 4, ['#a89878', BRASS[2], BRASS[1]], 14, 80);
        sparks(w, e.x, e.y + 2, 8, 90);
        w.spawn(new RingFx(e.x, e.y + 2, R + 4, 0.3, BRASS[5], 2));
        if (p.alive && p.z < 8 && Math.hypot(p.x - e.x, p.y - e.y) < R + p.r * 0.5) {
          if (p.hurt(w, 2, e.def.name)) {
            const dd = Math.hypot(p.x - e.x, p.y - e.y) || 1;
            p.knock((p.x - e.x) / dd, (p.y - e.y) / dd, 240);
          }
        }
        yield 0.9;
      } else if (d < 210 && w.room.lineOfSight(e.x, e.y, p.x, p.y)) {
        // vent: lanes of scalding steam from the shoulder pipes
        e.halt();
        e.setAnim('cksteam_vent');
        e.facing = p.x >= e.x ? 1 : -1;
        const a0 = e.angleToTarget(w);
        const lanes = ventAngles(a0, e.champion ? 2 : 1, e.champion ? 0.42 : 0.5);
        const lens = lanes.map((a) => Math.min(150, rayFree(w.room, e.x, e.y, a, 5, 150) + 6));
        lanes.forEach((a, i) => laneWarning(w, e.x, e.y, a, lens[i], 14, 0.8));
        e.telegraph(0.8);
        w.sfx('clock_steam', { vol: 0.5, pitch: 0.75 });
        for (let el = 0; el < 0.8; el += w.dt) {
          if (fx.chance(0.6)) steamPuff(w, e.x + e.facing * 2, e.y - 28, 1, 30, 2);
          yield;
        }
        lanes.forEach((a, i) => w.spawn(new SteamLane(e.x, e.y, a, lens[i], 14, e.def.name)));
        for (const a of lanes) steamPuff(w, e.x + Math.cos(a) * 12, e.y + Math.sin(a) * 10 - 10, 4, 24, 3);
        w.shake(0.2);
        w.sfx('clock_steam', { vol: 0.8, pitch: 1.1 });
        yield 0.7;
        // overheated: it stomps along much faster for a while
        e.mem.hasteT = w.time + 2.4;
        w.sfx('clock_tick', { vol: 0.3, pitch: 1.6 });
        yield 0.2;
      }
    }
  },
  update(e, w, dt) {
    const hasted = w.time < e.mem.hasteT;
    if (fx.chance(dt * (hasted ? 14 : 4))) steamPuff(w, e.x + e.facing * 4, e.y - 29, 1, hasted ? 30 : 16, 2);
    if (e.anim === 'cksteam_walk' && Math.hypot(e.vx, e.vy) > 4 && fx.chance(dt * (hasted ? 4 : 2))) {
      w.sfx('slam', { vol: 0.12, pitch: 1.4, x: e.x });
      dust(w, e.x, e.y + 4, ['#a89878', BRASS[1]], 4, 40);
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'cksteam_hurt_0'));
    if (w.time < e.mem.hasteT) {
      const k = 0.5 + 0.5 * Math.sin(w.time * 18);
      r.circle(e.x + e.facing * 0, e.y - e.z - 6, 3, AMBER.mid, 0.25 * k);
    }
  },
  onDeath(e, w) {
    // the boiler bursts
    steamPuff(w, e.x, e.y - 14, 14, 40, 4);
    sparks(w, e.x, e.y - 10, 16, 130);
    springPop(w, e.x, e.y - 12, 5);
    w.particles.burst(e.x, e.y - 12, { count: 26, speed: [50, 150], life: [0.4, 0.9], colors: [BRASS[4], BRASS[3], BRASS[1], VERD[1], PLUM[1]], size: [2, 3], gravity: 320, vz: [50, 160], bounce: 0.3, shape: 'square', vrot: 9 });
    w.spawn(new RingFx(e.x, e.y - 8, 40, 0.45, '#fff0d0', 3));
    w.shake(0.4);
    w.sfx('clock_steam', { vol: 0.8, pitch: 0.7 });
  },
});

// ================================================================== 되감기 유령 (rewind ghost)
function paintGhost(p: PixelPainter, k: number, mode: 'drift' | 'rewind' | 'hurt'): void {
  const bob = mode === 'drift' ? [0, -1, 0][k] : 0;
  const rewind = mode === 'rewind';
  // the mist shroud trailing below the mask (or streaming upward while rewinding)
  const mist = [TIME.low, PLUM[2], PLUM[1], PLUM[0]];
  if (rewind) {
    p.poly([4, 10 + bob, 11, 10 + bob, 13, 4, 10, 0, 7, 3, 2, 1], PLUM[2]);
    p.shadeVertical(2, 0, 12, 11, [PLUM[0], PLUM[1], PLUM[2], TIME.low], false);
  } else {
    p.poly([4, 9 + bob, 11, 9 + bob, 13, 16, 10, 21, 7, 18, 4, 21, 2, 15], PLUM[2]);
    p.shadeVertical(2, 9 + bob, 12, 13, mist, false);
  }
  for (let i = 0; i < 4; i++) {
    const x = 3 + ((i * 3 + k) % 9);
    const y = rewind ? 2 + ((i * 5 + k * 2) % 6) : 13 + ((i * 5 + k * 2) % 7) + bob;
    p.px(x, y, i % 2 ? TIME.mid : TIME.low);
  }
  // porcelain mask
  const my = 6 + bob + (rewind ? 5 : 0);
  p.ellipse(7.5, my, 4.2, 5, PORC[2]);
  sphere(p, 7.5, my, 4.2, 5, [PORC[1], PORC[2], PORC[3], PORC[3], '#ffffff'], false);
  // a crack across the brow and a chip at the cheek
  p.line(5, my - 4, 7, my - 2, PORC[0]);
  p.px(8, my - 1, PORC[0]);
  p.px(11, my + 2, PORC[0]);
  p.px(10, my + 3, PLUM[2]);
  // hollow eyes with a cold light inside
  p.rect(5, my - 1, 2, 2, PLUM[0]);
  p.rect(9, my - 1, 2, 2, PLUM[0]);
  if (mode === 'hurt') {
    p.px(5, my - 1, '#ffffff');
    p.px(10, my - 1, '#ffffff');
  } else {
    p.px(6, my, rewind ? TIME.hot : TIME.mid);
    p.px(9, my, rewind ? TIME.hot : TIME.mid);
  }
  // a thin painted mouth
  p.rect(6, my + 3, 4, 1, PLUM[1]);
  // hourglass pendant under the chin
  p.rect(7, my + 5, 2, 1, BRASS[4]);
  p.px(7, my + 6, TIME.mid);
  p.px(8, my + 6, BRASS[2]);
  p.rect(7, my + 7, 2, 1, BRASS[3]);
}
frames('ckghost', 'drift', 3, 15, 22, (p, i) => paintGhost(p, i, 'drift'), { fps: 5, outline: COUT });
frames('ckghost', 'rewind', 2, 15, 22, (p, i) => paintGhost(p, i, 'rewind'), { fps: 10, outline: COUT });
frames('ckghost', 'hurt', 1, 15, 22, (p) => paintGhost(p, 0, 'hurt'), { outline: COUT });

/** Recorded drift points that become echoes: every `every`-th point, from the newest back. */
export function echoSpots(xs: number[], ys: number[], every: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = xs.length - 1; i >= 0; i -= every) out.push({ x: xs[i], y: ys[i] });
  return out;
}

defineEnemy({
  id: 'rewind_ghost',
  name: '되감기 유령',
  hp: 36,
  radius: 6,
  speed: 40,
  flying: true,
  phasing: true,
  sprite: 'ckghost_drift',
  shadow: 10,
  spriteYOffset: -8,
  cost: 2,
  floors: [7, 8],
  weight: 0.7,
  champion: true,
  deathFx: 'bone',
  bloodColor: '#e2d8cc',
  dieSfx: 'pot_break',
  light: { radius: 22, color: TIME.mid },
  init(e, w) {
    e.alpha = 0.88;
    e.mem.side = w.rng.sign();
    e.mem.px = [] as number[];
    e.mem.py = [] as number[];
    e.mem.recT = 0;
  },
  *script(e, w) {
    yield w.rng.range(0.3, 0.9);
    while (true) {
      // drift around the keeper, recording the way
      e.setAnim('ckghost_drift');
      const xs: number[] = (e.mem.px = []);
      const ys: number[] = (e.mem.py = []);
      e.mem.recT = 0;
      const t = w.rng.range(2.2, 2.8);
      for (let el = 0; el < t; el += w.dt) {
        const tg = e.target(w);
        const d = Math.hypot(tg.x - e.x, tg.y - e.y);
        if (d > 110) e.chase(w, e.speed);
        else if (d < 50) e.flee(w, e.speed * 0.8);
        else {
          const a = Math.atan2(e.y - tg.y, e.x - tg.x) + e.mem.side * 0.8;
          e.moveDir(tg.x + Math.cos(a) * 80 - e.x, tg.y + Math.sin(a) * 64 - e.y, e.speed);
        }
        if (e.mem.__bumped) e.mem.side = -e.mem.side;
        e.mem.recT += w.dt;
        if (e.mem.recT >= 0.12 && xs.length < 24) {
          e.mem.recT = 0;
          xs.push(e.x);
          ys.push(e.y);
        }
        yield;
      }
      if (xs.length < 4) continue;
      // rewind: it flickers, and the way back lights up where echoes will be left
      e.halt();
      e.setAnim('ckghost_rewind');
      e.telegraph(0.4);
      const spots = echoSpots(xs, ys, 3);
      const stepT = 0.05;
      spots.forEach((s, i) => w.spawn(new GroundWarning(s.x, s.y, 7, 0.4 + i * 3 * stepT, undefined, WARN_RED)));
      w.sfx('clock_rewind', { vol: 0.5, pitch: 0.9 });
      yield 0.4;
      let dropped = 0;
      for (let i = xs.length - 1; i >= 0; i--) {
        const sx = e.x;
        const sy = e.y;
        for (let el = 0; el < stepT; el += w.dt) {
          const k = Math.min(1, (el + w.dt) / stepT);
          e.x = sx + (xs[i] - sx) * k;
          e.y = sy + (ys[i] - sy) * k;
          yield;
        }
        if ((xs.length - 1 - i) % 3 === 0) {
          // an echo: a needle that hangs where the ghost was, then launches
          const a = e.angleToTarget(w);
          e.shoot(w, a, tickShot(3, { x: e.x, y: e.y - 8, speed: 0, z: 8, life: 6, range: 420, behaviors: [echoTick(0.75 + dropped * 0.1, 125)] }));
          w.particles.burst(e.x, e.y - 8, { count: 4, speed: [10, 30], life: [0.2, 0.4], colors: [TIME.hot, TIME.mid], size: [1, 1], additive: true });
          dropped++;
        }
      }
      e.halt();
      w.sfx('clock_tick', { vol: 0.3, pitch: 1.4 });
      yield 0.5;
    }
  },
  update(e, w) {
    if (fx.chance(0.12)) {
      const up = e.anim === 'ckghost_rewind';
      w.particles.spawn({ x: e.x + fx.range(-4, 4), y: e.y - 4 + fx.range(-4, 6), vy: up ? -fx.range(10, 20) : fx.range(5, 12), life: fx.range(0.4, 0.8), colors: [TIME.mid, PLUM[2]], size: 1, alpha: 0.8 });
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'ckghost_hurt_0'), -8 + Math.sin(e.age * 2.6) * 1.5);
  },
  onDeath(e, w) {
    shards(w, e.x, e.y - 8, 10, 90);
    w.particles.burst(e.x, e.y - 8, { count: 14, speed: [20, 80], life: [0.4, 0.9], colors: [TIME.mid, TIME.low, PLUM[2]], size: [1, 2], additive: true, drag: 2 });
    w.spawn(new RingFx(e.x, e.y - 8, 28, 0.4, TIME.hot, 2));
    w.sfx('clock_rewind', { vol: 0.4, pitch: 0.6 });
  },
});
