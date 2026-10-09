// Floor 4 — 얼어붙은 성소 (frozen sanctum), the procession:
//  - 얼음 순례자 (ice pilgrim): pilgrims frozen in mid-pilgrimage still walk the sanctum in
//    a PROCESSION of four. The one in front carries the rose-window standard and leads the
//    line around the keeper in a wide, slow arc; the others follow in its footsteps, one
//    pace apart, so the whole line is a moving wall of bodies.
//    The leader halts the line and the pilgrims raise their candles one after another,
//    front to back (each candle flares for a moment — the telegraph); each then casts a
//    rose candle-flame out of BOTH sides of the line, square to it. The volley ripples
//    down the line; the inner flames close in on the keeper the line is circling.
//    Cut the line and it splits: the pilgrim behind the gap raises a standard of its own
//    and leads the rear half (sooner to chant, zealous). Kill the leader and the next in
//    line takes over. A pilgrim left too far behind (stuck on a rock) walks on alone.
//    In a vault raid only the standard bearer strikes the vault; whoever takes up the
//    standard takes up the raid. Its timers run on enemy time (a time stop holds the chant).
// Pure helpers (`lineNormals`, `followSpeed`, `orbitGoal`) are unit-tested in
// tests/enemies-extra-f4.test.ts.

import { defineEnemy } from '../../game/defs';
import { PixelPainter } from '../../engine/painter';
import { animFrame, defineDrawnSprite, hasSprite } from '../../engine/sprites';
import { RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { clamp, rotateToward } from '../../engine/math';
import { fanAngles } from '../../game/projectile';
import type { Enemy, ShootOpts } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { BUL, frames, gather, rayFree, sphere } from './shared';
import { ROSE } from './sanctum';

const NAME = '얼음 순례자';
export const PILGRIM_ID = 'ice_pilgrim';
/** pilgrims in a freshly spawned procession (the leader included) */
export const PROC_LEN = 4;
/** distance between neighbours in the line (px, centre to centre) */
export const PROC_GAP = 12;
/** a follower farther than this from the one ahead leaves the line and leads itself */
export const PROC_DETACH = 64;
/** how long each candle flares before it casts (s) */
export const CHANT_TELL = 0.5;
/** delay between neighbouring candles, front to back (s) */
export const CHANT_STAGGER = 0.14;
/** the line holds still this long after the last cast (s) */
export const CHANT_REST = 0.35;
/** candle-flame speed / range */
export const FLAME_SPEED = 62;
export const FLAME_RANGE = 250;
/** radius of the arc the leader walks around the keeper, and its turn rate (rad/s) */
export const ORBIT_R = 80;
export const LEAD_TURN = 1.9;
/** the leader only halts to chant with the keeper this close */
export const CHANT_REACH = 190;
/** a detour the leader picks around a rock is held this long (s) */
export const DETOUR_HOLD = 0.4;

// ------------------------------------------------------------------ pure helpers
/**
 * Firing directions for each point of a line given front first: a normal (square to
 * the walking direction) at every point; the other side is that + π. The walking
 * direction at a point runs from the next point toward the previous one; the front
 * uses `heading` when the line has one point.
 */
export function lineNormals(pts: { x: number; y: number }[], heading = 0): number[] {
  const n = pts.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const t = n < 2 || (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) ? heading : Math.atan2(dy, dx);
    out.push(t + Math.PI / 2);
  }
  return out;
}

/** How fast a follower `d` px behind the one ahead walks: 0 inside the gap, catching up beyond it. */
export function followSpeed(d: number, gap: number, max: number): number {
  return clamp((d - gap) * 5, 0, max);
}

/** The point the leader heads for: on an ellipse of radius `r` around (tx, ty), a step around it on `side`. */
export function orbitGoal(ex: number, ey: number, tx: number, ty: number, r: number, side: number): { x: number; y: number } {
  const a = Math.atan2(ey - ty, ex - tx) + side * 0.75;
  return { x: tx + Math.cos(a) * r, y: ty + Math.sin(a) * r * 0.85 };
}

