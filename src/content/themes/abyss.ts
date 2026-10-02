// Floor 5 theme "공허의 심장": fractured obsidian floating over nothing, violet void
// veins, missing wall blocks, watching eyes, drifting debris and starry pits.

import { defineTheme } from '../../game/defs';
import { defineThemeArt, wallGeo, type WallGeo } from '../../game/roomart';
import { RNG, fx } from '../../engine/rng';
import type { PixelPainter } from '../../engine/painter';
import type { Room } from '../../game/room';
import { FloatingDebris, WallEye } from '../props/ambient';
import { wallPos } from '../props/prop';
import { decorateCommon, slotRoll } from './common';
import {
  addPx, blendPx, glowCrack, hash2, randomFloorPx, rampPick, rune, shadePx, vnoise, worley, type FloorTest,
} from './paint';

const F = ['#0a0711', '#110c1a', '#181224', '#211930', '#2c213e', '#3b2c52'];
const ROCK = ['#0c0714', '#1c122e', '#30214a', '#4e3a76', '#8468b6'];
const VOID = ['#3a1070', '#7a30d0', '#c070ff', '#f0d8ff'];

function paintFloor(p: PixelPainter, tx: number, ty: number): void {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const X = tx * 16 + x;
      const Y = ty * 16 + y;
      const w = worley(X, Y, 15, 12, 91);
      const edge = w.d2 - w.d1;
      let c: string;
      if (edge < 1.2) {
        // gaps between the fractured plates: some glow faintly
        const gv = vnoise(X / 20, Y / 20, 5);
        c = gv > 0.66 ? rampPick(['#07030d', '#1e0a3c', '#44188a'], (gv - 0.66) * 9 + (1.2 - edge) , X, Y) : '#05030a';
      } else {
        let s = 2.4 + (w.id - 0.5) * 1.6 + (vnoise(X / 6, Y / 6, 7) - 0.5) * 0.7;
        if (edge < 2.4 && Y < w.fy) s += 1; // lit upper rim of each plate
        else if (edge < 2.4) s -= 0.9;
        // glossy streak
        if ((X - Y + Math.floor(w.id * 30)) % 17 === 0 && edge > 3) s += 1.2;
        c = rampPick(F, s, X, Y);
        if (hash2(X, Y, 3) < 0.004) c = '#b890ff';
      }
      p.px(x, y, c);
    }
  }
}

function paintRock(r: PixelPainter, rng: RNG, variant: number): void {
  const K = ROCK;
  // obsidian shards: sharp, glossy, with violet inner light
  const shapes = [
    [1, 17, 2, 8, 6, 2, 10, 5, 15, 9, 14, 17],
    [3, 17, 4, 6, 8, 0, 11, 7, 13, 17],
    [0, 17, 2, 10, 5, 7, 8, 9, 10, 3, 14, 8, 15, 17],
    [1, 17, 3, 5, 6, 8, 9, 2, 12, 6, 15, 17],
  ][variant % 4];
  r.poly(shapes, K[2]);
  for (let y = 0; y < 18; y++) {
    for (let x = 0; x < 16; x++) {
      if (!r.isSet(x, y)) continue;
      const lit = x + y * 0.4 < 9;
      r.px(x, y, rampPick(K, (lit ? 2.6 : 1.2) - y / 18 + (hash2(x, y, variant) - 0.5) * 0.6, x, y));
    }
  }
  r.rimLight(K[4]);
  // violet fracture glow
  let x = 5 + rng.int(0, 4);
  let y = 7;
  for (let i = 0; i < 6; i++) {
    r.pxIn(x, y, i % 2 ? VOID[2] : VOID[1]);
    x += rng.int(-1, 1);
    y += 1;
  }
  r.innerShadow(K[0]);
  r.outline('#05020a');
}

function paintBlock(b: PixelPainter): void {
  // void-bound cube: black stone wrapped in violet runes
  b.rect(0, 9, 16, 9, '#120a1e');
  b.rect(0, 0, 16, 9, '#2a1e40');
  b.rect(1, 1, 14, 7, '#1c1430');
  b.rect(0, 0, 16, 1, '#5a4680');
  b.rect(0, 8, 16, 1, '#5a4680');
  b.rect(1, 9, 14, 8, '#1a1028');
  for (const [x, y] of [[3, 12], [7, 11], [11, 13], [5, 15], [9, 15]] as [number, number][]) b.px(x, y, '#b070ff');
  b.line(3, 12, 7, 11, '#6a30c0');
  b.line(7, 11, 11, 13, '#6a30c0');
  b.rect(6, 3, 4, 3, '#b070ff');
  b.px(7, 4, '#ffffff');
  b.outline('#05020a');
}

function voidCracks(room: Room): { x: number; y: number; len: number; seed: number }[] {
  const rng = new RNG((room.node.seed ^ 0xabba) >>> 0);
  const isFloor = (tx: number, ty: number) => room.tileAt(tx, ty) === 0;
  const out: { x: number; y: number; len: number; seed: number }[] = [];
  for (let i = 0; i < 2 + room.node.cw * room.node.ch; i++) {
    const q = randomFloorPx(room, rng, isFloor, 14);
    if (q) out.push({ x: Math.round(q.x), y: Math.round(q.y), len: rng.int(12, 28), seed: rng.int(0, 1 << 20) });
  }
  return out;
}

