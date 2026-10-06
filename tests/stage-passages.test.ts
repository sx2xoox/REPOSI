import './headless';
import { expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { loadContent } from '../src/content';
import { Renderer } from '../src/engine/renderer';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Floors } from '../src/game/defs';
import { Trapdoor } from '../src/game/pickups';
import { clearInput, PRESS } from '../src/game/seam';
import { captureCheckpoint, restoreCheckpoint } from '../src/game/checkpoint';
import { stateHash } from '../src/game/statehash';
import { runCoop } from './coopsim';

loadContent();
const renderer = new Renderer(fakeDisplay(1280, 720));
function setup(floor = 1, stage = 1, players = 1) {
  const run = new RunState('SPAWN-PASSAGE', 'ria');
  Object.assign(run, { staged: true, floor, stage });
  const w = new World(renderer, run, { openInventory() {}, onGameOver() {} });
  if (players > 1) w.startParty(Array.from({ length: players }, (_, slot) => ({ slot, characterId: 'ria', name: 'test' })), 0);
  else w.start();
  w.inputSource = (_w, _p, out) => { clearInput(out); };
  for (const p of w.players) p.god = true;
  return w;
}
function tick(w: World, n = 90) { for (let i = 0; i < n; i++) w.update(1 / 60); }
function passages(w: World) { return w.entities.filter((e): e is Trapdoor => e instanceof Trapdoor && !e.dead); }
function press(w: World, slot = 0) {
  w.inputSource = (_w, p, out) => { clearInput(out); if (p.slot === slot) out.pressed = PRESS.interact; };
  w.update(1 / 60);
  w.inputSource = (_w, _p, out) => { clearInput(out); };
}

it('every non-boss stage starts with one safe, nearby exit and no automatic descent', () => {
  for (const floor of Floors.all()) for (const stage of [1, 2, 3]) for (const count of [1, 4]) {
    const w = setup(floor.index, stage, count);
    expect(passages(w)).toHaveLength(stage < 3 ? 1 : 0);
    if (stage === 3) continue;
    const hole = passages(w)[0];
    expect(w.room.isFree(hole.x, hole.y, hole.r)).toBe(true);
    for (const p of w.players) {
      expect(Math.hypot(p.x - hole.x, p.y - hole.y)).toBeGreaterThan(14);
      expect(Math.hypot(p.x - hole.x, p.y - hole.y)).toBeLessThan(64);
      Object.assign(p, { x: hole.x, y: hole.y });
    }
    tick(w, 150);
    expect([w.run.floor, w.run.stage]).toEqual([floor.index, stage]);
    expect(w.descending).toBeNull();
    expect(w.run.stats.roomsCleared).toBe(0);
  }
});

it('one explicit input advances one stage, preserving equipment and optional exploration', () => {
  const w = setup(); w.player.coins = 42; w.player.weaponId = 'void_gaze';
  const stats = { ...w.run.stats };
  for (const stage of [1, 2]) {
    tick(w); const hole = passages(w)[0];
    Object.assign(w.player, { x: hole.x, y: hole.y });
    press(w); expect(w.descending).not.toBeNull();
    expect(hole.interact(w)).toBe(false);
    tick(w, 180);
    expect([w.run.floor, w.run.stage]).toEqual([1, stage + 1]);
    expect(w.player.weaponId).toBe('void_gaze'); expect(w.player.coins).toBe(42);
    expect(w.map.nodes.filter(n => n.kind === 'normal').length).toBeGreaterThanOrEqual(7);
  }
  expect(passages(w)).toHaveLength(0);
  expect(w.run.stats.roomsCleared).toBe(stats.roomsCleared);
  expect(w.run.stats.kills).toBe(stats.kills);
  expect(w.run.stats.bossesKilled).toBe(0);
});

it('exploring and revisiting spawn preserves a single passage; normal fights do not create extras', () => {
  const w = setup(), start = w.map.nodes[w.map.startId], hole = passages(w)[0];
  for (const node of w.map.nodes.filter(n => n.kind === 'normal')) {
    w.enterRoom(node, null); tick(w, 1);
    for (const e of [...w.enemies]) w.killEnemy(e);
    tick(w, 60);
    expect(passages(w)).toHaveLength(0);
    w.enterRoom(start, null); tick(w, 1);
    expect(passages(w)).toEqual([hole]);
  }
});

