// Floor 1 — 잊혀진 지하묘지 (crypt): two more skeleton basics.
//  - 종지기 해골 (bell ringer): keeps 60–100 px away, raises a cracked bronze hand-bell
//    (its reach shows as a faint floor ring) and tolls it: two expanding rings of sound
//    that only hurt where their band passes — dash through it or stand outside its reach.
//  - 해골 석궁수 (bone archer): a helmeted crossbow skeleton that keeps its distance, tracks
//    the keeper with a dotted sightline, locks it (red, blinking) and looses one fast bolt
//    along the locked line, then cranks the crossbow while repositioning.

import { defineEnemy } from '../../game/defs';
import { Entity } from '../../game/entity';
import { GroundWarning } from '../../game/effects';
import { PixelPainter, ramp } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { clamp, TAU } from '../../engine/math';
import type { Renderer } from '../../engine/renderer';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Script } from '../../engine/script';
import { BUL, dust, frames, hurtFrame, rayFree, sphere, WARN_RED } from './shared';

const BONE = ramp('#dcd2b6', 5);
const SOCKET = '#1a0c10';
const CRYPT_DUST = ['#8a7a6a', '#5a4a3a', '#3a2e2a'];

/** Clip world drawing to the room's floor (the toll's sound rings stop at the walls). */
function clipToRoom(r: Renderer, w: World, draw: () => void): void {
  const room = w.room;
  const c = r.ctx;
  c.save();
  c.beginPath();
  c.rect(Math.round(room.interiorX - r.viewX), Math.round(room.interiorY - r.viewY), room.interiorW, room.interiorH);
  c.clip();
  draw();
  c.restore();
}

/**
 * Purely visual companion of an enemy: draws extra telegraph art (a sightline, a tongue)
 * from the enemy's state, on its own layer (3 = above the lighting, 1 = y-sorted just
 * in front of the enemy), and can add lights. Never touches gameplay state.
 */
export class EnemyOverlay extends Entity {
  static override readonly cosmetic = true;
  readonly owner: Enemy;
  private readonly paint: (e: Enemy, r: Renderer, w: World) => void;
  private readonly glow?: (e: Enemy, w: World) => void;

  constructor(owner: Enemy, layer: number, paint: (e: Enemy, r: Renderer, w: World) => void, glow?: (e: Enemy, w: World) => void) {
    super();
    this.owner = owner;
    this.paint = paint;
    this.glow = glow;
    this.layer = layer;
    this.tileCollide = false;
    this.x = owner.x;
    this.y = owner.y;
  }

  override get sortY(): number {
    return this.owner.y + 0.5;
  }

  override update(): void {
    if (this.owner.dead || !this.owner.alive) this.dead = true;
    this.x = this.owner.x;
    this.y = this.owner.y;
  }

  override draw(r: Renderer, w: World): void {
    if (!this.owner.hidden && this.owner.alive) this.paint(this.owner, r, w);
  }

  override light(w: World): void {
    if (this.glow && !this.owner.hidden && this.owner.alive) this.glow(this.owner, w);
  }
}

// ================================================================== 종지기 해골 (bell ringer)
const ROBE = ramp('#5c4866', 5, 0.85);
const HAIR = '#8e889a';
const ROPE = ['#4a3420', '#86653a', '#c09c5c'];
const BRONZE = ['#3a1e0c', '#6e4219', '#a66c28', '#d89c42', '#f6d47c', '#fff6cc'];
const PATINA = '#58a48a';
const HANDLE = '#4a2c16';

/** Max radius of a toll ring (px), its starting radius and how long it takes to grow. */
export const TOLL_REACH = 110;
export const TOLL_START = 10;
export const TOLL_TIME = 0.9;
/** half thickness of the band that hurts */
export const TOLL_BAND = 5;

/**
 * Cracked bronze hand-bell hanging from its handle at (cx, top), swung by `tilt`
 * (+ = the mouth swings forward). 7 px wide at the flared lip, 9 px tall.
 */
function paintHandBell(p: PixelPainter, cx: number, top: number, tilt: number): void {
  p.px(cx, top, HANDLE);
  p.px(cx, top + 1, HANDLE);
  // [left, right] spans from the crown down to the flared lip
  const rows: [number, number][] = [[-1, 1], [-1, 1], [-2, 2], [-2, 2], [-3, 3]];
  const shift = (i: number) => Math.round(tilt * (i + 1) * 0.32);
  rows.forEach(([l, rr], i) => {
    const dx = shift(i);
    const y = top + 2 + i;
    for (let x = l; x <= rr; x++) {
      const k = (x - l) / (rr - l);
      let c = k < 0.3 ? BRONZE[4] : k < 0.7 ? BRONZE[3] : BRONZE[2];
      if (i === rows.length - 1) c = k < 0.15 ? BRONZE[3] : k < 0.8 ? BRONZE[4] : BRONZE[2];
      p.px(cx + x + dx, y, c);
    }
  });
  // highlights, a crack down the right flank, a speck of green patina
  p.px(cx - 1 + shift(0), top + 2, BRONZE[5]);
  p.px(cx - 1 + shift(2), top + 4, BRONZE[5]);
  p.px(cx + 1 + shift(1), top + 3, BRONZE[0]);
  p.px(cx + 1 + shift(2), top + 4, BRONZE[1]);
  p.px(cx + 2 + shift(3), top + 5, BRONZE[0]);
  p.px(cx - 1 + shift(3), top + 5, PATINA);
  // the dark mouth and the clapper swinging behind it
  const dm = shift(5);
  p.rect(cx - 2 + dm, top + 7, 5, 1, '#24120a');
  p.px(cx + dm - Math.sign(Math.round(tilt)), top + 8, BRONZE[1]);
}

