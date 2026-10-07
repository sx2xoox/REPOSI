// Star lamps: two epic weapons that act beside the keeper.
//  떠도는 등령    (wandering_lamp, epic)  — a lantern spirit drifts toward the
//                                         cursor; every attack fires from the
//                                         keeper and from the lamp at the aim
//  점착 폭탄 쇠뇌 (sticky_crossbow, epic) — bolts stick into foes and blow a
//                                         moment later; stuck bolts merge
// (shared helpers in arms-kit.ts)

import { defineWeapon } from '../../game/defs';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import { Entity, type Actor } from '../../game/entity';
import type { ProjBehavior } from '../../game/projectile';
import { RingFx } from '../../game/effects';
import { defineDrawnSprite } from '../../engine/sprites';
import { clamp } from '../../engine/math';
import { fx } from '../../engine/rng';
import { visualHandPos } from '../../game/weapon-pose';
import { heldLocalPoint } from '../../game/weapon-presentation';
import { O, attackInterval, drawHeld, glowSprite, handPos, kick, muzzle, rayLength } from './common';
import { aimDistance, beginAttack, drawGun, shotFade } from './kit';
import { aimPoint, heldSprite, keeperBlast } from './arms-kit';

// ================================================================== 떠도는 등령
defineDrawnSprite('w_wandering_lamp', 15, 9, (p) => {
  // a short lamp-hook rod: carved grip, brass hook, a little spirit wick at the tip
  p.rect(0, 4, 9, 2, '#5a3a2a');
  p.line(0, 4, 8, 4, '#8a5a3a');
  p.rect(2, 3, 1, 4, '#c8a040');
  p.rect(9, 3, 2, 4, '#c8a040');
  p.px(9, 3, '#fff0a0');
  p.line(11, 4, 13, 2, '#a07830');
  p.line(13, 2, 14, 4, '#a07830');
  p.px(14, 5, '#7af0d0');
  p.px(13, 6, '#c8fff0');
}, { outline: O, origin: [3, 5] });

/** The lantern spirit itself (pivot: the hanging ring): a paper lamp with a warm heart and two eyes. */
defineDrawnSprite('fx_wandering_lamp', 9, 14, (p) => {
  p.ring(4.5, 1.5, 1.6, 1, '#c8a040');
  p.rect(2, 3, 5, 1, '#8a6428');
  p.px(2, 3, '#c89838');
  p.ellipse(4.5, 7.8, 4.1, 4.3, '#bff0dc');
  p.shadeSphere(4.5, 7.8, 4.1, 4.3, ['#3a8a78', '#6ac8b0', '#bff0dc', '#f4fff8'], { dither: true });
  // warm heart of the flame
  p.ellipse(4.5, 8.2, 2, 2.4, '#fff4c8');
  p.px(4, 7, '#ffffff');
  p.px(5, 7, '#ffffff');
  // paper ribs
  p.line(1, 6, 7, 6, '#4a9a86');
  p.line(1, 10, 7, 10, '#4a9a86');
  // eyes
  p.px(3, 8, '#1a3a34');
  p.px(6, 8, '#1a3a34');
  p.rect(2, 12, 5, 1, '#8a6428');
  p.px(4, 13, '#e05a5a');
}, { outline: '#0e1c1c', origin: [4, 0] });

defineDrawnSprite('icon_wandering_lamp', 16, 16, (p) => {
  // the spirit lamp floating free of its rod
  p.line(1, 15, 5, 11, '#5a3a2a');
  p.line(2, 15, 5, 12, '#8a5a3a');
  p.line(5, 11, 6, 9, '#c8a040');
  p.px(6, 8, '#c8a040');
  p.ring(10.5, 1.5, 1.6, 1, '#c8a040');
  p.rect(7, 3, 7, 1, '#8a6428');
  p.ellipse(10.5, 8.5, 5, 4.8, '#bff0dc');
  p.shadeSphere(10.5, 8.5, 5, 4.8, ['#3a8a78', '#6ac8b0', '#bff0dc', '#f4fff8'], { dither: true });
  p.ellipse(10.5, 9, 2.6, 2.8, '#fff4c8');
  p.px(10, 7, '#ffffff');
  p.px(11, 7, '#ffffff');
  p.line(6, 6, 15, 6, '#4a9a86');
  p.line(6, 11, 15, 11, '#4a9a86');
  p.px(9, 9, '#1a3a34');
  p.px(12, 9, '#1a3a34');
  p.rect(7, 13, 7, 1, '#8a6428');
  p.px(10, 14, '#e05a5a');
  p.px(10, 15, '#e05a5a');
  p.px(3, 6, '#7af0d0');
  p.px(4, 4, '#c8fff0');
}, { outline: O });

