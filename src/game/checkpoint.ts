import { freshState } from './weaponslots';
import { isContentTemporarilyLocked } from './release-policy';
// Stage-boundary saves intentionally restart the current stage, not a live battle.
import type { World } from './world';
import { freshRunStats, type RunStats } from './run';
import { migrateCheckpoint } from './legacy-ids';
import { makeItem } from './inventory';
import { StatMods, type StatKey } from './stats';

export interface Checkpoint {
  temper?: number; temper2?: number;
  seed: string; character: string; floor: number; stage: number; targetFloor: number;
  rng: number[]; lootRng: number[]; stats: RunStats; time: number;
  obtained: string[]; seen: string[]; identified: string[];
  items: string[]; weapon: string; weapon2: string | null; active: string | null; activeCharge: number; potion: string | null;
  hearts: number; red: number; soul: number; shields: number; ember: number;
  /** `bombs` / `keys`: saves from before matches (migrated on restore) */
  purse: { coins: number; matches: number; bombs?: number; keys?: number }; vars: Record<string, number>;
  buffs: { key: string; label?: string; add: Partial<Record<StatKey, number>>; mul: Partial<Record<StatKey, number>>; flags: string[] }[];
}
export function captureCheckpoint(w: World, floor = w.run.floor, stage = w.run.stage): Checkpoint {
  const p = w.player, r = w.run;
  const buffs = w.items.buffs.filter(b => b.time === Infinity && !b.until).map(b => {
    const m = new StatMods(); b.hooks.stats?.(m, 1, w);
    return { key: b.key, label: b.label, add: m.add, mul: m.mul, flags: [...m.flags] };
  });
  return structuredClone({ temper: Number(p.weapon.mem.temper ?? 0), temper2: Number(p.weapon2.mem.temper ?? 0), seed: r.seed, character: r.characterId, floor, stage, targetFloor: r.targetFloor, rng: r.rng.snapshot(), lootRng: r.lootRng.snapshot(), stats: r.stats, time: w.time,
    obtained: [...r.obtained], seen: [...r.seenOnPedestal], identified: [...r.identified], items: p.inv.items.map(i => i.id), weapon: p.weaponId, weapon2: p.weapon2Id,
    active: p.activeId, activeCharge: p.activeCharge, potion: p.potionId, hearts: p.baseHearts, red: p.red, soul: p.soul, shields: p.shields, ember: p.ember, purse: { coins: p.purse.coins, matches: p.purse.matches }, vars: p.vars, buffs });
}
/** Run stats from a checkpoint over zeroed ones (older saves lack newer counters, e.g. matchesUsed). */
function restoredStats(saved: Partial<RunStats> | undefined): RunStats {
  const out = freshRunStats();
  const o = out as unknown as Record<string, number>;
  for (const [k, v] of Object.entries(saved ?? {})) if (typeof v === 'number' && Number.isFinite(v)) o[k] = v;
  return out;
}
export function restoreCheckpoint(w: World, raw: Checkpoint): void {
  // saves from older versions (bombs / keys, renamed items): brought up to date first, on a copy
  const c = migrateCheckpoint(structuredClone(raw));
  const p = w.player, r = w.run;
  r.rng.restore(c.rng); r.lootRng.restore(c.lootRng); r.stats = restoredStats(c.stats); w.time = c.time;
  r.obtained = new Set(c.obtained); r.seenOnPedestal = new Set(c.seen); r.identified = new Set(c.identified);
  p.inv.items = c.items.map(makeItem); p.weaponId = isContentTemporarilyLocked(c.weapon) ? 'lantern_bolt' : c.weapon; p.weapon2Id = c.weapon2 && !isContentTemporarilyLocked(c.weapon2) ? c.weapon2 : null; p.activeId = c.active; p.activeCharge = c.activeCharge; p.potionId = c.potion;
  p.weapon = freshState(); p.weapon2 = freshState(); p.weapon.mem.temper = c.temper ?? 0; p.weapon2.mem.temper = c.temper2 ?? 0;
  p.baseHearts = c.hearts; p.vars = { ...c.vars }; p.purse.coins = c.purse.coins; p.purse.matches = c.purse.matches;
  w.items.buffs = c.buffs.map(b => ({ key: b.key, label: b.label, time: Infinity, hooks: { stats(m) {
    for (const [k, v] of Object.entries(b.add)) m.addStat(k as StatKey, v);
    for (const [k, v] of Object.entries(b.mul)) m.mulStat(k as StatKey, v);
    for (const f of b.flags) m.flag(f);
  } } }));
  w.items.recompute();
  // Acquisition hooks may grant resources; a restore must not grant them again.
  p.baseHearts = c.hearts; p.vars = { ...c.vars }; p.purse.coins = c.purse.coins; p.purse.matches = c.purse.matches; w.items.recomputeStats();
  p.red = Math.min(p.maxRed, c.red); p.soul = c.soul; p.shields = c.shields; p.ember = c.ember;
}
