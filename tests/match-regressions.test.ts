// Regressions found reviewing the bombs → matches change (2026-10-10): what an
// old save carries beyond its purse and item ids, and the edges of the match
// economy (co-op purse, zero matches, the cap, lockdowns, the active swap).

import './headless';
import { describe, expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { captureCheckpoint, restoreCheckpoint, type Checkpoint } from '../src/game/checkpoint';
import { migrateCheckpoint, normalizeVarKey } from '../src/game/legacy-ids';
import { blessingChoices, blessingFloor } from '../src/game/blessings';
import { ColdSconce } from '../src/game/cold-sconce';
import { SealLamp } from '../src/game/seal-lamp';
import { Pickup } from '../src/game/pickups';
import { EMBER_MAX } from '../src/game/player';
import { PRESS } from '../src/game/seam';
import type { RoomNode } from '../src/game/dungeon';

loadContent();

const DT = 1 / 60;

function world(character = 'ria', seed = 'MATCH-REGRESS'): World {
  const run = new RunState(seed, character);
  run.staged = true;
  const w = new World(new Renderer(fakeDisplay(1280, 720)), run, { openInventory() {}, onGameOver() {} });
  w.start();
  for (const p of w.players) p.god = true;
  return w;
}

describe('old saves: vars keyed by a renamed item id', () => {
  it("a pending blessing offer naming 화약 주머니 resumes with 성냥 주머니 among its three choices", () => {
    const w = world('ria', 'OLD-OFFER');
    const c = captureCheckpoint(w);
    // the floor-1 offer of a save from before matches: bless_powder first, two others after it
    const serial = 1;
    const old = {
      ...c,
      vars: {
        __blessOfferFloor: 1, __blessOfferSerial: serial,
        '__blessOffer:bless_powder': serial, '__blessOrder:bless_powder': 0, '__blessSeen:bless_powder': serial,
        '__blessOffer:bless_soul': serial, '__blessOrder:bless_soul': 1, '__blessSeen:bless_soul': serial,
        '__blessOffer:bless_hearth': serial, '__blessOrder:bless_hearth': 2, '__blessSeen:bless_hearth': serial,
      },
    } as Checkpoint;
    const w2 = world('ria', 'OLD-OFFER');
    restoreCheckpoint(w2, old);
    expect(blessingChoices(w2)).toEqual(['bless_match_pouch', 'bless_soul', 'bless_hearth']);
  });

  it("the Tab screen still knows on which floor a renamed blessing was taken", () => {
    const w = world('ria', 'OLD-BLESSED-AT');
    const c = captureCheckpoint(w);
    const old = { ...c, items: [...c.items, 'bless_powder'], vars: { ...c.vars, 'blessedAt:bless_powder': 3, __grant_bless_powder: 1 } } as Checkpoint;
    restoreCheckpoint(w, old);
    expect(blessingFloor(w, 'bless_match_pouch')).toBe(3);
    // the 3 matches of the renamed pouch were paid in the old save: not paid again
    expect(w.player.matches).toBe(c.purse.matches);
    w.update(DT);
    expect(w.player.matches).toBe(c.purse.matches);
  });

  it('var keys: explicit renames, id suffixes, untouched keys; idempotent', () => {
    expect(normalizeVarKey('__bloodOathFloor')).toBe('__lastStandFloor');
    expect(normalizeVarKey('__grant_tick_bomb')).toBeNull();
    expect(normalizeVarKey('__blessSeen:bless_powder')).toBe('__blessSeen:bless_match_pouch');
    expect(normalizeVarKey('blessedAt:bless_soul')).toBe('blessedAt:bless_soul');
    expect(normalizeVarKey('__hearthN')).toBe('__hearthN');
    const c = { items: [], obtained: [], seen: [], vars: { 'blessedAt:bless_powder': 2, 'blessedAt:bless_match_pouch': 9 }, purse: { coins: 0, matches: 1 } } as unknown as Checkpoint;
    const m = migrateCheckpoint(structuredClone(c));
    // the renamed (old) entry wins over a stale copy under the new name
    expect(m.vars).toEqual({ 'blessedAt:bless_match_pouch': 2 });
    expect(migrateCheckpoint(structuredClone(m))).toEqual(m);
  });
});

function party(seed: string): World {
  const run = new RunState(seed, 'ria');
  run.staged = true;
  const w = new World(new Renderer(fakeDisplay(1280, 720)), run, { openInventory() {}, onGameOver() {} });
  w.startParty([{ slot: 0, characterId: 'ria', name: 'P1' }, { slot: 1, characterId: 'bern', name: 'P2' }], 0);
  for (const p of w.players) p.god = true;
  return w;
}

/** Only slot 1 presses `bits` this step. */
function pressP2(w: World, bits: number): void {
  w.inputSource = (_w, p, out) => { out.pressed = p.slot === 1 ? bits : 0; };
  w.update(DT);
  w.inputSource = (_w, _p, out) => { out.pressed = 0; };
}

/** A cleared plain room of `floor` next to a room matching `want`, entered (stage 1..3, then seeds). */
function nextTo(tag: string, floor: number, want: (n: RoomNode, w: World) => boolean): { w: World; room: RoomNode } {
  for (let s = 0; s < 60; s++) {
    const w = party(`${tag}-${s}`);
    for (let stage = 1; stage <= 3; stage++) {
      w.run.stage = stage;
      w.startFloor(floor);
      const room = w.map.nodes.find((n) => (n.kind === 'normal' || n.kind === 'start') && !n.locked && n.doors.some((d) => want(w.map.nodes[d.to], w)));
      if (!room) continue;
      room.cleared = true;
      w.enterRoom(room, null);
      w.update(DT);
      return { w, room };
    }
  }
  throw new Error('no such room');
}

describe('co-op: the shared purse and a teammate\'s lantern', () => {
  it("the second keeper's release lights a cold sconce; nobody pays a match", () => {
    const { w } = nextTo('COOP-SCONCE', 1, (n) => n.kind === 'secret');
    const sconce = w.entities.find((e): e is ColdSconce => e instanceof ColdSconce && !e.lit)!;
    expect(sconce).toBeTruthy();
    const [p1, p2] = w.players;
    const far = w.room.nearestFree(w.room.centerX, w.room.centerY, p1.r);
    p1.x = far.x; p1.y = far.y;
    p2.x = sconce.x; p2.y = sconce.y;
    p2.ember = EMBER_MAX;
    p2.releaseCooldown = 0;
    const m = p1.purse.matches;
    pressP2(w, PRESS.release);
    expect(w.run.stats.releases).toBe(1);
    expect(sconce.lit).toBe(true);
    expect(sconce.door.state).toBe('open');
    expect(p1.purse.matches).toBe(m);
  });

  it("the second keeper picks a match into the shared purse and burns a seal with it", () => {
    const { w } = nextTo('COOP-SEAL', 2, (n) => n.locked);
    const lamp = w.entities.find((e): e is SealLamp => e instanceof SealLamp && !e.lit)!;
    expect(lamp).toBeTruthy();
    const [p1, p2] = w.players;
    expect(p2.purse).toBe(p1.purse);
    p1.purse.matches = 0;
    // a match lying at the second keeper's feet
    const far = w.room.nearestFree(w.room.centerX, w.room.centerY, p1.r);
    p1.x = far.x; p1.y = far.y;
    const spot = w.room.nearestFree(lamp.x, lamp.y, p2.r);
    p2.x = spot.x; p2.y = spot.y;
    const pk = new Pickup('match', p2.x, p2.y);
    pk.grace = 0;
    w.spawn(pk);
    for (let i = 0; i < 20 && !pk.dead; i++) w.update(DT);
    expect(pk.dead).toBe(true);
    expect(p1.matches).toBe(1);
    p2.x = spot.x; p2.y = spot.y;
    w.update(DT);
    pressP2(w, PRESS.interact);
    expect(lamp.lit).toBe(true);
    expect(lamp.door.state).toBe('open');
    expect(w.map.nodes[lamp.door.to].locked).toBe(false);
    expect(p1.matches).toBe(0);
    expect(p2.matches).toBe(0);
    expect(w.run.stats.matchesUsed).toBe(1);
  });
});
