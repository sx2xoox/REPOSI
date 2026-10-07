// Floor 4 — 얼어붙은 성소 (frozen sanctum), winter rites:
//  - 고드름 사제 (icicle priest): chants, then calls a chain of icicles down from the
//    vaulted ceiling onto the keeper's path — every drop lands where you are (a little
//    ahead), so you must keep moving; the last one leaves a sheet of black ice.
//  - 눈보라 정령 (blizzard spirit): conjures a whirlwind between itself and you that
//    drifts after you and throws you out of it; while it spins the spirit flicks
//    snowflakes in a narrow fan.

import { defineEnemy } from '../../game/defs';
import { Entity } from '../../game/entity';
import { PixelPainter } from '../../engine/painter';
import { defineDrawnSprite, hasSprite } from '../../engine/sprites';
import { GroundWarning, RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { clamp, rotateToward } from '../../engine/math';
import type { Enemy, ShootOpts } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { BUL, frames, gather, hurtFrame, sphere, spinDraw, WARN_RED } from './shared';
import { FrostPatch, ICE, SNOWDUST } from './sanctum';

const OUT = '#0a1030';
/** Gold trim and a gaunt pale face. */
const GOLD = ['#6a4410', '#b07a20', '#e8b848', '#fff0a8'];
const FACE = ['#5a6a8a', '#9aaac4', '#ccd8ea'];
/** Packed snow, darkest first. */
const SNOW = ['#4a7ac0', '#94c4ec', '#d8f2ff', '#ffffff'];

/** Where whatever `e` is after will be in `k` s at its current velocity (lead capped to `cap` px). */
function targetLead(e: Enemy, w: World, k: number, cap: number): { x: number; y: number } {
  const t = e.target(w) as { x: number; y: number; vx?: number; vy?: number };
  let lx = (t.vx ?? 0) * k;
  let ly = (t.vy ?? 0) * k;
  const l = Math.hypot(lx, ly);
  if (l > cap) {
    lx *= cap / l;
    ly *= cap / l;
  }
  return { x: t.x + lx, y: t.y + ly };
}

/** Clamp a point into the room interior with a margin. */
function inside(w: World, x: number, y: number, m: number): { x: number; y: number } {
  const r = w.room;
  return { x: clamp(x, r.interiorX + m, r.interiorX + r.interiorW - m), y: clamp(y, r.interiorY + m, r.interiorY + r.interiorH - m) };
}

// ================================================================== 고드름 사제 (icicle priest)
const PRIEST_NAME = '고드름 사제';
/** icicle impact radius, warning time, chain spacing */
export const ICICLE_R = 12;
export const ICICLE_WARN = 0.7;
export const ICICLE_GAP = 0.32;

type PriestMode = 'walk' | 'chant' | 'call' | 'hurt';

/** White vestments lit from the top-left: highlight, light, mid, shade, deep. */
const VEST = ['#ffffff', '#e2eaf8', '#b8c6e2', '#8898c4', '#5a6694'];

function paintPriest(p: PixelPainter, k: number, mode: PriestMode): void {
  const walk = mode === 'walk';
  const bob = walk ? [0, 0, 1, 1][k] : 0;
  const sway = walk ? [0, 1, 0, -1][k] : 0;
  const glow = mode === 'chant' || mode === 'call';
  const hurt = mode === 'hurt';
  // crozier in the back hand: gold shaft, ice crystal head (raised while chanting)
  const sy = mode === 'chant' ? -2 : hurt ? 1 : 0;
  p.rect(3, 5 + sy, 1, 23 - sy, GOLD[1]);
  p.rect(3, 6 + sy, 1, 6, GOLD[2]);
  p.px(3, 27, GOLD[0]);
  p.px(3, 0 + sy, glow ? '#ffffff' : ICE[4]);
  p.px(2, 1 + sy, ICE[3]);
  p.px(3, 1 + sy, glow ? '#ffffff' : ICE[3]);
  p.px(4, 1 + sy, ICE[2]);
  p.px(2, 2 + sy, ICE[2]);
  p.px(3, 2 + sy, ICE[3]);
  p.px(4, 2 + sy, ICE[1]);
  p.px(3, 3 + sy, ICE[1]);
  p.px(3, 4 + sy, GOLD[2]);
  // robe: a narrow column flaring to a wide hem
  const top = 13 + bob;
  for (let y = top; y <= 27; y++) {
    const t = (y - top) / (27 - top);
    const s = y >= 23 ? sway : 0;
    const x0 = Math.round(6 - t * 4.6) + s;
    const x1 = Math.round(11 + t * 4) + s;
    for (let x = x0; x <= x1; x++) {
      const u = (x - x0) / Math.max(1, x1 - x0);
      p.px(x, y, x === x0 ? VEST[1] : u < 0.38 ? VEST[1] : u < 0.72 ? VEST[2] : x === x1 ? VEST[4] : VEST[3]);
    }
    // a fold catching the light
    if (y > top + 3 && y < 25) p.px(x0 + 1, y, VEST[0]);
    // gold orphrey down the front
    if (y > top && y < 26) {
      p.px(9 + s, y, GOLD[2]);
      p.px(10 + s, y, GOLD[1]);
    }
    // gold hem
    if (y === 26) for (let x = x0; x <= x1; x++) p.px(x, y, x < x0 + 4 ? GOLD[2] : GOLD[1]);
    if (y === 27) for (let x = x0; x <= x1; x++) p.px(x, y, GOLD[0]);
  }
  // short shoulder cape with a gold edge
  const cy = 12 + bob;
  for (let y = cy; y <= cy + 3; y++) {
    const x0 = 6 - (y - cy > 1 ? 1 : 0);
    const x1 = 12 + (y - cy > 1 ? 1 : 0);
    for (let x = x0; x <= x1; x++) p.px(x, y, y === cy + 3 ? (x < 9 ? GOLD[2] : GOLD[1]) : x < 8 ? VEST[1] : x < 11 ? VEST[2] : VEST[3]);
  }
  p.px(9, cy + 3, GOLD[3]);
  // hood framing a gaunt face
  const hx = hurt ? -1 : 0;
  const hy = 7 + bob + (hurt ? 1 : 0);
  p.rect(6 + hx, hy - 1, 7, 6, VEST[3]);
  p.rect(6 + hx, hy - 1, 1, 6, VEST[2]);
  p.rect(7 + hx, hy, 5, 5, FACE[2]);
  p.rect(7 + hx, hy, 1, 4, '#eef4fc');
  p.rect(8 + hx, hy + 4, 3, 1, FACE[1]);
  p.px(7 + hx, hy + 4, VEST[3]);
  p.px(11 + hx, hy + 4, VEST[3]);
  p.px(11 + hx, hy + 3, FACE[1]);
  // hollow cheeks, glowing eyes, thin mouth
  p.px(8 + hx, hy + 3, FACE[0]);
  p.px(10 + hx, hy + 3, FACE[0]);
  const eye = hurt ? FACE[0] : glow ? '#ffffff' : '#5ad8ff';
  p.px(8 + hx, hy + 1, eye);
  p.px(10 + hx, hy + 1, eye);
  if (glow) {
    p.px(8 + hx, hy + 2, '#8cf2ff');
    p.px(10 + hx, hy + 2, '#8cf2ff');
  }
  p.px(9 + hx, hy + 2, '#ffffff');
  p.px(9 + hx, hy + 4, mode === 'chant' ? '#1a2040' : FACE[0]);
  // icicle crown on a gold circlet
  const by = hy - 1;
  p.rect(6 + hx, by, 7, 1, GOLD[2]);
  p.px(6 + hx, by, GOLD[3]);
  p.px(9 + hx, by, GOLD[3]);
  p.px(12 + hx, by, GOLD[1]);
  const tip = glow ? '#ffffff' : '#e8faff';
  for (const [dx, h] of [[6, 2], [7, 4], [9, glow ? 7 : 6], [11, 4], [12, 2]] as const) {
    for (let i = 1; i <= h; i++) p.px(dx + hx, by - i, i === h ? tip : i === 1 ? ICE[1] : i < h / 2 + 1 ? ICE[2] : ICE[3]);
  }
  p.px(10 + hx, by - 1, ICE[1]);
  p.px(10 + hx, by - 2, ICE[2]);
  p.px(8 + hx, by - 1, ICE[2]);
  // arms in wide sleeves, pale hands
  const S = VEST;
  if (mode === 'chant') {
    p.line(12, cy + 1, 15, cy - 3, S[2]);
    p.line(13, cy + 1, 16, cy - 2, S[3]);
    p.px(16, cy - 4, FACE[2]);
    p.px(15, cy - 4, FACE[2]);
    p.px(4, cy + 1, FACE[2]);
  } else if (mode === 'call') {
    p.line(12, cy, 13, cy - 5, S[2]);
    p.line(13, cy + 1, 14, cy - 4, S[3]);
    p.px(13, cy - 6, FACE[2]);
    p.px(13, cy - 7, k ? '#ffffff' : '#bff6ff');
    if (k) {
      p.px(12, cy - 8, '#bff6ff');
      p.px(14, cy - 8, '#bff6ff');
      p.px(13, cy - 9, '#ffffff');
    }
    p.px(4, cy + 4, FACE[1]);
  } else if (hurt) {
    p.line(12, cy + 1, 15, cy + 2, S[2]);
    p.px(16, cy + 2, FACE[2]);
    p.px(4, cy + 3, FACE[1]);
  } else {
    p.line(12, cy + 1, 13, cy + 6, S[2]);
    p.line(13, cy + 1, 14, cy + 6, S[3]);
    p.px(14, cy + 7, FACE[2]);
    p.px(4, cy + 4, FACE[1]);
  }
}
frames('icepriest', 'walk', 4, 17, 28, (p, i) => paintPriest(p, i, 'walk'), { anchor: 'bottom', fps: 5, outline: OUT });
frames('icepriest', 'chant', 2, 17, 28, (p, i) => paintPriest(p, i, 'chant'), { anchor: 'bottom', fps: 8, outline: OUT });
frames('icepriest', 'call', 2, 17, 28, (p, i) => paintPriest(p, i, 'call'), { anchor: 'bottom', fps: 10, outline: OUT });
frames('icepriest', 'hurt', 1, 17, 28, (p) => paintPriest(p, 0, 'hurt'), { anchor: 'bottom', outline: OUT });

defineDrawnSprite('icepriest_icicle', 7, 15, (p) => {
  p.poly([0, 0, 7, 0, 3.5, 15], ICE[2]);
  p.poly([1, 0, 3.5, 0, 3.5, 13], ICE[3]);
  p.poly([3.5, 0, 6, 0, 3.5, 13], ICE[1]);
  p.line(2, 1, 3, 9, '#ffffff');
  p.rect(0, 0, 7, 2, '#e8faff');
  p.px(6, 1, ICE[2]);
}, { outline: '#06102a', anchor: 'bottom' });

/**
 * One icicle called down by the priest: a floor warning for `ICICLE_WARN` s while the
 * icicle drops out of the dark, then it shatters (half-heart within `ICICLE_R`).
 * `last` leaves a sheet of black ice (FrostPatch).
 */
export class IcicleDrop extends Entity {
  last: boolean;
  source: string;
  warning: GroundWarning | null = null;
  static readonly HEIGHT = 150;

  constructor(x: number, y: number, last: boolean, source: string) {
    super();
    this.x = x;
    this.y = y;
    this.last = last;
    this.source = source;
    this.layer = 1;
    this.team = 'enemy';
    this.tileCollide = false;
    this.enemyHazard = true;
  }

  /** Warn at (x, y) and drop an icicle there. */
  static drop(w: World, x: number, y: number, last: boolean, source: string): IcicleDrop {
    const d = w.spawn(new IcicleDrop(x, y, last, source));
    d.warning = w.spawn(new GroundWarning(x, y, ICICLE_R, ICICLE_WARN, undefined, WARN_RED));
    return d;
  }

  override get sortY(): number {
    return this.y + 2;
  }

  override onCleared(): void {
    this.dead = true;
    if (this.warning) this.warning.dead = true;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const t = clamp(this.age / ICICLE_WARN, 0, 1);
    this.z = IcicleDrop.HEIGHT * (1 - t * t);
    if (t >= 1 && !this.dead) this.shatter(w);
  }

  private shatter(w: World): void {
    this.dead = true;
    const { x, y } = this;
    for (const p of w.targets()) {
      if (!p.alive || p.z > 8) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > ICICLE_R + p.r * 0.5) continue;
      if (p.hurt(w, 1, this.source)) p.knock((p.x - x) / (d || 1), (p.y - y) / (d || 1), 120);
    }
    w.particles.burst(x, y - 3, { count: 12, speed: [30, 110], life: [0.25, 0.55], colors: ['#ffffff', ICE[3], ICE[2]], size: [1, 2], gravity: 320, vz: [40, 120], shape: 'square', vrot: 10 });
    w.particles.burst(x, y - 2, { count: 6, speed: [10, 40], life: [0.4, 0.8], colors: SNOWDUST, size: [1, 1], drag: 2 });
    w.spawn(new RingFx(x, y, ICICLE_R + 3, 0.25, '#d8f6ff', 2));
    w.decal(x, y, '#cfe8ff', 2.5, 0.25);
    w.shake(0.08);
    w.sfx('spike', { vol: 0.35, pitch: fx.range(1.35, 1.6), x });
    w.sfx('rock_break', { vol: 0.2, pitch: fx.range(1.7, 2.0), x });
    if (this.last) w.spawn(new FrostPatch(x, y, 14, 3.2));
  }

  override draw(r: Renderer): void {
    const t = clamp(this.age / ICICLE_WARN, 0, 1);
    r.shadow(this.x, this.y + 1, 4 + t * 10, 2 + t * 3.5, 0.15 + t * 0.3);
    r.sprite('icepriest_icicle', this.x, this.y - this.z + 1);
  }

  override light(w: World): void {
    const t = clamp(this.age / ICICLE_WARN, 0, 1);
    w.lights.add(this.x, this.y - this.z * 0.5, 14, '#bfe8ff', { intensity: 0.25 + t * 0.35 });
  }
}

