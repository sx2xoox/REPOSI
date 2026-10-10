// Stone lanterns (석등): the rocks that bombs used to crack for a reward are now
// lanterns a keeper lights with a match. One extra lantern per stage (a rock of one
// normal room, its own seeded streams), template lanterns ('t'), the reward odds,
// that nothing but a match lights them (no blast breaks or lights one), that the
// conversion never cuts a path, and that `lit` is simulation state.

import './headless';
import { describe, expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { RNG } from '../src/engine/rng';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Floors, RoomTemplates, lastFloorIndex } from '../src/game/defs';
import { generateStage, type FloorMap, type RoomNode } from '../src/game/dungeon';
import { Tile } from '../src/game/tiles';
import { TILE } from '../src/game/constants';
import { Chest, Pickup } from '../src/game/pickups';
import { StoneLantern, lanternReward, reachableFloor } from '../src/game/stone-lantern';
import { PRESS } from '../src/game/seam';
import { stateHash } from '../src/game/statehash';
import type { Room } from '../src/game/room';

loadContent();

const DT = 1 / 60;
const FLOORS = Floors.all().filter((f) => f.index <= lastFloorIndex());

function world(seed = 'LANTERN', character = 'ria'): World {
  const run = new RunState(seed, character);
  run.staged = true;
  const w = new World(new Renderer(fakeDisplay(1280, 720)), run, { openInventory() {}, onGameOver() {} });
  w.start();
  for (const p of w.players) p.god = true;
  return w;
}

function press(w: World, bits: number): void {
  w.inputSource = (_w, _p, out) => { out.pressed = bits; };
  w.update(DT);
  w.inputSource = (_w, _p, out) => { out.pressed = 0; };
}

type Builder = { buildRoom(node: RoomNode, floor: unknown, map: FloorMap): Room };
const build = (w: World, node: RoomNode, map: FloorMap): Room => (w as unknown as Builder).buildRoom(node, map.floor, map);

/** Enter the room holding this stage's lantern (cleared) and return its StoneLantern. */
function enterLanternRoom(w: World): { lantern: StoneLantern; node: RoomNode } {
  for (let stage = 1; stage <= 3; stage++) {
    w.run.stage = stage;
    w.startFloor(1);
    const node = w.map.nodes.find((n) => n.lantern);
    if (!node) continue;
    node.cleared = true;
    w.enterRoom(node, null);
    w.update(DT);
    const lantern = w.entities.find((e): e is StoneLantern => e instanceof StoneLantern);
    if (lantern) return { lantern, node };
  }
  throw new Error('no stage lantern');
}

/** Put every keeper on the floor just below the lantern. */
function standBy(w: World, l: StoneLantern): void {
  const spot = w.room.nearestFree(l.x, l.y + TILE, 6);
  for (const p of w.players) {
    p.x = spot.x;
    p.y = spot.y;
    p.vx = p.vy = 0;
  }
  w.update(DT);
}

describe('stage lantern placement', () => {
  it('one normal room per stage, never start / exit / special; deterministic; next to the start on 1-1 when it can', () => {
    let firstNear = 0;
    let firstTotal = 0;
    for (const floor of FLOORS) {
      for (let stage = 1; stage <= 3; stage++) {
        for (let s = 0; s < 12; s++) {
          const key = `LANT-${floor.index}-${stage}-${s}`;
          const map = generateStage(floor, stage, new RNG(key));
          const again = generateStage(floor, stage, new RNG(key));
          const marked = map.nodes.filter((n) => n.lantern);
          expect(marked.map((n) => n.id)).toEqual(again.nodes.filter((n) => n.lantern).map((n) => n.id));
          const normals = map.nodes.filter((n) => n.kind === 'normal' && n.id !== map.startId);
          expect(marked.length, key).toBe(normals.length > 1 ? 1 : marked.length);
          expect(marked.length).toBeLessThanOrEqual(1);
          for (const n of marked) {
            expect(n.kind, key).toBe('normal');
            expect(n.id).not.toBe(map.startId);
            expect(n.id).not.toBe(map.exitId);
          }
          if (floor.index === 1 && stage === 1) {
            // the boss cell is never next to the start (depth >= 2), so a normal neighbour always qualifies
            const near = new Set(map.nodes[map.startId].doors.filter((d) => !d.secret).map((d) => d.to));
            if (normals.some((n) => near.has(n.id))) {
              firstTotal++;
              if (marked[0] && near.has(marked[0].id)) firstNear++;
            }
          }
        }
      }
    }
    expect(firstTotal).toBeGreaterThan(0);
    expect(firstNear).toBe(firstTotal);
  });

  it('the conversion never cuts a path: same reachable floor (less the lantern tile), the same tile on every build', () => {
    const w = world('LANT-BUILD');
    let converted = 0;
    for (const floor of FLOORS) {
      for (let s = 0; s < 24; s++) {
        const stage = 1 + (s % 3);
        const map = generateStage(floor, stage, new RNG(`LANT-B-${floor.index}-${s}`));
        const node = map.nodes.find((n) => n.lantern);
        if (!node) continue;
        node.lantern = false;
        const plain = build(w, node, map);
        node.lantern = true;
        const lit = build(w, node, map);
        const twice = build(w, node, map);
        expect(Array.from(twice.tiles)).toEqual(Array.from(lit.tiles));
        const diff: number[] = [];
        for (let i = 0; i < plain.tiles.length; i++) if (plain.tiles[i] !== lit.tiles[i]) diff.push(i);
        if (plain.tiles.includes(Tile.STONE_LANTERN)) {
          // a template lantern already stands here: no second one
          expect(diff).toEqual([]);
          continue;
        }
        // the marked room always gets its lantern
        expect(diff.length, `${floor.index}/${node.templateId}`).toBe(1);
        converted++;
        const i = diff[0];
        const was = plain.tiles[i];
        expect([Tile.ROCK, Tile.SKULL_ROCK, Tile.FLOOR]).toContain(was);
        expect(lit.tiles[i]).toBe(Tile.STONE_LANTERN);
        const before = reachableFloor(plain);
        const after = reachableFloor(lit);
        for (let j = 0; j < before.length; j++) if (j !== i) expect(after[j], `${node.templateId} tile ${j}`).toBe(before[j]);
        // a keeper can stand next to it
        const tx = i % lit.w;
        const ty = (i - tx) / lit.w;
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => after[(ty + dy) * lit.w + tx + dx] === 1);
        expect(nb, node.templateId).toBe(true);
        // away from the doors
        for (const d of lit.doors) expect(Math.hypot(d.x - (tx + 0.5) * TILE, d.y - (ty + 0.5) * TILE)).toBeGreaterThanOrEqual(48);
      }
    }
    expect(converted).toBeGreaterThan(100);
  });

  it('every template lantern can be reached and lit on foot', () => {
    for (const t of RoomTemplates.all()) {
      if (!t.rows.some((r) => r.includes('t'))) continue;
      const w = t.rows[0].length;
      const h = t.rows.length;
      const at = (x: number, y: number) => t.rows[y]?.[x] ?? '#';
      const walk = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && !'#XOptsf^'.includes(at(x, y));
      // flood from the top-centre door entrance
      const seen = new Set<string>();
      const q: [number, number][] = [[Math.floor(17 / 2), 0]];
      seen.add(q[0].join());
      while (q.length) {
        const [x, y] = q.pop()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = `${x + dx},${y + dy}`;
          if (!seen.has(k) && walk(x + dx, y + dy)) { seen.add(k); q.push([x + dx, y + dy]); }
        }
      }
      t.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          if (row[x] !== 't') continue;
          const ok = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has(`${x + dx},${y + dy}`));
          expect(ok, `${t.id}: lantern at ${x},${y}`).toBe(true);
        }
      });
    }
  });
});

