// Floor 7 bosses (멈춘 태엽탑): 시계장인 and 태엽 무희 — definitions, art, the shared kit7
// helpers, a headless ~60 s simulation of each fight (both phases, telegraphs, clean
// death) and the signature mechanics (tick-frozen shots, rewinding shots, the sweeping
// clock hand, slow-time wells, mirrored ghost dancers).

import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Enemies } from '../src/game/defs';
import { Enemy } from '../src/game/enemy';
import { Entity } from '../src/game/entity';
import { GroundWarning } from '../src/game/effects';
import { Projectile } from '../src/game/projectile';
import { Tile } from '../src/game/tiles';
import { getAnim, hasAnim, hasSprite } from '../src/engine/sprites';
import { RNG } from '../src/engine/rng';
import { MUSIC_IDS, SFX_NAMES } from '../src/audio/audio';
import type { World } from '../src/game/world';
import type { Script } from '../src/engine/script';
import { Lob } from '../src/content/enemies/shared';
import { ShockRing } from '../src/content/bosses/final-kit';
import { bullet7, bulletSprite7, ClockHand, gapSlotFor, gearSprite, nextTick, rewind, rowWithGap, tickFreeze, TimeWell } from '../src/content/bosses/kit7';
import { TimeStopFx } from '../src/content/bosses/clockmaker';
import { GhostDancer } from '../src/content/bosses/clockwork-dancer';

loadContent();

const BOSSES: Record<string, { prefixes: string[]; states: string[]; minion?: string }> = {
  clockmaker: { prefixes: ['ck', 'ck2'], states: ['idle', 'wind', 'cast', 'lean', 'hurt'], minion: 'tin_soldier' },
  clockwork_dancer: { prefixes: ['dancer', 'dancer2'], states: ['idle', 'spin', 'pose', 'leap', 'hurt'] },
};
const EXTRA_SPRITES = ['ck_portrait', 'dancer_portrait', 'ck_hand_long', 'ck_hand_short', 'dancer_pin', 'tinsoldier_walk_0', 'tinsoldier_walk_1'];
const SFX7 = [
  'clockboss_tick', 'clockboss_wind', 'clockboss_freeze', 'clockboss_rewind', 'clockboss_sweep', 'clockboss_gear', 'clockboss_chime',
  'clockboss_shatter', 'clockboss_pirouette', 'clockboss_box', 'clockboss_detune',
];

function spriteDefined(name: string): boolean {
  if (hasAnim(name)) {
    const a = getAnim(name)!;
    return a.frames.length > 0 && a.frames.every((f) => hasSprite(f));
  }
  return hasSprite(name);
}

