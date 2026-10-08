// Frontier arms II (see frontier-arms.ts):
//  투창 묶음   (javelin_bundle, common)       — heavy javelins pierce one enemy and
//                                             pin what they hit; an enemy driven
//                                             into a wall takes a bonus pin hit
//  연기 향로   (smoke_censer, common melee)   — a swung chain censer; every swing
//                                             leaves a smouldering incense cloud

import { defineWeapon, type WeaponState } from '../../game/defs';
import { multishotShare } from '../../game/stats';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import type { Enemy } from '../../game/enemy';
import { Entity } from '../../game/entity';
import type { Projectile, ProjBehavior } from '../../game/projectile';
import { defineDrawnSprite, hasSprite } from '../../engine/sprites';
import { bayer } from '../../engine/painter';
import { TAU, clamp } from '../../engine/math';
import { fx } from '../../engine/rng';
import { visualHandPos } from '../../game/weapon-pose';
import {
  O, attackInput, attackInterval, consumeAttack, drawHeld, glowSprite, handPos, kick, meleeRest, rayLength, startSwingPose, swingPose,
} from './common';
import { beginAttack, shotFade } from './kit';
import { OwnedList, enemyById, heldSpriteOf, ownedHit } from './frontier-kit';

// ================================================================== 투창 묶음
defineDrawnSprite('w_javelin', 29, 7, (p) => {
  // ash shaft (two-tone), leather grip, leaf-shaped iron head
  p.rect(1, 3, 20, 1, '#d8a868');
  p.rect(1, 4, 20, 1, '#8a5a30');
  p.px(1, 3, '#f0d8a8');
  p.rect(9, 3, 4, 2, '#7a2e1c');
  p.px(10, 3, '#b04a30');
  p.px(12, 3, '#b04a30');
  p.rect(20, 3, 2, 2, '#4a4a58');
  p.poly([21.5, 3.5, 24, 1, 27.5, 3.5, 24, 6], '#c8d0e0');
  p.line(22, 3, 26, 3, '#ffffff');
  p.rect(22, 4, 4, 1, '#7a82a0');
}, { outline: O, origin: [11, 4] });

defineDrawnSprite('proj_javelin', 26, 7, (p) => {
  p.rect(1, 3, 17, 1, '#d8a868');
  p.rect(1, 4, 17, 1, '#8a5a30');
  p.rect(7, 3, 3, 2, '#7a2e1c');
  p.rect(17, 3, 2, 2, '#4a4a58');
  p.poly([18.5, 3.5, 21, 1, 24.5, 3.5, 21, 6], '#c8d0e0');
  p.line(19, 3, 23, 3, '#ffffff');
  p.rect(19, 4, 4, 1, '#7a82a0');
}, { outline: O, origin: [21, 4] });

defineDrawnSprite('icon_javelin_bundle', 16, 16, (p) => {
  // three javelins tied at the butt, heads fanned out
  const jav = (x0: number, y0: number, x1: number, y1: number) => {
    const a = Math.atan2(y1 - y0, x1 - x0);
    p.line(x0, y0, x1, y1, '#d8a868');
    p.line(x0 + 1, y0, x1 + 1, y1, '#8a5a30');
    const tx = x1 + Math.cos(a) * 3.5;
    const ty = y1 + Math.sin(a) * 3.5;
    const nx = -Math.sin(a) * 1.6;
    const ny = Math.cos(a) * 1.6;
    p.poly([tx, ty, x1 + nx, y1 + ny, x1 - nx, y1 - ny], '#c8d0e0');
    p.px(Math.round(x1 + Math.cos(a) * 1.5), Math.round(y1 + Math.sin(a) * 1.5), '#ffffff');
  };
  jav(2, 15, 7, 4);
  jav(3, 15, 10, 6);
  jav(3, 14, 12, 9);
  // the cord around the bundle
  p.line(2, 11, 6, 13, '#c03a28');
  p.px(4, 12, '#ff7050');
}, { outline: O });

/** Bonus pin hit when a javelin's victim ends up against a wall (relative to the javelin hit). */
export const PIN_MULT = 0.6;
/** Stun from a javelin hit (non-boss), and from a pin. */
export const JAVELIN_STUN = 0.3;
export const PIN_STUN = 0.6;

