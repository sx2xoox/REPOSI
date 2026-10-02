// Floor 7 — "멈춘 태엽탑" (The Stopped Clockwork Spire). E minor, a slow, uneasy waltz
// in 3/4: a music box plays the tune over a dark string pad, a glockenspiel answers on
// the off-beats, a pizzicato bass walks the root and fifth, and a ticking layer keeps a
// time that nothing else obeys (a low pendulum thud on the one, ticks and tocks between,
// a cog ratchet now and then). Combat: a harpsichord ostinato, kick on the one with rims
// on two and three, a sub under the bass; the ticks never stop.

import { defineSong } from '../../audio/song';
import { bell, kit, pad, pluck, subBass, strings, wind, type Kit } from '../../audio/instruments';
import { Patch, mtof } from '../../audio/synth';
import { lastBarHold, once, scaleNote } from './music-lib';

const P = (ctx: Parameters<Kit[string]>[0], out: AudioNode, t: number, vol: number) => new Patch(ctx, out, t, { vol, stretch: 1 });

/** The clockwork percussion: ticks, tocks, a pendulum thud, a cog ratchet and a chime. */
const clockKit: Kit = {
  tick: (ctx, out, t, _m, _d, vel) => {
    const p = P(ctx, out, t, vel * 0.2);
    p.tone({ wave: 'square', f: 2600, dur: 0.016, gain: 0.55, filter: { type: 'bandpass', f: 2900, q: 4 } });
    p.noise({ dur: 0.01, gain: 0.5, filter: { type: 'highpass', f: 5200 } });
  },
  tock: (ctx, out, t, _m, _d, vel) => {
    const p = P(ctx, out, t, vel * 0.22);
    p.tone({ wave: 'triangle', f: [1150, 720], sweep: 0.02, dur: 0.03, gain: 0.6, filter: { type: 'lowpass', f: 2400 } });
    p.noise({ dur: 0.012, gain: 0.3, filter: { type: 'bandpass', f: 1800, q: 2 } });
  },
  pendulum: (ctx, out, t, _m, _d, vel) => {
    const p = P(ctx, out, t, vel * 0.42);
    p.tone({ wave: 'sine', f: [130, 62], sweep: 0.08, dur: 0.34, gain: 1 });
    p.tone({ wave: 'triangle', f: [320, 120], sweep: 0.03, dur: 0.05, gain: 0.3 });
  },
  ratchet: (ctx, out, t, _m, _d, vel) => {
    const p = P(ctx, out, t, vel * 0.14);
    for (let i = 0; i < 7; i++) p.noise({ at: i * 0.028, dur: 0.012, gain: 0.7 - i * 0.06, filter: { type: 'bandpass', f: 3200 + i * 140, q: 3 } });
  },
  chime: (ctx, out, t, m, _d, vel) => {
    const p = P(ctx, out, t, vel * 0.16);
    const f = mtof(m > 0 ? m : 88);
    p.fm({ f, ratio: 3.01, index: [2.4, 0.2], dur: 1.5, gain: 0.8 });
    p.tone({ wave: 'sine', f: f * 2.76, dur: 0.6, gain: 0.2 });
  },
};

const drums = kit({ gain: 0.85, tune: 0.95 });

// 3/4 bars of 12 steps (4 per beat)
const LEAD_A = 'B4/4 E5/4 G5/4 | F#5/8 E5/4 | D#5/4 E5/4 F#5/4 | G5/8 ./4 | A5/4 G5/4 F#5/4 | E5/8 D#5/4 | E5/4 B4/4 C5/4 | B4/12 |';
const LEAD_B = 'G5/4 E5/4 C5/4 | D5/8 B4/4 | C5/4 E5/4 A5/4 | G#5/8 ./4 | G5/4 F#5/4 E5/4 | D5/4 F5/4 A#5/4 | B5/8 A5/4 | F#5/4 G5/4 B4/4 |';
/** the glockenspiel's answer, a bar behind the tune */
const ANSWER_A = './12 | B5/4 ./8 | ./12 | G5/4 F#5/4 ./4 | ./12 | B5/4 ./8 | ./12 | E5/4 ./8 |';
const ANSWER_B = './12 | G5/4 ./8 | ./12 | E5/4 ./8 | ./12 | ./12 | F5/4 ./8 | D5/4 ./8 |';

const TICKS = {
  ticks: {
    drums: {
      pendulum: 'x...........',
      tick: '....x.......',
      tock: '........x...',
    },
  },
};

const COMBAT = {
  harpsi: { arp: '0.1.2.3.2.1.', oct: 4, vel: 0.85 },
  sub: { bass: 'R-------5---', oct: 2 },
  drums: {
    drums: {
      kick: 'x...........',
      rim: '....x...x...',
      hat: 'g.g.g.g.g.g.',
      shaker: '..g...g...g.',
    },
  },
};

