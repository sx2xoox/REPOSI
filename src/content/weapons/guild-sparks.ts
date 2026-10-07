// Guild sparks: two workshop weapons that go off where they land.
//  폭죽 통   (firework_barrel, epic) — rockets burst at the cursor: a blast, a
//                                     ring of coloured sparks and a crackle
//  뇌전 말뚝 (tesla_stake, epic)     — thrown coil stakes zap nearby foes; two
//                                     stakes string a lightning fence
// (shared helpers in arms-kit.ts)

import { defineWeapon } from '../../game/defs';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import { Entity } from '../../game/entity';
import type { Enemy } from '../../game/enemy';
import { Projectile, type ProjBehavior } from '../../game/projectile';
import { RingFx } from '../../game/effects';
import { defineDrawnSprite } from '../../engine/sprites';
import { clamp } from '../../engine/math';
import { fx } from '../../engine/rng';
import { visualHandPos } from '../../game/weapon-pose';
import { heldLocalPoint } from '../../game/weapon-presentation';
import { O, attackInterval, drawHeld, glowSprite, handPos, kick, muzzle, pixLine, segDist } from './common';
import { Zap, aimDistance, beginAttack, drawGun } from './kit';
import { heldSprite, keeperBlast, keeperHit, ownedBy, trackOwned, wallFace } from './arms-kit';

// ================================================================== 폭죽 통
defineDrawnSprite('w_firework_barrel', 18, 12, (p) => {
  // pistol grip
  p.rect(2, 7, 3, 5, '#5a3420');
  p.line(2, 7, 2, 10, '#8a5a34');
  // fat paper barrel with gold bands
  p.rect(3, 2, 12, 6, '#c8303a');
  p.line(3, 2, 14, 2, '#ff7a6a');
  p.line(3, 3, 14, 3, '#e84a4a');
  p.line(3, 7, 14, 7, '#7a1828');
  p.rect(6, 2, 1, 6, '#ffd060');
  p.rect(12, 2, 1, 6, '#ffd060');
  p.px(6, 2, '#fff4c0');
  p.px(12, 2, '#fff4c0');
  p.px(9, 4, '#ffe080');
  p.px(9, 5, '#ffb040');
  // muzzle ring with the next rocket's nose peeking out
  p.rect(15, 1, 2, 8, '#3a2a3a');
  p.px(15, 1, '#8a7a8a');
  p.poly([17, 3.5, 18, 4.5, 17, 5.5], '#ffd060');
  // fuse at the back
  p.line(3, 3, 1, 1, '#806040');
  p.px(0, 0, '#fff0a0');
}, { outline: O, origin: [4, 8] });

defineDrawnSprite('proj_firework_rocket', 11, 5, (p) => {
  p.line(0, 2, 3, 2, '#a07040');
  p.rect(3, 1, 5, 3, '#e83a48');
  p.line(3, 1, 7, 1, '#ff8a7a');
  p.rect(5, 1, 1, 3, '#fff0e0');
  p.poly([8, 0.5, 11, 2.5, 8, 4.5], '#ffd060');
  p.px(9, 2, '#fff4c0');
}, { outline: '#1c0c14', origin: [6, 2] });

defineDrawnSprite('icon_firework_barrel', 16, 16, (p) => {
  // barrel on the diagonal
  p.poly([1, 12, 8, 5, 11, 8, 4, 15], '#c8303a');
  p.line(2, 12, 8, 6, '#ff7a6a');
  p.line(3, 13, 9, 7, '#e84a4a');
  p.line(4, 10, 6, 12, '#ffd060');
  p.line(6, 8, 8, 10, '#ffd060');
  p.poly([0, 14, 2, 12, 3, 15, 1, 16], '#5a3420');
  // the burst
  const rays: [number, number, string][] = [[0, -1, '#ffd060'], [0.7, -0.7, '#5ef0ff'], [1, 0, '#ff8a30'], [0.7, 0.7, '#ffd060'], [-0.7, -0.7, '#ff5a6a'], [-1, 0, '#ffd060']];
  for (const [dx, dy, c] of rays) p.line(12 + dx * 2, 4 + dy * 2, 12 + dx * 3.6, 4 + dy * 3.6, c);
  p.circle(12, 4, 1.2, '#fff4c0');
}, { outline: O });

