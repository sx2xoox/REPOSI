// Lockstep determinism: the simulation must produce bit-identical state on every
// peer. Each scenario drives the real World headless for thousands of fixed
// steps with a scripted, seeded bot (moving, shooting with stick and cursor aim,
// dashing, 등불 해방, matches (sealed doors / chests), interact, weapon swaps; walking through doors,
// clearing rooms, shops / treasure / special rooms, boss fights, trapdoors, floors
// 1–5, four keepers; see detsim.ts) and records `stateHash(w)` after every step.
// The hash sequence must not change when things that legitimately differ
// between peers differ: the cosmetic RNG seed, the adaptive view width, graphics
// quality and other settings, whether / how often / at which interpolation
// alpha frames are drawn, and which caches were warmed first.
// More scenarios: determinism-floors.test.ts.
//
//   npx vitest run tests/determinism

import './headless';
import { describe, expect, it } from 'vitest';
import { BASE_VARIANT, NARROW, WIDE, checkScenario, firstMismatch, runScenario, type Scenario } from './detsim';
import { VIEW_W } from '../src/engine/renderer';
import { stateHash } from '../src/game/statehash';
import { decodeInput, emptyInput, encodeInput, HELD, INPUT_BYTES, PRESS, quantizeInput } from '../src/game/seam';
import { deterministicMathInstalled } from '../src/engine/dmath';

const RIA: Scenario = {
  name: 'ria: floors 1-5', seed: 'DET-RIA-1', character: 'ria', floors: [1, 2, 3, 4, 5], exploreSteps: 700, bossSteps: 1500, giftsPerFloor: 6,
  maxSteps: 14000, cycle: true, extraEnemies: 2,
};
const NIEL: Scenario = {
  // (the seed is re-tuned whenever the gift pool grows: a longer enemy list reshuffles the whole trajectory)
  name: 'niel: floor 1', seed: 'DET-NIEL-10', character: 'niel', floors: [1], exploreSteps: 1500, bossSteps: 1500, giftsPerFloor: 4,
  maxSteps: 3600, cycle: true, extraEnemies: 2,
};

describe('lockstep determinism (headless world, state hash every step)', () => {
  it('runs with the deterministic Math installed', () => {
    expect(deterministicMathInstalled()).toBe(true);
  });

  it(`${RIA.name} (a whole run, five bosses): identical across fx seed / view width / quality / settings / drawing / cache warm-up`, () => {
    checkScenario(RIA, [{ ...NARROW, drawEvery: 3 }, { ...WIDE, drawEvery: 4 }], true);
  }, 180_000);

  it(`${NIEL.name}: identical when drawn every 2nd step on a narrow low-quality view`, () => {
    checkScenario(NIEL, [NARROW]);
  }, 120_000);

  it('the variants really differ in what they vary (view width)', () => {
    const sc = { ...NIEL, maxSteps: 60 };
    runScenario(sc, NARROW);
    expect(VIEW_W).toBe(304);
    runScenario(sc, WIDE);
    expect(VIEW_W).toBe(512);
    runScenario(sc, BASE_VARIANT);
    expect(VIEW_W).toBe(384);
  });

  it('detects a deliberately injected desync (one 1e-9 px nudge) at the exact step', () => {
    const sc: Scenario = { ...NIEL, maxSteps: 900 };
    const base = runScenario(sc, BASE_VARIANT);
    const bad = runScenario({ ...sc, injectAt: 500 }, BASE_VARIANT);
    expect(firstMismatch(base.hashes, bad.hashes)).toBe(500);
    // a one-ulp change of a single entity coordinate changes the hash
    const w = base.world;
    const h0 = stateHash(w);
    const e = w.entities.find((x) => x !== w.player && !(x.constructor as { cosmetic?: boolean }).cosmetic) ?? w.player;
    const x0 = e.x;
    const buf = new Float64Array([x0]);
    new BigUint64Array(buf.buffer)[0] += 1n;
    e.x = buf[0];
    expect(e.x).not.toBe(x0);
    expect(stateHash(w)).not.toBe(h0);
    e.x = x0;
    expect(stateHash(w)).toBe(h0);
  });
});

describe('player input seam (wire format)', () => {
  it('round-trips through the 17-byte payload; edge bits live in the first 4 bytes', () => {
    const i = emptyInput();
    i.mx = Math.SQRT1_2;
    i.my = -Math.SQRT1_2;
    i.ax = 0.6;
    i.ay = -0.8;
    i.cx = 123.4;
    i.cy = -7.06;
    i.held = HELD.fire | HELD.cursorAim;
    i.pressed = PRESS.dash | PRESS.release | PRESS.interact;
    const b = encodeInput(i);
    expect(b.length).toBe(INPUT_BYTES);
    expect(b[0] | b[1] | b[2] | b[3]).toBe(PRESS.dash | PRESS.release | PRESS.interact);
    const d = decodeInput(b);
    expect(d.held).toBe(i.held);
    expect(d.pressed).toBe(i.pressed);
    expect(Math.hypot(d.mx, d.my)).toBeLessThanOrEqual(1);
    expect(d.mx).toBeCloseTo(i.mx, 4);
    expect(d.ay).toBeCloseTo(i.ay, 4);
    expect(d.cx).toBeCloseTo(i.cx, 1);
    // quantizing is idempotent: the local keeper simulates exactly what peers decode
    const q = quantizeInput({ ...i });
    expect(decodeInput(encodeInput(q))).toEqual(q);
    expect(decodeInput(new Uint8Array(0))).toEqual(emptyInput());
  });
});
