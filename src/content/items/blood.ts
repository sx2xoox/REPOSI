// 피 (blood) artifacts: bleeding, life steal, risky power and thorns.

import { defineArtifact } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';
import { RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { O, addHitStatus, enemiesNear, isAttack, itemHit, roll, rollHit, spawnShards, stackMul } from './lib';
import { amplify, amplifyShot, proc } from './lib';

/** Pierce bonuses one shot can collect from 무쇠 깃촉. */
export const IRON_QUILL_MAX = 3;

const dmg = (w: { player: { stats: { damage: number } } }) => w.player.stats.damage;
const RED = ['#4a0812', '#8a1020', '#c81c30', '#ff4a5a', '#ffb0b8'];

// ------------------------------------------------------------------ 거머리 이빨
defineDrawnSprite('icon_leech_tooth', 16, 16, (p) => {
  const path: [number, number, number][] = [[2.5, 13.5, 2.1], [4, 11, 2.4], [6, 9, 2.6], [8.5, 7.5, 2.7], [11, 6.2, 2.8]];
  for (const [x, y, r] of path) p.circle(x, y, r, '#5a1424');
  for (const [x, y, r] of path) p.circle(x - 0.7, y - 0.7, r * 0.6, '#8a2a3c');
  for (const [x, y] of path.slice(0, 4)) p.px(x + 1, y + 1, '#3a0a14');
  p.px(2, 12, '#c8606e');
  p.px(4, 10, '#c8606e');
  p.px(6, 8, '#c8606e');
  p.circle(12.2, 4.6, 3, '#8a2a3c');
  p.circle(12.2, 4.6, 1.8, '#1a0206');
  p.px(11, 3, '#fff4f0');
  p.px(13, 3, '#fff4f0');
  p.px(11, 6, '#fff4f0');
  p.px(13, 6, '#fff4f0');
  p.px(14, 4, '#fff4f0');
  p.px(10, 4, '#fff4f0');
  p.px(12, 4, '#e02838');
  p.ellipse(14, 10, 1.3, 1.6, '#e02838');
  p.px(14, 9, '#ff9aa8');
  p.px(12, 12, '#e02838');
}, { outline: O });

defineArtifact({
  id: 'leech_tooth',
  name: '거머리 이빨',
  desc: '공격력 +1. 적을 처치하면 가끔 체력을 회복한다.',
  quote: '조금씩, 꾸준히.',
  signature: '처치한 적의 핏방울이 날아와 스며든다',
  rarity: 'common',
  tags: ['blood'],
  icon: 'icon_leech_tooth',
  look: { shot: '#ff4a5a', trail: 'drip' },
  pools: ['treasure', 'shop', 'curse'],
  stats(m, power) {
    m.addStat('damage', 1 * power);
  },
  onKill(w, e, power) {
    // every kill: a few blood drops drift to the keeper
    const p = w.player;
    const dx = p.x - e.x;
    const dy = p.y - 8 - e.y;
    for (let i = 0; i < 3; i++) w.particles.spawn({ x: e.x + fx.range(-3, 3), y: e.y - 4, vx: dx * 1.6 + fx.range(-15, 15), vy: dy * 1.6 + fx.range(-15, 15), drag: 1.5, life: 0.55, colors: ['#ff6a7a', '#c01828'], size: 1, shape: 'pixel' });
    if (!roll(w, 0.05, power, 0.005)) return;
    if (p.maxRed > 0 && p.red < p.maxRed) {
      p.heal(1);
      w.sfx('heal', { vol: 0.5, pitch: 1.3 });
    }
    proc(w, 'leech_tooth');
  },
});

// ------------------------------------------------------------------ 가시덩굴 코르셋
defineDrawnSprite('icon_bramble_corset', 16, 16, (p) => {
  p.poly([3, 1, 13, 1, 11, 8, 13, 15, 3, 15, 5, 8], '#7a2030');
  p.shadeSphere(7, 6, 8, 10, [RED[0], '#5a1420', '#7a2030', '#a03848'], { dither: false });
  for (let y = 3; y <= 13; y += 2) {
    p.px(7, y, '#e8c0a0');
    p.px(9, y, '#e8c0a0');
    p.px(8, y + 1, '#c09070');
  }
  for (let x = 2; x <= 14; x++) {
    const y = 6 + Math.round(Math.sin(x * 0.9) * 1.5);
    p.px(x, y, '#3a7a2a');
    if (x % 3 === 0) p.px(x, y - 1, '#a8d070');
  }
  for (let x = 2; x <= 14; x++) {
    const y = 11 + Math.round(Math.sin(x * 0.9 + 2) * 1.5);
    p.px(x, y, '#3a7a2a');
    if (x % 3 === 1) p.px(x, y + 1, '#a8d070');
  }
  p.px(1, 6, '#3a7a2a');
  p.px(15, 11, '#3a7a2a');
}, { outline: O });

defineArtifact({
  id: 'bramble_corset',
  name: '가시덩굴 코르셋',
  desc: '피격당하면 가시가 터져 주변 적에게 피해와 출혈을 준다.',
  quote: '안아주려는 자에게도 가시가 돋는다.',
  rarity: 'common',
  tags: ['blood'],
  icon: 'icon_bramble_corset',
  look: { aura: '#6aaa3a', hit: '#e8ffc0' },
  pools: ['treasure', 'shop', 'boss'],
  onHurt(w, _a, power) {
    const p = w.player;
    const R = 58;
    w.sfx('spike', { vol: 0.7 });
    w.spawn(new RingFx(p.x, p.y - 4, R, 0.3, '#a8d070', 2));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      w.particles.spawn({ x: p.x + Math.cos(a) * 6, y: p.y - 4 + Math.sin(a) * 6, vx: Math.cos(a) * 220, vy: Math.sin(a) * 220, drag: 6, life: 0.3, colors: ['#e8ffc0', '#6aaa3a', '#3a6a2a'], size: 2, sizeEnd: 1, shape: 'spark', rot: a });
    }
    for (const e of enemiesNear(w, p.x, p.y, R)) itemHit(w, e, dmg(w) * 2.5 * stackMul(power), { knockback: 200, statuses: [{ kind: 'bleed', duration: 3, power: dmg(w) * 0.3 }] });
  },
});