/** Firework palettes: a warm main ramp + one accent (cycled per shot). */
const FIREWORKS: { core: string; main: string[]; accent: string }[] = [
  { core: '#fff4c0', main: ['#ffd040', '#ff9a30', '#ff5a3a'], accent: '#5ef0ff' },
  { core: '#ffe8e0', main: ['#ff7a8a', '#ffd060', '#ff4a5a'], accent: '#a0ff70' },
  { core: '#fff0d0', main: ['#ffb040', '#ff6a2a', '#ffe080'], accent: '#c890ff' },
];

/** Blast damage of a burst (x weapon damage; falls off toward the rim). */
export const FIREWORK_BLAST = 1.2;
/** Damage of each outflying spark (x weapon damage). */
export const FIREWORK_SPARK = 0.35;
/** Damage of the rocket's own direct hit (x weapon damage). */
export const FIREWORK_DIRECT = 0.4;

/** Short crackle of little pops after a burst (visual + sound only). */
class FireworkCrackle extends Entity {
  static override readonly cosmetic = true;
  pops: { t: number; x: number; y: number; c: string; done: boolean }[] = [];
  constructor(x: number, y: number, colors: string[]) {
    super();
    this.x = x;
    this.y = y;
    this.layer = 2;
    this.tileCollide = false;
    const n = 5 + Math.floor(fx.range(0, 3));
    for (let i = 0; i < n; i++) {
      const a = fx.range(0, Math.PI * 2);
      const d = fx.range(14, 38);
      this.pops.push({ t: 0.16 + i * 0.06 + fx.range(0, 0.05), x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.8, c: colors[i % colors.length], done: false });
    }
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    for (const q of this.pops) {
      if (q.done || this.age < q.t) continue;
      q.done = true;
      w.particles.burst(q.x, q.y - 6, { count: 4, speed: [20, 60], life: [0.08, 0.18], colors: ['#ffffff', q.c], size: [1, 1], shape: 'spark', additive: true });
      w.sfx('shoot', { vol: 0.07, pitch: 2.4 + fx.range(-0.2, 0.3), x: q.x });
    }
    if (this.age > 0.7) this.dead = true;
  }

  override draw(r: Renderer): void {
    for (const q of this.pops) {
      const k = this.age - q.t;
      if (k < 0 || k > 0.1) continue;
      const a = 1 - k / 0.1;
      r.sprite(glowSprite(7, q.c), q.x, q.y - 6, { alpha: a, additive: true });
      r.rect(Math.round(q.x), Math.round(q.y - 6), 1, 1, '#ffffff', a);
    }
  }
}

const sparkFx: ProjBehavior = {
  id: 'firework_spark',
  update(pr, w) {
    if (fx.chance(0.5)) w.particles.spawn({ x: pr.x, y: pr.y - pr.z, life: 0.22, colors: [pr.color, pr.color + '80'], size: 1, shape: 'pixel', additive: true, gravity: 40 });
  },
  draw(pr, r) {
    const fade = 1 - Math.min(1, pr.traveled / Math.max(1, pr.range)) * 0.6;
    r.sprite(glowSprite(7, pr.color), pr.x, pr.y - pr.z, { alpha: 0.7 * fade, additive: true });
    r.rect(Math.round(pr.x) - 1, Math.round(pr.y - pr.z), 2, 1, '#ffffff', fade);
    r.rect(Math.round(pr.x), Math.round(pr.y - pr.z) - 1, 1, 2, pr.color, fade);
  },
};

