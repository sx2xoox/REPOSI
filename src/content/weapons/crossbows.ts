// Bows and crossbows:
//  연노 쇠뇌   (volley_crossbow, rare) — hold to crank bolts into the magazine
//                                       one by one, release to loose them all
//  별꿰기 장궁 (star_piercer, rare)    — sniper longbow: slow, a sighting line,
//                                       one devastating arrow that pierces lines

import { defineWeapon } from '../../game/defs';
import type { ProjBehavior } from '../../game/projectile';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { O, attackInterval, chargeTime, drawHeld, glowSprite, handPos, kick, muzzle, rayLength } from './common';
import { beginAttack, shotFade } from './kit';

// ================================================================== 연노 쇠뇌
defineDrawnSprite('w_volley_crossbow', 17, 13, (p) => {
  p.rect(0, 6, 12, 2, '#6a4a2a');
  p.rect(0, 6, 12, 1, '#9a7040');
  p.rect(1, 8, 3, 3, '#4a2a1a');
  // magazine box on top
  p.rect(5, 3, 5, 3, '#5a5a6a');
  p.rect(5, 3, 5, 1, '#9a9aaa');
  // limbs (steel, recurved)
  p.line(12, 1, 14, 6, '#8a92ac');
  p.line(12, 12, 14, 7, '#8a92ac');
  p.line(11, 0, 12, 1, '#c8d0e4');
  p.line(11, 12, 12, 12, '#c8d0e4');
  p.line(11, 1, 11, 11, '#d8d0c0');
  p.rect(14, 6, 3, 2, '#c0c8d8');
  p.px(16, 6, '#ffffff');
}, { outline: O, origin: [2, 7] });

defineDrawnSprite('icon_volley_crossbow', 16, 16, (p) => {
  p.line(2, 14, 11, 5, '#6a4a2a');
  p.line(3, 14, 12, 5, '#9a7040');
  p.poly([5, 8, 8, 5, 10, 7, 7, 10], '#7a7a8a');
  p.line(6, 8, 8, 6, '#b0b0c0');
  p.line(8, 1, 15, 8, '#8a92ac');
  p.line(8, 2, 14, 8, '#c8d0e4');
  p.line(12, 4, 15, 1, '#d8e0f0');
  p.line(13, 5, 16, 2, '#d8e0f0');
  p.px(15, 1, '#ffffff');
}, { outline: O });

defineDrawnSprite('proj_volley_bolt', 9, 3, (p) => {
  p.rect(0, 1, 6, 1, '#7a5a38');
  p.poly([5, 0, 9, 1.5, 5, 3], '#b8f080');
  p.px(7, 1, '#ffffff');
  p.px(0, 0, '#60a040');
  p.px(0, 2, '#60a040');
}, { outline: O, origin: [5, 1] });

/** Bolts the magazine holds for a multishot stat (exported for tests). */
export function volleyCapacity(shots: number): number {
  return 4 + Math.max(0, Math.floor(shots) - 1);
}

