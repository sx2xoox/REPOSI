// Headless lockstep harness for the determinism tests: drives the real World
// (and optionally its real draw path, into fake canvases) with a scripted,
// seeded bot that only talks to the simulation through `PlayerInput` (the
// lockstep seam) plus a few deterministic "commands" between steps (item
// gifts, teleports, descending, blessings) — exactly what lockstep peers would
// apply. Every step records `stateHash(w)`.

import { fakeDisplay, setDisplaySize } from './headless';
import { expect } from 'vitest';
import { loadContent } from '../src/content';
import { Renderer } from '../src/engine/renderer';
import { RNG, fx } from '../src/engine/rng';
import { save } from '../src/engine/save';
import { warmAllSprites } from '../src/engine/sprites';
import { Actives, Artifacts, Enemies, Weapons, Potions } from '../src/game/defs';
import { World, type WorldHost } from '../src/game/world';
import { RunState } from '../src/game/run';
import { FIXED_DT, TILE } from '../src/game/constants';
import { EMBER_MAX, type Player } from '../src/game/player';
import { Pedestal, Pickup, Trapdoor } from '../src/game/pickups';
import { HELD, PRESS, fixedRules, type PlayerInput } from '../src/game/seam';
import { stateHash, stateHashParts } from '../src/game/statehash';
import { applyBlessing, blessingChoices, blessingDue, markBlessed } from '../src/game/blessings';
import type { Enemy } from '../src/game/enemy';
import type { Entity } from '../src/game/entity';
import type { RoomNode } from '../src/game/dungeon';
import type { Door } from '../src/game/room';
import { DIR_VEC } from '../src/game/constants';
import type { GraphicsQuality } from '../src/engine/save';

loadContent();

/** Everything that may differ between peers but must not change the simulation. */
export interface Variant {
  name: string;
  /** cosmetic RNG seed */
  fxSeed: number;
  /** CSS size of the display: sets the adaptive view width (304..512) */
  display: [number, number];
  quality: GraphicsQuality;
  particles: number;
  damageNumbers: boolean;
  /** the local hit-stop SETTING (the run's rule is fixed) */
  hitStopSetting: boolean;
  screenShake: number;
  screenFlash?: number;
  /** draw after every n-th step (0 = never), at interpolation alpha `drawAlpha` */
  drawEvery: number;
  drawAlpha: number;
  /** pre-warm the sprite caches before the run */
  warmSprites: boolean;
}

export const BASE_VARIANT: Variant = {
  name: 'base', fxSeed: 1, display: [1280, 720], quality: 'high', particles: 1, damageNumbers: true, hitStopSetting: true,
  screenShake: 1, drawEvery: 0, drawAlpha: 1, warmSprites: false,
};

export interface Scenario {
  name: string;
  seed: string;
  character: string;
  /** floors to play, in order (1..5) */
  floors: number[];
  /** steps spent exploring each floor before heading for the boss */
  exploreSteps: number;
  /** max steps of a boss fight before the harness ends it */
  bossSteps: number;
  /** artifacts given at each floor start */
  giftsPerFloor: number;
  /** hard cap on total steps */
  maxSteps: number;
  /** extra enemies (cycling through every regular enemy) spawned into each new hostile room */
  extraEnemies?: number;
  /** weapons / actives / artifacts / potions come from shuffled full lists (coverage) */
  cycle?: boolean;
  /** test only: corrupt the state at this step (desync detection check) */
  injectAt?: number;
}

/** What a run exercised (coverage report). */
export interface Coverage {
  enemies: Set<string>;
  bosses: Set<string>;
  rooms: Set<string>;
  weapons: Set<string>;
  artifacts: Set<string>;
  actives: Set<string>;
}

export interface RunResult {
  hashes: number[];
  /** per-step [floor, room id] for diagnostics */
  where: string[];
  world: World;
  /** state hash parts at the requested step (diagnostics) */
  parts?: Record<string, number>;
  dump?: string[];
  stats: { rooms: number; kills: number; bosses: number; floors: number; releases: number; items: number };
  coverage: Coverage;
}