/** Farthest the lamp floats from its keeper (px). */
export const LAMP_MAX = 90;
/** Damage of the keeper's and the lamp's shot (x weapon damage each). */
export const LAMP_KEEPER_SHOT = 0.5;
export const LAMP_SPIRIT_SHOT = 0.68;
/** The spirit flame bends toward foes (homing, rad/s). */
export const LAMP_SEEK = 2.5;
/** How far short of the aimed point the lamp stops, and how far it hovers to the side (px). */
const LAMP_SHORT = 26;
const LAMP_SIDE = 14;

/** Where the lamp wants to float: toward the aimed point, a little short of it and off to the side. */
export function lampAnchor(w: World, p: Player, aim: number): { x: number; y: number } {
  const d = aimDistance(w, p, 0, 400, 80);
  const along = clamp(d - LAMP_SHORT, 18, LAMP_MAX - 4);
  // hover on the upper side of the aim line (or the right of a vertical aim)
  let nx = Math.sin(aim);
  let ny = -Math.cos(aim);
  if (ny > 0.05 || (Math.abs(ny) <= 0.05 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  let tx = p.x + Math.cos(aim) * along + nx * LAMP_SIDE;
  let ty = p.y - 6 + Math.sin(aim) * along + ny * LAMP_SIDE;
  // a spirit drifts over rocks, never through the room's walls
  const a = Math.atan2(ty - (p.y - 6), tx - p.x);
  const want = Math.min(LAMP_MAX, Math.hypot(tx - p.x, ty - (p.y - 6)));
  const free = Math.max(0, rayLength(w, p.x, p.y - 6, a, want, true) - 6);
  if (free < want) {
    tx = p.x + Math.cos(a) * free;
    ty = p.y - 6 + Math.sin(a) * free;
  }
  return { x: tx, y: ty };
}

const spiritFlameFx: ProjBehavior = {
  id: 'lamp_flame',
  update(pr, w) {
    if (fx.chance(0.55)) w.particles.spawn({ x: pr.x + fx.range(-1, 1), y: pr.y - pr.z + fx.range(-1, 1), vy: -12, life: 0.25, colors: ['#ffffff', '#7af0d0', '#3aa890'], size: 1, shape: 'pixel', additive: true });
  },
  draw(pr, r, w) {
    const fl = 1 + 0.15 * Math.sin(w.time * 31 + pr.id);
    r.sprite(glowSprite(10 * fl, '#7af0d0'), pr.x, pr.y - pr.z, { alpha: 0.6, additive: true });
    r.rect(Math.round(pr.x) - 1, Math.round(pr.y - pr.z) - 1, 2, 3, '#e8fff8');
    r.rect(Math.round(pr.x), Math.round(pr.y - pr.z) - 2, 1, 1, '#c8fff0');
  },
};

/** Draws (and lights) a keeper's lantern spirit from its weapon state; purely visual. */
class LampWisp extends Entity {
  static override readonly cosmetic = true;
  owner: Player;
  room: number;
  constructor(owner: Player, room: number) {
    super();
    this.owner = owner;
    this.room = room;
    this.layer = 2;
    this.tileCollide = false;
    this.x = Number(owner.weapon.mem.lx ?? owner.x);
    this.y = Number(owner.weapon.mem.ly ?? owner.y);
  }

  private live(w: World): boolean {
    const o = this.owner;
    return o.alive && o.weaponId === 'wandering_lamp' && o.weapon.mem.lampOn === 1 && o.weapon.mem.lampRoom === w.node.id && this.room === w.node.id;
  }

  override update(w: World, dt: number): void {
    if (!this.live(w)) {
      this.dead = true;
      return;
    }
    this.age += dt;
    this.x = Number(this.owner.weapon.mem.lx);
    this.y = Number(this.owner.weapon.mem.ly);
  }

  override draw(r: Renderer, w: World): void {
    const st = this.owner.weapon;
    const bob = Math.sin(this.age * 3.2) * 1.5;
    const shot = w.time - (st.mem.lampShotAt ?? -9);
    const f = shot >= 0 && shot < 0.15 ? 1 - shot / 0.15 : 0;
    const appear = Math.min(1, this.age * 6);
    const hy = this.y - 18 + bob;
    r.shadow(this.x, this.y + 2, 7, 3, 0.25 * appear);
    r.sprite(glowSprite(18 + f * 8 + Math.sin(this.age * 7), '#7af0d0'), this.x, hy + 7, { alpha: (0.35 + f * 0.4) * appear, additive: true });
    r.sprite('fx_wandering_lamp', this.x, hy, { rot: Math.sin(this.age * 2.1) * 0.12, sx: appear, sy: appear, flash: f * 0.5 });
    // a faint tether of motes back toward the keeper
    const o = this.owner;
    for (let i = 1; i <= 3; i++) {
      const k = i / 4;
      const tx = o.x + (this.x - o.x) * k;
      const ty = o.y - 8 + (hy + 8 - (o.y - 8)) * k;
      const tw = 0.25 + 0.25 * Math.sin(w.time * 5 + i * 1.7);
      r.rect(Math.round(tx), Math.round(ty), 1, 1, '#a8f8e0', tw * appear);
    }
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 12, 46, '#7af0d0', { intensity: 0.75 });
  }
}

/** The cosmetic wisp currently showing each keeper's lamp. */
const wisps = new WeakMap<Player, LampWisp>();

defineWeapon({
  id: 'wandering_lamp',
  name: '떠도는 등령',
  desc: '등불 정령이 조준점 쪽으로 떠다닌다. 공격하면 등불지기와 정령이 함께 조준점을 쏜다. 정령의 불꽃은 적을 살짝 따라가며 바위를 통과한다.',
  icon: 'icon_wandering_lamp',
  heldSprite: 'w_wandering_lamp',
  kind: 'ranged',
  archetype: '등령',
  rarity: 'epic',
  tags: ['arcane'],
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('fireRate', 1.0);
  },
  update(w, p, st, dt, firing, aim) {
    // (re)appear at the keeper: first equip, a new room, back from the other slot
    if (st.mem.lampOn !== 1 || st.mem.lampRoom !== w.node.id) {
      st.mem.lampOn = 1;
      st.mem.lampRoom = w.node.id;
      st.mem.lx = p.x;
      st.mem.ly = p.y - 4;
    }
    const to = lampAnchor(w, p, aim);
    const k = 1 - Math.exp(-dt * 6);
    st.mem.lx += (to.x - st.mem.lx) * k;
    st.mem.ly += (to.y - st.mem.ly) * k;
    // the lamp never trails farther than its tether
    const dx = st.mem.lx - p.x;
    const dy = st.mem.ly - (p.y - 6);
    const d = Math.hypot(dx, dy);
    if (d > LAMP_MAX) {
      st.mem.lx = p.x + (dx / d) * LAMP_MAX;
      st.mem.ly = p.y - 6 + (dy / d) * LAMP_MAX;
    }
    const wisp = wisps.get(p);
    if (!wisp || wisp.dead || wisp.room !== w.node.id) wisps.set(p, w.spawn(new LampWisp(p, w.node.id)));
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.weaponStats;
    const t = aimPoint(w, p, aim, 8, s.range, s.range * 0.6);
    // the keeper's own shot
    const h = handPos(p, aim, 15);
    p.fireProjectiles(w, aim, {
      style: 'tear', damageMult: LAMP_KEEPER_SHOT, color: '#ffd890', light: 14, x: h.x, y: h.y, radius: Math.max(1.5, s.projSize - 0.5),
    });
    // the lamp's shot at the same point (a seeking spirit flame that passes rocks)
    const lx = st.mem.lx;
    const ly = st.mem.ly;
    const la = Math.hypot(t.x - lx, t.y - ly) > 4 ? Math.atan2(t.y - ly, t.x - lx) : aim;
    const shots = p.fireProjectiles(w, la, {
      style: 'none', damageMult: LAMP_SPIRIT_SHOT, color: '#7af0d0', light: 12, x: lx, y: ly, z: 12, radius: Math.max(1.5, s.projSize - 0.5),
      spectral: true, homing: s.homing + LAMP_SEEK, behaviors: [spiritFlameFx],
    });
    // the lamp's shot ignores the keeper's stride
    for (const pr of shots) {
      pr.vx = Math.cos(pr.angle) * s.shotSpeed;
      pr.vy = Math.sin(pr.angle) * s.shotSpeed;
      pr.speed = s.shotSpeed;
    }
    st.mem.lampShotAt = w.time;
    muzzle(w, h.x, h.y, aim, ['#ffffff', '#ffd890', '#ffa040'], 3, [30, 90]);
    muzzle(w, lx, ly - 12, la, ['#ffffff', '#7af0d0', '#3aa890'], 4, [30, 90]);
    kick(w, aim + Math.PI, 0.6);
    w.sfx('shoot_magic', { vol: 0.38, pitch: 1.05 + w.rng.next() * 0.08 });
    w.sfx('orb', { vol: 0.16, pitch: 2.2, x: lx });
  },
  onHolster(_w, _p, st) {
    st.mem.lampOn = 0;
  },
  draw(w, p, r, st) {
    const f = shotFade(st, w, 0.14);
    drawHeld(r, p, heldSprite('wandering_lamp'), p.aim, 5 - f * 2, { flash: f * 0.3 });
    const h = visualHandPos(p, p.aim, 5 - f * 2);
    const q = heldLocalPoint(h.x, h.y, p.aim, 11, 0);
    r.sprite(glowSprite(5 + f * 5, '#7af0d0'), q.x, q.y, { alpha: 0.4 + f * 0.4, additive: true });
  },
});

