// Floor 1 — "잠든 납골당" (The Sleeping Ossuary). D minor with a Phrygian
// flat-two (Eb) for a funereal colour: low lute ostinato, organ drone, tolling
// bell and a lonely flute. Combat layer: taiko, toms, shaker and stepped bass.

import { defineSong } from '../../audio/song';
import { bell, choir, flute, kit, lead, organ, pluck, triBass, wind } from '../../audio/instruments';
import { once } from './music-lib';

const drums = kit({ gain: 1 });
const amb = kit({ gain: 0.8 });

const COMBAT_A = {
  drums: {
    drums: {
      boom: 'x.........x.....',
      'tom:A2': '......x.......x.',
      shaker: '..x...x...x...x.',
      rim: '....x.......x..g',
    },
  },
  bass: { bass: 'R-.R-.R-R-.R-.5-', oct: 2 },
};

defineSong('floor1', {
  bpm: 84,
  master: 0.93,
  eq: { high: 5 },
  reverb: { seconds: 3, decay: 2.6, gain: 0.6, tone: 0.35 },
  delay: { beats: 0.75, feedback: 0.3, gain: 0.3 },
  channels: {
    lute: { inst: pluck({ gain: 0.2, decay: 0.75, bright: 7 }), vol: 0.75, reverb: 0.35, pan: -0.15 },
    organ: { inst: organ({ gain: 0.09, bright: 0.55, a: 0.4, r: 1.2 }), vol: 0.8, reverb: 0.5 },
    choir: { inst: choir({ gain: 0.09, vowel: 'o', a: 1.0, r: 1.6 }), vol: 0.75, reverb: 0.6 },
    bell: { inst: bell({ ratio: 1.41, index: 2.5, decay: 3.2, gain: 0.18, partial: 2.76, partialGain: 0.2 }), vol: 0.75, reverb: 0.65 },
    flute: { inst: flute({ gain: 0.23 }), vol: 0.8, reverb: 0.4, delay: 0.15 },
    counter: { inst: lead({ wave: 'pulse12', gain: 0.11, cutoff: 1800, a: 0.04, vib: 10 }), vol: 0.6, reverb: 0.35, pan: 0.25 },
    bass: { inst: triBass({ gain: 0.3 }), vol: 0.6, layer: 'combat' },
    drums: { inst: drums, vol: 0.7, layer: 'combat', reverb: 0.18 },
    air: { inst: wind, vol: 0.5, reverb: 0.5, layer: 'calm' },
    amb: { inst: amb, vol: 0.5, reverb: 0.5, layer: 'calm' },
  },
  sections: {
    I: {
      bars: 2,
      chords: 'Dm | Eb/D',
      parts: {
        organ: { hold: true, center: 55, vel: 0.7 },
        bell: 'D3/16 | ./16 |',
        lute: { arp: '0...............', oct: 3 },
      },
    },
    A: {
      bars: 8,
      chords: 'Dm | Dm | Eb/D | Dm | Bb | Gm | Eb | A',
      parts: {
        lute: { arp: '0.1.2.1.3.1.2.1.', oct: 3 },
        organ: { hold: true, center: 55, vel: 0.7 },
        bell: 'D3/16 | ./16 | ./16 | ./16 | Bb2/16 | ./16 | ./16 | A2/16 |',
        flute: './8 A4/4 D5/4 | E5/6 F5/2 E5/8 | Eb5/8 D5/4 C5/4 | D5/16 | F5/6 G5/2 F5/4 D5/4 | Bb4/8 D5/4 G5/4 | G5/4 F5/4 Eb5/4 D5/4 | C#5/8 A4/8 |',
        ...COMBAT_A,
      },
    },
    A2: {
      bars: 8,
      chords: 'Dm | Dm | Eb/D | Dm | Bb | Gm | Eb | A',
      parts: {
        lute: { arp: '0.1.2.3.4.3.2.1.', oct: 3 },
        choir: { hold: true, center: 60 },
        organ: { hold: true, center: 48, vel: 0.5 },
        bell: 'D3/16 | ./16 | ./16 | ./16 | Bb2/16 | ./16 | ./16 | A2/16 |',
        flute: './4 D5/4 A4/4 D5/4 | F5/6 E5/2 D5/8 | Eb5/6 F5/2 G5/8 | F5/8 D5/8 | Bb5/6 A5/2 G5/4 F5/4 | G5/8 Bb4/4 D5/4 | Eb5/4 G5/4 Bb5/4 G5/4 | E5/8 C#5/8 |',
        ...COMBAT_A,
      },
    },
    B: {
      bars: 8,
      chords: 'Gm | Dm | Bb | A | Gm | Dm | Eb | A7',
      parts: {
        lute: { arp: '0.2.1.2.3.2.1.2.', oct: 3 },
        organ: { hold: true, center: 57, vel: 0.75 },
        bell: 'G2/16 | ./16 | ./16 | A2/16 | ./16 | ./16 | ./16 | A2/16 |',
        flute: 'G5/6 A5/2 Bb5/8 | A5/4 F5/4 D5/8 | F5/6 G5/2 F5/4 D5/4 | E5/16 | D5/4 G5/4 Bb5/4 D6/4 | C6/6 Bb5/2 A5/8 | G5/6 F5/2 Eb5/8 | C#5/6 E5/2 A5/8 |',
        drums: {
          drums: {
            boom: 'x.......x.......',
            'tom:D3': '....x.....x..x..',
            shaker: 'x.g.x.g.x.g.x.g.',
            rim: '....x.......x...',
            crash: once(8),
          },
        },
        bass: { bass: 'R-.R-.R-R-.R5-8-', oct: 2 },
      },
    },
    B2: {
      bars: 8,
      chords: 'Gm | Dm | Bb | A | Gm | Dm | Eb | A7',
      parts: {
        lute: { arp: '0.2.1.2.3.2.1.2.', oct: 3 },
        choir: { hold: true, center: 62 },
        bell: 'G2/16 | ./16 | ./16 | A2/16 | ./16 | ./16 | ./16 | A2/16 |',
        flute: 'G5/6 A5/2 Bb5/8 | A5/4 F5/4 D5/8 | F5/6 G5/2 F5/4 D5/4 | E5/16 | D5/4 G5/4 Bb5/4 D6/4 | C6/6 Bb5/2 A5/8 | G5/6 F5/2 Eb5/8 | C#5/6 E5/2 A5/8 |',
        counter: 'Bb4/16 | A4/16 | D5/16 | C#5/16 | Bb4/16 | A4/16 | G4/16 | E4/8 G4/8 |',
        drums: {
          drums: {
            boom: 'x.......x.....x.',
            'tom:D3': '....x.....x..x..',
            'tom:A2': '..............xx',
            shaker: 'xgxgxgxgxgxgxgxg',
            rim: '....x.......x...',
          },
        },
        bass: { bass: 'R-.R-.R-R-.R5-8-', oct: 2 },
      },
    },
  },
  intro: ['I'],
  order: ['A|A2', 'B|B2'],
  onBar: (b) => {
    if (b.rng.chance(0.3)) b.play('air', 0, b.rng.int(0, 8), 16, 0.5 + b.rng.next() * 0.4);
    if (b.rng.chance(0.15)) b.hit('amb', 'chain', b.rng.int(0, 15), 0.6);
  },
});
