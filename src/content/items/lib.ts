// Shared helpers for passive artifacts and 등불 공명 (resonance) tiers:
// proc rules (what counts as an attack, chance stacking), status helpers that
// respect bosses, chain lightning, projectile behaviors, ground hazards,
// familiars (followers / orbitals) and a few world-level effects.
//
// Proc-loop rules used everywhere in src/content/items:
//  - spawning procs (splits, shards, explosions, zaps) only trigger on PRIMARY
//    hits (`isPrimary`): player projectiles of generation 0 or melee swings.
//  - everything an item spawns is generation >= 1 and/or hits with `noProc`.
//  - item damage zones use kind 'status' (no crits, no item hooks, no embers).

import type { World } from '../../game/world';
import { Entity, type Actor, type HitInfo, type StatusApply } from '../../game/entity';
import { Enemy } from '../../game/enemy';
import { Projectile, type ProjBehavior, type ProjectileOpts } from '../../game/projectile';
import { Weapons, defineGlobalHooks } from '../../game/defs';
import type { Renderer } from '../../engine/renderer';
import { VIEW_H, VIEW_W } from '../../engine/renderer';
import { fx } from '../../engine/rng';
import { TAU, angleTo, clamp, dist2, rotateToward } from '../../engine/math';
import { defineDrawnSprite } from '../../engine/sprites';

export const O = '#0c0810';

// ====================================================================== proc rules
/** A real player attack hit: projectile / melee / beam (not explosions, DoT ticks or zaps). */
export function isAttack(hit: HitInfo): boolean {
  return (hit.kind === 'projectile' || hit.kind === 'melee' || hit.kind === 'laser') && !hit.noProc;
}

/** An attack that was not itself produced by an item (no splits / shards / familiar shots). */
export function isPrimary(hit: HitInfo): boolean {
  if (!isAttack(hit)) return false;
  const s = hit.source;
  if (s instanceof Projectile && s.generation > 0) return false;
  return true;
}

/** Chance that stacks with copies (1-(1-p)^n) plus a little luck. */
export function procChance(w: World, base: number, power: number, luckK = 0.012): number {
  const luck = w.player?.stats?.luck ?? 0;
  return clamp(1 - Math.pow(1 - base, Math.max(1, power)) + Math.max(0, luck) * luckK, 0, 0.95);
}

export function roll(w: World, base: number, power: number, luckK?: number): boolean {
  return w.rng.chance(procChance(w, base, power, luckK));
}

/** Weight of a hit for per-hit procs: continuous beams tick ~2x as often as shots, so they proc at half chance. */
export function hitWeight(hit: HitInfo): number {
  return hit.kind === 'laser' ? 0.5 : 1;
}

/** Per-hit proc roll that accounts for the hit's weight (see hitWeight). */
export function rollHit(w: World, hit: HitInfo, base: number, power: number, luckK?: number): boolean {
  return w.rng.chance(procChance(w, base * hitWeight(hit), power, luckK));
}

/** Diminishing stack multiplier: 1, 1.6, 2.0, 2.3 ... */
export function stackMul(power: number): number {
  return 1 + Math.log2(Math.max(1, power)) * 0.6;
}

export function isMelee(w: World): boolean {
  return Weapons.get(w.player.weaponId)?.kind === 'melee';
}

/** Mark that an item handled this hit (prevents the same item re-processing it). */
export function markProc(hit: HitInfo, id: string): boolean {
  if (hit.procs?.includes(id)) return false;
  hit.procs = [...(hit.procs ?? []), id];
  return true;
}

// ====================================================================== statuses
export const STATUS_COLOR: Record<string, string[]> = {
  burn: ['#fff0a0', '#ff9a30', '#c04010'],
  poison: ['#e0ff90', '#8aff5a', '#3a8a20'],
  bleed: ['#ff8090', '#e02838', '#801020'],
  slow: ['#e0f4ff', '#8fc0e8', '#5070a0'],
  freeze: ['#ffffff', '#9fe8ff', '#4aa0d8'],
  stun: ['#ffffff', '#ffe95a', '#c09020'],
  charm: ['#ffe0f4', '#ff7ad9', '#a03080'],
  fear: ['#e0d0ff', '#9a6aff', '#4a2a90'],
  weak: ['#ffffff', '#c8c0b8', '#6a6070'],
  mark: ['#fffbe0', '#ffd23a', '#b08010'],
};

/** Bosses shrug off hard crowd control: freeze -> slow, charm/fear -> nothing, stun shortened. */
export function bossSafe(target: Actor, s: StatusApply): StatusApply | null {
  if (!(target instanceof Enemy) || !target.isBoss) return s;
  switch (s.kind) {
    case 'freeze': return { kind: 'slow', duration: s.duration, power: 0.45 };
    case 'charm': case 'fear': return null;
    case 'stun': return { ...s, duration: Math.min(0.25, s.duration * 0.3) };
    default: return s;
  }
}

/** Attach a status to an outgoing hit (call from modifyHit; never mutates shared arrays). */
export function addHitStatus(w: World, target: Actor, hit: HitInfo, s: StatusApply): void {
  const adj = bossSafe(target, s);
  if (!adj) return;
  hit.statuses = [...(hit.statuses ?? []), adj];
  statusPuff(w, target, adj.kind);
  ensureStatusMarks(w);
}