// ------------------------------------------------------------------ palette
/** Brown pilgrim's habit, darkest first (warm: it stands out on the blue sanctum floor). */
const HABIT = ['#26140e', '#45271a', '#6a3f27', '#935f39', '#bd8a58'];
const HOOD_IN = '#0e0610';
const ROPE = ['#8a6a3e', '#e0c896'];
const WAX = ['#a49ab8', '#e4e0ee', '#ffffff'];
const GOLD = ['#6a4410', '#b07a20', '#e8b848', '#fff0a8'];
const GLASS = ['#2856e8', '#6cc4f4'];
const SNOWCAP = ['#a8d0ec', '#e2f4ff', '#ffffff'];
const HAND = ['#8aa4c4', '#cfe0f0'];
const OUT = '#120a14';

type Mode = 'walk' | 'idle' | 'chant' | 'hurt';

/** Candle flame with its tip at (x, y): a small flickering tongue, or a flare when chanting. */
function flamePx(p: PixelPainter, x: number, y: number, k: number, big: boolean): void {
  if (big) {
    p.px(x, y - 1, k ? '#ffffff' : ROSE.hot);
    p.px(x, y, '#ffffff');
    p.px(x + 1, y, ROSE.hot);
    p.px(x - 1, y + 1, ROSE.mid);
    p.px(x, y + 1, '#ffffff');
    p.px(x + 1, y + 1, ROSE.hot);
    p.px(x + 2, y + 1, ROSE.mid);
    p.px(x - 1, y + 2, ROSE.low);
    p.px(x, y + 2, ROSE.mid);
    p.px(x + 1, y + 2, ROSE.mid);
    p.px(x + 2, y + 2, ROSE.low);
    if (k) {
      p.px(x - 2, y, ROSE.mid);
      p.px(x + 3, y, ROSE.mid);
      p.px(x + 1, y - 2, ROSE.hot);
    }
    return;
  }
  p.px(x + (k % 2), y, ROSE.hot);
  p.px(x, y + 1, '#ffffff');
  p.px(x + 1, y + 1, ROSE.mid);
  p.px(x, y + 2, ROSE.mid);
  p.px(x + 1, y + 2, ROSE.low);
}

/**
 * One pilgrim on a 15x24 canvas, facing right, feet on the bottom row: a brown habit with a
 * rope belt, a deep snow-capped cowl hiding all but two cold pinpoints, a candle held at
 * the waist. `lead` carries the rose-window standard instead of a candle.
 */
