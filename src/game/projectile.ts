// Projectiles for both teams. Player projectiles carry item-driven modifiers
// (pierce, bounce, homing, statuses, behaviors); enemy projectiles are simple
// readable orbs that deal half-heart damage.

import { Entity, type Actor, type HitInfo, type StatusApply, type Team } from './entity';
import type { World } from './world';
import type { DrawOpts, Renderer } from '../engine/renderer';
import { defineDrawnSprite, hasSprite } from '../engine/sprites';
import { ramp } from '../engine/painter';
import { angleOf, rotateToward, TAU } from '../engine/math';
import { fx } from '../engine/rng';
import { save } from '../engine/save';
import { TILE } from './constants';
import { Tile, tileProps } from './tiles';
import { drawShot, shotTrail, type ShotLook } from './look';

export interface ProjBehavior {
  /** optional id so items can avoid adding the same behavior twice */
  id?: string;
  update?(p: Projectile, w: World, dt: number): void;
  /** after damage was applied to `target` */
  onHit?(p: Projectile, w: World, target: Actor, hit: HitInfo): void;
  /** hit a solid tile; return true to keep the projectile alive */
  onWall?(p: Projectile, w: World): boolean | void;
  /** projectile is removed for any reason (range end, wall, hit) */
  onExpire?(p: Projectile, w: World): void;
  draw?(p: Projectile, r: Renderer, w: World): void;
}

export type ProjStyle = 'orb' | 'tear' | 'sprite' | 'none';

export interface ProjectileOpts {
  team: Team;
  x: number;
  y: number;
  angle: number;
  speed: number;
  /** enemy projectiles: half-hearts dealt to the player (default 1) */
  damage: number;
  radius?: number;
  /** travel distance in px before expiring (default 400) */
  range?: number;
  /** lifetime cap in seconds (default 6) */
  life?: number;
  owner?: Actor | null;
  pierce?: number;
  bounce?: number;
  /** homing turn rate rad/s */
  homing?: number;
  /** passes through rocks/blocks (not walls) */
  spectral?: boolean;
  color?: string;
  style?: ProjStyle;
  sprite?: string;
  /** rotate sprite to face movement */
  spriteRotates?: boolean;
  light?: number;
  knockback?: number;
  statuses?: StatusApply[];
  crit?: boolean;
  /** created by the player's weapon (fires onShoot hooks) */
  fromWeapon?: boolean;
  /** acceleration px/s^2 along direction (negative = decelerate) */
  accel?: number;
  minSpeed?: number;
  maxSpeed?: number;
  /** visual height above floor */
  z?: number;
  /** curve: constant angular velocity rad/s */
  curve?: number;
  /** delay before moving (s) — telegraphed bullets */
  delay?: number;
  behaviors?: ProjBehavior[];
}

const LIGHT_OPTS = { intensity: 0.8 };
const orbCache = new Set<string>();
/** Get (and lazily define) an outlined, shaded orb sprite of diameter d in color. */
export function orbSprite(d: number, color: string, outline = '#1a0d14'): string {
  d = Math.max(2, Math.min(28, Math.round(d)));
  const name = `__orb_${d}_${color}_${outline}`;
  if (orbCache.has(name) || hasSprite(name)) return name;
  orbCache.add(name);
  defineDrawnSprite(name, d, d, (p) => {
    const r = d / 2;
    p.circle(r, r, r, color);
    if (d >= 4) p.shadeSphere(r, r, r, r, ramp(color, 4, 0.9), { dither: d >= 8 });
    // specular highlight
    const hx = Math.max(0, Math.round(r - r * 0.45 - 0.5));
    const hy = Math.max(0, Math.round(r - r * 0.45 - 0.5));
    p.px(hx, hy, '#ffffff');
    if (d >= 7) p.px(hx + 1, hy, '#ffffffcc');
  }, { outline });
  return name;
}

