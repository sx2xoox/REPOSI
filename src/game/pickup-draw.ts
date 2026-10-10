// 등불이 끌어당기는 획득 연출 — what taking a pedestal item looks like.
//
// The item rises off its pedestal, the keeper's lantern draws it in along a short
// arc (a weapon flies to the hand instead) and the lantern flares in the item's
// rarity colour as it lands. The name / desc / detail tag (등불 명판, drawn by
// ui/cards.ts `drawFind`) lights up at that moment; flavour quotes stay in the
// collection (도감).
//
// Simulation side (`presentFind`): the keeper's short `holdT` guard (no fire /
// release / swap; hashed), a new weapon kept out of the hand until it lands
// (`weapon.mem.hideUntil`, same length) and the banner queue. Everything that
// moves or glows is the cosmetic `LanternDraw` / `FindFlare` pair (fx particles
// only, negative ids, never read by gameplay, left out of the state hash).

import { Entity } from './entity';
import type { World, Banner } from './world';
import type { Player } from './player';
import type { Rarity } from './defs';
import type { PedestalItem } from './pickups';
import type { Renderer } from '../engine/renderer';
import { clamp, ease, mixColor } from '../engine/math';
import { orbSprite } from './projectile';
import { RingFx } from './effects';

/** Keeper's guard after a find (fire / release / swap wait this long). */
export const FIND_HOLD = 0.3;
/** The find tag lights up as the item reaches the lantern (s after the take). */
export const FIND_DELAY = 0.35;
/** How long a find tag stays once shown (s, incl. its fade). */
export const FIND_LIFE = 2.8;
/** Life of a ribbon notice (s). */
export const RIBBON_LIFE = 3.2;

/** Flight timings (s after the take): rise off the pedestal, then the pull. */
const ITEM_FLIGHT = { lift: 0.1, fly: 0.3 };
/** A weapon is quicker (to the hand, in time for the keeper's guard to end). */
const WEAPON_FLIGHT = { lift: 0.08, fly: FIND_HOLD - 0.08 };
/** The last glint lingers this long after landing (the flare lives on in `FindFlare`). */
const LINGER = 0.15;

/** Age at which a banner leaves the queue. */
export function bannerEnd(b: Banner): number {
  return b.kind === 'find' ? (b.delay ?? 0) + FIND_LIFE : RIBBON_LIFE;
}

/** Rarity colour of a find (title, motes, flare). */
export function findColor(r: Rarity | string): string {
  return r === 'legendary' ? '#ffb340' : r === 'epic' ? '#c07bff' : r === 'rare' ? '#5fb8ff' : '#ffffff';
}

function tierOf(r: Rarity | string): number {
  return r === 'legendary' ? 3 : r === 'epic' ? 2 : r === 'rare' ? 1 : 0;
}

/** Trailing motes over the whole flight, per rarity tier. */
const MOTES = [4, 6, 9, 12];

export interface FindInfo {
  name: string;
  desc: string;
  detail?: string;
  icon: string;
  rarity: Rarity;
}

/**
 * Present a find: the keeper's short guard, the tag (or a teammate's ribbon) and
 * the cosmetic draw-in from (x, y) (the item's spot over the pedestal).
 */
export function presentFind(w: World, p: Player, info: FindInfo, item: PedestalItem, x: number, y: number): void {
  const kind = item.kind;
  p.holdT = FIND_HOLD;
  // a new weapon reaches the hand with its flight (its guard ends at the same moment)
  if (kind === 'weapon') p.weapon.mem.hideUntil = w.time + WEAPON_FLIGHT.lift + WEAPON_FLIGHT.fly;
  const color = findColor(info.rarity);
  const local = !w.coop || p === w.local;
  // co-op: a teammate's find is a small ribbon with their name (UI only)
  if (!local) w.banner(`${p.name || `P${p.slot + 1}`} · ${info.name}`, info.desc, { icon: info.icon, color, small: true });
  else w.banner(info.name, info.desc, { kind: 'find', icon: info.icon, color, detail: info.detail, delay: FIND_DELAY, weapon: kind === 'weapon' ? item.id : undefined });
  w.spawn(new LanternDraw(p, info.icon, info.rarity, kind === 'weapon', x, y, local));
}

