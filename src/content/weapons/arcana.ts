// Arcane and legendary armaments:
//  반딧불 마도서 (firefly_tome, epic)      — summons firefly spirits that hover, then
//                                           dart at the nearest enemy
//  방패포        (aegis_cannon, rare)      — shield-gun: holding fire raises a shield
//                                           that eats bullets in front; heavy slugs
//  새벽의 등불   (dawn_lantern, legendary) — radiant triple bolts; every fourth
//                                           attack releases a rising sun that sears
//                                           around it and bursts into rays
//  유성우 지팡이 (meteor_staff, legendary) — calls meteors down on the aimed spot
//                                           after a short (visible) delay

import { defineWeapon } from '../../game/defs';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { Entity } from '../../game/entity';
import type { ProjBehavior } from '../../game/projectile';
import { defineDrawnSprite } from '../../engine/sprites';
import { angleDiff, angleTo, clamp, dist, rotateToward } from '../../engine/math';
import { fx } from '../../engine/rng';
import { TILE } from '../../game/constants';
import { tileProps } from '../../game/tiles';
import { O, attackInterval, drawHeld, glowSprite, handPos, kick, muzzle } from './common';
import { aimDistance, beginAttack, blast, drawGun, fragment, shotFade } from './kit';

// ================================================================== 반딧불 마도서
defineDrawnSprite('w_firefly_tome', 12, 11, (p) => {
  p.rect(0, 1, 12, 9, '#3a5a2a');
  p.rect(1, 2, 10, 7, '#f0e8c8');
  p.rect(6, 1, 1, 9, '#2a3a1a');
  p.line(2, 4, 5, 4, '#a09878');
  p.line(2, 6, 5, 6, '#a09878');
  p.line(7, 4, 10, 4, '#a09878');
  p.line(7, 6, 9, 6, '#a09878');
  p.rect(0, 0, 12, 1, '#c8a040');
  p.rect(0, 10, 12, 1, '#c8a040');
  p.px(9, 7, '#d0ff60');
}, { outline: O, origin: [2, 6] });

defineDrawnSprite('w_firefly_tome_b', 12, 11, (p) => {
  p.rect(0, 1, 12, 9, '#3a5a2a');
  p.rect(1, 2, 10, 7, '#f0e8c8');
  p.rect(6, 1, 1, 9, '#2a3a1a');
  p.poly([6, 2, 10, 0, 10, 7, 6, 9], '#fff8e0');
  p.line(2, 4, 5, 4, '#a09878');
  p.line(2, 6, 5, 6, '#a09878');
  p.rect(0, 0, 6, 1, '#c8a040');
  p.rect(0, 10, 12, 1, '#c8a040');
  p.px(8, 4, '#d0ff60');
}, { outline: O, origin: [2, 6] });

defineDrawnSprite('icon_firefly_tome', 16, 16, (p) => {
  p.poly([1, 6, 8, 9, 15, 6, 15, 14, 8, 16, 1, 14], '#3a5a2a');
  p.poly([2, 6.5, 8, 9, 8, 15, 2, 13], '#f0e8c8');
  p.poly([8, 9, 14, 6.5, 14, 13, 8, 15], '#e0d8b0');
  p.line(8, 9, 8, 15, '#2a3a1a');
  p.circle(5, 3, 1.6, '#d0ff60');
  p.circle(11, 2, 1.3, '#d0ff60');
  p.px(14, 4, '#f0ff90');
  p.px(5, 3, '#ffffff');
}, { outline: O });

