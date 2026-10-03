import './headless';
import {describe,it,expect} from 'vitest';
import {Characters,Weapons,Artifacts,GlobalHooks} from '../src/game/defs';
import {REFUGE_SPECS} from '../src/content/characters/refuge-keepers';
import {REFUGE_PASSIVES,RefugeTurret} from '../src/content/characters/refuge-kits';
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
 it('turrets are bounded, cannot recursively build or refill ember, and drawing does not alter simulation',()=>{
  const {world:w,dummies}=sim();idle(w,1);const pas=REFUGE_PASSIVES[0];
  for(let i=0;i<5;i++){for(let j=0;j<6;j++)pas.onHit!(w,dummies[0],hit(w),1);idle(w,100);}
  expect(w.entities.filter(e=>e instanceof RefugeTurret&&!e.dead).length).toBeLessThanOrEqual(2);
  const t=new RefugeTurret(w.player,w.player.x,w.player.y);w.spawn(t);idle(w,1);w.player.ember=0;const count=w.vars.rfToveHits;idle(w,60);expect(w.player.ember).toBe(0);expect(w.vars.rfToveHits).toBe(count);
  const before=stateHash(w);t.draw(w.renderer,w);expect(stateHash(w)).toBe(before);
 });
 it('all releases deal a bounded burst and produce no ember',()=>{for(const id of ids){const {world:w,dummies}=sim(id);idle(w,1);w.player.stats.critChance=0;w.player.aim=0;dummies[0].x=w.player.x+55;dummies[0].y=w.player.y;const hp=dummies[0].hp,base=w.player.stats.damage;w.player.ember=0;w.withIds(()=>w.player.character.release!(w,w.player));idle(w,240);const ratio=(hp-dummies[0].hp)/base;expect(ratio,id).toBeGreaterThanOrEqual(9.5);expect(ratio,id).toBeLessThanOrEqual(13);expect(w.player.ember,id).toBe(0);}});
 it('recording caps damage and secondary hits cannot refill the record',()=>{const {world:w,dummies}=sim('mira');const passive=REFUGE_PASSIVES[4];for(let i=0;i<100;i++)passive.onHit!(w,dummies[0],hit(w,100),1);expect(w.vars.rfMiraStored).toBe(w.player.stats.damage*3);idle(w,60);expect(w.vars.rfMiraStored).toBe(0);const shot=new Projectile({team:'player',x:0,y:0,angle:0,speed:100,damage:50});shot.generation=1;passive.onHit!(w,dummies[0],{...hit(w),source:shot,kind:'projectile'},1);expect(w.vars.rfMiraStored).toBe(0);});
 it('weapon swapping boosts only the next attack and keeps its projectile damage at long range',()=>{const {world:w}=sim('ves');const p=REFUGE_PASSIVES[2];p.onAttack!(w,0,1);w.player.equipWeapon(w,'lantern_bolt');p.onAttack!(w,0,1);const shot=new Projectile({team:'player',x:0,y:0,angle:0,speed:100,damage:10});p.onShoot!(w,shot,1);expect(shot.damage).toBe(13.5);p.onAttack!(w,0,1);const second=new Projectile({team:'player',x:0,y:0,angle:0,speed:100,damage:10});p.onShoot!(w,second,1);expect(second.damage).toBe(10);});
 it('return mark requires leaving and returning; standing on it cannot refresh the attack',()=>{const {world:w,dummies}=sim('ort');const p=REFUGE_PASSIVES[3];p.onRoomEnter!(w,1);const x=w.player.x;p.onUpdate!(w,.1,1);expect(w.vars.rfOrtReady).toBe(0);w.player.x=x+60;p.onUpdate!(w,.1,1);w.player.x=x;p.onUpdate!(w,.1,1);expect(w.vars.rfOrtReady).toBe(1);p.onAttack!(w,0,1);const h=hit(w);p.modifyHit!(w,dummies[0],h,1);expect(h.damage).toBe(14);p.onAttack!(w,0,1);const h2=hit(w);p.modifyHit!(w,dummies[0],h2,1);expect(h2.damage).toBe(10);});
 it('new blessings reject secondary damage and do not grant ember',()=>{const {world:w,dummies}=sim('luen');const p=w.player;for(const b of REFUGE_BLESSINGS){const h={...hit(w),noProc:true};b.modifyHit?.(w,dummies[0],h,1);expect(h.damage,b.id).toBe(10);expect(b.onRelease).toBeUndefined();}const b=Artifacts.must('bless_afterstep');b.onDash!(w,1);b.onAttack!(w,0,1);const pr=new Projectile({team:'player',x:0,y:0,angle:0,speed:100,damage:10});b.onShoot!(w,pr,1);expect(pr.damage).toBe(12);b.onAttack!(w,0,1);expect(w.vars.baUntil).toBe(-1);expect(p.ember).toBe(0);});
 for(const chars of [['tove','luen','ves','ort'],['mira','tove']])it('lockstep agrees with new keepers '+chars.join('/'),()=>{const r=runCoop({name:'refuge',seed:'REFUGE-COOP',chars,ms:14000,link:{latencyMs:45,jitterMs:20,drop:.05},bossAt:420,downAt:0,leaveAt:0,discardAt:0});const first=r.peers[0].hashes;for(const peer of r.peers){expect(peer.desyncs).toEqual([]);expect(peer.hashes.filter(x=>x!==undefined).length).toBeGreaterThan(250);for(let i=0;i<Math.min(first.length,peer.hashes.length);i++)if(first[i]!==undefined&&peer.hashes[i]!==undefined)expect(peer.hashes[i],`slot ${peer.slot} tick ${i}`).toBe(first[i]);}},30000);
 it('unlock goals reject seeded practice and persist normal-run achievements',()=>{const backup=structuredClone(save.progress);try{const {world:w,dummies}=sim();const h=GlobalHooks.must('refuge_keeper_unlocks');for(let i=0;i<12;i++)h.onRoomClear!(w,1);expect(save.hasFlag('unlock:tove')).toBe(false);w.run.seeded=false;h.onRoomClear!(w,1);expect(save.hasFlag('unlock:tove')).toBe(true);expect(save.hasFlag('unlock:ort')).toBe(true);for(let i=0;i<3;i++)h.onRelease!(w,1);expect(save.hasFlag('unlock:mira')).toBe(true);for(let i=0;i<8;i++){w.player.weaponId=i%2?'lantern_bolt':'iron_spear';h.onAttack!(w,0,1);}expect(save.hasFlag('unlock:ves')).toBe(true);for(const kind of ['burn','poison'] as const){dummies[0].applyStatus({kind,duration:2,power:1},()=>0);h.onHit!(w,dummies[0],{...hit(w),statuses:[{kind,duration:2}]},1);}expect(save.hasFlag('unlock:luen')).toBe(true);}finally{Object.assign(save.progress,backup);}});
 it('star, poison, lightning and new blessings keep every new weapon bounded',()=>{for(const d of ARSENAL){const r=measureDps({character:'niel',weapon:d.id,seconds:3,crowd:true,artifacts:['fallen_star','viper_fang','copper_coil','bless_reaction','bless_thread']});expect(Number.isFinite(r.damage),d.id).toBe(true);expect(r.world.entities.length,d.id).toBeLessThan(800);}});
 it('new kits stay deterministic when drawing at different rates and sizes',()=>{for(const character of ['tove','ort','mira'])checkScenario({name:character,seed:'REFUGE-DRAW-'+character,character,floors:[1],exploreSteps:1400,bossSteps:1500,giftsPerFloor:4,maxSteps:3600,cycle:true,extraEnemies:1},[NARROW]);},60000);

});
