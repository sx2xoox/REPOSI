// Floor 5 — 공허의 심장 (void abyss), part 4:
//  - 별그물 거미 (star weaver): a skittish void spider that never attacks head-on. It keeps
//    its distance in stop-and-go bursts, then rears up with a thread of starlight strung
//    between its raised forelegs and weaves 별그물 — a ring of star knots and burning
//    threads — around the keeper. The ring is traced harmlessly first (red dotted circle,
//    an opening that faces the spider unless rocks block that way), then the threads ignite and the ring tightens
//    until it snaps. Leave through the opening (toward the spider), break out through a
//    thread (one hit, thrown outward), or kill / stun the weaver: the web dies with it.
//    Only one web hangs in a room at a time; a champion's web turns as it closes.
// Pure helpers (web radius, knots, thread hit test) are unit-tested in
// tests/enemies-extra-f5.test.ts.

import { defineEnemy } from '../../game/defs';
import { Entity } from '../../game/entity';
import type { PixelPainter } from '../../engine/painter';
import { RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { clamp, distToSegment, TAU } from '../../engine/math';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { Script } from '../../engine/script';
import { frames, gather, hurtFrame, landingSpot, sphere, starSprite, WARN_RED } from './shared';
import { VOIDDUST, VPINK, VTEAL } from './abyss';

const VOUT = '#08020f';

// ================================================================== 별그물 거미 (star weaver)
/** Void chitin of the legs and head, darkest first (lit from the top-left). */
const CAR = ['#0c0718', '#1e1240', '#33226a', '#523c98', '#8068c8', '#b8a6f0'];
/** The abdomen: a deep starry void under a glossy violet rim. */
const ABD = ['#0a0614', '#140c2c', '#20164a', '#30246a', '#463a90'];
const GLOSS = '#9a88e0';
/** Starlight silk: gold thread with a white-hot core. */
const SILK = { hot: '#ffffff', core: '#fff3a8', mid: '#ffd84a', low: '#c8861a', rim: '#2a1200' };

type WeaverMode = 'idle' | 'skitter' | 'weave' | 'hold' | 'crouch' | 'leap' | 'hurt';

/** One leg: attach (body) -> knee (raised joint) -> foot. Mirrored for the right side. */
interface Leg {
  ax: number; ay: number; kx: number; ky: number; fx: number; fy: number;
}

/** Sprite size: 25 wide (centre x 12), headroom on top for the raised forelegs. */
const WV_W = 25;
const WV_H = 22;
/** Left-side legs (front A .. back D), body at rest. */
const LEGS: Leg[] = [
  { ax: 10, ay: 17, kx: 7, ky: 15, fx: 6, fy: 21 },
  { ax: 9, ay: 16, kx: 4, ky: 13, fx: 3, fy: 20 },
  { ax: 9, ay: 15, kx: 2, ky: 11, fx: 0, fy: 16 },
  { ax: 9, ay: 14, kx: 4, ky: 7, fx: 1, fy: 10 },
];

function paintWeaver(p: PixelPainter, k: number, mode: WeaverMode): void {
  const CX = 12;
  const bob = mode === 'skitter' ? [0, -1, 0, -1][k] : mode === 'crouch' ? 2 : mode === 'leap' ? -1 : mode === 'hold' ? 1 : mode === 'hurt' ? 1 : mode === 'weave' ? -1 : 0;
  const breath = mode === 'idle' ? k * 0.3 : mode === 'hold' ? k * 0.4 : 0;
  const lifted = (i: number, side: number) => mode === 'skitter' && k % 2 === 0 && ((i + (side > 0 ? 1 : 0) + (k >> 1)) % 2 === 0);

  const leg = (l: Leg, i: number, side: number) => {
    const mx = (x: number) => CX + side * (CX - x);
    let { ax, ay, kx, ky, fx: fx0, fy } = l;
    ay += bob;
    if (mode === 'leap') {
      // airborne: every leg flung wide
      ky -= 2;
      kx -= 1;
      fx0 -= 1;
      fy -= 3;
    } else if (mode === 'crouch') {
      ky += 2;
      kx -= 1;
      fx0 -= 1;
    } else if (mode === 'hold') {
      // braced wide, tugging the web
      kx -= 1;
      fx0 -= 1;
      ky += 1;
    } else if (mode === 'hurt') {
      // legs curl in
      kx += 1;
      ky += 1;
      fx0 += 2;
      fy -= 1;
    } else if (mode === 'weave' && i === 0) {
      // forelegs raised high, the silk strung between their tips
      ay -= 1;
      kx = 2;
      ky = 7;
      fx0 = 6;
      fy = 1;
    } else if (mode === 'weave') {
      ky += 1;
    }
    if (lifted(i, side)) {
      ky -= 1;
      fy -= 1;
      fx0 += i < 2 ? 0 : 1;
    }
    const lit = side < 0;
    const raised = mode === 'weave' && i === 0;
    p.line(mx(ax), ay, mx(kx), ky, raised ? CAR[4] : lit ? CAR[4] : CAR[3]);
    p.line(mx(kx), ky, mx(fx0), fy, raised ? CAR[4] : lit ? CAR[3] : CAR[2]);
    // the knee catches the light; the foot is a tiny claw
    p.px(mx(kx), ky, lit || raised ? CAR[5] : CAR[4]);
    p.px(mx(fx0), fy, raised ? SILK.core : CAR[4]);
  };

  // back legs (behind the abdomen)
  for (const side of [-1, 1]) leg(LEGS[3], 3, side);
  for (const side of [-1, 1]) leg(LEGS[2], 2, side);

  // abdomen: a deep starry void with a glossy rim and a constellation net on its back
  const acy = 10 + bob - (mode === 'weave' ? 1 : 0);
  const arx = 6 + breath * 0.5;
  const ary = 5 + breath * 0.5;
  const hot = mode === 'weave' || mode === 'hold';
  p.ellipse(CX, acy, arx, ary, ABD[2]);
  sphere(p, CX, acy, arx, ary, ABD, false);
  for (let a = 200; a <= 290; a += 9) {
    const r = (a * Math.PI) / 180;
    p.pxIn(CX + Math.cos(r) * (arx - 0.9), acy + Math.sin(r) * (ary - 0.9), GLOSS);
  }
  p.pxIn(CX - 3, acy - 4, '#c8bcf4');
  // starfield speckles
  const speck: [number, number][] = [[CX - 4, acy + 1], [CX + 4, acy - 1], [CX + 1, acy + 3], [CX - 1, acy - 3]];
  for (let i = 0; i < speck.length; i++) p.pxIn(speck[i][0], speck[i][1], (i + k) % 3 === 0 ? '#ffffff' : '#8a7cc8');
  const net: [number, number][] = [[CX - 3, acy - 2], [CX + 3, acy - 2], [CX - 3, acy + 2], [CX + 3, acy + 2]];
  for (const [x, y] of net) p.line(CX, acy, x, y, hot ? SILK.low : '#4a3c8a');
  for (const [x, y] of net) p.px(x, y, hot ? SILK.mid : SILK.low);
  // the bright star at its heart
  const twinkle = mode === 'idle' ? k % 2 === 0 : true;
  p.px(CX, acy - 1, SILK.mid);
  p.px(CX - 1, acy, SILK.mid);
  p.px(CX + 1, acy, SILK.mid);
  p.px(CX, acy + 1, SILK.mid);
  p.px(CX, acy, twinkle ? SILK.hot : SILK.core);
  // spinnerets on top: lit while it spins
  const top = Math.round(acy - ary);
  p.px(CX, top + 1, hot ? SILK.core : CAR[4]);
  if (hot) p.px(CX, top, SILK.hot);

  // middle + front legs (in front of the abdomen)
  for (const side of [-1, 1]) leg(LEGS[1], 1, side);
  for (const side of [-1, 1]) leg(LEGS[0], 0, side);

  // cephalothorax, set off from the abdomen by a dark seam
  const hy = 16 + bob;
  p.ellipse(CX, hy - 0.6, 4.3, 3.1, VOUT);
  p.ellipse(CX, hy, 3.6, 2.7, CAR[3]);
  sphere(p, CX, hy - 0.3, 3.6, 2.7, CAR.slice(1), false);
  // eyes: a big teal pair over a small pair
  if (mode === 'hurt') {
    p.px(CX - 1, hy - 1, VPINK.hot);
    p.px(CX + 1, hy - 1, VPINK.hot);
    p.px(CX - 2, hy - 2, VPINK.mid);
    p.px(CX + 2, hy - 2, VPINK.mid);
  } else {
    const glare = mode === 'weave' || mode === 'crouch' || mode === 'leap';
    p.px(CX - 1, hy - 1, glare ? VTEAL.hot : VTEAL.mid);
    p.px(CX + 1, hy - 1, glare ? VTEAL.hot : VTEAL.mid);
    p.px(CX, hy - 1, '#05020a');
    p.px(CX - 2, hy - 2, VTEAL.low);
    p.px(CX + 2, hy - 2, VTEAL.low);
    p.px(CX - 1, hy, VTEAL.low);
    p.px(CX + 1, hy, VTEAL.low);
  }
  // fangs
  const open = mode === 'weave' || mode === 'crouch' || mode === 'leap' ? 1 : 0;
  p.px(CX - 1 - open, hy + 2, VPINK.mid);
  p.px(CX + 1 + open, hy + 2, VPINK.mid);
  p.px(CX - 1 - open, hy + 3, VPINK.low);
  p.px(CX + 1 + open, hy + 3, VPINK.low);

  if (mode === 'weave') {
    // the star thread strung between the raised forelegs, a knot sliding along it
    p.line(6, 1, WV_W - 1 - 6, 1, SILK.mid);
    p.px(CX - 3 + k * 6, 1, SILK.hot);
    p.px(CX, 1, SILK.core);
    p.px(6, 0, SILK.hot);
    p.px(WV_W - 1 - 6, 0, SILK.hot);
  }
  if (mode === 'hold') {
    // a taut strand rising from the spinnerets
    for (let y = 0; y < top; y++) p.px(CX, y, (y + k) % 2 ? SILK.mid : SILK.core);
  }
}
frames('sweaver', 'idle', 2, WV_W, WV_H, (p, i) => paintWeaver(p, i, 'idle'), { anchor: 'bottom', fps: 3, outline: VOUT });
frames('sweaver', 'skitter', 4, WV_W, WV_H, (p, i) => paintWeaver(p, i, 'skitter'), { anchor: 'bottom', fps: 14, outline: VOUT });
frames('sweaver', 'weave', 2, WV_W, WV_H, (p, i) => paintWeaver(p, i, 'weave'), { anchor: 'bottom', fps: 10, outline: VOUT });
frames('sweaver', 'hold', 2, WV_W, WV_H, (p, i) => paintWeaver(p, i, 'hold'), { anchor: 'bottom', fps: 6, outline: VOUT });
frames('sweaver', 'crouch', 1, WV_W, WV_H, (p) => paintWeaver(p, 0, 'crouch'), { anchor: 'bottom', outline: VOUT });
frames('sweaver', 'leap', 1, WV_W, WV_H, (p) => paintWeaver(p, 0, 'leap'), { anchor: 'bottom', outline: VOUT });
frames('sweaver', 'hurt', 1, WV_W, WV_H, (p) => paintWeaver(p, 0, 'hurt'), { anchor: 'bottom', outline: VOUT });

// ------------------------------------------------------------------ the web
/** 별그물 tuning: warning time, radii, closing speed, opening, thread width, knots. */
export const WEB = {
  /** harmless tracing before the threads ignite (s) */
  mark: 0.6,
  /** radius when it ignites (px) */
  r0: 58,
  /** it snaps once this small (px): tight enough to catch a keeper who never moved */
  rEnd: 4,
  /** tightening speed (px/s) */
  close: 30,
  /** the opening that faces the weaver (rad) */
  gap: 1.15,
  /** half thickness of a burning thread; a keeper is hit within `p.r + half` */
  half: 2,
  /** per-keeper re-hit delay (s) */
  rehit: 0.8,
  knots: 10,
  knotsChamp: 12,
  /** a champion's web turns while it closes (rad/s) */
  spinChamp: 0.5,
  /** how far inside the room interior the web's centre stays (px) */
  margin: 30,
} as const;

/** Radius of a web `t` seconds after it ignited. */
export function webRadius(t: number): number {
  return Math.max(WEB.rEnd, WEB.r0 - WEB.close * Math.max(0, t));
}

/** Knots of a web: `n` points spread over the full circle except the opening centred on `gapDir`. */
export function webKnots(cx: number, cy: number, r: number, gapDir: number, n: number, gap: number = WEB.gap): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const start = gapDir + gap / 2;
  const span = TAU - gap;
  for (let i = 0; i < n; i++) {
    const a = start + (span * i) / (n - 1);
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

/** Does a keeper at (px, py) with radius pr touch one of the threads (consecutive knots)? */
export function onWeb(px: number, py: number, pr: number, knots: { x: number; y: number }[], half: number = WEB.half): boolean {
  for (let i = 0; i + 1 < knots.length; i++) {
    const a = knots[i];
    const b = knots[i + 1];
    if (distToSegment(px, py, a.x, a.y, b.x, b.y) < pr + half) return true;
  }
  return false;
}

/** A weaver that cannot hold its threads taut: the web goes slack. */
function weaverBusy(e: Enemy): boolean {
  return e.hasStatus('freeze') || e.hasStatus('stun') || e.hasStatus('fear') || e.hasStatus('charm');
}

/**
 * 별그물: the web a star weaver spins around a keeper. Gameplay entity (an enemy hazard,
 * erased by bullet-clears): traced harmlessly for WEB.mark seconds, then its threads burn
 * and it tightens at WEB.close px/s until it snaps; it breaks at once when its weaver dies
 * or is frozen / stunned / scared / charmed.
 */
export class StarWeb extends Entity {
  owner: Enemy;
  gapDir: number;
  spin: number;
  n: number;
  /** 0 = whole, >0 = seconds since it broke / snapped (fading out, harmless) */
  brokenT = 0;
  snapped = false;
  private hitAt = new Map<object, number>();

  constructor(owner: Enemy, x: number, y: number, gapDir: number, n: number, spin = 0) {
    super();
    this.owner = owner;
    this.x = x;
    this.y = y;
    this.gapDir = gapDir;
    this.n = n;
    this.spin = spin;
    this.layer = 0;
    this.tileCollide = false;
    this.team = 'enemy';
    this.enemyHazard = true;
  }

  get armed(): boolean {
    return this.brokenT <= 0 && this.age >= WEB.mark;
  }

  get radius(): number {
    return this.age < WEB.mark ? WEB.r0 : webRadius(this.age - WEB.mark);
  }

  knots(): { x: number; y: number }[] {
    return webKnots(this.x, this.y, this.radius, this.gapDir, this.n);
  }

  /** Erased by a bullet-clear: the threads go slack at once. */
  override onCleared(w: World): void {
    this.breakWeb(w, false);
  }

  breakWeb(w: World, snap: boolean): void {
    if (this.brokenT > 0) return;
    this.brokenT = 1e-6;
    this.snapped = snap;
    w.sfx(snap ? 'lightning' : 'whoosh', { vol: snap ? 0.3 : 0.35, pitch: snap ? 2.1 : 1.7, x: this.x });
    const ks = this.knots();
    for (const k of ks) {
      w.particles.burst(k.x, k.y - 1, { count: 3, speed: [20, 60], life: [0.2, 0.4], colors: [SILK.hot, SILK.mid, SILK.low], size: [1, 1], additive: true, light: 3 });
    }
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.brokenT > 0) {
      this.brokenT += dt;
      if (this.brokenT > 0.35) this.dead = true;
      return;
    }
    const o = this.owner;
    if (!o.alive || o.dead || weaverBusy(o)) {
      this.breakWeb(w, false);
      return;
    }
    if (this.age < WEB.mark) return;
    if (this.age - dt < WEB.mark) {
      // ignite
      w.sfx('laser', { vol: 0.32, pitch: 1.9, x: this.x });
      for (const k of this.knots()) w.particles.burst(k.x, k.y - 1, { count: 2, speed: [10, 40], life: [0.15, 0.3], colors: [SILK.hot, SILK.core], size: [1, 1], additive: true });
    }
    this.gapDir += this.spin * dt;
    if (this.radius <= WEB.rEnd) {
      this.breakWeb(w, true);
      return;
    }
    const ks = this.knots();
    for (const p of w.targets()) {
      if (!p.alive || p.z > 10) continue;
      const last = this.hitAt.get(p);
      if (last !== undefined && w.time - last < WEB.rehit) continue;
      if (!onWeb(p.x, p.y, p.r, ks)) continue;
      if (p.hurt(w, 1, o.def.name, false, this)) {
        this.hitAt.set(p, w.time);
        // thrown out of the web (away from its centre)
        const dx = p.x - this.x;
        const dy = p.y - this.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.5) p.knock(dx / d, dy / d, 170);
        else p.knock(Math.cos(this.gapDir), Math.sin(this.gapDir), 170);
      }
    }
    // starlight running along the threads
    if (fx.chance(0.6)) {
      const i = fx.int(0, ks.length - 2);
      const t = fx.next();
      const a = ks[i];
      const b = ks[i + 1];
      w.particles.spawn({
        x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t - 1, vx: fx.range(-8, 8), vy: -fx.range(4, 14),
        life: fx.range(0.2, 0.4), colors: [SILK.hot, SILK.core, SILK.mid], size: 1, additive: true, light: 3,
      });
    }
  }

  override draw(r: Renderer): void {
    const ks = this.knots();
    const knot = starSprite('star', 5);
    if (this.brokenT > 0) {
      // slack: the threads sag and fade
      const f = Math.max(0, 1 - this.brokenT / 0.35);
      const sag = this.brokenT * 30;
      for (let i = 0; i + 1 < ks.length; i++) {
        const a = ks[i];
        const b = ks[i + 1];
        r.pixelLine(a.x, a.y + sag * 0.5, (a.x + b.x) / 2, (a.y + b.y) / 2 + sag, this.snapped ? SILK.core : '#9a8ab8', 1, 0.8 * f);
        r.pixelLine((a.x + b.x) / 2, (a.y + b.y) / 2 + sag, b.x, b.y + sag * 0.5, this.snapped ? SILK.core : '#9a8ab8', 1, 0.8 * f);
      }
      return;
    }
    if (this.age < WEB.mark) {
      // tracing: a dotted red circle where the web will burn, the silk being spun along it,
      // bright posts at the opening and chevrons running out through it
      const t = this.age / WEB.mark;
      const blink = Math.floor(this.age * 16) % 2 === 0;
      const R = WEB.r0;
      const start = this.gapDir + WEB.gap / 2;
      const span = TAU - WEB.gap;
      // a dash every ~4 px around the arc, so it reads over a busy floor
      const dots = Math.round((span * R) / 4);
      for (let i = 0; i <= dots; i++) {
        const a = start + (span * i) / dots;
        r.rect(this.x + Math.cos(a) * R - 0.5, this.y + Math.sin(a) * R - 0.5, 2, 2, WARN_RED, blink ? 0.9 : 0.55);
      }
      r.circle(this.x, this.y, R, WARN_RED, 0.06 + 0.05 * t);
      // the silk traced so far
      const m = Math.max(1, Math.floor(t * (ks.length - 1) + 1e-6));
      for (let i = 0; i < m && i + 1 < ks.length; i++) r.pixelLine(ks[i].x, ks[i].y, ks[i + 1].x, ks[i + 1].y, SILK.low, 1, 0.75);
      for (let i = 0; i <= m && i < ks.length; i++) r.sprite(knot, ks[i].x, ks[i].y, { alpha: 0.55 });
      // the opening: two bright posts, and chevrons inside the ring running out through it
      const g = this.gapDir;
      const ex = Math.cos(g);
      const ey = Math.sin(g);
      const px = -ey;
      const py = ex;
      for (const a of [ks[0], ks[ks.length - 1]]) r.pixelDisc(a.x, a.y, 2, '#ffffff', 0.9);
      const run = (this.age * 2.2) % 1;
      for (let j = 0; j < 3; j++) {
        const q = (run + j / 3) % 1;
        const o = R * (0.35 + 0.55 * q);
        const tipX = this.x + ex * (o + 3);
        const tipY = this.y + ey * (o + 3);
        const al = 0.9 * Math.sin(q * Math.PI);
        r.pixelLine(this.x + ex * o + px * 4, this.y + ey * o + py * 4, tipX, tipY, '#ffffff', 1, al);
        r.pixelLine(this.x + ex * o - px * 4, this.y + ey * o - py * 4, tipX, tipY, '#ffffff', 1, al);
      }
      return;
    }
    // burning: dark-rimmed gold threads with a white-hot shimmer, star knots
    const pulse = 0.85 + 0.15 * Math.sin(this.age * 30);
    for (let i = 0; i + 1 < ks.length; i++) r.pixelLine(ks[i].x, ks[i].y, ks[i + 1].x, ks[i + 1].y, SILK.rim, 3, 0.9);
    for (let i = 0; i + 1 < ks.length; i++) r.pixelLine(ks[i].x, ks[i].y, ks[i + 1].x, ks[i + 1].y, SILK.mid, 1, pulse);
    const run = (this.age * 1.6) % 1;
    for (let i = 0; i + 1 < ks.length; i++) {
      const a = ks[i];
      const b = ks[i + 1];
      const q = (run + i * 0.37) % 1;
      r.rect(a.x + (b.x - a.x) * q - 0.5, a.y + (b.y - a.y) * q - 0.5, 1, 1, SILK.hot, 1);
    }
    for (const k of ks) r.sprite(knot, k.x, k.y, { rot: this.age * 3 });
    // the weaver's tug line (harmless): a faint strand from its spinnerets to the nearest end knot
    const o = this.owner;
    if (o.alive && !o.hidden) {
      const a = ks[0];
      const b = ks[ks.length - 1];
      const end = Math.hypot(a.x - o.x, a.y - o.y) < Math.hypot(b.x - o.x, b.y - o.y) ? a : b;
      r.pixelLine(o.x, o.y - 14, end.x, end.y, '#c8b8f0', 1, 0.3);
    }
  }

  override light(w: World): void {
    if (this.brokenT > 0) return;
    const ks = this.knots();
    const lit = this.age >= WEB.mark;
    for (let i = 0; i < ks.length; i += 2) w.lights.add(ks[i].x, ks[i].y, lit ? 22 : 14, lit ? '#ffd860' : '#ff5060', { intensity: lit ? 0.6 : 0.3 });
  }
}

