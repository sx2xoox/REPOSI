import { visualHandPos } from '../../game/weapon-pose';
import { multishotShare } from '../../game/stats';
// Staves:
//  수정 연사 지팡이   (crystal_gatling, epic) — spins up into a hail of crystal shards
//  프리즘 지팡이 (prism_staff, rare)     — instant rainbow beam that pierces all
//                                         and ricochets off one wall
//  용숨 지팡이   (dragon_breath, epic)   — flamethrower: a roaring stream that
//                                         leaves burning ground
//  뇌명 지팡이   (thunder_rod, epic)     — chain lightning that leaps between foes

import { defineWeapon } from '../../game/defs';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { Entity } from '../../game/entity';
import type { ProjBehavior } from '../../game/projectile';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { clamp, dist } from '../../engine/math';
import { TILE } from '../../game/constants';
import { tileProps } from '../../game/tiles';
import { O, attackInterval, drawHeld, glowSprite, handPos, kick, muzzle, rayLength, segDist } from './common';
import { FirePatch, Zap, beginAttack, enemiesOnSegment, enemyInCone, markShot, shotFade, strike } from './kit';

// ================================================================== 수정 연사 지팡이
defineDrawnSprite('w_crystal_staff', 20, 9, (p) => {
  p.rect(0, 4, 13, 1, '#5a4a6a');
  p.rect(0, 3, 13, 1, '#8a7aa0');
  p.rect(3, 3, 1, 2, '#c8b8e0');
  p.rect(12, 1, 2, 7, '#3a3050');
  p.rect(12, 1, 2, 1, '#6a5a8a');
}, { outline: O, origin: [3, 4] });

defineDrawnSprite('w_crystal_bit', 5, 3, (p) => {
  p.poly([0, 1.5, 2, 0, 5, 1.5, 2, 3], '#ff90e0');
  p.px(3, 1, '#ffffff');
}, { outline: '#3a0c30', origin: [0, 1] });

defineDrawnSprite('icon_crystal_gatling', 16, 16, (p) => {
  p.line(1, 15, 8, 8, '#5a4a6a');
  p.line(2, 15, 9, 8, '#8a7aa0');
  p.circle(9, 7, 2.2, '#3a3050');
  p.poly([9, 5, 12, 0, 13, 3], '#ff90e0');
  p.poly([11, 7, 16, 5, 13, 9], '#90e8ff');
  p.poly([9, 9, 12, 14, 8, 12], '#c0a0ff');
  p.px(12, 1, '#ffffff');
  p.px(15, 5, '#ffffff');
  p.px(11, 13, '#ffffff');
}, { outline: O });

const SHARD_COLS = ['#ff90e0', '#90e8ff', '#c0a0ff'];
for (const c of SHARD_COLS) {
  defineDrawnSprite(`proj_crystal_${c.slice(1)}`, 7, 3, (p) => {
    p.poly([0, 1.5, 3, 0, 7, 1.5, 3, 3], c);
    p.px(4, 1, '#ffffff');
    p.px(5, 1, '#ffffff');
  }, { outline: '#1c0c2a', origin: [4, 1] });
}

