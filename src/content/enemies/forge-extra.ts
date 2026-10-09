// Floor 3 — 잿불 대장간 (ember forge), one more regular:
//  - 망치 땜장이 (hammer tinker): the floor's only SUPPORT. A goggled little smith with a
//    stack of iron patches on its back. It trots to the most battered ally nearby, raises
//    its hammer (telegraph, the ally is marked) and rivets a red-hot patch onto it: a plate
//    that soaks up 40 % of that ally's max HP before the ally can be hurt again. A patch
//    lasts 8 s, and every patch pops off the moment its tinker dies — so kill it first.
//    Between repairs (or with nobody to mend) it throws its hammer like a boomerang: a
//    lane-warned throw that flies out, hangs at the far end while the way back is marked,
//    then returns to the tinker, which stands still with open hands to catch it. Dodge it
//    twice and punish the wait. Champions throw twice in a row.
// Pure helpers (target score, throw reach, boomerang path) are unit-tested in
// tests/enemies-extra-f3.test.ts.

import { defineEnemy } from '../../game/defs';
import { Entity } from '../../game/entity';
import { PixelPainter } from '../../engine/painter';
import { defineDrawnSprite, getSprite } from '../../engine/sprites';
import { RingFx, type GroundWarning } from '../../game/effects';
import { fx } from '../../engine/rng';
import { clamp } from '../../engine/math';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { dust, frames, gather, hurtFrame, laneWarning, rayFree } from './shared';

// ------------------------------------------------------------------ tuning (exported for tests)
export const TINKER_ID = 'hammer_tinker';
export const TINKER_NAME = '망치 땜장이';
/** patch: share of the ally's max HP it soaks, lifetime, search radius, cooldown, wind-up */
export const PATCH_SHARE = 0.4;
export const PATCH_LIFE = 8;
export const PATCH_RANGE = 150;
export const PATCH_COOLDOWN = 4;
export const PATCH_WIND = 0.5;
/** how long the tinker hurries toward an ally before giving up, and the strike gap */
export const PATCH_APPROACH = 2.4;
export const PATCH_GAP = 6;
/** allies lighter than this (floor-1 HP) are not worth a patch (motes, lumps) */
export const PATCH_MIN_HP = 20;
/** hammer throw: wind-up (first / champion's second), reach band, flight phases, lane width */
export const THROW_WIND = 0.55;
export const THROW_WIND_AGAIN = 0.42;
/** it only throws at a keeper this close: the reach (keeper + 28, capped) then always carries past them */
export const THROW_RANGE = 104;
export const THROW_REACH_MIN = 64;
export const THROW_REACH_MAX = 112;
export const THROW_OUT = 0.7;
export const THROW_HANG = 0.32;
export const RETURN_ACCEL = 520;
export const RETURN_MAX = 240;
export const HAMMER_R = 5;
export const LANE_W = 12;

// ------------------------------------------------------------------ pure helpers
/** Priority of an ally for a patch: the more battered and the closer, the better (higher wins). */
export function patchScore(missingFrac: number, dist: number, champion = false): number {
  return 2 * clamp(missingFrac, 0, 1) + 0.6 * (1 - clamp(dist / PATCH_RANGE, 0, 1)) + (champion ? 0.2 : 0);
}

/** How far the hammer flies for a keeper `dist` px away: past the keeper, within the band. */
export function throwReach(dist: number): number {
  return clamp(dist + 28, THROW_REACH_MIN, THROW_REACH_MAX);
}

/** Outbound boomerang position at progress u (0..1): fast out, slowing to a stop at `reach`. */
export function boomerangPos(sx: number, sy: number, angle: number, reach: number, u: number): { x: number; y: number } {
  const k = clamp(u, 0, 1);
  const d = reach * (1 - (1 - k) * (1 - k));
  return { x: sx + Math.cos(angle) * d, y: sy + Math.sin(angle) * d };
}

// ------------------------------------------------------------------ palette
// leather cap, ruddy soot-smudged skin, brass goggles with sky lenses, ash beard,
// slate shirt, scorched apron, iron patches, hot hammer face
const TK: Record<string, string> = {
  c: '#232a46', C: '#3c4a78', D: '#6478ac',
  s: '#7a4434', S: '#b46c48', T: '#e09a6c',
  y: '#7a4e1c', Y: '#d8a44a', Z: '#fff0b0', l: '#2e8ccc', L: '#bff0ff',
  b: '#6e6670', B: '#b0a8b0', W: '#ece6e2',
  q: '#262438', Q: '#3e3e58', R: '#5e6080',
  a: '#4a2414', A: '#7a4226', P: '#ac6a3a', u: '#f0c060',
  k: '#1c1216', K: '#4a3430',
  i: '#3a3644', I: '#6e6878', J: '#aca6bc', r: '#e0b45a',
  w: '#6a4416', x: '#b07a30', h: '#3e3a48', H: '#77728a', G: '#b8b2c8', f: '#ff8a20', F: '#fff0a0',
};
const HOT = { hot: '#fff0a0', mid: '#ffa424', low: '#e0480c' };
const SPARKS = ['#ffffff', HOT.hot, HOT.mid];
const SOOT = ['#4a3a34', '#2a2024', '#6a5a50'];

