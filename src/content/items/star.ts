// 별빛 (star) artifacts: luck, crits, marks, homing, orbitals and two legendaries
// (광휘의 창: shots fuse into a piercing lance · 품 안의 태양: a sun orbits you).

import { defineArtifact } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { type PixelPainter, ramp } from '../../engine/painter';
import { Projectile } from '../../game/projectile';
import { angleDiff } from '../../engine/math';
import { fx } from '../../engine/rng';
import type { World } from '../../game/world';
import { O, addHitStatus, isAttack, isMelee, isPrimary, roll, rollHit, spawnShards, syncFamiliars } from './lib';
import { LanternSun, MoonSatellite } from './familiars';
import { proc } from './lib';

const dmg = (w: { player: { stats: { damage: number } } }) => w.player.stats.damage;

function star(p: PixelPainter, cx: number, cy: number, ro: number, ri: number, n: number, color: string, rot = -Math.PI / 2): void {
  const pts: number[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? ri : ro;
    const a = rot + (i / (n * 2)) * Math.PI * 2;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  p.poly(pts, color);
}

// ------------------------------------------------------------------ 떨어진 별 조각
defineDrawnSprite('icon_fallen_star', 16, 16, (p) => {
  p.px(1, 14, '#8a70d8');
  p.px(2, 13, '#b8a8ff');
  p.px(3, 13, '#8a70d8');
  p.px(4, 11, '#d8c8ff');
  p.px(5, 11, '#b8a8ff');
  star(p, 9.5, 7, 6.2, 2.7, 5, '#ffd84a');
  p.shadeSphere(9.5, 7, 6, 6, ramp('#ffcc40', 4), { dither: false });
  p.px(8, 5, '#fffbe0');
  p.px(9, 5, '#fffbe0');
  p.px(8, 6, '#fffbe0');
  p.px(8, 8, '#5a3a10');
  p.px(11, 8, '#5a3a10');
}, { outline: '#2a1a08' });

defineArtifact({
  id: 'fallen_star',
  name: '떨어진 별 조각',
  desc: '행운 +1, 치명타 +6%. 치명타 시 등불 게이지 +3',
  signature: '치명타가 터지면 별빛이 번쩍이며 등불 게이지가 찬다',
  quote: '소원은 이미 이루어졌다. 아마도.',
  rarity: 'common',
  tags: ['star'],
  icon: 'icon_fallen_star',
  look: { shot: '#ffe890', shape: 'star', trail: 'stardust' },
  pools: ['treasure', 'shop', 'shrine'],
  stats(m, power) {
    m.addStat('luck', power);
    m.addStat('critChance', 0.06 * power);
  },
  onHit(w, t, hit, power) {
    if (!hit.crit || !isAttack(hit)) return;
    w.player.addEmber(3 * power);
    w.particles.burst(t.x, t.y - t.z - 6, { count: 6, speed: [30, 90], life: [0.2, 0.4], colors: ['#ffffff', '#fff2b0', '#ffe890'], shape: 'spark', size: [1, 2], additive: true });
    proc(w, 'fallen_star');
  },
});

// ------------------------------------------------------------------ 별바늘
defineDrawnSprite('icon_constellation_needle', 16, 16, (p) => {
  p.line(2, 14, 11, 5, '#c0c8d8');
  p.line(3, 14, 11, 6, '#8a90a0');
  p.line(1, 15, 2, 14, '#ffffff');
  star(p, 12.5, 3.5, 3.5, 1.4, 4, '#ffd23a', 0);
  p.px(12, 3, '#ffffff');
  p.px(13, 3, '#fffbe0');
  p.px(9, 11, '#d8c8ff');
  p.px(7, 12, '#b8a8ff');
  p.px(6, 14, '#8a70d8');
  p.px(11, 10, '#b8a8ff');
  p.px(13, 9, '#ffffff');
  p.px(3, 7, '#ffffff');
  p.px(5, 4, '#d8c8ff');
}, { outline: '#141030' });

defineArtifact({
  id: 'constellation_needle',
  name: '별바늘',
  desc: '공격이 15% 확률로 별표식을 새긴다 (다음 공격 치명타)',
  quote: '별자리를 꿰매는 바늘.',
  rarity: 'common',
  tags: ['star'],
  icon: 'icon_constellation_needle',
  look: { orbit: '#d8c8ff', hit: '#ffe890' },
  pools: ['treasure', 'shop'],
  modifyHit(w, t, hit, power) {
    if (isAttack(hit) && !t.hasStatus('mark') && rollHit(w, hit, 0.15, power)) addHitStatus(w, t, hit, { kind: 'mark', duration: 6 });
  },
});

// ------------------------------------------------------------------ 성도
defineDrawnSprite('icon_star_chart', 16, 16, (p) => {
  p.rect(2, 3, 12, 10, '#1e2450');
  p.shadeVertical(2, 3, 12, 10, ['#141838', '#1e2450', '#2a3270']);
  p.rect(0, 2, 3, 12, '#d8c8a0');
  p.rect(13, 2, 3, 12, '#d8c8a0');
  p.line(1, 2, 1, 13, '#f4ead0');
  p.line(14, 2, 14, 13, '#f4ead0');
  p.line(2, 2, 2, 13, '#a89870');
  p.line(15, 2, 15, 13, '#a89870');
  const pts = [4, 10, 6, 6, 9, 8, 11, 4, 12, 9];
  for (let i = 0; i + 3 < pts.length; i += 2) p.line(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], '#5a6ab8');
  for (let i = 0; i < pts.length; i += 2) p.px(pts[i], pts[i + 1], '#ffe880');
  p.px(11, 4, '#ffffff');
  p.px(7, 11, '#8a9ae0');
}, { outline: O });

