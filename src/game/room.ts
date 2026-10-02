// A room instance: tile grid, doors, cached background rendering and decals.

import { CELL_H, CELL_W, TILE, WALL, roomTileSize, type Dir } from './constants';
import { Tile, TEMPLATE_LEGEND, tileProps } from './tiles';
import type { RoomNode } from './dungeon';
import type { RoomTemplate, ThemeDef } from './defs';
import type { World } from './world';
import type { Renderer } from '../engine/renderer';
import { RNG } from '../engine/rng';
import { PixelPainter, bayer, darken, lighten } from '../engine/painter';
import { defineDrawnSprite, hasSprite } from '../engine/sprites';
import { clamp } from '../engine/math';

export type DoorKind = 'normal' | 'treasure' | 'shop' | 'boss' | 'secret' | 'challenge' | 'shrine' | 'curse' | 'start';
export type DoorState = 'open' | 'closed' | 'locked' | 'hidden';

export interface Door {
  dir: Dir;
  /** the two wall tiles of the doorway */
  tiles: [number, number][];
  /** pixel position of the doorway center at the inner wall edge */
  x: number;
  y: number;
  to: number;
  kind: DoorKind;
  state: DoorState;
  /** 0 = closed .. 1 = open (animated) */
  open: number;
  secret: boolean;
}

export interface SpawnMarker {
  ch: string;
  x: number;
  y: number;
}

export class Room {
  readonly node: RoomNode;
  readonly theme: ThemeDef;
  readonly w: number;
  readonly h: number;
  readonly pxW: number;
  readonly pxH: number;
  readonly tiles: Uint8Array;
  readonly tileHp: Float32Array;
  readonly variant: Uint8Array;
  doors: Door[] = [];
  /** template markers (enemy spawns, pedestals ...) in pixel coords */
  markers: SpawnMarker[] = [];
  /** incremented when tiles change (pathfinding cache key) */
  version = 0;
  private bg: HTMLCanvasElement | null = null;
  private bgDirty = true;
  decals: HTMLCanvasElement | null = null;
  private doorTile = new Map<number, Door>();
  readonly rng: RNG;

