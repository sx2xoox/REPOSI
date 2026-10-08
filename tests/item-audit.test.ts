// Item audit (opt-in): how weapons scale with the artifacts a run collects, and what
// each artifact is worth — on its own, on top of a late-game build, and stacked.
// Builds are drawn from the visible artifact pool with the loot rarity weights.
//
//   ITEM_AUDIT=weapons   [AUDIT_SHARD=i/n] AUDIT_OUT=<dir> npx vitest run tests/item-audit
//   ITEM_AUDIT=artifacts [AUDIT_SHARD=i/n] AUDIT_OUT=<dir> npx vitest run tests/item-audit
//   ITEM_AUDIT=starters  [AUDIT_SHARD=i/n] AUDIT_OUT=<dir> npx vitest run tests/item-audit
//
// Writes JSON rows to AUDIT_OUT (one file per mode / shard).

import './headless';
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { Artifacts, Characters, RARITY_WEIGHT, Weapons } from '../src/game/defs';
import { RNG } from '../src/engine/rng';
import { PLAIN_ID, measureDps } from './dpsharness';

const MODE = process.env.ITEM_AUDIT ?? '';
const OUT = process.env.AUDIT_OUT ?? '.';
const [SHARD, SHARDS] = (process.env.AUDIT_SHARD ?? '0/1').split('/').map(Number);
const mine = <T>(xs: T[]): T[] => xs.filter((_, i) => i % SHARDS === SHARD);
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

/** The artifacts a run can find (no blessings / hidden). */
export function visibleArtifacts(): { id: string; rarity: string }[] {
  return Artifacts.all().filter((a) => !a.hidden && !a.blessing).map((a) => ({ id: a.id, rarity: a.rarity }));
}

/** `n` builds of `k` distinct artifacts drawn with the loot rarity weights. */
export function builds(seed: string, n: number, k: number, exclude: string[] = []): string[][] {
  const pool = visibleArtifacts().filter((a) => !exclude.includes(a.id));
  const rng = new RNG(seed);
  const out: string[][] = [];
  for (let b = 0; b < n; b++) {
    const left = [...pool];
    const pick: string[] = [];
    for (let i = 0; i < k && left.length; i++) {
      const c = rng.weighted(left, (a) => RARITY_WEIGHT[a.rarity as keyof typeof RARITY_WEIGHT]);
      if (!c) break;
      pick.push(c.id);
      left.splice(left.indexOf(c), 1);
    }
    out.push(pick);
  }
  return out;
}

const melee = (id: string) => {
  const d = Weapons.get(id);
  return !!d && (d.kind === 'melee' || id === 'titan_greatsword');
};

/** Best single-target (or crowd) dps of a near and a far engagement. */
function dps(character: string, weapon: string, artifacts: string[], crowd = false, seed = 'AUDIT'): number {
  const a = measureDps({ character, weapon, artifacts, crowd, seconds: 8, seed: `${seed}-${weapon}` }).dps;
  if (melee(weapon)) return a;
  const b = measureDps({ character, weapon, artifacts, crowd, seconds: 8, dist: 40, seed: `${seed}-${weapon}` }).dps;
  return Math.max(a, b);
}