/** Apply a status directly (auras, zones). */
export function inflict(w: World, target: Enemy, s: StatusApply, puff = true): void {
  if (!target.alive) return;
  const adj = bossSafe(target, s);
  if (!adj) return;
  target.applyStatus(adj, () => w.rng.next());
  if (puff) statusPuff(w, target, adj.kind);
  ensureStatusMarks(w);
}

export function statusPuff(w: World, t: Actor, kind: string): void {
  const col = STATUS_COLOR[kind] ?? ['#ffffff'];
  w.particles.burst(t.x, t.y - t.z - 4, { count: 5, speed: [20, 60], life: [0.2, 0.45], colors: col, size: [1, 2], vz: [10, 40], gravity: -10 });
}

/** Damage tick from an item zone/aura (no crits, no procs, colored number). */
export function zoneDamage(w: World, e: Enemy, dmg: number, color: 'burn' | 'poison' | 'bleed' | 'other' = 'other', statuses?: StatusApply[]): void {
  w.applyHit(e, { damage: dmg, kind: 'status', attacker: w.player, light: true, noProc: true, procs: [color], statuses });
}

/** Player hit from an item effect (crits allowed, no on-hit procs). */
export function itemHit(w: World, e: Enemy, dmg: number, o: { from?: { x: number; y: number }; knockback?: number; statuses?: StatusApply[]; kind?: HitInfo['kind']; procs?: string[] } = {}): boolean {
  const fx0 = o.from ?? w.player;
  const d = Math.hypot(e.x - fx0.x, e.y - fx0.y) || 1;
  const sts = o.statuses?.map((s) => bossSafe(e, s)).filter((s): s is StatusApply => !!s);
  return w.applyHit(e, {
    damage: dmg, kind: o.kind ?? 'other', attacker: w.player, noProc: true, light: true,
    dirX: (e.x - fx0.x) / d, dirY: (e.y - fx0.y) / d, knockback: o.knockback ?? 40, statuses: sts, procs: o.procs,
  });
}

export function enemiesNear(w: World, x: number, y: number, r: number): Enemy[] {
  return w.enemies.filter((e) => e.alive && !e.hidden && e.vulnerable && dist2(x, y, e.x, e.y) < (r + e.r) * (r + e.r));
}

// ====================================================================== dynamic stats / per-copy grants
/** Run `fn` once for every copy acquired (handles duplicates, which don't re-fire onAcquire). */
export function grantPerCopy(w: World, id: string, power: number, fn: () => void): void {
  const k = `__grant_${id}`;
  const done = w.vars[k] ?? 0;
  for (let i = done; i < power; i++) fn();
  if (power > done) w.vars[k] = power;
}

/** Recompute stats when a watched value changes (for stats that depend on coins, keys, timers ...). */
export function watch(w: World, key: string, value: number): void {
  const k = `__watch_${key}`;
  if (w.vars[k] !== value) {
    const first = w.vars[k] === undefined;
    w.vars[k] = value;
    if (!first) w.items.recomputeStats();
  }
}

// ====================================================================== lightning
/** Jagged lightning bolt between two points (visual only). */
export class ZapFx extends Entity {
  x2: number;
  y2: number;
  dur: number;
  color: string;
  pts: number[] = [];
  rt = 0;
  width: number;
  constructor(x: number, y: number, x2: number, y2: number, o: { color?: string; dur?: number; width?: number } = {}) {
    super();
    this.x = x;
    this.y = y;
    this.x2 = x2;
    this.y2 = y2;
    this.color = o.color ?? '#ffe95a';
    this.dur = o.dur ?? 0.2;
    this.width = o.width ?? 2;
    this.layer = 2;
    this.tileCollide = false;
    this.jag();
  }

  private jag(): void {
    const dx = this.x2 - this.x;
    const dy = this.y2 - this.y;
    const len = Math.hypot(dx, dy) || 1;
    const n = Math.max(2, Math.round(len / 9));
    const nx = -dy / len;
    const ny = dx / len;
    this.pts = [this.x, this.y];
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const off = fx.range(-1, 1) * Math.min(7, len * 0.12);
      this.pts.push(this.x + dx * t + nx * off, this.y + dy * t + ny * off);
    }
    this.pts.push(this.x2, this.y2);
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    this.rt += dt;
    if (this.rt > 0.04) {
      this.rt = 0;
      this.jag();
    }
    if (this.age >= this.dur) this.dead = true;
  }

  override draw(r: Renderer): void {
    const t = 1 - this.age / this.dur;
    const p = this.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      r.line(p[i], p[i + 1], p[i + 2], p[i + 3], this.color, this.width + 1.5 * t, 0.55 + 0.4 * t);
    }
    for (let i = 0; i + 3 < p.length; i += 2) r.line(p[i], p[i + 1], p[i + 2], p[i + 3], '#ffffff', 1, t);
  }

  override light(w: World): void {
    const t = 1 - this.age / this.dur;
    w.lights.add(this.x2, this.y2, 34 * t, this.color.slice(0, 7), { intensity: 0.9 });
    w.lights.add((this.x + this.x2) / 2, (this.y + this.y2) / 2, 26 * t, this.color.slice(0, 7), { intensity: 0.6 });
  }
}

export interface ChainOpts {
  jumps: number;
  damage: number;
  range?: number;
  /** first target (otherwise nearest to the start point) */
  first?: Enemy | null;
  exclude?: Set<number>;
  stun?: number;
  color?: string;
  quiet?: boolean;
}

/**
 * Chain lightning from (x, y): jumps to the nearest un-hit enemy up to `jumps`
 * times. Hits are `noProc` (they never trigger other on-hit effects).
 * The 번개 resonance (5) adds jumps and a short stun. Returns enemies hit.
 */
