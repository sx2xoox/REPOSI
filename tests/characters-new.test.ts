// The three newer keepers — 보리 (rescue-dog tank), 백구 (counter master), 모리
// (herder): registration & art, each kit's mechanics in the real World (training
// dummies, scripted input through the lockstep seam), release damage inside the
// 10–15x band, starter weapon DPS inside the compressed band, unlock rules.

import './headless';
import { describe, expect, it } from 'vitest';
import { Characters, Enemies, Weapons, weaponMatchesAffinity } from '../src/game/defs';
import { FIXED_DT } from '../src/game/constants';
import { EMBER_MAX } from '../src/game/player';
import { PRESS, HELD, type PlayerInput } from '../src/game/seam';
import { Projectile } from '../src/game/projectile';
import { Pickup } from '../src/game/pickups';
import { validateSpec } from '../src/content/characters/look';
import { BORI } from '../src/content/characters/bori';
import { BAEKGU } from '../src/content/characters/baekgu';
import { MORI } from '../src/content/characters/mori';
import { BORI_BLOCK_CHARGE, BORI_MASS, BodyBlock, RescuePuddle, addBarrel, barrel } from '../src/content/characters/kit-bori';
import { BAEKGU_COUNTER_DMG, BAEKGU_SLOW_SCALE, BAEKGU_WINDOW_AFFINITY, BAEKGU_WINDOW_CURSOR, BAEKGU_WINDOW_STICK, dodgeWindow, inCounter } from '../src/content/characters/kit-baekgu';
import { MORI_GROUP_BONUS, MORI_SHEEP, MORI_SHEEP_AFFINITY, SpiritSheep, herdPoint, isGrouped, penActive } from '../src/content/characters/kit-mori';
import { BORI_UNLOCK_DEATHS, MORI_UNLOCK_KILLS, boriUnlockDue, bossUnlocksBaekgu, moriUnlockDue } from '../src/content/characters/unlocks';
import { familiarsOf } from '../src/content/items/lib';
import { characterKitRows, characterStats } from '../src/ui/logic';
import { getAnim, hasAnim, hasSprite } from '../src/engine/sprites';
import { SFX_NAMES, hasSfx } from '../src/audio/audio';
import { PLAIN_ID, bestDps, measureDps } from './dpsharness';
import type { World } from '../src/game/world';
import type { Enemy } from '../src/game/enemy';

const NEW = ['bori', 'baekgu', 'mori'] as const;
const HANGUL = /[가-힣]/;

function spriteOrAnim(name: string): boolean {
  if (hasAnim(name)) return getAnim(name)!.frames.every((f) => hasSprite(f));
  return hasSprite(name);
}

/** A started world (floor-1 start room, dummies placed) with no input yet, and its center dummy. */
function sim(character: string, weapon: string, dist?: number, crowd = false): { w: World; dummy: Enemy } {
  const r = measureDps({ character, weapon, seconds: 0, dist, crowd });
  return { w: r.world, dummy: r.dummies[0] };
}

/** Step `steps` frames feeding `fn`'s input (dash presses, movement, fire). */
function drive(w: World, steps: number, fn: (out: PlayerInput, i: number) => void = () => {}): void {
  let step = 0;
  w.inputSource = (_ww, _p, out) => {
    out.mx = out.my = out.ax = out.ay = 0;
    out.held = 0;
    out.pressed = 0;
    out.cx = w.player.x + 40;
    out.cy = w.player.y;
    fn(out, step);
  };
  for (; step < steps; step++) w.update(FIXED_DT);
}

/** An enemy bullet flying from (x, y) toward the keeper. */
function bulletAt(w: World, x: number, y: number, speed = 150): Projectile {
  const p = w.player;
  const pr = new Projectile({ team: 'enemy', x, y, angle: Math.atan2(p.y - 4 - y, p.x - x), speed, damage: 1, radius: 3, range: 600 });
  w.spawn(pr);
  return pr;
}

