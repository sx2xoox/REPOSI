import { visualHandPos } from '../../game/weapon-pose';
// Blades:
//  월영도     (moon_katana, legendary) — lightning-fast slashes; every third
//                                      attack is an iai dash-cut through the line
//  거인의 대검 (titan_greatsword, epic) — hold to heave it up, release for a full
//                                      spin slash (tap: a heavy overhead cleave)
//  망자의 큰낫 (reaper_scythe, epic)    — a huge sweeping arc that weakens what it
//                                      touches and feeds the lantern on kills

import { defineWeapon } from '../../game/defs';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { Entity } from '../../game/entity';
import { defineDrawnSprite } from '../../engine/sprites';
import { clamp } from '../../engine/math';
import { fx } from '../../engine/rng';
import {
  O, attackInput, attackInterval, chargeTime, consumeAttack, drawHeld, glowSprite, handPos, kick, meleeRest, rayLength,
  startSwingPose, swingPose,
} from './common';
import { beginAttack, enemiesOnSegment, strike } from './kit';

// ================================================================== 월영도
defineDrawnSprite('w_moon_katana', 24, 5, (p) => {
  // wrapped grip, round guard, long slightly curved blade
  p.rect(0, 1, 6, 3, '#2a2a4a');
  p.px(1, 1, '#5a5a8a');
  p.px(3, 1, '#5a5a8a');
  p.px(5, 1, '#5a5a8a');
  p.rect(6, 0, 2, 5, '#c8a040');
  for (let x = 8; x < 24; x++) {
    const bend = x > 18 ? 1 : 0;
    p.px(x, 1 + bend, '#e8f0ff');
    p.px(x, 2 + bend, x < 22 ? '#a0b0d8' : '#e8f0ff');
  }
  p.px(23, 1, '#ffffff');
  p.line(9, 1, 17, 1, '#ffffff');
}, { outline: '#0c0c1c', origin: [3, 2] });

defineDrawnSprite('icon_moon_katana', 16, 16, (p) => {
  p.line(1, 15, 4, 12, '#2a2a4a');
  p.line(2, 15, 5, 12, '#5a5a8a');
  p.line(4, 10, 6, 12, '#c8a040');
  p.line(5, 11, 14, 2, '#a0b0d8');
  p.line(5, 10, 13, 2, '#e8f0ff');
  p.line(13, 2, 15, 1, '#ffffff');
  p.ring(11, 11, 3.2, 1, '#c8d8ff');
  p.px(12, 9, '#ffffff');
}, { outline: '#0c0c1c' });

/** Lingering cut line left by the iai dash (pure visual). */
class CutLine extends Entity {
  x2: number;
  y2: number;
  delay: number;
  constructor(x: number, y: number, x2: number, y2: number, delay: number) {
    super();
    this.x = x;
    this.y = y;
    this.x2 = x2;
    this.y2 = y2;
    this.delay = delay;
    this.layer = 2;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.age > this.delay + 0.3) this.dead = true;
  }

  override draw(r: Renderer): void {
    const t = this.age - this.delay;
    if (t < 0) {
      r.line(this.x, this.y, this.x2, this.y2, '#c8d8ff', 1, 0.35);
      return;
    }
    const k = 1 - t / 0.3;
    r.line(this.x, this.y, this.x2, this.y2, '#8aa0ff', 1 + k * 4, 0.6 * k);
    r.line(this.x, this.y, this.x2, this.y2, '#ffffff', Math.max(1, k * 2), k);
  }
}

