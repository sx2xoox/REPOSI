// ItemSystem: turns the inventory (+ weapon, set bonuses, temporary buffs) into
// a flat list of active hook providers with their power, recomputes player
// stats, and dispatches gameplay events to every provider.
//
// Loot: weighted rolls for item pools (rarity + luck), with Isaac's rule that an
// item that appeared on a pedestal is removed from the pool for this run.

import type { World } from './world';
import {
  Actives, Artifacts, Characters, GlobalHooks, RARITY_WEIGHT, Sets, Weapons, weaponMatchesAffinity,
  type ArtifactDef, type CharacterDef, type ItemHooks, type ItemPool, type Rarity,
} from './defs';
import { LookSystem, type LookSource } from './look';
import { BASE_STATS, POOLED_STATS, StatMods, WEAPON_DAMAGE_SCALE, WEAPON_STATS, computeStats, softBonus, type StatKey, type Stats } from './stats';
import { makeItem, type InvComputed, type InvItem } from './inventory';
import type { PedestalItem } from './pickups';
import type { RNG } from '../engine/rng';
import type { Enemy } from './enemy';
import type { Actor, HitInfo } from './entity';
import type { Projectile } from './projectile';
import type { MeleeSwing } from './melee';
import type { Renderer } from '../engine/renderer';
import type { Player } from './player';
import { pruneProcState, withProcContext } from './procs';

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

/** One artifact effect trigger shown to the player (HUD flash, icon pop above the keeper). */
export interface ProcEvent {
  /** artifact id, or `set:<tag>` for a resonance tier */
  id: string;
  icon: string;
  /** world time of the proc */
  t: number;
  /** also pop the icon above the keeper (else only the HUD row flashes) */
  pop: boolean;
}

/** hooks whose helper effects count as visible procs (continuous hooks never auto-proc) */
const EVENT_HOOKS = new Set<keyof ItemHooks>([
  'modifyHit', 'onHit', 'onKill', 'onHurt', 'onDash', 'onRoomEnter', 'onRoomClear', 'onFloorStart', 'onBomb', 'onPickup', 'onRelease', 'onDeflect',
]);
/**
 * Co-op: hooks that are world events (dispatched to every keeper's item system).
 * A global hook (`defineGlobalHooks`) runs once for them — in the party leader's
 * dispatch — unless it is `perPlayer`; every other hook is one keeper's own
 * event, so its globals run in that keeper's dispatch.
 */
const WORLD_EVENT_HOOKS = new Set<keyof ItemHooks>(['onUpdate', 'onRoomEnter', 'onRoomClear', 'onFloorStart']);
/** min seconds between two HUD flashes / two icon pops of the same artifact */
export const PROC_FLASH_CD = 0.6;
export const PROC_POP_CD = 2.5;

/** Effect key of a character's passive (see CharacterDef.passive). */
export const passiveKey = (c: CharacterDef): string => `passive:${c.id}`;

const passiveLooks = new WeakMap<CharacterDef, LookSource>();
/** The passive's `look` as a look source (an artifact-shaped stand-in, built once per character). */
function passiveLook(c: CharacterDef): LookSource | null {
  const pas = c.passive;
  if (!pas?.look) return null;
  let src = passiveLooks.get(c);
  if (!src) {
    const def: ArtifactDef = { id: passiveKey(c), name: pas.name, desc: pas.desc, rarity: 'rare', tags: [], icon: pas.icon, pools: [], hidden: true, look: pas.look };
    passiveLooks.set(c, (src = { def, power: 1, order: -1 }));
  }
  return src;
}

export class ItemSystem {
  effects: ActiveEffect[] = [];
  /** composed visual traces of the held artifacts (shots, motes, aura ...) */
  readonly look = new LookSystem();
  /** recent procs, newest last (read by the HUD) */
  procLog: ProcEvent[] = [];
  private procFlashAt = new Map<string, number>();
  private procPopAt = new Map<string, number>();
  private lastPopAt = -9;
  /** effect being dispatched + whether the hook is an event hook (auto procs) */
  private cur: ActiveEffect | null = null;
  private curEvent = false;
  computed: InvComputed | null = null;
  revision = 0;
  buffs: TempBuff[] = [];
  private activeKeys = new Set<string>();
  /** effects that implement a given hook (rebuilt lazily after recompute) */
  private byHook = new Map<keyof ItemHooks, ActiveEffect[]>();
  private w: World;
  /** the keeper these items belong to (the context player while its hooks run) */
  readonly p: Player;
  /** guard against re-entrant dispatch loops */
  private depth = 0;

