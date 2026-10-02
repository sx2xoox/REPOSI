// Floor 4 theme "얼어붙은 성소": polished ice tiles with shine, frosted ashlar walls,
// icicles, frozen worshippers, cold blue lanterns and falling snow.

import { defineTheme } from '../../game/defs';
import { defineThemeArt, type WallGeo } from '../../game/roomart';
import { TILE } from '../../game/constants';
import { fx } from '../../engine/rng';
import type { PixelPainter } from '../../engine/painter';
import type { RNG } from '../../engine/rng';
import type { Room } from '../../game/room';
import { FrozenStatue } from '../props/ambient';
import { Candles } from '../props/lights';
import { wallHuggingTiles, wallPos, wallSlots } from '../props/prop';
import { decorateCommon, slotRoll } from './common';
import {
  addPx, blendPx, crack, hash2, randomFloorPx, rampPick, rune, snowDrifts, stain, vnoise, type FloorTest,
} from './paint';

const F = ['#16243a', '#1e3049', '#283e5a', '#344e6e', '#456484', '#5c7e9e', '#86a8c4'];
const ROCK = ['#16284a', '#2a4874', '#4672a2', '#7aaad4', '#c4e6ff'];
const SNOW = ['#7a92b0', '#a8bcd4', '#d4e2f0', '#f4faff'];

function paintFloor(p: PixelPainter, tx: number, ty: number): void {
  // polished ice flagstones with an inlaid lozenge pattern and diagonal shine
  const checker = (tx + ty) & 1;
  const id = hash2(tx, ty, 17);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const X = tx * TILE + x;
      const Y = ty * TILE + y;
      let c: string;
      if (x === 0 || y === 0) c = F[1];
      else {
        let s = 3 + (checker ? 0.45 : -0.2) + (id - 0.5) * 0.6 + (vnoise(X / 10, Y / 10, 3) - 0.5) * 0.8;
        if (x === 1 || y === 1) s += 1.1;
        if (x === 15 || y === 15) s -= 0.7;
        // inlaid lozenge on alternate tiles
        const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
        if (checker && d > 5.5 && d < 6.6) s -= 1.2;
        else if (checker && d < 2) s += 0.6;
        // diagonal shine streaks
        const diag = (x + y + Math.floor(id * 9)) % 23;
        if (diag < 1.5) s += 1.6;
        else if (diag < 3) s += 0.7;
        c = rampPick(F, s, X, Y);
        // frost bloom
        const fr = vnoise(X / 6, Y / 6, 33);
        if (fr > 0.8) c = rampPick(F, 4.6 + (fr - 0.8) * 8 + (hash2(X, Y, 2) - 0.5), X, Y);
      }
      p.px(x, y, c);
    }
  }
}

function paintRock(r: PixelPainter, rng: RNG, variant: number): void {
  const K = ROCK;
  if (variant === 3) {
    // crystal cluster
    r.poly([2, 17, 3, 9, 5, 7, 7, 17], K[2]);
    r.poly([5, 17, 6, 4, 8, 1, 10, 4, 11, 17], K[3]);
    r.poly([9, 17, 11, 8, 13, 6, 14, 17], K[2]);
    r.line(8, 2, 8, 15, K[4]);
    r.line(4, 9, 4, 15, K[3]);
    r.line(12, 8, 12, 15, K[3]);
    r.line(10, 5, 10, 16, K[1]);
    r.px(7, 4, '#ffffff');
  } else {
    // faceted ice chunk
    const shapes = [
      [1, 17, 1, 9, 5, 4, 11, 3, 15, 8, 15, 17],
      [2, 17, 0, 11, 4, 5, 9, 2, 14, 6, 15, 17],
      [1, 17, 2, 7, 7, 3, 13, 5, 15, 11, 14, 17],
    ][variant % 3];
    r.poly(shapes, K[2]);
    // facets: top lit, right dark
    for (let y = 0; y < 18; y++) {
      for (let x = 0; x < 16; x++) {
        if (!r.isSet(x, y)) continue;
        const top = y < 8 + (x - 8) * 0.2;
        const right = x > 9 + (y - 8) * 0.3;
        r.px(x, y, top ? K[3] : right ? K[1] : K[2]);
      }
    }
    for (let i = 0; i < 3; i++) r.pxIn(4 + i * 2 + rng.int(0, 1), 5 + i, '#ffffff');
    r.line(4, 12, 8, 10, K[4]);
    r.line(9, 10, 10, 15, K[1]);
  }
  r.innerShadow(K[0]);
  r.outline('#081020');
}

