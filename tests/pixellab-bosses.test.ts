import './headless';
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { loadContent } from '../src/content';
import { defineCanvasSprite, getAnim, getSprite, hasSprite, replaceSpriteArt } from '../src/engine/sprites';
import manifest from '../src/assets/pixellab/bosses/manifest.json';
import provenance from '../src/assets/pixellab/bosses/provenance.json';
loadContent();
describe('PixelLab boss artwork',()=>{
 it('covers all 13 bosses with unique frames and preserves registered pivots',()=>{
  expect(manifest.bosses).toHaveLength(13);
  expect(manifest.frames.length).toBeGreaterThan(350);
  expect(new Set(manifest.frames.map(f=>f.name)).size).toBe(manifest.frames.length);
  for(const f of manifest.frames){
   expect(hasSprite(f.name),f.name).toBe(true);
   const original=getSprite(f.name);expect([f.ox,f.oy],f.name).toEqual([original.ox,original.oy]);
   expect(f.x).toBeGreaterThanOrEqual(0);expect(f.y).toBeGreaterThanOrEqual(0);
   expect(f.x+f.w).toBeLessThanOrEqual(1024);expect(f.y+f.h).toBeLessThanOrEqual(1024);
   expect(existsSync('src/assets/pixellab/bosses/'+f.atlas)).toBe(true);
  }
 });
 it('keeps atlases valid PNGs and records PixelLab provenance for every accepted frame',()=>{
  expect(provenance.provider).toBe('PixelLab');expect(provenance.frames).toHaveLength(manifest.frames.length);
  for(const atlas of new Set(manifest.frames.map(f=>f.atlas))){
   const png=readFileSync('src/assets/pixellab/bosses/'+atlas);
   expect(png.subarray(1,4).toString()).toBe('PNG');expect(png.readUInt32BE(16)).toBe(1024);expect(png.readUInt32BE(20)).toBe(1024);
  }
  for(const f of provenance.frames){expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);expect(f.jobId,f.name).toBeTruthy();}
 });
 it('replacing native art keeps animation timing and the existing pivot',()=>{
  const before=getAnim('csmith_walk');
  defineCanvasSprite('qa_boss_pivot',20,30,()=>{},{origin:[7,27]});
  replaceSpriteArt('qa_boss_pivot',32,40,()=>{});
  expect([getSprite('qa_boss_pivot').ox,getSprite('qa_boss_pivot').oy]).toEqual([7,27]);
  expect(getAnim('csmith_walk')).toBe(before);
 });
});