/** Crown position (world) of the priest. */
function crown(e: Enemy): { x: number; y: number } {
  return { x: e.x + e.facing * 0.5, y: e.y - 24 - e.z };
}

defineEnemy({
  id: 'icicle_priest',
  name: PRIEST_NAME,
  hp: 36,
  radius: 6,
  speed: 26,
  mass: 1.2,
  sprite: 'icepriest_walk',
  spriteYOffset: 6,
  shadow: 13,
  cost: 2,
  floors: [4],
  weight: 0.8,
  champion: true,
  deathFx: 'ice',
  bloodColor: '#cfefff',
  dieSfx: 'freeze',
  light: { radius: 22, color: '#bfe8ff' },
  *script(e, w) {
    yield w.rng.range(0.4, 1.0);
    let side = w.rng.sign();
    while (true) {
      e.setAnim('icepriest_walk');
      // keep a reverent distance
      const t = w.rng.range(1.8, 2.6);
      for (let el = 0; el < t; el += w.dt) {
        const d = e.distToTarget(w);
        const a = e.angleToTarget(w);
        if (d < 90) e.moveAngle(a + Math.PI + side * 0.5, e.speed);
        else if (d > 150) e.chase(w, e.speed);
        else e.moveAngle(a + (side * Math.PI) / 2, e.speed * 0.55);
        if (e.mem.__bumped || w.rng.chance(0.006)) side = -side;
        yield;
      }
      if (e.distToTarget(w) > 230) continue;
      // chant: the crown blazes (telegraph)
      e.halt();
      e.facing = e.target(w).x >= e.x ? 1 : -1;
      e.setAnim('icepriest_chant');
      e.telegraph(0.6);
      const c = crown(e);
      gather(w, c.x, c.y, ['#ffffff', ICE[3], GOLD[2]], 10, 16);
      w.sfx('freeze', { vol: 0.35, pitch: 1.6 });
      yield 0.6;
      // call the chain: each icicle lands where the keeper is heading
      e.setAnim('icepriest_call');
      const n = e.champion ? 7 : 5;
      for (let i = 0; i < n; i++) {
        const lead = targetLead(e, w, 0.3, 26);
        const s = inside(w, lead.x, lead.y, 8);
        IcicleDrop.drop(w, s.x, s.y, i === n - 1, PRIEST_NAME);
        w.sfx('freeze', { vol: 0.18, pitch: 2.0 + i * 0.08 });
        yield ICICLE_GAP;
      }
      yield 0.55;
    }
  },
  update(e, w) {
    if ((e.anim === 'icepriest_chant' || e.anim === 'icepriest_call') && fx.chance(0.5)) {
      const c = crown(e);
      w.particles.spawn({ x: c.x + fx.range(-4, 4), y: c.y + fx.range(-3, 2), vy: -fx.range(6, 16), life: fx.range(0.3, 0.6), colors: ['#ffffff', '#bfefff', GOLD[2]], size: 1, additive: true, light: 3 });
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'icepriest_hurt_0'));
  },
});

