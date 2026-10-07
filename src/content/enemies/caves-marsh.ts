// Floor 2 — 포자 동굴 (spore caves): two more cave basics.
//  - 혀날름 두꺼비 (tongue toad): moves only by short telegraphed hops; when the keeper is
//    40–115 px away it shows a narrow lane, then whips its sticky tongue along it. A hit
//    hurts and yanks the keeper toward the toad.
//  - 공벌레 (pill bug): an armoured cave isopod. Three quick hits, or a clear line to the
//    keeper, make it curl into a ball (20% damage taken), show its lane (with one ricochet)
//    and roll; afterwards it lies dizzy on its back for a moment and takes 150% damage.

import { defineEnemy } from '../../game/defs';
import { GroundWarning } from '../../game/effects';
import { PixelPainter, ramp } from '../../engine/painter';
import { fx } from '../../engine/rng';
import { clamp } from '../../engine/math';
import type { Renderer } from '../../engine/renderer';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Script } from '../../engine/script';
import { appliedDamage, dizzy, dust, frames, hurtFrame, landingSpot, laneWarning, rayFree, sphere, stepToward } from './shared';
import { bouncePath, reflectAngle } from './clock-shared';
import { EnemyOverlay } from './crypt-toll';

const DIRT = ['#5a4636', '#3e2e24', '#7a604a'];
const SPORE = { cap: '#8a3cb4', hi: '#d890ff', glow: '#d6ff5a' };

// ================================================================== 혀날름 두꺼비 (tongue toad)
const TOAD = ramp('#4f8a3c', 5);
const BELLY = ['#9aa868', '#c8d498', '#e8eec0'];
const WART = ['#5a2482', SPORE.cap, SPORE.hi];
const EYE = '#ffd23a';
const MOUTH = '#2a0a14';
const TONGUE = { dark: '#2a0814', base: '#c8385a', hi: '#ff8aa8', tip: '#ff5a7e', glint: '#ffe0ea' };

/** Lane reach of a lash, its timing and the yank it gives. */
export const TONGUE_REACH = 115;
export const TONGUE_MIN = 40;
export const TONGUE_WARN = 0.55;
const TONGUE_OUT = 0.15;
const TONGUE_HOLD = 0.1;
const TONGUE_BACK = 0.3;
/** visual height of the mouth above the ground point */
const TONGUE_Z = 3.5;
/** px of slide per unit of initial knockback speed (keeper knockback decays e^-10t per 60 Hz step) */
const KB_TO_PX = 0.0919;
export const YANK_PX = 28;

type ToadMode = 'idle' | 'crouch' | 'air' | 'gulp' | 'lash' | 'hurt';

