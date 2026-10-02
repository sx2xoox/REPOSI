// Content definition interfaces + registries.
// Every piece of content (enemy, boss, artifact, resonance set, active item, potion,
// weapon, character, floor, theme, room template) is a plain object registered
// here from a file under src/content/** (auto-imported by src/content/index.ts).

import type { Script } from '../engine/script';
import type { Renderer } from '../engine/renderer';
import type { PixelPainter } from '../engine/painter';
import type { RNG } from '../engine/rng';
import type { MusicId, SfxName } from '../audio/audio';
import type { StatMods, Stats } from './stats';
import type { RoomKind, RoomShape } from './constants';
import type { World } from './world';
import type { Enemy } from './enemy';
import type { Player } from './player';
import type { Projectile } from './projectile';
import type { Actor, HitInfo } from './entity';

// ------------------------------------------------------------------ enemies
export type DeathFx = 'blood' | 'goo' | 'bone' | 'ember' | 'ice' | 'void' | 'spore' | 'metal' | 'none';

export interface EnemyDef {
  id: string;
  /** Korean display name (bestiary, boss bar) */
  name: string;
  /** HP on floor 1 (the world scales it by floor) */
  hp: number;
  radius: number;
  /** base move speed px/s (scripts may ignore) */
  speed?: number;
  /** contact damage in half-hearts (default 1, 0 = harmless to touch) */
  contactDamage?: number;
  /** flies over pits/spikes (not walls/rocks unless also `phasing`) */
  flying?: boolean;
  /** passes through rocks/blocks/pots */
  phasing?: boolean;
  /** knockback resistance; 1 = normal, higher = heavier, Infinity = immovable */
  mass?: number;
  /** default sprite or animation name */
  sprite: string;
  /** ground shadow width in px (default radius*2, 0 = none) */
  shadow?: number;
  /** vertical offset of sprite pivot from the entity position (default 0) */
  spriteYOffset?: number;
  /** cost in the room difficulty budget (default 1) */
  cost?: number;
  /** floors (1..5) where this enemy appears in normal rooms; omit to only spawn via scripts */
  floors?: number[];
  /** spawn weight within its floors (default 1) */
  weight?: number;
  /** can roll as a champion (stronger tinted variant) */
  champion?: boolean;
  deathFx?: DeathFx;
  /** splat / particle color for death & hits */
  bloodColor?: string;
  /** light emitted by the enemy */
  light?: { radius: number; color: string };
  /** sound when hurt / dying (defaults: enemy_hurt / enemy_die) */
  hurtSfx?: SfxName;
  dieSfx?: SfxName;
  /** called once after creation */
  init?(e: Enemy, w: World): void;
  /** main AI script (generator). */
  script?(e: Enemy, w: World): Script;
  /** called every update in addition to the script */
  update?(e: Enemy, w: World, dt: number): void;
  onHurt?(e: Enemy, w: World, hit: HitInfo): void;
  onDeath?(e: Enemy, w: World): void;
  /** custom draw; default draws e.sprite (anim) at e.x, e.y - e.z */
  draw?(e: Enemy, r: Renderer, w: World): void;

  // ---- boss-only fields
  boss?: boolean;
  /** boss name card subtitle, e.g. "지하묘지의 군주" */
  bossTitle?: string;
  /** floors on which this boss can be the floor boss */
  bossFloors?: number[];
  bossMusic?: MusicId;
  /** sprite drawn big on the boss intro card */
  portrait?: string;
}

// ------------------------------------------------------------------ items
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type ItemPool = 'treasure' | 'shop' | 'boss' | 'secret' | 'challenge' | 'curse' | 'shrine';

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#d8d0c0',
  rare: '#5fb8ff',
  epic: '#c07bff',
  legendary: '#ffb340',
};
export const RARITY_NAME: Record<Rarity, string> = {
  common: '일반',
  rare: '희귀',
  epic: '영웅',
  legendary: '전설',
};
export const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 60,
  rare: 28,
  epic: 10,
  legendary: 2.5,
};

/**
 * Hooks receive `power`: the number of copies of the artifact held (1 normally,
 * 2+ when duplicates were picked up). Scale numeric effects with it.
 */
export interface ItemHooks {
  /** stat modifiers (re-evaluated whenever inventory changes) */
  stats?(m: StatMods, power: number, w: World): void;
  /** when the item becomes active (picked up / placed) */
  onAcquire?(w: World, power: number): void;
  /** when the item stops being active (discarded / moved off grid) */
  onRemove?(w: World): void;
  /** every update while active */
  onUpdate?(w: World, dt: number, power: number): void;
  /** a player projectile was created (by weapon or effect with fromWeapon) */
  onShoot?(w: World, p: Projectile, power: number): void;
  /** the player started an attack (once per attack, before projectiles) */
  onAttack?(w: World, angle: number, power: number): void;
  /** modify an outgoing player hit before it is applied */
  modifyHit?(w: World, target: Actor, hit: HitInfo, power: number): void;
  /** a player-caused hit was applied to an enemy */
  onHit?(w: World, target: Actor, hit: HitInfo, power: number): void;
  onKill?(w: World, enemy: Enemy, power: number): void;
  /** the player took damage (after it is applied) */
  onHurt?(w: World, amount: number, power: number): void;
  onDash?(w: World, power: number): void;
  onRoomEnter?(w: World, power: number): void;
  onRoomClear?(w: World, power: number): void;
  onFloorStart?(w: World, power: number): void;
  onBomb?(w: World, x: number, y: number, power: number): void;
  onPickup?(w: World, kind: string, power: number): void;
  /** the player used "등불 해방" (ember gauge release) */
  onRelease?(w: World, power: number): void;
  /** the player deflected an enemy projectile with a melee swing */
  onDeflect?(w: World, p: Projectile, power: number): void;
  /** draw extra visuals around the player (world space) */
  draw?(w: World, r: Renderer, power: number): void;
}

