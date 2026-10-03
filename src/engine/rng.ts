// Deterministic seeded RNG (sfc32). Every run has a seed string shown to the player;
// the whole dungeon layout is derived from it. Use `fork()` to derive independent
// streams (e.g. one per floor / per room) so that gameplay randomness does not
// change the layout of rooms that were not generated yet.

export function hashString(str: string): number {
  // cyrb53-ish 32-bit hash
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

const SEED_CHARS = 'ABCDEFGHJKLMNPQRSTVWXYZ0123456789';

/** Make a human readable seed like "K7QX-M2PA". Uses Math.random (only for new runs). */
export function randomSeedString(): string {
  let s = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) s += '-';
    s += SEED_CHARS[Math.floor(Math.random() * SEED_CHARS.length)];
  }
  return s;
}

export class RNG {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number | string = 1) {
    const s = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.a = s ^ 0x9e3779b9;
    this.b = (s * 0x85ebca6b) >>> 0;
    this.c = (s * 0xc2b2ae35) >>> 0;
    this.d = s ^ 0x27d4eb2f;
    for (let i = 0; i < 16; i++) this.nextU32();
  }

  nextU32(): number {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  snapshot(): number[] { return [this.a, this.b, this.c, this.d]; }
  restore(state: number[]): void {
    if (state.length !== 4 || !state.every(Number.isFinite)) throw new Error('invalid RNG state');
    [this.a, this.b, this.c, this.d] = state;
  }

  /** float in [0, 1) */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** float in [min, max) */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** -1 or 1 */
  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  angle(): number {
    return this.next() * Math.PI * 2;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('RNG.pick on empty array');
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Weighted pick. Items with weight <= 0 are never picked. Returns undefined for empty / all-zero. */
  weighted<T>(items: readonly T[], weight: (t: T) => number): T | undefined {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) return undefined;
    let r = this.next() * total;
    for (const it of items) {
      const w = Math.max(0, weight(it));
      if (r < w) return it;
      r -= w;
    }
    return items[items.length - 1];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /** The generator's internal state (four uint32), e.g. for state hashes / snapshots. */
  getState(): [number, number, number, number] {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }

  setState(s: readonly number[]): void {
    this.a = s[0] >>> 0;
    this.b = s[1] >>> 0;
    this.c = s[2] >>> 0;
    this.d = s[3] >>> 0;
  }

  /** Derive an independent generator. Same parent state + same label => same child. */
  fork(label: string | number = ''): RNG {
    return new RNG((this.nextU32() ^ hashString(String(label))) >>> 0);
  }
}

/**
 * Non-deterministic RNG for purely cosmetic randomness (particles, screen shake ...).
 * Never use this for anything that affects gameplay or level generation.
 */
export const fx = new RNG((Date.now() ^ (Math.random() * 1e9)) >>> 0);
