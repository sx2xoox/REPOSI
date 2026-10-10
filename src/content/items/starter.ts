// A few starter artifacts, an active item and a potion.

import { defineActive, defineArtifact, definePotion } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';
import { RingFx } from '../../game/effects';
import { Projectile } from '../../game/projectile';
import { amplifyShot, isMelee, proc } from './lib';
import { effectProc } from '../../game/procs';
import { LIFE_FLAME_ICON, LIFE_FLAME_PAL } from '../sprites/common';

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
  desc: '공격력이 오르고, 다섯 번째 공격마다 큰 불꽃탄이 나간다.',
  quote: '오래 타는 불이 더 뜨겁다.',
  signature: '다섯 번째 공격마다 큰 불꽃탄이 나간다',
  rarity: 'common',
  tags: ['flame'],
  icon: 'icon_wick',
  look: { shot: '#ffb040', shape: 'flame', trail: 'ember', step: '#ff9a30' },
  pools: ['treasure', 'shop'],
  stats(m, power) {
    m.addStat('damage', 1.5 * power);
  },
  onAttack(w, angle) {
    w.vars.__wickN = (w.vars.__wickN ?? 0) + 1;
    w.vars.__wickOn = w.vars.__wickN % 5 === 0 ? w.time : -1;
    if (w.vars.__wickOn < 0 || !isMelee(w)) return;
    if (!w.enemies.some((e) => e.alive && e.vulnerable && !e.hidden) || !effectProc(w, () => true)) return;
    // melee keepers throw a short flame instead
    const pl = w.player;
    const p = new Projectile({
      team: 'player', x: pl.x + Math.cos(angle) * 8, y: pl.y - 5 + Math.sin(angle) * 6, angle, speed: 210,
      damage: pl.stats.damage * 0.9, radius: 3, range: 95, owner: pl, color: '#ffb040', light: 22,
    });
    p.generation = 1;
    p.scale = 1.4;
    w.spawn(p);
    proc(w, 'long_wick', true);
  },
  onShoot(w, p) {
    if (p.generation > 0 || w.vars.__wickOn !== w.time) return;
    amplifyShot(p, 0.4);
    p.scale *= 1.45;
    p.r *= 1.25;
    p.color = '#ffd060';
    p.lightR = 26;
    proc(w, 'long_wick', true);
  },
});

// 불씨 화로 (id ember_heart): a small bronze brazier keeping the keeper's own fire
// (the life flame), i.e. one more 칸 of health; no heart shapes for health
defineDrawnSprite('icon_ember_heart', 16, 16, (p) => {
  const BR = ['#3a1a0c', '#6e3414', '#a85a24', '#d8943e', '#f8d488'];
  // three short legs under the bowl
  p.rect(3, 13, 2, 3, BR[1]);
  p.rect(11, 13, 2, 3, BR[0]);
  p.rect(7, 14, 2, 2, BR[1]);
  // the round bronze bowl: the lower half of a ball, lit from the upper left
  p.ellipse(8, 8, 7, 6.5, BR[2]);
  p.shadeSphere(7, 7.5, 7.5, 7, BR.slice(0, 4), { dither: false });
  p.rect(0, 0, 16, 9, null);
  // the mouth: a bronze lip (bright on the left) around dark glowing coals
  p.ellipse(8, 9, 7, 1.5, BR[3]);
  p.line(2, 8, 6, 8, BR[4]);
  p.px(1, 9, BR[4]);
  p.ellipse(8, 9.2, 5.6, 1, '#4a1008');
  for (const [x, c] of [[4, '#c8401c'], [6, '#ff8e34'], [9, '#ff8e34'], [11, '#c8401c']] as const) p.px(x, 9, c);
  // the keeper's fire rising from it (the life flame)
  p.stamp(4, 0, LIFE_FLAME_ICON.slice(0, 8), LIFE_FLAME_PAL);
  p.px(6, 8, LIFE_FLAME_PAL.y);
  p.px(7, 8, LIFE_FLAME_PAL.o);
  p.px(5, 8, LIFE_FLAME_PAL.o);
}, { outline: O });

