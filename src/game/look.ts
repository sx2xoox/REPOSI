// Artifact presence ("흔적"): every artifact declares a small, declarative visual
// contribution (`ArtifactDef.look`) — shot color layers, a shot shape, extra shot
// size, a trail, tiny satellites around each shot, motes circling the keeper, a
// feet aura ring, footstep / dash sparkles and impact sparks. The composer folds
// all held artifacts into ONE ShotLook (shared by every shot until the
// inventory changes; composed sprites are cached per quantized size) and one
// PlayerLook (drawn by a floor-layer entity + the item draw pass). Effects stack
// and combine, like tears evolving in Isaac, while costing ~one extra sprite
// draw per shot.

import { Entity } from './entity';
import type { World } from './world';
import type { Projectile } from './projectile';
import type { Player } from './player';
import type { ArtifactDef, Rarity } from './defs';
import type { DrawOpts, Renderer } from '../engine/renderer';
import type { HitInfo, Actor } from './entity';
import { defineDrawnSprite, hasSprite } from '../engine/sprites';
import { lighten, ramp, type PixelPainter } from '../engine/painter';
import { mixColor } from '../engine/math';
import { fx } from '../engine/rng';

export type ShotShape = 'orb' | 'flame' | 'shard' | 'star' | 'needle' | 'bubble' | 'gear' | 'crescent' | 'spark';
export type TrailKind = 'ember' | 'frost' | 'drip' | 'stardust' | 'smoke' | 'static' | 'bubble' | 'petal' | 'coin' | 'wind' | 'sand' | 'comet';

/** Visible traces of one artifact (all optional; combine freely). */
export interface ArtifactLook {
  /** shot color layer: the highest-rarity layer colors the body, the next ones the rim, core and sparkles */
  shot?: string;
  /** shot silhouette (highest rarity wins) */
  shape?: ShotShape;
  /** extra visual shot diameter in px (stacks; visual only) */
  grow?: number;
  /** particles left behind by shots */
  trail?: TrailKind;
  /** a tiny satellite pixel circling every shot */
  orbit?: string;
  /** a glowing mote circling the keeper */
  mote?: string;
  /** feet aura ring segment color */
  aura?: string;
  /** footstep / dash sparkle color */
  step?: string;
  /** impact spark color when attacks hit */
  hit?: string;
}

export interface LookSource {
  def: ArtifactDef;
  power: number;
  order: number;
}

const RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };
const OUT = '#1a0d14';

/** True when the look declares at least one visible contribution. */
export function lookIsVisible(l: ArtifactLook | undefined): boolean {
  return !!l && Object.values(l).some((v) => v !== undefined && v !== 0 && v !== '');
}

// ====================================================================== shot look
const SHAPE_ROTATES: Record<ShotShape, 'aim' | 'spin' | 'none'> = {
  orb: 'none', bubble: 'none', crescent: 'aim', flame: 'aim', shard: 'aim', needle: 'aim', star: 'spin', gear: 'spin', spark: 'spin',
};
const ELONGATED: Partial<Record<ShotShape, number>> = { flame: 1.6, needle: 1.9, shard: 1.45 };
/** spiky / hollow silhouettes read smaller than a disk: draw them a bit bigger */
const SHAPE_GROW: Partial<Record<ShotShape, number>> = { star: 2, gear: 2, spark: 2, crescent: 1, bubble: 1, shard: 1 };

const shotNames = new Map<string, string>();

