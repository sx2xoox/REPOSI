// Light-emitting props: wall lights in five floor styles, candle clusters and
// glowing fungus patches. All are decorative, persistent and drawn on layer 0.

import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { defineAnim, defineDrawnSprite } from '../../engine/sprites';
import { animFrame } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { Prop } from './prop';
import type { Face } from '../../game/roomart';

const O = '#0c0810';

// ------------------------------------------------------------------ flames
/** Define a 4-frame flame animation `${name}` from a ramp [outer, mid, core]. */
export function defineFlame(name: string, cols: [string, string, string], w = 5, h = 9): string {
  for (let k = 0; k < 4; k++) {
    defineDrawnSprite(`${name}_${k}`, w, h, (p) => {
      const sway = [0, 0.6, 0, -0.6][k];
      const hh = h - [0, 1, 0.5, 1.5][k];
      const cx = (w - 1) / 2;
      // teardrop: wide round bottom, pointed swaying top
      for (let y = 0; y < h; y++) {
        const t = (h - 1 - y) / Math.max(1, hh - 1); // 0 bottom .. 1 tip
        if (t > 1) continue;
        const half = (w / 2) * Math.sqrt(Math.max(0, 1 - t)) * (t < 0.25 ? 0.75 + t : 1);
        const off = sway * t * 2;
        for (let x = 0; x < w; x++) {
          const dx = Math.abs(x - cx - off);
          if (dx > half) continue;
          const inner = dx / Math.max(0.5, half);
          const c = t < 0.55 && inner < 0.45 ? cols[2] : inner < 0.75 && t < 0.8 ? cols[1] : cols[0];
          p.px(x, y, c);
        }
      }
    }, { origin: [Math.floor(w / 2), h - 1] });
  }
  defineAnim(name, [0, 1, 2, 3].map((k) => `${name}_${k}`), 9);
  return name;
}

defineFlame('prop_flame', ['#e0501a', '#ffa030', '#fff2b0']);
defineFlame('prop_flame_big', ['#d03a12', '#ff8a28', '#fff0a0'], 7, 12);
defineFlame('prop_flame_blue', ['#2a6ae0', '#7ac8ff', '#f0faff']);
defineFlame('prop_flame_small', ['#e0601a', '#ffb040', '#fff6c8'], 3, 5);
defineFlame('prop_flame_small_blue', ['#3a7ae0', '#8ad0ff', '#f0faff'], 3, 5);
defineFlame('prop_flame_violet', ['#6a2ad0', '#b070ff', '#f4e0ff'], 5, 9);

// ------------------------------------------------------------------ wall light sprites
defineDrawnSprite('prop_sconce', 7, 11, (p) => {
  p.rect(2, 6, 3, 5, '#2a2630');
  p.px(3, 7, '#6a6474');
  p.px(3, 9, '#4a4454');
  p.rect(1, 4, 5, 2, '#3a3440');
  p.rect(1, 4, 5, 1, '#7a7484');
  p.rect(2, 1, 3, 3, '#5a3a20');
  p.rect(2, 1, 3, 1, '#9a6a38');
  p.px(4, 3, '#3a2410');
}, { outline: O, origin: [3, 1] });

defineDrawnSprite('prop_brazier', 13, 10, (p) => {
  // wall bracket
  p.rect(5, 6, 3, 4, '#2a2228');
  p.px(6, 8, '#5a4a48');
  // bowl
  p.ellipse(6.5, 3, 6.5, 3, '#3a3036');
  p.rect(0, 1, 13, 2, '#5a4a4a');
  p.rect(0, 1, 13, 1, '#8a7068');
  p.rect(2, 4, 9, 1, '#241c20');
  // hot coals
  p.rect(2, 0, 9, 2, '#ff6a20');
  p.px(4, 0, '#ffd060');
  p.px(8, 1, '#ffd060');
  p.px(6, 0, '#a02a10');
}, { outline: O, origin: [6, 1] });

defineDrawnSprite('prop_lantern_ice', 9, 12, (p) => {
  p.rect(4, 0, 1, 2, '#3a4a60');
  p.rect(1, 2, 7, 1, '#4a5a78');
  p.rect(1, 10, 7, 2, '#4a5a78');
  p.rect(1, 3, 7, 7, '#a8e0ff');
  p.rect(2, 3, 5, 7, '#d8f4ff');
  p.rect(1, 3, 1, 7, '#4a5a78');
  p.rect(7, 3, 1, 7, '#4a5a78');
  p.rect(4, 3, 1, 7, '#6a8aa8');
  p.rect(1, 2, 7, 1, '#8aa0c0');
}, { outline: O, origin: [4, 7] });