describe('lighting a stone lantern', () => {
  it('rewards keep the old odds (40 / 25 / 20 / 15 %)', () => {
    const rng = new RNG('lantern-odds');
    const n = 4000;
    const count = { coins: 0, blue_flame: 0, matches: 0, chest: 0 };
    for (let i = 0; i < n; i++) count[lanternReward(rng.next())]++;
    expect(Math.abs(count.coins / n - 0.4)).toBeLessThan(0.03);
    expect(Math.abs(count.blue_flame / n - 0.25)).toBeLessThan(0.03);
    expect(Math.abs(count.matches / n - 0.2)).toBeLessThan(0.03);
    expect(Math.abs(count.chest / n - 0.15)).toBeLessThan(0.03);
  });

  it('only interact with a match lights it: one match, a reward out of its window, lit for good', () => {
    const w = world('LANT-LIGHT');
    const { lantern, node } = enterLanternRoom(w);
    const p = w.player;
    expect(w.room.tileAt(lantern.tx, lantern.ty)).toBe(Tile.STONE_LANTERN);
    standBy(w, lantern);
    expect(w.focus).toBe(lantern);
    // no match: refused, nothing happens
    p.matches = 0;
    const card = lantern.interactionInfo(w);
    expect(card.name).toBe('꺼진 석등');
    expect(card.actionLabel).toBe('불 붙이기');
    // silent: no preview card or key prompt (user 2026-10-10: players notice it themselves), G still lights it
    expect(card.silent).toBe(true);
    expect(card.available).toBe(false);
    expect(card.price?.ok).toBe(false);
    press(w, PRESS.interact);
    expect(lantern.lit).toBe(false);
    p.matches = 2;
    const before = new Set(w.entities);
    press(w, PRESS.interact);
    expect(lantern.lit).toBe(true);
    expect(p.matches).toBe(1);
    expect(w.run.stats.matchesUsed).toBe(1);
    for (let i = 0; i < 5; i++) w.update(DT);
    const fresh = w.entities.filter((e) => !before.has(e) && (e instanceof Pickup || e instanceof Chest));
    expect(fresh.length).toBeGreaterThan(0);
    // every reward lies on open floor, never inside the lantern
    for (const e of fresh) expect(w.room.isFree(e.x, e.y, 3)).toBe(true);
    // lit: nothing more to strike; still lit after leaving and coming back
    expect(lantern.previewable()).toBe(false);
    expect(lantern.interact(w)).toBe(false);
    const back = w.map.nodes[w.map.startId];
    w.enterRoom(back, null);
    w.enterRoom(node, null);
    w.update(DT);
    const again = w.entities.filter((e): e is StoneLantern => e instanceof StoneLantern);
    expect(again).toContain(lantern);
    expect(lantern.lit).toBe(true);
  });

  it('explosions neither break nor light it; a lit lantern is part of the state hash', () => {
    const w = world('LANT-BLAST');
    const { lantern } = enterLanternRoom(w);
    const p = w.player;
    p.flags.add('blastImmune');
    w.asPlayer(p, () => w.explode(lantern.x, lantern.y, 40, 30, { byPlayer: true }));
    w.explode(lantern.x, lantern.y, 40, 30, { byPlayer: false, hurtsPlayer: false });
    w.update(DT);
    expect(w.room.tileAt(lantern.tx, lantern.ty)).toBe(Tile.STONE_LANTERN);
    expect(lantern.lit).toBe(false);
    expect(lantern.dead).toBe(false);
    const h = stateHash(w);
    lantern.lit = true;
    expect(stateHash(w)).not.toBe(h);
  });
});
