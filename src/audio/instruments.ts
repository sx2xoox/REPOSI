// Music instruments: each returns a function that schedules one note.
// Dark-fantasy chiptune palette (pulse leads, stepped triangle bass, noise
// drums) blended with ambient voices (pads, choir, bells, organ).
//
// Gains are calibrated so a single note at vel 1 peaks around 0.2-0.35; the
// song mixer's channel volumes do the rest.

import { Patch, crushCurve, driveCurve, envAD, envADSR, harmonicWave, mtof, rnd, type Ctx, type Wave } from './synth';

export type Instrument = (ctx: Ctx, out: AudioNode, t: number, midi: number, dur: number, vel: number) => void;
export type Kit = Record<string, Instrument>;

const P = (ctx: Ctx, out: AudioNode, t: number, vol: number) => new Patch(ctx, out, t, { vol, stretch: 1 });

// ---------------------------------------------------------------------------
// Melodic voices
// ---------------------------------------------------------------------------

export interface LeadOpts {
  wave?: Wave;
  gain?: number;
  a?: number;
  d?: number;
  s?: number;
  r?: number;
  /** vibrato depth in cents */
  vib?: number;
  vibRate?: number;
  vibDelay?: number;
  cutoff?: number;
  /** second detuned oscillator (cents) */
  detune?: number;
  /** octave layer gain (0 = off) */
  octave?: number;
  /** quick pitch scoop into the note (semitones) */
  scoop?: number;
  crush?: number;
}

/** Chip lead (pulse wave), optional detuned double and vibrato. */
export function lead(o: LeadOpts = {}): Instrument {
  const wave = o.wave ?? 'pulse25';
  return (ctx, out, t, m, dur, vel) => {
    const p = P(ctx, out, t, vel * (o.gain ?? 0.22));
    const f = mtof(m);
    const flt = p.filter('lowpass', o.cutoff ?? 3200, 0.9);
    let pre: AudioNode = flt;
    if (o.crush) {
      const c = p.shaper(crushCurve(o.crush));
      flt.connect(c);
      pre = c;
    }
    const env = p.gain(0, p.out);
    pre.connect(env);
    const end = envADSR(env.gain, t, o.a ?? 0.008, o.d ?? 0.25, o.s ?? 0.65, dur, o.r ?? 0.12, 1);
    const oscs: OscillatorNode[] = [p.osc(wave, f)];
    if (o.detune) {
      const o2 = p.osc(wave, f);
      o2.detune.value = o.detune;
      oscs.push(o2);
    }
    if (o.octave) {
      const o3 = p.osc('triangle', f * 2);
      const g = p.gain(o.octave, flt);
      o3.connect(g);
      p.run(o3, t, end);
    }
    for (const osc of oscs) {
      if (o.scoop) {
        osc.frequency.setValueAtTime(f * Math.pow(2, -o.scoop / 12), t);
        osc.frequency.exponentialRampToValueAtTime(f, t + 0.06);
      }
      if (o.vib !== 0 && dur > 0.25) p.vibrato(osc.detune, t, o.vibRate ?? 5.2, o.vib ?? 14, Math.min(dur * 0.45, o.vibDelay ?? 0.22), end);
      osc.connect(oscs.length > 1 ? p.gain(0.6, flt) : flt);
      p.run(osc, t, end);
    }
  };
}

/** Breathy flute / ocarina: triangle + sine octave + filtered breath noise. */
export function flute(o: { gain?: number; breath?: number; vib?: number; a?: number; r?: number } = {}): Instrument {
  return (ctx, out, t, m, dur, vel) => {
    const p = P(ctx, out, t, vel * (o.gain ?? 0.24));
    const f = mtof(m);
    const env = p.gain(0, p.out);
    const end = envADSR(env.gain, t, o.a ?? 0.05, 0.3, 0.8, dur, o.r ?? 0.18, 1);
    const tri = p.osc('triangle', f);
    const sin = p.osc('sine', f * 2);
    const sg = p.gain(0.18, env);
    tri.connect(env);
    sin.connect(sg);
    if (dur > 0.3) {
      p.vibrato(tri.detune, t, 4.8, o.vib ?? 12, Math.min(0.3, dur * 0.4), end);
    }
    const br = p.noiseSrc('white');
    const bp = p.filter('bandpass', Math.min(9000, f * 2.2), 1.6);
    const bg = p.gain(0, p.out);
    br.connect(bp).connect(bg);
    envADSR(bg.gain, t, 0.03, 0.12, 0.35, dur * 0.8, 0.1, o.breath ?? 0.16);
    p.run(tri, t, end);
    p.run(sin, t, end);
    p.run(br, t, end, Math.random());
  };
}

