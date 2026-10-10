import { stageRoomPlan, STAGES_PER_FLOOR } from './stage-plan';
// Floor generation on a MAP_W x MAP_H cell grid.
//  1. grow rooms outward from the start cell with a BFS that refuses cells which
//     would create loops/clumps (neighbour count > 1) -> tree-like layouts with dead ends
//  2. boss room = farthest dead end, then treasure / shop / other specials on dead ends
//  3. secret room = empty cell surrounded by many rooms (hidden doors behind a cold wall sconce)
//  4. merge some normal cells into big rooms (2x1, 1x2, 2x2)
//  5. pick a room template for every node
// A stage (generateStage) also marks one normal room whose rock becomes a stone lantern.

import { RNG } from '../engine/rng';
import { DIRS, DIR_VEC, MAP_H, MAP_W, OPPOSITE, type Dir, type RoomKind, type RoomShape } from './constants';
import { RoomTemplates, type FloorDef, type RoomTemplate } from './defs';

export interface NodeDoor {
  dir: Dir;
  /** absolute map cell (inside this node) the door belongs to */
  cx: number;
  cy: number;
  /** node id on the other side */
  to: number;
  /** hidden secret door (revealed by lighting its cold wall sconce) */
  secret: boolean;
}

export interface RoomNode {
  id: number;
  /** top-left map cell */
  gx: number;
  gy: number;
  /** size in cells */
  cw: number;
  ch: number;
  kind: RoomKind;
  templateId: string;
  seed: number;
  /** BFS distance from the start room */
  depth: number;
  visited: boolean;
  cleared: boolean;
  /** shown on the minimap (adjacent to a visited room, or revealed by an item) */
  discovered: boolean;
  /** sealed treasure / shop room (floor 2+): a match burns the seal */
  locked: boolean;
  /** stage lantern: one rock (or open floor tile) of this room becomes a stone lantern (World.buildRoom) */
  lantern?: boolean;
  doors: NodeDoor[];
  /** room state saved when the player leaves (see World) */
  saved?: unknown;
}

export interface FloorMap {
  /** Starting room containing the optional passage to the next stage. */
  exitId?: number;
  floor: FloorDef;
  nodes: RoomNode[];
  /** cell -> node id (-1 empty) */
  grid: Int16Array;
  startId: number;
  bossId: number;
}

/** Branching expeditions: an optional exit at spawn, with all exploration preserved. */
export function generateStage(floor: FloorDef, stage: number, rng: RNG): FloorMap {
  const plan = stageRoomPlan(rng);
  const specials: RoomKind[] = ['boss', ...plan.filter(k => k !== 'secret')];
  const normal = stage < STAGES_PER_FLOOR ? 6 : 7;
  const size = 1 + specials.length + normal;
  const map = generateFloor({ ...floor, roomCount: [size, size + 2], extraRooms: {} }, rng,
    { fixedSpecials: specials, secret: plan.includes('secret'), minNormal: normal });
  map.floor = floor;
  // the far dead end the boss would hold (a plain room before the boss stage)
  const bossCell = map.bossId;
  for (const n of map.nodes) {
    if (stage < STAGES_PER_FLOOR && n.kind === 'boss') n.kind = 'normal';
    n.locked = floor.index >= 2 && (n.kind === 'treasure' || n.kind === 'shop');
    n.templateId = pickTemplate(n, floor, rng)?.id ?? '';
  }
  for (const n of map.nodes) for (const d of n.doors) d.secret = n.kind === 'secret' || map.nodes[d.to].kind === 'secret';
  if (stage < STAGES_PER_FLOOR) {
    // Players may leave immediately or return after exploring. The boss stage
    // has no shortcut; its passage still appears only after the boss is defeated.
    map.exitId = map.startId;
    map.bossId = -1;
  }
  for (const d of map.nodes[map.startId].doors) if (!d.secret) map.nodes[d.to].discovered = true;
  markStageLantern(map, floor, stage, bossCell);
  return map;
}

/**
 * One normal room per stage gets a stone lantern (a rock converted in
 * World.buildRoom): never the start / exit room nor the stage's far (boss) cell;
 * on the very first stage a room next to the start when there is one. Drawn
 * from its own stream (a hash of the node seeds), never from the layout rng.
 */
