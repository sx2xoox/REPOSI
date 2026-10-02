// Potions (R). Unidentified until drunk once per run; bottle colors are shuffled
// per run by RunState, so `color` here is only the "true" liquid color.
//
// good:  영혼 / 투지 / 바람 / 네잎 / 황금 / 보급 / 불씨 / 혜안
// bad:   납빛 (slow for 45s), 끓어넘친 (explodes at your feet)
// mixed: 맹물 (nothing happens)

import { definePotion, type ItemHooks } from '../../game/defs';
import type { World } from '../../game/world';
import { Pickup, potionSpriteFor, type PickupKind } from '../../game/pickups';
import { EMBER_MAX } from '../../game/player';
import { RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { shout } from './lib';
import { revealFloorMap } from './actives';

/** Colored splash around the player when a potion is drunk. */
function gulp(w: World, colors: string[], ring?: string): void {
  const p = w.player;
  w.particles.burst(p.x, p.y - 8, { count: 18, speed: [20, 80], life: [0.3, 0.7], colors, size: [1, 2], vz: [20, 60], gravity: 120, additive: true });
  if (ring) w.spawn(new RingFx(p.x, p.y - 6, 26, 0.35, ring, 2));
}

/** Temporary stat buff tied to this potion (refreshes when drunk again). */
function potionBuff(w: World, id: string, label: string, scope: 'floor' | number, stats: ItemHooks['stats']): void {
  w.items.addBuff({
    key: id,
    hooks: { stats },
    time: scope === 'floor' ? Infinity : scope,
    until: scope === 'floor' ? 'floor' : undefined,
    label,
    icon: potionSpriteFor(w, id),
  });
}

function popPickups(w: World, kinds: PickupKind[]): void {
  const p = w.player;
  kinds.forEach((k, i) => {
    const a = (i / kinds.length) * Math.PI * 2 + fx.range(-0.3, 0.3);
    w.spawn(new Pickup(k, p.x, p.y).pop(a, fx.range(50, 90)));
  });
}

definePotion({
  id: 'potion_soul',
  name: '영혼의 물약',
  desc: '영혼 하트 +1',
  color: '#8ab0ff',
  nature: 'good',
  use(w) {
    w.player.addSoul(2);
    w.sfx('soul_heart');
    gulp(w, ['#ffffff', '#c8d8ff', '#8ab0ff'], '#8ab0ff');
  },
});

definePotion({
  id: 'potion_might',
  name: '투지의 물약',
  desc: '이번 층 동안 공격력 +2, 공격력 x1.15',
  color: '#ff6a40',
  nature: 'good',
  use(w) {
    potionBuff(w, 'potion_might', '투지', 'floor', (m) => {
      m.addStat('damage', 2);
      m.mulStat('damage', 1.15);
    });
    w.sfx('power_up');
    gulp(w, ['#ffffff', '#ffb080', '#ff6a40'], '#ff8a50');
    shout(w, '공격력 상승', '#ff8a50');
  },
});

definePotion({
  id: 'potion_swift',
  name: '바람의 물약',
  desc: '이번 층 동안 이동 속도 +18%, 공격 속도 +0.4',
  color: '#a0f0e0',
  nature: 'good',
  use(w) {
    potionBuff(w, 'potion_swift', '바람', 'floor', (m) => {
      m.mulStat('moveSpeed', 1.18);
      m.addStat('fireRate', 0.4);
    });
    w.sfx('power_up', { pitch: 1.3 });
    w.sfx('whoosh', { vol: 0.5 });
    gulp(w, ['#ffffff', '#d0fff4', '#70e0c8'], '#a0f0e0');
    shout(w, '몸이 가볍다', '#a0f0e0');
  },
});

definePotion({
  id: 'potion_sluggish',
  name: '납빛 물약',
  desc: '45초 동안 이동 속도 -25%, 공격 속도 -0.4',
  color: '#7a7a88',
  nature: 'bad',
  use(w) {
    potionBuff(w, 'potion_sluggish', '둔화', 45, (m) => {
      m.mulStat('moveSpeed', 0.75);
      m.addStat('fireRate', -0.4);
    });
    w.sfx('poison', { pitch: 0.7 });
    gulp(w, ['#a0a0b0', '#6a6a78', '#3a3a48']);
    shout(w, '몸이 무겁다...', '#a0a0b0');
  },
});

definePotion({
  id: 'potion_luck',
  name: '네잎 물약',
  desc: '이번 층 동안 행운 +2',
  color: '#60e070',
  nature: 'good',
  use(w) {
    potionBuff(w, 'potion_luck', '행운', 'floor', (m) => {
      m.addStat('luck', 2);
    });
    w.sfx('power_up', { pitch: 1.2 });
    w.sfx('coin', { vol: 0.5, pitch: 1.4 });
    gulp(w, ['#ffffff', '#c0ffb0', '#60e070'], '#60e070');
    shout(w, '운이 트인다', '#80f080');
  },
});

definePotion({
  id: 'potion_boil',
  name: '끓어넘친 물약',
  desc: '발밑에서 폭발한다! (체력 반 칸 피해)',
  color: '#ff4a20',
  nature: 'bad',
  use(w) {
    const p = w.player;
    w.explode(p.x, p.y, 34, 30 + p.stats.damage * 2, { hurtsPlayer: false, color: '#ff6a30' });
    p.hurt(w, 1, '끓어넘친 물약');
  },
});

definePotion({
  id: 'potion_gold',
  name: '황금빛 물약',
  desc: '동전이 쏟아져 나온다',
  color: '#ffd040',
  nature: 'good',
  use(w) {
    const n = w.rng.int(5, 8);
    const kinds: PickupKind[] = [];
    for (let i = 0; i < n; i++) kinds.push('coin');
    if (w.rng.chance(0.25 + w.player.stats.luck * 0.03)) kinds.push('nickel');
    popPickups(w, kinds);
    w.sfx('coin');
    w.sfx('chest_open', { vol: 0.5, pitch: 1.3 });
    gulp(w, ['#ffffff', '#fff0a0', '#ffd040'], '#ffd040');
  },
});

definePotion({
  id: 'potion_supply',
  name: '보급 물약',
  desc: '폭탄 2개와 열쇠 1개가 튀어나온다',
  color: '#c08050',
  nature: 'good',
  use(w) {
    popPickups(w, ['bomb2', 'key']);
    w.sfx('bomb_pickup', { vol: 0.6 });
    gulp(w, ['#ffffff', '#e0c0a0', '#c08050'], '#e0b080');
  },
});

definePotion({
  id: 'potion_ember',
  name: '불씨 물약',
  desc: '불씨 게이지를 가득 채운다',
  color: '#ff9a30',
  nature: 'good',
  use(w) {
    const p = w.player;
    p.ember = EMBER_MAX;
    p.emberReadyFlash = 1;
    w.sfx('fire', { vol: 0.7 });
    w.lights.glow(p.x, p.y - 6, 60, '#ffa040', 0.7);
    gulp(w, ['#ffffff', '#fff0a0', '#ffb040', '#ff6020'], '#ffb040');
    shout(w, '불씨 가득!', '#ffb040');
  },
});

definePotion({
  id: 'potion_water',
  name: '맹물',
  desc: '아무 일도 일어나지 않았다',
  color: '#d8e8f0',
  nature: 'mixed',
  use(w) {
    w.sfx('tear_splash', { vol: 0.6 });
    gulp(w, ['#ffffff', '#d8e8f0', '#a0c0d8']);
    shout(w, '...', '#c0d0e0');
  },
});

definePotion({
  id: 'potion_sight',
  name: '혜안의 물약',
  desc: '이 층의 지도와 비밀방이 드러난다',
  color: '#c070ff',
  nature: 'good',
  use(w) {
    gulp(w, ['#ffffff', '#e0c0ff', '#c070ff'], '#c070ff');
    if (!revealFloorMap(w)) shout(w, '이미 다 아는 길이다', '#e0c0ff');
  },
});
