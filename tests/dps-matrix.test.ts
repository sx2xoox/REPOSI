// DPS report (not part of the regular suite — it drives the real World for
// every weapon): single-target and crowd DPS of every weapon on 리아 relative to
// the starter lantern, plus a character × representative-weapon matrix.
//
//   DPS_MATRIX=1 npx vitest run tests/dps-matrix

import './headless';
import { describe, it } from 'vitest';
import { Characters, Weapons } from '../src/game/defs';
import { bestDps } from './dpsharness';

const REPRESENTATIVE = ['lantern_bolt', 'sentinel_blade', 'hunter_bow', 'void_gaze', 'twin_daggers', 'star_piercer', 'great_hammer', 'frost_wand', 'moon_katana'];

describe.skipIf(!process.env.DPS_MATRIX)('dps matrix (real world, training dummies)', () => {
  it('weapons on 리아: single / crowd vs the starter', () => {
    const base = bestDps('ria', 'lantern_bolt');
    const baseCrowd = bestDps('ria', 'lantern_bolt', true);
    const rows = Weapons.all().map((d) => {
      const s = bestDps('ria', d.id);
      const c = bestDps('ria', d.id, true);
      return { id: d.id, rarity: d.rarity, s, c };
    });
    rows.sort((a, b) => a.s - b.s);
    const lines = rows.map((r) => `${r.rarity.padEnd(9)} ${r.id.padEnd(20)} single ${r.s.toFixed(1).padStart(6)} (${(r.s / base).toFixed(2)})  crowd ${r.c.toFixed(1).padStart(6)} (${(r.c / baseCrowd).toFixed(2)})`);
    console.log(`WEAPONS (ria) base single ${base.toFixed(1)} crowd ${baseCrowd.toFixed(1)}\n${lines.join('\n')}`);
  }, 900_000);

  it('character × weapon matrix (single target)', () => {
    const chars = Characters.all().map((c) => c.id);
    const header = `${'weapon'.padEnd(18)}${chars.map((c) => c.padStart(9)).join('')}`;
    const lines = REPRESENTATIVE.filter((id) => Weapons.has(id)).map((wid) => {
      const vals = chars.map((c) => bestDps(c, wid));
      return `${wid.padEnd(18)}${vals.map((v) => v.toFixed(1).padStart(9)).join('')}`;
    });
    console.log(`MATRIX\n${header}\n${lines.join('\n')}`);
  }, 900_000);
});
