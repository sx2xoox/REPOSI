import { RefugeRelease } from './refuge-release';
import { sceneSprite } from '../../ui/pixellab-scenery';
import { defineDrawnSprite, hasSprite } from '../../engine/sprites';
import type { PassiveDef, DashDef } from '../../game/defs';
import { Weapons } from '../../game/defs';
import { Entity } from '../../game/entity';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import { Enemy } from '../../game/enemy';
import { save } from '../../engine/save';
import { isPrimary } from '../items/lib';
import { fragment } from '../weapons/kit';
import { rayLength } from '../weapons/common';
import { releaseOpen } from './kit-common';
import { Projectile } from '../../game/projectile';
import { MeleeSwing } from '../../game/melee';
import { RingFx } from '../../game/effects';

export const REFUGE_COLORS=['#dba26a','#bba3e5','#ed9fa4','#91c6a3','#b3c9ee'];
const ids=['tove','luen','ves','ort','mira'];
for(let i=0;i<ids.length;i++)for(const type of ['passive','dash'])defineDrawnSprite(`icon_${ids[i]}_${type}`,16,16,p=>{
 p.rect(3,3,10,10,'#343044');p.rectOutline(3,3,10,10,REFUGE_COLORS[i]);
 if(type==='dash'){p.poly([3,5,8,8,3,11,7,11,12,8,7,5],REFUGE_COLORS[i]);}
 else if(i===0){p.rect(6,4,5,5,REFUGE_COLORS[i]);p.line(8,9,4,13,'#ddd8bc');p.line(8,9,12,13,'#ddd8bc');}
 else if(i===1){p.rect(6,3,4,4,'#e8dcb9');p.ellipse(8,10,4,4,REFUGE_COLORS[i]);p.px(6,9,'#fff5dc');}
 else if(i===2){p.line(4,5,12,5,REFUGE_COLORS[i]);p.line(12,11,4,11,REFUGE_COLORS[i]);p.line(10,3,12,5,'#ffffff');p.line(6,13,4,11,'#ffffff');}
 else if(i===3){p.line(5,13,5,3,'#e5dab1');p.poly([6,3,12,5,6,7],REFUGE_COLORS[i]);}
 else {p.rect(4,4,8,8,'#e9dab7');p.line(6,6,10,6,'#7b728e');p.line(6,9,10,9,'#7b728e');}
},{outline:'#0c0810'});
defineDrawnSprite('refuge_road_rune',11,11,p=>{p.poly([5,0,10,5,5,10,0,5],'#29483f');p.line(2,5,5,2,'#91c6a3');p.line(5,2,8,5,'#e6e2b8');p.line(8,5,5,8,'#629c83');p.px(5,5,'#fff0c3');},{origin:[5,5]});
defineDrawnSprite('refuge_record_page',9,11,p=>{p.rect(1,1,7,9,'#ece0bb');p.line(2,2,6,2,'#fff4d2');p.line(3,4,6,4,'#787a9e');p.line(3,6,6,6,'#787a9e');p.line(3,8,5,8,'#787a9e');},{outline:'#272239',origin:[4,5]});
defineDrawnSprite('refuge_turret',14,16,p=>{p.line(7,10,2,15,'#726981');p.line(7,10,12,15,'#726981');p.rect(3,4,9,6,'#80624b');p.rect(4,4,7,3,'#dba26a');p.rect(8,5,6,2,'#c5cbd1');p.px(5,5,'#fff3c9');},{outline:'#0c0810',anchor:'bottom'});

