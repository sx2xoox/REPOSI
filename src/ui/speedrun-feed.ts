// What the HUD hears when a speedrun floor boss falls (UI-only data; never read by the
// simulation). GameScene creates one notice per split and fills in the online answer later.

export interface SplitNotice {
  floor: number;
  /** clear time of floors 1..floor (ms) */
  splitMs: number;
  /** this floor's boss fight (ms) */
  bossMs: number;
  bossId: string;
  /** counts for the ranking (false: a debug / god-mode run, shown as practice) */
  ranked: boolean;
  /** place among this device's records of the floor */
  localRank: number;
  personalBest: boolean;
  previousBestMs?: number;
  /** online board: 'off' (no server / not sent), 'pending', 'ok' (rank known), 'fail' */
  online: 'off' | 'pending' | 'ok' | 'fail';
  onlineRank?: number;
}
