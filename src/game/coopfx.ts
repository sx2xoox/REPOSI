// Co-op presentation in the world: each keeper's colour ring and name tag, the
// downed ghost's revive ring, and a keeper who left fading out. Draw-only (no
// simulation state is read back from here).

import { Entity } from './entity';
import type { World } from './world';
import type { Player } from './player';
import { VIEW_H, VIEW_W, type Renderer } from '../engine/renderer';
import { REVIVE_TIME } from './coop';

/** Slot colours: P1 gold, P2 cyan, P3 pink, P4 green. */
export const SLOT_COLORS = ['#ffd04a', '#56e0ff', '#ff7ad0', '#7aff86'] as const;
/** Darker partners of SLOT_COLORS (outlines, panel edges). */
export const SLOT_DARK = ['#7a5410', '#16607a', '#7a1e5c', '#1e7a2e'] as const;

export function slotColor(slot: number): string {
  return SLOT_COLORS[slot % SLOT_COLORS.length];
}

export function slotDark(slot: number): string {
  return SLOT_DARK[slot % SLOT_DARK.length];
}

/** "P1".."P4" (shown when a keeper has no nickname). */
export function slotLabel(slot: number): string {
  return `P${slot + 1}`;
}

/** A keeper's display name in co-op (nickname, else P1..P4). */
export function keeperName(p: Player): string {
  return p.name || slotLabel(p.slot);
}

/** A keeper who left the session: its sprite rises and fades away. */
export class FadeOut extends Entity {
  static override readonly cosmetic = true;
  private frame: string;
  private flip: boolean;
  constructor(p: Player) {
    super();
    this.x = p.x;
    this.y = p.y;
    this.frame = p.frameName();
    this.flip = p.spriteFlip;
    this.layer = 2;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.age > 1) this.dead = true;
  }

  override draw(r: Renderer): void {
    const k = Math.min(1, this.age);
    r.sprite(this.frame, this.x, this.y + 5 - k * 10, { flipX: this.flip, alpha: (1 - k) * 0.8, tint: '#c8d8ff', tintAmount: 0.4 + 0.5 * k });
  }
}

/** Floor layer, under the keepers: a colour ring at each keeper's feet (who is who at a glance). */
export function drawCoopRings(r: Renderer, w: World): void {
  for (const p of w.players) {
    if (p.fall > 0) continue;
    const col = slotColor(p.slot);
    const a = p.downed ? 0.35 : p === w.local ? 0.85 : 0.65;
    r.ring(p.x, p.y + 4, p === w.local ? 8.5 : 8, col, 1, a);
    if (p === w.local) {
      // A second pale ring and four ticks distinguish self without relying on colour.
      r.ring(p.x, p.y + 4, 11, '#fff4c8', 1, a);
      for (const [dx, dy] of [[-13, 0], [13, 0], [0, -13], [0, 13]]) {
        r.rect(p.x + dx - 1, p.y + 3 + dy, 2, 2, '#fff4c8', a);
      }
    }
    if (p.downed && p.reviveT > 0) {
      // revive progress: a filling arc of dots around the ghost
      const f = Math.min(1, p.reviveT / REVIVE_TIME);
      const n = 20;
      for (let i = 0; i < n; i++) {
        const lit = i / n < f;
        const ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const x = p.x + Math.cos(ang) * 13;
        const y = p.y - 6 + Math.sin(ang) * 13;
        r.rect(x - 1, y - 1, 2, 2, lit ? '#fff0a0' : '#40384a', lit ? 1 : 0.6);
      }
    }
  }
}

/** Where a keeper is on screen this frame (UI units), recorded while the world is drawn (interpolated). */
export interface CoopTag {
  slot: number;
  /** UI position of the keeper's head */
  x: number;
  y: number;
  /** the keeper is inside the world view */
  onScreen: boolean;
}

/** Record every keeper's on-screen spot for the HUD (name tags, off-screen arrows). Draw-only. */
export function recordCoopTags(r: Renderer, w: World, out: CoopTag[]): void {
  out.length = 0;
  for (const p of w.players) {
    const d = r.worldToDisplay(p.x, p.y - 22 - (p.downed ? 2 : 0));
    const u = r.displayToUI(d.x, d.y);
    const sx = p.x - r.viewX;
    const sy = p.y - r.viewY;
    out.push({ slot: p.slot, x: u.x, y: u.y, onScreen: sx > -4 && sx < VIEW_W + 4 && sy > 0 && sy < VIEW_H + 16 });
  }
}
