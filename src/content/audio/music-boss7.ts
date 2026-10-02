// Floor 7 boss theme — boss_clockwork: "멈춘 태엽탑의 왈츠" (Waltz of the Stopped Spire).
// A fast, tense waltz in G harmonic minor at 160 BPM (3/4): a ticking rim on beats
// two and three, a pizzicato-harpsichord oom-pah-pah, a music-box doubling the lead,
// strings and organ driving the second half, and a breakdown where only the music
// box keeps turning before a riser pulls the loop back round. Shared by both floor-7
// bosses (시계장인, 태엽 무희).

import { defineSong } from '../../audio/song';
import { bell, choir, kit, lead, organ, pad, pluck, sawBass, strings } from '../../audio/instruments';
import { lastBarHold, once } from './music-lib';

const clockKit = kit({ chip: true, gain: 1.0 });
/** steps per bar in 3/4 (3 beats x 4) */
const S = 12;

const LEAD_A =
  'D5/8 G5/2 Bb5/2 | A5/4 G5/4 F#5/4 | G5/8 Eb5/4 | D5/6 C5/2 D5/4 | Eb5/4 D5/4 C5/4 | Bb4/8 D5/4 | C5/4 Eb5/4 D5/4 | G4/12 |';
const LEAD_A2 =
  'D5/8 G5/2 Bb5/2 | A5/4 G5/4 F#5/4 | G5/8 Bb5/4 | D6/6 C6/2 Bb5/4 | Eb5/4 D5/4 C5/4 | Bb4/8 D5/4 | F#5/4 A5/4 C6/4 | G5/8 D5/4 |';
const LEAD_B =
  'G5/4 Bb5/4 D6/4 | C6/6 Bb5/2 A5/4 | Bb5/4 G5/4 Eb5/4 | D5/8 F#5/4 | G5/4 Bb5/4 D6/4 | Eb6/6 D6/2 C6/4 | D6/4 Bb5/4 G5/4 | A5/8 F#5/4 |';
const COUNTER_B =
  'D4/4 G4/4 Bb4/4 | Eb4/4 G4/4 C5/4 | Bb3/4 Eb4/4 G4/4 | D4/4 F#4/4 A4/4 | D4/4 G4/4 Bb4/4 | Eb4/4 G4/4 Bb4/4 | D4/4 G4/4 Bb4/4 | D4/4 F#4/4 A4/4 |';
const BOX_C =
  'G5/2 Bb5/2 D6/2 G6/2 D6/2 Bb5/2 | Eb5/2 G5/2 Bb5/2 Eb6/2 Bb5/2 G5/2 | C5/2 Eb5/2 G5/2 C6/2 G5/2 Eb5/2 | D5/2 F#5/2 A5/2 D6/2 A5/2 F#5/2 |';

/** oom-pah-pah: boom on one, the clock's rim ticks on two and three */
const WALTZ = {
  boom: 'x...........',
  rim: '....x...x...',
  hat: 'x.x.x.x.x.x.',
};

