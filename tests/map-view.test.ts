// 등불 성좌도 map view: the pure snapshot (rooms, threads, counts, legend),
// its cache signature, the board / minimap layouts, and that building and
// painting the map never touches the simulation.
import './headless';
import { describe, expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { loadContent } from '../src/content';
import { Renderer, UI_H } from '../src/engine/renderer';
import { fitViewport, VIEW_H } from '../src/engine/renderer';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Floors } from '../src/game/defs';
import { RNG } from '../src/engine/rng';
import { generateFloor, generateStage, type FloorMap, type RoomNode } from '../src/game/dungeon';
import { MAP_H, MAP_W } from '../src/game/constants';
import { clearInput } from '../src/game/seam';
import { stateHash } from '../src/game/statehash';
import { revealFloorMap } from '../src/content/items/actives';
import {
  boardLayout, buildMapView, keeperCell, knownBounds, legendLayout, mapPanelRect, mapSignature, miniCamTarget, nodeKnown,
  type LegendRow, type MapSource,
} from '../src/ui/map-view';
import { BOARD_IN_H, BOARD_IN_W, MINI_LAYOUT, MINI_PLATE, MINI_SIZE, paintRooms } from '../src/ui/map-art';
import { lookFor } from '../src/ui/map-look';
import { MinimapView } from '../src/ui/minimap';
import { computeTouchLayout, type Insets } from '../src/ui/touch-logic';

loadContent();
const renderer = new Renderer(fakeDisplay(1280, 720));

function world(seed = 'MAP-VIEW', floor = 1, stage = 1): World {
  const run = new RunState(seed, 'ria');
  Object.assign(run, { staged: true, floor, stage });
  const w = new World(renderer, run, { openInventory() {}, onGameOver() {} });
  w.start();
  w.inputSource = (_w, _p, out) => { clearInput(out); };
  w.player.god = true;
  return w;
}

/** A stub source over a generated map (no World needed). */
function stub(map: FloorMap, opts: { stage?: number; staged?: boolean; flags?: string[] } = {}): MapSource & { flags: Set<string> } {
  const node = map.nodes[map.startId];
  node.visited = true;
  node.cleared = true;
  return {
    map,
    node,
    flags: new Set(opts.flags ?? []),
    players: [{ slot: 0, downed: false }],
    local: { slot: 0, x: 200, y: 120 },
    run: { staged: opts.staged ?? true, floor: map.floor.index, stage: opts.stage ?? 1, seed: 'STUB' },
    room: { pxW: 400, pxH: 240 },
  };
}

/** A stage map with a secret room (searching seeds). */
function secretMap(): FloorMap {
  const f = Floors.all()[0];
  for (let i = 0; i < 400; i++) {
    const m = generateStage(f, 1 + (i % 3), new RNG(`SECRET-${i}`));
    if (m.nodes.some((n) => n.kind === 'secret')) return m;
  }
  throw new Error('no secret room found');
}

const doorsInto = (map: FloorMap, id: number) => map.nodes.flatMap((n) => n.doors.filter((d) => d.to === id));
const strip = (nodes: RoomNode[]) => JSON.stringify(nodes, (k, v) => (k === 'saved' ? undefined : v));

