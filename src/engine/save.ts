// Persistent settings + meta progression in localStorage (fails gracefully).

export interface Settings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  screenShake: number; // 0..1.5
  pixelPerfect: boolean;
  damageNumbers: boolean;
  particles: number; // 0.25..1
  showFps: boolean;
  /** brief freeze frames on heavy hits */
  hitStop: boolean;
  /** graphics preset: resolution cap, particle density, lighting (mobile perf) */
  graphicsQuality: GraphicsQuality;
  /** on-screen touch controls: auto (shown while touch is used) / always / never */
  touchControls: TouchControlsMode;
}

export type GraphicsQuality = 'high' | 'medium' | 'low';
export type TouchControlsMode = 'auto' | 'on' | 'off';

/** Coarse primary pointer (phones / tablets)? Safe outside the browser. */
export function isTouchDevice(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) return true;
    return typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0 && !window.matchMedia?.('(pointer: fine)').matches;
  } catch {
    return false;
  }
}

export interface Progress {
  unlockedCharacters: string[];
  /** artifact / active / weapon ids ever picked up (collection page) */
  seenItems: string[];
  /** enemy ids ever killed (bestiary) */
  seenEnemies: string[];
  runs: number;
  wins: number;
  deaths: number;
  bestFloor: number;
  bestTimeSec: number; // fastest win, 0 = none
  totalKills: number;
  /** achievements / unlock flags */
  flags: string[];
}

export interface RunRecord {
  date: string;
  character: string;
  seed: string;
  floor: number;
  won: boolean;
  timeSec: number;
  kills: number;
  killedBy?: string;
}

const KEY_SETTINGS = 'lanternkeeper.settings.v1';
const KEY_PROGRESS = 'lanternkeeper.progress.v1';
const KEY_HISTORY = 'lanternkeeper.history.v1';

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  musicVolume: 0.55,
  sfxVolume: 0.8,
  screenShake: 1,
  pixelPerfect: false,
  damageNumbers: true,
  particles: 1,
  showFps: false,
  hitStop: true,
  graphicsQuality: isTouchDevice() ? 'medium' : 'high',
  touchControls: 'auto',
};

export const DEFAULT_PROGRESS: Progress = {
  unlockedCharacters: [],
  seenItems: [],
  seenEnemies: [],
  runs: 0,
  wins: 0,
  deaths: 0,
  bestFloor: 0,
  bestTimeSec: 0,
  totalKills: 0,
  flags: [],
};

function read<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return structuredClone(fallback);
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(fallback);
    return { ...structuredClone(fallback), ...JSON.parse(raw) };
  } catch {
    return structuredClone(fallback);
  }
}

function write(key: string, value: unknown): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full / disabled — ignore
  }
}

export const save = {
  settings: read<Settings>(KEY_SETTINGS, DEFAULT_SETTINGS),
  progress: read<Progress>(KEY_PROGRESS, DEFAULT_PROGRESS),
  history: (() => {
    try {
      if (typeof localStorage === 'undefined') return [] as RunRecord[];
      const raw = localStorage.getItem(KEY_HISTORY);
      return raw ? (JSON.parse(raw) as RunRecord[]) : [];
    } catch {
      return [] as RunRecord[];
    }
  })(),

  saveSettings(): void {
    write(KEY_SETTINGS, this.settings);
  },
  saveProgress(): void {
    write(KEY_PROGRESS, this.progress);
  },
  addRun(rec: RunRecord): void {
    this.history.unshift(rec);
    if (this.history.length > 30) this.history.length = 30;
    write(KEY_HISTORY, this.history);
  },
  markSeenItem(id: string): void {
    if (!this.progress.seenItems.includes(id)) {
      this.progress.seenItems.push(id);
      this.saveProgress();
    }
  },
  markSeenEnemy(id: string): void {
    if (!this.progress.seenEnemies.includes(id)) {
      this.progress.seenEnemies.push(id);
      this.saveProgress();
    }
  },
  hasFlag(f: string): boolean {
    return this.progress.flags.includes(f);
  },
  setFlag(f: string): void {
    if (!this.progress.flags.includes(f)) {
      this.progress.flags.push(f);
      this.saveProgress();
    }
  },
  resetAll(): void {
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.progress = structuredClone(DEFAULT_PROGRESS);
    this.history = [];
    this.saveSettings();
    this.saveProgress();
    write(KEY_HISTORY, []);
  },
};
