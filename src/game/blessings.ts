// "등불의 축복" (floor blessing) rules: at the start of every floor (once the
// floor card has shown its name) the keeper picks one of three blessings — small
// permanent run buffs defined as hidden artifacts with `blessing: true`
// (content/blessings). Choices are seeded by (run seed, floor), so the same seed
// offers the same blessings; already-owned blessings are never offered again.

import { RNG } from '../engine/rng';
import { Artifacts, Weapons, type ArtifactDef } from './defs';
import type { World } from './world';

export const BLESSING_CHOICES = 3;
/** floor-card time (s) after which the blessing choice opens */
export const BLESSING_DELAY = 1.6;

const OFFENSE = new Set(['bless_might', 'bless_haste', 'bless_keen', 'bless_pierce', 'bless_first_strike', 'bless_kindle', 'bless_hunter', 'bless_crossstep', 'bless_footing', 'bless_patient', 'bless_afterstep', 'bless_reaction', 'bless_thread']);
const DEFENSE = new Set(['bless_vigor', 'bless_soul', 'bless_hearth', 'bless_aegis', 'bless_shade', 'bless_release_heal', 'bless_blastproof']);
export function blessingRole(id: string): string {
  return OFFENSE.has(id) ? '공격' : DEFENSE.has(id) ? '생존' : '탐험·기동';
}

/** Every blessing definition. */
export function blessingPool(): ArtifactDef[] {
  return Artifacts.all().filter((a) => a.blessing);
}

export interface BlessingRollContext {
  recent?: readonly string[];
  weapons?: readonly string[];
  revision?: number;
}

/** A useful preview of conditional effects; never hides a possible future build. */
export function blessingCompatibility(id: string, weaponIds: readonly string[]): string {
  const defs = weaponIds.map(id => Weapons.get(id)).filter(d => !!d);
  if (id === 'bless_patient') return defs.some(d => d!.kind === 'charge') ? '보유한 충전 무기에 적용' : '충전 무기로 바꾸면 적용';
  if (id === 'bless_pierce') return defs.some(d => d!.kind !== 'melee' && d!.kind !== 'beam') ? '보유한 탄환 무기에 적용' : '탄환 무기에 관통 · 사거리는 공통';
  if (id === 'bless_crossstep') return defs.length > 1 ? '두 무기를 교체하며 활용' : '보조무기를 얻으면 활용';
  if (id === 'bless_reaction') return '상태이상 조합을 강화';
  if (id === 'bless_afterstep') return '회피 후 공격 기회를 강화';
  if (id === 'bless_thread') return '탄환 관통 · 근접 사거리 강화';
  return blessingRole(id) === '공격' ? '무기 종류와 관계없이 적용' : blessingRole(id) === '생존' ? '생존을 돕는 선택' : '탐색과 성장에 도움';
}

function fitScore(id: string, weapons: readonly string[]): number {
  if (id === 'bless_patient') return weapons.some(id => Weapons.get(id)?.kind === 'charge') ? 3 : -2;
  if (id === 'bless_pierce') return weapons.some(id => ['ranged', 'charge'].includes(Weapons.get(id)?.kind ?? '')) ? 2 : -1;
  if (id === 'bless_crossstep') return weapons.length > 1 ? 2 : -1;
  return 1;
}

/** The (seeded) blessings offered on `floor`, excluding those in `owned`. */
export function rollBlessings(seed: string, floor: number, owned: (id: string) => boolean, n = BLESSING_CHOICES, context: BlessingRollContext = {}): string[] {
  const rng = new RNG(`${seed}#blessing${floor}${context.revision ? `:reroll${context.revision}` : ''}`);
  const pool = blessingPool().filter((b) => !owned(b.id)).map((b) => b.id);
  const recent = new Set(context.recent ?? []);
  const shuffled = rng.shuffle(pool);
  // History has priority over equipment fit. A declined offer can return once
  // the two-offer window has passed, and exhausted pools always degrade safely.
  shuffled.sort((a, b) => Number(recent.has(a)) - Number(recent.has(b)));
  const chosen: string[] = [];
  // Diverse choices without changing the pool weights within each role.
  for (const role of rng.shuffle(['공격', '생존', '탐험·기동'])) {
    const candidates = shuffled.filter(id => blessingRole(id) === role);
    const fresh = candidates.filter(id => !recent.has(id));
    const available = fresh.length ? fresh : candidates;
    const compatible = context.weapons ? available.filter(id => fitScore(id, context.weapons!) > 0) : available;
    const id = (compatible.length ? compatible : available)[0];
    if (id && chosen.length < n) chosen.push(id);
  }
  for (const id of shuffled) if (chosen.length < n && !chosen.includes(id)) chosen.push(id);
  return chosen;
}

/** Choices for the world's current floor (co-op: the context keeper's own three; P1 gets the solo roll). */
export function blessingChoices(w: World): string[] {
  if (w.vars.__blessOfferFloor === w.run.floor) {
    const serial = w.vars.__blessOfferSerial;
    return blessingPool().filter(b => w.vars[`__blessOffer:${b.id}`] === serial)
      .sort((a, b) => w.vars[`__blessOrder:${a.id}`] - w.vars[`__blessOrder:${b.id}`]).map(b => b.id);
  }
  const seed = w.coop && w.player.slot > 0 ? `${w.run.seed}#p${w.player.slot}` : w.run.seed;
  const next = (w.vars.__blessOfferSerial ?? 0) + 1;
  const recent = blessingPool().filter(b => next - (w.vars[`__blessSeen:${b.id}`] ?? -99) <= 2).map(b => b.id);
  const weapons = [w.player.weaponId, w.player.weapon2Id].filter((id): id is string => !!id);
  return rollBlessings(seed, w.run.floor, (id) => w.items.hasArtifact(id), BLESSING_CHOICES, { recent, weapons, revision: w.vars.__blessRevision ?? 0 });
}

/** Simulation-only: freeze the offer before UI reads it, preserving network and save consistency. */
export function prepareBlessingOffer(w: World): void {
  if (w.vars.__blessOfferFloor === w.run.floor || (w.vars.__blessedFloor ?? 0) >= w.run.floor) return;
  const choices = blessingChoices(w);
  const serial = (w.vars.__blessOfferSerial ?? 0) + 1;
  w.vars.__blessOfferSerial = serial;
  w.vars.__blessOfferFloor = w.run.floor;
  for (const [i, id] of choices.entries()) {
    w.vars[`__blessOffer:${id}`] = serial;
    w.vars[`__blessOrder:${id}`] = i;
    w.vars[`__blessSeen:${id}`] = serial;
  }
}

export function canRerollBlessing(w: World): boolean {
  return w.player.alive && !w.gameOver && !w.transitioning && !w.vars.__blessRerollUsed && (w.vars.__blessedFloor ?? 0) < w.run.floor;
}

/** One free reroll per keeper per expedition. Called only by simulation/solo decision handling. */
export function rerollBlessings(w: World, floor: number, serial: number): boolean {
  if (floor !== w.run.floor || serial !== (w.vars.__blessOfferSerial ?? 0) || !canRerollBlessing(w)) return false;
  prepareBlessingOffer(w);
  w.vars.__blessRerollUsed = 1;
  w.vars.__blessRevision = 1;
  delete w.vars.__blessOfferFloor;
  prepareBlessingOffer(w);
  return true;
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
