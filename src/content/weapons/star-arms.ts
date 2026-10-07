// Star arms: two legendary weapons that hold something in the sky.
//  별자리 지팡이  (constellation_staff, legendary) — places stars; three connect
//                                                  into a burning triangle that
//                                                  snaps shut on what is inside
//  태엽 정지 석궁 (stasis_arbalest, legendary)     — bolts stop and hang in the
//                                                  air, then all launch at once
// (떠도는 등령 and 점착 폭탄 쇠뇌 live in star-lamps.ts; shared helpers in arms-kit.ts.)

import { defineWeapon } from '../../game/defs';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import { Entity } from '../../game/entity';
import type { Enemy } from '../../game/enemy';
import type { Projectile, ProjBehavior } from '../../game/projectile';
import { RingFx } from '../../game/effects';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { HELD } from '../../game/seam';
import { visualHandPos } from '../../game/weapon-pose';
import { heldLocalPoint } from '../../game/weapon-presentation';
import { O, attackInterval, drawHeld, glowSprite, handPos, kick, muzzle, pixLine, segDist } from './common';
import { aimDistance, beginAttack, drawGun, shotFade } from './kit';
import { aimPoint, heldSprite, keeperHit, ownedBy, trackOwned } from './arms-kit';

// ================================================================== 별자리 지팡이
defineDrawnSprite('w_constellation_staff', 26, 13, (p) => {
  // lacquered night-blue shaft with silver fittings
  p.rect(0, 6, 17, 2, '#2a2a5a');
  p.line(0, 6, 16, 6, '#4a4a8a');
  p.rect(4, 5, 1, 4, '#c8d0e4');
  p.rect(12, 5, 1, 4, '#c8d0e4');
  // armillary head: a silver ring around a bright star
  p.ring(21, 6.5, 5.6, 1.2, '#a8b0d0');
  p.px(17, 3, '#e8ecff');
  p.px(18, 2, '#e8ecff');
  p.line(16, 6, 16, 7, '#6a72a0');
  // the star
  p.poly([21, 2.5, 22, 5.5, 25, 6.5, 22, 7.5, 21, 10.5, 20, 7.5, 17, 6.5, 20, 5.5], '#ffe8a0');
  p.rect(20, 6, 2, 1, '#ffffff');
  p.px(21, 5, '#ffffff');
  p.px(21, 7, '#fff4c8');
}, { outline: O, origin: [4, 7] });

/** A placed star (pivot at its center). */
defineDrawnSprite('fx_const_star', 9, 9, (p) => {
  p.poly([4.5, 0, 5.5, 3.5, 9, 4.5, 5.5, 5.5, 4.5, 9, 3.5, 5.5, 0, 4.5, 3.5, 3.5], '#bcd4ff');
  p.poly([4.5, 1.5, 5.2, 3.8, 7.5, 4.5, 5.2, 5.2, 4.5, 7.5, 3.8, 5.2, 1.5, 4.5, 3.8, 3.8], '#fff6d0');
  p.rect(4, 4, 1, 1, '#ffffff');
}, { outline: '#0c0c24' });

defineDrawnSprite('icon_constellation_staff', 16, 16, (p) => {
  p.line(1, 15, 8, 8, '#2a2a5a');
  p.line(2, 15, 9, 8, '#4a4a8a');
  p.px(4, 12, '#c8d0e4');
  // three stars joined into a triangle
  p.line(10, 2, 15, 7, '#8a9ad8');
  p.line(15, 7, 9, 10, '#8a9ad8');
  p.line(9, 10, 10, 2, '#8a9ad8');
  const star = (x: number, y: number) => {
    p.px(x, y - 1, '#fff6d0');
    p.px(x - 1, y, '#fff6d0');
    p.px(x + 1, y, '#fff6d0');
    p.px(x, y + 1, '#fff6d0');
    p.px(x, y, '#ffffff');
  };
  star(10, 2);
  star(14, 7);
  star(9, 10);
}, { outline: O });

