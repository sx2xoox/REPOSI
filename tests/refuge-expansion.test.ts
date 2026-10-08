import './headless';
import {describe,it,expect} from 'vitest';
import {Characters,Weapons,Artifacts,GlobalHooks} from '../src/game/defs';
import {REFUGE_SPECS} from '../src/content/characters/refuge-keepers';
import {REFUGE_PASSIVES,REFUGE_DASHES,RefugeCharge,RefugeSupport,RefugeGuard,RefugeSeal} from '../src/content/characters/refuge-kits';
import {REFUGE_BLESSINGS} from '../src/content/blessings/refuge-blessings';
import {ARSENAL} from '../src/content/weapons/refuge-arsenal';
import {validateSpec} from '../src/content/characters/look';
import {getSprite,hasAnim} from '../src/engine/sprites';
import {measureDps,PLAIN_ID,bestDps} from './dpsharness';
import {FIXED_DT} from '../src/game/constants';
import {Projectile} from '../src/game/projectile';
import {stateHash} from '../src/game/statehash';
import {runCoop} from './coopsim';
import {save} from '../src/engine/save';
import {NARROW,checkScenario} from './detsim';
import type {World} from '../src/game/world';
import type {HitInfo} from '../src/game/entity';
const ids=['tove','luen','ves','ort','mira'];
const sim=(id='tove',weapon=Characters.must(id).weapon)=>measureDps({character:id,weapon,seconds:0,dist:55});
function idle(w:World,n:number){w.inputSource=(_w,_p,o)=>{o.mx=o.my=o.ax=o.ay=o.held=o.pressed=0;};for(let i=0;i<n;i++)w.update(FIXED_DT);}
const hit=(w:World,damage=10):HitInfo=>({damage,kind:'melee',attacker:w.player});
describe('refuge expansion',()=>{
 it('registers 5 complete keepers, 20 distinct weapons and 6 blessings with valid native art',()=>{
  expect(REFUGE_SPECS).toHaveLength(5);expect(ARSENAL).toHaveLength(20);expect(REFUGE_BLESSINGS).toHaveLength(6);
  for(const s of REFUGE_SPECS){expect(validateSpec(s),s.prefix).toEqual([]);const c=Characters.must(s.prefix);expect(Weapons.has(c.weapon)).toBe(true);expect(c.unlocked).toBe(false);for(const f of ['down','side','up'])expect(hasAnim(`${s.prefix}_walk_${f}`)).toBe(true);expect(getSprite(c.portrait).w).toBeGreaterThan(0);}
  for(const d of ARSENAL){expect(Weapons.must(d.id).pools).toContain('shop');expect(getSprite('w_'+d.id).w).toBeGreaterThan(0);expect(getSprite('icon_'+d.id).w).toBeGreaterThan(0);}
  for(const b of REFUGE_BLESSINGS){expect(b.blessing).toBe(true);expect(b.look).toBeDefined();}
 });
 it('all new starting kits deal damage without runaway primary proc amplification',()=>{const base=bestDps(PLAIN_ID,'lantern_bolt');for(const id of ids){const ratio=bestDps(id,Characters.must(id).weapon)/base;expect(ratio,id).toBeGreaterThan(.85);expect(ratio,id).toBeLessThan(2);}});
 // The old turret is replaced by charges/mines; retain its boundedness, terminal
 // damage, no-ember and render-purity guarantees instead of retaining its job.
 it('charges and mines are bounded, cannot recursively build or refill ember, and drawing is pure',()=>{
  // a weapon outside 토브's favoured class: no relayed charges, two mines (affinity: tests/affinity-c)
  const {world:w,dummies}=sim('tove','lantern_bolt');idle(w,1);const pas=REFUGE_PASSIVES[0];
  for(let i=0;i<30;i++)pas.onHit!(w,dummies[0],hit(w),1);
  idle(w,1);expect(w.entities.filter(e=>e instanceof RefugeCharge&&!e.dead)).toHaveLength(1);
  const energy=w.vars.rfToveEnergy,hp=dummies[0].hp;w.player.ember=0;
  const charge=w.entities.find(e=>e instanceof RefugeCharge)!;
  const before=stateHash(w);charge.draw(w.renderer,w);expect(stateHash(w)).toBe(before);
  idle(w,70);expect(dummies[0].hp).toBeLessThan(hp);expect(w.player.ember).toBe(0);expect(w.vars.rfToveEnergy).toBe(energy);
  expect(w.entities.filter(e=>e instanceof RefugeCharge&&!e.dead)).toHaveLength(0);
  for(let i=0;i<5;i++){REFUGE_DASHES[0].start!(w,w.player);idle(w,15);}
  expect(w.entities.filter(e=>e instanceof RefugeCharge&&!e.dead&&e.mem.mine)).toHaveLength(2);
 });
 it('all releases deal a bounded burst and produce no ember',()=>{for(const id of ids){const {world:w,dummies}=sim(id);idle(w,1);w.player.stats.critChance=0;w.player.aim=0;dummies[0].x=w.player.x+55;dummies[0].y=w.player.y;const hp=dummies[0].hp,base=w.player.stats.damage;w.player.ember=0;w.withIds(()=>w.player.character.release!(w,w.player));idle(w,240);const ratio=(hp-dummies[0].hp)/base;expect(ratio,id).toBeGreaterThanOrEqual(9.5);expect(ratio,id).toBeLessThanOrEqual(13);expect(w.player.ember,id).toBe(0);}});
 it('Mira places one seal without stopping, and secondary hits cannot refresh it',()=>{
  const {world:w,dummies}=sim('mira');idle(w,1);const passive=REFUGE_PASSIVES[4];
  w.player.x-=5;for(let i=0;i<100;i++)passive.onHit!(w,dummies[0],hit(w,100),1);
  idle(w,1);const seals=w.entities.filter(e=>e instanceof RefugeSeal&&!e.dead) as RefugeSeal[];expect(seals).toHaveLength(1);
  const until=seals[0].mem.until,hp=dummies[0].hp;w.player.ember=0;idle(w,105);expect(dummies[0].hp).toBeLessThan(hp);expect(w.player.ember).toBe(0);
  const shot=new Projectile({team:'player',x:0,y:0,angle:0,speed:100,damage:50});shot.generation=1;
  passive.onHit!(w,dummies[0],{...hit(w),source:shot,kind:'projectile'},1);expect(seals[0].mem.until).toBe(until);
  idle(w,90);expect(w.entities.some(e=>e instanceof RefugeSeal&&!e.dead)).toBe(false);
 });
 it('Ves provides offhand support without swapping, with no recursive support or ember',()=>{
  const {world:w,dummies}=sim('ves');idle(w,1);w.player.weapon2Id='lantern_bolt';const p=REFUGE_PASSIVES[2];
  p.onHit!(w,dummies[0],hit(w),1);idle(w,1);const support=w.entities.find(e=>e instanceof RefugeSupport) as RefugeSupport;
  expect(support.mem.family).toBe(1);const pool=w.vars.rfVesPool,hp=dummies[0].hp;w.player.ember=0;
  idle(w,50);expect(dummies[0].hp).toBeLessThan(hp);expect(w.vars.rfVesPool).toBe(pool);expect(w.player.ember).toBe(0);
  expect(w.entities.some(e=>e instanceof RefugeSupport&&!e.dead)).toBe(false);
 });
 it('Ort owns one directional guard and parking never creates or refills a second shield',()=>{
  const {world:w}=sim('ort');idle(w,2);const guards=()=>w.entities.filter(e=>e instanceof RefugeGuard&&!e.dead);
  expect(guards()).toHaveLength(1);const guard=guards()[0] as RefugeGuard;w.vars.rfOrtCharges=1;
  REFUGE_DASHES[3].start!(w,w.player);const x=guard.x;w.player.x-=30;idle(w,30);
  expect(guards()).toHaveLength(1);expect(guard.x).toBe(x);expect(w.vars.rfOrtCharges).toBe(1);
  idle(w,45);expect(guard.x).not.toBe(x);expect(w.vars.rfOrtCharges).toBe(1);
 });
 it('new blessings reject secondary damage and do not grant ember',()=>{const {world:w,dummies}=sim('luen');const p=w.player;for(const b of REFUGE_BLESSINGS){const h={...hit(w),noProc:true};b.modifyHit?.(w,dummies[0],h,1);expect(h.damage*(1+(h.amp??0)),b.id).toBe(10);expect(b.onRelease).toBeUndefined();}const b=Artifacts.must('bless_afterstep');b.onDash!(w,1);b.onAttack!(w,0,1);const pr=new Projectile({team:'player',x:0,y:0,angle:0,speed:100,damage:10});b.onShoot!(w,pr,1);expect(pr.damage).toBe(10);expect(pr.mem.amp).toBeCloseTo(.25);b.onAttack!(w,0,1);expect(w.vars.baUntil).toBe(-1);expect(p.ember).toBe(0);});
 for(const chars of [['tove','luen','ves','ort'],['mira','tove']])it('lockstep agrees with new keepers '+chars.join('/'),()=>{const r=runCoop({name:'refuge',seed:'REFUGE-COOP',chars,ms:14000,link:{latencyMs:45,jitterMs:20,drop:.05},bossAt:420,downAt:0,leaveAt:0,discardAt:0});const first=r.peers[0].hashes;for(const peer of r.peers){expect(peer.desyncs).toEqual([]);expect(peer.hashes.filter(x=>x!==undefined).length).toBeGreaterThan(250);for(let i=0;i<Math.min(first.length,peer.hashes.length);i++)if(first[i]!==undefined&&peer.hashes[i]!==undefined)expect(peer.hashes[i],`slot ${peer.slot} tick ${i}`).toBe(first[i]);}},30000);
 it('star, poison, lightning and new blessings keep every new weapon bounded',()=>{for(const d of ARSENAL){const r=measureDps({character:'niel',weapon:d.id,seconds:3,crowd:true,artifacts:['fallen_star','viper_fang','copper_coil','bless_reaction','bless_thread']});expect(Number.isFinite(r.damage),d.id).toBe(true);expect(r.world.entities.length,d.id).toBeLessThan(800);}});
 it('new kits stay deterministic when drawing at different rates and sizes',()=>{for(const character of ['tove','ort','mira'])checkScenario({name:character,seed:'REFUGE-DRAW-'+character,character,floors:[1],exploreSteps:1700,bossSteps:1500,giftsPerFloor:4,maxSteps:3600,cycle:true,extraEnemies:1},[NARROW]);},60000);

});