function paintToad(p: PixelPainter, k: number, mode: ToadMode): void {
  const crouch = mode === 'crouch' ? 1 : 0;
  const air = mode === 'air';
  const dy = air ? -1 : crouch;
  // hind leg: folded haunch, or kicked back in the air
  if (air) {
    // kicking off (k = 0), then fully stretched (k = 1)
    p.line(5, 11, 1 + (1 - k), 14 - (1 - k), TOAD[1]);
    p.line(2 + (1 - k), 13 - (1 - k), k, 15 - (1 - k), TOAD[1]);
    p.rect(k, 15 - (1 - k), 3, 1, TOAD[2]);
  } else {
    p.ellipse(5.5, 12.5 - crouch * 0.3, 4, 3.2, TOAD[1]);
    p.rect(2, 15, 6, 1, TOAD[1]);
    p.px(2, 15, TOAD[3]);
    p.px(4, 15, TOAD[2]);
  }
  // hunched body: high hips at the back, a broad flat head in front
  p.ellipse(8.5, 9.5 + dy, 6.5, air ? 4.2 : 5 - crouch * 0.6, TOAD[2]);
  p.ellipse(14.5, 10.5 + dy, 5.6, air ? 3.4 : 3.9 - crouch * 0.4, TOAD[2]);
  if (!air) p.ellipse(5.5, 12.5 - crouch * 0.3, 3.4, 2.6, TOAD[2]);
  sphere(p, 10.5, 9 + dy, 9.5, 6.4, TOAD, false);
  // the haunch's rim and the pale strip under the chin
  if (!air) p.line(3, 11 + crouch, 5, 10 + crouch, TOAD[3]);
  p.line(11, 13 + dy, 17, 13 + dy, BELLY[0]);
  p.line(12, 12 + dy, 16, 12 + dy, BELLY[1]);
  // throat sac: breathes when idle, swells before a lash
  const sac = mode === 'gulp' ? 2.1 + k * 0.5 : mode === 'idle' && k ? 1.4 : 0;
  if (sac > 0) {
    p.ellipse(16, 12.6 + dy, sac * 1.3, sac, BELLY[2]);
    p.px(15, Math.round(12 + dy - sac * 0.5), '#ffffff');
  }
  // front leg
  if (air) {
    p.line(16, 13, 18, 15, TOAD[1]);
  } else {
    p.line(15, 13 + crouch, 16, 15, TOAD[1]);
    p.rect(15, 15, 3, 1, TOAD[2]);
    p.px(17, 15, TOAD[3]);
  }
  // spore warts + a tiny glowing mushroom sprouting from its back
  for (const [x, y] of [[5, 7], [8, 6], [11, 7], [4, 10], [8, 9]] as const) {
    p.pxIn(x, y + dy, WART[1]);
    p.pxIn(x, y + dy - 1, WART[2]);
    p.pxIn(x + 1, y + dy, WART[0]);
  }
  const my = 3 + dy;
  p.line(8, my, 8, my + 2, '#e2d6c0');
  p.rect(7, my - 1, 3, 1, SPORE.cap);
  p.px(6, my, SPORE.cap);
  p.px(10, my, WART[0]);
  p.px(8, my - 1, SPORE.glow);
  // eyes: a bulging near eye (gold, horizontal pupil) and the far one
  const ex = 14;
  const ey = 6 + dy;
  p.circle(ex, ey, 2.4, TOAD[3]);
  p.px(ex - 1, ey - 2, TOAD[4]);
  if (mode === 'hurt') {
    p.rect(ex - 1, ey, 3, 1, '#ffffff');
  } else if (mode === 'gulp') {
    p.rect(ex - 1, ey, 3, 1, EYE);
    p.px(ex, ey, '#141008');
  } else {
    p.rect(ex - 1, ey - 1, 3, 3, EYE);
    p.rect(ex - 1, ey, 3, 1, '#141008');
    p.px(ex - 1, ey - 1, '#fff6c0');
  }
  p.circle(17.5, ey + 1, 1.5, TOAD[2]);
  p.px(18, ey + 1, mode === 'hurt' ? '#ffffff' : EYE);
  // nostril and the wide mouth
  const my2 = 10 + dy;
  p.px(19, my2 - 2, TOAD[0]);
  if (mode === 'lash') {
    const gape = 2.6 + k * 0.8;
    p.poly([12, my2, 20.5, my2 - gape, 20.5, my2 + gape], MOUTH);
    p.poly([14, my2, 20, my2 - gape * 0.5, 20, my2 + gape * 0.5], '#7a1a30');
    p.line(14, my2, 20, my2, TONGUE.base);
  } else if (mode === 'gulp') {
    p.line(12, my2, 20, my2 - 1, MOUTH);
    p.line(14, my2 + 1, 19, my2, '#7a1a30');
    if (k) p.px(20, my2, TONGUE.tip);
  } else {
    p.line(12, my2, 20, my2 - 1, MOUTH);
    p.line(13, my2 - 1, 18, my2 - 1, TOAD[3]);
  }
}
const TO = { anchor: 'bottom' as const };
frames('ttoad', 'idle', 2, 21, 16, (p, i) => paintToad(p, i, 'idle'), { ...TO, fps: 2.5 });
frames('ttoad', 'crouch', 1, 21, 16, (p) => paintToad(p, 0, 'crouch'), TO);
frames('ttoad', 'air', 2, 21, 16, (p, i) => paintToad(p, i, 'air'), { ...TO, fps: 6, loop: false });
frames('ttoad', 'gulp', 2, 21, 16, (p, i) => paintToad(p, i, 'gulp'), { ...TO, fps: 8 });
frames('ttoad', 'lash', 2, 21, 16, (p, i) => paintToad(p, i, 'lash'), { ...TO, fps: 10 });
frames('ttoad', 'hurt', 1, 21, 16, (p) => paintToad(p, 0, 'hurt'), TO);