/** Plucked string (lute / harp): bright saw through a closing lowpass. */
export function pluck(o: { gain?: number; decay?: number; bright?: number; wave?: Wave; q?: number } = {}): Instrument {
  return (ctx, out, t, m, dur, vel) => {
    const p = P(ctx, out, t, vel * (o.gain ?? 0.22));
    const f = mtof(m);
    const decay = Math.min(o.decay ?? 0.9, Math.max(0.12, dur * 2.2));
    const osc = p.osc(o.wave ?? 'sawtooth', f);
    const lp = p.filter('lowpass', Math.min(16000, f * (o.bright ?? 9)), o.q ?? 1.2);
    lp.frequency.setValueAtTime(Math.min(16000, f * (o.bright ?? 9)), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(80, f * 1.2), t + decay * 0.6);
    const env = p.gain(0, p.out);
    osc.connect(lp).connect(env);
    const end = envAD(env.gain, t, 0.002, decay, 1);
    p.run(osc, t, end);
  };
}

export interface BellOpts {
  gain?: number;
  ratio?: number;
  index?: number;
  decay?: number;
  /** extra inharmonic partial (gong / lantern shimmer) */
  partial?: number;
  partialGain?: number;
}

/** FM bell / celesta / music box. Rings independently of note length. */
export function bell(o: BellOpts = {}): Instrument {
  return (ctx, out, t, m, _dur, vel) => {
    const p = P(ctx, out, t, vel * (o.gain ?? 0.2));
    const f = mtof(m);
    const decay = (o.decay ?? 1.6) * Math.min(1.4, Math.max(0.5, 440 / f + 0.5));
    p.fm({ f, ratio: o.ratio ?? 3.5, index: [o.index ?? 2.2, 0.15], dur: decay, a: 0.002, gain: 1 });
    if (o.partial) {
      p.tone({ wave: 'sine', f: f * o.partial, dur: decay * 0.45, gain: o.partialGain ?? 0.25 });
    }
  };
}

export interface PadOpts {
  wave?: Wave;
  gain?: number;
  voices?: number;
  detune?: number;
  cutoff?: number;
  q?: number;
  a?: number;
  r?: number;
  /** slow filter wobble depth (Hz) */
  wobble?: number;
  wobbleRate?: number;
  sub?: number;
}

/** Warm detuned pad (one note; the sequencer calls it per chord tone). */
export function pad(o: PadOpts = {}): Instrument {
  return (ctx, out, t, m, dur, vel) => {
    const p = P(ctx, out, t, vel * (o.gain ?? 0.07));
    const f = mtof(m);
    const n = o.voices ?? 2;
    const lp = p.filter('lowpass', o.cutoff ?? 1300, o.q ?? 0.6);
    const env = p.gain(0, p.out);
    lp.connect(env);
    const end = envADSR(env.gain, t, o.a ?? 0.7, 0.5, 0.85, dur, o.r ?? 1.4, 1);
    for (let i = 0; i < n; i++) {
      const osc = p.osc(o.wave ?? 'sawtooth', f);
      osc.detune.value = n === 1 ? 0 : ((i / (n - 1)) * 2 - 1) * (o.detune ?? 9) + rnd(-2, 2);
      osc.connect(p.gain(1 / n, lp));
      p.run(osc, t, end);
    }
    if (o.wobble) {
      const lfo = p.osc('sine', o.wobbleRate ?? 0.25);
      const g = p.gain(o.wobble, lp.frequency);
      lfo.connect(g);
      p.run(lfo, t, end);
    }
    if (o.sub) {
      const s = p.osc('sine', f / 2);
      s.connect(p.gain(o.sub, env));
      p.run(s, t, end);
    }
  };
}

const VOWELS: Record<string, [number, number, number]> = {
  a: [800, 1150, 2900],
  o: [450, 800, 2830],
  u: [325, 700, 2530],
  e: [400, 1700, 2600],
};