  constructor(node: RoomNode, theme: ThemeDef, template: RoomTemplate | undefined) {
    this.node = node;
    this.theme = theme;
    const size = roomTileSize(node.cw, node.ch);
    this.w = size.w;
    this.h = size.h;
    this.pxW = this.w * TILE;
    this.pxH = this.h * TILE;
    this.tiles = new Uint8Array(this.w * this.h);
    this.tileHp = new Float32Array(this.w * this.h);
    this.variant = new Uint8Array(this.w * this.h);
    this.rng = new RNG(node.seed);
    for (let i = 0; i < this.variant.length; i++) this.variant[i] = this.rng.int(0, 255);
    // walls
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const wall = x < WALL || y < WALL || x >= this.w - WALL || y >= this.h - WALL;
        this.tiles[y * this.w + x] = wall ? Tile.WALL : Tile.FLOOR;
      }
    }
    if (template) this.applyTemplate(template);
  }

  private applyTemplate(t: RoomTemplate): void {
    const iw = CELL_W * this.node.cw;
    const ih = CELL_H * this.node.ch;
    for (let y = 0; y < Math.min(ih, t.rows.length); y++) {
      const row = t.rows[y];
      for (let x = 0; x < Math.min(iw, row.length); x++) {
        const ch = row[x];
        const tx = x + WALL;
        const ty = y + WALL;
        const tile = TEMPLATE_LEGEND[ch];
        if (tile !== undefined) {
          this.setTileRaw(tx, ty, tile);
        } else if (ch !== ' ') {
          this.markers.push({ ch, x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
        }
      }
    }
  }

  // ------------------------------------------------------------ geometry
  get interiorX(): number { return WALL * TILE; }
  get interiorY(): number { return WALL * TILE; }
  get interiorW(): number { return (this.w - WALL * 2) * TILE; }
  get interiorH(): number { return (this.h - WALL * 2) * TILE; }
  get centerX(): number { return this.pxW / 2; }
  get centerY(): number { return this.pxH / 2; }

  inside(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h;
  }

  tileAt(tx: number, ty: number): number {
    if (!this.inside(tx, ty)) return Tile.WALL;
    return this.tiles[ty * this.w + tx];
  }

  tileAtPx(x: number, y: number): number {
    return this.tileAt(Math.floor(x / TILE), Math.floor(y / TILE));
  }

  private setTileRaw(tx: number, ty: number, t: number): void {
    const i = ty * this.w + tx;
    this.tiles[i] = t;
    this.tileHp[i] = tileProps(t).hp;
  }

  setTile(tx: number, ty: number, t: number): void {
    if (!this.inside(tx, ty)) return;
    this.setTileRaw(tx, ty, t);
    this.version++;
    this.bgDirty = true;
  }

  doorAtTile(tx: number, ty: number): Door | undefined {
    return this.doorTile.get(ty * this.w + tx);
  }

  /** Is the tile at (tx,ty) blocking for a mover with the given abilities? */
  blocks(tx: number, ty: number, flying: boolean, phasing: boolean): boolean {
    const t = this.tileAt(tx, ty);
    if (t === Tile.DOOR) {
      const d = this.doorAtTile(tx, ty);
      return !d || d.state !== 'open' || d.open < 0.6;
    }
    const p = tileProps(t);
    if (t === Tile.WALL) return true;
    if (t === Tile.PIT) return !flying;
    if (!p.solid) return false;
    if (phasing) return false;
    return true;
  }

  /** AABB (center x,y, half size r) overlaps a blocking tile? */
  boxBlocked(x: number, y: number, r: number, flying: boolean, phasing: boolean): boolean {
    const x0 = Math.floor((x - r) / TILE);
    const x1 = Math.floor((x + r - 0.001) / TILE);
    const y0 = Math.floor((y - r) / TILE);
    const y1 = Math.floor((y + r - 0.001) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (this.blocks(tx, ty, flying, phasing)) return true;
      }
    }
    return false;
  }

  /** Line of sight for shots (rocks/walls block, pits don't). */
  lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(d / 6);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const tile = this.tileAtPx(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      if (tileProps(tile).blocksShots) return false;
    }
    return true;
  }

  /** Is (x,y) a free floor position for a ground entity of radius r? */
  isFree(x: number, y: number, r = 6): boolean {
    if (this.boxBlocked(x, y, r, false, false)) return false;
    const t = this.tileAtPx(x, y);
    return t === Tile.FLOOR || t === Tile.RUBBLE;
  }

  /** Random free interior floor position. */
  randomFreePos(rng: RNG, r = 6, avoid?: { x: number; y: number; dist: number }): { x: number; y: number } {
    for (let i = 0; i < 200; i++) {
      const x = this.interiorX + r + rng.next() * (this.interiorW - r * 2);
      const y = this.interiorY + r + rng.next() * (this.interiorH - r * 2);
      if (!this.isFree(x, y, r)) continue;
      if (avoid && Math.hypot(x - avoid.x, y - avoid.y) < avoid.dist) continue;
      return { x, y };
    }
    return { x: this.centerX, y: this.centerY };
  }

  /** Nearest free position to (x,y) (spiral search on tiles). */
  nearestFree(x: number, y: number, r = 6): { x: number; y: number } {
    if (this.isFree(x, y, r)) return { x, y };
    const tx0 = Math.floor(x / TILE);
    const ty0 = Math.floor(y / TILE);
    for (let rad = 1; rad < 20; rad++) {
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
          const px = (tx0 + dx + 0.5) * TILE;
          const py = (ty0 + dy + 0.5) * TILE;
          if (this.isFree(px, py, r)) return { x: px, y: py };
        }
      }
    }
    return { x: this.centerX, y: this.centerY };
  }

  // ------------------------------------------------------------ doors
  addDoor(dir: Dir, cellX: number, cellY: number, to: number, kind: DoorKind, secret: boolean): Door {
    // cellX/cellY are relative to the node (0..cw-1, 0..ch-1)
    let tiles: [number, number][];
    let x: number;
    let y: number;
    const midX = WALL + cellX * CELL_W + Math.floor(CELL_W / 2);
    const midY = WALL + cellY * CELL_H + Math.floor(CELL_H / 2);
    switch (dir) {
      case 'N': tiles = [[midX, 0], [midX, 1]]; x = (midX + 0.5) * TILE; y = WALL * TILE; break;
      case 'S': tiles = [[midX, this.h - 1], [midX, this.h - 2]]; x = (midX + 0.5) * TILE; y = (this.h - WALL) * TILE; break;
      case 'W': tiles = [[0, midY], [1, midY]]; x = WALL * TILE; y = (midY + 0.5) * TILE; break;
      case 'E': tiles = [[this.w - 1, midY], [this.w - 2, midY]]; x = (this.w - WALL) * TILE; y = (midY + 0.5) * TILE; break;
    }
    const door: Door = { dir, tiles, x, y, to, kind, state: secret ? 'hidden' : 'open', open: secret ? 0 : 1, secret };
    if (!secret) {
      for (const [tx, ty] of tiles) {
        this.tiles[ty * this.w + tx] = Tile.DOOR;
        this.doorTile.set(ty * this.w + tx, door);
      }
    }
    // keep the tile in front of the door clear of obstacles
    const inX = dir === 'W' ? WALL : dir === 'E' ? this.w - WALL - 1 : tiles[0][0];
    const inY = dir === 'N' ? WALL : dir === 'S' ? this.h - WALL - 1 : tiles[0][1];
    const front = this.tileAt(inX, inY);
    if (front !== Tile.FLOOR && front !== Tile.SPIKES) this.setTileRaw(inX, inY, Tile.FLOOR);
    if (this.tileAt(inX, inY) === Tile.SPIKES) this.setTileRaw(inX, inY, Tile.FLOOR);
    this.doors.push(door);
    this.bgDirty = true;
    return door;
  }

  /** Reveal a secret door (bombed). */
  revealDoor(d: Door): void {
    if (!d.secret || d.state !== 'hidden') return;
    d.state = 'open';
    for (const [tx, ty] of d.tiles) {
      this.tiles[ty * this.w + tx] = Tile.DOOR;
      this.doorTile.set(ty * this.w + tx, d);
    }
    this.version++;
    this.bgDirty = true;
  }

  setDoorsClosed(closed: boolean): void {
    for (const d of this.doors) {
      if (d.state === 'hidden' || d.state === 'locked') continue;
      d.state = closed ? 'closed' : 'open';
    }
    this.version++;
  }

  updateDoors(dt: number): void {
    for (const d of this.doors) {
      const target = d.state === 'open' ? 1 : 0;
      d.open = clamp(d.open + (target > d.open ? dt * 6 : -dt * 8), 0, 1);
    }
  }

  // ------------------------------------------------------------ tile damage
  /** Damage a breakable tile (pots) — called by projectiles/melee. */
  damageTile(w: World, tx: number, ty: number, dmg: number): void {
    const t = this.tileAt(tx, ty);
    if (!tileProps(t).breakable) return;
    const i = ty * this.w + tx;
    this.tileHp[i] -= dmg;
    w.particles.burst((tx + 0.5) * TILE, (ty + 0.5) * TILE, { count: 3, speed: [20, 50], life: [0.2, 0.4], colors: this.theme.palette.accent, size: [1, 2] });
    if (this.tileHp[i] <= 0) this.destroyTile(w, tx, ty, 'shot');
  }

  /** Destroy an obstacle tile (rocks by bombs, pots by anything). */
  destroyTile(w: World, tx: number, ty: number, cause: 'bomb' | 'shot' | 'other'): void {
    const t = this.tileAt(tx, ty);
    const p = tileProps(t);
    if (cause === 'bomb' ? !p.bombable : !p.breakable) return;
    const cx = (tx + 0.5) * TILE;
    const cy = (ty + 0.5) * TILE;
    this.setTile(tx, ty, Tile.RUBBLE);
    w.onTileDestroyed(t, tx, ty, cx, cy);
  }

  // ------------------------------------------------------------ rendering
  markDirty(): void {
    this.bgDirty = true;
  }

  ensureDecals(): HTMLCanvasElement {
    if (!this.decals) {
      this.decals = document.createElement('canvas');
      this.decals.width = this.pxW;
      this.decals.height = this.pxH;
    }
    return this.decals;
  }

  drawBackground(r: Renderer): void {
    if (!this.bg || this.bgDirty) {
      this.bg = renderRoomBackground(this);
      this.bgDirty = false;
    }
    r.ctx.drawImage(this.bg, -r.viewX, -r.viewY);
    if (this.decals) r.ctx.drawImage(this.decals, -r.viewX, -r.viewY);
  }

  /** Doors are drawn every frame (animated). */
  drawDoors(r: Renderer, time: number): void {
    for (const d of this.doors) drawDoor(r, this, d, time);
  }
}

