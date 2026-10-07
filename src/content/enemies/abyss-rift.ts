// Floor 5 — 공허의 심장 (void abyss), part 3:
//  - 균열 등불 (rift lanterns): a linked PAIR of floating lanterns. A void tether joins
//    their eyes: dormant (faint, harmless) -> charging (flickering warning, arrows show the
//    turn) -> active (the line burns and the pair rotates around its midpoint, sweeping the
//    floor). Between cycles the pair drifts to re-centre near the keeper. Kill one and the
//    tether snaps; the survivor fires three-shot fans.
//  - 공허 산란충 (void brood): bloated void insect that keeps its distance and lays eggs
//    (공허 알) — shootable, pulsing brighter as they near hatching into 심연 유충; an egg
//    whose mother is dead bursts into a slow ring of void bullets instead.
// Pure helpers (twin slots, tether hit test, line-up angle, egg stage) are unit-tested in
// tests/enemies-new-f56.test.ts.

import { defineEnemy } from '../../game/defs';
import { Entity } from '../../game/entity';
import { PixelPainter } from '../../engine/painter';
import { RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { angleDiff, approach, clamp, distToSegment, rotateToward, TAU } from '../../engine/math';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { Script } from '../../engine/script';
import { bullet, dust, frames, gather, hurtFrame, landingSpot, sphere } from './shared';
import { VFLESH, VOIDDUST, VPINK, VTEAL } from './abyss';

const VOUT = '#08020f';

// ================================================================== 균열 등불 (rift lanterns)
/** Cold violet lantern iron, darkest first. */
const IRON = ['#0e0818', '#241838', '#3e2e5e', '#6a5898', '#aa9cd8'];
/** Void glass, darkest first. */
const GLASS = ['#2a0c4e', '#4c1a82', '#7c36b8', '#b46ae6', '#e8baff'];
const TETHER_VIOLET = '#a050ff';

type LanMode = 'idle' | 'charge' | 'active' | 'hurt' | 'alone';

function paintLantern(p: PixelPainter, k: number, mode: LanMode): void {
  const hot = mode === 'charge' ? 1 : mode === 'active' ? 2 : 0;
  // hanging ring
  p.px(6, 0, IRON[3]);
  p.px(7, 0, IRON[4]);
  p.px(8, 0, IRON[3]);
  p.px(5, 1, IRON[3]);
  p.px(9, 1, IRON[2]);
  // pagoda roof
  p.rect(5, 2, 5, 1, IRON[3]);
  p.px(5, 2, IRON[4]);
  p.rect(4, 3, 7, 1, IRON[2]);
  p.px(4, 3, IRON[3]);
  p.px(5, 3, IRON[4]);
  p.rect(2, 4, 11, 1, IRON[1]);
  p.px(2, 4, IRON[3]);
  p.px(3, 4, IRON[2]);
  p.px(12, 4, IRON[0]);
  // glass: lit from the top-left, glowing hotter when the tether charges
  for (let y = 5; y <= 13; y++) {
    for (let x = 4; x <= 10; x++) {
      const t = (y - 5) / 8;
      const s = (x - 4) / 6;
      const idx = Math.round(3.1 - t * 1.6 - s * 1.3 + hot * 0.7);
      p.px(x, y, GLASS[clamp(idx, 0, 4)]);
    }
  }
  // a soft halo of light around the eye, a lit left edge and a shaded right edge on the pane
  for (const [x, y] of [[6, 6], [7, 6], [8, 6], [5, 7], [9, 7], [5, 11], [9, 11], [6, 12], [7, 12], [8, 12]] as const) p.px(x, y, GLASS[clamp(3 + hot, 0, 4)]);
  for (let y = 6; y <= 12; y++) p.px(4, y, y < 9 ? GLASS[4] : GLASS[3]);
  for (let y = 7; y <= 13; y++) p.px(10, y, GLASS[clamp(1 + hot, 0, 4)]);
  // swirling void motes inside the glass
  const sw = [[5, 6], [9, 6], [9, 12], [5, 12]] as const;
  for (let i = 0; i < 2; i++) {
    const [x, y] = sw[(k + i * 2) % 4];
    p.px(x, y, hot ? '#ffffff' : GLASS[4]);
  }
  // frame bars and rims
  for (let y = 5; y <= 13; y++) {
    p.px(3, y, IRON[3]);
    p.px(11, y, IRON[1]);
  }
  p.px(3, 5, IRON[4]);
  p.px(3, 9, IRON[4]);
  p.px(11, 9, IRON[2]);
  // flared base with rivets
  p.rect(3, 14, 9, 1, IRON[2]);
  p.px(3, 14, IRON[3]);
  p.px(5, 14, IRON[4]);
  p.px(9, 14, IRON[3]);
  p.rect(2, 15, 11, 1, IRON[1]);
  p.px(2, 15, IRON[2]);
  p.rect(5, 16, 5, 1, IRON[0]);
  // a void wisp drips from the base
  const sway = [0, 1, 0, -1][k % 4];
  p.px(7, 17, VFLESH[3]);
  p.px(7 + sway, 18, mode === 'alone' ? VPINK.mid : VTEAL.mid);
  // the void eye
  const look = mode === 'idle' ? [0, -1, 0, 1][k % 4] : 0;
  if (mode === 'hurt') {
    p.rect(5, 9, 5, 1, '#0a0414');
    p.px(5, 8, '#0a0414');
    p.px(9, 8, '#0a0414');
    p.px(6, 6, '#ffffff');
    p.px(9, 11, '#ffffff');
    return;
  }
  const wide = mode === 'active' || mode === 'alone';
  p.ellipse(7.5, 9.5, 2.7, wide ? 2.4 : 1.8, '#0a0414');
  const iris = mode === 'alone' ? [VPINK.low, VPINK.mid] : mode === 'idle' ? [VTEAL.low, VTEAL.mid] : [VTEAL.mid, VTEAL.hot];
  const ix = 6 + look;
  p.rect(ix, 8, 3, 3, iris[0]);
  p.px(ix + 1, 9, iris[1]);
  p.px(ix + 1, 8, iris[1]);
  p.px(ix + 1, 9, mode === 'active' ? '#ffffff' : '#05020a');
  p.px(ix, 8, '#ffffff');
  if (mode === 'alone') {
    // cracked pane: the tether tore it
    p.line(4, 6, 6, 8, IRON[0]);
    p.line(9, 11, 10, 13, IRON[0]);
    p.px(5, 6, '#ffffff');
  }
  if (mode === 'charge' && k % 2 === 0) {
    p.px(2, 6, VTEAL.hot);
    p.px(12, 12, VTEAL.hot);
  }
}
frames('rlan', 'idle', 4, 15, 19, (p, i) => paintLantern(p, i, 'idle'), { fps: 5, outline: VOUT });
frames('rlan', 'charge', 2, 15, 19, (p, i) => paintLantern(p, i, 'charge'), { fps: 14, outline: VOUT });
frames('rlan', 'active', 2, 15, 19, (p, i) => paintLantern(p, i, 'active'), { fps: 10, outline: VOUT });
frames('rlan', 'alone', 4, 15, 19, (p, i) => paintLantern(p, i, 'alone'), { fps: 8, outline: VOUT });
frames('rlan', 'hurt', 1, 15, 19, (p) => paintLantern(p, 0, 'hurt'), { outline: VOUT });

/** Lantern hover (sprite offset above its ground position). */
const LAN_YO = -11;
/** Tether timing (s): dormant -> charging -> active. */
export const TETHER = { dormant: 1.6, charge: 0.6, active: 1.4 } as const;
/** Half the lantern spacing (px); champions spread wider. */
const SEP = 42;
const SEP_CHAMP = 48;
/** Rotation while active (rad/s). */
const ROT = 0.9;
const ROT_CHAMP = 1.2;
/** Half width of the burning line; a keeper is hit within `p.r + TETHER_HALF` of it. */
export const TETHER_HALF = 2.5;
const REHIT = 0.8;
/** Pair-centre drift toward the keeper while dormant (px/s), and how close it settles. */
const DRIFT = 24;
const SETTLE = 14;
/** The line lines up this far behind the keeper (rad, against the turn) before it burns. */
const LEAD = 0.7;
const AIM_RATE = 0.9;
const FOLLOW_MAX = 62;

/** Cosmetic hover bob of a lantern (draw only). */
function bob(e: Enemy): number {
  return Math.sin(e.age * 2.3 + e.id * 1.3) * 1.5;
}

/** Where a lantern of the pair should be: centre ± half-spacing along the line angle. */
export function pairSlot(mx: number, my: number, th: number, sep: number, side: 1 | -1): { x: number; y: number } {
  return { x: mx + Math.cos(th) * sep * side, y: my + Math.sin(th) * sep * side };
}

/** Is a keeper at (px, py) with radius pr touching the tether segment a–b? */
export function onTether(px: number, py: number, pr: number, ax: number, ay: number, bx: number, by: number, half = TETHER_HALF): boolean {
  return distToSegment(px, py, ax, ay, bx, by) < pr + half;
}

/** Line angle (mod PI) that lies `lead` radians behind the direction `phi`, nearest to `th`. */
export function leadAngle(th: number, phi: number, spin: number, lead = LEAD): number {
  const want = phi - spin * lead;
  return Math.abs(angleDiff(th, want + Math.PI)) < Math.abs(angleDiff(th, want)) ? want + Math.PI : want;
}

let spawningTwin = false;

/** A free flying spot about 80 px from (x, y) for the twin. */
function twinSpot(w: World, x: number, y: number): { x: number; y: number } {
  const room = w.room;
  const a0 = w.rng.angle();
  for (const d of [80, 66, 52, 38]) {
    for (let i = 0; i < 12; i++) {
      const a = a0 + (i / 12) * TAU;
      const tx = x + Math.cos(a) * d;
      const ty = y + Math.sin(a) * d;
      if (tx < room.interiorX + 10 || tx > room.interiorX + room.interiorW - 10) continue;
      if (ty < room.interiorY + 10 || ty > room.interiorY + room.interiorH - 10) continue;
      if (room.boxBlocked(tx, ty, 6, true, false)) continue;
      // never right on top of a keeper (room entry)
      if (w.targets().some((p) => Math.hypot(p.x - tx, p.y - ty) < 40)) continue;
      return { x: tx, y: ty };
    }
  }
  return { x: x + 14, y };
}

/**
 * The pair shares one rank: whatever the placed lantern was given after it spawned
 * (champion / elite roll, encounter HP scaling, damage scale) is mirrored onto its twin.
 */
function mirrorRank(a: Enemy, b: Enemy): void {
  if (a.champion && !b.champion) {
    b.champion = true;
    b.speed = a.speed;
    b.mass = a.mass;
  }
  if (a.mem.elite && !b.mem.elite) {
    b.mem.elite = 1;
    b.r = a.r;
    b.speed = a.speed;
  }
  if (a.champion || a.mem.elite) {
    b.championColor = a.championColor;
    b.scale = a.scale;
  }
  b.enemyDamageScale = Math.max(b.enemyDamageScale, a.enemyDamageScale);
  if (b.maxHp > 0 && b.maxHp !== a.maxHp) {
    b.hp = b.hp * (a.maxHp / b.maxHp);
    b.maxHp = a.maxHp;
  }
}

function steerTo(e: Enemy, x: number, y: number, max = FOLLOW_MAX): void {
  const d = Math.hypot(x - e.x, y - e.y);
  if (d < 0.6) e.stop();
  else e.moveDir(x - e.x, y - e.y, Math.min(max, d * 5));
}

function lanternAnim(e: Enemy, phase: number): void {
  e.setAnim(phase === 2 ? 'rlan_active' : phase === 1 ? 'rlan_charge' : 'rlan_idle');
}

/** The pair's brain (runs on the placed lantern): drift, line up, charge, burn + rotate. */
function* leaderScript(e: Enemy, w: World): Script {
  const t = e.mem.partner as Enemy | undefined;
  if (t) mirrorRank(e, t);
  yield w.rng.range(0.2, 0.5);
  let spin: 1 | -1 = w.rng.chance(0.5) ? 1 : -1;
  const sep = e.champion ? SEP_CHAMP : SEP;
  const rot = e.champion ? ROT_CHAMP : ROT;
  while (t && t.alive) {
    // dormant: re-centre near the keeper and line up a little behind them
    e.mem.tph = 0;
    e.mem.spin = spin;
    lanternAnim(e, 0);
    for (let el = 0; el < TETHER.dormant && t.alive; el += w.dt) {
      const tg = e.target(w);
      const room = w.room;
      let mx = e.mem.mx as number;
      let my = e.mem.my as number;
      const dx = tg.x - mx;
      const dy = tg.y - my;
      const d = Math.hypot(dx, dy);
      if (d > SETTLE) {
        const s = Math.min(DRIFT * w.dt, d - SETTLE);
        mx += (dx / d) * s;
        my += (dy / d) * s;
      }
      e.mem.mx = clamp(mx, room.interiorX + 12, room.interiorX + room.interiorW - 12);
      e.mem.my = clamp(my, room.interiorY + 12, room.interiorY + room.interiorH - 12);
      const phi = Math.atan2(tg.y - e.mem.my, tg.x - e.mem.mx);
      e.mem.th = rotateToward(e.mem.th, leadAngle(e.mem.th, phi, spin), AIM_RATE * w.dt);
      e.mem.sep = approach(e.mem.sep, sep, 24 * w.dt);
      const s0 = pairSlot(e.mem.mx, e.mem.my, e.mem.th, e.mem.sep, 1);
      steerTo(e, s0.x, s0.y);
      yield;
    }
    if (!t.alive) break;
    // charging: the line flickers, arrows show which way it will turn
    e.mem.tph = 1;
    lanternAnim(e, 1);
    e.telegraph(TETHER.charge);
    t.telegraph(TETHER.charge);
    w.sfx('beam_charge', { vol: 0.4, pitch: 1.5, x: e.mem.mx });
    for (let el = 0; el < TETHER.charge && t.alive; el += w.dt) {
      const s0 = pairSlot(e.mem.mx, e.mem.my, e.mem.th, e.mem.sep, 1);
      steerTo(e, s0.x, s0.y);
      yield;
    }
    if (!t.alive) break;
    // active: the tether burns and the pair turns around its centre
    e.mem.tph = 2;
    lanternAnim(e, 2);
    w.sfx('laser', { vol: 0.45, pitch: 0.55, x: e.mem.mx });
    for (let el = 0; el < TETHER.active && t.alive; el += w.dt) {
      e.mem.th += spin * rot * w.dt;
      const s0 = pairSlot(e.mem.mx, e.mem.my, e.mem.th, e.mem.sep, 1);
      steerTo(e, s0.x, s0.y);
      yield;
    }
    e.mem.th = ((e.mem.th % TAU) + TAU) % TAU;
    // usually turn the other way next time
    if (w.rng.chance(0.7)) spin = spin === 1 ? -1 : 1;
  }
  e.mem.tph = 0;
  yield* aloneScript(e, w);
}

/** The twin follows its slot opposite the leader while the tether holds. */
function* twinScript(e: Enemy, w: World): Script {
  while (true) {
    const lead = e.mem.partner as Enemy | undefined;
    if (!lead || !lead.alive) break;
    // a besieging pair (vault encounters) marches on the target together; the room drives it
    if (lead.mem.siege) {
      e.mem.siege = lead.mem.siege;
      return;
    }
    if (typeof lead.mem.mx === 'number') {
      const s = pairSlot(lead.mem.mx, lead.mem.my, lead.mem.th, lead.mem.sep, -1);
      steerTo(e, s.x, s.y);
      lanternAnim(e, lead.mem.tph ?? 0);
    }
    yield;
  }
  yield* aloneScript(e, w);
}

/** Tether broken: the survivor keeps its distance and fires three-shot fans. */
function* aloneScript(e: Enemy, w: World): Script {
  e.mem.alone = 1;
  e.mem.tph = 0;
  e.setAnim('rlan_alone');
  e.halt();
  e.squash(1.3, 0.75);
  yield 0.6;
  let side = w.rng.chance(0.5) ? 1 : -1;
  while (true) {
    e.setAnim('rlan_alone');
    for (let el = 0; el < 1.05; el += w.dt) {
      const d = e.distToTarget(w);
      if (d > 110) e.chase(w, e.speed);
      else if (d < 60) e.flee(w, e.speed);
      else e.moveAngle(e.angleToTarget(w) + (side * Math.PI) / 2, e.speed * 0.6);
      if (e.mem.__bumped) side = -side;
      yield;
    }
    e.halt();
    e.setAnim('rlan_charge');
    e.telegraph(0.45);
    gather(w, e.x, e.y + LAN_YO, ['#ffffff', VTEAL.mid, GLASS[3]], 6, 14);
    w.sfx('orb', { vol: 0.35, pitch: 1.5, x: e.x });
    yield 0.45;
    e.shootAt(w, null, bullet('eldritch', 3, { count: 3, spread: 0.3, speed: 92, z: 11 }));
    e.squash(0.8, 1.2);
  }
}

/** Frozen / stunned / scared lanterns cannot hold the tether taut (it stays harmless). */
function lanternBusy(e: Enemy): boolean {
  return e.hasStatus('freeze') || e.hasStatus('stun') || e.hasStatus('fear');
}

/**
 * The void tether between a pair of rift lanterns. Gameplay entity: it hurts keepers that
 * touch the line while the pair is active; snaps when either lantern dies.
 */
export class VoidTether extends Entity {
  a: Enemy;
  b: Enemy;
  /** keeper -> time of the last hit (per-keeper rehit) */
  private hitAt = new Map<object, number>();

  constructor(a: Enemy, b: Enemy) {
    super();
    this.a = a;
    this.b = b;
    this.x = (a.x + b.x) / 2;
    this.y = (a.y + b.y) / 2;
    this.layer = 2;
    this.tileCollide = false;
    this.team = 'enemy';
  }

  /** 0 dormant, 1 charging, 2 active (read from the pair's leader). */
  get phase(): number {
    if (lanternBusy(this.a) || lanternBusy(this.b) || this.a.dormant > 0) return 0;
    return (this.a.mem.tph as number) ?? 0;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const { a, b } = this;
    if (!a.alive || !b.alive) {
      this.snap(w);
      return;
    }
    this.x = (a.x + b.x) / 2;
    this.y = (a.y + b.y) / 2;
    if (this.phase !== 2) return;
    for (const p of w.targets()) {
      if (!p.alive || p.z > 10) continue;
      const last = this.hitAt.get(p);
      if (last !== undefined && w.time - last < REHIT) continue;
      if (!onTether(p.x, p.y, p.r, a.x, a.y, b.x, b.y)) continue;
      if (p.hurt(w, 1, '균열 등불', false, a)) {
        this.hitAt.set(p, w.time);
        // shove the keeper off the line, away from it
        const lx = b.x - a.x;
        const ly = b.y - a.y;
        const l = Math.hypot(lx, ly) || 1;
        const nx = -ly / l;
        const ny = lx / l;
        const s = (p.x - a.x) * nx + (p.y - a.y) * ny >= 0 ? 1 : -1;
        p.knock(nx * s, ny * s, 150);
      }
    }
    if (fx.chance(0.5)) {
      const k = fx.next();
      w.particles.spawn({
        x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k + LAN_YO, vx: fx.range(-20, 20), vy: fx.range(-24, 6),
        life: fx.range(0.15, 0.3), colors: ['#ffffff', VTEAL.mid, TETHER_VIOLET], size: 1, additive: true, light: 4,
      });
    }
  }

  /** Either lantern died: the line whips apart in sparks. */
  private snap(w: World): void {
    if (this.dead) return;
    this.dead = true;
    const { a, b } = this;
    const lx = b.x - a.x;
    const ly = b.y - a.y;
    const l = Math.hypot(lx, ly) || 1;
    const n = Math.max(4, Math.round(l / 6));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const s = i % 2 ? 1 : -1;
      w.particles.spawn({
        x: a.x + lx * k, y: a.y + ly * k + LAN_YO, vx: (-ly / l) * s * fx.range(30, 70), vy: (lx / l) * s * fx.range(30, 70) - 10,
        life: fx.range(0.25, 0.45), colors: ['#ffffff', VTEAL.mid, TETHER_VIOLET], size: fx.range(1, 2), additive: true, light: 5, drag: 3,
      });
    }
    const alive = a.alive ? a : b.alive ? b : null;
    if (alive) w.spawn(new RingFx(alive.x, alive.y + LAN_YO, 16, 0.3, VTEAL.mid, 2));
    w.sfx('lightning', { vol: 0.4, pitch: 1.7, x: this.x });
  }

  override draw(r: Renderer): void {
    const { a, b } = this;
    if (!a.alive || !b.alive) return;
    const ax = a.x;
    const ay = a.y - a.z + LAN_YO + bob(a);
    const bx = b.x;
    const by = b.y - b.z + LAN_YO + bob(b);
    const ph = this.phase;
    const lx = bx - ax;
    const ly = by - ay;
    const l = Math.hypot(lx, ly) || 1;
    if (ph === 0) {
      // slack: the tether sags between the lanterns, motes drifting along it
      const n = Math.max(4, Math.round(l / 6));
      const sag = Math.min(9, l * 0.08);
      let px0 = ax;
      let py0 = ay;
      for (let i = 1; i <= n; i++) {
        const k = i / n;
        const px1 = ax + lx * k;
        const py1 = ay + ly * k + sag * 4 * k * (1 - k);
        r.pixelLine(px0, py0, px1, py1, '#b070ff', 1, 0.55);
        px0 = px1;
        py0 = py1;
      }
      for (let i = 0; i < 4; i++) {
        const k = (this.age * 0.45 + i / 4) % 1;
        r.rect(ax + lx * k, ay + ly * k + sag * 4 * k * (1 - k) - 1, 1, 1, i % 2 ? VTEAL.hot : '#f0c8ff', 0.9);
      }
      return;
    }
    if (ph === 1) {
      // taut: the hit band on the floor + a flickering line
      r.line(a.x, a.y, b.x, b.y, TETHER_VIOLET, (TETHER_HALF + 5) * 2, 0.12);
      const blink = Math.floor(this.age * 20) % 2 === 0;
      r.pixelLine(ax, ay, bx, by, TETHER_VIOLET, 3, blink ? 0.45 : 0.2);
      r.pixelLine(ax, ay, bx, by, blink ? '#ffffff' : VTEAL.mid, 1, 0.95);
      // curved arrows at both ends show which way the line will turn
      const spin = (a.mem.spin as number) ?? 1;
      const cx = (ax + bx) / 2;
      const cy = (ay + by) / 2;
      const R = l / 2;
      const fa = Math.atan2(ay - cy, ax - cx);
      const run = (this.age * 3) % 1;
      for (const f0 of [fa, fa + Math.PI]) {
        const steps = 6;
        for (let j = 0; j < steps; j++) {
          const f = f0 + spin * (0.16 + j * 0.075);
          const lit = Math.abs(j / steps - run) < 0.2;
          r.rect(cx + Math.cos(f) * R, cy + Math.sin(f) * R, 1, 1, lit ? '#ffffff' : VTEAL.hot, lit ? 1 : 0.7);
        }
        const fe = f0 + spin * (0.16 + steps * 0.075);
        const tx = cx + Math.cos(fe) * R;
        const ty = cy + Math.sin(fe) * R;
        const ux = -Math.sin(fe) * spin;
        const uy = Math.cos(fe) * spin;
        const nx = Math.cos(fe);
        const ny = Math.sin(fe);
        r.pixelLine(tx - ux * 3 + nx * 2, ty - uy * 3 + ny * 2, tx, ty, VTEAL.hot, 1, 0.95);
        r.pixelLine(tx - ux * 3 - nx * 2, ty - uy * 3 - ny * 2, tx, ty, VTEAL.hot, 1, 0.95);
      }
      return;
    }
    // active: a burning violet line with a cyan core that crackles
    r.line(a.x, a.y, b.x, b.y, TETHER_VIOLET, 5, 0.18);
    const wob = 1 + Math.sin(this.age * 55) * 0.15;
    r.line(ax, ay, bx, by, TETHER_VIOLET, 6 * wob, 0.35);
    r.line(ax, ay, bx, by, VTEAL.mid, 3 * wob, 0.95);
    const n = Math.max(3, Math.round(l / 8));
    const nx = -ly / l;
    const ny = lx / l;
    let px0 = ax;
    let py0 = ay;
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const j = i === n ? 0 : Math.sin(this.age * 47 + i * 2.1) * 1.4;
      const px1 = ax + lx * k + nx * j;
      const py1 = ay + ly * k + ny * j;
      r.pixelLine(px0, py0, px1, py1, '#ffffff', 1, 1);
      px0 = px1;
      py0 = py1;
    }
    r.circle(ax, ay, 3, '#ffffff', 0.8);
    r.circle(bx, by, 3, '#ffffff', 0.8);
  }

  override light(w: World): void {
    const { a, b } = this;
    if (!a.alive || !b.alive) return;
    const ph = this.phase;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(l / 26));
    const blink = ph === 0 ? 0.16 : ph === 1 ? (Math.floor(this.age * 20) % 2 === 0 ? 0.45 : 0.2) : 0.75;
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      w.lights.add(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k + LAN_YO, ph === 2 ? 26 : 16, ph === 2 ? '#8a6aff' : VTEAL.mid, { intensity: blink });
    }
  }
}

