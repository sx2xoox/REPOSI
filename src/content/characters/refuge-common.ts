import { Entity, type HitInfo } from '../../game/entity';
import { Enemy } from '../../game/enemy';
import type { Player } from '../../game/player';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { Weapons } from '../../game/defs';
import { save } from '../../engine/save';
import { isPrimary } from '../items/lib';
import { rayLength, segDist } from '../weapons/common';
import { aimDistance } from '../weapons/kit';

export const REFUGE_COLORS = ['#dba26a', '#bba3e5', '#ed9fa4', '#91c6a3', '#b3c9ee'];

/** Presentation only: share the same teammate-opacity rule between art and light. */
export function refugeVisualOpacity(w: World, owner: Player): number {
  if (!w.coop || owner === w.local) return 1;
  const opacity = save.settings.teammateProjectileOpacity ?? .5;
  return Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : .5;
}

/** Every persistent decision lives in numeric memory, including room ownership. */
export abstract class RefugeOwned extends Entity {
  owner: Player;
  mem: Record<string, number>;
  constructor(w: World, owner: Player) {
    super();
    this.owner = owner;
    this.ctxP = owner;
    this.x = owner.x;
    this.y = owner.y;
    this.tileCollide = false;
    this.layer = 2;
    this.mem = { floor: w.run.floor, stage: w.run.stage, room: w.node.id };
  }
  valid(w: World): boolean {
    if (this.dead || !this.owner.alive || this.owner.downed || this.owner.left || w.transitioning ||
      this.mem.floor !== w.run.floor || this.mem.stage !== w.run.stage || this.mem.room !== w.node.id) {
      this.dead = true;
      return false;
    }
    return true;
  }
  override draw(r: Renderer, w: World): void {
    const before = r.worldOpacity;
    const alpha = before * refugeVisualOpacity(w, this.owner);
    if (alpha <= 0) return;
    r.worldOpacity = alpha;
    try { this.paint(r, w); } finally { r.worldOpacity = before; }
  }
  protected abstract paint(r: Renderer, w: World): void;
}

export function directContribution(w: World, hit: HitInfo): number {
  if (!isPrimary(hit) || hit.release || hit.attacker && hit.attacker !== w.player) return 0;
  return Math.max(0, hit.dealtDamage ?? hit.damage);
}

export function visible(w: World, ax: number, ay: number, bx: number, by: number, radius = 0): boolean {
  const distance = Math.hypot(bx - ax, by - ay);
  return distance < 2 || rayLength(w, ax, ay, Math.atan2(by - ay, bx - ax), distance) >= distance - Math.min(radius, 3) - 2;
}

export function nearby(w: World, x: number, y: number, radius: number): Enemy[] {
  return w.enemies.filter(e => e.alive && !e.hidden && e.vulnerable &&
    Math.hypot(e.x - x, e.y - y) <= radius + e.r && visible(w, x, y, e.x, e.y, e.r))
    .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y) || a.id - b.id);
}

export function aimPoint(w: World, p: Player, max = 150, fallback = 80): { x: number; y: number; length: number } {
  const wanted = aimDistance(w, p, 20, max, fallback);
  const length = Math.max(0, rayLength(w, p.x, p.y, p.aim, wanted) - 3);
  return { x: p.x + Math.cos(p.aim) * length, y: p.y + Math.sin(p.aim) * length, length };
}

/** Terminal kit damage: no extra critical roll, item hooks, statuses or ember. */
export function refugeHit(w: World, owner: Player, target: Enemy, damage: number, source: Entity, release = false, knockback = 0): boolean {
  if (!target.alive || target.hidden || !target.vulnerable || damage <= 0) return false;
  const d = Math.hypot(target.x - source.x, target.y - source.y) || 1;
  return w.applyHit(target, { damage, kind: 'status', attacker: owner, source, noProc: true, release,
    dirX: (target.x - source.x) / d, dirY: (target.y - source.y) / d, knockback: target.isBoss ? 0 : knockback,
    light: true });
}

export function onLane(w: World, target: Enemy, ax: number, ay: number, bx: number, by: number, width: number): boolean {
  const hit = segDist(target.x, target.y, ax, ay, bx, by);
  if (hit.d > width + target.r || !visible(w, ax, ay, target.x, target.y, target.r)) return false;
  return visible(w, ax + (bx - ax) * hit.t, ay + (by - ay) * hit.t, target.x, target.y, target.r);
}

export type SupportFamily = 0 | 1 | 2 | 3;
export const SUPPORT_NAMES = ['교차 베기', '관통 사격', '착탄 폭발', '집중 광선'] as const;
/** Intentional support skills, never a hidden second invocation of WeaponDef.update. */
export function supportFamily(id: string | null): SupportFamily {
  if (!id) return 0;
  const weapon = Weapons.get(id);
  if (!weapon) return 0;
  if (weapon.kind === 'melee' || weapon.kind === 'charge' && weapon.tags?.some(t => t === 'blade' || t === 'heavy')) return 0;
  if (weapon.kind === 'beam' || ['dragon_breath', 'flame_staff', 'thunder_rod', 'prism_staff', 'crystal_gatling', 'tesla_stake', 'constellation_staff'].includes(id)) return 3;
  if (['meteor_staff', 'firefly_tome', 'thunder_mortar', 'comet_tube', 'star_launcher', 'bubble_wand', 'gravity_orb'].includes(id) || weapon.tags?.includes('explosive')) return 2;
  return 1;
}
