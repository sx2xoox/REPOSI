// Lockstep determinism scenarios for the newer keepers (see determinism.test.ts):
// 보리's barrel / puddles / body block, 백구's perfect dodges and enemy slow-motion,
// 모리's spirit sheep and pens all run inside the hashed simulation.

import './headless';
import { describe, it } from 'vitest';
import { NARROW, WIDE, checkScenario, type Scenario } from './detsim';

const BORI: Scenario = {
  name: 'bori: floor 1', seed: 'DET-BORI-1', character: 'bori', floors: [1], exploreSteps: 1400, bossSteps: 1500, giftsPerFloor: 4,
  maxSteps: 3600, cycle: true, extraEnemies: 2,
};
const BAEKGU: Scenario = {
  name: 'baekgu: floor 2', seed: 'DET-BAEKGU-2', character: 'baekgu', floors: [2], exploreSteps: 1400, bossSteps: 1500, giftsPerFloor: 4,
  maxSteps: 3600, cycle: true, extraEnemies: 2,
};
const MORI: Scenario = {
  name: 'mori: floor 1', seed: 'DET-MORI-3', character: 'mori', floors: [1], exploreSteps: 1400, bossSteps: 1500, giftsPerFloor: 4,
  maxSteps: 3600, cycle: true, extraEnemies: 2,
};

describe('lockstep determinism, 보리 / 백구 / 모리', () => {
  it(`${BORI.name}: identical when drawn every 2nd step on a narrow low-quality view`, () => {
    checkScenario(BORI, [NARROW]);
  }, 120_000);

  it(`${BAEKGU.name}: identical when drawn every 3rd step on a wide view`, () => {
    checkScenario(BAEKGU, [WIDE]);
  }, 120_000);

  it(`${MORI.name}: identical across fx seed / view width / quality`, () => {
    checkScenario(MORI, [NARROW], true);
  }, 120_000);
});
