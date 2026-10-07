// Guild arms: workshop weapons with their own verbs.
//  거울 방패   (mirror_buckler, rare) — hold to raise a round mirror: enemy shots
//                                      striking its ~100° face fly back as the
//                                      keeper's; while raised it bashes on rhythm
//  톱날 사출기 (saw_launcher, rare)   — piercing sawblades that bite into the wall
//                                      they reach and keep grinding there
// (폭죽 통 and 뇌전 말뚝 live in guild-sparks.ts; shared helpers in arms-kit.ts.)

import { defineWeapon } from '../../game/defs';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import { Entity, type Actor } from '../../game/entity';
import type { Enemy } from '../../game/enemy';
import type { Projectile, ProjBehavior } from '../../game/projectile';
import { RingFx } from '../../game/effects';
import { defineDrawnSprite } from '../../engine/sprites';
import type { PixelPainter } from '../../engine/painter';
import { angleDiff, clamp, ease } from '../../engine/math';
import { fx } from '../../engine/rng';
import { visualHandPos } from '../../game/weapon-pose';
import { heldLocalPoint } from '../../game/weapon-presentation';
import { O, angleNorm, attackInterval, drawHeld, glowSprite, handPos, kick, muzzle, pixLine } from './common';
import { beginAttack, drawGun, enemyInCone } from './kit';
import { braceStride, heldSprite, keeperHit, ownedBy, pixelArc, trackOwned, wallFace } from './arms-kit';

// ================================================================== 거울 방패
defineDrawnSprite('w_mirror_buckler', 11, 17, (p) => {
  // leather strap behind the shield (grip on the left)
  p.rect(0, 7, 4, 3, '#5a3420');
  p.line(0, 7, 3, 7, '#8a5a34');
  // round shield seen at three-quarters: brass rim, mirror face turned to the aim
  p.ellipse(6.2, 8.5, 4.6, 8.2, '#7a5424');
  p.ellipse(6.6, 8.3, 4, 7.6, '#d8a848');
  p.ellipse(7, 8.5, 3, 6.4, '#5f86b8');
  p.shadeSphere(7, 8.5, 3, 6.4, ['#2c4472', '#4c74aa', '#86b6e2', '#cfe8ff'], { dither: true, lightX: -0.7, lightY: -0.7 });
  // sheen streaks from the top-left light
  p.line(6, 4, 7, 6, '#ffffff');
  p.px(6, 3, '#ffffff');
  p.line(8, 10, 9, 12, '#e4f4ff');
  // rim glints and the central boss
  p.px(5, 1, '#fff0b0');
  p.px(4, 2, '#fff0b0');
  p.px(10, 13, '#a07830');
  p.px(7, 8, '#fff0b0');
  p.px(8, 8, '#c89838');
}, { outline: O, origin: [1, 8] });

defineDrawnSprite('icon_mirror_buckler', 16, 16, (p) => {
  p.circle(8, 8, 7.6, '#7a5424');
  p.circle(7.8, 7.8, 6.9, '#d8a848');
  p.circle(8, 8, 5.4, '#5f86b8');
  p.shadeSphere(8, 8, 5.4, 5.4, ['#2c4472', '#4c74aa', '#86b6e2', '#cfe8ff'], { dither: true });
  // sheen
  p.line(4, 7, 7, 4, '#ffffff');
  p.line(5, 9, 6, 8, '#e8f6ff');
  p.line(10, 12, 12, 10, '#a8d0f4');
  // rivets on the rim + boss
  for (const [x, y] of [[8, 1], [14, 8], [8, 14], [1, 8]]) p.px(x, y, '#fff0b0');
  p.circle(8, 8, 1.3, '#c89838');
  p.px(7, 7, '#fff6d0');
}, { outline: O });

/** The returned shot: a bright mirror shard. */
defineDrawnSprite('proj_mirror_glint', 7, 5, (p) => {
  p.poly([0, 2.5, 3, 0, 7, 2.5, 3, 5], '#9fd8ff');
  p.poly([2, 2.5, 3.5, 1, 6, 2.5, 3.5, 4], '#ffffff');
}, { outline: '#14203a', origin: [4, 2] });

