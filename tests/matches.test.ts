// Matches (성냥) replace bombs and keys: the purse, its cap, the one spend path
// (spendMatch: thrift, run stat, onMatch), sealed doors (SealLamp) and sealed
// chests by interact only, co-op double presses, every keeper's starting
// matches, and old saves (purse, renamed item ids and vars, the seen list).

import './headless';
import { describe, expect, it, vi } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Characters } from '../src/game/defs';
import { Chest, Pickup } from '../src/game/pickups';
import { SealLamp } from '../src/game/seal-lamp';
import { MATCH_CAP, addMatches, matchDeniedAt, spendMatch } from '../src/game/matches';
import { LEGACY_ITEM_IDS, LEGACY_VARS, migrateCheckpoint, migratePurse, normalizeItemId } from '../src/game/legacy-ids';
import { captureCheckpoint, restoreCheckpoint, type Checkpoint } from '../src/game/checkpoint';
import { migrateProgress, save, type Progress } from '../src/engine/save';
import { HintSystem } from '../src/ui/hints';
import { PRESS } from '../src/game/seam';
import { stateHash } from '../src/game/statehash';
import type { RoomNode } from '../src/game/dungeon';

loadContent();

const DT = 1 / 60;

function world(character = 'ria', seed = 'MATCHES'): World {
  const run = new RunState(seed, character);
  run.staged = true;
  const w = new World(new Renderer(fakeDisplay(1280, 720)), run, { openInventory() {}, onGameOver() {} });
  w.start();
  for (const p of w.players) p.god = true;
  return w;
}

function party(chars: string[], seed = 'MATCHES-COOP'): World {
  const run = new RunState(seed, chars[0]);
  run.staged = true;
  const w = new World(new Renderer(fakeDisplay(1280, 720)), run, { openInventory() {}, onGameOver() {} });
  w.startParty(chars.map((characterId, slot) => ({ slot, characterId, name: `P${slot + 1}` })), 0);
  for (const p of w.players) p.god = true;
  return w;
}

function press(w: World, bits: number, who?: (slot: number) => boolean): void {
  w.inputSource = (_w, p, out) => { out.pressed = !who || who(p.slot) ? bits : 0; };
  w.update(DT);
  w.inputSource = (_w, _p, out) => { out.pressed = 0; };
}

/**
 * Floor 2 (sealed treasure / shop rooms): enter a cleared neighbour of a sealed
 * room (when this stage has none next to a plain room, one neighbour is sealed
 * by hand, as a treasure room would be); its lamp and door.
 */
function sealedDoor(w: World): { lamp: SealLamp; node: RoomNode } {
  w.startFloor(2);
  const plain = (n: RoomNode) => (n.kind === 'normal' || n.kind === 'start') && !n.locked;
  let node = w.map.nodes.find((n) => plain(n) && n.doors.some((d) => !d.secret && w.map.nodes[d.to].locked));
  if (!node) {
    node = w.map.nodes.find((n) => plain(n) && n.id !== w.node.id && n.doors.some((d) => !d.secret && w.map.nodes[d.to].kind !== 'boss'));
    if (!node) throw new Error('no plain room');
    w.map.nodes[node.doors.find((d) => !d.secret && w.map.nodes[d.to].kind !== 'boss')!.to].locked = true;
  }
  node.cleared = true;
  w.enterRoom(node, null);
  w.update(DT);
  const lamp = w.entities.find((e): e is SealLamp => e instanceof SealLamp);
  if (!lamp) throw new Error('no seal lamp');
  return { lamp, node };
}

function standAt(w: World, x: number, y: number): void {
  for (const p of w.players) {
    p.x = x;
    p.y = y;
    p.vx = p.vy = 0;
  }
}

