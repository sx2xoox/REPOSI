// Read-only snapshot of the floor map for the map overlay (M) and the HUD
// minimap (등불 성좌도). Everything here is pure: it reads the world through
// the small structural `MapSource` type, never writes to it and never draws, so
// the map can never touch the simulation (lockstep determinism) and tests can
// build views from a headless World.

import type { FloorMap, RoomNode } from '../game/dungeon';
import type { Dir, RoomKind } from '../game/constants';
import { MAP_H, MAP_W } from '../game/constants';
import { isLastFloor } from '../game/defs';
import { ROOM_LABELS } from './logic';

/** What the map reads from the world (structural, so tests can pass a World or a stub). */
export interface MapSource {
  map: FloorMap;
  node: RoomNode;
  flags: { has(key: string): boolean };
  players: readonly { slot: number; downed: boolean }[];
  local: { slot: number; x: number; y: number };
  run: { staged: boolean; floor: number; stage: number; seed: string };
  room: { pxW: number; pxH: number };
}

export type NodeState = 'current' | 'visited' | 'uncleared' | 'seen';

export interface ViewNode {
  id: number;
  gx: number;
  gy: number;
  cw: number;
  ch: number;
  kind: RoomKind;
  state: NodeState;
  /** a locked treasure / shop room not entered yet */
  locked: boolean;
  /** the start room holding the passage to the next stage (x-1 / x-2) */
  exit: boolean;
  /** boss room, boss defeated */
  bossDone: boolean;
}

export type ThreadType = 'lit' | 'frontier' | 'secret';

