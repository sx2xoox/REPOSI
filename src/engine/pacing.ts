// Frame pacing for a fixed-timestep simulation driven by requestAnimationFrame.
//
// The game simulates at a fixed rate (60 Hz) while displays refresh at 60, 90,
// 120 (ProMotion), 144 Hz ... Two things keep motion smooth:
//  - rAF timestamps jitter by a fraction of a millisecond; added raw to the
//    accumulator, that jitter makes a 120 Hz display run 0,1,1,0,2 steps per
//    frame instead of a steady 0,1,0,1 (visible judder). Deltas within a small
//    tolerance of a whole number of common refresh intervals are snapped to it.
//  - a frame in which no step ran shows exactly the same game state, so it is
//    not redrawn (`advance()` returns 0): 120 Hz screens draw a steady 60 fps
//    instead of drawing every state twice.
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

/** Snap a frame delta (s) to a whole multiple (1..3) of a common refresh interval when it is that close. */
export function snapDelta(delta: number): number {
  for (const r of REFRESH) {
    const k = Math.round(delta / r);
    if (k >= 1 && k <= 3 && Math.abs(delta - k * r) < SNAP_EPS) return k * r;
  }
  return delta;
}

export class FramePacer {
  /** simulated-but-not-yet-stepped time (s) */
  acc = 0;
  private last = -1;
  /** real time not yet given to the accumulator because of snapping (s) */
  private dev = 0;

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
  }

  /** Frame delta (s) for the rAF timestamp `now` (ms), clamped and snapped. */
  delta(now: number): number {
    if (this.last < 0) this.last = now;
    let d = (now - this.last) / 1000;
    this.last = now;
    if (!(d > 0)) return 0;
    if (d > this.maxDelta) d = this.maxDelta;
    const s = snapDelta(d);
    // hand the snapped-away jitter back slowly: per-frame deltas stay steady,
    // yet the simulation clock never drifts from real time
    this.dev += d - s;
    const b = this.dev > BLEED ? BLEED : this.dev < -BLEED ? -BLEED : this.dev;
    this.dev -= b;
    return s + b;
  }

  /** Fixed steps to run for a frame of `delta` seconds (0 = nothing changed, skip the redraw). */
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

  /** delta(now) + steps(delta) */
  advance(now: number): number {
    return this.steps(this.delta(now));
  }
}