describe('the purse', () => {
  it('holds coins and matches; matches stop at the cap and a full purse leaves match pickups lying', () => {
    const w = world();
    const p = w.player;
    expect(MATCH_CAP).toBe(9);
    p.matches = 8;
    expect(addMatches(w, 3)).toBe(1);
    expect(p.matches).toBe(9);
    expect(new Pickup('match', p.x, p.y).canCollect(w)).toBe(false);
    expect(new Pickup('matchbox', p.x, p.y).canCollect(w)).toBe(false);
    p.matches = 8;
    expect(new Pickup('match', p.x, p.y).canCollect(w)).toBe(true);
    // a matchbox fills up to the cap and no further
    const box = new Pickup('matchbox', p.x, p.y);
    box.grace = 0;
    w.spawn(box);
    for (let i = 0; i < 10 && !box.dead; i++) w.update(DT);
    expect(box.dead).toBe(true);
    expect(p.matches).toBe(9);
    // coins: 1 and 4
    const before = p.coins;
    w.collectPickup(new Pickup('coin', p.x, p.y));
    w.collectPickup(new Pickup('coin_string', p.x, p.y));
    expect(p.coins - before).toBe(5);
  });

  it('spendMatch spends one (thrift may keep it), counts the strike and runs onMatch', () => {
    const w = world();
    const p = w.player;
    const hook = vi.spyOn(w.items, 'onMatch');
    p.matches = 2;
    expect(spendMatch(w, p.x, p.y)).toBe(true);
    expect(p.matches).toBe(1);
    expect(w.run.stats.matchesUsed).toBe(1);
    expect(hook).toHaveBeenCalledTimes(1);
    p.stats.thrift = 1;
    expect(spendMatch(w, p.x, p.y)).toBe(true);
    expect(p.matches).toBe(1);
    expect(w.run.stats.matchesUsed).toBe(2);
    p.stats.thrift = 0;
    p.matches = 0;
    expect(spendMatch(w, p.x, p.y)).toBe(false);
    expect(w.run.stats.matchesUsed).toBe(2);
    expect(hook).toHaveBeenCalledTimes(2);
  });
});