defineEnemy({
  id: 'rift_lantern',
  name: '균열 등불',
  hp: 26,
  radius: 6,
  speed: 30,
  flying: true,
  sprite: 'rlan_idle',
  shadow: 10,
  spriteYOffset: LAN_YO,
  // the placed lantern brings its twin: the cost covers the pair
  cost: 2,
  floors: [5],
  weight: 0.8,
  champion: true,
  deathFx: 'void',
  bloodColor: '#9a5aff',
  light: { radius: 22, color: '#b468e6' },
  init(e, w) {
    if (spawningTwin) {
      e.mem.twin = 1;
      return;
    }
    const spot = twinSpot(w, e.x, e.y);
    spawningTwin = true;
    let t: Enemy | null = null;
    try {
      t = e.summon(w, 'rift_lantern', spot.x, spot.y);
    } finally {
      spawningTwin = false;
    }
    if (!t) return;
    t.dormant = e.dormant;
    e.mem.partner = t;
    t.mem.partner = e;
    e.mem.partnerId = t.id;
    t.mem.partnerId = e.id;
    e.mem.mx = (e.x + t.x) / 2;
    e.mem.my = (e.y + t.y) / 2;
    e.mem.th = Math.atan2(e.y - t.y, e.x - t.x);
    e.mem.sep = Math.hypot(e.x - t.x, e.y - t.y) / 2;
    e.mem.tph = 0;
    w.spawn(new VoidTether(e, t));
  },
  script(e, w) {
    return e.mem.twin ? twinScript(e, w) : leaderScript(e, w);
  },
  draw(e, r, w) {
    const f0 = e.facing;
    const tg = e.target(w);
    e.facing = tg.x >= e.x ? 1 : -1;
    e.drawDefault(r, hurtFrame(e, w, 'rlan_hurt_0'), LAN_YO + bob(e));
    e.facing = f0;
  },
  onDeath(e, w) {
    w.spawn(new RingFx(e.x, e.y + LAN_YO, 14, 0.3, GLASS[4], 2));
    w.particles.burst(e.x, e.y + LAN_YO, { count: 14, speed: [40, 120], life: [0.25, 0.5], colors: ['#ffffff', GLASS[4], GLASS[2], IRON[3]], size: [1, 2], gravity: 200, vz: [20, 70] });
    w.sfx('clockboss_shatter', { vol: 0.35, pitch: 1.6, x: e.x });
  },
});