/** The burst at the end of a rocket's flight. */
function fireworkBurst(w: World, p: Player, x: number, y: number, weaponDamage: number, scheme: number, size: number): void {
  const pal = FIREWORKS[scheme % FIREWORKS.length];
  const radius = 26 + size * 1.5;
  const hit = new Set<number>();
  keeperBlast(w, p, x, y, radius, weaponDamage * FIREWORK_BLAST, { falloff: 0.4, knockback: 150, hit });
  // the ring of sparks flies past whoever the blast already caught
  const rot = (scheme * 0.39) % (Math.PI / 4);
  for (let i = 0; i < 8; i++) {
    const a = rot + (i / 8) * Math.PI * 2;
    const c = i % 4 === 1 ? pal.accent : pal.main[i % 3];
    const sp = new Projectile({
      team: 'player', x: x + Math.cos(a) * 3, y: y + Math.sin(a) * 3, angle: a, speed: 175, accel: -300, minSpeed: 25, radius: 2, range: 52, life: 0.5,
      damage: weaponDamage * FIREWORK_SPARK, owner: p, pierce: 2, color: c, style: 'none', light: 8, knockback: 30, fromWeapon: false,
      spectral: p.flags.has('spectral'), behaviors: [sparkFx], fxMaterial: 'fire',
    });
    sp.generation = 1;
    for (const id of hit) sp.hitIds.add(id);
    w.spawn(sp);
  }
  // visuals: core flash, coloured rings, embers
  w.particles.spawn({ x, y: y - 6, life: 0.12, size: 7, sizeEnd: 2, colors: ['#ffffff', pal.core], additive: true, light: 46, lightColor: pal.main[0] });
  w.particles.burst(x, y - 6, { count: 18, speed: [40, 150], life: [0.25, 0.55], colors: [pal.core, ...pal.main], size: [1, 2], sizeEnd: 0.5, additive: true, light: 6, gravity: 60 });
  w.particles.burst(x, y - 6, { count: 6, speed: [60, 120], life: [0.3, 0.5], colors: [pal.accent, '#ffffff'], size: [1, 1], shape: 'spark', additive: true });
  w.particles.burst(x, y, { count: 5, speed: [10, 30], life: [0.5, 0.9], colors: ['#706068', '#50484c'], size: [2, 3], sizeEnd: 5, drag: 3, fade: true });
  w.spawn(new RingFx(x, y - 2, radius, 0.24, pal.main[0], 2));
  w.spawn(new RingFx(x, y - 2, radius * 0.6, 0.18, pal.accent, 1));
  w.spawn(new FireworkCrackle(x, y, [pal.accent, ...pal.main]));
  w.lights.glow(x, y, radius * 2, pal.main[1], 0.6);
  w.shake(0.08);
  w.sfx('explosion', { vol: 0.32, pitch: 1.55, x });
  w.sfx('fire', { vol: 0.2, pitch: 1.9, x });
}

const rocketFx: ProjBehavior = {
  id: 'firework_rocket',
  update(pr, w) {
    // a lively corkscrew while it climbs to speed
    pr.angle += Math.sin(pr.age * 28 + pr.id) * Math.max(0, 0.35 - pr.age) * 0.03;
    const bx = pr.x - Math.cos(pr.angle) * 5;
    const by = pr.y - pr.z - Math.sin(pr.angle) * 5;
    w.particles.spawn({ x: bx, y: by, vx: -Math.cos(pr.angle) * 30 + fx.range(-12, 12), vy: -Math.sin(pr.angle) * 30 + fx.range(-12, 12), life: 0.2, colors: ['#ffffff', '#ffe080', '#ff8030'], size: 1, shape: 'spark', additive: true, gravity: 120 });
    if (fx.chance(0.4)) w.particles.spawn({ x: bx, y: by, vx: fx.range(-6, 6), vy: fx.range(-10, -2), life: 0.45, colors: ['#a09898', '#70686880'], size: 1, sizeEnd: 3, drag: 2, fade: true });
  },
  onExpire(pr, w) {
    const owner = pr.owner as Player | null;
    if (!owner || owner.team !== 'player') return;
    fireworkBurst(w, owner, pr.x, pr.y, Number(pr.mem.weaponDamage ?? owner.weaponStats.damage), pr.mem.scheme ?? 0, owner.weaponStats.projSize);
  },
  draw(pr, r) {
    r.sprite(glowSprite(8, '#ff9a30'), pr.x - Math.cos(pr.angle) * 6, pr.y - pr.z - Math.sin(pr.angle) * 6, { alpha: 0.75, additive: true });
    r.sprite('proj_firework_rocket', pr.x, pr.y - pr.z, { rot: pr.angle });
  },
};