// the head and torso (facing right), 13 wide; legs, arms, hammer and plates are drawn on top
const HEAD = [
  '...cccc......',
  '..cDDCCc.....',
  '.cDCCCCCc....',
  'YYYYSYYYYS...',
  'YLlyyYLlySTT.',
  'YllySYllySTT.',
  'yyyySyyyysss.',
  '.SWWBBWWBbs..',
];
const TORSO = [
  'QWWBBWWBBBbq.',
  'QqWBBWWBBbqq.',
  'QPAbBBBBbAaq.',
  '.PAAuuuuAAa..',
  '.PAAAuuAAAa..',
  '.PPAAAAAAaa..',
];
const TORSO_HURT = [
  'QWBWBBWBWBbq.',
  'QqWBWBBWBbqq.',
  'QPAbBBBBbAaq.',
  '.PAAuuuuAAa..',
  '.PAAAuuAAAa..',
  '.PPAAAAAAaa..',
];

type TinkerMode = 'idle' | 'walk' | 'wind' | 'strike' | 'cock' | 'throw' | 'wait' | 'hurt';

/** Hammer drawn from the hand (hx, hy) along (dx, dy): a 5 px handle, then the iron head across it. */
function paintHammer(p: PixelPainter, hx: number, hy: number, dx: number, dy: number, hot: boolean, len = 5): void {
  for (let i = 1; i <= len; i++) p.px(hx + Math.round(dx * i), hy + Math.round(dy * i), i % 2 ? TK.x : TK.w);
  const ex = hx + Math.round(dx * (len + 1.5));
  const ey = hy + Math.round(dy * (len + 1.5));
  if (Math.abs(dx) > Math.abs(dy)) {
    // handle horizontal: the head stands up across it
    p.rect(ex - 1, ey - 2, 3, 5, TK.h);
    p.rect(ex - 1, ey - 2, 3, 1, TK.G);
    p.rect(ex - 1, ey - 1, 1, 3, TK.H);
    const fy = ey + 2;
    p.rect(ex - 1, fy, 3, 1, hot ? TK.f : TK.h);
    if (hot) p.px(ex, fy, TK.F);
  } else {
    // handle vertical: the head lies across it; the striking face (front) can glow
    p.rect(ex - 2, ey - 1, 5, 3, TK.h);
    p.rect(ex - 2, ey - 1, 5, 1, TK.G);
    p.rect(ex - 2, ey, 1, 2, TK.H);
    p.px(ex - 1, ey, TK.H);
    p.rect(ex + 2, ey - 1, 1, 3, hot ? TK.f : TK.h);
    if (hot) p.px(ex + 2, ey, TK.F);
  }
}