/** Damage when a star is set down, to foes within `STAR_RADIUS` px (x weapon damage). */
export const STAR_PLACE = 0.6;
export const STAR_RADIUS = 10;
/** Seconds a lone star waits for the others. */
export const STAR_LIFE = 4;
/** The connected triangle: edges burn crossers (rehit) for `EDGE_TIME` s; the inside is struck once. */
export const CONSTELLATION_EDGE = 0.8;
export const CONSTELLATION_REHIT = 0.3;
export const CONSTELLATION_TIME = 0.8;
export const CONSTELLATION_BURST = 1.0;

/** A star placed by a keeper, waiting to be connected. */
export class StarMark extends Entity {
  owner: Player;
  mem: Record<string, number> = { dmg: 0 };
  constructor(owner: Player, x: number, y: number, dmg: number) {
    super();
    this.owner = owner;
    this.x = x;
    this.y = y;
    this.z = 6;
    this.mem.dmg = dmg;
    this.layer = 2;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.age >= STAR_LIFE) {
      this.dead = true;
      w.particles.burst(this.x, this.y - this.z, { count: 4, speed: [10, 30], life: [0.2, 0.4], colors: ['#bcd4ff', '#ffffff'], size: [1, 1], additive: true });
    }
  }

  override draw(r: Renderer, w: World): void {
    const left = STAR_LIFE - this.age;
    if (left < 0.6 && Math.floor(left * 14) % 2 === 0) return;
    const drop = Math.max(0, 1 - this.age / 0.12);
    const y = this.y - this.z;
    // falling streak as it is set down
    if (drop > 0) {
      r.line(this.x + 12 * drop, y - 40 * drop - 10, this.x, y, '#bcd4ff', 2, 0.6 * drop);
      pixLine(r, this.x + 6 * drop, y - 20 * drop - 4, this.x, y, '#ffffff', drop);
    }
    const tw = 1 + 0.12 * Math.sin(w.time * 9 + this.id * 1.3);
    r.shadow(this.x, this.y + 1, 5, 2, 0.2);
    r.sprite(glowSprite(14 * tw, '#9ab8ff'), this.x, y, { alpha: 0.45, additive: true });
    r.sprite('fx_const_star', this.x, y, { rot: this.age * 0.8, sx: tw, sy: tw, flash: drop });
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - this.z, 26, '#bcd4ff', { intensity: 0.55 });
  }
}

