// Floor 7 (멈춘 태엽탑): the floor definition, theme + room art, music track, room
// templates, the enemy roster (definitions, sprites, balance, spawnability), the shared
// helpers (beat, ricochet path, time field) and a headless simulation that runs every
// enemy script for 12 s.

import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Enemies, Floors, RoomTemplates, Themes } from '../src/game/defs';
import { Enemy } from '../src/game/enemy';
import { Entity } from '../src/game/entity';
import { GroundWarning } from '../src/game/effects';
import { Projectile } from '../src/game/projectile';
import { Room } from '../src/game/room';
import { hasThemeArt, renderRoomPainter } from '../src/game/roomart';
import { generateFloor, shapeOf } from '../src/game/dungeon';
import { SHAPE_CELLS } from '../src/game/constants';
import { getAnim, hasAnim, hasSprite, listSprites } from '../src/engine/sprites';
import { RNG } from '../src/engine/rng';
import { hexToRgb } from '../src/engine/math';
import { MUSIC_IDS, SFX_NAMES, hasSfx, hasTrack } from '../src/audio/audio';
import { loopSeconds, songDefs } from '../src/audio/song';
import type { World } from '../src/game/world';
import { BUL } from '../src/content/enemies/shared';
import {
  BEAT, beatCrossed, beatIndex, bouncePath, cogSprite, echoTick, fieldFactor, reflectAngle, SteamLane, tickSprite, TimeField, timeSlow,
} from '../src/content/enemies/clock-shared';
import { dollCrack } from '../src/content/enemies/clock';
import { arcSpots, bladeHits, echoSpots, ventAngles } from '../src/content/enemies/clock-deep';
import { PixelPainter } from '../src/engine/painter';
import { paintDial, paintGear } from '../src/content/props/clock';

loadContent();

const FLOOR = 7;
/** Floor-7 regular enemies and their floors. */
const ENEMIES: Record<string, number[]> = {
  windup_mouse: [7],
  cuckoo_clock: [7, 8],
  rolling_gear: [7, 8],
  porcelain_doll: [7],
  pendulum_warden: [7],
  time_anchor: [7],
  steam_golem: [7],
  rewind_ghost: [7, 8],
  alarm_bomber: [7],
  hand_guardian: [7],
};
const ALL = Object.keys(ENEMIES);

