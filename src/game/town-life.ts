import { TOWN_RESIDENTS, townPath, townWalkable } from './town-layout';
/** Local town simulation: residents keep small routines, but stop to greet approaching keepers. */
export interface TownResident { x:number; y:number; name:string; facing:'down'|'up'|'side'; flip:boolean; moving:boolean; wait:number; route:number; path:{x:number;y:number}[]; }
const ROUTES = [
 [[347,250],[328,233],[347,250],[369,260]],
 [[211,246],[192,244],[211,246],[235,255]],
 [[629,225],[619,247],[600,231],[629,225]],
];
export function createTownResidents(): TownResident[] {
 return TOWN_RESIDENTS.map((n,i)=>({...n,facing:'down',flip:false,moving:false,wait:3+i*2,route:0,path:[]}));
}
export function updateTownResidents(residents:TownResident[],dt:number,px:number,py:number):void {
 for(const [i,n] of residents.entries()) {
  const dx=px-n.x,dy=py-n.y;
  if(Math.hypot(dx,dy)<58){n.moving=false;n.facing=Math.abs(dx)>Math.abs(dy)?'side':dy< -8?'up':'down';n.flip=dx>0;continue;}
  if(n.wait>0){n.wait-=dt;n.moving=false;continue;}
  if(!n.path.length){n.route=(n.route+1)%ROUTES[i].length;const [x,y]=ROUTES[i][n.route];n.path=townPath(n.x,n.y,x,y);if(!n.path.length){n.wait=4;continue;}}
  const next=n.path[0],vx=next.x-n.x,vy=next.y-n.y,d=Math.hypot(vx,vy),step=Math.min(d,(i===1?18:14)*dt);
  if(d<.2){n.path.shift();if(!n.path.length)n.wait=4+i*1.5;continue;}
  const x=n.x+vx/d*step,y=n.y+vy/d*step;
  if(townWalkable(x,y)){n.x=x;n.y=y;n.moving=true;n.facing=Math.abs(vx)>Math.abs(vy)?'side':vy<0?'up':'down';n.flip=vx>0;}else{n.path=[];n.wait=2;n.moving=false;}
 }
}
