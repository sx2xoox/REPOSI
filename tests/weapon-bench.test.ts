// Weapon combat benchmark (not part of the regular suite): every weapon on the
// kitless keeper clears the same real enemy groups (moving, shooting, with
// their telegraphs) under a simple fighting bot; reports clear time and
// damage taken relative to the starter lantern. Complements the dummy DPS
// report (tests/dps-matrix.test.ts), which cannot see range, projectile
// travel, crowd value or safety.
//
//   WEAPON_BENCH=1 npx vitest run tests/weapon-bench
//   WEAPON_BENCH=1 BENCH_ONLY=lantern_bolt,twin_daggers npx vitest run tests/weapon-bench

import './headless';
import { describe, it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { World, type WorldHost } from '../src/game/world';
import { RunState } from '../src/game/run';
import { FIXED_DT } from '../src/game/constants';
import { Enemies, Weapons } from '../src/game/defs';
import { HELD, PRESS, fixedRules, type PlayerInput } from '../src/game/seam';
import { PLAIN_ID, RELEASE_WEAPONS } from './dpsharness';
import type { Enemy } from '../src/game/enemy';

/** Enemy groups spread across the early and middle floors (ids must exist). */
export const BENCH_GROUPS: { name: string; floor: number; enemies: string[] }[] = [
  { name: 'crypt', floor: 1, enemies: ['bone_walker', 'crypt_bat', 'cursed_candle', 'wailing_shade', 'grave_rat', 'grave_rat'] },
  { name: 'caves', floor: 2, enemies: ['cave_leech', 'dust_moth', 'spore_pod', 'cave_slime', 'gas_bloater'] },
  { name: 'forge', floor: 3, enemies: ['fire_imp', 'chain_hound', 'bellows_turret', 'forge_sentinel', 'fire_imp'] },
  { name: 'abyss', floor: 5, enemies: ['void_eye', 'shadow_double', 'abyss_larva', 'abyss_larva', 'gravity_well'] },
];

const SPOTS = [[-110, -46], [110, -46], [-110, 46], [110, 46], [0, -56], [0, 56]];
const host: WorldHost = { openInventory() {}, onGameOver() {} };
let renderer: Renderer | null = null;

export interface BenchResult { time: number; taken: number; cleared: boolean }

/** One fight: `weapon` on the plain keeper against `group`; enemy HP uses floor-1 scaling for every group. */
export function benchFight(weapon: string, group: (typeof BENCH_GROUPS)[number], seed = 'BENCH', limit = 60): BenchResult {
  if (!renderer) renderer = new Renderer(fakeDisplay(1280, 720));
  const run = new RunState(`${seed}-${group.name}-${weapon}`, PLAIN_ID);
  run.seeded = true;
  const w = new World(renderer, run, host);
  w.setQuality({ lighting: false, particles: 0 });
  w.rules = fixedRules({ hitStop: false });
  const def = Weapons.must(weapon);
  const close = def.kind === 'melee' || weapon === 'titan_greatsword';
  const strafe = { dir: 1, t: 0 };
  const bot = (ww: World, _p: unknown, out: PlayerInput) => {
    const p = ww.player;
    out.mx = out.my = out.ax = out.ay = 0;
    out.held = 0;
    out.pressed = 0;
    out.cx = p.x + 30;
    out.cy = p.y;
    let t: Enemy | null = null;
    let bd = Infinity;
    for (const e of ww.enemies) {
      if (!e.alive || e.hidden) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bd) { bd = d; t = e; }
    }
    if (!t) return;
    strafe.t -= FIXED_DT;
    if (strafe.t <= 0) { strafe.dir = -strafe.dir; strafe.t = 0.9 + ((ww.time * 7) % 1) * 0.8; }
    const dx = t.x - p.x;
    const dy = t.y - (p.y - 4);
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    // melee closes in and sidesteps; ranged keeps a fighting distance and circles
    const want = close ? (d > 20 ? 1 : -0.3) : d < 60 ? -1 : d > 110 ? 1 : 0;
    const side = close ? 0.35 : 0.9;
    let mx = ux * want - uy * strafe.dir * side;
    let my = uy * want + ux * strafe.dir * side;
    // sidestep the nearest incoming enemy bullet
    for (const q of ww.projectiles) {
      if (q.dead || q.team !== 'enemy') continue;
      const qx = p.x - q.x;
      const qy = p.y - q.y;
      const qd = Math.hypot(qx, qy);
      if (qd < 34 && q.vx * qx + q.vy * qy > 0) {
        mx += -q.vy / (Math.hypot(q.vx, q.vy) || 1) * 1.5;
        my += q.vx / (Math.hypot(q.vx, q.vy) || 1) * 1.5;
        if (qd < 20) out.pressed |= PRESS.dash;
        break;
      }
    }
    const ml = Math.hypot(mx, my);
    if (ml > 1e-6) { out.mx = mx / ml; out.my = my / ml; }
    let firing = true;
    if (RELEASE_WEAPONS.has(weapon)) firing = ww.time % 1.1 < 0.95;
    out.held = (firing ? HELD.fire : 0) | HELD.cursorAim;
    out.cx = t.x;
    out.cy = t.y - 4;
  };
  w.inputSource = bot;
  w.start();
  const p = w.player;
  for (const e of [...w.enemies]) w.killEnemy(e);
  if (p.weaponId !== weapon) p.equipWeapon(w, weapon);
  p.stats.maxHearts = 40;
  const cx = p.x;
  const cy = p.y;
  group.enemies.forEach((id, i) => {
    const [ox, oy] = SPOTS[i % SPOTS.length];
    const at = w.room.nearestFree(cx + ox, cy + oy, 10);
    w.spawnEnemy(id, at.x, at.y);
  });
  // a real combat room seals its doors (the start room would leave doorways for fliers to hover in)
  w.room.setDoorsClosed(true);
  const steps = Math.round(limit / FIXED_DT);
  let i = 0;
  for (; i < steps; i++) {
    p.red = p.maxRed;
    w.update(FIXED_DT);
    if (!w.enemies.some((e) => e.alive)) break;
  }
  return { time: i * FIXED_DT, taken: w.run.stats.damageTaken, cleared: i < steps };
}