describe('sealed doors', () => {
  it('a locked door has a lamp; walking into it does nothing, interact with a match burns the seal', () => {
    const w = world('ria', 'SEALS');
    const { lamp } = sealedDoor(w);
    const p = w.player;
    const d = lamp.door;
    expect(d.state).toBe('locked');
    expect(w.map.nodes[d.to].locked).toBe(true);
    p.matches = 2;
    // pushing against the door: no touch unlock any more
    standAt(w, d.x, d.y);
    for (let i = 0; i < 60; i++) w.update(DT);
    expect(d.state).toBe('locked');
    expect(p.matches).toBe(2);
    // the card: price one match, '불 붙이기'
    standAt(w, lamp.x, lamp.y);
    w.update(DT);
    expect(w.focus).toBe(lamp);
    const info = lamp.interactionInfo(w);
    expect(info.actionLabel).toBe('불 붙이기');
    expect('silent' in info).toBe(false); // the sealed door keeps its card (only lanterns / sconces are silent)
    expect(info.price).toEqual({ icon: 'hud_match', text: '1', ok: true });
    expect(info.available).toBe(true);
    press(w, PRESS.interact);
    expect(lamp.lit).toBe(true);
    expect(d.state).toBe('open');
    expect(w.map.nodes[d.to].locked).toBe(false);
    expect(p.matches).toBe(1);
    expect(w.run.stats.matchesUsed).toBe(1);
    // lit: nothing more to strike
    expect(lamp.previewable()).toBe(false);
    expect(lamp.interact(w)).toBe(false);
    expect(p.matches).toBe(1);
  });

  it('refuses during a lockdown (match kept) and with an empty purse (float text)', () => {
    const w = world('ria', 'SEALS-2');
    const { lamp } = sealedDoor(w);
    const p = w.player;
    const float = vi.spyOn(w, 'floatText');
    standAt(w, lamp.x, lamp.y);
    w.update(DT);
    // lockdown: another door shut for a fight
    const other = w.room.doors.find((x) => x !== lamp.door && x.state === 'open');
    if (other) {
      other.state = 'closed';
      p.matches = 1;
      expect(lamp.interactionInfo(w).available).toBe(false);
      expect(lamp.interactionInfo(w).desc).toBe('전투가 끝나면 불을 붙일 수 있다.');
      expect(lamp.interact(w)).toBe(false);
      expect(p.matches).toBe(1);
      expect(lamp.door.state).toBe('locked');
      expect(float.mock.calls.some((c) => c[2] === '전투가 끝나면 붙일 수 있다')).toBe(true);
      // a lockdown is not a missing match: the price does not blink
      expect(matchDeniedAt(lamp)).toBeUndefined();
      other.state = 'open';
    }
    p.matches = 0;
    float.mockClear();
    expect(lamp.interactionInfo(w).available).toBe(false);
    expect(lamp.interactionInfo(w).price?.ok).toBe(false);
    expect(lamp.interact(w)).toBe(false);
    expect(lamp.interact(w)).toBe(false);
    expect(lamp.door.state).toBe('locked');
    // the refusal floats once a second, not once a press
    expect(float.mock.calls.filter((c) => c[2] === '성냥이 없다')).toHaveLength(1);
    // and the card's price blinks on every refused press (the float can hide behind the card)
    expect(matchDeniedAt(lamp)).toBe(w.time);
  });

  it('a queued match hint that stopped applying is dropped unseen, and comes back when it applies again', () => {
    const w = world('ria', 'SEALS-HINT');
    const { lamp } = sealedDoor(w);
    const flags = save.progress.flags;
    save.progress.flags = flags.filter((f) => f !== 'hint:match');
    try {
      const fixtures = w.entities.filter((e) => 'fixture' in e && 'lit' in e) as unknown as { lit: boolean }[];
      const run = (h: HintSystem) => { for (let i = 0; i < 240; i++) { w.floorCard = null; h.update(w, DT); } };
      w.floorCard = null;
      w.player.matches = 1;
      const h = new HintSystem();
      h.update(w, DT); // queued; the start cooldown holds it back
      for (const f of fixtures) f.lit = true; // lit in the meantime
      run(h);
      expect(HintSystem.seen('match')).toBe(false);
      lamp.lit = false;
      run(h);
      expect(HintSystem.seen('match')).toBe(true);
    } finally {
      save.progress.flags = flags;
    }
  });

  it('co-op: two keepers striking the same lamp on the same step pay one match', () => {
    const w = party(['ria', 'bern']);
    const { lamp } = sealedDoor(w);
    const purse = w.players[0].purse;
    expect(w.players[1].purse).toBe(purse);
    purse.matches = 3;
    standAt(w, lamp.x, lamp.y);
    w.update(DT);
    press(w, PRESS.interact);
    expect(lamp.lit).toBe(true);
    expect(purse.matches).toBe(2);
    expect(w.run.stats.matchesUsed).toBe(1);
  });

  it('a lit lamp is part of the state hash', () => {
    const w = world('ria', 'SEALS-3');
    const { lamp } = sealedDoor(w);
    const before = stateHash(w);
    lamp.lit = true;
    expect(stateHash(w)).not.toBe(before);
  });
});

describe('sealed chests', () => {
  it('a sealed chest opens only through interact with a match; a plain chest still opens on touch', () => {
    const w = world('ria', 'CHESTS');
    const p = w.player;
    const sealed = new Chest(p.x + 30, p.y, true);
    const plain = new Chest(p.x - 40, p.y, false);
    w.spawn(sealed);
    w.spawn(plain);
    w.update(DT);
    p.matches = 0;
    standAt(w, sealed.x, sealed.y);
    for (let i = 0; i < 30; i++) w.update(DT);
    expect(sealed.opened).toBe(false);
    expect(w.focus).toBe(sealed);
    expect(sealed.interactionInfo(w).available).toBe(false);
    press(w, PRESS.interact);
    expect(sealed.opened).toBe(false);
    p.matches = 1;
    for (let i = 0; i < 30; i++) w.update(DT);
    expect(sealed.opened).toBe(false);
    expect(p.matches).toBe(1);
    press(w, PRESS.interact);
    expect(sealed.opened).toBe(true);
    expect(p.matches).toBe(0);
    standAt(w, plain.x, plain.y);
    w.update(DT);
    expect(plain.opened).toBe(true);
  });
});