const fireflyFx: ProjBehavior = {
  id: 'firefly',
  update(pr, w, dt) {
    const hover = pr.mem.hover ?? 0;
    if (pr.age < hover) {
      // gather: circle the spot it was released at
      const a = (pr.mem.phase ?? 0) + pr.age * 9;
      pr.angle = a + Math.PI / 2;
      pr.speed = 70;
      for (const e of w.enemies) pr.hitIds.add(e.id);
      return;
    }
    if (!pr.mem.go) {
      pr.mem.go = 1;
      pr.hitIds.clear();
      pr.traveled = 0;
      const t = w.nearestEnemy(pr.x, pr.y, 260);
      pr.angle = t ? angleTo(pr.x, pr.y, t.x, t.y - t.z * 0.3) : pr.mem.aim ?? pr.angle;
      pr.speed = 250;
      w.sfx('orb', { vol: 0.14, pitch: 2.1 + fx.range(-0.1, 0.1), x: pr.x });
    }
    const t = w.nearestEnemy(pr.x, pr.y, 200, pr.hitIds);
    if (t) pr.angle = rotateToward(pr.angle, angleTo(pr.x, pr.y, t.x, t.y - t.z * 0.3), 7 * dt);
    if (fx.chance(0.5)) w.particles.spawn({ x: pr.x, y: pr.y - pr.z, life: 0.3, colors: ['#f0ff90', '#a0d040'], size: 1, shape: 'pixel', additive: true });
  },
  draw(pr, r, w) {
    const on = 0.6 + 0.4 * Math.sin(w.time * 25 + pr.id * 3);
    r.sprite(glowSprite(9 + on * 3, '#d0ff60'), pr.x, pr.y - pr.z, { alpha: 0.55 * on, additive: true });
    r.rect(Math.round(pr.x) - 1, Math.round(pr.y - pr.z) - 1, 2, 2, '#ffffe0');
  },
};

defineWeapon({
  id: 'firefly_tome',
  name: '반딧불 마도서',
  desc: '책장을 넘길 때마다 반딧불 정령이 깨어난다. 정령은 잠시 맴돌다가 가장 가까운 적에게 날아든다.',
  icon: 'icon_firefly_tome',
  heldSprite: 'w_firefly_tome',
  kind: 'ranged',
  archetype: '소환',
  rarity: 'epic',
  pools: ['treasure', 'boss', 'secret'],
  stats(m) {
    m.mulStat('damage', 0.9);
    m.mulStat('fireRate', 0.9);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.stats;
    const n = 2 + Math.max(0, s.shots - 1);
    const h = handPos(p, aim, 9);
    for (let i = 0; i < n; i++) {
      const shots = p.fireProjectiles(w, aim + (i - (n - 1) / 2) * 0.6, {
        count: 1, style: 'none', speed: 70, range: s.range * 1.6, life: 3.5, radius: Math.max(2.5, s.projSize - 0.5), color: '#d0ff60',
        light: 18, x: h.x, y: h.y - 3, behaviors: [fireflyFx], knockback: s.knockback * 0.5,
      });
      for (const pr of shots) {
        pr.mem.hover = 0.32 + i * 0.07;
        pr.mem.phase = w.rng.next() * Math.PI * 2;
        pr.mem.aim = aim;
        pr.z = 8;
      }
    }
    st.mem.page = (st.mem.page ?? 0) + 1;
    w.particles.burst(h.x, h.y - 3, { count: 6, speed: [10, 40], life: [0.3, 0.5], colors: ['#f0ff90', '#d0ff60', '#ffffff'], size: [1, 1], additive: true });
    w.sfx('summon', { vol: 0.22, pitch: 1.8 });
    w.sfx('ui_move', { vol: 0.25, pitch: 1.3 });
  },
  draw(w, p, r, st) {
    const f = shotFade(st, w, 0.18);
    // pages flip on every cast
    const sprite = f > 0 && Math.floor(f * 6) % 2 === 0 ? 'w_firefly_tome_b' : 'w_firefly_tome';
    const h = handPos(p, p.aim, 7);
    r.sprite(sprite, h.x, h.y + Math.sin(w.time * 3) * 0.8, { flipX: Math.cos(p.aim) < 0 });
    r.sprite(glowSprite(10 + f * 8, '#d0ff60'), h.x, h.y - 2, { alpha: 0.2 + f * 0.4, additive: true });
  },
});

