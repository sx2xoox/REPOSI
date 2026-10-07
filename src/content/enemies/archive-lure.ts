// Floor 6 — 수몰된 서고 (drowned archive), part 3:
//  - 등불 아귀 (lamp anglerfish): its lure casts a searchlight cone that sweeps around the
//    keeper. Stay in the light too long (it lingers on you, reddening) and it spots you:
//    "!" — then it looses homing ink torpedoes and its lure goes dark for a while.
//    Rocks and shelves block the light.
//  - 유령 타자기 (haunted typewriter): a stationary turret. Keys clatter (warning arc), then
//    it types a left-to-right stream of glyphs, rings its bell and slams the carriage back
//    with a fast return sweep of page shots.
// Pure helpers (cone test, sweep angles) are unit-tested in tests/enemies-new-f56.test.ts.

import { defineEnemy } from '../../game/defs';
import { Entity } from '../../game/entity';
import { PixelPainter } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { RingFx } from '../../game/effects';
import { tileProps } from '../../game/tiles';
import { fx } from '../../engine/rng';
import { angleDiff, clamp, rotateToward } from '../../engine/math';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { ProjBehavior } from '../../game/projectile';
import type { Player } from '../../game/player';
import { bullet, BUL, frames, gather, hurtFrame, sphere, WARN_RED } from './shared';
import { AOUT, CYAN, GOLD, glyphShot, INKB, INKDUST, inkSplash, PAPER, pages, toward } from './archive-shared';

// ================================================================== 등불 아귀 (lamp anglerfish)
/** Deep-sea teal, darkest first. */
const ANG = ['#04141e', '#0c3240', '#185664', '#2e8488', '#68bcb2'];
/** The lure's warm lamplight. */
const LAMP = { hot: '#fff8d8', mid: '#ffd36a', low: '#c8862a', dim: '#3a4c50' };

type AnglerMode = 'swim' | 'alert' | 'shoot' | 'dark' | 'hurt';

