// 독 (venom) artifacts: poison stacks, spores, growing seeds and splitting sacs.

import { defineArtifact } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';
import { RingFx } from '../../game/effects';
import { Pickup } from '../../game/pickups';
import { fx } from '../../engine/rng';
import {
  O, addHitStatus, cooldown, enemiesNear, growBehavior, inflict, isAttack, isMelee, isPrimary, roll, rollHit, spawnShards,
} from './lib';

const dmg = (w: { player: { stats: { damage: number } } }) => w.player.stats.damage;

// ------------------------------------------------------------------ 독사의 송곳니
defineDrawnSprite('icon_viper_fang', 16, 16, (p) => {
  p.rect(2, 0, 9, 2, '#a03040');
  p.line(2, 0, 10, 0, '#d05060');
  p.poly([2.5, 2, 10, 2, 10.5, 6, 10, 9.5, 8.5, 12.5, 7, 14.5, 6.5, 10.5, 5, 6.5, 3.5, 3.5], '#f0e8d8');
  p.poly([8, 2, 10, 2, 10.5, 6, 10, 9.5, 8.5, 12.5, 7, 14.5, 8.5, 9, 8.5, 5], '#b8a890');
  p.line(4, 3, 6, 9, '#ffffff');
  p.line(7, 4, 7.5, 11, '#d8ccb8');
  p.ellipse(8, 15, 1.4, 1.2, '#8aff5a');
  p.px(12, 11, '#5ad030');
  p.px(13, 13, '#8aff5a');
  p.px(11, 14, '#3a8a20');
}, { outline: O });

defineArtifact({
  id: 'viper_fang',
  name: '독사의 송곳니',
  desc: '공격이 20% 확률로 적을 중독시킨다',
  quote: '한 번 물면 놓지 않는다.',
  rarity: 'common',
  tags: ['venom'],
  icon: 'icon_viper_fang',
  pools: ['treasure', 'shop'],
  modifyHit(w, t, hit, power) {
    if (isAttack(hit) && rollHit(w, hit, 0.2, power)) addHitStatus(w, t, hit, { kind: 'poison', duration: 4, power: dmg(w) * 0.22 });
  },
});

// ------------------------------------------------------------------ 썩은 버섯
defineDrawnSprite('icon_rot_mushroom', 16, 16, (p) => {
  p.rect(6, 8, 4, 7, '#e0d8c0');
  p.line(9, 9, 9, 14, '#a8a088');
  p.line(6, 9, 6, 14, '#fff8e8');
  p.ellipse(8, 6.5, 7, 4.8, '#7a3a8a');
  p.rect(1, 6.5, 14, 2, '#7a3a8a');
  p.shadeSphere(8, 6, 7, 5.5, ramp('#8a4a9a', 4));
  p.line(2, 8, 13, 8, '#3a1840');
  p.circle(5, 4, 1.3, '#a8e060');
  p.circle(10.5, 5, 1.1, '#a8e060');
  p.px(8, 2, '#c8ff80');
  p.px(12, 7, '#a8e060');
  p.px(4, 4, '#e0ffb0');
  p.px(3, 9, '#a8e060');
  p.px(3, 10, '#7ac040');
  p.px(12, 9, '#a8e060');
  p.rect(5, 15, 6, 1, '#6a5a3a');
}, { outline: O });

defineArtifact({
  id: 'rot_mushroom',
  name: '썩은 버섯',
  desc: '최대 체력 +1. 전투가 시작되면 포자로 적을 중독시킨다',
  quote: '유통기한은 묻지 마라.',
  rarity: 'common',
  tags: ['venom'],
  icon: 'icon_rot_mushroom',
  pools: ['treasure', 'boss'],
  stats(m, power) {
    m.addStat('maxHearts', power);
  },
  onRoomEnter(w) {
    if (!w.node.cleared) w.vars.__sporeT = w.time + 0.8;
  },
  onUpdate(w, _dt, power) {
    const t = w.vars.__sporeT ?? 0;
    if (t <= 0 || w.time < t) return;
    w.vars.__sporeT = 0;
    const p = w.player;
    const R = 80 + 10 * (power - 1);
    w.sfx('poison', { vol: 0.6 });
    w.spawn(new RingFx(p.x, p.y - 4, R, 0.5, '#a8e060', 2));
    w.particles.burst(p.x, p.y - 4, { count: 40, speed: [30, 140], life: [0.6, 1.2], colors: ['#e0ffb0', '#a8e060', '#7a3a8a', '#4a8a2a'], size: [1, 3], shape: 'circle', drag: 2.5, fade: true });
    for (const e of enemiesNear(w, p.x, p.y, R)) inflict(w, e, { kind: 'poison', duration: 4, power: dmg(w) * 0.2 * power });
  },
});