describe('buildMapView', () => {
  it('keeps secret rooms hidden until a door is revealed, the room is visited or the map is revealed', () => {
    const map = secretMap();
    const src = stub(map);
    const sec = map.nodes.find((n) => n.kind === 'secret')!;
    sec.discovered = true;
    const has = () => buildMapView(src).nodes.some((n) => n.id === sec.id);
    expect(has()).toBe(false);
    for (const d of doorsInto(map, sec.id)) (d as { revealed?: boolean }).revealed = true;
    expect(has()).toBe(true);
    for (const d of doorsInto(map, sec.id)) (d as { revealed?: boolean }).revealed = false;
    expect(has()).toBe(false);
    src.flags.add('mapRevealSecret');
    expect(has()).toBe(true);
    src.flags.delete('mapRevealSecret');
    sec.visited = true;
    expect(has()).toBe(true);
    // a hidden secret door shows no thread before it is revealed or walked
    sec.visited = false;
    sec.discovered = true;
    src.flags.add('mapRevealSecret');
    const v = buildMapView(src);
    expect(v.doors.filter((d) => d.a === sec.id || d.b === sec.id)).toHaveLength(0);
  });

  it('marks the exit on exitId only (x-1 / x-2) and the defeated boss', () => {
    const f = Floors.all()[1];
    for (const stage of [1, 2, 3]) {
      const map = generateStage(f, stage, new RNG(`EXIT-${stage}`));
      const src = stub(map, { stage });
      const v = buildMapView(src);
      const exits = v.nodes.filter((n) => n.exit).map((n) => n.id);
      expect(exits).toEqual(stage < 3 ? [map.exitId] : []);
      if (stage === 3) {
        const boss = map.nodes[map.bossId];
        boss.discovered = true;
        expect(buildMapView(src).nodes.find((n) => n.id === boss.id)!.bossDone).toBe(false);
        // no way down until the boss falls
        expect(v.states).not.toContain('exit');
        expect(v.legend.some((l) => l.key === 'exit')).toBe(false);
        boss.cleared = true;
        const done = buildMapView(src);
        expect(done.nodes.find((n) => n.id === boss.id)!.bossDone).toBe(true);
        expect(done.legend.some((l) => l.key === 'boss')).toBe(true);
        // the defeated boss's trapdoor is the floor's exit: the legend explains its glyph
        expect(done.states.includes('exit') || done.legend.some((l) => l.key === 'exit')).toBe(true);
      } else {
        // no boss on x-1 / x-2: no boss row in the legend
        expect(v.legend.some((l) => l.key === 'boss')).toBe(false);
      }
    }
  });

  it('counts rooms exactly like the old map, and states read visited / uncleared / seen', () => {
    const map = generateStage(Floors.all()[2], 3, new RNG('COUNTS'));
    const src = stub(map, { stage: 3 });
    const others = map.nodes.filter((n) => n.id !== map.startId);
    others[0].visited = true;
    others[0].cleared = true;
    others[1].visited = true;
    others[1].discovered = true;
    others[0].discovered = true;
    const v = buildMapView(src);
    expect(v.counts.visited).toBe(map.nodes.filter((n) => n.visited).length);
    expect(v.counts.total).toBe(map.nodes.filter((n) => n.kind !== 'secret').length);
    expect(v.counts.cleared).toBe(map.nodes.filter((n) => n.cleared && n.visited).length);
    expect(v.nodes.find((n) => n.id === map.startId)!.state).toBe('current');
    expect(v.nodes.find((n) => n.id === others[0].id)!.state).toBe('visited');
    expect(v.nodes.find((n) => n.id === others[1].id)!.state).toBe('uncleared');
    expect(v.states).toContain('uncleared');
    for (const n of v.nodes) if (n.state === 'seen') expect(map.nodes[n.id].visited).toBe(false);
  });

  it('clamps the keeper cell into the current room', () => {
    const map = generateStage(Floors.all()[0], 1, new RNG('CELL'));
    const src = stub(map);
    const n = src.node;
    src.local.x = -50;
    src.local.y = -50;
    expect(keeperCell(src)).toEqual({ cx: n.gx, cy: n.gy });
    src.local.x = 99999;
    src.local.y = 99999;
    expect(keeperCell(src)).toEqual({ cx: n.gx + n.cw - 1, cy: n.gy + n.ch - 1 });
  });
});

describe('purity', () => {
  it('building the view, painting both LODs and drawing the minimap leave the world untouched', () => {
    const w = world('MAP-PURE', 2, 1);
    for (let i = 0; i < 30; i++) w.update(1 / 60);
    const other = w.map.nodes.find((n) => n.visited === false && n.discovered)!;
    w.teleportTo(other);
    for (let i = 0; i < 40; i++) w.update(1 / 60);
    const before = strip(w.map.nodes);
    const hash = stateHash(w);
    const src = w as unknown as MapSource;
    const v = buildMapView(src);
    const look = lookFor(v.themeId);
    paintRooms(v, look, boardLayout(v.bounds, BOARD_IN_W - 12, BOARD_IN_H - 12, { x: 6, y: 6 }), 'board');
    paintRooms(v, look, MINI_LAYOUT, 'mini', { w: MINI_SIZE, h: MINI_SIZE });
    mapSignature(src);
    const mm = new MinimapView();
    mm.update(w, 1 / 60);
    mm.draw(renderer, w, 600, 8, 124, 86, 0.5, 1, false);
    mm.drawLive(renderer, w, 600, 8, 124, 86, 0.6, 1);
    mm.signature(w);
    expect(strip(w.map.nodes)).toBe(before);
    expect(stateHash(w)).toBe(hash);
  });
});

