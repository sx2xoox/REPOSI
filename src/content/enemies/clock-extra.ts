// Floor 7 — 멈춘 태엽탑 (stopped clockwork spire), part 4:
//  - 걸음쇠 (walking compass): a watchmaker's brass drafting compass come alive. It walks
//    end over end — one leg planted, the other swung round it — and when the keeper is in
//    reach it plants its needle, swings its graver leg to the far side and opens wide
//    (the band of the circle shows on the floor), then runs the graver once round the
//    needle. The line it cuts stays on the floor as a burning fence for a few seconds:
//    touching it burns and throws the keeper back to their own side. Step inside before
//    the graver comes round and you are penned in with a compass resting on its needle
//    (harmless until it folds up); stay outside and that ground is closed to you. Killing
//    it snuffs the line at once.
//    It is the floor's only lasting zoning — every other floor-7 attack is gone a moment
//    after it lands (shots, lanes, steam, swings, rings) — and its only walker that steps
//    instead of sliding.
// Pure helpers (`hingeHeight`, `scribeRadius`, `arcCovered`, `pickStep`, `stepGoal`) are
// unit-tested in tests/enemies-extra-f7.test.ts.

import { defineEnemy } from '../../game/defs';
import { Entity } from '../../game/entity';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { Script } from '../../engine/script';
import { PixelPainter } from '../../engine/painter';
import { GroundWarning } from '../../game/effects';
import { fx } from '../../engine/rng';
import { angleDiff, clamp, TAU } from '../../engine/math';
import { CLOCK } from '../props/clock';
import { dust, frames, hurtFrame, sphere, WARN_RED, type BlockQuery } from './shared';
import { AMBER, BRASS, COUT, PLUM, PORC, sparks, springPop, VERD } from './clock-shared';

// ================================================================== geometry
/** Length of each leg (hinge to point), px. */
export const LEG = 24;
/** Distance between the feet while it walks. */
export const STEP_SPAN = 26;
/** Radius of the circle it scribes (champion: SCRIBE_R_CHAMP); shrunk near walls. */
export const SCRIBE_R = 40;
export const SCRIBE_R_CHAMP = 46;
/** It never scribes a circle smaller than this (too close to a wall: walk on). */
export const SCRIBE_MIN_R = 28;
/** It scribes when its needle is within the circle's radius + this of its keeper (a fence cut
 *  just in front of a keeper still closes ground to them). */
export const SCRIBE_REACH = 24;
/** Warning before the graver runs (champion: 0.5). */
export const SCRIBE_TELE = 0.6;
/** Time the graver takes round the circle (champion: 0.66). */
export const SCRIBE_DRAW = 0.8;
/** The finished line burns this long (champion: 2.8), then fades. */
export const FENCE_HOLD = 2.4;
export const FENCE_FADE = 0.3;
/** Half-width of the burning line, px (the keeper's body adds half its radius). */
export const FENCE_HALF = 2;
/** It keeps about this far from its keeper while the graver cools. */
export const KEEP_OFF = 56;
/** The legs hinge on two lugs this far either side of the head's centre (drawing only). */
const LUG = 3;

/** Height of the hinge above the floor for feet `span` px apart (legs of length LEG). */
export function hingeHeight(span: number): number {
  return Math.sqrt(Math.max(0, LEG * LEG - (span * span) / 4));
}

export interface InteriorQuery extends BlockQuery {
  interiorX: number;
  interiorY: number;
  interiorW: number;
  interiorH: number;
  isFree(x: number, y: number, r?: number): boolean;
}

/** Largest circle (up to `R`) centred on (cx, cy) that stays inside the room's interior. */
export function scribeRadius(room: InteriorQuery, cx: number, cy: number, R: number): number {
  const edge = Math.min(cx - room.interiorX, room.interiorX + room.interiorW - cx, cy - room.interiorY, room.interiorY + room.interiorH - cy) - 3;
  return Math.max(0, Math.min(R, edge));
}

/**
 * Has a line scribed from angle `a0` in direction `dir` (±1), `progress` (0..1) of the way
 * round, reached the angle `ang` yet (with `slack` radians of tip)?
 */
export function arcCovered(a0: number, dir: number, progress: number, ang: number, slack = 0): boolean {
  if (progress >= 1) return true;
  if (progress <= 0) return false;
  let rel = angleDiff(a0, ang) * dir;
  if (rel < 0) rel += TAU;
  return rel <= progress * TAU + slack || rel >= TAU - slack;
}

export interface StepPick {
  /** 0 = pivot on the needle (A), 1 = pivot on the graver (B) */
  pivot: 0 | 1;
  /** signed swing of the other foot round the pivot (rad) */
  phi: number;
}

const SWINGS = [Math.PI, Math.PI * 0.8, Math.PI * 0.6, Math.PI * 0.4];

/**
 * The next step toward (gx, gy): which foot to plant and how far to swing the other round
 * it. The new body position (the feet's midpoint) must be free floor, the swung foot must
 * land on the floor inside the room, and the body must not cross a wall on the way (it
 * steps over rocks and pits). Keeps to alternate feet (`prefer`) unless the other is
 * clearly better. Null when boxed in.
 */