function markStageLantern(map: FloorMap, floor: FloorDef, stage: number, bossCell: number): void {
  let seed = 0;
  for (const n of map.nodes) seed = (Math.imul(seed ^ n.seed, 0x9e3779b1) + n.id + 1) >>> 0;
  const lr = new RNG((seed ^ 0x1a7e57) >>> 0);
  let cands = map.nodes.filter((n) => n.kind === 'normal' && n.id !== map.startId && n.id !== bossCell);
  if (floor.index === 1 && stage === 1) {
    const near = new Set(map.nodes[map.startId].doors.filter((d) => !d.secret).map((d) => d.to));
    const first = cands.filter((n) => near.has(n.id));
    if (first.length) cands = first;
  }
  if (!cands.length) return;
  lr.pick(cands).lantern = true;
}

export function shapeOf(n: RoomNode): RoomShape {
  return `${n.cw}x${n.ch}` as RoomShape;
}

function cellIdx(x: number, y: number): number {
  return y * MAP_W + x;
}

function inMap(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
}

interface GenOpts {
  /** extra special room kinds required on this floor */
  extraKinds?: RoomKind[];
  fixedSpecials?: RoomKind[];
  secret?: boolean;
  minNormal?: number;
  allowBigRooms?: boolean;
}

/** Generate the layout (cells -> nodes) for a floor. Deterministic for a given rng state. */
export function generateFloor(floor: FloorDef, rng: RNG, opts: GenOpts = {}): FloorMap {
  for (let attempt = 0; attempt < 200; attempt++) {
    const map = tryGenerate(floor, rng, opts);
    if (map) return map;
  }
  throw new Error('floor generation failed');
}

