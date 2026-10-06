import { isContentTemporarilyLocked } from './release-policy';
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
import type { MeleeSwing } from './melee';
import type { Actor, HitInfo } from './entity';
import type { ArtifactLook } from './look';

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
  /** floors (1..N) where this enemy appears in normal rooms; omit to only spawn via scripts */
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
  /** Snapshot attack bonuses when a melee hitbox is created. */
  onSwing?(w: World, swing: MeleeSwing, power: number): void;
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
  /** Full rules and exclusions shown in inventory / preview / collection. */
  detail?: string;
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
  /**
   * Visible traces while held (shot color / shape / trail, motes, aura ...),
   * composed with every other held artifact (see game/look.ts).
   */
  look?: ArtifactLook;
  /** short Korean line naming the artifact's signature side effect (Tab screen) */
  signature?: string;
  /** a "등불의 축복" floor blessing (hidden, offered at floor start; see game/blessings.ts) */
  blessing?: boolean;
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
  /**
   * The weapon was put away (swapped to the other slot or dropped): clean up
   * anything it keeps in the world (orbiting shots, channels ...). Optional.
   */
  onHolster?(w: World, p: Player, st: WeaponState): void;
  /** short Korean archetype label for UI (e.g. '산탄', '대검'); falls back to `kind` */
  archetype?: string;
  /** classification tags for character affinities (e.g. 'bow', 'arcane', 'blade'); see AffinityDef */
  tags?: string[];
}

// ------------------------------------------------------------------ characters
/**
 * A character's dash ("대시"). The movement, i-frames and after-images stay in
 * `Player.tryDash`; these hooks add the keeper's own flavour (a burning trail,
 * a damaging rush, a blink that leaves a rift ...). Distance and cooldown come
 * from the character's `baseStats` (dashSpeed x dashTime, dashCooldown).
 */
export interface DashDef {
  /** Korean name, e.g. "불씨 질주" */
  name: string;
  /** one-line Korean description (character select) */
  desc: string;
  /** 16x16 icon sprite (character select) */
  icon?: string;
  /** extra invulnerability after the dash ends, seconds (default 0.06) */
  iframes?: number;
  /**
   * Teleport to the dash end point instead of rushing there (crosses pits and
   * enemies, stops at walls / rocks); `dashTime` becomes the re-appearance delay
   * during which the keeper stands still and is invulnerable.
   */
  blink?: boolean;
  /** after-image / trail color (default: the character's lightColor) */
  color?: string;
  /** sound played instead of the default 'dash' */
  sfx?: SfxName;
  /** the dash started (`p.dashDX/DY` is the direction, `p.dashX0/Y0` where it began) */
  start?(w: World, p: Player): void;
  /** every update while dashing */
  update?(w: World, p: Player, dt: number): void;
  /** the dash ended */
  end?(w: World, p: Player): void;
}

/**
 * A character's signature passive: ItemHooks owned by the keeper, always
 * active with power 1 and dispatched by the item system like an artifact
 * (key `passive:<characterId>`; `proc(w, 'passive:<id>')` pops its icon).
 */
export interface PassiveDef extends ItemHooks {
  /** Korean name, e.g. "불씨 심지" */
  name: string;
  /** one-line Korean description (character select, Tab screen) */
  desc: string;
  /** 16x16 icon sprite (Tab screen, proc pops) */
  icon: string;
  /** visible traces composed like an artifact's (aura ring, step sparkles, hit sparks ...) */
  look?: ArtifactLook;
}

/**
 * Favoured weapon class: while a matching weapon is held the keeper gets
 * `p.flags` 'affinity' plus the optional stat bonus. A weapon matches when its
 * kind is in `kinds`, one of its tags is in `tags`, or its id is in `ids`.
 */
export interface AffinityDef {
  /** Korean name, e.g. "근접 무기" */
  name: string;
  /** one-line Korean description of the bonus */
  desc: string;
  kinds?: WeaponDef['kind'][];
  tags?: string[];
  ids?: string[];
  /** stat bonus while a matching weapon is held */
  stats?(m: StatMods): void;
}

