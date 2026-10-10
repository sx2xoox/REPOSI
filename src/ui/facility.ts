import type { Scene } from './scene';
import type { GameScene } from './game-scene';
import type { Renderer } from '../engine/renderer';
import { UI_W, UI_H } from '../engine/renderer';
import { input } from '../engine/input';
import { app } from '../game/app';
import { Weapons, Artifacts, RARITY_NAME } from '../game/defs';
import { applyFacility, facilityBlock, facilityCost, facilityFingerprint, fusionMaterials, TEMPER_RESULTS, type Facility, type FacilityCommand } from '../game/facilities';
import { frame, spriteCentered, fitScale } from './frame';
import { C } from './theme';

export class FacilityOverlay implements Scene {
 transparent=true;touchBack='close' as const;
 private mode:'weapon'|'artifact'='weapon';private selected:number[]=[];private page=0;private cursor=0;private armed=false;private time=0;
 private readonly fingerprint:string;private readonly materials:string[];private readonly floor:number;private readonly stage:number;private readonly room:number;
 private buttons:{x:number;y:number;w:number;h:number;label:string;fn:()=>void;selected?:boolean;disabled?:boolean}[]=[];
 constructor(private game:GameScene,private facility:Facility){const w=game.world;this.fingerprint=facilityFingerprint(w.local);this.materials=w.asPlayer(w.local,()=>fusionMaterials(w));this.floor=w.run.floor;this.stage=w.run.stage;this.room=w.node.id;}
 private chosen(){return this.mode==='artifact'?this.selected.map(i=>this.materials[i]):[];}
 private block(){const w=this.game.world;if(facilityFingerprint(w.local)!==this.fingerprint)return '장비가 바뀌었습니다. 설비를 다시 열어 주세요';if(this.mode==='artifact'&&this.selected.length!==2)return '유물 두 개를 선택하세요';return w.asPlayer(w.local,()=>facilityBlock(w,this.facility,this.chosen()));}
 private confirm(){if(this.block())return;if(!this.armed){this.armed=true;return;}const cmd:FacilityCommand={type:'facility',floor:this.floor,stage:this.stage,room:this.room,entity:this.facility.id,fingerprint:this.fingerprint,materials:this.chosen()};if(this.game.online)this.game.command(cmd);else applyFacility(this.game.world,cmd);this.game.closeOverlay(this);}
 update(dt:number){this.time+=dt;const w=this.game.world;
  if(w.run.floor!==this.floor||w.run.stage!==this.stage||w.node.id!==this.room||this.facility.dead||this.facility.mem['used:'+w.local.slot]){this.game.closeOverlay(this);return;}
  if(input.pressed('cancel')||input.pressed('pause')){this.game.closeOverlay(this);return;}
  if(this.time<.2)return;
  if(input.pressed('uiDown')||input.pressed('uiRight'))this.cursor=(this.cursor+1)%Math.max(1,this.buttons.length);
  if(input.pressed('uiUp')||input.pressed('uiLeft'))this.cursor=(this.cursor+this.buttons.length-1)%Math.max(1,this.buttons.length);
  const m=app.renderer.displayToUI(input.mouseX,input.mouseY);
  const hovered=this.buttons.findIndex(b=>m.x>=b.x&&m.x<=b.x+b.w&&m.y>=b.y&&m.y<=b.y+b.h);
  if(input.mouseMoved&&hovered>=0)this.cursor=hovered;
  if(input.pressed('fire')&&hovered>=0){const b=this.buttons[hovered];if(!b.disabled)b.fn();}
  else if(input.pressed('confirm')){const b=this.buttons[this.cursor];if(b&&!b.disabled)b.fn();}
 }
 draw(r:Renderer){
  r.beginUI();r.uiRect(0,0,UI_W,UI_H,'#0b0912',.8);
  const x=(UI_W-650)/2,y=30,w=this.game.world,p=w.local,f=this.facility;
  frame(r,x,y,650,372,'panel');r.uiText(f.kind==='refinery'?'불꽃 앞의 선택':f.kind==='well'?'기억을 바꾸는 우물':'두 조각, 새로운 형태',x+24,y+19,{size:22,bold:true,color:C.goldHi});
  r.uiText('각자 1회 · 작업 확정 전에는 재료와 동전이 소비되지 않습니다',x+24,y+52,{size:10,font:'small',color:C.textDim});
  this.buttons=[];
  const button=(label:string,bx:number,by:number,bw:number,fn:()=>void,selected=false,disabled=false)=>{const i=this.buttons.length;this.buttons.push({x:bx,y:by,w:bw,h:30,label,fn,selected,disabled});frame(r,bx,by,bw,30,selected||i===this.cursor?'buttonHi':'button',{alpha:disabled?.45:1});r.uiText(label,bx+bw/2,by+9,{size:10,font:'small',align:'center',color:disabled?C.textMute:selected?C.goldHi:C.text});};
  const def=Weapons.get(p.weaponId);
  if(def){spriteCentered(r,def.icon,x+64,y+116,fitScale(def.icon,42,3));r.uiText(def.name,x+105,y+91,{size:14,bold:true,color:C.text});r.uiText('현재 무기 · '+RARITY_NAME[def.rarity]+' · 제련 '+(p.weapon.mem.temper??0),x+105,y+114,{size:10,font:'small',color:C.textDim});}
  const cost=facilityCost(f.kind,w.floor.index);r.uiText(`비용 동전 ${cost}개   /   가진 동전 ${p.coins}개`,x+618,y+82,{size:10,font:'small',align:'right',color:C.gold});
  if(f.kind==='fusion'){
   button('무기 2개',x+24,y+151,115,()=>{this.mode='weapon';this.armed=false;},this.mode==='weapon');
   button('유물 2개',x+149,y+151,115,()=>{this.mode='artifact';this.armed=false;},this.mode==='artifact');
   if(this.mode==='weapon'){
    const second=p.weapon2Id?Weapons.get(p.weapon2Id):null;
    if(second)spriteCentered(r,second.icon,x+62,y+226,fitScale(second.icon,30,2));
    r.uiText('보조무기 · '+(second?.name??'없음'),x+102,y+213,{size:12,bold:true,color:C.text});
    r.uiText('두 무기가 사라지고 한 등급 높은 무기 1개를 장착합니다.',x+102,y+234,{size:10,font:'small',color:C.textDim});
    r.uiText('새 무기는 제련되지 않은 상태입니다.',x+102,y+253,{size:10,font:'small',color:C.textDim});
   }else{
    const pages=Math.max(1,Math.ceil(this.materials.length/6));this.page=Math.min(this.page,pages-1);
    for(let j=0;j<6;j++){const idx=this.page*6+j,id=this.materials[idx];if(!id)break;const d=Artifacts.must(id);button(d.name,x+24+(j%3)*201,y+191+Math.floor(j/3)*38,190,()=>{this.armed=false;if(this.selected.includes(idx))this.selected=this.selected.filter(i=>i!==idx);else if(this.selected.length<2)this.selected.push(idx);},this.selected.includes(idx));}
    button('이전',x+424,y+151,58,()=>{this.page=(this.page+pages-1)%pages;});button(`${this.page+1}/${pages} 다음`,x+490,y+151,136,()=>{this.page=(this.page+1)%pages;});
    if(!this.materials.length)r.uiText('합성 가능한 유물이 없습니다.',x+30,y+217,{size:12,color:C.textDim});
    r.uiText('선택한 유물의 능력·공명이 사라집니다. 체력 증가 유물은 최대 체력도 줄어듭니다.',x+24,y+274,{size:10,font:'small',color:'#eab0a1'});
   }
  }else if(f.kind==='refinery'){
   r.uiText('새 결과가 기존 제련을 대체합니다. 낮은 단계가 나올 수도 있습니다.',x+24,y+157,{size:12,color:C.textDim});
   TEMPER_RESULTS.forEach((v,i)=>{const bx=x+24+i*102;frame(r,bx,y+194,94,76,'panel');r.uiText((v.step>0?'+':'')+v.step,bx+47,y+205,{size:20,bold:true,align:'center',color:v.step>0?'#a9debf':'#ebaaa2'});r.uiText(`${100+v.step*10}% 피해`,bx+47,y+235,{size:10,font:'small',align:'center',color:C.textDim});r.uiText(v.chance+'%',bx+47,y+253,{size:10,font:'small',align:'center',color:C.gold});});
   r.uiText('무기 고유 피해에만 적용 · 유물의 추가 공격과 캐릭터 해방은 제외',x+24,y+283,{size:10,font:'small',color:C.textFaint});
  }else{
   r.uiText('90%  같은 등급의 다른 무기',x+30,y+174,{size:18,bold:true,color:'#a6dbe0'});
   r.uiText('10%  우물의 축복 · 한 등급 상승',x+30,y+207,{size:18,bold:true,color:C.goldHi});
   r.uiText(def?.rarity==='legendary'?'전설 무기: 100% 같은 등급의 다른 무기로 교환합니다.':'결과는 확정할 때 결정됩니다. 기존 무기는 사라집니다.',x+30,y+249,{size:12,color:C.textDim});
   r.uiText('새 무기는 제련되지 않은 상태입니다.',x+30,y+272,{size:10,font:'small',color:C.textFaint});
  }
  const block=this.block();if(block)r.uiText(block,x+24,y+310,{size:10,font:'small',color:'#efb0a0'});
  button('돌아가기',x+24,y+329,116,()=>this.game.closeOverlay(this));
  button(this.armed?'재료 소비 확인 · 실행':'작업 내용 확인',x+356,y+329,270,()=>this.confirm(),this.armed,!!block);
 }
}
