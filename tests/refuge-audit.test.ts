import { Artifacts } from '../src/game/defs';
import { Projectile } from '../src/game/projectile';
import './headless';
import { describe, it, expect } from 'vitest';
import { RunState } from '../src/game/run';
import { World } from '../src/game/world';
import { Renderer } from '../src/engine/renderer';
import { FIXED_DT } from '../src/game/constants';
import { fakeDisplay } from './headless';
import { GlobalHooks, Characters } from '../src/game/defs';
import { measureDps } from './dpsharness';
import { save } from '../src/engine/save';
import { REFUGE_PASSIVES } from '../src/content/characters/refuge-kits';
import { LUEN_TRIPLE_KILLS, MIRA_SWIFT_ROOMS, MIRA_SWIFT_SECONDS, ORT_CLEAN_ROOMS, REFUGE_UNLOCK_HINTS, TOVE_EXPLOSION_KILLS, VES_DASH_KILLS } from '../src/content/characters/refuge-unlocks';
const hook = () => GlobalHooks.must('refuge_keeper_unlocks');
function setup() {
 const r = measureDps({character:'ria',weapon:'lantern_bolt',seconds:0});
 r.world.run.seeded=false;
 return r;
}
function clean(fn: () => void) {
 const old=structuredClone(save.progress);
 try { for(const id of ['tove','luen','ves','ort','mira'])save.progress.flags=save.progress.flags.filter(f=>f!=='unlock:'+id);fn(); }
 finally {Object.assign(save.progress,old);}
}
describe('refuge release audit',()=>{
 it('uses narrative hints with complete explicit requirements',()=>{
  for(const [i,id] of ['tove','luen','ves','ort','mira'].entries()){
   const c=Characters.must(id);expect(c.unlockHint).toBe(REFUGE_UNLOCK_HINTS[i]);expect(c.unlockHint).toMatch(/면,/);expect(c.unlockHint).toMatch(/다\.$/);expect(c.unlockRequirement).toContain('한 판');
  }
 });
 it('토브: explosion kills by the keeper, each enemy once; other kills and other hits do not count',()=>clean(()=>{
  const {world:w}=setup(),h=hook();
  const boom=(e:any)=>{e.hp=0;h.onHit!(w,e,{damage:10,kind:'explosion',attacker:w.player},1);};
  const mk=()=>w.spawnEnemy('__dps_dummy',w.room.centerX,w.room.centerY)!;
  const a=mk();boom(a);boom(a);expect(w.vars.rfExplosionKills).toBe(1);
  const b=mk();b.hp=0;h.onHit!(w,b,{damage:10,kind:'projectile',attacker:w.player},1);expect(w.vars.rfExplosionKills).toBe(1);
  const c=mk();h.onHit!(w,c,{damage:10,kind:'explosion',attacker:w.player},1);expect(w.vars.rfExplosionKills).toBe(1);
  const d=mk();d.hp=0;h.onHit!(w,d,{damage:10,kind:'explosion',attacker:null},1);expect(w.vars.rfExplosionKills).toBe(1);
  for(let i=1;i<TOVE_EXPLOSION_KILLS-1;i++)boom(mk());
  expect(save.hasFlag('unlock:tove')).toBe(false);
  boom(mk());expect(save.hasFlag('unlock:tove')).toBe(true);
 }));
 it('루엔: three kills inside one second make a knot; the next knot needs three fresh kills',()=>clean(()=>{
  const {world:w}=setup(),h=hook(),e=setup().dummies[0];
  const kill=(t:number)=>{w.time=t;h.onKill!(w,e as any,1);};
  kill(0);kill(0.6);kill(1.7);kill(2.2);expect(w.vars.rfKnots??0).toBe(0);
  kill(2.5);expect(w.vars.rfKnots).toBe(1);
  kill(2.6);kill(2.7);expect(w.vars.rfKnots).toBe(1);
  kill(2.8);expect(w.vars.rfKnots).toBe(2);
  for(let k=2;k<LUEN_TRIPLE_KILLS;k++){const t=10+k*5;kill(t);kill(t+0.1);expect(save.hasFlag('unlock:luen')).toBe(false);kill(t+0.2);}
  expect(save.hasFlag('unlock:luen')).toBe(true);
 }));
 it('베스: kills within a second of a dash count, later ones do not',()=>clean(()=>{
  const {world:w}=setup(),h=hook(),e=setup().dummies[0];
  w.time=5;h.onKill!(w,e as any,1);expect(w.vars.rfDashKills??0).toBe(0);
  w.time=10;h.onDash!(w,1);w.time=10.9;h.onKill!(w,e as any,1);w.time=11.2;h.onKill!(w,e as any,1);expect(w.vars.rfDashKills).toBe(1);
  for(let i=1;i<VES_DASH_KILLS;i++){w.time=20+i*3;h.onDash!(w,1);w.time+=0.3;expect(save.hasFlag('unlock:ves')).toBe(false);h.onKill!(w,e as any,1);}
  expect(save.hasFlag('unlock:ves')).toBe(true);
 }));
 // enter a room that is still hostile, optionally get hit / take time, then clear it
 function fightRoom(w:any,h:any,id:number,o:{hurt?:boolean;secs?:number}={}){
  w.node.id=id;w.node.kind='normal';w.node.cleared=false;
  h.onRoomEnter!(w,1);if(o.hurt)h.onHurt!(w,1,1);w.time+=o.secs??3;h.onRoomClear!(w,1);
 }
 it('오르트: hit-free combat rooms (each room once) and a third-floor boss',()=>clean(()=>{
  const {world:w}=setup(),h=hook();
  fightRoom(w,h,1,{hurt:true});expect(w.vars.rfCleanRooms??0).toBe(0);
  for(let i=2;i<2+ORT_CLEAN_ROOMS;i++)fightRoom(w,h,i);
  fightRoom(w,h,2);expect(w.vars.rfCleanRooms).toBe(ORT_CLEAN_ROOMS);
  // a peaceful room (nothing hostile at the door) is not a fight
  w.node.id=99;w.node.cleared=true;h.onRoomEnter!(w,1);h.onRoomClear!(w,1);expect(w.vars.rfCleanRooms).toBe(ORT_CLEAN_ROOMS);
  expect(save.hasFlag('unlock:ort')).toBe(false);
  w.node.kind='boss';w.node.id=300;w.run.floor=2;h.onRoomClear!(w,1);expect(save.hasFlag('unlock:ort')).toBe(false);
  w.node.id=301;w.run.floor=3;h.onRoomClear!(w,1);expect(save.hasFlag('unlock:ort')).toBe(true);
 }));
 it('미라: combat rooms cleared within the time limit and a third-floor boss',()=>clean(()=>{
  const {world:w}=setup(),h=hook();
  fightRoom(w,h,1,{secs:MIRA_SWIFT_SECONDS+0.5});expect(w.vars.rfSwiftRooms??0).toBe(0);
  for(let i=2;i<2+MIRA_SWIFT_ROOMS;i++)fightRoom(w,h,i,{secs:MIRA_SWIFT_SECONDS-1,hurt:true});
  expect(w.vars.rfSwiftRooms).toBe(MIRA_SWIFT_ROOMS);expect(save.hasFlag('unlock:mira')).toBe(false);
  w.run.floor=3;w.node.kind='boss';w.node.id=300;h.onRoomClear!(w,1);expect(save.hasFlag('unlock:mira')).toBe(true);
 }));
 it('in a real run: a blast kill, a kill after a dash and a fast hit-free combat room are all recorded',()=>clean(()=>{
  const run=new RunState('UNLOCK-REAL','ria');run.staged=true;
  const w=new World(new Renderer(fakeDisplay(1280,720)),run,{openInventory(){},onGameOver(){}});
  w.start();w.player.god=true;
  for(let i=0;i<30;i++)w.update(FIXED_DT);
  const node=w.map.nodes.find(n=>n.kind==='normal'&&!n.cleared)!;
  w.enterRoom(node,null);
  for(let i=0;i<40;i++)w.update(FIXED_DT);
  expect(w.vars.rfFight).toBe(1);
  const p=w.player;
  // a real keeper blast through World.explode
  const foe=w.enemies.find(e=>e.alive&&!e.isBoss)!;
  foe.x=p.x+6;foe.y=p.y+2;foe.vx=foe.vy=0;foe.hp=1;
  w.explode(p.x,p.y+2,38,60+p.stats.damage*2,{byPlayer:true});p.x+=60;
  for(let i=0;i<150&&foe.alive;i++)w.update(FIXED_DT);
  expect(foe.alive).toBe(false);expect(w.vars.rfExplosionKills).toBeGreaterThanOrEqual(1);
  // a real dash, then a kill right after it
  p.dashCD=0;expect(p.tryDash(w,{x:1,y:0})).toBe(true);
  const next=w.enemies.find(e=>e.alive&&!e.isBoss);
  if(next){w.killEnemy(next);expect(w.vars.rfDashKills).toBe(1);}
  // clear the rest: no hit was taken and it took well under the time limit
  for(const e of [...w.enemies])if(e.alive)w.killEnemy(e);
  for(let i=0;i<120&&!node.cleared;i++)w.update(FIXED_DT);
  expect(node.cleared).toBe(true);
  expect(w.vars.rfCleanRooms).toBe(1);expect(w.vars.rfSwiftRooms).toBe(1);
 }));
 it('seeded practice never unlocks, and a fresh run does not inherit partial goals',()=>clean(()=>{
  const {world:w}=setup(),h=hook();w.run.seeded=true;
  for(let i=0;i<TOVE_EXPLOSION_KILLS+2;i++){const e=w.spawnEnemy('__dps_dummy',w.room.centerX,w.room.centerY)!;e.hp=0;h.onHit!(w,e,{damage:10,kind:'explosion',attacker:w.player},1);}
  expect(save.hasFlag('unlock:tove')).toBe(false);
  const next=setup().world;expect(next.vars.rfExplosionKills).toBeUndefined();
 }));
 // Damage recording moved from Mira to Tove/Luen/Ves. Preserve the old
 // actual-damage/no-secondary guarantee for every current recording passive.
 it('damage-recording passives exclude overkill and secondary effects',()=>{
  for(const [index,key,factor] of [[0,'rfToveEnergy',.28],[1,'rfLuenPool',1],[2,'rfVesPool',.3]] as const){
   const {world:w,dummies}=setup(),p=REFUGE_PASSIVES[index];
   p.onHit!(w,dummies[0],{damage:1,dealtDamage:1,kind:'melee',attacker:w.player},1);
   p.onHit!(w,dummies[0],{damage:10000,dealtDamage:2,kind:'melee',attacker:w.player},1);expect(w.vars[key]).toBeCloseTo(2*factor);
   p.onHit!(w,dummies[0],{damage:10000,dealtDamage:10000,kind:'melee',noProc:true,attacker:w.player},1);expect(w.vars[key]).toBeCloseTo(2*factor);
  }
 });
});