export function chainLightning(w: World, x: number, y: number, o: ChainOpts): number {
  const p = w.player;
  let jumps = o.jumps;
  let stun = o.stun ?? 0;
  if (p.flags.has('stormMastery')) {
    jumps += 2;
    stun = Math.max(stun, 0.35);
  }
  const hitSet = new Set<number>(o.exclude ?? []);
  let cx = x;
  let cy = y;
  let dmg = o.damage;
  let n = 0;
  const range = o.range ?? 85;
  let next: Enemy | null = o.first ?? null;
  for (let i = 0; i < jumps; i++) {
    const t = next && next.alive && !hitSet.has(next.id) ? next : w.nearestEnemy(cx, cy, range, hitSet);
    next = null;
    if (!t) break;
    hitSet.add(t.id);
    const ty = t.y - t.z - 4;
    w.spawn(new ZapFx(cx, cy, t.x, ty, { color: o.color ?? '#ffe95a' }));
    w.particles.burst(t.x, ty, { count: 6, speed: [40, 120], life: [0.1, 0.25], colors: ['#ffffff', o.color ?? '#ffe95a'], shape: 'spark', size: [1, 2], additive: true });
    itemHit(w, t, dmg, { from: { x: cx, y: cy }, knockback: 30, statuses: stun > 0 ? [{ kind: 'stun', duration: stun }] : undefined, procs: ['chain'] });
    if (stun > 0) ensureStatusMarks(w);
    cx = t.x;
    cy = ty;
    dmg *= 0.85;
    n++;
  }
  if (n > 0 && !o.quiet) w.sfx('lightning', { vol: 0.35, pitch: fx.range(1.0, 1.3) });
  return n;
}

/** A bolt from the sky onto a target (thunder drum, storms). */
export function skyBolt(w: World, e: Enemy, dmg: number, stun = 0.6, color = '#ffe95a'): void {
  const ty = e.y - e.z - 4;
  w.spawn(new ZapFx(e.x + fx.range(-10, 10), ty - 90, e.x, ty, { color, dur: 0.25, width: 3 }));
  w.particles.burst(e.x, e.y, { count: 10, speed: [40, 140], life: [0.15, 0.35], colors: ['#ffffff', color, '#a08020'], shape: 'spark', size: [1, 2], additive: true, light: 6 });
  w.particles.spawn({ x: e.x, y: e.y, life: 0.25, size: 2, sizeEnd: 16, colors: ['#ffffff', color], shape: 'ring' });
  itemHit(w, e, dmg, { statuses: stun > 0 ? [{ kind: 'stun', duration: stun }] : undefined, knockback: 0, procs: ['chain'] });
  ensureStatusMarks(w);
}

// ====================================================================== shards (secondary projectiles)
export interface ShardOpts extends Partial<ProjectileOpts> {
  count: number;
  damage: number;
  /** base angle (default random) */
  angle?: number;
  /** total arc (default full circle) */
  arc?: number;
  generation?: number;
}

/** Spawn secondary player projectiles (generation >= 1, never trigger onShoot). */
export function spawnShards(w: World, x: number, y: number, o: ShardOpts): Projectile[] {
  const out: Projectile[] = [];
  const base = o.angle ?? fx.angle();
  const arc = o.arc ?? TAU;
  // performance cap on secondary projectiles alive at once
  let alive = 0;
  for (const pr of w.projectiles) if (pr.team === 'player' && pr.generation > 0) alive++;
  const n = Math.max(0, Math.min(o.count, 90 - alive));
  for (let i = 0; i < n; i++) {
    const a = arc >= TAU - 0.01 ? base + (i / o.count) * TAU : base + (o.count <= 1 ? 0 : (i / (o.count - 1) - 0.5) * arc);
    const { count: _c, damage, angle: _a, arc: _arc, generation, ...rest } = o;
    const p = new Projectile({
      team: 'player', x, y, angle: a, speed: 200, damage, radius: 2, range: 110, owner: w.player,
      knockback: 20, light: 10, ...rest,
    });
    p.generation = generation ?? 1;
    w.spawn(p);
    out.push(p);
  }
  return out;
}

// ====================================================================== projectile behaviors
/** Sine-wave flight. Composes with homing / bounces (adds a turning delta). */
export function sineBehavior(amp = 0.9, freq = 11): ProjBehavior {
  return {
    id: 'sine',
    update(p, _w, dt) {
      if (p.mem.sinePh === undefined) p.mem.sinePh = fx.chance(0.5) ? 0 : Math.PI;
      const t0 = p.age - dt;
      const d = amp * (Math.sin(p.age * freq + p.mem.sinePh) - Math.sin(t0 * freq + p.mem.sinePh));
      p.angle += d;
      p.syncVel();
    },
  };
}

