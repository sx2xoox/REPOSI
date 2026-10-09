// Floor 6 — 수몰된 서고 (drowned archive), part 4:
//  - 제본 거미 (bookbinding spider): the floor's only SUPPORT enemy. A brass-legged spider
//    that wears a stitched book as its abdomen. It skitters in short bursts to stand BEHIND
//    another monster (using it as cover from the keeper), and when an ally is torn up it
//    casts a glowing binding thread to it and sews it back together (three stitches, each
//    restoring a slice of the ally's health). Any direct hit while it sews snaps the thread
//    and leaves the spider dazed — so the keeper's answer is to flank the medic and shoot it.
//    Its own attack is a NEEDLE ON A THREAD: a telegraphed lane, the needle flies out, sticks
//    (the taut thread blinks while a second lane shows the way back), then the spider reels it
//    in eye-first along the same line — dodge it twice, out and back.
// Pure helpers (`coverSpot`, `pickMendTarget`) are unit-tested in tests/enemies-extra-f6.test.ts.

import { defineEnemy } from '../../game/defs';
import { Entity } from '../../game/entity';
import { PixelPainter } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { clamp } from '../../engine/math';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { Projectile, ProjBehavior } from '../../game/projectile';
import type { Script } from '../../engine/script';
import { BUL, dizzy, frames, gather, hurtFrame, laneWarning, rayFree, sphere, WARN_RED } from './shared';
import { AOUT, CYAN, GOLD, INKB, PAPER, pages, toward } from './archive-shared';

// ================================================================== tuning
/** The needle on a thread: wind-up, reach (px), flight / reel speeds, time stuck before the reel. */
export const NEEDLE = { windup: 0.5, reach: 128, speed: 190, stuck: 0.42, reel: 230, width: 8, catchR: 9, spread: 0.3 } as const;
/**
 * Mending: allies within `range` below `below` of their max HP, not mended in the last
 * `again` s; `stitches` stitches `gap` s apart, each restoring `stitch` of the ally's max HP.
 */
export const MEND = { range: 150, reach: 64, below: 0.8, again: 5, thread: 0.3, stitches: 3, gap: 0.42, stitch: 0.08, cooldown: 3.2, daze: 0.8 } as const;
const ID = 'binding_spider';

// ================================================================== art
/** Oxblood book cover (the abdomen). */
const COVER = '#5a1e2a';
/** Brass needle legs, darkest first. */
const BRASS = ['#3a2a12', '#7a5a24', '#c8a048', '#f0d890'];
const SW = 24;
const SH = 20;
/** Sprite pivot offset (anchor bottom) and the thread anchor points relative to e.(x, y), facing right. */
const S_YO = 3;
const HAND = { dx: 11, dy: -3 };
const SEW = { dx: 8, dy: -5 };

type SpiderMode = 'idle' | 'walk' | 'aim' | 'reel' | 'sew' | 'daze' | 'hurt';
type Pt = [number, number];

/** A two-segment leg: hip -> knee (upper colour) -> foot (lower colour), with a bright knee joint. */
function leg(p: PixelPainter, h: Pt, kn: Pt, f: Pt, upper: string, lower: string, joint?: string): void {
  p.line(h[0], h[1], kn[0], kn[1], upper);
  p.line(kn[0], kn[1], f[0], f[1], lower);
  if (joint) p.px(kn[0], kn[1], joint);
}

/** Left-side legs, front to back: hip, knee, foot (the right side mirrors them). */
const LEGS: { h: Pt; k: Pt; f: Pt }[] = [
  { h: [9, 15], k: [5, 13], f: [2, 19] },
  { h: [8, 13], k: [3, 11], f: [0, 15] },
  { h: [8, 11], k: [3, 7], f: [0, 9] },
  { h: [9, 9], k: [5, 3], f: [2, 1] },
];
const mx = (x: number) => SW - 1 - x;

/**
 * The spider in three-quarter view (front toward the viewer, facing right when it acts):
 * eight brass needle legs radiating from under a small open book worn face-down on its back
 * like a tent (stitched spine ridge down the middle, page edges showing), a glossy ink head
 * with a cluster of cyan eyes and pale fangs.
 */