defineArtifact({
  id: 'star_chart',
  name: '성도',
  desc: '탄환이 적을 쫓아간다 (탄환 한정). 사거리 +10%',
  quote: '길을 잃은 탄환은 없다.',
  rarity: 'rare',
  tags: ['star'],
  icon: 'icon_star_chart',
  look: { trail: 'stardust', orbit: '#b8a8ff' },
  pools: ['treasure', 'shop', 'boss'],
  stats(m, power) {
    m.addStat('homing', 2.6 * power);
    m.mulStat('range', 1.1);
  },
});

// ------------------------------------------------------------------ 작은 달
defineDrawnSprite('icon_moon_satellite', 16, 16, (p) => {
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    if (i % 2) continue;
    p.px(8 + Math.cos(a) * 7.3, 8 + Math.sin(a) * 4.2, '#8a86c8');
  }
  p.circle(8, 8, 4.6, '#d8d4e8');
  p.shadeSphere(8, 8, 4.6, 4.6, ['#5a5878', '#9a96b8', '#d8d4e8', '#ffffff']);
  p.px(9, 9, '#8a86a8');
  p.px(10, 9, '#8a86a8');
  p.px(6, 10, '#9a96b8');
  p.px(9, 6, '#b0acc8');
  p.circle(14, 5, 1.3, '#ffe880');
  p.px(14, 5, '#ffffff');
}, { outline: '#14102a' });

defineArtifact({
  id: 'moon_satellite',
  name: '작은 달',
  desc: '작은 달이 주위를 돌며 적 탄환을 막고 적을 친다',
  quote: '작은 달에게도 중력은 있다.',
  rarity: 'rare',
  tags: ['star'],
  icon: 'icon_moon_satellite',
  look: { mote: '#e8e8ff' },
  pools: ['treasure', 'shop', 'shrine'],
  onUpdate(w, _dt, power) {
    syncFamiliars(w, 'moon_satellite', Math.min(3, power), (w2) => new MoonSatellite(w2), power);
  },
  onRemove(w) {
    syncFamiliars(w, 'moon_satellite', 0, (w2) => new MoonSatellite(w2));
  },
});

// ------------------------------------------------------------------ 복나방
defineDrawnSprite('icon_fortune_moth', 16, 16, (p) => {
  const g = '#e8b840';
  p.poly([7, 6, 2, 1, 0, 5, 2, 9, 7, 8.5], g);
  p.poly([9, 6, 14, 1, 16, 5, 14, 9, 9, 8.5], g);
  p.poly([7, 8.5, 2.5, 10, 3, 14, 6, 13.5, 7.5, 10.5], '#c8902c');
  p.poly([9, 8.5, 13.5, 10, 13, 14, 10, 13.5, 8.5, 10.5], '#c8902c');
  p.line(2, 1, 0, 5, '#fff0b0');
  p.line(14, 1, 16, 5, '#fff0b0');
  p.px(1, 3, '#fff8d8');
  p.circle(3.5, 5, 1.6, '#5a2a90');
  p.circle(12.5, 5, 1.6, '#5a2a90');
  p.px(3, 5, '#ffe880');
  p.px(12, 5, '#ffe880');
  p.px(5, 11.5, '#8a5a18');
  p.px(11, 11.5, '#8a5a18');
  p.rect(7, 4, 2, 10, '#5a3a1a');
  p.rect(7, 4, 2, 2, '#9a7a4a');
  p.line(7, 4, 5, 0, '#5a3a1a');
  p.line(8, 4, 10, 0, '#5a3a1a');
  p.px(5, 0, '#ffe880');
  p.px(10, 0, '#ffe880');
}, { outline: O });