function paintPilgrim(p: PixelPainter, k: number, mode: Mode, lead: boolean): void {
  const walk = mode === 'walk';
  const chant = mode === 'chant';
  const hurt = mode === 'hurt';
  const bob = walk ? [0, -1, 0, -1][k] : 0;
  const sway = walk ? [0, 1, 0, -1][k] : 0;
  const H = HABIT;
  const G = 23; // ground row
  // feet (shuffling under the hem)
  const fa = walk ? [0, 1, 0, -1][k] : 0;
  p.rect(3 + fa, G - 1, 2, 2, H[0]);
  p.rect(7 - fa, G - 1, 3, 2, H[0]);
  p.px(3 + fa, G - 1, H[1]);
  // habit: a narrow column flaring into a heavy, snow-caked hem
  const top = 13 + bob;
  const bot = G - 2;
  for (let y = top; y <= bot; y++) {
    const t = (y - top) / Math.max(1, bot - top);
    const s = y >= bot - 2 ? sway : 0;
    const x0 = Math.round(3.2 - t * 2.2) + s;
    const x1 = Math.round(8.8 + t * 2.0) + s;
    for (let x = x0; x <= x1; x++) {
      const u = (x - x0) / Math.max(1, x1 - x0);
      p.px(x, y, x === x0 ? H[3] : u < 0.4 ? H[3] : u < 0.72 ? H[2] : x === x1 ? H[0] : H[1]);
    }
    if (y === bot) for (let x = x0; x <= x1; x++) if ((x + k) % 4 !== 2) p.px(x, y, (x + k) % 4 === 0 ? SNOWCAP[2] : SNOWCAP[1]);
  }
  // folds running down the habit
  p.line(4, top + 5, 3 + sway, bot - 1, H[4]);
  p.line(7, top + 5, 7 + sway, bot - 1, H[1]);
  // rope belt: a pale cord with a knotted end
  const by = top + 3;
  p.line(3, by, 9, by, ROPE[0]);
  p.line(3, by, 5, by, ROPE[1]);
  p.px(8, by + 1, ROPE[1]);
  p.px(8, by + 2, ROPE[0]);
  p.px(8, by + 3, ROPE[1]);
  // cowl: round, its point falling back over the shoulders, a cap of snow on top
  const hx = hurt ? 5 : 6;
  const hy = 9.5 + bob + (hurt ? 1 : 0) - (chant ? 1 : 0);
  p.poly([hx - 3.6, hy - 0.5, hx - 4.8, hy + 2.5, hx - 3, hy + 4.5, hx, hy + 3.5], H[2]);
  p.circle(hx, hy, 3.7, H[3]);
  sphere(p, hx, hy, 3.7, 3.8, H, false);
  p.px(hx - 4, Math.round(hy + 1), H[3]);
  p.px(hx - 4, Math.round(hy + 2), H[2]);
  const ty = Math.round(hy - 3.6);
  p.line(hx - 2, ty, hx + 1, ty, SNOWCAP[2]);
  p.px(hx - 3, ty + 1, SNOWCAP[1]);
  p.px(hx - 2, ty + 1, SNOWCAP[2]);
  p.px(hx - 1, ty + 1, SNOWCAP[1]);
  p.px(hx + 2, ty, SNOWCAP[1]);
  p.px(hx - 4, ty + 2, SNOWCAP[0]);
  // snow on the shoulders
  p.px(3, top, SNOWCAP[1]);
  p.px(4, top, SNOWCAP[2]);
  p.px(8, top, SNOWCAP[0]);
  // the face, lost in the cowl: two cold pinpoints
  const fy = Math.round(hy) + (chant ? -1 : 0);
  p.ellipse(hx + 2.1, fy + 0.8, 1.8, 2.1, HOOD_IN);
  p.px(hx + 1, fy - 1, H[1]);
  if (hurt) {
    p.px(hx + 1, fy + 1, '#3a5070');
    p.px(hx + 3, fy + 1, '#3a5070');
  } else {
    const eye = chant ? '#ffffff' : '#8ce8ff';
    p.px(hx + 1, fy + 1, eye);
    p.px(hx + 3, fy + 1, eye);
  }
  // sleeve reaching forward
  const arm = (x1: number, y1: number) => {
    p.poly([7, top + 0.5, 9, top + 0.5, x1 + 0.5, y1 - 0.5, x1 - 1, y1 + 1.5, 7, top + 3], H[2]);
    p.line(8, top + 1, x1 - 1, y1 - 1, H[3]);
  };
  if (lead) {
    // the rose-window standard: gold pole, round stained-glass head, two ribbons
    const lift = chant ? 3 : hurt ? -1 : 0;
    const px = 12;
    const ry = 4 - lift + bob; // rosette centre
    p.rect(px, ry + 3, 1, G - (ry + 3), GOLD[1]);
    p.line(px, ry + 3, px, ry + 9, GOLD[2]);
    p.px(px, G - 1, GOLD[0]);
    p.circle(px, ry, 2.8, GOLD[1]);
    p.px(px - 2, ry - 2, GOLD[3]);
    p.px(px - 1, ry - 3, GOLD[2]);
    p.circle(px, ry, 1.9, GLASS[0]);
    p.px(px - 1, ry - 1, ROSE.mid);
    p.px(px + 1, ry + 1, ROSE.mid);
    p.px(px + 1, ry - 1, GLASS[1]);
    p.px(px - 1, ry + 1, GLASS[1]);
    p.px(px, ry, chant ? '#ffffff' : ROSE.hot);
    if (chant) {
      // the glass blazes
      p.px(px, ry - 4, k ? '#ffffff' : ROSE.hot);
      p.px(px - 4, ry, ROSE.hot);
      p.px(px + 2, ry - 3, '#ffffff');
      p.px(px - 3, ry - 3, k ? ROSE.hot : '#ffffff');
      p.px(px - 1, ry, ROSE.hot);
      p.px(px + 1, ry, ROSE.hot);
      p.px(px, ry - 1, '#ffffff');
      p.px(px, ry + 1, '#ffffff');
    }
    // ribbons hanging from the head, streaming back as it walks
    const rb = walk ? [0, 1, 1, 0][k] : chant ? 1 : 0;
    p.line(px - 2, ry + 3, px - 2 - rb, ry + 7, ROSE.mid);
    p.px(px - 2 - rb, ry + 8, ROSE.low);
    p.line(px + 2, ry + 3, px + 2, ry + 5 + (k % 2), ROSE.low);
    // both hands on the pole
    const gy = chant ? top - 2 : top + 2;
    arm(px - 1, gy);
    p.px(px - 1, gy, HAND[1]);
    p.px(px + 1, gy + 1, HAND[0]);
  } else if (chant) {
    // the candle lifted high (clear of the face), its flame flaring
    const ch = Math.floor(hy);
    arm(11, ch + 1);
    p.rect(11, ch - 3, 2, 3, WAX[1]);
    p.px(11, ch - 3, WAX[2]);
    p.px(12, ch - 1, WAX[0]);
    p.rect(10, ch, 4, 1, GOLD[2]);
    p.px(13, ch, GOLD[1]);
    p.px(11, ch + 1, HAND[1]);
    flamePx(p, 11, ch - 6, k, true);
  } else {
    // a candle carried at the waist
    const cy = top + 3;
    arm(10, cy);
    p.rect(11, cy - 3, 2, 3, WAX[1]);
    p.px(11, cy - 3, WAX[2]);
    p.px(12, cy - 1, WAX[0]);
    p.rect(10, cy, 4, 1, GOLD[2]);
    p.px(13, cy, GOLD[1]);
    p.px(10, cy + 1, HAND[1]);
    if (!hurt) flamePx(p, 11, cy - 6, k, false);
    else p.px(11, cy - 5, '#6a6080');
  }
}

