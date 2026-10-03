// Melee attacks (Sephiria-style swings). A swing is a short-lived arc hitbox
// around its owner that hits each enemy once, breaks pots, and deflects
// (destroys — or, with `reflect`, sends back) enemy projectiles it touches.
// Visuals: a pixel "smear" that sweeps across the arc and thins out, plus a
// spark burst and a small camera kick on every connecting hit.

import { Entity, type Actor, type HitInfo } from './entity';
import type { World } from './world';
import type { Renderer } from '../engine/renderer';
import { angleDiff, angleTo, dist } from '../engine/math';
import { Projectile } from './projectile';
import { TILE } from './constants';
import { tileProps } from './tiles';
import { defineDrawnSprite, hasSprite } from '../engine/sprites';
import { bayer } from '../engine/painter';
import { fx } from '../engine/rng';

export interface SwingOpts {
  angle: number;
  /** total arc in radians */
  arc: number;
  /** reach in px from the owner's center */
  reach: number;
  damage: number;
  knockback?: number;
  /** active hit time (s) */
  duration?: number;
  /** total visual time (s) */
  visual?: number;
  color?: string;
  /** deflect enemy bullets */
  deflect?: boolean;
  /** deflected bullets fly back as player shots instead of vanishing */
  reflect?: boolean;
  statuses?: HitInfo['statuses'];
  /** thrust instead of arc: hit area is a rectangle `reach` long, `arc` px wide */
  thrust?: boolean;
  /** swing direction for the visual: 1 = clockwise */
  swingDir?: number;
  /** visual style: sweeping smear (default), legacy crescent, or nothing (weapon draws its own) */
  style?: 'smear' | 'crescent' | 'none';
  /** camera kick per connecting hit (px, default 1.5) */
  hitKick?: number;
  /** hits skip item hooks and ember gain (special moves) */
  noProc?: boolean;
  release?: boolean;
  /** extra callback per enemy hit */
  onHit?: (w: World, target: Actor, hit: HitInfo) => void;
}

type Resolved = Required<Omit<SwingOpts, 'statuses' | 'onHit'>> & Pick<SwingOpts, 'statuses' | 'onHit'>;

export class MeleeSwing extends Entity {
  owner: Actor;
  o: Resolved;
  hitIds = new Set<number>();
  tilesHit = new Set<number>();
  /** number of enemies this swing connected with */
  hits = 0;

  constructor(owner: Actor, o: SwingOpts) {
    super();
    this.owner = owner;
    this.o = {
      knockback: 140, duration: 0.1, visual: 0.18, color: '#ffffff', deflect: true, reflect: false, thrust: false, swingDir: 1,
      style: 'smear', hitKick: 1.5, noProc: false, release: false,
      ...o,
    };
    this.x = owner.x;
    this.y = owner.y - 3;
    this.team = owner.team;
    this.layer = 2;
    this.tileCollide = false;
  }

