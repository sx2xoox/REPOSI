// 등불 족제비 (lantern weasel): the quarry of the 등불 도둑 사냥 mission room (hunt.ts).
// A masked thief that carries the room's three stolen embers in a brass lantern hung
// from its tail. It never fights back directly: it flees (scoring 16 directions away
// from the hunters), hops out of boxes, scatters caltrops behind it, flares a ring of
// embers when crowded, and every so often runs for a shadow crack in the wall.
//
// Bringing its bar down never kills it while it belongs to a hunt: the hit that would
// stops at 1 HP, the weasel tumbles (1.2 s, untouchable) and drops one ember (the
// mission device's `knockdown`). Standalone (debug spawn, detsim) it is a plain critter.
//
// The art is code-drawn (2026-10-07 direction): 22x14 side frames (run / crouch / down /
// slip) and a 16x20 periscope stand (taunt), 1 px dark outline, light from the top-left.

import { defineEnemy } from '../../game/defs';
import { GroundWarning } from '../../game/effects';
import { PixelPainter } from '../../engine/painter';
import { fx } from '../../engine/rng';
import { TAU } from '../../engine/math';
import type { Renderer } from '../../engine/renderer';
import type { Enemy } from '../../game/enemy';
import type { Player } from '../../game/player';
import type { World } from '../../game/world';
import { bullet, frames } from '../enemies/shared';
import { EnemyOverlay } from '../enemies/crypt-toll';
import { Entity } from '../../game/entity';
import { roomLabel } from './encounter-kit';

export const WEASEL_ID = 'lantern_weasel';
export const HUNT_COLOR = '#b6e36e';
export const ESCAPE_COLOR = '#a77bff';

/** Weasel states (e.mem.state). */
export const ST = { flee: 0, hop: 1, flare: 2, dash: 3, down: 4, race: 5, escape: 6, channel: 7, yank: 8, leap: 9 } as const;

/** Floor band b = min(2, floor((floor - 1) / 3)): floors 1–3 / 4–6 / 7+. */
export const huntBand = (floor: number): number => Math.max(0, Math.min(2, Math.floor((floor - 1) / 3)));
export const HUNT_BAND = {
  /** seconds between escape attempts (−1 s per extra hunter, at least 10) */
  interval: [16, 14, 12],
  /** how long it sinks into a crack before it is gone */
  channel: [2.6, 2.3, 2.0],
  /** caltrop cadence (x0.8 once cornered) */
  caltrop: [0.7, 0.55, 0.45],
  /** flare ring size */
  flare: [8, 10, 12],
  /** minion wave base (x encounterCount) */
  wave: [2, 3, 4],
} as const;
/** Bar size by embers already lost (k = 3 - held). */
export const BAR_MULT = [1, 1.15, 1.3];
/** a hit that drops the bar by this share of its max during a channel drags the weasel out */
export const DRAG_OUT = 0.3;
export const DOWN_TIME = 1.2;
export const FLARE_WIND = 0.55;
export const HOP_COOLDOWN = 1.5;
const SPEED_CAP = 88;
const FAN = 16;

/** The mission device as the weasel sees it (implemented by HuntDevice in hunt.ts). */
export interface HuntLink {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  dead: boolean;
  mem: {
    phase: number; used: boolean; members: number; held: number; lightR: number;
    cornered: number; escState: number; escCrack: number; band: number; chanT: number;
  };
  knockdown(w: World, e: Enemy): void;
  /** the weasel touches a landed ember: takes it back (true) */
  regrab(w: World, e: Enemy): boolean;
  /** nearest landed ember within `max` px */
  nearestEmber(w: World, x: number, y: number, max: number): { x: number; y: number } | null;
  /** channel point of crack i */
  crack(i: number): { x: number; y: number };
  beginChannel(w: World, e: Enemy): void;
  caltrop(w: World, e: Enemy): void;
  channelTime(): number;
}

/** The hunt the weasel belongs to (null: standalone, or the hunt is over). */
export function huntOf(w: World, e: Enemy): HuntLink | null {
  if (!e.mem.root) return null;
  const r = w.entityById(e.mem.root) as unknown as HuntLink | undefined;
  if (!r || r.dead || r.mem.used || r.mem.phase !== 1 || typeof r.knockdown !== 'function') return null;
  return r;
}

/** Keepers in slot order that count for the hunt: alive, standing, present and members. */
export function hunters(w: World, mask: number): Player[] {
  const out: Player[] = [];
  for (const p of w.coop ? w.players : [w.player]) if (p.alive && !p.downed && !p.left && (mask & (1 << p.slot))) out.push(p);
  return out;
}

function nearestDist(hs: Player[], x: number, y: number): number {
  let d = Infinity;
  for (const p of hs) d = Math.min(d, Math.hypot(p.x - x, p.y - y));
  return d;
}

function nearestHunter(hs: Player[], x: number, y: number): Player | null {
  let best: Player | null = null;
  let bd = Infinity;
  for (const p of hs) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/** Straight line blocked for a ground body of radius 6 (sampled every 8 px). */
function lineBlocked(w: World, x0: number, y0: number, x1: number, y1: number): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(d / 8));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (w.room.boxBlocked(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 6, false, false)) return true;
  }
  return false;
}