describe('starting matches', () => {
  const EXPECTED: Record<string, number> = {
    ria: 1, mori: 1, serin: 1, baekgu: 1,
    bern: 2, bori: 2, tove: 2, luen: 2, ves: 2, ort: 2, mira: 2,
    niel: 0,
  };
  it('every keeper starts with its own number of matches (co-op adds them up to the cap)', () => {
    const ids = Characters.all().map((c) => c.id).filter((id) => id in EXPECTED);
    expect(ids.sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const id of ids) {
      expect(Characters.must(id).matches ?? 1, id).toBe(EXPECTED[id]);
      expect(world(id, `START-${id}`).player.matches, id).toBe(EXPECTED[id]);
    }
    const w = party(['bern', 'bori', 'tove', 'niel']);
    expect(w.players[0].matches).toBe(6);
    for (const p of w.players) expect(p.purse).toBe(w.players[0].purse);
  });
});

describe('old saves', () => {
  it('a checkpoint purse with bombs and keys becomes matches, and restoring twice never doubles them', () => {
    const w = world('ria', 'OLD-SAVE');
    const c = captureCheckpoint(w);
    expect(c.purse).toEqual({ coins: w.player.coins, matches: w.player.matches });
    const old = { ...c, purse: { coins: 3, bombs: 3, keys: 2 } } as unknown as Checkpoint;
    restoreCheckpoint(w, old);
    expect(w.player.coins).toBe(3);
    expect(w.player.matches).toBe(4);
    restoreCheckpoint(w, old);
    expect(w.player.matches).toBe(4);
    expect((old.purse as { matches?: number }).matches).toBeUndefined();
    expect(migratePurse({ coins: 1, bombs: 40, keys: 40 }).matches).toBe(MATCH_CAP);
    expect(migratePurse({ coins: 1, matches: 5, bombs: 9 }).matches).toBe(5);
    // older run stats (no matchesUsed) are completed on restore
    const noStat = { ...c, stats: { ...c.stats, matchesUsed: undefined } } as unknown as Checkpoint;
    restoreCheckpoint(w, noStat);
    expect(w.run.stats.matchesUsed).toBe(0);
  });

  it('renamed item ids and vars are migrated; a grant already paid is not paid again', () => {
    expect(normalizeItemId('tick_bomb')).toBe(LEGACY_ITEM_IDS.tick_bomb);
    expect(normalizeItemId('black_candle')).toBe('soot_candle');
    expect(normalizeItemId('lantern_bolt')).toBe('lantern_bolt');
    const w = world('ria', 'OLD-IDS');
    const c = captureCheckpoint(w);
    const old = {
      ...c,
      items: ['wind_up_key', 'black_candle'], obtained: ['tick_bomb', 'bless_powder'], seen: ['black_candle', 'potion_soul'],
      vars: { __grant_wind_up_key: 1, __grant_tick_bomb: 1, __grant_cluster_powder: 2, __bloodOathFloor: 3, __keep: 7 },
    } as Checkpoint;
    const m = migrateCheckpoint(structuredClone(old));
    expect(m.items).toEqual(['wind_up_matchbox', 'soot_candle']);
    expect(m.obtained).toEqual(['tick_stopper', 'bless_match_pouch']);
    expect(m.seen).toEqual(['soot_candle', 'potion_soul']);
    expect(m.vars).toEqual({ __grant_wind_up_matchbox: 1, __lastStandFloor: 3, __keep: 7 });
    expect(LEGACY_VARS.__grant_tick_bomb).toBeNull();
    // idempotent
    expect(migrateCheckpoint(structuredClone(m))).toEqual(m);
    // a grantPerCopy item restored with its grant var: the matches are not granted again
    const granted = { ...c, items: ['bless_blastproof'], vars: { __grant_bless_blastproof: 1 }, purse: { coins: 0, matches: 3 } } as Checkpoint;
    restoreCheckpoint(w, granted);
    w.update(DT);
    expect(w.player.matches).toBe(3);
  });

  it("the collection's seen list is migrated (renamed ids, no duplicates)", () => {
    const p = { seenItems: ['tick_bomb', 'tick_stopper', 'black_candle', 'lantern_bolt'] } as unknown as Progress;
    expect(migrateProgress(p).seenItems).toEqual(['tick_stopper', 'soot_candle', 'lantern_bolt']);
  });
});
