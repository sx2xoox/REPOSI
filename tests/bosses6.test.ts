// Floor 6 bosses (수몰된 서고): 대서기관 and 가라앉은 등대 — definitions, art, the shared
// kit6 helpers, a headless ~60 s simulation of each fight (both phases, telegraphs,
// clean death) and the signature mechanics (beam shadows, ink flood islands, page walls).

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
import { Lob } from '../src/content/enemies/shared';
import { ShockRing } from '../src/content/bosses/final-kit';
import {
  bulletSprite6, GLYPH_COUNT, glyphSprite, InkPool, inWedge, islandSpots, rayBlocked, rowSpots, shadowLen,
} from '../src/content/bosses/kit6';
import { InkFlood, InkStroke, PageWall } from '../src/content/bosses/archivist';
import { Blackout, LampBeam, LampFlash, Shelf } from '../src/content/bosses/lighthouse';

loadContent();

const BOSSES: Record<string, { prefixes: string[]; states: string[]; minion: string }> = {
  grand_archivist: { prefixes: ['arch', 'arch2'], states: ['float', 'write', 'cast', 'slam', 'hurt'], minion: 'archive_page' },
  sunken_lighthouse: { prefixes: ['lh', 'lh2'], states: ['idle', 'charge', 'crouch', 'hurt'], minion: 'drowned_sailor' },
};
const EXTRA_SPRITES = [
  'arch_portrait', 'lh_portrait', 'lh_lens', 'lh_lens2', 'lh_wisp', 'lh_shelf', 'lh_shelf_broken', 'arch_pagewall_0', 'arch_pagewall_1',
  'arch_inkdrop', 'arch_page_0', 'arch_page_1', 'arch_page_2', 'apage_fly_0', 'apage_fly_1', 'dsailor_walk_0', 'dsailor_walk_1',
];

function spriteDefined(name: string): boolean {
  if (hasAnim(name)) {
    const a = getAnim(name)!;
    return a.frames.length > 0 && a.frames.every((f) => hasSprite(f));
  }
  return hasSprite(name);
}