defineWeapon({
  id: 'volley_crossbow',
  name: '연노 쇠뇌',
  desc: '누르고 있으면 화살을 한 발씩 장전한다. 떼면 장전한 화살을 한꺼번에 날린다. 독이 묻어 있다.',
  icon: 'icon_volley_crossbow',
  heldSprite: 'w_volley_crossbow',
  kind: 'charge',
  archetype: '연발 쇠뇌',
  rarity: 'rare',
  pools: ['treasure', 'shop'],
  stats(m) {
    m.mulStat('shotSpeed', 1.45);
    m.mulStat('range', 1.1);
  },
  update(w, p, st, dt, firing, aim) {
    const s = p.stats;
    const cap = volleyCapacity(s.shots);
    if (firing && st.cooldown <= 0) {
      if (!st.mem.drawing) {
        st.mem.drawing = 1;
        st.mem.loaded = 1;
        st.mem.loadT = 0;
        w.sfx('charge', { vol: 0.25, pitch: 1.6 });
      }
      if (st.mem.loaded < cap) {
        st.mem.loadT += dt;
        const per = chargeTime(p, 0.2);
        if (st.mem.loadT >= per) {
          st.mem.loadT -= per;
          st.mem.loaded++;
          st.mem.clickAt = w.time;
          w.sfx('hit_metal', { vol: 0.2, pitch: 1.6 + st.mem.loaded * 0.08 });
          if (st.mem.loaded >= cap) w.sfx('charge_ready', { vol: 0.35, pitch: 1.3 });
        }
      }
      st.charge = st.mem.loaded / cap;
      return;
    }
    if (!st.mem.drawing) return;
    // release: loose the magazine in a tight fan
    st.mem.drawing = 0;
    const n = Math.max(1, st.mem.loaded ?? 1);
    st.charge = 0;
    beginAttack(w, p, st, aim);
    const h = handPos(p, aim, 15);
    const spread = 0.07;
    for (let i = 0; i < n; i++) {
      const a = aim + (i - (n - 1) / 2) * spread + (w.rng.next() - 0.5) * 0.03;
      p.fireProjectiles(w, a, {
        count: 1, style: 'sprite', sprite: 'proj_volley_bolt', damageMult: 0.72, color: '#b8f080', light: 12, x: h.x, y: h.y,
        speed: s.shotSpeed * (1 + i * 0.04), statuses: [{ kind: 'poison', duration: 2.5, power: s.damage * 0.25, chance: 0.2 }],
      });
    }
    muzzle(w, h.x, h.y, aim, ['#ffffff', '#e0f0c0', '#a0d070'], 3 + n, [40, 120]);
    kick(w, aim + Math.PI, 0.6 + n * 0.35);
    p.knock(-Math.cos(aim), -Math.sin(aim), 12 * n);
    st.cooldown = attackInterval(p, 0.5);
    w.sfx('shoot_arrow', { vol: 0.35 + n * 0.08, pitch: 1.35 - n * 0.06 });
    if (n >= 3) w.sfx('whoosh', { vol: 0.3, pitch: 1.4 });
  },
  draw(w, p, r, st) {
    const f = shotFade(st, w, 0.12);
    const click = w.time - (st.mem.clickAt ?? -9) < 0.05 ? 1 : 0;
    drawHeld(r, p, 'w_volley_crossbow', p.aim, 6 - f * 3 - click, { flash: f > 0.6 ? 0.3 : 0 });
    if (!st.mem.drawing) return;
    // loaded bolts glint along the stock
    const n = st.mem.loaded ?? 0;
    for (let i = 0; i < n; i++) {
      const h = handPos(p, p.aim, 8 + i * 1.6);
      r.rect(Math.round(h.x), Math.round(h.y - 4 - (i % 2)), 1, 1, i === n - 1 ? '#ffffff' : '#b8f080', 0.95);
    }
  },
});

// ================================================================== 별꿰기 장궁
defineDrawnSprite('w_star_piercer', 9, 25, (p) => {
  // tall longbow (pivot at the grip), string on the left
  p.line(1, 0, 1, 24, '#e8e0d0');
  for (let y = 0; y < 25; y++) {
    const k = (y - 12) / 12;
    const x = 2 + Math.round((1 - k * k) * 5);
    p.px(x, y, '#3a4a7a');
    p.px(x - 1, y, y < 4 || y > 20 ? '#8a9ad8' : '#5a6aa8');
  }
  p.rect(6, 10, 2, 5, '#c8a040');
  p.px(7, 12, '#fff0a0');
  p.px(2, 0, '#ffe060');
  p.px(2, 24, '#ffe060');
}, { outline: O, origin: [6, 12] });

defineDrawnSprite('icon_star_piercer', 16, 16, (p) => {
  for (let i = 0; i <= 14; i++) {
    const k = (i - 7) / 7;
    const x = 1 + i;
    const y = 15 - i - Math.round((1 - k * k) * 4);
    p.px(x, y, '#5a6aa8');
    p.px(x, y + 1, '#3a4a7a');
  }
  p.line(1, 15, 15, 1, '#e8e0d0');
  p.line(3, 13, 14, 2, '#d8c8a0');
  p.poly([12, 2, 16, 0, 14, 4], '#fff6c0');
  p.px(15, 0, '#ffffff');
  p.px(8, 4, '#ffe060');
  p.px(11, 9, '#ffe060');
}, { outline: O });

