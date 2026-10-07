// Frontier arms I (field tools turned weapons; see also frontier-arms-2.ts):
//  공명 종     (resonance_bell, common melee) — every attack rings a hand bell: a
//                                             crisp ring expands around the keeper,
//                                             hits everything it passes once and
//                                             erases enemy bullets
//  작살총      (harpoon_gun, common)          — a barbed harpoon on a rope sticks in
//                                             its target, then reels it in for a
//                                             second, smaller hit

import { defineWeapon, type WeaponState } from '../../game/defs';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import { MeleeSwing, type SwingOpts } from '../../game/melee';
import type { Projectile, ProjBehavior } from '../../game/projectile';
import { defineDrawnSprite } from '../../engine/sprites';
import type { PixelPainter } from '../../engine/painter';
import { TAU, clamp } from '../../engine/math';
import { fx } from '../../engine/rng';
import { visualHandPos } from '../../game/weapon-pose';
import { heldLocalPoint } from '../../game/weapon-presentation';
import { O, attackInput, attackInterval, consumeAttack, glowSprite, handPos, kick } from './common';
import { beginAttack, drawGun, shotFade } from './kit';
import { OwnedList, enemyById, heldSpriteOf, ownedHit, pullToward, pullable } from './frontier-kit';

// ================================================================== 공명 종
defineDrawnSprite('w_resonance_bell', 13, 15, (p) => {
  // a hand bell hanging from its wooden handle (pivot at the top of the handle)
  p.rect(5, 1, 3, 4, '#9a6238');
  p.rect(5, 1, 1, 4, '#c89060');
  p.rect(7, 1, 1, 4, '#6a4028');
  p.rect(4, 5, 5, 1, '#8a5a20');
  p.px(4, 5, '#e8b450');
  // bronze body: rounded crown, slim waist, flaring to the lip; lit from the top left
  const hw = [2.5, 3, 3, 3.2, 3.9, 4.8];
  for (let i = 0; i < hw.length; i++) {
    const y = 6 + i;
    const x0 = Math.round(6.5 - hw[i]);
    const x1 = Math.round(6.5 + hw[i]);
    for (let x = x0; x < x1; x++) {
      const t = (x - x0) / Math.max(1, x1 - x0 - 1);
      p.px(x, y, t < 0.22 ? '#ffe08a' : t < 0.6 ? '#d8a040' : t < 0.85 ? '#a8702a' : '#6a4418');
    }
  }
  // a cast band, the rolled lip and the clapper under it
  for (let x = 4; x < 10; x++) p.px(x, 9, x < 6 ? '#fff4c0' : x < 8 ? '#e8b450' : '#8a5a20');
  for (let x = 1; x < 12; x++) p.px(x, 12, x < 4 ? '#fff0a8' : x < 9 ? '#e8b450' : '#8a5a20');
  p.px(6, 13, '#5a3a18');
  p.px(5, 7, '#ffffff');
}, { outline: O, origin: [6, 1] });

defineDrawnSprite('icon_resonance_bell', 16, 16, (p) => {
  // handle
  p.rect(7, 1, 2, 3, '#9a6238');
  p.px(7, 1, '#c89060');
  // body
  for (let y = 4; y <= 11; y++) {
    const hw = 1.5 + (y - 4) * 0.55;
    for (let x = Math.round(8 - hw); x < Math.round(8 + hw); x++) {
      const t = (x - (8 - hw)) / (2 * hw);
      p.px(x, y, t < 0.3 ? '#ffe08a' : t < 0.7 ? '#d8a040' : '#a8702a');
    }
  }
  p.rect(2, 12, 12, 1, '#fff0a8');
  p.rect(3, 12, 10, 1, '#e8b450');
  p.rect(7, 13, 2, 2, '#5a3a18');
  p.px(6, 6, '#ffffff');
  // sound arcs
  p.px(1, 6, '#fff0a0'); p.px(0, 8, '#fff0a0'); p.px(1, 10, '#fff0a0');
  p.px(14, 6, '#fff0a0'); p.px(15, 8, '#fff0a0'); p.px(14, 10, '#fff0a0');
}, { outline: O });

