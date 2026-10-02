// Soul Knight-style weapon economy (content-side, via global hooks):
//  - cleared normal rooms (every floor) sometimes leave a weapon chest; opening
//    it raises the weapon on a pedestal
//  - every shop sells one weapon on a rack below the counter (priced by rarity)
//  - treasure rooms: on top of the base 10% roll (items/loot_rules.ts), another
//    roll here brings the weapon chance to ~20%
// Rarity odds shift toward rare/epic/legendary on deeper floors. All rolls use
// room-seeded RNGs, so a seed always offers the same weapons in the same rooms.

import { RARITY_COLOR, Weapons, defineGlobalHooks, type Rarity } from '../../game/defs';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { Entity } from '../../game/entity';
import { Pedestal } from '../../game/pickups';
import { RingFx } from '../../game/effects';
import { defineDrawnSprite } from '../../engine/sprites';
import { RNG } from '../../engine/rng';
import { dist } from '../../engine/math';
import { glowSprite } from './common';

const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

/** Weapon rarity weights per floor (1-5; deeper floors use floor 5's); deeper floors favor stronger weapons. */
export const WEAPON_RARITY_BY_FLOOR: Record<number, Record<Rarity, number>> = {
  1: { common: 60, rare: 32, epic: 7, legendary: 1 },
  2: { common: 44, rare: 38, epic: 15, legendary: 3 },
  3: { common: 30, rare: 40, epic: 24, legendary: 6 },
  4: { common: 18, rare: 38, epic: 33, legendary: 11 },
  5: { common: 10, rare: 32, epic: 40, legendary: 18 },
};

/** Rarity weights for a floor index, nudged by luck. */
export function weaponRarityWeights(floor: number, luck = 0): Record<Rarity, number> {
  const base = WEAPON_RARITY_BY_FLOOR[Math.max(1, Math.min(5, Math.round(floor)))];
  const l = Math.max(0, luck);
  return {
    common: Math.max(4, base.common - l * 4),
    rare: base.rare * (1 + l * 0.08),
    epic: base.epic * (1 + l * 0.12),
    legendary: base.legendary * (1 + l * 0.2),
  };
}

/** Shop price of a weapon by rarity. */
export function weaponPrice(r: Rarity): number {
  return r === 'common' ? 12 : r === 'rare' ? 18 : r === 'epic' ? 26 : 36;
}

/** Chance that a cleared normal room leaves a weapon chest. */
export const WEAPON_CHEST_CHANCE = 0.12;
/** Extra treasure-room weapon roll (on top of loot_rules' 10% -> ~20% total). */
export const TREASURE_WEAPON_EXTRA = 0.12;

/**
 * Pick a weapon id: rarity by floor weights first, then uniformly among the
 * weapons of that rarity the player does not hold and that were not offered on
 * a pedestal this run (falls back to neighbouring rarities). Pure apart from
 * the RNG; `seen` / `held` are only read.
 */
export function pickWeapon(rng: RNG, floor: number, luck: number, held: Iterable<string | null>, seen: Set<string>): string | null {
  const heldSet = new Set<string>();
  for (const h of held) if (h) heldSet.add(h);
  const all = Weapons.all().filter((d) => d.pools.length > 0 && !heldSet.has(d.id));
  const fresh = all.filter((d) => !seen.has(d.id));
  const list = fresh.length ? fresh : all;
  if (!list.length) return null;
  const wts = weaponRarityWeights(floor, luck);
  const rar = rng.weighted(RARITIES, (r) => (list.some((d) => d.rarity === r) ? wts[r] : 0));
  if (!rar) return null;
  return rng.pick(list.filter((d) => d.rarity === rar)).id;
}

/** Roll a weapon for this run state (marks it as offered). */
export function rollWeapon(w: World, rng: RNG): string | null {
  const p = w.player;
  const id = pickWeapon(rng, w.run.floor, p.stats.luck, [p.weaponId, p.weapon2Id], w.run.seenOnPedestal);
  if (id) w.run.seenOnPedestal.add(id);
  return id;
}

