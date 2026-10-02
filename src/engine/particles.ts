// Pooled particle system. Particles live in world space; they can have a fake
// height (z) so debris bounces on the floor, emit light, fade through a color
// ramp, and optionally leave a decal where they land (blood drops, embers ...).

import { fx } from './rng';
import { VIEW_H, VIEW_W, type DrawOpts, type Renderer } from './renderer';
import type { Lighting } from './lighting';
import { TAU } from './math';
import { nativeMath } from './dmath';

export type ParticleShape = 'pixel' | 'square' | 'circle' | 'spark' | 'ring' | 'sprite';

export interface ParticleSpec {
  x: number;
  y: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** z gravity (pixels/s^2, positive pulls toward floor); 0 = floats */
  gravity?: number;
  /** velocity damping per second (0 = none, 5 = strong) */
  drag?: number;
  life: number;
  /** size at birth / death (pixels; for 'ring' = radius) */
  size?: number;
  sizeEnd?: number;
  /** colors over lifetime (sampled by age), e.g. ['#fff','#ffcc33','#aa3311'] */
  colors: string[];
  shape?: ParticleShape;
  sprite?: string;
  rot?: number;
  vrot?: number;
  alpha?: number;
  fade?: boolean;
  additive?: boolean;
  /** light radius emitted by this particle (0 = none) */
  light?: number;
  lightColor?: string;
  /** bounce coefficient when hitting the floor (z). 0 = stick */
  bounce?: number;
  /** called once when the particle lands (z reaches 0 with downward speed) */
  onLand?: (x: number, y: number) => void;
  /** draw behind entities (on the floor) */
  ground?: boolean;
}

/**
 * A pooled particle. A class with every field initialized in a fixed order, so
 * all particles share one hidden class (monomorphic, allocation-free updates).
 */
class P {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  gravity = 0;
  drag = 0;
  life = 1;
  size = 1;
  sizeEnd = 1;
  colors: string[] = NO_COLORS;
  shape: ParticleShape = 'pixel';
  rot = 0;
  vrot = 0;
  alpha = 1;
  fade = true;
  additive = false;
  light = 0;
  bounce = 0.4;
  ground = false;
  age = 0;
  landed = false;
  /** position at the start of the latest simulation step (draw interpolation) */
  px = 0;
  py = 0;
  pz = 0;
  /** spawned during the latest step: not drawn while interpolating (it does not exist yet at the drawn time) */
  fresh = true;
  sprite: string | undefined = undefined;
  onLand: ((x: number, y: number) => void) | undefined = undefined;
  lightColor: string | undefined = undefined;
}
const NO_COLORS: string[] = ['#ffffff'];

export interface BurstOpts {
  count: number;
  speed: [number, number];
  /** direction in radians; omit for all directions */
  angle?: number;
  spread?: number;
  life: [number, number];
  size?: [number, number];
  sizeEnd?: number;
  colors: string[];
  shape?: ParticleShape;
  gravity?: number;
  drag?: number;
  vz?: [number, number];
  z?: number;
  additive?: boolean;
  light?: number;
  lightColor?: string;
  bounce?: number;
  radius?: number; // spawn radius jitter
  onLand?: (x: number, y: number) => void;
  ground?: boolean;
  fade?: boolean;
  sprite?: string;
  vrot?: number;
}

/** Hard cap on live particles (scaled down further by `density`). */
export const MAX_PARTICLES = 2000;
/** cosmetic draw margin outside the view (px) */
const CULL = 6;

export class Particles {
  list: P[] = [];
  /** global density multiplier (settings / low quality: 0.25..1) */
  density = 1;
  /**
   * Draw interpolation factor between the previous and the current step
   * (set by the world around its draw; 1 = current positions, no interpolation).
   */
  alpha = 1;
  /** recycled particle objects (avoids GC churn during big bursts) */
  private pool: P[] = [];
  /** replacement cursor once the cap is reached (overwrites the oldest first) */
  private over = 0;

  /** Live particle cap for the current density. */
  get cap(): number {
    return Math.round(MAX_PARTICLES * Math.min(1, Math.max(0.3, this.density)));
  }

  /**
   * Spawn one particle. Single spawns (trails, ambient motes) are thinned out
   * when density < 1; bursts are scaled by `burst()` instead.
   */
  spawn(s: ParticleSpec): void {
    if (this.density < 1 && fx.next() > this.density) return;
    this.add(s);
  }

  /** A live particle slot: pooled, or (when full) one of the oldest recycled. */
  private alloc(): P {
    const l = this.list;
    if (l.length >= this.cap) {
      // full: recycle one of the oldest (the list is roughly ordered by age)
      if (this.over >= l.length) this.over = 0;
      return l[this.over++];
    }
    const p = this.pool.pop() ?? new P();
    l.push(p);
    return p;
  }

