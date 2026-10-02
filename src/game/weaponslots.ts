// Two weapon slots (Soul Knight style): the player holds a current weapon and
// an optional second one, swapped instantly with the 'swap' action (C / mouse
// wheel / R3 / touch swap button). Only the current weapon's `stats()` apply;
// the holstered weapon keeps its own WeaponState (its cooldown keeps ticking,
// so swapping never skips a slow weapon's recovery).

import { Entity } from './entity';
import type { World } from './world';
import type { Player } from './player';
import type { Renderer } from '../engine/renderer';
import { Weapons, type WeaponState } from './defs';
import { clamp, ease } from '../engine/math';

/** Seconds of the "draw" animation after a swap / pickup. */
export const SWAP_ANIM = 0.2;
/** Minimum time between two swaps (wheel spam guard). */
export const SWAP_GUARD = 0.12;
/** Short draw delay before a freshly drawn weapon can attack. */
export const SWAP_DRAW_DELAY = 0.08;

function freshState(): WeaponState {
  return { cooldown: 0, charge: 0, combo: 0, comboTimer: 0, sinceAttack: 99, anim: 0, mem: {} };
}

/**
 * Put a weapon away: cancel half-done actions (draws, wind-ups, channels,
 * buffered presses) and let the weapon clean up its world objects.
 */
export function holsterWeapon(w: World, p: Player, id: string | null, st: WeaponState): void {
  st.charge = 0;
  st.combo = 0;
  st.comboTimer = 0;
  const m = st.mem;
  m.drawing = 0;
  m.wind = 0;
  m.prevFire = 0;
  m.pressAt = -99;
  if (m.on) {
    m.on = 0;
    m.fade = 0;
  }
  m.hideUntil = 0;
  const def = id ? Weapons.get(id) : undefined;
  try {
    def?.onHolster?.(w, p, st);
  } catch (e) {
    console.error(e);
  }
}

/** Recompute stats after the held weapon changed (weapon stats apply to the held weapon only). */
function refreshStats(w: World): void {
  const items = w.items as { recompute?: () => void } | undefined;
  items?.recompute?.();
}

/**
 * Pick up weapon `id`: it becomes the current weapon. An empty second slot is
 * filled with the previous weapon; with both slots full the current weapon is
 * replaced and its id returned (the caller drops it on a pedestal).
 */
export function equipWeapon(w: World, p: Player, id: string): string | null {
  if (id === p.weaponId) return null;
  if (id === p.weapon2Id) {
    swapWeapons(w, p, true);
    return null;
  }
  let dropped: string | null = null;
  holsterWeapon(w, p, p.weaponId, p.weapon);
  if (!p.weapon2Id) {
    p.weapon2Id = p.weaponId;
    p.weapon2 = p.weapon;
  } else {
    dropped = p.weaponId;
  }
  p.weaponId = id;
  p.weapon = freshState();
  p.weapon.cooldown = SWAP_DRAW_DELAY;
  p.swapAt = w.time;
  refreshStats(w);
  return dropped;
}

/** Switch current and second weapon. Returns false when there is nothing to swap to. */
export function swapWeapons(w: World, p: Player, force = false): boolean {
  if (!p.weapon2Id) return false;
  if (!force && (p.holdT > 0 || w.time - p.swapAt < SWAP_GUARD)) return false;
  const oldId = p.weaponId;
  holsterWeapon(w, p, oldId, p.weapon);
  const id = p.weapon2Id;
  const st = p.weapon2;
  p.weapon2Id = oldId;
  p.weapon2 = p.weapon;
  p.weaponId = id;
  p.weapon = st;
  st.cooldown = Math.max(st.cooldown, SWAP_DRAW_DELAY);
  st.sinceAttack = Math.max(st.sinceAttack, 0.3);
  p.swapAt = w.time;
  p.lastSwapFrom = oldId;
  refreshStats(w);
  // feedback: a metallic flick + the old weapon tossed over the shoulder
  w.sfx('hit_metal', { vol: 0.28, pitch: 1.9 });
  w.sfx('whoosh', { vol: 0.22, pitch: 1.7 });
  const old = Weapons.get(oldId);
  if (old) w.spawn(new HolsterFx(p, old.icon));
  const nd = Weapons.get(id);
  w.particles?.burst?.(p.x + Math.cos(p.aim) * 8, p.y - 5 + Math.sin(p.aim) * 6, { count: 5, speed: [20, 60], life: [0.1, 0.22], colors: ['#ffffff', '#ffe8a0'], shape: 'spark', size: [1, 2] });
  if (nd && typeof w.floatText === 'function') w.floatText(p.x, p.y - 22, nd.name, '#fff0c8', 0.9);
  return true;
}

