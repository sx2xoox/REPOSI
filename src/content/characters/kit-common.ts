// Shared pieces of the 보리 / 백구 / 모리 kits: a timed effect entity that follows
// the keeper (releases, beacons), the protective opener every release starts
// with, and the small world-space fx both kits and releases draw.
//
// Same rules as every kit: gameplay state in `w.vars` / entity fields, `w.rng`
// for anything that touches gameplay, `fx` only for cosmetics.

import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import { Entity } from '../../game/entity';
import { RingFx } from '../../game/effects';
import { clearBullets } from './releases';

/**
 * Runs `fn(w, t, dt)` every update for `dur` seconds while following the keeper
 * (gameplay entity: releases apply their hits from here). `end` fires once.
 */
export class KitTimeline extends Entity {
  dur: number;
  fn: (w: World, t: number, dt: number, self: KitTimeline) => void;
  endFn?: (w: World) => void;
  drawFn?: (r: Renderer, w: World, t: number) => void;
  lightFn?: (w: World, t: number) => void;
  /** numeric scratch (hashed) */
  mem: Record<string, number> = {};
  constructor(dur: number, fn: KitTimeline['fn'], o: { end?: (w: World) => void; draw?: KitTimeline['drawFn']; light?: KitTimeline['lightFn']; layer?: number } = {}) {
    super();
    this.dur = dur;
    this.fn = fn;
    this.endFn = o.end;
    this.drawFn = o.draw;
    this.lightFn = o.light;
    this.layer = o.layer ?? 2;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    this.x = w.player.x;
    this.y = w.player.y;
    this.fn(w, this.age, dt, this);
    if (this.age >= this.dur && !this.dead) {
      this.dead = true;
      this.endFn?.(w);
    }
  }

  override draw(r: Renderer, w: World): void {
    this.drawFn?.(r, w, this.age);
  }

  override light(w: World): void {
    this.lightFn?.(w, this.age);
  }
}

/** The protective flash every release opens with: flash, shake, rings, nearby bullets erased. */
export function releaseOpen(w: World, p: Player, color: string, radius: number): void {
  w.renderer.screenFlash(color, 0.3);
  w.shake(0.35);
  w.spawn(new RingFx(p.x, p.y - 6, radius, 0.4, color, 3));
  w.spawn(new RingFx(p.x, p.y - 6, radius * 0.6, 0.3, '#ffffff', 2));
  clearBullets(w, p.x, p.y, radius * 1.3);
}

/** Fixed-step accumulator: calls `fn` for every `every` seconds elapsed (deterministic). */
export function everyTick(self: KitTimeline, key: string, dt: number, every: number, fn: (i: number) => void): void {
  let acc = (self.mem[key] ?? 0) + dt;
  let n = self.mem[`${key}_n`] ?? 0;
  while (acc >= every) {
    acc -= every;
    fn(n++);
  }
  self.mem[key] = acc;
  self.mem[`${key}_n`] = n;
}
