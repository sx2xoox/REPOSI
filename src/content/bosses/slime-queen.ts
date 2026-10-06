import { bossIntercept, pickBossPattern } from './tactics';
// Floor 2 boss: 점액 여왕 (the slime queen) — 왕관을 삼킨 군체.
// A colossal amber jelly that swallowed a king's crown (and the king). Bones,
// coins and the crown float inside it; it hops with royal disdain.
// Phase 1: royal leap (landing splash ring), hop chains, glob volleys, and the
// crown crush — it bounds off-screen while its shadow hunts the player.
// Phase 2 (≤60%) / 3 (≤30%): it sheds mass — cave slimes / slimelings squeeze
// out, it shrinks, gets faster, and the shockwaves multiply.

import { defineBoss } from '../../game/defs';
import { PixelPainter, bayer } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { clamp, ease } from '../../engine/math';
import { GroundWarning, RingFx } from '../../game/effects';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Script } from '../../engine/script';
import { bullet, frames, landingSpot, lob, spotAround, stepToward, volleyTargets } from '../enemies/shared';
import {
  ball, bossDeathBurst, dissolveMinions, hitPlayerCircle, minionCount, OUTLINE, phaseFor, phaseShift, pickPattern, shootGapRing,
  Shockwave, summonMinion,
  clearArena,
} from './kit13';

// ------------------------------------------------------------------ palette
const JELLY = ['#4a1c06', '#86400e', '#c4701c', '#eea032', '#ffcc6a', '#fff0c0'];
const CORE = '#a85414';
const GOLD = ['#7a4a08', '#c08a18', '#ffd040', '#fff4a0'];
const GEM_R = '#e0204a';
const GEM_B = '#4a80ff';
const BONE_IN = ['#a8784a', '#d8b07a', '#f0d8a8'];

/** size variants: phase 0 / 1 / 2 */
const SIZES = [1, 0.84, 0.7];

interface QPose {
  sx: number;
  sy: number;
  eyes: 'haughty' | 'wide' | 'squint' | 'hurt';
  mouth: number;
  /** crown bob inside */
  bob?: number;
}

function paintCrown(p: PixelPainter, crx: number, cry: number, k: number, tilt: number): void {
  const cw = 9 * k;
  const chh = 7 * k;
  const pt = (u: number, v: number): [number, number] => [crx + u * Math.cos(tilt) - v * Math.sin(tilt), cry + u * Math.sin(tilt) + v * Math.cos(tilt)];
  const spikes = 3;
  const outline: [number, number][] = [[-cw, chh * 0.5]];
  for (let i = 0; i <= spikes * 2; i++) {
    const u = -cw + (i / (spikes * 2)) * cw * 2;
    outline.push([u, i % 2 === 0 ? -chh : -chh * 0.2]);
  }
  outline.push([cw, chh * 0.5]);
  const poly: number[] = [];
  for (const [u, v] of outline) poly.push(...pt(u, v));
  p.poly(poly, GOLD[2]);
  // shading: darker right half, bright rim band
  for (let i = 0; i < 3; i++) {
    const [a0, b0] = pt(-cw + 1, chh * (0.05 + i * 0.15));
    const [a1, b1] = pt(cw - 1, chh * (0.05 + i * 0.15));
    p.line(a0, b0, a1, b1, i === 0 ? GOLD[3] : i === 1 ? GOLD[1] : GOLD[0]);
  }
  for (let i = 0; i <= spikes; i++) {
    const [tx, ty] = pt(-cw + (i / spikes) * cw * 2, -chh);
    p.circle(tx, ty, 0.9 * k + 0.3, GOLD[3]);
  }
  const [g1x, g1y] = pt(0, chh * 0.2);
  p.circle(g1x, g1y, 1.1 * k + 0.2, GEM_R);
  p.px(g1x + 1, g1y + 1, GOLD[0]);
  p.px(g1x - 0.5, g1y - 0.5, '#ffb0c0');
  const [g2x, g2y] = pt(-cw * 0.6, chh * 0.22);
  const [g3x, g3y] = pt(cw * 0.6, chh * 0.22);
  p.px(g2x, g2y, GEM_B);
  p.px(g3x, g3y, GEM_B);
  const [hx, hy] = pt(-cw * 0.7, -chh * 0.3);
  p.px(hx, hy, '#ffffff');
}