// the leader's frames share the pilgrim's states (`ipleader_*` mirrors `ipilgrim_*`)
const OPTS = { anchor: 'bottom' as const, outline: OUT };
for (const lead of [false, true]) {
  const pre = lead ? 'ipleader' : 'ipilgrim';
  frames(pre, 'walk', 4, 15, 24, (p, i) => paintPilgrim(p, i, 'walk', lead), { ...OPTS, fps: 6 });
  frames(pre, 'idle', 2, 15, 24, (p, i) => paintPilgrim(p, i, 'idle', lead), { ...OPTS, fps: 3 });
  frames(pre, 'chant', 2, 15, 24, (p, i) => paintPilgrim(p, i, 'chant', lead), { ...OPTS, fps: 10 });
  frames(pre, 'hurt', 1, 15, 24, (p) => paintPilgrim(p, 0, 'hurt', lead), OPTS);
}

// ------------------------------------------------------------------ candle-flame bullet
/** Rose candle flame flying head first (points right): bright core, rose body, dark rim. */
export function candleFlameSprite(): string {
  const name = '__eflame_hymn_9';
  if (hasSprite(name)) return name;
  const pal = BUL.hymn;
  defineDrawnSprite(name, 9, 7, (p) => {
    p.poly([0, 3.5, 4.5, 0.5, 6, 0.5, 6, 6.5, 4.5, 6.5], pal.rim);
    p.circle(5.5, 3.5, 3, pal.rim);
    p.poly([1.5, 3.5, 4.5, 1.6, 4.5, 5.4], pal.color);
    p.circle(5.5, 3.5, 2.1, pal.color);
    p.circle(6, 3.5, 1.2, pal.core);
    p.px(6, 3, '#ffffff');
    p.px(7, 3, '#ffffff');
  }, { outline: pal.outline });
  return name;
}
const FLAME = candleFlameSprite();

