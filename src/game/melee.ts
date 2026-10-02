// Melee attacks (Sephiria-style swings). A swing is a short-lived arc hitbox
// around its owner that hits each enemy once, breaks pots, and deflects
// (destroys) enemy projectiles it touches.

import { Entity, type Actor, type HitInfo } from './entity';
import type { World } from './world';
import type { Renderer } from '../engine/renderer';
import { angleDiff, angleTo, dist } from '../engine/math';
import { Projectile } from './projectile';
import { TILE } from './constants';
import { tileProps } from './tiles';
import { defineDrawnSprite, hasSprite } from '../engine/sprites';

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
  statuses?: HitInfo['statuses'];
  /** thrust instead of arc: hit area is a rectangle `reach` long, `arc` px wide */
  thrust?: boolean;
  /** swing direction for the visual: 1 = clockwise */
  swingDir?: number;
  /** extra callback per enemy hit */
  onHit?: (w: World, target: Actor, hit: HitInfo) => void;
}

export class MeleeSwing extends Entity {
  owner: Actor;
  o: Required<Omit<SwingOpts, 'statuses' | 'onHit'>> & Pick<SwingOpts, 'statuses' | 'onHit'>;
  hitIds = new Set<number>();
  tilesHit = new Set<number>();

  constructor(owner: Actor, o: SwingOpts) {
    super();
    this.owner = owner;
    this.o = {
      knockback: 140, duration: 0.1, visual: 0.18, color: '#ffffff', deflect: true, thrust: false, swingDir: 1,
      ...o,
    };
    this.x = owner.x;
    this.y = owner.y;
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
          };
          if (w.applyHit(e, hit)) this.o.onHit?.(w, e, hit);
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
      } else if (!this.hitIds.has(w.player.id) && this.contains(w.player.x, w.player.y, w.player.r)) {
        this.hitIds.add(w.player.id);
        w.player.hurt(w, Math.max(1, Math.round(this.o.damage)), (this.owner as { def?: { name: string } }).def?.name ?? '공격');
      }
      // deflect bullets
      if (this.o.deflect) {
        for (const p of w.projectiles) {
          if (p.dead || p.team === this.team || p.delay > 0) continue;
          if (!this.contains(p.x, p.y, p.r)) continue;
          p.expire(w, true);
          w.particles.burst(p.x, p.y, { count: 6, speed: [40, 110], life: [0.1, 0.25], colors: ['#ffffff', '#ffe080'], shape: 'spark', size: [1, 2] });
          w.sfx('parry', { vol: 0.5 });
          w.items.onDeflect(p);
        }
      }
    }
    if (this.age >= this.o.visual) this.dead = true;
  }

  override draw(r: Renderer): void {
    const t = this.age / this.o.visual;
    const name = slashSprite(this.o.color, this.o.thrust);
    const flipY = this.o.swingDir < 0;
    if (this.o.thrust) {
      r.sprite(name, this.x + Math.cos(this.o.angle) * this.o.reach * 0.5, this.y + Math.sin(this.o.angle) * this.o.reach * 0.5, {
        rot: this.o.angle, sx: this.o.reach / 28, sy: Math.max(0.4, this.o.arc / 12), alpha: 1 - t, additive: false,
      });
      return;
    }
    const scale = this.o.reach / 26;
    const sweep = (t - 0.5) * 0.6 * this.o.swingDir;
    r.sprite(name, this.x, this.y, { rot: this.o.angle + sweep, sx: scale, sy: scale * (this.o.arc / 2.4), flipY, alpha: t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4 });
  }

  override light(w: World): void {
    if (this.age < this.o.visual * 0.7) {
      w.lights.add(this.x + Math.cos(this.o.angle) * this.o.reach * 0.6, this.y + Math.sin(this.o.angle) * this.o.reach * 0.6, this.o.reach, '#fff0d0', { intensity: 0.5 });
    }
  }
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
