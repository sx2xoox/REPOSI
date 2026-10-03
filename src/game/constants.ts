// Room / tile geometry shared by generation, collision and rendering.

export { VIEW_W, VIEW_H, UI_W, UI_H } from '../engine/renderer';

export const TILE = 16;
/** Interior size (in tiles) of one room cell. A 2x1 room is (2*CELL_W) x CELL_H. */
export const CELL_W = 17;
export const CELL_H = 9;
/** Wall thickness in tiles (top wall shows a front face). */
export const WALL = 2;
/** Dungeon map grid size in cells */
export const MAP_W = 13;
export const MAP_H = 13;

export const FIXED_DT = 1 / 60;

export type Dir = 'N' | 'S' | 'E' | 'W';
export const DIRS: Dir[] = ['N', 'S', 'E', 'W'];
export const DIR_VEC: Record<Dir, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
};
export const OPPOSITE: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' };

export type RoomShape = '1x1' | '2x1' | '1x2' | '2x2';
export const SHAPE_CELLS: Record<RoomShape, [number, number]> = {
  '1x1': [1, 1],
  '2x1': [2, 1],
  '1x2': [1, 2],
  '2x2': [2, 2],
};

export type RoomKind =
  | 'start' | 'normal' | 'boss' | 'treasure' | 'shop' | 'secret'
  | 'challenge' | 'shrine' | 'curse' | 'relay' | 'workshop' | 'vault';

/** Total tile grid size (incl. walls) for a room of cw x ch cells. */
export function roomTileSize(cw: number, ch: number): { w: number; h: number } {
  return { w: CELL_W * cw + WALL * 2, h: CELL_H * ch + WALL * 2 };
}