// ================================================================== 눈보라 정령 (blizzard spirit)
const SPIRIT_NAME = '눈보라 정령';
/** whirlwind radius, formation time, drift time, fade, speed, push and per-keeper hit cooldown */
export const GUST_R = 14;
export const GUST_FORM = 0.6;
export const GUST_LIFE = 3.2;
export const GUST_FADE = 0.45;
export const GUST_SPEED = 34;
export const GUST_PUSH = 200;
export const GUST_COOLDOWN = 0.8;
/** how long the wind slows down after throwing a keeper (breathing room) */
export const GUST_SPENT = 0.7;

type SpiritMode = 'drift' | 'summon' | 'cock' | 'flick' | 'hurt';

function paintSpirit(p: PixelPainter, k: number, mode: SpiritMode): void {
  const sway = mode === 'drift' ? [0, 1, 0, -1][k] : mode === 'summon' ? (k ? 1 : -1) : 0;
  // curling tail of packed snow, thinning out
  const tail: [number, number, number][] = [[8.5, 10.5, 3.4], [6.5, 13, 2.6], [4.6, 14.8, 1.9], [3, 15.9, 1.3], [1.7, 16.4, 0.8]];
  tail.forEach(([x, y, r], i) => {
    const sx = x + sway * (i * 0.45);
    p.circle(sx, y, r, SNOW[2]);
    sphere(p, sx, y, r, r, SNOW);
  });
  // gust arms
  if (mode === 'summon') {
    p.line(7, 8, 3, 4, SNOW[2]);
    p.line(3, 4, 2, 1, SNOW[3]);
    p.line(13, 8, 15, 4, SNOW[2]);
    p.line(15, 4, 16, 1, SNOW[3]);
    p.px(1, 2, '#ffffff');
    p.px(16, 0, '#ffffff');
  } else if (mode === 'cock') {
    // arm drawn back over the head, a flake glinting in the gust
    p.line(7, 8, 4, 9, SNOW[1]);
    p.line(12, 7, 13, 2, SNOW[3]);
    p.px(13, 1, '#ffffff');
    p.px(12, 0, '#8cf2ff');
    p.px(14, 0, '#8cf2ff');
  } else if (mode === 'flick') {
    p.line(7, 8, 4, 9, SNOW[1]);
    p.line(13, 7, 16, 5, SNOW[3]);
    p.px(16, 4, '#ffffff');
  } else if (mode === 'hurt') {
    p.line(7, 8, 4, 6, SNOW[1]);
    p.line(13, 8, 15, 10, SNOW[1]);
  } else {
    p.line(7, 8, 4, 9 + sway, SNOW[1]);
    p.px(3, 10 + sway, SNOW[2]);
    p.line(13, 8, 15, 9 - sway, SNOW[2]);
    p.px(16, 10 - sway, SNOW[3]);
  }
  // round snow head
  const hy = mode === 'hurt' ? 6.5 : 6;
  p.circle(10, hy, 4.6, SNOW[2]);
  sphere(p, 10, hy, 4.6, 4.6, SNOW);
  // frosty crest
  p.px(8, Math.floor(hy) - 4, '#ffffff');
  p.px(10, Math.floor(hy) - 5, '#ffffff');
  p.px(12, Math.floor(hy) - 4, SNOW[2]);
  // face
  const ey = Math.floor(hy) - 1;
  if (mode === 'hurt') {
    p.line(8, ey - 1, 9, ey, '#0a1840');
    p.line(12, ey - 1, 11, ey, '#0a1840');
  } else {
    const eye = mode === 'summon' ? '#3ab0ff' : '#0a1840';
    p.rect(8, ey, 1, 2, eye);
    p.rect(11, ey, 1, 2, eye);
    p.px(7, ey - 1, SNOW[1]);
    p.px(12, ey - 1, SNOW[1]);
    if (mode === 'summon') {
      p.px(8, ey, '#ffffff');
      p.px(11, ey, '#ffffff');
    }
  }
  if (mode === 'summon') p.rect(9.5, ey + 3, 2, 1, '#0a1840');
  else if (mode === 'flick' || mode === 'cock') p.px(10, ey + 3, '#0a1840');
  // loose flakes
  p.px(14, 12 + (k % 2), '#ffffff');
  p.px(1, 11 - (k % 2), SNOW[2]);
}
frames('blizwisp', 'drift', 4, 17, 18, (p, i) => paintSpirit(p, i, 'drift'), { fps: 7, outline: OUT });
frames('blizwisp', 'summon', 2, 17, 18, (p, i) => paintSpirit(p, i, 'summon'), { fps: 10, outline: OUT });
frames('blizwisp', 'flick', 2, 17, 18, (p, i) => paintSpirit(p, i, i ? 'flick' : 'cock'), { fps: 2.5, outline: OUT, loop: false });
frames('blizwisp', 'hurt', 1, 17, 18, (p) => paintSpirit(p, 0, 'hurt'), { outline: OUT });

