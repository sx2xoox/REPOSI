// QA invariants: dungeon generation across many seeds, and every artifact's
// stats() hook on a fresh StatMods.
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Artifacts, Floors, RoomTemplates, Sets, Characters } from '../src/game/defs';
import { generateFloor, matchingDoor, shapeOf, type FloorMap, type RoomNode } from '../src/game/dungeon';
import { DIR_VEC, MAP_H, MAP_W, type RoomKind } from '../src/game/constants';
import { RNG } from '../src/engine/rng';
import { BASE_STATS, StatMods, computeStats } from '../src/game/stats';
import type { World } from '../src/game/world';

loadContent();

const SEEDS = 300;
/** rooms that must sit at a dead end (one non-secret door) */
const DEAD_END: RoomKind[] = ['boss', 'treasure', 'shop', 'challenge', 'shrine', 'curse'];

function checkMap(map: FloorMap, floorIndex: number): string[] {
  const errs: string[] = [];
  const { nodes } = map;
  const count = (k: RoomKind) => nodes.filter((n) => n.kind === k).length;
  for (const k of ['start', 'boss', 'treasure', 'shop'] as RoomKind[]) if (count(k) !== 1) errs.push(`${count(k)} ${k} rooms`);
  for (const k of ['secret', 'challenge', 'shrine', 'curse'] as RoomKind[]) if (count(k) > 1) errs.push(`${count(k)} ${k} rooms`);
  if (nodes[map.startId]?.kind !== 'start') errs.push('startId is not the start room');
  if (nodes[map.bossId]?.kind !== 'boss') errs.push('bossId is not the boss room');
  const floor = Floors.all().find((f) => f.index === floorIndex)!;
  // roomCount counts map cells (big rooms merge cells; the secret room comes on top)
  const cells = nodes.filter((n) => n.kind !== 'secret').reduce((s, n) => s + n.cw * n.ch, 0);
  if (cells < floor.roomCount[0] || cells > floor.roomCount[1]) errs.push(`room cells ${cells} outside ${floor.roomCount}`);

  // grid <-> node cells
  const cellsSeen = new Map<number, number>();
  nodes.forEach((n, i) => {
    if (n.id !== i) errs.push(`node ${i} has id ${n.id}`);
    if (n.cw < 1 || n.ch < 1 || n.cw > 2 || n.ch > 2) errs.push(`node ${n.id} bad size ${n.cw}x${n.ch}`);
    for (let y = n.gy; y < n.gy + n.ch; y++) {
      for (let x = n.gx; x < n.gx + n.cw; x++) {
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) errs.push(`node ${n.id} outside map`);
        const c = y * MAP_W + x;
        if (cellsSeen.has(c)) errs.push(`cell ${x},${y} shared by ${cellsSeen.get(c)} and ${n.id}`);
        cellsSeen.set(c, n.id);
        if (map.grid[c] !== n.id) errs.push(`grid ${x},${y} = ${map.grid[c]} expected ${n.id}`);
      }
    }
    if (n.kind !== 'normal' && (n.cw !== 1 || n.ch !== 1)) errs.push(`${n.kind} room ${n.id} is ${shapeOf(n)}`);
  });
  for (let c = 0; c < map.grid.length; c++) if (map.grid[c] >= 0 && !cellsSeen.has(c)) errs.push(`grid cell ${c} -> ${map.grid[c]} not covered by that node`);

  // doors: inside own node, lead to the adjacent node, symmetric, secret flag consistent
  for (const n of nodes) {
    for (const d of n.doors) {
      const own = map.grid[d.cy * MAP_W + d.cx];
      if (own !== n.id) errs.push(`node ${n.id} door ${d.dir} at foreign cell`);
      const nx = d.cx + DIR_VEC[d.dir].x;
      const ny = d.cy + DIR_VEC[d.dir].y;
      if (map.grid[ny * MAP_W + nx] !== d.to) errs.push(`node ${n.id} door ${d.dir} -> ${d.to} not adjacent`);
      const back = matchingDoor(map, n, d);
      if (!back) errs.push(`node ${n.id} door ${d.dir} -> ${d.to} has no matching door`);
      else if (back.secret !== d.secret) errs.push(`secret flag mismatch ${n.id}<->${d.to}`);
      const t = nodes[d.to];
      if (d.secret !== (n.kind === 'secret' || t.kind === 'secret')) errs.push(`door ${n.id}->${d.to} secret=${d.secret}`);
    }
    const dup = new Set(n.doors.map((d) => `${d.cx},${d.cy},${d.dir}`));
    if (dup.size !== n.doors.length) errs.push(`node ${n.id} duplicate doors`);
  }

  // connectivity from start through non-secret doors
  const seen = new Set<number>([map.startId]);
  const q = [map.startId];
  while (q.length) {
    const id = q.shift()!;
    for (const d of nodes[id].doors) if (!d.secret && !seen.has(d.to)) { seen.add(d.to); q.push(d.to); }
  }
  for (const n of nodes) {
    if (n.kind === 'secret') {
      if (!n.doors.length) errs.push('secret room without doors');
      if (n.doors.some((d) => !seen.has(d.to))) errs.push('secret room next to an unreachable room');
    } else if (!seen.has(n.id)) errs.push(`node ${n.id} (${n.kind}) unreachable`);
  }
  // the boss must be reachable without walking through a locked room or another special room
  const seen2 = new Set<number>([map.startId]);
  const q2 = [map.startId];
  while (q2.length) {
    const id = q2.shift()!;
    if (id !== map.startId && nodes[id].kind !== 'normal') continue;
    for (const d of nodes[id].doors) if (!d.secret && !seen2.has(d.to)) { seen2.add(d.to); q2.push(d.to); }
  }
  if (!seen2.has(map.bossId)) errs.push('boss only reachable through a special room');

  // dead ends, boss distance, locks, templates
  for (const n of nodes) {
    const open = n.doors.filter((d) => !d.secret);
    if (DEAD_END.includes(n.kind) && open.length !== 1) errs.push(`${n.kind} room ${n.id} has ${open.length} doors`);
    if (n.kind === 'boss' && n.doors.some((d) => d.to === map.startId)) errs.push('boss next to start');
    const shouldLock = (n.kind === 'treasure' || n.kind === 'shop') && floorIndex >= 2;
    if (n.locked !== shouldLock) errs.push(`${n.kind} room locked=${n.locked}`);
    const t = RoomTemplates.all().find((x) => x.id === n.templateId);
    if (!t) { errs.push(`node ${n.id} (${n.kind} ${shapeOf(n)}) has no template`); continue; }
    if (t.shape !== shapeOf(n)) errs.push(`template ${t.id} shape ${t.shape} != ${shapeOf(n)}`);
    if (!t.kinds.includes(n.kind)) errs.push(`template ${t.id} kinds ${t.kinds} lack ${n.kind}`);
    if (t.floors && !t.floors.includes(floorIndex)) errs.push(`template ${t.id} not for floor ${floorIndex}`);
  }
  const boss = nodes[map.bossId];
  if (boss.depth < 2) errs.push(`boss depth ${boss.depth}`);
  const start = nodes[map.startId];
  if (!start.cleared || !start.visited) errs.push('start room not marked visited/cleared');
  return errs;
}