defineSong('boss_clockwork', {
  bpm: 160,
  meter: 3,
  steps: 4,
  master: 1.0,
  fadeIn: 0.25,
  combatFloor: 1,
  reverb: { seconds: 2.6, decay: 2.6, gain: 0.45, tone: 0.55 },
  delay: { beats: 1, feedback: 0.22, gain: 0.2, tone: 2400 },
  channels: {
    bass: { inst: sawBass({ gain: 0.19, cutoff: 600, drive: 2.5, env: 3 }), vol: 0.72 },
    harpsi: { inst: pluck({ wave: 'sawtooth', bright: 7, decay: 0.45, gain: 0.13, q: 1.4 }), vol: 0.75, reverb: 0.2, pan: -0.25 },
    strings: { inst: strings({ gain: 0.07, a: 0.005, r: 0.06, cutoff: 3200 }), vol: 0.7, reverb: 0.3, pan: 0.25 },
    organ: { inst: organ({ gain: 0.08, bright: 0.5, a: 0.1, r: 0.5 }), vol: 0.75, reverb: 0.45, pan: -0.1 },
    choir: { inst: choir({ gain: 0.1, vowel: 'o', a: 0.45, r: 1.1 }), vol: 0.8, reverb: 0.6 },
    box: { inst: bell({ ratio: 4.0, index: 1.6, decay: 1.5, gain: 0.17, partial: 2.76, partialGain: 0.16 }), vol: 0.8, reverb: 0.5, pan: 0.15 },
    lead: { inst: lead({ wave: 'pulse25', detune: 8, gain: 0.16, cutoff: 3200, vib: 14 }), vol: 0.78, reverb: 0.3, delay: 0.16 },
    counter: { inst: lead({ wave: 'pulse12', gain: 0.11, cutoff: 2200, vib: 8 }), vol: 0.6, reverb: 0.3, pan: 0.3 },
    pad: { inst: pad({ wave: 'sawtooth', voices: 2, detune: 11, gain: 0.05, cutoff: 1300, a: 0.1, r: 0.6 }), vol: 0.8, reverb: 0.35 },
    drums: { inst: clockKit, vol: 0.9, reverb: 0.12 },
  },
  sections: {
    I: {
      bars: 2,
      chords: 'Gm | Gm',
      parts: {
        drums: { drums: { rim: 'x...x...x...', boom: once(2, 'x', S), 'tom:G2': '.'.repeat(S) + '......x.x.xx' } },
        box: 'D5/4 G5/4 Bb5/4 | D6/12 |',
        bass: { bass: 'R-----------', oct: 2 },
        pad: { hold: true, center: 55 },
      },
    },
    A: {
      bars: 8,
      chords: 'Gm | Gm | Cm | D7 | Cm | Gm | Cm D7 | Gm',
      parts: {
        bass: { bass: 'R...5...5...', oct: 2 },
        harpsi: { chord: '....x...x...', center: 60 },
        pad: { hold: true, center: 55 },
        lead: LEAD_A,
        box: { notes: LEAD_A, transpose: 12, vel: 0.5 },
        drums: { drums: { ...WALTZ, crash: once(8, 'x', S) } },
      },
    },
    B: {
      bars: 8,
      chords: 'Gm | Cm | Eb | D7 | Gm | Eb | Gm | D7',
      parts: {
        bass: { bass: 'R.R.5.R.8.5.', oct: 2 },
        strings: { arp: '0.1.2.1.0.2.', oct: 4 },
        organ: { chord: '....x...x...', center: 57 },
        lead: LEAD_B,
        counter: COUNTER_B,
        drums: {
          drums: {
            boom: 'x.....x.....',
            rim: 'x...x...x...',
            hat: 'xgxgxgxgxgxg',
            crash: once(4, 'x', S),
          },
        },
      },
    },
    A2: {
      bars: 8,
      chords: 'Gm | Gm | Cm | D7 | Cm | Gm | Cm D7 | Gm',
      parts: {
        bass: { bass: 'R...5...5...', oct: 2 },
        harpsi: { chord: '....x...x...', center: 60 },
        strings: { arp: '0.2.1.2.0.1.', oct: 4, vel: 0.8 },
        choir: { hold: true, center: 60, vel: 0.6 },
        lead: LEAD_A2,
        box: { notes: LEAD_A2, transpose: 12, vel: 0.55 },
        drums: { drums: { ...WALTZ, crash: once(8, 'x', S), 'tom:G2': '.'.repeat(S * 7) + '......x.x.xx' } },
      },
    },
    C: {
      bars: 4,
      chords: 'Gm | Eb | Cm | D7',
      parts: {
        box: BOX_C,
        choir: { hold: true, center: 60 },
        organ: { hold: true, center: 53, vel: 0.6 },
        bass: { bass: 'R-----------', oct: 2 },
        drums: { drums: { rim: 'x...x...x...', boom: 'x...........', swell: lastBarHold(4, S) } },
      },
    },
  },
  intro: ['I'],
  order: ['A', 'B', 'A2', 'C'],
});
