// Pooled particle system. Particles live in world space; they can have a fake
// height (z) so debris bounces on the floor, emit light, fade through a color
// ramp, and optionally leave a decal where they land (blood drops, embers ...).

import { fx } from './rng';
import type { Renderer } from './renderer';
import type { Lighting } from './lighting';
import { TAU } from './math';

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

interface P extends Required<Omit<ParticleSpec, 'sprite' | 'onLand' | 'lightColor'>> {
  sprite?: string;
  onLand?: (x: number, y: number) => void;
  lightColor?: string;
  age: number;
  landed: boolean;
}

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

const MAX_PARTICLES = 2500;

export class Particles {
  list: P[] = [];
  /** global density multiplier (settings) */
  density = 1;

  spawn(s: ParticleSpec): void {
    if (this.list.length >= MAX_PARTICLES) this.list.shift();
    this.list.push({
      x: s.x, y: s.y, z: s.z ?? 0,
      vx: s.vx ?? 0, vy: s.vy ?? 0, vz: s.vz ?? 0,
      gravity: s.gravity ?? 0, drag: s.drag ?? 0,
      life: s.life, size: s.size ?? 1, sizeEnd: s.sizeEnd ?? s.size ?? 1,
      colors: s.colors, shape: s.shape ?? 'pixel', rot: s.rot ?? 0, vrot: s.vrot ?? 0,
      alpha: s.alpha ?? 1, fade: s.fade ?? true, additive: s.additive ?? false,
      light: s.light ?? 0, lightColor: s.lightColor, bounce: s.bounce ?? 0.4,
      sprite: s.sprite, onLand: s.onLand, ground: s.ground ?? false,
      age: 0, landed: false,
    });
  }

  burst(x: number, y: number, o: BurstOpts): void {
    const n = Math.max(1, Math.round(o.count * this.density));
    for (let i = 0; i < n; i++) {
      const a = o.angle === undefined ? fx.angle() : o.angle + (fx.next() - 0.5) * (o.spread ?? 0.6);
      const sp = fx.range(o.speed[0], o.speed[1]);
      const rr = o.radius ? fx.next() * o.radius : 0;
      const ra = fx.angle();
      const size = o.size ? fx.range(o.size[0], o.size[1]) : 1;
      this.spawn({
        x: x + Math.cos(ra) * rr,
        y: y + Math.sin(ra) * rr,
        z: o.z ?? 0,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        vz: o.vz ? fx.range(o.vz[0], o.vz[1]) : 0,
        gravity: o.gravity ?? 0,
        drag: o.drag ?? 2,
        life: fx.range(o.life[0], o.life[1]),
        size,
        sizeEnd: o.sizeEnd ?? size,
        colors: o.colors,
        shape: o.shape ?? 'pixel',
        additive: o.additive,
        light: o.light,
        lightColor: o.lightColor,
        bounce: o.bounce,
        onLand: o.onLand,
        ground: o.ground,
        fade: o.fade,
        sprite: o.sprite,
        rot: fx.angle(),
        vrot: o.vrot ? fx.range(-o.vrot, o.vrot) : 0,
      });
    }
  }

  clear(): void {
    this.list.length = 0;
  }

  update(dt: number): void {
    const l = this.list;
    let w = 0;
    for (let i = 0; i < l.length; i++) {
      const p = l[i];
      p.age += dt;
      if (p.age >= p.life) continue;
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
    const c = r.ctx;
    const vx = r.viewX;
    const vy = r.viewY;
    for (const p of this.list) {
      if (p.ground !== ground) continue;
      const t = p.age / p.life;
      const ci = Math.min(p.colors.length - 1, Math.floor(t * p.colors.length));
      const col = p.colors[ci];
      const size = p.size + (p.sizeEnd - p.size) * t;
      const a = p.fade ? p.alpha * (1 - t * t) : p.alpha;
      if (a <= 0.01) continue;
      const sx = p.x - vx;
      const sy = p.y - p.z - vy;
      c.globalAlpha = a;
      c.globalCompositeOperation = p.additive ? 'lighter' : 'source-over';
      c.fillStyle = col;
      switch (p.shape) {
        case 'pixel': {
          const s = Math.max(1, Math.round(size));
          c.fillRect(Math.round(sx - s / 2), Math.round(sy - s / 2), s, s);
          break;
        }
        case 'square': {
          c.save();
          c.translate(Math.round(sx), Math.round(sy));
          c.rotate(p.rot);
          c.fillRect(-size / 2, -size / 2, size, size);
          c.restore();
          break;
        }
        case 'circle': {
          c.beginPath();
          c.arc(Math.round(sx), Math.round(sy), Math.max(0.5, size), 0, TAU);
          c.fill();
          break;
        }
        case 'spark': {
          const sp = Math.hypot(p.vx, p.vy);
          const k = sp > 0 ? Math.min(size * 3, sp * 0.04 + 1) / sp : 0;
          c.strokeStyle = col;
          c.lineWidth = Math.max(1, size * 0.5);
          c.beginPath();
          c.moveTo(sx, sy);
          c.lineTo(sx - p.vx * k, sy - p.vy * k);
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
          if (p.sprite) r.spriteScreen(p.sprite, sx, sy, { rot: p.rot, alpha: a, sx: size, sy: size, additive: p.additive });
          break;
        }
      }
      if (lights && p.light > 0) lights.add(p.x, p.y - p.z, p.light * (1 - t * 0.5), p.lightColor ?? col.slice(0, 7), { intensity: a });
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }
}
