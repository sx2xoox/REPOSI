// Floor 2 — 포자 동굴 (spore caves): one more cave regular.
//  - 버섯개미 (fungus ant): a rust-red cave ant with a glowing purple mushroom growing from
//    its back. It scuttles in short stop-and-go bursts and keeps 70–120 px from the keeper
//    (slipping along walls rather than into corners). Every few seconds, when it can see the
//    keeper, it rears up (its cap glows) and drums the floor: mycelium runs under
//    the stones and a FAIRY RING of sprouts pops up around the keeper, pair by pair, open
//    only on the ant's side. Grown sprouts sting on touch (a soft fence you can thread or
//    dash through), and once the ring has closed every sprout puffs one spore at its middle.
//    Answers: walk out through the gap (toward the ant), thread the fence early, or stand
//    off-centre between the spore lines; rushing the ant during its wind-up stops the drum.
//    Killing the ant withers its ring at once, and a room's ants take turns: one ring at a
//    time. A time stop freezes a ring like any enemy shot.
// The slot layout (`ringSlots`) and the timing constants are unit-tested in
// tests/enemies-extra-f2.test.ts.

import { defineEnemy } from '../../game/defs';
import { Entity } from '../../game/entity';
import { GroundWarning, RingFx } from '../../game/effects';
import { Projectile } from '../../game/projectile';
import { PixelPainter, ramp } from '../../engine/painter';
import { fx } from '../../engine/rng';
import { TAU } from '../../engine/math';
import type { Renderer } from '../../engine/renderer';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Script } from '../../engine/script';
import { bullet, dust, frames, gather, hurtFrame, rayFree, sphere, WARN_RED } from './shared';
import { EnemyOverlay } from './crypt-toll';

const DIRT = ['#5a4636', '#3e2e24', '#7a604a'];

// ------------------------------------------------------------------ tuning
/** Radius of the fairy ring around the keeper, its slots and the gap left on the ant's side. */
export const RING_R = 40;
export const RING_SLOTS = 10;
export const RING_GAP = 2;
/** Rearing wind-up before the drum (the ring appears right after it). */
export const RING_WINDUP = 0.5;
/** One pair of sprouts pops up every SPROUT_STAGGER s; each grows (harmless) for SPROUT_GROW s. */
export const SPROUT_STAGGER = 0.07;
export const SPROUT_GROW = 0.45;
/** The closed ring inhales this long (sprouts glow) before the spores fly. */
export const PUFF_WARN = 0.35;
/** Ring age when the spores fly: the last pair is up, grown and has inhaled. */
export const PUFF_AT = SPROUT_STAGGER * (Math.ceil((RING_SLOTS - RING_GAP) / 2) - 1) + SPROUT_GROW + PUFF_WARN;
/** Champions puff a second time this much later. */
export const VOLLEY_GAP = 0.4;
/** Ring age when the fence withers. */
export const FENCE_END = PUFF_AT + 1.4;
export const WITHER = 0.3;
export const SPORE_SPEED = 66;
/** Sting reach of one sprout (plus part of the keeper's radius). */
export const SPROUT_HIT = 4;
/**
 * The ant drums only when the keeper is this far away (and in sight). CAST_MIN leaves room
 * between the ring's gap and the ant itself: walking out through the gap must not walk the
 * keeper into the ant's body.
 */
export const CAST_MIN = 64;
export const CAST_MAX = 150;
/** A keeper who rushes the ant during its wind-up and gets this close stops the drum (a dud). */
export const DRUM_MIN = RING_R + 18;
const KEEP_NEAR = 70;
const KEEP_FAR = 120;
/** A ring needs at least this many sprouts on open floor, or the ant does not bother. */
const MIN_SPROUTS = 4;

// ------------------------------------------------------------------ palette
/** Rust-red chitin, darkest first (a warm accent against the teal cave floor). */
const ANT = ramp('#b4502c', 5);
/** The mushroom it grows: the cave's spore purple with lime glow spots. */
const CAP = ramp('#8a3cb4', 5);
const STALK = ['#8a7e6c', '#c4b89e', '#e2d6c0', '#fff6e4'];
const GLOW = { lime: '#d6ff5a', pale: '#f4ffc8', hot: '#ffffff' };
const MYCEL = '#c8ff9a';

// ================================================================== slot layout
export interface RingSlot {
  x: number;
  y: number;
  a: number;
  /** signed offset from the gap's middle, in slots (neighbours differ by 1) */
  k: number;
}

/**
 * Sprout spots of a fairy ring of radius `r` around (cx, cy): `n` evenly spaced slots with
 * the `gap` slots facing (fromX, fromY) left out. Planting order: pairs from the gap's two
 * ends around to the far side (the ring closes opposite the ant).
 */
