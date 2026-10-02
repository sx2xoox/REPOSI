// Minimap / full map renderer. Rooms are pixel blocks (discovered = dark,
// visited = lit, current = bright + pulsing outline) joined by small door
// bridges, with special-room icons. The mini view recenters smoothly (springs)
// when the player changes rooms; the full map fits every known room.

import type { Renderer } from '../engine/renderer';
import type { World } from '../game/world';
import type { RoomNode } from '../game/dungeon';
import { MAP_H, MAP_W } from '../game/constants';
import { Spring } from './anim';
import { frame } from './frame';
import { C } from './theme';
import { ROOM_ICONS } from './logic';

/** Is this node shown on the map? (secret rooms only after a door to them was revealed) */
export function nodeKnown(w: World, n: RoomNode): boolean {
  if (!n.discovered) return false;
  if (n.kind === 'secret' && !n.visited && !w.flags.has('mapRevealSecret')) {
    return w.map.nodes.some((o) => o.doors.some((dd) => dd.to === n.id && (dd as { revealed?: boolean }).revealed));
  }
  return true;
}

export interface MapDrawOpts {
  /** UI units per map cell */
  cell: number;
  gap?: number;
  /** pulse time */
  t: number;
  /** extra flash on the current room (room clear) 0..1 */
  flash?: number;
  /** draw the player marker on the current room */
  marker?: boolean;
  alpha?: number;
}

/**
 * Draw the floor's rooms with the map-space point (cx, cy) (in cells) at UI
 * position (ox, oy). Caller sets up clipping.
 */
export function drawRooms(r: Renderer, w: World, ox: number, oy: number, cx: number, cy: number, o: MapDrawOpts): void {
  const cell = o.cell;
  const gap = o.gap ?? Math.max(4, Math.round(cell * 0.22));
  const a = o.alpha ?? 1;
  const d = r.dctx;
  const cur = w.node;
  const px = (gx: number) => Math.round(ox + (gx - cx) * cell);
  const py = (gy: number) => Math.round(oy + (gy - cy) * cell);
  const known = w.map.nodes.filter((n) => nodeKnown(w, n));
  d.globalAlpha = a;
  // door bridges (under the rooms)
  for (const n of known) {
    for (const dr of n.doors) {
      const other = w.map.nodes[dr.to];
      if (!other || !nodeKnown(w, other) || dr.to < n.id) continue;
      if (dr.secret && !(dr as { revealed?: boolean }).revealed && !(n.visited && other.visited)) continue;
      const lit = n.visited && other.visited;
      d.fillStyle = lit ? '#8a7ea0' : '#3a3248';
      const bw = Math.max(2, Math.round(cell * 0.3));
      const cx0 = px(dr.cx);
      const cy0 = py(dr.cy);
      if (dr.dir === 'E') d.fillRect(cx0 + cell - gap / 2 - 1, cy0 + cell / 2 - bw / 2, gap + 2, bw);
      else if (dr.dir === 'W') d.fillRect(cx0 - gap / 2 - 1, cy0 + cell / 2 - bw / 2, gap + 2, bw);
      else if (dr.dir === 'S') d.fillRect(cx0 + cell / 2 - bw / 2, cy0 + cell - gap / 2 - 1, bw, gap + 2);
      else d.fillRect(cx0 + cell / 2 - bw / 2, cy0 - gap / 2 - 1, bw, gap + 2);
    }
  }
  for (const n of known) {
    const rx = px(n.gx) + gap / 2;
    const ry = py(n.gy) + gap / 2;
    const rw = n.cw * cell - gap;
    const rh = n.ch * cell - gap;
    const isCur = n === cur;
    // outline
    d.fillStyle = '#05030a';
    d.fillRect(rx - 1, ry - 1, rw + 2, rh + 2);
    let fill = n.visited ? '#5e5276' : '#241c30';
    let top = n.visited ? '#7a6e94' : '#30283e';
    if (isCur) {
      fill = '#e8dcc8';
      top = '#ffffff';
    } else if (n.visited && !n.cleared) {
      fill = '#6a3a4a';
      top = '#8a4a5a';
    }
    d.fillStyle = fill;
    d.fillRect(rx, ry, rw, rh);
    d.fillStyle = top;
    d.fillRect(rx, ry, rw, Math.max(1, Math.round(cell * 0.14)));
    if (!n.visited) {
      d.fillStyle = '#4a3e5e';
      d.fillRect(rx, ry, rw, 1);
      d.fillRect(rx, ry, 1, rh);
    }
    if (isCur) {
      const pulse = 0.5 + 0.5 * Math.sin(o.t * 5);
      d.globalAlpha = a * (0.35 + 0.4 * pulse);
      d.strokeStyle = C.goldHi;
      d.lineWidth = 2;
      d.strokeRect(rx - 2, ry - 2, rw + 4, rh + 4);
      d.globalAlpha = a;
      if (o.flash && o.flash > 0) {
        d.globalAlpha = a * o.flash;
        d.fillStyle = '#fff4c0';
        d.fillRect(rx - 3, ry - 3, rw + 6, rh + 6);
        d.globalAlpha = a;
      }
    }
    const icon = ROOM_ICONS[n.kind];
    const scale = cell >= 20 ? 2 : 1;
    if (icon) r.uiSprite(icon, rx + rw / 2, ry + rh / 2, scale, { alpha: a * (n.visited && !isCur ? 0.9 : 1) });
    else if (isCur && o.marker) r.uiSprite('map_player', rx + rw / 2, ry + rh / 2, scale, { alpha: a });
    if (isCur && icon && o.marker) r.uiSprite('map_player', rx + rw - 4, ry + 4, 1, { alpha: a });
  }
  d.globalAlpha = 1;
}