function tryGenerate(floor: FloorDef, rng: RNG, opts: GenOpts): FloorMap | null {
  const target = rng.int(floor.roomCount[0], floor.roomCount[1]);
  const occ = new Uint8Array(MAP_W * MAP_H);
  const sx = Math.floor(MAP_W / 2);
  const sy = Math.floor(MAP_H / 2);
  const cells: [number, number][] = [[sx, sy]];
  occ[cellIdx(sx, sy)] = 1;
  const queue: [number, number][] = [[sx, sy]];
  const countNeighbours = (x: number, y: number) => {
    let n = 0;
    for (const d of DIRS) {
      const nx = x + DIR_VEC[d].x;
      const ny = y + DIR_VEC[d].y;
      if (inMap(nx, ny) && occ[cellIdx(nx, ny)]) n++;
    }
    return n;
  };
  let guard = 0;
  while (cells.length < target && guard++ < 2000) {
    if (queue.length === 0) {
      // re-seed growth from a random existing cell
      queue.push(rng.pick(cells));
    }
    const [cx, cy] = queue.shift()!;
    let added = false;
    for (const d of rng.shuffle([...DIRS])) {
      const nx = cx + DIR_VEC[d].x;
      const ny = cy + DIR_VEC[d].y;
      if (!inMap(nx, ny) || nx === 0 || ny === 0 || nx === MAP_W - 1 || ny === MAP_H - 1) continue;
      if (occ[cellIdx(nx, ny)]) continue;
      if (countNeighbours(nx, ny) > 1) continue;
      if (cells.length >= target) break;
      if (rng.chance(0.5) && !(cx === sx && cy === sy)) continue;
      occ[cellIdx(nx, ny)] = 1;
      cells.push([nx, ny]);
      queue.push([nx, ny]);
      added = true;
    }
    if (!added && queue.length === 0 && cells.length < target) queue.push(rng.pick(cells));
  }
  if (cells.length < floor.roomCount[0]) return null;

  // BFS depth from start
  const depth = new Int16Array(MAP_W * MAP_H).fill(-1);
  depth[cellIdx(sx, sy)] = 0;
  const bq: [number, number][] = [[sx, sy]];
  while (bq.length) {
    const [x, y] = bq.shift()!;
    for (const d of DIRS) {
      const nx = x + DIR_VEC[d].x;
      const ny = y + DIR_VEC[d].y;
      if (!inMap(nx, ny) || !occ[cellIdx(nx, ny)] || depth[cellIdx(nx, ny)] >= 0) continue;
      depth[cellIdx(nx, ny)] = depth[cellIdx(x, y)] + 1;
      bq.push([nx, ny]);
    }
  }

  // dead ends (exactly one neighbour, not start)
  const deadEnds = cells
    .filter(([x, y]) => !(x === sx && y === sy) && countNeighbours(x, y) === 1)
    .sort((a, b) => depth[cellIdx(b[0], b[1])] - depth[cellIdx(a[0], a[1])]);

  const specials: RoomKind[] = opts.fixedSpecials ? [...opts.fixedSpecials] : ['boss', 'treasure', 'shop'];
  if (!opts.fixedSpecials && floor.extraRooms) {
    for (const [k, p] of Object.entries(floor.extraRooms) as [RoomKind, number][]) {
      if (rng.chance(p)) specials.push(k);
    }
  }
  if (opts.extraKinds) specials.push(...opts.extraKinds);
  if (deadEnds.length < specials.length) return null;
  // boss must not be adjacent to start
  const bossCell = deadEnds[0];
  if (depth[cellIdx(bossCell[0], bossCell[1])] < 2) return null;

  const kindAt = new Map<number, RoomKind>();
  kindAt.set(cellIdx(bossCell[0], bossCell[1]), 'boss');
  const rest = rng.shuffle(deadEnds.slice(1));
  for (let i = 1; i < specials.length; i++) kindAt.set(cellIdx(rest[i - 1][0], rest[i - 1][1]), specials[i]);

  // secret room: empty cell with the most neighbours (>= 2), not next to the boss
  let secret: [number, number] | null = null;
  let bestScore = -1;
  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      if (occ[cellIdx(x, y)]) continue;
      let n = 0;
      let nearBoss = false;
      let nearSpecial = false;
      for (const d of DIRS) {
        const nx = x + DIR_VEC[d].x;
        const ny = y + DIR_VEC[d].y;
        if (!inMap(nx, ny) || !occ[cellIdx(nx, ny)]) continue;
        n++;
        const k = kindAt.get(cellIdx(nx, ny));
        if (k === 'boss') nearBoss = true;
        else if (k) nearSpecial = true;
      }
      if (nearBoss || n < 2) continue;
      const score = n * 10 - (nearSpecial ? 5 : 0) + rng.next();
      if (score > bestScore) {
        bestScore = score;
        secret = [x, y];
      }
    }
  }

  if (opts.secret === true && !secret) return null;
  if (opts.secret === false) secret = null;

  // build nodes (initially 1x1)
  const grid = new Int16Array(MAP_W * MAP_H).fill(-1);
  const nodes: RoomNode[] = [];
  const mk = (x: number, y: number, kind: RoomKind): RoomNode => {
    const n: RoomNode = {
      id: nodes.length, gx: x, gy: y, cw: 1, ch: 1, kind, templateId: '', seed: rng.nextU32(),
      depth: Math.max(0, depth[cellIdx(x, y)]), visited: false, cleared: false, discovered: false,
      locked: false, doors: [],
    };
    nodes.push(n);
    grid[cellIdx(x, y)] = n.id;
    return n;
  };
  let startId = 0;
  let bossId = 0;
  for (const [x, y] of cells) {
    const kind: RoomKind = x === sx && y === sy ? 'start' : kindAt.get(cellIdx(x, y)) ?? 'normal';
    const n = mk(x, y, kind);
    if (kind === 'start') startId = n.id;
    if (kind === 'boss') bossId = n.id;
  }
  if (secret) {
    const n = mk(secret[0], secret[1], 'secret');
    n.depth = 99;
  }

  // merge normal cells into big rooms
  if (opts.allowBigRooms !== false && floor.index >= 1) mergeBigRooms(nodes, grid, rng, floor.index, opts.minNormal ?? 0);
  // merging re-indexes the nodes: look the start / boss ids up again
  startId = nodes.findIndex((n) => n.kind === 'start');
  bossId = nodes.findIndex((n) => n.kind === 'boss');

  // doors between all adjacent different nodes
  for (const n of nodes) {
    for (let cy = n.gy; cy < n.gy + n.ch; cy++) {
      for (let cx = n.gx; cx < n.gx + n.cw; cx++) {
        for (const d of DIRS) {
          const nx = cx + DIR_VEC[d].x;
          const ny = cy + DIR_VEC[d].y;
          if (!inMap(nx, ny)) continue;
          const other = grid[cellIdx(nx, ny)];
          if (other < 0 || other === n.id) continue;
          const o = nodes[other];
          // special dead-end rooms connect only through their single neighbour (already guaranteed)
          const secretDoor = n.kind === 'secret' || o.kind === 'secret';
          n.doors.push({ dir: d, cx, cy, to: other, secret: secretDoor });
        }
      }
    }
  }

  // floors 2+ seal treasure rooms & shops (a match burns the seal); floor 1 is open
  for (const n of nodes) {
    if ((n.kind === 'treasure' || n.kind === 'shop') && floor.index >= 2) n.locked = true;
  }

  // templates
  for (const n of nodes) {
    const t = pickTemplate(n, floor, rng);
    n.templateId = t?.id ?? '';
  }

  const start = nodes[startId];
  start.visited = true;
  start.discovered = true;
  start.cleared = true;
  for (const d of start.doors) if (!d.secret) nodes[d.to].discovered = true;

  return { floor, nodes, grid, startId, bossId };
}

