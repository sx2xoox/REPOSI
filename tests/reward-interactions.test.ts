import './headless';
import { afterEach, expect, it, vi } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { RNG } from '../src/engine/rng';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Artifacts, Potions, Weapons } from '../src/game/defs';
import { Pedestal, Pickup, type PickupKind } from '../src/game/pickups';
import { encounterRewards } from '../src/content/rooms/encounter-kit';
import { WeaponChest } from '../src/content/weapons/drops';
import { LanternShrine, OfferingBowl } from '../src/content/rooms/shrine';
import { buildCard } from '../src/ui/item-tooltip';
import { PRESS } from '../src/game/seam';
import { captureCheckpoint, restoreCheckpoint } from '../src/game/checkpoint';
import { isContentTemporarilyLocked } from '../src/game/release-policy';

loadContent();
afterEach(() => vi.unstubAllEnvs());
function setup(character = 'ria', count = 1) {
  const run = new RunState('REWARD-INTERACTIONS', character); run.staged = true;
  const w = new World(new Renderer(fakeDisplay(1280, 720)), run, { openInventory() {}, onGameOver() {} });
  if (count > 1) w.startParty(Array.from({ length: count }, (_, slot) => ({ slot, characterId: character, name: 'Keeper' })), 0);
  else w.start();
  for (const p of w.players) { p.x = 70; p.y = 65; p.god = true; }
  w.player.coins = 100;
  return w;
}
function press(w: World, pressed: number) {
  w.inputSource = (_w, _p, out) => { out.pressed = pressed; };
  w.update(1 / 60);
  w.inputSource = (_w, _p, out) => { out.pressed = 0; };
}
const rewards = (w: World) => w.entities.filter(e => !e.dead && (e instanceof WeaponChest || e instanceof Pedestal && e.item?.kind === 'artifact')) as (WeaponChest | Pedestal)[];

for (const kind of ['relay', 'workshop', 'vault', 'hunt', 'elite'] as const) {
  it(`${kind} independently rolls weapons/artifacts at the same rarity and scales free stock`, () => {
    vi.stubEnv('PROD', true);
    const w = setup('ria', 4), rng = new RNG('MIXED-' + kind);
    for (const floor of [1, 4, 7]) {
      const tier = kind === 'relay' ? (floor < 4 ? 'common' : 'rare') : kind === 'vault' ? (floor < 4 ? 'epic' : 'legendary') : (floor < 4 ? 'rare' : 'epic');
      w.startFloor(floor);
      for (const p of w.players) { p.x = 70; p.y = 65; }
      let artifactCount = 0, weaponCount = 0, mixedBatches = 0;
      for (let draw = 0; draw < 64; draw++) {
        w.run.lootRng.restore(rng.snapshot()); rng.next();
        const count = draw === 0 ? 1 : 4;
        encounterRewards(w, (1 << count) - 1, kind); w.update(1 / 60);
        const batch = rewards(w);
        expect(batch).toHaveLength(count);
        if (batch.some(e => e instanceof WeaponChest) && batch.some(e => e instanceof Pedestal)) mixedBatches++;
        for (const e of batch) {
          const def = e instanceof WeaponChest ? Weapons.must(e.weaponId) : Artifacts.must(e.item!.id);
          expect(def.rarity).toBe(tier); expect(isContentTemporarilyLocked(def.id)).toBe(false);
          expect(e.mem.ownerSlot).toBeUndefined(); expect(e.ctxP).toBeNull();
          if (e instanceof Pedestal) { artifactCount++; expect(e.group).toBe(0); }
          else weaponCount++;
          e.dead = true;
        }
      }
      expect(artifactCount / (artifactCount + weaponCount)).toBeGreaterThan(.35);
      expect(artifactCount / (artifactCount + weaponCount)).toBeLessThan(.65);
      expect(mixedBatches).toBeGreaterThan(20);
    }
  });
}

for (const kind of ['heart', 'soul_heart', 'bomb', 'bomb2', 'key', 'potion'] as PickupKind[]) {
  it(`priced ${kind} can be previewed while standing on it and only buys on an interaction press`, () => {
    const w = setup(), p = w.player, pk = new Pickup(kind, p.x, p.y);
    p.red = p.maxRed - 2; pk.price = 5; pk.grace = 0;
    if (kind === 'potion') pk.potionId = Potions.all()[0].id;
    w.spawn(pk);
    for (let i = 0; i < 120; i++) w.update(1 / 60);
    expect(pk.dead).toBe(false); expect(p.coins).toBe(100); expect(w.focus).toBe(pk);
    const card = buildCard(w, pk)!;
    expect(card.desc).toBeTruthy(); expect(card.action?.label).toBe('구매'); expect(card.action?.ok).toBe(true);
    expect(card.note).not.toContain('닿으면'); expect(card.price?.text).toBe('5');
    press(w, PRESS.interact);
    expect(pk.dead).toBe(true); expect(p.coins).toBe(95); expect(w.run.stats.coinsSpent).toBe(5);
    expect(pk.interact(w)).toBe(false); expect(p.coins).toBe(95);
    if (kind === 'potion') expect(p.potionId).toBe(pk.potionId);
  });
}