// ================================================================== 점착 폭탄 쇠뇌
defineDrawnSprite('w_sticky_crossbow', 17, 13, (p) => {
  // stock
  p.rect(0, 5, 11, 3, '#5a4030');
  p.line(0, 5, 10, 5, '#8a6448');
  p.rect(2, 8, 2, 3, '#3a2a1c');
  // prod (bow arms) of dark iron
  for (let y = 0; y < 13; y++) {
    const k = (y - 6) / 6;
    p.px(Math.round(11 - 2.5 * k * k), y, y === 0 || y === 12 ? '#c8d0e4' : '#6a7284');
  }
  p.line(8, 0, 8, 12, '#e8e0d0');
  // loaded bomb bolt
  p.line(5, 6, 12, 6, '#c8a070');
  p.circle(14, 6.5, 2.4, '#2a2230');
  p.rect(13, 6, 3, 1, '#e04040');
  p.px(13, 5, '#8a8098');
  p.px(15, 4, '#ffd040');
}, { outline: O, origin: [3, 6] });

/** The bomb bolt in flight (pivot at the head). */
defineDrawnSprite('proj_sticky_bolt', 10, 5, (p) => {
  p.line(0, 2, 6, 2, '#c8a070');
  p.px(0, 1, '#e04040');
  p.px(0, 3, '#e04040');
  p.circle(7.5, 2.5, 2.3, '#2a2230');
  p.line(6, 2, 9, 2, '#e04040');
  p.px(7, 1, '#8a8098');
}, { outline: '#100a10', origin: [7, 2] });