// ======================================================================
// Default procedural room renderer (themes can override per-tile painters)
// ======================================================================

function renderRoomBackground(room: Room): HTMLCanvasElement {
  const p = new PixelPainter(room.pxW, room.pxH);
  const pal = room.theme.palette;
  const rng = new RNG(room.node.seed ^ 0x5151);
  const tileP = new PixelPainter(TILE, TILE);

  for (let ty = 0; ty < room.h; ty++) {
    for (let tx = 0; tx < room.w; tx++) {
      const t = room.tileAt(tx, ty);
      const v = room.variant[ty * room.w + tx];
      const trng = new RNG((room.node.seed * 31 + tx * 977 + ty * 7919) >>> 0);
      tileP.clear();
      if (t === Tile.WALL || t === Tile.DOOR) {
        const face = wallFace(room, tx, ty);
        if (room.theme.paintWall) room.theme.paintWall(tileP, tx, ty, trng, face);
        else paintDefaultWall(tileP, pal, tx, ty, trng, face);
      } else {
        if (room.theme.paintFloor) room.theme.paintFloor(tileP, tx, ty, trng);
        else paintDefaultFloor(tileP, pal, tx, ty, trng, v);
      }
      p.blit(tileP, tx * TILE, ty * TILE);
    }
  }

  // ambient occlusion: shadow under the top wall and beside side walls
  const ix0 = WALL * TILE;
  const iy0 = WALL * TILE;
  const ix1 = room.pxW - WALL * TILE;
  const iy1 = room.pxH - WALL * TILE;
  for (let y = iy0; y < iy0 + 10; y++) {
    const k = 1 - (y - iy0) / 10;
    for (let x = ix0; x < ix1; x++) if (bayer(x, y) < k * 0.85) p.px(x, y, darken(pal.floor[0], 0.35));
  }
  for (let x = ix0; x < ix0 + 5; x++) {
    const k = 1 - (x - ix0) / 5;
    for (let y = iy0; y < iy1; y++) if (bayer(x, y) < k * 0.6) p.px(x, y, darken(pal.floor[0], 0.3));
  }
  for (let x = ix1 - 5; x < ix1; x++) {
    const k = (x - (ix1 - 5)) / 5;
    for (let y = iy0; y < iy1; y++) if (bayer(x, y) < k * 0.6) p.px(x, y, darken(pal.floor[0], 0.3));
  }

  // obstacles
  for (let ty = WALL; ty < room.h - WALL; ty++) {
    for (let tx = WALL; tx < room.w - WALL; tx++) {
      const t = room.tileAt(tx, ty);
      const v = room.variant[ty * room.w + tx];
      const px = tx * TILE;
      const py = ty * TILE;
      switch (t) {
        case Tile.PIT: paintPit(p, room, tx, ty, pal); break;
        case Tile.ROCK: p.blit(getRockPainter(room.theme, v % 3, false), px, py - 2); break;
        case Tile.SKULL_ROCK: p.blit(getRockPainter(room.theme, 3, false), px, py - 2); break;
        case Tile.TINTED: p.blit(getRockPainter(room.theme, v % 3, true), px, py - 2); break;
        case Tile.BLOCK: p.blit(getBlockPainter(room.theme), px, py - 2); break;
        case Tile.POT: p.blit(getPotPainter(room.theme, v % 2), px, py - 2); break;
        case Tile.SPIKES: paintSpikes(p, px, py); break;
        case Tile.RUBBLE: paintRubble(p, px, py, pal, rng); break;
      }
    }
  }
  return p.toCanvas();
}

