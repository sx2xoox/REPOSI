// 파수 장창 (sentry spear): long piercing thrusts. Slow, but reaches far and
// skewers every enemy in a line; the thrust also deflects bullets on its tip.

import { defineWeapon } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { O, attackInterval, drawHeld, kick, attackInput, consumeAttack } from './common';

defineDrawnSprite('w_spear', 32, 7, (p) => {
  p.rect(0, 3, 22, 1, '#8a5a30');
  p.rect(0, 2, 22, 1, '#b07a44');
  p.px(0, 3, '#5a3418');
  p.rect(21, 1, 2, 5, '#a8b0c8');
  p.px(20, 4, '#d83c2c');
  p.px(19, 5, '#d83c2c');
  p.px(18, 5, '#a02418');
  p.poly([23, 1, 29, 2, 32, 3.5, 29, 5, 23, 6], '#d8e0f0');
  p.line(23, 2, 30, 3, '#ffffff');
  p.line(24, 5, 29, 4, '#8890a8');
}, { outline: O, origin: [8, 3] });

defineDrawnSprite('icon_iron_spear', 16, 16, (p) => {
  p.line(1, 15, 10, 6, '#8a5a30');
  p.line(2, 15, 11, 6, '#b07a44');
  p.poly([10, 6, 12, 2, 15, 0, 14, 4, 10, 7], '#d8e0f0');
  p.line(11, 5, 14, 1, '#ffffff');
  p.rect(9, 6, 2, 2, '#a8b0c8');
  p.px(8, 9, '#d83c2c');
  p.px(7, 10, '#d83c2c');
}, { outline: O });

defineWeapon({
  id: 'iron_spear',
  name: '파수 장창',
  desc: '길게 내지르는 창. 느리지만 멀리 닿고, 일직선 위의 적을 모두 꿰뚫는다.',
  icon: 'icon_iron_spear',
  heldSprite: 'w_spear',
  kind: 'melee',
  rarity: 'common',
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('damage', 1.35);
    m.mulStat('fireRate', 0.72);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!attackInput(st, w, firing) || st.cooldown > 0) return;
    consumeAttack(st);
    const s = p.stats;
    st.sinceAttack = 0;
    w.items.onAttack(aim);
    p.swing(w, {
      angle: aim, thrust: true, arc: 11, reach: 46 + s.range * 0.05, damage: s.damage,
      knockback: s.knockback * 2.6, color: '#d8e4ff', visual: 0.16, duration: 0.08, hitKick: 1.6,
    });
    st.mem.thrustAt = w.time;
    st.mem.thrustA = aim;
    st.cooldown = attackInterval(p);
    p.knock(Math.cos(aim), Math.sin(aim), 75);
    kick(w, aim, 1.4);
    w.sfx('swing', { vol: 0.55, pitch: 0.8 });
    w.sfx('whoosh', { vol: 0.3, pitch: 1.4 });
  },
  draw(w, p, r, st) {
    const t = (w.time - (st.mem.thrustAt ?? -9)) / 0.22;
    let ext = 0;
    if (t >= 0 && t < 1) ext = t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75;
    const a = ext > 0 ? st.mem.thrustA ?? p.aim : p.aim + (Math.cos(p.aim) >= 0 ? 0.35 : -0.35);
    drawHeld(r, p, 'w_spear', a, -2 + ext * 16, { flash: ext > 0.7 ? 0.4 : 0 });
  },
});
