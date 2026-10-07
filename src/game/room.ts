// A room instance: tile grid, doors, cached background rendering and decals.

import { CELL_H, CELL_W, TILE, WALL, roomTileSize, type Dir } from './constants';
import { Tile, TEMPLATE_LEGEND, tileProps } from './tiles';
import type { RoomNode } from './dungeon';
import type { RoomTemplate, ThemeDef } from './defs';
import type { World } from './world';
import type { Renderer } from '../engine/renderer';
import { RNG } from '../engine/rng';
import { clamp } from '../engine/math';
import { drawDoor, drawSpikes, renderRoomBackground } from './roomart';

export type DoorKind = 'normal' | 'treasure' | 'shop' | 'boss' | 'secret' | 'challenge' | 'shrine' | 'curse' | 'start' | 'relay' | 'workshop' | 'vault' | 'elite';
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

  drawBackground(r: Renderer, roomTime = 0): void {
    if (!this.bg || this.bgDirty) {
      this.bg = renderRoomBackground(this);
      this.bgDirty = false;
    }
    r.ctx.drawImage(this.bg, -r.viewX, -r.viewY);
    if (this.decals) r.ctx.drawImage(this.decals, -r.viewX, -r.viewY);
    drawSpikes(r, this, roomTime);
  }

  /** Doors are drawn every frame (animated). */
  drawDoors(r: Renderer, time: number): void {
    for (const d of this.doors) drawDoor(r, this, d, time);
  }
}

// ======================================================================
// Rendering lives in roomart.ts (perspective walls, floors, pits, obstacles, doors).
// ======================================================================
export { paintDefaultFloor } from './roomart';