/** Sum over every bench group. */
export function benchWeapon(weapon: string, seed = 'BENCH'): BenchResult {
  let time = 0;
  let taken = 0;
  let cleared = true;
  for (const g of BENCH_GROUPS) {
    const r = benchFight(weapon, g, seed);
    time += r.time;
    taken += r.taken;
    cleared &&= r.cleared;
  }
  return { time, taken, cleared };
}

describe.skipIf(!process.env.WEAPON_BENCH)('weapon combat bench', () => {
  it('every weapon vs the same enemy groups (clear time / damage taken vs the lantern)', () => {
    for (const g of BENCH_GROUPS) for (const id of g.enemies) if (!Enemies.has(id)) throw new Error(`bench enemy missing: ${id}`);
    const only = process.env.BENCH_ONLY?.split(',').filter(Boolean);
    const seeds = (process.env.BENCH_SEEDS ?? 'BENCH-A,BENCH-B').split(',');
    const avg = (id: string) => {
      const rs = seeds.map((s) => benchWeapon(id, s));
      return { time: rs.reduce((a, r) => a + r.time, 0) / rs.length, taken: rs.reduce((a, r) => a + r.taken, 0) / rs.length, cleared: rs.every((r) => r.cleared) };
    };
    const base = avg('lantern_bolt');
    const ids = Weapons.all().map((d) => d.id).filter((id) => !only || only.includes(id));
    const rows = ids.map((id) => ({ id, rarity: Weapons.must(id).rarity, kind: Weapons.must(id).kind, ...avg(id) }));
    rows.sort((a, b) => a.time - b.time);
    const lines = rows.map((r) => `${r.rarity.padEnd(9)} ${r.kind.padEnd(6)} ${r.id.padEnd(20)} clear ${r.time.toFixed(1).padStart(6)}s (${(r.time / base.time).toFixed(2)})  taken ${r.taken.toFixed(1).padStart(5)} (${(r.taken / Math.max(1, base.taken)).toFixed(2)})${r.cleared ? '' : '  TIMEOUT'}`);
    console.log(`WEAPON BENCH base clear ${base.time.toFixed(1)}s taken ${base.taken.toFixed(1)} (groups: ${BENCH_GROUPS.map((g) => g.name).join(', ')}; seeds: ${seeds.join(', ')})\n${lines.join('\n')}`);
  }, 3_600_000);
});
