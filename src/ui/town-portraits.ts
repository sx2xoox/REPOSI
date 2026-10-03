import riaPortraitUrl from '../assets/npc/ria-portrait.png';
import portraitUrl from '../assets/npc/resident-portraits.png';
import { PixelPainter } from '../engine/painter';

let sheet: HTMLImageElement | null = null;
function portraitSheet(): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  if (!sheet) { sheet = new Image(); sheet.src = portraitUrl; }
  return sheet.complete && sheet.naturalWidth > 0 ? sheet : null;
}
let riaSheet: HTMLImageElement | null = null;
export const PORTRAIT_W=64, PORTRAIT_H=72;
// Shared material ramps: broad readable pixel clusters, without hundreds of resampling shades.
const PORTRAIT_PALETTE=[
 '#100c19','#211b2a','#363044','#514455',
 '#fff1d1','#f2d9b5','#d9b998','#bb9380','#916b67',
 '#ffe2a0','#efbd75','#dca05d','#bd7d43','#945531','#633b30',
 '#e1e6dc','#bbc7ce','#95a5b5','#738297','#515d76',
 '#a2b9b2','#739893','#527b82','#345866','#23404f','#182b3c',
 '#c5a2ae','#a17e97','#7e5c7e','#624561','#49334d','#32253b',
 '#d39e89','#b97978','#9b5763','#784153','#552e40',
 '#c8a16b','#a97e51','#89603f','#6a4835','#4b332e',
 '#ffe9a0','#f4c263','#d59b45','#a97535','#72512f',
 '#f5ddb6','#cab391','#a59079','#78685f'
].map(c=>[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)]);
/** A shared coarse pixel grid for every illustrated speaker; rasterized only once. */
function rasterPortrait(image:HTMLImageElement,sx:number,sy:number,sw:number,sh:number):HTMLCanvasElement {
  const art=document.createElement('canvas');art.width=PORTRAIT_W;art.height=PORTRAIT_H;
  const ctx=art.getContext('2d')!;ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  const scale=Math.min(PORTRAIT_W/sw,PORTRAIT_H/sh),dw=Math.round(sw*scale),dh=Math.round(sh*scale);
  ctx.drawImage(image,sx,sy,sw,sh,Math.floor((PORTRAIT_W-dw)/2),PORTRAIT_H-dh,dw,dh);
  const pixels=ctx.getImageData(0,0,PORTRAIT_W,PORTRAIT_H),data=pixels.data;
  for(let at=0;at<data.length;at+=4){
    if(data[at+3]<128){data[at+3]=0;continue;}
    let best=PORTRAIT_PALETTE[0],score=Infinity;
    for(const color of PORTRAIT_PALETTE){const dr=data[at]-color[0],dg=data[at+1]-color[1],db=data[at+2]-color[2];const distance=dr*dr*2+dg*dg*3+db*db;if(distance<score){score=distance;best=color;}}
    data[at]=best[0];data[at+1]=best[1];data[at+2]=best[2];data[at+3]=255;
  }
  ctx.putImageData(pixels,0,0);
  return art;
}
export function keeperPortrait(character:string):HTMLCanvasElement|null {
  if(character!=='ria'||typeof Image==='undefined')return null;
  if(!riaSheet){riaSheet=new Image();riaSheet.src=riaPortraitUrl;}
  if(!riaSheet.complete||!riaSheet.naturalWidth)return null;
  const old=cache.get('ria');if(old)return old;
  const art=rasterPortrait(riaSheet,0,0,riaSheet.naturalWidth,riaSheet.naturalHeight);cache.set('ria',art);return art;
}
export function preloadTownPortraits(): void { portraitSheet();keeperPortrait('ria'); }
const cache = new Map<string, HTMLCanvasElement>();
export const RESIDENTS = [
  { name: '루메', role: '등불 관리인', accent: '#c6a0c8' },
  { name: '브릭', role: '귀환로 수리공', accent: '#d3ac76' },
  { name: '오린', role: '기억의 기록관', accent: '#92babe' },
] as const;

