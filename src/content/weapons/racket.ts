// 바람깃 라켓 (badminton_racket, legendary): a racket that serves shuttlecocks.
//  - A swing serves a shuttle: it leaves the strings fast, then the feathers
//    bite the air and it slows hard (drag), dropping where it runs out of speed.
//  - A shuttle that hits a foe pops high into the air and floats back toward
//    its keeper; its shadow and a closing ring mark where it will come down.
//  - Swinging while a falling shuttle is within reach smashes it instead of
//    serving: a fast, heavy, piercing shot that pops again on contact. Each
//    return in a row raises the rally and the smash grows with it. A shuttle
//    that touches the floor ends its rally.

import { defineWeapon } from '../../game/defs';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import { Entity } from '../../game/entity';
import type { Projectile, ProjBehavior } from '../../game/projectile';
import { RingFx } from '../../game/effects';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { clamp, ease } from '../../engine/math';
import { visualHandPos } from '../../game/weapon-pose';
import { O, attackInterval, glowSprite, handPos, kick, pixLine, startSwingPose, swingPose } from './common';
import { beginAttack } from './kit';
import { heldSprite, ownedBy, pixelArc, trackOwned } from './arms-kit';
import { pixelTextCanvas } from '../rooms/floortext';

// ------------------------------------------------------------------ art
defineDrawnSprite('w_badminton_racket', 27, 13, (p) => {
  // grip: navy wrap with a white tape spiral, a pale butt cap
  p.rect(1, 5, 2, 3, '#e8e4dc');
  p.rect(3, 5, 7, 3, '#28306a');
  p.line(3, 5, 9, 5, '#4a5aaa');
  for (let x = 4; x < 10; x += 2) p.px(x, 6, '#e8e8f4');
  // shaft: thin steel, a gold collar at the throat
  p.rect(10, 6, 5, 1, '#c8ccd8');
  p.px(10, 5, '#e0b850');
  p.px(10, 7, '#a07a30');
  // throat: a small V into the frame
  p.px(15, 5, '#c8ccd8');
  p.px(15, 7, '#c8ccd8');
  // head: an oval hoop (longer along the shaft) strung in a crosshatch
  const cx = 20.5;
  const cy = 6.5;
  for (let y = 1; y < 12; y++) for (let x = 15; x < 26; x++) {
    const dx = (x + 0.5 - cx) / 5.4;
    const dy = (y + 0.5 - cy) / 4.6;
    if (dx * dx + dy * dy > 1) continue;
    const ix = (x + 0.5 - cx) / 4.2;
    const iy = (y + 0.5 - cy) / 3.4;
    if (ix * ix + iy * iy > 1) p.px(x, y, y < cy ? '#e04048' : '#a82830');
    else p.px(x, y, x % 2 === 0 || y % 2 === 1 ? '#e8eef8' : '#232838');
  }
  // bumper highlight on the top of the hoop
  p.px(18, 2, '#ff8a8a');
  p.px(19, 2, '#ffd0d0');
  p.px(20, 2, '#ff8a8a');
}, { outline: O, origin: [4, 6] });

/** The shuttlecock, cork forward (to the right); pivot at its middle. */
defineDrawnSprite('proj_shuttlecock', 9, 7, (p) => {
  // feather skirt flaring back, ribbed
  p.poly([0, 0, 5, 2, 5, 4, 0, 6], '#f4f0e6');
  p.line(0, 0, 4, 2, '#ffffff');
  p.line(0, 3, 4, 3, '#c8c0b0');
  p.px(0, 1, '#d8d0c0');
  p.px(0, 5, '#d8d0c0');
  // a gold band where feathers meet the cork
  p.rect(5, 2, 1, 3, '#e0a830');
  // rounded cork
  p.rect(6, 2, 2, 3, '#f0e2c4');
  p.px(8, 3, '#f0e2c4');
  p.px(6, 2, '#fff8e8');
  p.px(7, 4, '#c8a878');
}, { outline: '#14101c', origin: [4, 3] });

