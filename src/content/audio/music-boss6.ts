// Floor 6 boss theme — boss_drowned: "잠긴 서고의 종" (Bells of the Drowned Archive).
// D Phrygian at 132 BPM: a driving saw bass under a drowned organ, a staccato string
// ostinato, a detuned pulse lead and funeral bells heard through water; a choir
// breakdown with a rising swell before the loop. Shared by both floor-6 bosses.

import { defineSong } from '../../audio/song';
import { bell, choir, kit, lead, organ, pad, sawBass, strings } from '../../audio/instruments';
import { lastBarHold, once } from './music-lib';

const drownedKit = kit({ chip: true, gain: 1.05 });

const LEAD_A =
  'D5/4 F5/4 E5/4 D5/4 | C5/6 D5/2 A4/8 | D5/4 F5/4 G5/4 A5/4 | Bb5/6 A5/2 F5/8 | D5/4 Eb5/4 D5/4 C5/4 | A4/8 C5/8 | D5/4 F5/4 Eb5/4 D5/4 | C5/6 Bb4/2 A4/8 |';
const LEAD_B =
  'A5/6 Bb5/2 A5/4 G5/4 | F5/6 G5/2 A5/8 | G5/4 F5/4 Eb5/4 D5/4 | F5/8 E5/8 | A5/4 C6/4 Bb5/4 A5/4 | G5/6 F5/2 D5/8 | Eb5/4 F5/4 G5/4 A5/4 | D6/8 ./8 |';
const COUNTER_B =
  'D4/8 F4/8 | Bb3/8 D4/8 | G3/8 Bb3/8 | A3/8 C4/8 | D4/8 F4/8 | Bb3/8 D4/8 | G3/8 Bb3/8 | A3/16 |';

const DRIVE = {
  kick: 'x.....x...x.x...',
  snare: '....x.......x...',
  hat: 'x.x.x.x.x.x.x.x.',
  ohat: '..............x.',
};

defineSong('boss_drowned', {
  bpm: 132,
  master: 1.0,
  fadeIn: 0.25,
  combatFloor: 1,
  reverb: { seconds: 3.2, decay: 2.4, gain: 0.55, tone: 0.5 },
  delay: { beats: 0.75, feedback: 0.3, gain: 0.26, tone: 1800 },
  channels: {
    bass: { inst: sawBass({ gain: 0.19, cutoff: 520, drive: 3, env: 3 }), vol: 0.72 },
    strings: { inst: strings({ gain: 0.07, a: 0.005, r: 0.06, cutoff: 3000 }), vol: 0.7, reverb: 0.3, pan: 0.2 },
    organ: { inst: organ({ gain: 0.085, bright: 0.55, a: 0.12, r: 0.7 }), vol: 0.78, reverb: 0.5, pan: -0.15 },
    choir: { inst: choir({ gain: 0.1, vowel: 'u', a: 0.5, r: 1.2 }), vol: 0.8, reverb: 0.65 },
    bell: { inst: bell({ ratio: 1.41, index: 3, decay: 3, gain: 0.2, partial: 2.76, partialGain: 0.25 }), vol: 0.75, reverb: 0.65 },
    lead: { inst: lead({ wave: 'pulse25', detune: 9, gain: 0.16, cutoff: 3000, vib: 16 }), vol: 0.78, reverb: 0.3, delay: 0.18 },
    counter: { inst: lead({ wave: 'pulse12', gain: 0.11, cutoff: 2200, vib: 10 }), vol: 0.6, reverb: 0.3, pan: 0.3 },
    pad: { inst: pad({ wave: 'sawtooth', voices: 2, detune: 12, gain: 0.05, cutoff: 1200, a: 0.1, r: 0.6 }), vol: 0.8, reverb: 0.35 },
    drums: { inst: drownedKit, vol: 0.9, reverb: 0.14 },
  },
  sections: {
    I: {
      bars: 2,
      chords: 'Dm | Dm',
      parts: {
        drums: { drums: { boom: 'x.....x.x.....x.', crash: once(2), 'tom:D2': '.'.repeat(16) + '........x.x.xxxx' } },
        bell: 'D3/16 | D3/8 A2/8 |',
        bass: { bass: 'R---------------', oct: 2 },
        pad: { hold: true, center: 50 },
      },
    },
    A: {
      bars: 8,
      chords: 'Dm | Eb | Dm | C | Bb | C | Dm | Eb',
      parts: {
        bass: { bass: 'R-R-8-R-R-R-8-5-', oct: 2 },
        strings: { arp: '0102010201020102', oct: 4 },
        pad: { hold: true, center: 50 },
        bell: 'D3/32 | D3/32 | Bb2/32 | D3/32 |',
        lead: LEAD_A,
        drums: { drums: { ...DRIVE, crash: once(8) } },
      },
    },
    B: {
      bars: 8,
      chords: 'Gm | Dm | Eb | F | Gm | Dm | Bb | A7',
      parts: {
        bass: { bass: 'R-R-R-R-R-R-8-5-', oct: 2 },
        strings: { arp: '0121012101210121', oct: 4 },
        organ: { chord: 'x-----x-----x---', center: 57 },
        lead: LEAD_B,
        counter: COUNTER_B,
        bell: 'G2/32 | Eb3/32 | G2/32 | Bb2/16 A2/16 |',
        drums: {
          drums: {
            kick: 'x...x...x...x...',
            snare: '....x.......x..g',
            hat: 'xgxgxgxgxgxgxgxg',
            crash: once(4),
          },
        },
      },
    },
    C: {
      bars: 4,
      chords: 'Dm | Bb | Eb | A7',
      parts: {
        choir: { hold: true, center: 60 },
        organ: { hold: true, center: 53, vel: 0.7 },
        bell: 'D3/16 | Bb2/16 | Eb3/16 | A2/16 |',
        bass: { bass: 'R---------------', oct: 2 },
        strings: { arp: '0.1.2.1.0.1.2.1.', oct: 4, vel: 0.7 },
        drums: { drums: { boom: 'x.......x.......', snare: '........x.......', swell: lastBarHold(4) } },
      },
    },
  },
  intro: ['I'],
  order: ['A', 'B', 'C'],
});
