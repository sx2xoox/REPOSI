// Trap arms I (things that wait or pull; see also trap-arms-2.ts):
//  지뢰 등잔     (mine_lantern, rare)   — lobs small lantern-mines onto the floor;
//                                       they arm, then burst when an enemy comes
//                                       close (or on their own after a while)
//  중력 구슬   (gravity_orb, rare)    — a slow dark orb stops on a hit or at the
//                                       aimed spot, drags enemies in, then implodes

import { defineWeapon, type WeaponState } from '../../game/defs';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import { Entity } from '../../game/entity';
import type { Projectile, ProjBehavior } from '../../game/projectile';
import { RingFx } from '../../game/effects';
import { defineDrawnSprite } from '../../engine/sprites';
import { TAU, clamp } from '../../engine/math';
import { fx } from '../../engine/rng';
import { visualHandPos } from '../../game/weapon-pose';
import { O, attackInterval, glowSprite, handPos, kick, muzzle, rayLength } from './common';
import { aimDistance, beginAttack, drawGun, shotFade } from './kit';
import { OwnedList, heldSpriteOf, ownedBlast, pullToward } from './frontier-kit';

// ================================================================== 지뢰 등잔
defineDrawnSprite('w_mine_lantern', 11, 12, (p) => {
  // carrying ring, iron cap, amber glass, squat iron base with studs
  p.ring(5.5, 1.5, 1.4, 1, '#8a92a8');
  p.rect(3, 3, 5, 1, '#6a7080');
  p.rect(2, 4, 7, 1, '#4a5060');
  p.px(3, 3, '#b0b8cc');
  p.rect(2, 5, 7, 3, '#ffb040');
  p.rect(3, 5, 5, 2, '#ffe080');
  p.px(4, 5, '#ffffff');
  p.rect(2, 5, 1, 3, '#4a5060');
  p.rect(8, 5, 1, 3, '#4a5060');
  p.rect(1, 8, 9, 2, '#3a404c');
  p.rect(1, 8, 9, 1, '#6a7080');
  p.px(2, 9, '#c8a040');
  p.px(5, 9, '#c8a040');
  p.px(8, 9, '#c8a040');
}, { outline: O, origin: [5, 2] });

defineDrawnSprite('mine_lantern_body', 13, 10, (p) => {
  // the placed mine: a squat iron dome on a studded base plate, an amber glass eye on top
  p.rect(1, 7, 11, 2, '#3a404c');
  p.rect(1, 7, 11, 1, '#6a7080');
  p.rect(2, 6, 9, 1, '#4a5060');
  p.rect(3, 5, 7, 1, '#5a6274');
  p.rect(4, 4, 5, 1, '#8a92a8');
  p.px(3, 5, '#8a92a8');
  p.rect(5, 2, 3, 2, '#ffb040');
  p.px(5, 2, '#ffe080');
  p.px(7, 3, '#c86a20');
  p.px(4, 3, '#4a5060');
  p.px(8, 3, '#4a5060');
  p.px(2, 8, '#c8a040');
  p.px(6, 8, '#c8a040');
  p.px(10, 8, '#c8a040');
}, { outline: O, origin: [6, 7] });

defineDrawnSprite('icon_mine_lantern', 16, 16, (p) => {
  p.rect(2, 10, 12, 3, '#3a404c');
  p.rect(2, 10, 12, 1, '#6a7080');
  p.rect(4, 7, 8, 3, '#4a5060');
  p.rect(4, 7, 8, 1, '#8a92a8');
  p.circle(8, 6, 3, '#ffb040');
  p.circle(7.5, 5.5, 1.6, '#ffe080');
  p.px(7, 5, '#ffffff');
  p.px(3, 11, '#c8a040'); p.px(8, 11, '#c8a040'); p.px(12, 11, '#c8a040');
  // blinking spark above
  p.px(12, 1, '#ff5040'); p.px(13, 2, '#ffd070'); p.px(11, 2, '#ffd070'); p.px(12, 3, '#ff9040');
}, { outline: O });

