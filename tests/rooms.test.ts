import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Floors, RoomTemplates, Themes, type RoomTemplate } from '../src/game/defs';
import { Room } from '../src/game/room';
import { facePoint, hasThemeArt, renderRoomPainter, wallGeo } from '../src/game/roomart';
import { CELL_H, CELL_W, SHAPE_CELLS, type RoomKind } from '../src/game/constants';
import { generateFloor, shapeOf } from '../src/game/dungeon';
import { RNG } from '../src/engine/rng';
import { roomHandler } from '../src/game/roomkinds';

loadContent();

/** Tiles a walking player cannot pass (pots/fireplaces too: paths must not require breaking things). */
const BLOCKING = new Set(['#', 'X', 'O', 'p', 't', 's', 'f']);
const ENEMY = new Set(['e', 'E']);

type P = [number, number];

function dims(t: RoomTemplate): { w: number; h: number; cw: number; ch: number } {
  const [cw, ch] = SHAPE_CELLS[t.shape];
  return { w: CELL_W * cw, h: CELL_H * ch, cw, ch };
}

/** Door entrance tiles (interior coords) for every possible door of the shape. */
function entrances(t: RoomTemplate): P[] {
  const { w, h, cw, ch } = dims(t);
  const out: P[] = [];
  for (let cx = 0; cx < cw; cx++) {
    const x = cx * CELL_W + Math.floor(CELL_W / 2);
    out.push([x, 0], [x, h - 1]);
  }
  for (let cy = 0; cy < ch; cy++) {
    const y = cy * CELL_H + Math.floor(CELL_H / 2);
    out.push([0, y], [w - 1, y]);
  }
  return out;
}

function at(t: RoomTemplate, x: number, y: number): string {
  return t.rows[y]?.[x] ?? '#';
}

function flood(t: RoomTemplate, start: P, allowSpikes: boolean): Set<string> {
  const { w, h } = dims(t);
  const seen = new Set<string>([`${start[0]},${start[1]}`]);
  const q: P[] = [start];
  while (q.length) {
    const [x, y] = q.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ch = at(t, nx, ny);
      if (BLOCKING.has(ch) || (!allowSpikes && ch === '^')) continue;
      const k = `${nx},${ny}`;
      if (seen.has(k)) continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  return seen;
}

/** Where `World.teleportTo` / room entry without a door puts the player (Room.nearestFree). */
function fallbackSpot(t: RoomTemplate): P | null {
  const { w, h } = dims(t);
  const tx0 = Math.floor(w / 2 + 2) - 2; // px center -> tile, minus wall
  const ty0 = Math.floor(((h + 4) * 16 / 2 + 20) / 16) - 2;
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && !BLOCKING.has(at(t, x, y)) && at(t, x, y) !== '^';
  if (free(tx0, ty0)) return [tx0, ty0];
  for (let rad = 1; rad < 20; rad++) {
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        if (free(tx0 + dx, ty0 + dy)) return [tx0 + dx, ty0 + dy];
      }
    }
  }
  return null;
}

const KINDS: RoomKind[] = ['start', 'normal', 'treasure', 'shop', 'boss', 'secret', 'challenge', 'shrine', 'curse'];

