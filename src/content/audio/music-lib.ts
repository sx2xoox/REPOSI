// Shared helpers for the track definitions in this folder (no tracks here).

import type { BarContext } from '../../audio/song';

/** A single hit on the first step of an n-bar grid (crashes, swells...). */
export function once(bars: number, sym = 'x', steps = 16): string {
  return sym + '.'.repeat(bars * steps - 1);
}

/** A hit held for the whole of the last bar of an n-bar grid (risers). */
export function lastBarHold(bars: number, steps = 16): string {
  return '.'.repeat((bars - 1) * steps) + 'x' + '-'.repeat(steps - 1);
}

/** Repeat a grid / string n times. */
export function rep(s: string, n: number): string {
  return Array.from({ length: n }, () => s).join('');
}

/** Pick a random MIDI note from a scale over a range of octaves. */
export function scaleNote(b: BarContext, root: number, scale: number[], octaves = 1): number {
  const deg = scale[b.rng.int(0, scale.length - 1)];
  return root + deg + 12 * b.rng.int(0, octaves - 1);
}

export const PENTA_MINOR = [0, 3, 5, 7, 10];
export const PENTA_MAJOR = [0, 2, 4, 7, 9];
export const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
export const HARM_MINOR = [0, 2, 3, 5, 7, 8, 11];