defineWeapon({
  id: 'moon_katana',
  name: '월영도',
  desc: '달빛을 머금은 칼. 눈에 보이지 않을 만큼 빠르게 베고, 세 번째 공격마다 앞으로 질주하며 일직선을 베어 가른다. 탄환 반사 피해는 공격력의 40%.',
  icon: 'icon_moon_katana',
  heldSprite: 'w_moon_katana',
  kind: 'melee',
  archetype: '도',
  rarity: 'legendary',
  tags: ['blade'],
  pools: ['boss', 'secret'],
  stats(m) {
    m.mulStat('damage', 0.77);
    m.mulStat('fireRate', 0.85);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!attackInput(st, w, firing) || st.cooldown > 0) return;
    consumeAttack(st);
    const s = p.weaponStats;
    const iv = attackInterval(p);
    const step = st.combo % 3;
    beginAttack(w, p, st, aim);
    const reach = 26 + s.range * 0.035;
    if (step < 2) {
      const dir = step === 0 ? 1 : -1;
      p.swing(w, { angle: aim, arc: 2.1, reach, damage: s.damage, knockback: s.knockback * 1.4, swingDir: dir, color: '#c8d8ff', visual: 0.13, duration: 0.07, reflect: true });
      startSwingPose(st, w, aim - 1.3 * dir, aim + 1.4 * dir, 0.045, 0.04);
      st.cooldown = iv * 0.6;
      p.knock(Math.cos(aim), Math.sin(aim), 45);
      kick(w, aim, 0.9);
      w.sfx('swing', { vol: 0.55, pitch: 1.35 + step * 0.15 });
    } else {
      // iai: dash through the line, the cut lands a beat later
      const ox = p.x;
      const oy = p.y - 3;
      const want = 58 + s.range * 0.04;
      const len = Math.max(0, rayLength(w, ox, oy, aim, want, true) - 6);
      const ex = ox + Math.cos(aim) * len;
      const ey = oy + Math.sin(aim) * len;
      p.dashDX = Math.cos(aim);
      p.dashDY = Math.sin(aim);
      p.dashT = Math.max(0.05, len / Math.max(1, s.dashSpeed));
      p.invuln = Math.max(p.invuln, p.dashT + 0.12);
      const width = 18 + s.projSize;
      for (const e of enemiesOnSegment(w, ox, oy, ex, ey, width)) {
        strike(w, e, s.damage * 2.2, Math.cos(aim), Math.sin(aim), s.knockback * 2.5, { statuses: [{ kind: 'bleed', duration: 3, power: s.damage * 0.4, chance: 0.5 }] });
        w.particles.burst(e.x, e.y - 4, { count: 8, speed: [60, 160], angle: aim, spread: 0.5, life: [0.1, 0.25], colors: ['#ffffff', '#c8d8ff'], size: [1, 2], shape: 'spark' });
      }
      for (const h of [...w.hittables]) {
        const t = ((h.x - ox) * (ex - ox) + (h.y - oy) * (ey - oy)) / Math.max(1, len * len);
        const cx = ox + (ex - ox) * clamp(t, 0, 1);
        const cy = oy + (ey - oy) * clamp(t, 0, 1);
        if (Math.hypot(h.x - cx, h.y - cy) < h.r + width / 2) h.takeHit(w, { damage: s.damage * 2, kind: 'melee', attacker: p });
      }
      const nx = -Math.sin(aim) * 5;
      const ny = Math.cos(aim) * 5;
      w.spawn(new CutLine(ox - nx, oy - ny, ex + nx, ey + ny, 0.1));
      startSwingPose(st, w, aim + 2.4, aim - 0.6, 0.06, 0.2);
      st.cooldown = iv * 1.4;
      w.hitstop(0.05);
      w.shake(0.15);
      w.renderer.screenFlash('#c8d8ff', 0.08);
      kick(w, aim, 2.5);
      w.sfx('dash', { vol: 0.6, pitch: 1.3 });
      w.sfx('swing_heavy', { vol: 0.7, pitch: 1.3 });
    }
    st.combo = (step + 1) % 3;
    st.comboTimer = st.cooldown + 0.55;
  },
  draw(w, p, r, st) {
    const pose = swingPose(st, w, meleeRest(st, p.aim));
    const active = pose.phase === 1 || pose.phase === 2;
    drawHeld(r, p, 'w_moon_katana', pose.angle, active ? 4 : 1, { flash: pose.phase === 1 ? 0.5 : 0 });
    if (st.combo === 2 && !active) {
      // the next attack is the iai cut: a faint moon glint on the blade
      const h = visualHandPos(p, pose.angle, 14);
      r.sprite(glowSprite(6 + Math.sin(w.time * 10) * 1.5, '#c8d8ff'), h.x, h.y, { alpha: 0.45, additive: true });
    }
  },
});

