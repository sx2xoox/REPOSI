// Exposes `window.__lkAudio` for automated audio checks (Playwright) and the
// browser console: live node/timer counters, offline renders + loudness stats.
//   await __lkAudio.renderSfx('explosion')        -> { buffer, stats }
//   await __lkAudio.renderTrack('floor1', 20)      -> { calm, combat, all }
//   __lkAudio.stats()                              -> live patches / nodes / timers

import { audio, MUSIC_IDS, SFX_NAMES, sfx } from '../../audio/audio';
import { analyze, renderSfx, renderTrack } from '../../audio/offline';
import { songStats } from '../../audio/song';
import { audioStats } from '../../audio/synth';

if (typeof window !== 'undefined') {
  (window as unknown as { __lkAudio: unknown }).__lkAudio = {
    audio,
    sfx,
    SFX_NAMES,
    MUSIC_IDS,
    analyze,
    renderSfx,
    renderTrack,
    stats: () => ({
      ...audioStats,
      ...songStats,
      music: audio.currentMusic,
      state: audio.ctx?.state ?? 'none',
    }),
  };
}
