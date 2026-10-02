// Audio tests: run every synth and every track against a mock WebAudio graph
// (node env has no AudioContext) and check scheduling sanity, node cleanup
// (no leaks) and timer cleanup. Loudness is verified separately in Chromium
// with OfflineAudioContext (see the audio report script).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadContent } from '../src/content';
import { MUSIC_IDS, SFX_NAMES, getSfxSynth, getTrackFactory, hasSfx, hasTrack } from '../src/audio/audio';
import { audioStats, sfxSends } from '../src/audio/synth';
import { arpTone, bassTone, noteToMidi, parseChord, voiceChord } from '../src/audio/theory';
import { compileSong, introSeconds, loopSeconds, parseGrid, parseNotes, songDefs, songStats } from '../src/audio/song';

loadContent();

// ---------------------------------------------------------------------------
// Mock WebAudio
// ---------------------------------------------------------------------------

function checkTime(t: number, what: string): void {
  if (!Number.isFinite(t) || t < 0) throw new RangeError(`${what}: bad time ${t}`);
}
function checkVal(v: number, what: string): void {
  if (!Number.isFinite(v)) throw new RangeError(`${what}: bad value ${v}`);
}

class MockParam {
  value: number;
  constructor(v = 0) {
    this.value = v;
  }
  setValueAtTime(v: number, t: number) {
    checkVal(v, 'setValueAtTime');
    checkTime(t, 'setValueAtTime');
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    checkVal(v, 'linearRamp');
    checkTime(t, 'linearRamp');
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    checkVal(v, 'expRamp');
    checkTime(t, 'expRamp');
    if (v === 0) throw new RangeError('exponentialRampToValueAtTime to 0');
    return this;
  }
  setTargetAtTime(v: number, t: number, c: number) {
    checkVal(v, 'setTarget');
    checkTime(t, 'setTarget');
    if (!(c >= 0)) throw new RangeError(`setTarget bad time constant ${c}`);
    return this;
  }
  cancelScheduledValues(t: number) {
    checkTime(t, 'cancel');
    return this;
  }
  cancelAndHoldAtTime(t: number) {
    checkTime(t, 'cancelAndHold');
    return this;
  }
}

class MockNode {
  connections = new Set<unknown>();
  disconnected = false;
  connect(dest: unknown) {
    if (!dest) throw new Error('connect to nothing');
    this.connections.add(dest);
    return dest;
  }
  disconnect() {
    this.connections.clear();
    this.disconnected = true;
  }
}

class MockSource extends MockNode {
  startT?: number;
  stopT?: number;
  ended = false;
  onended: (() => void) | null = null;
  start(t = 0, offset = 0) {
    if (this.startT !== undefined) throw new Error('source started twice');
    checkTime(t, 'start');
    checkTime(offset, 'start offset');
    this.startT = t;
  }
  stop(t = 0) {
    checkTime(t, 'stop');
    this.stopT = t;
  }
}
class MockOsc extends MockSource {
  type = 'sine';
  frequency = new MockParam(440);
  detune = new MockParam(0);
  setPeriodicWave() {}
}
class MockBufSrc extends MockSource {
  buffer: unknown = null;
  loop = false;
  playbackRate = new MockParam(1);
}
class MockBuffer {
  data: Float32Array[];
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(i: number) {
    return this.data[i];
  }
}

