import './headless';
import { describe, expect, it } from 'vitest';
import { measureDps, DUMMY_ID } from './dpsharness';
import { FIXED_DT } from '../src/game/constants';
import { Projectile } from '../src/game/projectile';
import { RefugeCharge, REFUGE_DASHES } from '../src/content/characters/refuge-kits';
import { RefugeRelease } from '../src/content/characters/refuge-release';
import { stateHash } from '../src/game/statehash';
import type { World } from '../src/game/world';
import type { Enemy } from '../src/game/enemy';

// Each refuge keeper's release does a different thing to the fight (its verb),
// on top of the same ~11x single-target budget that refuge-expansion checks.

const sim = (id: string, dist = 55) => {
  const r = measureDps({ character: id, weapon: 'lantern_bolt', seconds: 0, dist });
  idle(r.world, 1);
  r.world.player.stats.critChance = 0;
  r.world.player.aim = 0;
  return r;
};
function idle(w: World, n: number): void {
  w.inputSource = (_w, _p, o) => { o.mx = o.my = o.ax = o.ay = o.held = o.pressed = 0; };
  for (let i = 0; i < n; i++) w.update(FIXED_DT);
}
const release = (w: World) => w.withIds(() => w.player.character.release!(w, w.player));
const dummy = (w: World, x: number, y: number): Enemy => {
  const e = w.spawnEnemy(DUMMY_ID, x, y)!;
  e.dormant = 0;
  return e;
};
const lost = (e: Enemy, hp: number, base: number) => (hp - e.hp) / base;

