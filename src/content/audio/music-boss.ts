// Boss themes.
// - boss: "심판의 종" (Bell of Judgement) — E minor/Phrygian at 144 BPM:
//   driving saw bass, staccato string ostinato, detuned pulse lead and a
//   tolling bell; a half-time choir breakdown before the loop.
// - boss_final: "공허의 왕관" (Crown of the Void) — C# minor at 150 BPM in
//   four movements: riff, heroic theme, Neapolitan breakdown with organ and
//   choir, then the theme again a semitone higher as the climax.

import { defineSong, type SongDef } from '../../audio/song';
import { bell, brass, choir, kit, lead, organ, pad, sawBass, strings } from '../../audio/instruments';
import { lastBarHold, once } from './music-lib';

// --- boss -------------------------------------------------------------------

const bossKit = kit({ chip: true, gain: 1.05 });

const LEAD_A =
  'E5/2 E5/2 B4/2 E5/2 G5/4 F#5/4 | F5/6 E5/2 C5/8 | B4/2 E5/2 G5/2 B5/2 A5/4 G5/4 | F#5/8 A5/4 D5/4 | E5/2 E5/2 C5/2 E5/2 G5/4 A5/4 | F#5/6 G5/2 A5/8 | B5/4 G5/4 E5/4 B4/4 | C5/4 F5/4 A5/4 F5/4 |';
const LEAD_B =
  'A5/6 B5/2 C6/4 B5/4 | G5/6 A5/2 B5/8 | A5/4 C6/4 A5/4 F5/4 | B5/6 A5/2 G5/4 D5/4 | C6/4 B5/4 A5/4 E5/4 | G5/4 F#5/4 E5/4 B4/4 | C5/2 F5/2 A5/2 C6/2 B5/4 A5/4 | D#6/8 B5/8 |';

const DRIVE = {
  kick: 'x.....x...x.x...',
  snare: '....x.......x...',
  hat: 'x.x.x.x.x.x.x.x.',
  ohat: '..............x.',
};