function paintAngler(p: PixelPainter, k: number, mode: AnglerMode): void {
  const sway = mode === 'swim' || mode === 'dark' ? [0, 1, 0, -1][k % 4] : 0;
  const lit = mode !== 'dark' && mode !== 'hurt';
  // tail fin (left), fanning
  p.poly([1, 6 - sway, 6, 9, 6, 12, 1, 15 + sway, 3, 10.5], ANG[2]);
  p.line(1, 6 - sway, 5, 10, ANG[3]);
  p.line(1, 15 + sway, 5, 11, ANG[1]);
  // round body
  p.ellipse(12.5, 10.5, 8, 6.2, ANG[2]);
  sphere(p, 12.5, 10, 8, 6.2, ANG, false);
  // bioluminescent freckles along the flank
  for (const [x, y] of [[8, 12], [11, 14], [14, 15], [7, 9]] as const) p.px(x, y, (x + k) % 3 === 0 ? CYAN.mid : CYAN.low);
  // dorsal spines
  for (const x of [8, 10, 12]) {
    p.px(x, 4, ANG[3]);
    p.px(x, 3, ANG[2]);
  }
  // pectoral fin
  const fl = mode === 'swim' || mode === 'dark' ? k % 2 : 0;
  p.poly([9, 13, 12, 13, 8, 17 - fl, 6, 16 - fl], ANG[3]);
  p.line(9, 13, 7, 16 - fl, ANG[4]);
  // the jaw: an underbite full of needle teeth, wider when it attacks
  const open = mode === 'shoot' ? 3 : mode === 'alert' ? 2 : 0;
  p.poly([15, 12 - open * 0.3, 22, 10 - open * 0.7, 23, 12, 22, 14 + open * 0.6, 16, 15], ANG[3]);
  p.poly([16, 12.5, 21.5, 11 - open * 0.6, 21.5, 12.5 + open * 0.5, 16, 14], '#02060a');
  if (open) p.px(19, 12, mode === 'shoot' ? CYAN.mid : INKB[3]);
  for (const x of [17, 19, 21]) p.px(x, Math.round(11.7 - open * 0.5 - (x - 16) * 0.12), PAPER[3]);
  for (const x of [16, 18, 20]) p.px(x, Math.round(14 + open * 0.4 - (x - 16) * 0.1), PAPER[2]);
  p.px(22, 14 + (open ? 1 : 0), ANG[4]);
  // small pale eye
  const ex = 17;
  const ey = 8;
  if (mode === 'hurt') {
    p.line(ex - 1, ey, ex + 1, ey, ANG[0]);
  } else {
    p.px(ex, ey, mode === 'alert' ? '#ffffff' : '#d8f4ec');
    p.px(ex + 1, ey, mode === 'alert' ? '#ffffff' : CYAN.low);
    p.px(ex, ey - 1, ANG[0]);
    p.px(ex + 1, ey + 1, ANG[0]);
  }
  // illicium: a stalk arching forward from the brow, ending in the lamp
  const lx = 23 + (mode === 'swim' || mode === 'dark' ? (k % 2) * 0.5 : 0);
  p.line(15, 5, 16, 2, ANG[3]);
  p.line(16, 2, 18, 1, ANG[3]);
  p.line(18, 1, 21, 1, ANG[4]);
  p.line(21, 1, Math.round(lx), 2, ANG[3]);
  const by = 4;
  if (lit) {
    p.circle(lx, by, 1.7, LAMP.low);
    p.px(Math.round(lx) - 1, by - 1, LAMP.mid);
    p.px(Math.round(lx), by - 1, mode === 'alert' ? '#ffffff' : LAMP.hot);
    p.px(Math.round(lx) - 1, by, LAMP.mid);
    p.px(Math.round(lx), by, LAMP.mid);
  } else {
    p.circle(lx, by, 1.5, LAMP.dim);
    p.px(Math.round(lx) - 1, by - 1, '#5a6a6c');
  }
  if (mode === 'hurt') {
    p.px(10, 7, '#ffffff');
    p.px(13, 11, '#ffffff');
  }
}
const ANG_W = 26;
const ANG_H = 19;
frames('langler', 'swim', 4, ANG_W, ANG_H, (p, i) => paintAngler(p, i, 'swim'), { fps: 6, outline: AOUT });
frames('langler', 'dark', 4, ANG_W, ANG_H, (p, i) => paintAngler(p, i, 'dark'), { fps: 6, outline: AOUT });
frames('langler', 'alert', 2, ANG_W, ANG_H, (p, i) => paintAngler(p, i, 'alert'), { fps: 12, outline: AOUT });
frames('langler', 'shoot', 1, ANG_W, ANG_H, (p) => paintAngler(p, 0, 'shoot'), { outline: AOUT });
frames('langler', 'hurt', 1, ANG_W, ANG_H, (p) => paintAngler(p, 0, 'hurt'), { outline: AOUT });

// "!" over a spotting angler
defineDrawnSprite('__langler_mark', 3, 9, (p) => {
  p.rect(0, 0, 3, 6, '#ffec50');
  p.rect(1, 0, 1, 6, '#ffffff');
  p.rect(0, 7, 3, 2, '#ffec50');
  p.px(1, 7, '#ffffff');
}, { outline: '#1c0a00' });

// homing ink torpedo (points right): bright glyph-blue body, white-hot nose, inky fins
defineDrawnSprite('__langler_torp', 11, 5, (p) => {
  const pal = BUL.glyph;
  p.ellipse(5.5, 2.5, 4.6, 2.2, pal.rim);
  p.ellipse(5.8, 2.2, 3.8, 1.5, pal.color);
  p.rect(8, 2, 2, 1, pal.core);
  p.px(10, 2, '#ffffff');
  p.px(4, 2, pal.rim);
  p.px(6, 2, pal.rim);
  p.line(0, 0, 2, 2, INKB[3]);
  p.line(0, 4, 2, 2, INKB[3]);
  p.px(0, 2, INKB[2]);
}, { outline: BUL.glyph.outline });

/** Searchlight: length (px), half-angle, sweep amplitude around the keeper and timings. */
export const CONE = { len: 120, half: 0.28, sweep: 0.7, rate: 1.6, linger: 0.35, spot: 0.6, decay: 0.6, alert: 0.45, dark: 2.2 } as const;
const ANG_YO = -6;
/** Lure tip relative to the sprite pivot when facing right (x, y). */
const LURE_DX = 10;
const LURE_DY = -6;
const TORP_TURN = 1.7;
const TORP_HOME = 2.2;