export function paintShot(p: PixelPainter, shape: ShotShape, W: number, H: number, body: string, rim: string | null, core: string | null): void {
  const r = H / 2;
  const cy = H / 2;
  const R = ramp(body, 4, 0.9);
  const hi = core ?? lighten(body, 0.55);
  const edge = rim ?? lighten(body, 0.3);
  switch (shape) {
    case 'flame': {
      const hx = W - r;
      p.poly([0, cy, hx - r * 0.2, cy - r * 0.95, hx, cy - r, hx, cy + r, hx - r * 0.2, cy + r * 0.95], body);
      p.circle(hx, cy, r, body);
      p.shadeSphere(hx, cy, r * 1.8, r, R, { dither: false, lightX: 0.2 });
      if (H >= 5) p.poly([W * 0.25, cy, hx - r * 0.1, cy - r * 0.55, hx + r * 0.5, cy, hx - r * 0.1, cy + r * 0.55], edge);
      p.circle(hx + r * 0.15, cy, Math.max(0.7, r * 0.38), hi);
      break;
    }
    case 'shard': {
      p.poly([0, cy, W * 0.58, 0, W, cy, W * 0.58, H], body);
      p.poly([0, cy, W * 0.58, 0, W, cy], lighten(body, 0.25));
      if (H >= 5) p.line(1, Math.floor(cy), W - 2, Math.floor(cy), edge);
      p.px(Math.round(W * 0.6), Math.floor(cy) - 1, hi);
      if (H >= 7) p.px(Math.round(W * 0.6) + 1, Math.floor(cy) - 1, '#ffffff');
      break;
    }
    case 'needle': {
      const h = Math.max(2, Math.round(H * 0.4));
      const y0 = Math.round(cy - h / 2);
      const tip = Math.max(3, h + 1);
      p.rect(2, y0, W - tip - 2, h, body);
      p.poly([W - tip, y0 - 0.5, W, cy, W - tip, y0 + h + 0.5], lighten(body, 0.2));
      p.line(2, y0, W - tip, y0, edge);
      if (h >= 3) p.line(2, y0 + h - 1, W - tip, y0 + h - 1, R[0]);
      // fletching in the rim color
      p.line(0, y0 - 1, 2, y0, edge);
      p.line(0, y0 + h, 2, y0 + h - 1, edge);
      p.px(W - 2, Math.floor(cy), hi);
      p.px(W - 3, Math.floor(cy), hi);
      break;
    }
    case 'star': {
      const pts: number[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.42;
        pts.push(r + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      p.poly(pts, body);
      p.shadeSphere(r, cy, r, r, R, { dither: false });
      p.circle(r, cy, Math.max(0.8, r * 0.34), edge);
      p.px(Math.floor(r), Math.floor(cy), hi);
      break;
    }
    case 'bubble': {
      p.circle(r, cy, r, body + '70');
      p.ring(r, cy, r, Math.max(1, Math.round(r * 0.28)), edge);
      p.px(Math.round(r * 0.55), Math.round(cy * 0.55), '#ffffff');
      if (H >= 7) p.px(Math.round(r * 0.55) + 1, Math.round(cy * 0.55), hi);
      break;
    }
    case 'gear': {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        p.circle(r + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78, Math.max(0.6, r * 0.24), body);
      }
      p.circle(r, cy, r * 0.74, body);
      p.shadeSphere(r, cy, r, r, R, { dither: false });
      p.circle(r, cy, Math.max(0.6, r * 0.28), core ?? R[0]);
      if (rim && H >= 6) p.ring(r, cy, r * 0.62, 1, rim);
      break;
    }
    case 'crescent': {
      p.circle(r, cy, r, body);
      p.shadeSphere(r, cy, r, r, R, { dither: false });
      if (H >= 6) p.circle(r - r * 0.42, cy, r * 0.84, edge);
      p.circle(r - r * 0.55, cy, r * 0.8, null);
      p.circle(r * 1.45, cy, Math.max(0.6, r * 0.22), hi);
      break;
    }
    case 'spark': {
      const t = Math.max(1, Math.round(r * 0.35));
      p.poly([r, 0, r + t, cy - t, W, cy, r + t, cy + t, r, H, r - t, cy + t, 0, cy, r - t, cy - t], body);
      p.poly([r, 0, r + t, cy - t, r, cy, r - t, cy - t], edge);
      p.circle(r, cy, Math.max(0.7, r * 0.3), hi);
      break;
    }
    default: {
      p.circle(r, cy, r, body);
      if (H >= 4) p.shadeSphere(r, cy, r, r, R, { dither: H >= 8 });
      if (rim && H >= 5) p.ring(r, cy, r, 1, rim);
      if (core && H >= 5) p.circle(r + 0.2, cy + 0.2, Math.max(0.8, r * 0.36), core);
      const h = Math.max(0, Math.round(r - r * 0.45 - 0.5));
      p.px(h, h, '#ffffff');
    }
  }
}

/** Composite projectile appearance of the current inventory. */
export class ShotLook {
  constructor(
    readonly shape: ShotShape,
    readonly body: string | null,
    readonly rim: string | null,
    readonly core: string | null,
    readonly grow: number,
    readonly trails: TrailKind[],
    readonly trailCol: string[],
    readonly orbits: string[],
    readonly glow: boolean,
    readonly layers: number,
  ) {}

  get mode(): 'aim' | 'spin' | 'none' {
    return SHAPE_ROTATES[this.shape];
  }

  /** Sprite name for a shot of visual diameter d (cached; defined lazily). */
  sprite(d: number, body: string): string {
    const key = `${this.shape}|${d}|${body}|${this.rim ?? ''}|${this.core ?? ''}`;
    let name = shotNames.get(key);
    if (name) return name;
    name = `__shot_${key.replace(/[|#]/g, '_')}`;
    shotNames.set(key, name);
    if (!hasSprite(name)) {
      const H = d;
      const W = Math.round(d * (ELONGATED[this.shape] ?? 1));
      const shape = this.shape;
      const rim = this.rim;
      const core = this.core;
      defineDrawnSprite(name, W, H, (p) => paintShot(p, shape, W, H, body, rim, core), { outline: OUT });
    }
    return name;
  }
}

const glowNames = new Map<string, string>();
/** Soft round glow (additive use), cached per size/color. */
export function lookGlow(d: number, color: string): string {
  const D = Math.max(4, Math.min(40, Math.round(d / 2) * 2));
  const key = `${D}${color}`;
  let name = glowNames.get(key);
  if (name) return name;
  name = `__lkglow_${D}_${color.slice(1)}`;
  glowNames.set(key, name);
  if (!hasSprite(name)) {
    defineDrawnSprite(name, D, D, (p) => {
      const r = D / 2;
      for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
        const k = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
        if (k >= 1) continue;
        const a = Math.round((1 - k) * (1 - k) * 200);
        if (a > 6) p.px(x, y, color + a.toString(16).padStart(2, '0'));
      }
    });
  }
  return name;
}