defineArtifact({
  id: 'ember_heart',
  name: '불씨 화로',
  desc: '최대 체력이 늘고, 새 층마다 체력을 반 칸 회복한다.',
  quote: '작은 불씨가 심장을 데운다.',
  signature: '새 층에 도착할 때마다 체력 반 칸을 회복한다',
  rarity: 'common',
  tags: ['flame'],
  icon: 'icon_ember_heart',
  look: { mote: '#ff6a50', aura: '#ff5060' },
  pools: ['treasure', 'boss', 'shop'],
  stats(m, power) {
    m.addStat('maxHearts', power);
  },
  onFloorStart(w, power) {
    const p = w.player;
    if (p.maxRed <= 0 || p.red >= p.maxRed) return;
    p.heal(power);
    w.particles.burst(p.x, p.y - 8, { count: 12, speed: [20, 60], life: [0.4, 0.7], colors: ['#fff4d4', '#ffcf5c', '#ff8e34'], size: [1, 2], additive: true });
    proc(w, 'ember_heart');
  },
});

defineDrawnSprite('icon_quick_feather', 16, 16, (p) => {
  p.poly([2, 14, 5, 8, 9, 4, 14, 1, 13, 5, 10, 9, 6, 12], '#d8e4f8');
  p.poly([2, 14, 5, 8, 9, 4, 14, 1, 9, 7, 5, 11], '#f4f8ff');
  p.poly([8, 9, 10, 9, 13, 5, 11.5, 8.5], '#8aa8d8');
  p.line(1, 15, 13, 2, '#5a78b0');
  p.line(0, 16, 2, 14, '#5a4a3a');
  p.px(6, 11, null);
  p.px(10, 8, null);
  p.px(13, 9, '#ffe95a');
  p.px(14, 10, '#ffffff');
  p.px(15, 12, '#ffe95a');
}, { outline: O });

defineArtifact({
  id: 'quick_feather',
  name: '재빠른 깃털',
  desc: '이동·공격이 빨라지고 대시 후 첫 공격에 유도 깃털이 나간다.',
  quote: '바람보다 먼저 닿는다.',
  signature: '대시 후 첫 공격에 적을 쫓는 깃털이 나간다',
  rarity: 'common',
  tags: ['storm'],
  icon: 'icon_quick_feather',
  look: { trail: 'wind', step: '#e8f0ff', orbit: '#f4f8ff' },
  pools: ['treasure', 'shop'],
  stats(m, power) {
    m.mulStat('moveSpeed', 1 + 0.12 * power);
    m.addStat('fireRate', 0.4 * power);
  },
  onDash(w) {
    w.vars.__featherT = w.time + 1.5;
  },
  onAttack(w, angle, power) {
    if ((w.vars.__featherT ?? 0) <= w.time) return;
    if (!w.enemies.some((e) => e.alive && e.vulnerable && !e.hidden) || !effectProc(w, () => true)) return;
    w.vars.__featherT = 0;
    const pl = w.player;
    for (const da of [-0.4, 0.4]) {
      const p = new Projectile({
        team: 'player', x: pl.x + Math.cos(angle + da) * 6, y: pl.y - 6 + Math.sin(angle + da) * 4, angle: angle + da, speed: 250,
        damage: pl.stats.damage * (0.35 + 0.1 * power), radius: 2, range: 210, owner: pl, color: '#f4f8ff', homing: 3.5, light: 10, style: 'tear',
      });
      p.generation = 1;
      w.spawn(p);
    }
    w.particles.burst(pl.x, pl.y - 6, { count: 8, speed: [30, 80], life: [0.2, 0.4], colors: ['#ffffff', '#d8e4f8'], shape: 'spark', size: [1, 2] });
    proc(w, 'quick_feather');
  },
});

// The 불꽃 (flame) resonance and the other seven tags live in resonance.ts.

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
    w.clearEnemyBullets(p.x, p.y);
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
