// 구조등 도리깨 (rescue-lantern flail): 보리's starting weapon. A heavy lantern on
// a short chain, swung in wide slow arcs that shove everything aside; every third
// swing is an overhead slam that drops the lantern on the ground and sends out a
// shockwave. Slow, forgiving reach, big knockback.

import { defineWeapon } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { O, attackInterval, glowSprite, kick, meleeRest, startSwingPose, swingPose, attackInput, consumeAttack, handPos } from './common';
import { Shockwave } from './great-hammer';

export const FLAIL_SLAM_DMG = 1.8;
export const FLAIL_WAVE_DMG = 0.6;

// handle + chain + the lantern head, pointing right (pivot at the grip)
defineDrawnSprite('w_lantern_flail', 26, 11, (p) => {
  p.rect(0, 4, 8, 3, '#6a4424');
  p.rect(0, 4, 8, 1, '#9a6a3a');
  p.px(0, 5, '#f0c050');
  p.px(1, 5, '#f0c050');
  // chain links
  for (let i = 0; i < 4; i++) {
    p.rect(8 + i * 2, 4 + (i % 2), 2, 2, i % 2 ? '#8a8a98' : '#c0c0cc');
  }
  // lantern: cap, glass, base
  p.rect(17, 1, 7, 2, '#6a4424');
  p.rect(18, 0, 5, 1, '#9a6a3a');
  p.rect(16, 3, 9, 6, '#ffd060');
  p.rect(17, 4, 7, 4, '#fff2a8');
  p.rect(18, 5, 3, 2, '#ffffff');
  p.rect(16, 3, 1, 6, '#6a4424');
  p.rect(24, 3, 1, 6, '#6a4424');
  p.rect(20, 3, 1, 6, '#c89848');
  p.rect(17, 9, 7, 2, '#6a4424');
  p.rect(18, 9, 5, 1, '#9a6a3a');
}, { outline: O, origin: [1, 5] });

defineDrawnSprite('icon_lantern_flail', 16, 16, (p) => {
  // short handle bottom-left, chain up to a lantern top-right
  p.line(1, 14, 4, 11, '#6a4424');
  p.line(2, 15, 5, 12, '#9a6a3a');
  p.px(5, 10, '#c0c0cc');
  p.px(6, 9, '#8a8a98');
  p.px(7, 8, '#c0c0cc');
  p.rect(8, 1, 7, 2, '#6a4424');
  p.rect(7, 3, 9, 7, '#ffd060');
  p.rect(8, 4, 7, 5, '#fff2a8');
  p.rect(9, 5, 3, 2, '#ffffff');
  p.rect(7, 3, 1, 7, '#6a4424');
  p.rect(15, 3, 1, 7, '#6a4424');
  p.rect(11, 3, 1, 7, '#c89848');
  p.rect(8, 10, 7, 2, '#6a4424');
  p.px(1, 13, '#f0c050');
}, { outline: O });

for (let d = 14; d <= 26; d += 2) glowSprite(d, '#ffb040');