function pointInTriangle(px: number, py: number, t: number[]): boolean {
  const [ax, ay, bx, by, cx, cy] = t;
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Three stars joined: the edges burn whoever crosses them, the inside is struck once. */
export class Constellation extends Entity {
  owner: Player;
  /** corners [x0, y0, x1, y1, x2, y2] (ground) */
  pts: number[];
  mem: Record<string, number> = { dmg: 0 };
  next = new Map<number, number>();
  constructor(owner: Player, pts: number[], dmg: number) {
    super();
    this.owner = owner;
    this.pts = pts;
    this.x = (pts[0] + pts[2] + pts[4]) / 3;
    this.y = (pts[1] + pts[3] + pts[5]) / 3;
    this.mem.dmg = dmg;
    // starlight: drawn above the lighting pass so the lines stay bright in dark rooms
    this.layer = 3;
    this.tileCollide = false;
  }

  /** Is a foe touching one of the three edges? */
  onEdge(e: Enemy): boolean {
    const P = this.pts;
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      if (segDist(e.x, e.y, P[i * 2], P[i * 2 + 1], P[j * 2], P[j * 2 + 1]).d <= e.r + 3) return true;
    }
    return false;
  }

  override update(w: World, dt: number): void {
    const first = this.age === 0;
    this.age += dt;
    const p = this.owner;
    for (const e of [...w.enemies]) {
      if (!e.alive || e.hidden) continue;
      if (first) {
        // the snap: everything inside the triangle (or at its heart, for a small one)
        const inside = pointInTriangle(e.x, e.y, this.pts) || Math.hypot(e.x - this.x, e.y - this.y) < 14 + e.r * 0.5;
        if (inside && keeperHit(w, p, e, this.mem.dmg * CONSTELLATION_BURST, { src: this, kind: 'laser', fromX: this.x, fromY: this.y, knockback: 60 })) {
          w.particles.burst(e.x, e.y - e.z - 4, { count: 6, speed: [40, 120], life: [0.12, 0.3], colors: ['#ffffff', '#fff6d0', '#9ab8ff'], size: [1, 2], shape: 'spark', additive: true });
        }
      }
      if (w.time < (this.next.get(e.id) ?? -1) || !this.onEdge(e)) continue;
      this.next.set(e.id, w.time + CONSTELLATION_REHIT);
      keeperHit(w, p, e, this.mem.dmg * CONSTELLATION_EDGE, { src: this, kind: 'laser', fromX: this.x, fromY: this.y, knockback: 20, light: true });
    }
    if (first) {
      const P = this.pts;
      for (let i = 0; i < 3; i++) {
        w.spawn(new RingFx(P[i * 2], P[i * 2 + 1] - 6, 12, 0.25, '#fff6d0', 1));
        w.particles.burst(P[i * 2], P[i * 2 + 1] - 6, { count: 6, speed: [20, 70], life: [0.2, 0.45], colors: ['#ffffff', '#fff6d0', '#9ab8ff'], size: [1, 1], shape: 'spark', additive: true });
      }
      w.lights.glow(this.x, this.y, 60, '#bcd4ff', 0.5);
      w.renderer.screenFlash('#c8d8ff', 0.06);
      w.shake(0.06);
      w.sfx('clock_chime', { vol: 0.4, pitch: 1.6 });
      w.sfx('laser', { vol: 0.25, pitch: 1.8 });
    }
    // starlight trickles along the edges
    if (fx.chance(0.7)) {
      const P = this.pts;
      const i = Math.floor(fx.range(0, 3)) % 3;
      const j = (i + 1) % 3;
      const k = fx.range(0, 1);
      w.particles.spawn({ x: P[i * 2] + (P[j * 2] - P[i * 2]) * k, y: P[i * 2 + 1] + (P[j * 2 + 1] - P[i * 2 + 1]) * k - 6, vy: -15, life: 0.35, colors: ['#ffffff', '#bcd4ff'], size: 1, shape: 'pixel', additive: true });
    }
    if (this.age >= CONSTELLATION_TIME) this.dead = true;
  }

  override draw(r: Renderer): void {
    const t = this.age / CONSTELLATION_TIME;
    const a = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
    const P = this.pts;
    const lift = 6;
    // a soft fill flash inside at the snap
    if (this.age < 0.18) {
      const ctx = r.ctx;
      ctx.save();
      try {
        ctx.globalAlpha = 0.28 * (1 - this.age / 0.18) * r.worldOpacity;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#9ab8ff';
        ctx.beginPath();
        ctx.moveTo(Math.round(P[0] - r.viewX), Math.round(P[1] - lift - r.viewY));
        ctx.lineTo(Math.round(P[2] - r.viewX), Math.round(P[3] - lift - r.viewY));
        ctx.lineTo(Math.round(P[4] - r.viewX), Math.round(P[5] - lift - r.viewY));
        ctx.closePath();
        ctx.fill();
      } finally {
        ctx.restore();
      }
    }
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const x0 = P[i * 2];
      const y0 = P[i * 2 + 1] - lift;
      const x1 = P[j * 2];
      const y1 = P[j * 2 + 1] - lift;
      r.line(x0, y0, x1, y1, '#6a8ae8', 3, 0.35 * a);
      r.pixelLine(x0, y0, x1, y1, '#d8e4ff', 1, 0.9 * a);
      // a bright pulse running along each edge
      const k = (this.age * 2.4 + i / 3) % 1;
      r.rect(Math.round(x0 + (x1 - x0) * k), Math.round(y0 + (y1 - y0) * k), 1, 1, '#ffffff', a);
    }
    for (let i = 0; i < 3; i++) {
      r.sprite(glowSprite(16, '#bcd4ff'), P[i * 2], P[i * 2 + 1] - lift, { alpha: 0.6 * a, additive: true });
      r.sprite('fx_const_star', P[i * 2], P[i * 2 + 1] - lift, { sx: 1.3, sy: 1.3, flash: Math.max(0, 1 - this.age * 6), alpha: a });
    }
  }

  override light(w: World): void {
    const a = 1 - this.age / CONSTELLATION_TIME;
    w.lights.add(this.x, this.y - 6, 50, '#bcd4ff', { intensity: 0.7 * a });
  }
}