/** Ground point under the lure (where the light cone starts). */
export function lureGround(e: Enemy): { x: number; y: number } {
  const face = (e.mem.face as number) || 1;
  return { x: e.x + face * LURE_DX, y: e.y + 1 };
}

/** Is a keeper at (px, py) (radius pr) inside the cone from (ox, oy) along `aim`? (no occlusion) */
export function inCone(ox: number, oy: number, aim: number, px: number, py: number, pr = 5, len: number = CONE.len, half: number = CONE.half): boolean {
  const dx = px - ox;
  const dy = py - oy;
  const d = Math.hypot(dx, dy);
  if (d > len + pr) return false;
  if (d < 8) return true;
  return Math.abs(angleDiff(aim, Math.atan2(dy, dx))) <= half + pr / d;
}

/** Light ray from (x, y): distance until a wall / rock / shelf blocks it (max `max`). */
function lightRay(w: World, x: number, y: number, a: number, max: number): number {
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let d = 4; d <= max; d += 4) {
    if (tileProps(w.room.tileAtPx(x + c * d, y + s * d)).blocksShots) return Math.max(0, d - 2);
  }
  return max;
}

/** Torpedo behavior: steer toward `target` for the first seconds, trailing ink bubbles. */
function torpedoHoming(target: Player): ProjBehavior {
  return {
    id: 'ink-torpedo',
    update(p, w, dt) {
      if (p.age < TORP_HOME && target.alive) {
        p.angle = rotateToward(p.angle, Math.atan2(target.y - 4 - p.y, target.x - p.x), TORP_TURN * dt);
        p.syncVel();
      }
      if (fx.chance(0.45)) {
        w.particles.spawn({
          x: p.x - Math.cos(p.angle) * 5, y: p.y - p.z - Math.sin(p.angle) * 5, vx: fx.range(-6, 6), vy: fx.range(-10, -2),
          life: fx.range(0.25, 0.45), colors: [p.age < TORP_HOME ? CYAN.mid : INKB[3], INKB[2]], size: 1, alpha: 0.85,
        });
      }
    },
  };
}

/**
 * The angler's searchlight: a soft wedge of lamplight on the floor (clipped by rocks) and
 * the lights along it. Purely visual — the cone test lives in the angler's script.
 */
export class AnglerLight extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  owner: Enemy;
  constructor(owner: Enemy) {
    super();
    this.owner = owner;
    this.x = owner.x;
    this.y = owner.y;
    this.layer = 0;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    if (!this.owner.alive) this.dead = true;
    this.x = this.owner.x;
    this.y = this.owner.y;
  }

  /** 0..1 strength of the light this frame. */
  private strength(): number {
    const e = this.owner;
    if (!e.alive || !e.mem.lit) return 0;
    return clamp((e.mem.litK as number) ?? 0, 0, 1);
  }

  override draw(r: Renderer, w: World): void {
    const e = this.owner;
    const k = this.strength();
    if (k <= 0) return;
    const o = lureGround(e);
    const aim = (e.mem.lure as number) ?? 0;
    const heat = clamp(((e.mem.spot as number) ?? 0) / CONE.spot, 0, 1);
    const alert = !!e.mem.alert;
    const col = alert ? '#ff6a3a' : toward(LAMP.mid, '#ff5a2a', heat);
    const n = 10;
    const pts: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = aim - CONE.half + (2 * CONE.half * i) / n;
      const l = lightRay(w, o.x, o.y, a, CONE.len);
      pts.push(o.x + Math.cos(a) * l, o.y + Math.sin(a) * l);
    }
    const c = r.ctx;
    const vx = r.viewX;
    const vy = r.viewY;
    const flick = alert ? 0.75 + 0.25 * Math.sin(this.age * 40) : 1;
    c.save();
    // wedge
    c.globalAlpha = (0.16 + 0.12 * heat) * k * flick;
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(o.x - vx, o.y - vy);
    for (let i = 0; i < pts.length; i += 2) c.lineTo(pts[i] - vx, pts[i + 1] - vy);
    c.closePath();
    c.fill();
    // brighter core
    c.globalAlpha = 0.12 * k * flick;
    c.fillStyle = LAMP.hot;
    c.beginPath();
    c.moveTo(o.x - vx, o.y - vy);
    for (let i = 6; i <= pts.length - 8; i += 2) c.lineTo(o.x + (pts[i] - o.x) * 0.7 - vx, o.y + (pts[i + 1] - o.y) * 0.7 - vy);
    c.closePath();
    c.fill();
    c.restore();
    // crisp edges: the danger zone has a readable border
    const ea = (0.45 + 0.4 * heat) * k * flick;
    r.pixelLine(o.x, o.y, pts[0], pts[1], col, 1, ea);
    r.pixelLine(o.x, o.y, pts[pts.length - 2], pts[pts.length - 1], col, 1, ea);
    // the shaft of light from the lamp down to the floor
    const face = (e.mem.face as number) || 1;
    r.pixelLine(e.x + face * LURE_DX, e.y - e.z + ANG_YO + LURE_DY + 1, o.x, o.y, LAMP.mid, 1, 0.25 * k);
  }

  override light(w: World): void {
    const e = this.owner;
    const k = this.strength();
    const face = (e.mem.face as number) || 1;
    if (e.alive) {
      // the lamp itself (dim when dark)
      w.lights.add(e.x + face * LURE_DX, e.y - e.z + ANG_YO + LURE_DY, k > 0 ? 20 : 8, LAMP.mid, { intensity: k > 0 ? 0.9 * k : 0.25 });
    }
    if (k <= 0) return;
    const o = lureGround(e);
    const aim = (e.mem.lure as number) ?? 0;
    const heat = clamp(((e.mem.spot as number) ?? 0) / CONE.spot, 0, 1);
    const col = e.mem.alert || heat > 0.6 ? '#ff9a5a' : '#ffd88a';
    for (const [d, rad] of [[22, 16], [50, 24], [84, 30]] as const) {
      const l = lightRay(w, o.x, o.y, aim, d);
      if (l < d - 4) break;
      w.lights.add(o.x + Math.cos(aim) * d, o.y + Math.sin(aim) * d, rad, col, { intensity: 0.55 * k });
    }
  }
}

