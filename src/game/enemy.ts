// Enemy actor. Behaviour comes from EnemyDef.script (a generator, see engine/script.ts)
// plus the helper methods below, which make writing AI scripts short:
//
//   script: function* (e, w) {
//     while (true) {
//       yield* e.wanderFor(w, 1.2, 30);
//       e.telegraph(0.4);  yield 0.4;
//       e.shootAt(w, w.player, { speed: 120 });
//     }
//   }

import { Actor, type HitInfo, type StatusApply } from './entity';
import { Enemies, type EnemyDef } from './defs';
import type { World } from './world';
import type { Renderer } from '../engine/renderer';
import { ScriptRunner, type Script } from '../engine/script';
import { animFrame, hasAnim } from '../engine/sprites';
import { angleTo, clamp, dist, norm, TAU } from '../engine/math';
import { Projectile, fanAngles, orbSprite, type ProjectileOpts } from './projectile';
import { fx } from '../engine/rng';

export interface ShootOpts extends Partial<ProjectileOpts> {
  speed?: number;
  /** half-hearts; default 1 */
  damage?: number;
}

export class Enemy extends Actor {
  def: EnemyDef;
  script: ScriptRunner;
  /** current animation / sprite name (defaults to def.sprite) */
  anim: string;
  animT = 0;
  /** horizontal facing for flipping (-1 left, 1 right) */
  facing = 1;
  /** scratch memory for scripts */
  mem: Record<string, any> = {};
  /** base move speed (def.speed, possibly modified by champion) */
  speed: number;
  contactDamage: number;
  /** contact damage active (e.g. off while burrowed) */
  harmful = true;
  /** can be hit (e.g. off while underground / invulnerable phase) */
  vulnerable = true;
  /** hidden from rendering / targeting (burrowed) */
  hidden = false;
  /** spawn grace: no attacks / contact while > 0 */
  dormant = 0.6;
  champion = false;
  championColor = '';
  /** telegraph timer (draws a warning flash) */
  telegraphT = 0;
  telegraphMax = 0;
  /** desired velocity set by helpers; the actor accelerates toward it */
  wantVX = 0;
  wantVY = 0;
  accel = 900;
  /** boss phase counter for scripts */
  phase = 0;
  /** spawned by another enemy (does not count for some room logic / drops) */
  isMinion = false;
  /** don't count toward room clear (e.g. harmless critters) */
  ignoreForClear = false;
  /** extra sprite draw options */
  rot = 0;
  scale = 1;
  alpha = 1;
  /** ids of extra parts etc. */
  parent: Enemy | null = null;
  lastDamageSource = '';

  constructor(def: EnemyDef, x: number, y: number, hpMult = 1) {
    super();
    this.def = def;
    this.x = x;
    this.y = y;
    this.team = 'enemy';
    this.r = def.radius;
    this.maxHp = this.hp = Math.max(1, Math.round(def.hp * hpMult));
    this.speed = def.speed ?? 40;
    this.contactDamage = def.contactDamage ?? 1;
    this.flying = !!def.flying;
    this.phasing = !!def.phasing;
    this.mass = def.mass ?? 1;
    this.anim = def.sprite;
    this.solid = true;
    this.script = new ScriptRunner(null);
  }

  /** Called by World.spawnEnemy after the enemy was added. */
  start(w: World): void {
    this.def.init?.(this, w);
    if (this.def.script) this.script.set(this.def.script(this, w));
  }

  get isBoss(): boolean {
    return !!this.def.boss;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    this.animT += dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.telegraphT > 0) this.telegraphT -= dt;
    this.updateStatuses(w, dt);
    if (!this.alive) return;
    this.updateKnockback(dt);
    this.updateSquash(dt);

    const sm = this.speedMult() * w.enemyTimeScale;
    const edt = dt * w.enemyTimeScale;

    if (this.dormant > 0) {
      this.dormant -= dt;
    } else if (this.hasStatus('fear')) {
      // run away from the player
      const d = norm(this.x - w.player.x, this.y - w.player.y);
      this.wantVX = d.x * this.speed;
      this.wantVY = d.y * this.speed;
    } else if (!this.hasStatus('freeze') && !this.hasStatus('stun')) {
      this.script.update(edt);
      this.def.update?.(this, w, edt);
    }

    // accelerate toward desired velocity
    const ax = this.wantVX * sm - this.vx;
    const ay = this.wantVY * sm - this.vy;
    const al = Math.hypot(ax, ay);
    const maxA = this.accel * dt;
    if (al > maxA) {
      this.vx += (ax / al) * maxA;
      this.vy += (ay / al) * maxA;
    } else {
      this.vx += ax;
      this.vy += ay;
    }
    if (Math.abs(this.vx) > 4) this.facing = this.vx > 0 ? 1 : -1;

