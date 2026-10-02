// 서리 (frost) artifacts: slows, freezes, icy shots and a cold orbital.

import { defineArtifact } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { RingFx } from '../../game/effects';
import { O, addHitStatus, cooldown, enemiesNear, grantPerCopy, inflict, isAttack, roll, rollHit, sineBehavior, syncFamiliars } from './lib';
import { WinterOrb } from './familiars';
import { proc } from './lib';

const dmg = (w: { player: { stats: { damage: number } } }) => w.player.stats.damage;
const ICE = ['#2a6a9a', '#4aa0d8', '#8fd8f8', '#d8f6ff', '#ffffff'];

// ------------------------------------------------------------------ 서리 조각
defineDrawnSprite('icon_rime_shard', 16, 16, (p) => {
  p.poly([2, 10, 4.5, 8.5, 5.5, 15, 2, 15], ICE[1]);
  p.poly([11, 8, 14, 10, 13, 15, 10, 15], ICE[1]);
  p.poly([7.5, 0, 11.5, 6, 9.5, 15, 5.5, 15, 4, 6], ICE[2]);
  p.poly([7.5, 0, 7.5, 15, 5.5, 15, 4, 6], ICE[3]);
  p.line(7, 2, 5, 7, ICE[4]);
  p.line(9, 7, 9, 14, ICE[1]);
  p.px(12, 10, ICE[3]);
  p.px(3, 11, ICE[3]);
  p.px(13, 3, '#ffffff');
  p.px(2, 5, '#d8f6ff');
}, { outline: '#0c2038' });

defineArtifact({
  id: 'rime_shard',
  name: '서리 조각',
  desc: '공격이 15% 확률로 적을 둔화시킨다',
  quote: '만지면 손끝이 시리다.',
  rarity: 'common',
  tags: ['frost'],
  icon: 'icon_rime_shard',
  look: { shot: '#9fe8ff', shape: 'shard', trail: 'frost' },
  pools: ['treasure', 'shop'],
  modifyHit(w, t, hit, power) {
    if (isAttack(hit) && rollHit(w, hit, 0.15, power)) addHitStatus(w, t, hit, { kind: 'slow', duration: 2.5, power: 0.45 });
  },
});

// ------------------------------------------------------------------ 동상 반지
defineDrawnSprite('icon_frostbite_ring', 16, 16, (p) => {
  p.ring(8, 10.5, 5.5, 2, '#b8c0d0');
  p.px(4, 8, '#f0f4ff');
  p.px(5, 7, '#f0f4ff');
  p.px(3, 10, '#e0e8f8');
  p.px(12, 12, '#6a7088');
  p.px(11, 14, '#6a7088');
  p.px(13, 11, '#7a8098');
  p.rect(6, 5, 4, 2, '#8a90a8');
  p.poly([8, 0, 11.5, 3.5, 8, 7, 4.5, 3.5], ICE[2]);
  p.poly([8, 0, 8, 7, 4.5, 3.5], ICE[3]);
  p.px(7, 2, '#ffffff');
  p.px(9, 4, ICE[1]);
  p.px(14, 6, '#ffffff');
  p.px(1, 5, '#d8f6ff');
}, { outline: '#101828' });

defineArtifact({
  id: 'frostbite_ring',
  name: '동상 반지',
  desc: '둔화되거나 얼어붙은 적에게 주는 피해 +30%',
  quote: '차가운 것은 더 잘 부서진다.',
  rarity: 'common',
  tags: ['frost'],
  icon: 'icon_frostbite_ring',
  look: { aura: '#bfeaff', hit: '#d8f6ff' },
  pools: ['treasure', 'shop', 'boss'],
  modifyHit(_w, t, hit, power) {
    if (t.hasStatus('slow') || t.hasStatus('freeze')) {
      hit.damage *= 1 + 0.3 * power;
      proc(_w, 'frostbite_ring', true);
    }
  },
});

