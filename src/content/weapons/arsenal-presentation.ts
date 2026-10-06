import type { ArsenalSpec } from './refuge-arsenal';
import type { WeaponState } from '../../game/defs';
import type { Player } from '../../game/player';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { ProjBehavior } from '../../game/projectile';
import { getSprite } from '../../engine/sprites';
import { visualHandPos } from '../../game/weapon-pose';
import { heldLocalPoint, thrustExtension } from '../../game/weapon-presentation';
import { drawHeld, glowSprite, meleeRest, pixLine, swingPose } from './common';
import { shotFade } from './kit';
import { PIXELLAB_WEAPON_LAYOUT } from '../../ui/pixellab-weapon-layout';

/** Short, bounded trails: no particle spawning, RNG, damage or per-frame state. */
export function arsenalTrail(d: ArsenalSpec): ProjBehavior {
  return { id: `arsenal_trail_${d.id}`, draw(pr,r) {
    const c=Math.cos(pr.angle),s=Math.sin(pr.angle),len=Math.min(pr.traveled, d.id==='stormhorn_rod'?12:7);
    if(len<2)return;
    const x=pr.x,y=pr.y-pr.z;
    if(d.id==='stormhorn_rod') {
      const kink=Math.sin(pr.age*65)*2;
      pixLine(r,x-c*len,y-s*len,x-c*5-s*kink,y-s*5+c*kink,d.color,.45);
      pixLine(r,x-c*5-s*kink,y-s*5+c*kink,x,y,'#eaf5ff',.7);
    }else if(d.id==='cinder_sceptre'){
      for(let i=1;i<=3;i++)r.rect(x-c*i*3-s*Math.sin(pr.age*24+i),y-s*i*3+c*Math.sin(pr.age*24+i),1,1,i===1?'#ffe2a1':'#dc6c41',.6/i);
    }else if(d.id==='tide_staff'){
      r.ring(x-c*5,y-s*5,1.4,'#9ee9e4',1,.35);
    }else if(d.id==='moon_fan'||d.id==='glacier_arbalest'||d.id==='crescent_bow'){
      pixLine(r,x-c*len,y-s*len,x-c*3,y-s*3,d.color,.3);
    }
  }};
}

export function drawArsenal(d: ArsenalSpec, w: World, p: Player, r: Renderer, st: WeaponState, sprite: string, projectileSprite = 'shot_' + d.id): void {
  const thrust=d.shape==='rapier'||d.shape==='spear';
  const melee=thrust||['sabre','axe','mace','cleaver'].includes(d.shape);
  if(thrust){
    const ext=thrustExtension(w.time-(st.mem.shotAt??-9),d.shape==='rapier'?.18:.25);
    const angle=ext>0?(st.mem.attackAim??p.aim):p.aim+(Math.cos(p.aim)>=0?.2:-.2);
    drawHeld(r,p,sprite,angle,3+ext*(d.shape==='spear'?15:10),{flash:ext>.85?.22:0});return;
  }
  if(melee){
    const pose=swingPose(st,w,meleeRest(st,p.aim));
    drawHeld(r,p,sprite,pose.angle,pose.phase===1?7:5,{flash:pose.phase===1?.12:0});return;
  }
  const f=shotFade(st,w,.18),bow=d.shape==='bow',crossbow=d.shape==='crossbow',magic=d.shape==='staff'||d.shape==='wand';
  let angle=p.aim,dist=6;
  if(d.shape==='fan')angle+=(Math.cos(p.aim)<0?-1:1)*Math.sin(f*Math.PI)*.35;
  else if(d.shape==='knife')dist-=Math.sin(f*Math.PI)*5;
  else if(!bow){dist-=f*f*(magic?.7:crossbow?1.2:d.shape==='shotgun'?3.5:2);if(!magic&&!crossbow)angle+=(Math.cos(p.aim)<0?-1:1)*Math.sin(f*Math.PI)*.045;}
  drawHeld(r,p,sprite,angle,dist,{flash:!bow&&f>.85?.14:0});
  const h=visualHandPos(p,angle,dist),sp=getSprite(sprite);
  const layout=sprite.startsWith('pl_')?PIXELLAB_WEAPON_LAYOUT[d.id]:undefined;
  const point=(x:number,y:number)=>heldLocalPoint(h.x,h.y,angle,x,y);
  const tipX=layout?.muzzle?layout.muzzle[0]-sp.ox:sp.w-sp.ox-3;
  const tipY=layout?.muzzle?layout.muzzle[1]-sp.oy:0;
  const tip=point(tipX,tipY);
  if(bow && sprite.startsWith('pl_')){
    const pull=d.charge?st.charge:p.firing?1-Math.min(1,st.cooldown/Math.max(.01,st.mem.interval??.3)):0;
    const tips=layout!.bowTips!;
    const upper=point(tips[0][0]-sp.ox,tips[0][1]-sp.oy),lower=point(tips[1][0]-sp.ox,tips[1][1]-sp.oy),nock=point(tips[0][0]-sp.ox-pull*4+Math.sin(f*32)*f,0);
    pixLine(r,upper.x,upper.y,nock.x,nock.y,'#cabda7',.85);pixLine(r,lower.x,lower.y,nock.x,nock.y,'#cabda7',.85);
    if(p.firing&&f<.5)r.sprite(projectileSprite,nock.x+Math.cos(angle)*5,nock.y+Math.sin(angle)*5,{rot:angle});
  }
  if(st.charge>0){
    // Charge lives on the latch/head, never as a large ring around the keeper.
    const q=st.charge,pt=crossbow?point(6,0):tip;
    r.sprite(glowSprite(3+q*5,d.color),pt.x,pt.y,{alpha:q*.45,additive:true});
    if(crossbow)r.sprite('shot_'+d.id,pt.x-Math.cos(angle)*q*3,pt.y-Math.sin(angle)*q*3,{rot:angle,alpha:.35+q*.65});
    else r.rect(pt.x,pt.y,1,2,'#ffe6ae',q);
  }
  if(f<=0)return;
  if(magic){
    r.sprite(glowSprite(4+f*5,d.color),tip.x,tip.y,{alpha:f*.5,additive:true});
    if(d.id==='stormhorn_rod'){
      const a=point(tipX,tipY-4),b=point(tipX,tipY+4);pixLine(r,a.x,a.y,tip.x,tip.y,'#e9f6ff',f);pixLine(r,tip.x,tip.y,b.x,b.y,d.color,f);
    }
  }else if(!bow&&!crossbow&&d.shape!=='knife'&&d.shape!=='fan'&&f>.65){
    const end=point(tipX+f*(d.shape==='shotgun'?7:5),tipY);
    pixLine(r,tip.x,tip.y,end.x,end.y,'#ffe4a5',f);r.rect(tip.x-1,tip.y-1,2,2,'#fff2d3',f);
  }
}