const host: WorldHost = { openInventory() {}, onGameOver() {} };

let renderer: Renderer | null = null;

function applyVariant(v: Variant): Renderer {
  fx.setState(new RNG(v.fxSeed).getState());
  setDisplaySize(v.display[0], v.display[1]);
  if (!renderer) renderer = new Renderer(fakeDisplay(v.display[0], v.display[1]));
  renderer.resize();
  const s = save.settings;
  s.graphicsQuality = v.quality;
  s.particles = v.particles;
  s.damageNumbers = v.damageNumbers;
  s.hitStop = v.hitStopSetting;
  s.screenShake = v.screenShake;
  renderer.shakeIntensity = v.screenShake;
  renderer.flashIntensity = v.screenFlash ?? 1;
  if (v.warmSprites) warmAllSprites();
  return renderer;
}

// ------------------------------------------------------------------ bot
const BLOCKED = 1;

/** BFS over room tiles from the keeper to `goal` (tile coords); returns the next tile center to walk to. */
function nextWaypoint(w: World, gx: number, gy: number): { x: number; y: number } | null {
  const room = w.room;
  const p = w.player;
  const W = room.w;
  const sx = Math.floor(p.x / TILE);
  const sy = Math.floor(p.y / TILE);
  if (sx === gx && sy === gy) return null;
  const prev = new Int32Array(W * room.h).fill(-1);
  const q: number[] = [sy * W + sx];
  prev[sy * W + sx] = sy * W + sx;
  const goal = gy * W + gx;
  while (q.length) {
    const c = q.shift()!;
    if (c === goal) break;
    const cx = c % W;
    const cy = (c - cx) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!room.inside(nx, ny)) continue;
      const n = ny * W + nx;
      if (prev[n] !== -1) continue;
      if (n !== goal && room.blocks(nx, ny, p.flying, false) ? BLOCKED : 0) continue;
      prev[n] = c;
      q.push(n);
    }
  }
  if (prev[goal] === -1) return null;
  let c = goal;
  while (prev[c] !== sy * W + sx) c = prev[c];
  const tx = c % W;
  return { x: (tx + 0.5) * TILE, y: (((c - tx) / W) + 0.5) * TILE };
}

interface BotState {
  rng: RNG;
  strafe: number;
  strafeT: number;
  cursorMode: boolean;
  modeT: number;
  dashT: number;
  bombT: number;
  swapT: number;
  door: Door | null;
  roomSteps: number;
  clearSteps: number;
}

function unit(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y);
  return l > 1e-9 ? [x / l, y / l] : [0, 0];
}