export function pickStep(room: InteriorQuery, ax: number, ay: number, bx: number, by: number, prefer: 0 | 1, gx: number, gy: number, r: number): StepPick | null {
  let best: StepPick | null = null;
  let bestScore = Infinity;
  for (const pivot of [prefer, (1 - prefer) as 0 | 1]) {
    const px = pivot === 0 ? ax : bx;
    const py = pivot === 0 ? ay : by;
    const sx = pivot === 0 ? bx : ax;
    const sy = pivot === 0 ? by : ay;
    const a0 = Math.atan2(sy - py, sx - px);
    const span = Math.max(8, Math.hypot(sx - px, sy - py));
    for (const mag of SWINGS) {
      for (const sgn of [1, -1]) {
        const phi = mag * sgn;
        const a1 = a0 + phi;
        const fx1 = px + Math.cos(a1) * span;
        const fy1 = py + Math.sin(a1) * span;
        const mx = (px + fx1) / 2;
        const my = (py + fy1) / 2;
        if (fx1 < room.interiorX + 2 || fx1 > room.interiorX + room.interiorW - 2) continue;
        if (fy1 < room.interiorY + 2 || fy1 > room.interiorY + room.interiorH - 2) continue;
        if (room.boxBlocked(fx1, fy1, 1, false, false)) continue;
        if (!room.isFree(mx, my, r)) continue;
        let clear = true;
        for (const k of [0.25, 0.5, 0.75]) {
          const am = a0 + phi * k;
          if (room.boxBlocked(px + (Math.cos(am) * span) / 2, py + (Math.sin(am) * span) / 2, r * 0.7, true, false)) {
            clear = false;
            break;
          }
        }
        if (!clear) continue;
        const score = Math.hypot(mx - gx, my - gy) + (pivot === prefer ? 0 : 8) + (mag < Math.PI ? 0.5 : 0);
        if (score < bestScore - 1e-9) {
          bestScore = score;
          best = { pivot, phi };
        }
      }
    }
  }
  return best;
}

/**
 * Where it walks: straight at its keeper while the graver is ready, otherwise to a spot
 * KEEP_OFF px from the keeper on its own side (it circles, sizing the keeper up).
 */
export function stepGoal(x: number, y: number, tx: number, ty: number, ready: boolean): { x: number; y: number } {
  if (ready) return { x: tx, y: ty };
  const d = Math.hypot(x - tx, y - ty);
  if (d < 1e-6) return { x: tx + KEEP_OFF, y: ty };
  return { x: tx + ((x - tx) / d) * KEEP_OFF, y: ty + ((y - ty) / d) * KEEP_OFF };
}

// ================================================================== drawing helpers
/**
 * Crisp pixel arc: `k` (0..1) of a circle of radius `R` from `a0` in direction `dir`,
 * stamped with a `width` px brush (one fill). Samples whose `mask` entry is 0 are skipped.
 */
function pixelArc(r: Renderer, cx: number, cy: number, R: number, a0: number, dir: number, k: number, color: string, width: number, alpha: number, mask?: Uint8Array): void {
  if (k <= 0 || alpha <= 0 || R <= 0) return;
  const c = r.ctx;
  const s = Math.max(1, Math.round(width));
  const off = Math.floor(s / 2);
  const total = TAU * Math.min(1, k);
  const n = Math.max(2, Math.ceil(total * R));
  const N = mask?.length ?? 0;
  c.globalAlpha = alpha * r.worldOpacity;
  c.fillStyle = color;
  c.beginPath();
  let lx = NaN;
  let ly = NaN;
  for (let i = 0; i <= n; i++) {
    const t = (total * i) / n;
    if (mask && !mask[Math.min(N - 1, Math.floor((t / TAU) * N))]) continue;
    const a = a0 + dir * t;
    const x = Math.round(cx + Math.cos(a) * R - r.viewX);
    const y = Math.round(cy + Math.sin(a) * R - r.viewY);
    if (x === lx && y === ly) continue;
    lx = x;
    ly = y;
    c.rect(x - off, y - off, s, s);
  }
  c.fill();
  c.globalAlpha = 1;
}

/**
 * Shaft colors of a leg: nickel silver (like a real drafting compass, and unlike the
 * brass inlay lines of the parquet it walks on); white when hit, pale gold in the
 * telegraph blink.
 */
function legColors(flash: number): [string, string, string] {
  if (flash >= 1) return ['#ffffff', '#ffffff', '#ffffff'];
  if (flash > 0) return [PORC[2], CLOCK.goldHot, '#ffffff'];
  return [PORC[0], PORC[2], PORC[3]];
}

/**
 * One leg from the hinge (x0, y0) to its point (x1, y1): a nickel-silver shaft with a brass
 * knuckle, lit from the top-left, ending in the steel needle or the amber graver.
 */