/** Tick the holstered weapon (cooldowns recover while it is on the back). */
export function tickHolstered(p: Player, dt: number): void {
  if (!p.weapon2Id) return;
  const st = p.weapon2;
  if (st.cooldown > -1) st.cooldown -= dt;
  st.sinceAttack += dt;
}

/** Scale factor of the held weapon right after a swap (pops in with a little overshoot). */
export function swapPop(p: Player, time: number): number {
  const t = (time - p.swapAt) / SWAP_ANIM;
  if (t < 0 || t >= 1) return 1;
  return 0.35 + 0.65 * ease.outBack(clamp(t, 0, 1));
}

/**
 * Run `draw` (the weapon's own drawing) scaled about the weapon hand while the
 * swap animation plays.
 */
export function withSwapPop(r: Renderer, w: World, p: Player, draw: () => void): void {
  const k = swapPop(p, w.time);
  if (k === 1) {
    draw();
    return;
  }
  const c = r.ctx;
  const hx = Math.round(p.x + Math.cos(p.aim) * 7 - r.viewX);
  const hy = Math.round(p.y - 5 + Math.sin(p.aim) * 5.6 - r.viewY);
  c.save();
  c.translate(hx, hy);
  c.rotate((1 - k) * (Math.cos(p.aim) >= 0 ? -0.9 : 0.9));
  c.scale(k, k);
  c.translate(-hx, -hy);
  draw();
  c.restore();
}

/** The weapon that was put away flips over the shoulder and fades (world effect). */
export class HolsterFx extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  private p: Player;
  private icon: string;
  private side: number;
  constructor(p: Player, icon: string) {
    super();
    this.p = p;
    this.icon = icon;
    this.side = Math.cos(p.aim) >= 0 ? -1 : 1;
    this.layer = 2;
    this.tileCollide = false;
    this.x = p.x;
    this.y = p.y;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    this.x = this.p.x;
    this.y = this.p.y;
    if (this.age > 0.3) this.dead = true;
  }

  override draw(r: Renderer): void {
    const t = clamp(this.age / 0.3, 0, 1);
    const k = ease.outCubic(t);
    const x = this.x + this.side * (4 + k * 8);
    const y = this.y - 8 - Math.sin(k * Math.PI) * 10 + k * 4;
    r.sprite(this.icon, x, y, { rot: this.side * k * 2.4, sx: 0.8 - k * 0.3, sy: 0.8 - k * 0.3, alpha: 1 - t * t });
  }
}

/**
 * The holstered weapon slung across the back (drawn behind the body, or over
 * it when the player faces up). Uses the weapon's held sprite, else its icon.
 */
export function drawBackWeapon(r: Renderer, p: Player, hover = 0): void {
  if (!p.weapon2Id || p.fall > 0) return;
  const def = Weapons.get(p.weapon2Id);
  if (!def) return;
  const name = def.heldSprite ?? def.icon;
  const side = p.flip ? 1 : -1;
  const up = p.facing === 'up';
  r.sprite(name, p.x + side * (up ? 1 : 3), p.y - 4 - p.z - hover, {
    rot: -Math.PI / 2 + side * 0.65,
    sx: 0.8,
    sy: 0.8,
    alpha: up ? 0.95 : 0.9,
    tint: '#140c1c',
    tintAmount: up ? 0.1 : 0.3,
  });
}
