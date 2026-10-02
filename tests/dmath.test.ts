// Deterministic math (engine/dmath.ts): the fdlibm port must agree with the
// engine's own Math within 1 ulp everywhere, and bit for bit with V8 for the
// functions the simulation leans on. Also checks the 2/pi and pi/2 tables
// against values computed here with BigInt arithmetic, and the speed cost.

import { describe, expect, it } from 'vitest';
import * as D from '../src/engine/dmath';

const native = D.nativeMath;

const buf = new ArrayBuffer(8);
const f64 = new Float64Array(buf);
const u64 = new BigUint64Array(buf);
const u32 = new Uint32Array(buf);

/** Distance in ulps (Infinity when signs or NaN-ness differ). */
function ulps(a: number, b: number): number {
  if (Object.is(a, b) || (a !== a && b !== b)) return 0;
  if (a !== a || b !== b) return Infinity;
  f64[0] = a;
  const ba = u64[0];
  f64[0] = b;
  const bb = u64[0];
  if (ba >> 63n !== bb >> 63n) return a === 0 && b === 0 ? Infinity : Number((ba & ~(1n << 63n)) + (bb & ~(1n << 63n)));
  return Number(ba > bb ? ba - bb : bb - ba);
}

let seed = 0x2545f491;
function rnd(): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
function randBits(): number {
  u32[0] = (rnd() * 4294967296) >>> 0;
  u32[1] = (rnd() * 4294967296) >>> 0;
  return f64[0];
}

const EDGE = [
  0, -0, NaN, Infinity, -Infinity, 1, -1, 0.5, -0.5, 2, -2, 3, 1e-310, -1e-310, 5e-324, -5e-324, 2.2250738585072014e-308,
  1.7976931348623157e308, -1.7976931348623157e308, 1e22, 1e300, Math.PI, Math.PI / 2, Math.PI / 4, 3 * Math.PI / 4,
  709.782712893384, 709.79, -745.1332191019411, -745.14, 710.4758600739439, 1e-20, 0.99999999999, 1.0000000001, 22, -22,
  2 ** 28, 2 ** 66, 1e16, 0.1, 0.4375, 0.6744, 1.1875, 2.4375, 0.975, 1e-8, 56 * Math.LN2, 0.5 * Math.LN2, 1.5 * Math.LN2,
];

/** Inputs: edge cases, uniform, wide (log scale), near multiples of pi/2, raw bit patterns. */
function inputs(n: number): number[] {
  const out = [...EDGE, ...EDGE.map((x) => -x)];
  const k = Math.floor(n / 5);
  for (let i = 0; i < k; i++) out.push((rnd() - 0.5) * 20);
  for (let i = 0; i < k; i++) out.push((rnd() - 0.5) * 10 ** (rnd() * 12 - 4));
  for (let i = 0; i < k; i++) out.push((Math.floor(rnd() * 2e6) - 1e6) * (Math.PI / 2) + (rnd() - 0.5) * 1e-9);
  for (let i = 0; i < k; i++) out.push((rnd() - 0.5) * 1500);
  for (let i = 0; i < k; i++) out.push(randBits());
  return out;
}

type Fn1 = (x: number) => number;
type Fn2 = (x: number, y: number) => number;

/** functions that must match V8 bit for bit (the ones the simulation uses most) */
const EXACT = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'exp', 'log', 'pow', 'hypot']);

describe('deterministic math install', () => {
  it('compares against the real engine functions, and the test setup installed the ports', () => {
    for (const k of Object.keys(D.DETERMINISTIC_MATH) as (keyof typeof D.DETERMINISTIC_MATH)[]) {
      expect(native[k], k).not.toBe(D.DETERMINISTIC_MATH[k]);
      expect(String(native[k]), k).toContain('[native code]');
      expect((Math as unknown as Record<string, unknown>)[k], k).toBe(D.DETERMINISTIC_MATH[k]);
    }
    expect(D.deterministicMathInstalled()).toBe(true);
    D.installDeterministicMath(); // idempotent
    expect(Math.sin).toBe(D.sin);
  });
});

