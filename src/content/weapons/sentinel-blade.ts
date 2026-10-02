// 파수꾼의 장검 (sentinel blade): Bern's longsword. Three-hit combo — two quick
// cross slashes and a heavy finisher that throws a sword wave. Every swing
// reflects enemy bullets back as player shots.

import { defineWeapon } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { O, attackInterval, drawHeld, kick, meleeRest, startSwingPose, swingPose, attackInput, consumeAttack } from './common';
import { swordWaveSprite } from './sprites';

defineDrawnSprite('w_sentinel_blade', 23, 7, (p) => {
  // grip + pommel
  p.rect(0, 2, 4, 3, '#5a3a24');
  p.px(1, 2, '#7a5236');
  p.rect(0, 3, 1, 1, '#f0c050');
  // cross guard
  p.rect(4, 0, 2, 7, '#f0c050');
  p.px(4, 0, '#fff0a0');
  p.px(5, 6, '#a07020');
  // blade
  p.poly([6, 1.5, 19, 1.5, 23, 3.5, 19, 5.5, 6, 5.5], '#b8c4dc');
  p.line(6, 2, 19, 2, '#ffffff');
  p.line(7, 4, 17, 4, '#7c88a8');
  p.line(6, 5, 19, 5, '#6a7490');
}, { outline: O, origin: [1, 3] });

defineDrawnSprite('icon_sentinel_blade', 16, 16, (p) => {
  p.poly([3, 11, 11, 3, 13.5, 2.5, 13, 5, 5, 13], '#c8d4ec');
  p.line(4, 11, 12, 3, '#ffffff');
  p.line(5, 12, 12, 5, '#7c88a8');
  p.line(2, 9, 7, 14, '#f0c050');
  p.line(2, 10, 6, 14, '#c09030');
  p.line(1, 15, 3, 13, '#5a3a24');
  p.px(0, 15, '#f0c050');
}, { outline: O });

defineWeapon({
  id: 'sentinel_blade',
  name: '파수꾼의 장검',
  desc: '3연격 장검. 마지막 일격은 검기를 날린다. 모든 베기가 적 탄환을 되받아친다.',
  icon: 'icon_sentinel_blade',
  heldSprite: 'w_sentinel_blade',
  kind: 'melee',
  rarity: 'rare',
  tags: ['blade'],
  pools: ['treasure', 'boss'],
  stats(m) {
    m.mulStat('damage', 0.95);
    m.mulStat('fireRate', 0.7);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!attackInput(st, w, firing) || st.cooldown > 0) return;
    consumeAttack(st);
    const s = p.stats;
    const step = st.combo % 3;
    const iv = attackInterval(p);
    const reach = 24 + s.range * 0.035;
    st.sinceAttack = 0;
    w.items.onAttack(aim);
    if (step < 2) {
      const dir = step === 0 ? 1 : -1;
      p.swing(w, {
        angle: aim, arc: 2.3, reach, damage: s.damage, knockback: s.knockback * 2, swingDir: dir,
        color: '#cfe0ff', reflect: true, visual: 0.17,
      });
      startSwingPose(st, w, aim - 1.25 * dir, aim + 1.3 * dir, 0.06, 0.05);
      st.cooldown = iv * 0.72;
      p.knock(Math.cos(aim), Math.sin(aim), 55);
      kick(w, aim, 1);
      w.sfx('swing', { vol: 0.65, pitch: step === 0 ? 1 : 1.15 });
    } else {
      // finisher: wide heavy cleave + sword wave
      let landed = false;
      p.swing(w, {
        angle: aim, arc: 3.4, reach: reach * 1.3, damage: s.damage * 2, knockback: s.knockback * 4.2, swingDir: 1,
        color: '#ffe2a0', reflect: true, visual: 0.24, duration: 0.12, hitKick: 2.5,
        onHit: (ww) => {
          if (landed) return;
          landed = true;
          ww.hitstop(0.075);
          ww.shake(0.22);
        },
      });
      startSwingPose(st, w, aim - 1.75, aim + 1.75, 0.08, 0.13);
      p.fireProjectiles(w, aim, {
        style: 'sprite', sprite: swordWaveSprite('#ffe2a0'), radius: 6 + s.projSize * 0.5, speed: 250,
        range: 70 + s.range * 0.25, damageMult: 0.8, pierce: 99, knockback: 120, light: 26, color: '#ffe2a0',
        accel: -260, minSpeed: 110,
      });
      st.cooldown = iv * 1.5;
      p.knock(Math.cos(aim), Math.sin(aim), 115);
      kick(w, aim, 2.5);
      w.shake(0.12);
      w.sfx('swing_heavy', { vol: 0.85 });
      w.sfx('whoosh', { vol: 0.4, pitch: 0.8 });
    }
    st.combo = (step + 1) % 3;
    st.comboTimer = st.cooldown + 0.5;
  },
  draw(w, p, r, st) {
    const rest = meleeRest(st, p.aim);
    const pose = swingPose(st, w, rest);
    const active = pose.phase === 1 || pose.phase === 2;
    // at rest the blade is carried lower and a little smaller; it extends to full size when swung
    const sc = active ? 1 : pose.phase === 3 ? 1 - 0.18 * pose.t : 0.82;
    drawHeld(r, p, 'w_sentinel_blade', pose.angle, active ? 5 : 2, { flash: pose.phase === 1 ? 0.5 : 0, sx: sc, sy: sc });
  },
});