defineSong('floor7', {
  bpm: 86,
  meter: 3,
  master: 1.12,
  eq: { low: -2, high: 2 },
  reverb: { seconds: 3.6, decay: 2.4, gain: 0.62, tone: 0.42 },
  delay: { beats: 1, feedback: 0.34, gain: 0.3, tone: 2600 },
  channels: {
    box: { inst: bell({ ratio: 3.5, index: 1.3, decay: 1.25, gain: 0.17, partial: 2.76, partialGain: 0.16 }), vol: 0.9, reverb: 0.5, delay: 0.22, pan: -0.12 },
    glock: { inst: bell({ ratio: 2, index: 0.8, decay: 2.2, gain: 0.11 }), vol: 0.7, reverb: 0.7, delay: 0.25, pan: 0.25 },
    pad: { inst: strings({ gain: 0.07, cutoff: 1500, a: 0.5, r: 1.2, voices: 3 }), vol: 0.75, reverb: 0.6 },
    drone: { inst: pad({ wave: 'sawtooth', voices: 2, detune: 10, gain: 0.05, cutoff: 420, q: 1.1, a: 1.4, r: 2.2, wobble: 90, wobbleRate: 0.09, sub: 0.3 }), vol: 0.85, reverb: 0.45, layer: 'calm' },
    pizz: { inst: pluck({ wave: 'triangle', gain: 0.3, decay: 0.5, bright: 3, q: 1 }), vol: 0.9, reverb: 0.25 },
    ticks: { inst: clockKit, vol: 0.8, reverb: 0.3, pan: 0.1 },
    harpsi: { inst: pluck({ wave: 'sawtooth', gain: 0.14, decay: 0.45, bright: 7, q: 1.4 }), vol: 0.7, reverb: 0.3, delay: 0.18, pan: -0.2, layer: 'combat' },
    sub: { inst: subBass({ gain: 0.32, glide: 2 }), vol: 0.6, layer: 'combat' },
    drums: { inst: drums, vol: 0.62, layer: 'combat', reverb: 0.3 },
    air: { inst: wind, vol: 0.4, reverb: 0.5, layer: 'calm' },
  },
  sections: {
    A: {
      bars: 8,
      chords: 'Em | Em | Am | B7 | Em | C | Am6 | B7',
      parts: {
        box: LEAD_A,
        glock: [ANSWER_A, { chord: '....x...x...', center: 76, vel: 0.5, maxTones: 3 }],
        pad: { hold: true, center: 55, maxTones: 3 },
        drone: { bass: 'R-----------', oct: 2, vel: 0.8 },
        pizz: { bass: 'R.......5...', oct: 2, vel: 0.9 },
        ...TICKS,
        ...COMBAT,
      },
    },
    A2: {
      bars: 8,
      chords: 'Em | Em | Am | B7 | Em | C | Am6 | B7',
      parts: {
        box: { notes: LEAD_A, transpose: 12, vel: 0.7 },
        glock: [{ notes: ANSWER_A, transpose: -12 }, { chord: '....x...x...', center: 72, vel: 0.5, maxTones: 3 }],
        pad: { hold: true, center: 55, maxTones: 3 },
        drone: { bass: 'R-----------', oct: 2, vel: 0.8 },
        pizz: { bass: 'R...3...5...', oct: 2, vel: 0.9 },
        ...TICKS,
        ...COMBAT,
      },
    },
    B: {
      bars: 8,
      chords: 'Cmaj7 | G | Am | F#dim | Em | Bb | B7 | B7',
      parts: {
        box: LEAD_B,
        glock: [ANSWER_B, { chord: '....x...x...', center: 76, vel: 0.55, maxTones: 3 }],
        pad: { hold: true, center: 57, maxTones: 3, vel: 0.9 },
        drone: { bass: 'R-----------', oct: 2, vel: 0.8 },
        pizz: { bass: 'R...5...8...', oct: 2, vel: 0.95 },
        ticks: {
          drums: {
            pendulum: 'x...........',
            tick: '....x.....x.',
            tock: '........x...',
            ratchet: '.'.repeat(84) + 'x...........',
          },
        },
        harpsi: { arp: '0.2.1.3.2.1.', oct: 4, vel: 0.9 },
        sub: { bass: 'R-----5-----', oct: 2 },
        drums: {
          drums: {
            kick: 'x.....x.....',
            rim: '....x...x..g',
            hat: 'g.g.g.g.g.g.',
            shaker: '..g...g...g.',
            'tom:E2': '.'.repeat(84) + '......x.x.x.',
            crash: once(8, 'x', 12),
            swell: lastBarHold(8, 12),
          },
        },
      },
    },
  },
  order: ['A|A2', 'B'],
  onBar: (b) => {
    // stray notes of the music box, as if a cylinder pin were bent
    if (b.rng.chance(0.3)) b.play('glock', scaleNote(b, 88, [0, 2, 3, 7, 8], 1), b.rng.int(0, 11), 2, 0.3 + b.rng.next() * 0.3);
    // a chime from some clock that still strikes
    if (b.barInSection % 4 === 3 && b.rng.chance(0.45)) b.hit('ticks', 'chime', b.rng.int(0, 2) * 4, 0.45, 88 + b.rng.int(0, 1) * 7, 1);
    // air through the cracked pipes
    if (b.barInSection % 2 === 1 && b.rng.chance(0.4)) b.play('air', 60, 0, 12, 0.45);
  },
});