// ------------------------------------------------------------------ weapon chest
defineDrawnSprite('weapon_chest', 24, 13, (p) => {
  p.rect(0, 4, 24, 9, '#5a3a24');
  p.rect(0, 4, 24, 1, '#8a5a34');
  p.rect(0, 0, 24, 5, '#7a4a2c');
  p.rect(0, 0, 24, 1, '#b07a44');
  for (const x of [1, 11, 21]) {
    p.rect(x, 0, 2, 13, '#6a6a7a');
    p.px(x, 0, '#c8c8d8');
  }
  p.rect(10, 4, 4, 3, '#c8a040');
  p.px(11, 5, '#2a1a0a');
  p.px(12, 5, '#2a1a0a');
  p.rect(0, 12, 24, 1, '#3a2414');
}, { outline: '#140c1c' });

defineDrawnSprite('weapon_chest_open', 24, 13, (p) => {
  p.rect(0, 5, 24, 8, '#5a3a24');
  p.rect(1, 5, 22, 3, '#1a0e08');
  p.rect(0, 5, 24, 1, '#8a5a34');
  p.rect(0, 1, 24, 3, '#7a4a2c');
  p.rect(0, 1, 24, 1, '#b07a44');
  for (const x of [1, 11, 21]) {
    p.rect(x, 5, 2, 8, '#6a6a7a');
    p.rect(x, 1, 2, 3, '#6a6a7a');
  }
  p.rect(0, 12, 24, 1, '#3a2414');
}, { outline: '#140c1c' });

/** A long weapon crate left after a room clear; touching it opens it. */
export class WeaponChest extends Entity {
  weaponId: string;
  opened = false;
  openT = 0;
  rarity: Rarity;
  constructor(x: number, y: number, weaponId: string) {
    super();
    this.x = x;
    this.y = y;
    this.weaponId = weaponId;
    this.rarity = Weapons.get(weaponId)?.rarity ?? 'common';
    this.r = 9;
    this.persistent = true;
    this.tileCollide = false;
  }

  /** the crate shows a preview card (its rarity) until it is opened */
  override previewable(): boolean {
    return !this.opened && !this.dead;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.opened) {
      // the emptied crate falls apart and fades, leaving the weapon on its pedestal
      this.openT += dt;
      if (this.openT > 0.6) this.dead = true;
      return;
    }
    const p = w.player;
    if (!p.alive || dist(this.x, this.y, p.x, p.y) > this.r + p.r + 2) return;
    this.opened = true;
    // the weapon rises on a pedestal where the crate stood; step away to take it
    const pos = w.room.nearestFree(this.x, this.y - 2, 8);
    const ped = new Pedestal(pos.x, pos.y, { kind: 'weapon', id: this.weaponId });
    ped.waitForLeave = true;
    w.spawn(ped);
    const col = RARITY_COLOR[this.rarity];
    w.spawn(new RingFx(this.x, this.y - 4, 26, 0.4, col, 2));
    w.particles.burst(this.x, this.y - 4, { count: 22, speed: [30, 110], life: [0.3, 0.7], colors: ['#ffffff', col, '#ffe8a0'], size: [1, 2], shape: 'spark' });
    w.particles.burst(this.x, this.y - 2, { count: 8, speed: [20, 60], life: [0.4, 0.8], colors: ['#8a5a34', '#5a3a24'], size: [1, 2], gravity: 300, vz: [60, 120] });
    w.sfx('chest_open');
    w.sfx(this.rarity === 'epic' || this.rarity === 'legendary' ? 'item_get_rare' : 'hit_metal', { vol: 0.4, pitch: this.rarity === 'common' ? 1.2 : 1 });
  }

  override draw(r: Renderer, w: World): void {
    r.shadow(this.x, this.y + 5, 20, 4, 0.3);
    const col = RARITY_COLOR[this.rarity];
    if (!this.opened) {
      const pulse = 0.5 + 0.5 * Math.sin(w.time * 4 + this.id);
      r.sprite(glowSprite(30, col), this.x, this.y, { alpha: 0.12 + 0.1 * pulse, additive: true, sy: 0.5 });
      const hop = this.age < 0.35 ? Math.sin((this.age / 0.35) * Math.PI) * 6 : 0;
      r.sprite('weapon_chest', this.x, this.y - hop);
      // rarity gem on the lock
      r.rect(Math.round(this.x - 1), Math.round(this.y - 1 - hop), 2, 2, col);
      if (pulse > 0.8) r.rect(Math.round(this.x - 1), Math.round(this.y - 1 - hop), 1, 1, '#ffffff');
    } else {
      const k = Math.min(1, this.openT / 0.6);
      r.sprite('weapon_chest_open', this.x, this.y + 1 + k * 3, { alpha: 1 - k, sx: 1 + k * 0.3, sy: 1 - k * 0.4 });
    }
  }

  override light(w: World): void {
    if (!this.opened) w.lights.add(this.x, this.y, 30, RARITY_COLOR[this.rarity], { intensity: 0.4 });
  }
}

