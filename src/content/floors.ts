// The floors of the descent: act 1 (1–5) ends at the abyss heart, act 2 (6+) lies below it.

import { defineFloor } from '../game/defs';

defineFloor({
  index: 1, id: 'crypt', name: '1층 · 잊혀진 지하묘지', subtitle: '꺼져가는 등불을 들고, 아래로.',
  theme: 'crypt', music: 'floor1', roomCount: [8, 10], hpMult: 1, budget: [3, 5], championChance: 0.03,
  extraRooms: { secret: 0 },
});
defineFloor({
  index: 2, id: 'caves', name: '2층 · 포자 동굴', subtitle: '숨 쉬는 벽, 썩어가는 빛.',
  theme: 'caves', music: 'floor2', roomCount: [10, 12], hpMult: 1.3, budget: [4, 6], championChance: 0.06,
  extraRooms: { challenge: 0.5 },
});
defineFloor({
  index: 3, id: 'forge', name: '3층 · 잿불 대장간', subtitle: '아직 식지 않은 망치 소리.',
  theme: 'forge', music: 'floor3', roomCount: [11, 13], hpMult: 1.65, budget: [5, 7], championChance: 0.08,
  extraRooms: { challenge: 0.5, shrine: 0.5 },
});
defineFloor({
  index: 4, id: 'sanctum', name: '4층 · 얼어붙은 성소', subtitle: '기도는 얼음 속에 갇혔다.',
  theme: 'sanctum', music: 'floor4', roomCount: [12, 14], hpMult: 2.1, budget: [6, 8], championChance: 0.1,
  extraRooms: { challenge: 0.6, shrine: 0.5, curse: 0.5 },
});
defineFloor({
  index: 5, id: 'abyss', name: '5층 · 공허의 심장', subtitle: '등불이 닿지 않는 곳.',
  theme: 'abyss', music: 'floor5', roomCount: [12, 15], hpMult: 2.6, budget: [7, 9], championChance: 0.12,
  extraRooms: { curse: 0.7, shrine: 0.4 },
});

// ---- act 2
defineFloor({
  index: 6, id: 'archive', name: '6층 · 수몰된 서고', subtitle: '젖은 책장마다 꺼진 이름들.',
  theme: 'archive', music: 'floor6', roomCount: [12, 15],
  // difficulty: reconciled with DIFFICULTY table
  hpMult: 3.2, budget: [8, 10], championChance: 0.13,
  extraRooms: { challenge: 0.5, shrine: 0.5, curse: 0.6 },
});
