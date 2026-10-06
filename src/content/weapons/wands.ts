import { visualHandPos } from '../../game/weapon-pose';
// Light one-handed casters:
//  쌍심지 등잔총 (twin_lamp, common)   — pistol: every pull fires a quick double tap
//  서리 지팡이   (frost_wand, common)  — ice shards that slow (sometimes freeze)
//  방울 지팡이   (bubble_wand, common) — slow drifting bubbles that pop in a splash
//  별똥 발사기   (star_launcher, rare) — a big star that bursts into five small ones

import { defineWeapon } from '../../game/defs';
import type { ProjBehavior } from '../../game/projectile';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { O, attackInterval, glowSprite, handPos, kick, muzzle } from './common';
import { beginAttack, blast, drawGun, fragment, shotFade } from './kit';

// ================================================================== 쌍심지 등잔총
defineDrawnSprite('w_twin_lamp', 14, 8, (p) => {
  p.rect(0, 4, 3, 4, '#5a3a22');
  p.rect(1, 4, 1, 3, '#8a5a32');
  p.rect(2, 2, 8, 3, '#b07a38');
  p.rect(2, 2, 8, 1, '#e0b060');
  p.rect(9, 1, 5, 1, '#6a4a2a');
  p.rect(9, 4, 5, 1, '#6a4a2a');
  p.rect(9, 2, 4, 2, '#3a2418');
  p.rect(3, 0, 2, 2, '#ffd060');
  p.px(3, 0, '#fff6c0');
  p.rect(6, 0, 2, 2, '#ff9a30');
  p.px(6, 0, '#ffe0a0');
  p.px(13, 1, '#ffe080');
  p.px(13, 4, '#ffe080');
  p.px(4, 3, '#ffe4a0');
  p.px(7, 3, '#634422');
  p.line(10, 2, 12, 2, '#a87a48');
}, { outline: O, origin: [1, 5] });

defineDrawnSprite('icon_twin_lamp', 16, 16, (p) => {
  p.rect(1, 5, 11, 4, '#b07a38');
  p.rect(1, 5, 11, 1, '#e0b060');
  p.rect(11, 5, 5, 1, '#6a4a2a');
  p.rect(11, 8, 5, 1, '#6a4a2a');
  p.rect(11, 6, 4, 2, '#3a2418');
  p.poly([2, 9, 6.5, 9, 5.5, 15, 1, 15], '#5a3a22');
  p.line(2, 10, 2, 14, '#8a5a32');
  p.rect(7, 9, 3, 2, '#6a4a2a');
  p.rect(3, 2, 3, 3, '#ffd060');
  p.px(3, 2, '#fff6c0');
  p.rect(7, 2, 3, 3, '#ff9a30');
  p.px(7, 2, '#ffe0a0');
  p.px(15, 5, '#ffe080');
  p.px(15, 8, '#ffe080');
}, { outline: O });

defineDrawnSprite('proj_lamp_dart', 8, 3, (p) => {
  p.line(0, 1, 7, 1, '#ff9a30');
  p.line(3, 1, 7, 1, '#ffe080');
  p.px(7, 1, '#ffffff');
  p.px(5, 0, '#ffd060');
  p.px(5, 2, '#ffd060');
}, { outline: '#3a1408', origin: [6, 1] });

