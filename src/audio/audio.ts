// Audio engine: everything is synthesized at runtime with WebAudio (no audio files).
// - Sound effects are registered by name (see SFX_NAMES) as small synth functions.
// - Music tracks are registered by id as factories that start a sequencer and
//   return a handle that can be stopped (with fade-out).
// The AudioContext is created lazily on the first user gesture (browser policy).
// Synths receive a BaseAudioContext so they can also be rendered offline
// (OfflineAudioContext) for automated loudness checks (see src/audio/offline.ts).

import { routeSfxSends, warmSynth } from './synth';

export const SFX_NAMES = [
  // player / weapons
  'shoot', 'shoot_magic', 'shoot_arrow', 'swing', 'swing_heavy', 'charge', 'charge_ready',
  'dash', 'step', 'player_hurt', 'player_die', 'shield_block', 'parry', 'heal', 'power_up',
  // impacts
  'hit', 'hit_crit', 'hit_metal', 'tear_splash', 'splat',
  // enemies
  'enemy_hurt', 'enemy_die', 'enemy_die_big', 'enemy_shoot', 'enemy_charge', 'enemy_jump',
  'enemy_land', 'enemy_roar', 'enemy_spawn', 'warn', 'summon', 'slam', 'whoosh', 'orb',
  'beam_charge', 'laser', 'lightning', 'fire', 'freeze', 'poison', 'spike',
  // floor 6 (drowned archive): wet ink, fluttering paper, water surging
  'ink_splash', 'paper_flutter', 'water_surge',
  // bosses
  'boss_roar', 'boss_die', 'boss_phase',
  // world
  'explosion', 'bomb_place', 'fuse', 'rock_break', 'pot_break', 'door_open', 'door_close',
  'door_unlock', 'secret_found', 'trapdoor', 'floor_start', 'room_clear', 'teleport',
  // pickups / economy
  'coin', 'heart', 'soul_heart', 'key', 'bomb_pickup', 'chest_open', 'item_get', 'item_get_rare',
  'buy', 'no_money', 'active_use', 'active_ready', 'potion',
  // ui
  'ui_move', 'ui_select', 'ui_back', 'ui_open', 'ui_close', 'ui_error', 'ui_place',
] as const;
export type SfxName = (typeof SFX_NAMES)[number];

export const MUSIC_IDS = [
  'title', 'floor1', 'floor2', 'floor3', 'floor4', 'floor5', 'floor6', 'boss', 'boss_final',
  'shop', 'secret', 'victory', 'gameover',
] as const;
export type MusicId = (typeof MUSIC_IDS)[number];

export interface SfxPlayOpts {
  /** volume multiplier (default 1) */
  vol?: number;
  /** pitch multiplier (default 1) */
  pitch?: number;
  /** stereo pan -1..1 */
  pan?: number;
}

/**
 * A synth receives a destination node and must schedule its own nodes starting at `t`.
 * It must not keep nodes alive after it finished (see `Patch` in synth.ts).
 */
export type SfxSynth = (ctx: BaseAudioContext, out: AudioNode, t: number, o: Required<SfxPlayOpts>) => void;

export interface TrackHandle {
  /** Stop with a fade-out of `fade` seconds. Must clean up its timers. */
  stop(fade: number): void;
  /** Optional: change intensity (0..1), e.g. when enemies are present. */
  setIntensity?(v: number): void;
}
export type TrackFactory = (ctx: BaseAudioContext, out: AudioNode) => TrackHandle;

const sfxRegistry = new Map<string, SfxSynth>();
const trackRegistry = new Map<string, TrackFactory>();

export function registerSfx(name: SfxName, synth: SfxSynth): void {
  sfxRegistry.set(name, synth);
}

export function registerTrack(id: MusicId, factory: TrackFactory): void {
  trackRegistry.set(id, factory);
}

export function hasSfx(name: string): boolean {
  return sfxRegistry.has(name);
}

export function hasTrack(id: string): boolean {
  return trackRegistry.has(id);
}

/** Registered synth (for offline rendering / tests). */
export function getSfxSynth(name: string): SfxSynth | undefined {
  return sfxRegistry.get(name);
}

/** Registered track factory (for offline rendering / tests). */
export function getTrackFactory(id: string): TrackFactory | undefined {
  return trackRegistry.get(id);
}

/** Music ducking per sfx: [depth 0..1, hold seconds]. */
const duckRegistry = new Map<string, [number, number]>();

/**
 * Duck the music while an important sound plays (item jingles, deaths...),
 * so the moment reads clearly. Depth 0..1 (fraction removed), hold in seconds.
 */
export function setSfxDuck(name: SfxName, depth: number, hold: number): void {
  duckRegistry.set(name, [Math.max(0, Math.min(1, depth)), Math.max(0, hold)]);
}

/** Longest a one-shot sfx may ring (used to release per-sound panners). */
const SFX_MAX_SECONDS = 4;

