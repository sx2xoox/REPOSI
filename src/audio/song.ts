// Song sequencer: a compact text notation for tracks + a lookahead scheduler.
//
// Notation (all parts are per section; a bar has meter*steps steps, default 16):
// - notes:  "D5/4 E5/2 F5/2 . /8 | A4+D5/16"  — NOTE[/len][!|?]; "." rest; "+" stacks
//           notes; len in steps (sticky); "!" accent, "?" ghost; "|" asserts a bar line.
// - hold:   { hold: true }                 — sustain the section's chords (pads)
// - chord:  { chord: "x--.x--." }          — chord stabs on a grid
// - bass:   { bass: "R--.5-.8", oct: 2 }    — R root/slash bass, L low root, 8 octave,
//           3 third, 5 fifth, 7 seventh, 2 4 6 scale steps, b leading tone;
//           "-" extends the previous note, "." rest. Grids repeat to fill the section.
// - arp:    { arp: "0.1.2.1.", oct: 4 }    — digits index chord tones (wrapping up octaves)
// - drums:  { drums: { kick: "x...", "tom:A2": "..x." } } — x hit, X accent,
//           g ghost, ? 50% chance.
// Sections: { bars, chords: "Dm | Bb | Gm A7", parts, bpm?, transpose? }.
// Order entries may be "A|A2" to pick a variant at random each pass.
//
// Layers: channels marked `combat` fade in with World's music intensity,
// `calm` channels duck a little in combat.

import { RNG } from '../engine/rng';
import { collectPatches, createSends, isOffline, type Ctx, type Patch, type Sends } from './synth';
import { arpTone, bassTone, noteToMidi, parseChord, transposeChord, voiceChord, type Chord } from './theory';
import type { Instrument, Kit } from './instruments';
import { registerTrack, type MusicId, type TrackHandle } from './audio';

export type Layer = 'base' | 'combat' | 'calm';

export interface ChannelDef {
  inst: Instrument | Kit;
  vol?: number;
  reverb?: number;
  delay?: number;
  pan?: number;
  layer?: Layer;
  /** velocity randomisation 0..1 */
  humanize?: number;
}

export type PartSpec =
  | string
  | { notes: string; loop?: boolean; vel?: number; transpose?: number }
  | { hold: true; center?: number; vel?: number; maxTones?: number }
  | { chord: string; center?: number; vel?: number; maxTones?: number }
  | { bass: string; oct?: number; vel?: number }
  | { arp: string; oct?: number; vel?: number }
  | { drums: Record<string, string>; vel?: number }
  | PartSpec[];

export interface SectionDef {
  bars: number;
  bpm?: number;
  chords?: string;
  transpose?: number;
  parts: Record<string, PartSpec>;
}

export interface BarContext {
  t: number;
  barDur: number;
  stepDur: number;
  bar: number;
  barInSection: number;
  section: string;
  pass: number;
  rng: RNG;
  intensity: number;
  chord: Chord | null;
  play(ch: string, midi: number, atSteps: number, lenSteps: number, vel: number): void;
  hit(ch: string, voice: string, atSteps: number, vel: number, midi?: number, lenSteps?: number): void;
}

export interface SongDef {
  bpm: number;
  meter?: number;
  steps?: number;
  /** 16th swing: odd steps are delayed by `swing` steps */
  swing?: number;
  /** 8th swing (shuffle): the off-beat 8th is delayed by `2 * swing8` steps */
  swing8?: number;
  master?: number;
  channels: Record<string, ChannelDef>;
  sections: Record<string, SectionDef>;
  intro?: string[];
  order: string[];
  loop?: boolean;
  reverb?: { seconds?: number; decay?: number; tone?: number; gain?: number };
  delay?: { beats?: number; feedback?: number; gain?: number; tone?: number };
  onBar?: (b: BarContext) => void;
  fadeIn?: number;
  combatIn?: number;
  combatOut?: number;
  /** combat layer level when intensity is 0 (default 0) */
  combatFloor?: number;
  /** mix-bus tone: low shelf (200 Hz) and high shelf (3.2 kHz) gains in dB */
  eq?: { low?: number; high?: number };
}

