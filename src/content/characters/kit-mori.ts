// 모리's kit — the border collie herder, built around two spirit sheep.
//   passive 양치기: two spirit sheep (three with a staff) trot beside the keeper.
//     Each picks an enemy near the herd point (36 px in front of the keeper, toward
//     the aim), runs to its far side and headbutts it toward the herd point, so the
//     room bunches up where 모리 is aiming. Enemies with another enemy within 26 px
//     are "herded" and take +25% damage from the keeper's attacks.
//   dash 비켜서기: a quick sidestep; the sheep keep the spot the keeper left as a
//     pen for 1.5 s and herd enemies toward it (away from her).
//   affinity 지팡이: a staff (the 지팡이 family; wands are 마법봉) adds a third
//     sheep and faster headbutts, and an enemy a sheep has headbutted counts as
//     herded for MORI_MARK_TIME s even when it stands alone (bosses and stragglers
//     take the herd bonus too)
//   release 양몰이 돌격 (releaseStampede): a whistle pulls enemies into a pen at
//     the aim, then a stampede of spectral sheep tramples through it.

import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import type { AffinityDef, DashDef, PassiveDef } from '../../game/defs';
import { Entity } from '../../game/entity';
import { Enemy } from '../../game/enemy';
import { RingFx } from '../../game/effects';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { TAU, angleTo, dist, dist2 } from '../../engine/math';
import { glowSprite } from '../weapons/common';
import { Familiar, amplify, familiarsOf, isAttack, itemHit, proc, syncFamiliars } from '../items/lib';
import { HitFalloff, ReleaseShot, releaseHit } from './releases';
import { KitTimeline, releaseOpen } from './kit-common';
import { EnemyOverlay, O, ensureOverlay } from './kit';

export const MORI_SHEEP = 2;
export const MORI_SHEEP_AFFINITY = 3;
/** affinity: a headbutted enemy counts as herded for this long (s), alone or not */
export const MORI_MARK_TIME = 2;
/** headbutt: damage (x player damage), cooldown (s; x MORI_HEADBUTT_CD_AFFINITY with a staff), nudge toward the herd point */
export const MORI_HEADBUTT_DMG = 0.38;
export const MORI_HEADBUTT_CD = 0.75;
export const MORI_HEADBUTT_CD_AFFINITY = 0.82;
export const MORI_HEADBUTT_KNOCK = 110;
/** sheep only work enemies this close to the herd point */
export const MORI_HERD_RANGE = 120;
/** herd point: px in front of the keeper (toward the aim) */
export const MORI_HERD_FRONT = 36;
/** "herded": another enemy within this distance; bonus damage taken */
export const MORI_GROUP_DIST = 26;
export const MORI_GROUP_BONUS = 0.25;
/** the pen left behind by a sidestep (s) */
export const MORI_PEN_TIME = 1.5;
export const MORI_SHEEP_SPEED = 140;
/** release: pull time, sheep count, damage each (with falloff), pen collapse damage */
export const MORI_STAMPEDE_PULL = 0.7;
export const MORI_STAMPEDE_SHEEP = 6;
export const MORI_STAMPEDE_DMG = 1.7;
export const MORI_STAMPEDE_FALLOFF = 0.85;
export const MORI_STAMPEDE_FINAL = 3;
export const MORI_PEN_RADIUS = 44;

const SPIRIT = ['#ffffff', '#e0fff8', '#9af0e0', '#3a9a8a'];

// ------------------------------------------------------------------ sprites
defineDrawnSprite('icon_mori_passive', 16, 16, (p) => {
  // two spirit sheep bunching an enemy dot toward a herd mark
  p.ellipse(4, 10, 3.2, 2.6, '#e0fff8');
  p.ellipse(4, 10, 2.2, 1.8, '#ffffff');
  p.rect(6, 9, 2, 2, '#3a3444');
  p.ellipse(12, 11, 3.2, 2.6, '#e0fff8');
  p.ellipse(12, 11, 2.2, 1.8, '#ffffff');
  p.rect(9, 10, 2, 2, '#3a3444');
  p.circle(8, 4, 2.2, '#c04050');
  p.px(7, 3, '#ff8090');
  p.ring(8, 4, 4.5, 1, '#9af0e080');
  p.px(8, 0, '#9af0e0');
}, { outline: O });