/** Six-armed snowflake bullet (frost palette: white core, cyan arms, deep-blue outline). */
export function snowflakeSprite(): string {
  const name = '__esnowflake_9';
  if (hasSprite(name)) return name;
  const pal = BUL.frost;
  defineDrawnSprite(name, 9, 9, (p) => {
    const c = 4;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const ex = c + 0.5 + Math.cos(a) * 4;
      const ey = c + 0.5 + Math.sin(a) * 4;
      p.line(c, c, ex, ey, pal.color);
      p.px(ex, ey, '#ffffff');
    }
    p.rect(c - 1, c - 1, 3, 3, pal.rim);
    p.px(c, c - 1, pal.core);
    p.px(c - 1, c, pal.core);
    p.px(c, c, '#ffffff');
    p.px(c + 1, c, pal.core);
    p.px(c, c + 1, pal.core);
  }, { outline: pal.outline });
  return name;
}

const SNOWFLAKE = snowflakeSprite();

/** Shoot options for the spirit's spinning snowflakes. */
function snowShot<T extends ShootOpts>(extra: T): ShootOpts & T {
  return { color: BUL.frost.color, radius: 3, light: 18, ...extra, style: 'none', behaviors: [spinDraw(SNOWFLAKE, 6)] };
}

/**
 * A whirlwind: forms for `GUST_FORM` s over a floor warning, then drifts after the
 * keeper (limited turning) for `GUST_LIFE` s. Touching it costs a half-heart and
 * throws the keeper out of it (at most once per `GUST_COOLDOWN` s per keeper; a dash
 * goes through); the spent gust then slows for `GUST_SPENT` s so it can't juggle.
 * It dies down early if its spirit is destroyed.
 */
