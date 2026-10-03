// 공허의 눈 (void gaze): Niel's starting weapon. A floating eye orb channels a
// piercing beam while the attack is held. The beam turns toward the aim with a
// little drag, stops at walls (rocks too, unless shots are spectral), and
// focuses over ~1.2s of continuous channeling (wider, stronger).

import { defineWeapon } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { clamp, rotateToward } from '../../engine/math';
import { fx } from '../../engine/rng';
import { TILE } from '../../game/constants';
import { tileProps } from '../../game/tiles';
import { O, glowSprite, handPos, rayLength, segDist } from './common';

defineDrawnSprite('w_void_eye', 9, 9, (p) => {
  p.circle(4.5, 4.5, 4.2, '#2a1c48');
  p.circle(4.5, 4.5, 3.2, '#4a3480');
  p.circle(5, 4.5, 2.2, '#b070ff');
  p.circle(5.2, 4.5, 1.2, '#1a0e2a');
  p.px(4, 3, '#ffffff');
  p.px(2, 2, '#7c6ac4');
}, { outline: O });

defineDrawnSprite('icon_void_gaze', 16, 16, (p) => {
  p.circle(8, 8, 6.5, '#2a1c48');
  p.circle(8, 8, 5, '#4a3480');
  p.ellipse(8, 8, 4.5, 3, '#ead0ff');
  p.circle(8, 8, 2.6, '#b070ff');
  p.circle(8, 8, 1.3, '#1a0e2a');
  p.px(7, 6, '#ffffff');
  p.line(1, 15, 4, 12, '#9a50ff');
  p.line(12, 4, 15, 1, '#9a50ff');
}, { outline: O });

/** Beam damage per tick as a fraction of player damage, by focus 0..1. Exported for tests. */
export function beamTickMult(focus: number): number {
  return 0.42 + 0.25 * clamp(focus, 0, 1);
}

