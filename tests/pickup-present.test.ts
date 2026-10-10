// The pickup presentation (game/pickup-draw.ts, ui/cards.ts drawFind): taking a pedestal
// item spawns one cosmetic draw-in toward the keeper's lantern, queues a delayed find tag
// (no flavour quote) and holds fire / release / swap for a short guard only.
import './headless';
import { describe, expect, it, vi } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { RARITY_NAME, Weapons } from '../src/game/defs';
import { weaponFamily } from '../src/game/weapon-families';
import { Pedestal, type PedestalItem } from '../src/game/pickups';
import { FindFlare, FIND_DELAY, FIND_HOLD, FIND_LIFE, FIND_TIMING, LanternDraw, bannerEnd } from '../src/game/pickup-draw';
import { stateHash } from '../src/game/statehash';
import { FIXED_DT } from '../src/game/constants';
import { HELD } from '../src/game/seam';
import { bannersBottom, drawBanners } from '../src/ui/cards';

loadContent();

function setup(character = 'ria', count = 1, seed = 'PICKUP-PRESENT') {
  const run = new RunState(seed, character);
  run.staged = true;
  const w = new World(new Renderer(fakeDisplay(1280, 720)), run, { openInventory() {}, onGameOver() {} });
  if (count > 1) w.startParty(Array.from({ length: count }, (_, slot) => ({ slot, characterId: character, name: `K${slot + 1}` })), 0);
  else w.start();
  for (const e of [...w.enemies]) w.killEnemy(e);
  for (const p of w.players) { p.x = 70; p.y = 65; p.god = true; }
  w.inputSource = (_w, _p, out) => { out.pressed = 0; out.held = 0; };
  w.update(FIXED_DT);
  w.banners.length = 0;
  return w;
}

function pedestal(w: World, item: PedestalItem, x = 96, y = 60): Pedestal {
  const ped = w.dropItemPedestal(item, x, y);
  w.update(FIXED_DT);
  ped.waitForLeave = false;
  return ped;
}

const steps = (w: World, n: number) => { for (let i = 0; i < n; i++) w.update(FIXED_DT); };
const draws = (w: World) => w.entities.filter((e) => e instanceof LanternDraw) as LanternDraw[];

const ITEMS: PedestalItem[] = [
  { kind: 'artifact', id: 'prism_shard' },
  { kind: 'active', id: 'rewind_spool' },
  { kind: 'weapon', id: 'nail_carbine' },
];

