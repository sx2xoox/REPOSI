// 등잔대 item stands (game/lamp-stand.ts): every Pedestal is drawn as a lamp stand. The art
// keeps the old pedestal's footprint (item hover height, price row, 26 px pick-one pairs) and
// is presentation only: drawing / lighting it and its cosmetic snuff clock never touch the
// rng or the state hash.
import './headless';
import { describe, expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Floors } from '../src/game/defs';
import { Pedestal } from '../src/game/pickups';
import { stateHash } from '../src/game/statehash';
import { FIXED_DT } from '../src/game/constants';
import { getSprite, hasSprite } from '../src/engine/sprites';
import { LAMP_STAND_BODY, SNUFF_SECONDS, lampStandSprites, lampStandStyle } from '../src/game/lamp-stand';

loadContent();

function setup(): World {
  const run = new RunState('LAMP-STAND', 'ria');
  run.staged = true;
  const w = new World(new Renderer(fakeDisplay(1280, 720)), run, { openInventory() {}, onGameOver() {} });
  w.start();
  for (const e of [...w.enemies]) w.killEnemy(e);
  w.player.x = 70; w.player.y = 120; w.player.god = true;
  w.inputSource = (_w, _p, out) => { out.pressed = 0; out.held = 0; };
  w.update(FIXED_DT);
  return w;
}
const steps = (w: World, n: number) => { for (let i = 0; i < n; i++) w.update(FIXED_DT); };
const rngState = (w: World) => JSON.stringify([w.rng.snapshot(), w.run.rng.snapshot(), w.run.lootRng.snapshot()]);

describe('lamp stand pedestals', () => {
  it('keeps the old footprint: a 16 x 14 body that spans y-2..y+13 around the pedestal', () => {
    expect(LAMP_STAND_BODY).toHaveLength(14);
    for (const row of LAMP_STAND_BODY) expect(row).toHaveLength(16);
    const s = getSprite(lampStandSprites('bronze', 'crypt').body);
    // 1 px outline on every side; the pivot is the pedestal's own (x, y)
    expect([s.w, s.h]).toEqual([18, 16]);
    expect(s.oy).toBe(2);
    // two stands of a pick-one pair (26 px apart) never touch
    expect(s.w).toBeLessThan(26);
  });

  it('every floor theme and both looks compile their sprites', () => {
    const themes = new Set(Floors.all().map((f) => f.theme));
    expect(themes.size).toBeGreaterThan(3);
    for (const theme of themes) for (const style of ['bronze', 'blood'] as const) {
      const set = lampStandSprites(style, theme);
      for (const name of [set.body, set.oil, ...set.flame]) {
        expect(hasSprite(name)).toBe(true);
        expect(getSprite(name).w).toBeGreaterThan(0);
      }
    }
  });

  it('health prices (대가의 방) dress the stand in blood, everything else in bronze', () => {
    expect(lampStandStyle(0)).toBe('bronze');
    expect(lampStandStyle(1)).toBe('blood');
    expect(lampStandStyle(2)).toBe('blood');
  });

  it('drawing and lighting every stand state leaves the rng and the state hash alone', () => {
    const w = setup();
    const lit = w.dropItemPedestal({ kind: 'artifact', id: 'prism_shard' }, 120, 60);
    const priced = w.dropItemPedestal({ kind: 'artifact', id: 'prism_shard' }, 150, 60);
    priced.price = 9;
    const blood = w.dropItemPedestal({ kind: 'weapon', id: 'nail_carbine' }, 180, 60);
    blood.heartPrice = 2;
    const empty = w.dropItemPedestal({ kind: 'artifact', id: 'prism_shard' }, 210, 60);
    steps(w, 2);
    empty.item = null;
    steps(w, 6);
    lit.focusT = 1;
    const hash = stateHash(w);
    const rng = rngState(w);
    const r = w.renderer;
    for (const ped of [lit, priced, blood, empty]) { ped.draw(r, w); ped.light(w); }
    // the snuff clock is cosmetic: not part of the hash
    empty.snuffT = 0.4;
    empty.draw(r, w);
    empty.light(w);
    empty.snuffT = 50;
    expect(stateHash(w)).toBe(hash);
    expect(rngState(w)).toBe(rng);
  });

  it('taking a find snuffs its stand, and a pick-one group goes out together', () => {
    const w = setup();
    const a = w.dropItemPedestal({ kind: 'artifact', id: 'prism_shard' }, 120, 60);
    const b = w.dropItemPedestal({ kind: 'artifact', id: 'whetstone_chip' }, 146, 60);
    a.group = b.group = 77;
    steps(w, 3);
    expect(a.snuffT).toBe(0);
    expect(b.snuffT).toBe(0);
    w.takePedestal(a);
    steps(w, 6);
    for (const ped of [a, b]) {
      expect(ped.item).toBeNull();
      expect(ped.snuffT).toBeGreaterThan(0);
      expect(ped.snuffT).toBeLessThan(SNUFF_SECONDS);
    }
    steps(w, Math.ceil(SNUFF_SECONDS / FIXED_DT));
    expect(a.snuffT).toBeGreaterThan(SNUFF_SECONDS);
    // a stand created empty (e.g. a shared-room copy of a taken one) does not smoke
    expect(new Pedestal(0, 0, null).snuffT).toBeGreaterThan(SNUFF_SECONDS);
  });
});