// ------------------------------------------------------------------ 빙정 나선
defineDrawnSprite('icon_crystal_spiral', 16, 16, (p) => {
  p.poly([3.5, 1, 12.5, 1, 10.5, 6, 9, 11, 8, 15.5, 7, 11, 5.5, 6], ICE[2]);
  p.poly([3.5, 1, 8, 1, 7, 6, 7.5, 11, 8, 15.5, 7, 11, 5.5, 6], ICE[3]);
  p.line(4, 2, 11, 1, '#ffffff');
  p.line(5, 4, 11, 2, ICE[1]);
  p.line(6, 6, 10, 4, ICE[4]);
  p.line(6, 8, 10, 6, ICE[1]);
  p.line(7, 10, 9, 9, ICE[4]);
  p.line(7, 12, 9, 11, ICE[1]);
  p.px(8, 14, ICE[4]);
  p.px(13, 5, '#ffffff');
  p.px(2, 8, '#d8f6ff');
  p.px(13, 11, '#d8f6ff');
}, { outline: '#0c2038' });

defineArtifact({
  id: 'crystal_spiral',
  name: '빙정 나선',
  desc: '사거리 +20%. 탄환이 물결치며 날아간다 (탄환 한정)',
  quote: '곧게 가는 것만이 길은 아니다.',
  rarity: 'common',
  tags: ['frost'],
  icon: 'icon_crystal_spiral',
  look: { orbit: '#d8f6ff', trail: 'frost', shot: '#c8f4ff' },
  pools: ['treasure', 'shop'],
  stats(m, power) {
    m.mulStat('range', 1 + 0.2 * power);
  },
  onShoot(_w, p) {
    if (p.generation === 0) p.addBehavior(sineBehavior(0.85, 11));
  },
});

// ------------------------------------------------------------------ 빙하 렌즈
defineDrawnSprite('icon_glacier_lens', 16, 16, (p) => {
  p.line(10, 10, 14, 14, '#6a4a2a');
  p.line(11, 10, 15, 14, '#8a6a3a');
  p.line(10, 11, 14, 15, '#4a3018');
  p.circle(7, 7, 6.5, '#a8b4c8');
  p.circle(7, 7, 5, ICE[2]);
  p.shadeSphere(7, 7, 5, 5, [ICE[0], ICE[1], ICE[2], ICE[3]]);
  p.line(4, 5, 5, 3, '#ffffff');
  p.px(4, 6, '#ffffff');
  p.line(8, 6, 10, 9, '#ffffff');
  p.px(7, 9, ICE[3]);
  p.px(3, 1, '#e8eef8');
  p.px(2, 2, '#e8eef8');
  p.px(11, 12, '#a0805a');
}, { outline: '#101828' });

defineArtifact({
  id: 'glacier_lens',
  name: '빙하 렌즈',
  desc: '탄환이 커지고 느려진다. 공격이 10% 확률로 적을 얼린다',
  quote: '세상이 얼어붙어 보인다.',
  rarity: 'rare',
  tags: ['frost'],
  icon: 'icon_glacier_lens',
  look: { shot: '#a8e8ff', grow: 1.5, hit: '#e8fbff' },
  pools: ['treasure', 'boss', 'challenge'],
  stats(m, power) {
    m.addStat('projSize', 1.2 * power);
    m.mulStat('shotSpeed', Math.pow(0.88, power));
    m.addStat('damage', 0.5 * power);
  },
  onShoot(_w, p) {
    if (p.generation === 0) p.color = '#a8e8ff';
  },
  modifyHit(w, t, hit, power) {
    if (isAttack(hit) && !t.hasStatus('freeze') && rollHit(w, hit, 0.1, power)) {
      addHitStatus(w, t, hit, { kind: 'freeze', duration: 1.2 });
      w.sfx('freeze', { vol: 0.35 });
    }
  },
});

// ------------------------------------------------------------------ 겨울을 품은 구슬
defineDrawnSprite('icon_winter_orb', 16, 16, (p) => {
  p.circle(8, 7, 6.2, ICE[2]);
  p.shadeSphere(8, 7, 6.2, 6.2, [ICE[1], ICE[2], ICE[3], '#eefcff']);
  p.ellipse(8, 10.5, 4.6, 1.6, '#ffffff');
  p.poly([8, 3.5, 10.5, 9.5, 5.5, 9.5], '#3a8a6a');
  p.poly([8, 3.5, 8, 9.5, 5.5, 9.5], '#5aaa80');
  p.px(8, 3, '#ffe080');
  p.px(5, 4, '#ffffff');
  p.px(11, 5, '#ffffff');
  p.px(10, 2, '#ffffff');
  p.px(4, 7, '#ffffff');
  p.line(4, 3, 5, 2, '#ffffff');
  p.rect(3, 12, 10, 3, '#8a5a3a');
  p.line(3, 12, 12, 12, '#c08a5a');
  p.line(4, 14, 12, 14, '#5a3420');
}, { outline: '#0c2038' });

