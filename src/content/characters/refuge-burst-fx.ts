import type { Renderer } from '../../engine/renderer';

/** Layered procedural release effects, sampled from age; no particles or gameplay RNG. */
export function drawReagentBurst(r:Renderer,x:number,y:number,t:number):void {
 if(t<.26){
  const k=t/.26;
  for(let i=0;i<2;i++){
   const angle=k*4.5+i*Math.PI,radius=30*(1-k)+4;
   const vx=x+Math.cos(angle)*radius,vy=y-8+Math.sin(angle)*radius*.65;
   const color=i?'#ffb361':'#b3e77c';
   for(let j=1;j<=5;j++){const a=angle-j*.2;r.rect(x+Math.cos(a)*(radius+j),y-8+Math.sin(a)*(radius+j)*.65,2,2,color,(1-j/6)*.65);}
   r.rect(vx-3,vy-3,7,8,'#282033');r.rect(vx-2,vy-2,5,6,color);
   r.rect(vx-1,vy-6,3,4,'#dae6db');r.rect(vx-2,vy-7,5,2,'#ad8962');
   r.rect(vx-2,vy-2,1,3,'#fff7d6');r.rect(vx,vy+1,3,2,i?'#df6b38':'#68ab78');
  }
  r.ring(x,y-8,5+k*6,'#d9edba',1,k*.7);
  return;
 }
 const age=t-.26,k=Math.min(1,age/.64),fade=Math.pow(1-k,.8);
 const radius=12+98*(1-Math.pow(1-Math.min(1,age/.27),3));
 // The reaction has a bright, brief core; the expanding edge stays hollow.
 if(age<.12){const flash=1-age/.12;r.circle(x,y-4,8+age*160,'#ffefbe',flash*.7);r.ring(x,y-4,12+age*190,'#ffffff',2,flash);}
 const wave=Math.max(0,1-age/.3);
 r.ring(x,y,radius,'#d7edb0',2,wave*.65);
 r.ring(x,y,radius-5,'#edbe89',1,wave*.35);
 for(let i=0;i<22;i++){
  const angle=i*2.399963+.13,cs=Math.cos(angle),sn=Math.sin(angle);
  const distance=radius*(.35+(i*7%13)/20),px=x+cs*distance,py=y+sn*distance-age*(4+i%4*5);
  const size=(4+i%5)*(1-k)+1,color=i%2?'#e8a261':'#94c77e';
  r.circle(px,py,size+3,'#776099',fade*.2);
  r.circle(px,py,size,color,fade*.65);
  r.circle(px-cs*2,py-sn*2,size*.55,i%2?'#ffe3a0':'#d0ecb0',fade*.8);
  r.rect(px-1,py-2,2,3,'#fff2ce',fade*.85);
  r.rect(px+cs*(size+3),py+sn*(size+3),2,2,color,fade*.75);
 }
 // Reagent sparks break away from the wave instead of leaving a uniform circle.
 for(let i=0;i<12;i++){
  const angle=i*Math.PI/6-.2,d=24+Math.min(1,age/.35)*(64+i%3*8);
  const px=x+Math.cos(angle)*d,py=y+Math.sin(angle)*d-age*12;
  r.rect(px-1,py-1,3,2,i%2?'#e9c783':'#c3e9a2',fade);
  if(i%3===0)r.rect(px,py-2,1,4,'#fff5d2',fade*.7);
 }
}

export function drawCrossBlades(r:Renderer,x:number,y:number,t:number,aim:number):void {
 for(let i=0;i<3;i++){
  const k=(t-[.04,.14,.24][i])/[.27,.27,.34][i];if(k<0||k>1)continue;
  const direction=i===1?-1:1,offset=[-.25,.25,0][i];
  const head=aim+offset+direction*(-1.3+Math.min(1,k*2.4)*2.6);
  const opacity=Math.min(1,(1-k)*1.7),reach=i===2?114:108;
  const edge=i===1?'#dcf2fa':'#ffe5d2',body=i===1?'#b3badf':'#ed9dad';
  // A tapered blade with a colored back and white cutting edge, not a filled sector.
  for(let j=0;j<24;j++){
   const a=head-direction*j*.052,b=a-direction*.058,tail=1-j/24;
   const ax=x+Math.cos(a)*reach,ay=y+Math.sin(a)*reach;
   const bx=x+Math.cos(b)*reach,by=y+Math.sin(b)*reach;
   r.line(ax,ay,bx,by,'#874b79',(i===2?13:10)*tail+1,opacity*.3*tail);
   r.line(ax,ay,bx,by,body,(i===2?7:5)*tail+1,opacity*.85*tail);
   r.line(x+Math.cos(a)*(reach+2),y+Math.sin(a)*(reach+2),x+Math.cos(b)*(reach+2),y+Math.sin(b)*(reach+2),edge,2,opacity*tail);
  }
  const tipX=x+Math.cos(head)*reach,tipY=y+Math.sin(head)*reach;
  r.rect(tipX-2,tipY-1,5,2,'#fff8df',opacity);r.rect(tipX,tipY-3,1,6,'#fff8df',opacity*.8);
 }
 // Two short crossing cuts punctuate the third strike close to the impact area.
 const end=(t-.24)/.22;
 if(end>=0&&end<1){
  const cx=x+Math.cos(aim)*68,cy=y+Math.sin(aim)*68,fade=1-end;
  for(const side of [-1,1]){
   const a=aim+side*.8,len=18+end*12;
   r.line(cx-Math.cos(a)*len,cy-Math.sin(a)*len,cx+Math.cos(a)*len,cy+Math.sin(a)*len,'#d582a2',5,fade*.65);
   r.line(cx-Math.cos(a)*len,cy-Math.sin(a)*len,cx+Math.cos(a)*len,cy+Math.sin(a)*len,'#fff0d9',2,fade);
  }
 }
}
