// Launchers:
//  천둥 박격포  (thunder_mortar, rare) — lobs a shell over enemies onto the aimed
//                                      spot; it bounces once and bursts
//  혜성 발사관  (comet_tube, epic)     — shoulder rocket: starts slow, roars to full
//                                      speed and explodes on impact

import { defineWeapon } from '../../game/defs';
import type { World } from '../../game/world';
import type { Projectile, ProjBehavior } from '../../game/projectile';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { O, attackInterval, drawHeld, glowSprite, handPos, kick, muzzle } from './common';
import { aimDistance, beginAttack, blast, lobBehavior, shotFade } from './kit';

// ================================================================== 천둥 박격포
defineDrawnSprite('w_thunder_mortar', 16, 11, (p) => {
  p.rect(0, 6, 6, 4, '#4a3a2a');
  p.rect(0, 6, 6, 1, '#7a5a3a');
  p.rect(4, 2, 10, 6, '#5a6a5a');
  p.rect(4, 2, 10, 2, '#8a9a8a');
  p.rect(13, 1, 3, 8, '#3a4a3a');
  p.rect(14, 2, 2, 6, '#141814');
  p.rect(7, 4, 2, 2, '#ffd040');
  p.px(7, 4, '#fff0a0');
}, { outline: O, origin: [2, 7] });

defineDrawnSprite('icon_thunder_mortar', 16, 16, (p) => {
  p.poly([2, 14, 8, 8, 12, 12, 6, 16], '#5a6a5a');
  p.line(3, 13, 8, 8, '#8a9a8a');
  p.poly([8, 8, 11, 5, 14, 8, 12, 12], '#3a4a3a');
  p.circle(12, 4, 3, '#4a4a3a');
  p.circle(12, 4, 2, '#6a6a5a');
  p.px(11, 3, '#c8c8b0');
  p.line(14, 1, 15, 0, '#ffd040');
  p.px(15, 0, '#ffffff');
}, { outline: O });

defineDrawnSprite('proj_mortar_shell', 7, 7, (p) => {
  p.circle(3.5, 3.5, 3.4, '#4a4a3a');
  p.circle(3.2, 3.2, 2.2, '#6a6a5a');
  p.px(2, 2, '#c8c8b0');
  p.px(5, 1, '#ffd040');
}, { outline: '#100c08' });

defineDrawnSprite('fx_mortar_mark', 15, 7, (p) => {
  p.ring(7.5, 3.5, 7, 1, '#ffd04080');
  p.px(7, 3, '#ffd040');
  p.px(0, 3, '#ffd040');
  p.px(14, 3, '#ffd040');
}, {});

function shellBehavior(flight: number, radius: number, dmgMult: number): ProjBehavior {
  const lob = lobBehavior(flight, 26, (pr: Projectile, w: World) => {
    const s = w.player.stats;
    blast(w, pr.x, pr.y, radius, s.damage * dmgMult, { colors: ['#ffffff', '#fff0a0', '#ffb030', '#605040'], knockback: 240, shake: 0.22 });
    w.particles.burst(pr.x, pr.y, { count: 10, speed: [60, 140], life: [0.3, 0.6], colors: ['#706050', '#504030'], size: [1, 2], gravity: 320, vz: [60, 140] });
    w.sfx('slam', { vol: 0.35, pitch: 1.4, x: pr.x });
  }, 'fx_mortar_mark');
  return {
    ...lob,
    id: 'mortar_shell',
    update(pr, w, dt) {
      lob.update!(pr, w, dt);
      pr.mem.spin = (pr.mem.spin ?? 0) + dt * 12;
      if (fx.chance(0.5)) w.particles.spawn({ x: pr.x, y: pr.y - pr.z, vx: fx.range(-6, 6), vy: fx.range(-10, -2), life: 0.35, colors: ['#ffd040', '#806050', '#50403080'], size: 1, sizeEnd: 2 });
    },
    draw(pr, r) {
      // landing marker at the target, the shell high above it
      const tx = pr.mem.tx ?? pr.x;
      const ty = pr.mem.ty ?? pr.y;
      r.sprite('fx_mortar_mark', tx, ty, { alpha: 0.5 + 0.3 * Math.sin(pr.age * 20) });
      r.shadow(pr.x, pr.y + 1, 6, 2, 0.3);
      r.sprite('proj_mortar_shell', pr.x, pr.y - pr.z, { rot: pr.mem.spin ?? 0 });
    },
  };
}