export class Whirlwind extends Entity {
  owner: Enemy;
  heading: number;
  speed: number;
  /** age at which it started to die down (-1 = not yet) */
  endAt = -1;
  /** per-keeper (entity id) time before which it can't hit them again */
  hitCd = new Map<number, number>();
  /** after throwing someone the gust is spent for a moment: it slows down (s left) */
  spent = 0;
  warning: GroundWarning | null = null;

  constructor(owner: Enemy, x: number, y: number, heading: number, speed = GUST_SPEED) {
    super();
    this.owner = owner;
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.speed = speed;
    this.r = GUST_R;
    this.layer = 1;
    this.team = 'enemy';
    this.tileCollide = false;
    this.enemyHazard = true;
  }

  static conjure(w: World, owner: Enemy, x: number, y: number, heading: number): Whirlwind {
    const g = w.spawn(new Whirlwind(owner, x, y, heading));
    g.warning = w.spawn(new GroundWarning(x, y, GUST_R, GUST_FORM, undefined, WARN_RED));
    return g;
  }

  get phase(): 'form' | 'live' | 'fade' {
    if (this.endAt >= 0) return 'fade';
    if (this.age < GUST_FORM) return 'form';
    return 'live';
  }

  /** 0..1 visual strength. */
  get strength(): number {
    if (this.endAt >= 0) return clamp(1 - (this.age - this.endAt) / GUST_FADE, 0, 1);
    if (this.age < GUST_FORM) return 0.25 + 0.75 * (this.age / GUST_FORM);
    return 1;
  }

