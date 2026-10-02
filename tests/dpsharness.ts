// Headless DPS harness: drives the real World (floor-1 start room, a scripted
// bot that aims and fires at immovable training dummies) and measures the
// damage the keeper deals per second with a given character and weapon.
// Passives, affinities and item hooks all run, so a character × weapon matrix
// shows how much of the damage comes from the keeper and how much from the
// weapon. Used by tests/characters-kit.test.ts (sanity bands) and the
// `DPS_MATRIX=1 npx vitest run tests/dps-matrix` report.

import './headless';
import { fakeDisplay } from './headless';
import { loadContent } from '../src/content';
import { Renderer } from '../src/engine/renderer';
import { World, type WorldHost } from '../src/game/world';
import { RunState } from '../src/game/run';
import { FIXED_DT } from '../src/game/constants';
import { Characters, Enemies, Weapons, defineCharacter, defineEnemy } from '../src/game/defs';
import { HELD, PRESS, fixedRules, type PlayerInput } from '../src/game/seam';
import type { Enemy } from '../src/game/enemy';

loadContent();

export const DUMMY_ID = '__dps_dummy';
if (!Enemies.has(DUMMY_ID)) {
  defineEnemy({
    id: DUMMY_ID, name: '훈련 인형', hp: 1e7, radius: 7, sprite: Enemies.all()[0].sprite, contactDamage: 0, mass: Infinity, deathFx: 'none', shadow: 0,
  });
}

/** A keeper with base stats and no kit: measures the weapon alone. */
export const PLAIN_ID = '__plain';
if (!Characters.has(PLAIN_ID)) {
  const ria = Characters.must('ria');
  defineCharacter({
    id: PLAIN_ID, name: '맨손 등불지기', title: '기준', desc: '측정용', spritePrefix: ria.spritePrefix, portrait: ria.portrait, color: '#ffffff',
    hearts: 3, weapon: 'lantern_bolt', unlocked: false,
  });
}

/** weapons whose attack fires on release (hold = charge / load) */
export const RELEASE_WEAPONS = new Set(['hunter_bow', 'volley_crossbow', 'titan_greatsword']);

export interface DpsOpts {
  character: string;
  weapon: string;
  /** measured seconds (default 8) */
  seconds?: number;
  /** 5 dummies in a tight cluster instead of one */
  crowd?: boolean;
  /** distance of the (center) dummy from the keeper (default 70; melee weapons walk in) */
  dist?: number;
  /** dash toward / through the target every `dash` seconds (0 = never) */
  dash?: number;
  seed?: string;
}

export interface DpsResult {
  dps: number;
  damage: number;
  /** hits that connected (applyHit calls that dealt damage) */
  hits: number;
  world: World;
}

const host: WorldHost = { openInventory() {}, onGameOver() {} };
let renderer: Renderer | null = null;

function melee(weapon: string): boolean {
  const d = Weapons.get(weapon);
  return !!d && (d.kind === 'melee' || weapon === 'titan_greatsword');
}

/** Measure sustained damage per second of `character` holding `weapon` against training dummies. */
export function measureDps(o: DpsOpts): DpsResult {
  if (!renderer) renderer = new Renderer(fakeDisplay(1280, 720));
  const run = new RunState(o.seed ?? `DPS-${o.character}-${o.weapon}`, o.character);
  run.seeded = true;
  const w = new World(renderer, run, host);
  w.setQuality({ lighting: false, particles: 0 });
  w.rules = fixedRules({ hitStop: false });
  const T = o.seconds ?? 8;
  const close = melee(o.weapon);
  const dist = o.dist ?? (close ? 40 : 70);
  let dummies: Enemy[] = [];
  let dashT = o.dash ?? 0;
  const bot = (ww: World, _p: unknown, out: PlayerInput) => {
    const p = ww.player;
    out.mx = out.my = out.ax = out.ay = 0;
    out.held = 0;
    out.pressed = 0;
    const t = dummies[0];
    out.cx = t ? t.x : p.x + 40;
    out.cy = t ? t.y : p.y;
    if (!t) return;
    const dx = t.x - p.x;
    const dy = t.y - (p.y - 4);
    const d = Math.hypot(dx, dy) || 1;
    // melee keepers close in; ranged keepers hold their distance
    const want = close ? 16 : dist;
    if (d > want + 4) {
      out.mx = dx / d;
      out.my = dy / d;
    }
    let firing = true;
    if (RELEASE_WEAPONS.has(o.weapon)) firing = ww.time % 1.1 < 0.95;
    out.held = (firing ? HELD.fire : 0) | HELD.cursorAim;
    if (o.dash) {
      dashT -= FIXED_DT;
      if (dashT <= 0) {
        dashT = o.dash;
        out.pressed |= PRESS.dash;
        out.mx = dx / d;
        out.my = dy / d;
      }
    }
  };
  w.inputSource = bot;
  w.start();
  const p = w.player;
  for (const e of [...w.enemies]) w.killEnemy(e);
  if (p.weaponId !== o.weapon) p.equipWeapon(w, o.weapon);
  p.god = true;
  const cx = p.x + dist;
  const cy = p.y;
  const spots = o.crowd ? [[0, 0], [18, 0], [-18, 0], [0, 18], [0, -18]] : [[0, 0]];
  for (const [ox, oy] of spots) {
    const e = w.spawnEnemy(DUMMY_ID, cx + ox, cy + oy);
    if (e) {
      e.dormant = 0;
      dummies.push(e);
    }
  }
  const steps = Math.round(T / FIXED_DT);
  let hits = 0;
  const orig = w.applyHit.bind(w);
  w.applyHit = (target, hit) => {
    const before = (target as { hp: number }).hp;
    const ok = orig(target, hit);
    if (ok && (target as { hp: number }).hp < before) hits++;
    return ok;
  };
  for (let i = 0; i < steps; i++) {
    w.update(FIXED_DT);
    dummies = dummies.filter((e) => e.alive);
  }
  const damage = w.run.stats.damageDealt;
  return { dps: damage / T, damage, hits, world: w };
}

/** Best of a near and a far engagement (ranged weapons prefer distance, melee closes in anyway). */
export function bestDps(character: string, weapon: string, crowd = false, seconds = 8): number {
  const a = measureDps({ character, weapon, crowd, seconds }).dps;
  if (melee(weapon)) return a;
  const b = measureDps({ character, weapon, crowd, seconds, dist: 40 }).dps;
  return Math.max(a, b);
}