export interface ArtifactDef extends ItemHooks {
  id: string;
  name: string;
  /** one-line effect description shown in banners/tooltips (Korean) */
  desc: string;
  /** flavor quote shown in the pickup banner (Isaac-style), optional */
  quote?: string;
  rarity: Rarity;
  /** resonance tags (see SetDef) */
  tags: string[];
  /** 16x16 icon sprite name */
  icon: string;
  pools: ItemPool[];
  /** base shop price (default by rarity) */
  price?: number;
  /** only one copy per run */
  unique?: boolean;
  /** not dropped randomly */
  hidden?: boolean;
}

export interface SetTier {
  count: number;
  desc: string;
  hooks: ItemHooks;
}

/**
 * "등불 공명" (lantern resonance): every distinct artifact with a tag adds 1 to
 * that tag's count; tiers activate at thresholds (e.g. 2 / 4 / 6).
 */
export interface SetDef {
  /** tag id used in ArtifactDef.tags */
  tag: string;
  name: string;
  color: string;
  icon: string;
  tiers: SetTier[];
}

export interface ActiveDef {
  id: string;
  name: string;
  desc: string;
  quote?: string;
  rarity: Rarity;
  icon: string;
  pools: ItemPool[];
  price?: number;
  /** charge needed: rooms to clear (`charge`), or seconds when `timed` */
  charge: number;
  timed?: boolean;
  /** return false if it could not be used (charge is kept) */
  use(w: World): boolean | void;
  /** optional continuous effect while held */
  onUpdate?(w: World, dt: number): void;
}

export interface PotionDef {
  id: string;
  /** true name (revealed after first use in a run) */
  name: string;
  desc: string;
  /** liquid color of the bottle */
  color: string;
  /** relative drop weight */
  weight?: number;
  /** good / bad / mixed — used for the "unidentified" hint color */
  nature: 'good' | 'bad' | 'mixed';
  use(w: World): void;
}

export interface WeaponState {
  cooldown: number;
  charge: number;
  combo: number;
  comboTimer: number;
  /** time since the last attack */
  sinceAttack: number;
  /** visual swing angle offset etc. */
  anim: number;
  mem: Record<string, number>;
}

export interface WeaponDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  /** sprite drawn in the player's hand, pointing right (rotated toward aim) */
  heldSprite?: string;
  kind: 'ranged' | 'melee' | 'charge' | 'beam';
  rarity: Rarity;
  pools: ItemPool[];
  /** weapon base stat changes (e.g. sword: x1.6 damage) */
  stats?(m: StatMods): void;
  /**
   * Called every update. `firing` = attack input held, `aim` = angle in radians.
   * Responsible for cooldowns and spawning attacks (see Player helpers).
   */
  update(w: World, p: Player, st: WeaponState, dt: number, firing: boolean, aim: number): void;
  /** custom draw of the held weapon (world space, called after the player sprite) */
  draw?(w: World, p: Player, r: Renderer, st: WeaponState): void;
}

export interface CharacterDef {
  id: string;
  name: string;
  /** subtitle like "등불지기" */
  title: string;
  desc: string;
  /**
   * Animation name prefix. The player renderer looks for:
   *   `${prefix}_idle_down|up|side`, `${prefix}_walk_down|up|side`, `${prefix}_hurt`, `${prefix}_dash`
   */
  spritePrefix: string;
  /** portrait / select screen sprite */
  portrait: string;
  color: string;
  baseStats?: Partial<Stats>;
  hearts: number;
  soulHearts?: number;
  weapon: string;
  artifacts?: string[];
  active?: string;
  coins?: number;
  bombs?: number;
  keys?: number;
  /** unlocked from the start (otherwise needs save flag `unlock:<id>`) */
  unlocked: boolean;
  unlockHint?: string;
  /** light color of the lantern */
  lightColor?: string;
  /**
   * "등불 해방" (lantern release): the character's special move, used when the
   * ember gauge is full (F). Default: radial flame burst that clears bullets.
   */
  release?(w: World, p: Player): void;
  /** one-line description of the release shown on character select */
  releaseDesc?: string;
}

