// Sound effects: world (explosions, rocks, doors, secrets, floors), match fire
// (striking, sealed doors / chests, lanterns) and pickups / economy (coins,
// health, blue flames, matches, items, shop).

import { registerSfx } from '../../audio/audio';
import { mtof, rnd } from '../../audio/synth';
import { blast, chime, click, debris, sp, sparkle, thump } from '../../audio/sfxkit';

// --- world ------------------------------------------------------------------

registerSfx('explosion', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.3 });
  blast(p, 0, 1.1, 0.5);
});

registerSfx('bomb_place', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.08 });
  thump(p, 0, 180, 90, 0.12, 0.4);
  p.noise({ dur: 0.04, gain: 0.22, filter: { type: 'lowpass', f: 1500 } });
  p.fm({ f: 620, ratio: 2.7, index: [2, 0.1], at: 0.01, dur: 0.1, gain: 0.06 });
  p.noise({ at: 0.06, dur: 0.18, gain: 0.08, filter: { type: 'highpass', f: 5000 } });
});

registerSfx('fuse', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o);
  p.noise({ dur: 0.45, a: 0.02, sus: 1, gain: 0.16, filter: { type: 'highpass', f: 4500 } });
  p.noise({ color: 'crackle', dur: 0.5, gain: 0.3, filter: { type: 'highpass', f: 2500 } });
});

registerSfx('rock_break', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.14 });
  p.noise({ dur: 0.025, gain: 0.42, filter: { type: 'bandpass', f: 1800, q: 1 } });
  thump(p, 0, 140, 48, 0.2, 0.45);
  p.noise({ color: 'brown', dur: 0.3, gain: 0.48, filter: { type: 'lowpass', f: [2000, 300] }, drive: 2 });
  debris(p, 0.02, 0.45, 0.55, 1400, 0.9);
});

registerSfx('pot_break', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.14 });
  click(p, 0, 0.38, 2500, 0.02);
  for (let i = 0; i < 4; i++) p.fm({ f: rnd(1800, 4200), ratio: rnd(1.3, 2.9), index: [2, 0.1], at: rnd(0, 0.12), dur: rnd(0.08, 0.2), gain: 0.08 });
  debris(p, 0, 0.3, 0.45, 3200, 0.7);
  thump(p, 0, 300, 140, 0.08, 0.2);
});

registerSfx('door_open', (ctx, out, t, o) => {
  // heavy stone slab grinding open, then settling
  const p = sp(ctx, out, t, o, { reverb: 0.22 });
  p.noise({ color: 'brown', dur: 0.5, a: 0.08, sus: 0.8, gain: 0.5, filter: { type: 'bandpass', f: [220, 380, 260], q: 3 }, drive: 2 });
  debris(p, 0.02, 0.48, 0.22, 900, 1);
  thump(p, 0.46, 72, 45, 0.25, 0.42);
  p.noise({ color: 'brown', at: 0.46, dur: 0.2, gain: 0.28, filter: { type: 'lowpass', f: 600 } });
});

registerSfx('door_close', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.3 });
  thump(p, 0, 110, 34, 0.36, 0.6);
  p.noise({ dur: 0.03, gain: 0.38, filter: { type: 'lowpass', f: 2500 } });
  p.noise({ color: 'brown', dur: 0.3, gain: 0.42, filter: { type: 'lowpass', f: [1200, 200] } });
  debris(p, 0.03, 0.3, 0.25, 1600, 1);
});

registerSfx('door_unlock', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.18 });
  p.fm({ f: 1900, ratio: 2.3, index: [3, 0.2], dur: 0.08, gain: 0.14 });
  click(p, 0, 0.26, 3000, 0.015);
  p.fm({ f: 1500, ratio: 2.3, index: [3, 0.2], at: 0.1, dur: 0.08, gain: 0.14 });
  click(p, 0.1, 0.26, 3000, 0.015);
  thump(p, 0.2, 200, 90, 0.15, 0.38);
  p.noise({ at: 0.2, dur: 0.05, gain: 0.28, filter: { type: 'bandpass', f: 800, q: 1.5 } });
  chime(p, 0.27, 81, 0.07, 0.35);
});

