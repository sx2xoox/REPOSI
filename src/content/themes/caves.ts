// Floor 2 theme "포자 동굴": damp teal caverns, flat stones in packed earth, moss,
// puddles, glowing fungi as light sources, dripping water and drifting spores.

import { defineTheme } from '../../game/defs';
import { defineThemeArt, paintDefaultRock, type WallGeo } from '../../game/roomart';
import { TILE } from '../../game/constants';
import { fx } from '../../engine/rng';
import type { PixelPainter } from '../../engine/painter';
import type { RNG } from '../../engine/rng';
import type { Room } from '../../game/room';
import { Drip } from '../props/ambient';
import { GlowShrooms } from '../props/lights';
import { wallHuggingTiles, wallPos, wallSlots } from '../props/prop';
import { decorateCommon, slotRoll } from './common';
import {
  addPx, blendPx, crack, hash2, moss, puddle, randomFloorPx, rampPick, shadePx, stain, vnoise, worley, type FloorTest,
} from './paint';

const F = ['#131d1b', '#1b2825', '#23332f', '#2c3f39', '#374d45', '#47604f'];
const ROCK = ['#141e1c', '#253731', '#3a5246', '#57715c', '#86a07e'];
const MOSS = ['#18342a', '#22503a', '#3a7a56'];
const GLOW = '#40e0c0';

function paintFloor(p: PixelPainter, tx: number, ty: number): void {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const X = tx * TILE + x;
      const Y = ty * TILE + y;
      const w = worley(X, Y, 13, 11, 41);
      const stone = w.id < 0.5;
      let s: number;
      if (stone) {
        // flat stones bedded in the earth: lit upper rim, dark seam
        const edge = w.d2 - w.d1;
        if (edge < 1.1) {
          p.px(x, y, F[0]);
          continue;
        }
        s = 3 + (w.id - 0.25) * 2 + (vnoise(X / 5, Y / 5, 2) - 0.5) * 0.8;
        if (edge < 2.2 && Y < w.fy) s += 0.9;
        else if (edge < 2.2) s -= 0.7;
      } else {
        // packed damp earth with grain
        s = 1.4 + (vnoise(X / 9, Y / 7, 5) - 0.5) * 1.4 + (hash2(X, Y, 1) - 0.5) * 0.9;
        if (hash2(X, Y, 4) < 0.025) s += 2; // pebbles
      }
      let c = rampPick(F, s, X, Y);
      const m = vnoise(X / 11, Y / 11, 77);
      if (!stone && m > 0.74) c = rampPick(MOSS, (m - 0.74) * 6 + (hash2(X, Y, 8) - 0.5), X, Y);
      p.px(x, y, c);
    }
  }
}

function paintRock(r: PixelPainter, rng: RNG, variant: number): void {
  if (variant === 3) {
    // stalagmite
    r.poly([2, 17, 5, 9, 7, 2, 9, 1, 11, 8, 14, 17], ROCK[2]);
    r.shadeSphere(7, 10, 7, 9, ROCK);
    r.line(8, 3, 8, 14, ROCK[3]);
    r.px(9, 2, ROCK[4]);
    r.line(5, 12, 11, 12, ROCK[1]);
    r.innerShadow(ROCK[0]);
    r.outline('#060c0c');
  } else {
    paintDefaultRock(r, { floor: F, wall: [], rock: ROCK, pit: '#000', accent: MOSS, dark: '#060c0c' }, rng, variant);
  }
  // moss cap on the top
  for (let x = 0; x < 16; x++) {
    let top = -1;
    for (let y = 0; y < 18; y++) if (r.isSet(x, y)) { top = y; break; }
    if (top < 0) continue;
    const depth = 1 + Math.floor(hash2(x, variant, 3) * 3);
    for (let k = 1; k <= depth; k++) if (r.isSet(x, top + k)) r.px(x, top + k, k === 1 ? MOSS[2] : MOSS[1]);
  }
  if (variant === 2) {
    // tiny glowing mushroom
    r.px(12, 4, '#c8d8c0');
    r.px(12, 5, '#c8d8c0');
    r.rect(11, 3, 3, 1, '#40e0c0');
    r.px(11, 3, '#c0fff0');
  }
}

function floorDecor(p: PixelPainter, room: Room, rng: RNG, isFloor: FloorTest): void {
  const cells = room.node.cw * room.node.ch;
  for (let i = 0; i < 1 + cells; i++) {
    const q = randomFloorPx(room, rng, isFloor, 14);
    if (q) puddle(p, isFloor, q.x, q.y, rng.range(5, 11), rng.range(3, 5), ['#0a1c1e', '#1e3a3a', '#5aa0a0'], rng.int(0, 99));
  }
  for (let i = 0; i < 1 + cells; i++) {
    const q = randomFloorPx(room, rng, isFloor, 6);
    if (q) moss(p, isFloor, q.x, q.y, rng.range(3, 6), MOSS, rng.int(0, 999));
  }
  for (let i = 0; i < 2 + cells; i++) {
    const q = randomFloorPx(room, rng, isFloor, 4);
    if (q) crack(p, isFloor, q.x, q.y, rng.int(5, 12), rng, F[0], F[4]);
  }
  for (let i = 0; i < cells; i++) {
    const q = randomFloorPx(room, rng, isFloor, 8);
    if (q) stain(p, isFloor, q.x, q.y, rng.range(6, 12), 0.35, rng.int(0, 999), '#0a2a24');
  }
  // spore dust glinting on the ground
  for (let i = 0; i < 18 * cells; i++) {
    const q = randomFloorPx(room, rng, isFloor, 2);
    if (q) addPx(p, q.x, q.y, GLOW, 0.22);
  }
}

