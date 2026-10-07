// New basic enemies for floor 5 (공허의 심장) and floor 6 (수몰된 서고):
//   균열 등불 (rift_lantern pair + void tether), 공허 산란충 (void_brood + void_egg),
//   등불 아귀 (lamp_angler searchlight + ink torpedoes), 유령 타자기 (ghost_typewriter).
// Definitions and sprites, the pure helpers, a 12 s headless run of each enemy in the
// real World on its floor, one focused test of every signature mechanic, and draw purity.

import './headless';
import { fakeDisplay } from './headless';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Enemies, Floors } from '../src/game/defs';
import { Enemy } from '../src/game/enemy';
import { GroundWarning } from '../src/game/effects';
import { Projectile } from '../src/game/projectile';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Renderer } from '../src/engine/renderer';
import { FIXED_DT, TILE } from '../src/game/constants';
import { clearInput, fixedRules } from '../src/game/seam';
import { stateHash } from '../src/game/statehash';
import { Tile } from '../src/game/tiles';
import { getAnim, hasAnim, hasSprite, listSprites } from '../src/engine/sprites';
import { RNG, fx } from '../src/engine/rng';
import {
  broodChildren, EGG_HATCH, eggStage, leadAngle, onTether, pairSlot, TETHER, TETHER_HALF, VoidTether,
} from '../src/content/enemies/abyss-rift';
import { AnglerLight, CONE, inCone, lureGround, returnAngles, typeAngles } from '../src/content/enemies/archive-lure';

loadContent();

/** The new regular enemies and their single floor. */
const NEW: Record<string, number> = {
  rift_lantern: 5,
  void_brood: 5,
  lamp_angler: 6,
  ghost_typewriter: 6,
};
const IDS = Object.keys(NEW);

function spriteDefined(name: string): boolean {
  if (hasAnim(name)) {
    const a = getAnim(name)!;
    return a.frames.length > 0 && a.frames.every((f) => hasSprite(f));
  }
  return hasSprite(name);
}

// ---------------------------------------------------------------- real World harness
let renderer: Renderer | null = null;

/** A fresh run standing in the start room of `floor`, no enemies, the keeper idle. */
function world(floor: number, seed: string): World {
  renderer ??= new Renderer(fakeDisplay(1280, 720));
  const run = new RunState(seed, 'ria');
  run.seeded = true;
  const w = new World(renderer, run, { openInventory() {}, onGameOver() {} });
  w.rules = fixedRules({ hitStop: false });
  w.inputSource = (_w, _p, o) => clearInput(o);
  w.start();
  if (w.run.floor !== floor) w.startFloor(floor);
  steps(w, 30);
  for (const e of [...w.enemies]) w.killEnemy(e);
  const p = w.player;
  p.x = w.room.centerX;
  p.y = w.room.centerY;
  p.soul = 60;
  steps(w, 2);
  return w;
}

function steps(w: World, n: number, each?: (i: number) => void): void {
  for (let i = 0; i < n; i++) {
    w.update(FIXED_DT);
    each?.(i);
  }
}
const secs = (s: number) => Math.round(s / FIXED_DT);

/** Keeper keeps strafing around the room centre (never walks out of a door). */
function strafe(w: World): void {
  const cx = w.room.centerX;
  const cy = w.room.centerY;
  w.inputSource = (ww, p, o) => {
    clearInput(o);
    const gx = cx + Math.cos(ww.time * 0.9) * 50;
    const gy = cy + Math.sin(ww.time * 1.3) * 26;
    const dx = gx - p.x;
    const dy = gy - p.y;
    const l = Math.hypot(dx, dy);
    if (l > 3) {
      o.mx = dx / l;
      o.my = dy / l;
    }
  };
}

function spawn(w: World, id: string, dx = 80, dy = -20): Enemy {
  const p = w.player;
  const e = w.spawnEnemy(id, p.x + dx, p.y + dy)!;
  expect(e, id).toBeTruthy();
  return e;
}

const hp = (w: World) => w.player.red + w.player.soul;
const mine = (w: World, id: string) => w.enemies.filter((e) => e.alive && e.def.id === id);
const enemyShots = (w: World) => w.projectiles.filter((p) => p.team === 'enemy' && !p.dead);

