// Deterministic transcendental math for lockstep multiplayer.
//
// `Math.sin`, `Math.exp`, `Math.pow`, ... are not specified bit-exactly by
// ECMAScript: V8, SpiderMonkey and JavaScriptCore (which calls the system libm
// on iOS / macOS) may return results that differ in the last bit. A lockstep
// simulation compounds such a one-ulp difference into a desync within seconds.
//
// This module is a port of fdlibm (Sun's freely distributable libm, the code V8
// and SpiderMonkey are based on; see the notice below) to TypeScript using only
// IEEE-754 basic operations (+ - * /, Math.sqrt), Math.floor/abs and bit
// manipulation through a shared Float64Array view. Those are exact on every
// engine, so these functions return identical bits everywhere.
// `installDeterministicMath()` replaces the corresponding `Math` methods.
//
// ====================================================
// Copyright (C) 1993-2004 by Sun Microsystems, Inc. All rights reserved.
//
// Permission to use, copy, modify, and distribute this
// software is freely granted, provided that this notice
// is preserved.
// ====================================================

// ------------------------------------------------------------------ bit access
const buf = new ArrayBuffer(8);
const F = new Float64Array(buf);
const I = new Int32Array(buf);
const U = new Uint32Array(buf);
const LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const HW = LITTLE ? 1 : 0;
const LW = LITTLE ? 0 : 1;

/** High 32 bits of x (sign, exponent, top of the mantissa) as a signed int. */
function hiWord(x: number): number {
  F[0] = x;
  return I[HW];
}

/** Low 32 bits of x as an unsigned int. */
function loWord(x: number): number {
  F[0] = x;
  return U[LW];
}

/** Double from its high (signed or unsigned) and low (unsigned) words. */
function fromWords(hi: number, lo: number): number {
  I[HW] = hi;
  U[LW] = lo;
  return F[0];
}

function withHi(x: number, hi: number): number {
  F[0] = x;
  I[HW] = hi;
  return F[0];
}

/** x with its low word cleared (fdlibm SET_LOW_WORD(x, 0)). */
function clearLo(x: number): number {
  F[0] = x;
  U[LW] = 0;
  return F[0];
}

const abs = Math.abs;
const sqrt = Math.sqrt;
const floor = Math.floor;

// int32 truncation of a double known to be in int32 range ((int32_t)x in C)
function toInt(x: number): number {
  return x | 0;
}

const HUGE = 1.0e300;
const TINY = 1.0e-300;
const TWO54 = 1.80143985094819840000e+16;
const TWOM54 = 5.55111512312578270212e-17;

/** x * 2^n (fdlibm scalbn), exact unless the result over/underflows. */
export function scalbn(x: number, n: number): number {
  let hx = hiWord(x);
  const lx = loWord(x);
  let k = (hx & 0x7ff00000) >> 20;
  if (k === 0) {
    if ((lx | (hx & 0x7fffffff)) === 0) return x;
    x *= TWO54;
    hx = hiWord(x);
    k = ((hx & 0x7ff00000) >> 20) - 54;
    if (n < -50000) return TINY * x;
  }
  if (k === 0x7ff) return x + x;
  k = k + n;
  if (k > 0x7fe) return HUGE * copysign(HUGE, x);
  if (k > 0) return withHi(x, (hx & 0x800fffff) | (k << 20));
  if (k <= -54) {
    if (n > 50000) return HUGE * copysign(HUGE, x);
    return TINY * copysign(TINY, x);
  }
  k += 54;
  return withHi(x, (hx & 0x800fffff) | (k << 20)) * TWOM54;
}

function copysign(x: number, y: number): number {
  const hy = hiWord(y);
  const hx = hiWord(x);
  return withHi(x, (hx & 0x7fffffff) | (hy & 0x80000000));
}

// ------------------------------------------------------------------ argument reduction
/** 2/pi in 24-bit chunks (396 hex digits). */
const TWO_OVER_PI = [
  0xa2f983, 0x6e4e44, 0x1529fc, 0x2757d1, 0xf534dd, 0xc0db62, 0x95993c, 0x439041, 0xfe5163, 0xabdebb, 0xc561b7,
  0x246e3a, 0x424dd2, 0xe00649, 0x2eea09, 0xd1921c, 0xfe1deb, 0x1cb129, 0xa73ee8, 0x8235f5, 0x2ebb44, 0x84e99c,
  0x7026b4, 0x5f7e41, 0x3991d6, 0x398353, 0x39f49c, 0x845f8b, 0xbdf928, 0x3b1ff8, 0x97ffde, 0x05980f, 0xef2f11,
  0x8b5a0a, 0x6d1f6d, 0x367ecf, 0x27cb09, 0xb74f46, 0x3f669e, 0x5fea2d, 0x7527ba, 0xc7ebe5, 0xf17b3d, 0x0739f7,
  0x8a5292, 0xea6bfb, 0x5fb11f, 0x8d5d08, 0x560330, 0x46fc7b, 0x6babf0, 0xcfbc20, 0x9af436, 0x1da9e3, 0x91615e,
  0xe61b08, 0x659985, 0x5f14a0, 0x68408d, 0xffd880, 0x4d7327, 0x310606, 0x1556ca, 0x73a8c9, 0x60e27b, 0xc08c6b,
];
/** exported for the table self-check in tests */
export const TWO_OVER_PI_TABLE: readonly number[] = TWO_OVER_PI;

const NPIO2_HW = [
  0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c, 0x4025fdbb, 0x402921fb, 0x402c463a,
  0x402f6a7a, 0x4031475c, 0x4032d97c, 0x40346b9c, 0x4035fdbb, 0x40378fdb, 0x403921fb, 0x403ab41b, 0x403c463a,
  0x403dd85a, 0x403f6a7a, 0x40407e4c, 0x4041475c, 0x4042106c, 0x4042d97c, 0x4043a28c, 0x40446b9c, 0x404534ac,
  0x4045fdbb, 0x4046c6cb, 0x40478fdb, 0x404858eb, 0x404921fb,
];

const PIO2 = [
  1.57079625129699707031e+00, 7.54978941586159635335e-08, 5.39030252995776476554e-15, 3.28200341580791294123e-22,
  1.27065575308067607349e-29, 1.22933308981111328932e-36, 2.73370053816464559624e-44, 2.16741683877804819444e-51,
];
/** exported for the table self-check in tests */
export const PIO2_TABLE: readonly number[] = PIO2;

const TWO24 = 1.67772160000000000000e+07;
const TWON24 = 5.96046447753906250000e-08;

// scratch arrays (no allocation per call)
const kIq = new Int32Array(20);
const kF = new Float64Array(20);
const kFq = new Float64Array(20);
const kQ = new Float64Array(20);
const remTx = new Float64Array(3);
/** reduced argument (y0 + y1 = x - n*pi/2), written by remPio2 */
const Y = new Float64Array(2);