// ------------------------------------------------------------------ 두꺼비 우상
defineDrawnSprite('icon_toad_idol', 16, 16, (p) => {
  p.ellipse(8, 13.5, 6.5, 2.2, '#c89020');
  p.ellipse(8, 13, 5.5, 1.6, '#ffe070');
  p.px(5, 13, '#fff8c0');
  p.ellipse(8, 9, 5.8, 4.2, '#3aa070');
  p.circle(4.8, 5.4, 2, '#3aa070');
  p.circle(11.2, 5.4, 2, '#3aa070');
  p.shadeSphere(8, 8, 6.5, 5.5, ramp('#44b07a', 4));
  p.px(4, 5, '#ffe070');
  p.px(11, 5, '#ffe070');
  p.px(5, 5, '#101810');
  p.px(12, 5, '#101810');
  p.line(5, 9.5, 11, 9.5, '#1a5a3a');
  p.px(8, 10, '#ffe070');
  p.ellipse(3, 11.5, 1.6, 1.1, '#2a8058');
  p.ellipse(13, 11.5, 1.6, 1.1, '#2a8058');
  p.px(7, 7, '#7ae0a8');
  p.px(9, 8, '#2a8058');
}, { outline: O });

defineArtifact({
  id: 'toad_idol',
  name: '두꺼비 우상',
  desc: '행운 +1. 중독된 적이 죽으면 15% 확률로 동전을 떨군다',
  quote: '두꺼비는 복을 물어 온다고 했다.',
  rarity: 'common',
  tags: ['venom', 'star'],
  icon: 'icon_toad_idol',
  pools: ['treasure', 'shop'],
  stats(m, power) {
    m.addStat('luck', power);
  },
  onKill(w, e, power) {
    if (e.hasStatus('poison') && roll(w, 0.15, power, 0)) w.spawn(new Pickup('coin', e.x, e.y).pop());
  },
});

// ------------------------------------------------------------------ 부푸는 씨앗
defineDrawnSprite('icon_swelling_seed', 16, 16, (p) => {
  p.ellipse(8, 10.5, 5.5, 4.8, '#a87838');
  p.shadeSphere(8, 10.5, 5.5, 4.8, ramp('#b88040', 4));
  p.line(5, 9, 8, 7.5, '#6a4018');
  p.line(8, 7.5, 11, 9, '#6a4018');
  p.px(6, 12, '#d8a868');
  p.line(8, 6, 8, 3, '#4aa028');
  p.ellipse(5.3, 3, 2.4, 1.3, '#7ae050');
  p.ellipse(10.7, 2.3, 2.4, 1.3, '#5ac030');
  p.px(4, 2, '#c0ff90');
  p.px(13, 6, '#8aff5a');
  p.px(14, 8, '#5ad030');
  p.px(2, 6, '#8aff5a');
}, { outline: O });

defineArtifact({
  id: 'swelling_seed',
  name: '부푸는 씨앗',
  desc: '사거리 +10%. 탄환이 갈수록 커지고 세진다 (탄환 한정)',
  quote: '작게 시작해 크게 끝난다.',
  rarity: 'common',
  tags: ['venom'],
  icon: 'icon_swelling_seed',
  pools: ['treasure', 'shop', 'challenge'],
  stats(m, power) {
    m.mulStat('range', 1 + 0.1 * power);
  },
  onShoot(_w, p, power) {
    if (p.generation === 0) p.addBehavior(growBehavior(2.2, 0.8 + 0.3 * power));
  },
});

// ------------------------------------------------------------------ 역병 향로
defineDrawnSprite('icon_plague_censer', 16, 16, (p) => {
  p.px(8, 0, '#c0a050');
  p.px(8, 1, '#806020');
  p.px(8, 2, '#c0a050');
  p.px(8, 3, '#806020');
  p.circle(8, 9, 4.8, '#c09040');
  p.shadeSphere(8, 9, 4.8, 4.8, ramp('#c89840', 4));
  p.line(3.5, 9, 12.5, 9, '#6a4818');
  p.rect(6, 4, 5, 1, '#a07830');
  p.px(6, 7, '#8aff5a');
  p.px(10, 7, '#8aff5a');
  p.px(6, 11, '#5ad030');
  p.px(10, 11, '#5ad030');
  p.px(8, 12, '#5ad030');
  p.rect(7, 13.5, 3, 2, '#a07830');
  p.circle(2.5, 6, 1.6, '#8aff5a');
  p.circle(1.5, 3, 1.1, '#c8ff90');
  p.circle(13.5, 5, 1.4, '#8aff5a');
  p.circle(14.5, 2, 0.9, '#c8ff90');
}, { outline: O });

