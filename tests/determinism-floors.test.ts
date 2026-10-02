// More lockstep determinism scenarios (see determinism.test.ts): other keepers
// on the middle and last floors, so the two files run in parallel.

import './headless';
import { describe, it } from 'vitest';
import { NARROW, WIDE, checkScenario, type Scenario } from './detsim';

const SERIN: Scenario = {
  name: 'serin: floors 2-3', seed: 'DET-SERIN-2', character: 'serin', floors: [2, 3], exploreSteps: 1300, bossSteps: 1500, giftsPerFloor: 5,
  maxSteps: 7000, cycle: true, extraEnemies: 2,
};
const BERN: Scenario = {
  name: 'bern: floors 4-5', seed: 'DET-BERN-3', character: 'bern', floors: [4, 5], exploreSteps: 1200, bossSteps: 1500, giftsPerFloor: 6,
  maxSteps: 7000, cycle: true, extraEnemies: 3,
};

describe('lockstep determinism, floors 2-5', () => {
  it(`${SERIN.name}: identical when drawn every 2nd step on a narrow low-quality view`, () => {
    checkScenario(SERIN, [NARROW]);
  }, 120_000);

  it(`${BERN.name} (final boss): identical when drawn every 3rd step on a wide view`, () => {
    checkScenario(BERN, [WIDE]);
  }, 120_000);
});