/** Seconds the ring takes to expand to full size. */
export const BELL_EXPAND = 0.18;
/** Starting radius of the ring (px). */
export const BELL_R0 = 14;
/** Full ring radius for a range stat (exported for tests). */
export function bellRadius(range: number): number {
  return 42 + clamp((range - 185) * 0.08, -10, 24);
}
/** The wave weakens as it spreads: damage lost at the full radius. */
export const BELL_FADE = 0.35;

/**
 * The bell's sound wave: a melee swing whose 360° reach grows from `BELL_R0`
 * to `r1`; each enemy is hit once when the front passes it, and enemy
 * bullets inside are erased (MeleeSwing's deflect).
 */
export class BellRing extends MeleeSwing {
  readonly r0: number;
  r1: number;
  readonly echo: boolean;
  /** damage at the centre (read on the first step, after item onSwing hooks adjusted damage / reach) */
  private baseDamage = -1;
  constructor(owner: Player, o: SwingOpts, r1: number, echo: boolean) {
    super(owner, o);
    this.r0 = o.reach;
    this.r1 = r1;
    this.echo = echo;
  }

  radiusAt(age: number): number {
    const k = clamp(age / BELL_EXPAND, 0, 1);
    return this.r0 + (this.r1 - this.r0) * (1 - (1 - k) * (1 - k));
  }

  override update(w: World, dt: number): void {
    if (this.baseDamage < 0) {
      // item onSwing hooks may have changed damage or added reach: keep both
      this.baseDamage = this.o.damage;
      this.r1 = Math.max(this.r0 + 8, this.r1 + this.o.reach - this.r0);
    }
    // enemies caught this step lay between last step's front and this one's: they get last step's strength
    const prev = this.radiusAt(this.age);
    this.o.reach = this.radiusAt(this.age + dt);
    this.o.damage = this.baseDamage * (1 - BELL_FADE * clamp((prev - this.r0) / Math.max(1, this.r1 - this.r0), 0, 1));
    super.update(w, dt);
  }

  override draw(r: Renderer): void {
    const t = this.age;
    const rad = this.radiusAt(t);
    const fade = t <= BELL_EXPAND ? 1 : clamp(1 - (t - BELL_EXPAND) / (this.o.visual - BELL_EXPAND), 0, 1);
    if (fade <= 0) return;
    const front = t <= BELL_EXPAND ? 1 - t / BELL_EXPAND : 0;
    const a = this.echo ? 0.6 : 1;
    // a faint trailing echo, the bright wave front with a white leading edge
    r.pixelRing(this.x, this.y, rad * 0.74, '#c89030', 1, 0.3 * fade * a);
    r.pixelRing(this.x, this.y, rad - 1, '#ffd060', front > 0.4 ? 3 : 2, 0.55 * fade * a);
    r.pixelRing(this.x, this.y, rad, '#fff6d0', 1, 0.95 * fade * a);
  }

  override light(w: World): void {
    const t = this.age;
    if (t > this.o.visual) return;
    w.lights.add(this.x, this.y, this.radiusAt(t) + 12, '#ffd890', { intensity: (this.echo ? 0.25 : 0.45) * (1 - t / this.o.visual) });
  }
}

function ringBell(w: World, p: Player, st: WeaponState, mult: number, echo: boolean): void {
  const s = p.weaponStats;
  const sw = new BellRing(p, {
    angle: p.aim, arc: TAU, reach: BELL_R0, damage: s.damage * mult, knockback: s.knockback * 0.9,
    color: '#ffe08a', duration: BELL_EXPAND + 0.02, visual: BELL_EXPAND + 0.16, style: 'none', hitKick: 0.35,
  }, bellRadius(s.range) * (echo ? 1.12 : 1), echo);
  w.items.onSwing(sw);
  w.spawn(sw);
  p.lastAttackAt = w.time;
  p.recoil = -1;
  st.mem.ringAt = w.time;
  w.particles.burst(sw.x, sw.y, { count: echo ? 6 : 12, speed: [190, 240], life: [0.14, 0.19], colors: ['#ffffff', '#ffe08a', '#d8a040'], shape: 'spark', size: [1, 2], additive: true });
  w.sfx('clock_chime', { vol: echo ? 0.28 : 0.5, pitch: (st.combo ? 1.19 : 1) * (echo ? 1.5 : 1) });
  if (!echo) w.sfx('parry', { vol: 0.12, pitch: 2.1 });
}