  constructor(w: World, p: Player) {
    this.w = w;
    this.p = p;
    this.look.owner = p;
  }

  /** Run `fn` with this system's keeper as the world's context player (co-op; a no-op in single-player). */
  private own<T>(fn: () => T): T {
    const w = this.w;
    if (!w.coop) return fn();
    const prev = w.player;
    const prevOwner = w.spawnOwner;
    w.player = this.p;
    w.spawnOwner = this.p;
    try {
      return fn();
    } finally {
      w.player = prev;
      w.spawnOwner = prevOwner;
    }
  }

  /** Rebuild the effect list & stats. Call after any inventory / weapon change. */
  recompute(): void {
    this.own(() => this.recomputeOwn());
  }

  private recomputeOwn(): void {
    const w = this.w;
    const p = this.p;
    const comp = p.inv.compute();
    this.computed = comp;
    this.revision++;
    const effects: ActiveEffect[] = [];
    // the keeper's own passive runs first (before any artifact)
    if (p.character.passive) effects.push({ key: passiveKey(p.character), hooks: p.character.passive, power: 1 });
    for (const a of comp.artifacts) effects.push({ key: `a:${a.def.id}`, hooks: a.def, power: a.power });
    for (const set of comp.sets) {
      for (const tier of set.active) effects.push({ key: `set:${set.def.tag}:${tier.count}`, hooks: tier.hooks, power: 1 });
    }
    for (const b of this.buffs) effects.push({ key: `buff:${b.key}`, hooks: b.hooks, power: 1 });
    for (const g of GlobalHooks.all()) effects.push({ key: `global:${g.id}`, hooks: g, power: 1 });

    // acquire / remove notifications
    const newKeys = new Set(effects.map((e) => e.key));
    const oldEffects = this.effects;
    this.effects = effects;
    this.byHook = new Map();
    for (const e of oldEffects) if (!newKeys.has(e.key)) safe(() => e.hooks.onRemove?.(w));
    for (const e of effects) if (!this.activeKeys.has(e.key)) safe(() => e.hooks.onAcquire?.(w, e.power));
    this.activeKeys = newKeys;
    const pl = passiveLook(p.character);
    this.look.compose(pl ? [pl, ...comp.artifacts] : comp.artifacts);

    this.recomputeStats();
  }

  recomputeStats(): void {
    this.own(() => this.recomputeStatsOwn());
  }

  private recomputeStatsOwn(): void {
    const w = this.w;
    const p = this.p;
    const base: Stats = { ...BASE_STATS, ...(p.character.baseStats ?? {}) };
    base.maxHearts = p.baseHearts;
    // artifacts, blessings, sets and passives: their damage / attack-speed multipliers add up
    // in one bonus pool (x1.3 and x1.4 make +70 %, not +82 %; past +100 % at half value,
    // softBonus), so a pile of bonuses grows slower than linearly instead of compounding;
    // penalties and their other multipliers multiply
    const items = new StatMods();
    const pool: Partial<Record<StatKey, number>> = {};
    for (const e of this.effects) {
      const mi = new StatMods();
      safe(() => e.hooks.stats?.(mi, e.power, w));
      for (const k of Object.keys(mi.add) as StatKey[]) items.addStat(k, mi.add[k]!);
      for (const k of Object.keys(mi.mul) as StatKey[]) {
        if (POOLED_STATS.has(k) && mi.mul[k]! > 1) pool[k] = (pool[k] ?? 0) + (mi.mul[k]! - 1);
        else items.mulStat(k, mi.mul[k]!);
      }
      for (const f of mi.flags) items.flag(f);
    }
    for (const k of Object.keys(pool) as StatKey[]) items.mulStat(k, 1 + softBonus(pool[k]!));
    // the weapon and the keeper's affinity for it: offensive factors go to the weapon's own
    // attacks only (weaponStats); everything else (move speed, hearts ...) to the keeper too
    const wm = new StatMods();
    const weapon = Weapons.get(p.weaponId);
    weapon?.stats?.(wm);
    // favoured weapon class: flag + modest bonus (CharacterDef.affinity)
    const aff = p.character.affinity;
    if (aff && weaponMatchesAffinity(aff, weapon)) {
      wm.flag('affinity');
      safe(() => aff.stats?.(wm));
    }
    const keeper = new StatMods();
    const armed = new StatMods();
    for (const t of [keeper, armed]) {
      for (const k of Object.keys(items.add) as StatKey[]) t.addStat(k, items.add[k]!);
      for (const k of Object.keys(items.mul) as StatKey[]) t.mulStat(k, items.mul[k]!);
      for (const f of items.flags) t.flag(f);
      for (const f of wm.flags) t.flag(f);
    }
    for (const k of Object.keys(wm.add) as StatKey[]) {
      armed.addStat(k, wm.add[k]!);
      if (!WEAPON_STATS.has(k)) keeper.addStat(k, wm.add[k]!);
    }
    for (const k of Object.keys(wm.mul) as StatKey[]) {
      armed.mulStat(k, wm.mul[k]!);
      if (!WEAPON_STATS.has(k)) keeper.mulStat(k, wm.mul[k]!);
    }
    armed.mulStat('damage', WEAPON_DAMAGE_SCALE);
    const oldMax = p.stats ? p.maxRed : -1;
    p.stats = computeStats(base, keeper);
    p.armedStats = computeStats(base, armed);
    p.stats.maxHearts = Math.max(1, p.stats.maxHearts - (p.vars.__heartContainersSpent ?? 0));
    p.armedStats.maxHearts = p.stats.maxHearts;
    p.flags = keeper.flags;
    p.flying = keeper.flags.has('flying');
    p.onMaxHeartsChanged(w, oldMax);
  }