/** Shoot options for a candle flame (collision radius 3, flies head first). */
function flame<T extends ShootOpts>(extra: T): ShootOpts & T {
  return { color: BUL.hymn.color, sprite: FLAME, spriteRotates: true, radius: 3, light: 18, ...extra };
}

// ------------------------------------------------------------------ the line
let buildingLine = false;

/** This step's enemy time: a time stop / slow (w.enemyTimeScale) holds the chant and the march too. */
function edt(w: World): number {
  return w.dt * w.enemyTimeScale;
}

function alive(x: Enemy | null | undefined): x is Enemy {
  return !!x && !x.dead && x.alive;
}

/** The pilgrim ahead of `e` in its line, if it still walks. */
function ahead(e: Enemy): Enemy | null {
  const p = e.mem.prev as Enemy | null | undefined;
  return alive(p) ? p : null;
}

/** The line led by `e`: `e` first, then everyone following it. */
export function procession(e: Enemy): Enemy[] {
  const out = [e];
  let c = e;
  for (let guard = 0; guard < 16; guard++) {
    const n = c.mem.next as Enemy | null | undefined;
    if (!alive(n) || n.mem.prev !== c) break;
    out.push(n);
    c = n;
  }
  return out;
}

/** `e` leads (on its own, or the rear of a cut line). */
function promote(e: Enemy, w: World, announce: boolean): void {
  const prev = e.mem.prev as Enemy | null | undefined;
  if (prev && prev.mem.next === e) prev.mem.next = null;
  e.mem.prev = null;
  e.mem.lead = 1;
  const tg = e.target(w);
  e.mem.side = w.rng.sign();
  const g = orbitGoal(e.x, e.y, tg.x, tg.y, ORBIT_R, e.mem.side);
  e.mem.heading = Math.atan2(g.y - e.y, g.x - e.x);
  // zealous: the new leader chants sooner
  e.mem.march = w.rng.range(0.9, 1.3);
  if (!announce) return;
  w.particles.burst(e.x + e.facing * 6, e.y - 18, { count: 10, speed: [20, 60], life: [0.3, 0.6], colors: ['#ffffff', ROSE.hot, ROSE.mid, GOLD[2]], size: [1, 2], additive: true });
  w.spawn(new RingFx(e.x, e.y - 8, 12, 0.3, ROSE.hot, 1));
  w.sfx('summon', { vol: 0.3, pitch: 1.6, x: e.x });
}

/** The leader halts the line and hands every pilgrim its moment to chant. */
function startChant(e: Enemy, w: World): void {
  const line = procession(e);
  const normals = lineNormals(line.map((s) => ({ x: s.x, y: s.y })), e.mem.heading ?? 0);
  const n = line.length;
  line.forEach((s, i) => {
    s.halt();
    s.setAnim('ipilgrim_idle');
    s.mem.chant = 1;
    s.mem.told = 0;
    s.mem.tell = i * CHANT_STAGGER;
    s.mem.fire = i * CHANT_STAGGER + CHANT_TELL;
    s.mem.restAfter = (n - 1 - i) * CHANT_STAGGER + CHANT_REST;
    s.mem.face = normals[i];
    s.mem.dense = e.champion ? 1 : 0;
    s.mem.tick = w.time;
  });
  w.sfx('beam_charge', { vol: 0.3, pitch: 1.9, x: e.x });
}