function paintSpider(p: PixelPainter, k: number, mode: SpiderMode): void {
  const by = mode === 'walk' ? [0, 1, 0, 1][k] : mode === 'idle' ? [0, 1][k % 2] : mode === 'aim' ? -1 : mode === 'daze' ? 1 : mode === 'hurt' ? 1 : 0;
  // tetrapod gait: legs L1 R2 L3 R4 step together, then R1 L2 R3 L4
  const g = mode === 'walk' ? [1, 0, -1, 0][k] : 0;
  const curl = mode === 'daze' ? 1 : mode === 'hurt' ? 0.35 : 0;
  const legAt = (i: number, right: boolean): { h: Pt; k: Pt; f: Pt } => {
    const L = LEGS[i];
    const grp = (i % 2 === 0) !== right ? g : -g;
    const fxp = L.f[0] + grp;
    let kx = L.k[0];
    let ky = L.k[1] + by + (grp > 0 ? -1 : 0);
    let fx2 = fxp;
    let fy = L.f[1];
    if (curl) {
      // legs fold in toward the body
      kx = Math.round(L.k[0] + (L.h[0] - L.k[0]) * 0.3 * curl);
      ky = Math.round(L.k[1] + by + 2 * curl);
      fx2 = Math.round(fxp + (L.h[0] - fxp) * 0.45 * curl);
      fy = Math.round(L.f[1] + (L.h[1] + 3 - L.f[1]) * 0.4 * curl);
    }
    const h: Pt = [L.h[0], L.h[1] + by];
    return right ? { h: [mx(h[0]), h[1]], k: [mx(kx), ky], f: [mx(fx2), fy] } : { h, k: [kx, ky], f: [fx2, fy] };
  };
  const backU = BRASS[0];
  const backL = BRASS[1];
  const nU = BRASS[1];
  const nL = BRASS[2];
  const jt = BRASS[3];

  // ---- back and middle legs come out from under the book
  for (const right of [false, true]) {
    for (const i of [3, 2, 1]) {
      const l = legAt(i, right);
      leg(p, l.h, l.k, l.f, i === 3 ? backU : nU, i === 3 ? backL : nL, i === 3 ? BRASS[2] : jt);
    }
  }

  // ---- abdomen: a little book worn open and face-down, like a tent
  const ay = 3 + by + (mode === 'aim' ? 1 : 0);
  const lit = toward(COVER, '#ffffff', 0.18);
  const dark = toward(COVER, '#000000', 0.3);
  // page edges fanning out under the covers
  p.rect(6, ay + 4, 12, 5, PAPER[1]);
  p.rect(7, ay + 8, 10, 1, PAPER[2]);
  for (let x = 8; x < 16; x += 2) p.px(x, ay + 8, PAPER[3]);
  p.px(6, ay + 4, PAPER[2]);
  p.px(17, ay + 4, PAPER[0]);
  // the two covers slope away from the spine ridge (lit from the top-left)
  p.rect(7, ay + 1, 5, 7, lit);
  p.rect(12, ay + 1, 5, 7, dark);
  p.rect(7, ay + 1, 5, 1, toward(COVER, '#ffffff', 0.38));
  p.rect(12, ay + 7, 5, 1, toward(COVER, '#000000', 0.5));
  p.rect(7, ay + 7, 1, 1, COVER);
  // gilt corners and a tooled band on each cover
  p.px(7, ay + 1, BRASS[3]);
  p.px(16, ay + 1, BRASS[2]);
  p.px(7, ay + 7, BRASS[2]);
  p.px(16, ay + 7, BRASS[1]);
  p.rect(8, ay + 4, 3, 1, GOLD);
  p.rect(13, ay + 4, 3, 1, toward(GOLD, '#000000', 0.35));
  // spine ridge with a zig-zag of cyan stitches (brighter while it sews)
  p.rect(11, ay, 2, 8, '#2a0e14');
  p.px(11, ay, BRASS[3]);
  p.px(12, ay, BRASS[2]);
  for (let y = ay + 1; y < ay + 8; y++) {
    const on = (y - ay) % 2 === 1;
    const hot = mode === 'sew' && ((y + k) % 3 === 0);
    p.px(on ? 11 : 12, y, hot ? CYAN.hot : CYAN.mid);
    p.px(on ? 12 : 11, y, '#3a1420');
  }
  // spinneret at the back: glows while it sews
  if (mode === 'sew') {
    p.px(11, ay - 1, CYAN.hot);
    p.px(12, ay - 1 - (k % 2), CYAN.mid);
  }

  // ---- head: glossy ink, a cluster of eyes, pale fangs
  const hy = 14 + by + (mode === 'aim' ? -1 : 0);
  p.ellipse(11.5, hy + 0.2, 4.1, 2.9, INKB[3]);
  sphere(p, 11.5, hy - 0.3, 4.1, 2.9, INKB, false);
  // wet sheen on the lit (left) side of the head
  p.px(8, hy, '#4a64a8');
  p.px(8, hy + 1, INKB[4]);
  if (mode === 'hurt' || mode === 'daze') {
    // eyes squeezed shut
    p.line(9, hy - 1, 10, hy - 1, INKB[4]);
    p.line(13, hy - 1, 14, hy - 1, INKB[4]);
  } else {
    // two big eyes (white glint toward the light), two small ones above, a faint glow under them
    const glint = mode === 'aim' ? '#ffffff' : CYAN.hot;
    p.px(9, hy - 1, glint);
    p.px(10, hy - 1, CYAN.mid);
    p.px(13, hy - 1, glint);
    p.px(14, hy - 1, CYAN.mid);
    p.px(11, hy - 1, INKB[0]);
    p.px(12, hy - 1, INKB[0]);
    p.px(10, hy, CYAN.low);
    p.px(13, hy, CYAN.low);
    const blink = mode === 'idle' && k === 1;
    p.px(11, hy - 2, blink ? INKB[2] : CYAN.mid);
    p.px(12, hy - 2, blink ? INKB[2] : CYAN.low);
  }
  p.px(11, hy + 3, PAPER[3]);
  p.px(12, hy + 3, PAPER[2]);
  p.px(11, hy + 2, INKB[1]);
  p.px(12, hy + 2, INKB[1]);

  // ---- front legs: walking, or the right one working the needle / thread
  const l1 = legAt(0, false);
  const r1 = legAt(0, true);
  if (mode === 'aim') {
    leg(p, l1.h, l1.k, l1.f, nU, nL, jt);
    // the right front leg lifts the needle over the book, ready to throw
    leg(p, r1.h, [19, 9 + by], [18, 3], nU, nL, jt);
    p.rect(8, 1, 3, 3, BRASS[1]);
    p.px(9, 2, CYAN.hot);
    p.rect(11, 1, 10, 3, BRASS[2]);
    p.rect(11, 1, 10, 1, BRASS[3]);
    p.rect(11, 3, 10, 1, BRASS[1]);
    p.rect(21, 2, 2, 1, BRASS[3]);
    p.px(23, 2, '#ffffff');
    if (k) p.px(22, 2, '#ffffff');
  } else if (mode === 'reel') {
    // both front legs reach out to the right, hauling the thread in hand over hand
    const t = k % 2;
    leg(p, r1.h, [19, 13 + by], [23 - t, 14 + by], nU, nL, jt);
    leg(p, l1.h, [12, 18], [21 - (1 - t), 16 + by], nU, nL, jt);
    p.px(23 - t, 14 + by, CYAN.hot);
  } else if (mode === 'sew') {
    // front legs work the binding thread in front of the head
    const t = [[20, 12], [19, 10], [21, 11]][k % 3];
    const u = [[18, 13], [20, 13], [18, 11]][k % 3];
    leg(p, r1.h, [18, 9 + by], [t[0], t[1] + by], nU, nL, jt);
    leg(p, l1.h, [13, 18], [u[0], u[1] + by], nU, nL, jt);
    p.px(t[0], t[1] + by, CYAN.hot);
    p.px(u[0], u[1] + by, CYAN.mid);
  } else {
    leg(p, l1.h, l1.k, l1.f, nU, nL, jt);
    leg(p, r1.h, r1.k, r1.f, nU, nL, jt);
  }
  if (mode === 'hurt') {
    p.px(9, ay + 2, '#ffffff');
    p.px(14, ay + 5, '#ffffff');
  }
}
const SOPT = { anchor: 'bottom' as const, outline: AOUT };
frames('bspider', 'idle', 2, SW, SH, (p, i) => paintSpider(p, i, 'idle'), { ...SOPT, fps: 3 });
frames('bspider', 'walk', 4, SW, SH, (p, i) => paintSpider(p, i, 'walk'), { ...SOPT, fps: 14 });
frames('bspider', 'aim', 2, SW, SH, (p, i) => paintSpider(p, i, 'aim'), { ...SOPT, fps: 10 });
frames('bspider', 'reel', 2, SW, SH, (p, i) => paintSpider(p, i, 'reel'), { ...SOPT, fps: 8 });
frames('bspider', 'sew', 3, SW, SH, (p, i) => paintSpider(p, i, 'sew'), { ...SOPT, fps: 9 });
frames('bspider', 'daze', 1, SW, SH, (p) => paintSpider(p, 0, 'daze'), SOPT);
frames('bspider', 'hurt', 1, SW, SH, (p) => paintSpider(p, 0, 'hurt'), SOPT);

