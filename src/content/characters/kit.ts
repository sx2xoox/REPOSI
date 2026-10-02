// Shared helpers for character kits (CharacterDef.passive / dash / affinity):
// a cosmetic per-room overlay that draws marks above enemies (scent marks,
// ember stacks ...), trail spacing for dashes that drop things along the way,
// and the small readable sprites several kits share.
//
// Rules for kits (same as artifacts): gameplay state lives in `w.vars`
// (numbers), `e.mem` or projectile `mem`; `fx` only for cosmetics; purely
// visual entities are `cosmetic`.

import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { Entity } from '../../game/entity';
import type { Enemy } from '../../game/enemy';
import { defineDrawnSprite } from '../../engine/sprites';

export const O = '#0c0810';

/** Draws something above every living enemy in the current room (subclass `drawMark`). */
export abstract class EnemyOverlay extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  room: unknown;
  constructor(w: World) {
    super();
    this.layer = 2;
    this.tileCollide = false;
    this.room = w.room;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.room !== w.room) this.dead = true;
  }

  override draw(r: Renderer, w: World): void {
    for (const e of w.enemies) if (e.alive) this.drawMark(r, w, e);
  }

  override light(w: World): void {
    for (const e of w.enemies) if (e.alive) this.lightMark(w, e);
  }

  abstract drawMark(r: Renderer, w: World, e: Enemy): void;
  lightMark(_w: World, _e: Enemy): void {}
}

const overlays = new WeakMap<World, Map<string, Entity>>();

/** Keep one overlay of `key` alive in the current room (respawned after a room change). */
export function ensureOverlay(w: World, key: string, make: (w: World) => Entity): void {
  let m = overlays.get(w);
  if (!m) overlays.set(w, (m = new Map()));
  const cur = m.get(key);
  if (cur && !cur.dead && (cur as { room?: unknown }).room === w.room) return;
  const e = make(w);
  m.set(key, e);
  w.spawn(e);
}

/**
 * Trail spacing: true every time the keeper has moved `spacing` px since the
 * last accepted point (first call after `reset` always passes). State in w.vars.
 */
export function trailStep(w: World, key: string, x: number, y: number, spacing: number): boolean {
  const kx = `__trail_${key}_x`;
  const ky = `__trail_${key}_y`;
  const lx = w.vars[kx];
  const ly = w.vars[ky];
  if (lx !== undefined && ly !== undefined && Math.hypot(x - lx, y - ly) < spacing) return false;
  w.vars[kx] = x;
  w.vars[ky] = y;
  return true;
}

export function trailReset(w: World, key: string): void {
  delete w.vars[`__trail_${key}_x`];
  delete w.vars[`__trail_${key}_y`];
}

// ------------------------------------------------------------------ shared sprites
// small paw print (scent marks)
defineDrawnSprite('fx_paw_mark', 7, 7, (p) => {
  p.ellipse(3.5, 4.5, 2.2, 1.8, '#ffe08a');
  p.px(1, 2, '#ffe08a');
  p.px(3, 1, '#ffe08a');
  p.px(5, 2, '#ffe08a');
  p.px(3, 4, '#fff8d0');
}, { outline: '#3a2a10' });

// momentum chevron (기세 pips)
defineDrawnSprite('fx_momentum_pip', 5, 5, (p) => {
  p.poly([0, 4, 2.5, 0.5, 5, 4, 2.5, 2.6], '#cfe0ff');
  p.px(2, 1, '#ffffff');
}, { outline: '#101c3c' });
