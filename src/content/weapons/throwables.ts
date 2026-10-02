// Thrown weapons:
//  비수 묶음     (throwing_knives, common) — quick alternating knife throws;
//                                          knives stick in walls for a moment
//  바람개비 부메랑 (pinwheel_boomerang, common) — curls around in a loop and comes
//                                          back; two can be in the air
//  튕김 차크람   (ricochet_chakram, rare)  — a ring blade that leaps from enemy to
//                                          enemy and rebounds off walls

import { defineWeapon } from '../../game/defs';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { Entity } from '../../game/entity';
import type { ProjBehavior } from '../../game/projectile';
import { defineDrawnSprite } from '../../engine/sprites';
import { angleTo, dist, rotateToward } from '../../engine/math';
import { fx } from '../../engine/rng';
import { O, attackInterval, drawHeld, handPos, kick } from './common';
import { beginAttack, shotFade } from './kit';

// ================================================================== 비수 묶음
defineDrawnSprite('w_throw_knife', 10, 4, (p) => {
  p.rect(0, 1, 3, 2, '#a02828');
  p.px(1, 1, '#e04848');
  p.rect(3, 0, 1, 4, '#c8a040');
  p.poly([4, 0.5, 10, 2, 4, 3.5], '#d8e0f0');
  p.line(4, 1, 9, 2, '#ffffff');
}, { outline: O, origin: [2, 2] });

defineDrawnSprite('icon_throwing_knives', 16, 16, (p) => {
  const knife = (ox: number, oy: number) => {
    p.line(ox, oy + 9, ox + 2, oy + 7, '#a02828');
    p.line(ox + 2, oy + 6, ox + 4, oy + 8, '#c8a040');
    p.poly([ox + 3, oy + 6, ox + 9, oy, ox + 4, oy + 7], '#d8e0f0');
    p.line(ox + 4, oy + 6, ox + 8, oy + 1, '#ffffff');
  };
  knife(1, 6);
  knife(4, 3);
  knife(7, 0);
}, { outline: O });

/** A knife stuck in a wall: quivers, then fades (visual only). */
class StuckKnife extends Entity {
  angle: number;
  constructor(x: number, y: number, angle: number) {
    super();
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.layer = 1;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.age > 0.9) this.dead = true;
  }

  override draw(r: Renderer): void {
    const wob = Math.sin(this.age * 60) * Math.max(0, 0.25 - this.age) * 1.2;
    r.sprite('w_throw_knife', this.x, this.y, { rot: this.angle + wob, alpha: Math.min(1, (0.9 - this.age) * 4) });
  }
}

const knifeFx: ProjBehavior = {
  id: 'knife',
  onWall(pr, w) {
    w.spawn(new StuckKnife(pr.x - Math.cos(pr.angle) * 3, pr.y - pr.z - Math.sin(pr.angle) * 3, pr.angle));
    w.sfx('hit_metal', { vol: 0.25, pitch: 1.7 + fx.range(-0.1, 0.1), x: pr.x });
    return false;
  },
  draw(pr, r) {
    r.sprite('w_throw_knife', pr.x, pr.y - pr.z, { rot: pr.angle });
  },
};

defineWeapon({
  id: 'throwing_knives',
  name: '비수 묶음',
  desc: '양손으로 번갈아 비수를 던진다. 빠르고, 비수는 적 하나를 꿰뚫는다.',
  icon: 'icon_throwing_knives',
  heldSprite: 'w_throw_knife',
  kind: 'ranged',
  archetype: '투척',
  rarity: 'common',
  pools: ['treasure', 'shop'],
  stats(m) {
    m.mulStat('damage', 0.5);
    m.mulStat('fireRate', 1.6);
    m.mulStat('shotSpeed', 1.35);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    st.combo = (st.combo + 1) % 2;
    st.comboTimer = 1;
    const side = st.combo === 0 ? 1 : -1;
    const h = handPos(p, aim + side * 0.5, 7);
    p.fireProjectiles(w, aim + side * 0.03, {
      style: 'none', color: '#d8e0f0', light: 8, x: h.x, y: h.y, behaviors: [knifeFx], pierce: p.stats.pierce + 1,
      statuses: [{ kind: 'bleed', duration: 3, power: p.stats.damage * 0.3, chance: 0.15 }],
    });
    kick(w, aim, 0.5);
    w.sfx('whoosh', { vol: 0.35, pitch: 1.8 + w.rng.next() * 0.2 });
  },
  draw(w, p, r, st) {
    // the throwing hand snaps forward; the next knife is already in the other hand
    const f = shotFade(st, w, 0.12);
    const side = st.combo === 0 ? 1 : -1;
    drawHeld(r, p, 'w_throw_knife', p.aim - side * 0.6, 5 + f * 3, { alpha: f > 0.5 ? 0 : 1 });
    if (f > 0) drawHeld(r, p, 'w_throw_knife', p.aim + side * 0.4, 6 + f * 4, { alpha: f });
  },
});

