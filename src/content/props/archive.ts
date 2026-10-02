// Props of the drowned archive (floor 6): wall-mounted reading lamps that still burn
// under water, coral-crusted globes on stands, the bioluminescent glow + bubbles of
// flooded channels, and the drifting-page sprite used by the theme's ambient particles.

import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { TILE } from '../../game/constants';
import { Tile } from '../../game/tiles';
import { defineDrawnSprite, animFrame } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { hash2, type Face } from '../../game/roomart';
import { defineFlame } from './lights';
import { Prop } from './prop';

const O = '#070c12';

/** Archive accent colors shared by props, theme and enemies. */
export const ARCHIVE = {
  glow: '#5ae8f4',
  glowHot: '#d8ffff',
  glowLow: '#1a7a88',
  gold: '#c8a048',
  goldHot: '#f0dc9a',
  parchment: '#d8c8a0',
  parchmentHot: '#efe4c4',
  ink: '#06080c',
  indigo: '#1e2440',
  wood: ['#1a120c', '#2e1f14', '#45301e', '#5e452a', '#7a5c38'],
};

// ------------------------------------------------------------------ drifting pages
for (let v = 0; v < 3; v++) {
  defineDrawnSprite(`prop_page_${v}`, 5, 6, (p) => {
    p.rect(0, 0, 5, 6, ARCHIVE.parchment);
    p.rect(0, 0, 5, 1, ARCHIVE.parchmentHot);
    p.rect(4, 1, 1, 5, '#a89468');
    // a few lines of faded writing
    for (let y = 1 + (v % 2); y < 5; y += 2) p.rect(1, y, 2 + ((v + y) % 2), 1, '#5a5068');
    if (v === 2) p.px(3, 4, '#8a3a3a');
  }, { origin: [2, 3] });
}

/** Sprite name of a drifting page variant (for particles). */
export function pageSprite(v: number): string {
  return `prop_page_${((v % 3) + 3) % 3}`;
}

// ------------------------------------------------------------------ drowned lamp
defineFlame('prop_flame_drowned', [ARCHIVE.glowLow, ARCHIVE.glow, ARCHIVE.glowHot], 5, 9);
defineFlame('prop_flame_drowned_small', ['#1a6a78', '#4ad0e0', '#e0ffff'], 3, 5);

defineDrawnSprite('prop_lamp_drowned', 11, 16, (p) => {
  // iron arm from the wall + hanging ring
  p.rect(4, 0, 3, 2, '#3a3a48');
  p.rect(5, 2, 1, 2, '#2a2a36');
  p.px(4, 1, '#6a6a7a');
  // brass cap
  p.rect(2, 4, 7, 2, ARCHIVE.gold);
  p.rect(2, 4, 7, 1, ARCHIVE.goldHot);
  p.px(3, 5, '#8a6a28');
  // glass body (greenish, water inside: darker lower half with a surface line)
  p.rect(2, 6, 7, 8, '#4a9aa8');
  p.rect(3, 6, 5, 8, '#7ac8d4');
  p.rect(2, 10, 7, 4, '#2a6a7a');
  p.rect(3, 10, 5, 1, '#9ae8f0');
  p.rect(2, 6, 1, 8, '#2e6a78');
  p.rect(8, 6, 1, 8, '#2e6a78');
  p.px(3, 7, '#d8f8ff');
  p.px(3, 8, '#b0e8f0');
  // brass base
  p.rect(2, 14, 7, 2, ARCHIVE.gold);
  p.rect(3, 15, 5, 1, '#8a6a28');
  p.px(2, 14, ARCHIVE.goldHot);
}, { outline: O, origin: [5, 7] });

/** Reading lamp still burning under water: dim cyan flame, bubbles, soft light. */
export class DrownedLamp extends Prop {
  face: Face;
  flick = 0;
  constructor(x: number, y: number, face: Face = 'top') {
    super(x, y, 0);
    this.face = face;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    this.flick = Math.max(0, this.flick - dt);
    if (fx.chance(dt * 0.9)) {
      // a bubble escapes the glass
      w.particles.spawn({
        x: this.x + fx.range(-2, 2), y: this.y - 2, vy: -fx.range(6, 12), vx: fx.range(-2, 2), life: fx.range(0.8, 1.4),
        colors: ['#d8ffff', '#7ae0f0'], size: 1, alpha: 0.8, additive: true,
      });
    }
    if (fx.chance(dt * 0.25)) this.flick = fx.range(0.3, 0.7);
  }

  override draw(r: Renderer): void {
    r.sprite('prop_lamp_drowned', this.x, this.y);
    const gutter = this.flick > 0 ? 0.55 : 1;
    r.sprite(animFrame('prop_flame_drowned_small', this.age * 0.7), this.x, this.y + 6, { alpha: gutter, sy: gutter });
  }

  override light(w: World): void {
    const fl = (1 + Math.sin(this.age * 1.8) * 0.06 + Math.sin(this.age * 7.3) * 0.03) * (this.flick > 0 ? 0.72 : 1);
    w.lights.add(this.x, this.y + 2, 66 * fl, ARCHIVE.glow, { intensity: 0.72 });
    w.lights.glow(this.x, this.y + 3, 8, ARCHIVE.glow, 0.2 * fl);
  }
}

