import './headless';
import { expect, it, vi } from 'vitest';
import { measureDps } from './dpsharness';
import { RefugeRelease } from '../src/content/characters/refuge-release';
import { stateHash } from '../src/game/statehash';
const setup=(character:string)=>{const {world:w,dummies}=measureDps({character,weapon:'lantern_bolt',seconds:0,dist:55});w.inputSource=(_w,_p,o)=>{o.mx=o.my=o.ax=o.ay=o.held=o.pressed=0;};w.update(1/60);w.player.aim=0;w.player.stats.critChance=0;return {w,target:dummies[0]};};
it('Luen has a readable windup, deals three planned cuts, and never replenishes ember',()=>{
 const {w,target}=setup('luen'),p=w.player,hp=target.hp,hit=vi.spyOn(w,'applyHit');p.ember=0;
 w.withIds(()=>p.character.release!(w,p));for(let i=0;i<12;i++)w.update(1/60);expect(target.hp).toBe(hp);
 for(let i=0;i<48;i++)w.update(1/60);
 const cuts=hit.mock.calls.filter(([enemy,h])=>enemy===target&&h.release);
 expect(cuts.map(([,h])=>h.damage/p.stats.damage)).toEqual([2,3,6]);
 expect(cuts.every(([,h])=>h.noProc&&h.release)).toBe(true);
 expect(hp-target.hp).toBeCloseTo(p.stats.damage*11);expect(p.ember).toBe(0);
});
it('Ves plays three timed support strikes with the original total damage budget',()=>{
 const {w,target}=setup('ves'),p=w.player,start=w.time,hp=target.hp;
 const times:number[]=[],original=w.applyHit.bind(w);
 const hit=vi.spyOn(w,'applyHit').mockImplementation((enemy,h)=>{if(enemy===target&&h.release)times.push(w.time-start);return original(enemy,h);});
 p.ember=0;w.withIds(()=>p.character.release!(w,p));for(let i=0;i<60;i++)w.update(1/60);
 const strikes=hit.mock.calls.filter(([enemy,h])=>enemy===target&&h.release);
 expect(strikes.map(([,h])=>h.damage/p.stats.damage)).toEqual([3,3,5]);
 expect(strikes.every(([,h])=>h.noProc&&h.release)).toBe(true);
 for(const [i,planned] of [.22,.53,.86].entries()){expect(times[i]).toBeGreaterThanOrEqual(planned);expect(times[i]).toBeLessThanOrEqual(planned+2/60);}
 expect(hp-target.hp).toBeCloseTo(p.stats.damage*11);expect(p.ember).toBe(0);
});
it('a downed owner cancels the remaining choreography without leaving damage behind',()=>{const {w,target}=setup('luen'),p=w.player,hp=target.hp;w.withIds(()=>p.character.release!(w,p));p.downed=true;for(let i=0;i<60;i++)w.update(1/60);expect(target.hp).toBe(hp);expect(w.entities.some(e=>e instanceof RefugeRelease&&!e.dead)).toBe(false);});
it('all new release drawing restores opacity and cannot change simulation state',()=>{for(const id of ['tove','luen','ves','ort','mira']){const {w}=setup(id);w.withIds(()=>w.player.character.release!(w,w.player));w.update(1/60);const e=w.entities.find(e=>e instanceof RefugeRelease)!;w.renderer.worldOpacity=.37;for(const t of [.05,.2,.29,.4,.6]){e.age=t;const before=stateHash(w);e.draw(w.renderer,w);expect(stateHash(w),id+' '+t).toBe(before);expect(w.renderer.worldOpacity,id).toBe(.37);}}});

it('Luen and Ves remain render-pure through every fixed-step frame of their full release',()=>{for(const id of ['luen','ves']){const {w}=setup(id);w.withIds(()=>w.player.character.release!(w,w.player));let sampled=0;for(let tick=0;tick<96;tick++){w.update(1/60);const before=stateHash(w);w.draw(1);expect(stateHash(w),id+' frame '+tick).toBe(before);if(w.entities.some(e=>e instanceof RefugeRelease))sampled++;}expect(sampled,id).toBeGreaterThan(30);}});
