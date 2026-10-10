// Stone lanterns (석등): a squat stone lantern on its own tile (Tile.STONE_LANTERN,
// solid, never broken by blasts). A keeper strikes a match at it (interact) and its
// fire chamber lights up and gives something out of its window: coins, a blue
// flame, matches or a chest. It stays lit for the rest of the stage.
// Templates place them ('t'); every stage also turns one rock of one normal room
// into a stone lantern (dungeon.markStageLantern picks the room, placeStageLantern
// the tile, each on its own seeded stream). One StoneLantern entity per tile is
// spawned on the room's first visit (World.spawnRoomFixtures, row-major order).

import { Entity } from './entity';
import type { World } from './world';
import type { Room } from './room';
import type { ThemeDef } from './defs';
import type { Renderer } from '../engine/renderer';
import { Tile } from './tiles';
import { DIR_VEC, TILE } from './constants';
import { Chest, Pickup, type PickupKind } from './pickups';
import { matchCard, tryLightWithMatch } from './matches';
import { RingFx } from './effects';
import { RNG, fx } from '../engine/rng';
import { clamp } from '../engine/math';
import { definePixelSprite, hasSprite } from '../engine/sprites';

// ------------------------------------------------------------------ art
// 14 x 24, light from the top left: finial, sloped cap, fire chamber with a 4x4
// window, a band, a short shaft and a plinth carrying the old gold rune.
// 0..4 = the floor's rock ramp (dark -> light), k = soot, g/h/d = the rune.
const BODY = [
  '......43......',
  '.....3442.....',
  '......32......',
  '....234431....',
  '..2344443321..',
  '.233444333221.',
  '12333333322211',
  '.011111111110.',
  '...24444431...',
  '...34kkkk21...',
  '...33kkkk21...',
  '...33kkkk21...',
  '...32kkkk11...',
  '...22222211...',
  '..2344443321..',
  '...01111110...',
  '.....3321.....',
  '.....3221.....',
  '.....3221.....',
  '..2344443321..',
  '.23333gg33221.',
  '.2333ghhg3221.',
  '.22222dd22211.',
  '.000000000000.',
];
/** window (fire chamber) top-left, relative to the sprite's origin (bottom centre) */
export const WINDOW_DX = -2;
export const WINDOW_DY = -14;
const RUNE = { g: '#ffd84a', h: '#fff6c0', d: '#8a5a10', k: '#140c10' };

function bodyPalette(rk: string[]): Record<string, string> {
  return { '0': rk[0], '1': rk[1], '2': rk[2], '3': rk[3], '4': rk[4] ?? rk[3], ...RUNE };
}

/** Floors whose rock colours would melt into their floor: the lantern gets its own material. */
const LANTERN_RAMP: Record<string, string[]> = {
  // the clock tower's floor is brass like its rocks: a verdigris bronze lantern
  clock: ['#0e2420', '#1a4a40', '#2a7a66', '#48b094', '#8ae0c4'],
};

/** The lantern's body sprite in a floor theme's rock colours (defined on first use). */
export function stoneLanternSprite(theme: ThemeDef): string {
  const name = `stone_lantern@${theme.id}`;
  if (!hasSprite(name)) definePixelSprite(name, bodyPalette(LANTERN_RAMP[theme.id] ?? theme.palette.rock), BODY, { outline: theme.palette.dark, origin: [7, 23] });
  return name;
}

// card icon: a neutral grey lantern with an ember in its sooty window
definePixelSprite('icon_stone_lantern', { ...bodyPalette(['#1e1a22', '#3a3440', '#5a5260', '#8a8090', '#b8b0bc']), e: '#ff9a40' }, [
  '.....43.....',
  '....3442....',
  '...234431...',
  '.2344443321.',
  '123333322211',
  '.0111111110.',
  '..24444421..',
  '..34kkkk21..',
  '..33kkek21..',
  '..32kkkk11..',
  '..22222211..',
  '...011110...',
  '....3221....',
  '.2344443321.',
  '.2333gg3221.',
  '.0000000000.',
], { outline: '#0c0810' });