/** A javelin quivering in a wall (visual only). */
class StuckJavelin extends Entity {
  static override readonly cosmetic = true;
  angle: number;
  life: number;
  constructor(x: number, y: number, angle: number, life: number) {
    super();
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.life = life;
    this.layer = 1;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.age > this.life) this.dead = true;
  }

  override draw(r: Renderer): void {
    const wob = Math.sin(this.age * 58) * Math.max(0, 0.3 - this.age) * 0.5;
    r.sprite('proj_javelin', this.x, this.y, { rot: this.angle + wob, alpha: clamp((this.life - this.age) * 4, 0, 1) });
  }
}

function pinEnemy(w: World, p: Player, e: Enemy, jav: Projectile, wx: number, wy: number): void {
  const key = 'pin' + e.id;
  if (jav.mem[key]) return;
  jav.mem[key] = 1;
  const a = jav.angle;
  ownedHit(w, p, 'javelin_bundle', e, jav.damage * PIN_MULT, { kind: 'projectile', source: jav, dirX: Math.cos(a), dirY: Math.sin(a), knockback: 0 });
  if (!e.isBoss && typeof e.applyStatus === 'function') e.applyStatus({ kind: 'stun', duration: PIN_STUN }, () => w.rng.next());
  // nailed at body height (the javelin flew 5 px above the floor)
  w.spawn(new StuckJavelin(wx - Math.cos(a) * 2, wy - 5 - Math.sin(a) * 2, a, 1.3));
  w.particles.burst(wx, wy, { count: 8, speed: [30, 90], angle: a + Math.PI, spread: 1.3, life: [0.2, 0.45], colors: ['#c8b8a8', '#8a7a6a', '#ffffff'], size: [1, 2], gravity: 200, vz: [20, 60] });
  w.sfx('hit_metal', { vol: 0.45, pitch: 0.62, x: e.x });
  w.sfx('rock_break', { vol: 0.15, pitch: 1.6, x: e.x });
  w.shake(0.07);
}

/** Watches a javelin victim for ~0.2 s: knocked into a wall -> pinned. */
class PinWatch extends Entity {
  owner: Player;
  jav: Projectile;
  tgt: number;
  lastKb = 0;
  constructor(owner: Player, jav: Projectile, tgt: number) {
    super();
    this.owner = owner;
    this.jav = jav;
    this.tgt = tgt;
    this.tileCollide = false;
    this.layer = 0;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const e = enemyById(w, this.tgt);
    if (!e || !e.alive || this.age > 0.22) {
      this.dead = true;
      return;
    }
    const kb = Math.hypot(e.kbx ?? 0, e.kby ?? 0);
    if (e.mem?.__bumped && this.lastKb > 18) {
      const a = this.jav.angle;
      pinEnemy(w, this.owner, e, this.jav, e.x + Math.cos(a) * (e.r + 1), e.y + Math.sin(a) * (e.r + 1));
      this.dead = true;
      return;
    }
    this.lastKb = kb;
  }
}

function javelinBehavior(p: Player): ProjBehavior {
  return {
    id: 'javelin',
    onHit(pr, w, target) {
      const e = target as Enemy;
      pr.mem.hitAt = pr.traveled;
      pr.mem.hitId = e.id;
      if (!e.isBoss && typeof e.applyStatus === 'function') e.applyStatus({ kind: 'stun', duration: JAVELIN_STUN }, () => w.rng.next());
      w.particles.burst(pr.x, pr.y - pr.z, { count: 5, speed: [50, 130], angle: pr.angle, spread: 0.8, life: [0.08, 0.2], colors: ['#ffffff', '#e0e8f8'], shape: 'spark', size: [1, 2] });
      if (!e.alive) return;
      // standing against a wall: nailed to it right away
      const reach = e.r + 7;
      const d = rayLength(w, e.x, e.y, pr.angle, reach);
      if (d < reach) pinEnemy(w, p, e, pr, e.x + Math.cos(pr.angle) * d, e.y + Math.sin(pr.angle) * d);
      else w.spawn(new PinWatch(p, pr, e.id));
    },
    onWall(pr, w) {
      // just passed through someone: it is pinned between javelin and wall
      const e = enemyById(w, pr.mem.hitId);
      if (e && e.alive && pr.traveled - (pr.mem.hitAt ?? -99) < 24) pinEnemy(w, p, e, pr, pr.x, pr.y - pr.z + 5);
      else w.spawn(new StuckJavelin(pr.x - Math.cos(pr.angle) * 2, pr.y - pr.z - Math.sin(pr.angle) * 2, pr.angle, 0.9));
      w.sfx('hit_metal', { vol: 0.25, pitch: 0.95 + fx.range(-0.05, 0.05), x: pr.x });
      w.particles.burst(pr.x, pr.y - pr.z, { count: 4, speed: [20, 60], angle: pr.angle + Math.PI, spread: 1.2, life: [0.15, 0.3], colors: ['#c8b8a8', '#8a7a6a'], size: [1, 2] });
      return false;
    },
    draw(pr, r) {
      r.shadow(pr.x, pr.y + 1, 10, 2, 0.22);
      r.sprite('proj_javelin', pr.x, pr.y - pr.z, { rot: pr.angle });
    },
  };
}