/** Keep 70–100 px from the keeper, drifting sideways; returns the (possibly flipped) side. */
function swimAround(e: Enemy, w: World, side: number, speed = e.speed): number {
  const d = e.distToTarget(w);
  const a = e.angleToTarget(w);
  if (d > 100) e.moveAngle(a + side * 0.4, speed);
  else if (d < 70) e.moveAngle(a + Math.PI - side * 0.4, speed);
  else e.moveAngle(a + (side * Math.PI) / 2, speed * 0.5);
  return e.mem.__bumped ? -side : side;
}

/** Face toward `a` (left / right) with a little hysteresis so the lamp does not flicker sides. */
function faceToward(e: Enemy, a: number): void {
  const c = Math.cos(a);
  if (c > 0.2) e.mem.face = 1;
  else if (c < -0.2) e.mem.face = -1;
  else if (!e.mem.face) e.mem.face = 1;
}

/** Is any keeper inside the lit cone (with line of sight)? Returns the first one. */
function lit(e: Enemy, w: World): Player | null {
  const o = lureGround(e);
  for (const p of w.targets()) {
    if (!p.alive || p.z > 12) continue;
    if (!inCone(o.x, o.y, e.mem.lure, p.x, p.y, p.r)) continue;
    if (!w.room.lineOfSight(o.x, o.y, p.x, p.y)) continue;
    return p;
  }
  return null;
}