/**
 * fdlibm __kernel_rem_pio2 for prec = 2 (53-bit doubles, two outputs written to `y`).
 * Returns n mod 8 where x = n * pi/2 + (y0 + y1).
 */
function kernelRemPio2(x: Float64Array, y: Float64Array, e0: number, nx: number): number {
  const jk = 4; // init_jk[prec = 2]
  const jp = jk;
  const iq = kIq;
  const f = kF;
  const fq = kFq;
  const q = kQ;
  let z: number;
  let fw: number;
  let i: number;
  let j: number;
  let k: number;
  let n: number;
  let ih: number;

  const jx = nx - 1;
  let jv = toInt((e0 - 3) / 24);
  if (jv < 0) jv = 0;
  let q0 = e0 - 24 * (jv + 1);

  j = jv - jx;
  const m = jx + jk;
  for (i = 0; i <= m; i++, j++) f[i] = j < 0 ? 0 : TWO_OVER_PI[j];

  for (i = 0; i <= jk; i++) {
    for (j = 0, fw = 0.0; j <= jx; j++) fw += x[j] * f[jx + i - j];
    q[i] = fw;
  }

  let jz = jk;
  for (;;) {
    // distill q[] into iq[] reversingly
    for (i = 0, j = jz, z = q[jz]; j > 0; i++, j--) {
      fw = toInt(TWON24 * z);
      iq[i] = toInt(z - TWO24 * fw);
      z = q[j - 1] + fw;
    }

    // compute n
    z = scalbn(z, q0);
    z -= 8.0 * floor(z * 0.125);
    n = toInt(z);
    z -= n;
    ih = 0;
    if (q0 > 0) {
      i = iq[jz - 1] >> (24 - q0);
      n += i;
      iq[jz - 1] -= i << (24 - q0);
      ih = iq[jz - 1] >> (23 - q0);
    } else if (q0 === 0) {
      ih = iq[jz - 1] >> 23;
    } else if (z >= 0.5) {
      ih = 2;
    }

    if (ih > 0) {
      n += 1;
      let carry = 0;
      for (i = 0; i < jz; i++) {
        j = iq[i];
        if (carry === 0) {
          if (j !== 0) {
            carry = 1;
            iq[i] = 0x1000000 - j;
          }
        } else {
          iq[i] = 0xffffff - j;
        }
      }
      if (q0 > 0) {
        if (q0 === 1) iq[jz - 1] &= 0x7fffff;
        else if (q0 === 2) iq[jz - 1] &= 0x3fffff;
      }
      if (ih === 2) {
        z = 1.0 - z;
        if (carry !== 0) z -= scalbn(1.0, q0);
      }
    }

    // check if recomputation is needed
    if (z === 0) {
      j = 0;
      for (i = jz - 1; i >= jk; i--) j |= iq[i];
      if (j === 0) {
        for (k = 1; jk >= k && iq[jk - k] === 0; k++);
        for (i = jz + 1; i <= jz + k; i++) {
          f[jx + i] = TWO_OVER_PI[jv + i];
          for (j = 0, fw = 0.0; j <= jx; j++) fw += x[j] * f[jx + i - j];
          q[i] = fw;
        }
        jz += k;
        continue;
      }
    }
    break;
  }

  // chop off zero terms
  if (z === 0.0) {
    jz -= 1;
    q0 -= 24;
    while (iq[jz] === 0) {
      jz--;
      q0 -= 24;
    }
  } else {
    z = scalbn(z, -q0);
    if (z >= TWO24) {
      fw = toInt(TWON24 * z);
      iq[jz] = toInt(z - TWO24 * fw);
      jz += 1;
      q0 += 24;
      iq[jz] = fw;
    } else {
      iq[jz] = toInt(z);
    }
  }

  // convert integer "bit" chunk to floating-point value
  fw = scalbn(1.0, q0);
  for (i = jz; i >= 0; i--) {
    q[i] = fw * iq[i];
    fw *= TWON24;
  }

  // compute PIo2[0,...,jp]*q[jz,...,0]
  for (i = jz; i >= 0; i--) {
    for (fw = 0.0, k = 0; k <= jp && k <= jz - i; k++) fw += PIO2[k] * q[i + k];
    fq[jz - i] = fw;
  }

  // compress fq[] into y[] (prec 2)
  fw = 0.0;
  for (i = jz; i >= 0; i--) fw += fq[i];
  y[0] = ih === 0 ? fw : -fw;
  fw = fq[0] - fw;
  for (i = 1; i <= jz; i++) fw += fq[i];
  y[1] = ih === 0 ? fw : -fw;
  return n & 7;
}

const INVPIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21;
const PIO2_3T = 8.47842766036889956997e-32;

/** fdlibm __ieee754_rem_pio2: x = n*pi/2 + (Y[0] + Y[1]); returns n. */
function remPio2(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  let z: number;
  let w: number;
  let t: number;
  let r: number;
  let fn: number;
  let n: number;
  if (ix <= 0x3fe921fb) {
    Y[0] = x;
    Y[1] = 0;
    return 0;
  }
  if (ix < 0x4002d97c) {
    // |x| < 3pi/4, special case with n = +-1
    if (hx > 0) {
      z = x - PIO2_1;
      if (ix !== 0x3ff921fb) {
        Y[0] = z - PIO2_1T;
        Y[1] = z - Y[0] - PIO2_1T;
      } else {
        z -= PIO2_2;
        Y[0] = z - PIO2_2T;
        Y[1] = z - Y[0] - PIO2_2T;
      }
      return 1;
    }
    z = x + PIO2_1;
    if (ix !== 0x3ff921fb) {
      Y[0] = z + PIO2_1T;
      Y[1] = z - Y[0] + PIO2_1T;
    } else {
      z += PIO2_2;
      Y[0] = z + PIO2_2T;
      Y[1] = z - Y[0] + PIO2_2T;
    }
    return -1;
  }
  if (ix <= 0x413921fb) {
    // |x| ~<= 2^19*(pi/2), medium size
    t = abs(x);
    n = toInt(t * INVPIO2 + 0.5);
    fn = n;
    r = t - fn * PIO2_1;
    w = fn * PIO2_1T;
    if (n < 32 && ix !== NPIO2_HW[n - 1]) {
      Y[0] = r - w;
    } else {
      const j = ix >> 20;
      Y[0] = r - w;
      let i = j - ((hiWord(Y[0]) >> 20) & 0x7ff);
      if (i > 16) {
        // 2nd iteration needed, good to 118
        t = r;
        w = fn * PIO2_2;
        r = t - w;
        w = fn * PIO2_2T - (t - r - w);
        Y[0] = r - w;
        i = j - ((hiWord(Y[0]) >> 20) & 0x7ff);
        if (i > 49) {
          // 3rd iteration needed, 151 bits acc
          t = r;
          w = fn * PIO2_3;
          r = t - w;
          w = fn * PIO2_3T - (t - r - w);
          Y[0] = r - w;
        }
      }
    }
    Y[1] = r - Y[0] - w;
    if (hx < 0) {
      Y[0] = -Y[0];
      Y[1] = -Y[1];
      return -n;
    }
    return n;
  }
  // all other (large) arguments
  if (ix >= 0x7ff00000) {
    Y[0] = Y[1] = x - x;
    return 0;
  }
  // set z = scalbn(|x|, ilogb(x) - 23)
  const e0 = (ix >> 20) - 1046;
  z = fromWords(ix - (e0 << 20), loWord(x));
  const tx = remTx;
  for (let i = 0; i < 2; i++) {
    tx[i] = toInt(z);
    z = (z - tx[i]) * TWO24;
  }
  tx[2] = z;
  let nx = 3;
  while (tx[nx - 1] === 0) nx--;
  n = kernelRemPio2(tx, Y, e0, nx);
  if (hx < 0) {
    Y[0] = -Y[0];
    Y[1] = -Y[1];
    return -n;
  }
  return n;
}