defineWeapon({
  id: 'javelin_bundle',
  name: '투창 묶음',
  desc: '무거운 투창을 던진다. 투창은 적 하나를 꿰뚫고 맞은 적을 잠깐 붙박는다. 벽에 밀려 박힌 적은 한 번 더 큰 피해를 입는다.',
  icon: 'icon_javelin_bundle',
  heldSprite: 'w_javelin',
  kind: 'ranged',
  archetype: '투창',
  rarity: 'common',
  tags: ['spear'],
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('damage', 1.6);
    m.mulStat('fireRate', 0.57);
    m.mulStat('shotSpeed', 1.45);
  },
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.weaponStats;
    const h = handPos(p, aim, 10);
    p.fireProjectiles(w, aim, {
      style: 'none', x: h.x, y: h.y, pierce: s.pierce + 1, radius: s.projSize + 1, knockback: s.knockback * 1.7,
      color: '#d8c090', light: 6, behaviors: [javelinBehavior(p)],
    });
    kick(w, aim, 1.1);
    w.sfx('whoosh', { vol: 0.5, pitch: 0.8 + w.rng.next() * 0.08 });
    w.sfx('swing', { vol: 0.3, pitch: 1.05 });
  },
  draw(w, p, r, st) {
    // carried low like the other spears; the throwing hand is empty for a moment, then the next javelin comes off the bundle
    const f = shotFade(st, w, 0.26);
    if (f > 0.62) return;
    const k = f / 0.62;
    const a = p.aim + (Math.cos(p.aim) >= 0 ? 0.35 : -0.35);
    drawHeld(r, p, heldSpriteOf('javelin_bundle', 'w_javelin'), a, -1 - k * 6, { alpha: 1 - k * 0.7 });
  },
});

// ================================================================== 연기 향로
defineDrawnSprite('w_smoke_censer', 11, 13, (p) => {
  // hanging ring, domed lid, pierced bowl glowing from inside, foot
  p.ring(5.5, 1.5, 1.5, 1, '#c8a040');
  p.rect(5, 2, 1, 1, '#8a6a30');
  p.rect(4, 3, 3, 1, '#e8c060');
  p.rect(3, 4, 5, 1, '#d8a848');
  p.rect(2, 5, 7, 1, '#a8782a');
  p.px(3, 4, '#fff0a0');
  p.rect(1, 6, 9, 4, '#a8702a');
  p.rect(1, 6, 9, 1, '#d8a040');
  p.rect(1, 9, 9, 1, '#6a4418');
  p.px(3, 7, '#ffb040');
  p.px(5, 7, '#ffd070');
  p.px(7, 7, '#ffb040');
  p.px(4, 8, '#ff7a20');
  p.px(6, 8, '#ff7a20');
  p.rect(3, 10, 5, 1, '#6a4418');
  p.rect(4, 11, 3, 1, '#8a5a20');
}, { outline: O, origin: [5, 1] });

