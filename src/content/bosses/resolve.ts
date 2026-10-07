// 보스의 결의 — how bosses hold out against strong builds (no new attacks; every boss
// keeps its own patterns).
//
// Common rules, invisible:
// - Phase gates: damage can never skip a phase. A hit that would cross the next
//   phase line stops just under it; the boss is untouchable until its own phase
//   change has played, plus a short guard afterwards.
// - Burst cap: damage beyond a per-second budget (a share of the boss's max HP,
//   smaller on deeper floors) only lands at a quarter, so an overwhelming build
//   ends a fight quickly but cannot erase it in a blink. Releases are exempt.
// Each boss's own skill (`defineBossWard`, content/bosses/wards-*.ts): a themed way
// to hold out that the keeper has to answer with a particular verb (ring the bell
// many times, strike from behind, break the healing cocoons, chase the crown ...).
// Releases (등불 해방) pierce every skill. A skill broken the intended way leaves the
// boss dazed: +25 % damage for a moment.
//
// State lives in the boss's `mem` as primitives (hashed, lockstep-safe); the overlay
// is a cosmetic entity that only reads it.

import { bossRules, Enemy } from '../../game/enemy';
import { Entity, type HitInfo } from '../../game/entity';
import { Projectile } from '../../game/projectile';
import type { Player } from '../../game/player';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { fx } from '../../engine/rng';

/** HP fractions where each boss changes phase (bosses not listed: one change at half). */
const GATES: Record<string, readonly number[]> = { slime_queen: [0.6, 0.3], mumyeong: [0.66, 0.33] };
export const bossGates = (id: string): readonly number[] => GATES[id] ?? [0.5];

/** Share of max HP a boss can lose per second before further damage is cut. */
export function burstBudget(floor: number): number {
  return floor <= 2 ? 0.04 : floor <= 4 ? 0.035 : 0.03;
}
/** Share of the damage above the budget that still lands. */
export const BURST_EXCESS = 0.25;
/** Invulnerable guard after a phase change has played (s). */
export const GATE_GUARD = 1.6;
/** If a boss never changes phase (no gate logic), the hold lets go after this long (s). */
const HOLD_MAX = 9;
/** Damage taken while dazed (a skill was broken the intended way). */
export const DAZE_MULT = 1.25;

// ------------------------------------------------------------------ per-boss skills
export interface BossWard {
  /** Korean skill name and the one-line hint shown the first time it rises in a run */
  name: string;
  hint: string;
  color: string;
  /** the fight's first update */
  begin?(e: Enemy, w: World): void;
  /** the boss's own phase change has played (gate = gates passed so far) */
  phase?(e: Enemy, w: World, gate: number): void;
  update?(e: Enemy, w: World, dt: number): void;
  /** damage the skill lets through (releases never reach this) */
  filter?(e: Enemy, w: World, hit: HitInfo, dmg: number): number;
  /** the skill is up right now (overlay, tests, the bench bot) */
  active?(e: Enemy, w: World): boolean;
  /** cosmetic overlay (read-only) */
  draw?(r: Renderer, w: World, e: Enemy, t: number): void;
  light?(w: World, e: Enemy): void;
}

const WARDS = new Map<string, BossWard>();
export function defineBossWard(bossId: string, ward: BossWard): void {
  WARDS.set(bossId, ward);
}
export const bossWard = (bossId: string): BossWard | undefined => WARDS.get(bossId);
export const wardIds = (): string[] => [...WARDS.keys()];

/** The boss's skill is up. */
export function wardActive(w: World, e: Enemy): boolean {
  return !!WARDS.get(e.def.id)?.active?.(e, w);
}

/** The banner the first time a boss raises its skill this run. */
export function announceWard(e: Enemy, w: World): void {
  const ward = WARDS.get(e.def.id);
  const key = `ward:${e.def.id}`;
  if (!ward || w.flags.has(key)) return;
  w.flags.add(key);
  w.banner(ward.name, ward.hint, { small: true, color: ward.color });
}

/** Leave the boss dazed (takes `DAZE_MULT` damage) for `t` seconds. */
export function daze(e: Enemy, w: World, t: number): void {
  e.mem.rsDaze = Math.max(e.mem.rsDaze ?? 0, t);
  w.sfx('boss_phase', { vol: 0.35, pitch: 1.5 });
}

