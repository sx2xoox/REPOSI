// 등불 도둑 사냥 bench (opt-in): a solo chase bot plays the hunt on floors 1 / 4 / 7 with
// a pistol, a beam, a melee and a charge weapon; its damage is scaled like a typical build
// of that floor (power = hpMult / 1.3, the curve the floor HP follows). Reports clear time,
// escape attempts, seals, escapes (fails), regrabs and damage taken.
//
//   HUNT_BENCH=1 npx vitest run tests/hunt-bench
//   (HUNT_WEAPONS / HUNT_FLOORS / HUNT_SEEDS / HUNT_CASUAL=1 / HUNT_CHAR=bori / HUNT_PARTY=4 to vary it)

import './headless';
import { describe, expect, it } from 'vitest';
import { huntRun, type HuntRun } from './hunt-bot';

describe.skipIf(!process.env.HUNT_BENCH)('hunt bench', () => {
  it('solo chase bot on floors 1 / 4 / 7', () => {
    const weapons = (process.env.HUNT_WEAPONS ?? 'lantern_bolt,void_gaze,iron_spear,hunter_bow').split(',');
    const floors = (process.env.HUNT_FLOORS ?? '1,4,7').split(',').map(Number);
    const seeds = Number(process.env.HUNT_SEEDS ?? 4);
    const casual = !!process.env.HUNT_CASUAL;
    const opts = { character: process.env.HUNT_CHAR || 'ria', players: Number(process.env.HUNT_PARTY ?? 1) };
    const rows: string[] = [];
    let all = 0;
    let fails = 0;
    const times: number[] = [];
    for (const floor of floors) for (const weapon of weapons) {
      const res: HuntRun[] = [];
      for (let s = 0; s < seeds; s++) res.push(huntRun(floor, weapon, `HUNT-${floor}-${s}`, ({ 1: 1.3, 4: 3.6, 7: 7.7 }[floor] ?? 1.3) / 1.3, 150, casual, opts));
      const ok = res.filter((r) => r.success);
      all += res.length;
      fails += res.length - ok.length;
      times.push(...ok.map((r) => r.time));
      const avg = (f: (r: HuntRun) => number) => (res.reduce((a, r) => a + f(r), 0) / res.length).toFixed(1);
      rows.push(`F${floor} ${weapon.padEnd(14)} win ${ok.length}/${res.length}  time ${ok.length ? (ok.reduce((a, r) => a + r.time, 0) / ok.length).toFixed(1) : '-'}s  tries ${avg((r) => r.attempts)}  seals ${avg((r) => r.seals)}  regrabs ${avg((r) => r.regrabs)}  hurt ${avg((r) => r.hurt)}  [${res.map((r) => (r.success ? '' : 'X') + r.time.toFixed(0)).join(' ')}]`);
    }
    if (process.env.HUNT_VERBOSE) for (const floor of floors) for (const weapon of weapons) for (let s = 0; s < seeds; s++) {
      const r = huntRun(floor, weapon, `HUNT-${floor}-${s}`, ({ 1: 1.3, 4: 3.6, 7: 7.7 }[floor] ?? 1.3) / 1.3, 150, casual, opts);
      rows.push(`  F${floor} ${weapon} #${s}: knocks ${r.knocks.join(',')} end ${r.time.toFixed(1)} hurt ${JSON.stringify(r.sources)}`);
    }
    times.sort((a, b) => a - b);
    console.log(rows.join('\n') + `\nmedian clear ${times[Math.floor(times.length / 2)]?.toFixed(1)}s, escapes ${fails}/${all}`);
    expect(all).toBeGreaterThan(0);
  }, 600000);
});