defineWeapon({
  id: 'resonance_bell',
  name: '공명 종',
  desc: '손종을 울려 주위로 퍼지는 고리를 만든다. 고리는 지나간 모든 적을 한 번씩 치고 적 탄환을 지운다. 한 적에게는 약하다.',
  icon: 'icon_resonance_bell',
  heldSprite: 'w_resonance_bell',
  kind: 'melee',
  archetype: '파동',
  rarity: 'common',
  tags: ['arcane'],
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('damage', 0.88);
    m.mulStat('fireRate', 1.04);
  },
  update(w, p, st, dt, firing, aim) {
    // multishot: echo rings follow the main ring
    if ((st.mem.echoes ?? 0) > 0) {
      st.mem.echoT = (st.mem.echoT ?? 0) - dt;
      if (st.mem.echoT <= 0) {
        st.mem.echoes--;
        st.mem.echoT = 0.11;
        ringBell(w, p, st, 0.5, true);
      }
    }
    if (!attackInput(st, w, firing) || st.cooldown > 0) return;
    consumeAttack(st);
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    st.combo = (st.combo + 1) % 2;
    st.comboTimer = st.cooldown + 0.5;
    ringBell(w, p, st, 1, false);
    st.mem.echoes = Math.max(0, Math.floor(p.weaponStats.shots) - 1);
    st.mem.echoT = 0.11;
    kick(w, aim, 0.4);
  },
  onHolster(_w, _p, st) {
    st.mem.echoes = 0;
  },
  draw(w, p, r, st) {
    // the bell hangs from the hand, swings hard on each ring and settles
    const t = w.time - (st.mem.ringAt ?? -9);
    const side = st.combo ? 1 : -1;
    const ring = t >= 0 && t < 0.5;
    const wob = ring ? Math.sin(t * 30) * (1 - t / 0.5) * 0.75 * side : Math.sin(w.time * 2.4 + p.id) * 0.06 - p.vx * 0.003;
    const h = visualHandPos(p, p.aim, 7);
    if (ring && t < 0.3) r.sprite(glowSprite(16, '#ffd060'), h.x - Math.sin(wob) * 9, h.y + 9, { alpha: 0.5 * (1 - t / 0.3), additive: true });
    r.sprite(heldSpriteOf('resonance_bell', 'w_resonance_bell'), h.x, h.y - 2, { rot: wob, flash: t >= 0 && t < 0.08 ? 0.5 : 0 });
  },
});

// ================================================================== 작살총
function harpoonGun(p: PixelPainter, loaded: boolean): void {
  // stock and grip
  p.rect(1, 4, 6, 2, '#7a4a2a');
  p.rect(1, 4, 6, 1, '#b07a48');
  p.rect(3, 6, 3, 2, '#5a341c');
  p.px(3, 7, '#7a4a2a');
  // iron receiver + barrel
  p.rect(6, 3, 5, 4, '#4a5060');
  p.rect(6, 3, 5, 1, '#8a92a8');
  p.rect(10, 3, 6, 2, '#5a6274');
  p.rect(10, 3, 6, 1, '#b0b8cc');
  p.rect(15, 2, 1, 4, '#3a404c');
  // rope drum under the barrel
  p.circle(9.5, 7.5, 1.7, '#c8a868');
  p.px(9, 7, '#8a6a40');
  p.px(8, 6, '#e8d0a0');
  if (loaded) {
    // barbed harpoon head poking out of the muzzle
    p.rect(16, 3, 2, 1, '#d8d0c0');
    p.poly([17.5, 1, 21, 3.5, 17.5, 6], '#d8e0f0');
    p.px(19, 3, '#ffffff');
    p.px(17, 1, '#8a92ac');
    p.px(17, 5, '#8a92ac');
  } else p.px(15, 3, '#141018');
}

