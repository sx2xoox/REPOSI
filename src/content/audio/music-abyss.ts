// Floor 5 — "공허의 심연" (The Void Abyss). A B pedal under chords a tritone
// apart (Bm / F, C / F#), a slow heartbeat, smeared detuned drones, a thin
// pulse lead lost in echoes, whispers and reversed swells. Combat: half-time
// kick and huge snare, glitch percussion, distorted bass.

import { defineSong } from '../../audio/song';
import { bell, choir, kit, lead, pad, sawBass, subBass, whisper } from '../../audio/instruments';
import { lastBarHold, once } from './music-lib';

const drums = kit({ chip: true, gain: 1 });
const amb = kit({ gain: 0.8 });

const LEAD_A = 'B4/4 ./4 F#5/8 | G5/6 F#5/2 E5/8 | D5/4 C#5/4 B4/8 | C5/8 A4/8 | B4/6 D5/2 G5/8 | Bb4/6 D5/2 F#5/8 | A#4/8 C#5/8 | E5/16 |';
const LEAD_B = 'E5/2 F5/2 G5/2 G#5/2 A#5/4 B5/4 | A5/8 C6/8 | B5/6 A5/2 F#5/8 | G5/4 E5/4 C5/8 | E5/4 G5/4 B5/4 D6/4 | Bb5/8 G5/8 | A#5/8 F#5/8 | C6/8 ./8 |';

const COMBAT = {
  bass: { bass: 'R-----.RR-----5-', oct: 2 },
  drums: {
    drums: {
      kick: 'x.......x.x.....',
      snare: '........X.......',
      glitch: '?.?..?.??..?.?.?',
      hat: 'x.x.x.x.x.x.x.x.',
    },
  },
};

defineSong('floor5', {
  bpm: 100,
  master: 1.15,
  reverb: { seconds: 4.5, decay: 1.8, gain: 0.7, tone: 0.3 },
  delay: { beats: 0.75, feedback: 0.55, gain: 0.5, tone: 1600 },
  channels: {
    drone: { inst: pad({ wave: 'sawtooth', voices: 3, detune: 22, gain: 0.07, cutoff: 650, q: 1.5, a: 1.6, r: 2.5, wobble: 350, wobbleRate: 0.09 }), vol: 0.85, reverb: 0.55 },
    choir: { inst: choir({ gain: 0.08, vowel: 'u', a: 1.5, r: 2.5 }), vol: 0.75, reverb: 0.7 },
    lead: { inst: lead({ wave: 'pulse12', gain: 0.16, cutoff: 1900, vib: 30, vibRate: 3.3, a: 0.02 }), vol: 0.7, reverb: 0.4, delay: 0.5, pan: -0.2 },
    bell: { inst: bell({ ratio: 1.41, index: 3, decay: 3.5, gain: 0.17, partial: 2.92, partialGain: 0.3 }), vol: 0.7, reverb: 0.75, delay: 0.2 },
    heart: { inst: subBass({ gain: 0.34, glide: 3, r: 0.1 }), vol: 0.6 },
    bass: { inst: sawBass({ gain: 0.17, cutoff: 330, drive: 4, env: 4, q: 4 }), vol: 0.8, layer: 'combat' },
    drums: { inst: drums, vol: 0.72, layer: 'combat', reverb: 0.3 },
    amb: { inst: amb, vol: 0.55, reverb: 0.6, delay: 0.3 },
    whisper: { inst: whisper, vol: 0.7, reverb: 0.6, delay: 0.3, layer: 'calm' },
  },
  sections: {
    A: {
      bars: 8,
      chords: 'Bm | C/B | Bm | F/B | G | Gm | F# | F#7',
      parts: {
        drone: { hold: true, center: 50 },
        heart: { bass: 'R..R............', oct: 2 },
        lead: LEAD_A,
        bell: 'B3/16 | ./16 | ./16 | F3/16 | ./16 | ./16 | ./16 | C4/16 |',
        ...COMBAT,
      },
    },
    A2: {
      bars: 8,
      chords: 'Bm | C/B | Bm | F/B | G | Gm | F# | F#7',
      parts: {
        drone: { hold: true, center: 50 },
        choir: { hold: true, center: 62 },
        heart: { bass: 'R..R............', oct: 2 },
        lead: { notes: LEAD_A, transpose: 12, vel: 0.65 },
        bell: 'B3/16 | ./16 | ./16 | F3/16 | ./16 | ./16 | ./16 | C4/16 |',
        ...COMBAT,
      },
    },
    B: {
      bars: 8,
      chords: 'Em | F | Bm | C | Em | Eb | F# | F#',
      parts: {
        drone: { hold: true, center: 52 },
        choir: { hold: true, center: 64, vel: 0.8 },
        heart: { bass: 'R..R....R..R....', oct: 2 },
        lead: LEAD_B,
        bass: { bass: 'R-.R-.R-R-.R-.b-', oct: 2 },
        drums: {
          drums: {
            kick: 'x.......x.x...x.',
            snare: '........X.......',
            glitch: '?.?.?.?.??.?.???',
            hat: 'xgxgxgxgxgxgxgxg',
            crash: once(8),
            'tom:F#2': '.'.repeat(112) + '..........x.x.xx',
          },
        },
      },
    },
    C: {
      bars: 8,
      chords: 'Bm | Bm | C/B | C/B | Bm | Bm | F/B | F#',
      parts: {
        drone: { hold: true, center: 47 },
        choir: { hold: true, center: 59, vel: 0.9 },
        heart: { bass: 'R..R............', oct: 2 },
        bell: 'B2/16 | ./16 | C4/16 | ./16 | F#3/16 | ./16 | F4/16 | ./16 |',
        amb: { drums: { swell: lastBarHold(8) } },
        bass: { bass: 'R---------------', oct: 2 },
        drums: {
          drums: {
            'tom:B1': 'x.........x.....',
            'tom:F#2': '......x.......x.',
            glitch: '....?.......?...',
          },
        },
      },
    },
  },
  order: ['A|A2', 'B', 'C'],
  onBar: (b) => {
    if (b.rng.chance(0.35)) b.play('whisper', 60 + b.rng.int(0, 24), b.rng.int(0, 8), 12, 0.6 + b.rng.next() * 0.4);
    if (b.rng.chance(0.2)) b.hit('amb', 'glitch', b.rng.int(0, 15), 0.6);
    if (b.barInSection === 3 && b.rng.chance(0.5)) b.hit('amb', 'swell', 0, 0.45, 0, 16);
  },
});
