// Interpolated rendering between fixed 60 Hz simulation steps (game/interp.ts,
// World.draw): drawn positions are lerped, the simulation's own values are
// restored bit-exactly, big jumps snap, and a frozen (paused / hit-stop) world
// never drifts. Also the particle pool's previous positions.

import { describe, expect, it } from 'vitest';
import { Entity } from '../src/game/entity';
import { Interpolator, SNAP_DIST } from '../src/game/interp';
import { Particles } from '../src/engine/particles';
import { World } from '../src/game/world';
import type { Renderer } from '../src/engine/renderer';

class Dot extends Entity {}

function dot(x: number, y: number, z = 0): Dot {
  const e = new Dot();
  e.x = x;
  e.y = y;
  e.z = z;
  return e;
}

/** awkward doubles: rounding-error sums, -0, tiny and huge magnitudes */
const NASTY = [0.1 + 0.2, -0, 1e-12, 123456.789012345, -7.000000000000001, Math.PI * 1e5, 5e-324, 2 ** 52 + 0.5];

describe('interpolation (game/interp.ts)', () => {
  it('draws at prev + (cur - prev) * alpha and restores the exact simulated values', () => {
    const ip = new Interpolator();
    const es = NASTY.map((v, i) => dot(v, -v, i % 2 ? v : 0));
    ip.save(es, null, null);
    // one simulation step of movement (sub-pixel, odd amounts)
    const moved = es.map((e, i) => {
      e.x += 0.3 + i * 1.7;
      e.y -= 0.1 * i;
      e.z += i % 3 ? 0.7 : 0;
      return [e.x, e.y, e.z];
    });
    for (const a of [0, 0.03, 0.25, 0.5, 0.97, 0.999]) {
      ip.begin(a, es, null, null, 1 / 60);
      es.forEach((e, i) => {
        expect(e.x).toBeCloseTo(e.px + (moved[i][0] - e.px) * a, 6);
        expect(e.y).toBeCloseTo(e.py + (moved[i][1] - e.py) * a, 6);
      });
      ip.end();
      es.forEach((e, i) => {
        expect(Object.is(e.x, moved[i][0])).toBe(true);
        expect(Object.is(e.y, moved[i][1])).toBe(true);
        expect(Object.is(e.z, moved[i][2])).toBe(true);
      });
    }
  });

  it('restores -0 and every position exactly over many random steps and frames', () => {
    const ip = new Interpolator();
    let s = 99;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const es = Array.from({ length: 200 }, () => dot(rnd() * 400, rnd() * 300));
    es[0].x = -0;
    for (let step = 0; step < 120; step++) {
      ip.save(es, null, null);
      for (const e of es) {
        e.x += (rnd() - 0.5) * (rnd() < 0.05 ? 200 : 6); // occasional teleport
        e.y += (rnd() - 0.5) * 6;
      }
      const snap = es.map((e) => [e.x, e.y, e.z]);
      for (let f = 0; f < 2; f++) {
        ip.begin(rnd(), es, null, null, 1 / 60);
        ip.end();
      }
      es.forEach((e, i) => {
        expect(Object.is(e.x, snap[i][0])).toBe(true);
        expect(Object.is(e.y, snap[i][1])).toBe(true);
        expect(Object.is(e.z, snap[i][2])).toBe(true);
      });
    }
  });

  it('snaps big jumps (teleports, room changes) instead of sliding', () => {
    const ip = new Interpolator();
    const e = dot(10, 10);
    ip.save([e], null, null);
    e.x = 10 + SNAP_DIST + 1;
    ip.begin(0.5, [e], null, null, 1 / 60);
    expect(e.x).toBe(10 + SNAP_DIST + 1);
    ip.end();
    // a normal move interpolates
    ip.save([e], null, null);
    e.x += 4;
    ip.begin(0.5, [e], null, null, 1 / 60);
    expect(e.x).toBeCloseTo(10 + SNAP_DIST + 1 + 2, 9);
    ip.end();
  });

  it('a frozen world (paused, hit-stop) never drifts: prev == cur draws the same at any alpha', () => {
    const ip = new Interpolator();
    const e = dot(50, 60);
    const cam = { camX: 12, camY: 7 };
    ip.save([e], null, cam);
    e.x += 3;
    cam.camX += 2;
    // the next steps are frozen: World.update still records prev first
    ip.save([e], null, cam);
    for (const a of [0, 0.3, 0.5, 0.9]) {
      ip.begin(a, [e], null, cam, 1 / 60);
      expect(e.x).toBe(53);
      expect(cam.camX).toBe(14);
      ip.end();
    }
  });

  it('a newborn entity continues its velocity backwards (no pop ahead of the muzzle)', () => {
    const ip = new Interpolator();
    const e = dot(100, 100);
    e.vx = 300;
    ip.begin(0.5, [e], null, null, 1 / 60);
    expect(e.x).toBeCloseTo(100 - 300 / 60 / 2, 9);
    ip.end();
    expect(e.x).toBe(100);
  });

  it('interpolates and restores the camera', () => {
    const ip = new Interpolator();
    const cam = { camX: 0.1 + 0.2, camY: -0 };
    ip.save([], null, cam);
    cam.camX = 10.3;
    cam.camY = 4;
    ip.begin(0.25, [], null, cam, 1 / 60);
    expect(cam.camX).toBeCloseTo(0.3 + 10 * 0.25, 9);
    expect(cam.camY).toBeCloseTo(1, 9);
    ip.end();
    expect(cam.camX).toBe(10.3);
    expect(cam.camY).toBe(4);
  });
});