/** Ground point of the mouth for a toad facing `f`. */
function mouth(e: Enemy, f: number): { x: number; y: number } {
  return { x: e.x + f * 8, y: e.y + 1 };
}

/** Initial knockback speed that slides a keeper about `px` px. */
export function yankSpeed(px: number): number {
  return px / KB_TO_PX;
}

/**
 * Does the tongue, whose tip moved from `l0` to `l1` px along angle `a` from (mx, my)
 * this step, touch a keeper standing at (px, py) with radius `pr`?
 */
export function tongueTouches(mx: number, my: number, a: number, l0: number, l1: number, px: number, py: number, pr: number): boolean {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = px - mx;
  const dy = py - my;
  const along = dx * c + dy * s;
  const perp = Math.abs(-dx * s + dy * c);
  const lo = Math.min(l0, l1) - 2;
  const hi = Math.max(l0, l1) + 3;
  return along >= lo && along <= hi && perp <= 3 + pr * 0.6;
}

/** Would a lash right now reach the keeper (no rock in the way of the tongue)? */
function laneClear(e: Enemy, w: World): boolean {
  const tg = e.target(w);
  const m = mouth(e, tg.x >= e.x ? 1 : -1);
  const a = Math.atan2(tg.y - 2 - m.y, tg.x - m.x);
  const d = Math.hypot(tg.x - m.x, tg.y - 2 - m.y);
  return w.room.lineOfSight(e.x, e.y, tg.x, tg.y) && rayFree(w.room, m.x, m.y, a, 2, TONGUE_REACH, true, 3) >= Math.min(TONGUE_REACH, d) - 6;
}

function* toadHop(e: Enemy, w: World): Script {
  const tg = e.target(w);
  const d = e.distToTarget(w);
  const a = Math.atan2(tg.y - e.y, tg.x - e.x);
  let gx: number;
  let gy: number;
  if (d > 100) {
    const s = stepToward(e.x, e.y, tg.x, tg.y, 46);
    gx = s.x;
    gy = s.y;
  } else if (d < TONGUE_MIN + 8) {
    gx = e.x - Math.cos(a) * 40;
    gy = e.y - Math.sin(a) * 40;
  } else {
    // sideways, to find a clear lane
    const side = a + (w.rng.chance(0.5) ? 1 : -1) * Math.PI / 2;
    gx = e.x + Math.cos(side) * 34 + Math.cos(a) * 8;
    gy = e.y + Math.sin(side) * 34 + Math.sin(a) * 8;
  }
  const land = landingSpot(w, gx, gy, e.r);
  e.setAnim('ttoad_crouch');
  e.telegraph(0.3);
  e.facing = land.x >= e.x ? 1 : -1;
  w.spawn(new GroundWarning(land.x, land.y, 10, 0.3 + 0.45, undefined, '#ff3040'));
  yield 0.3;
  e.setAnim('ttoad_air');
  yield* e.jumpTo(w, land.x, land.y, 0.45, 20);
  e.setAnim('ttoad_crouch');
  w.sfx('splat', { vol: 0.35, pitch: 1.1 });
  dust(w, e.x, e.y + 4, DIRT, 5, 45);
  yield 0.18;
}

