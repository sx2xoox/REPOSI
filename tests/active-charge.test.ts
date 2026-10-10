// An active item put down on a pedestal keeps its charge: swapping two actives
// back and forth never refills either (it used to give unlimited uses).

import './headless';
import { describe, expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Actives } from '../src/game/defs';
import { Pedestal } from '../src/game/pickups';
import { stateHash } from '../src/game/statehash';
import { scaleRewardRoom } from '../src/game/room-rewards';

loadContent();

function world(chars = ['ria']): World {
  const run = new RunState('ACTIVE-CHARGE', chars[0]);
  run.staged = true;
  const w = new World(new Renderer(fakeDisplay(1280, 720)), run, { openInventory() {}, onGameOver() {} });
  if (chars.length > 1) w.startParty(chars.map((characterId, slot) => ({ slot, characterId, name: `P${slot + 1}` })), 0);
  else w.start();
  for (const p of w.players) p.god = true;
  return w;
}

/** Two room-charged actives with different ids. */
function twoActives(): [string, string] {
  const room = Actives.all().filter((a) => !a.timed && a.charge >= 2);
  return [room[0].id, room[1].id];
}

describe('active charge on pedestals', () => {
  it('swapping two actives ten times grants no extra use', () => {
    const w = world();
    const p = w.player;
    const [a, b] = twoActives();
    p.setActive(a, w);
    expect(p.activeCharge).toBe(Actives.must(a).charge);
    const ped = new Pedestal(p.x + 20, p.y, { kind: 'active', id: b });
    w.spawn(ped);
    w.update(1 / 60);
    let uses = 0;
    for (let i = 0; i < 10; i++) {
      // use whatever is fully charged, then swap
      if (p.activeCharge >= Actives.must(p.activeId!).charge) {
        uses++;
        p.activeCharge = 0;
      }
      w.takePedestal(ped);
      expect(ped.item?.kind).toBe('active');
    }
    expect(uses).toBe(2);
    expect(p.activeCharge).toBe(0);
    expect(ped.item?.charge).toBe(0);
  });

  it('a fresh pedestal active is full; a put-down one keeps its partial charge both ways', () => {
    const w = world();
    const p = w.player;
    const [a, b] = twoActives();
    p.setActive(a, w, 1);
    expect(p.activeCharge).toBe(1);
    const ped = new Pedestal(p.x + 20, p.y, { kind: 'active', id: b });
    w.spawn(ped);
    w.takePedestal(ped);
    expect(p.activeId).toBe(b);
    expect(p.activeCharge).toBe(Actives.must(b).charge);
    expect(ped.item).toEqual({ kind: 'active', id: a, charge: 1 });
    w.takePedestal(ped);
    expect(p.activeId).toBe(a);
    expect(p.activeCharge).toBe(1);
    expect(ped.item).toEqual({ kind: 'active', id: b, charge: Actives.must(b).charge });
    // out-of-range charges are clamped to the item
    p.setActive(b, w, 999);
    expect(p.activeCharge).toBe(Actives.must(b).charge);
    p.setActive(b, w, -3);
    expect(p.activeCharge).toBe(0);
  });

  it("a put-down active's charge is part of the state hash", () => {
    const w = world();
    const [a, b] = twoActives();
    w.player.setActive(a, w, 0);
    const ped = new Pedestal(w.player.x + 20, w.player.y, { kind: 'active', id: b });
    w.spawn(ped);
    w.takePedestal(ped);
    const h0 = stateHash(w);
    ped.item!.charge = 1;
    expect(stateHash(w)).not.toBe(h0);
  });

  it('the co-op copy of a treasure pedestal keeps the charge', () => {
    const w = world(['ria', 'ria']);
    const [a] = twoActives();
    const ped = new Pedestal(100, 100, { kind: 'active', id: a, charge: 1 });
    w.spawn(ped);
    const node = w.node as { kind: string };
    const kind = node.kind;
    node.kind = 'treasure';
    try {
      scaleRewardRoom(w, [ped]);
    } finally {
      node.kind = kind;
    }
    w.update(1 / 60);
    const copies = w.entities.filter((e): e is Pedestal => e instanceof Pedestal && e !== ped && e.item?.id === a);
    expect(copies).toHaveLength(1);
    expect(copies[0].item?.charge).toBe(1);
  });
});