  private dieDown(): void {
    if (this.endAt >= 0) return;
    this.endAt = this.age;
    this.enemyHazard = false;
    if (this.warning) this.warning.dead = true;
  }

  override onCleared(): void {
    this.dieDown();
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (!this.owner.alive) this.dieDown();
    if (this.endAt < 0 && this.age >= GUST_FORM + GUST_LIFE) this.dieDown();
    if (this.endAt >= 0 && this.age - this.endAt >= GUST_FADE) {
      this.dead = true;
      return;
    }
    if (this.phase === 'live') {
      const t = this.owner.target(w);
      this.heading = rotateToward(this.heading, Math.atan2(t.y - this.y, t.x - this.x), 1.6 * dt);
      if (this.spent > 0) this.spent -= dt;
      const v = this.speed * (this.spent > 0 ? 0.3 : 1);
      const c = inside(w, this.x + Math.cos(this.heading) * v * dt, this.y + Math.sin(this.heading) * v * dt, GUST_R * 0.6);
      this.x = c.x;
      this.y = c.y;
      for (const p of w.targets()) {
        if (!p.alive || p.z > 10 || p.dashing) continue;
        const dx = p.x - this.x;
        const dy = p.y - this.y;
        const d = Math.hypot(dx, dy);
        if (d > GUST_R + p.r * 0.5 || w.time < (this.hitCd.get(p.id) ?? -1)) continue;
        this.hitCd.set(p.id, w.time + GUST_COOLDOWN);
        this.spent = GUST_SPENT;
        p.hurt(w, 1, SPIRIT_NAME);
        // thrown out of the wind
        const nx = d > 0.5 ? dx / d : Math.cos(this.heading);
        const ny = d > 0.5 ? dy / d : Math.sin(this.heading);
        p.kbx = nx * GUST_PUSH;
        p.kby = ny * GUST_PUSH;
        w.particles.burst(p.x, p.y - 4, { count: 10, speed: [40, 110], life: [0.2, 0.45], colors: SNOWDUST, size: [1, 2], angle: Math.atan2(ny, nx), spread: 1.2 });
        w.sfx('whoosh', { vol: 0.45, pitch: 0.8, x: this.x });
      }
    }
    const k = this.strength;
    if (fx.chance(0.7 * k)) {
      const a = fx.angle();
      const d = fx.range(4, GUST_R + 2);
      w.particles.spawn({
        x: this.x + Math.cos(a) * d, y: this.y + Math.sin(a) * d * 0.4 - fx.range(0, 18), vx: -Math.sin(a) * 60, vy: Math.cos(a) * 18 - fx.range(4, 14),
        life: fx.range(0.25, 0.5), colors: ['#ffffff', '#d4f4ff'], size: 1, alpha: 0.9,
      });
    }
  }