defineDrawnSprite('icon_smoke_censer', 16, 16, (p) => {
  // chain from the top left, the censer, curls of smoke
  for (let i = 0; i < 5; i++) p.px(2 + i, 1 + i, i % 2 ? '#8a7a5a' : '#c8b080');
  p.rect(5, 6, 4, 1, '#e8c060');
  p.rect(4, 7, 6, 1, '#d8a848');
  p.rect(3, 8, 8, 4, '#a8702a');
  p.rect(3, 8, 8, 1, '#d8a040');
  p.px(5, 9, '#ffd070');
  p.px(8, 9, '#ffb040');
  p.px(6, 10, '#ff7a20');
  p.rect(5, 12, 4, 1, '#6a4418');
  p.px(12, 6, '#c8bcd4'); p.px(13, 5, '#c8bcd4'); p.px(13, 4, '#9a8eac'); p.px(12, 3, '#9a8eac');
  p.px(13, 2, '#c8bcd4'); p.px(14, 1, '#e0d8e8');
  p.px(11, 9, '#9a8eac'); p.px(12, 8, '#c8bcd4');
}, { outline: O });

/** Soft smoke puff (dithered disk, lit from the top left), cached per diameter. */
function puffSprite(d: number): string {
  const D = clamp(Math.round(d), 4, 28);
  const name = `__incense_puff_${D}`;
  if (hasSprite(name)) return name;
  defineDrawnSprite(name, D, D, (p) => {
    const r = D / 2;
    for (let y = 0; y < D; y++) {
      for (let x = 0; x < D; x++) {
        const dx = x + 0.5 - r;
        const dy = y + 0.5 - r;
        const k = Math.hypot(dx, dy) / r;
        if (k > 1) continue;
        if (k > 0.72 && bayer(x, y) > 0.5) continue;
        const lit = (-dx - dy) / (r * 1.4);
        p.px(x, y, lit > 0.35 ? '#e0d4e4b0' : lit > -0.25 ? '#ac9cb4a0' : '#7e6474a0');
      }
    }
  }, { origin: [Math.floor(D / 2), Math.floor(D / 2)] });
  return name;
}
for (const d of [10, 12, 14, 16, 18]) puffSprite(d);

/** Incense ticks: every enemy inside takes at most one tick per this many seconds, however many clouds overlap. */
export const CENSER_TICK = 0.4;
/** Tick damage relative to the swing. */
export const CENSER_TICK_MULT = 0.25;
export const CENSER_CLOUD_LIFE = 1.6;
export const CENSER_MAX_CLOUDS = 3;
/** Swing reach for a range stat. */
export function censerReach(range: number): number {
  return 32 + range * 0.025;
}

/** A smouldering incense cloud: soft smoke with an ember glow; light damage ticks to enemies inside. */
export class IncenseCloud extends Entity {
  owner: Player;
  rad: number;
  life: number;
  dmg: number;
  ticks: Map<number, number>;
  fading = -1;
  constructor(owner: Player, x: number, y: number, rad: number, dmg: number, ticks: Map<number, number>) {
    super();
    this.owner = owner;
    this.x = x;
    this.y = y;
    this.rad = rad;
    this.dmg = dmg;
    this.ticks = ticks;
    this.life = CENSER_CLOUD_LIFE;
    this.layer = 2;
    this.tileCollide = false;
  }

