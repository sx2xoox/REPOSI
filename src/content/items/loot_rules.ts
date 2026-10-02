// Content-side loot rules that piggyback on global hooks (no core / room-handler edits).
//
//  - Treasure rooms: on the first visit, ~10% of the time the single item pedestal
//    offers a weapon instead (deterministic per room seed).

import { defineGlobalHooks } from '../../game/defs';
import { Pedestal } from '../../game/pickups';
import { RNG } from '../../engine/rng';

const WEAPON_CHANCE = 0.1;

defineGlobalHooks({
  id: 'treasure_weapon_roll',
  onRoomEnter(w) {
    const node = w.node;
    if (!node || node.kind !== 'treasure') return;
    const key = `treasureWeapon:${w.run.floor}:${node.id}`;
    if (w.flags.has(key)) return;
    w.flags.add(key);
    if (!new RNG(node.seed ^ 0x3e4a9).chance(WEAPON_CHANCE + w.player.stats.luck * 0.01)) return;
    const peds = w.entities.filter((e): e is Pedestal => e instanceof Pedestal && !e.dead && !!e.item && e.item.kind === 'artifact' && e.group === 0 && e.price === 0);
    if (peds.length !== 1) return;
    const ped = peds[0];
    const weapon = w.loot.rollItem('treasure', w.run.lootRng, { kinds: ['weapon'] });
    if (!weapon || weapon.kind !== 'weapon') return;
    // the artifact was never shown: let it appear again later
    w.run.seenOnPedestal.delete(ped.item!.id);
    ped.item = weapon;
  },
});