// ================================================================== 공허 산란충 (void brood)
/** Void chitin, darkest first (cold violet with a teal sheen on top). */
const CHIT = ['#120720', '#2c1248', '#4c2274', '#7a40a4', '#b67ad8'];
const BROOD_MAX = 3;
export const EGG_HATCH = 2.6;
const LAY_EVERY = 3.2;
const LAY_WARN = 0.5;

function paintBrood(p: PixelPainter, k: number, mode: 'crawl' | 'lay' | 'hurt'): void {
  const lay = mode === 'lay';
  const bob = mode === 'crawl' ? [0, 0, 1, 0][k % 4] : 0;
  // bloated abdomen: a translucent void sac, eggs glowing inside
  const arx = lay ? 6.8 : 7.6;
  const ary = lay ? 5.9 : 5.3;
  const acy = 7.5 + bob * 0.5;
  p.ellipse(8.5, acy, arx, ary, VFLESH[2]);
  sphere(p, 8.5, acy - 0.3, arx, ary, VFLESH, false);
  // segment bands
  for (const x of [4, 7, 10]) for (let y = 5; y < 14; y++) if (p.isSet(x, y) && y > acy - ary + 2) p.px(x, y, VFLESH[1]);
  // eggs inside the sac (little glowing clusters)
  const eggs: [number, number][] = [[5, 8], [8, 6], [9, 10], [12, 8]];
  for (let i = 0; i < eggs.length; i++) {
    const [x, y0] = eggs[i];
    const y = y0 + Math.round(bob * 0.5);
    const lit = lay || (k + i) % 4 === 0;
    p.px(x, y, lit ? VPINK.hot : VPINK.mid);
    p.px(x + 1, y, VPINK.mid);
    p.px(x, y + 1, VPINK.low);
    p.px(x + 1, y + 1, VPINK.low);
  }
  // ovipositor
  if (lay) {
    p.poly([0, 7, 2, 6.5, 2, 10.5, 0, 10], VPINK.low);
    p.px(0, 8, VPINK.hot);
    p.px(0, 9, VPINK.mid);
  } else {
    p.px(1, 8, VFLESH[1]);
  }
  // thorax, pinched off at the waist
  const ty = 8.5 + bob;
  p.ellipse(16.4, ty, 3.2, 3, CHIT[2]);
  sphere(p, 16.4, ty - 0.4, 3.2, 3, CHIT, false);
  for (let y = 6; y <= 11; y++) if (p.isSet(15, y)) p.px(14 + (y % 2), y, CHIT[0]);
  p.px(16, Math.round(ty) - 3, VTEAL.low);
  p.px(17, Math.round(ty) - 3, VTEAL.mid);
  // head
  const hx = 20.6;
  const hy = 9 + bob;
  p.circle(hx, hy, 2.6, CHIT[1]);
  sphere(p, hx, hy - 0.3, 2.6, 2.6, [CHIT[0], CHIT[1], CHIT[2], CHIT[3]], false);
  // three cyan eyes
  const eye = mode === 'hurt' ? CHIT[4] : VTEAL.mid;
  p.px(20, hy - 2, eye);
  p.px(21, hy - 1, eye);
  p.px(21, hy - 2, mode === 'hurt' ? CHIT[4] : '#ffffff');
  p.px(19, hy - 1, eye);
  // mandibles (open while laying = hissing)
  const open = lay ? 1 : 0;
  p.line(22, hy, 23, hy - open, CHIT[3]);
  p.line(22, hy + 1, 23, hy + 2 + open, CHIT[3]);
  // antennae
  p.line(19, hy - 3, 21, hy - 6, CHIT[3]);
  p.px(22, hy - 7 + (k % 2), VTEAL.mid);
  // legs, three pairs scuttling in alternation (only the parts below the body show)
  for (let i = 0; i < 3; i++) {
    const bx = 11 + i * 3;
    const step = mode === 'crawl' ? ((k + i) % 2 ? 1 : -1) : 0;
    p.line(bx, 12, bx - 1 + step, 14, CHIT[3]);
    p.px(bx - 1 + step, 15, CHIT[4]);
    p.line(bx + 1, 12, bx + 2 - step, 14, CHIT[2]);
  }
  if (mode === 'hurt') {
    p.px(7, 4, '#ffffff');
    p.px(11, 6, '#ffffff');
  }
}
frames('vbrood', 'crawl', 4, 24, 16, (p, i) => paintBrood(p, i, 'crawl'), { anchor: 'bottom', fps: 6, outline: VOUT });
frames('vbrood', 'lay', 2, 24, 16, (p, i) => paintBrood(p, i + 1, 'lay'), { anchor: 'bottom', fps: 10, outline: VOUT });
frames('vbrood', 'hurt', 1, 24, 16, (p) => paintBrood(p, 0, 'hurt'), { anchor: 'bottom', outline: VOUT });

