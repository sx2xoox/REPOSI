// 태엽 (clockwork) artifacts: attack speed, keys & bombs, rhythm, returning
// and orbiting shots, a turret familiar and the legendary time stop.

import { defineArtifact } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';
import { RingFx } from '../../game/effects';
import { Projectile } from '../../game/projectile';
import { fx } from '../../engine/rng';
import {
  O, addHitStatus, boomerangBehavior, enemiesNear, grantPerCopy, inflict, isAttack, isMelee, orbitBehavior, roll, shout,
  syncFamiliars, tickTimeStop, timeStop, timeStopped, watch,
} from './lib';
import { GearTurret } from './familiars';

const dmg = (w: { player: { stats: { damage: number } } }) => w.player.stats.damage;
const BRASS = ['#5a3a18', '#8a6028', '#c89848', '#f0d080', '#fff4c0'];

// ------------------------------------------------------------------ 금 간 모래시계
defineDrawnSprite('icon_cracked_hourglass', 16, 16, (p) => {
  p.poly([4, 2, 12, 2, 9, 8, 12, 14, 4, 14, 7, 8], '#a8d8f0');
  p.poly([4, 2, 8, 2, 8, 8, 8, 14, 4, 14, 7, 8], '#d0ecfa');
  p.poly([5.5, 13.5, 10.5, 13.5, 8, 10.5], '#e8c060');
  p.poly([5.5, 3, 10.5, 3, 8, 6], '#e8c060');
  p.line(8, 6, 8, 11, '#f0d080');
  p.px(8, 12, '#fff0b0');
  p.line(10, 3, 9, 5, '#506070');
  p.line(9, 5, 10, 6, '#506070');
  p.rect(2, 0, 12, 2, BRASS[1]);
  p.rect(2, 14, 12, 2, BRASS[1]);
  p.line(2, 0, 13, 0, BRASS[3]);
  p.line(2, 14, 13, 14, BRASS[2]);
  p.line(3, 2, 3, 13, BRASS[0]);
  p.line(12, 2, 12, 13, BRASS[0]);
  p.px(5, 4, '#ffffff');
}, { outline: O });

defineArtifact({
  id: 'cracked_hourglass',
  name: '금 간 모래시계',
  desc: '공격 속도 +0.45, 사거리 -10%',
  quote: '모래가 새도 시간은 흐른다.',
  rarity: 'common',
  tags: ['clockwork'],
  icon: 'icon_cracked_hourglass',
  pools: ['treasure', 'shop', 'boss'],
  stats(m, power) {
    m.addStat('fireRate', 0.45 * power);
    m.mulStat('range', Math.pow(0.9, power));
  },
});

// ------------------------------------------------------------------ 태엽 열쇠
defineDrawnSprite('icon_wind_up_key', 16, 16, (p) => {
  p.ellipse(4, 4.5, 3.5, 3, BRASS[2]);
  p.ellipse(4, 11.5, 3.5, 3, BRASS[2]);
  p.ellipse(4, 4.5, 1.5, 1.2, null);
  p.ellipse(4, 11.5, 1.5, 1.2, null);
  p.px(2, 3, BRASS[4]);
  p.px(2, 10, BRASS[4]);
  p.px(6, 6, BRASS[0]);
  p.px(6, 13, BRASS[0]);
  p.rect(6, 6.5, 3, 3, BRASS[1]);
  p.rect(8, 7, 7, 2, BRASS[2]);
  p.line(8, 7, 14, 7, BRASS[3]);
  p.rect(12, 9, 2, 3, BRASS[1]);
  p.px(14, 10, BRASS[1]);
  p.px(12, 9, BRASS[3]);
}, { outline: O });

