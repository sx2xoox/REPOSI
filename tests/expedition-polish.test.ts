import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROGRESS, newCampaign, save } from '../src/engine/save';
import type { Checkpoint } from '../src/game/checkpoint';
import './headless';
import { encounterCount, encounterHP, rewardRarity } from '../src/content/rooms/encounter-kit';
import { MISSION_DIFFICULTY } from '../src/game/mission-difficulty';
import { ALARM_CYCLE, alarmPattern, alarmStage, beamDistance, vaultAlarm, type AlarmBox } from '../src/content/rooms/vault-alarm';

describe('explicit expedition abandonment', () => {
 it('persists only checkpoint removal, preserving story, unlocks, stats and other slots', () => {
  const previous = { progress: save.progress, history: save.history, slots: save.slots, activeSlot: save.activeSlot };
  const storage = new Map<string,string>();
  vi.stubGlobal('localStorage', {getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)});
  try {
   save.progress=structuredClone(DEFAULT_PROGRESS);
   save.progress.flags=['unlock:baekgu']; save.progress.deaths=2;
   save.progress.campaign={...newCampaign(),seen:['intro','boss:1','return:4'],cleared:4,checkpoint:{floor:3,stage:2,character:'ria'} as Checkpoint};
   save.history=[];save.activeSlot=0;
   save.slots=[{name:'test',created:'today',progress:save.progress,history:[]},{name:'other',created:'today',progress:structuredClone(save.progress),history:[]},null,null];
   const before=structuredClone(save.progress);delete before.campaign!.checkpoint;
   const other=structuredClone(save.slots[1]);
   save.abandonExpedition();
   expect(save.progress).toEqual(before);expect(save.slots[1]).toEqual(other);
   const persisted=JSON.parse(storage.get('lanternkeeper.slots.v1')!);
   expect(persisted[0].progress).toEqual(before);expect(persisted[1]).toEqual(other);
   save.abandonExpedition();expect(save.progress).toEqual(before);
  } finally {Object.assign(save,previous);vi.unstubAllGlobals();}
 });
});

describe('mission difficulty', () => {
 it('scales population and HP once, and guarantees difficulty-based crate rarity',()=>{
  expect([1,2,3,4].map(encounterCount)).toEqual([1,1.5,2,2.5]);
  expect([1,2,3,4].map(encounterHP)).toEqual([1,1.35,1.6,1.85]);
  expect(['relay','workshop','vault','hunt'].map(k=>rewardRarity(k,1))).toEqual(['common','rare','epic','rare']);
  expect(['relay','workshop','vault','hunt'].map(k=>rewardRarity(k,4))).toEqual(['rare','epic','legendary','epic']);
  expect(MISSION_DIFFICULTY.hunt.label).toBe('보통');
 });
 const BOX:AlarmBox={x0:32,y0:32,x1:304,y1:176,vx:168,vy:104};
 it('warns for a full second before firing and resets each cycle',()=>{
  expect(vaultAlarm(7,1,BOX)).toMatchObject({warning:true,active:false});
  expect(vaultAlarm(7,1.79,BOX).active).toBe(false);
  expect(vaultAlarm(7,1.81,BOX).active).toBe(true);
  expect(vaultAlarm(7,2.41,BOX)).toMatchObject({warning:false,active:false});
  expect([2,22,42].map(alarmStage)).toEqual([1,2,3]);
 });
 it('is a pure function of the alarm seed and clock, and the lanes move around between cycles and runs',()=>{
  expect(vaultAlarm(42,13.9,BOX)).toEqual(vaultAlarm(42,13.9,BOX));
  const key=(seed:number,c:number)=>vaultAlarm(seed,c*ALARM_CYCLE+2,BOX).beams.map(l=>[l.x0,l.y0,l.x1,l.y1].map(Math.round).join(',')).join('|');
  const one=new Set(Array.from({length:24},(_,c)=>key(42,c)));
  expect(one.size).toBeGreaterThan(18);
  expect(key(42,3)).not.toBe(key(43,3));
  // never the same pattern twice in a row, and every pattern turns up later on
  const seen=new Set<string>();
  for(let c=1;c<25;c++){const st=alarmStage(c*ALARM_CYCLE);const a=alarmPattern(42,c),b=alarmPattern(42,c-1);if(st===alarmStage((c-1)*ALARM_CYCLE))expect(a).not.toBe(b);seen.add(a);}
  expect([...seen].sort()).toEqual(['cross','grid','pincer','rotor']);
 });
 it('always leaves open floor during a volley, and the vault is not a permanent refuge',()=>{
  let vaultHit=0;
  for(let seed=1;seed<=6;seed++)for(let c=0;c<25;c++){
   // every point any beam sweeps during the active window counts as unsafe
   const samples=[0,.25,.5,.75,1].map(k=>vaultAlarm(seed,c*ALARM_CYCLE+1.8+k*.599,BOX));
   let safe=0,total=0;
   for(let x=BOX.x0+6;x<BOX.x1;x+=8)for(let y=BOX.y0+6;y<BOX.y1;y+=8){total++;if(samples.every(a=>a.beams.every(l=>beamDistance(l,x,y)>=7)))safe++;}
   expect(safe/total,`seed ${seed} cycle ${c} ${samples[0].pattern}`).toBeGreaterThan(.25);
   if(samples.some(a=>a.beams.some(l=>beamDistance(l,BOX.vx,BOX.vy+14)<7)))vaultHit++;
  }
  expect(vaultHit).toBeGreaterThan(10);
 });
});
