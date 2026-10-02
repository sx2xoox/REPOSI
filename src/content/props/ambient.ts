// Animated ambient props: banners, chains, drips, ember vents, frozen statues,
// watching eyes, floating debris, pit effects (lava / void / water) and door glows.

import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { Door, DoorKind } from '../../game/room';
import { TILE } from '../../game/constants';
import { Tile } from '../../game/tiles';
import { defineDrawnSprite, getSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';
import { fx } from '../../engine/rng';
import { clamp } from '../../engine/math';
import { hash2 } from '../../game/roomart';
import { Prop } from './prop';

const O = '#0c0810';

// ------------------------------------------------------------------ banner
const bannerDefs = new Set<string>();
function bannerSprite(cloth: string, emblem: string): string {
  const name = `prop_banner_${cloth}_${emblem}`;
  if (bannerDefs.has(name)) return name;
  bannerDefs.add(name);
  defineDrawnSprite(name, 11, 20, (p) => {
    const k = ramp(cloth, 4);
    p.rect(0, 0, 11, 2, '#3a2a1e');
    p.rect(0, 0, 11, 1, '#6a4e34');
    p.px(0, 1, '#c8a060');
    p.px(10, 1, '#c8a060');
    for (let y = 2; y < 20; y++) {
      for (let x = 1; x < 10; x++) {
        // tattered bottom edge
        const cut = 15 + ((x * 7) % 4) + (x % 3 === 0 ? 2 : 0);
        if (y > cut) continue;
        const sh = x === 1 ? 3 : x === 9 ? 0 : x >= 7 ? 1 : 2;
        p.px(x, y, k[sh]);
      }
    }
    // lantern emblem
    p.rect(4, 6, 3, 1, emblem);
    p.rect(4, 7, 3, 4, emblem);
    p.px(5, 8, '#fff6d0');
    p.px(5, 9, '#ffd060');
    p.rect(4, 11, 3, 1, emblem);
    p.px(5, 5, emblem);
    // trims
    for (let y = 3; y < 14; y += 2) p.px(2, y, k[3]);
  }, { outline: O, origin: [5, 0] });
  return name;
}

/** Cloth banner hanging from the top of a wall face, swaying gently. */
export class Banner extends Prop {
  sprite: string;
  constructor(x: number, y: number, cloth = '#6a1a2a', emblem = '#c8a050') {
    super(x, y, 0);
    this.sprite = bannerSprite(cloth, emblem);
  }

  override draw(r: Renderer): void {
    const s = getSprite(this.sprite);
    const ctx = r.ctx;
    const x0 = Math.round(this.x - s.ox - r.viewX);
    const y0 = Math.round(this.y - s.oy - r.viewY);
    for (let row = 0; row < s.h; row++) {
      const k = row / s.h;
      const off = Math.round(Math.sin(this.age * 1.5 + row * 0.22) * k * 1.3);
      ctx.drawImage(s.canvas, 0, row, s.w, 1, x0 + off, y0 + row, s.w, 1);
    }
  }
}

// ------------------------------------------------------------------ chain
/** Iron chain hanging from the wall top, slowly swinging; optional hook. */
export class Chain extends Prop {
  len: number;
  hook: boolean;
  constructor(x: number, y: number, len = 18, hook = true) {
    super(x, y, 0);
    this.len = len;
    this.hook = hook;
  }

  override draw(r: Renderer): void {
    const a = Math.sin(this.age * 1.1) * 0.07;
    const sx = Math.sin(a);
    const cy = Math.cos(a);
    for (let i = 0; i < this.len; i += 3) {
      const x = this.x + sx * i;
      const y = this.y + cy * i;
      const vertical = (i / 3) % 2 === 0;
      if (vertical) {
        r.rect(x - 1, y, 3, 3, '#14101a');
        r.rect(x - 1, y, 1, 3, '#7a7484');
        r.rect(x + 1, y, 1, 3, '#4a4454');
      } else {
        r.rect(x, y, 1, 3, '#8a8494');
      }
    }
    if (this.hook) {
      const x = this.x + sx * this.len;
      const y = this.y + cy * this.len;
      r.rect(x - 1, y, 2, 3, '#6a6474');
      r.rect(x + 1, y + 2, 1, 2, '#6a6474');
      r.rect(x - 2, y + 3, 2, 1, '#9a94a4');
    }
  }
}

// ------------------------------------------------------------------ water drip
/** Water drips falling from a wall onto the floor, splashing (caves). */
export class Drip extends Prop {
  floorY: number;
  timer: number;
  constructor(x: number, y: number, floorY: number) {
    super(x, y, 0);
    this.floorY = floorY;
    this.timer = fx.range(0.5, 3);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = fx.range(1.6, 4);
    const fy = this.floorY;
    w.particles.spawn({
      x: this.x, y: fy, z: fy - this.y, vz: 0, gravity: 380, life: 3, colors: ['#bff4ff'], size: 1, shape: 'square', bounce: 0,
      onLand: (x, y) => {
        w.particles.burst(x, y, { count: 4, speed: [10, 30], life: [0.2, 0.4], colors: ['#d0faff', '#60b0c0'], size: [1, 1], gravity: 200, vz: [20, 50] });
        w.particles.spawn({ x, y, life: 0.45, size: 1, sizeEnd: 6, colors: ['#9ae0f0'], shape: 'ring', alpha: 0.6, ground: true });
      },
    });
  }

  override draw(r: Renderer): void {
    // wet streak + gathering droplet
    const grow = clamp(1 - this.timer / 1.2, 0, 1);
    r.rect(this.x, this.y - 3, 1, 3, '#2a4a50', 0.6);
    if (grow > 0.2) r.rect(this.x, this.y, 1, 1 + Math.round(grow), '#bff4ff', 0.9);
  }
}

// ------------------------------------------------------------------ ember vent
/** Glowing floor crack that breathes and spits embers (forge). */
export class EmberVent extends Prop {
  constructor(x: number, y: number) {
    super(x, y, 0);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (fx.chance(dt * 2.2)) {
      w.particles.spawn({
        x: this.x + fx.range(-5, 5), y: this.y, vx: fx.range(-6, 6), vy: -fx.range(18, 40), life: fx.range(0.6, 1.4), drag: 0.6,
        colors: ['#fff0a0', '#ffa030', '#c03010'], size: 1, additive: true, light: 6, lightColor: '#ff8030',
      });
    }
  }

  override light(w: World): void {
    const k = 0.8 + 0.2 * Math.sin(this.age * 1.7);
    w.lights.add(this.x, this.y, 34 * k, '#ff6a20', { intensity: 0.75 });
  }
}

// ------------------------------------------------------------------ pit effects
/** Animated surface + light for lava / void / water pits of a room. */
export class PitFx extends Prop {
  kind: 'lava' | 'void' | 'water';
  tiles: { x: number; y: number; h: number }[] = [];
  lightsAt: { x: number; y: number }[] = [];
  constructor(w: World, kind: 'lava' | 'void' | 'water') {
    super(0, 0, 0);
    this.kind = kind;
    const room = w.room;
    for (let ty = 2; ty < room.h - 2; ty++) {
      for (let tx = 2; tx < room.w - 2; tx++) {
        if (room.tileAt(tx, ty) !== Tile.PIT) continue;
        this.tiles.push({ x: tx * TILE, y: ty * TILE, h: hash2(tx, ty, 77) });
        if ((tx + ty * 3) % 3 === 0) this.lightsAt.push({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
      }
    }
    if (this.lightsAt.length === 0 && this.tiles.length) this.lightsAt.push({ x: this.tiles[0].x + 8, y: this.tiles[0].y + 8 });
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (!this.tiles.length) return;
    const rate = this.tiles.length * dt * (this.kind === 'lava' ? 0.35 : 0.15);
    if (fx.chance(rate)) {
      const t = this.tiles[Math.floor(fx.next() * this.tiles.length)];
      const x = t.x + fx.range(3, 13);
      const y = t.y + fx.range(7, 14);
      if (this.kind === 'lava') {
        w.particles.burst(x, y, { count: 3, speed: [8, 24], life: [0.3, 0.6], colors: ['#fff0a0', '#ff9020'], size: [1, 1], gravity: 220, vz: [40, 80], additive: true });
        if (fx.chance(0.4)) w.particles.spawn({ x, y, vx: fx.range(-4, 4), vy: -fx.range(20, 40), life: fx.range(0.8, 1.6), colors: ['#ffd060', '#ff6020', '#601008'], size: 1, additive: true, light: 5, lightColor: '#ff7020' });
      } else if (this.kind === 'void') {
        w.particles.spawn({ x, y, vx: fx.range(-3, 3), vy: -fx.range(6, 16), life: fx.range(1, 2.2), colors: ['#d8b0ff', '#8040e0', '#30106a'], size: 1, additive: true });
      } else {
        w.particles.spawn({ x, y, life: 0.7, size: 1, sizeEnd: 5, colors: ['#8ad0d8'], shape: 'ring', alpha: 0.45, ground: true });
      }
    }
  }

  override draw(r: Renderer): void {
    const t = this.age;
    for (const tile of this.tiles) {
      for (let i = 0; i < 3; i++) {
        const ph = tile.h * 20 + i * 2.1;
        const a = Math.sin(t * (this.kind === 'lava' ? 1.6 : 2.4) + ph);
        if (a < 0.35) continue;
        const x = tile.x + 3 + Math.floor(hash2(i, Math.floor(tile.h * 1000), 3) * 10);
        const y = tile.y + 6 + Math.floor(hash2(i, Math.floor(tile.h * 1000), 5) * 8);
        if (this.kind === 'lava') r.rect(x, y, 2, 1, '#fff0a0', (a - 0.35) * 0.9);
        else if (this.kind === 'void') r.rect(x, y, 1, 1, i === 0 ? '#ffffff' : '#c090ff', (a - 0.35) * 1.4);
        else r.rect(x, y, 2, 1, '#c8f4ff', (a - 0.35) * 0.6);
      }
    }
  }

  override light(w: World): void {
    if (this.kind === 'water') return;
    const col = this.kind === 'lava' ? '#ff6a1a' : '#8a3ae0';
    const k = 0.85 + 0.15 * Math.sin(this.age * 1.3);
    for (const l of this.lightsAt) w.lights.add(l.x, l.y, (this.kind === 'lava' ? 46 : 34) * k, col, { intensity: this.kind === 'lava' ? 0.8 : 0.55 });
  }
}

// ------------------------------------------------------------------ frozen statue
defineDrawnSprite('prop_frozen_statue', 16, 30, (p) => {
  // plinth
  p.rect(1, 25, 14, 5, '#5a6a80');
  p.rect(1, 25, 14, 1, '#9ab0c8');
  p.rect(1, 29, 14, 1, '#3a4a60');
  // praying hooded figure (stone)
  p.ellipse(8, 6, 4, 4.2, '#8a96a8');
  p.poly([3, 25, 4, 11, 8, 8, 12, 11, 13, 25], '#7a86a0');
  p.rect(6, 12, 4, 5, '#9aa6b8');
  p.px(7, 11, '#b8c4d4');
  p.px(8, 11, '#b8c4d4');
  p.ellipse(8, 6.5, 2.4, 2.6, '#3a4458');
  p.rect(4, 18, 8, 1, '#5a6680');
  p.rect(5, 21, 6, 1, '#5a6680');
  // ice shell
  for (let y = 1; y < 25; y++) {
    for (let x = 1; x < 15; x++) {
      const inShell = ((x - 8) * (x - 8)) / 49 + ((y - 13) * (y - 13)) / 160 <= 1;
      if (!inShell) continue;
      if (!p.isSet(x, y)) p.px(x, y, (x + y) % 5 === 0 ? '#c8ecff' : '#8ac8f0');
    }
  }
  p.line(3, 4, 5, 1, '#ffffff');
  p.line(2, 8, 2, 14, '#e8f8ff');
  p.px(12, 6, '#ffffff');
  p.line(13, 15, 13, 20, '#c8ecff');
}, { outline: '#0c1428', origin: [8, 29] });

/** Hooded worshipper frozen in a shell of ice, standing against the wall (sanctum). */
export class FrozenStatue extends Prop {
  constructor(x: number, y: number) {
    super(x, y, 0);
  }

  override draw(r: Renderer): void {
    r.sprite('prop_frozen_statue', this.x, this.y);
    const g = (this.age * 0.5) % 4;
    if (g < 0.4) {
      const k = 1 - Math.abs(g - 0.2) / 0.2;
      r.rect(this.x + 3, this.y - 24, 1, 3, '#ffffff', k);
      r.rect(this.x + 2, this.y - 23, 3, 1, '#ffffff', k);
    }
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 12, 26, '#8ac8ff', { intensity: 0.35 });
  }
}

// ------------------------------------------------------------------ watching eye
/** An eye embedded in the wall that follows the player and blinks (abyss). */
export class WallEye extends Prop {
  blinkT: number;
  big: boolean;
  constructor(x: number, y: number, big = false) {
    super(x, y, 0);
    this.big = big;
    this.blinkT = fx.range(1, 5);
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    this.blinkT -= dt;
    if (this.blinkT < -0.18) this.blinkT = fx.range(2, 6);
  }

  override draw(r: Renderer, w: World): void {
    const rx = this.big ? 5 : 3;
    const ry = this.big ? 3 : 2;
    const x = this.x;
    const y = this.y;
    // socket
    r.rect(x - rx - 1, y - ry, rx * 2 + 3, ry * 2 + 1, '#0a0410');
    r.rect(x - rx, y - ry - 1, rx * 2 + 1, ry * 2 + 3, '#0a0410');
    const closed = this.blinkT < 0;
    if (closed) {
      r.rect(x - rx, y, rx * 2 + 1, 1, '#6a2a7a');
      return;
    }
    r.rect(x - rx, y - ry + 1, rx * 2 + 1, ry * 2 - 1, '#e8d8e0');
    r.rect(x - rx + 1, y - ry, rx * 2 - 1, ry * 2 + 1, '#e8d8e0');
    r.rect(x - rx, y + ry - 1, rx * 2 + 1, 1, '#a090a8');
    // pupil tracks the player
    const p = w.player;
    const dx = clamp((p.x - x) / 80, -1, 1);
    const dy = clamp((p.y - y) / 80, -1, 1);
    const px = Math.round(x + dx * (rx - 1.5));
    const py = Math.round(y + dy * (ry - 1));
    r.rect(px - 1, py - 1, 3, 3, '#a02a6a');
    r.rect(px, py - 1, 1, 3, '#14000c');
    r.rect(px - 1, py, 3, 1, '#14000c');
    r.rect(px - 1, py - 1, 1, 1, '#ffffff');
  }

  override light(w: World): void {
    if (this.blinkT >= 0) w.lights.add(this.x, this.y, this.big ? 22 : 14, '#c04080', { intensity: 0.4 });
  }
}

// ------------------------------------------------------------------ floating debris
for (let v = 0; v < 3; v++) {
  defineDrawnSprite(`prop_debris_${v}`, 9, 7, (p) => {
    const pts = [
      [1, 2, 4, 0, 8, 2, 7, 6, 2, 6],
      [0, 3, 3, 0, 7, 1, 8, 5, 3, 6],
      [2, 1, 6, 0, 8, 4, 5, 6, 0, 5],
    ][v];
    p.poly(pts, '#2a1e3a');
    p.shadeSphere(4, 3, 5, 4, ['#120a1c', '#22183a', '#3a2a5a', '#5a4a80']);
    p.rimLight('#8a6ac0');
  }, { outline: '#06020c', origin: [4, 3] });
}

/** Chunks of rock drifting weightlessly over the wall tops (abyss). */
export class FloatingDebris extends Prop {
  v: number;
  ph: number;
  constructor(x: number, y: number, v: number) {
    super(x, y, 0);
    this.v = v % 3;
    this.ph = fx.range(0, 6);
  }

  override draw(r: Renderer): void {
    const bob = Math.sin(this.age * 0.9 + this.ph) * 2;
    const sway = Math.sin(this.age * 0.4 + this.ph) * 1.5;
    r.shadow(this.x, this.y + 7, 7, 2, 0.25);
    r.sprite(`prop_debris_${this.v}`, this.x + sway, this.y + bob);
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y + 4, 16, '#7a3ad0', { intensity: 0.35 });
  }
}

// ------------------------------------------------------------------ light shaft
/** Soft column of light from above (where the player dropped in). */
export class LightShaft extends Prop {
  color: string;
  constructor(x: number, y: number, color = '#c8d8ff') {
    super(x, y, 2);
    this.color = color;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (fx.chance(dt * 4)) {
      w.particles.spawn({ x: this.x + fx.range(-14, 14), y: this.y - fx.range(0, 40), vx: fx.range(-2, 2), vy: fx.range(3, 8), life: 2, colors: ['#ffffff'], size: 1, alpha: 0.5 });
    }
  }

  override draw(r: Renderer): void {
    const ctx = r.ctx;
    const x = Math.round(this.x - r.viewX);
    const y = Math.round(this.y - r.viewY);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const a = 0.07 + 0.02 * Math.sin(this.age * 0.8);
    for (let i = 0; i < 4; i++) {
      ctx.globalAlpha = a;
      ctx.fillStyle = this.color;
      const w0 = 10 + i * 4;
      const w1 = 18 + i * 5;
      ctx.beginPath();
      ctx.moveTo(x - w0, y - 90);
      ctx.lineTo(x + w0, y - 90);
      ctx.lineTo(x + w1, y);
      ctx.lineTo(x - w1, y);
      ctx.fill();
    }
    ctx.globalAlpha = 0.12;
    ctx.beginPath();
    ctx.ellipse(x, y, 26, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 4, 70, this.color, { intensity: 0.5, squash: 0.6 });
  }
}

// ------------------------------------------------------------------ door glow
const DOOR_GLOW: Partial<Record<DoorKind, { color: string; parts: string[]; rate: number }>> = {
  treasure: { color: '#ffc840', parts: ['#fff6c0', '#ffd040'], rate: 3 },
  shop: { color: '#ffd870', parts: ['#fff0b0'], rate: 0.8 },
  boss: { color: '#ff3020', parts: ['#ff8060', '#c01010', '#400404'], rate: 5 },
  challenge: { color: '#d0d8ff', parts: ['#ffffff', '#a0a8c8'], rate: 1 },
  shrine: { color: '#6a9aff', parts: ['#e0ecff', '#7aa8ff'], rate: 2.5 },
  curse: { color: '#c03a90', parts: ['#ff90d0', '#a02070', '#300820'], rate: 4 },
  secret: { color: '#9a7aff', parts: ['#d8c8ff'], rate: 0.6 },
};

/** Colored light and motes around a special-room doorway. */
export class DoorGlow extends Prop {
  door: Door;
  constructor(door: Door) {
    super(door.x, door.y, 0);
    this.door = door;
  }

  private inward(): { x: number; y: number } {
    const d = this.door;
    const v = d.dir === 'N' ? [0, 1] : d.dir === 'S' ? [0, -1] : d.dir === 'W' ? [1, 0] : [-1, 0];
    return { x: v[0], y: v[1] };
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const g = DOOR_GLOW[this.door.kind];
    if (!g || this.door.state === 'hidden') return;
    if (fx.chance(dt * g.rate)) {
      const n = this.inward();
      const side = fx.range(-12, 12);
      const x = this.door.x + (n.y !== 0 ? side : -n.x * fx.range(2, 14));
      const y = this.door.y + (n.x !== 0 ? side : -n.y * fx.range(2, 20));
      w.particles.spawn({
        x, y, vx: n.x * fx.range(4, 12) + fx.range(-3, 3), vy: n.y * fx.range(4, 12) - fx.range(2, 8), life: fx.range(0.8, 1.6),
        colors: g.parts, size: 1, additive: true,
      });
    }
  }

  override light(w: World): void {
    const g = DOOR_GLOW[this.door.kind];
    if (!g || this.door.state === 'hidden') return;
    const n = this.inward();
    const k = 0.85 + 0.15 * Math.sin(this.age * 2.3);
    w.lights.add(this.door.x + n.x * 6, this.door.y + n.y * 6 - (n.y === 0 ? 4 : 0), 44 * k, g.color, { intensity: this.door.kind === 'secret' ? 0.35 : 0.6 });
  }
}