/** Half-width (radians) of the shield's frontal arc (~100° in all). */
export const MIRROR_ARC = 0.87;
/** Shield face distance from the keeper's center (px). */
export const MIRROR_REACH = 12;
/** Damage of a returned shot (x weapon damage). */
export const MIRROR_RETURN = 0.6;
/** Damage of the shield bash (x weapon damage). */
export const MIRROR_BASH = 1.32;
/** Stride while the mirror is raised (x move speed). */
export const MIRROR_STRIDE = 0.85;
/** Shots the mirror can send back per second (more are only blocked). */
export function mirrorReturnsPerSecond(shots: number): number {
  return 6 + 2 * Math.max(0, Math.floor(shots) - 1);
}

const mirrorShotFx: ProjBehavior = {
  id: 'mirror_return',
  update(pr, w) {
    if (fx.chance(0.6)) w.particles.spawn({ x: pr.x + fx.range(-1, 1), y: pr.y - pr.z + fx.range(-1, 1), life: 0.18, colors: ['#ffffff', '#bfe6ff', '#6ab0f0'], size: 1, shape: 'pixel', additive: true });
  },
  draw(pr, r) {
    r.sprite(glowSprite(10, '#9fd8ff'), pr.x, pr.y - pr.z, { alpha: 0.55, additive: true });
    r.sprite('proj_mirror_glint', pr.x, pr.y - pr.z, { rot: pr.angle });
  },
};

/** Turn an enemy bullet striking the mirror into the keeper's shot, aimed back at its shooter when possible. */
function mirrorReturn(w: World, p: Player, pr: Projectile, aim: number): void {
  const s = p.weaponStats;
  const shooter = pr.owner as Enemy | null;
  let target: Actor | null = null;
  if (shooter && shooter.team === 'enemy' && shooter.alive && !shooter.hidden && Math.abs(angleDiff(aim, Math.atan2(shooter.y - pr.y, shooter.x - pr.x))) < 1.2) target = shooter;
  target ??= enemyInCone(w, pr.x, pr.y, aim, 0.7, 260);
  const ang = target ? Math.atan2(target.y - target.z * 0.3 - pr.y, target.x - pr.x) : aim;
  pr.team = 'player';
  pr.owner = p;
  pr.damage = s.damage * MIRROR_RETURN;
  pr.angle = ang;
  pr.speed = Math.max(250, pr.speed * 1.6);
  pr.syncVel();
  // lift it clear of the face so it cannot be caught twice
  pr.x = p.x + Math.cos(aim) * (MIRROR_REACH + 3);
  pr.y = p.y - 5 + Math.sin(aim) * (MIRROR_REACH + 3) * 0.8;
  pr.traveled = 0;
  pr.range = 320;
  pr.age = 0;
  pr.life = 3;
  pr.homing = 0;
  pr.curve = 0;
  pr.accel = 0;
  pr.pierce = 0;
  pr.bounce = 0;
  pr.spectral = false;
  pr.statuses = [];
  pr.knockback = s.knockback;
  pr.color = '#bfe6ff';
  pr.lightR = 12;
  pr.style = 'none';
  pr.sprite = undefined;
  pr.hitIds.clear();
  pr.generation = Math.max(1, pr.generation);
  pr.behaviors = [mirrorShotFx];
  w.items.onDeflect(pr);
}