/** Flee score of a spot: far from the nearest hunter, off the walls, out of the tree's light. */
function spotScore(w: World, hs: Player[], link: HuntLink | null, x: number, y: number): number {
  const room = w.room;
  let s = hs.length ? nearestDist(hs, x, y) : 160;
  if (x < room.interiorX + 24 || x > room.interiorX + room.interiorW - 24 || y < room.interiorY + 24 || y > room.interiorY + room.interiorH - 24) s -= 25;
  if (link && link.mem.lightR > 0 && Math.hypot(x - link.x, y - link.y) < link.mem.lightR) s -= 60;
  return s;
}

/** Final move speed (px/s after the floor's enemySpeed), expressed as the want-speed Enemy.update scales. */
function speedOf(w: World, held: number, mult: number): number {
  const es = w.floor?.enemySpeed ?? 1;
  return Math.min(SPEED_CAP, (66 + 6 * (3 - held)) * mult * es) / es;
}

function heldOf(e: Enemy, link: HuntLink | null): number {
  return link ? link.mem.held : (e.mem.held ?? 3);
}

/** Fly / harm flags back to normal after an interrupted hop (jumpTo restores them only when it ends). */
function cancelHop(e: Enemy): void {
  if (!e.script.done) {
    e.script.stop();
    e.flying = false;
    e.harmful = true;
  }
  e.mem.jump = 0;
}

function startHop(e: Enemy, w: World, hs: Player[], link: HuntLink | null, toward: { x: number; y: number } | null, after: number): void {
  const room = w.room;
  const rot = w.rng.range(0, Math.PI / FAN);
  let best = -Infinity;
  let bx = e.x;
  let by = e.y;
  for (let i = 0; i < FAN * 2; i++) {
    const a = rot + (i % FAN) * (TAU / FAN);
    const rad = i < FAN ? 64 : 80;
    const x = e.x + Math.cos(a) * rad;
    const y = e.y + Math.sin(a) * rad;
    if (x < room.interiorX + 8 || x > room.interiorX + room.interiorW - 8 || y < room.interiorY + 8 || y > room.interiorY + room.interiorH - 8) continue;
    if (!room.isFree(x, y, 7)) continue;
    const s = toward ? -Math.hypot(toward.x - x, toward.y - y) : spotScore(w, hs, link, x, y);
    if (s > best) { best = s; bx = x; by = y; }
  }
  if (best === -Infinity) {
    const f = room.nearestFree(e.x, e.y, 7);
    bx = f.x;
    by = f.y;
  }
  const m = e.mem;
  m.state = ST.hop;
  m.t = 0.35;
  m.hx = bx;
  m.hy = by;
  m.after = after;
  m.hopCd = HOP_COOLDOWN;
  m.stuck = 0;
  e.halt();
}

/** Pick the next flee waypoint (16 directions x {44, 72} px, fan turned a little each time). */
function pickWaypoint(e: Enemy, w: World, hs: Player[], link: HuntLink | null): boolean {
  const room = w.room;
  const m = e.mem;
  const rot = w.rng.range(0, Math.PI / 8);
  let best = -Infinity;
  let bx = e.x;
  let by = e.y;
  for (let i = 0; i < FAN * 2; i++) {
    const a = rot + (i % FAN) * (TAU / FAN);
    const rad = i < FAN ? 44 : 72;
    const x = e.x + Math.cos(a) * rad;
    const y = e.y + Math.sin(a) * rad;
    if (!room.isFree(x, y, 7) || lineBlocked(w, e.x, e.y, x, y)) continue;
    const s = spotScore(w, hs, link, x, y);
    if (s > best) { best = s; bx = x; by = y; }
  }
  if ((best === -Infinity || best < 30 || m.stuck >= 0.25) && m.hopCd <= 0) {
    startHop(e, w, hs, link, null, ST.flee);
    return false;
  }
  if (best > -Infinity) {
    m.wpx = bx;
    m.wpy = by;
    m.best = best;
  }
  return true;
}

function moveTo(e: Enemy, x: number, y: number, speed: number): number {
  const dx = x - e.x;
  const dy = y - e.y;
  const d = Math.hypot(dx, dy);
  if (d < 1.5) e.stop();
  else e.moveDir(dx, dy, Math.min(speed, d * 12));
  return d;
}

/** Bar size for the current number of embers held (refilled on spawn and after each tumble). */
export function weaselBar(e: Enemy, held: number): number {
  const k = Math.max(0, Math.min(2, 3 - held));
  return Math.max(1, Math.round((e.mem.bb ?? e.maxHp) * BAR_MULT[k]));
}