  override draw(r: Renderer): void {
    const k = this.strength;
    if (k <= 0) return;
    const x = this.x;
    const y = this.y;
    const live = this.phase === 'live';
    const R = GUST_R * (0.45 + 0.55 * k);
    // the wind's reach on the floor: a darker churned disc with a bright, dark-backed rim
    r.shadow(x, y + 1, R * 2.2, R * 0.8, 0.35 * k);
    r.pixelDisc(x, y, R, '#0a1840', (live ? 0.26 : 0.14) * k);
    r.pixelRing(x, y, R, '#0a1840', 2, 0.55 * k);
    r.pixelRing(x, y, R - 1, live ? '#ffffff' : '#bfe8ff', 1, (live ? 0.8 : 0.5) * k);
    // gusts sweeping around the floor
    for (let g = 0; g < 3; g++) {
      const a0 = this.age * 9 + (g * Math.PI * 2) / 3;
      for (let j = 0; j < 7; j++) {
        const a = a0 + j * 0.16;
        const rr = R * (0.55 + 0.05 * j);
        r.rect(x + Math.cos(a) * rr - 0.5, y + Math.sin(a) * rr - 0.5, j > 4 ? 2 : 1, 1, j > 4 ? '#ffffff' : '#8cc8f0', 0.85 * k);
      }
    }
    // funnel: a snow skirt at the base, a pinched waist, flaring upward
    const levels = [12, 8.5, 6, 6.5, 8.5, 11];
    for (let i = 0; i < levels.length; i++) {
      const rx = levels[i] * (0.4 + 0.6 * k);
      const ry = Math.max(1.5, rx * 0.32);
      const cy = y - 2 - i * 4;
      const spin = this.age * (12 - i) + i * 1.3;
      const n = Math.round(8 + rx * 1.4);
      for (let j = 0; j < n; j++) {
        const a = spin + (j / n) * 4.4;
        const s = Math.sin(a);
        const front = s > 0;
        const px = x + Math.cos(a) * rx;
        const py = cy + s * ry;
        if (front) r.rect(px - 0.5, py - 0.5, 2, 1, '#ffffff', 0.95 * k);
        else r.rect(px - 0.5, py - 0.5, 1, 1, '#3a72c4', 0.85 * k);
      }
    }
    // snow caught in the wind
    for (let i = 0; i < 10; i++) {
      const a = this.age * 7 + i * 0.63;
      const h = (i * 3 + this.age * 24) % 26;
      const rr = 3 + h * 0.4;
      r.rect(x + Math.cos(a) * rr, y - 2 - h + Math.sin(a) * rr * 0.3, 1, 1, '#ffffff', 0.9 * k);
    }
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 8, 30, '#bfe8ff', { intensity: 0.5 * this.strength });
  }
}