  /** Is world point (px,py) with radius pr inside the hit area? */
  contains(px: number, py: number, pr: number): boolean {
    const d = dist(this.x, this.y, px, py);
    if (this.o.thrust) {
      const dx = px - this.x;
      const dy = py - this.y;
      const c = Math.cos(this.o.angle);
      const s = Math.sin(this.o.angle);
      const along = dx * c + dy * s;
      const across = Math.abs(-dx * s + dy * c);
      return along > -pr && along < this.o.reach + pr && across < this.o.arc / 2 + pr;
    }
    if (d > this.o.reach + pr) return false;
    if (d < pr + 6) return true;
    const a = angleTo(this.x, this.y, px, py);
    return Math.abs(angleDiff(this.o.angle, a)) <= this.o.arc / 2 + Math.atan2(pr, d);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    this.x = this.owner.x;
    this.y = this.owner.y - 3;
    if (this.age <= this.o.duration) {
      // enemies
      if (this.team === 'player') {
        for (const e of w.enemies) {
          if (!e.alive || this.hitIds.has(e.id) || e.hidden || e.z > 24) continue;
          if (!this.contains(e.x, e.y - e.z * 0.5, e.r)) continue;
          this.hitIds.add(e.id);
          const d = Math.hypot(e.x - this.x, e.y - this.y) || 1;
          const hit: HitInfo = {
            damage: this.o.damage, kind: 'melee', source: this, attacker: this.owner,
            dirX: (e.x - this.x) / d, dirY: (e.y - this.y) / d, knockback: this.o.knockback, statuses: this.o.statuses,
            noProc: this.o.noProc || undefined,
            release: this.o.release || undefined,
          };
          if (w.applyHit(e, hit)) {
            this.hits++;
            this.impact(w, e.x - (e.x - this.x) / d * e.r * 0.6, e.y - e.z - 3 - (e.y - this.y) / d * e.r * 0.6, hit.crit === true);
            this.o.onHit?.(w, e, hit);
          }
        }
        for (const h of w.hittables) {
          if (this.hitIds.has(h.id) || !this.contains(h.x, h.y, h.r)) continue;
          this.hitIds.add(h.id);
          h.takeHit(w, { damage: this.o.damage, kind: 'melee', attacker: this.owner });
        }
        // pots in reach
        const r = this.o.reach;
        const tx0 = Math.floor((this.x - r) / TILE);
        const tx1 = Math.floor((this.x + r) / TILE);
        const ty0 = Math.floor((this.y - r) / TILE);
        const ty1 = Math.floor((this.y + r) / TILE);
        for (let ty = ty0; ty <= ty1; ty++) {
          for (let tx = tx0; tx <= tx1; tx++) {
            const key = ty * 1000 + tx;
            if (this.tilesHit.has(key)) continue;
            if (!tileProps(w.room.tileAt(tx, ty)).breakable) continue;
            if (!this.contains((tx + 0.5) * TILE, (ty + 0.5) * TILE, 6)) continue;
            this.tilesHit.add(key);
            w.room.damageTile(w, tx, ty, this.o.damage);
          }
        }
      } else {
        // enemy swing: every keeper it reaches (single-player: the keeper)
        for (const pl of w.coop ? w.players : [w.player]) {
          if (this.hitIds.has(pl.id) || !this.contains(pl.x, pl.y, pl.r)) continue;
          this.hitIds.add(pl.id);
          pl.hurt(w, Math.max(1, Math.round(this.o.damage)), (this.owner as { def?: { name: string } }).def?.name ?? '공격');
        }
      }
      // deflect bullets
      if (this.o.deflect) {
        for (const p of w.projectiles) {
          if (p.dead || p.team === this.team || p.delay > 0) continue;
          if (!this.contains(p.x, p.y, p.r)) continue;
          if (this.o.reflect && this.team === 'player') reflectProjectile(w, p, this);
          else p.expire(w, true);
          w.particles.burst(p.x, p.y, { count: 7, speed: [40, 120], life: [0.1, 0.25], colors: ['#ffffff', '#ffe080'], shape: 'spark', size: [1, 2] });
          w.sfx('parry', { vol: 0.5 });
          if (!this.o.noProc) w.items.onDeflect(p);
        }
      }
    }
    if (this.age >= this.o.visual) this.dead = true;
  }

  /** Spark burst + kick where a hit lands. */
  private impact(w: World, x: number, y: number, crit: boolean): void {
    w.particles.burst(x, y, {
      count: crit ? 9 : 5, speed: [50, 150], angle: this.o.angle, spread: 1.6, life: [0.08, 0.2],
      colors: ['#ffffff', this.o.color, '#ffe8a0'], shape: 'spark', size: [1, 2],
    });
    w.spawn(new ImpactFx(x, y, this.o.angle, crit ? 1.4 : 1, this.o.color));
    if (this.o.hitKick > 0 && (!w.coop || this.owner === w.local)) w.renderer.kick(Math.cos(this.o.angle) * this.o.hitKick, Math.sin(this.o.angle) * this.o.hitKick);
  }