describe.skipIf(!MODE)('item audit', () => {
  it('runs the requested audit', () => {
    if (MODE === 'weapons') {
      // every weapon on the plain keeper: no items, mid builds (6), late builds (12)
      const mid = builds('AUDIT-MID', 16, 6);
      const late = builds('AUDIT-LATE', 16, 12);
      const lantern = (bs: string[][], crowd: boolean) => bs.map((b, i) => dps(PLAIN_ID, 'lantern_bolt', b, crowd, `B${i}`));
      const L = { base: dps(PLAIN_ID, 'lantern_bolt', []), baseC: dps(PLAIN_ID, 'lantern_bolt', [], true), mid: lantern(mid, false), late: lantern(late, false), lateC: lantern(late, true) };
      const rows = mine(Weapons.all().map((w) => w.id)).map((id) => {
        const d = Weapons.must(id);
        const base = dps(PLAIN_ID, id, []) / L.base;
        const baseC = dps(PLAIN_ID, id, [], true) / L.baseC;
        const midR = mid.map((b, i) => dps(PLAIN_ID, id, b, false, `B${i}`) / L.mid[i]);
        const lateR = late.map((b, i) => dps(PLAIN_ID, id, b, false, `B${i}`) / L.late[i]);
        const lateCR = late.map((b, i) => dps(PLAIN_ID, id, b, true, `B${i}`) / L.lateC[i]);
        return { id, name: d.name, rarity: d.rarity, kind: d.kind, base, baseC, mid: median(midR), late: median(lateR), lateMax: Math.max(...lateR), lateC: median(lateCR), scaling: median(lateR) / base };
      });
      writeFileSync(`${OUT}/weapons-${SHARD}.json`, JSON.stringify(rows));
    } else if (MODE === 'artifacts') {
      // each artifact: alone on reference weapons; stacked (x3); on top of late builds
      const REF = ['lantern_bolt', 'nail_carbine', 'void_gaze', 'sentinel_blade', 'bell_blunderbuss', 'hunter_bow', 'crystal_gatling', 'dawn_lantern'];
      const base = Object.fromEntries(REF.map((wid) => [wid, dps(PLAIN_ID, wid, [])]));
      const baseC = dps(PLAIN_ID, 'lantern_bolt', [], true);
      const ids = mine(visibleArtifacts().map((a) => a.id));
      const late = builds('AUDIT-ART-LATE', 8, 11);
      const cache = new Map<string, number>();
      const lateBase = (wid: string, i: number, b: string[]) => {
        const k = `${wid}|${i}`;
        if (!cache.has(k)) cache.set(k, dps(PLAIN_ID, wid, b, false, `L${i}`));
        return cache.get(k)!;
      };
      const rows = ids.map((id) => {
        const a = Artifacts.must(id);
        const alone = Object.fromEntries(REF.map((wid) => [wid, dps(PLAIN_ID, wid, [id]) / base[wid]]));
        const crowd = dps(PLAIN_ID, 'lantern_bolt', [id], true) / baseC;
        const x3 = dps(PLAIN_ID, 'lantern_bolt', [id, id, id]) / base.lantern_bolt;
        const onLate: Record<string, number> = {};
        for (const wid of ['lantern_bolt', 'nail_carbine', 'sentinel_blade']) {
          const r: number[] = [];
          late.forEach((b0, i) => {
            const b = b0.filter((x) => x !== id).slice(0, 10);
            r.push(dps(PLAIN_ID, wid, [...b, id], false, `L${i}`) / lateBase(wid, i, b));
          });
          onLate[wid] = median(r);
        }
        return { id, name: a.name, rarity: a.rarity, desc: a.desc, alone, crowd, x3, onLate };
      });
      writeFileSync(`${OUT}/artifacts-${SHARD}.json`, JSON.stringify(rows));
    } else if (MODE === 'starters') {
      // every keeper with its own starter vs the legendaries / epics, under late builds
      const late = builds('AUDIT-START', 10, 12);
      const top = Weapons.all().filter((w) => w.rarity === 'legendary' || w.rarity === 'epic').map((w) => w.id);
      const chars = mine(Characters.all().filter((c) => c.id !== PLAIN_ID && !c.id.startsWith('__')));
      const rows = chars.map((c) => {
        const ws = [c.weapon, ...top.filter((x) => x !== c.weapon)];
        const res = ws.map((wid) => ({ wid, base: dps(c.id, wid, []), late: median(late.map((b, i) => dps(c.id, wid, b, false, `S${i}`))) }));
        return { char: c.id, starter: c.weapon, res };
      });
      writeFileSync(`${OUT}/starters-${SHARD}.json`, JSON.stringify(rows));
    }
  }, 7_200_000);
});