// ---------------------------------------------------------------- definitions
describe('floor 6 boss definitions', () => {
  it('registers both bosses for floor 6 with Korean names, portraits, music and death fx', () => {
    const ids = Enemies.all().filter((e) => e.boss && e.bossFloors?.includes(6)).map((e) => e.id).sort();
    expect(ids).toEqual(Object.keys(BOSSES).sort());
    for (const id of Object.keys(BOSSES)) {
      const d = Enemies.must(id);
      expect(d.boss, id).toBe(true);
      expect(d.bossFloors, id).toEqual([6]);
      expect(d.floors, `${id} must never spawn as a regular enemy`).toBeUndefined();
      expect(d.name, id).toMatch(/[가-힣]/);
      expect(d.bossTitle, id).toMatch(/[가-힣]/);
      expect(d.portrait && hasSprite(d.portrait), `${id} portrait`).toBe(true);
      expect(spriteDefined(d.sprite), `${id} sprite`).toBe(true);
      expect(d.deathFx, id).toBeDefined();
      expect(d.bloodColor, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(d.script, id).toBeTypeOf('function');
      expect(d.draw, id).toBeTypeOf('function');
      expect(d.bossMusic, id).toBe('boss_drowned');
      // act-2 baseline: between the floor-4 saint (1250) scale and the floor-1 bosses, before the floor multiplier
      expect(d.hp, id).toBeGreaterThanOrEqual(700);
      expect(d.hp, id).toBeLessThanOrEqual(1070);
    }
    expect(MUSIC_IDS).toContain('boss_drowned');
    for (const n of ['quill_write', 'page_rip', 'ink_burst', 'lamp_hum', 'foghorn', 'tide_slam']) expect(SFX_NAMES).toContain(n);
  });

  it('every animation state exists for both phase looks, plus every extra sprite', () => {
    for (const [id, b] of Object.entries(BOSSES)) {
      for (const pre of b.prefixes) for (const s of b.states) expect(spriteDefined(`${pre}_${s}`), `${id}: ${pre}_${s}`).toBe(true);
      expect(getAnim(`${b.prefixes[0]}_${b.states[0]}`)?.frames.length ?? 0, `${id} idle frames`).toBeGreaterThanOrEqual(2);
    }
    for (const n of EXTRA_SPRITES) expect(spriteDefined(n), n).toBe(true);
    for (let i = 0; i < GLYPH_COUNT; i++) expect(hasSprite(glyphSprite(i)), glyphSprite(i)).toBe(true);
    expect(glyphSprite(GLYPH_COUNT + 1)).toBe(glyphSprite(1));
    expect(hasSprite(bulletSprite6('ink', 7))).toBe(true);
    expect(hasSprite(bulletSprite6('gold', 9))).toBe(true);
  });

  it('registers the minions as script-only enemies', () => {
    for (const b of Object.values(BOSSES)) {
      const m = Enemies.get(b.minion);
      expect(m, b.minion).toBeDefined();
      expect(m!.floors, b.minion).toBeUndefined();
      expect(m!.boss, b.minion).toBeFalsy();
      expect(spriteDefined(m!.sprite), b.minion).toBe(true);
      expect(m!.hp).toBeLessThanOrEqual(60);
      expect(m!.speed ?? 40).toBeLessThan(92);
    }
  });
});

// ---------------------------------------------------------------- pure helpers
describe('kit6 helpers', () => {
  const roomWith = (blocked: Set<string>) => ({
    tileAtPx: (x: number, y: number) => (blocked.has(`${Math.floor(x / 16)},${Math.floor(y / 16)}`) ? Tile.ROCK : Tile.FLOOR),
  });

  it('shadowLen stops at the first shot-blocking tile', () => {
    const open = roomWith(new Set());
    expect(shadowLen(open, 8, 8, 0, 200)).toBe(200);
    const rock = roomWith(new Set(['5,0'])); // tile x 80..96
    const l = shadowLen(rock, 8, 8, 0, 200);
    expect(l).toBeGreaterThan(60);
    expect(l).toBeLessThan(82);
    // a tile off the ray does not shorten it
    expect(shadowLen(roomWith(new Set(['5,3'])), 8, 8, 0, 200)).toBe(200);
  });

  it('rayBlocked sees tiles strictly between the two points', () => {
    const rock = roomWith(new Set(['5,0']));
    expect(rayBlocked(rock, 8, 8, 150, 8)).toBe(true);
    expect(rayBlocked(rock, 8, 8, 70, 8)).toBe(false);
    expect(rayBlocked(rock, 8, 40, 150, 40)).toBe(false);
  });

  it('inWedge tests angle, length and inner radius', () => {
    expect(inWedge(50, 0, 0, 0, 0, 0.2, 100)).toBe(true);
    expect(inWedge(50, 30, 0, 0, 0, 0.2, 100)).toBe(false);
    expect(inWedge(150, 0, 0, 0, 0, 0.2, 100)).toBe(false);
    expect(inWedge(5, 0, 0, 0, 0, 0.2, 100, 10)).toBe(false);
    expect(inWedge(-50, 0, 0, 0, Math.PI, 0.2, 100)).toBe(true);
  });

  it('rowSpots spaces a written row evenly from edge to edge', () => {
    const r = rowSpots(10, 70, 5, 7);
    expect(r.length).toBe(7);
    expect(r[0]).toEqual({ x: 10, y: 5 });
    expect(r[6]).toEqual({ x: 70, y: 5 });
    for (let i = 1; i < r.length; i++) expect(r[i].x - r[i - 1].x).toBeCloseTo(10);
    expect(rowSpots(0, 10, 0, 1)).toEqual([{ x: 5, y: 0 }]);
    expect(rowSpots(0, 10, 0, 0)).toEqual([]);
  });

  it('islandSpots keeps islands apart, inside the rect, the first near the keeper', () => {
    const rng = new RNG('islands');
    for (let k = 0; k < 20; k++) {
      const near = { x: 40 + rng.range(0, 200), y: 40 + rng.range(0, 100) };
      const isl = islandSpots(rng, 32, 32, 272, 144, 4, 70, 30, near);
      expect(isl.length).toBe(4);
      for (const i of isl) {
        expect(i.x).toBeGreaterThanOrEqual(62);
        expect(i.x).toBeLessThanOrEqual(274);
        expect(i.y).toBeGreaterThanOrEqual(62);
        expect(i.y).toBeLessThanOrEqual(146);
      }
      for (let a = 0; a < isl.length; a++) for (let b = a + 1; b < isl.length; b++) expect(Math.hypot(isl[a].x - isl[b].x, isl[a].y - isl[b].y)).toBeGreaterThanOrEqual(70);
      expect(Math.hypot(isl[0].x - near.x, isl[0].y - near.y)).toBeLessThan(40);
    }
  });
});

// ---------------------------------------------------------------- headless world
interface FakeWorld {
  w: World;
  entities: Entity[];
  hurts: number;
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
  const fw: FakeWorld = { w: null as unknown as World, entities: [], hurts: 0, warnTimes: [], tiles: new Map(), player: null as never };
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
      if (e instanceof LampBeam) fw.warnTimes.push(e.o.warn);
      if (e instanceof LampFlash) fw.warnTimes.push(e.o.warn);
      if (e instanceof InkFlood) fw.warnTimes.push(e.o.rise);
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
    || x instanceof InkStroke || x instanceof InkPool || (x instanceof InkFlood && x.armed) || x instanceof PageWall
    || (x instanceof LampBeam && !x.fading) || x instanceof LampFlash)).length;
}