defineArtifact({
  id: 'fortune_moth',
  name: '복나방',
  desc: '행운 +2. 방 클리어 시 25% 확률로 보상이 하나 더',
  quote: '불빛을 따라온 행운.',
  rarity: 'rare',
  tags: ['star'],
  icon: 'icon_fortune_moth',
  look: { mote: '#ffe880', step: '#ffe880' },
  pools: ['treasure', 'shop', 'shrine'],
  stats(m, power) {
    m.addStat('luck', 2 * power);
  },
  onRoomClear(w, power) {
    if (w.node.kind !== 'normal' || !roll(w, 0.25, power, 0)) return;
    const pos = w.room.nearestFree(w.room.centerX + 18, w.room.centerY, 6);
    w.dropRandom(pos.x, pos.y, 'room');
    proc(w, 'fortune_moth');
    w.particles.burst(pos.x, pos.y - 4, { count: 14, speed: [20, 70], life: [0.4, 0.8], colors: ['#ffffff', '#ffe880', '#e8b840'], size: [1, 2], additive: true });
  },
});

// ------------------------------------------------------------------ 혜성 꼬리
defineDrawnSprite('icon_comet_tail', 16, 16, (p) => {
  p.poly([0, 15, 9, 5, 12, 8], '#5a40a8');
  p.poly([2, 14, 9.5, 5.5, 11.5, 7.5], '#9a80e8');
  p.poly([5, 11.5, 10, 6, 11, 7], '#e0d8ff');
  p.circle(11.5, 4.5, 3.4, '#e8e0ff');
  p.shadeSphere(11.5, 4.5, 3.4, 3.4, ['#9a80e8', '#d8ccff', '#ffffff'], { dither: false });
  p.px(14, 1, '#ffffff');
  p.px(3, 9, '#d8c8ff');
  p.px(7, 14, '#b8a8ff');
  p.px(15, 7, '#ffe880');
}, { outline: '#140c30' });

defineArtifact({
  id: 'comet_tail',
  name: '혜성 꼬리',
  desc: '치명타 피해 +50%. 치명타가 별 조각 3개를 흩뿌린다',
  quote: '빛은 지나간 자리에 남는다.',
  rarity: 'epic',
  tags: ['star'],
  icon: 'icon_comet_tail',
  look: { trail: 'comet', shot: '#d8c8ff', grow: 0.5 },
  pools: ['treasure', 'boss', 'shrine', 'challenge'],
  stats(m, power) {
    m.addStat('critMult', 0.5 * power);
  },
  onHit(w, t, hit, power) {
    if (!hit.crit || !isPrimary(hit)) return;
    spawnShards(w, t.x, t.y - t.z - 4, { count: 2 + power, damage: dmg(w) * 0.55, sprite: 'proj_star_shard', color: '#d8c8ff', speed: 180, range: 160, homing: 6, spectral: true });
  },
});

// ------------------------------------------------------------------ 광휘의 창 (legendary)
defineDrawnSprite('proj_radiant_lance', 24, 7, (p) => {
  p.poly([0, 3.5, 3, 1.5, 16, 2, 16, 5, 3, 5.5], '#ffd860');
  p.line(1, 3, 16, 3, '#fffbe0');
  p.line(2, 4, 16, 4, '#ffe890');
  p.poly([15, 0, 24, 3.5, 15, 7, 17, 3.5], '#ffffff');
  p.poly([16.5, 1.5, 22, 3.5, 16.5, 5.5], '#fff4b0');
}, { outline: '#7a4a08', origin: [16, 3] });

defineDrawnSprite('icon_radiant_lance', 16, 16, (p) => {
  p.line(1, 15, 10, 6, '#c89030');
  p.line(2, 15, 10, 7, '#8a5a18');
  p.line(1, 14, 9, 6, '#ffe890');
  p.rect(3, 11, 2, 2, '#ffffff');
  p.poly([9, 7, 11, 2, 15, 1, 14, 5], '#ffffff');
  p.poly([10, 6, 11.5, 2.5, 14, 2, 13.5, 4.5], '#fff4b0');
  p.px(15, 0, '#ffffff');
  p.px(12, 0, '#ffe890');
  p.px(15, 4, '#ffe890');
  p.px(9, 2, '#ffd860');
  p.px(14, 7, '#ffd860');
}, { outline: '#4a2a04' });

const lanceReg = new WeakMap<World, { t: number; p: Projectile }>();

