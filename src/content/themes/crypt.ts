// Floor 1 theme "잊혀진 지하묘지": cold blue-grey flagstones, bone-strewn floors,
// cobwebbed corners, skull niches and warm torchlight.

import { defineTheme } from '../../game/defs';
import { defineThemeArt, paintDefaultRock, type WallGeo } from '../../game/roomart';
import { TILE } from '../../game/constants';
import { fx } from '../../engine/rng';
import type { PixelPainter } from '../../engine/painter';
import type { RNG } from '../../engine/rng';
import type { Room } from '../../game/room';
import { Banner } from '../props/ambient';
import { Candles } from '../props/lights';
import { wallHuggingTiles, wallPos } from '../props/prop';
import { wallSlots } from '../props/prop';
import { decorateCommon, slotRoll, MOUNT_T } from './common';
import {
  blendPx, bones, cobweb, crack, hash2, niche, randomFloorPx, rampPick, shadePx, skull, stain, vnoise, type FloorTest,
} from './paint';

const F = ['#191822', '#22212c', '#2c2b38', '#373644', '#444252', '#545266'];
const ROCK = ['#211f29', '#383644', '#545060', '#757186', '#a19db2'];
const BONE = ['#5a5446', '#a8a08a', '#e2dac6'];

function paintFloor(p: PixelPainter, tx: number, ty: number): void {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const X = tx * TILE + x;
      const Y = ty * TILE + y;
      const row = Math.floor(Y / 24);
      const offX = (row & 1) * 14;
      const sx = Math.floor((X + offX) / 28);
      let lx = X + offX - sx * 28;
      let ly = Y - row * 24;
      let sw = 28;
      let sh = 24;
      let id = hash2(sx, row, 7);
      // some slabs are split into four smaller stones
      if (id < 0.28) {
        const qx = lx >= 14 ? 1 : 0;
        const qy = ly >= 12 ? 1 : 0;
        lx -= qx * 14;
        ly -= qy * 12;
        sw = 14;
        sh = 12;
        id = hash2(sx * 2 + qx, row * 2 + qy, 9);
      }
      let c: string;
      if (lx === 0 || ly === 0) c = F[0];
      else {
        let s = 2.4 + (id - 0.5) * 1.1 + (vnoise(X / 7, Y / 7, 3) - 0.5) * 0.9 + (hash2(X, Y, 1) - 0.5) * 0.5;
        if (lx === 1 || ly === 1) s += 0.9; // lit bevel (top / left)
        if (lx === sw - 1 || ly === sh - 1) s -= 0.8;
        // worn, darker centre of big slabs
        if (sw === 28) s -= Math.max(0, 1 - Math.hypot(lx - 14, ly - 12) / 10) * 0.5;
        c = rampPick(F, s, X, Y);
        // hairline cracks inside slabs
        if (id > 0.82 && Math.abs(vnoise(X / 9, Y / 9, Math.floor(id * 99)) - 0.5) < 0.025) c = F[0];
      }
      p.px(x, y, c);
    }
  }
}

function paintRock(r: PixelPainter, rng: RNG, variant: number): void {
  if (variant === 2) {
    // broken tombstone
    r.rect(3, 6, 10, 12, ROCK[2]);
    r.ellipse(8, 6.5, 5, 4, ROCK[2]);
    r.shadeSphere(7, 8, 8, 10, ROCK);
    r.rect(3, 6, 1, 12, ROCK[3]);
    r.rect(12, 6, 1, 12, ROCK[1]);
    r.rect(5, 8, 6, 1, ROCK[0]);
    r.rect(5, 10, 6, 1, ROCK[0]);
    r.rect(5, 12, 4, 1, ROCK[0]);
    r.px(11, 4, ROCK[0]);
    r.px(10, 5, ROCK[0]);
    r.px(12, 5, ROCK[0]);
    r.rect(2, 16, 12, 2, ROCK[1]);
    r.rect(2, 16, 12, 1, ROCK[3]);
    r.outline('#0b0a10');
    return;
  }
  paintDefaultRock(r, { floor: F, wall: [], rock: ROCK, pit: '#000', accent: BONE, dark: '#0b0a10' }, rng, variant);
  if (variant === 3) {
    // a bone stuck in the rubble
    r.px(3, 14, BONE[2]);
    r.px(4, 13, BONE[1]);
    r.px(5, 12, BONE[1]);
    r.px(6, 12, BONE[2]);
  }
}

function floorDecor(p: PixelPainter, room: Room, rng: RNG, isFloor: FloorTest): void {
  const g = { x0: 32, y0: 32, x1: room.pxW - 32, y1: room.pxH - 32 };
  const cells = room.node.cw * room.node.ch;
  // cobwebs in some floor corners
  const corners: [number, number, number, number][] = [[g.x0, g.y0, 1, 1], [g.x1 - 1, g.y0, -1, 1], [g.x0, g.y1 - 1, 1, -1], [g.x1 - 1, g.y1 - 1, -1, -1]];
  for (const [x, y, sx, sy] of corners) if (rng.chance(0.55)) cobweb(p, x, y, sx, sy, rng.int(9, 15), '#b8b8cc', 0.42);
  for (let i = 0; i < 2 + cells * 2; i++) {
    const q = randomFloorPx(room, rng, isFloor, 4);
    if (q) crack(p, isFloor, q.x, q.y, rng.int(6, 16), rng, F[0], F[4]);
  }
  for (let i = 0; i < 1 + cells; i++) {
    const q = randomFloorPx(room, rng, isFloor, 10);
    if (q) stain(p, isFloor, q.x, q.y, rng.range(5, 10), 0.28, rng.int(0, 999));
  }
  for (let i = 0; i < 1 + cells; i++) {
    const q = randomFloorPx(room, rng, isFloor, 10);
    if (q) bones(p, isFloor, q.x, q.y, rng, BONE);
  }
  // moss creeping from the wall base
  for (let i = 0; i < cells * 2; i++) {
    const x = rng.range(g.x0 + 8, g.x1 - 8);
    const y = rng.chance(0.5) ? g.y0 + 1 : g.y1 - 2;
    for (let k = 0; k < 14; k++) {
      const xx = Math.round(x + rng.range(-7, 7));
      const yy = Math.round(y + (y < 100 ? rng.range(0, 4) : rng.range(-3, 0)));
      if (isFloor(Math.floor(xx / TILE), Math.floor(yy / TILE))) blendPx(p, xx, yy, '#3e4e44', 0.6);
    }
  }
}