function mergeBigRooms(nodes: RoomNode[], grid: Int16Array, rng: RNG, floorIndex: number, minNormal = 0): void {
  let normalCount = nodes.filter(n => n.kind === 'normal').length;
  // deeper floors have more big rooms (capped: floors 6+ like floor 5)
  const chance = 0.18 + Math.min(5, floorIndex) * 0.05;
  const isNormal1x1 = (x: number, y: number) => {
    if (!inMap(x, y)) return false;
    const id = grid[cellIdx(x, y)];
    if (id < 0) return false;
    const n = nodes[id];
    return n.kind === 'normal' && n.cw === 1 && n.ch === 1 && !n.doors.length;
  };
  const order = rng.shuffle(nodes.filter((n) => n.kind === 'normal').map((n) => n.id));
  for (const id of order) {
    const n = nodes[id];
    if (n.cw !== 1 || n.ch !== 1 || n.kind !== 'normal') continue;
    if (!rng.chance(chance)) continue;
    const { gx: x, gy: y } = n;
    const options: [number, number][] = [];
    if (isNormal1x1(x + 1, y) && isNormal1x1(x, y + 1) && isNormal1x1(x + 1, y + 1)) options.push([2, 2]);
    if (isNormal1x1(x + 1, y)) options.push([2, 1]);
    if (isNormal1x1(x, y + 1)) options.push([1, 2]);
    if (!options.length) continue;
    // prefer 2x2 less often
    const [cw, ch] = options.length > 1 && options[0][0] === 2 && options[0][1] === 2 && rng.chance(0.6) ? options[1] : options[0];
    if (normalCount - (cw * ch - 1) < minNormal) continue;
    normalCount -= cw * ch - 1;
    if (!hasTemplate(`${cw}x${ch}` as RoomShape, 'normal', floorIndex)) continue;
    for (let yy = y; yy < y + ch; yy++) {
      for (let xx = x; xx < x + cw; xx++) {
        if (xx === x && yy === y) continue;
        const other = grid[cellIdx(xx, yy)];
        nodes[other].kind = 'normal';
        nodes[other].cw = 0; // mark removed
        grid[cellIdx(xx, yy)] = id;
      }
    }
    n.cw = cw;
    n.ch = ch;
  }
  // compact: remove merged nodes and re-index
  const keep = nodes.filter((n) => n.cw > 0);
  const remap = new Map<number, number>();
  keep.forEach((n, i) => remap.set(n.id, i));
  for (let i = 0; i < grid.length; i++) if (grid[i] >= 0) grid[i] = remap.get(grid[i]) ?? -1;
  keep.forEach((n, i) => (n.id = i));
  nodes.length = 0;
  nodes.push(...keep);
}

function hasTemplate(shape: RoomShape, kind: RoomKind, floorIndex: number): boolean {
  return RoomTemplates.all().some((t) => t.shape === shape && t.kinds.includes(kind) && (!t.floors || t.floors.includes(floorIndex)));
}

export function pickTemplate(n: RoomNode, floor: FloorDef, rng: RNG): RoomTemplate | undefined {
  const shape = shapeOf(n);
  let options = RoomTemplates.all().filter((t) => t.shape === shape && t.kinds.includes(n.kind) && (!t.floors || t.floors.includes(floor.index)));
  if (!options.length) options = RoomTemplates.all().filter((t) => t.shape === shape && t.kinds.includes(n.kind));
  if (!options.length && n.kind !== 'normal') options = RoomTemplates.all().filter((t) => t.shape === shape && t.kinds.includes('normal'));
  // deeper rooms favour harder templates
  return rng.weighted(options, (t) => (t.weight ?? 1) * (1 + (t.difficulty ?? 1) * Math.min(1, n.depth / 6) * 0.5));
}

export function nodeAtCell(map: FloorMap, x: number, y: number): RoomNode | null {
  if (!inMap(x, y)) return null;
  const id = map.grid[cellIdx(x, y)];
  return id >= 0 ? map.nodes[id] : null;
}

/** Find the door on node `to` that leads back to node `from` through the given direction. */
export function matchingDoor(map: FloorMap, from: RoomNode, door: NodeDoor): NodeDoor | undefined {
  const target = map.nodes[door.to];
  const tx = door.cx + DIR_VEC[door.dir].x;
  const ty = door.cy + DIR_VEC[door.dir].y;
  return target.doors.find((d) => d.to === from.id && d.cx === tx && d.cy === ty && d.dir === OPPOSITE[door.dir]);
}