function update(e: Enemy, w: World, dt: number): void {
  const m = e.mem;
  const link = huntOf(w, e);
  const hs = hunters(w, link ? link.mem.members : 15);
  const held = heldOf(e, link);
  m.held = held;
  m.cd = Math.max(0, (m.cd ?? 0) - dt);
  m.hopCd = Math.max(0, (m.hopCd ?? 0) - dt);
  m.stuck = m.__bumped ? (m.stuck ?? 0) + dt : 0;
  const near44 = hs.some((p) => Math.hypot(p.x - e.x, p.y - e.y) <= 44);
  m.press = near44 ? (m.press ?? 0) + dt : Math.max(0, (m.press ?? 0) - dt);
  const near120 = hs.some((p) => Math.hypot(p.x - e.x, p.y - e.y) <= 120);
  const jumping = !e.script.done;
  m.taunt = 0;

  // Takes a lying ember back (hunters claim first: the device runs before the weasel each step).
  if (link && m.state !== ST.down && m.state !== ST.hop && m.state !== ST.channel && m.state !== ST.leap && !jumping && link.regrab(w, e)) {
    callout(w, e.x, e.y - 30, '도로 채 갔다!', '#ffb080');
    w.sfx('whoosh', { vol: 0.5, pitch: 1.2 });
    if (m.state === ST.race) m.state = ST.flee;
  }
  // the hunt ended an escape (sealed, cancelled): back to fleeing
  if ((m.state === ST.escape || m.state === ST.channel) && (!link || link.mem.escState === 0)) {
    m.state = ST.flee;
    m.repick = 0;
  }

  switch (m.state) {
    case ST.leap: {
      // bursting out of the tree: untouchable until it lands
      e.stop();
      if (!jumping) { m.state = ST.flee; m.repick = 0; e.vulnerable = true; }
      break;
    }
    case ST.hop: {
      if (m.t > 0) {
        e.halt();
        m.t -= dt;
        if (m.t <= 0) { m.jump = 1; e.script.set(e.jumpTo(w, m.hx, m.hy, 0.5, 18)); }
      } else if (!jumping) {
        m.jump = 0;
        m.state = m.after === ST.escape && link && link.mem.escState === 1 ? ST.escape : ST.flee;
        m.repick = 0;
        m.stuck = 0;
      }
      break;
    }
    case ST.flare: {
      e.halt();
      m.t -= dt;
      if (m.t <= 0) {
        const n = HUNT_BAND.flare[link ? link.mem.band : 0];
        e.shootRing(w, n, bullet('molten', 3, { speed: 70, damage: 1, offset: w.rng.range(0, TAU / n) }));
        const p = nearestHunter(hs, e.x, e.y);
        m.da = p ? Math.atan2(e.y - p.y, e.x - p.x) : w.rng.angle();
        m.state = ST.dash;
        m.t = 0.3;
        m.cd = link && link.mem.cornered ? 1.8 : 2.5;
        m.press = 0;
        w.sfx('whoosh', { vol: 0.45 });
      }
      break;
    }
    case ST.dash: {
      e.moveAngle(m.da, speedOf(w, held, 1) * 1.6);
      m.t -= dt;
      if (m.t <= 0) { m.state = ST.flee; m.repick = 0; }
      break;
    }
    case ST.down: {
      e.halt();
      m.t -= dt;
      if (m.t <= 0) {
        e.vulnerable = true;
        if (m.bb) e.maxHp = e.hp = weaselBar(e, held);
        const em = link?.nearestEmber(w, e.x, e.y, 110);
        if (em) { m.state = ST.race; m.rx = em.x; m.ry = em.y; }
        else { m.state = ST.flee; m.repick = 0; }
      }
      break;
    }
    case ST.race: {
      const em = link?.nearestEmber(w, e.x, e.y, 400);
      if (!em) { m.state = ST.flee; m.repick = 0; break; }
      m.rx = em.x;
      m.ry = em.y;
      moveTo(e, em.x, em.y, speedOf(w, held, 1.15));
      if (m.stuck >= 0.25) { m.state = ST.flee; m.repick = 0; }
      break;
    }
    case ST.escape: {
      const c = link!.crack(link!.mem.escCrack);
      const d = moveTo(e, c.x, c.y, speedOf(w, held, 1.1));
      if (d <= 4) {
        e.halt();
        e.x = c.x;
        e.y = c.y;
        m.state = ST.channel;
        link!.beginChannel(w, e);
        break;
      }
      dropCaltrops(e, w, link!, dt);
      if (m.stuck >= 0.25 && m.hopCd <= 0) startHop(e, w, hs, link, c, ST.escape);
      break;
    }
    case ST.channel: {
      e.halt();
      // violet smoke rises while it squeezes in (cosmetic)
      if (fx.chance(dt * 18)) w.particles.spawn({ x: e.x + fx.range(-6, 6), y: e.y + fx.range(-2, 2), vx: fx.range(-6, 6), vy: -fx.range(8, 20), life: fx.range(0.4, 0.8), colors: ['#c9a0ff', '#7a4aa8', '#3a1c58'], size: fx.range(1, 2), sizeEnd: 3, fade: true });
      break;
    }
    case ST.yank: {
      if (!jumping) e.halt();
      m.t -= dt;
      if (m.t <= 0 && !jumping) { m.state = ST.flee; m.repick = 0; }
      break;
    }
    default: {
      // flee
      m.state = ST.flee;
      if (jumping) { e.stop(); break; }
      m.repick = (m.repick ?? 0) - dt;
      const arrived = Math.hypot((m.wpx ?? e.x) - e.x, (m.wpy ?? e.y) - e.y) < 3;
      if (m.repick <= 0 || arrived || m.stuck >= 0.25) {
        m.repick = 0.35;
        if (!pickWaypoint(e, w, hs, link)) break;
      }
      const trot = !near120;
      // nobody close: it saunters, and stands up to look around once a step gains little
      if (trot && (m.best ?? 0) - spotScore(w, hs, link, e.x, e.y) < 16) {
        e.stop();
        m.taunt = 1;
      } else moveTo(e, m.wpx, m.wpy, speedOf(w, held, trot ? 0.55 : 1));
      if (!link) break;
      if (near120) dropCaltrops(e, w, link, dt);
      if (m.press >= 0.5 && m.cd <= 0) {
        m.state = ST.flare;
        m.t = FLARE_WIND;
        e.halt();
        e.telegraph(FLARE_WIND);
        w.spawn(new GroundWarning(e.x, e.y, 40, FLARE_WIND));
        w.sfx('beam_charge', { vol: 0.45, pitch: 1.3 });
      }
    }
  }
}