/** Shell of a void egg, darkest first. */
const EGG = ['#2a1040', '#6a3c8e', '#a882c8', '#dcc0ee', '#fff0ff'];

/** Egg at hatching stage `s` (0 fresh .. 3 about to burst). */
function paintEgg(p: PixelPainter, s: number, k: number, hurt = false): void {
  const cx = 5.5;
  const cy = 6.6;
  // a glistening puddle of void slime under it
  p.ellipse(cx, 12.4, 5, 1.3, VFLESH[1]);
  p.px(2, 12, VFLESH[2]);
  p.ellipse(cx, cy, 4.3, 5.4, EGG[2]);
  sphere(p, cx, cy - 0.4, 4.3, 5.4, EGG, false);
  // a web of veins over the shell, glowing hotter as it ripens
  const vein = s === 0 ? (k ? '#d02a8a' : VPINK.low) : s === 1 ? '#e83a9c' : VPINK.mid;
  for (const [x0, y0, x1, y1] of [[3, 5, 3, 7], [3, 7, 4, 9], [8, 4, 7, 6], [7, 6, 8, 8], [5, 9, 6, 10]] as const) p.line(x0, y0, x1, y1, vein);
  if (s >= 1) p.px(4, 9, VPINK.hot);
  // the curled larva shows through as the shell thins
  if (s >= 1) {
    p.px(4, 7, EGG[0]);
    p.px(5, 8, EGG[0]);
    p.px(6, 8, EGG[0]);
    p.px(7, 7, EGG[0]);
    p.px(6, 6, s >= 2 ? VPINK.hot : EGG[1]);
  }
  // cracks spread from the top
  if (s >= 2) {
    p.px(5, 1, EGG[0]);
    p.px(6, 2, EGG[0]);
    p.px(5, 3, EGG[0]);
    p.px(6, 4, s >= 3 ? VPINK.hot : EGG[0]);
  }
  if (s >= 3) {
    p.px(3, 3, EGG[0]);
    p.px(2, 4, VPINK.hot);
    p.px(8, 3, EGG[0]);
    p.px(9, 4, VPINK.hot);
    p.px(5, 0, '#ffffff');
  }
  // glossy highlight (top-left)
  if (s < 3) p.px(3, 3, '#ffffff');
  p.px(3, 4, EGG[4]);
  if (hurt) {
    p.px(4, 5, '#ffffff');
    p.px(7, 8, '#ffffff');
    p.px(5, 3, '#ffffff');
  }
}
frames('vegg', 'idle', 2, 11, 14, (p, i) => paintEgg(p, 0, i), { anchor: 'bottom', fps: 3, outline: VOUT });
frames('vegg', 'crack', 3, 11, 14, (p, i) => paintEgg(p, i + 1, 0), { anchor: 'bottom', fps: 1, loop: false, outline: VOUT });
frames('vegg', 'hurt', 1, 11, 14, (p) => paintEgg(p, 1, 0, true), { anchor: 'bottom', outline: VOUT });

