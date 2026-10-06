export const TOWN_W = 768;
export const TOWN_H = 432;
export const TOWN_ZONES = [
  { x: 384, y: 232, title: '중앙 등불', sub: '원정 출발' },
  { x: 161, y: 244, title: '등불지기의 집', sub: '캐릭터 준비' },
  { x: 584, y: 207, title: '귀환 기록실', sub: '기억 · 도감' },
  { x: 576, y: 359, title: '동행의 부두', sub: '협동 방 만들기 · 참가' },
];
export const TOWN_RESIDENTS = [
  { x: 347, y: 250, name: '루메' }, { x: 211, y: 246, name: '브릭' }, { x: 629, y: 225, name: '오린' },
];
const SOLID = [
  [111, 132, 103, 80], [295, 55, 92, 88], [536, 119, 110, 81],
  [78,286,39,22], [670,270,39,22], [332,331,31,10], [451,131,31,10],
  [207,200,48,28],
  // Ground footprints only; the taller artwork may overlap a keeper behind it.
  [143,239,44,7],
  [118,241,18,11], [643,205,18,11], [276,132,18,11], [646,341,18,11],
  [359, 163, 51, 55], [256, 275, 63, 20], [440, 276, 56, 20],
] as const;
export function townWalkable(x: number, y: number, radius = 5): boolean {
  if (x < 28 + radius || x > TOWN_W - 28 - radius || y < 67 + radius || y > 381 - radius) return false;
  return !SOLID.some(([sx, sy, w, h]) => x + radius > sx && x - radius < sx + w && y + radius > sy && y - radius < sy + h);
}
/** Small eight-neighbour path for click/tap walking; never teleports through a building. */
export function townPath(sx: number, sy: number, tx: number, ty: number): { x: number; y: number }[] {
  if(!townWalkable(tx,ty)||!townWalkable(sx,sy))return [];
  const cell = 8, cols = TOWN_W / cell, rows = TOWN_H / cell;
  const at = (x: number, y: number) => Math.floor(y / cell) * cols + Math.floor(x / cell);
  const start = at(sx, sy), goal = at(tx, ty);
  const prev = new Int32Array(cols * rows).fill(-1), queue = [start]; prev[start] = start;
  const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
  for(let head=0;head<queue.length;head++){
    const id=queue[head]; if(id===goal)break;
    const x=id%cols, y=Math.floor(id/cols);
    for(const [dx,dy] of dirs){
      const nx=x+dx,ny=y+dy,ni=ny*cols+nx;
      if(nx<0||ny<0||nx>=cols||ny>=rows||prev[ni]!==-1)continue;
      if(!townWalkable(nx*cell+4,ny*cell+4))continue;
      if(dx&&dy&&(!townWalkable(nx*cell+4,y*cell+4)||!townWalkable(x*cell+4,ny*cell+4)))continue;
      prev[ni]=id;queue.push(ni);
    }
  }
  if(prev[goal]===-1)return [];
  const result=[];
  for(let id=goal;id!==start;id=prev[id])result.push({x:(id%cols)*cell+4,y:Math.floor(id/cols)*cell+4});
  result.reverse(); if(townWalkable(tx,ty))result.push({x:tx,y:ty}); return result;
}
