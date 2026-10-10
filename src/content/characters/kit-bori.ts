// 보리's kit — the Saint Bernard rescue dog, built around the little barrel on
// her collar.
//   passive 구조통: health flames (불꽃) picked up at full health are stored in the barrel
//     (max 3 charges; +½ per cleared room, a little per blocked bullet). When
//     보리 is hurt the barrel pours a healing puddle at her feet (keepers inside
//     heal ½ 칸 every 0.9 s, up to 1 칸); the potion key with no potion drinks a
//     charge (+1 칸, +1 shield), and at 1 칸 she gulps one automatically. She is
//     heavy (knockback resistance).
//   dash 몸통 밀치기: a short, heavy shove; a shield wall in front blocks bullets
//     and shoves enemies for ~0.3 s
//   affinity 둔기·도끼 / 방패: with a mace, hammer, axe, flail or scythe or a shield
//     in hand the body block stands longer and wider and shoves harder (longer
//     stun), and every weapon hit pours a little into the barrel (by the hit's
//     size); +30% knockback as flavour
//   release 구조의 울음 (releaseRescueHowl): a howl that stuns and knocks every
//     enemy around, heals, then a lantern beacon pulses for 2.4 s
//
// Co-op note (read by the multiplayer workstream later): `RescuePuddle.heals`
// is written so every keeper standing in it can be healed; CharacterDef.coop on
// 보리 asks for faster revives.

import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import type { AffinityDef, DashDef, PassiveDef } from '../../game/defs';
import { Entity } from '../../game/entity';
import { LIFE_HEAL_TEXT, LIFE_ICON, RingFx } from '../../game/effects';
import { PRESS } from '../../game/seam';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { clamp } from '../../engine/math';
import { glowSprite } from '../weapons/common';
import { bossSafe, cooldown, hitShare, isAttack, proc } from '../items/lib';
import { Enemy } from '../../game/enemy';
import { HitFalloff, clearBullets, releaseHit } from './releases';
import { KitTimeline, everyTick, releaseOpen } from './kit-common';
import { O } from './kit';

export const BORI_MAX_CHARGES = 3;
/** barrel gained per cleared room and per bullet blocked by the body block */
export const BORI_ROOM_CHARGE = 0.5;
export const BORI_BLOCK_CHARGE = 0.1;
/** puddle: life (s), radius, seconds per ½ 칸 healed, max ½ 칸 per puddle */
export const BORI_PUDDLE_LIFE = 4;
export const BORI_PUDDLE_RADIUS = 20;
export const BORI_PUDDLE_HEAL_EVERY = 0.9;
export const BORI_PUDDLE_HEAL_MAX = 2;
/** drinking a charge: ½ 칸 healed, shields granted (cap) */
export const BORI_DRINK_HEAL = 2;
export const BORI_SHIELD_CAP = 2;
/** knockback resistance (Entity.mass; 1 = a normal keeper) */
export const BORI_MASS = 2.6;
/** body block: duration (s), bullet-block radius, shove damage (fraction of player damage), stun (s), knockback */
export const BORI_BLOCK_TIME = 0.32;
export const BORI_BLOCK_RADIUS = 20;
export const BORI_SHOVE_DMG = 0.6;
export const BORI_SHOVE_STUN = 0.3;
export const BORI_SHOVE_KNOCK = 320;
/** affinity (둔기·도끼 / 방패): the body block's duration, radius, shove damage and stun */
export const BORI_BLOCK_TIME_AFFINITY = 0.45;
export const BORI_BLOCK_RADIUS_AFFINITY = 24;
export const BORI_SHOVE_DMG_AFFINITY = 1.2;
export const BORI_SHOVE_STUN_AFFINITY = 0.6;
/** affinity: barrel poured in per weapon hit, x the hit's size (hitShare: 1 = one plain hit) */
export const BORI_HIT_CHARGE = 0.02;
/** release: howl damage, beacon pulses (damage each, with falloff), final pulse */
export const BORI_HOWL_DMG = 3;
export const BORI_HOWL_RADIUS = 95;
export const BORI_BEACON_DMG = 1.2;
export const BORI_BEACON_RADIUS = 56;
export const BORI_BEACON_PULSES = 6;
export const BORI_BEACON_FINAL = 2;
export const BORI_BEACON_FALLOFF = 0.9;