defineWeapon({
  id: 'twin_lamp',
  name: '쌍심지 등잔총',
  desc: '심지가 둘인 등잔총. 방아쇠를 당길 때마다 불씨탄을 두 발 연달아 쏜다.',
  icon: 'icon_twin_lamp',
  heldSprite: 'w_twin_lamp',
  kind: 'ranged',
  archetype: '권총',
  rarity: 'common',
  tags: ['arcane'],
  pools: ['treasure', 'shop'],
  stats(m) {
    m.mulStat('damage', 0.93);
    m.mulStat('fireRate', 0.9);
    m.mulStat('shotSpeed', 1.25);
  },
  update(w, p, st, dt, firing, aim) {
    if ((st.mem.tap ?? 0) > 0) {
      st.mem.tapT = (st.mem.tapT ?? 0) - dt;
      if (st.mem.tapT <= 0) {
        st.mem.tap--;
        st.mem.tapT = 0.075;
        const a = p.aim;
        const side = st.mem.tap % 2 === 0 ? 1 : -1;
        const h = handPos(p, a, 13);
        const nx = -Math.sin(a) * side * 1.5;
        const ny = Math.cos(a) * side * 1.5;
        p.fireProjectiles(w, a + (w.rng.next() - 0.5) * 0.05, {
          style: 'sprite', sprite: 'proj_lamp_dart', damageMult: 0.58, color: '#ffb040', light: 16, x: h.x + nx, y: h.y + ny,
        });
        muzzle(w, h.x + nx, h.y + ny, a, ['#ffffff', '#ffd078', '#ff9a30'], 4, [40, 110]);
        st.mem.shotAt = w.time;
        kick(w, a + Math.PI, 0.6);
        w.sfx('shoot_magic', { vol: 0.42, pitch: 1.25 + (st.mem.tap ? 0 : 0.12) + w.rng.next() * 0.06 });
      }
    }
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    st.mem.tap = 2;
    st.mem.tapT = 0;
  },
  draw(w, p, r, st) {
    drawGun(r, w, p, st, 'w_twin_lamp', 6, 2.2);
    const f = shotFade(st, w, 0.12);
    if (f > 0) {
      const h = visualHandPos(p, p.aim, 14);
      r.sprite(glowSprite(8 + f * 6, '#ffb040'), h.x, h.y, { alpha: 0.6 * f, additive: true });
    }
  },
});

// ================================================================== 서리 지팡이
defineDrawnSprite('w_frost_wand', 17, 7, (p) => {
  p.rect(0, 3, 11, 1, '#8ab0c8');
  p.rect(0, 2, 11, 1, '#c8e0ee');
  p.rect(2, 2, 1, 2, '#5a7890');
  p.poly([11, 3.5, 14, 0, 17, 3.5, 14, 7], '#7ad0ff');
  p.poly([12.5, 3.5, 14, 1.5, 15.5, 3.5, 14, 5.5], '#e0f6ff');
  p.px(14, 2, '#ffffff');
  p.line(14, 4, 15, 5, '#3890c8');
  p.px(12, 3, '#ffffff');
  p.px(6, 3, '#e0f6ff');
}, { outline: '#14284a', origin: [3, 3] });

defineDrawnSprite('icon_frost_wand', 16, 16, (p) => {
  p.line(1, 15, 9, 7, '#8ab0c8');
  p.line(2, 15, 10, 7, '#c8e0ee');
  p.poly([8, 6, 12, 0.5, 16, 4, 10.5, 8.5], '#7ad0ff');
  p.poly([10, 5.5, 12.5, 2.5, 14, 4, 11, 6.5], '#e0f6ff');
  p.px(12, 3, '#ffffff');
  p.px(4, 4, '#bfeaff');
  p.px(3, 3, '#ffffff');
  p.px(14, 11, '#bfeaff');
}, { outline: '#14284a' });

defineDrawnSprite('proj_frost_shard', 10, 5, (p) => {
  p.poly([0, 2.5, 4, 0, 10, 2.5, 4, 5], '#7ad0ff');
  p.poly([3, 2.5, 5, 1, 9, 2.5, 5, 4], '#d8f4ff');
  p.px(8, 2, '#ffffff');
}, { outline: '#14284a', origin: [6, 2] });

const iceTrail: ProjBehavior = {
  id: 'ice_trail',
  update(pr, w) {
    if (fx.chance(0.35)) w.particles.spawn({ x: pr.x + fx.range(-2, 2), y: pr.y - pr.z + fx.range(-2, 2), vy: 8, life: 0.35, colors: ['#ffffff', '#bfeaff', '#7ad0ff'], size: 1, shape: 'pixel' });
  },
  onExpire(pr, w) {
    w.particles.burst(pr.x, pr.y - pr.z, { count: 7, speed: [30, 80], life: [0.15, 0.35], colors: ['#ffffff', '#bfeaff', '#7ad0ff'], size: [1, 2], shape: 'square', gravity: 200, vz: [20, 60] });
  },
};

