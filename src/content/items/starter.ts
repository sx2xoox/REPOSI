// A few starter artifacts, the flame resonance, an active item and a potion.

import { defineActive, defineArtifact, definePotion, defineSet } from '../../game/defs';
import { defineDrawnSprite, definePixelSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';
import { RingFx } from '../../game/effects';

const O = '#0c0810';

defineDrawnSprite('icon_wick', 16, 16, (p) => {
  p.rect(6, 6, 4, 9, '#e8e0c8');
  p.shadeVertical(6, 6, 4, 9, ramp('#e8e0c8', 3).reverse());
  p.line(8, 3, 8, 6, '#3a2a1a');
  p.ellipse(8, 3, 2, 3, '#ffb040');
  p.px(8, 2, '#fff8c0');
}, { outline: O });

defineArtifact({
  id: 'long_wick',
  name: '긴 심지',
  desc: '공격력 +2',
  quote: '오래 타는 불이 더 뜨겁다.',
  rarity: 'common',
  tags: ['flame'],
  icon: 'icon_wick',
  pools: ['treasure', 'shop'],
  stats(m, power) {
    m.addStat('damage', 2 * power);
  },
});

defineDrawnSprite('icon_ember_heart', 16, 16, (p) => {
  p.circle(5.5, 6, 3.5, '#e8283c');
  p.circle(10.5, 6, 3.5, '#e8283c');
  p.poly([2, 7, 14, 7, 8, 14], '#e8283c');
  p.shadeSphere(8, 8, 7, 7, ramp('#e8283c', 4));
  p.ellipse(8, 8, 2, 2.5, '#ffb040');
  p.px(8, 7, '#fff0a0');
}, { outline: O });

defineArtifact({
  id: 'ember_heart',
  name: '불씨 심장',
  desc: '최대 체력 +1',
  rarity: 'common',
  tags: ['flame'],
  icon: 'icon_ember_heart',
  pools: ['treasure', 'boss', 'shop'],
  stats(m, power) {
    m.addStat('maxHearts', power);
  },
});

definePixelSprite('icon_quick_feather', { w: '#e8f0ff', b: '#80a0d0', s: '#5a4a3a' }, [
  '..........ww',
  '........wwwb',
  '......wwwbb.',
  '.....wwbbb..',
  '....wwbb....',
  '...wbbb.....',
  '..wbb.......',
  '.sb.........',
  's...........',
], { outline: O });

defineArtifact({
  id: 'quick_feather',
  name: '재빠른 깃털',
  desc: '이동 속도 증가, 공격 속도 +0.4',
  rarity: 'common',
  tags: ['wind'],
  icon: 'icon_quick_feather',
  pools: ['treasure', 'shop'],
  stats(m, power) {
    m.mulStat('moveSpeed', 1 + 0.12 * power);
    m.addStat('fireRate', 0.4 * power);
  },
});

defineDrawnSprite('res_flame', 8, 8, (p) => {
  p.poly([1, 7, 7, 7, 6, 3, 4, 0, 2, 3], '#ff8a30');
  p.poly([2.5, 7, 5.5, 7, 5, 4, 4, 2, 3, 4], '#ffe080');
}, { outline: O });

defineSet({
  tag: 'flame',
  name: '불꽃',
  color: '#ff9a40',
  icon: 'res_flame',
  tiers: [
    {
      count: 2,
      desc: '공격이 20% 확률로 적을 불태운다',
      hooks: {
        onShoot(w, p) {
          if (w.rng.chance(0.2)) {
            p.statuses = [...p.statuses, { kind: 'burn', duration: 3, power: w.player.stats.damage * 0.4 }];
            p.color = '#ff8a30';
          }
        },
      },
    },
    {
      count: 4,
      desc: '불타는 적이 죽으면 폭발한다',
      hooks: {
        onKill(w, e) {
          if (e.hasStatus('burn')) w.explode(e.x, e.y, 26, w.player.stats.damage * 1.5, { hurtsPlayer: false, noTiles: true, color: '#ff7020' });
        },
      },
    },
  ],
});

// ---- active
defineDrawnSprite('icon_bell', 16, 16, (p) => {
  p.poly([4, 12, 12, 12, 11, 5, 8, 2, 5, 5], '#d8b048');
  p.shadeSphere(8, 8, 6, 6, ramp('#d8b048', 4));
  p.rect(3, 12, 10, 2, '#a07820');
  p.circle(8, 14.5, 1.5, '#5a4010');
}, { outline: O });

defineActive({
  id: 'warding_bell',
  name: '수호의 종',
  desc: '충격파로 주변 적을 밀쳐내고 적 탄환을 지운다',
  quote: '종소리가 어둠을 가른다.',
  rarity: 'common',
  icon: 'icon_bell',
  pools: ['treasure', 'shop'],
  charge: 3,
  use(w) {
    const p = w.player;
    w.sfx('slam');
    w.shake(0.4);
    w.spawn(new RingFx(p.x, p.y - 4, 80, 0.4, '#ffe080', 3));
    for (const pr of w.projectiles) if (pr.team === 'enemy') pr.expire(w, true);
    for (const e of w.enemiesInRadius(p.x, p.y, 80)) {
      const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
      w.applyHit(e, { damage: p.stats.damage * 2, kind: 'other', attacker: p, dirX: (e.x - p.x) / d, dirY: (e.y - p.y) / d, knockback: 400 });
    }
  },
});

// ---- potion
definePotion({
  id: 'potion_heal',
  name: '치유의 물약',
  desc: '체력을 모두 회복한다',
  color: '#e04a5a',
  nature: 'good',
  use(w) {
    w.player.heal(24);
    w.sfx('heal');
  },
});