const WARM = ['#ffffff', '#ffe8c0', '#ffd9b0', '#e8a060'];
const BARREL = '#9a6a3a';

// ------------------------------------------------------------------ icons
defineDrawnSprite('icon_bori_passive', 16, 16, (p) => {
  // the rescue barrel: wooden staves, two gold bands, a red cross
  p.ellipse(8, 8, 6.5, 7, '#6a4424');
  p.ellipse(8, 8, 5.5, 6, BARREL);
  p.rect(3, 4, 10, 1, '#f0c050');
  p.rect(3, 11, 10, 1, '#f0c050');
  p.rect(4, 5, 1, 6, '#c89858');
  p.rect(7, 5, 2, 6, '#d83c2c');
  p.rect(5, 7, 6, 2, '#d83c2c');
  p.rect(7, 7, 2, 2, '#ff7a6a');
  p.px(11, 6, '#6a4424');
}, { outline: O });

defineDrawnSprite('icon_bori_dash', 16, 16, (p) => {
  // a shield wall (arc) with a heavy shoulder pushing into it, sparks bouncing off
  p.poly([3, 8, 8, 3, 11, 5, 11, 11, 8, 13], '#e8a060');
  p.poly([4, 8, 8, 5, 10, 6, 10, 10, 8, 11], '#ffd9b0');
  for (let y = 2; y <= 14; y++) {
    const x = 12 + Math.round(Math.sin(((y - 2) / 12) * Math.PI) * 2.5);
    p.px(x, y, '#ffe8c0');
    p.px(x - 1, y, '#e8a06080');
  }
  p.px(0, 7, '#ffffff');
  p.px(1, 8, '#ffe8c0');
  p.px(2, 6, '#ffe8c0');
}, { outline: O });

// tiny barrel charge pip (drawn above the keeper)
defineDrawnSprite('fx_bori_charge', 5, 6, (p) => {
  p.rect(0, 1, 5, 4, BARREL);
  p.rect(1, 0, 3, 6, BARREL);
  p.rect(0, 1, 5, 1, '#f0c050');
  p.rect(0, 4, 5, 1, '#f0c050');
  p.px(2, 2, '#d83c2c');
  p.px(2, 3, '#d83c2c');
}, { outline: '#3a2410' });

for (let d = 20; d <= 44; d += 4) glowSprite(d, '#ffb86a');

// ------------------------------------------------------------------ barrel
/** Is the context keeper holding a favoured weapon (둔기·도끼 / 방패)? */
export function boriAffinity(w: World): boolean {
  return w.player.flags.has('affinity');
}

/** Barrel charges (0..BORI_MAX_CHARGES, fractional while filling). */
export function barrel(w: World): number {
  return w.vars.__boriBarrel ?? 0;
}

/** Add charges (clamped). Returns how much was actually added; a full new charge rings the barrel. */
export function addBarrel(w: World, n: number, quiet = false): number {
  const cur = barrel(w);
  const next = clamp(cur + n, 0, BORI_MAX_CHARGES);
  w.vars.__boriBarrel = next;
  const gained = next - cur;
  if (gained <= 0) return 0;
  const p = w.player;
  if (Math.floor(next) > Math.floor(cur)) {
    w.sfx('bori_barrel', { vol: 0.6, pitch: 0.9 + Math.floor(next) * 0.08 });
    w.particles.burst(p.x, p.y - 12, { count: 8, speed: [15, 50], life: [0.25, 0.5], colors: WARM, size: [1, 2], vz: [20, 50], gravity: -30 });
    if (!quiet) w.floatText(p.x, p.y - 24, `통 ${Math.floor(next)}/${BORI_MAX_CHARGES}`, '#ffd9b0');
    proc(w, 'passive:bori', quiet);
  } else proc(w, 'passive:bori', true);
  return gained;
}

