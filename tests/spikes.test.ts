import './headless';
import { expect, it } from 'vitest';
import { spikeState } from '../src/game/spikes';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Renderer } from '../src/engine/renderer';
import { fakeDisplay } from './headless';
import { clearInput, fixedRules } from '../src/game/seam';
import { Tile } from '../src/game/tiles';
import { TILE, FIXED_DT } from '../src/game/constants';
loadContent();

it('spikes warn before rising, retract, repeat, and remain off in cleared rooms', () => {
  expect(spikeState(1, false)).toEqual({ height: 0, warning: false, active: false });
  expect(spikeState(2, false)).toEqual({ height: 0, warning: true, active: false });
  expect(spikeState(2.3, false).height).toBe(1);
  expect(spikeState(2.8, false)).toEqual({ height: 3, warning: false, active: true });
  expect(spikeState(3.6, false).active).toBe(false);
  expect(spikeState(4.8, false).height).toBe(0);
  for (let t = 0; t < 12; t += FIXED_DT) {
    expect(spikeState(t, true)).toEqual({ height: 0, warning: false, active: false });
  }
});

it('both teammates are hurt only by raised spikes; clear and flight prevent damage', () => {
  const w = new World(new Renderer(fakeDisplay(1280, 720)), new RunState('SPIKES', 'ria'), { openInventory() {}, onGameOver() {} });
  w.rules = fixedRules({ hitStop: false });
  w.startParty([0, 1].map(slot => ({ slot, characterId: 'ria', name: `P${slot}` })), 0);
  w.inputSource = (_w, _p, out) => clearInput(out);
  w.time = 10; w.node.cleared = false;
  for (const p of w.players) {
    p.x = w.room.centerX; p.y = w.room.centerY;
    p.invuln = 0; p.stats.dodge = 0;
    w.room.setTile(Math.floor(p.x / TILE), Math.floor((p.y + 2) / TILE), Tile.SPIKES);
  }
  const hp = w.players.map(p => p.red);
  const tick = () => { for (const p of w.players) p.update(w, FIXED_DT); };
  w.roomTime = 2; tick(); expect(w.players.map(p => p.red)).toEqual(hp);
  w.roomTime = 2.8; tick(); expect(w.players.map(p => p.red)).toEqual(hp.map(v => v - 1));
  for (const p of w.players) { p.invuln = 0; p.spikeCD = 0; }
  w.node.cleared = true; tick(); expect(w.players.map(p => p.red)).toEqual(hp.map(v => v - 1));
  w.node.cleared = false;
  for (const p of w.players) p.flying = true;
  tick(); expect(w.players.map(p => p.red)).toEqual(hp.map(v => v - 1));
});
