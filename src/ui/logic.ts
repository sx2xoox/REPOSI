// Pure UI logic (no DOM): seed text handling, character preview stats, stat
// display formatting, grid navigation, minimap helpers, hint bookkeeping.
// Kept separate so it can be unit-tested in node (tests/ui.test.ts).

import { Characters, Weapons, Artifacts, weaponMatchesAffinity, type CharacterDef, type WeaponDef } from '../game/defs';
import { BASE_STATS, StatMods, WEAPON_DAMAGE_SCALE, computeStats, type StatKey, type Stats } from '../game/stats';
import type { RoomKind } from '../game/constants';
import { WEAPON_KIND_NAMES, weaponFamily } from '../game/weapon-families';

// ---------------------------------------------------------------- seeds
const SEED_ALLOWED = /^[A-Z0-9-]$/;

/** Normalize a typed seed: uppercase, only A-Z 0-9 and '-', max 16 chars. */
export function sanitizeSeed(raw: string): string {
  let out = '';
  for (const ch of raw.toUpperCase()) if (SEED_ALLOWED.test(ch) && out.length < 16) out += ch;
  return out;
}

/** Apply typed characters (with '\b' = backspace) to a seed string. */
export function applyTyped(cur: string, typed: string[]): string {
  let s = cur;
  for (const ch of typed) {
    if (ch === '\b') s = s.slice(0, -1);
    else s = sanitizeSeed(s + ch);
  }
  return s;
}

// ---------------------------------------------------------------- characters
/** Effective starting stats of a character (base + character + weapon + affinity + passive + starting artifact stats). */
export function characterStats(def: CharacterDef): Stats {
  const base: Stats = { ...BASE_STATS, ...(def.baseStats ?? {}) };
  base.maxHearts = def.hearts;
  const m = new StatMods();
  const weapon = Weapons.get(def.weapon);
  try {
    weapon?.stats?.(m);
    // the weapon's attacks deal WEAPON_DAMAGE_SCALE of their damage (as ItemSystem.recomputeStats)
    m.mulStat('damage', WEAPON_DAMAGE_SCALE);
    if (weaponMatchesAffinity(def.affinity, weapon)) def.affinity?.stats?.(m);
    def.passive?.stats?.(m, 1, undefined as never);
  } catch {
    // weapon / kit stat hooks are pure in practice (a passive may read w.vars with no world); ignore failures in previews
  }
  for (const id of def.artifacts ?? []) {
    const a = Artifacts.get(id);
    try {
      a?.stats?.(m, 1, undefined as never);
    } catch {
      // stats that need a live world are skipped in the preview
    }
  }
  return computeStats(base, m);
}

/** A coloured text run (info lines, tooltips). */
export interface TextRun { t: string; c: string }

/** A weapon's classification "계열 · 속성", e.g. "활·쇠뇌 · 충전 무기" (game/weapon-families.ts). */
export function weaponClassText(def: WeaponDef): string {
  return `${weaponFamily(def.id)?.name ?? '기타'} · ${WEAPON_KIND_NAMES[def.kind] ?? def.kind}`;
}

/**
 * The classification as runs: the family turns `good` (green) when it is `keeper`'s favoured
 * weapon (CharacterDef.affinity), so the line itself tells whose weapon it is.
 */
export function weaponClassRuns(def: WeaponDef, keeper: CharacterDef | null | undefined, base: string, good: string): TextRun[] {
  const fav = weaponMatchesAffinity(keeper?.affinity, def);
  return [
    { t: weaponFamily(def.id)?.name ?? '기타', c: fav ? good : base },
    { t: ` · ${WEAPON_KIND_NAMES[def.kind] ?? def.kind}`, c: base },
  ];
}

export const WEAPON_KIND_LABELS: Record<WeaponDef['kind'], string> = { ranged: '원거리', melee: '근접', charge: '차지', beam: '광선' };
export function weaponKindLabel(kind: WeaponDef['kind']): string {
  return WEAPON_KIND_LABELS[kind] ?? kind;
}

export const DIFFICULTY_LABELS: Record<number, string> = { 1: '쉬움', 2: '보통', 3: '어려움' };

export interface KitRow {
  kind: 'passive' | 'dash' | 'release';
  /** small label above the name ("고유 능력" / "대시" / "등불 해방") */
  label: string;
  name: string;
  desc: string;
  icon: string;
  /** right-aligned hint (how to use) */
  hint?: string;
}

/** Default descriptions for keepers without a kit (plain rush, default release). */
export const DEFAULT_DASH_DESC = '짧게 질주해 적의 공격을 피한다.';
export const DEFAULT_RELEASE_DESC = '등불을 터뜨려 주변의 적과 탄환을 태운다.';

