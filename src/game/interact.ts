// Item focus, intentional pickup and discarding.
// - Focus: the closest "previewable" entity (item pedestal, priced pickup, potion,
//   weapon crate) within PREVIEW_RANGE of the keeper. The HUD shows its preview
//   card (ui/item-tooltip.ts); pedestal items are only taken with an 'interact'
//   press (G / D-pad down / the touch "줍기" button), so players can read first.
// - Discard: one copy of an artifact goes back onto a pedestal next to the keeper
//   (Tab screen). Blessings and character traits cannot be discarded.

import type { Entity } from './entity';
import type { World } from './world';
import { Artifacts, type ArtifactDef } from './defs';
import { Pedestal } from './pickups';

/** Preview card / interact distance (px, keeper to item center). */
export const PREVIEW_RANGE = 28;

export interface Point {
  x: number;
  y: number;
}

/**
 * The element of `list` closest to (px, py) within `range` (strictly inside the
 * circle) that passes `accept`; the earliest one wins ties. Null when none.
 */
export function closestWithin<T extends Point>(px: number, py: number, list: Iterable<T>, range: number, accept?: (e: T) => boolean): T | null {
  let best: T | null = null;
  let bd = range * range;
  for (const e of list) {
    const dx = e.x - px;
    const dy = e.y - py;
    const d = dx * dx + dy * dy;
    if (d >= bd || (accept && !accept(e))) continue;
    best = e;
    bd = d;
  }
  return best;
}

/** The entity the keeper is focusing (preview card + interact target), or null. */
export function findFocus(w: World): Entity | null {
  const p = w.player;
  if (!p || p.dead || w.transitioning || w.descending) return null;
  return closestWithin(p.x, p.y, w.entities, PREVIEW_RANGE, (e) => !e.dead && e !== p && e.previewable(w));
}

// ------------------------------------------------------------------ discard
/** Why an artifact cannot be discarded (Korean, shown on the Tab screen), or null if it can. */
export function discardBlock(def: ArtifactDef, innate: readonly string[] = []): string | null {
  if (def.blessing) return '축복은 등불에 새겨져 버릴 수 없다';
  if (def.hidden || innate.includes(def.id)) return '타고난 힘은 버릴 수 없다';
  return null;
}

/** Discard check for the world's keeper (character starting artifacts are innate). */
export function discardBlockFor(w: World, id: string): string | null {
  const def = Artifacts.get(id);
  if (!def) return '알 수 없는 유물';
  return discardBlock(def, w.player.character.artifacts ?? []);
}

/** A free spot ~22px from the keeper (aim side first) that does not sit on another pedestal. */
export function dropSpot(w: World): Point {
  const p = w.player;
  const others: Point[] = [];
  for (const e of w.entities) if (e instanceof Pedestal && !e.dead) others.push(e);
  for (let i = 0; i < 8; i++) {
    const a = p.aim + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 4);
    const x = p.x + Math.cos(a) * 22;
    const y = p.y + Math.sin(a) * 22;
    if (!w.room.isFree(x, y, 7)) continue;
    if (others.some((o) => Math.hypot(o.x - x, o.y - y) < 18)) continue;
    return { x, y };
  }
  return { x: p.x, y: p.y };
}

/**
 * Discard one copy of artifact `id`: it leaves the inventory (stats, looks and
 * resonance recompute) and lands on a pedestal next to the keeper, where it can
 * be picked up again. Returns the pedestal, or null if it cannot be discarded.
 */
export function discardArtifact(w: World, id: string): Pedestal | null {
  if (discardBlockFor(w, id)) return null;
  if (!w.items.take(id)) return null;
  const spot = dropSpot(w);
  const ped = w.dropItemPedestal({ kind: 'artifact', id }, spot.x, spot.y);
  ped.spawnFx = 0.4;
  return ped;
}