export function ringSlots(cx: number, cy: number, fromX: number, fromY: number, r = RING_R, n = RING_SLOTS, gap = RING_GAP): RingSlot[] {
  const a0 = Math.atan2(fromY - cy, fromX - cx);
  const step = TAU / n;
  const off = gap % 2 === 0 ? 0.5 : 0;
  const out: RingSlot[] = [];
  let skipped = 0;
  for (let d = off; d <= n / 2 + 1e-9; d += 1) {
    const single = d === 0 || Math.abs(d - n / 2) < 1e-9;
    for (const s of single ? [1] : [1, -1]) {
      if (skipped < gap) {
        skipped++;
        continue;
      }
      const a = a0 + s * d * step;
      out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, a, k: s * d });
    }
  }
  return out;
}

/** Slots on open floor (walls, rocks and pits close the ring by themselves). */
function openSlots(w: World, cx: number, cy: number, fromX: number, fromY: number): RingSlot[] {
  return ringSlots(cx, cy, fromX, fromY).filter((s) => w.room.isFree(s.x, s.y, 3));
}

/**
 * A walkable heading near `a` (probing a short step ahead), turning toward `side` first:
 * the ant slips along walls and out of corners instead of grinding into them.
 */
export function openHeading(e: Enemy, w: World, a: number, side: number): number {
  for (const k of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4]) {
    const b = a + k * side;
    if (w.room.isFree(e.x + Math.cos(b) * 18, e.y + Math.sin(b) * 18, e.r)) return b;
  }
  return a + (side * Math.PI) / 2;
}

// ================================================================== art: the ant
type AntMode = 'walk' | 'stand' | 'rear' | 'drum' | 'hurt';

/** Segment centres of one pose (the ant faces right on a 24x16 canvas, feet on row 15). */
interface AntPose {
  gx: number; gy: number;
  tx: number; ty: number;
  hx: number; hy: number;
  /** cap of the mushroom on its back: centre and radii */
  mx: number; my: number; mrx: number; mry: number;
}

function antPose(k: number, mode: AntMode): AntPose {
  switch (mode) {
    case 'rear':
      return { gx: 4, gy: 10, tx: 11.5, ty: 8.4, hx: 16.2, hy: 5.2, mx: 10.6, my: 2.2, mrx: 4.3, mry: 2.4 };
    case 'drum':
      return { gx: 4, gy: 8.6, tx: 12, ty: 9.4, hx: 17.4, hy: 10, mx: 11.8, my: 3.8, mrx: 4.8, mry: 1.9 };
    case 'hurt':
      return { gx: 4, gy: 9.6, tx: 12, ty: 9.8, hx: 17, hy: 9.4, mx: 11.4, my: 3.6, mrx: 4.2, mry: 2.1 };
    default: {
      // the gaster sways with the gait
      const sway = mode === 'walk' ? [0, -0.6, 0, -0.6][k] : 0;
      return { gx: 4, gy: 9 + sway, tx: 12, ty: 9, hx: 17.2, hy: 8, mx: 11.4, my: 2.8, mrx: 4.1, mry: 2.3 };
    }
  }
}

/**
 * Thin two-part insect leg: femur up-and-out to a high knee, tibia down to the foot. The far
 * legs show only their lower half behind the body (a full dark set reads as a tangled comb).
 */
function antLeg(p: PixelPainter, ax: number, ay: number, kx: number, ky: number, fx0: number, fy: number, near: boolean): void {
  if (!near) {
    p.line(kx, ky + 1, fx0, fy, ANT[1]);
    return;
  }
  p.line(ax, ay, kx, ky, ANT[2]);
  p.line(kx, ky, fx0, fy, ANT[2]);
  p.px(Math.round(fx0), Math.round(fy), ANT[1]);
  p.px(Math.round(kx), Math.round(ky), ANT[3]);
}