// ---------------------------------------------------------------- definitions
describe('floor 7 boss definitions', () => {
  it('registers both bosses for floor 7 with Korean names, portraits, music and death fx', () => {
    const ids = Enemies.all().filter((e) => e.boss && e.bossFloors?.includes(7)).map((e) => e.id).sort();
    expect(ids).toEqual(Object.keys(BOSSES).sort());
    for (const id of Object.keys(BOSSES)) {
      const d = Enemies.must(id);
      expect(d.boss, id).toBe(true);
      expect(d.bossFloors, id).toEqual([7]);
      expect(d.floors, `${id} must never spawn as a regular enemy`).toBeUndefined();
      expect(d.name, id).toMatch(/[가-힣]/);
      expect(d.bossTitle, id).toMatch(/[가-힣]/);
      expect(d.portrait && hasSprite(d.portrait), `${id} portrait`).toBe(true);
      expect(spriteDefined(d.sprite), `${id} sprite`).toBe(true);
      expect(d.deathFx, id).toBeDefined();
      expect(d.bloodColor, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(d.script, id).toBeTypeOf('function');
      expect(d.draw, id).toBeTypeOf('function');
      expect(d.bossMusic, id).toBe('boss_clockwork');
      // act-2 baseline before the floor multiplier: a notch above the floor-6 pair
      expect(d.hp, id).toBeGreaterThanOrEqual(850);
      expect(d.hp, id).toBeLessThanOrEqual(1070);
    }
    expect(MUSIC_IDS).toContain('boss_clockwork');
    for (const n of SFX7) expect(SFX_NAMES).toContain(n);
  });

  it('every animation state exists for both phase looks, plus every extra sprite', () => {
    for (const [id, b] of Object.entries(BOSSES)) {
      for (const pre of b.prefixes) for (const s of b.states) expect(spriteDefined(`${pre}_${s}`), `${id}: ${pre}_${s}`).toBe(true);
      expect(getAnim(`${b.prefixes[0]}_${b.states[0]}`)?.frames.length ?? 0, `${id} idle frames`).toBeGreaterThanOrEqual(2);
    }
    for (const n of EXTRA_SPRITES) expect(spriteDefined(n), n).toBe(true);
    expect(hasSprite(bulletSprite7('brass', 7))).toBe(true);
    expect(hasSprite(bulletSprite7('verd', 9))).toBe(true);
    expect(hasSprite(bulletSprite7('rose', 7))).toBe(true);
    expect(hasSprite(gearSprite(13, true))).toBe(true);
    expect(bullet7('rose', 3).sprite).toBe(bulletSprite7('rose', 7));
  });

  it("registers the clockmaker's tin soldier as a script-only minion", () => {
    const m = Enemies.get('tin_soldier');
    expect(m).toBeDefined();
    expect(m!.floors).toBeUndefined();
    expect(m!.boss).toBeFalsy();
    expect(spriteDefined(m!.sprite)).toBe(true);
    expect(m!.hp).toBeLessThanOrEqual(60);
    expect(m!.speed ?? 40).toBeLessThan(92);
  });
});

// ---------------------------------------------------------------- pure helpers
describe('kit7 helpers', () => {
  it('nextTick lands on the first tick at or after now + minDelay', () => {
    expect(nextTick(10, 9.6, 0.8, 0)).toBeCloseTo(10.4);
    expect(nextTick(10, 9.6, 0.8, 0.5)).toBeCloseTo(11.2);
    expect(nextTick(10, 9.6, 0.8, 1.6)).toBeCloseTo(12.0);
    // never the tick that already passed, even when minDelay is 0 and now sits on a tick
    expect(nextTick(10.4, 9.6, 0.8, 0)).toBeCloseTo(10.4);
    expect(nextTick(10.41, 9.6, 0.8, 0)).toBeCloseTo(11.2);
    for (let k = 0; k < 50; k++) {
      const now = 3 + k * 0.137;
      const t = nextTick(now, 2.5, 0.55, 0.9);
      expect(t).toBeGreaterThanOrEqual(now + 0.9 - 1e-9);
      expect(t - (now + 0.9)).toBeLessThan(0.55 + 1e-9);
      expect(Math.abs(((t - 2.5) / 0.55) - Math.round((t - 2.5) / 0.55))).toBeLessThan(1e-6);
    }
  });

  it('rowWithGap spaces the pins edge to edge and leaves exactly the gap out', () => {
    const r = rowWithGap(10, 130, 5, 13, 4, 3);
    expect(r.length).toBe(10);
    expect(r[0]).toEqual({ x: 10, y: 5 });
    expect(r[r.length - 1]).toEqual({ x: 130, y: 5 });
    for (const s of r) expect(Math.abs(s.x - 50) > 1 && Math.abs(s.x - 60) > 1 && Math.abs(s.x - 70) > 1, `slot at ${s.x} is inside the gap`).toBe(true);
    expect(rowWithGap(0, 10, 0, 1, 5, 2)).toEqual([{ x: 5, y: 0 }]);
    expect(rowWithGap(0, 10, 0, 0, 0, 1)).toEqual([]);
  });

  it('gapSlotFor keeps the hole inside the row and centred on the point', () => {
    expect(gapSlotFor(0, 120, 13, 3, 60)).toBe(5);
    expect(gapSlotFor(0, 120, 13, 3, -50)).toBe(0);
    expect(gapSlotFor(0, 120, 13, 3, 500)).toBe(10);
    expect(gapSlotFor(0, 120, 2, 3, 60)).toBe(0);
  });
});

// ---------------------------------------------------------------- headless world
interface FakeWorld {
  w: World;
  entities: Entity[];
  hurts: number;
  slows: number;
  warnTimes: number[];
  tiles: Map<string, number>;
  player: { x: number; y: number; vx: number; vy: number; r: number; z: number; alive: boolean };
}

function fakeWorld(seed: string): FakeWorld {
  const IX = 32;
  const IY = 32;
  const IW = 272;
  const IH = 144;
  const inside = (x: number, y: number, r: number) => x - r >= IX && y - r >= IY && x + r <= IX + IW && y + r <= IY + IH;
  const fw: FakeWorld = { w: null as unknown as World, entities: [], hurts: 0, slows: 0, warnTimes: [], tiles: new Map(), player: null as never };
  const tileAt = (tx: number, ty: number) => fw.tiles.get(`${tx},${ty}`) ?? (inside(tx * 16 + 8, ty * 16 + 8, 0) ? Tile.FLOOR : Tile.WALL);
  const room = {
    interiorX: IX, interiorY: IY, interiorW: IW, interiorH: IH, centerX: IX + IW / 2, centerY: IY + IH / 2,
    boxBlocked: (x: number, y: number, r: number) => !inside(x, y, r) || tileAt(Math.floor(x / 16), Math.floor(y / 16)) === Tile.BLOCK,
    isFree: (x: number, y: number, r = 6) => inside(x, y, r) && tileAt(Math.floor(x / 16), Math.floor(y / 16)) === Tile.FLOOR,
    randomFreePos: (rng: RNG, r = 6, avoid?: { x: number; y: number; dist: number }) => {
      let best = { x: IX + IW / 2, y: IY + IH / 2 };
      for (let i = 0; i < 60; i++) {
        const x = IX + r + rng.next() * (IW - r * 2);
        const y = IY + r + rng.next() * (IH - r * 2);
        best = { x, y };
        if (room.isFree(x, y, r) && (!avoid || Math.hypot(x - avoid.x, y - avoid.y) >= avoid.dist)) break;
      }
      return best;
    },
    nearestFree: (x: number, y: number, r = 6) => ({ x: Math.min(IX + IW - r, Math.max(IX + r, x)), y: Math.min(IY + IH - r, Math.max(IY + r, y)) }),
    lineOfSight: () => true,
    tileAt,
    tileAtPx: (x: number, y: number) => tileAt(Math.floor(x / 16), Math.floor(y / 16)),
    setTile: (tx: number, ty: number, t: number) => { fw.tiles.set(`${tx},${ty}`, t); },
    destroyTile: () => {},
    damageTile: () => {},
    markDirty: () => {},
    doors: [] as { x: number; y: number }[],
  };
  const player = {
    x: IX + IW / 2, y: IY + IH - 30, vx: 0, vy: 0, r: 5, z: 0, alive: true, invuln: 0, statuses: new Map(),
    hurt: () => { fw.hurts++; return true; },
    knock: () => {},
    hasStatus: () => false,
    applyStatus: () => { fw.slows++; return true; },
    stats: { damage: 10, critChance: 0, critMult: 1.8, bossDamage: 0 },
  };
  fw.player = player;
  const enemies: Enemy[] = [];
  const w = {
    rng: new RNG(seed),
    dt: 1 / 60,
    time: 0,
    roomTime: 0,
    enemyTimeScale: 1,
    player,
    targets: () => [player],
    room,
    flags: new Set<string>(),
    entityById: (id: number) => fw.entities.find((e) => e.id === id && !e.dead),
    enemies,
    get entities() { return fw.entities; },
    get projectiles() { return fw.entities.filter((e) => e instanceof Projectile) as Projectile[]; },
    flow: { dirAt: () => null },
    particles: { burst: () => {}, spawn: () => {} },
    lights: { add: () => {}, glow: () => {} },
    renderer: { screenFlash: () => {}, kick: () => {} },
    spawn<T extends Entity>(e: T): T {
      fw.entities.push(e);
      if (e instanceof Enemy) enemies.push(e);
      if (e instanceof GroundWarning) fw.warnTimes.push(e.time);
      if (e instanceof ClockHand) fw.warnTimes.push(e.o.warn);
      if (e instanceof GhostDancer) fw.warnTimes.push(e.o.warn);
      return e;
    },
    spawnEnemy(id: string, x: number, y: number): Enemy | null {
      const def = Enemies.get(id);
      if (!def) return null;
      const e = new Enemy(def, x, y, 1);
      w.spawn(e);
      e.start(w as unknown as World);
      return e;
    },
    killEnemy(e: Enemy) {
      if (e.dead) return;
      e.hp = Math.min(0, e.hp);
      e.dead = true;
      e.def.onDeath?.(e, w as unknown as World);
    },
    applyHit(target: Enemy, hit: { damage: number }) {
      if (!target.alive || !target.vulnerable || target.hidden) return false;
      const ok = target.takeHit(w as unknown as World, hit as never);
      if (ok && target.hp <= 0) w.killEnemy(target);
      return ok;
    },
    explode: () => {},
    sfx: () => {},
    shake: () => {},
    hitstop: () => {},
    decal: () => {},
    banner: () => {},
    floatText: () => {},
    statusDamage: () => {},
    nearestEnemy: () => null,
  };
  fw.w = w as unknown as World;
  return fw;
}

function step(fw: FakeWorld, seconds: number, onFrame?: (t: number) => void, movePlayer = true): void {
  const w = fw.w as unknown as { time: number; roomTime: number; dt: number; enemies: Enemy[] };
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) {
    w.time += w.dt;
    w.roomTime += w.dt;
    if (movePlayer) {
      // the keeper strafes around the room so aimed attacks change direction
      const px = 168 + Math.cos(w.time * 0.8) * 100;
      const py = 104 + Math.sin(w.time * 1.1) * 50;
      fw.player.vx = (px - fw.player.x) * 60;
      fw.player.vy = (py - fw.player.y) * 60;
      fw.player.x = px;
      fw.player.y = py;
    }
    for (const e of [...fw.entities]) if (!e.dead) e.update(fw.w, w.dt);
    for (const e of w.enemies) if (!e.dead && e.hp <= 0) fw.w.killEnemy(e);
    fw.entities = fw.entities.filter((e) => !e.dead);
    w.enemies.splice(0, w.enemies.length, ...w.enemies.filter((e) => !e.dead));
    onFrame?.(w.time);
  }
}