  private add(s: ParticleSpec): void {
    const p = this.alloc();
    p.x = s.x;
    p.y = s.y;
    p.z = s.z ?? 0;
    p.vx = s.vx ?? 0;
    p.vy = s.vy ?? 0;
    p.vz = s.vz ?? 0;
    p.gravity = s.gravity ?? 0;
    p.drag = s.drag ?? 0;
    p.life = s.life;
    p.size = s.size ?? 1;
    p.sizeEnd = s.sizeEnd ?? s.size ?? 1;
    p.colors = s.colors;
    p.shape = s.shape ?? 'pixel';
    p.rot = s.rot ?? 0;
    p.vrot = s.vrot ?? 0;
    p.alpha = s.alpha ?? 1;
    p.fade = s.fade ?? true;
    p.additive = s.additive ?? false;
    p.light = s.light ?? 0;
    // resolved once here instead of slicing a string every frame in the light pass
    p.lightColor = s.lightColor ?? (p.light > 0 ? s.colors[0].slice(0, 7) : undefined);
    p.bounce = s.bounce ?? 0.4;
    p.sprite = s.sprite;
    p.onLand = s.onLand;
    p.ground = s.ground ?? false;
    p.age = 0;
    p.landed = false;
    p.px = p.x;
    p.py = p.y;
    p.pz = p.z;
    p.fresh = true;
  }

  burst(x: number, y: number, o: BurstOpts): void {
    const n = Math.max(1, Math.round(o.count * this.density));
    const light = o.light ?? 0;
    const lightColor = o.lightColor ?? (light > 0 ? o.colors[0].slice(0, 7) : undefined);
    for (let i = 0; i < n; i++) {
      // same RNG call order as a spec-based spawn; fields written straight into the pooled particle
      const a = o.angle === undefined ? fx.angle() : o.angle + (fx.next() - 0.5) * (o.spread ?? 0.6);
      const sp = fx.range(o.speed[0], o.speed[1]);
      const rr = o.radius ? fx.next() * o.radius : 0;
      const ra = fx.angle();
      const size = o.size ? fx.range(o.size[0], o.size[1]) : 1;
      const p = this.alloc();
      p.x = x + Math.cos(ra) * rr;
      p.y = y + Math.sin(ra) * rr;
      p.z = o.z ?? 0;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.vz = o.vz ? fx.range(o.vz[0], o.vz[1]) : 0;
      p.gravity = o.gravity ?? 0;
      p.drag = o.drag ?? 2;
      p.life = fx.range(o.life[0], o.life[1]);
      p.size = size;
      p.sizeEnd = o.sizeEnd ?? size;
      p.colors = o.colors;
      p.shape = o.shape ?? 'pixel';
      p.rot = fx.angle();
      p.vrot = o.vrot ? fx.range(-o.vrot, o.vrot) : 0;
      p.alpha = 1;
      p.fade = o.fade ?? true;
      p.additive = o.additive ?? false;
      p.light = light;
      p.lightColor = lightColor;
      p.bounce = o.bounce ?? 0.4;
      p.sprite = o.sprite;
      p.onLand = o.onLand;
      p.ground = o.ground ?? false;
      p.age = 0;
      p.landed = false;
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
      p.fresh = true;
    }
  }

  /** Record every particle's position as "previous" (start of a simulation step; see `alpha`). */
  savePrev(): void {
    const l = this.list;
    for (let i = 0; i < l.length; i++) {
      const p = l[i];
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
      p.fresh = false;
    }
  }

  clear(): void {
    for (const p of this.list) this.release(p);
    this.list.length = 0;
    this.over = 0;
  }

  private release(p: P): void {
    p.onLand = undefined;
    if (this.pool.length < MAX_PARTICLES) this.pool.push(p);
  }