function spendBarrel(w: World, n = 1): boolean {
  if (barrel(w) < n) return false;
  w.vars.__boriBarrel = barrel(w) - n;
  return true;
}

/** Drink one charge: heal and a one-hit shield. Returns false with an empty barrel. */
export function drink(w: World, auto = false): boolean {
  const p = w.player;
  if (!p.alive || !spendBarrel(w)) return false;
  const healed = p.heal(BORI_DRINK_HEAL);
  p.shields = Math.min(BORI_SHIELD_CAP, p.shields + 1);
  w.sfx('bori_drink', { vol: 0.8 });
  w.sfx('heal', { vol: 0.5, pitch: 1.1 });
  w.spawn(new RingFx(p.x, p.y - 6, 26, 0.35, '#c8f0ff', 2));
  w.particles.burst(p.x, p.y - 10, { count: 16, speed: [20, 70], life: [0.3, 0.6], colors: ['#ff6070', '#ffd9b0', '#ffffff'], size: [1, 2], vz: [20, 60], gravity: -40 });
  if (healed > 0) w.floatText(p.x, p.y - 24, auto ? '꿀꺽! +' : '+', LIFE_HEAL_TEXT, 1, LIFE_ICON);
  else w.floatText(p.x, p.y - 24, '+방패', '#ff8090');
  proc(w, 'passive:bori');
  return true;
}

// ------------------------------------------------------------------ puddle
/**
 * The barrel's spill: a warm puddle that heals keepers standing in it. Gameplay
 * entity (heals); room-bound. `heals` counts the ½ 칸 it has given away.
 */
export class RescuePuddle extends Entity {
  heals = 0;
  tick = 0;
  room: unknown;
  constructor(w: World, x: number, y: number) {
    super();
    this.x = x;
    this.y = y;
    this.r = BORI_PUDDLE_RADIUS;
    this.layer = 0;
    this.tileCollide = false;
    this.team = 'player';
    this.room = w.room;
  }

  /** Is `a` inside the puddle? (co-op: call for every keeper) */
  covers(a: { x: number; y: number }): boolean {
    const dx = a.x - this.x;
    const dy = a.y - this.y;
    return dx * dx + dy * dy <= this.r * this.r;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.room !== w.room || this.age >= BORI_PUDDLE_LIFE || this.heals >= BORI_PUDDLE_HEAL_MAX) {
      this.dead = true;
      return;
    }
    const p = w.player;
    if (p.alive && this.covers(p)) {
      this.tick += dt;
      if (this.tick >= BORI_PUDDLE_HEAL_EVERY) {
        this.tick -= BORI_PUDDLE_HEAL_EVERY;
        if (p.red < p.maxRed) {
          p.heal(1);
          this.heals++;
          w.sfx('heal', { vol: 0.4, pitch: 1.2 });
          w.floatText(p.x, p.y - 20, '+0.5', LIFE_HEAL_TEXT, 1, LIFE_ICON);
          w.particles.burst(p.x, p.y - 8, { count: 6, speed: [10, 40], life: [0.3, 0.6], colors: ['#ff6070', '#ffd9b0'], size: [1, 2], vz: [20, 50], gravity: -40 });
          proc(w, 'passive:bori', true);
        }
      }
    } else this.tick = Math.min(this.tick, BORI_PUDDLE_HEAL_EVERY * 0.5);
    if (fx.chance(dt * 8)) {
      const a = fx.angle();
      const rr = fx.range(0, this.r * 0.8);
      w.particles.spawn({ x: this.x + Math.cos(a) * rr, y: this.y + Math.sin(a) * rr * 0.6, vy: -fx.range(6, 14), life: 0.5, colors: ['#ffffff', '#ffd9b0', '#ff9090'], size: 1, additive: true });
    }
  }

  override draw(r: Renderer): void {
    const left = BORI_PUDDLE_LIFE - this.age;
    const a = clamp(Math.min(this.age / 0.2, left / 0.5), 0, 1);
    const R = this.r;
    r.circle(this.x, this.y, R, '#7a3020', 0.3 * a);
    r.circle(this.x - 1, this.y - 1, R * 0.8, '#c86048', 0.35 * a);
    r.circle(this.x - 2, this.y - 2, R * 0.45, '#ffb8a0', 0.3 * a);
    // a little red cross floats in the middle
    const bob = Math.sin(this.age * 4) * 0.8;
    r.rect(this.x - 1, this.y - 4 + bob, 2, 6, '#ff7070', 0.9 * a);
    r.rect(this.x - 3, this.y - 2 + bob, 6, 2, '#ff7070', 0.9 * a);
    r.ring(this.x, this.y, R, '#ffd9b0', 1, 0.45 * a * (0.8 + 0.2 * Math.sin(this.age * 5)));
  }

  override light(w: World): void {
    const left = BORI_PUDDLE_LIFE - this.age;
    w.lights.add(this.x, this.y, 36, '#ffb86a', { intensity: 0.5 * clamp(left / 0.5, 0, 1) });
  }
}

