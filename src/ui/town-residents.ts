import { PixelPainter } from '../engine/painter';
export type ResidentFacing = 'down' | 'side' | 'up';
const cache = new Map<string, HTMLCanvasElement>();
/** Native pixels, like the keeper: a 24px canvas with an 18–21px silhouette, never scaled. */
export function residentArt(i:number, facing:ResidentFacing='down', blink=false, sway=false):HTMLCanvasElement {
 const key=`${i}:${facing}:${blink}:${sway}`;const old=cache.get(key);if(old)return old;
 const p=new PixelPainter(24,24), ink='#17121f';
 const fur=[['#9d7e83','#d6b99e','#f2d9b5','#fff0ce'],['#985732','#ce863e','#efb361','#ffdf9e'],['#4d586e','#7e90a5','#b5c4cf','#e4e7da']][i];
 const cloth=[['#2d223b','#57405f','#86617f'],['#34342b','#616045','#979171'],['#172c39','#345567','#64888c']][i];
 const side=facing==='side',back=facing==='up';
 // Feet, independently moving tail, and a compact torso below the head.
 p.rect(side?8:7,21,3,2,fur[1]);p.rect(side?12:13,21,3,2,fur[0]);
 p.line(16,20,20,20-(sway?1:0),fur[1]);p.line(20,20-(sway?1:0),21,17-(sway?1:0),fur[2]);
 p.poly(side?[9,12,14,12,16,21,7,21]:[7,12,15,12,17,21,5,21],cloth[0]);
 p.poly(side?[9,13,13,13,15,20,8,20]:[8,13,14,13,16,20,6,20],cloth[1]);
 p.line(side?9:7,16,side?8:6,19,cloth[2]);p.line(13,16,14,20,cloth[0]);
 if(i===0){p.rect(7,12,9,2,'#a36778');p.rect(11,14,2,5,'#864a61');p.px(8,14,'#e3b66b');}
 if(i===1){p.rect(8,13,7,8,'#765036');p.line(9,14,9,18,'#bb8c55');p.rect(9,18,5,2,'#412d29');p.px(10,14,'#e4b765');p.px(14,14,'#e4b765');}
 if(i===2){p.poly([8,12,11,14,14,12],fur[3]);p.line(7,13,15,20,'#775641');}
 // Top-down crown and ear tufts; a one-pixel silhouette matching combat outlines.
 const hx=11;
 p.poly(side?[7,7,7,2,11,5,14,5,16,2,17,8]:[5,7,5,1,9,4,13,4,17,1,17,7],fur[1]);
 p.px(side?8:6,3,'#d69992');p.px(side?15:16,3,'#b97e88');
 p.ellipse(11.5,8.5,side?6:6.5,4.5,fur[1]);p.ellipse(10.5,7.5,side?5:5.5,3.5,fur[2]);
 p.line(hx-3,4,hx+1,3,fur[3]);p.px(hx-6,9,fur[2]);p.px(hx+6,9,fur[1]);
 if(i===1){p.line(hx-2,4,hx-1,6,fur[0]);p.line(hx+2,4,hx+2,6,fur[0]);p.px(hx-5,8,fur[0]);}
 if(back){
  if(i===0){p.poly([6,12,11,15,17,12,15,17,8,17],cloth[2]);p.line(8,13,11,15,cloth[0]);}
  if(i===1){p.line(8,13,15,19,'#bb8c55');p.line(15,13,8,19,'#bb8c55');}
  if(i===2){p.rect(13,15,5,5,'#6b493e');p.rect(14,16,3,2,'#a37a50');}
 }else{
  p.ellipse(side?8.5:11.5,11.5,side?3.5:4.5,1.5,fur[3]);
  const eyes=side?[8]:[8,13];for(const x of eyes){
   if(blink||i===1)p.line(x-1,8,x+1,8,ink);
   else {p.rect(x,7,2,3,ink);p.px(x,7,'#fff6d9');p.px(x+1,9,i===2?'#7fb4b0':'#c9964e');}
  }
  if(i===2){for(const x of eyes)p.rectOutline(x-1,6,4,5,'#c5a368');if(!side)p.line(11,8,12,8,'#c5a368');}
  p.px(side?5:11,10,'#b87f88');p.line(side?6:10,12,side?8:12,12,'#926567');
  if(i===0){p.rect(17,15,4,6,'#8d6337');p.rect(18,16,2,4,'#ffc960');p.px(18,17,'#fff1b9');p.line(18,13,20,13,'#b99656');p.px(17,14,fur[2]);}
  if(i===1){p.rect(5,15,3,3,fur[2]);p.line(16,17,19,14,'#be9464');p.rect(17,12,5,3,'#777986');p.line(17,12,20,12,'#b4b2b0');}
  if(i===2){p.rect(14,15,6,6,'#632f3b');p.line(15,15,18,15,'#d0bb8a');p.px(17,17,'#bb9253');p.rect(13,18,2,2,fur[2]);}
 }
 p.outline('#0c0810');const art=p.toCanvas();cache.set(key,art);return art;
}