defineArtifact({
  id: 'wind_up_key',
  name: '태엽 열쇠',
  desc: '열쇠 +2. 가진 열쇠 1개당 공격력 +0.25 (최대 +3)',
  quote: '감을수록 단단해진다.',
  rarity: 'common',
  tags: ['clockwork'],
  icon: 'icon_wind_up_key',
  pools: ['treasure', 'shop'],
  stats(m, power, w) {
    const keys = w?.player?.keys ?? 0;
    m.addStat('damage', Math.min(3, keys * 0.25) * power);
  },
  onAcquire(w, power) {
    grantPerCopy(w, 'wind_up_key', power, () => { w.player.keys = Math.min(99, w.player.keys + 2); });
    w.items.recomputeStats();
  },
  onUpdate(w, _dt, power) {
    grantPerCopy(w, 'wind_up_key', power, () => { w.player.keys = Math.min(99, w.player.keys + 2); });
    watch(w, 'wind_up_key', Math.min(12, w.player.keys));
  },
});

// ------------------------------------------------------------------ 째깍 폭탄 꾸러미
defineDrawnSprite('icon_tick_bomb', 16, 16, (p) => {
  p.circle(7.5, 9.5, 6, '#2a2a38');
  p.shadeSphere(7.5, 9.5, 6, 6, ['#101018', '#22222e', '#3a3a4c', '#5a5a70']);
  p.circle(7.5, 9.5, 3.4, '#f0e8d0');
  p.line(7.5, 9.5, 7.5, 7, '#2a2020');
  p.line(7.5, 9.5, 9.5, 10, '#c02030');
  p.px(7, 6, '#2a2020');
  p.px(11, 9, '#2a2020');
  p.px(7, 13, '#2a2020');
  p.px(4, 9, '#2a2020');
  p.rect(9, 3, 3, 2, '#7a7a88');
  p.line(11, 3, 13, 1, '#c8a060');
  p.px(14, 0, '#ffe080');
  p.px(13, 0, '#ff9030');
  p.px(15, 1, '#ff9030');
  p.px(4, 6, '#8a8aa0');
}, { outline: O });

defineArtifact({
  id: 'tick_bomb',
  name: '째깍 폭탄 꾸러미',
  desc: '폭탄 +3. 폭탄을 놓으면 주변 적이 잠시 멈춘다',
  quote: '째깍, 째깍, 쾅.',
  rarity: 'common',
  tags: ['clockwork'],
  icon: 'icon_tick_bomb',
  pools: ['treasure', 'shop'],
  onAcquire(w, power) {
    grantPerCopy(w, 'tick_bomb', power, () => { w.player.bombs = Math.min(99, w.player.bombs + 3); });
  },
  onUpdate(w, _dt, power) {
    grantPerCopy(w, 'tick_bomb', power, () => { w.player.bombs = Math.min(99, w.player.bombs + 3); });
  },
  onBomb(w, x, y, power) {
    const R = 70 + 10 * (power - 1);
    w.spawn(new RingFx(x, y, R, 0.45, '#f0d080', 2));
    w.sfx('ui_select', { vol: 0.5, pitch: 0.8 });
    for (const e of enemiesNear(w, x, y, R)) inflict(w, e, { kind: 'stun', duration: 1.2 + 0.3 * (power - 1) });
  },
});

// ------------------------------------------------------------------ 녹슨 못
defineDrawnSprite('icon_rusted_nail', 16, 16, (p) => {
  p.rect(1, 2, 7, 2, '#8a5a3a');
  p.line(1, 2, 7, 2, '#c08060');
  p.line(4, 4, 8, 9, '#9a6040');
  p.line(5, 4, 9, 9, '#6a3a20');
  p.line(8, 9, 13, 11, '#9a6040');
  p.line(8, 10, 13, 12, '#6a3a20');
  p.line(13, 11, 15, 13, '#7a4a30');
  p.px(6, 6, '#c86a30');
  p.px(10, 10, '#c86a30');
  p.px(3, 3, '#5a3020');
  p.px(12, 11, '#d88040');
  p.px(7, 13, '#8a5030');
  p.px(9, 14, '#6a3a20');
}, { outline: O });

defineArtifact({
  id: 'rusted_nail',
  name: '녹슨 못',
  desc: '공격이 15% 확률로 적을 약화시킨다 (받는 피해 +35%)',
  quote: '작은 상처가 큰 병이 된다.',
  rarity: 'common',
  tags: ['clockwork'],
  icon: 'icon_rusted_nail',
  pools: ['treasure', 'shop', 'curse'],
  modifyHit(w, t, hit, power) {
    if (isAttack(hit) && !t.hasStatus('weak') && roll(w, 0.15, power)) addHitStatus(w, t, hit, { kind: 'weak', duration: 4 });
  },
});

