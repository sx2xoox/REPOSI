import './headless';
import { expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { loadContent } from '../src/content';
import { Floors } from '../src/game/defs';
import { generateStage } from '../src/game/dungeon';
import { RNG } from '../src/engine/rng';
import { RunState } from '../src/game/run';
import { World } from '../src/game/world';
import { Renderer } from '../src/engine/renderer';
import { captureCheckpoint, restoreCheckpoint } from '../src/game/checkpoint';
import { save, DEFAULT_PROGRESS } from '../src/engine/save';
import { Trapdoor } from '../src/game/pickups';
import { stateHash } from '../src/game/statehash';
loadContent();
const renderer = new Renderer(fakeDisplay(1280, 720));
const host = { openInventory() {}, onGameOver() {} };
function world(seed = 'STAGES') { const run = new RunState(seed, 'ria'); run.staged = true; const w = new World(renderer, run, host); w.start(); w.player.god = true; return w; }

it('28 stage layouts are connected, deterministic, and only fourth stages have bosses', () => {
  for (const f of Floors.all()) for (let stage = 1; stage <= 4; stage++) for (let s = 0; s < 20; s++) {
    const m = generateStage(f, stage, new RNG(s));
    expect(m).toEqual(generateStage(f, stage, new RNG(s)));
    expect(m.nodes.filter(n => n.kind === 'boss')).toHaveLength(stage === 4 ? 1 : 0);
    const seen = new Set([m.startId]), queue = [m.startId];
    while (queue.length) for (const d of m.nodes[queue.shift()!].doors) if (!seen.has(d.to)) { seen.add(d.to); queue.push(d.to); }
    expect(seen.size).toBe(m.nodes.length);
    expect(m.nodes.every(n => !!n.templateId)).toBe(true);
    expect(stage === 4 ? m.bossId >= 0 : m.exitId !== undefined).toBe(true);
  }
});
it('clearing the last normal room creates a real passage and advances to the next stage', () => {
  const w = world(); w.enterRoom(w.map.nodes[w.map.exitId!], null); w.update(1 / 60);
  for (let i = 0; i < 120; i++) { for (const e of w.enemies) if (e.alive) w.killEnemy(e); w.update(1 / 60); }
  const passage = w.entities.find(e => e instanceof Trapdoor)!;
  expect(passage).toBeDefined();
  w.player.x = passage.x + 22; w.player.y = passage.y; w.update(1 / 60);
  w.player.x = passage.x;
  for (let i = 0; i < 120; i++) w.update(1 / 60);
  expect([w.run.floor, w.run.stage]).toEqual([1, 2]);
  expect(w.map.nodes.some(n => n.kind === 'boss')).toBe(false);
});
it('stage checkpoints round-trip equipment, paid maximum hearts, blessings, currencies and RNG', () => {
  const w = world(); w.items.give('bless_haste'); w.items.give('fallen_star');
  w.player.weaponId = 'void_gaze'; w.player.weapon2Id = 'lantern_bolt'; w.player.vars.__heartContainersSpent = 1;
  w.items.addBuff({ key: 'shrine:test', time: Infinity, hooks: { stats: m => { m.addStat('damage', 3); } } });
  w.items.recompute(); w.player.red = 2; w.player.soul = 3; w.player.purse.coins = 42;
  const c = JSON.parse(JSON.stringify(captureCheckpoint(w)));
  const other = world(); restoreCheckpoint(other, c);
  expect(captureCheckpoint(other)).toEqual(c);
  expect(other.player.stats).toEqual(w.player.stats);
  expect(other.run.rng.nextU32()).toBe(w.run.rng.nextU32());
});
it('save slots isolate unlocks, story and checkpoints without overwriting an occupied slot', () => {
  const original = { slots: save.slots, active: save.activeSlot, progress: save.progress, history: save.history };
  try {
    save.activeSlot = -1; save.slots = Array(4).fill(null); save.progress = structuredClone(DEFAULT_PROGRESS); save.history = [];
    save.openSlot(1, '첫째'); save.setFlag('unlock:niel'); save.progress.campaign!.cleared = 4; save.saveProgress();
    save.openSlot(2, '둘째'); expect(save.hasFlag('unlock:niel')).toBe(false); expect(save.progress.campaign!.cleared).toBe(0);
    save.openSlot(1, '바꾸지 않기'); expect(save.slots[1]!.name).toBe('첫째'); expect(save.hasFlag('unlock:niel')).toBe(true); expect(save.progress.campaign!.cleared).toBe(4);
  } finally { save.slots = original.slots; save.activeSlot = original.active; save.progress = original.progress; save.history = original.history; }
});
it('different stages participate in the lockstep hash', () => {
  const w = world(); const hash = stateHash(w); w.run.stage = 2; expect(stateHash(w)).not.toBe(hash);
});
