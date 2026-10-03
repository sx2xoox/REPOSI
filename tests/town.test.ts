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
  expect(storyObjective({seen:[],cleared:0,pending:0}).title).toContain('1-4');
  expect(storyObjective({seen:['boss:1'],cleared:0,pending:0}).title).toContain('2-4');
  expect(storyObjective({seen:[],cleared:4,pending:4}).title).toContain('마을');
  expect(storyObjective({seen:[],cleared:4,pending:0}).title).toContain('5-4');
  expect(storyObjective({seen:[],cleared:7,pending:0}).title).toContain('남아');
});