function paintAnt(p: PixelPainter, k: number, mode: AntMode): void {
  const o = antPose(k, mode);
  const rear = mode === 'rear';
  const drum = mode === 'drum';
  const hurt = mode === 'hurt';
  const lit = rear || drum;

  // ---- legs: near hind / mid / front leave the thorax, the far set is a dark echo
  // tripod gait: near hind + near front + far mid swing together, then the others
  const legs = (near: boolean) => {
    for (let j = 0; j < 3; j++) {
      const inA = near ? j !== 1 : j === 1;
      const ph = (k + (inA ? 0 : 2)) % 4;
      const sw = mode === 'walk' ? [1, 0, -1, 0][ph] : 0;
      const up = mode === 'walk' ? [0, 1, 0, 0][ph] : 0;
      const dx = near ? 0 : 1.5;
      const ax = o.tx - 1 + j;
      const ay = o.ty + 1;
      let leg: [number, number, number, number] = [
        [8.5, 11, 6, 15], [13, 11.2, 12, 15], [15.5, 10.6, 17.5, 15],
      ][j] as [number, number, number, number];
      leg = [leg[0] + sw * 0.5 + dx, leg[1] - up, leg[2] + sw + dx, leg[3] - up];
      if (rear && j === 2) leg = [15 + dx * 0.5, 7.5, 18.5 + dx * 0.5, 6 - (k ? 1 : 0)];
      if (rear && j === 1) leg = [13.5 + dx, 10.5, 14 + dx, 15];
      if (drum && j === 2) leg = [16 + dx * 0.5, 11, 19 + dx * 0.5, 15];
      if (drum && j === 0) leg = [8.5 + dx, 10.5, 5.5 + dx, 15];
      if (hurt) leg = [leg[0] - 0.5, leg[1] + 1, leg[2], 15];
      antLeg(p, ax, ay, leg[0], leg[1], leg[2], leg[3], near);
    }
  };
  legs(false);

  // ---- gaster: a glossy bulb with two dark seams, pointed tail at the back
  const grx = 4.2;
  const gry = 3.1;
  p.ellipse(o.gx, o.gy, grx, gry, ANT[2]);
  p.px(0, Math.round(o.gy + 0.6), ANT[2]);
  sphere(p, o.gx, o.gy, grx, gry, ANT, false);
  for (const sx of [2, 5]) {
    for (let y = Math.floor(o.gy - gry) + 1; y <= Math.floor(o.gy + gry); y++) p.pxIn(sx, y, ANT[1]);
  }
  p.pxIn(1, Math.round(o.gy - 1.5), ANT[4]);
  p.pxIn(3, Math.round(o.gy - 2.2), '#ffe8c4');
  p.pxIn(4, Math.round(o.gy - 2.2), ANT[4]);
  p.pxIn(6, Math.round(o.gy - 2), ANT[3]);

  // ---- petiole: the pinched waist (one knot, dark under it)
  const wy = Math.round(o.gy + (o.ty - o.gy) * 0.5 + 0.4);
  p.px(8, wy, ANT[2]);
  p.px(9, wy, ANT[1]);
  p.px(9, wy - 1, ANT[2]);

  // ---- stalk of the mushroom, rooted in the thorax
  const sx0 = Math.round(o.mx) - 1;
  const st = Math.round(o.my + o.mry - 0.4);
  const sb = Math.round(o.ty - 1);
  p.rect(sx0, st, 2, Math.max(1, sb - st + 1), STALK[2]);
  p.rect(sx0, st, 1, Math.max(1, sb - st + 1), STALK[3]);
  p.px(sx0 + 1, sb, STALK[1]);

  // ---- thorax: a short hump
  p.ellipse(o.tx, o.ty, 2.4, 1.9, ANT[2]);
  sphere(p, o.tx, o.ty, 2.4, 1.9, ANT, false);
  p.pxIn(Math.round(o.tx) - 1, Math.round(o.ty - 1.4), ANT[4]);

  // ---- neck (a dark pinch) + a big round head
  p.line(o.tx + 2, o.ty - 0.3, o.hx - 2.4, o.hy + 0.2, ANT[0]);
  p.circle(o.hx, o.hy, 2.7, ANT[2]);
  sphere(p, o.hx, o.hy, 2.7, 2.7, ANT, false);
  // compound eye: a 2x2 dark gem with a glint (white when hurt)
  const ex = Math.round(o.hx);
  const ey = Math.round(o.hy - 1);
  const eye = hurt ? '#ffffff' : '#1a0a10';
  p.px(ex, ey, eye);
  p.px(ex + 1, ey, eye);
  p.px(ex, ey - 1, eye);
  p.px(ex + 1, ey - 1, eye);
  if (!hurt) p.px(ex, ey - 1, '#ffffff');
  // mandibles (open while rearing / drumming)
  const mx0 = Math.round(o.hx + 2.6);
  const my0 = Math.round(o.hy + 1);
  p.px(mx0, my0, ANT[4]);
  p.px(mx0 + 1, my0 + (lit ? 1 : 0), ANT[3]);
  if (lit) {
    p.px(mx0, my0 - 1, ANT[3]);
    p.px(mx0 + 1, my0 - 2, ANT[4]);
  }

  // ---- antennae: elbowed; forward and twitching, raised when rearing, tapping when drumming
  const bx = Math.round(o.hx + 0.5);
  const by = Math.round(o.hy - 2.2);
  const ac = ANT[1];
  if (rear) {
    p.line(bx, by, bx + 1, by - 3, ac);
    p.line(bx + 1, by - 3, bx + 4, by - 4 + k, ac);
    p.px(bx + 4, by - 4 + k, ANT[3]);
  } else if (drum) {
    p.line(bx, by, bx + 2, by - 2, ac);
    p.line(bx + 2, by - 2, bx + 4, 15 - (k ? 0 : 1), ac);
    p.px(bx + 4, 15 - (k ? 0 : 1), ANT[3]);
  } else if (hurt) {
    p.line(bx, by, bx - 1, by - 2, ac);
    p.line(bx - 1, by - 2, bx - 3, by - 2, ac);
  } else {
    const tw = mode === 'stand' ? k : (k >> 1) & 1;
    p.line(bx, by, bx + 1, by - 3, ac);
    p.line(bx + 1, by - 3, bx + 4, by - 2 + tw, ac);
    p.px(bx + 4, by - 2 + tw, ANT[3]);
  }

  legs(true);

  // ---- the cap (drawn last: the silhouette's top), glowing when about to drum
  p.ellipse(o.mx, o.my, o.mrx, o.mry, CAP[2]);
  sphere(p, o.mx, o.my - 0.3, o.mrx, o.mry, CAP, false);
  const gl = Math.round(o.my + o.mry - 0.6);
  for (let x = Math.round(o.mx - o.mrx + 1); x <= Math.round(o.mx + o.mrx - 1); x++) p.pxIn(x, gl, CAP[0]);
  p.pxIn(Math.round(o.mx), gl, lit ? GLOW.lime : CAP[1]);
  const hot = lit ? (k ? GLOW.hot : GLOW.pale) : GLOW.lime;
  p.pxIn(Math.round(o.mx - o.mrx * 0.55), Math.round(o.my - 0.1), GLOW.lime);
  p.pxIn(Math.round(o.mx + o.mrx * 0.4), Math.round(o.my - o.mry * 0.55), GLOW.lime);
  p.pxIn(Math.round(o.mx + o.mrx * 0.8), Math.round(o.my + 0.3), GLOW.lime);
  p.pxIn(Math.round(o.mx - o.mrx * 0.1), Math.round(o.my - o.mry * 0.8), hot);
  if (lit) {
    p.pxIn(Math.round(o.mx - o.mrx * 0.55) + 1, Math.round(o.my - 0.1), hot);
    p.pxIn(Math.round(o.mx + o.mrx * 0.4) - 1, Math.round(o.my - o.mry * 0.55), GLOW.pale);
  }
}

