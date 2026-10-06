import { describe, expect, it } from 'vitest';
import type { Player } from '../src/game/player';
import { visualHandPos } from '../src/game/weapon-pose';
import { handPos } from '../src/content/weapons/common';

const keeper = (aim: number, prefix = 'pl_ria') => ({
  x: 100, y: 80, aim, character: { spritePrefix: prefix },
}) as Player;

describe('PixelLab weapon grip', () => {
  it('rotates a resting weapon around the paw rather than orbiting the entire hand', () => {
    const p = keeper(0);
    const grip = visualHandPos(p, 0, 5);
    for (const angle of [Math.PI / 2, Math.PI, -Math.PI / 2]) {
      expect(visualHandPos(p, angle, 5)).toEqual(grip);
    }
    expect(grip.x).toBeGreaterThan(p.x);
    expect(grip.y).toBeLessThan(p.y);
  });
  it('keeps the free paw offset from the front-facing lantern and extends from that grip', () => {
    const p = keeper(Math.PI / 2);
    const grip = visualHandPos(p, p.aim, 5);
    const extended = visualHandPos(p, p.aim, 15);
    expect(grip.x).toBeLessThan(p.x);
    expect(extended.x).toBeCloseTo(grip.x);
    expect(extended.y - grip.y).toBeCloseTo(8);
  });
  it('does not make projectile origins depend on loaded artwork', () => {
    for (const angle of [0, Math.PI / 4, Math.PI, -Math.PI / 2]) {
      expect(handPos(keeper(angle), angle, 17)).toEqual(handPos(keeper(angle, 'ria'), angle, 17));
      expect(visualHandPos(keeper(angle, 'ria'), angle, 17)).toEqual(handPos(keeper(angle, 'ria'), angle, 17));
    }
  });
});