registerSfx('secret_found', (ctx, out, t, o) => {
  // signature discovery motif: rising lydian bells over a soft root
  const p = sp(ctx, out, t, o, { reverb: 0.5, delay: 0.22, stretch: 1 });
  [67, 71, 74, 78, 81, 85].forEach((m, i) => chime(p, i * 0.075, m, 0.11, 0.6));
  p.tone({ wave: 'triangle', f: mtof(55), dur: 0.9, a: 0.05, sus: 0.8, rel: 0.4, gain: 0.12, vib: [5, 10] });
  p.tone({ wave: 'sine', f: mtof(43), dur: 0.9, a: 0.1, sus: 0.8, rel: 0.4, gain: 0.14 });
  p.noise({ at: 0.3, dur: 0.6, a: 0.2, gain: 0.07, filter: { type: 'highpass', f: 7000 } });
});

registerSfx('trapdoor', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.38 });
  p.noise({ color: 'pink', dur: 0.45, a: 0.05, gain: 0.42, filter: { type: 'bandpass', f: [1500, 200], q: 1.5 } });
  p.tone({ wave: 'sawtooth', f: [300, 220, 260], dur: 0.3, gain: 0.07, filter: { type: 'bandpass', f: 900, q: 5 }, vib: [20, 60] });
  thump(p, 0.45, 90, 28, 0.4, 0.6);
  p.noise({ color: 'brown', at: 0.45, dur: 0.35, gain: 0.38, filter: { type: 'lowpass', f: 700 } });
});

registerSfx('floor_start', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.6, stretch: 1 });
  p.fm({ f: mtof(38), ratio: 1.4, index: [3, 0.3], dur: 2.0, gain: 0.28 });
  chime(p, 0.02, 62, 0.11, 1.6);
  chime(p, 0.35, 69, 0.07, 1.4);
  p.tone({ wave: 'sine', f: mtof(26), dur: 1.4, a: 0.3, sus: 0.8, rel: 0.5, gain: 0.2 });
  p.noise({ dur: 0.8, a: 0.6, gain: 0.06, filter: { type: 'bandpass', f: [400, 1200], q: 2 } });
});

registerSfx('room_clear', (ctx, out, t, o) => {
  // short satisfying resolve: rolled major chord on bells + warm pad
  const p = sp(ctx, out, t, o, { reverb: 0.4, stretch: 1 });
  [74, 78, 81, 86].forEach((m, i) => chime(p, i * 0.045, m, 0.1, 0.8));
  [62, 66, 69].forEach((m) => p.tone({ wave: 'triangle', f: mtof(m), a: 0.05, dur: 0.6, sus: 0.7, rel: 0.3, gain: 0.06 }));
  sparkle(p, 0.18, 3, 3500, 0.03, 0.05);
});

registerSfx('teleport', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.4, delay: 0.18 });
  p.fm({ f: [300, 1800], ratio: 1.5, index: [5, 1], dur: 0.5, gain: 0.14 });
  p.fm({ f: [310, 1850], ratio: 2, index: [3, 1], dur: 0.5, gain: 0.09 });
  p.noise({ dur: 0.3, a: 0.2, gain: 0.14, filter: { type: 'bandpass', f: [500, 8000], q: 3, dur: 0.5 } });
  sparkle(p, 0.35, 4, 2800, 0.05);
});

// --- pickups / economy --------------------------------------------------------

registerSfx('coin', (ctx, out, t, o) => {
  // tarnished copper: an inharmonic clink, then a rising-fifth glint (A5 -> E6)
  const p = sp(ctx, out, t, o, { reverb: 0.2 });
  const d = rnd(0.98, 1.02);
  p.fm({ f: 2350 * d, ratio: 1.47, index: [3, 0.2], dur: 0.07, gain: 0.13 });
  click(p, 0, 0.16, 6000, 0.01);
  p.tone({ wave: 'triangle', f: mtof(81) * d, at: 0.035, dur: 0.07, gain: 0.2 });
  p.tone({ wave: 'triangle', f: mtof(88) * d, at: 0.09, dur: 0.24, gain: 0.2 });
  chime(p, 0.09, 100, 0.07, 0.35, 2.0, 1.4);
});

registerSfx('heart', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.2 });
  thump(p, 0, 110, 60, 0.1, 0.38);
  thump(p, 0.12, 100, 55, 0.12, 0.3);
  p.tone({ wave: 'triangle', f: mtof(76), at: 0.03, dur: 0.25, gain: 0.11 });
  p.tone({ wave: 'triangle', f: mtof(81), at: 0.1, dur: 0.3, gain: 0.11 });
  p.tone({ wave: 'sine', f: mtof(88), at: 0.15, dur: 0.3, gain: 0.06, vib: [6, 15] });
});