export interface Ev {
  ch: string;
  midi: number;
  len: number;
  vel: number;
  voice?: string;
  chance?: number;
}

export interface CompiledSection {
  name: string;
  bars: number;
  bpm: number;
  total: number;
  steps: Ev[][];
  chordAt: (Chord | null)[];
}

export interface CompiledSong {
  def: SongDef;
  stepsPerBar: number;
  stepsPerBeat: number;
  sections: Map<string, CompiledSection>;
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

export interface NoteEvent {
  step: number;
  midi: number[];
  len: number;
  vel: number;
}

export function parseNotes(src: string, stepsPerBar: number, transpose = 0): { events: NoteEvent[]; length: number } {
  const events: NoteEvent[] = [];
  let pos = 0;
  let lastLen = 4;
  for (const tok of src.split(/\s+/).filter(Boolean)) {
    if (tok === '|') {
      if (pos % stepsPerBar !== 0) throw new Error(`bar line at step ${pos} is not on a bar boundary (bar=${stepsPerBar}) near "${src.slice(0, 40)}..."`);
      continue;
    }
    const m = /^([^/!?]+)(?:\/(\d+))?([!?]?)$/.exec(tok);
    if (!m) throw new Error(`bad note token "${tok}"`);
    const len = m[2] ? Number(m[2]) : lastLen;
    if (!(len > 0)) throw new Error(`bad length in "${tok}"`);
    lastLen = len;
    const vel = m[3] === '!' ? 1 : m[3] === '?' ? 0.5 : 0.8;
    if (m[1] !== '.' && m[1] !== 'r') {
      events.push({ step: pos, midi: m[1].split('+').map((n) => noteToMidi(n) + transpose), len, vel });
    }
    pos += len;
  }
  return { events, length: pos };
}

/** Split a grid into onsets with lengths (holds "-" extend the onset). */
export function parseGrid(grid: string): { step: number; sym: string; len: number }[] {
  const g = grid.replace(/[\s|]/g, '');
  const out: { step: number; sym: string; len: number }[] = [];
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '.' || c === '-') continue;
    let len = 1;
    while (i + len < g.length && g[i + len] === '-') len++;
    out.push({ step: i, sym: c, len });
  }
  return out;
}

function gridLength(grid: string): number {
  return grid.replace(/[\s|]/g, '').length;
}

function parseChordLine(line: string, bars: number, stepsPerBar: number, transpose: number): (Chord | null)[] {
  const at: (Chord | null)[] = new Array(bars * stepsPerBar).fill(null);
  const barStrs = line.split('|').map((s) => s.trim()).filter((s) => s.length > 0);
  if (!barStrs.length) return at;
  let prev: Chord | null = null;
  for (let b = 0; b < bars; b++) {
    const syms = barStrs[b % barStrs.length].split(/\s+/);
    const span = stepsPerBar / syms.length;
    syms.forEach((sym, i) => {
      const c: Chord | null = sym === '%' ? prev : transposeChord(parseChord(sym), transpose);
      prev = c;
      const s0 = b * stepsPerBar + Math.round(i * span);
      const s1 = b * stepsPerBar + Math.round((i + 1) * span);
      for (let s = s0; s < s1; s++) at[s] = c;
    });
  }
  return at;
}

const DRUM_VEL: Record<string, number> = { x: 0.8, X: 1, g: 0.42, o: 0.6 };

