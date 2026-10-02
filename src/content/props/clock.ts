// Props of the stopped clockwork spire (floor 7): the shared brass / verdigris /
// porcelain palette, gear and clock-dial painters (used by the theme's walls, rocks
// and the enemies), amber wall lamps, pendulum wall clocks whose hands never move,
// steam vents leaking from cracked pipes, and the glow of the gear shafts (pits).

import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { PixelPainter } from '../../engine/painter';
import { TILE } from '../../game/constants';
import { Tile } from '../../game/tiles';
import { bayer } from '../../engine/painter';
import { defineDrawnSprite, animFrame } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { TAU } from '../../engine/math';
import { hash2, type Face } from '../../game/roomart';
import { defineFlame } from './lights';
import { Prop } from './prop';

/** Clockwork accent colors shared by props, theme and enemies. */
export const CLOCK = {
  /** aged brass, darkest first */
  brass: ['#2a1c12', '#4a3418', '#6e5020', '#9a7430', '#c49a44', '#e8c870'],
  goldHot: '#fff0b0',
  /** verdigris patina, darkest first */
  verd: ['#1a4a40', '#2a7a66', '#48b094', '#8ae0c4'],
  /** cream porcelain, darkest first */
  porc: ['#8a7c80', '#b8aca8', '#e2d8cc', '#f8f2e8'],
  /** plum / aubergine shadows, darkest first */
  plum: ['#1a0e1e', '#2e1a34', '#48304c', '#64486a'],
  amber: { hot: '#fff0c0', mid: '#ffb446', low: '#a85a14' },
  /** "stopped time" teal (hourglass sand, rewind trails) */
  time: { hot: '#f0fff8', mid: '#6af0d4', low: '#1a7a6a' },
  /** walnut parquet, darkest first */
  wood: ['#1e1218', '#2c1a22', '#3c2628', '#4e3430', '#604238', '#745240'],
  out: '#140a10',
};

// ------------------------------------------------------------------ painters
export interface GearOpts {
  /** tooth height in px (default ~28% of r) */
  tooth?: number;
  /** hub radius (default ~30% of r) */
  hub?: number;
  /** number of spokes (0 = solid disc); default 4 for r >= 6 */
  spokes?: number;
  /** paint the rim / hub / spokes only (open wheel); default when spokes > 0 */
  open?: boolean;
}

/**
 * A cog wheel centred at (cx, cy): body radius `r` plus square teeth, lit from the
 * top-left with `ramp` (darkest first). `rot` turns the teeth and spokes.
 */
export function paintGear(p: PixelPainter, cx: number, cy: number, r: number, teeth: number, ramp: string[], rot = 0, o: GearOpts = {}): void {
  const tooth = o.tooth ?? Math.max(1.5, r * 0.28);
  const R = r + tooth;
  const hub = o.hub ?? Math.max(1.5, r * 0.3);
  const spokes = o.spokes ?? (r >= 6 ? 4 : 0);
  const open = o.open ?? spokes > 0;
  const n = ramp.length;
  for (let y = Math.floor(cy - R - 1); y <= Math.ceil(cy + R + 1); y++) {
    for (let x = Math.floor(cx - R - 1); x <= Math.ceil(cx + R + 1); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d > R + 0.3) continue;
      const a = Math.atan2(dy, dx) - rot;
      const t = Math.cos(a * teeth);
      const rr = t > 0.2 ? R : t > -0.2 ? r + tooth * 0.3 : r;
      if (d > rr) continue;
      let inside = true;
      if (open && d < r - 2.1 && d > hub) {
        inside = false;
        if (spokes > 0) {
          const seg = TAU / spokes;
          const sa = ((a % seg) + seg) % seg;
          if (Math.abs(Math.sin(sa)) * d < 1.1 || Math.abs(Math.sin(sa - seg)) * d < 1.1) inside = true;
        }
      }
      if (!inside) continue;
      // lit from the top-left; the rim band is brighter, the hub a little darker
      let s = n * (0.38 + 0.42 * (-dx * 0.55 - dy * 0.7) / R);
      if (d > r - 1.2 && d <= r + 0.2) s += 0.9;
      else if (d > r) s -= 0.3;
      if (d <= hub) s -= 0.4;
      if (d <= hub * 0.45) s = 0.4;
      s += bayer(x, y) - 0.5;
      const i = Math.max(0, Math.min(n - 1, Math.floor(s)));
      p.px(x, y, ramp[i]);
    }
  }
}

