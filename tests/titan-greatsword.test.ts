import { describe, expect, it, vi } from 'vitest';
import { bestDps, DUMMY_ID, measureDps, PLAIN_ID } from './dpsharness';
import { Weapons } from '../src/game/defs';
import { FIXED_DT } from '../src/game/constants';
import { HELD } from '../src/game/seam';
import { Tile } from '../src/game/tiles';
import { MeleeSwing } from '../src/game/melee';
import { Projectile } from '../src/game/projectile';
import { stateHash } from '../src/game/statehash';

/** Real World + input path. The fixture only clears geometry and places dummies;
 * it never calls a weapon's update or writes charge/cooldown to stage an attack. */
function setup(distance = 80) {
  const { world: w, dummies } = measureDps({ character: PLAIN_ID, weapon: 'titan_greatsword', seconds: 0, dist: distance, seed: 'TITAN-REACH' });
  let held = false;
  w.inputSource = (_w, _p, out) => {
    out.mx = out.my = out.ax = out.ay = out.pressed = 0;
    out.held = held ? HELD.fire : 0;
  };
  for (let y = 2; y < w.room.h - 2; y++) for (let x = 2; x < w.room.w - 2; x++) w.room.setTile(x, y, Tile.FLOOR);
  const tick = (frames: number) => { for (let i = 0; i < frames; i++) w.update(FIXED_DT); };
  tick(90); // End the real room-entry and weapon-draw input locks.
  const p = w.player, target = dummies[0];
  p.x = 120; p.y = 104; p.aim = 0; p.stats.critChance = 0;
  target.x = p.x + distance; target.y = p.y - 3;
  const swings = vi.spyOn(p, 'swing');
  const charge = () => {
    held = true;
    let frames = 0;
    while (p.weapon.charge < 1 && frames < 120) { tick(1); frames++; }
    expect(p.weapon.charge).toBe(1);
    return frames;
  };
  const release = () => {
    const count = swings.mock.calls.length;
    held = false; tick(1);
    expect(swings.mock.calls.length).toBe(count + 1);
    return swings.mock.results.at(-1)!.value as MeleeSwing;
  };
  return { w, p, target, tick, charge, release, swings, fire: (value: boolean) => { held = value; } };
}

