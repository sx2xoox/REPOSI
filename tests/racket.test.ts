// 바람깃 라켓 (badminton_racket, legendary; src/content/weapons/racket.ts):
// serves slow down hard and drop, a shuttle that hits a foe pops back to its
// keeper, swinging at a falling shuttle within reach smashes it (rally bonus),
// a shuttle that lands ends its rally. Registry and art, the dummy band, draw
// purity, cosmetic-RNG independence, room changes and two-keeper lockstep.

import './headless';
import { describe, expect, it } from 'vitest';
import { Weapons } from '../src/game/defs';
import { FIXED_DT } from '../src/game/constants';
import { HELD, PRESS, type PlayerInput } from '../src/game/seam';
import { hasSprite } from '../src/engine/sprites';
import { stateHash } from '../src/game/statehash';
import { fx, RNG } from '../src/engine/rng';
import type { World } from '../src/game/world';
import type { Player } from '../src/game/player';
import type { Enemy } from '../src/game/enemy';
import type { Projectile } from '../src/game/projectile';
import { ownedBy } from '../src/content/weapons/arms-kit';
import { runCoop } from './coopsim';
import { DUMMY_ID, PLAIN_ID, bestDps, measureDps } from './dpsharness';
import {
  MAX_FLOATING, POP_FOLLOW, POP_TIME, LEGEND_RALLY, POWER_RALLY, RALLY_BUILD, RallyShuttle, rallyBonus, rallyTier, SERVE_DAMAGE, SERVE_REACH, SMASH_REACH, SHUTTLE_MIN_SPEED, smashMult,
} from '../src/content/weapons/racket';

const ID = 'badminton_racket';

interface Sim { w: World; p: Player; dmg: number }
function sim(seed = 'RACKET'): Sim {
  const r = measureDps({ character: PLAIN_ID, weapon: ID, seconds: 0, seed });
  const w = r.world;
  for (const e of r.dummies) w.killEnemy(e);
  drive(w, 20);
  w.player.stats.critChance = 0;
  return { w, p: w.player, dmg: w.player.weaponStats.damage };
}
type Fill = (o: PlayerInput, p: Player) => void;
function drive(w: World, frames: number, fill: Fill = () => {}): void {
  w.inputSource = (_w, p, o) => {
    o.mx = o.my = o.ax = o.ay = 0;
    o.pressed = 0;
    o.cx = p.x + 60;
    o.cy = p.y - 6;
    o.held = HELD.cursorAim;
    fill(o, p);
  };
  for (let i = 0; i < frames; i++) w.update(FIXED_DT);
}
const fireAt = (dx: number, dy: number): Fill => (o, p) => {
  o.cx = p.x + dx;
  o.cy = p.y - 6 + dy;
  o.held = HELD.cursorAim | HELD.fire;
};
function dummy(w: World, x: number, y: number): Enemy {
  const e = w.spawnEnemy(DUMMY_ID, x, y)!;
  e.dormant = 0;
  return e;
}
/** Fire exactly one swing at (dx, dy). */
function oneSwing(w: World, dx: number, dy: number): void {
  const p = w.player;
  for (let i = 0; i < 90; i++) {
    drive(w, 1, fireAt(dx, dy));
    if (p.weapon.sinceAttack === 0) return;
  }
}
const shuttles = (w: World) => w.projectiles.filter((q) => !q.dead && q.owner === w.player && q.behaviors.some((b) => b.id === 'shuttlecock'));

describe('badminton racket: registry and art', () => {
  it('is a legendary with art, Korean text, its own archetype and the legendary pools', () => {
    const d = Weapons.must(ID);
    expect(d.rarity).toBe('legendary');
    expect(d.pools).toEqual(['boss', 'secret']);
    expect(/[가-힣]/.test(d.name) && /[가-힣]/.test(d.desc)).toBe(true);
    expect(d.archetype).toBe('랠리');
    expect(Weapons.all().filter((o) => o.archetype === d.archetype)).toHaveLength(1);
    for (const s of [d.icon, d.heldSprite!, 'proj_shuttlecock']) expect(hasSprite(s), s).toBe(true);
  });
});

