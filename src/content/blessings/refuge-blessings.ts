import { defineArtifact, Weapons, type ItemHooks } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { Projectile } from '../../game/projectile';
import { MeleeSwing } from '../../game/melee';
import { amplify, amplifyShot, amplifySwing, isPrimary, proc } from '../items/lib';
const specs:[string,string,string,string,ItemHooks][]=[
 ['bless_crossstep','교차하는 빛','다른 무기로 교체 후 첫 공격 피해 +35%. 발동 간격 1초.','#e4a3bc',{
  onAttack(w){w.vars.bcUntil=-1;const id=Weapons.all().findIndex(d=>d.id===w.player.weaponId);if(w.vars.bcWeapon!==undefined&&w.vars.bcWeapon!==id&&(w.vars.bcNext??0)<=w.time){w.vars.bcUntil=w.time+.2;w.vars.bcNext=w.time+1;proc(w,'bless_crossstep');}w.vars.bcWeapon=id;},
  onShoot(w,p,power){if(p.generation===0&&(w.vars.bcUntil??-1)>=w.time)amplifyShot(p,.35*Math.min(3,power));},
  onSwing(w,sw,power){if((w.vars.bcUntil??-1)>=w.time)amplifySwing(sw,.35*Math.min(3,power));},
  modifyHit(w,_t,h,power){if(isPrimary(h)&&!(h.source instanceof Projectile)&&!(h.source instanceof MeleeSwing)&&(w.vars.bcUntil??-1)>=w.time)amplify(h,.35*Math.min(3,power));},
  onRoomEnter(w){delete w.vars.bcWeapon;w.vars.bcUntil=-1;},
 }],
 ['bless_footing','굳건한 자리','0.6초 멈추면 직접 공격 피해 +20%. 이동을 시작해도 0.3초 동안 유지.','#ddb57d',{
  onUpdate(w,dt){const p=w.player,dx=p.x-(w.vars.bfX??p.x),dy=p.y-(w.vars.bfY??p.y);w.vars.bfStill=dx*dx+dy*dy<.01?(w.vars.bfStill??0)+dt:0;if(w.vars.bfStill>=.6)w.vars.bfReadyUntil=w.time+.3;w.vars.bfX=p.x;w.vars.bfY=p.y;},
  onShoot(w,p,power){if(p.generation===0&&(w.vars.bfReadyUntil??-1)>=w.time)amplifyShot(p,.2*Math.min(3,power));},
  onSwing(w,sw,power){if((w.vars.bfReadyUntil??-1)>=w.time)amplifySwing(sw,.2*Math.min(3,power));},
  modifyHit(w,_t,h,power){if(isPrimary(h)&&!(h.source instanceof Projectile)&&!(h.source instanceof MeleeSwing)&&(w.vars.bfReadyUntil??-1)>=w.time){amplify(h,.2*Math.min(3,power));proc(w,'bless_footing');}},
  onRoomEnter(w){w.vars.bfStill=0;w.vars.bfReadyUntil=-1;w.vars.bfX=w.player.x;w.vars.bfY=w.player.y;},
 }],
 ['bless_patient','기다림의 결실','충전 무기를 들면 피해 +20%, 넉백 +20%.','#a3c4e4',{
  stats(m,power,w){if(w?.player&&Weapons.get(w.player.weaponId)?.kind==='charge'){m.mulStat('damage',1+.2*Math.min(3,power));m.mulStat('knockback',1+.2*Math.min(3,power));}},
 }],
 ['bless_afterstep','도약의 여운','대시 후 2초 안에 시작한 첫 공격 피해 +25%. 발동 간격 1초.','#a5d5b5',{
  onDash(w){w.vars.baReady=w.time+2;},
  onAttack(w){w.vars.baUntil=-1;if((w.vars.baReady??-1)>w.time&&(w.vars.baNext??0)<=w.time){w.vars.baReady=-1;w.vars.baUntil=w.time+.2;w.vars.baNext=w.time+1;proc(w,'bless_afterstep');}},
  onShoot(w,p,power){if(p.generation===0&&(w.vars.baUntil??-1)>=w.time)amplifyShot(p,.25*Math.min(3,power));},
  onSwing(w,sw,power){if((w.vars.baUntil??-1)>=w.time)amplifySwing(sw,.25*Math.min(3,power));},
  modifyHit(w,_t,h,power){if(isPrimary(h)&&!(h.source instanceof Projectile)&&!(h.source instanceof MeleeSwing)&&(w.vars.baUntil??-1)>=w.time)amplify(h,.25*Math.min(3,power));},
  onRoomEnter(w){w.vars.baReady=-1;w.vars.baUntil=-1;w.vars.baNext=0;},
 }],
 ['bless_reaction','겹쳐진 흔적','서로 다른 상태이상이 2종 이상인 적에게 직접 공격 피해 +18%.','#b9a6e5',{
  modifyHit(w,t,h,power){if(isPrimary(h)&&t.statuses.size>=2){amplify(h,.18*Math.min(3,power));proc(w,'bless_reaction');}},
 }],
 ['bless_thread','꿰뚫는 실','네 번째 공격 강화: 탄환 관통 +2, 근접 사거리 +12, 직접 광선 피해 +25%.','#d5cf9a',{
  onAttack(w){w.vars.btCount=((w.vars.btCount??0)+1)%4;w.vars.btUntil=w.vars.btCount===0?w.time+.2:-1;},
  onShoot(w,p,power){if(p.generation===0&&(w.vars.btUntil??-1)>=w.time){p.pierce+=2*Math.min(3,power);proc(w,'bless_thread');}},
  onSwing(w,sw,power){if((w.vars.btUntil??-1)>=w.time){sw.o.reach+=12*Math.min(3,power);proc(w,'bless_thread');}},
  modifyHit(w,_t,h,power){if(isPrimary(h)&&h.kind==='laser'&&!(h.source instanceof Projectile)&&(w.vars.btUntil??-1)>=w.time){amplify(h,.25*Math.min(3,power));proc(w,'bless_thread');}},
  onRoomEnter(w){w.vars.btCount=0;w.vars.btUntil=-1;},
 }],
];
export const REFUGE_BLESSINGS=specs.map(([id,name,desc,color,hooks],i)=>{
 const icon='icon_'+id;defineDrawnSprite(icon,16,16,p=>{p.circle(8,8,7,'#393149');p.ring(8,8,7,1,'#d7b76d');if(i===0){p.line(4,5,12,5,color);p.line(4,11,12,11,color);p.px(12,6,color);p.px(4,10,color);}else if(i===1){p.rect(5,5,3,6,color);p.rect(4,11,9,2,color);}else if(i===2){p.ring(8,8,4,1,color);p.line(8,5,8,8,color);p.line(8,8,10,10,color);}else if(i===3){p.poly([4,11,8,4,12,11,8,9],color);}else if(i===4){p.circle(6,8,3,color);p.circle(10,8,3,'#8abfa3');}else{p.line(3,8,13,8,color);p.line(10,5,13,8,color);p.line(10,11,13,8,color);}p.px(4,3,'#ffedbb');},{outline:'#140c1c'});
 return defineArtifact({id,name,desc,quote:'빛마다 길이 있다.',icon,rarity:'rare',tags:[],pools:[],hidden:true,blessing:true,look:{orbit:color},...hooks});
});
