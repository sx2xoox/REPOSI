// 등불 성좌도 map art: glyph tables, per-floor looks and the room painters
// (what shows where on the board and the minimap).
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Floors, lastFloorIndex, type ThemeDef } from '../src/game/defs';
import { RNG } from '../src/engine/rng';
import { packColor, type PixelPainter } from '../src/engine/painter';
import { generateFloor, generateStage, type FloorMap } from '../src/game/dungeon';
import { ROOM_ICONS } from '../src/ui/logic';
import {
  BEAD, BOARD_IN_H, BOARD_IN_W, CORNER, EMBLEM, FLAME3, FLAME5, FLAME7, HOT, LOCK, MINI_LAYOUT, MINI_SIZE, SIGIL5, SIGIL7, SMOULDER,
  paintBoardStatic, paintCompass, paintEmblemMedallion, paintFlame, paintMapPlate, paintMiniBackground, paintPip, paintRooms, paintStageBead,
  paintVignette, plateRect, type SigilKey,
} from '../src/ui/map-art';
import { MAP_LOOK, deriveLook, lookFor, type MapLook } from '../src/ui/map-look';
import { boardLayout, buildMapView, type MapSource, type MapView } from '../src/ui/map-view';

loadContent();

const HEX = /^#[0-9a-f]{6}$/i;
const dims = (m: string[]) => [Math.max(...m.map((r) => r.length)), m.length];

function stub(map: FloorMap, stage = 1, staged = true): MapSource {
  const node = map.nodes[map.startId];
  node.visited = true;
  node.cleared = true;
  return {
    map, node, flags: new Set<string>(), players: [{ slot: 0, downed: false }], local: { slot: 0, x: 200, y: 120 },
    run: { staged, floor: map.floor.index, stage, seed: 'ART' }, room: { pxW: 400, pxH: 240 },
  };
}

const boardOf = (v: MapView) => boardLayout(v.bounds, BOARD_IN_W - 12, BOARD_IN_H - 12, { x: 6, y: 6 });

function pixels(p: PixelPainter, x: number, y: number, w: number, h: number): number[] {
  const out: number[] = [];
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) out.push(p.get(xx, yy));
  return out;
}

describe('glyph tables', () => {
  it('every room kind with a map icon (and the exit) has a 7x7 and a 5x5 sigil of h/m/d/k only', () => {
    const keys: SigilKey[] = [...(Object.keys(ROOM_ICONS) as SigilKey[]), 'exit'];
    for (const k of keys) {
      const s7 = SIGIL7[k];
      const s5 = SIGIL5[k];
      expect(s7, k).toBeDefined();
      expect(s5, k).toBeDefined();
      expect(s7!.length, k).toBe(7);
      expect(s5!.length, k).toBe(5);
      for (const r of s7!) expect(r, k).toMatch(/^[hmdk.]{7}$/);
      for (const r of s5!) expect(r, k).toMatch(/^[hmdk.]{5}$/);
    }
  });
  it('flames, lock, emblems, corners and the bead have their sizes', () => {
    expect(FLAME7).toHaveLength(3);
    for (const f of FLAME7) expect(dims(f)).toEqual([7, 9]);
    for (const f of FLAME5) expect(dims(f)).toEqual([5, 5]);
    expect(dims(FLAME3)).toEqual([3, 4]);
    expect(dims(LOCK)).toEqual([3, 4]);
    for (const e of Object.values(EMBLEM)) expect(dims(e)).toEqual([7, 7]);
    for (const c of Object.values(CORNER)) expect(dims(c)).toEqual([9, 9]);
    expect(dims(BEAD)).toEqual([8, 9]);
  });
});

describe('per-floor looks', () => {
  const colours = (l: MapLook) => [l.light, l.thread, l.rim, l.mote, ...l.bg, ...l.glass, ...l.metal];
  it('every floor resolves a look with valid colours', () => {
    for (let i = 1; i <= lastFloorIndex(); i++) {
      const f = Floors.all().find((x) => x.index === i)!;
      const l = lookFor(f.theme);
      expect(MAP_LOOK[f.theme], f.theme).toBeDefined();
      for (const c of colours(l)) expect(c, `${f.theme} ${c}`).toMatch(HEX);
    }
  });
  it('a theme without an entry gets a look derived from its palette', () => {
    const fake: ThemeDef = {
      id: 'test_depths', name: 'x', ambient: '#8090a0',
      palette: { floor: ['#101010'], wall: ['#101418', '#182028', '#203040', '#304860'], rock: ['#202020'], pit: '#000000', accent: ['#205080', '#40a0ff', '#c0e0ff'], dark: '#04060a' },
    };
    const l = lookFor(fake);
    expect(l).toEqual(deriveLook(fake));
    expect(l.id).toBe('test_depths');
    expect(l.light).toBe('#40a0ff');
    expect(l.emblem).toBe('lantern');
    for (const c of colours(l)) expect(c).toMatch(HEX);
    expect(colours(lookFor('no-such-theme')).every((c) => HEX.test(c))).toBe(true);
  });
});

