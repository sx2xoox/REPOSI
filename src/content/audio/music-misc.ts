// Non-floor tracks:
// - shop: "등잔 아래 상점" (The Lamplit Shop) — cozy swung F major jazz-folk.
// - secret: "숨겨진 방" (The Hidden Room) — Ab Lydian music box and glass.
// - victory: brass fanfare, then a calm, grateful loop in C major.
// - gameover: a short sad sting (does not loop).

import { defineSong } from '../../audio/song';
import { bell, brass, choir, flute, kit, lead, pad, pluck, subBass, triBass, whisper } from '../../audio/instruments';
import { lastBarHold, once, PENTA_MAJOR, scaleNote } from './music-lib';

// --- shop -------------------------------------------------------------------

const SHOP_A = 'A4/2 C5/2 F5/4 E5/4 C5/4 | D5/6 F5/2 A5/8 | G5/4 F5/2 D5/2 Bb4/8 | C5/6 E5/2 G5/4 Bb5/4 | A5/6 G5/2 F5/4 C5/4 | E5/4 C5/4 F#5/4 A5/4 | G5/4 Bb5/4 A5/4 G5/4 | G5/4 E5/4 C5/8 |';
const SHOP_B = 'D5/4 F5/4 A5/8 | G5/4 E5/4 C5/8 | Bb4/4 D5/4 F5/6 E5/2 | E5/4 C5/4 A4/8 | F5/4 A5/4 D6/6 C6/2 | C#6/6 A5/2 E5/8 | F5/4 A5/4 B5/4 G5/4 | Bb5/4 A5/4 G5/4 E5/4 |';
const SHOP_A_CHORDS = 'Fmaj7 | Dm7 | Gm7 | C7 | Fmaj7 | Am7 D7 | Gm7 | C7';
const SHOP_B_CHORDS = 'Bbmaj7 | Am7 | Gm7 | Fmaj7 | Bbmaj7 | A7 | Dm7 G7 | Gm7 C7';

const shopKit = kit({ gain: 0.75 });

defineSong('shop', {
  bpm: 104,
  swing8: 0.33,
  master: 0.95,
  eq: { high: 4 },
  reverb: { seconds: 1.8, decay: 3, gain: 0.45, tone: 0.5 },
  delay: { beats: 0.75, feedback: 0.25, gain: 0.25 },
  channels: {
    lute: { inst: pluck({ gain: 0.13, decay: 0.45, bright: 7 }), vol: 0.75, reverb: 0.25, pan: -0.2 },
    bass: { inst: triBass({ gain: 0.28 }), vol: 0.62 },
    melody: { inst: flute({ gain: 0.22, vib: 14 }), vol: 0.8, reverb: 0.3, delay: 0.1 },
    box: { inst: bell({ ratio: 3.5, index: 1.4, decay: 1.1, gain: 0.12 }), vol: 0.7, reverb: 0.35, delay: 0.2, pan: 0.25 },
    pad: { inst: pad({ gain: 0.04, cutoff: 1000, a: 0.3, r: 0.8 }), vol: 0.8, reverb: 0.4 },
    drums: { inst: shopKit, vol: 0.75, reverb: 0.1 },
  },
  sections: {
    A: {
      bars: 8,
      chords: SHOP_A_CHORDS,
      parts: {
        lute: { chord: '..x...x-..x...x.', center: 60, maxTones: 4 },
        bass: { bass: 'R---3---5---3---', oct: 2 },
        melody: SHOP_A,
        pad: { hold: true, center: 55, vel: 0.6 },
        drums: { drums: { shaker: 'x.g.x.g.x.g.x.g.', rim: '....x.......x...', kick: 'x.......x.......' } },
      },
    },
    A2: {
      bars: 8,
      chords: SHOP_A_CHORDS,
      parts: {
        lute: { arp: '0.1.2.3.2.1.0.1.', oct: 3 },
        bass: { bass: 'R---3---5---3---', oct: 2 },
        box: { notes: SHOP_A, transpose: 12, vel: 0.8 },
        pad: { hold: true, center: 55, vel: 0.7 },
        drums: { drums: { shaker: 'x.g.x.g.x.g.x.g.', rim: '....x.......x...', kick: 'x.......x.......' } },
      },
    },
    B: {
      bars: 8,
      chords: SHOP_B_CHORDS,
      parts: {
        lute: { chord: '..x...x-..x...x.', center: 60, maxTones: 4 },
        bass: { bass: 'R---5---8---5---', oct: 2 },
        melody: SHOP_B,
        pad: { hold: true, center: 57, vel: 0.6 },
        drums: { drums: { shaker: 'x.g.x.g.x.g.x.g.', rim: '....x.......x..g', kick: 'x.......x.....g.' } },
      },
    },
  },
  order: ['A', 'B', 'A2', 'B'],
  onBar: (b) => {
    // coin-glint sparkles on the music box
    if (b.rng.chance(0.35)) b.play('box', scaleNote(b, 89, PENTA_MAJOR, 1), b.rng.pick([3, 7, 11, 15]), 1, 0.35);
  },
});