it('shop purchases reject no gold, full red health, downed players and stale distant focus', () => {
  const w = setup(), p = w.player, pk = new Pickup('heart', p.x, p.y); pk.price = 5; pk.grace = 0;
  expect(pk.interact(w)).toBe(false); expect(buildCard(w, pk)?.action?.ok).toBe(false);
  p.red -= 2; p.coins = 4;
  expect(pk.interact(w)).toBe(false); expect(buildCard(w, pk)?.price?.ok).toBe(false);
  p.coins = 100; p.downed = true; expect(pk.interact(w)).toBe(false); p.downed = false;
  p.x += 40; expect(pk.interact(w)).toBe(false); expect(p.coins).toBe(100); expect(pk.dead).toBe(false);
});

it('free hearts still collect on touch while shared shop stock is paid for only once', () => {
  const w = setup('ria', 2), p = w.players[0], other = w.players[1];
  p.red -= 2; const free = new Pickup('heart', p.x, p.y); free.grace = 0;
  free.update(w, 1 / 60); expect(free.dead).toBe(true); expect(p.red).toBe(p.maxRed); expect(p.coins).toBe(100);
  const shop = new Pickup('soul_heart', p.x, p.y); shop.grace = 0; shop.price = 5;
  const soul = other.soul;
  expect(shop.interact(w)).toBe(true); expect(w.asPlayer(other, () => shop.interact(w))).toBe(false);
  expect(p.coins).toBe(95); expect(other.soul).toBe(soul);
});

it('shrine previews the exact heart price and only offers after pressing interact', () => {
  for (const soulPayment of [false, true]) {
    const w = setup(), p = w.player, shrine = new LanternShrine(200, 100), bowl = new OfferingBowl(p.x, p.y, 'heart', shrine);
    if (soulPayment) { p.baseHearts = 1; w.items.recomputeStats(); p.red = p.maxRed; p.soul = 4; }
    w.spawn(bowl); const red = p.maxRed, soul = p.soul;
    for (let i = 0; i < 90; i++) w.update(1 / 60);
    expect(bowl.used).toBe(false); expect(p.maxRed).toBe(red); expect(p.soul).toBe(soul);
    expect(buildCard(w, bowl)?.desc).toContain(soulPayment ? '영혼 하트 1칸 소모' : '최대 빨간 체력 1칸 감소');
    expect(buildCard(w, bowl)?.action?.label).toBe('봉헌'); press(w, PRESS.interact);
    expect(bowl.used).toBe(true); expect(p.maxRed).toBe(red - (soulPayment ? 0 : 2)); expect(p.soul).toBe(soul - (soulPayment ? 2 : 0));
    expect(bowl.interact(w)).toBe(false); expect(shrine.spent).toBe(1);
  }
});

for (const character of ['tove', 'luen', 'ves', 'ort', 'mira']) {
  it(`${character} can switch back, reclaim and resume its starting weapon in production`, () => {
    vi.stubEnv('PROD', true);
    const w = setup(character), p = w.player, starter = p.weaponId;
    expect(isContentTemporarilyLocked(starter)).toBe(false);
    p.weapon.mem.temper = 2;
    const pickup = new Pedestal(p.x, p.y, { kind:'weapon', id:'iron_spear' });
    w.takePedestal(pickup); expect(p.weapon2Id).toBe(starter); p.holdT = 0; w.time += 1;
    press(w, PRESS.swap); expect(p.weaponId).toBe(starter); expect(p.weapon.mem.temper).toBe(2);
    const saved = captureCheckpoint(w); const resumed = setup(character); restoreCheckpoint(resumed, saved);
    expect(resumed.player.weaponId).toBe(starter); expect(resumed.player.weapon2Id).toBe('iron_spear'); expect(resumed.player.weapon.mem.temper).toBe(2);
    p.holdT = 0; w.time += 1; press(w, PRESS.swap);
    const holsteredSave = captureCheckpoint(w); restoreCheckpoint(resumed, holsteredSave);
    expect(resumed.player.weaponId).toBe('iron_spear'); expect(resumed.player.weapon2Id).toBe(starter);
    p.holdT = 0; w.time += 1; press(w, PRESS.swap);
    const replacement = new Pedestal(p.x, p.y, { kind:'weapon', id:'lantern_bolt' });
    w.takePedestal(replacement); expect(replacement.item?.id).toBe(starter);
    w.takePedestal(replacement); expect(p.weaponId).toBe(starter); expect(p.weapon.mem.temper).toBe(2);
    expect(isContentTemporarilyLocked('moon_fan')).toBe(false);
  });
}

it('released expansion weapons can be bought and retain both slots in production', () => {
  vi.stubEnv('PROD', true);
  const w = setup(), p = w.player, ped = new Pedestal(p.x, p.y, { kind:'weapon', id:'moon_fan' }); ped.price = 20;
  expect(w.tryTakePedestal(ped)).toBe(true);
  expect(p.coins).toBe(80); expect(ped.item).toBeNull(); expect(p.weaponId).toBe('moon_fan'); expect(p.weapon2Id).toBe('lantern_bolt');
  const saved = captureCheckpoint(w), resumed = setup(); restoreCheckpoint(resumed, saved);
  expect(resumed.player.weaponId).toBe('moon_fan'); expect(resumed.player.weapon2Id).toBe('lantern_bolt');
});