function paintBlock(b: PixelPainter): void {
  // frozen block: translucent cube with a dark core
  b.rect(0, 0, 16, 18, '#4a80b8');
  b.rect(0, 0, 16, 8, '#8ac4f0');
  b.rect(1, 1, 14, 6, '#a8dcff');
  b.rect(0, 8, 16, 1, '#e8f8ff');
  b.rect(1, 9, 14, 8, '#3a6aa0');
  b.rect(4, 10, 8, 5, '#28508a');
  b.rect(1, 9, 1, 8, '#6aa0d0');
  b.line(2, 2, 6, 2, '#ffffff');
  b.px(12, 12, '#c8ecff');
  b.line(10, 10, 13, 15, '#8ac4f0');
  b.rect(0, 17, 16, 1, '#1e3a64');
  b.outline('#081020');
}

function paintPot(p: PixelPainter, variant: number): void {
  const base = variant ? '#7a8aac' : '#5a6a94';
  const k = variant ? ['#2a3450', '#4a5878', '#7a8aac', '#a8b8d4', '#e0ecff'] : ['#1e2848', '#34426a', '#5a6a94', '#8a9ac0', '#d0e0ff'];
  p.ellipse(8, 11.5, 6, 5.5, base);
  p.rect(5, 3, 6, 5, base);
  p.rect(4, 3, 8, 1, base);
  p.shadeSphere(8, 10, 6.5, 6.5, k);
  // snow cap + gold band
  p.rect(4, 2, 8, 2, '#f0f8ff');
  p.px(3, 3, '#d0e4f4');
  p.px(12, 3, '#d0e4f4');
  for (let x = 3; x <= 13; x++) p.pxIn(x, 10, '#c8a860');
  p.pxIn(8, 10, '#fff0b0');
  p.outline('#081020');
}

function floorDecor(p: PixelPainter, room: Room, rng: RNG, isFloor: FloorTest): void {
  const cells = room.node.cw * room.node.ch;
  snowDrifts(p, room, isFloor, SNOW, room.node.seed & 0xffff);
  for (let i = 0; i < 2 + cells * 2; i++) {
    const q = randomFloorPx(room, rng, isFloor, 4);
    if (q) crack(p, isFloor, q.x, q.y, rng.int(8, 18), rng, '#e8f6ff', undefined);
  }
  for (let i = 0; i < cells; i++) {
    const q = randomFloorPx(room, rng, isFloor, 12);
    if (q) stain(p, isFloor, q.x, q.y, rng.range(7, 12), 0.35, rng.int(0, 999), '#d8ecff');
  }
  if (rng.chance(0.35)) {
    const q = randomFloorPx(room, rng, isFloor, 30);
    if (q) rune(p, q.x, q.y, 14, '#8ac8ff', 0.45, rng.int(0, 5));
  }
  for (let i = 0; i < 14 * cells; i++) {
    const q = randomFloorPx(room, rng, isFloor, 2);
    if (q) addPx(p, q.x, q.y, '#ffffff', 0.35);
  }
}

