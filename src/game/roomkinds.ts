// Per room-kind behaviour (what spawns when the room is first built, what
// happens when it is cleared). Default handlers live in src/content/rooms/.

import type { RoomKind } from './constants';
import type { World } from './world';
import type { Room } from './room';
import type { RNG } from '../engine/rng';

export interface RoomHandler {
  /** First time the room is built: place pedestals, shop items, bosses ... */
  populate?(w: World, room: Room, rng: RNG): void;
  /**
   * Every time the player enters while the room is not cleared: spawn enemies.
   * Return true if hostile things were spawned (doors close).
   */
  spawnEnemies?(w: World, room: Room, rng: RNG): boolean;
  /** Called when the room becomes cleared. */
  onClear?(w: World, room: Room, rng: RNG): void;
  /** Called every time the player enters (after spawning). */
  onEnter?(w: World, room: Room): void;
  /** Rooms without enemies count as cleared on entry (default true for non-normal rooms). */
  clearOnEnter?: boolean;
}

const handlers = new Map<RoomKind, RoomHandler>();

export function registerRoomHandler(kind: RoomKind, h: RoomHandler): void {
  handlers.set(kind, h);
}

export function roomHandler(kind: RoomKind): RoomHandler | undefined {
  return handlers.get(kind);
}