interface RingerPose {
  bob: number;
  step: number;
  /** where the bell hand is: hanging low, raised high, swung forward, swung back */
  bell: 'low' | 'up' | 'out' | 'back';
  tilt: number;
  jaw?: number;
  /** head x offset (recoil / leaning back with the bell up) */
  lean?: number;
  eye?: string;
}

/** The hunched sexton (robe, rope, cowl, skull) in its own 20x22 frame. */
function paintRingerBody(p: PixelPainter, s: RingerPose): void {
  const b = s.bob;
  const st = s.step;
  // bony feet under the hem
  p.rect(6 + st, 21, 2, 1, BONE[2]);
  p.rect(11 - st, 21, 2, 1, BONE[2]);
  p.px(6 + st, 21, BONE[3]);
  // hunched robe: cowl hump on the back, tattered hem
  const hem = st >= 0
    ? [16, 20, 15, 21, 13, 20, 11, 21, 9, 20, 7, 21, 5, 20, 3, 21, 2, 20]
    : [16, 21, 14, 20, 12, 21, 10, 20, 8, 21, 6, 20, 4, 21, 2, 20, 2, 19];
  p.poly([4, 10 + b, 5, 7 + b, 8, 5 + b, 11, 7 + b, 13, 10 + b, 14, 14, ...hem, 3, 15], ROBE[2]);
  sphere(p, 8, 11 + b, 8, 10, ROBE, false);
  // broad folds and the lit back edge
  p.line(7, 13 + b, 6, 19, ROBE[1]);
  p.line(11, 13 + b, 12, 19, ROBE[1]);
  p.line(9, 15 + b, 9, 19, ROBE[3]);
  p.line(5, 8 + b, 4, 12 + b, ROBE[4]);
  p.px(6, 6 + b, ROBE[4]);
  // ragged hem holes
  p.px(5 - (st > 0 ? 1 : 0), 19, ROBE[0]);
  p.px(13 + (st > 0 ? 1 : 0), 19, ROBE[0]);
  // rope belt with a dangling knot
  p.line(4, 14 + b, 13, 13 + b, ROPE[1]);
  p.px(5, 14 + b, ROPE[2]);
  p.px(8, 15 + b, ROPE[0]);
  p.px(8 - st, 16 + b, ROPE[1]);
  p.px(8 - st, 17 + b, ROPE[2]);
  // cowl lying on the shoulders
  p.poly([7, 5 + b, 11, 5 + b, 13, 8 + b, 11, 10 + b, 7, 9 + b], ROBE[1]);
  p.line(8, 6 + b, 10, 6 + b, ROBE[3]);
  // skull, pushed forward by the hunch, a few grey wisps of hair at the back
  const hx = 12 + (s.lean ?? 0);
  const hy = 5 + b;
  p.circle(hx, hy, 3.6, BONE[3]);
  sphere(p, hx, hy, 3.6, 3.6, BONE, false);
  p.line(hx - 3, hy - 1, hx - 4, hy + 2, HAIR);
  p.px(hx - 3, hy + 3, HAIR);
  p.px(hx - 2, hy - 3, BONE[4]);
  p.px(hx - 1, hy - 3, BONE[4]);
  p.px(hx + 1, hy - 2, BONE[1]);
  p.px(hx, hy - 1, BONE[1]);
  // sockets (3/4 view: a full one and a narrow far one) with amber candle eyes
  p.rect(hx - 1, hy, 2, 2, SOCKET);
  p.rect(hx + 2, hy, 1, 2, SOCKET);
  const eye = s.eye ?? '#ffb040';
  p.px(hx, hy, eye);
  p.px(hx + 2, hy, eye);
  p.px(hx + 1, hy + 2, SOCKET);
  // jaw
  const jaw = s.jaw ?? 0;
  p.rect(hx - 1, hy + 3, 4, 1 + jaw, SOCKET);
  p.px(hx - 1, hy + 3, BONE[4]);
  p.px(hx + 1, hy + 3, BONE[4]);
  if (jaw) p.rect(hx - 1, hy + 4 + jaw, 4, 1, BONE[2]);
}