export interface DialOpts {
  bezel?: string[];
  face?: string[];
  hands?: string;
  /** a red second hand */
  second?: number | null;
}

/** A clock face: brass bezel, cream dial, twelve ticks, hands stuck at `hour`:`minute`. */
export function paintDial(p: PixelPainter, cx: number, cy: number, r: number, hour: number, minute: number, o: DialOpts = {}): void {
  const bez = o.bezel ?? CLOCK.brass;
  const face = o.face ?? CLOCK.porc;
  const hands = o.hands ?? CLOCK.plum[0];
  for (let y = Math.floor(cy - r - 2); y <= Math.ceil(cy + r + 2); y++) {
    for (let x = Math.floor(cx - r - 2); x <= Math.ceil(cx + r + 2); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d > r + 1.6) continue;
      if (d > r - 0.4) {
        const s = bez.length * (0.4 + 0.45 * (-dx * 0.6 - dy * 0.7) / r) + bayer(x, y) - 0.5;
        p.px(x, y, bez[Math.max(0, Math.min(bez.length - 1, Math.floor(s)))]);
      } else {
        // porcelain: bright, slightly darker toward the bottom-right
        const s = face.length * (0.72 + 0.3 * (-dx * 0.3 - dy * 0.5) / r) + bayer(x, y) * 0.5 - 0.25;
        p.px(x, y, face[Math.max(0, Math.min(face.length - 1, Math.floor(s)))]);
      }
    }
  }
  if (r >= 4) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const big = i % 3 === 0;
      const rr = r - 1.6;
      p.px(cx - 0.5 + Math.cos(a) * rr, cy - 0.5 + Math.sin(a) * rr, big ? hands : face[0]);
      if (big && r >= 7) p.px(cx - 0.5 + Math.cos(a) * (rr - 1), cy - 0.5 + Math.sin(a) * (rr - 1), hands);
    }
  }
  const ha = -Math.PI / 2 + ((hour % 12) / 12 + minute / 720) * TAU;
  const ma = -Math.PI / 2 + (minute / 60) * TAU;
  p.line(cx - 0.5, cy - 0.5, cx - 0.5 + Math.cos(ha) * r * 0.5, cy - 0.5 + Math.sin(ha) * r * 0.5, hands);
  p.line(cx - 0.5, cy - 0.5, cx - 0.5 + Math.cos(ma) * (r - 2), cy - 0.5 + Math.sin(ma) * (r - 2), hands);
  if (o.second !== null && o.second !== undefined) {
    const sa = -Math.PI / 2 + (o.second / 60) * TAU;
    p.line(cx - 0.5, cy - 0.5, cx - 0.5 + Math.cos(sa) * (r - 1.5), cy - 0.5 + Math.sin(sa) * (r - 1.5), '#c02a30');
  }
  p.px(cx - 0.5, cy - 0.5, bez[bez.length - 1]);
}

/** Puff of steam at (x, y): soft grey-white clouds rising and thinning out. */
export function steamPuff(w: World, x: number, y: number, n = 3, speed = 18, size = 3): void {
  for (let i = 0; i < n; i++) {
    w.particles.spawn({
      x: x + fx.range(-2, 2), y: y + fx.range(-1, 1), vx: fx.range(-6, 6), vy: -speed * fx.range(0.6, 1.2), life: fx.range(0.7, 1.3), drag: 1.4,
      size: size * fx.range(0.7, 1), sizeEnd: size * 2.2, colors: ['#f4f0ec', '#c8c0c4', '#8a7e8c'], shape: 'circle', alpha: 0.42,
    });
  }
}

// ------------------------------------------------------------------ amber lamp
defineFlame('prop_flame_amber', [CLOCK.amber.low, CLOCK.amber.mid, CLOCK.amber.hot], 5, 8);