defineWeapon({
  id: 'frost_wand',
  name: '서리 지팡이',
  desc: '얼음 조각을 쏜다. 맞은 적은 느려지고, 가끔 꽁꽁 얼어붙는다.',
  icon: 'icon_frost_wand',
  heldSprite: 'w_frost_wand',
  kind: 'ranged',
  archetype: '냉기',
  rarity: 'common',
  tags: ['arcane'],
  pools: ['treasure', 'shop'],
  stats(m) {
    m.mulStat('damage', 0.88);
    m.mulStat('shotSpeed', 1.15);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const h = handPos(p, aim, 15);
    p.fireProjectiles(w, aim, {
      style: 'sprite', sprite: 'proj_frost_shard', color: '#9adcff', light: 18, x: h.x, y: h.y, behaviors: [iceTrail],
      statuses: [{ kind: 'slow', duration: 1.6, power: 0.45 }, { kind: 'freeze', duration: 0.9, chance: 0.12 }],
    });
    muzzle(w, h.x, h.y, aim, ['#ffffff', '#bfeaff', '#7ad0ff'], 5, [30, 90]);
    kick(w, aim + Math.PI, 0.6);
    w.sfx('freeze', { vol: 0.32, pitch: 1.5 + w.rng.next() * 0.2 });
    w.sfx('shoot_magic', { vol: 0.25, pitch: 1.4 });
  },
  draw(w, p, r, st) {
    drawGun(r, w, p, st, 'w_frost_wand', 5, 2);
    const h = visualHandPos(p, p.aim, 16);
    r.sprite(glowSprite(9 + Math.sin(w.time * 5) * 1.5 + shotFade(st, w, 0.15) * 6, '#7ad0ff'), h.x, h.y, { alpha: 0.4, additive: true });
  },
});

// ================================================================== 방울 지팡이
defineDrawnSprite('w_bubble_wand', 15, 9, (p) => {
  p.rect(0, 4, 9, 1, '#d070b0');
  p.rect(0, 3, 9, 1, '#f0a8d8');
  p.ring(11.5, 4, 3.4, 1.2, '#ffd0f0');
  p.ring(11.5, 4, 3.4, 0.6, '#ffffff');
  p.px(2, 3, '#ffffff');
}, { outline: '#3a1430', origin: [2, 4] });

defineDrawnSprite('icon_bubble_wand', 16, 16, (p) => {
  p.line(1, 15, 7, 9, '#d070b0');
  p.line(2, 15, 8, 9, '#f0a8d8');
  p.ring(10, 6.5, 3.6, 1.3, '#ffd0f0');
  p.circle(13, 12, 2.4, '#bfe8ff');
  p.circle(13, 12, 1.4, '#e8f8ff');
  p.px(12, 11, '#ffffff');
  p.circle(5, 4, 1.8, '#ffd0f0');
  p.px(4, 3, '#ffffff');
}, { outline: '#3a1430' });

defineDrawnSprite('proj_bubble', 13, 13, (p) => {
  p.ring(6.5, 6.5, 6, 1, '#bfe8ff');
  p.ring(6.5, 6.5, 5, 1, '#9ad8ff60');
  p.circle(6.5, 6.5, 4.4, '#bfe8ff28');
  p.px(3, 3, '#ffffff');
  p.px(4, 3, '#ffffff');
  p.px(3, 4, '#ffffff');
  p.px(9, 9, '#ffd0f0');
  p.px(10, 8, '#ffd0f0');
}, { outline: '#24385a' });

