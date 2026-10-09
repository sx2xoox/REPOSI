import type { RNG } from '../engine/rng';
import type { RoomKind } from './constants';

export const STAGES_PER_FLOOR = 3;
/** Draw once before layout retries: placement must never change the room odds. */
export function stageRoomPlan(rng: RNG): RoomKind[] {
  const kinds: RoomKind[] = [];
  if (rng.chance(.75)) kinds.push(rng.pick(['treasure', 'shop']));
  kinds.push(rng.pick(['shrine', 'curse', 'challenge']));
  if (rng.chance(.5)) kinds.push(rng.pick(['relay', 'workshop', 'vault', 'hunt']));
  if (rng.chance(.3)) kinds.push('secret');
  const forge = rng.next();
  kinds.push(forge < .4 ? 'refinery' : forge < .8 ? 'well' : 'fusion');
  if (rng.chance(.4)) kinds.push('elite');
  return kinds;
}
export function normalizeStage(stage: number): number {
  return Math.max(1, Math.min(STAGES_PER_FLOOR, Math.floor(stage) || 1));
}