defineWeapon({
  id: 'firework_barrel',
  name: '폭죽 통',
  desc: '조준한 곳까지 폭죽을 쏘아 올린다. 폭죽은 그 자리나 적에게 닿으면 터지고, 여덟 갈래 불꽃이 튀어 폭발 밖의 적까지 맞힌다.',
  icon: 'icon_firework_barrel',
  heldSprite: 'w_firework_barrel',
  kind: 'ranged',
  archetype: '폭죽',
  rarity: 'epic',
  tags: ['explosive', 'gun'],
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('fireRate', 0.66);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.weaponStats;
    const scheme = (st.mem.scheme = ((st.mem.scheme ?? -1) + 1) % FIREWORKS.length);
    const h = handPos(p, aim, 14);
    const d = aimDistance(w, p, 36, s.range * 1.1, s.range * 0.55);
    const flight = Math.max(16, d - 14);
    const shots = p.fireProjectiles(w, aim, {
      style: 'none', speed: s.shotSpeed * 0.8, accel: 520, maxSpeed: s.shotSpeed * 1.6, range: flight, life: 2.5, damageMult: FIREWORK_DIRECT,
      radius: s.projSize, knockback: 40, color: '#ff9a30', light: 16, x: h.x, y: h.y, behaviors: [rocketFx], fxMaterial: 'fire', spreadMult: 1.2,
    });
    for (const pr of shots) {
      // a firework flies true to its mark (no drift from the keeper's stride)
      pr.speed = s.shotSpeed * 0.8;
      pr.syncVel();
      pr.mem.scheme = scheme;
    }
    muzzle(w, h.x, h.y, aim, ['#ffffff', '#ffe080', '#ff8030'], 6, [40, 110]);
    w.particles.burst(h.x, h.y, { count: 4, speed: [10, 30], life: [0.4, 0.7], colors: ['#908088', '#605858'], size: [2, 3], sizeEnd: 4, drag: 3, fade: true });
    kick(w, aim + Math.PI, 1.4);
    w.sfx('fuse', { vol: 0.25, pitch: 1.6 });
    w.sfx('whoosh', { vol: 0.4, pitch: 1.25 + w.rng.next() * 0.1 });
  },
  draw(w, p, r, st) {
    drawGun(r, w, p, st, heldSprite('firework_barrel'), 5, 2.8);
    // the fuse fizzes at the back while the next rocket is ready
    const h = visualHandPos(p, p.aim, 5);
    const q = heldLocalPoint(h.x, h.y, p.aim, -4, -8);
    if (st.cooldown <= 0 || Math.floor(w.time * 18) % 2 === 0) {
      r.rect(Math.round(q.x), Math.round(q.y), 1, 1, '#fff4c0', 0.95);
      r.sprite(glowSprite(5 + Math.sin(w.time * 31), '#ff9a30'), q.x, q.y, { alpha: 0.5, additive: true });
    }
  },
});

// ================================================================== 뇌전 말뚝
defineDrawnSprite('w_tesla_stake', 16, 7, (p) => {
  // glass bulb at the back, iron shaft wound with copper, point forward
  p.circle(2.5, 3.5, 2.4, '#3a8ac8');
  p.circle(2.2, 3.2, 1.5, '#8ae8ff');
  p.px(2, 2, '#ffffff');
  p.rect(5, 2, 2, 3, '#c8a040');
  p.px(5, 2, '#fff0a0');
  p.rect(7, 3, 5, 1, '#5a5a6a');
  for (let x = 7; x < 12; x++) p.line(x, 2, x, 4, x % 2 ? '#e08a40' : '#a0582a');
  p.px(7, 2, '#ffc070');
  p.poly([12, 2, 16, 3.5, 12, 5], '#c8d0e4');
  p.line(12, 3, 15, 3, '#ffffff');
}, { outline: O, origin: [4, 3] });

