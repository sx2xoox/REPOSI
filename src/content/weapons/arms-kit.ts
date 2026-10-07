// Shared helpers for the workshop weapons (guild-arms, guild-sparks, star-arms,
// star-lamps): things a keeper's weapon leaves in the world, keeper-owned hits
// and blasts (co-op attribution), the braced stride, the aimed ground point.

import { Weapons } from '../../game/defs';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import type { Entity, Actor, HitInfo } from '../../game/entity';
import { clamp } from '../../engine/math';
import { TILE } from '../../game/constants';
import { tileProps } from '../../game/tiles';
import { aimDistance } from './kit';

/** Something a keeper's weapon left in the world (stakes, saws, stars, charges ...). */
export interface OwnedEntity extends Entity {
  owner: Player;
}

/** Rigs without a world entity list (headless weapon tests) keep a keeper's placed things here instead. */
const loose = new WeakMap<Player, OwnedEntity[]>();

function entityList(w: World): Entity[] | undefined {
  return (w as { entities?: Entity[] }).entities;
}

/** Register a freshly spawned placed thing (only needed where the world has no entity list). */
export function trackOwned<T extends OwnedEntity>(w: World, e: T): T {
  if (!entityList(w)) loose.set(e.owner, [...(loose.get(e.owner) ?? []).filter((q) => !q.dead), e]);
  return e;
}

/** Live entities of `cls` that belong to `p`, oldest first (spawn order). */
export function ownedBy<T extends OwnedEntity>(w: World, cls: abstract new (...args: never[]) => T, p: Player): T[] {
  const out: T[] = [];
  const list = entityList(w) ?? loose.get(p) ?? [];
  for (const e of list) if (e instanceof cls && !e.dead && e.owner === p) out.push(e);
  return out;
}

/** The aimed ground point: the cursor (clamped to [min, max] px) or `fallback` px ahead. */
export function aimPoint(w: World, p: Player, aim: number, min: number, max: number, fallback: number): { x: number; y: number; d: number } {
  const d = aimDistance(w, p, min, max, fallback);
  return { x: p.x + Math.cos(aim) * d, y: p.y - 6 + Math.sin(aim) * d, d };
}

/** Does the tile under world point (x, y) stop shots? */
export function shotBlocked(w: World, x: number, y: number): boolean {
  return tileProps(w.room.tileAt(Math.floor(x / TILE), Math.floor(y / TILE))).blocksShots;
}

export interface KeeperHitOpts {
  /** the thing that physically hit (a placed hazard); omitted for bursts born from a shot */
  src?: Entity | null;
  kind?: HitInfo['kind'];
  /** knockback origin (defaults to straight up the screen) */
  fromX?: number;
  fromY?: number;
  knockback?: number;
  light?: boolean;
}

/** A hit dealt on behalf of keeper `p` (co-op attribution, crits, item hooks, embers). */
export function keeperHit(w: World, p: Player, e: Actor, damage: number, o: KeeperHitOpts = {}): boolean {
  const dx = e.x - (o.fromX ?? e.x);
  const dy = e.y - (o.fromY ?? e.y + 1);
  const d = Math.hypot(dx, dy) || 1;
  const kind = o.kind ?? 'laser';
  return w.applyHit(e, {
    damage, kind, source: o.src ?? null, attacker: p, dirX: dx / d, dirY: dy / d, knockback: o.knockback ?? 0, light: o.light,
    // weapon explosions count as attacks for item procs (see items/lib isAttack)
    procs: kind === 'explosion' ? ['weapon-primary'] : undefined,
  });
}

export interface KeeperBlastOpts {
  /** 0..1: damage lost toward the rim (0 = flat) */
  falloff?: number;
  knockback?: number;
  /** enemies that must not be hit */
  skip?: Set<number>;
  /** collects the ids of the enemies that were hit */
  hit?: Set<number>;
  src?: Entity | null;
}

/** Keeper-owned explosion: every enemy (and pot / hittable) in `radius` once. Never hurts keepers, never breaks tiles. */
export function keeperBlast(w: World, p: Player, x: number, y: number, radius: number, damage: number, o: KeeperBlastOpts = {}): number {
  let n = 0;
  for (const e of [...w.enemies]) {
    if (!e.alive || e.hidden || o.skip?.has(e.id)) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d > radius + e.r) continue;
    const k = o.falloff ? 1 - o.falloff * clamp(d / Math.max(1, radius), 0, 1) : 1;
    if (keeperHit(w, p, e, damage * k, { kind: 'explosion', src: o.src, fromX: x, fromY: y, knockback: o.knockback ?? 160 })) {
      n++;
      o.hit?.add(e.id);
    }
  }
  for (const h of [...w.hittables]) if (Math.hypot(h.x - x, h.y - y) < radius + h.r) h.takeHit(w, { damage, kind: 'explosion', attacker: p });
  return n;
}

/**
 * Brace: the keeper strides at `mult` of its speed while the weapon is up.
 * Runs after the move of this step; Player.update accelerates toward the move
 * target by 1100 px/s², so capping here lands the next step at exactly `mult`.
 */
export function braceStride(p: Player, mult: number, dt: number): void {
  const cap = Math.max(0, p.stats.moveSpeed * mult - 1100 * dt);
  const v = Math.hypot(p.vx, p.vy);
  if (v > cap && v > 0) {
    p.vx *= cap / v;
    p.vy *= cap / v;
  }
}

/** The weapon's held sprite from the registry (art swaps keep working). */
export function heldSprite(id: string): string {
  return Weapons.get(id)?.heldSprite ?? `w_${id}`;
}

/** Crisp arc of single pixels (a top-down circle squashed to 0.8 in y). */
export function pixelArc(r: Renderer, x: number, y: number, rad: number, a0: number, a1: number, color: string, alpha: number): void {
  const n = Math.max(3, Math.ceil(Math.abs(a1 - a0) * rad));
  let lx = NaN;
  let ly = NaN;
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const px = Math.round(x + Math.cos(a) * rad);
    const py = Math.round(y + Math.sin(a) * rad * 0.8);
    if (px === lx && py === ly) continue;
    lx = px;
    ly = py;
    r.rect(px, py, 1, 1, color, alpha);
  }
}

/** Back out of the wall along the flight line to the last free point. */
export function wallFace(w: World, x: number, y: number, angle: number): { x: number; y: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (let k = 0; k <= 14; k++) {
    if (!shotBlocked(w, x - c * k, y - s * k)) return { x: x - c * k, y: y - s * k };
  }
  return { x: x - c * 14, y: y - s * 14 };
}