/** HUD minimap with smooth recentering. */
export class MinimapView {
  private sx = new Spring(0, 140, 22);
  private sy = new Spring(0, 140, 22);
  private init = false;
  flash = 0;

  update(w: World, dt: number): void {
    const n = w.node;
    const tx = n.gx + n.cw / 2;
    const ty = n.gy + n.ch / 2;
    if (!this.init) {
      this.sx.set(tx);
      this.sy.set(ty);
      this.init = true;
    }
    this.sx.target = tx;
    this.sy.target = ty;
    this.sx.update(dt);
    this.sy.update(dt);
    this.flash = Math.max(0, this.flash - dt * 1.6);
  }

  /** Snap to the current room (new floor). */
  reset(): void {
    this.init = false;
  }

  draw(r: Renderer, w: World, x: number, y: number, mw: number, mh: number, t: number, alpha = 1): void {
    frame(r, x, y, mw, mh, 'glass', { alpha });
    const d = r.dctx;
    d.save();
    d.beginPath();
    d.rect(x + 4, y + 4, mw - 8, mh - 8);
    d.clip();
    drawRooms(r, w, x + mw / 2, y + mh / 2, this.sx.value, this.sy.value, { cell: 14, t, flash: this.flash, marker: true, alpha });
    d.restore();
  }
}

/** Bounds (in cells) of all known rooms, for the full map. */
export function knownBounds(w: World): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = MAP_W;
  let y0 = MAP_H;
  let x1 = 0;
  let y1 = 0;
  for (const n of w.map.nodes) {
    if (!nodeKnown(w, n)) continue;
    x0 = Math.min(x0, n.gx);
    y0 = Math.min(y0, n.gy);
    x1 = Math.max(x1, n.gx + n.cw);
    y1 = Math.max(y1, n.gy + n.ch);
  }
  if (x1 <= x0) return { x0: 0, y0: 0, x1: MAP_W, y1: MAP_H };
  return { x0, y0, x1, y1 };
}

/** Back-compat helper: draw a static minimap centered on the current room. */
export function drawMinimap(r: Renderer, w: World, x: number, y: number, mw: number, mh: number, full = false): void {
  const cell = full ? 22 : 14;
  frame(r, x, y, mw, mh, 'glass');
  const d = r.dctx;
  d.save();
  d.beginPath();
  d.rect(x + 4, y + 4, mw - 8, mh - 8);
  d.clip();
  const b = full ? knownBounds(w) : { x0: w.node.gx, y0: w.node.gy, x1: w.node.gx + w.node.cw, y1: w.node.gy + w.node.ch };
  drawRooms(r, w, x + mw / 2, y + mh / 2, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, { cell, t: w.time, marker: true });
  d.restore();
}