/** Formant choir ("ah"/"oo"): saw + pulse through three vowel band-passes. */
export function choir(o: { gain?: number; vowel?: keyof typeof VOWELS; a?: number; r?: number; bright?: number } = {}): Instrument {
  const fm = VOWELS[o.vowel ?? 'a'];
  return (ctx, out, t, m, dur, vel) => {
    const p = P(ctx, out, t, vel * (o.gain ?? 0.16));
    const f = mtof(m);
    const env = p.gain(0, p.out);
    const end = envADSR(env.gain, t, o.a ?? 0.5, 0.4, 0.9, dur, o.r ?? 1.0, 1);
    const mix = p.gain(1);
    const amps = [1, 0.55, 0.2 * (o.bright ?? 1)];
    fm.forEach((ff, i) => {
      const bp = p.filter('bandpass', ff, 7 + i * 2);
      mix.connect(bp);
      bp.connect(p.gain(amps[i] * 2.4, env));
    });
    const s1 = p.osc('sawtooth', f);
    const s2 = p.osc('pulse33', f);
    s2.detune.value = 7;
    s1.connect(p.gain(0.6, mix));
    s2.connect(p.gain(0.5, mix));
    // a soft fundamental keeps the voice from sounding hollow
    const fund = p.osc('sine', f);
    fund.connect(p.gain(0.25, env));
    p.vibrato(s1.detune, t, 5.1, 13, 0.25, end);
    p.vibrato(s2.detune, t, 4.7, 11, 0.3, end);
    for (const s of [s1, s2, fund]) p.run(s, t, end);
  };
}

/** Additive pipe organ (drawbar-ish) with gentle tremolo. */
export function organ(o: { gain?: number; bright?: number; a?: number; r?: number } = {}): Instrument {
  return (ctx, out, t, m, dur, vel) => {
    const p = P(ctx, out, t, vel * (o.gain ?? 0.12));
    const f = mtof(m);
    const b = o.bright ?? 1;
    const w = harmonicWave(ctx, `organ${b}`, [1, 0.7 * b, 0.45 * b, 0.4 * b, 0, 0.2 * b, 0, 0.18 * b]);
    const osc = p.osc(w, f);
    const sub = p.osc('sine', f / 2);
    const env = p.gain(0, p.out);
    osc.connect(env);
    sub.connect(p.gain(f < 220 ? 0.08 : 0.3, env));
    const end = envADSR(env.gain, t, o.a ?? 0.04, 0.2, 0.9, dur, o.r ?? 0.25, 1);
    p.tremolo(env.gain, t, 5.5, 0.06, end);
    p.run(osc, t, end);
    p.run(sub, t, end);
  };
}

/** Bowed strings ensemble; short notes become staccato ostinato. */
export function strings(o: { gain?: number; cutoff?: number; a?: number; r?: number; voices?: number } = {}): Instrument {
  return (ctx, out, t, m, dur, vel) => {
    const p = P(ctx, out, t, vel * (o.gain ?? 0.1));
    const f = mtof(m);
    const n = o.voices ?? 3;
    const lp = p.filter('lowpass', o.cutoff ?? 2400, 0.8);
    const env = p.gain(0, p.out);
    lp.connect(env);
    const a = Math.min(o.a ?? 0.12, dur * 0.4);
    const end = envADSR(env.gain, t, a, 0.3, 0.8, dur, o.r ?? 0.25, 1);
    for (let i = 0; i < n; i++) {
      const osc = p.osc('sawtooth', f);
      osc.detune.value = (i - (n - 1) / 2) * 7;
      osc.connect(p.gain(1 / n, lp));
      if (dur > 0.4) p.vibrato(osc.detune, t, 5 + i * 0.4, 10, 0.2, end);
      p.run(osc, t, end);
    }
  };
}

/** Chip brass: detuned saws with a filter swell on the attack. */
export function brass(o: { gain?: number; cutoff?: number } = {}): Instrument {
  return (ctx, out, t, m, dur, vel) => {
    const p = P(ctx, out, t, vel * (o.gain ?? 0.16));
    const f = mtof(m);
    const c = o.cutoff ?? 2600;
    const lp = p.filter('lowpass', 300, 2);
    lp.frequency.setValueAtTime(Math.min(300, f), t);
    lp.frequency.exponentialRampToValueAtTime(c, t + 0.05);
    lp.frequency.exponentialRampToValueAtTime(c * 0.55, t + 0.35);
    const env = p.gain(0, p.out);
    lp.connect(env);
    const end = envADSR(env.gain, t, 0.025, 0.3, 0.75, dur, 0.15, 1);
    for (const d of [-6, 6]) {
      const osc = p.osc('sawtooth', f);
      osc.detune.value = d;
      osc.frequency.setValueAtTime(f * 0.97, t);
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.05);
      osc.connect(p.gain(0.5, lp));
      if (dur > 0.4) p.vibrato(osc.detune, t, 5.5, 12, 0.25, end);
      p.run(osc, t, end);
    }
  };
}