/** Centre of a web around (x, y): the keeper, kept a little inside the room. */
export function webCentre(w: World, x: number, y: number): { x: number; y: number } {
  const room = w.room;
  const m = WEB.margin;
  return {
    x: clamp(x, room.interiorX + m, room.interiorX + room.interiorW - m),
    y: clamp(y, room.interiorY + m, room.interiorY + room.interiorH - m),
  };
}

/** Direction of the opening: toward the weaver, turned toward open floor if that way is blocked. */
export function pickGap(w: World, cx: number, cy: number, toward: number): number {
  const room = w.room;
  for (const d of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.1, -2.1, Math.PI]) {
    const a = toward + d;
    let ok = true;
    for (const rr of [WEB.r0 * 0.55, WEB.r0 + 10]) {
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (!room.isFree(x, y, 5)) {
        ok = false;
        break;
      }
    }
    if (ok) return a;
  }
  return toward;
}

/** The live (unbroken) web a weaver is holding, if any. */
function heldWeb(e: Enemy): StarWeb | null {
  const s = e.mem.web as StarWeb | undefined;
  return s && !s.dead && s.brokenT <= 0 ? s : null;
}

/** Another weaver in the room holds a live web (only one web hangs in a room at a time). */
export function othersWeaving(w: World, e: Enemy): boolean {
  for (const o of w.enemies) if (o !== e && o.alive && o.def.id === 'star_weaver' && heldWeb(o)) return true;
  return false;
}