describe('refuge keeper verbs', () => {
  it('토브: every enemy in sight gets a charge (a crowd shares 40x, 11x cap each); none outside 170 px', () => {
    const { world: w, dummies } = sim('tove');
    const p = w.player, base = p.stats.damage;
    const near = [dummies[0], dummy(w, p.x + 90, p.y - 40), dummy(w, p.x + 30, p.y + 60)];
    const far = dummy(w, p.x, p.y);
    idle(w, 1);
    far.x = p.x - 190; far.y = p.y;
    const hp = near.map(e => e.hp), farHp = far.hp;
    p.ember = 0;
    release(w);
    idle(w, 120);
    // three targets: min(11, 40 / 3) = 11 each
    for (const [i, e] of near.entries()) expect(lost(e, hp[i], base), 'target ' + i).toBeCloseTo(11, 5);
    expect(far.hp).toBe(farHp);
    expect(p.ember).toBe(0);
  });

  it('토브: a crowd of five shares the 40x budget instead of 11x each', () => {
    const { world: w, dummies } = sim('tove');
    const p = w.player, base = p.stats.damage;
    const all = [dummies[0], ...[[18, 0], [-18, 0], [0, 18], [0, -18]].map(([dx, dy]) => dummy(w, dummies[0].x + dx, dummies[0].y + dy))];
    idle(w, 1);
    const hp = all.map(e => e.hp);
    release(w);
    idle(w, 120);
    const total = all.reduce((sum, e, i) => sum + lost(e, hp[i], base), 0);
    expect(total).toBeCloseTo(40, 4);
  });

  it('토브: charges and mines already placed go off first at double power', () => {
    const { world: w, dummies } = sim('tove');
    const p = w.player;
    w.withIds(() => REFUGE_DASHES[0].start!(w, p));
    idle(w, 2);
    const mine = w.entities.find(e => e instanceof RefugeCharge && e.mem.mine) as RefugeCharge;
    const damage = mine.mem.damage;
    // a clustered pair so the primed mine has someone to hit
    mine.x = dummies[0].x; mine.y = dummies[0].y;
    release(w);
    idle(w, 1);
    expect(mine.mem.damage).toBeCloseTo(damage * 2);
    idle(w, 12);
    expect(mine.mem.fired).toBe(1);
  });

  it('루엔: movable targets are hauled to the knot and bound; immovable ones are not', () => {
    const { world: w, dummies } = sim('luen', 60);
    const p = w.player;
    const rat = w.spawnEnemy('grave_rat', p.x + 60, p.y + 70)!;
    rat.dormant = 0;
    idle(w, 1);
    rat.hp = 1e6;
    const knot = { x: dummies[0].x, y: dummies[0].y };
    w.inputSource = (_w, pl, o) => { o.mx = o.my = o.ax = o.ay = o.pressed = 0; o.held = 2; o.cx = knot.x; o.cy = knot.y; };
    w.update(FIXED_DT);
    const before = Math.hypot(rat.x - knot.x, rat.y - knot.y);
    release(w);
    for (let i = 0; i < 30; i++) w.update(FIXED_DT);
    expect(Math.hypot(rat.x - knot.x, rat.y - knot.y)).toBeLessThan(before * .5);
    expect(rat.hasStatus('stun')).toBe(true);
    expect(Math.hypot(dummies[0].x - knot.x, dummies[0].y - knot.y)).toBeLessThan(1);
  });

  it('베스: blinks behind targets, is invulnerable meanwhile, and still lunges with nobody around', () => {
    const { world: w, dummies } = sim('ves');
    const p = w.player, start = p.x;
    release(w);
    expect(p.invuln).toBeGreaterThan(1);
    for (let i = 0; i < 16; i++) w.update(FIXED_DT);
    // first strike landed Ves past the dummy
    expect(p.x).toBeGreaterThan(dummies[0].x);
    idle(w, 120);
    const empty = sim('ves');
    for (const e of [...empty.world.enemies]) empty.world.killEnemy(e);
    idle(empty.world, 1);
    const x0 = empty.world.player.x;
    release(empty.world);
    idle(empty.world, 20);
    expect(empty.world.player.x).toBeGreaterThan(x0 + 20);
    expect(start).toBeLessThan(dummies[0].x);
  });

  it('베스: a dash cuts every enemy it passes through once', () => {
    const { world: w, dummies } = sim('ves', 30);
    const p = w.player, hp = dummies[0].hp;
    p.dashX0 = p.x - 10; p.dashY0 = p.y;
    p.x = dummies[0].x + 20;
    w.withIds(() => REFUGE_DASHES[2].end!(w, p));
    expect(lost(dummies[0], hp, p.stats.damage)).toBeCloseTo(.8, 5);
  });

  it('오르트: shots striking the tower shield are returned at the enemy ahead', () => {
    const { world: w, dummies } = sim('ort', 80);
    const p = w.player, base = p.stats.damage;
    p.ember = 0;
    release(w);
    idle(w, 20);
    const hp = dummies[0].hp;
    const shots = [0, 1, 2].map(i => w.spawn(new Projectile({ team: 'enemy', x: p.x + 50, y: p.y - 6 + i * 6, angle: Math.PI, speed: 120, damage: 1, range: 260 })));
    idle(w, 30);
    expect(shots.every(s => s.dead)).toBe(true);
    expect(lost(dummies[0], hp, base)).toBeCloseTo(3 * 1.2, 5);
    expect(p.ember).toBe(0);
  });

  it('오르트: blocking with the passive shield fills the ember gauge a little', () => {
    const { world: w } = sim('ort', 200);
    const p = w.player;
    idle(w, 3);
    p.ember = 0;
    w.spawn(new Projectile({ team: 'enemy', x: p.x + 40, y: p.y, angle: Math.PI, speed: 120, damage: 1, range: 260 }));
    idle(w, 30);
    expect(p.ember).toBeGreaterThan(3.9);
    expect(p.ember).toBeLessThan(6);
  });

  it('미라: enemies inside freeze, their shots stand still, and her own hits inside are paid back on closing', () => {
    const { world: w, dummies } = sim('mira', 65);
    const p = w.player, base = p.stats.damage;
    const rat = w.spawnEnemy('grave_rat', p.x + 70, p.y + 10)!;
    rat.dormant = 0;
    idle(w, 1);
    rat.hp = 1e6;
    release(w);
    idle(w, 6);
    expect(rat.hasStatus('freeze')).toBe(true);
    const shot = w.spawn(new Projectile({ team: 'enemy', x: p.x + 70, y: p.y - 10, angle: Math.PI, speed: 120, damage: 1, range: 400 }));
    idle(w, 3);
    const x = shot.x;
    idle(w, 20);
    expect(shot.x).toBeCloseTo(x, 3);
    const stasis = w.entities.find(e => e instanceof RefugeRelease) as RefugeRelease;
    const hp = dummies[0].hp;
    stasis.record(w, dummies[0], base * 10);
    idle(w, 120);
    // 4 pulses already landed partly; check the closing paid the stored 30% (cap 6x) on top
    expect(lost(dummies[0], hp, base)).toBeGreaterThan(8 + 3 - .01);
  });

  it('the redesigned releases keep drawing pure and owner-bound', () => {
    for (const id of ['tove', 'luen', 'ves', 'ort', 'mira']) {
      const { world: w } = sim(id);
      release(w);
      for (let i = 0; i < 100; i++) {
        w.update(FIXED_DT);
        const before = stateHash(w);
        w.draw(1);
        expect(stateHash(w), id + ' ' + i).toBe(before);
      }
    }
  });
});