/** Mine timings and sizes (exported for tests). */
export const MINE_ARM = 0.35;
export const MINE_LIFE = 6;
export const MINE_TRIGGER = 22;
export const MINE_BLAST = 30;
export const MINE_MULT = 1.6;
export const MINE_MAX = 3;
/** Farthest throw for a range stat. */
export function mineRange(range: number): number {
  return clamp(range * 0.62, 80, 170);
}

/** A placed lantern-mine: arms, then bursts on proximity or after `MINE_LIFE`. Never hurts a keeper. */
export class LanternMine extends Entity {
  owner: Player;
  dmg: number;
  blastR: number;
  armed = false;
  constructor(owner: Player, x: number, y: number, dmg: number, blastR: number) {
    super();
    this.owner = owner;
    this.x = x;
    this.y = y;
    this.dmg = dmg;
    this.blastR = blastR;
    this.layer = 0;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (!this.armed && this.age >= MINE_ARM) {
      this.armed = true;
      w.sfx('clock_tick', { vol: 0.35, pitch: 1.7, x: this.x });
      w.spawn(new RingFx(this.x, this.y, MINE_TRIGGER, 0.22, '#ffb040', 1));
    }
    if (this.armed) {
      for (const e of w.enemies) {
        if (!e.alive || e.hidden || e.z > 18) continue;
        if (Math.hypot(e.x - this.x, e.y - this.y) <= MINE_TRIGGER + e.r) {
          this.detonate(w);
          return;
        }
      }
    }
    if (this.age >= MINE_LIFE) this.detonate(w);
  }

  detonate(w: World): void {
    if (this.dead) return;
    this.dead = true;
    ownedBlast(w, this.owner, 'mine_lantern', this.x, this.y, this.blastR, this.dmg, { falloff: 0.4, knockback: 230 });
    w.particles.burst(this.x, this.y - 3, { count: 18, speed: [40, 170], life: [0.18, 0.4], colors: ['#ffffff', '#ffe080', '#ff9a30'], size: [1, 3], sizeEnd: 0.5, additive: true, light: 6 });
    w.particles.burst(this.x, this.y, { count: 7, speed: [10, 40], life: [0.4, 0.9], colors: ['#504040', '#403838'], size: [2, 4], sizeEnd: 6, drag: 3, fade: true });
    w.particles.burst(this.x, this.y, { count: 6, speed: [40, 120], life: [0.3, 0.6], colors: ['#6a7080', '#3a404c'], size: [1, 2], gravity: 320, vz: [60, 140], shape: 'square' });
    w.spawn(new RingFx(this.x, this.y, this.blastR, 0.24, '#ffd070', 2));
    w.lights.glow(this.x, this.y, this.blastR * 1.8, '#ff9a40', 0.6);
    w.decal(this.x, this.y, '#140c0c', this.blastR * 0.35, 0.35);
    w.shake(0.14);
    w.sfx('explosion', { vol: 0.42, pitch: 1.35, x: this.x });
  }

  override draw(r: Renderer, w: World): void {
    const blink = this.armed && Math.floor(this.age * (this.age > MINE_LIFE - 1.2 ? 10 : 3)) % 2 === 0;
    r.shadow(this.x, this.y + 1, 10, 3, 0.3);
    if (this.armed) r.pixelRing(this.x, this.y, MINE_TRIGGER, '#ffb040', 1, 0.12 + (blink ? 0.08 : 0));
    r.sprite('mine_lantern_body', this.x, this.y, { flash: blink ? 0.25 : 0 });
    const gx = this.x;
    const gy = this.y - 3;
    r.sprite(glowSprite(blink ? 12 : 8, this.armed ? '#ff7a30' : '#ffb040'), gx, gy, { alpha: this.armed ? (blink ? 0.85 : 0.45) : 0.3 + 0.2 * Math.sin(w.time * 20), additive: true });
    if (blink) r.rect(gx - 1, gy - 1, 2, 2, '#fff0c0');
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 3, this.armed ? 26 : 16, '#ffa040', { intensity: this.armed ? 0.55 : 0.3 });
  }
}

const MINES = new OwnedList<LanternMine>();

