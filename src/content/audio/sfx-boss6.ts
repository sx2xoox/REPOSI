// Sound effects for the floor 6 bosses (수몰된 서고): the archivist's quill and pages,
// ink splashes, and the sunken lighthouse's lamp hum, foghorn and tidal slams.
// Everything sits in the wet / muffled register of the drowned archive.

import { registerSfx } from '../../audio/audio';
import { rnd } from '../../audio/synth';
import { blast, click, debris, sp, thump } from '../../audio/sfxkit';

// a quill scratching across wet vellum: three dry ticks over a thin scrape
registerSfx('quill_write', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.1 });
  for (let i = 0; i < 3; i++) {
    p.noise({ at: i * 0.055 + rnd(0, 0.01), dur: 0.035, gain: 0.22 - i * 0.04, filter: { type: 'bandpass', f: 3200 + i * 600, q: 3 } });
  }
  p.noise({ dur: 0.22, a: 0.03, gain: 0.1, filter: { type: 'bandpass', f: [1800, 4200], q: 2.5 } });
  p.tone({ wave: 'triangle', f: [1400, 2100], sweep: 0.18, dur: 0.2, gain: 0.04, filter: { type: 'highpass', f: 1200 } });
});

// a page torn free: crackling rip with a falling sweep, then a soft flutter
registerSfx('page_rip', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.14 });
  p.noise({ color: 'crackle', dur: 0.22, gain: 0.42, filter: { type: 'bandpass', f: [3600, 900], q: 1.4 } });
  p.noise({ dur: 0.18, gain: 0.2, filter: { type: 'highpass', f: [5000, 1800] } });
  for (let i = 0; i < 3; i++) p.noise({ at: 0.2 + i * 0.07, dur: 0.05, gain: 0.1 - i * 0.025, filter: { type: 'bandpass', f: 700 - i * 120, q: 2 } });
  click(p, 0, 0.3, 2600, 0.015);
});

// a blot of ink landing in water: a wet plop with a short splash
registerSfx('ink_burst', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.22 });
  p.tone({ wave: 'sine', f: [460, 90], sweep: 0.12, dur: 0.16, gain: 0.3 });
  p.noise({ color: 'pink', dur: 0.26, a: 0.01, gain: 0.3, filter: { type: 'lowpass', f: [2600, 400] } });
  debris(p, 0.03, 0.3, 0.22, 1400, 1.1);
  p.fm({ f: [330, 190], ratio: 1.5, index: [2.5, 0.3], at: 0.02, dur: 0.14, gain: 0.08 });
  thump(p, 0, 120, 60, 0.12, 0.18);
});

// the drowned lamp charging: a rising hum with a glassy shimmer on top
registerSfx('lamp_hum', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.3 });
  const trem = p.gain(1, p.out);
  p.tremolo(trem.gain, p.t, 11, 0.3, p.t + p.T(0.9));
  p.tone({ wave: 'sine', f: [95, 190], sweep: 0.7, dur: 0.85, a: 0.3, sus: 1, rel: 0.1, gain: 0.2, to: trem });
  p.tone({ wave: 'sawtooth', f: [190, 380], sweep: 0.7, dur: 0.85, a: 0.35, sus: 1, rel: 0.1, gain: 0.08, filter: { type: 'lowpass', f: [500, 1800], q: 3 }, to: trem });
  p.fm({ f: [1200, 2400], ratio: 2.01, index: [0.6, 2.2], dur: 0.85, a: 0.4, gain: 0.05 });
  p.noise({ dur: 0.8, a: 0.5, sus: 1, gain: 0.06, filter: { type: 'bandpass', f: [900, 4500], q: 3 } });
});

// the lighthouse's horn from under the water: two detuned saws, muffled, with a sub swell
registerSfx('foghorn', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.45 });
  p.tone({ wave: 'sawtooth', f: [62, 66, 60], dur: 1.0, a: 0.12, sus: 0.9, rel: 0.2, gain: 0.2, filter: { type: 'lowpass', f: [900, 260], q: 2 }, vib: [5, 6], drive: 2 });
  p.tone({ wave: 'sawtooth', f: [93, 99, 90], dur: 0.95, a: 0.15, sus: 0.9, rel: 0.2, gain: 0.12, filter: { type: 'lowpass', f: [1100, 300], q: 2 }, vib: [5.5, 6] });
  p.tone({ wave: 'sine', f: [31, 33], dur: 0.95, a: 0.2, sus: 1, rel: 0.15, gain: 0.26 });
  p.noise({ color: 'brown', dur: 0.85, a: 0.3, gain: 0.12, filter: { type: 'lowpass', f: 320 } });
});

// the tower slamming into the flooded floor: a blast, a heavy thump and a water slap
registerSfx('tide_slam', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.3 });
  blast(p, 0, 0.6, 0.32);
  thump(p, 0, 78, 24, 0.55, 0.5);
  p.noise({ color: 'pink', at: 0.02, dur: 0.42, a: 0.01, gain: 0.34, filter: { type: 'lowpass', f: [3000, 300] } });
  debris(p, 0.05, 0.5, 0.3, 1100, 0.9);
  p.tone({ wave: 'sine', f: [300, 70], sweep: 0.2, at: 0.03, dur: 0.24, gain: 0.14 });
});