describe('dungeon generation invariants', () => {
  for (const floor of Floors.all()) {
    it(`floor ${floor.index}: ${SEEDS} seeds`, () => {
      const failures: string[] = [];
      const kinds = new Map<string, number>();
      for (let i = 0; i < SEEDS; i++) {
        const seed = `QA-${i}#floor${floor.index}`;
        let map: FloorMap;
        try {
          map = generateFloor(floor, new RNG(seed));
        } catch (e) {
          failures.push(`${seed}: threw ${String(e)}`);
          continue;
        }
        for (const n of map.nodes) kinds.set(n.kind, (kinds.get(n.kind) ?? 0) + 1);
        const errs = checkMap(map, floor.index);
        if (errs.length) failures.push(`${seed}: ${[...new Set(errs)].slice(0, 4).join('; ')}`);
        // deterministic
        const again = generateFloor(floor, new RNG(seed));
        if (again.nodes.map((n: RoomNode) => `${n.kind}${n.gx},${n.gy}${n.templateId}`).join() !== map.nodes.map((n) => `${n.kind}${n.gx},${n.gy}${n.templateId}`).join()) failures.push(`${seed}: not deterministic`);
      }
      expect(failures.slice(0, 10)).toEqual([]);
      // optional rooms configured for the floor actually show up
      for (const [k, p] of Object.entries(floor.extraRooms ?? {})) if (p > 0.3) expect(kinds.get(k) ?? 0, `${k} on floor ${floor.index}`).toBeGreaterThan(SEEDS * p * 0.5);
    });
  }
});

