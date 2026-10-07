// Boss resolve (src/content/bosses/resolve.ts + wards-*.ts): the invisible common
// rules (phase gates, burst cap, releases exempt) and every boss's own skill, each
// answered by its own verb.

import './headless';
import { describe, expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { World, type WorldHost } from '../src/game/world';
import { RunState } from '../src/game/run';
import { FIXED_DT } from '../src/game/constants';
import { Enemies } from '../src/game/defs';
import type { Enemy } from '../src/game/enemy';
import { Projectile } from '../src/game/projectile';
import { stateHash } from '../src/game/statehash';
import {
  BURST_EXCESS, DAZE_MULT, GATE_GUARD, bossGates, bossWard, bossWarded, burstBudget, helpersOf, wardActive, wardIds,
} from '../src/content/bosses/resolve';
import { BELL_RINGS, COCOON_THROUGH, PLATE_BACK, PLATE_THROUGH } from '../src/content/bosses/wards-crypt-caves';
import { BANNER_AURA, BANNER_THROUGH, CHAIN_THROUGH, CRUST_THROUGH, MIRROR_WARN, chainEnds } from '../src/content/bosses/wards-forge-sanctum';
import {
  DARK_THROUGH, FOG_THROUGH, LIGHT_REACH, REWIND_BREAK, REWIND_WIND, SEAL_STAND, WALTZ_OFF, WALTZ_ON, lampFlaring, onTheBeat, sealsLeft,
} from '../src/content/bosses/wards-deep';
import { PLAIN_ID } from './dpsharness';

const host: WorldHost = { openInventory() {}, onGameOver() {} };

/** A world in the boss room of `bossId`'s floor, the boss awake. */
function arena(bossId: string): { w: World; boss: Enemy } {
  const run = new RunState(`RESOLVE-${bossId}`, PLAIN_ID);
  run.seeded = true;
  const w = new World(new Renderer(fakeDisplay(1280, 720)), run, host);
  w.inputSource = (_w, _p, o) => { o.mx = o.my = o.ax = o.ay = o.held = o.pressed = 0; };
  w.start();
  const floor = Enemies.must(bossId).bossFloors![0];
  if (floor > 1) w.startFloor(floor);
  w.player.god = true;
  const node = w.map.nodes.find((n) => n.kind === 'boss')!;
  const orig = w.spawnEnemy.bind(w);
  w.spawnEnemy = (id: string, x: number, y: number) => orig(Enemies.get(id)?.boss ? bossId : id, x, y);
  w.enterRoom(node, null);
  w.spawnEnemy = orig;
  w.update(FIXED_DT);
  const boss = w.enemies.find((e) => e.isBoss)!;
  boss.dormant = 0;
  return { w, boss };
}
const hit = (w: World, boss: Enemy, damage: number, extra: Record<string, unknown> = {}) =>
  w.applyHit(boss, { damage, kind: 'projectile', attacker: w.player, ...extra });
/** Damage actually taken from one hit (the boss forced hittable for the moment). */
function taken(w: World, boss: Enemy, damage: number, extra: Record<string, unknown> = {}): number {
  const h = boss.hidden;
  const v = boss.vulnerable;
  boss.hidden = false;
  boss.vulnerable = true;
  const hp = boss.hp;
  hit(w, boss, damage, extra);
  boss.hidden = h;
  boss.vulnerable = v;
  return hp - boss.hp;
}
const steps = (w: World, s: number) => { for (let i = 0; i < Math.round(s / FIXED_DT); i++) w.update(FIXED_DT); };
function until(w: World, cond: () => boolean, s = 15): boolean {
  for (let i = 0; i < Math.round(s / FIXED_DT); i++) {
    if (cond()) return true;
    w.update(FIXED_DT);
  }
  return cond();
}
/** Drive the boss through its first phase change (and the guard after it). */
function passGate(w: World, boss: Enemy): void {
  hit(w, boss, boss.maxHp * 10);
  expect(until(w, () => !bossWarded(w, boss) && boss.phase >= 1, 20), 'phase change').toBe(true);
  // the gate-stopping blow filled the burst budget: let it drain so skill numbers read clean
  boss.mem.rsBurst = 0;
}
/** A small hit well inside the burst budget. */
const small = (boss: Enemy) => boss.maxHp * 0.004;

describe('boss resolve: common rules', () => {
  it('every boss has its own skill with Korean text', () => {
    const bosses = Enemies.all().filter((e) => e.boss).map((e) => e.id).sort();
    expect(wardIds().sort()).toEqual(bosses);
    const names = new Set<string>();
    for (const id of bosses) {
      const wd = bossWard(id)!;
      expect(/[가-힣]/.test(wd.name) && /[가-힣]/.test(wd.hint), id).toBe(true);
      names.add(wd.name);
    }
    expect(names.size).toBe(bosses.length);
  });

  it('a huge hit cannot skip a phase: it stops under the line and the boss is untouchable until its phase change has played', () => {
    const { w, boss } = arena('spore_mother');
    const line = bossGates('spore_mother')[0] * boss.maxHp;
    hit(w, boss, boss.maxHp * 10);
    expect(boss.alive).toBe(true);
    expect(boss.hp).toBeLessThan(line);
    expect(boss.hp).toBeGreaterThan(line - 1);
    expect(bossWarded(w, boss)).toBe(true);
    const held = boss.hp;
    hit(w, boss, 500);
    expect(boss.hp).toBe(held);
    expect(until(w, () => !bossWarded(w, boss), 20)).toBe(true);
    expect(boss.phase).toBe(1);
    expect(taken(w, boss, 10)).toBeGreaterThan(0);
    expect(GATE_GUARD).toBeGreaterThan(1);
  });

  it('bursts beyond the per-second budget land at a quarter; releases are exempt', () => {
    const { w, boss } = arena('spore_mother');
    const budget = burstBudget(2) * boss.maxHp;
    expect(taken(w, boss, budget * 0.5)).toBeCloseTo(budget * 0.5, 3);
    // half of it fits the budget, the rest is cut to a quarter
    expect(taken(w, boss, budget)).toBeCloseTo(budget * 0.5 + budget * 0.5 * BURST_EXCESS, 3);
    expect(taken(w, boss, budget * 0.2, { release: true })).toBeCloseTo(budget * 0.2, 3);
    steps(w, 3);
    expect(taken(w, boss, budget * 0.4)).toBeGreaterThan(budget * 0.35);
  });

  it('releases pierce a boss skill', () => {
    const { w, boss } = arena('bell_keeper');
    passGate(w, boss);
    expect(wardActive(w, boss)).toBe(true);
    expect(taken(w, boss, 10)).toBe(0);
    expect(taken(w, boss, 10, { release: true })).toBeCloseTo(10, 3);
  });

  it('a skill shows its banner once per run', () => {
    const { w, boss } = arena('bell_keeper');
    passGate(w, boss);
    expect(w.flags.has('ward:bell_keeper')).toBe(true);
  });
});

describe('boss skills, floors 1–2', () => {
  it('조종지기: under the bell only the number of hits counts; rung open it reels', () => {
    const { w, boss } = arena('bell_keeper');
    passGate(w, boss);
    expect(wardActive(w, boss)).toBe(true);
    // one enormous hit is just one ring
    expect(taken(w, boss, boss.maxHp)).toBe(0);
    for (let i = 1; i < BELL_RINGS - 1; i++) taken(w, boss, 1);
    expect(wardActive(w, boss)).toBe(true);
    taken(w, boss, 1);
    expect(wardActive(w, boss)).toBe(false);
    expect(taken(w, boss, 10)).toBeCloseTo(10 * DAZE_MULT, 3);
  });

  it('해골 거상: the plated front turns aside blows; the flank and back take them', () => {
    const { w, boss } = arena('bone_colossus');
    passGate(w, boss);
    expect(wardActive(w, boss)).toBe(true);
    const m = boss.mem;
    const shot = (fromX: number) => {
      m.wdFace = 0;
      const pr = w.spawn(new Projectile({ team: 'player', owner: w.player, x: boss.x + Math.sign(fromX) * 4, y: boss.y, angle: fromX > 0 ? Math.PI : 0, speed: 200, damage: 10 }));
      const d = taken(w, boss, 10, { source: pr });
      pr.dead = true;
      return d;
    };
    expect(shot(20)).toBeCloseTo(10 * PLATE_THROUGH, 3);
    expect(shot(-20)).toBeCloseTo(10 * PLATE_BACK, 3);
  });

  it('포자 어미: cocoons heal her and soften blows until they are broken', () => {
    const { w, boss } = arena('spore_mother');
    passGate(w, boss);
    const cocoons = helpersOf(w, boss, 'ward_cocoon');
    expect(cocoons.length).toBe(2);
    expect(taken(w, boss, 10)).toBeCloseTo(10 * COCOON_THROUGH, 3);
    const hp = boss.hp;
    steps(w, 1);
    expect(boss.hp).toBeGreaterThan(hp);
    for (const c of cocoons) w.applyHit(c, { damage: 1e6, kind: 'projectile', attacker: w.player });
    w.update(FIXED_DT);
    expect(wardActive(w, boss)).toBe(false);
    expect(taken(w, boss, 10)).toBeCloseTo(10, 3);
  });

  it('점액 여왕: her crown runs off; she is untouchable until it is caught, then she reels', () => {
    const { w, boss } = arena('slime_queen');
    passGate(w, boss);
    const crowns = helpersOf(w, boss, 'ward_crown_slime');
    expect(crowns).toHaveLength(1);
    expect(taken(w, boss, 10)).toBe(0);
    // it runs from the keeper
    const c = crowns[0];
    w.player.x = c.x - 20;
    w.player.y = c.y;
    const x0 = c.x;
    steps(w, 0.6);
    expect(c.x).toBeGreaterThan(x0);
    w.applyHit(c, { damage: 1e6, kind: 'projectile', attacker: w.player });
    // (past the hit-stop of the kill)
    steps(w, 0.3);
    expect(wardActive(w, boss)).toBe(false);
    expect(taken(w, boss, 10)).toBeCloseTo(10 * DAZE_MULT, 3);
  });
});

describe('boss skills, floors 3–4', () => {
  it('사슬 대장장이: chained it takes a fifth; a shot across a chain strikes its anchor', () => {
    const { w, boss } = arena('chain_smith');
    passGate(w, boss);
    const anchors = helpersOf(w, boss, 'ward_anchor');
    expect(anchors).toHaveLength(2);
    expect(taken(w, boss, 10)).toBeCloseTo(10 * CHAIN_THROUGH, 3);
    const a = anchors[0];
    const [ax, ay, bx, by] = chainEnds(boss, a);
    const hp = a.hp;
    const pr = w.spawn(new Projectile({ team: 'player', owner: w.player, x: (ax * 2 + bx) / 3, y: (ay * 2 + by) / 3, angle: Math.atan2(bx - ax, -(by - ay)), speed: 1, damage: 7 }));
    w.update(FIXED_DT);
    expect(pr.dead).toBe(true);
    expect(a.hp).toBeLessThan(hp);
    for (const x of anchors) w.applyHit(x, { damage: 1e6, kind: 'melee', attacker: w.player });
    w.update(FIXED_DT);
    expect(wardActive(w, boss)).toBe(false);
    expect(taken(w, boss, 10)).toBeCloseTo(10, 3);
  });

  it('쇳물 이무기: the crusted body barely feels a hit; the head takes it all', () => {
    const { w, boss } = arena('slag_imugi');
    passGate(w, boss);
    expect(wardActive(w, boss)).toBe(true);
    boss.mem.viaSeg = 1;
    expect(taken(w, boss, 10)).toBeCloseTo(10 * CRUST_THROUGH, 3);
    boss.mem.viaSeg = 0;
    expect(taken(w, boss, 10)).toBeCloseTo(10, 3);
  });

  it('빙결 성녀: the warned mirror sends shots back; blades still cut', () => {
    const { w, boss } = arena('frost_saint');
    boss.mem.wdNext = 0.05;
    steps(w, 0.1);
    expect(boss.mem.wdMirror).toBe(1);
    steps(w, MIRROR_WARN);
    expect(wardActive(w, boss)).toBe(true);
    const pr = w.spawn(new Projectile({ team: 'player', owner: w.player, x: boss.x - 20, y: boss.y, angle: 0, speed: 200, damage: 30 }));
    const before = w.projectiles.filter((q) => q.team === 'enemy').length;
    expect(taken(w, boss, 30, { source: pr })).toBe(0);
    expect(pr.dead).toBe(true);
    w.update(FIXED_DT);
    expect(w.projectiles.filter((q) => q.team === 'enemy').length).toBeGreaterThan(before);
    expect(taken(w, boss, 10, { kind: 'melee' })).toBeCloseTo(10, 3);
  });

  it('서리 기사단장: by his banner he takes a quarter; lured away he takes it all; felling the banner staggers him', () => {
    const { w, boss } = arena('frost_commander');
    expect(until(w, () => helpersOf(w, boss, 'ward_banner').length > 0, 8)).toBe(true);
    const b = helpersOf(w, boss, 'ward_banner')[0];
    boss.x = b.x + 10;
    boss.y = b.y;
    expect(taken(w, boss, 10)).toBeCloseTo(10 * BANNER_THROUGH, 3);
    boss.x = b.x + BANNER_AURA + 20;
    expect(taken(w, boss, 10)).toBeCloseTo(10, 3);
    w.applyHit(b, { damage: 1e6, kind: 'melee', attacker: w.player });
    w.update(FIXED_DT);
    expect(helpersOf(w, boss, 'ward_banner')).toHaveLength(0);
    expect(taken(w, boss, 10)).toBeCloseTo(10 * DAZE_MULT, 3);
  });
});

describe('boss skills, floors 5–7', () => {
  it('무명: it only has a body in the lantern light, and the light it needs shrinks', () => {
    const { w, boss } = arena('mumyeong');
    const p = w.player;
    p.x = boss.x;
    p.y = boss.y + boss.r + LIGHT_REACH[0] - 10;
    expect(taken(w, boss, 10)).toBeCloseTo(10, 3);
    p.y = boss.y + boss.r + LIGHT_REACH[0] + 30;
    expect(taken(w, boss, 10)).toBeCloseTo(10 * DARK_THROUGH, 3);
    expect(LIGHT_REACH[2]).toBeLessThan(LIGHT_REACH[0]);
  });

  it('대서기관: sealed, it cannot be hurt until a keeper has stood on every glyph', () => {
    const { w, boss } = arena('grand_archivist');
    passGate(w, boss);
    expect(wardActive(w, boss)).toBe(true);
    expect(taken(w, boss, 10)).toBe(0);
    const n = sealsLeft(boss);
    expect(n).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 4; i++) {
      if ((boss.mem[`wdS${i}p`] ?? -1) < 0) continue;
      w.player.x = boss.mem[`wdS${i}x`];
      w.player.y = boss.mem[`wdS${i}y`];
      w.player.vx = w.player.vy = 0;
      steps(w, SEAL_STAND + 0.1);
    }
    expect(sealsLeft(boss)).toBe(0);
    expect(wardActive(w, boss)).toBe(false);
    expect(taken(w, boss, 10)).toBeCloseTo(10 * DAZE_MULT, 3);
  });

  it('가라앉은 등대: in the fog only the lamp flares let blows land', () => {
    const { w, boss } = arena('sunken_lighthouse');
    boss.mem.wdNext = 0.05;
    steps(w, 0.1);
    expect(boss.mem.wdFog).toBe(1);
    expect(until(w, () => !lampFlaring(w, boss), 4)).toBe(true);
    expect(taken(w, boss, 10)).toBeCloseTo(10 * FOG_THROUGH, 3);
    expect(until(w, () => lampFlaring(w, boss), 4)).toBe(true);
    expect(taken(w, boss, 10)).toBeCloseTo(10, 3);
  });

  it('시계장인: the wind-up turns its clock back unless it is struck hard enough', () => {
    const { w, boss } = arena('clockmaker');
    steps(w, 1.2);
    const hp0 = boss.hp;
    const d = taken(w, boss, small(boss) * 4);
    expect(d).toBeGreaterThan(0);
    boss.mem.wdNext = 0.02;
    expect(until(w, () => wardActive(w, boss), 1)).toBe(true);
    steps(w, REWIND_WIND + 0.1);
    expect(boss.hp).toBeCloseTo(hp0, 0);
    // again, but broken by a hard blow during the wind-up
    boss.mem.wdNext = 0.02;
    steps(w, 4);
    boss.mem.wdNext = 0.02;
    expect(until(w, () => wardActive(w, boss), 2)).toBe(true);
    taken(w, boss, boss.maxHp * REWIND_BREAK * 1.1);
    steps(w, 0.3);
    expect(wardActive(w, boss)).toBe(false);
    expect(boss.mem.rsDaze).toBeGreaterThan(0);
  });

  it('태엽 무희: in the waltz only blows on the beat truly land', () => {
    const { w, boss } = arena('clockwork_dancer');
    boss.mem.wdNext = 0.02;
    steps(w, 0.05);
    expect(boss.mem.wdWaltz).toBe(1);
    expect(until(w, () => w.time >= boss.mem.wdWaltzAt && onTheBeat(w, boss), 3)).toBe(true);
    expect(taken(w, boss, 10)).toBeCloseTo(10 * WALTZ_ON, 3);
    expect(until(w, () => !onTheBeat(w, boss), 2)).toBe(true);
    expect(taken(w, boss, 10)).toBeCloseTo(10 * WALTZ_OFF, 3);
  });
});

describe('boss resolve: cleanup and purity', () => {
  it('helpers fall with their boss', () => {
    for (const [id, helper] of [['chain_smith', 'ward_anchor'], ['spore_mother', 'ward_cocoon']] as const) {
      const { w, boss } = arena(id);
      passGate(w, boss);
      expect(helpersOf(w, boss, helper).length).toBeGreaterThan(0);
      w.killEnemy(boss);
      steps(w, 0.5);
      expect(w.enemies.filter((e) => e.def.id === helper && e.alive)).toHaveLength(0);
    }
  });

  it.each(['bell_keeper', 'chain_smith', 'frost_commander', 'grand_archivist', 'clockwork_dancer', 'mumyeong'])('%s: drawing the skill never changes the simulation', (id) => {
    const { w, boss } = arena(id);
    hit(w, boss, boss.maxHp * 10);
    for (let i = 0; i < 360; i++) {
      w.update(FIXED_DT);
      if (i % 2) continue;
      const before = stateHash(w);
      w.draw(1);
      expect(stateHash(w), `${id} ${i}`).toBe(before);
    }
  });
});
