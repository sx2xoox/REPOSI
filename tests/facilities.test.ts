import './headless';
import { WEAPON_DAMAGE_SCALE } from '../src/game/stats';
import { it,expect } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Weapons,Artifacts } from '../src/game/defs';
import { ForgeFacility } from '../src/content/rooms/facilities';
import { applyFacility, facilityFingerprint, TEMPER_RESULTS, type FacilityCommand, type FacilityKind } from '../src/game/facilities';
import { captureCheckpoint,restoreCheckpoint } from '../src/game/checkpoint';
import { Pedestal, Pickup, Chest } from '../src/game/pickups';
import { stateHash } from '../src/game/statehash';
import { isCoopCommand,applyCoopCommand } from '../src/game/coop';
import { WeaponChest } from '../src/content/weapons/drops';
import { encounterRewards } from '../src/content/rooms/encounter-kit';
import { swapWeapons } from '../src/game/weaponslots';
import { runCoop } from './coopsim';
loadContent();
function setup(kind:FacilityKind,party=1){
 const run=new RunState('FACILITY-TEST','ria');run.staged=true;
 const w=new World(new Renderer(fakeDisplay(1280,720)),run,{openInventory(){},onGameOver(){}});
 if(party>1)w.startParty(Array.from({length:party},(_,slot)=>({slot,characterId:'ria',name:'P'+slot})),0);else w.start();
 const n=w.map.nodes.find(n=>n.id!==w.map.startId)!;n.kind=kind;n.templateId=kind+'_sanctuary';n.visited=false;n.cleared=false;w.enterRoom(n,null);
 const f=w.entities.find(e=>e instanceof ForgeFacility) as ForgeFacility;w.player.x=f.x;w.player.y=f.y+12;w.player.coins=100;
 return {w,f};
}
function command(w:World,f:ForgeFacility,materials:string[]=[]):FacilityCommand{return {type:'facility',floor:w.run.floor,stage:w.run.stage,room:w.node.id,entity:f.id,fingerprint:facilityFingerprint(w.player),materials};}
it('refinery charges once, replaces temper with a nonzero tier and rejects stale/replayed commands',()=>{
 const {w,f}=setup('refinery'),cmd=command(w,f);const hash=stateHash(w);
 expect(isCoopCommand(cmd)).toBe(true);expect(applyFacility(w,cmd)).toBe(true);expect(stateHash(w)).not.toBe(hash);
 expect(w.player.coins).toBe(90);expect(TEMPER_RESULTS.some(r=>r.step===w.player.weapon.mem.temper)).toBe(true);
 expect(applyFacility(w,cmd)).toBe(false);expect(applyFacility(w,command(w,f))).toBe(false);expect(w.player.coins).toBe(90);
});
it('cannot spend at a distance, in another stage, with changed materials or insufficient gold',()=>{
 const {w,f}=setup('refinery'),cmd=command(w,f),rng=w.run.lootRng.snapshot();
 w.player.x+=100;expect(applyFacility(w,cmd)).toBe(false);w.player.x=f.x;
 expect(applyFacility(w,{...cmd,stage:2})).toBe(false);expect(applyFacility(w,{...cmd,fingerprint:'stale'})).toBe(false);
 w.player.coins=9;expect(applyFacility(w,cmd)).toBe(false);expect(w.run.lootRng.snapshot()).toEqual(rng);expect(w.player.coins).toBe(9);
});
it('weapon damage scales without altering artifact/character stats and survives a slot swap and checkpoint',()=>{
 const {w}=setup('refinery'),p=w.player;p.weapon.mem.temper=3;const base=p.stats.damage;
 expect(p.weaponStats.damage).toBeCloseTo(base*1.3*WEAPON_DAMAGE_SCALE);expect(p.stats.damage).toBe(base);
 expect(p.fireProjectiles(w,0,{count:1})[0].damage).toBeCloseTo(base*1.3*WEAPON_DAMAGE_SCALE);
 expect(p.fireProjectiles(w,0,{count:1,fromWeapon:false})[0].damage).toBeCloseTo(base);
 p.equipWeapon(w,'iron_spear');expect(p.weapon.mem.temper??0).toBe(0);expect(p.weapon2.mem.temper).toBe(3);swapWeapons(w,p,true);
 const cp=captureCheckpoint(w),other=setup('refinery').w;restoreCheckpoint(other,cp);expect(other.player.weapon.mem.temper).toBe(3);expect(other.player.weapon2.mem.temper??0).toBe(0);
});
it('swapped-out weapons retain their individual temper on the pedestal',()=>{
 const {w}=setup('refinery'),p=w.player;p.equipWeapon(w,'iron_spear');p.weapon.mem.temper=-2;
 const def=Weapons.all().find(d=>d.id!==p.weaponId&&d.id!==p.weapon2Id&&d.pools.length)!;
 const ped=new Pedestal(p.x,p.y,{kind:'weapon',id:def.id,temper:2});w.takePedestal(ped);
 expect(p.weapon.mem.temper).toBe(2);expect(ped.item).toEqual({kind:'weapon',id:'iron_spear',temper:-2});
});
it('same-rarity weapon fusion consumes exactly both slots and creates a fresh higher-rarity weapon',()=>{
 const {w,f}=setup('fusion'),p=w.player,ids=Weapons.all().filter(d=>d.rarity==='common'&&d.pools.length).slice(0,2).map(d=>d.id);
 p.weaponId=ids[0];p.weapon2Id=ids[1];p.weapon.mem.temper=3;
 expect(applyFacility(w,command(w,f))).toBe(true);expect(Weapons.must(p.weaponId).rarity).toBe('rare');expect(p.weapon2Id).toBeNull();expect(p.weapon.mem.temper??0).toBe(0);expect(p.coins).toBe(100);
});
it('artifact fusion respects duplicate copies, same rarity and innate exclusions',()=>{
 const {w,f}=setup('fusion'),p=w.player;const a=Artifacts.all().find(d=>d.rarity==='common'&&d.pools.length&&!d.hidden&&!d.blessing&&!(p.character.artifacts??[]).includes(d.id))!;
 w.items.give(a.id);const invalid=command(w,f,[a.id,a.id]);expect(applyFacility(w,invalid)).toBe(false);expect(p.inv.countOf(a.id)).toBe(1);
 w.items.give(a.id);const before=p.inv.size;expect(applyFacility(w,command(w,f,[a.id,a.id]))).toBe(true);expect(p.inv.size).toBe(before-1);expect(p.inv.countOf(a.id)).toBe(0);expect(Artifacts.must(p.inv.items.at(-1)!.id).rarity).toBe('rare');
});
it('well produces another legal weapon, resets temper, and treats legendary as same tier',()=>{
 for(const rarity of ['common','legendary'] as const){const {w,f}=setup('well'),p=w.player;const d=Weapons.all().find(d=>d.rarity===rarity&&d.pools.length)!;p.weaponId=d.id;p.weapon2Id=null;p.weapon.mem.temper=3;
  expect(applyFacility(w,command(w,f))).toBe(true);expect(p.weaponId).not.toBe(d.id);expect(p.weapon.mem.temper??0).toBe(0);expect(p.coins).toBe(92);if(rarity==='legendary')expect(Weapons.must(p.weaponId).rarity).toBe('legendary');}
});
it('facility allowances remain per keeper while encounter rewards have no personal claims',()=>{
 const {w,f}=setup('refinery',4);
 for(const p of w.players){p.x=f.x;p.y=f.y;const cmd=w.asPlayer(p,()=>command(w,f));expect(applyCoopCommand(w,p.slot,cmd)).toBe(true);expect(applyCoopCommand(w,p.slot,cmd)).toBe(false);}
 expect(w.player.coins).toBe(60);encounterRewards(w,15,'vault');w.update(1/60);const rewards=w.entities.filter(e=>e instanceof WeaponChest || e instanceof Pedestal && e.item?.kind==='artifact');expect(rewards).toHaveLength(4);
 const ped=new Pedestal(f.x,f.y,{kind:'artifact',id:'fallen_star'});ped.mem.ownerSlot=1;const n=w.players[0].inv.size,other=w.players[1].inv.size;w.asPlayer(w.players[0],()=>w.takePedestal(ped));expect(w.players[0].inv.size).toBe(n+1);expect(ped.item).toBeNull();w.asPlayer(w.players[1],()=>w.takePedestal(ped));expect(w.players[1].inv.size).toBe(other);
});
it('malformed facility network messages are rejected',()=>{
 for(const payload of [{type:'facility'},{type:'facility',floor:1,stage:1,room:1,entity:1,fingerprint:'x',materials:[1]},{type:'facility',floor:Infinity,stage:1,room:1,entity:1,fingerprint:'x',materials:[]}])expect(isCoopCommand(payload)).toBe(false);
});