/** The spirit's whirlwind, if it still blows. */
export function spiritGust(w: World, e: Enemy): Whirlwind | null {
  for (const x of w.entities) if (x instanceof Whirlwind && !x.dead && x.owner === e && x.endAt < 0) return x;
  return null;
}

defineEnemy({
  id: 'blizzard_spirit',
  name: SPIRIT_NAME,
  hp: 30,
  radius: 6,
  speed: 40,
  flying: true,
  sprite: 'blizwisp_drift',
  spriteYOffset: -9,
  shadow: 11,
  cost: 1.5,
  floors: [4],
  weight: 0.9,
  champion: true,
  deathFx: 'ice',
  bloodColor: '#e8f8ff',
  dieSfx: 'freeze',
  light: { radius: 24, color: '#cfefff' },
  *script(e, w) {
    yield w.rng.range(0.3, 0.9);
    let side = w.rng.sign();
    while (true) {
      e.setAnim('blizwisp_drift');
      const gust = spiritGust(w, e);
      // circle the keeper at 80–120 px
      const t = gust ? w.rng.range(0.6, 0.9) : w.rng.range(1.1, 1.6);
      for (let el = 0; el < t; el += w.dt) {
        const tg = e.target(w);
        const a = Math.atan2(e.y - tg.y, e.x - tg.x) + side * 0.8 * w.dt;
        const R = 100 + Math.sin(e.age * 1.7) * 16;
        const gx = tg.x + Math.cos(a) * R;
        const gy = tg.y + Math.sin(a) * R * 0.8;
        e.moveDir(gx - e.x, gy - e.y, Math.min(e.speed, Math.hypot(gx - e.x, gy - e.y) * 2));
        if (e.mem.__bumped) side = -side;
        yield;
      }
      if (!spiritGust(w, e)) {
        // conjure a whirlwind between us
        e.stop();
        e.setAnim('blizwisp_summon');
        e.telegraph(GUST_FORM);
        const tg = e.target(w);
        const s = inside(w, e.x + (tg.x - e.x) * 0.45, e.y + (tg.y - e.y) * 0.45, GUST_R + 2);
        Whirlwind.conjure(w, e, s.x, s.y, Math.atan2(tg.y - s.y, tg.x - s.x));
        gather(w, s.x, s.y - 6, SNOWDUST, 10, 20);
        w.sfx('whoosh', { vol: 0.45, pitch: 0.55 });
        yield GUST_FORM;
      } else {
        // flick a narrow fan of snowflakes while the wind blows
        e.stop();
        e.facing = e.target(w).x >= e.x ? 1 : -1;
        e.setAnim('blizwisp_flick', true);
        e.telegraph(0.4);
        gather(w, e.x + e.facing * 6, e.y - 12, SNOWDUST, 5, 10);
        yield 0.4;
        e.facing = e.target(w).x >= e.x ? 1 : -1;
        e.shootAt(w, null, snowShot({ count: 3, spread: 0.16, speed: 96, z: 9, range: 260 }));
        w.sfx('freeze', { vol: 0.25, pitch: 1.8 });
        yield 0.3;
      }
    }
  },
  update(e, w) {
    if (fx.chance(0.35)) {
      w.particles.spawn({ x: e.x - e.facing * 4 + fx.range(-3, 3), y: e.y - 4 + fx.range(-2, 2), vx: -e.facing * fx.range(4, 12) + e.vx * -0.2, vy: fx.range(2, 10), life: fx.range(0.5, 0.9), colors: SNOWDUST, size: 1, alpha: 0.85 });
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'blizwisp_hurt_0'), -9 + Math.sin(e.age * 2.4) * 1.5);
  },
});