defineDrawnSprite('prop_lamp_brass', 11, 17, (p) => {
  const B = CLOCK.brass;
  // wall bracket + curled arm
  p.rect(4, 0, 3, 2, B[2]);
  p.rect(5, 2, 1, 2, B[1]);
  p.px(4, 0, B[4]);
  p.px(6, 3, B[3]);
  // lantern cap (little dome)
  p.rect(3, 4, 5, 1, B[4]);
  p.rect(2, 5, 7, 2, B[3]);
  p.rect(2, 5, 7, 1, B[5]);
  p.px(3, 6, B[1]);
  // amber glass with brass corner posts
  p.rect(2, 7, 7, 7, '#c86a18');
  p.rect(3, 7, 5, 7, '#ffb446');
  p.rect(4, 8, 3, 5, '#ffd880');
  p.rect(2, 7, 1, 7, B[2]);
  p.rect(8, 7, 1, 7, B[1]);
  p.px(3, 8, '#fff4d0');
  // base
  p.rect(2, 14, 7, 2, B[3]);
  p.rect(2, 14, 7, 1, B[4]);
  p.rect(3, 16, 5, 1, B[1]);
  p.px(2, 14, B[5]);
}, { outline: CLOCK.out, origin: [5, 8] });

/** Brass wall lantern with a steady amber flame (the only light that kept burning). */
export class AmberLamp extends Prop {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  face: Face;
  constructor(x: number, y: number, face: Face = 'top') {
    super(x, y, 0);
    this.face = face;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (fx.chance(dt * 1.6)) {
      w.particles.spawn({
        x: this.x + fx.range(-2, 2), y: this.y - 3, vy: -fx.range(6, 14), vx: fx.range(-3, 3), life: fx.range(0.6, 1.2),
        colors: [CLOCK.amber.hot, CLOCK.amber.mid, CLOCK.amber.low], size: 1, alpha: 0.9, additive: true,
      });
    }
  }

  override draw(r: Renderer): void {
    r.sprite('prop_lamp_brass', this.x, this.y);
    r.sprite(animFrame('prop_flame_amber', this.age * 0.8), this.x, this.y + 5, { alpha: 0.9 });
  }

  override light(w: World): void {
    const fl = 1 + Math.sin(this.age * 2.1) * 0.04 + Math.sin(this.age * 9.3) * 0.025;
    w.lights.add(this.x, this.y + 2, 76 * fl, CLOCK.amber.mid, { intensity: 0.85 });
    w.lights.glow(this.x, this.y + 2, 9, CLOCK.amber.mid, 0.22 * fl);
  }
}

// ------------------------------------------------------------------ wall clock
for (let v = 0; v < 3; v++) {
  defineDrawnSprite(`prop_wallclock_${v}`, 15, 17, (p) => {
    const B = CLOCK.brass;
    const P = CLOCK.plum;
    // plum wood case with a brass crown
    p.rect(3, 9, 9, 8, P[2]);
    p.rect(3, 9, 1, 8, P[3]);
    p.rect(11, 9, 1, 8, P[1]);
    p.rect(3, 16, 9, 1, P[0]);
    // pendulum window
    p.rect(5, 10, 5, 6, P[0]);
    p.px(5, 10, P[1]);
    p.rect(2, 0, 11, 1, B[3]);
    p.px(7, 0, B[5]);
    paintDial(p, 7.5, 6.5, 5.5, [4, 7, 10][v], [50, 15, 35][v], { second: [12, 40, 3][v] });
  }, { outline: CLOCK.out, origin: [7, 10] });
}

/** Pendulum clock mounted on the top wall: the pendulum still swings, the hands are stuck. */
export class WallClock extends Prop {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  v: number;
  constructor(x: number, y: number, v: number) {
    super(x, y, 0);
    this.v = ((v % 3) + 3) % 3;
  }

  override draw(r: Renderer): void {
    r.sprite(`prop_wallclock_${this.v}`, this.x, this.y);
    // pendulum in the window (period 1.5 s, like the floor's tick)
    const a = Math.sin(this.age * (TAU / 1.5) + this.v) * 0.42;
    const x0 = this.x;
    const y0 = this.y + 0.5;
    const x1 = x0 + Math.sin(a) * 5;
    const y1 = y0 + Math.cos(a) * 5;
    r.line(x0, y0, x1, y1, CLOCK.brass[3], 1);
    r.rect(Math.round(x1) - 1, Math.round(y1), 2, 2, CLOCK.brass[5]);
  }
}

