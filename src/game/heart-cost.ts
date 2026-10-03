import type { Player } from './player';
import type { World } from './world';

/** Heart prices spend containers first, leaving at least one; otherwise full soul hearts. */
export function heartCostKind(p: Player, hearts: number): 'max' | 'soul' | null {
  if (p.maxRed >= hearts * 2 + 2) return 'max';
  if (p.soul >= hearts * 2) return 'soul';
  return null;
}

export function heartCostText(p: Player, hearts: number): string {
  return heartCostKind(p, hearts) === 'soul' ? `영혼 하트 ${hearts}칸 소모`
    : `최대 빨간 체력 ${hearts}칸 감소 (이번 도전)`;
}

export function payHeartCost(w: World, hearts: number): boolean {
  const p = w.player;
  const kind = heartCostKind(p, hearts);
  if (!kind) return false;
  if (kind === 'soul') p.soul -= hearts * 2;
  else {
    p.vars.__heartContainersSpent = (p.vars.__heartContainersSpent ?? 0) + hearts;
    w.items.recomputeStats();
  }
  return true;
}
