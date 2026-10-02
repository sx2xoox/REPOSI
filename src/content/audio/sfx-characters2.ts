// Sound effects of the 보리 / 백구 / 모리 kits: short, soft-edged and pitch-
// randomised like the other frequent player sounds (see sfx-characters.ts).
//   보리  bori_barrel (a charge lands in the barrel), bori_drink (gulp), bori_block
//         (bullet off the body), bori_shove (the body block), bori_howl (release)
//   백구  baekgu_parry (간파!), baekgu_counter (counter slash), baekgu_flash (release)
//   모리  mori_whistle (shepherd's whistle), mori_baa (spirit sheep), mori_stampede

import { registerSfx } from '../../audio/audio';
import { rnd } from '../../audio/synth';
import { chime, click, sp, sparkle, thump, whooshLayer } from '../../audio/sfxkit';

// 보리: a heart drops into the little wooden barrel — a hollow wooden knock and a liquid plip
registerSfx('bori_barrel', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.15 });
  const d = rnd(0.96, 1.04);
  thump(p, 0, 420 * d, 180 * d, 0.14, 0.3);
  p.noise({ dur: 0.05, gain: 0.18, filter: { type: 'bandpass', f: 1400 * d, q: 1.5 } });
  p.tone({ wave: 'sine', f: [900 * d, 1500 * d], sweep: 0.06, at: 0.07, dur: 0.1, gain: 0.12 });
});

// 보리: a gulp from the barrel — two bubbly swallows and a warm chime
registerSfx('bori_drink', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.2 });
  p.tone({ wave: 'sine', f: [300, 520], sweep: 0.08, dur: 0.1, gain: 0.2 });
  p.tone({ wave: 'sine', f: [340, 600], sweep: 0.08, at: 0.12, dur: 0.1, gain: 0.18 });
  p.noise({ dur: 0.08, at: 0.02, gain: 0.1, filter: { type: 'bandpass', f: [800, 1800], q: 2 } });
  chime(p, 0.22, 79, 0.12, 0.35);
});

// 보리: a bullet bounces off her shoulder — a dull leather thud with a bright tick
registerSfx('bori_block', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.08 });
  const d = rnd(0.95, 1.05);
  click(p, 0, 0.2, 3200, 0.012);
  thump(p, 0, 260 * d, 120 * d, 0.1, 0.32);
  p.noise({ color: 'brown', dur: 0.08, gain: 0.25, filter: { type: 'lowpass', f: [1800, 500] } });
});

// 보리: the body block — heavy paws dig in and a broad low shove of air
registerSfx('bori_shove', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.1 });
  p.noise({ color: 'brown', dur: 0.24, a: 0.02, gain: 0.5, filter: { type: 'lowpass', f: [1600, 300] } });
  whooshLayer(p, 0, 0.22, [220, 900, 350], 0.6, 1.6);
  thump(p, 0.02, 140, 60, 0.18, 0.35);
});

// 보리: the rescue howl — a big round dog voice sliding up, then ringing out
registerSfx('bori_howl', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.4, delay: 0.16 });
  p.tone({ wave: 'sawtooth', f: [220, 330, 310], sweep: 0.5, dur: 0.75, a: 0.05, gain: 0.16, vib: [5.5, 30, 0.2], filter: { type: 'lowpass', f: [900, 2400], q: 1.5 } });
  p.tone({ wave: 'triangle', f: [330, 495, 465], sweep: 0.5, dur: 0.7, a: 0.08, gain: 0.1, vib: [5.5, 30, 0.2] });
  p.noise({ color: 'pink', dur: 0.4, a: 0.1, gain: 0.08, filter: { type: 'bandpass', f: [700, 1800], q: 1.2 } });
  thump(p, 0, 160, 50, 0.3, 0.3);
});

// 백구: 간파! — a glassy snap, a sharp high ring and a short reversed swell
registerSfx('baekgu_parry', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.3 });
  click(p, 0, 0.35, 2800, 0.02);
  p.tone({ wave: 'sine', f: [2400, 3600], sweep: 0.04, dur: 0.22, gain: 0.16 });
  p.tone({ wave: 'triangle', f: [600, 1200], sweep: 0.12, dur: 0.18, gain: 0.1 });
  p.noise({ dur: 0.16, a: 0.12, gain: 0.2, filter: { type: 'bandpass', f: [900, 4200], q: 1.4 } });
  chime(p, 0.05, 96, 0.14, 0.4);
});

// 백구: the counter slash — a fast steel whistle and a deep bite
registerSfx('baekgu_counter', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.15 });
  whooshLayer(p, 0, 0.14, [1400, 4800, 2200], 0.6, 2.6);
  click(p, 0.05, 0.3, 2400, 0.015);
  thump(p, 0.05, 420, 110, 0.18, 0.4);
  p.tone({ wave: 'square', f: [1800, 900], sweep: 0.1, at: 0.05, dur: 0.12, gain: 0.06, filter: { type: 'lowpass', f: 3000 } });
});

// 백구: the release — a ringing blade drawn, then rising wind
registerSfx('baekgu_flash', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.35, delay: 0.1 });
  p.tone({ wave: 'sine', f: [3000, 2400], sweep: 0.5, dur: 0.6, gain: 0.12 });
  whooshLayer(p, 0.05, 0.5, [500, 3200, 1800], 0.7, 2);
  sparkle(p, 0.1, 5, 2600, 0.06, 0.06);
  thump(p, 0, 200, 60, 0.3, 0.3);
});

// 모리: the shepherd's whistle — two quick rising notes with breath
registerSfx('mori_whistle', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.25 });
  const d = rnd(0.97, 1.03);
  p.tone({ wave: 'sine', f: [1500 * d, 2300 * d], sweep: 0.12, dur: 0.16, a: 0.02, gain: 0.16, vib: [9, 25, 0.03] });
  p.tone({ wave: 'sine', f: [1900 * d, 2700 * d], sweep: 0.12, at: 0.17, dur: 0.2, a: 0.02, gain: 0.15, vib: [9, 25, 0.03] });
  p.noise({ dur: 0.3, a: 0.03, gain: 0.05, filter: { type: 'bandpass', f: [2200, 3200], q: 3 } });
});

// 모리: a spirit sheep headbutts — a soft airy "baa" with a little thud
registerSfx('mori_baa', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.2 });
  const d = rnd(0.94, 1.06);
  p.fm({ f: [480 * d, 420 * d], ratio: 2, index: [2.5, 0.6], dur: 0.2, a: 0.02, gain: 0.12, vib: [14, 40, 0] });
  p.noise({ color: 'pink', dur: 0.14, a: 0.02, gain: 0.1, filter: { type: 'bandpass', f: [900, 1600], q: 1.5 } });
  thump(p, 0, 220 * d, 100 * d, 0.1, 0.22);
});

// 모리: the stampede — many hooves, rumbling ground and a high spirit shimmer
registerSfx('mori_stampede', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.3 });
  p.noise({ color: 'brown', dur: 0.7, a: 0.05, gain: 0.5, filter: { type: 'lowpass', f: [700, 350] } });
  for (let i = 0; i < 8; i++) thump(p, 0.04 + i * 0.07, 150 + (i % 3) * 20, 60, 0.09, 0.22);
  sparkle(p, 0.1, 6, 2000, 0.05, 0.08);
  p.tone({ wave: 'sine', f: [1200, 1800], sweep: 0.5, dur: 0.6, a: 0.15, gain: 0.06 });
});