function paintTinker(p: PixelPainter, k: number, mode: TinkerMode): void {
  const walk = mode === 'walk';
  // idle: a slow breath (head and torso dip a pixel), hammer resting at its side
  const bob = walk ? [0, -1, 0, -1][k] : mode === 'idle' ? k : mode === 'wait' ? (k ? -1 : 0) : mode === 'strike' ? 1 : 0;
  // lean: head/torso shift (back when cocking or hurt, forward when striking / throwing)
  const lean = mode === 'cock' || mode === 'hurt' ? -1 : mode === 'strike' || mode === 'throw' ? 1 : 0;
  const ox = 6 + lean;
  const oy = 3 + bob;
  // --- legs (stubby boots under the apron)
  const st = walk ? [1, 0, -1, 0][k] : mode === 'strike' || mode === 'cock' || mode === 'throw' ? 1 : 0;
  const lx = 9;
  p.rect(lx - st, 16, 2, 2, TK.q);
  p.rect(lx + 4 + st, 16, 2, 2, TK.q);
  p.rect(lx - 1 - st, 18, 3, 1, TK.k);
  p.rect(lx + 4 + st, 18, 3, 1, TK.k);
  p.px(lx + 1 - st, 18, TK.K);
  p.px(lx + 6 + st, 18, TK.K);
  // --- the stack of iron patches strapped to the back
  const px0 = ox - 2;
  const py0 = oy + 7;
  p.rect(px0, py0, 4, 6, TK.i);
  p.rect(px0, py0, 4, 1, TK.J);
  p.rect(px0, py0 + 2, 4, 1, TK.I);
  p.rect(px0, py0 + 4, 4, 1, TK.I);
  p.px(px0 + 1, py0 + 1, TK.r);
  p.px(px0 + 2, py0 + 3, TK.r);
  p.px(px0 + 1, py0 + 5, TK.r);
  // --- the hammer behind the body while cocking a throw
  if (mode === 'cock') {
    p.line(ox + 3, oy + 9, ox + 1, oy + 7, TK.Q);
    paintHammer(p, ox + 1, oy + 7, -0.7, -0.75, k === 1);
  }
  // --- head + torso
  p.stamp(ox, oy, HEAD, TK);
  p.stamp(ox, oy + 8, mode === 'hurt' ? TORSO_HURT : TORSO, TK);
  if (mode === 'hurt') {
    // cracked goggles
    p.px(ox + 1, oy + 4, TK.W);
    p.px(ox + 2, oy + 5, TK.W);
    p.px(ox + 6, oy + 4, TK.W);
    p.px(ox + 7, oy + 5, TK.W);
  }
  if (mode === 'wind' || mode === 'strike') {
    // goggles flare while it works the metal
    p.px(ox + 1, oy + 4, TK.Z);
    p.px(ox + 6, oy + 4, TK.Z);
  }
  // --- front arm + hammer
  const sx = ox + 11;
  const sy = oy + 9;
  if (walk || mode === 'idle') {
    // held upright at its side, swaying with the stride
    const sw = walk ? [0, 1, 0, -1][k] : 0;
    p.line(sx, sy, sx + 2, sy + 2, TK.R);
    p.px(sx + 3, sy + 3, TK.T);
    paintHammer(p, sx + 3, sy + 3, 0.2 * sw, -1, false, 4);
  } else if (mode === 'wind') {
    // hammer raised high over the head
    p.line(sx, sy, sx + 1, sy - 4, TK.R);
    p.px(sx + 1, sy - 5, TK.T);
    paintHammer(p, sx + 1, sy - 5, -0.45, -1, k === 1);
  } else if (mode === 'strike') {
    // brought down onto the work in front: the head stands on its glowing face
    p.line(sx, sy, sx + 1, sy + 1, TK.R);
    p.px(sx + 2, sy + 1, TK.T);
    p.px(sx + 3, sy + 2, TK.x);
    p.px(sx + 3, sy + 3, TK.w);
    p.px(sx + 4, sy + 4, TK.x);
    const hx = sx + 4;
    const hy = 14;
    p.rect(hx, hy, 3, 4, TK.h);
    p.rect(hx, hy, 3, 1, TK.G);
    p.rect(hx, hy + 1, 1, 2, TK.H);
    p.rect(hx, hy + 3, 3, 1, TK.f);
    p.px(hx + 1, hy + 3, TK.F);
    // sparks off the blow
    p.px(hx - 1, hy + 2, TK.F);
    p.px(hx + 4, hy + 1, TK.F);
    p.px(hx + 4, hy + 3, TK.f);
    p.px(hx + 2, hy - 2, TK.F);
  } else if (mode === 'cock') {
    // empty front hand points the way
    p.line(sx, sy, sx + 3, sy - 1, TK.R);
    p.px(sx + 4, sy - 1, TK.T);
  } else if (mode === 'throw') {
    p.line(sx, sy, sx + 4, sy - 2, TK.R);
    p.px(sx + 5, sy - 2, TK.T);
    p.px(sx + 5, sy - 3, TK.T);
  } else if (mode === 'wait') {
    // hands up and open, ready to catch
    p.line(sx, sy, sx + 2, sy - 3, TK.R);
    p.px(sx + 3, sy - 4, TK.T);
    p.px(sx + 2, sy - 4, TK.T);
    p.px(sx + 3, sy - 3, TK.T);
  } else {
    p.line(sx, sy, sx + 1, sy + 3, TK.R);
    p.px(sx + 1, sy + 4, TK.T);
  }
}
const TW = 24;
const TH = 19;
frames('tinker', 'idle', 2, TW, TH, (p, i) => paintTinker(p, i, 'idle'), { anchor: 'bottom', fps: 2.5 });
frames('tinker', 'walk', 4, TW, TH, (p, i) => paintTinker(p, i, 'walk'), { anchor: 'bottom', fps: 9 });
frames('tinker', 'wind', 2, TW, TH, (p, i) => paintTinker(p, i, 'wind'), { anchor: 'bottom', fps: 12 });
frames('tinker', 'strike', 1, TW, TH, (p) => paintTinker(p, 0, 'strike'), { anchor: 'bottom' });
frames('tinker', 'cock', 2, TW, TH, (p, i) => paintTinker(p, i, 'cock'), { anchor: 'bottom', fps: 12 });
frames('tinker', 'throw', 1, TW, TH, (p) => paintTinker(p, 0, 'throw'), { anchor: 'bottom' });
frames('tinker', 'wait', 2, TW, TH, (p, i) => paintTinker(p, i, 'wait'), { anchor: 'bottom', fps: 5 });
frames('tinker', 'hurt', 1, TW, TH, (p) => paintTinker(p, 0, 'hurt'), { anchor: 'bottom' });

// the thrown hammer (spins around its head; bright steel so it reads as a missile), and
// the riveted patch plate bolted onto an ally: hot, cooled, cracked
const STEEL = { dark: '#4e4a62', mid: '#9a94b0', hi: '#e2dcf0' };
function paintThrown(p: PixelPainter, hot: boolean): void {
  p.line(0, 4, 6, 4, TK.x);
  p.line(1, 5, 6, 5, TK.w);
  p.rect(7, 1, 4, 7, STEEL.mid);
  p.rect(7, 1, 4, 1, STEEL.hi);
  p.rect(7, 2, 1, 5, STEEL.hi);
  p.rect(10, 2, 1, 5, STEEL.dark);
  p.rect(8, 6, 2, 1, STEEL.dark);
  p.rect(7, 7, 4, 1, hot ? TK.f : STEEL.dark);
  if (hot) {
    p.px(8, 7, TK.F);
    p.px(9, 7, TK.F);
  }
}
defineDrawnSprite('tinker_hammer', 11, 9, (p) => paintThrown(p, false), { outline: '#0c0810', origin: [8, 4] });
defineDrawnSprite('tinker_hammer_hot', 11, 9, (p) => paintThrown(p, true), { outline: '#0c0810', origin: [8, 4] });