// ================================================================== 방패포
defineDrawnSprite('w_aegis_cannon', 18, 14, (p) => {
  // tower shield with a cannon barrel through it (pivot: grip behind)
  p.rect(0, 6, 5, 3, '#4a3a2a');
  p.rect(5, 5, 12, 4, '#6a6a7a');
  p.rect(5, 5, 12, 1, '#a0a0b0');
  p.rect(16, 4, 2, 6, '#3a3a4a');
  p.poly([8, 0, 12, 0, 13, 7, 12, 14, 8, 14, 7, 7], '#3a5aa0');
  p.poly([8.5, 1, 11.5, 1, 12, 7, 9, 7], '#6a8ad8');
  p.line(10, 2, 10, 12, '#c8a040');
  p.px(10, 7, '#fff0a0');
}, { outline: O, origin: [2, 7] });

defineDrawnSprite('icon_aegis_cannon', 16, 16, (p) => {
  p.poly([2, 2, 9, 1, 11, 7, 9, 15, 2, 14, 1, 8], '#3a5aa0');
  p.poly([3, 3, 8, 2, 9, 7, 3, 8], '#6a8ad8');
  p.line(5, 2, 5, 14, '#c8a040');
  p.rect(8, 6, 7, 4, '#6a6a7a');
  p.rect(8, 6, 7, 1, '#a0a0b0');
  p.rect(14, 5, 2, 6, '#3a3a4a');
  p.px(5, 8, '#fff0a0');
}, { outline: O });

defineDrawnSprite('proj_aegis_slug', 8, 8, (p) => {
  p.circle(4, 4, 3.8, '#c89040');
  p.circle(3.6, 3.6, 2.4, '#f0c060');
  p.px(2, 2, '#ffffff');
}, { outline: '#2a1808' });

/** Shield arc half-width (radians) in front of the player while raised (exported for tests). */
export const AEGIS_ARC = 0.95;

defineWeapon({
  id: 'aegis_cannon',
  name: '방패포',
  desc: '방패에 포신을 꿰어 만든 무기. 쏘는 동안 방패가 앞을 막아 탄환을 막아 내고, 묵직한 포탄을 날린다.',
  icon: 'icon_aegis_cannon',
  heldSprite: 'w_aegis_cannon',
  kind: 'ranged',
  archetype: '방패총',
  rarity: 'rare',
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('damage', 1.5);
    m.mulStat('fireRate', 0.7);
    m.addStat('knockback', 60);
  },
  update(w, p, st, dt, firing, aim) {
    st.mem.raise = clamp((st.mem.raise ?? 0) + (firing ? dt * 8 : -dt * 5), 0, 1);
    if (st.mem.raise > 0.5) {
      // shield up: eat enemy bullets that reach the front arc
      for (const pr of w.projectiles) {
        if (pr.dead || pr.team !== 'enemy' || pr.delay > 0) continue;
        const d = dist(p.x, p.y - 5, pr.x, pr.y);
        if (d > 18 + pr.r || d < 4) continue;
        if (Math.abs(angleDiff(aim, angleTo(p.x, p.y - 5, pr.x, pr.y))) > AEGIS_ARC) continue;
        pr.expire(w, true);
        st.mem.blockAt = w.time;
        w.particles.burst(pr.x, pr.y, { count: 6, speed: [40, 110], life: [0.1, 0.25], colors: ['#ffffff', '#a0c0ff', '#6a8ad8'], size: [1, 2], shape: 'spark' });
        w.sfx('shield_block', { vol: 0.35, pitch: 1.3 + fx.range(-0.1, 0.1) });
      }
    }
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const h = handPos(p, aim, 18);
    p.fireProjectiles(w, aim, {
      style: 'sprite', sprite: 'proj_aegis_slug', spriteRotates: false, radius: p.stats.projSize + 1, color: '#f0c060', light: 16, x: h.x, y: h.y,
    });
    muzzle(w, h.x, h.y, aim, ['#ffffff', '#fff0a0', '#f0c060'], 7, [40, 130]);
    w.particles.burst(h.x, h.y, { count: 4, speed: [10, 30], life: [0.4, 0.7], colors: ['#706060', '#504848'], size: [2, 3], sizeEnd: 4, drag: 3, fade: true });
    p.knock(-Math.cos(aim), -Math.sin(aim), 45);
    kick(w, aim + Math.PI, 1.8);
    w.sfx('shoot', { vol: 0.55, pitch: 0.65 });
    w.sfx('hit_metal', { vol: 0.2, pitch: 0.7 });
  },
  draw(w, p, r, st) {
    const raise = st.mem.raise ?? 0;
    drawGun(r, w, p, st, 'w_aegis_cannon', 3 + raise * 3, 2, { flash: w.time - (st.mem.blockAt ?? -9) < 0.08 ? 0.6 : 0 });
    if (raise > 0.5) {
      // faint barrier arc in front
      const a0 = p.aim - AEGIS_ARC;
      for (let i = 0; i <= 8; i++) {
        const a = a0 + (i / 8) * AEGIS_ARC * 2;
        r.rect(Math.round(p.x + Math.cos(a) * 17), Math.round(p.y - 5 + Math.sin(a) * 14), 1, 1, '#a0c0ff', 0.35 * raise);
      }
    }
  },
});