// ------------------------------------------------------------------ hooks
defineGlobalHooks({
  id: 'weapon_drops',
  onRoomClear(w) {
    const node = w.node;
    if (!node || node.kind !== 'normal') return;
    const rng = new RNG((node.seed ^ 0x5eaf00d ^ (w.run.floor * 7919)) >>> 0);
    if (!rng.chance(WEAPON_CHEST_CHANCE + Math.max(0, w.player.stats.luck) * 0.01)) return;
    const id = rollWeapon(w, rng);
    if (!id) return;
    const room = w.room;
    const pos = room.nearestFree(room.centerX + (rng.chance(0.5) ? 34 : -34), room.centerY + 10, 8);
    w.spawn(new WeaponChest(pos.x, pos.y, id));
    w.particles.burst(pos.x, pos.y, { count: 14, speed: [20, 70], life: [0.3, 0.6], colors: ['#ffffff', RARITY_COLOR[Weapons.get(id)?.rarity ?? 'common']], size: [1, 2] });
    w.sfx('enemy_land', { vol: 0.4, pitch: 1.3, x: pos.x });
  },
  onRoomEnter(w) {
    const node = w.node;
    if (!node) return;
    if (node.kind === 'shop') {
      const key = `shopWeapon:${w.run.floor}:${node.id}`;
      if (w.flags.has(key)) return;
      w.flags.add(key);
      const rng = new RNG((node.seed ^ 0x5409 ^ (w.run.floor * 104729)) >>> 0);
      const id = rollWeapon(w, rng);
      if (!id) return;
      const room = w.room;
      const pos = room.nearestFree(room.centerX, room.centerY + 44, 10);
      const ped = new Pedestal(pos.x, pos.y, { kind: 'weapon', id });
      ped.price = weaponPrice(Weapons.get(id)?.rarity ?? 'common');
      w.spawn(ped);
      return;
    }
    if (node.kind === 'treasure') {
      const key = `treasureWeapon2:${w.run.floor}:${node.id}`;
      if (w.flags.has(key)) return;
      w.flags.add(key);
      const rng = new RNG((node.seed ^ 0x7ea5) >>> 0);
      if (!rng.chance(TREASURE_WEAPON_EXTRA)) return;
      const peds = w.entities.filter((e): e is Pedestal => e instanceof Pedestal && !e.dead && !!e.item && e.item.kind === 'artifact' && e.group === 0 && e.price === 0);
      if (peds.length !== 1) return;
      const id = rollWeapon(w, rng);
      if (!id) return;
      w.run.seenOnPedestal.delete(peds[0].item!.id);
      peds[0].item = { kind: 'weapon', id };
    }
  },
});