describe('deterministic math (fdlibm port) vs the engine', () => {
  const unary = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'cbrt', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh'] as const;
  const xs = inputs(200_000);

  for (const name of unary) {
    it(`${name}: within 1 ulp of native on ${xs.length} inputs${EXACT.has(name) ? ', bit-identical to V8' : ''}`, () => {
      const d = (D as unknown as Record<string, Fn1>)[name];
      const m = native[name] as Fn1;
      let worst = 0;
      let diff = 0;
      let example = '';
      for (const x0 of xs) {
        const x = name === 'acosh' ? Math.abs(x0) + 1 : name === 'asin' || name === 'acos' || name === 'atanh' ? (x0 % 2) : x0;
        const u = ulps(d(x), m(x));
        if (u > 0) {
          diff++;
          if (u > worst) {
            worst = u;
            example = `${name}(${x}) = ${d(x)} vs ${m(x)}`;
          }
        }
      }
      expect(worst, example).toBeLessThanOrEqual(1);
      if (EXACT.has(name)) expect(diff, example).toBe(0);
    });
  }

  const pairs: [number, number][] = [];
  const ys = [0, -0, NaN, Infinity, -Infinity, 1, -1, 2, -2, 0.5, -0.5, 3, -3, 1e-310, 1e300, 0.1, 1e10, 2 ** 31, 2 ** 53, 2 ** 53 + 2, 2 ** 64, 1.5, 1 / 3, 1023, 1024, -1074, -1075];
  for (const x of [...EDGE, ...EDGE.map((v) => -v), ...ys]) for (const y of ys) pairs.push([x, y]);
  for (let i = 0; i < 60_000; i++) pairs.push([(rnd() - 0.5) * 200, (rnd() - 0.5) * 200]);
  for (let i = 0; i < 60_000; i++) pairs.push([randBits(), randBits()]);
  for (let i = 0; i < 40_000; i++) pairs.push([rnd() * 100, (rnd() - 0.5) * 300]); // pow: general
  for (let i = 0; i < 40_000; i++) pairs.push([1 + (rnd() - 0.5) * 1e-6, (rnd() - 0.5) * 1e9]); // pow: x ~ 1, huge y
  for (let i = 0; i < 40_000; i++) pairs.push([-(rnd() * 10), Math.floor((rnd() - 0.5) * 200)]); // pow: negative base, integer y
  for (let i = 0; i < 40_000; i++) pairs.push([Math.abs(randBits()), (rnd() - 0.5) * 4]); // pow: subnormal / huge bases

  for (const name of ['atan2', 'pow', 'hypot'] as const) {
    it(`${name}: bit-identical to V8 on ${pairs.length} argument pairs (incl. special cases)`, () => {
      const d = (D as unknown as Record<string, Fn2>)[name];
      const m = native[name] as Fn2;
      let diff = 0;
      let example = '';
      for (const [x, y] of pairs) {
        if (ulps(d(x, y), m(x, y)) > 0) {
          diff++;
          example ||= `${name}(${x}, ${y}) = ${d(x, y)} vs ${m(x, y)}`;
        }
      }
      expect(diff, example).toBe(0);
    });
  }

  it('hypot handles 0, 1 and 3+ arguments like the engine', () => {
    const cases: number[][] = [[], [3], [-0], [1, 2, 3], [NaN, Infinity], [NaN, 1, 2], [1e300, 1e300, 1e300], [3, 4, 12, 84]];
    for (const c of cases) expect(Object.is(D.hypot(...c), native.hypot(...c)), JSON.stringify(c)).toBe(true);
  });

  it('pow follows the ECMAScript special cases', () => {
    expect(D.pow(NaN, 0)).toBe(1);
    expect(D.pow(1, NaN)).toBeNaN();
    expect(D.pow(1, Infinity)).toBeNaN();
    expect(D.pow(-1, -Infinity)).toBeNaN();
    expect(Object.is(D.pow(-0, 3), -0)).toBe(true);
    expect(D.pow(-0, -3)).toBe(-Infinity);
    expect(D.pow(-8, 1 / 3)).toBeNaN();
    expect(D.pow(2, -1074)).toBe(5e-324);
    expect(D.pow(2, 1024)).toBe(Infinity);
    expect(D.pow(-2, 3)).toBe(-8);
    for (let i = 0; i < 2000; i++) {
      const x = (rnd() - 0.5) * 1e4;
      expect(D.pow(x, 2)).toBe(x * x);
    }
  });
});

