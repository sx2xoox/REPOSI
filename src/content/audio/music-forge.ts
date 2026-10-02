// Floor 3 — "잿불 대장간" (The Ember Forge). C harmonic minor with a
// Neapolitan Db in the bridge. Anvil strikes keep time even when calm; a
// detuned pulse lead sings over a dark saw pad; ember crackles drift past.
// Combat: tresillo saw-bass riff, chip kit, sparkling 16th arpeggios.

import { defineSong } from '../../audio/song';
import { crackle, kit, lead, pad, sawBass, subBass, wind } from '../../audio/instruments';
import { once } from './music-lib';

const drums = kit({ chip: true, gain: 1 });
const forge = kit({ gain: 1 });

const COMBAT = {
  riff: { bass: 'R--R--R-R--R--5-', oct: 2 },
  drums: {
    drums: {
      kick: 'x..x..x.x..x..x.',
      snare: '....x.......x...',
      hat: 'x.x.x.x.x.x.x.x.',
      'tom:G2': '..............gx',
    },
  },
};

const LEAD_A =
  'C5/4 Eb5/4 G5/6 F5/2 | Eb5/4 D5/4 C5/8 | Ab4/4 C5/4 Eb5/6 D5/2 | B4/8 D5/4 G5/4 | G5/6 Ab5/2 G5/4 Eb5/4 | F5/6 Eb5/2 D5/4 C5/4 | Eb5/8 D5/8 | B4/4 C5/2 D5/2 B4/8 |';
const LEAD_B =
  'Ab5/6 G5/2 F5/8 | D5/6 F5/2 B4/8 | Eb5/4 G5/4 C6/8 | C6/6 Bb5/2 Ab5/8 | F5/4 Ab5/4 C6/4 Ab5/4 | Db6/8 C6/4 Ab5/4 | B5/6 C6/2 D6/8 | F5/4 D5/4 B4/8 |';

defineSong('floor3', {
  bpm: 112,
  master: 1.08,
  reverb: { seconds: 2.2, decay: 3, gain: 0.5, tone: 0.4 },
  delay: { beats: 0.75, feedback: 0.3, gain: 0.3 },
  channels: {
    anvil: { inst: forge, vol: 0.65, reverb: 0.4, pan: 0.2 },
    pad: { inst: pad({ wave: 'sawtooth', voices: 2, detune: 12, gain: 0.06, cutoff: 750, q: 1.2, a: 0.5, r: 1 }), vol: 0.85, reverb: 0.4 },
    lead: { inst: lead({ wave: 'pulse25', detune: 9, gain: 0.19, cutoff: 2600, vib: 16, a: 0.01 }), vol: 0.75, reverb: 0.3, delay: 0.15 },
    sparks: { inst: lead({ wave: 'pulse12', gain: 0.1, cutoff: 4000, a: 0.002, d: 0.06, s: 0.25, r: 0.04, vib: 0 }), vol: 0.6, delay: 0.25, pan: -0.25, layer: 'combat' },
    drone: { inst: subBass({ gain: 0.3 }), vol: 0.5, layer: 'calm' },
    riff: { inst: sawBass({ gain: 0.19, cutoff: 520, drive: 3, env: 3.5 }), vol: 0.7, layer: 'combat' },
    drums: { inst: drums, vol: 0.85, layer: 'combat', reverb: 0.12 },
    embers: { inst: crackle, vol: 0.7, reverb: 0.3 },
    bellows: { inst: wind, vol: 0.45, reverb: 0.3, layer: 'calm' },
  },
  sections: {
    A: {
      bars: 8,
      chords: 'Cm | Cm | Ab | G | Cm | Fm | Ab Bb | G',
      parts: {
        anvil: { drums: { 'anvil:E5': 'X.......x..g....' } },
        pad: { hold: true, center: 55 },
        drone: { bass: 'R---------------', oct: 2, vel: 0.7 },
        lead: LEAD_A,
        ...COMBAT,
      },
    },
    A2: {
      bars: 8,
      chords: 'Cm | Cm | Ab | G | Cm | Fm | Ab Bb | G',
      parts: {
        anvil: { drums: { 'anvil:E5': 'X.......x..g....', 'anvil:B5': '....g.......g...' } },
        pad: { hold: true, center: 55 },
        drone: { bass: 'R---------------', oct: 2, vel: 0.7 },
        lead: LEAD_A,
        sparks: { arp: '0123012301230123', oct: 5 },
        ...COMBAT,
      },
    },
    B: {
      bars: 8,
      chords: 'Fm | G | Cm | Ab | Fm | Db | G | G7',
      parts: {
        anvil: { drums: { 'anvil:G5': 'x.......x.......' } },
        pad: { hold: true, center: 57 },
        drone: { bass: 'R-------R-------', oct: 2, vel: 0.7 },
        lead: LEAD_B,
        riff: { bass: 'R-R-R--RR-R-5-8-', oct: 2 },
        drums: {
          drums: {
            kick: 'x...x...x...x...',
            snare: '....x.......x..g',
            hat: 'xgxgxgxgxgxgxgxg',
            crash: once(8),
            'tom:C3': rep4('..............xx'),
          },
        },
      },
    },
    B2: {
      bars: 8,
      chords: 'Fm | G | Cm | Ab | Fm | Db | G | G7',
      parts: {
        anvil: { drums: { 'anvil:G5': 'x.......x.......', 'anvil:D6': '..g.......g.....' } },
        pad: { hold: true, center: 57 },
        drone: { bass: 'R-------R-------', oct: 2, vel: 0.7 },
        lead: LEAD_B,
        sparks: { arp: '0123210301232103', oct: 5 },
        riff: { bass: 'R-R-R--RR-R-5-8-', oct: 2 },
        drums: {
          drums: {
            kick: 'x...x...x...x...',
            snare: '....x.......x..g',
            hat: 'xgxgxgxgxgxgxgxg',
            'tom:C3': rep4('..............xx'),
          },
        },
      },
    },
  },
  order: ['A', 'B', 'A2', 'B2'],
  onBar: (b) => {
    if (b.rng.chance(0.45)) b.play('embers', 0, b.rng.int(0, 12), 4, 0.4 + b.rng.next() * 0.5);
    if (b.barInSection % 4 === 2 && b.rng.chance(0.5)) b.play('bellows', 45, 0, 12, 0.6);
  },
});

/** toms only on the 4th bar of every 4 */
function rep4(lastBar: string): string {
  return '.'.repeat(48) + lastBar;
}