// Copper, not grey iron: most of the forge's crew is dark steel (sentinel, welder, hound,
// golem), and a grey plate vanished on them at game scale. Hot = glowing orange; cooled =
// bright copper with pale rivets; cracked = darker, split down the middle.
export const PATCH_RAMP = {
  hot: { dark: '#a8300a', mid: '#ff7a1a', hi: '#ffd27a', rivet: '#ffffff' },
  cool: { dark: '#6a2a12', mid: '#c4682c', hi: '#f4ac5c', rivet: '#fff0b8' },
  cracked: { dark: '#4e1e0c', mid: '#9a4a22', hi: '#d68a4a', rivet: '#e8c890' },
};
function paintPatch(p: PixelPainter, state: 'hot' | 'cool' | 'cracked'): void {
  const c = PATCH_RAMP[state];
  p.rect(0, 0, 7, 5, c.mid);
  p.rect(0, 0, 6, 1, c.hi);
  p.rect(0, 1, 1, 3, c.hi);
  p.rect(6, 1, 1, 4, c.dark);
  p.rect(1, 4, 6, 1, c.dark);
  for (const [x, y] of [[1, 1], [5, 1], [1, 3], [5, 3]]) p.px(x, y, c.rivet);
  if (state === 'cracked') {
    for (const [x, y] of [[3, 0], [3, 1], [4, 2], [3, 3], [3, 4]]) p.px(x, y, '#1a0804');
    p.px(4, 1, c.hi);
  }
}
defineDrawnSprite('tinker_patch_hot', 7, 5, (p) => paintPatch(p, 'hot'), { outline: '#1a0804' });
defineDrawnSprite('tinker_patch', 7, 5, (p) => paintPatch(p, 'cool'), { outline: '#1a0804' });
defineDrawnSprite('tinker_patch_cracked', 7, 5, (p) => paintPatch(p, 'cracked'), { outline: '#1a0804' });
// the "this one is next" marker over the ally the tinker is heading for
defineDrawnSprite('tinker_mark', 7, 6, (p) => {
  p.poly([0, 0, 7, 0, 3.5, 5], '#ffb040');
  p.line(1, 1, 5, 1, '#fff0a0');
  p.px(3, 3, '#ffffff');
}, { outline: '#1a0804' });

// ------------------------------------------------------------------ the patch (temporary armour)
/** Live patch on `ally`, if any. */
export function patchOn(w: World, ally: Enemy): TinkerPatch | null {
  for (const e of w.entities) if (e instanceof TinkerPatch && !e.dead && e.ally === ally) return e;
  return null;
}

/**
 * A red-hot iron patch riveted onto an ally: `amount` extra HP stacked on top of the ally's
 * HP (it soaks hits first). It breaks when the ally drops back to the HP it had when it was
 * patched, and falls off — taking whatever is left of it — after PATCH_LIFE or as soon as
 * its tinker dies.
 */
export class TinkerPatch extends Entity {
  ally: Enemy;
  owner: Enemy;
  amount: number;
  /** ally HP line under which the patch is gone */
  guard: number;
  lastHp: number;
  /** hit-flash timer (set from HP changes, deterministic) */
  hitT = 0;

  constructor(owner: Enemy, ally: Enemy) {
    super();
    this.owner = owner;
    this.ally = ally;
    this.x = ally.x;
    this.y = ally.y;
    this.layer = 1;
    this.tileCollide = false;
    this.amount = Math.max(1, Math.round(ally.maxHp * PATCH_SHARE));
    this.guard = ally.hp;
    ally.hp += this.amount;
    this.lastHp = ally.hp;
  }

  /** Rivet a patch onto `ally` (feedback included). */
  static rivet(w: World, owner: Enemy, ally: Enemy): TinkerPatch {
    const pt = w.spawn(new TinkerPatch(owner, ally));
    const b = pt.badge();
    w.particles.burst(b.x, b.y, { count: 12, speed: [40, 130], life: [0.15, 0.35], colors: SPARKS, size: [1, 2], shape: 'spark', additive: true, light: 6 });
    w.spawn(new RingFx(b.x, b.y, 12, 0.22, HOT.mid, 2));
    w.sfx('hit_metal', { vol: 0.6, pitch: 0.85, x: ally.x });
    w.sfx('shield_block', { vol: 0.35, pitch: 0.7, x: ally.x });
    ally.squash(1.15, 0.88);
    return pt;
  }

  /** 0..1 of the patch still left. */
  get left(): number {
    return clamp((this.ally.hp - this.guard) / this.amount, 0, 1);
  }

  override get sortY(): number {
    return this.ally.y + 0.05;
  }

  /** Where the plate sits on the ally's body (world px). */
  badge(): { x: number; y: number } {
    const a = this.ally;
    const top = a.y - a.z + (a.def.spriteYOffset ?? 0) - this.spriteTop(a);
    return { x: a.x - a.facing * 1, y: top };
  }

  /** Height above the sprite pivot of the ally's chest (draw-time sprite size; a fallback in the sim). */
  private spriteTop(a: Enemy): number {
    return a.r * 1.3 * a.scale;
  }

  override update(w: World, rawDt: number): void {
    // an enemy effect: its clock stops with the enemies' (time-stop / slow items)
    const dt = rawDt * w.enemyTimeScale;
    this.age += dt;
    const a = this.ally;
    this.x = a.x;
    this.y = a.y;
    if (a.dead || !a.alive) {
      this.dead = true;
      return;
    }
    if (a.hp <= this.guard) {
      this.off(w, true);
      return;
    }
    if (a.hp < this.lastHp - 1e-9) {
      // the plate takes the blow: sparks, a clank
      if (this.hitT <= 0) w.sfx('hit_metal', { vol: 0.3, pitch: fx.range(1.2, 1.5), x: a.x });
      this.hitT = 0.12;
      const b = this.badge();
      w.particles.burst(b.x, b.y, { count: 5, speed: [40, 110], life: [0.1, 0.25], colors: ['#ffffff', '#ffe080', HOT.mid], size: [1, 2], shape: 'spark' });
    }
    this.lastHp = a.hp;
    if (this.hitT > 0) this.hitT -= dt;
    if (!this.owner.alive || this.owner.dead || this.age >= PATCH_LIFE) {
      this.off(w, false);
      return;
    }
    if (fx.chance(this.age < 0.6 ? 0.5 : 0.06)) {
      const b = this.badge();
      w.particles.spawn({ x: b.x + fx.range(-3, 3), y: b.y + fx.range(-2, 2), vy: -fx.range(8, 20), life: fx.range(0.2, 0.45), colors: [HOT.hot, HOT.mid, '#7a2a10'], size: 1, additive: true });
    }
  }