defineSong('boss', {
  bpm: 144,
  master: 1.0,
  fadeIn: 0.2,
  combatFloor: 1,
  reverb: { seconds: 2, decay: 3, gain: 0.45 },
  delay: { beats: 0.75, feedback: 0.25, gain: 0.25 },
  channels: {
    bass: { inst: sawBass({ gain: 0.19, cutoff: 650, drive: 3, env: 3 }), vol: 0.72 },
    strings: { inst: strings({ gain: 0.075, a: 0.005, r: 0.06, cutoff: 3200 }), vol: 0.75, reverb: 0.25, pan: 0.2 },
    lead: { inst: lead({ wave: 'pulse25', detune: 11, gain: 0.17, cutoff: 3400, vib: 18 }), vol: 0.8, reverb: 0.25, delay: 0.15 },
    counter: { inst: lead({ wave: 'pulse12', gain: 0.12, cutoff: 2600, vib: 12 }), vol: 0.6, reverb: 0.25, pan: -0.25 },
    power: { inst: pad({ wave: 'sawtooth', voices: 2, detune: 10, gain: 0.05, cutoff: 1500, a: 0.04, r: 0.4 }), vol: 0.8, reverb: 0.3 },
    bell: { inst: bell({ ratio: 1.41, index: 3, decay: 2.6, gain: 0.2, partial: 2.76, partialGain: 0.22 }), vol: 0.7, reverb: 0.6 },
    choir: { inst: choir({ gain: 0.1, vowel: 'a', a: 0.4, r: 1 }), vol: 0.8, reverb: 0.6 },
    drums: { inst: bossKit, vol: 0.9, reverb: 0.12 },
  },
  sections: {
    I: {
      bars: 2,
      chords: 'Em | Em',
      parts: {
        drums: { drums: { boom: 'x.....x.x.....x.', crash: once(2), 'tom:E2': '.'.repeat(16) + '........x.x.xxxx' } },
        bell: 'E3/16 | E3/8 E3/8 |',
        bass: { bass: 'R---------------', oct: 2 },
        power: { hold: true, center: 52 },
      },
    },
    A: {
      bars: 8,
      chords: 'Em | F | Em | D | C | D | Em | F',
      parts: {
        bass: { bass: 'R-R-8-R-R-R-8-5-', oct: 2 },
        strings: { arp: '0102010201020102', oct: 4 },
        power: { hold: true, center: 52 },
        bell: 'E3/32 | E3/32 | C3/32 | E3/32 |',
        lead: LEAD_A,
        drums: { drums: { ...DRIVE, crash: once(8) } },
      },
    },
    A2: {
      bars: 8,
      chords: 'Em | F | Em | D | C | D | Em | F',
      parts: {
        bass: { bass: 'R-R-8-R-R-R-8-5-', oct: 2 },
        strings: { arp: '0102010201020102', oct: 4 },
        power: { hold: true, center: 52 },
        bell: 'E3/32 | E3/32 | C3/32 | E3/32 |',
        lead: LEAD_A,
        counter: 'G4/8 B4/8 | A4/8 G4/8 | G4/8 E4/8 | D4/8 F#4/8 | G4/8 E4/8 | D4/8 F#4/8 | G4/8 B4/8 | A4/8 C5/8 |',
        drums: { drums: { ...DRIVE, hat: 'xgxgxgxgxgxgxgxg', 'tom:A2': '.'.repeat(112) + '............xxxx' } },
      },
    },
    B: {
      bars: 8,
      chords: 'Am | Em | F | G | Am | Em | F | B',
      parts: {
        bass: { bass: 'R-R-R-R-R-R-8-5-', oct: 2 },
        strings: { arp: '0121012101210121', oct: 4 },
        power: { chord: 'x-----x-----x---', center: 57 },
        lead: LEAD_B,
        bell: 'A2/32 | F2/32 | A2/32 | F2/16 B2/16 |',
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
      chords: 'Em | C | F | B7',
      parts: {
        choir: { hold: true, center: 60 },
        bell: 'E3/16 | C3/16 | F3/16 | B2/16 |',
        bass: { bass: 'R---------------', oct: 2 },
        strings: { arp: '0.1.2.1.0.1.2.1.', oct: 4, vel: 0.7 },
        drums: { drums: { boom: 'x.......x.......', snare: '........x.......', swell: lastBarHold(4) } },
      },
    },
  },
  intro: ['I'],
  order: ['A', 'A2', 'B', 'C'],
});

// --- boss_final -------------------------------------------------------------

const finalKit = kit({ chip: true, gain: 1.1 });

const HERO =
  'C#5/6 E5/2 A5/8 | F#5/6 G#5/2 B5/8 | B5/4 G#5/4 D#5/8 | E5/6 D#5/2 C#5/8 | A5/4 G#5/4 F#5/4 C#5/4 | D#5/6 E5/2 F#5/8 | G#5/4 B5/4 E6/4 D#6/4 | B#5/8 G#5/8 |';
const HERO_CHORDS = 'A | B | G#m | C#m | F#m | B | E | G#7';

const finalDef: SongDef = {
  bpm: 150,
  master: 0.95,
  fadeIn: 0.2,
  combatFloor: 1,
  reverb: { seconds: 2.8, decay: 2.6, gain: 0.5 },
  delay: { beats: 0.75, feedback: 0.25, gain: 0.22 },
  channels: {
    bass: { inst: sawBass({ gain: 0.19, cutoff: 600, drive: 3.2, env: 3 }), vol: 0.72 },
    strings: { inst: strings({ gain: 0.075, a: 0.005, r: 0.06, cutoff: 3400 }), vol: 0.7, reverb: 0.3, pan: 0.2 },
    hold: { inst: strings({ gain: 0.06, a: 0.4, r: 0.8, cutoff: 2200 }), vol: 0.75, reverb: 0.5, pan: -0.15 },
    lead: { inst: lead({ wave: 'pulse25', detune: 10, gain: 0.17, cutoff: 3600, vib: 18 }), vol: 0.8, reverb: 0.3, delay: 0.12 },
    brass: { inst: brass({ gain: 0.15, cutoff: 2400 }), vol: 0.75, reverb: 0.35 },
    organ: { inst: organ({ gain: 0.09, bright: 0.8, a: 0.15, r: 0.8 }), vol: 0.8, reverb: 0.55 },
    choir: { inst: choir({ gain: 0.11, vowel: 'a', a: 0.6, r: 1.2 }), vol: 0.85, reverb: 0.6 },
    bell: { inst: bell({ ratio: 1.41, index: 3, decay: 3, gain: 0.2, partial: 2.76, partialGain: 0.22 }), vol: 0.75, reverb: 0.65 },
    drums: { inst: finalKit, vol: 0.9, reverb: 0.15 },
  },
  sections: {
    I: {
      bars: 4,
      chords: 'C#m | A | F#m | G#',
      parts: {
        choir: { hold: true, center: 60 },
        hold: { hold: true, center: 52 },
        bell: 'C#3/16 | A2/16 | F#2/16 | G#2/16 |',
        bass: { bass: 'R---------------', oct: 2 },
        drums: { drums: { boom: 'x.......x.......', swell: lastBarHold(4), 'tom:G#2': '.'.repeat(48) + '........x.x.xxxx' } },
      },
    },
    A: {
      bars: 8,
      chords: 'C#m | C#m | A | B | C#m | C#m | F#m | G#',
      parts: {
        bass: { bass: 'R-R-8-R-R-R-8-R-', oct: 2 },
        strings: { arp: '0102010201020102', oct: 4 },
        brass: { chord: 'X-.....x-.x-....', center: 60 },
        hold: { hold: true, center: 55, vel: 0.6 },
        drums: { drums: { kick: 'x..x..x.x..x..x.', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', crash: once(8) } },
      },
    },
    B: {
      bars: 8,
      chords: HERO_CHORDS,
      parts: {
        bass: { bass: 'R-R-R-R-R-R-8-5-', oct: 2 },
        strings: { arp: '0121012101210121', oct: 4 },
        lead: HERO,
        brass: { notes: HERO, transpose: -12, vel: 0.85 },
        hold: { hold: true, center: 57, vel: 0.7 },
        drums: { drums: { kick: 'x...x...x...x...', snare: '....x.......x..g', hat: 'xgxgxgxgxgxgxgxg', crash: once(4) } },
      },
    },
    C: {
      bars: 8,
      chords: 'C#m | D | C#m | D | A | Am | G#sus4 | G#',
      parts: {
        organ: { hold: true, center: 56 },
        choir: { hold: true, center: 63 },
        bell: 'G#4/8 C#5/8 | D5/8 A4/8 | E5/8 C#5/8 | F#5/8 D5/8 | E5/8 C#5/8 | C5/8 E5/8 | C#5/16 | B#4/8 D#5/8 |',
        bass: { bass: 'R-------R-------', oct: 2 },
        drums: { drums: { boom: 'x.......x.......', snare: '........x.......', 'tom:C#3': '.'.repeat(112) + 'x.x.x.x.xxxxxxxx' } },
      },
    },
    D: {
      bars: 8,
      chords: HERO_CHORDS,
      transpose: 1,
      parts: {
        bass: { bass: 'R-R-8-R-R-R-8-5-', oct: 2 },
        strings: { arp: '0102010201020102', oct: 4 },
        lead: HERO,
        brass: { notes: HERO, transpose: -12, vel: 0.9 },
        choir: { hold: true, center: 62, vel: 0.85 },
        bell: 'A2/32 | A2/32 | F#2/32 | E2/16 G#2/16 |',
        drums: { drums: { kick: 'x..x..x.x..x..x.', snare: '....x.......x.x.', hat: 'xxxxxxxxxxxxxxxx', crash: once(4) } },
      },
    },
  },
  intro: ['I'],
  order: ['A', 'B', 'C', 'D'],
};

defineSong('boss_final', finalDef);