function compileSection(name: string, sec: SectionDef, def: SongDef, stepsPerBar: number): CompiledSection {
  const total = sec.bars * stepsPerBar;
  const tr = sec.transpose ?? 0;
  const steps: Ev[][] = Array.from({ length: total }, () => []);
  const chordAt = sec.chords ? parseChordLine(sec.chords, sec.bars, stepsPerBar, tr) : new Array(total).fill(null);
  const push = (s: number, ev: Ev) => {
    if (s >= 0 && s < total) steps[s].push(ev);
  };
  // chord spans (for hold parts)
  const spans: { s: number; len: number; c: Chord }[] = [];
  for (let s = 0; s < total; s++) {
    const c = chordAt[s];
    if (!c) continue;
    if (s === 0 || chordAt[s - 1] !== c || s % stepsPerBar === 0) spans.push({ s, len: 1, c });
    else spans[spans.length - 1].len++;
  }

  const compilePart = (ch: string, part: PartSpec): void => {
    if (!def.channels[ch]) throw new Error(`section ${name}: unknown channel "${ch}"`);
    if (Array.isArray(part)) {
      for (const p of part) compilePart(ch, p);
      return;
    }
    if (typeof part === 'string') part = { notes: part };
    if ('notes' in part) {
      const { events, length } = parseNotes(part.notes, stepsPerBar, tr + (part.transpose ?? 0));
      if (length > total) throw new Error(`section ${name}/${ch}: notes are ${length} steps, section has ${total}`);
      const reps = part.loop ? Math.ceil(total / Math.max(1, length)) : 1;
      for (let r = 0; r < reps; r++) {
        for (const e of events) for (const m of e.midi) push(e.step + r * length, { ch, midi: m, len: e.len, vel: e.vel * (part.vel ?? 1) });
      }
    } else if ('hold' in part) {
      for (const sp of spans) for (const m of voiceChord(sp.c, part.center ?? 60, part.maxTones ?? 4)) push(sp.s, { ch, midi: m, len: sp.len, vel: part.vel ?? 0.8 });
    } else if ('chord' in part) {
      const len = gridLength(part.chord);
      for (let base = 0; base < total; base += len) {
        for (const g of parseGrid(part.chord)) {
          const c = chordAt[base + g.step];
          if (!c) continue;
          const vel = (DRUM_VEL[g.sym] ?? 0.8) * (part.vel ?? 1);
          for (const m of voiceChord(c, part.center ?? 60, part.maxTones ?? 4)) push(base + g.step, { ch, midi: m, len: g.len, vel });
        }
      }
    } else if ('bass' in part) {
      const len = gridLength(part.bass);
      for (let base = 0; base < total; base += len) {
        for (const g of parseGrid(part.bass)) {
          const c = chordAt[base + g.step];
          if (!c) continue;
          push(base + g.step, { ch, midi: bassTone(c, g.sym, part.oct ?? 2), len: g.len, vel: 0.85 * (part.vel ?? 1) });
        }
      }
    } else if ('arp' in part) {
      const len = gridLength(part.arp);
      for (let base = 0; base < total; base += len) {
        for (const g of parseGrid(part.arp)) {
          const c = chordAt[base + g.step];
          if (!c) continue;
          const k = Number(g.sym);
          if (Number.isNaN(k)) throw new Error(`section ${name}/${ch}: bad arp symbol "${g.sym}"`);
          push(base + g.step, { ch, midi: arpTone(c, k, part.oct ?? 4), len: g.len, vel: 0.8 * (part.vel ?? 1) });
        }
      }
    } else if ('drums' in part) {
      const kitDef = def.channels[ch].inst;
      for (const [key, grid] of Object.entries(part.drums)) {
        const [voice, tune] = key.split(':');
        if (typeof kitDef === 'function' || !(voice in kitDef)) throw new Error(`section ${name}/${ch}: unknown drum voice "${voice}"`);
        const midi = tune ? (/^\d+$/.test(tune) ? Number(tune) : noteToMidi(tune) + tr) : 0;
        const g = grid.replace(/[\s|]/g, '');
        for (let base = 0; base < total; base += g.length) {
          for (let i = 0; i < g.length; i++) {
            const c = g[i];
            if (c === '.' || c === '-') continue;
            let len = 1;
            while (i + len < g.length && g[i + len] === '-') len++;
            if (c === '?') push(base + i, { ch, voice, midi, len, vel: 0.65 * (part.vel ?? 1), chance: 0.5 });
            else if (DRUM_VEL[c] !== undefined) push(base + i, { ch, voice, midi, len, vel: DRUM_VEL[c] * (part.vel ?? 1) });
            else throw new Error(`section ${name}/${ch}: bad drum symbol "${c}"`);
          }
        }
      }
    }
  };

  for (const [ch, part] of Object.entries(sec.parts)) compilePart(ch, part);
  return { name, bars: sec.bars, bpm: sec.bpm ?? def.bpm, total, steps, chordAt };
}

