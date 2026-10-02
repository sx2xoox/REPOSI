// 백구's kit — the white Jindo counter-master, built around timing.
//   passive 간파 (perfect dodge): a dash started just before a bullet or an enemy
//     attack lands (window ~0.17 s with cursor aim, 0.22 s with stick / touch aim)
//     is a perfect dodge: enemy time slows for 0.4 s, nearby bullets are reflected
//     back as player shots, a white counter-slash hits the nearest enemy as a
//     guaranteed critical, and for 1.6 s (반격) all damage is x1.5. Bullets that
//     pass through the dashing keeper inside the window count as well.
//   dash 찰나 걸음: a short sidestep (36 px)
//   affinity 단도·도: short blades widen the window (+0.05 s), lengthen 반격
//     (+0.6 s) and give +8% move speed
//   release 섬광 연참 (releaseFlashSlashes): six teleporting slashes, then a finisher

import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import type { AffinityDef, DashDef, PassiveDef } from '../../game/defs';
import { Enemy } from '../../game/enemy';
import type { Projectile } from '../../game/projectile';
import { MeleeSwing, reflectProjectile } from '../../game/melee';
import { Afterimage, RingFx } from '../../game/effects';
import { HELD } from '../../game/seam';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { angleTo, dist } from '../../engine/math';
import { glowSprite } from '../weapons/common';
import { isAttack, proc, timeStopped, watch } from '../items/lib';
import { HitFalloff, releaseHit } from './releases';
import { KitTimeline, releaseOpen } from './kit-common';
import { O } from './kit';

/** perfect-dodge window (s) with cursor aim / with stick or touch aim; the affinity adds to it */
export const BAEKGU_WINDOW_CURSOR = 0.17;
export const BAEKGU_WINDOW_STICK = 0.22;
export const BAEKGU_WINDOW_AFFINITY = 0.05;
/** 반격 window (s) after a perfect dodge (+ affinity), damage multiplier during it */
export const BAEKGU_COUNTER_TIME = 1.6;
export const BAEKGU_COUNTER_TIME_AFFINITY = 0.6;
export const BAEKGU_COUNTER_DMG = 1.5;
/** counter slash: damage (x player damage, always a critical), base reach, search radius */
export const BAEKGU_STRIKE_DMG = 1.8;
export const BAEKGU_STRIKE_REACH = 34;
export const BAEKGU_STRIKE_RANGE = 70;
/** bullets within this radius are reflected (damage x player damage) */
export const BAEKGU_REFLECT_RADIUS = 48;
export const BAEKGU_REFLECT_DMG = 1.2;
/** enemy slow-motion after a perfect dodge: duration (s), time scale */
export const BAEKGU_SLOW_TIME = 0.4;
export const BAEKGU_SLOW_SCALE = 0.2;
export const BAEKGU_DODGE_EMBER = 10;
/** release: slash count, damage each (with falloff), finisher damage */
export const BAEKGU_FLASH_SLASHES = 6;
export const BAEKGU_FLASH_DMG = 1.5;
export const BAEKGU_FLASH_FALLOFF = 0.85;
export const BAEKGU_FLASH_FINAL = 4;

const WHITE = ['#ffffff', '#f4f2ea', '#c8d8ff'];

// ------------------------------------------------------------------ icons
defineDrawnSprite('icon_baekgu_passive', 16, 16, (p) => {
  // an eye reading the attack, a bullet arcing back off a white flash
  p.ellipse(7, 8, 6, 3.5, '#f4f2ea');
  p.ellipse(7, 8, 2.6, 2.6, '#2d3f80');
  p.circle(7, 8, 1.4, '#1a1420');
  p.px(6, 7, '#ffffff');
  p.line(1, 4, 13, 4, '#c8d8ff');
  p.line(1, 12, 13, 12, '#c8d8ff');
  p.px(14, 2, '#ff6a6a');
  p.px(15, 4, '#ff6a6a');
  p.px(14, 6, '#ffffff');
  p.px(13, 1, '#ffffff');
}, { outline: O });