export interface ViewDoor {
  a: number;
  b: number;
  /** map cell (inside node `a`) the door sits on, and its side */
  cx: number;
  cy: number;
  dir: Dir;
  type: ThreadType;
  /** id of the locked room this thread leads into (-1: none) */
  lockTo: number;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One row of the legend: a room kind, the exit, or the co-op party. */
export interface LegendRow {
  key: RoomKind | 'exit' | 'party';
  label: string;
  /** seen on this floor (unfound treasure / shop rows are drawn grey) */
  found: boolean;
}

export type LegendState = 'current' | 'visited' | 'uncleared' | 'exit' | 'seen';

export interface MapView {
  nodes: ViewNode[];
  doors: ViewDoor[];
  curId: number;
  /** map cell (absolute) the local keeper stands in */
  keeperCell: { cx: number; cy: number };
  /** the other keepers (co-op), in slot order */
  party: { slot: number; nodeId: number; downed: boolean }[];
  bounds: Bounds;
  counts: { visited: number; total: number; cleared: number };
  /** the 2x2 state swatches, in order */
  states: LegendState[];
  /** room kind rows (+ exit / party) */
  legend: LegendRow[];
  floorIndex: number;
  themeId: string;
  stage: number;
  staged: boolean;
  seed: string;
  lastFloor: boolean;
}

/** Legend order of the room kinds. */
export const LEGEND_KINDS: RoomKind[] = ['boss', 'treasure', 'shop', 'secret', 'challenge', 'shrine', 'curse', 'relay', 'workshop', 'vault', 'hunt', 'refinery', 'well', 'fusion', 'elite'];

function revealed(d: object): boolean {
  return !!(d as { revealed?: boolean }).revealed;
}

type KnownSource = Pick<MapSource, 'map' | 'flags'>;

/** Is this node shown on the map? (secret rooms only after a door to them was revealed) */
export function nodeKnown(w: KnownSource, n: RoomNode): boolean {
  if (!n.discovered) return false;
  if (n.kind === 'secret' && !n.visited && !w.flags.has('mapRevealSecret')) {
    return w.map.nodes.some((o) => o.doors.some((dd) => dd.to === n.id && revealed(dd)));
  }
  return true;
}

/** Bounds (in cells) of all known rooms, for the full map. */
export function knownBounds(w: KnownSource): Bounds {
  let x0 = MAP_W;
  let y0 = MAP_H;
  let x1 = 0;
  let y1 = 0;
  for (const n of w.map.nodes) {
    if (!nodeKnown(w, n)) continue;
    x0 = Math.min(x0, n.gx);
    y0 = Math.min(y0, n.gy);
    x1 = Math.max(x1, n.gx + n.cw);
    y1 = Math.max(y1, n.gy + n.ch);
  }
  if (x1 <= x0) return { x0: 0, y0: 0, x1: MAP_W, y1: MAP_H };
  return { x0, y0, x1, y1 };
}

/** Is this door's thread drawn (both ends known; a hidden secret door only once revealed or walked)? */
function doorShown(src: KnownSource, n: RoomNode, d: RoomNode['doors'][number], other: RoomNode): boolean {
  if (!nodeKnown(src, other)) return false;
  if (d.secret && !revealed(d) && !(n.visited && other.visited)) return false;
  return true;
}

/** Build the read-only map view. Never mutates `src`. */
export function buildMapView(src: MapSource): MapView {
  const map = src.map;
  const cur = src.node;
  const known = map.nodes.filter((n) => nodeKnown(src, n));
  const nodes: ViewNode[] = known.map((n) => ({
    id: n.id,
    gx: n.gx,
    gy: n.gy,
    cw: n.cw,
    ch: n.ch,
    kind: n.kind,
    state: n.id === cur.id ? 'current' : n.visited ? (n.cleared ? 'visited' : 'uncleared') : 'seen',
    locked: n.locked && !n.visited,
    exit: map.exitId !== undefined && n.id === map.exitId,
    bossDone: n.kind === 'boss' && n.cleared,
  }));
  const doors: ViewDoor[] = [];
  for (const n of known) {
    for (const d of n.doors) {
      const other = map.nodes[d.to];
      if (!other || d.to < n.id) continue;
      if (!doorShown(src, n, d, other)) continue;
      const both = n.visited && other.visited;
      const type: ThreadType = both ? 'lit' : d.secret ? 'secret' : 'frontier';
      const lockTo = other.locked && !other.visited ? other.id : n.locked && !n.visited ? n.id : -1;
      doors.push({ a: n.id, b: other.id, cx: d.cx, cy: d.cy, dir: d.dir, type, lockTo });
    }
  }
  const p = src.local;
  const party = src.players
    .filter((q) => q.slot !== p.slot)
    .map((q) => ({ slot: q.slot, nodeId: cur.id, downed: q.downed }))
    .sort((a, b) => a.slot - b.slot);
  const counts = {
    visited: map.nodes.filter((n) => n.visited).length,
    total: map.nodes.filter((n) => n.kind !== 'secret').length,
    cleared: map.nodes.filter((n) => n.cleared && n.visited).length,
  };
  const hasExit = nodes.some((n) => n.exit);
  const hasUncleared = nodes.some((n) => n.state === 'uncleared');
  const states: LegendState[] = ['current', 'visited', hasUncleared ? 'uncleared' : hasExit ? 'exit' : 'seen', 'seen'];
  if (states[2] === 'seen') states.length = 3;
  const kinds = new Set(nodes.map((n) => n.kind));
  const legend: LegendRow[] = [];
  for (const k of LEGEND_KINDS) {
    const found = kinds.has(k);
    if (k === 'boss') {
      if (map.bossId >= 0) legend.push({ key: k, label: ROOM_LABELS[k], found });
      continue;
    }
    if (!found && k !== 'treasure' && k !== 'shop') continue;
    legend.push({ key: k, label: ROOM_LABELS[k], found });
  }
  // the exit shows once: in the state swatches unless an uncleared room took that slot
  if (hasExit && hasUncleared) legend.push({ key: 'exit', label: '출구', found: true });
  if (party.length) legend.push({ key: 'party', label: '동료', found: true });
  return {
    nodes,
    doors,
    curId: cur.id,
    keeperCell: keeperCell(src),
    party,
    bounds: knownBounds(src),
    counts,
    states,
    legend,
    floorIndex: map.floor.index,
    themeId: map.floor.theme,
    stage: src.run.stage,
    staged: src.run.staged,
    seed: src.run.seed,
    lastFloor: isLastFloor(map.floor.index),
  };
}

/** Map cell (absolute) of the current room the local keeper stands in (clamped to the room). */
export function keeperCell(src: Pick<MapSource, 'node' | 'local' | 'room'>): { cx: number; cy: number } {
  const cur = src.node;
  const p = src.local;
  const fx = src.room.pxW > 0 ? p.x / src.room.pxW : 0.5;
  const fy = src.room.pxH > 0 ? p.y / src.room.pxH : 0.5;
  return {
    cx: cur.gx + Math.min(cur.cw - 1, Math.max(0, Math.floor(fx * cur.cw))),
    cy: cur.gy + Math.min(cur.ch - 1, Math.max(0, Math.floor(fy * cur.ch))),
  };
}

/**
 * Cheap hash of everything the cached map layers show: rooms known / visited /
 * cleared / locked, revealed doors, the current room, the exit and the reveal
 * flag (not the keeper's position or time: those are drawn live).
 */
export function mapSignature(src: Pick<MapSource, 'map' | 'node' | 'flags'>): number {
  const map = src.map;
  let h = (src.node.id * 31 + (src.flags.has('mapRevealSecret') ? 7 : 0) + ((map.exitId ?? -1) + 2) * 977 + map.floor.index * 7919 + map.nodes.length * 104729) | 0;
  const nodes = map.nodes;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    h = (Math.imul(h, 33) + ((n.discovered ? 1 : 0) | (n.visited ? 2 : 0) | (n.cleared ? 4 : 0) | (n.locked ? 8 : 0))) | 0;
    const ds = n.doors;
    for (let j = 0; j < ds.length; j++) if (revealed(ds[j])) h = (Math.imul(h, 33) + ds[j].to + 1) | 0;
  }
  return h;
}