  /** The patch is gone: broken (soaked its share) or popped off (expired / tinker died). */
  off(w: World, broken: boolean): void {
    if (this.dead) return;
    this.dead = true;
    const a = this.ally;
    // whatever is left of the plate goes with it
    if (a.alive && a.hp > this.guard) a.hp = this.guard;
    const b = this.badge();
    w.particles.burst(b.x, b.y, {
      count: broken ? 9 : 6, speed: [30, broken ? 110 : 70], life: [0.35, 0.7], colors: ['#aca6bc', '#6e6878', '#3a3644', '#e0b45a'],
      size: [1, 2], gravity: 320, vz: [30, 90], shape: 'square', vrot: 12,
    });
    w.sfx(broken ? 'rock_break' : 'hit_metal', { vol: broken ? 0.35 : 0.3, pitch: broken ? 1.6 : 0.7, x: a.x });
  }

  override draw(r: Renderer): void {
    const a = this.ally;
    if (a.hidden || a.dead) return;
    const s = getSprite(a.frame());
    const top = a.y - a.z + (a.def.spriteYOffset ?? 0) - s.oy * a.scale;
    const bx = a.x - a.facing * 1;
    const by = top + s.h * 0.56 * a.scale;
    const name = this.age < 0.6 ? 'tinker_patch_hot' : this.left < 0.5 ? 'tinker_patch_cracked' : 'tinker_patch';
    // the last second it blinks before it drops off
    if (PATCH_LIFE - this.age < 1 && Math.floor(this.age * 10) % 2 === 0) return;
    r.sprite(name, bx, by, { flash: this.hitT > 0 ? 0.8 : 0, flipX: a.facing < 0 });
    // a metal glint sweeps across the plate now and then (draw-only, from its own clock)
    const g = (this.age + (this.id % 7) * 0.21) % 1.6;
    if (this.age > 0.6 && g < 0.24) {
      const gx = Math.round(bx - 3 + (g / 0.24) * 6);
      const gy = Math.round(by);
      r.rect(gx, gy - 2, 1, 2, '#ffffff', 0.9);
      r.rect(gx - 1, gy, 1, 2, '#ffffff', 0.9);
    }
  }

  override light(w: World): void {
    if (this.age < 0.8) w.lights.add(this.ally.x, this.ally.y - 6, 18, '#ff8a30', { intensity: 0.7 * (1 - this.age / 0.8) });
  }
}

// ------------------------------------------------------------------ the thrown hammer
/**
 * The tinker's hammer in flight: out along the warned lane (fast, slowing), a hang at the
 * far end while the way back is marked, then back to the tinker (homing on it, speeding
 * up). Hurts a keeper once per leg. Drops harmlessly if the tinker dies or a bullet-clear
 * erases it.
 */
export class TinkerHammer extends Entity {
  owner: Enemy;
  angle: number;
  reach: number;
  sx: number;
  sy: number;
  state: 'out' | 'hang' | 'back' | 'drop' = 'out';
  /** time in the current state */
  t = 0;
  speed = 0;
  /** finished (caught or dropped): the tinker stops waiting */
  done = false;
  caught = false;
  spin: number;
  /** keeper id -> leg (0 out, 1 back) it was last hit on */
  struck = new Map<number, number>();
  warning: GroundWarning | null = null;
  /** enemy-time clock of the return-lane warning */
  warnT = 0;
  whooshT = 0;

  /** (sx, sy): where it leaves from — the start of its warned lane (default: the thrower) */
  constructor(owner: Enemy, angle: number, reach: number, sx = owner.x, sy = owner.y) {
    super();
    this.owner = owner;
    this.angle = angle;
    this.reach = reach;
    this.sx = this.x = sx;
    this.sy = this.y = sy;
    this.z = 9;
    this.r = HAMMER_R;
    this.layer = 1;
    this.tileCollide = false;
    this.team = 'enemy';
    this.enemyHazard = true;
    this.spin = Math.cos(angle) >= 0 ? 1 : -1;
  }

  get leg(): number {
    return this.state === 'back' ? 1 : 0;
  }

  /** it whirls at head height: drawn over a keeper (or ally) it overlaps */
  override get sortY(): number {
    return this.y + 4;
  }