// ================================================================== 새벽의 등불
defineDrawnSprite('w_dawn_lantern', 11, 15, (p) => {
  p.ring(5.5, 1.6, 1.8, 1, '#ffe080');
  p.rect(2, 3, 7, 1, '#c89838');
  p.rect(1, 4, 9, 1, '#ffd060');
  p.rect(1, 5, 9, 7, '#fff2a8');
  p.rect(2, 6, 7, 5, '#ffffff');
  p.rect(1, 5, 1, 7, '#c89838');
  p.rect(9, 5, 1, 7, '#c89838');
  p.rect(5, 5, 1, 7, '#ffe080');
  p.rect(1, 12, 9, 1, '#ffd060');
  p.rect(3, 13, 5, 1, '#c89838');
  p.px(5, 14, '#c89838');
  p.px(0, 7, '#ffe080');
  p.px(10, 7, '#ffe080');
}, { outline: '#3a2008', origin: [5, 0] });

defineDrawnSprite('icon_dawn_lantern', 16, 16, (p) => {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    p.line(8 + Math.cos(a) * 5, 9 + Math.sin(a) * 5, 8 + Math.cos(a) * 7.5, 9 + Math.sin(a) * 7.5, '#ffd060');
  }
  p.ring(8, 2, 1.6, 1, '#ffe080');
  p.rect(5, 4, 6, 1, '#c89838');
  p.rect(4, 5, 8, 8, '#fff2a8');
  p.rect(5, 6, 6, 6, '#ffffff');
  p.rect(4, 5, 1, 8, '#c89838');
  p.rect(11, 5, 1, 8, '#c89838');
  p.rect(4, 13, 8, 1, '#c89838');
}, { outline: '#3a2008' });

const radiantFx: ProjBehavior = {
  id: 'radiant',
  update(pr, w) {
    if (fx.chance(0.6)) w.particles.spawn({ x: pr.x + fx.range(-1, 1), y: pr.y - pr.z + fx.range(-1, 1), life: 0.25, colors: ['#ffffff', '#fff0a0', '#ffc040'], size: 1, shape: 'pixel', additive: true });
  },
  draw(pr, r) {
    r.sprite(glowSprite(8 + pr.r * 2, '#ffd060'), pr.x, pr.y - pr.z, { alpha: 0.5, additive: true });
  },
};

