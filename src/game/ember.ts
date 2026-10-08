/**
 * Charging from direct weapon hits; beam ticks are more frequent than attacks. The flat
 * part follows the hit's size next to one plain shot (`hitDamage / damage`, 0.25..1), so
 * splitting an attack into many small hits (pellets, nails, extra shots) charges about as
 * much as landing it whole.
 */
export function attackEmber(damage: number, dealt: number, boss: boolean, laser: boolean, hitDamage = damage): number {
  const share = Math.min(1, Math.max(0.25, hitDamage / Math.max(1, damage)));
  return Math.min(6, 1.2 * share + dealt / Math.max(1, damage) * 1.3) * (boss ? 0.5 : 1) * (laser ? 0.5 : 1);
}
export const RELEASE_COOLDOWN = 4;