function paintQueen(p: PixelPainter, W: number, H: number, k: number, o: QPose): void {
  const base = H - 3;
  const cx = W / 2;
  const rx = (W / 2 - 3) * o.sx;
  const ry = (H - 13 * k) * 0.86 * o.sy;
  const bob = o.bob ?? 0;
  // the crown sits on top, half sunk into the jelly (drawn first, jelly covers its base)
  const top = base - ry;
  paintCrown(p, cx + rx * 0.12, top + 2 * k + bob * 0.5, k, 0.16);
  // dome clipped at the base + puddle skirt
  const tmp = new PixelPainter(W, H);
  tmp.ellipse(cx, base, rx, ry, JELLY[3]);
  tmp.ellipse(cx, base - 0.5, Math.min(W / 2 - 0.5, rx * 1.08), 2.4 * k + 0.5, JELLY[3]);
  const body = new Set<number>();
  for (let y = 0; y <= base + 1; y++) for (let x = 0; x < W; x++) if (tmp.isSet(x, y)) body.add(y * W + x);
  // translucent jelly over the crown's lower band
  for (const i of body) {
    const x = i % W;
    const y = Math.floor(i / W);
    const under = p.get(x, y);
    p.px(x, y, under >>> 24 && y < top + 5 * k ? GOLD[1] : JELLY[3]);
  }
  p.shadeSphere(cx, base - ry * 0.35, rx * 1.02, ry * 1.0, JELLY.slice(0, 5), { dither: false });
  // keep the sunk crown band visible through the jelly
  for (const i of body) {
    const x = i % W;
    const y = Math.floor(i / W);
    if (y < top + 5 * k && tmp.isSet(x, y) && Math.abs(x - (cx + rx * 0.12)) < 8 * k && y > top - 1) p.px(x, y, y < top + 2 * k ? GOLD[2] : '#d8a030');
  }
  // inner core: thick jelly, banded (no noise)
  p.ellipse(cx, base - ry * 0.32, rx * 0.66, ry * 0.42, JELLY[2]);
  p.ellipse(cx + rx * 0.04, base - ry * 0.28, rx * 0.46, ry * 0.3, CORE);
  // swallowed treasures
  // The swallowed royal collar sits behind the face and bones.
  for (let i = -3; i <= 3; i++) {
    const x = cx + rx * i * 0.2;
    const y = base - ry * (0.24 - Math.abs(i) * 0.025);
    p.ellipse(x, y, 2.1 * k, 1.5 * k, '#dbab50');
    p.px(x - k, y - k, '#ffe2a0');
  }
  p.poly([cx - 3 * k, base - ry * 0.18, cx, base - ry * 0.24, cx + 3 * k, base - ry * 0.18, cx, base - ry * 0.08], k < 0.8 ? '#de675b' : '#ad6633');
  p.line(cx, base - ry * 0.2, cx - k, base - ry * 0.13, '#ffe5af');
  const skx = cx + rx * 0.34;
  const sky = base - ry * 0.26 + bob * 0.5;
  ball(p, skx, sky, 4 * k, 3.4 * k, BONE_IN, false);
  p.px(skx - 1.4 * k, sky - 0.3, '#6a3008');
  p.px(skx + 1.4 * k, sky - 0.3, '#6a3008');
  p.rect(skx - 1.4 * k, sky + 2 * k, 3 * k, 1, BONE_IN[0]);
  // a knight's sword, swallowed whole
  p.line(cx - rx * 0.62, base - ry * 0.12, cx - rx * 0.12, base - ry * 0.5, '#e0c8a0');
  p.line(cx - rx * 0.6, base - ry * 0.1, cx - rx * 0.1, base - ry * 0.48, '#a88050');
  p.line(cx - rx * 0.56, base - ry * 0.28, cx - rx * 0.44, base - ry * 0.02, '#8a5a20');
  for (const [dx, dy] of [[-0.3, -0.08], [0.06, -0.12], [0.6, -0.42]] as const) {
    const x = cx + rx * dx;
    const y = base - ry * 0.2 + ry * dy;
    p.ellipse(x, y, 1.8 * k + 0.4, 1.1 * k + 0.3, GOLD[1]);
    p.px(x - 0.5, y - 0.5, GOLD[3]);
  }
  for (const [dx, dy, r] of [[-0.66, -0.55, 1.4], [0.52, -0.7, 1], [0.15, -0.88, 0.8], [-0.2, -0.3, 0.7]] as const) {
    p.ring(cx + rx * dx, base + ry * dy, r * k + 0.6, 1, JELLY[4]);
  }
  // darker rim where the jelly meets the floor
  // A second reflected edge gives the right shoulder a wet, glassy surface.
  const glx = cx + rx * 0.72;
  const gly = base - ry * 0.52;
  p.line(glx, gly - 2 * k, glx + k, gly, JELLY[4]);
  p.px(glx + k, gly + 2 * k, JELLY[3]);
  for (let x = 0; x < W; x++) {
    if (p.isSet(x, base)) p.px(x, base, JELLY[1]);
    if (p.isSet(x, base + 1)) p.px(x, base + 1, JELLY[0]);
  }
  // eyes: slit pupils under angry brows
  const ey = base - ry * 0.64;
  const ex = rx * 0.3;
  const er = Math.max(2.2, 3.6 * k);
  for (const s of [-1, 1]) {
    const x = cx + s * ex;
    if (o.eyes === 'squint') {
      p.line(x - er, ey - s * 0.5, x + er, ey + s * 0.5, '#2a0c02');
      p.line(x - er, ey + 1, x + er, ey + 1, JELLY[1]);
      continue;
    }
    if (o.eyes === 'hurt') {
      p.line(x - er + 1, ey - er + 1, x + er - 1, ey + er - 1, '#2a0c02');
      p.line(x - er + 1, ey + er - 1, x + er - 1, ey - er + 1, '#2a0c02');
      continue;
    }
    p.ellipse(x, ey, er, er * 1.1, '#fff4d0');
    p.rect(x - 0.5 + s * 0.4, ey - er * 0.7, Math.max(1, Math.round(er * 0.45)), er * 1.4, '#2a0c02');
    p.px(x - er * 0.45, ey - er * 0.45, '#ffffff');
    if (o.eyes === 'haughty') {
      // heavy lids: looking down on you
      for (let yy = Math.floor(ey - er * 1.2); yy <= ey - er * 0.2; yy++) {
        for (let xx = Math.floor(x - er - 1); xx <= x + er + 1; xx++) {
          const nx = (xx + 0.5 - x) / er;
          const ny = (yy + 0.5 - ey) / (er * 1.1);
          if (nx * nx + ny * ny <= 1.05) p.px(xx, yy, JELLY[3]);
        }
      }
    }
    // angry brow (inner end low)
    p.line(x - s * (er + 1), ey - er - 1.5, x + s * (er * 0.6), ey - er * 0.35, '#5a2006');
    p.line(x - s * (er + 1), ey - er - 2.5, x + s * (er * 0.6), ey - er * 1.35, JELLY[1]);
  }
  // mouth: a smug, wide grin / gaping maw
  const my = base - ry * 0.4;
  const mw = rx * 0.34;
  if (o.mouth <= 0) {
    p.line(cx - mw, my - 2, cx - mw * 0.4, my, '#5a2006');
    p.line(cx - mw * 0.4, my, cx + mw * 0.4, my, '#5a2006');
    p.line(cx + mw * 0.4, my, cx + mw, my - 2, '#5a2006');
  } else {
    p.ellipse(cx, my, mw, o.mouth * 0.7 * k + 0.6, '#3a1004');
    p.ellipse(cx, my + o.mouth * 0.25 * k, mw * 0.55, o.mouth * 0.3 * k + 0.3, '#c03a50');
    for (let i = -2; i <= 2; i++) p.px(cx + i * mw * 0.35, my - o.mouth * 0.55 * k, JELLY[5]);
  }
  // glossy highlights
  const hx = cx - rx * 0.6;
  const hy = base - ry * 0.7;
  p.line(hx, hy + 4 * k, hx + 3 * k, hy - 1, JELLY[5]);
  p.line(hx + 1, hy + 4 * k, hx + 4 * k, hy - 1, JELLY[4]);
  p.px(hx + 6 * k, hy - 2.5 * k, '#ffffff');
  p.px(hx + 7 * k, hy - 3 * k, JELLY[5]);
  // drips on the skirt
  for (const dx of [-0.7, -0.2, 0.45, 0.8]) {
    const x = Math.round(cx + rx * dx);
    if (p.isSet(x, base - 1)) p.px(x, base + 1, JELLY[2]);
  }
}

