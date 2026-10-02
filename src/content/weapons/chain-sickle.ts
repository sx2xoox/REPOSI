// 사슬낫 (chain sickle): a sickle on a chain swept in a huge arc around the
// wielder. Slow, very wide, and the hooked blade drags enemies closer.

import { defineWeapon } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { O, attackInterval, handPos, kick, meleeRest, pixLine, startSwingPose, swingPose, attackInput, consumeAttack } from './common';

// sickle blade pointing right (pivot at the chain ring on the left)
defineDrawnSprite('w_sickle', 13, 12, (p) => {
  p.rect(0, 9, 5, 2, '#5a3a24');
  p.px(0, 9, '#8a6040');
  p.ring(0.5, 10, 1.4, 1, '#8a92ac');
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const a = Math.PI * (0.95 - t * 0.85);
    const x = 6 + Math.cos(a) * 6;
    const y = 9 - Math.sin(a) * 8;
    p.px(x, y, '#c8f0d8');
    p.px(x + 1, y + 0.5, i > 2 ? '#7aa890' : '#c8f0d8');
  }
  p.px(12, 8, '#ffffff');
  p.px(5, 1, '#ffffff');
}, { outline: O, origin: [1, 10] });

defineDrawnSprite('icon_chain_sickle', 16, 16, (p) => {
  for (let i = 0; i < 6; i++) p.px(1 + i, 14 - i, i % 2 ? '#8a92ac' : '#c8d0e4');
  p.line(7, 8, 10, 11, '#5a3a24');
  for (let i = 0; i < 10; i++) {
    const a = Math.PI * (1.0 - i * 0.09);
    p.px(10 + Math.cos(a) * 4.5, 6 - Math.sin(a) * 5, '#c8f0d8');
    p.px(10.5 + Math.cos(a) * 4, 6.5 - Math.sin(a) * 4.4, '#7aa890');
  }
  p.px(14, 6, '#ffffff');
}, { outline: O });

defineWeapon({
  id: 'chain_sickle',
  name: '사슬낫',
  desc: '사슬에 매단 낫을 크게 휘두른다. 매우 넓게 베고, 맞은 적을 끌어당긴다.',
  icon: 'icon_chain_sickle',
  heldSprite: 'w_sickle',
  kind: 'melee',
  rarity: 'rare',
  pools: ['treasure', 'boss'],
  stats(m) {
    m.mulStat('damage', 1.4);
    m.mulStat('fireRate', 0.62);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!attackInput(st, w, firing) || st.cooldown > 0) return;
    consumeAttack(st);
    const s = p.stats;
    const dir = st.combo % 2 ? -1 : 1;
    st.sinceAttack = 0;
    w.items.onAttack(aim);
    const reach = 40 + s.range * 0.05;
    p.swing(w, {
      angle: aim, arc: 4.0, reach, damage: s.damage, knockback: -70, swingDir: dir,
      color: '#c8f0d8', visual: 0.24, duration: 0.11, hitKick: 1.2,
    });
    startSwingPose(st, w, aim - 2.0 * dir, aim + 2.0 * dir, 0.12, 0.05);
    st.mem.reach = reach;
    st.cooldown = attackInterval(p);
    st.combo = (st.combo + 1) % 2;
    st.comboTimer = st.cooldown + 0.6;
    kick(w, aim, 1.2);
    w.sfx('whoosh', { vol: 0.55, pitch: 0.75 });
    w.sfx('swing', { vol: 0.4, pitch: 0.7 });
  },
  draw(w, p, r, st) {
    const pose = swingPose(st, w, meleeRest(st, p.aim));
    const h = handPos(p, pose.angle, 4);
    // chain length: extended while swinging, short and dangling at rest
    const ext = pose.phase === 1 ? 1 : pose.phase === 2 ? 0.9 : pose.phase === 3 ? 0.9 * (1 - pose.t) : 0;
    const len = 6 + ext * ((st.mem.reach ?? 40) - 12);
    const sx = p.x + Math.cos(pose.angle) * (4 + len);
    const sy = p.y - 5 + Math.sin(pose.angle) * (4 + len) * 0.8 + (ext === 0 ? 3 : 0);
    // dotted chain
    const n = Math.max(2, Math.round(len / 3));
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const sag = ext === 0 ? Math.sin(k * Math.PI) * 2 : 0;
      r.rect(Math.round(h.x + (sx - h.x) * k), Math.round(h.y + (sy - h.y) * k + sag), 1, 1, i % 2 ? '#8a92ac' : '#c8d0e4');
    }
    pixLine(r, p.x + Math.cos(pose.angle) * 2, p.y - 5, h.x, h.y, '#5a3a24');
    r.sprite('w_sickle', sx, sy, { rot: pose.angle + (st.mem.restSide ?? 1) * 0.6, flipY: (st.mem.restSide ?? 1) < 0 });
  },
});