registerSfx('blue_flame', (ctx, out, t, o) => {
  // a cool flame catching: airy breath, then a glassy rising pair
  const p = sp(ctx, out, t, o, { reverb: 0.5, delay: 0.2 });
  p.noise({ dur: 0.22, a: 0.06, gain: 0.1, filter: { type: 'bandpass', f: [900, 2600], q: 2 } });
  p.tone({ wave: 'sine', f: mtof(81), dur: 0.5, a: 0.05, gain: 0.18, vib: [5, 15] });
  p.tone({ wave: 'sine', f: mtof(88), at: 0.06, dur: 0.5, a: 0.05, gain: 0.15, vib: [5.5, 15] });
  p.tone({ wave: 'triangle', f: mtof(93), at: 0.12, dur: 0.45, a: 0.05, gain: 0.09 });
  p.noise({ dur: 0.35, a: 0.12, gain: 0.08, filter: { type: 'bandpass', f: [2000, 5000], q: 4 } });
});

registerSfx('match_pickup', (ctx, out, t, o) => {
  // dry wooden sticks rattling in a little box
  const p = sp(ctx, out, t, o, { reverb: 0.12 });
  [0, 0.045, 0.08].forEach((at, i) => click(p, at, 0.2 - i * 0.04, rnd(2600, 3600), 0.012));
  p.fm({ f: 1250 * rnd(0.97, 1.03), ratio: 1.9, index: [1.5, 0.1], at: 0.02, dur: 0.06, gain: 0.07 });
  debris(p, 0.03, 0.12, 0.18, 4200, 0.8);
  p.tone({ wave: 'triangle', f: mtof(84), at: 0.1, dur: 0.12, gain: 0.07 });
});

// --- match fire ---------------------------------------------------------------

registerSfx('match_strike', (ctx, out, t, o) => {
  // the scratch along the striker, then the head flaring into a small flame
  const p = sp(ctx, out, t, o, { reverb: 0.15 });
  p.noise({ dur: 0.09, a: 0.005, gain: 0.32, filter: { type: 'bandpass', f: [2400, 6200], q: 2.5 } });
  p.noise({ color: 'crackle', at: 0.04, dur: 0.12, gain: 0.22, filter: { type: 'highpass', f: 3000 } });
  p.noise({ at: 0.08, dur: 0.35, a: 0.03, gain: 0.2, filter: { type: 'lowpass', f: [700, 2400, 900] } });
  thump(p, 0.08, 160, 90, 0.08, 0.12);
});

registerSfx('seal_burn', (ctx, out, t, o) => {
  // wax hissing and cords crackling apart
  const p = sp(ctx, out, t, o, { reverb: 0.2 });
  p.noise({ dur: 0.5, a: 0.02, sus: 0.6, gain: 0.16, filter: { type: 'highpass', f: [5200, 3200] } });
  p.noise({ color: 'crackle', dur: 0.45, gain: 0.3, filter: { type: 'bandpass', f: 2600, q: 1.5 } });
  p.noise({ color: 'brown', at: 0.05, dur: 0.3, gain: 0.18, filter: { type: 'lowpass', f: [1400, 400] } });
  [0.12, 0.2, 0.31].forEach((at) => click(p, at, 0.12, rnd(1800, 3000), 0.01));
});

registerSfx('lantern_lit', (ctx, out, t, o) => {
  // a whoomp of flame catching in stone, then a warm chord and a few sparks
  const p = sp(ctx, out, t, o, { reverb: 0.4, stretch: 1 });
  p.noise({ dur: 0.3, a: 0.04, gain: 0.3, filter: { type: 'lowpass', f: [300, 2200, 600] }, drive: 1.5 });
  thump(p, 0.02, 120, 60, 0.18, 0.3);
  [64, 68, 71, 76].forEach((m, i) => p.tone({ wave: 'triangle', f: mtof(m), at: 0.08 + i * 0.04, dur: 0.5, sus: 0.6, rel: 0.3, gain: 0.07 }));
  sparkle(p, 0.2, 4, 3200, 0.04);
});

registerSfx('chest_open', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.3 });
  click(p, 0, 0.32, 2500, 0.015);
  p.fm({ f: 1200, ratio: 2.4, index: [3, 0.2], dur: 0.06, gain: 0.09 });
  p.tone({ wave: 'sawtooth', f: [180, 260, 210], at: 0.05, dur: 0.3, gain: 0.07, filter: { type: 'bandpass', f: 700, q: 6 }, vib: [25, 50] });
  thump(p, 0.32, 110, 70, 0.15, 0.3);
  [84, 88, 91, 96].forEach((m, i) => chime(p, 0.3 + i * 0.05, m, 0.065, 0.4));
});

