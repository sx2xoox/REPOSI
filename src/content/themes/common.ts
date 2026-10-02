// Decoration shared by every floor theme: wall lights on the deterministic wall
// slots, colored glows at special doors, animated pit surfaces.

import type { World } from '../../game/world';
import type { RNG } from '../../engine/rng';
import { DoorGlow, PitFx } from '../props/ambient';
import { WallLight, type WallLightStyle } from '../props/lights';
import { wallPos, wallSlots, type WallSlot } from '../props/prop';
import { Tile } from '../../game/tiles';
import { hash2 } from '../../game/roomart';

export interface CommonDecor {
  light: WallLightStyle;
  /** also put lights on the side walls */
  sideLights?: boolean;
  pitFx?: 'lava' | 'void' | 'water';
}

/** Height on the wall face (0 floor .. 1 rim) where lights / ornaments are mounted. */
export const MOUNT_T = 0.56;

/** Places the shared decoration; returns the ornament slots for theme-specific props. */
export function decorateCommon(w: World, _rng: RNG, cfg: CommonDecor): WallSlot[] {
  const room = w.room;
  const slots = wallSlots(room);
  for (const s of slots) {
    if (s.kind !== 'light') continue;
    if (s.face !== 'top' && !cfg.sideLights) continue;
    const pos = wallPos(room, s.face, s.along, s.face === 'top' ? MOUNT_T : 0.5);
    w.spawn(new WallLight(Math.round(pos.x), Math.round(pos.y), cfg.light, s.face));
  }
  for (const d of room.doors) if (d.kind !== 'normal' && d.kind !== 'start') w.spawn(new DoorGlow(d));
  if (cfg.pitFx && room.tiles.some((t) => t === Tile.PIT)) w.spawn(new PitFx(w, cfg.pitFx));
  return slots.filter((s) => s.kind === 'ornament');
}

/** Deterministic per-slot choice shared by wall paint (renderer) and decorate (entities). */
export function slotRoll(seed: number, s: WallSlot): number {
  return hash2(s.index, s.face === 'top' ? 1 : s.face === 'left' ? 2 : s.face === 'right' ? 3 : 4, seed & 0xffffff);
}
