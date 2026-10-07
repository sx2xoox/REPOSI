// Boss fight bench (opt-in): the plain keeper with the starter lantern, its
// damage scaled ×1 / ×3 / ×8 / ×20 (a stand-in for builds of rising power),
// fights each boss under a dodging bot; reports time-to-kill and the phase
// changes seen, with and without the boss resolve rules (content/bosses/resolve.ts).
//
//   BOSS_BENCH=1 npx vitest run tests/boss-bench

import './headless';
import { describe, it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { World, type WorldHost } from '../src/game/world';
import { RunState } from '../src/game/run';
import { FIXED_DT } from '../src/game/constants';
import { Enemies } from '../src/game/defs';
import { bossRules, type Enemy } from '../src/game/enemy';
import { HELD, PRESS, fixedRules, type PlayerInput } from '../src/game/seam';
import { PLAIN_ID } from './dpsharness';

const host: WorldHost = { openInventory() {}, onGameOver() {} };
/** Boss-made things that threaten the keeper (props, braziers, the imugi's body and 무명's idle hands do not count). */
const THREATS = new Set(['GroundWarning', 'Shockwave', 'Faller', 'Eruption', 'Lob', 'Hazard', 'BossBeam', 'HookShot', 'TimeWell', 'ClockHand',
  'ShockRing', 'GhostDancer', 'Beam', 'LampFlash', 'LampBeam', 'InkStroke', 'InkPool', 'PageWall', 'Spike', 'Sector']);
let renderer: Renderer | null = null;

export interface BossFight {
  time: number; phases: number; killed: boolean; boss: string;
  /** share of the fight with no enemy shot, hazard or telegraph live (the boss's openings) */
  idle: number;
  /** longest stretch with nothing threatening (s) */
  longestIdle: number;
  /** enemy shots fired per second */
  shotsPerSec: number;
}

/** One boss fight on its floor at `power` × the keeper's damage (rules on/off). */
export function bossFight(bossId: string, power: number, rules = true, seed = 'BOSS-BENCH', limit = 150, startPhase2 = false): BossFight {
  if (!renderer) renderer = new Renderer(fakeDisplay(1280, 720));
  const def = Enemies.must(bossId);
  const floor = def.bossFloors![0];
  const run = new RunState(`${seed}-${bossId}`, PLAIN_ID);
  run.seeded = true;
  const w = new World(renderer, run, host);
  w.setQuality({ lighting: false, particles: 0 });
  w.rules = fixedRules({ hitStop: false });
  const saved = { filter: bossRules.filter, update: bossRules.update };
  if (!rules) { bossRules.filter = undefined; bossRules.update = undefined; }
  try {
    const strafe = { dir: 1, t: 0 };
    w.inputSource = (ww: World, _p: unknown, out: PlayerInput) => {
      const p = ww.player;
      out.mx = out.my = out.ax = out.ay = 0;
      out.held = 0;
      out.pressed = 0;
      out.cx = p.x + 30;
      out.cy = p.y;
      let t: Enemy | null = null;
      let bd = Infinity;
      for (const e of ww.enemies) {
        if (!e.alive || e.hidden || !e.vulnerable) continue;
        // a boss skill's helpers first (cocoons, crown, anchors, banner), else the boss
        const d = Math.hypot(e.x - p.x, e.y - p.y) - (e.mem.ward ? 400 : 0);
        if (d < bd) { bd = d; t = e; }
      }
      if (!t) return;
      const boss0 = ww.enemies.find((e) => e.isBoss && e.alive);
      strafe.t -= FIXED_DT;
      if (strafe.t <= 0) { strafe.dir = -strafe.dir; strafe.t = 0.8 + ((ww.time * 7) % 1) * 0.8; }
      const dx = t.x - p.x;
      const dy = t.y - (p.y - 4);
      const d = Math.hypot(dx, dy) || 1;
      // the deep bosses ask to be approached (무명's light) or walked over (대서기관's seals)
      const close = boss0?.def.id === 'mumyeong' ? 50 : 70;
      const want = d < close ? -1 : d > close + 50 ? 1 : 0;
      let mx = (dx / d) * want - (dy / d) * strafe.dir;
      let my = (dy / d) * want + (dx / d) * strafe.dir;
      if (boss0?.mem.wdSeal) {
        let sd = Infinity;
        for (let i = 0; i < 4; i++) {
          if ((boss0.mem[`wdS${i}p`] ?? -1) < 0) continue;
          const sx = boss0.mem[`wdS${i}x`] - p.x;
          const sy = boss0.mem[`wdS${i}y`] - p.y;
          const dd = Math.hypot(sx, sy);
          if (dd < sd) { sd = dd; mx = sx / (dd || 1); my = sy / (dd || 1); }
        }
        if (sd < 4) mx = my = 0;
      }
      for (const q of ww.projectiles) {
        if (q.dead || q.team !== 'enemy') continue;
        const qx = p.x - q.x;
        const qy = p.y - q.y;
        const qd = Math.hypot(qx, qy);
        if (qd < 34 && q.vx * qx + q.vy * qy > 0) {
          const sp = Math.hypot(q.vx, q.vy) || 1;
          mx += (-q.vy / sp) * 1.5;
          my += (q.vx / sp) * 1.5;
          if (qd < 20) out.pressed |= PRESS.dash;
          break;
        }
      }
      const ml = Math.hypot(mx, my);
      if (ml > 1e-6) { out.mx = mx / ml; out.my = my / ml; }
      // hold fire while the ice mirror is up (a player would wait it out)
      out.held = (boss0?.mem.wdMirror === 2 ? 0 : HELD.fire) | HELD.cursorAim;
      out.cx = t.x;
      out.cy = t.y - 4;
    };
    w.start();
    if (floor > 1) w.startFloor(floor);
    const p = w.player;
    p.stats.maxHearts = 40;
    const node = w.map.nodes.find((n) => n.kind === 'boss')!;
    // force this boss: the boss room picks by seed, so swap the pick when needed
    const pick = Enemies.must(bossId);
    const orig = w.spawnEnemy.bind(w);
    w.spawnEnemy = (id: string, x: number, y: number) => orig(Enemies.get(id)?.boss ? pick.id : id, x, y);
    w.enterRoom(node, null);
    w.spawnEnemy = orig;
    const applyHit = w.applyHit.bind(w);
    w.applyHit = (target, hit) => {
      if (hit.attacker === p || (hit.source && 'team' in hit.source && (hit.source as { team: string }).team === 'player')) hit.damage *= power;
      return applyHit(target, hit);
    };
    w.update(FIXED_DT);
    const boss = w.enemies.find((e) => e.isBoss) ?? (w.entities.find((e) => (e as Enemy).isBoss) as Enemy);
    if (!boss) throw new Error(`no boss spawned for ${bossId}`);
    if (startPhase2) {
      // straight to the second phase (past its phase change)
      boss.dormant = 0;
      w.applyHit(boss, { damage: boss.maxHp * 0.55, kind: 'projectile', attacker: p, release: true });
      for (let k = 0; k < 600 && (boss.phase < 1 || boss.mem.rsHold || (boss.mem.rsGuard ?? 0) > 0); k++) w.update(FIXED_DT);
    }
    const steps = Math.round(limit / FIXED_DT);
    let i = 0;
    let idle = 0;
    let run = 0;
    let longest = 0;
    let shots = 0;
    const seen = new Set<number>();
    const intro = Math.round(1.6 / FIXED_DT);
    for (; i < steps; i++) {
      p.red = p.maxRed;
      w.update(FIXED_DT);
      if (!boss.alive) break;
      if (i < intro) continue;
      let threat = boss.telegraphT > 0;
      for (const q of w.projectiles) {
        if (q.dead || q.team !== 'enemy') continue;
        threat = true;
        if (!seen.has(q.id)) { seen.add(q.id); shots++; }
      }
      // a charge or dash is an attack too
      if (Math.hypot(boss.vx, boss.vy) > 140 || boss.z > 6) threat = true;
      if (!threat) for (const e of w.entities) if (!e.dead && (e.enemyHazard || THREATS.has(e.constructor.name))) { threat = true; break; }
      if (!threat) for (const e of w.enemies) if (e.alive && e !== boss && e.telegraphT > 0) { threat = true; break; }
      if (threat) run = 0;
      else {
        idle++;
        run++;
        longest = Math.max(longest, run);
      }
    }
    const fought = Math.max(1, i - intro);
    return {
      time: (i - intro) * FIXED_DT, phases: boss.phase, killed: !boss.alive, boss: bossId,
      idle: idle / fought, longestIdle: longest * FIXED_DT, shotsPerSec: shots / (fought * FIXED_DT),
    };
  } finally {
    bossRules.filter = saved.filter;
    bossRules.update = saved.update;
  }
}

describe.skipIf(!process.env.BOSS_BENCH)('boss bench', () => {
  it('time-to-kill by power, rules off vs on', () => {
    const bosses = (process.env.BOSS_ONLY?.split(',') ?? Enemies.all().filter((e) => e.boss).map((e) => e.id));
    const powers = (process.env.BOSS_POWERS ?? '1,3,8,20').split(',').map(Number);
    const lines: string[] = [];
    for (const id of bosses) {
      const cells = powers.map((k) => {
        const off = bossFight(id, k, false);
        const on = bossFight(id, k, true);
        const f = (r: BossFight) => `${r.killed ? r.time.toFixed(1) : '>' + r.time.toFixed(0)}s/p${r.phases}`;
        return `x${k} ${f(off)} -> ${f(on)}`;
      });
      const g = bossFight(id, 1, true, 'BOSS-GAPS', 60);
      lines.push(`${id.padEnd(18)} f${Enemies.must(id).bossFloors![0]}  ${cells.join('  |  ')}  || idle ${(g.idle * 100).toFixed(0)}% longest ${g.longestIdle.toFixed(1)}s shots ${g.shotsPerSec.toFixed(1)}/s`);
    }
    console.log(`BOSS BENCH (time after the 1.6 s intro; p = phases reached)\n${lines.join('\n')}`);
  }, 3_600_000);
});

describe.skipIf(!process.env.BOSS_GAPS)('boss gaps', () => {
  it('openings: idle share, longest quiet stretch, shots per second (keeper at x1, phase 1 and phase 2)', () => {
    const bosses = (process.env.BOSS_ONLY?.split(',') ?? Enemies.all().filter((e) => e.boss).map((e) => e.id));
    const secs = Number(process.env.BOSS_SECS ?? 40);
    const lines: string[] = [];
    for (const id of bosses) {
      const cell = (p2: boolean) => {
        const rs = ['GAP-A', 'GAP-B'].map((seed) => bossFight(id, 0.05, true, seed, secs, p2));
        const idle = rs.reduce((a, r) => a + r.idle, 0) / rs.length;
        const longest = Math.max(...rs.map((r) => r.longestIdle));
        const sps = rs.reduce((a, r) => a + r.shotsPerSec, 0) / rs.length;
        return `idle ${(idle * 100).toFixed(0).padStart(3)}%  longest ${longest.toFixed(1).padStart(4)}s  shots ${sps.toFixed(1).padStart(5)}/s`;
      };
      lines.push(`${id.padEnd(18)} f${Enemies.must(id).bossFloors![0]}  P1 ${cell(false)}   P2 ${cell(true)}`);
    }
    console.log(`BOSS GAPS (${secs}s per run, 2 seeds)\n${lines.join('\n')}`);
  }, 3_600_000);
});