it('same-model pickups exchange individual copies in either equipped slot',()=>{
 for(const secondary of [false,true]){
  const {w}=setup('refinery'),p=w.player;p.equipWeapon(w,'iron_spear');
  p.weapon.mem.temper=2;p.weapon2.mem.temper=-3;
  const id=secondary?p.weapon2Id!:p.weaponId,ped=new Pedestal(p.x,p.y,{kind:'weapon',id,temper:1});
  w.takePedestal(ped);expect(p.weaponId).toBe(id);expect(p.weapon.mem.temper).toBe(1);
  expect(ped.item).toEqual({kind:'weapon',id,temper:secondary?-3:2});
  expect(p.weapon2.mem.temper).toBe(secondary?2:-3);
 }
});

it('legacy owner metadata does not restrict chest drops',()=>{
 const {w}=setup('refinery',2),c=new Chest(100,100);c.mem.ownerSlot=1;
 w.openChest(c);w.update(1/60);
 const drops=w.entities.filter(e=>e instanceof Pickup);
 expect(drops.length).toBeGreaterThan(0);expect(drops.every(e=>e.mem.ownerSlot===undefined)).toBe(true);
 for(const e of drops)expect(w.asPlayer(w.players[0],()=>e.canCollect(w))).toBe(true);
});