registerSfx('item_get', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.35, stretch: 1 });
  [67, 71, 74, 79].forEach((m, i) =>
    p.tone({ wave: 'pulse25', f: mtof(m), at: i * 0.06, dur: i === 3 ? 0.45 : 0.08, sus: 0.7, rel: 0.2, gain: 0.1, filter: { type: 'lowpass', f: 4000 }, vib: i === 3 ? [5.5, 14, 0.15] : undefined }),
  );
  p.tone({ wave: 'triangle', f: mtof(43), dur: 0.55, sus: 0.8, rel: 0.2, gain: 0.24, crush: 8 });
  chime(p, 0.18, 91, 0.07, 0.7);
});

registerSfx('item_get_rare', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.5, delay: 0.2, stretch: 1 });
  thump(p, 0, 75, 40, 0.5, 0.35);
  // choir-ish swell on D major
  [50, 57, 62, 66, 69].forEach((m) =>
    p.tone({ wave: 'sawtooth', f: mtof(m), a: 0.15, dur: 1.0, sus: 0.8, rel: 0.4, gain: 0.045, filter: { type: 'lowpass', f: 1800 }, vib: [5, 12, 0.1] }),
  );
  [74, 78, 81, 86, 90, 93].forEach((m, i) => p.tone({ wave: 'pulse12', f: mtof(m), at: i * 0.05, dur: 0.12, gain: 0.07, filter: { type: 'lowpass', f: 6000 } }));
  chime(p, 0.35, 86, 0.1, 1.0);
  chime(p, 0.42, 93, 0.07, 0.9);
  sparkle(p, 0.4, 6, 2500, 0.04, 0.06);
});

registerSfx('buy', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.22 });
  p.noise({ color: 'brown', dur: 0.06, gain: 0.3, filter: { type: 'lowpass', f: 900 } });
  click(p, 0, 0.18, 4000, 0.012);
  p.tone({ wave: 'pulse25', f: 1319, at: 0.04, dur: 0.05, sus: 1, rel: 0.01, gain: 0.15, filter: { type: 'lowpass', f: 5000 } });
  p.tone({ wave: 'pulse25', f: 1976, at: 0.09, dur: 0.25, gain: 0.15, filter: { type: 'lowpass', f: 5000 } });
  chime(p, 0.09, 100, 0.09, 0.45);
  debris(p, 0.02, 0.18, 0.2, 5000, 1.2);
});

registerSfx('no_money', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.08 });
  p.tone({ wave: 'square', f: 196, dur: 0.1, sus: 1, rel: 0.02, gain: 0.11, filter: { type: 'lowpass', f: 1200 } });
  p.tone({ wave: 'square', f: 147, at: 0.12, dur: 0.16, sus: 1, rel: 0.03, gain: 0.11, filter: { type: 'lowpass', f: 1000 } });
  p.tone({ wave: 'sawtooth', f: 98, dur: 0.28, gain: 0.06, filter: { type: 'lowpass', f: 600 } });
});

registerSfx('active_use', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.3 });
  p.noise({ dur: 0.12, a: 0.12, gain: 0.24, filter: { type: 'bandpass', f: [600, 5000], q: 2, dur: 0.24 } });
  p.fm({ f: [440, 880], ratio: 2, index: [4, 0.5], at: 0.05, dur: 0.3, gain: 0.13 });
  chime(p, 0.2, 86, 0.07, 0.4);
  thump(p, 0.18, 180, 80, 0.15, 0.24);
});

registerSfx('active_ready', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.3 });
  chime(p, 0, 84, 0.2, 0.35);
  chime(p, 0.08, 91, 0.2, 0.4);
  p.tone({ wave: 'pulse12', f: mtof(96), at: 0.08, dur: 0.12, gain: 0.035 });
});

registerSfx('potion', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.14 });
  for (let i = 0; i < 3; i++) {
    p.tone({ wave: 'sine', f: [400 - i * 40, 250 - i * 30], at: i * 0.11, sweep: 0.06, dur: 0.08, gain: 0.24 });
    p.noise({ color: 'pink', at: i * 0.11, dur: 0.07, gain: 0.18, filter: { type: 'lowpass', f: 700, q: 5 } });
  }
  p.tone({ wave: 'sine', f: [300, 900], at: 0.36, sweep: 0.08, dur: 0.1, gain: 0.14 });
  chime(p, 0.38, 79, 0.055, 0.3);
});
