import { isContentTemporarilyLocked } from './release-policy';
// State of one run that persists across floors (seed, rng streams, pools,
// identified potions, statistics).

import { RNG } from '../engine/rng';
import { Potions } from './defs';

export interface RunStats {
  kills: number;
  timeSec: number;
  damageTaken: number;
  damageDealt: number;
  roomsCleared: number;
  itemsTaken: number;
  coinsCollected: number;
  coinsSpent: number;
  activesUsed: number;
  bossesKilled: number;
  secretsFound: number;
  releases: number;
}

const POTION_COLORS = ['#e04a5a', '#4ac0e0', '#7ae04a', '#e0c04a', '#c04ae0', '#e0804a', '#4a6ae0', '#e04ab0', '#f0f0f0', '#5a5a5a', '#40e0a0', '#a0602a'];

export class RunState {
  readonly seed: string;
  readonly characterId: string;
  floor = 1;
  stage = 1;
  staged = false;
  campaign = false;
  targetFloor = 7;
  /** gameplay randomness (drops, crits, AI decisions) */
  readonly rng: RNG;
  /** loot rolls (pedestals, shops) */
  readonly lootRng: RNG;
  private readonly master: RNG;
  /** item ids the player has obtained this run */
  obtained = new Set<string>();
  /** item ids that already appeared on a pedestal (removed from pools) */
  seenOnPedestal = new Set<string>();
  /** potion ids identified this run */
  identified = new Set<string>();
  /** potion id -> flask color (shuffled per run, like Isaac pills) */
  potionColors: Record<string, string> = {};
  stats: RunStats = {
    kills: 0, timeSec: 0, damageTaken: 0, damageDealt: 0, roomsCleared: 0, itemsTaken: 0,
    coinsCollected: 0, coinsSpent: 0, activesUsed: 0, bossesKilled: 0, secretsFound: 0, releases: 0,
  };
  lastDamageSource = '';
  won = false;
  /** seeded runs don't count for unlocks */
  seeded = false;

  constructor(seed: string, characterId: string) {
    this.seed = seed;
    this.characterId = isContentTemporarilyLocked(characterId) ? 'ria' : characterId;
    this.master = new RNG(seed);
    this.rng = this.master.fork('gameplay');
    this.lootRng = this.master.fork('loot');
    const colors = this.master.fork('potions').shuffle([...POTION_COLORS]);
    Potions.all().forEach((p, i) => (this.potionColors[p.id] = colors[i % colors.length]));
  }

  /** Deterministic generator for a floor's layout. */
  floorRng(floor: number): RNG {
    return new RNG(`${this.seed}#floor${floor}${this.staged ? `#stage${this.stage}` : ''}`);
  }
}
