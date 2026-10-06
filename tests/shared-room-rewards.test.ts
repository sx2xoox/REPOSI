import './headless';
import { expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { RoomTemplates } from '../src/game/defs';
import { Pedestal, Pickup, Chest } from '../src/game/pickups';
import { OfferingBowl } from '../src/content/rooms/shrine';
import type { RoomKind } from '../src/game/constants';
import { encounterRewards } from '../src/content/rooms/encounter-kit';
import { WeaponChest } from '../src/content/weapons/drops';

loadContent();
function setup(kind: RoomKind, count: number) {
  const run = new RunState('SHARED-ROOMS', 'ria');
  run.staged = true;
  const w = new World(new Renderer(fakeDisplay(1280, 720)), run, { openInventory() {}, onGameOver() {} });
  if (count > 1) w.startParty(Array.from({ length: count }, (_, slot) => ({ slot, characterId: 'ria', name: `P${slot + 1}` })), 0);
  else w.start();
  const node = w.map.nodes.find(n => n.id !== w.map.startId)!;
  node.kind = kind;
  node.templateId = RoomTemplates.all().find(t => t.shape === '1x1' && t.kinds.includes(kind))!.id;
  node.visited = false;
  node.cleared = false;
  w.enterRoom(node, null);
  return w;
}
function stock(w: World) {
  return w.entities.filter(e => e instanceof Pedestal || e instanceof Pickup || e instanceof Chest);
}

for (const kind of ['shop', 'curse', 'secret'] as const) it(`${kind} keeps one shared stock at 1, 2 and 4 players`, () => {
  const solo = stock(setup(kind, 1));
  expect(solo.length).toBeGreaterThan(0);
  for (const count of [2, 4]) {
    const w = setup(kind, count), items = stock(w);
    expect(items.length).toBe(solo.length);
    expect(items.every(e => e.mem.ownerSlot === undefined)).toBe(true);
    expect(items.map(e => [e.x, e.y])).toEqual(solo.map(e => [e.x, e.y]));
    const item = items.find(e => e instanceof Pedestal) as Pedestal | undefined;
    if (item) {
      w.players[1].coins = 100;
      expect(w.asPlayer(w.players[1], () => item.affordable(w))).toBe(true);
      w.asPlayer(w.players[1], () => w.takePedestal(item));
      expect(item.item).toBeNull();
      const before = w.players[0].inv.size;
      w.asPlayer(w.players[0], () => w.takePedestal(item));
      expect(w.players[0].inv.size).toBe(before);
    }
  }
});

it('shrine bowls are shared single uses, with the benefit going to the offering keeper', () => {
  const w = setup('shrine', 4), bowls = w.entities.filter(e => e instanceof OfferingBowl) as OfferingBowl[];
  expect(bowls).toHaveLength(2);
  const coin = bowls.find(b => b.kind === 'coin')!, p = w.players[1], second = w.players[2];
  w.players[0].coins = 100; p.red = 2; const soul = p.soul, otherSoul = second.soul;
  p.x = coin.x; p.y = coin.y;
  w.asPlayer(p, () => coin.update(w, 1 / 60));
  expect(coin.used).toBe(true); expect(p.coins).toBe(85); expect(p.red).toBe(p.maxRed); expect(p.soul).toBe(soul + 2);
  second.x = coin.x; second.y = coin.y;
  w.asPlayer(second, () => coin.update(w, 2));
  expect(second.coins).toBe(85); expect(second.soul).toBe(otherSoul); expect(coin.shrine.spent).toBe(1);
  const heart = bowls.find(b => b.kind === 'heart')!;
  p.x = heart.x; p.y = heart.y;
  w.asPlayer(p, () => heart.update(w, 1 / 60));
  expect(heart.used).toBe(true);
  const max = second.maxRed; second.x = heart.x; second.y = heart.y;
  w.asPlayer(second, () => heart.update(w, 2));
  expect(second.maxRed).toBe(max); expect(heart.shrine.spent).toBe(2);
});

it('treasure rooms retain party-scaled stock without ownership', () => {
  const solo = stock(setup('treasure', 1)), party = stock(setup('treasure', 4));
  expect(party.length).toBe(solo.length * 4);
  expect(party.every(e => e.mem.ownerSlot === undefined)).toBe(true);
});

it('one keeper can take all four challenge choices, with one grant per pair and no team-wide grant', () => {
  const w=setup('refinery',4),p=w.players[2];
  for(const q of w.players){q.x=50;q.y=45;}
  encounterRewards(w,15,'challenge');w.update(1/60);
  const choices=w.entities.filter(e=>e instanceof Pedestal) as Pedestal[];
  expect(choices).toHaveLength(8);
  const before=w.players.map(q=>q.inv.size),groups=[...new Set(choices.map(e=>e.group))];
  expect(groups).toHaveLength(4);
  for(const group of groups){
    const pair=choices.filter(e=>e.group===group);
    expect(pair.every(e=>e.mem.ownerSlot===undefined)).toBe(true);
    w.asPlayer(p,()=>w.takePedestal(pair[0]));
    expect(pair[1].item).toBeNull();
    w.asPlayer(w.players[1],()=>w.takePedestal(pair[0]));
  }
  expect(w.players.map(q=>q.inv.size)).toEqual(before.map((n,i)=>n+(i===2?4:0)));
});

it('any keeper can open multiple crates, then another keeper can claim the contents', () => {
  const w=setup('refinery',4),opener=w.players[2],taker=w.players[1];
  for(const p of w.players){p.x=50+p.slot*12;p.y=45;}
  encounterRewards(w,15,'elite');w.update(1/60);
  const crates=w.entities.filter(e=>e instanceof WeaponChest) as WeaponChest[];
  expect(crates).toHaveLength(4);
  for(const c of crates){opener.x=c.x;opener.y=c.y;w.update(1/60);expect(c.opened).toBe(true);}
  const contents=w.entities.filter(e=>e instanceof Pedestal) as Pedestal[];
  expect(contents).toHaveLength(4);expect(contents.every(e=>e.mem.ownerSlot===undefined&&e.ctxP===null)).toBe(true);
  const untouched=w.players.filter(p=>p!==taker).map(p=>[p.weaponId,p.weapon2Id]);
  for(const e of contents){const id=e.item!.id;expect(w.asPlayer(taker,()=>w.tryTakePedestal(e))).toBe(true);expect(taker.weaponId).toBe(id);}
  expect(w.players.filter(p=>p!==taker).map(p=>[p.weaponId,p.weapon2Id])).toEqual(untouched);
});

it('loot survives a former creator leaving, including legacy ownership metadata', () => {
  const w=setup('refinery',2),creator=w.players[1];
  const loot=[new Chest(100,100),new WeaponChest(140,100,'iron_spear'),new Pedestal(180,100,{kind:'artifact',id:'fallen_star'}),new Pickup('key',220,100)];
  w.spawnOwner=creator;for(const e of loot){w.spawn(e);expect(e.ctxP).toBeNull();e.ctxP=creator;e.mem.ownerSlot=1;}w.spawnOwner=null;
  w.removePlayer(1);w.update(1/60);
  expect(loot.every(e=>!e.dead)).toBe(true);
  for(const e of loot){w.player.x=e.x;w.player.y=e.y;w.update(1/60);}
  expect((loot[0] as Chest).opened).toBe(true);expect((loot[1] as WeaponChest).opened).toBe(true);
  expect(w.tryTakePedestal(loot[2] as Pedestal)).toBe(true);
});