/** Pour a puddle at the keeper's feet (one charge). */
export function spill(w: World): RescuePuddle | null {
  const p = w.player;
  if (!spendBarrel(w)) return null;
  const z = w.spawn(new RescuePuddle(w, p.x, p.y + 3));
  w.sfx('bori_barrel', { vol: 0.7, pitch: 0.75 });
  w.particles.burst(p.x, p.y - 6, { count: 14, speed: [20, 70], life: [0.3, 0.6], colors: ['#ffd9b0', '#ff9090', '#ffffff'], size: [1, 2], gravity: 240, vz: [20, 70] });
  w.floatText(p.x, p.y - 24, '구조통이 쏟아진다', '#ffd9b0');
  proc(w, 'passive:bori');
  return z;
}

// ------------------------------------------------------------------ passive
export const BORI_PASSIVE: PassiveDef = {
  name: '구조통',
  desc: '넘치는 회복을 통에 담는다(최대 3). 맞으면 치유 웅덩이를 쏟고, R로 마시면 체력과 방패.',
  icon: 'icon_bori_passive',
  look: { aura: '#ffd9b0', step: '#e8b080', hit: '#ffe0b0' },
  stats(m) {
    // health flames can be picked up at full health (they go into the barrel)
    m.flag('overheal');
  },
  onAcquire(w) {
    w.player.mass = BORI_MASS;
    w.vars.__boriRed = w.player.red;
  },
  onPickup(w, kind) {
    if (kind !== 'heart' && kind !== 'heart_half') return;
    const p = w.player;
    const gain = kind === 'heart' ? 2 : 1;
    const before = w.vars.__boriRed ?? p.red;
    const healed = clamp(p.red - before, 0, gain);
    const overflow = gain - healed;
    w.vars.__boriRed = p.red;
    if (overflow > 0) addBarrel(w, overflow / 2);
  },
  onRoomClear(w) {
    addBarrel(w, BORI_ROOM_CHARGE, true);
  },
  onHit(w, t, hit) {
    // with a favoured weapon every blow pours a little into the barrel (by the hit's size)
    if (!boriAffinity(w) || !(t instanceof Enemy) || !isAttack(hit) || hit.release) return;
    if (!hit.source || hit.source instanceof BodyBlock || hit.attacker !== w.player) return;
    addBarrel(w, BORI_HIT_CHARGE * hitShare(w, hit), true);
  },
  onHurt(w) {
    // the barrel tips over when she is hit: a puddle to stand in
    if (!w.player.alive || barrel(w) < 1 || !cooldown(w, 'boriSpill', 1.0)) return;
    spill(w);
  },
  onUpdate(w) {
    const p = w.player;
    if (!p.alive) return;
    // R with no potion drinks a charge; at 1 칸 she gulps one on her own
    if (p.input.pressed & PRESS.potion && !p.potionId && !p.frozen && barrel(w) >= 1) drink(w);
    else if (p.red <= 2 && p.soul <= 0 && barrel(w) >= 1 && cooldown(w, 'boriAuto', 2.5)) drink(w, true);
    w.vars.__boriRed = p.red;
  },
  draw(w, r) {
    const n = barrel(w);
    if (n <= 0) return;
    const p = w.player;
    const full = Math.floor(n);
    const frac = n - full;
    const count = Math.min(BORI_MAX_CHARGES, full + (frac > 0 ? 1 : 0));
    for (let i = 0; i < count; i++) {
      const filled = i < full;
      const x = p.x + (i - (count - 1) / 2) * 7;
      const y = p.y - 26 - p.z + Math.sin(w.time * 5 + i) * 0.6;
      r.sprite('fx_bori_charge', x, y, { alpha: filled ? 1 : 0.35 + frac * 0.4 });
    }
  },
};

