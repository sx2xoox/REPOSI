// 등불 성좌도 robustness: the map overlay and the HUD minimap on edge cases
// (empty / single-room maps, boss and last floors, legacy floors, co-op parties
// changing, stage changes, low quality), cache invalidation, and that drawing
// the HUD + map every step never changes the simulation (drawn vs undrawn).
import './headless';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { loadContent } from '../src/content';
import { Renderer } from '../src/engine/renderer';
import { save } from '../src/engine/save';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { FIXED_DT } from '../src/game/constants';
import { lastFloorIndex } from '../src/game/defs';
import { clearInput } from '../src/game/seam';
import { stateHash } from '../src/game/statehash';
import { slotColor } from '../src/game/coopfx';
import { revealFloorMap } from '../src/content/items/actives';
import { MapOverlay } from '../src/ui/map-overlay';
import { MinimapView, artCanvas } from '../src/ui/minimap';
import { paintPip } from '../src/ui/map-art';
import { Hud } from '../src/ui/hud';
import type { MapView } from '../src/ui/map-view';
import type { GameScene } from '../src/ui/game-scene';
import { botInput, newBot } from './detsim';
import { SpeedrunRun } from '../src/game/speedrun';

loadContent();
const renderer = new Renderer(fakeDisplay(1280, 720));
const quality = save.settings.graphicsQuality;
afterEach(() => {
  save.settings.graphicsQuality = quality;
});

function world(seed: string, floor = 1, stage = 1, staged = true): World {
  const run = new RunState(seed, 'ria');
  Object.assign(run, { staged, floor, stage });
  const w = new World(renderer, run, { openInventory() {}, onGameOver() {} });
  w.start();
  w.inputSource = (_w, _p, out) => { clearInput(out); };
  w.player.god = true;
  return w;
}

function party(seed: string, n: number): World {
  const run = new RunState(seed, 'ria');
  Object.assign(run, { staged: true, floor: 1, stage: 1 });
  const w = new World(renderer, run, { openInventory() {}, onGameOver() {} });
  w.startParty(Array.from({ length: n }, (_, i) => ({ slot: i, characterId: 'ria', name: `P${i}` })), 0, true);
  w.inputSource = (_w, _p, out) => { clearInput(out); };
  for (const p of w.players) p.god = true;
  return w;
}

/** Step the world until a room transition is over (descend() is refused while one runs). */
function settleTransition(w: World): void {
  for (let i = 0; i < 120 && w.transitioning; i++) w.update(FIXED_DT);
}

const scene = (w: World) => ({ world: w, closeOverlay() {} }) as unknown as GameScene;

type OverlayInternals = { t: number; closing: number; boardFor(): { view: MapView } };

/** Open the map on `w` and draw it through its opening, reveal, cached and closing frames. */
function drawOverlay(w: World): MapOverlay {
  const ov = new MapOverlay(scene(w));
  const o = ov as unknown as OverlayInternals;
  for (const t of [0, 0.05, 0.2, 0.45, 1, 2.5]) {
    o.t = t;
    ov.draw(renderer);
  }
  o.closing = 0.07;
  ov.draw(renderer);
  return ov;
}

/** Run the HUD (minimap included) for `frames` frames, drawing every frame. */
function drawHud(w: World, frames = 90, hud = new Hud()): Hud {
  for (let i = 0; i < frames; i++) {
    hud.update(w, FIXED_DT);
    hud.draw(renderer, w, 60);
  }
  return hud;
}

function bossDone(w: World): void {
  const boss = w.map.nodes[w.map.bossId];
  w.teleportTo(boss);
  for (const e of [...w.enemies]) w.killEnemy(e);
  boss.cleared = true;
}