/** One step of bot input (reads the world like a player looking at the screen). */
function botInput(w: World, b: BotState, out: PlayerInput): void {
  const p = w.player;
  out.mx = out.my = out.ax = out.ay = 0;
  out.held = 0;
  out.pressed = 0;
  out.cx = p.x;
  out.cy = p.y;
  const r = b.rng;
  b.strafeT -= FIXED_DT;
  if (b.strafeT <= 0) {
    b.strafe = r.sign();
    b.strafeT = r.range(0.4, 1.4);
  }
  b.modeT -= FIXED_DT;
  if (b.modeT <= 0) {
    b.cursorMode = r.chance(0.4);
    b.modeT = r.range(1, 4);
  }
  let target: Enemy | null = null;
  let bd = Infinity;
  for (const e of w.enemies) {
    if (!e.alive || e.hidden) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < bd) {
      bd = d;
      target = e;
    }
  }
  if (target) {
    const [ux, uy] = unit(target.x - p.x, target.y - p.y);
    // keep a fighting distance, circle around the target
    const want = bd < 46 ? -1 : bd > 120 ? 1 : 0;
    const [mx, my] = unit(ux * want - uy * b.strafe * 0.9, uy * want + ux * b.strafe * 0.9);
    out.mx = mx;
    out.my = my;
    if (b.cursorMode) {
      out.held = HELD.fire | HELD.cursorAim;
      out.cx = target.x + r.range(-4, 4);
      out.cy = target.y - 4 + r.range(-4, 4);
    } else {
      out.ax = ux;
      out.ay = uy;
    }
    b.dashT -= FIXED_DT;
    if (b.dashT <= 0) {
      out.pressed |= PRESS.dash;
      b.dashT = r.range(0.8, 3);
    }
    if (p.ember >= EMBER_MAX) out.pressed |= PRESS.release;
    b.bombT -= FIXED_DT;
    if (b.bombT <= 0) {
      if (p.bombs > 0 && bd < 70) out.pressed |= PRESS.bomb;
      b.bombT = r.range(4, 12);
    }
    if (p.activeId && r.chance(0.01)) out.pressed |= PRESS.active;
    if (p.potionId && r.chance(0.004)) out.pressed |= PRESS.potion;
    return;
  }
  // no visible enemy: collect items, then leave through a door
  b.swapT -= FIXED_DT;
  if (b.swapT <= 0) {
    out.pressed |= PRESS.swap;
    b.swapT = r.range(3, 9);
  }
  if (r.chance(0.005)) out.pressed |= PRESS.bomb; // rocks / secret walls
  if (w.focus && r.chance(0.2)) out.pressed |= PRESS.interact;
  let goal: { x: number; y: number } | null = null;
  if (w.node.cleared) {
    let best: Entity | null = null;
    let bdist = Infinity;
    for (const e of w.entities) {
      if (e.dead) continue;
      const want = e instanceof Trapdoor || (e instanceof Pickup && (e.price <= p.coins || e.price === 0)) || (e instanceof Pedestal && !!e.item && e.price <= p.coins && e.heartPrice === 0);
      if (!want) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bdist && (b.clearSteps < 600 || e instanceof Trapdoor)) {
        bdist = d;
        best = e;
      }
    }
    if (best) {
      goal = { x: best.x, y: best.y };
      if (best instanceof Pedestal && bdist < 20) out.pressed |= PRESS.interact;
    }
  }
  if (!goal && w.node.cleared) {
    const doors = w.room.doors.filter((d) => d.state === 'open' || (d.state === 'locked' && p.keys > 0));
    if (!b.door || !doors.includes(b.door)) {
      const fresh = doors.filter((d) => !w.map.nodes[d.to].visited);
      const pool = fresh.length ? fresh : doors;
      b.door = pool.length ? r.pick(pool) : null;
    }
    if (b.door) {
      const v = DIR_VEC[b.door.dir];
      const inner = { x: b.door.x - v.x * 10, y: b.door.y - v.y * 10 };
      if (Math.hypot(inner.x - p.x, inner.y - p.y) < 9) goal = { x: b.door.x + v.x * 24, y: b.door.y + v.y * 24 };
      else goal = inner;
    }
  }
  if (!goal) {
    // wander (hidden enemies, waves)
    out.mx = Math.cos(b.strafe * w.time);
    out.my = Math.sin(b.strafe * w.time * 0.7);
    return;
  }
  const way = Math.hypot(goal.x - p.x, goal.y - p.y) < 20 ? goal : nextWaypoint(w, Math.floor(goal.x / TILE), Math.floor(goal.y / TILE)) ?? goal;
  const [mx, my] = unit(way.x - p.x, way.y - p.y);
  out.mx = mx;
  out.my = my;
}

// ------------------------------------------------------------------ driver
function giftPool(): { artifacts: string[]; actives: string[]; weapons: string[]; potions: string[]; enemies: string[] } {
  return {
    artifacts: Artifacts.all().filter((a) => !a.hidden && !a.blessing).map((a) => a.id),
    actives: Actives.all().map((a) => a.id),
    weapons: Weapons.all().map((x) => x.id),
    potions: Potions.all().map((x) => x.id),
    enemies: Enemies.all().filter((e) => !e.boss && !!e.floors?.length).map((e) => e.id),
  };
}

/** Endless shuffled cycle over a list (coverage) or plain random picks. */
function picker(rng: RNG, list: string[], cycle: boolean): () => string {
  const order = rng.shuffle([...list]);
  let i = 0;
  return () => (cycle ? order[i++ % order.length] : rng.pick(list));
}

