import { expect, it } from 'vitest';
import { actorFramePlacement } from '../src/ui/pixel-actor-layout';

it('moves Bern and Serin left by exactly one native pixel at every frame size', () => {
  for (const actor of ['bern', 'serin']) for (const width of [32, 40, 44]) {
    for (const frame of ['south', 'east', 'walk-south-0', 'walk-east-3']) {
      const p=actorFramePlacement(`${actor}/${frame}`,width,width,width-3);
      expect(p.x - p.width/2).toBe(-width/2-1);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x+width).toBeLessThanOrEqual(p.width);
      expect(p.y+width-3).toBe(p.height-1);
    }
  }
});

it('leaves unflagged actors at their existing horizontal origin', () => {
  for (const actor of ['ria','baekgu-fixed','lume']) {
    expect(actorFramePlacement(`${actor}/south`,32,32,29)).toEqual({width:32,height:32,x:0,y:2});
  }
});