function dropCaltrops(e: Enemy, w: World, link: HuntLink, dt: number): void {
  const m = e.mem;
  m.drop = (m.drop ?? 0) - dt;
  if (m.drop > 0) return;
  m.drop = HUNT_BAND.caltrop[link.mem.band] * (link.mem.cornered ? 0.8 : 1);
  if (link.nearestEmber(w, e.x, e.y, 16)) return;
  link.caltrop(w, e);
}

function onHurt(e: Enemy, w: World): void {
  const link = huntOf(w, e);
  if (!link || e.hp >= 1) return;
  // never dies while it belongs to a hunt: it tumbles and loses an ember instead (overkill is lost)
  e.hp = 1;
  e.vulnerable = false;
  cancelHop(e);
  e.halt();
  e.telegraphT = 0;
  e.mem.state = ST.down;
  e.mem.t = DOWN_TIME;
  e.squash(1.4, 0.6);
  link.knockdown(w, e);
}

// ================================================================== art
// Long low body with a cream belly, a cream face crossed by a black bandit mask, and a
// ringed bushy tail that rises from the rump and reaches forward over the back like a
// fishing rod, the stolen brass lantern dangling from its tip (1 px clear of the back).
const FUR = { k: '#1a0f1a', d: '#3b2233', m: '#5e3a44', l: '#8a5a52', h: '#b07a62' };
const CREAM = '#e8d2a8';
const CREAM_SH = '#b49478';
const MASK = '#120a12';
const GLINT = '#ffe27a';
const BRASS = { r: '#7a5530', b: '#c39c65', B: '#efd9a4', k: '#4a2e16' };
const GLASS = '#2a1a24';
const GLASS_HI = '#6e5868';

/** Lantern glass anchors per frame (unpadded sprite px: where the flame stands). */
const LANTERN = new Map<string, [number, number]>();
const SIDE_ORIGIN: [number, number] = [11, 13];
const STAND_ORIGIN: [number, number] = [8, 19];

/** Fill a shape mask with column shading: lit top edge, mid fur, dark underside. */
function shadeBody(p: PixelPainter, mask: PixelPainter, belly: (x: number) => boolean, lit: number): void {
  for (let x = 0; x < mask.w; x++) {
    let top = -1;
    let bot = -1;
    for (let y = 0; y < mask.h; y++) if (mask.isSet(x, y)) { if (top < 0) top = y; bot = y; }
    if (top < 0) continue;
    for (let y = top; y <= bot; y++) {
      if (!mask.isSet(x, y)) continue;
      const k = y - top;
      const fromBot = bot - y;
      let c = k === 0 ? (x < lit ? FUR.h : FUR.l) : k === 1 ? FUR.l : FUR.m;
      if (fromBot === 0) c = belly(x) ? CREAM_SH : FUR.d;
      else if (fromBot === 1 && bot - top >= 3) c = belly(x) ? CREAM : FUR.m;
      p.px(x, y, c);
    }
  }
}

/** Ringed tail along a polyline (t = 0 rump .. 1 tip): bushy middle, cream tip, lit top-left. */
function paintTail(p: PixelPainter, pts: number[][]): void {
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); segs.push(l); total += l; }
  const mask = new PixelPainter(p.w, p.h);
  const along = new Float32Array(p.w * p.h).fill(-1);
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const n = Math.max(1, Math.ceil(segs[i] * 3));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const u = (acc + segs[i] * t) / total;
      const r = u < 0.12 ? 0.85 : u < 0.7 ? 1.4 : u < 0.9 ? 1.15 : 0.8;
      const cx = ax + (bx - ax) * t;
      const cy = ay + (by - ay) * t;
      for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        if (!mask.inBounds(x, y) || Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
        mask.px(x, y, '#ffffff');
        const i2 = y * p.w + x;
        along[i2] = along[i2] < 0 ? u : Math.min(along[i2], u);
      }
    }
    acc += segs[i];
  }
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (!mask.isSet(x, y)) continue;
    const u = along[y * p.w + x];
    const ring = Math.floor(u * total / 2.6) % 2 === 1;
    const edgeTop = !mask.isSet(x, y - 1) || !mask.isSet(x - 1, y);
    const edgeBot = !mask.isSet(x, y + 1) && !mask.isSet(x + 1, y);
    let c = ring ? FUR.d : FUR.l;
    if (u > 0.86) c = CREAM;
    else if (edgeTop) c = ring ? FUR.m : FUR.h;
    else if (edgeBot) c = ring ? FUR.k : FUR.m;
    p.px(x, y, c);
  }
}

