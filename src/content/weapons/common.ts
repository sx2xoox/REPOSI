// Shared helpers for weapons: hand anchoring, held-sprite drawing, swing pose
// animation, recoil / camera kick, muzzle flashes and beam raycasts.
//
// Conventions for every weapon in this folder:
//  - `w.items.onAttack(aim)` exactly once per attack, *before* spawning hits.
//  - projectiles through `p.fireProjectiles` (fires onShoot hooks); melee through
//    `p.swing` (hits go through applyHit -> item onHit hooks).
//  - all per-run weapon state lives in `WeaponState` (`st.mem`), never in the def.

import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer, DrawOpts } from '../../engine/renderer';
import type { WeaponState } from '../../game/defs';
import { clamp, ease } from '../../engine/math';
import { TILE } from '../../game/constants';
import { Tile, tileProps } from '../../game/tiles';

export const O = '#0c0810';

/** Where the weapon hand is (world px) when pointing `angle` at `dist` px from the body. */
export function handPos(p: Player, angle: number, dist: number): { x: number; y: number } {
  return { x: p.x + Math.cos(angle) * dist, y: p.y - 5 + Math.sin(angle) * dist * 0.8 };
}

/** Draw a held sprite (authored pointing right, pivot at the grip) toward `angle`. */
export function drawHeld(r: Renderer, p: Player, sprite: string, angle: number, dist: number, o: DrawOpts = {}): void {
  const h = handPos(p, angle, dist);
  r.sprite(sprite, h.x, h.y, { rot: angle, flipY: Math.cos(angle) < 0, ...o });
}

/** Directional camera kick (px). Positive = along `angle`. */
export function kick(w: World, angle: number, amount: number): void {
  w.renderer.kick(Math.cos(angle) * amount, Math.sin(angle) * amount);
}

/** Small muzzle flash: sparks + a light pulse. */
export function muzzle(w: World, x: number, y: number, angle: number, colors: string[], count = 5, speed: [number, number] = [40, 120]): void {
  w.particles.burst(x, y, { count, speed, angle, spread: 0.7, life: [0.06, 0.18], colors, shape: 'spark', size: [1, 2] });
  // one short-lived bright particle carries the light pulse
  w.particles.spawn({ x, y, life: 0.08, size: 2, sizeEnd: 1, colors: ['#ffffff', colors[0]], light: 22, lightColor: (colors[1] ?? colors[0]).slice(0, 7) });
}

// ------------------------------------------------------------------ swing pose
/**
 * Start a swing pose animation: the held weapon rotates from `from` to `to`
 * (absolute angles) over `dur` seconds, holds for `hold`, then eases back to rest.
 */
export function startSwingPose(st: WeaponState, w: World, from: number, to: number, dur: number, hold = 0.08): void {
  st.mem.swFrom = from;
  st.mem.swTo = to;
  st.mem.swAt = w.time;
  st.mem.swDur = dur;
  st.mem.swHold = hold;
  st.mem.restSide = Math.sign(angleNorm(to - from)) || 1;
}

/**
 * Current weapon angle. `rest` = idle angle. Returns the pose angle and phase:
 * 0 = idle, 1 = swinging, 2 = holding the end pose, 3 = returning.
 */
export function swingPose(st: WeaponState, w: World, rest: number): { angle: number; phase: number; t: number } {
  const at = st.mem.swAt;
  if (at === undefined) return { angle: rest, phase: 0, t: 0 };
  const el = w.time - at;
  const dur = st.mem.swDur ?? 0.1;
  const hold = st.mem.swHold ?? 0.08;
  const from = st.mem.swFrom ?? rest;
  const to = st.mem.swTo ?? rest;
  if (el < dur) {
    const t = el / dur;
    return { angle: from + angleNorm(to - from) * ease.outCubic(t), phase: 1, t };
  }
  if (el < dur + hold) return { angle: to, phase: 2, t: 1 };
  const back = 0.14;
  if (el < dur + hold + back) {
    const t = (el - dur - hold) / back;
    return { angle: to + angleNorm(rest - to) * ease.inOutQuad(t), phase: 3, t };
  }
  return { angle: rest, phase: 0, t: 0 };
}

/** Wrap an angle difference into (-PI, PI]. */
export function angleNorm(a: number): number {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Idle angle for a held melee weapon: lowered beside the body on the side of the last swing. */
export function meleeRest(st: WeaponState, aim: number): number {
  const side = st.mem.restSide ?? (Math.cos(aim) >= 0 ? 1 : -1);
  return aim + side * 1.25;
}

// ------------------------------------------------------------------ attack timing
/** Seconds per attack from the fire-rate stat, with a weapon multiplier. */
export function attackInterval(p: Player, mult = 1): number {
  return mult / Math.max(0.2, p.stats.fireRate);
}

/** Fraction 0..1 of a charge that takes `full` seconds at base fire rate (faster with fire rate). */
export function chargeTime(p: Player, full: number): number {
  return full * clamp(2.6 / Math.max(0.4, p.stats.fireRate), 0.35, 2.5);
}

// ------------------------------------------------------------------ raycasts
/**
 * March from (x,y) along `angle` until a shot-blocking tile (walls always; rocks
 * unless `spectral`). Returns the free distance (<= maxDist).
 */
export function rayLength(w: World, x: number, y: number, angle: number, maxDist: number, spectral = false): number {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const step = 3;
  for (let d = 0; d <= maxDist; d += step) {
    const tx = Math.floor((x + c * d) / TILE);
    const ty = Math.floor((y + s * d) / TILE);
    const t = w.room.tileAt(tx, ty);
    const pr = tileProps(t);
    if (pr.blocksShots && !(spectral && t !== Tile.WALL && t !== Tile.DOOR)) return Math.max(0, d - step * 0.5);
  }
  return maxDist;
}

/** Distance from point to segment (and the segment parameter 0..1). */
export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; t: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const l2 = abx * abx + aby * aby;
  const t = l2 > 0 ? clamp(((px - ax) * abx + (py - ay) * aby) / l2, 0, 1) : 0;
  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  return { d: Math.hypot(dx, dy), t };
}

/** Crisp 1px line in world space (Bresenham with rects; for strings / chains). */
export function pixLine(r: Renderer, x0: number, y0: number, x1: number, y1: number, color: string, alpha = 1): void {
  let ax = Math.round(x0);
  let ay = Math.round(y0);
  const bx = Math.round(x1);
  const by = Math.round(y1);
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  for (let n = 0; n < 200; n++) {
    r.rect(ax, ay, 1, 1, color, alpha);
    if (ax === bx && ay === by) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; ax += sx; }
    if (e2 <= dx) { err += dx; ay += sy; }
  }
}
