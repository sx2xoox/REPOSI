import { defineWeapon, Weapons, type Rarity } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { attackInterval, attackInput, consumeAttack, chargeTime, O, startSwingPose, kick } from './common';
import { beginAttack } from './kit';
import { arsenalTrail, drawArsenal } from './arsenal-presentation';
import type { StatusApply, StatusKind } from '../../game/entity';
import { type PixelPainter, packColor, ramp } from '../../engine/painter';

type Shape = 'revolver'|'rifle'|'shotgun'|'bow'|'crossbow'|'sabre'|'rapier'|'axe'|'mace'|'spear'|'cleaver'|'fan'|'knife'|'wand'|'staff';
export interface ArsenalSpec { id:string; name:string; desc:string; shape:Shape; color:string; rarity:Rarity; rate:number; damage:number; reach?:number; arc?:number; pellets?:number; spread?:number; pierce?:number; bounce?:number; speed?:number; range?:number; status?:StatusKind; charge?:number; homing?:number; }
export const ARSENAL: readonly ArsenalSpec[] = [
 {id:'brass_revolver',name:'황동 리볼버',desc:'까마귀 부리 모양의 총구로 묵직한 한 발을 쏜다. 연사는 느리지만 탄속이 빠르다.',shape:'revolver',color:'#d9af69',rarity:'common',rate:.82,damage:1.22,speed:1.3},
 {id:'nail_carbine',name:'연발 못총',desc:'딱정벌레 등껍질 아래의 총열로 가벼운 못을 빠르게 연사한다.',shape:'rifle',color:'#78af94',rarity:'common',rate:1.55,damage:.65,speed:1.15},
 {id:'bell_blunderbuss',name:'종탑 산탄총',desc:'작은 종 모양의 총구에서 산탄 다섯 발을 넓게 쏜다. 가까이서 맞혀야 강하다.',shape:'shotgun',color:'#d6b67c',rarity:'rare',rate:.65,damage:.42,pellets:5,spread:.12,range:.82},
 {id:'ember_musket',name:'심지 화승총',desc:'누르면 화약을 준비하고 떼면 발사한다. 끝까지 누르면 자동으로 강한 관통탄을 쏜다.',shape:'rifle',color:'#e89461',rarity:'rare',rate:1,damage:1.95,pierce:1,charge:.58,speed:1.7},
 {id:'pearl_crossbow',name:'경량 쇠뇌',desc:'조개껍데기 활대에서 나란한 두 발을 쏜다. 짧은 거리에서 두 발을 모두 맞히기 쉽다.',shape:'crossbow',color:'#c7d5e2',rarity:'common',rate:.95,damage:.58,pellets:2,spread:.04,speed:1.15},
 {id:'crescent_bow',name:'초승달 장궁',desc:'초승달 모양의 활로 긴 사거리의 화살을 쏜다. 적 하나를 관통한다.',shape:'bow',color:'#b8abed',rarity:'common',rate:.9,damage:1.12,pierce:1,range:1.35,speed:1.25},
 {id:'thorn_shortbow',name:'장미 가시활',desc:'가시 화살을 빠르게 쏜다. 20% 확률로 2초간 약한 독을 남긴다.',shape:'bow',color:'#d887a4',rarity:'rare',rate:1.15,damage:.86,status:'poison',speed:1.2},
 {id:'glacier_arbalest',name:'빙하 중쇠뇌',desc:'누르면 장전하고 떼면 발사한다. 완충 시 자동 발사하며 적을 관통하고 잠시 느리게 한다.',shape:'crossbow',color:'#8dd6e8',rarity:'epic',rate:1,damage:2.1,charge:.58,pierce:2,status:'slow',speed:1.6},
 {id:'copper_sabre',name:'구리 곡도',desc:'꼬리처럼 휘어진 칼날로 빠르게 번갈아 벤다. 넓이와 속도가 균형 잡힌 검.',shape:'sabre',color:'#e4a56d',rarity:'common',rate:1.15,damage:.9,reach:36,arc:2.3},
 {id:'rose_rapier',name:'장미 가시검',desc:'장미 장식의 가는 검으로 빠르게 찌른다. 옆으로 비껴난 적에게는 닿지 않는다.',shape:'rapier',color:'#eaa2b9',rarity:'rare',rate:1.4,damage:.76,reach:45,arc:8},
 {id:'anchor_axe',name:'닻날 도끼',desc:'닻을 벼린 도끼를 넓게 휘두른다. 느리지만 적을 강하게 밀어낸다.',shape:'axe',color:'#85afb5',rarity:'rare',rate:.67,damage:1.57,reach:40,arc:2.8},
 {id:'cathedral_mace',name:'성당 철퇴',desc:'작은 종탑을 매단 철퇴로 후려친다. 넓게 맞히지만 다음 공격까지 시간이 걸린다.',shape:'mace',color:'#c0b0df',rarity:'epic',rate:.6,damage:1.75,reach:42,arc:2.9},
 {id:'comet_pike',name:'혜성 장창',desc:'별 꼬리 장식이 달린 긴 창. 일직선으로 멀리 찌르고 적을 꿰뚫는다.',shape:'spear',color:'#a7d8eb',rarity:'rare',rate:.8,damage:1.22,reach:62,arc:11},
 {id:'obsidian_cleaver',name:'흑요석 대도',desc:'검은 유리 칼날로 무겁게 벤다. 20% 확률로 2초간 약한 출혈을 남긴다.',shape:'cleaver',color:'#a293d2',rarity:'epic',rate:.72,damage:1.27,reach:43,arc:2.4,status:'bleed'},
 {id:'moon_fan',name:'달비늘 부채',desc:'부채를 펼쳐 세 개의 달비늘을 흩뿌린다. 비늘은 벽에 한 번 튕긴다.',shape:'fan',color:'#b6c9f0',rarity:'rare',rate:.85,damage:.44,pellets:3,spread:.1,bounce:1},
 {id:'dusk_knives',name:'투척 단검',desc:'날개 모양의 비수를 빠르게 던진다. 짧은 사거리에서 적 하나를 관통한다.',shape:'knife',color:'#c79fc6',rarity:'common',rate:1.35,damage:.76,pierce:1,range:.72},
 {id:'amber_wand',name:'호박석 마법봉',desc:'호박석 안의 작은 벌이 빛난다. 적을 약하게 따라가는 마법탄을 쏜다.',shape:'wand',color:'#edbc63',rarity:'common',rate:1,damage:.94,homing:1.6},
 {id:'tide_staff',name:'소라 지팡이',desc:'소라 끝에서 둥근 물탄 세 발을 넓게 쏜다. 맞은 적을 잠시 느리게 한다.',shape:'staff',color:'#80cfc8',rarity:'rare',rate:.85,damage:.45,pellets:3,spread:.1,status:'slow',speed:1},
 {id:'cinder_sceptre',name:'불꽃새 홀',desc:'새의 부리에서 붉은 불씨를 쏜다. 20% 확률로 2초간 약한 화상을 남긴다.',shape:'staff',color:'#f0a06c',rarity:'rare',rate:.9,damage:1.05,status:'burn',speed:1.15},
 {id:'stormhorn_rod',name:'폭풍 뿔지팡이',desc:'두 갈래 뿔에서 빠른 빛탄을 쏜다. 적 두 마리를 관통하고 벽에서 한 번 튕긴다.',shape:'wand',color:'#a8bafa',rarity:'epic',rate:.85,damage:1.2,pierce:2,bounce:1,speed:1.5},
];
const meleeShapes=new Set<Shape>(['sabre','rapier','axe','mace','spear','cleaver']);
/** Shared materials, separately shaped silhouettes; all point right from the grip. */
function paintWeapon(p:PixelPainter,d:ArsenalSpec,icon=false):void {
 const c=d.color,metal='#dce2df',shade='#4b445d',wood='#946548';
 const x=icon?1:3,y=icon?8:7,len=icon?11:d.shape==='revolver'?17:d.shape==='wand'?18:d.shape==='knife'?16:22;
 if(d.shape==='bow'){p.line(x,y,x+len,y,'#d6d8c5');}else{p.rect(x,y,Math.round(len*.7),2,wood);p.line(x,y,x+len*.6,y,'#d2a579');}
 switch(d.shape){
 case 'sabre':p.poly([x+4,y-2,x+len,y-5,x+len-2,y-1,x+6,y+1],c);p.line(x+6,y-2,x+len-2,y-4,metal);p.rect(x+4,y-3,1,6,shade);break;
 case 'rapier':p.line(x+4,y,x+len,y,metal);p.line(x+8,y+1,x+len-2,y+1,'#a6819c');p.ring(x+4,y,3,1,c);p.px(x+4,y-2,'#f4d3d0');p.rect(x,y+1,3,2,shade);break;
 case 'spear':p.line(x,y,x+len,y,wood);p.line(x,y-1,x+len-6,y-1,'#d6bc8b');p.poly([x+len-7,y-2,x+len+1,y,x+len-7,y+2],c);p.line(x+len-6,y-1,x+len,y,metal);p.line(x+len-8,y+1,x+len-12,y+4,'#777fbc');p.line(x+len-8,y+2,x+len-10,y+5,'#b1c5e7');break;
 case 'axe':p.poly([x+len-7,y-5,x+len,y-5,x+len-2,y+5,x+len-7,y+3],c);p.line(x+len,y-5,x+len-2,y+5,metal);break;
 case 'mace':p.rect(x+len-7,y-4,6,8,shade);p.rect(x+len-6,y-5,4,10,c);p.line(x+len-5,y-4,x+len-5,y+3,metal);break;
 case 'cleaver':p.poly([x+5,y-4,x+len,y-4,x+len-1,y+2,x+5,y+2],shade);p.line(x+6,y+2,x+len-1,y+2,c);p.px(x+len-3,y-2,metal);break;
 case 'bow':case 'crossbow':p.line(x+8,y-6,x+12,y,c);p.line(x+12,y,x+8,y+6,c);p.line(x+8,y-6,x+8,y+6,'#ddd3b9');if(d.shape==='bow')p.rect(x+1,y+1,5,1,shade);else p.rect(x+2,y+2,3,3,wood);break;
 case 'fan':p.poly([x+2,y,x+9,y-6,x+len,y-3,x+len,y+4,x+9,y+6],c);p.line(x+2,y,x+len,y,metal);p.line(x+2,y,x+len-2,y-3,shade);break;
 case 'knife':p.poly([x+4,y,x+len,y-4,x+len-4,y+1,x+len,y+4],c);p.line(x+5,y,x+len-4,y,metal);break;
 case 'wand':case 'staff':
  p.line(x,y+1,x+len-5,y+1,shade);p.line(x+2,y-1,x+len-6,y-1,'#bd956a');
  if(d.id==='amber_wand'){
   p.poly([x+len-8,y,x+len-6,y-5,x+len-2,y-4,x+len,y,x+len-3,y+4,x+len-6,y+3],'#976336');
   p.poly([x+len-6,y-3,x+len-3,y-3,x+len-2,y+1,x+len-5,y+2],c);p.px(x+len-5,y-2,'#fff4bf');p.px(x+len-4,y,'#76502e');
  }else if(d.id==='tide_staff'){
   p.poly([x+len-8,y+3,x+len-10,y-1,x+len-6,y-5,x+len-1,y-4,x+len+1,y,x+len-2,y+4],'#517c83');
   p.ellipse(x+len-5,y-1,4,4,'#e4ceaa');p.ring(x+len-5,y-1,3,1,'#a88777');p.px(x+len-4,y-1,shade);p.line(x+len-8,y+2,x+len-3,y+4,c);
  }else if(d.id==='cinder_sceptre'){
   p.poly([x+len-10,y+2,x+len-8,y-4,x+len-5,y-6,x+len-1,y-3,x+len+1,y-1,x+len-3,y+1,x+len-4,y+4],'#a86045');
   p.poly([x+len-8,y+1,x+len-6,y-4,x+len-3,y-3,x+len-4,y+2],c);p.px(x+len-4,y-3,'#fff0af');p.px(x+len-3,y-2,shade);p.line(x+len-7,y+2,x+len-9,y+5,'#d59057');
  }else{
   p.line(x+len-7,y-1,x+len-9,y-5,'#8b88b5');p.line(x+len-9,y-5,x+len-6,y-4,'#ded8e8');
   p.line(x+len-4,y+1,x+len-2,y+5,'#8b88b5');p.line(x+len-2,y+5,x+len+1,y+2,'#ded8e8');
   p.poly([x+len-7,y-1,x+len-4,y-3,x+len-2,y,x+len-5,y+2],c);p.line(x+len-6,y-1,x+len-4,y,'#fff2cd');
  }break;
 default:p.rect(x+2,y-3,len-4,4,shade);p.rect(x+4,y-4,len-7,3,c);p.rect(x+3,y+1,3,4,wood);p.rect(x+len-2,y-3,3,4,c);if(d.shape==='revolver')p.rect(x+5,y-2,4,4,metal);if(d.shape==='shotgun')p.rect(x+len-3,y-5,4,8,c);break;
 }
 // Authored silhouettes and material accents remain legible without relying on tint alone.
 if(d.id==='crescent_bow'){p.poly([x+7,y-6,x+11,y-4,x+13,y,x+11,y+4,x+7,y+6,x+9,y+2,x+10,y,x+9,y-2],c);p.px(x+9,y-4,'#f5e5c5');p.line(x+7,y-5,x+7,y+5,'#b7a884');}
 if(d.id==='pearl_crossbow'){p.ellipse(x+10,y-4,3,2,'#ded7c5');p.ellipse(x+10,y+4,3,2,'#a0b5c1');p.px(x+9,y-5,'#fff4df');p.rect(x+3,y,5,2,'#6e7b95');}
 if(d.id==='obsidian_cleaver'){p.line(x+6,y-3,x+len-4,y-3,'#676385');p.line(x+len-5,y-3,x+len-7,y,'#aeb1da');p.px(x+len-4,y-2,'#cec7e8');p.rect(x+4,y-3,2,6,'#b0905b');}
 if(d.id==='moon_fan'){for(let j=-1;j<=1;j++)p.line(x+3,y,x+len-2,y+j*4,'#6f7b9b');p.px(x+len-3,y-3,'#fff1c8');p.px(x+len-2,y+2,'#fff1c8');}

 const tip=x+len-3;
 if(d.id==='nail_carbine'){p.ellipse(x+7,y-3,4,2,c);p.line(x+7,y-4,x+7,y-2,shade);p.rect(x+6,y+2,4,3,shade);}
 if(d.id==='ember_musket'){p.line(x+4,y-5,x+6,y-5,wood);p.px(x+6,y-6,'#ffe4aa');p.px(x+4,y-2,'#f1c77b');}
 if(d.id==='brass_revolver'){p.poly([tip,y-3,tip+4,y-1,tip,y+1],c);p.px(x+6,y-1,shade);}
 if(d.id==='bell_blunderbuss'){p.line(tip,y-4,tip,y+3,'#fff0ba');p.line(x+5,y-2,tip-2,y-2,wood);}
 if(d.id==='glacier_arbalest'){p.poly([x+8,y-6,x+11,y-4,x+8,y-2],c);p.line(x+2,y-1,x+7,y-1,metal);}
 if(d.id==='thorn_shortbow'){p.px(x+10,y-3,'#efb9c5');p.px(x+12,y+3,'#efb9c5');p.px(x+9,y-4,'#789368');}
 if(d.id==='anchor_axe'){p.line(tip-2,y+1,tip-6,y+5,c);p.line(tip-6,y+5,tip-8,y+3,c);}
 if(d.id==='cathedral_mace'){p.rect(tip-4,y-3,2,4,shade);p.px(tip-3,y-5,metal);}




 // Material planes: top-left gleam, a cool lower bevel, restrained wood grain.
 const src=p.data.slice(),mid=packColor(c),woodKey=packColor(wood),darkKey=packColor(shade),tones=ramp(c,5,.8).map(packColor);
 const at=(xx:number,yy:number)=>xx<0||yy<0||xx>=p.w||yy>=p.h?0:src[yy*p.w+xx];
 for(let yy=0;yy<p.h;yy++)for(let xx=0;xx<p.w;xx++){
  const key=yy*p.w+xx;
  if(src[key]===mid){
   if(at(xx,yy-1)!==mid&&at(xx,yy+1)===mid)p.data[key]=tones[3];
   else if(at(xx,yy+1)!==mid&&at(xx,yy-1)===mid)p.data[key]=tones[1];
   else if(at(xx-1,yy)!==mid&&at(xx+1,yy)===mid)p.data[key]=tones[3];
  }else if(src[key]===woodKey&&yy%3===0&&xx%4!==0)p.data[key]=packColor('#bc8c62');
  else if(src[key]===darkKey&&at(xx,yy-1)!==darkKey&&at(xx,yy+1)===darkKey)p.data[key]=packColor('#777082');
 }
}
for(const d of ARSENAL){
 const melee=meleeShapes.has(d.shape),thrust=d.shape==='rapier'||d.shape==='spear';
 const trail=arsenalTrail(d);
 if(!melee)defineDrawnSprite('shot_'+d.id,13,9,p=>{
  const c=d.color;
  switch(d.id){
   case 'nail_carbine':p.rect(2,2,1,5,'#939d9c');p.line(3,4,10,4,'#e1e8d8');p.px(11,4,'#fff2ce');break;
   case 'dusk_knives':p.rect(1,4,3,1,'#765179');p.line(4,2,4,6,c);p.poly([5,2,12,4,5,6],'#c8c4db');p.line(6,3,10,4,'#f4e3ec');break;
   case 'pearl_crossbow':p.line(2,4,10,4,'#8c7157');p.poly([9,2,12,4,9,6],'#ebe8cf');p.line(1,2,3,4,c);p.line(1,6,3,4,c);break;
   case 'crescent_bow':p.line(1,4,10,4,'#c3bcca');p.poly([8,1,12,4,8,7,9,4],c);p.px(11,4,'#fff4e4');break;
   case 'thorn_shortbow':p.line(1,4,10,4,'#779554');p.poly([8,2,12,4,8,6],'#a7b577');p.px(5,3,'#d8849e');p.px(3,5,'#d8849e');break;
   case 'glacier_arbalest':p.poly([1,4,8,1,12,4,8,7],c);p.line(4,4,11,4,'#e7ffff');p.line(8,2,10,4,'#bdeefd');break;
   case 'moon_fan':p.poly([3,1,9,1,12,4,9,7,3,7,7,4],c);p.line(9,2,11,4,'#f4f4ff');break;
   case 'amber_wand':p.poly([3,4,6,1,10,2,12,4,10,7,6,7],c);p.line(6,2,9,2,'#fff0b2');p.px(8,4,'#916235');break;
   case 'tide_staff':p.circle(7,4,3,'#387d94');p.circle(7,4,2,c);p.line(6,2,8,2,'#d3f7ed');p.px(9,5,'#b0ece1');break;
   case 'cinder_sceptre':p.poly([0,2,5,3,4,0,9,2,12,4,9,6,4,8,5,5,0,6],'#bc5037');p.poly([3,4,8,2,11,4,8,6],c);p.line(7,4,10,4,'#fff1b1');break;
   case 'stormhorn_rod':p.poly([1,5,6,1,5,4,11,2,9,5,12,5,5,8,7,5],c);p.line(5,4,10,3,'#f0f8ff');break;
   case 'bell_blunderbuss':p.circle(7,4,2,'#8d7455');p.px(7,3,'#f3d6a0');break;
   case 'ember_musket':p.poly([1,4,7,2,11,4,7,6],'#b65e3d');p.line(5,4,10,4,'#ffe2a0');break;
   default:p.rect(4,3,6,3,c);p.line(5,3,9,3,'#fff0c9');p.px(10,4,'#c39757');
  }
 },{outline:O});
 defineDrawnSprite('w_'+d.id,29,15,p=>paintWeapon(p,d),{outline:O,origin:[5,7]});
 defineDrawnSprite('icon_'+d.id,16,16,p=>paintWeapon(p,d,true),{outline:O});
 defineWeapon({id:d.id,name:d.name,desc:d.desc,icon:'icon_'+d.id,heldSprite:'w_'+d.id,kind:melee?'melee':d.charge?'charge':'ranged',rarity:d.rarity,pools:['treasure','shop','boss'],
  archetype:melee?(thrust?'창':'검·둔기'):d.shape==='bow'||d.shape==='crossbow'?'활·쇠뇌':d.shape==='staff'||d.shape==='wand'?'마법봉':'사격',
  tags:melee?[thrust?'spear':'blade',...(d.rate<.8?['heavy']:[])]:d.shape==='bow'||d.shape==='crossbow'?['bow']:d.shape==='staff'||d.shape==='wand'?['arcane','staff']:['gun'],
  // the per-hit factor (x pellets) lives on the weapon's sheet, so the status panel, the power
  // readout and pedestal comparisons show the real damage; attacks divide it back out
  stats(m){m.mulStat('fireRate',d.rate);m.mulStat('damage',d.damage*(d.pellets??1));},
  update(w,p,st,dt,firing,aim){
   if(st.cooldown>0)return;
   let power=1;
   if(d.charge){
    if(firing)st.charge=Math.min(1,st.charge+dt/chargeTime(p,d.charge));
    if((firing&&st.charge<1)||(!firing&&st.charge<=0))return;
    power=.15+.85*st.charge*st.charge;st.charge=0;
   }else if(!attackInput(st,w,firing))return;
   consumeAttack(st);beginAttack(w,p,st,aim);st.cooldown=attackInterval(p,d.charge?.48:1);st.combo++;st.mem.attackAim=aim;st.mem.interval=st.cooldown;
   const s=p.weaponStats,base=s.damage/(d.damage*(d.pellets??1)),color=d.color,statuses:StatusApply[]=d.status?[{kind:d.status,duration:2,power:d.status==='slow'?.25:base*.06,chance:d.status==='slow'?1:.2}]:[];
   if(melee){const dir=st.combo%2?1:-1;p.swing(w,{angle:aim,damage:s.damage,thrust,reach:(d.reach??35)+s.range*.025,arc:d.arc??2.3,color,knockback:s.knockback*(d.rate<.8?3:1.5),statuses,swingDir:dir,visual:thrust?.16:d.rate<.8?.22:.18});if(!thrust)startSwingPose(st,w,aim-1.1*dir,aim+1.3*dir,d.rate<.8?.12:.075,d.rate<.8?.075:.035);w.sfx(d.rate<.8?'swing_heavy':'swing',{vol:.5,pitch:d.rate});}
   else {
    const n=d.pellets??1;for(let i=0;i<n;i++)p.fireProjectiles(w,aim+(i-(n-1)/2)*(d.spread??0),{damageMult:power/n,color,speed:s.shotSpeed*(d.speed??1),range:s.range*(d.range??1),pierce:s.pierce+(d.pierce??0)+(p.flags.has('pierceAll')?99:0),bounce:s.bounce+(d.bounce??0),homing:s.homing+(d.homing??0),statuses,style:'sprite',sprite:'shot_'+d.id,spriteRotates:true,behaviors:[trail],radius:Math.max(1.2,s.projSize*(n>1?.75:1))});
    if(d.shape==='shotgun'||d.id==='ember_musket')kick(w,aim+Math.PI,.7);else if(d.shape==='revolver')kick(w,aim+Math.PI,.35);w.sfx(d.shape==='bow'||d.shape==='crossbow'||d.shape==='knife'?'shoot_arrow':d.shape==='wand'||d.shape==='staff'||d.shape==='fan'?'shoot_magic':'shoot',{vol:.4,pitch:d.rate});
   }
  },
  onHolster(_w,_p,st){st.charge=0;},
  draw(w,p,r,st){drawArsenal(d,w,p,r,st,Weapons.get(d.id)?.heldSprite??'w_'+d.id);},
 });
}