// ------------------------------------------------------------------ shared helpers for skills
/** Standing keepers. */
export function keepers(w: World): Player[] {
  return (w.coop ? w.players : [w.player]).filter((p) => p.alive && !p.downed);
}

/** Where a hit came from (a little back along a shot's flight, else its source / attacker). */
export function hitFrom(e: Enemy, hit: HitInfo): { x: number; y: number } {
  const s = hit.source;
  if (s instanceof Projectile) {
    const v = Math.hypot(s.vx, s.vy) || 1;
    return { x: s.x - (s.vx / v) * 30, y: s.y - (s.vy / v) * 30 };
  }
  if (s && (s.x !== e.x || s.y !== e.y)) return { x: s.x, y: s.y };
  const a = hit.attacker;
  if (a) return { x: a.x, y: a.y };
  return { x: e.x, y: e.y + 1 };
}

/** Wrap an angle difference into (-PI, PI]. */
export function angleDiff(a: number): number {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Helper slots a boss keeps (their entity ids live in `mem.rsH0..`). */
const HELPER_SLOTS = 6;

/** Live helper enemies (`id`) raised by `boss` (including ones spawned this step, not yet in the room's list). */
export function helpersOf(w: World, boss: Enemy, id: string): Enemy[] {
  const out: Enemy[] = [];
  for (let i = 0; i < HELPER_SLOTS; i++) {
    const eid = boss.mem[`rsH${i}`];
    if (!eid) continue;
    const o = w.entityById(eid);
    if (o instanceof Enemy && o.alive && o.def.id === id) out.push(o);
  }
  return out;
}

/** Raise a helper enemy for `boss` with `hpShare` of its max HP. */
export function raiseHelper(w: World, boss: Enemy, id: string, x: number, y: number, hpShare: number): Enemy | null {
  let slot = -1;
  for (let i = 0; i < HELPER_SLOTS && slot < 0; i++) {
    const eid = boss.mem[`rsH${i}`];
    const o = eid ? w.entityById(eid) : undefined;
    if (!(o instanceof Enemy) || !o.alive) slot = i;
  }
  if (slot < 0) return null;
  const h = boss.summon(w, id, x, y);
  if (!h) return null;
  boss.mem[`rsH${slot}`] = h.id;
  h.parent = boss;
  h.mem.ward = 1;
  h.maxHp = h.hp = Math.max(12, Math.round(boss.maxHp * hpShare));
  h.dormant = 0.4;
  return h;
}

/** A free floor spot at least `dist` px from the boss and every keeper. */
export function freeSpot(w: World, e: Enemy, dist: number, others: { x: number; y: number }[] = []): { x: number; y: number } {
  let best = w.room.randomFreePos(w.rng, 12, { x: e.x, y: e.y, dist });
  for (let i = 0; i < 12; i++) {
    const ok = keepers(w).every((p) => Math.hypot(p.x - best.x, p.y - best.y) > 36) && others.every((o) => Math.hypot(o.x - best.x, o.y - best.y) > 48);
    if (ok) break;
    best = w.room.randomFreePos(w.rng, 12, { x: e.x, y: e.y, dist });
  }
  return best;
}

/** Glancing-off sparks when a skill swallows a hit. */
export function blockedFx(e: Enemy, w: World, hit: HitInfo, colors: string[] = ['#ffffff', '#ffe6a0', '#d8a040']): void {
  if (hit.kind === 'status' || !fx.chance(0.6)) return;
  w.particles.burst(e.x + fx.range(-6, 6), e.y - e.z - 10 + fx.range(-6, 6), { count: 3, speed: [30, 90], life: [0.1, 0.25], colors, size: [1, 1], shape: 'spark' });
  if (fx.chance(0.3)) w.sfx('shield_block', { vol: 0.22, pitch: 1.6 });
}

// ------------------------------------------------------------------ the common rules
const floorOf = (w: World): number => w.floor?.index ?? 1;

/** The boss cannot be hurt right now by the common rules (gate hold or the guard after a phase change). */
export function bossWarded(_w: World, e: Enemy): boolean {
  const m = e.mem;
  return !!m.rsHold || (m.rsGuard ?? 0) > 0;
}

function init(e: Enemy, w: World): void {
  const m = e.mem;
  m.rsInit = 1;
  m.rsGate = 0;
  m.rsHold = 0;
  m.rsHoldT = 0;
  m.rsGuard = 0;
  m.rsBurst = 0;
  m.rsDaze = 0;
  w.spawn(new BossWardFx(e));
  WARDS.get(e.def.id)?.begin?.(e, w);
}

function update(e: Enemy, w: World, dt: number): void {
  const m = e.mem;
  if (!m.rsInit) init(e, w);
  m.rsBurst *= Math.exp(-dt);
  m.rsGuard = Math.max(0, m.rsGuard - dt);
  m.rsDaze = Math.max(0, m.rsDaze - dt);
  const gates = bossGates(e.def.id);
  const ward = WARDS.get(e.def.id);
  if (m.rsHold) {
    m.rsHoldT += dt;
    if (e.phase >= m.rsGate + 1 || m.rsHoldT > HOLD_MAX) {
      // the boss's own phase change has begun: guard through it, then its skill rises
      m.rsHold = 0;
      m.rsGate = Math.min(gates.length, m.rsGate + 1);
      m.rsGuard = GATE_GUARD;
      ward?.phase?.(e, w, m.rsGate);
    }
  }
  ward?.update?.(e, w, dt);
}

function filter(e: Enemy, w: World, hit: HitInfo, dmg: number): number {
  const m = e.mem;
  if (dmg <= 0) return dmg;
  // a hit can land before the boss's first update (intro): set the rules up now
  if (!m.rsInit) init(e, w);
  if (bossWarded(w, e)) {
    blockedFx(e, w, hit);
    return 0;
  }
  const ward = WARDS.get(e.def.id);
  if (ward?.filter && !hit.release) {
    dmg = ward.filter(e, w, hit, dmg);
    if (dmg <= 0) return 0;
  }
  if ((m.rsDaze ?? 0) > 0) dmg *= DAZE_MULT;
  if (!hit.release) {
    const budget = burstBudget(floorOf(w)) * e.maxHp;
    const room = Math.max(0, budget - m.rsBurst);
    if (dmg > room) dmg = room + (dmg - room) * BURST_EXCESS;
  }
  const gates = bossGates(e.def.id);
  if (m.rsGate < gates.length && !m.rsHold) {
    const line = gates[m.rsGate] * e.maxHp;
    if (e.hp - dmg <= line) {
      // stop just under the line: the boss's own phase check fires, nothing carries past it
      dmg = Math.max(0, e.hp - line + 0.01);
      m.rsHold = 1;
      m.rsHoldT = 0;
    }
  }
  // the budget counts what actually landed
  if (!hit.release) m.rsBurst += dmg;
  return dmg;
}

bossRules.filter = filter;
bossRules.update = update;

// ------------------------------------------------------------------ overlay
/** Draws the boss's skill (and the daze stars). Purely visual. */
export class BossWardFx extends Entity {
  static override readonly cosmetic = true;
  constructor(readonly boss: Enemy) {
    super();
    this.layer = 2;
    this.tileCollide = false;
  }
  override update(_w: World, dt: number): void {
    this.age += dt;
    if (!this.boss.alive) this.dead = true;
  }
  override draw(r: Renderer, w: World): void {
    const e = this.boss;
    if (!e.alive || e.hidden) return;
    WARDS.get(e.def.id)?.draw?.(r, w, e, this.age);
    if ((e.mem.rsDaze ?? 0) > 0) {
      // dazed: three little stars circling over its head
      const cy = e.y - e.z - e.r * 1.6 - 10;
      for (let i = 0; i < 3; i++) {
        const a = this.age * 5 + (i * Math.PI * 2) / 3;
        const x = Math.round(e.x + Math.cos(a) * (e.r * 0.7 + 6));
        const y = Math.round(cy + Math.sin(a) * 3);
        r.rect(x - 1, y, 3, 1, '#fff4a0');
        r.rect(x, y - 1, 1, 3, '#fff4a0');
        r.rect(x, y, 1, 1, '#ffffff');
      }
    }
  }
  override light(w: World): void {
    const e = this.boss;
    if (e.alive) WARDS.get(e.def.id)?.light?.(w, e);
  }
}