describe('attack timing and charged weapon audit',()=>{
 it('tap spam is weaker than a full charge on both charged additions',()=>{
  for(const weapon of ['ember_musket','glacier_arbalest']){
   const full=measureDps({character:'ria',weapon,seconds:20}).dps;
   const tap=measureDps({character:'ria',weapon,seconds:20,fireCycle:{hold:.04,period:.24}}).dps;
   expect(tap,weapon).toBeLessThan(full*.8);
  }
 });
 it('the next-attack melee bonus is snapshotted before travel, not read at hit time',()=>{
  const {world:w}=setup();const b=Artifacts.must('bless_afterstep');
  b.onDash!(w,1);b.onAttack!(w,0,1);const sw=w.player.swing(w,{angle:0,damage:10});b.onSwing!(w,sw,1);expect(sw.o.damage).toBe(10);expect(sw.o.amp).toBeCloseTo(.25);
  w.time+=1;b.onAttack!(w,0,1);const h={damage:sw.o.damage,kind:'melee' as const,attacker:w.player,source:sw};b.modifyHit!(w,w.player,h,1);expect(h.damage).toBe(10);expect((h as {amp?:number}).amp??0).toBe(0);
 });
 it('standing still enhances a fired shot; walking afterward cannot remove it',()=>{
  const {world:w}=setup(),b=Artifacts.must('bless_footing');b.onUpdate!(w,.6,1);
  const p=new Projectile({team:'player',x:0,y:0,angle:0,speed:100,damage:10});b.onShoot!(w,p,1);expect(p.mem.amp).toBeCloseTo(.2);
  w.player.x+=2;w.time+=.31;b.onUpdate!(w,.31,1);const h={damage:p.damage,kind:'projectile' as const,attacker:w.player,source:p};b.modifyHit!(w,w.player,h,1);expect(h.damage).toBeCloseTo(10);expect((h as {amp?:number}).amp??0).toBe(0);expect(p.mem.amp).toBeCloseTo(.2);
 });
 it('secondary shots cannot inherit attack-only bonuses',()=>{
  const {world:w}=setup();w.vars.baUntil=10;w.vars.bcUntil=10;w.vars.bfStill=1;w.vars.btUntil=10;
  for(const id of ['bless_afterstep','bless_crossstep','bless_footing','bless_thread']){
   const p=new Projectile({team:'player',x:0,y:0,angle:0,speed:100,damage:10});p.generation=1;Artifacts.must(id).onShoot!(w,p,1);expect(p.damage).toBe(10);expect(p.pierce).toBe(0);
  }
 });
});
