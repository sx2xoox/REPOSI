// Build ceiling (opt-in): the strongest build a keeper can assemble, and what it does
// to the deep bosses. A greedy search adds, one at a time, the artifact (copies allowed,
// up to MAX_COPIES) that raises single-target dps the most, up to ARTIFACTS picks, then
// the best floor blessings (one per floor up to the boss). The build then fights the
// floor 6–7 bosses under the real boss rules (skills, phase gates, burst budget).
//
//   BUILD_CEILING=tove:nail_carbine,ria:lantern_bolt [CEIL_PICKS=12] AUDIT_OUT=<dir> \
//     npx vitest run tests/build-ceiling

import './headless';
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { Artifacts, Weapons } from '../src/game/defs';
import { measureDps } from './dpsharness';
import { bossFight } from './boss-bench.test';

const COMBOS = (process.env.BUILD_CEILING ?? '').split(',').filter(Boolean).map((s) => s.split(':') as [string, string]);
const OUT = process.env.AUDIT_OUT ?? '.';
const PICKS = Number(process.env.CEIL_PICKS ?? 12);
const BLESSINGS = Number(process.env.CEIL_BLESSINGS ?? 6);
const MAX_COPIES = 3;
const BOSSES = (process.env.CEIL_BOSSES ?? 'grand_archivist,sunken_lighthouse,clockmaker,clockwork_dancer').split(',');

function dps(character: string, weapon: string, artifacts: string[]): number {
  const d = Weapons.get(weapon);
  const close = !!d && (d.kind === 'melee' || weapon === 'titan_greatsword');
  const a = measureDps({ character, weapon, artifacts, seconds: 6, seed: `CEIL-${weapon}` }).dps;
  if (close) return a;
  return Math.max(a, measureDps({ character, weapon, artifacts, seconds: 6, dist: 40, seed: `CEIL-${weapon}` }).dps);
}

/** Greedy best build from `pool` (ids may repeat up to MAX_COPIES). */
export function greedyBuild(character: string, weapon: string, pool: string[], picks: number, start: string[] = []): { build: string[]; dps: number; steps: number[] } {
  const build = [...start];
  let cur = dps(character, weapon, build);
  const steps = [cur];
  for (let k = 0; k < picks; k++) {
    let best: string | null = null;
    let bestDps = cur;
    for (const id of pool) {
      const held = build.filter((x) => x === id).length;
      if (held >= (Artifacts.get(id)?.unique ? 1 : MAX_COPIES)) continue;
      const v = dps(character, weapon, [...build, id]);
      if (v > bestDps * 1.0001) { bestDps = v; best = id; }
    }
    if (!best) break;
    build.push(best);
    cur = bestDps;
    steps.push(cur);
  }
  return { build, dps: cur, steps };
}

describe.skipIf(!COMBOS.length)('build ceiling', () => {
  it('finds the strongest builds and fights the deep bosses with them', () => {
    const arts = Artifacts.all().filter((a) => !a.hidden && !a.blessing).map((a) => a.id);
    const bless = Artifacts.all().filter((a) => a.blessing).map((a) => a.id);
    const rows = COMBOS.map(([character, weapon]) => {
      const base = dps(character, weapon, []);
      const a = greedyBuild(character, weapon, arts, PICKS);
      const b = greedyBuild(character, weapon, bless, BLESSINGS, a.build);
      const fights = BOSSES.map((boss) => {
        const f = bossFight(boss, 1, true, 'CEIL', 150, false, { character, weapon, artifacts: b.build });
        return { boss, time: f.killed ? f.time : null, phases: f.phases };
      });
      const row = { character, weapon, base, artifacts: a.build, artifactDps: a.dps, steps: a.steps, full: b.build, fullDps: b.dps, x: b.dps / base, fights };
      console.log(`${character}+${weapon}: base ${base.toFixed(0)} -> ${a.dps.toFixed(0)} (+blessings ${b.dps.toFixed(0)}, x${(b.dps / base).toFixed(1)}) | ${b.build.join(',')}\n   ${fights.map((f) => `${f.boss} ${f.time === null ? '>150' : f.time.toFixed(1)}s`).join('  ')}`);
      return row;
    });
    writeFileSync(`${OUT}/ceiling-${COMBOS.map((c) => c.join('_')).join('-')}.json`, JSON.stringify(rows));
  }, 7_200_000);
});
