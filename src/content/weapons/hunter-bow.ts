import { visualHandPos } from '../../game/weapon-pose';
// 사냥꾼의 장궁 (hunter's longbow): Serin's starting weapon. Hold to draw the
// string (glow + rising pitch), release to loose an arrow. A partial draw is a
// weak, slow arrow; a full draw flashes white and fires a fast lantern-lit
// arrow that pierces several enemies.

import { defineWeapon, type WeaponState } from '../../game/defs';
import type { ProjBehavior } from '../../game/projectile';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import { defineDrawnSprite } from '../../engine/sprites';
import { RingFx } from '../../game/effects';
import { O, attackInterval, chargeTime, glowSprite, handPos, kick, muzzle, pixLine } from './common';

// bow seen from above, pointing right; pivot at the grip
defineDrawnSprite('w_hunter_bow', 7, 19, (p) => {
  for (let y = 0; y < 19; y++) {
    const k = (y - 9) / 9;
    const x = Math.round(1 + 4.2 * (1 - k * k));
    const tip = y < 2 || y > 16;
    p.px(x, y, tip ? '#d8a868' : '#8a5530');
    if (!tip && y > 3 && y < 15) p.px(x - 1, y, '#5a3418');
  }
  p.rect(4, 7, 2, 5, '#3a2418');
  p.px(5, 8, '#e03c2c');
}, { outline: O, origin: [5, 9] });

defineDrawnSprite('icon_hunter_bow', 16, 16, (p) => {
  // thick recurve limb from bottom-left to top-right, bulging toward the top-left
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const bx = 2 + t * 11;
    const by = 14 - t * 11;
    const bulge = Math.sin(t * Math.PI) * 3.6;
    const x = bx - bulge * 0.7;
    const y = by - bulge * 0.7;
    const tip = t < 0.1 || t > 0.9;
    p.px(x, y, tip ? '#e8c080' : '#a06a38');
    p.px(x + 1, y, tip ? '#c08a50' : '#6a3c1c');
  }
  p.rect(4, 6, 2, 3, '#3a2418');
  p.px(4, 6, '#e03c2c');
  // string + nocked arrow
  p.line(3, 14, 14, 3, '#f0e8d8');
  p.line(6, 13, 13, 6, '#c8a070');
  p.poly([12, 7, 15, 4, 14, 8], '#e8f0ff');
  p.px(5, 14, '#e03c2c');
  p.px(6, 15, '#e03c2c');
}, { outline: O });

/** Fully drawn arrows hit hard: a beat of hit-stop, a kick and splinters on every enemy struck. */
const heavyArrow: ProjBehavior = {
  id: 'heavy_arrow',
  onHit(pr, w, target) {
    w.hitstop(0.035);
    w.renderer.kick(Math.cos(pr.angle) * 1.6, Math.sin(pr.angle) * 1.6);
    w.particles.burst(target.x, target.y - 4, { count: 8, speed: [60, 160], angle: pr.angle, spread: 0.6, life: [0.1, 0.25], colors: ['#ffffff', '#ffe08a', '#c8a070'], shape: 'spark', size: [1, 2] });
  },
};

/** Damage multiplier of an arrow drawn to `c` (0..1). Exported for tests. */
export function bowDamageMult(c: number): number {
  const k = Math.max(0.12, Math.min(1, c));
  return 0.45 + 1.95 * Math.pow(k, 1.25);
}

function loose(w: World, p: Player, st: WeaponState, aim: number): void {
  const s = p.weaponStats;
  const c = Math.max(0.12, st.charge);
  const full = st.charge >= 1;
  w.items.onAttack(aim);
  const h = handPos(p, aim, 6);
  p.fireProjectiles(w, aim, {
    style: 'sprite', sprite: full ? 'proj_arrow_glow' : 'proj_arrow',
    speed: s.shotSpeed * (1.05 + 1.1 * c), damageMult: bowDamageMult(c), range: s.range * (0.9 + 0.8 * c),
    radius: s.projSize * (full ? 1.15 : 0.85), pierce: s.pierce + (full ? 3 : c > 0.6 ? 1 : 0),
    knockback: s.knockback * (0.6 + c), light: full ? 30 : 10, color: full ? '#ffe08a' : '#e8d0a0',
    x: h.x + Math.cos(aim) * 4, y: h.y + Math.sin(aim) * 3, spreadMult: 0.6,
    behaviors: full ? [heavyArrow] : [],
  });
  st.cooldown = attackInterval(p, full ? 0.55 : 0.75);
  st.sinceAttack = 0;
  st.mem.firedAt = w.time;
  st.mem.firedPull = c;
  if (full) {
    muzzle(w, h.x + Math.cos(aim) * 6, h.y + Math.sin(aim) * 4, aim, ['#ffffff', '#ffe08a', '#ff9a30'], 9, [60, 180]);
    kick(w, aim + Math.PI, 2.2);
    w.shake(0.1);
    w.sfx('shoot_arrow', { vol: 0.9, pitch: 0.9 });
    w.sfx('whoosh', { vol: 0.35, pitch: 1.3 });
  } else {
    kick(w, aim + Math.PI, 0.6 + c);
    w.sfx('shoot_arrow', { vol: 0.45 + c * 0.3, pitch: 1.25 - c * 0.3 });
  }
  st.charge = 0;
}