/** Original pixel busts using the shaded ramps and outlines of the combat art. */
export function townPortrait(i: number, blink: boolean, talking: boolean): HTMLCanvasElement {
  const atlas = portraitSheet();
  if (atlas) {
    const key = 'approved:'+i;
    const old = cache.get(key); if (old) return old;
    const [left,width]=[[0,640],[640,728],[1380,668]][i];
    const scale=atlas.naturalWidth/2048;
    const art=rasterPortrait(atlas,left*scale,0,width*scale,atlas.naturalHeight);
    cache.set(key,art); return art;
  }
  const key = `fallback:${i}:${Number(blink)}:${Number(talking)}`;
  const old = cache.get(key); if (old) return old;
  const p = new PixelPainter(64, 72);
  const cloth = [
    ['#16101e', '#302339', '#564361', '#816886', '#b79abc'],
    ['#1d151b', '#3c2930', '#644239', '#996948', '#c69e69'],
    ['#101a25', '#253441', '#3e5867', '#6b8c93', '#a3b6ae'],
  ][i];
  p.ellipse(31, 67, 26, 23, cloth[1]); p.shadeSphere(28, 62, 25, 24, cloth, { dither: false });
  p.poly([11, 51, 23, 46, 31, 60, 23, 71, 7, 71], cloth[2]);
  p.line(13, 55, 9, 69, cloth[3]); p.line(17, 59, 15, 71, cloth[1]);
  const fur=[['#997887','#cfb79f','#f4dfb9','#fff3d3'],['#965939','#cf8c48','#f2bb68','#ffdf9c'],['#525d7a','#8297ae','#becfd9','#e5ebdf']][i];
  // Pointed ears, a soft cheek silhouette and a cream muzzle: unmistakably cats.
  p.poly([10,25,8,2,25,15,42,14,56,2,54,29],fur[1]);
  p.poly([13,19,12,7,23,17], '#d49b9e');p.poly([44,17,53,7,51,23],'#c68e9c');
  p.line(10,4,10,13,fur[3]);p.line(53,4,55,16,fur[0]);
  p.ellipse(32,30,24,20,fur[1]);p.ellipse(29,27,22,18,fur[2]);
  p.ellipse(16,35,9,10,fur[2]);p.ellipse(47,35,8,10,fur[1]);
  p.ellipse(31,38,13,9,fur[3]);
  p.line(18,15,26,12,fur[3]);
  if(i===1){p.poly([27,12,31,12,31,20,29,22],fur[0]);p.poly([36,12,39,13,37,21,35,20],fur[0]);p.line(13,25,18,27,fur[0]);p.line(47,25,51,23,fur[0]);}
  if(i===2){p.poly([27,12,36,12,40,20,32,25,24,20],fur[0]);}
  if(blink){p.line(18,30,25,31,'#302236');p.line(39,31,46,30,'#302236');}
  else{
    p.ellipse(22,29,4,6,'#242235');p.ellipse(42,29,4,6,'#242235');
    p.rect(19,25,3,3,'#fff9df');p.rect(39,25,3,3,'#fff9df');
    p.px(23,33,i===2?'#87b2b7':'#bda16d');p.px(43,33,i===2?'#87b2b7':'#bda16d');
  }
  p.ellipse(15,36,3,2,'#dda2a0');p.ellipse(49,36,3,2,'#cc989a');
  p.poly([28,35,35,35,32,39],'#bc778b');p.px(29,35,'#efd1c7');
  p.line(32,39,32,41,'#845468');p.line(32,41,29,43,'#845468');p.line(32,41,35,43,'#845468');
  if(talking){p.ellipse(32,43,3,2,'#855166');p.px(32,44,'#e9a4af');}
  p.line(6,34,16,36,fur[0]);p.line(5,40,16,39,fur[0]);p.line(47,36,58,34,fur[0]);p.line(48,39,59,40,fur[0]);
  p.poly([20, 44, 28, 48, 42, 44, 43, 51, 32, 55, 21, 50], i === 0 ? '#b18c91' : cloth[3]);
  p.line(22, 46, 31, 50, i === 0 ? '#e0b8a6' : cloth[4]);
  if (i === 0) {
    p.poly([31, 52, 39, 52, 37, 71, 29, 71], '#8c5969'); p.line(32, 54, 30, 70, '#c38b91');
    p.rect(42, 55, 15, 16, '#392735'); p.rect(45, 57, 9, 11, '#d89745'); p.rect(47, 58, 5, 9, '#ffe5a0');
    p.rect(41, 54, 17, 3, '#9d764b'); p.line(47, 50, 52, 50, '#caaa6b'); p.line(46, 51, 46, 54, '#7a573c');
    p.px(15, 20, '#d3a76d'); p.px(16, 21, '#fff0b9');
  } else if (i === 1) {
    p.rect(20,8,25,3,'#80563c');p.line(22,8,42,8,'#cead77');

    p.poly([20, 51, 42, 52, 47, 71, 18, 71], '#664532'); p.line(22, 52, 20, 70, '#b08052');
    p.rect(24, 61, 16, 9, '#8b603e'); p.line(25, 62, 38, 62, '#b69261');
    p.line(45, 56, 51, 71, '#bba889'); p.rect(41, 52, 14, 5, '#48616a'); p.line(42, 52, 53, 52, '#c2c6af');
  } else {
    p.rectOutline(16, 23, 13, 13, '#c1b18a'); p.rectOutline(35, 23, 13, 13, '#c1b18a'); p.line(29, 28, 35, 28, '#e3cfa0');
    p.poly([37, 53, 55, 49, 59, 68, 41, 72], '#242438'); p.poly([39, 53, 53, 51, 56, 67, 42, 69], '#9a805b');
    p.line(41, 54, 52, 52, '#eddbb0'); p.line(43, 65, 54, 63, '#d5bc8e'); p.line(38, 54, 42, 70, '#46616d');
    p.line(13, 52, 17, 68, '#b1bbb0');
  }
  p.outline('#0c0810');
  const art = p.toCanvas(); cache.set(key, art); return art;
}
