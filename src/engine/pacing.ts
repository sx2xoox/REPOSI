// Frame pacing for a fixed-timestep simulation driven by requestAnimationFrame.
//
// The game simulates at a fixed rate (60 Hz, exactly 1/60 s per step: the
// online lockstep mode depends on it) while displays refresh at 60, 90, 120
// (ProMotion), 144 Hz ... The pacer decides, per rAF frame, how many fixed
// steps to run and whether / how to draw:
//  - rAF timestamps jitter by a fraction of a millisecond; added raw to the
//    accumulator, that jitter makes a 120 Hz display run 0,1,1,0,2 steps per
//    frame instead of a steady 0,1,0,1 (visible judder). Deltas within a small
//    tolerance of a whole number of common refresh intervals are snapped to it.
//  - on displays faster (or slower) than the simulation, every frame is drawn
//    with the world interpolated between the last two steps
//    (`alpha` = fraction of a step elapsed since the latest one), so a 120 Hz
//    screen shows 120 distinct, evenly spaced images.
//  - the frame-rate cap (`maxFps`: 60 / 120 / 0 = display max) skips frames
//    in an even pattern (every k-th refresh, never 5-of-6): a 240 Hz display
//    capped at 120 draws every other refresh.
//  - at cap 60, or on a display running at the simulation rate, only frames in
//    which a step ran are drawn, with the latest state (`alpha` = 1, no added
//    latency) — exactly the classic fixed-step behaviour.
// Pure logic (no DOM) so it is unit-tested.

/** common display refresh intervals (s) that deltas snap to */
const REFRESH = [1 / 60, 1 / 120, 1 / 144, 1 / 90, 1 / 100, 1 / 165, 1 / 240];
/** snapping tolerance (s): vsync-aligned rAF jitter is well below this, real hitches far above */
const SNAP_EPS = 0.0005;
/**
 * A step may run this much early (s; the accumulator goes slightly negative):
 * absorbs timestamp jitter that was not snapped, so a 60 Hz display never
 * alternates 0 and 2 steps around the threshold.
 */
const SLOP = 0.002;
/** real time removed by snapping is handed back at most this fast (s per frame), keeping the clock anchored */
const BLEED = 0.0002;
/** a display refresh within this fraction of the step counts as "running at the simulation rate" */
const SAME_RATE = 0.08;
/** consecutive long frames before a lower refresh rate is believed (vs. dropped frames) */
const SLOW_FRAMES = 20;

/** Snap a frame delta (s) to a whole multiple (1..3) of a common refresh interval when it is that close. */
export function snapDelta(delta: number): number {
  for (const r of REFRESH) {
    const k = Math.round(delta / r);
    if (k >= 1 && k <= 3 && Math.abs(delta - k * r) < SNAP_EPS) return k * r;
  }
  return delta;
}

/**
 * Draw every `k`-th refresh so the frame rate stays at or below `maxFps`
 * (0 = no cap) with an even rhythm. `refresh` is the display interval (s).
 */
export function capDivisor(refresh: number, maxFps: number): number {
  if (!(maxFps > 0) || !(refresh > 0)) return 1;
  // 3% tolerance: a "120 Hz" panel that reports 120.4 Hz still draws every frame at cap 120
  return Math.max(1, Math.ceil((1 / maxFps) * 0.97 / refresh));
}

export class FramePacer {
  /** simulated-but-not-yet-stepped time (s) */
  acc = 0;
  /** frame-rate cap: 60, 120 ... or 0 = draw at the display's rate */
  maxFps = 0;
  /** estimated display refresh interval (s), 0 = unknown yet */
  refresh = 0;
  /** result of the latest `tick()`: draw this frame? */
  draw = true;
  /** result of the latest `tick()`: interpolation factor for drawing (0..1, 1 = latest state) */
  alpha = 1;
  private last = -1;
  /** real time not yet given to the accumulator because of snapping (s) */
  private dev = 0;
  /** rAF time (ms) of the last drawn frame */
  private lastDraw = -1;
  private slowRun = 0;