class MockCtx {
  currentTime = 0;
  sampleRate = 8000;
  destination = new MockNode();
  nodes: MockNode[] = [];
  sources: MockSource[] = [];
  private add<T extends MockNode>(n: T): T {
    this.nodes.push(n);
    if (n instanceof MockSource) this.sources.push(n);
    return n;
  }
  createGain() {
    return this.add(Object.assign(new MockNode(), { gain: new MockParam(1) }));
  }
  createOscillator() {
    return this.add(new MockOsc());
  }
  createBufferSource() {
    return this.add(new MockBufSrc());
  }
  createBiquadFilter() {
    return this.add(Object.assign(new MockNode(), { type: 'lowpass', frequency: new MockParam(350), Q: new MockParam(1), gain: new MockParam(0) }));
  }
  createWaveShaper() {
    return this.add(Object.assign(new MockNode(), { curve: null, oversample: 'none' }));
  }
  createConvolver() {
    return this.add(Object.assign(new MockNode(), { buffer: null, normalize: true }));
  }
  createDelay() {
    return this.add(Object.assign(new MockNode(), { delayTime: new MockParam(0) }));
  }
  createStereoPanner() {
    return this.add(Object.assign(new MockNode(), { pan: new MockParam(0) }));
  }
  createPeriodicWave() {
    return {};
  }
  createBuffer(ch: number, len: number, sr: number) {
    return new MockBuffer(ch, len, sr);
  }
  /** advance the clock and fire `onended` for finished sources */
  advance(dt: number) {
    this.currentTime += dt;
    for (const s of this.sources) {
      if (!s.ended && s.stopT !== undefined && s.stopT <= this.currentTime) {
        s.ended = true;
        s.onended?.();
      }
    }
  }
}

const asCtx = (m: MockCtx) => m as unknown as BaseAudioContext;
const asNode = (m: MockNode) => m as unknown as AudioNode;

// ---------------------------------------------------------------------------
// Theory & notation
// ---------------------------------------------------------------------------