/** 22x24 frame: the body (offset 1, 2) plus the bell arm and the bell. */
function paintRinger(p: PixelPainter, s: RingerPose): void {
  const body = new PixelPainter(20, 22);
  paintRingerBody(body, s);
  p.blit(body, 1, 2);
  const b = s.bob;
  const sx = 13;
  const sy = 12 + b;
  if (s.bell === 'low') {
    p.line(sx, sy, 15, 14 + b, BONE[3]);
    p.line(15, 14 + b, 16, 13 + b, BONE[3]);
    paintHandBell(p, 17, 14 + b, s.tilt);
    p.px(17, 13 + b, BONE[4]);
  } else if (s.bell === 'up') {
    p.line(sx, sy, 16, 7 + b, BONE[3]);
    p.line(16, 7 + b, 17, 2, BONE[4]);
    paintHandBell(p, 18, 0, s.tilt);
    p.px(17, 1, BONE[4]);
    p.px(17, 0, BONE[3]);
  } else if (s.bell === 'out') {
    p.line(sx, sy, 15, 9 + b, BONE[3]);
    paintHandBell(p, 16, 9 + b, s.tilt);
    p.px(15, 9 + b, BONE[4]);
  } else {
    p.line(sx, sy, 15, 11 + b, BONE[3]);
    paintHandBell(p, 15, 11 + b, s.tilt);
    p.px(14, 11 + b, BONE[4]);
  }
}

const RINGER_WALK: RingerPose[] = [
  { bob: 0, step: 1, bell: 'low', tilt: -1 },
  { bob: -1, step: 0, bell: 'low', tilt: 0 },
  { bob: 0, step: -1, bell: 'low', tilt: 1 },
  { bob: -1, step: 0, bell: 'low', tilt: 0 },
];
const RO = { anchor: 'bottom' as const };
frames('bellringer', 'walk', 4, 22, 24, (p, i) => paintRinger(p, RINGER_WALK[i]), { ...RO, fps: 6 });
frames('bellringer', 'idle', 2, 22, 24, (p, i) => paintRinger(p, { bob: 0, step: 0, bell: 'low', tilt: i ? 0.6 : -0.6 }), { ...RO, fps: 2.5 });
frames('bellringer', 'raise', 2, 22, 24, (p, i) => paintRinger(p, { bob: -1, step: 0, bell: 'up', tilt: i ? 1 : -1, jaw: 1, lean: -1, eye: '#fff0a0' }), { ...RO, fps: 14 });
frames('bellringer', 'ring', 2, 22, 24, (p, i) => paintRinger(p, i === 0
  ? { bob: 1, step: 1, bell: 'out', tilt: 1.3, jaw: 1, eye: '#ffffff' }
  : { bob: 0, step: 1, bell: 'back', tilt: -1, jaw: 0, eye: '#fff0a0' }), { ...RO, fps: 9, loop: false });
frames('bellringer', 'hurt', 1, 22, 24, (p) => paintRinger(p, { bob: 1, step: 0, bell: 'low', tilt: -1.4, jaw: 1, lean: -1, eye: '#ffffff' }), RO);

/** The reach of a coming toll: a quiet ring on the floor around the ringer while it raises the bell. */
export class TollReach extends GroundWarning {
  owner: Enemy;
  constructor(owner: Enemy, time: number) {
    super(owner.x, owner.y, TOLL_REACH, time, undefined, WARN_RED);
    this.owner = owner;
  }

  override update(w: World, dt: number): void {
    if (!this.owner.alive) {
      this.dead = true;
      return;
    }
    this.x = this.owner.x;
    this.y = this.owner.y;
    super.update(w, dt);
  }

  override draw(r: Renderer, w?: World): void {
    if (!w) return;
    const t = clamp(this.age / this.time, 0, 1);
    const blink = Math.floor(this.age * 12) % 2 === 0 ? 1 : 0.55;
    const R = this.radius;
    clipToRoom(r, w, () => {
      r.pixelRing(this.x, this.y, R, '#1a0608', 3, 0.35 * blink);
      r.pixelRing(this.x, this.y, R, WARN_RED, 1, (0.45 + 0.25 * t) * blink);
      // eight short ticks pointing inward mark the band the sound will travel
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + 0.2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        r.pixelLine(this.x + c * (R - 5), this.y + s * (R - 5), this.x + c * (R - 1), this.y + s * (R - 1), WARN_RED, 1, 0.5 * blink);
      }
    });
  }
}

/**
 * One toll: a ring of sound growing from TOLL_START to `maxR` px. It hurts a grounded
 * keeper only while its band (±TOLL_BAND) passes over them, at most once per ring;
 * dashing (invulnerable) or standing outside its reach dodges it. Gameplay state lives
 * in `mem` (radius, hit mask by keeper slot) so it is part of the state hash.
 */
export class BellToll extends Entity {
  mem = { rad: TOLL_START, hits: 0 };
  readonly maxR: number;
  readonly speed: number;
  readonly source: string;

  constructor(x: number, y: number, source: string, maxR = TOLL_REACH, time = TOLL_TIME) {
    super();
    this.x = x;
    this.y = y;
    this.maxR = maxR;
    this.speed = (maxR - TOLL_START) / time;
    this.source = source;
    this.layer = 0;
    this.tileCollide = false;
    this.team = 'enemy';
    this.enemyHazard = true;
  }

