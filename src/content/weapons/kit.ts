// Helpers for the expanded arsenal (wands, launchers, staves, blades ...):
// shot timing for recoil animations, held-gun drawing, player-owned blasts,
// segment hit tests, lightning zaps, lobbed-shell flight and ground fire.
// Everything here only hits enemies (never the player) and never breaks tiles,
// so bombs stay the tool for rocks and secret doors.

import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer, DrawOpts } from '../../engine/renderer';
import type { WeaponState } from '../../game/defs';
import type { StatusApply, Actor } from '../../game/entity';
import { Entity } from '../../game/entity';
import type { Enemy } from '../../game/enemy';
import { Projectile, type ProjBehavior, type ProjectileOpts } from '../../game/projectile';
import { RingFx } from '../../game/effects';
import { input } from '../../engine/input';
import { clamp, dist } from '../../engine/math';
import { fx } from '../../engine/rng';
import { drawHeld, glowSprite, handPos, pixLine, segDist } from './common';

// ------------------------------------------------------------------ shot timing
/** Remember the moment of an attack (drives recoil / flash in `draw`). */
export function markShot(st: WeaponState, w: World): void {
  st.mem.shotAt = w.time;
}

/** 1 -> 0 during `dur` seconds after the last `markShot`. */
export function shotFade(st: WeaponState, w: World, dur = 0.1): number {
  const t = w.time - (st.mem.shotAt ?? -9);
  return t >= 0 && t < dur ? 1 - t / dur : 0;
}

/** A held gun / wand: pushed back by recoil and flashing right after a shot. */
export function drawGun(r: Renderer, w: World, p: Player, st: WeaponState, sprite: string, dist0 = 6, recoil = 2.5, o: DrawOpts = {}): void {
  const f = shotFade(st, w, 0.1);
  drawHeld(r, p, sprite, p.aim, dist0 - f * recoil, { flash: f > 0.55 ? 0.4 : 0, ...o });
}

/** Common attack bookkeeping: onAttack hook (exactly once), timers. */
export function beginAttack(w: World, p: Player, st: WeaponState, aim: number): void {
  st.sinceAttack = 0;
  w.items.onAttack(aim);
  p.lastAttackAt = w.time;
  markShot(st, w);
}

/**
 * Distance from the player to where the attack is aimed: the mouse cursor in
 * mouse mode (clamped), else `fallback` (keys / pad / touch aim).
 */
export function aimDistance(w: World, p: Player, min: number, max: number, fallback: number): number {
  if (input.aimMode === 'mouse' && typeof w.mouseWorld === 'function') {
    const m = w.mouseWorld();
    return clamp(Math.hypot(m.x - p.x, m.y - (p.y - 6)), min, max);
  }
  return clamp(fallback, min, max);
}

// ------------------------------------------------------------------ area damage
export interface BlastOpts {
  /** [core, mid, edge, smoke] colors */
  colors?: string[];
  knockback?: number;
  statuses?: StatusApply[];
  shake?: number;
  sfx?: boolean;
  /** enemies that should not be hit (e.g. already hit by the direct impact) */
  skip?: Set<number>;
  kind?: 'explosion' | 'melee' | 'laser';
  /** smaller visuals (many small blasts) */
  small?: boolean;
}

/**
 * Player-owned blast: hits every enemy in `radius` once. Never hurts the player
 * and never breaks tiles. Returns the number of enemies hit.
 */
export function blast(w: World, x: number, y: number, radius: number, damage: number, o: BlastOpts = {}): number {
  const p = w.player;
  let n = 0;
  for (const e of [...w.enemies]) {
    if (!e.alive || e.hidden || o.skip?.has(e.id)) continue;
    const d = dist(x, y, e.x, e.y);
    if (d > radius + e.r) continue;
    const k = d || 1;
    if (w.applyHit(e, { damage, kind: o.kind ?? 'explosion', attacker: p, dirX: (e.x - x) / k, dirY: (e.y - y) / k, knockback: o.knockback ?? 200, statuses: o.statuses })) n++;
  }
  for (const h of [...w.hittables]) if (dist(x, y, h.x, h.y) < radius + h.r) h.takeHit(w, { damage, kind: 'explosion', attacker: p });
  const cols = o.colors ?? ['#ffffff', '#fff0a0', '#ff9a2a', '#a03010'];
  const big = !o.small;
  w.particles.burst(x, y, { count: big ? 14 + Math.round(radius * 0.5) : 8, speed: [30, 50 + radius * 4], life: [0.18, 0.42], colors: cols.slice(0, 3), size: [1, big ? 3 : 2], sizeEnd: 0.5, additive: true, light: big ? 6 : 0 });
  if (big) w.particles.burst(x, y, { count: 7, speed: [10, 40], life: [0.4, 0.9], colors: [cols[3] ?? '#504040', '#403838'], size: [2, 4], sizeEnd: 6, drag: 3, fade: true });
  w.spawn(new RingFx(x, y, radius, big ? 0.26 : 0.18, cols[1], big ? 2 : 1));
  w.lights.glow(x, y, radius * 1.8, cols[2].slice(0, 7), big ? 0.6 : 0.35);
  if (big) w.decal(x, y, '#140c0c', radius * 0.35, 0.35);
  if (o.shake !== 0) w.shake(o.shake ?? (big ? 0.2 : 0.06));
  if (o.sfx !== false) w.sfx('explosion', { vol: big ? 0.35 + radius / 160 : 0.2, pitch: big ? 1.2 : 1.7, x });
  return n;
}