const AO = { origin: [10, 15] as [number, number] };
frames('fant', 'idle', 2, 24, 16, (p, i) => paintAnt(p, i, 'stand'), { ...AO, fps: 3 });
frames('fant', 'run', 4, 24, 16, (p, i) => paintAnt(p, i, 'walk'), { ...AO, fps: 14 });
frames('fant', 'rear', 2, 24, 16, (p, i) => paintAnt(p, i, 'rear'), { ...AO, fps: 10 });
frames('fant', 'drum', 2, 24, 16, (p, i) => paintAnt(p, i, 'drum'), { ...AO, fps: 8, loop: false });
frames('fant', 'hurt', 1, 24, 16, (p) => paintAnt(p, 0, 'hurt'), AO);

// ================================================================== art: the sprouts
type SproutMode = 'grow' | 'idle' | 'puff' | 'wither';

/** A small spore-cap mushroom on a 9x11 canvas (base on row 10). */
function paintSprout(p: PixelPainter, k: number, mode: SproutMode): void {
  // a crumb of disturbed earth around the foot
  p.ellipse(4.5, 10.2, 3.6, 0.9, DIRT[1]);
  p.px(1, 10, DIRT[2]);
  p.px(7, 10, DIRT[0]);
  if (mode === 'grow' && k === 0) {
    // the nub breaking the soil
    p.rect(4, 8, 2, 2, STALK[2]);
    p.px(4, 8, STALK[3]);
    p.px(4, 7, CAP[3]);
    p.px(5, 7, CAP[2]);
    p.px(5, 8, GLOW.lime);
    return;
  }
  const small = mode === 'grow' && k === 1;
  const wither = mode === 'wither';
  const puff = mode === 'puff';
  // stalk
  const top = small ? 7 : wither ? 6 : 5;
  p.rect(3, top, 3, 10 - top, STALK[2]);
  p.rect(3, top, 1, 10 - top, STALK[3]);
  p.rect(5, top, 1, 10 - top, STALK[1]);
  // cap
  const ccx = 4.5 + (wither ? 0.8 : 0);
  const ccy = small ? 6.2 : wither ? 5.6 : puff ? 4.4 : 4;
  const rx = small ? 2.6 : puff ? 4.5 : wither ? 3.6 : 4.2;
  const ry = small ? 1.6 : puff ? 2 : wither ? 2 : 2.7;
  const pal = wither ? ['#3a1e44', '#56306a', '#6e4a7e', '#8a6a92', '#a088a8'] : CAP;
  p.ellipse(ccx, ccy, rx, ry, pal[2]);
  sphere(p, ccx, ccy - 0.3, rx, ry, pal, false);
  // gill rim
  const gl = Math.round(ccy + ry - 0.6);
  for (let x = Math.round(ccx - rx + 1); x <= Math.round(ccx + rx - 1); x++) p.pxIn(x, gl, pal[0]);
  if (wither) {
    // drooping: the far edge sags, the glow is out
    p.px(Math.round(ccx + rx), gl + 1, pal[1]);
    p.pxIn(Math.round(ccx - 1), Math.round(ccy - 0.5), '#8a9a5a');
    return;
  }
  const glow = puff || k === 1 ? GLOW.hot : GLOW.pale;
  p.pxIn(Math.round(ccx), gl, puff ? GLOW.hot : GLOW.lime);
  // spots
  p.pxIn(Math.round(ccx - rx * 0.55), Math.round(ccy - 0.2), GLOW.lime);
  if (!small) {
    p.pxIn(Math.round(ccx + rx * 0.4), Math.round(ccy - ry * 0.5), GLOW.lime);
    p.pxIn(Math.round(ccx + rx * 0.75), Math.round(ccy + 0.4), GLOW.lime);
    p.pxIn(Math.round(ccx - rx * 0.1), Math.round(ccy - ry * 0.75), glow);
  }
}