function wallFace(room: Room, tx: number, ty: number): 'top' | 'front' | 'side' | 'bottom' | 'corner' {
  const left = tx < WALL;
  const right = tx >= room.w - WALL;
  const top = ty < WALL;
  const bottom = ty >= room.h - WALL;
  if ((left || right) && (top || bottom)) return 'corner';
  if (top) return ty === WALL - 1 ? 'front' : 'top';
  if (bottom) return 'bottom';
  return 'side';
}

export function paintDefaultFloor(p: PixelPainter, pal: { floor: string[]; accent: string[]; dark: string }, tx: number, ty: number, rng: RNG, v: number): void {
  const f = pal.floor;
  const base = f[Math.min(f.length - 1, 2)];
  p.rect(0, 0, TILE, TILE, base);
  // big stone slabs: 2x2 tiles with grout lines
  const slabX = tx % 2 === 0;
  const slabY = ty % 2 === 0;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const n = rng.next();
      if (n < 0.08) p.px(x, y, f[1]);
      else if (n < 0.12) p.px(x, y, f[3] ?? f[2]);
    }
  }
  if (slabX) for (let y = 0; y < TILE; y++) p.px(0, y, f[0]);
  if (slabY) for (let x = 0; x < TILE; x++) p.px(x, 0, f[0]);
  if (slabX) for (let y = 1; y < TILE; y++) p.px(1, y, f[3] ?? f[2]);
  if (slabY) for (let x = 1; x < TILE; x++) p.px(x, 1, f[3] ?? f[2]);
  // occasional cracks / pebbles / accents
  if (v < 26) {
    let x = rng.int(3, 12);
    let y = rng.int(3, 12);
    for (let i = 0; i < 6; i++) {
      p.px(x, y, f[0]);
      x += rng.int(-1, 1);
      y += rng.int(0, 1);
    }
  } else if (v < 40) {
    const x = rng.int(3, 12);
    const y = rng.int(3, 12);
    p.px(x, y, pal.accent[1] ?? pal.accent[0]);
    p.px(x + 1, y, pal.accent[0]);
    p.px(x, y + 1, f[0]);
  }
}

