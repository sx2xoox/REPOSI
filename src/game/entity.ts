// Entity base classes. Everything that moves or is drawn in a room is an Entity.
// Actors (player, enemies) additionally have HP, status effects and knockback.

import type { Renderer } from '../engine/renderer';
import type { World } from './world';
import { clamp } from '../engine/math';

export type Team = 'player' | 'enemy' | 'neutral';

export type StatusKind =
  | 'burn' | 'poison' | 'bleed'      // damage over time
  | 'slow' | 'freeze' | 'stun'       // movement
  | 'charm' | 'fear'                 // AI control
  | 'weak'                           // takes +35% damage
  | 'mark';                          // marked: next hit crits

export interface StatusApply {
  kind: StatusKind;
  /** seconds */
  duration: number;
  /** burn/poison/bleed: damage per second; slow: 0..1 slow fraction */
  power?: number;
  /** 0..1, default 1 */
  chance?: number;
}

export interface StatusState {
  time: number;
  power: number;
  tick: number;
  stacks: number;
}

export type DamageKind = 'projectile' | 'melee' | 'explosion' | 'contact' | 'status' | 'laser' | 'spikes' | 'other';

export interface HitInfo {
  damage: number;
  kind: DamageKind;
  /** entity that physically hit (projectile, swing, bomb ...) */
  source?: Entity | null;
  /** the actor responsible (the player for all player damage) */
  attacker?: Actor | null;
  /** knockback direction (normalized) and strength (px/s impulse) */
  dirX?: number;
  dirY?: number;
  knockback?: number;
  crit?: boolean;
  statuses?: StatusApply[];
  /** suppress hit-stop / big feedback (for DoT ticks, many small hits) */
  light?: boolean;
  /** item effects that already processed this hit (prevents infinite proc chains) */
  procs?: string[];
  /** do not trigger item onHit hooks */
  noProc?: boolean;
}

let nextEntityId = 1;

export abstract class Entity {
  readonly id = nextEntityId++;
  x = 0;
  y = 0;
  /** height above the floor (for jumps, arcs); drawn as y - z */
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  /** collision radius */
  r = 4;
  dead = false;
  team: Team = 'neutral';
  /** 0 = on the floor (drawn first), 1 = y-sorted, 2 = above everything */
  layer = 1;
  /** kept in the room when the player leaves (pickups, pedestals, chests ...) */
  persistent = false;
  age = 0;
  /** ignores pits */
  flying = false;
  /** ignores rocks / blocks / pots */
  phasing = false;
  /** collides with room tiles when moving via `move()` */
  tileCollide = true;
  /** participates in actor-actor separation */
  solid = false;
  mass = 1;

  update(_w: World, _dt: number): void {}
  draw(_r: Renderer, _w: World): void {}
  /** emit lights (called during the light pass) */
  light(_w: World): void {}
  onRemove(_w: World): void {}

  get sortY(): number {
    return this.y;
  }

  /**
   * Integrate velocity with tile collision (axis separated, AABB of size 2r).
   * Returns which axes collided.
   */
  move(w: World, dt: number): { hitX: boolean; hitY: boolean } {
    let hitX = false;
    let hitY = false;
    const dx = this.vx * dt;
    const dy = this.vy * dt;
    if (!this.tileCollide) {
      this.x += dx;
      this.y += dy;
      return { hitX, hitY };
    }
    // sub-step large moves so fast things do not tunnel
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 6));
    const sx = dx / steps;
    const sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      if (sx !== 0) {
        const nx = this.x + sx;
        if (w.room.boxBlocked(nx, this.y, this.r, this.flying, this.phasing)) {
          hitX = true;
          // slide: snap next to the obstacle
          let lo = 0;
          let hi = 1;
          for (let k = 0; k < 5; k++) {
            const mid = (lo + hi) / 2;
            if (w.room.boxBlocked(this.x + sx * mid, this.y, this.r, this.flying, this.phasing)) hi = mid; else lo = mid;
          }
          this.x += sx * lo;
        } else this.x = nx;
      }
      if (sy !== 0) {
        const ny = this.y + sy;
        if (w.room.boxBlocked(this.x, ny, this.r, this.flying, this.phasing)) {
          hitY = true;
          let lo = 0;
          let hi = 1;
          for (let k = 0; k < 5; k++) {
            const mid = (lo + hi) / 2;
            if (w.room.boxBlocked(this.x, this.y + sy * mid, this.r, this.flying, this.phasing)) hi = mid; else lo = mid;
          }
          this.y += sy * lo;
        } else this.y = ny;
      }
    }
    return { hitX, hitY };
  }
}