// ------------------------------------------------------------------ dash: body block
/** A shield wall in front of the shoving keeper: blocks bullets, shoves enemies. */
export class BodyBlock extends Entity {
  dx: number;
  dy: number;
  life: number;
  /** bullet-block radius; the favoured weapon's wall is wider */
  R: number;
  /** shove damage (x player damage) and stun (s) */
  shove: number;
  stun: number;
  blocked = 0;
  constructor(w: World) {
    super();
    const p = w.player;
    this.x = p.x;
    this.y = p.y;
    this.dx = p.dashDX;
    this.dy = p.dashDY;
    this.layer = 2;
    this.tileCollide = false;
    this.team = 'player';
    const heavy = boriAffinity(w);
    this.life = heavy ? BORI_BLOCK_TIME_AFFINITY : BORI_BLOCK_TIME;
    this.R = heavy ? BORI_BLOCK_RADIUS_AFFINITY : BORI_BLOCK_RADIUS;
    this.shove = heavy ? BORI_SHOVE_DMG_AFFINITY : BORI_SHOVE_DMG;
    this.stun = heavy ? BORI_SHOVE_STUN_AFFINITY : BORI_SHOVE_STUN;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const p = w.player;
    this.x = p.x;
    this.y = p.y;
    if (this.age >= this.life || !p.alive) {
      this.dead = true;
      return;
    }
    // bullets in the front half-disc are blocked
    const R = this.R;
    for (const pr of w.projectiles) {
      if (pr.dead || pr.team !== 'enemy' || pr.delay > 0) continue;
      const rx = pr.x - p.x;
      const ry = pr.y - (p.y - 4);
      const d = Math.hypot(rx, ry);
      if (d > R + pr.r) continue;
      if (d > 2 && (rx * this.dx + ry * this.dy) / d < -0.25) continue;
      pr.expire(w, true);
      this.blocked++;
      addBarrel(w, BORI_BLOCK_CHARGE, true);
      p.addEmber(2);
      w.sfx('bori_block', { vol: 0.5, pitch: 1 + fx.range(-0.08, 0.08), x: pr.x });
      w.particles.burst(pr.x, pr.y, { count: 7, speed: [40, 110], angle: Math.atan2(this.dy, this.dx), spread: 1.2, life: [0.1, 0.25], colors: ['#ffffff', '#ffe8c0'], shape: 'spark', size: [1, 2] });
      w.renderer.kick(this.dx * 0.8, this.dy * 0.8);
    }
    // enemies in front get shoved once
    const d = p.stats.damage * this.shove;
    for (const e of w.enemies) {
      if (!e.alive || e.hidden || !e.vulnerable || e.z > 12) continue;
      if ((e.mem.__boriShoveAt ?? -99) > w.time - 0.5) continue;
      const rx = e.x - p.x;
      const ry = e.y - p.y;
      const rr = p.r + e.r + 7 + (this.R - BORI_BLOCK_RADIUS);
      if (rx * rx + ry * ry > rr * rr) continue;
      const l = Math.hypot(rx, ry) || 1;
      if ((rx * this.dx + ry * this.dy) / l < -0.3) continue;
      e.mem.__boriShoveAt = w.time;
      const kx = (rx / l) * 0.4 + this.dx;
      const ky = (ry / l) * 0.4 + this.dy;
      const kl = Math.hypot(kx, ky) || 1;
      const stun = bossSafe(e, { kind: 'stun', duration: this.stun });
      if (w.applyHit(e, { damage: d, kind: 'melee', attacker: p, dirX: kx / kl, dirY: ky / kl, knockback: BORI_SHOVE_KNOCK, statuses: stun ? [stun] : undefined })) {
        w.sfx('hit_metal', { vol: 0.4, pitch: 0.75, x: e.x });
        w.spawn(new RingFx(e.x, e.y - e.z - 4, 16, 0.22, '#ffd9b0', 2));
        w.particles.burst(e.x, e.y - e.z - 4, { count: 8, angle: Math.atan2(this.dy, this.dx), spread: 0.6, speed: [60, 150], life: [0.12, 0.25], colors: WARM, shape: 'spark', size: [1, 2] });
        w.renderer.kick(this.dx * 2, this.dy * 2);
        w.hitstop(0.03, true);
      }
    }
  }

