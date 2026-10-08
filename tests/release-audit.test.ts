import './headless';
import { expect, it } from 'vitest';
import { measureDps } from './dpsharness';
import { FIXED_DT } from '../src/game/constants';
import { HELD, PRESS } from '../src/game/seam';
import { RELEASE_COOLDOWN } from '../src/game/ember';
import { Projectile } from '../src/game/projectile';
import { payHeartCost, heartCostKind, heartCostText } from '../src/game/heart-cost';
import { Actives } from '../src/game/defs';

const SYNERGY = ['fallen_star','constellation_needle','comet_tail','star_chart','viper_fang','rot_mushroom','toad_idol','toxin_splitter','nightshade_wreath','copper_coil','static_cape','thunder_drum','stormcaller_rod','tempest_heart','bless_haste','bless_keen','bless_kindle','bless_hunter'];
const RECHARGE = ['bellows','fallen_star','ember_reservoir','twin_wick','bless_haste','bless_keen'];
function setup(artifacts: string[] = [], seed = 'RELEASE') {
  const result = measureDps({character:'niel',weapon:'void_gaze',seconds:0,artifacts,seed});
  const e=result.dummies[0]; e.def={...e.def,boss:true};
  return {...result, p:result.world.player, e};
}

it.each(['RELEASE-1','RELEASE-2','RELEASE-3'])('Niel star/venom/storm build leaves gaps between releases (%s)',seed=>{
  const {world:w,p}=setup(SYNERGY,seed);p.ember=100;
  const bot=w.inputSource!;w.inputSource=(ww,pp,out)=>{bot(ww,pp,out);if(pp.ember>=100)out.pressed|=PRESS.release;};
  const times:number[]=[];let n=0;
  for(let i=0;i<3600;i++){w.update(FIXED_DT);if(w.run.stats.releases>n){times.push(w.time);n=w.run.stats.releases;}}
  const gaps=times.slice(1).map((t,i)=>t-times[i]);
  // Before the fix this real synergy build released 38 times/minute (minimum 0.77s).
  expect(n).toBeGreaterThanOrEqual(3);expect(n).toBeLessThanOrEqual(12);
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(RELEASE_COOLDOWN);
  console.log(JSON.stringify({seed,releases:n,minGap:Math.min(...gaps),damage:w.run.stats.damageDealt}));
});

it('even extreme duplicate recharge items cannot overlap manual releases indefinitely',()=>{
  const {world:w,p}=setup(Array.from({length:3},()=>RECHARGE).flat());p.ember=100;
  const bot=w.inputSource!;w.inputSource=(ww,pp,out)=>{bot(ww,pp,out);if(pp.ember>=100)out.pressed|=PRESS.release;};
  for(let i=0;i<3600;i++)w.update(FIXED_DT);
  expect(w.run.stats.releases).toBeGreaterThan(5);expect(w.run.stats.releases).toBeLessThanOrEqual(15);
});

it('secondary shards and release hits do not refill the gauge; direct hits still do',()=>{
  const {world:w,p,e}=setup(['fallen_star','bellows']);w.update(FIXED_DT);p.ember=0;
  const shard=new Projectile({team:'player',owner:p,x:p.x,y:p.y,angle:0,speed:100,damage:10});shard.generation=1;
  w.applyHit(e,{damage:10,kind:'projectile',attacker:p,source:shard,crit:true});expect(p.ember).toBe(0);
  w.applyHit(e,{damage:10,kind:'explosion',attacker:p,noProc:true,release:true});expect(p.ember).toBe(0);
  w.applyHit(e,{damage:10,kind:'laser',attacker:p,crit:true});expect(p.ember).toBeGreaterThan(0);
});

it('instant gauge refill keeps its charge while waiting for release recovery',()=>{
  const {world:w,p}=setup();p.ember=100;p.release(w);p.ember=100;
  p.release(w);expect(w.run.stats.releases).toBe(1);expect(p.ember).toBe(100);
  for(let i=0;i<241;i++)p.update(w,FIXED_DT);
  p.release(w);expect(w.run.stats.releases).toBe(2);
});