// ================================================================== 거인의 대검
defineDrawnSprite('w_titan_sword', 28, 9, (p) => {
  p.rect(0, 3, 6, 3, '#4a2a1a');
  p.rect(0, 3, 6, 1, '#7a4a2a');
  p.rect(6, 0, 3, 9, '#8a7040');
  p.rect(6, 0, 3, 1, '#d0b060');
  p.poly([9, 1.5, 25, 1.5, 28, 4.5, 25, 7.5, 9, 7.5], '#8a92ac');
  p.poly([9, 1.5, 25, 1.5, 27, 4, 9, 4], '#c8d0e4');
  p.line(10, 4, 24, 4, '#5a6078');
  p.px(26, 3, '#ffffff');
  p.px(7, 4, '#e04040');
}, { outline: O, origin: [3, 4] });

defineDrawnSprite('icon_titan_greatsword', 16, 16, (p) => {
  p.line(0, 15, 3, 12, '#4a2a1a');
  p.line(1, 10, 5, 14, '#8a7040');
  p.poly([3, 11, 13, 1, 16, 0, 15, 3, 5, 13], '#8a92ac');
  p.poly([3, 11, 13, 1, 15, 0, 4, 11], '#c8d0e4');
  p.px(15, 0, '#ffffff');
  p.px(3, 12, '#e04040');
}, { outline: O });

/** Spin-slash damage multiplier for a charge 0..1 (exported for tests). */
export function greatswordMult(charge: number): number {
  return 1.2 + 1.8 * clamp(charge, 0, 1);
}