// the needle (points right): a brass eye with the cyan thread through it, a lit shaft, a white-hot point
defineDrawnSprite('__bspider_needle', 13, 5, (p) => {
  const pal = BUL.page;
  p.rect(0, 1, 3, 3, pal.rim);
  p.px(1, 2, CYAN.hot);
  p.px(0, 1, pal.color);
  p.rect(3, 1, 6, 3, pal.color);
  p.rect(3, 1, 6, 1, pal.core);
  p.rect(3, 3, 6, 1, pal.rim);
  p.rect(9, 2, 2, 1, pal.core);
  p.px(9, 1, pal.rim);
  p.px(9, 3, pal.rim);
  p.px(11, 2, '#ffffff');
  p.px(12, 2, '#ffffff');
}, { outline: BUL.page.outline });

// ================================================================== pure helpers
/** Spot `back` px behind an ally at (ax, ay) as seen from the keeper at (px, py). */
export function coverSpot(ax: number, ay: number, px: number, py: number, back = 26): { x: number; y: number } {
  const dx = ax - px;
  const dy = ay - py;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { x: ax + back, y: ay };
  return { x: ax + (dx / d) * back, y: ay + (dy / d) * back };
}

export interface MendCandidate {
  id: string;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  /** alive, visible, hittable, awake and not a boss */
  ok: boolean;
  /** last time it was mended (by any spider) */
  mendedAt: number;
}

