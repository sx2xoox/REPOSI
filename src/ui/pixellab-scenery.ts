import { defineCanvasSprite, hasSprite } from '../engine/sprites';
import { Characters } from '../game/defs';
const urls=import.meta.glob('../assets/pixellab/scenery/*.png',{eager:true,query:'?url',import:'default'}) as Record<string,string>;
const art=new Map<string,HTMLCanvasElement>();
export function sceneryArt(id:string):HTMLCanvasElement|undefined{return art.get(id);}
export function sceneSprite(id:string,fallback=id):string{return hasSprite('pl_prop_'+id)?'pl_prop_'+id:fallback;}
/** Preserve each generated pixel. Ground anchors come from the opaque foot, not canvas padding. */
export async function loadPixelLabScenery():Promise<void>{
 if(typeof Image==='undefined')return;
 await Promise.all(Object.entries(urls).map(async([path,url])=>{
  const image=new Image();image.src=url;try{await image.decode();}catch{console.warn('Scenery asset unavailable:',path);return;}
  const id=path.split('/').pop()!.replace('.png',''),canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const ctx=canvas.getContext('2d')!;ctx.imageSmoothingEnabled=false;ctx.drawImage(image,0,0);art.set(id,canvas);
  let bottom=canvas.height-1;const bytes=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  outer:for(let y=canvas.height-1;y>=0;y--)for(let x=0;x<canvas.width;x++)if(bytes[(y*canvas.width+x)*4+3]>127){bottom=y;break outer;}
  const icon=id.startsWith('icon_');
  defineCanvasSprite('pl_prop_'+id,canvas.width,canvas.height,c=>{c.imageSmoothingEnabled=false;c.drawImage(canvas,0,0);},{origin:icon?[canvas.width/2,canvas.height/2]:[canvas.width/2,bottom-(id.includes('chest')?4:0)]});
 }));
 for(const id of ['tove','luen','ves','ort','mira']){const ch=Characters.get(id);if(!ch)continue;if(art.has('icon_'+id+'_release'))ch.releaseIcon=sceneSprite('icon_'+id+'_release');for(const kind of ['passive','dash'] as const)if(ch[kind]&&art.has('icon_'+id+'_'+kind))ch[kind]!.icon=sceneSprite('icon_'+id+'_'+kind);}
}