defineDrawnSprite('icon_baekgu_dash', 16, 16, (p) => {
  // two white after-images stepping aside, a bullet whiffing past
  p.poly([2, 12, 5, 4, 7, 4, 5, 12], '#c8d8ff80');
  p.poly([5, 12, 8, 4, 10, 4, 8, 12], '#c8d8ff');
  p.poly([8, 12, 11, 4, 13, 4, 11, 12], '#ffffff');
  p.line(1, 2, 4, 2, '#ff6a6a');
  p.px(5, 2, '#ffd0d0');
  p.px(12, 14, '#c8d8ff');
  p.px(14, 13, '#ffffff');
}, { outline: O });

// fang mark shown beside the head while 반격 is up
defineDrawnSprite('fx_bg_fang', 5, 7, (p) => {
  p.poly([0, 0, 5, 0, 2.5, 7], '#ffffff');
  p.px(1, 1, '#c8d8ff');
}, { outline: '#1c2650' });

for (let d = 8; d <= 12; d += 2) glowSprite(d, '#c8d8ff');

// ------------------------------------------------------------------ state
export function hasAffinity(w: World): boolean {
  return w.player.flags.has('affinity');
}

/** The perfect-dodge window for this step's input (wider with stick / touch aim and the affinity). */
export function dodgeWindow(w: World): number {
  const p = w.player;
  const base = p.input.held & HELD.cursorAim ? BAEKGU_WINDOW_CURSOR : BAEKGU_WINDOW_STICK;
  return base + (hasAffinity(w) ? BAEKGU_WINDOW_AFFINITY : 0);
}

/** Is the 반격 (counter) window open? */
export function inCounter(w: World): boolean {
  return (w.vars.__bgCounterUntil ?? -1) > w.time;
}

/** Enemy slow-motion of the last perfect dodge still running? */
export function inSlow(w: World): boolean {
  return (w.vars.__bgSlowUntil ?? -1) > w.time;
}

// ------------------------------------------------------------------ threat prediction
/** Would `pr` reach (px, py) within `window` seconds (or does it overlap already)? */
function bulletThreat(w: World, pr: Projectile, px: number, py: number, pr2: number, window: number): boolean {
  const k = (w.floor?.shotSpeed ?? 1) * w.enemyTimeScale;
  const rx = pr.x - px;
  const ry = pr.y - py;
  const rr = pr.r + pr2 + 2;
  if (rx * rx + ry * ry <= rr * rr) return true;
  const vx = pr.vx * k;
  const vy = pr.vy * k;
  const v2 = vx * vx + vy * vy;
  if (v2 < 1) return false;
  const tca = -(rx * vx + ry * vy) / v2;
  if (tca < 0 || tca > window) return false;
  const cx = rx + vx * tca;
  const cy = ry + vy * tca;
  return cx * cx + cy * cy <= rr * rr;
}

/** Would `e` run into the keeper within `window` seconds, or is its attack about to land? */
function enemyThreat(w: World, e: Enemy, px: number, py: number, pr: number, window: number): boolean {
  if (!e.alive || e.hidden || !e.harmful || e.dormant > 0 || e.z > 10) return false;
  const rx = e.x - px;
  const ry = e.y - py;
  const d = Math.hypot(rx, ry);
  // a telegraphed attack about to go off right next to the keeper
  if (e.telegraphT > 0 && e.telegraphT <= window + 0.05 && d <= e.r + pr + 30) return true;
  if (e.contactDamage <= 0) return false;
  const rr = e.r + pr + 2;
  if (d <= rr) return true;
  const vx = (e.vx + e.kbx) * w.enemyTimeScale;
  const vy = (e.vy + e.kby) * w.enemyTimeScale;
  const v2 = vx * vx + vy * vy;
  if (v2 < 100) return false;
  const tca = -(rx * vx + ry * vy) / v2;
  if (tca < 0 || tca > window) return false;
  const cx = rx + vx * tca;
  const cy = ry + vy * tca;
  return cx * cx + cy * cy <= rr * rr;
}