/** Run a scenario under a variant; returns the per-step state hashes. */
export function runScenario(sc: Scenario, v: Variant, partsAt = -1): RunResult {
  const r = applyVariant(v);
  const run = new RunState(sc.seed, sc.character);
  run.seeded = true;
  const w = new World(r, run, host);
  w.setQuality({ lighting: v.quality !== 'low', particles: v.particles * (v.quality === 'low' ? 0.5 : 1) });
  w.rules = fixedRules({ hitStop: true });
  const bot: BotState = {
    rng: new RNG(`${sc.seed}:bot`), strafe: 1, strafeT: 0, cursorMode: false, modeT: 0, dashT: 1, bombT: 3, swapT: 2,
    door: null, roomSteps: 0, clearSteps: 0,
  };
  // the bot is the input source: called by the keeper's update, once per step
  w.inputSource = (ww, _p, out) => botInput(ww, bot, out);
  w.start();
  const pool = giftPool();
  const cmd = new RNG(`${sc.seed}:commands`);
  const hashes: number[] = [];
  const where: string[] = [];
  const stats = { rooms: 0, kills: 0, bosses: 0, floors: 0, releases: 0, items: 0 };
  let parts: Record<string, number> | undefined;
  let dump: string[] | undefined;
  let phase: 'explore' | 'boss' | 'after' = 'explore';
  let phaseSteps = 0;
  let lastNode: RoomNode | null = null;
  const first = sc.floors[0];
  const last = sc.floors[sc.floors.length - 1];

  const cyc = !!sc.cycle;
  const nextArtifact = picker(cmd, pool.artifacts, cyc);
  const nextActive = picker(cmd, pool.actives, cyc);
  const nextWeapon = picker(cmd, pool.weapons, cyc);
  const nextPotion = picker(cmd, pool.potions, cyc);
  const nextEnemy = picker(cmd, pool.enemies, true);
  const coverage: Coverage = { enemies: new Set(), bosses: new Set(), rooms: new Set(), weapons: new Set(), artifacts: new Set(), actives: new Set() };

  const startFloor = () => {
    stats.floors++;
    const p = w.player;
    for (let i = 0; i < sc.giftsPerFloor; i++) w.items.give(nextArtifact());
    if (cyc || cmd.chance(0.7)) p.setActive(nextActive(), w);
    if (cyc || cmd.chance(0.6)) p.equipWeapon(w, nextWeapon());
    if (cyc || cmd.chance(0.5)) p.potionId = nextPotion();
    p.bombs = Math.max(p.bombs, 3);
    p.keys = Math.max(p.keys, 2);
    p.coins = Math.max(p.coins, 15);
    phase = 'explore';
    phaseSteps = 0;
  };

  if (w.run.floor !== first) w.startFloor(first);
  let curFloor = w.run.floor;
  startFloor();

  for (let step = 0; step < sc.maxSteps; step++) {
    // ---- commands (between steps, identical on every peer)
    const p = w.player;
    if (w.gameOver) break;
    if (w.run.floor !== curFloor && !w.transitioning && !w.descending) {
      curFloor = w.run.floor;
      if (curFloor > last) break;
      startFloor();
    }
    if (blessingDue(w)) {
      const choices = blessingChoices(w);
      markBlessed(w);
      if (choices.length) applyBlessing(w, choices[cmd.int(0, choices.length - 1)]);
    }
    if (p.alive && p.red + p.soul <= 2) {
      p.heal(6);
      p.addSoul(2);
    }
    if (w.node !== lastNode) {
      lastNode = w.node;
      bot.door = null;
      bot.roomSteps = 0;
      bot.clearSteps = 0;
      stats.rooms++;
      coverage.rooms.add(w.node.kind);
      if (!w.node.cleared && w.node.kind !== 'boss') {
        const room = w.room;
        for (let i = 0; i < (sc.extraEnemies ?? 0); i++) {
          const pos = room.randomFreePos(cmd, 8, { x: p.x, y: p.y, dist: 80 });
          w.spawnEnemy(nextEnemy(), pos.x, pos.y);
        }
        if (cyc && cmd.chance(0.5)) p.equipWeapon(w, nextWeapon());
      }
    }
    for (const e of w.enemies) (e.isBoss ? coverage.bosses : coverage.enemies).add(e.def.id);
    coverage.weapons.add(p.weaponId);
    if (p.activeId) coverage.actives.add(p.activeId);
    bot.roomSteps++;
    if (w.node.cleared) bot.clearSteps++;
    phaseSteps++;
    if (!w.transitioning && !w.descending) {
      if (phase === 'explore') {
        // stuck in a fight or wandering: move on
        if (!w.node.cleared && bot.roomSteps > 2400) for (const e of [...w.enemies]) w.killEnemy(e);
        if (w.node.cleared && bot.clearSteps > 480) {
          // walked around long enough: jump to an unvisited room (room kinds not seen yet first)
          const open = w.map.nodes.filter((n) => !n.visited && n.kind !== 'boss');
          const next = open.find((n) => !coverage.rooms.has(n.kind)) ?? open[0];
          if (next) w.teleportTo(next);
        }
        if (phaseSteps > sc.exploreSteps) {
          const boss = w.map.nodes.find((n) => n.kind === 'boss');
          if (boss && boss !== w.node) w.teleportTo(boss);
          phase = 'boss';
          phaseSteps = 0;
        }
      } else if (phase === 'boss') {
        if (w.node.kind === 'boss' && w.node.cleared) {
          stats.bosses++;
          phase = 'after';
          phaseSteps = 0;
        } else if (phaseSteps > sc.bossSteps) {
          for (const e of [...w.enemies]) w.killEnemy(e);
        }
      } else if (phaseSteps > 480) {
        // the bot should have taken the trapdoor by now; else go down directly
        if (curFloor >= last) break;
        w.descend();
      }
    }

    // ---- the simulation step
    if (sc.injectAt === step) w.player.x += 1e-9; // deliberate desync
    w.update(FIXED_DT);
    r.simStep++;
    if (v.drawEvery > 0 && step % v.drawEvery === 0) {
      r.alpha = v.drawAlpha;
      w.draw();
      r.alpha = 1;
    }
    hashes.push(stateHash(w));
    where.push(`f${w.run.floor} r${w.node.id} ${w.node.kind}`);
    if (step === partsAt) {
      parts = stateHashParts(w);
      dump = dumpState(w);
    }
  }
  stats.kills = w.run.stats.kills;
  stats.releases = w.run.stats.releases;
  stats.items = w.player.inv.items.length;
  for (const it of w.player.inv.items) coverage.artifacts.add(it.id);
  return { hashes, where, world: w, parts, dump, stats, coverage };
}