defineWeapon({
  id: 'crystal_gatling',
  name: '수정 연사 지팡이',
  desc: '누르고 있으면 수정 고리가 점점 빨리 돌며 수정 파편을 퍼붓는다. 돌기 시작하는 데 시간이 걸린다.',
  icon: 'icon_crystal_gatling',
  heldSprite: 'w_crystal_staff',
  kind: 'ranged',
  archetype: '연사',
  rarity: 'epic',
  tags: ['arcane'],
  pools: ['treasure', 'boss'],
  stats(m) {
    m.mulStat('damage', 0.72);
    m.mulStat('shotSpeed', 1.3);
  },
  update(w, p, st, dt, firing, aim) {
    const s = p.weaponStats;
    const spin = st.mem.spin ?? 0;
    st.mem.spin = clamp(spin + (firing ? dt / 0.9 : -dt / 0.6), 0, 1);
    st.mem.rot = (st.mem.rot ?? 0) + dt * (2 + st.mem.spin * 26);
    if (!firing) {
      st.mem.atk = 0;
      return;
    }
    // one item "attack" per fire-rate interval; the shards stream in between
    st.mem.atk = (st.mem.atk ?? 0) - dt;
    if (st.mem.atk <= 0) {
      st.mem.atk += attackInterval(p);
      beginAttack(w, p, st, aim);
      w.sfx('beam_charge', { vol: 0.12 + st.mem.spin * 0.08, pitch: 1.6 + st.mem.spin * 0.6 });
    }
    st.mem.shot = (st.mem.shot ?? 0) - dt;
    let n = 0;
    while (st.mem.shot <= 0 && n++ < 3) {
      st.mem.shot += 1 / (Math.max(0.3, s.fireRate) * (0.7 + 2.6 * st.mem.spin));
      const ci = (st.mem.ci = ((st.mem.ci ?? 0) + 1) % 3);
      const c = SHARD_COLS[ci];
      const h = handPos(p, aim, 18);
      const jitter = (w.rng.next() - 0.5) * (0.1 + 0.12 * st.mem.spin);
      p.fireProjectiles(w, aim + jitter, {
        style: 'sprite', sprite: `proj_crystal_${c.slice(1)}`, damageMult: 0.48, color: c, light: 10,
        x: h.x + Math.cos(st.mem.rot + ci * 2.1) * 1.5, y: h.y + Math.sin(st.mem.rot + ci * 2.1) * 1.5,
        radius: Math.max(2, s.projSize - 0.5), knockback: s.knockback * 0.35,
      });
      markShot(st, w);
      w.sfx('shoot', { vol: 0.16, pitch: 1.8 + w.rng.next() * 0.3 });
    }
    if (fx.chance(0.4)) {
      const m = handPos(p, aim, 19);
      muzzle(w, m.x, m.y, aim, ['#ffffff', SHARD_COLS[st.mem.ci ?? 0]], 2, [40, 100]);
    }
    w.renderer.kick(Math.cos(aim + Math.PI) * 0.35 + fx.range(-0.2, 0.2), Math.sin(aim + Math.PI) * 0.35 + fx.range(-0.2, 0.2));
  },
  onHolster(_w, _p, st) {
    // spin-up is lost when the staff is put away (no swap-cancel exploit)
    st.mem.spin = 0;
    st.mem.atk = 0;
  },
  draw(w, p, r, st) {
    const spin = st.mem.spin ?? 0;
    const rec = shotFade(st, w, 0.05);
    drawHeld(r, p, 'w_crystal_staff', p.aim, 5 - rec * 1.2 + fx.range(-0.3, 0.3) * spin);
    // three crystals orbit the head (faster with spin-up)
    const h = visualHandPos(p, p.aim, 17 - rec);
    const rot = st.mem.rot ?? 0;
    for (let i = 0; i < 3; i++) {
      const a = rot + (i / 3) * Math.PI * 2;
      const ox = -Math.sin(p.aim) * Math.cos(a) * 3.2;
      const oy = Math.cos(p.aim) * Math.cos(a) * 3.2 * 0.8;
      const front = Math.sin(a) > 0;
      r.sprite('w_crystal_bit', h.x + ox, h.y + oy, { rot: p.aim, flipY: Math.cos(p.aim) < 0, alpha: front ? 1 : 0.6, tint: SHARD_COLS[i], tintAmount: 0.4 });
    }
    if (spin > 0.05) r.sprite(glowSprite(8 + spin * 10, SHARD_COLS[Math.floor(rot) % 3]), h.x, h.y, { alpha: 0.25 + spin * 0.35, additive: true });
  },
});

// ================================================================== 프리즘 지팡이
defineDrawnSprite('w_prism_staff', 19, 9, (p) => {
  p.rect(0, 4, 12, 1, '#6a6a7a');
  p.rect(0, 3, 12, 1, '#b0b0c8');
  p.rect(10, 2, 2, 5, '#c8a040');
  p.poly([12, 4.5, 15, 0, 19, 4.5, 15, 9], '#e8f4ff');
  p.poly([13, 4.5, 15, 2, 17, 4.5, 15, 7], '#ffffff');
  p.px(14, 3, '#ff8080');
  p.px(16, 5, '#80ff9a');
  p.px(15, 6, '#80b0ff');
}, { outline: O, origin: [3, 4] });