function drawLeg(r: Renderer, x0: number, y0: number, x1: number, y1: number, needle: boolean, hot: number, flash: number, alpha = 1, tint = ''): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1) return;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const tip = Math.min(len * 0.4, needle ? 6 : 5);
  const kx = x1 - ux * tip;
  const ky = y1 - uy * tip;
  const [dark, mid, lit] = legColors(flash);
  // outline (the point tapers)
  r.pixelLine(x0, y0, kx, ky, COUT, 4, alpha);
  r.pixelLine(kx, ky, x1, y1, COUT, 3, alpha);
  // shaft: shadow side, body, highlight on the lit edge
  const vertical = Math.abs(uy) >= Math.abs(ux);
  const hx = vertical ? -1 : 0;
  const hy = vertical ? 0 : -1;
  r.pixelLine(x0, y0, kx, ky, dark, 2, alpha);
  r.pixelLine(x0 + hx, y0 + hy, kx + hx, ky + hy, mid, 1, alpha);
  r.pixelLine(x0 + hx, y0 + hy, x0 + hx + ux * len * 0.35, y0 + hy + uy * len * 0.35, lit, 1, alpha);
  if (tint) r.pixelLine(x0, y0, kx, ky, tint, 2, alpha * 0.35);
  // the point
  if (needle) {
    r.pixelLine(kx, ky, x1, y1, flash ? '#ffffff' : PORC[1], 1, alpha);
    r.rect(Math.round(x1), Math.round(y1), 1, 1, '#ffffff', alpha);
  } else {
    const c = flash ? '#ffffff' : hot > 0.5 ? AMBER.hot : AMBER.mid;
    r.pixelLine(kx, ky, x1, y1, AMBER.low, 2, alpha);
    r.pixelLine(kx, ky, x1, y1, c, 1, alpha);
  }
  // the knuckle a third of the way down
  const jx = x0 + ux * len * 0.42;
  const jy = y0 + uy * len * 0.42;
  r.pixelDisc(jx, jy, 2, COUT, alpha);
  r.pixelDisc(jx, jy, 1, flash ? '#ffffff' : BRASS[3], alpha);
  r.rect(Math.round(jx) - 1, Math.round(jy), 1, 1, flash ? '#ffffff' : BRASS[5], alpha);
  r.rect(Math.round(jx), Math.round(jy) - 1, 1, 1, flash ? '#ffffff' : BRASS[4], alpha);
}

// ================================================================== the burning line
/**
 * The line a compass cuts: drawn round as its owner's graver runs (`progress`, set by the
 * owner's script), then it holds as a fence for `hold` seconds. Any part already cut burns
 * a keeper touching it (base 1) and throws them back to their own side. It goes out when
 * its compass dies, and bullet-clears blow it out.
 */
export class ScribeLine extends Entity {
  owner: Enemy;
  R: number;
  a0: number;
  dir: number;
  progress = 0;
  hold: number;
  held = 0;
  /** time since it began to go out (-1 = burning) */
  fade = -1;
  source: string;
  /** per sample of the circle: 1 where the floor takes the line (not over rocks / pits / walls) */
  mask: Uint8Array;

  constructor(owner: Enemy, x: number, y: number, R: number, a0: number, dir: number, hold: number, room: BlockQuery) {
    super();
    this.owner = owner;
    this.x = x;
    this.y = y;
    this.R = R;
    this.a0 = a0;
    this.dir = dir;
    this.hold = hold;
    this.source = owner.def.name;
    this.layer = 0;
    this.tileCollide = false;
    this.enemyHazard = true;
    const N = Math.max(12, Math.ceil((TAU * R) / 2));
    this.mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const a = a0 + (dir * TAU * i) / N;
      this.mask[i] = room.boxBlocked(x + Math.cos(a) * R, y + Math.sin(a) * R, 0.5, false, false) ? 0 : 1;
    }
  }

  get complete(): boolean {
    return this.progress >= 1;
  }

  get burning(): boolean {
    return this.fade < 0 && this.progress > 0;
  }

  /** Go out (no more burning) and fade away. */
  snuff(): void {
    if (this.fade < 0) this.fade = 0;
  }

  override onCleared(_w?: World): void {
    this.snuff();
  }

  /** Is the keeper at (px, py) of radius `pr` touching the part already cut? */
  touches(px: number, py: number, pr: number): boolean {
    if (!this.burning) return false;
    const dx = px - this.x;
    const dy = py - this.y;
    const d = Math.hypot(dx, dy);
    const reach = FENCE_HALF + pr * 0.5;
    if (Math.abs(d - this.R) > reach) return false;
    return arcCovered(this.a0, this.dir, this.progress, Math.atan2(dy, dx), reach / this.R);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.fade >= 0) {
      this.fade += dt;
      if (this.fade >= FENCE_FADE) this.dead = true;
      return;
    }
    if (!this.owner.alive) {
      this.snuff();
      w.sfx('clock_tick', { vol: 0.3, pitch: 0.6, x: this.x });
      return;
    }
    if (this.complete) {
      this.held += dt;
      if (this.held >= this.hold) {
        this.snuff();
        w.sfx('clock_tick', { vol: 0.25, pitch: 0.7, x: this.x });
        return;
      }
    } else if (this.age > 8) {
      // never left half-cut (e.g. its compass was frozen solid mid-line)
      this.snuff();
      return;
    }
    for (const p of w.targets()) {
      if (!p.alive || p.z >= 6 || !this.touches(p.x, p.y, p.r)) continue;
      const dx = p.x - this.x;
      const dy = p.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      const ox = this.x + (dx / d) * this.R;
      const oy = this.y + (dy / d) * this.R;
      if (p.hurt(w, 1, this.source, false, { x: ox, y: oy })) {
        // thrown back to the side it came from (by its motion; standing still: the side it is on)
        const radial = (p.vx * dx + p.vy * dy) / d;
        const fromInside = Math.abs(radial) > 6 ? radial > 0 : d < this.R;
        const side = fromInside ? -1 : 1;
        p.knock((dx / d) * side, (dy / d) * side, 130);
        sparks(w, ox, oy, 6, 80);
      }
    }
    // embers rising off the cut
    if (this.progress > 0 && fx.chance(dt * 10)) {
      const a = this.a0 + this.dir * TAU * this.progress * fx.next();
      w.particles.spawn({
        x: this.x + Math.cos(a) * this.R, y: this.y + Math.sin(a) * this.R, vy: -fx.range(8, 18), life: fx.range(0.3, 0.6),
        colors: [AMBER.hot, AMBER.mid, AMBER.low], size: 1, additive: true, alpha: 0.85,
      });
    }
  }

  /** 0..1 visibility (fades out; blinks before it goes out by itself). */
  private vis(): number {
    if (this.fade >= 0) return clamp(1 - this.fade / FENCE_FADE, 0, 1);
    if (this.complete && this.hold - this.held < 0.6) return Math.floor((this.hold - this.held) * 12) % 2 ? 0.45 : 1;
    return 1;
  }

  override draw(r: Renderer): void {
    const a = this.vis();
    if (a <= 0) return;
    const { x, y, R, a0, dir, progress, mask } = this;
    // a scorched groove with the glowing cut inside it
    pixelArc(r, x, y, R, a0, dir, progress, PLUM[0], 4, 0.55 * a, mask);
    pixelArc(r, x, y, R, a0, dir, progress, AMBER.low, 3, 0.95 * a, mask);
    pixelArc(r, x, y, R, a0, dir, progress, AMBER.mid, 2, a, mask);
    pixelArc(r, x, y, R, a0, dir, progress, AMBER.hot, 1, 0.9 * a, mask);
    // the needle's prick at the centre
    r.rect(Math.round(x), Math.round(y), 1, 1, AMBER.mid, 0.8 * a);
  }

  override light(w: World): void {
    const a = this.vis();
    if (a <= 0 || this.progress <= 0) return;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) / n) * this.progress;
      const ang = this.a0 + this.dir * TAU * t;
      w.lights.add(this.x + Math.cos(ang) * this.R, this.y + Math.sin(ang) * this.R, 18, AMBER.mid, { intensity: 0.45 * a });
    }
  }
}