// ---------------------------------------------------------------------------
// Bass voices
// ---------------------------------------------------------------------------

/** NES-like stepped triangle bass. */
export function triBass(o: { gain?: number; steps?: number; r?: number } = {}): Instrument {
  return (ctx, out, t, m, dur, vel) => {
    const p = P(ctx, out, t, vel * (o.gain ?? 0.34));
    const f = mtof(m);
    const osc = p.osc('triangle', f);
    const cr = p.shaper(crushCurve(o.steps ?? 8));
    const lp = p.filter('lowpass', 2400, 0.5);
    const env = p.gain(0, p.out);
    osc.connect(cr).connect(lp).connect(env);
    const end = envADSR(env.gain, t, 0.004, 0.2, 0.85, dur * 0.92, o.r ?? 0.06, 1);
    p.run(osc, t, end);
  };
}

/** Driving saw bass with filter pluck and drive (boss / forge). */
export function sawBass(o: { gain?: number; cutoff?: number; drive?: number; env?: number; q?: number } = {}): Instrument {
  return (ctx, out, t, m, dur, vel) => {
    const p = P(ctx, out, t, vel * (o.gain ?? 0.22));
    const f = mtof(m);
    const c = o.cutoff ?? 700;
    const lp = p.filter('lowpass', c, o.q ?? 3);
    lp.frequency.setValueAtTime(c * (o.env ?? 3.5), t);
    lp.frequency.exponentialRampToValueAtTime(c, t + Math.min(0.18, dur * 0.8));
    const sh = p.shaper(driveCurve(o.drive ?? 2.2));
    const env = p.gain(0, p.out);
    lp.connect(sh).connect(env);
    const end = envADSR(env.gain, t, 0.003, 0.15, 0.7, dur * 0.9, 0.05, 1);
    const s = p.osc('sawtooth', f);
    const q = p.osc('pulse25', f);
    q.detune.value = 7;
    const sub = p.osc('sine', f / 2);
    s.connect(p.gain(0.55, lp));
    q.connect(p.gain(0.35, lp));
    sub.connect(p.gain(0.25, env));
    p.run(sub, t, end);
    p.run(s, t, end);
    p.run(q, t, end);
  };
}

/** Clean sine sub (with a touch of 2nd harmonic for small speakers). */
export function subBass(o: { gain?: number; r?: number; glide?: number } = {}): Instrument {
  return (ctx, out, t, m, dur, vel) => {
    const p = P(ctx, out, t, vel * (o.gain ?? 0.36));
    const f = mtof(m);
    const s = p.osc('sine', f);
    if (o.glide) {
      s.frequency.setValueAtTime(f * Math.pow(2, o.glide / 12), t);
      s.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    }
    const h = p.osc('triangle', f * 2);
    const env = p.gain(0, p.out);
    s.connect(env);
    h.connect(p.gain(0.12, env));
    const end = envADSR(env.gain, t, 0.01, 0.3, 0.9, dur * 0.95, o.r ?? 0.12, 1);
    p.run(s, t, end);
    p.run(h, t, end);
  };
}

// ---------------------------------------------------------------------------
// Drums (one-shots; `midi` is ignored except where noted, `dur` ignored)
// ---------------------------------------------------------------------------

export interface KitOpts {
  gain?: number;
  /** extra crunch on drums (chip flavour) */
  chip?: boolean;
  tune?: number;
}