    // integrate (velocity + knockback)
    const vx = this.vx;
    const vy = this.vy;
    this.vx = vx * w.enemyTimeScale + this.kbx;
    this.vy = vy * w.enemyTimeScale + this.kby;
    const hit = this.move(w, dt);
    this.vx = vx;
    this.vy = vy;
    if (hit.hitX) { this.kbx = 0; this.mem.__bumpX = 1; }
    if (hit.hitY) { this.kby = 0; this.mem.__bumpY = 1; }
    this.mem.__bumped = hit.hitX || hit.hitY ? 1 : 0;

    // z (jumping)
    if (this.z > 0 || this.vz !== 0) {
      this.vz -= 600 * edt;
      this.z += this.vz * edt;
      if (this.z <= 0) {
        this.z = 0;
        this.vz = 0;
      }
    }
  }

  override takeHit(w: World, hit: HitInfo): boolean {
    if (!this.alive || !this.vulnerable || this.hidden) return false;
    let dmg = hit.damage;
    if (this.hasStatus('weak')) dmg *= 1.35;
    if (this.hasStatus('freeze') && hit.kind !== 'status') dmg *= 1.2;
    this.hp -= dmg;
    this.lastHurtAt = w.time;
    if (hit.kind !== 'status') {
      this.flash = 0.1;
      this.squash(1.25, 0.8);
      if (hit.knockback && hit.dirX !== undefined && hit.dirY !== undefined) this.knock(hit.dirX, hit.dirY, hit.knockback);
    }
    if (hit.statuses) for (const s of hit.statuses) this.applyStatus(s as StatusApply, () => w.rng.next());
    this.def.onHurt?.(this, w, hit);
    return true;
  }

  // -------------------------------------------------------------- AI helpers
  /** Position the enemy should target (player, or nearest enemy when charmed). */
  target(w: World): { x: number; y: number } {
    if (this.hasStatus('charm')) {
      const other = w.nearestEnemy(this.x, this.y, 400, undefined, this);
      if (other) return other;
    }
    return w.player;
  }

  angleToTarget(w: World): number {
    const t = this.target(w);
    return angleTo(this.x, this.y, t.x, t.y);
  }

  distToTarget(w: World): number {
    const t = this.target(w);
    return dist(this.x, this.y, t.x, t.y);
  }

  /** Set desired velocity toward a direction (normalized internally). */
  moveDir(dx: number, dy: number, speed = this.speed): void {
    const n = norm(dx, dy);
    this.wantVX = n.x * speed;
    this.wantVY = n.y * speed;
  }

  moveAngle(a: number, speed = this.speed): void {
    this.wantVX = Math.cos(a) * speed;
    this.wantVY = Math.sin(a) * speed;
  }

  stop(): void {
    this.wantVX = 0;
    this.wantVY = 0;
  }

  /** Hard stop including current velocity. */
  halt(): void {
    this.wantVX = this.wantVY = this.vx = this.vy = 0;
  }

  /** Move toward the target using the room flow field (walks around rocks). Flying enemies go straight. */
  chase(w: World, speed = this.speed): void {
    const t = this.target(w);
    if (this.flying || this.phasing || t !== w.player) {
      this.moveDir(t.x - this.x, t.y - this.y, speed);
      return;
    }
    const d = w.flow.dirAt(this.x, this.y);
    if (d) this.moveDir(d.x, d.y, speed);
    else this.moveDir(t.x - this.x, t.y - this.y, speed);
  }

  /** Move away from target. */
  flee(w: World, speed = this.speed): void {
    const t = this.target(w);
    this.moveDir(this.x - t.x, this.y - t.y, speed);
  }

  /** Script: wander randomly for `time` seconds. */
  *wanderFor(w: World, time: number, speed = this.speed * 0.6): Script {
    let a = w.rng.angle();
    let el = 0;
    let turn = 0;
    while (el < time) {
      turn -= w.dt;
      if (turn <= 0 || this.mem.__bumped) {
        a = w.rng.angle();
        turn = w.rng.range(0.4, 1.2);
      }
      this.moveAngle(a, speed);
      yield;
      el += w.dt;
    }
    this.stop();
  }

  /** Script: chase the target for `time` seconds. */
  *chaseFor(w: World, time: number, speed = this.speed): Script {
    let el = 0;
    while (el < time) {
      this.chase(w, speed);
      yield;
      el += w.dt;
    }
  }

  /** Script: dash in a straight line at `speed` until a wall is hit or `maxTime` passes. */
  *charge(w: World, angle: number, speed: number, maxTime = 1.5): Script {
    let el = 0;
    this.accel = 4000;
    this.mem.__bumped = 0;
    while (el < maxTime) {
      this.moveAngle(angle, speed);
      yield;
      el += w.dt;
      if (this.mem.__bumped) break;
    }
    this.accel = 900;
    this.stop();
  }

  /** Script: jump in an arc to (x, y) over `time` seconds. Invulnerable & harmless while high. */
  *jumpTo(w: World, x: number, y: number, time = 0.6, height = 40): Script {
    const sx = this.x;
    const sy = this.y;
    let el = 0;
    w.sfx('enemy_jump', { vol: 0.5 });
    const wasHarmful = this.harmful;
    this.harmful = false;
    const wasFlying = this.flying;
    this.flying = true;
    while (el < time) {
      el += w.dt;
      const t = clamp(el / time, 0, 1);
      const nx = sx + (x - sx) * t;
      const ny = sy + (y - sy) * t;
      this.vx = this.vy = 0;
      this.wantVX = this.wantVY = 0;
      if (!w.room.boxBlocked(nx, ny, this.r, true, this.phasing)) {
        this.x = nx;
        this.y = ny;
      }
      this.z = Math.sin(t * Math.PI) * height;
      yield;
    }
    this.z = 0;
    this.flying = wasFlying;
    this.harmful = wasHarmful;
    this.squash(1.35, 0.7);
    w.sfx('enemy_land', { vol: 0.6 });
    w.particles.burst(this.x, this.y, { count: 8, speed: [30, 80], life: [0.2, 0.4], colors: ['#8a7a6a', '#5a4a3a'], size: [1, 2] });
  }

  /** Flash a warning before an attack. */
  telegraph(time: number): void {
    this.telegraphT = time;
    this.telegraphMax = time;
  }

  /** Fire one enemy projectile. */
  shoot(w: World, angle: number, o: ShootOpts = {}): Projectile {
    const p = new Projectile({
      team: 'enemy',
      x: this.x + Math.cos(angle) * (this.r * 0.6),
      y: this.y + Math.sin(angle) * (this.r * 0.6) - 1,
      angle,
      speed: o.speed ?? 110,
      damage: o.damage ?? 1,
      radius: o.radius ?? 3,
      range: o.range ?? 600,
      owner: this,
      ...o,
    });
    if (this.champion && !o.color) p.color = '#ff9a3a';
    w.spawn(p);
    return p;
  }

  /** Fire at the target with optional fan. */
  shootAt(w: World, target: { x: number; y: number } | null = null, o: ShootOpts & { count?: number; spread?: number } = {}): void {
    const t = target ?? this.target(w);
    const a = angleTo(this.x, this.y, t.x, t.y);
    for (const ang of fanAngles(a, o.count ?? 1, o.spread ?? 0.25)) this.shoot(w, ang, o);
    w.sfx('enemy_shoot', { vol: 0.45, pitch: fx.range(0.9, 1.1) });
  }

  /** Fire a ring of projectiles. */
  shootRing(w: World, count: number, o: ShootOpts & { offset?: number } = {}): void {
    const off = o.offset ?? 0;
    for (let i = 0; i < count; i++) this.shoot(w, off + (i / count) * TAU, o);
    w.sfx('enemy_shoot', { vol: 0.5, pitch: 0.85 });
  }

  /** Spawn another enemy next to this one (counts as minion). */
  summon(w: World, id: string, x = this.x, y = this.y): Enemy | null {
    const def = Enemies.get(id);
    if (!def) return null;
    const e = w.spawnEnemy(id, x, y);
    if (e) {
      e.isMinion = true;
      e.dormant = 0.3;
    }
    return e;
  }

  /** Current sprite frame name. */
  frame(): string {
    return hasAnim(this.anim) ? animFrame(this.anim, this.animT) : this.anim;
  }

  setAnim(name: string, restart = false): void {
    if (this.anim !== name || restart) {
      this.anim = name;
      this.animT = 0;
    }
  }

  override draw(r: Renderer, w: World): void {
    if (this.hidden) return;
    const shadowW = this.def.shadow ?? this.r * 2;
    if (shadowW > 0) r.shadow(this.x, this.y + this.r * 0.5, shadowW * (1 - Math.min(0.5, this.z / 80)), undefined, 0.3);
    if (this.def.draw) {
      this.def.draw(this, r, w);
      return;
    }
    this.drawDefault(r);
  }

  /** Default sprite drawing with flash / tint / squash. Usable from custom draws. */
  drawDefault(r: Renderer, spriteName = this.frame(), yOffset = this.def.spriteYOffset ?? 0): void {
    const tint = this.statusTint();
    const tel = this.telegraphT > 0 && Math.floor(this.telegraphT * 16) % 2 === 0;
    r.sprite(spriteName, this.x, this.y - this.z + yOffset, {
      flipX: this.facing < 0,
      sx: this.squashX * this.scale,
      sy: this.squashY * this.scale,
      rot: this.rot,
      alpha: this.alpha * (this.dormant > 0.3 ? 0.6 + 0.4 * Math.sin(this.age * 40) : 1),
      flash: this.flash > 0 ? 1 : tel ? 0.55 : 0,
      tint: this.champion ? this.championColor : tint?.color,
      tintAmount: this.champion ? 0.35 : tint?.amount,
    });
  }

  override light(w: World): void {
    if (this.def.light && !this.hidden) w.lights.add(this.x, this.y - this.z, this.def.light.radius, this.def.light.color);
  }
}

// Shared enemy bullet sprites are defined lazily through orbSprite(); re-export for scripts.
export { orbSprite };
