// Floor 6 — "수몰된 서고" (The Drowned Archive). D minor, slow and submerged: a
// muffled harp arpeggio under a low-passed triangle lead that sings through water,
// soft underwater bells, a dark pad drone, dripping water and a slow pulse.
// Combat: half-time kick, deep toms, a dull rim like knocking on wood, a sub.

import { defineSong } from '../../audio/song';
import { bell, drip, kit, lead, pad, pluck, subBass, wind } from '../../audio/instruments';
import { lastBarHold, once, scaleNote } from './music-lib';

const drums = kit({ gain: 0.9, tune: 0.85 });
const amb = kit({ gain: 0.7 });

const LEAD_A = 'A4/8 F4/4 D4/4 | E4/12 F4/4 | G4/6 A4/2 F4/8 | E4/16 | D4/8 F4/4 A4/4 | Bb4/12 A4/4 | G4/6 F4/2 E4/8 | D4/8 ./8 |';
const LEAD_B = 'D5/8 C5/4 A4/4 | Bb4/12 A4/4 | G4/6 A4/2 Bb4/8 | C5/8 A4/8 | F4/8 G4/4 A4/4 | Bb4/6 C5/2 D5/8 | C#5/12 A4/4 | D5/16 |';

const COMBAT = {
  sub: { bass: 'R-------------5-', oct: 2 },
  drums: {
    drums: {
      kick: 'x.......x.......',
      'tom:D2': '....x.........x.',
      rim: '..g...g...g.g...',
      shaker: 'g.g.g.g.g.g.g.g.',
    },
  },
};

defineSong('floor6', {
  bpm: 68,
  master: 1.15,
  eq: { low: -2, high: 1 },
  reverb: { seconds: 5.2, decay: 1.9, gain: 0.78, tone: 0.3 },
  delay: { beats: 1, feedback: 0.5, gain: 0.45, tone: 1200 },
  channels: {
    harp: { inst: pluck({ wave: 'triangle', gain: 0.2, decay: 1.4, bright: 2.6, q: 0.9 }), vol: 0.95, reverb: 0.6, delay: 0.3, pan: -0.15 },
    voice: { inst: lead({ wave: 'triangle', gain: 0.3, cutoff: 820, vib: 18, vibRate: 3.6, vibDelay: 0.3, a: 0.12, r: 0.4 }), vol: 0.8, reverb: 0.6, delay: 0.25 },
    bells: { inst: bell({ ratio: 2, index: 1.1, decay: 3.6, gain: 0.14, partial: 1.5, partialGain: 0.2 }), vol: 0.7, reverb: 0.8, delay: 0.2, pan: 0.2 },
    drone: { inst: pad({ wave: 'sawtooth', voices: 3, detune: 12, gain: 0.07, cutoff: 480, q: 1.2, a: 1.8, r: 2.6, wobble: 160, wobbleRate: 0.07, sub: 0.25 }), vol: 0.9, reverb: 0.5 },
    pulse: { inst: subBass({ gain: 0.3, r: 0.3 }), vol: 0.5 },
    sub: { inst: subBass({ gain: 0.34, glide: 2 }), vol: 0.6, layer: 'combat' },
    drums: { inst: drums, vol: 0.62, layer: 'combat', reverb: 0.4 },
    drip: { inst: drip, vol: 0.85, reverb: 0.65, delay: 0.45, layer: 'calm' },
    water: { inst: wind, vol: 0.55, reverb: 0.5, layer: 'calm' },
    amb: { inst: amb, vol: 0.5, reverb: 0.6, delay: 0.3 },
  },
  sections: {
    A: {
      bars: 8,
      chords: 'Dm9 | Dm9 | Bbmaj7 | Gm7 | Dm/F | Bbmaj7 | Gm6 | A7sus4',
      parts: {
        harp: { arp: '0...2...1...3...', oct: 4 },
        drone: { hold: true, center: 50 },
        pulse: { bass: 'R-------........', oct: 2, vel: 0.8 },
        voice: LEAD_A,
        bells: 'D4/16 | ./16 | ./16 | ./16 | F4/16 | ./16 | ./16 | A3/16 |',
        ...COMBAT,
      },
    },
    A2: {
      bars: 8,
      chords: 'Dm9 | Dm9 | Bbmaj7 | Gm7 | Dm/F | Bbmaj7 | Gm6 | A7sus4',
      parts: {
        harp: { arp: '0.2.1.3.2.1.0.2.', oct: 4, vel: 0.85 },
        drone: { hold: true, center: 50 },
        pulse: { bass: 'R-------........', oct: 2, vel: 0.8 },
        voice: { notes: LEAD_A, transpose: 12, vel: 0.7 },
        bells: 'D4/16 | ./16 | A3/16 | ./16 | F4/16 | ./16 | ./16 | E4/16 |',
        ...COMBAT,
      },
    },
    B: {
      bars: 8,
      chords: 'Bbmaj7 | C | Dm | Dm/C | Gm7 | Ebmaj7 | Asus4 | A7',
      parts: {
        harp: { arp: '0.1.2.3.4.3.2.1.', oct: 4, vel: 0.9 },
        drone: { hold: true, center: 52, vel: 0.9 },
        pulse: { bass: 'R-------R-------', oct: 2, vel: 0.8 },
        voice: LEAD_B,
        bells: 'Bb3/16 | ./16 | ./16 | ./16 | G3/16 | ./16 | ./16 | A3/16 |',
        amb: { drums: { swell: lastBarHold(8) } },
        sub: { bass: 'R-------R-----5-', oct: 2 },
        drums: {
          drums: {
            kick: 'x.......x.....x.',
            'tom:D2': '....x.......x.x.',
            'tom:A1': '............x...',
            rim: '..g...g.g.g.g...',
            shaker: 'g.g.g.g.g.g.g.g.',
            crash: once(8),
          },
        },
      },
    },
  },
  order: ['A|A2', 'B'],
  onBar: (b) => {
    // water drips in D minor pentatonic, high and sparse
    const n = b.rng.int(0, 2);
    for (let i = 0; i < n; i++) b.play('drip', scaleNote(b, 86, [0, 3, 5, 7, 10], 2), b.rng.int(0, 15), 1, 0.45 + b.rng.next() * 0.45);
    // the slow murmur of water moving through the stacks
    if (b.barInSection % 2 === 0 && b.rng.chance(0.5)) b.play('water', 52, 0, 16, 0.5);
    if (b.barInSection === 7 && b.rng.chance(0.5)) b.hit('amb', 'swell', 0, 0.4, 0, 16);
  },
});