/** A planted stake, upright (pivot at the point in the ground). */
defineDrawnSprite('fx_tesla_stake', 7, 15, (p) => {
  p.circle(3.5, 2.5, 2.5, '#3a8ac8');
  p.circle(3.2, 2.2, 1.6, '#8ae8ff');
  p.px(2, 1, '#ffffff');
  p.rect(1, 5, 5, 1, '#c8a040');
  p.px(1, 5, '#fff0a0');
  for (let y = 6; y < 10; y++) p.line(2, y, 4, y, y % 2 ? '#e08a40' : '#a0582a');
  p.px(2, 6, '#ffc070');
  p.poly([2, 10, 5, 10, 3.5, 15], '#8a92ac');
  p.line(3, 10, 3, 13, '#c8d0e4');
}, { outline: O, origin: [3, 14] });

defineDrawnSprite('icon_tesla_stake', 16, 16, (p) => {
  // the stake on the diagonal, point down-left
  p.poly([1, 15, 3, 11, 5, 13], '#8a92ac');
  p.line(2, 14, 3, 12, '#c8d0e4');
  for (let i = 0; i < 4; i++) p.line(4 + i, 12 - i, 5 + i, 13 - i, i % 2 ? '#e08a40' : '#a0582a');
  p.line(4, 12, 7, 9, '#a0582a');
  p.rect(8, 7, 2, 2, '#c8a040');
  p.circle(11, 5, 3, '#3a8ac8');
  p.circle(10.6, 4.6, 2, '#8ae8ff');
  p.px(10, 4, '#ffffff');
  // arcs leaping off the bulb
  p.line(13, 1, 15, 2, '#ffe860');
  p.line(15, 2, 14, 4, '#ffe860');
  p.line(14, 8, 16, 9, '#8ae8ff');
  p.px(12, 0, '#ffffff');
}, { outline: O });

/** Seconds a stake stays planted. */
export const TESLA_LIFE = 5;
/** Zap on the nearest foe within `TESLA_REACH` px (x weapon damage). */
export const TESLA_ZAP = 0.45;
/** The zap's single chain to another foe within `TESLA_CHAIN_REACH` px (x weapon damage). */
export const TESLA_CHAIN = 0.25;
/** The shock when a stake lands (x weapon damage). */
export const TESLA_LANDING = 0.9;
/** Fence damage per crossing (x weapon damage), at most once per `TESLA_FENCE_REHIT` s per foe. */
export const TESLA_FENCE = 0.45;
export const TESLA_REACH = 70;
export const TESLA_CHAIN_REACH = 40;
export const TESLA_FENCE_REHIT = 0.5;
/** A fence forms between stakes this far apart (px). */
export const TESLA_FENCE_MIN = 18;
export const TESLA_FENCE_MAX = 140;
/** Stakes one keeper can keep planted (the oldest is pulled out). */
export function teslaMaxStakes(shots: number): number {
  return 2 + Math.max(0, Math.floor(shots) - 1);
}

/** A planted coil stake: zaps the nearest foe on a beat and strings a fence to the next stake. */
export class TeslaStake extends Entity {
  owner: Player;
  mem: Record<string, number> = { tick: 0, dmg: 0, every: 0.5, zapAt: -9 };
  /** next time each foe may be shocked by this stake's fence (id -> time) */
  fenceNext = new Map<number, number>();
  constructor(owner: Player, x: number, y: number, dmg: number, every: number) {
    super();
    this.owner = owner;
    this.x = x;
    this.y = y;
    this.r = 4;
    this.mem.dmg = dmg;
    this.mem.every = every;
    this.mem.tick = every;
    this.layer = 1;
    this.tileCollide = false;
  }