/** One step of a pilgrim's part in a chant; true while it holds still for it. */
function chantTick(e: Enemy, w: World): boolean {
  if (!e.mem.chant) return false;
  e.stop();
  // frozen / stunned mid-chant: the warning starts over before it may cast
  if (w.time - (e.mem.tick ?? w.time) > 0.1 && e.mem.told) {
    e.mem.tell = 0;
    e.mem.fire = CHANT_TELL;
    e.mem.told = 0;
  }
  e.mem.tick = w.time;
  const dt = edt(w);
  e.mem.tell -= dt;
  e.mem.fire -= dt;
  if (!e.mem.told && e.mem.tell <= 0) {
    e.mem.told = 1;
    e.mem.fire = Math.max(e.mem.fire, 0.3);
    e.telegraph(e.mem.fire);
    e.setAnim('ipilgrim_chant', true);
    gather(w, e.x + e.facing * 4, e.y - 18, ['#ffffff', ROSE.hot, ROSE.mid], 5, 9);
    w.sfx('orb', { vol: 0.18, pitch: 1.7 + (e.id % 4) * 0.08, x: e.x });
  }
  if (e.mem.told && e.mem.fire <= 0) {
    castFlames(e, w);
    e.mem.chant = 0;
    e.mem.told = 0;
    e.mem.rest = e.mem.restAfter ?? CHANT_REST;
  }
  return true;
}

/** Cast a candle flame out of both sides of the line (two each for a champion's line). */
function castFlames(e: Enemy, w: World): void {
  const n = e.mem.dense ? 2 : 1;
  for (const side of [0, Math.PI]) {
    for (const a of fanAngles(e.mem.face + side, n, 0.22)) {
      e.shoot(w, a, flame({ speed: FLAME_SPEED, z: 9, range: FLAME_RANGE }));
    }
  }
  w.sfx('fire', { vol: 0.22, pitch: 1.7, x: e.x });
  w.particles.burst(e.x + e.facing * 4, e.y - 17, { count: 6, speed: [15, 45], life: [0.2, 0.4], colors: ['#ffffff', ROSE.hot, ROSE.mid], size: [1, 1], additive: true });
}

/** Leader: walk the arc around the keeper (turning smoothly, steering around rocks). */
function leadStep(e: Enemy, w: World): void {
  const tg = e.target(w);
  const d = Math.hypot(tg.x - e.x, tg.y - e.y);
  let want: number;
  if (d > 170) {
    const f = !e.flying && tg === w.player ? w.flow.dirAt(e.x, e.y) : null;
    want = f ? Math.atan2(f.y, f.x) : Math.atan2(tg.y - e.y, tg.x - e.x);
  } else {
    const g = orbitGoal(e.x, e.y, tg.x, tg.y, ORBIT_R, e.mem.side);
    want = Math.atan2(g.y - e.y, g.x - e.x);
  }
  let turn = LEAD_TURN;
  const dt = edt(w);
  // a detour around a rock is held for a moment (re-aiming every step at the arc made the
  // leader dither against a rock corner, half in and half out of the open lane)
  if (e.mem.detourT > 0) {
    e.mem.detourT -= dt;
    if (rayFree(w.room, e.x, e.y, e.mem.detour, e.r, 14) < 8) e.mem.detourT = 0;
    else {
      want = e.mem.detour;
      turn = LEAD_TURN * 3;
    }
  }
  // a rock or wall ahead: swing toward open floor
  if (!(e.mem.detourT > 0) && rayFree(w.room, e.x, e.y, e.mem.heading, e.r, 14) < 12) {
    for (let k = 1; k <= 5; k++) {
      const s = (k % 2 ? 1 : -1) * e.mem.side * Math.ceil(k / 2) * 0.55;
      if (rayFree(w.room, e.x, e.y, e.mem.heading + s, e.r, 14) >= 12) {
        want = e.mem.heading + s;
        e.mem.detour = want;
        e.mem.detourT = DETOUR_HOLD;
        break;
      }
    }
    turn = LEAD_TURN * 3;
  }
  e.mem.heading = rotateToward(e.mem.heading, want, turn * dt);
  e.moveAngle(e.mem.heading, e.speed);
  if (e.mem.__bumped) {
    e.mem.bumps = (e.mem.bumps ?? 0) + 1;
    if (e.mem.bumps > 24) {
      e.mem.side = -e.mem.side;
      e.mem.bumps = 0;
    }
  } else if (e.mem.bumps > 0) e.mem.bumps--;
}