// ------------------------------------------------------------------ coral globe
defineDrawnSprite('prop_globe', 17, 28, (p) => {
  // wooden tripod stand
  p.rect(7, 18, 3, 7, ARCHIVE.wood[2]);
  p.rect(7, 18, 1, 7, ARCHIVE.wood[3]);
  p.line(8, 22, 3, 27, ARCHIVE.wood[2]);
  p.line(8, 22, 13, 27, ARCHIVE.wood[1]);
  p.rect(2, 26, 13, 2, ARCHIVE.wood[1]);
  p.rect(2, 26, 13, 1, ARCHIVE.wood[3]);
  // meridian ring (old gold)
  p.ring(8.5, 10, 8.2, 1.4, ARCHIVE.gold);
  // the globe: dark teal seas, parchment continents
  p.circle(8.5, 10, 6.6, '#1a4a58');
  p.shadeSphere(8.5, 10, 6.6, 6.6, ['#0c2a34', '#154452', '#1f6070', '#2c7e8c', '#4aa8b0'], { dither: false });
  for (const [x, y, w, h] of [[4, 8, 3, 2], [7, 6, 4, 2], [9, 12, 3, 2], [6, 11, 2, 1], [11, 9, 2, 2]] as [number, number, number, number][]) {
    p.rect(x, y, w, h, '#b8a888');
    p.px(x, y, '#d8c8a0');
  }
  p.px(5, 6, '#9ad8e0');
  // coral crust along the bottom-right + a polyp or two
  for (const [x, y] of [[11, 14], [12, 13], [13, 12], [10, 15], [13, 14], [14, 11]] as [number, number][]) p.px(x, y, '#5ab0a0');
  for (const [x, y] of [[12, 15], [11, 16], [14, 13]] as [number, number][]) p.px(x, y, '#8ae0c8');
  p.px(13, 15, '#e8dcb8');
  p.px(15, 12, '#e8dcb8');
  // ring highlights
  p.px(2, 6, ARCHIVE.goldHot);
  p.px(1, 10, ARCHIVE.goldHot);
  p.px(14, 16, '#7a5a20');
}, { outline: O, origin: [8, 27] });

/** Coral-encrusted globe on a stand against the wall; a glint wanders over the seas. */
export class CoralGlobe extends Prop {
  constructor(x: number, y: number) {
    super(x, y, 0);
  }

  override draw(r: Renderer): void {
    r.shadow(this.x, this.y + 1, 14, 4, 0.3);
    r.sprite('prop_globe', this.x, this.y);
    const g = (this.age * 0.35) % 3;
    if (g < 0.5) {
      const k = 1 - Math.abs(g - 0.25) / 0.25;
      r.rect(this.x - 4 + Math.floor(g * 8), this.y - 20, 1, 1, '#d8ffff', k);
    }
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 16, 22, '#4ab8c8', { intensity: 0.28 });
  }
}

// ------------------------------------------------------------------ flooded channel glow
/** Bioluminescent plankton in the flooded channels: a few dim cyan lights and rising bubbles. */
export class FloodGlow extends Prop {
  spots: { x: number; y: number; ph: number }[] = [];
  tiles: { x: number; y: number }[] = [];
  constructor(w: World) {
    super(0, 0, 0);
    const room = w.room;
    for (let ty = 2; ty < room.h - 2; ty++) {
      for (let tx = 2; tx < room.w - 2; tx++) {
        if (room.tileAt(tx, ty) !== Tile.PIT) continue;
        this.tiles.push({ x: tx * TILE, y: ty * TILE });
        if (hash2(tx, ty, 91) < 0.22) this.spots.push({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, ph: hash2(tx, ty, 93) * 6 });
      }
    }
    if (!this.spots.length && this.tiles.length) this.spots.push({ x: this.tiles[0].x + 8, y: this.tiles[0].y + 8, ph: 0 });
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (!this.tiles.length) return;
    if (fx.chance(this.tiles.length * dt * 0.12)) {
      const t = this.tiles[Math.floor(fx.next() * this.tiles.length)];
      const x = t.x + fx.range(3, 13);
      const y = t.y + fx.range(6, 14);
      // bubble: rises a little, then pops into a tiny ring
      w.particles.spawn({
        x, y, vy: -fx.range(3, 7), life: fx.range(0.5, 0.9), size: 1, colors: ['#bff8ff', '#6ad8e8'], alpha: 0.85, additive: true,
        gravity: 0,
      });
      if (fx.chance(0.3)) w.particles.spawn({ x, y: y - 2, life: 0.4, size: 1, sizeEnd: 3, colors: ['#8ae8f4'], shape: 'ring', alpha: 0.5, ground: true });
    }
  }

  override draw(r: Renderer): void {
    for (const s of this.spots) {
      const a = 0.5 + 0.5 * Math.sin(this.age * 1.4 + s.ph);
      if (a > 0.6) r.rect(s.x + Math.sin(s.ph) * 3, s.y + Math.cos(s.ph * 1.3) * 2, 1, 1, '#9af4ff', (a - 0.6) * 1.6);
    }
  }

  override light(w: World): void {
    for (const s of this.spots) {
      const k = 0.7 + 0.3 * Math.sin(this.age * 1.1 + s.ph);
      w.lights.add(s.x, s.y, 30 * k, '#2ab8cc', { intensity: 0.34 });
    }
  }
}