function* lash(e: Enemy, w: World, warn: number): Script {
  e.halt();
  const tg = e.target(w);
  e.facing = tg.x >= e.x ? 1 : -1;
  let m = mouth(e, e.facing);
  const a = Math.atan2(tg.y - 2 - m.y, tg.x - m.x);
  const len = Math.max(12, rayFree(w.room, m.x, m.y, a, 2, TONGUE_REACH, true, 3));
  laneWarning(w, m.x, m.y, a, len, 10, warn);
  e.setAnim('ttoad_gulp');
  e.telegraph(warn);
  w.sfx('enemy_roar', { vol: 0.3, pitch: 2.4 });
  yield warn;
  e.setAnim('ttoad_lash');
  e.mem.tA = a;
  e.mem.tL = 0;
  e.mem.tOn = 1;
  e.mem.tHit = 0;
  e.mem.tX = m.x;
  e.mem.tY = m.y;
  w.sfx('whoosh', { vol: 0.45, pitch: 1.8 });
  const total = TONGUE_OUT + TONGUE_HOLD + TONGUE_BACK;
  for (let el = w.dt; el <= total + 1e-9; el += w.dt) {
    m = mouth(e, e.facing);
    e.mem.tX = m.x;
    e.mem.tY = m.y;
    const l0 = e.mem.tL as number;
    const l1 = el < TONGUE_OUT ? len * (el / TONGUE_OUT) : el < TONGUE_OUT + TONGUE_HOLD ? len : len * Math.max(0, 1 - (el - TONGUE_OUT - TONGUE_HOLD) / TONGUE_BACK);
    e.mem.tL = l1;
    // the sticky tip catches while it shoots out and holds
    if (el <= TONGUE_OUT + TONGUE_HOLD + 1e-9) {
      for (const p of w.targets()) {
        const bit = 1 << (p.slot | 0);
        if ((e.mem.tHit & bit) !== 0 || !p.alive || p.z > 4 || p.dashing) continue;
        if (!tongueTouches(m.x, m.y, a, l0, l1, p.x, p.y - 2, p.r)) continue;
        if (p.hurt(w, 1, e.def.name, false, e)) {
          e.mem.tHit |= bit;
          // yank toward the toad, stopping short of its body
          const dx = m.x - p.x;
          const dy = m.y - p.y;
          const dd = Math.hypot(dx, dy) || 1;
          const v = yankSpeed(clamp(dd - 16, 0, YANK_PX));
          p.kbx = (dx / dd) * v;
          p.kby = (dy / dd) * v;
          w.sfx('splat', { vol: 0.5, pitch: 1.6 });
          w.particles.burst(p.x, p.y - 6, { count: 8, speed: [20, 60], life: [0.2, 0.4], colors: [TONGUE.hi, TONGUE.base, '#b8ff4a'], size: [1, 2], gravity: 200 });
        }
      }
    }
    yield;
  }
  e.mem.tOn = 0;
  e.mem.tL = 0;
  e.setAnim('ttoad_idle');
}

function tongueLight(e: Enemy, w: World): void {
  if (!e.mem.tOn) return;
  const a = e.mem.tA as number;
  const L = e.mem.tL as number;
  for (let d = 0; d <= L; d += 24) {
    w.lights.add(e.mem.tX + Math.cos(a) * d, e.mem.tY - TONGUE_Z + Math.sin(a) * d, 16, '#ff7a9a', { intensity: 0.6 });
  }
}