const TRAIL_COLORS: Record<TrailKind, string[]> = {
  ember: ['#ffe080', '#ff9a30', '#c04010'],
  frost: ['#ffffff', '#c8f4ff', '#7ad0f0'],
  drip: ['#ff6a7a', '#c01828'],
  stardust: ['#ffffff', '#fff2b0', '#d8c8ff'],
  smoke: ['#4a3a5a90', '#2a1e3880'],
  static: ['#ffffff', '#fff6a0', '#ffe95a'],
  bubble: ['#d8ffb0', '#8aff5a'],
  petal: ['#ffc0e8', '#ff8ac8'],
  coin: ['#fff6c0', '#ffd040'],
  wind: ['#ffffffc0', '#d8e8ff90'],
  sand: ['#f0d8a0', '#c8a060'],
  comet: ['#ffffff', '#d8c8ff', '#8a7ae0'],
};

/** One trail particle for shot `p` (called at the projectile's trail rate). */
export function shotTrail(p: Projectile, w: World, look: ShotLook): void {
  const n = (p.trailN = (p.trailN + 1) % 1024);
  const kinds = look.trails;
  const x = p.x + fx.range(-1, 1);
  const y = p.y - p.z + fx.range(-1, 1);
  const s = Math.max(1, p.r * 0.6);
  if (!kinds.length || n % (kinds.length + 1) === 0) {
    // the body color trail (also keeps the shot's own identity)
    w.particles.spawn({ x, y, life: 0.18, colors: [p.color, look.trailCol[0] ?? p.color], size: s, sizeEnd: 0.5, shape: 'pixel' });
    return;
  }
  const kind = kinds[n % (kinds.length + 1) - 1];
  const cols = TRAIL_COLORS[kind];
  const back = p.angle + Math.PI;
  switch (kind) {
    case 'ember':
      w.particles.spawn({ x, y, vx: fx.range(-8, 8), vy: -fx.range(15, 35), life: 0.4, colors: cols, size: 1, shape: 'pixel', additive: true });
      break;
    case 'frost':
      w.particles.spawn({ x, y, vx: fx.range(-6, 6), vy: fx.range(4, 14), life: 0.5, colors: cols, size: 1, shape: 'square', vrot: 6 });
      break;
    case 'drip':
      w.particles.spawn({ x, y, vy: 10, gravity: 220, life: 0.35, colors: [look.trailCol[1] ?? cols[0], cols[1]], size: 1, shape: 'pixel' });
      break;
    case 'stardust':
      w.particles.spawn({ x: x + fx.range(-2, 2), y: y + fx.range(-2, 2), life: 0.32, colors: cols, size: fx.chance(0.3) ? 2 : 1, sizeEnd: 0, shape: 'spark', additive: true, rot: fx.angle() });
      break;
    case 'smoke':
      w.particles.spawn({ x, y, vy: -6, life: 0.5, colors: cols, size: 2, sizeEnd: 4, shape: 'circle' });
      break;
    case 'static':
      w.particles.spawn({ x, y, vx: fx.range(-40, 40), vy: fx.range(-40, 40), drag: 8, life: 0.12, colors: cols, size: 1, shape: 'spark', additive: true, rot: fx.angle() });
      break;
    case 'bubble':
      w.particles.spawn({ x, y, vx: fx.range(-5, 5), vy: -fx.range(6, 14), life: 0.45, colors: cols, size: 2, sizeEnd: 1, shape: 'ring' });
      break;
    case 'petal':
      w.particles.spawn({ x, y, vx: Math.cos(back) * 20 + fx.range(-10, 10), vy: Math.sin(back) * 20 + 8, drag: 2, life: 0.5, colors: cols, size: 2, shape: 'square', vrot: fx.range(-8, 8) });
      break;
    case 'coin':
      if (n % 3 === 0) w.particles.spawn({ x, y, life: 0.3, colors: cols, size: 1, shape: 'spark', additive: true, rot: 0 });
      break;
    case 'wind':
      w.particles.spawn({ x, y, vx: Math.cos(back) * 30, vy: Math.sin(back) * 30, life: 0.14, colors: cols, size: 2, sizeEnd: 1, shape: 'spark', rot: p.angle });
      break;
    case 'sand':
      w.particles.spawn({ x, y, vx: fx.range(-6, 6), vy: 0, gravity: 160, life: 0.3, colors: cols, size: 1, shape: 'pixel' });
      break;
    case 'comet':
      w.particles.spawn({ x, y, life: 0.28, colors: [look.trailCol[0] ?? cols[1], cols[2]], size: Math.max(1.5, p.r), sizeEnd: 0.5, shape: 'circle', additive: true });
      break;
  }
}

