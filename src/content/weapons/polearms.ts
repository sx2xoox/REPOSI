// Reach weapons:
//  용아창     (fang_spear, rare) — three lightning-quick stabs per attack
//  가시 채찍  (thorn_whip, rare) — very long reach; the tip cracks for double damage
//  지진 철퇴  (quake_mace, rare) — two swings, then a smash that splits the ground
//                                in a line of erupting rock

import { defineWeapon } from '../../game/defs';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { Entity } from '../../game/entity';
import { defineDrawnSprite } from '../../engine/sprites';
import { dist } from '../../engine/math';
import { TILE } from '../../game/constants';
import { tileProps } from '../../game/tiles';
import {
  O, attackInput, attackInterval, consumeAttack, drawHeld, handPos, kick, meleeRest, pixLine, startSwingPose, swingPose,
} from './common';
import { beginAttack, strike } from './kit';

// ================================================================== 용아창
defineDrawnSprite('w_fang_spear', 30, 7, (p) => {
  p.rect(0, 3, 22, 1, '#7a3a2a');
  p.rect(0, 2, 22, 1, '#a85a3a');
  p.rect(20, 1, 2, 5, '#c8a040');
  p.poly([22, 0.5, 30, 3.5, 22, 6.5], '#e8e8f0');
  p.poly([22, 2, 28, 3.5, 22, 3.5], '#ffffff');
  p.px(23, 0, '#c8c8d8');
  p.px(23, 6, '#c8c8d8');
  p.px(19, 4, '#e04040');
  p.px(18, 5, '#e04040');
}, { outline: O, origin: [8, 3] });

defineDrawnSprite('icon_fang_spear', 16, 16, (p) => {
  p.line(0, 16, 10, 6, '#7a3a2a');
  p.line(1, 16, 11, 6, '#a85a3a');
  p.poly([9, 5, 15, 0, 13, 6, 11, 8], '#e8e8f0');
  p.line(11, 5, 15, 0, '#ffffff');
  p.line(8, 7, 10, 9, '#c8a040');
  p.px(7, 10, '#e04040');
  p.px(6, 11, '#e04040');
}, { outline: O });

defineWeapon({
  id: 'fang_spear',
  name: '용아창',
  desc: '용의 송곳니로 벼린 창. 한 번 공격할 때마다 번개처럼 세 번 찌른다.',
  icon: 'icon_fang_spear',
  heldSprite: 'w_fang_spear',
  kind: 'melee',
  archetype: '창',
  rarity: 'rare',
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('damage', 0.68);
    m.mulStat('fireRate', 0.62);
  },
  update(w, p, st, dt, firing, aim) {
    const s = p.stats;
    if ((st.mem.stabs ?? 0) > 0) {
      st.mem.stabT = (st.mem.stabT ?? 0) - dt;
      if (st.mem.stabT <= 0) {
        st.mem.stabs--;
        st.mem.stabT = 0.075;
        const a = p.aim + (w.rng.next() - 0.5) * 0.12;
        p.swing(w, {
          angle: a, thrust: true, arc: 10, reach: 44 + s.range * 0.05, damage: s.damage, knockback: s.knockback * 1.2,
          color: '#ffe0c0', visual: 0.11, duration: 0.05, hitKick: 1,
        });
        st.mem.thrustAt = w.time;
        st.mem.thrustA = a;
        kick(w, a, 0.8);
        w.sfx('swing', { vol: 0.42, pitch: 1.3 + (2 - st.mem.stabs) * 0.12 });
      }
    }
    if (!attackInput(st, w, firing) || st.cooldown > 0) return;
    consumeAttack(st);
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    st.mem.stabs = 3;
    st.mem.stabT = 0;
    p.knock(Math.cos(aim), Math.sin(aim), 40);
    w.sfx('whoosh', { vol: 0.25, pitch: 1.6 });
  },
  draw(w, p, r, st) {
    const t = (w.time - (st.mem.thrustAt ?? -9)) / 0.075;
    let ext = 0;
    if (t >= 0 && t < 1) ext = t < 0.35 ? t / 0.35 : 1 - (t - 0.35) / 0.65;
    const busy = (st.mem.stabs ?? 0) > 0 || ext > 0;
    const a = busy ? st.mem.thrustA ?? p.aim : p.aim + (Math.cos(p.aim) >= 0 ? 0.35 : -0.35);
    drawHeld(r, p, 'w_fang_spear', a, -1 + ext * 14, { flash: ext > 0.7 ? 0.4 : 0 });
  },
});