// the flame in a lit window (4x4, 3 frames): warm glowing chamber, white-hot core
const FLAME_PAL = { b: '#6a2008', e: '#e05010', m: '#ffb040', c: '#fff0a0' };
const FLAME_FRAMES = [
  ['bemb', 'emce', 'mccm', 'emme'],
  ['beeb', 'bmce', 'mccm', 'emme'],
  ['bmeb', 'ecmb', 'mccm', 'emme'],
];
FLAME_FRAMES.forEach((rows, i) => definePixelSprite(`stone_lantern_flame_${i}`, FLAME_PAL, rows, { anchor: 'topleft' }));

// ------------------------------------------------------------------ placement
const isWalk = (t: number) => t === Tile.FLOOR || t === Tile.RUBBLE;

/** Floor tiles a keeper reaches on foot from the room's door fronts (no spikes, no breaking anything). */
export function reachableFloor(room: Room): Uint8Array {
  const seen = new Uint8Array(room.w * room.h);
  const stack: number[] = [];
  for (const d of room.doors) {
    const v = DIR_VEC[d.dir];
    const tx = Math.floor((d.x - v.x * 8) / TILE);
    const ty = Math.floor((d.y - v.y * 8) / TILE);
    if (!isWalk(room.tileAt(tx, ty))) continue;
    const i = ty * room.w + tx;
    if (!seen[i]) { seen[i] = 1; stack.push(i); }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % room.w;
    const y = (i - x) / room.w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!room.inside(nx, ny)) continue;
      const j = ny * room.w + nx;
      if (seen[j] || !isWalk(room.tiles[j])) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}

/**
 * The stage lantern of a marked room (node.lantern, rooms without a template
 * lantern): a rock that a keeper can stand next to, away from the doors and the
 * template markers; failing that, an open floor tile ringed by floor (it can
 * never cut a path); failing that, any floor tile whose loss provably cuts no path. Its own stream from the node seed (never `Room.rng`), so the
 * neighbour pre-render and the real build agree. Returns the tile or null.
 */
export function placeStageLantern(room: Room): { tx: number; ty: number } | null {
  if (!room.node.lantern || room.tiles.includes(Tile.STONE_LANTERN)) return null;
  const rr = new RNG((room.node.seed ^ 0x57014e) >>> 0);
  const reach = reachableFloor(room);
  const at = (tx: number, ty: number) => room.tileAt(tx, ty);
  const reached = (tx: number, ty: number) => room.inside(tx, ty) && reach[ty * room.w + tx] === 1;
  const fromDoors = (cx: number, cy: number) => Math.min(Infinity, ...room.doors.map((d) => Math.hypot(d.x - cx, d.y - cy)));
  const markers = room.markers.map((m) => ({ x: m.x, y: m.y, tx: Math.floor(m.x / TILE), ty: Math.floor(m.y / TILE) }));
  const a: { tx: number; ty: number }[] = [];
  const b: { tx: number; ty: number }[] = [];
  for (let ty = 2; ty < room.h - 2; ty++) {
    for (let tx = 2; tx < room.w - 2; tx++) {
      const t = at(tx, ty);
      const cx = (tx + 0.5) * TILE;
      const cy = (ty + 0.5) * TILE;
      if (fromDoors(cx, cy) < 48) continue;
      if (t === Tile.ROCK || t === Tile.SKULL_ROCK) {
        if (!(reached(tx + 1, ty) || reached(tx - 1, ty) || reached(tx, ty + 1) || reached(tx, ty - 1))) continue;
        if (markers.some((m) => Math.abs(m.tx - tx) <= 1 && Math.abs(m.ty - ty) <= 1)) continue;
        a.push({ tx, ty });
      } else if (t === Tile.FLOOR && reached(tx, ty)) {
        let ring = true;
        for (let dy = -1; dy <= 1 && ring; dy++) for (let dx = -1; dx <= 1; dx++) if (at(tx + dx, ty + dy) !== Tile.FLOOR) { ring = false; break; }
        if (!ring) continue;
        if (markers.some((m) => Math.hypot(m.x - cx, m.y - cy) < 32)) continue;
        if (Math.hypot(room.centerX - cx, room.centerY - cy) < 40) continue;
        b.push({ tx, ty });
      }
    }
  }
  // last resort (spike lanes, pit mazes): any reachable floor tile whose loss leaves every
  // other reachable tile reachable, checked by flood fill
  const c: { tx: number; ty: number }[] = [];
  if (!a.length && !b.length) {
    for (let ty = 2; ty < room.h - 2; ty++) {
      for (let tx = 2; tx < room.w - 2; tx++) {
        const i = ty * room.w + tx;
        const cx = (tx + 0.5) * TILE;
        const cy = (ty + 0.5) * TILE;
        if (room.tiles[i] !== Tile.FLOOR || !reach[i] || fromDoors(cx, cy) < 48) continue;
        if (markers.some((m) => Math.hypot(m.x - cx, m.y - cy) < 24) || Math.hypot(room.centerX - cx, room.centerY - cy) < 40) continue;
        room.tiles[i] = Tile.STONE_LANTERN;
        const after = reachableFloor(room);
        room.tiles[i] = Tile.FLOOR;
        let same = true;
        for (let j = 0; j < reach.length && same; j++) if (j !== i && after[j] !== reach[j]) same = false;
        if (same) c.push({ tx, ty });
      }
    }
  }
  const pool = a.length ? a : b.length ? b : c;
  if (!pool.length) return null;
  const pick = rr.pick(pool);
  room.setTile(pick.tx, pick.ty, Tile.STONE_LANTERN);
  return pick;
}