const POSES: Record<string, QPose[]> = {
  idle: [
    { sx: 1, sy: 1, eyes: 'haughty', mouth: 0, bob: 0 },
    { sx: 1.03, sy: 0.96, eyes: 'haughty', mouth: 0, bob: 1 },
    { sx: 1.05, sy: 0.93, eyes: 'haughty', mouth: 0, bob: 1 },
    { sx: 1.02, sy: 0.97, eyes: 'haughty', mouth: 0, bob: 0 },
  ],
  crouch: [{ sx: 1.18, sy: 0.72, eyes: 'squint', mouth: 0, bob: 2 }],
  air: [{ sx: 0.84, sy: 1.18, eyes: 'wide', mouth: 2, bob: -2 }],
  land: [{ sx: 1.3, sy: 0.6, eyes: 'squint', mouth: 3, bob: 3 }],
  spit: [
    { sx: 0.95, sy: 1.06, eyes: 'wide', mouth: 6, bob: -1 },
    { sx: 1.02, sy: 0.98, eyes: 'wide', mouth: 4, bob: 0 },
  ],
  hurt: [{ sx: 1.12, sy: 0.88, eyes: 'hurt', mouth: 3, bob: 2 }],
};
const FPS: Record<string, number> = { idle: 5, spit: 10 };