class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfxBus: GainNode | null = null;
  musicBus: GainNode | null = null;
  /** separate stage after the music bus for ducking (user volume stays on musicBus) */
  private duckGain: GainNode | null = null;
  private duckUntil = 0;
  private compressor: DynamicsCompressorNode | null = null;
  private noise: AudioBuffer | null = null;

  volume = { master: 0.8, music: 0.55, sfx: 0.8 };
  muted = false;

  private lastPlayed = new Map<string, number>();
  private current: { id: string; handle: TrackHandle } | null = null;
  private pendingMusic: string | null = null;

  /** Create/resume the AudioContext. Safe to call repeatedly (call on user gestures). */
  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.15;
      this.master = this.ctx.createGain();
      this.sfxBus = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.duckGain = this.ctx.createGain();
      this.musicBus.connect(this.duckGain);
      this.duckGain.connect(this.master);
      this.master.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);
      routeSfxSends(this.ctx, this.sfxBus);
      // synth caches (noise, reverb impulse, wave tables) right after the gesture, not on a first sound mid-fight
      const ctx = this.ctx;
      setTimeout(() => {
        try {
          warmSynth(ctx);
        } catch (e) {
          console.warn('[audio] warm-up failed', e);
        }
      }, 30);
      this.applyVolumes();
      if (this.pendingMusic) {
        const id = this.pendingMusic;
        this.pendingMusic = null;
        this.playMusic(id);
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  applyVolumes(): void {
    if (!this.master || !this.sfxBus || !this.musicBus) return;
    this.master.gain.value = this.muted ? 0 : this.volume.master;
    this.sfxBus.gain.value = this.volume.sfx;
    this.musicBus.gain.value = this.volume.music;
  }

  /** Shared white-noise buffer (1s) for percussive synths. */
  noiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (!this.noise) {
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  play(name: SfxName, o: SfxPlayOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // avoid the same sound stacking dozens of times in one frame
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < 0.03) return;
    this.lastPlayed.set(name, now);
    const synth = sfxRegistry.get(name) ?? fallbackSynth;
    let out: AudioNode = this.sfxBus;
    let panner: StereoPannerNode | null = null;
    if (o.pan) {
      panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, o.pan));
      panner.connect(this.sfxBus);
      out = panner;
    }
    try {
      synth(ctx, out, now + 0.005, { vol: o.vol ?? 1, pitch: o.pitch ?? 1, pan: o.pan ?? 0 });
    } catch (e) {
      console.error(`[audio] sfx "${name}" failed`, e);
    }
    const duck = duckRegistry.get(name);
    if (duck && (o.vol ?? 1) > 0.25) this.duck(duck[0], duck[1]);
    // the synth's own nodes clean themselves up; release the shared panner too
    if (panner) {
      const p = panner;
      setTimeout(() => p.disconnect(), SFX_MAX_SECONDS * 1000);
    }
  }

  playMusic(id: string, fade = 0.8): void {
    if (this.current?.id === id) return;
    if (!this.ctx || !this.musicBus) {
      this.pendingMusic = id;
      return;
    }
    if (this.current) {
      try { this.current.handle.stop(fade); } catch (e) { console.error(e); }
      this.current = null;
    }
    const factory = trackRegistry.get(id);
    if (!factory) return;
    try {
      this.current = { id, handle: factory(this.ctx, this.musicBus) };
    } catch (e) {
      console.error(`[audio] track "${id}" failed`, e);
    }
  }

  stopMusic(fade = 0.8): void {
    this.pendingMusic = null;
    // a long (pause) duck must not outlive the music it was ducking
    this.releaseDuck();
    if (this.current) {
      try { this.current.handle.stop(fade); } catch (e) { console.error(e); }
      this.current = null;
    }
  }

  /** Temporarily lower the music (depth 0..1) for `hold` seconds, then recover. */
  duck(depth: number, hold: number): void {
    const ctx = this.ctx;
    const g = this.duckGain?.gain;
    if (!ctx || !g || depth <= 0) return;
    const now = ctx.currentTime;
    const target = 1 - depth;
    // a weaker duck never shortens / weakens a stronger one in progress
    if (now < this.duckUntil && g.value <= target + 0.01) {
      this.duckUntil = Math.max(this.duckUntil, now + hold);
    } else {
      this.duckUntil = now + hold;
    }
    if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(now);
    else {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
    }
    g.linearRampToValueAtTime(Math.min(g.value, target), now + 0.08);
    g.setValueAtTime(Math.min(g.value, target), this.duckUntil);
    g.linearRampToValueAtTime(1, this.duckUntil + 0.9);
  }

  /** End any duck in progress now; the music ramps back up over `fade` seconds. */
  releaseDuck(fade = 0.4): void {
    const ctx = this.ctx;
    const g = this.duckGain?.gain;
    if (!ctx || !g) return;
    const now = ctx.currentTime;
    if (now >= this.duckUntil && g.value >= 0.999) return;
    this.duckUntil = now;
    if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(now);
    else {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
    }
    g.linearRampToValueAtTime(1, now + fade);
  }

  setMusicIntensity(v: number): void {
    this.current?.handle.setIntensity?.(v);
  }

  get currentMusic(): string | null {
    return this.current?.id ?? null;
  }
}

/** Simple blip so that unimplemented sounds are still audible. */
const fallbackSynth: SfxSynth = (ctx, out, t, o) => {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(440 * o.pitch, t);
  osc.frequency.exponentialRampToValueAtTime(220 * o.pitch, t + 0.08);
  g.gain.setValueAtTime(0.08 * o.vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.12);
};

export const audio = new AudioEngine();

/** Shorthand used all over gameplay code. */
export function sfx(name: SfxName, o?: SfxPlayOpts): void {
  audio.play(name, o);
}
