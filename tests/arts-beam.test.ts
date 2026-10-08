// 광선 유물 (beam arts, src/content/items/beam-arts.ts): 그을린 렌즈, 반딧불 필라멘트,
// 프리즘 조각, 과열 코일, 일식 렌즈. Each works on the beam weapons (void_gaze, prism_staff,
// thunder_rod), does nothing on a plain ranged weapon, stacks sanely and sits in its rarity
// band on top of late builds (few seeds and short fights here; the reported numbers come
// from the same procedure with more seeds).

import './headless';
import { describe, expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { World, type WorldHost } from '../src/game/world';
import { RunState } from '../src/game/run';
import { FIXED_DT } from '../src/game/constants';
import { Artifacts, RARITY_WEIGHT } from '../src/game/defs';
import { HELD, PRESS, fixedRules, type PlayerInput } from '../src/game/seam';
import { lookIsVisible } from '../src/game/look';
import { hasSprite } from '../src/engine/sprites';
import { RNG } from '../src/engine/rng';
import type { Enemy } from '../src/game/enemy';
import { DUMMY_ID, PLAIN_ID } from './dpsharness';
import { freshState } from '../src/game/weaponslots';
import { ECLIPSE_GENS, ECLIPSE_QUEUE, FIREFLY_RANGE, beamHit, FIREFLY_SLOW, HEAT_CD, HEAT_OVER, LENS_STEPS, lensSteps } from '../src/content/items/beam-arts';

const IDS = ['smoked_lens', 'firefly_filament', 'prism_shard', 'overheat_coil', 'eclipse_lens'];
const BEAMS = ['void_gaze', 'prism_staff', 'thunder_rod'];
const host: WorldHost = { openInventory() {}, onGameOver() {} };
let renderer: Renderer | null = null;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

interface Opts {
  weapon: string;
  artifacts?: string[];
  seconds?: number;
  seed?: string;
  /** 5 dummies in a tight cluster */
  crowd?: boolean;
  /** hold fire for `hold` s out of every `period` s */
  cycle?: { hold: number; period: number };
  /** killable targets: `n` alive at a time with `hp`, a new one replaces each kill */
  kill?: { n: number; hp: number };
  /** weapon in the second slot, swapped in at `swapAt` s */
  second?: string;
  /** put this weapon straight into the second slot (beam -> beam swaps) */
  slot2?: string;
  swapAt?: number;
  /** called every step */
  each?: (w: World) => void;
}

/** The real World on a training floor: a scripted keeper (base stats, no kit) beams immovable dummies. */
function fight(o: Opts): { w: World; dps: number; kills: number } {
  if (!renderer) renderer = new Renderer(fakeDisplay(1280, 720));
  const run = new RunState(o.seed ?? `BEAMART-${o.weapon}`, PLAIN_ID);
  run.seeded = true;
  const w = new World(renderer, run, host);
  w.setQuality({ lighting: false, particles: 0 });
  w.rules = fixedRules({ hitStop: false });
  let dummies: Enemy[] = [];
  let swapped = false;
  w.inputSource = (ww: World, _p: unknown, out: PlayerInput) => {
    const p = ww.player;
    out.mx = out.my = out.ax = out.ay = 0;
    out.held = 0;
    out.pressed = 0;
    const t = dummies.find((e) => e.alive);
    out.cx = t ? t.x : p.x + 40;
    out.cy = t ? t.y : p.y;
    if (!t) return;
    const firing = o.cycle ? ww.time % o.cycle.period < o.cycle.hold : true;
    out.held = (firing ? HELD.fire : 0) | HELD.cursorAim;
    if (o.swapAt !== undefined && !swapped && ww.time >= o.swapAt) {
      swapped = true;
      out.pressed |= PRESS.swap;
    }
  };
  w.start();
  const p = w.player;
  for (const e of [...w.enemies]) w.killEnemy(e);
  if (o.second) p.equipWeapon(w, o.second);
  if (p.weaponId !== o.weapon) p.equipWeapon(w, o.weapon);
  if (o.slot2) {
    p.weapon2Id = o.slot2;
    p.weapon2 = freshState();
  }
  for (const id of o.artifacts ?? []) w.items.give(id);
  p.god = true;
  const cx = p.x + 70;
  const cy = p.y;
  const rng = new RNG(`spots-${o.seed ?? ''}`);
  const add = (ox: number, oy: number) => {
    const e = w.spawnEnemy(DUMMY_ID, cx + ox, cy + oy);
    if (!e) return;
    e.dormant = 0;
    if (o.kill) e.hp = e.maxHp = o.kill.hp;
    dummies.push(e);
  };
  if (o.kill) for (let i = 0; i < o.kill.n; i++) add(rng.range(-22, 22), rng.range(-22, 22));
  else for (const [ox, oy] of o.crowd ? [[0, 0], [18, 0], [-18, 0], [0, 18], [0, -18]] : [[0, 0]]) add(ox, oy);
  let kills = 0;
  const T = o.seconds ?? 6;
  for (let i = 0, n = Math.round(T / FIXED_DT); i < n; i++) {
    w.update(FIXED_DT);
    o.each?.(w);
    const alive = dummies.filter((e) => e.alive);
    const dead = dummies.length - alive.length;
    dummies = alive;
    if (o.kill) {
      kills += dead;
      for (let k = 0; k < dead; k++) add(rng.range(-22, 22), rng.range(-22, 22));
    }
  }
  return { w, dps: w.run.stats.damageDealt / T, kills };
}

const ratio = (o: Opts, arts: string[]) => fight({ ...o, artifacts: [...(o.artifacts ?? []), ...arts] }).dps / fight(o).dps;

/** late builds of 10 visible artifacts (loot rarity weights), none of ours */
function lateBuilds(n: number): string[][] {
  const pool = Artifacts.all().filter((a) => !a.hidden && !a.blessing && !IDS.includes(a.id));
  const rng = new RNG('BEAM-LATE');
  return Array.from({ length: n }, () => {
    const left = [...pool];
    const pick: string[] = [];
    for (let i = 0; i < 10 && left.length; i++) {
      const c = rng.weighted(left, (a) => RARITY_WEIGHT[a.rarity]);
      if (!c) break;
      pick.push(c.id);
      left.splice(left.indexOf(c), 1);
    }
    return pick;
  });
}

/** median over the beam weapons of the median late-build gain of `id` */
function lateGain(id: string, extra: Partial<Opts> = {}, n = 3): number {
  const builds = lateBuilds(n);
  return median(BEAMS.map((weapon) => median(builds.map((b, i) => ratio({ weapon, seed: `L${i}-${weapon}`, artifacts: b, ...extra }, [id])))));
}

describe('beam arts: definitions', () => {
  it('are registered with Korean texts, icons, visible traces and the requested rarity / tag', () => {
    const want: Record<string, [string, string]> = {
      smoked_lens: ['common', 'flame'], firefly_filament: ['common', 'frost'], prism_shard: ['rare', 'storm'],
      overheat_coil: ['epic', 'flame'], eclipse_lens: ['legendary', 'shadow'],
    };
    for (const id of IDS) {
      const a = Artifacts.must(id);
      expect([a.rarity, a.tags[0]], id).toEqual(want[id]);
      expect(a.tags.length, id).toBe(1);
      // glance-readable: one plain sentence that names the weapon type (the old '광선 무기: ' label is gone)
      expect(a.desc, id).toContain('광선 무기');
      expect(a.desc.length, id).toBeLessThanOrEqual(36);
      if (a.detail) expect(a.detail, id).toMatch(/[가-힣]/);
      expect(a.quote ?? '', id).toMatch(/[가-힣]/);
      expect(hasSprite(a.icon), id).toBe(true);
      expect(lookIsVisible(a.look), id).toBe(true);
      expect(a.pools.length, id).toBeGreaterThan(0);
    }
    expect(Artifacts.must('eclipse_lens').unique).toBe(true);
  });
});

describe('beam arts: nothing on a plain ranged weapon', () => {
  it('lantern bolt: same damage alone, in a crowd and against killable targets', () => {
    for (const id of IDS) {
      expect(ratio({ weapon: 'lantern_bolt', seconds: 4 }, [id]), id).toBeCloseTo(1, 6);
      expect(ratio({ weapon: 'lantern_bolt', seconds: 4, crowd: true }, [id]), id).toBeCloseTo(1, 6);
      expect(ratio({ weapon: 'lantern_bolt', seconds: 4, kill: { n: 4, hp: 30 } }, [id]), id).toBeCloseTo(1, 6);
    }
  });

  it('only direct hits of the held beam weapon count (no releases, item rays, other sources)', () => {
    const w = fight({ weapon: 'void_gaze', seconds: 0.1 }).w;
    const p = w.player;
    expect(beamHit(w, { damage: 5, kind: 'laser', attacker: p })).toBe(true);
    expect(beamHit(w, { damage: 5, kind: 'laser', attacker: p, release: true })).toBe(false);
    expect(beamHit(w, { damage: 5, kind: 'laser', attacker: p, noProc: true })).toBe(false);
    expect(beamHit(w, { damage: 5, kind: 'projectile', attacker: p })).toBe(false);
    expect(beamHit(w, { damage: 5, kind: 'laser', attacker: null })).toBe(false);
    const l = fight({ weapon: 'lantern_bolt', seconds: 0.1 }).w;
    expect(beamHit(l, { damage: 5, kind: 'laser', attacker: l.player })).toBe(false);
  });

  it('a beam weapon in the second slot does nothing until it is drawn', () => {
    // lantern in hand, void gaze holstered: no lens heat, no range, no slow, no heat
    const r = fight({ weapon: 'lantern_bolt', second: 'void_gaze', artifacts: IDS, seconds: 3 });
    expect(r.w.player.weaponId).toBe('lantern_bolt');
    expect(lensSteps(r.w)).toBe(0);
    expect(r.w.vars.__heat ?? 0).toBe(0);
    expect(r.w.player.weaponStats.range).toBeCloseTo(fight({ weapon: 'lantern_bolt', seconds: 0.1 }).w.player.weaponStats.range, 6);
    // swapping to the beam mid-fight turns them on
    let steps = 0;
    fight({ weapon: 'lantern_bolt', second: 'void_gaze', artifacts: ['smoked_lens'], swapAt: 1, seconds: 4, each: (w) => { steps = Math.max(steps, lensSteps(w)); } });
    expect(steps).toBe(LENS_STEPS);
  });
});

describe('그을린 렌즈 (smoked_lens)', () => {
  it('heats one focused enemy step by step on every beam weapon; copies add up', () => {
    for (const weapon of BEAMS) {
      let steps = 0;
      fight({ weapon, artifacts: ['smoked_lens'], seconds: 3, each: (w) => { steps = Math.max(steps, lensSteps(w)); } });
      expect(steps, weapon).toBe(LENS_STEPS);
      const one = ratio({ weapon }, ['smoked_lens']);
      const three = ratio({ weapon }, ['smoked_lens', 'smoked_lens', 'smoked_lens']);
      expect(one, weapon).toBeGreaterThan(1.06);
      expect(one, weapon).toBeLessThan(1.16);
      expect(three - 1, weapon).toBeLessThanOrEqual((one - 1) * 3.15);
      expect(three, weapon).toBeGreaterThan(one);
    }
  });

  it('only the focused enemy heats up: a crowd gains far less than one target', () => {
    const single = ratio({ weapon: 'void_gaze' }, ['smoked_lens']);
    const crowd = ratio({ weapon: 'void_gaze', crowd: true }, ['smoked_lens']);
    expect(crowd).toBeLessThan(1 + (single - 1) * 0.6);
  });

  it('late builds: common band', () => {
    const g = lateGain('smoked_lens');
    expect(g).toBeGreaterThan(1.04);
    expect(g).toBeLessThan(1.14);
  });
});

describe('반딧불 필라멘트 (firefly_filament)', () => {
  it('beam range +15% per copy only while a beam weapon is in the hands', () => {
    const base = fight({ weapon: 'void_gaze', seconds: 0.1 }).w.player.weaponStats.range;
    const one = fight({ weapon: 'void_gaze', artifacts: ['firefly_filament'], seconds: 0.1 }).w.player.weaponStats.range;
    const two = fight({ weapon: 'void_gaze', artifacts: ['firefly_filament', 'firefly_filament'], seconds: 0.1 }).w.player.weaponStats.range;
    expect(one / base).toBeCloseTo(1 + FIREFLY_RANGE, 5);
    expect(two / base).toBeCloseTo(1 + FIREFLY_RANGE * 2, 5);
    // swapped out to a ranged weapon: back to normal
    const r = fight({ weapon: 'void_gaze', second: 'lantern_bolt', artifacts: ['firefly_filament'], swapAt: 0.2, seconds: 0.6 });
    expect(r.w.player.weaponId).toBe('lantern_bolt');
    expect(r.w.player.weaponStats.range).toBeCloseTo(fight({ weapon: 'lantern_bolt', seconds: 0.1 }).w.player.weaponStats.range, 5);
  });

  it('enemies in the beam stay slowed while it touches them, on every beam weapon', () => {
    for (const weapon of BEAMS) {
      let slowed = 0;
      let steps = 0;
      fight({ weapon, artifacts: ['firefly_filament'], seconds: 3, each: (w) => {
        if (w.time < 1) return;
        steps++;
        if (w.enemies.some((e) => e.alive && e.hasStatus('slow'))) slowed++;
      } });
      expect(slowed / steps, weapon).toBeGreaterThan(0.9);
    }
    let any = false;
    fight({ weapon: 'lantern_bolt', artifacts: ['firefly_filament'], seconds: 2, each: (w) => { any ||= w.enemies.some((e) => e.hasStatus('slow')); } });
    expect(any).toBe(false);
  });

  it('never keeps a stronger slow alive: it runs out, then the 15% slow carries on', () => {
    let applied = false;
    let strongAt = -1;
    let late = 0;
    let lateSlowed = true;
    fight({ weapon: 'void_gaze', artifacts: ['firefly_filament'], seconds: 3, each: (w) => {
      const e = w.enemies.find((x) => x.alive);
      if (!e) return;
      if (!applied && w.time >= 1) {
        applied = true;
        e.applyStatus({ kind: 'slow', duration: 0.8, power: 0.45 }, () => 0);
      }
      const st = e.statuses.get('slow');
      if (st && st.power > 0.4) strongAt = w.time;
      if (w.time > 2.2) {
        late = Math.max(late, st?.power ?? 0);
        lateSlowed &&= !!st;
      }
    } });
    expect(strongAt).toBeGreaterThan(1.5);
    expect(strongAt).toBeLessThan(2);
    expect(late).toBeCloseTo(FIREFLY_SLOW, 6);
    expect(lateSlowed).toBe(true);
  });
});

describe('프리즘 조각 (prism_shard)', () => {
  it('refracts a branch into a neighbour in a crowd, never with one target', () => {
    for (const weapon of BEAMS) {
      const r = fight({ weapon, crowd: true, artifacts: ['prism_shard'] });
      expect(r.w.items.lastProc('prism_shard'), weapon).toBeGreaterThan(0);
      const c = ratio({ weapon, crowd: true }, ['prism_shard']);
      expect(c, weapon).toBeGreaterThan(1.03);
      expect(c, weapon).toBeLessThan(1.8);
      expect(ratio({ weapon }, ['prism_shard']), weapon).toBeCloseTo(1, 6);
    }
  });

  it('copies add branches roughly linearly (crowd)', () => {
    const one = ratio({ weapon: 'prism_staff', crowd: true, seconds: 16 }, ['prism_shard']);
    const three = ratio({ weapon: 'prism_staff', crowd: true, seconds: 16 }, ['prism_shard', 'prism_shard', 'prism_shard']);
    expect(three).toBeGreaterThan(one);
    expect(three - 1).toBeLessThanOrEqual((one - 1) * 3.3);
  });

  it('late builds (crowd): rare band', () => {
    const g = lateGain('prism_shard', { crowd: true });
    expect(g).toBeGreaterThan(1.05);
    expect(g).toBeLessThan(1.2);
  });
});

describe('과열 코일 (overheat_coil)', () => {
  it('overheats after 2 s of channel and vents one blast on release', () => {
    for (const weapon of BEAMS) {
      let hot = 0;
      let blasts = 0;
      let lastNext = -1;
      fight({ weapon, artifacts: ['overheat_coil'], cycle: { hold: 3.2, period: 3.6 }, seconds: 3.5, each: (w) => {
        if ((w.vars.__heat ?? 0) >= HEAT_OVER) hot++;
        const nx = w.vars.__heatNext ?? -1;
        if (nx !== lastNext) { blasts++; lastNext = nx; }
      } });
      expect(hot, weapon).toBeGreaterThan(0);
      expect(blasts, weapon).toBe(1);
    }
  });

  it('a weapon change cools the coil, also from one beam weapon to another (no blast)', () => {
    for (const [a, b] of [['void_gaze', 'prism_staff'], ['prism_staff', 'thunder_rod'], ['thunder_rod', 'void_gaze']]) {
      let before = 0;
      let after = 99;
      const r = fight({ weapon: a, slot2: b, artifacts: ['overheat_coil'], swapAt: 1.5, seconds: 1.6, each: (w) => {
        if (w.time < 1.49) before = w.vars.__heat ?? 0;
        else if (w.player.weaponId === b) after = Math.min(after, w.vars.__heat ?? 0);
      } });
      expect(r.w.player.weaponId, a).toBe(b);
      expect(before, a).toBeGreaterThan(1.3);
      expect(after, a).toBeLessThan(0.05);
      expect(r.w.vars.__heatNext, a).toBeUndefined();
    }
  });

  it('tapping never vents a blast; the cooldown caps fast cycles', () => {
    let blasts = 0;
    let lastNext = -1;
    const count = (w: World) => { const nx = w.vars.__heatNext ?? -1; if (nx !== lastNext) { blasts++; lastNext = nx; } };
    fight({ weapon: 'void_gaze', artifacts: ['overheat_coil'], cycle: { hold: 0.6, period: 0.8 }, seconds: 8, each: count });
    expect(blasts).toBe(0);
    blasts = 0;
    lastNext = -1;
    fight({ weapon: 'void_gaze', artifacts: ['overheat_coil'], cycle: { hold: 1.2, period: 1.4 }, seconds: 12, each: count });
    expect(blasts).toBeLessThanOrEqual(Math.ceil(12 / HEAT_CD) + 1);
  });

  it('late builds: epic band holding and cycling, crowd under the cap, copies sublinear', () => {
    const hold = lateGain('overheat_coil', { seconds: 12 });
    expect(hold).toBeGreaterThan(1.05);
    expect(hold).toBeLessThan(1.22);
    const cyc = lateGain('overheat_coil', { seconds: 12, cycle: { hold: 3.6, period: 4 } });
    expect(cyc).toBeGreaterThan(1.1);
    expect(cyc).toBeLessThan(1.26);
    expect(ratio({ weapon: 'void_gaze', crowd: true, seconds: 12, cycle: { hold: 3.6, period: 4 } }, ['overheat_coil'])).toBeLessThan(2);
    const one = ratio({ weapon: 'prism_staff', seconds: 12, cycle: { hold: 3.6, period: 4 } }, ['overheat_coil']);
    const three = ratio({ weapon: 'prism_staff', seconds: 12, cycle: { hold: 3.6, period: 4 } }, ['overheat_coil', 'overheat_coil', 'overheat_coil']);
    expect(three - 1).toBeLessThan((one - 1) * 3);
  });
});

describe('일식 렌즈 (eclipse_lens)', () => {
  it('beam kills burst into rays that can chain, at a bounded rate', () => {
    for (const weapon of BEAMS) {
      let waiting = 0;
      let live = 0;
      let maxGen = -1;
      const r = fight({ weapon, artifacts: ['eclipse_lens'], kill: { n: 5, hp: 30 }, seconds: 6, each: (w) => {
        waiting = Math.max(waiting, w.vars.__eclipseQ ?? 0);
        const bursts = w.entities.filter((e) => e.constructor.name === 'EclipseBurst' && !e.dead) as unknown as { gen: number; fired: number }[];
        live = Math.max(live, bursts.filter((b) => b.fired < 0).length);
        for (const b of bursts) maxGen = Math.max(maxGen, b.gen);
      } });
      expect(r.w.items.lastProc('eclipse_lens'), weapon).toBeGreaterThan(0);
      expect(waiting, weapon).toBeLessThanOrEqual(ECLIPSE_QUEUE);
      // never more eclipses waiting than the queue, and the chain stops after ECLIPSE_GENS bursts
      expect(live, weapon).toBeLessThanOrEqual(ECLIPSE_QUEUE);
      expect(maxGen, weapon).toBeGreaterThanOrEqual(1);
      expect(maxGen, weapon).toBeLessThan(ECLIPSE_GENS);
      const k = ratio({ weapon, kill: { n: 4, hp: 40 } }, ['eclipse_lens']);
      expect(k, weapon).toBeGreaterThan(1.1);
      expect(k, weapon).toBeLessThan(2.3);
    }
    // immovable targets that never die: nothing to burst
    expect(ratio({ weapon: 'void_gaze' }, ['eclipse_lens'])).toBeCloseTo(1, 6);
  });

  it('fodder packs (5 at a time, 20 hp): under the legendary crowd cap', () => {
    for (const weapon of BEAMS) {
      const g = median([0, 1, 2].map((k) => ratio({ weapon, seed: `F${k}-${weapon}`, kill: { n: 5, hp: 20 }, seconds: 8 }, ['eclipse_lens'])));
      expect(g, weapon).toBeGreaterThan(1.3);
      expect(g, weapon).toBeLessThan(2.3);
    }
  });

  it('late builds (killable packs): legendary band', () => {
    const g = lateGain('eclipse_lens', { kill: { n: 4, hp: 100 } });
    expect(g).toBeGreaterThan(1.08);
    expect(g).toBeLessThan(1.3);
  });
});