/** Too close for comfort (a keeper rushing it). */
const HOP_NEAR = 40;

/**
 * Where to leap: about 58 px away from the keeper — straight back if there is room,
 * else along the wall or even over the keeper, whichever lands farthest from them.
 */
function hopSpot(w: World, e: Enemy): { x: number; y: number } {
  const t = e.target(w);
  const away = Math.atan2(e.y - t.y, e.x - t.x);
  let best = landingSpot(w, e.x + Math.cos(away) * 58, e.y + Math.sin(away) * 58, e.r);
  let bestD = Math.hypot(best.x - t.x, best.y - t.y);
  for (const d of [0.7, -0.7, 1.4, -1.4, 2.1, -2.1]) {
    const a = away + d;
    const s = landingSpot(w, e.x + Math.cos(a) * 58, e.y + Math.sin(a) * 58, e.r);
    const dd = Math.hypot(s.x - t.x, s.y - t.y);
    // the straighter leap wins unless a turned one lands clearly farther
    if (dd > bestD + 8) {
      best = s;
      bestD = dd;
    }
  }
  return best;
}

/** Leap away from a keeper who came too close (harmless in the air). */
function* hopBack(e: Enemy, w: World): Script {
  e.halt();
  e.setAnim('sweaver_crouch');
  w.sfx('enemy_charge', { vol: 0.2, pitch: 2.2, x: e.x });
  yield 0.18;
  const spot = hopSpot(w, e);
  e.setAnim('sweaver_leap');
  yield* e.jumpTo(w, spot.x, spot.y, 0.42, 22);
  e.setAnim('sweaver_idle');
  yield 0.2;
}