function wallDecor(p: PixelPainter, room: Room, rng: RNG, g: WallGeo): void {
  // hanging roots from the rim down the top face
  const n = 7 * room.node.cw;
  for (let i = 0; i < n; i++) {
    let x = rng.range(g.X0, g.X1);
    let y = g.RY0 + 1;
    const len = rng.int(6, 20);
    const thick = rng.chance(0.3);
    for (let k = 0; k < len; k++) {
      p.px(x, y, k < 2 ? '#2a1e14' : '#3e2c1c');
      if (thick) p.px(x + 1, y, '#241810');
      if (rng.chance(0.15)) p.px(x - 1, y, '#5a422a');
      x += rng.range(-0.6, 0.6);
      y += 1;
      if (y >= g.Y0 - 1) break;
    }
  }
  // wet seeps: dark streaks with a shiny line
  for (const s of wallSlots(room)) {
    if (s.kind !== 'ornament' || s.face !== 'top') continue;
    if (slotRoll(room.node.seed, s) < 0.5) {
      const c = wallPos(room, 'top', s.along, 0.95);
      for (let y = Math.round(c.y); y < g.Y0; y++) {
        for (let dx = -2; dx <= 2; dx++) shadePx(p, c.x + dx + Math.sin(y * 0.4) * 0.6, y, 0.35);
        if (y % 3 === 0) blendPx(p, c.x, y, '#8ad0d0', 0.4);
      }
    } else {
      // fungus shelf
      const c = wallPos(room, 'top', s.along, 0.45);
      for (let k = 0; k < 3; k++) {
        const cx = Math.round(c.x) - 5 + k * 5;
        const cy = Math.round(c.y) - k * 2 + (k === 1 ? -2 : 0);
        p.rect(cx - 2, cy, 6, 1, '#2a8a74');
        p.rect(cx - 1, cy - 1, 4, 1, '#60e0c0');
        p.px(cx, cy - 1, '#d0fff4');
        p.rect(cx - 1, cy + 1, 4, 1, '#0e3a30');
      }
    }
  }
  // moss dripping over the rim
  for (let x = g.RX0; x < g.RX1; x++) {
    const m = vnoise(x / 7, 3, room.node.seed & 0xff);
    if (m < 0.55) continue;
    const len = Math.floor((m - 0.55) * 18);
    for (let k = 0; k < len; k++) blendPx(p, x, g.RY0 + k, k === 0 ? MOSS[2] : MOSS[1], 0.85 - k * 0.12);
  }
}

defineTheme({
  id: 'caves',
  name: '포자 동굴',
  palette: {
    floor: F,
    wall: ['#0c1414', '#182624', '#26383a', '#36504a'],
    rock: ROCK,
    pit: '#030c0c',
    accent: ['#2a6a5a', '#40a088', '#a0f0d0'],
    dark: '#060c0c',
  },
  ambient: '#82a29a',
  paintFloor: (p, tx, ty) => paintFloor(p, tx, ty),
  paintRock,
  decorate(w, rng) {
    const room = w.room;
    decorateCommon(w, rng, { light: 'shroom', sideLights: true, pitFx: 'water' });
    const spots = rng.shuffle(wallHuggingTiles(room));
    const n = rng.int(2, 2 + room.node.cw * room.node.ch);
    for (let i = 0; i < Math.min(n, spots.length); i++) {
      const s = spots[i];
      w.spawn(new GlowShrooms((s.tx + 0.5) * TILE, (s.ty + 0.5) * TILE, rng.int(3, 5)));
    }
    // dripping water from the top wall
    const g = { x0: 2 * TILE, x1: room.pxW - 2 * TILE };
    for (let i = 0; i < 1 + room.node.cw; i++) {
      const x = Math.round(rng.range(g.x0 + 12, g.x1 - 12));
      if (room.doors.some((d) => d.dir === 'N' && Math.abs(d.x - x) < 22)) continue;
      w.spawn(new Drip(x, 20, 2 * TILE + rng.range(8, 40)));
    }
  },
  ambientFx(w, dt) {
    const r = w.room;
    const area = r.node.cw * r.node.ch;
    if (fx.chance(dt * 6 * area)) {
      const glow = fx.chance(0.35);
      w.particles.spawn({
        x: r.interiorX + fx.next() * r.interiorW, y: r.interiorY + fx.next() * r.interiorH,
        vx: fx.range(-5, 5), vy: -fx.range(2, 8), life: fx.range(3, 6), drag: 0.2,
        colors: glow ? ['#b0fff0', GLOW, '#1a6a5a'] : ['#8ab8a0', '#4a7060'], size: 1, alpha: glow ? 0.9 : 0.5,
        additive: glow, light: glow && fx.chance(0.3) ? 7 : 0, lightColor: GLOW,
      });
    }
  },
});

defineThemeArt('caves', {
  wall: 'rough',
  face: ['#101a19', '#1a2a27', '#253a35', '#335048', '#4a6c60'],
  cap: ['#050a0a', '#0a1313', '#111e1d', '#284038'],
  mortar: '#070d0d',
  growth: ['#1a4834', '#2a7450', '#58b080'],
  pit: 'water',
  pitRamp: ['#062422', '#0c3634', '#155250', '#3a9a92'],
  door: { leaf: '#3a2a1a', metal: '#4a6a5a', inner: '#030807', frame: ['#0c1614', '#26382f', '#3e5a4a', '#6a8a72'] },
  spikes: { plate: '#162220', metal: ['#2a3a36', '#5a7468', '#9ab8a8', '#e0f4ea'] },
  block: ['#141e1c', '#2a3a36', '#46605a', '#6a8c82', '#a0c8b8'],
  pots: ['#6a7444', '#4e6a66'],
  paintFloorDecor: floorDecor,
  paintWallDecor: wallDecor,
});