function mineLob(p: Player, st: WeaponState, flight: number, blastR: number, cap: number): ProjBehavior {
  return {
    id: 'mine_lob',
    update(pr, w, dt) {
      const k = clamp(pr.traveled / Math.max(1, flight), 0, 1);
      pr.z = 4 + 4 * 22 * k * (1 - k);
      pr.mem.spin = (pr.mem.spin ?? 0) + dt * 9;
      for (const e of w.enemies) pr.hitIds.add(e.id);
      for (const h of w.hittables) pr.hitIds.add(h.id);
      if (k >= 1 && !pr.mem.landed) land(pr, w);
    },
    onWall(pr, w) {
      if (!pr.mem.landed) {
        pr.x -= pr.vx * w.dt;
        pr.y -= pr.vy * w.dt;
        land(pr, w);
      }
      return false;
    },
    onExpire(pr, w) {
      if (!pr.mem.landed) land(pr, w);
    },
    draw(pr, r) {
      r.shadow(pr.x, pr.y + 1, 8, 2, 0.3);
      r.sprite('mine_lantern_body', pr.x, pr.y - pr.z, { rot: Math.sin(pr.mem.spin ?? 0) * 0.5 });
    },
  };
  function land(pr: Projectile, w: World): void {
    pr.mem.landed = 1;
    pr.dead = true;
    const at = w.room.nearestFree(pr.x, pr.y, 4);
    // the blast scales from the thrown mine's damage (item shot modifiers carry over)
    const mine = new LanternMine(p, at.x, at.y, pr.damage * MINE_MULT, blastR);
    // the oldest mine pops when one too many is placed
    const live = MINES.live(w, st);
    while (live.length >= cap) {
      const old = live.shift()!;
      MINES.remove(st, old);
      old.detonate(w);
    }
    w.spawn(mine);
    MINES.add(w, st, mine);
    w.particles.burst(at.x, at.y, { count: 5, speed: [15, 40], life: [0.2, 0.35], colors: ['#a09080', '#706050'], size: [1, 2] });
    w.sfx('bomb_place', { vol: 0.35, pitch: 1.3, x: at.x });
  }
}

defineWeapon({
  id: 'mine_lantern',
  name: '지뢰 등잔',
  desc: '조준한 바닥에 작은 등잔 지뢰를 던진다. 지뢰는 잠시 뒤 깜빡이며 장전되고, 적이 다가오면 터진다. 셋까지 깔리며 넷째를 놓으면 가장 오래된 것이 터진다.',
  icon: 'icon_mine_lantern',
  heldSprite: 'w_mine_lantern',
  kind: 'ranged',
  archetype: '지뢰',
  rarity: 'rare',
  tags: ['explosive'],
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('fireRate', 0.6);
  },
  update(w, p, st, _dt, firing, aim) {
    MINES.live(w, st);
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.weaponStats;
    const max = mineRange(s.range);
    let d = aimDistance(w, p, 24, max, max * 0.55);
    d = Math.max(12, Math.min(d, rayLength(w, p.x, p.y - 4, aim, d) - 4));
    const h = handPos(p, aim, 7);
    const n = Math.max(1, Math.floor(s.shots));
    const blastR = MINE_BLAST + (s.projSize - 3) * 2;
    p.fireProjectiles(w, aim, {
      style: 'none', x: h.x, y: h.y, speed: Math.max(160, d / 0.3), range: d + 30, life: 2, pierce: 999, bounce: 0, homing: 0,
      radius: 2, knockback: 0, color: '#ffb040', light: 8, spreadMult: 1.4,
      behaviors: [mineLob(p, st, Math.max(8, d - 7), blastR, MINE_MAX + n - 1)],
    });
    kick(w, aim, 0.5);
    w.sfx('whoosh', { vol: 0.35, pitch: 1.25 });
    w.sfx('clock_spring', { vol: 0.15, pitch: 1.8 });
  },
  draw(w, p, r, st) {
    // the next mine swings in the hand like a little lantern
    const f = shotFade(st, w, 0.3);
    if (f > 0.6) return;
    const h = visualHandPos(p, p.aim, 6 - f * 4);
    const sway = Math.sin(w.time * 4 + p.id) * 0.12 - p.vx * 0.004;
    r.sprite(glowSprite(10, '#ffb040'), h.x, h.y + 5, { alpha: 0.3, additive: true });
    r.sprite(heldSpriteOf('mine_lantern', 'w_mine_lantern'), h.x, h.y - 1, { rot: sway, alpha: 1 - f });
  },
});