/** Brass lantern 5x6: hook row ly-3, cap ly-2, glass ly-1..ly+1 ... flame base at (lx, ly + 1). */
function paintLantern(p: PixelPainter, lx: number, top: number): [number, number] {
  p.px(lx, top, BRASS.r);
  p.rect(lx - 1, top + 1, 3, 1, BRASS.b);
  p.px(lx - 1, top + 1, BRASS.B);
  p.rect(lx - 2, top + 2, 5, 3, BRASS.b);
  p.line(lx + 2, top + 2, lx + 2, top + 4, BRASS.r);
  p.px(lx - 2, top + 2, BRASS.B);
  p.rect(lx - 1, top + 2, 3, 3, GLASS);
  p.px(lx - 1, top + 2, GLASS_HI);
  p.rect(lx - 2, top + 5, 5, 1, BRASS.r);
  p.px(lx - 2, top + 5, BRASS.b);
  return [lx, top + 4];
}

/**
 * Head facing right, eye row at hy: dark crown and ear, cream brow, the black bandit mask with a
 * glinting eye, cream muzzle and a dark nose (6 rows: hy-3 .. hy+2).
 */
function paintHead(p: PixelPainter, hx: number, hy: number, eye: 'open' | 'x' | 'squint' = 'open'): void {
  // ear and crown
  p.px(hx - 2, hy - 3, FUR.m);
  p.px(hx - 1, hy - 3, FUR.d);
  p.rect(hx - 2, hy - 2, 4, 1, FUR.m);
  p.px(hx - 1, hy - 2, FUR.h);
  p.px(hx, hy - 2, FUR.l);
  // cream brow over the mask
  p.px(hx - 2, hy - 1, FUR.m);
  p.rect(hx - 1, hy - 1, 4, 1, CREAM);
  // mask band
  p.rect(hx - 2, hy, 6, 1, MASK);
  // muzzle, nose and chin
  p.px(hx - 2, hy + 1, FUR.m);
  p.rect(hx - 1, hy + 1, 5, 1, CREAM);
  p.px(hx + 4, hy + 1, MASK);
  p.rect(hx, hy + 2, 3, 1, CREAM_SH);
  if (eye === 'x') { p.px(hx + 1, hy, '#c8b8a8'); p.px(hx + 1, hy - 1, '#8a7a70'); }
  else if (eye === 'squint') p.px(hx + 1, hy, '#c0802a');
  else { p.px(hx + 1, hy, GLINT); p.px(hx + 2, hy, '#fff6c8'); }
}

interface RunPose {
  /** torso ellipses (cx, cy, rx, ry) unioned into the body mask */
  body: number[][];
  hx: number; hy: number;
  /** legs [x0, y0, x1, y1]: far front, far hind, near front, near hind */
  legs: number[][];
  tail: number[][];
  /** lantern centre column and hook row */
  lx: number; lt: number;
  eye?: 'open' | 'x' | 'squint';
}

function paintRun(p: PixelPainter, s: RunPose): [number, number] {
  const [ff, fh, nf, nh] = s.legs;
  p.line(ff[0], ff[1], ff[2], ff[3], FUR.d);
  p.line(fh[0], fh[1], fh[2], fh[3], FUR.d);
  p.px(ff[2], ff[3], FUR.k);
  p.px(fh[2], fh[3], FUR.k);
  paintTail(p, s.tail);
  const mask = new PixelPainter(p.w, p.h);
  for (const [cx, cy, rx, ry] of s.body) mask.ellipse(cx, cy, rx, ry, '#ffffff');
  // neck joins the head
  mask.ellipse((s.body[s.body.length - 1][0] + s.hx) / 2 + 0.5, s.hy + 0.5, 2, 1.6, '#ffffff');
  const front = s.body[s.body.length - 1][0];
  shadeBody(p, mask, (x) => x >= front - 4, s.body[0][0] - 1);
  for (const l of [nf, nh]) {
    p.line(l[0], l[1], l[2], l[3], FUR.l);
    p.px(l[0], l[1], FUR.m);
    p.px(l[2], l[3], CREAM_SH);
  }
  paintHead(p, s.hx, s.hy, s.eye);
  // tail tip down to the lantern hook
  const tip = s.tail[s.tail.length - 1];
  p.line(Math.round(tip[0]), Math.round(tip[1]) + 1, s.lx, s.lt, BRASS.r);
  return paintLantern(p, s.lx, s.lt);
}

