// Matches (성냥): the keeper's one fire-starting resource, shared by the party
// purse in co-op. A match is never spent by brushing past something: every
// target (sealed door, sealed chest, stone lantern, cold wall sconce) lights only
// through the 'interact' action, and every spend goes through `spendMatch` (thrift
// roll, run stat, the `onMatch` item hook, strike sound and a spark arc).

import type { World } from './world';
import type { Entity } from './entity';
import { PREVIEW_RANGE } from './interact';
import { dist } from '../engine/math';
import { fx } from '../engine/rng';

/** Most matches a purse holds (one HUD digit). */
export const MATCH_CAP = 9;

/** Card line shown on a door / sconce while the room's doors are shut for a fight. */
export const LOCKDOWN_DESC = '전투가 끝나면 불을 붙일 수 있다.';

/** Add up to `n` matches to the context keeper's purse (clamped to the cap); returns how many were added. */
export function addMatches(w: World, n: number): number {
  const p = w.player;
  const before = p.matches;
  const add = Math.max(0, Math.min(MATCH_CAP - before, Math.floor(n)));
  p.matches = before + add;
  return add;
}

/** The room's doors are shut for a fight or a mission (doors / sconces wait for it to end). */
export function inLockdown(w: World): boolean {
  return w.room.doors.some((d) => d.state === 'closed');
}

/**
 * Strike one match at (x, y) for the context keeper: false when the purse is
 * empty. Thrift may keep the match; the strike still counts (run stat, onMatch).
 */
export function spendMatch(w: World, x: number, y: number): boolean {
  const p = w.player;
  if (p.matches <= 0) return false;
  const thrift = p.stats.thrift;
  if (!(thrift > 0 && w.rng.chance(thrift))) p.matches--;
  w.run.stats.matchesUsed++;
  w.items.onMatch(x, y);
  w.sfx('match_strike', { x });
  strikeSparks(w, p.x + Math.cos(p.aim) * 4, p.y - 7, x, y);
  return true;
}

/** Cosmetic: a short arc of sparks from the keeper's hand to the target, and a flare there. */
function strikeSparks(w: World, x0: number, y0: number, x1: number, y1: number): void {
  const mx = (x0 + x1) / 2;
  const my = Math.min(y0, y1) - 12;
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const u = 1 - t;
    const x = u * u * x0 + 2 * u * t * mx + t * t * x1;
    const y = u * u * y0 + 2 * u * t * my + t * t * y1;
    w.particles.spawn({
      x, y, vx: fx.range(-8, 8), vy: fx.range(-14, 2), life: 0.12 + t * 0.22,
      colors: ['#ffffff', '#ffe080', '#ff9a30'], size: 1, additive: true,
    });
  }
  w.particles.burst(x1, y1, { count: 8, speed: [20, 70], life: [0.15, 0.4], colors: ['#ffffff', '#ffd060', '#ff7a20'], size: [1, 2], additive: true, light: 4 });
  w.lights.glow(x1, y1, 26, '#ffb060', 0.6);
}

export interface MatchCardInfo {
  name: string;
  desc: string;
  icon: string;
  actionLabel: string;
  available: boolean;
  price: { icon: string; text: string; ok: boolean };
}

/** The preview card (`interactionInfo`) of a match target: price 1 match, '불 붙이기'. */
export function matchCard(w: World, o: { name: string; desc: string; lockdown?: boolean; icon?: string }): MatchCardInfo {
  const ok = (w.player?.matches ?? 0) > 0;
  return {
    name: o.name,
    desc: o.lockdown ? LOCKDOWN_DESC : o.desc,
    icon: o.icon ?? 'icon_seal',
    actionLabel: '불 붙이기',
    price: { icon: 'hud_match', text: '1', ok },
    available: ok && !o.lockdown,
  };
}

/** Refusal float texts, each at most once a second per target (cosmetic only: never sim state). */
const refusedAt = new WeakMap<object, { text: string; t: number }>();

function refuse(w: World, target: Entity, text: string, sound: 'ui_error' | 'no_money'): void {
  w.sfx(sound);
  const last = refusedAt.get(target);
  if (last && last.text === text && w.time - last.t < 1 && w.time >= last.t) return;
  refusedAt.set(target, { text, t: w.time });
  w.floatText(target.x, target.y - 18, text, '#ff8a7a');
}

/**
 * Standard lighting flow for a match target, run by the context keeper's
 * interact: alive, standing, in reach; a door / sconce (`lockdownRule`) refuses
 * while the room is locked down (the match is kept); an empty purse refuses.
 * True when a match was struck (the caller then lights the target). `at`: where
 * the strike's sparks fly (the wick / window), default the target's position.
 */
export function tryLightWithMatch(w: World, target: Entity, lockdownRule: boolean, at?: { x: number; y: number }): boolean {
  const p = w.player;
  if (!p || !p.alive || p.downed || dist(target.x, target.y, p.x, p.y) >= PREVIEW_RANGE) return false;
  if (lockdownRule && inLockdown(w)) {
    refuse(w, target, '전투가 끝나면 붙일 수 있다', 'ui_error');
    return false;
  }
  if (p.matches <= 0) {
    refuse(w, target, '성냥이 없다', 'no_money');
    return false;
  }
  return spendMatch(w, at?.x ?? target.x, at?.y ?? target.y);
}