defineDrawnSprite('icon_prism_staff', 16, 16, (p) => {
  p.line(1, 15, 8, 8, '#6a6a7a');
  p.line(2, 15, 9, 8, '#b0b0c8');
  p.poly([8, 7, 12, 1, 16, 5, 10, 10], '#e8f4ff');
  p.poly([10, 6.5, 12, 3, 14, 5, 11, 8], '#ffffff');
  p.line(0, 4, 6, 4, '#ff6060');
  p.line(0, 6, 5, 6, '#60ff80');
  p.line(1, 8, 5, 8, '#6090ff');
}, { outline: O });

const PRISM = ['#ff6070', '#ffd060', '#60ff90', '#60a0ff', '#c070ff'];

/** Short-lived rainbow beam polyline (pure visual). */
class PrismBeam extends Entity {
  pts: number[];
  width: number;
  dur = 0.18;
  constructor(pts: number[], width: number) {
    super();
    this.pts = pts;
    this.width = width;
    this.x = pts[0];
    this.y = pts[1];
    this.layer = 2;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.age >= this.dur) this.dead = true;
  }

  override draw(r: Renderer, w: World): void {
    const t = 1 - this.age / this.dur;
    const P = this.pts;
    const wd = this.width * (0.4 + 0.6 * t);
    for (let i = 0; i + 3 < P.length; i += 2) {
      const [x0, y0, x1, y1] = [P[i], P[i + 1], P[i + 2], P[i + 3]];
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      const nx = -(y1 - y0) / len;
      const ny = (x1 - x0) / len;
      // fanned spectrum on both sides of a white core
      PRISM.forEach((c, k) => {
        const off = (k - 2) * wd * 0.35 * (1 + (1 - t) * 1.5);
        r.line(x0 + nx * off, y0 + ny * off, x1 + nx * off, y1 + ny * off, c, Math.max(1, wd * 0.45), 0.75 * t);
      });
      r.line(x0, y0, x1, y1, '#ffffff', Math.max(1, wd * 0.5), t);
    }
    const last = P.length - 2;
    r.sprite(glowSprite(10 + this.width * 2, PRISM[Math.floor(w.time * 20) % 5]), P[last], P[last + 1], { alpha: t * 0.7, additive: true });
  }

  override light(w: World): void {
    const P = this.pts;
    for (let i = 0; i + 1 < P.length; i += 2) w.lights.add(P[i], P[i + 1], 30, '#e8f4ff', { intensity: 0.6 * (1 - this.age / this.dur) });
  }
}

/** Reflect a beam off the wall at the end of a segment (axis test on the hit tile). */
function reflect(w: World, x: number, y: number, a: number): number {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const blocked = (px: number, py: number) => tileProps(w.room.tileAt(Math.floor(px / TILE), Math.floor(py / TILE))).blocksShots;
  const bx = blocked(x + c * 5, y);
  const by = blocked(x, y + s * 5);
  if (bx && !by) return Math.atan2(s, -c);
  if (by && !bx) return Math.atan2(-s, c);
  return a + Math.PI;
}