defineDrawnSprite('icon_sticky_crossbow', 16, 16, (p) => {
  p.rect(0, 8, 10, 3, '#5a4030');
  p.rect(0, 8, 10, 1, '#8a6448');
  p.rect(1, 11, 2, 2, '#3a2a1c');
  for (let y = 1; y < 16; y++) {
    const k = (y - 8.5) / 7.5;
    p.px(Math.round(11.5 - 2.6 * k * k), y, y < 3 || y > 13 ? '#c8d0e4' : '#6a7284');
  }
  p.line(9, 1, 6, 9, '#f0e8d8');
  p.line(9, 15, 6, 9, '#f0e8d8');
  // the bomb bolt with its lit fuse
  p.line(5, 9, 11, 9, '#c8a070');
  p.circle(13, 9, 2.6, '#2a2230');
  p.line(11, 9, 15, 9, '#e04040');
  p.px(12, 7, '#8a8098');
  p.line(14, 6, 15, 4, '#a07840');
  p.px(15, 3, '#ffd040');
}, { outline: O });

/** Damage of a bolt's hit (x weapon damage). */
export const STICKY_BOLT = 0.55;
/** Blast per stuck bolt (x weapon damage); merged bolts add up. */
export const STICKY_BLAST = 0.7;
/** Seconds from the first bolt sticking to the blast. */
export const STICKY_FUSE = 1.0;
/** Blast radius of a single bolt (px); each extra bolt adds a little, up to a cap. */
export const STICKY_RADIUS = 24;
export function stickyRadius(bolts: number, projSize: number): number {
  return Math.min(40, STICKY_RADIUS + 4 * Math.max(0, bolts - 1)) + Math.max(0, projSize - 3);
}

