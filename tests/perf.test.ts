// Performance guards: frame pacing on high-refresh displays (fixed 60 Hz steps,
// interpolated drawing up to the frame-rate cap), the hit-stop chain
// guard (a stream of release hits must not freeze the game most of the time),
// blend-mode batching of particles, and release assets defined up front (so the
// boot warm-up compiles them instead of the first 등불 해방).

import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { FramePacer, capDivisor, snapDelta } from '../src/engine/pacing';
import { effectiveMaxFps } from '../src/engine/save';
import { Particles } from '../src/engine/particles';
import { hasSprite } from '../src/engine/sprites';
import { World, HITSTOP_GAP } from '../src/game/world';
import { SMEAR_FRAMES } from '../src/game/melee';
import { FIXED_DT } from '../src/game/constants';
import type { Renderer } from '../src/engine/renderer';

loadContent();

/** rAF timestamps (ms) of a display at `hz` with +-`jitter` ms noise (deterministic). */
function stamps(hz: number, frames: number, jitter: number): number[] {
  const out: number[] = [];
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < frames; i++) out.push(1000 + (i * 1000) / hz + rnd() * jitter);
  return out;
}

function run(hz: number, frames: number, jitter: number): number[] {
  const p = new FramePacer(FIXED_DT);
  const ts = stamps(hz, frames, jitter);
  p.reset(ts[0] - 1000 / hz);
  return ts.map((t) => p.advance(t));
}