  override update(w: World, rawDt: number): void {
    // an enemy missile: it freezes / slows with the enemies' time like their bullets do
    const dt = rawDt * w.enemyTimeScale;
    this.age += dt;
    this.t += dt;
    const o = this.owner;
    if (this.state !== 'drop' && (o.dead || !o.alive)) this.drop(w);
    switch (this.state) {
      case 'out': {
        const u = this.t / THROW_OUT;
        const p = boomerangPos(this.sx, this.sy, this.angle, this.reach, u);
        this.x = p.x;
        this.y = p.y;
        if (u >= 1) {
          this.state = 'hang';
          this.t = 0;
          // show the way back to the thrower
          const d = Math.hypot(o.x - this.x, o.y - this.y);
          if (d > 8) this.warning = laneWarning(w, this.x, this.y, Math.atan2(o.y - this.y, o.x - this.x), d, LANE_W, THROW_HANG + 0.2);
        }
        break;
      }
      case 'hang':
        if (this.t >= THROW_HANG) {
          this.state = 'back';
          this.t = 0;
          this.speed = 40;
        }
        this.syncWarning(dt);
        break;
      case 'back': {
        this.speed = Math.min(RETURN_MAX, this.speed + RETURN_ACCEL * dt);
        const dx = o.x - this.x;
        const dy = o.y - this.y;
        const d = Math.hypot(dx, dy);
        const st = this.speed * dt;
        if (d <= Math.max(7, st) || this.t > 3) {
          this.x = o.x;
          this.y = o.y;
          this.done = true;
          this.caught = true;
          this.dead = true;
          if (this.warning) this.warning.dead = true;
          w.sfx('hit_metal', { vol: 0.35, pitch: 1.3, x: o.x });
          return;
        }
        this.x += (dx / d) * st;
        this.y += (dy / d) * st;
        // knocked about while it waited, its thrower may now stand behind a rock: the
        // hammer never flies through one — it clangs off it and drops
        if (w.room.boxBlocked(this.x, this.y, 2, true, false)) {
          this.drop(w);
          return;
        }
        this.syncWarning(dt);
        break;
      }
      case 'drop':
        this.z = Math.max(0, this.z - 70 * dt);
        if (this.t >= 0.7) this.dead = true;
        return;
    }
    // whirring
    this.whooshT -= dt;
    if (this.whooshT <= 0) {
      this.whooshT = 0.2;
      w.sfx('whoosh', { vol: 0.22, pitch: fx.range(1.3, 1.5), x: this.x });
    }
    if (fx.chance(0.5)) {
      w.particles.spawn({ x: this.x + fx.range(-2, 2), y: this.y - this.z + fx.range(-2, 2), life: fx.range(0.12, 0.25), colors: SPARKS, size: 1, additive: true });
    }
    // it hurts a keeper once on the way out and once on the way back
    const leg = this.leg;
    for (const p of w.targets()) {
      if (!p.alive || p.z > 10) continue;
      if (this.struck.get(p.id) === leg) continue;
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (d >= HAMMER_R + p.r * 0.6) continue;
      if (p.hurt(w, 1, TINKER_NAME, false, this)) {
        this.struck.set(p.id, leg);
        const a = this.state === 'back' ? Math.atan2(o.y - this.y, o.x - this.x) : this.angle;
        p.knock(Math.cos(a), Math.sin(a), 140);
        w.sfx('hit_metal', { vol: 0.4, pitch: 0.9, x: p.x });
      }
    }
  }

  /**
   * The return-lane warning shows the way back as it is now: from the hammer to its
   * thrower (who may have been shoved since), on enemy time like the hammer itself.
   */
  private syncWarning(dt: number): void {
    const g = this.warning;
    if (!g || g.dead) return;
    this.warnT += dt;
    g.age = Math.min(g.age, this.warnT);
    const o = this.owner;
    g.x = this.x;
    g.y = this.y;
    g.angle = Math.atan2(o.y - this.y, o.x - this.x);
    g.rw = Math.max(1, Math.hypot(o.x - this.x, o.y - this.y));
  }

  /** Clatter to the floor, harmless. */
  drop(w: World): void {
    if (this.state === 'drop') return;
    this.state = 'drop';
    this.t = 0;
    this.done = true;
    this.enemyHazard = false;
    if (this.warning) this.warning.dead = true;
    w.sfx('hit_metal', { vol: 0.3, pitch: 0.6, x: this.x });
    dust(w, this.x, this.y, SOOT, 4, 30);
  }

  override onCleared(w: World): void {
    this.drop(w);
  }

  override draw(r: Renderer): void {
    const dropT = this.state === 'drop' ? this.t : 0;
    const alpha = this.state === 'drop' ? clamp((0.7 - dropT) / 0.35, 0, 1) : 1;
    r.shadow(this.x, this.y + 1, 9, 3.5, 0.35 * alpha);
    const spinning = this.state !== 'drop';
    const rot = spinning ? this.age * 19 * this.spin : this.spin > 0 ? 0.3 : Math.PI - 0.3;
    const name = this.state === 'out' ? 'tinker_hammer_hot' : 'tinker_hammer';
    if (spinning) {
      // a hot glow and two fading afterimages of the spin: it reads as a whirling missile
      r.pixelDisc(this.x, this.y - this.z, 6, HOT.mid, 0.22);
      r.sprite(name, this.x, this.y - this.z, { rot: rot - 0.9 * this.spin, alpha: 0.18 });
      r.sprite(name, this.x, this.y - this.z, { rot: rot - 0.45 * this.spin, alpha: 0.38 });
    }
    r.sprite(name, this.x, this.y - this.z, { rot, alpha });
  }

  override light(w: World): void {
    if (this.state !== 'drop') w.lights.add(this.x, this.y - this.z, 16, '#ffa040', { intensity: 0.7 });
  }
}

// ------------------------------------------------------------------ AI
/** Can `e` (a tinker) patch `a` right now? */
function patchable(e: Enemy, a: Enemy): boolean {
  return a !== e && a.alive && !a.dead && !a.hidden && a.vulnerable && !a.isBoss && a.def.id !== TINKER_ID && a.def.hp >= PATCH_MIN_HP && !a.hasStatus('charm');
}