  /** Thin out quickly (replaced by a newer cloud). */
  fade(): void {
    if (this.fading < 0) this.fading = 0;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.fading >= 0) {
      this.fading += dt;
      if (this.fading >= 0.3) this.dead = true;
      return;
    }
    if (this.age >= this.life) {
      this.dead = true;
      return;
    }
    if (this.age >= 0.1) {
      for (const e of [...w.enemies]) {
        if (!e.alive || e.hidden || e.z > 12) continue;
        if (Math.hypot(e.x - this.x, e.y - this.y) > this.rad + e.r * 0.5) continue;
        if (w.time < (this.ticks.get(e.id) ?? -1)) continue;
        this.ticks.set(e.id, w.time + CENSER_TICK);
        if (ownedHit(w, this.owner, 'smoke_censer', e, this.dmg, { kind: 'status', light: true, noProc: true, procs: ['incense'] })) {
          w.particles.burst(e.x, e.y - e.z - 4, { count: 3, speed: [10, 30], life: [0.25, 0.45], colors: ['#ffd070', '#ff8a30', '#a89cb8'], size: [1, 1], gravity: -60, additive: true });
        }
      }
    }
    if (fx.chance(dt * 9)) {
      const a = fx.range(0, TAU);
      const rr = fx.range(0, this.rad * 0.8);
      w.particles.spawn({ x: this.x + Math.cos(a) * rr, y: this.y + Math.sin(a) * rr * 0.7, vy: -14, vx: fx.range(-4, 4), life: 0.7, colors: ['#c8bcd4', '#9a8eac', '#6e6284'], size: 1.5, sizeEnd: 3, fade: true, alpha: 0.5 });
    }
    if (fx.chance(dt * 4)) w.particles.spawn({ x: this.x + fx.range(-6, 6), y: this.y + fx.range(-4, 4), vy: -24, life: 0.5, colors: ['#ffe080', '#ff8a30'], size: 1, additive: true });
  }

  override draw(r: Renderer, w: World): void {
    const grow = clamp(this.age / 0.18, 0, 1);
    const out = this.fading >= 0 ? 1 - this.fading / 0.3 : clamp((this.life - this.age) / 0.45, 0, 1);
    const a = grow * out;
    if (a <= 0) return;
    const R = this.rad * (0.55 + 0.45 * grow);
    // warm ember glow under the smoke
    const fl = 1 + 0.12 * Math.sin(w.time * 19 + this.id);
    r.sprite(glowSprite(R * 1.5 * fl, '#ff8a30'), this.x, this.y, { alpha: 0.3 * a, additive: true, sy: 0.7 });
    // seven drifting puffs (fixed layout per cloud, breathing slowly)
    for (let i = 0; i < 7; i++) {
      const ang = (i / 6) * TAU + this.id * 0.7 + this.age * 0.35;
      const rr = i === 6 ? 0 : R * 0.55;
      const bob = Math.sin(w.time * 1.8 + i * 1.3) * 1.2;
      const d = (i === 6 ? 1.05 : 0.8) * R * (0.95 + 0.08 * Math.sin(w.time * 2.3 + i));
      r.sprite(puffSprite(d), this.x + Math.cos(ang) * rr, this.y + Math.sin(ang) * rr * 0.7 - 2 + bob - this.age * 2, { alpha: 0.58 * a });
    }
    // embers twinkling inside
    for (let i = 0; i < 3; i++) {
      const tw = Math.sin(w.time * 9 + i * 2.1 + this.id);
      if (tw < 0.2) continue;
      const ang = i * 2.2 + this.id;
      r.rect(this.x + Math.cos(ang) * R * 0.35, this.y + Math.sin(ang) * R * 0.25 - 2, 1, 1, tw > 0.7 ? '#ffe080' : '#ff8a30', a);
    }
  }

  override light(w: World): void {
    const out = this.fading >= 0 ? 1 - this.fading / 0.3 : clamp((this.life - this.age) / 0.45, 0, 1);
    w.lights.add(this.x, this.y, this.rad * 1.6, '#ff9a40', { intensity: 0.35 * out });
  }
}

const CLOUDS = new OwnedList<IncenseCloud>();
const CLOUD_TICKS = new WeakMap<WeaponState, Map<number, number>>();

function cloudTicks(w: World, st: WeaponState): Map<number, number> {
  let m = CLOUD_TICKS.get(st);
  if (!m) CLOUD_TICKS.set(st, (m = new Map()));
  if (st.mem.cloudRoom !== w.node.id) {
    st.mem.cloudRoom = w.node.id;
    m.clear();
  }
  return m;
}

/** Censer pot position for a pose angle (draw and idle smoke share it). */
function censerAt(p: Player, angle: number, ext: number, reach: number, rest: boolean): { hx: number; hy: number; x: number; y: number } {
  const h = visualHandPos(p, angle, 4);
  const len = 5 + ext * (reach - 12);
  return { hx: h.x, hy: h.y, x: h.x + Math.cos(angle) * len, y: h.y + Math.sin(angle) * len * 0.8 + (rest ? 4 : 0) };
}