/** Enemies within `width/2` of the segment (x0,y0)-(x1,y1), nearest first. */
export function enemiesOnSegment(w: World, x0: number, y0: number, x1: number, y1: number, width: number, maxZ = 28): Enemy[] {
  const out: { e: Enemy; t: number }[] = [];
  for (const e of w.enemies) {
    if (!e.alive || e.hidden || e.z > maxZ) continue;
    const sd = segDist(e.x, e.y - e.z * 0.3, x0, y0, x1, y1);
    if (sd.d <= e.r + width / 2) out.push({ e, t: sd.t });
  }
  out.sort((a, b) => a.t - b.t);
  return out.map((o) => o.e);
}

/** Nearest living enemy to (x, y) inside a cone around `angle` (radians half-width). */
export function enemyInCone(w: World, x: number, y: number, angle: number, half: number, range: number, exclude?: Set<number>): Enemy | null {
  let best: Enemy | null = null;
  let bs = Infinity;
  for (const e of w.enemies) {
    if (!e.alive || e.hidden || exclude?.has(e.id)) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const d = Math.hypot(dx, dy);
    if (d > range + e.r) continue;
    let da = Math.atan2(dy, dx) - angle;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    if (Math.abs(da) > half + Math.atan2(e.r, Math.max(1, d))) continue;
    const score = d * (1 + Math.abs(da) * 1.5);
    if (score < bs) {
      bs = score;
      best = e;
    }
  }
  return best;
}

// ------------------------------------------------------------------ lightning
/** Jagged lightning bolt between two points (pure visual; re-jitters while alive). */
export class Zap extends Entity {
  x2: number;
  y2: number;
  color: string;
  core: string;
  dur: number;
  jag: number;
  private pts: number[] = [];
  private jit = 0;
  constructor(x: number, y: number, x2: number, y2: number, color = '#8ad8ff', core = '#ffffff', dur = 0.16, jag = 5) {
    super();
    this.x = x;
    this.y = y;
    this.x2 = x2;
    this.y2 = y2;
    this.color = color;
    this.core = core;
    this.dur = dur;
    this.jag = jag;
    this.layer = 2;
    this.tileCollide = false;
    this.rebuild();
  }

  private rebuild(): void {
    const len = Math.hypot(this.x2 - this.x, this.y2 - this.y);
    const n = Math.max(2, Math.round(len / 9));
    const nx = -(this.y2 - this.y) / (len || 1);
    const ny = (this.x2 - this.x) / (len || 1);
    this.pts = [this.x, this.y];
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const off = fx.range(-this.jag, this.jag) * Math.sin(k * Math.PI);
      this.pts.push(this.x + (this.x2 - this.x) * k + nx * off, this.y + (this.y2 - this.y) * k + ny * off);
    }
    this.pts.push(this.x2, this.y2);
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    this.jit += dt;
    if (this.jit > 0.04) {
      this.jit = 0;
      this.rebuild();
    }
    if (this.age >= this.dur) this.dead = true;
  }

  override draw(r: Renderer): void {
    const t = 1 - this.age / this.dur;
    const P = this.pts;
    for (let i = 0; i + 3 < P.length; i += 2) {
      r.line(P[i], P[i + 1], P[i + 2], P[i + 3], this.color, 1 + 2 * t, 0.85 * t + 0.15);
    }
    for (let i = 0; i + 3 < P.length; i += 2) pixLine(r, P[i], P[i + 1], P[i + 2], P[i + 3], this.core, t);
  }

  override light(w: World): void {
    w.lights.add((this.x + this.x2) / 2, (this.y + this.y2) / 2, 40, this.color.slice(0, 7), { intensity: 0.8 });
  }
}