SIZES.forEach((k, si) => {
  const W = Math.round(66 * k);
  const H = Math.round(56 * k);
  for (const [state, poses] of Object.entries(POSES)) {
    frames(`squeen${si}`, state, poses.length, W, H, (p, i) => paintQueen(p, W, H, k, poses[i]), { anchor: 'bottom', fps: FPS[state] ?? 8 });
  }
});

defineDrawnSprite('squeen_portrait', 76, 66, (p) => paintQueen(p, 76, 66, 1.16, { sx: 0.97, sy: 1.04, eyes: 'wide', mouth: 6, bob: -1 }), { outline: OUTLINE, anchor: 'bottom' });

defineDrawnSprite('squeen_glob', 9, 9, (p) => {
  ball(p, 4.5, 4.5, 4, 4, JELLY.slice(1), true);
  p.px(2, 2, '#ffffff');
  p.px(3, 2, JELLY[5]);
}, { outline: '#1a0800' });

// ------------------------------------------------------------------ behaviour
const NAME = '점액 여왕';
const RADII = [20, 17, 14];
const JELLY_COLS = ['#fff0c0', '#ffcc6a', '#eea032', '#86400e'];

function anim(e: Enemy, state: string, restart = false): void {
  e.setAnim(`squeen${Math.min(2, e.phase)}_${state}`, restart);
}

/** Where the queen's body meets the floor (the entity position is the dome's centre). */
function foot(e: Enemy): { x: number; y: number } {
  return { x: e.x, y: e.y + e.r * 0.45 };
}

/** Entity position that puts the queen's footprint on (x, y). */
function bodyFor(w: World, e: Enemy, x: number, y: number): { x: number; y: number } {
  return landingSpot(w, x, y - e.r * 0.45, e.r);
}

function splash(w: World, x: number, y: number, n = 14, speed = 110): void {
  w.particles.burst(x, y - 2, { count: n, speed: [30, speed], life: [0.3, 0.6], colors: JELLY_COLS, size: [1, 3], gravity: 300, vz: [30, 120] });
}