/**
 * The band a compass is about to cut: a red ring that fills round from the graver's
 * starting point in the direction it will run, with that starting point marked.
 */
export class ScribeWarning extends GroundWarning {
  a0: number;
  dir: number;

  constructor(x: number, y: number, radius: number, time: number, a0: number, dir: number) {
    super(x, y, radius, time, undefined, WARN_RED);
    this.a0 = a0;
    this.dir = dir;
  }

  override draw(r: Renderer): void {
    const t = clamp(this.age / this.time, 0, 1);
    const blink = 0.25 + 0.2 * Math.sin(this.age * 25);
    r.pixelRing(this.x, this.y, this.radius, this.color, 6, blink);
    pixelArc(r, this.x, this.y, this.radius, this.a0, this.dir, t, this.color, 3, 0.8);
    r.pixelRing(this.x, this.y, this.radius, this.color, 1, 0.9);
    const sx = this.x + Math.cos(this.a0) * this.radius;
    const sy = this.y + Math.sin(this.a0) * this.radius;
    r.pixelDisc(sx, sy, 2.5, '#ffffff', 0.55 + 0.35 * Math.sin(this.age * 25));
  }
}

/** A compass that has fallen over: its legs clatter flat and fade (purely visual). */
export class CompassWreck extends Entity {
  static override readonly cosmetic = true;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  h0: number;
  life = 1.1;
  spin: number;

  constructor(x: number, y: number, ax: number, ay: number, bx: number, by: number, h0: number) {
    super();
    this.x = x;
    this.y = y;
    this.ax = ax;
    this.ay = ay;
    this.bx = bx;
    this.by = by;
    this.h0 = h0;
    this.spin = fx.chance(0.5) ? 1 : -1;
    this.layer = 1;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.age >= this.life) this.dead = true;
  }

  override draw(r: Renderer): void {
    const t = clamp(this.age / 0.24, 0, 1);
    const h = this.h0 * (1 - t * t) + (t >= 1 ? Math.max(0, Math.sin((this.age - 0.24) * 18)) * 2 * Math.max(0, 1 - (this.age - 0.24) * 4) : 0);
    const a = this.age > 0.7 ? clamp(1 - (this.age - 0.7) / 0.4, 0, 1) : 1;
    // the legs splay out as it falls
    const sp = 1 + 0.25 * t;
    const ax = this.x + (this.ax - this.x) * sp;
    const ay = this.y + (this.ay - this.y) * sp;
    const bx = this.x + (this.bx - this.x) * sp;
    const by = this.y + (this.by - this.y) * sp;
    r.shadow(this.x, this.y + 1, 10, 3, 0.2 * a);
    const aLeft = ax <= bx;
    drawLeg(r, this.x + (aLeft ? -LUG : LUG), this.y - h, ax, ay, true, 0, 0, a);
    drawLeg(r, this.x + (aLeft ? LUG : -LUG), this.y - h, bx, by, false, 0, 0, a);
    r.sprite('ckcomp_hurt_0', this.x, this.y - h + 3, { rot: this.spin * t * 1.3, alpha: a });
  }
}

// ================================================================== sprites (the head)
type HeadMode = 'idle' | 'step' | 'wind' | 'scribe' | 'rest' | 'hurt';

/** Head sprite size (before the 1px outline). */
const HEAD_W = 15;
const HEAD_H = 15;

/**
 * The compass head, 15x15: a knurled grip (the handle a watchmaker twists) over the
 * hinge disc, a big watch jewel set in the hinge screw for an eye, ruler ticks round
 * the rim and the legs' two lugs below.
 */
