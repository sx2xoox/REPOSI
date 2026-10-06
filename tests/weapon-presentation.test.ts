import './headless';
import { expect, it, vi } from 'vitest';
import { heldLocalPoint, shotMaterial, thrustExtension } from '../src/game/weapon-presentation';
import { Particles } from '../src/engine/particles';
import { Projectile } from '../src/game/projectile';
import { save } from '../src/engine/save';
import type { World } from '../src/game/world';

it('thrust extends on its axis and fully returns without overshoot at high frame rates', () => {
  expect(thrustExtension(-1)).toBe(0);expect(thrustExtension(0)).toBe(0);
  expect(thrustExtension(.055)).toBe(1);expect(thrustExtension(.22)).toBe(0);
  let previous=1;
  for(let t=.055;t<.23;t+=.001){const k=thrustExtension(t);expect(k).toBeLessThanOrEqual(previous+1e-9);expect(k).toBeGreaterThanOrEqual(0);previous=k;}
});
it('muzzle points mirror with the held sprite in all eight directions',()=>{
  for(let i=0;i<8;i++){const a=i*Math.PI/4,p=heldLocalPoint(100,100,a,20,3),dx=p.x-100,dy=p.y-100;
    expect(dx*Math.cos(a)+dy*Math.sin(a)).toBeCloseTo(20);
    expect(-dx*Math.sin(a)+dy*Math.cos(a)).toBeCloseTo(Math.cos(a)<0?-3:3);
  }
});
it('old and new weapons use the same material rules',()=>{
  expect(shotMaterial('throwing_knives')).toBe(shotMaterial('dusk_knives'));
  expect(shotMaterial('hunter_bow')).toBe(shotMaterial('crescent_bow'));
  expect(shotMaterial('flame_staff')).toBe(shotMaterial('cinder_sceptre'));
  expect(shotMaterial('frost_wand')).toBe(shotMaterial('glacier_arbalest'));
});
it('impact particles respect teammate opacity and range expiry is silent',()=>{
  const local={},remote={},particles=new Particles(),sfx=vi.fn();
  const w={coop:true,local,players:[local,remote],particles,sfx} as unknown as World;
  const old=save.settings.teammateProjectileOpacity;
  const shot=()=>new Projectile({team:'player',owner:remote as never,x:0,y:0,angle:0,speed:10,damage:5,fxMaterial:'metal'});
  try{
    save.settings.teammateProjectileOpacity=.3;shot().expire(w,true);
    expect(particles.list).toHaveLength(4);expect(particles.list.every(p=>p.alpha===.3&&p.shape==='spark')).toBe(true);
    expect(sfx.mock.calls[0][0]).toBe('hit_metal');particles.clear();sfx.mockClear();
    save.settings.teammateProjectileOpacity=0;shot().expire(w,true);expect(particles.list).toHaveLength(0);expect(sfx).not.toHaveBeenCalled();
    save.settings.teammateProjectileOpacity=1;shot().expire(w,false);expect(sfx).not.toHaveBeenCalled();
  }finally{save.settings.teammateProjectileOpacity=old;}
});