describe('edge cases draw without throwing (high and low quality)', () => {
  const cases: [string, () => World][] = [
    ['run start', () => world('MAP-EDGE-1')],
    ['whole map revealed', () => {
      const w = world('MAP-EDGE-2', 2, 2);
      revealFloorMap(w);
      return w;
    }],
    ['boss floor, boss defeated', () => {
      const w = world('MAP-EDGE-3', 3, 3);
      bossDone(w);
      return w;
    }],
    ['last floor, boss defeated', () => {
      const w = world('MAP-EDGE-4', lastFloorIndex(), 3);
      bossDone(w);
      return w;
    }],
    ['legacy (unstaged) floor', () => world('MAP-EDGE-5', 4, 1, false)],
    ['no known room (current room undiscovered)', () => {
      const w = world('MAP-EDGE-6');
      for (const n of w.map.nodes) n.discovered = false;
      return w;
    }],
    ['a single-room map', () => {
      const w = world('MAP-EDGE-7');
      w.map = { ...w.map, nodes: [w.node], startId: w.node.id, bossId: -1, exitId: undefined };
      w.node.id = 0;
      return w;
    }],
    ['speedrun mode', () => {
      const w = world('MAP-EDGE-9');
      w.run.speedrun = new SpeedrunRun();
      for (let i = 0; i < 30; i++) w.update(FIXED_DT);
      return w;
    }],
    ['in a room transition', () => {
      const w = world('MAP-EDGE-10', 2, 1);
      w.teleportTo(w.map.nodes.find((n) => n.discovered && !n.visited)!);
      expect(w.transitioning).toBe(true);
      return w;
    }],
    ['victory (game over, won)', () => {
      const w = world('MAP-EDGE-11', lastFloorIndex(), 3);
      bossDone(w);
      w.victory();
      expect(w.gameOver?.won).toBe(true);
      return w;
    }],
    ['co-op, four keepers, one downed', () => {
      const w = party('MAP-EDGE-8', 4);
      w.players[2].downed = true;
      return w;
    }],
  ];
  for (const [name, make] of cases) {
    for (const q of ['high', 'low'] as const) {
      it(`${name} (${q})`, () => {
        save.settings.graphicsQuality = q;
        const w = make();
        const hash = stateHash(w);
        expect(() => drawOverlay(w)).not.toThrow();
        expect(() => drawHud(w, 40)).not.toThrow();
        expect(stateHash(w)).toBe(hash);
      });
    }
  }
});

describe('minimap cache invalidation', () => {
  it('snaps to the new map on a stage change (no cross-fade or entry streak from the old map)', () => {
    const w = world('MAP-STAGE', 1, 1);
    const mm = new MinimapView();
    for (let i = 0; i < 120; i++) mm.update(w, FIXED_DT);
    expect(mm.settled).toBe(true);
    // walk to another room, then take the stage passage from the start room
    const other = w.map.nodes.find((n) => n.discovered && !n.visited)!;
    w.teleportTo(other);
    for (let i = 0; i < 120; i++) mm.update(w, FIXED_DT);
    w.teleportTo(w.map.nodes[w.map.startId]);
    settleTransition(w);
    for (let i = 0; i < 120; i++) mm.update(w, FIXED_DT);
    expect(mm.settled).toBe(true);
    const oldMap = w.map;
    w.descend();
    expect(w.map).not.toBe(oldMap);
    expect(w.run.stage).toBe(2);
    mm.update(w, FIXED_DT);
    const m = mm as unknown as { prev: unknown; fromId: number };
    expect(m.prev).toBeNull();
    expect(m.fromId).toBe(-1);
    expect(mm.settled).toBe(true);
  });

  it('low quality bakes the flame but never the teammate pips (they change without a map change)', () => {
    save.settings.graphicsQuality = 'low';
    const w = party('MAP-PIPS', 2);
    const mm = new MinimapView();
    for (let i = 0; i < 60; i++) mm.update(w, FIXED_DT);
    const pips = new Set([0, 1].map((d) => artCanvas(`pip|${slotColor(1)}|${d}`, () => paintPip(slotColor(1), d === 1))));
    const d = renderer.dctx as unknown as { drawImage: (...a: unknown[]) => void };
    const orig = d.drawImage;
    let n = 0;
    d.drawImage = (...a: unknown[]) => {
      if (pips.has(a[0] as HTMLCanvasElement)) n++;
    };
    try {
      mm.draw(renderer, w, 600, 8, 124, 86, 0.1, 1, true);
      expect(n).toBe(0);
      mm.drawLive(renderer, w, 600, 8, 124, 86, 0.1, 1);
      expect(n).toBe(1);
      // the uncached path draws them once too
      n = 0;
      mm.draw(renderer, w, 600, 8, 124, 86, 0.1, 1, false);
      expect(n).toBe(1);
    } finally {
      d.drawImage = orig;
    }
  });

  it('draws each teammate pip exactly once per HUD frame, cached layer included (high and low quality)', () => {
    for (const q of ['high', 'low'] as const) {
      save.settings.graphicsQuality = q;
      const w = party(`MAP-BLINK-${q}`, 2);
      w.players[1].downed = true;
      const hud = drawHud(w, 120);
      expect(hud.minimap.settled).toBe(true);
      const pip = artCanvas(`pip|${slotColor(1)}|1`, () => paintPip(slotColor(1), true));
      const d = renderer.dctx as unknown as { drawImage: (...a: unknown[]) => void };
      const orig = d.drawImage;
      let n = 0;
      // count pips drawn into the HUD's cached minimap layer too (it paints through renderer.dctx swapped to its canvas)
      const layer = (hud as unknown as { lyMap: { invalidate(): void } }).lyMap;
      const count = (ctx: { drawImage: (...a: unknown[]) => void }) => {
        const o = ctx.drawImage;
        ctx.drawImage = (...a: unknown[]) => {
          if (a[0] === pip) n++;
          else o.apply(ctx, a);
        };
        return () => { ctx.drawImage = o; };
      };
      const undo = count(d);
      try {
        const h = hud as unknown as { t: number };
        // the downed pip blinks: shown at t = 0.1, hidden at t = 0.3
        layer.invalidate();
        h.t = 0.1;
        const lyCv = (layer as unknown as { g: { drawImage: (...a: unknown[]) => void } | null });
        const undoLayer = lyCv.g ? count(lyCv.g) : () => {};
        hud.draw(renderer, w, 60);
        undoLayer();
        expect(n).toBe(1);
        n = 0;
        h.t = 0.3;
        hud.draw(renderer, w, 60);
        expect(n).toBe(0);
      } finally {
        undo();
        d.drawImage = orig;
      }
    }
  });
});

