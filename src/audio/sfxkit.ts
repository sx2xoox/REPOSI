// Reusable layers for sound effects. A sound is built from a few layers:
// transient (click / crack) + body (pitched thump or tone) + texture (filtered
// noise, debris crackle) + tail (shared reverb send).

import type { SfxPlayOpts } from './audio';
import { Patch, driveCurve, mtof, rnd, sfxSends, sweep, type Ctx } from './synth';

export interface SfxFx {
  reverb?: number;
  delay?: number;
  vol?: number;
  stretch?: number;
}

/** Patch for a one-shot sfx honouring the caller's vol / pitch. */
export function sp(ctx: Ctx, out: AudioNode, t: number, o: Required<SfxPlayOpts>, fx: SfxFx = {}): Patch {
  return new Patch(ctx, out, t, {
    vol: Math.max(0, o.vol) * (fx.vol ?? 1),
    pitch: o.pitch,
    stretch: fx.stretch,
    sends: sfxSends(ctx),
    reverb: fx.reverb,
    delay: fx.delay,
  });
}

/** Short high-passed noise tick: the "attack" that makes hits read as hits. */
export function click(p: Patch, at: number, gain: number, hp = 2500, dur = 0.018): void {
  p.noise({ at, dur, gain, filter: { type: 'highpass', f: hp } });
}

/** Pitched sine drop: the body / weight of an impact. */
export function thump(p: Patch, at: number, f0: number, f1: number, dur: number, gain: number): void {
  p.tone({ wave: 'sine', f: [f0, f1], sweep: dur * 0.6, at, dur, gain });
}

/** Bandpassed debris crackle (bones, rubble, shards). */
export function debris(p: Patch, at: number, dur: number, gain: number, f = 1800, q = 0.9): void {
  p.noise({ color: 'crackle', at, dur, gain, filter: { type: 'bandpass', f, q } });
}

/** Swelling band-passed air. `f` is the band centre path. */
export function whooshLayer(p: Patch, at: number, dur: number, f: number[], gain: number, q = 1.8): void {
  p.noise({ color: 'pink', at, dur: dur * 0.7, a: dur * 0.3, gain, filter: { type: 'bandpass', f, q, dur } });
}

/** Little high pings (magic / pickups). */
export function sparkle(p: Patch, at: number, count: number, base: number, gain: number, spacing = 0.035): void {
  for (let i = 0; i < count; i++) {
    p.tone({ wave: i % 2 ? 'sine' : 'triangle', f: base * Math.pow(2, rnd(0, 1.2) + i * 0.08), at: at + i * spacing, dur: 0.09, gain: gain * (1 - i * 0.08) });
  }
}

/** FM bell note at a MIDI pitch. */
export function chime(p: Patch, at: number, midi: number, gain: number, dur = 0.5, ratio = 3.5, index = 2.2): void {
  p.fm({ f: mtof(midi), ratio, index: [index, 0.15], at, dur, gain });
}

export interface GrowlOpts {
  at?: number;
  dur: number;
  /** fundamental path (Hz) */
  f: number[];
  gain: number;
  /** formant sets to morph through, e.g. [[700,1100,2500],[400,800,2300]] */
  vowels?: number[][];
  rough?: number;
  drive?: number;
  breath?: number;
}

/**
 * Formant growl: saw + sub-harmonic saw + breath noise, amplitude-roughened,
 * through three morphing vowel band-passes and a soft clipper.
 */
export function growl(p: Patch, o: GrowlOpts): void {
  const t = p.t + p.T(o.at ?? 0);
  const dur = p.T(o.dur);
  const fs = o.f.map((v) => v * p.pitch);
  const s1 = p.osc('sawtooth', fs[0]);
  const s2 = p.osc('sawtooth', fs[0] * 0.503);
  sweep(s1.frequency, t, fs, dur);
  sweep(s2.frequency, t, fs.map((v) => v * 0.503), dur);
  p.vibrato(s1.detune, t, 6.5, 35, 0, t + dur + 0.1);
  const nz = p.noiseSrc('pink');
  const mix = p.gain(1);
  s1.connect(p.gain(0.55, mix));
  s2.connect(p.gain(0.45, mix));
  nz.connect(p.gain(o.breath ?? 0.5, mix));
  // roughness: fast irregular AM
  const rough = p.gain(1 - (o.rough ?? 0.45) / 2);
  mix.connect(rough);
  const lfo = p.osc('triangle', 29);
  const lfo2 = p.osc('sine', 41);
  lfo.connect(p.gain((o.rough ?? 0.45) / 2, rough.gain));
  lfo2.connect(p.gain((o.rough ?? 0.45) / 4, rough.gain));
  const vowels = o.vowels ?? [
    [650, 1080, 2650],
    [750, 1200, 2500],
    [420, 820, 2350],
  ];
  const sum = p.gain(1);
  const amps = [1, 0.6, 0.25];
  for (let k = 0; k < 3; k++) {
    const bp = p.filter('bandpass', vowels[0][k] * Math.sqrt(p.pitch), 5);
    sweep(bp.frequency, t, vowels.map((v) => v[k] * Math.sqrt(p.pitch)), dur);
    rough.connect(bp);
    bp.connect(p.gain(amps[k] * 3, sum));
  }
  // low end so it doesn't sound thin
  const lowp = p.filter('lowpass', 300);
  rough.connect(lowp);
  lowp.connect(p.gain(0.8, sum));
  const sh = p.shaper(driveCurve(o.drive ?? 2.5));
  const env = p.gain(0, p.out);
  sum.connect(sh).connect(env);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(o.gain, t + dur * 0.12);
  env.gain.setTargetAtTime(o.gain * 0.75, t + dur * 0.12, dur * 0.2);
  env.gain.setTargetAtTime(0, t + dur * 0.7, dur * 0.08);
  const end = t + dur + 0.05;
  for (const s of [s1, s2, lfo, lfo2]) p.run(s, t, end);
  p.run(nz, t, end, Math.random());
}

/** Big layered blast: crack, sub thump, rumbling body, debris tail. */
export function blast(p: Patch, at: number, size: number, gain: number): void {
  p.noise({ at, dur: 0.045, gain: 0.55 * gain, filter: { type: 'highpass', f: 1000 }, drive: 4 });
  thump(p, at, 95, 24, 0.7 * size, 0.85 * gain);
  p.noise({ color: 'brown', at, dur: 0.9 * size, a: 0.004, gain: 0.8 * gain, filter: { type: 'lowpass', f: [2600, 110], dur: 0.8 * size }, drive: 1.6 });
  p.noise({ color: 'pink', at, dur: 0.45 * size, gain: 0.3 * gain, filter: { type: 'bandpass', f: [1900, 280], q: 0.8 } });
  debris(p, at + 0.07, 0.9 * size, 0.45 * gain, 2300, 0.7);
}