/** Anything about to hit the keeper (bullets, charging enemies, telegraphed attacks, active enemy swings)? */
export function threatIncoming(w: World, p: Player, window: number): boolean {
  const px = p.x;
  const py = p.y - 4;
  for (const pr of w.projectiles) {
    if (pr.dead || pr.team !== 'enemy' || pr.delay > 0) continue;
    if (bulletThreat(w, pr, px, py, p.r, window)) return true;
  }
  for (const e of w.enemies) if (enemyThreat(w, e, p.x, p.y, p.r, window)) return true;
  for (const e of w.entities) {
    if (e instanceof MeleeSwing && e.team === 'enemy' && !e.dead && e.age <= e.o.duration + 0.05 && e.contains(p.x, p.y, p.r + 2)) return true;
  }
  return false;
}

/** Something passing through the dashing keeper right now (bullets, enemy bodies)? */
export function threatOverlapping(w: World, p: Player): boolean {
  for (const pr of w.projectiles) {
    if (pr.dead || pr.team !== 'enemy' || pr.delay > 0) continue;
    const rr = pr.r + p.r + 1;
    const dx = pr.x - p.x;
    const dy = pr.y - (p.y - 4);
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  for (const e of w.enemies) {
    if (!e.alive || e.hidden || !e.harmful || e.dormant > 0 || e.contactDamage <= 0 || e.z > 10) continue;
    const rr = e.r + p.r;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}

// ------------------------------------------------------------------ the perfect dodge
/** Reflect enemy bullets around (x, y) back as player shots aimed at the nearest enemy. Returns the count. */
export function reflectAround(w: World, x: number, y: number, radius: number, color = '#ffffff'): number {
  const p = w.player;
  let n = 0;
  for (const pr of w.projectiles) {
    if (pr.dead || pr.team !== 'enemy' || pr.delay > 0) continue;
    if (dist(pr.x, pr.y, x, y) > radius + pr.r) continue;
    const t = w.nearestEnemy(pr.x, pr.y, 260);
    const ang = t ? angleTo(pr.x, pr.y, t.x, t.y - t.z * 0.3) : angleTo(x, y, pr.x, pr.y);
    reflectProjectile(w, pr, { x: pr.x - Math.cos(ang) * 4, y: pr.y - Math.sin(ang) * 4, o: { angle: ang, color } });
    pr.damage = p.stats.damage * BAEKGU_REFLECT_DMG;
    pr.homing = 4;
    pr.color = color;
    n++;
  }
  return n;
}

/** 간파! — the perfect dodge payoff. */
export function perfectDodge(w: World, p: Player): void {
  w.vars.__bgDodged = 1;
  w.vars.__bgDodgeAt = w.time;
  w.vars.__bgCounterUntil = w.time + BAEKGU_COUNTER_TIME + (hasAffinity(w) ? BAEKGU_COUNTER_TIME_AFFINITY : 0);
  // enemy time slows (composes with the time-stop items: the lower scale wins)
  w.enemyTimeScale = Math.min(w.enemyTimeScale, BAEKGU_SLOW_SCALE);
  w.vars.__bgSlowScale = w.enemyTimeScale;
  w.vars.__bgSlowUntil = w.time + BAEKGU_SLOW_TIME;
  p.invuln = Math.max(p.invuln, 0.45);
  p.addEmber(BAEKGU_DODGE_EMBER);
  watch(w, 'bgCounter', 1);
  // feedback: the flash, the word, the sound
  w.hitstop(0.08);
  w.renderer.screenFlash('#ffffff', 0.4);
  w.shake(0.3);
  w.sfx('baekgu_parry', { vol: 1 });
  w.floatText(p.x, p.y - 28 - p.z, '간파!', '#ffffff', 2);
  w.spawn(new RingFx(p.x, p.y - 6, 40, 0.3, '#ffffff', 3));
  w.spawn(new RingFx(p.x, p.y - 6, 24, 0.25, '#c8d8ff', 2));
  w.particles.burst(p.x, p.y - 6, { count: 24, speed: [60, 180], life: [0.15, 0.35], colors: WHITE, shape: 'spark', size: [1, 2], additive: true, light: 6 });
  w.lights.glow(p.x, p.y - 6, 80, '#ffffff', 0.8);
  const reflected = reflectAround(w, p.x, p.y, BAEKGU_REFLECT_RADIUS);
  if (reflected) w.sfx('parry', { vol: 0.6, pitch: 1.2 });
  // the counter slash at the nearest enemy
  const t = w.nearestEnemy(p.x, p.y, BAEKGU_STRIKE_RANGE);
  if (t) {
    const a = angleTo(p.x, p.y, t.x, t.y);
    const s = p.stats;
    const sw = p.swing(w, {
      angle: a, arc: 1.7, reach: BAEKGU_STRIKE_REACH + s.range * 0.03, damage: s.damage * BAEKGU_STRIKE_DMG, knockback: s.knockback * 3,
      color: '#ffffff', reflect: true, visual: 0.18, duration: 0.1, hitKick: 2.5,
    });
    w.vars.__bgStrikeId = sw.id;
    w.sfx('baekgu_counter', { vol: 0.9 });
    p.aim = a;
  }
  proc(w, 'passive:baekgu');
}

/** Try to count the current dash as a perfect dodge (once per dash). */
function tryDodge(w: World, p: Player, predictive: boolean): void {
  if (w.vars.__bgDodged) return;
  const window = dodgeWindow(w);
  if (w.time - (w.vars.__bgDashAt ?? -99) > window) return;
  if (predictive ? threatIncoming(w, p, window) : threatOverlapping(w, p)) perfectDodge(w, p);
}

// ------------------------------------------------------------------ passive
export const BAEKGU_PASSIVE: PassiveDef = {
  name: '간파',
  desc: '공격이 닿기 직전에 대시하면 간파: 탄환을 되받아치고 치명 반격, 잠시 적이 느려지며 피해 +50%.',
  icon: 'icon_baekgu_passive',
  look: { hit: '#ffffff', step: '#e8f0ff' },
  stats(m, _power, w) {
    if (w?.vars && (w.vars.__bgCounterUntil ?? -1) > w.time) m.mulStat('damage', BAEKGU_COUNTER_DMG);
  },
  modifyHit(w, t, hit) {
    if (!isAttack(hit) || !(t instanceof Enemy)) return;
    // the counter slash is always a critical
    if (hit.source && hit.source.id === w.vars.__bgStrikeId && !hit.crit) {
      hit.crit = true;
      hit.damage *= w.player.stats.critMult;
    }
  },
  onUpdate(w, dt) {
    const p = w.player;
    // slow-motion ends (unless a time-stop item took over the scale)
    if ((w.vars.__bgSlowUntil ?? 0) > 0 && w.time >= w.vars.__bgSlowUntil!) {
      if (!timeStopped(w) && Math.abs(w.enemyTimeScale - (w.vars.__bgSlowScale ?? -1)) < 1e-9) w.enemyTimeScale = 1;
      w.vars.__bgSlowUntil = 0;
    }
    watch(w, 'bgCounter', inCounter(w) ? 1 : 0);
    if (inCounter(w) && p.alive && fx.chance(dt * 10)) {
      w.particles.spawn({ x: p.x + fx.range(-5, 5), y: p.y - 8 + fx.range(-6, 6), vy: -fx.range(10, 25), life: 0.3, colors: WHITE, size: 1, additive: true });
    }
  },
  draw(w, r) {
    const p = w.player;
    const since = w.time - (w.vars.__bgDodgeAt ?? -99);
    // a white cross flash right after the dodge
    if (since < 0.22) {
      const k = 1 - since / 0.22;
      const s = 10 + 26 * (1 - k);
      r.line(p.x - s, p.y - 6 - s * 0.6, p.x + s, p.y - 6 + s * 0.6, '#ffffff', 1 + 2 * k, k);
      r.line(p.x - s, p.y - 6 + s * 0.6, p.x + s, p.y - 6 - s * 0.6, '#ffffff', 1 + 2 * k, k);
    }
    if (!inCounter(w)) return;
    const left = (w.vars.__bgCounterUntil ?? 0) - w.time;
    const a = Math.min(1, left / 0.4);
    const duration = BAEKGU_COUNTER_TIME + (hasAffinity(w) ? BAEKGU_COUNTER_TIME_AFFINITY : 0);
    r.line(p.x - 9, p.y + 9, p.x + 9, p.y + 9, '#142030', 3, a);
    r.line(p.x - 9, p.y + 9, p.x - 9 + 18 * Math.min(1, left / duration), p.y + 9, '#e8f0ff', 1, a);
    r.sprite(glowSprite(10, '#c8d8ff'), p.x + 8, p.y - 20 - p.z, { alpha: (0.5 + 0.3 * Math.sin(w.time * 18)) * a, additive: true });
    r.sprite('fx_bg_fang', p.x + 8, p.y - 20 - p.z + Math.sin(w.time * 6) * 0.8, { alpha: a });
  },
};

// ------------------------------------------------------------------ dash
export const BAEKGU_DASH: DashDef = {
  name: '찰나 걸음',
  desc: '짧게 비껴선다. 공격이 닿기 직전에 피하면 간파가 터진다.',
  icon: 'icon_baekgu_dash',
  color: '#ffffff',
  iframes: 0.08,
  start(w, p) {
    w.vars.__bgDashAt = w.time;
    w.vars.__bgDodged = 0;
    tryDodge(w, p, true);
  },
  update(w, p) {
    tryDodge(w, p, false);
  },
};

// ------------------------------------------------------------------ affinity
export const BAEKGU_AFFINITY: AffinityDef = {
  name: '단도·도',
  desc: '짧은 칼을 들면 간파 창이 넓어지고 반격이 길어진다. 이동 속도 +8%.',
  tags: ['quick'],
  ids: ['fang_blade', 'twin_daggers', 'moon_katana', 'chain_sickle', 'return_blade'],
  stats(m) {
    m.mulStat('moveSpeed', 1.08);
  },
};

// ------------------------------------------------------------------ release: 섬광 연참
/** Where 백구 lands to slash `e` from the side she is coming from. */
function slashSpot(w: World, from: { x: number; y: number }, e: Enemy): { x: number; y: number; a: number } {
  const a = angleTo(from.x, from.y, e.x, e.y);
  const d = e.r + 12;
  const free = w.room.nearestFree(e.x - Math.cos(a) * d, e.y - Math.sin(a) * d, 5);
  return { x: free.x, y: free.y, a: angleTo(free.x, free.y, e.x, e.y) };
}

/** A pure-visual slash smear (duration 0: never hits by itself; the release applies its own hits). */
function slashFx(w: World, p: Player, angle: number, reach: number): MeleeSwing {
  return w.spawn(new MeleeSwing(p, { angle, arc: 2.4, reach, damage: 0, duration: 0, visual: 0.16, color: '#ffffff', deflect: false, hitKick: 0 }));
}

/**
 * Flash Slashes: 백구 blurs between the enemies in the room, six white slashes
 * in under a second (each reflecting the bullets around it), then plants her
 * feet and finishes with a heavy cross cut. Lone targets take the falloff.
 */
export function releaseFlashSlashes(w: World, p: Player): void {
  releaseOpen(w, p, '#ffffff', 80);
  w.sfx('baekgu_flash', { vol: 1 });
  const dur = 1.05;
  const every = 0.14;
  p.weapon.mem.hideUntil = w.time + dur;
  const falloff = new HitFalloff(BAEKGU_FLASH_FALLOFF);
  const s = p.stats;
  const reach = 30 + s.range * 0.03;
  let idx = 0;
  const slash = (ww: World, pl: Player, angle: number, dmg: number, falloffOn: boolean): void => {
    const fxs = slashFx(ww, pl, angle, reach);
    let n = 0;
    for (const e of ww.enemies) {
      if (!e.alive || e.hidden || !e.vulnerable || !fxs.contains(e.x, e.y - e.z * 0.5, e.r)) continue;
      if (releaseHit(ww, e, dmg * (falloffOn ? falloff.next(e) : 1), pl.x, pl.y, falloffOn ? 60 : 300)) n++;
    }
    reflectAround(ww, pl.x, pl.y, 40);
    ww.particles.burst(pl.x + Math.cos(angle) * 12, pl.y - 6 + Math.sin(angle) * 8, { count: 10 + n * 4, speed: [60, 160], angle, spread: 1.4, life: [0.1, 0.25], colors: WHITE, shape: 'spark', size: [1, 2], additive: true });
    ww.renderer.kick(Math.cos(angle) * 2, Math.sin(angle) * 2);
  };
  w.spawn(new KitTimeline(dur, (ww, t, dt, self) => {
    const pl = ww.player;
    pl.invuln = Math.max(pl.invuln, dur - t + 0.2);
    let acc = (self.mem.acc ?? 0) + dt;
    while (acc >= every && idx < BAEKGU_FLASH_SLASHES) {
      acc -= every;
      // rotate through the enemies nearest the keeper
      const foes = ww.enemies.filter((e) => e.alive && !e.hidden && e.vulnerable).sort((a, b) => dist(a.x, a.y, pl.x, pl.y) - dist(b.x, b.y, pl.x, pl.y) || a.id - b.id);
      let angle = pl.aim;
      if (foes.length) {
        const e = foes[idx % Math.min(3, foes.length)];
        const spot = slashSpot(ww, pl, e);
        ww.spawn(new Afterimage(pl.frameName(), pl.x, pl.y, pl.flip, '#ffffff', 0.3));
        pl.x = spot.x;
        pl.y = spot.y;
        angle = spot.a;
        pl.aim = angle;
      }
      slash(ww, pl, angle, s.damage * BAEKGU_FLASH_DMG, true);
      ww.sfx('swing', { vol: 0.5, pitch: 1.3 + (idx % 3) * 0.12 });
      ww.sfx('blink', { vol: 0.3, pitch: 1.4 });
      idx++;
    }
    self.mem.acc = acc;
  }, {
    end(ww) {
      const pl = ww.player;
      const t = ww.nearestEnemy(pl.x, pl.y, 60);
      const angle = t ? angleTo(pl.x, pl.y, t.x, t.y) : pl.aim;
      ww.sfx('baekgu_counter', { vol: 1, pitch: 0.85 });
      ww.sfx('slam', { vol: 0.5, pitch: 1.3 });
      ww.hitstop(0.1);
      ww.shake(0.5);
      ww.renderer.screenFlash('#ffffff', 0.35);
      ww.spawn(new RingFx(pl.x, pl.y - 6, 50, 0.35, '#ffffff', 3));
      slash(ww, pl, angle, s.damage * BAEKGU_FLASH_FINAL, false);
      slashFx(ww, pl, angle + 0.6, reach * 1.1);
    },
    draw(r, ww, t) {
      const pl = ww.player;
      const k = 1 - t / dur;
      r.sprite(glowSprite(12, '#c8d8ff'), pl.x, pl.y - 8, { alpha: 0.5 * k + 0.2, additive: true });
    },
    light(ww) {
      ww.lights.add(ww.player.x, ww.player.y - 6, 70, '#c8d8ff', { intensity: 0.8 });
    },
  }));
}