defineWeapon({
  id: 'thunder_mortar',
  name: '천둥 박격포',
  desc: '포탄을 높이 쏘아 올려 조준한 자리에 떨어뜨린다. 적 너머로 날아가 넓게 폭발한다.',
  icon: 'icon_thunder_mortar',
  heldSprite: 'w_thunder_mortar',
  kind: 'ranged',
  archetype: '박격포',
  rarity: 'rare',
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('damage', 0.98);
    m.mulStat('fireRate', 0.48);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.stats;
    const d = aimDistance(w, p, 40, s.range * 0.8, s.range * 0.5);
    const h = handPos(p, aim, 15);
    const flight = Math.max(20, d - 15);
    const shots = p.fireProjectiles(w, aim, {
      style: 'none', speed: 120 + flight * 1.1, range: flight + 2, life: 3, color: '#ffd040', light: 12, x: h.x, y: h.y,
      behaviors: [shellBehavior(flight, 26 + s.projSize * 2, 2.0)], spreadMult: 1.5,
    });
    for (const pr of shots) {
      // inherited movement would pull the shell off its mark
      pr.vx = Math.cos(pr.angle) * pr.speed;
      pr.vy = Math.sin(pr.angle) * pr.speed;
      pr.mem.tx = h.x + Math.cos(pr.angle) * flight;
      pr.mem.ty = h.y + Math.sin(pr.angle) * flight;
    }
    muzzle(w, h.x, h.y, aim - (Math.cos(aim) >= 0 ? 0.5 : -0.5), ['#ffffff', '#ffe080', '#a09080'], 8, [30, 90]);
    w.particles.burst(h.x, h.y, { count: 6, speed: [10, 30], life: [0.4, 0.8], colors: ['#706060', '#504848'], size: [2, 3], sizeEnd: 5, drag: 3, fade: true });
    kick(w, aim + Math.PI, 1.8);
    w.sfx('shoot', { vol: 0.55, pitch: 0.45 });
    w.sfx('whoosh', { vol: 0.3, pitch: 0.7 });
  },
  draw(w, p, r, st) {
    // the barrel tilts up (it lobs); recoil kicks it higher
    const f = shotFade(st, w, 0.25);
    const up = (Math.cos(p.aim) >= 0 ? -1 : 1) * (0.35 + f * 0.35);
    drawHeld(r, p, 'w_thunder_mortar', p.aim + up, 5 - f * 3, { flash: f > 0.7 ? 0.3 : 0 });
  },
});

// ================================================================== 혜성 발사관
defineDrawnSprite('w_comet_tube', 22, 9, (p) => {
  p.rect(0, 2, 20, 5, '#6a3a3a');
  p.rect(0, 2, 20, 1, '#a85a4a');
  p.rect(0, 6, 20, 1, '#3a1a1a');
  p.rect(19, 1, 3, 7, '#3a3a4a');
  p.rect(20, 2, 2, 5, '#141018');
  p.rect(0, 1, 2, 7, '#3a3a4a');
  p.rect(6, 7, 3, 2, '#4a2a1a');
  p.rect(9, 0, 4, 2, '#5a5a6a');
  p.px(10, 0, '#ff8040');
  p.rect(12, 3, 4, 2, '#ffd040');
}, { outline: O, origin: [7, 7] });

defineDrawnSprite('icon_comet_tube', 16, 16, (p) => {
  p.poly([0, 12, 11, 1, 15, 5, 4, 16], '#6a3a3a');
  p.line(1, 12, 11, 2, '#a85a4a');
  p.poly([11, 1, 13, -1, 17, 3, 15, 5], '#3a3a4a');
  p.line(7, 8, 9, 6, '#ffd040');
  p.circle(3, 13, 2, '#ff9a30');
  p.px(2, 14, '#ffe080');
}, { outline: O });

defineDrawnSprite('proj_comet_rocket', 11, 5, (p) => {
  p.rect(1, 1, 7, 3, '#c8c8d8');
  p.rect(1, 1, 7, 1, '#ffffff');
  p.poly([8, 0.5, 11, 2.5, 8, 4.5], '#e04030');
  p.px(0, 0, '#e04030');
  p.px(0, 4, '#e04030');
  p.px(4, 2, '#3a3a5a');
}, { outline: '#140c1c', origin: [5, 2] });