defineEnemy({
  id: 'lamp_angler',
  name: '등불 아귀',
  hp: 40,
  radius: 7,
  speed: 30,
  mass: 1.5,
  flying: true,
  sprite: 'langler_swim',
  shadow: 18,
  spriteYOffset: ANG_YO,
  cost: 2,
  floors: [6],
  weight: 0.8,
  champion: true,
  deathFx: 'blood',
  bloodColor: '#1a5a62',
  dieSfx: 'splat',
  light: { radius: 14, color: CYAN.low },
  init(e, w) {
    e.mem.face = 1;
    e.mem.aim = e.angleToTarget(w);
    e.mem.lure = e.mem.aim;
    e.mem.ph = w.rng.angle();
    e.mem.spot = 0;
    e.mem.lit = 0;
    e.mem.litK = 0;
    w.spawn(new AnglerLight(e));
  },
  *script(e, w) {
    yield w.rng.range(0.3, 0.7);
    let side = w.rng.chance(0.5) ? 1 : -1;
    while (true) {
      // the lamp lights up (harmless while it warms) and starts searching
      e.mem.lit = 1;
      e.mem.litK = 0;
      e.mem.spot = 0;
      e.setAnim('langler_swim');
      w.sfx('lamp_hum', { vol: 0.25, pitch: 1.4, x: e.x });
      let spotted: Player | null = null;
      while (!spotted) {
        e.mem.litK = Math.min(1, e.mem.litK + w.dt / 0.35);
        side = swimAround(e, w, side);
        const tg = e.target(w);
        const o = lureGround(e);
        e.mem.aim = rotateToward(e.mem.aim, Math.atan2(tg.y - o.y, tg.x - o.x), 1.2 * w.dt);
        faceToward(e, e.mem.aim);
        const inside = e.mem.litK >= 1 ? lit(e, w) : null;
        // the light lingers on whoever it catches
        e.mem.ph += CONE.rate * (inside ? CONE.linger : 1) * w.dt;
        e.mem.lure = e.mem.aim + CONE.sweep * Math.sin(e.mem.ph);
        if (inside) {
          e.mem.spot += w.dt;
          if (e.mem.spot >= CONE.spot) spotted = inside;
        } else {
          e.mem.spot = Math.max(0, e.mem.spot - CONE.decay * w.dt);
        }
        yield;
      }
      // spotted: "!" — the light locks on and flares
      const prey: Player = spotted;
      e.halt();
      e.mem.alert = 1;
      e.setAnim('langler_alert');
      e.telegraph(CONE.alert);
      w.sfx('warn', { vol: 0.45, pitch: 1.2, x: e.x });
      for (let el = 0; el < CONE.alert; el += w.dt) {
        const o = lureGround(e);
        e.mem.lure = rotateToward(e.mem.lure, Math.atan2(prey.y - o.y, prey.x - o.x), 3 * w.dt);
        faceToward(e, e.mem.lure);
        yield;
      }
      e.mem.alert = 0;
      // the lamp goes dark as the torpedoes leave the jaw
      e.mem.lit = 0;
      e.mem.spot = 0;
      e.setAnim('langler_shoot');
      const face = (e.mem.face as number) || 1;
      const mx = e.x + face * 8;
      const my = e.y + 2;
      const n = e.champion ? 3 : 2;
      const base = Math.atan2(prey.y - my, prey.x - mx);
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * 0.7;
        e.shoot(w, base + off, {
          x: mx, y: my, speed: 50, accel: 110, maxSpeed: 84, life: 3, range: 900, radius: 3, z: 6,
          color: BUL.glyph.color, sprite: '__langler_torp', spriteRotates: true, light: 20,
          behaviors: [torpedoHoming(prey)],
        });
      }
      w.sfx('ink_splash', { vol: 0.5, pitch: 0.7, x: e.x });
      w.sfx('enemy_shoot', { vol: 0.4, pitch: 0.7, x: e.x });
      inkSplash(w, mx, my, 0.6);
      e.squash(0.85, 1.15);
      yield 0.3;
      // dark: swim off and wait for the lamp to rekindle
      e.setAnim('langler_dark');
      for (let el = 0.3; el < CONE.dark; el += w.dt) {
        side = swimAround(e, w, side);
        faceToward(e, e.angleToTarget(w));
        yield;
      }
    }
  },
  draw(e, r, w) {
    const f0 = e.facing;
    e.facing = (e.mem.face as number) || 1;
    const y = ANG_YO + Math.sin(e.age * 2.1) * 1.2;
    e.drawDefault(r, hurtFrame(e, w, 'langler_hurt_0'), y);
    e.facing = f0;
    if (e.mem.alert) {
      const b = Math.abs(Math.sin(e.age * 14)) * 2;
      r.sprite('__langler_mark', e.x, e.y - e.z + y - 16 - b);
    }
  },
  onDeath(e, w) {
    inkSplash(w, e.x, e.y, 1.2);
    w.particles.burst(e.x + ((e.mem.face as number) || 1) * LURE_DX, e.y + ANG_YO + LURE_DY, { count: 10, speed: [30, 90], life: [0.3, 0.6], colors: [LAMP.hot, LAMP.mid, LAMP.low], size: [1, 2], additive: true, light: 6 });
  },
});

