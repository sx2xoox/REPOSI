import { registerRoomHandler } from '../../game/roomkinds';
import { defineRoom } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { Prop } from '../props/prop';
import { ritualCircle, withDecals } from './decor';
import { participants, encounterWave, encounterRewards, endEncounter, roomLabel } from './encounter-kit';
defineDrawnSprite('trial_altar', 22, 22, (p) => {
  // stepped stone base
  p.rect(0, 15, 22, 7, '#3a3846');
  p.rect(0, 15, 22, 1, '#7a7890');
  p.rect(2, 10, 18, 6, '#4a4858');
  p.rect(2, 10, 18, 1, '#8a88a0');
  p.rect(0, 21, 22, 1, '#24222e');
  // crossed blades behind the gem
  p.line(4, 1, 17, 12, '#c8c8dc');
  p.line(17, 1, 4, 12, '#c8c8dc');
  p.line(5, 1, 17, 11, '#8a8aa0');
  p.line(16, 1, 4, 11, '#8a8aa0');
  p.rect(3, 11, 3, 2, '#8a5a2a');
  p.rect(16, 11, 3, 2, '#8a5a2a');
  // socket
  p.rect(8, 4, 6, 7, '#2a2834');
  p.rect(9, 5, 4, 5, '#120e18');
  // carvings
  for (let x = 2; x < 20; x += 3) p.px(x, 18, '#24222e');
}, { outline: '#0c0810', origin: [11, 21] });

defineDrawnSprite('trial_gem', 4, 5, (p) => {
  p.rect(0, 1, 4, 3, '#ff3a3a');
  p.rect(1, 0, 2, 5, '#ff3a3a');
  p.px(1, 1, '#ffd0c0');
  p.px(2, 3, '#a01010');
}, { origin: [2, 2] });

export class TrialAltar extends Prop {
 mem={phase:0,used:false,pending:0,members:1,wave:0,gap:.8,clock:0};
 constructor(x:number,y:number,readonly elite=false){super(x,y,1);}
 get state(){return this.mem.used?'done':this.mem.phase?'active':'idle';}
 get wave(){return this.mem.wave;}
 override previewable(){return !this.elite&&!this.mem.used&&!this.mem.phase;}
 override interactionInfo(){return {name:this.elite?'엘리트 소탕전':'시련의 방',icon:this.elite?'map_elite':'map_challenge',desc:this.elite?'거대 정예 적의 3차례 습격을 모두 물리치세요. 체력 3배, 피해 1.5배, 빠른 공격 회복. 입장 즉시 전투가 시작되고 문이 닫힙니다.':'5차례의 몬스터 습격을 모두 물리치세요. 시작 후 문이 닫히며, 한 번만 도전할 수 있습니다.'};}
 override interact(w:World){
  if(!this.previewable()||!w.player.alive||w.player.downed||Math.hypot(w.player.x-this.x,w.player.y-this.y)>30)return false;
  if(!this.begin(w))return false;
  w.sfx('door_close');return true;
 }
 /** Elite entry and voluntary challenge activation share one idempotent start. */
 begin(w:World):boolean{
  if(this.mem.used||this.mem.phase)return false;
  this.mem.phase=1;this.mem.members=participants(w);w.holdClear=Math.max(1,w.holdClear);w.room.setDoorsClosed(true);
  // Begin the first summon warnings on entry, without waiting for an altar action.
  if(this.elite)this.nextWave(w);
  return true;
 }
 private nextWave(w:World){
  const s=this.mem;s.wave++;
  encounterWave(w,this,(this.elite?1+s.wave:3+s.wave)+Math.floor((w.floor.index-1)/3),this.elite);
  if(!this.elite)w.banner('시련 '+s.wave+' / 5','소환 경고를 확인하세요',{small:true,color:'#efb085'});
 }
 override update(w:World,dt:number){
  this.age+=dt;const s=this.mem;if(s.used)return;w.holdClear=Math.max(1,w.holdClear);if(!s.phase)return;
  s.clock+=dt;
  const living=w.enemies.some(e=>e.alive&&e.encounterId===this.id);
  if(living||s.pending){s.gap=2;return;}
  s.gap-=dt;if(s.gap>0)return;
  const waves=this.elite?3:5;
  if(s.wave<waves)this.nextWave(w);
  else{encounterRewards(w,s.members,this.elite?'elite':'challenge');endEncounter(w,this,true);w.banner(this.elite?'엘리트 소탕 완료':'시련 극복',this.elite?'보상을 확인하세요':'무기 상자와 유물 선택 보상을 확인하세요',{small:true,color:'#ffd894'});}
 }
 override draw(r:Renderer){
  if(this.elite)return;
  r.shadow(this.x,this.y,24,6,.35);r.sprite('trial_altar',this.x,this.y);r.sprite('trial_gem',this.x,this.y-16);
  if(this.mem.used)roomLabel(r,'완료',this.x,this.y-30,'#efbc92');
  else if(this.mem.phase)r.pixelText(this.mem.wave+'/5',this.x,this.y-30,'#efbc92',{align:'center',outline:'#100a18'});
 }
 override light(w:World){if(!this.elite)w.lights.add(this.x,this.y-16,50,'#e78183',{intensity:.65});}
}

for(const kind of ['challenge','elite'] as const){
 if(kind==='elite')defineRoom({id:'elite_arena',shape:'1x1',kinds:['elite'],rows:['.pp...........pp.','...X.........X...',...Array(5).fill('.................'),'...X.........X...','.pp...........pp.']});
 registerRoomHandler(kind,{
  clearOnEnter:false,
  populate(w,room){
   const cx=room.centerX,cy=room.centerY;
   if(kind==='challenge')withDecals(room,p=>{ritualCircle(p,cx,cy,52,'#a05e69',.45);});
   w.spawn(new TrialAltar(cx,cy,kind==='elite'));
  },
  spawnEnemies(){return kind==='elite';},
  onEnter(w){
   if(w.node.cleared)return;
   w.holdClear=Math.max(w.holdClear,1);
   if(kind==='elite'){
    const encounter=w.entities.find(e=>e instanceof TrialAltar&&e.elite) as TrialAltar|undefined;
    encounter?.begin(w);
   }
  },
 });
}