/** Readable per-entity state (diagnostics for a mismatch). */
export function dumpState(w: World): string[] {
  const out: string[] = [];
  const p = w.player;
  out.push(`world t=${w.time} rt=${w.roomTime} rng=${w.run.rng.getState()} loot=${w.run.lootRng.getState()} vars=${JSON.stringify(w.vars)}`);
  out.push(`player x=${p.x} y=${p.y} vx=${p.vx} vy=${p.vy} aim=${p.aim} red=${p.red} ember=${p.ember} coins=${p.coins} w=${p.weaponId}/${JSON.stringify(p.weapon)}`);
  const pend = (w as unknown as { pending: Entity[] }).pending;
  for (const e of [...w.entities, ...pend]) {
    if ((e.constructor as typeof Entity).cosmetic || e === p) continue;
    const m = (e as unknown as { mem?: unknown }).mem;
    let extra = '';
    if ('def' in e) {
      const en = e as unknown as Enemy;
      extra = `${en.def.id} hp=${en.hp} steps=${en.script.steps} wait=${en.script.waiting} face=${en.facing} anim=${en.anim} want=${en.wantVX},${en.wantVY} tel=${en.telegraphT} dorm=${en.dormant} hid=${en.hidden} st=${JSON.stringify([...en.statuses])} kb=${en.kbx},${en.kby}`;
    } else if ('angle' in e && 'speed' in e) {
      const pr = e as unknown as { angle: number; speed: number; life: number; traveled: number; damage: number; pierce: number; hitIds: Set<number> };
      extra = `ang=${pr.angle} sp=${pr.speed} life=${pr.life} trav=${pr.traveled} dmg=${pr.damage} pierce=${pr.pierce} hits=${[...pr.hitIds]}`;
    }
    out.push(`${e.constructor.name}#${e.id} ${extra} x=${e.x} y=${e.y} z=${e.z} vx=${e.vx} vy=${e.vy} age=${e.age} dead=${e.dead} mem=${JSON.stringify(m, (_k, v) => (typeof v === 'object' && v && !Array.isArray(v) && v.constructor !== Object ? '[obj]' : v))}`);
  }
  return out;
}

