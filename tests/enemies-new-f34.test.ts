// New basic enemies for floor 3 (잿불 대장간: 용접 자동인형, 화약통 일꾼) and floor 4
// (얼어붙은 성소: 고드름 사제, 눈보라 정령): definitions, sprites, a headless run in the
// real World on their floor, the signature mechanic of each, and draw purity.

import './headless';
import { fakeDisplay } from './headless';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Renderer } from '../src/engine/renderer';
import { World, type WorldHost } from '../src/game/world';
import { RunState } from '../src/game/run';
import { FIXED_DT } from '../src/game/constants';
import { fixedRules } from '../src/game/seam';
import { Enemies, Floors } from '../src/game/defs';
import { Enemy } from '../src/game/enemy';
import { Entity } from '../src/game/entity';
import { GroundWarning } from '../src/game/effects';
import { Projectile } from '../src/game/projectile';
import { getAnim, hasAnim, hasSprite, listSprites } from '../src/engine/sprites';
import { fx, RNG } from '../src/engine/rng';
import { runCoop } from './coopsim';
import { angleDiff } from '../src/engine/math';
import { stateHash } from '../src/game/statehash';
import { Beam } from '../src/content/bosses/final-kit';
import { Lob } from '../src/content/enemies/shared';
import { FrostPatch } from '../src/content/enemies/sanctum';
import { inKegCross, KEG_ARM, KEG_FUSE, KEG_WIDTH, PowderKeg, WeldBeam } from '../src/content/enemies/forge-works';
import {
  GUST_COOLDOWN, GUST_FORM, GUST_LIFE, GUST_PUSH, GUST_R, GUST_SPEED, ICICLE_GAP, ICICLE_R, ICICLE_WARN, IcicleDrop, Whirlwind,
} from '../src/content/enemies/sanctum-winter';

loadContent();

const NEW: Record<string, number> = {
  welder_automaton: 3,
  powder_porter: 3,
  icicle_priest: 4,
  blizzard_spirit: 4,
};
const IDS = Object.keys(NEW);

function spriteDefined(name: string): boolean {
  if (hasAnim(name)) {
    const a = getAnim(name)!;
    return a.frames.length > 0 && a.frames.every((f) => hasSprite(f));
  }
  return hasSprite(name);
}

// ---------------------------------------------------------------- real-World arena
const host: WorldHost = { openInventory() {}, onGameOver() {} };
let renderer: Renderer | null = null;

interface Hurt { t: number; src: string; x: number; y: number }

/** A real World on `floor` (its start room, emptied), keeper idle, hurts logged instead of applied. */
function arena(floor: number, seed: string) {
  renderer ??= new Renderer(fakeDisplay(1280, 720));
  const run = new RunState(seed, 'ria');
  run.seeded = true;
  const w = new World(renderer, run, host);
  w.setQuality({ lighting: true, particles: 0.25 });
  w.rules = fixedRules({ hitStop: false });
  let move = (_t: number): [number, number] => [0, 0];
  w.inputSource = (ww, p, o) => {
    const [mx, my] = move(ww.time);
    o.mx = mx;
    o.my = my;
    o.ax = o.ay = 0;
    o.held = 0;
    o.pressed = 0;
    o.cx = p.x + 10;
    o.cy = p.y;
  };
  w.start();
  w.startFloor(floor);
  for (let i = 0; i < 40; i++) w.update(FIXED_DT);
  for (const e of [...w.enemies]) w.killEnemy(e);
  // a hostile room: the keeper can't wander out mid-fight
  w.room.setDoorsClosed(true);
  const p = w.player;
  const hurts: Hurt[] = [];
  let iframes = 0.6;
  p.hurt = ((ww: World, _n: number, src = '???') => {
    if (!p.alive || p.invuln > 0) return false;
    hurts.push({ t: ww.time, src, x: p.x, y: p.y });
    p.invuln = iframes;
    return true;
  }) as typeof p.hurt;
  const room = w.room;
  const cx = room.interiorX + room.interiorW / 2;
  const cy = room.interiorY + room.interiorH / 2;
  return {
    w, p, hurts, cx, cy, room,
    setMove(f: (t: number) => [number, number]) { move = f; },
    setIframes(t: number) { iframes = t; },
    step(n = 1, each?: () => void) {
      for (let i = 0; i < n; i++) {
        w.update(FIXED_DT);
        each?.();
      }
    },
    spawn(id: string, x: number, y: number, champion = false): Enemy {
      const e = w.spawnEnemy(id, x, y)!;
      if (champion) {
        e.champion = true;
        e.championColor = '#ffba60';
      }
      e.dormant = 0;
      return e;
    },
  };
}

