// 랭킹: speedrun ranking screen (placeholder; see the full implementation).
import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';

export interface RankingOptions {
  /** floor tab to open (1..last floor) */
  floor?: number;
  /** highlight this device's run (just finished) */
  highlightRun?: string;
  /** keep the scene below updating (title backdrop); false over the game-over screen */
  passUpdate?: boolean;
}

export class RankingScene implements Scene {
  transparent = true;
  passUpdate: boolean;
  constructor(readonly o: RankingOptions = {}) {
    this.passUpdate = o.passUpdate ?? true;
  }
  update(_dt: number): void {}
  draw(_r: Renderer): void {}
}
