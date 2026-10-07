import { Entity } from '../../game/entity';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import { refugeVisualOpacity } from './refuge-common';

// Impact feedback for the refuge keepers' skills. Called from simulation
// updates at the moment a skill lands, but everything here is cosmetic:
// particles and `fx` draw only from the cosmetic RNG, rings are cosmetic
// entities (negative ids, outside the state hash) and shake is per peer.

/** A crisp expanding ring (pixel grid), purely visual. */
export class RefugeRing extends Entity {
  static override readonly cosmetic = true;
  constructor(x: number, y: number, private readonly maxR: number, private readonly dur: number,
    private readonly color: string, private readonly width: number, private readonly alpha: number, private readonly squash = 1) {
    super();
    this.x = x;
    this.y = y;
    this.layer = 2;
    this.tileCollide = false;
  }
  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.age >= this.dur) this.dead = true;
  }
  override draw(r: Renderer): void {
    const k = Math.min(1, this.age / this.dur), grow = 1 - (1 - k) * (1 - k) * (1 - k);
    const radius = 2 + (this.maxR - 2) * grow;
    if (this.squash === 1) r.pixelRing(this.x, this.y, radius, this.color, Math.max(1, Math.round(this.width * (1 - k * .6))), this.alpha * (1 - k));
    else {
      // flattened ground ring: two crisp half-height arcs from line steps
      const steps = Math.max(12, Math.round(radius * 1.2));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2, b = ((i + 1) / steps) * Math.PI * 2;
        r.pixelLine(this.x + Math.cos(a) * radius, this.y + Math.sin(a) * radius * this.squash,
          this.x + Math.cos(b) * radius, this.y + Math.sin(b) * radius * this.squash, this.color, this.width, this.alpha * (1 - k));
      }
    }
  }
}

function ring(w: World, owner: Player, x: number, y: number, radius: number, dur: number, color: string, width = 2, squash = 1): void {
  const alpha = refugeVisualOpacity(w, owner);
  if (alpha > 0) w.spawn(new RefugeRing(x, y, radius, dur, color, width, alpha, squash));
}

/** Tove: sparks, a smoke puff, falling grit and a shock ring; heavy = artillery. */
export function blastImpact(w: World, owner: Player, x: number, y: number, radius: number, heavy: boolean): void {
  const alpha = refugeVisualOpacity(w, owner);
  if (alpha <= 0) return;
  w.particles.burst(x, y - 3, { alpha, count: heavy ? 24 : 12, speed: [60, heavy ? 200 : 150], life: [.16, .38], colors: ['#ffffff', '#ffe49c', '#f59a3a', '#b8452a'], shape: 'spark', size: [1, 2], additive: true, light: heavy ? 8 : 5 });
  w.particles.burst(x, y - 5, { alpha: alpha * .85, count: heavy ? 9 : 5, speed: [6, 34], life: [.55, 1.05], colors: ['#6a5658', '#4a3c40', '#2c2428'], size: [3, 5], sizeEnd: heavy ? 10 : 7, drag: 3, fade: true, radius: radius * .25 });
  w.particles.burst(x, y, { alpha, count: heavy ? 8 : 4, speed: [40, 120], life: [.4, .8], colors: ['#c08458', '#7a5238'], size: [1, 2], gravity: 320, vz: [60, 150] });
  ring(w, owner, x, y, radius, heavy ? .32 : .24, '#ffe6b0', heavy ? 2 : 1, .62);
  if (heavy) {
    w.decal(x, y + 1, '#140c0c', radius * .32, .4 * alpha);
    w.shake(.32);
  }
}

/** Luen: a thread snaps across a target; the last cut also rings out. */
export function threadImpact(w: World, owner: Player, x: number, y: number, angle: number, final: boolean): void {
  const alpha = refugeVisualOpacity(w, owner);
  if (alpha <= 0) return;
  w.particles.burst(x, y, { alpha, count: final ? 12 : 6, speed: [40, final ? 150 : 110], life: [.14, .32], colors: ['#ffffff', '#f4dcf2', '#c6a6ea', '#7a5aa8'], shape: 'spark', size: [1, 2], additive: true, light: 5, angle, spread: Math.PI * .5 });
  w.particles.burst(x, y, { alpha, count: final ? 8 : 4, speed: [40, final ? 150 : 110], life: [.14, .32], colors: ['#ffffff', '#f4dcf2', '#c6a6ea', '#7a5aa8'], shape: 'spark', size: [1, 2], additive: true, angle: angle + Math.PI, spread: Math.PI * .5 });
  w.particles.burst(x, y, { alpha: alpha * .9, count: final ? 6 : 3, speed: [10, 40], life: [.4, .7], colors: ['#e8d4f4', '#b496dc'], size: [1, 1], gravity: 60, vz: [10, 40] });
  if (final) {
    ring(w, owner, x, y, 18, .22, '#f2e2ff', 1);
  }
}

