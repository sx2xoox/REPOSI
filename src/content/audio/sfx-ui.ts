// Sound effects: menus and UI. Quiet, short, clean (no reverb wash), with a
// consistent "lantern glass" timbre so the interface feels like one object.

import { registerSfx } from '../../audio/audio';
import { chime, click, sp } from '../../audio/sfxkit';

registerSfx('ui_move', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o);
  p.tone({ wave: 'triangle', f: 1600, dur: 0.025, gain: 0.12 });
  click(p, 0, 0.07, 5000, 0.008);
});

registerSfx('ui_select', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.08 });
  p.tone({ wave: 'pulse25', f: 880, dur: 0.05, sus: 1, rel: 0.01, gain: 0.09, filter: { type: 'lowpass', f: 4000 } });
  p.tone({ wave: 'pulse25', f: 1319, at: 0.05, dur: 0.1, gain: 0.09, filter: { type: 'lowpass', f: 4000 } });
  chime(p, 0.05, 100, 0.035, 0.15);
});

registerSfx('ui_back', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.06 });
  p.tone({ wave: 'pulse25', f: 1175, dur: 0.05, sus: 1, rel: 0.01, gain: 0.08, filter: { type: 'lowpass', f: 3500 } });
  p.tone({ wave: 'pulse25', f: 784, at: 0.05, dur: 0.09, gain: 0.08, filter: { type: 'lowpass', f: 3000 } });
});

registerSfx('ui_open', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.1 });
  p.noise({ dur: 0.08, a: 0.05, gain: 0.12, filter: { type: 'bandpass', f: [700, 3200], q: 2, dur: 0.13 } });
  p.tone({ wave: 'triangle', f: [900, 1250], at: 0.04, dur: 0.08, gain: 0.08 });
  click(p, 0.1, 0.06, 4000, 0.008);
});

registerSfx('ui_close', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.06 });
  p.noise({ dur: 0.08, a: 0.04, gain: 0.11, filter: { type: 'bandpass', f: [3000, 700], q: 2, dur: 0.12 } });
  p.tone({ wave: 'triangle', f: [1150, 800], at: 0.03, dur: 0.08, gain: 0.07 });
});

registerSfx('ui_error', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o);
  p.tone({ wave: 'square', f: 165, dur: 0.06, sus: 1, rel: 0.01, gain: 0.075, filter: { type: 'lowpass', f: 1400 } });
  p.tone({ wave: 'square', f: 155, at: 0.08, dur: 0.09, sus: 1, rel: 0.02, gain: 0.075, filter: { type: 'lowpass', f: 1200 } });
});

registerSfx('ui_place', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.05 });
  p.tone({ wave: 'sine', f: [320, 150], dur: 0.06, gain: 0.25 });
  click(p, 0, 0.12, 3000, 0.01);
  p.tone({ wave: 'triangle', f: 1050, at: 0.02, dur: 0.05, gain: 0.05 });
});