function drawTongue(e: Enemy, r: Renderer): void {
  if (!e.mem.tOn) return;
  const a = e.mem.tA as number;
  const L = e.mem.tL as number;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x0 = e.mem.tX as number;
  const y0 = (e.mem.tY as number) - TONGUE_Z;
  const x1 = x0 + c * L;
  const y1 = y0 + s * L;
  r.pixelLine(x0, y0, x1, y1, TONGUE.dark, 4);
  r.pixelLine(x0, y0, x1, y1, TONGUE.base, 2);
  // wet segments catching the light
  for (let d = 4; d < L - 4; d += 6) r.rect(x0 + c * d - (s > 0.7 ? 1 : 0), y0 + s * d - (Math.abs(s) < 0.7 ? 1 : 0), 1, 1, TONGUE.hi);
  // the sticky tip
  r.pixelDisc(x1, y1, 3, TONGUE.dark);
  r.pixelDisc(x1, y1, 2, TONGUE.tip);
  r.rect(x1 - 1, y1 - 1, 1, 1, TONGUE.glint);
  r.rect(x1 + 1, y1 + 1, 1, 1, SPORE.glow);
}

defineEnemy({
  id: 'tongue_toad',
  name: '혀날름 두꺼비',
  hp: 34,
  radius: 7,
  speed: 28,
  mass: 1.5,
  sprite: 'ttoad_idle',
  spriteYOffset: 4,
  shadow: 16,
  cost: 1.5,
  floors: [2],
  weight: 1,
  champion: true,
  deathFx: 'goo',
  bloodColor: '#6a9a3a',
  hurtSfx: 'splat',
  light: { radius: 14, color: '#c0ff60' },
  init(e, w) {
    e.mem.tOn = 0;
    e.mem.hops = 1;
    // the tongue is drawn by a y-sorted companion just in front of the toad, lit along its length
    w.spawn(new EnemyOverlay(e, 1, drawTongue, tongueLight));
  },
  *script(e, w) {
    yield w.rng.range(0.3, 0.8);
    while (true) {
      e.setAnim('ttoad_idle');
      yield w.rng.range(0.45, 0.85);
      const d = e.distToTarget(w);
      if (e.mem.hops >= 1 && d >= TONGUE_MIN && d <= TONGUE_REACH && laneClear(e, w)) {
        yield* lash(e, w, TONGUE_WARN);
        if (e.champion && e.alive) {
          yield 0.2;
          yield* lash(e, w, 0.4);
        }
        e.mem.hops = 0;
        yield 0.35;
      } else {
        yield* toadHop(e, w);
        e.mem.hops++;
      }
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'ttoad_hurt_0'));
  },
  onDeath(e, w) {
    w.particles.burst(e.x, e.y - 6, { count: 10, speed: [30, 90], life: [0.4, 0.8], colors: ['#e8ffb0', SPORE.glow, WART[1]], size: [1, 2], drag: 2 });
  },
});

// ================================================================== 공벌레 (pill bug)
const SHELL = ramp('#66758f', 5);
const UNDER = ['#4a4656', '#8a8698', '#b8b6c6'];
const LEG = '#3a3446';
const LICHEN = ['#2a8a70', '#56d0a8', '#a8ffe0'];

/** Damage taken while curled / while dizzy, and the roll. */
export const CURL_TAKEN = 0.2;
export const DIZZY_TAKEN = 1.5;
export const ROLL_SPEED = 170;
export const ROLL_DIST = 240;
const ROLL_WARN = 0.6;
const DIZZY_TIME = 0.9;
const CURL_SIGHT = 130;