defineWeapon({
  id: 'prism_staff',
  name: '프리즘 지팡이',
  desc: '순식간에 무지개 광선을 쏜다. 광선은 모든 적을 꿰뚫고 벽에 한 번 튕긴다.',
  icon: 'icon_prism_staff',
  heldSprite: 'w_prism_staff',
  kind: 'beam',
  archetype: '광선',
  rarity: 'rare',
  tags: ['arcane'],
  pools: ['treasure', 'shop', 'secret'],
  stats(m) {
    m.mulStat('damage', 1.0);
    m.mulStat('fireRate', 0.95);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.weaponStats;
    const spectral = p.flags.has('spectral');
    const width = 3 + s.projSize * 0.8;
    const count = s.shots;
    for (let k = 0; k < count; k++) {
      let a = aim + (k - (count - 1) / 2) * s.spread * 0.6;
      let o = handPos(p, aim, 17);
      let left = s.range * 1.1;
      const pts = [o.x, o.y];
      const hit = new Set<number>();
      for (let seg = 0; seg < 2 + s.bounce && left > 4; seg++) {
        const len = rayLength(w, o.x, o.y, a, left, spectral);
        const reachedEnd = len >= left - 0.5;
        const ex = o.x + Math.cos(a) * len;
        const ey = o.y + Math.sin(a) * len;
        pts.push(ex, ey);
        for (const e of enemiesOnSegment(w, o.x, o.y, ex, ey, width)) {
          if (hit.has(e.id)) continue;
          hit.add(e.id);
          strike(w, e, s.damage * multishotShare(count), Math.cos(a), Math.sin(a), s.knockback * 0.6, { kind: 'laser' });
        }
        for (const h of [...w.hittables]) if (segDist(h.x, h.y, o.x, o.y, ex, ey).d < h.r + width / 2) h.takeHit(w, { damage: s.damage, kind: 'laser', attacker: p });
        left -= len;
        if (reachedEnd) break; // full range without touching a wall
        a = reflect(w, ex, ey, a);
        o = { x: ex + Math.cos(a) * 2, y: ey + Math.sin(a) * 2 };
        w.particles.burst(ex, ey, { count: 5, speed: [30, 90], life: [0.1, 0.25], colors: PRISM, size: [1, 2], shape: 'spark' });
      }
      w.spawn(new PrismBeam(pts, width));
    }
    const h = handPos(p, aim, 17);
    muzzle(w, h.x, h.y, aim, ['#ffffff', ...PRISM], 7, [40, 120]);
    kick(w, aim + Math.PI, 1.2);
    w.sfx('laser', { vol: 0.45, pitch: 1.4 + w.rng.next() * 0.1 });
  },
  draw(w, p, r, st) {
    const f = shotFade(st, w, 0.14);
    drawHeld(r, p, 'w_prism_staff', p.aim, 5 - f * 2, { flash: f * 0.5 });
    const h = visualHandPos(p, p.aim, 16 - f * 2);
    r.sprite(glowSprite(8 + f * 8, PRISM[Math.floor(w.time * 6) % 5]), h.x, h.y, { alpha: 0.3 + f * 0.4, additive: true });
  },
});

// ================================================================== 용숨 지팡이
defineDrawnSprite('w_dragon_breath', 21, 11, (p) => {
  p.rect(0, 6, 5, 4, '#4a2a1a');
  p.rect(3, 3, 11, 5, '#7a2a1a');
  p.rect(3, 3, 11, 1, '#b84a2a');
  // fuel bulb
  p.circle(7, 2, 2.2, '#ffb040');
  p.px(6, 1, '#fff0a0');
  // dragon-head nozzle
  p.poly([13, 2, 19, 3, 21, 5.5, 19, 8, 13, 8], '#5a5a6a');
  p.poly([14, 3, 18, 3.5, 19, 5, 14, 5], '#8a8aa0');
  p.px(16, 4, '#ff4020');
  p.rect(19, 5, 2, 2, '#1a1010');
}, { outline: O, origin: [2, 7] });

defineDrawnSprite('icon_dragon_breath', 16, 16, (p) => {
  p.poly([1, 12, 8, 6, 11, 9, 4, 15], '#7a2a1a');
  p.line(2, 12, 8, 7, '#b84a2a');
  p.circle(6, 7, 2.2, '#ffb040');
  p.poly([8, 5, 12, 2, 14, 4, 11, 9], '#5a5a6a');
  p.px(11, 4, '#ff4020');
  p.circle(14, 2, 2, '#ffe080');
  p.circle(15.5, 5, 1.4, '#ff9a30');
  p.px(13, 0, '#ff7020');
}, { outline: O });

const BREATH = ['#ffffff', '#fff4b0', '#ffd050', '#ff9a28', '#f06018', '#b83010', '#4a2420'];

const breathFx: ProjBehavior = {
  id: 'dragon_breath',
  draw(pr, r) {
    const k = Math.min(1, pr.traveled / Math.max(1, pr.range));
    const ci = Math.min(BREATH.length - 1, 1 + Math.floor(k * (BREATH.length - 1)));
    const size = 5 + k * 12 + pr.r;
    const flick = 1 + 0.18 * Math.sin(pr.age * 47 + pr.id);
    r.sprite(glowSprite(size * 1.6 * flick, BREATH[Math.min(ci + 1, BREATH.length - 1)]), pr.x, pr.y - pr.z, { alpha: 0.32 * (1 - k * 0.5), additive: true });
    r.sprite(glowSprite(size * flick, BREATH[ci]), pr.x, pr.y - pr.z, { alpha: 0.9 - k * 0.45 });
  },
  onHit(_pr, _w, target) {
    target.flash = Math.min(target.flash, 0.03);
  },
  onExpire(pr, w) {
    if (pr.mem.patch && !pr.mem.wall) w.spawn(new FirePatch(pr.x, pr.y, 9 + pr.r, pr.damage * 0.9, 1.7));
  },
  onWall(pr) {
    pr.mem.wall = 1;
    return false;
  },
};