// --- secret -----------------------------------------------------------------

const SECRET_MEL = 'C6/6 Eb6/2 G5/8 | D6/8 F5/8 | Eb6/6 D6/2 Bb5/8 | F5/16 | Ab5/4 G5/4 C6/8 | F5/6 C6/2 Ab5/8 | Bb5/8 Ab5/8 | G5/16 |';

const secretKit = kit({ gain: 0.8 });

defineSong('secret', {
  bpm: 72,
  master: 1.25,
  fadeIn: 1,
  reverb: { seconds: 4.5, decay: 2, gain: 0.75, tone: 0.6 },
  delay: { beats: 0.75, feedback: 0.5, gain: 0.45, tone: 2800 },
  channels: {
    box: { inst: bell({ ratio: 5, index: 1.1, decay: 1.5, gain: 0.12 }), vol: 0.7, reverb: 0.5, delay: 0.45, pan: 0.2 },
    glass: { inst: bell({ ratio: 7, index: 0.9, decay: 2, gain: 0.15 }), vol: 0.75, reverb: 0.6, delay: 0.3, pan: -0.15 },
    flute: { inst: flute({ gain: 0.2, vib: 20, breath: 0.22 }), vol: 0.75, reverb: 0.55, delay: 0.25 },
    choir: { inst: choir({ gain: 0.09, vowel: 'o', a: 1.5, r: 2.2 }), vol: 0.75, reverb: 0.7 },
    sub: { inst: subBass({ gain: 0.26 }), vol: 0.5 },
    whisper: { inst: whisper, vol: 0.6, reverb: 0.6, delay: 0.3 },
    amb: { inst: secretKit, vol: 0.5, reverb: 0.6 },
  },
  sections: {
    A: {
      bars: 8,
      chords: 'Abmaj7 | Bb/Ab | Cm7 | Bb | Fm9 | Dbmaj7 | Ebsus4 | Eb',
      parts: {
        box: { arp: '0.1.2.3.1.2.3.4.', oct: 5 },
        glass: { notes: SECRET_MEL, transpose: -12 },
        choir: { hold: true, center: 60 },
        sub: { bass: 'R---------------', oct: 2 },
      },
    },
    A2: {
      bars: 8,
      chords: 'Abmaj7 | Bb/Ab | Cm7 | Bb | Fm9 | Dbmaj7 | Ebsus4 | Eb',
      parts: {
        box: { arp: '0.3.1.4.2.3.1.2.', oct: 5 },
        flute: { notes: SECRET_MEL, transpose: -12 },
        choir: { hold: true, center: 56 },
        sub: { bass: 'R-------R-------', oct: 2 },
        amb: { drums: { swell: lastBarHold(8) } },
      },
    },
  },
  order: ['A', 'A2'],
  onBar: (b) => {
    if (b.rng.chance(0.3)) b.play('whisper', 70 + b.rng.int(0, 12), b.rng.int(0, 6), 14, 0.5);
  },
});

// --- victory ----------------------------------------------------------------

const vicKit = kit({ gain: 0.9 });

