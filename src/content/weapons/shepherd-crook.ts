// 목동의 지팡이 (shepherd's crook): 모리's starting weapon. The hooked staff
// flings small spirit bolts; every third bolt is a whistle bolt that pierces and
// tugs whatever it hits toward the herd point (see kit-mori), so the crook itself
// helps the spirit sheep bunch enemies up.

import { defineWeapon } from '../../game/defs';
import type { ProjBehavior } from '../../game/projectile';
import { Enemy } from '../../game/enemy';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { O, drawHeld, glowSprite, handPos, kick, muzzle } from './common';
import { herdPoint } from '../characters/kit-mori';

export const CROOK_WHISTLE_EVERY = 3;
export const CROOK_WHISTLE_DMG = 1.15;
export const CROOK_WHISTLE_TUG = 130;

// long staff with a hook at the far end, pointing right (pivot near the hand)
defineDrawnSprite('w_shepherd_crook', 28, 9, (p) => {
  p.rect(0, 4, 20, 2, '#7a5230');
  p.rect(0, 4, 20, 1, '#a87a4a');
  p.px(4, 4, '#d8b070');
  p.px(12, 4, '#d8b070');
  // red cord wrap at the hand
  p.rect(6, 3, 2, 4, '#d83c2c');
  // the hook: curls up and back
  p.rect(20, 2, 2, 4, '#a87a4a');
  p.rect(21, 0, 5, 2, '#a87a4a');
  p.rect(22, 0, 3, 1, '#d8b070');
  p.rect(25, 1, 2, 3, '#7a5230');
  p.px(26, 3, '#7a5230');
  // spirit glow caught in the hook
  p.px(23, 3, '#9af0e0');
  p.px(24, 2, '#e0fff8');
}, { outline: O, origin: [8, 5] });

defineDrawnSprite('icon_shepherd_crook', 16, 16, (p) => {
  p.line(2, 15, 10, 7, '#7a5230');
  p.line(3, 15, 11, 7, '#a87a4a');
  p.px(5, 12, '#d83c2c');
  p.px(6, 11, '#d83c2c');
  // hook
  p.line(10, 6, 12, 3, '#a87a4a');
  p.line(12, 2, 14, 1, '#a87a4a');
  p.line(14, 2, 15, 4, '#7a5230');
  p.px(15, 5, '#7a5230');
  p.px(13, 4, '#9af0e0');
  p.px(12, 5, '#e0fff8');
  p.px(1, 15, '#d8b070');
}, { outline: O });

// small spirit bolt (a wisp with a tail), pointing right
defineDrawnSprite('proj_spirit_bolt', 9, 6, (p) => {
  p.poly([0, 3, 3, 1, 6, 0.5, 9, 3, 6, 5.5, 3, 5], '#7ad8c8');
  p.ellipse(6, 3, 2.4, 2.2, '#9af0e0');
  p.px(6, 2, '#ffffff');
  p.px(7, 2, '#e0fff8');
  p.px(1, 3, '#7ad8c880');
}, { outline: '#103830', origin: [6, 3] });

// whistle bolt: brighter, longer, with a ring
defineDrawnSprite('proj_whistle_bolt', 12, 7, (p) => {
  p.poly([0, 3.5, 4, 1, 8, 0.5, 12, 3.5, 8, 6.5, 4, 6], '#9af0e0');
  p.ellipse(8, 3.5, 3, 2.8, '#e0fff8');
  p.ring(8, 3.5, 3, 1, '#ffffff');
  p.px(8, 3, '#ffffff');
  p.px(1, 3, '#7ad8c8');
}, { outline: '#103830', origin: [8, 3] });

for (let d = 10; d <= 18; d += 2) glowSprite(d, '#9af0e0');

/** Whistle bolt: on hit, tug the enemy toward the herd point. */
const whistleTug: ProjBehavior = {
  id: 'crook_whistle',
  onHit(_pr, w, target) {
    if (!(target instanceof Enemy) || !target.alive) return;
    const h = herdPoint(w);
    const dx = h.x - target.x;
    const dy = h.y - target.y;
    const d = Math.hypot(dx, dy);
    if (d < 4) return;
    target.knock(dx / d, dy / d, CROOK_WHISTLE_TUG);
    w.particles.burst(target.x, target.y - target.z - 4, { count: 6, speed: [20, 60], angle: Math.atan2(dy, dx), spread: 0.6, life: [0.15, 0.3], colors: ['#ffffff', '#9af0e0'], size: [1, 2], additive: true });
  },
  update(pr, w) {
    if (fx.chance(0.4)) w.particles.spawn({ x: pr.x, y: pr.y - pr.z, life: 0.2, colors: ['#e0fff8', '#9af0e0'], size: 1.5, sizeEnd: 0.5, additive: true });
  },
};

defineWeapon({
  id: 'shepherd_crook',
  name: '목동의 지팡이',
  desc: '혼령 탄을 날리는 양치기 지팡이. 세 번째 탄은 휘파람 탄이 되어 적을 꿰뚫고 몰이 지점으로 끌어당긴다.',
  icon: 'icon_shepherd_crook',
  heldSprite: 'w_shepherd_crook',
  kind: 'ranged',
  rarity: 'common',
  archetype: '목동 지팡이',
  tags: ['staff'],
  pools: ['shop', 'treasure'],
  stats(m) {
    m.mulStat('fireRate', 0.95);
    m.addStat('range', 10);
  },
  update(w, p, st, dt, firing, aim) {
    st.anim = Math.max(0, st.anim - dt * 6);
    if (!firing || st.cooldown > 0) return;
    st.cooldown = 1 / p.stats.fireRate;
    st.sinceAttack = 0;
    w.items.onAttack(aim);
    const n = (st.mem.shots ?? 0) + 1;
    const whistle = n % CROOK_WHISTLE_EVERY === 0;
    st.mem.shots = n % CROOK_WHISTLE_EVERY;
    const h = handPos(p, aim, 16);
    const x = h.x + Math.cos(aim) * 4;
    const y = h.y - 2 + Math.sin(aim) * 3;
    if (whistle) {
      p.fireProjectiles(w, aim, {
        style: 'sprite', sprite: 'proj_whistle_bolt', color: '#9af0e0', light: 26, x, y, damageMult: CROOK_WHISTLE_DMG,
        speed: p.stats.shotSpeed * 1.2, pierce: p.stats.pierce + 2, radius: p.stats.projSize + 1, knockback: 30, behaviors: [whistleTug],
      });
      w.sfx('mori_whistle', { vol: 0.45, pitch: 1.3 });
    } else {
      p.fireProjectiles(w, aim, { style: 'sprite', sprite: 'proj_spirit_bolt', color: '#9af0e0', light: 18, x, y, homing: Math.max(p.stats.homing, 0.8) });
      w.sfx('shoot_magic', { vol: 0.4, pitch: 1.25 + w.rng.next() * 0.1 });
    }
    muzzle(w, x, y, aim, ['#ffffff', '#9af0e0', '#5ab8a8'], 4);
    st.anim = 1;
    kick(w, aim + Math.PI, 0.5);
  },
  draw(w, p, r, st) {
    const aim = p.aim;
    const recoil = st.anim * 3;
    const tip = handPos(p, aim, 18 - recoil);
    r.sprite(glowSprite(10 + st.anim * 6, '#9af0e0'), tip.x, tip.y - 2, { alpha: 0.25 + st.anim * 0.4 + 0.05 * Math.sin(w.time * 7), additive: true });
    drawHeld(r, p, 'w_shepherd_crook', aim, 6 - recoil, { flash: st.anim * 0.4 });
  },
});
