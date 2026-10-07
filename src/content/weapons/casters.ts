import { visualHandPos } from '../../game/weapon-pose';
import { armGaleGuard, clearGaleBullets } from './gale-guard';
// Spread casters:
//  나팔 산탄총 (scatter_horn, common) — a bell-mouthed blunderbuss: a cone of
//                                      slowing pellets, brutal up close
//  질풍 부채   (gale_fan, rare)       — a war fan: wide gusts that pierce, shove
//                                      enemies back and blow enemy bullets away

import { defineWeapon } from '../../game/defs';
import type { ProjBehavior } from '../../game/projectile';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { O, attackInterval, drawHeld, handPos, kick, meleeRest, muzzle, startSwingPose, swingPose } from './common';
import { beginAttack, drawGun, shotFade } from './kit';
import { glowSprite } from './common';

// ================================================================== 나팔 산탄총
defineDrawnSprite('w_scatter_horn', 19, 9, (p) => {
  p.rect(0, 4, 5, 3, '#6a4026');
  p.rect(0, 4, 5, 1, '#9a6a40');
  p.rect(1, 7, 2, 2, '#4a2a1a');
  p.rect(5, 3, 8, 3, '#8a6a3a');
  p.rect(5, 3, 8, 1, '#c8a060');
  // flared brass bell
  p.poly([12, 3, 18, 0, 18, 9, 12, 6], '#d8a040');
  p.poly([13, 3.5, 17, 1.2, 17, 2.5, 13, 4.2], '#ffe090');
  p.rect(17, 2, 1, 5, '#5a3a18');
}, { outline: O, origin: [2, 5] });

defineDrawnSprite('icon_scatter_horn', 16, 16, (p) => {
  p.poly([0, 13, 4, 10, 6, 13, 2, 16], '#6a4026');
  p.poly([3, 11, 9, 5, 11, 7, 5, 13], '#8a6a3a');
  p.line(4, 11, 9, 6, '#c8a060');
  p.poly([8, 5, 13, 0, 16, 4, 11, 8], '#d8a040');
  p.poly([9, 5, 13, 1, 14, 2, 10, 6], '#ffe090');
  p.line(13, 1, 16, 4, '#5a3a18');
  p.px(15, 9, '#ffd060');
  p.px(12, 11, '#ffd060');
  p.px(14, 12, '#ff9a30');
}, { outline: O });

defineDrawnSprite('proj_pellet', 4, 4, (p) => {
  p.circle(2, 2, 2, '#ffc050');
  p.px(1, 1, '#ffffff');
}, { outline: '#3a1c08' });

const pelletFx: ProjBehavior = {
  id: 'pellet',
  draw(pr, r) {
    r.sprite('proj_pellet', pr.x, pr.y - pr.z);
  },
};

/** Pellets per blast for a multishot stat (exported for tests). */
export function hornPellets(shots: number): number {
  return 5 + Math.max(0, Math.floor(shots) - 1) * 2;
}

