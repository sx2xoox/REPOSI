import './headless';
import { expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Tile } from '../src/game/tiles';
import { PRESS } from '../src/game/seam';
import { Entity } from '../src/game/entity';

loadContent();
function setup(turn = 0, overlap = 2, side = -1, assist = true) {
  const w = new World(new Renderer(fakeDisplay(1280, 720)), new RunState('CORNER-SLIDE', 'ria'), { openInventory() {}, onGameOver() {} });
  w.start();
  for (let ty=2;ty<w.room.h-2;ty++) for(let tx=2;tx<w.room.w-2;tx++) w.room.setTile(tx,ty,Tile.FLOOR);
  const rotate = (x:number,y:number) => {
    let dx=x-168,dy=y-104;
    for(let i=0;i<turn;i++) [dx,dy]=[-dy,dx];
    return {x:168+dx,y:104+dy};
  };
  for(let tx=8;tx<=11;tx++)for(const ty of [5,7]) {
    const p=rotate(tx*16+8,ty*16+8);w.room.setTile(Math.floor(p.x/16),Math.floor(p.y/16),Tile.BLOCK);
  }
  const pos=rotate(110,104+side*(3+overlap)),origin=rotate(168,104),end=rotate(169,104);
  const intent={x:end.x-origin.x,y:end.y-origin.y},p=w.player;
  Object.assign(p,pos);p.god=true;
  w.inputSource=(_w,_p,out)=>{out.mx=intent.x;out.my=intent.y;out.pressed=0;};
  if(!assist){const move=p.move.bind(p);p.move=(world,dt)=>move(world,dt);}
  return {w,p,intent,rotate};
}
function tick(w:World,n:number){for(let i=0;i<n;i++)w.update(1/60);}

for(let turn=0;turn<4;turn++)for(const side of [-1,1])it(`grazing either corner enters a one-tile passage, direction ${turn}, side ${side}`,()=>{
  for(const overlap of [.5,1,2,3,4]){
    const {w,p,intent,rotate}=setup(turn,overlap,side),start={x:p.x,y:p.y};
    for(let i=0;i<65;i++){
      const x=p.x,y=p.y;w.update(1/60);
      expect(w.room.boxBlocked(p.x,p.y,p.r,p.flying,p.phasing)).toBe(false);
      expect(Math.hypot(p.x-x,p.y-y)).toBeLessThanOrEqual(Math.hypot(p.vx,p.vy)/60+.00001);
    }
    expect((p.x-start.x)*intent.x+(p.y-start.y)*intent.y).toBeGreaterThan(87);
    const center=rotate(168,104),across=(p.x-center.x)*-intent.y+(p.y-center.y)*intent.x;
    expect(Math.abs(across)).toBeLessThanOrEqual(3.001);
    const before=setup(turn,overlap,side,false);tick(before.w,65);
    expect((before.p.x-start.x)*intent.x+(before.p.y-start.y)*intent.y).toBeLessThan(14);
  }
});

it('a full wall and deep face contact stop without choosing a side or vibrating',()=>{
  for(const overlap of [5,8,12]){
    const {w,p}=setup(0,overlap,-1),y=p.y;tick(w,120);
    expect(p.x).toBeLessThanOrEqual(123.001);expect(p.y).toBe(y);
  }
  const {w,p}=setup();for(let y=2;y<11;y++)w.room.setTile(8,y,Tile.WALL);const startY=p.y;tick(w,180);
  expect(p.x).toBeLessThanOrEqual(123.001);expect(p.y).toBe(startY);
});

it('automatic correction does not enter spikes, pits, or a blocked diagonal shortcut',()=>{
  for(const tile of [Tile.SPIKES,Tile.PIT,Tile.WALL,Tile.DOOR]){
    const {w,p}=setup();w.room.setTile(8,6,tile);const y=p.y;tick(w,90);
    expect(p.x).toBeLessThanOrEqual(123.001);expect(p.y).toBe(y);
  }
});

it('diagonal steering retains the existing wall slide, including backing away',()=>{
  for(const direction of [{x:Math.SQRT1_2,y:Math.SQRT1_2},{x:-Math.SQRT1_2,y:-Math.SQRT1_2}]){
    const a=setup(),b=setup(0,2,-1,false);
    for(const s of [a,b])s.w.inputSource=(_w,_p,out)=>{out.mx=direction.x;out.my=direction.y;};
    for(let i=0;i<40;i++){a.w.update(1/60);b.w.update(1/60);expect([a.p.x,a.p.y]).toEqual([b.p.x,b.p.y]);}
  }
});

it('dash corrections remain swept and never tunnel through tiles even at high speed',()=>{
  const {w,p}=setup();p.vx=0;p.stats.dashSpeed=1000;
  w.inputSource=(_w,_p,out)=>{out.mx=1;out.my=0;out.pressed=w.time<.03?PRESS.dash:0;};
  for(let i=0;i<20;i++){const x=p.x,y=p.y;w.update(1/60);expect(w.room.boxBlocked(p.x,p.y,p.r,p.flying,p.phasing)).toBe(false);expect(Math.hypot(p.x-x,p.y-y)).toBeLessThanOrEqual(1000/60+.001);}
  expect(p.x).toBeGreaterThan(150);
});

it('idle drift, knockback, and non-player entities do not receive corner steering',()=>{
  for(const mode of ['idle','knockback','frozen']){
    const {w,p}=setup();p.x=122;p.vx=92;
    if(mode==='idle')w.inputSource=(_w,_p,out)=>{out.mx=out.my=0;};
    if(mode==='knockback')p.kbx=80;
    if(mode==='frozen')p.frozen=true;
    const y=p.y;w.update(1/60);expect(p.y).toBe(y);
  }
  const {w,p}=setup();const object=new(class extends Entity {})();object.x=p.x;object.y=p.y;object.r=p.r;object.vx=92;
  for(let i=0;i<90;i++)object.move(w,1/60);
  expect(object.x).toBeLessThanOrEqual(123.001);expect(object.y).toBe(p.y);
});

it('small analog input glides without exceeding its walking speed or reversing the requested side',()=>{
  const {w,p}=setup();w.inputSource=(_w,_p,out)=>{out.mx=.4;out.my=0;};const y=p.y;
  tick(w,180);expect(p.x).toBeGreaterThan(195);expect(p.y).toBeGreaterThan(y);expect(p.y-y).toBeLessThanOrEqual(2.5);
  const opposite=setup();opposite.w.inputSource=(_w,_p,out)=>{out.mx=.4;out.my=-.05;};tick(opposite.w,40);
  expect(opposite.p.y).toBeLessThanOrEqual(y);expect(opposite.p.x).toBeLessThanOrEqual(123.001);
});