export function kit(o: KitOpts = {}): Kit {
  const g = o.gain ?? 1;
  const tune = o.tune ?? 1;
  const noiseColor = o.chip ? 'chip' : 'white';
  return {
    kick: (ctx, out, t, _m, _d, vel) => {
      const p = P(ctx, out, t, vel * g * 0.5);
      p.tone({ wave: 'sine', f: [150 * tune, 48 * tune], sweep: 0.11, dur: 0.32, gain: 1 });
      p.tone({ wave: 'triangle', f: [400, 90], sweep: 0.03, dur: 0.04, gain: 0.35 });
      p.noise({ dur: 0.012, gain: 0.25, filter: { type: 'highpass', f: 3000 } });
    },
    snare: (ctx, out, t, _m, _d, vel) => {
      const p = P(ctx, out, t, vel * g * 0.34);
      p.tone({ wave: 'triangle', f: [240 * tune, 165 * tune], sweep: 0.06, dur: 0.1, gain: 0.7 });
      p.noise({ color: noiseColor, dur: 0.17, gain: 0.85, filter: { type: 'bandpass', f: 2600, q: 0.7 }, filter2: { type: 'highpass', f: 900 } });
    },
    clap: (ctx, out, t, _m, _d, vel) => {
      const p = P(ctx, out, t, vel * g * 0.32);
      for (let i = 0; i < 3; i++) p.noise({ at: i * 0.011, dur: i === 2 ? 0.16 : 0.012, gain: 0.8, filter: { type: 'bandpass', f: 1500, q: 1.4 } });
    },
    hat: (ctx, out, t, _m, _d, vel) => {
      const p = P(ctx, out, t, vel * g * 0.16);
      p.noise({ color: noiseColor, dur: 0.045, gain: 1, filter: { type: 'highpass', f: 7000 }, filter2: { type: 'peaking' as BiquadFilterType, f: 10000, q: 1 } });
    },
    ohat: (ctx, out, t, _m, _d, vel) => {
      const p = P(ctx, out, t, vel * g * 0.13);
      p.noise({ color: noiseColor, dur: 0.3, gain: 1, filter: { type: 'highpass', f: 6500 } });
    },
    shaker: (ctx, out, t, _m, _d, vel) => {
      const p = P(ctx, out, t, vel * g * 0.12);
      p.noise({ dur: 0.07, a: 0.018, gain: 1, filter: { type: 'bandpass', f: 6000, q: 1.2 } });
    },
    rim: (ctx, out, t, _m, _d, vel) => {
      const p = P(ctx, out, t, vel * g * 0.2);
      p.tone({ wave: 'square', f: 1750 * tune, dur: 0.025, gain: 0.5, filter: { type: 'bandpass', f: 1900, q: 3 } });
      p.noise({ dur: 0.02, gain: 0.6, filter: { type: 'highpass', f: 4000 } });
    },
    tom: (ctx, out, t, m, _d, vel) => {
      const base = (m > 0 ? mtof(m) : 110) * tune;
      const p = P(ctx, out, t, vel * g * 0.4);
      p.tone({ wave: 'sine', f: [base * 1.6, base], sweep: 0.08, dur: 0.38, gain: 1 });
      p.noise({ dur: 0.05, gain: 0.25, filter: { type: 'lowpass', f: 1800 } });
    },
    boom: (ctx, out, t, _m, _d, vel) => {
      // taiko-like: low membrane + skin slap
      const p = P(ctx, out, t, vel * g * 0.55);
      p.tone({ wave: 'sine', f: [95 * tune, 42 * tune], sweep: 0.25, dur: 0.9, gain: 1 });
      p.tone({ wave: 'triangle', f: [210 * tune, 120 * tune], sweep: 0.05, dur: 0.12, gain: 0.35 });
      p.noise({ color: 'brown', dur: 0.25, gain: 0.5, filter: { type: 'lowpass', f: 600 } });
    },
    timpani: (ctx, out, t, m, _d, vel) => {
      const f = m > 0 ? mtof(m) : 87;
      const p = P(ctx, out, t, vel * g * 0.4);
      p.tone({ wave: 'sine', f: [f * 1.03, f], sweep: 0.1, dur: 1.2, gain: 1 });
      p.tone({ wave: 'sine', f: f * 1.5, dur: 0.6, gain: 0.3 });
      p.tone({ wave: 'sine', f: f * 1.98, dur: 0.35, gain: 0.18 });
      p.noise({ dur: 0.06, gain: 0.3, filter: { type: 'lowpass', f: 1200 } });
    },
    crash: (ctx, out, t, _m, _d, vel) => {
      const p = P(ctx, out, t, vel * g * 0.15);
      p.noise({ dur: 1.6, gain: 1, filter: { type: 'highpass', f: 3500 }, filter2: { type: 'peaking' as BiquadFilterType, f: 6000, q: 0.8 } });
      p.noise({ color: 'chip', dur: 0.6, gain: 0.4, filter: { type: 'bandpass', f: 4500, q: 0.8 } });
    },
    anvil: (ctx, out, t, m, _d, vel) => {
      // forge hammer on anvil: inharmonic metallic ring + hard transient
      const f = m > 0 ? mtof(m) : 880;
      const p = P(ctx, out, t, vel * g * 0.22);
      p.fm({ f, ratio: 2.76, index: [6, 0.3], dur: 0.9, gain: 0.7 });
      p.fm({ f: f * 1.51, ratio: 1.41, index: [3, 0.1], dur: 0.5, gain: 0.35 });
      p.noise({ dur: 0.03, gain: 0.8, filter: { type: 'highpass', f: 2500 } });
    },
    chain: (ctx, out, t, _m, _d, vel) => {
      const p = P(ctx, out, t, vel * g * 0.14);
      p.noise({ color: 'crackle', dur: 0.35, a: 0.02, gain: 1, filter: { type: 'bandpass', f: 4200, q: 2 } });
    },
    glitch: (ctx, out, t, _m, _d, vel) => {
      const p = P(ctx, out, t, vel * g * 0.12);
      p.tone({ wave: 'square', f: rnd(900, 3200), dur: 0.03, gain: 0.6, crush: 3 });
      p.noise({ color: 'chip', rate: 0.25, dur: 0.05, gain: 0.7, filter: { type: 'highpass', f: 2000 } });
    },
    swell: (ctx, out, t, _m, dur, vel) => {
      // reversed-cymbal style riser (length = note duration)
      const p = P(ctx, out, t, vel * g * 0.12);
      const d = Math.max(0.3, dur);
      const n = p.noiseSrc('white');
      const bp = p.filter('bandpass', 600, 1.5);
      bp.frequency.setValueAtTime(500, t);
      bp.frequency.exponentialRampToValueAtTime(7000, t + d);
      const env = p.gain(0, p.out);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(1, t + d);
      env.gain.linearRampToValueAtTime(0, t + d + 0.03);
      n.connect(bp).connect(env);
      p.run(n, t, t + d + 0.05, Math.random());
    },
  };
}