export function compileSong(def: SongDef): CompiledSong {
  const stepsPerBeat = def.steps ?? 4;
  const stepsPerBar = (def.meter ?? 4) * stepsPerBeat;
  const sections = new Map<string, CompiledSection>();
  for (const [name, sec] of Object.entries(def.sections)) sections.set(name, compileSection(name, sec, def, stepsPerBar));
  for (const entry of [...(def.intro ?? []), ...def.order]) {
    for (const n of entry.split('|')) if (!sections.has(n)) throw new Error(`order references unknown section "${n}"`);
  }
  if (!def.order.length && !(def.intro ?? []).length) throw new Error('song has no sections to play');
  return { def, stepsPerBar, stepsPerBeat, sections };
}

function sectionSeconds(s: CompiledSection, song: CompiledSong): number {
  return s.total * (60 / s.bpm / song.stepsPerBeat);
}

/** Length of one pass through `order` (first variant of each entry), seconds. */
export function loopSeconds(song: CompiledSong): number {
  return song.def.order.reduce((sum, e) => sum + sectionSeconds(song.sections.get(e.split('|')[0])!, song), 0);
}

export function introSeconds(song: CompiledSong): number {
  return (song.def.intro ?? []).reduce((sum, e) => sum + sectionSeconds(song.sections.get(e.split('|')[0])!, song), 0);
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

export const songStats = { players: 0, timers: 0 };

const LOOKAHEAD = 0.3;
const LOOKAHEAD_HIDDEN = 1.2;
const TICK_MS = 60;

interface Strip {
  input: GainNode;
  def: ChannelDef;
  broken: boolean;
}

export class SongPlayer implements TrackHandle {
  private readonly ctx: Ctx;
  private readonly song: CompiledSong;
  private readonly master: GainNode;
  private readonly layers: Record<Layer, GainNode>;
  private readonly strips = new Map<string, Strip>();
  private readonly sends: Sends;
  private readonly nodes: AudioNode[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposeTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private finished = false;
  private disposed = false;
  private inIntro: boolean;
  private qi = 0;
  private sec!: CompiledSection;
  private sstep = 0;
  private nextTime: number;
  private pass = 0;
  private bar = 0;
  private intensity = 0;
  /** note patches that may still be sounding (halted on dispose) */
  private notes: Patch[] = [];
  readonly rng: RNG;

  constructor(ctx: Ctx, out: AudioNode, song: CompiledSong, seed?: number) {
    this.ctx = ctx;
    this.song = song;
    const def = song.def;
    const offline = isOffline(ctx);
    this.rng = new RNG(seed ?? (offline ? 1234 : Math.floor(Math.random() * 1e9)));
    songStats.players++;

    const keep = <T extends AudioNode>(n: T): T => {
      this.nodes.push(n);
      return n;
    };
    this.master = keep(ctx.createGain());
    const now = ctx.currentTime;
    const level = def.master ?? 0.8;
    this.master.gain.setValueAtTime(0, now);
    this.master.gain.linearRampToValueAtTime(level, now + (def.fadeIn ?? 0.35));
    // mix-bus EQ: remove inaudible rumble, tame the low-mids, add some air so
    // the tracks translate to small speakers
    const hp = keep(ctx.createBiquadFilter());
    hp.type = 'highpass';
    hp.frequency.value = 32;
    hp.Q.value = 0.7;
    const lowShelf = keep(ctx.createBiquadFilter());
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 200;
    lowShelf.gain.value = def.eq?.low ?? -4;
    const highShelf = keep(ctx.createBiquadFilter());
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 3200;
    highShelf.gain.value = def.eq?.high ?? 3;
    this.master.connect(hp);
    hp.connect(lowShelf);
    lowShelf.connect(highShelf);
    highShelf.connect(out);
    this.layers = {
      base: keep(ctx.createGain()),
      combat: keep(ctx.createGain()),
      calm: keep(ctx.createGain()),
    };
    this.layers.combat.gain.value = def.combatFloor ?? 0;
    for (const l of Object.values(this.layers)) l.connect(this.master);

    const beat = 60 / def.bpm;
    this.sends = createSends(ctx, this.master, {
      reverbSeconds: def.reverb?.seconds ?? 2.6,
      reverbDecay: def.reverb?.decay ?? 2.8,
      reverbTone: def.reverb?.tone ?? 0.45,
      reverbGain: def.reverb?.gain ?? 0.6,
      delayTime: beat * (def.delay?.beats ?? 0.75),
      delayFeedback: def.delay?.feedback ?? 0.38,
      delayGain: def.delay?.gain ?? 0.45,
      delayTone: def.delay?.tone ?? 2400,
    });

    for (const [name, ch] of Object.entries(def.channels)) {
      const input = keep(ctx.createGain());
      input.gain.value = ch.vol ?? 1;
      let dest: AudioNode = this.layers[ch.layer ?? 'base'];
      if (ch.pan && typeof ctx.createStereoPanner === 'function') {
        const pn = keep(ctx.createStereoPanner());
        pn.pan.value = ch.pan;
        pn.connect(dest);
        dest = pn;
      }
      input.connect(dest);
      if (ch.reverb) {
        const g = keep(ctx.createGain());
        g.gain.value = ch.reverb;
        input.connect(g);
        g.connect(this.sends.reverb);
      }
      if (ch.delay) {
        const g = keep(ctx.createGain());
        g.gain.value = ch.delay;
        input.connect(g);
        g.connect(this.sends.delay);
      }
      this.strips.set(name, { input, def: ch, broken: false });
    }

    this.inIntro = (def.intro ?? []).length > 0;
    this.nextTime = now + 0.06;
    this.enterSection();

    if (offline) {
      const end = (ctx as OfflineAudioContext).length / ctx.sampleRate;
      this.scheduleUntil(end);
    } else {
      this.timer = setInterval(() => this.tick(), TICK_MS);
      songStats.timers++;
      this.tick();
    }
  }

  private currentList(): string[] {
    return this.inIntro ? this.song.def.intro ?? [] : this.song.def.order;
  }

  private enterSection(): void {
    const list = this.currentList();
    const entry = list[this.qi];
    const opts = entry.split('|');
    const name = opts.length > 1 ? opts[this.rng.int(0, opts.length - 1)] : opts[0];
    this.sec = this.song.sections.get(name)!;
    this.sstep = 0;
  }

  private advance(): void {
    this.sstep++;
    if (this.sstep % this.song.stepsPerBar === 0) this.bar++;
    if (this.sstep < this.sec.total) return;
    this.qi++;
    const list = this.currentList();
    if (this.qi >= list.length) {
      if (this.inIntro) {
        this.inIntro = false;
        this.qi = 0;
        if (!this.song.def.order.length) {
          this.finished = true;
          return;
        }
      } else if (this.song.def.loop === false) {
        this.finished = true;
        return;
      } else {
        this.qi = 0;
        this.pass++;
      }
    }
    this.enterSection();
  }

  private stepDur(): number {
    return 60 / this.sec.bpm / this.song.stepsPerBeat;
  }

  private tick(): void {
    if (this.stopped || this.finished) {
      this.clearTimer();
      return;
    }
    const now = this.ctx.currentTime;
    if (this.notes.length > 64) this.notes = this.notes.filter((p) => !p.isDisposed);
    // fell behind (tab hidden, long GC...): re-anchor instead of a burst of late notes
    if (this.nextTime < now - 0.05) this.nextTime = now + 0.05;
    const hidden = typeof document !== 'undefined' && document.hidden;
    this.scheduleUntil(now + (hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD));
  }

  private scheduleUntil(horizon: number): void {
    let guard = 0;
    while (this.nextTime < horizon && !this.finished && !this.stopped && guard++ < 200000) {
      this.scheduleStep(this.nextTime);
      this.nextTime += this.stepDur();
      this.advance();
    }
    if (this.finished) this.clearTimer();
  }

  private scheduleStep(time: number): void {
    const sd = this.stepDur();
    const def = this.song.def;
    let swing = def.swing && this.sstep % 2 === 1 ? def.swing * sd : 0;
    if (def.swing8 && this.song.stepsPerBeat === 4) {
      const k = this.sstep % 4;
      if (k === 2) swing = def.swing8 * 2 * sd;
      else if (k === 3) swing = def.swing8 * sd;
    }
    if (this.sstep % this.song.stepsPerBar === 0 && def.onBar) {
      try {
        def.onBar(this.barContext(time, sd));
      } catch (e) {
        console.error('[audio] song onBar failed', e);
        def.onBar = undefined;
      }
    }
    for (const ev of this.sec.steps[this.sstep]) {
      if (ev.chance !== undefined && this.rng.next() > ev.chance) continue;
      this.fire(ev.ch, time + swing, ev.midi, ev.len * sd, ev.vel, ev.voice);
    }
  }

  private fire(ch: string, t: number, midi: number, dur: number, vel: number, voice?: string): void {
    const strip = this.strips.get(ch);
    if (!strip || strip.broken) return;
    const h = strip.def.humanize ?? 0.08;
    const v = Math.max(0.05, vel * (1 - h * this.rng.next()));
    const jitter = h > 0 ? this.rng.range(0, 0.006) : 0;
    try {
      const inst = strip.def.inst;
      collectPatches(this.notes, () => {
        if (typeof inst === 'function') inst(this.ctx, strip.input, t + jitter, midi, dur, v);
        else inst[voice ?? '']?.(this.ctx, strip.input, t + jitter, midi, dur, v);
      });
    } catch (e) {
      strip.broken = true;
      console.error(`[audio] channel "${ch}" failed`, e);
    }
  }

  private barContext(time: number, sd: number): BarContext {
    const spb = this.song.stepsPerBar;
    return {
      t: time,
      barDur: sd * spb,
      stepDur: sd,
      bar: this.bar,
      barInSection: Math.floor(this.sstep / spb),
      section: this.sec.name,
      pass: this.pass,
      rng: this.rng,
      intensity: this.intensity,
      chord: this.sec.chordAt[this.sstep] ?? null,
      play: (ch, midi, at, len, vel) => this.fire(ch, time + at * sd, midi, len * sd, vel),
      hit: (ch, voice, at, vel, midi = 0, len = 1) => this.fire(ch, time + at * sd, midi, len * sd, vel, voice),
    };
  }

  setIntensity(v: number): void {
    const x = Math.max(0, Math.min(1, v));
    if (Math.abs(x - this.intensity) < 0.01 || this.disposed) return;
    const up = x > this.intensity;
    this.intensity = x;
    const def = this.song.def;
    const now = this.ctx.currentTime;
    const floor = def.combatFloor ?? 0;
    const tc = (up ? def.combatIn ?? 0.6 : def.combatOut ?? 2.4) / 3;
    this.layers.combat.gain.setTargetAtTime(floor + (1 - floor) * x, now, tc);
    this.layers.calm.gain.setTargetAtTime(1 - 0.55 * x, now, tc);
  }

  stop(fade: number): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimer();
    const now = this.ctx.currentTime;
    const g = this.master.gain;
    const f = Math.max(0.03, fade);
    if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(now);
    else {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
    }
    g.linearRampToValueAtTime(0, now + f);
    const tail = f + LOOKAHEAD_HIDDEN + 0.4;
    this.disposeTimer = setTimeout(() => this.dispose(), tail * 1000);
  }

  /** Disconnect everything (called automatically after stop). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopped = true;
    this.clearTimer();
    if (this.disposeTimer !== null) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = null;
    }
    // the master is already silent here: cut whatever is still ringing
    const at = this.ctx.currentTime + 0.01;
    for (const p of this.notes) p.halt(at);
    this.notes = [];
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.sends.dispose();
    songStats.players--;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      songStats.timers--;
    }
  }

  get isFinished(): boolean {
    return this.finished;
  }

  get position(): { section: string; step: number; pass: number; bar: number } {
    return { section: this.sec.name, step: this.sstep, pass: this.pass, bar: this.bar };
  }
}

/** Registered song definitions (for tests and offline analysis). */
export const songDefs = new Map<MusicId, CompiledSong>();

/** Compile and register a song; composition errors are logged, never thrown at import. */
export function defineSong(id: MusicId, def: SongDef): void {
  try {
    const compiled = compileSong(def);
    songDefs.set(id, compiled);
    registerTrack(id, (ctx, out) => new SongPlayer(ctx, out, compiled));
  } catch (e) {
    console.error(`[audio] song "${id}" failed to compile:`, e);
  }
}