/** Draws the faint guide lines between a keeper's placed stars (and on to the aimed point); purely visual. */
class StarChart extends Entity {
  static override readonly cosmetic = true;
  owner: Player;
  room: number;
  constructor(owner: Player, room: number) {
    super();
    this.owner = owner;
    this.room = room;
    // guide lines read like a chart drawn over the room: above the lighting pass
    this.layer = 3;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const o = this.owner;
    if (!o.alive || o.weaponId !== 'constellation_staff' || this.room !== w.node.id) this.dead = true;
  }

  override draw(r: Renderer, w: World): void {
    const stars = ownedBy(w, StarMark, this.owner);
    if (!stars.length) return;
    // a dashed line that slowly crawls from star to star
    const dots = (x0: number, y0: number, x1: number, y1: number, alpha: number) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.floor(len / 1.5);
      const off = Math.floor(w.time * 10) % 6;
      for (let i = 3; i < n - 3; i++) {
        if ((i + 6 - off) % 6 >= 3) continue;
        const k = i / Math.max(1, n);
        r.rect(Math.round(x0 + (x1 - x0) * k), Math.round(y0 + (y1 - y0) * k), 1, 1, '#c8dcff', alpha);
      }
    };
    for (let i = 0; i + 1 < stars.length; i++) {
      const a = stars[i];
      const b = stars[i + 1];
      dots(a.x, a.y - a.z, b.x, b.y - b.z, 0.75);
    }
    // the line still to be drawn: from the newest star to the aimed point
    const o = this.owner;
    const inp = o.input;
    if (stars.length % 3 === 2 && inp && inp.held & HELD.cursorAim) {
      const last = stars[stars.length - 1];
      const first = stars[stars.length - 2];
      dots(last.x, last.y - last.z, inp.cx, inp.cy - 6, 0.4);
      dots(first.x, first.y - first.z, inp.cx, inp.cy - 6, 0.3);
    }
  }
}

const charts = new WeakMap<Player, StarChart>();


defineWeapon({
  id: 'constellation_staff',
  name: '별자리 지팡이',
  desc: '조준한 곳에 별을 놓아 그 자리의 적을 친다. 별 셋이 모이면 별자리로 이어져, 빛의 선이 지나는 적을 태우고 안쪽의 적을 한꺼번에 내리친다.',
  icon: 'icon_constellation_staff',
  heldSprite: 'w_constellation_staff',
  kind: 'ranged',
  archetype: '별자리',
  rarity: 'legendary',
  tags: ['staff', 'arcane'],
  pools: ['boss', 'secret'],
  stats(m) {
    m.mulStat('fireRate', 0.7);
  },
  update(w, p, st, _dt, firing, aim) {
    const chart = charts.get(p);
    if (!chart || chart.dead || chart.room !== w.node.id) charts.set(p, w.spawn(new StarChart(p, w.node.id)));
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.weaponStats;
    const t = aimPoint(w, p, aim, 16, s.range * 0.85, 80);
    const n = Math.max(1, Math.floor(s.shots));
    const placed: StarMark[] = [];
    for (let i = 0; i < n; i++) {
      // extra stars (multishot) fan out across the aim line
      const off = (i - (n - 1) / 2) * 14;
      const at = w.room.nearestFree(t.x - Math.sin(aim) * off, t.y + Math.cos(aim) * off, 3);
      const star = trackOwned(w, w.spawn(new StarMark(p, at.x, at.y, s.damage)));
      placed.push(star);
      for (const e of [...w.enemies]) {
        if (!e.alive || e.hidden) continue;
        if (Math.hypot(e.x - at.x, e.y - at.y) > STAR_RADIUS + e.r) continue;
        keeperHit(w, p, e, s.damage * STAR_PLACE, { src: star, kind: 'laser', fromX: at.x, fromY: at.y - 20, knockback: 40 });
      }
      w.particles.burst(at.x, at.y - 6, { count: 6, speed: [20, 70], life: [0.15, 0.35], colors: ['#ffffff', '#fff6d0', '#9ab8ff'], size: [1, 1], shape: 'spark', additive: true });
    }
    // three stars (oldest first) connect into a constellation
    const all = ownedBy(w, StarMark, p).filter((q) => !placed.includes(q)).concat(placed);
    for (let i = 0; i + 2 < all.length; i += 3) {
      const tri = all.slice(i, i + 3);
      for (const q of tri) q.dead = true;
      w.spawn(new Constellation(p, [tri[0].x, tri[0].y, tri[1].x, tri[1].y, tri[2].x, tri[2].y], s.damage));
    }
    const h = handPos(p, aim, 22);
    muzzle(w, h.x, h.y, aim, ['#ffffff', '#fff6d0', '#9ab8ff'], 4, [30, 90]);
    kick(w, aim + Math.PI, 0.6);
    w.sfx('shoot_magic', { vol: 0.35, pitch: 1.6 + w.rng.next() * 0.1 });
    w.sfx('orb', { vol: 0.18, pitch: 2.4 });
  },
  onHolster(w, p) {
    // unconnected stars scatter when the staff is put away
    for (const q of ownedBy(w, StarMark, p)) q.dead = true;
  },
  draw(w, p, r, st) {
    const f = shotFade(st, w, 0.18);
    drawHeld(r, p, heldSprite('constellation_staff'), p.aim, 4 - f * 2, { flash: f * 0.35 });
    const h = visualHandPos(p, p.aim, 4 - f * 2);
    const q = heldLocalPoint(h.x, h.y, p.aim, 17, 0);
    const n = ownedBy(w, StarMark, p).length % 3;
    // the head glows brighter with each star waiting to be joined
    r.sprite(glowSprite(9 + n * 3 + f * 8 + Math.sin(w.time * 5), '#bcd4ff'), q.x, q.y, { alpha: 0.35 + n * 0.12 + f * 0.3, additive: true });
  },
});