// ------------------------------------------------------------------ artifact stats hooks
function fakeWorld(): World {
  const noop = () => {};
  const player = {
    x: 100, y: 100, red: 4, soul: 2, maxRed: 6, coins: 12, matches: 3, ember: 40, god: false, alive: true,
    weaponId: Characters.all()[0].weapon, activeId: null, potionId: null, activeCharge: 0, invuln: 0, dashT: 0, vx: 0, vy: 0, aim: 0, firing: false,
    stats: { ...BASE_STATS }, flags: new Set<string>(), mem: {}, character: Characters.all()[0], inv: { items: [] },
    hurt: () => false, heal: noop, addSoul: noop,
  };
  return {
    time: 30, roomTime: 5, dt: 1 / 60, vars: {}, flags: new Set<string>(), player, enemies: [], projectiles: [], entities: [],
    run: { floor: 2, stats: { kills: 3, roomsCleared: 2, timeSec: 30 } },
    node: { kind: 'normal', cleared: false }, floor: Floors.all()[0],
    items: { recompute: noop, recomputeStats: noop, addBuff: noop, has: () => false, count: () => 0, computed: { artifacts: [] } },
    particles: { burst: noop, spawn: noop, list: [] }, lights: { add: noop, glow: noop },
    sfx: noop, shake: noop, banner: noop, floatText: noop, spawn: <T>(e: T) => e,
  } as unknown as World;
}

describe('artifact stats hooks', () => {
  it('every artifact stats() runs on a fresh StatMods and yields finite stats', () => {
    const bad: string[] = [];
    for (const a of Artifacts.all()) {
      for (const power of [1, 3]) {
        const m = new StatMods();
        try {
          a.stats?.(m, power, fakeWorld());
          const s = computeStats(BASE_STATS, m);
          for (const [k, v] of Object.entries(s)) if (!Number.isFinite(v)) bad.push(`${a.id} x${power}: ${k}=${v}`);
          for (const [k, v] of [...Object.entries(m.add), ...Object.entries(m.mul)]) if (!Number.isFinite(v as number)) bad.push(`${a.id} x${power}: mod ${k}=${v}`);
        } catch (e) {
          bad.push(`${a.id} x${power}: threw ${String(e)}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(Artifacts.all().length).toBeGreaterThanOrEqual(60);
  });

  it('every resonance tier stats() runs on a fresh StatMods', () => {
    const bad: string[] = [];
    for (const set of Sets.all()) {
      for (const tier of set.tiers) {
        const m = new StatMods();
        try {
          tier.hooks.stats?.(m, 1, fakeWorld());
          for (const [k, v] of Object.entries(computeStats(BASE_STATS, m))) if (!Number.isFinite(v)) bad.push(`${set.tag}@${tier.count}: ${k}=${v}`);
        } catch (e) {
          bad.push(`${set.tag}@${tier.count}: threw ${String(e)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