/** Hatching stage (0..3) of an egg `t` seconds old. */
export function eggStage(t: number, hatch = EGG_HATCH): number {
  return clamp(Math.floor((t / hatch) * 4), 0, 3);
}

/** Living eggs and hatched larvae of a brood. */
export function broodChildren(w: World, brood: Enemy): number {
  let n = 0;
  for (const o of w.enemies) if (o.alive && o.mem.owner === brood && (o.def.id === 'void_egg' || o.def.id === 'abyss_larva')) n++;
  return n;
}

defineEnemy({
  id: 'void_brood',
  name: '공허 산란충',
  hp: 38,
  radius: 7,
  speed: 24,
  sprite: 'vbrood_crawl',
  spriteYOffset: 5,
  shadow: 20,
  cost: 2,
  floors: [5],
  weight: 0.8,
  champion: true,
  deathFx: 'goo',
  bloodColor: '#b45ae0',
  light: { radius: 20, color: '#ff4fae' },
  dieSfx: 'splat',
  *script(e, w) {
    yield w.rng.range(0.4, 0.9);
    let side = w.rng.chance(0.5) ? 1 : -1;
    let wait = w.rng.range(1.4, 2.2);
    while (true) {
      e.setAnim('vbrood_crawl');
      // keep 70–120 px from the keeper, sidling sideways in between
      for (let el = 0; el < wait; el += w.dt) {
        const d = e.distToTarget(w);
        if (d > 120) e.chase(w, e.speed);
        else if (d < 70) e.flee(w, e.speed);
        else e.moveAngle(e.angleToTarget(w) + (side * Math.PI) / 2, e.speed * 0.55);
        if (e.mem.__bumped) side = -side;
        yield;
      }
      if (broodChildren(w, e) >= BROOD_MAX) {
        wait = 0.8;
        continue;
      }
      wait = LAY_EVERY - LAY_WARN - 0.35;
      // lay: the sac contracts (telegraph), an egg drops behind it
      e.halt();
      e.setAnim('vbrood_lay');
      e.telegraph(LAY_WARN);
      w.sfx('enemy_charge', { vol: 0.3, pitch: 0.7, x: e.x });
      yield LAY_WARN;
      const back = e.facing >= 0 ? -1 : 1;
      const spot = landingSpot(w, e.x + back * 17, e.y + 1, 5);
      const egg = e.summon(w, 'void_egg', spot.x, spot.y);
      if (egg) {
        egg.mem.owner = e;
        egg.dormant = 0;
      }
      e.squash(1.25, 0.8);
      w.sfx('splat', { vol: 0.45, pitch: 1.3, x: e.x });
      w.particles.burst(spot.x, spot.y - 3, { count: 6, speed: [20, 50], life: [0.2, 0.4], colors: [VPINK.hot, VPINK.mid, VFLESH[2]], size: [1, 1], gravity: 200, vz: [10, 40] });
      yield 0.35;
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'vbrood_hurt_0'));
  },
  onDeath(e, w) {
    w.particles.burst(e.x, e.y - 4, { count: 10, speed: [30, 80], life: [0.3, 0.6], colors: VOIDDUST, size: [1, 2], additive: true });
    dust(w, e.x, e.y, [VFLESH[2], VFLESH[1]], 5, 40);
  },
});