/** The three kit rows of the character select strip (passive / dash / release), with defaults when absent. */
export function characterKitRows(c: CharacterDef, open = true, touch = false, compact = false): KitRow[] {
  const pas = c.passive;
  const dash = c.dash;
  return [
    {
      kind: 'passive', label: '고유 능력', icon: pas?.icon ?? 'ui_question',
      name: pas ? pas.name : '없음', desc: pas ? (compact ? pas.summary ?? pas.desc : pas.desc) : '특별한 능력 없이 유물에 의지하는 평범한 등불지기.',
    },
    {
      kind: 'dash', label: '대시', icon: dash?.icon ?? 'st_dash',
      name: dash ? dash.name : '질주', desc: dash ? (compact ? dash.summary ?? dash.desc : dash.desc) : DEFAULT_DASH_DESC,
      hint: open ? (touch ? '대시 버튼' : 'Space') : undefined,
    },
    {
      kind: 'release', label: '등불 해방', icon: c.releaseIcon ?? 'ui_flame',
      name: c.releaseName ?? '등불 해방', desc: (compact ? c.releaseSummary ?? c.releaseDesc : c.releaseDesc) ?? DEFAULT_RELEASE_DESC,
      hint: open ? (touch ? '해방 버튼' : '게이지가 가득 차면 F') : undefined,
    },
  ];
}

export interface StatRow {
  key: StatKey;
  label: string;
  icon: string;
  /** 0..1 bar fill for comparisons */
  frac: number;
  text: string;
}

/** Character select stat rows (bars are relative to a generous max). */
export function characterStatRows(s: Stats): StatRow[] {
  const f = (v: number, max: number) => Math.max(0.04, Math.min(1, v / max));
  return [
    { key: 'damage', label: '공격력', icon: 'st_damage', frac: f(s.damage, 22), text: s.damage.toFixed(1) },
    { key: 'fireRate', label: '공격 속도', icon: 'st_firerate', frac: f(s.fireRate, 5), text: `${s.fireRate.toFixed(2)}/초` },
    { key: 'range', label: '사거리', icon: 'st_range', frac: f(s.range, 340), text: (s.range / 37).toFixed(1) },
    { key: 'moveSpeed', label: '이동 속도', icon: 'st_speed', frac: f(s.moveSpeed, 140), text: (s.moveSpeed / 92).toFixed(2) },
    { key: 'dashCooldown', label: '대시', icon: 'st_dash', frac: f(1 / s.dashCooldown, 1.8), text: `${s.dashCooldown.toFixed(2)}초` },
  ];
}

/** Is the character playable (unlocked by default or by save flag)? */
export function isUnlocked(def: CharacterDef, flags: string[]): boolean {
  return !def.suspended && (def.unlocked || flags.includes(`unlock:${def.id}`));
}

/** Characters in select order: unlocked first keep registry order, locked after. */
export function characterOrder(flags: string[]): CharacterDef[] {
  const all = Characters.all();
  return [...all.filter((c) => isUnlocked(c, flags)), ...all.filter((c) => !isUnlocked(c, flags))];
}

// ---------------------------------------------------------------- HUD stats
export interface HudStat {
  key: StatKey;
  icon: string;
  /** displayed value (Isaac-like normalized numbers) */
  value: number;
  text: string;
  /** larger is better? (false for cooldowns) */
  higherBetter: boolean;
}

/** Isaac-style normalized stat values for the HUD column. */
export function hudStats(s: Stats): HudStat[] {
  return [
    { key: 'moveSpeed', icon: 'st_speed', value: s.moveSpeed / 92, text: (s.moveSpeed / 92).toFixed(2), higherBetter: true },
    { key: 'fireRate', icon: 'st_firerate', value: s.fireRate, text: s.fireRate.toFixed(2), higherBetter: true },
    { key: 'damage', icon: 'st_damage', value: s.damage, text: s.damage.toFixed(1), higherBetter: true },
    { key: 'range', icon: 'st_range', value: s.range / 37, text: (s.range / 37).toFixed(1), higherBetter: true },
    { key: 'shotSpeed', icon: 'st_shotspeed', value: s.shotSpeed / 230, text: (s.shotSpeed / 230).toFixed(2), higherBetter: true },
    { key: 'luck', icon: 'st_luck', value: s.luck, text: s.luck.toFixed(0), higherBetter: true },
  ];
}

/** Format a stat delta like "+0.25" / "-1.5" with the precision of its display text. */
export function formatDelta(delta: number, sample: string): string {
  const dot = sample.indexOf('.');
  const digits = dot < 0 ? 0 : sample.length - dot - 1;
  const v = Math.abs(delta).toFixed(digits);
  if (Number(v) === 0) return '';
  return `${delta > 0 ? '+' : '-'}${v}`;
}