// ================================================================== 중력 구슬
defineDrawnSprite('w_gravity_orb', 22, 11, (p) => {
  // dark iron launcher with violet bands, a loaded orb in the cradle
  p.rect(1, 5, 6, 2, '#4a4060');
  p.rect(1, 5, 6, 1, '#7a6a9a');
  p.rect(3, 7, 2, 2, '#2e2840');
  p.rect(6, 3, 10, 5, '#3e3654');
  p.rect(6, 3, 10, 1, '#8a7aaa');
  p.rect(6, 7, 10, 1, '#2a2438');
  p.rect(8, 3, 1, 5, '#a070ff');
  p.rect(12, 3, 1, 5, '#a070ff');
  p.px(8, 3, '#e0c8ff');
  p.px(12, 3, '#e0c8ff');
  p.rect(16, 2, 2, 7, '#4a4060');
  p.px(16, 2, '#8a7aaa');
  p.circle(18.5, 5.5, 2.4, '#1a1028');
  p.px(18, 4, '#c8a0ff');
  p.px(19, 6, '#7a4ae0');
}, { outline: O, origin: [3, 6] });

defineDrawnSprite('proj_gravity_orb', 11, 11, (p) => {
  p.circle(5.5, 5.5, 4.6, '#7a4ae0');
  p.circle(5.5, 5.5, 3.6, '#2a1844');
  p.circle(5.5, 5.5, 2.2, '#0c0614');
  p.px(3, 3, '#e8d0ff');
  p.px(4, 2, '#c8a0ff');
  p.px(8, 7, '#b080ff');
}, { outline: '#06030c' });

defineDrawnSprite('icon_gravity_orb', 16, 16, (p) => {
  p.line(1, 14, 7, 8, '#3a3448');
  p.line(2, 14, 8, 8, '#5a5070');
  p.circle(10, 6, 5, '#7a4ae0');
  p.circle(10, 6, 3.8, '#2a1844');
  p.circle(10, 6, 2.2, '#0c0614');
  p.px(8, 4, '#e8d0ff');
  // swirl
  p.px(15, 6, '#c8a0ff'); p.px(14, 10, '#9a6aff'); p.px(10, 12, '#c8a0ff'); p.px(5, 9, '#9a6aff');
}, { outline: O });

/** Gravity orb tuning (exported for tests). */
export const GRAVITY_PULL_R = 54;
export const GRAVITY_WELL = 0.7;
export const GRAVITY_BLAST = 34;
export const GRAVITY_IMPACT = 0.5;
export const GRAVITY_MULT = 2.1;
/** Recharge after an implosion before the next orb (x attack interval). */
export const GRAVITY_RECHARGE = 0.6;
/** Pull speed (px/s) at the rim; slower close to the centre. */
export const GRAVITY_PULL_SPEED = 135;

const ORBS = new OwnedList<Projectile>();

