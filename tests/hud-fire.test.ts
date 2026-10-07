import { describe, expect, it } from 'vitest';
import { FireGaugeFx, fireGaugeFront, fireGaugeLayout } from '../src/ui/hud-fire';

// The life gauge has no numbers, so its geometry has to carry the count:
// one cell per heart container, widened by soul / wards that reach further.

describe('fire life gauge', () => {
  it('has one cell per heart and a slim frame', () => {
    const L = fireGaugeLayout({ red: 5, maxRed: 6, soul: 0, shields: 0 });
    expect(L.hearts).toBe(3);
    expect(L.inner).toBe(3 * L.cw);
    expect(L.w).toBe(L.inner + 4);
    expect(L.h).toBe(12);
  });

  it('grows for soul and wards beyond the red capacity and narrows cells when long', () => {
    expect(fireGaugeLayout({ red: 4, maxRed: 4, soul: 7, shields: 0 }).hearts).toBe(4);
    expect(fireGaugeLayout({ red: 4, maxRed: 4, soul: 0, shields: 3 }).hearts).toBe(3);
    expect(fireGaugeLayout({ red: 0, maxRed: 0, soul: 0, shields: 0 }).hearts).toBe(1);
    const wide = fireGaugeLayout({ red: 24, maxRed: 24, soul: 0, shields: 0 });
    expect(wide.cw).toBeLessThan(fireGaugeLayout({ red: 6, maxRed: 6, soul: 0, shields: 0 }).cw);
  });

  it('turns losses and gains into short animations that expire', () => {
    const fx = new FireGaugeFx();
    fx.update(6, 2, 2, 0);
    expect(fx.list).toHaveLength(0);
    fx.update(5, 1, 1, .016);
    expect(fx.list.map(f => [f.kind, f.from, f.to])).toEqual([['red', 5, 6], ['soul', 1, 2], ['ward', 1, 2]]);
    fx.update(8, 1, 1, .016);
    expect(fx.list.at(-1)).toMatchObject({ kind: 'gain', from: 5, to: 8 });
    for (let i = 0; i < 60; i++) fx.update(8, 1, 1, .016);
    expect(fx.list).toHaveLength(0);
  });

  it('puts the front of the life where the burning ends', () => {
    const full = fireGaugeFront(0, 0, { red: 6, maxRed: 6, soul: 0, shields: 0 });
    const half = fireGaugeFront(0, 0, { red: 3, maxRed: 6, soul: 0, shields: 0 });
    expect(half.x).toBeLessThan(full.x);
    expect(half.y).toBe(full.y);
  });
});
