// ItemSystem: turns the inventory (+ weapon, set bonuses, temporary buffs) into
// a flat list of active hook providers with their power, recomputes player
// stats, and dispatches gameplay events to every provider.
//
// Loot: weighted rolls for item pools (rarity + luck), with Isaac's rule that an
// item that appeared on a pedestal is removed from the pool for this run.

import type { World } from './world';
import {
  Actives, Artifacts, RARITY_WEIGHT, Weapons,
  type ItemHooks, type ItemPool, type Rarity,
} from './defs';
import { BASE_STATS, StatMods, computeStats, type Stats } from './stats';
import { makeItem, type InvComputed, type InvItem } from './inventory';
import type { PedestalItem } from './pickups';
import type { RNG } from '../engine/rng';
import type { Enemy } from './enemy';
import type { Actor, HitInfo } from './entity';
import type { Projectile } from './projectile';
import type { Renderer } from '../engine/renderer';

export interface ActiveEffect {
  key: string;
  hooks: ItemHooks;
  power: number;
}

export interface TempBuff {
  key: string;
  hooks: ItemHooks;
  /** seconds left, or Infinity with `until` */
  time: number;
  until?: 'room' | 'floor';
  /** label shown in the HUD buff list */
  label?: string;
  icon?: string;
}

export class ItemSystem {
  effects: ActiveEffect[] = [];
  computed: InvComputed | null = null;
  buffs: TempBuff[] = [];
  private activeKeys = new Set<string>();
  private w: World;
  /** guard against re-entrant dispatch loops */
  private depth = 0;

  constructor(w: World) {
    this.w = w;
  }

  /** Rebuild the effect list & stats. Call after any inventory / weapon change. */
  recompute(): void {
    const w = this.w;
    const p = w.player;
    const comp = p.inv.compute();
    this.computed = comp;
    const effects: ActiveEffect[] = [];
    for (const a of comp.artifacts) effects.push({ key: `a:${a.def.id}`, hooks: a.def, power: a.power });
    for (const set of comp.sets) {
      for (const tier of set.active) effects.push({ key: `set:${set.def.tag}:${tier.count}`, hooks: tier.hooks, power: 1 });
    }
    for (const b of this.buffs) effects.push({ key: `buff:${b.key}`, hooks: b.hooks, power: 1 });

    // acquire / remove notifications
    const newKeys = new Set(effects.map((e) => e.key));
    const oldEffects = this.effects;
    this.effects = effects;
    for (const e of oldEffects) if (!newKeys.has(e.key)) safe(() => e.hooks.onRemove?.(w));
    for (const e of effects) if (!this.activeKeys.has(e.key)) safe(() => e.hooks.onAcquire?.(w, e.power));
    this.activeKeys = newKeys;

    this.recomputeStats();
  }

  recomputeStats(): void {
    const w = this.w;
    const p = w.player;
    const base: Stats = { ...BASE_STATS, ...(p.character.baseStats ?? {}) };
    base.maxHearts = p.baseHearts;
    const m = new StatMods();
    const weapon = Weapons.get(p.weaponId);
    weapon?.stats?.(m);
    for (const e of this.effects) safe(() => e.hooks.stats?.(m, e.power, w));
    const oldMax = p.stats ? p.maxRed : -1;
    p.stats = computeStats(base, m);
    p.flags = m.flags;
    p.flying = m.flags.has('flying');
    p.onMaxHeartsChanged(w, oldMax);
  }

  // ---------------------------------------------------------- dispatch
  private each(fn: (e: ActiveEffect) => void): void {
    if (this.depth > 4) return;
    this.depth++;
    try {
      // copy: hooks may change the inventory
      for (const e of [...this.effects]) safe(() => fn(e));
    } finally {
      this.depth--;
    }
  }

  update(dt: number): void {
    const w = this.w;
    let changed = false;
    for (const b of this.buffs) {
      if (b.time !== Infinity) {
        b.time -= dt;
        if (b.time <= 0) changed = true;
      }
    }
    if (changed) {
      this.buffs = this.buffs.filter((b) => b.time > 0);
      this.recompute();
    }
    this.each((e) => e.hooks.onUpdate?.(w, dt, e.power));
  }

  onShoot(p: Projectile): void { this.each((e) => e.hooks.onShoot?.(this.w, p, e.power)); }
  onAttack(angle: number): void { this.each((e) => e.hooks.onAttack?.(this.w, angle, e.power)); }
  modifyHit(target: Actor, hit: HitInfo): void { this.each((e) => e.hooks.modifyHit?.(this.w, target, hit, e.power)); }
  onHit(target: Actor, hit: HitInfo): void { if (!hit.noProc) this.each((e) => e.hooks.onHit?.(this.w, target, hit, e.power)); }
  onKill(enemy: Enemy): void { this.each((e) => e.hooks.onKill?.(this.w, enemy, e.power)); }
  onHurt(amount: number): void { this.each((e) => e.hooks.onHurt?.(this.w, amount, e.power)); }
  onDash(): void { this.each((e) => e.hooks.onDash?.(this.w, e.power)); }
  onRoomEnter(): void { this.each((e) => e.hooks.onRoomEnter?.(this.w, e.power)); }
  onRoomClear(): void { this.each((e) => e.hooks.onRoomClear?.(this.w, e.power)); }
  onFloorStart(): void { this.each((e) => e.hooks.onFloorStart?.(this.w, e.power)); }
  onBomb(x: number, y: number): void { this.each((e) => e.hooks.onBomb?.(this.w, x, y, e.power)); }
  onPickup(kind: string): void { this.each((e) => e.hooks.onPickup?.(this.w, kind, e.power)); }
  onRelease(): void { this.each((e) => e.hooks.onRelease?.(this.w, e.power)); }
  onDeflect(p: Projectile): void { this.each((e) => e.hooks.onDeflect?.(this.w, p, e.power)); }
  draw(r: Renderer): void { this.each((e) => e.hooks.draw?.(this.w, r, e.power)); }