describe('mapSignature', () => {
  it('changes with every map fact the cached layers show, not with movement or time', () => {
    const w = world('MAP-SIG', 1, 1);
    const sig = () => mapSignature(w as unknown as MapSource);
    let s = sig();
    // movement and time
    w.player.x += 40;
    w.player.y += 20;
    for (let i = 0; i < 20; i++) w.update(1 / 60);
    expect(sig()).toBe(s);
    // current room change (+ visit / discover)
    const next = w.map.nodes.find((n) => n.discovered && !n.visited)!;
    w.teleportTo(next);
    expect(sig()).not.toBe(s);
    s = sig();
    // clear
    const was = w.node.cleared;
    w.node.cleared = !was;
    expect(sig()).not.toBe(s);
    w.node.cleared = was;
    expect(sig()).toBe(s);
    // discover
    const hidden = w.map.nodes.find((n) => !n.discovered);
    if (hidden) {
      hidden.discovered = true;
      expect(sig()).not.toBe(s);
      hidden.discovered = false;
    }
    // a revealed door
    const d = w.map.nodes[0].doors[0];
    (d as { revealed?: boolean }).revealed = true;
    expect(sig()).not.toBe(s);
    (d as { revealed?: boolean }).revealed = undefined;
    expect(sig()).toBe(s);
    // the reveal flag
    w.flags.add('mapRevealSecret');
    expect(sig()).not.toBe(s);
    w.flags.delete('mapRevealSecret');
    expect(sig()).toBe(s);
    // the map item / potion (revealFloorMap)
    revealFloorMap(w);
    expect(sig()).not.toBe(s);
  });

  it('turns a seen room into a visited and then a cleared one with three different signatures', () => {
    const map = generateStage(Floors.all()[0], 2, new RNG('SIG-STEPS'));
    const src = stub(map);
    const n = map.nodes.find((x) => x.id !== map.startId)!;
    const seen = new Set<number>();
    n.discovered = true;
    seen.add(mapSignature(src));
    n.visited = true;
    seen.add(mapSignature(src));
    n.cleared = true;
    seen.add(mapSignature(src));
    expect(seen.size).toBe(3);
  });
});

describe('layout', () => {
  it('fits every span 1..13 into the 200x138 art board with a 9..24 cell', () => {
    for (let sw = 1; sw <= MAP_W; sw++) for (let sh = 1; sh <= MAP_H; sh++) {
      const b = { x0: 0, y0: 0, x1: sw, y1: sh };
      const L = boardLayout(b, 200, 138, { x: 6, y: 6 });
      expect(L.cell).toBeGreaterThanOrEqual(9);
      expect(L.cell).toBeLessThanOrEqual(24);
      expect(sw * L.cell).toBeLessThanOrEqual(200);
      expect(sh * L.cell).toBeLessThanOrEqual(138);
      expect(L.ox).toBeGreaterThanOrEqual(6);
      expect(L.oy).toBeGreaterThanOrEqual(6);
      expect(L.ox + sw * L.cell).toBeLessThanOrEqual(206);
      expect(L.oy + sh * L.cell).toBeLessThanOrEqual(144);
      expect(Number.isInteger(L.ox) && Number.isInteger(L.oy)).toBe(true);
      const plate = L.cell - L.gap;
      expect(L.sigil).toBe(plate >= 11 ? 7 : 5);
    }
  });

  it('uses 5x5 sigils below 11 px plates', () => {
    const L = boardLayout({ x0: 0, y0: 0, x1: 13, y1: 13 }, 200, 138);
    expect(L.cell - L.gap).toBeLessThan(11);
    expect(L.sigil).toBe(5);
    expect(boardLayout({ x0: 0, y0: 0, x1: 4, y1: 4 }, 200, 138).sigil).toBe(7);
  });

  it('keeps the map panel inside 768x432 and clear of the touch back button on phones and tablets', () => {
    const views: { w: number; h: number; safe: Insets }[] = [
      { w: 915, h: 412, safe: { l: 0, r: 0, t: 0, b: 0 } },
      { w: 844, h: 390, safe: { l: 47, r: 47, t: 0, b: 21 } },
      { w: 932, h: 430, safe: { l: 59, r: 59, t: 0, b: 21 } },
      { w: 667, h: 375, safe: { l: 0, r: 0, t: 0, b: 0 } },
      { w: 1024, h: 768, safe: { l: 0, r: 0, t: 0, b: 0 } },
      { w: 1280, h: 720, safe: { l: 0, r: 0, t: 0, b: 0 } },
    ];
    for (const v of views) {
      const f = fitViewport(v.w, v.h);
      const p = mapPanelRect(f.uiW);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w).toBeLessThanOrEqual(f.uiW);
      expect(p.y + p.h).toBeLessThanOrEqual(UI_H);
      const game = { x: f.offsetX, y: f.offsetY, w: f.viewW * f.scale, h: VIEW_H * f.scale };
      const mm = { x: f.uiOffsetX + (f.uiW - 132) * f.uiScale, y: f.uiOffsetY + 8 * f.uiScale, w: 124 * f.uiScale, h: 116 * f.uiScale };
      const L = computeTouchLayout({ w: v.w, h: v.h }, v.safe, { game, minimap: mm });
      // panel in CSS px vs the back button circle
      const px0 = f.uiOffsetX + p.x * f.uiScale;
      const px1 = f.uiOffsetX + (p.x + p.w) * f.uiScale;
      const py0 = f.uiOffsetY + p.y * f.uiScale;
      const py1 = f.uiOffsetY + (p.y + p.h) * f.uiScale;
      const cx = Math.max(px0, Math.min(px1, L.back.x));
      const cy = Math.max(py0, Math.min(py1, L.back.y));
      expect(Math.hypot(L.back.x - cx, L.back.y - cy)).toBeGreaterThan(L.back.r);
    }
  });
});