  /** Is (px, py) on the dangerous band right now? */
  onBand(px: number, py: number): boolean {
    const d = Math.hypot(px - this.x, py - this.y);
    return Math.abs(d - this.mem.rad) <= TOLL_BAND + 1.5;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const m = this.mem;
    m.rad = Math.min(this.maxR, m.rad + this.speed * dt);
    // harmless over the last few px while it fades (never invisible and dangerous)
    if (m.rad < this.maxR - 3) {
      for (const p of w.targets()) {
        const bit = 1 << (p.slot | 0);
        if ((m.hits & bit) !== 0 || !p.alive || p.z > 2 || p.dashing) continue;
        if (!this.onBand(p.x, p.y)) continue;
        if (p.hurt(w, 1, this.source, false, this)) {
          m.hits |= bit;
          const d = Math.hypot(p.x - this.x, p.y - this.y) || 1;
          p.knock((p.x - this.x) / d, (p.y - this.y) / d, 110);
        }
      }
    }
    // bone dust jumping off the wavefront (cosmetic)
    const room = w.room;
    for (let i = 0; i < 3; i++) {
      if (!fx.chance(0.55)) continue;
      const a = fx.angle();
      const x = this.x + Math.cos(a) * m.rad;
      const y = this.y + Math.sin(a) * m.rad;
      if (x < room.interiorX + 2 || y < room.interiorY + 2 || x > room.interiorX + room.interiorW - 2 || y > room.interiorY + room.interiorH - 2) continue;
      w.particles.spawn({
        x, y, vx: Math.cos(a) * 18, vy: Math.sin(a) * 18, vz: fx.range(20, 50), gravity: 300, life: fx.range(0.2, 0.35),
        colors: ['#fff6d8', BRONZE[4], CRYPT_DUST[0]], size: 1,
      });
    }
    if (m.rad >= this.maxR) this.dead = true;
  }

  override draw(r: Renderer, w: World): void {
    const rad = this.mem.rad;
    const k = rad / this.maxR;
    const a = k < 0.86 ? 1 : Math.max(0, (1 - k) / 0.14);
    clipToRoom(r, w, () => {
      // the band that hurts, a dark rim for contrast, the bright bronze front and its inner edge
      r.pixelRing(this.x, this.y, rad, '#c08a3a', TOLL_BAND * 2, 0.2 * a);
      r.pixelRing(this.x, this.y, rad + 2.5, '#1a0c06', 1, 0.6 * a);
      r.pixelRing(this.x, this.y, rad, '#ffcf6a', 2, 0.95 * a);
      r.pixelRing(this.x, this.y, rad - 2, '#fff6d8', 1, 0.7 * a);
    });
  }

  override light(w: World): void {
    const rad = this.mem.rad;
    const a = rad < this.maxR * 0.86 ? 1 : Math.max(0, (this.maxR - rad) / (this.maxR * 0.14));
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * TAU;
      w.lights.add(this.x + Math.cos(ang) * rad, this.y + Math.sin(ang) * rad, 20, '#ffc060', { intensity: 0.55 * a });
    }
  }
}

/** Ringer footwork: hold 60–100 px from the target (with a little hysteresis). Returns the distance. */
function ringerSpacing(e: Enemy, w: World): number {
  const d = e.distToTarget(w);
  const walking = e.mem.walk === 1;
  if (d > (walking ? 90 : 100)) {
    e.mem.walk = 1;
    e.setAnim('bellringer_walk');
    e.chase(w, e.speed);
  } else if (d < (walking ? 66 : 58)) {
    e.mem.walk = 1;
    e.setAnim('bellringer_walk');
    if (e.mem.__bumped) e.mem.side = -(e.mem.side || 1);
    e.moveAngle(e.angleToTarget(w) + Math.PI + (e.mem.side || 1) * 0.5, e.speed * 0.85);
  } else {
    e.mem.walk = 0;
    e.setAnim('bellringer_idle');
    e.stop();
  }
  return d;
}

function* toll(e: Enemy, w: World): Script {
  e.halt();
  const tg = e.target(w);
  e.facing = tg.x >= e.x ? 1 : -1;
  const rings = e.champion ? 3 : 2;
  const windup = 0.7;
  const gap = 0.45;
  e.setAnim('bellringer_raise');
  e.telegraph(windup);
  w.spawn(new TollReach(e, windup + gap * (rings - 1) + 0.05));
  w.sfx('hit_metal', { vol: 0.22, pitch: 1.9 });
  for (let el = 0; el < windup; el += w.dt) {
    // the clapper rattles while the bell is up
    if (Math.floor(el * 8) !== Math.floor((el - w.dt) * 8) && el > w.dt) w.sfx('clock_tick', { vol: 0.18, pitch: 1.6 + fx.range(-0.1, 0.1) });
    yield;
  }
  for (let k = 0; k < rings; k++) {
    e.setAnim('bellringer_ring', true);
    e.squash(1.2, 0.85);
    w.spawn(new BellToll(e.x, e.y, e.def.name));
    w.sfx('clockboss_chime', { vol: 0.55, pitch: 0.34 + k * 0.03 });
    w.sfx('hit_metal', { vol: 0.25, pitch: 0.55 });
    dust(w, e.x, e.y + 4, CRYPT_DUST, 6, 50);
    if (k < rings - 1) {
      yield gap * 0.55;
      e.setAnim('bellringer_raise');
      yield gap * 0.45;
    }
  }
  yield 0.35;
}

