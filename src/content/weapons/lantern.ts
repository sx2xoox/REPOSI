import { visualHandPos } from '../../game/weapon-pose';
// 등불 마탄 (lantern bolts): Ria's starting weapon. A hand lantern that sways
// on its handle and spits flame bolts from its glass. Balanced ranged weapon.

import { defineWeapon } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';
import { clamp } from '../../engine/math';
import { O, glowSprite, handPos, kick, muzzle } from './common';

// hanging lantern, pivot at the handle ring (top center)
defineDrawnSprite('w_lantern', 9, 13, (p) => {
  p.ring(4.5, 1.5, 1.8, 1, '#c89848');
  p.rect(2, 3, 5, 1, '#6a4a2a');
  p.rect(1, 4, 7, 1, '#a07838');
  p.rect(1, 5, 7, 5, '#ffd060');
  p.rect(2, 6, 5, 3, '#fff2a8');
  p.rect(3, 6, 3, 2, '#ffffff');
  p.rect(1, 5, 1, 5, '#6a4a2a');
  p.rect(7, 5, 1, 5, '#6a4a2a');
  p.rect(4, 5, 1, 5, '#c89848');
  p.rect(1, 10, 7, 1, '#a07838');
  p.rect(2, 11, 5, 1, '#6a4a2a');
  p.px(4, 12, '#6a4a2a');
}, { outline: O, origin: [4, 0] });

defineDrawnSprite('icon_lantern_bolt', 16, 16, (p) => {
  p.ring(8, 2.5, 2, 1, '#c89848');
  p.rect(4, 4, 8, 2, '#a07838');
  p.rect(3, 6, 10, 7, '#ffd060');
  p.shadeSphere(8, 9.5, 5, 4, ramp('#ffc040', 4), { dither: false });
  p.rect(6, 7, 4, 4, '#fff6c0');
  p.rect(7, 8, 2, 2, '#ffffff');
  p.rect(3, 6, 1, 7, '#6a4a2a');
  p.rect(12, 6, 1, 7, '#6a4a2a');
  p.rect(3, 13, 10, 2, '#6a4a2a');
  p.px(13, 4, '#ffffff');
  p.px(14, 3, '#ffe080');
}, { outline: O });

// the pulsing glass glow (16..24px, see draw) is defined up front so the boot warm-up compiles it
for (let d = 16; d <= 24; d++) glowSprite(d, '#ffb040');

defineWeapon({
  id: 'lantern_bolt',
  name: '등불 마탄',
  desc: '등불의 불꽃을 탄환으로 쏘아낸다. 균형 잡힌 원거리 무기.',
  icon: 'icon_lantern_bolt',
  heldSprite: 'w_lantern',
  kind: 'ranged',
  rarity: 'common',
  tags: ['arcane'],
  pools: ['shop'],
  update(w, p, st, dt, firing, aim) {
    // pendulum: the lantern lags behind movement and jolts on every shot
    const target = clamp(-p.vx * 0.006, -0.7, 0.7);
    const sw = st.mem.sway ?? 0;
    const sv = (st.mem.swayV ?? 0) + ((target - sw) * 90 - (st.mem.swayV ?? 0) * 9) * dt;
    st.mem.swayV = sv;
    st.mem.sway = sw + sv * dt;
    st.anim = Math.max(0, st.anim - dt * 6);
    if (!firing || st.cooldown > 0) return;
    st.cooldown = 1 / p.stats.fireRate;
    st.sinceAttack = 0;
    w.items.onAttack(aim);
    const h = handPos(p, aim, 8);
    const gx = h.x;
    const gy = h.y + 6;
    p.fireProjectiles(w, aim, { style: 'tear', color: '#ffd078', light: 22, x: gx + Math.cos(aim) * 3, y: gy + Math.sin(aim) * 2 });
    muzzle(w, gx + Math.cos(aim) * 4, gy + Math.sin(aim) * 3, aim, ['#ffffff', '#ffd078', '#ff9a30']);
    st.mem.swayV = (st.mem.swayV ?? 0) - Math.cos(aim) * 3.5;
    st.anim = 1;
    kick(w, aim + Math.PI, 0.7);
    w.sfx('shoot_magic', { vol: 0.5, pitch: 0.95 + w.rng.next() * 0.12 });
  },
  draw(_w, p, r, st) {
    const aim = p.aim;
    const h = visualHandPos(p, aim, 7 - p.recoil * 0.8);
    const rot = (st.mem.sway ?? 0) * (1 - Math.min(1, Math.abs(Math.sin(aim)) * 0.3));
    const glow = 0.18 + 0.08 * Math.sin(p.age * 7) + st.anim * 0.35;
    r.sprite(glowSprite(16 + st.anim * 8, '#ffb040'), h.x - Math.sin(rot) * 6, h.y + 6, { alpha: glow, additive: true });
    r.sprite('w_lantern', h.x, h.y - 1, { rot, flash: st.anim * 0.5 });
  },
});