function gravityBehavior(p: Player, st: WeaponState, stopAt: number, blastR: number): ProjBehavior {
  const well = (pr: Projectile, w: World) => {
    if (pr.mem.phase) return;
    pr.mem.phase = 1;
    pr.mem.t = 0;
    pr.speed = 0;
    pr.vx = pr.vy = 0;
    pr.homing = 0;
    w.sfx('rift', { vol: 0.35, pitch: 0.7, x: pr.x });
    w.sfx('orb', { vol: 0.3, pitch: 0.55, x: pr.x });
  };
  return {
    id: 'gravity_orb',
    update(pr, w, dt) {
      pr.mem.spin = (pr.mem.spin ?? 0) + dt * (pr.mem.phase ? 9 : 4);
      if (!pr.mem.phase) {
        if (pr.traveled >= stopAt || pr.age > 3) well(pr, w);
        return;
      }
      for (const e of w.enemies) pr.hitIds.add(e.id);
      for (const h of w.hittables) pr.hitIds.add(h.id);
      pr.speed = 0;
      pr.vx = pr.vy = 0;
      pr.mem.t = (pr.mem.t ?? 0) + dt;
      // drag everything light enough toward the centre (bosses / immovable stay put)
      const cy = pr.y;
      for (const e of w.enemies) {
        if (!e.alive || e.hidden) continue;
        const d = Math.hypot(e.x - pr.x, e.y - cy);
        if (d > GRAVITY_PULL_R + e.r || d < 3) continue;
        pullToward(e, pr.x, cy, GRAVITY_PULL_SPEED * clamp(d / 30, 0.35, 1), 6);
      }
      // swirling motes falling inward (visual)
      if (fx.chance(0.7)) {
        const a = fx.range(0, TAU);
        const rr = fx.range(GRAVITY_PULL_R * 0.6, GRAVITY_PULL_R);
        w.particles.spawn({ x: pr.x + Math.cos(a) * rr, y: cy + Math.sin(a) * rr * 0.8, vx: -Math.cos(a + 0.6) * rr * 2.2, vy: -Math.sin(a + 0.6) * rr * 1.8, life: 0.4, colors: ['#e8d0ff', '#9a6aff', '#4a2a8a'], size: 1, drag: 1.5, additive: true });
      }
      if (pr.mem.t >= GRAVITY_WELL) {
        pr.dead = true;
        // implode: motes snap to the core, then the crush bursts out
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU;
          w.particles.spawn({ x: pr.x + Math.cos(a) * blastR, y: cy + Math.sin(a) * blastR * 0.8, vx: -Math.cos(a) * blastR * 7, vy: -Math.sin(a) * blastR * 5.6, life: 0.13, colors: ['#ffffff', '#c8a0ff'], size: 1.5, additive: true });
        }
        // the crush scales from the orb's own damage (item shot modifiers carry over)
        ownedBlast(w, p, 'gravity_orb', pr.x, cy, blastR, pr.damage * (GRAVITY_MULT / GRAVITY_IMPACT), { falloff: 0.5, knockback: 90 });
        st.cooldown = Math.max(st.cooldown, attackInterval(p, GRAVITY_RECHARGE));
        w.particles.burst(pr.x, cy - 2, { count: 16, speed: [40, 150], life: [0.2, 0.45], colors: ['#ffffff', '#d8b8ff', '#7a4ae0'], size: [1, 2], additive: true, light: 6, lightColor: '#a070ff' });
        w.spawn(new RingFx(pr.x, cy, blastR, 0.22, '#b080ff', 2));
        w.lights.glow(pr.x, cy, blastR * 1.8, '#8a5aff', 0.55);
        w.renderer.screenFlash('#8060c0', 0.06);
        w.shake(0.12);
        w.sfx('explosion', { vol: 0.32, pitch: 0.7, x: pr.x });
        w.sfx('blink', { vol: 0.35, pitch: 0.6, x: pr.x });
      }
    },
    onHit(pr, w) {
      well(pr, w);
    },
    onWall(pr, w) {
      if (!pr.mem.phase) {
        pr.x -= pr.vx * w.dt;
        pr.y -= pr.vy * w.dt;
        well(pr, w);
      }
      return true;
    },
    draw(pr, r, w) {
      const ph = pr.mem.phase ?? 0;
      const t = pr.mem.t ?? 0;
      const y = pr.y - pr.z;
      if (ph) {
        const k = clamp(t / GRAVITY_WELL, 0, 1);
        const R = GRAVITY_PULL_R;
        // the pull area: a thin violet rim and streaks spiralling into the core
        r.pixelRing(pr.x, pr.y, R, '#7a4ae0', 1, 0.3 + 0.15 * k);
        for (let i = 0; i < 12; i++) {
          const f = (i / 12 + w.time * 1.5) % 1;
          const a = i * 0.5236 + f * 2.4 - w.time * 0.8;
          const rr = R * (1 - f) + 4;
          const a2 = a + 0.22;
          const r2 = Math.max(2, rr - 6);
          r.pixelLine(pr.x + Math.cos(a) * rr, pr.y + Math.sin(a) * rr, pr.x + Math.cos(a2) * r2, pr.y + Math.sin(a2) * r2, f > 0.65 ? '#e8d0ff' : '#9a6aff', 1, 0.35 + 0.55 * f);
        }
        // a darkening core that swells until the implosion
        const core = 7 + 8 * k;
        r.pixelDisc(pr.x, pr.y, core, '#0c0614', 0.55);
        r.pixelRing(pr.x, pr.y, core, '#b080ff', 1, 0.5 + 0.4 * k);
        r.sprite(glowSprite(18 + 12 * k, '#7a4ae0'), pr.x, y, { alpha: 0.5, additive: true });
        r.sprite('proj_gravity_orb', pr.x, y, { rot: pr.mem.spin ?? 0, sx: 1 + 0.35 * k, sy: 1 + 0.35 * k, flash: k > 0.85 ? (k - 0.85) * 4 : 0 });
        return;
      }
      r.shadow(pr.x, pr.y + 1, 8, 3, 0.25);
      r.sprite(glowSprite(14, '#7a4ae0'), pr.x, y, { alpha: 0.45, additive: true });
      r.sprite('proj_gravity_orb', pr.x, y, { rot: pr.mem.spin ?? 0 });
      const s = pr.mem.spin ?? 0;
      for (let i = 0; i < 3; i++) {
        const a = s * 1.6 + (i / 3) * TAU;
        r.rect(pr.x + Math.cos(a) * 7, y + Math.sin(a) * 5, 1, 1, '#d8b8ff', 0.9);
      }
    },
  };
}

