import { it } from 'vitest';
import { runScenario, BASE_VARIANT, firstMismatch, type Variant, type Scenario } from './detsim';

function cmp(sc: Scenario, va: Variant, vb: Variant) {
  const a = runScenario(sc, va);
  const b = runScenario(sc, vb);
  const k = firstMismatch(a.hashes, b.hashes);
  console.log(sc.name, vb.name, 'steps', a.hashes.length, b.hashes.length, 'first mismatch', k, k >= 0 ? a.where[k] : '', a.stats);
  if (k < 0) return;
  const a2 = runScenario(sc, va, k);
  const b2 = runScenario(sc, vb, k);
  console.log('A parts', a2.parts, '\nB parts', b2.parts);
  const da = a2.dump!, db = b2.dump!;
  let shown = 0;
  for (let i = 0; i < Math.max(da.length, db.length) && shown < 12; i++) {
    if (da[i] !== db[i]) { console.log('A:', da[i]?.slice(0, 400)); console.log('B:', db[i]?.slice(0, 400)); shown++; }
  }
}

it('probe', () => {
  const sc: Scenario = { name: 'p', seed: process.env.SEED ?? 'DET-PROBE', character: process.env.CHAR ?? 'ria', floors: (process.env.FLOORS ?? '1,2').split(',').map(Number), exploreSteps: 1500, bossSteps: 1500, giftsPerFloor: 3, maxSteps: Number(process.env.STEPS ?? 5000) };
  const kind = process.env.VAR ?? 'fx';
  const vb: Variant = kind === 'fx' ? { ...BASE_VARIANT, name: 'fx', fxSeed: 99 }
    : kind === 'view' ? { ...BASE_VARIANT, name: 'view', display: [960, 720] }
    : kind === 'draw' ? { ...BASE_VARIANT, name: 'draw', drawEvery: 1, drawAlpha: 0.5 }
    : kind === 'settings' ? { ...BASE_VARIANT, name: 'settings', quality: 'low', particles: 0.25, damageNumbers: false, hitStopSetting: false, screenShake: 0 }
    : { ...BASE_VARIANT, name: 'warm', warmSprites: true };
  cmp(sc, BASE_VARIANT, vb);
}, 600000);