/**
 * The ally a spider at (x, y) should sew at time `now`: the most torn-up one (lowest HP
 * fraction, below `MEND.below`) within `MEND.range`, never another spider, never one mended
 * in the last `MEND.again` s. Index into `list`, or -1. Ties keep the earlier entry.
 */
export function pickMendTarget(list: MendCandidate[], x: number, y: number, now: number): number {
  let best = -1;
  let bestK: number = MEND.below;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (!o.ok || o.id === ID || o.maxHp <= 0) continue;
    if (now - o.mendedAt < MEND.again) continue;
    if (Math.hypot(o.x - x, o.y - y) > MEND.range) continue;
    const k = o.hp / o.maxHp;
    if (k < bestK) {
      bestK = k;
      best = i;
    }
  }
  return best;
}

// ================================================================== world helpers
/** Where the thread leaves the spider (its front-leg tips) in world space. */
export function handPos(e: Enemy): { x: number; y: number } {
  return { x: e.x + e.facing * HAND.dx, y: e.y - e.z + HAND.dy };
}

function mendable(e: Enemy, o: Enemy): boolean {
  return o !== e && o.alive && !o.dead && !o.hidden && o.vulnerable && !o.isBoss && o.dormant <= 0 && o.def.id !== ID;
}

function findMendTarget(e: Enemy, w: World): Enemy | null {
  const cands: Enemy[] = [];
  const list: MendCandidate[] = [];
  for (const o of w.enemies) {
    if (o === e) continue;
    cands.push(o);
    list.push({ id: o.def.id, hp: o.hp, maxHp: o.maxHp, x: o.x, y: o.y, ok: mendable(e, o), mendedAt: (o.mem.__mendedAt as number) ?? -99 });
  }
  const i = pickMendTarget(list, e.x, e.y, w.time);
  if (i < 0) return null;
  const o = cands[i];
  return w.room.lineOfSight(e.x, e.y, o.x, o.y) ? o : null;
}