// ------------------------------------------------------------------ steam vent
defineDrawnSprite('prop_steam_vent', 9, 7, (p) => {
  const B = CLOCK.brass;
  // pipe elbow coming out of the wall, mouth pointing up
  p.rect(0, 3, 7, 3, B[2]);
  p.rect(0, 3, 7, 1, B[4]);
  p.rect(0, 5, 7, 1, B[0]);
  p.rect(5, 0, 3, 4, B[2]);
  p.rect(5, 0, 1, 4, B[4]);
  p.rect(7, 0, 1, 4, B[0]);
  p.rect(4, 0, 5, 1, B[3]);
  p.px(2, 4, CLOCK.verd[1]);
  p.px(3, 4, CLOCK.verd[2]);
  p.px(6, 2, CLOCK.verd[1]);
}, { outline: CLOCK.out, origin: [6, 1] });

/** Cracked pipe end at the wall base; it sighs out a puff of steam now and then. */
export class SteamVent extends Prop {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  timer: number;
  puffing = 0;
  constructor(x: number, y: number) {
    super(x, y, 0);
    this.timer = fx.range(1, 5);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    this.timer -= dt;
    if (this.puffing > 0) {
      this.puffing -= dt;
      if (fx.chance(dt * 26)) steamPuff(w, this.x, this.y - 1, 1, 22, 2.5);
    }
    if (this.timer <= 0) {
      this.timer = fx.range(3.5, 8);
      this.puffing = fx.range(0.5, 0.9);
      w.sfx('clock_steam', { vol: 0.16, pitch: fx.range(0.9, 1.25), x: this.x });
    }
  }

  override draw(r: Renderer): void {
    r.sprite('prop_steam_vent', this.x, this.y);
  }
}

// ------------------------------------------------------------------ gear shaft glow
/** The gear shafts (pits): a faint amber working light far below, dust drifting up, glints on the teeth. */
export class GearShaftFx extends Prop {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  tiles: { x: number; y: number; h: number }[] = [];
  spots: { x: number; y: number; ph: number }[] = [];
  constructor(w: World) {
    super(0, 0, 0);
    const room = w.room;
    for (let ty = 2; ty < room.h - 2; ty++) {
      for (let tx = 2; tx < room.w - 2; tx++) {
        if (room.tileAt(tx, ty) !== Tile.PIT) continue;
        this.tiles.push({ x: tx * TILE, y: ty * TILE, h: hash2(tx, ty, 77) });
        if (hash2(tx, ty, 79) < 0.25) this.spots.push({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, ph: hash2(tx, ty, 81) * 6 });
      }
    }
    if (!this.spots.length && this.tiles.length) this.spots.push({ x: this.tiles[0].x + 8, y: this.tiles[0].y + 8, ph: 0 });
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (!this.tiles.length) return;
    if (fx.chance(this.tiles.length * dt * 0.08)) {
      const t = this.tiles[Math.floor(fx.next() * this.tiles.length)];
      w.particles.spawn({
        x: t.x + fx.range(3, 13), y: t.y + fx.range(6, 14), vy: -fx.range(4, 9), vx: fx.range(-2, 2), life: fx.range(1.2, 2.2),
        colors: ['#e8d8b0', '#a08860'], size: 1, alpha: 0.6,
      });
    }
  }

  override draw(r: Renderer): void {
    for (const t of this.tiles) {
      const a = Math.sin(this.age * 1.7 + t.h * 20);
      if (a < 0.5) continue;
      const x = t.x + 3 + Math.floor(hash2(1, Math.floor(t.h * 1000), 3) * 10);
      const y = t.y + 7 + Math.floor(hash2(2, Math.floor(t.h * 1000), 5) * 7);
      r.rect(x, y, 2, 1, CLOCK.goldHot, (a - 0.5) * 0.9);
    }
  }

  override light(w: World): void {
    for (const s of this.spots) {
      const k = 0.8 + 0.2 * Math.sin(this.age * 0.9 + s.ph);
      w.lights.add(s.x, s.y + 4, 30 * k, '#d08a30', { intensity: 0.3 });
    }
  }
}