/** Rear up, trace the web around the keeper, then hold it while it tightens. */
function* weave(e: Enemy, w: World): Script {
  const tg = e.target(w);
  e.halt();
  e.setAnim('sweaver_weave');
  const c = webCentre(w, tg.x, tg.y);
  const gap = pickGap(w, c.x, c.y, Math.atan2(e.y - c.y, e.x - c.x));
  const web = w.spawn(new StarWeb(e, c.x, c.y, gap, e.champion ? WEB.knotsChamp : WEB.knots, e.champion ? WEB.spinChamp * w.rng.sign() : 0));
  e.mem.web = web;
  e.mem.weaving = 1;
  e.telegraph(WEB.mark);
  w.sfx('beam_charge', { vol: 0.35, pitch: 1.7, x: e.x });
  for (let el = 0; el < WEB.mark; el += 0.15) {
    gather(w, e.x, e.y - 16, [SILK.hot, SILK.mid, CAR[4]], 3, 12);
    yield 0.15;
  }
  e.setAnim('sweaver_hold');
  // hold the web taut while it tightens (a punish window)
  while (heldWeb(e)) yield;
  e.mem.web = undefined;
  e.mem.weaving = 0;
  e.setAnim('sweaver_idle');
  yield 0.5;
}

defineEnemy({
  id: 'star_weaver',
  name: '별그물 거미',
  hp: 34,
  radius: 7,
  speed: 64,
  sprite: 'sweaver_idle',
  spriteYOffset: 4,
  shadow: 20,
  cost: 2,
  floors: [5],
  weight: 0.8,
  champion: true,
  deathFx: 'void',
  bloodColor: '#9a78e8',
  light: { radius: 22, color: '#ffd860' },
  dieSfx: 'splat',
  *script(e, w) {
    yield w.rng.range(0.3, 0.8);
    let side = w.rng.sign();
    let wait = w.rng.range(1.0, 1.6);
    while (true) {
      e.mem.weaving = 0;
      // skitter: stop-and-go bursts, keeping 64–110 px from the keeper
      let near = false;
      for (let el = 0; el < wait && !near;) {
        const burst = w.rng.range(0.26, 0.4);
        e.setAnim('sweaver_skitter');
        const d = e.distToTarget(w);
        const to = e.angleToTarget(w);
        const a = d > 110 ? to + side * 0.5 : d < 64 ? to + Math.PI - side * 0.5 : to + (side * Math.PI) / 2;
        for (let t = 0; t < burst; t += w.dt) {
          e.moveAngle(a, e.speed);
          if (e.mem.__bumped) side = -side;
          yield;
        }
        el += burst;
        e.stop();
        e.setAnim('sweaver_idle');
        const pause = w.rng.range(0.16, 0.32);
        yield pause;
        el += pause;
        if (w.rng.chance(0.25)) side = -side;
        near = e.distToTarget(w) < HOP_NEAR;
      }
      if (near || e.distToTarget(w) < HOP_NEAR) {
        yield* hopBack(e, w);
        wait = 0.5;
        continue;
      }
      // (a charmed weaver cannot hold a web taut, so it does not start one)
      if (othersWeaving(w, e) || e.distToTarget(w) > 170 || e.hasStatus('charm')) {
        wait = 0.6;
        continue;
      }
      yield* weave(e, w);
      wait = w.rng.range(1.3, 1.9);
    }
  },
  update(e, w) {
    if (e.mem.weaving && fx.chance(0.25)) {
      w.particles.spawn({ x: e.x + fx.range(-3, 3), y: e.y - 16, vy: -fx.range(6, 16), life: fx.range(0.25, 0.5), colors: [SILK.hot, SILK.mid], size: 1, additive: true, light: 3 });
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'sweaver_hurt_0'));
  },
  onDeath(e, w) {
    w.spawn(new RingFx(e.x, e.y - 8, 18, 0.3, SILK.mid, 2));
    w.particles.burst(e.x, e.y - 8, { count: 16, speed: [40, 120], life: [0.3, 0.6], colors: [...VOIDDUST.slice(0, 3), SILK.mid], size: [1, 2], additive: true, light: 5 });
  },
});
