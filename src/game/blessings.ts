// "등불의 축복" (floor blessing) rules: at the start of every floor (once the
// floor card has shown its name) the keeper picks one of three blessings — small
// permanent run buffs defined as hidden artifacts with `blessing: true`
// (content/blessings). Choices are seeded by (run seed, floor), so the same seed
// offers the same blessings; already-owned blessings are never offered again.

import { RNG } from '../engine/rng';
import { Artifacts, type ArtifactDef } from './defs';
import type { World } from './world';

export const BLESSING_CHOICES = 3;
/** floor-card time (s) after which the blessing choice opens */
export const BLESSING_DELAY = 1.6;

const OFFENSE = new Set(['bless_might', 'bless_haste', 'bless_keen', 'bless_pierce', 'bless_first_strike', 'bless_kindle', 'bless_hunter']);
const DEFENSE = new Set(['bless_vigor', 'bless_soul', 'bless_hearth', 'bless_aegis', 'bless_shade', 'bless_release_heal', 'bless_blastproof']);
export function blessingRole(id: string): string {
  return OFFENSE.has(id) ? '공격' : DEFENSE.has(id) ? '생존' : '탐험·기동';
}

/** Every blessing definition. */
export function blessingPool(): ArtifactDef[] {
  return Artifacts.all().filter((a) => a.blessing);
}

/** The (seeded) blessings offered on `floor`, excluding those in `owned`. */
export function rollBlessings(seed: string, floor: number, owned: (id: string) => boolean, n = BLESSING_CHOICES): string[] {
  const rng = new RNG(`${seed}#blessing${floor}`);
  const pool = blessingPool().filter((b) => !owned(b.id)).map((b) => b.id);
  const shuffled = rng.shuffle(pool);
  const chosen: string[] = [];
  // Diverse choices without changing the pool weights within each role.
  for (const role of rng.shuffle(['공격', '생존', '탐험·기동'])) {
    const id = shuffled.find((id) => blessingRole(id) === role);
    if (id && chosen.length < n) chosen.push(id);
  }
  for (const id of shuffled) if (chosen.length < n && !chosen.includes(id)) chosen.push(id);
  return chosen;
}

/** Choices for the world's current floor (co-op: the context keeper's own three; P1 gets the solo roll). */
export function blessingChoices(w: World): string[] {
  const seed = w.coop && w.player.slot > 0 ? `${w.run.seed}#p${w.player.slot}` : w.run.seed;
  return rollBlessings(seed, w.run.floor, (id) => w.items.hasArtifact(id));
}

/** The floor's blessing has not been chosen yet and the moment has come. */
export function blessingDue(w: World): boolean {
  const p = w.player;
  if (!p || !p.alive || w.gameOver || w.transitioning || w.bossIntro) return false;
  if ((w.vars.__blessedFloor ?? 0) >= w.run.floor) return false;
  return !w.floorCard || w.floorCard.t >= BLESSING_DELAY;
}

/** Mark the current floor's blessing as handled (chosen or skipped). */
export function markBlessed(w: World): void {
  w.vars.__blessedFloor = w.run.floor;
}

/** Grant blessing `id` with a little fanfare. */
export function applyBlessing(w: World, id: string): void {
  markBlessed(w);
  const def = Artifacts.get(id);
  if (!def) return;
  w.items.give(id);
  // remembered for the Tab screen ("N층에서 받은 축복")
  w.vars[`blessedAt:${id}`] = w.run.floor;
  const p = w.player;
  w.banner(def.name, def.desc, { icon: def.icon, color: '#ffd060', small: true });
  w.sfx('power_up', { vol: 0.8 });
  w.particles.burst(p.x, p.y - 8, { count: 28, speed: [40, 140], life: [0.4, 0.9], colors: ['#ffffff', '#fff0a0', '#ffd060', '#e0a848'], size: [1, 2], additive: true, light: 4 });
  w.items.proc(id);
}

/** Floor on which blessing `id` was received (0 if unknown). */
export function blessingFloor(w: World, id: string): number {
  return w.vars[`blessedAt:${id}`] ?? 0;
}

/** Automation (smoke / QA bots): pick the first blessing without an overlay. */
export function autoBlessEnabled(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { __lkAutoBless?: boolean }).__lkAutoBless;
}