// ------------------------------------------------------------------ lobbed shells
/**
 * Flight plan for a lobbed projectile: it climbs and falls over `flight` px of
 * travel (peak `peak` px), cannot hit anything while airborne, and calls
 * `land` at the end (the projectile is then removed).
 */
export function lobBehavior(flight: number, peak: number, land: (pr: Projectile, w: World) => void, shadowSprite?: string): ProjBehavior {
  return {
    id: 'lob',
    update(pr, w) {
      const k = clamp(pr.traveled / Math.max(1, flight), 0, 1);
      pr.z = 4 + 4 * peak * k * (1 - k);
      // airborne: sail over enemies
      for (const e of w.enemies) pr.hitIds.add(e.id);
      for (const h of w.hittables) pr.hitIds.add(h.id);
      if (k >= 1 && !pr.dead) {
        pr.mem.landed = 1;
        land(pr, w);
        pr.dead = true;
      }
    },
    onWall(pr, w) {
      if (!pr.mem.landed) {
        pr.mem.landed = 1;
        land(pr, w);
      }
      return false;
    },
    draw(pr, r) {
      if (shadowSprite) r.sprite(shadowSprite, pr.x, pr.y, { alpha: 0.4 });
    },
  };
}

// ------------------------------------------------------------------ ground fire
/** Lingering patch of fire on the floor: burns enemies standing in it. */
export class FirePatch extends Entity {
  dmg: number;
  life: number;
  tick = 0;
  rad: number;
  constructor(x: number, y: number, rad: number, dmg: number, life = 1.6) {
    super();
    this.x = x;
    this.y = y;
    this.rad = rad;
    this.dmg = dmg;
    this.life = life;
    this.layer = 0;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.3;
      for (const e of w.enemies) {
        if (!e.alive || e.hidden || e.z > 6 || e.flying) continue;
        if (dist(this.x, this.y, e.x, e.y) > this.rad + e.r) continue;
        if (w.applyHit(e, { damage: this.dmg, kind: 'status', attacker: w.player, light: true, knockback: 0, statuses: [{ kind: 'burn', duration: 1.5, power: this.dmg, chance: 0.35 }] })) e.flash = Math.min(e.flash, 0.03);
      }
    }
    if (fx.chance(dt * 14)) {
      w.particles.spawn({ x: this.x + fx.range(-this.rad, this.rad) * 0.8, y: this.y + fx.range(-this.rad, this.rad) * 0.4, vy: -30, life: 0.4, colors: ['#ffe080', '#ff8a20', '#a03010'], size: 1.5, sizeEnd: 0.5, additive: true });
    }
    if (this.age >= this.life) this.dead = true;
  }

  override draw(r: Renderer, w: World): void {
    const k = 1 - this.age / this.life;
    const fl = 1 + 0.12 * Math.sin(w.time * 23 + this.id);
    r.sprite(glowSprite(this.rad * 2.2 * fl, '#ff7a20'), this.x, this.y, { alpha: 0.35 * k, additive: true, sy: 0.55 });
    r.sprite(glowSprite(this.rad * 1.2 * fl, '#ffd060'), this.x, this.y, { alpha: 0.4 * k, additive: true, sy: 0.55 });
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y, this.rad * 2.4, '#ff8a30', { intensity: 0.5 * (1 - this.age / this.life) });
  }
}

// ------------------------------------------------------------------ misc
/** Muzzle point `len` px along the aim from the weapon hand. */
export function muzzleAt(p: Player, aim: number, len: number): { x: number; y: number } {
  return handPos(p, aim, len);
}

/** Apply a direct hit from the player (melee-like, no projectile). */
export function strike(w: World, target: Actor, damage: number, dirX: number, dirY: number, knockback: number, o: { kind?: 'melee' | 'laser' | 'explosion'; statuses?: StatusApply[]; light?: boolean; noProc?: boolean } = {}): boolean {
  return w.applyHit(target, { damage, kind: o.kind ?? 'melee', attacker: w.player, dirX, dirY, knockback, statuses: o.statuses, light: o.light, noProc: o.noProc });
}

/**
 * Secondary player shot (splits, shards, rays): built directly, so it does not
 * re-trigger onShoot hooks (no runaway proc chains) and does not move the hand.
 */
export function fragment(w: World, x: number, y: number, angle: number, o: Partial<ProjectileOpts> & { damage: number }): Projectile {
  const p = w.player;
  const pr = new Projectile({
    team: 'player', x, y, angle, speed: 180, radius: 2, range: 80, owner: p, knockback: 40,
    spectral: p.flags.has('spectral'), fromWeapon: false, light: 10, ...o,
  });
  pr.generation = 1;
  w.spawn(pr);
  return pr;
}