defineDrawnSprite('icon_mori_dash', 16, 16, (p) => {
  // the keeper's after-image stepping right, a sheep staying at the pen post
  p.poly([9, 12, 11, 4, 14, 4, 12, 12], '#9af0e0');
  p.poly([6, 12, 8, 4, 10, 4, 8, 12], '#9af0e060');
  p.ellipse(4, 11, 3, 2.4, '#e0fff8');
  p.ellipse(4, 11, 2, 1.6, '#ffffff');
  p.rect(6, 10, 2, 2, '#3a3444');
  p.rect(3, 2, 1, 6, '#a87a4a');
  p.rect(2, 2, 3, 1, '#d83c2c');
  p.ring(4, 13, 5, 1, '#9af0e060');
}, { outline: O });

// a small spectral sheep (facing right): fluffy body, dark face, little legs
defineDrawnSprite('fx_spirit_sheep', 11, 9, (p) => {
  p.ellipse(5, 4, 4.5, 3.2, '#c8fff4');
  p.ellipse(4.5, 3.5, 3.5, 2.4, '#e8fffb');
  p.px(3, 2, '#ffffff');
  p.px(2, 3, '#ffffff');
  p.ellipse(8.5, 4.5, 2, 1.8, '#3a3444');
  p.px(9, 4, '#9af0e0');
  p.px(8, 2, '#3a3444');
  p.px(7, 2, '#55536a');
  p.rect(3, 7, 1, 2, '#3a3444');
  p.rect(6, 7, 1, 2, '#3a3444');
}, { outline: '#143a34' });

// the stampede sheep (bigger, trailing light)
defineDrawnSprite('fx_spirit_sheep_big', 17, 13, (p) => {
  p.ellipse(7.5, 6, 7, 4.8, '#9af0e0');
  p.ellipse(7, 5.5, 6, 4, '#c8fff4');
  p.ellipse(6, 4.5, 4, 2.6, '#e8fffb');
  p.px(4, 3, '#ffffff');
  p.px(3, 4, '#ffffff');
  p.ellipse(13, 6.5, 3, 2.6, '#3a3444');
  p.px(14, 6, '#9af0e0');
  p.px(13, 3, '#3a3444');
  p.px(12, 3, '#55536a');
  p.rect(4, 10, 2, 3, '#3a3444');
  p.rect(9, 10, 2, 3, '#3a3444');
}, { outline: '#143a34', origin: [8, 6] });

// herd point marker (a small shepherd's post)
defineDrawnSprite('fx_mori_post', 5, 9, (p) => {
  p.rect(2, 1, 1, 8, '#a87a4a');
  p.rect(1, 0, 3, 2, '#d83c2c');
  p.px(2, 4, '#d8b070');
}, { outline: '#143a34' });

for (let d = 10; d <= 20; d += 2) glowSprite(d, '#9af0e0');

// ------------------------------------------------------------------ herd point
/** Is the sidestep pen still standing? */
export function penActive(w: World): boolean {
  return (w.vars.__moriPenUntil ?? -1) > w.time;
}

/** Where the sheep herd enemies to: the pen while it stands, else a spot in front of the keeper. */
export function herdPoint(w: World): { x: number; y: number } {
  if (penActive(w)) return { x: w.vars.__moriPenX ?? w.player.x, y: w.vars.__moriPenY ?? w.player.y };
  const p = w.player;
  return { x: p.x + Math.cos(p.aim) * MORI_HERD_FRONT, y: p.y + Math.sin(p.aim) * MORI_HERD_FRONT * 0.8 };
}

/** Is the context keeper holding a staff (the favoured class)? */
export function moriAffinity(w: World): boolean {
  return w.player.flags.has('affinity');
}

/** Affinity mark: a sheep headbutted `e` within the last MORI_MARK_TIME s. */
export function isMarked(w: World, e: Enemy): boolean {
  return (e.mem.__moriMark ?? -1) > w.time;
}

/** Does `e` take the herd bonus from the context keeper (grouped, or marked while she holds a staff)? */
export function isHerded(w: World, e: Enemy): boolean {
  return isGrouped(w, e) || (moriAffinity(w) && isMarked(w, e));
}