export class Projectile extends Entity {
  owner: Actor | null;
  damage: number;
  speed: number;
  angle: number;
  range: number;
  traveled = 0;
  life: number;
  pierce: number;
  bounce: number;
  homing: number;
  spectral: boolean;
  color: string;
  style: ProjStyle;
  sprite?: string;
  spriteRotates: boolean;
  lightR: number;
  knockback: number;
  statuses: StatusApply[];
  crit: boolean;
  fromWeapon: boolean;
  accel: number;
  minSpeed: number;
  maxSpeed: number;
  curve: number;
  delay: number;
  behaviors: ProjBehavior[];
  /** ids of actors already hit (for piercing) */
  hitIds = new Set<number>();
  /** extra per-projectile scratch data for behaviors */
  mem: Record<string, number> = {};
  /** set when this projectile was created by a split / effect (to limit recursion) */
  generation = 0;
  scale = 1;
  trailT = 0;
  /** composed artifact look (player weapon shots; see game/look.ts) */
  look: ShotLook | null = null;
  /** color right after the look was applied (a later recolor by an item wins) */
  lookBase = '';
  lookD = -1;
  lookBody = '';
  lookName = '';
  trailN = 0;

  constructor(o: ProjectileOpts) {
    super();
    this.team = o.team;
    this.x = o.x;
    this.y = o.y;
    this.z = o.z ?? (o.team === 'player' ? 5 : 3);
    this.angle = o.angle;
    this.speed = o.speed;
    this.damage = o.damage;
    this.r = o.radius ?? 3;
    this.range = o.range ?? 400;
    this.life = o.life ?? 6;
    this.owner = o.owner ?? null;
    this.pierce = o.pierce ?? 0;
    this.bounce = o.bounce ?? 0;
    this.homing = o.homing ?? 0;
    this.spectral = o.spectral ?? false;
    this.color = o.color ?? (o.team === 'player' ? '#9fd8ff' : '#ff4a5a');
    this.style = o.style ?? (o.sprite ? 'sprite' : 'orb');
    this.sprite = o.sprite;
    this.spriteRotates = o.spriteRotates ?? true;
    this.lightR = o.light ?? (o.team === 'player' ? 18 : 14);
    this.knockback = o.knockback ?? 60;
    this.statuses = o.statuses ?? [];
    this.crit = o.crit ?? false;
    this.fromWeapon = o.fromWeapon ?? false;
    this.accel = o.accel ?? 0;
    this.minSpeed = o.minSpeed ?? 0;
    this.maxSpeed = o.maxSpeed ?? 2000;
    this.curve = o.curve ?? 0;
    this.delay = o.delay ?? 0;
    this.behaviors = o.behaviors ? [...o.behaviors] : [];
    this.tileCollide = false;
    this.flying = true;
    this.layer = 1;
    this.syncVel();
  }

  syncVel(): void {
    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed;
  }

  addBehavior(b: ProjBehavior): void {
    if (b.id && this.behaviors.some((x) => x.id === b.id)) return;
    this.behaviors.push(b);
  }

  override get sortY(): number {
    return this.y + 2;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.delay > 0) {
      this.delay -= dt;
      return;
    }
    // homing toward nearest opposing actor
    if (this.homing > 0) {
      const target = this.team === 'player' ? w.nearestEnemy(this.x, this.y, 170, this.hitIds) : w.player;
      if (target && target.alive) {
        const want = Math.atan2(target.y - this.y, target.x - this.x);
        this.angle = rotateToward(this.angle, want, this.homing * dt);
      }
    }
    if (this.curve) this.angle += this.curve * dt;
    if (this.accel) this.speed = Math.max(this.minSpeed, Math.min(this.maxSpeed, this.speed + this.accel * dt));
    this.syncVel();
    for (const b of this.behaviors) b.update?.(this, w, dt);
    if (this.dead) return;