describe('audio theory', () => {
  it('parses note names', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('F#3')).toBe(54);
    expect(noteToMidi('Bb5')).toBe(82);
    expect(noteToMidi('E#4')).toBe(65);
    expect(noteToMidi('B#4')).toBe(72);
    expect(() => noteToMidi('H4')).toThrow();
  });
  it('parses chords incl. slash chords', () => {
    const c = parseChord('F#m7b5');
    expect(c.root).toBe(6);
    expect(c.tones).toEqual([0, 3, 6, 10]);
    const s = parseChord('Bb/Ab');
    expect(s.root).toBe(10);
    expect(s.bass).toBe(8);
    expect(() => parseChord('Cfoo')).toThrow();
  });
  it('voices chords close to the centre', () => {
    for (const sym of ['C', 'F#m', 'Bbmaj7', 'G#7', 'Ebsus4', 'Fm9']) {
      const v = voiceChord(parseChord(sym), 60);
      for (const m of v) {
        expect(m).toBeGreaterThanOrEqual(54);
        expect(m).toBeLessThanOrEqual(65);
      }
      expect(v.length).toBeGreaterThanOrEqual(3);
    }
  });
  it('resolves bass and arp symbols', () => {
    const c = parseChord('A7');
    expect(bassTone(c, 'R', 2)).toBe(45);
    expect(bassTone(c, '5', 2)).toBe(52);
    expect(bassTone(c, '7', 2)).toBe(55);
    expect(bassTone(parseChord('C/E'), 'R', 2)).toBe(40);
    expect(arpTone(parseChord('Dm'), 3, 4)).toBe(74);
  });
  it('validates bar lines in note strings', () => {
    const r = parseNotes('D5/4 E5/4 F5/8 | A5/16 |', 16);
    expect(r.length).toBe(32);
    expect(r.events.map((e) => e.midi[0])).toEqual([74, 76, 77, 81]);
    expect(() => parseNotes('D5/4 E5/4 | F5/8', 16)).toThrow(/bar line/);
  });
  it('parses grids with holds', () => {
    expect(parseGrid('R--.5-')).toEqual([
      { step: 0, sym: 'R', len: 3 },
      { step: 4, sym: '5', len: 2 },
    ]);
  });
  it('rejects unknown channels and sections', () => {
    expect(() => compileSong({ bpm: 100, channels: {}, sections: { A: { bars: 1, parts: { x: 'C4/16' } } }, order: ['A'] })).toThrow(/unknown channel/);
    expect(() => compileSong({ bpm: 100, channels: {}, sections: {}, order: ['A'] })).toThrow(/unknown section/);
  });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('audio registry', () => {
  it('implements every sfx name', () => {
    const missing = SFX_NAMES.filter((n) => !hasSfx(n));
    expect(missing).toEqual([]);
  });
  it('implements every music track', () => {
    const missing = MUSIC_IDS.filter((id) => !hasTrack(id));
    expect(missing).toEqual([]);
    expect([...songDefs.keys()].sort()).toEqual([...MUSIC_IDS].sort());
  });
  it('floor loops are 30-70s, other tracks sane', () => {
    for (const [id, song] of songDefs) {
      const loop = loopSeconds(song);
      if (id.startsWith('floor')) {
        expect(loop, id).toBeGreaterThanOrEqual(30);
        expect(loop, id).toBeLessThanOrEqual(70);
      } else if (id === 'gameover') {
        expect(loop + introSeconds(song), id).toBeLessThan(12);
      } else {
        expect(loop, id).toBeGreaterThanOrEqual(15);
        expect(loop, id).toBeLessThanOrEqual(80);
      }
    }
  });
  it('every floor track has a combat layer', () => {
    for (const id of ['floor1', 'floor2', 'floor3', 'floor4', 'floor5'] as const) {
      const def = songDefs.get(id)!.def;
      expect(Object.values(def.channels).some((c) => c.layer === 'combat'), id).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// SFX on the mock graph
// ---------------------------------------------------------------------------

describe('sfx synths', () => {
  it('schedule sane sounds and release every node', () => {
    for (const name of SFX_NAMES) {
      for (const pitch of [0.6, 1, 1.8]) {
        const ctx = new MockCtx();
        sfxSends(asCtx(ctx)); // shared, persistent
        const before = ctx.nodes.length;
        const patches = audioStats.livePatches;
        const nodes = audioStats.liveNodes;
        const synth = getSfxSynth(name)!;
        synth(asCtx(ctx), asNode(ctx.destination), 0.01, { vol: 1, pitch, pan: 0 });
        const created = ctx.nodes.slice(before);
        const srcs = created.filter((n): n is MockSource => n instanceof MockSource);
        expect(srcs.length, name).toBeGreaterThan(0);
        for (const s of srcs) {
          expect(s.startT, name).toBeDefined();
          expect(s.stopT!, name).toBeGreaterThan(s.startT!);
        }
        const longest = Math.max(...srcs.map((s) => s.stopT!));
        expect(longest, `${name} length`).toBeLessThan(name.startsWith('boss') || name === 'player_die' || name === 'floor_start' ? 3.5 : 1.6);
        ctx.advance(10);
        expect(created.every((n) => n.disconnected), `${name} leaked nodes`).toBe(true);
        expect(audioStats.livePatches, name).toBe(patches);
        expect(audioStats.liveNodes, name).toBe(nodes);
      }
    }
  });
  it('most sounds are short (< 0.6s)', () => {
    const lengths: Record<string, number> = {};
    for (const name of SFX_NAMES) {
      const ctx = new MockCtx();
      sfxSends(asCtx(ctx));
      const before = ctx.nodes.length;
      getSfxSynth(name)!(asCtx(ctx), asNode(ctx.destination), 0, { vol: 1, pitch: 1, pan: 0 });
      const srcs = ctx.nodes.slice(before).filter((n): n is MockSource => n instanceof MockSource);
      lengths[name] = Math.max(...srcs.map((s) => s.stopT!));
      ctx.advance(10);
    }
    const short = Object.values(lengths).filter((l) => l < 0.65).length;
    expect(short / SFX_NAMES.length).toBeGreaterThan(0.6);
  });
});

// ---------------------------------------------------------------------------
// Music on the mock graph
// ---------------------------------------------------------------------------

describe('music sequencer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function run(ctx: MockCtx, seconds: number, onTick?: (t: number) => void): void {
    for (let t = 0; t < seconds; t += 0.05) {
      ctx.advance(0.05);
      vi.advanceTimersByTime(50);
      onTick?.(ctx.currentTime);
    }
  }

  it('plays every track, responds to intensity and cleans up on stop', () => {
    for (const id of MUSIC_IDS) {
      const ctx = new MockCtx();
      const timers = songStats.timers;
      const players = songStats.players;
      const handle = getTrackFactory(id)!(asCtx(ctx), asNode(ctx.destination));
      run(ctx, 24, (t) => handle.setIntensity?.(Math.floor(t / 4) % 2));
      const srcs = ctx.sources.length;
      expect(srcs, `${id} scheduled nothing`).toBeGreaterThan(id === 'gameover' ? 8 : 60);
      // nothing scheduled too far ahead (lookahead + at most one bar of onBar ambience)
      const latest = Math.max(...ctx.sources.map((s) => s.startT ?? 0));
      expect(latest, id).toBeLessThan(ctx.currentTime + 0.4 + 3.5);
      handle.stop(0.5);
      run(ctx, 8);
      expect(songStats.timers, `${id} timers`).toBe(timers);
      expect(songStats.players, `${id} players`).toBe(players);
      const live = ctx.nodes.filter((n) => !n.disconnected);
      expect(live.length, `${id} leaked ${live.length} nodes`).toBe(0);
    }
  });

  it('survives rapid track switching without leaking timers', () => {
    const ctx = new MockCtx();
    const timers = songStats.timers;
    let h = getTrackFactory('floor1')!(asCtx(ctx), asNode(ctx.destination));
    for (let i = 0; i < 60; i++) {
      h.stop(0.3);
      h = getTrackFactory(MUSIC_IDS[i % MUSIC_IDS.length])!(asCtx(ctx), asNode(ctx.destination));
      run(ctx, 0.1);
    }
    h.stop(0);
    run(ctx, 6);
    expect(songStats.timers).toBe(timers);
    expect(ctx.nodes.filter((n) => !n.disconnected).length).toBe(0);
  });

  it('halts long ringing notes once a stopped track is disposed', () => {
    const ctx = new MockCtx();
    const h = getTrackFactory('floor4')!(asCtx(ctx), asNode(ctx.destination)); // long bells + pads
    run(ctx, 6);
    h.stop(0.2);
    run(ctx, 2.2); // dispose happens ~fade + 1.6s after stop
    const ringing = ctx.sources.filter((s) => !s.ended);
    expect(ringing.length).toBe(0);
    expect(ctx.nodes.filter((n) => !n.disconnected).length).toBe(0);
  });

  it('a non-looping track finishes on its own', () => {
    const ctx = new MockCtx();
    const timers = songStats.timers;
    const h = getTrackFactory('gameover')!(asCtx(ctx), asNode(ctx.destination));
    run(ctx, 15);
    expect(songStats.timers).toBe(timers);
    h.stop(1);
    run(ctx, 5);
  });

  it('pre-schedules offline contexts without timers', () => {
    const ctx = Object.assign(new MockCtx(), { length: 8000 * 6, startRendering: () => Promise.resolve() });
    const timers = songStats.timers;
    const h = getTrackFactory('floor3')!(asCtx(ctx), asNode(ctx.destination));
    expect(songStats.timers).toBe(timers);
    const latest = Math.max(...ctx.sources.map((s) => s.startT ?? 0));
    expect(latest).toBeGreaterThan(5);
    expect(latest).toBeLessThan(6.1);
    h.stop(0);
    run(ctx, 4);
  });

  it('is cheap to call setIntensity every frame', () => {
    const ctx = new MockCtx();
    const h = getTrackFactory('floor2')!(asCtx(ctx), asNode(ctx.destination));
    const before = ctx.nodes.length;
    for (let i = 0; i < 1000; i++) h.setIntensity?.(1);
    expect(ctx.nodes.length).toBe(before);
    h.stop(0);
    run(ctx, 4);
  });
});