// ================================================================== 가시 채찍
defineDrawnSprite('w_thorn_whip_handle', 9, 4, (p) => {
  p.rect(0, 1, 6, 2, '#5a2a3a');
  p.px(1, 1, '#8a4a5a');
  p.px(3, 1, '#8a4a5a');
  p.rect(6, 0, 2, 4, '#c8a040');
  p.px(8, 1, '#4a8a3a');
  p.px(8, 2, '#4a8a3a');
}, { outline: O, origin: [2, 2] });

defineDrawnSprite('icon_thorn_whip', 16, 16, (p) => {
  p.line(1, 15, 4, 12, '#5a2a3a');
  p.line(2, 15, 5, 12, '#8a4a5a');
  p.line(4, 11, 6, 13, '#c8a040');
  // coiled whip
  const pts: [number, number][] = [[6, 11], [9, 8], [10, 4], [7, 2], [4, 4], [5, 7], [9, 9], [13, 8], [15, 4]];
  for (let i = 0; i + 1 < pts.length; i++) p.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], '#4a8a3a');
  p.px(10, 4, '#90d070');
  p.px(4, 4, '#90d070');
  p.px(13, 8, '#90d070');
  p.px(15, 3, '#ffffff');
}, { outline: O });

/** Whip reach (px) for a range stat (exported for tests). */
export function whipReach(range: number): number {
  return 58 + range * 0.07;
}

defineWeapon({
  id: 'thorn_whip',
  name: '가시 채찍',
  desc: '멀리까지 닿는 가시 채찍. 채찍 끝으로 맞히면 \'딱\' 소리와 함께 두 배의 피해를 준다.',
  icon: 'icon_thorn_whip',
  heldSprite: 'w_thorn_whip_handle',
  kind: 'melee',
  archetype: '채찍',
  rarity: 'rare',
  pools: ['treasure', 'shop'],
  stats(m) {
    m.mulStat('fireRate', 0.7);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!attackInput(st, w, firing) || st.cooldown > 0) return;
    consumeAttack(st);
    const s = p.stats;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const reach = whipReach(s.range);
    let cracked = false;
    p.swing(w, {
      angle: aim, thrust: true, arc: 12 + s.projSize, reach, damage: s.damage, knockback: s.knockback * 1.4,
      color: '#90d070', visual: 0.2, duration: 0.09, style: 'none', hitKick: 1.2, deflect: false,
      statuses: [{ kind: 'bleed', duration: 2.5, power: s.damage * 0.3, chance: 0.2 }],
      onHit: (ww, target) => {
        const d = dist(p.x, p.y - 3, target.x, target.y);
        if (d < reach * 0.68) return;
        // sweet spot: the tip cracks
        strike(ww, target, s.damage, Math.cos(aim), Math.sin(aim), s.knockback, { noProc: true, light: true });
        ww.particles.burst(target.x, target.y - 4, { count: 10, speed: [60, 170], life: [0.08, 0.2], colors: ['#ffffff', '#fff0a0', '#90d070'], size: [1, 2], shape: 'spark' });
        ww.floatText(target.x, target.y - 18, '딱!', '#fff0a0', 0.8);
        if (!cracked) {
          cracked = true;
          ww.sfx('hit_crit', { vol: 0.55, pitch: 1.5 });
          ww.hitstop(0.03);
        }
      },
    });
    st.mem.whipAt = w.time;
    st.mem.whipA = aim;
    st.mem.whipR = reach;
    st.mem.whipDir = (st.mem.whipDir ?? 1) * -1;
    kick(w, aim, 1.2);
    w.sfx('whoosh', { vol: 0.5, pitch: 1.3 });
    w.sfx('swing', { vol: 0.3, pitch: 1.8 });
  },
  draw(w, p, r, st) {
    const t = (w.time - (st.mem.whipAt ?? -9)) / 0.24;
    const a = t >= 0 && t < 1 ? st.mem.whipA ?? p.aim : p.aim + (Math.cos(p.aim) >= 0 ? 0.6 : -0.6);
    const h = handPos(p, a, 6);
    drawHeld(r, p, 'w_thorn_whip_handle', a, 4);
    const hx = h.x + Math.cos(a) * 5;
    const hy = h.y + Math.sin(a) * 4;
    // the lash: an S-wave that unrolls to full length and snaps back
    let len: number;
    let amp: number;
    if (t >= 0 && t < 1) {
      len = (st.mem.whipR ?? 60) * (t < 0.35 ? t / 0.35 : 1 - (t - 0.35) / 0.65 * 0.85);
      amp = (1 - Math.min(1, t * 2.5)) * 7 * (st.mem.whipDir ?? 1);
    } else {
      len = 9;
      amp = 2;
    }
    const n = 10;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    let px = hx;
    let py = hy;
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const wave = Math.sin(k * Math.PI * 1.5 + w.time * 4) * amp * k + (t < 0 || t >= 1 ? k * k * 6 : 0);
      const x = hx + c * len * k - sn * wave;
      const y = hy + sn * len * k * 0.8 + c * wave + (t < 0 || t >= 1 ? k * 5 : 0);
      pixLine(r, px, py, x, y, i % 3 === 0 ? '#90d070' : '#4a8a3a');
      px = x;
      py = y;
    }
    if (t >= 0.25 && t < 0.5) {
      r.rect(Math.round(px) - 1, Math.round(py) - 1, 3, 3, '#ffffff', 0.9);
    }
  },
});