function spriteDefined(name: string): boolean {
  if (hasAnim(name)) {
    const a = getAnim(name)!;
    return a.frames.length > 0 && a.frames.every((f) => hasSprite(f));
  }
  return hasSprite(name);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---------------------------------------------------------------- definitions
describe('floor 7 definition', () => {
  const floor = Floors.all().find((f) => f.index === FLOOR)!;

  it('is registered with its theme, music and extra rooms', () => {
    expect(floor).toBeDefined();
    expect(floor.id).toBe('clock');
    expect(floor.theme).toBe('clock');
    expect(floor.music).toBe('floor7');
    expect(floor.name).toContain('7층');
    expect(floor.subtitle.length).toBeGreaterThan(3);
    expect(floor.hpMult).toBeGreaterThan(Floors.all().find((f) => f.index === 6)!.hpMult);
    expect(floor.enemyDamage?.[0]).toBe(2);
    expect(floor.budget[1]).toBeGreaterThanOrEqual(floor.budget[0]);
    expect(Object.keys(floor.extraRooms ?? {}).length).toBeGreaterThanOrEqual(2);
  });

  it('has a theme with room art, a music track and the new sound effects', () => {
    expect(Themes.has('clock')).toBe(true);
    expect(hasThemeArt('clock')).toBe(true);
    const theme = Themes.must('clock');
    expect(theme.paintFloor).toBeTypeOf('function');
    expect(theme.paintRock).toBeTypeOf('function');
    expect(theme.decorate).toBeTypeOf('function');
    expect(theme.ambientFx).toBeTypeOf('function');
    expect(theme.ambient).toMatch(/^#[0-9a-f]{6}$/i);
    expect(MUSIC_IDS).toContain('floor7');
    expect(hasTrack('floor7')).toBe(true);
    const song = songDefs.get('floor7')!;
    expect(song).toBeDefined();
    // a waltz: three beats to the bar
    expect(song.def.meter).toBe(3);
    expect(song.stepsPerBar).toBe(12);
    const loop = loopSeconds(song);
    expect(loop).toBeGreaterThanOrEqual(30);
    expect(loop).toBeLessThanOrEqual(70);
    expect(Object.values(song.def.channels).some((c) => c.layer === 'combat')).toBe(true);
    // the ticking layer is part of the base (it never stops)
    expect(song.def.channels.ticks.layer ?? 'base').toBe('base');
    for (const n of ['clock_tick', 'clock_spring', 'clock_ratchet', 'clock_chime', 'clock_steam', 'clock_pendulum', 'clock_crack', 'clock_rewind', 'clock_snap'] as const) {
      expect(SFX_NAMES).toContain(n);
      expect(hasSfx(n), n).toBe(true);
    }
  });

  it('palette is clearly distinct from the forge (iron / fire), the archive (teal), the sanctum (ice) and the abyss (void)', () => {
    const c = Themes.must('clock').palette;
    const mid = (p: string[]) => hexToRgb(p[Math.floor(p.length / 2)]);
    const [cr, cg, cb] = mid(c.floor);
    // warm walnut: red > green > blue by a clear margin
    expect(cr).toBeGreaterThan(cg + 12);
    expect(cg).toBeGreaterThan(cb);
    const [fr, fg, fb] = mid(Themes.must('forge').palette.floor);
    // the forge floor is near-black iron: ours is clearly brighter and more saturated
    expect(cr + cg + cb).toBeGreaterThan(fr + fg + fb + 50);
    expect(cr - cb).toBeGreaterThan(fr - fb + 12);
    const [ar, , ab] = mid(Themes.must('archive').palette.floor);
    expect(ab).toBeGreaterThan(ar);
    const [sr, , sb] = mid(Themes.must('sanctum').palette.floor);
    expect(sb).toBeGreaterThan(sr);
    const [vr, vg, vb] = mid(Themes.must('abyss').palette.floor);
    expect(vb).toBeGreaterThan(vg);
    expect(vr).toBeLessThan(cr);
    // brass and verdigris accents
    const [br, bg, bb] = hexToRgb(c.accent[0]);
    expect(br).toBeGreaterThan(bg);
    expect(bg).toBeGreaterThan(bb + 40);
    const [gr, gg, gb] = hexToRgb(c.accent[1]);
    expect(gg).toBeGreaterThan(gr + 40);
    expect(gg).toBeGreaterThan(gb);
  });
});

// ---------------------------------------------------------------- room templates
describe('floor 7 room templates', () => {
  const mine = RoomTemplates.all().filter((t) => t.floors?.length === 1 && t.floors[0] === FLOOR);

  it('provides normal layouts in every shape plus special variants', () => {
    const normal = mine.filter((t) => t.kinds.includes('normal'));
    expect(normal.length).toBeGreaterThanOrEqual(10);
    for (const shape of ['1x1', '2x1', '1x2', '2x2'] as const) {
      expect(normal.filter((t) => t.shape === shape).length, shape).toBeGreaterThanOrEqual(shape === '1x1' ? 5 : 2);
    }
    expect(mine.some((t) => t.kinds.includes('start'))).toBe(true);
    expect(mine.some((t) => t.kinds.includes('treasure'))).toBe(true);
    expect(mine.some((t) => t.kinds.includes('boss'))).toBe(true);
    // the spire's signature obstacles: pendulum pillars (X) and gear shafts (O)
    expect(normal.filter((t) => t.rows.some((r) => r.includes('X'))).length).toBeGreaterThanOrEqual(8);
    expect(normal.filter((t) => t.rows.some((r) => r.includes('O'))).length).toBeGreaterThanOrEqual(6);
  });

  it('generated floors mostly use the clockwork templates for normal rooms', () => {
    const floor = Floors.all().find((f) => f.index === FLOOR)!;
    let normal = 0;
    let clock = 0;
    for (let s = 0; s < 30; s++) {
      const map = generateFloor(floor, new RNG(`f7-${s}`));
      for (const n of map.nodes) {
        const t = RoomTemplates.get(n.templateId)!;
        expect(t, `${n.kind} ${shapeOf(n)}`).toBeTruthy();
        if (t.floors) expect(t.floors).toContain(FLOOR);
        if (n.kind === 'normal') {
          normal++;
          if (t.id.startsWith('ck')) clock++;
        }
      }
    }
    expect(normal).toBeGreaterThan(100);
    expect(clock / normal).toBeGreaterThan(0.2);
  });

  it('renders every clockwork template with the clock theme, fully opaque', () => {
    const theme = Themes.must('clock');
    for (const t of mine) {
      const [cw, ch] = SHAPE_CELLS[t.shape];
      const node = { id: 0, gx: 0, gy: 0, cw, ch, kind: t.kinds[0], templateId: t.id, seed: 4321 + t.id.length, depth: 1, visited: false, cleared: false, discovered: false, locked: false, doors: [] };
      const room = new Room(node, theme, t);
      room.addDoor('N', 0, 0, 1, 'normal', false);
      room.addDoor('W', 0, 0, 2, 'treasure', false);
      const p = renderRoomPainter(room);
      let holes = 0;
      for (let i = 0; i < p.data.length; i++) if (p.data[i] >>> 24 === 0) holes++;
      expect(holes, t.id).toBe(0);
    }
  }, 30000);
});

// ---------------------------------------------------------------- enemies
describe('floor 7 enemy definitions', () => {
  it('registers the roster with the expected floors', () => {
    for (const [id, floors] of Object.entries(ENEMIES)) {
      const d = Enemies.get(id);
      expect(d, id).toBeDefined();
      expect(d!.floors, id).toEqual(floors);
      expect(d!.boss, id).toBeFalsy();
      expect(d!.name, id).toMatch(/[가-힣]/);
    }
    expect(ALL.length).toBeGreaterThanOrEqual(7);
    expect(Object.values(ENEMIES).filter((f) => f.length > 1).length).toBeGreaterThanOrEqual(1);
  });

  it('the floor-7 pool is varied: fodder, turrets, casters and heavy hitters', () => {
    const pool = Enemies.all().filter((d) => !d.boss && d.floors?.includes(FLOOR));
    expect(pool.length).toBeGreaterThanOrEqual(8);
    const costs = pool.map((d) => d.cost ?? 1);
    expect(Math.min(...costs)).toBeLessThanOrEqual(1);
    expect(Math.max(...costs)).toBeGreaterThanOrEqual(3);
    expect(pool.some((d) => d.flying)).toBe(true);
    expect(pool.some((d) => !d.flying)).toBe(true);
    expect(pool.some((d) => d.speed === 0)).toBe(true);
    const floor = Floors.all().find((f) => f.index === FLOOR)!;
    const avgCost = costs.reduce((a, b) => a + b, 0) / costs.length;
    expect(floor.budget[0] / avgCost).toBeGreaterThan(3);
  });

  it('stats follow the balance guide (floor-1 scale numbers)', () => {
    for (const id of ALL) {
      const d = Enemies.must(id);
      expect(d.hp, id).toBeGreaterThanOrEqual(6);
      expect(d.hp, id).toBeLessThanOrEqual(120);
      expect(d.cost ?? 1, id).toBeGreaterThan(0);
      expect(d.cost ?? 1, id).toBeLessThanOrEqual(4);
      expect(d.speed ?? 40, id).toBeLessThan(84);
      expect(d.contactDamage ?? 1, id).toBeLessThanOrEqual(2);
      expect(d.radius, id).toBeGreaterThan(2);
      expect(d.deathFx, id).toBeDefined();
      expect(d.bloodColor, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(d.light, id).toBeDefined();
      expect(d.script, id).toBeTypeOf('function');
      expect(d.champion, id).toBe(true);
      expect(spriteDefined(d.sprite), `${id} sprite "${d.sprite}"`).toBe(true);
    }
    const avg = ALL.reduce((s, id) => s + Enemies.must(id).hp, 0) / ALL.length;
    expect(avg).toBeGreaterThan(35);
  });

  it('every enemy has move / attack / hurt frames, and every referenced sprite exists', () => {
    const sources = import.meta.glob(['../src/content/enemies/clock*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(3);
    const names = new Set<string>();
    for (const src of Object.values(sources)) {
      for (const m of src.matchAll(/setAnim\(`?'?([a-z0-9_]+)'?/g)) if (!m[1].includes('$')) names.add(m[1]);
      for (const m of src.matchAll(/r\.sprite\('([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/sprite: '([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/hurtFrame\(e, w, '([a-z0-9_]+)'/g)) names.add(m[1]);
    }
    expect(names.size).toBeGreaterThan(25);
    for (const n of names) expect(spriteDefined(n), n).toBe(true);
    const all = listSprites();
    for (const id of ALL) {
      const d = Enemies.must(id);
      const prefix = d.sprite.split('_')[0];
      const states = new Set(all.filter((n) => n.startsWith(prefix + '_') && hasAnim(n.replace(/_\d+$/, ''))).map((n) => n.split('_')[1]));
      expect(states.has('hurt'), `${id} hurt frame`).toBe(true);
      expect(states.size, `${id} states ${[...states]}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('clockwork bullets are high-contrast, pop against the parquet and differ from the archive glyphs', () => {
    for (const k of ['cog', 'tick'] as const) {
      const pal = BUL[k];
      expect(contrast(pal.color, pal.outline), k).toBeGreaterThan(6);
      expect(contrast(pal.core, pal.outline), k).toBeGreaterThan(12);
      expect(luminance(pal.core), k).toBeGreaterThan(0.7);
      expect(contrast(pal.color, '#4e3430'), k).toBeGreaterThan(4);
    }
    // cogs are hot orange (not the archive's cyan, not the page's pale yellow)
    const [r, g, b] = hexToRgb(BUL.cog.color);
    expect(r).toBeGreaterThan(g + 60);
    expect(g).toBeGreaterThan(b + 60);
    const [tr, tg, tb] = hexToRgb(BUL.tick.color);
    const [gr, gg, gb] = hexToRgb(BUL.glyph.color);
    // ticks lean green where glyphs lean blue
    expect(tg - tb).toBeGreaterThan(gg - gb + 20);
    expect(tr).toBeGreaterThan(gr);
    for (const d of [5, 7, 9]) expect(hasSprite(cogSprite(d))).toBe(true);
    for (const l of [6, 9, 12]) expect(hasSprite(tickSprite(l))).toBe(true);
  });

  it('the gear and dial painters draw solid, outlined-ready shapes', () => {
    const g = new PixelPainter(17, 17);
    paintGear(g, 8.5, 8.5, 5, 10, ['#111111', '#444444', '#777777', '#aaaaaa', '#dddddd'], 0, { spokes: 4 });
    expect(g.isSet(8, 8)).toBe(true); // hub
    expect(g.isSet(8, 4)).toBe(true); // the rim
    expect(g.isSet(8, 0)).toBe(false); // beyond the teeth
    let set = 0;
    for (let i = 0; i < g.data.length; i++) if (g.data[i] >>> 24) set++;
    expect(set).toBeGreaterThan(60);
    expect(set).toBeLessThan(17 * 17);
    const d = new PixelPainter(15, 15);
    paintDial(d, 7.5, 7.5, 6, 3, 0, { second: null });
    expect(d.isSet(7, 7)).toBe(true);
    expect(d.isSet(0, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------- helpers
describe('floor 7 helpers', () => {
  it('beats: every BEAT seconds, crossings only at the boundaries', () => {
    expect(beatIndex(0)).toBe(0);
    expect(beatIndex(BEAT * 2.5)).toBe(2);
    expect(beatCrossed(0.1, 0.2)).toBe(false);
    expect(beatCrossed(BEAT - 0.01, BEAT + 0.01)).toBe(true);
    expect(beatCrossed(BEAT * 3, BEAT * 3 + 0.001)).toBe(false);
  });

  it('bouncePath ricochets off the room walls and keeps its segments inside', () => {
    const room = { boxBlocked: (x: number, y: number, r: number) => x - r < 32 || y - r < 32 || x + r > 304 || y + r > 176 };
    const segs = bouncePath(room, 100, 100, 0.3, 6, 3, 400);
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs.length).toBeLessThanOrEqual(3);
    for (const s of segs) {
      expect(s.x1).toBeGreaterThanOrEqual(32);
      expect(s.x1).toBeLessThanOrEqual(304);
      expect(s.y1).toBeGreaterThanOrEqual(32);
      expect(s.y1).toBeLessThanOrEqual(176);
    }
    // the first bounce is off the right wall: the heading mirrors horizontally
    expect(Math.cos(segs[1].angle)).toBeLessThan(0);
    expect(Math.sign(Math.sin(segs[1].angle))).toBe(Math.sign(Math.sin(segs[0].angle)));
    // a straight run that never hits a wall is a single segment of maxLen
    const one = bouncePath(room, 100, 100, 0, 6, 3, 60);
    expect(one).toHaveLength(1);
    expect(one[0].x1).toBeCloseTo(160);
    expect(reflectAngle(room, 300, 100, 0, 6)).toBeCloseTo(Math.PI);
    expect(Math.sin(reflectAngle(room, 100, 172, Math.PI / 2, 6))).toBeCloseTo(-1);
  });

  it('fieldFactor slows enemy shots hard and the keeper\'s a little', () => {
    expect(fieldFactor('enemy', 0.32)).toBe(0.32);
    expect(fieldFactor('player', 0.32)).toBe(0.55);
  });

  it('dollCrack: pristine, cracked, broken', () => {
    expect(dollCrack(44, 44)).toBe(0);
    expect(dollCrack(25, 44)).toBe(1);
    expect(dollCrack(10, 44)).toBe(2);
  });

  it('arcSpots / bladeHits describe the pendulum sweep', () => {
    const pts = arcSpots(0, 0, 0, Math.PI, 5, 20);
    expect(pts).toHaveLength(5);
    expect(pts[0].x).toBeCloseTo(20);
    expect(pts[4].x).toBeCloseTo(-20);
    expect(pts[2].y).toBeCloseTo(16);
    expect(bladeHits(0, 0, 0, 24, 0)).toBe(true);
    expect(bladeHits(0, 0, 0, -24, 0)).toBe(false);
    expect(bladeHits(0, 0, 0, 60, 0)).toBe(false);
    expect(bladeHits(0, 0, Math.PI / 2, 0, 20)).toBe(true);
  });

  it('ventAngles fans lanes to both sides; echoSpots walks the record backwards', () => {
    expect(ventAngles(1, 1, 0.5)).toEqual([1, 0.5, 1.5]);
    expect(ventAngles(0, 2, 0.4)).toHaveLength(5);
    const e = echoSpots([0, 1, 2, 3, 4, 5, 6], [0, 10, 20, 30, 40, 50, 60], 3);
    expect(e.map((s) => s.x)).toEqual([6, 3, 0]);
  });
});

// ---------------------------------------------------------------- headless AI simulation
interface FakePlayer {
  x: number; y: number; vx: number; vy: number; r: number; z: number; alive: boolean; aim: number;
  kbx: number; kby: number; lastAttackAt: number; statuses: Map<string, unknown>; hurts: number;
  hurt(): boolean; knock(): void; hasStatus(k: string): boolean; applyStatus(s: { kind: string }): boolean;
}
interface FakeWorld {
  w: World;
  entities: Entity[];
  player: FakePlayer;
}

const IX = 32;
const IY = 32;
const IW = 272;
const IH = 144;

function fakeWorld(seed: string): FakeWorld {
  const inside = (x: number, y: number, r: number) => x - r >= IX && y - r >= IY && x + r <= IX + IW && y + r <= IY + IH;
  const room = {
    interiorX: IX, interiorY: IY, interiorW: IW, interiorH: IH, centerX: IX + IW / 2, centerY: IY + IH / 2,
    boxBlocked: (x: number, y: number, r: number) => !inside(x, y, r),
    isFree: (x: number, y: number, r = 6) => inside(x, y, r),
    nearestFree: (x: number, y: number, r = 6) => ({ x: Math.min(IX + IW - r, Math.max(IX + r, x)), y: Math.min(IY + IH - r, Math.max(IY + r, y)) }),
    lineOfSight: () => true,
    tileAt: (tx: number, ty: number) => (inside(tx * 16 + 8, ty * 16 + 8, 0) ? 0 : 1),
    tileAtPx: (x: number, y: number) => (inside(x, y, 0) ? 0 : 1),
    destroyTile: () => {},
    damageTile: () => {},
    doors: [],
  };
  const player: FakePlayer = {
    x: IX + IW / 2, y: IY + IH - 30, vx: 0, vy: 0, r: 5, z: 0, alive: true, aim: 0, kbx: 0, kby: 0, lastAttackAt: -99,
    statuses: new Map(), hurts: 0,
    hurt() { player.hurts++; return true; },
    knock() {},
    hasStatus: (k: string) => player.statuses.has(k),
    applyStatus(s: { kind: string }) { player.statuses.set(s.kind, s); return true; },
  };
  const entities: Entity[] = [];
  const enemies: Enemy[] = [];
  const projectiles: Projectile[] = [];
  const w = {
    rng: new RNG(seed),
    dt: 1 / 60,
    time: 0,
    roomTime: 0,
    enemyTimeScale: 1,
    floor: { index: FLOOR, hpMult: 1 },
    vars: {} as Record<string, number>,
    player,
    targets: () => [player],
    room,
    enemies,
    projectiles,
    entities,
    flow: { dirAt: () => null },
    particles: { burst: () => {}, spawn: () => {} },
    lights: { add: () => {}, glow: () => {} },
    spawn<T extends Entity>(e: T): T {
      entities.push(e);
      if (e instanceof Enemy) enemies.push(e);
      if (e instanceof Projectile) projectiles.push(e);
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
    explode: () => {},
    sfx: () => {},
    shake: () => {},
    hitstop: () => {},
    decal: () => {},
    statusDamage: () => {},
    nearestEnemy: () => null,
  };
  return { w: w as unknown as World, entities, player };
}

function step(fw: FakeWorld, seconds: number, onFrame?: (t: number) => void, strafe = true): void {
  const w = fw.w as unknown as { time: number; roomTime: number; dt: number; enemies: Enemy[]; projectiles: Projectile[] };
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) {
    w.time += w.dt;
    w.roomTime += w.dt;
    if (strafe) {
      fw.player.x = 168 + Math.cos(w.time * 0.8) * 90;
      fw.player.y = 104 + Math.sin(w.time * 1.1) * 45;
    }
    fw.player.kbx *= Math.exp(-w.dt * 10);
    fw.player.kby *= Math.exp(-w.dt * 10);
    for (const e of [...fw.entities]) if (!e.dead) e.update(fw.w, w.dt);
    for (const e of w.enemies) if (!e.dead && e.hp <= 0) fw.w.killEnemy(e);
    const alive = fw.entities.filter((e) => !e.dead);
    fw.entities.splice(0, fw.entities.length, ...alive);
    w.enemies.splice(0, w.enemies.length, ...w.enemies.filter((e) => !e.dead));
    w.projectiles.splice(0, w.projectiles.length, ...w.projectiles.filter((e) => !e.dead));
    onFrame?.(w.time);
  }
}

describe('floor 7 enemy AI (headless simulation)', () => {
  for (const id of ALL) {
    it(`${id} runs its script for 12s without errors and stays in the room`, () => {
      const fw = fakeWorld(`sim7-${id}`);
      const e = fw.w.spawnEnemy(id, 120, 70)!;
      expect(e).toBeTruthy();
      step(fw, 12, (t) => {
        fw.player.lastAttackAt = Math.floor(t * 2) / 2;
        for (const o of fw.w.enemies) {
          expect(Number.isFinite(o.x) && Number.isFinite(o.y), `${o.def.id} position`).toBe(true);
          expect(o.x).toBeGreaterThan(0);
          expect(o.y).toBeGreaterThan(0);
          expect(o.x).toBeLessThan(400);
          expect(o.y).toBeLessThan(260);
        }
      });
      if (e.alive) {
        e.vulnerable = true;
        e.hidden = false;
        fw.w.killEnemy(e);
      }
      step(fw, 1.5);
    });
  }

  it('every enemy produces telegraphed danger (bullets, lanes, fields, warnings) within 12s', () => {
    for (const id of ALL) {
      const fw = fakeWorld(`danger7-${id}`);
      fw.w.spawnEnemy(id, 120, 70);
      let dangerous = 0;
      let warnings = 0;
      step(fw, 12, (t) => {
        fw.player.lastAttackAt = Math.floor(t * 2) / 2;
        dangerous = Math.max(dangerous, fw.entities.filter((x) => (x.team === 'enemy' && !(x instanceof Enemy)) || x.enemyHazard || x instanceof GroundWarning).length);
        warnings = Math.max(warnings, fw.entities.filter((x) => x instanceof GroundWarning).length);
      });
      expect(dangerous, id).toBeGreaterThan(0);
      // every dangerous attack is telegraphed on the floor (lanes / circles); the cuckoo
      // keeps time with the whole floor's beat instead
      if (id !== 'cuckoo_clock') expect(warnings, `${id} warning`).toBeGreaterThan(0);
    }
  });

  it('wind-up mice warn along a lane, zip, then sit run down before the next wind', () => {
    const fw = fakeWorld('mouse');
    const e = fw.w.spawnEnemy('windup_mouse', 120, 70)!;
    let lane = false;
    let zipped = 0;
    let down = 0;
    let zipAt = -1;
    step(fw, 6, (t) => {
      if (fw.entities.some((x) => x instanceof GroundWarning && x.rw > 0)) lane = true;
      if (e.anim === 'ckmouse_zip') {
        zipped = Math.max(zipped, Math.hypot(e.vx, e.vy));
        if (zipAt < 0) zipAt = t;
      }
      if (e.anim === 'ckmouse_down') down++;
    });
    expect(lane).toBe(true);
    expect(zipped).toBeGreaterThan(150);
    expect(down).toBeGreaterThan(30);
    expect(zipAt).toBeGreaterThan(0.6);
  });

  it('cuckoo clocks open on one beat and fire on the next, in step with the floor', () => {
    const fw = fakeWorld('cuckoo');
    fw.w.spawnEnemy('cuckoo_clock', 168, 60);
    fw.w.spawnEnemy('cuckoo_clock', 220, 60);
    const shotsAt: number[] = [];
    const seen = new Set<number>();
    step(fw, 7, (t) => {
      for (const p of fw.w.projectiles) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        shotsAt.push(t);
      }
    });
    expect(shotsAt.length).toBeGreaterThanOrEqual(12);
    // shots land right after beat boundaries
    for (const t of shotsAt) expect((t % BEAT) < 0.04 || (t % BEAT) > BEAT - 0.04, `shot at ${t}`).toBe(true);
    // both clocks fire together
    const beats = new Set(shotsAt.map((t) => beatIndex(t)));
    expect(beats.size * 2).toBeLessThanOrEqual(shotsAt.length);
  });

  it('a rolling gear shows its bounces, then rolls and ricochets off the walls', () => {
    const fw = fakeWorld('gear');
    const e = fw.w.spawnEnemy('rolling_gear', 100, 104)!;
    fw.player.x = 290;
    fw.player.y = 104;
    let lanes = 0;
    let rolled = 0;
    let maxCos = -2;
    let minCos = 2;
    step(fw, 7, () => {
      lanes = Math.max(lanes, fw.entities.filter((x) => x instanceof GroundWarning && x.rw > 0).length);
      const sp = Math.hypot(e.vx, e.vy);
      if (sp > 100) {
        rolled++;
        const c = e.vx / sp;
        maxCos = Math.max(maxCos, c);
        minCos = Math.min(minCos, c);
      }
    }, false);
    expect(lanes).toBeGreaterThanOrEqual(2);
    expect(rolled).toBeGreaterThan(20);
    // it rolled right toward the keeper, hit the east wall and came back left
    expect(maxCos).toBeGreaterThan(0.6);
    expect(minCos).toBeLessThan(-0.6);
    expect(e.x).toBeLessThan(IX + IW);
  });

  it('the porcelain doll cracks as it is hurt, and its spin rings the room with cogs', () => {
    const fw = fakeWorld('doll');
    const e = fw.w.spawnEnemy('porcelain_doll', 168, 80)!;
    fw.player.x = 168;
    fw.player.y = 150;
    expect(e.mem.crack).toBe(0);
    e.takeHit(fw.w, { damage: 20, kind: 'projectile' });
    expect(e.mem.crack).toBe(1);
    e.takeHit(fw.w, { damage: 12, kind: 'projectile' });
    expect(e.mem.crack).toBe(2);
    let shots = 0;
    let warned = false;
    step(fw, 7, () => {
      shots = Math.max(shots, fw.w.projectiles.length);
      if (fw.entities.some((x) => x instanceof GroundWarning && x.rw === 0)) warned = true;
    }, false);
    expect(warned).toBe(true);
    expect(shots).toBeGreaterThanOrEqual(10);
  });

  it('the pendulum warden sweeps its blade through an arc of warnings up close', () => {
    const fw = fakeWorld('warden');
    const e = fw.w.spawnEnemy('pendulum_warden', 168, 100)!;
    e.speed = 0;
    fw.player.x = 200;
    fw.player.y = 100;
    let arcs = 0;
    let swung = false;
    let maxBlade = -9;
    let minBlade = 9;
    step(fw, 5, () => {
      fw.player.x = 200;
      fw.player.y = 100;
      arcs = Math.max(arcs, fw.entities.filter((x) => x instanceof GroundWarning && x.rw === 0 && x.radius === 9).length);
      if (e.anim === 'ckwarden_swing') {
        swung = true;
        maxBlade = Math.max(maxBlade, e.mem.blade);
        minBlade = Math.min(minBlade, e.mem.blade);
      }
    }, false);
    expect(arcs).toBeGreaterThanOrEqual(5);
    expect(swung).toBe(true);
    expect(maxBlade - minBlade).toBeGreaterThan(1.5);
    expect(fw.player.hurts).toBeGreaterThan(0);
  });

  it('the time anchor drops a field that slows bullets inside, then snaps them back faster', () => {
    const fw = fakeWorld('anchor');
    fw.w.spawnEnemy('time_anchor', 168, 50);
    fw.player.x = 168;
    fw.player.y = 150;
    let field: TimeField | null = null;
    let slowed = false;
    step(fw, 6, () => {
      fw.player.x = 168;
      fw.player.y = 150;
      const f = fw.entities.find((x): x is TimeField => x instanceof TimeField);
      if (f) field = f;
      for (const p of fw.w.projectiles) if (p.mem.__tzK !== undefined && p.mem.__tzK < 1 && Math.hypot(p.vx, p.vy) < 60) slowed = true;
    }, false);
    expect(field).not.toBeNull();
    expect(field!.radius).toBeGreaterThan(30);
    expect(slowed).toBe(true);
  });

  it('TimeField: a shot crawls inside the field and races after the snap', () => {
    const fw = fakeWorld('field');
    const f = fw.w.spawn(new TimeField(100, 100, 40, 0.6, 0.3));
    // armed after 0.45 s: a shot entering it is stamped every step and crawls
    step(fw, 0.5, undefined, false);
    expect(f.active).toBe(true);
    const p = fw.w.spawn(new Projectile({ team: 'enemy', x: 100, y: 100, angle: 0, speed: 100, damage: 1 }));
    step(fw, 0.2, undefined, false);
    const crawl = (p.x - 100) / 0.2;
    expect(crawl).toBeLessThan(45);
    expect(crawl).toBeGreaterThan(15);
    // the snap (at 1.05 s): it races
    step(fw, 0.4, undefined, false);
    expect(f.snapped).toBe(true);
    const x1 = p.x;
    step(fw, 0.1, undefined, false);
    expect((p.x - x1) / 0.1).toBeGreaterThan(140);
    // a dispelled field never snaps
    const fw2 = fakeWorld('field2');
    const g = fw2.w.spawn(new TimeField(100, 100, 40, 0.6, 0.3));
    step(fw2, 0.5, undefined, false);
    g.onCleared!(fw2.w);
    step(fw2, 0.6, undefined, false);
    expect(g.snapped).toBe(false);
    expect(g.dead).toBe(true);
    expect(timeSlow.id).toBe('time-slow');
  });

  it('the steam golem vents telegraphed lanes that scald, stomps up close, then overheats', () => {
    const fw = fakeWorld('golem');
    const e = fw.w.spawnEnemy('steam_golem', 60, 100)!;
    e.speed = 0;
    fw.player.x = 160;
    fw.player.y = 100;
    let lanes = 0;
    let steam = 0;
    step(fw, 7, () => {
      fw.player.x = 160;
      fw.player.y = 100;
      lanes = Math.max(lanes, fw.entities.filter((x) => x instanceof GroundWarning && x.rw > 0).length);
      steam = Math.max(steam, fw.entities.filter((x) => x instanceof SteamLane).length);
    }, false);
    expect(lanes).toBeGreaterThanOrEqual(3);
    expect(steam).toBeGreaterThanOrEqual(3);
    expect(fw.player.hurts).toBeGreaterThan(0);
    expect(e.mem.hasteT).toBeGreaterThan(0);
    // up close: the stomp
    const fw2 = fakeWorld('golem2');
    const g = fw2.w.spawnEnemy('steam_golem', 160, 100)!;
    g.speed = 0;
    let stomps = 0;
    step(fw2, 5, () => {
      fw2.player.x = g.x + 26;
      fw2.player.y = g.y;
      stomps = Math.max(stomps, fw2.entities.filter((x) => x instanceof GroundWarning && x.rw === 0 && x.radius === 34).length);
    }, false);
    expect(stomps).toBeGreaterThan(0);
    expect(fw2.player.hurts).toBeGreaterThan(0);
  });

  it('a steam lane hurts only inside its rectangle and dies with a bullet-clear', () => {
    const fw = fakeWorld('lane');
    const lane = fw.w.spawn(new SteamLane(100, 100, 0, 80, 14, '증기 골렘', 0.6));
    expect(lane.contains(140, 103)).toBe(true);
    expect(lane.contains(140, 112)).toBe(false);
    expect(lane.contains(190, 100)).toBe(false);
    expect(lane.contains(90, 100)).toBe(false);
    fw.player.x = 140;
    fw.player.y = 100;
    step(fw, 0.2, undefined, false);
    expect(fw.player.hurts).toBeGreaterThan(0);
    lane.onCleared!(fw.w);
    expect(lane.dead).toBe(true);
  });

  it('the rewind ghost retraces its drift and leaves echoes that launch at the keeper', () => {
    const fw = fakeWorld('ghost');
    const e = fw.w.spawnEnemy('rewind_ghost', 100, 60)!;
    let rewinding = false;
    let echoes = 0;
    let launched = 0;
    const seen = new Set<number>();
    step(fw, 8, () => {
      if (e.anim === 'ckghost_rewind') rewinding = true;
      for (const p of fw.w.projectiles) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          echoes++;
        }
        if (p.mem.go && Math.hypot(p.vx, p.vy) > 100) launched++;
      }
    });
    expect(rewinding).toBe(true);
    expect(echoes).toBeGreaterThanOrEqual(3);
    expect(launched).toBeGreaterThan(0);
    // an echo hangs still, then flies toward the keeper
    const fw2 = fakeWorld('echo');
    fw2.player.x = 100;
    fw2.player.y = 200;
    const p = new Projectile({ team: 'enemy', x: 100, y: 50, angle: 0, speed: 0, damage: 1, behaviors: [echoTick(0.5, 120)] });
    fw2.w.spawn(p);
    step(fw2, 0.3, undefined, false);
    expect(p.y).toBeCloseTo(50);
    step(fw2, 0.4, undefined, false);
    expect(p.mem.go).toBe(1);
    expect(Math.sin(p.angle)).toBeGreaterThan(0.95);
    expect(p.y).toBeGreaterThan(55);
  });
});