defineWeapon({
  id: 'smoke_censer',
  name: '연기 향로',
  desc: '사슬에 매단 향로를 휘두른다. 휘두를 때마다 끝자락에 향 연기가 피어올라 안에 있는 적에게 잔불 피해를 준다. 연기는 셋까지 남는다.',
  icon: 'icon_smoke_censer',
  heldSprite: 'w_smoke_censer',
  kind: 'melee',
  archetype: '향로',
  rarity: 'common',
  tags: ['heavy'],
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('damage', 0.95);
    m.mulStat('fireRate', 0.72);
  },
  update(w, p, st, dt, firing, aim) {
    const ticks = cloudTicks(w, st);
    // idle wisps rising from the pot (cosmetic)
    if (fx.chance(dt * 5)) {
      const c = censerAt(p, meleeRest(st, p.aim), 0, 0, true);
      w.particles.spawn({ x: c.x + fx.range(-1, 1), y: c.y + 2, vy: -16, vx: fx.range(-3, 3), life: 0.6, colors: ['#c8bcd4', '#9a8eac'], size: 1, sizeEnd: 2, fade: true, alpha: 0.6 });
    }
    if (!attackInput(st, w, firing) || st.cooldown > 0) return;
    consumeAttack(st);
    beginAttack(w, p, st, aim);
    const s = p.weaponStats;
    const dir = st.combo % 2 ? -1 : 1;
    const reach = censerReach(s.range);
    p.swing(w, {
      angle: aim, arc: 2.3, reach, damage: s.damage, knockback: s.knockback * 1.6, swingDir: dir,
      color: '#ffc890', visual: 0.2, duration: 0.1, hitKick: 1.3,
    });
    startSwingPose(st, w, aim - 1.2 * dir, aim + 1.2 * dir, 0.11, 0.06);
    st.mem.reach = reach;
    st.cooldown = attackInterval(p);
    st.combo = (st.combo + 1) % 2;
    st.comboTimer = st.cooldown + 0.6;
    // incense billows at the far end of the swing (multishot: a fan of clouds)
    const n = Math.max(1, Math.floor(s.shots));
    const cap = CENSER_MAX_CLOUDS + n - 1;
    const live = CLOUDS.live(w, st);
    for (let i = 0; i < n; i++) {
      const a = aim + (i - (n - 1) / 2) * 0.7;
      const cd = rayLength(w, p.x, p.y - 3, a, reach * 0.85);
      const cloud = new IncenseCloud(p, p.x + Math.cos(a) * cd, p.y - 3 + Math.sin(a) * cd, 22 + (s.projSize - 3) * 2, s.damage * CENSER_TICK_MULT * multishotShare(n), ticks);
      while (live.length >= cap) {
        const old = live.shift()!;
        old.fade();
        CLOUDS.remove(st, old);
      }
      w.spawn(cloud);
      CLOUDS.add(w, st, cloud);
      live.push(cloud);
      w.particles.burst(cloud.x, cloud.y, { count: 8, speed: [15, 45], life: [0.3, 0.6], colors: ['#d8d0e0', '#a89cb8', '#ffb060'], size: [1, 2], drag: 3 });
    }
    kick(w, aim, 1.1);
    w.sfx('swing_heavy', { vol: 0.42, pitch: 1.15 });
    w.sfx('clock_steam', { vol: 0.25, pitch: 0.9 + w.rng.next() * 0.1 });
  },
  onHolster(w, _p, st) {
    for (const c of CLOUDS.live(w, st)) c.fade();
  },
  draw(w, p, r, st) {
    const pose = swingPose(st, w, meleeRest(st, p.aim));
    const rest = pose.phase === 0;
    const ext = pose.phase === 1 ? 1 : pose.phase === 2 ? 0.92 : pose.phase === 3 ? 0.92 * (1 - pose.t) : 0;
    const c = censerAt(p, pose.angle, ext, st.mem.reach ?? censerReach(p.weaponStats.range), rest);
    // brass chain: alternating links, sagging at rest
    const len = Math.hypot(c.x - c.hx, c.y - c.hy);
    const n = Math.max(2, Math.round(len / 2));
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const sag = rest ? Math.sin(k * Math.PI) * 1.5 : 0;
      r.rect(Math.round(c.hx + (c.x - c.hx) * k), Math.round(c.hy + (c.y - c.hy) * k + sag), 1, 1, i % 2 ? '#8a7a5a' : '#d8c088');
    }
    const sway = rest ? Math.sin(w.time * 3 + p.id) * 0.18 : pose.angle - Math.PI / 2;
    r.sprite(glowSprite(10, '#ff9a40'), c.x, c.y + 6, { alpha: 0.3 + 0.1 * Math.sin(w.time * 11), additive: true });
    r.sprite(heldSpriteOf('smoke_censer', 'w_smoke_censer'), c.x, c.y, { rot: sway });
  },
});
