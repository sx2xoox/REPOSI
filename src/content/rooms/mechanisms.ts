import { MISSION_DIFFICULTY } from '../../game/mission-difficulty';
import { participants, partySize, encounterCount, encounterWave, encounterRewards, endEncounter, updateSiege, roomLabel } from './encounter-kit';
import { ALARM_CYCLE, ALARM_FIRE, ALARM_WARN, VaultAlarmFx, alarmStage, inBeam, vaultAlarm, type AlarmBox } from './vault-alarm';
import { fx } from '../../engine/rng';
import { sceneSprite } from '../../ui/pixellab-scenery';
import { defineRoom } from '../../game/defs';
import { defineDrawnSprite, definePixelSprite } from '../../engine/sprites';
import { registerRoomHandler } from '../../game/roomkinds';
import { Prop } from '../props/prop';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { withDecals } from './decor';

type MechanismKind = 'relay' | 'workshop' | 'vault';
const COLORS = { relay: '#8de4dc', workshop: '#f6cf88', vault: '#bf9dea' };
const TITLES = { relay:'유랑 등불 회랑', workshop:'잿불 대장간', vault:'경보 금고' };
const ROWS:Record<MechanismKind,string[][]>={
 relay:[['..pp.........pp..','....X.......X....','.................','.................','.................','.................','.................','....X.......X....','..pp.........pp..'],['p...............p','...XX.......XX...','.................','.................','.................','.................','.................','...XX.......XX...','p...............p']],
 workshop:[['pp.............pp','..XX.........XX..','.................','.................','.................','.................','.................','..p...........p..','.................'],['.p.............p.','..X...........X..','.................','.................','.................','.................','.................','..XX.........XX..','.................']],
 vault:[['...XX.......XX...','..p...........p..','.................','.................','.................','.................','.................','..p...........p..','...XX.......XX...'],['.XX...........XX.','.................','.................','.................','.................','.................','.................','.................','.XX...........XX.']],
};
for(const kind of ['relay','workshop','vault'] as const){
 ROWS[kind].forEach((rows,i)=>defineRoom({id:`${kind}_${i?'gallery':'alcove'}`,shape:'1x1',kinds:[kind],rows}));
 defineDrawnSprite(`device_${kind}`,42,44,p=>{
  const c=COLORS[kind],ink='#242033',metal='#a5a4b2',gold='#c39c65';
  p.ellipse(21,40,20,3,'#15121f');
  if(kind==='relay'){
   for(const x of [7,31]){p.circle(x,37,5,ink);p.circle(x,37,3,gold);p.px(x,37,'#ead7a1');}
   p.rect(4,31,33,5,'#594936');p.line(4,31,36,31,'#b29866');
   p.rect(11,9,20,22,ink);p.rect(13,11,16,17,'#305556');p.rect(16,13,10,13,'#82bdb0');
   p.poly([18,23,17,19,20,13,24,17,25,22,22,26],c);p.rect(20,17,2,7,'#fff8c4');
   p.rect(10,7,22,4,gold);p.poly([8,8,13,4,29,4,34,8],'#a68c67');p.line(16,3,26,3,metal);
   p.rect(11,10,2,20,gold);p.rect(29,10,2,20,'#786452');p.rect(9,29,24,3,gold);
   p.line(3,32,1,23,'#967b55');p.line(1,23,7,23,'#d7bc81');
  }else if(kind==='workshop'){
   p.rect(6,12,29,27,'#504153');p.rect(7,12,27,3,'#9d8390');
   for(let y=16;y<38;y+=5){p.line(7,y,34,y,'#2d2738');for(let x=8+(y%2)*4;x<33;x+=8)p.line(x,y,x,y+4,'#352c40');}
   p.rect(13,23,15,14,ink);p.poly([13,24,16,20,25,20,28,24],'#292330');p.rect(15,25,11,10,'#974b33');
   p.poly([16,33,18,27,21,31,24,24,25,34],'#e4a055');p.line(17,35,25,35,'#ffe0a0');
   p.rect(8,3,8,11,'#504251');p.rect(7,2,10,3,'#a08c91');p.rect(28,8,5,16,'#6b646c');p.line(28,8,37,8,metal);
   p.rect(3,38,35,4,'#39313f');p.line(4,38,37,38,'#b4997b');p.px(10,17,c);
  }else{
   p.rect(4,4,34,37,'#30283f');p.rect(6,5,30,34,'#756180');p.rect(9,8,24,28,'#201c31');
   p.rect(11,10,20,24,'#4c425f');p.line(12,11,29,11,'#92849c');
   for(const x of [13,28])for(const y of [13,30])p.rect(x,y,2,2,gold);
   p.circle(21,22,7,'#29243a');p.ring(21,22,6,2,metal);p.line(17,18,25,26,gold);p.line(25,18,17,26,gold);p.circle(21,22,2,c);
   p.rect(2,39,38,4,'#4f445f');p.line(3,39,39,39,'#a69aac');p.rect(18,2,6,3,c);
   p.rect(3,13,4,5,'#9b8996');p.rect(3,28,4,5,'#9b8996');
  }
 },{outline:'#0c0810',origin:[21,42]});
}
defineDrawnSprite('device_valve',20,22,p=>{p.rect(8,9,4,12,'#746779');p.rect(2,19,16,3,'#453e52');p.circle(10,8,7,'#2a293b');p.ring(10,8,6,2,'#a4c9c1');p.line(5,8,15,8,'#617b7a');p.line(10,3,10,13,'#617b7a');p.px(9,7,'#e6e2bc');},{outline:'#0c0810',origin:[10,21]});
defineDrawnSprite('device_anvil',28,22,p=>{p.rect(7,13,14,8,'#54412f');p.poly([2,4,8,1,26,1,23,7,17,9,17,14,8,14,8,8,2,7],'#7a7889');p.line(8,1,25,1,'#e2d7c2');p.line(9,5,22,5,'#a8a3ac');p.rect(6,19,17,3,'#302937');},{outline:'#0c0810',origin:[14,21]});
// Wall-mounted equipment gives each encounter a readable purpose before it is activated.
for(const kind of ['relay','workshop','vault'] as const)defineDrawnSprite('equipment_'+kind,38,27,p=>{
 p.rect(1,1,36,25,'#242131');p.rect(2,2,34,2,'#827680');p.rect(3,24,32,2,'#13121d');
 for(const x of [3,34]){p.line(x,4,x,23,'#574b5b');p.px(x,3,'#baaa95');}
 if(kind==='relay'){
  p.line(5,8,32,8,'#95816a');
  for(const x of [9,19,29]){p.line(x,6,x,12,'#695747');p.rect(x-3,12,7,9,'#796448');p.rect(x-2,13,5,5,'#537c73');p.px(x-1,14,'#a2d3b2');p.rect(x-4,21,9,2,'#af9060');}
 }else if(kind==='workshop'){
  for(const x of [9,19,29]){p.line(x,8,x,21,'#997349');p.line(x+1,9,x+1,21,'#544133');}
  p.rect(5,7,10,4,'#a09bab');p.line(5,7,14,7,'#ddd2b8');p.poly([16,5,23,5,23,10,20,13,17,10],'#827d90');p.line(28,6,31,13,'#bbc0c0');p.line(31,6,28,13,'#bbc0c0');
 }else{
  p.rect(6,6,25,15,'#403750');p.rect(8,8,11,10,'#1c2531');
  p.line(9,14,12,14,'#96c9b7');p.line(12,14,14,10,'#96c9b7');p.line(14,10,16,16,'#96c9b7');
  for(const y of [9,14,19]){p.rect(24,y,4,2,y===9?'#e0b279':'#9a7c9f');p.px(29,y,'#d8c7ac');}
 }
},{outline:'#100c18',origin:[19,27]});
class EquipmentRack extends Prop {
 constructor(x:number,y:number,readonly kind:MechanismKind){super(x,y,1);}
 override draw(r:Renderer){r.sprite(sceneSprite('equipment_'+this.kind),this.x,this.y);}
}
for(const [kind,rows] of Object.entries({relay:['..p..','.ppp.','.p.p.','.ppp.','..p..'],workshop:['p...p','pp.pp','.ppp.','..p..','..p..'],vault:['.ppp.','p...p','ppppp','p.p.p','ppppp']}))definePixelSprite('map_'+kind,{p:COLORS[kind as MechanismKind]},rows,{outline:'#0c0810'});