defineEnemy({
  id: PILGRIM_ID,
  name: NAME,
  hp: 20,
  radius: 5,
  speed: 32,
  mass: 1.4,
  sprite: 'ipilgrim_walk',
  spriteYOffset: 4,
  shadow: 11,
  cost: 4,
  floors: [4],
  weight: 0.5,
  champion: true,
  deathFx: 'ice',
  bloodColor: '#cbb8c0',
  dieSfx: 'freeze',
  light: { radius: 18, color: '#ff8ab0' },
  init(e, w) {
    e.mem.prev = null;
    e.mem.next = null;
    e.mem.lead = 1;
    e.mem.chant = 0;
    e.mem.rest = 0;
    if (buildingLine) {
      e.mem.lead = 0;
      return;
    }
    // the room spawned a leader: its procession files in behind it
    const tg = e.target(w);
    e.mem.side = w.rng.sign();
    const g = orbitGoal(e.x, e.y, tg.x, tg.y, ORBIT_R, e.mem.side);
    e.mem.heading = Math.atan2(g.y - e.y, g.x - e.x);
    e.mem.march = w.rng.range(1.4, 2.2);
    buildingLine = true;
    try {
      let prev = e;
      const back = e.mem.heading + Math.PI;
      for (let i = 1; i < PROC_LEN; i++) {
        const m = e.summon(w, PILGRIM_ID, prev.x + Math.cos(back) * PROC_GAP, prev.y + Math.sin(back) * PROC_GAP);
        if (!m) break;
        m.dormant = e.dormant;
        m.facing = Math.cos(e.mem.heading) >= 0 ? 1 : -1;
        m.mem.prev = prev;
        prev.mem.next = m;
        prev = m;
      }
    } finally {
      buildingLine = false;
    }
    e.facing = Math.cos(e.mem.heading) >= 0 ? 1 : -1;
  },
  *script(e, w) {
    while (true) {
      // a follower whose pilgrim ahead fell, or who fell too far behind, leads on its own
      if (e.mem.prev) {
        const was = e.mem.prev as Enemy;
        const p = ahead(e);
        if (!p) promote(e, w, true);
        else if (Math.hypot(p.x - e.x, p.y - e.y) > PROC_DETACH) promote(e, w, false);
        // a besieging line (vault encounters): the new standard bearer takes up the raid; the room drives it
        if (!e.mem.prev && was.mem.siege) e.mem.siege = was.mem.siege;
      }
      if (e.mem.siege) {
        e.mem.lead = 1;
        e.mem.chant = 0;
        e.mem.told = 0;
        yield;
        continue;
      }
      if (chantTick(e, w)) {
        yield;
        continue;
      }
      if (e.mem.rest > 0) {
        e.mem.rest -= edt(w);
        e.stop();
        if (e.mem.rest <= 0) e.setAnim('ipilgrim_walk');
        yield;
        continue;
      }
      const p = ahead(e);
      if (p) {
        e.mem.lead = 0;
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        const v = followSpeed(d, PROC_GAP, e.speed * 2.2);
        if (v > 0.5) {
          e.moveDir(p.x - e.x, p.y - e.y, v);
          e.setAnim('ipilgrim_walk');
        } else {
          e.stop();
          if (Math.hypot(p.vx, p.vy) < 4) e.setAnim('ipilgrim_idle');
        }
      } else {
        e.mem.lead = 1;
        e.setAnim('ipilgrim_walk');
        leadStep(e, w);
        e.mem.march -= edt(w);
        if (e.mem.march <= 0) {
          if (e.distToTarget(w) < CHANT_REACH) {
            startChant(e, w);
            e.mem.march = w.rng.range(2.6, 3.4);
          } else e.mem.march = 0.4;
        }
      }
      yield;
    }
  },
  update(e, w) {
    if (e.anim === 'ipilgrim_walk' && fx.chance(0.06)) {
      w.particles.spawn({ x: e.x - e.facing * 3 + fx.range(-2, 2), y: e.y + 3, vy: -fx.range(2, 6), vx: -e.facing * fx.range(2, 8), life: fx.range(0.3, 0.5), colors: ['#ffffff', '#d4f4ff'], size: 1 });
    }
    if (e.mem.told && fx.chance(0.4)) {
      w.particles.spawn({ x: e.x + e.facing * (e.mem.lead ? 6 : 4) + fx.range(-1, 1), y: e.y - 19 + fx.range(-1, 1), vy: -fx.range(8, 18), life: fx.range(0.2, 0.4), colors: ['#ffffff', ROSE.hot, ROSE.mid], size: 1, additive: true, light: 3 });
    }
  },
  draw(e, r, w) {
    const pre = e.mem.lead ? 'ipleader' : 'ipilgrim';
    const hurt = w.time - e.lastHurtAt < 0.24;
    // a vault raider is driven by the room (its script rests): walk, stand, or raise the candle / standard for a blow
    const anim = e.mem.siege ? (e.telegraphT > 0 ? 'ipilgrim_chant' : Math.hypot(e.vx, e.vy) > 4 ? 'ipilgrim_walk' : 'ipilgrim_idle') : e.anim;
    const frame = hurt ? `${pre}_hurt_0` : animFrame(anim.replace('ipilgrim', pre), e.animT);
    e.drawDefault(r, frame);
    // while its candle flares, the pilgrim shows where its flames will go: out of both sides of the line
    if (e.mem.told && !e.hidden) {
      const blink = Math.floor(e.telegraphT * 14) % 2 === 0 ? 1 : 0.55;
      for (const side of [0, Math.PI]) {
        const a = e.mem.face + side;
        const c = Math.cos(a);
        const s = Math.sin(a);
        // just outside the body (an ellipse around its middle: the body is taller than wide),
        // clear of the raised candle
        const cx = e.x + c * 14;
        const cy = e.y - 8 + s * 18;
        const bx = cx - c * 3;
        const by = cy - s * 3;
        // a small rose arrowhead pointing out of the line, dark-backed so it reads on ice
        for (const [col, wd, al] of [['#1e0410', 3, 0.8], [ROSE.mid, 1, 1]] as const) {
          r.pixelLine(bx - s * 3, by + c * 3, cx, cy, col, wd, al * blink);
          r.pixelLine(bx + s * 3, by - c * 3, cx, cy, col, wd, al * blink);
          r.pixelLine(bx, by, cx, cy, col, wd, al * blink);
        }
        r.pixelLine(cx, cy, cx, cy, '#ffffff', 1, blink);
      }
    }
  },
  onDeath(e, w) {
    // the procession's bond breaks: the gap shows for a moment
    const n = e.mem.next as Enemy | null | undefined;
    if (alive(n) && n.mem.prev === e) {
      for (let i = 0; i < 6; i++) {
        const t = i / 6;
        w.particles.spawn({
          x: e.x + (n.x - e.x) * t, y: e.y - 8 + (n.y - e.y) * t, vx: fx.range(-12, 12), vy: -fx.range(4, 16),
          life: fx.range(0.25, 0.45), colors: ['#ffffff', ROSE.hot], size: 1, additive: true,
        });
      }
    }
    w.particles.burst(e.x, e.y - 8, { count: 8, speed: [20, 70], life: [0.3, 0.6], colors: [HABIT[3], HABIT[2], SNOWCAP[1]], size: [1, 2], gravity: 260, vz: [20, 70] });
  },
});