defineWeapon({
  id: 'mirror_buckler',
  name: '거울 방패',
  desc: '누르는 동안 거울 방패를 앞으로 든다. 정면에 닿은 적 탄환은 쏜 적에게 되돌아가고, 든 채로 주기적으로 방패를 내질러 적을 밀쳐 낸다. 드는 동안 조금 느려진다.',
  icon: 'icon_mirror_buckler',
  heldSprite: 'w_mirror_buckler',
  kind: 'melee',
  archetype: '방패',
  rarity: 'rare',
  tags: ['heavy'],
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('fireRate', 0.78);
    m.addStat('knockback', 30);
  },
  update(w, p, st, dt, firing, aim) {
    if (st.mem.room !== w.node.id) {
      st.mem.room = w.node.id;
      st.mem.raise = 0;
    }
    const s = p.weaponStats;
    const cap = mirrorReturnsPerSecond(s.shots);
    st.mem.tokens = Math.min(cap, (st.mem.tokens ?? cap) + dt * cap);
    const raise = (st.mem.raise = clamp((st.mem.raise ?? 0) + (firing ? dt * 11 : -dt * 7), 0, 1));
    if (raise < 0.5) return;
    braceStride(p, MIRROR_STRIDE, dt);
    // the mirror: enemy shots reaching the frontal arc are sent back (or blocked once the returns run out)
    const cx = p.x;
    const cy = p.y - 5;
    for (const pr of w.projectiles) {
      if (pr.dead || pr.team !== 'enemy' || pr.delay > 0) continue;
      const d = Math.hypot(pr.x - cx, pr.y - cy);
      if (d > MIRROR_REACH + 5 + pr.r || d < 2) continue;
      if (Math.abs(angleDiff(aim, Math.atan2(pr.y - cy, pr.x - cx))) > MIRROR_ARC) continue;
      const fxX = pr.x;
      const fxY = pr.y - pr.z;
      if (st.mem.tokens >= 1) {
        st.mem.tokens -= 1;
        mirrorReturn(w, p, pr, aim);
        st.mem.returnAt = w.time;
        w.particles.burst(fxX, fxY, { count: 8, speed: [40, 130], angle: aim, spread: 1.2, life: [0.1, 0.25], colors: ['#ffffff', '#cfe8ff', '#7ab4f0'], size: [1, 2], shape: 'spark', additive: true });
        w.spawn(new RingFx(fxX, fxY, 9, 0.16, '#cfe8ff', 1));
        w.sfx('parry', { vol: 0.42, pitch: 1.25 + fx.range(-0.05, 0.08) });
      } else {
        pr.expire(w, true);
        st.mem.blockAt = w.time;
        w.particles.burst(fxX, fxY, { count: 5, speed: [30, 90], life: [0.1, 0.2], colors: ['#ffffff', '#d8a848'], size: [1, 2], shape: 'spark' });
        w.sfx('shield_block', { vol: 0.3, pitch: 1.35 + fx.range(-0.1, 0.1) });
      }
    }
    // the bash: a short shove with the shield's rim on every attack beat
    if (!firing || st.cooldown > 0 || raise < 0.9) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    st.mem.bashAt = w.time;
    p.swing(w, {
      angle: aim, thrust: true, reach: 20 + s.range * 0.02, arc: 18 + 4 * Math.max(0, s.shots - 1), damage: s.damage * MIRROR_BASH,
      knockback: s.knockback * 3, deflect: false, style: 'none', duration: 0.08, visual: 0.14, hitKick: 1.4, color: '#cfe8ff',
    });
    kick(w, aim, 1.1);
    w.sfx('swing_heavy', { vol: 0.35, pitch: 1.35 + w.rng.next() * 0.1 });
    w.sfx('hit_metal', { vol: 0.16, pitch: 1.6 });
  },
  onHolster(_w, _p, st) {
    st.mem.raise = 0;
  },
  draw(w, p, r, st) {
    const raise = ease.outCubic(st.mem.raise ?? 0);
    // lowered: carried upright at the side it faces, the mirror turned outward
    const rest = Math.cos(p.aim) >= 0 ? 0.3 : Math.PI - 0.3;
    const angle = rest + angleNorm(p.aim - rest) * raise;
    const bashT = w.time - (st.mem.bashAt ?? -9);
    const push = bashT >= 0 && bashT < 0.16 ? Math.sin((bashT / 0.16) * Math.PI) * 4 : 0;
    const ret = w.time - (st.mem.returnAt ?? -9);
    const glint = ret >= 0 && ret < 0.12 ? 1 - ret / 0.12 : 0;
    const blk = w.time - (st.mem.blockAt ?? -9);
    const flash = Math.max(glint, blk >= 0 && blk < 0.08 ? 0.5 : 0);
    const dist = 3 + raise * 7 + push;
    drawHeld(r, p, heldSprite('mirror_buckler'), angle, dist, { flash: flash * 0.8 });
    if (raise < 0.55) return;
    // the guarded arc: a faint rim of light in front, brighter on a return
    const cy = p.y - 5;
    const a = p.aim;
    pixelArc(r, p.x, cy, MIRROR_REACH + 4, a - MIRROR_ARC, a + MIRROR_ARC, glint > 0 ? '#ffffff' : '#a8d4ff', (0.22 + glint * 0.6) * raise);
    // a slow glint sliding across the mirror
    const g = (w.time * 0.9) % 1;
    if (g < 0.35) {
      const h = visualHandPos(p, angle, dist);
      const q = heldLocalPoint(h.x, h.y, angle, 6, -5 + (g / 0.35) * 10);
      r.rect(Math.round(q.x), Math.round(q.y), 1, 1, '#ffffff', 0.9);
    }
    if (glint > 0) {
      const h = visualHandPos(p, angle, dist);
      const q = heldLocalPoint(h.x, h.y, angle, 6, 0);
      r.sprite(glowSprite(10 + glint * 10, '#cfe8ff'), q.x, q.y, { alpha: 0.7 * glint, additive: true });
    }
    // bash: a crescent shock off the rim
    if (bashT >= 0 && bashT < 0.14) {
      const k = bashT / 0.14;
      pixelArc(r, p.x, cy, MIRROR_REACH + 6 + k * 9, a - 0.75, a + 0.75, '#ffffff', 0.8 * (1 - k));
      pixelArc(r, p.x, cy, MIRROR_REACH + 5 + k * 9, a - 0.6, a + 0.6, '#9fd0ff', 0.6 * (1 - k));
    }
  },
});