// ================================================================== 유령 타자기 (haunted typewriter)
/** Drowned typewriter iron (teal-black), darkest first. */
const TW = ['#060c10', '#10222a', '#1e3c46', '#365e66', '#62908e'];
const RUST = ['#5a2e16', '#8a4a22'];
const TYPE = { count: 10, gap: 0.09, spread: 0.6, retCount: 5, retGap: 0.04, clatter: 0.5, rest: 1.4 } as const;

type TypeMode = 'idle' | 'clatter' | 'type' | 'ding' | 'return' | 'hurt';

/** `carriage` = how far the paper + roller have moved left (0..4 px). */
function paintTypewriter(p: PixelPainter, k: number, mode: TypeMode, carriage = 0): void {
  const jit = mode === 'clatter' ? [0, 1, -1][k % 3] : 0;
  const cx = -carriage + jit;
  // ---- the carriage: paper sheet + platen roller + return lever
  const sway = mode === 'idle' ? [0, 0, 1][k % 3] : mode === 'clatter' ? k % 2 : 0;
  // paper (typed lines of ink, wet at the bottom)
  p.rect(7 + cx, 0 + sway, 8, 7 - sway, PAPER[2]);
  p.rect(7 + cx, 0 + sway, 8, 1, PAPER[3]);
  p.rect(14 + cx, 1 + sway, 1, 6 - sway, PAPER[1]);
  const typed = mode === 'type' ? carriage + 1 : mode === 'ding' || mode === 'return' ? 5 : 3;
  for (let i = 0; i < Math.min(6, typed + 1); i++) p.px(8 + i + cx, 2 + sway, INKB[3]);
  for (let i = 0; i < 5; i++) if (i % 3 !== 2) p.px(8 + i + cx, 4 + sway, INKB[2]);
  p.px(8 + cx, 6, toward(PAPER[1], '#2a6a6a', 0.5));
  p.px(12 + cx, 6, toward(PAPER[1], '#2a6a6a', 0.5));
  // platen roller with knobs
  p.rect(2 + cx, 7, 18, 2, TW[1]);
  p.rect(2 + cx, 7, 18, 1, TW[3]);
  p.px(3 + cx, 7, TW[4]);
  p.rect(0 + cx, 6, 2, 3, TW[2]);
  p.px(0 + cx, 6, TW[4]);
  p.rect(20 + cx, 6, 2, 3, TW[2]);
  p.px(21 + cx, 8, TW[0]);
  // carriage-return lever (left), pulled during the return
  if (mode === 'return') {
    p.line(1 + cx, 6, -1 + cx + 2, 4, GOLD);
    p.px(0 + cx, 4, '#f0d890');
  } else {
    p.line(1 + cx, 6, 0 + cx, 3, GOLD);
    p.px(0 + cx, 3, '#f0d890');
  }
  // ---- the body
  p.poly([3, 9, 19, 9, 21, 17, 1, 17], TW[2]);
  p.rect(3, 9, 16, 1, TW[3]);
  p.px(3, 9, TW[4]);
  for (let y = 10; y < 17; y++) {
    p.px(Math.floor(3 - (y - 9) / 4), y, TW[3]);
    p.px(Math.ceil(18 + (y - 9) / 4), y, TW[1]);
  }
  // type-bar basket under the paper: a fan of thin bars
  p.rect(8, 9, 6, 1, TW[0]);
  for (let i = 0; i < 5; i++) p.px(8 + i + (i > 2 ? 1 : 0), 10, i % 2 ? TW[1] : TW[0]);
  if (mode === 'type') {
    // a bar strikes up at the paper
    p.line(11, 10, 11 - Math.round(carriage * 0.2), 6, TW[4]);
    p.px(11 - Math.round(carriage * 0.2), 6, '#ffffff');
  }
  // rust and water stains
  p.px(4, 12, RUST[0]);
  p.px(5, 13, RUST[1]);
  p.px(17, 11, RUST[0]);
  p.px(18, 15, RUST[1]);
  // ghostly keys: three rows of glowing caps
  const pressed = (i: number, row: number) => {
    if (mode === 'clatter') return (i * 3 + row * 5 + k * 7) % 4 === 0;
    if (mode === 'type') return i === (carriage * 2 + row) % 6 && row === carriage % 3;
    return false;
  };
  for (let row = 0; row < 3; row++) {
    const y = 11 + row * 2;
    const n = 6 + (row === 2 ? 1 : 0);
    const x0 = row === 0 ? 5 : row === 1 ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * 2 + (row === 1 ? 1 : 0);
      const down = pressed(i, row);
      p.px(x, y, down ? CYAN.low : mode === 'hurt' ? '#ffffff' : (i + row + k) % 5 === 0 ? CYAN.hot : CYAN.mid);
      p.px(x, y + 1, TW[0]);
      if (!down && i % 2 === 0) p.px(x + 1, y, TW[1]);
    }
  }
  // space bar + base
  p.rect(6, 17, 10, 1, TW[3]);
  p.rect(1, 18, 20, 1, TW[0]);
  // the bell (top right), struck on "ding"
  if (mode === 'ding') {
    p.rect(18 + cx, 3, 3, 2, GOLD);
    p.px(19 + cx, 2, '#f0d890');
    p.px(17 + cx, 1, '#ffffff');
    p.px(21, 1, '#ffffff');
  } else {
    p.rect(18 + cx, 4, 2, 2, toward(GOLD, '#000000', 0.3));
  }
  // ghost wisps rising off the keys
  if (mode === 'idle' || mode === 'clatter') {
    const wx = [6, 15, 11][k % 3];
    p.px(wx, 10 - (k % 2), CYAN.low);
  }
}
const TW_W = 22;
const TW_H = 19;
frames('gtype', 'idle', 3, TW_W, TW_H, (p, i) => paintTypewriter(p, i, 'idle'), { anchor: 'bottom', fps: 3, outline: AOUT });
frames('gtype', 'clatter', 3, TW_W, TW_H, (p, i) => paintTypewriter(p, i, 'clatter'), { anchor: 'bottom', fps: 18, outline: AOUT });
frames('gtype', 'type', 5, TW_W, TW_H, (p, i) => paintTypewriter(p, i, 'type', i), { anchor: 'bottom', fps: 11, loop: false, outline: AOUT });
frames('gtype', 'ding', 1, TW_W, TW_H, (p) => paintTypewriter(p, 0, 'ding', 4), { anchor: 'bottom', outline: AOUT });
frames('gtype', 'return', 2, TW_W, TW_H, (p, i) => paintTypewriter(p, i, 'return', 3 - i * 3), { anchor: 'bottom', fps: 16, loop: false, outline: AOUT });
frames('gtype', 'hurt', 1, TW_W, TW_H, (p) => paintTypewriter(p, 0, 'hurt', 1), { anchor: 'bottom', outline: AOUT });

