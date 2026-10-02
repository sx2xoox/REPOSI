// Draw interpolation between fixed simulation steps.
//
// The simulation runs at exactly 60 Hz; a 120 Hz (or 90 / 144 ...) display
// draws in between steps. At the start of every step `save()` records each
// entity's, particle's and the camera's position as "previous"; a draw then
// `begin(alpha)`s — every entity is moved to prev + (cur - prev) * alpha —
// draws, and `end()`s, which writes the exact current values back (plain
// number copies: bit-identical), so the simulation never sees an
// interpolated position. Pure logic (no DOM), unit-tested.

import type { Entity } from './entity';
import type { Particles } from '../engine/particles';

/** an entity moving farther than this (px, any axis) in one step is drawn at its new position */
export const SNAP_DIST = 24;
/** camera moves larger than this (px) in one step are not interpolated */
export const CAM_SNAP = 64;

export interface CameraLike {
  camX: number;
  camY: number;
}

export class Interpolator {
  /** true between `begin` (when it moved anything) and `end` */
  active = false;
  private pcamX = NaN;
  private pcamY = NaN;
  private list: Entity[] = [];
  private saved: number[] = [];
  private camX = 0;
  private camY = 0;
  private cam: CameraLike | null = null;
  private particles: Particles | null = null;

  /** Record the current positions as "previous" (call at the start of every simulation step). */
  save(entities: readonly Entity[], particles: Particles | null, cam: CameraLike | null): void {
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      e.px = e.x;
      e.py = e.y;
      e.pz = e.z;
    }
    particles?.savePrev();
    if (cam) {
      this.pcamX = cam.camX;
      this.pcamY = cam.camY;
    }
  }

  /**
   * Move entities, particles and the camera to their interpolated positions
   * (0 <= alpha < 1). `dt` is the latest step's length: an entity spawned
   * during it (no previous position yet) continues its velocity backwards, so
   * a shot leaves the interpolated muzzle instead of popping ahead.
   * Always pair with `end()` (try / finally).
   */
  begin(alpha: number, entities: readonly Entity[], particles: Particles | null, cam: CameraLike | null, dt: number): void {
    this.end();
    if (!(alpha < 1)) return;
    const a = alpha > 0 ? alpha : 0;
    const list = this.list;
    const saved = this.saved;
    let n = 0;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      const x = e.x;
      const y = e.y;
      const z = e.z;
      let px = e.px;
      let py = e.py;
      let pz = e.pz;
      if (px !== px || py !== py || pz !== pz) {
        px = x - e.vx * dt;
        py = y - e.vy * dt;
        pz = z;
      }
      const dx = x - px;
      const dy = y - py;
      const dz = z - pz;
      if (dx === 0 && dy === 0 && dz === 0) continue;
      // teleports, blinks, placement: snap instead of sliding across the room
      if (dx > SNAP_DIST || dx < -SNAP_DIST || dy > SNAP_DIST || dy < -SNAP_DIST || dz > SNAP_DIST || dz < -SNAP_DIST) continue;
      if (!(dx === dx && dy === dy && dz === dz)) continue;
      list.push(e);
      saved[n++] = x;
      saved[n++] = y;
      saved[n++] = z;
      e.x = px + dx * a;
      e.y = py + dy * a;
      e.z = pz + dz * a;
    }
    if (cam) {
      this.cam = cam;
      this.camX = cam.camX;
      this.camY = cam.camY;
      const cdx = cam.camX - this.pcamX;
      const cdy = cam.camY - this.pcamY;
      if (cdx >= -CAM_SNAP && cdx <= CAM_SNAP && cdy >= -CAM_SNAP && cdy <= CAM_SNAP) {
        cam.camX = this.pcamX + cdx * a;
        cam.camY = this.pcamY + cdy * a;
      }
    }
    if (particles) {
      this.particles = particles;
      particles.alpha = a;
    }
    this.active = true;
  }

  /** Restore the exact simulated positions (no-op when nothing was moved). */
  end(): void {
    if (!this.active) return;
    this.active = false;
    const list = this.list;
    const saved = this.saved;
    for (let i = 0, n = 0; i < list.length; i++) {
      const e = list[i];
      e.x = saved[n++];
      e.y = saved[n++];
      e.z = saved[n++];
    }
    list.length = 0;
    if (this.cam) {
      this.cam.camX = this.camX;
      this.cam.camY = this.camY;
      this.cam = null;
    }
    if (this.particles) {
      this.particles.alpha = 1;
      this.particles = null;
    }
  }
}