/** Owner and numeric memory participate in the existing lockstep hash. No item/ember recursion. */
export class RefugeTurret extends Entity {
 owner:Player; mem:Record<string,number>;
 constructor(owner:Player,x:number,y:number,release=false){super();this.owner=owner;this.x=x;this.y=y;this.tileCollide=false;this.mem={release:Number(release),life:release?3:5,tick:0,hits:0,damage:owner.stats.damage};}
 override update(w:World,dt:number){
  this.age+=dt;if(this.age>=this.mem.life||!this.owner.alive||this.owner.downed){this.dead=true;return;}
  if(this.mem.release){this.x=this.owner.x+16;this.y=this.owner.y;}
  this.mem.flash=Math.max(0,(this.mem.flash??0)-dt);this.mem.tick-=dt;if(this.mem.tick>0)return;this.mem.tick=this.mem.release?.3:.65;
  const target=w.enemies.filter(e=>e.alive&&!e.hidden&&Math.hypot(e.x-this.x,e.y-this.y)<150).sort((a,b)=>Math.hypot(a.x-this.x,a.y-this.y)-Math.hypot(b.x-this.x,b.y-this.y)||a.id-b.id).find(e=>rayLength(w,this.x,this.y-6,Math.atan2(e.y-(this.y-6),e.x-this.x),Math.hypot(e.x-this.x,e.y-(this.y-6)))>=Math.hypot(e.x-this.x,e.y-(this.y-6))-3);
  if(!target)return;
  this.mem.tx=target.x;this.mem.ty=target.y;this.mem.flash=.12;
  w.applyHit(target,{damage:this.mem.damage*(this.mem.release?1.1:.22),kind:'laser',attacker:this.owner,noProc:true,release:!!this.mem.release});this.mem.hits++;
 }
 override draw(r:Renderer,w:World){r.sprite(sceneSprite('refuge_turret'),this.x,this.y+Math.round(Math.max(0,1-this.age/.16)*4),{flipX:(this.mem.tx??this.x+1)<this.x});if(this.mem.flash>0){const alpha=w.coop&&this.owner!==w.local?Math.max(0,Math.min(1,save.settings.teammateProjectileOpacity??.5)):1;r.line(this.x+(hasSprite('pl_prop_refuge_turret')?((this.mem.tx<this.x?-1:1)*10):0),this.y-(hasSprite('pl_prop_refuge_turret')?17:6),this.mem.tx,this.mem.ty,'#f9dd9d',1,.6*alpha);}}
}
export const REFUGE_PASSIVES:PassiveDef[]=[
 {name:'야전 공병',desc:'직접 적중 6회마다 5초 포탑을 설치한다. 최대 2개, 설치 간격 1.5초.',icon:'icon_tove_passive',
  onHit(w,_t,h){if(!isPrimary(h))return;w.vars.rfToveHits=(w.vars.rfToveHits??0)+1;if(w.vars.rfToveHits<6||(w.vars.rfToveNext??0)>w.time)return;w.vars.rfToveHits=0;w.vars.rfToveNext=w.time+1.5;const own=w.entities.filter(e=>e instanceof RefugeTurret&&e.owner===w.player&&!e.dead&&!e.mem.release);if(own.length>=2)own[0].dead=true;w.spawn(new RefugeTurret(w.player,w.player.x,w.player.y));},
  onRoomEnter(w){w.vars.rfToveHits=0;w.vars.rfToveNext=0;},
 },
 {name:'시약 반응',desc:'직접 적중에 독·화상을 번갈아 묻힌다. 두 효과가 만나면 반응, 대상당 1.2초.',icon:'icon_luen_passive',
  modifyHit(w,_t,h){if(!isPrimary(h))return;const n=(w.vars.rfLuenHit??0)+1;w.vars.rfLuenHit=n;h.statuses=[...(h.statuses??[]),{kind:n%2?'poison':'burn',duration:2,power:w.player.stats.damage*.015}];},
  onHit(w,t,h){if(!isPrimary(h)||!(t instanceof Enemy)||!t.alive||!t.hasStatus('poison')||!t.hasStatus('burn'))return;const key='rfLuenNext'+w.player.id;if((t.mem[key]??0)>w.time)return;t.mem[key]=w.time+1.2;w.applyHit(t,{damage:w.player.stats.damage*.45,kind:'status',attacker:w.player,noProc:true});w.spawn(new RingFx(t.x,t.y,15,.22,'#bba3e5',1));},
 },
 {name:'교차 박자',desc:'다른 무기로 바꾼 첫 공격 피해 +35%. 발동 간격 0.8초.',icon:'icon_ves_passive',
  onAttack(w){w.vars.rfVesUntil=-1;const now=Weapons.all().findIndex(d=>d.id===w.player.weaponId);if(w.vars.rfVesWeapon!==undefined&&w.vars.rfVesWeapon!==now&&(w.vars.rfVesNext??0)<=w.time){w.vars.rfVesUntil=w.time+.2;w.vars.rfVesNext=w.time+.8;}w.vars.rfVesWeapon=now;},
  onShoot(w,pr){if(pr.generation===0&&(w.vars.rfVesUntil??-1)>0)pr.damage*=1.35;},
  onSwing(w,sw){if((w.vars.rfVesUntil??-1)>0)sw.o.damage*=1.35;},
  modifyHit(w,_t,h){if(isPrimary(h)&&!(h.source instanceof Projectile)&&!(h.source instanceof MeleeSwing)&&(w.vars.rfVesUntil??-1)>0)h.damage*=1.35;},
  onRoomEnter(w){delete w.vars.rfVesWeapon;w.vars.rfVesUntil=-1;},
 },
 {name:'귀환 표식',desc:'표식에서 충분히 멀어졌다 돌아오면 다음 공격 피해 +40%.',icon:'icon_ort_passive',
  onRoomEnter(w){w.vars.rfOrtX=w.player.x;w.vars.rfOrtY=w.player.y;w.vars.rfOrtAway=0;w.vars.rfOrtReady=0;w.vars.rfOrtUntil=-1;},
  onUpdate(w){const p=w.player;if(w.vars.rfOrtX===undefined){w.vars.rfOrtX=p.x;w.vars.rfOrtY=p.y;}const d=Math.hypot(p.x-w.vars.rfOrtX,p.y-w.vars.rfOrtY);if(d>45)w.vars.rfOrtAway=1;if(d<14&&w.vars.rfOrtAway){w.vars.rfOrtReady=1;w.vars.rfOrtAway=0;}},
  onAttack(w){w.vars.rfOrtUntil=-1;if(w.vars.rfOrtReady){w.vars.rfOrtUntil=w.time+.2;w.vars.rfOrtReady=0;}},
  onShoot(w,pr){if(pr.generation===0&&(w.vars.rfOrtUntil??-1)>0)pr.damage*=1.4;},
  onSwing(w,sw){if((w.vars.rfOrtUntil??-1)>0)sw.o.damage*=1.4;},
  modifyHit(w,_t,h){if(isPrimary(h)&&!(h.source instanceof Projectile)&&!(h.source instanceof MeleeSwing)&&(w.vars.rfOrtUntil??-1)>0)h.damage*=1.4;},
  draw(w,r){if(w.vars.rfOrtX!==undefined){const x=w.vars.rfOrtX,y=w.vars.rfOrtY;r.sprite('refuge_road_rune',x,y,{alpha:w.vars.rfOrtAway?.95:.55});for(const side of [-1,1])r.line(x+side*9,y-3,x+side*9,y+3,'#91c6a3',1,.55);if(w.vars.rfOrtReady)r.sprite('refuge_road_rune',w.player.x-12,w.player.y-13,{alpha:.8});}},
 },
 {name:'남겨진 문장',desc:'실제 입힌 직접 피해의 15%를 기록한다. 0.7초 쉬면 기록탄 발사. 저장 최대 기본 피해 3배.',icon:'icon_mira_passive',
  onHit(w,_t,h){if(!isPrimary(h))return;w.vars.rfMiraStored=Math.min(w.player.stats.damage*3,(w.vars.rfMiraStored??0)+(h.dealtDamage??h.damage)*.15);w.vars.rfMiraLast=w.time;},
  onAttack(w){w.vars.rfMiraLast=w.time;},
  onUpdate(w){if((w.vars.rfMiraStored??0)>0&&w.time-(w.vars.rfMiraLast??w.time)>.7){const dmg=w.vars.rfMiraStored;w.vars.rfMiraStored=0;fragment(w,w.player.x,w.player.y-5,w.player.aim,{damage:dmg,sprite:'refuge_record_page',color:'#b3c9ee',pierce:1,range:w.player.stats.range,speed:260});}},
  onRoomEnter(w){w.vars.rfMiraStored=0;},
 },
];
export const REFUGE_DASHES:DashDef[]=[
 {name:'긴급 회수',desc:'대시하면 자신의 포탑을 도착 지점으로 회수한다.',icon:'icon_tove_dash',color:REFUGE_COLORS[0],end(w,p){let n=0;for(const e of w.entities)if(e instanceof RefugeTurret&&e.owner===p&&!e.dead){e.x=p.x+(n++%2?10:-10);e.y=p.y;}}},
 {name:'시약 발걸음',desc:'대시 후 2초 동안 첫 직접 적중에 약한 화상을 추가한다.',icon:'icon_luen_dash',color:REFUGE_COLORS[1],start(w){w.vars.rfLuenDash=w.time+2;}},
 {name:'빠른 이탈',desc:'짧은 재사용 대기시간으로 빠르게 이탈한다.',icon:'icon_ves_dash',color:REFUGE_COLORS[2],iframes:.09},
 {name:'길 다시 놓기',desc:'대시를 시작한 자리에 귀환 표식을 다시 놓는다.',icon:'icon_ort_dash',color:REFUGE_COLORS[3],start(w,p){w.vars.rfOrtX=p.x;w.vars.rfOrtY=p.y;w.vars.rfOrtAway=0;}},
 {name:'책갈피',desc:'대시하면 저장한 기록을 잃지 않고 즉시 기록탄으로 발사한다.',icon:'icon_mira_dash',color:REFUGE_COLORS[4],start(w,p){const d=w.vars.rfMiraStored??0;if(d>0){w.vars.rfMiraStored=0;fragment(w,p.x,p.y-5,p.aim,{damage:d,sprite:'refuge_record_page',color:REFUGE_COLORS[4],range:p.stats.range,pierce:1});}}},
];
const luenModify=REFUGE_PASSIVES[1].modifyHit!;
REFUGE_PASSIVES[1].modifyHit=(w,t,h,power)=>{luenModify(w,t,h,power);if(isPrimary(h)&&(w.vars.rfLuenDash??-1)>w.time){w.vars.rfLuenDash=-1;h.statuses=[...(h.statuses??[]),{kind:'burn',duration:2,power:w.player.stats.damage*.06}];}};
export const REFUGE_RELEASES=[
 (w:World,p:Player)=>{releaseOpen(w,p,REFUGE_COLORS[0],80,'focus');for(const e of w.entities)if(e instanceof RefugeTurret&&e.owner===p&&e.mem.release)e.dead=true;w.spawn(new RefugeTurret(p,p.x+16,p.y,true));w.spawn(new RefugeRelease(p,0,w));},
 (w:World,p:Player)=>{releaseOpen(w,p,REFUGE_COLORS[1],110,'focus');w.spawn(new RefugeRelease(p,1,w));},
 (w:World,p:Player)=>{releaseOpen(w,p,REFUGE_COLORS[2],80,'focus');w.spawn(new RefugeRelease(p,2,w));},
 (w:World,p:Player)=>{releaseOpen(w,p,REFUGE_COLORS[3],80,'focus');w.spawn(new RefugeRelease(p,3,w));},
 (w:World,p:Player)=>{releaseOpen(w,p,REFUGE_COLORS[4],80,'focus');const record=Math.min(p.stats.damage*3,w.vars.rfMiraStored??0);w.vars.rfMiraStored=0;w.spawn(new RefugeRelease(p,4,w,record));},
];