/** Where a find lands: the keeper's lantern, or the hand for a weapon. */
export function findLanding(p: Player, toHand: boolean): { x: number; y: number } {
  if (!toHand) return { x: p.x, y: p.y - 8 };
  const side = Math.cos(p.aim) < 0 ? -1 : 1;
  return { x: p.x + side * 5, y: p.y - 5 };
}

/** The item flying from its pedestal into the keeper's lantern (cosmetic). */
export class LanternDraw extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  readonly keeper: Player;
  readonly icon: string;
  readonly color: string;
  readonly tier: number;
  readonly toHand: boolean;
  /** the local keeper's find (tints the HUD lantern on arrival) */
  readonly local: boolean;
  readonly lift: number;
  readonly fly: number;
  /** pedestal spot the flight starts from */
  private readonly x0: number;
  private readonly y0: number;
  /** curve side: the keeper's facing side at the take */
  private readonly side: number;
  /** current scale of the icon */
  scale = 1;
  arrived = false;
  private motes = 0;
  /** recent positions (afterimages while flying) */
  private trail: { x: number; y: number }[] = [];

  constructor(keeper: Player, icon: string, rarity: Rarity, toHand: boolean, x: number, y: number, local: boolean) {
    super();
    this.keeper = keeper;
    this.icon = icon;
    this.color = findColor(rarity);
    this.tier = tierOf(rarity);
    this.toHand = toHand;
    this.local = local;
    const f = toHand ? WEAPON_FLIGHT : ITEM_FLIGHT;
    this.lift = f.lift;
    this.fly = f.fly;
    this.x0 = x;
    this.y0 = y;
    this.x = x;
    this.y = y;
    this.side = Math.cos(keeper.aim) < 0 ? -1 : 1;
    this.layer = 2;
    this.tileCollide = false;
  }

  /** Age at which the item reaches the lantern / hand. */
  get arriveAt(): number {
    return this.lift + this.fly;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const t = this.age;
    if (t < this.lift) {
      // rise off the pedestal
      this.x = this.x0;
      this.y = this.y0 - 5 * ease.outCubic(t / this.lift);
      this.scale = 1;
    } else if (t < this.arriveAt) {
      const u = clamp((t - this.lift) / this.fly, 0, 1);
      // drawn in: slow to leave, fast to land
      const k = u * u * (1.7 - 0.7 * u);
      const ax = this.x0;
      const ay = this.y0 - 5;
      const b = findLanding(this.keeper, this.toHand);
      // quadratic arc, control point over the middle, leaning to the keeper's facing side
      const cx = (ax + b.x) / 2 + this.side * 8;
      const cy = (ay + b.y) / 2 - 18;
      const m = 1 - k;
      this.trail.unshift({ x: this.x, y: this.y });
      if (this.trail.length > 4) this.trail.length = 4;
      this.x = m * m * ax + 2 * m * k * cx + k * k * b.x;
      this.y = m * m * ay + 2 * m * k * cy + k * k * b.y;
      this.scale = 1 - 0.65 * k;
      // trailing motes in the rarity colour, spread over the flight
      const want = Math.round(MOTES[this.tier] * u);
      if (want > this.motes) {
        w.particles.burst(this.x, this.y, {
          count: want - this.motes, speed: [6, 22], life: [0.25, 0.5], size: [1, 1.6],
          colors: [this.color, mixColor(this.color, '#ffffff', 0.5)], drag: 3, additive: true,
        });
        this.motes = want;
      }
    } else {
      if (!this.arrived) this.arrive(w);
      const b = findLanding(this.keeper, this.toHand);
      this.x = b.x;
      this.y = b.y;
      this.trail.length = 0;
      if (t >= this.arriveAt + LINGER) this.dead = true;
    }
  }

  private arrive(w: World): void {
    this.arrived = true;
    const p = this.keeper;
    const b = findLanding(p, this.toHand);
    const lantern = p.character.lightColor ?? '#ffd8a0';
    const mix = mixColor(this.color, lantern, 0.5);
    w.spawn(new FindFlare(p, b.x - p.x, b.y - p.y, mix, this.color, this.tier));
    w.spawn(new RingFx(b.x, b.y, 18, 0.35, this.color, 1));
    w.particles.burst(b.x, b.y, {
      count: 5 + this.tier * 2, speed: [20, 55], life: [0.2, 0.45], size: [1, 2],
      colors: [this.color, '#ffffff', mix], drag: 4, gravity: -40, additive: true,
    });
    p.squash(0.92, 1.08);
    w.sfx(this.tier >= 2 ? 'item_get_rare' : 'item_get', { x: p.x });
    // the HUD's release lantern takes the find's colour (a common find: the keeper's own flame)
    if (this.local) w.findGlow = { color: this.tier > 0 ? this.color : lantern, t: 0.5 };
  }

  override draw(r: Renderer): void {
    const t = this.age;
    if (t >= this.arriveAt) {
      // the last glint as it is swallowed by the lantern
      const k = clamp(1 - (t - this.arriveAt) / LINGER, 0, 1);
      if (k > 0) r.sprite(orbSprite(6, this.color), this.x, this.y, { alpha: 0.5 * k, additive: true });
      return;
    }
    const lifting = t < this.lift;
    // afterimages along the arc, tinted in the rarity colour
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const q = this.trail[i];
      const s = this.scale * (1 - 0.08 * (i + 1));
      r.sprite(this.icon, q.x, q.y, { sx: s, sy: s, alpha: 0.32 - i * 0.07, tint: this.color, tintAmount: 1 });
    }
    r.sprite(orbSprite(14, this.color), this.x, this.y, { alpha: 0.22 + 0.1 * this.tier, sx: this.scale, sy: this.scale, additive: true });
    const flash = lifting ? 1 - (t / this.lift) * 0.6 : 0.15 + 0.6 * ((t - this.lift) / this.fly);
    r.sprite(this.icon, this.x, this.y, { sx: this.scale, sy: this.scale, flash });
  }

  override light(w: World): void {
    const t = this.age;
    if (t >= this.arriveAt) return;
    w.lights.add(this.x, this.y, 22 + 4 * this.tier, this.color, { intensity: 0.75 });
    if (t < this.lift) return;
    // the lantern's pull: beads of light streaming from the item to the lantern
    const b = findLanding(this.keeper, this.toHand);
    for (let i = 1; i <= 3; i++) {
      const f = (i - ((t * 8) % 1)) / 4;
      w.lights.glow(b.x + (this.x - b.x) * f, b.y + (this.y - b.y) * f, 4, this.color, 0.55 * (0.4 + f * 0.6));
    }
  }
}