function danger(fw: FakeWorld): number {
  return fw.entities.filter((x) => !x.dead && (
    (x instanceof Projectile && x.team === 'enemy') || x instanceof GroundWarning || x instanceof ShockRing || x instanceof Lob
    || (x instanceof ClockHand && !x.fading) || (x instanceof TimeWell && x.armed) || (x instanceof GhostDancer && !x.done))).length;
}

function shots(fw: FakeWorld): Projectile[] {
  return fw.entities.filter((e): e is Projectile => e instanceof Projectile && e.team === 'enemy' && !e.dead);
}

// ---------------------------------------------------------------- simulations
describe('floor 7 boss AI (headless simulation)', () => {
  for (const id of Object.keys(BOSSES)) {
    it(`${id}: attacks with telegraphs for ~60 s, changes phase, dies cleanly`, () => {
      const fw = fakeWorld(`boss7-${id}`);
      const boss = fw.w.spawnEnemy(id, 168, 80)!;
      expect(boss).toBeTruthy();
      boss.dormant = 0;
      let maxDanger = 0;
      const seen = new Set<string>();
      const checkBounds = () => {
        for (const e of fw.w.enemies) {
          expect(Number.isFinite(e.x) && Number.isFinite(e.y), `${e.def.id} position`).toBe(true);
          expect(e.x).toBeGreaterThan(0);
          expect(e.x).toBeLessThan(340);
          expect(e.y).toBeGreaterThan(-40);
          expect(e.y).toBeLessThan(210);
        }
        for (const s of shots(fw)) expect(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.speed), `${id} shot state`).toBe(true);
        if (boss.mem.last) seen.add(boss.mem.last as string);
      };
      step(fw, 28, () => {
        maxDanger = Math.max(maxDanger, danger(fw));
        checkBounds();
      });
      expect(maxDanger, `${id} produces telegraphed danger`).toBeGreaterThan(0);
      expect(boss.phase, `${id} stays in phase 1 at full hp`).toBe(0);
      expect(boss.alive).toBe(true);
      expect(seen.size, `${id} varies its phase-1 attacks`).toBeGreaterThanOrEqual(3);

      // drop below the phase threshold: a phase-change moment must follow
      boss.hp = boss.maxHp * 0.45;
      step(fw, 12, checkBounds);
      expect(boss.phase, `${id} enters phase 2`).toBeGreaterThanOrEqual(1);
      expect(boss.mem.p2, `${id} switches to its phase-2 look`).toBeTruthy();
      step(fw, 24, () => {
        maxDanger = Math.max(maxDanger, danger(fw));
        checkBounds();
      });
      expect(boss.alive).toBe(true);
      // Clockmaker may be mid-skip at this exact seeded timestamp. The skip must
      // restore vulnerability and opacity promptly, rather than remain invulnerable.
      let recovered = boss.vulnerable && boss.alpha > 0.99;
      step(fw, 1, () => { recovered ||= boss.vulnerable && boss.alpha > 0.99; });
      expect(recovered, `${id} returns to visible and hittable after a skip`).toBe(true);

      // every area telegraph gives the keeper time to react
      expect(fw.warnTimes.length, `${id} uses ground warnings`).toBeGreaterThan(0);
      for (const t of fw.warnTimes) expect(t, `${id} warning time`).toBeGreaterThanOrEqual(0.3);

      // death: the arena is cleared with it, minions dissolve, nothing throws afterwards
      boss.vulnerable = true;
      fw.w.killEnemy(boss);
      expect(danger(fw), `${id} leaves no live attacks behind`).toBe(0);
      step(fw, 2.5);
      expect(fw.w.enemies.filter((e) => e.alive && e.mem.owner === boss).length, `${id} minions dissolve`).toBe(0);
      expect(fw.entities.filter((e) => (e instanceof TimeWell || e instanceof TimeStopFx || e instanceof GhostDancer) && !e.dead).length, `${id} hazards fade`).toBe(0);
    });
  }

  it('the clockmaker keeps his tin soldiers bounded and ticks on a steady beat', () => {
    const fw = fakeWorld('minions7');
    const boss = fw.w.spawnEnemy('clockmaker', 168, 80)!;
    boss.dormant = 0;
    boss.hp = boss.maxHp * 0.2;
    let most = 0;
    let ticks = 0;
    let last = boss.mem.tick as number;
    const gaps: number[] = [];
    let lastAt = -1;
    step(fw, 40, (t) => {
      most = Math.max(most, fw.w.enemies.filter((e) => e.alive && e.mem.owner === boss).length);
      if (boss.mem.tick !== last) {
        last = boss.mem.tick as number;
        ticks++;
        if (lastAt >= 0) gaps.push(t - lastAt);
        lastAt = t;
      }
    });
    expect(most).toBeLessThanOrEqual(4);
    expect(ticks).toBeGreaterThan(40);
    // phase 2 beat: 0.55 s, give or take a frame
    for (const g of gaps) expect(Math.abs(g - 0.55)).toBeLessThan(0.04);
  });

  it('the clockmaker skips between anchor spots, never onto the keeper, and is whole again afterwards', () => {
    const fw = fakeWorld('skip7');
    const boss = fw.w.spawnEnemy('clockmaker', 168, 80)!;
    boss.dormant = 0;
    const spots = new Set<string>();
    let hiddenFrames = 0;
    let jumps = 0;
    let lx = boss.x;
    let ly = boss.y;
    step(fw, 45, () => {
      spots.add(`${Math.round(boss.x)},${Math.round(boss.y)}`);
      if (!boss.vulnerable) hiddenFrames++;
      if (Math.hypot(boss.x - lx, boss.y - ly) > 20) {
        // a skip: he lands clear of the keeper and is untouchable only for the blink itself
        jumps++;
        expect(boss.vulnerable).toBe(false);
        expect(Math.hypot(boss.x - fw.player.x, boss.y - fw.player.y)).toBeGreaterThan(35);
      }
      lx = boss.x;
      ly = boss.y;
    });
    expect(spots.size).toBeGreaterThanOrEqual(2);
    expect(jumps).toBeGreaterThan(0);
    expect(hiddenFrames).toBeGreaterThan(0);
    expect(hiddenFrames).toBeLessThan(45 * 60 * 0.2);
  });
});