const SO = { origin: [4, 10] as [number, number] };
frames('fsprout', 'grow', 3, 9, 11, (p, i) => paintSprout(p, i, i < 2 ? 'grow' : 'idle'), { ...SO, fps: 3 / SPROUT_GROW, loop: false });
frames('fsprout', 'idle', 2, 9, 11, (p, i) => paintSprout(p, i, 'idle'), { ...SO, fps: 4 });
frames('fsprout', 'puff', 1, 9, 11, (p) => paintSprout(p, 0, 'puff'), SO);
frames('fsprout', 'wither', 1, 9, 11, (p) => paintSprout(p, 0, 'wither'), SO);

// ================================================================== the ring
type SproutState = 'grow' | 'armed' | 'wither';

/** One sprout of a fairy ring: harmless while growing, stings on touch once grown. */
export class RingSprout extends Entity {
  readonly ring: SporeRing;
  state: SproutState = 'grow';
  /** age when the state began */
  stateAt = 0;
  /** age of the last puff (drawing) */
  puffAt = -9;

  constructor(ring: SporeRing, x: number, y: number) {
    super();
    this.ring = ring;
    this.x = x;
    this.y = y;
    this.r = SPROUT_HIT;
    this.layer = 1;
    this.tileCollide = false;
    this.team = 'enemy';
    this.enemyHazard = true;
  }

  get armed(): boolean {
    return this.state === 'armed';
  }

  wither(): void {
    if (this.state === 'wither') return;
    this.state = 'wither';
    this.stateAt = this.age;
    this.enemyHazard = false;
  }

  /** Erased by a bullet-clear: it withers on the spot. */
  override onCleared(): void {
    this.wither();
  }

  /** Puff one spore at the ring's middle. */
  puff(w: World): void {
    if (!this.armed) return;
    const ring = this.ring;
    const d = Math.hypot(ring.cx - this.x, ring.cy - this.y);
    const a = Math.atan2(ring.cy - this.y, ring.cx - this.x);
    const pr = new Projectile({
      team: 'enemy', x: this.x, y: this.y, angle: a, speed: SPORE_SPEED, damage: 1, owner: ring.owner,
      ...bullet('toxic', 3, { z: 5, range: Math.max(4, d - 3) }),
    });
    pr.enemyDamageScale = ring.owner.enemyDamageScale;
    w.spawn(pr);
    this.puffAt = this.age;
    w.particles.burst(this.x, this.y - 6, { count: 5, speed: [10, 40], life: [0.3, 0.6], colors: [GLOW.pale, GLOW.lime, CAP[3]], size: [1, 2], drag: 2 });
  }

  override update(w: World, dt: number): void {
    // a time stop freezes the ring like any enemy shot
    this.age += dt * w.enemyTimeScale;
    if (this.state === 'grow' && this.age >= SPROUT_GROW) {
      this.state = 'armed';
      this.stateAt = this.age;
      w.particles.burst(this.x, this.y - 4, { count: 4, speed: [15, 40], life: [0.2, 0.4], colors: [GLOW.pale, GLOW.lime], size: [1, 1], additive: true, light: 4 });
    }
    if (this.state === 'wither') {
      if (this.age - this.stateAt >= WITHER) this.dead = true;
      return;
    }
    if (this.state !== 'armed') return;
    for (const p of w.targets()) {
      if (!p.alive || p.z > 4 || p.dashing) continue;
      const dx = p.x - this.x;
      const dy = p.y - this.y;
      const reach = SPROUT_HIT + p.r * 0.6;
      if (dx * dx + dy * dy >= reach * reach) continue;
      if (p.hurt(w, 1, this.ring.owner.def.name, false, this)) {
        const d = Math.hypot(dx, dy) || 1;
        p.knock(dx / d, dy / d, 120);
        w.particles.burst(this.x, this.y - 5, { count: 6, speed: [20, 60], life: [0.25, 0.45], colors: [GLOW.pale, GLOW.lime, CAP[2]], size: [1, 2], drag: 2 });
      }
    }
  }