// ====================================================================== registration
describe('new keepers: registration, art, text', () => {
  it('registers 보리 / 백구 / 모리 after the first four, locked, with valid weapons and hints', () => {
    const ids = Characters.all().map((c) => c.id);
    expect(ids.slice(0, 7)).toEqual(['ria', 'bern', 'serin', 'niel', 'bori', 'baekgu', 'mori']);
    for (const id of NEW) {
      const c = Characters.must(id);
      expect(c.unlocked, id).toBe(false);
      expect(c.unlockHint).toMatch(HANGUL);
      expect(Weapons.has(c.weapon), `${id} weapon`).toBe(true);
      expect(c.release).toBeTypeOf('function');
      expect(c.releaseName).toMatch(HANGUL);
      expect(c.releaseDesc).toMatch(HANGUL);
      expect(c.pitch).toMatch(HANGUL);
      expect(c.playstyle?.length ?? 0).toBeGreaterThanOrEqual(3);
      expect([1, 2, 3]).toContain(c.difficulty);
      expect(c.passive!.desc.length, `${id} passive desc fits the select strip`).toBeLessThanOrEqual(56);
      expect(hasSprite(c.passive!.icon)).toBe(true);
      expect(hasSprite(c.dash!.icon ?? '')).toBe(true);
      for (const row of characterKitRows(c)) expect(row.desc).toMatch(HANGUL);
      expect(characterStats(c).maxHearts).toBe(c.hearts);
    }
    // the roster has a tank, a glass cannon and a summoner
    expect(Characters.must('bori').hearts).toBeGreaterThan(Characters.must('bern').hearts);
    expect(Characters.must('baekgu').hearts).toBe(2);
    expect(Characters.must('bori').coop).toEqual({ reviveSpeed: 2, reviveHearts: 2 });
  });

  it('ASCII poses are well-formed and every animation the renderer wants exists', () => {
    for (const spec of [BORI, BAEKGU, MORI]) expect(validateSpec(spec), spec.prefix).toEqual([]);
    for (const id of NEW) {
      const c = Characters.must(id);
      for (const f of ['down', 'up', 'side']) {
        expect(spriteOrAnim(`${c.spritePrefix}_idle_${f}`)).toBe(true);
        expect(spriteOrAnim(`${c.spritePrefix}_walk_${f}`)).toBe(true);
        expect(spriteOrAnim(`${c.spritePrefix}_dash_${f}`)).toBe(true);
      }
      expect(spriteOrAnim(`${c.spritePrefix}_hurt`)).toBe(true);
      expect(hasSprite(c.portrait)).toBe(true);
    }
  });

  it('starter weapons are tagged for their keeper\'s affinity and carry art', () => {
    expect(weaponMatchesAffinity(Characters.must('bori').affinity, Weapons.must('lantern_flail'))).toBe(true);
    expect(weaponMatchesAffinity(Characters.must('bori').affinity, Weapons.must('great_hammer'))).toBe(true);
    expect(weaponMatchesAffinity(Characters.must('bori').affinity, Weapons.must('lantern_bolt'))).toBe(false);
    expect(weaponMatchesAffinity(Characters.must('baekgu').affinity, Weapons.must('fang_blade'))).toBe(true);
    expect(weaponMatchesAffinity(Characters.must('baekgu').affinity, Weapons.must('twin_daggers'))).toBe(true);
    expect(weaponMatchesAffinity(Characters.must('baekgu').affinity, Weapons.must('sentinel_blade'))).toBe(false);
    expect(weaponMatchesAffinity(Characters.must('mori').affinity, Weapons.must('shepherd_crook'))).toBe(true);
    expect(weaponMatchesAffinity(Characters.must('mori').affinity, Weapons.must('prism_staff'))).toBe(true);
    expect(weaponMatchesAffinity(Characters.must('mori').affinity, Weapons.must('hunter_bow'))).toBe(false);
    for (const id of ['lantern_flail', 'fang_blade', 'shepherd_crook']) {
      const d = Weapons.must(id);
      expect(hasSprite(d.icon)).toBe(true);
      expect(hasSprite(d.heldSprite!)).toBe(true);
      expect(d.archetype).toMatch(HANGUL);
    }
  });

  it('registers and implements every kit sound', () => {
    for (const n of ['bori_barrel', 'bori_drink', 'bori_block', 'bori_shove', 'bori_howl', 'baekgu_parry', 'baekgu_counter', 'baekgu_flash', 'mori_whistle', 'mori_baa', 'mori_stampede']) {
      expect(SFX_NAMES).toContain(n);
      expect(hasSfx(n), n).toBe(true);
    }
  });

  it('unlock rules: 3 defeats (보리), a flawless boss (백구), 300 kills (모리)', () => {
    expect(boriUnlockDue(BORI_UNLOCK_DEATHS - 1)).toBe(false);
    expect(boriUnlockDue(BORI_UNLOCK_DEATHS)).toBe(true);
    expect(bossUnlocksBaekgu(true, false, 0, 0)).toBe(true);
    expect(bossUnlocksBaekgu(true, false, 0, 1)).toBe(false);
    expect(bossUnlocksBaekgu(true, true, 0, 0)).toBe(false);
    expect(bossUnlocksBaekgu(false, false, 0, 0)).toBe(false);
    expect(bossUnlocksBaekgu(true, false, 1, 0)).toBe(false);
    expect(moriUnlockDue(MORI_UNLOCK_KILLS - 1)).toBe(false);
    expect(moriUnlockDue(MORI_UNLOCK_KILLS)).toBe(true);
  });
});