function paintHead(p: PixelPainter, k: number, mode: HeadMode): void {
  const turning = mode === 'wind' || mode === 'scribe' || mode === 'step';
  const twist = turning ? k : 0;
  // finial and cap
  p.px(7, 0, BRASS[4]);
  p.rect(6, 1, 3, 1, BRASS[4]);
  p.px(6, 1, BRASS[5]);
  // knurled grip, lit from the left; the ridges roll as it turns
  for (let y = 2; y < 6; y++) {
    const ridge = (y + twist) % 2 === 0;
    p.px(6, y, ridge ? BRASS[5] : BRASS[4]);
    p.px(7, y, ridge ? BRASS[4] : BRASS[2]);
    p.px(8, y, ridge ? BRASS[2] : BRASS[1]);
  }
  // collar
  p.rect(5, 6, 5, 1, BRASS[3]);
  p.px(5, 6, BRASS[5]);
  p.px(9, 6, BRASS[1]);
  // hinge disc
  p.ellipse(7, 10.5, 6.6, 4.3, BRASS[3]);
  sphere(p, 7, 10.5, 6.6, 4.3, BRASS, false);
  // ruler ticks round the rim, a fleck of verdigris
  for (const [x, y] of [[2, 9], [3, 8], [11, 8], [12, 9]] as [number, number][]) p.pxIn(x, y, BRASS[1]);
  p.pxIn(1, 11, VERD[1]);
  p.pxIn(13, 12, VERD[2]);
  // lugs where the legs hinge
  p.rect(7 - LUG - 1, 14, 2, 1, BRASS[2]);
  p.rect(7 + LUG, 14, 2, 1, BRASS[1]);
  p.px(7 - LUG - 1, 14, BRASS[4]);
  // the jewel eye: a dark bezel with an amber stone
  const sock = PLUM[0];
  switch (mode) {
    case 'idle': {
      p.rect(5, 9, 5, 4, sock);
      p.px(5, 9, PLUM[1]);
      p.px(9, 12, PLUM[1]);
      const ex = k ? 7 : 6;
      p.rect(ex, 10, 2, 2, AMBER.mid);
      p.px(ex, 10, AMBER.hot);
      p.px(ex + 1, 11, AMBER.low);
      break;
    }
    case 'step':
      p.rect(5, 9, 5, 4, sock);
      p.px(5, 9, PLUM[1]);
      p.rect(7, 10, 2, 2, AMBER.mid);
      p.px(7, 10, AMBER.hot);
      p.px(8, 11, AMBER.low);
      break;
    case 'wind':
      // narrowed to a burning slit under a frown, the grip spinning
      p.rect(4, 9, 7, 1, BRASS[1]);
      p.rect(4, 10, 7, 2, sock);
      p.rect(5, 10, 5, 1, AMBER.mid);
      p.px(7, 10, k ? '#ffffff' : AMBER.hot);
      p.px(6, 10, AMBER.hot);
      p.px(8, 11, AMBER.low);
      if (k) {
        p.px(11, 2, '#fff6d0');
        p.px(12, 1, AMBER.mid);
      } else {
        p.px(3, 2, '#fff6d0');
        p.px(2, 3, AMBER.mid);
      }
      break;
    case 'scribe':
      // wide open, white hot at the core
      p.rect(4, 8, 7, 5, sock);
      p.rect(5, 9, 5, 3, AMBER.mid);
      p.rect(6, 9, 3, 2, AMBER.hot);
      p.px(k ? 7 : 6, 9, '#ffffff');
      p.px(4, 8, PLUM[1]);
      break;
    case 'rest':
      // half-lidded and dim: it is spent for a moment
      p.rect(5, 9, 5, 2, BRASS[2]);
      p.px(5, 9, BRASS[4]);
      p.rect(5, 11, 5, 2, sock);
      p.rect(6, 11, 2, 1, AMBER.low);
      p.px(k ? 7 : 6, 11, AMBER.mid);
      break;
    case 'hurt':
      p.rect(5, 9, 5, 4, sock);
      p.rect(6, 10, 2, 2, '#ffffff');
      p.line(2, 8, 4, 12, PLUM[1]);
      p.px(10, 13, PLUM[1]);
      break;
  }
}
frames('ckcomp', 'idle', 2, HEAD_W, HEAD_H, (p, i) => paintHead(p, i, 'idle'), { anchor: 'bottom', fps: 1.6, outline: COUT });
frames('ckcomp', 'step', 2, HEAD_W, HEAD_H, (p, i) => paintHead(p, i, 'step'), { anchor: 'bottom', fps: 8, outline: COUT });
frames('ckcomp', 'wind', 2, HEAD_W, HEAD_H, (p, i) => paintHead(p, i, 'wind'), { anchor: 'bottom', fps: 14, outline: COUT });
frames('ckcomp', 'scribe', 2, HEAD_W, HEAD_H, (p, i) => paintHead(p, i, 'scribe'), { anchor: 'bottom', fps: 16, outline: COUT });
frames('ckcomp', 'rest', 2, HEAD_W, HEAD_H, (p, i) => paintHead(p, i, 'rest'), { anchor: 'bottom', fps: 2, outline: COUT });
frames('ckcomp', 'hurt', 1, HEAD_W, HEAD_H, (p) => paintHead(p, 0, 'hurt'), { anchor: 'bottom', outline: COUT });

