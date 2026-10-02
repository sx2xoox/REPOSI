// Sound effects for the floor 7 bosses (멈춘 태엽탑): the clockmaker's ticks, winding
// key, time-freeze shimmer, tape-like rewind and the giant hand's sweep; the dancer's
// music-box chimes, cylinder, pirouette swish, cracking porcelain and a detuning box.
// Everything is dry, metallic and precise — brass and glass in a tall stone room.

import { registerSfx } from '../../audio/audio';
import { mtof, rnd } from '../../audio/synth';
import { chime, click, debris, sp, sparkle, thump, whooshLayer } from '../../audio/sfxkit';

// the spire's great clock: a dry wooden-brass tick (pitch it down for the tock)
registerSfx('clockboss_tick', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.16 });
  p.noise({ dur: 0.012, gain: 0.5, filter: { type: 'highpass', f: 3200 } });
  p.tone({ wave: 'square', f: [2400, 1500], sweep: 0.025, dur: 0.04, gain: 0.22, filter: { type: 'bandpass', f: 1900, q: 4 } });
  p.tone({ wave: 'sine', f: [760, 380], sweep: 0.04, dur: 0.075, gain: 0.32 });
  p.tone({ wave: 'triangle', f: 130, dur: 0.05, gain: 0.12 });
});

// winding the key: a ratchet of clicks under a rising spring squeak
registerSfx('clockboss_wind', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.1 });
  for (let i = 0; i < 9; i++) click(p, i * 0.048 + rnd(0, 0.004), 0.3 - i * 0.015, 2600 + i * 120, 0.014);
  p.tone({ wave: 'sawtooth', f: [200, 560], sweep: 0.44, dur: 0.46, gain: 0.07, filter: { type: 'lowpass', f: [700, 2600], q: 2 } });
  p.fm({ f: [880, 1500], ratio: 1.01, index: [0.8, 3], dur: 0.42, a: 0.05, gain: 0.035 });
  p.noise({ color: 'crackle', dur: 0.44, gain: 0.12, filter: { type: 'bandpass', f: 3400, q: 2.2 } });
});

// time stops: a glassy held note snaps shut over a soft thud and a frozen shimmer
registerSfx('clockboss_freeze', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.3 });
  p.tone({ wave: 'sine', f: [1900, 1850], dur: 0.38, a: 0.01, sus: 0.8, rel: 0.05, gain: 0.16 });
  p.fm({ f: 2400, ratio: 2.0, index: [3, 0.2], dur: 0.42, a: 0.004, gain: 0.12 });
  p.noise({ dur: 0.34, a: 0.26, gain: 0.12, filter: { type: 'bandpass', f: [1200, 6500], q: 2 } });
  thump(p, 0, 130, 60, 0.2, 0.22);
  sparkle(p, 0.18, 4, 3200, 0.06, 0.04);
});

// the rewind: a warbling upward sweep like tape run backwards
registerSfx('clockboss_rewind', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.2, delay: 0.12 });
  p.tone({ wave: 'sawtooth', f: [320, 1900], sweep: 0.42, dur: 0.46, gain: 0.1, filter: { type: 'bandpass', f: [600, 3200], q: 2 }, vib: [28, 70] });
  p.noise({ dur: 0.45, gain: 0.08, filter: { type: 'bandpass', f: [900, 4200], q: 1.5 } });
  p.fm({ f: [480, 1600], ratio: 2.5, index: [0.4, 4], dur: 0.44, gain: 0.07 });
  click(p, 0.44, 0.25, 2200, 0.015);
});

// the giant hand sweeping the floor: metallic air with a low grind
registerSfx('clockboss_sweep', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.22 });
  whooshLayer(p, 0, 0.5, [360, 2600, 800], 0.4, 1.6);
  p.fm({ f: [170, 330], ratio: 3.1, index: [4, 1], dur: 0.34, a: 0.04, gain: 0.08 });
  p.noise({ color: 'brown', dur: 0.4, a: 0.05, gain: 0.14, filter: { type: 'lowpass', f: 500 } });
  click(p, 0.02, 0.3, 1800, 0.02);
});

// a heavy gear clunk: brass on brass with a short grind
registerSfx('clockboss_gear', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.18 });
  click(p, 0, 0.45, 2200, 0.016);
  thump(p, 0, 170, 55, 0.26, 0.42);
  p.fm({ f: 520, ratio: 1.41, index: [5, 0.2], dur: 0.3, gain: 0.18 });
  p.noise({ color: 'crackle', at: 0.02, dur: 0.3, gain: 0.26, filter: { type: 'bandpass', f: 950, q: 1.2 } });
  debris(p, 0.04, 0.26, 0.16, 2600, 1.1);
});

// one music-box note: bright FM tine with a glassy partial (pitch it for melodies)
registerSfx('clockboss_chime', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.3, delay: 0.1 });
  p.fm({ f: 1760, ratio: 4.0, index: [1.8, 0.1], dur: 0.6, a: 0.002, gain: 0.3 });
  p.tone({ wave: 'sine', f: 1760 * 2.76, dur: 0.26, gain: 0.07 });
  click(p, 0, 0.12, 5000, 0.008);
});

// porcelain / dial glass shattering: crack, bright splinters, tinkling fall
registerSfx('clockboss_shatter', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.26 });
  click(p, 0, 0.6, 2000, 0.02);
  thump(p, 0, 240, 90, 0.16, 0.2);
  p.noise({ dur: 0.3, gain: 0.36, filter: { type: 'highpass', f: [6500, 2400] } });
  debris(p, 0.01, 0.56, 0.5, 3400, 1.0);
  sparkle(p, 0.06, 6, 2600, 0.11, 0.055);
});

// the dancer's pirouette: a swish of porcelain and a tiny bell
registerSfx('clockboss_pirouette', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.2 });
  whooshLayer(p, 0, 0.36, [700, 3800], 0.32, 1.5);
  chime(p, 0.04, 91, 0.1, 0.3, 4, 1.6);
  p.noise({ color: 'crackle', dur: 0.2, gain: 0.06, filter: { type: 'bandpass', f: 4200, q: 2 } });
});

// the music-box cylinder turning: a ratchet under a plinked arpeggio
registerSfx('clockboss_box', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.28, delay: 0.1 });
  const steps = [0, 4, 7, 12, 7, 4];
  for (let i = 0; i < steps.length; i++) p.fm({ f: mtof(86 + steps[i]), ratio: 4, index: [1.6, 0.1], at: i * 0.12, dur: 0.42, gain: 0.13 });
  p.noise({ color: 'crackle', dur: 0.82, gain: 0.07, filter: { type: 'bandpass', f: 2000, q: 2.2 } });
  for (let i = 0; i < 7; i++) click(p, i * 0.115, 0.08, 3000, 0.01);
});

// the box goes sour: a phrase sagging flat with a widening warble
registerSfx('clockboss_detune', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.35, delay: 0.14 });
  const notes = [91, 94, 98, 94, 89];
  for (let i = 0; i < notes.length; i++) {
    p.fm({ f: mtof(notes[i]) * (1 - i * 0.022), ratio: 4, index: [1.6, 0.1], at: i * 0.19, dur: 0.5, gain: 0.13, vib: [5 + i, 30 * i, 0.05] });
  }
  p.tone({ wave: 'triangle', f: [660, 440], sweep: 1.1, dur: 1.2, a: 0.1, gain: 0.07, lin: true, filter: { type: 'lowpass', f: 1800 } });
  p.noise({ color: 'crackle', at: 0.5, dur: 0.6, gain: 0.05, filter: { type: 'bandpass', f: 1800, q: 2 } });
});
