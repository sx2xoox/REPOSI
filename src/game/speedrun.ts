// Speedrun mode (user 2026-10-08): the normal run structure (floors 1-7, three stages each,
// blessings, the floor-7 finale), started from the town's central lantern, with an in-game
// clock and one split per floor boss.
//
// Timing is pure simulation state: an integer tick counter that advances exactly where
// `run.stats.timeSec` does (World.step, after the transition / pause / hit-stop returns), so
// menus, room slides, stage fades and the hit-stop setting never change a time. Recording
// (local ranking, online submit, dates, nicknames) happens on the UI side (GameScene) through
// the optional WorldHost.onBossSplit callback; nothing here reads storage or wall-clock time.
//
// Ranking of floor N = the clear time of floors 1..N (`splitTicks`, from the start of floor 1
// to floor N's boss death). `bossTicks` (entering the boss room -> its death) is shown in the
// per-floor breakdown.

import { FIXED_DT } from './constants';

export const TICKS_PER_SEC = Math.round(1 / FIXED_DT);

export interface BossSplit {
  floor: number;
  bossId: string;
  /** ticks from the start of floor 1 to this boss's death */
  splitTicks: number;
  /** ticks from the boss spawning (entering its room) to its death */
  bossTicks: number;
}

export class SpeedrunRun {
  /** in-game ticks since the run started (1/60 s each) */
  ticks = 0;
  /** tick at which the current floor's boss spawned (-1: not in a boss fight yet) */
  bossStartTick = -1;
  bossId = '';
  /** one per floor, in order */
  splits: BossSplit[] = [];
  /**
   * Why this run no longer counts (debug console, god mode ...); set from outside the
   * simulation and never hashed. Splits recorded before the taint stay valid.
   */
  taint: string | null = null;

  has(floor: number): boolean {
    return this.splits.some((s) => s.floor === floor);
  }
}

export function ticksToMs(ticks: number): number {
  return Math.round((ticks * 1000) / TICKS_PER_SEC);
}

/** Mark a speedrun as no longer eligible for the ranking (no-op for other runs). */
export function taintSpeedrun(run: { speedrun: SpeedrunRun | null } | null | undefined, reason: string): void {
  if (run?.speedrun && !run.speedrun.taint) run.speedrun.taint = reason;
}