function paintDefaultWall(p: PixelPainter, pal: { wall: string[]; dark: string }, tx: number, ty: number, rng: RNG, face: string): void {
  const w = pal.wall;
  if (face === 'front') {
    // brick face
    p.rect(0, 0, TILE, TILE, w[2]);
    const off = (ty + Math.floor(tx / 1)) % 2 ? 8 : 0;
    for (let row = 0; row < 4; row++) {
      const y = row * 4;
      for (let x = 0; x < TILE; x++) p.px(x, y, w[1]);
      const o = (row % 2 ? off + 4 : off) % 8;
      for (let x = o; x < TILE; x += 8) for (let yy = y; yy < y + 4; yy++) p.px(x, yy, w[1]);
      for (let x = 0; x < TILE; x++) if (rng.chance(0.15)) p.px(x, y + 1, w[3] ?? w[2]);
    }
    for (let x = 0; x < TILE; x++) { p.px(x, TILE - 1, w[0]); p.px(x, TILE - 2, w[1]); }
  } else if (face === 'top' || face === 'corner' || face === 'side' || face === 'bottom') {
    p.rect(0, 0, TILE, TILE, w[0]);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) if (rng.chance(0.1)) p.px(x, y, w[1]);
    // top-surface rim lines facing the room interior
    if (face === 'top') for (let x = 0; x < TILE; x++) p.px(x, TILE - 1, w[3] ?? w[2]);
    if (face === 'bottom' && ty > 0) {
      // inner edge visible at the top of the bottom wall
    }
  }
}