  /** Shock the nearest foe in reach (and one more beside it). Returns true if anything was hit. */
  zap(w: World, mult: number): boolean {
    const tx = this.x;
    const ty = this.y - 13;
    let best: Enemy | null = null;
    let bd = TESLA_REACH;
    for (const e of w.enemies) {
      if (!e.alive || e.hidden) continue;
      const d = Math.hypot(e.x - this.x, e.y - this.y) - e.r;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (!best) return false;
    const first = best;
    w.spawn(new Zap(tx, ty, first.x, first.y - first.z - 4, '#6ac8ff', '#ffffff', 0.16, 4));
    keeperHit(w, this.owner, first, this.mem.dmg * mult, { src: this, kind: 'laser', fromX: this.x, fromY: this.y, knockback: 25 });
    w.particles.burst(first.x, first.y - first.z - 4, { count: 5, speed: [40, 110], life: [0.08, 0.2], colors: ['#ffffff', '#8ae8ff'], size: [1, 2], shape: 'spark', additive: true });
    // one leap to another foe close to the first
    let next: Enemy | null = null;
    let nd = TESLA_CHAIN_REACH;
    for (const e of w.enemies) {
      if (!e.alive || e.hidden || e === first) continue;
      const d = Math.hypot(e.x - first.x, e.y - first.y) - e.r;
      if (d < nd) {
        nd = d;
        next = e;
      }
    }
    if (next) {
      w.spawn(new Zap(first.x, first.y - first.z - 4, next.x, next.y - next.z - 4, '#4a9aff', '#e0f4ff', 0.14, 3));
      keeperHit(w, this.owner, next, this.mem.dmg * TESLA_CHAIN, { src: this, kind: 'laser', fromX: first.x, fromY: first.y, knockback: 15 });
    }
    this.mem.zapAt = w.time;
    w.sfx('lightning', { vol: 0.22, pitch: 1.7 + fx.range(-0.1, 0.15), x: this.x });
    return true;
  }

  /** The next stake this one strings its fence to (the next newer one of the same keeper). */
  partner(w: World): TeslaStake | null {
    const all = ownedBy(w, TeslaStake, this.owner);
    const i = all.indexOf(this);
    const q = i >= 0 ? all[i + 1] : undefined;
    if (!q) return null;
    const d = Math.hypot(q.x - this.x, q.y - this.y);
    return d >= TESLA_FENCE_MIN && d <= TESLA_FENCE_MAX ? q : null;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    // the stakes only answer the hand that holds the coil (a throw landing after a swap fizzles too)
    if (this.owner.weaponId !== 'tesla_stake' || !this.owner.alive) {
      this.fizzle(w);
      return;
    }
    this.mem.tick -= dt;
    if (this.mem.tick <= 0) {
      this.mem.tick += this.mem.every;
      this.zap(w, TESLA_ZAP);
    }
    const q = this.partner(w);
    if (q) {
      for (const e of w.enemies) {
        if (!e.alive || e.hidden || e.z > 18) continue;
        if (w.time < (this.fenceNext.get(e.id) ?? -1)) continue;
        if (segDist(e.x, e.y, this.x, this.y, q.x, q.y).d > e.r + 3) continue;
        this.fenceNext.set(e.id, w.time + TESLA_FENCE_REHIT);
        if (keeperHit(w, this.owner, e, this.mem.dmg * TESLA_FENCE, { src: this, kind: 'laser', fromX: e.x - (q.y - this.y), fromY: e.y + (q.x - this.x), knockback: 40 })) {
          w.particles.burst(e.x, e.y - e.z - 4, { count: 6, speed: [40, 120], life: [0.08, 0.2], colors: ['#ffffff', '#ffe860', '#8ae8ff'], size: [1, 2], shape: 'spark', additive: true });
          w.sfx('lightning', { vol: 0.18, pitch: 2.1, x: e.x });
        }
      }
    }
    if (this.age >= TESLA_LIFE) this.fizzle(w);
  }

  /** Burn out (end of its time, holstered, or pulled for a newer stake). */
  fizzle(w: World): void {
    if (this.dead) return;
    this.dead = true;
    w.particles.burst(this.x, this.y - 12, { count: 8, speed: [20, 70], life: [0.2, 0.4], colors: ['#ffffff', '#8ae8ff', '#3a8ac8'], size: [1, 1], shape: 'spark', additive: true });
    w.particles.burst(this.x, this.y - 4, { count: 4, speed: [10, 30], life: [0.4, 0.7], colors: ['#706878', '#504858'], size: [1, 2], sizeEnd: 3, drag: 2, fade: true });
  }

  override draw(r: Renderer, w: World): void {
    const left = TESLA_LIFE - this.age;
    const zapT = w.time - this.mem.zapAt;
    const charge = 1 - Math.max(0, this.mem.tick) / Math.max(0.01, this.mem.every);
    const flick = left < 0.8 && Math.floor(left * 16) % 2 === 0;
    r.shadow(this.x, this.y + 1, 7, 3, 0.35);
    r.sprite('fx_tesla_stake', this.x, this.y + 1, { flash: zapT >= 0 && zapT < 0.08 ? 0.7 : 0, alpha: flick ? 0.6 : 1 });
    // the bulb brightens as the next zap builds
    r.sprite(glowSprite(8 + charge * 6, '#6ac8ff'), this.x, this.y - 11, { alpha: 0.35 + charge * 0.4, additive: true });
    if (fx.chance(0.15 + charge * 0.3)) {
      const a = fx.range(0, Math.PI * 2);
      r.rect(Math.round(this.x + Math.cos(a) * 3), Math.round(this.y - 11 + Math.sin(a) * 3), 1, 1, '#ffffff');
    }
    // the fence to the next stake: a crackling double line between the bulbs
    const q = this.partner(w);
    if (!q) return;
    const x0 = this.x;
    const y0 = this.y - 11;
    const x1 = q.x;
    const y1 = q.y - 11;
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    const n = Math.max(2, Math.round(len / 8));
    const t = Math.floor(w.time * 24);
    let px = x0;
    let py = y0;
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const off = i === n ? 0 : Math.sin(t * 1.7 + i * 2.3 + this.id) * 3 * Math.sin(k * Math.PI);
      const qx = x0 + (x1 - x0) * k + nx * off;
      const qy = y0 + (y1 - y0) * k + ny * off;
      r.line(px, py, qx, qy, '#4a9aff', 2, 0.45);
      pixLine(r, px, py, qx, qy, i % 3 === t % 3 ? '#ffffff' : '#bfe8ff', 0.9);
      px = qx;
      py = qy;
    }
    // where it meets the ground
    r.sprite(glowSprite(12, '#6ac8ff'), (x0 + x1) / 2, (y0 + y1) / 2, { alpha: 0.25, additive: true });
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 11, 30, '#8ad8ff', { intensity: 0.6 });
    const q = this.partner(w);
    if (q) w.lights.add((this.x + q.x) / 2, (this.y + q.y) / 2 - 11, Math.min(70, 20 + Math.hypot(q.x - this.x, q.y - this.y) * 0.4), '#8ad8ff', { intensity: 0.45 });
  }
}