defineArtifact({
  id: 'winter_orb',
  name: '겨울을 품은 구슬',
  desc: '얼음 구슬이 주위를 돌며 적 탄환을 막고 적을 얼린다',
  quote: '작은 구슬 속에서 눈이 그치지 않는다.',
  rarity: 'rare',
  tags: ['frost'],
  icon: 'icon_winter_orb',
  look: { mote: '#bfeaff' },
  pools: ['treasure', 'shop'],
  onUpdate(w, _dt, power) {
    syncFamiliars(w, 'winter_orb', Math.min(3, power), (w2) => new WinterOrb(w2), power);
  },
  onRemove(w) {
    syncFamiliars(w, 'winter_orb', 0, (w2) => new WinterOrb(w2));
  },
});

// ------------------------------------------------------------------ 상고대 망토
defineDrawnSprite('icon_hoarfrost_mantle', 16, 16, (p) => {
  p.poly([5, 1, 11, 1, 14.5, 12.5, 1.5, 12.5], '#6aaad8');
  p.shadeSphere(7, 5, 9, 10, ['#3a6a9a', '#4a88c0', '#6aaad8', '#9ad0f0']);
  p.poly([1.5, 12, 3, 15, 4, 12, 5.5, 14.5, 7, 12, 8, 15.5, 9, 12, 10.5, 14.5, 12, 12, 13, 15, 14.5, 12], '#d8f6ff');
  p.line(6, 4, 3.5, 11, '#3a6a9a');
  p.line(10, 4, 12.5, 11, '#3a6a9a');
  p.line(8, 4, 8, 11, '#4a88c0');
  p.rect(4.5, 0, 7, 3, '#e8f8ff');
  p.line(5, 2, 11, 2, '#b0d8f0');
  p.circle(8, 3, 1.2, '#ffe080');
  p.px(8, 3, '#ffffff');
  p.px(2, 6, '#ffffff');
  p.px(14, 8, '#ffffff');
}, { outline: '#0c1830' });

defineArtifact({
  id: 'hoarfrost_mantle',
  name: '상고대 망토',
  desc: '영혼 하트 +1. 피격 시 주변 적을 얼리고 탄환을 지운다',
  quote: '상처가 닿는 곳마다 서리가 핀다.',
  rarity: 'epic',
  tags: ['frost'],
  icon: 'icon_hoarfrost_mantle',
  look: { aura: '#d8f6ff', step: '#d8f6ff' },
  pools: ['treasure', 'boss', 'shrine'],
  onAcquire(w, power) {
    grantPerCopy(w, 'hoarfrost_mantle', power, () => w.player.addSoul(2));
  },
  onUpdate(w, _dt, power) {
    grantPerCopy(w, 'hoarfrost_mantle', power, () => w.player.addSoul(2));
  },
  onHurt(w, _a, power) {
    if (!cooldown(w, 'hoarfrost', 1.5)) return;
    const p = w.player;
    const R = 90 + 15 * (power - 1);
    w.sfx('freeze', { vol: 0.8 });
    w.renderer.screenFlash('#c8f0ff', 0.3);
    w.spawn(new RingFx(p.x, p.y - 6, R, 0.4, '#d8f6ff', 3));
    w.particles.burst(p.x, p.y - 6, { count: 40, speed: [60, 200], life: [0.3, 0.7], colors: ['#ffffff', '#d8f6ff', '#8fd8f8', '#4aa0d8'], size: [1, 3], shape: 'square', drag: 3, vrot: 10 });
    w.clearEnemyBullets(p.x, p.y, R * 1.2);
    for (const e of enemiesNear(w, p.x, p.y, R)) inflict(w, e, { kind: 'freeze', duration: 1.8 });
  },
});