// ====================================================================== 보리
describe('보리 — 구조통 / 몸통 밀치기', () => {
  it('is heavy, and stores hearts picked up at full health in the barrel', () => {
    const { w } = sim('bori', 'lantern_flail');
    const p = w.player;
    expect(p.mass).toBe(BORI_MASS);
    expect(p.flags.has('overheal')).toBe(true);
    expect(p.flags.has('affinity')).toBe(true);
    expect(p.maxRed).toBe(10);
    expect(p.red).toBe(p.maxRed);
    expect(barrel(w)).toBe(0);
    drive(w, 2);
    w.spawn(new Pickup('heart', p.x, p.y));
    drive(w, 30);
    expect(p.red).toBe(p.maxRed);
    expect(barrel(w)).toBe(1);
    // a half heart when one half is missing: half healed, the rest into the barrel
    p.red -= 1;
    drive(w, 2);
    w.spawn(new Pickup('heart', p.x, p.y));
    drive(w, 30);
    expect(p.red).toBe(p.maxRed);
    expect(barrel(w)).toBe(1.5);
  });

  it('spills a healing puddle when hurt, and the keeper standing in it heals', () => {
    const { w } = sim('bori', 'lantern_flail');
    const p = w.player;
    p.god = false;
    addBarrel(w, 1);
    drive(w, 2);
    expect(p.hurt(w, 2, 'test')).toBe(true);
    const red0 = p.red;
    drive(w, 12); // the hurt hit-stop passes, the puddle is flushed into the room
    const puddle = w.entities.find((e) => e instanceof RescuePuddle) as RescuePuddle | undefined;
    expect(puddle).toBeDefined();
    expect(barrel(w)).toBe(0);
    expect(puddle!.covers(p)).toBe(true);
    drive(w, 60 * 2.2);
    expect(p.red).toBeGreaterThanOrEqual(red0 + 2);
  });

  it('drinks a charge with the potion key (no potion held): +1♥ and a shield; gulps on its own at 1♥', () => {
    const { w } = sim('bori', 'lantern_flail');
    const p = w.player;
    p.god = false;
    p.red = 6;
    drive(w, 2);
    addBarrel(w, 2);
    drive(w, 3, (out, i) => { if (i === 0) out.pressed = PRESS.potion; });
    expect(p.red).toBe(8);
    expect(p.shields).toBe(1);
    expect(barrel(w)).toBe(1);
    // at 1♥ the barrel pours by itself
    p.red = 2;
    drive(w, 5);
    expect(p.red).toBe(4);
    expect(barrel(w)).toBe(0);
  });

  it('the body block stops bullets in front (feeding the barrel and the ember) and shoves enemies', () => {
    const { w, dummy } = sim('bori', 'lantern_flail', 26);
    const p = w.player;
    const hp0 = dummy.hp;
    bulletAt(w, p.x + 60, p.y - 4, 200);
    const pr = bulletAt(w, p.x + 70, p.y + 2, 200);
    drive(w, 1);
    drive(w, 14, (out, i) => { if (i === 0) out.pressed = PRESS.dash; out.mx = 1; });
    expect(w.entities.some((e) => e instanceof BodyBlock)).toBe(true);
    expect(pr.dead).toBe(true);
    expect(w.projectiles.filter((q) => q.team === 'enemy' && !q.dead).length).toBe(0);
    expect(barrel(w)).toBeCloseTo(2 * BORI_BLOCK_CHARGE, 5);
    expect(p.ember).toBeGreaterThan(0);
    expect(dummy.hp).toBeLessThan(hp0); // shoved
    expect(dummy.mem.__boriShoveAt).toBeGreaterThan(0);
    drive(w, 40);
    expect(w.entities.some((e) => e instanceof BodyBlock && !e.dead)).toBe(false);
  });
});