/** Another living enemy within MORI_GROUP_DIST of `e`? */
export function isGrouped(w: World, e: Enemy): boolean {
  const d2 = (MORI_GROUP_DIST + e.r) * (MORI_GROUP_DIST + e.r);
  for (const o of w.enemies) {
    if (o === e || !o.alive || o.hidden) continue;
    if (dist2(e.x, e.y, o.x, o.y) < d2) return true;
  }
  return false;
}

// ------------------------------------------------------------------ spirit sheep
/** One of 모리's spirit sheep: trots beside her, works the nearest enemy toward the herd point. */
export class SpiritSheep extends Familiar {
  /** numeric scratch (hashed): headbutt cooldown, current target id */
  mem: Record<string, number> = { cd: 0.4, target: 0 };
  face = 1;
  moving = false;
  constructor(w: World) {
    super(w);
    this.z = 0;
    this.r = 5;
    // Spawn positions affect herding and must agree across lockstep peers.
    this.x = w.player.x + (w.rng.chance(0.5) ? 1 : -1) * 2;
  }

  /** Pick the enemy this sheep works: the n-th nearest to the herd point (n = slot). */
  private pickTarget(w: World, h: { x: number; y: number }): Enemy | null {
    const cands: Enemy[] = [];
    for (const e of w.enemies) {
      if (!e.alive || e.hidden || !e.vulnerable || e.z > 12) continue;
      if (dist2(e.x, e.y, h.x, h.y) > MORI_HERD_RANGE * MORI_HERD_RANGE) continue;
      cands.push(e);
    }
    if (!cands.length) return null;
    cands.sort((a, b) => dist2(a.x, a.y, h.x, h.y) - dist2(b.x, b.y, h.x, h.y) || a.id - b.id);
    return cands[this.slot % cands.length];
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const p = w.player;
    const h = herdPoint(w);
    const pen = penActive(w);
    const target = this.pickTarget(w, h);
    this.mem.target = target ? target.id : 0;
    let gx: number;
    let gy: number;
    if (target) {
      // the far side of the target, seen from the herd point
      const a = angleTo(h.x, h.y, target.x, target.y);
      gx = target.x + Math.cos(a) * (target.r + 6);
      gy = target.y + Math.sin(a) * (target.r + 6);
    } else if (pen) {
      const a = (this.slot / Math.max(1, this.count)) * TAU + w.time * 1.5;
      gx = h.x + Math.cos(a) * 11;
      gy = h.y + Math.sin(a) * 8;
    } else {
      // formation: beside and a step behind the keeper
      const side = this.slot % 2 ? 1 : -1;
      const row = Math.floor(this.slot / 2);
      gx = p.x + side * (13 + row * 4);
      gy = p.y + 6 + row * 9;
    }
    const dx = gx - this.x;
    const dy = gy - this.y;
    const d = Math.hypot(dx, dy);
    const speed = MORI_SHEEP_SPEED * (target ? 1 : 0.8);
    const step = Math.min(d, speed * dt);
    if (d > 1) {
      this.x += (dx / d) * step;
      this.y += (dy / d) * step;
      if (Math.abs(dx) > 2) this.face = dx > 0 ? 1 : -1;
    }
    this.moving = step > 0.4;
    // the headbutt: a nudge toward the herd point plus a little damage
    this.mem.cd = Math.max(0, this.mem.cd - dt);
    if (target && this.mem.cd <= 0 && dist(this.x, this.y, target.x, target.y) <= target.r + 8) {
      this.mem.cd = MORI_HEADBUTT_CD * (moriAffinity(w) ? MORI_HEADBUTT_CD_AFFINITY : 1);
      const hx = h.x - target.x;
      const hy = h.y - target.y;
      const hd = Math.hypot(hx, hy) || 1;
      itemHit(w, target, p.stats.damage * MORI_HEADBUTT_DMG, { from: this, knockback: 0, kind: 'melee' });
      // with a staff the bump marks it: herded even when alone
      if (moriAffinity(w) && target.alive) target.mem.__moriMark = w.time + MORI_MARK_TIME;
      if (target.alive) target.knock(hx / hd, hy / hd, MORI_HEADBUTT_KNOCK);
      this.face = target.x > this.x ? 1 : -1;
      w.sfx('mori_baa', { vol: 0.35, pitch: 0.95 + this.slot * 0.08 + fx.range(-0.04, 0.04), x: this.x });
      w.particles.burst(target.x, target.y - target.z - 4, { count: 6, speed: [20, 70], angle: Math.atan2(hy, hx), spread: 0.8, life: [0.15, 0.3], colors: SPIRIT, size: [1, 2], additive: true });
      w.spawn(new RingFx(this.x, this.y - 3, 9, 0.18, '#9af0e0', 1));
      proc(w, 'passive:mori', true);
    }
    if (fx.chance(dt * 6)) w.particles.spawn({ x: this.x + fx.range(-3, 3), y: this.y - 3 + fx.range(-3, 2), vy: -fx.range(6, 14), life: 0.4, colors: ['#e0fff8', '#9af0e0'], size: 1, additive: true });
  }