function* landHeavy(e: Enemy, w: World, big: boolean): Script {
  anim(e, 'land', true);
  w.sfx('splat', { vol: 1, pitch: big ? 0.5 : 0.7 });
  w.sfx('slam', { vol: big ? 0.8 : 0.5, pitch: 0.9 });
  w.shake(big ? 0.7 : 0.45);
  const f = foot(e);
  splash(w, f.x, f.y, big ? 26 : 16, big ? 150 : 110);
  w.decal(f.x, f.y, '#a85414', e.r * 0.9, 0.35);
  yield 0.18;
}

function* leap(e: Enemy, w: World): Script {
  const ph = e.phase;
  anim(e, 'crouch', true);
  const wind = [0.55, 0.45, 0.36][Math.min(2, ph)];
  const air = 0.78;
  const t = e.target(w);
  const aim = bossIntercept(t);
  const land = bodyFor(w, e, aim.x, aim.y);
  e.telegraph(wind);
  w.spawn(new GroundWarning(land.x, land.y + e.r * 0.45, e.r + 12, wind + air));
  w.sfx('enemy_charge', { vol: 0.5, pitch: 0.7 });
  yield wind;
  anim(e, 'air', true);
  e.facing = land.x >= e.x ? 1 : -1;
  yield* e.jumpTo(w, land.x, land.y, air, 78);
  hitPlayerCircle(w, foot(e).x, foot(e).y, e.r + 10, 2, NAME);
  yield* landHeavy(e, w, true);
  const g = w.rng.angle();
  shootGapRing(e, w, ph >= 2 ? 18 : 14, w.rng.angle(), [g, g + Math.PI], 0.9, bullet('toxic', 3, { speed: 78, z: 8 }));
  anim(e, 'idle');
  yield 0.5;
}

function* hopChain(e: Enemy, w: World): Script {
  const ph = e.phase;
  const n = 3 + ph;
  for (let i = 0; i < n; i++) {
    anim(e, 'crouch', true);
    const wind = ph >= 2 ? 0.2 : 0.28;
    const t = e.target(w);
    const f0 = foot(e);
    const s = stepToward(f0.x, f0.y, t.x, t.y, 62);
    const land = bodyFor(w, e, s.x, s.y);
    e.telegraph(wind);
    w.spawn(new GroundWarning(land.x, land.y + e.r * 0.45, e.r + 6, wind + 0.42));
    yield wind;
    anim(e, 'air', true);
    yield* e.jumpTo(w, land.x, land.y, 0.42, 30);
    hitPlayerCircle(w, foot(e).x, foot(e).y, e.r + 4, 1, NAME);
    anim(e, 'land', true);
    w.sfx('splat', { vol: 0.7, pitch: 0.9 });
    splash(w, foot(e).x, foot(e).y, 8, 80);
    if (i === n - 1) {
      const g = w.rng.angle();
      shootGapRing(e, w, 10, w.rng.angle(), [g], 0.9, bullet('toxic', 3, { speed: 80, z: 8 }));
    }
    yield 0.12;
  }
  anim(e, 'idle');
  yield 0.5;
}

function* globVolley(e: Enemy, w: World): Script {
  const ph = e.phase;
  anim(e, 'spit', true);
  e.telegraph(0.5);
  w.sfx('charge', { vol: 0.4, pitch: 0.7 });
  yield 0.5;
  const n = 5 + ph;
  const p = w.player;
  const pts = volleyTargets(e.x, e.y, p.x + p.vx * 0.3, p.y + p.vy * 0.3, 3, 32);
  while (pts.length < n) pts.push(spotAround(w, p.x, p.y, 26, 80, 5) ?? { x: p.x, y: p.y });
  for (const pt of pts) {
    const land = landingSpot(w, pt.x, pt.y, 4);
    lob(w, e.x, e.y - e.r, land.x, land.y, {
      sprite: 'squeen_glob', color: '#ffb030', time: 0.95, height: 70, warn: 13, hitRadius: 12, source: NAME, spin: 4,
      onLand: (ww, x, y) => splash(ww, x, y, 8, 70),
    });
    e.squash(0.88, 1.14);
    w.sfx('splat', { vol: 0.45, pitch: 1.3 });
    yield 0.13;
  }
  anim(e, 'idle');
  yield 0.8;
}