  // ---------------------------------------------------------- dispatch
  /** Effects implementing `hook` (a fresh array per recompute: safe to iterate while hooks change the inventory). */
  private with(hook: keyof ItemHooks): ActiveEffect[] {
    let l = this.byHook.get(hook);
    if (!l) {
      const w = this.w;
      // co-op: a world-event global runs in the leader's dispatch only (unless perPlayer)
      const solo = !w.coop || !WORLD_EVENT_HOOKS.has(hook) || w.players[0] === this.p;
      l = this.effects.filter((e) => typeof e.hooks[hook] === 'function' && (solo || !e.key.startsWith('global:') || !!(e.hooks as { perPlayer?: boolean }).perPlayer));
      this.byHook.set(hook, l);
    }
    return l;
  }

  /** Forget the per-hook dispatch lists (the party leader changed). */
  invalidate(): void {
    this.byHook = new Map();
  }

  private each(hook: keyof ItemHooks, fn: (e: ActiveEffect) => void): void {
    if (this.depth > 4) return;
    const list = this.with(hook);
    if (!list.length) return;
    this.depth++;
    const prevCur = this.cur;
    const prevEvent = this.curEvent;
    this.curEvent = EVENT_HOOKS.has(hook);
    // hooks run with their keeper as the context player (`w.player`, `w.items`, `w.vars`)
    const w = this.w;
    const prevP = w.player;
    const prevOwner = w.spawnOwner;
    w.player = this.p;
    if (w.coop) w.spawnOwner = this.p;
    try {
      for (let i = 0; i < list.length; i++) {
        this.cur = list[i];
        try {
          const effect = list[i];
          withProcContext(w, effect.key, () => fn(effect));
        } catch (err) {
          console.error('[items] hook error', err);
        }
      }
    } finally {
      this.depth--;
      this.cur = prevCur;
      this.curEvent = prevEvent;
      w.player = prevP;
      if (w.coop) w.spawnOwner = prevOwner;
    }
  }

  // ---------------------------------------------------------- proc feedback
  /**
   * An artifact's effect just triggered: flash its icon in the HUD row and
   * (if it hasn't popped recently) pop the icon above the keeper. `quiet`
   * procs (frequent passive bonuses) only flash the HUD row. Rate-limited per
   * artifact, so it is safe to call on every trigger.
   */
  proc(id: string, quiet = false): void {
    const w = this.w;
    const now = w.time;
    if (now - (this.procFlashAt.get(id) ?? -9) < PROC_FLASH_CD) return;
    let icon: string | undefined;
    if (id.startsWith('set:')) icon = Sets.get(id.slice(4))?.icon;
    else if (id.startsWith('passive:')) icon = Characters.get(id.slice(8))?.passive?.icon;
    else icon = Artifacts.get(id)?.icon;
    if (!icon) return;
    this.procFlashAt.set(id, now);
    let pop = !quiet && now - (this.procPopAt.get(id) ?? -9) >= PROC_POP_CD && now - this.lastPopAt >= 0.22;
    if (pop) {
      let live = 0;
      for (const e of this.procLog) if (e.pop && now - e.t < 0.9) live++;
      if (live >= 3) pop = false;
    }
    if (pop) {
      this.procPopAt.set(id, now);
      this.lastPopAt = now;
    }
    this.procLog.push({ id, icon, t: now, pop });
    if (this.procLog.length > 32) this.procLog.splice(0, this.procLog.length - 32);
  }