/** The controller and both valves share primitive, hashable encounter state. */
export class RoomDevice extends Prop {
 mem={progress:0,used:false,index:0,phase:0,pending:0,gap:0,clock:0,anchorX:0,anchorY:0,members:1,charge:100,outside:0,stability:3,event:0,deadline:0,nextEvent:7,nextWave:0,vaultHP:24,vaultMax:24,alarmSeed:0,alarmStage:0,vaultHit:0,r0x:0,r0y:0,r1x:0,r1y:0,r2x:0,r2y:0,moving:0,lowWarned:0,heat:0};
 root:RoomDevice=this;
 constructor(x:number,y:number,readonly kind:MechanismKind,index=0){super(x,y,1);this.mem.index=index;this.mem.anchorX=x;this.mem.anchorY=y;}
 override previewable(){const s=this.root.mem;return !s.used&&(s.phase===0?this.mem.index===0:this.kind==='workshop'&&this.mem.index>0&&s.event>0);}
 override interactionInfo(){
  const s=this.root.mem;
  if(s.phase>0)return {name:TITLES[this.kind],icon:'map_'+this.kind,desc:'',compactHint:'밸브 조작'};
  return {name:TITLES[this.kind]+' · '+MISSION_DIFFICULTY[this.kind].label,icon:'map_'+this.kind,desc:(this.kind==='relay'?'세 정거장을 호위합니다. 원 안에 한 명도 없으면 안정도가 떨어지며, 0이 되면 실패하고 각자 체력 반 칸을 잃습니다.':this.kind==='workshop'?'60초 동안 버티며 대장간 온도를 지키세요. 온도 이상이 생기면 맞는 색의 밸브를 3초 안에 조작하세요. 오조작·시간 초과 3번이면 실패합니다.':'60초 동안 중앙 금고를 지키세요. 경비병은 금고를 공격합니다. 경보 광선은 매번 다른 자리에서 켜지고 금고 위로도 지나가니, 경고선을 보고 비켜서세요. 광선은 침입자도 태웁니다. 금고 내구도가 0이면 실패합니다.')+' 한 번만 도전할 수 있습니다.'};
 }
 override interact(w:World):boolean{
  const root=this.root,s=root.mem,p=w.player;
  if(s.used||!p.alive||p.downed||Math.hypot(p.x-this.x,p.y-this.y)>30)return false;
  if(s.phase===1&&this.kind==='workshop'&&this.mem.index>0&&s.event){
   const correct=s.event===this.mem.index;s.event=0;s.deadline=0;
   if(!correct)root.miss(w,'잘못된 밸브');else{w.floatText(this.x,this.y-30,'안정화','#9bdfc7');w.sfx('clock_steam',{vol:.5});}return true;
  }
  if(s.phase!==0||this.mem.index!==0)return false;
  s.members=participants(w);s.phase=this.kind==='relay'?2:1;s.gap=.8;s.clock=0;s.nextWave=0;
  s.vaultMax=s.vaultHP=Math.round(24*(1+.3*(partySize(s.members)-1)));
  if(this.kind==='vault'){s.alarmSeed=w.rng.int(1,999999);s.alarmStage=1;}
  if(this.kind==='workshop')s.nextEvent=6+w.rng.range(0,3);
  w.room.setDoorsClosed(true);w.sfx('door_close');
  w.banner(TITLES[this.kind],this.kind==='relay'?'원 안에 한 명 이상 머물며 수레를 호위하세요':this.kind==='workshop'?'60초 · 온도 이상이 생기면 3초 안에 밸브를 조작하세요':'60초 · 금고를 공격하는 적을 먼저 저지하세요',{small:true,color:COLORS[this.kind]});
  return true;
 }
 private miss(w:World,label:string){this.mem.stability--;w.floatText(this.x,this.y-42,label+' · 내구도 -1','#ef8b7b');w.sfx('warn',{vol:.5});if(this.mem.stability<=0)this.finish(w,false);}
 damageVault(w:World,amount:number){
  if(this.mem.used||this.mem.phase!==1)return;
  this.mem.vaultHP=Math.max(0,this.mem.vaultHP-amount);this.mem.vaultHit=.3;
  w.floatText(this.x+fx.range(-6,6),this.y-36,'-'+amount,'#e8a0f0');w.sfx('hit_metal',{vol:.5,pitch:.8});
  w.particles.burst(this.x,this.y-20,{count:6,speed:[30,90],life:[.15,.35],colors:['#ffffff','#e2c8ff','#8a6aa8'],size:[1,2],shape:'spark'});
  if(this.mem.vaultHP>0&&this.mem.vaultHP<=Math.ceil(this.mem.vaultMax/3)&&this.mem.vaultHP+amount>Math.ceil(this.mem.vaultMax/3)){w.floatText(this.x,this.y-64,'금고가 위험합니다','#ff8a8a');w.sfx('warn',{vol:.5,pitch:1.3});}
  if(this.mem.vaultHP<=0)this.finish(w,false);
 }
 /** Relay stop i (absolute room px; chosen per room when it is built). */
 stopX(i:number){const s=this.mem;return i===0?s.r0x:i===1?s.r1x:s.r2x;}
 stopY(i:number){const s=this.mem;return i===0?s.r0y:i===1?s.r1y:s.r2y;}
 /** Interior span of the alarm beams. */
 alarmBox(w:World):AlarmBox{return {x0:32,y0:32,x1:w.room.pxW-32,y1:w.room.pxH-32,vx:this.mem.anchorX,vy:this.mem.anchorY};}
 private finish(w:World,success=true){
  if(this.mem.used)return;
  if(success)encounterRewards(w,this.mem.members,this.kind);
  endEncounter(w,this,success);
  if(!success&&this.kind==='relay')for(const p of w.coop?w.players:[w.player])if((this.mem.members&(1<<p.slot))&&p.alive&&!p.downed){
   // Mission failure is a fixed cost; neither floor damage nor dodge/shields amplify or erase it.
   if(p.soul>0)p.soul--;else p.red=Math.max(0,p.red-1);
   w.run.stats.damageTaken++;w.floatText(p.x,p.y-22,'-0.5♥','#ff8b99');
   if(!p.alive)w.asPlayer(p,()=>w.playerDied('등불 호위 실패'));
  }
  w.banner(success?'임무 완료':'임무 실패',success?'보상을 확인하세요':'위험이 멎고 출구가 열렸습니다. 이 장치는 다시 가동할 수 없습니다.',{small:true,color:success?COLORS[this.kind]:'#e9988d'});
 }
 override update(w:World,dt:number){
  this.age+=dt;if(this.root!==this||this.mem.used)return;
  w.holdClear=Math.max(w.holdClear,1);const s=this.mem;if(s.phase===0)return;
  s.clock+=dt;
  if(this.kind==='relay'){
   const near=(w.coop?w.players:[w.player]).some(p=>(s.members&(1<<p.slot))&&p.alive&&!p.downed&&Math.hypot(p.x-this.x,p.y-this.y)<=40);
   if(near){s.outside=0;s.charge=Math.min(100,s.charge+6*dt);}else{s.outside+=dt;if(s.outside>1)s.charge=Math.max(0,s.charge-12*dt);}
   if(s.charge<=0){this.finish(w,false);return;}
   if(s.charge<30&&!s.lowWarned){s.lowWarned=1;w.floatText(this.x,this.y-64,'수레 등불이 꺼져 갑니다','#f19182');w.sfx('warn',{vol:.4,pitch:1.2});}
   else if(s.charge>50)s.lowWarned=0;
   const living=w.enemies.some(e=>e.alive&&e.encounterId===this.id);
   s.moving=0;
   if(s.phase===2){
    if(!near||living||s.pending)return;
    const tx=this.stopX(s.progress),ty=this.stopY(s.progress);
    const dx=tx-this.x,dy=ty-this.y,d=Math.hypot(dx,dy);
    if(d<1){
     s.phase=1;s.gap=.7;
     w.floatText(this.x,this.y-64,'정거장 '+(s.progress+1)+'/3 · 습격!','#8de4dc');w.sfx('clock_chime',{vol:.5,pitch:1.1});
     encounterWave(w,this,Math.ceil((3+Math.floor((w.floor.index-1)/3)+(s.progress>0?1:0))*1.25));
    }
    else{
     const k=Math.min(d,26*dt)/d;this.x+=dx*k;this.y+=dy*k;s.moving=1;
     // wheels grind and kick up dust while the cart rolls
     if(fx.chance(.25))w.particles.burst(this.x+fx.pick([-14,14]),this.y-2,{count:1,speed:[6,20],life:[.4,.7],colors:['#8a7a66','#6a5c4e'],size:[1,2],sizeEnd:3,drag:3,fade:true});
    }
   }else if(!living&&!s.pending){s.gap-=dt;if(s.gap<=0){s.progress++;if(s.progress===3)this.finish(w);else{s.phase=2;w.floatText(this.x,this.y-64,'출발','#c9efe9');w.sfx('door_open',{vol:.3,pitch:1.4});}}}
   return;
  }
  if(s.clock>=60){this.finish(w);return;}
  if(s.clock>=s.nextWave){
   s.nextWave+=this.kind==='vault'?8:10;
   const alive=w.enemies.filter(e=>e.alive&&e.encounterId===this.id).length;
   const count=(this.kind==='vault'?5:3)+Math.floor((w.floor.index-1)/3);
   if(alive<Math.ceil(14*encounterCount(partySize(s.members))))encounterWave(w,this,count,false,this.kind==='vault');
  }
  if(this.kind==='workshop'){
   if(s.event){s.deadline-=dt;if(s.deadline<=0){s.event=0;this.miss(w,'조작 시간 초과');}}
   if(s.clock>=s.nextEvent&&s.nextEvent<55){
    if(s.event)s.nextEvent+=1;
    else{s.nextEvent+=10+w.rng.range(0,3);s.event=w.rng.chance(.5)?1:2;s.deadline=3;w.floatText(this.x,this.y-42,s.event===1?'대장간이 차가워집니다':'대장간이 뜨거워집니다',s.event===1?'#8cd5ee':'#ffb079');w.sfx('warn',{vol:.45});}
   }
   // the furnace drifts toward the alarm colour while an event is open, and settles after
   s.heat+=((s.event===1?-1:s.event===2?1:0)-s.heat)*Math.min(1,dt*3);
   if(s.event&&fx.chance(.35))w.particles.burst(this.x+fx.range(-8,8),this.y-24,s.event===1?{count:1,speed:[6,18],life:[.6,1],colors:['#e6f8ff','#9fd8ee'],size:[1,1],gravity:30}:{count:1,speed:[20,60],life:[.3,.6],colors:['#fff0b0','#ffb050','#e05a20'],size:[1,1],shape:'spark',gravity:-60,additive:true});
  }else{
   for(const e of w.enemies)if(e.alive&&e.mem.siege===this.id)updateSiege(e,w,dt);
   s.vaultHit=Math.max(0,s.vaultHit-dt);
   const stage=alarmStage(s.clock);
   if(stage>s.alarmStage){s.alarmStage=stage;w.banner('경보 '+stage+'단계',stage===2?'광선이 좁혀 들어오고 금고 위로도 지나갑니다':'금고를 축으로 광선이 돌기 시작합니다',{small:true,color:COLORS.vault});w.sfx('warn',{vol:.6});}
   const alarm=vaultAlarm(s.alarmSeed,s.clock,this.alarmBox(w));
   const phase=s.clock-alarm.cycle*ALARM_CYCLE,before=phase-dt;
   if(before<ALARM_WARN&&phase>=ALARM_WARN)w.sfx('beam_charge',{vol:.3,pitch:1.25});
   if(before<ALARM_FIRE&&phase>=ALARM_FIRE){w.sfx('laser',{vol:.5,pitch:1.15});w.shake(.1);}
   if(alarm.active){
    for(const p of w.coop?w.players:[w.player])if(p.alive&&!p.downed&&inBeam(alarm,p.x,p.y,p.r))p.hurt(w,1,'금고 경보 광선');
    // the alarm burns intruders too, once per volley
    for(const e of w.enemies)if(e.alive&&!e.hidden&&e.mem.alarmHit!==alarm.cycle+1&&inBeam(alarm,e.x,e.y,e.r)){e.mem.alarmHit=alarm.cycle+1;w.applyHit(e,{damage:8*w.floor.hpMult,kind:'laser',source:this,attacker:null,noProc:true,light:true});}
   }
  }
 }
 override draw(r:Renderer,w:World){
  const s=this.root.mem,c=COLORS[this.kind];
  if(this===this.root&&this.kind==='vault'&&s.phase===1&&!s.used&&s.vaultHP<=Math.ceil(s.vaultMax/3))r.ring(this.x,this.y-14,26+Math.sin(w.time*8)*2,'#ff6a7a',1,.45+.25*Math.sin(w.time*8));
  r.shadow(this.x,this.y,24,6,.35);
  const valve=this.mem.index>0;
  const sprite=valve?'device_valve_'+(this.mem.index===1?'warm':'cool'):'device_'+this.kind+(this.kind==='vault'&&s.phase===4?'_open':'');
  // Color belongs to the painted handwheel. Keep iron supports and highlights neutral.
  const bob=this.kind==='relay'&&s.moving?Math.round(Math.sin(w.time*18)*.6):0;
  r.sprite(sceneSprite(sprite,valve?sceneSprite('device_valve'):'device_'+this.kind),this.x,this.y+bob,this.kind==='vault'&&s.vaultHit>0?{flash:Math.min(1,s.vaultHit*3)}:undefined);
  if(this.kind==='workshop'&&!valve&&Math.abs(s.heat)>.05)r.ring(this.x,this.y-18,14+Math.abs(s.heat)*4,s.heat<0?'#9fe2f6':'#ffa24a',1,Math.abs(s.heat)*(.45+.25*Math.sin(w.time*10)));
  if(valve){
   const vc=this.mem.index===1?'#ffc184':'#8bdff3';
   if(s.event&&s.phase===1){const selected=s.event===this.mem.index;r.ring(this.x,this.y,16,vc,1,selected?.85:.15);if(selected)r.pixelText(s.deadline.toFixed(1),this.x,this.y-29,vc,{align:'center',outline:'#110c1b'});}
   return;
  }
  if(this.kind==='relay'){
   for(let i=0;i<3;i++){const lit=i<s.progress,next=i===s.progress&&s.phase===2;r.rect(this.stopX(i)-3,this.stopY(i)+9,6,2,lit?'#f4dfad':next?'#8de4dc':'#517675',next?.6+.4*Math.sin(w.time*6):1);}
   if(s.phase>0&&!s.used)r.ring(this.x,this.y,40,s.charge<30?'#f19182':c,1,.5);
  }
  if(s.phase>0&&!s.used){
   const value=this.kind==='relay'?s.charge/100:this.kind==='vault'?s.vaultHP/s.vaultMax:s.stability/3;
   r.rect(this.x-22,this.y-49,44,4,'#211b2e');r.rect(this.x-22,this.y-49,44*value,4,value<.34?'#e87879':c);
   const text=this.kind==='relay'?s.progress+'/3 · '+Math.ceil(s.charge)+'%':Math.ceil(60-s.clock)+'s · '+(this.kind==='vault'?s.vaultHP+'/'+s.vaultMax:s.stability+'/3');
   r.pixelText(text,this.x,this.y-57,c,{align:'center',outline:'#110c1b'});
  }
  if(s.used)roomLabel(r,s.phase===4?'완료':'실패',this.x,this.y-42,s.phase===4?c:'#db8a87');
  if(this.kind==='workshop'&&s.event&&!s.used)roomLabel(r,s.event===1?'대장간이 차가워집니다':'대장간이 뜨거워집니다',this.x,this.y-67,s.event===1?'#a6e4f2':'#ffc390');
 }
 override light(w:World){
  const valve=this.mem.index>0,heat=this.kind==='workshop'&&!valve?this.mem.heat:0;
  w.lights.add(this.x,this.y-18,valve?24:55+Math.abs(heat)*12,valve?'#e2d8c9':heat<-.3?'#9fd8f0':heat>.3?'#ff9a40':COLORS[this.kind],{intensity:this.root.mem.used?.3:valve?.35:.7});
  const s=this.mem;
  if(this.kind!=='vault'||this.root!==this||s.phase!==1||s.used)return;
  const alarm=vaultAlarm(s.alarmSeed,s.clock,this.alarmBox(w));
  if(!alarm.warning)return;
  for(const l of alarm.beams)for(let t=0;t<=1;t+=.25)w.lights.add(l.x0+(l.x1-l.x0)*t,l.y0+(l.y1-l.y0)*t,alarm.active?30:14,'#ff5a74',{intensity:alarm.active?.55:.25});
 }
}