function paintPit(p: PixelPainter, room: Room, tx: number, ty: number, pal: { pit: string; floor: string[]; dark: string }): void {
  const px = tx * TILE;
  const py = ty * TILE;
  p.rect(px, py, TILE, TILE, pal.pit);
  const above = room.tileAt(tx, ty - 1) !== Tile.PIT;
  const left = room.tileAt(tx - 1, ty) !== Tile.PIT;
  const right = room.tileAt(tx + 1, ty) !== Tile.PIT;
  const below = room.tileAt(tx, ty + 1) !== Tile.PIT;
  // inner cliff face where the floor above ends
  if (above) {
    p.rect(px, py, TILE, 6, darken(pal.floor[1], 0.35));
    for (let x = 0; x < TILE; x++) {
      p.px(px + x, py, pal.floor[3] ?? pal.floor[2]);
      if (bayer(x, 5) < 0.5) p.px(px + x, py + 5, darken(pal.floor[1], 0.55));
    }
  }
  if (left) for (let y = 0; y < TILE; y++) p.px(px, py + y, pal.floor[1]);
  if (right) for (let y = 0; y < TILE; y++) p.px(px + TILE - 1, py + y, pal.floor[1]);
  if (below) for (let x = 0; x < TILE; x++) p.px(px + x, py + TILE - 1, pal.floor[3] ?? pal.floor[2]);
}

function paintSpikes(p: PixelPainter, px: number, py: number): void {
  p.rect(px + 1, py + 1, TILE - 2, TILE - 2, '#2a2430');
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const sx = px + 2 + i * 3 + (j % 2);
      const sy = py + 3 + j * 3;
      p.px(sx, sy - 2, '#e8e8f0');
      p.px(sx, sy - 1, '#a8a8b8');
      p.px(sx - 1, sy, '#6a6a7a');
      p.px(sx, sy, '#8a8a9a');
      p.px(sx + 1, sy, '#4a4a5a');
    }
  }
}

function paintRubble(p: PixelPainter, px: number, py: number, pal: { rock: string[]; floor: string[] }, rng: RNG): void {
  for (let i = 0; i < 5; i++) {
    const x = px + rng.int(2, 13);
    const y = py + rng.int(4, 13);
    p.px(x, y, pal.rock[1]);
    p.px(x + 1, y, pal.rock[2] ?? pal.rock[1]);
    p.px(x, y + 1, pal.rock[0]);
  }
}