defineDrawnSprite('prop_shroom_wall', 13, 11, (p) => {
  // stems from the wall
  p.line(3, 10, 3, 6, '#a8b8a0');
  p.line(8, 10, 7, 4, '#a8b8a0');
  p.line(11, 10, 11, 7, '#a8b8a0');
  // caps
  p.ellipse(3, 5.5, 3, 2, '#1a8a7a');
  p.ellipse(7.5, 3.5, 4, 2.6, '#1a9a86');
  p.ellipse(11, 6.5, 2.4, 1.6, '#1a8a7a');
  p.rect(1, 6, 5, 1, '#0e5a50');
  p.rect(4, 4, 8, 1, '#0e5a50');
  // spots
  p.px(6, 2, '#b8fff0');
  p.px(8, 3, '#b8fff0');
  p.px(2, 5, '#b8fff0');
  p.px(11, 6, '#b8fff0');
}, { outline: O, origin: [6, 10] });

defineDrawnSprite('prop_shroom_glow', 13, 11, (p) => {
  p.ellipse(3, 5.5, 3, 2, '#40ffd8');
  p.ellipse(7.5, 3.5, 4, 2.6, '#60ffe0');
  p.ellipse(11, 6.5, 2.4, 1.6, '#40ffd8');
}, { origin: [6, 10] });

defineDrawnSprite('prop_void_bracket', 7, 4, (p) => {
  p.rect(0, 0, 7, 1, '#2a1a3a');
  p.rect(1, 1, 5, 1, '#1a1024');
  p.rect(3, 2, 1, 2, '#1a1024');
  p.px(1, 0, '#6a4a8a');
}, { outline: O, origin: [3, 0] });

defineDrawnSprite('prop_void_crystal', 7, 11, (p) => {
  p.poly([3.5, 0, 7, 5, 3.5, 11, 0, 5], '#7a3ad0');
  p.poly([3.5, 0, 3.5, 11, 0, 5], '#a868ff');
  p.line(3, 1, 1, 5, '#e8d0ff');
  p.px(2, 4, '#ffffff');
  p.line(4, 6, 5, 8, '#4a1a90');
}, { outline: '#12061e', origin: [3, 5] });

// ------------------------------------------------------------------ wall light entity
export type WallLightStyle = 'torch' | 'brazier' | 'ice' | 'shroom' | 'void';

const STYLE_LIGHT: Record<WallLightStyle, { color: string; radius: number; intensity: number }> = {
  torch: { color: '#ffa850', radius: 74, intensity: 0.85 },
  brazier: { color: '#ff7a30', radius: 88, intensity: 0.9 },
  ice: { color: '#7ac0ff', radius: 72, intensity: 0.8 },
  shroom: { color: '#40e0c0', radius: 58, intensity: 0.75 },
  void: { color: '#a050ff', radius: 66, intensity: 0.75 },
};

/** A light source mounted on a wall face. */
export class WallLight extends Prop {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  style: WallLightStyle;
  face: Face;
  constructor(x: number, y: number, style: WallLightStyle, face: Face = 'top') {
    super(x, y, 0);
    this.style = style;
    this.face = face;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const st = this.style;
    if (st === 'torch' || st === 'brazier') {
      if (fx.chance(dt * (st === 'brazier' ? 14 : 7))) {
        w.particles.spawn({
          x: this.x + fx.range(-1.5, 1.5) * (st === 'brazier' ? 2.5 : 1), y: this.y - (st === 'brazier' ? 8 : 6),
          vx: fx.range(-5, 5), vy: -fx.range(14, 30), life: fx.range(0.35, 0.8), drag: 1,
          colors: ['#fff0a0', '#ffa040', '#a03010'], size: 1, additive: true,
        });
      }
    } else if (st === 'shroom') {
      if (fx.chance(dt * 1.2)) {
        w.particles.spawn({
          x: this.x + fx.range(-5, 5), y: this.y - 6, vx: fx.range(-4, 4), vy: -fx.range(3, 9), life: fx.range(1.5, 3),
          colors: ['#a0fff0', '#40e0c0'], size: 1, additive: true, alpha: 0.8,
        });
      }
    } else if (st === 'void') {
      if (fx.chance(dt * 1.5)) {
        w.particles.spawn({
          x: this.x + fx.range(-4, 4), y: this.y - 4 + fx.range(-4, 4), vx: fx.range(-3, 3), vy: -fx.range(4, 10), life: fx.range(1, 2),
          colors: ['#e0c0ff', '#9050f0', '#40107a'], size: 1, additive: true,
        });
      }
    } else if (st === 'ice' && fx.chance(dt * 0.8)) {
      w.particles.spawn({ x: this.x + fx.range(-3, 3), y: this.y + 4, vy: fx.range(4, 10), life: 1.2, colors: ['#e0f4ff'], size: 1, alpha: 0.7 });
    }
  }