describe('pickup presentation', () => {
  for (const item of ITEMS) {
    it(`a ${item.kind} find draws into the lantern once, with a cosmetic id and a delayed tag`, () => {
      const w = setup();
      const p = w.player;
      const ped = pedestal(w, item);
      w.takePedestal(ped);
      expect(ped.item?.id).not.toBe(item.id);
      // the guard is short and hashed
      expect(p.holdT).toBeCloseTo(FIND_HOLD, 6);
      // newest banner: the find tag, shown when the item lands; no flavour quote
      const b = w.banners[w.banners.length - 1];
      expect(b.kind).toBe('find');
      expect(b.delay).toBe(FIND_DELAY);
      expect('quote' in b).toBe(false);
      expect(bannerEnd(b)).toBeCloseTo(FIND_DELAY + FIND_LIFE, 6);
      w.update(FIXED_DT);
      const ds = draws(w);
      expect(ds).toHaveLength(1);
      expect(ds[0].id).toBeLessThan(0);
      expect(ds[0].keeper).toBe(p);
      expect(ds[0].toHand).toBe(item.kind === 'weapon');
      // lands, flares, and is gone by 0.6 s
      steps(w, Math.round(0.6 / FIXED_DT));
      expect(draws(w)).toHaveLength(0);
      steps(w, Math.round(0.4 / FIXED_DT));
      expect(w.entities.some((e) => e instanceof FindFlare)).toBe(false);
    });
  }

  it('the keeper fires again once the short guard ends; the held weapon stays drawn for an artifact find', () => {
    const w = setup();
    const p = w.player;
    w.takePedestal(pedestal(w, { kind: 'artifact', id: 'prism_shard' }));
    w.inputSource = (_w, _p, out) => { out.pressed = 0; out.held = HELD.fire; out.ax = 1; out.ay = 0; };
    let firstFire = -1;
    for (let i = 1; i <= 40 && firstFire < 0; i++) {
      w.update(FIXED_DT);
      if (p.firing) firstFire = i * FIXED_DT;
    }
    expect(firstFire).toBeGreaterThan(FIND_HOLD - 2 * FIXED_DT);
    expect(firstFire).toBeLessThan(FIND_HOLD + 3 * FIXED_DT);
    // the weapon is not hidden by the guard (the old over-the-head lift hid it)
    w.takePedestal(pedestal(w, { kind: 'artifact', id: 'blood_moon' }, 110, 60));
    expect(p.holdT).toBeGreaterThan(0);
    expect(p.weapon.mem.hideUntil ?? -1).toBeLessThanOrEqual(w.time);
    const wdef = Weapons.must(p.weaponId);
    const r = w.renderer!;
    const custom = wdef as unknown as { draw: (...a: unknown[]) => void };
    if (wdef.draw) {
      const spy = vi.spyOn(custom, 'draw');
      p.draw(r, w);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    } else {
      const spy = vi.spyOn(r, 'sprite');
      p.draw(r, w);
      expect(spy.mock.calls.some((c) => c[0] === wdef.heldSprite)).toBe(true);
      spy.mockRestore();
    }
  });

  it('a new weapon reaches the hand with its flight, as the guard ends', () => {
    const w = setup();
    const p = w.player;
    w.takePedestal(pedestal(w, { kind: 'weapon', id: 'nail_carbine' }));
    expect(p.weaponId).toBe('nail_carbine');
    const until = p.weapon.mem.hideUntil ?? -1;
    expect(until - w.time).toBeCloseTo(FIND_TIMING.weapon.lift + FIND_TIMING.weapon.fly, 6);
    expect(until - w.time).toBeCloseTo(FIND_HOLD, 6);
    // its tag reads 등급 · 계열 · 속성 next to the name, like every weapon card
    const tag = w.banners[w.banners.length - 1];
    expect(tag.weapon).toBe('nail_carbine');
    steps(w, Math.round((FIND_DELAY + 0.3) / FIXED_DT));
    const r = w.renderer!;
    const spy = vi.spyOn(r, 'uiText');
    drawBanners(r, w);
    const texts = spy.mock.calls.map((c) => c[0]);
    spy.mockRestore();
    expect(texts).toContain(tag.title);
    expect(texts).toContain(`${RARITY_NAME[Weapons.must('nail_carbine').rarity]} · `);
    expect(texts).toContain(weaponFamily('nail_carbine')!.name);
  });

  it('the HUD lantern glow follows only the local keeper\'s find and fades', () => {
    const w = setup();
    w.takePedestal(pedestal(w, { kind: 'artifact', id: 'blood_moon' }));
    expect(w.findGlow).toBeNull();
    steps(w, Math.round(0.45 / FIXED_DT));
    expect(w.findGlow?.color).toBe('#ffb340');
    steps(w, Math.round(0.6 / FIXED_DT));
    expect(w.findGlow).toBeNull();
  });

  it('co-op: a teammate\'s find is a small ribbon here, while its flight is seen by everyone', () => {
    const w = setup('ria', 2, 'PICKUP-PRESENT-COOP');
    const [a, b] = w.players;
    expect(w.local).toBe(a);
    const ped = pedestal(w, { kind: 'artifact', id: 'blood_moon' });
    w.player = b;
    w.takePedestal(ped);
    w.player = w.lead();
    const last = w.banners[w.banners.length - 1];
    expect(last.small).toBe(true);
    expect(last.kind).toBeUndefined();
    expect(last.title).toBe(`${b.name} · 핏빛 달`);
    expect(b.holdT).toBeCloseTo(FIND_HOLD, 6);
    expect(a.holdT).toBe(0);
    w.update(FIXED_DT);
    const ds = draws(w);
    expect(ds).toHaveLength(1);
    expect(ds[0].keeper).toBe(b);
    expect(ds[0].local).toBe(false);
    steps(w, Math.round(0.5 / FIXED_DT));
    // the teammate's find does not tint this keeper's lantern
    expect(w.findGlow).toBeNull();
    // the local keeper's own find is the tag
    w.takePedestal(pedestal(w, { kind: 'artifact', id: 'prism_shard' }, 60, 90));
    expect(w.banners[w.banners.length - 1].kind).toBe('find');
  });

  it('the tag waits for the item to land and takes room in the banner stack only once shown', () => {
    const w = setup();
    const r = w.renderer!;
    w.takePedestal(pedestal(w, { kind: 'artifact', id: 'prism_shard' }));
    expect(bannersBottom(r, w)).toBe(0);
    drawBanners(r, w);
    steps(w, Math.round((FIND_DELAY + 0.05) / FIXED_DT));
    const shown = bannersBottom(r, w);
    expect(shown).toBeGreaterThan(58);
    drawBanners(r, w);
    // a ribbon queued after it stacks below
    w.banner('알림', '작은 알림', { small: true });
    expect(bannersBottom(r, w)).toBeGreaterThan(shown);
    steps(w, Math.round((FIND_LIFE + 0.1) / FIXED_DT));
    expect(w.banners.some((b) => b.kind === 'find')).toBe(false);
  });

  it('drawing does not change the simulation (same hash with and without frames)', () => {
    const run = (draw: boolean) => {
      const w = setup('ria', 1, 'PICKUP-HASH');
      w.takePedestal(pedestal(w, { kind: 'artifact', id: 'prism_shard' }));
      w.takePedestal(pedestal(w, { kind: 'weapon', id: 'nail_carbine' }, 110, 60));
      const hashes: number[] = [];
      for (let i = 0; i < 60; i++) {
        w.update(FIXED_DT);
        if (draw) w.draw();
        hashes.push(stateHash(w));
      }
      return hashes;
    };
    expect(run(true)).toEqual(run(false));
  });
});