  override draw(r: Renderer): void {
    let name: string;
    let alpha = 1;
    if (this.state === 'grow') name = `fsprout_grow_${Math.min(2, Math.floor((this.age / SPROUT_GROW) * 3))}`;
    else if (this.state === 'wither') {
      name = 'fsprout_wither_0';
      alpha = Math.max(0, 1 - (this.age - this.stateAt) / WITHER);
    } else if (this.age - this.puffAt < 0.18) name = 'fsprout_puff_0';
    else name = `fsprout_idle_${Math.floor(this.age * (this.ring.inhaling ? 14 : 4)) % 2}`;
    if (this.state === 'armed') {
      // the sting's reach: a faint lime ring on the floor around the stalk
      r.pixelRing(this.x, this.y, SPROUT_HIT + 2, GLOW.lime, 1, 0.22 + 0.12 * Math.sin(this.age * 9));
    }
    r.shadow(this.x, this.y + 1, 7, 2.5, 0.3 * alpha);
    r.sprite(name, this.x, this.y, alpha < 1 ? { alpha } : undefined);
  }

  override light(w: World): void {
    if (this.state === 'wither') return;
    const k = this.state === 'grow' ? Math.min(1, this.age / SPROUT_GROW) : this.ring.inhaling ? 1.4 : 1;
    w.lights.add(this.x, this.y - 5, 14, '#b8ff4a', { intensity: 0.5 * k });
  }
}

/**
 * A fairy ring planted by a fungus ant around (cx, cy): pops its sprouts pair by pair, makes
 * them puff at PUFF_AT (twice for a champion), withers at FENCE_END. Draws the glowing
 * mycelium between the sprouts. Its ant dying (or a bullet-clear) withers it at once.
 */
export class SporeRing extends Entity {
  readonly owner: Enemy;
  readonly cx: number;
  readonly cy: number;
  readonly slots: RingSlot[];
  readonly volleys: number;
  readonly sprouts: (RingSprout | null)[];
  /** where the ant drummed (the mycelium's roots) */
  readonly rootX: number;
  readonly rootY: number;
  warning: GroundWarning | null = null;
  puffs = 0;
  ended = false;

  constructor(owner: Enemy, cx: number, cy: number, slots: RingSlot[], volleys: number, rootX: number, rootY: number) {
    super();
    this.owner = owner;
    this.x = this.cx = cx;
    this.y = this.cy = cy;
    this.slots = slots;
    this.volleys = volleys;
    this.sprouts = slots.map(() => null);
    this.rootX = rootX;
    this.rootY = rootY;
    this.layer = 0;
    this.tileCollide = false;
    this.enemyHazard = true;
  }

  /** The closed ring is about to puff (sprouts glow). */
  get inhaling(): boolean {
    return this.age >= PUFF_AT - PUFF_WARN && this.puffs < this.volleys && !this.ended;
  }

  /** Wither everything now (the ant died, a bullet-clear, or the fence is over). */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.enemyHazard = false;
    for (const s of this.sprouts) s?.wither();
    if (this.warning) this.warning.dead = true;
    this.owner.mem.ringing = 0;
  }

  override onCleared(): void {
    this.end();
  }

  override update(w: World, dt: number): void {
    // a time stop freezes the ring like any enemy shot (its floor warning waits with it)
    this.age += dt * w.enemyTimeScale;
    if (!this.ended && !this.owner.alive) this.end();
    if (this.ended) {
      if (this.sprouts.every((s) => !s || s.dead)) this.dead = true;
      return;
    }
    const wn = this.warning;
    if (wn && !wn.dead) wn.time = Math.max(wn.time, wn.age + PUFF_AT - this.age);
    // sprouts pop up in pairs, from the gap's ends around to the far side
    for (let i = 0; i < this.slots.length; i++) {
      if (this.sprouts[i] || this.age < Math.floor(i / 2) * SPROUT_STAGGER) continue;
      const s = this.slots[i];
      this.sprouts[i] = w.spawn(new RingSprout(this, s.x, s.y));
      dust(w, s.x, s.y + 1, DIRT, 3, 35);
      if (i % 2 === 0) w.sfx('enemy_spawn', { vol: 0.22, pitch: 1.7 + i * 0.04 });
    }
    // the spores fly
    if (this.puffs < this.volleys && this.age >= PUFF_AT + this.puffs * VOLLEY_GAP) {
      for (const s of this.sprouts) s?.puff(w);
      this.puffs++;
      w.sfx('poison', { vol: 0.45, pitch: 1.2 });
    }
    if (this.age >= FENCE_END) this.end();
  }

  override draw(r: Renderer): void {
    if (this.ended) return;
    const grow = Math.min(1, this.age / 0.3);
    // mycelium: a dotted glowing arc between neighbouring sprouts (never across the gap,
    // nor across a slot a wall or rock took)
    const n = this.slots.length;
    for (let i = 0; i < n; i++) {
      if (!this.sprouts[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!this.sprouts[j]) continue;
        const dk = Math.abs(this.slots[i].k - this.slots[j].k);
        // same-side neighbours, or the two far-side slots that close the ring
        if (Math.abs(dk - 1) < 1e-6 || Math.abs(dk - (RING_SLOTS - 1)) < 1e-6) this.arc(r, this.slots[i].a, this.slots[j].a, 0.38 * grow);
      }
    }
    // the roots back to where the ant drummed fade as the ring closes
    const rootA = Math.max(0, 1 - this.age / 0.9) * 0.45;
    if (rootA > 0) {
      for (let i = 0; i < Math.min(2, n); i++) r.pixelLine(this.rootX, this.rootY, this.slots[i].x, this.slots[i].y, MYCEL, 1, rootA);
    }
  }

  /** Dots along the ring between angles a0 and a1 (the shorter way round). */
  private arc(r: Renderer, a0: number, a1: number, alpha: number): void {
    let d = a1 - a0;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    const len = Math.abs(d) * RING_R;
    const steps = Math.max(2, Math.floor(len / 3));
    for (let k = 1; k < steps; k++) {
      const a = a0 + (d * k) / steps;
      const x = this.cx + Math.cos(a) * RING_R;
      const y = this.cy + Math.sin(a) * RING_R;
      r.rect(x, y, 1, 1, k % 2 ? MYCEL : '#f4ffd8', alpha * (k % 2 ? 1 : 0.7));
    }
  }
}