/** Angles of the typed stream: `count` keys from aim − spread (left) to aim + spread (right). */
export function typeAngles(aim: number, count: number = TYPE.count, spread: number = TYPE.spread): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(aim - spread + (2 * spread * i) / Math.max(1, count - 1));
  return out;
}

/** Angles of the carriage return: the same arc swept back, right to left. */
export function returnAngles(aim: number, count: number = TYPE.retCount, spread: number = TYPE.spread): number[] {
  return typeAngles(aim, count, spread).reverse();
}

defineEnemy({
  id: 'ghost_typewriter',
  name: '유령 타자기',
  hp: 44,
  radius: 7,
  speed: 0,
  mass: Infinity,
  sprite: 'gtype_idle',
  spriteYOffset: 6,
  shadow: 22,
  cost: 1.8,
  floors: [6],
  weight: 0.8,
  champion: true,
  deathFx: 'metal',
  bloodColor: '#2a4a52',
  hurtSfx: 'hit_metal',
  light: { radius: 18, color: CYAN.mid },
  *script(e, w) {
    yield w.rng.range(0.6, 1.2);
    while (true) {
      e.setAnim('gtype_idle');
      e.stop();
      // keys clatter: the arc it is about to type across lights up
      const aim = e.angleToTarget(w);
      e.mem.aim = aim;
      e.mem.warn = 1;
      e.setAnim('gtype_clatter');
      e.telegraph(TYPE.clatter);
      for (let el = 0; el < TYPE.clatter - 0.01; el += 0.1) {
        w.sfx('clock_tick', { vol: 0.3, pitch: fx.range(1.6, 2.1), x: e.x });
        yield 0.1;
      }
      e.mem.warn = 0;
      // type: a left-to-right stream of glyphs (the carriage creeps left)
      e.mem.typing = 1;
      e.setAnim('gtype_type', true);
      const keys = typeAngles(aim);
      for (let i = 0; i < keys.length; i++) {
        e.mem.key = i;
        e.shoot(w, keys[i], glyphShot(3, i % 3, { speed: 92, z: 8, range: 420 }));
        if (e.champion) e.shoot(w, keys[i] - 0.32, glyphShot(3, (i + 1) % 3, { speed: 78, z: 8, range: 420 }));
        w.sfx('clock_tick', { vol: 0.4, pitch: 1.3 + (i % 3) * 0.12, x: e.x });
        yield TYPE.gap;
      }
      // ding!
      e.mem.typing = 0;
      e.setAnim('gtype_ding');
      w.sfx('clock_chime', { vol: 0.45, pitch: 2.2, x: e.x });
      w.spawn(new RingFx(e.x + 8, e.y - 16, 6, 0.25, GOLD, 1));
      yield 0.25;
      // carriage return: a fast sweep of page shots back across the same arc
      e.setAnim('gtype_return', true);
      w.sfx('clock_ratchet', { vol: 0.45, pitch: 1.2, x: e.x });
      for (const a of returnAngles(aim)) {
        e.shoot(w, a, bullet('page', 3, { speed: 122, z: 8, range: 420 }));
        yield TYPE.retGap;
      }
      e.squash(1.15, 0.9);
      e.setAnim('gtype_idle');
      yield TYPE.rest;
    }
  },
  update(e, w) {
    e.stop();
    if (fx.chance(0.04)) {
      w.particles.spawn({ x: e.x + fx.range(-7, 7), y: e.y - 6, vy: -fx.range(6, 14), life: fx.range(0.6, 1.0), colors: [CYAN.mid, CYAN.low], size: 1, alpha: 0.6, additive: true });
    }
  },
  draw(e, r, w) {
    const f0 = e.facing;
    e.facing = 1;
    // the warning arc: the typed stream will sweep across it, left to right
    if (e.mem.warn) {
      const aim = e.mem.aim as number;
      const k = clamp(1 - e.telegraphT / Math.max(0.01, e.telegraphMax), 0, 1);
      const c = r.ctx;
      c.save();
      c.globalAlpha = 0.18 + 0.12 * Math.sin(e.age * 30);
      c.fillStyle = WARN_RED;
      c.beginPath();
      c.arc(e.x - r.viewX, e.y - r.viewY, 34, aim - TYPE.spread, aim + TYPE.spread);
      c.arc(e.x - r.viewX, e.y - r.viewY, 14, aim + TYPE.spread, aim - TYPE.spread, true);
      c.closePath();
      c.fill();
      c.restore();
      // a cursor runs left -> right along the arc
      const a = aim - TYPE.spread + 2 * TYPE.spread * k;
      r.pixelLine(e.x + Math.cos(a) * 14, e.y + Math.sin(a) * 14, e.x + Math.cos(a) * 36, e.y + Math.sin(a) * 36, '#ffffff', 1, 0.85);
      for (const edge of [aim - TYPE.spread, aim + TYPE.spread]) {
        r.pixelLine(e.x + Math.cos(edge) * 14, e.y + Math.sin(edge) * 14, e.x + Math.cos(edge) * 34, e.y + Math.sin(edge) * 34, WARN_RED, 1, 0.8);
      }
    }
    let frame = hurtFrame(e, w, 'gtype_hurt_0');
    if (frame !== 'gtype_hurt_0' && e.mem.typing) frame = `gtype_type_${Math.min(4, Math.floor(((e.mem.key as number) ?? 0) / 2))}`;
    e.drawDefault(r, frame);
    e.facing = f0;
  },
  onDeath(e, w) {
    pages(w, e.x, e.y - 12, 5, 50);
    w.particles.burst(e.x, e.y - 8, { count: 14, speed: [30, 100], life: [0.3, 0.6], colors: [CYAN.hot, CYAN.mid, TW[3], TW[1]], size: [1, 2], gravity: 260, vz: [30, 90] });
    w.particles.burst(e.x, e.y - 6, { count: 8, speed: [20, 50], life: [0.6, 1.0], colors: INKDUST, size: [1, 1], additive: false });
    w.sfx('clock_chime', { vol: 0.35, pitch: 1.4, x: e.x });
  },
});