/** The ally to hide behind: the nearest sizeable non-spider monster (small fliers only if nothing else). */
function coverAlly(e: Enemy, w: World): Enemy | null {
  let best: Enemy | null = null;
  let bestD = Infinity;
  for (const o of w.enemies) {
    if (o === e || !o.alive || o.hidden || o.def.id === ID) continue;
    const d = Math.hypot(o.x - e.x, o.y - e.y) + (o.r < 5 ? 120 : 0);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

/** Where to skitter next: behind an ally, or (alone) keeping 80–110 px from the keeper. */
function skitterGoal(e: Enemy, w: World): { x: number; y: number } {
  const tg = e.target(w);
  const room = w.room;
  let g: { x: number; y: number };
  const ally = coverAlly(e, w);
  const d = Math.hypot(e.x - tg.x, e.y - tg.y);
  if (d < 44) {
    // too close: scuttle straight away
    const a = Math.atan2(e.y - tg.y, e.x - tg.x) + (e.mem.side as number) * 0.4;
    g = { x: e.x + Math.cos(a) * 60, y: e.y + Math.sin(a) * 60 };
  } else if (ally) {
    g = coverSpot(ally.x, ally.y, tg.x, tg.y, 24 + ally.r);
  } else {
    const a = Math.atan2(e.y - tg.y, e.x - tg.x) + (e.mem.side as number) * 0.55;
    const r = clamp(d, 80, 110);
    g = { x: tg.x + Math.cos(a) * r, y: tg.y + Math.sin(a) * r };
  }
  return {
    x: clamp(g.x, room.interiorX + 10, room.interiorX + room.interiorW - 10),
    y: clamp(g.y, room.interiorY + 10, room.interiorY + room.interiorH - 10),
  };
}

// ================================================================== the needle
function stick(p: Projectile, w: World, owner: Enemy): void {
  p.mem.st = 1;
  p.mem.t = 0;
  p.speed = 0;
  p.syncVel();
  // the way back is marked for the whole time the needle sits
  const h = handPos(owner);
  const back = Math.atan2(h.y - p.y, h.x - p.x);
  laneWarning(w, p.x, p.y, back, Math.hypot(h.x - p.x, h.y - p.y), NEEDLE.width, NEEDLE.stuck);
  w.particles.burst(p.x, p.y - p.z, { count: 5, speed: [20, 60], life: [0.12, 0.25], colors: ['#ffffff', BUL.page.color, BUL.page.rim], size: [1, 1] });
  w.sfx('hit_metal', { vol: 0.25, pitch: 1.7, x: p.x });
}

/**
 * Behavior of the needle on a thread: it flies `len` px (or until a rock / wall), sticks for
 * `NEEDLE.stuck` s, then is reeled back eye-first to the spider and caught. A needle whose
 * spider died falls slack and vanishes.
 */
function needleThread(owner: Enemy, len: number): ProjBehavior {
  return {
    id: 'bspider-needle',
    update(p, w, dt) {
      if (!owner.alive) {
        p.expire(w, false);
        return;
      }
      const st = p.mem.st ?? 0;
      if (st === 0) {
        p.mem.lx = p.x;
        p.mem.ly = p.y;
        if (p.traveled >= len) stick(p, w, owner);
      } else if (st === 1) {
        p.mem.t = (p.mem.t ?? 0) + dt;
        if (p.mem.t >= NEEDLE.stuck) {
          p.mem.st = 2;
          p.spectral = true;
          w.sfx('clock_ratchet', { vol: 0.35, pitch: 1.6, x: p.x });
        }
      }
      if ((p.mem.st ?? 0) === 2) {
        const h = handPos(owner);
        const d = Math.hypot(h.x - p.x, h.y - p.y);
        if (d < NEEDLE.catchR) {
          // caught: back in the spider's legs
          p.dead = true;
          w.particles.burst(h.x, h.y - 2, { count: 3, speed: [10, 30], life: [0.1, 0.2], colors: [BUL.page.core, CYAN.mid], size: [1, 1] });
          return;
        }
        p.angle = Math.atan2(h.y - p.y, h.x - p.x);
        p.speed = NEEDLE.reel;
        p.syncVel();
      }
    },
    onWall(p, w) {
      if ((p.mem.st ?? 0) === 0) {
        // thunk: it bites into the rock just short of it
        p.x = p.mem.lx ?? p.x;
        p.y = p.mem.ly ?? p.y;
        stick(p, w, owner);
      }
      return true;
    },
    draw(p, r, w) {
      const st = p.mem.st ?? 0;
      const ny = p.y - p.z;
      // the thread from the spider's legs to the needle's eye
      if (owner.alive) {
        const h = handPos(owner);
        const ex = p.x - Math.cos(p.angle) * (st === 2 ? -4 : 4);
        const ey = ny - Math.sin(p.angle) * (st === 2 ? -4 : 4);
        if (st === 1) {
          const blink = Math.floor(w.time * 16) % 2 === 0;
          r.pixelLine(h.x, h.y, ex, ey, '#140c1c', 3, 0.5);
          r.pixelLine(h.x, h.y, ex, ey, blink ? '#ffffff' : WARN_RED, 1, 0.95);
        } else {
          r.pixelLine(h.x, h.y, ex, ey, CYAN.mid, 1, 0.8);
        }
      }
      r.shadow(p.x, p.y + 1, 7, 2.5, 0.25);
      // flies point-first; reeled back eye-first
      r.sprite('__bspider_needle', p.x, ny, { rot: st === 2 ? p.angle + Math.PI : p.angle });
    },
  };
}

// ================================================================== stitch mark (cosmetic)
/** A cross-stitch popping on a mended ally, with a gilt "+" rising off it. Purely visual. */
class StitchMark extends Entity {
  static override readonly cosmetic = true;
  ally: Enemy;
  dx: number;
  constructor(ally: Enemy) {
    super();
    this.ally = ally;
    this.dx = fx.range(-4, 4);
    this.x = ally.x;
    this.y = ally.y;
    this.layer = 2;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.age > 0.6 || !this.ally.alive) this.dead = true;
    this.x = this.ally.x;
    this.y = this.ally.y;
  }

  override draw(r: Renderer): void {
    const a = this.ally;
    const k = clamp(this.age / 0.6, 0, 1);
    const cx = a.x + this.dx;
    const cy = a.y - a.z - a.r - 3;
    const al = 1 - k * k;
    r.pixelLine(cx - 2, cy - 2, cx + 2, cy + 2, CYAN.hot, 1, al);
    r.pixelLine(cx - 2, cy + 2, cx + 2, cy - 2, CYAN.mid, 1, al);
    const py = cy - 6 - k * 8;
    r.rect(cx - 1, py, 3, 1, GOLD, al);
    r.rect(cx, py - 1, 1, 3, GOLD, al);
    r.rect(cx, py, 1, 1, '#fff6d8', al);
  }
}

// ================================================================== scripts
function* skitter(e: Enemy, w: World, time: number): Script {
  let el = 0;
  while (el < time) {
    const goal = skitterGoal(e, w);
    const burst = w.rng.range(0.26, 0.42);
    for (let t = 0; t < burst && el < time; t += w.dt, el += w.dt) {
      const d = Math.hypot(goal.x - e.x, goal.y - e.y);
      if (d > 4) {
        e.setAnim('bspider_walk');
        e.moveDir(goal.x - e.x, goal.y - e.y, Math.min(e.speed, d * 5));
      } else {
        e.setAnim('bspider_idle');
        e.stop();
      }
      if (e.mem.__bumped) e.mem.side = -(e.mem.side as number);
      yield;
    }
    // spiders freeze between scuttles
    e.stop();
    e.setAnim('bspider_idle');
    const pause = w.rng.range(0.14, 0.3);
    for (let t = 0; t < pause && el < time; t += w.dt, el += w.dt) yield;
  }
}

/** Telegraphed needle throw: out along a lane, stuck, reeled back along the same line. */
function* throwNeedles(e: Enemy, w: World): Script {
  e.halt();
  const a0 = e.angleToTarget(w);
  e.facing = Math.cos(a0) >= 0 ? 1 : -1;
  e.setAnim('bspider_aim');
  const angles = e.champion ? [a0 - NEEDLE.spread, a0 + NEEDLE.spread] : [a0];
  const lens = angles.map((a) => Math.max(24, Math.min(NEEDLE.reach, rayFree(w.room, e.x, e.y, a, 3, NEEDLE.reach + 8, true))));
  for (let i = 0; i < angles.length; i++) laneWarning(w, e.x, e.y, angles[i], lens[i] + 6, NEEDLE.width, NEEDLE.windup);
  e.telegraph(NEEDLE.windup);
  gather(w, e.x + e.facing * 4, e.y - 16, [BUL.page.core, BUL.page.color], 6, 10);
  w.sfx('enemy_charge', { vol: 0.35, pitch: 1.6, x: e.x });
  yield NEEDLE.windup;
  e.setAnim('bspider_reel', true);
  e.squash(0.85, 1.15);
  const shots: Projectile[] = [];
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i];
    shots.push(e.shoot(w, a, {
      x: e.x + Math.cos(a) * 6, y: e.y + Math.sin(a) * 4, z: 6, speed: NEEDLE.speed, radius: 3, range: 4000, life: 8,
      color: BUL.page.color, style: 'none', light: 14, knockback: 90,
      behaviors: [needleThread(e, lens[i])],
    }));
  }
  w.sfx('whoosh', { vol: 0.4, pitch: 1.5, x: e.x });
  // holds still, paying out and reeling in the thread
  for (let el = 0; el < 3.6 && shots.some((s) => !s.dead); el += w.dt) {
    e.stop();
    yield;
  }
  e.setAnim('bspider_idle');
  yield 0.35;
}