/** The ally most worth a patch within reach (deterministic: list order breaks ties). */
export function pickPatchTarget(w: World, e: Enemy): Enemy | null {
  let best: Enemy | null = null;
  let bestS = -Infinity;
  for (const a of w.enemies) {
    if (!patchable(e, a)) continue;
    const d = Math.hypot(a.x - e.x, a.y - e.y);
    if (d > PATCH_RANGE || patchOn(w, a)) continue;
    const s = patchScore(1 - a.hp / Math.max(1, a.maxHp), d, a.champion);
    if (s > bestS) {
      bestS = s;
      best = a;
    }
  }
  return best;
}

/** Nearest other living enemy (to hide behind). */
function nearestAlly(w: World, e: Enemy, max: number): Enemy | null {
  let best: Enemy | null = null;
  let bd = max;
  for (const a of w.enemies) {
    if (a === e || !a.alive || a.dead || a.hidden || a.def.id === TINKER_ID) continue;
    const d = Math.hypot(a.x - e.x, a.y - e.y);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return best;
}

type Sub = Generator<number | undefined | void, boolean, unknown>;

/** Hurry to `ally`, raise the hammer (telegraph + mark), rivet the patch on. */
function* mend(e: Enemy, w: World, ally: Enemy): Sub {
  e.mem.patchTarget = ally.id;
  e.setAnim('tinker_walk');
  let reached = false;
  let dodge = 0;
  for (let el = 0; el < PATCH_APPROACH; el += w.dt) {
    if (!patchable(e, ally) || patchOn(w, ally)) break;
    const dx = ally.x - e.x;
    const dy = ally.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d <= ally.r + e.r + PATCH_GAP) {
      reached = true;
      break;
    }
    if (e.mem.__bumped) dodge = 0.3;
    if (dodge > 0) {
      // step around whatever is in the way
      dodge -= w.dt;
      e.moveDir(dx - dy * 1.4, dy + dx * 1.4, e.speed * 1.15);
    } else e.moveDir(dx, dy, e.speed * 1.15);
    yield;
  }
  if (!reached) {
    e.mem.patchTarget = 0;
    return false;
  }
  e.halt();
  e.facing = ally.x >= e.x ? 1 : -1;
  e.setAnim('tinker_wind');
  e.telegraph(PATCH_WIND);
  w.sfx('enemy_charge', { vol: 0.3, pitch: 1.5, x: e.x });
  for (let el = 0; el < PATCH_WIND; el += 0.1) {
    gather(w, ally.x, ally.y - ally.r - 4, SPARKS, 2, 12);
    yield 0.1;
  }
  e.mem.patchTarget = 0;
  if (!patchable(e, ally) || patchOn(w, ally) || Math.hypot(ally.x - e.x, ally.y - e.y) > ally.r + e.r + PATCH_GAP + 14) return false;
  e.setAnim('tinker_strike');
  TinkerPatch.rivet(w, e, ally);
  e.squash(1.2, 0.82);
  e.mem.lastPatch = e.age;
  yield 0.45;
  return true;
}

/** Wind up (lane shown), throw, stand still until the hammer is back (or lost). */
function* throwHammer(e: Enemy, w: World, again: boolean): Sub {
  const tg = e.target(w);
  const a = Math.atan2(tg.y - e.y, tg.x - e.x);
  const dist = Math.hypot(tg.x - e.x, tg.y - e.y);
  // (a champion's follow-up throw only if the keeper is still within reach)
  if (again && dist > THROW_RANGE) return false;
  const want = throwReach(dist);
  let reach = Math.min(want, rayFree(w.room, e.x, e.y, a, 3, THROW_REACH_MAX, true, 2));
  if (reach < 28) return false;
  e.halt();
  e.facing = Math.cos(a) >= 0 ? 1 : -1;
  e.setAnim('tinker_cock');
  const wind = again ? THROW_WIND_AGAIN : THROW_WIND;
  const lane = laneWarning(w, e.x, e.y, a, reach + HAMMER_R, LANE_W, wind);
  e.telegraph(wind);
  w.sfx('enemy_charge', { vol: 0.4, pitch: 1.15, x: e.x });
  // The warned lane stays the truth: shoved by the keeper's shots mid wind-up (up to ~11 px),
  // the lane moves with the tinker, so the hammer always leaves along what was shown. Its
  // clock is enemy time, so a time stop holds the lane (and the flash) until the release.
  for (let el = 0; ; ) {
    yield;
    el += w.dt * w.enemyTimeScale;
    if (el >= wind) break;
    reach = Math.min(want, rayFree(w.room, e.x, e.y, a, 3, THROW_REACH_MAX, true, 2));
    lane.x = e.x;
    lane.y = e.y;
    lane.rw = reach + HAMMER_R;
    lane.age = Math.min(lane.age, el);
    e.telegraphT = Math.max(e.telegraphT, wind - el);
  }
  lane.dead = true;
  if (reach < 12) return false;
  e.setAnim('tinker_throw');
  e.mem.hammerOut = 1;
  // (from the lane as last shown: a shove in this very frame does not bend it)
  const h = w.spawn(new TinkerHammer(e, a, reach, lane.x, lane.y));
  w.sfx('whoosh', { vol: 0.5, pitch: 0.85, x: e.x });
  e.squash(0.85, 1.15);
  yield 0.2;
  e.setAnim('tinker_wait');
  // (a hammer removed by anything else — a discarded encounter, a room change — ends the wait too)
  while (!h.done && !h.dead) {
    e.stop();
    yield;
  }
  if (h.caught) {
    e.mem.hammerOut = 0;
    e.squash(1.2, 0.85);
    yield 0.3;
    return true;
  }
  // lost it: rummages a spare out of its pack
  yield 0.9;
  e.mem.hammerOut = 0;
  w.sfx('hit_metal', { vol: 0.25, pitch: 1.6, x: e.x });
  yield 0.2;
  return true;
}

