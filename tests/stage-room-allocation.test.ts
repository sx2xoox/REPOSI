import './headless';
import { it,expect } from 'vitest';
import { RNG } from '../src/engine/rng';
import { loadContent } from '../src/content';
import { Floors } from '../src/game/defs';
import { generateStage } from '../src/game/dungeon';
import { stageRoomPlan, normalizeStage } from '../src/game/stage-plan';
loadContent();
it('preserves every group draw across layout retries and all 21 stages',()=>{
 for(const floor of Floors.all())for(let stage=1;stage<=3;stage++)for(let seed=0;seed<80;seed++){
  const key=`allocation-${floor.index}-${stage}-${seed}`,plan=stageRoomPlan(new RNG(key));
  const map=generateStage(floor,stage,new RNG(key));
  const special=map.nodes.filter(n=>!['start','normal','boss'].includes(n.kind)).map(n=>n.kind).sort();
  expect(special).toEqual(plan.sort());
  expect(map.nodes.filter(n=>n.kind==='boss')).toHaveLength(stage===3?1:0);
  const normal=map.nodes.filter(n=>n.kind==='normal').length;expect(normal).toBeGreaterThanOrEqual(7);expect(normal).toBeLessThanOrEqual(9);
  expect(map.nodes.every(n=>!!n.templateId)).toBe(true);
  if(stage<3){expect(map.exitId).toBe(map.startId);expect(map.nodes[map.exitId!].kind).toBe('start');expect(map.nodes[map.exitId!].locked).toBe(false);}
  else expect(map.exitId).toBeUndefined();
 }
},30000);
it('draw probabilities match the requested independent groups',()=>{
 const counts:Record<string,number>={};let both=0;
 for(let seed=0;seed<30000;seed++){const p=stageRoomPlan(new RNG('odds'+seed));for(const k of p)counts[k]=(counts[k]??0)+1;if(p.includes('elite')&&p.includes('secret'))both++;}
 for(const [k,p] of Object.entries({treasure:.375,shop:.375,shrine:1/3,curse:1/3,challenge:1/3,relay:1/8,workshop:1/8,vault:1/8,hunt:1/8,secret:.3,refinery:.4,well:.4,fusion:.2,elite:.4}))expect(Math.abs(counts[k]/30000-p),k).toBeLessThan(.013);
 expect(both/30000).toBeCloseTo(.12,2);
 expect(normalizeStage(4)).toBe(3);expect(normalizeStage(2)).toBe(2);
});