function* crownCrush(e: Enemy, w: World): Script {
  const ph = e.phase;
  anim(e, 'crouch', true);
  e.telegraph(0.6);
  w.sfx('enemy_roar', { vol: 0.5, pitch: 1.2 });
  yield 0.6;
  // launch off the top of the screen
  anim(e, 'air', true);
  e.harmful = false;
  w.sfx('whoosh', { vol: 0.7, pitch: 0.6 });
  splash(w, foot(e).x, foot(e).y, 16, 120);
  for (let el = 0; el < 0.45; el += w.dt) {
    e.z = 280 * ease.outQuad(el / 0.45);
    yield;
  }
  e.vulnerable = false;
  e.hidden = true;
  // the shadow hunts the player
  let gx = foot(e).x;
  let gy = foot(e).y;
  const follow = [1.4, 1.2, 1.0][Math.min(2, ph)];
  const lock = 0.6;
  const g = w.spawn(new GroundWarning(gx, gy, e.r + 14, follow + lock));
  for (let el = 0; el < follow; el += w.dt) {
    const t = e.target(w);
    const d = Math.hypot(t.x - gx, t.y - gy);
    const sp = Math.min(d, 125 * w.dt);
    if (d > 0.1) {
      gx += ((t.x - gx) / d) * sp;
      gy += ((t.y - gy) / d) * sp;
    }
    g.x = gx;
    g.y = gy;
    yield;
  }
  const land = bodyFor(w, e, gx, gy);
  e.x = land.x;
  e.y = land.y;
  g.x = foot(e).x;
  g.y = foot(e).y;
  yield lock - 0.3;
  e.hidden = false;
  w.sfx('whoosh', { vol: 0.6, pitch: 0.45 });
  for (let el = 0; el < 0.3; el += w.dt) {
    e.z = 280 * (1 - ease.inQuad(Math.min(1, el / 0.3)));
    yield;
  }
  e.z = 0;
  e.vulnerable = true;
  e.harmful = true;
  const f = foot(e);
  hitPlayerCircle(w, f.x, f.y, e.r + 14, 2, NAME);
  yield* landHeavy(e, w, true);
  w.shake(0.9);
  const ga = w.rng.angle();
  w.spawn(new Shockwave(f.x, f.y, { speed: 130, maxR: 170, color: '#ffb030', gaps: ph >= 2 ? [ga] : [ga, ga + Math.PI], gapWidth: 1.0, source: NAME, debris: JELLY_COLS }));
  if (ph >= 1) {
    yield 0.35;
    w.spawn(new Shockwave(f.x, f.y, { speed: 130, maxR: 170, color: '#ffb030', gaps: [ga + Math.PI / 2, ga - Math.PI / 2], gapWidth: 1.0, source: NAME, debris: JELLY_COLS }));
  }
  anim(e, 'idle');
  yield 0.8;
}

function* shed(e: Enemy, w: World, toPhase: number): Script {
  yield* phaseShift(e, w, {
    anim: `squeen${Math.min(2, e.phase)}_hurt`,
    color: '#ffb030',
    time: 1.4,
    onPeak: () => {
      e.r = RADII[Math.min(2, toPhase)];
      anim(e, 'spit', true);
      splash(w, e.x, e.y, 36, 170);
      w.sfx('splat', { vol: 1, pitch: 0.4 });
      // chunks of the queen squeeze out and come alive
      const kind = toPhase === 1 ? 'cave_slime' : 'slimeling';
      const count = Math.max(0, (toPhase === 1 ? 2 : 3) - minionCount(w, e));
      for (let i = 0; i < count; i++) {
        const s = spotAround(w, e.x, e.y, 30, 70, 8) ?? { x: e.x + (i - 1) * 30, y: e.y + 20 };
        lob(w, e.x, e.y - e.r, s.x, s.y, {
          sprite: 'squeen_glob', color: '#ffb030', time: 0.7, height: 50, warn: 10, hitRadius: 8, source: NAME,
          onLand: (ww, x, y) => {
            summonMinion(e, ww, kind, x, y, JELLY_COLS);
          },
        });
      }
      const g = w.rng.angle();
      shootGapRing(e, w, 16, 0, [g, g + Math.PI], 0.9, bullet('toxic', 3, { speed: 74, z: 8 }));
    },
  });
  anim(e, 'idle');
}