it('simultaneous facility commands resolve once per player over a delayed lossy link',()=>{
 const sent=new Set<World>();
 const result=runCoop({name:'facility-net',seed:'FORGE-NET',chars:['ria','bern'],ms:13000,link:{latencyMs:50,jitterMs:20,drop:.08},bossAt:0,downAt:0,leaveAt:0,discardAt:0,
  extraStep(w,tick){
   if(tick===5){const n=w.map.nodes.find(n=>n.id!==w.map.startId)!;n.kind='refinery';n.templateId='refinery_sanctuary';n.visited=false;n.cleared=false;w.enterRoom(n,null);w.player.coins=100;}
   if(w.node.kind==='refinery')for(const p of w.players){p.x=w.room.centerX;p.y=w.room.centerY+12;}
  },commands(w){
   if(w.node.kind!=='refinery'||sent.has(w))return [];
   const f=w.entities.find(e=>e instanceof ForgeFacility) as ForgeFacility;if(!f)return [];
   sent.add(w);const cmd=w.asPlayer(w.local,()=>command(w,f));return [cmd,cmd];
  }});
 for(const peer of result.peers){
  expect(peer.desyncs).toEqual([]);const f=peer.world.entities.find(e=>e instanceof ForgeFacility)!;
  expect(f.mem['used:0']).toBe(true);expect(f.mem['used:1']).toBe(true);expect(peer.world.player.coins).toBe(80);
 }
 const [a,b]=result.peers;for(let i=0;i<Math.min(a.hashes.length,b.hashes.length);i++)if(a.hashes[i]!==undefined&&b.hashes[i]!==undefined)expect(a.hashes[i]).toBe(b.hashes[i]);
},30000);