// ================================================================== 버섯개미 (fungus ant)
/** Is some fungus ant in this room already growing a ring? (a room's ants take turns) */
function ringBusy(w: World): boolean {
  for (const o of w.enemies) if (o.alive && o.def.id === 'fungus_ant' && o.mem.ringing) return true;
  return false;
}

/** Can the ant drum a ring around its keeper now? (in range, in sight, room for the ring, not charmed) */
function canRing(e: Enemy, w: World): boolean {
  const d = e.distToTarget(w);
  if (d < CAST_MIN || d > CAST_MAX || ringBusy(w) || e.hasStatus('charm')) return false;
  const tg = e.target(w);
  if (!w.room.lineOfSight(e.x, e.y, tg.x, tg.y)) return false;
  return openSlots(w, tg.x, tg.y, e.x, e.y).length >= MIN_SPROUTS;
}

function* drumRing(e: Enemy, w: World): Script {
  e.halt();
  e.mem.ringing = 1;
  e.mem.pose = 1;
  let tg = e.target(w);
  e.facing = tg.x >= e.x ? 1 : -1;
  e.setAnim('fant_rear', true);
  e.telegraph(RING_WINDUP);
  w.sfx('enemy_charge', { vol: 0.3, pitch: 1.6 });
  gather(w, e.x - e.facing, e.y - 16, [GLOW.hot, GLOW.lime, CAP[3]], 8, 14);
  yield RING_WINDUP;
  // drum: the ring grows around wherever the keeper stands now, open toward the ant —
  // unless the keeper rushed it (too close for a gap to walk out of) or ducked out of sight
  e.setAnim('fant_drum', true);
  tg = e.target(w);
  const slots = openSlots(w, tg.x, tg.y, e.x, e.y);
  const clear = e.distToTarget(w) >= DRUM_MIN && w.room.lineOfSight(e.x, e.y, tg.x, tg.y) && !e.hasStatus('charm');
  if (clear && slots.length >= MIN_SPROUTS) {
    const rx = e.x + e.facing * 8;
    const ry = e.y + 3;
    const ring = w.spawn(new SporeRing(e, tg.x, tg.y, slots, e.champion ? 2 : 1, rx, ry));
    ring.warning = w.spawn(new GroundWarning(tg.x, tg.y, RING_R - 6, PUFF_AT, undefined, WARN_RED));
    w.sfx('slam', { vol: 0.25, pitch: 1.8 });
    w.spawn(new RingFx(rx, ry, 12, 0.3, MYCEL, 1));
    dust(w, rx, ry, DIRT, 6, 50);
    w.particles.burst(e.x - e.facing, e.y - 14, { count: 10, speed: [20, 55], life: [0.4, 0.8], colors: [GLOW.pale, GLOW.lime, CAP[3]], size: [1, 2], drag: 2 });
  } else {
    // no ring after all (the keeper rushed in, ducked behind a rock or into a corner): a dud puff
    e.mem.ringing = 0;
    w.particles.burst(e.x - e.facing, e.y - 14, { count: 5, speed: [10, 30], life: [0.3, 0.6], colors: [CAP[3], CAP[2]], size: [1, 1], drag: 2 });
  }
  yield 0.35;
  e.mem.pose = 0;
  e.setAnim('fant_idle');
  yield 0.3;
}

/**
 * The scuttle's gait at distance `d` from the keeper: 1 approach, 0 sidle, -1 back off.
 * A burst picks one at its start (`prev` null) and keeps it: mid-burst it only turns a sidle
 * into an approach / retreat past a margin, or an approach into a retreat, never back.
 */
export function scuttleGait(d: number, prev: number | null): number {
  if (prev === null) return d > KEEP_FAR ? 1 : d < KEEP_NEAR ? -1 : 0;
  if (prev < 0) return -1;
  if (prev > 0) return d < KEEP_NEAR ? -1 : 1;
  return d < KEEP_NEAR - 14 ? -1 : d > KEEP_FAR + 14 ? 1 : 0;
}