// ------------------------------------------------------------------ kernels
const S1 = -1.66666666666666324348e-01;
const S2 = 8.33333333332248946124e-03;
const S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06;
const S5 = -2.50507602534068634195e-08;
const S6 = 1.58969099521155010221e-10;

/** sin(x + y) on [-pi/4, pi/4]; iy = 0 when y is known to be 0. */
function kernelSin(x: number, y: number, iy: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix < 0x3e400000) {
    if (toInt(x) === 0) return x;
  }
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

const C1 = 4.16666666666666019037e-02;
const C2 = -1.38888888888741095749e-03;
const C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07;
const C5 = 2.08757232129817482790e-09;
const C6 = -1.13596475577881948265e-11;

/** cos(x + y) on [-pi/4, pi/4]. */
function kernelCos(x: number, y: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix < 0x3e400000) {
    if (toInt(x) === 0) return 1.0;
  }
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1.0 - (0.5 * z - (z * r - x * y));
  let qx: number;
  if (ix > 0x3fe90000) qx = 0.28125;
  else qx = fromWords(ix - 0x00200000, 0);
  const iz = 0.5 * z - qx;
  const a = 1.0 - qx;
  return a - (iz - (z * r - x * y));
}

const T = [
  3.33333333333334091986e-01, 1.33333333333201242699e-01, 5.39682539762260521377e-02, 2.18694882948595424599e-02,
  8.86323982359930005737e-03, 3.59207910759131235356e-03, 1.45620945432529025516e-03, 5.88041240820264096874e-04,
  2.46463134818469906812e-04, 7.81794442939557092300e-05, 7.14072491382608190305e-05, -1.85586374855275456654e-05,
  2.59073051863633712884e-05,
];
const PIO4 = 7.85398163397448278999e-01;
const PIO4LO = 3.06161699786838301793e-17;

/** tan(x + y) on [-pi/4, pi/4] (iy = 1) or -1/tan (iy = -1). */
function kernelTan(x: number, y: number, iy: number): number {
  let z: number;
  let r: number;
  let v: number;
  let w: number;
  let s: number;
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  if (ix < 0x3e300000) {
    if (toInt(x) === 0) {
      if (((ix | loWord(x)) | (iy + 1)) === 0) return 1 / abs(x);
      if (iy === 1) return x;
      // compute -1 / (x + y) carefully
      w = x + y;
      z = clearLo(w);
      v = y - (z - x);
      const a = -1 / w;
      const t = clearLo(a);
      s = 1 + t * z;
      return t + a * (s + t * v);
    }
  }
  if (ix >= 0x3fe59428) {
    if (hx < 0) {
      x = -x;
      y = -y;
    }
    z = PIO4 - x;
    w = PIO4LO - y;
    x = z + w;
    y = 0.0;
  }
  z = x * x;
  w = z * z;
  r = T[1] + w * (T[3] + w * (T[5] + w * (T[7] + w * (T[9] + w * T[11]))));
  v = z * (T[2] + w * (T[4] + w * (T[6] + w * (T[8] + w * (T[10] + w * T[12])))));
  s = z * x;
  r = y + z * (s * (r + v) + y);
  r += T[0] * s;
  w = x + r;
  if (ix >= 0x3fe59428) {
    v = iy;
    return (1 - ((hx >> 30) & 2)) * (v - 2.0 * (x - (w * w / (w + v) - r)));
  }
  if (iy === 1) return w;
  // compute -1.0 / (x + r) accurately
  z = clearLo(w);
  v = r - (z - x);
  const a = -1.0 / w;
  const t = clearLo(a);
  s = 1.0 + t * z;
  return t + a * (s + t * v);
}

// ------------------------------------------------------------------ trig
export function sin(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, 0);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  switch (n & 3) {
    case 0: return kernelSin(Y[0], Y[1], 1);
    case 1: return kernelCos(Y[0], Y[1]);
    case 2: return -kernelSin(Y[0], Y[1], 1);
    default: return -kernelCos(Y[0], Y[1]);
  }
}

export function cos(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  switch (n & 3) {
    case 0: return kernelCos(Y[0], Y[1]);
    case 1: return -kernelSin(Y[0], Y[1], 1);
    case 2: return -kernelCos(Y[0], Y[1]);
    default: return kernelSin(Y[0], Y[1], 1);
  }
}

export function tan(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelTan(x, 0, 1);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  return kernelTan(Y[0], Y[1], 1 - ((n & 1) << 1));
}

// ------------------------------------------------------------------ inverse trig
const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT0 = 3.33333333333329318027e-01;
const AT1 = -1.99999999998764832476e-01;
const AT2 = 1.42857142725034663711e-01;
const AT3 = -1.11111104054623557880e-01;
const AT4 = 9.09088713343650656196e-02;
const AT5 = -7.69187620504482999495e-02;
const AT6 = 6.66107313738753120669e-02;
const AT7 = -5.83357013379057348645e-02;
const AT8 = 4.97687799461593236017e-02;
const AT9 = -3.65315727442169155270e-02;
const AT10 = 1.62858201153657823623e-02;

export function atan(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  let id: number;
  if (ix >= 0x44100000) {
    // |x| >= 2^66
    if (x !== x) return x + x;
    if (hx > 0) return ATANHI[3] + ATANLO[3];
    return -ATANHI[3] - ATANLO[3];
  }
  if (ix < 0x3fdc0000) {
    // |x| < 0.4375
    if (ix < 0x3e400000) return x; // |x| < 2^-27
    id = -1;
  } else {
    x = abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) {
        id = 0;
        x = (2.0 * x - 1.0) / (2.0 + x);
      } else {
        id = 1;
        x = (x - 1.0) / (x + 1.0);
      }
    } else if (ix < 0x40038000) {
      id = 2;
      x = (x - 1.5) / (1.0 + 1.5 * x);
    } else {
      id = 3;
      x = -1.0 / x;
    }
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATANHI[id] - (x * (s1 + s2) - ATANLO[id] - x);
  return hx < 0 ? -r : r;
}