// ------------------------------------------------------------------ entity
type Reward = 'coins' | 'blue_flame' | 'matches' | 'chest';

/** Reward odds of a lit stone lantern (the old marked rocks' odds): 40 / 25 / 20 / 15 %. */
export function lanternReward(roll: number): Reward {
  return roll < 0.4 ? 'coins' : roll < 0.65 ? 'blue_flame' : roll < 0.85 ? 'matches' : 'chest';
}

export class StoneLantern extends Entity {
  override readonly worldLoot = true;
  /** what kind of match target this is (bots / tools: class names are mangled in builds) */
  readonly fixture = 'lantern';
  readonly tx: number;
  readonly ty: number;
  lit = false;
  /** `age` when it was lit (draw only: the flare) */
  private litAt = -1;

  constructor(tx: number, ty: number) {
    super();
    this.tx = tx;
    this.ty = ty;
    this.x = (tx + 0.5) * TILE;
    this.y = (ty + 0.5) * TILE;
    this.r = 7;
    this.persistent = true;
    this.solid = false;
    this.tileCollide = false;
  }

  /** screen anchor of the body sprite (its bottom centre) */
  private get baseY(): number {
    return this.y + 6;
  }

  /** centre of the window */
  private get windowY(): number {
    return this.baseY + WINDOW_DY + 2;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (!this.lit) {
      // a cold lantern breathes the odd wisp of grey smoke from its cap
      if (fx.chance(dt / 2.5)) {
        w.particles.spawn({ x: this.x + fx.range(-1, 1), y: this.baseY - 24, vx: fx.range(-3, 3), vy: -fx.range(5, 10), life: fx.range(1.2, 2), colors: ['#7a7480', '#5a5460', '#3a3640'], size: fx.range(1, 2), sizeEnd: 3, drag: 0.6, alpha: 0.5 });
      }
      return;
    }
    if (fx.chance(dt * 1.8)) {
      w.particles.spawn({ x: this.x + fx.range(-1.5, 1.5), y: this.windowY - 2, vx: fx.range(-6, 6), vy: -fx.range(14, 26), life: fx.range(0.35, 0.7), colors: ['#fff0a0', '#ffb040', '#e05010'], size: 1, additive: true });
    }
  }

  override previewable(): boolean {
    return !this.lit && !this.dead;
  }