  override draw(r: Renderer): void {
    const hop = this.moving ? Math.abs(Math.sin(this.age * 14)) * 2 : Math.sin(this.age * 3 + this.bob) * 0.5;
    r.shadow(this.x, this.y + 3, 9, 3, 0.25);
    r.sprite(glowSprite(14, '#9af0e0'), this.x, this.y - 3 - hop, { alpha: 0.35 + 0.1 * Math.sin(this.age * 5), additive: true });
    r.sprite('fx_spirit_sheep', this.x, this.y - 2 - hop, { flipX: this.face < 0, alpha: 0.92 });
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 3, 22, '#9af0e0', { intensity: 0.45 });
  }
}

/** Soft rings under herded enemies; a staff's headbutt mark adds a little post above (cosmetic). */
class HerdMarks extends EnemyOverlay {
  drawMark(r: Renderer, w: World, e: Enemy): void {
    if (!isHerded(w, e)) return;
    r.ring(e.x, e.y + 1, e.r + 3, '#9af0e0', 1, 0.3 + 0.1 * Math.sin(this.age * 5));
    if (isGrouped(w, e) || !isMarked(w, e)) return;
    const left = (e.mem.__moriMark ?? 0) - w.time;
    const a = Math.min(1, left / 0.4);
    r.ring(e.x, e.y + 1, e.r + 5, '#e0fff8', 1, 0.25 * a);
    r.sprite('fx_mori_post', e.x, e.y - e.z - e.r - 9 + Math.sin(this.age * 4) * 0.6, { alpha: 0.85 * a });
  }
}

// ------------------------------------------------------------------ passive
export const MORI_PASSIVE: PassiveDef = {
  name: '양치기',
  desc: '혼령 양 두 마리가 적을 조준 방향 앞으로 몰아 모은다. 뭉친 적은 피해 +25%.',
  icon: 'icon_mori_passive',
  look: { mote: '#9af0e0', aura: '#bff5ea', hit: '#e0fff8' },
  onUpdate(w) {
    const aff = moriAffinity(w);
    syncFamiliars(w, 'mori_sheep', aff ? MORI_SHEEP_AFFINITY : MORI_SHEEP, (ww) => new SpiritSheep(ww));
    if (w.enemies.length > 1 || (aff && w.enemies.length > 0)) ensureOverlay(w, 'mori_herd', (ww) => new HerdMarks(ww));
  },
  modifyHit(w, t, hit) {
    if (!isAttack(hit) || !(t instanceof Enemy) || !isHerded(w, t)) return;
    amplify(hit, MORI_GROUP_BONUS);
    proc(w, 'passive:mori', true);
  },
  draw(w, r) {
    if (!w.enemies.some((e) => e.alive && !e.hidden)) return;
    const h = herdPoint(w);
    const pen = penActive(w);
    const a = pen ? 0.9 : 0.5;
    if (pen) {
      const remaining = Math.max(0, (w.vars.__moriPenUntil ?? 0) - w.time) / MORI_PEN_TIME;
      r.ring(h.x, h.y + 1, 17, '#9af0e0', 1, 0.3);
      r.line(h.x - 10, h.y + 13, h.x + 10, h.y + 13, '#143a34', 3, 0.9);
      r.line(h.x - 10, h.y + 13, h.x - 10 + 20 * remaining, h.y + 13, '#9af0e0', 1, 0.9);
    }
    r.ring(h.x, h.y + 1, 8 + Math.sin(w.time * 4) * 1.5, '#9af0e0', 1, 0.35 * a);
    r.sprite('fx_mori_post', h.x, h.y - 4 + Math.sin(w.time * 3) * 0.5, { alpha: a });
  },
};

