// Engine polish / game feel: particle pooling & caps, damage-number merging,
// bullet clearing of non-projectile hazards, positional pan, and the
// time-sliced (deterministic) room background pre-render.

import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Particles, MAX_PARTICLES } from '../src/engine/particles';
import { DamageNumber, FloatingText, GroundWarning } from '../src/game/effects';
import { World } from '../src/game/world';
import { Projectile } from '../src/game/projectile';
import { Entity } from '../src/game/entity';
import { Hazard, Lob } from '../src/content/enemies/shared';
import { Floors, RoomTemplates, Themes } from '../src/game/defs';
import { Room } from '../src/game/room';
import { renderRoomPainter, roomBaseJob, roomBaseReady } from '../src/game/roomart';
import { SHAPE_CELLS } from '../src/game/constants';
import { RNG } from '../src/engine/rng';

loadContent();

type Proto = Record<string, (...a: unknown[]) => unknown>;
const proto = World.prototype as unknown as Proto;

describe('particles', () => {
  it('never exceed the cap (recycling the oldest) and scale the cap with density', () => {
    const ps = new Particles();
    for (let i = 0; i < 40; i++) ps.burst(0, 0, { count: 100, speed: [10, 20], life: [1, 2], colors: ['#ffffff'] });
    expect(ps.list.length).toBe(MAX_PARTICLES);
    ps.density = 0.5;
    ps.clear();
    for (let i = 0; i < 40; i++) ps.burst(0, 0, { count: 100, speed: [10, 20], life: [1, 2], colors: ['#ffffff'] });
    expect(ps.list.length).toBeLessThanOrEqual(ps.cap);
    expect(ps.cap).toBe(MAX_PARTICLES / 2);
  });

  it('thins out single spawns at low density and reuses dead particles', () => {
    const ps = new Particles();
    ps.density = 0.25;
    for (let i = 0; i < 2000; i++) ps.spawn({ x: 0, y: 0, life: 0.1, colors: ['#ffffff'] });
    expect(ps.list.length).toBeGreaterThan(300);
    expect(ps.list.length).toBeLessThan(700);
    const used = new Set(ps.list);
    ps.update(0.2); // all die -> pooled
    expect(ps.list.length).toBe(0);
    ps.density = 1;
    ps.spawn({ x: 5, y: 6, life: 1, colors: ['#ff0000'], light: 4 });
    expect(ps.list.length).toBe(1);
    expect(used.has(ps.list[0])).toBe(true);
    // light color is resolved once at spawn
    expect(ps.list[0].lightColor).toBe('#ff0000');
    expect(ps.list[0].age).toBe(0);
  });
});

describe('damage numbers', () => {
  it('accumulate merged hits and expire after the hits stop', () => {
    const n = new DamageNumber(null, 10, 10, 4);
    n.add(3);
    n.add(2.4);
    expect(n.text).toBe('9');
    expect(n.hits).toBe(3);
    const w = {} as World;
    let t = 0;
    while (!n.dead && t < 3) {
      n.update(w, 1 / 60);
      t += 1 / 60;
    }
    expect(n.dead).toBe(true);
    expect(t).toBeGreaterThan(0.5);
    expect(t).toBeLessThan(1.2);
  });

  function fakeWorld() {
    const spawned: Entity[] = [];
    return {
      spawned,
      dmgNums: new Map(),
      spawn<T extends Entity>(e: T): T {
        spawned.push(e);
        return e;
      },
    };
  }
  const enemy = { id: 7, x: 50, y: 60, r: 6, z: 0, dead: false } as unknown as Entity;

  it('merge rapid hits on one enemy; crits stay separate; DoT colors get their own number', () => {
    const fw = fakeWorld();
    const hit = (o: object, dmg: number) => proto.damageNumber.call(fw, enemy, { damage: dmg, kind: 'projectile', ...o }, dmg);
    hit({}, 5);
    hit({}, 5);
    hit({}, 5);
    hit({ crit: true }, 12);
    hit({ kind: 'status', procs: ['burn'] }, 2);
    hit({ kind: 'status', procs: ['burn'] }, 2);
    const nums = fw.spawned.filter((e) => e instanceof DamageNumber) as DamageNumber[];
    const crits = fw.spawned.filter((e) => e instanceof FloatingText) as FloatingText[];
    expect(nums.length).toBe(2);
    expect(nums[0].text).toBe('15');
    expect(nums[1].text).toBe('4');
    expect(crits.length).toBe(1);
    expect(crits[0].text).toBe('12!');
    expect(crits[0].scale).toBe(2);
  });

  it('start a new number once the merge window has passed', () => {
    const fw = fakeWorld();
    const hit = () => proto.damageNumber.call(fw, enemy, { damage: 3, kind: 'projectile' }, 3);
    hit();
    const first = fw.spawned[0] as DamageNumber;
    for (let i = 0; i < 20; i++) first.update({} as World, 1 / 60); // 0.33 s
    hit();
    expect(fw.spawned.length).toBe(2);
  });
});