defineWeapon({
  id: 'dragon_breath',
  name: '용숨 지팡이',
  desc: '적을 꿰뚫는 불길과 바닥의 불씨로 태운다. 탄환 수가 늘면 불길도 여러 갈래로 퍼진다.',
  icon: 'icon_dragon_breath',
  heldSprite: 'w_dragon_breath',
  kind: 'ranged',
  archetype: '화염 방사',
  rarity: 'epic',
  tags: ['arcane'],
  pools: ['treasure', 'boss'],
  stats(m) {
    m.mulStat('damage', 0.6);
  },
  update(w, p, st, dt, firing, aim) {
    if (!firing) {
      st.mem.atk = 0;
      st.mem.on = 0;
      return;
    }
    const s = p.weaponStats;
    if (!st.mem.on) {
      st.mem.on = 1;
      w.sfx('fire', { vol: 0.5, pitch: 0.7 });
    }
    st.mem.atk = (st.mem.atk ?? 0) - dt;
    if (st.mem.atk <= 0) {
      st.mem.atk += attackInterval(p);
      beginAttack(w, p, st, aim);
      w.sfx('fire', { vol: 0.4, pitch: 0.75 + fx.range(-0.08, 0.08) });
    }
    st.mem.puff = (st.mem.puff ?? 0) - dt;
    let n = 0;
    while (st.mem.puff <= 0 && n++ < 3) {
      st.mem.puff += 1 / (15 * (s.fireRate / 2.6));
      st.mem.pc = ((st.mem.pc ?? 0) + 1) % 5;
      const a = aim + (w.rng.next() - 0.5) * 0.34;
      const h = handPos(p, aim, 20);
      const shots = p.fireProjectiles(w, a, {
        count: s.shots, style: 'none', speed: 190 + w.rng.next() * 60, accel: -230, minSpeed: 45, range: 90 + s.range * 0.18,
        damageMult: 0.27 * multishotShare(s.shots), pierce: s.pierce + 3, radius: s.projSize + 2, knockback: 16, light: 18, color: '#ff9a30',
        statuses: [{ kind: 'burn', duration: 2.5, power: s.damage * 0.45, chance: 0.4 }], behaviors: [breathFx], x: h.x, y: h.y,
      });
      if (st.mem.pc === 0) for (const pr of shots) pr.mem.patch = 1;
    }
    markShot(st, w);
    p.recoil = 0.8;
    w.renderer.kick(fx.range(-0.35, 0.35), fx.range(-0.35, 0.35));
  },
  draw(w, p, r, st) {
    const on = !!st.mem.on && w.time - p.lastAttackAt < 0.1;
    drawHeld(r, p, 'w_dragon_breath', p.aim, 5 - p.recoil + (on ? fx.range(-0.4, 0.4) : 0));
    const h = visualHandPos(p, p.aim, 20);
    const fl = 1 + 0.25 * Math.sin(w.time * 29) + (on ? 0.6 : 0);
    r.sprite(glowSprite(7 * fl, '#ff7a20'), h.x, h.y, { alpha: on ? 0.7 : 0.35, additive: true });
  },
});

// ================================================================== 뇌명 지팡이
defineDrawnSprite('w_thunder_rod', 19, 9, (p) => {
  p.rect(0, 4, 12, 1, '#3a3a5a');
  p.rect(0, 3, 12, 1, '#6a6a9a');
  p.rect(4, 3, 1, 2, '#c8a040');
  p.rect(8, 3, 1, 2, '#c8a040');
  // forked tines with a spark between
  p.line(12, 4, 18, 0, '#c8d0e4');
  p.line(12, 4, 18, 8, '#c8d0e4');
  p.line(12, 4, 17, 4, '#8a92ac');
  p.px(18, 4, '#ffffff');
  p.px(17, 3, '#8ad8ff');
  p.px(17, 5, '#8ad8ff');
}, { outline: O, origin: [3, 4] });

