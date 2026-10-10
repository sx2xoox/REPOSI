// Sealed doors (봉인된 문): from floor 2 the treasure room and the shop are sealed.
// Red cords cross the doorway to a wax seal under a cold iron door lamp; a keeper
// lights the lamp with a match (interact, never during a lockdown) and the cords
// burn away from the seal. One SealLamp per locked door, spawned on the room's
// first visit (World.spawnRoomFixtures) and kept with the room.

import { Entity } from './entity';
import type { World } from './world';
import type { Door } from './room';
import type { Renderer } from '../engine/renderer';
import { animFrame } from '../engine/sprites';
import { DIR_VEC } from './constants';
import { inLockdown, matchCard, tryLightWithMatch } from './matches';
import { fx } from '../engine/rng';
import { clamp } from '../engine/math';

/** cords burn away from the seal over this long after lighting (s) */
const BURN_T = 0.35;

/** Rotation of the door frame (door sprites are drawn for the top wall): [cos, sin]. */
const FRAME: Record<Door['dir'], [number, number]> = { N: [1, 0], S: [-1, 0], E: [0, 1], W: [0, -1] };

export class SealLamp extends Entity {
  override readonly worldLoot = true;
  readonly door: Door;
  lit = false;
  /** `age` when it was lit (draw only: the cords' burn) */
  private litAt = -1;
  private unlockSounded = false;

  constructor(door: Door) {
    super();
    this.door = door;
    const v = DIR_VEC[door.dir];
    this.x = door.x - v.x * 6;
    this.y = door.y - v.y * 6;
    this.r = 5;
    this.persistent = true;
    this.solid = false;
    this.tileCollide = false;
  }

  /**
   * Where the lamp hangs (its top, world px): in the arch of a top-wall door; on
   * the wall just above the frame of a side door; beside the frame on the bottom
   * wall's lip. Always upright.
   */
  private lampAt(): [number, number] {
    const d = this.door;
    switch (d.dir) {
      case 'N': return [d.x, d.y - 22];
      case 'S': return [d.x + 19, d.y + 1];
      case 'E': return [d.x + 6, d.y - 27];
      case 'W': return [d.x - 6, d.y - 27];
    }
  }

  /** local point (lx, ly) of the door frame (top-wall coordinates, up = -y) -> world */
  private at(lx: number, ly: number): [number, number] {
    const [c, s] = FRAME[this.door.dir];
    return [this.door.x + lx * c - ly * s, this.door.y + lx * s + ly * c];
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const d = this.door;
    if (!this.lit) {
      // unsealed some other way (e.g. from the room's other side): it is simply lit
      const node = w.map?.nodes[d.to];
      if (d.state !== 'locked' || (node && !node.locked)) this.burn(w, true);
      return;
    }
    // a lit lamp spits the odd spark
    if (fx.chance(dt * 1.5)) {
      const [ax, ay] = this.lampAt();
      w.particles.spawn({ x: ax + fx.range(-1, 1), y: ay + 2, vx: fx.range(-4, 4), vy: -fx.range(10, 20), life: 0.4, colors: ['#ffe080', '#ff8a30'], size: 1, additive: true });
    }
    if (!this.unlockSounded && this.age - this.litAt >= BURN_T * 0.8) {
      this.unlockSounded = true;
      w.sfx('door_unlock', { x: d.x });
    }
  }

  override previewable(): boolean {
    return !this.lit && !this.dead;
  }

  override interactionInfo(w?: World) {
    const name = '봉인된 문';
    const desc = '성냥으로 봉인을 태우면 문이 열린다.';
    if (!w) return { name, desc, icon: 'icon_seal', actionLabel: '불 붙이기', available: false, price: { icon: 'hud_match', text: '1', ok: false } };
    return matchCard(w, { name, desc, lockdown: inLockdown(w) });
  }

  override interact(w: World): boolean {
    if (this.lit || this.dead || !w.entities.includes(this)) return false;
    if (!tryLightWithMatch(w, this, true)) return false;
    this.burn(w, false);
    return true;
  }

  /** Burn the seal: the door opens and its room is no longer locked on the map (`quiet`: no show). */
  burn(w: World, quiet: boolean): void {
    if (this.lit) return;
    this.lit = true;
    this.litAt = this.age;
    const d = this.door;
    if (d.state === 'locked') d.state = 'open';
    const node = w.map?.nodes[d.to];
    if (node) node.locked = false;
    w.room.markDirty();
    if (quiet) {
      this.litAt = this.age - BURN_T;
      this.unlockSounded = true;
      return;
    }
    w.sfx('seal_burn', { x: d.x });
    const [sx, sy] = this.at(0, -6);
    w.particles.burst(sx, sy, { count: 14, speed: [20, 70], life: [0.2, 0.5], colors: ['#ffffff', '#ffd060', '#ff7a20', '#c02a2a'], size: [1, 2], additive: true, light: 4 });
    w.particles.burst(sx, sy, { count: 6, speed: [5, 25], life: [0.4, 0.9], colors: ['#c02a2a', '#8a1a1a'], size: [1, 1], gravity: 200, vz: [5, 25] });
  }

  override draw(r: Renderer): void {
    const k = this.lit ? clamp((this.age - this.litAt) / BURN_T, 0, 1) : 0;
    // the cords: two crossing the doorway, each burning outward from the seal
    if (k < 1) {
      const [cx, cy] = this.at(0, -6);
      for (const [lx, ly] of [[-8, -11], [8, -1], [8, -11], [-8, -1]] as const) {
        const [ex, ey] = this.at(lx, ly);
        const fx0 = cx + (ex - cx) * k;
        const fy0 = cy + (ey - cy) * k;
        r.pixelLine(fx0, fy0, ex, ey, '#8a2020');
        if (k > 0) {
          r.rect(Math.round(fx0), Math.round(fy0), 1, 1, '#ffd060');
          r.rect(Math.round(fx0 + (ex - cx) * 0.08), Math.round(fy0 + (ey - cy) * 0.08), 1, 1, '#ff6020');
        }
      }
      // the wax seal melts and drips as the cords go
      r.sprite('seal_wax', cx, cy + k * 3, { alpha: 1 - k });
    }
    // the door lamp
    const [ax, ay] = this.lampAt();
    r.pixelLine(ax, ay - 3, ax, ay, '#2a2630');
    r.sprite(this.lit ? 'seal_lamp_lit' : 'seal_lamp', ax, ay);
    if (this.lit) r.sprite(animFrame('prop_flame_small', this.age + this.id * 0.37), ax, ay + 6);
    else if (Math.floor(this.age * 1.3 + this.id) % 7 === 0) r.rect(Math.round(ax), Math.round(ay + 5), 1, 1, '#ff9a50', 0.7);
  }

  override light(w: World): void {
    if (!this.lit) return;
    const [ax, ay] = this.lampAt();
    const fl = 1 + Math.sin(this.age * 13 + this.id) * 0.05;
    w.lights.add(ax, ay + 5, 30 * fl, '#ffb060', { intensity: 0.8 });
  }
}