// ================================================================== 바람개비 부메랑
defineDrawnSprite('w_pinwheel', 13, 13, (p) => {
  p.poly([6.5, 6.5, 6.5, 0, 9.5, 1, 7.5, 6.5], '#e0a040');
  p.poly([6.5, 6.5, 13, 6.5, 12, 9.5, 6.5, 7.5], '#d07030');
  p.poly([6.5, 6.5, 6.5, 13, 3.5, 12, 5.5, 6.5], '#e0a040');
  p.poly([6.5, 6.5, 0, 6.5, 1, 3.5, 6.5, 5.5], '#d07030');
  p.px(7, 1, '#fff0b0');
  p.px(12, 7, '#ffd090');
  p.px(6, 12, '#fff0b0');
  p.px(1, 6, '#ffd090');
  p.circle(6.5, 6.5, 1.4, '#7a4020');
}, { outline: O });

defineDrawnSprite('icon_pinwheel_boomerang', 16, 16, (p) => {
  p.poly([8, 8, 8, 0, 12, 1.5, 9.5, 8], '#e0a040');
  p.poly([8, 8, 16, 8, 14.5, 12, 8, 9.5], '#d07030');
  p.poly([8, 8, 8, 16, 4, 14.5, 6.5, 8], '#e0a040');
  p.poly([8, 8, 0, 8, 1.5, 4, 8, 6.5], '#d07030');
  p.px(9, 1, '#fff0b0');
  p.px(14, 9, '#ffd090');
  p.circle(8, 8, 1.5, '#7a4020');
}, { outline: O });

/** Loop radius (px) of a pinwheel throw at a given speed (exported for tests). */
export function pinwheelLoopRadius(speed: number): number {
  return speed / 4.4;
}

function pinwheelBehavior(dir: number): ProjBehavior {
  return {
    id: 'pinwheel',
    update(pr, w, dt) {
      pr.mem.spin = (pr.mem.spin ?? 0) + dt * 24;
      const pl = w.player;
      if (pr.age < 0.75) {
        pr.curve = dir * 4.4;
      } else {
        // homeward: steer back to the hand
        pr.curve = 0;
        pr.angle = rotateToward(pr.angle, angleTo(pr.x, pr.y, pl.x, pl.y - 5), 9 * dt);
        pr.speed = Math.min(380, pr.speed + 300 * dt);
        if (dist(pr.x, pr.y, pl.x, pl.y - 5) < 10) {
          pr.dead = true;
          w.sfx('parry', { vol: 0.2, pitch: 1.7 });
          return;
        }
      }
      // grazing re-hits while looping
      if (w.time > (pr.mem.reset ?? 0)) {
        pr.mem.reset = w.time + 0.35;
        pr.hitIds.clear();
      }
      if (Math.floor(pr.mem.spin / 4) !== Math.floor((pr.mem.spin - dt * 24) / 4)) w.sfx('whoosh', { vol: 0.08, pitch: 2 });
    },
    onWall(pr) {
      // knocked out of its loop: comes straight back
      pr.age = Math.max(pr.age, 0.75);
      pr.angle += Math.PI;
      return true;
    },
    draw(pr, r) {
      r.sprite('w_pinwheel', pr.x, pr.y - pr.z, { rot: pr.mem.spin ?? 0 });
    },
  };
}

defineWeapon({
  id: 'pinwheel_boomerang',
  name: '바람개비 부메랑',
  desc: '휘어져 날아가 크게 원을 그리고 손으로 돌아온다. 동시에 두 개까지 던질 수 있다.',
  icon: 'icon_pinwheel_boomerang',
  heldSprite: 'w_pinwheel',
  kind: 'ranged',
  archetype: '부메랑',
  rarity: 'common',
  pools: ['treasure', 'shop'],
  stats(m) {
    m.mulStat('damage', 0.66);
    m.mulStat('fireRate', 0.8);
  },
  update(w, p, st, _dt, firing, aim) {
    // count the pinwheels still in the air (lost ones come back after a room change)
    const live = (st.mem.live ?? 0) > 0 && st.mem.room === w.node.id && w.time - (st.mem.thrownAt ?? 0) < 3 ? st.mem.live : 0;
    st.mem.live = live;
    if (!firing || st.cooldown > 0 || live >= 2) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    st.combo = (st.combo + 1) % 2;
    st.comboTimer = 2;
    const dir = st.combo === 0 ? 1 : -1;
    const h = handPos(p, aim, 8);
    const shots = p.fireProjectiles(w, aim - dir * 0.7, {
      style: 'none', speed: 210, range: 99999, life: 2.6, pierce: 999, radius: p.stats.projSize + 3, color: '#e0a040', light: 12,
      knockback: p.stats.knockback * 0.7, x: h.x, y: h.y, behaviors: [pinwheelBehavior(dir)],
    });
    st.mem.live = live + shots.length;
    st.mem.thrownAt = w.time;
    st.mem.room = w.node.id;
    // decrement when it comes back / expires
    for (const pr of shots) {
      pr.addBehavior({
        id: 'pinwheel_count',
        onExpire: () => { st.mem.live = Math.max(0, (st.mem.live ?? 1) - 1); },
        update: (q) => { if (q.dead) st.mem.live = Math.max(0, (st.mem.live ?? 1) - 1); },
      });
    }
    kick(w, aim, 0.6);
    w.sfx('whoosh', { vol: 0.45, pitch: 1.1 });
  },
  draw(w, p, r, st) {
    if ((st.mem.live ?? 0) >= 2) return;
    const h = handPos(p, p.aim, 7);
    r.sprite('w_pinwheel', h.x, h.y, { rot: w.time * 1.5, sx: 0.85, sy: 0.85 });
  },
});