// ================================================================== the walking compass
/** Feet live in mem: (ax, ay) = the needle, (bx, by) = the graver; the body is their midpoint. */
function setFoot(e: Enemy, which: 0 | 1, x: number, y: number): void {
  const m = e.mem;
  if (which === 0) {
    m.ax = x;
    m.ay = y;
  } else {
    m.bx = x;
    m.by = y;
  }
  e.x = (m.ax + m.bx) / 2;
  e.y = (m.ay + m.by) / 2;
}

/** Move both feet with the body (after a push or a knock moved it). */
function syncFeet(e: Enemy): void {
  const m = e.mem;
  const dx = e.x - (m.ax + m.bx) / 2;
  const dy = e.y - (m.ay + m.by) / 2;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;
  m.ax += dx;
  m.ay += dy;
  m.bx += dx;
  m.by += dy;
}

/**
 * Braced on a point (stepping or cutting): its script places the body between its feet,
 * knocks and shoves don't move it (others are pushed off it instead).
 */
function brace(e: Enemy, on: boolean): void {
  e.mem.ctl = on ? 1 : 0;
  e.mass = on ? Infinity : e.def.mass ?? 1;
}

/** Was the body carried off its feet while braced (fear, a knock while frozen solid ...)? */
function displaced(e: Enemy): boolean {
  const m = e.mem;
  return Math.abs(e.x - (m.ax + m.bx) / 2) > 3 || Math.abs(e.y - (m.ay + m.by) / 2) > 3;
}

/** Give up the move in hand: the feet follow the body and it stands normally again. */
function standDown(e: Enemy): void {
  const m = e.mem;
  syncFeet(e);
  brace(e, false);
  m.lift = 0;
  m.swing = -1;
  e.flying = !!e.def.flying;
  e.harmful = true;
}

/** The circle it could scribe right now round its needle (0 = none). */
function scribeReady(e: Enemy, w: World): number {
  const m = e.mem;
  if (w.time < m.nextScribe || e.hasStatus('charm')) return 0;
  const R = scribeRadius(w.room, m.ax, m.ay, e.champion ? SCRIBE_R_CHAMP : SCRIBE_R);
  if (R < SCRIBE_MIN_R) return 0;
  const tg = e.target(w);
  if (Math.hypot(tg.x - m.ax, tg.y - m.ay) > R + SCRIBE_REACH) return 0;
  if (!w.room.lineOfSight(m.ax, m.ay, tg.x, tg.y)) return 0;
  return R;
}

/** One step: plant a foot, swing the other round it (lifted), set it down. */
function* stepOnce(e: Enemy, w: World): Script {
  const m = e.mem;
  const tg = e.target(w);
  let goal = stepGoal(e.x, e.y, tg.x, tg.y, w.time >= m.nextScribe);
  if (!w.room.lineOfSight(e.x, e.y, tg.x, tg.y)) {
    const d = w.flow.dirAt(e.x, e.y);
    if (d) goal = { x: e.x + d.x * 80, y: e.y + d.y * 80 };
  }
  const pick = pickStep(w.room, m.ax, m.ay, m.bx, m.by, m.piv, goal.x, goal.y, e.r);
  if (!pick) {
    // boxed in: shuffle along on its points instead
    e.setAnim('ckcomp_step');
    brace(e, false);
    yield* e.chaseFor(w, 0.4, e.speed * 0.7);
    e.stop();
    return;
  }
  const piv = pick.pivot;
  const swing: 0 | 1 = piv === 0 ? 1 : 0;
  const px = piv === 0 ? m.ax : m.bx;
  const py = piv === 0 ? m.ay : m.by;
  const sx = piv === 0 ? m.bx : m.ax;
  const sy = piv === 0 ? m.by : m.ay;
  const a0 = Math.atan2(sy - py, sx - px);
  const span = Math.hypot(sx - px, sy - py);
  // a steady clockwork swing: the body never outpaces the keeper (span·π/2 / T < 92 px/s)
  const T = e.champion ? 0.46 : 0.5;
  brace(e, true);
  m.swing = swing;
  e.setAnim('ckcomp_step', true);
  for (let el = 0; el < 0.1; el += w.dt) {
    if (displaced(e)) return standDown(e);
    m.lift = 3 * Math.min(1, (el + w.dt) / 0.1);
    e.halt();
    yield;
  }
  e.flying = true;
  for (let el = 0; el < T; el += w.dt) {
    if (displaced(e)) return standDown(e);
    const t = Math.min(1, (el + w.dt) / T);
    const a = a0 + pick.phi * t;
    setFoot(e, swing, px + Math.cos(a) * span, py + Math.sin(a) * span);
    m.lift = 3 + Math.sin(t * Math.PI) * 5;
    e.halt();
    yield;
  }
  e.flying = !!e.def.flying;
  m.lift = 0;
  m.swing = -1;
  m.steps++;
  // the point bites into the parquet
  const fx1 = swing === 0 ? m.ax : m.bx;
  const fy1 = swing === 0 ? m.ay : m.by;
  dust(w, fx1, fy1, ['#a89878', BRASS[2]], 3, 30);
  e.squash(1.1, 0.92);
  w.sfx('clock_tick', { vol: 0.26, pitch: swing === 0 ? 0.95 : 0.8, x: e.x });
  m.piv = swing;
  brace(e, false);
  yield e.champion ? 0.1 : 0.16;
}

