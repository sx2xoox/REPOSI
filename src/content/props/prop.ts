// Decorative props: base class + placement helpers shared by floor themes and
// special rooms. Props never collide or take hits; they are persistent so they
// survive leaving and re-entering a room (decorate() only runs on the first visit).

import { Entity } from '../../game/entity';
import type { World } from '../../game/world';
import type { Room } from '../../game/room';
import { TILE } from '../../game/constants';
import { Tile } from '../../game/tiles';
import { facePoint, nearDoor, wallGeo, type Face } from '../../game/roomart';
import { fx } from '../../engine/rng';

export abstract class Prop extends Entity {
  constructor(x: number, y: number, layer = 0) {
    super();
    this.x = x;
    this.y = y;
    this.layer = layer;
    this.persistent = true;
    this.tileCollide = false;
    this.solid = false;
    this.age = fx.range(0, 20);
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
  }
}

// ------------------------------------------------------------------ wall slots
export type SlotKind = 'light' | 'ornament';

export interface WallSlot {
  face: Face;
  /** floor-space coordinate along the wall */
  along: number;
  kind: SlotKind;
  /** index among the slots of this face */
  index: number;
}

/**
 * Deterministic decoration slots on the walls (no RNG, so wall paint and prop
 * entities agree): light sources alternate with ornaments, symmetric, avoiding doors
 * (also hidden secret doors, so nothing ends up in front of a revealed passage).
 */
export function wallSlots(room: Room): WallSlot[] {
  const g = wallGeo(room);
  const out: WallSlot[] = [];
  const iw = g.X1 - g.X0;
  const ih = g.Y1 - g.Y0;
  const nTop = Math.max(2, Math.round(iw / 68));
  for (let k = 0; k < nTop; k++) {
    const along = g.X0 + ((k + 0.5) / nTop) * iw;
    if (nearDoor(room, 'top', along, 27)) continue;
    out.push({ face: 'top', along, kind: Math.min(k, nTop - 1 - k) % 2 === 0 ? 'light' : 'ornament', index: k });
  }
  const nSide = Math.max(2, Math.round(ih / 72));
  for (const face of ['left', 'right'] as Face[]) {
    for (let k = 0; k < nSide; k++) {
      const along = g.Y0 + ((k + 0.5) / nSide) * ih;
      if (nearDoor(room, face, along, 24)) continue;
      out.push({ face, along, kind: k % 2 === 0 ? 'light' : 'ornament', index: k });
    }
  }
  return out;
}

/** Screen position of a point on a wall face (t: 0 floor .. 1 rim). */
export function wallPos(room: Room, face: Face, along: number, t: number): { x: number; y: number } {
  return facePoint(wallGeo(room), face, along, t);
}

// ------------------------------------------------------------------ floor spots
export function isOpenFloor(room: Room, tx: number, ty: number): boolean {
  const t = room.tileAt(tx, ty);
  return t === Tile.FLOOR || t === Tile.RUBBLE;
}

/** Inner floor corners (pixel positions just inside each corner of the room). */
export function floorCorners(room: Room, inset = 10): { x: number; y: number; sx: number; sy: number }[] {
  const g = wallGeo(room);
  return [
    { x: g.X0 + inset, y: g.Y0 + inset, sx: -1, sy: -1 },
    { x: g.X1 - inset, y: g.Y0 + inset, sx: 1, sy: -1 },
    { x: g.X0 + inset, y: g.Y1 - inset, sx: -1, sy: 1 },
    { x: g.X1 - inset, y: g.Y1 - inset, sx: 1, sy: 1 },
  ];
}

/** Is a floor position at least `d` px away from every door entrance? */
export function awayFromDoors(room: Room, x: number, y: number, d = 34): boolean {
  for (const door of room.doors) if (Math.hypot(door.x - x, door.y - y) < d) return false;
  return true;
}

/** Floor tiles touching a wall (good spots for candles / fungi), free and away from doors. */
export function wallHuggingTiles(room: Room): { tx: number; ty: number; side: Face }[] {
  const out: { tx: number; ty: number; side: Face }[] = [];
  const x0 = 2;
  const y0 = 2;
  const x1 = room.w - 3;
  const y1 = room.h - 3;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tx !== x0 && tx !== x1 && ty !== y0 && ty !== y1) continue;
      if (!isOpenFloor(room, tx, ty)) continue;
      const cx = (tx + 0.5) * TILE;
      const cy = (ty + 0.5) * TILE;
      if (!awayFromDoors(room, cx, cy, 30)) continue;
      const side: Face = ty === y0 ? 'top' : ty === y1 ? 'bottom' : tx === x0 ? 'left' : 'right';
      out.push({ tx, ty, side });
    }
  }
  return out;
}