defineWeapon({
  id: 'lantern_flail',
  name: '구조등 도리깨',
  desc: '사슬에 매단 무거운 등불을 넓게 휘두른다. 세 번째 휘두르기는 등불을 내려찍어 충격파를 퍼뜨린다.',
  icon: 'icon_lantern_flail',
  heldSprite: 'w_lantern_flail',
  kind: 'melee',
  rarity: 'rare',
  archetype: '도리깨',
  tags: ['heavy'],
  pools: ['treasure', 'boss'],
  stats(m) {
    m.mulStat('damage', 1.5);
    m.mulStat('fireRate', 0.62);
    m.addStat('knockback', 30);
  },
  update(w, p, st, dt, firing, aim) {
    const want = attackInput(st, w, firing);
    // overhead slam wind-up
    if ((st.mem.wind ?? 0) > 0) {
      st.mem.wind -= dt;
      if (st.mem.wind <= 0) {
        const s = p.stats;
        const a = st.mem.windAim ?? aim;
        const reach = (26 + s.range * 0.04) * 1.15;
        const ix = p.x + Math.cos(a) * reach * 0.7;
        const iy = p.y - 1 + Math.sin(a) * reach * 0.55;
        let landed = false;
        p.swing(w, {
          angle: a, arc: 2.2, reach, damage: s.damage * FLAIL_SLAM_DMG, knockback: s.knockback * 3.6, swingDir: 1,
          color: '#ffe2a0', visual: 0.22, duration: 0.1, hitKick: 2.5,
          onHit: (ww) => {
            if (landed) return;
            landed = true;
            ww.hitstop(0.07);
          },
        });
        w.spawn(new Shockwave(ix, iy, 24 + s.range * 0.03, s.damage * FLAIL_WAVE_DMG, '#ffd8a0'));
        w.particles.burst(ix, iy, { count: 16, speed: [40, 130], life: [0.25, 0.6], colors: ['#ffffff', '#ffe080', '#ff9a30', '#a09080'], size: [1, 3], gravity: 260, vz: [30, 110] });
        w.lights.glow(ix, iy, 50, '#ffb040', 0.6);
        w.decal(ix, iy, '#1a1008', 5, 0.35);
        w.shake(0.3);
        kick(w, a, 2.6);
        w.sfx('slam', { vol: 0.8, pitch: 1.1 });
        w.sfx('hit_metal', { vol: 0.35, pitch: 0.7 });
        startSwingPose(st, w, a - 2.2, a + 0.2, 0.07, 0.14);
      }
      return;
    }
    if (!want || st.cooldown > 0) return;
    consumeAttack(st);
    const s = p.stats;
    const step = st.combo % 3;
    const iv = attackInterval(p);
    const reach = 26 + s.range * 0.04;
    st.sinceAttack = 0;
    w.items.onAttack(aim);
    if (step < 2) {
      const dir = step === 0 ? 1 : -1;
      p.swing(w, {
        angle: aim, arc: 3.0, reach, damage: s.damage, knockback: s.knockback * 2.4, swingDir: dir,
        color: '#ffd8a0', visual: 0.2, duration: 0.11, hitKick: 1.6,
      });
      startSwingPose(st, w, aim - 1.6 * dir, aim + 1.6 * dir, 0.1, 0.06);
      st.cooldown = iv * 0.9;
      p.knock(Math.cos(aim), Math.sin(aim), 40);
      kick(w, aim, 1.4);
      w.sfx('swing_heavy', { vol: 0.5, pitch: step === 0 ? 0.9 : 1.0 });
      w.sfx('whoosh', { vol: 0.25, pitch: 0.7 });
    } else {
      // third swing: raise the lantern, then slam (see wind-up above)
      st.mem.wind = 0.14;
      st.mem.windAim = aim;
      st.cooldown = iv * 1.35 + 0.14;
      startSwingPose(st, w, aim + 0.4, aim - 2.2, 0.12, 0.1);
      w.sfx('charge', { vol: 0.3, pitch: 1.4 });
    }
    st.combo = (step + 1) % 3;
    st.comboTimer = st.cooldown + 0.6;
  },
  draw(w, p, r, st) {
    const rest = meleeRest(st, p.aim);
    const pose = swingPose(st, w, rest);
    const active = pose.phase === 1 || pose.phase === 2;
    const h = handPos(p, pose.angle, active ? 4 : 1);
    // the lantern glows harder mid-swing
    const head = handPos(p, pose.angle, (active ? 4 : 1) + 20);
    const glow = 0.16 + 0.06 * Math.sin(p.age * 6) + (active ? 0.3 : 0);
    r.sprite(glowSprite(active ? 24 : 16, '#ffb040'), head.x, head.y, { alpha: glow, additive: true });
    r.sprite('w_lantern_flail', h.x, h.y, { rot: pose.angle, flipY: Math.cos(pose.angle) < 0, flash: pose.phase === 1 ? 0.4 : 0 });
    if (active && fx.chance(0.5)) w.particles.spawn({ x: head.x + fx.range(-2, 2), y: head.y + fx.range(-2, 2), life: 0.18, colors: ['#fff0a0', '#ffb040'], size: 1.5, sizeEnd: 0.5, additive: true });
  },
});