// ====================================================================== 백구
describe('백구 — 간파 / 찰나 걸음', () => {
  it('the window is wider with stick / touch aim and with a short blade', () => {
    const { w } = sim('baekgu', 'fang_blade');
    const p = w.player;
    expect(p.flags.has('affinity')).toBe(true);
    drive(w, 1);
    expect(dodgeWindow(w)).toBeCloseTo(BAEKGU_WINDOW_STICK + BAEKGU_WINDOW_AFFINITY, 5);
    drive(w, 1, (out) => { out.held = HELD.cursorAim; });
    expect(dodgeWindow(w)).toBeCloseTo(BAEKGU_WINDOW_CURSOR + BAEKGU_WINDOW_AFFINITY, 5);
    p.equipWeapon(w, 'lantern_bolt');
    drive(w, 1, (out) => { out.held = HELD.cursorAim; });
    expect(dodgeWindow(w)).toBeCloseTo(BAEKGU_WINDOW_CURSOR, 5);
  });

  it('a dash just before a bullet lands is a perfect dodge: reflect, slow-mo, counter crit, 반격', () => {
    const { w, dummy } = sim('baekgu', 'fang_blade', 30);
    const p = w.player;
    p.god = false;
    const dmg0 = p.stats.damage;
    const hp0 = dummy.hp;
    // a bullet 36 px to the left, flying at the keeper: lands in ~0.19 s
    const pr = bulletAt(w, p.x - 36, p.y - 4, 150);
    drive(w, 1);
    drive(w, 1, (out) => { out.pressed = PRESS.dash; out.my = 1; });
    expect(w.vars.__bgDodged).toBe(1);
    expect(pr.team).toBe('player'); // reflected
    expect(pr.dead).toBe(false);
    expect(w.enemyTimeScale).toBeCloseTo(BAEKGU_SLOW_SCALE, 5);
    expect(inCounter(w)).toBe(true);
    expect(p.stats.damage).toBeCloseTo(dmg0 * BAEKGU_COUNTER_DMG, 3);
    expect(p.ember).toBeGreaterThan(0);
    drive(w, 8);
    // the counter slash landed on the dummy as a critical
    const lost = hp0 - dummy.hp;
    expect(lost).toBeGreaterThan(dmg0 * 1.8 * 1.5 * 1.7);
    expect(p.red).toBe(p.maxRed); // the bullet never hit
    drive(w, 60);
    expect(w.enemyTimeScale).toBe(1);
    drive(w, 60 * 2);
    expect(inCounter(w)).toBe(false);
    expect(p.stats.damage).toBeCloseTo(dmg0, 3);
  });

  it('a dash with nothing coming is just a short sidestep', () => {
    const { w, dummy } = sim('baekgu', 'fang_blade', 60);
    const p = w.player;
    const x0 = p.x;
    const hp0 = dummy.hp;
    drive(w, 1, (out) => { out.pressed = PRESS.dash; out.my = 1; });
    expect(w.vars.__bgDodged).toBe(0);
    expect(inCounter(w)).toBe(false);
    expect(w.enemyTimeScale).toBe(1);
    drive(w, 30);
    expect(dummy.hp).toBe(hp0);
    expect(p.x).toBeCloseTo(x0, 0);
    const len = p.stats.dashSpeed * p.stats.dashTime;
    expect(len).toBeLessThan(40); // shorter than the plain 49.5 px rush
  });

  it('a bullet that passes through the dashing keeper inside the window counts too', () => {
    const { w } = sim('baekgu', 'fang_blade', 80);
    const p = w.player;
    // a bullet 50 px away: too far to be predicted at dash start, but the dash (moving toward it) meets it in time
    const pr = bulletAt(w, p.x + 50, p.y - 4, 160);
    drive(w, 1);
    drive(w, 1, (out) => { out.pressed = PRESS.dash; out.mx = 1; });
    expect(w.vars.__bgDodged).toBe(0);
    drive(w, 8, (out) => { out.mx = 1; });
    expect(w.vars.__bgDodged).toBe(1);
    expect(pr.team).toBe('player');
  });
});