defineWeapon({
  id: 'void_gaze',
  name: '공허의 눈',
  desc: '누르고 있으면 적을 관통하는 광선을 쏜다. 벽에 막히며, 1.2초간 유지하면 굵기와 피해가 최대가 된다.',
  icon: 'icon_void_gaze',
  heldSprite: 'w_void_eye',
  kind: 'beam',
  rarity: 'epic',
  tags: ['arcane'],
  pools: ['secret', 'boss'],
  stats(m) {
    m.mulStat('damage', 0.76);
  },
  update(w, p, st, dt, firing, aim) {
    const m = st.mem;
    if (m.fade && m.fade > 0) m.fade -= dt;
    if (!firing) {
      if (m.on) {
        m.on = 0;
        m.fade = 0.14;
      }
      return;
    }
    const s = p.stats;
    if (!m.on) {
      m.on = 1;
      m.beamA = aim;
      m.chan = 0;
      m.tick = 0.06; // short warm-up
      m.atk = 0;
      m.hum = 0;
      w.sfx('beam_charge', { vol: 0.45, pitch: 1.3 });
    }
    m.beamA = rotateToward(m.beamA, aim, 9 * dt);
    m.chan += dt;
    const focus = clamp(m.chan / 1.2, 0, 1);
    const a = m.beamA;
    const o = handPos(p, a, 9);
    const len = rayLength(w, o.x, o.y, a, s.range * 1.15, p.flags.has('spectral'));
    m.len = len;
    const ex = o.x + Math.cos(a) * len;
    const ey = o.y + Math.sin(a) * len;
    // one "attack" per fire-rate interval (item onAttack hooks)
    m.atk -= dt;
    if (m.atk <= 0) {
      m.atk += 1 / Math.max(0.3, s.fireRate);
      w.items.onAttack(a);
      st.sinceAttack = 0;
      p.lastAttackAt = w.time;
    }
    m.hum -= dt;
    if (m.hum <= 0) {
      m.hum = 0.22;
      w.sfx('laser', { vol: 0.18 + focus * 0.12, pitch: 0.7 + focus * 0.3 + fx.range(-0.04, 0.04) });
    }
    // light & sparks along the beam
    if (fx.chance(0.7)) {
      const k = fx.next();
      w.particles.spawn({
        x: o.x + (ex - o.x) * k, y: o.y + (ey - o.y) * k, vx: fx.range(-20, 20), vy: fx.range(-30, -5), life: 0.25,
        colors: ['#ffffff', '#c890ff', '#7a40ff'], size: 1, additive: true, light: 20, lightColor: '#b070ff',
      });
    }
    w.particles.spawn({ x: ex, y: ey, vx: fx.range(-40, 40), vy: fx.range(-40, 40), life: 0.18, colors: ['#ffffff', '#c890ff'], size: 1.5, sizeEnd: 0.5, additive: true, light: 26, lightColor: '#b070ff' });
    // damage ticks
    m.tick -= dt;
    if (m.tick > 0) return;
    m.tick += 1 / (Math.max(0.3, s.fireRate) * 2.2);
    const width = 4 + 3 * focus + s.projSize * 0.6;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    for (const e of [...w.enemies]) {
      if (!e.alive || e.hidden || e.z > 28) continue;
      const sd = segDist(e.x, e.y - e.z * 0.3, o.x, o.y, ex, ey);
      if (sd.d > e.r + width / 2) continue;
      if (w.applyHit(e, { damage: s.damage * beamTickMult(focus), kind: 'laser', attacker: p, dirX: c, dirY: sn, knockback: 18 + focus * 14, light: true })) {
        e.flash = Math.min(e.flash, 0.035); // flicker instead of a solid white silhouette
      }
    }
    for (const h of [...w.hittables]) {
      if (segDist(h.x, h.y, o.x, o.y, ex, ey).d < h.r + width / 2) h.takeHit(w, { damage: s.damage * 0.5, kind: 'laser', attacker: p });
    }
    // chip away at pots / breakables where the beam ends
    const tx = Math.floor((ex + c * 4) / TILE);
    const ty = Math.floor((ey + sn * 4) / TILE);
    if (tileProps(w.room.tileAt(tx, ty)).breakable) w.room.damageTile(w, tx, ty, s.damage * 0.5);
    w.renderer.kick(fx.range(-0.35, 0.35), fx.range(-0.35, 0.35));
  },
  draw(w, p, r, st) {
    const m = st.mem;
    const on = !!m.on;
    const fade = on ? 1 : Math.max(0, (m.fade ?? 0) / 0.14);
    const a = on || fade > 0 ? m.beamA ?? p.aim : p.aim;
    // the eye orbits gently when idle
    const bob = Math.sin(p.age * 3.1) * 1.5;
    const o = handPos(p, a, 9);
    if (fade > 0 && m.len) {
      const focus = clamp((m.chan ?? 0) / 1.2, 0, 1);
      const len = m.len;
      const ex = o.x + Math.cos(a) * len;
      const ey = o.y + Math.sin(a) * len;
      const wob = 1 + 0.18 * Math.sin(w.time * 40) + 0.1 * Math.sin(w.time * 67);
      const wd = (4 + 3 * focus + p.stats.projSize * 0.6) * wob * fade;
      r.line(o.x, o.y, ex, ey, '#5a20c0', wd + 3, 0.35);
      r.line(o.x, o.y, ex, ey, '#a060ff', wd, 0.9);
      r.line(o.x, o.y, ex, ey, '#e8d0ff', Math.max(1, wd * 0.45), 1);
      r.line(o.x, o.y, ex, ey, '#ffffff', Math.max(1, wd * 0.2), 1);
      r.sprite(glowSprite(8 + wd * 2, '#c890ff'), ex, ey, { alpha: 0.8 * fade, additive: true });
      r.sprite(glowSprite(6 + wd * 1.4, '#e8d0ff'), o.x, o.y, { alpha: 0.8 * fade, additive: true });
    }
    r.sprite('w_void_eye', o.x, o.y + (on ? 0 : bob), { rot: on ? a * 0.15 : 0, flash: on ? 0.25 + 0.2 * Math.sin(w.time * 30) : 0 });
  },
});
