// Offline rendering + loudness analysis of sfx and tracks (OfflineAudioContext).
// Used by automated checks (Playwright) via window.__lkAudio; never by gameplay.

import { getSfxSynth, getTrackFactory, type SfxPlayOpts } from './audio';

export interface RenderStats {
  name: string;
  /** seconds until the signal falls below -60 dBFS for good */
  duration: number;
  peak: number;
  /** RMS over the audible part */
  rms: number;
  /** samples at or above full scale */
  clipped: number;
  /** DC offset (mean) — should be ~0 */
  dc: number;
}

export function analyze(name: string, buf: AudioBuffer, from = 0, to = buf.length): RenderStats {
  let peak = 0;
  let last = 0;
  let clipped = 0;
  let sum = 0;
  let sumSq = 0;
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  for (const d of chans) {
    for (let i = from; i < to; i++) {
      const v = d[i];
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (a > 0.001 && i > last) last = i;
      if (a >= 1) clipped++;
      sum += v;
    }
  }
  const end = Math.max(from + 1, last + 1);
  for (const d of chans) for (let i = from; i < end; i++) sumSq += d[i] * d[i];
  const n = (end - from) * chans.length;
  return {
    name,
    duration: (end - from) / buf.sampleRate,
    peak,
    rms: Math.sqrt(sumSq / Math.max(1, n)),
    clipped,
    dc: sum / Math.max(1, (to - from) * chans.length),
  };
}

export async function renderSfx(name: string, opts: SfxPlayOpts = {}, seconds = 4, sampleRate = 44100): Promise<{ buffer: AudioBuffer; stats: RenderStats }> {
  const synth = getSfxSynth(name);
  if (!synth) throw new Error(`no sfx "${name}"`);
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  synth(ctx, ctx.destination, 0.005, { vol: opts.vol ?? 1, pitch: opts.pitch ?? 1, pan: opts.pan ?? 0 });
  const buffer = await ctx.startRendering();
  return { buffer, stats: analyze(name, buffer) };
}

/**
 * Render `seconds` of a track. Intensity is `calm` for the first half and
 * `combat` for the second half (so both mixes can be measured).
 */
export async function renderTrack(
  id: string,
  seconds = 20,
  calm = 0,
  combat = 1,
  sampleRate = 44100,
): Promise<{ buffer: AudioBuffer; calm: RenderStats; combat: RenderStats; all: RenderStats }> {
  const factory = getTrackFactory(id);
  if (!factory) throw new Error(`no track "${id}"`);
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const handle = factory(ctx, ctx.destination);
  handle.setIntensity?.(calm);
  const half = Math.floor((seconds / 2) * 4) / 4;
  void ctx.suspend(half).then(() => {
    handle.setIntensity?.(combat);
    void ctx.resume();
  });
  const buffer = await ctx.startRendering();
  handle.stop(0);
  const mid = Math.floor(half * sampleRate);
  return {
    buffer,
    calm: analyze(`${id}:calm`, buffer, 0, mid),
    combat: analyze(`${id}:combat`, buffer, mid + Math.floor(sampleRate * 1.5), buffer.length),
    all: analyze(id, buffer),
  };
}