defineDrawnSprite('proj_star_arrow', 20, 5, (p) => {
  p.line(0, 2, 15, 2, '#d8c8a0');
  p.line(4, 2, 15, 2, '#fff0c0');
  p.poly([14, 0, 20, 2.5, 14, 5], '#fff6c0');
  p.px(16, 2, '#ffffff');
  p.px(17, 2, '#ffffff');
  p.px(0, 1, '#8a9ad8');
  p.px(1, 1, '#8a9ad8');
  p.px(0, 3, '#5a6aa8');
  p.px(1, 3, '#5a6aa8');
}, { outline: '#1a1430', origin: [15, 2] });

const starTrail: ProjBehavior = {
  id: 'star_trail',
  update(pr, w) {
    w.particles.spawn({ x: pr.x + fx.range(-1, 1), y: pr.y - pr.z + fx.range(-1, 1), life: 0.3, colors: ['#ffffff', '#fff0a0', '#8a9ad8'], size: 1, shape: 'pixel', additive: true });
  },
  onHit(pr, w, target) {
    w.particles.burst(target.x, target.y - 4, { count: 8, speed: [60, 160], angle: pr.angle, spread: 0.5, life: [0.1, 0.25], colors: ['#ffffff', '#fff0a0'], size: [1, 2], shape: 'spark' });
    w.hitstop(0.035);
  },
};

defineWeapon({
  id: 'star_piercer',
  name: '별꿰기 장궁',
  desc: '조준선을 따라 별빛 화살을 쏘는 장궁. 느리지만 한 발이 무겁고, 늘어선 적을 꿰뚫는다.',
  icon: 'icon_star_piercer',
  heldSprite: 'w_star_piercer',
  kind: 'ranged',
  archetype: '저격',
  rarity: 'rare',
  pools: ['treasure', 'boss'],
  stats(m) {
    m.mulStat('damage', 3.3);
    m.mulStat('fireRate', 0.38);
    m.mulStat('shotSpeed', 2.6);
    m.mulStat('range', 1.9);
    m.addStat('pierce', 3);
  },
  update(w, p, st, dt, firing, aim) {
    st.anim = Math.max(0, st.anim - dt * 3);
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const h = handPos(p, aim, 9);
    p.fireProjectiles(w, aim, {
      style: 'sprite', sprite: 'proj_star_arrow', color: '#fff0a0', light: 24, x: h.x, y: h.y, behaviors: [starTrail],
      radius: Math.max(2.5, p.stats.projSize - 0.5), spreadMult: 0.5,
    });
    muzzle(w, h.x, h.y, aim, ['#ffffff', '#fff0a0', '#8a9ad8'], 8, [60, 180]);
    st.anim = 1;
    kick(w, aim + Math.PI, 2.4);
    w.shake(0.06);
    w.sfx('shoot_arrow', { vol: 0.7, pitch: 0.7 });
    w.sfx('laser', { vol: 0.18, pitch: 1.6 });
  },
  draw(w, p, r, st) {
    const a = p.aim;
    // sighting line: dotted, brightening as the next shot gets ready
    const ready = st.cooldown <= 0;
    const h = handPos(p, a, 9);
    const len = Math.min(rayLength(w, h.x, h.y, a, p.stats.range * 0.75), 220);
    const steps = Math.floor(len / 6);
    const k = ready ? 1 : Math.max(0, 1 - st.cooldown / Math.max(0.01, attackInterval(p)));
    const col = ready ? '#fff0a0' : '#8a9ad8';
    for (let i = 2; i < steps; i++) {
      if ((i + Math.floor(w.time * 12)) % 3 === 0) continue;
      const d = i * 6;
      r.rect(Math.round(h.x + Math.cos(a) * d), Math.round(h.y + Math.sin(a) * d), 1, 1, col, (0.15 + 0.45 * k) * (1 - i / Math.max(1, steps) * 0.6));
    }
    // the bow string snaps forward after a shot
    drawHeld(r, p, 'w_star_piercer', a, 5 - st.anim * 2.5, { flash: st.anim > 0.75 ? 0.4 : 0 });
    if (ready) r.sprite(glowSprite(7 + Math.sin(w.time * 8), '#fff0a0'), h.x, h.y - 1, { alpha: 0.35, additive: true });
  },
});