  override draw(r: Renderer): void {
    const t = this.age;
    switch (this.style) {
      case 'torch':
        r.sprite('prop_sconce', this.x, this.y);
        r.sprite(animFrame('prop_flame', t), this.x, this.y);
        break;
      case 'brazier':
        r.sprite('prop_brazier', this.x, this.y);
        r.sprite(animFrame('prop_flame_big', t), this.x, this.y + 1);
        break;
      case 'ice':
        r.sprite('prop_lantern_ice', this.x, this.y);
        r.sprite(animFrame('prop_flame_small_blue', t), this.x, this.y + 2);
        break;
      case 'shroom': {
        r.sprite('prop_shroom_wall', this.x, this.y);
        const pulse = 0.35 + 0.25 * Math.sin(t * 2.2);
        r.sprite('prop_shroom_glow', this.x, this.y, { alpha: pulse, additive: true });
        break;
      }
      case 'void': {
        r.sprite('prop_void_bracket', this.x, this.y + 6);
        const bob = Math.round(Math.sin(t * 1.8) * 1.5);
        r.sprite('prop_void_crystal', this.x, this.y - 2 + bob, { flash: 0.15 + 0.15 * Math.sin(t * 3.1) });
        break;
      }
    }
  }

  override light(w: World): void {
    const L = STYLE_LIGHT[this.style];
    const fl = this.style === 'torch' || this.style === 'brazier'
      ? 1 + Math.sin(this.age * 13) * 0.05 + Math.sin(this.age * 29) * 0.04
      : 1 + Math.sin(this.age * 2.2) * 0.06;
    const ly = this.style === 'brazier' ? this.y - 4 : this.y - 3;
    w.lights.add(this.x, ly, L.radius * fl, L.color, { intensity: L.intensity });
    w.lights.glow(this.x, ly - 1, this.style === 'brazier' ? 14 : 9, L.color, 0.22 * fl);
  }
}

// ------------------------------------------------------------------ candles
defineDrawnSprite('prop_candle_tall', 3, 9, (p) => {
  p.rect(0, 1, 3, 8, '#e8dcc0');
  p.rect(2, 1, 1, 8, '#b8a888');
  p.px(0, 1, '#fff8e8');
  p.px(1, 0, '#3a2a1a');
  p.px(0, 4, '#fff8e8');
}, { outline: O, origin: [1, 0] });
defineDrawnSprite('prop_candle_short', 3, 5, (p) => {
  p.rect(0, 1, 3, 4, '#e0d4b8');
  p.rect(2, 1, 1, 4, '#b0a080');
  p.px(0, 1, '#fff8e8');
  p.px(1, 0, '#3a2a1a');
}, { outline: O, origin: [1, 0] });
defineDrawnSprite('prop_wax', 11, 4, (p) => {
  p.ellipse(5.5, 2, 5.5, 2, '#c8bca0');
  p.ellipse(4.5, 1.5, 3, 1, '#e8dcc0');
}, { origin: [5, 2] });

export type CandleTone = 'warm' | 'cold' | 'blood';
const CANDLE_TONE: Record<CandleTone, { flame: string; light: string }> = {
  warm: { flame: 'prop_flame_small', light: '#ffb868' },
  cold: { flame: 'prop_flame_small_blue', light: '#80c0ff' },
  blood: { flame: 'prop_flame_small_blood', light: '#ff4a7a' },
};
defineFlame('prop_flame_small_blood', ['#a01040', '#ff4070', '#ffd0e0'], 3, 5);

