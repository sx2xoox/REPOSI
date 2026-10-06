import type { Room } from './room';
import { TILE } from './constants';
import { Tile } from './tiles';

/** One quarter of a tile: helps a grazing hit, never routes around a wall face. */
const CORNER_REACH = 4;
const PROBE_STEP = 0.5;
export interface MoveIntent { x: number; y: number }
interface Mover { x: number; y: number; r: number; flying: boolean; phasing: boolean }

/** Spend only lost movement on a small sideways correction toward clear floor.
 * The collider stays unchanged. Both legs of the candidate route must be clear;
 * test the whole route, not just a free endpoint beyond an obstacle.
 */
export function slideAroundCorner(room: Room, mover: Mover, axis: 'x' | 'y', advance: number, budget: number, crossIntent: number): void {
  if (budget <= 0.0001 || advance === 0) return;
  const alongX = axis === 'x';
  const safe = (x: number, y: number) => {
    if (room.boxBlocked(x, y, mover.r, mover.flying, mover.phasing)) return false;
    // Manual movement may enter spikes; an automatic correction must not.
    for (let ty = Math.floor((y - mover.r) / TILE); ty <= Math.floor((y + mover.r - .001) / TILE); ty++) {
      for (let tx = Math.floor((x - mover.r) / TILE); tx <= Math.floor((x + mover.r - .001) / TILE); tx++) {
        if (room.tileAt(tx, ty) === Tile.SPIKES) return false;
      }
    }
    return true;
  };
  const routeClear = (offset: number) => {
    if (crossIntent !== 0 && Math.sign(offset) !== Math.sign(crossIntent)) return false;
    const x = mover.x + (alongX ? 0 : offset), y = mover.y + (alongX ? offset : 0);
    // Most wall contacts fail here, before doing the short sweep.
    if (!safe(x + (alongX ? advance : 0), y + (alongX ? 0 : advance))) return false;
    const sideSteps = Math.ceil(Math.abs(offset) / PROBE_STEP);
    for (let i = 1; i <= sideSteps; i++) {
      const side = offset * i / sideSteps;
      if (!safe(mover.x + (alongX ? 0 : side), mover.y + (alongX ? side : 0))) return false;
    }
    const forwardSteps = Math.ceil(Math.abs(advance) / PROBE_STEP);
    for (let i = 1; i < forwardSteps; i++) {
      const forward = advance * i / forwardSteps;
      if (!safe(x + (alongX ? forward : 0), y + (alongX ? 0 : forward))) return false;
    }
    return true;
  };
  for (let offset = PROBE_STEP; offset <= CORNER_REACH; offset += PROBE_STEP) {
    const negative = routeClear(-offset), positive = routeClear(offset);
    if (!negative && !positive) continue;
    // No arbitrary left/right preference when the player's intention is ambiguous.
    if (negative && positive) return;
    const correction = Math.min(offset, budget) * (positive ? 1 : -1);
    if (alongX) mover.y += correction;
    else mover.x += correction;
    return;
  }
}
