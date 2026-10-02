// Floor 3 theme "잿불 대장간": riveted iron plates, soot, glowing lava fissures in
// the floor, lava pits, braziers, hanging chains, anvils and rising embers.

import { defineTheme } from '../../game/defs';
import { defineThemeArt, paintDefaultRock, type WallGeo } from '../../game/roomart';
import { TILE } from '../../game/constants';
import { Tile } from '../../game/tiles';
import { RNG, fx } from '../../engine/rng';
import type { PixelPainter } from '../../engine/painter';
import type { Room } from '../../game/room';
import { Chain, EmberVent } from '../props/ambient';
import { wallPos, wallSlots } from '../props/prop';
import { decorateCommon, slotRoll } from './common';
import {
  addPx, blendPx, glowCrack, hash2, randomFloorPx, rampPick, shadePx, stain, vnoise, type FloorTest,
} from './paint';

const F = ['#120e10', '#1b1517', '#251d1e', '#302626', '#3d302e', '#4e3e3a'];
const ROCK = ['#181212', '#2c2220', '#463632', '#665248', '#927c6c'];
const LAVA = ['#5a1008', '#c0300a', '#ff8020', '#ffe070'];

function paintFloor(p: PixelPainter, tx: number, ty: number): void {
  // 2x2-tile iron plates; some plates are grates with heat glowing below
  const plateX = Math.floor(tx / 2);
  const plateY = Math.floor(ty / 2);
  const id = hash2(plateX, plateY, 31);
  const grate = id < 0.12;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const X = tx * TILE + x;
      const Y = ty * TILE + y;
      const lx = X - plateX * 32;
      const ly = Y - plateY * 32;
      let c: string;
      if (lx === 0 || ly === 0) c = F[0];
      else if (grate && lx > 3 && lx < 29 && ly > 3 && ly < 29) {
        // grate slits with a red-hot glow below
        const slit = (lx - 4) % 4 === 3;
        if (slit) c = rampPick(['#1a0604', '#5a1408', '#a8300c'], 1 + Math.sin(ly * 0.4 + plateX) * 0.8, X, Y);
        else c = rampPick(F, 3 + (ly === 4 ? 1 : 0) - (ly === 28 ? 1 : 0), X, Y);
      } else {
        let s = 2.3 + (id - 0.5) * 1.2 + (vnoise(X / 14, Y * 0.9, 7) - 0.5) * 0.6 + (hash2(X, Y, 2) - 0.5) * 0.5;
        if (lx === 1 || ly === 1) s += 1;
        if (lx === 31 || ly === 31) s -= 0.9;
        // rivets
        const rx = lx === 3 || lx === 28;
        const ry = ly === 3 || ly === 28;
        if (rx && ry) s = 5;
        else if ((lx === 4 && ry) || (rx && ly === 4)) s = 0.5;
        // soot / rust blotches
        const n = vnoise(X / 8, Y / 8, 13);
        if (n > 0.7) s -= (n - 0.7) * 4;
        c = rampPick(F, s, X, Y);
        if (n < 0.18 && hash2(X, Y, 5) < 0.5) c = '#4a2418';
      }
      p.px(x, y, c);
    }
  }
}

function paintRock(r: PixelPainter, rng: RNG, variant: number): void {
  if (variant === 2) {
    // coal heap
    r.ellipse(8, 13, 7.5, 4.5, '#1e1a1c');
    r.ellipse(8, 10, 5, 4, '#1e1a1c');
    r.shadeSphere(7, 10, 8, 7, ['#0c0a0c', '#1a1618', '#2a2628', '#3e3a3e', '#6a6470']);
    for (let i = 0; i < 9; i++) r.pxIn(rng.int(3, 13), rng.int(7, 16), '#8a8494');
    r.pxIn(9, 13, '#ff6a20');
    r.pxIn(5, 14, '#c03010');
    r.outline('#0a0606');
    return;
  }
  paintDefaultRock(r, { floor: F, wall: [], rock: ROCK, pit: '#000', accent: LAVA, dark: '#0a0606' }, rng, variant);
  if (variant === 1 || variant === 3) {
    // glowing slag veins
    let x = 4 + rng.int(0, 2);
    let y = 9;
    for (let i = 0; i < 7; i++) {
      r.pxIn(x, y, i % 3 === 1 ? LAVA[3] : LAVA[2]);
      x += 1;
      y += rng.int(-1, 1);
    }
  } else {
    // metal ore glints
    r.pxIn(6, 9, '#d8c8a8');
    r.pxIn(10, 12, '#d8c8a8');
    r.pxIn(9, 8, '#a89878');
  }
}