  override draw(r: Renderer): void {
    const k = 1 - this.age / this.life;
    const a = Math.atan2(this.dy, this.dx);
    const cx = this.x + Math.cos(a) * 9;
    const cy = this.y - 4 + Math.sin(a) * 7;
    const rad = 11 + (this.R - BORI_BLOCK_RADIUS) * 0.5;
    const heavy = this.R > BORI_BLOCK_RADIUS;
    // a translucent shield arc in front of the keeper
    const c = r.ctx;
    c.save();
    c.translate(cx - r.viewX, cy - r.viewY);
    c.globalAlpha = 0.55 * k + 0.2;
    c.strokeStyle = '#ffd9b0';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(0, 0, rad, a - 1.25, a + 1.25);
    c.stroke();
    if (heavy) {
      // the favoured weapon's wall: a second, golden rim (the barrel's bands)
      c.globalAlpha = 0.45 * k + 0.15;
      c.strokeStyle = '#f0c050';
      c.lineWidth = 1;
      c.beginPath();
      c.arc(0, 0, rad + 2, a - 1.1, a + 1.1);
      c.stroke();
    }
    c.globalAlpha = 0.25 * k;
    c.fillStyle = '#ffe8c0';
    c.beginPath();
    c.arc(0, 0, rad, a - 1.25, a + 1.25);
    c.lineTo(0, 0);
    c.fill();
    c.restore();
  }

  override light(w: World): void {
    w.lights.add(this.x + this.dx * 8, this.y - 4 + this.dy * 6, 30, '#ffd9b0', { intensity: 0.5 * (1 - this.age / this.life) });
  }
}

export const BORI_DASH: DashDef = {
  name: '몸통 밀치기',
  desc: '짧고 무겁게 밀고 들어간다. 앞을 가로막은 몸이 잠시 탄환을 막고 적을 밀쳐낸다.',
  icon: 'icon_bori_dash',
  color: '#ffd9b0',
  sfx: 'bori_shove',
  iframes: 0.12,
  start(w, p) {
    w.spawn(new BodyBlock(w));
    w.particles.burst(p.x, p.y + 3, { count: 10, speed: [20, 70], angle: Math.atan2(-p.dashDY, -p.dashDX), spread: 1.0, life: [0.25, 0.5], colors: ['#d0c8c0', '#a09080', '#ffd9b0'], size: [1, 3], ground: true });
    w.renderer.kick(p.dashDX * 1.5, p.dashDY * 1.5);
  },
};

// ------------------------------------------------------------------ affinity
export const BORI_AFFINITY: AffinityDef = {
  name: '둔기·도끼 / 방패',
  desc: '대시 방패벽이 크고 오래 서며 더 세게 민다. 칠 때마다 통이 조금씩 찬다.',
  families: ['heavy', 'shield'],
  stats(m) {
    m.mulStat('knockback', 1.3);
  },
};

// ------------------------------------------------------------------ release: 구조의 울음
/**
 * Rescue Howl: 보리 howls — every enemy around is stunned and thrown back, the
 * room's bullets vanish, she heals a heart (and gets a shield), the barrel
 * refills, and the lantern on the barrel becomes a beacon that pulses warmth
 * (damage + slow) for 2.4 seconds.
 */