defineBoss({
  id: 'slime_queen',
  name: NAME,
  bossTitle: '왕관을 삼킨 군체',
  bossFloors: [2],
  hp: 850,
  radius: 20,
  speed: 0,
  mass: 6,
  sprite: 'squeen0_idle',
  portrait: 'squeen_portrait',
  shadow: 0,
  spriteYOffset: 0,
  deathFx: 'goo',
  bloodColor: '#eea032',
  contactDamage: 1,
  hurtSfx: 'splat',
  light: { radius: 52, color: '#ffb040' },
  init(e) {
    e.mem.last = null;
  },
  *script(e, w) {
    anim(e, 'idle');
    yield 0.3;
    while (true) {
      const want = phaseFor(e.hp / e.maxHp, [0.6, 0.3]);
      while (e.phase < want) yield* shed(e, w, e.phase + 1);
      const ph = e.phase;
      const id = pickBossPattern(e, w, [
        { id: 'leap', w: 3 },
        { id: 'hops', w: 2.4 },
        { id: 'globs', w: 2.2 },
        { id: 'crush', w: 1.6 + ph * 0.4 },
      ], e.mem.last as string | null);
      e.mem.last = id;
      if (id === 'leap') yield* leap(e, w);
      else if (id === 'hops') yield* hopChain(e, w);
      else if (id === 'globs') yield* globVolley(e, w);
      else yield* crownCrush(e, w);
      anim(e, 'idle');
      yield [0.4, 0.28, 0.2][Math.min(2, ph)];
    }
  },
  update(e, w) {
    if (!e.hidden && e.z < 4 && fx.chance(0.06)) {
      w.particles.spawn({ x: e.x + fx.range(-e.r, e.r), y: e.y - fx.range(0, e.r), vy: -fx.range(4, 10), life: fx.range(0.5, 0.9), colors: ['#fff0c0', '#ffcc6a'], size: 1, alpha: 0.7 });
    }
  },
  draw(e, r) {
    if (e.hidden) return;
    const k = clamp(e.z / 160, 0, 0.85);
    r.shadow(e.x, e.y + e.r * 0.85, e.r * 2.7 * (1 - k), e.r * 0.8 * (1 - k), 0.4);
    // the sprite is bottom-anchored; the entity sits at the dome's centre
    e.drawDefault(r, e.frame(), Math.round(e.r * 1.05));
  },
  onDeath(e, w) {
    clearArena(w);
    dissolveMinions(w, e);
    splash(w, e.x, e.y, 50, 200);
    bossDeathBurst(w, e.x, e.y, ['#fff0c0', '#ffcc6a', '#eea032', '#86400e']);
    for (let i = 0; i < 6; i++) w.decal(e.x + fx.range(-20, 20), e.y + fx.range(-8, 8), '#c4701c', fx.range(3, 8), 0.5);
    for (let i = 0; i < 3; i++) w.spawn(new RingFx(e.x, e.y, 30 + i * 24, 0.5 + i * 0.15, '#ffcc6a', 2));
    // the crown is spat out as it dies
    w.particles.spawn({ x: e.x, y: e.y - 6, vx: fx.range(-20, 20), vy: -10, vz: 160, gravity: 360, z: 4, life: 1.4, colors: ['#ffd040'], shape: 'sprite', sprite: 'squeen_crown', bounce: 0.4 });
  },
});

defineDrawnSprite('squeen_crown', 13, 8, (p) => {
  p.poly([0, 8, 0, 1, 2.5, 4, 4.5, 0, 6.5, 4, 8.5, 0, 10.5, 4, 13, 1, 13, 8], GOLD[2]);
  p.rect(0, 5, 13, 1, GOLD[1]);
  p.rect(0, 7, 13, 1, GOLD[0]);
  p.px(6, 6, GEM_R);
  p.px(3, 6, GEM_B);
  p.px(10, 6, GEM_B);
  p.px(4, 0, GOLD[3]);
}, { outline: '#1a0800' });