/** Anvil on a stump: the forge's indestructible block. */
function paintBlock(b: PixelPainter): void {
  // stump
  b.rect(3, 11, 10, 7, '#4a3020');
  b.rect(3, 11, 10, 1, '#7a5434');
  for (let y = 12; y < 18; y += 2) b.px(5, y, '#2e1c12');
  b.px(10, 14, '#2e1c12');
  // anvil body
  b.rect(1, 3, 14, 4, '#3a3a44');
  b.rect(0, 3, 3, 2, '#3a3a44');
  b.rect(4, 7, 8, 2, '#2a2a32');
  b.rect(3, 9, 10, 2, '#3a3a44');
  b.rect(1, 3, 14, 1, '#9a9aaa');
  b.rect(0, 3, 3, 1, '#9a9aaa');
  b.rect(3, 9, 10, 1, '#6a6a7a');
  b.rect(4, 4, 9, 2, '#56566a');
  b.px(12, 4, '#ffffff');
  b.px(5, 5, '#ff8030');
  b.outline('#0a0606');
}

function paintPot(p: PixelPainter, variant: number): void {
  if (variant === 0) {
    // banded barrel
    p.rect(3, 4, 10, 13, '#6a4428');
    p.rect(2, 6, 12, 9, '#6a4428');
    p.shadeVertical(2, 4, 12, 13, ['#3a2414', '#5a3a20', '#7a5030', '#9a6a40']);
    for (let x = 2; x < 14; x++) for (let y = 4; y < 17; y++) if (p.isSet(x, y) && x % 3 === 0) p.px(x, y, '#4a2e1a');
    for (const y of [6, 13]) { p.rect(2, y, 12, 1, '#5a5a66'); p.rect(2, y + 1, 12, 1, '#2a2a32'); }
    p.ellipse(8, 4, 5, 1.5, '#8a6040');
    p.rect(5, 4, 6, 1, '#b08050');
  } else {
    // crucible with molten metal
    p.ellipse(8, 11, 6.5, 6, '#2e2a30');
    p.rect(2, 5, 12, 3, '#2e2a30');
    p.shadeSphere(8, 10, 7, 7, ['#121014', '#1e1a20', '#2e2a30', '#4a4450', '#7a7484']);
    p.ellipse(8, 5.5, 5, 1.6, '#ff7a20');
    p.rect(5, 5, 6, 1, '#ffe070');
    p.px(1, 7, '#4a4450');
    p.px(14, 7, '#2e2a30');
  }
  p.outline('#0a0606');
}

/** Lava fissures of a forge room (deterministic per room seed). */
function cracksFor(room: Room): { x: number; y: number; len: number; seed: number }[] {
  const rng = new RNG((room.node.seed ^ 0xf0f0) >>> 0);
  const n = 2 + room.node.cw * room.node.ch + rng.int(0, 1);
  const out: { x: number; y: number; len: number; seed: number }[] = [];
  const isFloor = (tx: number, ty: number) => room.tileAt(tx, ty) === Tile.FLOOR;
  for (let i = 0; i < n; i++) {
    const q = randomFloorPx(room, rng, isFloor, 18);
    if (!q) continue;
    out.push({ x: Math.round(q.x), y: Math.round(q.y), len: rng.int(14, 30), seed: rng.int(0, 1 << 20) });
  }
  return out;
}

function floorDecor(p: PixelPainter, room: Room, rng: RNG, isFloor: FloorTest): void {
  const cells = room.node.cw * room.node.ch;
  for (let i = 0; i < 2 + cells; i++) {
    const q = randomFloorPx(room, rng, isFloor, 10);
    if (q) stain(p, isFloor, q.x, q.y, rng.range(6, 13), 0.4, rng.int(0, 999));
  }
  for (const c of cracksFor(room)) glowCrack(p, isFloor, c.x, c.y, c.len, new RNG(c.seed), LAVA, 2);
  // scattered metal scraps / glints
  for (let i = 0; i < 6 * cells; i++) {
    const q = randomFloorPx(room, rng, isFloor, 3);
    if (!q) continue;
    p.px(q.x, q.y, '#6a6a76');
    p.px(q.x + 1, q.y, '#3a3a44');
    addPx(p, q.x, q.y - 1, '#ffffff', 0.15);
  }
  for (let i = 0; i < 10 * cells; i++) {
    const q = randomFloorPx(room, rng, isFloor, 2);
    if (q) addPx(p, q.x, q.y, '#ff6a20', 0.25);
  }
}