// ------------------------------------------------------------------ dash
export const MORI_DASH: DashDef = {
  name: '비켜서기',
  desc: '재빨리 비켜선다. 양들은 떠난 자리를 지키며 적을 그쪽으로 몬다.',
  icon: 'icon_mori_dash',
  color: '#9af0e0',
  iframes: 0.08,
  start(w, p) {
    w.vars.__moriPenUntil = w.time + MORI_PEN_TIME;
    w.vars.__moriPenX = p.dashX0;
    w.vars.__moriPenY = p.dashY0;
    w.sfx('mori_whistle', { vol: 0.4, pitch: 1.5 });
    w.spawn(new RingFx(p.dashX0, p.dashY0, 14, 0.3, '#9af0e0', 1));
    for (const s of familiarsOf<SpiritSheep>(w, 'mori_sheep')) {
      w.particles.burst(s.x, s.y - 3, { count: 5, speed: [15, 45], life: [0.2, 0.4], colors: SPIRIT, size: [1, 2], additive: true });
    }
  },
};

// ------------------------------------------------------------------ affinity
export const MORI_AFFINITY: AffinityDef = {
  name: '지팡이',
  desc: '양이 셋, 박치기가 빨라지고 받힌 적은 혼자여도 2초간 뭉친 적으로 친다.',
  families: ['staff'],
};

// ------------------------------------------------------------------ release: 양몰이 돌격
/** A stampeding spectral sheep (a ReleaseShot that keeps its feet on the ground). */
class StampedeSheep extends ReleaseShot {
  constructor(x: number, y: number, ang: number, damage: number, falloff: HitFalloff) {
    super(x, y, ang, { speed: 300, damage, sprite: 'fx_spirit_sheep_big', color: '#9af0e0', life: 1.0, radius: 7, pierce: 99, falloff });
    this.z = 0;
  }

  override draw(r: Renderer): void {
    const hop = Math.abs(Math.sin(this.age * 22)) * 3;
    r.shadow(this.x, this.y + 4, 13, 4, 0.3);
    r.sprite(glowSprite(20, '#9af0e0'), this.x, this.y - 5 - hop, { alpha: 0.4, additive: true });
    r.sprite('fx_spirit_sheep_big', this.x, this.y - 4 - hop, { flipX: Math.cos(this.ang) < 0, alpha: 0.95 });
  }
}

/** The pen of the release: drags enemies toward its center, then collapses. */
class StampedePen extends Entity {
  dur: number;
  constructor(x: number, y: number, dur: number) {
    super();
    this.x = x;
    this.y = y;
    this.dur = dur;
    this.r = MORI_PEN_RADIUS;
    this.layer = 0;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const pull = MORI_HERD_RANGE;
    for (const e of w.enemies) {
      if (!e.alive || e.hidden) continue;
      const d = dist(e.x, e.y, this.x, this.y);
      if (d > pull || d < 3) continue;
      const k = (0.4 + 0.6 * (1 - d / pull)) * (e.isBoss ? 110 : 460) * dt;
      e.knock((this.x - e.x) / d, (this.y - e.y) / d, k * Math.max(0.2, e.mass));
    }
    w.clearEnemyBullets(this.x, this.y, this.r + 16, false);
    if (fx.chance(dt * 30)) {
      const a = fx.angle();
      w.particles.spawn({ x: this.x + Math.cos(a) * this.r, y: this.y + Math.sin(a) * this.r * 0.7, vx: -Math.cos(a) * 50, vy: -Math.sin(a) * 35, life: 0.4, colors: SPIRIT, size: 1, additive: true });
    }
    if (this.age >= this.dur) this.dead = true;
  }