/** Draw a shot with the composed look (style orb / tear / sprite). */
/** reused draw options for shots (drawn every frame, many at once) */
const SHOT_GLOW: DrawOpts = { additive: true, alpha: 0.5 };
const SHOT_ROT: DrawOpts = { rot: 0 };
/** shot sprite name -> its glow sprite name */
const shotGlow = new Map<string, string>();

export function drawShot(p: Projectile, r: Renderer, look: ShotLook, dy: number): void {
  if (p.style === 'sprite' && p.sprite) {
    if (look.glow) r.sprite(lookGlow(14, look.body ?? p.color.slice(0, 7)), p.x, dy, { additive: true, alpha: 0.45 });
    r.sprite(p.sprite, p.x, dy, { rot: p.spriteRotates ? p.angle : 0, sx: p.scale, sy: p.scale });
  } else {
    const d = Math.max(3, Math.min(30, Math.round((p.r * 2 + 1) * p.scale + look.grow)));
    const body = p.color === p.lookBase && look.body ? look.body : p.color.slice(0, 7);
    if (d !== p.lookD || body !== p.lookBody) {
      p.lookD = d;
      p.lookBody = body;
      p.lookName = look.sprite(d, body);
    }
    if (look.glow) {
      // glow sprite per shot sprite (same size & body): no name building per draw
      let gn = shotGlow.get(p.lookName);
      if (!gn) shotGlow.set(p.lookName, (gn = lookGlow(d * 2 + 4, body)));
      r.sprite(gn, p.x, dy, SHOT_GLOW);
    }
    const rot = look.mode === 'aim' ? p.angle : look.mode === 'spin' ? p.age * 10 : p.style === 'tear' ? p.angle : 0;
    if (rot) SHOT_ROT.rot = rot;
    r.sprite(p.lookName, p.x, dy, rot ? SHOT_ROT : undefined);
  }
  const orb = look.orbits;
  if (orb.length) {
    const rad = p.r * p.scale + 3;
    for (let i = 0; i < orb.length; i++) {
      const a = p.age * 13 + (i / orb.length) * Math.PI * 2;
      r.rect(p.x + Math.cos(a) * rad - 0.5, dy + Math.sin(a) * rad * 0.8 - 0.5, 1, 1, orb[i]);
    }
  }
}