defineWeapon({
  id: 'titan_greatsword',
  name: '거인의 대검',
  desc: '거대한 칼날로 먼 거리까지 벤다. 누르고 있다 떼면 몸을 한 바퀴 돌며 주위를 크게 휩쓸고, 짧게 누르면 내려찍는다. 벽에 막히며, 회전 베기로 반사한 탄환 피해는 공격력의 40%.',
  icon: 'icon_titan_greatsword',
  heldSprite: 'w_titan_sword',
  kind: 'charge',
  archetype: '대검',
  rarity: 'epic',
  tags: ['blade'],
  pools: ['treasure', 'boss'],
  stats(m) {
    m.mulStat('damage', 0.98);
    m.mulStat('fireRate', 0.7);
    m.addStat('knockback', 40);
  },
  update(w, p, st, dt, firing, aim) {
    const s = p.weaponStats;
    if (firing && st.cooldown <= 0) {
      if (!st.mem.drawing) {
        st.mem.drawing = 1;
        st.charge = 0;
        w.sfx('charge', { vol: 0.35, pitch: 0.7 });
      }
      const before = st.charge;
      st.charge = Math.min(1, st.charge + dt / chargeTime(p, 0.6));
      if (before < 1 && st.charge >= 1) {
        w.sfx('charge_ready', { vol: 0.5, pitch: 0.8 });
        w.particles.burst(p.x, p.y - 8, { count: 10, speed: [20, 60], life: [0.2, 0.4], colors: ['#ffffff', '#ffe8a0'], size: [1, 2], shape: 'spark' });
      }
      return;
    }
    if (!st.mem.drawing) return;
    st.mem.drawing = 0;
    const c = st.charge;
    st.charge = 0;
    beginAttack(w, p, st, aim);
    const reach = (34 + s.range * 0.045) * 2;
    if (c >= 0.35) {
      // full spin
      let landed = false;
      p.swing(w, {
        angle: aim, arc: Math.PI * 2, reach, damage: s.damage * greatswordMult(c), knockback: s.knockback * 3.2, swingDir: 1,
        color: c >= 1 ? '#ffe8a0' : '#d8e0ff', visual: 0.26, duration: 0.12, hitKick: 2.5, reflect: true, respectWalls: true,
        onHit: (ww) => {
          if (landed) return;
          landed = true;
          ww.hitstop(0.06);
          ww.shake(0.25);
        },
      });
      st.mem.spinAt = w.time;
      st.mem.spinA = aim;
      st.cooldown = attackInterval(p, 0.45);
      w.sfx('swing_heavy', { vol: 0.9, pitch: 0.85 });
      w.sfx('whoosh', { vol: 0.6, pitch: 0.6 });
      w.particles.burst(p.x, p.y - 2, { count: 16, speed: [60, 140], life: [0.2, 0.4], colors: ['#d0c0b0', '#a09080'], size: [1, 2], ground: true });
    } else {
      // tap: overhead cleave
      p.swing(w, { angle: aim, arc: 2.4, reach: reach * 0.95, damage: s.damage * 1.4, knockback: s.knockback * 2.6, color: '#d8e0ff', visual: 0.2, duration: 0.09, hitKick: 2, respectWalls: true });
      const side = Math.cos(aim) >= 0 ? 1 : -1;
      startSwingPose(st, w, aim - side * 2.2, aim + side * 0.6, 0.09, 0.12);
      st.cooldown = attackInterval(p);
      w.sfx('swing_heavy', { vol: 0.75, pitch: 1 });
    }
    kick(w, aim, 2.2);
    p.knock(Math.cos(aim), Math.sin(aim), 60);
  },
  draw(w, p, r, st) {
    const spinT = (w.time - (st.mem.spinAt ?? -9)) / 0.24;
    if (spinT >= 0 && spinT < 1) {
      const a = (st.mem.spinA ?? p.aim) + spinT * Math.PI * 2 * (Math.cos(st.mem.spinA ?? 0) >= 0 ? 1 : -1);
      drawHeld(r, p, 'w_titan_sword', a, 6, { sx: 2, sy: 2, flash: 0.4 });
      return;
    }
    if (st.mem.drawing) {
      // heaved up over the shoulder, trembling when fully charged
      const side = Math.cos(p.aim) >= 0 ? 1 : -1;
      const c = st.charge;
      const shake = c >= 1 ? fx.range(-0.06, 0.06) : 0;
      const angle = p.aim - side * (1.2 + c * 1.1) + shake;
      drawHeld(r, p, 'w_titan_sword', angle, 3, { sx: 2, sy: 2, flash: c >= 1 ? 0.25 + 0.2 * Math.sin(w.time * 30) : 0 });
      if (c > 0.2) {
        const h = visualHandPos(p, angle, 3);
        r.sprite(glowSprite(6 + c * 10, c >= 1 ? '#ffe8a0' : '#a0b0ff'), h.x + Math.cos(angle) * 38, h.y + Math.sin(angle) * 38, { alpha: 0.2 + c * 0.35, additive: true });
      }
      return;
    }
    const pose = swingPose(st, w, meleeRest(st, p.aim));
    drawHeld(r, p, 'w_titan_sword', pose.angle, pose.phase === 1 ? 5 : 2, { sx: 2, sy: 2, flash: pose.phase === 1 ? 0.4 : 0 });
  },
});

// ================================================================== 망자의 큰낫
defineDrawnSprite('w_reaper_scythe', 24, 15, (p) => {
  // long shaft along the bottom, a big hooked blade at the end curling back
  p.rect(0, 12, 20, 2, '#3a2a3a');
  p.rect(0, 12, 20, 1, '#6a4a6a');
  p.rect(19, 9, 3, 6, '#5a5a6a');
  p.poly([20, 9, 23, 6, 22, 1, 17, 0, 10, 2, 16, 3, 20, 5], '#8a9a8a');
  p.poly([20, 8, 22, 5, 21, 1.5, 17, 1, 13, 2, 17, 2.5, 20, 4], '#c8e0c8');
  p.line(11, 2, 17, 0.5, '#ffffff');
  p.px(21, 11, '#80ff9a');
}, { outline: '#0c100c', origin: [3, 13] });

defineDrawnSprite('icon_reaper_scythe', 16, 16, (p) => {
  p.line(2, 15, 11, 4, '#3a2a3a');
  p.line(3, 15, 12, 4, '#6a4a6a');
  p.poly([10, 5, 12, 2, 16, 1, 15, 6, 13, 10, 13, 5], '#8a9a8a');
  p.poly([11, 4, 12, 2, 15, 1.5, 14, 5, 13, 7], '#c8e0c8');
  p.line(13, 9, 15, 3, '#ffffff');
  p.circle(4, 5, 1.6, '#80ff9a');
  p.px(3, 4, '#ffffff');
}, { outline: '#0c100c' });

