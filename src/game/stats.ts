// Player stats. Final stats = (base + sum(add)) * prod(mul), then clamped.
// Artifacts / sets / weapons contribute through StatMods in their `stats()` callback.

export interface Stats {
  /** max red heart containers (full hearts) */
  maxHearts: number;
  damage: number;
  /** attacks per second */
  fireRate: number;
  /** projectile travel distance in px (melee: reach scales with this) */
  range: number;
  /** projectile speed px/s */
  shotSpeed: number;
  /** movement px/s */
  moveSpeed: number;
  luck: number;
  critChance: number;
  critMult: number;
  knockback: number;
  /** projectile radius px */
  projSize: number;
  /** projectiles per attack */
  shots: number;
  /** angle between multishot projectiles (radians) */
  spread: number;
  /** extra enemies a projectile passes through */
  pierce: number;
  /** wall bounces */
  bounce: number;
  /** homing turn rate (radians/s); 0 = none */
  homing: number;
  dashCooldown: number;
  dashSpeed: number;
  dashTime: number;
  /** invulnerability after being hurt (s) */
  invuln: number;
  /** pickup magnet radius px */
  magnet: number;
  /** % bonus damage vs bosses (0.2 = +20%) */
  bossDamage: number;
  /** multiplier for coins found */
  greed: number;
  /** chance to not consume a bomb/key etc. */
  thrift: number;
  /** life steal: chance per kill to heal half heart */
  lifesteal: number;
  /** damage reduction chance (0..0.75) to ignore a hit */
  dodge: number;
}

export type StatKey = keyof Stats;

export const BASE_STATS: Stats = {
  maxHearts: 3,
  damage: 10,
  fireRate: 2.6,
  range: 185,
  shotSpeed: 230,
  moveSpeed: 92,
  luck: 0,
  critChance: 0.05,
  critMult: 1.8,
  knockback: 70,
  projSize: 3,
  shots: 1,
  spread: 0.2,
  pierce: 0,
  bounce: 0,
  homing: 0,
  dashCooldown: 0.85,
  dashSpeed: 330,
  dashTime: 0.15,
  invuln: 1.0,
  magnet: 18,
  bossDamage: 0,
  greed: 1,
  thrift: 0,
  lifesteal: 0,
  dodge: 0,
};

const LIMITS: Partial<Record<StatKey, [number, number]>> = {
  maxHearts: [1, 12],
  damage: [1, 9999],
  fireRate: [0.4, 30],
  range: [40, 1200],
  shotSpeed: [80, 900],
  moveSpeed: [45, 210],
  critChance: [0, 1],
  critMult: [1, 10],
  projSize: [1.5, 14],
  shots: [1, 16],
  pierce: [0, 99],
  bounce: [0, 99],
  dashCooldown: [0.15, 5],
  dashTime: [0.05, 0.5],
  invuln: [0.3, 4],
  dodge: [0, 0.75],
  thrift: [0, 0.9],
  lifesteal: [0, 1],
};

export class StatMods {
  add: Partial<Record<StatKey, number>> = {};
  mul: Partial<Record<StatKey, number>> = {};
  /**
   * Boolean abilities granted by items, e.g. 'flying' (cross pits), 'spectral'
   * (shots pass rocks), 'pierceAll', 'blindShots'. Read via player.flags.
   */
  flags = new Set<string>();

  flag(name: string): this {
    this.flags.add(name);
    return this;
  }

  /** additive bonus (applied before multipliers) */
  addStat(k: StatKey, v: number): this {
    this.add[k] = (this.add[k] ?? 0) + v;
    return this;
  }

  /** multiplicative bonus, e.g. mulStat('damage', 1.25) */
  mulStat(k: StatKey, v: number): this {
    this.mul[k] = (this.mul[k] ?? 1) * v;
    return this;
  }
}

export function computeStats(base: Stats, mods: StatMods): Stats {
  const out = { ...base };
  for (const k of Object.keys(out) as StatKey[]) {
    let v = base[k] + (mods.add[k] ?? 0);
    v *= mods.mul[k] ?? 1;
    const lim = LIMITS[k];
    if (lim) v = Math.min(lim[1], Math.max(lim[0], v));
    out[k] = v;
  }
  out.maxHearts = Math.floor(out.maxHearts);
  out.shots = Math.max(1, Math.floor(out.shots + 1e-6));
  out.pierce = Math.floor(out.pierce + 1e-6);
  out.bounce = Math.floor(out.bounce + 1e-6);
  return out;
}

/** Labels used by the stats panel. */
export const STAT_LABELS: Partial<Record<StatKey, string>> = {
  damage: '공격력',
  fireRate: '공격 속도',
  range: '사거리',
  shotSpeed: '탄속',
  moveSpeed: '이동 속도',
  luck: '행운',
  critChance: '치명타 확률',
  critMult: '치명타 피해',
};