// ================================================================== 튕김 차크람
defineDrawnSprite('w_chakram', 13, 13, (p) => {
  p.ring(6.5, 6.5, 6.3, 2.4, '#e0c060');
  p.ring(6.5, 6.5, 6.3, 0.9, '#fff0a0');
  p.ring(6.5, 6.5, 3.8, 0.8, '#8a6a20');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    p.px(Math.round(6.5 + Math.cos(a) * 6.2 - 0.5), Math.round(6.5 + Math.sin(a) * 6.2 - 0.5), '#ffffff');
  }
}, { outline: O });

defineDrawnSprite('icon_ricochet_chakram', 16, 16, (p) => {
  p.ring(8, 8, 7.4, 2.6, '#e0c060');
  p.ring(8, 8, 7.4, 1, '#fff0a0');
  p.ring(8, 8, 4.6, 0.9, '#8a6a20');
  p.line(0, 3, 3, 0, '#fff0a0');
  p.line(13, 16, 16, 13, '#fff0a0');
}, { outline: O });

const chakramFx: ProjBehavior = {
  id: 'chakram',
  update(pr, w, dt) {
    pr.mem.spin = (pr.mem.spin ?? 0) + dt * 30;
    if (fx.chance(0.4)) w.particles.spawn({ x: pr.x + fx.range(-3, 3), y: pr.y - pr.z + fx.range(-3, 3), life: 0.2, colors: ['#fff0a0', '#e0c060'], size: 1, shape: 'pixel' });
  },
  onHit(pr, w, target) {
    // leap to the next enemy nearby
    const left = pr.mem.leaps ?? 0;
    if (left <= 0) return;
    let best = null;
    let bd = 110;
    for (const e of w.enemies) {
      if (!e.alive || e.hidden || e === target || pr.hitIds.has(e.id)) continue;
      const d = dist(pr.x, pr.y, e.x, e.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (!best) return;
    pr.mem.leaps = left - 1;
    pr.angle = angleTo(pr.x, pr.y, best.x, best.y - best.z * 0.3);
    pr.speed = Math.max(pr.speed, 280);
    pr.traveled = Math.max(0, pr.traveled - 60);
    w.sfx('hit_metal', { vol: 0.25, pitch: 1.8 + (3 - left) * 0.1, x: pr.x });
  },
  onWall(pr, w) {
    // rebounding off a wall lets it strike the same foes again
    pr.hitIds.clear();
    w.particles.burst(pr.x, pr.y - pr.z, { count: 4, speed: [30, 80], life: [0.1, 0.2], colors: ['#ffffff', '#fff0a0'], size: [1, 1], shape: 'spark' });
    w.sfx('hit_metal', { vol: 0.2, pitch: 2, x: pr.x });
    return false;
  },
  draw(pr, r) {
    r.sprite('w_chakram', pr.x, pr.y - pr.z, { rot: pr.mem.spin ?? 0 });
  },
};

defineWeapon({
  id: 'ricochet_chakram',
  name: '튕김 차크람',
  desc: '고리 칼날을 던진다. 적을 맞히면 근처의 다른 적에게 튕겨 가고, 벽에 맞으면 되튄다.',
  icon: 'icon_ricochet_chakram',
  heldSprite: 'w_chakram',
  kind: 'ranged',
  archetype: '도탄',
  rarity: 'rare',
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('damage', 0.75);
    m.mulStat('fireRate', 0.71);
    m.addStat('bounce', 2);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.stats;
    const h = handPos(p, aim, 8);
    const shots = p.fireProjectiles(w, aim, {
      style: 'none', speed: s.shotSpeed * 1.2, radius: s.projSize + 2.5, pierce: s.pierce + 3, color: '#e0c060', light: 14,
      x: h.x, y: h.y, behaviors: [chakramFx], range: s.range * 1.3,
    });
    for (const pr of shots) pr.mem.leaps = 3 + Math.floor(s.pierce / 2);
    kick(w, aim, 0.8);
    w.sfx('whoosh', { vol: 0.45, pitch: 1.5 });
    w.sfx('swing', { vol: 0.2, pitch: 1.9 });
  },
  draw(w, p, r, st) {
    const f = shotFade(st, w, 0.2);
    if (f > 0.4) return; // just thrown: the hand is empty for a beat
    const h = handPos(p, p.aim, 7);
    r.sprite('w_chakram', h.x, h.y, { rot: w.time * 3, sx: 0.85, sy: 0.85 });
  },
});
