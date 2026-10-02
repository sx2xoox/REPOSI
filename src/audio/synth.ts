// Small WebAudio synthesis toolkit shared by sound effects and music.
//
// Everything accepts any BaseAudioContext, so the exact same synths can be
// rendered into an OfflineAudioContext for automated loudness checks.
//
// Node lifetime: every node created through a `Patch` is tracked; when the last
// scheduled source of the patch has ended, the whole patch is disconnected.
// Shared resources (noise buffers, periodic waves, shaper curves, reverb
// impulses) are cached per context and never re-created per note.

export type Ctx = BaseAudioContext;
export type NoiseColor = 'white' | 'pink' | 'brown' | 'chip' | 'crackle';
export type Wave = OscillatorType | 'pulse12' | 'pulse25' | 'pulse33' | PeriodicWave;

/** Live counters (debug overlay / leak tests). */
export const audioStats = { livePatches: 0, liveNodes: 0, createdPatches: 0 };

const EPS = 0.0001;

export function mtof(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Cosmetic randomness for sound variation (never gameplay). */
export function rnd(a = 0, b = 1): number {
  return a + Math.random() * (b - a);
}

function cacheFor<T>(map: WeakMap<Ctx, Map<string, T>>, ctx: Ctx): Map<string, T> {
  let m = map.get(ctx);
  if (!m) {
    m = new Map();
    map.set(ctx, m);
  }
  return m;
}

/** Offline contexts are pre-scheduled instead of driven by timers. */
export function isOffline(ctx: Ctx): boolean {
  return typeof (ctx as OfflineAudioContext).startRendering === 'function';
}

// ---------------------------------------------------------------------------
// Noise buffers
// ---------------------------------------------------------------------------

const NOISE_SECONDS = 2;
const noiseCache = new WeakMap<Ctx, Map<string, AudioBuffer>>();

/** Deterministic LCG so offline renders are reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 4294967296) * 2 - 1;
  };
}

export function noiseBuffer(ctx: Ctx, color: NoiseColor = 'white'): AudioBuffer {
  const cache = cacheFor(noiseCache, ctx);
  const hit = cache.get(color);
  if (hit) return hit;
  const len = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const r = lcg(0x5eed + color.length * 977);
  if (color === 'white') {
    for (let i = 0; i < len; i++) d[i] = r();
  } else if (color === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = r();
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else if (color === 'brown') {
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * r()) / 1.02;
      d[i] = last * 3.5;
    }
  } else if (color === 'chip') {
    // sample & hold noise at ~1/3 rate: crunchy, NES-ish
    let v = 0;
    for (let i = 0; i < len; i++) {
      if (i % 3 === 0) v = r() > 0 ? 0.8 : -0.8;
      d[i] = v;
    }
  } else {
    // crackle: sparse little decaying bursts (debris, embers, bone rattles)
    let i = 0;
    while (i < len) {
      i += Math.floor(200 + (r() + 1) * 900);
      const amp = 0.35 + (r() + 1) * 0.32;
      const n = 20 + Math.floor((r() + 1) * 60);
      for (let k = 0; k < n && i + k < len; k++) d[i + k] += r() * amp * Math.pow(1 - k / n, 2);
    }
  }
  // normalise peak to 1 (keeps gain staging predictable across colours)
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < len; i++) d[i] /= peak;
  cache.set(color, buf);
  return buf;
}

// ---------------------------------------------------------------------------
// Waves & curves
// ---------------------------------------------------------------------------

const waveCache = new WeakMap<Ctx, Map<string, PeriodicWave>>();

/** Band-limited pulse wave with the given duty cycle (0..1). */
export function pulseWave(ctx: Ctx, duty: number): PeriodicWave {
  const cache = cacheFor(waveCache, ctx);
  const key = `pulse${duty}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const N = 48;
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let n = 1; n < N; n++) {
    re[n] = Math.sin(2 * Math.PI * n * duty) / (n * Math.PI);
    im[n] = (1 - Math.cos(2 * Math.PI * n * duty)) / (n * Math.PI);
  }
  const w = ctx.createPeriodicWave(re, im);
  cache.set(key, w);
  return w;
}

/** Additive wave from harmonic amplitudes (index 0 = fundamental). */
export function harmonicWave(ctx: Ctx, key: string, amps: number[]): PeriodicWave {
  const cache = cacheFor(waveCache, ctx);
  const k = `h:${key}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const re = new Float32Array(amps.length + 1);
  const im = new Float32Array(amps.length + 1);
  amps.forEach((a, i) => (im[i + 1] = a));
  const w = ctx.createPeriodicWave(re, im);
  cache.set(k, w);
  return w;
}

export function setWave(osc: OscillatorNode, ctx: Ctx, w: Wave): void {
  if (typeof w === 'string') {
    if (w === 'pulse12') osc.setPeriodicWave(pulseWave(ctx, 0.125));
    else if (w === 'pulse25') osc.setPeriodicWave(pulseWave(ctx, 0.25));
    else if (w === 'pulse33') osc.setPeriodicWave(pulseWave(ctx, 0.333));
    else if (w !== 'custom') osc.type = w as OscillatorType;
  } else {
    osc.setPeriodicWave(w);
  }
}

const curveCache = new Map<string, Float32Array<ArrayBuffer>>();

/** Soft clipping (tanh) — warmth / grit. */
export function driveCurve(amount = 2): Float32Array<ArrayBuffer> {
  const key = `d${amount}`;
  const hit = curveCache.get(key);
  if (hit) return hit;
  const n = 1024;
  const c = new Float32Array(n);
  const norm = Math.tanh(amount);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(amount * x) / norm;
  }
  curveCache.set(key, c);
  return c;
}