defineEnemy({
  id: 'bell_ringer',
  name: '종지기 해골',
  hp: 32,
  radius: 6,
  speed: 26,
  sprite: 'bellringer_walk',
  spriteYOffset: 5,
  shadow: 13,
  cost: 1.5,
  floors: [1],
  weight: 0.9,
  champion: true,
  deathFx: 'bone',
  bloodColor: '#d8ccb0',
  hurtSfx: 'hit',
  light: { radius: 18, color: '#ffb850' },
  *script(e, w) {
    yield w.rng.range(0.3, 0.8);
    let rest = w.rng.range(0.4, 0.9);
    while (true) {
      // footwork until the bell is ready and the keeper stands within its reach
      let ready = false;
      for (let el = 0; el < 2.6; el += w.dt) {
        const d = ringerSpacing(e, w);
        if (el > rest && d >= 28 && d <= 100) {
          ready = true;
          break;
        }
        yield;
      }
      // cornered (keeper hugging it) after a while: toll anyway; out of reach: keep walking
      if (!ready && e.distToTarget(w) > 100) continue;
      yield* toll(e, w);
      rest = w.rng.range(1.4, 1.8);
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'bellringer_hurt_0'));
    if (e.anim === 'bellringer_ring' && e.animT < 0.3) {
      // little sound arcs off the swung bell (cosmetic)
      const k = e.animT / 0.3;
      const bx = e.x + e.facing * 8;
      const by = e.y - 9;
      for (let i = 0; i < 2; i++) {
        const rr = 3 + k * 6 + i * 3;
        r.pixelLine(bx + e.facing * rr, by - 2 - i, bx + e.facing * (rr + 1), by + 1 + i, '#fff0b0', 1, (1 - k) * 0.9);
      }
    }
  },
  onDeath(e, w) {
    w.sfx('hit_metal', { vol: 0.35, pitch: 0.7 });
    w.particles.burst(e.x + e.facing * 6, e.y - 6, {
      count: 8, speed: [30, 90], life: [0.3, 0.6], colors: [BRONZE[4], BRONZE[3], BRONZE[2]], size: [1, 2], gravity: 320, vz: [40, 110], shape: 'square', vrot: 8,
    });
    w.particles.burst(e.x, e.y - 4, { count: 10, speed: [20, 70], life: [0.3, 0.6], colors: [ROBE[2], ROBE[1]], size: [1, 2], gravity: 280, vz: [20, 70] });
  },
});

// ================================================================== 해골 석궁수 (bone archer)
const IRON = ramp('#6a6676', 5);
const RUST = '#9a5430';
const TABARD = ['#3a1018', '#5e1a24', '#86262e', '#a8403a'];
const WOOD = ['#3e2414', '#6a4024', '#946038'];
const STRING = '#e8e0cc';
const STRING_DIM = '#9a8e7c';
const FLETCH = '#c0283a';

interface ArcherPose {
  bob: number;
  legL: number;
  legR: number;
  bow: 'carry' | 'aim' | 'fire' | 'crank';
  /** reload crank hand position (0/1) */
  crank?: number;
  eye?: string;
  /** head recoil (hurt) */
  lean?: number;
}