// ------------------------------------------------------------------ 무쇠 깃촉
defineDrawnSprite('icon_iron_quill', 16, 16, (p) => {
  p.poly([8, 15.5, 3, 6.5, 5, 2, 11, 2, 13, 6.5], '#8a90a0');
  p.poly([8, 15.5, 3, 6.5, 5, 2, 8, 2], '#c8d0e0');
  p.line(8, 8, 8, 15, '#22222e');
  p.circle(8, 7, 1.2, '#22222e');
  p.line(4, 6, 7, 3, '#f0f4ff');
  p.rect(5, 0, 6, 2.5, '#5a4a6a');
  p.line(5, 0, 10, 0, '#8a7a9a');
  p.ellipse(13, 13, 1.4, 1.8, '#e02838');
  p.px(13, 12, '#ff9aa8');
  p.px(12, 10, '#e02838');
}, { outline: O });

defineArtifact({
  id: 'iron_quill',
  name: '무쇠 깃촉',
  desc: '관통 +1. 적을 꿰뚫을 때마다 탄환 피해가 커진다.',
  quote: '펜은 칼보다 깊이 박힌다.',
  rarity: 'common',
  tags: ['blood'],
  icon: 'icon_iron_quill',
  look: { shape: 'needle', shot: '#d0d0e0', hit: '#ffffff' },
  pools: ['treasure', 'shop', 'challenge'],
  stats(m, power) {
    m.addStat('pierce', power);
    m.mulStat('shotSpeed', 1.1);
  },
  onShoot(_w, pr) {
    if (pr.generation > 0) return;
    pr.addBehavior({
      id: 'iron_quill',
      onHit(p2, w2) {
        // +20 % per enemy pierced, three times at most: a shot that keeps grinding the same
        // foe (boomerangs, yoyos, saws) no longer compounds without end
        if ((p2.mem.quill ?? 0) >= IRON_QUILL_MAX) return;
        p2.mem.quill = (p2.mem.quill ?? 0) + 1;
        amplifyShot(p2, 0.2);
        proc(w2, 'iron_quill', true);
      },
    });
  },
});