function wallDecor(p: PixelPainter, room: Room, rng: RNG, g: WallGeo): void {
  const seed = room.node.seed;
  for (const s of wallSlots(room)) {
    if (s.kind !== 'ornament' || s.face !== 'top') continue;
    if (slotRoll(seed, s) < 0.5) continue; // banner slot (entity)
    const c = wallPos(room, 'top', s.along, MOUNT_T);
    const x = Math.round(c.x) - 4;
    const y = Math.round(c.y) - 7;
    niche(p, x, y, 9, 11, '#0e0d14', '#5a5670', '#121118');
    if (slotRoll(seed, s) > 0.75) {
      skull(p, x + 4, y + 5, BONE);
    } else {
      // candle stub in the niche
      p.rect(x + 3, y + 6, 2, 4, '#d8ccb0');
      p.px(x + 3, y + 5, '#ffb050');
      p.px(x + 4, y + 4, '#fff0b0');
      p.rect(x + 1, y + 10, 7, 1, '#b8ac90');
    }
  }
  // cracks in the bricks
  for (let i = 0; i < 4 * room.node.cw; i++) {
    let x = rng.range(g.X0 + 6, g.X1 - 6);
    let y = rng.range(g.RY0 + 4, g.Y0 - 3);
    for (let k = 0; k < rng.int(4, 9); k++) {
      shadePx(p, x, y, 0.45);
      x += rng.range(-1, 1);
      y += 1;
      if (y >= g.Y0) break;
    }
  }
  // cobwebs in the upper corners of the box
  if (rng.chance(0.7)) cobweb(p, g.RX0 + 1, g.RY0 + 1, 1, 1, 12, '#c8c8dc', 0.4);
  if (rng.chance(0.7)) cobweb(p, g.RX1 - 2, g.RY0 + 1, -1, 1, 12, '#c8c8dc', 0.4);
}

defineTheme({
  id: 'crypt',
  name: '잊혀진 지하묘지',
  palette: {
    floor: F,
    wall: ['#15141c', '#25232f', '#3a3746', '#504c5e'],
    rock: ROCK,
    pit: '#040308',
    accent: BONE,
    dark: '#0b0a10',
  },
  ambient: '#8a84a6',
  paintFloor: (p, tx, ty) => paintFloor(p, tx, ty),
  paintRock,
  decorate(w, rng) {
    const room = w.room;
    const orn = decorateCommon(w, rng, { light: 'torch', sideLights: true });
    for (const s of orn) {
      if (s.face !== 'top' || slotRoll(room.node.seed, s) >= 0.5) continue;
      const pos = wallPos(room, 'top', s.along, 0.97);
      w.spawn(new Banner(Math.round(pos.x), Math.round(pos.y), rng.pick(['#5a1a28', '#2a2a5a', '#3a1a3a']), '#c8a050'));
    }
    // candle clusters against the walls
    const spots = rng.shuffle(wallHuggingTiles(room));
    const n = rng.int(1, 1 + room.node.cw * room.node.ch);
    for (let i = 0; i < Math.min(n, spots.length); i++) {
      const s = spots[i];
      const off = s.side === 'top' ? [0, -4] : s.side === 'bottom' ? [0, 4] : s.side === 'left' ? [-4, 0] : [4, 0];
      w.spawn(new Candles((s.tx + 0.5) * TILE + off[0], (s.ty + 0.5) * TILE + off[1], rng.int(2, 4)));
    }
  },
  ambientFx(w, dt) {
    const r = w.room;
    if (fx.chance(dt * 4 * r.node.cw * r.node.ch)) {
      w.particles.spawn({
        x: r.interiorX + fx.next() * r.interiorW, y: r.interiorY + fx.next() * r.interiorH,
        vx: fx.range(-3, 3), vy: fx.range(-4, 1), life: fx.range(3, 6), colors: ['#a8a0c0', '#7a7290'], size: 1, alpha: 0.45,
      });
    }
  },
});

defineThemeArt('crypt', {
  wall: 'brick',
  face: ['#1c1a25', '#2a2836', '#393747', '#4b4859', '#666276'],
  cap: ['#0a090e', '#121118', '#1a1922', '#353345'],
  mortar: '#0f0e15',
  growth: ['#26302c', '#323e36', '#435244'],
  pit: 'chasm',
  pitRamp: ['#030206', '#0a0910', '#14131c', '#22212c'],
  door: { leaf: '#3e2c22', metal: '#62626e', inner: '#060509' },
  spikes: { plate: '#25232d', metal: ['#3a3a4a', '#6a6a7e', '#a8a8bc', '#eeeef8'] },
  block: ['#1e1d26', '#363546', '#55546a', '#7c7a94', '#b0aec6'],
  pots: ['#7a5a44', '#5e5a6a'],
  paintFloorDecor: floorDecor,
  paintWallDecor: wallDecor,
});