    const px = this.x;
    const py = this.y;
    // floor difficulty: enemy bullets fly a little faster deeper down (FloorDef.shotSpeed)
    const k = this.team === 'enemy' ? (w.floor?.shotSpeed ?? 1) : 1;
    this.x += this.vx * dt * k;
    this.y += this.vy * dt * k;
    this.traveled += Math.hypot(this.x - px, this.y - py);

    // trail particles for player shots
    if (this.team === 'player' && this.style !== 'none') {
      this.trailT += dt;
      if (this.trailT > 0.03) {
        this.trailT = 0;
        if (this.look) shotTrail(this, w, this.look);
        else w.particles.spawn({
          x: this.x + fx.range(-1, 1), y: this.y - this.z + fx.range(-1, 1), life: 0.18,
          colors: this.fxCols()[0], size: Math.max(1, this.r * 0.6), sizeEnd: 0.5, shape: 'pixel',
        });
      }
    }

    // tiles
    const tx = Math.floor(this.x / TILE);
    const ty = Math.floor(this.y / TILE);
    const t = w.room.tileAt(tx, ty);
    const props = tileProps(t);
    if (props.blocksShots && !(this.spectral && t !== Tile.WALL && t !== Tile.DOOR)) {
      if (props.breakable && this.team === 'player') w.room.damageTile(w, tx, ty, this.damage);
      if (this.team === 'player' && (t === Tile.ROCK || t === Tile.TINTED || t === Tile.BLOCK)) {
        // sparks off rock
        w.particles.burst(this.x, this.y - this.z, { count: 3, speed: [20, 60], life: [0.1, 0.25], colors: ['#ffffff', '#c8b8a8'] });
      }
      let keep = false;
      for (const b of this.behaviors) if (b.onWall?.(this, w)) keep = true;
      if (!keep && this.bounce > 0) {
        this.bounce--;
        // reflect based on which axis entered the tile
        const ptx = Math.floor(px / TILE);
        const pty = Math.floor(py / TILE);
        if (ptx !== tx) this.vx = -this.vx;
        if (pty !== ty) this.vy = -this.vy;
        if (ptx === tx && pty === ty) { this.vx = -this.vx; this.vy = -this.vy; }
        this.x = px;
        this.y = py;
        this.angle = angleOf(this.vx, this.vy);
        keep = true;
      }
      if (!keep) {
        this.expire(w, true);
        return;
      }
    }

