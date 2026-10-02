// Sound effects of the stopped clockwork spire (floor 7): ticks, wind-up springs,
// rolling cog ratchets, a cuckoo's call, leaking steam, a pendulum blade, porcelain
// cracking, time rewinding and snapping back.

import { registerSfx } from '../../audio/audio';
import { rnd } from '../../audio/synth';
import { click, debris, sp, thump } from '../../audio/sfxkit';

registerSfx('clock_tick', (ctx, out, t, o) => {
  // one dry tick of an escapement: a click and a tiny woody body
  const p = sp(ctx, out, t, o, { reverb: 0.08 });
  click(p, 0, 0.35, 3200, 0.012);
  p.tone({ wave: 'square', f: 2400, dur: 0.018, gain: 0.3, filter: { type: 'bandpass', f: 2600, q: 4 } });
  p.tone({ wave: 'triangle', f: [900, 620], sweep: 0.02, dur: 0.035, gain: 0.22 });
});

registerSfx('clock_spring', (ctx, out, t, o) => {
  // winding a key: a run of rising ratchet clicks, then the spring twangs
  const p = sp(ctx, out, t, o, { reverb: 0.1 });
  for (let i = 0; i < 7; i++) p.noise({ at: i * 0.035, dur: 0.012, gain: 0.3, filter: { type: 'bandpass', f: 2200 + i * 260, q: 3.5 } });
  p.tone({ wave: 'sine', f: [520, 1180, 760], sweep: 0.14, dur: 0.22, at: 0.24, gain: 0.26, vib: [22, 60, 0] });
  p.tone({ wave: 'triangle', f: [1040, 2360], sweep: 0.1, dur: 0.12, at: 0.24, gain: 0.08 });
});

registerSfx('clock_ratchet', (ctx, out, t, o) => {
  // a cog rolling over its teeth: fast clicks with a thin metallic ring
  const p = sp(ctx, out, t, o, { reverb: 0.12 });
  for (let i = 0; i < 10; i++) p.noise({ at: i * 0.03, dur: 0.01, gain: 0.32 - i * 0.015, filter: { type: 'bandpass', f: rnd(2600, 3400), q: 3 } });
  p.fm({ f: 1480, ratio: 2.76, index: [2.5, 0.2], dur: 0.32, gain: 0.07 });
  debris(p, 0.02, 0.3, 0.1, 3600, 1.4);
});

registerSfx('clock_chime', (ctx, out, t, o) => {
  // cuckoo: two whistled notes a minor third apart over a little bell
  const p = sp(ctx, out, t, o, { reverb: 0.2 });
  p.tone({ wave: 'sine', f: [1240, 1180], dur: 0.16, a: 0.015, gain: 0.3, vib: [6, 20, 0.05] });
  p.tone({ wave: 'sine', f: [1040, 990], at: 0.2, dur: 0.22, a: 0.015, gain: 0.3, vib: [6, 20, 0.05] });
  p.tone({ wave: 'triangle', f: 2480, dur: 0.14, gain: 0.05 });
  p.fm({ f: 1660, ratio: 3.5, index: [2, 0.1], at: 0.2, dur: 0.7, gain: 0.08 });
});

registerSfx('clock_steam', (ctx, out, t, o) => {
  // steam escaping a cracked pipe: a hiss that falls away, with a thin whistle on top
  const p = sp(ctx, out, t, o, { reverb: 0.18 });
  p.noise({ color: 'pink', dur: 0.62, a: 0.03, gain: 0.5, filter: { type: 'bandpass', f: [3200, 1200], q: 0.9 } });
  p.noise({ dur: 0.3, gain: 0.22, filter: { type: 'highpass', f: 6000 } });
  p.tone({ wave: 'sine', f: [2600, 1900], sweep: 0.4, dur: 0.42, a: 0.05, gain: 0.07, vib: [12, 30, 0] });
});

registerSfx('clock_pendulum', (ctx, out, t, o) => {
  // the blade sweeping past: a heavy whoosh with a metallic shing at the end
  const p = sp(ctx, out, t, o, { reverb: 0.16 });
  p.noise({ color: 'pink', dur: 0.34, a: 0.08, gain: 0.5, filter: { type: 'bandpass', f: [400, 1600, 700], q: 1.6 } });
  thump(p, 0.02, 160, 70, 0.2, 0.22);
  p.fm({ f: 2100, ratio: 1.41, index: [3, 0.2], at: 0.16, dur: 0.4, gain: 0.1 });
  click(p, 0.16, 0.3, 2800, 0.015);
});

registerSfx('clock_crack', (ctx, out, t, o) => {
  // porcelain cracking: a sharp snap and glassy chips skittering
  const p = sp(ctx, out, t, o, { reverb: 0.14 });
  click(p, 0, 0.6, 2200, 0.02);
  p.noise({ dur: 0.08, gain: 0.35, filter: { type: 'bandpass', f: 4200, q: 1.2 } });
  for (let i = 0; i < 4; i++) p.fm({ f: rnd(2400, 4200), ratio: 2.01, index: [1.5, 0.1], at: 0.03 + i * 0.045, dur: 0.14, gain: 0.07 });
  debris(p, 0.05, 0.3, 0.14, 5200, 1.1);
});

registerSfx('clock_rewind', (ctx, out, t, o) => {
  // time running backwards: a rising reversed whoosh under a warbling tone that climbs
  const p = sp(ctx, out, t, o, { reverb: 0.22 });
  p.noise({ color: 'pink', dur: 0.6, a: 0.3, gain: 0.32, filter: { type: 'bandpass', f: [500, 2800], q: 1.2 } });
  p.tone({ wave: 'triangle', f: [220, 880], sweep: 0.55, dur: 0.6, a: 0.1, gain: 0.14, vib: [9, 45, 0] });
  p.tone({ wave: 'sine', f: [440, 1760], sweep: 0.55, dur: 0.55, a: 0.1, gain: 0.07 });
  for (let i = 0; i < 5; i++) p.noise({ at: 0.5 - i * 0.07, dur: 0.01, gain: 0.14, filter: { type: 'bandpass', f: 2600 + i * 200, q: 3 } });
});

registerSfx('clock_snap', (ctx, out, t, o) => {
  // a pocket of stopped time collapsing: a hard clack and a bright ping that rushes off
  const p = sp(ctx, out, t, o, { reverb: 0.2 });
  click(p, 0, 0.7, 1800, 0.025);
  thump(p, 0, 420, 90, 0.12, 0.3);
  p.fm({ f: 1980, ratio: 3.5, index: [3, 0.1], dur: 0.45, gain: 0.14 });
  p.noise({ dur: 0.22, gain: 0.18, filter: { type: 'highpass', f: [7000, 2000] } });
});