  /** Last flash time of an artifact's proc (-Infinity if never). */
  lastProc(id: string): number {
    return this.procFlashAt.get(id) ?? -Infinity;
  }

  /**
   * Proc of the artifact / resonance tier whose EVENT hook is running right now
   * (called by the shared item helpers: statuses, zaps, blasts, shards ...).
   */
  autoProc(): void {
    const e = this.cur;
    if (!e || !this.curEvent) return;
    if (e.key.startsWith('a:')) this.proc(e.key.slice(2));
    else if (e.key.startsWith('set:')) this.proc(`set:${e.key.split(':')[1]}`);
    else if (e.key.startsWith('passive:')) this.proc(e.key);
  }

  /** Is the held weapon one of the character's favoured class (CharacterDef.affinity)? */
  get affinityActive(): boolean {
    return this.p.flags.has('affinity');
  }

  update(dt: number): void {
    this.own(() => this.updateOwn(dt));
  }

  private updateOwn(dt: number): void {
    const w = this.w;
    pruneProcState(w);
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
    this.each('onUpdate', (e) => e.hooks.onUpdate!(w, dt, e.power));
    this.look.update(w, dt);
  }

  onShoot(p: Projectile): void { this.look.applyShot(p); this.each('onShoot', (e) => e.hooks.onShoot?.(this.w, p, e.power)); }
  onSwing(swing: MeleeSwing): void { this.each('onSwing', (e) => e.hooks.onSwing?.(this.w, swing, e.power)); }
  onAttack(angle: number): void { this.each('onAttack', (e) => e.hooks.onAttack?.(this.w, angle, e.power)); }
  modifyHit(target: Actor, hit: HitInfo): void { this.each('modifyHit', (e) => e.hooks.modifyHit?.(this.w, target, hit, e.power)); }
  onHit(target: Actor, hit: HitInfo): void {
    if (hit.noProc) return;
    this.each('onHit', (e) => e.hooks.onHit?.(this.w, target, hit, e.power));
    this.look.onHit(this.w, target, hit);
  }
  onKill(enemy: Enemy): void { this.each('onKill', (e) => e.hooks.onKill?.(this.w, enemy, e.power)); }
  onHurt(amount: number): void { this.each('onHurt', (e) => e.hooks.onHurt?.(this.w, amount, e.power)); }
  onDash(): void { this.each('onDash', (e) => e.hooks.onDash?.(this.w, e.power)); this.look.onDash(this.w); }
  onRoomEnter(): void { this.each('onRoomEnter', (e) => e.hooks.onRoomEnter?.(this.w, e.power)); }
  onRoomClear(): void { this.each('onRoomClear', (e) => e.hooks.onRoomClear?.(this.w, e.power)); }
  onFloorStart(): void { this.each('onFloorStart', (e) => e.hooks.onFloorStart?.(this.w, e.power)); }
  onBomb(x: number, y: number): void { this.each('onBomb', (e) => e.hooks.onBomb?.(this.w, x, y, e.power)); }
  onPickup(kind: string): void { this.each('onPickup', (e) => e.hooks.onPickup?.(this.w, kind, e.power)); }
  onRelease(): void { this.each('onRelease', (e) => e.hooks.onRelease?.(this.w, e.power)); }
  onDeflect(p: Projectile): void { this.each('onDeflect', (e) => e.hooks.onDeflect?.(this.w, p, e.power)); }
  draw(r: Renderer): void { this.each('draw', (e) => e.hooks.draw?.(this.w, r, e.power)); this.look.drawFront(r, this.w); }

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
    this.p.inv.add(item);
    this.recompute();
    return item;
  }

  /** Remove one copy of an artifact (curses, trades). */
  take(id: string): boolean {
    const ok = this.p.inv.removeOne(id);
    if (ok) this.recompute();
    return ok;
  }

  hasArtifact(id: string): boolean {
    return this.p.inv.has(id);
  }

  /** Number of copies of an artifact held (0 if none). */
  powerOf(id: string): number {
    return this.p.inv.countOf(id);
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