// ====================================================================== player look
interface Mote {
  color: string;
  rx: number;
  speed: number;
  phase: number;
  big: boolean;
}

const moteNames = new Map<string, string>();
/** A glowing mote: plus-shaped core with a soft halo baked in (one draw, normal blending). */
function moteSprite(color: string, big: boolean): string {
  const key = `${color}${big ? 1 : 0}`;
  let n = moteNames.get(key);
  if (n) return n;
  n = `__mote_${big ? 'b' : 's'}_${color.slice(1)}`;
  moteNames.set(key, n);
  if (!hasSprite(n)) {
    const D = big ? 10 : 9;
    defineDrawnSprite(n, D, D, (p) => {
      const c = (D - 1) / 2;
      for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
        const k = Math.hypot(x - c, y - c) / (D / 2);
        if (k < 1) p.px(x, y, color + Math.round((1 - k) * (1 - k) * 110).toString(16).padStart(2, '0'));
      }
      const m = Math.round(c);
      const arm = big ? 2 : 1;
      // dark rim around the core so motes read on bright floors too
      for (let i = -arm - 1; i <= arm + 1; i++) {
        p.px(m + i, m, '#140c1c');
        p.px(m, m + i, '#140c1c');
      }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) p.px(m + dx, m + dy, '#140c1c');
      for (let i = -arm; i <= arm; i++) {
        p.px(m + i, m, color);
        p.px(m, m + i, color);
      }
      p.px(Math.round(c), Math.round(c), '#ffffff');
      if (big) p.px(Math.round(c) - 1, Math.round(c) - 1, '#ffffffc0');
    });
  }
  return n;
}

const auraNames = new Map<string, string>();
const AURA_FRAMES = 8;
/** Feet ring: dashed ellipse in the aura colors, AURA_FRAMES rotation frames. */
function auraSprite(cols: string[], frame: number): string {
  const key = `${cols.join('')}${frame}`;
  let n = auraNames.get(key);
  if (n) return n;
  n = `__aura_${cols.map((c) => c.slice(1)).join('_')}_${frame}`;
  auraNames.set(key, n);
  if (!hasSprite(n)) {
    defineDrawnSprite(n, 31, 13, (p) => {
      const seg = 16;
      for (let i = 0; i < seg; i++) {
        if (i % 2 === 1) continue;
        const col = cols[(i >> 1) % cols.length];
        for (let k = 0; k < 4; k++) {
          const a = ((i + k / 4 + frame / AURA_FRAMES * 2) / seg) * Math.PI * 2;
          const x = Math.round(15 + Math.cos(a) * 14.5);
          const y = Math.round(5.5 + Math.sin(a) * 5.2);
          p.px(x, y, sinFront(a) ? col : col + 'a0');
          if (sinFront(a)) p.px(x, y + 1, col + '90');
        }
      }
    });
  }
  return n;
}
const sinFront = (a: number) => Math.sin(a) > 0;

const MOTE_BACK = { alpha: 0.75 };

export interface PlayerLook {
  motes: Mote[];
  aura: string[];
  step: string[];
  hit: string[];
  glow: string | null;
  glowR: number;
  count: number;
}

const EMPTY_PLAYER: PlayerLook = { motes: [], aura: [], step: [], hit: [], glow: null, glowR: 0, count: 0 };