  override draw(r: Renderer): void {
    const t = this.age / this.o.visual;
    if (this.o.style === 'none') return;
    if (this.o.thrust) {
      const name = slashSprite(this.o.color, true);
      const ext = Math.min(1, t * 3.5);
      r.sprite(name, this.x + Math.cos(this.o.angle) * this.o.reach * 0.5 * ext, this.y + Math.sin(this.o.angle) * this.o.reach * 0.5 * ext, {
        rot: this.o.angle, sx: (this.o.reach / 28) * (0.4 + 0.6 * ext), sy: Math.max(0.4, this.o.arc / 12) * (1 - t * 0.5), alpha: 1 - t * t,
      });
      return;
    }
    const flipY = this.o.swingDir < 0;
    if (this.o.style === 'crescent') {
      const name = slashSprite(this.o.color, false);
      const scale = this.o.reach / 26;
      const sweep = (t - 0.5) * 0.6 * this.o.swingDir;
      r.sprite(name, this.x, this.y, { rot: this.o.angle + sweep, sx: scale, sy: scale * (this.o.arc / 2.4), flipY, alpha: t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4 });
      return;
    }
    const frame = Math.min(SMEAR_FRAMES - 1, Math.floor(t * SMEAR_FRAMES));
    const name = smearSprite(this.o.reach, this.o.arc, this.o.color, frame);
    r.sprite(name, this.x, this.y, { rot: this.o.angle, flipY });
  }

  override light(w: World): void {
    if (this.age < this.o.visual * 0.7) {
      w.lights.add(this.x + Math.cos(this.o.angle) * this.o.reach * 0.6, this.y + Math.sin(this.o.angle) * this.o.reach * 0.6, this.o.reach, '#fff0d0', { intensity: 0.5 });
    }
  }
}

/** Turn an enemy bullet into a player shot flying away from the swing. */
export function reflectProjectile(w: World, p: Projectile, sw: { x: number; y: number; o: { angle: number; color: string } }): void {
  const pl = w.player;
  const a = Math.atan2(p.y - sw.y, p.x - sw.x);
  // aim mostly along the swing, nudged toward where the bullet already is
  const ang = sw.o.angle + angleDiff(sw.o.angle, a) * 0.35;
  p.team = 'player';
  p.owner = pl;
  p.damage = pl.stats.damage * 0.8;
  p.angle = ang;
  p.speed = Math.max(220, p.speed * 1.6);
  p.syncVel();
  p.traveled = 0;
  p.range = 320;
  p.age = 0;
  p.life = 3;
  p.homing = 0;
  p.curve = 0;
  p.accel = 0;
  p.pierce = 1;
  p.color = '#fff0b0';
  p.hitIds.clear();
  p.generation = Math.max(1, p.generation);
  p.behaviors = [];
  w.particles.burst(p.x, p.y, { count: 4, speed: [20, 60], life: [0.1, 0.2], colors: [sw.o.color, '#ffffff'], size: [1, 2] });
}

/** Short 4-point star flash at an impact point. */
export class ImpactFx extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  ang: number;
  size: number;
  color: string;
  constructor(x: number, y: number, ang: number, size: number, color: string) {
    super();
    this.x = x;
    this.y = y;
    this.ang = ang + fx.range(-0.4, 0.4);
    this.size = size;
    this.color = color;
    this.layer = 3;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.age > 0.12) this.dead = true;
  }

  override draw(r: Renderer): void {
    const t = this.age / 0.12;
    const name = impactSprite(this.color);
    const s = this.size * (t < 0.3 ? 0.7 + t : 1.0 - (t - 0.3) * 0.9);
    r.sprite(name, this.x, this.y, { rot: this.ang, sx: s, sy: s });
  }
}

function impactSprite(color: string): string {
  const name = `__impact_${color}`;
  if (hasSprite(name)) return name;
  defineDrawnSprite(name, 15, 15, (p) => {
    // long streak along the hit direction + short cross
    p.line(0, 7, 14, 7, color);
    p.line(2, 7, 12, 7, '#ffffff');
    p.line(7, 3, 7, 11, color);
    p.line(7, 5, 7, 9, '#ffffff');
    p.rect(6, 6, 3, 3, '#ffffff');
  }, { origin: [7, 7] });
  return name;
}

