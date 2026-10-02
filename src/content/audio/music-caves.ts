// Floor 2 — "포자 동굴" (The Spore Hollows). E minor with added ninths:
// echoing pulse plucks like glowing spores, a low reedy pulse melody, a
// wobbling glass lead and random water drips. Combat: soft kick, claps,
// shaker and a squelchy filtered bass.

import { defineSong } from '../../audio/song';
import { drip, kit, lead, pad, pluck, sawBass, subBass } from '../../audio/instruments';
import { lastBarHold, scaleNote } from './music-lib';

const drums = kit({ gain: 0.95 });
const amb = kit({ gain: 0.8 });

const DRUMS = {
  drums: {
    drums: {
      kick: 'x.....x...x.....',
      clap: '....x.......x...',
      shaker: 'xgxgxgxgxgxgxgxg',
      hat: '..x...x...x...x?',
    },
  },
};

defineSong('floor2', {
  bpm: 96,
  master: 1.0,
  eq: { high: 4.5 },
  reverb: { seconds: 3.2, decay: 2.2, gain: 0.65, tone: 0.55 },
  delay: { beats: 0.75, feedback: 0.45, gain: 0.5, tone: 2200 },
  channels: {
    spores: { inst: pluck({ wave: 'pulse25', gain: 0.15, decay: 0.5, bright: 6 }), vol: 0.75, delay: 0.55, reverb: 0.3, pan: 0.2 },
    reed: { inst: lead({ wave: 'pulse12', gain: 0.2, cutoff: 1300, a: 0.03, vib: 12, vibRate: 4.5 }), vol: 0.75, reverb: 0.35, delay: 0.15 },
    glass: { inst: lead({ wave: 'triangle', gain: 0.3, cutoff: 6000, vib: 28, vibRate: 3.8, vibDelay: 0.12, scoop: 1.5, a: 0.02 }), vol: 0.75, reverb: 0.45, delay: 0.3, pan: -0.15 },
    pad: { inst: pad({ wave: 'triangle', voices: 2, detune: 14, gain: 0.08, cutoff: 1800, a: 1.2, r: 1.8, wobble: 500, wobbleRate: 0.15 }), vol: 0.8, reverb: 0.55 },
    sub: { inst: subBass({ gain: 0.3 }), vol: 0.45 },
    bass: { inst: sawBass({ gain: 0.17, cutoff: 380, env: 3, drive: 1.6, q: 6 }), vol: 0.8, layer: 'combat' },
    drums: { inst: drums, vol: 0.8, layer: 'combat', reverb: 0.15 },
    drip: { inst: drip, vol: 0.9, reverb: 0.5, delay: 0.4, layer: 'calm' },
    amb: { inst: amb, vol: 0.5, reverb: 0.5, layer: 'calm' },
  },
  sections: {
    A: {
      bars: 8,
      chords: 'Em9 | Cmaj7 | Am9 | Bsus4 B',
      parts: {
        spores: { arp: '0.2.4.1.3.2.4.1.', oct: 4 },
        pad: { hold: true, center: 55 },
        sub: { bass: 'R-------------5-', oct: 2 },
        reed: 'E4/6 F#4/2 G4/8 | B4/8 G4/8 | A4/6 B4/2 C5/4 E5/4 | E5/8 D#5/8 | G4/6 A4/2 B4/8 | E5/8 B4/8 | C5/4 B4/4 A4/4 E4/4 | F#4/8 D#4/8 |',
        bass: { bass: 'R.R...R.5.R...8.', oct: 2 },
        ...DRUMS,
      },
    },
    A2: {
      bars: 8,
      chords: 'Em9 | Cmaj7 | Am9 | Bsus4 B',
      parts: {
        spores: { arp: '0.3.1.4.2.3.1.4.', oct: 4 },
        pad: { hold: true, center: 55 },
        sub: { bass: 'R-------------5-', oct: 2 },
        reed: { notes: 'E4/6 F#4/2 G4/8 | B4/8 G4/8 | A4/6 B4/2 C5/4 E5/4 | E5/8 D#5/8 | G4/6 A4/2 B4/8 | E5/8 B4/8 | C5/4 B4/4 A4/4 E4/4 | F#4/8 D#4/8 |', transpose: 12, vel: 0.8 },
        glass: './16 | ./16 | ./16 | ./16 | B4/16 | G4/16 | A4/8 E4/8 | F#4/8 B3/8 |',
        bass: { bass: 'R.R...R.5.R...8.', oct: 2 },
        ...DRUMS,
      },
    },
    B: {
      bars: 8,
      chords: 'Cmaj7 | D | Em | Em/D | Cmaj7 | Am7 | F#m7b5 | B7',
      parts: {
        spores: { arp: '0..1..2..3..2.1.', oct: 4 },
        pad: { hold: true, center: 57 },
        sub: { bass: 'R-------R-------', oct: 2 },
        glass: 'B4/4 E5/4 G5/4 B5/4 | A5/12 F#5/4 | G5/6 F#5/2 E5/8 | ./4 B4/4 D5/4 E5/4 | G5/6 A5/2 B5/8 | C6/4 B5/4 A5/4 E5/4 | A5/6 G5/2 F#5/4 E5/4 | D#5/16 |',
        bass: { bass: 'R.R.R...5.R.R.8.', oct: 2 },
        drums: {
          drums: {
            kick: 'x.....x...x...x.',
            clap: '....x.......x...',
            shaker: 'xgxgxgxgxgxgxgxg',
            ohat: '..x...x...x...x.',
            swell: lastBarHold(8),
          },
        },
      },
    },
    B2: {
      bars: 8,
      chords: 'Cmaj7 | D | Em | Em/D | Cmaj7 | Am7 | F#m7b5 | B7',
      parts: {
        spores: { arp: '0.1.2.3.4.3.2.1.', oct: 4 },
        pad: { hold: true, center: 57 },
        sub: { bass: 'R-------R-------', oct: 2 },
        glass: { notes: 'B4/4 E5/4 G5/4 B5/4 | A5/12 F#5/4 | G5/6 F#5/2 E5/8 | ./4 B4/4 D5/4 E5/4 | G5/6 A5/2 B5/8 | C6/4 B5/4 A5/4 E5/4 | A5/6 G5/2 F#5/4 E5/4 | D#5/16 |', transpose: -12 },
        reed: 'G4/16 | F#4/16 | G4/16 | B4/16 | E4/16 | E4/16 | C5/16 | B4/16 |',
        bass: { bass: 'R.R.R...5.R.R.8.', oct: 2 },
        ...DRUMS,
      },
    },
  },
  order: ['A|A2', 'B|B2'],
  onBar: (b) => {
    // drips in E minor pentatonic, never two in a row on the same step
    const n = b.rng.int(0, 3);
    for (let i = 0; i < n; i++) b.play('drip', scaleNote(b, 88, [0, 3, 5, 7, 10], 2), b.rng.int(0, 15), 1, 0.5 + b.rng.next() * 0.5);
    if (b.barInSection === 3 && b.rng.chance(0.4)) b.hit('amb', 'swell', 0, 0.5, 0, 16);
  },
});