// Read existing state only: readiness is visible without adding simulation timers.
REFUGE_PASSIVES[1].draw=(w,r)=>{if((w.vars.rfLuenDash??-1)>w.time){const p=w.player;r.rect(p.x-13,p.y-17,3,6,'#d6dccc',.8);r.rect(p.x-12,p.y-14,2,3,'#edaf6a',.9);}};
REFUGE_PASSIVES[2].draw=(w,r)=>{const a=Math.max(0,Math.min(1,((w.vars.rfVesUntil??-1)-w.time)/.2));if(a){const p=w.player;r.line(p.x-10,p.y-19,p.x-3,p.y-12,'#f4c2ca',1,a);r.line(p.x-10,p.y-12,p.x-3,p.y-19,'#f4c2ca',1,a);}};
REFUGE_PASSIVES[4].draw=(w,r)=>{const amount=(w.vars.rfMiraStored??0)/Math.max(1,w.player.stats.damage*3);if(amount>0)for(let i=0;i<Math.ceil(amount*3);i++)r.sprite('refuge_record_page',w.player.x-15-i*3,w.player.y-9-i*2,{alpha:.45+i*.15});};
for(const passive of REFUGE_PASSIVES){const draw=passive.draw;if(!draw)continue;passive.draw=(w,r,power)=>{const before=r.worldOpacity;if(w.coop&&w.player!==w.local)r.worldOpacity*=Math.max(0,Math.min(1,save.settings.teammateProjectileOpacity??.5));try{draw(w,r,power);}finally{r.worldOpacity=before;}};}