/** First step whose hash differs (-1 when the sequences are identical). */
export function firstMismatch(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

export type { Player };

// ------------------------------------------------------------------ shared test helpers
/** narrow view (304), low quality, effect settings off, drawn every 2nd step mid-interpolation, caches pre-warmed */
export const NARROW: Variant = {
  ...BASE_VARIANT, name: 'narrow', fxSeed: 0x9e3779b9, display: [960, 720], quality: 'low', particles: 0.25, damageNumbers: false, screenFlash: 0,
  hitStopSetting: false, screenShake: 0, drawEvery: 2, drawAlpha: 0.37, warmSprites: true,
};
/** wide view (512), medium quality, drawn every 3rd step */
export const WIDE: Variant = {
  ...BASE_VARIANT, name: 'wide', fxSeed: 7, display: [1720, 720], quality: 'medium', particles: 0.6, drawEvery: 3, drawAlpha: 0.8,
};

/** Human-readable report of the first desync between a base run and a variant run (re-runs both to that step). */
export function describeMismatch(sc: Scenario, base: RunResult, v: Variant, other: RunResult, k: number): string {
  if (k < 0) return '';
  const a = runScenario(sc, BASE_VARIANT, k);
  const b = runScenario(sc, v, k);
  const lines = [`${sc.name} / ${v.name}: first desync at step ${k} (${base.where[k] ?? '?'} vs ${other.where[k] ?? '?'})`];
  lines.push(`parts base ${JSON.stringify(a.parts)}`, `parts ${v.name} ${JSON.stringify(b.parts)}`);
  const da = a.dump ?? [];
  const db = b.dump ?? [];
  let n = 0;
  for (let i = 0; i < Math.max(da.length, db.length) && n < 4; i++) {
    if (da[i] === db[i]) continue;
    lines.push(`base:   ${da[i]?.slice(0, 500)}`, `${v.name}: ${db[i]?.slice(0, 500)}`);
    n++;
  }
  return lines.join('\n');
}

/** Base run + every variant: identical state hash after every step. */
export function checkScenario(sc: Scenario, variants: Variant[], repeat = false): void {
  const base = runScenario(sc, BASE_VARIANT);
  // the scenario really plays: rooms, kills, a boss on every planned floor
  expect(base.hashes.length).toBeGreaterThan(2500);
  expect(base.stats.floors).toBe(sc.floors.length);
  expect(base.stats.bosses).toBeGreaterThanOrEqual(1);
  expect(base.stats.kills).toBeGreaterThan(2);
  expect(base.stats.rooms).toBeGreaterThan(sc.floors.length);
  // the run does not get stuck (the state keeps changing)
  expect(new Set(base.hashes).size).toBeGreaterThan(base.hashes.length * 0.9);
  if (repeat) expect(firstMismatch(base.hashes, runScenario(sc, BASE_VARIANT).hashes)).toBe(-1);
  for (const v of variants) {
    const other = runScenario(sc, v);
    const k = firstMismatch(base.hashes, other.hashes);
    expect(k, describeMismatch(sc, base, v, other, k)).toBe(-1);
  }
}