// Escort routes (offsets from the room centre); each room picks one, possibly mirrored,
// that the cart can roll along without crossing pillars or pots.
const RELAY_ROUTES:[number,number][][]=[
 [[-64,16],[0,-24],[64,16]],
 [[-64,-22],[0,24],[64,-22]],
 [[-58,-26],[58,-26],[0,30]],
 [[-72,24],[-8,-28],[68,18]],
 [[0,-34],[-70,8],[54,30]],
 [[-40,30],[40,-30],[74,24]],
];
function relayRoute(w:World,room:import('../../game/room').Room,rng:import('../../engine/rng').RNG):[number,number][]{
 const cx=room.centerX,cy=room.centerY;
 const fits=(pts:[number,number][])=>{
  let [ax,ay]=[cx,cy];
  for(const [bx,by] of pts){
   if(bx<56||by<52||bx>room.pxW-56||by>room.pxH-48)return false;
   const d=Math.hypot(bx-ax,by-ay);
   for(let t=0;t<=d;t+=6){const x=ax+(bx-ax)*t/Math.max(1,d),y=ay+(by-ay)*t/Math.max(1,d);if(room.boxBlocked(x,y,12,false,false))return false;}
   [ax,ay]=[bx,by];
  }
  return true;
 };
 for(const i of rng.shuffle(RELAY_ROUTES.map((_,i)=>i))){
  const fx0=rng.chance(.5)?-1:1,fy0=rng.chance(.5)?-1:1;
  const pts=RELAY_ROUTES[i].map(([x,y])=>[Math.round(cx+x*fx0),Math.round(cy+y*fy0)] as [number,number]);
  if(fits(pts))return pts;
 }
 return RELAY_ROUTES[0].map(([x,y])=>[cx+x,cy+y] as [number,number]);
}
// Workshop valve stands: warm (index 1) and cool (index 2) swap sides between rooms.
const VALVE_LAYOUTS:[number,number][][]=[[[-42,22],[42,22]],[[-72,-2],[72,-2]],[[-56,26],[56,-30]],[[-30,34],[30,34]]];
function valveLayout(room:import('../../game/room').Room,rng:import('../../engine/rng').RNG):[number,number][]{
 const cx=room.centerX,cy=room.centerY;
 const order=rng.shuffle(VALVE_LAYOUTS.map((_,i)=>i));
 for(const i of order){
  const swap=rng.chance(.5);
  const pts=VALVE_LAYOUTS[i].map(([x,y])=>[Math.round(cx+x),Math.round(cy+y)] as [number,number]);
  if(swap)pts.reverse();
  if(pts.every(([x,y])=>!room.boxBlocked(x,y,8,false,false)))return pts;
 }
 return [[cx-42,cy+22],[cx+42,cy+22]];
}

