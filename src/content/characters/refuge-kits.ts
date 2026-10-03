import { defineDrawnSprite } from '../../engine/sprites';
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
import { rayLength, segDist } from '../weapons/common';
import { releaseOpen, KitTimeline, everyTick } from './kit-common';
import { Projectile } from '../../game/projectile';
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
 override draw(r:Renderer,w:World){r.sprite('refuge_turret',this.x,this.y);if(this.mem.flash>0){const alpha=w.coop&&this.owner!==w.local?Math.max(0,Math.min(1,save.settings.teammateProjectileOpacity??.5)):1;r.line(this.x,this.y-6,this.mem.tx,this.mem.ty,'#f9dd9d',1,.6*alpha);}}
}
function directBurst(w:World,p:Player,color:string,mult:number,radius:number){releaseOpen(w,p,color,radius);for(const e of [...w.enemies])if(e.alive&&!e.hidden&&Math.hypot(e.x-p.x,e.y-p.y)<radius+e.r)w.applyHit(e,{damage:p.stats.damage*mult,kind:'explosion',attacker:p,noProc:true,release:true});}
export const REFUGE_PASSIVES:PassiveDef[]=[
 {name:'야전 공병',desc:'직접 적중 6회마다 5초 포탑을 설치한다. 최대 2개, 설치 간격 1.5초.',icon:'icon_tove_passive',
  onHit(w,_t,h){if(!isPrimary(h))return;w.vars.rfToveHits=(w.vars.rfToveHits??0)+1;if(w.vars.rfToveHits<6||(w.vars.rfToveNext??0)>w.time)return;w.vars.rfToveHits=0;w.vars.rfToveNext=w.time+1.5;const own=w.entities.filter(e=>e instanceof RefugeTurret&&e.owner===w.player&&!e.dead&&!e.mem.release);if(own.length>=2)own[0].dead=true;w.spawn(new RefugeTurret(w.player,w.player.x,w.player.y));},
  onRoomEnter(w){w.vars.rfToveHits=0;w.vars.rfToveNext=0;},
 },
 {name:'시약 반응',desc:'직접 적중에 독·화상을 번갈아 묻힌다. 두 효과가 만나면 반응, 대상당 1.2초.',icon:'icon_luen_passive',
  modifyHit(w,_t,h){if(!isPrimary(h))return;const n=(w.vars.rfLuenHit??0)+1;w.vars.rfLuenHit=n;h.statuses=[...(h.statuses??[]),{kind:n%2?'poison':'burn',duration:2,power:w.player.stats.damage*.015}];},
  onHit(w,t,h){if(!isPrimary(h)||!(t instanceof Enemy)||!t.alive||!t.hasStatus('poison')||!t.hasStatus('burn'))return;const key='rfLuenNext'+w.player.id;if((t.mem[key]??0)>w.time)return;t.mem[key]=w.time+1.2;w.applyHit(t,{damage:w.player.stats.damage*.45,kind:'status',attacker:w.player,noProc:true});w.spawn(new RingFx(t.x,t.y,15,.22,'#bba3e5',1));},
 },
 {name:'교차 박자',desc:'다른 무기로 바꿔 공격하면 0.2초간 직접 피해 +35%. 발동 간격 0.8초.',icon:'icon_ves_passive',
  onAttack(w){w.vars.rfVesUntil=-1;const now=Weapons.all().findIndex(d=>d.id===w.player.weaponId);if(w.vars.rfVesWeapon!==undefined&&w.vars.rfVesWeapon!==now&&(w.vars.rfVesNext??0)<=w.time){w.vars.rfVesUntil=w.time+.2;w.vars.rfVesNext=w.time+.8;}w.vars.rfVesWeapon=now;},
  onShoot(w,pr){if((w.vars.rfVesUntil??-1)>w.time)pr.damage*=1.35;},
  modifyHit(w,_t,h){if(isPrimary(h)&&!(h.source instanceof Projectile)&&(w.vars.rfVesUntil??-1)>w.time)h.damage*=1.35;},
  onRoomEnter(w){delete w.vars.rfVesWeapon;w.vars.rfVesUntil=-1;},
 },
 {name:'귀환 표식',desc:'표식에서 충분히 멀어졌다 돌아오면 다음 공격 피해 +40%.',icon:'icon_ort_passive',
  onRoomEnter(w){w.vars.rfOrtX=w.player.x;w.vars.rfOrtY=w.player.y;w.vars.rfOrtAway=0;w.vars.rfOrtReady=0;w.vars.rfOrtUntil=-1;},
  onUpdate(w){const p=w.player;if(w.vars.rfOrtX===undefined){w.vars.rfOrtX=p.x;w.vars.rfOrtY=p.y;}const d=Math.hypot(p.x-w.vars.rfOrtX,p.y-w.vars.rfOrtY);if(d>45)w.vars.rfOrtAway=1;if(d<14&&w.vars.rfOrtAway){w.vars.rfOrtReady=1;w.vars.rfOrtAway=0;}},
  onAttack(w){w.vars.rfOrtUntil=-1;if(w.vars.rfOrtReady){w.vars.rfOrtUntil=w.time+.2;w.vars.rfOrtReady=0;}},
  onShoot(w,pr){if((w.vars.rfOrtUntil??-1)>w.time)pr.damage*=1.4;},
  modifyHit(w,_t,h){if(isPrimary(h)&&!(h.source instanceof Projectile)&&(w.vars.rfOrtUntil??-1)>w.time)h.damage*=1.4;},
  draw(w,r){if(w.vars.rfOrtX!==undefined){r.ring(w.vars.rfOrtX,w.vars.rfOrtY,10,'#91c6a3',1,.6);r.line(w.vars.rfOrtX,w.vars.rfOrtY,w.vars.rfOrtX,w.vars.rfOrtY-10,'#dfcfac',1);}},
 },
 {name:'남겨진 문장',desc:'직접 피해의 15%를 기록한다. 0.7초 쉬면 기록탄 발사. 저장 최대 기본 피해 3배.',icon:'icon_mira_passive',
  onHit(w,_t,h){if(!isPrimary(h))return;w.vars.rfMiraStored=Math.min(w.player.stats.damage*3,(w.vars.rfMiraStored??0)+h.damage*.15);w.vars.rfMiraLast=w.time;},
  onAttack(w){w.vars.rfMiraLast=w.time;},
  onUpdate(w){if((w.vars.rfMiraStored??0)>0&&w.time-(w.vars.rfMiraLast??w.time)>.7){const dmg=w.vars.rfMiraStored;w.vars.rfMiraStored=0;fragment(w,w.player.x,w.player.y-5,w.player.aim,{damage:dmg,color:'#b3c9ee',pierce:1,range:w.player.stats.range,speed:260});}},
  onRoomEnter(w){w.vars.rfMiraStored=0;},
 },
];
export const REFUGE_DASHES:DashDef[]=[
 {name:'긴급 회수',desc:'대시하면 자신의 포탑을 도착 지점으로 회수한다.',icon:'icon_tove_dash',color:REFUGE_COLORS[0],end(w,p){let n=0;for(const e of w.entities)if(e instanceof RefugeTurret&&e.owner===p&&!e.dead){e.x=p.x+(n++%2?10:-10);e.y=p.y;}}},
 {name:'시약 발걸음',desc:'대시 후 2초 동안 첫 직접 적중에 약한 화상을 추가한다.',icon:'icon_luen_dash',color:REFUGE_COLORS[1],start(w){w.vars.rfLuenDash=w.time+2;}},
 {name:'빠른 이탈',desc:'짧은 재사용 대기시간으로 빠르게 이탈한다.',icon:'icon_ves_dash',color:REFUGE_COLORS[2],iframes:.09},
 {name:'길 다시 놓기',desc:'대시를 시작한 자리에 귀환 표식을 다시 놓는다.',icon:'icon_ort_dash',color:REFUGE_COLORS[3],start(w,p){w.vars.rfOrtX=p.x;w.vars.rfOrtY=p.y;w.vars.rfOrtAway=0;}},
 {name:'책갈피',desc:'대시하면 저장한 기록을 잃지 않고 즉시 기록탄으로 발사한다.',icon:'icon_mira_dash',color:REFUGE_COLORS[4],start(w,p){const d=w.vars.rfMiraStored??0;if(d>0){w.vars.rfMiraStored=0;fragment(w,p.x,p.y-5,p.aim,{damage:d,color:REFUGE_COLORS[4],range:p.stats.range,pierce:1});}}},
];
const luenModify=REFUGE_PASSIVES[1].modifyHit!;
REFUGE_PASSIVES[1].modifyHit=(w,t,h,power)=>{luenModify(w,t,h,power);if(isPrimary(h)&&(w.vars.rfLuenDash??-1)>w.time){w.vars.rfLuenDash=-1;h.statuses=[...(h.statuses??[]),{kind:'burn',duration:2,power:w.player.stats.damage*.06}];}};
export const REFUGE_RELEASES=[
 (w:World,p:Player)=>{releaseOpen(w,p,REFUGE_COLORS[0],80);for(const e of w.entities)if(e instanceof RefugeTurret&&e.owner===p&&e.mem.release)e.dead=true;w.spawn(new RefugeTurret(p,p.x+16,p.y,true));},
 (w:World,p:Player)=>{directBurst(w,p,REFUGE_COLORS[1],11,110);},
 (w:World,p:Player)=>{releaseOpen(w,p,REFUGE_COLORS[2],80);p.swing(w,{angle:p.aim,arc:2.6,reach:115,damage:p.stats.damage*11,color:REFUGE_COLORS[2],noProc:true,release:true,reflect:true});},
 (w:World,p:Player)=>{releaseOpen(w,p,REFUGE_COLORS[3],80);const ax=p.x,ay=p.y,bx=p.x+Math.cos(p.aim)*160,by=p.y+Math.sin(p.aim)*160;const damage=p.stats.damage;w.spawn(new KitTimeline(1.6,(ww,_t,dt,self)=>everyTick(self,'road',dt,.3,()=>{for(const e of [...ww.enemies])if(e.alive&&!e.hidden&&segDist(e.x,e.y,ax,ay,bx,by).d<22+e.r)ww.applyHit(e,{damage:damage*2.2,kind:'laser',attacker:p,noProc:true,release:true});}),{draw(r){r.line(ax,ay,bx,by,REFUGE_COLORS[3],3,.6);}}));},
 (w:World,p:Player)=>{releaseOpen(w,p,REFUGE_COLORS[4],80);p.swing(w,{angle:p.aim,arc:1.8,reach:155,damage:p.stats.damage*11,color:REFUGE_COLORS[4],noProc:true,release:true,reflect:false});w.vars.rfMiraStored=0;},
];
