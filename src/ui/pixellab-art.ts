import { actorFramePlacement } from './pixel-actor-layout';

// PixelLab originals are bundled locally. There are no runtime API calls or credentials.
const urls = import.meta.glob([
 '../assets/pixellab/**/*.png',
 '!../assets/pixellab/studies/**/*.png',
 '!../assets/pixellab/ria-compact/*.png',
 '!../assets/pixellab/baekgu/*.png',
 '!../assets/pixellab/town/baekgu-front.png',
 '!../assets/pixellab/town/boat.png',
 '!../assets/pixellab/town/forge.png',
 '!../assets/pixellab/town/garden.png',
 '!../assets/pixellab/weapons/**/*.png',
 '!../assets/pixellab/scenery/*.png',
 '!../assets/pixellab/bosses/**/*.png',
], { eager: true, query: '?url', import: 'default' }) as Record<string,string>;
const art = new Map<string,HTMLCanvasElement>();
export const PIXEL_DIRECTIONS = ['east','south-east','south','south-west','west','north-west','north','north-east'] as const;
export function pixelDirection(x:number,y:number):string { return PIXEL_DIRECTIONS[(Math.round(Math.atan2(y,x)/(Math.PI/4))+8)%8]; }
export function pixelArt(key:string):HTMLCanvasElement|undefined { return art.get(key); }
// All four walk poses have now been regenerated and inspected.
export function pixelActor(id:string,direction:string,moving:boolean,t:number):HTMLCanvasElement|undefined {
  const frame=Math.floor(t*8)%4;
  const walkDirection=direction.includes('east')?'east':direction.includes('west')?'west':direction;
  return (moving?art.get(`${id}/walk-${walkDirection}-${frame}`):undefined)??art.get(`${id}/${direction}`);
}

export async function loadPixelLabArt():Promise<void> {
 if(typeof Image==='undefined')return;
 await Promise.all(Object.entries(urls).map(async([path,url])=>{
  const key=path.split('/pixellab/')[1].replace(/\.png$/,'');
  const image=new Image();image.src=url;
  try{await image.decode();}catch{console.warn('PixelLab asset unavailable:',key);return;}
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const ctx=canvas.getContext('2d')!;ctx.imageSmoothingEnabled=false;ctx.drawImage(image,0,0);
  // Align transparent actor canvases to the feet without resampling any generated pixel.
  if(!key.startsWith('town/')&&!key.startsWith('portraits/')){
   const bytes=ctx.getImageData(0,0,canvas.width,canvas.height).data;let bottom=0;
   for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(bytes[(y*canvas.width+x)*4+3]>127)bottom=y;
   const placement=actorFramePlacement(key,canvas.width,canvas.height,bottom);
   canvas.width=placement.width;canvas.height=placement.height;
   ctx.imageSmoothingEnabled=false;
   ctx.drawImage(image,placement.x,placement.y);
  }
  art.set(key,canvas);
 }));
 // Player keepers intentionally retain their authored native sprites and animations.
 // PixelLab remains active for town residents and scenery.
}
