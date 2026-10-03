import './headless';
import { expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { RoomDevice } from '../src/content/rooms/mechanisms';
import { generateStage } from '../src/game/dungeon';
import { Floors } from '../src/game/defs';
import { RNG } from '../src/engine/rng';
import { Pickup, Pedestal } from '../src/game/pickups';
import { stateHash } from '../src/game/statehash';
loadContent();
function setup(kind: 'relay'|'workshop'|'vault') {
 const run = new RunState('DEVICES','ria'); run.staged=true;
 const w = new World(new Renderer(fakeDisplay(1280,720)),run,{openInventory(){},onGameOver(){}});w.start();
 const n = w.map.nodes.find(n=>n.id!==w.map.startId)!;n.kind=kind;n.templateId=`${kind}_alcove`;n.visited=false;n.cleared=false;
 w.enterRoom(n,null);return w;
}
function use(w:World,d:RoomDevice){w.player.x=d.x;w.player.y=d.y;w.focus=d;return w.interact();}
it('expanded stages retain branches, large rooms and a short unlocked exit route',()=>{
 let large=0;const counts:number[]=[];
 for(const floor of Floors.all())for(let stage=1;stage<=4;stage++)for(let seed=0;seed<50;seed++){
  const m=generateStage(floor,stage,new RNG(seed));counts.push(m.nodes.length);
  expect(m.nodes.length).toBeGreaterThanOrEqual(8);
  expect(m.nodes.some(n=>n.doors.length>=3)).toBe(true);
  expect(m.nodes.filter(n=>['relay','workshop','vault'].includes(n.kind))).toHaveLength(1);
  expect(m.nodes.filter(n=>n.kind==='treasure')).toHaveLength(stage===1?1:0);
  if(stage<4){const exit=m.nodes[m.exitId!];expect(exit.kind).toBe('normal');expect(exit.locked).toBe(false);expect(exit.depth).toBeLessThanOrEqual(4);}
  large+=m.nodes.filter(n=>n.cw>1||n.ch>1).length;
 }
 expect(large).toBeGreaterThan(100);
 console.log('Stage room count range',Math.min(...counts),Math.max(...counts),'large rooms',large);
});
it('relay resets wrong order, hashes progress and pays only once across revisits',()=>{
 const w=setup('relay'),ds=w.entities.filter((e):e is RoomDevice=>e instanceof RoomDevice).sort((a,b)=>a.mem.index-b.mem.index);
 use(w,ds[1]);expect(ds[0].root.mem.progress).toBe(0);
 const h=stateHash(w);use(w,ds[0]);expect(ds[0].root.mem.progress).toBe(1);expect(stateHash(w)).not.toBe(h);
 use(w,ds[1]);use(w,ds[2]);expect(ds[0].root.mem.used).toBe(true);
 w.update(1/60);const rewards=w.entities.filter(e=>e instanceof Pickup).length;expect(rewards).toBe(2);
 expect(use(w,ds[2])).toBe(false);
 const node=w.node;w.enterRoom(w.map.nodes[w.map.startId],null);w.enterRoom(node,null);
 const returned=w.entities.find(e=>e instanceof RoomDevice) as RoomDevice;expect(returned.root.mem.used).toBe(true);expect(use(w,returned)).toBe(false);
});
it('workshop selection consumes the shared choice and full health cannot waste it',()=>{
 const w=setup('workshop'),ds=w.entities.filter((e):e is RoomDevice=>e instanceof RoomDevice);
 w.player.red=w.player.maxRed;expect(use(w,ds[2])).toBe(false);expect(ds[0].root.mem.used).toBe(false);
 const keys=w.player.keys;expect(use(w,ds[0])).toBe(true);expect(w.player.keys).toBe(keys+2);expect(use(w,ds[1])).toBe(false);
});
it('vault requires exactly two bombs and grants a single pedestal',()=>{
 const w=setup('vault'),d=w.entities.find(e=>e instanceof RoomDevice) as RoomDevice;
 w.player.bombs=1;expect(use(w,d)).toBe(false);expect(w.player.bombs).toBe(1);
 w.player.bombs=2;expect(use(w,d)).toBe(true);expect(w.player.bombs).toBe(0);expect(use(w,d)).toBe(false);
 w.update(1/60);expect(w.entities.filter(e=>e instanceof Pedestal)).toHaveLength(1);
});