/** pi to `bits` fractional bits as a BigInt fixed-point number (Machin's formula). */
function piFixed(bits: number): bigint {
  const one = 1n << BigInt(bits + 32);
  const atanInv = (n: bigint): bigint => {
    let sum = 0n;
    let term = one / n;
    const n2 = n * n;
    for (let k = 1n; term !== 0n; k += 2n) {
      sum += ((k & 3n) === 1n ? 1n : -1n) * (term / k);
      term /= n2;
    }
    return sum;
  };
  return (16n * atanInv(5n) - 4n * atanInv(239n)) >> 32n;
}

describe('deterministic math tables', () => {
  const P = 1800;
  const pi = piFixed(P);

  it('2/pi table matches 1584 bits of 2/pi', () => {
    // floor(2/pi * 2^1584) from the fixed-point pi
    const twoOverPi = ((2n << BigInt(P)) << 1584n) / pi;
    for (let i = 0; i < D.TWO_OVER_PI_TABLE.length; i++) {
      const shift = BigInt(1584 - 24 * (i + 1));
      expect(Number((twoOverPi >> shift) & 0xffffffn), `chunk ${i}`).toBe(D.TWO_OVER_PI_TABLE[i]);
    }
  });

  it('pi/2 chunks are consecutive 24-bit pieces of pi/2', () => {
    const halfPi = pi >> 1n; // pi/2 with P fractional bits
    for (let k = 0; k < D.PIO2_TABLE.length; k++) {
      const e = 24 * k + 23;
      const chunk = (halfPi >> BigInt(P - e)) & 0xffffffn;
      expect(D.PIO2_TABLE[k], `PIo2[${k}]`).toBe(Number(chunk) * 2 ** -e);
    }
  });
});

describe('deterministic math speed', () => {
  it('stays within a small factor of the native functions', () => {
    const N = 400_000;
    const xs = new Float64Array(4096);
    for (let i = 0; i < xs.length; i++) xs[i] = (rnd() - 0.5) * 40;
    const time = (f: (x: number, y: number) => number): number => {
      let s = 0;
      const t0 = performance.now();
      for (let i = 0; i < N; i++) s += f(xs[i & 4095], xs[(i * 7) & 4095]);
      if (s === 0.123) throw new Error('unreachable');
      return performance.now() - t0;
    };
    const cases: [string, Fn2, Fn2][] = [
      ['sin', (x) => native.sin(x), (x) => D.sin(x)],
      ['cos', (x) => native.cos(x), (x) => D.cos(x)],
      ['atan2', (x, y) => native.atan2(x, y), (x, y) => D.atan2(x, y)],
      ['hypot', (x, y) => native.hypot(x, y), (x, y) => D.hypot(x, y)],
      ['exp', (x) => native.exp(x * 0.1), (x) => D.exp(x * 0.1)],
      ['pow', (x, y) => native.pow(Math.abs(x), y * 0.05), (x, y) => D.pow(Math.abs(x), y * 0.05)],
    ];
    let nat = 0;
    let det = 0;
    for (let rep = 0; rep < 3; rep++) {
      for (const [, a, b] of cases) {
        const ta = time(a);
        const tb = time(b);
        if (rep > 0) {
          nat += ta;
          det += tb;
        }
      }
    }
    // generous bound (CI noise); measured ~1.5x for trig, ~2x for pow, hypot faster
    expect(det / nat).toBeLessThan(4);
  });
});
