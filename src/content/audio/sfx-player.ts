// Sound effects: player actions, weapons and impacts.
// Frequent sounds (shoot, hit, step, swing) are short, soft-edged and slightly
// randomised so they never become fatiguing; rare ones are bigger and wetter.

import { registerSfx } from '../../audio/audio';
import { mtof, rnd } from '../../audio/synth';
import { chime, click, debris, sp, sparkle, thump, whooshLayer } from '../../audio/sfxkit';

// --- player / weapons -------------------------------------------------------

registerSfx('shoot', (ctx, out, t, o) => {
  // lantern ember spit: soft triangle "pff" + airy puff
  const p = sp(ctx, out, t, o, { reverb: 0.1 });
  const d = rnd(0.96, 1.04);
  p.tone({ wave: 'triangle', f: [760 * d, 400 * d], sweep: 0.07, dur: 0.09, gain: 0.3 });
  p.tone({ wave: 'sine', f: [1500 * d, 880 * d], sweep: 0.05, dur: 0.05, gain: 0.1 });
  p.noise({ dur: 0.05, gain: 0.16, filter: { type: 'bandpass', f: 2300 * d, q: 1.1 } });
});

registerSfx('shoot_magic', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.28, delay: 0.12 });
  const d = rnd(0.97, 1.03);
  p.fm({ f: [620 * d, 980 * d], ratio: 2, index: [3, 0.4], dur: 0.2, gain: 0.26 });
  p.tone({ wave: 'sine', f: [1240 * d, 1960 * d], at: 0.015, dur: 0.12, gain: 0.1 });
  p.noise({ dur: 0.12, gain: 0.08, filter: { type: 'highpass', f: 5200 } });
  sparkle(p, 0.03, 3, 2600, 0.05, 0.03);
});

registerSfx('shoot_arrow', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.08 });
  // bow string twang
  p.tone({ wave: 'sawtooth', f: [330, 255], sweep: 0.09, dur: 0.13, gain: 0.24, filter: { type: 'lowpass', f: [3200, 600], q: 4 } });
  // shaft "thwip"
  p.noise({ dur: 0.13, a: 0.01, gain: 0.32, filter: { type: 'bandpass', f: [1400, 5200], q: 2.2 } });
  click(p, 0, 0.22, 3000, 0.012);
});

registerSfx('swing', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.05 });
  const d = rnd(0.94, 1.06);
  whooshLayer(p, 0, 0.2, [520 * d, 2600 * d, 900 * d], 1.0, 2.2);
  p.tone({ wave: 'sine', f: [190, 120], a: 0.03, dur: 0.12, gain: 0.14 });
});

registerSfx('swing_heavy', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.1 });
  whooshLayer(p, 0, 0.36, [240, 1300, 380], 0.8, 1.9);
  p.tone({ wave: 'sine', f: [115, 55], a: 0.08, dur: 0.3, gain: 0.32 });
  p.tone({ wave: 'sawtooth', f: [72, 50], a: 0.08, dur: 0.26, gain: 0.08, filter: { type: 'lowpass', f: 420 } });
});

registerSfx('charge', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.15 });
  p.tone({ wave: 'sawtooth', f: [170, 520], sweep: 0.55, dur: 0.55, a: 0.25, sus: 1, rel: 0.08, gain: 0.11, filter: { type: 'lowpass', f: [400, 2600], q: 6 }, vib: [9, 30] });
  p.tone({ wave: 'sine', f: [340, 1040], sweep: 0.55, dur: 0.55, a: 0.25, sus: 1, rel: 0.08, gain: 0.12 });
  p.noise({ dur: 0.5, a: 0.35, sus: 1, gain: 0.07, filter: { type: 'bandpass', f: [800, 4200], q: 3 } });
});

registerSfx('charge_ready', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.32, delay: 0.1 });
  chime(p, 0, 88, 0.24, 0.5); // E6
  chime(p, 0.055, 95, 0.17, 0.45); // B6
  p.tone({ wave: 'triangle', f: 2637, at: 0.05, dur: 0.18, gain: 0.05 });
  click(p, 0, 0.12, 5000, 0.01);
});

registerSfx('dash', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.06 });
  p.noise({ dur: 0.15, a: 0.012, gain: 0.5, filter: { type: 'bandpass', f: [3400, 850], q: 1.5 } });
  p.tone({ wave: 'sine', f: [230, 85], dur: 0.1, gain: 0.25 });
});

registerSfx('step', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o);
  p.noise({ color: 'brown', dur: 0.05, gain: 0.35, filter: { type: 'lowpass', f: rnd(550, 850) } });
  p.noise({ dur: 0.014, gain: 0.07, filter: { type: 'bandpass', f: rnd(1900, 3000), q: 2 } });
});

registerSfx('player_hurt', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.18 });
  click(p, 0, 0.3, 1800, 0.02);
  p.tone({ wave: 'square', f: [540, 140], sweep: 0.17, dur: 0.22, gain: 0.2, filter: { type: 'lowpass', f: 2400 }, drive: 2 });
  p.tone({ wave: 'sawtooth', f: [270, 80], sweep: 0.2, dur: 0.24, gain: 0.13, filter: { type: 'lowpass', f: 1200 } });
  p.noise({ dur: 0.12, gain: 0.3, filter: { type: 'bandpass', f: [2500, 600], q: 1 }, drive: 3 });
  thump(p, 0, 150, 45, 0.25, 0.42);
});