/** Boomerang: decelerates, turns around and flies back through the player, piercing on return. */
export function boomerangBehavior(): ProjBehavior {
  const turn = (p: Projectile) => {
    if (p.mem.boom) return;
    p.mem.boom = 1;
    p.hitIds.clear();
    p.pierce += 99;
    p.range += 900;
    p.life += 3;
  };
  return {
    id: 'boomerang',
    update(p, w, dt) {
      if (!p.mem.boom) {
        if (p.traveled > p.range * 0.6) {
          p.speed = Math.max(40, p.speed - 900 * dt);
          if (p.speed <= 60) turn(p);
        }
        return;
      }
      const pl = w.player;
      const want = angleTo(p.x, p.y, pl.x, pl.y - 5);
      p.angle = rotateToward(p.angle, want, 12 * dt);
      p.speed = Math.min(p.speed + 700 * dt, (p.mem.boomSpeed ||= Math.max(200, pl.stats.shotSpeed * 1.1)));
      p.syncVel();
      p.spectral = true;
      if (Math.hypot(pl.x - p.x, pl.y - 5 - p.y) < 9) p.dead = true;
    },
    onWall(p) {
      if (!p.mem.boom) {
        turn(p);
        p.speed = 80;
        return true;
      }
      return true;
    },
  };
}

/** Grows in size and damage as it travels. */
export function growBehavior(maxScale = 2.2, dmgGain = 1.0): ProjBehavior {
  return {
    id: 'grow',
    update(p) {
      if (p.mem.r0 === undefined) {
        p.mem.r0 = p.r;
        p.mem.d0 = p.damage;
      }
      const k = clamp(p.traveled / Math.max(40, p.range), 0, 1);
      p.r = p.mem.r0 * (1 + (maxScale - 1) * k);
      p.damage = p.mem.d0 * (1 + dmgGain * k);
      p.knockback = 60 + 80 * k;
    },
  };
}

/** Orbit the player for `dur` seconds, then launch at the nearest enemy (or the aim). */
export function orbitBehavior(dur = 1.3, radius = 22): ProjBehavior {
  return {
    id: 'orbit',
    update(p, w, dt) {
      if (p.mem.orbitDone) return;
      const pl = w.player;
      if (p.mem.orbA === undefined) {
        p.mem.orbA = angleTo(pl.x, pl.y - 5, p.x, p.y);
        p.mem.orbR = 6;
      }
      p.mem.orbA += 7 * dt;
      p.mem.orbR = Math.min(radius, p.mem.orbR + 80 * dt);
      const tx = pl.x + Math.cos(p.mem.orbA) * p.mem.orbR;
      const ty = pl.y - 5 + Math.sin(p.mem.orbA) * p.mem.orbR * 0.8;
      p.vx = (tx - p.x) / Math.max(dt, 1e-4);
      p.vy = (ty - p.y) / Math.max(dt, 1e-4);
      if (p.age >= dur) {
        p.mem.orbitDone = 1;
        const e = w.nearestEnemy(p.x, p.y, 220);
        p.angle = e ? angleTo(p.x, p.y, e.x, e.y - e.z) : pl.aim;
        p.speed = Math.max(220, pl.stats.shotSpeed * 1.15);
        p.syncVel();
        p.traveled = 0;
        p.life = p.age + 3;
        w.particles.burst(p.x, p.y - p.z, { count: 4, speed: [20, 50], life: [0.1, 0.2], colors: ['#ffffff', p.color], size: [1, 2] });
      } else {
        // do not burn range while orbiting
        p.traveled = 0;
      }
    },
  };
}

// ====================================================================== ground hazards
type HazardKind = 'fire' | 'poison' | 'frost';
const hazards = new WeakMap<World, Map<string, HazardZone[]>>();

/** Damaging ground zone (fire trail, poison puddle, frost patch). Caps per kind. */
export class HazardZone extends Entity {
  kind: HazardKind;
  radius: number;
  life: number;
  tick: number;
  tickT = 0;
  damage: number;
  statuses?: StatusApply[];
  seed = fx.next() * 100;
  room: unknown;
  constructor(w: World, x: number, y: number, kind: HazardKind, o: { radius: number; life: number; tick?: number; damage: number; statuses?: StatusApply[] }) {
    super();
    this.x = x;
    this.y = y;
    this.kind = kind;
    this.radius = o.radius;
    this.life = o.life;
    this.tick = o.tick ?? 0.4;
    this.damage = o.damage;
    this.statuses = o.statuses;
    this.layer = 0;
    this.tileCollide = false;
    this.room = w.room;
  }

  static add(w: World, z: HazardZone, cap: number): HazardZone {
    let m = hazards.get(w);
    if (!m) hazards.set(w, (m = new Map()));
    let list = (m.get(z.kind) ?? []).filter((h) => !h.dead && h.room === w.room);
    while (list.length >= cap) {
      const old = list.shift()!;
      old.life = Math.min(old.life, old.age + 0.2);
    }
    list.push(z);
    m.set(z.kind, list);
    return w.spawn(z);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    this.tickT -= dt;
    if (this.tickT <= 0) {
      this.tickT = this.tick;
      const color = this.kind === 'fire' ? 'burn' : this.kind === 'poison' ? 'poison' : 'other';
      // overlapping zones of the same kind share one tick per enemy (no stacking)
      const key = `__hz_${this.kind}`;
      for (const e of enemiesNear(w, this.x, this.y, this.radius)) {
        if (e.z > 10 || (e.mem[key] ?? -1) > w.time) continue;
        e.mem[key] = w.time + this.tick * 0.9;
        if (this.damage > 0) zoneDamage(w, e, this.damage, color, this.statuses);
        else if (this.statuses) for (const s of this.statuses) inflict(w, e, s, false);
      }
    }
    const fade = this.fade;
    if (this.kind === 'fire' && fx.chance(dt * 14 * fade)) {
      w.particles.spawn({
        x: this.x + fx.range(-this.radius, this.radius) * 0.7, y: this.y + fx.range(-2, 2), vy: -fx.range(15, 35), vx: fx.range(-5, 5),
        life: fx.range(0.25, 0.5), colors: ['#fff0a0', '#ffb040', '#ff6020', '#802010'], size: fx.range(1, 2), additive: true,
      });
    } else if (this.kind === 'poison' && fx.chance(dt * 5 * fade)) {
      w.particles.spawn({
        x: this.x + fx.range(-this.radius, this.radius) * 0.7, y: this.y + fx.range(-3, 3), vy: -fx.range(4, 12),
        life: fx.range(0.4, 0.8), colors: ['#e0ff90', '#8aff5a', '#3a8a20'], size: fx.range(1, 2), shape: 'circle',
      });
    }
    if (this.age >= this.life) this.dead = true;
  }

