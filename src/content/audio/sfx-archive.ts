// Sound effects of the drowned archive (floor 6): wet ink splashing, paper fluttering,
// water surging as something surfaces.

import { registerSfx } from '../../audio/audio';
import { rnd } from '../../audio/synth';
import { debris, sp, thump } from '../../audio/sfxkit';

registerSfx('ink_splash', (ctx, out, t, o) => {
  // thick liquid slap: low wet thump + gurgling filtered noise + a few droplets
  const p = sp(ctx, out, t, o, { reverb: 0.16 });
  thump(p, 0, 190, 70, 0.14, 0.34);
  p.noise({ color: 'pink', dur: 0.2, gain: 0.3, filter: { type: 'lowpass', f: [1800, 500], q: 2 } });
  p.fm({ f: [260, 140], ratio: 0.5, index: [4, 1], dur: 0.14, gain: 0.12 });
  for (let i = 0; i < 3; i++) p.tone({ wave: 'sine', f: [rnd(900, 1400), rnd(1600, 2400)], at: 0.06 + i * 0.05, sweep: 0.03, dur: 0.04, gain: 0.08 });
});

registerSfx('paper_flutter', (ctx, out, t, o) => {
  // pages riffling: rapid band-passed noise bursts with a soft rustle tail
  const p = sp(ctx, out, t, o, { reverb: 0.1 });
  for (let i = 0; i < 6; i++) p.noise({ at: i * 0.045, dur: 0.035, gain: 0.26 - i * 0.025, filter: { type: 'bandpass', f: rnd(2200, 3800), q: 2.2 } });
  p.noise({ color: 'pink', dur: 0.4, a: 0.05, gain: 0.1, filter: { type: 'highpass', f: 3500 } });
  debris(p, 0.02, 0.3, 0.14, 4200, 1.2);
});

registerSfx('water_surge', (ctx, out, t, o) => {
  // water heaving upward: rising band-passed brown noise + a low swell + splash tail
  const p = sp(ctx, out, t, o, { reverb: 0.25 });
  p.noise({ color: 'brown', dur: 0.55, a: 0.18, sus: 0.6, gain: 0.5, filter: { type: 'bandpass', f: [300, 1400, 900], q: 1.4 } });
  p.tone({ wave: 'sine', f: [70, 120, 60], dur: 0.5, a: 0.15, gain: 0.2 });
  p.noise({ at: 0.3, dur: 0.3, gain: 0.22, filter: { type: 'highpass', f: [2500, 5000] } });
  debris(p, 0.32, 0.3, 0.2, 2600, 0.8);
});