const bubbleFx: ProjBehavior = {
  id: 'bubble',
  update(pr, w, dt) {
    // lazy drift: a gentle wobble that grows as the bubble slows down
    const slow = 1 - Math.min(1, pr.speed / 140);
    pr.angle += Math.sin(pr.age * 5 + pr.id) * (0.4 + slow * 2.2) * dt;
    pr.scale = 1 + 0.08 * Math.sin(pr.age * 9 + pr.id);
    if (fx.chance(0.06)) w.particles.spawn({ x: pr.x, y: pr.y - pr.z, vy: -10, life: 0.4, colors: ['#ffffff', '#bfe8ff'], size: 1, shape: 'pixel' });
  },
  onExpire(pr, w) {
    // pop: a little splash around the bubble (not the one it hit directly)
    blast(w, pr.x, pr.y, 16 + pr.r * 1.5, pr.damage * 0.45, {
      colors: ['#ffffff', '#bfe8ff', '#7ad0ff', '#4a6a9a'], knockback: 80, skip: pr.hitIds, small: true, sfx: false, shake: 0,
    });
    w.sfx('tear_splash', { vol: 0.5, pitch: 1.6 + fx.range(-0.1, 0.1), x: pr.x });
  },
  draw(pr, r) {
    r.sprite('proj_bubble', pr.x, pr.y - pr.z, { sx: pr.scale * (0.6 + pr.r / 10), sy: pr.scale * (0.6 + pr.r / 10) * 0.95, alpha: 0.95 });
  },
};

defineWeapon({
  id: 'bubble_wand',
  name: '방울 지팡이',
  desc: '느릿느릿 떠다니는 방울을 분다. 방울은 터지면서 주변 적까지 적신다.',
  icon: 'icon_bubble_wand',
  heldSprite: 'w_bubble_wand',
  kind: 'ranged',
  archetype: '방울',
  rarity: 'common',
  tags: ['arcane'],
  pools: ['treasure', 'shop'],
  stats(m) {
    m.mulStat('damage', 1.25);
    m.mulStat('fireRate', 0.75);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.weaponStats;
    const h = handPos(p, aim, 13);
    p.fireProjectiles(w, aim + (w.rng.next() - 0.5) * 0.12, {
      style: 'none', speed: s.shotSpeed * 0.62, accel: -170, minSpeed: 26, range: s.range * 0.85, life: 2.6,
      radius: s.projSize + 3, color: '#bfe8ff', light: 14, knockback: 40, x: h.x, y: h.y, behaviors: [bubbleFx],
    });
    w.particles.burst(h.x, h.y, { count: 4, speed: [10, 40], angle: aim, spread: 0.8, life: [0.2, 0.4], colors: ['#ffffff', '#ffd0f0'], size: [1, 1] });
    w.sfx('orb', { vol: 0.3, pitch: 1.9 + w.rng.next() * 0.2 });
  },
  draw(w, p, r, st) {
    // the ring "inflates" just before a bubble leaves it
    const f = shotFade(st, w, 0.18);
    drawGun(r, w, p, st, 'w_bubble_wand', 5, 1.5, { sy: 1 + f * 0.25 });
  },
});

// ================================================================== 별똥 발사기
defineDrawnSprite('w_star_launcher', 18, 9, (p) => {
  p.rect(0, 5, 4, 4, '#3a3060');
  p.rect(1, 5, 1, 3, '#5a4a8a');
  p.rect(2, 2, 14, 5, '#4a3a90');
  p.rect(2, 2, 14, 1, '#7a6ad0');
  p.rect(15, 1, 3, 7, '#2a2050');
  p.rect(16, 2, 2, 5, '#141030');
  p.poly([7, 2, 8, 0.5, 9, 2], '#ffe060');
  p.px(8, 4, '#ffe060');
  p.px(7, 4, '#fff6c0');
  p.px(9, 4, '#fff6c0');
  p.px(8, 3, '#fff6c0');
  p.px(8, 5, '#fff6c0');
}, { outline: O, origin: [2, 6] });

/** 5-point star of radius `ro` (inner `ri`) centered in a d x d sprite. */
function starPoly(c: number, ro: number, ri: number, rot = -Math.PI / 2): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? ro : ri;
    pts.push(c + Math.cos(a) * rr, c + Math.sin(a) * rr);
  }
  return pts;
}