// ------------------------------------------------------------------ 톱니 포탑
defineDrawnSprite('icon_gear_turret', 16, 16, (p) => {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    p.rect(4 + Math.cos(a) * 4.5 - 1, 11 + Math.sin(a) * 3 - 1, 2, 2, BRASS[1]);
  }
  p.ellipse(4, 11, 3.6, 2.6, BRASS[2]);
  p.px(4, 11, BRASS[0]);
  p.line(7, 15, 9, 11, '#5a3a18');
  p.line(14, 15, 12, 11, '#5a3a18');
  p.ellipse(10.5, 8, 4.6, 3.8, '#d8a850');
  p.shadeSphere(10.5, 8, 4.6, 3.8, ramp('#c89848', 4));
  p.rect(6, 9, 9, 2, BRASS[1]);
  p.line(6, 9, 14, 9, BRASS[3]);
  p.ellipse(10.5, 7, 1.5, 1.5, '#3a2410');
  p.px(10, 7, '#ff7040');
  p.rect(12, 4, 4, 2, '#8a6a3a');
  p.line(12, 4, 15, 4, BRASS[3]);
  p.px(15, 2, '#ffd080');
}, { outline: O });

defineArtifact({
  id: 'gear_turret',
  name: '톱니 포탑',
  desc: '태엽 포탑이 졸졸 따라다니며 가까운 적을 쏜다',
  quote: '태엽이 다 풀릴 때까지 쏜다.',
  rarity: 'rare',
  tags: ['clockwork'],
  icon: 'icon_gear_turret',
  pools: ['treasure', 'shop', 'challenge'],
  onUpdate(w, _dt, power) {
    syncFamiliars(w, 'gear_turret', Math.min(3, power), (w2) => new GearTurret(w2), power);
  },
  onRemove(w) {
    syncFamiliars(w, 'gear_turret', 0, (w2) => new GearTurret(w2));
  },
});

// ------------------------------------------------------------------ 진자 추
defineDrawnSprite('icon_pendulum_weight', 16, 16, (p) => {
  p.rect(6, 0, 4, 2, BRASS[1]);
  p.line(8, 2, 10, 9, '#8a8a98');
  p.line(9, 2, 11, 9, '#5a5a68');
  p.circle(11, 11, 4, BRASS[2]);
  p.shadeSphere(11, 11, 4, 4, ramp('#c89848', 4));
  p.circle(11, 11, 1.4, BRASS[0]);
  p.px(10, 10, BRASS[4]);
  for (let i = 0; i < 6; i++) {
    const a = Math.PI * 0.55 + i * 0.13;
    p.px(8 + Math.cos(a) * 12, 2 + Math.sin(a) * 12, i % 2 ? '#c8c0b0' : '#8a8478');
  }
  p.px(1, 9, '#c8c0b0');
  p.px(2, 12, '#8a8478');
}, { outline: O });

defineArtifact({
  id: 'pendulum_weight',
  name: '진자 추',
  desc: '탄환이 부메랑처럼 되돌아오며 적을 꿰뚫는다 (탄환 한정). 넉백 +30%',
  quote: '떠난 것은 반드시 돌아온다.',
  rarity: 'rare',
  tags: ['clockwork'],
  icon: 'icon_pendulum_weight',
  pools: ['treasure', 'shop'],
  stats(m) {
    m.mulStat('knockback', 1.3);
  },
  onShoot(_w, p) {
    if (p.generation === 0 && !p.mem.lance) p.addBehavior(boomerangBehavior());
  },
});