describe('frame pacing', () => {
  it('runs exactly one step per frame at 60 Hz despite timestamp jitter', () => {
    const steps = run(60, 600, 0.4);
    expect(steps.every((n) => n === 1)).toBe(true);
  });

  it('alternates 0/1 steps at 120 Hz (steady 60 fps redraws, no double steps)', () => {
    const steps = run(120, 1200, 0.3);
    expect(steps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(599);
    expect(Math.max(...steps)).toBe(1);
    for (let i = 1; i < steps.length; i++) expect(steps[i] + steps[i - 1]).toBe(1);
  });

  it('keeps the simulation clock on real time (no drift from snapping)', () => {
    const p = new FramePacer(FIXED_DT);
    p.reset(0);
    let t = 0;
    let steps = 0;
    for (let i = 0; i < 1200; i++) steps += p.advance((t += 1000 / 119.88)); // a slightly slow "120 Hz" panel
    expect(Math.abs(steps * FIXED_DT + p.acc - t / 1000)).toBeLessThan(0.003);
  });

  it('keeps 60 steps/s and never doubles up at 144 Hz', () => {
    const steps = run(144, 1440, 0.2);
    const total = steps.reduce((a, b) => a + b, 0);
    expect(Math.abs(total - 600)).toBeLessThanOrEqual(1);
    expect(Math.max(...steps)).toBe(1);
  });

  it('snaps only near whole refresh intervals and clamps long stalls', () => {
    expect(snapDelta(0.00841)).toBeCloseTo(1 / 120, 9);
    expect(snapDelta(0.0166)).toBeCloseTo(1 / 60, 9);
    expect(snapDelta(0.0251)).toBeCloseTo(3 / 120, 9);
    expect(snapDelta(0.0192)).toBe(0.0192);
    const p = new FramePacer(FIXED_DT);
    p.reset(0);
    expect(p.advance(5000)).toBe(5); // hidden tab: capped, backlog dropped
    expect(p.acc).toBe(0);
  });
});

/** Drive `tick()` on a display at `hz` (+-jitter ms) with frame cap `cap`: steps, draws, alphas per frame. */
function ticks(hz: number, frames: number, jitter: number, cap: number) {
  const p = new FramePacer(FIXED_DT);
  p.maxFps = cap;
  const ts = stamps(hz, frames, jitter);
  p.reset(ts[0] - 1000 / hz);
  const steps: number[] = [];
  const draws: boolean[] = [];
  const alphas: number[] = [];
  for (const t of ts) {
    steps.push(p.tick(t));
    draws.push(p.draw);
    alphas.push(p.alpha);
  }
  return { p, steps, draws, alphas };
}

describe('frame pacing: interpolated drawing and the frame-rate cap', () => {
  it('120 Hz at cap 120: draws every frame, evenly spaced in simulation time', () => {
    const { steps, draws, alphas } = ticks(120, 1200, 0.3, 120);
    const skip = 20; // refresh-rate estimate settling
    expect(draws.slice(skip).every(Boolean)).toBe(true);
    expect(Math.max(...steps)).toBe(1);
    // drawn time = steps so far + alpha: advances half a step every frame
    let total = 0;
    const drawnAt: number[] = [];
    steps.forEach((n, i) => {
      total += n;
      drawnAt.push(total - 1 + alphas[i]);
    });
    for (let i = skip + 1; i < drawnAt.length; i++) expect(drawnAt[i] - drawnAt[i - 1]).toBeCloseTo(0.5, 1);
    expect(alphas.every((a) => a >= 0 && a <= 1)).toBe(true);
  });

  it('60 Hz display (cap 120 or 60): classic behaviour, draw after each step with the latest state', () => {
    for (const cap of [120, 60, 0]) {
      const { steps, draws, alphas } = ticks(60, 600, 0.4, cap);
      expect(steps.every((n) => n === 1)).toBe(true);
      expect(draws.every(Boolean)).toBe(true);
      expect(alphas.slice(2).every((a) => a === 1)).toBe(true);
    }
  });

  it('cap 60 on a 120 Hz display draws only the frames in which a step ran (as before)', () => {
    const { steps, draws, alphas } = ticks(120, 1200, 0.3, 60);
    for (let i = 1; i < steps.length; i++) expect(draws[i]).toBe(steps[i] > 0);
    expect(alphas.every((a) => a === 1)).toBe(true);
  });

  it('caps with an even rhythm: 240 Hz at 120 draws every other refresh, 144 Hz at 120 draws at 72', () => {
    const fps = (hz: number, cap: number) => {
      const { draws } = ticks(hz, hz * 10, 0.2, cap);
      const d = draws.slice(hz); // after a second
      for (let i = 2; i < d.length; i++) expect(d[i] || d[i - 1]).toBe(true); // never two skips in a row
      return d.filter(Boolean).length / 9;
    };
    expect(fps(240, 120)).toBeCloseTo(120, -1);
    expect(fps(240, 0)).toBeCloseTo(240, -1);
    expect(fps(144, 120)).toBeCloseTo(72, -1);
    expect(fps(144, 0)).toBeCloseTo(144, -1);
    expect(fps(120, 120)).toBeCloseTo(120, -1);
    expect(fps(90, 120)).toBeCloseTo(90, -1);
  });

  it('the simulation runs exactly 60 steps/s whatever the display rate and cap', () => {
    for (const hz of [60, 90, 120, 144, 240]) {
      for (const cap of [60, 120, 0]) {
        const { steps } = ticks(hz, hz * 10, 0.2, cap);
        expect(Math.abs(steps.reduce((a, b) => a + b, 0) - 600)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('a dropped frame keeps the refresh estimate; a display that really slows down is followed', () => {
    const p = new FramePacer(FIXED_DT);
    p.maxFps = 120;
    p.reset(0);
    let t = 0;
    for (let i = 0; i < 60; i++) p.tick((t += 1000 / 120));
    expect(p.refresh).toBeCloseTo(1 / 120, 4);
    p.tick((t += 2000 / 120)); // one dropped frame
    expect(p.refresh).toBeCloseTo(1 / 120, 4);
    expect(p.interpolating).toBe(true);
    for (let i = 0; i < 40; i++) p.tick((t += 1000 / 60)); // throttled to 60 Hz
    expect(p.refresh).toBeCloseTo(1 / 60, 4);
    expect(p.interpolating).toBe(false);
    for (let i = 0; i < 3; i++) p.tick((t += 1000 / 120)); // back to 120 Hz at once
    expect(p.interpolating).toBe(true);
  });

  it('capDivisor tolerates panels slightly faster than nominal', () => {
    expect(capDivisor(1 / 120.4, 120)).toBe(1);
    expect(capDivisor(1 / 240, 120)).toBe(2);
    expect(capDivisor(1 / 360, 120)).toBe(3);
    expect(capDivisor(1 / 144, 0)).toBe(1);
  });

  it('effective frame cap: chosen value, else 120 (60 at graphics quality 낮음)', () => {
    expect(effectiveMaxFps({ graphicsQuality: 'high' })).toBe(120);
    expect(effectiveMaxFps({ graphicsQuality: 'low' })).toBe(60);
    expect(effectiveMaxFps({ graphicsQuality: 'low', maxFps: 120 })).toBe(120);
    expect(effectiveMaxFps({ graphicsQuality: 'high', maxFps: 0 })).toBe(0);
  });
});

describe('hit-stop chain guard', () => {
  type HS = { hitstopT: number; hitstopGap: number; hitstop(t: number, fromHit?: boolean): void };
  const fake = (): HS => {
    const o = { hitstopT: 0, hitstopGap: 0 } as HS;
    o.hitstop = (World.prototype as unknown as HS).hitstop.bind(o);
    return o;
  };

  it('ignores per-hit stops while recovering from the previous one, never explicit ones', () => {
    const w = fake();
    w.hitstop(0.02, true);
    expect(w.hitstopT).toBeCloseTo(0.02);
    w.hitstopT = 0;
    w.hitstopGap = HITSTOP_GAP;
    w.hitstop(0.03, true);
    expect(w.hitstopT).toBe(0);
    w.hitstop(0.08); // player hurt / finisher
    expect(w.hitstopT).toBeCloseTo(0.08);
  });

  it('limits a release volley (a hit every frame) to a small frozen fraction', () => {
    const w = fake();
    const dt = FIXED_DT;
    let frozen = 0;
    const steps = 180;
    for (let i = 0; i < steps; i++) {
      // the update's hit-stop handling (World.update)
      if (w.hitstopT > 0) {
        w.hitstopT -= dt;
        if (w.hitstopT <= 0) w.hitstopGap = HITSTOP_GAP;
        frozen++;
        continue;
      }
      if (w.hitstopGap > 0) w.hitstopGap -= dt;
      w.hitstop(0.02, true); // a release bolt lands every frame
    }
    expect(frozen / steps).toBeLessThan(0.15);
  });
});

describe('particle blend batching', () => {
  it('switches the blend mode once per layer, not per interleaved particle', () => {
    const ps = new Particles();
    for (let i = 0; i < 200; i++) ps.spawn({ x: 50 + i, y: 50, life: 1, colors: ['#ffffff', '#ff8040'], additive: i % 2 === 0 });
    let switches = 0;
    let gco = 'source-over';
    let fills = 0;
    const ctx = {
      set globalCompositeOperation(v: string) { if (v !== gco) switches++; gco = v; },
      get globalCompositeOperation() { return gco; },
      globalAlpha: 1,
      fillStyle: '',
      fillRect: () => { fills++; },
    };
    const r = { ctx, viewX: 0, viewY: 0 } as unknown as Renderer;
    ps.draw(r, false);
    expect(fills).toBe(200);
    expect(switches).toBeLessThanOrEqual(2);
  });
});

describe('release assets are defined at load (compiled by the boot warm-up)', () => {
  it('bloom bolts, petals, halo, sword waves and whirlwind smears exist before any release', () => {
    expect(hasSprite('__orb_7_#ffd078_#1a0d14')).toBe(true);
    expect(hasSprite('__glow_7_#ffd078')).toBe(true);
    expect(hasSprite('__glow_34_#ffb040')).toBe(true);
    expect(hasSprite('__wave_#ffe2a0')).toBe(true);
    for (let f = 0; f < SMEAR_FRAMES; f++) expect(hasSprite(`__smear_44_6.2_#cfe0ff_${f}`)).toBe(true);
  });
});