/** The rising sun: drifts forward, sears enemies around it, then bursts into rays. */
class DawnSun extends Entity {
  angle: number;
  dmg: number;
  life = 1.3;
  tick = 0;
  constructor(x: number, y: number, angle: number, dmg: number) {
    super();
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.dmg = dmg;
    this.layer = 2;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const sp = 120 * (1 - Math.min(1, this.age / this.life) * 0.8);
    this.x += Math.cos(this.angle) * sp * dt;
    this.y += Math.sin(this.angle) * sp * dt;
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.22;
      for (const e of [...w.enemies]) {
        if (!e.alive || e.hidden) continue;
        const d = dist(this.x, this.y, e.x, e.y);
        if (d > 24 + e.r) continue;
        const n = d || 1;
        if (w.applyHit(e, { damage: this.dmg * 0.55, kind: 'laser', attacker: w.player, dirX: (e.x - this.x) / n, dirY: (e.y - this.y) / n, knockback: 30, light: true })) e.flash = Math.min(e.flash, 0.04);
      }
    }
    if (fx.chance(0.8)) {
      const a = fx.range(0, Math.PI * 2);
      w.particles.spawn({ x: this.x + Math.cos(a) * 10, y: this.y - 8 + Math.sin(a) * 10, vx: Math.cos(a) * 30, vy: Math.sin(a) * 30, life: 0.3, colors: ['#ffffff', '#fff0a0', '#ffb030'], size: 1, additive: true });
    }
    const blocked = tileProps(w.room.tileAt(Math.floor(this.x / TILE), Math.floor(this.y / TILE))).blocksShots;
    if (this.age >= this.life || blocked) this.burst(w);
  }

  burst(w: World): void {
    if (this.dead) return;
    this.dead = true;
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.age;
      fragment(w, this.x, this.y - 6, a, {
        damage: this.dmg * 0.6, speed: 260, range: 110, radius: 3, color: '#ffd060', light: 14, style: 'tear', pierce: 1,
      });
    }
    blast(w, this.x, this.y, 26, this.dmg * 0.8, { colors: ['#ffffff', '#fff6c0', '#ffc040', '#806030'], knockback: 160, shake: 0.18 });
    w.renderer.screenFlash('#fff0c0', 0.12);
    w.sfx('item_get_rare', { vol: 0.22, pitch: 1.6 });
  }

  override draw(r: Renderer, w: World): void {
    const pulse = 1 + 0.1 * Math.sin(w.time * 14);
    const grow = Math.min(1, this.age * 5);
    r.shadow(this.x, this.y + 2, 10, 3, 0.25);
    r.sprite(glowSprite(46 * pulse * grow, '#ffb030'), this.x, this.y - 8, { alpha: 0.35, additive: true });
    r.sprite(glowSprite(26 * pulse * grow, '#fff0a0'), this.x, this.y - 8, { alpha: 0.85, additive: true });
    r.sprite(glowSprite(12 * grow, '#ffffff'), this.x, this.y - 8, { alpha: 1 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + w.time * 2;
      const r0 = 9 * grow;
      const r1 = (14 + 3 * Math.sin(w.time * 10 + i)) * grow;
      r.line(this.x + Math.cos(a) * r0, this.y - 8 + Math.sin(a) * r0, this.x + Math.cos(a) * r1, this.y - 8 + Math.sin(a) * r1, '#ffe080', 1, 0.8);
    }
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 8, 70, '#ffd080', { intensity: 0.9 });
  }
}

defineWeapon({
  id: 'dawn_lantern',
  name: '새벽의 등불',
  desc: '첫 등불지기의 등불. 빛살 세 줄기를 쏘고, 네 번째 공격마다 떠오르는 해를 띄워 주위를 태운 뒤 사방으로 빛을 터뜨린다.',
  icon: 'icon_dawn_lantern',
  heldSprite: 'w_dawn_lantern',
  kind: 'ranged',
  archetype: '전설 등불',
  rarity: 'legendary',
  pools: ['boss', 'secret'],
  stats(m) {
    m.mulStat('fireRate', 0.95);
    m.addStat('homing', 1.2);
  },
  update(w, p, st, dt, firing, aim) {
    st.anim = Math.max(0, st.anim - dt * 5);
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.stats;
    const h = handPos(p, aim, 8);
    const gx = h.x + Math.cos(aim) * 3;
    const gy = h.y + 7;
    for (const off of [-0.16, 0, 0.16]) {
      p.fireProjectiles(w, aim + off, {
        style: 'tear', damageMult: 0.7, color: '#ffd060', light: 18, x: gx, y: gy, behaviors: [radiantFx], spreadMult: 0.6,
      });
    }
    st.combo = (st.combo + 1) % 4;
    st.comboTimer = 99;
    if (st.combo === 0) {
      w.spawn(new DawnSun(gx + Math.cos(aim) * 8, gy + 8 + Math.sin(aim) * 8, aim, s.damage));
      w.sfx('summon', { vol: 0.4, pitch: 1.3 });
      w.shake(0.08);
    }
    muzzle(w, gx, gy, aim, ['#ffffff', '#fff0a0', '#ffc040'], 6, [40, 120]);
    st.anim = 1;
    kick(w, aim + Math.PI, 0.8);
    w.sfx('shoot_magic', { vol: 0.5, pitch: 1.05 + w.rng.next() * 0.08 });
  },
  draw(w, p, r, st) {
    const h = handPos(p, p.aim, 7 - st.anim);
    const charged = st.combo === 3;
    const pulse = 0.5 + 0.5 * Math.sin(w.time * (charged ? 14 : 5));
    r.sprite(glowSprite(18 + st.anim * 10 + (charged ? 6 * pulse : 0), '#ffd060'), h.x, h.y + 7, { alpha: 0.3 + 0.15 * pulse, additive: true });
    r.sprite('w_dawn_lantern', h.x, h.y - 1, { rot: Math.sin(p.age * 2) * 0.08, flash: st.anim * 0.4 + (charged ? 0.25 * pulse : 0) });
  },
});