/** Does `weapon` count as a favoured weapon of `aff`? */
export function weaponMatchesAffinity(aff: AffinityDef | undefined, weapon: WeaponDef | undefined): boolean {
  if (!aff || !weapon) return false;
  if (aff.kinds?.includes(weapon.kind)) return true;
  if (aff.ids?.includes(weapon.id)) return true;
  if (aff.tags && weapon.tags) for (const t of weapon.tags) if (aff.tags.includes(t)) return true;
  return false;
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
  suspended?: boolean;
  unlockHint?: string;
  /** Explicit mechanical requirement, separate from the story hint. */
  unlockRequirement?: string;
  /** light color of the lantern */
  lightColor?: string;
  /**
   * "등불 해방" (lantern release): the character's special move, used when the
   * ember gauge is full (F). Default: radial flame burst that clears bullets.
   */
  release?(w: World, p: Player): void;
  /** one-line description of the release shown on character select */
  releaseDesc?: string;
  /** Korean name of the release (character select), e.g. "등불 개화" */
  releaseName?: string;
  releaseIcon?: string;
  // ---- character kit (all optional; absent = plain keeper)
  /** signature passive, always active (see PassiveDef) */
  passive?: PassiveDef;
  /** custom dash behaviour (default: a plain rush) */
  dash?: DashDef;
  /** favoured weapon class with a modest bonus */
  affinity?: AffinityDef;
  /** playstyle tags for character select (Korean), e.g. ['해방', '화염'] */
  playstyle?: string[];
  /** 1 easy .. 3 hard (character select) */
  difficulty?: 1 | 2 | 3;
  /** one-line "why pick me" (character select) */
  pitch?: string;
  /** lantern light radius in px (default 95) */
  lightRadius?: number;
  /**
   * Online co-op hints, read by the multiplayer code (pure data, no logic in the
   * simulation): `reviveSpeed` multiplies how fast this keeper revives a downed
   * ally (1 = normal), `reviveHearts` is how many hearts the revived ally comes
   * back with (default: the co-op default). Absent = plain keeper.
   */
  coop?: { reviveSpeed?: number; reviveHearts?: number };
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

/**
 * One floor of the descent. Floors are 1..N: the run is won on the deepest
 * defined floor (`lastFloorIndex()`); every other floor's boss leaves a trapdoor.
 * Difficulty fields follow the per-floor table `DIFFICULTY` in content/floors.ts.
 */
export interface FloorDef {
  /** 1..N (consecutive) */
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
  /** boss hp multiplier (default: hpMult) */
  bossHpMult?: number;
  /**
   * Half-hearts an enemy hit deals on this floor: [regular, heavy] (default [1, 2]).
   * A base-1 hit (contact, bullet) deals `regular`; a base-2+ hit (slam, blast)
   * deals base + (heavy - 2). See `enemyHitDamage`.
   */
  enemyDamage?: [number, number];
  /** enemy move speed multiplier (default 1) */
  enemySpeed?: number;
  /** enemy bullet speed multiplier (default 1) */
  shotSpeed?: number;
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
  /** restrict to floors (1..N) */
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

/**
 * Always-active hooks that are not items: meta progression (unlocks), global
 * run rules, achievements. Dispatched by the item system like an artifact with
 * power 1 for every run; not shown in the inventory.
 */
export interface GlobalHookDef extends ItemHooks {
  id: string;
  /**
   * Co-op: run the world-event hooks (onUpdate / onRoomEnter / onRoomClear /
   * onFloorStart) once per keeper, with that keeper as `w.player` (state kept in
   * `w.vars`, which is per keeper). Default: once per event, for the party leader.
   */
  perPlayer?: boolean;
}
export const GlobalHooks = makeRegistry<GlobalHookDef>('global hook');

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
export const defineWeapon = (d: WeaponDef) => Weapons.register(isContentTemporarilyLocked(d.id) ? { ...d, pools: [] } : d);
export const defineCharacter = (d: CharacterDef) => Characters.register(isContentTemporarilyLocked(d.id) ? { ...d, suspended: true, unlocked: false, unlockHint: '캐릭터와 장비를 다듬는 동안 잠시 쉬어갑니다. 기존 해금 기록은 유지됩니다.' } : d);
export const defineFloor = (d: FloorDef) => Floors.register(d);
export const defineTheme = (d: ThemeDef) => Themes.register(d);
export const defineRoom = (d: RoomTemplate) => RoomTemplates.register(d);
export const defineGlobalHooks = (d: GlobalHookDef) => GlobalHooks.register(d);

// ------------------------------------------------------------------ floors
/** Floor definition by index (1..N). */
export function floorAt(index: number): FloorDef | undefined {
  for (const f of Floors.map.values()) if (f.index === index) return f;
  return undefined;
}

/** The deepest defined floor: beating its boss wins the run. */
export function lastFloorIndex(): number {
  let max = 0;
  for (const f of Floors.map.values()) if (f.index > max) max = f.index;
  return max;
}

/** Is floor `index` the last one of the descent (its boss ends the run)? */
export function isLastFloor(index: number): boolean {
  return index >= lastFloorIndex();
}

/**
 * Half-hearts an enemy hit of base strength `halfHearts` deals on `floor`
 * (FloorDef.enemyDamage = [regular, heavy]; default [1, 2] = unchanged).
 */
export function enemyHitDamage(floor: FloorDef | undefined, halfHearts: number): number {
  const base = Math.max(1, Math.round(halfHearts));
  const d = floor?.enemyDamage;
  if (!d) return base;
  return base <= 1 ? d[0] : Math.max(d[0], base + d[1] - 2);
}

export function defaultPrice(r: Rarity): number {
  return r === 'common' ? 15 : r === 'rare' ? 20 : r === 'epic' ? 30 : 45;
}
