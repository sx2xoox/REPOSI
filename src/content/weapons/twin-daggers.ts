// 쌍둥이 단검 (twin daggers): very fast alternating stabs from both hands.
// Short reach, low damage per stab, each stab may open a bleeding wound.

import { defineWeapon } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { O, attackInterval, drawHeld, kick, attackInput, consumeAttack } from './common';

defineDrawnSprite('w_dagger', 11, 5, (p) => {
  p.rect(0, 2, 3, 1, '#4a2a1a');
  p.px(0, 2, '#8a6040');
  p.rect(3, 0, 1, 5, '#a8b0c8');
  p.px(3, 0, '#e8f0ff');
  p.poly([4, 1, 9, 1.5, 11, 2.5, 9, 3.5, 4, 4], '#d8e0f0');
  p.line(4, 1, 9, 1, '#ffffff');
  p.line(5, 3, 9, 3, '#8890a8');
}, { outline: O, origin: [1, 2] });

defineDrawnSprite('icon_twin_daggers', 16, 16, (p) => {
  // two crossed daggers
  p.line(2, 13, 11, 4, '#d8e0f0');
  p.line(3, 13, 12, 4, '#a8b0c8');
  p.line(12, 4, 13, 3, '#ffffff');
  p.line(1, 11, 4, 14, '#c0a060');
  p.line(0, 15, 2, 13, '#4a2a1a');
  p.line(13, 13, 4, 4, '#e8f0ff');
  p.line(12, 13, 3, 4, '#8890a8');
  p.line(3, 4, 2, 3, '#ffffff');
  p.line(14, 11, 11, 14, '#c0a060');
  p.line(15, 15, 13, 13, '#4a2a1a');
  p.px(7, 8, '#e03c4c');
}, { outline: O });

defineWeapon({
  id: 'twin_daggers',
  name: '쌍둥이 단검',
  desc: '양손 단검으로 번갈아 빠르게 찌른다. 찌를 때마다 25% 확률로 출혈을 일으킨다.',
  icon: 'icon_twin_daggers',
  heldSprite: 'w_dagger',
  kind: 'melee',
  rarity: 'common',
  pools: ['treasure', 'shop'],
  stats(m) {
    m.mulStat('damage', 0.55);
    m.mulStat('fireRate', 2.1);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!attackInput(st, w, firing) || st.cooldown > 0) return;
    consumeAttack(st);
    const s = p.stats;
    const hand = st.combo % 2;
    st.sinceAttack = 0;
    w.items.onAttack(aim);
    const side = hand ? -1 : 1;
    p.swing(w, {
      angle: aim + side * 0.12, thrust: true, arc: 10, reach: 22 + s.range * 0.03, damage: s.damage,
      knockback: s.knockback * 0.7, color: '#e0e8ff', visual: 0.1, duration: 0.06, hitKick: 0.7,
      statuses: [{ kind: 'bleed', duration: 3, power: s.damage * 0.3, chance: 0.25 }],
    });
    st.mem[`stab${hand}`] = w.time;
    st.cooldown = attackInterval(p);
    st.combo = (hand + 1) % 2;
    st.comboTimer = 1;
    p.knock(Math.cos(aim), Math.sin(aim), 22);
    kick(w, aim, 0.5);
    w.sfx('swing', { vol: 0.35, pitch: 1.55 + w.rng.next() * 0.2 });
  },
  draw(w, p, r, st) {
    const aim = p.aim;
    for (let hand = 0; hand < 2; hand++) {
      const side = hand ? -1 : 1;
      const t = (w.time - (st.mem[`stab${hand}`] ?? -9)) / 0.12;
      const ext = t >= 0 && t < 1 ? Math.sin(t * Math.PI) : 0;
      const a = aim + side * (0.75 - ext * 0.6);
      drawHeld(r, p, 'w_dagger', a, 4 + ext * 8, { flash: ext > 0.6 ? 0.5 : 0 });
    }
  },
});