// ================================================================== 지진 철퇴
defineDrawnSprite('w_quake_mace', 20, 11, (p) => {
  p.rect(0, 4, 13, 2, '#5a4a3a');
  p.rect(0, 4, 13, 1, '#8a7050');
  p.rect(1, 3, 2, 4, '#3a2a1a');
  p.circle(15.5, 5, 4.6, '#6a6a7a');
  p.circle(15, 4.5, 3, '#9a9aaa');
  p.px(14, 3, '#d8d8e8');
  // flanges
  p.rect(15, 0, 2, 1, '#c8c8d8');
  p.rect(15, 10, 2, 1, '#c8c8d8');
  p.rect(19, 4, 1, 2, '#c8c8d8');
  p.px(15, 5, '#ff8030');
}, { outline: O, origin: [2, 5] });

defineDrawnSprite('icon_quake_mace', 16, 16, (p) => {
  p.line(1, 15, 8, 8, '#5a4a3a');
  p.line(2, 15, 9, 8, '#8a7050');
  p.circle(10.5, 5.5, 4.5, '#6a6a7a');
  p.circle(10, 5, 3, '#9a9aaa');
  p.px(9, 4, '#d8d8e8');
  p.line(10, 0, 11, 0, '#c8c8d8');
  p.line(15, 5, 15, 6, '#c8c8d8');
  p.line(1, 11, 3, 10, '#ff8030');
  p.line(3, 13, 6, 13, '#ff8030');
}, { outline: O });

/** A line of ground eruptions marching forward from a smash (hits each enemy once). */
class Fissure extends Entity {
  angle: number;
  dmg: number;
  steps: number;
  step = 0;
  t = 0;
  hit = new Set<number>();
  constructor(x: number, y: number, angle: number, dmg: number, steps: number) {
    super();
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.dmg = dmg;
    this.steps = steps;
    this.layer = 0;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.05;
    const d = 16 + this.step * 14;
    const x = this.x + Math.cos(this.angle) * d;
    const y = this.y + Math.sin(this.angle) * d * 0.9;
    this.step++;
    const pr = tileProps(w.room.tileAt(Math.floor(x / TILE), Math.floor(y / TILE)));
    if (pr.blocksShots || this.step > this.steps) {
      this.dead = true;
      return;
    }
    const rad = 12;
    for (const e of [...w.enemies]) {
      if (!e.alive || e.hidden || e.z > 8 || this.hit.has(e.id)) continue;
      if (dist(x, y, e.x, e.y) > rad + e.r) continue;
      this.hit.add(e.id);
      strike(w, e, this.dmg, Math.cos(this.angle), Math.sin(this.angle), 120, { statuses: [{ kind: 'stun', duration: 0.4, chance: 0.25 }] });
    }
    w.particles.burst(x, y, { count: 8, speed: [30, 90], life: [0.3, 0.6], colors: ['#a09080', '#706050', '#ff9040'], size: [1, 3], gravity: 320, vz: [60, 150], shape: 'square' });
    w.particles.burst(x, y, { count: 3, speed: [5, 20], life: [0.4, 0.8], colors: ['#8a8078', '#5a5048'], size: [2, 3], sizeEnd: 5, drag: 3 });
    w.decal(x, y, '#140c0c', 5, 0.4);
    w.spawn(new RockSpike(x, y));
    w.sfx('rock_break', { vol: 0.25, pitch: 1.2 + this.step * 0.05, x });
  }
}