defineDrawnSprite('icon_badminton_racket', 16, 16, (p) => {
  // racket on the diagonal, head top-right
  p.line(1, 15, 6, 10, '#28306a');
  p.line(2, 15, 6, 11, '#3a4a9a');
  p.px(3, 13, '#e8e8f4');
  p.px(5, 11, '#e8e8f4');
  p.line(6, 10, 8, 8, '#c8ccd8');
  for (let y = 0; y < 11; y++) for (let x = 6; x < 16; x++) {
    const dx = x + 0.5 - 10.5;
    const dy = y + 0.5 - 5.5;
    const d = dx * dx + dy * dy;
    if (d > 4.3 * 4.3) continue;
    if (d > 3.2 * 3.2) p.px(x, y, dy < 0 ? '#e04048' : '#a82830');
    else p.px(x, y, x % 2 === 0 || y % 2 === 1 ? '#e8eef8' : '#232838');
  }
  p.px(9, 2, '#ff8a8a');
  // a shuttle flying off the strings, cork first
  for (const [x, y] of [[10, 10], [11, 10], [10, 11], [11, 11], [12, 11], [11, 12]]) p.px(x, y, '#f4f0e6');
  p.px(10, 10, '#ffffff');
  p.px(12, 12, '#e0a830');
  p.px(13, 12, '#f0e2c4');
  p.px(12, 13, '#f0e2c4');
  p.px(13, 13, '#c8a878');
}, { outline: O });

// ------------------------------------------------------------------ tuning
/** Serve damage (x weapon damage). */
export const SERVE_DAMAGE = 0.7;
/** Smash damage (x weapon damage) before the rally bonus. */
export const SMASH_DAMAGE = 1.1;
/** Smash bonus per rally step, up to `RALLY_CAP` steps. */
export const RALLY_STEP = 0.08;
export const RALLY_CAP = 6;
/** Launch speed (x shot speed): serve, smash. */
export const SERVE_SPEED = 1.8;
/** A serve runs out of speed after about this x the keeper range. */
export const SERVE_REACH = 1.2;
export const SMASH_SPEED = 2.6;
/** A shuttle drops once it is slower than this (px/s). */
export const SHUTTLE_MIN_SPEED = 60;
/** Seconds a popped shuttle floats before landing; the height of its arc. */
export const POP_TIME = 0.95;
export const POP_PEAK = 46;
/** A falling shuttle (past this fraction of its flight) within `SMASH_REACH` px of its keeper can be smashed. */
export const SMASH_FROM = 0.4;
export const SMASH_REACH = 44;
/** The landing spot drifts toward the keeper at up to this speed (px/s). */
export const POP_FOLLOW = 100;
/** Most shuttles one keeper can have floating at once (further hits do not pop). */
export const MAX_FLOATING = 3;

export function smashMult(rally: number): number {
  return SMASH_DAMAGE * (1 + RALLY_STEP * clamp(rally, 0, RALLY_CAP));
}

// ------------------------------------------------------------------ the floating shuttle
/** A shuttle knocked high off a foe, floating back to its keeper to be smashed. */
export class RallyShuttle extends Entity {
  owner: Player;
  /** flight progress 0..1 */
  t = 0;
  x0: number;
  y0: number;
  /** where it will come down (drifts toward the keeper) */
  tx: number;
  ty: number;
  rally: number;
  dmg: number;
  constructor(owner: Player, x: number, y: number, rally: number, dmg: number) {
    super();
    this.owner = owner;
    this.x = this.x0 = x;
    this.y = this.y0 = y;
    // it comes down beside its keeper, a little toward where it was hit from
    const d = Math.hypot(x - owner.x, y - owner.y) || 1;
    this.tx = owner.x + ((x - owner.x) / d) * 10;
    this.ty = owner.y + ((y - owner.y) / d) * 6;
    this.z = 8;
    this.rally = rally;
    this.dmg = dmg;
    this.layer = 2;
    this.tileCollide = false;
  }