// ================================================================== 태엽 정지 석궁
defineDrawnSprite('w_stasis_arbalest', 19, 13, (p) => {
  // brass stock with a clock dial set into it
  p.rect(0, 5, 12, 3, '#7a5a30');
  p.line(0, 5, 11, 5, '#c89a50');
  p.rect(2, 8, 2, 3, '#4a3418');
  p.circle(5.5, 6.5, 2.6, '#e8e0c8');
  p.ring(5.5, 6.5, 2.6, 1, '#c8a040');
  p.line(5, 6, 5, 5, '#2a2030');
  p.line(5, 6, 7, 6, '#2a2030');
  // prod of blued steel with a gear at the center
  for (let y = 0; y < 13; y++) {
    const k = (y - 6) / 6;
    p.px(Math.round(13 - 2.5 * k * k), y, y === 0 || y === 12 ? '#c8d0e4' : '#3a5a8a');
  }
  p.line(10, 0, 10, 12, '#e8e0d0');
  p.circle(12.5, 6.5, 1.6, '#c8a040');
  p.px(12, 6, '#fff0a0');
  // bolt on the rail (a clock hand)
  p.line(8, 6, 17, 6, '#c8a040');
  p.poly([16, 4.5, 19, 6, 16, 7.5], '#2a2030');
  p.px(17, 6, '#fff0a0');
}, { outline: O, origin: [3, 6] });

/** The bolt: a long clock hand (pivot at its middle). */
defineDrawnSprite('proj_stasis_bolt', 12, 5, (p) => {
  p.ring(1.5, 2.5, 1.6, 1, '#c8a040');
  p.line(3, 2, 8, 2, '#e0b850');
  p.poly([8, 0.5, 12, 2.5, 8, 4.5], '#2a2030');
  p.line(8, 2, 10, 2, '#8a92ac');
  p.px(4, 2, '#fff0a0');
}, { outline: '#100c18', origin: [6, 2] });

