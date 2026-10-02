// Sound effects: enemies, hazards, elemental effects and bosses.
// Enemy sounds sit lower / darker than the player's so the two read apart.

import { registerSfx } from '../../audio/audio';
import { mtof, rnd } from '../../audio/synth';
import { blast, chime, click, debris, growl, sp, sparkle, thump, whooshLayer } from '../../audio/sfxkit';

registerSfx('enemy_hurt', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.05 });
  const d = rnd(0.92, 1.08);
  p.tone({ wave: 'sawtooth', f: [270 * d, 165 * d], sweep: 0.1, dur: 0.12, gain: 0.26, filter: { type: 'bandpass', f: 720, q: 2.5 } });
  p.noise({ dur: 0.05, gain: 0.24, filter: { type: 'bandpass', f: 1500, q: 1.5 } });
  thump(p, 0, 150, 80, 0.06, 0.2);
});

registerSfx('enemy_die', (ctx, out, t, o) => {
  // crunchy pop: crack + crushed square drop + bone rattle
  const p = sp(ctx, out, t, o, { reverb: 0.14 });
  click(p, 0, 0.45, 2000, 0.02);
  p.tone({ wave: 'square', f: [430, 55], sweep: 0.22, dur: 0.26, gain: 0.17, crush: 4, filter: { type: 'lowpass', f: 2500 } });
  thump(p, 0, 155, 40, 0.24, 0.42);
  p.noise({ dur: 0.18, gain: 0.26, filter: { type: 'bandpass', f: [2000, 300], q: 1.2 }, drive: 3 });
  debris(p, 0.02, 0.34, 0.45, 2200, 1);
});

registerSfx('enemy_die_big', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.24 });
  click(p, 0, 0.5, 1500, 0.03);
  thump(p, 0, 115, 26, 0.65, 0.45);
  p.tone({ wave: 'sawtooth', f: [230, 40], sweep: 0.45, dur: 0.5, gain: 0.15, filter: { type: 'lowpass', f: [1800, 200] }, drive: 3 });
  p.noise({ color: 'brown', dur: 0.5, gain: 0.3, filter: { type: 'lowpass', f: [1500, 200] } });
  debris(p, 0.04, 0.65, 0.45, 1800, 0.9);
  growl(p, { at: 0, dur: 0.45, f: [140, 70], gain: 0.12, rough: 0.6 });
});

registerSfx('enemy_shoot', (ctx, out, t, o) => {
  // dark wet "bwop" — clearly lower than the player's shots
  const p = sp(ctx, out, t, o, { reverb: 0.08 });
  const d = rnd(0.95, 1.05);
  p.tone({ wave: 'sawtooth', f: [600 * d, 230 * d], sweep: 0.1, dur: 0.12, gain: 0.17, filter: { type: 'lowpass', f: [2400, 700], q: 3 } });
  p.fm({ f: [390 * d, 170 * d], ratio: 0.5, index: [3, 1], dur: 0.12, gain: 0.15 });
  p.noise({ dur: 0.05, gain: 0.14, filter: { type: 'bandpass', f: 900, q: 1.5 } });
});

registerSfx('enemy_charge', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.12 });
  p.tone({ wave: 'sawtooth', f: [70, 150], sweep: 0.45, dur: 0.45, a: 0.2, sus: 0.9, rel: 0.08, gain: 0.2, filter: { type: 'lowpass', f: [300, 1400], q: 4 }, vib: [14, 40] });
  p.noise({ dur: 0.45, a: 0.3, sus: 1, gain: 0.1, filter: { type: 'bandpass', f: [400, 1600], q: 2 } });
});

registerSfx('enemy_jump', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.05 });
  p.tone({ wave: 'sine', f: [180, 520], sweep: 0.1, dur: 0.12, gain: 0.24 });
  p.noise({ dur: 0.1, a: 0.02, gain: 0.24, filter: { type: 'bandpass', f: [600, 2500], q: 1.5 } });
});

registerSfx('enemy_land', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.12 });
  thump(p, 0, 125, 36, 0.26, 0.55);
  p.noise({ color: 'brown', dur: 0.2, gain: 0.42, filter: { type: 'lowpass', f: [900, 150] } });
  debris(p, 0.02, 0.24, 0.28, 1500, 1);
});

registerSfx('enemy_roar', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.3 });
  growl(p, { dur: 0.7, f: [125, 160, 95], gain: 0.34, rough: 0.5 });
  thump(p, 0, 90, 50, 0.4, 0.2);
});