const PI_O_4 = 7.8539816339744827900e-01;
const PI_O_2 = 1.5707963267948965580e+00;
const PI = 3.1415926535897931160e+00;
const PI_LO = 1.2246467991473531772e-16;

export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return x + y;
  const hx = hiWord(x);
  const lx = loWord(x);
  const ix = hx & 0x7fffffff;
  const hy = hiWord(y);
  const ly = loWord(y);
  const iy = hy & 0x7fffffff;
  if (((hx - 0x3ff00000) | lx) === 0) return atan(y); // x = 1.0
  let m = ((hy >> 31) & 1) | ((hx >> 30) & 2); // 2*sign(x) + sign(y)

  // y = 0
  if ((iy | ly) === 0) {
    switch (m) {
      case 0:
      case 1: return y;
      case 2: return PI + TINY;
      default: return -PI - TINY;
    }
  }
  // x = 0
  if ((ix | lx) === 0) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY;
  // x = INF
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) {
      switch (m) {
        case 0: return PI_O_4 + TINY;
        case 1: return -PI_O_4 - TINY;
        case 2: return 3.0 * PI_O_4 + TINY;
        default: return -3.0 * PI_O_4 - TINY;
      }
    }
    switch (m) {
      case 0: return 0.0;
      case 1: return -0.0;
      case 2: return PI + TINY;
      default: return -PI - TINY;
    }
  }
  // y = INF
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY;

  // compute y/x
  const k = (iy - ix) >> 20;
  let z: number;
  if (k > 60) {
    z = PI_O_2 + 0.5 * PI_LO;
    m &= 1;
  } else if (hx < 0 && k < -60) {
    z = 0.0;
  } else {
    z = atan(abs(y / x));
  }
  switch (m) {
    case 0: return z;
    case 1: return -z;
    case 2: return PI - (z - PI_LO);
    default: return z - PI_LO - PI;
  }
}

const PIO2_HI = 1.57079632679489655800e+00;
const PIO2_LO = 6.12323399573676603587e-17;
const PIO4_HI = 7.85398163397448278999e-01;
const PS0 = 1.66666666666666657415e-01;
const PS1 = -3.25565818622400915405e-01;
const PS2 = 2.01212532134862925881e-01;
const PS3 = -4.00555345006794114027e-02;
const PS4 = 7.91534994289814532176e-04;
const PS5 = 3.47933107596021167570e-05;
const QS1 = -2.40339491173441421878e+00;
const QS2 = 2.02094576023350569471e+00;
const QS3 = -6.88283971605453293030e-01;
const QS4 = 7.70381505559019352791e-02;

export function asin(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  let t: number;
  let w: number;
  let p: number;
  let q: number;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | loWord(x)) === 0) return x * PIO2_HI + x * PIO2_LO;
    return (x - x) / (x - x);
  }
  if (ix < 0x3fe00000) {
    // |x| < 0.5
    if (ix < 0x3e400000) return x;
    t = x * x;
    p = t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
    q = 1.0 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
    w = p / q;
    return x + x * w;
  }
  // 1 > |x| >= 0.5
  w = 1.0 - abs(x);
  t = w * 0.5;
  p = t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
  q = 1.0 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
  const s = sqrt(t);
  if (ix >= 0x3fef3333) {
    // |x| > 0.975
    w = p / q;
    t = PIO2_HI - (2.0 * (s + s * w) - PIO2_LO);
  } else {
    w = clearLo(s);
    const c = (t - w * w) / (s + w);
    const r = p / q;
    p = 2.0 * s * r - (PIO2_LO - 2.0 * c);
    q = PIO4_HI - 2.0 * w;
    t = PIO4_HI - (p - q);
  }
  return hx > 0 ? t : -t;
}

export function acos(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  let z: number;
  let p: number;
  let q: number;
  let r: number;
  let w: number;
  let s: number;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | loWord(x)) === 0) {
      if (hx > 0) return 0.0;
      return PI + 2.0 * PIO2_LO;
    }
    return (x - x) / (x - x);
  }
  if (ix < 0x3fe00000) {
    // |x| < 0.5
    if (ix <= 0x3c600000) return PIO2_HI + PIO2_LO;
    z = x * x;
    p = z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))));
    q = 1.0 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)));
    r = p / q;
    return PIO2_HI - (x - (PIO2_LO - x * r));
  }
  if (hx < 0) {
    // x < -0.5
    z = (1.0 + x) * 0.5;
    p = z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))));
    q = 1.0 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)));
    s = sqrt(z);
    r = p / q;
    w = r * s - PIO2_LO;
    return PI - 2.0 * (s + w);
  }
  // x > 0.5
  z = (1.0 - x) * 0.5;
  s = sqrt(z);
  const df = clearLo(s);
  const c = (z - df * df) / (s + df);
  p = z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))));
  q = 1.0 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)));
  r = p / q;
  w = r * s + c;
  return 2.0 * (df + w);
}

// ------------------------------------------------------------------ exp / log
const O_THRESHOLD = 7.09782712893383973096e+02;
const U_THRESHOLD = -7.45133219101941108420e+02;
const LN2_HI = 6.93147180369123816490e-01;
const LN2_LO = 1.90821492927058770002e-10;
const INVLN2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01;
const P2 = -2.77777777770155933842e-03;
const P3 = 6.61375632143793436117e-05;
const P4 = -1.65339022054652515390e-06;
const P5 = 4.13813679705723846039e-08;
const E = 2.718281828459045;
const TWOM1000 = 9.33263618503218878990e-302;
const TWO1023 = 8.988465674311579539e307;