/** Luen: a pulse of light arrives along a thread. */
export function threadPulse(w: World, owner: Player, x: number, y: number): void {
  const alpha = refugeVisualOpacity(w, owner);
  if (alpha <= 0) return;
  w.particles.burst(x, y, { alpha, count: 5, speed: [20, 60], life: [.12, .26], colors: ['#ffffff', '#e6d2f6', '#b496dc'], size: [1, 1], additive: true, light: 4 });
}

/** Ves: a strike lands (sparks along its direction, pink / blue per hand). */
export function strikeImpact(w: World, owner: Player, x: number, y: number, angle: number, hand: number, heavy: boolean): void {
  const alpha = refugeVisualOpacity(w, owner);
  if (alpha <= 0) return;
  const tint = hand < 0 ? ['#ffffff', '#ffd6e0', '#ee9fb6', '#9a4a6a'] : hand > 0 ? ['#ffffff', '#d6ecff', '#9fcbe8', '#3e6a8a'] : ['#ffffff', '#ffe8f0', '#cfe6f4', '#9a8ab4'];
  w.particles.burst(x, y, { alpha, count: heavy ? 16 : 7, speed: [50, heavy ? 180 : 130], life: [.12, .3], colors: tint, shape: 'spark', size: [1, 2], additive: true, light: heavy ? 6 : 4, angle, spread: Math.PI * .9 });
  if (heavy) ring(w, owner, x, y, 26, .22, '#fff4f8', 1);
}

/** Ves (release): sparks spray along the leading edge of a crescent wave. */
export function waveImpact(w: World, owner: Player, x: number, y: number, angle: number, reach: number, hand: number, final: boolean): void {
  const alpha = refugeVisualOpacity(w, owner);
  if (alpha <= 0) return;
  const tint = hand < 0 ? ['#ffffff', '#ffd6e0', '#ee9fb6'] : hand > 0 ? ['#ffffff', '#d6ecff', '#9fcbe8'] : ['#ffffff', '#fff0f6', '#d9e8f6'];
  const n = final ? 7 : 4;
  for (let i = 0; i < n; i++) {
    const a = angle + (i / (n - 1) - .5) * 2.2, d = reach * (final ? .9 : .82);
    w.particles.burst(x + Math.cos(a) * d, y + Math.sin(a) * d, { alpha, count: final ? 3 : 2, speed: [30, 90], life: [.12, .26], colors: tint, shape: 'spark', size: [1, 2], additive: true, angle: a, spread: .7 });
  }
  if (final) w.shake(.28);
}

/** Ort: something struck the shield face (blocked bullet / rammed enemy). */
export function shieldImpact(w: World, owner: Player, x: number, y: number, angle: number, heavy: boolean): void {
  const alpha = refugeVisualOpacity(w, owner);
  if (alpha <= 0) return;
  w.particles.burst(x, y, { alpha, count: heavy ? 12 : 7, speed: [50, heavy ? 160 : 120], life: [.12, .28], colors: ['#ffffff', '#fff2c4', '#cfe8c0', '#7aa88a'], shape: 'spark', size: [1, 2], additive: true, light: 5, angle, spread: Math.PI * .8 });
  if (heavy) w.particles.burst(x, y + 2, { alpha: alpha * .8, count: 4, speed: [10, 40], life: [.4, .7], colors: ['#8a8070', '#5c5448'], size: [2, 3], sizeEnd: 5, drag: 3, fade: true });
}

/** Ort: dust kicked up behind the moving release shield. */
export function shieldDust(w: World, owner: Player, x: number, y: number): void {
  const alpha = refugeVisualOpacity(w, owner);
  if (alpha <= 0) return;
  w.particles.burst(x, y + 3, { alpha: alpha * .7, count: 2, speed: [6, 24], life: [.35, .6], colors: ['#9a9282', '#6e665a'], size: [2, 3], sizeEnd: 4, drag: 3, fade: true, radius: 16 });
}

/** Mira: loose pages and a pale glint when the seal pulses. */
export function pageImpact(w: World, owner: Player, x: number, y: number, final: boolean): void {
  const alpha = refugeVisualOpacity(w, owner);
  if (alpha <= 0) return;
  w.particles.burst(x, y, { alpha, count: final ? 10 : 4, speed: [20, final ? 90 : 50], life: [.4, .8], colors: ['#fff8e8', '#ece0bb', '#c8d4ee'], size: [2, 2], gravity: -30, drag: 2, radius: final ? 10 : 6 });
  w.particles.burst(x, y, { alpha, count: final ? 10 : 4, speed: [30, final ? 140 : 80], life: [.12, .28], colors: ['#ffffff', '#dfe8fa', '#9fb6e0'], shape: 'spark', size: [1, 2], additive: true, light: 4 });
}

/** Mira (release): the corridor slams shut along its length. */
export function corridorClose(w: World, owner: Player, ax: number, ay: number, angle: number, length: number): void {
  const alpha = refugeVisualOpacity(w, owner);
  if (alpha <= 0) return;
  const nx = Math.cos(angle), ny = Math.sin(angle);
  for (let i = 0; i < 6; i++) {
    const d = length * (i + .5) / 6;
    pageImpact(w, owner, ax + nx * d, ay + ny * d, i % 2 === 0);
  }
  w.shake(.3);
}
