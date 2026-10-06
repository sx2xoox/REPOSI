import { sceneryArt } from './pixellab-scenery';
import type { Renderer } from '../engine/renderer';
/** Small scene layers remain native-pixel crisp, independent of the cached ground. */
export function drawTownAtmosphere(r:Renderer,t:number,cleared:number):void {
 // Chimney smoke rises and unravels above occupied homes.
 for(const [j,[x,y]] of [[171,134],[339,61],[602,122]].entries())for(let i=0;i<5;i++){
  const age=(t*.22+i*.2+j*.13)%1;
  const sx=Math.round(x+Math.sin(age*5+j)*4+age*8),sy=Math.round(y-age*28);
  r.rect(sx,sy,3+Math.floor(age*4),2+Math.floor(age*3),'#8d8190',.21*(1-age));
 }
 // Moving water reflections stay below the bank; warm glints gather around the dock.
 for(let i=0;i<20;i++){
  const x=24+i*37+Math.sin(t*.5+i)*5,y=393+i%4*9;
  r.line(Math.round(x),y,Math.round(x)+5+i%4,y,i>13?'#9c7c59':'#527086',.5,.18+.08*Math.sin(t+i));
 }
 // Laundry between two posts sways by one pixel; its silhouette reads above the courtyard.
 if(!sceneryArt('town_laundry')){
 r.line(67,193,103,190,'#827460',1,.8);
 for(let i=0;i<3;i++){
  const x=73+i*10,y=193+Math.round(Math.sin(t*1.4+i));
  r.rect(x,y,6,7,['#867489','#af977c','#638889'][i],.9);r.line(x+1,y+1,x+1,y+5,'#d8c9ae',1,.35);
 }
 }
 // Forge work: a contained glow, a few sparks, no combat VFX noise.
 const beat=t%4.8;
 r.rect(216,223,7,3,'#e39454',.55+.12*Math.sin(t*3));
 if(beat<.7)for(let i=0;i<3;i++)r.rect(Math.round(219+i*3+beat*7),Math.round(219-beat*15+i),1,1,'#edbd71',1-beat);
 // Moths move around the safe light. Additional restored lamps draw more life into town.
 for(let i=0;i<3+Math.min(4,Math.max(0,cleared-3));i++){
  const x=384+Math.cos(t*.6+i*2)*24,y=189+Math.sin(t*.9+i*2)*9;
  r.rect(Math.round(x),Math.round(y),1,1,'#e6d8a9',.6);if(Math.sin(t*9+i)>0)r.rect(Math.round(x)+1,Math.round(y)-1,1,1,'#9f9e8a',.5);
 }
}
