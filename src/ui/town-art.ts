import { PixelPainter } from '../engine/painter';

import { Themes } from '../game/defs';
import { RNG } from '../engine/rng';
import { TOWN_W, TOWN_H } from '../game/town-layout';
import { TILE } from '../game/constants';
import { hash2, vnoise, rampPick, themeArt, paintMasonry, shadePx, blendPx, shadowEllipse } from '../game/roomart';
import { rectRug } from '../content/rooms/decor';

let cached: HTMLCanvasElement | null = null;
export { residentArt } from './town-residents';
/** Static scenery is rasterized once; animated light stays in the scene. */
export function townArt(): HTMLCanvasElement {
  if (cached) return cached;
  const p = new PixelPainter(TOWN_W, TOWN_H);
  const n = (x: number, y: number, salt = 0) => {
    let v = Math.imul(x + salt * 71, 374761393) ^ Math.imul(y + 97, 668265263);
    v = Math.imul(v ^ (v >>> 13), 1274126177); return (v ^ (v >>> 16)) >>> 0;
  };
  p.rect(0, 0, TOWN_W, TOWN_H, '#101e29');
  const theme = Themes.get('crypt')!, masonry = themeArt(theme);
  const tile = new PixelPainter(TILE, TILE);
  for(let ty=0;ty<TOWN_H/TILE;ty++)for(let tx=0;tx<TOWN_W/TILE;tx++){
    theme.paintFloor!(tile,tx,ty,new RNG(tx*977+ty*7919+71));p.blit(tile,tx*TILE,ty*TILE);
  }
  // Ruined sanctuary walls keep the exact masonry, bevel and dither language of the dungeon.
  paintMasonry(p,masonry,0,20,TOWN_W,37,170);
  paintMasonry(p,masonry,0,57,18,324,170,true);
  paintMasonry(p,masonry,TOWN_W-18,57,18,324,170,true);
  p.rect(0,0,TOWN_W,20,'#100e19');
  for(let x=0;x<TOWN_W;x+=16){p.rect(x,17,15,4,'#504b60');p.line(x+1,17,x+13,17,'#767080');}
  for(const x of [24,247,495,744]){
    paintMasonry(p,masonry,x-5,12,10,54,81);
    p.rect(x-7,12,14,4,'#514b62');p.line(x-6,12,x+6,12,'#8b8193');
    shadowEllipse(p,x+8,68,16,5,.35);
  }
  for(let y=55;y<381;y++)for(let x=19;x<TOWN_W-18;x++){
    const edge=Math.min(x-18,TOWN_W-18-x,y-54,382-y);
    if(edge<16)shadePx(p,x,y,(1-edge/16)*.45);
    const moss=vnoise(x/13,y/10,117);
    if(edge<27&&moss>.59)blendPx(p,x,y,'#3d5145',(moss-.59)*1.7);
  }
  rectRug(p,135,215,48,27,['#301721','#502533','#783745','#a05f62'],'#bd9a6b');
  rectRug(p,564,207,51,28,['#18232c','#283a48','#405667','#617889'],'#b4a07b');
  const window = (x: number, y: number, w = 8) => {
    p.rect(x - 3,y-3,w+6,17,'#5b5365'); p.line(x-3,y-3,x+w+2,y-3,'#948497'); p.rect(x - 2, y - 2, w + 4, 15, '#17131f'); p.rect(x - 1, y - 1, w + 2, 13, '#95775a');
    p.rect(x, y, w, 10, '#ce9a59'); p.rect(x + 1, y + 1, w - 2, 4, '#f0c681');
    p.line(x + w / 2, y, x + w / 2, y + 10, '#58483b'); p.line(x, y + 5, x + w, y + 5, '#58483b');
    p.rect(x - 3, y + 12, w + 6, 2, '#aaa08a'); p.rect(x - 3, y + 14, w + 6, 2, '#393d3b');
  };
  const house = (x: number, y: number, w: number, roof: string[], kind: number) => {
    const h = kind === 1 ? 34 : 37;
    // The footprint has real depth: a front face, a receding right face and a broad roof plane.
    shadowEllipse(p,x+w*.58+7,y+h+4,w*.64,10,.55);
    const frontW=w-10, sideW=17;
    paintMasonry(p,masonry,x,y,frontW,h,kind*117+21);
    const side=new PixelPainter(sideW,h);
    paintMasonry(side,masonry,0,0,sideW,h,kind*117+21,true);
    for(let dx=0;dx<sideW;dx++)for(let dy=0;dy<h;dy++){
      const xx=x+frontW+dx, yy=y+dy-Math.round(dx*.6);
      if(p.inBounds(xx,yy))p.data[yy*p.w+xx]=side.data[dy*sideW+dx];
    }
    for(const dx of [0,frontW-3]){
      p.rect(x+dx,y,3,h,'#24202c');p.line(x+dx,y+3,x+dx,y+h-2,'#827080');
    }
    // Deep lintel and shaded lower sill, continuous into the receding side wall.
    for(let sy=0;sy<8;sy++)for(let sx=3;sx<frontW-3;sx++)shadePx(p,x+sx,y+sy,.66-sy*.055);
    p.rect(x-1,y+h-4,frontW+2,5,'#34313f');p.line(x,y+h-4,x+frontW,y+h-4,'#82788a');
    p.poly([x+frontW,y+h-4,x+frontW+sideW,y+h-14,x+frontW+sideW,y+h-9,x+frontW,y+h+1],'#252331');
    p.line(x+frontW,y+h-4,x+frontW+sideW,y+h-14,'#585468');
    const top=y-27, left=x-7, right=x+frontW+5;
    // Roof ridge is a horizontal span seen from above, not a triangular house icon.
    p.poly([left,y+3,x+7,top,x+frontW-3,top,x+frontW+sideW+5,y-11,right,y+3],'#100d19');
    for(let yy=top;yy<=y+2;yy++){
      const t=(yy-top)/(y+2-top), l=Math.ceil(x+7+(left-x-7)*t), rr=Math.floor(x+frontW-3+(right-x-frontW+3)*t);
      for(let xx=l;xx<=rr;xx++){
        const row=Math.floor((yy-top)/4), tile=Math.floor((xx+row%2*4)/8);
        const sy=(yy-top)%4,sx=(xx+row%2*4)%8;
        let level=1.35+(hash2(tile,row,kind+4)-.5)*.65+(hash2(xx,yy,41)-.5)*.35;
        if(sy===0)level+=.55; if(sy===3||sx===0)level-=.9;
        p.px(xx,yy,rampPick([roof[3],roof[0],roof[1],roof[2]],level,xx,yy));
      }
    }
    // Right hip is a distinctly darker, receding plane.
    p.poly([x+frontW-3,top,x+frontW+sideW+5,y-11,right,y+3],'#1c1a2a');
    for(let j=1;j<7;j++){
      const t=j/7;
      const ax=x+frontW-3+(right-x-frontW+3)*t, ay=top+(y+3-top)*t;
      const bx=x+frontW-3+(sideW+8)*t, by=top+(y-11-top)*t;
      p.line(ax,ay,bx,by,roof[0]);
    }
    p.line(x+7,top,x+frontW-3,top,roof[2]);
    p.line(x+frontW-3,top,x+frontW+sideW+5,y-11,roof[1]);
    p.line(x+frontW-3,top,right,y+3,roof[1]);
    // Thick overhanging eaves cast a readable shadow onto the facade.
    p.poly([left,y+3,right,y+3,right,y+7,left+1,y+7],'#211c2b');
    p.line(left,y+3,right,y+3,roof[1]);p.line(left+1,y+5,right,y+5,'#393040');
    p.poly([right,y+3,x+frontW+sideW+5,y-11,x+frontW+sideW+5,y-7,right,y+7],'#151321');
    const chimney=x+frontW-13;
    paintMasonry(p,masonry,chimney,top-9,8,17,90);
    p.poly([chimney+8,top-9,chimney+12,top-12,chimney+12,top+4,chimney+8,top+8],'#242131');
    p.poly([chimney-2,top-10,chimney+3,top-13,chimney+13,top-13,chimney+8,top-10],'#8b8291');
    p.rect(chimney-2,top-10,10,3,'#60576b');p.rect(chimney+1,top-12,7,1,'#14121c');
    const door = x + Math.floor(w * .47);
    p.rect(door - 9,y+10,20,h-10,'#656071');p.rect(door-8,y+11,18,h-11,'#292432');p.line(door-9,y+11,door-9,y+h-1,'#8b7f90');p.rect(door - 7, y + 12, 16, h - 12, '#16131e'); p.rect(door - 5, y + 14, 12, h - 14, '#574639');
    for (let j = 0; j < 3; j++) p.line(door - 4 + j * 4, y + 15, door - 4 + j * 4, y + h - 2, '#927253');
    p.rect(door - 5, y + 20, 12, 2, '#342f30'); p.px(door + 4, y + 27, '#e2bd70');
    p.rect(door - 10, y + h, 23, 3, '#9b9982'); p.rect(door - 12, y + h + 3, 27, 3, '#626d65'); p.line(door - 11, y + h + 3, door + 13, y + h + 3, '#afb097');
    window(x + 8, y + 13);
    if (kind !== 1) window(x + w - 25, y + 13, 7);
    // Each service building has its own silhouette and craft props.
    if (kind === 0) {
      p.rect(x - 8, y + 16, 21, 3, '#544337');
      p.poly([x - 11, y + 16, x - 7, y + 6, x + 13, y + 6, x + 17, y + 16], '#604650');
      for (let xx = x - 7; xx < x + 14; xx += 6) p.poly([xx, y + 7, xx + 3, y + 7, xx + 4, y + 16, xx, y + 16], '#a07b6b');
      p.rect(x - 8, y + 19, 2, 23, '#836849'); p.rect(x + 13, y + 19, 2, 23, '#463d35');
      p.rect(x - 6, y + 34, 20, 3, '#ac8960'); p.rect(x - 4, y + 29, 5, 5, '#465d63');
      p.line(x + 4, y + 26, x + 7, y + 33, '#bec0a0'); p.rect(x + 5, y + 26, 7, 2, '#687d80');
    }
    if (kind === 2) {
      p.rect(x + w + 1, y + 12, 2, 25, '#90785a'); p.line(x + w - 5, y + 12, x + w + 8, y + 12, '#b49464');
      p.rect(x + w + 3, y + 15, 9, 13, '#304e53'); p.rect(x + w + 4, y + 16, 7, 9, '#72918b');
      p.line(x + w + 6, y + 18, x + w + 6, y + 22, '#e0cf9a');
      p.rect(x - 5, y + h + 3, 18, 6, '#463b37');
      for (let j = 0; j < 5; j++) p.rect(x - 4 + j * 3, y + h, 2, 7, ['#758c83', '#9e6f59', '#c1a273'][j % 3]);
    }
  };
  house(118, 168, 80, ['#513442', '#74505c', '#a17676', '#261b2b'], 0);
  house(302, 95, 70, ['#35384f', '#505771', '#7c8098', '#1d1c30'], 1);
  house(543, 156, 86, ['#32444a', '#4c6263', '#758880', '#18252f'], 2);
  // Raised lantern court: thick stone steps, iron arch and worn bronze crest.
  shadowEllipse(p,388,222,34,12,.55);
  for(let step=0;step<3;step++){
    p.ellipse(384,215-step*4,30-step*4,10-step*2,'#34303f');
    p.ellipse(384,213-step*4,30-step*4,9-step*2,'#71687d');
    p.ellipse(384,212-step*4,28-step*4,7-step*2,'#474153');
  }
  for(const x of [364,405]){
    paintMasonry(p,masonry,x,174,5,33,200);p.rect(x-3,207,11,5,'#8a7d8c');
  }
  p.poly([364,176,367,163,378,157,393,157,405,164,410,176,403,172,398,165,377,165,370,173],'#756678');
  p.line(371,163,398,161,'#c3aa85');p.line(384,163,384,188,'#ad8d58');p.circle(384,158,3,'#d6b87c');
  // Garden beds and benches form two lanes leading toward the cooperative dock.
  for(const [x,y,w] of [[256,275,63],[440,276,56]]){
    paintMasonry(p,masonry,x,y,w,18,73);p.rect(x+2,y+1,w-4,5,'#1c1b29');
    for(let j=4;j<w-3;j+=5){p.ellipse(x+j,y+1,4,4,'#30433f');p.line(x+j-2,y-1,x+j+1,y-2,'#6c7f60');}
  }
  for(const [x,y] of [[127,241],[652,205],[285,132],[655,341]]){
    shadowEllipse(p,x+3,y+7,9,4,.45);p.ellipse(x,y,7,4,'#9a7754');p.rect(x-7,y,14,10,'#755339');
    p.ellipse(x,y+9,7,3,'#59423a');p.ellipse(x,y,6,3,'#b39363');
    p.line(x-5,y+3,x+5,y+3,'#9f9690');p.line(x-5,y+8,x+5,y+8,'#343341');
  }
  for(const [x,y] of [[332,331],[451,131]]){
    p.poly([x,y,x+5,y-5,x+36,y-5,x+31,y],'#9e8061');p.rect(x,y,31,4,'#604838');
    p.rect(x+3,y+4,3,7,'#322934');p.rect(x+26,y+4,3,7,'#322934');
  }
  p.rect(0,386,TOWN_W,46,'#101d32');
  for(let y=389;y<TOWN_H;y+=4)for(let x=0;x<TOWN_W;x+=13){const k=n(x,y);if(k%3)p.line(x,y,x+4+k%7,y,k%2?'#23354d':'#304660');}
  for(let x=0;x<TOWN_W;x+=14){paintMasonry(p,masonry,x,376,13,11,x+17);p.line(x,375,x+12,375,'#847b8d');}
  for(let y=340;y<416;y+=5){
    p.rect(539,y,75,4,'#5c443c');p.line(539,y,613,y,'#a38363');
    for(let x=542;x<611;x+=15){p.px(x,y+2,'#222131');p.line(x+3,y+2,x+10,y+2,'#735444');}
  }
  for(const x of [536,613])for(const y of [346,384,411]){
    p.rect(x,y,5,13,'#45333a');p.ellipse(x+2,y,4,2,'#b69768');p.line(x+1,y+3,x+1,y+10,'#8c6b50');
  }
  p.poly([634,399,650,388,668,398,660,419,641,419],'#8c694b');
  p.poly([638,399,650,392,664,399,658,414,644,414],'#242a37');
  p.line(641,400,661,407,'#c4aa7c');p.line(655,394,645,421,'#d1b985');
  for(const [cx,cy,radius] of [[40,113,13],[714,97,16],[54,328,21],[704,323,21],[232,105,10],[489,338,11]]){
    shadowEllipse(p,cx+5,cy+9,radius+4,6,.45);
    for(let j=0;j<9;j++){
      const x=cx+(hash2(j,cx,4)-.5)*radius*1.6,y=cy+(hash2(j,cy,7)-.5)*radius;
      p.ellipse(x,y,5+j%4,5+j%3,'#182730');p.shadeSphere(x,y,5+j%4,5+j%3,['#101821','#1c2c31','#30403e','#4d5b4c','#758064']);
    }
  }
  return cached = p.toCanvas();
}