export function releaseRescueHowl(w: World, p: Player): void {
  releaseOpen(w, p, '#ffd9b0', BORI_HOWL_RADIUS);
  w.sfx('bori_howl', { vol: 1 });
  w.sfx('boss_roar', { vol: 0.35, pitch: 1.5 });
  w.hitstop(0.08);
  clearBullets(w, p.x, p.y, 160);
  w.particles.burst(p.x, p.y - 8, { count: 40, speed: [60, 200], life: [0.3, 0.7], colors: WARM, size: [1, 3], additive: true, light: 6 });
  const s = p.stats;
  for (const e of w.enemiesInRadius(p.x, p.y, BORI_HOWL_RADIUS)) {
    const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
    const stun = bossSafe(e, { kind: 'stun', duration: 0.7 });
    w.applyHit(e, { damage: s.damage * BORI_HOWL_DMG, kind: 'explosion', attacker: p, dirX: (e.x - p.x) / d, dirY: (e.y - p.y) / d, knockback: 320, noProc: true, release: true, statuses: stun ? [stun] : undefined });
  }
  p.heal(2);
  p.shields = Math.min(BORI_SHIELD_CAP, p.shields + 1);
  addBarrel(w, 1, true);
  w.floatText(p.x, p.y - 26, '+', LIFE_HEAL_TEXT, 1, LIFE_ICON);
  const falloff = new HitFalloff(BORI_BEACON_FALLOFF);
  const dmg = s.damage * BORI_BEACON_DMG;
  const dur = 2.4;
  w.spawn(new KitTimeline(dur, (ww, _t, dt, self) => {
    everyTick(self, 'pulse', dt, dur / BORI_BEACON_PULSES, (i) => {
      if (i >= BORI_BEACON_PULSES) return;
      const pl = ww.player;
      ww.spawn(new RingFx(pl.x, pl.y - 6, BORI_BEACON_RADIUS, 0.3, i % 2 ? '#ffffff' : '#ffb86a', 2));
      ww.sfx('heal', { vol: 0.35, pitch: 0.8 + i * 0.05 });
      ww.lights.glow(pl.x, pl.y - 6, 90, '#ffb86a', 0.5);
      for (const e of ww.enemiesInRadius(pl.x, pl.y, BORI_BEACON_RADIUS)) {
        releaseHit(ww, e, dmg * falloff.next(e), pl.x, pl.y, 60, [{ kind: 'slow', duration: 0.6, power: 0.35 }]);
      }
    });
  }, {
    end(ww) {
      const pl = ww.player;
      ww.sfx('explosion', { vol: 0.5, pitch: 1.3 });
      ww.sfx('bori_howl', { vol: 0.5, pitch: 1.3 });
      ww.shake(0.4);
      ww.renderer.screenFlash('#ffe8c0', 0.25);
      ww.spawn(new RingFx(pl.x, pl.y - 6, BORI_BEACON_RADIUS * 1.3, 0.4, '#ffe8c0', 3));
      ww.particles.burst(pl.x, pl.y - 8, { count: 30, speed: [50, 180], life: [0.3, 0.6], colors: WARM, size: [1, 3], additive: true });
      for (const e of ww.enemiesInRadius(pl.x, pl.y, BORI_BEACON_RADIUS * 1.3)) releaseHit(ww, e, s.damage * BORI_BEACON_FINAL, pl.x, pl.y, 260);
    },
    draw(r, ww, t) {
      const pl = ww.player;
      const k = 1 - t / dur;
      const pulse = 0.6 + 0.4 * Math.sin(t * 16);
      r.sprite(glowSprite(32 + 12 * pulse, '#ffb86a'), pl.x, pl.y - 14, { alpha: 0.45 * k + 0.2, additive: true });
      r.ring(pl.x, pl.y - 4, BORI_BEACON_RADIUS, '#ffd9b0', 1, 0.2 + 0.15 * pulse);
    },
    light(ww, t) {
      ww.lights.add(ww.player.x, ww.player.y - 8, 110 * (1 - t / (dur * 2)), '#ffb86a', { intensity: 0.9 });
    },
  }));
}
