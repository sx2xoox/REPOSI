import './headless';
import { expect,it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { RoomDevice } from '../src/content/rooms/mechanisms';
import { TrialAltar } from '../src/content/rooms/challenge';
import { WeaponChest } from '../src/content/weapons/drops';
import { Pedestal, Pickup } from '../src/game/pickups';
import { stateHash } from '../src/game/statehash';
import { endEncounter } from '../src/content/rooms/encounter-kit';
import { inBeam, vaultAlarm, beamDistance } from '../src/content/rooms/vault-alarm';
import { Entity } from '../src/game/entity';
import { runCoop } from './coopsim';
import { HuntDevice } from '../src/content/rooms/hunt';
loadContent();
function setup(kind:'relay'|'workshop'|'vault'|'hunt'|'elite'|'challenge',players=1){
 const run=new RunState('NEW-ROOMS','ria');run.staged=true;
 const w=new World(new Renderer(fakeDisplay(1280,720)),run,{openInventory(){},onGameOver(){}});
 if(players===1)w.start();else w.startParty(Array.from({length:players},(_,slot)=>({slot,characterId:'ria',name:'P'+slot})),0);
 const n=w.map.nodes.find(n=>n.id!==w.map.startId)!;n.kind=kind;n.templateId=['relay','workshop','vault'].includes(kind)?kind+'_alcove':kind==='hunt'?'hunt_den':kind==='elite'?'elite_arena':'';n.visited=false;n.cleared=false;w.enterRoom(n,null);
 for(const p of w.players)p.god=true;
 return w;
}
function use(w:World,d:RoomDevice|TrialAltar){w.player.x=d.x;w.player.y=d.y;return d.interact(w);}
function clearMobs(w:World){for(const e of w.enemies)e.dead=true;}
const isReward = (e:Entity): e is WeaponChest | Pedestal => e instanceof WeaponChest || e instanceof Pedestal && e.item?.kind === 'artifact';
for(const players of [1,4])it(`elite auto-starts once on entry for ${players} players and stays cleared on return`,()=>{
 const w=setup('elite',players),node=w.node,d=w.entities.find(e=>e instanceof TrialAltar) as TrialAltar;
 expect(d.state).toBe('active');expect(d.wave).toBe(1);expect(d.mem.pending).toBe(players===1?2:5);
 expect(w.node.cleared).toBe(false);expect(w.room.doors.some(door=>door.state==='closed')).toBe(true);
 expect(d.previewable()).toBe(false);expect(use(w,d)).toBe(false);expect(d.begin(w)).toBe(false);
 expect(d.mem.pending).toBe(players===1?2:5);
 for(const p of w.players){p.x=60+p.slot*15;p.y=50;}
 for(let i=0;i<1800&&!d.mem.used;i++){clearMobs(w);w.update(1/60);}
 w.update(1/60);expect(d.mem.used).toBe(true);expect(d.wave).toBe(3);expect(node.cleared).toBe(true);
 expect(w.room.doors.every(door=>door.state!=='closed')).toBe(true);
 const rewardIds=w.entities.filter(isReward).map(e=>e.id);expect(rewardIds).toHaveLength(players);
 w.enterRoom(w.map.nodes[w.map.startId],null);w.enterRoom(node,null);w.update(1/60);
 expect(d.state).toBe('done');expect(d.wave).toBe(3);expect(d.mem.pending).toBe(0);expect(w.enemies.filter(e=>e.alive)).toHaveLength(0);
 expect(w.entities.filter(isReward).map(e=>e.id)).toEqual(rewardIds);
 expect(w.room.doors.every(door=>door.state!=='closed')).toBe(true);
});
it('relay has grace, drains outside, restores inside and fails for exactly half a heart once',()=>{
 const w=setup('relay'),d=w.entities.find(e=>e instanceof RoomDevice) as RoomDevice;use(w,d);
 w.player.god=false;w.player.x=d.x+90;w.player.invuln=100;w.player.shields=2;const hp=w.player.red+w.player.soul;
 d.update(w,.9);expect(d.mem.charge).toBe(100);d.update(w,1);expect(d.mem.charge).toBe(88);
 w.player.x=d.x;d.update(w,.5);expect(d.mem.charge).toBe(91);
 w.player.x=d.x+90;d.update(w,10);expect(d.mem.phase).toBe(5);expect(w.player.red+w.player.soul).toBe(hp-1);d.update(w,20);expect(w.player.red+w.player.soul).toBe(hp-1);
 expect(use(w,d)).toBe(false);expect(w.entities.filter(isReward)).toHaveLength(0);
});
it('relay succeeds at all three stops and pays each participant exactly once',()=>{
 const w=setup('relay',4),d=w.entities.find(e=>e instanceof RoomDevice) as RoomDevice;use(w,d);
 for(let i=0;i<4500&&!d.mem.used;i++){w.players[0].x=d.x;w.players[0].y=d.y+12;clearMobs(w);w.update(1/60);}
 expect(d.mem.phase).toBe(4);expect(d.mem.progress).toBe(3);w.update(1/60);
 const rewards=w.entities.filter(isReward);expect(rewards).toHaveLength(4);expect(rewards.every(c=>c.mem.ownerSlot===undefined)).toBe(true);
});
it('workshop needs the correct colored valve within three seconds and no final-five-second event',()=>{
 const w=setup('workshop'),ds=w.entities.filter(e=>e instanceof RoomDevice) as RoomDevice[],d=ds[0],left=ds.find(e=>e.mem.index===1)!,right=ds.find(e=>e.mem.index===2)!;use(w,d);
 d.mem.event=1;d.mem.deadline=3;expect(use(w,left)).toBe(true);expect(d.mem.stability).toBe(3);
 d.mem.event=1;d.mem.deadline=3;expect(use(w,right)).toBe(true);expect(d.mem.stability).toBe(2);
 d.mem.event=2;d.mem.deadline=3;d.update(w,3.01);expect(d.mem.stability).toBe(1);
 d.mem.clock=55;d.mem.nextEvent=56;d.update(w,.1);expect(d.mem.event).toBe(0);
 d.mem.clock=59.95;d.update(w,.1);expect(d.mem.phase).toBe(4);
});
it('three errors end workshop, disable both valves and cannot grant a reward',()=>{
 const w=setup('workshop'),d=w.entities.find(e=>e instanceof RoomDevice) as RoomDevice;use(w,d);
 for(let i=0;i<3;i++){d.mem.event=1;d.mem.deadline=.01;d.update(w,.02);}
 expect(d.mem.phase).toBe(5);expect(d.previewable()).toBe(false);w.update(1/60);expect(w.entities.some(isReward)).toBe(false);
});
it('vault alarm: seeded per run, warning is harmless, a live beam hurts keepers and burns intruders, and it stops after the end',()=>{
 const w=setup('vault'),d=w.entities.find(e=>e instanceof RoomDevice) as RoomDevice;use(w,d);w.player.god=false;w.player.invuln=0;
 expect(d.mem.alarmSeed).toBeGreaterThan(0);
 const p=w.player,hp=p.red+p.soul;
 // stand on a beam of the cycle that fires at 1.8 s
 const fire=vaultAlarm(d.mem.alarmSeed,1.9,d.alarmBox(w)),l=fire.beams[0];
 p.x=(l.x0+l.x1)/2;p.y=(l.y0+l.y1)/2;
 d.mem.clock=1;d.update(w,.01);expect(p.red+p.soul).toBe(hp);
 for(const e of [...w.enemies])e.dead=true;
 const e=w.spawnEnemy('bone_walker',p.x+(l.y1-l.y0?0:24),p.y+(l.y1-l.y0?24:0))!;e.dormant=0;e.x=p.x;e.y=p.y;const ehp=e.hp;
 d.mem.clock=1.84;w.update(1/60);
 expect(inBeam(vaultAlarm(d.mem.alarmSeed,d.mem.clock,d.alarmBox(w)),p.x,p.y,p.r)).toBe(true);
 expect(p.red+p.soul).toBeLessThan(hp);expect(e.hp).toBeLessThan(ehp);
 const burned=e.hp;e.hp=Math.max(e.hp,1);w.update(1/60);expect(e.hp).toBe(burned);
 d.damageVault(w,100);expect(d.mem.phase).toBe(5);const after=p.red+p.soul;p.invuln=0;d.update(w,1);expect(p.red+p.soul).toBe(after);
 expect(beamDistance(l,(l.x0+l.x1)/2,(l.y0+l.y1)/2)).toBeLessThan(1);
});
it('vault enemies damage the objective and never require a match to operate',()=>{
 const w=setup('vault'),d=w.entities.find(e=>e instanceof RoomDevice) as RoomDevice;use(w,d);
 for(let i=0;i<2700&&!d.mem.used;i++)w.update(1/60);
 expect(d.mem.vaultHP).toBeLessThan(d.mem.vaultMax);expect(d.mem.phase).toBe(5);
});
for(const kind of ['elite','challenge'] as const)it(kind+' runs every wave and grants scaled freely claimable rewards',()=>{
 const w=setup(kind,2),d=w.entities.find(e=>e instanceof TrialAltar) as TrialAltar;
 expect(d.state).toBe(kind==='elite'?'active':'idle');
 if(kind==='challenge')use(w,d);else expect(d.wave).toBe(1);
 let eliteChecked=false;
 for(let i=0;i<3000&&!d.mem.used;i++){
  if(kind==='elite'&&w.enemies.length){const e=w.enemies[0];expect(e.scale).toBe(1.25);expect(e.maxHp).toBeGreaterThan(e.def.hp*3);eliteChecked=true;}
  clearMobs(w);w.update(1/60);
 }
 expect(d.wave).toBe(kind==='elite'?3:5);expect(d.mem.used).toBe(true);if(kind==='elite')expect(eliteChecked).toBe(true);w.update(1/60);
 if(kind==='challenge'){expect(w.entities.filter(e=>e instanceof WeaponChest)).toHaveLength(2);expect(w.entities.filter(e=>e instanceof Pedestal)).toHaveLength(4);}
 else expect(w.entities.filter(isReward)).toHaveLength(2);
});
it('rendering missions and valves never changes simulation hashes and no combat card hides enemies',async()=>{
 const {buildCard}=await import('../src/ui/item-tooltip');
 for(const kind of ['relay','workshop','vault'] as const){const w=setup(kind),d=w.entities.find(e=>e instanceof RoomDevice) as RoomDevice;expect(buildCard(w,d)?.desc).toBeTruthy();use(w,d);expect(d.previewable()).toBe(false);expect(buildCard(w,d)).toBeNull();const hash=stateHash(w);for(const e of w.entities)e.draw(w.renderer,w);expect(stateHash(w)).toBe(hash);}
});
it('a workshop run remains deterministic on a delayed, lossy two-player link',()=>{
 const result=runCoop({name:'workshop-v2',seed:'ROOM-COOP-V2',chars:['tove','mira'],ms:17000,link:{latencyMs:40,jitterMs:15,drop:.05},bossAt:0,downAt:0,leaveAt:0,discardAt:0,extraStep(w,tick){
  if(tick===5){const n=w.map.nodes.find(n=>n.id!==w.map.startId)!;n.kind='workshop';n.templateId='workshop_alcove';n.visited=false;n.cleared=false;w.enterRoom(n,null);}
  if(tick<6||w.node.kind!=='workshop')return;const d=w.entities.find(e=>e instanceof RoomDevice) as RoomDevice;
  if(tick===6){w.players[0].x=d.x;w.players[0].y=d.y;w.asPlayer(w.players[0],()=>d.interact(w));}
  if(tick%60===0)clearMobs(w);
  if(d.mem.event){const v=w.entities.find(e=>e instanceof RoomDevice&&e.mem.index===d.mem.event) as RoomDevice;w.players[0].x=v.x;w.players[0].y=v.y;w.asPlayer(w.players[0],()=>v.interact(w));}
 }});
 for(const peer of result.peers)expect(peer.desyncs).toEqual([]);
 const [a,b]=result.peers;for(let i=0;i<Math.min(a.hashes.length,b.hashes.length);i++)if(a.hashes[i]!==undefined&&b.hashes[i]!==undefined)expect(a.hashes[i]).toBe(b.hashes[i]);
},30000);

it('ending an encounter clears delayed attacks as well as live ones, preserving earned loot',()=>{
 const w=setup('workshop'),d=w.entities.find(e=>e instanceof RoomDevice) as RoomDevice;use(w,d);
 const hazard=w.spawn(new (class extends Entity {})());hazard.enemyHazard=true;
 const earned=w.spawn(new Pickup('coin',100,100));earned.encounterId=d.id;
 endEncounter(w,d,false);expect(hazard.dead).toBe(true);expect(earned.dead).toBe(false);
 expect(w.room.doors.every(door=>door.state!=='closed')).toBe(true);
});

it('elite damage is applied once for contact and projectile origins',()=>{
 const w=setup('elite'),p=w.player,e=w.spawnEnemy('cave_slime',100,100)!;expect(e).toBeTruthy();
 e.enemyDamageScale=1.5;p.god=false;p.soul=20;p.invuln=0;p.shields=0;
 expect(p.hurt(w,2,'정예 근접',false,e)).toBe(true);expect(p.soul).toBe(17);
 const shot=e.shoot(w,0,{damage:2});p.invuln=0;
 expect(p.hurt(w,shot.damage,'정예 탄환',false,shot)).toBe(true);expect(p.soul).toBe(14);
});

it('four peers finish the full sixty-second workshop with matching free rewards',()=>{
 const result=runCoop({name:'workshop-full',seed:'ROOM-FULL-COOP',chars:['ria','bern','serin','bori'],ms:72000,link:{latencyMs:35,jitterMs:15,drop:.03},bossAt:0,downAt:0,leaveAt:0,discardAt:0,stayInRoom:true,extraStep(w,tick){
  if(tick===5){const n=w.map.nodes.find(n=>n.id!==w.map.startId)!;n.kind='workshop';n.templateId='workshop_alcove';n.visited=false;n.cleared=false;w.enterRoom(n,null);}
  if(tick<6||w.node.kind!=='workshop')return;
  const d=w.entities.find(e=>e instanceof RoomDevice) as RoomDevice;
  for(const p of w.players){p.god=true;p.x=d.x;p.y=d.y+14;}
  if(tick===6)w.asPlayer(w.players[0],()=>d.interact(w));
  if(tick%120===0)clearMobs(w);
  if(d.mem.event){const v=w.entities.find(e=>e instanceof RoomDevice&&e.mem.index===d.mem.event) as RoomDevice;w.players[0].x=v.x;w.players[0].y=v.y;w.asPlayer(w.players[0],()=>v.interact(w));}
 }});
 for(const peer of result.peers){
  expect(peer.desyncs).toEqual([]);const d=peer.world.entities.find(e=>e instanceof RoomDevice) as RoomDevice;
  expect(d.mem.phase).toBe(4);const crates=peer.world.entities.filter(isReward);
  expect(crates).toHaveLength(4);expect(crates.every(e=>e.mem.ownerSlot===undefined)).toBe(true);
 }
 const first=result.peers[0];for(const peer of result.peers.slice(1))for(let i=0;i<Math.min(first.hashes.length,peer.hashes.length);i++)if(first.hashes[i]!==undefined&&peer.hashes[i]!==undefined)expect(first.hashes[i]).toBe(peer.hashes[i]);
},60000);

it('relay routes and workshop valves change from room to room and stay on open floor',()=>{
 const routes=new Set<string>(),valves=new Set<string>();
 for(let i=0;i<14;i++){
  const run=new RunState('ROUTES-'+i,'ria');run.staged=true;
  const w=new World(new Renderer(fakeDisplay(1280,720)),run,{openInventory(){},onGameOver(){}});w.start();
  for(const kind of ['relay','workshop'] as const){
   const n=w.map.nodes.find(n=>n.id!==w.map.startId&&n.id!==w.node.id&&!n.visited)!;n.kind=kind;n.templateId=kind+(i%2?'_gallery':'_alcove');n.visited=false;n.cleared=false;w.enterRoom(n,null);
   const ds=w.entities.filter(e=>e instanceof RoomDevice) as RoomDevice[],d=ds.find(e=>e.mem.index===0)!;
   if(kind==='relay'){
    const stops=[0,1,2].map(k=>[d.stopX(k),d.stopY(k)]);
    for(const [x,y] of stops)expect(w.room.boxBlocked(x,y,12,false,false)).toBe(false);
    routes.add(stops.map(s=>s.map(v=>Math.round(v-([w.room.centerX,w.room.centerY][s.indexOf(v)]))).join(',')).join('|'));
   }else valves.add(ds.filter(e=>e.mem.index>0).sort((a,b)=>a.mem.index-b.mem.index).map(v=>Math.round(v.x-w.room.centerX)+','+Math.round(v.y-w.room.centerY)).join('|'));
  }
 }
 expect(routes.size).toBeGreaterThan(5);expect(valves.size).toBeGreaterThan(3);
});

it('a workshop shift always brings temperature events, spaced and never in the last five seconds',()=>{
 for(const seed of ['EV-A','EV-B','EV-C']){
  const run=new RunState(seed,'ria');run.staged=true;
  const w=new World(new Renderer(fakeDisplay(1280,720)),run,{openInventory(){},onGameOver(){}});w.start();
  const n=w.map.nodes.find(n=>n.id!==w.map.startId)!;n.kind='workshop';n.templateId='workshop_alcove';n.visited=false;n.cleared=false;w.enterRoom(n,null);
  for(const p of w.players)p.god=true;
  const ds=w.entities.filter(e=>e instanceof RoomDevice) as RoomDevice[],d=ds[0];use(w,d);
  const starts:number[]=[];let open=0;
  for(let i=0;i<3700&&!d.mem.used;i++){
   clearMobs(w);w.update(1/60);
   if(d.mem.event&&!open){starts.push(d.mem.clock);const v=ds.find(e=>e.mem.index===d.mem.event)!;w.player.x=v.x;w.player.y=v.y;v.interact(w);}
   open=d.mem.event;
  }
  expect(starts.length,seed).toBeGreaterThanOrEqual(4);
  for(let i=1;i<starts.length;i++)expect(starts[i]-starts[i-1]).toBeGreaterThan(9);
  expect(Math.max(...starts)).toBeLessThan(55);
  expect(d.mem.phase).toBe(4);
 }
});

it('the hunt room builds its lamp tree and holds the room until it is used',()=>{
 const w=setup('hunt'),d=w.entities.find(e=>e instanceof HuntDevice) as HuntDevice;
 expect(d).toBeTruthy();expect(d.previewable()).toBe(true);w.update(1/60);expect(w.node.cleared).toBe(false);
 w.player.x=d.x;w.player.y=d.y+10;expect(d.interact(w)).toBe(true);expect(d.mem.phase).toBe(1);
 expect(w.room.doors.some(door=>door.state==='closed')).toBe(true);
 endEncounter(w,d,false);expect(w.node.cleared).toBe(true);expect(d.previewable()).toBe(false);
});