describe('miniCamTarget', () => {
  const view = MINI_PLATE.view;
  const cell = MINI_LAYOUT.cell;
  const visible = (t: { x: number; y: number }, n: { gx: number; gy: number; cw: number; ch: number }) => {
    const hw = view.w / cell / 2;
    const hh = view.h / cell / 2;
    return n.gx >= t.x - hw - 1e-9 && n.gx + n.cw <= t.x + hw + 1e-9 && n.gy >= t.y - hh - 1e-9 && n.gy + n.ch <= t.y + hh + 1e-9;
  };
  it('centres bounds that fit the window', () => {
    const b = { x0: 4, y0: 5, x1: 8, y1: 8 };
    const t = miniCamTarget(b, { gx: 5, gy: 6, cw: 1, ch: 1 }, view.w, view.h, cell);
    expect(t).toEqual({ x: 6, y: 6.5 });
  });
  it('follows the current room, clamped near the bounds, always showing it fully', () => {
    const b = { x0: 0, y0: 0, x1: 13, y1: 13 };
    for (let gy = 0; gy < 13; gy++) for (let gx = 0; gx < 13; gx++) {
      for (const [cw, ch] of [[1, 1], [2, 1], [1, 2]] as const) {
        if (gx + cw > 13 || gy + ch > 13) continue;
        const n = { gx, gy, cw, ch };
        const t = miniCamTarget(b, n, view.w, view.h, cell);
        expect(visible(t, n)).toBe(true);
        expect(t.x - view.w / cell / 2).toBeGreaterThanOrEqual(-0.3 - 1e-9);
        expect(t.x + view.w / cell / 2).toBeLessThanOrEqual(13.3 + 1e-9);
      }
    }
  });
});

describe('legendLayout', () => {
  const row = (i: number): LegendRow => ({ key: 'shop', label: `r${i}`, found: true });
  it('uses two columns past nine rows', () => {
    expect(legendLayout(Array.from({ length: 9 }, (_, i) => row(i))).cols).toBe(1);
    const two = legendLayout(Array.from({ length: 12 }, (_, i) => row(i)));
    expect(two.cols).toBe(2);
    expect(two.perCol).toBe(6);
  });
  it('hides the boss row when the map has no boss (bossId -1)', () => {
    const map = generateStage(Floors.all()[0], 1, new RNG('LEGEND'));
    expect(map.bossId).toBe(-1);
    expect(buildMapView(stub(map)).legend.some((l) => l.key === 'boss')).toBe(false);
    const legacy = generateFloor(Floors.all()[3], new RNG('LEGACY'));
    expect(buildMapView(stub(legacy, { staged: false })).legend.some((l) => l.key === 'boss')).toBe(true);
    // treasure and shop are always listed
    const keys = buildMapView(stub(map)).legend.map((l) => l.key);
    expect(keys).toContain('treasure');
    expect(keys).toContain('shop');
  });
});

describe('knownBounds / nodeKnown', () => {
  it('cover the known rooms only', () => {
    const map = generateStage(Floors.all()[0], 1, new RNG('BOUNDS'));
    const src = stub(map);
    const b = knownBounds(src);
    for (const n of map.nodes) if (nodeKnown(src, n)) {
      expect(n.gx).toBeGreaterThanOrEqual(b.x0);
      expect(n.gx + n.cw).toBeLessThanOrEqual(b.x1);
    }
  });
});
