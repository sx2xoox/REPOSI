// 그림자 (shadow) artifacts: dodges, dashes, fear and a mimicking shadow twin.

import { defineArtifact } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';
import { fx } from '../../engine/rng';
import { O, addHitStatus, cooldown, enemiesNear, familiarsOf, isAttack, isMelee, itemHit, roll, stackMul, syncFamiliars } from './lib';
import { TwinShadow } from './familiars';

const dmg = (w: { player: { stats: { damage: number } } }) => w.player.stats.damage;
const VIO = ['#1a0c38', '#3a1a70', '#6a3ad0', '#9a6aff', '#d0b8ff'];

// ------------------------------------------------------------------ 연기 베일
defineDrawnSprite('icon_smoke_veil', 16, 16, (p) => {
  p.poly([3, 2, 13, 2, 14, 10, 12, 13, 10, 11, 8, 14, 6, 11, 4, 13, 2, 10], '#8a80a0');
  p.shadeSphere(7, 5, 9, 10, ['#4a4060', '#6a6080', '#8a80a0', '#b8b0cc']);
  p.line(5, 3, 4, 11, '#5a5070');
  p.line(9, 3, 9, 12, '#5a5070');
  p.line(12, 3, 12.5, 10, '#5a5070');
  p.rect(3, 1, 10, 2, '#c8c0dc');
  p.circle(2, 14, 1.4, '#a8a0c0');
  p.circle(14.5, 14, 1.1, '#a8a0c0');
  p.px(0, 12, '#c8c0dc');
  p.px(15, 11, '#c8c0dc');
  p.px(4, 2, '#ffffff');
}, { outline: O });

defineArtifact({
  id: 'smoke_veil',
  name: '연기 베일',
  desc: '8% 확률로 피해를 회피한다',
  quote: '보이지 않으면 맞지도 않는다.',
  rarity: 'common',
  tags: ['shadow'],
  icon: 'icon_smoke_veil',
  pools: ['treasure', 'shop'],
  stats(m, power) {
    m.addStat('dodge', 0.08 * power);
  },
});

// ------------------------------------------------------------------ 밤의 덧신
defineDrawnSprite('icon_night_slippers', 16, 16, (p) => {
  p.ellipse(5, 10, 4, 2.6, '#2a3a7a');
  p.ellipse(11, 12, 4, 2.6, '#2a3a7a');
  p.ellipse(4, 9.5, 2.6, 1.6, '#3a4a9a');
  p.ellipse(10, 11.5, 2.6, 1.6, '#3a4a9a');
  p.line(1, 11, 8, 11, '#141a40');
  p.line(7, 13, 14, 13, '#141a40');
  p.ellipse(6.5, 9, 1.4, 1, '#0c1028');
  p.ellipse(12.5, 11, 1.4, 1, '#0c1028');
  p.circle(8, 3.5, 2.6, '#ffe880');
  p.circle(9.3, 2.6, 2.2, null);
  p.px(12, 2, '#ffffff');
  p.px(3, 4, '#d8c8ff');
  p.px(2, 7, '#5a6ad8');
  p.px(14, 8, '#5a6ad8');
}, { outline: O });

defineArtifact({
  id: 'night_slippers',
  name: '밤의 덧신',
  desc: '대시 쿨다운 -25%, 이동 속도 +5%',
  quote: '발소리조차 잠들었다.',
  rarity: 'common',
  tags: ['shadow'],
  icon: 'icon_night_slippers',
  pools: ['treasure', 'shop', 'boss'],
  stats(m, power) {
    m.mulStat('dashCooldown', Math.pow(0.75, power));
    m.mulStat('moveSpeed', 1 + 0.05 * power);
  },
});

// ------------------------------------------------------------------ 검은 초
defineDrawnSprite('icon_black_candle', 16, 16, (p) => {
  p.rect(5, 7, 6, 8, '#2a2030');
  p.shadeVertical(5, 7, 6, 8, ['#141018', '#2a2030', '#3e3448']);
  p.ellipse(8, 7, 3, 1.2, '#4a4058');
  p.px(5, 8, '#4a4058');
  p.px(5, 9, '#4a4058');
  p.px(10, 8, '#3e3448');
  p.px(10, 9, '#3e3448');
  p.px(10, 10, '#3e3448');
  p.rect(3, 14, 10, 2, '#5a4a3a');
  p.line(3, 14, 12, 14, '#8a7050');
  p.line(8, 4, 8, 6, '#1a1010');
  p.ellipse(8, 2.6, 1.8, 2.8, '#9a6aff');
  p.ellipse(8, 3.2, 0.9, 1.6, '#e0d0ff');
  p.px(8, 0, '#6a3ad0');
  p.px(11, 2, '#6a3ad0');
  p.px(4, 3, '#6a3ad0');
}, { outline: O });