defineDrawnSprite('icon_stasis_arbalest', 16, 16, (p) => {
  // a clock dial behind the arbalest
  p.circle(6, 6, 5, '#e8e0c8');
  p.shadeSphere(6, 6, 5, 5, ['#a89c80', '#d0c6a8', '#ece4cc', '#fffaf0'], { dither: true });
  p.ring(6, 6, 5.2, 1, '#c8a040');
  p.px(6, 2, '#5a4a3a');
  p.px(2, 6, '#5a4a3a');
  p.px(9, 6, '#5a4a3a');
  p.px(6, 9, '#5a4a3a');
  p.line(6, 6, 6, 3, '#3a3048');
  p.line(6, 6, 8, 6, '#3a3048');
  p.circle(6, 6, 0.8, '#c8a040');
  // the arbalest along the bottom, its bolt a clock hand
  p.rect(1, 11, 10, 3, '#7a5a30');
  p.rect(1, 11, 10, 1, '#c89a50');
  p.rect(2, 14, 2, 2, '#4a3418');
  for (let y = 5; y < 16; y++) {
    const k = (y - 11.5) / 5.5;
    p.px(Math.round(13 - 2.2 * k * k), y, y === 5 || y === 15 ? '#c8d0e4' : '#3a5a8a');
  }
  p.line(11, 5, 10, 12, '#e8e0d0');
  p.line(11, 16, 10, 12, '#e8e0d0');
  p.line(6, 12, 13, 12, '#e0b850');
  p.poly([13, 10.5, 16, 12, 13, 13.5], '#2a2030');
  p.px(7, 12, '#fff0a0');
}, { outline: O });

/** Damage of a bolt passing through on its way out (x weapon damage). */
export const STASIS_OUT = 0.4;
/** Damage of a launched bolt (x weapon damage). */
export const STASIS_LAUNCH = 1.3;
/** Bolts that can hang at once (more launch them all). */
export function stasisCapacity(shots: number): number {
  return 8 + 2 * Math.max(0, Math.floor(shots) - 1);
}
/** Seconds without firing before the hanging bolts launch. */
export const STASIS_IDLE = 0.5;
/** Longest the first bolt hangs before everything launches. */
export const STASIS_HOLD = 3;
/** Stagger between the launches of one release (s). */
const STASIS_STAGGER = 0.03;

/** Phases of a stasis bolt (pr.mem.phase). */
const OUT = 0;
const HANG = 1;
const GONE = 2;