/** Amplitude quantiser — bit-crush flavour for chip voices and crunchy hits. */
export function crushCurve(levels = 8): Float32Array<ArrayBuffer> {
  const key = `c${levels}`;
  const hit = curveCache.get(key);
  if (hit) return hit;
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.round(x * levels) / levels;
  }
  curveCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------------------
// Reverb impulse + send bus
// ---------------------------------------------------------------------------

const irCache = new WeakMap<Ctx, Map<string, AudioBuffer>>();

/**
 * Generated stereo room impulse: a few early reflections followed by an
 * exponentially decaying noise tail that gets darker over time.
 */
export function reverbImpulse(ctx: Ctx, seconds = 2, decay = 3, tone = 0.5): AudioBuffer {
  const cache = cacheFor(irCache, ctx);
  const key = `${seconds}:${decay}:${tone}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const r = lcg(0xa11ce + ch * 7919 + Math.floor(seconds * 100));
    let y = 0;
    const a0 = 0.12 + tone * 0.75;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      const env = Math.pow(1 - x, decay);
      const a = a0 * (1 - 0.8 * x);
      y += a * (r() - y);
      d[i] = y * env;
    }
    // early reflections
    for (let k = 0; k < 7; k++) {
      const at = Math.floor(sr * (0.007 + k * 0.011 + (r() + 1) * 0.006 + ch * 0.003));
      if (at < len) d[at] += (0.55 - k * 0.06) * (k % 2 ? -1 : 1);
    }
  }
  cache.set(key, buf);
  return buf;
}

export interface SendOpts {
  reverbSeconds?: number;
  reverbDecay?: number;
  reverbTone?: number;
  reverbGain?: number;
  delayTime?: number;
  delayFeedback?: number;
  delayGain?: number;
  delayTone?: number;
  /** high-pass before the reverb / delay so tails don't get muddy (Hz) */
  lowCut?: number;
}

/** Shared effect sends: one convolver reverb + one filtered feedback delay. */
export interface Sends {
  reverb: AudioNode;
  delay: AudioNode;
  dispose(): void;
}

export function createSends(ctx: Ctx, dest: AudioNode, o: SendOpts = {}): Sends {
  const nodes: AudioNode[] = [];
  const keep = <T extends AudioNode>(n: T): T => {
    nodes.push(n);
    return n;
  };
  const revIn = keep(ctx.createGain());
  const revHp = keep(ctx.createBiquadFilter());
  revHp.type = 'highpass';
  revHp.frequency.value = o.lowCut ?? 220;
  revHp.Q.value = 0.6;
  const conv = keep(ctx.createConvolver());
  conv.buffer = reverbImpulse(ctx, o.reverbSeconds ?? 1.8, o.reverbDecay ?? 3, o.reverbTone ?? 0.5);
  const revOut = keep(ctx.createGain());
  revOut.gain.value = o.reverbGain ?? 0.5;
  revIn.connect(revHp);
  revHp.connect(conv);
  conv.connect(revOut);
  revOut.connect(dest);

  const dIn = keep(ctx.createGain());
  const dHp = keep(ctx.createBiquadFilter());
  dHp.type = 'highpass';
  dHp.frequency.value = (o.lowCut ?? 220) * 1.4;
  dHp.Q.value = 0.6;
  const dl = keep(ctx.createDelay(2));
  dl.delayTime.value = Math.min(1.9, o.delayTime ?? 0.28);
  const lp = keep(ctx.createBiquadFilter());
  lp.type = 'lowpass';
  lp.frequency.value = o.delayTone ?? 2600;
  const fb = keep(ctx.createGain());
  fb.gain.value = Math.min(0.85, o.delayFeedback ?? 0.35);
  const dOut = keep(ctx.createGain());
  dOut.gain.value = o.delayGain ?? 0.4;
  dIn.connect(dHp);
  dHp.connect(dl);
  dl.connect(lp);
  lp.connect(fb);
  fb.connect(dl);
  lp.connect(dOut);
  dOut.connect(dest);
  // a little of the echo goes into the room as well
  const dRev = keep(ctx.createGain());
  dRev.gain.value = 0.25;
  dOut.connect(dRev);
  dRev.connect(revIn);

  let disposed = false;
  return {
    reverb: revIn,
    delay: dIn,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    },
  };
}

// SFX share one set of sends per context. The engine routes them to its sfx
// bus; offline renders fall back to the context destination.
const sfxSendMap = new WeakMap<Ctx, Sends>();
const sfxSendDest = new WeakMap<Ctx, AudioNode>();

export function routeSfxSends(ctx: Ctx, dest: AudioNode): void {
  sfxSendDest.set(ctx, dest);
  const old = sfxSendMap.get(ctx);
  if (old) {
    old.dispose();
    sfxSendMap.delete(ctx);
  }
}

export function sfxSends(ctx: Ctx): Sends {
  let s = sfxSendMap.get(ctx);
  if (!s) {
    s = createSends(ctx, sfxSendDest.get(ctx) ?? ctx.destination, {
      reverbSeconds: 1.6,
      reverbDecay: 3.2,
      reverbTone: 0.45,
      reverbGain: 0.55,
      delayTime: 0.17,
      delayFeedback: 0.32,
      delayGain: 0.35,
      delayTone: 3200,
    });
    sfxSendMap.set(ctx, s);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

/** Percussive attack/decay envelope (exponential decay). */
export function envAD(p: AudioParam, t: number, a: number, d: number, peak: number): number {
  const pk = Math.max(EPS * 2, peak);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(pk, t + Math.max(0.0005, a));
  p.exponentialRampToValueAtTime(EPS, t + a + Math.max(0.005, d));
  p.setValueAtTime(0, t + a + Math.max(0.005, d) + 0.001);
  return t + a + d + 0.002;
}

/**
 * Sustained envelope: attack to peak, decay to `s * peak`, hold until
 * `t + hold`, then release (time-constant based, ~99% gone after `r`).
 * Returns the time at which the sound is silent.
 */
export function envADSR(p: AudioParam, t: number, a: number, d: number, s: number, hold: number, r: number, peak: number): number {
  const at = Math.max(0.001, a);
  const rel = t + Math.max(hold, at + 0.002);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + at);
  if (s < 1) p.setTargetAtTime(peak * s, t + at, Math.max(0.005, d / 3));
  p.setTargetAtTime(0, rel, Math.max(0.004, r / 5));
  return rel + r;
}

/** Ramp a param through several values evenly (or at explicit times). */
export function sweep(p: AudioParam, t: number, values: number[], dur: number, exp = true, times?: number[]): void {
  p.setValueAtTime(values[0], t);
  for (let i = 1; i < values.length; i++) {
    const at = t + (times ? times[i - 1] : (dur * i) / (values.length - 1));
    if (exp && values[i] > 0 && values[i - 1] > 0) p.exponentialRampToValueAtTime(values[i], at);
    else p.linearRampToValueAtTime(values[i], at);
  }
}

// ---------------------------------------------------------------------------
// Patch: a self-cleaning group of nodes for one sound / note
// ---------------------------------------------------------------------------

export interface PatchOpts {
  vol?: number;
  pitch?: number;
  /** time stretch for envelopes; default derived from pitch */
  stretch?: number;
  sends?: Sends | null;
  reverb?: number;
  delay?: number;
}

export interface FilterSpec {
  type?: BiquadFilterType;
  f: number | number[];
  q?: number;
  /** duration of the frequency sweep (default: voice duration) */
  dur?: number;
  /** don't scale with pitch */
  fixed?: boolean;
}

export interface ToneOpts {
  wave?: Wave;
  /** frequency (Hz) or sweep points */
  f: number | number[];
  /** sweep duration (default dur) */
  sweep?: number;
  /** linear frequency sweep instead of exponential */
  lin?: boolean;
  at?: number;
  dur: number;
  a?: number;
  gain: number;
  /** sustain: ADSR with sustain level (default: percussive AD) */
  sus?: number;
  rel?: number;
  detune?: number;
  /** vibrato [rate Hz, depth cents, delay s] */
  vib?: [number, number, number?];
  filter?: FilterSpec;
  drive?: number;
  crush?: number;
  /** don't scale frequency with patch pitch */
  fixed?: boolean;
  to?: AudioNode;
}

export interface NoiseOpts {
  color?: NoiseColor;
  at?: number;
  dur: number;
  a?: number;
  gain: number;
  rate?: number;
  filter?: FilterSpec;
  filter2?: FilterSpec;
  drive?: number;
  sus?: number;
  to?: AudioNode;
}

export interface FmOpts {
  f: number | number[];
  ratio: number;
  /** modulation index (deviation / modulator frequency), may sweep */
  index: number | number[];
  at?: number;
  dur: number;
  a?: number;
  gain: number;
  wave?: Wave;
  modWave?: Wave;
  sus?: number;
  rel?: number;
  vib?: [number, number, number?];
  fixed?: boolean;
  filter?: FilterSpec;
  to?: AudioNode;
}

// While set, every new Patch registers itself here (lets a song player halt
// the notes it scheduled when it is disposed).
let patchCollector: Patch[] | null = null;

/** Run `fn`, collecting every Patch it creates into `into`. */
export function collectPatches(into: Patch[], fn: () => void): void {
  const prev = patchCollector;
  patchCollector = into;
  try {
    fn();
  } finally {
    patchCollector = prev;
  }
}

export class Patch {
  readonly ctx: Ctx;
  readonly t: number;
  readonly pitch: number;
  readonly ts: number;
  readonly out: GainNode;
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private pending = 0;
  private disposed = false;

  constructor(ctx: Ctx, dest: AudioNode, t: number, o: PatchOpts = {}) {
    this.ctx = ctx;
    this.t = t;
    this.pitch = Math.max(0.05, o.pitch ?? 1);
    this.ts = o.stretch ?? Math.min(1.8, Math.max(0.5, Math.pow(this.pitch, -0.35)));
    audioStats.livePatches++;
    audioStats.createdPatches++;
    if (patchCollector) patchCollector.push(this);
    this.out = this.gain(o.vol ?? 1);
    this.out.connect(dest);
    if (o.sends) {
      if (o.reverb) this.out.connect(this.gain(o.reverb, o.sends.reverb));
      if (o.delay) this.out.connect(this.gain(o.delay, o.sends.delay));
    }
  }

  add<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    audioStats.liveNodes++;
    return n;
  }

  /** Gain node, optionally connected to a node or an AudioParam (modulation). */
  gain(v = 1, dest?: AudioNode | AudioParam): GainNode {
    const g = this.add(this.ctx.createGain());
    g.gain.value = v;
    if (dest) {
      if ('value' in dest) g.connect(dest as AudioParam);
      else g.connect(dest as AudioNode);
    }
    return g;
  }

  filter(type: BiquadFilterType, f: number, q = 0.707, dest?: AudioNode): BiquadFilterNode {
    const b = this.add(this.ctx.createBiquadFilter());
    b.type = type;
    b.frequency.value = Math.min(20000, Math.max(10, f));
    b.Q.value = q;
    if (dest) b.connect(dest);
    return b;
  }

  shaper(curve: Float32Array<ArrayBuffer>, dest?: AudioNode): WaveShaperNode {
    const s = this.add(this.ctx.createWaveShaper());
    s.curve = curve;
    if (dest) s.connect(dest);
    return s;
  }

  /** Highest frequency an oscillator may be set to (keeps FM below Nyquist). */
  get fmax(): number {
    return this.ctx.sampleRate * 0.45;
  }

  osc(wave: Wave, f: number): OscillatorNode {
    const o = this.add(this.ctx.createOscillator());
    setWave(o, this.ctx, wave);
    o.frequency.value = Math.min(this.fmax, f);
    return o;
  }

  noiseSrc(color: NoiseColor = 'white', rate = 1): AudioBufferSourceNode {
    const s = this.add(this.ctx.createBufferSource());
    s.buffer = noiseBuffer(this.ctx, color);
    s.loop = true;
    s.playbackRate.value = rate;
    return s;
  }

  /** Start a source; the patch disposes itself when all its sources ended. */
  run(src: AudioScheduledSourceNode, start: number, stop: number, offset?: number): void {
    this.pending++;
    this.sources.push(src);
    src.onended = () => {
      src.onended = null;
      if (--this.pending <= 0) this.dispose();
    };
    if (offset !== undefined && 'buffer' in src) (src as AudioBufferSourceNode).start(start, offset);
    else src.start(start);
    src.stop(Math.max(start + 0.001, stop));
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Cut every source at `at` (used when a track is torn down). */
  halt(at: number): void {
    if (this.disposed) return;
    for (const s of this.sources) {
      try {
        s.stop(at);
      } catch {
        /* not started / already stopped */
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sources = [];
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    audioStats.liveNodes -= this.nodes.length;
    audioStats.livePatches--;
    this.nodes = [];
  }

  /** Scaled time helper. */
  T(x: number): number {
    return x * this.ts;
  }

  private applyFilter(input: AudioNode, spec: FilterSpec, t: number, dur: number): AudioNode {
    const fs = Array.isArray(spec.f) ? spec.f : [spec.f];
    const k = spec.fixed ? 1 : this.pitch;
    const flt = this.filter(spec.type ?? 'lowpass', fs[0] * k, spec.q ?? 0.707);
    if (fs.length > 1) sweep(flt.frequency, t, fs.map((v) => Math.min(20000, Math.max(10, v * k))), this.T(spec.dur ?? dur));
    input.connect(flt);
    return flt;
  }

  /** Oscillator voice with pitch sweep, optional filter, drive and envelope. */
  tone(o: ToneOpts): GainNode {
    const t = this.t + this.T(o.at ?? 0);
    const dur = this.T(o.dur);
    const a = this.T(o.a ?? 0.002);
    const fs = (Array.isArray(o.f) ? o.f : [o.f]).map((v) => Math.min(this.fmax, v * (o.fixed ? 1 : this.pitch)));
    const osc = this.osc(o.wave ?? 'sine', fs[0]);
    if (fs.length > 1) sweep(osc.frequency, t, fs, this.T(o.sweep ?? o.dur), !o.lin);
    if (o.detune) osc.detune.value = o.detune;
    let node: AudioNode = osc;
    if (o.filter) node = this.applyFilter(node, o.filter, t, o.dur);
    if (o.crush) {
      const c = this.shaper(crushCurve(o.crush));
      node.connect(c);
      node = c;
    }
    if (o.drive) {
      const s = this.shaper(driveCurve(o.drive));
      node.connect(s);
      node = s;
    }
    const env = this.gain(0, o.to ?? this.out);
    node.connect(env);
    let end: number;
    if (o.sus !== undefined) end = envADSR(env.gain, t, a, dur * 0.3, o.sus, dur, this.T(o.rel ?? 0.08), o.gain);
    else end = envAD(env.gain, t, a, dur, o.gain);
    if (o.vib) this.vibrato(osc.detune, t, o.vib[0], o.vib[1], this.T(o.vib[2] ?? 0), end + 0.01);
    this.run(osc, t, end + 0.01);
    return env;
  }

  /** Filtered noise burst. */
  noise(o: NoiseOpts): GainNode {
    const t = this.t + this.T(o.at ?? 0);
    const dur = this.T(o.dur);
    const a = this.T(o.a ?? 0.001);
    const src = this.noiseSrc(o.color ?? 'white', (o.rate ?? 1) * (o.color === 'crackle' ? 1 : Math.sqrt(this.pitch)));
    let node: AudioNode = src;
    if (o.filter) node = this.applyFilter(node, o.filter, t, o.dur);
    if (o.filter2) node = this.applyFilter(node, o.filter2, t, o.dur);
    if (o.drive) {
      const s = this.shaper(driveCurve(o.drive));
      node.connect(s);
      node = s;
    }
    const env = this.gain(0, o.to ?? this.out);
    node.connect(env);
    let end: number;
    if (o.sus !== undefined) end = envADSR(env.gain, t, a, dur * 0.3, o.sus, dur, dur * 0.4, o.gain);
    else end = envAD(env.gain, t, a, dur, o.gain);
    this.run(src, t, end + 0.01, Math.random() * (NOISE_SECONDS - 0.2));
    return env;
  }

  /** Two-operator FM voice (bells, metal, zaps, growls). */
  fm(o: FmOpts): GainNode {
    const t = this.t + this.T(o.at ?? 0);
    const dur = this.T(o.dur);
    const a = this.T(o.a ?? 0.002);
    const k = o.fixed ? 1 : this.pitch;
    const fs = (Array.isArray(o.f) ? o.f : [o.f]).map((v) => Math.min(this.fmax, v * k));
    const car = this.osc(o.wave ?? 'sine', fs[0]);
    const mod = this.osc(o.modWave ?? 'sine', fs[0] * o.ratio);
    if (fs.length > 1) {
      sweep(car.frequency, t, fs, dur);
      sweep(mod.frequency, t, fs.map((v) => Math.min(this.fmax, v * o.ratio)), dur);
    }
    const idx = Array.isArray(o.index) ? o.index : [o.index];
    const depth = this.gain(0);
    const fm = fs[0] * o.ratio;
    sweep(
      depth.gain,
      t,
      idx.map((v) => Math.max(0.01, v * fm)),
      dur,
    );
    mod.connect(depth);
    depth.connect(car.frequency);
    let node: AudioNode = car;
    if (o.filter) node = this.applyFilter(node, o.filter, t, o.dur);
    const env = this.gain(0, o.to ?? this.out);
    node.connect(env);
    let end: number;
    if (o.sus !== undefined) end = envADSR(env.gain, t, a, dur * 0.3, o.sus, dur, this.T(o.rel ?? 0.1), o.gain);
    else end = envAD(env.gain, t, a, dur, o.gain);
    if (o.vib) this.vibrato(car.detune, t, o.vib[0], o.vib[1], this.T(o.vib[2] ?? 0), end + 0.01);
    this.run(car, t, end + 0.01);
    this.run(mod, t, end + 0.01);
    return env;
  }

  /** Sine LFO on a detune param (cents), fading in after `delay`. */
  vibrato(param: AudioParam, t: number, rate: number, cents: number, delay: number, end: number): void {
    const lfo = this.osc('sine', rate);
    const g = this.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0, t + delay);
    g.gain.linearRampToValueAtTime(cents, t + delay + 0.15);
    lfo.connect(g);
    g.connect(param);
    this.run(lfo, t, end);
  }

  /** Amplitude tremolo applied to a gain param. */
  tremolo(param: AudioParam, t: number, rate: number, depth: number, end: number): void {
    const lfo = this.osc('sine', rate);
    const g = this.gain(depth);
    lfo.connect(g);
    g.connect(param);
    this.run(lfo, t, end);
  }

  /** Several notes one after another (arpeggio). Freqs are in Hz. */
  arp(freqs: number[], step: number, voice: (f: number, at: number, i: number) => void): void {
    freqs.forEach((f, i) => voice(f, i * step, i));
  }
}

/** Frequencies for a chord built from semitone offsets above a root (Hz). */
export function chordFreqs(root: number, semis: number[]): number[] {
  return semis.map((s) => root * Math.pow(2, s / 12));
}