registerSfx('enemy_spawn', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.35 });
  p.noise({ dur: 0.12, a: 0.25, gain: 0.22, filter: { type: 'bandpass', f: [300, 2400], q: 2, dur: 0.37 } });
  p.tone({ wave: 'sine', f: [110, 220], dur: 0.3, a: 0.2, gain: 0.18, vib: [7, 40] });
  p.fm({ f: 330, ratio: 1.5, index: [3, 0.2], dur: 0.25, a: 0.15, gain: 0.11 });
  p.noise({ at: 0.3, dur: 0.1, gain: 0.3, filter: { type: 'lowpass', f: 1200 } });
  thump(p, 0.3, 140, 60, 0.15, 0.25);
});

registerSfx('warn', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.15 });
  p.tone({ wave: 'square', f: 1320, dur: 0.06, sus: 1, rel: 0.01, gain: 0.12, filter: { type: 'lowpass', f: 3500 } });
  p.tone({ wave: 'square', f: 1320, at: 0.09, dur: 0.08, sus: 1, rel: 0.02, gain: 0.12, filter: { type: 'lowpass', f: 3500 } });
  p.fm({ f: 880, ratio: 2.01, index: [1.5, 0.2], dur: 0.25, gain: 0.07 });
});

registerSfx('summon', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.42 });
  [62, 58, 55, 50].forEach((m, i) => p.fm({ f: mtof(m), ratio: 1.5, index: [2.5, 0.3], at: i * 0.07, dur: 0.4, gain: 0.14 }));
  p.tone({ wave: 'sawtooth', f: [55, 50], dur: 0.6, a: 0.15, gain: 0.12, filter: { type: 'lowpass', f: 500 }, vib: [6, 30] });
  p.noise({ dur: 0.5, a: 0.3, gain: 0.13, filter: { type: 'bandpass', f: [2000, 400], q: 3 } });
});

registerSfx('slam', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.2 });
  p.noise({ dur: 0.03, gain: 0.45, filter: { type: 'lowpass', f: 3000 } });
  thump(p, 0, 85, 26, 0.5, 0.5);
  p.noise({ color: 'brown', dur: 0.4, gain: 0.4, filter: { type: 'lowpass', f: [1600, 120] }, drive: 2 });
  debris(p, 0.05, 0.5, 0.35, 1200, 0.8);
});

registerSfx('whoosh', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.06 });
  whooshLayer(p, 0, 0.26, [380, 1900, 600], 0.85, 1.8);
  p.noise({ dur: 0.14, a: 0.06, gain: 0.1, filter: { type: 'highpass', f: [3000, 6000] } });
});

registerSfx('orb', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.25 });
  p.fm({ f: [440, 300], ratio: 0.5, index: [4, 1], dur: 0.3, gain: 0.24, vib: [12, 60] });
  p.tone({ wave: 'sine', f: [880, 600], dur: 0.25, gain: 0.09 });
  p.noise({ dur: 0.2, a: 0.05, gain: 0.07, filter: { type: 'bandpass', f: 3000, q: 4 } });
});

registerSfx('beam_charge', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.2 });
  const trem = p.gain(1, p.out);
  p.tremolo(trem.gain, p.t, 16, 0.35, p.t + p.T(0.95));
  p.tone({ wave: 'sawtooth', f: [200, 900], sweep: 0.75, dur: 0.75, a: 0.4, sus: 1, rel: 0.06, gain: 0.15, filter: { type: 'bandpass', f: [600, 3000], q: 5 }, to: trem });
  p.tone({ wave: 'sine', f: [400, 1800], sweep: 0.75, dur: 0.75, a: 0.4, sus: 1, rel: 0.06, gain: 0.12, to: trem });
  p.noise({ dur: 0.75, a: 0.5, sus: 1, gain: 0.09, filter: { type: 'bandpass', f: [1000, 6000], q: 3 } });
});

registerSfx('laser', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.1 });
  p.tone({ wave: 'sawtooth', f: [300, 180], dur: 0.16, gain: 0.14, filter: { type: 'bandpass', f: 1500, q: 1.5 }, drive: 2 });
  p.tone({ wave: 'square', f: [606, 362], dur: 0.16, gain: 0.07, filter: { type: 'lowpass', f: 3000 } });
  p.noise({ color: 'chip', dur: 0.12, gain: 0.07, filter: { type: 'highpass', f: 4000 } });
});

registerSfx('lightning', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.35 });
  for (let i = 0; i < 5; i++) p.noise({ at: i * 0.035 + rnd(0, 0.02), dur: 0.04, gain: 0.42 - i * 0.05, filter: { type: 'highpass', f: 2500 }, drive: 4 });
  p.tone({ wave: 'square', f: [2400, 300], sweep: 0.12, dur: 0.15, gain: 0.07, crush: 3 });
  p.noise({ color: 'brown', at: 0.05, dur: 0.7, a: 0.05, gain: 0.48, filter: { type: 'lowpass', f: [700, 120] } });
  thump(p, 0.04, 80, 35, 0.4, 0.3);
});

