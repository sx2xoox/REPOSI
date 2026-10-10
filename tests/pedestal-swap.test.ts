import './headless';
import { describe, expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Actives, Weapons } from '../src/game/defs';
import { Pedestal } from '../src/game/pickups';

loadContent();

function world(): World {
  const run = new RunState('PED-SWAP', 'ria');
  run.staged = true;
  const w = new World(new Renderer(fakeDisplay(1280, 720)), run, { openInventory() {}, onGameOver() {} });
  w.start();
  w.player.god = true;
  return w;
}

// 대가의 방: an item bought with health and swapped for the keeper's own one leaves that one on the
// stand for free — taking it back must not cost health again (it used to keep heartPrice)
describe('swapping onto a health-priced stand', () => {
  it('a weapon put down there is free to take back', () => {
    const w = world();
    const p = w.player;
    const ids = Weapons.all().map((d) => d.id).filter((id) => id !== p.weaponId);
    p.equipWeapon(w, ids[0]);
    expect(p.weapon2Id).toBeTruthy();
    const held = p.weaponId;
    const ped = new Pedestal(p.x, p.y - 12, { kind: 'weapon', id: ids[1] });
    ped.heartPrice = 1;
    w.spawn(ped);
    const maxBefore = p.maxRed;
    w.takePedestal(ped);
    expect(p.maxRed).toBe(maxBefore - 2);
    expect(ped.item?.kind).toBe('weapon');
    expect(ped.item?.id).toBe(held);
    expect(ped.heartPrice).toBe(0);
    expect(ped.price).toBe(0);
  });

  it('an active put down there is free to take back', () => {
    const w = world();
    const p = w.player;
    const acts = Actives.all().map((d) => d.id);
    p.setActive(acts[0], w);
    const ped = new Pedestal(p.x, p.y - 12, { kind: 'active', id: acts[1] });
    ped.heartPrice = 1;
    w.spawn(ped);
    w.takePedestal(ped);
    expect(ped.item).toMatchObject({ kind: 'active', id: acts[0] });
    expect(ped.heartPrice).toBe(0);
  });
});
