/** Charging from direct weapon hits; beam ticks are more frequent than attacks. */
export function attackEmber(damage: number, dealt: number, boss: boolean, laser: boolean): number {
  return Math.min(6, 1.2 + dealt / Math.max(1, damage) * 1.3) * (boss ? 0.5 : 1) * (laser ? 0.5 : 1);
}
export const RELEASE_COOLDOWN = 4;