registerSfx('fire', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.12 });
  p.noise({ color: 'pink', dur: 0.36, a: 0.05, gain: 0.48, filter: { type: 'bandpass', f: [600, 1400, 500], q: 1 } });
  debris(p, 0, 0.38, 0.35, 3000, 0.6);
  p.tone({ wave: 'sine', f: [95, 60], dur: 0.32, a: 0.05, gain: 0.22 });
  p.noise({ color: 'brown', dur: 0.32, a: 0.03, gain: 0.28, filter: { type: 'lowpass', f: 500 } });
});

registerSfx('freeze', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.4 });
  [2637, 3520, 3136, 4186].forEach((f, i) => p.fm({ f: f * rnd(0.98, 1.02), ratio: 3.01, index: [1.5, 0.1], at: i * 0.04, dur: 0.35, gain: 0.075 }));
  p.noise({ dur: 0.45, a: 0.01, gain: 0.22, filter: { type: 'highpass', f: [9000, 4000] } });
  p.tone({ wave: 'sine', f: [1200, 600], dur: 0.2, gain: 0.09 });
  click(p, 0, 0.28, 4500, 0.03);
});

registerSfx('poison', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.12 });
  for (let i = 0; i < 5; i++) {
    p.tone({ wave: 'sine', f: [rnd(250, 500), rnd(700, 1100)], at: i * 0.06 + rnd(0, 0.02), sweep: 0.04, dur: 0.05, gain: 0.22 });
  }
  p.noise({ color: 'pink', dur: 0.35, gain: 0.24, filter: { type: 'lowpass', f: [900, 300], q: 6 } });
  p.tone({ wave: 'sawtooth', f: [90, 70], dur: 0.3, gain: 0.07, filter: { type: 'lowpass', f: 400 }, vib: [11, 80] });
});

registerSfx('spike', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.12 });
  p.noise({ dur: 0.06, gain: 0.36, filter: { type: 'bandpass', f: [2500, 6000], q: 3 } });
  p.fm({ f: 980, ratio: 2.4, index: [4, 0.3], at: 0.04, dur: 0.2, gain: 0.16 });
  click(p, 0.04, 0.42, 3000, 0.015);
  thump(p, 0.04, 160, 80, 0.08, 0.2);
});

// --- bosses -----------------------------------------------------------------

registerSfx('boss_roar', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.45, stretch: 1 });
  growl(p, { dur: 1.5, f: [62, 78, 70, 48], gain: 0.42, rough: 0.6, drive: 3, vowels: [[600, 1000, 2400], [780, 1250, 2600], [700, 1150, 2500], [380, 760, 2300]] });
  growl(p, { at: 0.04, dur: 1.3, f: [124, 150, 92], gain: 0.14, rough: 0.4 });
  thump(p, 0, 70, 32, 0.9, 0.35);
  p.noise({ color: 'brown', dur: 1.2, a: 0.2, gain: 0.2, filter: { type: 'lowpass', f: 300 } });
});

registerSfx('boss_die', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.55, delay: 0.1, stretch: 1 });
  blast(p, 0, 1.4, 0.55);
  growl(p, { at: 0.05, dur: 1.4, f: [110, 70, 30], gain: 0.18, rough: 0.7 });
  // death knell + rising soul shimmer
  p.fm({ f: 98, ratio: 1.4, index: [3, 0.2], at: 0.25, dur: 2.2, gain: 0.18 });
  chime(p, 0.5, 74, 0.08, 1.6);
  chime(p, 0.7, 81, 0.07, 1.4);
  sparkle(p, 0.9, 6, 2200, 0.04, 0.09);
  blast(p, 0.55, 0.8, 0.3);
});

registerSfx('boss_phase', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.45, stretch: 1 });
  thump(p, 0, 90, 30, 0.6, 0.5);
  click(p, 0, 0.35, 1200, 0.03);
  [0, 1, 6].forEach((s) =>
    p.tone({ wave: 'sawtooth', f: [mtof(45 + s), mtof(57 + s)], sweep: 0.9, dur: 0.9, a: 0.6, sus: 1, rel: 0.2, gain: 0.07, filter: { type: 'lowpass', f: [300, 3000] } }),
  );
  p.noise({ dur: 0.7, a: 0.6, gain: 0.12, filter: { type: 'bandpass', f: [400, 5000], q: 2 } });
  growl(p, { at: 0.75, dur: 0.6, f: [80, 95, 60], gain: 0.22, rough: 0.6 });
});