defineArtifact({
  id: 'black_candle',
  name: '검은 초',
  desc: '공격력 +1.5, 행운 -1',
  quote: '어둠을 태우는 불도 있다.',
  rarity: 'common',
  tags: ['shadow', 'flame'],
  icon: 'icon_black_candle',
  pools: ['curse', 'shop', 'treasure'],
  stats(m, power) {
    m.addStat('damage', 1.5 * power);
    m.addStat('luck', -power);
  },
});

// ------------------------------------------------------------------ 등 뒤의 눈
defineDrawnSprite('icon_rear_eye', 16, 16, (p) => {
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * 0.15 + (i / 10) * Math.PI * 1.25;
    p.px(8 + Math.cos(a) * 7, 8 - Math.sin(a) * 6.5, VIO[3]);
    p.px(8 + Math.cos(a) * 6.2, 8 - Math.sin(a) * 5.8, VIO[2]);
  }
  p.poly([12.5, 10, 15.5, 9, 14.5, 13], VIO[3]);
  p.ellipse(8, 8, 5, 3.4, '#f4f0ff');
  p.shadeSphere(8, 8, 5, 3.4, ['#a8a0c0', '#d8d0e8', '#f4f0ff', '#ffffff'], { dither: false });
  p.circle(5.5, 8, 2.2, VIO[2]);
  p.circle(5.2, 8, 1.1, '#140828');
  p.px(6, 7, '#ffffff');
  p.line(3, 5, 12, 5, '#3a2a50');
  p.line(4, 11, 11, 11, '#5a4a70');
}, { outline: O });

defineArtifact({
  id: 'rear_eye',
  name: '등 뒤의 눈',
  desc: '공격할 때 등 뒤로도 약한 공격이 나간다',
  quote: '등 뒤에도 눈이 있다.',
  rarity: 'common',
  tags: ['shadow'],
  icon: 'icon_rear_eye',
  pools: ['treasure', 'shop'],
  onAttack(w, angle, power) {
    if (!cooldown(w, 'rear_eye', 0.12)) return;
    const p = w.player;
    const back = angle + Math.PI;
    if (isMelee(w)) {
      p.swing(w, { angle: back, damage: dmg(w) * 0.6, arc: 1.8, color: '#b08aff' });
    } else {
      for (const pr of p.fireProjectiles(w, back, { count: power, damageMult: 0.7, spreadMult: 1.2 })) pr.color = '#c0a0ff';
    }
  },
});

// ------------------------------------------------------------------ 그림자 단검
defineDrawnSprite('icon_shade_dagger', 16, 16, (p) => {
  p.poly([6, 9, 13, 1, 15, 0, 14, 3, 8, 11], VIO[2]);
  p.poly([6, 9, 13, 1, 15, 0, 9.5, 8.5], VIO[3]);
  p.line(7, 9, 14, 1, VIO[4]);
  p.line(3, 8, 9, 13, '#a8a0b8');
  p.line(4, 8, 9, 12, '#d8d0e8');
  p.line(1, 15, 6, 10, '#3a2a40');
  p.line(2, 15, 6, 11, '#5a4a60');
  p.circle(1.5, 14.5, 1.3, VIO[3]);
  p.px(13, 6, VIO[4]);
  p.px(11, 9, VIO[3]);
}, { outline: '#0c0418' });

defineArtifact({
  id: 'shade_dagger',
  name: '그림자 단검',
  desc: '대시로 적을 통과하면 큰 피해를 주고 출혈시킨다',
  quote: '그림자는 등 뒤에서 찌른다.',
  rarity: 'rare',
  tags: ['shadow', 'blood'],
  icon: 'icon_shade_dagger',
  pools: ['treasure', 'challenge'],
  onDash(w) {
    w.vars.__dagT = w.time + w.player.stats.dashTime + 0.06;
    w.vars.__dagId = (w.vars.__dagId ?? 0) + 1;
  },
  onUpdate(w, _dt, power) {
    if ((w.vars.__dagT ?? 0) < w.time) return;
    const p = w.player;
    const tag = `__dag${w.vars.__dagId}`;
    for (const e of enemiesNear(w, p.x, p.y, p.r + 7)) {
      if (e.mem[tag]) continue;
      e.mem[tag] = 1;
      itemHit(w, e, dmg(w) * 2.5 * stackMul(power), { knockback: 120, statuses: [{ kind: 'bleed', duration: 3, power: dmg(w) * 0.3 }] });
      w.sfx('swing_heavy', { vol: 0.5, pitch: 1.3 });
      w.particles.burst(e.x, e.y - 5, { count: 14, speed: [60, 160], angle: Math.atan2(p.dashDY, p.dashDX), spread: 0.8, life: [0.15, 0.35], colors: ['#ffffff', VIO[4], VIO[3], VIO[1]], shape: 'spark', size: [1, 2] });
    }
  },
});

