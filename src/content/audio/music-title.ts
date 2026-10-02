// Title theme — "등불지기의 노래" (The Lanternkeeper's Song).
// D minor waltz: a music-box ostinato and a breathy flute carry a melancholic
// lantern motif (D-E-F ... A); a low gong-like "lantern" bell marks phrases.

import { defineSong } from '../../audio/song';
import { bell, choir, flute, lead, pad, triBass, wind } from '../../audio/instruments';
import { scaleNote } from './music-lib';

defineSong('title', {
  bpm: 80,
  meter: 3,
  master: 0.9,
  fadeIn: 1.5,
  reverb: { seconds: 3.4, decay: 2.5, gain: 0.65 },
  delay: { beats: 1.5, feedback: 0.32, gain: 0.32, tone: 2000 },
  channels: {
    box: { inst: bell({ ratio: 4, index: 1.5, decay: 1.3, gain: 0.15 }), vol: 0.8, reverb: 0.45, delay: 0.25, pan: 0.18 },
    lantern: { inst: bell({ ratio: 1.41, index: 2.4, decay: 3.4, gain: 0.2, partial: 2.76, partialGain: 0.18 }), vol: 0.75, reverb: 0.7 },
    melody: { inst: flute({ gain: 0.24 }), vol: 0.85, reverb: 0.4, delay: 0.16 },
    counter: { inst: lead({ wave: 'pulse12', gain: 0.12, cutoff: 2000, vib: 10, a: 0.05 }), vol: 0.55, reverb: 0.45, pan: -0.25 },
    pad: { inst: pad({ gain: 0.055, cutoff: 950, a: 1.2, r: 2, wobble: 220, wobbleRate: 0.18 }), vol: 0.9, reverb: 0.6 },
    choir: { inst: choir({ gain: 0.1, vowel: 'o', a: 1.3, r: 2 }), vol: 0.7, reverb: 0.7 },
    bass: { inst: triBass({ gain: 0.26 }), vol: 0.75 },
    air: { inst: wind, vol: 0.55, reverb: 0.5 },
  },
  sections: {
    I: {
      bars: 2,
      chords: 'Dm | Bbmaj7',
      parts: {
        box: { arp: '0.1.2.3.2.1.', oct: 5 },
        pad: { hold: true, center: 57 },
        lantern: 'D3/12 | ./12 |',
      },
    },
    A: {
      bars: 8,
      chords: 'Dm | Bbmaj7 | Gm7 | A7sus4 A7 | Dm | F/C | Bbmaj7 | A',
      parts: {
        box: { arp: '0.1.2.3.2.1.', oct: 5 },
        pad: { hold: true, center: 57 },
        bass: { bass: 'R-----5-----', oct: 2 },
        lantern: 'D3/12 | ./12 | ./12 | ./12 | D3/12 | ./12 | ./12 | A2/12 |',
        melody: 'D5/6 E5/2 F5/4 | A5/8 G5/2 F5/2 | F5/6 E5/2 D5/4 | E5/12 | D5/6 E5/2 F5/4 | A5/6 C6/2 A5/4 | G5/4 F5/4 D5/4 | E5/6 F5/2 E5/2 C#5/2 |',
      },
    },
    A2: {
      bars: 8,
      chords: 'Dm | Bbmaj7 | Gm7 | A7sus4 A7 | Dm | F/C | Bbmaj7 C | Dm',
      parts: {
        box: { arp: '0.2.1.3.2.1.', oct: 5 },
        choir: { hold: true, center: 60 },
        pad: { hold: true, center: 52, vel: 0.6 },
        bass: { bass: 'R---5---8---', oct: 2 },
        lantern: 'D3/12 | ./12 | ./12 | ./12 | D3/12 | ./12 | ./12 | D3/12 |',
        melody: 'D5/6 E5/2 F5/4 | A5/8 G5/2 F5/2 | F5/6 E5/2 D5/4 | E5/12 | D5/6 E5/2 F5/4 | A5/6 C6/2 D6/4 | C6/4 A5/4 F5/4 | D5/12 |',
        counter: 'A4/12 | D5/12 | Bb4/12 | C#5/12 | F4/12 | F4/12 | D5/6 E5/6 | A4/12 |',
      },
    },
    B: {
      bars: 8,
      chords: 'Bb | C | Am | Dm | Gm | C | F | A7',
      parts: {
        box: { arp: '0.1.2.1.3.1.', oct: 5, vel: 0.85 },
        choir: { hold: true, center: 62, vel: 0.9 },
        bass: { bass: 'R---5---8---', oct: 2 },
        lantern: 'Bb2/12 | ./12 | ./12 | D3/12 | ./12 | ./12 | ./12 | A2/12 |',
        melody: 'D5/4 F5/4 Bb5/4 | A5/6 G5/2 E5/4 | C6/6 B5/2 A5/4 | A5/12 | Bb5/4 A5/4 G5/4 | G5/6 F5/2 E5/4 | F5/4 A5/4 C6/4 | A5/6 G5/2 E5/2 C#5/2 |',
        counter: 'F4/12 | E4/12 | E4/12 | F4/12 | D4/12 | C4/12 | C5/12 | C#5/12 |',
      },
    },
  },
  intro: ['I'],
  order: ['A', 'A2', 'B'],
  onBar: (b) => {
    // a distant gust now and then, and stray music-box sparkles
    if (b.barInSection % 4 === 0 && b.rng.chance(0.5)) b.play('air', 0, 0, 12, 0.6);
    if (b.rng.chance(0.25)) b.play('box', scaleNote(b, 86, [0, 3, 7, 10], 1), 10, 2, 0.35);
  },
});