function launchBolt(pr: Projectile, w: World): void {
  const owner = pr.owner as Player | null;
  // the nearest foe to this bolt, else on toward the aimed point
  let best: Enemy | null = null;
  let bd = 280;
  for (const e of w.enemies) {
    if (!e.alive || e.hidden) continue;
    const d = Math.hypot(e.x - pr.x, e.y - pr.y);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  let a = pr.mem.aim ?? pr.angle;
  if (best) {
    if (bd > 0.5) a = Math.atan2(best.y - best.z * 0.3 - pr.y, best.x - pr.x);
  } else if (owner?.input && owner.input.held & HELD.cursorAim) {
    const cx = owner.input.cx;
    const cy = owner.input.cy;
    if (Math.hypot(cx - pr.x, cy - pr.y) > 6) a = Math.atan2(cy - pr.y, cx - pr.x);
  }
  pr.mem.phase = GONE;
  pr.angle = a;
  pr.speed = pr.mem.launchSpeed ?? 360;
  pr.syncVel();
  pr.damage = Number(pr.mem.weaponDamage ?? owner?.weaponStats.damage ?? 10) * STASIS_LAUNCH;
  pr.pierce = pr.mem.launchPierce ?? 0;
  pr.traveled = 0;
  pr.range = 300;
  pr.life = pr.age + 2;
  pr.hitIds.clear();
  w.particles.burst(pr.x, pr.y - pr.z, { count: 6, speed: [40, 120], angle: a + Math.PI, spread: 0.8, life: [0.08, 0.2], colors: ['#ffffff', '#ffe8a0', '#c8a040'], size: [1, 2], shape: 'spark', additive: true });
  w.spawn(new RingFx(pr.x, pr.y - pr.z, 7, 0.14, '#ffe8a0', 1));
  w.sfx('shoot_arrow', { vol: 0.2, pitch: 1.5 + fx.range(-0.05, 0.1), x: pr.x });
}

const stasisFx: ProjBehavior = {
  id: 'stasis_bolt',
  update(pr, w) {
    const phase = pr.mem.phase ?? OUT;
    if (phase === OUT && pr.traveled >= (pr.mem.stop ?? 80)) {
      // stop dead in the air: the clock is held
      pr.mem.phase = HANG;
      pr.mem.hangAt = w.time;
      pr.speed = 0;
      pr.syncVel();
      pr.range = 1e9;
      pr.life = 1e9;
      w.particles.burst(pr.x, pr.y - pr.z, { count: 4, speed: [10, 40], life: [0.15, 0.3], colors: ['#ffe8a0', '#c8a040'], size: [1, 1], shape: 'pixel' });
      w.sfx('clock_tick', { vol: 0.22, pitch: 1.6 + fx.range(-0.05, 0.05), x: pr.x });
    }
    if ((pr.mem.phase ?? OUT) !== HANG) return;
    // hanging bolts touch nothing until they launch
    for (const e of w.enemies) pr.hitIds.add(e.id);
    for (const h of w.hittables) pr.hitIds.add(h.id);
    // a bolt that came to rest after its arbalest was put away lets itself go
    const owner = pr.owner as Player | null;
    if ((pr.mem.launchAt ?? -1) < 0 && (!owner || owner.weaponId !== 'stasis_arbalest' || w.time - (pr.mem.hangAt ?? w.time) > STASIS_HOLD + 1)) pr.mem.launchAt = w.time;
    const at = pr.mem.launchAt ?? -1;
    if (at >= 0 && w.time >= at) launchBolt(pr, w);
  },
  onWall(pr) {
    // a bolt that meets a wall on the way out hangs right in front of it
    if ((pr.mem.phase ?? OUT) !== OUT) return false;
    pr.x -= Math.cos(pr.angle) * 4;
    pr.y -= Math.sin(pr.angle) * 4;
    pr.mem.stop = pr.traveled;
    return true;
  },
  draw(pr, r, w) {
    const phase = pr.mem.phase ?? OUT;
    const y = pr.y - pr.z;
    if (phase !== HANG) {
      if (phase === GONE) r.sprite(glowSprite(9, '#ffe8a0'), pr.x, y, { alpha: 0.5, additive: true });
      r.sprite('proj_stasis_bolt', pr.x, y, { rot: pr.angle });
      return;
    }
    // hanging: a faint clock face, the bolt ticking round it like a hand
    const hang = w.time - (pr.mem.hangAt ?? w.time);
    const ticks = Math.floor(hang / 0.25);
    const armed = (pr.mem.launchAt ?? -1) >= 0;
    const a = armed ? pr.angle : pr.angle + ticks * (Math.PI / 6);
    r.pixelRing(pr.x, y, 6, '#c8a040', 1, 0.35);
    for (let i = 0; i < 4; i++) r.rect(Math.round(pr.x + Math.cos(i * Math.PI / 2) * 6), Math.round(y + Math.sin(i * Math.PI / 2) * 6), 1, 1, '#fff0a0', 0.6);
    const settle = hang - ticks * 0.25 < 0.04 ? 0.08 : 0;
    r.sprite(glowSprite(10, '#ffe8a0'), pr.x, y, { alpha: 0.3 + settle * 3, additive: true });
    r.sprite('proj_stasis_bolt', pr.x, y, { rot: a + settle, flash: armed ? 0.6 : settle * 4 });
  },
};

/** This keeper's bolts hanging in the air (oldest first). */
export function hangingBolts(w: World, p: Player): Projectile[] {
  const out: Projectile[] = [];
  for (const pr of w.projectiles) {
    if (pr.dead || pr.owner !== p || pr.mem.phase !== HANG || (pr.mem.launchAt ?? -1) >= 0) continue;
    if (!pr.behaviors.some((b) => b.id === 'stasis_bolt')) continue;
    out.push(pr);
  }
  return out;
}

/** Release every hanging bolt (staggered a hair apart). */
function release(w: World, p: Player, st: { mem: Record<string, number> }, bolts: Projectile[]): void {
  if (!bolts.length) return;
  for (let i = 0; i < bolts.length; i++) bolts[i].mem.launchAt = w.time + i * STASIS_STAGGER;
  st.mem.releaseAt = w.time;
  st.mem.released = bolts.length;
  const n = bolts.length;
  w.renderer.screenFlash('#ffe8b0', Math.min(0.16, 0.05 + n * 0.012));
  w.shake(Math.min(0.2, 0.04 + n * 0.015));
  w.sfx('clock_snap', { vol: 0.5, pitch: 1.1 });
  w.sfx('clock_rewind', { vol: 0.3, pitch: 1.5 });
  if (n >= 5) w.sfx('clock_chime', { vol: 0.25, pitch: 1.3 });
}

defineWeapon({
  id: 'stasis_arbalest',
  name: '태엽 정지 석궁',
  desc: '화살이 조준한 거리에서 멈춰 허공에 매달린다. 사격을 멈추거나, 여덟 발이 차거나, 잠시 지나면 모두 한꺼번에 가장 가까운 적에게 날아간다.',
  icon: 'icon_stasis_arbalest',
  heldSprite: 'w_stasis_arbalest',
  kind: 'ranged',
  archetype: '정지',
  rarity: 'legendary',
  tags: ['bow'],
  pools: ['boss', 'secret'],
  stats(m) {
    m.mulStat('fireRate', 0.8);
    m.mulStat('shotSpeed', 1.3);
  },
  update(w, p, st, _dt, firing, aim) {
    if (firing) st.mem.lastFire = w.time;
    const s = p.weaponStats;
    const bolts = hangingBolts(w, p);
    if (bolts.length) {
      const first = Math.min(...bolts.map((b) => b.mem.hangAt ?? w.time));
      const idle = w.time - (st.mem.lastFire ?? -9) >= STASIS_IDLE;
      if (idle || bolts.length >= stasisCapacity(s.shots) || w.time - first >= STASIS_HOLD) release(w, p, st, bolts);
    }
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const h = handPos(p, aim, 14);
    const d = aimDistance(w, p, 30, s.range * 0.9, 90);
    const shots = p.fireProjectiles(w, aim, {
      style: 'none', damageMult: STASIS_OUT, pierce: 99, range: 1e9, life: 1e9, color: '#ffe8a0', light: 8, x: h.x, y: h.y,
      radius: Math.max(1.5, s.projSize - 0.5), behaviors: [stasisFx], fxMaterial: 'metal', spreadMult: 0.7,
    });
    for (const pr of shots) {
      pr.mem.phase = OUT;
      pr.mem.stop = Math.max(8, d - 14);
      pr.mem.aim = aim;
      pr.mem.launchSpeed = s.shotSpeed * 1.4;
      pr.mem.launchPierce = s.pierce;
      // flies true to the mark (no drift from the keeper's stride)
      pr.vx = Math.cos(pr.angle) * pr.speed;
      pr.vy = Math.sin(pr.angle) * pr.speed;
    }
    muzzle(w, h.x, h.y, aim, ['#ffffff', '#ffe8a0', '#c8a040'], 4, [30, 100]);
    kick(w, aim + Math.PI, 0.8);
    w.sfx('shoot_arrow', { vol: 0.4, pitch: 0.95 + w.rng.next() * 0.08 });
    w.sfx('clock_ratchet', { vol: 0.18, pitch: 1.4 });
  },
  onHolster(w, p, st) {
    // putting the arbalest away lets the clock run: everything hanging flies
    release(w, p, st, hangingBolts(w, p));
  },
  draw(w, p, r, st) {
    const f = shotFade(st, w, 0.14);
    const rel = w.time - (st.mem.releaseAt ?? -9);
    const rf = rel >= 0 && rel < 0.25 ? 1 - rel / 0.25 : 0;
    drawGun(r, w, p, st, heldSprite('stasis_arbalest'), 6, 2.5, { flash: Math.max(f > 0.7 ? 0.3 : 0, rf * 0.6) });
    // the dial on the stock counts the hanging bolts
    const n = hangingBolts(w, p).length;
    const cap = stasisCapacity(p.weaponStats.shots);
    const h = visualHandPos(p, p.aim, 6);
    const q = heldLocalPoint(h.x, h.y, p.aim, 2.5, 0.5);
    const a = -Math.PI / 2 + (n / cap) * Math.PI * 2;
    if (n > 0) {
      r.sprite(glowSprite(6 + n, '#ffe8a0'), q.x, q.y, { alpha: 0.25 + 0.05 * n, additive: true });
      pixLine(r, q.x, q.y, q.x + Math.cos(a) * 2.5, q.y + Math.sin(a) * 2.5, '#c84030', 1);
    }
    if (rf > 0) r.sprite(glowSprite(14 * rf + 6, '#ffe8a0'), q.x, q.y, { alpha: rf * 0.7, additive: true });
  },
});