// ------------------------------------------------------------------ 진홍 칼날
defineDrawnSprite('icon_crimson_edge', 16, 16, (p) => {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d1 = Math.hypot(x + 0.5 - 2, y + 0.5 - 14);
      const d2 = Math.hypot(x + 0.5 - 0, y + 0.5 - 16.5);
      if (d1 < 13 && d2 > 12.6 && x > 3 && y < 11) {
        const edge = 13 - d1;
        p.px(x, y, edge < 1.3 ? '#ffd8e0' : edge < 2.8 ? RED[3] : RED[2]);
      }
    }
  }
  p.line(3, 9, 7, 13, '#e8c060');
  p.px(3, 9, '#fff0a0');
  p.line(1, 14, 4, 11, '#5a1a20');
  p.line(2, 14, 5, 11, '#3a0a10');
  p.rect(0, 14, 2, 2, '#e8c060');
  p.px(13, 3, '#ffffff');
  p.px(12, 2, '#ffffff');
  p.px(10, 12, RED[3]);
  p.px(11, 14, RED[2]);
}, { outline: O });

defineArtifact({
  id: 'crimson_edge',
  name: '진홍 칼날',
  desc: '공격하면 15% 확률로 적에게 출혈을 일으킨다.',
  quote: '베인 자리가 오래 아프다.',
  rarity: 'rare',
  tags: ['blood'],
  icon: 'icon_crimson_edge',
  look: { shot: '#c01828', hit: '#ff4a5a', trail: 'drip' },
  pools: ['treasure', 'challenge', 'curse'],
  modifyHit(w, t, hit, power) {
    if (isAttack(hit) && rollHit(w, hit, 0.15, power)) addHitStatus(w, t, hit, { kind: 'bleed', duration: 3, power: dmg(w) * 0.3 });
  },
});

// ------------------------------------------------------------------ 심장 실
defineDrawnSprite('icon_heartstring', 16, 16, (p) => {
  p.circle(5, 6, 3.6, RED[2]);
  p.circle(11, 6, 3.6, RED[2]);
  p.poly([1.5, 7, 14.5, 7, 8, 14.5], RED[2]);
  p.shadeSphere(8, 8, 7, 7, ramp('#d82838', 4), { dither: false });
  p.line(2, 9, 13, 5, '#f8e8e0');
  p.line(3, 11, 12, 8, '#f8e8e0');
  p.px(7, 3, '#f8e8e0');
  p.px(6, 2, '#f8e8e0');
  p.px(8, 2, '#f8e8e0');
  p.px(4, 4, '#ffd0d8');
  p.line(11, 15, 15, 9, '#c0c8d8');
  p.px(15, 9, '#ffffff');
  p.px(14, 11, '#f8e8e0');
}, { outline: O });

defineArtifact({
  id: 'heartstring',
  name: '심장 실',
  desc: '체력이 가득 차 있으면 피해가 20% 늘어난다.',
  quote: '온전할 때, 가장 강하다.',
  rarity: 'rare',
  tags: ['blood'],
  icon: 'icon_heartstring',
  look: { mote: '#ff6a7a', aura: '#ff8a9a' },
  pools: ['treasure', 'boss', 'shop'],
  onShoot(w, p) {
    const pl = w.player;
    if (p.generation === 0 && pl.maxRed > 0 && pl.red >= pl.maxRed) p.color = '#ff6a7a';
  },
  modifyHit(w, _t, hit, power) {
    const p = w.player;
    if (p.maxRed > 0 && p.red >= p.maxRed && hit.kind !== 'status') {
      amplify(hit, 0.2 * power);
      proc(w, 'heartstring', true);
    }
  },
});

// ------------------------------------------------------------------ 피의 서약
defineDrawnSprite('icon_blood_pact', 16, 16, (p) => {
  p.rect(2, 2, 10, 12, '#e8d8b0');
  p.shadeVertical(2, 2, 10, 12, ['#b8a070', '#d8c498', '#f0e4c4']);
  p.rect(1, 1, 12, 2, '#c8b080');
  p.rect(1, 13, 12, 2, '#c8b080');
  p.line(1, 1, 12, 1, '#f4ecd0');
  for (let y = 4; y <= 8; y += 2) p.line(4, y, 10, y, '#8a7a5a');
  p.circle(7, 10.5, 2.4, '#c02030');
  p.px(6, 10, '#ff6a78');
  p.px(7, 13, '#c02030');
  p.px(7, 14, '#8a1020');
  p.line(11, 6, 15, 0, '#f0f0f0');
  p.line(12, 6, 15, 2, '#c8c8d0');
  p.px(11, 7, '#3a1a1a');
}, { outline: O });