describe('room templates', () => {
  const all = RoomTemplates.all();

  it('have the right size', () => {
    for (const t of all) {
      const { w, h } = dims(t);
      expect(t.rows.length, t.id).toBe(h);
      for (const row of t.rows) expect(row.length, `${t.id}: "${row}"`).toBe(w);
    }
  });

  it('only use known characters', () => {
    const ok = new Set('.#XO^ptseEfchIBS@'.split(''));
    for (const t of all) for (const row of t.rows) for (const ch of row) expect(ok.has(ch), `${t.id}: '${ch}'`).toBe(true);
  });

  it('have enough normal layouts per shape', () => {
    const count = (shape: string) => all.filter((t) => t.kinds.includes('normal') && t.shape === shape).length;
    expect(count('1x1')).toBeGreaterThanOrEqual(32);
    expect(count('2x1')).toBeGreaterThanOrEqual(8);
    expect(count('1x2')).toBeGreaterThanOrEqual(8);
    expect(count('2x2')).toBeGreaterThanOrEqual(7);
  });

  it('normal templates have difficulty 1..3', () => {
    for (const t of all.filter((x) => x.kinds.includes('normal'))) {
      expect(t.difficulty ?? 1, t.id).toBeGreaterThanOrEqual(1);
      expect(t.difficulty ?? 1, t.id).toBeLessThanOrEqual(3);
    }
  });

  it('every room kind has a 1x1 template and a handler where needed', () => {
    for (const k of KINDS) expect(all.some((t) => t.kinds.includes(k) && t.shape === '1x1'), k).toBe(true);
    for (const k of ['start', 'treasure', 'shop', 'boss', 'secret', 'challenge', 'shrine', 'curse'] as RoomKind[]) {
      expect(roomHandler(k), k).toBeTruthy();
    }
  });

  it('door entrances are open and mutually reachable on foot', () => {
    const problems: string[] = [];
    for (const t of all) {
      const ents = entrances(t);
      for (const [x, y] of ents) {
        const ch = at(t, x, y);
        if (BLOCKING.has(ch) || ch === '^') problems.push(`${t.id}: entrance ${x},${y} is '${ch}'`);
      }
      const reach = flood(t, ents[0], false);
      for (const [x, y] of ents) if (!reach.has(`${x},${y}`)) problems.push(`${t.id}: entrance ${x},${y} unreachable without crossing spikes`);
    }
    expect(problems).toEqual([]);
  });

  it('enemies are reachable and not placed at doors', () => {
    const problems: string[] = [];
    for (const t of all) {
      const ents = entrances(t);
      const reach = flood(t, ents[0], true);
      t.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          if (!ENEMY.has(row[x])) continue;
          if (!reach.has(`${x},${y}`)) problems.push(`${t.id}: enemy at ${x},${y} unreachable`);
          for (const [ex, ey] of ents) {
            if (Math.abs(ex - x) + Math.abs(ey - y) <= 2) problems.push(`${t.id}: enemy at ${x},${y} too close to door ${ex},${ey}`);
          }
        }
      });
    }
    expect(problems).toEqual([]);
  });

  it('pickup markers are reachable', () => {
    const problems: string[] = [];
    for (const t of all) {
      const reach = flood(t, entrances(t)[0], true);
      t.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          if ('ch'.includes(row[x]) && !reach.has(`${x},${y}`)) problems.push(`${t.id}: pickup '${row[x]}' at ${x},${y} unreachable`);
        }
      });
    }
    expect(problems).toEqual([]);
  });

  it('the teleport / start spot is connected to the doors', () => {
    const problems: string[] = [];
    for (const t of all) {
      const spot = fallbackSpot(t);
      const reach = flood(t, entrances(t)[0], true);
      if (!spot || !reach.has(`${spot[0]},${spot[1]}`)) problems.push(`${t.id}: fallback spot ${spot} is isolated`);
    }
    expect(problems).toEqual([]);
  });

  it('special rooms keep their centre free for pedestals / altars', () => {
    for (const t of all.filter((x) => x.kinds.some((k) => ['treasure', 'shop', 'challenge', 'shrine', 'curse', 'start'].includes(k)))) {
      const { w, h } = dims(t);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ch = at(t, Math.floor(w / 2) + dx, Math.floor(h / 2) + dy);
          expect(BLOCKING.has(ch) || ch === '^', `${t.id}: centre blocked by '${ch}'`).toBe(false);
        }
      }
    }
  });

  it('boss arenas have a boss marker with open space around it', () => {
    for (const t of all.filter((x) => x.kinds.includes('boss'))) {
      const rows = t.rows.join('\n');
      expect(rows.includes('B'), t.id).toBe(true);
      let open = 0;
      for (const row of t.rows) for (const ch of row) if (!BLOCKING.has(ch) && ch !== '^') open++;
      expect(open / (t.rows.length * t.rows[0].length), t.id).toBeGreaterThan(0.75);
    }
  });
});

