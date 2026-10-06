import { describe, expect, it, vi } from 'vitest';
import { BossBeam } from '../src/content/bosses/laser-patterns';
import { MeleeSwing, reflectProjectile } from '../src/game/melee';
import { Projectile } from '../src/game/projectile';
import type { Enemy } from '../src/game/enemy';
import type { World } from '../src/game/world';
import type { Actor } from '../src/game/entity';
function arena(){
  const p={x:80,y:4,z:0,r:5,alive:true,hurt:vi.fn(()=>true),knock:vi.fn(),stats:{damage:20},team:'player'};
  const w={time:0,player:p,targets:()=>[p],particles:{burst:vi.fn()},sfx:vi.fn(),shake:vi.fn(),enemies:[],hittables:[],projectiles:[],items:{onDeflect:vi.fn()},room:{w:0,h:0,tileAt:()=>0}} as unknown as World;
  return {w,p};
}
describe('new beam mechanics',()=>{
 it('warns before dealing damage and hits only once per beam',()=>{
  const {w,p}=arena(),owner={alive:true,phase:0} as Enemy;
  const beam=new BossBeam(owner,owner,0,0,0,{aim:.5,lock:.55,fire:.75,width:10,length:200,color:'#fff',source:'test'});
  for(let i=0;i<60;i++)beam.update(w,1/60);
  expect(p.hurt).not.toHaveBeenCalled();expect(beam.state).toBe('lock');
  for(let i=0;i<50;i++)beam.update(w,1/60);
  expect(p.hurt).toHaveBeenCalledTimes(1);
 });
 it.each(['emitter','controller','phase'])('cancels before any hit on %s destruction/change',mode=>{
  const {w,p}=arena(),owner={alive:true,phase:0} as Enemy,emitter={alive:true} as Enemy;
  const beam=new BossBeam(emitter,owner,0,0,0,{aim:.5,lock:.55,fire:.75,width:10,length:200,color:'#fff',source:'test'});
  beam.age=1.1;
  if(mode==='phase')owner.phase=1;else Object.assign(mode==='emitter'?emitter:owner,{alive:false});
  beam.update(w,1/60);expect(beam.dead).toBe(true);expect(p.hurt).not.toHaveBeenCalled();
 });
});
describe('melee reflected damage',()=>{
 it('returns bullets at 40% of the reflecting player attack, half the previous 80%',()=>{
  const {w,p}=arena();p.x=p.y=0;
  const bullet=new Projectile({team:'enemy',x:10,y:-3,angle:Math.PI,speed:100,damage:999});
  w.projectiles.push(bullet);
  const swing=new MeleeSwing(p as unknown as Actor,{angle:0,arc:2,reach:24,damage:20,reflect:true});
  swing.update(w,1/60);
  expect(bullet.team).toBe('player');expect(bullet.owner).toBe(p);expect(bullet.damage).toBe(8);
  expect(bullet.behaviors).toEqual([]);expect(bullet.generation).toBeGreaterThanOrEqual(1);
 });
 it('preserves the separately timed character counter multiplier',()=>{
  const {w}=arena(),bullet=new Projectile({team:'enemy',x:10,y:0,angle:0,speed:100,damage:1});
  reflectProjectile(w,bullet,{x:0,y:0,o:{angle:0,color:'#fff'}});
  expect(bullet.damage).toBe(16);
 });
});
