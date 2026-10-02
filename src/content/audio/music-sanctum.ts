// Floor 4 — "얼어붙은 성소" (The Frozen Sanctum). F# minor, slow and sacred:
// glassy celesta arpeggios in a long hall, a choir, an organ pedal, cathedral
// bells and a solo flute. Ice chimes glitter at random. Combat: timpani,
// brushed hats and a pulsing sub.

import { defineSong } from '../../audio/song';
import { bell, choir, flute, kit, organ, subBass, wind } from '../../audio/instruments';
import { once } from './music-lib';

const drums = kit({ gain: 0.95 });

const MEL_A = 'C#5/8 F#5/8 | E5/6 D5/2 A4/8 | C#5/8 E5/4 A5/4 | G#5/12 ./4 | F#5/6 E5/2 D5/8 | A4/4 D5/4 F#5/8 | F#5/16 | E#5/8 C#5/8 |';
const MEL_B = 'A5/6 B5/2 A5/4 F#5/4 | G#5/6 A5/2 B5/8 | C#6/8 A5/4 F#5/4 | E5/16 | D6/6 C#6/2 B5/4 F#5/4 | G#5/6 F#5/2 E5/8 | F#5/4 A5/4 D6/4 C#6/4 | B5/8 G#5/4 E#5/4 |';

defineSong('floor4', {
  bpm: 72,
  master: 0.85,
  reverb: { seconds: 4.2, decay: 2.2, gain: 0.7, tone: 0.6 },
  delay: { beats: 0.75, feedback: 0.4, gain: 0.35, tone: 3200 },
  channels: {
    celesta: { inst: bell({ ratio: 7, index: 1.1, decay: 1.2, gain: 0.13 }), vol: 0.75, reverb: 0.55, delay: 0.35, pan: 0.2 },
    choir: { inst: choir({ gain: 0.1, vowel: 'a', a: 1.2, r: 2.2, bright: 0.8 }), vol: 0.8, reverb: 0.7 },
    organ: { inst: organ({ gain: 0.08, bright: 0.45, a: 0.6, r: 1.5 }), vol: 0.75, reverb: 0.5 },
    solo: { inst: flute({ gain: 0.22, vib: 16, breath: 0.2 }), vol: 0.8, reverb: 0.5, delay: 0.15 },
    bells: { inst: bell({ ratio: 2, index: 1.6, decay: 4, gain: 0.16, partial: 2.4, partialGain: 0.25 }), vol: 0.7, reverb: 0.75 },
    ice: { inst: bell({ ratio: 5.1, index: 0.8, decay: 0.8, gain: 0.1 }), vol: 0.7, reverb: 0.6, delay: 0.5, layer: 'calm' },
    sub: { inst: subBass({ gain: 0.3 }), vol: 0.8, layer: 'combat' },
    drums: { inst: drums, vol: 0.8, layer: 'combat', reverb: 0.35 },
    air: { inst: wind, vol: 0.55, reverb: 0.6, layer: 'calm' },
  },
  sections: {
    A: {
      bars: 8,
      chords: 'F#m | D | A | E | Bm | D | C#sus4 | C#',
      parts: {
        celesta: { arp: '0..2..1..3..2.1.', oct: 5 },
        choir: { hold: true, center: 61 },
        organ: { bass: 'R---------------', oct: 2, vel: 0.7 },
        solo: MEL_A,
        bells: 'F#3/16 | ./16 | ./16 | ./16 | B2/16 | ./16 | ./16 | C#3/16 |',
        sub: { bass: 'R--.R--.R-.R-.5-', oct: 2 },
        drums: {
          drums: {
            'timpani:F#2': 'x.......x.......',
            ohat: '..g...g...g...g.',
            kick: 'x.....x.x.......',
            shaker: 'g.g.g.g.g.g.g.g.',
          },
        },
      },
    },
    A2: {
      bars: 8,
      chords: 'F#m | D | A | E | Bm | D | C#sus4 | C#',
      parts: {
        celesta: [{ arp: '0.......2.......', oct: 4 }, { notes: MEL_A, transpose: 12, vel: 0.9 }],
        choir: { hold: true, center: 57 },
        organ: { hold: true, center: 54, vel: 0.6 },
        bells: 'F#3/16 | ./16 | ./16 | ./16 | B2/16 | ./16 | ./16 | C#3/16 |',
        sub: { bass: 'R--.R--.R-.R-.5-', oct: 2 },
        drums: {
          drums: {
            'timpani:F#2': 'x.......x.....x.',
            ohat: '..g...g...g...g.',
            kick: 'x.....x.x.......',
            shaker: 'gggggggggggggggg',
          },
        },
      },
    },
    B: {
      bars: 8,
      chords: 'D | E | F#m | A/E | Bm | C#m | D | C#7',
      parts: {
        celesta: { arp: '0.1.2.3.4.3.2.1.', oct: 5, vel: 0.85 },
        choir: { hold: true, center: 62 },
        organ: { bass: 'R-------R-------', oct: 2, vel: 0.7 },
        solo: MEL_B,
        bells: 'D3/16 | ./16 | ./16 | E3/16 | ./16 | ./16 | ./16 | C#3/16 |',
        sub: { bass: 'R-.R-.R-R-.R-.R-', oct: 2 },
        drums: {
          drums: {
            'timpani:D2': 'x.......x.....xx',
            ohat: '..x...x...x...x.',
            kick: 'x.....x.x.....x.',
            shaker: 'xgxgxgxgxgxgxgxg',
            crash: once(8),
          },
        },
      },
    },
  },
  order: ['A|A2', 'B'],
  onBar: (b) => {
    // ice chimes: F# minor pentatonic, high
    const n = b.rng.int(0, 2);
    for (let i = 0; i < n; i++) b.play('ice', 78 + [0, 3, 5, 7, 10][b.rng.int(0, 4)] + (b.rng.chance(0.3) ? 12 : 0), b.rng.int(0, 15), 1, 0.4 + b.rng.next() * 0.4);
    if (b.barInSection % 2 === 1 && b.rng.chance(0.4)) b.play('air', 78, 0, 16, 0.5);
  },
});