  constructor(
    readonly step: number,
    /** steps per frame before the backlog is dropped (spiral-of-death guard) */
    readonly maxSteps = 5,
    /** longest delta accepted (s): a hidden tab must not fast-forward */
    readonly maxDelta = 0.25,
  ) {}

  /** Restart timing at `now` (ms), e.g. the moment the loop starts. */
  reset(now: number): void {
    this.last = now;
    this.acc = 0;
    this.dev = 0;
    this.lastDraw = -1;
  }

  /** Frame delta (s) for the rAF timestamp `now` (ms), clamped and snapped. */
  delta(now: number): number {
    if (this.last < 0) this.last = now;
    let d = (now - this.last) / 1000;
    this.last = now;
    if (!(d > 0)) return 0;
    if (d > this.maxDelta) d = this.maxDelta;
    const s = snapDelta(d);
    this.observe(s);
    // hand the snapped-away jitter back slowly: per-frame deltas stay steady,
    // yet the simulation clock never drifts from real time
    this.dev += d - s;
    const b = this.dev > BLEED ? BLEED : this.dev < -BLEED ? -BLEED : this.dev;
    this.dev -= b;
    return s + b;
  }

  /** Track the display refresh interval from (snapped) frame deltas, ignoring dropped frames. */
  private observe(d: number): void {
    const r = this.refresh;
    if (!r || d < r * 0.75) {
      // first sample, or the display got faster (ProMotion ramping up, moved to a faster screen)
      this.refresh = d;
      this.slowRun = 0;
    } else if (d < r * 1.5) {
      this.refresh = r + (d - r) * 0.1;
      this.slowRun = 0;
    } else if (++this.slowRun >= SLOW_FRAMES) {
      // consistently slower: the display (or the browser's rAF rate) really dropped
      this.refresh = d;
      this.slowRun = 0;
    }
  }

  /** Fixed steps to run for a frame of `delta` seconds. */
  steps(delta: number): number {
    this.acc += delta;
    let n = 0;
    while (this.acc >= this.step - SLOP && n < this.maxSteps) {
      this.acc -= this.step;
      n++;
    }
    if (n >= this.maxSteps) this.acc = 0;
    return n;
  }

  /**
   * True when frames are drawn interpolated at the display rate; false at cap
   * 60 or on a display running at the simulation rate (draw after each step).
   */
  get interpolating(): boolean {
    if (this.maxFps > 0 && this.maxFps <= 1 / this.step + 0.5) return false;
    const r = this.refresh;
    return !(r > 0 && Math.abs(r - this.step) < this.step * SAME_RATE);
  }

  /**
   * One rAF frame at time `now` (ms): returns the number of fixed steps to run
   * and sets `draw` (draw this frame?) and `alpha` (interpolation factor).
   */
  tick(now: number): number {
    const n = this.steps(this.delta(now));
    if (!this.interpolating) {
      // classic: a frame without a step shows exactly the same state; skip it
      this.draw = n > 0 || this.lastDraw < 0;
      this.alpha = 1;
    } else {
      const k = capDivisor(this.refresh, this.maxFps);
      // half a refresh of tolerance: never skips two frames in a row for jitter
      this.draw = k <= 1 || this.lastDraw < 0 || now - this.lastDraw >= (k - 0.5) * this.refresh * 1000;
      // acc is in [-SLOP, step - SLOP) after stepping: shifted into [0, 1) so it
      // never extrapolates and consecutive frames stay evenly spaced
      const a = (this.acc + SLOP) / this.step;
      this.alpha = a < 0 ? 0 : a > 1 ? 1 : a;
    }
    if (this.draw) this.lastDraw = now;
    return n;
  }

  /** delta(now) + steps(delta) (no draw decision) */
  advance(now: number): number {
    return this.steps(this.delta(now));
  }
}