defineWeapon({
  id: 'hunter_bow',
  name: '사냥꾼의 장궁',
  desc: '누르고 있으면 시위를 당긴다. 끝까지 당기면 빛나는 화살이 적을 여럿 꿰뚫는다.',
  icon: 'icon_hunter_bow',
  heldSprite: 'w_hunter_bow',
  kind: 'charge',
  rarity: 'common',
  tags: ['bow'],
  pools: ['treasure', 'shop'],
  stats(m) {
    m.mulStat('damage', 1.13);
  },
  update(w, p, st, dt, firing, aim) {
    if (firing && st.cooldown <= 0) {
      if (!st.mem.drawing) {
        st.mem.drawing = 1;
        st.charge = 0;
        w.sfx('charge', { vol: 0.35, pitch: 1.1 });
      }
      const before = st.charge;
      st.charge = Math.min(1, st.charge + dt / chargeTime(p, 0.72));
      if (before < 1 && st.charge >= 1) {
        st.mem.readyAt = w.time;
        w.sfx('charge_ready', { vol: 0.7 });
        w.spawn(new RingFx(p.x, p.y - 6, 16, 0.25, '#fff0b0', 2));
        w.particles.burst(p.x + Math.cos(aim) * 10, p.y - 6 + Math.sin(aim) * 8, { count: 8, speed: [30, 90], life: [0.15, 0.3], colors: ['#ffffff', '#ffe08a'], shape: 'spark', size: [1, 2] });
      }
      // tiny embers gathering at the arrow head while drawing
      if (st.charge > 0.25 && w.rng.next() < dt * 25) {
        const h = handPos(p, aim, 12);
        w.particles.spawn({ x: h.x + (w.rng.next() - 0.5) * 8, y: h.y + (w.rng.next() - 0.5) * 8, vx: -Math.cos(aim) * 20, vy: -Math.sin(aim) * 20, life: 0.25, colors: ['#ffe08a', '#ff9a30'], size: 1, additive: true });
      }
    } else if (st.mem.drawing) {
      st.mem.drawing = 0;
      loose(w, p, st, aim);
    }
  },
  draw(w, p, r, st) {
    const aim = p.aim;
    const pull = st.mem.drawing ? st.charge : 0;
    const since = w.time - (st.mem.firedAt ?? -9);
    const snap = since < 0.12 ? 1 - since / 0.12 : 0; // string vibrates after a shot
    const h = visualHandPos(p, aim, 6 - pull * 1.5 + snap * 1.2);
    const c = Math.cos(aim);
    const s = Math.sin(aim);
    r.sprite('w_hunter_bow', h.x, h.y, { rot: aim, flash: st.mem.drawing && st.charge >= 1 ? 0.25 + 0.25 * Math.sin(w.time * 30) : 0 });
    // string: tips (local (-4, ±9)) to nock point (local (-4 - pull * 6, 0))
    const lx = (x: number, y: number) => h.x + x * c - y * s;
    const ly = (x: number, y: number) => h.y + x * s + y * c;
    const nock = -4 - pull * 6 + (snap > 0 ? Math.sin(since * 120) * snap : 0);
    const col = pull >= 1 ? '#fff6d0' : '#e8e0d0';
    pixLine(r, lx(-4, -9), ly(-4, -9), lx(nock, 0), ly(nock, 0), col);
    pixLine(r, lx(-4, 9), ly(-4, 9), lx(nock, 0), ly(nock, 0), col);
    if (st.mem.drawing) {
      const full = st.charge >= 1;
      const ax = lx(nock + 8, 0);
      const ay = ly(nock + 8, 0);
      r.sprite(full ? 'proj_arrow_glow' : 'proj_arrow', ax, ay, { rot: aim });
      // charge glow at the arrow head
      const g = Math.max(0, st.charge - 0.15);
      if (g > 0) {
        const tx = lx(nock + 15, 0);
        const ty = ly(nock + 15, 0);
        const pulse = full ? 1 + 0.25 * Math.sin(w.time * 25) : 1;
        r.sprite(glowSprite(5 + g * 12 * pulse, full ? '#fff0b0' : '#ffb040'), tx, ty, { alpha: 0.45 + g * 0.45, additive: true });
      }
    }
  },
});
