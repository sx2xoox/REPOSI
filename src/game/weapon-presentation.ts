/** Presentation only: never changes ballistic positions, hitboxes or attack cadence. */
export type ShotMaterial = 'metal' | 'wood' | 'water' | 'fire' | 'ice' | 'electric' | 'magic';
const groups: Partial<Record<ShotMaterial, string[]>> = {
  metal: ['brass_revolver','nail_carbine','bell_blunderbuss','ember_musket','dusk_knives','return_blade','ricochet_chakram','throwing_knives','scatter_horn','harpoon_gun','javelin_bundle'],
  wood: ['hunter_bow','repeater_crossbow','volley_crossbow','pearl_crossbow','crescent_bow','thorn_shortbow','star_piercer','spin_top_yoyo'],
  water: ['bubble_wand','tide_staff','ink_brush'], fire: ['flame_staff','dragon_breath','cinder_sceptre','comet_tube','meteor_staff'],
  ice: ['frost_wand','glacier_arbalest','crystal_gatling'], electric: ['thunder_rod','stormhorn_rod'],
};
const materials = new Map(Object.entries(groups).flatMap(([m, ids]) => ids.map(id => [id, m as ShotMaterial] as const)));
export function shotMaterial(id: string): ShotMaterial { return materials.get(id) ?? 'magic'; }

/** Forward lunge then controlled recovery. Rotation stays on the thrust axis. */
export function thrustExtension(elapsed: number, duration = .22): number {
  if (elapsed < 0 || elapsed >= duration) return 0;
  const t = elapsed / duration;
  return t < .25 ? 1 - (1 - t / .25) ** 2 : (1 - (t - .25) / .75) ** 2;
}

/** Local art point transformed exactly like drawHeld (including left-facing reflection). */
export function heldLocalPoint(x: number, y: number, angle: number, localX: number, localY: number): { x: number; y: number } {
  const yy = localY * (Math.cos(angle) < 0 ? -1 : 1), c = Math.cos(angle), s = Math.sin(angle);
  return { x: x + localX * c - yy * s, y: y + localX * s + yy * c };
}