defineWeapon({
  id: 'scatter_horn',
  name: '나팔 산탄총',
  desc: '나팔처럼 벌어진 총구로 산탄을 흩뿌린다. 가까이 붙을수록 강하다.',
  icon: 'icon_scatter_horn',
  heldSprite: 'w_scatter_horn',
  kind: 'ranged',
  archetype: '산탄',
  rarity: 'common',
  pools: ['treasure', 'shop'],
  stats(m) {
    m.mulStat('damage', 0.89);
    m.mulStat('fireRate', 0.55);
    m.mulStat('range', 0.7);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.weaponStats;
    const n = hornPellets(s.shots);
    const h = handPos(p, aim, 18);
    const cone = 0.5 + s.spread * 0.4;
    for (let i = 0; i < n; i++) {
      const a = aim + (i / Math.max(1, n - 1) - 0.5) * cone + (w.rng.next() - 0.5) * 0.12;
      p.fireProjectiles(w, a, {
        count: 1, style: 'none', speed: s.shotSpeed * (1.1 + w.rng.next() * 0.35), accel: -420, minSpeed: 120,
        range: s.range * (0.85 + w.rng.next() * 0.3), damageMult: 0.43, radius: Math.max(2, s.projSize - 0.5),
        knockback: s.knockback * 0.6, color: '#ffc050', light: 8, x: h.x, y: h.y, behaviors: [pelletFx],
      });
    }
    muzzle(w, h.x, h.y, aim, ['#ffffff', '#ffe080', '#ff9a30', '#a04010'], 12, [60, 200]);
    w.particles.burst(h.x, h.y, { count: 6, speed: [10, 40], angle: aim, spread: 0.6, life: [0.4, 0.8], colors: ['#706060', '#504848'], size: [2, 3], sizeEnd: 5, drag: 3, fade: true });
    p.knock(-Math.cos(aim), -Math.sin(aim), 40);
    kick(w, aim + Math.PI, 2.6);
    w.shake(0.08);
    w.sfx('shoot', { vol: 0.65, pitch: 0.55 });
    w.sfx('explosion', { vol: 0.15, pitch: 2.2 });
  },
  draw(w, p, r, st) {
    // the horn jumps up with the blast, then settles
    const f = shotFade(st, w, 0.22);
    const lift = (Math.cos(p.aim) >= 0 ? -1 : 1) * f * 0.5;
    drawHeld(r, p, 'w_scatter_horn', p.aim + lift, 5 - f * 4, { flash: f > 0.7 ? 0.4 : 0 });
  },
});

// ================================================================== 질풍 부채
defineDrawnSprite('w_gale_fan', 13, 15, (p) => {
  // folding war fan, opened (ribs fanning to the right), pivot at the rivet
  for (let i = 0; i < 7; i++) {
    const a = -1.1 + (i / 6) * 2.2;
    p.line(1, 7, 1 + Math.cos(a) * 12, 7 + Math.sin(a) * 7, i % 2 ? '#e8f0e0' : '#c8d8c0');
  }
  p.poly([2, 7, 7, 0.5, 13, 3, 13, 11, 7, 13.5], '#d8ecd8');
  p.poly([7, 1.5, 12, 3.5, 12, 6, 7, 5], '#ffffff');
  p.line(7, 0.5, 13, 3, '#4a8a6a');
  p.line(13, 11, 7, 13.5, '#4a8a6a');
  p.line(2, 7, 12, 7, '#7ab89a');
  p.px(1, 7, '#c03030');
  p.px(0, 7, '#6a1818');
}, { outline: '#14281c', origin: [1, 7] });

defineDrawnSprite('icon_gale_fan', 16, 16, (p) => {
  // a folding fan opened over a quarter circle, pivot bottom-left
  const px0 = 2.5;
  const py0 = 13.5;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - px0;
      const dy = y + 0.5 - py0;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      if (a > 0.12 || a < -1.72 || r > 13 || r < 3.5) continue;
      const rib = Math.abs(((a + 1.72) / 0.3) % 1 - 0.5) > 0.38;
      p.px(x, y, r > 11.6 ? '#4a8a6a' : rib && r > 5 ? '#9ac8aa' : r > 8 ? '#ffffff' : '#d8ecd8');
    }
  }
  p.circle(2.5, 13.5, 1.6, '#c03030');
  p.px(2, 13, '#ff8080');
}, { outline: '#14281c' });

defineDrawnSprite('proj_gale', 10, 24, (p) => {
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 10; x++) {
      const d1 = Math.hypot(x + 0.5 + 9, y + 0.5 - 12);
      const d2 = Math.hypot(x + 0.5 + 13, y + 0.5 - 12);
      if (d1 < 19 && d2 > 19.5) {
        const e = 19 - d1;
        p.px(x, y, e < 1.2 ? '#ffffff' : e < 2.6 ? '#c8f0d8' : '#8ad8b080');
      }
    }
  }
}, { origin: [5, 12] });