describe('bullet clearing', () => {
  function fakeWorld() {
    const sounds: string[] = [];
    const w = {
      projectiles: [] as Projectile[],
      entities: [] as Entity[],
      pending: [] as Entity[],
      particles: { burst() {}, spawn() {} },
      sfx(n: string) { sounds.push(n); },
      spawn<T extends Entity>(e: T): T {
        w.pending.push(e);
        return e;
      },
    };
    return w;
  }

  it('clears enemy projectiles and enemyHazard entities in range only', () => {
    const w = fakeWorld();
    const W = w as unknown as World;
    const mk = (x: number, team: 'enemy' | 'player' = 'enemy') => new Projectile({ team, x, y: 0, angle: 0, speed: 0, damage: 1 });
    const near = mk(10);
    const far = mk(500);
    const mine = mk(5, 'player');
    w.projectiles.push(near, far, mine);
    w.entities.push(near, far, mine);
    const fresh = mk(12); // spawned this frame: still pending
    w.pending.push(fresh);
    const warning = new GroundWarning(40, 0, 12, 0.9);
    const lob = new Lob(0, 0, 40, 0, { sprite: 'x', color: '#ff8040' });
    lob.warning = warning;
    const puddle = new Hazard(20, 0, 12, 4, 'poison', 'test');
    puddle.age = 1;
    const farPuddle = new Hazard(400, 0, 12, 4, 'fire', 'test');
    w.entities.push(warning, lob, puddle, farPuddle);

    const n = proto.clearEnemyBullets.call(w, 0, 0, 100) as number;
    expect(n).toBe(4);
    expect(near.dead && fresh.dead).toBe(true);
    expect(far.dead || mine.dead).toBe(false);
    expect(lob.dead && warning.dead).toBe(true);
    // puddles fade out quickly and stop being hazards
    expect(puddle.dead).toBe(false);
    expect(puddle.enemyHazard).toBe(false);
    expect(puddle.life).toBeCloseTo(1.25);
    expect(farPuddle.enemyHazard).toBe(true);
    // a second clear does not count the fading puddle again
    expect(proto.clearEnemyBullets.call(w, 0, 0, 100)).toBe(0);
    // whole-room clear
    expect(proto.clearEnemyBullets.call(w, 0, 0)).toBe(2);
    void W;
  });
});

describe('positional sound pan', () => {
  it('is subtle, centered on the camera and clamped', () => {
    const w = { renderer: { camX: 100 } };
    const pan = (x: number) => proto.panAt.call(w, x) as number;
    expect(pan(100 + 192)).toBe(0);
    expect(pan(100)).toBeCloseTo(-0.6);
    expect(pan(100 + 384)).toBeCloseTo(0.6);
    expect(pan(-1000)).toBeCloseTo(-0.6);
    expect(pan(100 + 192 + 96)).toBeCloseTo(0.3);
  });
});

describe('room background pre-render', () => {
  const theme = Themes.must(Floors.all()[1].theme);
  const tpl = RoomTemplates.all().find((t) => SHAPE_CELLS[t.shape][0] === 2 && SHAPE_CELLS[t.shape][1] === 2) ?? RoomTemplates.all()[0];
  const [cw, ch] = SHAPE_CELLS[tpl.shape];
  const mkNode = () => ({ id: 3, gx: 0, gy: 0, cw, ch, kind: tpl.kinds[0], templateId: tpl.id, seed: 98765, depth: 1, visited: false, cleared: false, discovered: false, locked: false, doors: [] });
  const mkRoom = (node: ReturnType<typeof mkNode>) => {
    const room = new Room(node as never, theme, tpl);
    room.addDoor('N', 0, 0, 1, 'normal', false);
    room.addDoor('W', 0, 0, 2, 'treasure', false);
    return room;
  };

  it('is time-sliced, cached per node and pixel-identical to a direct render', () => {
    const direct = renderRoomPainter(mkRoom(mkNode()));
    const node = mkNode();
    const job = roomBaseJob(mkRoom(node));
    let steps = 0;
    // interleave gameplay-RNG use: the pre-render must not depend on / consume it
    const gameplay = new RNG(42);
    const before = new RNG(42);
    while (!job.next().done) steps++;
    expect(steps).toBeGreaterThan(10);
    expect(gameplay.next()).toBe(before.next());
    // a fresh Room for the same node (what entering builds) finds the base ready
    const entered = mkRoom(node);
    expect(roomBaseReady(entered)).toBe(true);
    const pre = renderRoomPainter(entered);
    expect(pre.data.length).toBe(direct.data.length);
    let diff = 0;
    for (let i = 0; i < pre.data.length; i++) if (pre.data[i] !== direct.data[i]) diff++;
    expect(diff).toBe(0);
    // already warm: a new job finishes immediately
    expect(roomBaseJob(mkRoom(node)).next().done).toBe(true);
  }, 30000);
});
