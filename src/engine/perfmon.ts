// Optional per-frame timing recorder used by the perf harness (scripts/perf.mjs,
// exposed as `window.__lkPerf`). Off by default: the main loop only reads `on`.
// Records, per rendered frame: the gap since the previous frame, the CPU time
// of the simulation steps run in it (and how many), the draw time (JS side),
// an optional forced raster flush, and the JS heap size (Chrome with
// --enable-precise-memory-info) to estimate allocation rate and GC.

export class PerfMon {
  on = false;
  /** force a raster flush after each draw (1px readback) and time it separately */
  flush = false;
  n = 0;
  cap = 0;
  gap = new Float32Array(0);
  upd = new Float32Array(0);
  drw = new Float32Array(0);
  fls = new Float32Array(0);
  steps = new Uint8Array(0);
  heap = new Float64Array(0);

  /** Start recording (buffers are reused when `cap` is unchanged: call once early to pre-allocate). */
  start(cap = 30000, flush = false): void {
    if (cap !== this.cap) {
      this.cap = cap;
      this.gap = new Float32Array(cap);
      this.upd = new Float32Array(cap);
      this.drw = new Float32Array(cap);
      this.fls = new Float32Array(cap);
      this.steps = new Uint8Array(cap);
      this.heap = new Float64Array(cap);
    }
    this.n = 0;
    this.pendUpd = 0;
    this.pendSteps = 0;
    this.flush = flush;
    this.on = true;
  }

  stop(): { gap: number[]; upd: number[]; drw: number[]; fls: number[]; steps: number[]; heap: number[] } {
    this.on = false;
    const n = this.n;
    return {
      gap: Array.from(this.gap.subarray(0, n)),
      upd: Array.from(this.upd.subarray(0, n)),
      drw: Array.from(this.drw.subarray(0, n)),
      fls: Array.from(this.fls.subarray(0, n)),
      steps: Array.from(this.steps.subarray(0, n)),
      heap: Array.from(this.heap.subarray(0, n)),
    };
  }

  private pendUpd = 0;
  private pendSteps = 0;

  /** Steps run in a frame that was not drawn (frame-rate cap): counted with the next drawn frame. */
  addUpdate(upd: number, steps: number): void {
    this.pendUpd += upd;
    this.pendSteps += steps;
  }

  record(gap: number, upd: number, drw: number, fls: number, steps: number): void {
    const i = this.n;
    if (i >= this.cap) return;
    this.gap[i] = gap;
    this.upd[i] = upd + this.pendUpd;
    this.drw[i] = drw;
    this.fls[i] = fls;
    this.steps[i] = steps + this.pendSteps;
    this.pendUpd = 0;
    this.pendSteps = 0;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    this.heap[i] = mem ? mem.usedJSHeapSize : 0;
    this.n = i + 1;
  }
}

export const perfmon = new PerfMon();
