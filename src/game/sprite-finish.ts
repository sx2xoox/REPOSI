import { PixelPainter, packColor } from '../engine/painter';
/** Small, shared material pass. Only recolors existing cloth pixels; silhouette and size never change. */
export function finishCloth(p:PixelPainter, colors:readonly string[]):void {
 if(colors.length<3||colors.some(c=>!c))return;
 const [shadow,mid,light]=colors.map(packColor),src=p.data.slice(),w=p.w,h=p.h;
 const at=(x:number,y:number)=>x<0||y<0||x>=w||y>=h?0:src[y*w+x];
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const k=y*w+x;if(src[k]!==mid)continue;
  // Consistent top-left light and right/bottom fold shading, at native pixel scale.
  if(!at(x-1,y)&&at(x+1,y)===mid&&at(x,y+1)===mid)p.data[k]=light;
  else if(!at(x+1,y)&&at(x-1,y)===mid)p.data[k]=shadow;
  else if(!at(x,y+1)&&at(x,y-1)===mid)p.data[k]=shadow;
 }
}
