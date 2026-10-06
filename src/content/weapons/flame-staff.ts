import { visualHandPos } from '../../game/weapon-pose';
// 잿불 지팡이 (cinder staff): hold to pour a short cone of flame. Each puff is
// weak and short-ranged but passes through enemies and often sets them alight.

import { defineWeapon } from '../../game/defs';
import type { ProjBehavior } from '../../game/projectile';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { O, drawHeld, glowSprite, handPos } from './common';

defineDrawnSprite('w_flame_staff', 22, 7, (p) => {
  p.rect(0, 3, 16, 1, '#6a4026');
  p.rect(0, 2, 16, 1, '#9a6a40');
  p.px(5, 2, '#d8a050');
  p.px(10, 2, '#d8a050');
  // claw head holding the cinder
  p.rect(16, 1, 1, 5, '#4a3a3a');
  p.px(17, 0, '#4a3a3a'); p.px(18, 0, '#4a3a3a');
  p.px(17, 6, '#4a3a3a'); p.px(18, 6, '#4a3a3a');
  p.circle(19.5, 3.5, 2.3, '#ff7a20');
  p.circle(19.5, 3.5, 1.3, '#ffe080');
  p.px(19, 3, '#ffffff');
}, { outline: O, origin: [6, 3] });

defineDrawnSprite('icon_flame_staff', 16, 16, (p) => {
  p.line(1, 15, 10, 6, '#6a4026');
  p.line(2, 15, 11, 6, '#9a6a40');
  p.circle(12, 4, 3.5, '#ff7a20');
  p.circle(12, 4, 2, '#ffe080');
  p.px(12, 3, '#ffffff');
  p.px(14, 0, '#ffb040');
  p.px(9, 1, '#ff7a20');
  p.px(15, 6, '#c04010');
}, { outline: O });

const FLAME_COLS = ['#fff4b0', '#ffd050', '#ff9a28', '#f06018', '#b83010', '#4a2420'];

/** Flame puff visuals: grows and cools down as it travels. */
const flameDraw: ProjBehavior = {
  id: 'flame_puff',
  draw(pr, r) {
    const k = Math.min(1, pr.traveled / Math.max(1, pr.range));
    const ci = Math.min(FLAME_COLS.length - 1, Math.floor(k * FLAME_COLS.length));
    const size = 4 + k * 9 + pr.r;
    const flick = 1 + 0.15 * Math.sin(pr.age * 50 + pr.id);
    r.sprite(glowSprite(size * 1.5 * flick, FLAME_COLS[Math.min(ci + 1, FLAME_COLS.length - 1)]), pr.x, pr.y - pr.z, { alpha: 0.3 * (1 - k * 0.6), additive: true });
    r.sprite(glowSprite(size * flick, FLAME_COLS[ci]), pr.x, pr.y - pr.z, { alpha: 0.85 - k * 0.45 });
  },
  onHit(_pr, _w, target) {
    // many tiny hits: keep the white hit-flash to a flicker
    target.flash = Math.min(target.flash, 0.03);
  },
  update(pr, w) {
    if (fx.chance(0.15)) w.particles.spawn({ x: pr.x, y: pr.y - pr.z, vy: -25, life: 0.35, colors: ['#ffb040', '#a03010', '#40303080'], size: 1, additive: true });
  },
};

defineWeapon({
  id: 'flame_staff',
  name: '잿불 지팡이',
  desc: '누르고 있으면 짧은 불길을 내뿜는다. 불길은 적을 꿰뚫고 자주 불붙인다.',
  icon: 'icon_flame_staff',
  heldSprite: 'w_flame_staff',
  kind: 'ranged',
  rarity: 'rare',
  tags: ['arcane'],
  pools: ['treasure', 'boss', 'shop'],
  stats(m) {
    m.mulStat('damage', 0.7);
  },
  update(w, p, st, dt, firing, aim) {
    if (!firing) {
      st.mem.atk = 0;
      return;
    }
    const s = p.weaponStats;
    st.mem.atk = (st.mem.atk ?? 0) - dt;
    if (st.mem.atk <= 0) {
      st.mem.atk += 1 / Math.max(0.3, s.fireRate);
      w.items.onAttack(aim);
      st.sinceAttack = 0;
      w.sfx('fire', { vol: 0.35, pitch: 0.9 + fx.range(-0.1, 0.1) });
    }
    st.mem.puff = (st.mem.puff ?? 0) - dt;
    let n = 0;
    while (st.mem.puff <= 0 && n++ < 3) {
      st.mem.puff += 1 / (12 * (s.fireRate / 2.6));
      const a = aim + (w.rng.next() - 0.5) * 0.4;
      const h = handPos(p, aim, 17);
      p.fireProjectiles(w, a, {
        style: 'none', speed: 150 + w.rng.next() * 50, accel: -240, minSpeed: 35, range: 64 + s.range * 0.12,
        damageMult: 0.28, pierce: s.pierce + 2, radius: s.projSize + 1.5, knockback: 12, light: 16, color: '#ff9a30',
        statuses: [{ kind: 'burn', duration: 2, power: s.damage * 0.35, chance: 0.3 }],
        behaviors: [flameDraw], spreadMult: 0.6, x: h.x, y: h.y,
      });
    }
    p.recoil = 0.6;
    w.renderer.kick(fx.range(-0.25, 0.25), fx.range(-0.25, 0.25));
  },
  draw(w, p, r) {
    const firing = w.time - p.lastAttackAt < 0.08;
    const h = visualHandPos(p, p.aim, 17 - p.recoil);
    drawHeld(r, p, 'w_flame_staff', p.aim, 6 - p.recoil);
    const fl = 1 + 0.2 * Math.sin(w.time * 31) + (firing ? 0.5 : 0);
    r.sprite(glowSprite(9 * fl, '#ff9a30'), h.x, h.y, { alpha: 0.5, additive: true });
  },
});