it('stage three requires its boss, and the boss passage also requires interaction', () => {
  const w = setup(1, 3);
  expect(w.map.exitId).toBeUndefined(); expect(passages(w)).toHaveLength(0);
  w.enterRoom(w.map.nodes[w.map.bossId], null); tick(w, 1);
  expect(w.bosses.length).toBeGreaterThan(0); expect(passages(w)).toHaveLength(0);
  for (const e of [...w.enemies]) w.killEnemy(e);
  tick(w, 90); expect(passages(w)).toHaveLength(1);
  const hole = passages(w)[0]; Object.assign(w.player, { x: hole.x, y: hole.y });
  tick(w); expect([w.run.floor, w.run.stage]).toEqual([1, 3]);
  expect(hole.interactionInfo(w).name).toBe('2-1로 내려가기');
  press(w); tick(w, 120);
  expect([w.run.floor, w.run.stage]).toEqual([2, 1]); expect(passages(w)).toHaveLength(1);
});

it('closed, distant, removed, paused and downed interactions cannot descend', () => {
  const w = setup(), hole = passages(w)[0], p = w.player;
  Object.assign(p, { x: hole.x, y: hole.y });
  expect(hole.interact(w)).toBe(false);
  tick(w); p.x = hole.x + 28; expect(hole.interact(w)).toBe(false);
  p.x = hole.x; w.paused = true; expect(hole.interact(w)).toBe(false); w.paused = false;
  p.downed = true; expect(hole.interact(w)).toBe(false); p.downed = false;
  w.entities = w.entities.filter(e => e !== hole); expect(hole.interact(w)).toBe(false);
  expect(w.descending).toBeNull();
});

it('stage checkpoints restore the same stage with one intentional exit', () => {
  const w = setup(4, 2); w.player.coins = 73;
  const cp = captureCheckpoint(w), resumed = setup(cp.floor, cp.stage);
  restoreCheckpoint(resumed, cp); tick(resumed);
  expect(passages(resumed)).toHaveLength(1); expect(resumed.player.coins).toBe(73);
  expect([resumed.run.floor, resumed.run.stage]).toEqual([4, 2]); expect(resumed.descending).toBeNull();
});

it('a campaign boss exit still invokes the story/return hook exactly once', () => {
  const w = setup(4, 3); w.run.campaign = true; w.run.targetFloor = 4;
  const visits: number[] = []; w.host.onCampaignPassage = floor => { visits.push(floor); };
  w.enterRoom(w.map.nodes[w.map.bossId], null); tick(w, 1);
  for (const e of [...w.enemies]) w.killEnemy(e);
  tick(w, 180); const hole = passages(w)[0];
  expect(hole.interactionInfo(w).name).toBe('마을로 귀환');
  expect(hole.openT).toBe(1);
  Object.assign(w.player, { x: hole.x, y: hole.y }); tick(w, 1); press(w); tick(w);
  expect(visits).toEqual([4]);
});

it('trapdoor readiness participates in the multiplayer state hash', () => {
  const w = setup(), hash = stateHash(w);
  passages(w)[0].openT = 1; expect(stateHash(w)).not.toBe(hash);
});

it('a non-host takes all four peers through both exits over a delayed, lossy link', () => {
  const result = runCoop({
    name: 'spawn-passages', seed: 'SPAWN-NET', chars: ['ria', 'bern', 'serin', 'bori'], ms: 10000,
    link: { latencyMs: 35, jitterMs: 20, drop: .05 }, bossAt: 0, downAt: 0, leaveAt: 0, discardAt: 0, stayInRoom: true,
    extraStep(w, tick) { if (tick === 5) { w.run.staged = true; w.startFloor(1); } },
    input(w, step, out) {
      clearInput(out);
      if (!w.run.staged || w.run.stage >= 3 || w.local.slot !== 2 || w.transitioning || w.descending) return;
      const hole = passages(w)[0]; if (!hole) return;
      const dx = hole.x - w.local.x, dy = hole.y - w.local.y, d = Math.hypot(dx, dy);
      if (d > 10) { out.mx = dx / d; out.my = dy / d; }
      if (d < 20 && step % 30 === 0) out.pressed = PRESS.interact;
    },
  });
  const ref = result.peers[0].hashes;
  for (const peer of result.peers) {
    expect(peer.desyncs).toEqual([]);
    expect([peer.world.run.floor, peer.world.run.stage]).toEqual([1, 3]);
    expect(peer.world.players).toHaveLength(4); expect(passages(peer.world)).toHaveLength(0);
    expect(peer.world.run.stats.roomsCleared).toBe(0);
    let checked = 0;
    for (let i = 0; i < Math.min(ref.length, peer.hashes.length); i++) {
      if (ref[i] === undefined || peer.hashes[i] === undefined) continue;
      expect(peer.hashes[i]).toBe(ref[i]); checked++;
    }
    expect(checked).toBeGreaterThan(300);
  }
});
