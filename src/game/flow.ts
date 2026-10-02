// Flow field toward the player for ground enemies: BFS over walkable tiles,
// recomputed only when the player changes tile or the room's tiles change.

import type { Room } from './room';
import { TILE } from './constants';
import { tileProps } from './tiles';

const NEIGH = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export class FlowField {
  private room: Room | null = null;
  private dist = new Int32Array(0);
  private w = 0;
  private h = 0;
  private lastTx = -1;
  private lastTy = -1;
  private lastVersion = -1;
  /** BFS queue buffers, reused between recomputes */
  private qx = new Int16Array(0);
  private qy = new Int16Array(0);

  private walkable(tx: number, ty: number): boolean {
    const r = this.room!;
    if (tx < 0 || ty < 0 || tx >= r.w || ty >= r.h) return false;
    return !tileProps(r.tileAt(tx, ty)).pathBlocked;
  }

  update(room: Room, px: number, py: number): void {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    if (room === this.room && tx === this.lastTx && ty === this.lastTy && room.version === this.lastVersion) return;
    this.room = room;
    this.lastTx = tx;
    this.lastTy = ty;
    this.lastVersion = room.version;
    this.w = room.w;
    this.h = room.h;
    const n = this.w * this.h;
    if (this.dist.length !== n) this.dist = new Int32Array(n);
    this.dist.fill(-1);
    if (this.qx.length < n) {
      this.qx = new Int16Array(n);
      this.qy = new Int16Array(n);
    }
    const qx = this.qx;
    const qy = this.qy;
    let head = 0;
    let tail = 0;
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return;
    this.dist[ty * this.w + tx] = 0;
    qx[tail] = tx;
    qy[tail++] = ty;
    while (head < tail) {
      const cx = qx[head];
      const cy = qy[head++];
      const cd = this.dist[cy * this.w + cx];
      for (let i = 0; i < 4; i++) {
        const nx = cx + NEIGH[i][0];
        const ny = cy + NEIGH[i][1];
        if (!this.walkable(nx, ny)) continue;
        const idx = ny * this.w + nx;
        if (this.dist[idx] !== -1) continue;
        this.dist[idx] = cd + 1;
        qx[tail] = nx;
        qy[tail++] = ny;
      }
    }
  }

  /** Distance in tiles from (x,y) to the player, or -1 if unreachable. */
  distAt(x: number, y: number): number {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return -1;
    return this.dist[ty * this.w + tx];
  }

  /** Normalized direction to walk from (x,y) toward the player, or null if unreachable. */
  dirAt(x: number, y: number): { x: number; y: number } | null {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return null;
    const here = this.dist[ty * this.w + tx];
    if (here <= 0) return null; // at target tile or unreachable
    let best = here;
    let bx = 0;
    let by = 0;
    for (const [dx, dy] of NEIGH) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
      const d = this.dist[ny * this.w + nx];
      if (d < 0) continue;
      // diagonal: both orthogonal neighbours must be walkable (no corner cutting)
      if (dx !== 0 && dy !== 0) {
        if (this.dist[ty * this.w + nx] < 0 || this.dist[ny * this.w + tx] < 0) continue;
      }
      const score = d + (dx !== 0 && dy !== 0 ? -0.1 : 0);
      if (score < best) {
        best = score;
        bx = dx;
        by = dy;
      }
    }
    if (bx === 0 && by === 0) return null;
    // aim at the center of the next tile (smooths movement around corners)
    const cx = (tx + bx + 0.5) * TILE - x;
    const cy = (ty + by + 0.5) * TILE - y;
    const l = Math.hypot(cx, cy) || 1;
    return { x: cx / l, y: cy / l };
  }
}