// ====================================================================== 모리
describe('모리 — 양치기 / 비켜서기', () => {
  it('fights beside spirit sheep: three with a staff, two otherwise; they come back each room', () => {
    const { w } = sim('mori', 'shepherd_crook');
    const p = w.player;
    expect(p.flags.has('affinity')).toBe(true);
    drive(w, 2);
    expect(familiarsOf<SpiritSheep>(w, 'mori_sheep').length).toBe(MORI_SHEEP_AFFINITY);
    p.equipWeapon(w, 'lantern_bolt');
    drive(w, 2);
    expect(familiarsOf<SpiritSheep>(w, 'mori_sheep').length).toBe(MORI_SHEEP);
    for (const s of familiarsOf<SpiritSheep>(w, 'mori_sheep')) expect(Math.hypot(s.x - p.x, s.y - p.y)).toBeLessThan(40);
  });

  it('the sheep headbutt enemies toward the herd point in front of the keeper and bunch them up', () => {
    const { w } = sim('mori', 'shepherd_crook', 200);
    const p = w.player;
    const id = Enemies.all().find((e) => e.floors?.includes(1) && !e.boss && !e.flying && (e.mass ?? 1) <= 1 && !e.phasing)!.id;
    const h = herdPoint(w);
    const spots = [[-38, 0], [38, 0], [0, -34]];
    const foes: Enemy[] = [];
    for (const [ox, oy] of spots) {
      const e = w.spawnEnemy(id, h.x + ox, h.y + oy)!;
      e.dormant = 0;
      e.hp = e.maxHp = 9999;
      e.applyStatus({ kind: 'stun', duration: 30 }, () => 0);
      foes.push(e);
    }
    const spread = () => foes.reduce((s, e) => s + Math.hypot(e.x - h.x, e.y - h.y), 0) / foes.length;
    const d0 = spread();
    drive(w, 60 * 4, (out) => { out.held = HELD.cursorAim; out.cx = p.x + 40; out.cy = p.y; });
    expect(spread()).toBeLessThan(d0 - 12);
    expect(foes.some((e) => e.hp < 9999)).toBe(true); // headbutts hurt
    expect(foes.some((e) => isGrouped(w, e))).toBe(true);
  });

  it('herded (grouped) enemies take +25% from the keeper\'s attacks', () => {
    const lone = sim('mori', 'lantern_bolt');
    const crowd = sim('mori', 'lantern_bolt', undefined, true);
    drive(lone.w, 1);
    drive(crowd.w, 1);
    expect(isGrouped(lone.w, lone.dummy)).toBe(false);
    expect(isGrouped(crowd.w, crowd.dummy)).toBe(true);
    const minLoss = (w: World, d: Enemy) => {
      let best = Infinity;
      for (let i = 0; i < 6; i++) {
        const hp = d.hp;
        w.applyHit(d, { damage: 10, kind: 'projectile', attacker: w.player });
        best = Math.min(best, hp - d.hp);
      }
      return best;
    };
    expect(minLoss(lone.w, lone.dummy)).toBeCloseTo(10, 3);
    expect(minLoss(crowd.w, crowd.dummy)).toBeCloseTo(10 * (1 + MORI_GROUP_BONUS), 3);
  });

  it('the sidestep leaves a pen where the keeper stood; the sheep herd toward it until it fades', () => {
    const { w } = sim('mori', 'shepherd_crook');
    const p = w.player;
    drive(w, 2);
    const x0 = p.x;
    const y0 = p.y;
    drive(w, 6, (out, i) => { if (i === 0) out.pressed = PRESS.dash; out.my = 1; });
    expect(penActive(w)).toBe(true);
    expect(herdPoint(w)).toEqual({ x: x0, y: y0 });
    expect(p.y).toBeGreaterThan(y0 + 10);
    drive(w, 60 * 1.6);
    expect(penActive(w)).toBe(false);
    expect(herdPoint(w).x).toBeGreaterThan(p.x); // back in front of the keeper (aiming right)
  });
});

