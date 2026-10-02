// Sound effects of the character kits (passives and dashes): short, soft-edged
// and pitch-randomised like the other frequent player sounds.
//   리아  ember_burst (불씨 폭발)             베른  momentum (기세 상승), rush (설원 돌진)
//   세린  scent (냄새 표식), vault (도약)       니엘  echo (공허 메아리), blink / rift (공허 걸음)

import { registerSfx } from '../../audio/audio';
import { rnd } from '../../audio/synth';
import { chime, click, sp, sparkle, thump, whooshLayer } from '../../audio/sfxkit';

// 리아: four hits ignite the ember marks — a crackling pop with a warm tail
registerSfx('ember_burst', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.2 });
  const d = rnd(0.95, 1.05);
  thump(p, 0, 320 * d, 90 * d, 0.22, 0.4);
  p.noise({ dur: 0.18, a: 0.005, gain: 0.3, filter: { type: 'bandpass', f: [2600 * d, 900 * d], q: 1.2 } });
  p.tone({ wave: 'triangle', f: [880 * d, 520 * d], sweep: 0.12, dur: 0.16, gain: 0.14 });
  sparkle(p, 0.03, 4, 3100, 0.05, 0.03);
});

// 베른: a momentum stack — a rising whoosh with a clean metallic tick (pitch rises with the stacks)
registerSfx('momentum', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.1 });
  whooshLayer(p, 0, 0.16, [600, 2200, 1400], 0.5, 2.4);
  p.tone({ wave: 'triangle', f: [520, 780], sweep: 0.08, dur: 0.12, gain: 0.14 });
  click(p, 0.02, 0.18, 3800, 0.012);
});

// 베른: the sled rush — low shove of snow plus a broad whoosh
registerSfx('rush', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.1 });
  p.noise({ color: 'brown', dur: 0.26, a: 0.01, gain: 0.5, filter: { type: 'lowpass', f: [2400, 500] } });
  whooshLayer(p, 0, 0.24, [300, 1700, 500], 0.7, 1.8);
  p.tone({ wave: 'sine', f: [160, 70], dur: 0.18, gain: 0.3 });
});

// 세린: a scent mark lands — a tiny sniff and a bright tick
registerSfx('scent', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.08 });
  p.noise({ dur: 0.07, a: 0.01, gain: 0.22, filter: { type: 'bandpass', f: [1200, 2600], q: 2 } });
  p.tone({ wave: 'sine', f: [1900, 2500], dur: 0.06, gain: 0.1 });
  click(p, 0.03, 0.12, 4200, 0.01);
});

// 세린: the vault — a springy upward whoosh and a soft landing
registerSfx('vault', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.08 });
  whooshLayer(p, 0, 0.2, [700, 2800, 1200], 0.8, 2);
  p.tone({ wave: 'triangle', f: [260, 620], sweep: 0.1, dur: 0.14, gain: 0.16 });
  p.noise({ color: 'brown', dur: 0.08, at: 0.16, gain: 0.25, filter: { type: 'lowpass', f: 900 } });
});

// 니엘: a void echo leaves — a hollow reversed-sounding tone
registerSfx('echo', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.35, delay: 0.14 });
  const d = rnd(0.96, 1.04);
  p.fm({ f: [240 * d, 420 * d], ratio: 1.5, index: [1, 4], dur: 0.22, gain: 0.2 });
  p.tone({ wave: 'sine', f: [900 * d, 1500 * d], a: 0.08, dur: 0.18, gain: 0.08 });
});

// 니엘: blink out — a quick inward suck
registerSfx('blink', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.2 });
  p.noise({ dur: 0.14, a: 0.06, gain: 0.3, filter: { type: 'bandpass', f: [600, 3600], q: 1.4 } });
  p.tone({ wave: 'sine', f: [320, 1100], sweep: 0.12, dur: 0.13, gain: 0.18 });
  chime(p, 0.06, 91, 0.1, 0.25);
});

// 니엘: the rift collapses — a dark thud with a glassy tail
registerSfx('rift', (ctx, out, t, o) => {
  const p = sp(ctx, out, t, o, { reverb: 0.3 });
  thump(p, 0, 140, 40, 0.3, 0.5);
  p.fm({ f: [480, 160], ratio: 2.01, index: [5, 0.5], dur: 0.26, gain: 0.16 });
  p.noise({ dur: 0.2, a: 0.01, gain: 0.18, filter: { type: 'highpass', f: 2600 } });
});
