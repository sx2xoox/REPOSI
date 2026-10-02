// 회귀 칼날 (returning blade): a spinning ring blade that is thrown, slows at
// the end of its flight, then whips back to the hand — cutting everything on
// the way out and again on the way back. Only one throw at a time.

import { defineWeapon, type WeaponState } from '../../game/defs';
import type { World } from '../../game/world';
import type { Projectile, ProjBehavior } from '../../game/projectile';
import { defineDrawnSprite } from '../../engine/sprites';
import { angleTo, dist, rotateToward } from '../../engine/math';
import { O, attackInterval, glowSprite, handPos, kick } from './common';

defineDrawnSprite('proj_return_blade', 13, 13, (p) => {
  p.ring(6.5, 6.5, 6.4, 2.2, '#c8d4ec');
  p.ring(6.5, 6.5, 6.4, 1, '#ffffff');
  p.circle(6.5, 6.5, 2.2, '#4a5068');
  p.px(6, 6, '#8a92ac');
  // four hooked teeth
  p.px(6, 0, '#ffffff'); p.px(7, 0, '#ffffff');
  p.px(12, 6, '#ffffff'); p.px(12, 7, '#ffffff');
  p.px(5, 12, '#ffffff'); p.px(6, 12, '#ffffff');
  p.px(0, 5, '#ffffff'); p.px(0, 6, '#ffffff');
  p.px(3, 3, '#7c88a8'); p.px(9, 9, '#7c88a8');
}, { outline: O });

defineDrawnSprite('icon_return_blade', 16, 16, (p) => {
  p.ring(8, 8, 7, 2.4, '#c8d4ec');
  p.ring(8, 8, 7, 1, '#ffffff');
  p.circle(8, 8, 2.5, '#4a5068');
  p.px(8, 0, '#ffffff'); p.px(15, 8, '#ffffff'); p.px(7, 15, '#ffffff'); p.px(0, 7, '#ffffff');
  p.line(3, 13, 1, 15, '#5fb8ff');
  p.line(13, 3, 15, 1, '#5fb8ff');
}, { outline: O });

/** Flight plan of a thrown blade: outbound distance for a range stat (exported for tests). */
export function bladeOutDistance(range: number): number {
  return Math.max(60, range * 0.55);
}

function returnBehavior(st: WeaponState, outDist: number, baseSpeed: number): ProjBehavior {
  const startReturn = (pr: Projectile) => {
    if (pr.mem.ret) return;
    pr.mem.ret = 1;
    pr.hitIds.clear();
    pr.speed = Math.max(pr.speed, 90);
  };
  return {
    id: 'return_blade',
    update(pr, w, dt) {
      pr.mem.spin = (pr.mem.spin ?? 0) + dt * 28;
      const pl = w.player;
      if (!pr.mem.ret) {
        const k = pr.traveled / outDist;
        pr.speed = Math.max(70, baseSpeed * (1 - k * 0.75));
        if (k >= 1) startReturn(pr);
      } else {
        const want = angleTo(pr.x, pr.y, pl.x, pl.y - 5);
        pr.angle = rotateToward(pr.angle, want, 16 * dt);
        pr.speed = Math.min(420, pr.speed + 700 * dt);
        if (dist(pr.x, pr.y, pl.x, pl.y - 5) < 9 || pr.age > 3.5) {
          // caught!
          pr.mem.caught = 1;
          pr.dead = true;
          st.mem.out = Math.max(0, (st.mem.out ?? 1) - 1);
          st.cooldown = Math.min(st.cooldown, 0.06);
          w.sfx('parry', { vol: 0.35, pitch: 1.5 });
          w.particles.burst(pr.x, pr.y, { count: 5, speed: [20, 60], life: [0.1, 0.2], colors: ['#ffffff', '#c8d4ec'], shape: 'spark', size: [1, 2] });
          return;
        }
      }
      pr.syncVel();
      if (Math.floor(pr.mem.spin / 3) !== Math.floor((pr.mem.spin - dt * 28) / 3)) w.sfx('whoosh', { vol: 0.12, pitch: 1.8 });
    },
    onWall(pr) {
      startReturn(pr);
      return true;
    },
    onExpire(pr) {
      if (!pr.mem.caught) st.mem.out = Math.max(0, (st.mem.out ?? 1) - 1);
    },
    draw(pr, r) {
      r.sprite('proj_return_blade', pr.x, pr.y - pr.z, { rot: pr.mem.spin ?? 0 });
    },
  };
}

defineWeapon({
  id: 'return_blade',
  name: '회귀 칼날',
  desc: '던지면 돌아오는 고리 칼날. 날아갈 때와 돌아올 때 모두 적을 벤다.',
  icon: 'icon_return_blade',
  heldSprite: 'proj_return_blade',
  kind: 'ranged',
  rarity: 'rare',
  pools: ['treasure', 'shop'],
  stats(m) {
    m.mulStat('damage', 1.2);
  },
  update(w: World, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0 || (st.mem.out ?? 0) > 0) return;
    const s = p.stats;
    st.sinceAttack = 0;
    w.items.onAttack(aim);
    const speed = s.shotSpeed * 1.25;
    const outDist = bladeOutDistance(s.range);
    const h = handPos(p, aim, 8);
    const shots = p.fireProjectiles(w, aim, {
      style: 'none', speed, range: 99999, life: 4, pierce: 999, radius: s.projSize + 2.5, knockback: s.knockback * 0.8,
      x: h.x, y: h.y, color: '#c8d4ec', light: 16,
      behaviors: [returnBehavior(st, outDist, speed)],
    });
    st.mem.out = shots.length;
    st.cooldown = attackInterval(p, 0.35);
    kick(w, aim, 0.8);
    w.sfx('whoosh', { vol: 0.5, pitch: 1.2 });
    w.sfx('swing', { vol: 0.3, pitch: 1.6 });
  },
  draw(w, p, r, st) {
    if ((st.mem.out ?? 0) > 0) return;
    const h = handPos(p, p.aim, 7);
    r.sprite(glowSprite(12, '#8ab0ff'), h.x, h.y, { alpha: 0.18, additive: true });
    r.sprite('proj_return_blade', h.x, h.y, { rot: w.time * 2 });
  },
});