defineEnemy({
  id: TINKER_ID,
  name: TINKER_NAME,
  hp: 30,
  radius: 5,
  speed: 40,
  sprite: 'tinker_walk',
  spriteYOffset: 5,
  shadow: 12,
  cost: 1.5,
  floors: [3],
  weight: 0.75,
  champion: true,
  deathFx: 'blood',
  bloodColor: '#8a3a2a',
  light: { radius: 14, color: '#ffb050' },
  init(e) {
    e.mem.lastPatch = -PATCH_COOLDOWN;
  },
  *script(e, w) {
    e.setAnim('tinker_idle');
    yield w.rng.range(0.3, 0.8);
    let side = w.rng.sign();
    let throwNext = false;
    while (true) {
      // keep out of the way: behind the nearest ally, or at throwing distance
      const t = w.rng.range(1.0, 1.6);
      for (let el = 0; el < t; el += w.dt) {
        const tg = e.target(w);
        const d = e.distToTarget(w);
        const a = e.angleToTarget(w);
        const ally = d < 52 ? null : nearestAlly(w, e, 120);
        if (ally) {
          const aa = Math.atan2(ally.y - tg.y, ally.x - tg.x);
          const gx = ally.x + Math.cos(aa) * (ally.r + 20);
          const gy = ally.y + Math.sin(aa) * (ally.r + 20);
          const gd = Math.hypot(gx - e.x, gy - e.y);
          if (gd > 5) e.moveDir(gx - e.x, gy - e.y, Math.min(e.speed, gd * 3));
          else e.stop();
        } else if (d < 72) e.moveAngle(a + Math.PI + side * 0.6, e.speed);
        else if (d > THROW_RANGE - 6) e.chase(w, e.speed * 0.9);
        else e.moveAngle(a + (side * Math.PI) / 2, e.speed * 0.6);
        if (e.mem.__bumped && w.rng.chance(0.3)) side = -side;
        // standing behind its cover it idles instead of treading in place
        e.setAnim(Math.hypot(e.wantVX, e.wantVY) > 4 ? 'tinker_walk' : 'tinker_idle');
        yield;
      }
      // mend an ally (alternates with throwing)
      if (!throwNext && !e.hasStatus('charm') && e.age - e.mem.lastPatch >= PATCH_COOLDOWN) {
        const ally = pickPatchTarget(w, e);
        if (ally && (yield* mend(e, w, ally))) {
          throwNext = true;
          continue;
        }
      }
      // step out of cover into throwing range (it will not hide and mend forever: after a
      // repair the next turn is a throw, however long it takes to get one in)
      const inRange = () => {
        const tg = e.target(w);
        return e.distToTarget(w) <= THROW_RANGE && w.room.lineOfSight(e.x, e.y, tg.x, tg.y);
      };
      e.setAnim('tinker_walk');
      for (let el = 0; el < 2.2 && !inRange(); el += w.dt) {
        e.chase(w, e.speed);
        yield;
      }
      if (!inRange()) continue;
      throwNext = false;
      const n = e.champion ? 2 : 1;
      for (let i = 0; i < n; i++) if (!(yield* throwHammer(e, w, i > 0))) break;
      yield 0.35;
    }
  },
  update(e, w) {
    if (e.anim === 'tinker_wind' && fx.chance(0.5)) {
      w.particles.spawn({ x: e.x + e.facing * 3 + fx.range(-2, 2), y: e.y - 13, vx: fx.range(-20, 20), vy: -fx.range(10, 30), life: fx.range(0.1, 0.22), colors: SPARKS, size: 1, shape: 'spark', additive: true, gravity: 120 });
    }
  },
  onDeath(e, w) {
    // every patch it riveted pops off; a hammer in flight clatters down
    for (const x of w.entities) {
      if (x instanceof TinkerPatch && !x.dead && x.owner === e) x.off(w, false);
      else if (x instanceof TinkerHammer && !x.dead && x.owner === e) x.drop(w);
    }
    w.particles.burst(e.x, e.y - 8, { count: 6, speed: [30, 90], life: [0.4, 0.8], colors: ['#aca6bc', '#6e6878', '#3a3644'], size: [1, 2], gravity: 300, vz: [30, 90], shape: 'square', vrot: 10 });
  },
  draw(e, r, w) {
    // mark the ally it is heading for
    if (e.mem.patchTarget) {
      const a = w.entityById(e.mem.patchTarget) as Enemy | undefined;
      if (a && !a.dead && !a.hidden) {
        const s = getSprite(a.frame());
        const top = a.y - a.z + (a.def.spriteYOffset ?? 0) - s.oy * a.scale;
        r.sprite('tinker_mark', a.x, top - 6 + Math.round(Math.sin(w.time * 9) * 1.5));
      }
    }
    e.drawDefault(r, hurtFrame(e, w, 'tinker_hurt_0'));
  },
});