registerSfx('player_die', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.5, stretch: 1 });
  thump(p, 0, 120, 28, 0.9, 0.5);
  p.noise({ color: 'brown', dur: 0.6, gain: 0.4, filter: { type: 'lowpass', f: [1200, 140] } });
  // falling lament
  [74, 72, 69, 65, 62].forEach((m, i) =>
    p.tone({ wave: 'pulse25', f: mtof(m), at: 0.12 + i * 0.17, dur: i === 4 ? 0.7 : 0.18, sus: 0.6, rel: 0.25, gain: 0.11, filter: { type: 'lowpass', f: 2200 }, vib: [5, 15, 0.1] }),
  );
  // the lantern flickers out
  p.fm({ f: [1760, 820], ratio: 3.5, index: [2, 0.1], at: 0.05, dur: 1.2, gain: 0.1 });
});

registerSfx('shield_block', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.18 });
  click(p, 0, 0.4, 2000, 0.025);
  p.fm({ f: 520, ratio: 1.41, index: [5, 0.5], dur: 0.3, gain: 0.26 });
  p.fm({ f: 1250, ratio: 2.76, index: [4, 0.2], dur: 0.22, gain: 0.15 });
  thump(p, 0, 180, 90, 0.12, 0.3);
});

registerSfx('parry', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.32, delay: 0.14 });
  click(p, 0, 0.45, 3000, 0.02);
  p.fm({ f: 1567, ratio: 2.76, index: [5, 0.3], dur: 0.6, gain: 0.2 });
  p.fm({ f: 2349, ratio: 1.5, index: [2, 0.1], at: 0.01, dur: 0.45, gain: 0.11 });
  p.noise({ dur: 0.25, gain: 0.13, filter: { type: 'bandpass', f: [4000, 9000], q: 4 } });
  thump(p, 0, 220, 110, 0.08, 0.25);
});

registerSfx('heal', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.35 });
  [72, 76, 79, 84].forEach((m, i) => p.tone({ wave: 'triangle', f: mtof(m), at: i * 0.06, dur: 0.34, a: 0.01, gain: 0.2 }));
  p.tone({ wave: 'sine', f: [mtof(84), mtof(88)], at: 0.18, dur: 0.4, gain: 0.11, vib: [6, 20] });
  p.noise({ dur: 0.35, a: 0.1, gain: 0.05, filter: { type: 'bandpass', f: 6000, q: 3 } });
});

registerSfx('power_up', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.35, delay: 0.18 });
  p.tone({ wave: 'sawtooth', f: [200, 800], sweep: 0.35, dur: 0.38, a: 0.05, gain: 0.12, filter: { type: 'lowpass', f: [600, 4000], q: 5 } });
  [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => p.tone({ wave: 'pulse25', f: mtof(m), at: i * 0.045, dur: 0.12, gain: 0.13, filter: { type: 'lowpass', f: 3500 } }));
  chime(p, 0.32, 84, 0.24, 0.6);
  sparkle(p, 0.34, 4, 3000, 0.05);
});

// --- impacts ----------------------------------------------------------------

registerSfx('hit', (ctx, out, t, o) => {
  // transient + body + crunch
  const p = sp(ctx, out, t, o, { reverb: 0.06 });
  const d = rnd(0.95, 1.05);
  click(p, 0, 0.45, 2500, 0.016);
  thump(p, 0, 190 * d, 70 * d, 0.1, 0.5);
  p.noise({ dur: 0.07, gain: 0.32, filter: { type: 'bandpass', f: [1400 * d, 500], q: 1.4 }, drive: 2.5 });
});

registerSfx('hit_crit', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.14 });
  click(p, 0, 0.42, 2000, 0.02);
  thump(p, 0, 210, 55, 0.16, 0.5);
  p.noise({ dur: 0.1, gain: 0.38, filter: { type: 'bandpass', f: [2200, 600], q: 1.2 }, drive: 4 });
  p.tone({ wave: 'square', f: [1500, 980], dur: 0.12, gain: 0.1, filter: { type: 'bandpass', f: 1800, q: 2 } });
  p.fm({ f: 2100, ratio: 2.76, index: [3, 0.1], at: 0.01, dur: 0.18, gain: 0.07 });
});

registerSfx('hit_metal', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.16 });
  click(p, 0, 0.4, 3000, 0.02);
  p.fm({ f: 620, ratio: 3.17, index: [6, 0.4], dur: 0.35, gain: 0.24 });
  p.fm({ f: 1480, ratio: 1.41, index: [3, 0.1], dur: 0.2, gain: 0.11 });
  thump(p, 0, 200, 110, 0.08, 0.28);
});

registerSfx('tear_splash', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.06 });
  const d = rnd(0.92, 1.08);
  p.tone({ wave: 'sine', f: [480 * d, 1100 * d], sweep: 0.04, dur: 0.06, gain: 0.24 });
  p.noise({ dur: 0.1, gain: 0.28, filter: { type: 'lowpass', f: [2600, 600] } });
  p.tone({ wave: 'sine', f: [900 * d, 1600 * d], at: 0.035, sweep: 0.03, dur: 0.045, gain: 0.1 });
});

registerSfx('splat', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.08 });
  p.noise({ color: 'pink', dur: 0.22, gain: 0.6, filter: { type: 'lowpass', f: [1900, 240], q: 7 } });
  thump(p, 0, 160, 55, 0.18, 0.36);
  p.noise({ at: 0.025, dur: 0.06, gain: 0.18, filter: { type: 'bandpass', f: 1200, q: 2 } });
  debris(p, 0.02, 0.12, 0.12, 900, 2);
});