// ------------------------------------------------------------------ 텅 빈 가면
defineDrawnSprite('icon_hollow_mask', 16, 16, (p) => {
  p.ellipse(8, 8, 6, 7, '#ece4d8');
  p.shadeSphere(8, 7, 6.5, 7, ramp('#e8e0d4', 4), { dither: false });
  p.ellipse(5.5, 7, 1.7, 2.2, '#0c0610');
  p.ellipse(10.5, 7, 1.7, 2.2, '#0c0610');
  p.px(5, 8, VIO[3]);
  p.px(10, 8, VIO[3]);
  p.line(6, 12, 10, 12, '#5a4a50');
  p.px(7, 13, '#5a4a50');
  p.px(9, 13, '#5a4a50');
  p.line(9, 1, 8, 3, '#7a6a68');
  p.line(8, 3, 9, 5, '#7a6a68');
  p.px(3, 4, '#ffffff');
  p.px(4, 3, '#ffffff');
}, { outline: O });

defineArtifact({
  id: 'hollow_mask',
  name: '텅 빈 가면',
  desc: '공격이 10% 확률로 적을 공포에 빠뜨린다. 겁먹은 적에게 피해 +25%',
  quote: '가면 뒤엔 아무도 없다. 그래서 무섭다.',
  rarity: 'rare',
  tags: ['shadow'],
  icon: 'icon_hollow_mask',
  pools: ['treasure', 'curse'],
  modifyHit(w, t, hit, power) {
    if (t.hasStatus('fear')) hit.damage *= 1.25;
    else if (isAttack(hit) && roll(w, 0.1, power)) addHitStatus(w, t, hit, { kind: 'fear', duration: 2.5 });
  },
});

// ------------------------------------------------------------------ 쌍둥이 그림자
defineDrawnSprite('icon_twin_shadow', 16, 16, (p) => {
  const fig = (ox: number, body: string, hood: string, eye: string) => {
    p.poly([ox + 1, 15, ox + 2.5, 8, ox + 7.5, 8, ox + 9, 15], body);
    p.ellipse(ox + 5, 5.5, 3.6, 3.4, hood);
    p.px(ox + 4, 6, eye);
    p.px(ox + 6, 6, eye);
  };
  fig(6, VIO[2], VIO[3], VIO[4]);
  fig(0, '#2f5866', '#3a6c78', '#1a1420');
  p.ellipse(5, 6, 2.2, 1.6, '#f2d6c0');
  p.px(4, 6, '#1a1420');
  p.px(6, 6, '#1a1420');
  p.rect(2, 8, 6, 1, '#d8503a');
  p.px(12, 2, VIO[4]);
}, { outline: O });

defineArtifact({
  id: 'twin_shadow',
  name: '쌍둥이 그림자',
  desc: '그림자 분신이 따라다니며 내 공격을 흉내 낸다',
  quote: '그림자가 먼저 움직였다.',
  rarity: 'epic',
  tags: ['shadow'],
  icon: 'icon_twin_shadow',
  pools: ['treasure', 'secret', 'curse'],
  onUpdate(w, _dt, power) {
    syncFamiliars(w, 'twin_shadow', Math.min(2, power), (w2) => new TwinShadow(w2), power);
  },
  onRemove(w) {
    syncFamiliars(w, 'twin_shadow', 0, (w2) => new TwinShadow(w2));
  },
  onAttack(w, angle) {
    if (!cooldown(w, 'twin_shadow', 0.08)) return;
    const melee = isMelee(w);
    for (const t of familiarsOf<TwinShadow>(w, 'twin_shadow')) {
      t.mimic(w, angle, melee);
      if (fx.chance(0.3)) w.sfx('whoosh', { vol: 0.2, pitch: 1.6 });
    }
  },
});
