import { describe, expect, it, vi } from 'vitest';
import { armGaleGuard, clearGaleBullets } from '../src/content/weapons/gale-guard';
import { needsLandscape } from '../src/ui/orientation';
import { bossIntercept, selectBossPattern } from '../src/content/bosses/tactics';
import { RNG } from '../src/engine/rng';
import type { Projectile } from '../src/game/projectile';
import type { World } from '../src/game/world';
function shot(extra = {}): Projectile {
  const p = { x: 0, y: 0, r: 20, generation: 0, team: 'enemy', dead: false, delay: 0, ...extra };
  return Object.assign(p, { expire: vi.fn(() => { p.dead = true; }) }) as unknown as Projectile;
}
describe('gale fan limited defense', () => {
  it('shares three clears across multishot and repeated frames', () => {
    const gusts = [shot({team:'player'}), shot({team:'player'})];
    const bullets = Array.from({length:10}, () => shot());
    const w = {time:0, projectiles:bullets} as World;
    armGaleGuard(gusts, 0);
    expect(clearGaleBullets(gusts[0],w)).toBe(3);
    expect(clearGaleBullets(gusts[1],w)).toBe(0);
    expect(clearGaleBullets(gusts[0],w)).toBe(0);
    expect(bullets.filter(p=>p.dead)).toHaveLength(3);
  });
  it('does not clear delayed shots, friendly fire, distant shots or hazards', () => {
    const gust=shot({team:'player'}), bullets=[shot({delay:1}),shot({team:'player'}),shot({x:15})];
    const hazard={enemyHazard:true,dead:false,x:0,y:0};
    const w={time:0,projectiles:bullets,entities:[hazard]} as unknown as World;
    armGaleGuard([gust],0);
    expect(clearGaleBullets(gust,w)).toBe(0);
    expect(hazard.dead).toBe(false);
  });
  it('expires the defensive window and excludes secondary shots', () => {
    const gust=shot(), w={time:0.18,projectiles:[shot()]} as World;
    armGaleGuard([gust],0);
    expect(clearGaleBullets(gust,w)).toBe(0);
    w.time=0;gust.generation=1;
    expect(clearGaleBullets(gust,w)).toBe(0);
  });
  it('separate attacks and players get independent allowances', () => {
    const a=shot(),b=shot(),w={time:0,projectiles:Array.from({length:8},()=>shot())} as World;
    armGaleGuard([a],0);armGaleGuard([b],0);
    expect(clearGaleBullets(a,w)+clearGaleBullets(b,w)).toBe(6);
  });
});
describe('orientation prompt',()=>{
  const base={userAgent:'Mozilla Windows NT 10.0',platform:'Win32',touchPoints:10,coarse:true,width:600,height:900,orientation:'portrait-primary'};
  it('never treats a narrow touch-capable PC as a phone',()=>expect(needsLandscape(base)).toBe(false));
  it('shows for actual portrait phones and hides during landscape resize glitches',()=>{
    expect(needsLandscape({...base,userAgent:'Android'})).toBe(true);
    expect(needsLandscape({...base,userAgent:'Android',orientation:'landscape-primary'})).toBe(false);
    expect(needsLandscape({...base,userAgent:'iPhone',width:900,height:600})).toBe(false);
  });
});
describe('boss tactics',()=>{
  it('answers ranged kiting without wasting a turn on an out-of-range swing',()=>{
    for(let seed=0;seed<100;seed++){
      const id=selectBossPattern(new RNG(seed),'chain_smith',[
        {id:'strike',w:100},{id:'hook',w:1},{id:'slag',w:1},
      ],'bellows',180,{recent:[],withoutPhysical:0});
      expect(id).not.toBe('strike');
    }
  });
  it('favors complementary attacks without bypassing cooldown eligibility',()=>{
    let hooks=0;
    for(let seed=0;seed<500;seed++){
      const id=selectBossPattern(new RNG(seed),'chain_smith',[
        {id:'hook',w:1},{id:'bellows',w:1},{id:'furnace',w:100,when:false},
      ],'slag',100,{recent:[],withoutPhysical:0});
      expect(id).not.toBe('furnace');
      if(id==='hook')hooks++;
    }
    expect(hooks).toBeGreaterThan(320);
    expect(hooks).toBeLessThan(450);
  });
  it('caps interception even during a dash and snapshots the visible target',()=>{
    const target={x:100,y:80,vx:400,vy:300};
    const aim=bossIntercept(target,0.35);
    expect(Math.hypot(aim.x-target.x,aim.y-target.y)).toBeCloseTo(28);
    target.x+=100;
    expect(aim.x).toBeCloseTo(122.4);
    expect(bossIntercept({x:5,y:9,vx:0,vy:0})).toEqual({x:5,y:9});
  });
  const opts=[{id:'strike',w:2},{id:'slag',w:3},{id:'bellows',w:3},{id:'furnace',w:10,when:false}];
  const run=()=>{const rng=new RNG('tactics'),mem={recent:[] as string[],withoutPhysical:0};let last:string|null=null;return Array.from({length:100},()=>last=selectBossPattern(rng,'chain_smith',opts,last,100,mem));};
  it('is deterministic, respects availability and avoids repeats',()=>{
    const a=run();expect(a).toEqual(run());expect(a).not.toContain('furnace');
    for(let i=1;i<a.length;i++)expect(a[i]).not.toBe(a[i-1]);
    for(let i=2;i<a.length;i++)expect(a.slice(i-2,i+1)).toContain('strike');
  });
  it('retains a legal option when physical attacks are unavailable',()=>{
    expect(selectBossPattern(new RNG(1),'chain_smith',[{id:'slag',w:1}], 'slag', 0,{recent:[],withoutPhysical:3})).toBe('slag');
  });
});