/** Plant the needle, swing the graver round to the far side, then cut the circle. */
function* scribe(e: Enemy, w: World, R: number): Script {
  const m = e.mem;
  const champ = e.champion;
  const tele = champ ? 0.5 : SCRIBE_TELE;
  const drawT = champ ? 0.66 : SCRIBE_DRAW;
  const cx = m.ax;
  const cy = m.ay;
  const tg = e.target(w);
  // the graver bites on the far side of the keeper and runs round either way
  const a0 = Math.atan2(tg.y - cy, tg.x - cx) + Math.PI;
  const dir = w.rng.sign();
  const b0 = Math.atan2(m.by - cy, m.bx - cx);
  const s0 = Math.hypot(m.bx - cx, m.by - cy);
  const turn = angleDiff(b0, a0);
  /** carried off mid-figure: stand down, the half-cut line goes out, try again soon */
  const abort = (line?: ScribeLine): void => {
    standDown(e);
    if (line && !line.complete) line.snuff();
    m.nextScribe = w.time + 1.5;
  };
  brace(e, true);
  e.halt();
  e.facing = tg.x >= e.x ? 1 : -1;
  e.setAnim('ckcomp_wind', true);
  e.telegraph(tele);
  w.spawn(new ScribeWarning(cx, cy, R, tele, a0, dir));
  w.sfx('clock_ratchet', { vol: 0.45, pitch: 0.75, x: e.x });
  w.sfx('clock_spring', { vol: 0.3, pitch: 1.3, x: e.x });
  // swing the graver leg round and open wide while the band shows
  e.flying = true;
  m.swing = 1;
  for (let el = 0; el < tele; el += w.dt) {
    if (displaced(e)) return abort();
    const t = Math.min(1, (el + w.dt) / tele);
    const k = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    const a = b0 + turn * k;
    const s = s0 + (R - s0) * k;
    setFoot(e, 1, cx + Math.cos(a) * s, cy + Math.sin(a) * s);
    m.lift = Math.sin(t * Math.PI) * 5;
    e.halt();
    if (fx.chance(0.35)) w.particles.spawn({ x: m.bx + fx.range(-1, 1), y: m.by - m.lift, vy: -fx.range(6, 14), life: 0.25, colors: [AMBER.hot, AMBER.mid], size: 1, additive: true });
    yield;
  }
  m.lift = 0;
  m.swing = -1;
  // cut!
  e.harmful = false;
  e.setAnim('ckcomp_scribe', true);
  const line = w.spawn(new ScribeLine(e, cx, cy, R, a0, dir, champ ? 2.8 : FENCE_HOLD, w.room));
  w.sfx('whoosh', { vol: 0.4, pitch: 1.4, x: e.x });
  w.sfx('clock_ratchet', { vol: 0.4, pitch: 1.5, x: e.x });
  let scratch = 0;
  for (let el = 0; el < drawT; el += w.dt) {
    if (displaced(e)) return abort(line);
    const k = Math.min(1, (el + w.dt) / drawT);
    line.progress = k;
    const a = a0 + dir * TAU * k;
    setFoot(e, 1, cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    e.halt();
    scratch -= w.dt;
    if (scratch <= 0) {
      scratch = 0.07;
      w.sfx('clock_tick', { vol: 0.16, pitch: fx.range(2.2, 2.6), x: m.bx });
    }
    if (fx.chance(0.7)) {
      w.particles.burst(m.bx, m.by, { count: 1, speed: [20, 60], life: [0.1, 0.25], colors: ['#fff6d0', AMBER.hot, AMBER.mid], size: [1, 1], shape: 'spark', additive: true });
    }
    yield;
  }
  line.progress = 1;
  m.scribes++;
  e.squash(1.15, 0.9);
  w.sfx('clock_snap', { vol: 0.5, pitch: 1.25, x: e.x });
  // spent: it rests on its needle in the middle of the ring
  e.setAnim('ckcomp_rest', true);
  yield champ ? 0.7 : 0.9;
  if (displaced(e)) return abort();
  // fold up again (toward the side it came from if the graver's spot is no place to stand)
  e.setAnim('ckcomp_step', true);
  let fold = a0;
  for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.3, -2.3, Math.PI]) {
    const a = a0 + off;
    if (w.room.isFree(cx + (Math.cos(a) * STEP_SPAN) / 2, cy + (Math.sin(a) * STEP_SPAN) / 2, e.r)) {
      fold = a;
      break;
    }
  }
  if (!w.room.isFree(cx + (Math.cos(fold) * STEP_SPAN) / 2, cy + (Math.sin(fold) * STEP_SPAN) / 2, e.r)) fold = b0;
  const foldTurn = angleDiff(a0, fold);
  for (let el = 0; el < 0.3; el += w.dt) {
    if (displaced(e)) return abort();
    const k = Math.min(1, (el + w.dt) / 0.3);
    const a = a0 + foldTurn * k;
    const s = R + (STEP_SPAN - R) * k;
    setFoot(e, 1, cx + Math.cos(a) * s, cy + Math.sin(a) * s);
    e.halt();
    yield;
  }
  e.flying = !!e.def.flying;
  e.harmful = true;
  brace(e, false);
  m.piv = 0;
  m.nextScribe = w.time + (champ ? 2.2 : 2.8) + w.rng.range(0, 0.8);
}

