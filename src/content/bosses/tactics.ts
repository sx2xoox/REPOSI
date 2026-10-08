import type { RNG } from '../../engine/rng';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';

type Role = 'close' | 'chase' | 'arena' | 'shot' | 'setup';
export interface BossPattern { id: string; w: number; when?: boolean }
export interface TacticMemory { recent: string[]; withoutPhysical: number }

// Physical attacks are bodies, floor eruptions, blades and beams, never disguised bullets.
// Setup attacks stay useful, but cannot count as physical pressure on their own.
export const BOSS_TACTICS: Record<string, Record<string, Role>> = {
  bone_colossus: { slam: 'close', retch: 'shot', leap: 'chase', charge: 'chase', soul: 'shot', raise: 'setup' },
  bell_keeper: { toll: 'shot', procession: 'shot', drop: 'arena', summon: 'setup', requiem: 'shot' },
  spore_mother: { burst: 'shot', sacks: 'shot', roots: 'arena', burrow: 'setup', brood: 'setup' },
  slime_queen: { leap: 'chase', hops: 'close', globs: 'shot', crush: 'arena' },
  chain_smith: { strike: 'close', hook: 'chase', slag: 'shot', bellows: 'shot', cyclone: 'close', imps: 'setup', furnace: 'arena' },
  slag_imugi: { breach: 'chase', breath: 'shot', rain: 'shot', geyser: 'arena' },
  frost_commander: { charge: 'chase', leap: 'chase', sweep: 'close', wall: 'arena', rally: 'setup', storm: 'arena' },
  frost_saint: { hymn: 'shot', lances: 'shot', bloom: 'arena', choir: 'setup', blizzard: 'shot', requiem: 'shot', prisms: 'arena' },
  mumyeong: { slam: 'arena', gaze: 'arena', rings: 'shot', summon: 'setup', claw: 'close', spiral: 'shot', devour: 'arena' },
  sunken_lighthouse: { sweep: 'arena', split: 'arena', blackout: 'arena', wisps: 'shot', slam: 'close', flash: 'arena', horn: 'shot', summon: 'setup' },
  grand_archivist: { write: 'shot', underline: 'arena', pages: 'setup', drops: 'shot', summon: 'setup', flood: 'arena', vortex: 'shot' },
  clockwork_dancer: { pirouette: 'chase', skirt: 'shot', pins: 'shot', mirrors: 'setup', leap: 'chase', ribbons: 'shot', waltz: 'chase', rondo: 'arena', dacapo: 'chase', trio: 'shot', curtain: 'arena' },
  clockmaker: { freeze: 'shot', rewind: 'shot', hands: 'arena', wells: 'setup', gears: 'shot', summon: 'setup', stop: 'shot', chime: 'arena' },
};

export function isPhysicalPattern(boss: string, pattern: string): boolean {
  return ['close', 'chase', 'arena'].includes(BOSS_TACTICS[boss]?.[pattern]);
}

/** Complementary follow-ups; availability/cooldowns still take priority. */
const FOLLOW_UPS: Record<string, Record<string, string[]>> = {
  bone_colossus: { retch: ['leap', 'charge'], slam: ['retch'], raise: ['charge'] },
  bell_keeper: { procession: ['drop'], summon: ['drop'], drop: ['toll'] },
  spore_mother: { sacks: ['roots'], burst: ['roots'], burrow: ['roots'], brood: ['sacks'] },
  slime_queen: { globs: ['leap', 'hops'], leap: ['globs'], crush: ['hops'] },
  chain_smith: { slag: ['hook'], hook: ['strike', 'cyclone'], furnace: ['hook'], imps: ['furnace'] },
  slag_imugi: { rain: ['breach'], breath: ['geyser'], geyser: ['breach'] },
  frost_commander: { wall: ['leap', 'charge'], rally: ['charge'], charge: ['sweep'] },
  frost_saint: { choir: ['bloom'], hymn: ['bloom', 'prisms'], prisms: ['lances'] },
  mumyeong: { rings: ['gaze', 'slam'], summon: ['gaze'], gaze: ['claw', 'rings'] },
  sunken_lighthouse: { wisps: ['sweep'], summon: ['flash'], sweep: ['flash'], horn: ['slam', 'flash'] },
  grand_archivist: { pages: ['underline'], drops: ['underline'], summon: ['write'], underline: ['drops'] },
  clockwork_dancer: { mirrors: ['leap'], pins: ['pirouette'], skirt: ['leap'], leap: ['ribbons'], rondo: ['ribbons', 'pins'], dacapo: ['skirt', 'pins'], trio: ['leap'] },
  clockmaker: { wells: ['hands'], summon: ['chime'], freeze: ['hands'], rewind: ['chime'] },
};

/** Aim from observed movement once, before showing the warning; never tracks after lock. */
export function bossIntercept(target: { x: number; y: number; vx?: number; vy?: number }, seconds = 0.3) {
  const vx = target.vx ?? 0, vy = target.vy ?? 0;
  const speed = Math.hypot(vx, vy);
  const lead = speed > 0 ? Math.min(Math.max(0, seconds), 28 / speed) : 0;
  return { x: target.x + vx * lead, y: target.y + vy * lead };
}

/** Seeded choice from observable distance and past choices; never reads the keeper's input/build. */
export function selectBossPattern(rng: RNG, boss: string, opts: readonly BossPattern[], last: string | null,
  distance: number, memory: TacticMemory): string {
  const available = opts.filter(o => o.w > 0 && o.when !== false);
  if (!available.length) throw new Error(`No available boss pattern: ${boss}`);
  let pool = available.length > 1 ? available.filter(o => o.id !== last) : available;
  const roles = BOSS_TACTICS[boss] ?? {};
  // Avoid wasting turns summoning/repositioning twice, or swinging out of reach.
  const useful = pool.filter(o => !(roles[last ?? ''] === 'setup' && roles[o.id] === 'setup')
    && !(distance > 145 && roles[o.id] === 'close'));
  if (useful.length) pool = useful;
  // Do not let a succession of volleys/summons leave a bullet-clearing build unchallenged.
  const physical = pool.filter(o => isPhysicalPattern(boss, o.id));
  if (memory.withoutPhysical >= 2 && physical.length) pool = physical;
  const weighted = pool.map(o => {
    const role = BOSS_TACTICS[boss]?.[o.id];
    let factor = role === 'close' ? (distance < 85 ? 1.8 : distance > 145 ? 0.45 : 1)
      : role === 'chase' ? (distance > 125 ? 1.65 : distance < 65 ? 0.65 : 1)
      : role === 'arena' ? 1.3 : 1;
    if (memory.recent.includes(o.id)) factor *= 0.55;
    if (FOLLOW_UPS[boss]?.[last ?? '']?.includes(o.id)) factor *= 2.8;
    return { id: o.id, w: o.w * factor };
  });
  const id = (rng.weighted(weighted, o => o.w) ?? weighted[0]).id;
  memory.recent = [...memory.recent.slice(-1), id];
  memory.withoutPhysical = isPhysicalPattern(boss, id) ? 0 : memory.withoutPhysical + 1;
  return id;
}

export function pickBossPattern(e: Enemy, w: World, opts: readonly BossPattern[], last: string | null): string {
  const memory: TacticMemory = e.mem.tactics ??= { recent: [], withoutPhysical: 0 };
  return selectBossPattern(w.rng, e.def.id, opts, last, e.distToTarget(w), memory);
}
