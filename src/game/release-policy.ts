/** Weapon production quarantine. The five reviewed keepers use their normal unlock conditions. */
const QUARANTINED = new Set([
 'brass_revolver','nail_carbine','bell_blunderbuss','ember_musket','pearl_crossbow',
 'crescent_bow','thorn_shortbow','glacier_arbalest','copper_sabre','rose_rapier',
 'anchor_axe','cathedral_mace','comet_pike','obsidian_cleaver','moon_fan',
 'dusk_knives','amber_wand','tide_staff','cinder_sceptre','stormhorn_rod',
]);
export function isContentTemporarilyLocked(id: string): boolean {
 return import.meta.env.PROD && QUARANTINED.has(id);
}