// ---------------------------------------------------------------------------
// Ambient one-shots used by songs' procedural layers
// ---------------------------------------------------------------------------

/** Water drip: quick upward sine chirp. */
export const drip: Instrument = (ctx, out, t, m, _d, vel) => {
  const p = P(ctx, out, t, vel * 0.14);
  const f = mtof(m);
  p.tone({ wave: 'sine', f: [f * 0.7, f * 1.6], sweep: 0.05, dur: 0.09, gain: 1 });
};

/** Filtered wind gust over `dur` seconds. */
export const wind: Instrument = (ctx, out, t, m, dur, vel) => {
  const p = P(ctx, out, t, vel * 0.1);
  const f = m > 0 ? mtof(m) : 600;
  const n = p.noiseSrc('pink');
  const bp = p.filter('bandpass', f, 2.5);
  bp.frequency.setValueAtTime(f * 0.6, t);
  bp.frequency.linearRampToValueAtTime(f * 1.4, t + dur * 0.5);
  bp.frequency.linearRampToValueAtTime(f * 0.7, t + dur);
  const env = p.gain(0, p.out);
  envADSR(env.gain, t, dur * 0.4, 0.2, 1, dur * 0.6, dur * 0.4, 1);
  n.connect(bp).connect(env);
  p.run(n, t, t + dur + 0.1, Math.random());
};

/** Ember crackle burst. */
export const crackle: Instrument = (ctx, out, t, _m, dur, vel) => {
  const p = P(ctx, out, t, vel * 0.16);
  p.noise({ color: 'crackle', dur: Math.max(0.2, dur), a: 0.02, gain: 1, filter: { type: 'bandpass', f: 2600, q: 0.8 } });
};

/** Ghostly whisper: noise through a moving vowel formant. */
export const whisper: Instrument = (ctx, out, t, m, dur, vel) => {
  const p = P(ctx, out, t, vel * 0.13);
  const f = m > 0 ? mtof(m) : 900;
  const n = p.noiseSrc('white');
  const env = p.gain(0, p.out);
  for (const [k, q] of [[1, 9], [1.9, 11]] as const) {
    const bp = p.filter('bandpass', f * k, q);
    bp.frequency.setValueAtTime(f * k, t);
    bp.frequency.linearRampToValueAtTime(f * k * 0.6, t + dur);
    n.connect(bp).connect(p.gain(2, env));
  }
  envADSR(env.gain, t, dur * 0.35, 0.2, 0.8, dur * 0.6, dur * 0.4, 1);
  p.run(n, t, t + dur + 0.1, Math.random());
};