describe('map overlay cache invalidation', () => {
  it('refreshes the party legend when a teammate leaves while the map is open', () => {
    const w = party('MAP-LEAVE', 3);
    const ov = new MapOverlay(scene(w)) as unknown as OverlayInternals;
    const v0 = ov.boardFor().view;
    expect(v0.party.map((q) => q.slot)).toEqual([1, 2]);
    expect(v0.legend.some((l) => l.key === 'party')).toBe(true);
    w.removePlayer(2);
    expect(ov.boardFor().view.party.map((q) => q.slot)).toEqual([1]);
    w.removePlayer(1);
    const v2 = ov.boardFor().view;
    expect(v2.party).toHaveLength(0);
    expect(v2.legend.some((l) => l.key === 'party')).toBe(false);
  });

  it('keeps drawing while the floor changes under it (co-op: the world runs under the map)', () => {
    const w = party('MAP-UNDER', 2);
    const ov = new MapOverlay(scene(w));
    const o = ov as unknown as OverlayInternals;
    o.t = 2;
    ov.draw(renderer);
    const k0 = (o.boardFor() as unknown as { key: string }).key;
    // stage passage, then the floor's last stage boss and down to the next floor
    settleTransition(w);
    w.descend();
    for (let i = 0; i < 5; i++) {
      w.update(FIXED_DT);
      ov.draw(renderer);
    }
    const k1 = (o.boardFor() as unknown as { key: string }).key;
    expect(k1).not.toBe(k0);
    w.run.stage = 3;
    settleTransition(w);
    w.descend();
    for (let i = 0; i < 5; i++) {
      w.update(FIXED_DT);
      ov.draw(renderer);
    }
    expect(w.run.floor).toBe(2);
    expect((o.boardFor() as unknown as { key: string }).key).not.toBe(k1);
    expect(o.boardFor().view.floorIndex).toBe(2);
  });

  it('rebuilds the board on room enter, clear, discovery, reveal and stage change; reuses it otherwise', () => {
    const w = world('MAP-OV-CACHE', 2, 1);
    const ov = new MapOverlay(scene(w)) as unknown as OverlayInternals;
    const key = () => (ov.boardFor() as unknown as { key: string }).key;
    let b = key();
    w.player.x += 30;
    for (let i = 0; i < 10; i++) w.update(FIXED_DT);
    expect(key()).toBe(b);
    const steps: (() => void)[] = [
      () => w.teleportTo(w.map.nodes.find((n) => n.discovered && !n.visited)!),
      () => { w.node.cleared = !w.node.cleared; },
      () => { w.map.nodes.find((n) => !n.discovered)!.discovered = true; },
      () => { revealFloorMap(w); },
      () => {
        settleTransition(w);
        w.teleportTo(w.map.nodes[w.map.startId]);
        settleTransition(w);
        const old = w.map;
        w.descend();
        expect(w.map).not.toBe(old);
      },
    ];
    for (const s of steps) {
      s();
      const nb = key();
      expect(nb).not.toBe(b);
      b = nb;
    }
  });
});