function floorDecor(p: PixelPainter, room: Room, rng: RNG, isFloor: FloorTest): void {
  const cells = room.node.cw * room.node.ch;
  for (const c of voidCracks(room)) glowCrack(p, isFloor, c.x, c.y, c.len, new RNG(c.seed), VOID, 2);
  if (rng.chance(0.6)) {
    const q = randomFloorPx(room, rng, isFloor, 30);
    if (q) rune(p, q.x, q.y, rng.int(12, 18), '#9a50ff', 0.5, rng.int(0, 5));
  }
  for (let i = 0; i < 12 * cells; i++) {
    const q = randomFloorPx(room, rng, isFloor, 2);
    if (q) addPx(p, q.x, q.y, '#a060ff', 0.3);
  }
  // pools of darkness
  for (let i = 0; i < cells * 2; i++) {
    const q = randomFloorPx(room, rng, isFloor, 8);
    if (!q) continue;
    for (let k = 0; k < 40; k++) shadePx(p, q.x + rng.range(-8, 8), q.y + rng.range(-5, 5), 0.25);
  }
}

function wallDecor(p: PixelPainter, room: Room, rng: RNG, g: WallGeo): void {
  // tendrils of void crawling up the faces
  for (let i = 0; i < 6 * room.node.cw; i++) {
    let x = rng.range(g.X0 + 4, g.X1 - 4);
    let y = g.Y0 - 1;
    for (let k = 0; k < rng.int(5, 14); k++) {
      blendPx(p, x, y, k < 3 ? '#c070ff' : '#6a28b0', 0.75 - k * 0.04);
      x += rng.range(-1, 1);
      y -= 1;
      if (y < g.RY0) break;
    }
  }
  // stars over the caps
  for (let i = 0; i < 40 * room.node.cw * room.node.ch; i++) {
    const x = rng.range(0, g.W);
    const y = rng.range(0, g.H);
    if (x > g.RX0 && x < g.RX1 && y > g.RY0 && y < g.RY1) continue;
    addPx(p, x, y, rng.chance(0.3) ? '#ffffff' : '#8a5ad0', rng.range(0.2, 0.6));
  }
}

defineTheme({
  id: 'abyss',
  name: '공허의 심장',
  palette: {
    floor: F,
    wall: ['#07040c', '#140c20', '#221832', '#36264a'],
    rock: ROCK,
    pit: '#020104',
    accent: ['#5a2a9a', '#a050ff', '#e0b0ff'],
    dark: '#05020a',
  },
  ambient: '#86749e',
  paintFloor: (p, tx, ty) => paintFloor(p, tx, ty),
  paintRock,
  decorate(w, rng) {
    const room = w.room;
    const orn = decorateCommon(w, rng, { light: 'void', sideLights: true, pitFx: 'void' });
    for (const s of orn) {
      if (s.face !== 'top') continue;
      const pos = wallPos(room, 'top', s.along, 0.55);
      if (slotRoll(room.node.seed, s) < 0.6) w.spawn(new WallEye(Math.round(pos.x), Math.round(pos.y), slotRoll(room.node.seed, s) < 0.25));
    }
    // debris drifting over the wall tops
    const g = wallGeo(room);
    const n = 3 + room.node.cw + room.node.ch;
    for (let i = 0; i < n; i++) {
      const side = rng.int(0, 2);
      let x: number;
      let y: number;
      if (side === 0) { x = rng.range(g.X0, g.X1); y = rng.range(g.RY1 + 4, g.H - 6); }
      else if (side === 1) { x = rng.range(4, g.RX0 - 4); y = rng.range(g.Y0, g.Y1); }
      else { x = rng.range(g.RX1 + 4, g.W - 4); y = rng.range(g.Y0, g.Y1); }
      w.spawn(new FloatingDebris(Math.round(x), Math.round(y), rng.int(0, 2)));
    }
  },
  ambientFx(w, dt) {
    const r = w.room;
    const area = r.node.cw * r.node.ch;
    if (fx.chance(dt * 6 * area)) {
      w.particles.spawn({
        x: r.interiorX + fx.next() * r.interiorW, y: r.interiorY + fx.next() * r.interiorH,
        vx: fx.range(-3, 3), vy: -fx.range(4, 12), life: fx.range(2, 4), drag: 0.2,
        colors: ['#e0c0ff', '#9050f0', '#30106a'], size: 1, additive: true, alpha: 0.8,
      });
    }
    if (fx.chance(dt * 1.2 * area)) {
      // slow shadow wisp
      w.particles.spawn({
        x: r.interiorX + fx.next() * r.interiorW, y: r.interiorY + fx.next() * r.interiorH,
        vx: fx.range(-8, 8), vy: fx.range(-3, 3), life: fx.range(2, 3), size: 3, sizeEnd: 7, colors: ['#000000'], alpha: 0.18, shape: 'circle',
      });
    }
  },
});

defineThemeArt('abyss', {
  wall: 'void',
  face: ['#0d0915', '#181122', '#241a33', '#342647', '#54406e'],
  cap: ['#020104', '#06030b', '#0b0713', '#241838'],
  mortar: '#040208',
  glow: '#b060ff',
  pit: 'void',
  door: { frame: ['#0a0610', '#241a36', '#46345e', '#8a6ab8'], leaf: '#1e1428', metal: '#9a6ad0', inner: '#030106' },
  spikes: { plate: '#140c1e', metal: ['#2a1a40', '#5a3a8a', '#9a70d0', '#f0d8ff'] },
  pots: ['#3a2a5a', '#2a2a3a'],
  paintFloorDecor: floorDecor,
  paintWallDecor: wallDecor,
  paintBlock,
});

void vnoise;