/** Bombs stuck in one foe by one keeper: one fuse, one (merged) blast. */
export class StickyCharge extends Entity {
  owner: Player;
  target: Actor;
  /** angles the bolts came in at (drawn sticking out) */
  angles: number[] = [];
  mem: Record<string, number> = { fuse: STICKY_FUSE, bolts: 0, dmg: 0, target: 0 };
  constructor(owner: Player, target: Actor) {
    super();
    this.owner = owner;
    this.target = target;
    this.mem.target = target.id;
    this.x = target.x;
    this.y = target.y;
    this.z = target.z;
    this.r = target.r;
    this.layer = 2;
    this.tileCollide = false;
  }

  add(angle: number, dmg: number): void {
    this.mem.bolts++;
    this.mem.dmg += dmg;
    if (this.angles.length < 6) this.angles.push(angle);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const t = this.target;
    // ride the foe; if it falls, the bombs drop where it stood
    if (t.alive && !t.dead) {
      this.x = t.x;
      this.y = t.y;
      this.z = t.z;
      this.r = t.r;
    } else this.z = Math.max(0, this.z - dt * 60);
    this.mem.fuse -= dt;
    if (this.mem.fuse <= 0) this.detonate(w);
  }

  detonate(w: World): void {
    if (this.dead) return;
    this.dead = true;
    const n = this.mem.bolts;
    const p = this.owner;
    const rad = stickyRadius(n, p.weaponStats.projSize);
    keeperBlast(w, p, this.x, this.y, rad, this.mem.dmg, { knockback: 160 + 20 * n });
    const big = n >= 3;
    w.particles.burst(this.x, this.y - 4, { count: 12 + n * 4, speed: [40, 70 + rad * 3], life: [0.18, 0.42], colors: ['#ffffff', '#ffe080', '#ff6a30'], size: [1, big ? 3 : 2], sizeEnd: 0.5, additive: true, light: 6 });
    w.particles.burst(this.x, this.y - 4, { count: 4 + n, speed: [60, 140], life: [0.25, 0.5], colors: ['#2a2230', '#c8a070'], size: [1, 2], shape: 'square', gravity: 300, vz: [30, 90] });
    w.particles.burst(this.x, this.y, { count: 4 + n, speed: [10, 40], life: [0.4, 0.9], colors: ['#605058', '#403840'], size: [2, 4], sizeEnd: 6, drag: 3, fade: true });
    w.spawn(new RingFx(this.x, this.y - 2, rad, big ? 0.28 : 0.22, '#ffb040', big ? 3 : 2));
    w.lights.glow(this.x, this.y, rad * 1.8, '#ff8a30', 0.5 + Math.min(0.4, n * 0.08));
    w.decal(this.x, this.y, '#140c0c', rad * 0.35, 0.3);
    w.shake(Math.min(0.3, 0.07 + n * 0.04));
    w.sfx('explosion', { vol: Math.min(0.6, 0.26 + n * 0.06), pitch: Math.max(0.9, 1.5 - n * 0.1), x: this.x });
  }

  override draw(r: Renderer, w: World): void {
    const t = this.target;
    const tr = Math.max(4, this.r);
    const left = Math.max(0, this.mem.fuse);
    // the fuse blinks faster as it burns down
    const rate = 4 + (1 - left / STICKY_FUSE) * 14;
    const on = Math.floor(this.age * rate) % 2 === 0;
    for (let i = 0; i < this.angles.length; i++) {
      const a = this.angles[i];
      // each bomb clings to the side it struck, its shaft pointing back the way it came
      // spread across the body so a merged cluster reads as several bombs
      const jit = [0, -4, 4, -2, 2, -5][i] ?? 0;
      const tilt = [0, -0.25, 0.25, -0.12, 0.12, -0.3][i] ?? 0;
      const bx = this.x - Math.cos(a) * tr * 0.7 - Math.sin(a) * jit;
      const by = this.y - this.z - 5 - Math.sin(a) * tr * 0.5 + Math.cos(a) * jit * 0.7;
      r.sprite('proj_sticky_bolt', bx, by, { rot: a + tilt });
      if (on) {
        r.sprite(glowSprite(7, '#ff6030'), bx, by - 2, { alpha: 0.85, additive: true });
        r.rect(Math.round(bx), Math.round(by) - 3, 1, 2, i === 0 ? '#ffffff' : '#ffe060');
      }
    }
    // a warning ring as it is about to go (player-coloured, not the red enemy warning)
    if (left < 0.35 && t) {
      const rad = stickyRadius(this.mem.bolts, this.owner.weaponStats.projSize);
      r.pixelRing(this.x, this.y, rad * (0.6 + 0.4 * (1 - left / 0.35)), '#ffb040', 1, 0.45);
    }
  }