  /** Falling and within reach of its keeper: a swing now smashes it. */
  smashable(p: Player): boolean {
    return !this.dead && this.t >= SMASH_FROM && Math.hypot(this.x - p.x, this.y - p.y) <= SMASH_REACH;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const p = this.owner;
    // the keeper put the racket away (or fell): it just drops
    if (p.weaponId !== 'badminton_racket' || !p.alive) {
      this.land(w, false);
      return;
    }
    const dx = p.x - this.tx;
    const dy = p.y - this.ty;
    const d = Math.hypot(dx, dy);
    const step = POP_FOLLOW * dt;
    if (d > 1e-6) {
      const k = Math.min(1, step / d);
      this.tx += dx * k;
      this.ty += dy * k;
    }
    this.t = Math.min(1, this.t + dt / POP_TIME);
    const e = ease.outQuad(this.t);
    this.x = this.x0 + (this.tx - this.x0) * e;
    this.y = this.y0 + (this.ty - this.y0) * e;
    this.z = 8 * (1 - this.t) + POP_PEAK * 4 * this.t * (1 - this.t);
    if (this.t >= 1) this.land(w, true);
  }

  /** Down on the floor: the rally is over. */
  land(w: World, onFloor: boolean): void {
    if (this.dead) return;
    this.dead = true;
    if (onFloor) {
      w.spawn(new FallenShuttle(this.x, this.y));
      w.particles.burst(this.x, this.y, { count: 4, speed: [10, 30], life: [0.15, 0.3], colors: ['#f4f0e6', '#c8c0b0'], size: [1, 1], shape: 'pixel' });
      w.sfx('hit', { vol: 0.12, pitch: 1.9, x: this.x });
    }
  }

  override draw(r: Renderer, w: World): void {
    const p = this.owner;
    const y = this.y - this.z;
    // shadow + a ring that closes in on where it comes down (gold when a swing would smash it)
    const ready = this.smashable(p);
    const left = 1 - this.t;
    r.shadow(this.x, this.y + 1, 2 + this.t * 2.5, 1 + this.t, 0.15 + this.t * 0.25);
    if (this.t > 0.2) {
      const rad = 4 + left * 10;
      r.pixelRing(this.x, this.y, rad, ready ? '#ffd860' : '#e8eef8', 1, ready ? 0.85 : 0.35 + this.t * 0.25);
    }
    // cork up on the way up, turning over at the top, cork down on the way down
    const flip = ease.inOutQuad(clamp((this.t - 0.35) / 0.3, 0, 1));
    const sway = Math.sin(this.age * 11 + this.id) * 0.18 * (1 - flip * 0.5);
    const rot = -Math.PI / 2 + Math.PI * flip + sway;
    if (ready) r.sprite(glowSprite(12, '#ffe8a0'), this.x, y, { alpha: 0.35 + 0.15 * Math.sin(w.time * 18), additive: true });
    r.sprite('proj_shuttlecock', this.x, y, { rot, flash: ready ? 0.25 : 0 });
  }

  override light(w: World): void {
    if (this.smashable(this.owner)) w.lights.add(this.x, this.y - this.z, 22, '#ffe8a0', { intensity: 0.45 });
  }
}

/** A shuttle lying on the floor after a dropped rally. Purely visual. */
export class FallenShuttle extends Entity {
  static override readonly cosmetic = true;
  rot: number;
  constructor(x: number, y: number) {
    super();
    this.x = x;
    this.y = y;
    this.rot = Math.PI / 2 + fx.range(-0.5, 0.5);
    this.layer = 0;
    this.tileCollide = false;
  }
  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.age > 0.9) this.dead = true;
  }
  override draw(r: Renderer): void {
    const a = this.age < 0.6 ? 1 : 1 - (this.age - 0.6) / 0.3;
    r.sprite('proj_shuttlecock', this.x, this.y - 1, { rot: this.rot, alpha: a });
  }
}

