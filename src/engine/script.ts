// Generator-based scripting for enemy AI, boss patterns and timed effects.
//
//   function* bat(e: Enemy, w: World): Script {
//     while (true) {
//       yield 0.6;                 // wait 0.6 seconds
//       e.shootAt(w.player, ...);
//       yield;                     // wait a single frame
//       yield* untilScript(() => e.hp < 50);
//     }
//   }
//
// `yield n` waits n seconds, `yield` (undefined) waits one update.

export type Script = Generator<number | undefined | void, void, unknown>;

export class ScriptRunner {
  private gen: Script | null;
  private wait = 0;
  done = false;
  /** generator resumptions so far (script progress, for state hashes) */
  steps = 0;

  constructor(gen: Script | null) {
    this.gen = gen;
    this.done = !gen;
  }

  /** Advance the script. Returns false once it has finished. */
  update(dt: number): boolean {
    if (this.done || !this.gen) return false;
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait > 0) return true;
    }
    // Run until the script yields a wait (guard against runaway loops)
    for (let guard = 0; guard < 64; guard++) {
      this.steps++;
      const r = this.gen.next();
      if (r.done) {
        this.done = true;
        return false;
      }
      const v = r.value;
      if (typeof v === 'number' && v > 0) {
        this.wait += v;
        return true;
      }
      // undefined / 0 => wait one frame
      return true;
    }
    return true;
  }

  /** Seconds left in the current `yield n` wait. */
  get waiting(): number {
    return this.wait;
  }

  /** Replace the running script (e.g. boss phase change). */
  set(gen: Script | null): void {
    this.gen = gen;
    this.wait = 0;
    this.done = !gen;
  }

  stop(): void {
    this.gen = null;
    this.done = true;
  }
}

/** Wait until `cond()` is true (checked every frame). */
export function* until(cond: () => boolean): Script {
  while (!cond()) yield;
}

/** Wait `t` seconds while calling `each(dt-progress 0..1)` every frame. */
export function* during(t: number, each: (progress: number) => void, getDt: () => number): Script {
  let el = 0;
  while (el < t) {
    each(Math.min(1, el / t));
    yield;
    el += getDt();
  }
  each(1);
}
