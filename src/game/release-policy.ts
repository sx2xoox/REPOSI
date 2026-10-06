/** Reviewed expansion released: keepers retain normal unlock conditions;
 * all twenty weapons use their registered rarity, floor weights and loot pools. */
const QUARANTINED = new Set<string>();
export function isContentTemporarilyLocked(id: string): boolean {
 return import.meta.env.PROD && QUARANTINED.has(id);
}