/** Egg hatches: a larva for a living mother, else a slow ring of void bullets. */
function hatch(e: Enemy, w: World): void {
  const owner = e.mem.owner as Enemy | undefined;
  e.mem.hatched = 1;
  if (owner && owner.alive) {
    const l = e.summon(w, 'abyss_larva', e.x, e.y);
    if (l) {
      l.mem.owner = owner;
      l.dormant = 0.35;
    }
    w.sfx('splat', { vol: 0.5, pitch: 1.5, x: e.x });
  } else {
    e.shootRing(w, 4, bullet('void', 3, { speed: 48, offset: w.rng.angle(), z: 4 }));
  }
  w.particles.burst(e.x, e.y - 5, { count: 12, speed: [30, 90], life: [0.25, 0.5], colors: ['#ffffff', VPINK.hot, EGG[3], EGG[1]], size: [1, 2], gravity: 240, vz: [30, 80] });
  w.spawn(new RingFx(e.x, e.y - 4, 12, 0.25, VPINK.mid, 1));
  // the shell is gone (no kill credit, no drops)
  e.dead = true;
  e.hp = 0;
}

defineEnemy({
  id: 'void_egg',
  name: '공허 알',
  hp: 8,
  radius: 5,
  speed: 0,
  mass: Infinity,
  contactDamage: 0,
  sprite: 'vegg_idle',
  spriteYOffset: 4,
  shadow: 10,
  cost: 0.3,
  champion: false,
  deathFx: 'goo',
  bloodColor: '#c06aff',
  light: { radius: 14, color: '#ff4fae' },
  dieSfx: 'splat',
  *script(e, w) {
    e.mem.hatchT = 0;
    while (e.mem.hatchT < EGG_HATCH) {
      e.stop();
      e.mem.hatchT += w.dt;
      if (!e.mem.warned && e.mem.hatchT > EGG_HATCH - 0.45) {
        e.mem.warned = 1;
        e.telegraph(0.45);
        w.sfx('enemy_charge', { vol: 0.2, pitch: 1.8, x: e.x });
      }
      yield;
    }
    hatch(e, w);
  },
  draw(e, r, w) {
    const t = (e.mem.hatchT as number) ?? 0;
    const s = eggStage(t);
    // the glow is the warning: it pulses faster and brighter as the egg ripens
    const k = clamp(t / EGG_HATCH, 0, 1);
    const pulse = 0.5 + 0.5 * Math.sin(t * (5 + k * 16));
    r.circle(e.x, e.y - 5, 6 + k * 3 + pulse * 1.5, VPINK.mid, (0.06 + 0.14 * k) * (0.6 + 0.4 * pulse));
    if (k > 0.55) r.ring(e.x, e.y - 5, 8 + (1 - pulse) * 4, VPINK.hot, 1, 0.3 + 0.4 * k);
    const frame = s === 0 ? e.frame() : `vegg_crack_${s - 1}`;
    e.drawDefault(r, w.time - e.lastHurtAt < 0.14 ? 'vegg_hurt_0' : frame);
  },
  onDeath(e, w) {
    if (e.mem.hatched) return;
    // shot before it hatched: a harmless pop
    w.particles.burst(e.x, e.y - 4, { count: 10, speed: [20, 70], life: [0.25, 0.5], colors: [EGG[4], EGG[2], VPINK.mid], size: [1, 2], gravity: 260, vz: [20, 60] });
  },
});