defineDrawnSprite('w_harpoon_gun', 23, 11, (p) => harpoonGun(p, true), { outline: O, origin: [4, 5] });
defineDrawnSprite('w_harpoon_gun_bare', 23, 11, (p) => harpoonGun(p, false), { outline: O, origin: [4, 5] });

defineDrawnSprite('proj_harpoon', 15, 7, (p) => {
  // rope eye, shaft, barbed head
  p.px(1, 3, '#8a6a40');
  p.rect(2, 3, 8, 1, '#d8c8a0');
  p.px(3, 3, '#a89870');
  p.px(6, 3, '#a89870');
  p.poly([9, 1, 14, 3.5, 9, 6], '#d8e0f0');
  p.line(9, 2, 12, 3, '#ffffff');
  p.px(9, 1, '#8a92ac');
  p.px(9, 5, '#8a92ac');
  p.px(8, 1, '#a8b0c0');
  p.px(8, 5, '#a8b0c0');
}, { outline: O, origin: [9, 3] });

defineDrawnSprite('icon_harpoon_gun', 16, 16, (p) => {
  // stock and grip
  p.poly([1, 12, 5, 9.5, 6.5, 11.5, 2.5, 14.5], '#7a4a2a');
  p.line(2, 12, 5, 10, '#b07a48');
  p.line(5, 12, 5, 14, '#5a341c');
  // barrel
  p.line(5, 9, 10, 4, '#5a6274');
  p.line(6, 10, 11, 5, '#3a404c');
  p.line(5, 8, 9, 4, '#b0b8cc');
  // harpoon head leaving the muzzle
  p.line(11, 4, 12, 3, '#d8d0c0');
  p.poly([11.5, 1.5, 15.5, 0, 14, 4.5], '#d8e0f0');
  p.px(13, 2, '#ffffff');
  p.px(11, 2, '#8a92ac');
  // rope looping down from the head
  p.px(13, 5, '#e0c890'); p.px(14, 7, '#8a6a40'); p.px(14, 8, '#e0c890'); p.px(13, 10, '#e0c890'); p.px(12, 11, '#8a6a40'); p.px(10, 12, '#e0c890'); p.px(9, 13, '#e0c890');
}, { outline: O });

/** Harpoon timings (exported for tests). */
export const HARPOON_STICK = 0.6;
export const HARPOON_REEL = 0.22;
/** Reel speed (px/s) of a pullable enemy: ~40 px over the reel. */
export const HARPOON_REEL_SPEED = 230;
/** Second hit when the reel ends, relative to the harpoon hit. */
export const HARPOON_REEL_MULT = 0.62;
/** Rope length for a range stat. */
export function harpoonRope(range: number): number {
  return Math.max(90, range * 0.8);
}

const HARPOONS = new OwnedList<Projectile>();