// ================================================================== 유성우 지팡이
defineDrawnSprite('w_meteor_staff', 22, 11, (p) => {
  p.rect(0, 5, 15, 1, '#4a2a4a');
  p.rect(0, 4, 15, 1, '#7a4a7a');
  p.rect(5, 4, 1, 2, '#c8a040');
  p.ring(18, 5, 3.8, 1, '#c8a040');
  p.circle(18, 5, 2.6, '#ff6030');
  p.circle(17.5, 4.5, 1.4, '#ffd060');
  p.px(17, 4, '#ffffff');
  p.px(21, 1, '#ffd060');
  p.px(14, 9, '#ff8030');
}, { outline: O, origin: [3, 5] });

defineDrawnSprite('icon_meteor_staff', 16, 16, (p) => {
  p.line(1, 15, 9, 7, '#4a2a4a');
  p.line(2, 15, 10, 7, '#7a4a7a');
  p.circle(11, 5, 3.4, '#ff6030');
  p.circle(10.5, 4.5, 2, '#ffd060');
  p.px(10, 4, '#ffffff');
  p.line(13, 0, 16, 0, '#ffd060');
  p.line(2, 4, 5, 1, '#ff9a40');
  p.circle(5.5, 1.5, 1.2, '#ffe080');
}, { outline: O });

/** A meteor called down on a spot: ground marker, falling streak, impact. */
class MeteorStrike extends Entity {
  delay: number;
  rad: number;
  dmg: number;
  fall = 0.22;
  big: boolean;
  constructor(x: number, y: number, delay: number, rad: number, dmg: number, big: boolean) {
    super();
    this.x = x;
    this.y = y;
    this.delay = delay;
    this.rad = rad;
    this.dmg = dmg;
    this.big = big;
    this.layer = 0;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.age >= this.delay + this.fall) {
      this.dead = true;
      blast(w, this.x, this.y, this.rad, this.dmg, {
        colors: ['#ffffff', '#ffe080', '#ff6030', '#502020'], knockback: this.big ? 280 : 160, shake: this.big ? 0.3 : 0.12,
        statuses: [{ kind: 'burn', duration: 2, power: this.dmg * 0.15, chance: 0.5 }], small: !this.big,
      });
      w.particles.burst(this.x, this.y, { count: this.big ? 14 : 6, speed: [60, 160], life: [0.3, 0.7], colors: ['#806050', '#504030', '#ff9040'], size: [1, 3], gravity: 320, vz: [60, 160], shape: 'square' });
      if (this.big) w.sfx('slam', { vol: 0.5, pitch: 0.9, x: this.x });
    }
  }

  override draw(r: Renderer, w: World): void {
    const k = clamp(this.age / this.delay, 0, 1);
    // ground marker closing in (player-colored, not the red enemy warning)
    const rr = this.rad * (1.4 - 0.4 * k);
    r.ring(this.x, this.y, rr, '#ffb040', 1, 0.35 + 0.4 * k);
    r.ring(this.x, this.y, this.rad * 0.3, '#ffe080', 1, 0.3 + 0.5 * Math.abs(Math.sin(w.time * 12)));
    if (this.age < this.delay - 0.15) return;
    // falling streak from the upper left
    const t = clamp((this.age - (this.delay - 0.15)) / (this.fall + 0.15), 0, 1);
    const h = (1 - t) * 150;
    const mx = this.x - h * 0.45;
    const my = this.y - h;
    const s = this.big ? 1 : 0.6;
    r.line(mx - 26 * s * 0.45, my - 26 * s, mx, my, '#ff9040', 3 * s, 0.6);
    r.line(mx - 14 * s * 0.45, my - 14 * s, mx, my, '#fff0a0', 2 * s, 0.9);
    r.sprite(glowSprite(14 * s, '#ff6030'), mx, my, { alpha: 0.8, additive: true });
    r.circle(mx, my, 3.5 * s, '#ffe0a0');
  }

  override light(w: World): void {
    const k = clamp(this.age / (this.delay + this.fall), 0, 1);
    w.lights.add(this.x, this.y, this.rad * (0.6 + k), '#ff9040', { intensity: 0.3 + 0.5 * k });
  }
}