  override light(w: World): void {
    const left = Math.max(0, this.mem.fuse);
    const rate = 4 + (1 - left / STICKY_FUSE) * 14;
    if (Math.floor(this.age * rate) % 2 === 0) w.lights.add(this.x, this.y - 6, 20 + this.mem.bolts * 3, '#ff6a30', { intensity: 0.55 });
  }
}

/** Charges per target (one per keeper), so bolts that land in the same tick merge too. */
const charges = new WeakMap<Actor, StickyCharge[]>();

function stickTo(w: World, p: Player, target: Actor, angle: number, dmg: number): StickyCharge {
  const list = (charges.get(target) ?? []).filter((c) => !c.dead);
  let c = list.find((q) => q.owner === p);
  if (!c) {
    c = w.spawn(new StickyCharge(p, target));
    list.push(c);
  }
  charges.set(target, list);
  c.add(angle, dmg);
  return c;
}

const stickyFx: ProjBehavior = {
  id: 'sticky_bolt',
  onHit(pr, w, target) {
    const owner = pr.owner as Player | null;
    if (!owner || owner.team !== 'player' || target.team !== 'enemy') return;
    stickTo(w, owner, target, pr.angle, Number(pr.mem.weaponDamage ?? owner.weaponStats.damage) * STICKY_BLAST);
    w.sfx('bomb_place', { vol: 0.25, pitch: 1.6 + fx.range(-0.05, 0.05), x: pr.x });
    w.sfx('fuse', { vol: 0.14, pitch: 1.8, x: pr.x });
  },
};

defineWeapon({
  id: 'sticky_crossbow',
  name: '점착 폭탄 쇠뇌',
  desc: '폭탄 쇠뇌살이 맞은 적에게 달라붙어 잠시 뒤 터진다. 한 적에게 여러 발이 붙으면 하나로 합쳐져 더 크고 넓게 터진다.',
  icon: 'icon_sticky_crossbow',
  heldSprite: 'w_sticky_crossbow',
  kind: 'ranged',
  archetype: '점착',
  rarity: 'epic',
  tags: ['bow', 'explosive'],
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('fireRate', 0.86);
    m.mulStat('shotSpeed', 1.25);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.weaponStats;
    const h = handPos(p, aim, 14);
    p.fireProjectiles(w, aim, {
      style: 'sprite', sprite: 'proj_sticky_bolt', spriteRotates: true, damageMult: STICKY_BOLT, color: '#ff8a40', light: 8, x: h.x, y: h.y,
      radius: Math.max(1.5, s.projSize - 0.5), behaviors: [stickyFx], fxMaterial: 'wood', spreadMult: 0.6,
    });
    muzzle(w, h.x, h.y, aim, ['#ffffff', '#e8e0d0', '#ff8a40'], 4, [30, 100]);
    kick(w, aim + Math.PI, 0.9);
    w.sfx('shoot_arrow', { vol: 0.45, pitch: 1.1 + w.rng.next() * 0.08 });
  },
  draw(w, p, r, st) {
    drawGun(r, w, p, st, heldSprite('sticky_crossbow'), 6, 2.5);
    // the loaded bomb's fuse winks while it is ready
    if (st.cooldown > 0) return;
    const h = visualHandPos(p, p.aim, 6);
    const q = heldLocalPoint(h.x, h.y, p.aim, 12, -2);
    if (Math.floor(w.time * 5) % 2 === 0) r.rect(Math.round(q.x), Math.round(q.y), 1, 1, '#fff0a0');
  },
});