function harpoonBehavior(p: Player, rope: number): ProjBehavior {
  const retract = (pr: Projectile, w: World) => {
    if (pr.mem.phase === 3) return;
    pr.mem.phase = 3;
    pr.mem.t = 0;
    pr.speed = 80;
    pr.homing = 0;
    w.sfx('clock_ratchet', { vol: 0.22, pitch: 1.5, x: pr.x });
  };
  const lock = (pr: Projectile, w: World) => {
    for (const e of w.enemies) pr.hitIds.add(e.id);
    for (const h of w.hittables) pr.hitIds.add(h.id);
  };
  return {
    id: 'harpoon',
    update(pr, w, dt) {
      const ph = pr.mem.phase ?? 0;
      if (ph === 0) {
        if (pr.traveled >= rope || pr.age > 2) retract(pr, w);
        return;
      }
      lock(pr, w);
      pr.homing = 0;
      if (ph === 1 || ph === 2) {
        const e = enemyById(w, pr.mem.tgt);
        if (!e || !e.alive) {
          retract(pr, w);
          return;
        }
        pr.x = e.x + (pr.mem.ox ?? 0);
        pr.y = e.y + (pr.mem.oy ?? 0);
        pr.speed = 0;
        pr.vx = pr.vy = 0;
        pr.mem.t = (pr.mem.t ?? 0) + dt;
        // the rope snaps when the keeper runs far away
        if (Math.hypot(e.x - p.x, e.y - p.y) > rope * 1.6) {
          w.particles.burst(pr.x, pr.y - pr.z, { count: 5, speed: [30, 80], life: [0.1, 0.25], colors: ['#e8d0a0', '#8a6a40'], size: [1, 2] });
          retract(pr, w);
          return;
        }
        if (ph === 1) {
          if (pr.mem.t >= HARPOON_STICK) {
            pr.mem.phase = 2;
            pr.mem.t = 0;
            w.sfx('clock_ratchet', { vol: 0.5, pitch: 0.8, x: e.x });
            w.sfx('clock_spring', { vol: 0.25, pitch: 1.3, x: e.x });
          }
          return;
        }
        // reeling: a light enemy is dragged toward the keeper (never into it)
        if (pullable(e) && Math.hypot(e.x - p.x, e.y - p.y) > 22) pullToward(e, p.x, p.y, HARPOON_REEL_SPEED);
        if (fx.chance(0.5)) w.particles.spawn({ x: pr.x + fx.range(-2, 2), y: pr.y - pr.z, vx: (p.x - pr.x) * 0.6, vy: (p.y - pr.y) * 0.6, life: 0.15, colors: ['#e8d0a0', '#a88858'], size: 1 });
        if (pr.mem.t >= HARPOON_REEL) {
          const d = Math.hypot(p.x - e.x, p.y - e.y) || 1;
          ownedHit(w, p, 'harpoon_gun', e, pr.damage * HARPOON_REEL_MULT, { kind: 'projectile', source: pr, dirX: (p.x - e.x) / d, dirY: (p.y - e.y) / d, knockback: 0 });
          w.particles.burst(pr.x, pr.y - pr.z, { count: 7, speed: [40, 110], life: [0.1, 0.25], colors: ['#ffffff', '#d8e0f0', '#e8d0a0'], shape: 'spark', size: [1, 2] });
          w.sfx('hit_metal', { vol: 0.4, pitch: 0.75, x: e.x });
          retract(pr, w);
        }
        return;
      }
      // ph 3: wind the rope back in; the barbs trail behind
      const hx = p.x;
      const hy = p.y - 5;
      const d = Math.hypot(hx - pr.x, hy - pr.y);
      pr.speed = Math.min(560, pr.speed + 1500 * dt);
      if (d < 7 + pr.speed * dt || pr.age > 5) {
        pr.mem.caught = 1;
        pr.dead = true;
        w.sfx('clock_snap', { vol: 0.25, pitch: 1.6 });
        return;
      }
      const a = Math.atan2(hy - pr.y, hx - pr.x);
      pr.angle = a + Math.PI;
      pr.vx = Math.cos(a) * pr.speed;
      pr.vy = Math.sin(a) * pr.speed;
    },
    onHit(pr, w, target) {
      if ((pr.mem.phase ?? 0) !== 0) return;
      pr.mem.phase = 1;
      pr.mem.tgt = target.id;
      pr.mem.t = 0;
      // bite in at the near side of the target
      const dx = pr.x - target.x;
      const dy = pr.y - target.y;
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(d, target.r * 0.6) / d;
      pr.mem.ox = dx * k;
      pr.mem.oy = dy * k;
      pr.speed = 0;
      pr.vx = pr.vy = 0;
      w.particles.burst(pr.x, pr.y - pr.z, { count: 6, speed: [40, 120], angle: pr.angle + Math.PI, spread: 1.2, life: [0.08, 0.2], colors: ['#ffffff', '#d8e0f0'], shape: 'spark', size: [1, 2] });
      w.sfx('hit_metal', { vol: 0.35, pitch: 1.3, x: pr.x });
    },
    onWall(pr, w) {
      if ((pr.mem.phase ?? 0) === 0) {
        w.particles.burst(pr.x, pr.y - pr.z, { count: 4, speed: [30, 80], angle: pr.angle + Math.PI, spread: 1.4, life: [0.08, 0.18], colors: ['#ffffff', '#c8b8a8'], shape: 'spark', size: [1, 2] });
        w.sfx('hit_metal', { vol: 0.25, pitch: 1.8, x: pr.x });
        retract(pr, w);
      }
      return true;
    },
    draw(pr, r) {
      r.shadow(pr.x, pr.y + 1, 6, 2, 0.2);
      r.sprite('proj_harpoon', pr.x, pr.y - pr.z, { rot: pr.angle });
    },
  };
}