/** Plant a stake where a throw came down (pulls out the oldest beyond the cap). */
function plantStake(w: World, p: Player, x: number, y: number, dmg: number): void {
  const at = w.room.nearestFree(x, y, 4);
  // zaps every 0.5 s at the base fire rate (the throw itself is slow; fire-rate items still speed both)
  const every = attackInterval(p, 0.65);
  const stake = trackOwned(w, w.spawn(new TeslaStake(p, at.x, at.y, dmg, every)));
  const live = ownedBy(w, TeslaStake, p).filter((e) => e !== stake);
  const cap = teslaMaxStakes(p.weaponStats.shots);
  for (let i = 0; i <= live.length - cap; i++) live[i].fizzle(w);
  // landing shock
  stake.zap(w, TESLA_LANDING);
  w.spawn(new RingFx(at.x, at.y, 14, 0.2, '#8ae8ff', 1));
  w.particles.burst(at.x, at.y, { count: 6, speed: [20, 60], life: [0.2, 0.4], colors: ['#a09080', '#706050'], size: [1, 2], gravity: 200, vz: [20, 60] });
  w.sfx('spike', { vol: 0.3, pitch: 1.5, x: at.x });
}

function stakeThrow(flight: number): ProjBehavior {
  const land = (pr: Projectile, w: World) => {
    const owner = pr.owner as Player | null;
    if (!owner || owner.team !== 'player') return;
    plantStake(w, owner, pr.x, pr.y, Number(pr.mem.weaponDamage ?? owner.weaponStats.damage));
  };
  return {
    id: 'tesla_throw',
    update(pr, w) {
      const k = clamp(pr.traveled / Math.max(1, flight), 0, 1);
      pr.z = 5 + 4 * 14 * k * (1 - k);
      pr.mem.spin = pr.age * 16;
      // sails over foes; it only acts once it lands
      for (const e of w.enemies) pr.hitIds.add(e.id);
      for (const h of w.hittables) pr.hitIds.add(h.id);
      if (k >= 1 && !pr.dead) {
        pr.mem.landed = 1;
        land(pr, w);
        pr.dead = true;
      }
    },
    onWall(pr, w) {
      if (!pr.mem.landed) {
        pr.mem.landed = 1;
        const c = Math.cos(pr.angle);
        const s = Math.sin(pr.angle);
        const face = wallFace(w, pr.x, pr.y, pr.angle);
        pr.x = face.x - c * 4;
        pr.y = face.y - s * 4;
        land(pr, w);
      }
      return false;
    },
    onExpire(pr, w) {
      if (!pr.mem.landed) {
        pr.mem.landed = 1;
        land(pr, w);
      }
    },
    draw(pr, r) {
      r.shadow(pr.x, pr.y + 1, 6, 2, 0.3);
      r.sprite('w_tesla_stake', pr.x, pr.y - pr.z, { rot: pr.angle + (pr.mem.spin ?? 0) });
      r.sprite(glowSprite(6, '#6ac8ff'), pr.x, pr.y - pr.z, { alpha: 0.4, additive: true });
    },
  };
}