// ================================================================== 톱날 사출기
defineDrawnSprite('w_saw_launcher', 20, 12, (p) => {
  // stock + grip
  p.rect(0, 6, 7, 3, '#6a4026');
  p.line(0, 6, 6, 6, '#9a6a40');
  p.rect(3, 9, 2, 3, '#4a2a18');
  p.px(6, 9, '#3a3a4a');
  // steel frame and launch rail
  p.rect(5, 5, 13, 3, '#4a5068');
  p.line(5, 5, 17, 5, '#9aa4b8');
  p.line(6, 7, 17, 7, '#2e3244');
  // spring housing with copper coils
  p.rect(6, 2, 6, 3, '#3a3a4a');
  for (let x = 6; x < 12; x += 2) p.line(x, 2, x, 4, '#d08a40');
  p.line(6, 2, 11, 2, '#f0b060');
  // clamp jaws at the front (the blade rides between them)
  p.rect(17, 3, 2, 7, '#3a3e50');
  p.px(17, 3, '#c8d0e4');
  p.px(18, 9, '#1c1a28');
  p.rect(19, 4, 1, 5, '#6a7284');
}, { outline: O, origin: [4, 7] });

/** A circular saw: raked teeth round a shaded steel disc with an arbor hole. */
function paintSaw(p: PixelPainter, c: number, cy: number, rDisc: number, rTip: number, n: number, rake: number): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    p.poly([
      c + Math.cos(a) * (rDisc - 0.6), cy + Math.sin(a) * (rDisc - 0.6),
      c + Math.cos(a + 0.08) * rTip, cy + Math.sin(a + 0.08) * rTip,
      c + Math.cos(a + rake) * (rDisc - 0.2), cy + Math.sin(a + rake) * (rDisc - 0.2),
    ], '#dfe6f2');
  }
  p.circle(c, cy, rDisc, '#b0bacc');
  p.shadeSphere(c, cy, rDisc + 1.5, rDisc + 1.5, ['#5a6274', '#8a94a8', '#b8c2d4', '#eef2fa'], { dither: false });
  p.ring(c, cy, rDisc - 1.4, 0.9, '#6a7488');
  p.circle(c, cy, 1.3, '#2a2436');
}