function paintBugCrawl(p: PixelPainter, k: number, hurt: boolean): void {
  // little legs rippling front to back
  for (let i = 0; i < 6; i++) {
    const x = 5 + i * 2;
    const ph = (i + k) % 2;
    p.px(x + (ph ? 0 : -1), 10, LEG);
    p.px(x, 9, LEG);
  }
  // tail uropods
  p.px(1, 8, SHELL[2]);
  p.px(0, 9, SHELL[1]);
  p.px(2, 9, SHELL[1]);
  // segmented dome
  const bob = k % 2 === 1 ? -0.4 : 0;
  const tmp = new PixelPainter(20, 11);
  tmp.ellipse(9.5, 8.6 + bob, 8, 6.4, SHELL[2]);
  for (let y = 0; y <= 9; y++) for (let x = 0; x < 20; x++) if (tmp.isSet(x, y)) p.px(x, y, SHELL[2]);
  sphere(p, 9, 6.5 + bob, 8.5, 6, SHELL, false);
  // plate seams: dark grooves, the lit edge of the next plate on top
  for (const sx of [5, 8, 11, 14]) {
    let top = 0;
    while (top < 9 && !p.isSet(sx, top)) top++;
    for (let y = top; y <= 9; y++) p.pxIn(sx, y, SHELL[0]);
    p.pxIn(sx + 1, top, SHELL[4]);
    p.pxIn(sx + 1, top + 1, SHELL[3]);
  }
  // the underside rim
  for (let x = 2; x < 18; x++) p.pxIn(x, 9, UNDER[0]);
  // lichen spots on the plates
  p.pxIn(6, 4, LICHEN[1]);
  p.pxIn(12, 3, LICHEN[2]);
  p.pxIn(12, 4, LICHEN[0]);
  p.pxIn(9, 6, LICHEN[0]);
  // head + antennae
  p.ellipse(17, 8, 2.1, 1.7, SHELL[1]);
  p.px(16, 7, SHELL[3]);
  p.px(18, 8, hurt ? '#ffffff' : '#141018');
  const ant = k % 2;
  p.line(18, 7, 19, 4 + ant, SHELL[1]);
  p.px(19, 3 + ant, SHELL[3]);
  p.line(17, 7, 17, 4 - ant, SHELL[0]);
}

function lineIn(p: PixelPainter, x0: number, y0: number, x1: number, y1: number, c: string): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) p.pxIn(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
}

/** The curled ball (13x13) with its plate seams turned by `rot` radians. */
function paintBugBall(p: PixelPainter, rot: number, shut = true): void {
  const c = 6.5;
  p.circle(c, c, 6.2, SHELL[2]);
  sphere(p, c, c, 6.2, 6.2, SHELL, false);
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  for (const off of [-3, 0, 3]) {
    const mx = c + ca * off;
    const my = c + sa * off;
    lineIn(p, mx - sa * 7, my + ca * 7, mx + sa * 7, my - ca * 7, SHELL[0]);
  }
  // fixed light: a glint top-left, a dark rim bottom-right (the light does not roll)
  p.pxIn(4, 3, SHELL[4]);
  p.pxIn(3, 4, SHELL[4]);
  p.pxIn(4, 4, SHELL[3]);
  p.pxIn(10, 9, SHELL[0]);
  p.pxIn(9, 10, SHELL[0]);
  p.pxIn(5, 8, LICHEN[0]);
  if (!shut) {
    // just tucked in: the head still peeks out
    p.px(11, 9, SHELL[1]);
    p.px(11, 10, '#141018');
  }
}

function paintBugDizzy(p: PixelPainter, k: number): void {
  // on its back: pale segmented belly up, legs waving
  for (let i = 0; i < 6; i++) {
    const x = 5 + i * 2;
    const up = (i + k) % 2;
    p.line(x, 4, x + (up ? 1 : -1), 1 + up, LEG);
  }
  p.ellipse(9.5, 7.5, 8, 3.8, SHELL[1]);
  sphere(p, 9.5, 8.5, 8, 4.2, SHELL, false);
  p.ellipse(9.5, 5.6, 7, 1.8, UNDER[1]);
  for (let x = 4; x <= 15; x += 2) p.pxIn(x, 5, UNDER[0]);
  for (let x = 3; x <= 16; x += 2) p.pxIn(x, 6, UNDER[2]);
  // head lolling, a dazed eye
  p.ellipse(17, 7.5, 2, 1.6, SHELL[1]);
  p.px(18, 7, '#ffffff');
  p.px(18, 8, '#141018');
  p.line(18, 9, 19, 10, SHELL[0]);
}