describe('titan greatsword enlarged reach through real combat', () => {
  it('holds its completed charge, reaches an 80px target once, and retains its damage and recovery', () => {
    const s = setup(80), hp = s.target.hp;
    expect(s.p.stats.damage).toBeCloseTo(9.8);
    expect(s.p.stats.fireRate).toBeCloseTo(1.82);
    const frames = s.charge();
    expect(frames * FIXED_DT).toBeGreaterThanOrEqual(.85);
    expect(frames * FIXED_DT).toBeLessThanOrEqual(.89);
    s.tick(10);
    expect(s.swings).not.toHaveBeenCalled();
    expect(s.target.hp).toBe(hp);
    const sw = s.release();
    expect(sw.o.damage).toBeCloseTo(s.p.stats.damage * 3);
    expect(sw.o.duration).toBe(.12);
    expect(sw.o.visual).toBe(.26);
    expect(s.p.weapon.cooldown).toBeCloseTo(.45 / s.p.stats.fireRate);
    s.tick(20);
    expect(sw.hits).toBe(1);
    expect(sw.hitIds.has(s.target.id)).toBe(true);
    expect(hp - s.target.hp).toBeCloseTo(s.p.stats.damage * 3);
    expect(s.swings).toHaveBeenCalledTimes(1);
  });

  it('still misses a 105px target after the full active window', () => {
    const s = setup(105), hp = s.target.hp;
    s.charge(); const sw = s.release(); s.tick(20);
    expect(sw.hits).toBe(0);
    expect(s.target.hp).toBe(hp);
  });

  it('a short tap reaches 65px with the original tap damage and attack interval', () => {
    const s = setup(65), hp = s.target.hp;
    s.fire(true); s.tick(4);
    expect(s.p.weapon.charge).toBeGreaterThan(0);
    expect(s.p.weapon.charge).toBeLessThan(.35);
    const sw = s.release();
    expect(sw.o.arc).toBeCloseTo(2.4);
    expect(sw.o.duration).toBe(.09);
    expect(s.p.weapon.cooldown).toBeCloseTo(1 / s.p.stats.fireRate);
    s.tick(20);
    expect(sw.hits).toBe(1);
    expect(hp - s.target.hp).toBeCloseTo(s.p.stats.damage * 1.4);
  });

  it.each([['wall', Tile.WALL], ['rock', Tile.ROCK], ['metal block', Tile.BLOCK]] as const)(
    '%s shields enemies and bullets while the unobstructed half of the same spin still hits and reflects', (_name, tile) => {
      const s = setup(80), blockedHp = s.target.hp;
      for (let y = 2; y < s.w.room.h - 2; y++) s.w.room.setTile(10, y, tile);
      const open = s.w.withIds(() => s.w.spawnEnemy(DUMMY_ID, 55, 101))!;
      open.dormant = 0;
      const openHp = open.hp;
      s.charge();
      const bullet = (x: number) => s.w.withIds(() => s.w.spawn(new Projectile({ team: 'enemy', x, y: 120, angle: 0, speed: 0, damage: 1, life: 5 })));
      const hiddenBullet = bullet(190), exposedBullet = bullet(65);
      const sw = s.release(); s.tick(3);
      expect(s.target.hp).toBe(blockedHp);
      expect(sw.hitIds.has(s.target.id)).toBe(false);
      expect(openHp - open.hp).toBeCloseTo(s.p.stats.damage * 3);
      expect(hiddenBullet.dead).toBe(false);
      expect(hiddenBullet.team).toBe('enemy');
      expect(hiddenBullet.damage).toBe(1);
      expect(exposedBullet.team).toBe('player');
      expect(exposedBullet.owner).toBe(s.p);
      expect(exposedBullet.damage).toBeCloseTo(s.p.stats.damage * .4);
    },
  );

  it('pit tiles do not obstruct the enlarged blade', () => {
    const s = setup(80), hp = s.target.hp;
    for (let y = 2; y < s.w.room.h - 2; y++) s.w.room.setTile(10, y, Tile.PIT);
    s.charge(); const sw = s.release(); s.tick(15);
    expect(sw.hits).toBe(1);
    expect(s.target.hp).toBeLessThan(hp);
  });

  it('breaks an exposed pot without damaging a wall or the pot behind it', () => {
    const s = setup(105);
    for (let y = 2; y < s.w.room.h - 2; y++) s.w.room.setTile(10, y, Tile.WALL);
    s.w.room.setTile(9, 6, Tile.POT);
    s.w.room.setTile(12, 6, Tile.POT);
    const hiddenHp = s.w.room.tileHp[6 * s.w.room.w + 12];
    s.charge(); s.release(); s.tick(15);
    expect(s.w.room.tileAt(9, 6)).toBe(Tile.RUBBLE);
    expect(s.w.room.tileAt(10, 6)).toBe(Tile.WALL);
    expect(s.w.room.tileAt(12, 6)).toBe(Tile.POT);
    expect(s.w.room.tileHp[6 * s.w.room.w + 12]).toBe(hiddenHp);
  });

  it('clips the rendered sweep at the same wall without changing the simulation or leaking its canvas clip', () => {
    const s = setup(80);
    for (let y = 2; y < s.w.room.h - 2; y++) s.w.room.setTile(10, y, Tile.WALL);
    s.charge(); const sw = s.release(); s.tick(2);
    const ctx = s.w.renderer.ctx;
    // The headless canvas provides these methods through a Proxy, so install
    // recorders directly instead of spying on nonexistent own descriptors.
    const original = { moveTo: ctx.moveTo, lineTo: ctx.lineTo, clip: ctx.clip, save: ctx.save, restore: ctx.restore };
    const move = vi.fn<(x: number, y: number) => void>(), line = vi.fn<(x: number, y: number) => void>();
    const clip = vi.fn(), save = vi.fn(), restore = vi.fn();
    Object.assign(ctx, { moveTo: move, lineTo: line, clip, save, restore });
    const hash = stateHash(s.w), rng = s.w.rng.snapshot();
    try {
      sw.draw(s.w.renderer, s.w);
      expect(clip).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledTimes(restore.mock.calls.length);
      const vertices = [...move.mock.calls, ...line.mock.calls];
      expect(vertices.length).toBeGreaterThan(32);
      const xs = vertices.map(([x]) => x + s.w.renderer.viewX);
      expect(Math.max(...xs)).toBeLessThanOrEqual(160);
      expect(Math.min(...xs)).toBeLessThan(s.p.x - 60);
      expect(stateHash(s.w)).toBe(hash);
      expect(s.w.rng.snapshot()).toEqual(rng);
    } finally {
      Object.assign(ctx, original);
    }
  });

  it('actually acquiring range relics makes a previously unreachable enemy hittable', () => {
    const attempt = (withRelics: boolean) => {
      const s = setup();
      // A rear target cannot be reached accidentally by the attack's forward lunge.
      s.p.x = 168; s.target.x = s.p.x - 95;
      if (withRelics) for (let i = 0; i < 3; i++) s.w.items.give('jade_marble');
      s.p.stats.critChance = 0;
      const hp = s.target.hp;
      s.charge(); const sw = s.release(); s.tick(15);
      return { damage: hp - s.target.hp, range: s.p.stats.range, sw };
    };
    const plain = attempt(false), enhanced = attempt(true);
    expect(plain.damage).toBe(0);
    expect(enhanced.range).toBeGreaterThan(plain.range);
    expect(enhanced.damage).toBeGreaterThan(0);
    expect(enhanced.sw.hits).toBe(1);
  });

  it('keeps opt-in wall handling from changing legacy melee swings', () => {
    const s = setup(65), hp = s.target.hp;
    for (let y = 2; y < s.w.room.h - 2; y++) s.w.room.setTile(10, y, Tile.WALL);
    // Existing weapons omit respectWalls. Keep their prior collision behavior.
    const sw = s.w.withIds(() => s.p.swing(s.w, { angle: 0, arc: Math.PI, reach: 80, damage: 10 }));
    s.tick(12);
    expect(sw.hits).toBe(1);
    expect(s.target.hp).toBeLessThan(hp);
  });

  it('uses integer 2x blade art in idle, charge, full-charge, spin, tap and recovery without changing state', () => {
    const s = setup(105), draw = vi.spyOn(s.w.renderer, 'sprite');
    const check = (label: string) => {
      draw.mockClear();
      const hash = stateHash(s.w), rng = s.w.rng.snapshot();
      s.p.draw(s.w.renderer, s.w);
      const sword = draw.mock.calls.filter(args => args[0] === 'w_titan_sword');
      expect(sword, label).toHaveLength(1);
      expect(sword[0][3]?.sx, label).toBe(2);
      expect(sword[0][3]?.sy, label).toBe(2);
      expect(stateHash(s.w), label).toBe(hash);
      expect(s.w.rng.snapshot(), label).toEqual(rng);
    };
    try {
      check('idle');
      s.fire(true); s.tick(12); check('charging');
      s.charge(); check('full charge');
      s.release(); s.tick(2); check('spin');
      s.tick(25); check('spin recovery');
      s.fire(true); s.tick(4); s.release(); check('tap');
      s.tick(8); check('tap follow-through');
      s.tick(10); check('tap recovery');
    } finally { draw.mockRestore(); }
  });

  it('retains the existing single-target and crowd DPS caps', () => {
    const base = bestDps(PLAIN_ID, 'lantern_bolt');
    const single = bestDps(PLAIN_ID, 'titan_greatsword');
    const crowd = bestDps(PLAIN_ID, 'titan_greatsword', true);
    const baseCrowd = bestDps(PLAIN_ID, 'lantern_bolt', true);
    expect(single / base).toBeGreaterThanOrEqual(.85);
    expect(single / base).toBeLessThanOrEqual(1.35);
    expect(crowd / baseCrowd).toBeLessThanOrEqual(6.5);
    expect(Weapons.must('titan_greatsword').rarity).toBe('epic');
  });
});