defineDrawnSprite('proj_sawblade', 13, 13, (p) => {
  paintSaw(p, 6.5, 6.5, 4.8, 6.5, 10, 0.5);
  p.px(6, 6, '#d8a848');
}, { outline: '#14101c' });

defineDrawnSprite('icon_saw_launcher', 16, 16, (p) => {
  // stocky launcher, the blade leaving its jaws
  p.poly([0, 12, 6, 7, 9, 10, 3, 15], '#4a5068');
  p.line(1, 12, 6, 8, '#9aa4b8');
  p.poly([0, 14, 2, 12, 4, 14, 2, 16], '#6a4026');
  p.rect(2, 9, 3, 2, '#3a3a4a');
  p.px(3, 9, '#d08a40');
  p.px(4, 10, '#d08a40');
  paintSaw(p, 10.5, 5.5, 4.3, 5.9, 10, 0.5);
  p.px(10, 5, '#d8a848');
  // speed lines
  p.line(3, 2, 4, 1, '#c8d0e4');
  p.line(2, 5, 3, 5, '#c8d0e4');
}, { outline: O });

/** Seconds a sawblade keeps grinding in the wall it bit into. */
export const SAW_STICK_SECONDS = 1.8;
/** Seconds between two bites of a stuck saw. */
export const SAW_TICK = 0.3;
/** Damage of a stuck saw's bite (x weapon damage). */
export const SAW_BITE = 0.4;
/** Damage of a flying saw's pass (x weapon damage). */
export const SAW_PASS = 1.0;
/** Stuck saws one keeper can keep in the walls. */
export function sawMaxStuck(shots: number): number {
  return 3 + Math.max(0, Math.floor(shots) - 1);
}

/** A sawblade bitten into a wall: keeps spinning and bites whatever touches it, then shatters. */
export class StuckSaw extends Entity {
  owner: Player;
  angle: number;
  mem: Record<string, number> = { tick: 0.05, dmg: 0, spin: 0 };
  constructor(owner: Player, x: number, y: number, angle: number, dmg: number) {
    super();
    this.owner = owner;
    this.x = x;
    this.y = y;
    this.z = 4;
    this.r = 6;
    this.angle = angle;
    this.mem.dmg = dmg;
    this.layer = 1;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const k = Math.min(1, this.age / SAW_STICK_SECONDS);
    // the spin winds down a little before it breaks
    this.mem.spin += dt * (30 - 12 * k);
    this.mem.tick -= dt;
    // the bite point sits just outside the wall face
    const bx = this.x - Math.cos(this.angle) * 3;
    const by = this.y - Math.sin(this.angle) * 3;
    if (this.mem.tick <= 0) {
      this.mem.tick += SAW_TICK;
      let bit = false;
      for (const e of [...w.enemies]) {
        if (!e.alive || e.hidden || e.z > 14) continue;
        if (Math.hypot(e.x - bx, e.y - by) > this.r + e.r) continue;
        if (keeperHit(w, this.owner, e, this.mem.dmg, { src: this, kind: 'laser', fromX: bx, fromY: by, knockback: 30, light: true })) {
          bit = true;
          w.particles.burst(e.x, e.y - e.z - 3, { count: 5, speed: [50, 140], life: [0.08, 0.2], colors: ['#ffffff', '#ffe8a0', '#c8d0e4'], size: [1, 2], shape: 'spark' });
        }
      }
      if (bit) w.sfx('hit_metal', { vol: 0.2, pitch: 1.9 + fx.range(-0.1, 0.1), x: this.x });
    }
    // grinding sparks off the wall
    if (fx.chance(dt * 22)) {
      const a = this.angle + Math.PI + fx.range(-1.1, 1.1);
      w.particles.spawn({ x: bx, y: by - this.z, vx: Math.cos(a) * fx.range(40, 110), vy: Math.sin(a) * fx.range(40, 110) - 20, life: fx.range(0.1, 0.25), colors: ['#ffffff', '#ffe080', '#ff9a30'], size: 1, shape: 'spark', gravity: 260 });
    }
    if (this.age >= SAW_STICK_SECONDS) this.shatter(w);
  }