defineWeapon({
  id: 'tesla_stake',
  name: '뇌전 말뚝',
  desc: '조준한 곳에 말뚝을 던져 꽂는다. 꽂힐 때와 일정 간격마다 가까운 적에게 번개를 치고, 두 말뚝 사이에는 번개 울타리가 쳐져 지나는 적을 지진다.',
  icon: 'icon_tesla_stake',
  heldSprite: 'w_tesla_stake',
  kind: 'ranged',
  archetype: '설치',
  rarity: 'epic',
  tags: ['arcane'],
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('fireRate', 0.5);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.weaponStats;
    const h = handPos(p, aim, 9);
    const d = aimDistance(w, p, 24, 150, 80);
    const flight = Math.max(12, d - 9);
    const shots = p.fireProjectiles(w, aim, {
      count: 1, style: 'none', speed: 150 + flight * 1.2, range: flight + 2, life: 2, color: '#8ae8ff', light: 10, x: h.x, y: h.y,
      behaviors: [stakeThrow(flight)], fxMaterial: 'electric',
    });
    for (const pr of shots) {
      pr.vx = Math.cos(pr.angle) * pr.speed;
      pr.vy = Math.sin(pr.angle) * pr.speed;
    }
    kick(w, aim, 0.8);
    w.sfx('whoosh', { vol: 0.35, pitch: 1.3 });
    w.sfx('beam_charge', { vol: 0.1, pitch: 2.2 });
  },
  onHolster(w, p) {
    // the stakes only answer the hand that planted them
    for (const e of ownedBy(w, TeslaStake, p)) e.fizzle(w);
  },
  draw(w, p, r, st) {
    // the hand is empty for a beat after a throw, then the next stake is drawn
    const since = w.time - (st.mem.shotAt ?? -9);
    if (since < 0.22) return;
    const raise = since < 0.36 ? (since - 0.22) / 0.14 : 1;
    drawHeld(r, p, heldSprite('tesla_stake'), p.aim - (Math.cos(p.aim) < 0 ? -1 : 1) * 0.35 * (1 - raise), 3 + raise * 3, { alpha: raise });
    const h = visualHandPos(p, p.aim, 3 + raise * 3);
    const q = heldLocalPoint(h.x, h.y, p.aim, -2, 0);
    r.sprite(glowSprite(6 + Math.sin(w.time * 11), '#6ac8ff'), q.x, q.y, { alpha: 0.35 * raise, additive: true });
  },
});