defineArtifact({
  id: 'blood_pact',
  name: '피의 서약',
  desc: '공격력 +25%. 피격당하면 다음 공격이 치명타가 된다.',
  detail: '대신 최대 체력이 한 칸 줄어든다.',
  quote: '서명은 피로 한다.',
  signature: '피격당하면 다음 공격 2회가 반드시 치명타가 된다',
  rarity: 'epic',
  tags: ['blood'],
  icon: 'icon_blood_pact',
  look: { aura: '#c01828', step: '#ff4a5a', grow: 0.5 },
  pools: ['curse', 'secret'],
  unique: true,
  stats(m, power) {
    m.mulStat('damage', 1 + 0.25 * power);
    m.addStat('maxHearts', -power);
  },
  onHurt(w, _a, power) {
    if (!w.player.alive) return;
    w.vars.__pactN = 1 + power;
    proc(w, 'blood_pact');
  },
  modifyHit(w, _t, hit) {
    if ((w.vars.__pactN ?? 0) <= 0 || hit.crit || !isAttack(hit)) return;
    w.vars.__pactN--;
    hit.crit = true;
    hit.damage *= w.player.stats.critMult;
  },
});

// ------------------------------------------------------------------ 핏빛 달 (legendary)
defineDrawnSprite('icon_blood_moon', 16, 16, (p) => {
  p.circle(8, 8, 7.2, '#3a0a14');
  p.circle(8, 8, 6.2, RED[2]);
  p.shadeSphere(8, 8, 6.2, 6.2, [RED[1], RED[2], RED[3], RED[4]], { dither: false });
  p.circle(11, 6, 5.2, '#3a0a14');
  p.circle(11.5, 5.5, 4.4, null);
  p.px(4, 5, '#ffd0d8');
  p.px(3, 8, '#ff9aa8');
  p.px(5, 14, RED[2]);
  p.px(5, 15, RED[1]);
  p.px(8, 15, RED[2]);
  p.px(14, 12, '#ffd0d8');
  p.px(13, 1, '#ffffff');
}, { outline: '#14040a' });

defineDrawnSprite('fx_blood_moon_small', 7, 7, (p) => {
  p.circle(3.5, 3.5, 3.5, RED[2]);
  p.shadeSphere(3.5, 3.5, 3.5, 3.5, [RED[1], RED[2], RED[3]], { dither: false });
  p.circle(5.2, 2.3, 2.8, null);
}, { outline: '#14040a' });

defineArtifact({
  id: 'blood_moon',
  name: '핏빛 달',
  desc: '공격력 +1. 적을 처치하면 핏빛 화살이 다른 적을 쫓는다.',
  quote: '달이 붉게 물드는 밤엔, 사냥꾼도 사냥감이 된다.',
  rarity: 'legendary',
  tags: ['blood', 'shadow'],
  icon: 'icon_blood_moon',
  look: { shot: '#ff2040', shape: 'crescent', hit: '#ff6a7a' },
  pools: ['curse', 'boss', 'secret'],
  stats(m, power) {
    m.addStat('damage', power);
  },
  onKill(w, e, power) {
    if ((w.vars.__bloodMoonT ?? -1) > w.time) return;
    w.vars.__bloodMoonT = w.time + 0.04;
    w.sfx('whoosh', { vol: 0.35, pitch: 1.4 });
    spawnShards(w, e.x, e.y - 4, {
      count: 3 + power, damage: dmg(w) * 0.6, sprite: 'proj_blood_dart', color: '#ff4a5a', speed: 190, range: 220, homing: 7, spectral: true,
      statuses: [{ kind: 'bleed', duration: 3, power: dmg(w) * 0.25 }],
    });
  },
  onUpdate(w, dt) {
    if (fx.chance(dt * 3)) {
      const p = w.player;
      w.particles.spawn({ x: p.x + 9 + fx.range(-1, 1), y: p.y - 22, vy: 18, life: 0.6, colors: ['#ff4a5a', '#8a1020'], size: 1, gravity: 0 });
    }
  },
  draw(w, r) {
    const p = w.player;
    const bob = Math.sin(w.time * 2) * 1.5;
    r.circle(p.x + 9, p.y - 24 + bob, 6, '#ff2040', 0.12);
    r.sprite('fx_blood_moon_small', p.x + 9, p.y - 24 + bob);
  },
});