  get fade(): number {
    const left = this.life - this.age;
    return clamp(Math.min(this.age / 0.15, left / 0.5), 0, 1);
  }

  override draw(r: Renderer): void {
    const a = this.fade;
    const R = this.radius;
    if (this.kind === 'fire') {
      r.circle(this.x, this.y, R * 0.95, '#401008', 0.35 * a);
      const t = this.age * 12 + this.seed;
      for (let i = 0; i < 4; i++) {
        const ox = Math.sin(this.seed * 3 + i * 2.1) * R * 0.55;
        const h = 3 + ((Math.floor(t + i * 1.7) % 3) + 1) * 1.2;
        const x = this.x + ox;
        r.rect(x - 1, this.y - h + 1, 3, h, '#ff6a20', 0.85 * a);
        r.rect(x, this.y - h + 2, 1, h - 2, '#ffe080', a);
      }
    } else if (this.kind === 'poison') {
      r.circle(this.x, this.y, R, '#2a6a18', 0.55 * a);
      r.circle(this.x - R * 0.2, this.y - 1, R * 0.65, '#5ac030', 0.55 * a);
      const b = Math.floor(this.age * 3 + this.seed) % 4;
      r.circle(this.x + Math.cos(this.seed + b) * R * 0.5, this.y + Math.sin(this.seed * 2 + b) * R * 0.3, 1.2, '#d0ff80', 0.9 * a);
    } else {
      r.circle(this.x, this.y, R, '#9fe8ff', 0.3 * a);
      r.ring(this.x, this.y, R, '#e0f8ff', 1, 0.6 * a);
    }
  }

  override light(w: World): void {
    if (this.kind === 'fire') w.lights.add(this.x, this.y - 3, 26 * this.fade, '#ff9040', { intensity: 0.7 });
    else if (this.kind === 'poison') w.lights.add(this.x, this.y, 18 * this.fade, '#8aff5a', { intensity: 0.35 });
  }
}

// ====================================================================== familiars
const FAMILIAR_CAP = 12;
const familiarReg = new WeakMap<World, Map<string, Familiar[]>>();

/**
 * Base class for familiars & orbitals. They are not persistent: when the room
 * changes, `syncFamiliars` (called from the owning item's onUpdate) respawns them.
 */
export abstract class Familiar extends Entity {
  room: unknown;
  /** index among familiars of the same key, and how many there are */
  slot = 0;
  count = 1;
  power = 1;
  bob = fx.range(0, 6);
  constructor(w: World) {
    super();
    this.team = 'player';
    this.tileCollide = false;
    this.flying = true;
    this.layer = 1;
    this.room = w.room;
    this.x = w.player.x;
    this.y = w.player.y;
    this.z = 8;
  }

  /** Destroy enemy bullets touching (x, y, r). Returns how many were blocked. */
  blockBullets(w: World, r: number, onBlock?: (p: Projectile) => void): number {
    let n = 0;
    for (const p of w.projectiles) {
      if (p.dead || p.team !== 'enemy' || p.delay > 0) continue;
      const rr = r + p.r;
      if (dist2(p.x, p.y - p.z * 0.3, this.x, this.y - this.z * 0.5) < rr * rr) {
        onBlock?.(p);
        p.expire(w, true);
        n++;
      }
    }
    if (n) w.sfx('shield_block', { vol: 0.35, pitch: fx.range(1.2, 1.5) });
    return n;
  }

  /** Contact damage with a per-enemy cooldown. */
  contact(w: World, r: number, dmg: number, cd: number, statuses?: StatusApply[]): Enemy[] {
    const hit: Enemy[] = [];
    for (const e of w.enemies) {
      if (!e.alive || e.hidden || !e.vulnerable) continue;
      const rr = r + e.r;
      if (dist2(e.x, e.y - e.z * 0.3, this.x, this.y - this.z * 0.4) >= rr * rr) continue;
      const k = `__fc${this.id}`;
      if ((e.mem[k] ?? -99) > w.time) continue;
      e.mem[k] = w.time + cd;
      itemHit(w, e, dmg, { from: this, knockback: 60, statuses });
      hit.push(e);
    }
    return hit;
  }

  /** Fire a familiar shot (generation 1: no item spawn-procs, no onShoot). */
  shoot(w: World, angle: number, o: Partial<ProjectileOpts> & { damage: number }): Projectile {
    const p = new Projectile({
      team: 'player', x: this.x + Math.cos(angle) * 4, y: this.y - this.z * 0.5 + Math.sin(angle) * 3, angle,
      speed: 240, radius: 2, range: 170, owner: w.player, knockback: 30, light: 12, z: this.z * 0.5, ...o,
    });
    p.generation = 1;
    w.spawn(p);
    return p;
  }