  /** Break apart (end of its time, or pushed out by a newer saw). */
  shatter(w: World): void {
    if (this.dead) return;
    this.dead = true;
    w.particles.burst(this.x, this.y - this.z, { count: 9, speed: [40, 120], life: [0.25, 0.5], colors: ['#e8eef8', '#a8b2c4', '#5a6274'], size: [1, 2], shape: 'square', gravity: 300, vz: [30, 90] });
    w.sfx('hit_metal', { vol: 0.22, pitch: 0.85, x: this.x });
  }

  override draw(r: Renderer): void {
    const left = SAW_STICK_SECONDS - this.age;
    // blinks just before it breaks
    if (left < 0.3 && Math.floor(left * 20) % 2 === 0) return;
    const x = this.x;
    const y = this.y - this.z;
    // half the blade is buried: clip away the side inside the wall
    const ctx = r.ctx;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const sx = x - r.viewX;
    const sy = y - r.viewY;
    ctx.save();
    try {
      ctx.beginPath();
      // half-plane facing out of the wall, through a line 1 px into it
      const ox = sx + c;
      const oy = sy + s;
      ctx.moveTo(ox - s * 12, oy + c * 12);
      ctx.lineTo(ox + s * 12, oy - c * 12);
      ctx.lineTo(ox + s * 12 - c * 14, oy - c * 12 - s * 14);
      ctx.lineTo(ox - s * 12 - c * 14, oy + c * 12 - s * 14);
      ctx.closePath();
      ctx.clip();
      r.sprite('proj_sawblade', x, y, { rot: this.mem.spin });
    } finally {
      ctx.restore();
    }
    // a bright cut line where it meets the wall
    pixLine(r, x + c - s * 5, y + s + c * 5, x + c + s * 5, y + s - c * 5, '#ffe080', 0.55);
  }

  override light(w: World): void {
    w.lights.add(this.x - Math.cos(this.angle) * 3, this.y - this.z, 22, '#ffd080', { intensity: 0.45 });
  }
}

