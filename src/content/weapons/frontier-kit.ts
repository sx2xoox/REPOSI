// Shared helpers for the frontier / trap arms (frontier-arms.ts, trap-arms.ts):
// hits credited to the keeper that owns the weapon (co-op safe: never
// `w.player`), falloff blasts, per-weapon lists of placed objects that are
// pruned when the room changes, and knockback-style pulls. Every helper only
// hurts enemies (never a keeper) and never breaks tiles.

import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import { Weapons, type WeaponState } from '../../game/defs';
import type { Actor, DamageKind, Entity, StatusApply } from '../../game/entity';
import type { Enemy } from '../../game/enemy';
import { clamp } from '../../engine/math';

/** The living-or-not enemy with this id in the current room, if any. */
export function enemyById(w: World, id: number | undefined): Enemy | null {
  if (id === undefined) return null;
  for (const e of w.enemies) if (e.id === id) return e;
  return null;
}

/** The registry held sprite of weapon `id` (art swaps replace it), else `fallback`. */
export function heldSpriteOf(id: string, fallback: string): string {
  return Weapons.get(id)?.heldSprite ?? fallback;
}

export interface OwnedHitOpts {
  kind?: DamageKind;
  source?: Entity | null;
  dirX?: number;
  dirY?: number;
  knockback?: number;
  statuses?: StatusApply[];
  /** quiet tick (no hit-stop / big feedback) */
  light?: boolean;
  noProc?: boolean;
  procs?: string[];
}

/** One hit from keeper `p`'s weapon `weaponId` (item onHit hooks, crits and embers as usual). */
export function ownedHit(w: World, p: Player, weaponId: string, target: Actor, damage: number, o: OwnedHitOpts = {}): boolean {
  const kind = o.kind ?? 'projectile';
  return w.applyHit(target, {
    damage, kind, attacker: p, source: o.source ?? null,
    dirX: o.dirX ?? 0, dirY: o.dirY ?? 0, knockback: o.knockback ?? 0,
    statuses: o.statuses?.map((s) => ({ ...s, procKey: s.procKey ?? `weapon:${weaponId}:${s.kind}` })),
    // the weapon's own explosions (mine, implosion) count as attacks for keeper passives and item
    // procs, like every other weapon blast (items/lib isAttack, weapons/kit blast, arms-kit keeperHit)
    light: o.light, noProc: o.noProc, procs: kind === 'explosion' && !o.noProc ? [...(o.procs ?? []), 'weapon-primary'] : o.procs,
  });
}

export interface OwnedBlastOpts extends OwnedHitOpts {
  /** damage lost at the edge (0.4 = 60% damage at the rim) */
  falloff?: number;
  skip?: Set<number>;
}

/**
 * Keeper-owned blast: every enemy within `radius` (+ its own radius) takes
 * `damage`, scaled down toward the rim by `falloff`. Returns the enemies hit.
 */
export function ownedBlast(w: World, p: Player, weaponId: string, x: number, y: number, radius: number, damage: number, o: OwnedBlastOpts = {}): number {
  let n = 0;
  const fall = o.falloff ?? 0;
  for (const e of [...w.enemies]) {
    if (!e.alive || e.hidden || o.skip?.has(e.id)) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d > radius + e.r) continue;
    const k = d || 1;
    const edge = clamp((d - e.r) / Math.max(1, radius), 0, 1);
    if (ownedHit(w, p, weaponId, e, damage * (1 - fall * edge), {
      ...o, kind: o.kind ?? 'explosion', dirX: (e.x - x) / k, dirY: (e.y - y) / k, knockback: o.knockback ?? 120,
    })) n++;
  }
  for (const h of [...w.hittables]) if (Math.hypot(h.x - x, h.y - y) < radius + h.r) h.takeHit(w, { damage, kind: 'explosion', attacker: p });
  return n;
}

/** Can a pull / reel move this enemy? (no bosses, nothing heavier than `maxMass`) */
export function pullable(e: Enemy, maxMass = 3): boolean {
  const m = e.mass ?? 1;
  return !e.isBoss && Number.isFinite(m) && m <= maxMass;
}

/**
 * Knockback-style pull toward (x, y): sets the enemy's knockback velocity
 * (walls still stop it, the enemy's own walking still acts) to `speed` px/s,
 * reduced by mass. No-op for bosses / immovable enemies.
 */
export function pullToward(e: Enemy, x: number, y: number, speed: number, maxMass = 3): void {
  if (!pullable(e, maxMass)) return;
  const dx = x - e.x;
  const dy = y - e.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.5) return;
  const v = speed / Math.max(1, Math.sqrt(e.mass ?? 1));
  e.kbx = (dx / d) * v;
  e.kby = (dy / d) * v;
}

/**
 * Per-weapon list of live objects the weapon keeps in the room (mines,
 * strokes, clouds, harpoons ...), keyed by the keeper's WeaponState. Objects
 * left behind in another room (or dead) drop out on every read, so counts
 * never leak across a room change.
 */
export class OwnedList<T extends Entity> {
  private lists = new WeakMap<WeaponState, { e: T; room: number }[]>();

  private list(st: WeaponState): { e: T; room: number }[] {
    let l = this.lists.get(st);
    if (!l) this.lists.set(st, (l = []));
    return l;
  }

  /** Live objects in the current room, oldest first (prunes the rest). */
  live(w: World, st: WeaponState): T[] {
    const l = this.list(st);
    const room = w.node.id;
    for (let i = l.length - 1; i >= 0; i--) {
      const it = l[i];
      if (it.e.dead || it.room !== room) {
        it.e.dead = true;
        l.splice(i, 1);
      }
    }
    return l.map((it) => it.e);
  }

  add(w: World, st: WeaponState, e: T): void {
    this.list(st).push({ e, room: w.node.id });
  }

  remove(st: WeaponState, e: T): void {
    const l = this.list(st);
    const i = l.findIndex((it) => it.e === e);
    if (i >= 0) l.splice(i, 1);
  }

  /** Live objects in the current room without pruning (drawing): never changes anything. */
  peek(w: World, st: WeaponState): T[] {
    const l = this.lists.get(st);
    const room = w.node.id;
    return l ? l.filter((it) => !it.e.dead && it.room === room).map((it) => it.e) : [];
  }
}