// ---------------------------------------------------------------- simulations
describe('floor 6 boss AI (headless simulation)', () => {
  for (const id of Object.keys(BOSSES)) {
    it(`${id}: attacks with telegraphs for ~60 s, changes phase, dies cleanly`, () => {
      const fw = fakeWorld(`boss6-${id}`);
      const boss = fw.w.spawnEnemy(id, 168, 90)!;
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
        if (boss.mem.last) seen.add(boss.mem.last as string);
      };
      step(fw, 26, () => {
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

      // every area telegraph gives the keeper time to react
      expect(fw.warnTimes.length, `${id} uses ground warnings`).toBeGreaterThan(0);
      for (const t of fw.warnTimes) expect(t, `${id} warning time`).toBeGreaterThanOrEqual(0.3);

      // death: the arena is cleared with it, minions dissolve, nothing throws afterwards
      boss.vulnerable = true;
      fw.w.killEnemy(boss);
      expect(danger(fw), `${id} leaves no live attacks behind`).toBe(0);
      step(fw, 2.5);
      expect(fw.w.enemies.filter((e) => e.alive && e.mem.owner === boss).length, `${id} minions dissolve`).toBe(0);
      expect(fw.entities.filter((e) => (e instanceof InkFlood || e instanceof Blackout) && !e.dead).length, `${id} overlays fade`).toBe(0);
    });
  }

  it('summoners keep their minion count bounded', () => {
    for (const id of Object.keys(BOSSES)) {
      const fw = fakeWorld(`minions6-${id}`);
      const boss = fw.w.spawnEnemy(id, 168, 90)!;
      boss.dormant = 0;
      boss.hp = boss.maxHp * 0.2;
      let most = 0;
      step(fw, 40, () => {
        most = Math.max(most, fw.w.enemies.filter((e) => e.alive && e.mem.owner === boss).length);
      });
      expect(most, id).toBeLessThanOrEqual(4);
    }
  });

  it('the lighthouse places shelf cover on BLOCK tiles that its own slams may topple', () => {
    const fw = fakeWorld('shelves');
    const boss = fw.w.spawnEnemy('sunken_lighthouse', 168, 90)!;
    boss.dormant = 0;
    const shelves = fw.entities.filter((e): e is Shelf => e instanceof Shelf);
    expect(shelves.length).toBeGreaterThanOrEqual(3);
    for (const s of shelves) {
      expect(fw.tiles.get(`${s.tx},${s.ty}`)).toBe(Tile.BLOCK);
      expect(fw.tiles.get(`${s.tx + 1},${s.ty}`)).toBe(Tile.BLOCK);
      expect(s.persistent).toBe(true);
    }
    shelves[0].collapse(fw.w);
    expect(shelves[0].standing).toBe(false);
    expect(fw.tiles.get(`${shelves[0].tx},${shelves[0].ty}`)).toBe(Tile.RUBBLE);
  });
});

// ---------------------------------------------------------------- mechanics
describe('floor 6 boss mechanics', () => {
  it('the lamp beam hurts in lit water, never in a shelf shadow, never while charging', () => {
    const run = (px: number, py: number, block: boolean, secs: number) => {
      const fw = fakeWorld('beam');
      fw.player.x = px;
      fw.player.y = py;
      if (block) fw.tiles.set('7,5', Tile.BLOCK); // tile x 112..128, y 80..96
      const boss = fw.w.spawnEnemy('sunken_lighthouse', 168, 90)!;
      boss.script.stop();
      fw.hurts = 0;
      // a beam pointing left (toward x < 168), not sweeping
      fw.w.spawn(new LampBeam(boss, Math.PI, { source: 't', warn: 0.6, duration: 1.5, omega: 0, half: 0.15 }));
      step(fw, secs, undefined, false);
      return fw.hurts;
    };
    expect(run(60, 90, false, 0.4)).toBe(0); // still charging
    expect(run(60, 90, false, 1.2)).toBe(1); // lit, hit once (rehit cooldown)
    expect(run(60, 90, false, 2.0)).toBe(2); // rehit after the cooldown
    expect(run(60, 90, true, 2.0)).toBe(0); // the shelf between keeper and lamp shades them
    expect(run(60, 150, false, 2.0)).toBe(0); // outside the wedge
  });

  it('the ink flood only hurts off the islands, and only once risen', () => {
    const make = (px: number, py: number) => {
      const fw = fakeWorld('flood');
      fw.player.x = px;
      fw.player.y = py;
      const boss = fw.w.spawnEnemy('grand_archivist', 168, 90)!;
      boss.script.stop();
      fw.hurts = 0;
      const flood = fw.w.spawn(new InkFlood(boss, [{ x: 100, y: 100 }, { x: 240, y: 120 }], { rise: 1, hold: 2, drain: 0.5, source: 't', islandR: 30 }));
      return { fw, flood, boss };
    };
    const a = make(100, 100);
    step(a.fw, 2.5, undefined, false);
    expect(a.fw.hurts).toBe(0);
    const b = make(170, 110);
    step(b.fw, 0.8, undefined, false);
    expect(b.fw.hurts).toBe(0); // rising: not yet armed
    step(b.fw, 1.0, undefined, false);
    expect(b.fw.hurts).toBeGreaterThan(0);
    // the boss falling drains it and it stops hurting
    const c = make(170, 110);
    step(c.fw, 1.2, undefined, false);
    c.fw.w.killEnemy(c.boss);
    const h = c.fw.hurts;
    expect(c.flood.armed).toBe(false);
    step(c.fw, 1, undefined, false);
    expect(c.fw.hurts).toBe(h);
    expect(c.flood.dead).toBe(true);
  });

  it('page walls soak up shots, tear harmlessly when broken and burst into glyphs otherwise', () => {
    const fw = fakeWorld('pages');
    const boss = fw.w.spawnEnemy('grand_archivist', 168, 90)!;
    boss.script.stop();
    const wall = fw.w.spawn(new PageWall(120, 120, boss, 1.0));
    expect(wall.team).toBe('neutral');
    for (let i = 0; i < 3; i++) expect(wall.takeHit(fw.w, { damage: 25, kind: 'projectile' })).toBe(true);
    expect(wall.dead).toBe(true);
    step(fw, 0.5, undefined, false);
    expect(fw.entities.filter((e) => e instanceof Projectile).length).toBe(0);
    const wall2 = fw.w.spawn(new PageWall(200, 120, boss, 0.5));
    step(fw, 0.6, undefined, false);
    expect(wall2.dead).toBe(true);
    const glyphs = fw.entities.filter((e) => e instanceof Projectile && e.team === 'enemy') as Projectile[];
    expect(glyphs.length).toBeGreaterThanOrEqual(6);
    for (const g of glyphs) expect(g.owner).toBe(boss);
  });

  it('an ink stroke hurts only along its drawn part, once', () => {
    const run = (px: number, py: number) => {
      const fw = fakeWorld('stroke');
      fw.player.x = px;
      fw.player.y = py;
      fw.w.spawn(new InkStroke(32, 100, 0, 272, { source: 't', sweep: 0.3, half: 7 }));
      step(fw, 1.2, undefined, false);
      return fw.hurts;
    };
    expect(run(150, 100)).toBe(1);
    expect(run(150, 130)).toBe(0);
    expect(run(290, 101)).toBe(1);
  });
});