const rocketFx: ProjBehavior = {
  id: 'comet_rocket',
  update(pr, w, dt) {
    // a little wobble while it gathers speed
    pr.angle += Math.sin(pr.age * 30 + pr.id) * Math.max(0, 0.6 - pr.age) * dt * 2;
    const bx = pr.x - Math.cos(pr.angle) * 6;
    const by = pr.y - pr.z - Math.sin(pr.angle) * 6;
    w.particles.spawn({ x: bx, y: by, vx: -Math.cos(pr.angle) * 40 + fx.range(-10, 10), vy: -Math.sin(pr.angle) * 40 + fx.range(-10, 10), life: 0.16, colors: ['#ffffff', '#ffe080', '#ff8030'], size: 2, sizeEnd: 0.5, additive: true });
    if (fx.chance(0.7)) w.particles.spawn({ x: bx, y: by, vx: fx.range(-8, 8), vy: fx.range(-12, -2), life: 0.6, colors: ['#a09898', '#706868', '#50484880'], size: 2, sizeEnd: 4, drag: 2, fade: true });
  },
  onExpire(pr, w) {
    const s = w.player.stats;
    blast(w, pr.x, pr.y, 30 + s.projSize * 2, s.damage * 2, { colors: ['#ffffff', '#fff0a0', '#ff7a2a', '#503030'], knockback: 260, shake: 0.28 });
  },
  draw(pr, r) {
    r.sprite(glowSprite(9, '#ff9a30'), pr.x - Math.cos(pr.angle) * 6, pr.y - pr.z - Math.sin(pr.angle) * 6, { alpha: 0.7, additive: true });
    r.sprite('proj_comet_rocket', pr.x, pr.y - pr.z, { rot: pr.angle });
  },
};

defineWeapon({
  id: 'comet_tube',
  name: '혜성 발사관',
  desc: '어깨에 메는 발사관. 처음엔 느리지만 점점 빨라지는 로켓을 쏘고, 로켓은 부딪히면 크게 폭발한다.',
  icon: 'icon_comet_tube',
  heldSprite: 'w_comet_tube',
  kind: 'ranged',
  archetype: '로켓',
  rarity: 'epic',
  pools: ['treasure', 'boss'],
  stats(m) {
    m.mulStat('damage', 0.68);
    m.mulStat('fireRate', 0.52);
    m.mulStat('range', 1.3);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.stats;
    const h = handPos(p, aim, 16);
    p.fireProjectiles(w, aim, {
      style: 'none', speed: 70, accel: 900, maxSpeed: 260 + s.shotSpeed, radius: s.projSize + 1, color: '#ff9a30', light: 26,
      knockback: 60, x: h.x, y: h.y, behaviors: [rocketFx],
    });
    // back-blast out of the rear of the tube
    const bx = p.x - Math.cos(aim) * 8;
    const by = p.y - 6 - Math.sin(aim) * 6;
    w.particles.burst(bx, by, { count: 10, speed: [40, 120], angle: aim + Math.PI, spread: 0.6, life: [0.2, 0.5], colors: ['#ffffff', '#ffe080', '#a09898', '#706868'], size: [1, 3], sizeEnd: 4, drag: 2 });
    muzzle(w, h.x, h.y, aim, ['#ffffff', '#ffe080', '#ff8030'], 5, [30, 80]);
    p.knock(-Math.cos(aim), -Math.sin(aim), 90);
    kick(w, aim + Math.PI, 3);
    w.shake(0.1);
    w.sfx('shoot', { vol: 0.6, pitch: 0.5 });
    w.sfx('fire', { vol: 0.45, pitch: 1.3 });
  },
  draw(w, p, r, st) {
    const f = shotFade(st, w, 0.2);
    drawHeld(r, p, 'w_comet_tube', p.aim, 3 - f * 3, { flash: f > 0.7 ? 0.35 : 0 });
    if (st.cooldown <= 0) {
      const h = handPos(p, p.aim, 15);
      r.sprite(glowSprite(5 + Math.sin(w.time * 9), '#ff9a30'), h.x, h.y, { alpha: 0.35, additive: true });
    }
  },
});