// ---------------------------------------------------------------- layout
/** The map overlay's panel (UI units): centred in the UI space, under an 18-unit top margin. */
export const MAP_PANEL = { w: 656, h: 396, top: 18 } as const;

/** UI rect of the map overlay's panel for a UI space `uiW` wide (768x432 band, wider on wide screens). */
export function mapPanelRect(uiW: number): { x: number; y: number; w: number; h: number } {
  return { x: Math.round(uiW / 2 - MAP_PANEL.w / 2), y: MAP_PANEL.top, w: MAP_PANEL.w, h: MAP_PANEL.h };
}

export interface BoardLayout {
  /** art px per map cell */
  cell: number;
  /** art px between neighbouring plates */
  gap: number;
  /** art px of map cell (0, 0)'s corner inside the drawing area */
  ox: number;
  oy: number;
  /** sigil size for a 1x1 plate */
  sigil: 7 | 5;
}

/** Plate size (art px, outline included) of a 1-cell room. */
export function plateSize(cell: number, gap: number): number {
  return cell - gap;
}

/** Sigil size that fits a plate of `min` art px (outline included): 7x7 + ink outline needs 11. */
export function sigilFor(min: number): 7 | 5 {
  return min >= 11 ? 7 : 5;
}

/**
 * Fit the known bounds into an `areaW` x `areaH` art-px area (offset by
 * `opts.x/y`): integer cell 9..20, gap ~28 % of it, centred, whole art px.
 */
export function boardLayout(b: Bounds, areaW: number, areaH: number, opts: { x?: number; y?: number; minCell?: number; maxCell?: number } = {}): BoardLayout {
  const spanW = Math.max(1, b.x1 - b.x0);
  const spanH = Math.max(1, b.y1 - b.y0);
  const cell = Math.max(opts.minCell ?? 9, Math.min(opts.maxCell ?? 20, Math.floor(Math.min(areaW / spanW, areaH / spanH))));
  const gap = Math.max(3, Math.min(6, Math.round(cell * 0.28)));
  const ox = Math.floor((opts.x ?? 0) + (areaW - spanW * cell) / 2) - b.x0 * cell;
  const oy = Math.floor((opts.y ?? 0) + (areaH - spanH * cell) / 2) - b.y0 * cell;
  return { cell, gap, ox, oy, sigil: sigilFor(plateSize(cell, gap)) };
}

/**
 * Minimap camera target (map cells at the view's centre). Per axis: bounds that
 * fit the view are centred; otherwise the current room is followed, clamped so
 * the view runs at most 0.3 cell past the bounds; finally the current room is
 * kept fully inside the view with a 0.25-cell margin (when it can be).
 */
export function miniCamTarget(b: Bounds, cur: { gx: number; gy: number; cw: number; ch: number }, viewW: number, viewH: number, cell: number): { x: number; y: number } {
  const axis = (lo: number, hi: number, c0: number, cs: number, view: number): number => {
    const half = view / cell / 2;
    let t: number;
    if ((hi - lo) * cell <= view) t = (lo + hi) / 2;
    else {
      t = c0 + cs / 2;
      t = Math.max(lo + half - 0.3, Math.min(hi - half + 0.3, t));
    }
    const a = c0 + cs + 0.25 - half;
    const z = c0 - 0.25 + half;
    if (a <= z) t = Math.max(a, Math.min(z, t));
    else t = c0 + cs / 2;
    return t;
  };
  return { x: axis(b.x0, b.x1, cur.gx, cur.cw, viewW), y: axis(b.y0, b.y1, cur.gy, cur.ch, viewH) };
}

export interface LegendLayout {
  rows: LegendRow[];
  /** 1 or 2 columns */
  cols: 1 | 2;
  /** rows per column */
  perCol: number;
}

/** Legend kind rows in one column, or two when more than `maxRows` (9 by default) would not fit. */
export function legendLayout(rows: LegendRow[], maxRows = 9): LegendLayout {
  if (rows.length <= maxRows) return { rows, cols: 1, perCol: Math.max(1, rows.length) };
  return { rows, cols: 2, perCol: Math.ceil(rows.length / 2) };
}

/** Integer hash for cosmetic placement (never gameplay). */
export function h32(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x9e37, 0x165667b1) ^ Math.imul((c | 0) + 0x79b9, 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