/**
 * Where to back off to: of 16 headings, the one whose open run (up to 48 px) ends farthest
 * from the keeper, slightly favouring the last pick so it does not dither. In the open that
 * is straight away; against a wall it runs along the wall; in a corner it slips out past the
 * keeper's side — never into the wall.
 */
export function retreatHeading(e: Enemy, w: World): number {
  const t = e.target(w);
  const prev: number | undefined = e.mem.retreatA;
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU - Math.PI;
    const run = rayFree(w.room, e.x, e.y, a, e.r, 48);
    let score = Math.hypot(e.x + Math.cos(a) * run - t.x, e.y + Math.sin(a) * run - t.y);
    if (prev !== undefined && Math.cos(a - prev) > 0.9) score += 6;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  e.mem.retreatA = best;
  return best;
}

/** Light pass: the cap blazes up during the wind-up. */
function capGlow(e: Enemy, w: World): void {
  if (e.anim !== 'fant_rear') return;
  const k = Math.min(1, e.animT / RING_WINDUP);
  const x = e.x + e.facing * 0.6;
  const y = e.y - e.z - 9;
  w.lights.add(x, y, 22 + 14 * k, '#c8ff6a', { intensity: 0.5 + 0.5 * k });
  w.lights.glow(x, y, 5 + 4 * k, GLOW.lime, 0.18 + 0.22 * k * (0.75 + 0.25 * Math.sin(e.animT * 30)));
}

defineEnemy({
  id: 'fungus_ant',
  name: '버섯개미',
  hp: 28,
  radius: 5,
  speed: 60,
  sprite: 'fant_idle',
  spriteYOffset: 4,
  shadow: 15,
  cost: 1.5,
  floors: [2],
  weight: 1,
  champion: true,
  deathFx: 'goo',
  bloodColor: '#c86a3a',
  hurtSfx: 'hit',
  light: { radius: 16, color: '#c0ff60' },
  init(e, w) {
    e.mem.ringing = 0;
    e.mem.pose = 0;
    // its mushroom swells with light while it winds up (a cosmetic companion adds the glow)
    w.spawn(new EnemyOverlay(e, 1, () => {}, capGlow));
  },
  *script(e, w) {
    yield w.rng.range(0.3, 0.8);
    let side = w.rng.chance(0.5) ? 1 : -1;
    let calm = w.rng.range(1.4, 2.2);
    while (true) {
      // scuttle in short bursts, keeping 70–120 px from the keeper and sidling between
      let el = 0;
      while (true) {
        e.setAnim('fant_run');
        const burst = w.rng.range(0.35, 0.6);
        // one gait per burst (approach / sidle / back off), so it never dithers on the edge of
        // its band; a keeper closing in mid-burst still turns it into a retreat
        let gait = scuttleGait(e.distToTarget(w), null);
        for (let b = 0; b < burst; b += w.dt) {
          gait = scuttleGait(e.distToTarget(w), gait);
          const at = e.angleToTarget(w);
          if (gait > 0) e.chase(w, e.speed);
          // back off / sidle along open floor: it slips along walls rather than into corners
          else if (gait < 0) e.moveAngle(retreatHeading(e, w), e.speed);
          else e.moveAngle(openHeading(e, w, at + (side * Math.PI) / 2, side), e.speed * 0.8);
          if (e.mem.__bumped) side = -side;
          yield;
        }
        el += burst;
        // a pause: antennae twitch
        e.stop();
        e.setAnim('fant_idle');
        const pause = w.rng.range(0.14, 0.28);
        yield pause;
        el += pause;
        if (el >= calm && canRing(e, w)) break;
        if (w.rng.chance(0.25)) side = -side;
      }
      yield* drumRing(e, w);
      calm = w.rng.range(1.6, 2.4);
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, e.mem.pose ? e.frame() : hurtFrame(e, w, 'fant_hurt_0'));
  },
  update(e, w) {
    // the mushroom brightens while it winds up (cosmetic sparkle)
    if (e.anim === 'fant_rear' && fx.chance(0.35)) {
      w.particles.spawn({
        x: e.x + fx.range(-4, 4), y: e.y - e.z - 9 + fx.range(-2, 2), vy: -fx.range(6, 16), life: fx.range(0.25, 0.45),
        colors: [GLOW.hot, GLOW.lime], size: 1, additive: true, light: 4,
      });
    }
  },
  onDeath(e, w) {
    e.mem.ringing = 0;
    // chitin bits and a last sad puff from its mushroom
    w.particles.burst(e.x, e.y - 4, {
      count: 10, speed: [30, 90], life: [0.3, 0.6], colors: [ANT[3], ANT[2], ANT[1]], size: [1, 2], gravity: 300, vz: [30, 100], shape: 'square', vrot: 8,
    });
    w.particles.burst(e.x, e.y - 12, { count: 10, speed: [15, 50], life: [0.5, 0.9], colors: [GLOW.pale, GLOW.lime, CAP[3], CAP[2]], size: [1, 2], drag: 2 });
  },
});