  override get sortY(): number {
    return this.y + 2;
  }
}

/** last requested familiar counts per world (so they can follow the player at once on room enter) */
const familiarWant = new WeakMap<World, Map<string, { want: number; make: (w: World) => Familiar; power: number }>>();

/** Keep exactly `want` familiars of `key` alive in the current room. */
export function syncFamiliars<T extends Familiar>(w: World, key: string, want: number, make: (w: World) => T, power = 1): T[] {
  let reg = familiarReg.get(w);
  if (!reg) familiarReg.set(w, (reg = new Map()));
  let wants = familiarWant.get(w);
  if (!wants) familiarWant.set(w, (wants = new Map()));
  wants.set(key, { want, make, power });
  let list = (reg.get(key) ?? []) as T[];
  // familiars left behind in the previous room are replaced silently (no spawn poof)
  let followed = false;
  list = list.filter((f) => {
    const ok = !f.dead && f.room === w.room;
    if (!ok && !f.dead) followed = true;
    if (!ok) f.dead = true;
    return ok;
  });
  while (list.length > want) list.pop()!.dead = true;
  if (list.length < want) {
    let total = 0;
    for (const [k, l] of reg) if (k !== key) total += l.filter((f) => !f.dead && f.room === w.room).length;
    while (list.length < want && total + list.length < FAMILIAR_CAP) {
      const f = make(w);
      w.spawn(f);
      list.push(f);
      if (!followed) w.particles.burst(f.x, f.y - 8, { count: 10, speed: [20, 70], life: [0.25, 0.5], colors: ['#ffffff', '#ffe8a0', '#ffc860'], size: [1, 2], additive: true });
    }
  }
  list.forEach((f, i) => {
    f.slot = i;
    f.count = list.length;
    f.power = power;
  });
  reg.set(key, list);
  return list;
}

/** Re-sync every familiar kind (room enter: they arrive with the player, visible during the room slide). */
export function resyncFamiliars(w: World): void {
  const wants = familiarWant.get(w);
  if (!wants) return;
  for (const [key, s] of [...wants]) syncFamiliars(w, key, s.want, s.make, s.power);
}

defineGlobalHooks({
  id: 'familiars_follow',
  onRoomEnter(w) {
    resyncFamiliars(w);
  },
});

export function familiarCount(w: World, key: string): number {
  return familiarReg.get(w)?.get(key)?.filter((f) => !f.dead).length ?? 0;
}

export function familiarsOf<T extends Familiar>(w: World, key: string): T[] {
  return ((familiarReg.get(w)?.get(key) ?? []) as T[]).filter((f) => !f.dead && f.room === w.room);
}

// ====================================================================== time stop
/** Freeze enemies & enemy bullets (scale ~0) for `dur` seconds. Ticked by tickTimeStop. */
export function timeStop(w: World, dur: number, scale = 0.04): void {
  const end = w.time + dur;
  const was = (w.vars.__tsEnd ?? 0) > w.time;
  w.vars.__tsEnd = Math.max(w.vars.__tsEnd ?? 0, end);
  w.enemyTimeScale = Math.min(w.enemyTimeScale, scale);
  w.vars.__tsScale = w.enemyTimeScale;
  if (!was) {
    w.sfx('teleport', { vol: 0.6, pitch: 0.6 });
    w.sfx('freeze', { vol: 0.4, pitch: 0.7 });
    w.renderer.screenFlash('#b0c8ff', 0.25);
    w.spawn(new TimeStopFx(w));
  }
}

export function tickTimeStop(w: World): void {
  const end = w.vars.__tsEnd ?? 0;
  if (end > 0 && w.time >= end) {
    if (Math.abs(w.enemyTimeScale - (w.vars.__tsScale ?? -1)) < 1e-6) w.enemyTimeScale = 1;
    w.vars.__tsEnd = 0;
    w.sfx('whoosh', { vol: 0.5, pitch: 0.7 });
  }
}

export function timeStopped(w: World): boolean {
  return (w.vars.__tsEnd ?? 0) > w.time;
}

/** Blue-grey screen wash + ticking clock ring while time is stopped. */
class TimeStopFx extends Entity {
  room: unknown;
  constructor(w: World) {
    super();
    this.layer = 2;
    this.tileCollide = false;
    this.room = w.room;
    this.x = w.player.x;
    this.y = w.player.y;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    this.x = w.player.x;
    this.y = w.player.y;
    if (!timeStopped(w) || this.room !== w.room) this.dead = true;
  }

  override draw(r: Renderer, w: World): void {
    const left = (w.vars.__tsEnd ?? 0) - w.time;
    const a = clamp(Math.min(this.age / 0.15, left / 0.3), 0, 1);
    r.rect(r.viewX, r.viewY, VIEW_W, VIEW_H, '#3048a0', 0.16 * a);
    // clock hand ring around the player
    const R = 26 + Math.sin(this.age * 3) * 2;
    r.ring(this.x, this.y - 6, R, '#c8d8ff', 1, 0.5 * a);
    const hand = this.age * 1.5 - Math.PI / 2;
    r.line(this.x, this.y - 6, this.x + Math.cos(hand) * (R - 3), this.y - 6 + Math.sin(hand) * (R - 3), '#e8f0ff', 1, 0.7 * a);
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * TAU;
      r.rect(this.x + Math.cos(ang) * R - 0.5, this.y - 6 + Math.sin(ang) * R - 0.5, 1, 1, '#ffffff', 0.8 * a);
    }
  }
}