defineWeapon({
  id: 'gravity_orb',
  name: '중력 구슬',
  desc: '느린 검은 구슬을 쏜다. 구슬은 적에 맞거나 조준한 자리에 닿으면 멈춰 주위 적을 끌어당기고, 잠시 뒤 안으로 무너지며 터진다. 구슬은 한 번에 하나뿐이다.',
  icon: 'icon_gravity_orb',
  heldSprite: 'w_gravity_orb',
  kind: 'ranged',
  archetype: '중력',
  rarity: 'rare',
  tags: ['arcane'],
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('shotSpeed', 0.78);
  },
  update(w, p, st, _dt, firing, aim) {
    const live = ORBS.live(w, st);
    st.mem.out = live.length;
    if (!firing || st.cooldown > 0 || live.length) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p, 0.3);
    const s = p.weaponStats;
    const max = Math.max(60, s.range * 0.8);
    const h = handPos(p, aim, 18);
    // travel is counted from the muzzle (18 px out)
    const stopAt = Math.max(10, aimDistance(w, p, 26, max, max * 0.6) - 18);
    const blastR = GRAVITY_BLAST + (s.projSize - 3) * 2;
    const shots = p.fireProjectiles(w, aim, {
      style: 'none', x: h.x, y: h.y, damageMult: GRAVITY_IMPACT, range: 99999, life: 6, pierce: 999, radius: s.projSize + 2,
      knockback: 0, color: '#9a6aff', light: 16, spreadMult: 2,
      behaviors: [gravityBehavior(p, st, stopAt, blastR)],
    });
    for (const pr of shots) ORBS.add(w, st, pr);
    st.mem.out = shots.length;
    muzzle(w, h.x, h.y, aim, ['#ffffff', '#c8a0ff', '#7a4ae0'], 5, [30, 90]);
    kick(w, aim, 0.9);
    w.sfx('orb', { vol: 0.5, pitch: 0.65 });
    w.sfx('shoot_magic', { vol: 0.25, pitch: 0.6 });
  },
  onHolster(w, _p, st) {
    for (const pr of ORBS.live(w, st)) pr.dead = true;
    st.mem.out = 0;
  },
  draw(w, p, r, st) {
    const out = ORBS.peek(w, st).length > 0;
    drawGun(r, w, p, st, heldSpriteOf('gravity_orb', 'w_gravity_orb'), 6, 3);
    if (!out) {
      const h = visualHandPos(p, p.aim, 6);
      const m = { x: h.x + Math.cos(p.aim) * 15, y: h.y + Math.sin(p.aim) * 15 * 0.8 };
      r.sprite(glowSprite(9 + Math.sin(w.time * 6), '#9a6aff'), m.x, m.y, { alpha: 0.45, additive: true });
    }
  },
});