function paintArcher(p: PixelPainter, s: ArcherPose): void {
  const b = s.bob;
  // slim quiver slung on the back, fletchings over the shoulder
  p.poly([3, 8 + b, 5, 8 + b, 6, 14 + b, 4, 14 + b], WOOD[1]);
  p.line(3, 8 + b, 4, 13 + b, WOOD[2]);
  p.px(3, 7 + b, FLETCH);
  p.px(4, 6 + b, FLETCH);
  p.px(5, 7 + b, STRING);
  // legs: thigh, shin, foot
  const leg = (hx: number, off: number) => {
    p.line(hx, 15 + b, hx + off * 0.5, 17, BONE[1]);
    p.line(hx + off * 0.5, 17, hx + off, 18, BONE[2]);
    p.rect(hx + off - (off < 0 ? 1 : 0), 19, 2, 1, BONE[2]);
    p.px(hx + off, 18, BONE[2]);
  };
  leg(6, s.legL);
  leg(9, s.legR);
  // tattered crimson tabard, a rusty pauldron, a rib showing through a tear
  p.poly([5, 9 + b, 11, 9 + b, 11, 15 + b, 10, 16 + b, 9, 15 + b, 8, 16 + b, 7, 15 + b, 6, 16 + b, 5, 15 + b], TABARD[2]);
  p.shadeVertical(5, 9 + b, 7, 8, [TABARD[0], TABARD[1], TABARD[2], TABARD[3]], false);
  p.line(5, 9 + b, 5, 14 + b, TABARD[3]);
  p.px(8, 11 + b, BONE[3]);
  p.px(8, 12 + b, SOCKET);
  p.line(5, 13 + b, 11, 13 + b, WOOD[0]);
  p.px(8, 13 + b, '#c8a050');
  p.rect(9, 9 + b, 3, 1, IRON[3]);
  p.px(11, 10 + b, IRON[1]);
  // skull: the face shows under the brim
  const hx = 8 + (s.lean ?? 0);
  const hy = 6 + b;
  p.circle(hx, hy, 3.4, BONE[3]);
  sphere(p, hx, hy, 3.4, 3.4, BONE, false);
  p.px(hx - 2, hy, BONE[4]);
  p.rect(hx, hy - 1, 2, 2, SOCKET);
  p.px(hx + 3, hy - 1, SOCKET);
  p.px(hx + 3, hy, SOCKET);
  p.px(hx + 1, hy - 1, s.eye ?? '#ff4a32');
  p.px(hx + 2, hy + 1, SOCKET);
  p.rect(hx, hy + 2, 3, 1, SOCKET);
  p.px(hx, hy + 2, BONE[4]);
  p.px(hx + 2, hy + 2, BONE[4]);
  p.rect(hx, hy + 3, 3, 1, BONE[2]);
  // rusty kettle helmet: dome + wide brim
  p.ellipse(hx - 0.5, hy - 3.2, 3.8, 2.3, IRON[2]);
  sphere(p, hx - 0.5, hy - 3.2, 3.8, 2.3, IRON, false);
  p.rect(hx - 5, hy - 2, 11, 1, IRON[3]);
  p.px(hx - 5, hy - 2, IRON[1]);
  p.px(hx + 5, hy - 2, IRON[1]);
  p.px(hx - 2, hy - 4, RUST);
  p.px(hx + 1, hy - 3, RUST);
  p.px(hx - 2, hy - 5, IRON[4]);
  // crossbow + bony arms and hands
  if (s.bow === 'carry') {
    // held across the hips, pointing ahead and down
    p.line(6, 11 + b, 8, 13 + b, BONE[2]);
    p.line(7, 13 + b, 13, 14 + b, WOOD[1]);
    p.line(13, 12 + b, 14, 16 + b, IRON[1]);
    p.px(13, 12 + b, IRON[3]);
    p.line(13, 12 + b, 11, 14 + b, STRING_DIM);
    p.line(14, 16 + b, 11, 14 + b, STRING_DIM);
    p.px(8, 13 + b, BONE[4]);
    p.px(11, 14 + b, BONE[4]);
  } else if (s.bow === 'aim' || s.bow === 'fire') {
    // raised to the eye, braced on the shoulder
    const kick = s.bow === 'fire' ? -1 : 0;
    p.line(6, 11 + b, 8 + kick, 9 + b, BONE[2]);
    p.line(10, 10 + b, 12 + kick, 9 + b, BONE[3]);
    p.line(6 + kick, 8 + b, 14 + kick, 8 + b, WOOD[1]);
    p.px(6 + kick, 9 + b, WOOD[0]);
    p.line(15 + kick, 5 + b, 15 + kick, 11 + b, IRON[1]);
    p.px(15 + kick, 5 + b, IRON[3]);
    p.px(15 + kick, 11 + b, IRON[3]);
    if (s.bow === 'aim') {
      p.line(15, 5 + b, 11, 8 + b, STRING);
      p.line(15, 11 + b, 11, 8 + b, STRING);
      // the loaded bolt: bone shaft, red head
      p.line(10, 7 + b, 15, 7 + b, BONE[4]);
      p.px(16, 7 + b, BUL.crypt.color);
      p.px(10, 7 + b, FLETCH);
    } else {
      p.line(14, 5 + b, 14, 11 + b, STRING);
      p.px(16, 8 + b, '#ffffff');
    }
    p.px(8 + kick, 9 + b, BONE[4]);
    p.px(12 + kick, 9 + b, BONE[4]);
  } else {
    // pointing down at its feet, cranking the string back
    const c = s.crank ?? 0;
    p.line(6, 11 + b, 8 + c, 11 + b - c, BONE[2]);
    p.line(9, 11 + b, 12, 16, WOOD[1]);
    p.line(10, 17, 14, 16, IRON[1]);
    p.px(14, 16, IRON[3]);
    p.line(10, 17, 10, 13 + b, STRING_DIM);
    p.px(8 + c, 11 + b - c, BONE[4]);
    p.px(7 + c, 10 + b, WOOD[2]);
    p.px(11, 13 + b, BONE[4]);
  }
}