const BO = { anchor: 'bottom' as const };
frames('pbug', 'crawl', 4, 20, 11, (p, i) => paintBugCrawl(p, i, false), { ...BO, fps: 9 });
frames('pbug', 'curl', 2, 15, 13, (p, i) => {
  if (i === 0) {
    // half curled: the dome rears up, the head tucks under
    p.ellipse(7, 7.5, 6.5, 5.5, SHELL[2]);
    sphere(p, 7, 7.5, 6.5, 5.5, SHELL, false);
    for (const sx of [4, 7, 10]) lineIn(p, sx, 2, sx + 1, 12, SHELL[0]);
    p.ellipse(12.5, 11, 2, 1.5, SHELL[1]);
    p.px(13, 11, '#141018');
    p.px(6, 4, LICHEN[1]);
  } else {
    paintBugBall(p, 0, false);
  }
}, { ...BO, fps: 8, loop: false });
frames('pbug', 'ball', 2, 13, 13, (p, i) => paintBugBall(p, i ? 0.08 : -0.08), { ...BO, fps: 14 });
frames('pbug', 'roll', 8, 13, 13, (p, i) => paintBugBall(p, (i / 8) * Math.PI), { ...BO, fps: 22 });
frames('pbug', 'dizzy', 2, 20, 11, (p, i) => paintBugDizzy(p, i), { ...BO, fps: 7 });
frames('pbug', 'hurt', 1, 20, 11, (p) => paintBugCrawl(p, 1, true), BO);

/** Clear rolling line to the target within CURL_SIGHT px? */
function rollLine(e: Enemy, w: World): boolean {
  const tg = e.target(w);
  const d = e.distToTarget(w);
  if (d > CURL_SIGHT || d < 20) return false;
  if (!w.room.lineOfSight(e.x, e.y, tg.x, tg.y)) return false;
  return rayFree(w.room, e.x, e.y, e.angleToTarget(w), e.r, d) >= d - 8;
}

function* curlAndRoll(e: Enemy, w: World): Script {
  e.halt();
  e.mem.curled = 1;
  e.mass = 4;
  e.setAnim('pbug_curl', true);
  w.sfx('hit_metal', { vol: 0.25, pitch: 1.6 });
  yield 0.25;
  e.setAnim('pbug_ball');
  // the path: one straight run and at most one ricochet, shown on the floor
  let a = e.angleToTarget(w);
  const path = bouncePath(w.room, e.x, e.y, a, e.r, 2, ROLL_DIST, 3);
  for (const s of path) {
    const d = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
    if (d > 3) laneWarning(w, s.x0, s.y0, s.angle, d + 6, 12, ROLL_WARN);
  }
  e.telegraph(ROLL_WARN);
  w.sfx('enemy_charge', { vol: 0.35, pitch: 1.4 });
  yield ROLL_WARN;
  // roll
  e.setAnim('pbug_roll');
  e.mem.rolling = 1;
  e.facing = Math.cos(a) >= 0 ? 1 : -1;
  e.accel = 3200;
  e.mem.__bumpX = 0;
  e.mem.__bumpY = 0;
  let bounces = 0;
  w.sfx('whoosh', { vol: 0.35, pitch: 0.8 });
  for (let el = 0; el < ROLL_DIST / ROLL_SPEED; el += w.dt) {
    if (e.mem.__bumpX || e.mem.__bumpY) {
      e.mem.__bumpX = 0;
      e.mem.__bumpY = 0;
      bounces++;
      e.squash(1.3, 0.75);
      dust(w, e.x, e.y + 2, DIRT, 6, 60);
      w.sfx('slam', { vol: 0.3, pitch: 1.5 });
      if (bounces > 1) break;
      a = reflectAngle(w.room, e.x, e.y, a, e.r, 3);
      // a clean ricochet: the ball leaves the wall at once (no slow turn-around into it)
      const v = Math.max(ROLL_SPEED * 0.5, Math.hypot(e.vx, e.vy));
      e.vx = Math.cos(a) * v;
      e.vy = Math.sin(a) * v;
      if (Math.abs(Math.cos(a)) > 0.2) e.facing = Math.cos(a) >= 0 ? 1 : -1;
    }
    e.moveAngle(a, ROLL_SPEED);
    yield;
  }
  e.accel = 900;
  e.halt();
  e.mem.rolling = 0;
  // flops over, dizzy: harmless and soft
  e.mem.curled = 0;
  e.mass = 1;
  e.mem.dizzy = 1;
  e.harmful = false;
  e.setAnim('pbug_dizzy');
  w.sfx('enemy_land', { vol: 0.4, pitch: 1.4 });
  yield DIZZY_TIME;
  e.mem.dizzy = 0;
  e.harmful = true;
  e.setAnim('pbug_crawl');
}

