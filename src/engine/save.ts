// Persistent settings + meta progression in localStorage (fails gracefully).
import { normalizeStage } from '../game/stage-plan';
import { normalizeItemId } from '../game/legacy-ids';
import { speedrunStore } from './speedrun-store';

export interface Settings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  screenShake: number; // 0..1.5
  teammateProjectileOpacity?: number; // 0..1, local display only
  screenFlash?: number; // 0..1; optional for older saves
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
  /** touch attack scheme: auto-aim attack button (default) / twin sticks */
  touchScheme: TouchSchemeSetting;
  /**
   * 최대 프레임: frame-rate cap (60 / 120 / 0 = display max). Unset = automatic
   * (120, or 60 at graphics quality 낮음); see `effectiveMaxFps`.
   */
  maxFps?: FrameCap;
  /** online co-op nickname (set on the first visit to 함께하기) */
  nickname?: string;
}

export type GraphicsQuality = 'high' | 'medium' | 'low';
export type TouchControlsMode = 'auto' | 'on' | 'off';
export type TouchSchemeSetting = 'auto' | 'twin';
/** frame-rate cap in fps; 0 = draw at the display's own rate */
export type FrameCap = 60 | 120 | 0;
export const FRAME_CAPS: FrameCap[] = [60, 120, 0];

/** The frame-rate cap in effect: the chosen one, else 120 (60 at graphics quality 낮음). */
export function effectiveMaxFps(s: Pick<Settings, 'maxFps' | 'graphicsQuality'>): FrameCap {
  const v = s.maxFps;
  if (v === 60 || v === 120 || v === 0) return v;
  return s.graphicsQuality === 'low' ? 60 : 120;
}

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
  campaign?: CampaignProgress;
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

export interface CampaignProgress {
  seen: string[];
  cleared: number;
  pending: number;
  character: string;
  checkpoint?: import('../game/checkpoint').Checkpoint;
}
export interface SaveSlot { name: string; created: string; progress: Progress; history: RunRecord[] }
const KEY_SLOTS = 'lanternkeeper.slots.v1';
export function newCampaign(): CampaignProgress { return { seen: [], cleared: 0, pending: 0, character: 'ria' }; }

export interface RunRecord {
  date: string;
  character: string;
  seed: string;
  floor: number;
  won: boolean;
  timeSec: number;
  kills: number;
  killedBy?: string;
  /** a speedrun-mode run */
  speedrun?: boolean;
}

const KEY_SETTINGS = 'lanternkeeper.settings.v1';
const KEY_PROGRESS = 'lanternkeeper.progress.v1';
const KEY_HISTORY = 'lanternkeeper.history.v1';

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  musicVolume: 0.55,
  sfxVolume: 0.8,
  screenShake: 1,
  teammateProjectileOpacity: 0.5,
  pixelPerfect: false,
  damageNumbers: true,
  particles: 1,
  showFps: false,
  hitStop: true,
  graphicsQuality: isTouchDevice() ? 'medium' : 'high',
  touchControls: 'auto',
  touchScheme: 'auto',
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

/** Old saves: renamed item ids in the collection's seen list (in place; deduplicated). */
export function migrateProgress(p: Progress): Progress {
  if (Array.isArray(p.seenItems)) p.seenItems = [...new Set(p.seenItems.map(normalizeItemId))];
  return p;
}

export const save = {
  activeSlot: -1,
  slots: (() => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY_SLOTS) : null;
      if (!raw) return Array<SaveSlot | null>(4).fill(null);
      const parsed = JSON.parse(raw);
      return Array.from({ length: 4 }, (_, i) => parsed[i]?.progress && Array.isArray(parsed[i].history) ? parsed[i] as SaveSlot : null);
    } catch { return Array<SaveSlot | null>(4).fill(null); }
  })(),
  settings: read<Settings>(KEY_SETTINGS, DEFAULT_SETTINGS),
  progress: migrateProgress(read<Progress>(KEY_PROGRESS, DEFAULT_PROGRESS)),
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
    if (this.activeSlot >= 0 && this.slots[this.activeSlot]) {
      this.slots[this.activeSlot]!.progress = this.progress;
      this.slots[this.activeSlot]!.history = this.history;
      write(KEY_SLOTS, this.slots);
    } else write(KEY_PROGRESS, this.progress);
  },
  abandonExpedition(): void {
    if (!this.progress.campaign?.checkpoint) return;
    delete this.progress.campaign.checkpoint;
    this.saveProgress();
  },
  openSlot(index: number, name?: string): void {
    if (index < 0 || index >= 4) throw new Error('invalid save slot');
    // Preserve pre-slot progress in slot one; never overwrite the legacy keys.
    if (this.activeSlot >= 0) this.saveProgress();
    if (!this.slots[index]) {
      const old = read<Progress>(KEY_PROGRESS, DEFAULT_PROGRESS);
      const progress = index === 0 && (old.runs > 0 || old.flags.length > 0) ? old : structuredClone(DEFAULT_PROGRESS);
      progress.campaign = newCampaign();
      let history: RunRecord[] = [];
      if (index === 0) {
        try { const rows = typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem(KEY_HISTORY) ?? '[]') : []; if (Array.isArray(rows)) history = rows; } catch { /* preserve progress even when the old history is malformed */ }
      }
      this.slots[index] = { name: name?.trim().slice(0, 16) || `등불 ${index + 1}`, created: new Date().toISOString(), progress, history };
    }
    this.activeSlot = index;
    this.progress = migrateProgress(this.slots[index]!.progress);
    this.history = this.slots[index]!.history;
    this.progress.campaign ??= newCampaign();
    const checkpoint = this.progress.campaign.checkpoint;
    if (checkpoint) checkpoint.stage = normalizeStage(checkpoint.stage);
    this.saveProgress();
  },
  addRun(rec: RunRecord): void {
    this.history.unshift(rec);
    if (this.history.length > 30) this.history.length = 30;
    if (this.activeSlot >= 0) this.saveProgress();
    else write(KEY_HISTORY, this.history);
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
    this.slots = Array<SaveSlot | null>(4).fill(null);
    this.activeSlot = -1;
    write(KEY_SLOTS, this.slots);
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.progress = structuredClone(DEFAULT_PROGRESS);
    this.history = [];
    this.saveSettings();
    this.saveProgress();
    write(KEY_HISTORY, []);
    // this device's speedrun records too (the online board keeps what it already received)
    speedrunStore.clear();
  },
};