const ARCHER_WALK: ArcherPose[] = [
  { bob: 0, legL: -1, legR: 1, bow: 'carry' },
  { bob: -1, legL: 0, legR: 0, bow: 'carry' },
  { bob: 0, legL: 1, legR: -1, bow: 'carry' },
  { bob: -1, legL: 0, legR: 0, bow: 'carry' },
];
const AO = { anchor: 'bottom' as const };
frames('barcher', 'walk', 4, 17, 20, (p, i) => paintArcher(p, ARCHER_WALK[i]), { ...AO, fps: 7 });
frames('barcher', 'aim', 2, 17, 20, (p, i) => paintArcher(p, { bob: 0, legL: -1, legR: 2, bow: 'aim', eye: i ? '#ffd0a0' : '#ff4a32' }), { ...AO, fps: 6 });
frames('barcher', 'fire', 1, 17, 20, (p) => paintArcher(p, { bob: 0, legL: -2, legR: 2, bow: 'fire', eye: '#ffffff' }), AO);
frames('barcher', 'crank', 4, 17, 20, (p, i) => paintArcher(p, { ...ARCHER_WALK[i], bow: 'crank', crank: i % 2 }), { ...AO, fps: 7 });
frames('barcher', 'hurt', 1, 17, 20, (p) => paintArcher(p, { bob: 1, legL: -1, legR: 1, bow: 'carry', eye: '#ffffff', lean: -1 }), AO);

// the bolt: a bone shaft with a glowing crypt-red head (points right; rotates with its flight)
defineDrawnSprite('barcher_bolt', 12, 5, (p) => {
  p.line(2, 2, 8, 2, BONE[3]);
  p.line(3, 1, 7, 1, BONE[4]);
  p.poly([8, 0, 12, 2.5, 8, 5], BUL.crypt.rim);
  p.poly([8.5, 1, 11, 2.5, 8.5, 4], BUL.crypt.color);
  p.px(9, 2, BUL.crypt.core);
  p.px(10, 2, '#ffffff');
  p.px(0, 0, FLETCH);
  p.px(1, 1, FLETCH);
  p.px(0, 4, FLETCH);
  p.px(1, 3, FLETCH);
  p.px(2, 1, '#7a1020');
  p.px(2, 3, '#7a1020');
}, { outline: BUL.crypt.outline });

/** Bolt flight: speed, how long the sightline tracks, how long it stays locked. */
export const ARCHER_BOLT_SPEED = 260;
export const ARCHER_TRACK = 0.9;
export const ARCHER_LOCK = 0.35;
const BOLT_Z = 7;
/** Max turn rate of the sightline while tracking (rad/s): a dash sideways outruns it. */
const ARCHER_TURN = 3.6;

/** Ground point the bolt leaves from (in front of the crossbow, on the aim side). */
function boltOrigin(e: Enemy, a: number): { x: number; y: number } {
  const f = Math.cos(a) >= 0 ? 1 : -1;
  return { x: e.x + f * 7, y: e.y + 1 };
}

function turnToward(a: number, b: number, max: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + clamp(d, -max, max);
}

/** Recompute the sightline (origin, length to the first wall) for aim angle `a`. */
function setSight(e: Enemy, w: World, a: number): void {
  const o = boltOrigin(e, a);
  e.mem.aimA = a;
  e.mem.ox = o.x;
  e.mem.oy = o.y;
  e.mem.aimLen = rayFree(w.room, o.x, o.y, a, 2, 300, true, 3);
}

/** Archer footwork: keep 90–150 px, back off inside 70 px, strafe in between. */
function archerSpacing(e: Enemy, w: World, slow = 1): void {
  const d = e.distToTarget(w);
  if (e.mem.__bumped) e.mem.side = -e.mem.side;
  if (d < 70) e.moveAngle(e.angleToTarget(w) + Math.PI + e.mem.side * 0.6, e.speed * slow);
  else if (d > 150) e.chase(w, e.speed * slow);
  else if (d < 90) {
    const a = e.angleToTarget(w) + Math.PI + e.mem.side * 0.9;
    e.moveAngle(a, e.speed * 0.7 * slow);
  } else {
    const a = e.angleToTarget(w) + e.mem.side * Math.PI / 2;
    e.moveAngle(a, e.speed * 0.45 * slow);
  }
}

function* snipe(e: Enemy, w: World): Script {
  e.halt();
  e.setAnim('barcher_aim');
  const t0 = e.target(w);
  let a = Math.atan2(t0.y - 4 - (e.y + 1), t0.x - e.x);
  setSight(e, w, a);
  e.mem.aim = 1;
  w.sfx('clock_ratchet', { vol: 0.28, pitch: 0.75 });
  // track (turn-rate limited)
  for (let el = 0; el < ARCHER_TRACK; el += w.dt) {
    const tg = e.target(w);
    const o = boltOrigin(e, a);
    a = turnToward(a, Math.atan2(tg.y - 4 - o.y, tg.x - o.x), ARCHER_TURN * w.dt);
    setSight(e, w, a);
    yield;
  }
  // lock: the line stops, turns red and blinks
  e.mem.aim = 2;
  e.telegraph(ARCHER_LOCK);
  w.sfx('warn', { vol: 0.3, pitch: 1.5 });
  yield ARCHER_LOCK;
  const shots = e.champion ? 2 : 1;
  for (let k = 0; k < shots; k++) {
    e.setAnim('barcher_fire', true);
    e.squash(0.85, 1.12);
    e.shoot(w, e.mem.aimA, {
      x: e.mem.ox, y: e.mem.oy, z: BOLT_Z, speed: ARCHER_BOLT_SPEED, damage: 1, radius: 2.5, range: 340,
      color: BUL.crypt.color, sprite: 'barcher_bolt', spriteRotates: true, light: 16,
    });
    w.sfx('shoot_arrow', { vol: 0.5, pitch: 0.75 });
    w.particles.burst(e.mem.ox, e.mem.oy - BOLT_Z, { count: 5, speed: [30, 80], angle: e.mem.aimA, spread: 0.5, life: [0.1, 0.25], colors: ['#ffffff', BUL.crypt.color], size: [1, 1] });
    if (k < shots - 1) yield 0.25;
  }
  e.mem.aim = 0;
  yield 0.25;
}

