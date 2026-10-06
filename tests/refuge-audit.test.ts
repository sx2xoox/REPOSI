import { Artifacts } from '../src/game/defs';
import { Projectile } from '../src/game/projectile';
import './headless';
import { describe, it, expect } from 'vitest';
import { GlobalHooks, Characters } from '../src/game/defs';
import { measureDps } from './dpsharness';
import { save } from '../src/engine/save';
import { REFUGE_PASSIVES } from '../src/content/characters/refuge-kits';
import { REFUGE_UNLOCK_HINTS } from '../src/content/characters/refuge-unlocks';
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
 it('requires three unique challenge clears, never repeated events or normal rooms',()=>clean(()=>{
  const {world:w}=setup(),h=hook();
  w.node.kind='normal';for(let i=0;i<20;i++){w.node.id=i;h.onRoomClear!(w,1);}expect(save.hasFlag('unlock:tove')).toBe(false);
  w.node.kind='challenge';for(let i=20;i<22;i++){w.node.id=i;h.onRoomClear!(w,1);h.onRoomClear!(w,1);}expect(w.vars.rfChallengeRooms).toBe(2);expect(save.hasFlag('unlock:tove')).toBe(false);
  w.node.id=22;h.onRoomClear!(w,1);expect(save.hasFlag('unlock:tove')).toBe(true);
 }));
 it('requires overlapping statuses on twenty distinct enemies, not pellet or refresh count',()=>clean(()=>{
  const {world:w,dummies}=setup(),h=hook(),e=dummies[0];
  const hit={damage:10,kind:'projectile' as const,attacker:w.player};
  e.applyStatus({kind:'poison',duration:2},()=>0);h.onHit!(w,e,hit,1);expect(w.vars.rfReactionTargets).toBeUndefined();
  e.applyStatus({kind:'burn',duration:2},()=>0);for(let i=0;i<30;i++)h.onHit!(w,e,hit,1);expect(w.vars.rfReactionTargets).toBe(1);
  for(let i=1;i<20;i++){const target=w.spawnEnemy('__dps_dummy',e.x,e.y)!;target.applyStatus({kind:'poison',duration:2},()=>0);target.applyStatus({kind:'burn',duration:2},()=>0);h.onHit!(w,target,hit,1);}expect(save.hasFlag('unlock:luen')).toBe(true);
 }));
 it('empty-room releases and weapon switching do not count; both hit types must clear ten unique rooms',()=>clean(()=>{
  const {world:w,dummies}=setup(),h=hook(),e=dummies[0];
  w.node.cleared=true;h.onRelease!(w,1);h.onRoomClear!(w,1);expect(w.vars.rfReleaseRooms).toBeUndefined();
  for(let i=100;i<110;i++){w.node.id=i;h.onHit!(w,e,{damage:10,kind:'melee',attacker:w.player},1);h.onHit!(w,e,{damage:10,kind:'projectile',attacker:w.player},1);h.onRoomClear!(w,1);}
  expect(save.hasFlag('unlock:ves')).toBe(true);
 }));
 it('secret revisits are deduplicated across stages; third-floor boss is mandatory',()=>clean(()=>{
  const {world:w}=setup(),h=hook();w.node.kind='secret';
  for(let stage=1;stage<=3;stage++){w.run.stage=stage;h.onRoomEnter!(w,1);h.onRoomEnter!(w,1);}
  expect(w.vars.rfSecretRooms).toBe(3);expect(save.hasFlag('unlock:ort')).toBe(false);
  w.node.kind='boss';w.run.floor=2;h.onRoomClear!(w,1);expect(save.hasFlag('unlock:ort')).toBe(false);
  w.run.floor=3;h.onRoomClear!(w,1);expect(save.hasFlag('unlock:ort')).toBe(true);
 }));
 it('six combat releases must be in cleared distinct rooms before a third-floor boss',()=>clean(()=>{
  const {world:w}=setup(),h=hook();w.update(1/60);
  for(let i=200;i<206;i++){w.node.id=i;w.node.cleared=false;h.onRelease!(w,1);h.onRelease!(w,1);h.onRoomClear!(w,1);}
  expect(w.vars.rfReleaseRooms).toBe(6);expect(save.hasFlag('unlock:mira')).toBe(false);
  w.run.floor=3;w.node.kind='boss';w.node.id=300;h.onRoomClear!(w,1);expect(save.hasFlag('unlock:mira')).toBe(true);
 }));
 it('seeded practice never unlocks, and a fresh run does not inherit partial goals',()=>clean(()=>{
  const {world:w}=setup(),h=hook();w.run.seeded=true;w.node.kind='challenge';
  for(let i=0;i<3;i++){w.node.id=i;h.onRoomClear!(w,1);}expect(save.hasFlag('unlock:tove')).toBe(false);
  const next=setup().world;expect(next.vars.rfChallengeRooms).toBeUndefined();
 }));
 it('Mira records actual damage, excluding overkill and secondary effects',()=>{
  const {world:w,dummies}=setup(),p=REFUGE_PASSIVES[4];
  p.onHit!(w,dummies[0],{damage:10000,dealtDamage:2,kind:'melee',attacker:w.player},1);expect(w.vars.rfMiraStored).toBeCloseTo(.3);
  p.onHit!(w,dummies[0],{damage:10000,dealtDamage:10000,kind:'melee',noProc:true,attacker:w.player},1);expect(w.vars.rfMiraStored).toBeCloseTo(.3);
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
  b.onDash!(w,1);b.onAttack!(w,0,1);const sw=w.player.swing(w,{angle:0,damage:10});b.onSwing!(w,sw,1);expect(sw.o.damage).toBe(12);
  w.time+=1;b.onAttack!(w,0,1);const h={damage:sw.o.damage,kind:'melee' as const,attacker:w.player,source:sw};b.modifyHit!(w,w.player,h,1);expect(h.damage).toBe(12);
 });
 it('standing still enhances a fired shot; walking afterward cannot remove it',()=>{
  const {world:w}=setup(),b=Artifacts.must('bless_footing');w.vars.bfStill=1;
  const p=new Projectile({team:'player',x:0,y:0,angle:0,speed:100,damage:10});b.onShoot!(w,p,1);expect(p.damage).toBeCloseTo(11.8);
  w.vars.bfStill=0;const h={damage:p.damage,kind:'projectile' as const,attacker:w.player,source:p};b.modifyHit!(w,w.player,h,1);expect(h.damage).toBeCloseTo(11.8);
 });
 it('secondary shots cannot inherit attack-only bonuses',()=>{
  const {world:w}=setup();w.vars.baUntil=10;w.vars.bcUntil=10;w.vars.bfStill=1;w.vars.btUntil=10;
  for(const id of ['bless_afterstep','bless_crossstep','bless_footing','bless_thread']){
   const p=new Projectile({team:'player',x:0,y:0,angle:0,speed:100,damage:10});p.generation=1;Artifacts.must(id).onShoot!(w,p,1);expect(p.damage).toBe(10);expect(p.pierce).toBe(0);
  }
 });
});