/** A short-lived jagged rock poking out of the floor. */
class RockSpike extends Entity {
  constructor(x: number, y: number) {
    super();
    this.x = x;
    this.y = y;
    this.layer = 1;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.age > 0.45) this.dead = true;
  }

  override draw(r: Renderer): void {
    const k = this.age < 0.08 ? this.age / 0.08 : 1 - (this.age - 0.08) / 0.37;
    const h = Math.max(0, k) * 9;
    r.rect(Math.round(this.x - 3), Math.round(this.y - h), 3, Math.ceil(h), '#7a6a5a');
    r.rect(Math.round(this.x), Math.round(this.y - h * 0.7), 3, Math.ceil(h * 0.7), '#5a4a3a');
    r.rect(Math.round(this.x - 3), Math.round(this.y - h), 1, Math.ceil(h), '#a89888');
    if (this.age < 0.1) r.rect(Math.round(this.x - 4), Math.round(this.y - 1), 8, 2, '#ff9040', 0.8);
  }
}

defineWeapon({
  id: 'quake_mace',
  name: '지진 철퇴',
  desc: '두 번 후려친 뒤 땅을 내리찍는다. 찍은 자리에서 앞으로 땅이 갈라지며 바위가 솟는다.',
  icon: 'icon_quake_mace',
  heldSprite: 'w_quake_mace',
  kind: 'melee',
  archetype: '철퇴',
  rarity: 'rare',
  pools: ['treasure', 'boss'],
  stats(m) {
    m.mulStat('damage', 1.1);
    m.mulStat('fireRate', 0.75);
    m.addStat('knockback', 30);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!attackInput(st, w, firing) || st.cooldown > 0) return;
    consumeAttack(st);
    const s = p.stats;
    const iv = attackInterval(p);
    const step = st.combo % 3;
    beginAttack(w, p, st, aim);
    const reach = 26 + s.range * 0.035;
    if (step < 2) {
      const dir = step === 0 ? 1 : -1;
      p.swing(w, { angle: aim, arc: 2.2, reach, damage: s.damage * 1.2, knockback: s.knockback * 2.4, swingDir: dir, color: '#d8d0c0', visual: 0.18, duration: 0.08, hitKick: 2 });
      startSwingPose(st, w, aim - 1.4 * dir, aim + 1.3 * dir, 0.07, 0.06);
      st.cooldown = iv * 0.85;
      kick(w, aim, 1.4);
      w.sfx('swing_heavy', { vol: 0.55, pitch: 1.2 + step * 0.1 });
    } else {
      const side = Math.cos(aim) >= 0 ? 1 : -1;
      p.swing(w, { angle: aim, arc: 1.6, reach: reach * 0.9, damage: s.damage * 1.6, knockback: s.knockback * 3, color: '#ffb070', visual: 0.14, duration: 0.07, style: 'none', hitKick: 2.5 });
      startSwingPose(st, w, aim - side * 2.4, aim + side * 0.2, 0.08, 0.16);
      const ix = p.x + Math.cos(aim) * 14;
      const iy = p.y + Math.sin(aim) * 11;
      w.spawn(new Fissure(p.x, p.y, aim, s.damage * 0.8, 5 + Math.floor(s.range / 120)));
      w.particles.burst(ix, iy, { count: 14, speed: [40, 130], life: [0.3, 0.6], colors: ['#a09080', '#706050', '#d8c8b0'], size: [1, 3], gravity: 300, vz: [40, 120], shape: 'square' });
      w.decal(ix, iy, '#14100c', 6, 0.45);
      st.cooldown = iv * 1.4;
      w.shake(0.3);
      w.hitstop(0.04);
      kick(w, aim, 2.8);
      w.sfx('slam', { vol: 0.8, pitch: 1.1 });
    }
    st.combo = (step + 1) % 3;
    st.comboTimer = st.cooldown + 0.5;
  },
  draw(w, p, r, st) {
    const pose = swingPose(st, w, meleeRest(st, p.aim));
    drawHeld(r, p, 'w_quake_mace', pose.angle, pose.phase === 1 ? 4 : 2, { flash: pose.phase === 1 ? 0.4 : 0 });
  },
});