  // ---------------------------------------------------------- buffs
  /** Add a temporary effect (potions, actives). Same key refreshes. */
  addBuff(b: TempBuff): void {
    const i = this.buffs.findIndex((x) => x.key === b.key);
    if (i >= 0) this.buffs[i] = b;
    else this.buffs.push(b);
    this.recompute();
  }

  removeBuff(key: string): void {
    const n = this.buffs.length;
    this.buffs = this.buffs.filter((b) => b.key !== key);
    if (this.buffs.length !== n) this.recompute();
  }

  /** Expire 'room' / 'floor' buffs. */
  expire(scope: 'room' | 'floor'): void {
    const n = this.buffs.length;
    this.buffs = this.buffs.filter((b) => !(b.until === scope || (scope === 'floor' && b.until === 'room')));
    if (this.buffs.length !== n) this.recompute();
  }

  // ---------------------------------------------------------- giving items
  /** Give a passive artifact (duplicates stack their power). */
  give(id: string): InvItem {
    const w = this.w;
    const item = makeItem(id);
    w.run.obtained.add(id);
    w.player.inv.add(item);
    this.recompute();
    return item;
  }

  /** Remove one copy of an artifact (curses, trades). */
  take(id: string): boolean {
    const ok = this.w.player.inv.removeOne(id);
    if (ok) this.recompute();
    return ok;
  }

  hasArtifact(id: string): boolean {
    return this.w.player.inv.has(id);
  }

  /** Number of copies of an artifact held (0 if none). */
  powerOf(id: string): number {
    return this.w.player.inv.countOf(id);
  }
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.error('[items] hook error', e);
  }
}

// ======================================================================
// Loot tables
// ======================================================================

export class Loot {
  private w: World;
  constructor(w: World) {
    this.w = w;
  }

  private rarityWeight(r: Rarity, luck: number): number {
    const base = RARITY_WEIGHT[r];
    if (r === 'common') return Math.max(10, base - luck * 4);
    return base * (1 + Math.max(0, luck) * (r === 'legendary' ? 0.25 : 0.12));
  }

  /** Roll an item for a pedestal from `pool`. Mixes artifacts, actives (and weapons if asked). */
  rollItem(pool: ItemPool, rng: RNG, opts: { exclude?: Set<string>; kinds?: ('artifact' | 'active' | 'weapon')[]; minRarity?: Rarity } = {}): PedestalItem | null {
    const luck = this.w.player.stats.luck;
    const run = this.w.run;
    const kinds = opts.kinds ?? ['artifact', 'active'];
    const rarOrder: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
    const minR = opts.minRarity ? rarOrder.indexOf(opts.minRarity) : 0;
    type Cand = { item: PedestalItem; rarity: Rarity; kindW: number };
    const cands: Cand[] = [];
    const ok = (id: string, pools: ItemPool[], rarity: Rarity, hidden?: boolean) =>
      !hidden && pools.includes(pool) && !run.seenOnPedestal.has(id) && !opts.exclude?.has(id) && rarOrder.indexOf(rarity) >= minR;
    if (kinds.includes('artifact')) for (const d of Artifacts.all()) if (ok(d.id, d.pools, d.rarity, d.hidden) && !(d.unique && run.obtained.has(d.id))) cands.push({ item: { kind: 'artifact', id: d.id }, rarity: d.rarity, kindW: 1 });
    if (kinds.includes('active')) for (const d of Actives.all()) if (ok(d.id, d.pools, d.rarity) && this.w.player.activeId !== d.id) cands.push({ item: { kind: 'active', id: d.id }, rarity: d.rarity, kindW: 0.35 });
    if (kinds.includes('weapon')) for (const d of Weapons.all()) if (ok(d.id, d.pools, d.rarity) && this.w.player.weaponId !== d.id) cands.push({ item: { kind: 'weapon', id: d.id }, rarity: d.rarity, kindW: 0.25 });
    const pick = rng.weighted(cands, (c) => this.rarityWeight(c.rarity, luck) * c.kindW);
    if (!pick) {
      // pool exhausted: allow repeats (but still respect pool membership)
      if (run.seenOnPedestal.size > 0 && !opts.exclude) {
        const fallback = Artifacts.all().filter((d) => d.pools.includes(pool) && !d.hidden && !d.unique);
        const f = fallback.length ? rng.pick(fallback) : null;
        return f ? { kind: 'artifact', id: f.id } : null;
      }
      return null;
    }
    run.seenOnPedestal.add(pick.item.id);
    return pick.item;
  }
}