// ------------------------------------------------------------------ world content
export interface ThemePalette {
  /** floor base colors (ramp dark -> light) */
  floor: string[];
  /** wall colors (ramp dark -> light) */
  wall: string[];
  /** rocks */
  rock: string[];
  /** pit depth color */
  pit: string;
  /** accent color for decorations, moss, cracks */
  accent: string[];
  /** outline / darkest */
  dark: string;
}

export interface ThemeDef {
  id: string;
  name: string;
  palette: ThemePalette;
  /** multiply-light ambient color "#rrggbb" (darker = moodier) */
  ambient: string;
  /** decorative per-tile painters (optional). Each paints a 16x16 tile. */
  paintFloor?(p: PixelPainter, tx: number, ty: number, rng: RNG): void;
  paintWall?(p: PixelPainter, tx: number, ty: number, rng: RNG, face: 'top' | 'front' | 'side' | 'bottom' | 'corner'): void;
  paintRock?(p: PixelPainter, rng: RNG, variant: number): void;
  /** called after the room is built to add decoration entities / decals */
  decorate?(w: World, rng: RNG): void;
  /** ambient particles (dust, embers, spores, snow) — called every update */
  ambientFx?(w: World, dt: number): void;
}

export interface FloorDef {
  /** 1..5 */
  index: number;
  id: string;
  name: string;
  subtitle: string;
  theme: string;
  music: MusicId;
  /** enemy pool: enemy id -> weight (overrides EnemyDef.floors when present) */
  enemies?: Record<string, number>;
  roomCount: [number, number];
  /** enemy hp multiplier */
  hpMult: number;
  /** difficulty budget per normal room [min, max] */
  budget: [number, number];
  championChance: number;
  /** probability of extra special rooms */
  extraRooms?: Partial<Record<RoomKind, number>>;
}

export interface RoomTemplate {
  id: string;
  shape: RoomShape;
  kinds: RoomKind[];
  /** restrict to floors (1..5) */
  floors?: number[];
  /** 1 easy .. 3 hard */
  difficulty?: number;
  weight?: number;
  /**
   * Interior rows (CELL_W*cw x CELL_H*ch characters). Legend: see TEMPLATE_LEGEND plus
   *   'e' random enemy, 'E' tougher enemy, 'f' fireplace, 'c' coin, 'h' heart, 'k' key, 'b' bomb pickup,
   *   'I' item pedestal (treasure), 'S' shop slot, 'B' boss position, '@' room center marker.
   */
  rows: string[];
}

// ------------------------------------------------------------------ registries
function makeRegistry<T extends { id: string }>(kind: string) {
  const map = new Map<string, T>();
  return {
    map,
    register(def: T): T {
      if (map.has(def.id) && import.meta.env?.DEV) console.warn(`[registry] duplicate ${kind} id "${def.id}"`);
      map.set(def.id, def);
      return def;
    },
    get(id: string): T | undefined {
      return map.get(id);
    },
    must(id: string): T {
      const d = map.get(id);
      if (!d) throw new Error(`[registry] unknown ${kind} "${id}"`);
      return d;
    },
    all(): T[] {
      return [...map.values()];
    },
    has(id: string): boolean {
      return map.has(id);
    },
  };
}

export const Enemies = makeRegistry<EnemyDef>('enemy');
export const Artifacts = makeRegistry<ArtifactDef>('artifact');
export const Actives = makeRegistry<ActiveDef>('active');
export const Potions = makeRegistry<PotionDef>('potion');
export const Weapons = makeRegistry<WeaponDef>('weapon');
export const Characters = makeRegistry<CharacterDef>('character');
export const Floors = makeRegistry<FloorDef>('floor');
export const Themes = makeRegistry<ThemeDef>('theme');
export const RoomTemplates = makeRegistry<RoomTemplate>('room template');

const setMap = new Map<string, SetDef>();
export const Sets = {
  map: setMap,
  register(def: SetDef): SetDef {
    setMap.set(def.tag, def);
    return def;
  },
  get(tag: string): SetDef | undefined {
    return setMap.get(tag);
  },
  all(): SetDef[] {
    return [...setMap.values()];
  },
};

/** Convenience registration helpers used by content files. */
export const defineEnemy = (d: EnemyDef) => Enemies.register(d);
export const defineBoss = (d: EnemyDef) => Enemies.register({ ...d, boss: true });
export const defineArtifact = (d: ArtifactDef) => Artifacts.register(d);
export const defineSet = (d: SetDef) => Sets.register(d);
export const defineActive = (d: ActiveDef) => Actives.register(d);
export const definePotion = (d: PotionDef) => Potions.register(d);
export const defineWeapon = (d: WeaponDef) => Weapons.register(d);
export const defineCharacter = (d: CharacterDef) => Characters.register(d);
export const defineFloor = (d: FloorDef) => Floors.register(d);
export const defineTheme = (d: ThemeDef) => Themes.register(d);
export const defineRoom = (d: RoomTemplate) => RoomTemplates.register(d);

export function defaultPrice(r: Rarity): number {
  return r === 'common' ? 15 : r === 'rare' ? 20 : r === 'epic' ? 30 : 45;
}