defineEnemy({
  id: 'walking_compass',
  name: '걸음쇠',
  hp: 40,
  radius: 7,
  speed: 34,
  mass: 3,
  sprite: 'ckcomp_idle',
  shadow: 0,
  cost: 2,
  floors: [7],
  weight: 0.8,
  champion: true,
  deathFx: 'metal',
  bloodColor: '#9a7430',
  hurtSfx: 'hit_metal',
  light: { radius: 14, color: AMBER.mid },
  init(e, w) {
    const m = e.mem;
    const h = STEP_SPAN / 2;
    const start = w.rng.angle();
    let a = start;
    for (let i = 0; i < 8; i++) {
      const t = start + (i * TAU) / 8;
      const okA = !w.room.boxBlocked(e.x - Math.cos(t) * h, e.y - Math.sin(t) * h, 1, false, false);
      const okB = !w.room.boxBlocked(e.x + Math.cos(t) * h, e.y + Math.sin(t) * h, 1, false, false);
      if (okA && okB) {
        a = t;
        break;
      }
    }
    m.ax = e.x - Math.cos(a) * h;
    m.ay = e.y - Math.sin(a) * h;
    m.bx = e.x + Math.cos(a) * h;
    m.by = e.y + Math.sin(a) * h;
    m.piv = w.rng.chance(0.5) ? 1 : 0;
    m.swing = -1;
    m.lift = 0;
    m.ctl = 0;
    m.steps = 0;
    m.scribes = 0;
    m.nextScribe = w.time + 1.2;
  },
  *script(e, w) {
    yield w.rng.range(0.3, 0.8);
    while (true) {
      syncFeet(e);
      const tg = e.target(w);
      e.facing = tg.x >= e.x ? 1 : -1;
      const R = scribeReady(e, w);
      if (R > 0) {
        yield* scribe(e, w, R);
        continue;
      }
      yield* stepOnce(e, w);
    }
  },
  update(e) {
    if (e.mem.ctl) {
      // braced on a point: no knockback, the body stays between its feet
      e.kbx = 0;
      e.kby = 0;
      e.x = (e.mem.ax + e.mem.bx) / 2;
      e.y = (e.mem.ay + e.mem.by) / 2;
    } else syncFeet(e);
  },
  draw(e, r, w) {
    const m = e.mem;
    // the feet follow anything that moved the body since the script placed them
    const ox = e.x - (m.ax + m.bx) / 2;
    const oy = e.y - (m.ay + m.by) / 2;
    const ax = m.ax + ox;
    const ay = m.ay + oy;
    const bx = m.bx + ox;
    const by = m.by + oy;
    const span = Math.hypot(bx - ax, by - ay);
    const h = hingeHeight(span);
    const hx = e.x;
    const hy = e.y - e.z - h;
    const liftA = m.swing === 0 ? m.lift : 0;
    const liftB = m.swing === 1 ? m.lift : 0;
    r.shadow(ax, ay + 1, 5, 2, liftA > 1 ? 0.2 : 0.4);
    r.shadow(bx, by + 1, 5, 2, liftB > 1 ? 0.2 : 0.4);
    r.shadow(e.x, e.y + 1, 10, 3.5, 0.16);
    const flash = e.flash > 0 ? 1 : e.telegraphT > 0 && Math.floor(e.telegraphT * 16) % 2 === 0 ? 0.55 : 0;
    const hot = e.anim === 'ckcomp_scribe' || e.anim === 'ckcomp_wind' ? 1 : 0;
    const tint = e.champion ? e.championColor : '';
    // each leg hangs from its own lug (the one on its side), so they never fold into one line
    const aLeft = Math.abs(ax - bx) < 2 ? true : ax < bx;
    const legA = { needle: true, x: ax, y: ay - liftA, lug: aLeft ? -LUG : LUG };
    const legB = { needle: false, x: bx, y: by - liftB, lug: aLeft ? LUG : -LUG };
    const order = legA.y <= legB.y ? [legA, legB] : [legB, legA];
    for (const L of order) drawLeg(r, hx + L.lug, hy, L.x, L.y, L.needle, hot, flash, e.alpha, tint);
    // a glowing bead on the graver point while it cuts
    if (hot && e.anim === 'ckcomp_scribe') r.pixelDisc(bx, by - liftB, 1.5, AMBER.hot, 0.9);
    e.drawDefault(r, hurtFrame(e, w, 'ckcomp_hurt_0'), -h + 3);
    // the champion crown sits on the head (the default one, at a fixed height, hides behind it)
    if (e.champion || e.mem.elite) r.sprite('ui_crown', e.x, hy - 18, { sx: 0.65, sy: 0.65 });
  },
  onDeath(e, w) {
    const m = e.mem;
    const span = Math.hypot(m.bx - m.ax, m.by - m.ay);
    w.spawn(new CompassWreck(e.x, e.y, m.ax, m.ay, m.bx, m.by, hingeHeight(span)));
    sparks(w, e.x, e.y - hingeHeight(span), 10, 100);
    springPop(w, e.x, e.y - 6, 2);
    w.particles.burst(e.x, e.y - 8, { count: 10, speed: [30, 100], life: [0.3, 0.7], colors: [BRASS[4], BRASS[2], AMBER.mid, VERD[1]], size: [1, 2], gravity: 320, vz: [30, 110], shape: 'square', vrot: 9, bounce: 0.3 });
    w.sfx('clock_crack', { vol: 0.4, pitch: 1.2 });
    w.sfx('hit_metal', { vol: 0.35, pitch: 0.7 });
  },
});
