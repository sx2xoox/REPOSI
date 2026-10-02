// Default behaviour per room kind: start (control hints / light shaft), normal,
// treasure, secret and boss. Shop, challenge, shrine and curse rooms live in their
// own files in this folder.

import { registerRoomHandler } from '../../game/roomkinds';
import { Enemies } from '../../game/defs';
import { Pedestal, Pickup, Trapdoor, type PickupKind } from '../../game/pickups';
import { TILE } from '../../game/constants';
import type { World } from '../../game/world';
import type { Room } from '../../game/room';
import type { RNG } from '../../engine/rng';
import { audio } from '../../audio/audio';
import { finalVictory } from '../bosses/final';
import { Candles } from '../props/lights';
import { LightShaft } from '../props/ambient';
import { coinHeap, darkRing, ritualCircle, roundRug, withDecals } from './decor';
import { paintKeyHint, whenFontsReady } from './floortext';

// ------------------------------------------------------------------ start
const HINTS: { keys: string[]; label: string; dx: number; row: number }[] = [
  { keys: ['W', 'A', 'S', 'D'], label: '이동', dx: -70, row: 0 },
  { keys: ['Space'], label: '대시', dx: 74, row: 0 },
  { keys: ['방향키'], label: '· 마우스  공격', dx: 0, row: 1 },
  { keys: ['E'], label: '폭탄', dx: -84, row: 2 },
  { keys: ['F'], label: '등불 해방', dx: 70, row: 2 },
  { keys: ['Q'], label: '액티브', dx: -36, row: 3 },
  { keys: ['R'], label: '물약', dx: 44, row: 3 },
];

function paintHints(room: Room): void {
  const top = room.interiorY + 10;
  const bottom = room.interiorY + room.interiorH;
  const rows = [top, top + 20, bottom - 44, bottom - 24];
  for (const h of HINTS) paintKeyHint(room, room.centerX + h.dx, rows[h.row], h.keys, h.label);
}

registerRoomHandler('start', {
  clearOnEnter: true,
  populate(w, room) {
    if (w.floor.index === 1 && w.run.floor === 1) {
      // control hints painted on the floor of the very first room
      if (typeof document !== 'undefined') void whenFontsReady().then(() => paintHints(room));
    } else {
      // a shaft of light where the lantern-keeper dropped in from above
      w.spawn(new LightShaft(room.centerX, room.centerY + 20));
    }
  },
});

registerRoomHandler('normal', {
  clearOnEnter: true,
});

// ------------------------------------------------------------------ treasure
function placeCandles(w: World, room: Room, spots: [number, number][], blue = false): void {
  for (const [x, y] of spots) if (room.isFree(x, y, 5)) w.spawn(new Candles(x, y, 3, blue));
}

registerRoomHandler('treasure', {
  populate(w, room, rng) {
    const cx = room.centerX;
    const cy = room.centerY;
    withDecals(room, (p) => roundRug(p, cx, cy + 4, 34, 20, ['#3a0e14', '#6a1a22', '#962a30', '#c04a40'], '#e0b040'));
    placeCandles(w, room, [[cx - 52, cy - 22], [cx + 52, cy - 22], [cx - 52, cy + 30], [cx + 52, cy + 30]]);
    const item = w.loot.rollItem('treasure', w.run.lootRng);
    const ped = item ? w.spawn(new Pedestal(cx, cy, item)) : null;
    // luck: a second choice (take one, the other vanishes)
    if (ped && rng.chance(0.08 + w.player.stats.luck * 0.03)) {
      const item2 = w.loot.rollItem('treasure', w.run.lootRng);
      if (item2) {
        ped.x -= 24;
        ped.group = 1;
        const p2 = new Pedestal(cx + 24, cy, item2);
        p2.group = 1;
        w.spawn(p2);
      }
    }
  },
});

// ------------------------------------------------------------------ secret
registerRoomHandler('secret', {
  populate(w, room, rng) {
    withDecals(room, (p) => {
      for (let i = 0; i < 5; i++) coinHeap(p, room.centerX + rng.range(-90, 90), room.centerY + rng.range(-46, 46), rng, rng.int(4, 9));
    });
    placeCandles(w, room, [[room.centerX - 40, room.centerY - 30], [room.centerX + 40, room.centerY - 30]], true);
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

// ------------------------------------------------------------------ boss
registerRoomHandler('boss', {
  populate(w, room) {
    // a scorched summoning circle marks the arena
    withDecals(room, (p) => {
      darkRing(p, room.centerX, room.centerY, 46, 0.35);
      ritualCircle(p, room.centerX, room.centerY, 58, '#a02020', 0.35);
    });
  },
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
      // last floor: a short light-flood cinematic, then the victory screen
      if (w.floor.index === 5) finalVictory(w, room.centerX, room.centerY - 24);
      else w.victory();
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