// ---------------------------------------------------------------- definitions
describe('f56 enemy definitions', () => {
  it('registers four basic enemies, each on a single floor, plus their script-only helpers', () => {
    for (const [id, floor] of Object.entries(NEW)) {
      const d = Enemies.get(id)!;
      expect(d, id).toBeDefined();
      expect(d.floors, id).toEqual([floor]);
      expect(d.boss, id).toBeFalsy();
      expect(d.name, id).toMatch(/[가-힣]/);
      expect(d.champion, id).toBe(true);
      expect(d.light?.radius, id).toBeGreaterThan(0);
      expect(d.light?.color, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(d.deathFx, id).toBeDefined();
      expect(d.bloodColor, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(d.script, id).toBeTypeOf('function');
    }
    const egg = Enemies.get('void_egg')!;
    expect(egg).toBeDefined();
    expect(egg.floors).toBeUndefined();
    expect(egg.name).toMatch(/[가-힣]/);
    expect(egg.contactDamage).toBe(0);
    expect(egg.mass).toBe(Infinity);
  });

  it('stats follow the basic-enemy guide (floor-1 scale)', () => {
    for (const [id, floor] of Object.entries(NEW)) {
      const d = Enemies.must(id);
      expect(d.hp, id).toBeGreaterThanOrEqual(25);
      expect(d.hp, id).toBeLessThanOrEqual(45);
      expect(d.cost ?? 1, id).toBeGreaterThanOrEqual(0.7);
      expect(d.cost ?? 1, id).toBeLessThanOrEqual(2);
      expect(d.weight ?? 1, id).toBeGreaterThanOrEqual(0.8);
      expect(d.weight ?? 1, id).toBeLessThanOrEqual(1.1);
      expect(d.speed ?? 40, id).toBeLessThan(84);
      const fl = Floors.all().find((f) => f.index === floor)!;
      expect((d.speed ?? 40) * (fl.enemySpeed ?? 1), id).toBeLessThan(92);
      expect(d.contactDamage ?? 1, id).toBeLessThanOrEqual(1);
      expect(d.radius, id).toBeGreaterThan(2);
    }
    // the typewriter is a turret
    expect(Enemies.must('ghost_typewriter').speed).toBe(0);
    expect(Enemies.must('ghost_typewriter').mass).toBe(Infinity);
    // the angler swims over pits like the archive eel
    expect(Enemies.must('lamp_angler').flying).toBe(true);
    expect(Enemies.must('rift_lantern').flying).toBe(true);
  });

  it('every enemy has ≥3 animated states including hurt, and every frame exists', () => {
    const all = listSprites();
    for (const id of [...IDS, 'void_egg']) {
      const d = Enemies.must(id);
      expect(spriteDefined(d.sprite), `${id} sprite`).toBe(true);
      const prefix = d.sprite.split('_')[0];
      const states = new Set(all.filter((n) => n.startsWith(prefix + '_') && hasAnim(n.replace(/_\d+$/, ''))).map((n) => n.split('_')[1]));
      expect(states.has('hurt'), `${id} hurt (${[...states]})`).toBe(true);
      expect(states.size, `${id} states (${[...states]})`).toBeGreaterThanOrEqual(3);
      // at least one state is a real animation (several frames)
      expect([...states].some((s) => (getAnim(`${prefix}_${s}`)?.frames.length ?? 0) >= 2), id).toBe(true);
    }
    for (const n of ['__langler_torp', '__langler_mark', 'gtype_type_4', 'vegg_crack_2', 'rlan_alone_0']) expect(hasSprite(n), n).toBe(true);
  });

  it('the floor pools now contain the new enemies', () => {
    for (const [id, floor] of Object.entries(NEW)) {
      const pool = Enemies.all().filter((d) => !d.boss && d.floors?.includes(floor)).map((d) => d.id);
      expect(pool, `${id} in floor ${floor}`).toContain(id);
    }
  });
});

// ---------------------------------------------------------------- pure helpers
describe('f56 helpers', () => {
  it('pairSlot puts the two lanterns opposite each other around the centre', () => {
    const a = pairSlot(100, 50, 0, 40, 1);
    const b = pairSlot(100, 50, 0, 40, -1);
    expect(a.x).toBeCloseTo(140);
    expect(b.x).toBeCloseTo(60);
    expect(a.y).toBeCloseTo(50);
    const c = pairSlot(0, 0, Math.PI / 2, 10, 1);
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(10);
  });

  it('onTether hits only within player radius + half width of the segment', () => {
    expect(onTether(50, 0, 5, 0, 0, 100, 0)).toBe(true);
    expect(onTether(50, 5 + TETHER_HALF - 0.1, 5, 0, 0, 100, 0)).toBe(true);
    expect(onTether(50, 5 + TETHER_HALF + 0.1, 5, 0, 0, 100, 0)).toBe(false);
    // beyond the ends of the segment
    expect(onTether(110, 0, 5, 0, 0, 100, 0)).toBe(false);
  });

  it('leadAngle lines the tether up behind the keeper (against the turn), nearest to its current angle', () => {
    // turning +1: the line waits 0.7 rad before the keeper's direction
    expect(leadAngle(0.1, 1, 1, 0.7)).toBeCloseTo(0.3);
    // turning -1: it waits on the other side
    expect(leadAngle(1.6, 1, -1, 0.7)).toBeCloseTo(1.7);
    // a line is symmetric: the PI-equivalent closest to the current angle is chosen
    expect(leadAngle(Math.PI, 1, 1, 0.7)).toBeCloseTo(0.3 + Math.PI);
  });

  it('eggStage ripens from 0 to 3 over the hatch time', () => {
    expect(eggStage(0)).toBe(0);
    expect(eggStage(EGG_HATCH * 0.3)).toBe(1);
    expect(eggStage(EGG_HATCH * 0.6)).toBe(2);
    expect(eggStage(EGG_HATCH * 0.9)).toBe(3);
    expect(eggStage(EGG_HATCH * 2)).toBe(3);
  });

  it('inCone respects length and half-angle (with the keeper radius as slack)', () => {
    expect(inCone(0, 0, 0, 60, 0)).toBe(true);
    expect(inCone(0, 0, 0, CONE.len + 10, 0)).toBe(false);
    expect(inCone(0, 0, 0, 60, Math.tan(CONE.half + 0.2) * 60)).toBe(false);
    expect(inCone(0, 0, Math.PI / 2, 0, 60)).toBe(true);
    expect(inCone(0, 0, Math.PI / 2, 60, 0)).toBe(false);
    // right at the lamp counts as inside
    expect(inCone(0, 0, 0, -3, 2)).toBe(true);
  });

  it('typeAngles sweep left to right; returnAngles sweep back', () => {
    const t = typeAngles(1, 10, 0.6);
    expect(t).toHaveLength(10);
    expect(t[0]).toBeCloseTo(0.4);
    expect(t[9]).toBeCloseTo(1.6);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    const r = returnAngles(1, 5, 0.6);
    expect(r[0]).toBeCloseTo(1.6);
    expect(r[4]).toBeCloseTo(0.4);
  });
});

// ---------------------------------------------------------------- headless runs
/** Is `id` producing real danger right now? */
function danger(w: World, id: string): boolean {
  switch (id) {
    case 'rift_lantern':
      return w.entities.some((x) => x instanceof VoidTether && !x.dead && x.phase === 2);
    case 'void_brood':
      return w.enemies.some((e) => e.alive && (e.def.id === 'void_egg' || e.def.id === 'abyss_larva'));
    default:
      return enemyShots(w).length > 0;
  }
}

describe('f56 headless simulation (real World, own floor)', () => {
  for (const id of IDS) {
    it(`${id}: 12 s without errors, stays in the room, telegraphs before its danger, can die`, () => {
      const w = world(NEW[id], `f56-run-${id}`);
      const room = w.room;
      const e = spawn(w, id);
      let firstTel = -1;
      let firstDanger = -1;
      steps(w, secs(12), (i) => {
        for (const o of w.enemies) {
          expect(Number.isFinite(o.x) && Number.isFinite(o.y), o.def.id).toBe(true);
          expect(o.x, o.def.id).toBeGreaterThan(room.interiorX - 4);
          expect(o.y, o.def.id).toBeGreaterThan(room.interiorY - 4);
          expect(o.x, o.def.id).toBeLessThan(room.interiorX + room.interiorW + 4);
          expect(o.y, o.def.id).toBeLessThan(room.interiorY + room.interiorH + 4);
        }
        const tel = w.enemies.some((o) => o.telegraphT > 0) || w.entities.some((x) => x instanceof GroundWarning && !x.dead);
        if (tel && firstTel < 0) firstTel = i;
        if (danger(w, id) && firstDanger < 0) firstDanger = i;
        // keep the keeper alive and in place: this run is about the enemy
        w.player.soul = Math.max(w.player.soul, 40);
      });
      expect(firstDanger, `${id} danger`).toBeGreaterThanOrEqual(0);
      expect(firstTel, `${id} telegraph`).toBeGreaterThanOrEqual(0);
      expect(firstTel, `${id} telegraph before danger`).toBeLessThanOrEqual(firstDanger);
      // it can die (and its pair / eggs / light go with it in due course)
      for (const o of mine(w, id)) o.takeHit(w, { damage: 1e6, kind: 'projectile', dirX: 1, dirY: 0 });
      steps(w, 2);
      expect(e.dead).toBe(true);
      expect(mine(w, id)).toHaveLength(0);
      steps(w, secs(4));
    }, 30000);
  }
});

// ---------------------------------------------------------------- 균열 등불
describe('rift lanterns', () => {
  it('a placed lantern brings its twin ~80 px away, linked by one tether; the twin is a minion', () => {
    const w = world(5, 'f56-pair');
    const a = spawn(w, 'rift_lantern', 60, -10);
    steps(w, 1);
    const all = mine(w, 'rift_lantern');
    expect(all).toHaveLength(2);
    const b = all.find((x) => x !== a)!;
    expect(a.isMinion).toBe(false);
    expect(b.isMinion).toBe(true);
    expect(b.mem.twin).toBe(1);
    expect(a.mem.partner).toBe(b);
    expect(b.mem.partner).toBe(a);
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThanOrEqual(81);
    steps(w, 1);
    expect(w.entities.filter((x) => x instanceof VoidTether && !x.dead)).toHaveLength(1);
  });

  it('the tether is harmless while dormant or charging and burns while active, rotating the pair', () => {
    const w = world(5, 'f56-burn');
    const p = w.player;
    const a = spawn(w, 'rift_lantern', 60, -10);
    const b = a.mem.partner as Enemy;
    steps(w, 1);
    const t = () => w.entities.find((x) => x instanceof VoidTether) as VoidTether;
    let lost = { 0: 0, 1: 0, 2: 0 } as Record<number, number>;
    let th0 = NaN;
    let th1 = NaN;
    let sawCharge = false;
    for (let i = 0; i < secs(9); i++) {
      // the keeper stands right on the line's midpoint every frame
      p.x = (a.x + b.x) / 2;
      p.y = (a.y + b.y) / 2;
      p.vx = p.vy = p.kbx = p.kby = 0;
      p.invuln = 0;
      const ph = t().phase;
      if (ph === 1) sawCharge = true;
      if (ph === 2 && Number.isNaN(th0)) th0 = a.mem.th;
      if (ph === 2) th1 = a.mem.th;
      const before = hp(w);
      w.update(FIXED_DT);
      // the tether updates after the pair's brain: attribute damage to the phase it ran in
      lost[t().phase] += before - hp(w);
      if (!Number.isNaN(th0) && ph !== 2) break;
    }
    expect(sawCharge).toBe(true);
    expect(lost[0]).toBe(0);
    expect(lost[1]).toBe(0);
    expect(lost[2]).toBeGreaterThan(0);
    // ~0.9 rad/s for 1.4 s
    expect(Math.abs(th1 - th0)).toBeGreaterThan(0.9 * TETHER.active * 0.8);
    expect(Math.abs(th1 - th0)).toBeLessThan(0.9 * TETHER.active * 1.2);
  });

  it('a keeper clear of the line is never hurt by it', () => {
    const w = world(5, 'f56-clear');
    const p = w.player;
    const a = spawn(w, 'rift_lantern', 60, -10);
    const b = a.mem.partner as Enemy;
    let lost = 0;
    let active = 0;
    for (let i = 0; i < secs(8); i++) {
      // stand 60 px off the line's centre, perpendicular to it (beyond the swept radius)
      const lx = b.x - a.x;
      const ly = b.y - a.y;
      const l = Math.hypot(lx, ly) || 1;
      p.x = (a.x + b.x) / 2 - (ly / l) * 60;
      p.y = (a.y + b.y) / 2 + (lx / l) * 60;
      p.invuln = 0;
      const before = hp(w);
      w.update(FIXED_DT);
      if ((w.entities.find((x) => x instanceof VoidTether) as VoidTether | undefined)?.phase === 2) active++;
      // only the tether could hurt here (the lanterns hover far away)
      lost += before - hp(w);
    }
    expect(active).toBeGreaterThan(0);
    expect(lost).toBe(0);
  });

  it('killing one snaps the tether; the survivor fires telegraphed three-shot fans', () => {
    const w = world(5, 'f56-snap');
    const a = spawn(w, 'rift_lantern', 60, -10);
    const b = a.mem.partner as Enemy;
    steps(w, secs(1));
    b.takeHit(w, { damage: 1e6, kind: 'projectile', dirX: 1, dirY: 0 });
    steps(w, 2);
    expect(b.dead).toBe(true);
    expect(w.entities.some((x) => x instanceof VoidTether && !x.dead)).toBe(false);
    let fan = 0;
    let telBefore = false;
    steps(w, secs(3.5), () => {
      if (a.telegraphT > 0 && fan === 0) telBefore = true;
      fan = Math.max(fan, enemyShots(w).length);
    });
    expect(a.mem.alone).toBe(1);
    expect(telBefore).toBe(true);
    expect(fan).toBeGreaterThanOrEqual(3);
  });

  it('the room only clears once both lanterns are gone', () => {
    const w = world(5, 'f56-clear-room');
    const a = spawn(w, 'rift_lantern', 60, -10);
    const b = a.mem.partner as Enemy;
    w.node.cleared = false;
    steps(w, secs(0.5));
    a.takeHit(w, { damage: 1e6, kind: 'projectile', dirX: 1, dirY: 0 });
    steps(w, secs(1));
    expect(a.dead).toBe(true);
    expect(b.alive).toBe(true);
    expect(w.node.cleared).toBe(false);
    b.takeHit(w, { damage: 1e6, kind: 'projectile', dirX: 1, dirY: 0 });
    steps(w, secs(1));
    expect(w.node.cleared).toBe(true);
  });

  it('a champion pair glows together', () => {
    const w = world(5, 'f56-champ');
    const a = spawn(w, 'rift_lantern', 60, -10);
    const b = a.mem.partner as Enemy;
    a.champion = true;
    a.championColor = '#ff4040';
    a.maxHp = a.hp = a.hp * 1.6;
    steps(w, secs(1.2));
    expect(b.champion).toBe(true);
    expect(b.championColor).toBe('#ff4040');
    expect(b.maxHp).toBe(a.maxHp);
  });

  it('an elite encounter pair shares the elite rank, HP scaling and damage scale', () => {
    const w = world(5, 'f56-elite');
    const a = spawn(w, 'rift_lantern', 60, -10);
    const b = a.mem.partner as Enemy;
    // what an elite encounter summon does to the enemy it spawned
    a.maxHp = a.hp = Math.round(a.maxHp * 3);
    a.scale = 1.25;
    a.r *= 1.25;
    a.enemyDamageScale = 1.5;
    a.mem.elite = 1;
    a.championColor = '#efab68';
    steps(w, secs(1.2));
    expect(b.mem.elite).toBe(1);
    expect(b.maxHp).toBe(a.maxHp);
    expect(b.hp).toBeCloseTo(b.maxHp, 5);
    expect(b.enemyDamageScale).toBe(1.5);
    expect(b.scale).toBe(1.25);
  });
});

// ---------------------------------------------------------------- 공허 산란충
describe('void brood', () => {
  it('lays an egg after a telegraph; the egg hatches into its larva after ~2.6 s', () => {
    const w = world(5, 'f56-brood');
    w.player.god = true;
    const e = spawn(w, 'void_brood', 90, 0);
    let telAt = -1;
    let layAt = -1;
    let egg: Enemy | undefined;
    steps(w, secs(5), (i) => {
      if (e.telegraphT > 0 && telAt < 0) telAt = i;
      egg ??= mine(w, 'void_egg')[0];
      if (egg && layAt < 0) layAt = i;
    });
    expect(egg).toBeDefined();
    expect(telAt).toBeGreaterThanOrEqual(0);
    expect(layAt - telAt).toBeGreaterThanOrEqual(secs(0.45));
    expect(egg!.mem.owner).toBe(e);
    expect(egg!.isMinion).toBe(true);
    // hatching
    let hatchAt = -1;
    let larva: Enemy | undefined;
    steps(w, secs(4), (i) => {
      if (egg!.dead && hatchAt < 0) {
        hatchAt = i;
        larva = w.enemies.find((o) => o.alive && o.def.id === 'abyss_larva' && o.mem.owner === e);
      }
    });
    expect(hatchAt).toBeGreaterThanOrEqual(0);
    expect(larva).toBeDefined();
    expect(larva!.isMinion).toBe(true);
    const age = (secs(5) - layAt) + hatchAt;
    expect(age).toBeGreaterThan(secs(EGG_HATCH - 0.2));
    expect(age).toBeLessThan(secs(EGG_HATCH + 0.3));
  });

  it("an orphaned egg bursts into a slow ring of four void bullets; a shot egg just pops", () => {
    const w = world(5, 'f56-orphan');
    w.player.god = true;
    const e = spawn(w, 'void_brood', 90, 0);
    let egg: Enemy | undefined;
    steps(w, secs(5), () => {
      egg ??= mine(w, 'void_egg')[0];
    });
    expect(egg).toBeDefined();
    e.takeHit(w, { damage: 1e6, kind: 'projectile', dirX: 1, dirY: 0 });
    let shots = 0;
    steps(w, secs(3), () => {
      shots = Math.max(shots, enemyShots(w).length);
    });
    expect(egg!.dead).toBe(true);
    expect(shots).toBe(4);
    expect(w.enemies.some((o) => o.alive && o.def.id === 'abyss_larva')).toBe(false);

    // a second brood: its egg is shot before it hatches
    const e2 = spawn(w, 'void_brood', -90, 0);
    let egg2: Enemy | undefined;
    steps(w, secs(5), () => {
      egg2 ??= mine(w, 'void_egg').find((o) => o.mem.owner === e2);
    });
    expect(egg2).toBeDefined();
    egg2!.takeHit(w, { damage: 1e6, kind: 'projectile', dirX: 1, dirY: 0 });
    steps(w, 2);
    expect(egg2!.dead).toBe(true);
    expect(egg2!.mem.hatched).toBeUndefined();
    steps(w, secs(1));
    expect(w.enemies.some((o) => o.alive && o.def.id === 'abyss_larva' && o.mem.owner === e2)).toBe(false);
  });

  it('never keeps more than three eggs + larvae of its own alive', () => {
    const w = world(5, 'f56-cap');
    w.player.god = true;
    const e = spawn(w, 'void_brood', 90, 0);
    let most = 0;
    steps(w, secs(22), () => {
      most = Math.max(most, broodChildren(w, e));
    });
    expect(most).toBe(3);
  }, 30000);
});

// ---------------------------------------------------------------- 등불 아귀
describe('lamp angler', () => {
  it('a keeper caught in the searchlight is spotted ("!"), then two homing torpedoes fly and the lamp goes dark', () => {
    const w = world(6, 'f56-angler');
    const p = w.player;
    p.god = true;
    const e = spawn(w, 'lamp_angler', 80, 0);
    steps(w, 1);
    expect(w.entities.some((x) => x instanceof AnglerLight && x.owner === e)).toBe(true);
    let alertAt = -1;
    let shotAt = -1;
    let darkFrom = -1;
    let darkFor = 0;
    steps(w, secs(8), (i) => {
      if (e.mem.alert && alertAt < 0) alertAt = i;
      const n = enemyShots(w).length;
      if (n > 0 && shotAt < 0) {
        shotAt = i;
        expect(n).toBe(2);
        darkFrom = i;
      }
      if (darkFrom >= 0 && !e.mem.lit && shotAt >= 0 && darkFor === i - darkFrom) darkFor++;
    });
    expect(alertAt).toBeGreaterThanOrEqual(0);
    expect(shotAt).toBeGreaterThan(alertAt);
    expect(shotAt - alertAt).toBeGreaterThanOrEqual(secs(CONE.alert) - 1);
    expect(darkFor).toBeGreaterThan(secs(CONE.dark - 0.3));
    e.takeHit(w, { damage: 1e6, kind: 'projectile', dirX: 1, dirY: 0 });
    steps(w, 3);
    expect(w.entities.some((x) => x instanceof AnglerLight && !x.dead)).toBe(false);
  });

  it('a keeper who stays out of the cone is never spotted', () => {
    const w = world(6, 'f56-hide');
    const p = w.player;
    p.god = true;
    const e = spawn(w, 'lamp_angler', 80, 0);
    let spotted = false;
    let lit = 0;
    for (let i = 0; i < secs(8); i++) {
      // stay just outside the lit cone: on its far side, beyond its length
      if (typeof e.mem.lure === 'number') {
        const o = lureGround(e);
        p.x = o.x - Math.cos(e.mem.lure) * 20;
        p.y = o.y - Math.sin(e.mem.lure) * 20;
      }
      w.update(FIXED_DT);
      if (e.mem.lit && e.mem.litK >= 1) lit++;
      if (e.mem.alert) spotted = true;
    }
    expect(lit).toBeGreaterThan(secs(4));
    expect(spotted).toBe(false);
    expect(enemyShots(w)).toHaveLength(0);
  });

  it('rocks block the light: hiding behind one keeps the keeper unseen', () => {
    const w = world(6, 'f56-rock');
    const p = w.player;
    p.god = true;
    const e = spawn(w, 'lamp_angler', 80, 0);
    // a wall of rock between the keeper and the angler
    const tx = Math.floor((p.x + 40) / TILE);
    for (let ty = 0; ty < w.room.h; ty++) if (w.room.tileAt(tx, ty) === Tile.FLOOR) w.room.setTile(tx, ty, Tile.ROCK);
    let spotted = false;
    for (let i = 0; i < secs(6); i++) {
      p.x = tx * TILE - 30;
      p.y = w.room.centerY;
      e.x = Math.max(e.x, (tx + 3) * TILE);
      w.update(FIXED_DT);
      if (e.mem.alert) spotted = true;
    }
    expect(spotted).toBe(false);
  });

  it('torpedoes home in on the spotted keeper for a while', () => {
    const w = world(6, 'f56-torp');
    const p = w.player;
    p.god = true;
    spawn(w, 'lamp_angler', 80, 0);
    let torp: Projectile | undefined;
    for (let i = 0; i < secs(8) && !torp; i++) {
      w.update(FIXED_DT);
      torp = enemyShots(w)[0];
    }
    expect(torp).toBeDefined();
    const t = torp!;
    expect(t.sprite).toBe('__langler_torp');
    expect(t.behaviors.some((b) => b.id === 'ink-torpedo')).toBe(true);
    steps(w, 6);
    // the keeper steps far to one side of its heading: the torpedo turns after them
    const a0 = t.angle;
    const room = w.room;
    let dir = 1;
    let side = { x: t.x + Math.cos(a0 + Math.PI / 2) * 60, y: t.y + Math.sin(a0 + Math.PI / 2) * 60 };
    if (!room.isFree(side.x, side.y, 6)) {
      dir = -1;
      side = { x: t.x + Math.cos(a0 - Math.PI / 2) * 60, y: t.y + Math.sin(a0 - Math.PI / 2) * 60 };
    }
    for (let i = 0; i < secs(0.4); i++) {
      p.x = side.x;
      p.y = side.y;
      w.update(FIXED_DT);
    }
    // it turned toward that side by most of its turn rate (1.7 rad/s)
    const turned = Math.atan2(Math.sin(t.angle - a0), Math.cos(t.angle - a0)) * dir;
    expect(t.dead).toBe(false);
    expect(turned).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------- 유령 타자기
describe('ghost typewriter', () => {
  function record(w: World, seconds: number): { t: number; angle: number; speed: number }[] {
    const seen = new Set<Projectile>();
    const out: { t: number; angle: number; speed: number }[] = [];
    steps(w, secs(seconds), (i) => {
      for (const s of enemyShots(w)) {
        if (seen.has(s)) continue;
        seen.add(s);
        out.push({ t: i, angle: s.angle, speed: s.speed });
      }
    });
    return out;
  }

  it('clatters (warning arc) then types a left-to-right stream of 10, dings, and returns 5 fast shots right-to-left', () => {
    const w = world(6, 'f56-type');
    const p = w.player;
    p.god = true;
    const e = spawn(w, 'ghost_typewriter', 90, 0);
    const x0 = e.x;
    const y0 = e.y;
    let warnAt = -1;
    const seen = new Set<Projectile>();
    const shots: { t: number; angle: number; speed: number }[] = [];
    steps(w, secs(4), (i) => {
      if (e.mem.warn && warnAt < 0) warnAt = i;
      for (const s of enemyShots(w)) {
        if (seen.has(s)) continue;
        seen.add(s);
        shots.push({ t: i, angle: s.angle, speed: s.speed });
      }
    });
    expect(warnAt).toBeGreaterThanOrEqual(0);
    expect(shots.length).toBeGreaterThanOrEqual(15);
    expect(shots[0].t - warnAt).toBeGreaterThanOrEqual(secs(0.45));
    const typed = shots.slice(0, 10);
    const ret = shots.slice(10, 15);
    const aim = e.mem.aim as number;
    const rel = (a: number) => Math.atan2(Math.sin(a - aim), Math.cos(a - aim));
    expect(rel(typed[0].angle)).toBeCloseTo(-0.6, 1);
    expect(rel(typed[9].angle)).toBeCloseTo(0.6, 1);
    for (let i = 1; i < 10; i++) expect(rel(typed[i].angle)).toBeGreaterThan(rel(typed[i - 1].angle));
    for (let i = 1; i < 5; i++) expect(rel(ret[i].angle)).toBeLessThan(rel(ret[i - 1].angle));
    // the return is a quicker sweep of faster shots
    expect(ret[4].t - ret[0].t).toBeLessThan(typed[4].t - typed[0].t);
    expect(ret[0].speed).toBeGreaterThan(typed[0].speed);
    // a turret: it never budges, even when shoved
    e.knock(1, 0, 300);
    steps(w, 10);
    expect(e.x).toBeCloseTo(x0, 5);
    expect(e.y).toBeCloseTo(y0, 5);
  });

  it('a champion types a second, offset line', () => {
    const w = world(6, 'f56-type-champ');
    w.player.god = true;
    const e = spawn(w, 'ghost_typewriter', 90, 0);
    e.champion = true;
    e.championColor = '#ff4040';
    const shots = record(w, 4.6);
    expect(shots.length).toBeGreaterThanOrEqual(25);
  });
});

// ---------------------------------------------------------------- draw purity
describe('f56 draw purity', () => {
  it('drawing never changes the simulation state', () => {
    for (const id of IDS) {
      const w = world(NEW[id], `f56-pure-${id}`);
      w.player.god = true;
      strafe(w);
      spawn(w, id, 70, -10);
      for (let i = 0; i < 360; i++) {
        w.update(FIXED_DT);
        if (i % 3 !== 0) continue;
        const before = stateHash(w);
        w.draw(1);
        expect(stateHash(w), `${id} step ${i}`).toBe(before);
      }
    }
  }, 60000);

  it('the simulation does not depend on the cosmetic rng or on drawing (lockstep)', () => {
    for (const id of IDS) {
      const run = (fxSeed: number, draw: boolean): number[] => {
        fx.setState(new RNG(fxSeed).getState());
        const w = world(NEW[id], `f56-det-${id}`);
        w.player.god = true;
        strafe(w);
        spawn(w, id, 70, -10);
        const hs: number[] = [];
        for (let i = 0; i < 540; i++) {
          w.update(FIXED_DT);
          if (draw && i % 2) w.draw(1);
          hs.push(stateHash(w));
        }
        return hs;
      };
      const a = run(1, false);
      const b = run(0x9e3779b9, true);
      const first = a.findIndex((h, i) => h !== b[i]);
      expect(first, `${id} diverged at step ${first}`).toBe(-1);
    }
  }, 60000);
});
