// 흰 송곳니 (white fang): 백구's starting weapon. A short curved counter-blade:
// fast alternating cross cuts with little reach, every cut reflects enemy
// bullets; right after a perfect dodge (간파, see kit-baekgu) the cuts become
// lunging thrusts that carry the keeper into the enemy.

import { defineWeapon } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { O, attackInterval, drawHeld, kick, meleeRest, startSwingPose, swingPose, attackInput, consumeAttack } from './common';
import { inCounter } from '../characters/kit-baekgu';

export const FANG_COUNTER_DMG = 1.3;
export const FANG_COUNTER_REACH = 10;

// short curved blade pointing right, pivot at the grip
defineDrawnSprite('w_fang_blade', 15, 6, (p) => {
  p.rect(0, 2, 4, 2, '#2d3f80');
  p.px(0, 3, '#d8a040');
  p.px(3, 2, '#4a62b8');
  p.rect(4, 1, 1, 4, '#d8a040');
  p.poly([5, 1.5, 11, 0.5, 15, 2.5, 11, 4.5, 5, 4.5], '#f4f2ea');
  p.line(5, 2, 11, 1, '#ffffff');
  p.line(6, 4, 13, 3, '#b8b4a8');
}, { outline: O, origin: [1, 3] });

defineDrawnSprite('icon_fang_blade', 16, 16, (p) => {
  // a white curved fang-blade angled up-right, navy grip bottom-left
  p.line(2, 14, 4, 12, '#2d3f80');
  p.line(3, 14, 5, 12, '#4a62b8');
  p.px(1, 15, '#d8a040');
  p.line(5, 11, 6, 10, '#d8a040');
  p.poly([6, 10, 10, 4, 14, 1, 13, 5, 8, 11], '#f4f2ea');
  p.line(7, 10, 13, 2, '#ffffff');
  p.line(8, 11, 12, 6, '#b8b4a8');
  p.px(14, 1, '#ffffff');
}, { outline: O });

defineWeapon({
  id: 'fang_blade',
  name: '흰 송곳니',
  desc: '짧고 빠른 반격용 단도. 베기마다 탄환을 되받아치고, 간파 직후에는 몸을 날려 깊게 찌른다. 반사 피해는 공격력의 40%.',
  icon: 'icon_fang_blade',
  heldSprite: 'w_fang_blade',
  kind: 'melee',
  rarity: 'rare',
  archetype: '단도',
  tags: ['blade', 'quick'],
  pools: ['treasure', 'shop'],
  stats(m) {
    m.mulStat('damage', 0.62);
    m.mulStat('fireRate', 1.55);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!attackInput(st, w, firing) || st.cooldown > 0) return;
    consumeAttack(st);
    const s = p.weaponStats;
    const hand = st.combo % 2;
    const dir = hand ? -1 : 1;
    const counter = inCounter(w);
    st.sinceAttack = 0;
    w.items.onAttack(aim);
    const reach = 20 + s.range * 0.03 + (counter ? FANG_COUNTER_REACH : 0);
    if (counter) {
      // lunging thrust: the keeper hops toward the aim and stabs deep
      p.swing(w, {
        angle: aim, thrust: true, arc: 12, reach, damage: s.damage * FANG_COUNTER_DMG, knockback: s.knockback * 2,
        color: '#ffffff', reflect: true, visual: 0.12, duration: 0.07, hitKick: 1.6,
      });
      p.knock(Math.cos(aim), Math.sin(aim), 150);
      startSwingPose(st, w, aim + 0.5 * dir, aim, 0.05, 0.06);
      w.sfx('swing', { vol: 0.5, pitch: 1.5 });
      w.sfx('whoosh', { vol: 0.3, pitch: 1.6 });
    } else {
      p.swing(w, {
        angle: aim, arc: 2.0, reach, damage: s.damage, knockback: s.knockback * 1.2, swingDir: dir,
        color: '#f4f2ea', reflect: true, visual: 0.12, duration: 0.06, hitKick: 0.8,
      });
      startSwingPose(st, w, aim - 1.1 * dir, aim + 1.1 * dir, 0.05, 0.04);
      p.knock(Math.cos(aim), Math.sin(aim), 28);
      w.sfx('swing', { vol: 0.4, pitch: 1.35 + hand * 0.15 });
    }
    kick(w, aim, 0.6);
    st.cooldown = attackInterval(p);
    st.combo = (hand + 1) % 2;
    st.comboTimer = 0.8;
  },
  draw(w, p, r, st) {
    const rest = meleeRest(st, p.aim);
    const pose = swingPose(st, w, rest);
    const active = pose.phase === 1 || pose.phase === 2;
    drawHeld(r, p, 'w_fang_blade', pose.angle, active ? 6 : 3, { flash: pose.phase === 1 ? 0.5 : inCounter(w) ? 0.25 + 0.2 * Math.sin(w.time * 20) : 0 });
  },
});
