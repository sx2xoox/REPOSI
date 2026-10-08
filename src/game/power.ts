// "위력" (power): a single number that grows as the keeper gets stronger — an
// estimate of sustained attack damage per second plus a bonus per artifact /
// blessing / active resonance tier (so items without raw stats count too).
// Shown in the HUD (ticks up with a pop) and on the Tab screen.

import { MULTISHOT_GAIN, type Stats } from './stats';
import type { InvComputed } from './inventory';
import type { Rarity } from './defs';

const RARITY_POINTS: Record<Rarity, number> = { common: 3, rare: 5, epic: 8, legendary: 12 };

/** Rough sustained single-target damage per second from stats. */
export function estimateDps(s: Stats): number {
  const crit = 1 + Math.max(0, s.critChance) * Math.max(0, s.critMult - 1);
  // extra fan shots don't all connect
  const shots = 1 + Math.max(0, s.shots - 1) * MULTISHOT_GAIN;
  const pierce = 1 + Math.min(3, Math.max(0, s.pierce)) * 0.12;
  return Math.max(0, s.damage) * Math.max(0, s.fireRate) * crit * shots * pierce;
}

/** Item bonus points: artifacts by rarity (copies add less), blessings, active resonance tiers. */
export function itemPoints(comp: InvComputed | null): number {
  if (!comp) return 0;
  let pts = 0;
  for (const a of comp.artifacts) {
    const base = a.def.blessing ? 4 : RARITY_POINTS[a.def.rarity];
    pts += base * (1 + 0.6 * (a.power - 1));
  }
  for (const s of comp.sets) pts += s.active.length * 6;
  return pts;
}

/** The HUD power number. */
export function powerScore(s: Stats, comp: InvComputed | null): number {
  return Math.round(estimateDps(s) + itemPoints(comp));
}