/** The keeper's lantern flaring as a find lands (cosmetic). */
export class FindFlare extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  static readonly DUR = 0.4;
  readonly keeper: Player;
  /** offset from the keeper (lantern / hand) */
  private readonly ox: number;
  private readonly oy: number;
  readonly color: string;
  readonly spark: string;
  readonly tier: number;

  constructor(keeper: Player, ox: number, oy: number, color: string, spark: string, tier: number) {
    super();
    this.keeper = keeper;
    this.ox = ox;
    this.oy = oy;
    this.color = color;
    this.spark = spark;
    this.tier = tier;
    this.x = keeper.x + ox;
    this.y = keeper.y + oy;
    this.layer = 2;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    this.x = this.keeper.x + this.ox;
    this.y = this.keeper.y + this.oy;
    if (this.age >= FindFlare.DUR) this.dead = true;
  }

  /** 1 at the landing, easing out to 0. */
  private get k(): number {
    return clamp(1 - this.age / FindFlare.DUR, 0, 1);
  }

  override draw(r: Renderer): void {
    // a four-point glint over the lantern, shrinking
    const k = this.k;
    const len = Math.round(2 + (3 + this.tier) * k);
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    r.rect(x - len, y, len * 2 + 1, 1, this.spark, 0.85 * k);
    r.rect(x, y - len, 1, len * 2 + 1, this.spark, 0.85 * k);
    r.rect(x, y, 1, 1, '#ffffff', k);
  }

  override light(w: World): void {
    const k = ease.outQuad(this.k);
    if (k <= 0) return;
    const p = this.keeper;
    const base = p.character.lightRadius ?? 95;
    // the keeper's light swells (x1.3) in the mixed colour, plus a soft additive bloom
    w.lights.add(p.x, p.y - 6, base * 1.3, this.color, { intensity: 0.6 * k });
    w.lights.glow(this.x, this.y, 40 + 10 * this.tier, this.color, 0.22 * k);
  }
}

/** Flight timings (s after the take), for tests. */
export const FIND_TIMING = { item: ITEM_FLIGHT, weapon: WEAPON_FLIGHT, linger: LINGER } as const;
