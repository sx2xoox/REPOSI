// Meta progression for characters (always-active global hooks):
//  - 니엘 unlocks (save flag `unlock:niel`) the first time a floor-3+ boss falls
//    (or a run reaches floor 4+ / is won). Seeded runs don't count.
//  - After a boss fight, a weapon pedestal sometimes appears beside the reward.

import { defineGlobalHooks, Characters, isLastFloor } from '../../game/defs';
import type { World } from '../../game/world';
import { save } from '../../engine/save';
import { RNG } from '../../engine/rng';
import { Pedestal } from '../../game/pickups';
import { RingFx } from '../../game/effects';

/** Unlock a character: sets the save flag and celebrates once. Returns true if newly unlocked. */
export function unlockCharacter(w: World, id: string): boolean {
  const flag = `unlock:${id}`;
  const def = Characters.get(id);
  if (!def || def.unlocked || save.hasFlag(flag) || w.run.seeded) return false;
  save.setFlag(flag);
  if (!save.progress.unlockedCharacters.includes(id)) {
    save.progress.unlockedCharacters.push(id);
    save.saveProgress();
  }
  w.banner('새로운 등불지기가 깨어났다', `${def.name} — ${def.title}`, { icon: def.portrait, color: def.color });
  w.sfx('secret_found');
  w.sfx('item_get_rare', { vol: 0.7 });
  const p = w.player;
  w.spawn(new RingFx(p.x, p.y - 8, 60, 0.6, def.color, 3));
  return true;
}

/** Should beating this boss on this floor unlock 니엘? (pure; exported for tests) */
export function bossUnlocksNiel(floor: number, isBoss: boolean, isMinion: boolean, bossesLeft: number): boolean {
  return isBoss && !isMinion && floor >= 3 && bossesLeft === 0;
}

defineGlobalHooks({
  id: 'character_unlocks',
  onKill(w, e) {
    if (bossUnlocksNiel(w.run.floor, e.isBoss, e.isMinion, w.bosses.length)) unlockCharacter(w, 'niel');
  },
  onFloorStart(w) {
    if (w.run.floor >= 4) unlockCharacter(w, 'niel');
  },
});

/** Chance that a cleared boss room also offers a weapon (every floor but the last). */
export const BOSS_WEAPON_CHANCE = 0.35;

defineGlobalHooks({
  id: 'boss_weapon_drop',
  onRoomClear(w) {
    const node = w.node;
    if (node.kind !== 'boss' || isLastFloor(w.floor.index)) return;
    if (!new RNG(node.seed ^ 0x3e4b).chance(BOSS_WEAPON_CHANCE)) return;
    const item = w.loot.rollItem('boss', w.run.lootRng, { kinds: ['weapon'] }) ?? w.loot.rollItem('treasure', w.run.lootRng, { kinds: ['weapon'] });
    if (!item) return;
    const room = w.room;
    const pos = room.nearestFree(room.centerX + 46, room.centerY - 20, 8);
    w.spawn(new Pedestal(pos.x, pos.y, item));
    w.particles.burst(pos.x, pos.y - 10, { count: 20, speed: [30, 90], life: [0.3, 0.6], colors: ['#ffffff', '#c8d4ec', '#ffd060'], size: [1, 2] });
  },
});