const rockCache = new Map<string, PixelPainter>();
function getRockPainter(theme: ThemeDef, variant: number, tinted: boolean): PixelPainter {
  const key = `${theme.id}:${variant}:${tinted}`;
  let r = rockCache.get(key);
  if (r) return r;
  r = new PixelPainter(TILE, TILE + 2);
  const pal = theme.palette;
  const rng = new RNG(variant * 977 + 13);
  if (theme.paintRock) {
    theme.paintRock(r, rng, variant);
  } else {
    const rk = pal.rock;
    if (variant === 3) {
      // skull rock
      r.ellipse(8, 10, 7, 6.5, rk[2]);
      r.shadeSphere(8, 10, 7, 6.5, rk);
      r.ellipse(5.5, 9.5, 1.6, 2, '#1a1418');
      r.ellipse(10.5, 9.5, 1.6, 2, '#1a1418');
      r.rect(7, 12, 2, 2, '#1a1418');
    } else {
      const rx = 7 - (variant === 2 ? 1 : 0);
      const ry = 6 + (variant === 1 ? 0.5 : 0);
      r.ellipse(8, 10.5, rx, ry, rk[2]);
      if (variant === 1) r.ellipse(11, 7.5, 3.5, 3, rk[2]);
      if (variant === 2) r.ellipse(5, 8, 3.5, 3.5, rk[2]);
      r.shadeSphere(8, 9.5, rx + 1, ry + 1, rk);
      // cracks
      r.line(5 + variant, 9, 7 + variant, 12, rk[0]);
      r.px(9, 7, lighten(rk[rk.length - 1], 0.3));
    }
    if (tinted) {
      // glowing marking
      r.line(6, 9, 10, 9, '#ffe680');
      r.line(8, 7, 8, 12, '#ffe680');
      r.px(8, 9, '#ffffff');
    }
    r.outline(pal.dark);
  }
  rockCache.set(key, r);
  return r;
}

let blockCache: Map<string, PixelPainter> = new Map();
function getBlockPainter(theme: ThemeDef): PixelPainter {
  let b = blockCache.get(theme.id);
  if (b) return b;
  b = new PixelPainter(TILE, TILE + 2);
  b.rect(0, 2, 16, 16, '#3a3a48');
  b.rect(0, 0, 16, 14, '#6a6a7c');
  b.rect(1, 1, 14, 12, '#8a8a9e');
  b.rect(2, 2, 12, 10, '#7a7a8e');
  for (const [x, y] of [[2, 2], [13, 2], [2, 11], [13, 11]]) b.px(x, y, '#c8c8d8');
  b.rect(0, 14, 16, 4, '#4a4a5a');
  b.outline(theme.palette.dark);
  blockCache.set(theme.id, b);
  return b;
}

const potCache = new Map<string, PixelPainter>();
function getPotPainter(theme: ThemeDef, variant: number): PixelPainter {
  const key = `${theme.id}:${variant}`;
  let p = potCache.get(key);
  if (p) return p;
  p = new PixelPainter(TILE, TILE + 2);
  const base = variant ? '#9a5a3a' : '#8a6a4a';
  p.ellipse(8, 11, 6, 6, base);
  p.rect(5, 3, 6, 4, base);
  p.shadeSphere(8, 10, 7, 7, [darken(base, 0.5), darken(base, 0.25), base, lighten(base, 0.25)]);
  p.rect(4, 3, 8, 2, darken(base, 0.1));
  p.rect(5, 3, 6, 1, lighten(base, 0.3));
  p.line(3, 10, 13, 10, darken(base, 0.4));
  p.outline(theme.palette.dark);
  potCache.set(key, p);
  return p;
}

// ------------------------------------------------------------------ doors
const DOOR_COLORS: Record<DoorKind, { frame: string; frameLight: string; inner: string }> = {
  normal: { frame: '#5a4a3e', frameLight: '#8a7460', inner: '#0a0608' },
  start: { frame: '#5a4a3e', frameLight: '#8a7460', inner: '#0a0608' },
  treasure: { frame: '#a8822a', frameLight: '#ffd96a', inner: '#140c02' },
  shop: { frame: '#3a6a5a', frameLight: '#7ad8b0', inner: '#04100a' },
  boss: { frame: '#7a1a20', frameLight: '#d84a4a', inner: '#140204' },
  secret: { frame: '#3a3048', frameLight: '#6a5a80', inner: '#06040a' },
  challenge: { frame: '#5a5a6a', frameLight: '#c0c0d8', inner: '#0a0a10' },
  shrine: { frame: '#4a4a8a', frameLight: '#a0a8ff', inner: '#04041a' },
  curse: { frame: '#3a1a3a', frameLight: '#a04aa0', inner: '#100410' },
};