export function exp(x: number): number {
  let hi = 0.0;
  let lo = 0.0;
  let k = 0;
  let hx = hiWord(x);
  const xsb = (hx >> 31) & 1;
  hx &= 0x7fffffff;

  // filter out non-finite argument
  if (hx >= 0x40862e42) {
    if (hx >= 0x7ff00000) {
      if (x !== x) return x + x;
      return xsb === 0 ? x : 0.0;
    }
    if (x > O_THRESHOLD) return HUGE * HUGE;
    if (x < U_THRESHOLD) return TWOM1000 * TWOM1000;
  }

  // argument reduction
  if (hx > 0x3fd62e42) {
    if (hx < 0x3ff0a2b2) {
      // V8 special-cases exp(1) (the reduction below gets its last bit wrong)
      if (x === 1.0) return E;
      hi = xsb === 0 ? x - LN2_HI : x + LN2_HI;
      lo = xsb === 0 ? LN2_LO : -LN2_LO;
      k = 1 - xsb - xsb;
    } else {
      k = toInt(INVLN2 * x + (xsb === 0 ? 0.5 : -0.5));
      const t = k;
      hi = x - t * LN2_HI;
      lo = t * LN2_LO;
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {
    // |x| < 2^-28
    return 1.0 + x;
  } else {
    k = 0;
  }

  // x is now in primary range
  const t = x * x;
  const twopk = k >= -1021 ? fromWords(0x3ff00000 + (k << 20), 0) : fromWords(0x3ff00000 + ((k + 1000) << 20), 0);
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1.0 - ((x * c) / (c - 2.0) - x);
  const y = 1.0 - (lo - (x * c) / (2.0 - c) - hi);
  if (k >= -1021) {
    if (k === 1024) return y * 2.0 * TWO1023;
    return y * twopk;
  }
  return y * twopk * TWOM1000;
}

const LG1 = 6.666666666666735130e-01;
const LG2 = 3.999999999940941908e-01;
const LG3 = 2.857142874366239149e-01;
const LG4 = 2.222219843214978396e-01;
const LG5 = 1.818357216161805012e-01;
const LG6 = 1.531383769920937332e-01;
const LG7 = 1.479819860511658591e-01;

export function log(x: number): number {
  let hx = hiWord(x);
  const lx = loWord(x);
  let k = 0;
  if (hx < 0x00100000) {
    // x < 2^-1022
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= TWO54;
    hx = hiWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = withHi(x, hx | (i ^ 0x3ff00000));
  k += i >> 20;
  const f = x - 1.0;
  let dk: number;
  let R: number;
  if ((0x000fffff & (2 + hx)) < 3) {
    // -2^-20 <= f < 2^-20
    if (f === 0) {
      if (k === 0) return 0;
      dk = k;
      return dk * LN2_HI + dk * LN2_LO;
    }
    R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k === 0) return f - R;
    dk = k;
    return dk * LN2_HI - (R - dk * LN2_LO - f);
  }
  const s = f / (2.0 + f);
  dk = k;
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  i |= j;
  R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * LN2_HI - (hfsq - (s * (hfsq + R) + dk * LN2_LO) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * LN2_HI - (s * (f - R) - dk * LN2_LO - f);
}

/** log(1 + f) - f + f*f/2 for f in [sqrt(2)/2 - 1, sqrt(2) - 1] (FreeBSD k_log1p). */
function kLog1p(f: number): number {
  const s = f / (2.0 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1;
  const hfsq = 0.5 * f * f;
  return s * (hfsq + R);
}

const IVLN2HI = 1.44269504072144627571e+00;
const IVLN2LO = 1.67517131648865118353e-10;

export function log2(x: number): number {
  let hx = hiWord(x);
  const lx = loWord(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= TWO54;
    hx = hiWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  if (hx === 0x3ff00000 && lx === 0) return 0;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i = (hx + 0x95f64) & 0x100000;
  x = withHi(x, hx | (i ^ 0x3ff00000));
  k += i >> 20;
  const y = k;
  const f = x - 1.0;
  const hfsq = 0.5 * f * f;
  const r = kLog1p(f);
  const hi = clearLo(f - hfsq);
  const lo = f - hi - hfsq + r;
  let valHi = hi * IVLN2HI;
  let valLo = (lo + hi) * IVLN2LO + lo * IVLN2HI;
  const w = y + valHi;
  valLo += y - w + valHi;
  valHi = w;
  return valLo + valHi;
}

const IVLN10 = 4.34294481903251816668e-01;
const LOG10_2HI = 3.01029995663611771306e-01;
const LOG10_2LO = 3.69423907715893078616e-13;

export function log10(x: number): number {
  let hx = hiWord(x);
  let lx = loWord(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= TWO54;
    hx = hiWord(x);
    lx = loWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  if (hx === 0x3ff00000 && lx === 0) return 0;
  k += (hx >> 20) - 1023;
  const i = (k & 0x80000000) >>> 31;
  hx = (hx & 0x000fffff) | ((0x3ff - i) << 20);
  const y = k + i;
  x = fromWords(hx, lx);
  const z = y * LOG10_2LO + IVLN10 * log(x);
  return z + y * LOG10_2HI;
}

const LP1 = 6.666666666666735130e-01;
const LP2 = 3.999999999940941908e-01;
const LP3 = 2.857142874366239149e-01;
const LP4 = 2.222219843214978396e-01;
const LP5 = 1.818357216161805012e-01;
const LP6 = 1.531383769920937332e-01;
const LP7 = 1.479819860511658591e-01;

export function log1p(x: number): number {
  const hx = hiWord(x);
  const ax = hx & 0x7fffffff;
  let k = 1;
  let f = 0;
  let hu = 0;
  let c = 0;
  if (hx < 0x3fda827a) {
    // 1 + x < sqrt(2)+
    if (ax >= 0x3ff00000) {
      // x <= -1.0
      if (x === -1.0) return -Infinity;
      return NaN;
    }
    if (ax < 0x3e200000) {
      // |x| < 2^-29
      if (ax < 0x3c900000) return x;
      return x - x * x * 0.5;
    }
    if (hx > 0 || hx <= (0xbfd2bec4 | 0)) {
      // sqrt(2)/2- <= 1+x < sqrt(2)+
      k = 0;
      f = x;
      hu = 1;
    }
  } else if (hx >= 0x7ff00000) {
    return x + x;
  }
  if (k !== 0) {
    let u: number;
    if (hx < 0x43400000) {
      u = 1.0 + x;
      hu = hiWord(u);
      k = (hu >> 20) - 1023;
      c = k > 0 ? 1.0 - (u - x) : x - (u - 1.0);
      c /= u;
    } else {
      u = x;
      hu = hiWord(u);
      k = (hu >> 20) - 1023;
      c = 0;
    }
    hu &= 0x000fffff;
    if (hu < 0x6a09e) {
      u = withHi(u, hu | 0x3ff00000);
    } else {
      k += 1;
      u = withHi(u, hu | 0x3fe00000);
      hu = (0x00100000 - hu) >> 2;
    }
    f = u - 1.0;
  }
  const hfsq = 0.5 * f * f;
  let R: number;
  if (hu === 0) {
    // |f| < 2^-20
    if (f === 0) {
      if (k === 0) return 0;
      c += k * LN2_LO;
      return k * LN2_HI + c;
    }
    R = hfsq * (1.0 - 0.66666666666666666 * f);
    if (k === 0) return f - R;
    return k * LN2_HI - (R - (k * LN2_LO + c) - f);
  }
  const s = f / (2.0 + f);
  const z = s * s;
  R = z * (LP1 + z * (LP2 + z * (LP3 + z * (LP4 + z * (LP5 + z * (LP6 + z * LP7))))));
  if (k === 0) return f - (hfsq - s * (hfsq + R));
  return k * LN2_HI - (hfsq - (s * (hfsq + R) + (k * LN2_LO + c)) - f);
}

const Q1 = -3.33333333333331316428e-02;
const Q2 = 1.58730158725481460165e-03;
const Q3 = -7.93650757867487942473e-05;
const Q4 = 4.00821782732936239552e-06;
const Q5 = -2.01099218183624371326e-07;

export function expm1(x: number): number {
  let hx = hiWord(x);
  const xsb = hx & 0x80000000;
  hx &= 0x7fffffff;
  let k: number;
  let hi: number;
  let lo: number;
  let c = 0;
  let t: number;
  let y: number;

  // filter out huge and non-finite argument
  if (hx >= 0x4043687a) {
    // |x| >= 56*ln2
    if (hx >= 0x40862e42) {
      if (hx >= 0x7ff00000) {
        if (x !== x) return x + x;
        return xsb === 0 ? x : -1.0;
      }
      if (x > O_THRESHOLD) return HUGE * HUGE;
    }
    if (xsb !== 0) {
      // x < -56*ln2, return -1.0 with inexact
      if (x + TINY < 0.0) return TINY - 1.0;
    }
  }

  // argument reduction
  if (hx > 0x3fd62e42) {
    if (hx < 0x3ff0a2b2) {
      if (xsb === 0) {
        hi = x - LN2_HI;
        lo = LN2_LO;
        k = 1;
      } else {
        hi = x + LN2_HI;
        lo = -LN2_LO;
        k = -1;
      }
    } else {
      k = toInt(INVLN2 * x + (xsb === 0 ? 0.5 : -0.5));
      t = k;
      hi = x - t * LN2_HI;
      lo = t * LN2_LO;
    }
    x = hi - lo;
    c = hi - x - lo;
  } else if (hx < 0x3c900000) {
    // |x| < 2^-54, return x
    return x;
  } else {
    k = 0;
  }

  // x is now in primary range
  const hfx = 0.5 * x;
  const hxs = x * hfx;
  const r1 = 1.0 + hxs * (Q1 + hxs * (Q2 + hxs * (Q3 + hxs * (Q4 + hxs * Q5))));
  t = 3.0 - r1 * hfx;
  let e = hxs * ((r1 - t) / (6.0 - x * t));
  if (k === 0) return x - (x * e - hxs);
  const twopk = fromWords(0x3ff00000 + (k << 20), 0);
  e = x * (e - c) - c;
  e -= hxs;
  if (k === -1) return 0.5 * (x - e) - 0.5;
  if (k === 1) {
    if (x < -0.25) return -2.0 * (e - (x + 0.5));
    return 1.0 + 2.0 * (x - e);
  }
  if (k <= -2 || k > 56) {
    y = 1.0 - (e - x);
    if (k === 1024) y = y * 2.0 * 8.98846567431158e+307;
    else y = y * twopk;
    return y - 1.0;
  }
  if (k < 20) {
    t = fromWords(0x3ff00000 - (0x200000 >> k), 0); // 1 - 2^-k
    y = t - (e - x);
    y = y * twopk;
  } else {
    t = fromWords((0x3ff - k) << 20, 0); // 2^-k
    y = x - (e + t);
    y += 1.0;
    y = y * twopk;
  }
  return y;
}

// ------------------------------------------------------------------ hyperbolic
const KSINH_OVERFLOW = 710.4758600739439;
const TWO_M28 = 3.725290298461914e-9;
const LOG_MAXD = 709.7822265625;

export function sinh(x: number): number {
  const h = x < 0 ? -0.5 : 0.5;
  const ax = abs(x);
  if (ax < 22) {
    if (ax < TWO_M28) return x;
    const t = expm1(ax);
    if (ax < 1) return h * (2.0 * t - (t * t) / (t + 1.0));
    return h * (t + t / (t + 1.0));
  }
  if (ax < LOG_MAXD) return h * exp(ax);
  if (ax <= KSINH_OVERFLOW) {
    const w = exp(0.5 * ax);
    const t = h * w;
    return t * w;
  }
  return x * 1.0e307;
}

export function cosh(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix < 0x3fd62e43) {
    // |x| in [0, 0.5*ln2]
    const t = expm1(abs(x));
    const w = 1.0 + t;
    if (ix < 0x3c800000) return w;
    return 1.0 + (t * t) / (w + w);
  }
  if (ix < 0x40360000) {
    // |x| in [0.5*ln2, 22]
    const t = exp(abs(x));
    return 0.5 * t + 0.5 / t;
  }
  if (ix < 0x40862e42) return 0.5 * exp(abs(x));
  if (abs(x) <= KSINH_OVERFLOW) {
    const w = exp(0.5 * abs(x));
    const t = 0.5 * w;
    return t * w;
  }
  if (ix >= 0x7ff00000) return x * x;
  return HUGE * HUGE;
}

export function tanh(x: number): number {
  const jx = hiWord(x);
  const ix = jx & 0x7fffffff;
  let z: number;
  if (ix >= 0x7ff00000) {
    if (jx >= 0) return 1.0 / x + 1.0;
    return 1.0 / x - 1.0;
  }
  if (ix < 0x40360000) {
    // |x| < 22
    if (ix < 0x3e300000) return x; // |x| < 2^-28
    if (ix >= 0x3ff00000) {
      const t = expm1(2.0 * abs(x));
      z = 1.0 - 2.0 / (t + 2.0);
    } else {
      const t = expm1(-2.0 * abs(x));
      z = -t / (t + 2.0);
    }
  } else {
    z = 1.0 - TINY;
  }
  return jx >= 0 ? z : -z;
}

const LN2 = 6.93147180559945286227e-01;

export function asinh(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  let w: number;
  if (ix >= 0x7ff00000) return x + x;
  if (ix < 0x3e300000) return x;
  if (ix > 0x41b00000) {
    w = log(abs(x)) + LN2;
  } else if (ix > 0x40000000) {
    const t = abs(x);
    w = log(2.0 * t + 1.0 / (sqrt(x * x + 1.0) + t));
  } else {
    const t = x * x;
    w = log1p(abs(x) + t / (1.0 + sqrt(1.0 + t)));
  }
  return hx > 0 ? w : -w;
}

export function acosh(x: number): number {
  const hx = hiWord(x);
  const lx = loWord(x);
  if (hx < 0x3ff00000) return (x - x) / (x - x);
  if (hx >= 0x41b00000) {
    if (hx >= 0x7ff00000) return x + x;
    return log(x) + LN2;
  }
  if (((hx - 0x3ff00000) | lx) === 0) return 0.0;
  if (hx > 0x40000000) {
    const t = x * x;
    return log(2.0 * x - 1.0 / (x + sqrt(t - 1.0)));
  }
  const t = x - 1.0;
  return log1p(t + sqrt(2.0 * t + t * t));
}

export function atanh(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  if (x !== x) return x + x;
  const ax = abs(x);
  if (ax > 1) return NaN;
  if (ax === 1) return x > 0 ? Infinity : -Infinity;
  if (ix < 0x3e300000) return x;
  let t: number;
  if (ix < 0x3fe00000) {
    t = ax + ax;
    t = 0.5 * log1p(t + (t * ax) / (1.0 - ax));
  } else {
    t = 0.5 * log1p((ax + ax) / (1.0 - ax));
  }
  return hx >= 0 ? t : -t;
}

// ------------------------------------------------------------------ cbrt
const B1 = 715094163;
const B2 = 696219795;
const CP0 = 1.87595182427177009643;
const CP1 = -1.88497979543377169875;
const CP2 = 1.621429720105354466140;
const CP3 = -0.758397934778766047437;
const CP4 = 0.145996192886612446982;

export function cbrt(x: number): number {
  let hx = hiWord(x);
  const low = loWord(x);
  const sign = hx & 0x80000000;
  hx ^= sign;
  if (hx >= 0x7ff00000) return x + x;
  let t: number;
  if (hx < 0x00100000) {
    // zero or subnormal
    if ((hx | low) === 0) return x;
    t = fromWords(0x43500000, 0) * x;
    const high = hiWord(t);
    t = fromWords(sign | (toInt((high & 0x7fffffff) / 3) + B2), 0);
  } else {
    t = fromWords(sign | (toInt(hx / 3) + B1), 0);
  }
  // new cbrt to 23 bits
  let r = t * t * (t / x);
  t = t * (CP0 + r * (CP1 + r * CP2) + r * r * r * (CP3 + r * CP4));
  // round t away from zero to 23 bits: bits = (bits + 0x80000000) & 0xffffffffc0000000
  F[0] = t;
  const sum = U[LW] + 0x80000000;
  if (sum >= 0x100000000) I[HW] = I[HW] + 1;
  U[LW] = (sum >>> 0) & 0xc0000000;
  t = F[0];
  // one step Newton iteration to 53 bits with error < 0.667 ulps
  const s = t * t;
  r = x / s;
  const w = t + t;
  r = (r - t) / (w + r);
  return t + t * r;
}

// ------------------------------------------------------------------ pow
const BP = [1.0, 1.5];
const DP_H = [0.0, 5.84962487220764160156e-01];
const DP_L = [0.0, 1.35003920212974897128e-08];
const TWO53 = 9007199254740992.0;
const L1 = 5.99999999999994648725e-01;
const L2 = 4.28571428578550184252e-01;
const L3 = 3.33333329818377432918e-01;
const L4 = 2.72728123808534006489e-01;
const L5 = 2.30660745775561754067e-01;
const L6 = 2.06975017800338417784e-01;
const LG2_ = 6.93147180559945286227e-01;
const LG2_H = 6.93147182464599609375e-01;
const LG2_L = -1.90465429995776804525e-09;
const OVT = 8.0085662595372944372e-17;
const CP = 9.61796693925975554329e-01;
const CP_H = 9.61796700954437255859e-01;
const CP_L = -7.02846165095275826516e-09;
const IVLN2 = 1.44269504088896338700e+00;
const IVLN2_H = 1.44269502162933349609e+00;
const IVLN2_L = 1.92596299112661746887e-08;

export function pow(x: number, y: number): number {
  const hx = hiWord(x);
  const lx = loWord(x);
  const hy = hiWord(y);
  const ly = loWord(y);
  let ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;
  let z: number;
  let t1: number;
  let t2: number;
  let r: number;
  let t: number;
  let u: number;
  let v: number;
  let w: number;
  let i: number;
  let j: number;
  let k: number;
  let n: number;

  // y == 0: x**0 = 1
  if ((iy | ly) === 0) return 1.0;
  // NaN
  if (x !== x || y !== y) return x + y;

  // yisint = 0: not an integer, 1: odd integer, 2: even integer (only for x < 0)
  let yisint = 0;
  if (hx < 0) {
    if (iy >= 0x43400000) {
      yisint = 2;
    } else if (iy >= 0x3ff00000) {
      k = (iy >> 20) - 0x3ff;
      if (k > 20) {
        j = ly >>> (52 - k);
        if (((j << (52 - k)) >>> 0) === ly) yisint = 2 - (j & 1);
      } else if (ly === 0) {
        j = iy >> (20 - k);
        if (j << (20 - k) === iy) yisint = 2 - (j & 1);
      }
    }
  }

  // special value of y
  if (ly === 0) {
    if (iy === 0x7ff00000) {
      // y is +-inf
      if (((ix - 0x3ff00000) | lx) === 0) return y - y; // (+-1)**+-inf is NaN
      if (ix >= 0x3ff00000) return hy >= 0 ? y : 0.0; // (|x|>1)**+-inf = inf, 0
      return hy < 0 ? -y : 0.0; // (|x|<1)**-,+inf = inf, 0
    }
    if (iy === 0x3ff00000) {
      // y is +-1
      if (hy < 0) return 1.0 / x;
      return x;
    }
    if (hy === 0x40000000) return x * x; // y is 2
    if (hy === 0x3fe00000) {
      // y is 0.5
      if (hx >= 0) return sqrt(x);
    }
  }

  let ax = abs(x);
  // special value of x
  if (lx === 0) {
    if (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000) {
      z = ax; // x is +-0, +-inf, +-1
      if (hy < 0) z = 1.0 / z;
      if (hx < 0) {
        if (((ix - 0x3ff00000) | yisint) === 0) z = NaN; // (-1)**non-int is NaN
        else if (yisint === 1) z = -z;
      }
      return z;
    }
  }

  n = (hx >> 31) + 1;
  // (x<0)**(non-int) is NaN
  if ((n | yisint) === 0) return NaN;

  let s = 1.0; // sign of result
  if ((n | (yisint - 1)) === 0) s = -1.0;

  // |y| is huge
  if (iy > 0x41e00000) {
    // |y| > 2^31
    if (iy > 0x43f00000) {
      // |y| > 2^64, must o/uflow
      if (ix <= 0x3fefffff) return hy < 0 ? HUGE * HUGE : TINY * TINY;
      if (ix >= 0x3ff00000) return hy > 0 ? HUGE * HUGE : TINY * TINY;
    }
    // over/underflow if x is not close to one
    if (ix < 0x3fefffff) return hy < 0 ? s * HUGE * HUGE : s * TINY * TINY;
    if (ix > 0x3ff00000) return hy > 0 ? s * HUGE * HUGE : s * TINY * TINY;
    // now |1-x| is tiny <= 2^-20
    t = ax - 1.0;
    w = t * t * (0.5 - t * (0.3333333333333333333333 - t * 0.25));
    u = IVLN2_H * t;
    v = t * IVLN2_L - w * IVLN2;
    t1 = clearLo(u + v);
    t2 = v - (t1 - u);
  } else {
    n = 0;
    // take care subnormal number
    if (ix < 0x00100000) {
      ax *= TWO53;
      n -= 53;
      ix = hiWord(ax);
    }
    n += (ix >> 20) - 0x3ff;
    j = ix & 0x000fffff;
    // determine interval
    ix = j | 0x3ff00000;
    if (j <= 0x3988e) {
      k = 0; // |x| < sqrt(3/2)
    } else if (j < 0xbb67a) {
      k = 1; // |x| < sqrt(3)
    } else {
      k = 0;
      n += 1;
      ix -= 0x00100000;
    }
    ax = withHi(ax, ix);

    // compute ss = s_h + s_l = (x-1)/(x+1) or (x-1.5)/(x+1.5)
    u = ax - BP[k];
    v = 1.0 / (ax + BP[k]);
    const ss = u * v;
    const sh = clearLo(ss);
    // t_h = ax + bp[k] High
    let th = fromWords(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18), 0);
    let tl = ax - (th - BP[k]);
    const sl = v * (u - sh * th - sh * tl);
    // compute log(ax)
    let s2 = ss * ss;
    r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += sl * (sh + ss);
    s2 = sh * sh;
    th = clearLo(3.0 + s2 + r);
    tl = r - (th - 3.0 - s2);
    // u + v = ss * (1 + ...)
    u = sh * th;
    v = sl * th + tl * ss;
    // 2/(3log2) * (ss + ...)
    const ph = clearLo(u + v);
    const pl = v - (ph - u);
    const zh = CP_H * ph;
    const zl = CP_L * ph + pl * CP + DP_L[k];
    // log2(ax) = (ss + ..) * 2/(3*log2) = n + dp_h + z_h + z_l
    t = n;
    t1 = clearLo(zh + zl + DP_H[k] + t);
    t2 = zl - (t1 - t - DP_H[k] - zh);
  }

  // split up y into y1 + y2 and compute (y1 + y2) * (t1 + t2)
  const y1 = clearLo(y);
  let pl = (y - y1) * t1 + y * t2;
  let ph = y1 * t1;
  z = pl + ph;
  j = hiWord(z);
  i = loWord(z);
  if (j >= 0x40900000) {
    // z >= 1024
    if (((j - 0x40900000) | i) !== 0) return s * HUGE * HUGE;
    if (pl + OVT > z - ph) return s * HUGE * HUGE;
  } else if ((j & 0x7fffffff) >= 0x4090cc00) {
    // z <= -1075
    if (((j - (0xc090cc00 | 0)) | i) !== 0) return s * TINY * TINY;
    if (pl <= z - ph) return s * TINY * TINY;
  }

  // compute 2**(p_h + p_l)
  i = j & 0x7fffffff;
  k = (i >> 20) - 0x3ff;
  n = 0;
  if (i > 0x3fe00000) {
    // if |z| > 0.5, set n = [z + 0.5]
    n = j + (0x00100000 >> (k + 1));
    k = ((n & 0x7fffffff) >> 20) - 0x3ff;
    t = fromWords(n & ~(0x000fffff >> k), 0);
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    ph -= t;
  }
  t = clearLo(pl + ph);
  u = t * LG2_H;
  v = (pl - (t - ph)) * LG2_ + t * LG2_L;
  z = u + v;
  w = v - (z - u);
  t = z * z;
  t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  r = (z * t1) / (t1 - 2.0 - (w + z * w));
  z = 1.0 - (r - z);
  j = hiWord(z);
  j += n << 20;
  if (j >> 20 <= 0) z = scalbn(z, n); // subnormal output
  else z = withHi(z, hiWord(z) + (n << 20));
  return s * z;
}

// ------------------------------------------------------------------ hypot
/**
 * Math.hypot as V8 computes it (normalize by the largest magnitude, Kahan
 * summation of the squares, sqrt): bit-identical to V8, only basic operations.
 */
export const hypot = hypotN as (...values: number[]) => number;

function hypotN(a: number, b: number): number {
  const n = arguments.length;
  if (n === 2) return hypot2(+a, +b);
  if (n === 0) return 0;
  const vals: number[] = [];
  let nan = false;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const v = +(arguments[i] as number);
    if (v !== v) {
      nan = true;
      vals.push(0);
    } else {
      const av = abs(v);
      vals.push(av);
      if (av > max) max = av;
    }
  }
  if (max === Infinity) return Infinity;
  if (nan) return NaN;
  if (max === 0) return 0;
  let sum = 0;
  let comp = 0;
  for (let i = 0; i < n; i++) {
    const r = vals[i] / max;
    const summand = r * r - comp;
    const prelim = sum + summand;
    comp = prelim - sum - summand;
    sum = prelim;
  }
  return sqrt(sum) * max;
}

/** Two-argument hypot (the common case), same algorithm and results as `hypot`. */
export function hypot2(a: number, b: number): number {
  let nan = false;
  let max = 0;
  let av = 0;
  let bv = 0;
  if (a !== a) nan = true;
  else {
    av = abs(a);
    if (av > max) max = av;
  }
  if (b !== b) nan = true;
  else {
    bv = abs(b);
    if (bv > max) max = bv;
  }
  if (max === Infinity) return Infinity;
  if (nan) return NaN;
  if (max === 0) return 0;
  // the Kahan compensation after the first term is always exactly 0
  const ra = av / max;
  const rb = bv / max;
  return sqrt(ra * ra + rb * rb) * max;
}

// ------------------------------------------------------------------ install
/** The `Math` methods replaced by `installDeterministicMath()`. */
export const DETERMINISTIC_MATH = {
  sin, cos, tan, asin, acos, atan, atan2, exp, expm1, log, log1p, log2, log10, pow, hypot, cbrt, sinh, cosh, tanh, asinh, acosh, atanh,
} as const;

/** The engine's own implementations, saved before installing (benchmarks, tests). */
export const nativeMath: { -readonly [K in keyof typeof DETERMINISTIC_MATH]: (...a: number[]) => number } = {} as never;
for (const k of Object.keys(DETERMINISTIC_MATH) as (keyof typeof DETERMINISTIC_MATH)[]) {
  nativeMath[k] = (Math as unknown as Record<string, (...a: number[]) => number>)[k];
}

let installed = false;

/**
 * Replace the engine's transcendental `Math` functions with the deterministic
 * ports above, so every peer of a lockstep game computes identical bits (also in
 * code that calls `Math.sin` directly). Idempotent. Call once at startup, before
 * any simulation runs. Note: the `**` operator does not go through `Math.pow`;
 * simulation code must use `Math.pow` or plain multiplication instead.
 */
export function installDeterministicMath(): void {
  if (installed) return;
  installed = true;
  for (const [k, fn] of Object.entries(DETERMINISTIC_MATH)) {
    Object.defineProperty(Math, k, { value: fn, writable: true, configurable: true, enumerable: false });
  }
}

/** True once `installDeterministicMath()` ran. */
export function deterministicMathInstalled(): boolean {
  return installed;
}
