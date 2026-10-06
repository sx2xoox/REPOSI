import { Weapons, Artifacts, type Rarity } from './defs';
import type { World } from './world';
import type { Player } from './player';
import type { Entity } from './entity';
import { discardBlockFor } from './interact';
import { isContentTemporarilyLocked } from './release-policy';
import { freshState, holsterWeapon } from './weaponslots';

export type FacilityKind = 'refinery'|'well'|'fusion';
export interface Facility extends Entity { kind:FacilityKind; mem:Record<string,number|string|boolean> }
export type FacilityCommand = { type:'facility'; floor:number; stage:number; room:number; entity:number; fingerprint:string; materials:string[] };
export const TEMPER_RESULTS = [
 {step:-3,chance:5},{step:-2,chance:10},{step:-1,chance:20},
 {step:1,chance:35},{step:2,chance:20},{step:3,chance:10},
] as const;
export const temperMultiplier=(step:number)=>1+Math.max(-3,Math.min(3,Number.isFinite(step)?step:0))*.1;
export function facilityFingerprint(p:Player){return JSON.stringify([p.weaponId,p.weapon.mem.temper??0,p.weapon2Id,p.weapon2.mem.temper??0,p.inv.items.map(i=>i.id).sort()]);}
export function facilityCost(kind:FacilityKind,floor:number){return kind==='fusion'?0:(kind==='refinery'?10:8)+2*(floor-1);}
export const RARITIES:Rarity[]=['common','rare','epic','legendary'];
export function nextRarity(r:Rarity){return RARITIES[Math.min(3,RARITIES.indexOf(r)+1)];}
export function weaponCandidates(r:Rarity,excluded:string[]=[]){return Weapons.all().filter(d=>d.rarity===r&&d.pools.length&&!excluded.includes(d.id)&&!isContentTemporarilyLocked(d.id));}
export function artifactCandidates(r:Rarity){return Artifacts.all().filter(d=>d.rarity===r&&d.pools.length&&!d.hidden&&!d.blessing&&!isContentTemporarilyLocked(d.id));}
export function fusionMaterials(w:World){return w.player.inv.items.filter(it=>!discardBlockFor(w,it.id)&&Artifacts.get(it.id)?.rarity!=='legendary'&&!isContentTemporarilyLocked(it.id)).map(it=>it.id);}
export function facilityBlock(w:World,f:Facility,materials:string[]=[]):string|null{
 const p=w.player,cost=facilityCost(f.kind,w.floor.index),def=Weapons.get(p.weaponId);
 if(f.mem['used:'+p.slot])return '이 설비는 이미 사용했습니다';
 if(!p.alive||p.downed)return '행동할 수 없는 상태입니다';
 if(p.coins<cost)return `동전 ${cost}개가 필요합니다`;
 if(!def)return '사용할 무기가 없습니다';
 if(f.kind==='refinery')return null;
 if(f.kind==='well')return weaponCandidates(def.rarity,[p.weaponId,p.weapon2Id??'']).length?null:'바꿀 수 있는 같은 등급의 무기가 없습니다';
 if(materials.length===0){
  const second=p.weapon2Id?Weapons.get(p.weapon2Id):undefined;
  if(!second||second.rarity!==def.rarity)return '같은 등급의 무기 두 개를 장착하세요';
  if(def.rarity==='legendary')return '전설 무기는 합성할 수 없습니다';
  return weaponCandidates(nextRarity(def.rarity)).length?null:'생성 가능한 상위 무기가 없습니다';
 }
 if(materials.length!==2)return '유물 두 개를 선택하세요';
 const eligible=fusionMaterials(w),pool=[...eligible];
 for(const id of materials){const i=pool.indexOf(id);if(i<0)return '선택한 유물을 합성할 수 없습니다';pool.splice(i,1);}
 const a=Artifacts.must(materials[0]),b=Artifacts.must(materials[1]);
 if(a.rarity!==b.rarity)return '같은 등급의 유물만 합성할 수 있습니다';
 return artifactCandidates(nextRarity(a.rarity)).length?null:'생성 가능한 상위 유물이 없습니다';
}
export function applyFacility(w:World,cmd:FacilityCommand):boolean{
 if(w.run.floor!==cmd.floor||w.run.stage!==cmd.stage||w.node.id!==cmd.room||w.transitioning)return false;
 const f=w.entities.find(e=>e.id===cmd.entity&&!e.dead) as Facility|undefined;
 if(!f||!['refinery','well','fusion'].includes(f.kind)||!f.mem||Math.hypot(w.player.x-f.x,w.player.y-f.y)>38)return false;
 const p=w.player;if(cmd.fingerprint!==facilityFingerprint(p)||facilityBlock(w,f,cmd.materials))return false;
 const cost=facilityCost(f.kind,w.floor.index),def=Weapons.must(p.weaponId);
 let result='';
 if(f.kind==='refinery'){
  const step=w.run.lootRng.weighted(TEMPER_RESULTS,x=>x.chance)!.step;p.weapon.mem.temper=step;
  result=`제련 ${step>0?'+':''}${step} · 무기 피해 ${Math.round(temperMultiplier(step)*100)}%`;
 }else if(f.kind==='well'||cmd.materials.length===0){
  let rarity=f.kind==='fusion'?nextRarity(def.rarity):def.rarity;
  const blessed=f.kind==='well'&&rarity!=='legendary'&&w.run.lootRng.chance(.1)&&weaponCandidates(nextRarity(rarity),[p.weapon2Id??'']).length>0;
  if(blessed)rarity=nextRarity(rarity);
  const pool=weaponCandidates(rarity,f.kind==='well'?[p.weaponId,p.weapon2Id??'']:[]);if(!pool.length)return false;
  const output=w.run.lootRng.pick(pool);
  holsterWeapon(w,p,p.weaponId,p.weapon);
  if(f.kind==='fusion'){holsterWeapon(w,p,p.weapon2Id,p.weapon2);p.weapon2Id=null;p.weapon2=freshState();}
  p.weaponId=output.id;p.weapon=freshState();p.weapon.cooldown=.2;w.items.recompute();w.run.obtained.add(output.id);
  result=(blessed?'우물의 축복 · ':'')+output.name+' · 제련 없음';
 }else{
  const output=w.run.lootRng.pick(artifactCandidates(nextRarity(Artifacts.must(cmd.materials[0]).rarity)));
  // Remove both inputs before one recompute: never transiently grant acquisition bonuses.
  for(const id of cmd.materials)p.inv.removeOne(id);
  w.items.give(output.id);result=output.name;
 }
 p.coins-=cost;w.run.stats.coinsSpent+=cost;f.mem['used:'+p.slot]=true;f.mem['result:'+p.slot]=result;
 w.sfx('item_get_rare',{vol:.6});w.floatText(f.x,f.y-40,result,'#ffe2a3');
 if(!w.coop||p===w.local)w.banner('작업 완료',result,{small:true,color:'#ffe2a3'});
 return true;
}