// ---------------------------------------------------------------- mechanics
describe('floor 7 boss mechanics', () => {
  it('tick-frozen shots stop, hold, and resume on the tick re-aimed at the keeper', () => {
    const fw = fakeWorld('freeze7');
    const boss = fw.w.spawnEnemy('clockmaker', 168, 80)!;
    boss.script.stop();
    fw.player.x = 60;
    fw.player.y = 150;
    const resumeAt = 2.0;
    const pr = boss.shoot(fw.w, 0, bullet7('verd', 3, { speed: 100, life: 9, range: 900, behaviors: [tickFreeze({ after: 0.5, resumeAt, reaim: true, speed: 140 })] }));
    pr.x = 100;
    pr.y = 80;
    step(fw, 0.4, undefined, false);
    expect(pr.speed).toBe(100);
    const x0 = pr.x;
    step(fw, 0.3, undefined, false);
    expect(pr.speed).toBe(0);
    expect(pr.mem.fz).toBe(1);
    const xf = pr.x;
    expect(xf).toBeGreaterThan(x0);
    step(fw, 1.0, undefined, false);
    expect(pr.x, 'a frozen shot does not drift').toBeCloseTo(xf, 5);
    expect(pr.dead).toBe(false);
    step(fw, 0.4, undefined, false);
    expect(pr.mem.fz).toBe(2);
    expect(pr.speed).toBe(140);
    // heading toward the keeper (down-left)
    expect(pr.vx).toBeLessThan(0);
    expect(pr.vy).toBeGreaterThan(0);
  });

  it('a rewinding shot turns round at the tick and dies back where it was fired', () => {
    const fw = fakeWorld('rewind7');
    const boss = fw.w.spawnEnemy('clockmaker', 168, 80)!;
    boss.script.stop();
    const pr = boss.shoot(fw.w, 0, bullet7('brass', 3, { speed: 150, life: 9, range: 2000, behaviors: [rewind(1.0)] }));
    pr.x = 100;
    pr.y = 100;
    step(fw, 0.9, undefined, false);
    expect(pr.x).toBeGreaterThan(200);
    expect(pr.vx).toBeGreaterThan(0);
    step(fw, 0.2, undefined, false);
    expect(pr.vx).toBeLessThan(0);
    step(fw, 1.2, undefined, false);
    expect(pr.dead, 'expires once it is back at its origin').toBe(true);
    expect(fw.entities.includes(pr)).toBe(false);
  });

  it('the clock hand hurts along its blade once per cooldown, never while the dial is shown', () => {
    // keeper spots relative to the hub (the clock snaps to its anchor when it spawns)
    const run = (dx: number, dy: number, secs: number) => {
      const fw = fakeWorld('hand7');
      const boss = fw.w.spawnEnemy('clockmaker', 168, 80)!;
      boss.script.stop();
      fw.player.x = boss.x + dx;
      fw.player.y = boss.y + 2 + dy;
      fw.hurts = 0;
      // a hand pointing left (toward x < hub), not turning
      fw.w.spawn(new ClockHand(boss, Math.PI, { source: 't', warn: 0.9, duration: 2.0, omega: 0, half: 5, rehit: 0.8 }));
      step(fw, secs, undefined, false);
      return fw.hurts;
    };
    expect(run(-88, 0, 0.7)).toBe(0); // still the dial telegraph
    expect(run(-88, 0, 1.3)).toBe(1); // on the blade, hit once
    expect(run(-88, 0, 2.4)).toBe(2); // rehit after the cooldown
    expect(run(-88, 38, 2.4)).toBe(0); // beside the blade
    expect(run(82, 0, 2.4)).toBe(0); // the other side of the hub
  });

  it('a time well slows only once armed, only inside, and fades when cleared', () => {
    const make = (px: number, py: number) => {
      const fw = fakeWorld('well7');
      fw.player.x = px;
      fw.player.y = py;
      const well = fw.w.spawn(new TimeWell(100, 100, 30, 4, 0.5));
      return { fw, well };
    };
    const a = make(100, 100);
    step(a.fw, 0.4, undefined, false);
    expect(a.fw.slows).toBe(0); // rising
    step(a.fw, 1.0, undefined, false);
    expect(a.fw.slows).toBeGreaterThan(30);
    const b = make(160, 100);
    step(b.fw, 2, undefined, false);
    expect(b.fw.slows).toBe(0);
    const c = make(100, 100);
    step(c.fw, 1, undefined, false);
    c.well.onCleared();
    const n = c.fw.slows;
    step(c.fw, 0.5, undefined, false);
    expect(c.fw.slows).toBe(n);
    expect(c.well.dead).toBe(true);
  });

  it('a ghost dancer waits, dashes its lane, hurts once and vanishes', () => {
    const run = (px: number, py: number) => {
      const fw = fakeWorld('ghost7');
      fw.player.x = px;
      fw.player.y = py;
      const g = fw.w.spawn(new GhostDancer(60, 100, 0, { source: 't', warn: 0.7, speed: 300, len: 200, damage: 1 }));
      step(fw, 0.6, undefined, false);
      expect(g.x).toBe(60);
      expect(fw.hurts).toBe(0);
      step(fw, 1.4, undefined, false);
      expect(g.done).toBe(true);
      expect(g.x).toBeCloseTo(260, 0);
      step(fw, 0.4, undefined, false);
      expect(g.dead).toBe(true);
      return fw.hurts;
    };
    expect(run(160, 100)).toBe(1);
    expect(run(160, 140)).toBe(0);
  });

  it("the dancer's pin rows hold in place along the wall, then advance together with one gap", () => {
    const fw = fakeWorld('pins7');
    const boss = fw.w.spawnEnemy('clockwork_dancer', 168, 110)!;
    boss.dormant = 0;
    boss.script.set((boss.mem.attacks as Record<string, (b: Enemy, w: World) => Script>).pins(boss, fw.w));
    step(fw, 0.6, undefined, false);
    const pins = shots(fw);
    expect(pins.length).toBeGreaterThanOrEqual(7);
    const ys = new Set(pins.map((p) => Math.round(p.y)));
    expect(ys.size).toBe(1);
    const xs = pins.map((p) => p.x).sort((a, b) => a - b);
    // one hole wider than the regular spacing
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    const regular = Math.min(...gaps);
    expect(gaps.filter((g) => g > regular * 2.5).length).toBe(1);
    for (const p of pins) expect(p.delay).toBeGreaterThan(0);
    step(fw, 1.2, undefined, false);
    const moved = shots(fw);
    expect(moved.length).toBeGreaterThanOrEqual(7);
    for (const p of moved) {
      expect(p.delay).toBeLessThanOrEqual(0);
      expect(Math.abs(p.vy)).toBeGreaterThan(50);
      expect(Math.abs(p.vx)).toBeLessThan(1e-6);
    }
  });
});