/** Walk up to a torn ally and sew it: three stitches unless a hit snaps the thread. */
function* mend(e: Enemy, w: World, ally: Enemy): Script {
  for (let el = 0; el < 1.5; el += w.dt) {
    if (!mendable(e, ally)) return;
    const d = Math.hypot(ally.x - e.x, ally.y - e.y);
    if (d < MEND.reach) break;
    e.setAnim('bspider_walk');
    e.moveDir(ally.x - e.x, ally.y - e.y, e.speed);
    yield;
  }
  e.halt();
  if (!mendable(e, ally) || Math.hypot(ally.x - e.x, ally.y - e.y) > MEND.range) return;
  e.facing = ally.x >= e.x ? 1 : -1;
  e.setAnim('bspider_sew');
  e.mem.mend = ally;
  e.mem.mendId = ally.id;
  e.mem.sewing = 1;
  e.mem.sewK = 0;
  e.mem.snap = 0;
  ally.mem.__mendedAt = w.time;
  w.sfx('quill_write', { vol: 0.35, pitch: 1.3, x: e.x });
  // the thread shoots across to the ally
  for (let el = 0; el < MEND.thread && !e.mem.snap && mendable(e, ally); el += w.dt) {
    e.mem.sewK = el / MEND.thread;
    e.stop();
    yield;
  }
  e.mem.sewK = 1;
  for (let s = 0; s < MEND.stitches; s++) {
    for (let el = 0; el < MEND.gap && !e.mem.snap && mendable(e, ally); el += w.dt) {
      e.stop();
      yield;
    }
    if (e.mem.snap || !mendable(e, ally)) break;
    const heal = Math.max(1, ally.maxHp * MEND.stitch);
    ally.hp = Math.min(ally.maxHp, ally.hp + heal);
    ally.mem.__mendedAt = w.time;
    e.mem.stitched = ((e.mem.stitched as number) ?? 0) + 1;
    w.spawn(new StitchMark(ally));
    w.particles.burst(ally.x, ally.y - ally.z - ally.r, { count: 5, speed: [15, 40], life: [0.25, 0.45], colors: [CYAN.hot, CYAN.mid, GOLD], size: [1, 1], additive: true, light: 4 });
    w.sfx('quill_write', { vol: 0.3, pitch: 1.6 + s * 0.15, x: ally.x });
  }
  const snapped = !!e.mem.snap;
  const h = { x: e.x + e.facing * SEW.dx, y: e.y + SEW.dy };
  const mx = (h.x + ally.x) / 2;
  const my = (h.y + ally.y - ally.r) / 2;
  e.mem.sewing = 0;
  e.mem.mend = null;
  e.mem.mendId = 0;
  e.mem.mendCd = w.time + MEND.cooldown;
  if (snapped) {
    // the thread snaps: the spider reels back, dazed
    w.particles.burst(mx, my, { count: 8, speed: [30, 80], life: [0.2, 0.4], colors: [CYAN.hot, CYAN.mid, CYAN.low], size: [1, 1] });
    w.spawn(new RingFx(e.x, e.y - 6, 12, 0.25, CYAN.mid, 1));
    w.sfx('page_rip', { vol: 0.4, pitch: 1.4, x: e.x });
    e.setAnim('bspider_daze');
    e.mem.dazed = 1;
    for (let el = 0; el < MEND.daze; el += w.dt) {
      e.stop();
      dizzy(w, e);
      yield;
    }
    e.mem.dazed = 0;
  }
  e.setAnim('bspider_idle');
  yield 0.2;
}