/** Full stat list for the status screen: [label, value text, compare (-1 worse, 0 same, 1 better)]. */
export function fullStatRows(s: Stats, base: Stats = BASE_STATS): [string, string, number][] {
  const cmp = (v: number, b: number, higher = true) => (Math.abs(v - b) < 1e-6 ? 0 : (v > b) === higher ? 1 : -1);
  return [
    ['공격력', s.damage.toFixed(1), cmp(s.damage, base.damage)],
    ['공격 속도', `${s.fireRate.toFixed(2)}/초`, cmp(s.fireRate, base.fireRate)],
    ['사거리', (s.range / 37).toFixed(1), cmp(s.range, base.range)],
    ['탄속', (s.shotSpeed / 230).toFixed(2), cmp(s.shotSpeed, base.shotSpeed)],
    ['이동 속도', (s.moveSpeed / 92).toFixed(2), cmp(s.moveSpeed, base.moveSpeed)],
    ['행운', s.luck.toFixed(0), cmp(s.luck, base.luck)],
    ['치명타 확률', `${Math.round(s.critChance * 100)}%`, cmp(s.critChance, base.critChance)],
    ['치명타 피해', `x${s.critMult.toFixed(1)}`, cmp(s.critMult, base.critMult)],
    ['투사체 수', `${s.shots}`, cmp(s.shots, base.shots)],
    ['관통', `${s.pierce}`, cmp(s.pierce, base.pierce)],
    ['튕김', `${s.bounce}`, cmp(s.bounce, base.bounce)],
    ['유도', s.homing > 0 ? s.homing.toFixed(1) : '없음', cmp(s.homing, base.homing)],
    ['넉백', s.knockback.toFixed(0), cmp(s.knockback, base.knockback)],
    ['대시 재사용', `${s.dashCooldown.toFixed(2)}초`, cmp(s.dashCooldown, base.dashCooldown, false)],
    ['무적 시간', `${s.invuln.toFixed(1)}초`, cmp(s.invuln, base.invuln)],
    ['회피', `${Math.round(s.dodge * 100)}%`, cmp(s.dodge, base.dodge)],
    ['흡혈', `${Math.round(s.lifesteal * 100)}%`, cmp(s.lifesteal, base.lifesteal)],
    ['보스 피해', `+${Math.round(s.bossDamage * 100)}%`, cmp(s.bossDamage, base.bossDamage)],
    ['절약', `${Math.round(s.thrift * 100)}%`, cmp(s.thrift, base.thrift)],
    ['자석 범위', s.magnet.toFixed(0), cmp(s.magnet, base.magnet)],
  ];
}

// ---------------------------------------------------------------- grids
/** Move a selection index inside a grid of `n` items with `cols` columns. Returns the new index. */
export function gridMove(index: number, n: number, cols: number, dx: number, dy: number): number {
  if (n <= 0) return 0;
  let i = Math.max(0, Math.min(n - 1, index));
  if (dx) {
    const row = Math.floor(i / cols);
    const rowStart = row * cols;
    const rowEnd = Math.min(n, rowStart + cols) - 1;
    i += dx;
    if (i > rowEnd) i = rowStart;
    if (i < rowStart) i = rowEnd;
  }
  if (dy) {
    const rows = Math.ceil(n / cols);
    const col = i % cols;
    let row = Math.floor(i / cols) + dy;
    if (row < 0) row = rows - 1;
    if (row >= rows) row = 0;
    i = Math.min(n - 1, row * cols + col);
  }
  return i;
}

/** First visible row so that `row` stays inside a window of `visible` rows. */
export function scrollToRow(scroll: number, row: number, visible: number): number {
  if (row < scroll) return row;
  if (row >= scroll + visible) return row - visible + 1;
  return scroll;
}

// ---------------------------------------------------------------- map legend
export const ROOM_LABELS: Record<RoomKind, string> = {
  start: '시작',
  normal: '일반',
  boss: '보스',
  treasure: '보물방',
  shop: '상점',
  secret: '비밀방',
  challenge: '도전방',
  shrine: '성소',
  curse: '저주방',
  relay: '등불 회랑', workshop: '잿불 대장간', vault: '경보 금고',
  refinery: '제련방', fusion: '합성방', well: '우물방', elite: '엘리트방',
};

export const ROOM_ICONS: Partial<Record<RoomKind, string>> = {
  boss: 'map_boss',
  treasure: 'map_treasure',
  shop: 'map_shop',
  secret: 'map_secret',
  challenge: 'map_challenge',
  shrine: 'map_shrine',
  curse: 'map_curse',
  relay: 'map_relay', workshop: 'map_workshop', vault: 'map_vault',
  refinery: 'map_refinery', fusion: 'map_fusion', well: 'map_well', elite: 'map_elite',
};

// ---------------------------------------------------------------- hearts
export type HeartKind = 'full' | 'half' | 'empty' | 'soul' | 'soulHalf';

/** Heart slots from red / max red / soul half-hearts (Isaac order: red containers then soul). */
export function heartSlots(red: number, maxRed: number, soul: number): HeartKind[] {
  const out: HeartKind[] = [];
  const containers = Math.ceil(maxRed / 2);
  for (let i = 0; i < containers; i++) {
    const v = red - i * 2;
    out.push(v >= 2 ? 'full' : v === 1 ? 'half' : 'empty');
  }
  const soulSlots = Math.ceil(soul / 2);
  for (let i = 0; i < soulSlots; i++) {
    const v = soul - i * 2;
    out.push(v >= 2 ? 'soul' : 'soulHalf');
  }
  return out;
}