// four bounding-gait frames: gathered, reaching, gathered in the air, landing
const TAIL_UP = [[4.6, 10.2], [3.2, 8.8], [2.5, 6.8], [2.7, 4.6], [3.8, 2.8], [5.6, 1.5], [8, 1], [10.4, 1.1], [12, 1.9]];
const tailAt = (dx: number, dy: number, reach = 0) => TAIL_UP.map(([x, y], i) => [x + dx + (i > 5 ? reach : 0), y + dy]);
const RUN: RunPose[] = [
  { body: [[8, 10.6, 3.6, 1.7], [12, 10.2, 3.8, 1.9]], hx: 17, hy: 9, legs: [[13, 11, 12, 13], [8, 11, 9, 13], [14, 11, 13, 13], [7, 11, 8, 13]], tail: tailAt(0.5, 0), lx: 12, lt: 3 },
  { body: [[8, 10.8, 4, 1.5], [12.5, 10.6, 4, 1.6]], hx: 18, hy: 9, legs: [[15, 11, 17, 13], [6, 11, 4, 13], [16, 11, 18, 13], [7, 11, 5, 12]], tail: tailAt(0, 0.4, -0.5), lx: 11, lt: 3 },
  { body: [[8, 10.2, 3.6, 1.7], [12, 9.8, 3.8, 1.9]], hx: 17, hy: 8, legs: [[13, 11, 11, 12], [8, 11, 10, 12], [14, 11, 12, 12], [7, 11, 9, 12]], tail: tailAt(0.5, -0.6, 0.5), lx: 13, lt: 2 },
  { body: [[8, 10.8, 4, 1.5], [12.5, 10.8, 4, 1.6]], hx: 18, hy: 10, legs: [[15, 11, 16, 13], [6, 11, 5, 13], [16, 11, 17, 13], [7, 11, 6, 13]], tail: tailAt(0, 0.6, 0), lx: 12, lt: 3 },
];
const CROUCH: RunPose = { body: [[8, 11.4, 4, 1.4], [12.5, 11.6, 4, 1.4]], hx: 18, hy: 10, legs: [[14, 12, 16, 13], [8, 12, 7, 13], [15, 12, 17, 13], [7, 12, 6, 13]],
  tail: tailAt(-0.5, 0.6, -1.5), lx: 10, lt: 3, eye: 'squint' };

for (let i = 0; i < 4; i++) {
  const p0 = new PixelPainter(22, 14);
  LANTERN.set(`lantern_weasel_run_${i}`, paintRun(p0, RUN[i]));
}
frames('lantern_weasel', 'run', 4, 22, 14, (p, i) => { paintRun(p, RUN[i]); }, { fps: 12, origin: SIDE_ORIGIN });
LANTERN.set('lantern_weasel_crouch_0', paintRun(new PixelPainter(22, 14), CROUCH));
frames('lantern_weasel', 'crouch', 1, 22, 14, (p) => { paintRun(p, CROUCH); }, { origin: SIDE_ORIGIN });

// knocked over: on its back, belly up, paws in the air, X eyes; the lantern lands upright beside it
function paintDown(p: PixelPainter, i: number): [number, number] {
  paintTail(p, [[9, 12], [6.6, 12.6], [4.4, 12.4], [2.8, 11.6]]);
  const mask = new PixelPainter(22, 14);
  mask.ellipse(12.5, 10.8, 5.2, 2.4, '#ffffff');
  for (let x = 0; x < 22; x++) for (let y = 0; y < 14; y++) {
    if (!mask.isSet(x, y)) continue;
    const k = y - 8;
    p.px(x, y, !mask.isSet(x, y - 1) ? CREAM : k <= 1 ? (x < 9 || x > 16 ? CREAM_SH : CREAM) : !mask.isSet(x, y + 1) ? FUR.d : FUR.m);
  }
  // paws kicking in the air
  for (const [x, y] of [[9, 7 - i], [11, 6 + i], [14, 6 + i], [16, 7 - i]]) {
    p.line(x, 9, x, y, FUR.l);
    p.px(x, y, CREAM_SH);
  }
  paintHead(p, 18, 10, 'x');
  return paintLantern(p, 3, 6);
}
for (let i = 0; i < 2; i++) LANTERN.set(`lantern_weasel_down_${i}`, paintDown(new PixelPainter(22, 14), i));
frames('lantern_weasel', 'down', 2, 22, 14, (p, i) => { paintDown(p, i); }, { fps: 6, origin: SIDE_ORIGIN });

// slip: the gathered pose sinking into the crack (clipped at the floor line, smoke at the rim)
const SLIP_DROP = [3, 6];
for (let i = 0; i < 2; i++) {
  const a = paintRun(new PixelPainter(22, 14), RUN[0]);
  LANTERN.set(`lantern_weasel_slip_${i}`, [a[0], a[1] + SLIP_DROP[i]]);
}
frames('lantern_weasel', 'slip', 2, 22, 14, (p, i) => {
  const src = new PixelPainter(22, 14);
  paintRun(src, RUN[0]);
  const drop = SLIP_DROP[i];
  for (let y = 0; y < 14; y++) for (let x = 0; x < 22; x++) {
    const ty = y + drop;
    if (ty >= 12 || !src.isSet(x, y)) continue;
    p.data[ty * 22 + x] = src.data[y * 22 + x];
  }
  for (let x = 3; x < 20; x++) p.px(x, 12, x % 3 ? '#3a1c58' : '#7a4aa8');
  p.px(5, 11, '#c9a0ff');
  p.px(16, 11, '#c9a0ff');
}, { fps: 5, origin: SIDE_ORIGIN });