  override interactionInfo(w?: World) {
    const name = '꺼진 석등';
    const desc = '성냥으로 불을 붙이면 무언가 나온다.';
    if (!w) return { name, desc, icon: 'icon_stone_lantern', actionLabel: '불 붙이기', available: false, price: { icon: 'hud_match', text: '1', ok: false } };
    return matchCard(w, { name, desc, icon: 'icon_stone_lantern' });
  }

  override interact(w: World): boolean {
    if (this.lit || this.dead || !w.entities.includes(this)) return false;
    if (!tryLightWithMatch(w, this, false, { x: this.x, y: this.windowY })) return false;
    this.ignite(w);
    return true;
  }

  /** Light it (a match was struck): the flame catches and the reward pops out of the window. */
  ignite(w: World): void {
    if (this.lit) return;
    this.lit = true;
    this.litAt = this.age;
    w.sfx('lantern_lit', { x: this.x });
    w.sfx('secret_found', { vol: 0.6, x: this.x });
    const wy = this.windowY;
    w.particles.burst(this.x, wy, { count: 16, speed: [20, 80], life: [0.25, 0.6], colors: ['#ffffff', '#fff0a0', '#ffb040', '#e05010'], size: [1, 2], additive: true, light: 6 });
    w.spawn(new RingFx(this.x, wy, 22, 0.35, '#ffd080', 1));
    this.giveReward(w);
  }

  private giveReward(w: World): void {
    const room = w.room;
    const kind = lanternReward(w.rng.next());
    if (kind === 'chest') {
      const spot = room.nearestFree(this.x, this.y + 22, 8);
      w.spawn(new Chest(spot.x, spot.y, false));
      w.particles.burst(spot.x, spot.y - 4, { count: 10, speed: [20, 50], life: [0.3, 0.6], colors: ['#fff0c0', '#ffd060'], size: [1, 2], additive: true });
      return;
    }
    const kinds: PickupKind[] = kind === 'coins' ? ['coin', 'coin', 'coin'] : kind === 'matches' ? ['match', 'match'] : ['blue_flame'];
    // out of the window: land in front of the lantern, spreading away from it
    const out = room.nearestFree(this.x, this.y + 14, 5);
    const base = Math.atan2(out.y - this.y, out.x - this.x);
    const z0 = clamp(out.y - (this.windowY + 2), 4, 30);
    kinds.forEach((k, i) => {
      const pk = new Pickup(k, out.x, out.y);
      pk.pop(base + (i - (kinds.length - 1) / 2) * 0.8, 46);
      pk.z = z0;
      w.spawn(pk);
    });
  }

  override draw(r: Renderer, w: World): void {
    const x = this.x;
    const y = this.baseY;
    r.sprite(stoneLanternSprite(w.room.theme), x, y);
    const wx = x + WINDOW_DX;
    const wy = y + WINDOW_DY;
    if (this.lit) {
      r.sprite(`stone_lantern_flame_${Math.floor(this.age * 9 + this.id) % 3}`, wx, wy);
      // the flare of catching fire
      const k = clamp(1 - (this.age - this.litAt) / 0.5, 0, 1);
      if (k > 0) r.rect(Math.round(wx) - 1, Math.round(wy) - 1, 6, 6, '#fff6c0', 0.6 * k);
    } else if (Math.floor(this.age * 1.1 + this.id * 0.7) % 3 === 0 && Math.floor(this.age * 7) % 4 !== 0) {
      // an ember still glints in the soot now and then
      r.rect(Math.round(wx) + 1 + (this.id & 1), Math.round(wy) + 3, 1, 1, '#ff9a40', 0.8);
    }
  }

  override light(w: World): void {
    if (!this.lit) {
      w.lights.glow(this.x, this.windowY, 6, '#ff8030', 0.12);
      return;
    }
    const fl = 1 + Math.sin(this.age * 11 + this.id) * 0.025 + Math.sin(this.age * 23.7) * 0.015;
    w.lights.add(this.x, this.windowY, 72 * fl, '#ffb060', { intensity: 0.85 });
    w.lights.glow(this.x, this.windowY, 9 * fl, '#ffc070', 0.45);
  }
}