const galeFx: ProjBehavior = {
  id: 'gale',
  update(pr, w) {
    const n = clearGaleBullets(pr, w);
    if (n > 0) w.particles.burst(pr.x, pr.y, { count: 4, speed: [30, 80], life: [0.15, 0.3], colors: ['#ffffff', '#c8f0d8'], size: [1, 1], shape: 'spark' });
    if (fx.chance(0.5)) {
      const side = fx.range(-1, 1) * pr.r;
      w.particles.spawn({ x: pr.x - Math.sin(pr.angle) * side, y: pr.y - pr.z + Math.cos(pr.angle) * side, vx: Math.cos(pr.angle) * 30, vy: Math.sin(pr.angle) * 30, life: 0.3, colors: ['#ffffff', '#c8f0d8'], size: 1, shape: 'pixel' });
    }
  },
  draw(pr, r) {
    const k = 1 - Math.min(1, pr.traveled / Math.max(1, pr.range));
    const sc = 0.7 + pr.r / 12;
    r.sprite('proj_gale', pr.x, pr.y - pr.z, { rot: pr.angle, sx: sc, sy: sc * (0.9 + (1 - k) * 0.3), alpha: 0.5 + k * 0.5 });
  },
};

defineWeapon({
  id: 'gale_fan',
  name: '질풍 부채',
  desc: '적을 꿰뚫어 밀쳐내는 돌풍. 공격 직후 0.18초 동안 가까운 적 탄환을 최대 3발 지운다. 다중 발사도 횟수를 공유하며 장판·레이저는 지우지 못한다.',
  icon: 'icon_gale_fan',
  heldSprite: 'w_gale_fan',
  kind: 'ranged',
  archetype: '부채',
  rarity: 'rare',
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('damage', 1.02);
    m.mulStat('fireRate', 0.95);
    m.addStat('knockback', 80);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.weaponStats;
    const dir = (st.combo = (st.combo + 1) % 2) === 0 ? 1 : -1;
    st.comboTimer = 1;
    startSwingPose(st, w, aim - 1.3 * dir, aim + 1.1 * dir, 0.09, 0.06);
    const h = handPos(p, aim, 10);
    const gusts = p.fireProjectiles(w, aim, {
      style: 'none', radius: s.projSize + 7, speed: s.shotSpeed * 0.95, accel: -160, minSpeed: 90, range: s.range * 0.7,
      pierce: s.pierce + 99, knockback: s.knockback * 2.4, color: '#c8f0d8', light: 14, x: h.x, y: h.y, behaviors: [galeFx],
    });
    armGaleGuard(gusts, w.time);
    w.particles.burst(h.x, h.y, { count: 8, speed: [40, 110], angle: aim, spread: 1.1, life: [0.15, 0.3], colors: ['#ffffff', '#c8f0d8', '#8ad8b0'], size: [1, 1], shape: 'spark' });
    kick(w, aim, 1);
    w.sfx('whoosh', { vol: 0.55, pitch: 1.1 + w.rng.next() * 0.1 });
    w.sfx('swing', { vol: 0.25, pitch: 1.5 });
  },
  draw(w, p, r, st) {
    const pose = swingPose(st, w, meleeRest(st, p.aim) - (Math.cos(p.aim) >= 0 ? 0.6 : -0.6));
    const open = pose.phase === 1 || pose.phase === 2 ? 1 : 0.75;
    drawHeld(r, p, 'w_gale_fan', pose.angle, 5, { sy: open, flash: pose.phase === 1 ? 0.35 : 0 });
    if (pose.phase === 1) {
      const h = visualHandPos(p, pose.angle, 12);
      r.sprite(glowSprite(10, '#c8f0d8'), h.x, h.y, { alpha: 0.4, additive: true });
    }
  },
});