// ---------------------------------------------------------------- sprites
export const SMEAR_FRAMES = 5;

/**
 * Pixel smear of a swing (pointing right, pivot at the swing center), frame
 * 0..SMEAR_FRAMES-1: the first frames sweep the arc open, the last ones thin out.
 * Cached per (reach, arc, color, frame); reach/arc are bucketed.
 */
export function smearSprite(reach: number, arc: number, color: string, frame: number): string {
  const R = Math.max(10, Math.round(reach / 2) * 2);
  const A = Math.min(Math.PI * 2, Math.max(0.6, Math.round(arc * 5) / 5));
  const name = `__smear_${R}_${A.toFixed(1)}_${color}_${frame}`;
  if (hasSprite(name)) return name;
  const prog = [0.5, 0.8, 1, 1, 1][frame] ?? 1;
  const thin = [1, 1, 1, 0.6, 0.32][frame] ?? 0.3;
  const dim = frame >= 4;
  const dark = mix(color, '#000000', 0.35);
  const W = R + 2;
  const H = R * 2 + 3;
  defineDrawnSprite(name, W * 2, H, (p) => {
    const cx = W;
    const cy = Math.floor(H / 2);
    const a0 = -A / 2;
    const lead = a0 + A * prog;
    const span = Math.max(0.01, lead - a0);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W * 2; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d = Math.hypot(dx, dy);
        if (d > R || d < 3) continue;
        let a = Math.atan2(dy, dx);
        if (A >= Math.PI * 1.99) {
          // full circle: measure from the start angle
          a = a0 + ((((a - a0) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
        }
        if (a < a0 || a > lead) continue;
        const u = (a - a0) / span; // 0 tail .. 1 leading edge
        const thick = R * (0.12 + 0.42 * Math.pow(u, 0.8)) * thin;
        const inner = R - thick;
        if (d < inner) continue;
        const edge = R - d;
        let c: string;
        const k = edge / thick + (bayer(x, y) - 0.5) * 0.2; // dithered band edges
        if (edge < 1.1 && u > 0.15) c = dim ? color : '#ffffff';
        else if (k < 0.4) c = color;
        else if (k < 0.7) c = color + (u > 0.5 ? 'a0' : '70');
        else c = dark + (u > 0.5 ? '70' : '40');
        if (u < 0.12 && edge >= 1.1) continue;
        p.px(x, y, c);
      }
    }
  }, { origin: [W, Math.floor(H / 2)] });
  return name;
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1, 7), 16);
  const pb = parseInt(b.slice(1, 7), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

/** Crescent slash sprite (pointing right, pivot at the swing center). */
export function slashSprite(color: string, thrust = false): string {
  const name = `__slash_${thrust ? 't' : 'a'}_${color}`;
  if (hasSprite(name)) return name;
  if (thrust) {
    defineDrawnSprite(name, 28, 9, (p) => {
      p.poly([0, 4.5, 22, 1, 28, 4.5, 22, 8], color + 'aa');
      p.poly([4, 4.5, 22, 2.5, 27, 4.5, 22, 6.5], color);
      p.line(6, 4, 26, 4, '#ffffff');
    }, { origin: [14, 4] });
  } else {
    defineDrawnSprite(name, 30, 40, (p) => {
      // crescent: big circle minus offset circle, right half only
      for (let y = 0; y < 40; y++) {
        for (let x = 0; x < 30; x++) {
          const dx = x - 2;
          const dy = y - 20;
          const d1 = Math.hypot(dx, dy);
          const d2 = Math.hypot(dx + 7, dy);
          if (d1 < 27 && d2 > 27 && dx > 0) {
            const edge = 27 - d1;
            p.px(x, y, edge < 2.5 ? '#ffffff' : edge < 5 ? color : color + '88');
          }
        }
      }
    }, { origin: [2, 20] });
  }
  return name;
}

export { Projectile };