// ================================================================== 제본 거미 (bookbinding spider)
defineEnemy({
  id: ID,
  name: '제본 거미',
  hp: 30,
  radius: 6,
  speed: 62,
  sprite: 'bspider_idle',
  spriteYOffset: S_YO,
  shadow: 16,
  cost: 2,
  floors: [6],
  weight: 0.8,
  champion: true,
  deathFx: 'blood',
  bloodColor: '#24305a',
  dieSfx: 'page_rip',
  light: { radius: 14, color: CYAN.mid },
  init(e, w) {
    e.mem.side = w.rng.sign();
    e.mem.mendCd = 0;
    e.mem.stitched = 0;
  },
  *script(e, w) {
    yield w.rng.range(0.4, 0.9);
    while (true) {
      const alone = !coverAlly(e, w);
      yield* skitter(e, w, alone ? w.rng.range(0.8, 1.2) : w.rng.range(1.1, 1.7));
      // (a charmed spider fights for the keeper: it stops sewing the keeper's foes)
      const ally = w.time >= (e.mem.mendCd as number) && !e.hasStatus('charm') ? findMendTarget(e, w) : null;
      if (ally) {
        yield* mend(e, w, ally);
        continue;
      }
      const tg = e.target(w);
      if (e.distToTarget(w) <= NEEDLE.reach + 12 && w.room.lineOfSight(e.x, e.y, tg.x, tg.y)) yield* throwNeedles(e, w);
    }
  },
  onHurt(e, _w, hit) {
    // a direct hit while it sews snaps the binding thread
    if (e.mem.sewing && hit.kind !== 'status') e.mem.snap = 1;
  },
  update(e, w) {
    if (e.mem.sewing && fx.chance(0.2)) {
      w.particles.spawn({ x: e.x - e.facing * 9 + fx.range(-1, 1), y: e.y - 6, vy: fx.range(-6, -2), life: fx.range(0.2, 0.4), colors: [CYAN.hot, CYAN.mid], size: 1, additive: true });
    }
  },
  draw(e, r, w) {
    // the binding thread to the ally it is sewing, stitches running along it
    const ally = e.mem.mend as Enemy | null;
    if (e.mem.sewing && ally && ally.alive) {
      const hx = e.x + e.facing * SEW.dx;
      const hy = e.y - e.z + SEW.dy;
      const tx = ally.x;
      const ty = ally.y - ally.z - ally.r;
      const k = clamp((e.mem.sewK as number) ?? 0, 0, 1);
      const ex = hx + (tx - hx) * k;
      const ey = hy + (ty - hy) * k;
      r.pixelLine(hx, hy, ex, ey, '#06101a', 3, 0.45);
      r.pixelLine(hx, hy, ex, ey, CYAN.mid, 1, 0.9);
      if (k >= 1) {
        for (let i = 0; i < 3; i++) {
          const t = (w.time * 1.6 + i / 3) % 1;
          r.rect(hx + (tx - hx) * t - 1, hy + (ty - hy) * t - 1, 2, 2, CYAN.hot, 0.95);
        }
        r.pixelRing(tx, ty, 4 + Math.sin(w.time * 12), CYAN.mid, 1, 0.7);
      }
    }
    e.drawDefault(r, hurtFrame(e, w, 'bspider_hurt_0'));
  },
  onDeath(e, w) {
    pages(w, e.x, e.y - 6, 3, 40);
    w.particles.burst(e.x, e.y - 5, { count: 12, speed: [30, 90], life: [0.3, 0.6], colors: [BRASS[3], BRASS[2], COVER, CYAN.mid], size: [1, 2], gravity: 300, vz: [30, 90], shape: 'square', vrot: 8 });
    w.particles.burst(e.x, e.y - 5, { count: 6, speed: [20, 50], life: [0.3, 0.5], colors: [CYAN.hot, CYAN.mid], size: [1, 1], additive: true });
  },
});