it('boss crowd control interrupts briefly, then allows AI to resume despite repeated procs',()=>{
  const {world:w,e}=setup();
  expect(e.applyStatus({kind:'stun',duration:3},()=>0)).toBe(true);
  expect(e.statuses.get('stun')?.time).toBe(0.35);
  e.age+=0.4;e.updateStatuses(w,0.4);
  expect(e.applyStatus({kind:'freeze',duration:3},()=>0)).toBe(false);
  expect(e.hasStatus('freeze')||e.hasStatus('stun')).toBe(false);
  e.age+=2;expect(e.applyStatus({kind:'freeze',duration:3},()=>0)).toBe(true);
  e.applyStatus({kind:'slow',duration:3,power:0.85},()=>0);expect(e.statuses.get('slow')?.power).toBe(0.3);
  e.def={...e.def,boss:false};e.statuses.clear();
  expect(e.applyStatus({kind:'stun',duration:3},()=>0)).toBe(true);expect(e.statuses.get('stun')?.time).toBe(3);
});

it('heart prices remove actual maximum containers, even when containers come from items',()=>{
  const {world:w,p}=setup();p.baseHearts=1;w.items.give('rot_mushroom');
  const max=p.maxRed;expect(max).toBe(4);expect(heartCostKind(p,1)).toBe('max');
  expect(heartCostText(p,1)).toContain('최대');expect(payHeartCost(w,1)).toBe(true);expect(p.maxRed).toBe(max-2);
  p.soul=2;expect(heartCostKind(p,1)).toBe('soul');expect(payHeartCost(w,1)).toBe(true);expect(p.soul).toBe(0);expect(p.maxRed).toBe(2);
  expect(payHeartCost(w,1)).toBe(false);
  w.items.recompute();expect(p.maxRed).toBe(2);
});

it('oath dagger spends current health and leaves maximum health intact',()=>{
  const {world:w,p}=setup();const max=p.maxRed;p.red=max;p.soul=0;
  expect(Actives.must('oath_dagger').use(w)).not.toBe(false);
  expect(p.red).toBe(max-1);expect(p.maxRed).toBe(max);
});

it.each(['clockmaker','clockwork_dancer'])('late boss still performs attacks against the synergy build (%s)', id=>{
  const {world:w,p}=setup(SYNERGY,'BOSS-'+id);w.startFloor(7);
  const bossRoom=w.map.nodes.find(n=>n.kind==='boss')!;w.enterRoom(bossRoom,null);
  for(const e of [...w.enemies])e.dead=true;
  const boss=w.spawnEnemy(id,w.room.centerX+45,w.room.centerY)!;boss.dormant=0;
  w.bossIntro=null;p.x=w.room.centerX-45;p.y=w.room.centerY;p.ember=100;p.god=true;
  let shots=0;const spawn=w.spawn.bind(w);
  w.spawn=((e:any)=>{if(e instanceof Projectile&&e.team==='enemy')shots++;return spawn(e);}) as typeof w.spawn;
  w.inputSource=(_w,pp,out)=>{
    const dx=boss.x-pp.x,dy=boss.y-pp.y,d=Math.hypot(dx,dy)||1;
    out.mx=d>80?dx/d:d<45?-dx/d:0;out.my=d>80?dy/d:d<45?-dy/d:0;
    out.cx=boss.x;out.cy=boss.y;out.ax=out.ay=0;out.held=HELD.fire|HELD.cursorAim;
    out.pressed=pp.ember>=100?PRESS.release:0;
  };
  const start=w.time;let controlled=0,frames=0;
  while(boss.alive&&w.time-start<240&&frames<15000){w.update(FIXED_DT);frames++;if(boss.hasStatus('stun')||boss.hasStatus('freeze'))controlled++;}
  console.log(JSON.stringify({boss:id,seconds:w.time-start,dead:!boss.alive,shots,controlledFraction:controlled/frames,releases:w.run.stats.releases}));
  expect(shots).toBeGreaterThan(5);expect(controlled/frames).toBeLessThan(0.3);
  // power budget (2026-10-08): this proc-heavy build no longer melts a floor-7 boss whose skill the bot ignores
  expect(boss.alive).toBe(false);expect(w.time-start).toBeGreaterThan(30);expect(w.time-start).toBeLessThan(240);
});