function wallDecor(p: PixelPainter, room: Room, rng: RNG, g: WallGeo): void {
  // icicles hanging from the rim of the top wall (and a few on the sides)
  for (let x = g.RX0 + 2; x < g.RX1 - 2; x++) {
    if (hash2(x, 1, room.node.seed & 0xffff) > 0.22) continue;
    const len = 2 + Math.floor(hash2(x, 2, 5) * 7);
    const y0 = g.RY0 + 1;
    for (let k = 0; k < len; k++) {
      const c = k === 0 ? '#ffffff' : k < len - 1 ? '#bfe6ff' : '#7ab8e8';
      p.px(x, y0 + k, c);
      if (k < len / 2 && len > 4) p.px(x + 1, y0 + k, '#8ac4f0');
    }
  }
  // frosted windows / prayer plaques on ornament slots without a statue
  for (const s of wallSlots(room)) {
    if (s.kind !== 'ornament' || s.face !== 'top' || slotRoll(room.node.seed, s) < 0.45) continue;
    const c = wallPos(room, 'top', s.along, 0.55);
    const x = Math.round(c.x);
    const y = Math.round(c.y);
    for (let yy = -9; yy <= 5; yy++) {
      for (let xx = -5; xx <= 5; xx++) {
        const inW = yy >= -4 ? Math.abs(xx) <= 5 : xx * xx + (yy + 4) * (yy + 4) <= 25;
        if (!inW) continue;
        const edge = !(yy >= -3 ? Math.abs(xx) <= 4 && yy <= 4 : xx * xx + (yy + 4) * (yy + 4) <= 16);
        if (edge) p.px(x + xx, y + yy, '#c8a860');
        else p.px(x + xx, y + yy, rampPick(['#2a5a9a', '#4a8ad0', '#8ac8ff', '#e0f4ff'], 1.4 + (xx === 0 || yy === -1 ? 1.5 : 0) + (yy < -5 ? 0.6 : 0) + (hash2(xx, yy, 7) - 0.5), x + xx, y + yy));
      }
    }
  }
  // frost creeping on the wall base
  for (let x = g.X0; x < g.X1; x++) {
    const h = Math.floor(vnoise(x / 6, 9, 3) * 6);
    for (let k = 0; k < h; k++) blendPx(p, x, g.Y0 - 1 - k, '#e8f6ff', 0.5 - k * 0.08);
  }
  void rng;
}

defineTheme({
  id: 'sanctum',
  name: '얼어붙은 성소',
  palette: {
    floor: F,
    wall: ['#101a2c', '#1e3048', '#2e4a6a', '#4a6a90'],
    rock: ROCK,
    pit: '#040a1c',
    accent: ['#6a9ac8', '#a8d4f4', '#ffffff'],
    dark: '#081020',
  },
  ambient: '#96acc8',
  paintFloor: (p, tx, ty) => paintFloor(p, tx, ty),
  paintRock,
  decorate(w, rng) {
    const room = w.room;
    const orn = decorateCommon(w, rng, { light: 'ice', sideLights: true });
    for (const s of orn) {
      if (s.face !== 'top' || slotRoll(room.node.seed, s) >= 0.45) continue;
      const pos = wallPos(room, 'top', s.along, 0);
      w.spawn(new FrozenStatue(Math.round(pos.x), Math.round(pos.y) + 2));
    }
    if (rng.chance(0.5)) {
      const spots = rng.shuffle(wallHuggingTiles(room));
      if (spots.length) {
        const s = spots[0];
        w.spawn(new Candles((s.tx + 0.5) * TILE, (s.ty + 0.5) * TILE, rng.int(2, 4), true));
      }
    }
  },
  ambientFx(w, dt) {
    const r = w.room;
    const area = r.node.cw * r.node.ch;
    if (fx.chance(dt * 12 * area)) {
      w.particles.spawn({
        x: r.interiorX - 20 + fx.next() * (r.interiorW + 40), y: r.interiorY - 24 + fx.next() * r.interiorH * 0.9,
        vx: fx.range(4, 12), vy: fx.range(10, 22), life: fx.range(3, 6), drag: 0,
        colors: ['#ffffff', '#d8ecff'], size: fx.chance(0.2) ? 2 : 1, alpha: 0.75,
      });
    }
  },
});

defineThemeArt('sanctum', {
  wall: 'ice',
  face: ['#1a2a44', '#294066', '#3a5a86', '#5a82b0', '#a8d0f0'],
  cap: ['#2a3c58', '#4a6484', '#7a96b8', '#d8e8f8'],
  mortar: '#13203a',
  growth: ['#8ab0d0', '#c0dcf0', '#ffffff'],
  pit: 'ice',
  door: { frame: ['#1a2a42', '#4a6a90', '#8ab0d8', '#e0f4ff'], leaf: '#3a5a7a', metal: '#d8c890', inner: '#04081a' },
  spikes: { plate: '#1a2a40', metal: ['#4a7ab0', '#8ac0e8', '#c8ecff', '#ffffff'] },
  paintFloorDecor: floorDecor,
  paintWallDecor: wallDecor,
  paintBlock,
  paintPot,
});
