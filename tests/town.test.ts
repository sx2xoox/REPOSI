import { createTownResidents, updateTownResidents } from '../src/game/town-life';
import { expect, it } from 'vitest';
import { TOWN_ZONES, TOWN_RESIDENTS, townPath, townWalkable } from '../src/game/town-layout';
import { storyObjective } from '../src/game/story';

it('reaches every resident and facility from spawn without cutting through a building', () => {
  for (const target of [...TOWN_ZONES, ...TOWN_RESIDENTS]) {
    const path = townPath(384, 270, target.x, target.y + 12);
    expect(path.length).toBeGreaterThan(0);
    expect(path.every(p => townWalkable(p.x, p.y))).toBe(true);
    expect(path.at(-1)).toEqual({ x: target.x, y: target.y + 12 });
  }
  expect(townPath(384,270,-50,40)).toEqual([]);
  expect(townPath(384,270,160,170)).toEqual([]);
});

it('keeps chapter goals tied to discovered clues and pending return conversations', () => {
  expect(storyObjective({seen:[],cleared:0,pending:0}).title).toContain('1-3');
  expect(storyObjective({seen:['boss:1'],cleared:0,pending:0}).title).toContain('2-3');
  expect(storyObjective({seen:[],cleared:4,pending:4}).title).toContain('마을');
  expect(storyObjective({seen:[],cleared:4,pending:0}).title).toContain('5-3');
  expect(storyObjective({seen:[],cleared:7,pending:0}).title).toContain('남아');
});

it('resident routines stay on walkable paths and pause to face a nearby keeper',()=>{
 const people=createTownResidents(),initial=people.map(p=>[p.x,p.y]);
 for(let tick=0;tick<3600;tick++){updateTownResidents(people,1/60,384,365);for(const p of people)expect(townWalkable(p.x,p.y),p.name).toBe(true);}
 expect(people.some((p,i)=>p.x!==initial[i][0]||p.y!==initial[i][1])).toBe(true);
 const p=people[0],x=p.x,y=p.y;updateTownResidents(people,1,p.x+20,p.y);expect(p.x).toBe(x);expect(p.y).toBe(y);expect(p.facing).toBe('side');expect(p.moving).toBe(false);
});
