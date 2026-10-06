import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const root=resolve('src/assets/pixellab');
const actors=['ria','bern','serin','niel','bori','baekgu-fixed','mori','tove','luen','ves','ort','mira','lume','brik','orin'];
const directions=['south','south-east','east','north-east','north','north-west','west','south-west'];
function dimensions(path:string){const b=readFileSync(resolve(root,path));expect(b.subarray(1,4).toString()).toBe('PNG');return [b.readUInt32BE(16),b.readUInt32BE(20)];}
it('ships complete native directional actor sets and four real walking frames per cardinal direction',()=>{
 for(const id of actors){
  for(const d of directions)expect(dimensions(`${id}/${d}.png`),`${id}/${d}`).toEqual([32,32]);
  // V3 uses transparent margins around the same native body pixels; never resize it.
  const walkSize = ['ria','tove'].includes(id) ? 40 : ['brik','bern','bori','mira'].includes(id) ? 44 : 32;
  for(const d of ['south','east','north','west'])for(let f=0;f<4;f++){
   const expected=id==='serin'?(['east','west'].includes(d)?[36,44]:[32,48]):[walkSize,walkSize];
   expect(dimensions(`${id}/walk-${d}-${f}.png`),`${id}/${d}/${f}`).toEqual(expected);
  }
 }
});
it('keeps shared portrait resolution and separately placeable town assets',()=>{
 for(const id of ['lume','brik','orin'])expect(dimensions(`portraits/${id}.png`)).toEqual([96,96]);
 for(const id of ['keeper-house','archive','sanctuary'])expect(dimensions(`town/${id}.png`)).toEqual([96,96]);
 expect(dimensions('town/lantern-court.png')).toEqual([64,64]);
 for(const id of ['stone-floor','soil-floor'])expect(dimensions(`town/${id}.png`)).toEqual([32,32]);
 expect(existsSync(resolve(root,'town/forge-v2.png'))).toBe(true);
});