function wallDecor(p: PixelPainter, room: Room, rng: RNG, g: WallGeo): void {
  for (const s of wallSlots(room)) {
    if (s.kind !== 'ornament' || s.face !== 'top') continue;
    const c = wallPos(room, 'top', s.along, 0.5);
    const x = Math.round(c.x);
    const y = Math.round(c.y);
    if (slotRoll(room.node.seed, s) < 0.5) {
      // furnace mouth: arched opening with glowing coals
      for (let yy = -8; yy <= 6; yy++) {
        for (let xx = -7; xx <= 7; xx++) {
          const inArch = yy >= -2 ? Math.abs(xx) <= 6 : xx * xx + (yy + 2) * (yy + 2) <= 36;
          if (!inArch) continue;
          const inner = yy >= -1 ? Math.abs(xx) <= 4 : xx * xx + (yy + 1) * (yy + 1) <= 16;
          if (inner) p.px(x + xx, y + yy, rampPick(['#2a0804', '#7a1c08', '#d84a10', '#ffb040'], (yy + 2) / 2 + (hash2(xx, yy, 3) - 0.5), x + xx, y + yy));
          else p.px(x + xx, y + yy, rampPick(['#1a1416', '#2e2628', '#4a3e3e', '#6a5a56'], 1.5 + (xx < 0 ? 0.6 : -0.3) + (yy === -8 ? 1 : 0), x + xx, y + yy));
        }
      }
      for (let xx = -4; xx <= 4; xx += 2) p.px(x + xx, y + 4, '#ffe070');
      // soot above
      for (let yy = -16; yy < -8; yy++) for (let xx = -5; xx <= 5; xx++) shadePx(p, x + xx, y + yy, 0.3 * (1 - Math.abs(xx) / 6));
    } else {
      // tool rack: hammer + tongs silhouettes
      p.rect(x - 7, y - 6, 15, 1, '#4a3424');
      p.rect(x - 7, y - 5, 15, 1, '#2a1c14');
      p.rect(x - 5, y - 4, 1, 9, '#6a4a30');
      p.rect(x - 7, y + 3, 5, 3, '#5a5a66');
      p.rect(x - 7, y + 3, 5, 1, '#9a9aa8');
      p.line(x + 2, y - 4, x + 1, y + 6, '#5a5a66');
      p.line(x + 4, y - 4, x + 5, y + 6, '#5a5a66');
      p.px(x + 3, y - 3, '#9a9aa8');
    }
  }
  // heat shimmer streaks near the base
  for (let i = 0; i < 6 * room.node.cw; i++) {
    const x = rng.range(g.X0, g.X1);
    for (let k = 0; k < 4; k++) blendPx(p, x, g.Y0 - 1 - k, '#ff6a20', 0.35 - k * 0.08);
  }
  void vnoise;
}

defineTheme({
  id: 'forge',
  name: '잿불 대장간',
  palette: {
    floor: F,
    wall: ['#0e0a0b', '#1e1718', '#2e2626', '#443a38'],
    rock: ROCK,
    pit: '#2a0604',
    accent: ['#a03010', '#ff7020', '#ffd060'],
    dark: '#0a0606',
  },
  ambient: '#a08072',
  paintFloor: (p, tx, ty) => paintFloor(p, tx, ty),
  paintRock,
  decorate(w, rng) {
    const room = w.room;
    const orn = decorateCommon(w, rng, { light: 'brazier', sideLights: false, pitFx: 'lava' });
    // chains on the side walls and some ornament slots
    for (const s of orn) {
      if (s.face === 'top') continue;
      const pos = wallPos(room, s.face, s.along, 0.95);
      w.spawn(new Chain(Math.round(pos.x), Math.round(pos.y), rng.int(10, 16), rng.chance(0.6)));
    }
    for (const s of wallSlots(room)) {
      if (s.face === 'top' || s.kind !== 'light') continue;
      const pos = wallPos(room, s.face, s.along, 0.95);
      w.spawn(new Chain(Math.round(pos.x), Math.round(pos.y), rng.int(12, 18), true));
    }
    for (const c of cracksFor(room)) if (rng.chance(0.75)) w.spawn(new EmberVent(c.x, c.y));
  },
  ambientFx(w, dt) {
    const r = w.room;
    const area = r.node.cw * r.node.ch;
    if (fx.chance(dt * 7 * area)) {
      w.particles.spawn({
        x: r.interiorX + fx.next() * r.interiorW, y: r.interiorY + r.interiorH * fx.range(0.3, 1.05),
        vx: fx.range(-6, 6), vy: -fx.range(12, 30), life: fx.range(1.5, 3.2), drag: 0.3,
        colors: ['#fff0a0', '#ffa030', '#e04010', '#501008'], size: 1, additive: true, light: fx.chance(0.25) ? 6 : 0, lightColor: '#ff7a30',
      });
    }
    if (fx.chance(dt * 2 * area)) {
      w.particles.spawn({
        x: r.interiorX + fx.next() * r.interiorW, y: r.interiorY + fx.next() * r.interiorH * 0.5,
        vx: fx.range(-4, 4), vy: fx.range(4, 10), life: fx.range(3, 5), colors: ['#6a6060', '#3a3434'], size: 1, alpha: 0.6,
      });
    }
  },
});

defineThemeArt('forge', {
  wall: 'plate',
  face: ['#151112', '#231c1d', '#332a2a', '#463b39', '#625450'],
  cap: ['#070405', '#0f0a0b', '#171112', '#3a2c28'],
  mortar: '#090607',
  growth: ['#4a1e10', '#7a3418', '#a85a2a'],
  glow: '#ff6a1a',
  pit: 'lava',
  door: { frame: ['#100c0e', '#3a3236', '#6a5e60', '#a8988e'], leaf: '#2e2628', metal: '#b08a4a', inner: '#0a0404' },
  spikes: { plate: '#1e1616', metal: ['#3a2a2a', '#6a5050', '#b08070', '#ffd8a8'] },
  pots: ['#6a4428', '#2e2a30'],
  paintFloorDecor: floorDecor,
  paintWallDecor: wallDecor,
  paintBlock,
  paintPot,
});