defineDrawnSprite('icon_star_launcher', 16, 16, (p) => {
  p.poly([1, 13, 9, 5, 13, 9, 5, 16], '#4a3a90');
  p.line(2, 12, 9, 5, '#7a6ad0');
  p.poly(starPoly(11, 5, 2.2), '#ffe060');
  p.poly(starPoly(11, 2.6, 1.2), '#fff6c0');
  p.px(11, 10, '#ffffff');
}, { outline: O });

defineDrawnSprite('proj_star_big', 11, 11, (p) => {
  p.poly(starPoly(5.5, 5.5, 2.4), '#ffd040');
  p.poly(starPoly(5.5, 3.2, 1.5), '#fff6a0');
  p.px(5, 5, '#ffffff');
}, { outline: '#4a2a08' });

defineDrawnSprite('proj_star_small', 7, 7, (p) => {
  p.poly(starPoly(3.5, 3.5, 1.6), '#ffe060');
  p.px(3, 3, '#ffffff');
}, { outline: '#4a2a08' });

const starSpin: ProjBehavior = {
  id: 'star_spin',
  draw(pr, r) {
    r.sprite(glowSprite(12, '#ffd040'), pr.x, pr.y - pr.z, { alpha: 0.35, additive: true });
    r.sprite('proj_star_big', pr.x, pr.y - pr.z, { rot: pr.age * 9, sx: pr.scale, sy: pr.scale });
  },
  onExpire(pr, w) {
    if (pr.mem.split) return;
    pr.mem.split = 1;
    const n = 5;
    const off = w.rng.next() * Math.PI;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2;
      const f = fragment(w, pr.x, pr.y, a, {
        damage: pr.damage * 0.3, speed: 170, accel: -200, minSpeed: 60, range: 56, radius: 2.5, color: '#ffe060', style: 'none',
        behaviors: [miniStar],
      });
      for (const id of pr.hitIds) f.hitIds.add(id);
    }
    w.particles.burst(pr.x, pr.y - pr.z, { count: 10, speed: [40, 120], life: [0.15, 0.35], colors: ['#ffffff', '#fff6a0', '#ffd040'], size: [1, 2], shape: 'spark', additive: true });
    w.sfx('hit_crit', { vol: 0.25, pitch: 1.8, x: pr.x });
  },
};

const miniStar: ProjBehavior = {
  id: 'mini_star',
  draw(pr, r) {
    r.sprite('proj_star_small', pr.x, pr.y - pr.z, { rot: pr.age * 14 });
  },
};

defineWeapon({
  id: 'star_launcher',
  name: '별똥 발사기',
  desc: '큼직한 별을 쏘아 올린다. 별은 부딪히면 작은 별 다섯 개로 흩어진다.',
  icon: 'icon_star_launcher',
  heldSprite: 'w_star_launcher',
  kind: 'ranged',
  archetype: '분열',
  rarity: 'rare',
  tags: ['arcane'],
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('damage', 1.4);
    m.mulStat('fireRate', 0.7);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.weaponStats;
    const h = handPos(p, aim, 16);
    p.fireProjectiles(w, aim, {
      style: 'none', radius: s.projSize + 2, speed: s.shotSpeed * 0.9, color: '#ffd040', light: 22, x: h.x, y: h.y, behaviors: [starSpin],
    });
    muzzle(w, h.x, h.y, aim, ['#ffffff', '#fff6a0', '#ffd040'], 6, [40, 120]);
    kick(w, aim + Math.PI, 1.2);
    p.knock(-Math.cos(aim), -Math.sin(aim), 30);
    w.sfx('shoot', { vol: 0.4, pitch: 0.8 });
    w.sfx('orb', { vol: 0.3, pitch: 1.6 });
  },
  draw(w, p, r, st) {
    drawGun(r, w, p, st, 'w_star_launcher', 5, 3);
    const f = shotFade(st, w, 0.2);
    if (f > 0) {
      const h = visualHandPos(p, p.aim, 18);
      r.ring(h.x, h.y, 2 + (1 - f) * 5, '#ffe890', 1, f * 0.75);
    }
  },
});
