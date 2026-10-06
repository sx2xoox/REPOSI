import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROGRESS, newCampaign, save } from '../src/engine/save';
import type { Checkpoint } from '../src/game/checkpoint';
import './headless';
import { encounterCount, encounterHP, vaultLanes, rewardRarity } from '../src/content/rooms/encounter-kit';

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
  expect(['relay','workshop','vault'].map(k=>rewardRarity(k,1))).toEqual(['common','rare','epic']);
  expect(['relay','workshop','vault'].map(k=>rewardRarity(k,4))).toEqual(['rare','epic','legendary']);
 });
 it('warns for a full second, adds lanes by elapsed time and resets each cycle',()=>{
  expect(vaultLanes(1,168,104)).toMatchObject({warning:true,active:false});
  expect(vaultLanes(1.79,168,104).active).toBe(false);
  expect(vaultLanes(1.81,168,104).active).toBe(true);
  expect(vaultLanes(2.41,168,104)).toMatchObject({warning:false,active:false});
  expect([2,22,42].map(t=>vaultLanes(t,168,104).lanes.length)).toEqual([2,3,4]);
 });
});