function makeLance(w: World, p: Projectile, power: number): void {
  p.style = 'sprite';
  p.sprite = 'proj_radiant_lance';
  p.spriteRotates = true;
  p.pierce += 99;
  p.spectral = true;
  p.angle = w.player.aim;
  p.speed = Math.max(p.speed, w.player.stats.shotSpeed) * 1.3;
  p.syncVel();
  p.damage *= 1 + 0.25 * (power - 1);
  p.r = Math.max(p.r, 4);
  p.color = '#ffe890';
  p.lightR = 34;
  p.knockback *= 1.5;
  p.mem.lance = 1;
  p.addBehavior({
    id: 'lance_glow',
    update(pr, w2) {
      if (fx.chance(0.6)) {
        w2.particles.spawn({ x: pr.x - Math.cos(pr.angle) * 10 + fx.range(-1, 1), y: pr.y - pr.z + fx.range(-1, 1), life: 0.25, colors: ['#ffffff', '#ffe890', '#ffb040'], size: 2, sizeEnd: 0, additive: true });
      }
    },
  });
}

defineArtifact({
  id: 'radiant_lance',
  name: '광휘의 창',
  desc: '공격이 모든 적을 꿰뚫는 빛의 창 하나로 합쳐진다',
  quote: '흩어진 빛을 모으면 창이 된다.',
  rarity: 'legendary',
  tags: ['star'],
  icon: 'icon_radiant_lance',
  look: { shot: '#ffe890', aura: '#ffe890' },
  pools: ['treasure', 'boss', 'secret'],
  unique: true,
  stats(m) {
    m.mulStat('range', 1.3);
  },
  onShoot(w, p, power) {
    if (!p.fromWeapon || p.generation > 0) return;
    if (Math.abs(angleDiff(p.angle, w.player.aim)) > 1.1) return;
    const cur = lanceReg.get(w);
    if (cur && cur.t === w.time && !cur.p.dead) {
      cur.p.damage += p.damage * 0.9;
      cur.p.mem.merged = (cur.p.mem.merged ?? 1) + 1;
      cur.p.scale = Math.min(1.8, 1 + (cur.p.mem.merged - 1) * 0.15);
      p.dead = true;
      return;
    }
    makeLance(w, p, power);
    lanceReg.set(w, { t: w.time, p });
  },
  onAttack(w, angle, power) {
    if (!isMelee(w)) return;
    const pl = w.player;
    const p = new Projectile({
      team: 'player', x: pl.x + Math.cos(angle) * 6, y: pl.y - 5 + Math.sin(angle) * 4, angle, speed: 300,
      damage: dmg(w) * 0.8, radius: 4, range: 150, owner: pl, knockback: 60,
    });
    p.generation = 1;
    makeLance(w, p, power);
    p.angle = angle;
    p.syncVel();
    w.spawn(p);
  },
});

// ------------------------------------------------------------------ 품 안의 태양 (legendary)
defineDrawnSprite('icon_lantern_sun', 16, 16, (p) => {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    p.line(8 + Math.cos(a) * 5, 9 + Math.sin(a) * 5, 8 + Math.cos(a) * 7.5, 9 + Math.sin(a) * 7, i % 2 ? '#ff8a20' : '#ffc040');
  }
  p.rect(4, 4, 8, 10, '#5a4030');
  p.rect(5, 5, 6, 8, '#ffb030');
  p.circle(8, 9, 2.8, '#fff0a0');
  p.circle(7.5, 8.5, 1.3, '#ffffff');
  p.rect(4, 3, 8, 2, '#8a6a4a');
  p.rect(4, 13, 8, 2, '#8a6a4a');
  p.line(4, 3, 11, 3, '#c09a6a');
  p.rect(7, 1, 2, 2, '#8a6a4a');
  p.px(7, 0, '#c09a6a');
  p.line(4, 5, 4, 12, '#3a2a1a');
  p.line(11, 5, 11, 12, '#3a2a1a');
}, { outline: '#2a1004' });

defineArtifact({
  id: 'lantern_sun',
  name: '품 안의 태양',
  desc: '작은 태양이 주위를 돌며 탄환을 녹이고 적을 태운다',
  quote: '등불 속에 태양을 가두었다. 이제 태양이 등불을 지킨다.',
  rarity: 'legendary',
  tags: ['flame', 'star'],
  icon: 'icon_lantern_sun',
  look: { aura: '#ffd060', mote: '#ffb040' },
  pools: ['treasure', 'boss', 'shrine'],
  unique: true,
  onUpdate(w, _dt, power) {
    syncFamiliars(w, 'lantern_sun', Math.min(2, power), (w2) => new LanternSun(w2), power);
  },
  onRemove(w) {
    syncFamiliars(w, 'lantern_sun', 0, (w2) => new LanternSun(w2));
  },
});