/** A small cluster of lit candles standing on the floor (no collision). */
export class Candles extends Prop {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  items: { dx: number; dy: number; tall: boolean }[];
  tone: CandleTone;
  /** `tone` also accepts a boolean (true = cold blue flames) */
  constructor(x: number, y: number, n = 3, tone: CandleTone | boolean = 'warm') {
    super(x, y, 0);
    this.tone = tone === true ? 'cold' : tone === false ? 'warm' : tone;
    this.items = [];
    const spots: [number, number][] = [[0, 0], [-4, 2], [4, 1], [-2, -2], [3, -3]];
    for (let i = 0; i < Math.min(n, spots.length); i++) this.items.push({ dx: spots[i][0], dy: spots[i][1], tall: (i + n) % 2 === 0 });
    this.items.sort((a, b) => a.dy - b.dy);
  }

  override draw(r: Renderer): void {
    r.sprite('prop_wax', this.x, this.y + 3);
    const flame = CANDLE_TONE[this.tone].flame;
    for (const c of this.items) {
      const h = c.tall ? 9 : 5;
      const bx = this.x + c.dx;
      const by = this.y + c.dy + 3 - h;
      r.sprite(c.tall ? 'prop_candle_tall' : 'prop_candle_short', bx, by);
      r.sprite(animFrame(flame, this.age + c.dx), bx, by);
    }
  }

  override light(w: World): void {
    const fl = 1 + Math.sin(this.age * 11) * 0.06;
    const col = CANDLE_TONE[this.tone].light;
    w.lights.add(this.x, this.y - 4, 44 * fl, col, { intensity: 0.75 });
    w.lights.glow(this.x, this.y - 5, 7, col, 0.2);
  }
}

// ------------------------------------------------------------------ glowing fungus patch
defineDrawnSprite('prop_shroom_a', 5, 6, (p) => {
  p.rect(2, 3, 1, 3, '#c8d8c0');
  p.ellipse(2.5, 2, 2.5, 1.8, '#1aa08a');
  p.rect(0, 2, 5, 1, '#0e6a5a');
  p.px(1, 1, '#c0fff0');
}, { outline: O, origin: [2, 5] });
defineDrawnSprite('prop_shroom_b', 3, 4, (p) => {
  p.px(1, 2, '#c8d8c0');
  p.px(1, 3, '#c8d8c0');
  p.rect(0, 0, 3, 2, '#20b098');
  p.px(0, 0, '#c0fff0');
}, { outline: O, origin: [1, 3] });
defineDrawnSprite('prop_shroom_dot', 3, 2, (p) => {
  p.rect(0, 0, 3, 2, '#60ffe0');
}, { origin: [1, 1] });

/** Cluster of bioluminescent mushrooms on the floor (caves). */
export class GlowShrooms extends Prop {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  items: { dx: number; dy: number; big: boolean; ph: number }[] = [];
  color: string;
  constructor(x: number, y: number, n = 4, color = '#40e0c0') {
    super(x, y, 0);
    this.color = color;
    for (let i = 0; i < n; i++) {
      this.items.push({ dx: Math.round(fx.range(-7, 7)), dy: Math.round(fx.range(-4, 4)), big: i < 2, ph: fx.range(0, 6) });
    }
    this.items.sort((a, b) => a.dy - b.dy);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (fx.chance(dt * 0.9)) {
      w.particles.spawn({
        x: this.x + fx.range(-6, 6), y: this.y - 3, vx: fx.range(-3, 3), vy: -fx.range(4, 10), life: fx.range(1.5, 3),
        colors: ['#b0fff0', this.color], size: 1, additive: true, alpha: 0.8,
      });
    }
  }

  override draw(r: Renderer): void {
    for (const s of this.items) {
      const name = s.big ? 'prop_shroom_a' : 'prop_shroom_b';
      r.sprite(name, this.x + s.dx, this.y + s.dy);
      const a = 0.25 + 0.2 * Math.sin(this.age * 2 + s.ph);
      r.sprite('prop_shroom_dot', this.x + s.dx, this.y + s.dy - (s.big ? 3 : 2), { alpha: a, additive: true });
    }
  }

  override light(w: World): void {
    const k = 1 + Math.sin(this.age * 2) * 0.08;
    w.lights.add(this.x, this.y - 2, 46 * k, this.color, { intensity: 0.7 });
  }
}