/** A braided rope: alternating light / dark pixels along a (sagging) line. */
function drawRope(r: Renderer, x0: number, y0: number, x1: number, y1: number, sag: number, shake: number, t: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(2, Math.ceil(len));
  const nx = -(y1 - y0) / (len || 1);
  const ny = (x1 - x0) / (len || 1);
  let lx = NaN;
  let ly = NaN;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const s = Math.sin(k * Math.PI);
    const off = shake ? Math.sin(k * 23 + t * 70) * shake * s : 0;
    const x = Math.round(x0 + (x1 - x0) * k + nx * off);
    const y = Math.round(y0 + (y1 - y0) * k + ny * off + sag * s);
    if (x === lx && y === ly) continue;
    lx = x;
    ly = y;
    r.rect(x, y, 1, 1, i % 3 === 2 ? '#8a6a40' : '#e0c890');
  }
}

defineWeapon({
  id: 'harpoon_gun',
  name: '작살총',
  desc: '밧줄 달린 작살을 쏜다. 작살은 맞은 적에게 박혔다가 잠시 뒤 적을 끌어당기며 한 번 더 찌른다. 작살은 한 번에 하나만 날아간다.',
  icon: 'icon_harpoon_gun',
  heldSprite: 'w_harpoon_gun',
  kind: 'ranged',
  archetype: '작살',
  rarity: 'common',
  tags: ['gun'],
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('damage', 1.45);
    m.mulStat('shotSpeed', 1.35);
  },
  update(w, p, st, _dt, firing, aim) {
    const out = HARPOONS.live(w, st);
    st.mem.out = out.length;
    if (!firing || st.cooldown > 0 || out.length) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p, 0.4);
    const s = p.weaponStats;
    const h = handPos(p, aim, 18);
    const shots = p.fireProjectiles(w, aim, {
      style: 'none', x: h.x, y: h.y, range: 99999, life: 6, pierce: 999, bounce: 0, radius: s.projSize + 1,
      knockback: s.knockback * 0.4, color: '#d8e0f0', light: 6, behaviors: [harpoonBehavior(p, harpoonRope(s.range))],
    });
    for (const pr of shots) HARPOONS.add(w, st, pr);
    st.mem.out = shots.length;
    kick(w, aim, 1.2);
    w.renderer.kick(-Math.cos(aim) * 1.2, -Math.sin(aim) * 1.2);
    w.sfx('shoot', { vol: 0.5, pitch: 0.7 });
    w.sfx('clock_spring', { vol: 0.3, pitch: 1.6 });
    w.particles.burst(h.x, h.y, { count: 4, speed: [30, 90], angle: aim, spread: 0.6, life: [0.08, 0.16], colors: ['#ffffff', '#e8d0a0'], shape: 'spark', size: [1, 2] });
  },
  onHolster(w, _p, st) {
    for (const pr of HARPOONS.live(w, st)) pr.dead = true;
    st.mem.out = 0;
  },
  draw(w, p, r, st) {
    const out = HARPOONS.peek(w, st);
    const def = heldSpriteOf('harpoon_gun', 'w_harpoon_gun');
    const sprite = out.length && def === 'w_harpoon_gun' ? 'w_harpoon_gun_bare' : def;
    drawGun(r, w, p, st, sprite, 6, 3);
    if (!out.length) return;
    const f = shotFade(st, w, 0.16);
    const h = visualHandPos(p, p.aim, 6 - f * f * 3);
    const m = heldLocalPoint(h.x, h.y, p.aim, 12, -1);
    for (const pr of out) {
      const ph = pr.mem.phase ?? 0;
      const tx = pr.x - Math.cos(pr.angle) * 7;
      const ty = pr.y - pr.z - Math.sin(pr.angle) * 7;
      const sag = ph === 3 ? 3 : ph === 1 ? 1 : 0;
      drawRope(r, m.x, m.y, tx, ty, sag, ph === 2 ? 1 : 0, w.time);
    }
  },
});