// ------------------------------------------------------------------ 작은 혼천의
defineDrawnSprite('icon_armillary', 16, 16, (p) => {
  p.rect(5, 14, 6, 2, BRASS[1]);
  p.line(5, 14, 10, 14, BRASS[3]);
  p.line(8, 12, 8, 14, BRASS[0]);
  p.circle(8, 7, 3.3, '#3a6ac0');
  p.shadeSphere(8, 7, 3.3, 3.3, ['#1a2a6a', '#3a6ac0', '#6aa0e8', '#c0e0ff']);
  p.px(7, 6, '#7ac080');
  p.px(9, 8, '#7ac080');
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    p.px(8 + Math.cos(a) * 6.5, 7 + Math.sin(a) * 2.6, Math.sin(a) < 0 ? BRASS[2] : BRASS[3]);
    const rx = Math.cos(a) * 2.6;
    const ry = Math.sin(a) * 6;
    p.px(8 + rx * 0.7 - ry * 0.35, 7 + ry * 0.94, BRASS[2]);
  }
  p.px(14, 7, '#ffe880');
  p.px(2, 7, '#ffffff');
}, { outline: O });

defineArtifact({
  id: 'armillary',
  name: '작은 혼천의',
  desc: '세 번째 공격마다 탄환이 주위를 공전하다 강해져서 적에게 날아간다',
  quote: '하늘의 길을 손안에 담았다.',
  rarity: 'epic',
  tags: ['clockwork', 'star'],
  icon: 'icon_armillary',
  pools: ['treasure', 'shrine'],
  onAttack(w, angle, power) {
    w.vars.__armN = (w.vars.__armN ?? 0) + 1;
    const every = power >= 2 ? 2 : 3;
    w.vars.__armOn = w.vars.__armN % every === 0 ? w.time : -1;
    if (w.vars.__armOn >= 0 && isMelee(w)) {
      const pl = w.player;
      const p = new Projectile({
        team: 'player', x: pl.x + Math.cos(angle) * 8, y: pl.y - 5 + Math.sin(angle) * 6, angle, speed: 200,
        damage: dmg(w) * 1.2, radius: 3, range: 200, owner: pl, color: '#ffe880', light: 20,
      });
      p.generation = 1;
      p.addBehavior(orbitBehavior(1.2, 20));
      w.spawn(p);
    }
  },
  onShoot(w, p) {
    if (p.generation > 0 || p.mem.lance || w.vars.__armOn !== w.time) return;
    p.damage *= 1.5;
    p.color = '#ffe880';
    p.lightR = 22;
    p.addBehavior(orbitBehavior(1.2, 20));
  },
});

// ------------------------------------------------------------------ 메트로놈 심장
defineDrawnSprite('icon_metronome_heart', 16, 16, (p) => {
  p.poly([3, 15, 13, 15, 10.5, 2, 5.5, 2], '#8a3a2a');
  p.shadeSphere(7, 8, 7, 9, ['#4a1810', '#6a2a1c', '#8a3a2a', '#b05a40']);
  p.rect(2, 14, 12, 2, BRASS[1]);
  p.line(2, 14, 13, 14, BRASS[3]);
  p.circle(6.5, 10, 1.6, '#e02838');
  p.circle(9.5, 10, 1.6, '#e02838');
  p.poly([5, 10.5, 11, 10.5, 8, 13.5], '#e02838');
  p.px(6, 9, '#ff9aa8');
  p.line(8, 12, 12, 1, '#d8d8e0');
  p.rect(10, 4, 2, 2, BRASS[3]);
  p.px(13, 0, '#ffffff');
  p.px(3, 3, BRASS[3]);
  p.px(14, 6, BRASS[3]);
}, { outline: O });

function metronomeOn(w: { time: number; player: { lastHurtAt: number } }): boolean {
  return w.time - w.player.lastHurtAt >= 3;
}

defineArtifact({
  id: 'metronome_heart',
  name: '메트로놈 심장',
  desc: '3초 동안 피격당하지 않으면 공격 속도 +40%',
  quote: '똑, 딱. 심장도 박자를 탄다.',
  rarity: 'epic',
  tags: ['clockwork'],
  icon: 'icon_metronome_heart',
  pools: ['treasure', 'boss'],
  stats(m, power, w) {
    if (w?.player && metronomeOn(w)) m.mulStat('fireRate', 1 + 0.4 * power);
  },
  onUpdate(w, dt) {
    const on = metronomeOn(w) ? 1 : 0;
    const was = w.vars.__watch_metronome;
    watch(w, 'metronome', on);
    const p = w.player;
    if (on && was === 0) {
      shout(w, '템포!', '#ffd080');
      w.sfx('ui_select', { vol: 0.4, pitch: 1.3 });
    }
    if (on && Math.floor(w.time * 2) !== Math.floor((w.time - dt) * 2)) {
      w.particles.spawn({ x: p.x + (Math.floor(w.time * 2) % 2 ? 7 : -7), y: p.y - 12, vy: -15, life: 0.4, colors: ['#fff4c0', '#ffd080'], size: 1 });
    }
  },
});