defineArtifact({
  id: 'plague_censer',
  name: '역병 향로',
  desc: '독 안개를 둘러 가까이 온 적을 계속 중독시킨다',
  quote: '향이 퍼지면, 숨 쉬는 것들이 쓰러진다.',
  rarity: 'rare',
  tags: ['venom'],
  icon: 'icon_plague_censer',
  pools: ['treasure', 'curse'],
  onUpdate(w, dt, power) {
    const p = w.player;
    const R = 40 + 10 * (power - 1);
    if (fx.chance(dt * 18)) {
      const a = fx.angle();
      const rr = fx.range(R * 0.4, R);
      w.particles.spawn({
        x: p.x + Math.cos(a) * rr, y: p.y - 2 + Math.sin(a) * rr * 0.7, vx: -Math.sin(a) * 12, vy: Math.cos(a) * 8 - 4,
        life: fx.range(0.6, 1.1), colors: ['#c8ff9040', '#8aff5a50', '#3a8a2030'], size: fx.range(2, 4), sizeEnd: 5, shape: 'circle', ground: true,
      });
    }
    if (!cooldown(w, 'censer', 0.6)) return;
    for (const e of enemiesNear(w, p.x, p.y, R)) inflict(w, e, { kind: 'poison', duration: 3, power: dmg(w) * 0.15 }, false);
  },
});

// ------------------------------------------------------------------ 맹독 분열낭
defineDrawnSprite('icon_toxin_splitter', 16, 16, (p) => {
  p.ellipse(6.5, 9, 5, 5.5, '#5ad030');
  p.shadeSphere(6.5, 9, 5, 5.5, ramp('#60d040', 4));
  p.line(4, 7, 6, 12, '#2a7a18');
  p.line(8, 6, 9, 10, '#2a7a18');
  p.rect(5, 2, 3, 2, '#3a8a20');
  p.px(6, 1, '#2a6a18');
  p.px(4, 6, '#d0ff9a');
  p.circle(13, 4, 1.6, '#8aff5a');
  p.circle(14, 9.5, 1.6, '#8aff5a');
  p.circle(12.5, 14, 1.4, '#8aff5a');
  p.px(12, 3, '#ffffff');
  p.px(13, 9, '#ffffff');
  p.px(11, 7, '#5ad030');
  p.px(11, 12, '#5ad030');
}, { outline: '#0c2008' });

defineArtifact({
  id: 'toxin_splitter',
  name: '맹독 분열낭',
  desc: '적중 시 독 방울이 사방으로 튄다 (탄환 3개, 근접 2개)',
  quote: '터뜨리면 안 되는 주머니였다.',
  rarity: 'rare',
  tags: ['venom'],
  icon: 'icon_toxin_splitter',
  pools: ['treasure', 'challenge'],
  onHit(w, t, hit, power) {
    if (!isPrimary(hit)) return;
    const n = (isMelee(w) ? 2 : 3) + (power - 1);
    const shards = spawnShards(w, t.x, t.y - t.z - 3, {
      count: n, damage: dmg(w) * 0.4, sprite: 'proj_venom_drop', color: '#8aff5a', speed: 180, range: 90, radius: 2,
      angle: Math.atan2(hit.dirY ?? 0, hit.dirX ?? 1) - 1.2, arc: 2.4, statuses: [{ kind: 'poison', duration: 3, power: dmg(w) * 0.18 }],
    });
    for (const s of shards) s.hitIds.add(t.id);
    if (shards.length) w.sfx('splat', { vol: 0.3, pitch: 1.4 });
  },
});

// ------------------------------------------------------------------ 까마중 화관
defineDrawnSprite('icon_nightshade_wreath', 16, 16, (p) => {
  p.ring(8, 8, 7, 3.2, '#2a5a2a');
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    p.px(8 + Math.cos(a) * 5.5, 8 + Math.sin(a) * 5.5, i % 2 ? '#4a8a3a' : '#6aaa4a');
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const x = 8 + Math.cos(a) * 6;
    const y = 8 + Math.sin(a) * 6;
    p.circle(x, y, 1.5, '#3a1050');
    p.px(x - 0.5, y - 0.5, '#b080d0');
  }
  p.poly([6, 13, 8, 11, 10, 13, 8, 15], '#9a6ad8');
  p.px(8, 13, '#ffe080');
}, { outline: O });

defineArtifact({
  id: 'nightshade_wreath',
  name: '까마중 화관',
  desc: '중독된 적이 죽으면 독이 번지고 등불 게이지가 찬다',
  quote: '아름다운 것엔 독이 있다.',
  rarity: 'epic',
  tags: ['venom'],
  icon: 'icon_nightshade_wreath',
  pools: ['treasure', 'curse', 'secret'],
  onKill(w, e, power) {
    const s = e.statuses.get('poison');
    if (!s) return;
    w.player.addEmber(5 * power);
    w.spawn(new RingFx(e.x, e.y - 3, 60, 0.4, '#a070e0', 2));
    w.particles.burst(e.x, e.y - 4, { count: 16, speed: [30, 110], life: [0.3, 0.7], colors: ['#d0b0ff', '#8aff5a', '#3a1050'], size: [1, 2], shape: 'circle' });
    for (const o of enemiesNear(w, e.x, e.y, 60)) {
      if (o === e) continue;
      for (let i = 0; i < Math.min(4, s.stacks + 1); i++) inflict(w, o, { kind: 'poison', duration: 4, power: Math.max(s.power, dmg(w) * 0.2) }, i === 0);
    }
  },
});
