// 등불 도둑 사냥 bench (opt-in): a solo chase bot plays the hunt on floors 1 / 4 / 7 with
// a pistol, a beam, a melee and a charge weapon; its damage is scaled like a typical build
// of that floor (power = hpMult / 1.3, the curve the floor HP follows). Reports clear time,
// escape attempts, seals, escapes (fails), regrabs and damage taken.
//
//   HUNT_BENCH=1 npx vitest run tests/hunt-bench

import './headless';
import { describe, expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { FIXED_DT } from '../src/game/constants';
import { HELD, PRESS, fixedRules, type PlayerInput } from '../src/game/seam';
import { loadContent } from '../src/content';
import { HuntDevice, HuntEmber, HuntCaltrop } from '../src/content/rooms/hunt';
import { ST, WEASEL_ID } from '../src/content/rooms/hunt-weasel';
import type { Enemy } from '../src/game/enemy';

loadContent();
const RELEASE = new Set(['hunter_bow', 'volley_crossbow', 'titan_greatsword']);
let renderer: Renderer | null = null;

export interface HuntRun { time: number; success: boolean; attempts: number; seals: number; regrabs: number; hurt: number; knocks: number[]; sources: Record<string, number> }

/** One solo hunt on `floor` with `weapon` at `power` x damage, driven by a simple chase bot. */
export function huntRun(floor: number, weapon: string, seed: string, power = 1, limit = 120, casual = false): HuntRun {
  if (!renderer) renderer = new Renderer(fakeDisplay(1280, 720));
  const run = new RunState(seed, 'ria');
  run.staged = true;
  const w = new World(renderer, run, { openInventory() {}, onGameOver() {} });
  w.setQuality({ lighting: false, particles: 0 });
  w.rules = fixedRules({ hitStop: false });
  const charge = { t: 0 };
  let dashT = 0;
  w.inputSource = (ww: World, p, out: PlayerInput) => {
    out.mx = out.my = out.ax = out.ay = 0;
    out.held = 0;
    out.pressed = 0;
    const weasel = ww.enemies.find((e) => e.def.id === WEASEL_ID && e.alive) as Enemy | undefined;
    const embers = ww.entities.filter((e) => e instanceof HuntEmber && !e.dead && e.landed) as HuntEmber[];
    let goal: { x: number; y: number } | null = null;
    let aim: { x: number; y: number } | null = weasel ?? null;
    // a casual player notices a dropped ember a moment later
    const ready = embers.filter((e) => !casual || e.age > 0.6);
    if (ready.length) {
      ready.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
      goal = ready[0];
    } else if (weasel && weasel.mem.state === ST.flare && Math.hypot(weasel.x - p.x, weasel.y - p.y) < 64) {
      // back off from a flare wind-up
      const d = Math.hypot(weasel.x - p.x, weasel.y - p.y) || 1;
      goal = { x: p.x - ((weasel.x - p.x) / d) * 20, y: p.y - ((weasel.y - p.y) / d) * 20 };
    } else if (weasel) {
      const d = Math.hypot(weasel.x - p.x, weasel.y - p.y) || 1;
      const melee = p.weaponId !== 'lantern_bolt' && !RELEASE.has(p.weaponId) && p.weaponId !== 'void_gaze';
      const want = weasel.mem.state === ST.channel ? 0 : melee ? 14 : 34;
      goal = d > want ? weasel : { x: p.x - (weasel.x - p.x) / d * 10, y: p.y - (weasel.y - p.y) / d * 10 };
      dashT -= FIXED_DT;
      if ((d > 70 || weasel.mem.state === ST.escape) && dashT <= 0) { out.pressed |= PRESS.dash; dashT = casual ? 2.2 : 1.1; }
    }
    // a minion right on top of the keeper gets shot first
    for (const e of ww.enemies) if (e.alive && e.def.id !== WEASEL_ID && Math.hypot(e.x - p.x, e.y - p.y) < 34) { aim = e; break; }
    if (goal) {
      let mx = goal.x - p.x;
      let my = goal.y - p.y;
      const l = Math.hypot(mx, my) || 1;
      mx /= l;
      my /= l;
      // step around armed caltrops and incoming shots
      for (const c of ww.entities) {
        if (!(c instanceof HuntCaltrop) || !c.armed) continue;
        const dx = p.x + mx * 8 - c.x;
        const dy = p.y + my * 8 - c.y;
        const dd = Math.hypot(dx, dy);
        if (dd < 12) { mx += (dx / (dd || 1)) * 1.4; my += (dy / (dd || 1)) * 1.4; }
      }
      for (const q of ww.projectiles) {
        if (q.dead || q.team !== 'enemy') continue;
        const qx = p.x - q.x;
        const qy = p.y - q.y;
        const qd = Math.hypot(qx, qy);
        if (qd < 30 && q.vx * qx + q.vy * qy > 0) {
          const sp = Math.hypot(q.vx, q.vy) || 1;
          mx += (-q.vy / sp) * 1.5;
          my += (q.vx / sp) * 1.5;
          break;
        }
      }
      const ml = Math.hypot(mx, my);
      if (ml > 1e-6) { out.mx = mx / ml; out.my = my / ml; }
    }
    if (aim) {
      // a casual player's aim wanders around the target
      const wob = casual ? Math.sin(ww.time * 2.3) * 11 + Math.sin(ww.time * 5.1) * 6 : 0;
      const ad = Math.hypot(aim.x - p.x, aim.y - p.y) || 1;
      out.cx = aim.x - ((aim.y - p.y) / ad) * wob;
      out.cy = aim.y - 3 + ((aim.x - p.x) / ad) * wob;
      if (RELEASE.has(p.weaponId)) {
        charge.t += FIXED_DT;
        if (charge.t < 0.8) out.held = HELD.fire | HELD.cursorAim;
        else { out.held = HELD.cursorAim; charge.t = -0.05; }
      } else out.held = HELD.fire | HELD.cursorAim;
    }
  };
  w.start();
  if (floor > 1) w.startFloor(floor);
  const p = w.player;
  if (p.weaponId !== weapon) p.equipWeapon(w, weapon);
  p.stats.maxHearts = 40;
  p.red = p.maxRed;
  p.soul = 20;
  const n = w.map.nodes.find((x) => x.id !== w.map.startId && x.kind === 'normal')!;
  n.kind = 'hunt';
  n.templateId = 'hunt_den';
  n.visited = false;
  n.cleared = false;
  w.enterRoom(n, null);
  const applyHit = w.applyHit.bind(w);
  w.applyHit = (target, hit) => {
    if (hit.attacker === p || (hit.source && 'team' in hit.source && (hit.source as { team: string }).team === 'player')) hit.damage *= power;
    return applyHit(target, hit);
  };
  const d = w.entities.find((e) => e instanceof HuntDevice) as HuntDevice;
  const sources: Record<string, number> = {};
  const hurt = p.hurt.bind(p);
  p.hurt = (ww, n, src = '?', raw, origin) => {
    const ok = hurt(ww, n, src, raw, origin);
    if (ok) sources[src] = (sources[src] ?? 0) + 1;
    return ok;
  };
  const knocks: number[] = [];
  p.x = d.x - 20;
  p.y = d.y + 10;
  d.interact(w);
  let attempts = 0;
  let regrabs = 0;
  let prevEsc = 0;
  let prevHeld = 3;
  const hp0 = p.red + p.soul;
  const steps = Math.round(limit / FIXED_DT);
  for (let i = 0; i < steps && !d.mem.used; i++) {
    w.update(FIXED_DT);
    if (d.mem.escState === 1 && prevEsc === 0) attempts++;
    if (d.mem.held > prevHeld) regrabs++;
    if (d.mem.held < prevHeld) knocks.push(Math.round(d.mem.clock * 10) / 10);
    prevEsc = d.mem.escState;
    prevHeld = d.mem.held;
    if (!p.alive) break;
  }
  const seals = [0, 1, 2].filter((i) => d.mem.sealed & (1 << i)).length;
  return { time: d.mem.clock, success: d.mem.phase === 4, attempts, seals, regrabs, hurt: hp0 - (p.red + p.soul), knocks, sources };
}

describe.skipIf(!process.env.HUNT_BENCH)('hunt bench', () => {
  it('solo chase bot on floors 1 / 4 / 7', () => {
    const weapons = (process.env.HUNT_WEAPONS ?? 'lantern_bolt,void_gaze,iron_spear,hunter_bow').split(',');
    const floors = (process.env.HUNT_FLOORS ?? '1,4,7').split(',').map(Number);
    const seeds = Number(process.env.HUNT_SEEDS ?? 4);
    const casual = !!process.env.HUNT_CASUAL;
    const rows: string[] = [];
    let all = 0;
    let fails = 0;
    const times: number[] = [];
    for (const floor of floors) for (const weapon of weapons) {
      const res: HuntRun[] = [];
      for (let s = 0; s < seeds; s++) res.push(huntRun(floor, weapon, `HUNT-${floor}-${s}`, ({ 1: 1.3, 4: 3.6, 7: 7.7 }[floor] ?? 1.3) / 1.3, 120, casual));
      const ok = res.filter((r) => r.success);
      all += res.length;
      fails += res.length - ok.length;
      times.push(...ok.map((r) => r.time));
      const avg = (f: (r: HuntRun) => number) => (res.reduce((a, r) => a + f(r), 0) / res.length).toFixed(1);
      rows.push(`F${floor} ${weapon.padEnd(14)} win ${ok.length}/${res.length}  time ${ok.length ? (ok.reduce((a, r) => a + r.time, 0) / ok.length).toFixed(1) : '-'}s  tries ${avg((r) => r.attempts)}  seals ${avg((r) => r.seals)}  regrabs ${avg((r) => r.regrabs)}  hurt ${avg((r) => r.hurt)}  [${res.map((r) => (r.success ? '' : 'X') + r.time.toFixed(0)).join(' ')}]`);
    }
    if (process.env.HUNT_VERBOSE) for (const floor of floors) for (const weapon of weapons) for (let s = 0; s < seeds; s++) {
      const r = huntRun(floor, weapon, `HUNT-${floor}-${s}`, ({ 1: 1.3, 4: 3.6, 7: 7.7 }[floor] ?? 1.3) / 1.3, 120, casual);
      rows.push(`  F${floor} ${weapon} #${s}: knocks ${r.knocks.join(',')} end ${r.time.toFixed(1)} hurt ${JSON.stringify(r.sources)}`);
    }
    times.sort((a, b) => a - b);
    console.log(rows.join('\n') + `\nmedian clear ${times[Math.floor(times.length / 2)]?.toFixed(1)}s, escapes ${fails}/${all}`);
    expect(all).toBeGreaterThan(0);
  }, 600000);
});