// ====================================================================== status marks overlay
const markReg = new WeakMap<World, StatusMarks>();

defineDrawnSprite('fx_mark_star', 7, 7, (p) => {
  p.poly([3.5, 0, 4.5, 2.5, 7, 3.5, 4.5, 4.5, 3.5, 7, 2.5, 4.5, 0, 3.5, 2.5, 2.5], '#ffd23a');
  p.px(3, 3, '#fffbe0');
  p.px(3, 2, '#fffbe0');
}, { outline: O });
defineDrawnSprite('fx_charm_heart', 7, 6, (p) => {
  p.circle(2, 2, 2, '#ff7ad9');
  p.circle(5, 2, 2, '#ff7ad9');
  p.poly([0, 2.5, 7, 2.5, 3.5, 6], '#ff7ad9');
  p.px(1, 1, '#ffe0f4');
}, { outline: O });
defineDrawnSprite('fx_fear_drop', 5, 7, (p) => {
  p.poly([2.5, 0, 4.5, 4, 2.5, 7, 0.5, 4], '#b090ff');
  p.ellipse(2.5, 4.5, 2, 2, '#9a6aff');
  p.px(2, 3, '#e0d0ff');
}, { outline: O });
defineDrawnSprite('fx_stun_star', 5, 5, (p) => {
  p.poly([2.5, 0, 3.2, 1.8, 5, 2.5, 3.2, 3.2, 2.5, 5, 1.8, 3.2, 0, 2.5, 1.8, 1.8], '#ffe95a');
  p.px(2, 2, '#ffffff');
});

/** Draws small readable icons above enemies for statuses without a body tint. */
class StatusMarks extends Entity {
  room: unknown;
  constructor(w: World) {
    super();
    this.layer = 2;
    this.tileCollide = false;
    this.room = w.room;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.room !== w.room) {
      this.dead = true;
      return;
    }
    for (const e of w.enemies) {
      if (!e.alive || e.hidden) continue;
      if (e.statuses.has('bleed') && fx.chance(dt * 6)) {
        w.particles.spawn({ x: e.x + fx.range(-e.r, e.r) * 0.6, y: e.y - e.z - e.r * 0.6, z: 0, vy: fx.range(10, 25), life: 0.4, colors: ['#ff4050', '#a01020'], size: 1 });
      }
    }
  }

  override draw(r: Renderer, w: World): void {
    for (const e of w.enemies) {
      if (!e.alive || e.hidden || e.statuses.size === 0) continue;
      const top = e.y - e.z - e.r * 2 - 6;
      if (e.statuses.has('mark')) r.sprite('fx_mark_star', e.x, top - 2 + Math.sin(this.age * 6) * 1.2, { rot: Math.sin(this.age * 3) * 0.3 });
      if (e.statuses.has('charm')) r.sprite('fx_charm_heart', e.x + 6, top + Math.sin(this.age * 5) * 1.5);
      if (e.statuses.has('fear')) r.sprite('fx_fear_drop', e.x - 6, top + 2 + Math.abs(Math.sin(this.age * 4)) * 2);
      if (e.statuses.has('stun')) {
        for (let i = 0; i < 2; i++) {
          const a = this.age * 7 + i * Math.PI;
          r.sprite('fx_stun_star', e.x + Math.cos(a) * (e.r + 2), top + 5 + Math.sin(a) * 2);
        }
      }
    }
  }
}

export function ensureStatusMarks(w: World): void {
  const cur = markReg.get(w);
  if (cur && !cur.dead && cur.room === w.room) return;
  const m = new StatusMarks(w);
  markReg.set(w, m);
  w.spawn(m);
}

// ====================================================================== shared projectile sprites (point right)
defineDrawnSprite('proj_ice_shard', 9, 5, (p) => {
  p.poly([0, 2.5, 3, 0.5, 9, 2.5, 3, 4.5], '#9fe8ff');
  p.line(2, 2, 8, 2, '#ffffff');
  p.px(1, 2, '#4aa0d8');
  p.px(2, 3, '#4aa0d8');
}, { outline: '#10284a' });
defineDrawnSprite('proj_star_shard', 7, 7, (p) => {
  p.poly([3.5, 0, 4.4, 2.6, 7, 3.5, 4.4, 4.4, 3.5, 7, 2.6, 4.4, 0, 3.5, 2.6, 2.6], '#e8dcff');
  p.px(3, 3, '#ffffff');
  p.px(3, 2, '#ffffff');
  p.px(4, 3, '#ffffff');
}, { outline: '#3a2470' });
defineDrawnSprite('proj_venom_drop', 7, 6, (p) => {
  p.ellipse(4, 3, 3, 2.5, '#8aff5a');
  p.poly([0, 3, 3, 1, 3, 5], '#8aff5a');
  p.shadeSphere(4, 3, 3, 2.5, ['#2a7a18', '#5ad030', '#8aff5a', '#d8ff9a'], { dither: false });
  p.px(4, 2, '#ffffff');
}, { outline: '#103a08' });
defineDrawnSprite('proj_blood_dart', 9, 5, (p) => {
  p.poly([0, 1, 6, 1.2, 9, 2.5, 6, 3.8, 0, 4], '#e02838');
  p.line(1, 2, 7, 2, '#ff8090');
  p.px(8, 2, '#ffd0d8');
}, { outline: '#3a0610' });
defineDrawnSprite('proj_shrapnel', 5, 4, (p) => {
  p.poly([0, 0, 5, 1.5, 3, 4, 0, 3], '#ffb040');
  p.px(1, 1, '#fff0a0');
}, { outline: '#3a1008' });

