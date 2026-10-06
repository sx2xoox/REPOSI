import { describe, expect, it, vi } from 'vitest';
import { isContentTemporarilyLocked } from '../src/game/release-policy';
describe('reviewed roster production access',()=>{
 it('releases the reviewed five keepers and twenty weapons in production',()=>{
  vi.stubEnv('PROD',true);
  try{for(const id of ['tove','luen','ves','ort','mira'])expect(isContentTemporarilyLocked(id),id).toBe(false);
   for(const id of ['brass_revolver','nail_carbine','bell_blunderbuss','ember_musket','pearl_crossbow',
    'crescent_bow','thorn_shortbow','glacier_arbalest','copper_sabre','rose_rapier','anchor_axe','cathedral_mace',
    'comet_pike','obsidian_cleaver','moon_fan','dusk_knives','amber_wand','tide_staff','cinder_sceptre','stormhorn_rod'])
    expect(isContentTemporarilyLocked(id),id).toBe(false);
  }finally{vi.unstubAllEnvs();}
 });
 it('registers all twenty in production loot and crafting pools and can roll every one',async()=>{
  vi.stubEnv('PROD',true);
  try{
   const {loadContent}=await import('../src/content');loadContent();
   const {Weapons}=await import('../src/game/defs');
   const {ARSENAL}=await import('../src/content/weapons/refuge-arsenal');
   const {pickWeapon}=await import('../src/content/weapons/drops');
   const {weaponCandidates}=await import('../src/game/facilities');
   const {RNG}=await import('../src/engine/rng');
   const seen=new Set<string>(),rng=new RNG('PRODUCTION-EXPANSION');
   for(let i=0;i<Weapons.all().length;i++){const id=pickWeapon(rng,4,0,[],seen);if(id)seen.add(id);}
   for(const spec of ARSENAL){
    const d=Weapons.must(spec.id);expect(d.pools).toEqual(['treasure','shop','boss']);expect(seen.has(d.id),d.id).toBe(true);
    expect(weaponCandidates(d.rarity).some(w=>w.id===d.id),d.id).toBe(true);
   }
  }finally{vi.unstubAllEnvs();}
 });
});