/** Keep the keeper at (x, y) (teleports it there before every step). */
function pin(a: ReturnType<typeof arena>, x: number, y: number): () => void {
  return () => {
    a.p.x = x;
    a.p.y = y;
    a.p.vx = a.p.vy = 0;
    a.p.kbx = a.p.kby = 0;
  };
}

const all = (w: World) => [...w.entities, ...((w as unknown as { pending: Entity[] }).pending ?? [])].filter((e) => !e.dead);
const of = <T extends Entity>(w: World, cls: abstract new (...a: never[]) => T): T[] => all(w).filter((e): e is T => e instanceof cls);

// ---------------------------------------------------------------- definitions
describe('new floor 3–4 enemies: definitions', () => {
  it('register on a single floor with basic-enemy stats', () => {
    for (const [id, floor] of Object.entries(NEW)) {
      const d = Enemies.must(id);
      expect(d.name, id).toMatch(/^[가-힣 ]+$/);
      expect(d.floors, id).toEqual([floor]);
      expect(d.boss, id).toBeFalsy();
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
      expect(d.champion, id).toBe(true);
      expect(d.deathFx, id).toBeDefined();
      expect(d.bloodColor, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(d.light?.radius, id).toBeGreaterThan(0);
      expect(d.light?.color, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(d.script, id).toBeTypeOf('function');
      expect(spriteDefined(d.sprite), `${id} sprite`).toBe(true);
    }
    expect(Enemies.must('blizzard_spirit').flying).toBe(true);
  });

  it('every enemy has ≥3 animated states including hurt, and every referenced sprite exists', () => {
    const sources = import.meta.glob(['../src/content/enemies/forge-works.ts', '../src/content/enemies/sanctum-winter.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources)).toHaveLength(2);
    const names = new Set<string>();
    for (const src of Object.values(sources)) {
      for (const m of src.matchAll(/setAnim\('([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/r\.sprite\('([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/sprite: '([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/hurtFrame\(e, w, '([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/'((?:weldbot|kegimp|icepriest|blizwisp)_[a-z_]+)'/g)) names.add(m[1]);
    }
    expect(names.size).toBeGreaterThan(14);
    for (const n of names) expect(spriteDefined(n), n).toBe(true);
    const sprites = listSprites();
    for (const id of IDS) {
      const prefix = Enemies.must(id).sprite.split('_')[0];
      const states = new Set(sprites.filter((n) => n.startsWith(prefix + '_') && hasAnim(n.replace(/_\d+$/, ''))).map((n) => n.split('_')[1]));
      expect(states.has('hurt'), `${id} hurt`).toBe(true);
      expect(states.size, `${id} states ${[...states]}`).toBeGreaterThanOrEqual(4);
      // the attack wind-up is animated (more than one frame)
      const anims = [...states].filter((s) => s !== 'hurt').map((s) => getAnim(`${prefix}_${s}`)!);
      expect(anims.filter((a) => a.frames.length >= 2).length, id).toBeGreaterThanOrEqual(3);
    }
  });
});

// ---------------------------------------------------------------- headless run on their floor
describe('new floor 3–4 enemies: 12 s in the real World', () => {
  for (const id of IDS) {
    it(`${id}: acts, stays in the room, telegraphs before it hurts, and can die`, () => {
      const a = arena(NEW[id], `f34-run-${id}`);
      const { w, room } = a;
      a.setMove((t) => [Math.cos(t * 0.9), Math.sin(t * 1.3) * 0.8]);
      const e = a.spawn(id, a.cx - 70, a.cy - 20);
      let danger = 0;
      let firstTell = Infinity;
      let shots = 0;
      const errors: unknown[] = [];
      const orig = console.error;
      console.error = (...m: unknown[]) => errors.push(m);
      try {
        a.step(12 * 60, () => {
          const ents = all(w);
          const d = ents.filter((x) => (x.team === 'enemy' && !(x instanceof Enemy)) || x.enemyHazard || x instanceof GroundWarning).length;
          danger = Math.max(danger, d);
          shots = Math.max(shots, ents.filter((x) => x instanceof Projectile && x.team === 'enemy').length);
          if (firstTell === Infinity && (e.telegraphT > 0 || ents.some((x) => x instanceof GroundWarning) || ents.some((x) => x instanceof Beam && x.state === 'aim'))) firstTell = w.time;
          expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
          expect(e.x).toBeGreaterThanOrEqual(room.interiorX - 1);
          expect(e.x).toBeLessThanOrEqual(room.interiorX + room.interiorW + 1);
          expect(e.y).toBeGreaterThanOrEqual(room.interiorY - 1);
          expect(e.y).toBeLessThanOrEqual(room.interiorY + room.interiorH + 1);
          for (const x of ents) {
            if (x instanceof Whirlwind || x instanceof IcicleDrop || x instanceof PowderKeg) {
              expect(x.x, x.constructor.name).toBeGreaterThanOrEqual(room.interiorX);
              expect(x.x, x.constructor.name).toBeLessThanOrEqual(room.interiorX + room.interiorW);
              expect(x.y, x.constructor.name).toBeGreaterThanOrEqual(room.interiorY);
              expect(x.y, x.constructor.name).toBeLessThanOrEqual(room.interiorY + room.interiorH);
            }
          }
        });
      } finally {
        console.error = orig;
      }
      expect(errors).toEqual([]);
      expect(e.alive).toBe(true);
      expect(danger, `${id} danger`).toBeGreaterThan(0);
      expect(firstTell, `${id} telegraph`).toBeLessThan(12 + w.time);
      // fairness: the first hit always comes after a visible warning
      if (a.hurts.length) expect(a.hurts[0].t, `${id} first hit`).toBeGreaterThan(firstTell + 0.39);
      if (id === 'blizzard_spirit') expect(shots).toBeGreaterThanOrEqual(3);
      // it can die, and its leftovers resolve
      w.killEnemy(e);
      a.step(4 * 60);
      expect(e.dead).toBe(true);
      expect(of(w, Beam)).toHaveLength(0);
      expect(of(w, Whirlwind)).toHaveLength(0);
      expect(of(w, PowderKeg)).toHaveLength(0);
      expect(of(w, IcicleDrop)).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------- 용접 자동인형
describe('용접 자동인형 (welding automaton)', () => {
  function weldSetup(champion = false) {
    const a = arena(3, `f34-weld-${champion}`);
    const e = a.spawn('welder_automaton', a.cx - 40, a.cy, champion);
    e.speed = 0;
    return { a, e };
  }

  it('aims (tracking line), locks, then holds a 96 px beam that only hurts while firing', () => {
    const { a, e } = weldSetup();
    const keep = pin(a, a.cx + 30, a.cy);
    let beam: WeldBeam | undefined;
    a.step(6 * 60, () => {
      keep();
      beam ??= of(a.w, WeldBeam)[0];
    });
    expect(beam).toBeDefined();
    // replay one full beam, logging states and hits
    const b2 = { aim: 0, lock: 0, fire: 0 };
    const hurtStates: string[] = [];
    let n = a.hurts.length;
    let cur: WeldBeam | undefined;
    a.step(8 * 60, () => {
      keep();
      cur = of(a.w, WeldBeam)[0] ?? cur;
      if (cur && !cur.dead) {
        const st = cur.state;
        if (st !== 'fade') b2[st]++;
        expect(cur.len).toBeLessThanOrEqual(96 + 1e-9);
        // the beam starts at the torch nozzle, next to the welder
        expect(Math.hypot(cur.x - e.x, cur.y - e.y)).toBeLessThan(18);
        if (a.hurts.length > n) {
          hurtStates.push(st);
          n = a.hurts.length;
        }
      }
    });
    expect(b2.aim).toBeGreaterThan(30);
    expect(b2.lock).toBeGreaterThan(10);
    expect(b2.fire).toBeGreaterThan(50);
    expect(hurtStates.length).toBeGreaterThan(0);
    for (const s of hurtStates) expect(s).toBe('fire');
  });

  it('while firing, the beam turns toward the keeper at ≤ 0.9 rad/s, so circling outpaces it', () => {
    const { a, e } = weldSetup();
    const keep = pin(a, a.cx + 30, a.cy);
    // a fresh beam (still aiming), then wait for it to light
    let beam: WeldBeam | undefined;
    for (let i = 0; i < 8 * 60 && !beam; i++) {
      a.step(1, keep);
      beam = of(a.w, WeldBeam).find((b) => b.state === 'aim');
    }
    while (beam && beam.state !== 'fire') a.step(1, keep);
    expect(beam?.state).toBe('fire');
    // the keeper runs around the welder at 3 rad/s (r = 60)
    let ang = Math.atan2(a.p.y - e.y, a.p.x - e.x);
    let prev = beam!.angle;
    let maxTurn = 0;
    let lag = 0;
    while (beam!.state === 'fire') {
      ang += 3 * FIXED_DT;
      pin(a, e.x + Math.cos(ang) * 60, e.y + Math.sin(ang) * 60)();
      a.step();
      if (beam!.state !== 'fire' || beam!.dead) break;
      maxTurn = Math.max(maxTurn, Math.abs(angleDiff(prev, beam!.angle)));
      lag = Math.max(lag, Math.abs(angleDiff(beam!.angle, ang)));
      prev = beam!.angle;
    }
    expect(maxTurn).toBeGreaterThan(0.9 * FIXED_DT * 0.8);
    expect(maxTurn).toBeLessThanOrEqual(0.9 * FIXED_DT + 1e-9);
    expect(lag).toBeGreaterThan(1.2);
  });

  it('vents steam after every beam (a punish window), and dying cuts the beam', () => {
    const { a, e } = weldSetup();
    const keep = pin(a, a.cx + 30, a.cy);
    let sawBeamDie = false;
    let ventFrames = 0;
    let beamWhileVent = false;
    a.step(9 * 60, () => {
      keep();
      if (e.anim === 'weldbot_vent') {
        ventFrames++;
        if (of(a.w, WeldBeam).length) beamWhileVent = true;
      }
      if (of(a.w, WeldBeam).length) sawBeamDie = true;
    });
    expect(sawBeamDie).toBe(true);
    expect(ventFrames).toBeGreaterThan(80);
    expect(beamWhileVent).toBe(false);
    // kill it mid-aim: the beam goes with it
    for (let i = 0; i < 8 * 60 && !of(a.w, WeldBeam).length; i++) {
      keep();
      a.step();
    }
    expect(of(a.w, WeldBeam)).toHaveLength(1);
    const hp = a.hurts.length;
    a.w.killEnemy(e);
    a.step(60, keep);
    expect(of(a.w, WeldBeam)).toHaveLength(0);
    expect(a.hurts.length).toBe(hp);
  });

  it('a champion holds the arc longer and turns it faster', () => {
    const { a } = weldSetup(true);
    let beam: WeldBeam | undefined;
    a.step(6 * 60, () => {
      pin(a, a.cx + 30, a.cy)();
      beam ??= of(a.w, WeldBeam)[0];
    });
    expect(beam!.o.fire).toBeCloseTo(1.4);
    expect(beam!.turn).toBeCloseTo(1.2);
    const plain = weldSetup(false);
    let b2: WeldBeam | undefined;
    plain.a.step(6 * 60, () => {
      pin(plain.a, plain.a.cx + 30, plain.a.cy)();
      b2 ??= of(plain.a.w, WeldBeam)[0];
    });
    expect(b2!.o.fire).toBeCloseTo(1.0);
    expect(b2!.turn).toBeCloseTo(0.9);
  });
});

// ---------------------------------------------------------------- 화약통 일꾼
describe('화약통 일꾼 (powder-keg porter)', () => {
  it('inKegCross: the four lanes, not the diagonals; arms are finite', () => {
    const arms = [KEG_ARM, KEG_ARM, 20, KEG_ARM];
    expect(inKegCross(0, 0, arms, 30, 0, 5)).toBe(0);
    expect(inKegCross(0, 0, arms, 0, 40, 5)).toBe(1);
    expect(inKegCross(0, 0, arms, -15, 2, 5)).toBe(2);
    expect(inKegCross(0, 0, arms, -30, 0, 5)).toBe(-1); // the west arm is cut short by a rock
    expect(inKegCross(0, 0, arms, 3, -45, 5)).toBe(3);
    expect(inKegCross(0, 0, arms, 20, 20, 5)).toBe(-1);
    expect(inKegCross(0, 0, arms, 60, 0, 5)).toBe(-1);
    expect(inKegCross(0, 0, arms, 30, KEG_WIDTH, 5)).toBe(-1);
  });

  it('lobs a keg at the keeper; it lands as a burning bomb with a plus of lane warnings', () => {
    const a = arena(3, 'f34-porter-lob');
    const e = a.spawn('powder_porter', a.cx - 90, a.cy);
    e.speed = 0;
    const keep = pin(a, a.cx + 10, a.cy);
    let keg: PowderKeg | undefined;
    let lobAt = -1;
    let tellAt = -1;
    a.step(8 * 60, () => {
      keep();
      if (tellAt < 0 && e.telegraphT > 0) tellAt = a.w.time;
      if (lobAt < 0 && of(a.w, Lob).length) lobAt = a.w.time;
      keg ??= of(a.w, PowderKeg)[0];
    });
    expect(tellAt).toBeGreaterThan(0);
    expect(lobAt - tellAt).toBeGreaterThanOrEqual(0.4);
    expect(keg).toBeDefined();
    expect(Math.hypot(keg!.x - (a.cx + 10), keg!.y - a.cy)).toBeLessThan(8);
    expect(keg!.owner).toBe(e.id);
    expect(keg!.fuse).toBeCloseTo(KEG_FUSE);
    expect(keg!.warnings).toHaveLength(4);
    for (const g of keg!.warnings) {
      expect(g.rh).toBe(KEG_WIDTH);
      expect(g.rw).toBeLessThanOrEqual(KEG_ARM);
      expect(g.time).toBeCloseTo(KEG_FUSE);
    }
  });

  it('blows along the cross after its fuse: lanes hurt, diagonals are safe', () => {
    for (const [dx, dy, hit] of [[30, 0, true], [0, -36, true], [24, 22, false], [70, 0, false]] as const) {
      const a = arena(3, `f34-keg-${dx}-${dy}`);
      const x = a.cx;
      const y = a.cy;
      const keg = a.w.withIds(() => PowderKeg.place(a.w, x, y, 0));
      const keep = pin(a, x + dx, y + dy);
      let hurtAt = -1;
      const t0 = a.w.time;
      a.step(Math.round((KEG_FUSE + 0.5) * 60), () => {
        keep();
        if (hurtAt < 0 && a.hurts.length) hurtAt = a.w.time - t0;
      });
      expect(keg.state, `${dx},${dy}`).not.toBe('fuse');
      expect(a.hurts.length > 0, `${dx},${dy}`).toBe(hit);
      if (hit) expect(hurtAt).toBeGreaterThanOrEqual(KEG_FUSE - FIXED_DT * 2);
    }
  });

  it('shooting the keg defuses it: the shot is spent, the warnings vanish, nothing explodes', () => {
    const a = arena(3, 'f34-keg-defuse');
    const x = a.cx + 20;
    const y = a.cy;
    const keg = a.w.withIds(() => PowderKeg.place(a.w, x, y, 0));
    a.step(2);
    const keep = pin(a, x - 30, y);
    keep();
    const shot = a.w.withIds(() => a.w.spawn(new Projectile({ team: 'player', x: x - 24, y, angle: 0, speed: 260, damage: 10, radius: 3, owner: a.p })));
    a.step(30, keep);
    expect(shot.dead).toBe(true);
    expect(keg.state).toBe('dud');
    expect(keg.warnings.every((g) => g.dead)).toBe(true);
    a.step(Math.round(KEG_FUSE * 60), keep);
    expect(a.hurts).toHaveLength(0);
    expect(of(a.w, PowderKeg)).toHaveLength(0);
  });

  it('a swing defuses it too, and a bullet-clear fizzles it', () => {
    const a = arena(3, 'f34-keg-clear');
    const k1 = a.w.withIds(() => PowderKeg.place(a.w, a.cx, a.cy, 0));
    a.step(2);
    expect(k1.takeHit(a.w, { damage: 5, kind: 'melee', attacker: a.p })).toBe(true);
    expect(k1.state).toBe('dud');
    const k2 = a.w.withIds(() => PowderKeg.place(a.w, a.cx + 40, a.cy, 0));
    a.step(2);
    a.w.clearEnemyBullets(a.cx, a.cy);
    expect(k2.state).toBe('dud');
  });

  it('keeps at most two kegs burning; a champion throws two at once; kegs outlive their porter', () => {
    const a = arena(3, 'f34-porter-max');
    const e = a.spawn('powder_porter', a.cx - 90, a.cy, true);
    e.speed = 0;
    const keep = pin(a, a.cx + 20, a.cy);
    let maxLive = 0;
    let maxLobs = 0;
    a.step(14 * 60, () => {
      keep();
      maxLive = Math.max(maxLive, of(a.w, PowderKeg).filter((k) => k.burning && k.owner === e.id).length);
      maxLobs = Math.max(maxLobs, of(a.w, Lob).length);
    });
    expect(maxLive).toBe(2);
    expect(maxLobs).toBe(2);
    // a keg on the floor when the porter dies still goes off
    for (let i = 0; i < 8 * 60 && !of(a.w, PowderKeg).some((k) => k.burning); i++) a.step(1, keep);
    const keg = of(a.w, PowderKeg).find((k) => k.burning)!;
    expect(keg).toBeDefined();
    a.w.killEnemy(e);
    const at = pin(a, keg.x + 20, keg.y);
    a.step(Math.round((KEG_FUSE + 0.3) * 60), at);
    expect(keg.state).toBe('boom');
  });
});

// ---------------------------------------------------------------- 고드름 사제
describe('고드름 사제 (icicle priest)', () => {
  it('chants, then calls a chain of icicles onto the keeper\'s path, one every ~0.32 s', () => {
    for (const champion of [false, true]) {
      const a = arena(4, `f34-priest-${champion}`);
      const e = a.spawn('icicle_priest', a.cx - 100, a.cy - 10, champion);
      e.speed = 0;
      // the keeper walks steadily to the right and back
      a.setMove((t) => [Math.sin(t * 2) > 0 ? 1 : -1, 0]);
      const drops: { id: number; t: number; x: number; y: number; px: number; py: number; vx: number }[] = [];
      const seen = new Set<number>();
      let chantAt = -1;
      a.step(9 * 60, () => {
        if (chantAt < 0 && e.anim === 'icepriest_chant') chantAt = a.w.time;
        for (const d of of(a.w, IcicleDrop)) {
          if (seen.has(d.id)) continue;
          seen.add(d.id);
          drops.push({ id: d.id, t: a.w.time, x: d.x, y: d.y, px: a.p.x, py: a.p.y, vx: a.p.vx });
        }
      });
      const n = champion ? 7 : 5;
      expect(drops.length).toBeGreaterThanOrEqual(n);
      const chain = drops.slice(0, n);
      expect(chain[0].t - chantAt).toBeGreaterThanOrEqual(0.58);
      for (let i = 1; i < n; i++) expect(chain[i].t - chain[i - 1].t).toBeCloseTo(ICICLE_GAP, 1);
      // each icicle is called where the keeper is (a little ahead of a moving keeper)
      for (const d of chain) {
        expect(Math.hypot(d.x - d.px, d.y - d.py)).toBeLessThanOrEqual(27);
        const open = d.px > a.room.interiorX + 40 && d.px < a.room.interiorX + a.room.interiorW - 40;
        if (open && Math.abs(d.vx) > 40) expect(Math.sign(d.x - d.px)).toBe(Math.sign(d.vx));
      }
      // the next chain only starts after a pause
      if (drops.length > n) expect(drops[n].t - chain[n - 1].t).toBeGreaterThan(1.5);
    }
  });

  it('an icicle hurts only inside its circle when it lands; the last one leaves black ice', () => {
    for (const [off, hit] of [[4, true], [ICICLE_R + 6, false]] as const) {
      const a = arena(4, `f34-icicle-${off}`);
      const keep = pin(a, a.cx + off, a.cy);
      const d = a.w.withIds(() => IcicleDrop.drop(a.w, a.cx, a.cy, true, '고드름 사제'));
      expect(d.warning).toBeInstanceOf(GroundWarning);
      const t0 = a.w.time;
      let hurtAt = -1;
      a.step(Math.round((ICICLE_WARN + 0.3) * 60), () => {
        keep();
        if (hurtAt < 0 && a.hurts.length) hurtAt = a.w.time - t0;
      });
      expect(a.hurts.length > 0).toBe(hit);
      if (hit) expect(hurtAt).toBeGreaterThanOrEqual(ICICLE_WARN - FIXED_DT * 2);
      const ice = of(a.w, FrostPatch);
      expect(ice).toHaveLength(1);
      expect(ice[0].x).toBeCloseTo(a.cx);
    }
  });

  it('only the last icicle of a chain leaves a frost patch', () => {
    const a = arena(4, 'f34-priest-patch');
    const e = a.spawn('icicle_priest', a.cx - 100, a.cy, false);
    e.speed = 0;
    const keep = pin(a, a.cx + 40, a.cy);
    let lastDrops = 0;
    let patches = 0;
    a.step(8 * 60, () => {
      keep();
      lastDrops = Math.max(lastDrops, of(a.w, IcicleDrop).filter((d) => d.last).length);
      patches = Math.max(patches, of(a.w, FrostPatch).length);
    });
    expect(lastDrops).toBe(1);
    expect(patches).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------- 눈보라 정령
describe('눈보라 정령 (blizzard spirit)', () => {
  function gustSetup(seed: string) {
    const a = arena(4, seed);
    const e = a.spawn('blizzard_spirit', a.cx - 90, a.cy - 20);
    let g: Whirlwind | undefined;
    for (let i = 0; i < 8 * 60 && !g; i++) {
      pin(a, a.cx + 40, a.cy + 10)();
      a.step();
      g = of(a.w, Whirlwind)[0];
    }
    return { a, e, g: g! };
  }

  it('conjures one whirlwind at a time over a floor warning, between itself and the keeper', () => {
    const { a, e, g } = gustSetup('f34-gust-form');
    expect(g).toBeDefined();
    expect(e.telegraphT).toBeGreaterThan(0);
    expect(g.warning).toBeInstanceOf(GroundWarning);
    expect(g.warning!.radius).toBe(GUST_R);
    expect(g.phase).toBe('form');
    const dSpirit = Math.hypot(g.x - e.x, g.y - e.y);
    const dKeeper = Math.hypot(g.x - a.p.x, g.y - a.p.y);
    expect(dSpirit).toBeGreaterThan(20);
    expect(dKeeper).toBeGreaterThan(20);
    let maxLive = 0;
    a.step(12 * 60, () => {
      a.p.x = a.cx + 60 * Math.cos(a.w.time);
      a.p.y = a.cy + 30 * Math.sin(a.w.time);
      maxLive = Math.max(maxLive, of(a.w, Whirlwind).filter((x) => x.owner === e && x.endAt < 0).length);
    });
    expect(maxLive).toBe(1);
  });

  it('drifts after the keeper at ~34 px/s, then dies down after its life', () => {
    const { a, g } = gustSetup('f34-gust-drift');
    const far = pin(a, a.room.interiorX + a.room.interiorW - 12, a.room.interiorY + 12);
    while (g.phase === 'form') a.step(1, far);
    const speeds: number[] = [];
    let closer = 0;
    let px = g.x;
    let py = g.y;
    let d0 = Math.hypot(a.p.x - g.x, a.p.y - g.y);
    for (let i = 0; i < 90; i++) {
      a.step(1, far);
      speeds.push(Math.hypot(g.x - px, g.y - py) / FIXED_DT);
      const d = Math.hypot(a.p.x - g.x, a.p.y - g.y);
      if (d < d0) closer++;
      d0 = d;
      px = g.x;
      py = g.y;
    }
    const avg = speeds.reduce((s, v) => s + v, 0) / speeds.length;
    expect(avg).toBeGreaterThan(GUST_SPEED * 0.8);
    expect(avg).toBeLessThanOrEqual(GUST_SPEED + 1e-6);
    expect(closer).toBeGreaterThan(70);
    a.step(Math.round(GUST_LIFE * 60), far);
    expect(g.dead || g.phase === 'fade').toBe(true);
  });

  it('touching it costs a half-heart and throws the keeper outward, once per cooldown', () => {
    const { a, g } = gustSetup('f34-gust-push');
    while (g.phase === 'form') a.step(1, pin(a, g.x + 60, g.y));
    a.setIframes(0);
    const hitsAt: number[] = [];
    let kb: [number, number] | null = null;
    for (let i = 0; i < 60; i++) {
      // the keeper stands just east of the funnel's centre
      a.p.x = g.x + 5;
      a.p.y = g.y;
      a.p.kbx = a.p.kby = 0;
      a.p.invuln = 0;
      const before = a.hurts.length;
      a.step();
      if (a.hurts.length > before) {
        hitsAt.push(a.w.time);
        kb ??= [a.p.kbx, a.p.kby];
      }
    }
    expect(hitsAt.length).toBeGreaterThanOrEqual(1);
    expect(hitsAt.length).toBeLessThanOrEqual(2);
    if (hitsAt.length === 2) expect(hitsAt[1] - hitsAt[0]).toBeGreaterThanOrEqual(GUST_COOLDOWN - 1e-6);
    expect(kb).not.toBeNull();
    expect(kb![0]).toBeGreaterThan(GUST_PUSH * 0.5);
    expect(Math.abs(kb![1])).toBeLessThan(GUST_PUSH * 0.5);
    // a dash goes straight through
    const { a: b, g: g2 } = gustSetup('f34-gust-dash');
    while (g2.phase === 'form') b.step(1, pin(b, g2.x + 60, g2.y));
    b.p.dashT = 0.2;
    b.p.x = g2.x + 3;
    b.p.y = g2.y;
    const n = b.hurts.length;
    b.step(1);
    expect(b.hurts.length).toBe(n);
  });

  it('flicks three snowflakes while the wind blows, and the wind dies with the spirit', () => {
    const { a, e, g } = gustSetup('f34-gust-flick');
    const volleys = new Map<number, number>();
    const seen = new Set<number>();
    const keep = pin(a, a.cx + 40, a.cy + 10);
    for (let i = 0; i < Math.round((GUST_FORM + GUST_LIFE) * 60); i++) {
      a.step(1, keep);
      for (const p of of(a.w, Projectile)) {
        if (p.team !== 'enemy' || seen.has(p.id)) continue;
        seen.add(p.id);
        volleys.set(a.w.time, (volleys.get(a.w.time) ?? 0) + 1);
      }
    }
    expect(volleys.size).toBeGreaterThanOrEqual(1);
    for (const n of volleys.values()) expect(n).toBe(3);
    // a new wind, then the spirit dies: it dies down
    let g2: Whirlwind | undefined;
    for (let i = 0; i < 8 * 60 && !g2; i++) {
      a.step(1, keep);
      g2 = of(a.w, Whirlwind).find((x) => x !== g && x.endAt < 0);
    }
    expect(g2).toBeDefined();
    a.w.killEnemy(e);
    a.step(2);
    expect(g2!.endAt).toBeGreaterThanOrEqual(0);
    a.step(40);
    expect(g2!.dead).toBe(true);
  });
});

// ---------------------------------------------------------------- draw purity
describe('new floor 3–4 enemies: drawing never changes the simulation', () => {
  for (const id of IDS) {
    it(`${id}: stateHash is unchanged by w.draw(1)`, () => {
      const a = arena(NEW[id], `f34-draw-${id}`);
      a.setMove((t) => [Math.cos(t * 1.1), Math.sin(t * 0.7)]);
      a.spawn(id, a.cx - 60, a.cy - 15, true);
      a.spawn(id, a.cx + 60, a.cy + 15);
      for (let i = 0; i < 420; i++) {
        a.w.update(FIXED_DT);
        const before = stateHash(a.w);
        a.w.draw(1);
        expect(stateHash(a.w), `${id} step ${i}`).toBe(before);
      }
    });
  }
});

// ---------------------------------------------------------------- lockstep determinism
describe('new floor 3–4 enemies: lockstep determinism', () => {
  for (const floor of [3, 4]) {
    it(`floor ${floor}: identical state hashes across fx seeds, particle density and drawing`, () => {
      const ids = IDS.filter((id) => NEW[id] === floor);
      const run = (fxSeed: number, drawEvery: number, particles: number): number[] => {
        fx.setState(new RNG(fxSeed).getState());
        const a = arena(floor, `f34-lockstep-${floor}`);
        a.w.setQuality({ particles });
        a.setMove((t) => [Math.cos(t * 1.3), Math.sin(t * 0.9)]);
        // the keeper fires at whatever is nearest (defusing kegs, popping wisps)
        const inp = a.w.inputSource!;
        a.w.inputSource = (ww, p, o) => {
          inp(ww, p, o);
          o.held = 1 | 2;
          const t = ww.enemies[0];
          o.cx = t ? t.x : p.x + 20;
          o.cy = t ? t.y : p.y;
        };
        ids.forEach((id, i) => a.spawn(id, a.cx + (i ? 70 : -70), a.cy - 20, i === 0));
        const out: number[] = [];
        for (let i = 0; i < 12 * 60; i++) {
          a.w.update(FIXED_DT);
          if (drawEvery && i % drawEvery === 0) a.w.draw(1);
          out.push(stateHash(a.w));
        }
        return out;
      };
      const base = run(1, 0, 1);
      const other = run(0x9e3779b9, 2, 0.25);
      const first = base.findIndex((h, i) => h !== other[i]);
      expect(first, `first diverging step`).toBe(-1);
    });
  }
});

// ---------------------------------------------------------------- online co-op
describe('new floor 3–4 enemies: online co-op lockstep', () => {
  for (const floor of [3, 4]) {
    it(`floor ${floor}: two keepers over the lockstep stay identical with the new enemies in the room`, () => {
      const ids = IDS.filter((id) => NEW[id] === floor);
      let spawned = 0;
      const attacks = new Set<string>();
      const res = runCoop({
        name: `f34 coop ${floor}`, seed: `F34-COOP-${floor}`, chars: ['ria', 'serin'], floor,
        ms: 30_000, link: { latencyMs: 30, jitterMs: 20 }, bossAt: 1e9, downAt: 0, leaveAt: 0, discardAt: 0, stayInRoom: true,
        extraStep(w, tick) {
          for (const x of w.entities) if (x instanceof WeldBeam || x instanceof PowderKeg || x instanceof IcicleDrop || x instanceof Whirlwind) attacks.add(x.constructor.name);
          // every few seconds, drop the pair (one a champion) into whatever room the party is in
          if (tick < 120 || tick % 420 !== 0 || w.transitioning) return;
          const r = w.room;
          w.withIds(() => ids.forEach((id, i) => {
            const e = w.spawnEnemy(id, r.interiorX + 30 + i * (r.interiorW - 60), r.interiorY + 30);
            if (e && i === 0) e.champion = true;
          }));
          spawned++;
        },
      });
      const ref = res.peers[0].hashes;
      expect(ref.length).toBeGreaterThan(1200);
      for (const p of res.peers) {
        expect(p.desyncs, `slot ${p.slot} desync`).toEqual([]);
        const n = Math.min(ref.length, p.hashes.length);
        let checked = 0;
        for (let t = 0; t < n; t++) {
          if (p.hashes[t] === undefined || ref[t] === undefined) continue;
          expect(p.hashes[t], `slot ${p.slot} tick ${t}`).toBe(ref[t]);
          checked++;
        }
        expect(checked).toBeGreaterThan(1000);
      }
      expect(spawned).toBeGreaterThan(2);
      expect([...attacks].sort()).toEqual(floor === 3 ? ['PowderKeg', 'WeldBeam'] : ['IcicleDrop', 'Whirlwind']);
    }, 120_000);
  }
});