describe('badminton racket: the shuttle', () => {
  it('a serve leaves fast, slows hard and drops at about the keeper range', () => {
    const { w, p } = sim('RACKET-SERVE');
    // stand by the left wall with the whole room ahead
    p.x = w.room.centerX - 120;
    drive(w, 2);
    oneSwing(w, 80, 0);
    const pr = shuttles(w)[0];
    expect(pr).toBeDefined();
    const v0 = pr.speed;
    expect(v0).toBeGreaterThan(p.weaponStats.shotSpeed * 1.5);
    drive(w, Math.round(0.3 / FIXED_DT));
    expect(pr.speed).toBeLessThan(v0 * 0.7);
    let n = 0;
    while (!pr.dead && n++ < 600) drive(w, 1);
    expect(pr.dead).toBe(true);
    expect(pr.speed).toBeLessThan(SHUTTLE_MIN_SPEED + 1);
    expect(pr.traveled).toBeGreaterThan(p.weaponStats.range * SERVE_REACH * 0.8);
    expect(pr.traveled).toBeLessThan(p.weaponStats.range * SERVE_REACH * 1.25);
    // a dropped serve does not float back
    expect(ownedBy(w, RallyShuttle, p)).toHaveLength(0);
  });

  it('a serve that hits pops back down beside the keeper; a swing then smashes it with the rally bonus', () => {
    const { w, p, dmg } = sim('RACKET-RALLY');
    const e = dummy(w, p.x + 60, p.y);
    const hp0 = e.hp;
    oneSwing(w, 60, 6);
    for (let i = 0; i < 60 && !ownedBy(w, RallyShuttle, p).length; i++) drive(w, 1);
    expect(hp0 - e.hp).toBeCloseTo(dmg * SERVE_DAMAGE, 3);
    const b = ownedBy(w, RallyShuttle, p)[0];
    expect(b).toBeDefined();
    expect(b.rally).toBe(0);
    // it rises, then comes down close to the keeper
    let top = 0;
    for (let i = 0; i < 200 && !b.smashable(p); i++) {
      drive(w, 1);
      top = Math.max(top, b.z);
    }
    expect(top).toBeGreaterThan(30);
    expect(b.smashable(p)).toBe(true);
    expect(Math.hypot(b.tx - p.x, b.ty - p.y)).toBeLessThan(SMASH_REACH);
    // the next swing smashes it instead of serving
    const hp1 = e.hp;
    oneSwing(w, 60, 6);
    expect(b.dead).toBe(true);
    const live = shuttles(w);
    expect(live).toHaveLength(1);
    expect(live[0].mem.smash).toBe(1);
    expect(live[0].mem.rally).toBe(1);
    expect(live[0].damage).toBeCloseTo(dmg * smashMult(0), 3);
    expect(p.weapon.mem.rally).toBe(1);
    for (let i = 0; i < 60 && e.hp === hp1; i++) drive(w, 1);
    expect(hp1 - e.hp).toBeCloseTo(dmg * smashMult(0), 3);
    // ... and that shuttle pops again, one rally further
    for (let i = 0; i < 30 && !ownedBy(w, RallyShuttle, p).length; i++) drive(w, 1);
    expect(ownedBy(w, RallyShuttle, p)[0].rally).toBe(1);
  });

  it('holding the attack keeps the rally going and the smash grows to its cap', () => {
    const { w, p } = sim('RACKET-HOLD');
    dummy(w, p.x + 60, p.y);
    let best = 0;
    for (let i = 0; i < Math.round(12 / FIXED_DT); i++) {
      drive(w, 1, fireAt(60, 6));
      best = Math.max(best, p.weapon.mem.rally ?? 0);
    }
    expect(best).toBeGreaterThanOrEqual(RALLY_BUILD - 1);
    expect(ownedBy(w, RallyShuttle, p).length).toBeLessThanOrEqual(MAX_FLOATING);
  });

  it('rally curve (user 2026-10-08): +3 % per rally to 7, the power shuttle from 8 (+100 %), the legend shuttle from 15 (+200 %)', () => {
    expect(rallyBonus(1)).toBeCloseTo(0.03);
    expect(rallyBonus(RALLY_BUILD)).toBeCloseTo(0.21);
    expect(rallyBonus(POWER_RALLY)).toBe(1);
    expect(rallyBonus(LEGEND_RALLY - 1)).toBe(1);
    expect(rallyBonus(LEGEND_RALLY)).toBe(2);
    expect(rallyBonus(99)).toBe(2);
    // smashMult(rally so far): the smash makes rally + 1
    expect(smashMult(0) / smashMult(-1)).toBeCloseTo(1.03);
    expect(smashMult(POWER_RALLY - 1) / smashMult(POWER_RALLY - 2)).toBeCloseTo(2 / 1.21);
    expect(smashMult(LEGEND_RALLY - 1) / smashMult(LEGEND_RALLY - 2)).toBeCloseTo(1.5);
    expect([1, 7, 8, 14, 15, 30].map(rallyTier)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('the landing spot follows a walking keeper but not a dash; a shuttle nobody hits lands and ends its rally', () => {
    const { w, p } = sim('RACKET-MISS');
    dummy(w, p.x + 60, p.y);
    oneSwing(w, 60, 6);
    for (let i = 0; i < 60 && !ownedBy(w, RallyShuttle, p).length; i++) drive(w, 1);
    const b = ownedBy(w, RallyShuttle, p)[0];
    w.room.setDoorsClosed(true);
    // walking off sideways (no swing): it still comes down within reach
    drive(w, Math.round(POP_TIME * 0.8 / FIXED_DT), (o) => { o.mx = -1; });
    expect(b.smashable(p)).toBe(true);
    expect(POP_FOLLOW).toBeGreaterThan(p.stats.moveSpeed);
    // a dash outruns it; untouched, it lands and its rally is over
    drive(w, 1, (o) => { o.mx = -1; o.pressed = PRESS.dash; });
    drive(w, Math.round(POP_TIME * 0.3 / FIXED_DT), (o) => { o.mx = -1; });
    expect(b.dead).toBe(true);
    expect(Math.hypot(b.x - p.x, b.y - p.y)).toBeGreaterThan(SMASH_REACH);
    expect(p.weapon.mem.rally ?? 0).toBe(0);
  });

  it('putting the racket away drops every floating shuttle', () => {
    const { w, p } = sim('RACKET-HOLSTER');
    dummy(w, p.x + 60, p.y);
    oneSwing(w, 60, 6);
    for (let i = 0; i < 60 && !ownedBy(w, RallyShuttle, p).length; i++) drive(w, 1);
    expect(ownedBy(w, RallyShuttle, p)).toHaveLength(1);
    p.equipWeapon(w, 'lantern_bolt');
    drive(w, 2);
    expect(ownedBy(w, RallyShuttle, p)).toHaveLength(0);
  });
});

describe('badminton racket: balance', () => {
  // user 2026-10-08 asked for an extreme rally curve (+100 % from rally 8, +200 % from 15): the
  // bot keeps a perfect rally on an immobile dummy, so the racket sits well above the usual 1.35x
  it('single target 1.05x..1.75x of the lantern with a perfect rally (legendary), crowd within 6.5x', () => {
    const k = bestDps(PLAIN_ID, ID) / bestDps(PLAIN_ID, 'lantern_bolt');
    const c = bestDps(PLAIN_ID, ID, true) / bestDps(PLAIN_ID, 'lantern_bolt', true);
    console.log('RACKET balance single', k.toFixed(2), 'crowd', c.toFixed(2));
    expect(k).toBeGreaterThanOrEqual(1.05);
    expect(k).toBeLessThanOrEqual(1.75);
    expect(c).toBeLessThanOrEqual(6.5);
  }, 60_000);
});

describe('badminton racket: purity, lockstep and rooms', () => {
  function crowd(seed: string): { w: World; p: Player } {
    const r = measureDps({ character: PLAIN_ID, weapon: ID, seconds: 0, crowd: true, seed });
    return { w: r.world, p: r.world.player };
  }
  /** Fire with a sweeping aim, pausing now and then (shuttles land, rallies break). */
  function sweep(w: World, frames: number, after?: (i: number) => void): void {
    const bot = w.inputSource!;
    w.inputSource = (ww, p, o) => {
      bot(ww, p, o);
      o.cx += Math.sin(ww.time * 1.7) * 40;
      o.cy += Math.cos(ww.time * 1.3) * 30;
      if (Math.floor(ww.time / 1.3) % 3 === 2) o.held &= ~HELD.fire;
    };
    for (let i = 0; i < frames; i++) {
      w.update(FIXED_DT);
      after?.(i);
    }
  }

  it('drawing never changes the simulation', () => {
    const { w } = crowd('RACKET-PURE');
    sweep(w, 300, (i) => {
      if (i % 3) return;
      const before = stateHash(w);
      w.draw(1);
      expect(stateHash(w), String(i)).toBe(before);
    });
  });

  it('identical runs stay bit-identical whatever the cosmetic RNG does', () => {
    const run = (fxSeed: number, draw: boolean) => {
      fx.setState(new RNG(fxSeed).getState());
      const { w } = crowd('RACKET-LOCKSTEP');
      const hashes: number[] = [];
      sweep(w, 360, (i) => {
        if (draw && i % 2) w.draw(0.5);
        if (i % 10 === 0) hashes.push(stateHash(w));
      });
      return hashes;
    };
    expect(run(7, true)).toEqual(run(0x9e3779b9, false));
  });

  it('nothing is left behind in the next room and the racket keeps working', () => {
    const { w, p } = crowd('RACKET-ROOMS');
    sweep(w, 150);
    const next = w.map.nodes.find((n) => n.id !== w.node.id)!;
    w.withIds(() => w.enterRoom(next, null));
    drive(w, 2);
    expect(w.entities.filter((e) => !e.dead && e instanceof RallyShuttle)).toHaveLength(0);
    expect(w.projectiles.filter((q: Projectile) => q.owner === p && !q.dead)).toHaveLength(0);
    const n = p.weapon.sinceAttack;
    drive(w, 60, fireAt(50, 0));
    expect(p.weapon.sinceAttack).toBeLessThan(n + 1);
  });

  it('two keepers with rackets stay in lockstep', () => {
    const swings = new Map<World, number>();
    const res = runCoop({
      name: 'racket', seed: 'RACKET-COOP', chars: ['ria', 'bern'], ms: 20_000, link: { latencyMs: 35, jitterMs: 25 },
      bossAt: 0, downAt: 0, leaveAt: 0, discardAt: 0,
      extraStep: (w, tick) => {
        for (const p of w.players) {
          if (tick % 120 === 3 && p.weaponId !== ID) w.asPlayer(p, () => w.withIds(() => p.equipWeapon(w, ID)));
          if (p.weaponId === ID && p.weapon.sinceAttack === 0) swings.set(w, (swings.get(w) ?? 0) + 1);
        }
      },
    });
    const ref = res.peers[0].hashes;
    let checked = 0;
    for (const peer of res.peers) {
      expect(peer.desyncs).toHaveLength(0);
      for (let t = 0; t < Math.min(ref.length, peer.hashes.length); t++) {
        if (peer.hashes[t] === undefined || ref[t] === undefined) continue;
        expect(peer.hashes[t], `slot ${peer.slot} tick ${t}`).toBe(ref[t]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(swings.get(res.peers[0].world) ?? 0).toBeGreaterThan(5);
  }, 120_000);
});
