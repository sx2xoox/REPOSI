// Untagged trinkets: economy (coins, keys, bombs), defense (shields, soul
// hearts, invulnerability), bouncing shots, charm, mirror orbitals, cluster bombs.

import { defineArtifact } from '../../game/defs';
import type { World } from '../../game/world';
import { defineDrawnSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';
import { Bomb, Pickup } from '../../game/pickups';
import { TAU } from '../../engine/math';
import { O, addHitStatus, grantPerCopy, isAttack, roll, rollHit, spawnShards, stackMul, syncFamiliars, watch } from './lib';
import { MirrorShard } from './familiars';
import { proc } from './lib';
import { Enemy } from '../../game/enemy';
import { procReady } from '../../game/procs';

const dmg = (w: { player: { stats: { damage: number } } }) => w.player.stats.damage;
const GOLD = ['#6a4410', '#b07818', '#e8b830', '#ffe070', '#fff8c8'];

// ------------------------------------------------------------------ 금니
defineDrawnSprite('icon_gilded_tooth', 16, 16, (p) => {
  p.poly([3, 3, 6, 1.5, 8, 3, 10, 1.5, 13, 3, 13.5, 8, 12, 15, 10, 15, 8.5, 10, 7.5, 10, 6, 15, 4, 15, 2.5, 8], GOLD[2]);
  p.shadeSphere(7, 6, 7, 8, [GOLD[1], GOLD[2], GOLD[3], GOLD[4]]);
  p.line(8, 3, 8, 6, GOLD[1]);
  p.px(4, 4, '#ffffff');
  p.px(5, 3, '#ffffff');
  p.px(12, 12, GOLD[0]);
  p.px(14, 1, '#ffffff');
  p.px(15, 2, GOLD[3]);
}, { outline: O });

defineArtifact({
  id: 'gilded_tooth',
  name: '금니',
  desc: '동전 5개를 얻고, 동전이 많을수록 공격력이 오른다.',
  quote: '웃을 때마다 반짝인다.',
  rarity: 'common',
  tags: [],
  icon: 'icon_gilded_tooth',
  look: { trail: 'coin', mote: '#ffd040' },
  pools: ['treasure', 'shop'],
  stats(m, power, w) {
    const coins = w?.player?.coins ?? 0;
    m.addStat('damage', Math.min(2.5, Math.floor(coins / 10) * 0.25) * stackMul(power));
  },
  onAcquire(w, power) {
    grantPerCopy(w, 'gilded_tooth', power, () => { w.player.coins = Math.min(999, w.player.coins + 5); });
    w.items.recomputeStats();
  },
  onUpdate(w, _dt, power) {
    grantPerCopy(w, 'gilded_tooth', power, () => { w.player.coins = Math.min(999, w.player.coins + 5); });
    watch(w, 'gilded_tooth', Math.min(10, Math.floor(w.player.coins / 10)));
  },
});

// ------------------------------------------------------------------ 연금술사의 저울
defineDrawnSprite('icon_alchemist_scale', 16, 16, (p) => {
  p.rect(7, 2, 2, 12, GOLD[1]);
  p.line(7, 2, 7, 13, GOLD[3]);
  p.rect(4, 14, 8, 2, GOLD[1]);
  p.line(4, 14, 11, 14, GOLD[3]);
  p.line(1, 4, 14, 3, GOLD[2]);
  p.circle(8, 2, 1.4, GOLD[3]);
  p.line(1, 4, 0, 9, '#8a8478');
  p.line(1, 4, 3, 9, '#8a8478');
  p.line(14, 3, 12, 7, '#8a8478');
  p.line(14, 3, 15, 7, '#8a8478');
  p.ellipse(1.5, 9.5, 2.5, 1, GOLD[1]);
  p.ellipse(13.5, 7.5, 2.5, 1, GOLD[1]);
  p.circle(1.5, 8, 1.3, GOLD[3]);
  p.px(1, 7, '#ffffff');
  p.rect(12, 5, 3, 2, '#3a3a48');
  p.px(13, 4, '#c8a060');
}, { outline: O });

defineArtifact({
  id: 'alchemist_scale',
  name: '연금술사의 저울',
  desc: '20금 모을 때마다 폭탄과 열쇠를 번갈아 얻는다.',
  quote: '동전 한 닢의 무게는 생각보다 다양하다.',
  rarity: 'common',
  tags: [],
  icon: 'icon_alchemist_scale',
  look: { mote: '#a080ff', hit: '#ffd040' },
  pools: ['shop', 'treasure'],
  onPickup(w, kind, power) {
    if (kind !== 'coin' && kind !== 'nickel' && kind !== 'dime') return;
    const p = w.player;
    const threshold = Math.max(10, 20 - 3 * (power - 1));
    const value = (kind === 'coin' ? 1 : kind === 'nickel' ? 5 : 10) * Math.max(1, Math.round(p.stats.greed));
    w.vars.__scaleGold = (w.vars.__scaleGold ?? 0) + value;
    while (w.vars.__scaleGold >= threshold) {
      w.vars.__scaleGold -= threshold;
      const supply = w.vars.__scaleSupply ?? 0;
      w.spawn(new Pickup(supply % 2 === 0 ? 'bomb' : 'key', p.x, p.y).pop());
      w.vars.__scaleSupply = supply + 1;
    }
    w.floatText(p.x, p.y - 24, `보급 ${w.vars.__scaleGold}/${threshold}`, '#ffd040');
    proc(w, 'alchemist_scale');
    w.particles.burst(p.x, p.y - 6, { count: 12, speed: [20, 70], life: [0.3, 0.6], colors: ['#ffffff', GOLD[3], '#a080ff'], size: [1, 2], additive: true });
    w.sfx('coin', { pitch: 1.4 });
  },
});

// ------------------------------------------------------------------ 종이 부적
defineDrawnSprite('icon_paper_ward', 16, 16, (p) => {
  p.rect(4, 0, 8, 15, '#f0d870');
  p.shadeVertical(4, 0, 8, 15, ['#c8a840', '#e8c860', '#f8e488']);
  p.line(4, 0, 11, 0, '#fff4b0');
  p.rect(5, 1, 6, 1, '#c02030');
  p.rect(5, 13, 6, 1, '#c02030');
  p.line(8, 3, 8, 11, '#c02030');
  p.line(6, 4, 10, 4, '#c02030');
  p.line(6, 7, 10, 6, '#c02030');
  p.line(6, 9, 7, 11, '#c02030');
  p.line(10, 9, 9, 11, '#c02030');
  p.circle(8, 7, 1, '#e8404a');
  p.px(12, 15, '#c8a840');
  p.px(3, 15, '#c8a840');
}, { outline: O });

defineArtifact({
  id: 'paper_ward',
  name: '종이 부적',
  desc: '전투마다 피해를 한 번 막는 보호막이 생긴다.',
  quote: '한 번은 막아준다. 딱 한 번.',
  rarity: 'common',
  tags: [],
  icon: 'icon_paper_ward',
  look: { aura: '#d8f4ff', mote: '#f0d870' },
  pools: ['treasure', 'shop', 'shrine'],
  onRoomEnter(w, power) {
    if (w.node.cleared) return;
    const p = w.player;
    if (p.shields < power) {
      p.shields = power;
      proc(w, 'paper_ward');
      w.particles.burst(p.x, p.y - 6, { count: 12, speed: [20, 60], life: [0.3, 0.6], colors: ['#ffffff', '#c8f0ff', '#f0d870'], size: [1, 2] });
    }
  },
  draw(w, r) {
    const p = w.player;
    if (p.shields <= 0) return;
    const t = w.time;
    r.circle(p.x, p.y - 6, 12, '#a8e0ff', 0.1 + 0.04 * Math.sin(t * 4));
    r.ring(p.x, p.y - 6, 12 + Math.sin(t * 4) * 0.5, '#d8f4ff', 1, 0.55);
    for (let i = 0; i < p.shields + 1; i++) {
      const a = t * 2 + (i / (p.shields + 1)) * TAU;
      r.rect(p.x + Math.cos(a) * 12 - 1, p.y - 6 + Math.sin(a) * 10 - 2, 3, 4, '#f0d870', 0.9);
      r.rect(p.x + Math.cos(a) * 12, p.y - 6 + Math.sin(a) * 10 - 1, 1, 2, '#c02030', 0.9);
    }
  },
});

// ------------------------------------------------------------------ 영혼 밀랍
defineDrawnSprite('icon_soul_wax', 16, 16, (p) => {
  p.rect(4, 8, 8, 7, '#d8e4f0');
  p.shadeVertical(4, 8, 8, 7, ['#8a9ab8', '#b8c8e0', '#e8f0ff']);
  p.ellipse(8, 8, 4, 1.4, '#f4f8ff');
  p.px(4, 9, '#f4f8ff');
  p.px(4, 10, '#f4f8ff');
  p.px(11, 9, '#c8d8f0');
  p.line(8, 5, 8, 7, '#3a3a50');
  p.ellipse(8, 3, 2.6, 3.2, '#7ab8ff');
  p.ellipse(8, 3.8, 1.5, 2, '#d8f0ff');
  p.px(7, 3, '#1a2a50');
  p.px(9, 3, '#1a2a50');
  p.px(8, 0, '#5a90e8');
  p.px(12, 2, '#a8d0ff');
  p.px(3, 4, '#a8d0ff');
}, { outline: O });

defineArtifact({
  id: 'soul_wax',
  name: '영혼 밀랍',
  desc: '영혼 하트를 하나 얻고, 새 층마다 반 칸씩 더 얻는다.',
  quote: '영혼을 녹여 굳힌 밀랍.',
  rarity: 'common',
  tags: [],
  icon: 'icon_soul_wax',
  look: { mote: '#a8d8ff', aura: '#8ac0ff' },
  pools: ['treasure', 'shop', 'shrine'],
  onAcquire(w, power) {
    grantPerCopy(w, 'soul_wax', power, () => w.player.addSoul(2));
  },
  onUpdate(w, _dt, power) {
    grantPerCopy(w, 'soul_wax', power, () => w.player.addSoul(2));
  },
  onFloorStart(w, power) {
    w.player.addSoul(power);
    proc(w, 'soul_wax');
  },
});

// ------------------------------------------------------------------ 돌거북 부적
defineDrawnSprite('icon_stone_amulet', 16, 16, (p) => {
  p.line(3, 0, 8, 4, '#8a6a4a');
  p.line(13, 0, 8, 4, '#8a6a4a');
  p.ellipse(8, 10, 5.5, 4.5, '#8a8a78');
  p.shadeSphere(8, 10, 5.5, 4.5, ramp('#9a9a86', 4));
  p.line(5, 9, 11, 9, '#5a5a4a');
  p.line(8, 6, 8, 13, '#5a5a4a');
  p.line(5, 12, 11, 12, '#5a5a4a');
  p.circle(8, 4.8, 1.8, '#a8a894');
  p.px(7, 4, '#2a2a20');
  p.px(9, 4, '#2a2a20');
  p.ellipse(2.5, 9, 1.3, 1, '#7a7a68');
  p.ellipse(13.5, 9, 1.3, 1, '#7a7a68');
  p.ellipse(3, 13.5, 1.3, 1, '#7a7a68');
  p.ellipse(13, 13.5, 1.3, 1, '#7a7a68');
  p.px(6, 7, '#d8d8c0');
  p.px(10, 10, '#5aa080');
}, { outline: O });

defineArtifact({
  id: 'stone_amulet',
  name: '돌거북 부적',
  desc: '최대 체력이 늘고, 맞으면 주변 탄환을 지우고 무적이 길어진다.',
  signature: '피격당하면 돌 파편이 튀어 주변 적 탄환을 지운다',
  quote: '느리지만, 단단하다.',
  rarity: 'common',
  tags: [],
  icon: 'icon_stone_amulet',
  look: { aura: '#a09890', step: '#c8c0b8' },
  pools: ['treasure', 'boss', 'shop'],
  stats(m, power) {
    m.addStat('maxHearts', power);
    m.mulStat('invuln', 1 + 0.3 * power);
  },
  onHurt(w, _a, power) {
    const p = w.player;
    if (!p.alive) return;
    const R = 46 + 10 * (power - 1);
    w.clearEnemyBullets(p.x, p.y, R);
    w.particles.burst(p.x, p.y - 6, { count: 18, speed: [60, 160], life: [0.25, 0.5], colors: ['#e0d8d0', '#a09890', '#605850'], shape: 'square', size: [1, 3], drag: 3, vrot: 8 });
    proc(w, 'stone_amulet');
  },
});

// ------------------------------------------------------------------ 등잔 기름
defineDrawnSprite('icon_lamp_oil', 16, 16, (p) => {
  p.ellipse(8, 10, 5.5, 5, '#a8643a');
  p.rect(6, 3, 4, 4, '#a8643a');
  p.shadeSphere(7.5, 9, 6, 6, ramp('#b06a3c', 4));
  p.rect(5, 2, 6, 2, '#7a4428');
  p.line(5, 2, 10, 2, '#c88a5a');
  p.line(3, 9, 13, 9, '#e8c070');
  p.line(3, 11, 13, 11, '#6a3a20');
  p.px(5, 7, '#e8b080');
  p.ellipse(13, 3, 1.4, 1.8, '#ffc040');
  p.px(13, 2, '#fff4c0');
  p.ellipse(8, 0.5, 1, 0.8, '#ffc040');
}, { outline: O });

defineArtifact({
  id: 'lamp_oil',
  name: '등잔 기름',
  desc: '방을 클리어할 때마다 등불 게이지가 20% 찬다.',
  quote: '등불은 기름으로 산다.',
  rarity: 'common',
  tags: [],
  icon: 'icon_lamp_oil',
  look: { mote: '#ffc040', step: '#ffc040' },
  pools: ['treasure', 'shop', 'shrine'],
  onRoomClear(w, power) {
    const p = w.player;
    p.addEmber(20 * power);
    proc(w, 'lamp_oil');
    w.particles.burst(p.x, p.y - 8, { count: 14, speed: [20, 60], life: [0.4, 0.8], colors: ['#fff0a0', '#ffc040', '#c06010'], size: [1, 2], additive: true, light: 3 });
  },
});

// ------------------------------------------------------------------ 옥구슬
defineDrawnSprite('icon_jade_marble', 16, 16, (p) => {
  p.circle(8, 8, 6.5, '#3aa070');
  p.shadeSphere(8, 8, 6.5, 6.5, ['#145a3a', '#2a8058', '#3aa070', '#6ad0a0', '#c0f0d8']);
  for (let i = 0; i < 14; i++) {
    const a = i * 0.5;
    const r = 1 + i * 0.35;
    p.px(8 + Math.cos(a) * r, 8 + Math.sin(a) * r, i % 2 ? '#e0fff0' : '#9ae8c0');
  }
  p.px(5, 4, '#ffffff');
  p.px(4, 5, '#ffffff');
  p.px(1, 13, '#9ae8c0');
  p.px(14, 2, '#9ae8c0');
}, { outline: O });

defineArtifact({
  id: 'jade_marble',
  name: '옥구슬',
  desc: '탄환이 벽에 두 번 튕기고, 사거리가 늘어난다.',
  quote: '튕길 때마다 맑은 소리가 난다.',
  rarity: 'common',
  tags: [],
  icon: 'icon_jade_marble',
  look: { shot: '#5ad8a0', shape: 'bubble' },
  pools: ['treasure', 'shop', 'challenge'],
  stats(m, power) {
    m.addStat('bounce', 2 * power);
    m.mulStat('range', 1 + 0.15 * power);
  },
});

// ------------------------------------------------------------------ 탐욕의 지갑
defineDrawnSprite('icon_greedy_purse', 16, 16, (p) => {
  p.ellipse(8, 10, 6.5, 5, '#8a3a7a');
  p.shadeSphere(8, 10, 6.5, 5, ramp('#9a4a8a', 4));
  p.rect(3, 4, 10, 2, GOLD[1]);
  p.line(3, 4, 12, 4, GOLD[3]);
  for (let x = 4; x <= 12; x += 2) p.px(x, 6, '#ffffff');
  p.ellipse(8, 3, 2.5, 1.5, GOLD[2]);
  p.circle(13.5, 13.5, 2, GOLD[2]);
  p.circle(2, 13.5, 1.7, GOLD[2]);
  p.px(13, 13, GOLD[4]);
  p.px(2, 13, GOLD[4]);
  p.px(6, 9, '#c88ab8');
  p.px(10, 1, GOLD[3]);
}, { outline: O });

defineArtifact({
  id: 'greedy_purse',
  name: '탐욕의 지갑',
  desc: '적을 처치하면 가끔 동전이 나오지만, 맞으면 동전을 흘린다.',
  quote: '주머니가 무거울수록 발은 느려진다.',
  rarity: 'rare',
  tags: [],
  icon: 'icon_greedy_purse',
  look: { mote: '#ffd040', hit: '#ffe060' },
  pools: ['shop', 'curse', 'treasure'],
  onKill(w, e, power) {
    if (!e.isMinion && roll(w, 0.12, power, 0.005)) {
      w.spawn(new Pickup('coin', e.x, e.y).pop());
      proc(w, 'greedy_purse');
    }
  },
  onHurt(w) {
    const p = w.player;
    const n = Math.min(2, p.coins);
    if (n <= 0) return;
    p.coins -= n;
    for (let i = 0; i < n; i++) {
      const c = new Pickup('coin', p.x, p.y - 4).pop(w.rng.angle(), w.rng.range(70, 120));
      c.grace = 0.8;
      w.spawn(c);
    }
    w.sfx('coin', { pitch: 0.7, vol: 0.6 });
  },
});

// ------------------------------------------------------------------ 거울 파편
defineDrawnSprite('icon_mirror_shard', 16, 16, (p) => {
  p.poly([3, 15, 6, 1, 13, 4, 11, 13], '#a8c0d8');
  p.poly([4, 13, 6.5, 2.5, 11.5, 5, 9.5, 12], '#d8ecff');
  p.line(6, 5, 9, 10, '#ffffff');
  p.line(7, 4, 10, 8, '#ffffff');
  p.px(5, 10, '#7890b0');
  p.px(10, 12, '#7890b0');
  p.line(11, 13, 12, 6, '#6a80a0');
  p.px(14, 1, '#ffffff');
  p.px(1, 6, '#d8ecff');
  p.px(15, 12, '#d8ecff');
}, { outline: '#141c30' });

defineArtifact({
  id: 'mirror_shard',
  name: '거울 파편',
  desc: '거울 조각이 주위를 돌며 적 탄환을 되돌려 보낸다.',
  quote: '깨진 거울도 빛은 되돌려준다.',
  rarity: 'rare',
  tags: [],
  icon: 'icon_mirror_shard',
  look: { mote: '#e0f0ff', hit: '#e0f0ff' },
  pools: ['treasure', 'shop', 'secret'],
  onUpdate(w, _dt, power) {
    syncFamiliars(w, 'mirror_shard', Math.min(2, power), (w2) => new MirrorShard(w2), power);
  },
  onRemove(w) {
    syncFamiliars(w, 'mirror_shard', 0, (w2) => new MirrorShard(w2));
  },
});

// ------------------------------------------------------------------ 달콤한 향주머니
defineDrawnSprite('icon_sweet_sachet', 16, 16, (p) => {
  p.ellipse(8, 10.5, 5.5, 4.5, '#ff8ac8');
  p.poly([4, 7.5, 12, 7.5, 10.5, 4, 5.5, 4], '#ff8ac8');
  p.shadeSphere(8, 9.5, 6, 6, ramp('#f07ab8', 4));
  p.line(4, 6, 12, 6, '#a02060');
  p.poly([8, 6, 4, 3.5, 4, 7.5], '#e02868');
  p.poly([8, 6, 12, 3.5, 12, 7.5], '#e02868');
  p.px(8, 6, '#ffd0e8');
  p.circle(6.5, 10.5, 1.2, '#ffffff');
  p.circle(9, 10.5, 1.2, '#ffffff');
  p.poly([5.5, 11, 10, 11, 7.8, 13.2], '#ffffff');
  p.px(13, 1, '#ffb0d8');
  p.px(14, 3, '#ff7ad9');
  p.px(2, 2, '#ffb0d8');
}, { outline: O });

defineArtifact({
  id: 'sweet_sachet',
  name: '달콤한 향주머니',
  desc: '체력이 넉넉한 적을 공격하면 가끔 매혹한다.',
  detail: '보스는 매혹되지 않는다.',
  quote: '적도 향기에는 약하다.',
  rarity: 'rare',
  tags: [],
  icon: 'icon_sweet_sachet',
  look: { shot: '#ff9ad8', trail: 'petal', hit: '#ffc0e8' },
  pools: ['treasure', 'shop', 'shrine'],
  modifyHit(w, t, hit, power) {
    if (!(t instanceof Enemy) || t.isBoss || t.hasStatus('charm') || t.hp < t.maxHp * 0.5 || t.hp <= hit.damage) return;
    if ((w.vars.__sachetReady ?? -1) > w.time || !procReady(w, 'a:sweet_sachet')) return;
    if (addHitStatus(w, t, hit, { kind: 'charm', duration: 4 })) w.vars.__sachetReady = w.time + Math.max(3, 6 - (power - 1));
  },
});

// ------------------------------------------------------------------ 산탄 화약통
defineDrawnSprite('icon_cluster_powder', 16, 16, (p) => {
  p.ellipse(7.5, 10, 5.5, 5, '#8a5a30');
  p.rect(2.5, 6, 10, 8, '#8a5a30');
  p.shadeSphere(7, 9.5, 6.5, 6.5, ramp('#9a6a38', 4), { dither: false });
  p.ellipse(7.5, 5.8, 5, 1.6, '#c09060');
  p.ellipse(7.5, 5.8, 3, 0.9, '#2a1a10');
  p.line(2, 8, 13, 8, '#3a3a48');
  p.line(2, 12, 13, 12, '#3a3a48');
  p.px(3, 8, '#9a9ab0');
  p.px(3, 12, '#9a9ab0');
  p.px(6, 10, '#e8d0a0');
  p.px(8, 10, '#e8d0a0');
  p.px(7, 11, '#e8d0a0');
  p.line(9, 5, 12, 2, '#c8a060');
  p.px(13, 1, '#ffe080');
  p.px(14, 0, '#ffffff');
  p.px(12, 0, '#ff9030');
  p.px(14, 2, '#ff9030');
  p.rect(0, 2, 2, 2, '#3a3a48');
  p.px(1, 1, '#ffb040');
  p.rect(14, 8, 2, 2, '#3a3a48');
  p.px(15, 7, '#ffb040');
  p.rect(1, 14, 2, 2, '#3a3a48');
}, { outline: O });

const bombWatch = new WeakMap<World, Map<Bomb, unknown>>();

defineArtifact({
  id: 'cluster_powder',
  name: '산탄 화약통',
  desc: '폭탄 2개를 얻고, 내 폭탄이 터지면 불붙은 파편이 튄다.',
  quote: '하나가 터지면 여럿이 터진다.',
  rarity: 'epic',
  tags: [],
  icon: 'icon_cluster_powder',
  look: { mote: '#ffb040', aura: '#ff7a20' },
  pools: ['treasure', 'shop', 'secret'],
  onAcquire(w, power) {
    grantPerCopy(w, 'cluster_powder', power, () => { w.player.bombs = Math.min(99, w.player.bombs + 2); });
  },
  onUpdate(w, _dt, power) {
    grantPerCopy(w, 'cluster_powder', power, () => { w.player.bombs = Math.min(99, w.player.bombs + 2); });
    let m = bombWatch.get(w);
    if (!m) bombWatch.set(w, (m = new Map()));
    for (const e of w.entities) if (e instanceof Bomb && e.owner === 'player' && !e.dead && !m.has(e)) m.set(e, w.room);
    for (const [b, room] of m) {
      if (room !== w.room) {
        m.delete(b);
        continue;
      }
      if (!b.dead) continue;
      m.delete(b);
      if (b.fuse > 0) continue;
      proc(w, 'cluster_powder');
      spawnShards(w, b.x, b.y - 4, {
        count: 8 + 2 * (power - 1), damage: dmg(w) * 1.2 + 6, sprite: 'proj_shrapnel', color: '#ffb040', speed: 240, range: 120, radius: 2.5,
        statuses: [{ kind: 'burn', duration: 2, power: dmg(w) * 0.3 }], spectral: true,
      });
    }
  },
});