/** "랠리 N" over the keeper after a smash. Purely visual. */
export class RallyText extends Entity {
  static override readonly cosmetic = true;
  n: number;
  constructor(x: number, y: number, n: number) {
    super();
    this.x = x;
    this.y = y;
    this.n = n;
    this.layer = 3;
    this.tileCollide = false;
  }
  override update(_w: World, dt: number): void {
    this.age += dt;
    this.y -= 14 * dt;
    if (this.age > 0.7) this.dead = true;
  }
  override draw(r: Renderer): void {
    if (typeof document === 'undefined') return;
    const hot = this.n >= RALLY_CAP;
    const c = pixelTextCanvas(`랠리 ${this.n}`, { size: 10, font: 'Galmuri9', color: hot ? '#ffd860' : '#f4f0e6', outline: '#100c18' });
    const a = this.age < 0.5 ? 1 : 1 - (this.age - 0.5) / 0.2;
    const pop = this.age < 0.06 ? 1 : 0;
    r.ctx.globalAlpha = Math.max(0, a) * r.worldOpacity;
    r.ctx.drawImage(c, Math.round(this.x - c.width / 2 - r.viewX), Math.round(this.y - c.height - r.viewY - pop));
    r.ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ shots
function pop(pr: Projectile, w: World): void {
  const p = pr.owner as Player | null;
  if (!p || p.weaponId !== 'badminton_racket') return;
  if (ownedBy(w, RallyShuttle, p).length >= MAX_FLOATING) return;
  const rally = pr.mem.rally ?? 0;
  trackOwned(w, w.spawn(new RallyShuttle(p, pr.x, pr.y, rally, Number(pr.mem.weaponDamage ?? p.weaponStats.damage))));
  w.sfx('hit', { vol: 0.25, pitch: 1.6 + Math.min(0.4, rally * 0.06), x: pr.x });
}

const shuttleFx: ProjBehavior = {
  id: 'shuttlecock',
  update(pr, w, dt) {
    // feathers bite the air: fast off the strings, slowing hard
    pr.speed *= Math.exp(-(pr.mem.drag ?? 2) * dt);
    pr.syncVel();
    if (pr.speed < SHUTTLE_MIN_SPEED) {
      pr.dead = true;
      if (!(pr.mem.smash ?? 0)) w.spawn(new FallenShuttle(pr.x, pr.y));
    }
    // a smash is struck downward: it dives from the height it was hit at
    if (pr.mem.smash ?? 0) pr.z += (6 - pr.z) * Math.min(1, 14 * dt);
    if ((pr.mem.smash ?? 0) && fx.chance(0.5)) {
      w.particles.spawn({ x: pr.x - pr.vx * 0.01, y: pr.y - pr.z, vx: -pr.vx * 0.05, vy: -pr.vy * 0.05, life: 0.18, size: 1, colors: ['#ffffff', '#ffe8a0'], additive: true });
    }
  },
  onHit(pr, w, target) {
    // only foes knock it up (pots and props just stop it)
    if (!('isBoss' in target)) return;
    // a piercing smash knocks up only the first shuttle it meets
    if (!(pr.mem.popped ?? 0)) {
      pr.mem.popped = 1;
      pop(pr, w);
    }
    if (pr.mem.smash ?? 0) {
      w.particles.burst(pr.x, pr.y - pr.z, { count: 8, speed: [40, 130], life: [0.1, 0.28], colors: ['#ffffff', '#ffe8a0', '#f4f0e6'], size: [1, 2], shape: 'spark', additive: true });
      w.spawn(new RingFx(pr.x, pr.y - pr.z, 9, 0.16, '#ffe8a0', 1));
    } else {
      w.particles.burst(pr.x, pr.y - pr.z, { count: 4, speed: [20, 60], life: [0.12, 0.25], colors: ['#f4f0e6', '#ffffff'], size: [1, 1], shape: 'pixel' });
    }
  },
  draw(pr, r) {
    const y = pr.y - pr.z;
    const smash = (pr.mem.smash ?? 0) > 0;
    // a short feather wake behind it
    const sp = Math.max(1, pr.speed);
    const ux = pr.vx / sp;
    const uy = pr.vy / sp;
    const len = Math.min(smash ? 22 : 10, sp * (smash ? 0.045 : 0.025));
    if (smash) {
      r.sprite(glowSprite(12, '#ffe8a0'), pr.x, y, { alpha: 0.45, additive: true });
      pixLine(r, pr.x - ux * len, y - uy * len, pr.x - ux * 4, y - uy * 4, '#ffe8a0', 0.7);
    } else if (len > 4) {
      pixLine(r, pr.x - ux * len, y - uy * len, pr.x - ux * 4, y - uy * 4, '#e8eef8', 0.35);
    }
    // slowing down it starts to wobble
    const wob = smash ? 0 : Math.sin(pr.age * 30 + pr.id) * clamp(1 - sp / 200, 0, 1) * 0.35;
    r.sprite('proj_shuttlecock', pr.x, y, { rot: Math.atan2(pr.vy, pr.vx) + wob, flash: smash ? 0.3 : 0 });
  },
};

// ------------------------------------------------------------------ the racket
function swing(w: World, p: Player, st: { mem: Record<string, number> }, aim: number, heavy: boolean): void {
  const side = (st.mem.side ?? 1) > 0 ? -1 : 1;
  st.mem.side = side;
  startSwingPose(st as never, w, aim - side * (heavy ? 1.9 : 1.3), aim + side * (heavy ? 1.2 : 0.9), heavy ? 0.06 : 0.07, heavy ? 0.08 : 0.05);
  st.mem.heavyAt = heavy ? w.time : (st.mem.heavyAt ?? -9);
}

function smash(w: World, p: Player, st: { mem: Record<string, number> }, aim: number, birds: RallyShuttle[]): void {
  const s = p.weaponStats;
  let best = 0;
  for (const b of birds) {
    b.dead = true;
    const rally = b.rally + 1;
    best = Math.max(best, rally);
    const shots = p.fireProjectiles(w, aim, {
      count: 1, style: 'none', x: b.x, y: b.y + 1, z: Math.max(4, b.z), damageMult: 0, damage: b.dmg * smashMult(b.rally),
      speed: s.shotSpeed * SMASH_SPEED, range: 1e9, life: 3, pierce: s.pierce + 1, radius: s.projSize + 0.5,
      knockback: s.knockback * 2.2, color: '#ffe8a0', light: 12, behaviors: [shuttleFx], fxMaterial: 'wood',
    });
    for (const pr of shots) {
      pr.mem.smash = 1;
      pr.mem.rally = rally;
      pr.mem.drag = 1.1;
      // straight off the strings (no drift from the keeper's stride)
      pr.vx = Math.cos(aim) * pr.speed;
      pr.vy = Math.sin(aim) * pr.speed;
      pr.speed = Math.hypot(pr.vx, pr.vy);
    }
    w.spawn(new RingFx(b.x, b.y - b.z, 10, 0.18, '#ffffff', 1));
    w.particles.burst(b.x, b.y - b.z, { count: 10, speed: [40, 140], angle: aim, spread: 0.9, life: [0.1, 0.3], colors: ['#ffffff', '#ffe8a0', '#f4f0e6'], size: [1, 2], shape: 'spark', additive: true });
  }
  st.mem.rally = best;
  st.mem.rallyAt = w.time;
  if (best >= 2) w.spawn(new RallyText(p.x, p.y - 24, best));
  kick(w, aim, 1.6);
  w.shake(Math.min(0.12, 0.05 + best * 0.01));
  w.sfx('swing_heavy', { vol: 0.45, pitch: 1.5 });
  w.sfx('hit_crit', { vol: 0.35, pitch: 1.2 + Math.min(0.5, best * 0.07) });
}

defineWeapon({
  id: 'badminton_racket',
  name: '바람깃 라켓',
  desc: '휘두르면 셔틀콕이 빠르게 날아가다 바람에 꺾여 급히 느려진다. 적을 맞힌 셔틀콕은 높이 떠올라 내 쪽으로 되돌아오고, 떨어지는 셔틀콕을 휘둘러 받아치면 스매시! 랠리가 이어질수록 스매시가 강해지고, 바닥에 떨어지면 랠리가 끊긴다.',
  icon: 'icon_badminton_racket',
  heldSprite: 'w_badminton_racket',
  kind: 'ranged',
  archetype: '랠리',
  rarity: 'legendary',
  tags: ['quick'],
  pools: ['boss', 'secret'],
  stats(m) {
    m.mulStat('fireRate', 0.8);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    // a falling shuttle within reach is smashed instead of a new serve
    const birds = ownedBy(w, RallyShuttle, p).filter((b) => b.smashable(p));
    if (birds.length) {
      swing(w, p, st, aim, true);
      smash(w, p, st, aim, birds);
      return;
    }
    swing(w, p, st, aim, false);
    const s = p.weaponStats;
    const h = handPos(p, aim, 12);
    const v0 = s.shotSpeed * SERVE_SPEED;
    const shots = p.fireProjectiles(w, aim, {
      style: 'none', damageMult: SERVE_DAMAGE, x: h.x, y: h.y, z: 6, speed: v0, range: 1e9, life: 4,
      color: '#f4f0e6', light: 6, behaviors: [shuttleFx], fxMaterial: 'wood',
    });
    // drag sized so the shuttle runs out of speed a little past the keeper range
    const drag = (v0 - SHUTTLE_MIN_SPEED) / Math.max(40, s.range * SERVE_REACH);
    for (const pr of shots) {
      pr.mem.drag = drag;
      pr.mem.rally = 0;
    }
    kick(w, aim, 0.6);
    w.sfx('swing', { vol: 0.35, pitch: 1.5 + w.rng.next() * 0.1 });
    w.sfx('hit', { vol: 0.18, pitch: 2.2 });
  },
  onHolster(w, p) {
    for (const b of ownedBy(w, RallyShuttle, p)) b.land(w, true);
  },
  draw(w, p, r, st) {
    const side = st.mem.side ?? 1;
    // held up and a little back, ready to swing
    const rest = p.aim - side * 0.55;
    const pose = swingPose(st as never, w, rest);
    const h = visualHandPos(p, pose.angle, 5);
    const heavy = w.time - (st.mem.heavyAt ?? -9) < 0.2;
    // the swing smear: an arc of the head's path
    if (pose.phase === 1 || pose.phase === 2) {
      const a0 = st.mem.swFrom ?? rest;
      const a1 = pose.angle;
      const alpha = pose.phase === 1 ? 0.7 : 0.35;
      const c = visualHandPos(p, p.aim, 0);
      pixelArc(r, c.x, c.y, 19, Math.min(a0, a1), Math.max(a0, a1), heavy ? '#ffe8a0' : '#e8eef8', alpha);
      if (heavy) pixelArc(r, c.x, c.y, 17, Math.min(a0, a1), Math.max(a0, a1), '#ffffff', alpha * 0.6);
    }
    r.sprite(heldSprite('badminton_racket'), h.x, h.y, { rot: pose.angle, flipY: Math.cos(pose.angle) < 0, flash: heavy && pose.phase <= 2 ? 0.4 : 0 });
  },
});
