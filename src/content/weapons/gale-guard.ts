import type { Projectile } from '../../game/projectile';
import type { World } from '../../game/world';

export const GALE_GUARD_LIMIT = 3;
export const GALE_GUARD_SECONDS = 0.18;
interface Guard { remaining: number; until: number }
const guards = new WeakMap<Projectile, Guard>();

/** One shared allowance per attack; secondary projectiles cannot renew it. */
export function armGaleGuard(shots: readonly Projectile[], time: number): void {
  const guard = { remaining: GALE_GUARD_LIMIT, until: time + GALE_GUARD_SECONDS };
  for (const shot of shots) guards.set(shot, guard);
}

export function clearGaleBullets(gust: Projectile, w: World): number {
  const guard = guards.get(gust);
  if (!guard || gust.generation > 0 || guard.remaining <= 0 || w.time >= guard.until) return 0;
  const radius = Math.min(14, gust.r + 6);
  let count = 0;
  for (const bullet of w.projectiles) {
    if (guard.remaining <= 0) break;
    if (bullet.dead || bullet.team !== 'enemy' || bullet.delay > 0) continue;
    if ((bullet.x - gust.x) ** 2 + (bullet.y - gust.y) ** 2 > radius ** 2) continue;
    guard.remaining--;
    bullet.expire(w, true);
    count++;
  }
  return count;
}