defineDrawnSprite('icon_thunder_rod', 16, 16, (p) => {
  p.line(1, 15, 8, 8, '#3a3a5a');
  p.line(2, 15, 9, 8, '#6a6a9a');
  p.line(8, 8, 11, 1, '#c8d0e4');
  p.line(8, 8, 15, 5, '#c8d0e4');
  p.poly([12, 2, 15, 1, 13, 5, 16, 5, 11, 11, 12, 6, 10, 6], '#ffe860');
  p.px(13, 4, '#ffffff');
}, { outline: O });

/** Damage multiplier of the k-th jump of a chain (exported for tests). */
export function chainFalloff(k: number): number {
  return Math.pow(0.72, k);
}

defineWeapon({
  id: 'thunder_rod',
  name: '뇌명 지팡이',
  desc: '조준한 곳의 적에게 벼락을 내리꽂는다. 벼락은 근처의 적에게 줄줄이 옮겨붙는다.',
  icon: 'icon_thunder_rod',
  heldSprite: 'w_thunder_rod',
  kind: 'beam',
  archetype: '연쇄 번개',
  rarity: 'epic',
  tags: ['arcane'],
  pools: ['treasure', 'boss', 'secret'],
  stats(m) {
    m.mulStat('damage', 1.05);
    m.mulStat('fireRate', 0.9);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.weaponStats;
    const o = handPos(p, aim, 17);
    const reach = s.range * 0.75;
    let target = enemyInCone(w, o.x, o.y, aim, 0.55, reach);
    if (!target) {
      // nothing in reach: the bolt crackles into the air (or the wall)
      const len = Math.min(reach * 0.6, rayLength(w, o.x, o.y, aim, reach * 0.6));
      w.spawn(new Zap(o.x, o.y, o.x + Math.cos(aim) * len, o.y + Math.sin(aim) * len, '#8ad8ff', '#ffffff', 0.12, 4));
      w.sfx('lightning', { vol: 0.3, pitch: 1.5 });
      return;
    }
    const hit = new Set<number>();
    let fx0 = o.x;
    let fy0 = o.y;
    const jumps = 3 + Math.max(0, s.shots - 1) + Math.floor(s.pierce / 2);
    for (let k = 0; k <= jumps && target; k++) {
      hit.add(target.id);
      const tx = target.x;
      const ty = target.y - target.z - 4;
      w.spawn(new Zap(fx0, fy0, tx, ty, k === 0 ? '#8ad8ff' : '#6ab0ff', '#ffffff', 0.16 + k * 0.02, 5));
      const d = Math.hypot(tx - fx0, ty - fy0) || 1;
      strike(w, target, s.damage * chainFalloff(k), (tx - fx0) / d, (ty - fy0) / d, 40, { kind: 'laser', statuses: [{ kind: 'stun', duration: 0.35, chance: 0.08 }] });
      w.particles.burst(tx, ty, { count: 6, speed: [40, 110], life: [0.1, 0.25], colors: ['#ffffff', '#8ad8ff'], size: [1, 2], shape: 'spark', additive: true });
      fx0 = tx;
      fy0 = ty;
      // next: the nearest unhit enemy within leaping distance
      let best = null;
      let bd = 78 + s.range * 0.05;
      for (const e of w.enemies) {
        if (!e.alive || e.hidden || hit.has(e.id)) continue;
        const dd = dist(target.x, target.y, e.x, e.y);
        if (dd < bd) {
          bd = dd;
          best = e;
        }
      }
      target = best;
    }
    w.lights.glow(o.x, o.y, 60, '#8ad8ff', 0.5);
    kick(w, aim + Math.PI, 1);
    w.shake(0.06);
    w.sfx('lightning', { vol: 0.55, pitch: 1.1 + w.rng.next() * 0.2 });
  },
  draw(w, p, r, st) {
    const f = shotFade(st, w, 0.16);
    drawHeld(r, p, 'w_thunder_rod', p.aim, 5 - f * 2, { flash: f * 0.6 });
    const h = visualHandPos(p, p.aim, 18);
    if (fx.chance(0.25 + f)) r.rect(Math.round(h.x + fx.range(-2, 2)), Math.round(h.y + fx.range(-2, 2)), 1, 1, '#ffffff');
    r.sprite(glowSprite(6 + f * 10 + Math.sin(w.time * 17), '#8ad8ff'), h.x, h.y, { alpha: 0.4 + f * 0.4, additive: true });
  },
});
