// The floors of the descent (act 1: floors 1-5). The run is won on the deepest
// defined floor, so deeper floors (6-10) are added by defining them here or in
// their own content file, spreading `DIFFICULTY[index]` into defineFloor.

import { defineFloor, type FloorDef } from '../game/defs';

/** The per-floor difficulty knobs of a FloorDef (see DIFFICULTY). */
export type FloorDifficulty = Required<Pick<FloorDef, 'hpMult' | 'bossHpMult' | 'enemyDamage' | 'enemySpeed' | 'shotSpeed' | 'budget' | 'championChance' | 'roomCount'>>;

/**
 * Difficulty by floor (1..10): every floor is clearly harder than the one above.
 *  - hpMult / bossHpMult: enemy / boss HP = def.hp (floor-1 value) x mult. Grows
 *    ~1.3x per floor, a little ahead of a typical build with a blessing per floor
 *    (QA bot: rooms ~6-10 s, bosses ~30-45 s on floors 1-5).
 *  - enemyDamage [regular, heavy] half-hearts: floors 1-5 stay at half a heart
 *    (heavy hits a full heart); floor 6 makes heavy hits 1.5 hearts, from floor 7
 *    every hit costs a full heart, floors 9-10 heavy hits 2 hearts. Player max HP
 *    grows by ~1 heart per 2 floors, and hearts heal 2 half-hearts, so late floors
 *    trade fewer, bigger hits.
 *  - enemySpeed / shotSpeed: small, up to +13% / +18% at floor 10 (telegraph
 *    times are never scaled).
 *  - budget: enemy cost per normal room [min, max]; championChance; roomCount (map cells).
 */
export const DIFFICULTY: Record<number, FloorDifficulty> = {
  1: { hpMult: 1.3, bossHpMult: 1.6, enemyDamage: [1, 2], enemySpeed: 1.0, shotSpeed: 1.0, budget: [3, 5], championChance: 0.03, roomCount: [8, 10] },
  2: { hpMult: 1.7, bossHpMult: 2.2, enemyDamage: [1, 2], enemySpeed: 1.02, shotSpeed: 1.02, budget: [4, 6], championChance: 0.06, roomCount: [10, 12] },
  3: { hpMult: 2.3, bossHpMult: 2.9, enemyDamage: [1, 2], enemySpeed: 1.03, shotSpeed: 1.04, budget: [5, 7], championChance: 0.08, roomCount: [11, 13] },
  4: { hpMult: 3.1, bossHpMult: 3.9, enemyDamage: [1, 2], enemySpeed: 1.05, shotSpeed: 1.06, budget: [6, 8], championChance: 0.1, roomCount: [12, 14] },
  5: { hpMult: 4.1, bossHpMult: 5.0, enemyDamage: [1, 2], enemySpeed: 1.06, shotSpeed: 1.08, budget: [7, 9], championChance: 0.12, roomCount: [12, 15] },
  6: { hpMult: 5.2, bossHpMult: 6.3, enemyDamage: [1, 3], enemySpeed: 1.08, shotSpeed: 1.1, budget: [7, 10], championChance: 0.14, roomCount: [13, 15] },
  7: { hpMult: 6.4, bossHpMult: 7.7, enemyDamage: [2, 3], enemySpeed: 1.09, shotSpeed: 1.12, budget: [8, 10], championChance: 0.16, roomCount: [13, 16] },
  8: { hpMult: 7.7, bossHpMult: 9.2, enemyDamage: [2, 3], enemySpeed: 1.1, shotSpeed: 1.14, budget: [8, 11], championChance: 0.18, roomCount: [14, 16] },
  9: { hpMult: 9.1, bossHpMult: 10.8, enemyDamage: [2, 4], enemySpeed: 1.12, shotSpeed: 1.16, budget: [9, 11], championChance: 0.2, roomCount: [14, 17] },
  10: { hpMult: 10.6, bossHpMult: 12.5, enemyDamage: [2, 4], enemySpeed: 1.13, shotSpeed: 1.18, budget: [9, 12], championChance: 0.22, roomCount: [15, 17] },
};

defineFloor({
  index: 1, id: 'crypt', name: '1층 · 잊혀진 지하묘지', subtitle: '꺼져가는 등불을 들고, 아래로.',
  theme: 'crypt', music: 'floor1', ...DIFFICULTY[1],
  extraRooms: { secret: 0 },
});
defineFloor({
  index: 2, id: 'caves', name: '2층 · 포자 동굴', subtitle: '숨 쉬는 벽, 썩어가는 빛.',
  theme: 'caves', music: 'floor2', ...DIFFICULTY[2],
  extraRooms: { challenge: 0.5 },
});
defineFloor({
  index: 3, id: 'forge', name: '3층 · 잿불 대장간', subtitle: '아직 식지 않은 망치 소리.',
  theme: 'forge', music: 'floor3', ...DIFFICULTY[3],
  extraRooms: { challenge: 0.5, shrine: 0.5 },
});
defineFloor({
  index: 4, id: 'sanctum', name: '4층 · 얼어붙은 성소', subtitle: '기도는 얼음 속에 갇혔다.',
  theme: 'sanctum', music: 'floor4', ...DIFFICULTY[4],
  extraRooms: { challenge: 0.6, shrine: 0.5, curse: 0.5 },
});
defineFloor({
  index: 5, id: 'abyss', name: '5층 · 공허의 심장', subtitle: '등불이 닿지 않는 곳.',
  theme: 'abyss', music: 'floor5', ...DIFFICULTY[5],
  extraRooms: { curse: 0.7, shrine: 0.4 },
});
