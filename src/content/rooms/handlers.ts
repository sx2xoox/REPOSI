// Default behaviour per room kind (start, treasure, shop, boss, secret).

import { registerRoomHandler } from '../../game/roomkinds';
import { Enemies } from '../../game/defs';
import { Pedestal, Pickup, Trapdoor, type PickupKind } from '../../game/pickups';
import { TILE } from '../../game/constants';
import type { World } from '../../game/world';
import type { RNG } from '../../engine/rng';
import { audio } from '../../audio/audio';

registerRoomHandler('start', {
  clearOnEnter: true,
});

registerRoomHandler('normal', {
  clearOnEnter: true,
});

registerRoomHandler('treasure', {
  populate(w, room, rng) {
    const item = w.loot.rollItem('treasure', w.run.lootRng);
    if (item) w.spawn(new Pedestal(room.centerX, room.centerY, item));
    // luck: a second choice (take one, the other vanishes)
    if (rng.chance(0.08 + w.player.stats.luck * 0.03)) {
      const ped = w.entities.find((e) => e instanceof Pedestal) as Pedestal | undefined;
      const item2 = w.loot.rollItem('treasure', w.run.lootRng);
      if (ped && item2) {
        ped.x -= 24;
        ped.group = 1;
        const p2 = new Pedestal(room.centerX + 24, room.centerY, item2);
        p2.group = 1;
        w.spawn(p2);
      }
    }
  },
});

registerRoomHandler('shop', {
  populate(w, room, rng) {
    const cx = room.centerX;
    const cy = room.centerY;
    const slots = [-60, -30, 0, 30, 60];
    const itemSlots = rng.chance(0.5) ? 2 : 3;
    slots.forEach((dx, i) => {
      if (i < itemSlots) {
        const item = w.loot.rollItem('shop', w.run.lootRng);
        if (!item) return;
        const ped = new Pedestal(cx + dx * 1.2 - (itemSlots - 1) * 6, cy + 4, item);
        ped.price = shopPrice(item.kind, item.id);
        w.spawn(ped);
      } else {
        const pool: [PickupKind, number][] = [['heart', 3], ['bomb', 5], ['key', 5], ['soul_heart', 5], ['potion', 4]];
        const [kind, price] = rng.pick(pool);
        const pk = new Pickup(kind, cx + dx * 1.2 + 10, cy + 4);
        pk.price = price;
        if (kind === 'potion') pk.potionId = rng.pick(Object.keys(w.run.potionColors));
        w.spawn(pk);
      }
    });
  },
});

function shopPrice(kind: string, _id: string): number {
  return kind === 'active' ? 20 : 15;
}

registerRoomHandler('secret', {
  populate(w, room, rng) {
    if (rng.chance(0.55)) {
      const item = w.loot.rollItem('secret', w.run.lootRng) ?? w.loot.rollItem('treasure', w.run.lootRng);
      if (item) w.spawn(new Pedestal(room.centerX, room.centerY, item));
    } else {
      const kinds: PickupKind[] = ['coin', 'coin', 'nickel', 'soul_heart', 'bomb2', 'key', 'heart'];
      for (let i = 0; i < 7; i++) {
        const k = rng.pick(kinds);
        w.spawn(new Pickup(k, room.centerX + (i - 3) * 14, room.centerY + (i % 2) * 10));
      }
    }
  },
});

registerRoomHandler('boss', {
  spawnEnemies(w, room, rng) {
    const id = pickBoss(w, rng);
    if (!id) return false;
    const pos = room.markers.find((m) => m.ch === 'B') ?? { x: room.centerX, y: room.centerY - 16 };
    const e = w.spawnEnemy(id, pos.x, pos.y);
    if (!e) return false;
    e.dormant = 1.6;
    w.bossIntro = { enemy: e, t: 0 };
    audio.playMusic(e.def.bossMusic ?? (w.floor.index === 5 ? 'boss_final' : 'boss'));
    w.sfx('boss_roar');
    return true;
  },
  onClear(w, room, rng) {
    const item = w.loot.rollItem('boss', w.run.lootRng) ?? w.loot.rollItem('treasure', w.run.lootRng);
    if (w.floor.index < 5) {
      if (item) w.spawn(new Pedestal(room.centerX, room.centerY - 20, item));
      w.spawn(new Trapdoor(room.centerX, room.centerY + 24));
    } else {
      w.victory();
      return;
    }
    w.spawn(new Pickup('heart', room.centerX - 30, room.centerY).pop());
    if (rng.chance(0.5)) w.spawn(new Pickup('soul_heart', room.centerX + 30, room.centerY).pop());
    audio.playMusic(w.floor.music);
  },
});

/** Pick the boss for this floor (seeded by floor so it stays the same if re-entered). */
export function pickBoss(w: World, rng: RNG): string | null {
  const cands = Enemies.all().filter((e) => e.boss && e.bossFloors?.includes(w.floor.index));
  const fallback = Enemies.all().filter((e) => e.boss);
  const list = cands.length ? cands : fallback;
  if (!list.length) return null;
  return rng.pick(list).id;
}

export const TILE_SIZE = TILE;