const sawFx: ProjBehavior = {
  id: 'saw_blade',
  update(pr, w, dt) {
    pr.mem.spin = (pr.mem.spin ?? 0) + dt * 34;
    // gated re-bites: a blade still inside a foe after a beat cuts again
    if (w.time >= (pr.mem.rehit ?? 0)) {
      pr.mem.rehit = w.time + SAW_TICK;
      pr.hitIds.clear();
    }
    if (fx.chance(0.35)) w.particles.spawn({ x: pr.x + fx.range(-3, 3), y: pr.y - pr.z + fx.range(-3, 3), life: 0.14, colors: ['#ffffff', '#c8d0e4'], size: 1, shape: 'pixel' });
  },
  onHit(pr, w, target) {
    // the blade bites and slows a little in flesh
    pr.speed = Math.max(140, pr.speed * 0.86);
    pr.syncVel();
    w.particles.burst(target.x, target.y - target.z - 3, { count: 6, speed: [50, 150], angle: pr.angle, spread: 1.6, life: [0.08, 0.2], colors: ['#ffffff', '#ffe8a0', '#c8d0e4'], size: [1, 2], shape: 'spark' });
    w.sfx('hit_metal', { vol: 0.22, pitch: 1.6 + fx.range(-0.1, 0.1), x: pr.x });
  },
  onWall(pr, w) {
    // a bouncing blade (bounce stat) ricochets instead of biting in
    if (pr.bounce > 0 || pr.mem.stuck) return false;
    pr.mem.stuck = 1;
    const owner = pr.owner as Player | null;
    if (!owner || owner.team !== 'player') return false;
    const face = wallFace(w, pr.x, pr.y, pr.angle);
    const c = Math.cos(pr.angle);
    const s = Math.sin(pr.angle);
    const saw = trackOwned(w, w.spawn(new StuckSaw(owner, face.x + c * 2, face.y + s * 2, pr.angle, Number(pr.mem.weaponDamage ?? owner.weaponStats.damage) * SAW_BITE)));
    // only the newest few stay: the oldest shatter
    const cap = sawMaxStuck(owner.weaponStats.shots);
    const live = ownedBy(w, StuckSaw, owner).filter((e) => e !== saw);
    for (let i = 0; i <= live.length - cap; i++) live[i].shatter(w);
    w.particles.burst(face.x, face.y - 4, { count: 10, speed: [60, 160], angle: pr.angle + Math.PI, spread: 1.4, life: [0.1, 0.3], colors: ['#ffffff', '#ffe080', '#ff9a30'], size: [1, 2], shape: 'spark', gravity: 200 });
    w.sfx('hit_metal', { vol: 0.4, pitch: 0.95, x: pr.x });
    w.sfx('rock_break', { vol: 0.12, pitch: 1.8, x: pr.x });
    return false;
  },
  onExpire(pr, w) {
    // ran out of flight in the open: it clatters to the floor
    if (pr.mem.stuck) return;
    w.particles.burst(pr.x, pr.y - 2, { count: 5, speed: [20, 60], life: [0.2, 0.4], colors: ['#e8eef8', '#a8b2c4'], size: [1, 2], shape: 'square', gravity: 300, vz: [20, 60] });
  },
  draw(pr, r) {
    r.shadow(pr.x, pr.y + 2, 9, 3, 0.25);
    r.sprite('proj_sawblade', pr.x, pr.y - pr.z, { rot: pr.mem.spin ?? 0 });
  },
};

defineWeapon({
  id: 'saw_launcher',
  name: '톱날 사출기',
  desc: '적을 꿰뚫는 톱날을 쏜다. 벽에 닿은 톱날은 박힌 채 잠시 더 돌며 닿는 적을 갈아 낸다. 박힌 톱날은 세 개까지 남는다.',
  icon: 'icon_saw_launcher',
  heldSprite: 'w_saw_launcher',
  kind: 'ranged',
  archetype: '톱날',
  rarity: 'rare',
  tags: ['heavy'],
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('fireRate', 0.72);
    m.mulStat('damage', 1.25);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.weaponStats;
    const h = handPos(p, aim, 17);
    p.fireProjectiles(w, aim, {
      style: 'none', damageMult: SAW_PASS, speed: s.shotSpeed * 0.95, radius: s.projSize + 2, pierce: 999, range: s.range * 1.6, life: 3,
      knockback: s.knockback * 0.5, color: '#c8d0e4', light: 10, x: h.x, y: h.y, behaviors: [sawFx], fxMaterial: 'metal', spreadMult: 0.8,
    });
    muzzle(w, h.x, h.y, aim, ['#ffffff', '#c8d0e4', '#ffe080'], 5, [40, 120]);
    kick(w, aim + Math.PI, 1.3);
    p.knock(-Math.cos(aim), -Math.sin(aim), 25);
    w.sfx('whoosh', { vol: 0.35, pitch: 1.6 });
    w.sfx('clock_spring', { vol: 0.3, pitch: 1.4 + w.rng.next() * 0.1 });
  },
  draw(w, p, r, st) {
    drawGun(r, w, p, st, heldSprite('saw_launcher'), 5, 2.5);
    // the next blade slides into the jaws a moment after a shot, then idles round
    const since = w.time - (st.mem.shotAt ?? -9);
    if (since < 0.16) return;
    const slide = since < 0.3 ? (0.3 - since) / 0.14 : 0;
    const h = visualHandPos(p, p.aim, 5);
    const q = heldLocalPoint(h.x, h.y, p.aim, 13 - slide * 5, -3);
    r.sprite('proj_sawblade', q.x, q.y, { rot: w.time * 5, sx: 0.7, sy: 0.7 });
  },
});