for(const kind of ['relay','workshop','vault'] as const)registerRoomHandler(kind,{
 clearOnEnter:false,
 populate(w,room,rng){
  const cx=room.centerX,cy=room.centerY;
  const route=kind==='relay'?relayRoute(w,room,rng):[];
  const valves=kind==='workshop'?valveLayout(room,rng):[];
  withDecals(room,p=>{
   const c=COLORS[kind];
   if(kind==='relay'){
    const stops=[[cx,cy],...route];
    for(let i=1;i<stops.length;i++){const [ax,ay]=stops[i-1],[bx,by]=stops[i],dx=bx-ax,dy=by-ay,d=Math.hypot(dx,dy),nx=-dy/d*4,ny=dx/d*4;
     for(let t=0;t<d;t+=9){const x=ax+dx*t/d,y=ay+dy*t/d;p.line(x-nx*1.5,y-ny*1.5,x+nx*1.5,y+ny*1.5,'#594635');}
     for(const sign of [-1,1]){p.line(ax+nx*sign,ay+ny*sign,bx+nx*sign,by+ny*sign,'#8a8373');p.line(ax+nx*sign,ay+ny*sign+1,bx+nx*sign,by+ny*sign+1,'#35323c');}
    }
    for(const [x,y]of stops.slice(1)){p.rectOutline(x-13,y-10,26,20,'#88754f');for(const dx of [-11,10])for(const dy of [-8,7])p.px(x+dx,y+dy,'#c1a96d');}
   }
   if(kind==='workshop'){
    p.rect(cx-42,cy-28,84,54,'#302630');
    for(let y=cy-28;y<cy+26;y+=9)for(let x=cx-42;x<cx+42;x+=12){p.rectOutline(x,y,12,9,'#53454b');p.line(x+2,y+1,x+9,y+1,'#6b5757');p.px(x+2,y+2,'#9b8069');}
    // feed pipes from the furnace to wherever the valves stand
    for(const [vx,vy] of valves){p.line(cx,cy+22,vx,cy+22,'#302733');p.line(cx,cy+23,vx,cy+23,'#827461');p.line(vx,cy+22,vx,vy,'#302733');p.line(vx+1,cy+22,vx+1,vy,'#827461');}
    for(let i=0;i<16;i++){const x=cx-30+i*4,y=cy+18+(i*7%11);p.rect(x,y,2,1,i%3?'#51433d':'#b58650');}
   }
   if(kind==='vault'){p.rectOutline(cx-100,cy-52,200,104,'#695571');p.rectOutline(cx-96,cy-48,192,96,'#33283e');
    // emitter rails run along all four walls: the alarm can fire from anywhere on them
    const x0=32,y0=32,x1=room.pxW-32,y1=room.pxH-32;
    for(const [ax,ay,bx,by] of [[x0,y0,x1,y0],[x0,y1-1,x1,y1-1],[x0,y0,x0,y1],[x1-1,y0,x1-1,y1]]){p.line(ax,ay,bx,by,'#4a3a5a');}
    for(let x=x0+8;x<x1;x+=16){p.px(x,y0,c);p.px(x,y1-1,c);}for(let y=y0+8;y<y1;y+=16){p.px(x0,y,c);p.px(x1-1,y,c);}}
  });
  const root=w.spawn(new RoomDevice(cx,cy,kind));
  if(kind==='relay')route.forEach(([x,y],i)=>{const m=root.mem as Record<string,number|boolean>;m['r'+i+'x']=x;m['r'+i+'y']=y;});
  if(kind==='vault')w.spawn(new VaultAlarmFx(root,root.alarmBox(w)));
  // Hang above the floor lanes, leaving doors and enemy spawn space readable.
  for(const x of [cx-74,cx+74])w.spawn(new EquipmentRack(x,cy-65,kind));
  if(kind==='workshop')for(const index of [1,2]){const [vx,vy]=valves[index-1];const valve=w.spawn(new RoomDevice(vx,vy,kind,index));valve.root=root;}
 },
 spawnEnemies(){return false;},
 onEnter(w){if(w.node.cleared)return;w.holdClear=Math.max(w.holdClear,1);w.banner(TITLES[w.node.kind as MechanismKind]+' · '+MISSION_DIFFICULTY[w.node.kind as MechanismKind].label,'장치 가까이에서 진행 방법을 확인하세요 · 시작 전에는 자유롭게 나갈 수 있습니다',{small:true});},
});
