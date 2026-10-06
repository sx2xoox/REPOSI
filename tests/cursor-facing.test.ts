import './headless';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Renderer } from '../src/engine/renderer';
import { fakeDisplay } from './headless';
import { HELD, clearInput, fixedRules } from '../src/game/seam';
loadContent();
function setup(){const w=new World(new Renderer(fakeDisplay(1280,720)),new RunState('MOUSE-FACING','ria'),{openInventory(){},onGameOver(){}});w.rules=fixedRules({hitStop:false});w.start();w.player.character={...w.player.character,spritePrefix:'pl_ria'};return w;}
describe('PixelLab cursor facing',()=>{
 it('follows the cursor in eight directions without firing',()=>{
  const w=setup();const dirs=['east','south-east','south','south-west','west','north-west','north','north-east'];
  for(let i=0;i<8;i++){const a=i*Math.PI/4;w.inputSource=(_w,p,o)=>{clearInput(o);o.held=HELD.cursorAim;o.cx=p.x+Math.cos(a)*60;o.cy=p.y-6+Math.sin(a)*60;};w.update(1/60);expect(w.player.firing).toBe(false);expect(w.player.frameName()).toBe('pl_ria_idle_'+dirs[i]);}
 });
 it('keeps looking at the cursor while moving in the opposite direction',()=>{
  const w=setup();w.inputSource=(_w,p,o)=>{clearInput(o);o.mx=1;o.held=HELD.cursorAim;o.cx=p.x-100;o.cy=p.y-6;};for(let i=0;i<8;i++)w.update(1/60);expect(w.player.frameName()).toBe('pl_ria_walk_west');
 });
 it('uses movement facing when no mouse aiming is active',()=>{
  const w=setup();w.inputSource=(_w,_p,o)=>{clearInput(o);o.mx=-1;};for(let i=0;i<8;i++)w.update(1/60);expect(w.player.frameName()).toBe('pl_ria_walk_west');
 });
});