// ====================================================================== balance
describe('new keepers: release burst and starter DPS bands', () => {
  /** Damage dealt to a lone dummy over 4 s with / without a release (the keeper does not attack; companions may). */
  function burst(character: string, release: boolean): { damage: number; base: number } {
    const { w, dummy } = sim(character, Characters.must(character).weapon, 40);
    const p = w.player;
    const base = p.stats.damage;
    drive(w, 1, (out) => { out.held = HELD.cursorAim; out.cx = dummy.x; out.cy = dummy.y; });
    p.ember = EMBER_MAX;
    const d0 = w.run.stats.damageDealt;
    drive(w, 1, (out) => { out.pressed = release ? PRESS.release : 0; out.held = HELD.cursorAim; out.cx = dummy.x; out.cy = dummy.y; });
    expect(p.ember).toBe(release ? 0 : EMBER_MAX);
    drive(w, 60 * 4, (out) => { out.held = HELD.cursorAim; out.cx = dummy.x; out.cy = dummy.y; });
    return { damage: w.run.stats.damageDealt - d0, base };
  }

  /** Damage of one release on a lone dummy (as a multiple of the keeper's damage stat), companions subtracted. */
  function releaseMult(character: string): number {
    const on = burst(character, true);
    const off = burst(character, false);
    return (on.damage - off.damage) / on.base;
  }

  it('every release is a 10–15x single-target burst (allowing crits)', () => {
    for (const id of NEW) {
      const k = releaseMult(id);
      expect(k, `${id} release x${k.toFixed(1)}`).toBeGreaterThanOrEqual(8.5);
      expect(k, `${id} release x${k.toFixed(1)}`).toBeLessThanOrEqual(17);
    }
  }, 60_000);

  it('starter weapons sit in the compressed band on a plain keeper; the kits land in a fair band', () => {
    const base = bestDps(PLAIN_ID, 'lantern_bolt');
    for (const id of ['lantern_flail', 'fang_blade', 'shepherd_crook']) {
      const k = bestDps(PLAIN_ID, id) / base;
      expect(k, `${id} ${k.toFixed(2)}`).toBeGreaterThanOrEqual(0.85);
      expect(k, `${id} ${k.toFixed(2)}`).toBeLessThanOrEqual(1.35);
    }
    for (const id of NEW) {
      const k = bestDps(id, Characters.must(id).weapon) / base;
      expect(k, `${id} starter ${k.toFixed(2)}`).toBeGreaterThanOrEqual(0.85);
      expect(k, `${id} starter ${k.toFixed(2)}`).toBeLessThanOrEqual(2.0);
    }
    // the companions and the tank's heft add to a bare weapon
    expect(bestDps('mori', 'lantern_bolt') / base).toBeGreaterThanOrEqual(1.1);
    expect(bestDps('bori', 'lantern_bolt') / base).toBeGreaterThanOrEqual(1.05);
  }, 120_000);

  it('kit state in w.vars stays numeric (lockstep hashable)', () => {
    for (const c of NEW) {
      const w = measureDps({ character: c, weapon: Characters.must(c).weapon, seconds: 2, dash: 0.7 }).world;
      for (const k in w.vars) expect(typeof w.vars[k], `${c} ${k}`).toBe('number');
    }
  });
});
