import { Enemies, Weapons, Artifacts, type Rarity } from '../../game/defs';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { Prop } from '../props/prop';
import { Pedestal } from '../../game/pickups';
import { WeaponChest } from '../weapons/drops';
import { isContentTemporarilyLocked } from '../../game/release-policy';
import type { Enemy } from '../../game/enemy';
import { pixelTextCanvas } from './floortext';

/** Korean labels need the game's font; the numeric 3x5 font has no Hangul glyphs. */
export function roomLabel(r:Renderer,text:string,x:number,y:number,color:string){
 if(typeof document==='undefined')return;
 const c=pixelTextCanvas(text,{size:10,font:'Galmuri9',color,outline:'#100c18'});
 r.ctx.drawImage(c,Math.round(x-c.width/2-r.viewX),Math.round(y-c.height-r.viewY));
}

export const encounterCount = (n: number) => 1 + .5 * Math.max(0, n - 1);
export const encounterHP = (n: number) => [1, 1, 1.35, 1.6, 1.85][Math.max(1, Math.min(4, n))];
export function participants(w: World): number {
  return (w.coop ? w.players : [w.player]).filter(p => !p.left).reduce((m,p) => m | (1 << p.slot), 0);
}
export function partySize(mask: number): number { let n=0; for(let i=0;i<4;i++)if(mask & (1<<i))n++;return Math.max(1,n); }
export function rewardRarity(kind: string, floor: number): Rarity {
  if (kind === 'relay') return floor < 4 ? 'common' : 'rare';
  if (kind === 'vault') return floor < 4 ? 'epic' : 'legendary';
  return floor < 4 ? 'rare' : 'epic';
}
export function encounterRewards(w: World, mask: number, kind: string) {
  const rarity = rewardRarity(kind, w.floor.index);
  const weapons = Weapons.all().filter(d => d.rarity === rarity && d.pools.length && !isContentTemporarilyLocked(d.id));
  const artifacts = Artifacts.all().filter(d => !d.hidden && !d.blessing && d.pools.length && d.rarity === rarity && !isContentTemporarilyLocked(d.id));
  const mixed = ['relay', 'workshop', 'vault', 'hunt', 'elite'].includes(kind);
  const n=partySize(mask);
  for(let i=0;i<n;i++) {
    const x=w.room.centerX+(i-(n-1)/2)*58,y=w.room.centerY+30;
    const pos=w.room.nearestFree(x,y,9);
    // Roll the category first, so pool sizes do not skew the 50/50 split.
    if(artifacts.length && (!weapons.length || mixed && w.run.lootRng.chance(.5))){
      const id=w.run.lootRng.pick(artifacts).id;
      const reward=w.spawn(new Pedestal(pos.x,pos.y,{kind:'artifact',id}));reward.waitForLeave=true;
      w.run.seenOnPedestal.add(id);
    }else if(weapons.length){const id=w.run.lootRng.pick(weapons).id;w.spawn(new WeaponChest(pos.x,pos.y,id));w.run.seenOnPedestal.add(id);}
    if(kind==='challenge'){
      const choices=w.run.lootRng.shuffle([...artifacts]).slice(0,2);
      for(let j=0;j<choices.length;j++){const p=w.spawn(new Pedestal(pos.x+(j?13:-13),pos.y-43,{kind:'artifact',id:choices[j].id}));p.group=100000+i;p.waitForLeave=true;}
    }
  }
}
export interface EncounterRoot extends Prop { mem: { pending:number; used:boolean; members:number; [k:string]: number|boolean|string } }
export class EncounterSummon extends Prop {
  mem: {time:number; enemy:string; root:number};
  constructor(x:number,y:number,id:string,readonly encounter:EncounterRoot,delay:number,readonly elite=false,readonly siege=false){
    super(x,y,0); this.mem={time:delay,enemy:id,root:encounter.id};encounter.mem.pending++;
    this.encounterId=encounter.id;this.enemyDamageScale=elite?1.5:1;
  }
  override update(w:World,dt:number){
    if(this.encounter.mem.used){this.dead=true;return;}
    this.mem.time-=dt;if(this.mem.time>0)return;
    this.dead=true;this.encounter.mem.pending--;
    const e=w.spawnEnemy(this.mem.enemy,this.x,this.y);if(!e)return;
    e.ctxP=null;e.dormant=.4;e.mem.encounter=this.encounter.id;e.encounterId=this.encounter.id;
    // Replace normal co-op HP scaling instead of multiplying it a second time.
    const n=partySize(this.encounter.mem.members),base=w.coop ? 1+.5*(w.players.length-1):1;
    e.maxHp=e.hp=Math.round(e.maxHp/base*encounterHP(n)*(this.elite?3:1));
    if(this.elite){e.scale=1.25;e.r*=1.25;e.speed*=1.1;e.enemyDamageScale=1.5;e.mem.elite=1;e.championColor='#efab68';}
    if(this.siege){e.mem.siege=this.encounter.id;e.script.stop();}
    w.sfx('enemy_spawn',{vol:.35});
  }
  override draw(r:Renderer){r.ring(this.x,this.y,12,this.elite?'#f0a25e':'#dc827f',1,.85);r.ring(this.x,this.y,Math.max(2,12-this.mem.time*10),'#ffe6b6',1,.6);}
}
/** Where the i-th of n summons appears (null = anywhere away from the centre). */
export type WavePlacer=(i:number,n:number)=>{x:number;y:number}|null;
export function encounterWave(w:World,root:EncounterRoot,count:number,elite=false,siege=false,place?:WavePlacer){
  const pool=Object.entries(w.enemyPool()).map(([id,weight])=>({def:Enemies.get(id),weight})).filter(x=>x.def&&!x.def.boss);
  const n=Math.ceil(count*encounterCount(partySize(root.mem.members)));
  for(let i=0;i<n;i++){
    const pick=w.rng.weighted(pool,x=>x.weight/Math.max(1,(x.def?.cost??1)*(elite?.55:1)));if(!pick?.def)continue;
    const want=place?.(i,n);
    const pos=want?w.room.nearestFree(want.x,want.y,10):w.room.randomFreePos(w.rng,10,{x:w.room.centerX,y:w.room.centerY,dist:65});
    const summon=new EncounterSummon(pos.x,pos.y,pick.def.id,root,.85+i*.1,elite,siege);summon.ctxP=null;w.spawn(summon);
  }
}
/** Vault attackers advance, visibly wind up, and hit the vault instead of following players. */
export function updateSiege(e:Enemy,w:World,dt:number):boolean {
  if(!e.mem.siege)return false;
  const target=w.entities.find(q=>q.id===e.mem.siege) as (EncounterRoot & { damageVault?(w:World,amount:number):void })|undefined;
  if(!target||target.mem.used){e.stop();return true;}
  const dx=target.x-e.x,dy=target.y-e.y,d=Math.hypot(dx,dy);
  if(d>25){e.wantVX=dx/d*e.speed;e.wantVY=dy/d*e.speed;e.mem.siegeWind=0;}
  else{
    e.stop();e.mem.siegeCooldown=Math.max(0,(e.mem.siegeCooldown??0)-dt);
    if(e.mem.siegeWind>0){e.mem.siegeWind-=dt;if(e.mem.siegeWind<=0){target.damageVault?.(w,1);e.mem.siegeCooldown=1.6;w.sfx('hit_metal',{vol:.25});}}
    else if(!e.mem.siegeCooldown){e.mem.siegeWind=.65;e.telegraph(.65);}
  }
  return true;
}
export function endEncounter(w:World,root:EncounterRoot,success:boolean){
  if(root.mem.used)return;root.mem.used=true;root.mem.phase=success?4:5;w.holdClear=0;
  for(const e of w.enemies)e.dead=true;
  w.discardEncounter(root.id);
  for(const e of w.entities)if(e instanceof EncounterSummon&&e.encounter===root)e.dead=true;
  for(const p of w.projectiles)if(p.team==='enemy')p.dead=true;
  w.room.setDoorsClosed(false);
  if(success)w.roomCleared();else{w.node.cleared=true;w.mapVersion++;}
  w.sfx(success?'secret_found':'warn');
}