    if (this.traveled >= this.range || this.age >= this.life) {
      this.expire(w, false);
    }
  }

  /** Remove with impact effect. */
  expire(w: World, impact: boolean): void {
    if (this.dead) return;
    this.dead = true;
    for (const b of this.behaviors) b.onExpire?.(this, w);
    const n = impact ? 6 : 4;
    w.particles.burst(this.x, this.y - this.z * (impact ? 1 : 0.3), {
      count: n, speed: [25, 70], life: [0.15, 0.35], colors: this.fxCols()[1], size: [1, 2],
    });
    if (this.team === 'player') w.sfx('tear_splash', { vol: 0.35, pitch: fx.range(0.9, 1.15), x: this.x });
  }

  /** Damage and effects for hitting `target` (called by the world collision pass). */
  hitActor(w: World, target: Actor): void {
    if (this.hitIds.has(target.id)) return;
    this.hitIds.add(target.id);
    const l = Math.hypot(this.vx, this.vy) || 1;
    const hit: HitInfo = {
      damage: this.damage,
      kind: 'projectile',
      source: this,
      attacker: this.owner,
      dirX: this.vx / l,
      dirY: this.vy / l,
      knockback: this.knockback,
      crit: this.crit,
      statuses: this.statuses,
    };
    const applied = w.applyHit(target, hit);
    if (applied) for (const b of this.behaviors) b.onHit?.(this, w, target, hit);
    if (this.pierce > 0 && target.team !== 'player') {
      this.pierce--;
    } else {
      this.expire(w, true);
    }
  }

  /** This peer's display preference; never used by the simulation. */
  visualOpacity(w: World): number {
    const owner = this.owner ?? this.ctxP;
    if (!w.coop || this.team !== 'player' || owner === w.local || !w.players.some(p => p === owner)) return 1;
    const value = save.settings.teammateProjectileOpacity ?? 0.5;
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
  }

  override draw(r: Renderer, w: World): void {
    const opacity = this.visualOpacity(w);
    if (opacity <= 0) return;
    const before = r.worldOpacity;
    r.worldOpacity *= opacity;
    try { this.drawVisible(r, w); }
    finally { r.worldOpacity = before; }
  }

  private drawVisible(r: Renderer, w: World): void {
    if (this.style === 'none') {
      for (const b of this.behaviors) b.draw?.(this, r, w);
      return;
    }
    const dy = this.y - this.z;
    // shadow
    r.shadow(this.x, this.y + 1, this.r * 1.6, this.r * 0.7, 0.25);
    if (this.delay > 0) {
      // telegraph: blinking ghost
      if (Math.floor(this.age * 20) % 2 === 0) r.sprite(orbSprite(this.r * 2 + 1, this.color), this.x, dy, { alpha: 0.5 });
      return;
    }
    if (this.look) drawShot(this, r, this.look, dy);
    else if (this.style === 'sprite' && this.sprite) {
      const o = SPRITE_OPTS;
      o.rot = this.spriteRotates ? this.angle : 0;
      o.sx = this.scale;
      o.sy = this.scale;
      r.sprite(this.sprite, this.x, dy, o);
    } else {
      const d = (this.r * 2 + 1) * this.scale;
      // the sprite name is cached per projectile (no string building per frame)
      if (d !== this.orbD || this.color !== this.orbColor) {
        this.orbD = d;
        this.orbColor = this.color;
        this.orbName = orbSprite(d, this.color);
      }
      const name = this.orbName;
      // stretch a bit along movement for speed feel
      if (this.style === 'tear') TEAR_OPTS.rot = this.angle;
      r.sprite(name, this.x, dy, this.style === 'tear' ? TEAR_OPTS : undefined);
    }
    for (const b of this.behaviors) b.draw?.(this, r, w);
  }

  private fxColSrc = '';
  private fxColCache: [string[], string[]] | null = null;
  /** [trail colors, impact colors] for the current color (rebuilt only when a behavior recolors the shot) */
  private fxCols(): [string[], string[]] {
    if (!this.fxColCache || this.fxColSrc !== this.color) {
      this.fxColSrc = this.color;
      this.fxColCache = [[this.color, this.color + '80'], ['#ffffff', this.color, this.color + '90']];
    }
    return this.fxColCache;
  }

  private orbD = -1;
  private orbColor = '';
  private orbName = '';
  private lightCol = '';
  private lightSrc = '';
  override light(w: World): void {
    const opacity = this.visualOpacity(w);
    if (this.lightR <= 0 || opacity <= 0) return;
    // color may be changed by behaviors: re-derive the #rrggbb only when it does
    if (this.lightSrc !== this.color) {
      this.lightSrc = this.color;
      this.lightCol = this.color.slice(0, 7);
    }
    LIGHT_OPTS.intensity = 0.8 * opacity;
    w.lights.add(this.x, this.y - this.z, this.lightR, this.lightCol, LIGHT_OPTS);
  }
}

/** reused draw options (projectiles are drawn every frame, many at once) */
const SPRITE_OPTS: DrawOpts = { rot: 0, sx: 1, sy: 1 };
const TEAR_OPTS: DrawOpts = { rot: 0, sx: 1.15, sy: 0.92 };

/** Spawn `count` projectiles in a ring. */
export function ringAngles(count: number, offset = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(offset + (i / count) * TAU);
  return out;
}

/** Angles for a fan of `count` projectiles centered on `angle`. */
export function fanAngles(angle: number, count: number, spread: number): number[] {
  if (count <= 1) return [angle];
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(angle + (i - (count - 1) / 2) * spread);
  return out;
}