// taunt: up on its hind legs, periscoping, the lantern held aloft on the curled tail
function paintStand(p: PixelPainter, i: number): [number, number] {
  const sway = i;
  paintTail(p, [[7, 17.5], [4.5, 17], [2.6, 15], [2, 12], [2.4, 9], [3.4, 6.5 + sway * 0.5], [4.6, 5 + sway]]);
  const mask = new PixelPainter(16, 20);
  mask.ellipse(9, 15.5, 3.4, 3, '#ffffff');
  mask.ellipse(9.4, 11, 2.6, 4, '#ffffff');
  for (let y = 0; y < 20; y++) for (let x = 0; x < 16; x++) {
    if (!mask.isSet(x, y)) continue;
    const left = !mask.isSet(x - 1, y);
    const right = !mask.isSet(x + 1, y);
    const front = x >= 10 && y >= 9;
    p.px(x, y, left ? FUR.h : right ? (front ? CREAM_SH : FUR.d) : front ? CREAM : x < 8 ? FUR.l : FUR.m);
  }
  // feet and the paws held at the chest
  p.rect(6, 18, 3, 1, FUR.d);
  p.rect(10, 18, 3, 1, FUR.d);
  p.px(12, 18, FUR.k);
  p.rect(11, 9, 2, 1, FUR.d);
  p.px(12, 10, FUR.k);
  // head (looking right, then up and back)
  if (i === 0) paintHead(p, 9, 5);
  else {
    p.ellipse(9, 4.6, 2.6, 2.3, FUR.m);
    p.rect(10, 3, 2, 2, CREAM);
    p.px(12, 3, MASK);
    p.px(7, 2, FUR.h);
    p.rect(8, 2, 3, 1, FUR.h);
    p.px(6, 1, FUR.l);
    p.rect(7, 4, 5, 1, MASK);
    p.px(10, 4, GLINT);
    p.rect(8, 5, 3, 2, CREAM);
  }
  p.line(5, 6 + sway, 4, 7 + sway, BRASS.r);
  return paintLantern(p, 3, 7 + sway);
}
for (let i = 0; i < 2; i++) LANTERN.set(`lantern_weasel_taunt_${i}`, paintStand(new PixelPainter(16, 20), i));
frames('lantern_weasel', 'taunt', 2, 16, 20, (p, i) => { paintStand(p, i); }, { fps: 2.5, origin: STAND_ORIGIN });

/** Current frame name for the weasel's state. */
function weaselFrame(e: Enemy, w: World): string {
  const m = e.mem;
  switch (m.state) {
    case ST.down:
    case ST.yank:
      return `lantern_weasel_down_${Math.floor(w.time * 6) % 2}`;
    case ST.channel:
      return `lantern_weasel_slip_${Math.floor(w.time * 5) % 2}`;
    case ST.flare:
      return 'lantern_weasel_crouch_0';
    case ST.hop:
      return m.t > 0 ? 'lantern_weasel_crouch_0' : 'lantern_weasel_run_2';
    case ST.leap:
      return 'lantern_weasel_run_2';
    default: {
      if (m.taunt) return `lantern_weasel_taunt_${Math.floor(e.age * 2.5) % 2}`;
      const v = Math.hypot(e.vx, e.vy);
      if (v < 6) return 'lantern_weasel_run_0';
      return `lantern_weasel_run_${Math.floor(e.animT * (6 + v * 0.12)) % 4}`;
    }
  }
}

/** Where the flame stands in world px (unflipped sprite px relative to the origin, mirrored with facing). */
function lanternAt(e: Enemy, frame: string): { x: number; y: number } {
  const a = LANTERN.get(frame) ?? [7, 5];
  const o = frame.startsWith('lantern_weasel_taunt') ? STAND_ORIGIN : SIDE_ORIGIN;
  const dx = a[0] - o[0];
  return { x: e.x + (e.facing < 0 ? -dx : dx), y: e.y - e.z + (a[1] - o[1]) };
}

/** Body (y-sorted, before the lighting): the sprite and the stars of a tumble. */
function draw(e: Enemy, r: Renderer, w: World): void {
  const m = e.mem;
  e.drawDefault(r, weaselFrame(e, w));
  if (m.state === ST.down) {
    for (let i = 0; i < 3; i++) {
      const a = w.time * 7 + (i * TAU) / 3;
      const sx = e.x + (e.facing < 0 ? -7 : 7) + Math.cos(a) * 5;
      const sy = e.y - 9 + Math.sin(a) * 2;
      r.rect(sx, sy, 1, 1, '#fff2a0');
      if (Math.sin(a) < 0) r.rect(sx + 1, sy, 1, 1, '#ffd36a', 0.6);
    }
  }
}

/**
 * Readouts drawn after the lighting (EnemyOverlay, layer 3) so they stay legible on dark
 * floors: the lantern flame (as tall as the embers it still holds), the hop landing ring,
 * the flare swell, the race line, the channel ring, three ember pips and the bar.
 */