  override draw(r: Renderer): void {
    const k = Math.min(1, this.age / 0.15);
    const R = this.r * k;
    r.circle(this.x, this.y, R, '#3a9a8a', 0.18);
    r.ring(this.x, this.y, R, '#9af0e0', 1, 0.8);
    r.ring(this.x, this.y, R * 0.6, '#e0fff8', 1, 0.3 + 0.2 * Math.sin(this.age * 12));
    // fence posts around the pen
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + this.age * 0.6;
      r.sprite('fx_mori_post', this.x + Math.cos(a) * R, this.y + Math.sin(a) * R * 0.7 - 2, { alpha: 0.9 });
    }
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y, 80, '#9af0e0', { intensity: 0.7 });
  }
}

/**
 * Stampede: 모리 whistles a pen into being where she aims; enemies are dragged
 * into it while her sheep multiply behind her, then six spectral sheep charge
 * through the pen and the pen slams shut on whatever is still inside.
 */
export function releaseStampede(w: World, p: Player): void {
  releaseOpen(w, p, '#9af0e0', 80);
  w.sfx('mori_whistle', { vol: 1, pitch: 0.9 });
  const d = 64;
  const free = w.room.nearestFree(p.x + Math.cos(p.aim) * d, p.y + Math.sin(p.aim) * d * 0.85, 6);
  const cx = free.x;
  const cy = free.y;
  const total = MORI_STAMPEDE_PULL + 0.9;
  w.spawn(new StampedePen(cx, cy, total));
  const falloff = new HitFalloff(MORI_STAMPEDE_FALLOFF);
  const dmg = p.stats.damage * MORI_STAMPEDE_DMG;
  w.spawn(new KitTimeline(total, (ww, t, _dt, self) => {
    if (t < MORI_STAMPEDE_PULL) return;
    const n = self.mem.n ?? 0;
    if (n === 0) {
      ww.sfx('mori_stampede', { vol: 1 });
      ww.shake(0.3);
    }
    // one sheep every 0.08 s, fanned so the herd fills the pen
    const want = Math.min(MORI_STAMPEDE_SHEEP, Math.floor((t - MORI_STAMPEDE_PULL) / 0.08) + 1);
    while ((self.mem.n ?? 0) < want) {
      const i = self.mem.n ?? 0;
      self.mem.n = i + 1;
      const pl = ww.player;
      const base = angleTo(pl.x, pl.y, cx, cy);
      const off = (i - (MORI_STAMPEDE_SHEEP - 1) / 2) * 0.14;
      const back = 14 + (i % 3) * 7;
      const sx = pl.x - Math.cos(base) * back + Math.cos(base + Math.PI / 2) * off * 30;
      const sy = pl.y - Math.sin(base) * back + Math.sin(base + Math.PI / 2) * off * 30;
      const ang = angleTo(sx, sy, cx + Math.cos(base + Math.PI / 2) * off * 24, cy + Math.sin(base + Math.PI / 2) * off * 24);
      ww.spawn(new StampedeSheep(sx, sy, ang, dmg, falloff));
      ww.sfx('mori_baa', { vol: 0.5, pitch: 0.8 + (i % 3) * 0.1 });
    }
  }, {
    end(ww) {
      ww.sfx('slam', { vol: 0.7, pitch: 1.2 });
      ww.sfx('mori_whistle', { vol: 0.6, pitch: 1.3 });
      ww.shake(0.45);
      ww.renderer.screenFlash('#e0fff8', 0.3);
      ww.spawn(new RingFx(cx, cy, MORI_PEN_RADIUS + 10, 0.35, '#9af0e0', 3));
      ww.spawn(new RingFx(cx, cy, MORI_PEN_RADIUS * 0.6, 0.3, '#ffffff', 2));
      ww.particles.burst(cx, cy, { count: 40, speed: [50, 180], life: [0.3, 0.6], colors: SPIRIT, size: [1, 3], additive: true, light: 6 });
      for (const e of ww.enemiesInRadius(cx, cy, MORI_PEN_RADIUS + 6)) releaseHit(ww, e, p.stats.damage * MORI_STAMPEDE_FINAL, cx, cy, 240);
    },
  }));
}