describe('particle interpolation', () => {
  const fakeR = () => {
    const rects: [number, number][] = [];
    const ctx = { globalCompositeOperation: 'source-over', globalAlpha: 1, fillStyle: '', fillRect: (x: number, y: number) => rects.push([x, y]) };
    return { r: { ctx, viewX: 0, viewY: 0 } as unknown as Renderer, rects };
  };

  it('draws lerped positions, hides particles born in the latest step, and keeps the pool positions exact', () => {
    const ps = new Particles();
    ps.spawn({ x: 100, y: 50, vx: 600, life: 5, colors: ['#ffffff'], fade: false });
    ps.savePrev();
    ps.update(1 / 60); // moves 10 px
    ps.spawn({ x: 20, y: 20, life: 5, colors: ['#ffffff'], fade: false }); // fresh
    const before = ps.list.map((p) => [p.x, p.y]);
    ps.alpha = 0.5;
    const { r, rects } = fakeR();
    ps.draw(r, false);
    expect(rects.length).toBe(1);
    expect(rects[0][0]).toBe(Math.round(105 - 0.5));
    ps.alpha = 1;
    rects.length = 0;
    ps.draw(r, false);
    expect(rects.length).toBe(2);
    expect(ps.list.map((p) => [p.x, p.y])).toEqual(before);
  });
});

describe('World.draw interpolation', () => {
  /** a World without DOM: only the fields draw() / savePrev() touch */
  function fakeWorld() {
    const w = Object.create(World.prototype) as World & Record<string, unknown>;
    const r = { camX: 0, camY: 0, simStep: 0, alpha: 1 };
    const node = {};
    Object.assign(w, {
      renderer: r, entities: [dot(10, 10)], particles: new Particles(), node, transition: null, dt: 1 / 60,
      interp: new Interpolator(), prevNode: null, prevStep: -1,
    });
    return { w, r };
  }

  it('uses the frame alpha only when stepped in the latest step, and restores even if drawing throws', () => {
    const { w, r } = fakeWorld();
    const e = (w.entities as Entity[])[0];
    let drawnX = NaN;
    (w as unknown as { drawFrame: () => void }).drawFrame = () => {
      drawnX = e.x;
      throw new Error('boom');
    };
    r.simStep = 1;
    w.savePrev();
    e.x = 14;
    r.alpha = 0.5;
    expect(() => w.draw()).toThrow('boom');
    expect(drawnX).toBeCloseTo(12, 9);
    expect(e.x).toBe(14);
    // a covered / paused world (no update in the latest step) draws as is
    r.simStep = 2;
    expect(() => w.draw()).toThrow('boom');
    expect(drawnX).toBe(14);
    expect(e.x).toBe(14);
  });
});
