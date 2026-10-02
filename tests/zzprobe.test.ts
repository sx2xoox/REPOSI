import { it } from 'vitest';
import { runScenario, BASE_VARIANT, firstMismatch, type Variant, type Scenario } from './detsim';

function cmp(sc: Scenario, va: Variant, vb: Variant) {
  const t0 = performance.now();
  const a = runScenario(sc, va);
  const b = runScenario(sc, vb);
  const k = firstMismatch(a.hashes, b.hashes);
  console.log(sc.name, vb.name, 'steps', a.hashes.length, b.hashes.length, 'first mismatch', k, k >= 0 ? a.where[k] : '', JSON.stringify(a.stats), 'ms', (performance.now() - t0).toFixed(0));
  const c = a.coverage;
  console.log('  coverage enemies', c.enemies.size, 'bosses', [...c.bosses].join(','), 'rooms', [...c.rooms].join(','), 'weapons', c.weapons.size, 'artifacts', c.artifacts.size, 'actives', c.actives.size);
  for (const [k2, set] of Object.entries(c)) (globalThis as any).__cov ??= {}, ((globalThis as any).__cov[k2] ??= new Set()), set.forEach((x: string) => (globalThis as any).__cov[k2].add(x));
  if (k < 0) return;
  const a2 = runScenario(sc, va, k);
  const b2 = runScenario(sc, vb, k);
  console.log('A parts', JSON.stringify(a2.parts), '\nB parts', JSON.stringify(b2.parts));
  const da = a2.dump!, db = b2.dump!;
  let shown = 0;
  for (let i = 0; i < Math.max(da.length, db.length) && shown < 8; i++) {
    if (da[i] !== db[i]) { console.log('A:', da[i]?.slice(0, 600)); console.log('B:', db[i]?.slice(0, 600)); shown++; }
  }
}

const V1: Variant = { ...BASE_VARIANT, name: 'v1', fxSeed: 99, display: [960, 720], quality: 'low', particles: 0.25, damageNumbers: false, hitStopSetting: false, screenShake: 0, drawEvery: 2, drawAlpha: 0.37, warmSprites: true };
const V2: Variant = { ...BASE_VARIANT, name: 'v2', fxSeed: 7, display: [1720, 720], quality: 'medium', particles: 0.6, drawEvery: 3, drawAlpha: 0.8 };

it('probe', () => {
  const chars = (process.env.CHARS ?? 'ria,bern,serin,niel').split(',');
  for (const seedN of (process.env.SEEDS ?? '0').split(',')) for (const ch of chars) {
    const sc: Scenario = { name: ch + seedN, seed: process.env.SEED ?? `DET-${ch}-${seedN}`, character: ch, floors: (process.env.FLOORS ?? '1,2,3,4,5').split(',').map(Number), exploreSteps: Number(process.env.EXPLORE ?? 1200), bossSteps: 2400, giftsPerFloor: Number(process.env.GIFTS ?? 6), maxSteps: Number(process.env.STEPS ?? 20000), cycle: true, extraEnemies: Number(process.env.EXTRA ?? 2) };
    cmp(sc, BASE_VARIANT, process.env.VAR === 'v2' ? V2 : V1);
  }
  const cov = (globalThis as any).__cov;
  console.log('TOTAL coverage', Object.entries(cov).map(([k, v]: any) => `${k}=${v.size}`).join(' '), 'bosses', [...cov.bosses].join(','));
}, 1200000);