// ------------------------------------------------------------------ 심연의 모래시계 (legendary)
defineDrawnSprite('icon_abyssal_hourglass', 16, 16, (p) => {
  p.poly([4, 2, 12, 2, 9, 8, 12, 14, 4, 14, 7, 8], '#3a2a58');
  p.poly([4, 2, 8, 2, 8, 8, 8, 14, 4, 14, 7, 8], '#4a3a70');
  p.poly([5.5, 13.5, 10.5, 13.5, 8, 10], '#b080ff');
  p.poly([6, 3, 10, 3, 8, 5.5], '#b080ff');
  p.line(8, 5, 8, 11, '#e0d0ff');
  p.px(7, 12, '#ffffff');
  p.rect(1, 0, 14, 2, '#1a1424');
  p.rect(1, 14, 14, 2, '#1a1424');
  p.line(1, 0, 14, 0, '#5a4a70');
  p.line(2, 2, 2, 13, '#2a2034');
  p.line(13, 2, 13, 13, '#2a2034');
  p.px(2, 7, '#9a6aff');
  p.px(13, 7, '#9a6aff');
  p.px(5, 4, '#8a7ab0');
  p.px(0, 8, '#d0b8ff');
  p.px(15, 9, '#d0b8ff');
}, { outline: '#06030c' });

defineDrawnSprite('fx_abyss_glass', 7, 9, (p) => {
  p.poly([1, 1, 6, 1, 4, 4.5, 6, 8, 1, 8, 3, 4.5], '#3a2a58');
  p.poly([2, 7.5, 5, 7.5, 3.5, 5.5], '#b080ff');
  p.rect(0, 0, 7, 1, '#1a1424');
  p.rect(0, 8, 7, 1, '#1a1424');
  p.px(3, 6, '#e0d0ff');
}, { outline: '#06030c' });

defineArtifact({
  id: 'abyssal_hourglass',
  name: '심연의 모래시계',
  desc: '공격 속도 +0.5. 피격당하면 3초간 시간이 멈춘다',
  quote: '시간도 심연 앞에서는 걸음을 멈춘다.',
  rarity: 'legendary',
  tags: ['clockwork', 'shadow'],
  icon: 'icon_abyssal_hourglass',
  pools: ['treasure', 'secret', 'curse'],
  unique: true,
  stats(m) {
    m.addStat('fireRate', 0.5);
  },
  onHurt(w) {
    if (!w.player.alive) return;
    timeStop(w, 3);
    shout(w, '시간 정지', '#d0b8ff');
  },
  onUpdate(w) {
    tickTimeStop(w);
  },
  onRoomEnter(w) {
    tickTimeStop(w);
  },
  onRemove(w) {
    w.vars.__tsEnd = Math.min(w.vars.__tsEnd ?? 0, w.time);
    tickTimeStop(w);
  },
  draw(w, r) {
    const p = w.player;
    const stopped = timeStopped(w);
    const bob = Math.sin(w.time * 2.2) * 1.5;
    const x = p.x - 10;
    const y = p.y - 20 + bob;
    if (stopped) r.circle(x, y, 7, '#9a6aff', 0.2 + 0.1 * Math.sin(w.time * 10));
    r.sprite('fx_abyss_glass', x, y, { rot: stopped ? Math.PI : Math.sin(w.time * 1.5) * 0.15 });
    if (fx.chance(0.05)) w.particles.spawn({ x: x + fx.range(-2, 2), y: y + 4, vy: 10, life: 0.6, colors: ['#b080ff', '#3a1a70'], size: 1 });
  },
});