/** A wisp that floats from a fallen enemy into the player (cosmetic). */
class SoulWisp extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  constructor(x: number, y: number) {
    super();
    this.x = x;
    this.y = y;
    this.layer = 2;
    this.tileCollide = false;
    this.vx = fx.range(-40, 40);
    this.vy = -60;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const p = w.player;
    const dx = p.x - this.x;
    const dy = p.y - 8 - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const pull = Math.min(1, this.age * 2);
    this.vx += ((dx / d) * 420 * pull - this.vx * 2) * dt;
    this.vy += ((dy / d) * 420 * pull - this.vy * 2) * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (fx.chance(0.5)) w.particles.spawn({ x: this.x, y: this.y, life: 0.3, colors: ['#c0ffd0', '#40c070'], size: 1, shape: 'pixel', additive: true });
    if ((d < 8 && this.age > 0.2) || this.age > 1.5) {
      this.dead = true;
      w.particles.burst(p.x, p.y - 8, { count: 5, speed: [10, 40], life: [0.2, 0.4], colors: ['#c0ffd0', '#80ff9a'], size: [1, 1], additive: true });
    }
  }

  override draw(r: Renderer, w: World): void {
    r.sprite(glowSprite(7 + Math.sin(w.time * 20 + this.id), '#80ff9a'), this.x, this.y, { alpha: 0.8, additive: true });
  }
}

defineWeapon({
  id: 'reaper_scythe',
  name: '망자의 큰낫',
  desc: '크게 휘둘러 넓은 반원을 베는 큰낫. 베인 적은 약해지고, 쓰러진 적의 넋은 등불의 불씨가 된다.',
  icon: 'icon_reaper_scythe',
  heldSprite: 'w_reaper_scythe',
  kind: 'melee',
  archetype: '큰낫',
  rarity: 'epic',
  tags: ['blade'],
  pools: ['treasure', 'boss', 'curse'],
  stats(m) {
    m.mulStat('damage', 1.36);
    m.mulStat('fireRate', 0.57);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!attackInput(st, w, firing) || st.cooldown > 0) return;
    consumeAttack(st);
    const s = p.weaponStats;
    beginAttack(w, p, st, aim);
    st.combo = (st.combo + 1) % 2;
    st.comboTimer = 1.2;
    const dir = st.combo === 0 ? -1 : 1;
    p.swing(w, {
      angle: aim, arc: 4.0, reach: 34 + s.range * 0.05, damage: s.damage, knockback: s.knockback * 1.8, swingDir: dir,
      color: '#9affb0', visual: 0.24, duration: 0.11, hitKick: 1.8,
      statuses: [{ kind: 'weak', duration: 2.5, chance: 0.5 }],
      onHit: (ww, target) => {
        if (!target.alive) {
          ww.spawn(new SoulWisp(target.x, target.y - 6));
          ww.player.addEmber(4);
        }
      },
    });
    startSwingPose(st, w, aim - 2.0 * dir, aim + 2.0 * dir, 0.11, 0.1);
    st.cooldown = attackInterval(p);
    p.knock(Math.cos(aim), Math.sin(aim), 50);
    kick(w, aim, 1.6);
    w.sfx('swing_heavy', { vol: 0.65, pitch: 1.15 });
    w.sfx('whoosh', { vol: 0.35, pitch: 0.8 });
  },
  draw(w, p, r, st) {
    const pose = swingPose(st, w, meleeRest(st, p.aim));
    drawHeld(r, p, 'w_reaper_scythe', pose.angle, pose.phase === 1 ? 3 : 1, { flash: pose.phase === 1 ? 0.35 : 0 });
    const h = visualHandPos(p, pose.angle, 18);
    r.sprite(glowSprite(5 + Math.sin(w.time * 6), '#80ff9a'), h.x, h.y, { alpha: 0.3, additive: true });
  },
});