defineSong('victory', {
  bpm: 112,
  master: 1.0,
  fadeIn: 0.1,
  reverb: { seconds: 2.6, decay: 2.6, gain: 0.55 },
  delay: { beats: 0.75, feedback: 0.25, gain: 0.25 },
  channels: {
    brass: { inst: brass({ gain: 0.17, cutoff: 2800 }), vol: 0.8, reverb: 0.35 },
    brass2: { inst: brass({ gain: 0.13, cutoff: 2200 }), vol: 0.7, reverb: 0.35, pan: -0.2 },
    fanfare: { inst: lead({ wave: 'pulse25', gain: 0.1, cutoff: 3500, vib: 14 }), vol: 0.6, reverb: 0.3, pan: 0.2 },
    flute: { inst: flute({ gain: 0.22 }), vol: 0.8, reverb: 0.4, delay: 0.15 },
    box: { inst: bell({ ratio: 3.5, index: 1.4, decay: 1.4, gain: 0.12 }), vol: 0.7, reverb: 0.45, delay: 0.2, pan: 0.2 },
    pad: { inst: pad({ gain: 0.05, cutoff: 1200, a: 0.8, r: 1.6 }), vol: 0.8, reverb: 0.5 },
    choir: { inst: choir({ gain: 0.09, vowel: 'a', a: 0.6, r: 1.6 }), vol: 0.75, reverb: 0.6 },
    bass: { inst: triBass({ gain: 0.26 }), vol: 0.6 },
    drums: { inst: vicKit, vol: 0.85, reverb: 0.25 },
  },
  sections: {
    F: {
      bars: 4,
      chords: 'C | F G | C | C',
      parts: {
        brass: 'G4/2 G4/2 G4/2 C5/10 | A4/4 C5/4 B4/4 D5/4 | E5/6 D5/2 E5/4 G5/4 | C6/16 |',
        brass2: 'E4/2 E4/2 E4/2 G4/10 | F4/4 A4/4 G4/4 B4/4 | C5/6 B4/2 C5/4 E5/4 | G5/16 |',
        fanfare: 'G5/2 G5/2 G5/2 C6/10 | A5/4 C6/4 B5/4 D6/4 | E6/6 D6/2 E6/4 G6/4 | C6/16 |',
        choir: { hold: true, center: 60 },
        bass: { bass: 'R-------R-------', oct: 2 },
        drums: {
          drums: {
            'timpani:C2': 'x.x.x.X.........' + 'x...............' + 'x...x...x.x.xxxx' + 'X...............',
            'timpani:G2': '................' + '........x.......' + '................' + '................',
            crash: once(1) + '.'.repeat(32) + 'x' + '.'.repeat(15),
          },
        },
      },
    },
    L: {
      bars: 8,
      chords: 'C | Am | F | G | C | Em | F | G',
      parts: {
        flute: 'E5/8 G5/8 | A5/6 G5/2 E5/8 | F5/4 A5/4 C6/8 | B5/8 G5/8 | C6/6 B5/2 G5/8 | G5/4 E5/4 B4/8 | C5/4 F5/4 A5/4 C6/4 | D6/8 B5/8 |',
        box: { arp: '0..1..2.3..2..1.', oct: 5, vel: 0.8 },
        pad: { hold: true, center: 57 },
        bass: { bass: 'R---5---R---5---', oct: 2 },
        drums: { drums: { shaker: 'x.g.x.g.x.g.x.g.', kick: 'x.......x.......' } },
      },
    },
    L2: {
      bars: 8,
      chords: 'C | Am | F | G | C | Em | F | Gsus4 G',
      parts: {
        flute: 'G5/4 E5/4 C5/8 | C5/6 E5/2 A5/8 | A5/4 F5/4 C5/8 | D5/8 G5/8 | E5/6 F5/2 G5/8 | B5/4 G5/4 E5/8 | F5/4 A5/4 C6/4 A5/4 | G5/16 |',
        box: { notes: 'E5/8 G5/8 | A5/6 G5/2 E5/8 | F5/4 A5/4 C6/8 | B5/8 G5/8 | C6/6 B5/2 G5/8 | G5/4 E5/4 B4/8 | C5/4 F5/4 A5/4 C6/4 | D6/8 B5/8 |', vel: 0.7 },
        choir: { hold: true, center: 60, vel: 0.8 },
        bass: { bass: 'R---5---R---5---', oct: 2 },
        drums: { drums: { shaker: 'x.g.x.g.x.g.x.g.', kick: 'x.......x.......' } },
      },
    },
  },
  intro: ['F'],
  order: ['L', 'L2'],
});

// --- gameover ---------------------------------------------------------------

defineSong('gameover', {
  bpm: 88,
  master: 1.15,
  fadeIn: 0.05,
  loop: false,
  reverb: { seconds: 3.5, decay: 2.2, gain: 0.7 },
  delay: { beats: 1, feedback: 0.3, gain: 0.3 },
  channels: {
    melody: { inst: lead({ wave: 'pulse25', gain: 0.17, cutoff: 2000, vib: 14, a: 0.02, r: 0.4 }), vol: 0.8, reverb: 0.5, delay: 0.2 },
    bell: { inst: bell({ ratio: 1.41, index: 2.5, decay: 4, gain: 0.2, partial: 2.76, partialGain: 0.2 }), vol: 0.75, reverb: 0.7 },
    pad: { inst: pad({ gain: 0.06, cutoff: 900, a: 0.4, r: 2.5 }), vol: 0.8, reverb: 0.6 },
    choir: { inst: choir({ gain: 0.08, vowel: 'o', a: 0.8, r: 2.5 }), vol: 0.7, reverb: 0.7 },
    bass: { inst: triBass({ gain: 0.26, r: 0.8 }), vol: 0.55 },
  },
  sections: {
    S: {
      bars: 3,
      chords: 'Dm | Gm A | Dm',
      parts: {
        melody: 'A5/4 G5/2 F5/2 E5/4 D5/4 | Bb4/8 C#5/8 | D5/16 |',
        bell: 'D4/16 | ./16 | D3/16 |',
        pad: { hold: true, center: 57 },
        choir: { hold: true, center: 62, vel: 0.7 },
        bass: { bass: 'R---------------', oct: 2 },
      },
    },
  },
  order: ['S'],
});