describe('dungeon uses the templates', () => {
  it('every generated room gets a template of its kind and shape', () => {
    for (const floor of Floors.all()) {
      for (let s = 0; s < 25; s++) {
        const map = generateFloor(floor, new RNG(`rooms-${floor.index}-${s}`));
        for (const n of map.nodes) {
          const t = RoomTemplates.get(n.templateId);
          expect(t, `floor ${floor.index} ${n.kind} ${shapeOf(n)}`).toBeTruthy();
          expect(t!.shape, n.templateId).toBe(shapeOf(n));
          expect(t!.kinds.includes(n.kind), `${n.templateId} used for ${n.kind}`).toBe(true);
          if (t!.floors) expect(t!.floors.includes(floor.index), `${n.templateId} on floor ${floor.index}`).toBe(true);
        }
      }
    }
  });

  it('floors with extra special rooms actually produce them', () => {
    for (const floor of Floors.all()) {
      const extra = Object.entries(floor.extraRooms ?? {}).filter(([, p]) => (p ?? 0) > 0).map(([k]) => k as RoomKind);
      if (!extra.length) continue;
      const seen = new Set<RoomKind>();
      for (let s = 0; s < 40; s++) {
        const map = generateFloor(floor, new RNG(`extra-${floor.index}-${s}`));
        for (const n of map.nodes) seen.add(n.kind);
      }
      for (const k of extra) expect(seen.has(k), `floor ${floor.index} never generated ${k}`).toBe(true);
    }
  });
});

describe('room rendering', () => {
  it('every floor theme is registered with room art', () => {
    for (const f of Floors.all()) {
      expect(Themes.has(f.theme), f.theme).toBe(true);
      expect(hasThemeArt(f.theme), f.theme).toBe(true);
    }
  });

  it('wall faces meet the floor edge and rim', () => {
    const g = wallGeo({ pxW: 21 * 16, pxH: 13 * 16 });
    expect(facePoint(g, 'top', g.X0, 0)).toEqual({ x: g.X0, y: g.Y0 });
    expect(facePoint(g, 'top', g.X1, 1)).toEqual({ x: g.RX1, y: g.RY0 });
    expect(facePoint(g, 'left', g.Y1, 1)).toEqual({ x: g.RX0, y: g.RY1 });
    expect(g.RY0).toBeGreaterThanOrEqual(0);
    expect(g.RX0).toBeGreaterThanOrEqual(0);
  });

  it('renders every theme with special and big-room templates (no DOM)', () => {
    // one template per special kind and per big shape, plus pit / spike heavy rooms
    const sample: RoomTemplate[] = [];
    const seen = new Set<string>();
    for (const t of RoomTemplates.all()) {
      const key = t.kinds.includes('normal') ? `n${t.shape}` : t.kinds[0];
      if (seen.has(key) && !/pitring|spikemaze|lavamoat/.test(t.id)) continue;
      seen.add(key);
      sample.push(t);
    }
    for (const f of Floors.all()) {
      const theme = Themes.must(f.theme);
      for (const t of sample) {
        const [cw, ch] = SHAPE_CELLS[t.shape];
        const node = { id: 0, gx: 0, gy: 0, cw, ch, kind: t.kinds[0], templateId: t.id, seed: 1234 + t.id.length, depth: 1, visited: false, cleared: false, discovered: false, locked: false, doors: [] };
        const room = new Room(node, theme, t);
        room.addDoor('N', 0, 0, 1, 'normal', false);
        room.addDoor('E', cw - 1, 0, 2, 'treasure', false);
        room.addDoor('S', 0, ch - 1, 3, 'secret', true);
        const p = renderRoomPainter(room);
        // every pixel of the background is painted (opaque)
        let holes = 0;
        for (let i = 0; i < p.data.length; i++) if (p.data[i] >>> 24 === 0) holes++;
        expect(holes, `${f.theme} ${t.id}`).toBe(0);
      }
    }
  }, 30000);
});