/** The archer's sightline (cosmetic, drawn above the lighting from `e.mem`). */
function drawSightline(e: Enemy, r: Renderer, w: World): void {
  const aim = e.mem.aim as number;
  if (!aim) return;
  const a = e.mem.aimA as number;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x0 = e.mem.ox as number;
  const y0 = (e.mem.oy as number) - BOLT_Z;
  const len = e.mem.aimLen as number;
  if (aim === 1) {
    // tracking: marching dots and a reticle around the keeper
    const off = (w.time * 30) % 4;
    for (let d = 4 + off; d < len; d += 4) r.rect(x0 + c * d, y0 + s * d, 1, 1, '#ff9a6a', 0.85);
    const tg = e.target(w);
    const td = Math.min(len, Math.hypot(tg.x - x0, tg.y - 4 - (y0 + BOLT_Z)));
    const rx = x0 + c * td;
    const ry = y0 + s * td;
    r.pixelRing(rx, ry, 6, '#ff9a6a', 1, 0.8);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) r.pixelLine(rx + dx * 5, ry + dy * 5, rx + dx * 8, ry + dy * 8, '#ffd0b0', 1, 0.9);
  } else {
    // locked: a solid red line that blinks, a hot dot where it ends
    const on = Math.floor(w.time * 14) % 2 === 0;
    r.pixelLine(x0, y0, x0 + c * len, y0 + s * len, '#2a0408', 3, 0.55);
    r.pixelLine(x0, y0, x0 + c * len, y0 + s * len, on ? '#ff3040' : '#ffb0b8', 1, 1);
    r.pixelDisc(x0 + c * len, y0 + s * len, 2, on ? '#ffd0d0' : '#ff3040', 1);
  }
}

defineEnemy({
  id: 'bone_archer',
  name: '해골 석궁수',
  hp: 24,
  radius: 5,
  speed: 30,
  sprite: 'barcher_walk',
  spriteYOffset: 5,
  shadow: 11,
  cost: 1.2,
  floors: [1],
  weight: 1,
  champion: true,
  deathFx: 'bone',
  bloodColor: '#e0d6bc',
  hurtSfx: 'hit',
  light: { radius: 12, color: '#ff5a3a' },
  init(e, w) {
    e.mem.side = w.rng.sign();
    e.mem.aim = 0;
    // the sightline glows over the lighting, like the bolt it promises
    w.spawn(new EnemyOverlay(e, 3, drawSightline));
  },
  *script(e, w) {
    yield w.rng.range(0.4, 1.0);
    while (true) {
      e.setAnim('barcher_walk');
      const t = w.rng.range(0.9, 1.5);
      for (let el = 0; el < t; el += w.dt) {
        archerSpacing(e, w);
        yield;
      }
      const tg = e.target(w);
      if (!w.room.lineOfSight(e.x, e.y, tg.x, tg.y) || e.distToTarget(w) > 210) continue;
      yield* snipe(e, w);
      // crank the crossbow while repositioning
      e.setAnim('barcher_crank');
      for (let el = 0; el < 1.6; el += w.dt) {
        archerSpacing(e, w, 0.6);
        if (Math.floor(el * 4) !== Math.floor((el - w.dt) * 4) && el > w.dt) w.sfx('clock_tick', { vol: 0.15, pitch: 0.8 });
        yield;
      }
    }
  },
  draw(e, r, w) {
    const aim = e.mem.aim as number;
    // draw-only facing: the crossbow points along the sightline, else at the keeper
    const f0 = e.facing;
    if (aim) e.facing = Math.cos(e.mem.aimA) >= 0 ? 1 : -1;
    else if (!e.hasStatus('fear')) e.facing = e.target(w).x >= e.x ? 1 : -1;
    e.drawDefault(r, hurtFrame(e, w, 'barcher_hurt_0'));
    e.facing = f0;
  },
  onDeath(e, w) {
    w.particles.burst(e.x, e.y - 8, {
      count: 8, speed: [30, 90], life: [0.3, 0.6], colors: [IRON[3], IRON[1], WOOD[1]], size: [1, 2], gravity: 320, vz: [40, 110], shape: 'square', vrot: 8,
    });
    w.sfx('hit_metal', { vol: 0.25, pitch: 1.3 });
  },
});