describe('paintRooms', () => {
  const hot = new Set([HOT.top, HOT.bottom, HOT.rim, HOT.shade, HOT.ring].map(packColor));

  it('paints the hot ramp only on the current plate, nothing over unknown rooms, no sigil on seen plain rooms, eyes on uncleared ones', () => {
    for (const [fi, stage] of [[1, 1], [2, 2], [3, 3], [4, 1], [6, 2], [7, 3]] as const) {
      const f = Floors.all().find((x) => x.index === fi)!;
      const map = generateStage(f, stage, new RNG(`PAINT-${fi}-${stage}`));
      const src = stub(map, stage);
      // visit one neighbour and leave it uncleared; reveal another
      const nb = map.nodes[map.startId].doors.map((d) => map.nodes[d.to]).filter((n) => n.kind === 'normal');
      if (nb[0]) {
        nb[0].visited = true;
        nb[0].cleared = false;
        nb[0].discovered = true;
      }
      const v = buildMapView(src);
      const look = lookFor(v.themeId);
      for (const lod of ['board', 'mini'] as const) {
        const L = lod === 'board' ? boardOf(v) : MINI_LAYOUT;
        const { painter: p } = paintRooms(v, look, L, lod, lod === 'mini' ? { w: MINI_SIZE, h: MINI_SIZE } : undefined);
        const cur = plateRect(map.nodes[map.startId], L);
        for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
          if (!hot.has(p.get(x, y))) continue;
          const inside = x >= cur.x - 1 && x <= cur.x + cur.w && y >= cur.y - 1 && y <= cur.y + cur.h;
          expect(inside, `${lod} hot pixel at ${x},${y} outside the current plate`).toBe(true);
        }
        // unknown rooms leave no trace on the minimap (the board's reach rings may pass over them)
        if (lod === 'mini') {
          for (const n of map.nodes) {
            if (v.nodes.some((k) => k.id === n.id)) continue;
            const r = plateRect(n, L);
            expect(pixels(p, r.x + 1, r.y + 1, r.w - 2, r.h - 2).every((c) => c === 0), `unknown room ${n.id}`).toBe(true);
          }
        }
        // seen plain rooms: only the dark plate and its ember (no sigil colours)
        const allowedSeen = new Set(['#05030a', '#0e0a14', '#1a1424', '#2a2236', '#3e3450', '#211a2c', '#6a2c12', '#e07a2a', '#a8481c'].map(packColor));
        for (const n of v.nodes) {
          if (n.state !== 'seen' || n.exit || n.kind !== 'normal') continue;
          const r = plateRect(n, L);
          for (const c of pixels(p, r.x, r.y, r.w, r.h)) expect(allowedSeen.has(c), `seen room ${n.id} ${lod}`).toBe(true);
        }
        if (nb[0]) {
          const r = plateRect(nb[0], L);
          const eye = packColor(lod === 'board' ? SMOULDER.eye : SMOULDER.eyeMini);
          expect(pixels(p, r.x, r.y, r.w, r.h).filter((c) => c === eye)).toHaveLength(2);
        }
      }
    }
  });

  it('never throws for floors 1-7 x stages 1-3 x 3 seeds and legacy maps, at both LODs', () => {
    for (const f of Floors.all()) {
      const look = lookFor(f.theme);
      const maps: [FloorMap, number, boolean][] = [];
      for (const stage of [1, 2, 3]) for (const seed of ['A', 'B', 'C']) maps.push([generateStage(f, stage, new RNG(`${seed}-${f.index}-${stage}`)), stage, true]);
      maps.push([generateFloor(f, new RNG(`LEGACY-${f.index}`)), 1, false]);
      for (const [map, stage, staged] of maps) {
        // reveal everything, visit and clear half
        map.nodes.forEach((n, i) => {
          n.discovered = true;
          if (i % 2 === 0) {
            n.visited = true;
            n.cleared = i % 4 === 0;
          }
        });
        const src = stub(map, stage, staged);
        (src.flags as Set<string>).add('mapRevealSecret');
        const v = buildMapView(src);
        expect(() => paintRooms(v, look, boardOf(v), 'board')).not.toThrow();
        expect(() => paintRooms(v, look, MINI_LAYOUT, 'mini', { w: MINI_SIZE, h: MINI_SIZE })).not.toThrow();
      }
      expect(() => {
        paintBoardStatic(look);
        paintEmblemMedallion(look);
        paintCompass(look);
        paintMiniBackground(look);
        paintVignette(look, 108, 70, 54, 35, 11, 40);
        for (const s of ['past', 'current', 'future'] as const) paintStageBead(look, s, true);
      }).not.toThrow();
    }
    expect(() => {
      paintMapPlate();
      for (const f of [...FLAME7, ...FLAME5, FLAME3]) paintFlame(f);
      paintPip('#ff8040', false);
      paintPip('#ff8040', true);
    }).not.toThrow();
  });

  it('leaves the minimap window transparent inside the plate', () => {
    const p = paintMapPlate();
    expect(p.w).toBe(62);
    expect(p.h).toBe(43);
    // the content area is see-through apart from the two window bolts in its bottom corners
    let solid = 0;
    for (let y = 5; y < 40; y++) for (let x = 4; x < 58; x++) if (p.get(x, y) !== 0) solid++;
    expect(solid).toBeLessThanOrEqual(4);
  });
});