/** Something with HP that can be hit. */
export abstract class Actor extends Entity {
  hp = 10;
  maxHp = 10;
  /** white flash timer */
  flash = 0;
  /** knockback velocity, added on top of normal velocity, decays fast */
  kbx = 0;
  kby = 0;
  invuln = 0;
  statuses = new Map<StatusKind, StatusState>();
  /** last time this actor took damage (world time) */
  lastHurtAt = -999;
  /** squash & stretch scale */
  squashX = 1;
  squashY = 1;

  get alive(): boolean {
    return !this.dead && this.hp > 0;
  }

  /** combined movement multiplier from statuses */
  speedMult(): number {
    let m = 1;
    const slow = this.statuses.get('slow');
    if (slow) m *= 1 - clamp(slow.power, 0, 0.85);
    if (this.statuses.has('freeze') || this.statuses.has('stun')) m = 0;
    return m;
  }

  hasStatus(k: StatusKind): boolean {
    return this.statuses.has(k);
  }

  applyStatus(s: StatusApply, roll: () => number): boolean {
    if (s.chance !== undefined && roll() >= s.chance) return false;
    const cur = this.statuses.get(s.kind);
    const power = s.power ?? 0;
    if (cur) {
      cur.time = Math.max(cur.time, s.duration);
      if (s.kind === 'poison' || s.kind === 'bleed') {
        cur.stacks = Math.min(8, cur.stacks + 1);
        cur.power = Math.max(cur.power, power);
      } else cur.power = Math.max(cur.power, power);
    } else {
      this.statuses.set(s.kind, { time: s.duration, power, tick: 0, stacks: 1 });
    }
    return true;
  }

  /** Called every update by subclasses. Ticks DoTs; returns total DoT damage dealt. */
  updateStatuses(w: World, dt: number): void {
    for (const [k, s] of this.statuses) {
      s.time -= dt;
      if (k === 'burn' || k === 'poison' || k === 'bleed') {
        s.tick += dt;
        while (s.tick >= 0.5 && this.alive) {
          s.tick -= 0.5;
          const dmg = s.power * 0.5 * (k === 'poison' || k === 'bleed' ? s.stacks : 1);
          if (dmg > 0) w.statusDamage(this, dmg, k);
        }
      }
      if (s.time <= 0) this.statuses.delete(k);
    }
  }

  /** Visual tint for active statuses (used by draw). */
  statusTint(): { color: string; amount: number } | null {
    if (this.statuses.has('freeze')) return { color: '#9fe8ff', amount: 0.55 };
    if (this.statuses.has('charm')) return { color: '#ff7ad9', amount: 0.4 };
    if (this.statuses.has('fear')) return { color: '#7a4dff', amount: 0.35 };
    if (this.statuses.has('burn')) return { color: '#ff7a2a', amount: 0.25 + 0.15 * Math.sin(this.age * 30) };
    if (this.statuses.has('poison')) return { color: '#7dff5a', amount: 0.3 };
    if (this.statuses.has('slow')) return { color: '#8fa8d8', amount: 0.3 };
    if (this.statuses.has('weak')) return { color: '#d0d0d0', amount: 0.25 };
    return null;
  }

  /** Apply knockback impulse scaled by mass. */
  knock(dirX: number, dirY: number, strength: number): void {
    if (!isFinite(this.mass)) return;
    const k = strength / Math.max(0.2, this.mass);
    this.kbx += dirX * k;
    this.kby += dirY * k;
  }

  /** Decay knockback velocity (call each update). */
  updateKnockback(dt: number): void {
    const k = Math.exp(-dt * 10);
    this.kbx *= k;
    this.kby *= k;
    if (Math.abs(this.kbx) < 1) this.kbx = 0;
    if (Math.abs(this.kby) < 1) this.kby = 0;
  }

  /** Ease squash & stretch back to 1. */
  updateSquash(dt: number): void {
    const k = 1 - Math.exp(-dt * 14);
    this.squashX += (1 - this.squashX) * k;
    this.squashY += (1 - this.squashY) * k;
  }

  squash(sx: number, sy: number): void {
    this.squashX = sx;
    this.squashY = sy;
  }

  /** Apply a hit. Returns true if damage was taken. Subclasses override. */
  abstract takeHit(w: World, hit: HitInfo): boolean;
}