/** Big meteor damage multiplier (exported for tests). */
export const METEOR_MULT = 2.9;

defineWeapon({
  id: 'meteor_staff',
  name: '유성우 지팡이',
  desc: '조준한 자리에 유성을 불러 떨어뜨린다. 큰 유성 하나와 작은 유성 둘이 잠시 뒤 내리꽂힌다.',
  icon: 'icon_meteor_staff',
  heldSprite: 'w_meteor_staff',
  kind: 'ranged',
  archetype: '전설 소환',
  rarity: 'legendary',
  pools: ['boss', 'secret'],
  stats(m) {
    m.mulStat('fireRate', 0.55);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.stats;
    // aim point: the cursor, else the nearest enemy roughly in the aim direction, else ahead
    let d = aimDistance(w, p, 30, s.range * 0.9, s.range * 0.5);
    const near = w.nearestEnemy(p.x + Math.cos(aim) * d, p.y + Math.sin(aim) * d, 60);
    let tx = p.x + Math.cos(aim) * d;
    let ty = p.y + Math.sin(aim) * d;
    if (near && Math.abs(angleDiff(aim, angleTo(p.x, p.y, near.x, near.y))) < 0.5) {
      tx = near.x;
      ty = near.y;
      d = dist(p.x, p.y, tx, ty);
    }
    const free = w.room.nearestFree(tx, ty, 4);
    const rad = 28 + s.projSize * 2;
    w.spawn(new MeteorStrike(free.x, free.y, 0.38, rad, s.damage * METEOR_MULT, true));
    const smalls = 2 + Math.max(0, s.shots - 1);
    for (let i = 0; i < smalls; i++) {
      const a = w.rng.next() * Math.PI * 2;
      const rr = 14 + w.rng.next() * 16;
      w.spawn(new MeteorStrike(free.x + Math.cos(a) * rr, free.y + Math.sin(a) * rr * 0.8, 0.52 + i * 0.14, 15, s.damage * 1.0, false));
    }
    const h = handPos(p, aim, 18);
    muzzle(w, h.x, h.y, -Math.PI / 2, ['#ffffff', '#ffe080', '#ff6030'], 8, [40, 120]);
    st.anim = 1;
    kick(w, -Math.PI / 2, 1);
    w.sfx('summon', { vol: 0.4, pitch: 0.8 });
    w.sfx('fire', { vol: 0.35, pitch: 1.4 });
  },
  draw(w, p, r, st) {
    const f = shotFade(st, w, 0.3);
    // raised to the sky when casting
    const up = -Math.PI / 2 + (Math.cos(p.aim) >= 0 ? 0.5 : -0.5);
    const a = f > 0 ? up + (p.aim - up) * (1 - f) : p.aim;
    drawHeld(r, p, 'w_meteor_staff', a, 5, { flash: f * 0.4 });
    const h = handPos(p, a, 18);
    r.sprite(glowSprite(8 + f * 10 + Math.sin(w.time * 7), '#ff6030'), h.x, h.y, { alpha: 0.4 + f * 0.4, additive: true });
  },
});