/** Floor-layer companion entity: feet aura ring, back motes, colored glow. */
class LookFx extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  room: unknown;
  constructor(w: World, readonly sys: LookSystem) {
    super();
    this.layer = 0;
    this.tileCollide = false;
    this.flying = true;
    this.room = w.room;
  }

  override update(w: World): void {
    const p = this.sys.keeper(w);
    this.x = p.x;
    this.y = p.y;
  }

  override draw(r: Renderer, w: World): void {
    const p = this.sys.keeper(w);
    if (!p || !p.alive || p.fall > 0) return;
    const L = this.sys.player;
    if (L.aura.length) {
      const f = Math.floor(w.time * 5) % AURA_FRAMES;
      const a = Math.min(0.95, 0.55 + 0.1 * L.aura.length) * (0.85 + 0.15 * Math.sin(w.time * 3));
      r.sprite(auraSprite(L.aura, f), p.x, p.y + 4, { alpha: a });
    }
    this.sys.drawMotes(r, w, false);
  }

  override light(w: World): void {
    const L = this.sys.player;
    const p = this.sys.keeper(w);
    if (!L.glow || !p.alive) return;
    w.lights.add(p.x, p.y - 6, L.glowR, L.glow, { intensity: 0.32 });
  }
}

/** Per-world look state: composed shot / player looks and the companion entity. */
export class LookSystem {
  shot: ShotLook | null = null;
  player: PlayerLook = EMPTY_PLAYER;
  /** the keeper wearing this look (co-op: each keeper has its own; null = the world's player) */
  owner: Player | null = null;
  private ent: LookFx | null = null;
  private stepT = 0;
  private hitT = -1;
  private stepN = 0;

  /** The keeper this look follows. */
  keeper(w: World): Player {
    return this.owner ?? w.player;
  }

  /** Fold the held artifacts (in pickup order) into the shot & player looks. */
  compose(sources: LookSource[]): void {
    const looks = sources.filter((s) => s.def.look);
    const prio = [...looks].sort((a, b) => RANK[b.def.rarity] - RANK[a.def.rarity] || b.order - a.order);
    // ---- shot
    const colors: string[] = [];
    for (const s of prio) {
      const c = s.def.look!.shot;
      if (c && !colors.includes(c)) colors.push(c);
    }
    const shape = prio.find((s) => s.def.look!.shape)?.def.look!.shape ?? 'orb';
    let grow = 0;
    const trails: TrailKind[] = [];
    const orbits: string[] = [];
    let layers = 0;
    let epic = false;
    for (const s of looks) {
      const l = s.def.look!;
      if (l.grow) grow += l.grow * Math.min(2, s.power);
      if (l.trail && !trails.includes(l.trail) && trails.length < 3) trails.push(l.trail);
      if (l.orbit && orbits.length < 3) orbits.push(l.orbit);
      if (l.shot || l.shape || l.grow || l.trail || l.orbit) {
        layers++;
        if (RANK[s.def.rarity] >= 2) epic = true;
      }
    }
    if (layers > 0) {
      const sparkle = colors.slice(3);
      this.shot = new ShotLook(
        shape, colors[0] ?? null, colors[1] ?? null, colors[2] ?? null,
        // shots visibly grow as artifacts pile up (+1 px per 3 shot layers, max +2)
        Math.min(6, Math.round(Math.min(4, grow)) + (SHAPE_GROW[shape] ?? 0) + Math.min(2, Math.floor(layers / 3))),
        trails, [colors[0] ?? '', ...sparkle], orbits, epic || layers >= 3, layers,
      );
    } else this.shot = null;
    // ---- player
    const motes: Mote[] = [];
    const aura: string[] = [];
    const step: string[] = [];
    const hit: string[] = [];
    for (const s of looks) {
      const l = s.def.look!;
      if (l.mote) for (let k = 0; k < Math.min(2, s.power) && motes.length < 10; k++) {
        const i = motes.length;
        motes.push({ color: l.mote, rx: 11 + (i % 3) * 2.5, speed: 1.7 + (i % 4) * 0.22, phase: i * 2.39996, big: RANK[s.def.rarity] >= 2 });
      }
      if (l.aura && !aura.includes(l.aura) && aura.length < 4) aura.push(l.aura);
      if (l.step && !step.includes(l.step) && step.length < 4) step.push(l.step);
      if (l.hit && !hit.includes(l.hit) && hit.length < 4) hit.push(l.hit);
    }
    // impact sparks also carry the shot colors (melee keepers see their items in every hit)
    for (const c of colors) if (hit.length < 4 && !hit.includes(c)) hit.push(c);
    const n = looks.length;
    const glow = n >= 3 ? (aura[0] ?? colors[0] ?? motes[0]?.color ?? null) : null;
    // <= 48 px light diameter stays on the lighting's cheap pre-sized gradient path
    this.player = { motes, aura, step, hit, glow, glowR: 26 + 1.5 * Math.min(12, n), count: n };
  }