function doorSpriteName(kind: DoorKind, part: 'frame' | 'leaf'): string {
  const name = `__door_${kind}_${part}`;
  if (hasSprite(name)) return name;
  const c = DOOR_COLORS[kind];
  if (part === 'frame') {
    // 32x32 arch frame drawn pointing "north" (door in the top wall), opening at the bottom
    defineDrawnSprite(name, 32, 32, (p) => {
      p.rect(2, 4, 28, 28, c.frame);
      p.ellipse(16, 10, 14, 9, c.frame);
      p.rect(8, 10, 16, 22, c.inner);
      p.ellipse(16, 11, 8, 7, c.inner);
      // stones of the arch
      for (let i = 0; i < 7; i++) {
        const a = Math.PI + (i / 6) * Math.PI;
        p.px(16 + Math.cos(a) * 11.5, 11 + Math.sin(a) * 8, c.frameLight);
        p.px(16 + Math.cos(a) * 12.5, 11 + Math.sin(a) * 8.5, c.frameLight);
      }
      p.rect(3, 12, 2, 20, c.frameLight);
      p.rect(27, 12, 2, 20, darken(c.frame, 0.3));
      if (kind === 'boss') {
        // skull on top
        p.ellipse(16, 3, 4, 3, '#e8dcc8');
        p.px(14, 3, '#1a0a0a'); p.px(18, 3, '#1a0a0a');
      }
      if (kind === 'treasure') {
        p.rect(14, 0, 4, 4, '#ffe680');
        p.px(15, 1, '#ffffff');
      }
      if (kind === 'shop') {
        p.ellipse(16, 2.5, 3, 2.5, '#ffd34a');
        p.px(16, 2, '#a07010');
      }
    }, { outline: '#0c0810', origin: [16, 31] });
  } else {
    defineDrawnSprite(name, 16, 22, (p) => {
      const leaf = kind === 'boss' ? '#5a1a1a' : kind === 'treasure' ? '#8a6a1a' : '#4a3426';
      p.rect(0, 0, 16, 22, leaf);
      for (let x = 3; x < 16; x += 4) p.line(x, 0, x, 21, darken(leaf, 0.35));
      p.rect(0, 6, 16, 2, '#3a3a44');
      p.rect(0, 15, 16, 2, '#3a3a44');
      p.px(12, 11, '#c8b070');
    }, { origin: [8, 21] });
  }
  return name;
}

function drawDoor(r: Renderer, room: Room, d: Door, time: number): void {
  if (d.state === 'hidden') return;
  const kind = d.kind;
  const rot = d.dir === 'N' ? 0 : d.dir === 'S' ? Math.PI : d.dir === 'E' ? Math.PI / 2 : -Math.PI / 2;
  // frame pivot sits on the inner wall edge
  r.sprite(doorSpriteName(kind, 'frame'), d.x, d.y, { rot });
  // closing leaves slide in from the sides of the doorway
  const closed = 1 - d.open;
  if (closed > 0.02) {
    const leaf = doorSpriteName(kind, 'leaf');
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    // local offset (perpendicular to door direction) toward the door center
    const off = (1 - closed) * 9;
    for (const side of [-1, 1]) {
      const lx = side * (4 + off);
      const ly = -2;
      r.sprite(leaf, d.x + lx * c - ly * s, d.y + lx * s + ly * c, { rot, sx: 0.5 });
    }
    if (d.state === 'locked') {
      const ly = -10;
      r.sprite('__lock', d.x - ly * s, d.y + ly * c);
    }
  }
}

defineDrawnSprite('__lock', 8, 9, (p) => {
  p.ring(4, 3, 3, 1, '#c8c8d0');
  p.rect(0, 3, 8, 6, '#ffcc33');
  p.shadeVertical(0, 3, 8, 6, ['#a07010', '#ffcc33', '#ffe680']);
  p.rect(3, 5, 2, 2, '#3a2a0a');
}, { outline: '#1a1008' });
