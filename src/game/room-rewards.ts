import type { World } from './world';
import { Pedestal, Pickup, Chest } from './pickups';
import type { Entity } from './entity';

/** Treasure stock scales by party size; every keeper may take any reward set. */
export function scaleRewardRoom(w:World,entities:Entity[]){
 if(!w.coop||w.node.kind!=='treasure')return;
 const originals=entities.filter(e=>e instanceof Pedestal||e instanceof Pickup||e instanceof Chest) as (Pedestal|Pickup|Chest)[];
 if(!originals.length)return;
 for(let i=0;i<w.players.length;i++)for(let j=0;j<originals.length;j++){
  const original=originals[j];let e=original;
  if(i){
   if(original instanceof Pedestal){const q=new Pedestal(0,0,original.item?{...original.item}:null);q.price=original.price;q.heartPrice=original.heartPrice;q.group=original.group?original.group+i*1000:0;e=q;}
   else if(original instanceof Pickup){const q=new Pickup(original.kind,0,0);q.price=original.price;q.potionId=original.potionId;e=q;}
   else e=new Chest(0,0,original.locked);
   w.spawn(e);
  }
  const columns=Math.min(7,originals.length),col=j%columns,row=Math.floor(j/columns);
  const pos=w.room.nearestFree(w.room.centerX+(col-(columns-1)/2)*32,70+i*28+row*16,7);e.x=pos.x;e.y=pos.y;
 }
}
