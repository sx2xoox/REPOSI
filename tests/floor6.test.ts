// Floor 6 (수몰된 서고): the floor definition, theme + room art, music track, room
// templates, the enemy roster (definitions, sprites, balance, spawnability), the shared
// helpers, and a headless simulation that runs every enemy script for 12 s.

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
import { fogStrength, glyphSprite, InkDarkness, InkPool, inkGlyph, paintBookStack, toward } from '../src/content/enemies/archive-shared';
import { glyphLine, scribeCue } from '../src/content/enemies/archive';
import { PixelPainter } from '../src/engine/painter';

loadContent();

const FLOOR = 6;
/** Floor-6 regular enemies and their floors. */
const ENEMIES: Record<string, number[]> = {
  ink_droplet: [6],
  paper_moth: [6],
  drowned_scribe: [6],
  book_mimic: [6],
  archive_eel: [6],
  shelf_golem: [6],
  lantern_wraith: [6, 7],
  ink_jelly: [6, 7],
};
/** Spawned only by scripts. */
const MINIONS = ['ink_bead'];
const ALL = [...Object.keys(ENEMIES), ...MINIONS];

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
describe('floor 6 definition', () => {
  const floor = Floors.all().find((f) => f.index === FLOOR)!;

  it('is registered with its theme, music and extra rooms', () => {
    expect(floor).toBeDefined();
    expect(floor.id).toBe('archive');
    expect(floor.theme).toBe('archive');
    expect(floor.music).toBe('floor6');
    expect(floor.name).toContain('6층');
    expect(floor.subtitle.length).toBeGreaterThan(3);
    expect(floor.hpMult).toBeGreaterThan(Floors.all().find((f) => f.index === 5)!.hpMult);
    expect(floor.budget[1]).toBeGreaterThanOrEqual(floor.budget[0]);
    expect(Object.keys(floor.extraRooms ?? {}).length).toBeGreaterThanOrEqual(2);
  });

  it('has a theme with room art, a music track and the new sound effects', () => {
    expect(Themes.has('archive')).toBe(true);
    expect(hasThemeArt('archive')).toBe(true);
    const theme = Themes.must('archive');
    expect(theme.paintFloor).toBeTypeOf('function');
    expect(theme.paintRock).toBeTypeOf('function');
    expect(theme.decorate).toBeTypeOf('function');
    expect(theme.ambientFx).toBeTypeOf('function');
    expect(theme.ambient).toMatch(/^#[0-9a-f]{6}$/i);
    expect(MUSIC_IDS).toContain('floor6');
    expect(hasTrack('floor6')).toBe(true);
    const song = songDefs.get('floor6')!;
    expect(song).toBeDefined();
    const loop = loopSeconds(song);
    expect(loop).toBeGreaterThanOrEqual(30);
    expect(loop).toBeLessThanOrEqual(70);
    expect(Object.values(song.def.channels).some((c) => c.layer === 'combat')).toBe(true);
    for (const n of ['ink_splash', 'paper_flutter', 'water_surge'] as const) {
      expect(SFX_NAMES).toContain(n);
      expect(hasSfx(n), n).toBe(true);
    }
  });

  it('palette is clearly distinct from the sanctum (icy blue) and the abyss (void purple)', () => {
    const a = Themes.must('archive').palette;
    const s = Themes.must('sanctum').palette;
    const v = Themes.must('abyss').palette;
    const mid = (p: string[]) => hexToRgb(p[Math.floor(p.length / 2)]);
    const [ar, ag, ab] = mid(a.floor);
    const [, sg, sb] = mid(s.floor);
    const [vr, vg, vb] = mid(v.floor);
    // teal-ish: green close to blue, both well above red
    expect(ab).toBeGreaterThan(ar + 20);
    expect(ag).toBeGreaterThan(ar + 15);
    // the sanctum is much brighter / bluer, the abyss is purple (red > green)
    expect(sb - sg).toBeGreaterThan(ab - ag + 8);
    expect(vr).toBeGreaterThan(vg);
    expect(ag).toBeGreaterThan(ar);
    // the water is teal, not icy blue
    const [wr, wg, wb] = hexToRgb(a.accent[0]);
    expect(wg).toBeGreaterThan(wr + 40);
    expect(wb).toBeGreaterThan(wr + 40);
  });
});

// ---------------------------------------------------------------- room templates
describe('floor 6 room templates', () => {
  const mine = RoomTemplates.all().filter((t) => t.floors?.length === 1 && t.floors[0] === FLOOR);

  it('provides normal layouts in every shape plus special variants', () => {
    const normal = mine.filter((t) => t.kinds.includes('normal'));
    expect(normal.length).toBeGreaterThanOrEqual(8);
    for (const shape of ['1x1', '2x1', '1x2', '2x2'] as const) {
      expect(normal.filter((t) => t.shape === shape).length, shape).toBeGreaterThanOrEqual(shape === '1x1' ? 5 : 2);
    }
    expect(mine.some((t) => t.kinds.includes('start'))).toBe(true);
    expect(mine.some((t) => t.kinds.includes('boss'))).toBe(true);
    // the archive's signature obstacles: bookcases (X) and flooded channels (O)
    expect(normal.filter((t) => t.rows.some((r) => r.includes('X'))).length).toBeGreaterThanOrEqual(6);
    expect(normal.filter((t) => t.rows.some((r) => r.includes('O'))).length).toBeGreaterThanOrEqual(5);
  });

  it('generated floors mostly use the archive templates for normal rooms', () => {
    const floor = Floors.all().find((f) => f.index === FLOOR)!;
    let normal = 0;
    let archive = 0;
    for (let s = 0; s < 30; s++) {
      const map = generateFloor(floor, new RNG(`f6-${s}`));
      for (const n of map.nodes) {
        const t = RoomTemplates.get(n.templateId)!;
        expect(t, `${n.kind} ${shapeOf(n)}`).toBeTruthy();
        if (t.floors) expect(t.floors).toContain(FLOOR);
        if (n.kind === 'normal') {
          normal++;
          if (t.id.startsWith('ar')) archive++;
        }
      }
    }
    expect(normal).toBeGreaterThan(100);
    expect(archive / normal).toBeGreaterThan(0.2);
  });

  it('renders every archive template with the archive theme, fully opaque', () => {
    const theme = Themes.must('archive');
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
describe('floor 6 enemy definitions', () => {
  it('registers the roster with the expected floors', () => {
    for (const [id, floors] of Object.entries(ENEMIES)) {
      const d = Enemies.get(id);
      expect(d, id).toBeDefined();
      expect(d!.floors, id).toEqual(floors);
      expect(d!.boss, id).toBeFalsy();
      expect(d!.name, id).toMatch(/[가-힣]/);
    }
    for (const id of MINIONS) {
      expect(Enemies.get(id), id).toBeDefined();
      expect(Enemies.get(id)!.floors, id).toBeUndefined();
    }
    expect(Object.keys(ENEMIES).length).toBeGreaterThanOrEqual(7);
    expect(Object.values(ENEMIES).filter((f) => f.length > 1).length).toBeGreaterThanOrEqual(1);
  });

  it('the floor-6 pool is varied: fodder, casters and heavy hitters', () => {
    const pool = Enemies.all().filter((d) => !d.boss && d.floors?.includes(FLOOR));
    expect(pool.length).toBeGreaterThanOrEqual(8);
    const costs = pool.map((d) => d.cost ?? 1);
    expect(Math.min(...costs)).toBeLessThanOrEqual(1);
    expect(Math.max(...costs)).toBeGreaterThanOrEqual(3);
    expect(pool.some((d) => d.flying)).toBe(true);
    expect(pool.some((d) => !d.flying)).toBe(true);
    // budget sanity: an average room can afford several enemies
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
      expect(d.speed ?? 40, id).toBeLessThan(92);
      expect(d.contactDamage ?? 1, id).toBeLessThanOrEqual(2);
      expect(d.radius, id).toBeGreaterThan(2);
      expect(d.deathFx, id).toBeDefined();
      expect(d.bloodColor, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(d.light, id).toBeDefined();
      expect(d.script, id).toBeTypeOf('function');
      expect(spriteDefined(d.sprite), `${id} sprite "${d.sprite}"`).toBe(true);
      if (!MINIONS.includes(id)) expect(d.champion, id).toBe(true);
    }
    const avg = Object.keys(ENEMIES).reduce((s, id) => s + Enemies.must(id).hp, 0) / Object.keys(ENEMIES).length;
    expect(avg).toBeGreaterThan(35);
  });

  it('every enemy has move / attack / hurt frames, and every referenced sprite exists', () => {
    const sources = import.meta.glob(['../src/content/enemies/archive*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(3);
    const names = new Set<string>();
    for (const src of Object.values(sources)) {
      for (const m of src.matchAll(/setAnim\(`?'?([a-z0-9_]+)'?/g)) if (!m[1].includes('$')) names.add(m[1]);
      for (const m of src.matchAll(/r\.sprite\('([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/sprite: '([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/hurtFrame\(e, w, '([a-z0-9_]+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/new AnimEffect\('([a-z0-9_]+)'/g)) names.add(m[1]);
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

  it('archive bullets are high-contrast and pop against the wet slate floor', () => {
    for (const k of ['glyph', 'page'] as const) {
      const pal = BUL[k];
      expect(contrast(pal.color, pal.outline), k).toBeGreaterThan(6);
      expect(contrast(pal.core, pal.outline), k).toBeGreaterThan(12);
      expect(luminance(pal.core), k).toBeGreaterThan(0.7);
      expect(contrast(pal.color, '#1f3344'), k).toBeGreaterThan(4);
    }
    for (let v = 0; v < 3; v++) expect(hasSprite(glyphSprite(v, 7))).toBe(true);
    expect(hasSprite('__page_shot')).toBe(true);
  });

  it('the mimic is pixel-identical to the theme\'s book pile', () => {
    const theme = Themes.must('archive');
    const a = new PixelPainter(16, 18);
    theme.paintRock!(a, new RNG(13), 0);
    const b = new PixelPainter(16, 18);
    paintBookStack(b, 0, 0);
    b.innerShadow('#1a1410');
    b.outline('#070c12');
    expect([...a.data]).toEqual([...b.data]);
  });
});

// ---------------------------------------------------------------- helpers
describe('floor 6 helpers', () => {
  it('fogStrength is full near the keeper and gone far away', () => {
    expect(fogStrength(10)).toBe(1);
    expect(fogStrength(60)).toBe(1);
    expect(fogStrength(120)).toBeCloseTo(0.5);
    expect(fogStrength(180)).toBe(0);
    expect(fogStrength(400)).toBe(0);
  });

  it('glyphLine spreads the glyphs across the aim direction', () => {
    const pts = glyphLine(100, 100, 0, 5, 10, 20);
    expect(pts).toHaveLength(5);
    for (const p of pts) expect(p.x).toBeCloseTo(120);
    expect(pts[0].y).toBeLessThan(pts[4].y);
    expect(pts[2].y).toBeCloseTo(100);
  });

  it('scribeCue fires only in the window before the line releases', () => {
    expect(scribeCue(10, undefined)).toBe(false);
    expect(scribeCue(10, 10.3)).toBe(true);
    expect(scribeCue(10, 11)).toBe(false);
    expect(scribeCue(10, 9.5)).toBe(false);
  });

  it('toward mixes colors', () => {
    expect(toward('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(toward('#102030', '#102030', 0.9)).toBe('#102030');
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

describe('floor 6 enemy AI (headless simulation)', () => {
  for (const id of ALL) {
    it(`${id} runs its script for 12s without errors and stays in the room`, () => {
      const fw = fakeWorld(`sim6-${id}`);
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

  it('every enemy produces telegraphed danger (bullets, lobs, pools, warnings) within 12s', () => {
    for (const id of Object.keys(ENEMIES)) {
      const fw = fakeWorld(`danger6-${id}`);
      fw.w.spawnEnemy(id, 120, 70);
      let dangerous = 0;
      let warnings = 0;
      step(fw, 12, (t) => {
        fw.player.lastAttackAt = Math.floor(t * 2) / 2;
        dangerous = Math.max(dangerous, fw.entities.filter((x) => (x.team === 'enemy' && !(x instanceof Enemy)) || x.enemyHazard || x instanceof GroundWarning).length);
        warnings = Math.max(warnings, fw.entities.filter((x) => x instanceof GroundWarning).length);
      });
      expect(dangerous, id).toBeGreaterThan(0);
      // every dangerous attack is telegraphed on the floor (lanes / circles)
      if (id !== 'ink_jelly' && id !== 'drowned_scribe') expect(warnings, `${id} warning`).toBeGreaterThan(0);
    }
  });

  it('ink droplets leave slowing pools and split into two beads', () => {
    const fw = fakeWorld('drop');
    const e = fw.w.spawnEnemy('ink_droplet', 150, 90)!;
    let pools = 0;
    step(fw, 4, () => {
      pools = Math.max(pools, fw.entities.filter((x) => x instanceof InkPool).length);
    });
    expect(pools).toBeGreaterThan(0);
    fw.w.killEnemy(e);
    step(fw, 0.1);
    expect(fw.w.enemies.filter((o) => o.def.id === 'ink_bead').length).toBe(2);
    for (const b of fw.w.enemies) expect(b.isMinion).toBe(true);
  });

  it('ink pool slows the player only once armed', () => {
    const fw = fakeWorld('pool');
    fw.player.x = 100;
    fw.player.y = 100;
    const pool = fw.w.spawn(new InkPool(100, 100, 12, 2));
    pool.update(fw.w, 0.1);
    expect(fw.player.statuses.has('slow')).toBe(false);
    pool.update(fw.w, 0.4);
    expect(fw.player.statuses.has('slow')).toBe(true);
  });

  it('drowned scribe writes a line of glyphs that wait, then fire one after another', () => {
    const fw = fakeWorld('scribe');
    fw.player.x = 168;
    fw.player.y = 160;
    fw.w.spawnEnemy('drowned_scribe', 168, 60);
    let waiting = 0;
    let fired = 0;
    const firedAt: number[] = [];
    step(fw, 7, (t) => {
      const shots = fw.entities.filter((x): x is Projectile => x instanceof Projectile);
      waiting = Math.max(waiting, shots.filter((s) => !s.mem.go && s.speed === 0).length);
      for (const s of shots) {
        if (s.mem.go && !s.mem.__seen) {
          s.mem.__seen = 1;
          fired++;
          firedAt.push(t);
        }
      }
    }, false);
    expect(waiting).toBeGreaterThanOrEqual(4);
    expect(fired).toBeGreaterThanOrEqual(6);
    // sequential, not all at once
    expect(firedAt[firedAt.length - 1] - firedAt[0]).toBeGreaterThan(0.3);
    expect(fw.w.vars.__scribeCastT).toBeGreaterThan(0);
  });

  it('a written glyph hangs still, then launches toward the player', () => {
    const fw = fakeWorld('glyph');
    fw.player.x = 100;
    fw.player.y = 200;
    const p = new Projectile({ team: 'enemy', x: 100, y: 50, angle: 0, speed: 0, damage: 1, behaviors: [inkGlyph(0.8, 120)] });
    fw.w.spawn(p);
    step(fw, 0.5, undefined, false);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(50);
    step(fw, 0.6, undefined, false);
    expect(p.mem.go).toBe(1);
    expect(Math.sin(p.angle)).toBeGreaterThan(0.95);
    expect(p.y).toBeGreaterThan(60);
  });

  it('paper moths dive with a scribe\'s line and never two at once otherwise', () => {
    const fw = fakeWorld('moths');
    for (const [x, y] of [[80, 60], [250, 60], [168, 50]]) fw.w.spawnEnemy('paper_moth', x, y);
    let maxDiving = 0;
    let dives = 0;
    let was = 0;
    step(fw, 10, () => {
      const n = fw.w.enemies.filter((o) => o.anim === 'pmoth_dive').length;
      maxDiving = Math.max(maxDiving, n);
      if (n > was) dives++;
      was = n;
    });
    expect(maxDiving).toBe(1);
    expect(dives).toBeGreaterThan(1);
    // a scribe cue makes the whole swarm dive together
    const fw2 = fakeWorld('moths2');
    for (const [x, y] of [[90, 60], [240, 60], [168, 50]]) fw2.w.spawnEnemy('paper_moth', x, y);
    step(fw2, 0.8);
    let together = 0;
    step(fw2, 3, () => {
      (fw2.w as unknown as { vars: Record<string, number> }).vars.__scribeCastT = (fw2.w as unknown as { time: number }).time + 0.3;
      together = Math.max(together, fw2.w.enemies.filter((o) => o.anim === 'pmoth_dive' || o.anim === 'pmoth_poise').length);
    });
    expect(together).toBeGreaterThanOrEqual(2);
  });

  it('book mimic lurks harmless until the player comes close, then snaps', () => {
    const fw = fakeWorld('mimic');
    const e = fw.w.spawnEnemy('book_mimic', 168, 60)!;
    fw.player.x = 168;
    fw.player.y = 170;
    step(fw, 1.5, undefined, false);
    expect(e.harmful).toBe(false);
    expect(e.anim).toBe('bmimic_closed');
    expect(e.mem.lurk).toBe(1);
    fw.player.x = 168;
    fw.player.y = 100;
    let warned = false;
    let shots = 0;
    step(fw, 1.5, () => {
      if (fw.entities.some((x) => x instanceof GroundWarning)) warned = true;
      shots = Math.max(shots, fw.entities.filter((x) => x instanceof Projectile).length);
    }, false);
    expect(warned).toBe(true);
    expect(e.mem.lurk).toBe(0);
    expect(shots).toBeGreaterThanOrEqual(5);
  });

  it('archive eel cannot be hit while submerged and surfaces along a telegraphed lane', () => {
    const fw = fakeWorld('eel');
    const e = fw.w.spawnEnemy('archive_eel', 150, 90)!;
    expect(e.mem.under).toBe(1);
    expect(e.takeHit(fw.w, { damage: 20, kind: 'projectile' })).toBe(false);
    let laneBeforeSurface = false;
    let surfaced = false;
    step(fw, 5, () => {
      if (!surfaced && fw.entities.some((x) => x instanceof GroundWarning && x.rw > 0)) laneBeforeSurface = true;
      if (!e.mem.under) surfaced = true;
    });
    expect(surfaced).toBe(true);
    expect(laneBeforeSurface).toBe(true);
  });

  it('lantern wraith spawns one ink darkness that tracks its distance to the keeper', () => {
    const fw = fakeWorld('wraith');
    fw.w.spawnEnemy('lantern_wraith', 168, 60);
    fw.w.spawnEnemy('lantern_wraith', 200, 60);
    step(fw, 0.1);
    const dark = fw.entities.filter((x) => x instanceof InkDarkness);
    expect(dark.length).toBe(1);
    const d = dark[0] as InkDarkness;
    fw.player.x = 168;
    fw.player.y = 100;
    step(fw, 2, () => {
      fw.player.x = 168;
      fw.player.y = 100;
    }, false);
    expect(d.k).toBeGreaterThan(0.3);
    for (const o of [...fw.w.enemies]) fw.w.killEnemy(o);
    step(fw, 4, undefined, false);
    expect(d.dead).toBe(true);
  });

  it('shelf golem topples a lane of shelves from afar and slams up close', () => {
    const fw = fakeWorld('golem');
    const e = fw.w.spawnEnemy('shelf_golem', 60, 100)!;
    e.speed = 0;
    fw.player.x = 220;
    fw.player.y = 100;
    let lane = false;
    let crashes = 0;
    step(fw, 5, () => {
      if (fw.entities.some((x) => x instanceof GroundWarning && x.rw > 0)) lane = true;
      crashes = Math.max(crashes, fw.entities.filter((x) => x instanceof GroundWarning && x.rw === 0 && x.radius === 9).length);
    }, false);
    expect(lane).toBe(true);
    expect(crashes).toBeGreaterThan(2);
    // up close: slam + the books take wing as a moth
    fw.player.x = e.x + 30;
    fw.player.y = e.y;
    step(fw, 5, () => {
      fw.player.x = e.x + 30;
      fw.player.y = e.y;
    }, false);
    expect(fw.w.enemies.some((o) => o.def.id === 'paper_moth' && o.mem.owner === e)).toBe(true);
  });

  it('ink jelly releases two counter-swirling rings', () => {
    const fw = fakeWorld('jelly');
    fw.w.spawnEnemy('ink_jelly', 168, 60);
    let shots = 0;
    const curves = new Set<number>();
    step(fw, 5, () => {
      const ps = fw.entities.filter((x): x is Projectile => x instanceof Projectile);
      shots = Math.max(shots, ps.length);
      for (const p of ps) curves.add(Math.sign(p.curve));
    });
    expect(shots).toBeGreaterThanOrEqual(16);
    expect(curves.has(1) && curves.has(-1)).toBe(true);
  });
});