  /** A weapon shot was fired: give it the composed look (before item hooks run). */
  applyShot(p: Projectile): void {
    const look = this.shot;
    if (!look) return;
    p.look = look;
    if (look.body) p.color = look.body;
    p.lookBase = p.color;
  }

  /** Keep the companion entity in the current room; footstep / dash sparkles. */
  update(w: World, dt: number): void {
    const p = this.keeper(w);
    if (!p) return;
    const L = this.player;
    const want = L.aura.length > 0 || L.motes.length > 0 || L.glow !== null;
    if (want && (!this.ent || this.ent.dead || this.ent.room !== w.room)) {
      if (this.ent && !this.ent.dead) this.ent.dead = true;
      this.ent = new LookFx(w, this);
      this.ent.x = p.x;
      this.ent.y = p.y;
      w.spawn(this.ent);
    } else if (!want && this.ent) {
      this.ent.dead = true;
      this.ent = null;
    }
    if (!L.step.length || !p.alive || p.fall > 0) return;
    this.stepT -= dt;
    const moving = p.dashing || Math.abs(p.vx) + Math.abs(p.vy) > 20;
    if (!moving || this.stepT > 0) return;
    this.stepT = p.dashing ? 0.025 : 0.11;
    const c = L.step[this.stepN++ % L.step.length];
    w.particles.spawn({
      x: p.x + fx.range(-3, 3), y: p.y + 4 + fx.range(-1, 1), vx: fx.range(-6, 6), vy: -fx.range(4, 14),
      life: p.dashing ? 0.3 : 0.4, colors: ['#ffffff', c, c], size: 1, shape: p.dashing ? 'square' : 'pixel', additive: true,
    });
  }

  onDash(w: World): void {
    const L = this.player;
    if (!L.step.length) return;
    const p = this.keeper(w);
    w.particles.burst(p.x, p.y + 2, {
      count: 6 + L.step.length * 2, speed: [20, 70], angle: Math.atan2(-p.dashDY, -p.dashDX), spread: 1.3, life: [0.2, 0.4],
      colors: ['#ffffff', ...L.step], size: [1, 2], additive: true,
    });
  }

  onHit(w: World, target: Actor, hit: HitInfo): void {
    const L = this.player;
    if (!L.hit.length || hit.noProc || (hit.kind !== 'projectile' && hit.kind !== 'melee' && hit.kind !== 'laser')) return;
    if (w.time - this.hitT < 0.05) return;
    this.hitT = w.time;
    w.particles.burst(target.x, target.y - target.z - 5, {
      count: 2 + Math.min(3, L.hit.length), speed: [40, 110], life: [0.12, 0.26], colors: ['#ffffff', ...L.hit], shape: 'spark', size: [1, 2], additive: true,
    });
  }

  /** Motes circling the keeper: back half (floor layer) or front half (after the sprite). */
  drawMotes(r: Renderer, w: World, front: boolean): void {
    const motes = this.player.motes;
    if (!motes.length) return;
    const p = this.keeper(w);
    if (!p.alive || p.fall > 0) return;
    const t = w.time;
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i];
      const a = t * m.speed + m.phase;
      const s = Math.sin(a);
      if (s > 0 !== front) continue;
      const x = p.x + Math.cos(a) * m.rx;
      const y = p.y - 8 + s * m.rx * 0.42 + Math.sin(t * 2.3 + m.phase) * 1.5;
      r.sprite(moteSprite(m.color, m.big), x, y, front ? undefined : MOTE_BACK);
    }
  }

  /** Front motes (called by the item draw pass, after the player sprite). */
  drawFront(r: Renderer, w: World): void {
    this.drawMotes(r, w, true);
  }

  /** Average shot body color mixed toward white (HUD accents). */
  accent(): string {
    const b = this.shot?.body;
    return b ? mixColor(b, '#ffffff', 0.25) : '#ffe080';
  }
}