describe('canvas reuse and release', () => {
  /** Count canvases created while `fn` runs. */
  function canvasesMade(fn: () => void): number {
    const doc = document as unknown as { createElement: (tag: string) => unknown };
    const orig = doc.createElement;
    let n = 0;
    doc.createElement = (tag: string) => {
      if (tag === 'canvas') n++;
      return orig.call(document, tag);
    };
    try {
      fn();
    } finally {
      doc.createElement = orig;
    }
    return n;
  }

  it('the minimap repaints retired canvases instead of allocating two per map change', () => {
    const w = world('MAP-REUSE', 2, 1);
    const mm = new MinimapView();
    const frame = () => {
      mm.update(w, FIXED_DT);
      mm.draw(renderer, w, 600, 8, 124, 86, 0, 1, false);
    };
    const far = w.map.nodes.find((n) => n.id !== w.node.id)!;
    // warm-up: the first states allocate
    for (let i = 0; i < 3; i++) {
      far.discovered = !far.discovered;
      for (let f = 0; f < 30; f++) frame();
    }
    const made = canvasesMade(() => {
      for (let i = 0; i < 20; i++) {
        far.discovered = !far.discovered;
        for (let f = 0; f < 30; f++) frame();
      }
    });
    expect(made).toBe(0);
  });

  it('reopening the map with nothing changed reuses the board; another map object never does', () => {
    const w = world('MAP-REOPEN', 1, 2);
    const a = (new MapOverlay(scene(w)) as unknown as OverlayInternals).boardFor();
    const b = (new MapOverlay(scene(w)) as unknown as OverlayInternals).boardFor();
    expect(b).toBe(a);
    // same signature (same rooms known / visited / cleared, same current id) but the rooms sit elsewhere
    const moved = w.map.nodes.find((n) => n.id !== w.node.id && n.discovered)!;
    w.map = { ...w.map, nodes: w.map.nodes.map((n) => ({ ...n, doors: n.doors.map((d) => ({ ...d })), gx: n === moved ? n.gx + 1 : n.gx })) };
    const c = (new MapOverlay(scene(w)) as unknown as OverlayInternals).boardFor();
    expect(c.view.nodes.find((n) => n.id === moved.id)!.gx).toBe(moved.gx + 1);
  });

  it('closing the map frees its display-resolution layers', () => {
    const w = world('MAP-RELEASE');
    const ov = new MapOverlay(scene(w));
    const o = ov as unknown as OverlayInternals & { lyText: { paints: number }; lyBoard: { paints: number } };
    o.t = 2;
    ov.draw(renderer);
    ov.draw(renderer);
    expect(o.lyText.paints).toBe(1);
    expect(o.lyBoard.paints).toBe(1);
    ov.exit();
    for (const ly of [o.lyText, o.lyBoard]) expect((ly as unknown as { cv: unknown }).cv).toBeNull();
  });
});

describe('drawing the HUD and the map never changes the simulation', () => {
  it('per-step state hash is identical drawn (HUD + minimap + map, both qualities) and undrawn', () => {
    const run = (draw: boolean): number[] => {
      const r = new RunState('MAP-DRAWN', 'ria');
      Object.assign(r, { staged: true, floor: 1, stage: 1, seeded: true });
      const w = new World(renderer, r, { openInventory() {}, onGameOver() {} });
      const bot = newBot('MAP-DRAWN');
      w.inputSource = (ww, _p, out) => botInput(ww, bot, out);
      w.start();
      w.player.god = true;
      const hud = new Hud();
      const ov = new MapOverlay(scene(w));
      const hashes: number[] = [];
      for (let step = 0; step < 1500; step++) {
        // scripted world changes, identical in both runs
        if (step === 200 || step === 500) {
          const next = w.map.nodes.find((n) => n.discovered && !n.visited);
          if (next) w.teleportTo(next);
        }
        if (step === 300 || step === 650) for (const e of [...w.enemies]) w.killEnemy(e);
        if (step === 400) revealFloorMap(w);
        if (step === 800) w.teleportTo(w.map.nodes[w.map.startId]);
        if (step === 900 && !w.transitioning) w.descend();
        w.update(FIXED_DT);
        if (draw) {
          save.settings.graphicsQuality = step < 700 ? 'high' : 'low';
          hud.update(w, FIXED_DT);
          hud.draw(renderer, w, 60);
          (ov as unknown as OverlayInternals).t = (step % 90) / 60;
          if (step % 2 === 0) ov.draw(renderer);
        }
        hashes.push(stateHash(w));
      }
      return hashes;
    };
    const undrawn = run(false);
    const drawn = run(true);
    save.settings.graphicsQuality = quality;
    const k = undrawn.findIndex((h, i) => h !== drawn[i]);
    expect(k).toBe(-1);
  });
});
