// Tiny music-theory helpers for the song sequencer: note names, chord symbols
// and chord voicing. Pure functions (unit tested in node).

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C4" -> 60, "F#3" -> 54, "Bb5" -> 82, "E#4" -> 65. Throws on bad input. */
export function noteToMidi(s: string): number {
  const m = /^([A-Ga-g])(#{1,2}|b{1,2})?(-?\d)$/.exec(s.trim());
  if (!m) throw new Error(`bad note "${s}"`);
  const pc = LETTER[m[1].toUpperCase()];
  const acc = m[2] ? (m[2][0] === '#' ? m[2].length : -m[2].length) : 0;
  return 12 * (Number(m[3]) + 1) + pc + acc;
}

/** Pitch class of a note letter with accidentals ("F#" -> 6). */
export function pitchClass(s: string): number {
  const m = /^([A-G])(#|b)?$/.exec(s);
  if (!m) throw new Error(`bad pitch class "${s}"`);
  return (LETTER[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}

const QUALITIES: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '5': [0, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  mM7: [0, 3, 7, 11],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  '7sus4': [0, 5, 7, 10],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  '9': [0, 4, 7, 10, 14],
  m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m11: [0, 3, 7, 10, 14, 17],
  'maj7#11': [0, 4, 7, 11, 18],
};

export interface Chord {
  name: string;
  /** root pitch class */
  root: number;
  /** bass pitch class (slash chords) */
  bass: number;
  /** semitone intervals above the root, ascending */
  tones: number[];
}

/** Parse a chord symbol like "Dm", "F#m7b5", "Bb/D", "Cmaj7", "E5". */
export function parseChord(sym: string): Chord {
  const [main, slash] = sym.split('/');
  const m = /^([A-G])(#|b)?(.*)$/.exec(main);
  if (!m) throw new Error(`bad chord "${sym}"`);
  const q = QUALITIES[m[3]];
  if (!q) throw new Error(`unknown chord quality "${m[3]}" in "${sym}"`);
  const root = pitchClass(m[1] + (m[2] ?? ''));
  const bass = slash ? pitchClass(slash) : root;
  return { name: sym, root, bass, tones: q.slice() };
}

/** Shift a chord by semitones. */
export function transposeChord(c: Chord, semis: number): Chord {
  if (!semis) return c;
  return { ...c, root: (c.root + semis + 120) % 12, bass: (c.bass + semis + 120) % 12 };
}

/**
 * Close voicing of the chord tones around `center` (MIDI): each tone is placed
 * in the octave that keeps it within [center-6, center+5]. Consecutive chords
 * therefore voice-lead smoothly without extra bookkeeping.
 */
export function voiceChord(c: Chord, center = 60, maxTones = 4): number[] {
  const tones = c.tones.length > maxTones ? [c.tones[0], c.tones[1], ...c.tones.slice(-(maxTones - 2))] : c.tones;
  const out = tones.map((iv) => {
    const pc = (c.root + iv) % 12;
    let n = center - 6 + ((pc - (center - 6)) % 12 + 12) % 12;
    if (n > center + 5) n -= 12;
    return n;
  });
  return [...new Set(out)].sort((a, b) => a - b);
}

/** MIDI of the chord tone with index `k` (wrapping into higher octaves). */
export function arpTone(c: Chord, k: number, octave: number): number {
  const base = 12 * (octave + 1) + c.root;
  const n = c.tones.length;
  const i = ((k % n) + n) % n;
  return base + c.tones[i] + 12 * Math.floor(k / n);
}

/** Bass-grid symbols -> MIDI relative to the chord (see song.ts docs). */
export function bassTone(c: Chord, sym: string, octave: number): number {
  const base = 12 * (octave + 1);
  const root = base + c.root;
  switch (sym) {
    case 'R':
      return base + c.bass;
    case 'L':
      return base + c.bass - 12;
    case '8':
      return base + c.bass + 12;
    case '3':
      return root + (c.tones[1] ?? 4);
    case '5':
      return root + (c.tones.includes(6) ? 6 : c.tones.includes(8) ? 8 : 7);
    case '7':
      return root + (c.tones[3] !== undefined && c.tones[3] < 12 ? c.tones[3] : 10);
    case '4':
      return root + 5;
    case '6':
      return root + 9;
    case '2':
      return root + 2;
    case 'b':
      return root - 1;
    default:
      throw new Error(`bad bass symbol "${sym}"`);
  }
}