defineEnemy({
  id: 'pill_beetle',
  name: '공벌레',
  hp: 30,
  radius: 6,
  speed: 34,
  sprite: 'pbug_crawl',
  spriteYOffset: 3,
  shadow: 14,
  cost: 1.2,
  floors: [2],
  weight: 1,
  champion: true,
  deathFx: 'goo',
  bloodColor: '#8a98b0',
  hurtSfx: 'hit',
  light: { radius: 12, color: '#60e0c0' },
  init(e) {
    e.mem.h0 = -9;
    e.mem.h1 = -9;
    e.mem.h2 = -9;
    e.mem.curled = 0;
    e.mem.dizzy = 0;
    e.mem.rolling = 0;
    e.mem.wantCurl = 0;
  },
  *script(e, w) {
    yield w.rng.range(0.2, 0.6);
    let calm = w.rng.range(0.8, 1.4);
    while (true) {
      e.setAnim('pbug_crawl');
      for (let el = 0; ; el += w.dt) {
        e.chase(w, e.speed);
        if (e.mem.wantCurl || (el > calm && rollLine(e, w))) break;
        yield;
      }
      e.mem.wantCurl = 0;
      yield* curlAndRoll(e, w);
      calm = w.rng.range(1.4, 2.2);
    }
  },
  update(e, w) {
    if (e.mem.dizzy) dizzy(w, e);
    if (e.mem.rolling && fx.chance(0.4)) w.particles.spawn({ x: e.x + fx.range(-4, 4), y: e.y + 3, vy: -fx.range(2, 8), life: 0.3, colors: DIRT, size: 1 });
  },
  onHurt(e, w, hit) {
    if (hit.kind === 'status') return;
    const d = appliedDamage(hit, e.hasStatus('weak'), e.hasStatus('freeze'));
    if (e.mem.curled) {
      // the shell shrugs it off
      e.hp += d * (1 - CURL_TAKEN);
      e.squash(1, 1);
      e.kbx *= 0.3;
      e.kby *= 0.3;
      w.particles.burst(e.x, e.y - 4, { count: 4, speed: [40, 100], life: [0.1, 0.22], colors: ['#ffffff', '#c8d8f0', SHELL[3]], shape: 'spark', size: [1, 2] });
      w.sfx('hit_metal', { vol: 0.3, pitch: fx.range(1.3, 1.6) });
    } else if (e.mem.dizzy) {
      // belly up: soft
      e.hp -= d * (DIZZY_TAKEN - 1);
    } else {
      // three quick hits make it curl up
      e.mem.h2 = e.mem.h1;
      e.mem.h1 = e.mem.h0;
      e.mem.h0 = w.time;
      if (w.time - e.mem.h2 <= 1.5) e.mem.wantCurl = 1;
    }
  },
  draw(e, r, w) {
    // a curled ball does not flinch (the shell sparks instead)
    const frame = e.mem.curled ? e.frame() : hurtFrame(e, w, 'pbug_hurt_0');
    e.drawDefault(r, frame);
  },
  onDeath(e, w) {
    w.particles.burst(e.x, e.y - 3, {
      count: 10, speed: [30, 90], life: [0.3, 0.6], colors: [SHELL[3], SHELL[2], SHELL[1], LICHEN[1]], size: [1, 2], gravity: 300, vz: [30, 100], shape: 'square', vrot: 8,
    });
  },
});
