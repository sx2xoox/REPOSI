import { drawReagentBurst, drawCrossBlades } from './refuge-burst-fx';
import { Entity } from '../../game/entity';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import { save } from '../../engine/save';
import { rayLength, segDist, pixLine } from '../weapons/common';
import { hasSprite } from '../../engine/sprites';
import { sceneSprite } from '../../ui/pixellab-scenery';

const COLORS=['#dba26a','#bba3e5','#ed9fa4','#91c6a3','#b3c9ee'];
/** Owned, fixed-step choreography. Damage never comes from draw callbacks. */
export class RefugeRelease extends Entity {
 owner:Player;
 mem:Record<string,number>;
 constructor(p:Player,mode:number,w:World,record=0){
  super();this.owner=p;this.x=p.x;this.y=p.y;this.layer=2;this.tileCollide=false;
  this.mem={mode,phase:0,damage:p.stats.damage,record,angle:p.aim,ax:p.x,ay:p.y,
   length:mode===3?rayLength(w,p.x,p.y,p.aim,160):0};
 }
 override update(w:World,dt:number){
  this.age+=dt;const p=this.owner,m=this.mem;
  if(!p.alive||p.downed){this.dead=true;return;}
  if(m.mode!==3){this.x=p.x;this.y=p.y;}
  if(m.mode===1&&m.phase===0&&this.age>=.26){
   m.phase=1;for(const e of [...w.enemies]){const d=Math.hypot(e.x-this.x,e.y-this.y);if(e.alive&&!e.hidden&&d<110+e.r&&rayLength(w,this.x,this.y,Math.atan2(e.y-this.y,e.x-this.x),d)>=d-e.r)w.applyHit(e,{damage:m.damage*11,kind:'explosion',attacker:p,noProc:true,release:true});}
   w.sfx('poison',{vol:.35});w.sfx('explosion',{vol:.32,pitch:1.35});
   if(!w.coop||p===w.local){w.renderer.screenFlash('#e5efb5',.14);w.shake(.18);}
  }
  if(m.mode===2){
   const times=[.04,.14,.24],mult=[3,3,5],offset=[-.25,.25,0];
   while(m.phase<3&&this.age>=times[m.phase]){const i=m.phase++;p.swing(w,{angle:m.angle+offset[i],arc:2.6,reach:115,damage:m.damage*mult[i],color:COLORS[2],noProc:true,release:true,reflect:true,swingDir:i%2?-1:1,visual:.14,style:'none',hitKick:i===2?2.2:.7});w.sfx(i===2?'swing_heavy':'swing',{vol:.35,pitch:i===2?.9:1.25});}
  }
  if(m.mode===3){
   while(m.phase<5&&this.age>=(m.phase+1)*.3){m.phase++;
    const bx=m.ax+Math.cos(m.angle)*m.length,by=m.ay+Math.sin(m.angle)*m.length;
    for(const e of [...w.enemies])if(e.alive&&!e.hidden&&segDist(e.x,e.y,m.ax,m.ay,bx,by).d<22+e.r)w.applyHit(e,{damage:m.damage*2.2,kind:'laser',attacker:p,noProc:true,release:true});
   }
  }
  if(m.mode===4&&m.phase===0&&this.age>=.18){m.phase=1;p.swing(w,{angle:m.angle,arc:1.8,reach:155,damage:m.damage*11+m.record,color:COLORS[4],noProc:true,release:true,reflect:false,style:'none'});w.sfx('paper_flutter',{vol:.4});}
  if(this.age>=[.6,.9,.65,1.7,.85][m.mode])this.dead=true;
 }
 override draw(r:Renderer,w:World){
  const before=r.worldOpacity;const opacity=w.coop&&this.owner!==w.local?Math.max(0,Math.min(1,save.settings.teammateProjectileOpacity??.5)):1;
  r.worldOpacity*=opacity;
  try{this.drawFx(r);}finally{r.worldOpacity=before;}
 }
 private drawFx(r:Renderer){
  const m=this.mem,t=this.age,c=COLORS[m.mode],x=this.x,y=this.y-6;
  if(m.mode===0){
   const a=Math.max(0,1-t/.6);r.ring(x+16,y+5,8+t*12,c,1,a*.5);
   for(let i=0;i<3;i++){const ang=i*Math.PI*2/3;pixLine(r,x+16+Math.cos(ang)*7,y+5+Math.sin(ang)*4,x+16+Math.cos(ang)*(10+t*10),y+5+Math.sin(ang)*(6+t*5),c,a);}
  }else if(m.mode===1){
   drawReagentBurst(r,x,y,t);
  }else if(m.mode===2){
   drawCrossBlades(r,x,y,t,m.angle);
  }else if(m.mode===3){
   const a=m.angle,cs=Math.cos(a),sn=Math.sin(a),fade=Math.min(1,t/.15)*Math.min(1,(1.7-t)/.2),progress=Math.min(1,t/.2);
   for(const side of [-1,1])pixLine(r,m.ax-sn*side*19,m.ay+cs*side*19,m.ax+cs*m.length*progress-sn*side*19,m.ay+sn*m.length*progress+cs*side*19,c,.32*fade);
   for(let i=1;i<=5;i++){const d=m.length*i/6,beat=Math.max(0,1-Math.abs(t-i*.3)/.16);r.sprite('refuge_road_rune',m.ax+cs*d,m.ay+sn*d,{alpha:(.4+beat*.6)*fade});}
  }else{
   const fade=Math.max(0,1-t/.85);for(let i=0;i<5;i++){const a=m.angle+(i-2)*.24,d=t<.18?14:14+141*(1-Math.pow(1-Math.min(1,(t-.18)/.2),2));
    r.sprite('refuge_record_page',x+Math.cos(a)*d,y+Math.sin(a)*d,{rot:a+Math.sin(t*10+i)*.15,alpha:fade});}
   if(t>=.18&&t<.48){const k=(t-.18)/.3;for(let j=0;j<24;j++){const a=m.angle-.9+j*.075,b=a+.075;pixLine(r,x+Math.cos(a)*155,y+Math.sin(a)*155,x+Math.cos(b)*155,y+Math.sin(b)*155,'#dce9ff',(1-k)*.6);}}
   if(t<.18)r.sprite(hasSprite('pl_prop_icon_mira_release')?sceneSprite('icon_mira_release'):'icon_mira_passive',x,y-23,{alpha:.8});
  }
 }
}