  update(dt: number): void {
    const l = this.list;
    let w = 0;
    this.over = 0;
    for (let i = 0; i < l.length; i++) {
      const p = l[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.release(p);
        continue;
      }
      if (p.drag) {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      if (p.gravity) {
        p.vz -= p.gravity * dt;
        p.z += p.vz * dt;
        if (p.z <= 0) {
          p.z = 0;
          if (!p.landed && p.onLand) {
            p.landed = true;
            p.onLand(p.x, p.y);
          }
          if (p.vz < -20 && p.bounce > 0) {
            p.vz = -p.vz * p.bounce;
            p.vx *= 0.6;
            p.vy *= 0.6;
          } else {
            p.vz = 0;
            p.vx *= Math.exp(-8 * dt);
            p.vy *= Math.exp(-8 * dt);
          }
        }
      } else if (p.vz) {
        p.z += p.vz * dt;
      }
      l[w++] = p;
    }
    l.length = w;
  }

  draw(r: Renderer, ground: boolean, lights?: Lighting): void {
    // two passes — normal particles, then additive ones — so the blend mode
    // changes once per layer instead of once per interleaved particle (every
    // switch splits the GPU draw batch; a release trails hundreds of glows)
    const c = r.ctx;
    c.globalCompositeOperation = 'source-over';
    if (this.drawPass(r, ground, false, lights)) {
      c.globalCompositeOperation = 'lighter';
      this.drawPass(r, ground, true, lights);
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  /** reused draw options of 'sprite' particles (no per-particle object) */
  private spriteOpts: DrawOpts = { rot: 0, alpha: 1, sx: 1, sy: 1, additive: false };
  private lightOpts = { intensity: 1 };

  /** Draw the particles of one layer and blend mode. Returns true if the layer has additive particles. */
  private drawPass(r: Renderer, ground: boolean, additive: boolean, lights?: Lighting): boolean {
    const c = r.ctx;
    const vx = r.viewX;
    const vy = r.viewY;
    const l = this.list;
    const mode = additive ? 'lighter' : 'source-over';
    const k = this.alpha;
    const lerp = k < 1;
    // canvas state is only touched when it changes (most particles share it)
    let curCol = '';
    let curAlpha = -1;
    let sawAdditive = false;
    for (let i = 0; i < l.length; i++) {
      const p = l[i];
      if (p.ground !== ground) continue;
      if (p.additive !== additive) {
        if (p.additive) sawAdditive = true;
        continue;
      }
      // interpolated position (a particle born in the latest step is not shown yet)
      let wx = p.x;
      let wy = p.y - p.z;
      if (lerp) {
        if (p.fresh) continue;
        const py = p.py - p.pz;
        wx = p.px + (wx - p.px) * k;
        wy = py + (wy - py) * k;
      }
      const t = p.age / p.life;
      const size = p.size + (p.sizeEnd - p.size) * t;
      const sx = wx - vx;
      const sy = wy - vy;
      const m = size + CULL;
      if (sx < -m || sy < -m || sx > VIEW_W + m || sy > VIEW_H + m) continue;
      const a = p.fade ? p.alpha * (1 - t * t) : p.alpha;
      if (a <= 0.01) continue;
      const cols = p.colors;
      const col = cols.length === 1 ? cols[0] : cols[Math.min(cols.length - 1, Math.floor(t * cols.length))];
      if (a !== curAlpha) {
        curAlpha = a;
        c.globalAlpha = a;
      }
      if (col !== curCol) {
        curCol = col;
        c.fillStyle = col;
      }
      switch (p.shape) {
        case 'pixel': {
          const s = size < 1.5 ? 1 : Math.round(size);
          c.fillRect(Math.round(sx - s / 2), Math.round(sy - s / 2), s, s);
          break;
        }
        case 'square': {
          // drawing only: the engine's native (fast) cos / sin, not the deterministic ports
          const cs = nativeMath.cos(p.rot);
          const sn = nativeMath.sin(p.rot);
          c.setTransform(cs, sn, -sn, cs, Math.round(sx), Math.round(sy));
          c.fillRect(-size / 2, -size / 2, size, size);
          c.setTransform(1, 0, 0, 1, 0, 0);
          break;
        }
        case 'circle': {
          c.beginPath();
          c.arc(Math.round(sx), Math.round(sy), Math.max(0.5, size), 0, TAU);
          c.fill();
          break;
        }
        case 'spark': {
          const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
          const f = sp > 0 ? Math.min(size * 3, sp * 0.04 + 1) / sp : 0;
          c.strokeStyle = col;
          c.lineWidth = Math.max(1, size * 0.5);
          c.beginPath();
          c.moveTo(sx, sy);
          c.lineTo(sx - p.vx * f, sy - p.vy * f);
          c.stroke();
          break;
        }
        case 'ring': {
          c.strokeStyle = col;
          c.lineWidth = Math.max(1, 2 * (1 - t));
          c.beginPath();
          c.arc(Math.round(sx), Math.round(sy), Math.max(0.5, size), 0, TAU);
          c.stroke();
          break;
        }
        case 'sprite': {
          if (p.sprite) {
            const o = this.spriteOpts;
            o.rot = p.rot;
            o.alpha = a;
            o.sx = size;
            o.sy = size;
            o.additive = p.additive;
            r.spriteScreen(p.sprite, sx, sy, o);
            // spriteScreen resets the canvas state
            c.globalCompositeOperation = mode;
            curCol = '';
            curAlpha = -1;
          }
          break;
        }
      }
      if (lights && p.light > 0) {
        const lo = this.lightOpts;
        lo.intensity = a;
        lights.add(wx, wy, p.light * (1 - t * 0.5), p.lightColor ?? col.slice(0, 7), lo);
      }
    }
    return sawAdditive;
  }
}