function overlay(e: Enemy, r: Renderer, w: World): void {
  const m = e.mem;
  const link = huntOf(w, e);
  const held = heldOf(e, link);
  const frame = weaselFrame(e, w);
  const lan = lanternAt(e, frame);
  // landing marker of a hop (harmless: lime, not a red warning)
  if (m.state === ST.hop && m.t > 0) {
    const k = 1 - m.t / 0.35;
    r.pixelRing(m.hx, m.hy, 9 - k * 3, HUNT_COLOR, 1, 0.5 + 0.4 * k);
    r.pixelDisc(m.hx, m.hy, 1, HUNT_COLOR, 0.8);
  }
  if (held > 0 && m.state !== ST.channel) {
    const fl = Math.sin(w.time * 17 + e.id) > 0.3 ? 1 : 0;
    r.pixelDisc(lan.x, lan.y - 1, 2 + held, '#ffd36a', 0.12 + 0.04 * held);
    r.rect(lan.x, lan.y, 1, 1, '#ffb347');
    if (held >= 2) r.rect(lan.x, lan.y - 1, 1, 1, '#ffd36a');
    if (held >= 3) r.rect(lan.x, lan.y - 2 + fl, 1, 1, '#fff4c0');
    if (held >= 2) r.rect(lan.x + (fl ? -1 : 1), lan.y, 1, 1, '#ff9a3a', 0.8);
  }
  if (m.state === ST.flare) {
    const k = 1 - Math.max(0, m.t) / FLARE_WIND;
    r.pixelDisc(lan.x, lan.y - 1, 1 + k * 3, '#ffffff', 0.35 + 0.5 * k);
    r.pixelDisc(lan.x, lan.y - 1, 1 + k * 1.5, '#fff4c0', 0.9);
  }
  const top = e.y - e.z - (frame.includes('taunt') ? 22 : 17);
  // racing back for a dropped ember: '!' and a dotted line to it
  if (m.state === ST.race && m.rx !== undefined) {
    const n = Math.max(1, Math.floor(Math.hypot(m.rx - e.x, m.ry - e.y) / 5));
    for (let i = 1; i < n; i++) if ((i + Math.floor(w.time * 10)) % 2) r.rect(e.x + ((m.rx - e.x) * i) / n, e.y - 3 + ((m.ry - e.y + 3) * i) / n, 1, 1, '#ffb080', 0.9);
    r.pixelText('!', e.x, top - 13, '#ffb080', { align: 'center', outline: '#120a12' });
  }
  if (!link) return;
  // channel: a violet ring fills while it sinks
  if (m.state === ST.channel) {
    const k = Math.min(1, link.mem.chanT / Math.max(0.01, link.channelTime()));
    const n = 32;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * TAU;
      const on = i / n < k;
      r.rect(e.x + Math.cos(a) * 13, e.y - 3 + Math.sin(a) * 10, 1, 1, on ? '#c9a0ff' : '#3a1c58', on ? 1 : 0.7);
    }
  }
  // embers carried (3 pips) and the bar
  for (let i = 0; i < 3; i++) {
    const x = e.x - 5 + i * 4;
    r.rect(x - 1, top - 6, 3, 3, '#120a12');
    r.rect(x, top - 5, 1, 1, i < held ? '#ffd36a' : '#4a3438');
  }
  const k = m.state === ST.down ? 1 - Math.max(0, m.t) / DOWN_TIME : Math.max(0, Math.min(1, e.hp / Math.max(1, e.maxHp)));
  r.rect(e.x - 9, top - 1, 18, 4, '#120a12');
  r.rect(e.x - 8, top, 16, 2, '#2a2420');
  r.rect(e.x - 8, top, Math.round(16 * k), 2, m.state === ST.down ? '#6a7a50' : HUNT_COLOR);
}

/** A short Korean callout over the room (the 3x5 world font has no Hangul): purely visual. */
export class HuntCallout extends Entity {
  static override readonly cosmetic = true;
  constructor(x: number, y: number, readonly text: string, readonly color: string, readonly life = 1.1) {
    super();
    this.x = x;
    this.y = y;
    this.layer = 3;
    this.tileCollide = false;
  }
  override update(_w: World, dt: number): void {
    this.age += dt;
    this.y -= dt * (this.age < 0.25 ? 40 : 8);
    if (this.age >= this.life) this.dead = true;
  }
  override draw(r: Renderer): void {
    const t = this.age / this.life;
    const c = r.ctx;
    const prev = c.globalAlpha;
    c.globalAlpha = t > 0.75 ? Math.max(0, 1 - (t - 0.75) / 0.25) : 1;
    roomLabel(r, this.text, this.x, this.y, this.color);
    c.globalAlpha = prev;
  }
}

export function callout(w: World, x: number, y: number, text: string, color: string): void {
  w.spawn(new HuntCallout(x, y, text, color));
}

defineEnemy({
  id: WEASEL_ID,
  name: '등불 족제비',
  hp: 45,
  radius: 6,
  mass: 1.4,
  speed: 66,
  contactDamage: 0,
  champion: false,
  controlResist: true,
  sprite: 'lantern_weasel_run',
  shadow: 14,
  deathFx: 'blood',
  bloodColor: '#5e3a44',
  light: { radius: 26, color: '#ffd36a' },
  init(e, w) {
    w.spawn(new EnemyOverlay(e, 3, overlay));
    Object.assign(e.mem, { state: ST.flee, t: 0, cd: 0, press: 0, stuck: 0, drop: 0, wpx: e.x, wpy: e.y, repick: 0, root: e.mem.root ?? 0, hopCd: 0, held: 3, jump: 0 });
  },
  update,
  onHurt,
  draw,
});