// ====================================================================== falling stars
defineDrawnSprite('fx_falling_star', 9, 9, (p) => {
  p.poly([4.5, 0, 5.7, 3.3, 9, 4.5, 5.7, 5.7, 4.5, 9, 3.3, 5.7, 0, 4.5, 3.3, 3.3], '#d8c8ff');
  p.poly([4.5, 1.5, 5.2, 3.8, 7.5, 4.5, 5.2, 5.2, 4.5, 7.5, 3.8, 5.2, 1.5, 4.5, 3.8, 3.8], '#ffffff');
}, { outline: '#2a1a50' });

/** A star that falls on (x, y) after a telegraphed circle, damaging enemies only. */
export class Starfall extends Entity {
  fall: number;
  radius: number;
  damage: number;
  color: string;
  constructor(x: number, y: number, o: { damage: number; radius?: number; fall?: number; color?: string }) {
    super();
    this.x = x;
    this.y = y;
    this.damage = o.damage;
    this.radius = o.radius ?? 18;
    this.fall = o.fall ?? 0.75;
    this.color = o.color ?? '#b8a8ff';
    this.layer = 2;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const t = this.age / this.fall;
    if (fx.chance(dt * 40) && t < 1) {
      const z = (1 - t) * 140;
      w.particles.spawn({ x: this.x + (1 - t) * 50 + fx.range(-1, 1), y: this.y - z, life: 0.3, colors: ['#ffffff', this.color, '#5a4aa0'], size: 2, sizeEnd: 0, additive: true });
    }
    if (t >= 1) {
      this.dead = true;
      w.sfx('explosion', { vol: 0.45, pitch: 1.5 });
      w.sfx('orb', { vol: 0.5, pitch: 1.4 });
      w.shake(0.25);
      w.particles.burst(this.x, this.y - 2, { count: 26, speed: [50, 170], life: [0.25, 0.6], colors: ['#ffffff', '#e8e0ff', this.color, '#6a50c0'], size: [1, 3], additive: true, light: 7, lightColor: this.color });
      w.particles.spawn({ x: this.x, y: this.y, life: 0.3, size: 3, sizeEnd: this.radius * 1.3, colors: ['#ffffff', this.color], shape: 'ring' });
      w.lights.glow(this.x, this.y, this.radius * 2.5, this.color, 0.7);
      w.decal(this.x, this.y, '#20184a', this.radius * 0.5, 0.45);
      for (const e of enemiesNear(w, this.x, this.y, this.radius)) itemHit(w, e, this.damage, { from: this, knockback: 160, procs: ['starfall'] });
    }
  }

  override draw(r: Renderer): void {
    const t = clamp(this.age / this.fall, 0, 1);
    const blink = 0.3 + 0.25 * Math.sin(this.age * 30);
    r.circle(this.x, this.y, this.radius, this.color, blink * 0.35);
    r.circle(this.x, this.y, this.radius * t, this.color, 0.25);
    r.ring(this.x, this.y, this.radius, '#e8e0ff', 1, 0.8);
    const z = (1 - t) * 140;
    r.sprite('fx_falling_star', this.x + (1 - t) * 50, this.y - z, { rot: this.age * 9, sx: 1 + t * 0.4, sy: 1 + t * 0.4 });
  }

  override light(w: World): void {
    const t = clamp(this.age / this.fall, 0, 1);
    w.lights.add(this.x + (1 - t) * 50, this.y - (1 - t) * 140, 30, this.color, { intensity: 0.8 });
    w.lights.add(this.x, this.y, this.radius * 1.5 * t, this.color, { intensity: 0.5 });
  }
}

// ====================================================================== small blasts
/** Small, quiet explosion that only hurts enemies (item procs; cheaper than World.explode). */
export function miniBlast(w: World, x: number, y: number, radius: number, damage: number, color = '#ff9a30', statuses?: StatusApply[]): void {
  w.particles.burst(x, y, { count: 12, speed: [40, 120], life: [0.15, 0.35], colors: ['#ffffff', '#fff0a0', color, '#802010'], size: [1, 2], additive: true, light: 4, lightColor: color.slice(0, 7) });
  w.particles.burst(x, y, { count: 4, speed: [10, 30], life: [0.4, 0.7], colors: ['#706060', '#403838'], size: [2, 3], sizeEnd: 4, drag: 3 });
  w.particles.spawn({ x, y, life: 0.2, size: 2, sizeEnd: radius, colors: ['#ffffff', color], shape: 'ring' });
  w.lights.glow(x, y, radius * 1.8, color.slice(0, 7), 0.5);
  w.sfx('explosion', { vol: 0.22, pitch: fx.range(1.5, 1.8) });
  for (const e of enemiesNear(w, x, y, radius)) itemHit(w, e, damage, { from: { x, y }, knockback: 90, statuses, kind: 'explosion' });
}

// ====================================================================== misc
/** Floating label above the player (item procs, resonance). */
export function shout(w: World, text: string, color: string): void {
  w.floatText(w.player.x, w.player.y - 22, text, color);
}

/** Simple timer stored in w.vars: returns true at most every `cd` seconds. */
export function cooldown(w: World, key: string, cd: number): boolean {
  const k = `__cd_${key}`;
  if ((w.vars[k] ?? -99) > w.time) return false;
  w.vars[k] = w.time + cd;
  return true;
}

export { TAU };
