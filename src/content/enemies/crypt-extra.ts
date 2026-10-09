// Floor 1 — 잊혀진 지하묘지 (crypt): one more regular enemy.
//  - 무덤 도굴꾼 (grave robber): a hooded ghoul with a loot sack and a spade. It never
//    stands its ground: it skulks 72–130 px away and lays iron jaw traps (at most three).
//    A keeper closing in gets one set at the robber's feet (it crouches: the telegraph),
//    and then it scurries off, so chasing it runs into the trap; a keeper standing off
//    gets one thrown at them (trap hoisted overhead, then a landing ring). A trap opens
//    over 0.6 s, then bites a grounded keeper who steps in (half a heart and a limp).
//    Dashing over a trap, shooting it, striking it or bombing it springs it harmlessly,
//    and every trap of a robber snaps shut when it dies. Cornered, it raises the spade
//    and flings a short fan of bone chips, then runs.
// Area denial + kiting: nothing else on the crypt floor leaves lasting danger on the floor.

import { defineEnemy } from '../../game/defs';
import { Actor, Entity, type HitInfo } from '../../game/entity';
import { defineDrawnSprite } from '../../engine/sprites';
import { PixelPainter } from '../../engine/painter';
import type { Renderer } from '../../engine/renderer';
import type { Enemy } from '../../game/enemy';
import type { Player } from '../../game/player';
import type { World } from '../../game/world';
import type { Script } from '../../engine/script';
import { dust, frames, hurtFrame, landingSpot, lob, rayFree, spinDraw, type FrameOpts } from './shared';

export const ROBBER_ID = 'grave_robber';
export const ROBBER_NAME = '무덤 도굴꾼';
/** Seconds a freshly set trap needs to open (harmless meanwhile). */
export const TRAP_ARM = 0.6;
/** Seconds an untouched trap lies before it rusts away. */
export const TRAP_LIFE = 11;
/** A grounded keeper whose centre comes within this (+ half its radius) springs an armed trap. */
export const TRAP_TRIGGER = 6;
/** Slow (power, seconds) after a bite. */
export const TRAP_SLOW = 0.5;
export const TRAP_SLOW_T = 0.9;
/** Live traps per robber (champion: one more). */
export const TRAP_MAX = 3;
/** Crouch (telegraph) before a trap is set. */
export const PLANT_TIME = 0.5;
/** Spade raised (telegraph) before the dirt fling; the keeper must be this close to provoke it. */
export const FLING_WIND = 0.5;
export const FLING_NEAR = 58;
export const FLING_COUNT = 5;
export const FLING_GAP = 0.22;
export const FLING_SPEED = 150;
export const FLING_RANGE = 104;
/** Trap toss: wind-up (telegraph), flight (the landing ring shows meanwhile), keeper distance band. */
export const TOSS_WIND = 0.45;
export const TOSS_FLIGHT = 0.7;
export const TOSS_MIN = 80;
export const TOSS_MAX = 190;

// ------------------------------------------------------------------ palette
const OUT = '#0c0810';
/** grave-moss cloak (cool shadows, warm lights) */
const COAT = ['#1c1a24', '#2e3632', '#44523f', '#62704f', '#8a9468'];
const SACK = ['#4a3424', '#6e5034', '#967046', '#bc9660', '#dcbc84'];
const SCARF = ['#3a1018', '#5e1a24', '#86262e', '#a8403a', '#c86048'];
/** pale ghoul hands */
const SKIN = ['#3e3446', '#625870', '#8e8496', '#bab0be'];
const IRON = ['#24222c', '#3e3c4a', '#5c5a6a', '#848294', '#b4b2c2', '#e0deea'];
const WOOD = ['#3e2414', '#6a4024', '#946038'];
export const GOLD = ['#6e4219', '#a66c28', '#d89c42', '#f6d47c', '#fff6cc'];
const DIRT = ['#2e2018', '#4a3426', '#6a4c34', '#8a6a48'];
const BONE = ['#7a6a52', '#b8a888', '#e8dcc0', '#fff8e8'];
const BOOT = '#241a1e';
const RUST = '#9a5430';
const ARMED = '#ff3040';

// ------------------------------------------------------------------ robber sprites
export type SpadeHold = 'drag' | 'raise' | 'swing' | 'rest' | 'drop';

export interface RobberPose {
  /** torso + head drop (+ = down) */
  bob: number;
  /** leg swing -2..2 */
  step: number;
  /** head forward shift */
  lean: number;
  /** sack bounce (+ = down) */
  sack: number;
  spade: SpadeHold;
  /** eyes: looking ahead, glancing back, flaring, squeezed shut */
  eye?: 'fwd' | 'back' | 'hot' | 'shut';
  /** crouched over a trap (0 / 1: prying the jaws open) */
  crouch?: 0 | 1;
  /** a trap hoisted overhead, or the arms flung forward after throwing it */
  carry?: 'over' | 'throw';
}

/**
 * Clean cel shading of everything painted on `p`: edges facing the top-left light get
 * `hi` (`top` where both sides are open), edges facing away get `lo`; the rest keeps its fill.
 */
function cel(p: PixelPainter, hi: string, lo: string, top = hi): void {
  const src = p.data.slice();
  const { w, h } = p;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && (src[y * w + x] >>> 24) !== 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      const up = on(x, y - 1);
      const left = on(x - 1, y);
      if (!up && !left) p.px(x, y, top);
      else if (!up || !left) p.px(x, y, hi);
      else if (!on(x + 1, y) || !on(x, y + 1)) p.px(x, y, lo);
    }
  }
}

/** Top of the loot sack (its centre row) in figure coordinates. */
function sackY(s: RobberPose): number {
  return 9 + s.bob + s.sack;
}

/**
 * The stolen gold goblet poking out of the sack's neck: rim, cup, stem. Painted on the
 * full frame at the figure's offset (`ox`, `oy`): on high steps it rises above the
 * figure canvas, where it used to be clipped (the goblet blinked out every other step).
 */
function paintGoblet(p: PixelPainter, s: RobberPose, ox: number, oy: number): void {
  const y = sackY(s) + oy;
  p.px(ox + 3, y - 8, GOLD[3]);
  p.px(ox + 4, y - 8, GOLD[4]);
  p.px(ox + 5, y - 8, GOLD[2]);
  p.px(ox + 3, y - 7, GOLD[2]);
  p.px(ox + 4, y - 7, GOLD[3]);
  p.px(ox + 5, y - 7, GOLD[1]);
  p.px(ox + 4, y - 6, GOLD[1]);
}

/** The loot sack slung on the back. */
function paintSack(p: PixelPainter, s: RobberPose): void {
  const y = sackY(s);
  const q = new PixelPainter(p.w, p.h);
  q.ellipse(4.5, y + 0.5, 3.9, 3.8, SACK[2]);
  q.poly([3, y - 3, 7, y - 3, 6.5, y - 5, 3.5, y - 5], SACK[2]);
  cel(q, SACK[3], SACK[1], SACK[4]);
  // cord round the neck, a patch, a lumpy bulge of loot
  q.line(3, y - 3, 6, y - 3, SACK[0]);
  q.px(7, y - 2, SACK[3]);
  q.rect(2, y + 1, 2, 2, SACK[1]);
  q.px(4, y + 1, SACK[0]);
  q.px(5, y - 1, SACK[3]);
  q.px(6, y + 2, SACK[1]);
  p.blit(q, 0, 0);
}

function paintLegs(p: PixelPainter, s: RobberPose): void {
  const hip = 15 + Math.max(0, s.bob - 1);
  const back = 8 + s.step;
  const front = 11 - s.step;
  p.line(8, hip, back, 19, COAT[0]);
  p.rect(back, 20, 2, 1, BOOT);
  p.line(11, hip, front, 19, COAT[1]);
  p.rect(front, 20, 2, 1, BOOT);
  p.px(front + 1, 19, BOOT);
}

function paintBody(p: PixelPainter, s: RobberPose): void {
  const b = s.bob;
  // hunched cloak: hump of the back, shoulders forward, a ragged hem
  const q = new PixelPainter(p.w, p.h);
  q.poly([6, 8 + b, 9, 6 + b, 13, 8 + b, 14, 12 + b, 14, 17, 12, 18, 10, 17, 8, 18, 6, 17, 5, 13 + b], COAT[2]);
  cel(q, COAT[3], COAT[1], COAT[4]);
  // the front third falls into shadow; broad folds
  for (let y = 9 + b; y < 18; y++) q.pxIn(13, y, COAT[1]);
  q.line(7, 14 + b, 7, 17, COAT[1]);
  q.line(10, 14 + b, 10, 17, COAT[1]);
  q.line(8, 14 + b, 8, 16, COAT[3]);
  // rope belt with a knot
  q.line(5, 13 + b, 13, 13 + b, '#7a5a38');
  q.px(6, 13 + b, '#a88a5c');
  q.px(11, 13 + b, '#a88a5c');
  q.px(11, 14 + b, '#7a5a38');
  q.px(12, 15 + b, '#5a4028');
  p.blit(q, 0, 0);
}

function paintHead(p: PixelPainter, s: RobberPose): void {
  const hx = 12 + s.lean;
  const hy = 5 + s.bob;
  // hood (its peak trails back), dark face opening
  const q = new PixelPainter(p.w, p.h);
  q.circle(hx, hy, 3.6, COAT[2]);
  q.poly([hx - 2, hy - 3, hx - 5, hy - 1, hx - 2, hy + 1], COAT[2]);
  cel(q, COAT[3], COAT[0], COAT[4]);
  q.px(hx - 1, hy - 2, COAT[3]);
  q.ellipse(hx + 1.6, hy + 0.6, 1.9, 2.2, '#120a0e');
  // eyes in the hood's shadow
  const eye = s.eye ?? 'fwd';
  if (eye === 'shut') {
    q.line(hx + 1, hy, hx + 3, hy, '#8a6a30');
  } else {
    const dx = eye === 'back' ? -1 : 0;
    const c = eye === 'hot' ? '#ffffff' : '#ffd040';
    q.px(hx + 1 + dx, hy, c);
    q.px(hx + 3 + dx, hy, c);
    if (eye === 'hot') {
      q.px(hx + 1, hy + 1, '#ffb030');
      q.px(hx + 3, hy + 1, '#ffb030');
    }
  }
  // crimson rag tied over nose and mouth
  q.rect(hx, hy + 2, 4, 2, SCARF[2]);
  q.line(hx, hy + 2, hx + 3, hy + 2, SCARF[3]);
  q.px(hx + 1, hy + 2, SCARF[4]);
  q.px(hx + 3, hy + 3, SCARF[1]);
  p.blit(q, 0, 0);
}

/** Spade: wooden haft from (x0,y0) to (x1,y1), a pointed iron blade beyond (x1,y1) along the haft. */
function paintSpade(p: PixelPainter, x0: number, y0: number, x1: number, y1: number, dirt: boolean): void {
  p.line(x0, y0, x1, y1, WOOD[1]);
  p.px(x0, y0, WOOD[2]);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const nx = -uy;
  const ny = ux;
  // T-grip at the top end
  p.px(x0 - ux + nx, y0 - uy + ny, WOOD[0]);
  p.px(x0 - ux - nx, y0 - uy - ny, WOOD[2]);
  // blade: a shoulder 3 wide, then tapering to a point; lit on the light side
  const bx = x1 + ux;
  const by = y1 + uy;
  p.poly([bx + nx * 1.6, by + ny * 1.6, bx - nx * 1.6, by - ny * 1.6, bx + ux * 3.5, by + uy * 3.5], IRON[3]);
  p.px(bx, by, IRON[2]);
  p.px(bx + nx * 1.2, by + ny * 1.2, IRON[4]);
  p.px(bx + ux * 1.5 + nx * 0.6, by + uy * 1.5 + ny * 0.6, IRON[5]);
  p.px(bx + ux * 1.5 - nx * 0.8, by + uy * 1.5 - ny * 0.8, IRON[2]);
  if (dirt) {
    // a heap of grave dirt with bone chips, piled on the blade
    const hx = bx + ux * 1.5 - nx * 1.8;
    const hy = by + uy * 1.5 - ny * 1.8;
    p.circle(hx, hy, 2, DIRT[2]);
    p.px(hx - 1, hy - 1, DIRT[3]);
    p.px(hx + 1, hy - 1, BONE[3]);
    p.px(hx, hy - 2, BONE[2]);
    p.px(hx + 1, hy + 1, DIRT[1]);
  }
}

function hand(p: PixelPainter, x: number, y: number): void {
  p.px(x, y, SKIN[3]);
  p.px(x + 1, y, SKIN[2]);
  p.px(x, y + 1, SKIN[2]);
  p.px(x + 1, y + 1, SKIN[1]);
}

/** A miniature trap held open in both hands while the robber sets it (frame k: jaws pried wider). */
function paintHeldTrap(p: PixelPainter, k: 0 | 1): void {
  const y = 19;
  const open = k ? 3 : 2;
  p.line(13, y, 20, y, IRON[2]);
  p.px(13, y, IRON[3]);
  p.line(14, y - open, 16, y, IRON[4]);
  p.line(19, y - open, 17, y, IRON[3]);
  p.px(14, y - open - 1, IRON[5]);
  p.px(19, y - open - 1, IRON[5]);
  p.px(15, y - open + 1, IRON[5]);
  p.px(18, y - open + 1, IRON[5]);
  p.px(16, y - 1, ARMED);
}

/** Front arm + spade (except the raised spade, drawn on the tall canvas). */
function paintArmAndSpade(p: PixelPainter, s: RobberPose): void {
  const b = s.bob;
  const sx = 12 + Math.min(1, s.lean);
  const sy = 9 + b;
  switch (s.spade) {
    case 'drag':
      // haft down across the front, the blade scraping the floor
      paintSpade(p, 13, 6 + b, 15, 15, false);
      p.line(sx, sy, 13, 11 + b, COAT[3]);
      hand(p, 13, 11 + b);
      break;
    case 'raise':
      // the arms and the raised spade are drawn on the tall canvas (paintRobber)
      break;
    case 'swing':
      // swung down and forward, the dirt flung off
      paintSpade(p, 12, 8 + b, 16, 13 + b, false);
      p.line(sx, sy, 14, 11 + b, COAT[3]);
      hand(p, 14, 10 + b);
      break;
    case 'rest':
      break;
    case 'drop':
      // knocked back, the spade sagging
      paintSpade(p, 12, 9 + b, 15, 15, false);
      p.line(sx, sy, 13, 12 + b, COAT[3]);
      hand(p, 13, 12 + b);
      break;
  }
}

/** A shut trap hoisted overhead (9x4 at (x, y)), about to be thrown. */
function paintHoistedTrap(p: PixelPainter, x: number, y: number): void {
  p.rect(x + 1, y + 1, 7, 2, IRON[3]);
  p.line(x + 1, y + 1, x + 6, y + 1, IRON[4]);
  for (let i = 0; i < 4; i++) p.px(x + 1 + i * 2, y, IRON[5]);
  p.px(x + 2, y, IRON[3]);
  p.px(x, y + 2, IRON[2]);
  p.px(x + 8, y + 2, IRON[2]);
  p.line(x + 1, y + 3, x + 7, y + 3, IRON[1]);
  p.px(x + 7, y + 2, RUST);
}

/** Figure canvas inside the 22x24 frame: 21x21 at (1, 3); the head-room above holds a raised spade, a hoisted trap or the goblet. */
const FIG_W = 21;
const FIG_H = 21;
const FIG_X = 1;
const FIG_Y = 3;

/** Robber frame, 22x24 (the figure at (FIG_X, FIG_Y); a raised spade, a hoisted trap or the goblet use the head-room). */
export function paintRobber(big: PixelPainter, s: RobberPose): void {
  paintGoblet(big, s, FIG_X, FIG_Y);
  const p = new PixelPainter(FIG_W, FIG_H);
  if (s.spade === 'rest') paintSpade(p, 2, 9, 2, 15, false); // stuck in the ground behind it
  paintSack(p, s);
  paintLegs(p, s);
  paintBody(p, s);
  paintHead(p, s);
  if (s.crouch !== undefined) {
    paintHeldTrap(p, s.crouch);
    // both arms reach down to the jaws
    const b = s.bob;
    p.line(12, 9 + b, 14, 16, COAT[3]);
    p.line(11, 10 + b, 17, 16, COAT[2]);
    hand(p, 14, 17);
    hand(p, 18, 17 - s.crouch);
  }
  paintArmAndSpade(p, s);
  big.blit(p, FIG_X, FIG_Y);
  const b = s.bob + 3;
  if (s.spade === 'raise') {
    // both hands up, the blade heaped with dirt high over the head (the haft clear of the face)
    paintSpade(big, 14, 12 + b, 18, 4 + b, true);
    big.line(13, 9 + b, 15, 9 + b, COAT[3]);
    hand(big, 15, 8 + b);
    hand(big, 14, 11 + b);
  }
  if (s.carry === 'over') {
    // a shut trap hoisted over the hood in both hands (arms either side of the face)
    const tx = 11 + s.lean;
    const ty = Math.max(0, b - 3);
    big.line(11, 12 + s.bob + 3, tx + 1, ty + 3, COAT[2]);
    big.line(15, 12 + s.bob + 3, tx + 7, ty + 3, COAT[3]);
    big.px(16, 11 + s.bob + 3, COAT[1]);
    paintHoistedTrap(big, tx, ty);
    hand(big, tx, ty + 2);
    hand(big, tx + 7, ty + 2);
  } else if (s.carry === 'throw') {
    // arms flung forward, hands open
    big.line(13, 11 + s.bob + 3, 18, 9 + s.bob + 3, COAT[3]);
    big.line(14, 12 + s.bob + 3, 19, 11 + s.bob + 3, COAT[2]);
    hand(big, 18, 8 + s.bob + 3);
    hand(big, 19, 10 + s.bob + 3);
  }
}

const RW = 22;
const RH = 24;
const RO = { anchor: 'bottom' as const };
export const ROBBER_W = RW;
export const ROBBER_H = RH;
const WALK: RobberPose[] = [
  { bob: 0, step: 1, lean: 0, sack: 0, spade: 'drag' },
  { bob: -1, step: 0, lean: 0, sack: 1, spade: 'drag' },
  { bob: 0, step: -1, lean: 0, sack: 0, spade: 'drag' },
  { bob: -1, step: 0, lean: 0, sack: -1, spade: 'drag' },
];
/** Every robber frame's pose, by state (`grobber_<state>_<i>`). */
export const ROBBER_POSES: Record<string, RobberPose[]> = {
  walk: WALK,
  run: WALK.map((w) => ({ ...w, step: w.step * 2, lean: 1, sack: w.sack * 2 })),
  idle: [0, 1].map((i) => ({ bob: 0, step: 0, lean: 0, sack: 0, spade: 'drag', eye: i ? 'back' : 'fwd' })),
  plant: [0, 1].map((i) => ({ bob: 3, step: 1, lean: 1, sack: 1 - i, spade: 'rest', eye: 'hot', crouch: i as 0 | 1 })),
  wind: [0, 1].map((i) => ({ bob: i ? -1 : 0, step: -1, lean: -1, sack: 0, spade: 'raise', eye: i ? 'hot' : 'fwd' })),
  fling: [0, 1].map((i) => ({ bob: i ? 1 : 2, step: 1, lean: 2, sack: i ? 0 : -1, spade: 'swing', eye: 'hot' })),
  toss: [0, 1].map((i) => ({ bob: i ? 0 : 1, step: -1, lean: -1, sack: i ? 0 : 1, spade: 'rest', eye: i ? 'hot' : 'fwd', carry: 'over' })),
  throw: [{ bob: 1, step: 1, lean: 1, sack: -1, spade: 'rest', eye: 'hot', carry: 'throw' }],
  hurt: [{ bob: 1, step: 0, lean: -1, sack: -1, spade: 'drop', eye: 'shut' }],
};
const ROBBER_FPS: Record<string, FrameOpts> = {
  walk: { fps: 7 }, run: { fps: 12 }, idle: { fps: 1.6 }, plant: { fps: 8 }, wind: { fps: 10 }, fling: { fps: 8, loop: false }, toss: { fps: 9 }, throw: {}, hurt: {},
};
for (const [state, poses] of Object.entries(ROBBER_POSES)) {
  frames('grobber', state, poses.length, RW, RH, (p, i) => paintRobber(p, poses[i]), { ...RO, ...ROBBER_FPS[state] });
}

// a bone chip dug up with the grave dirt: pale lit core, dark rim; spins in flight like
// the bone walker's thrown bones (the dirt itself is only particles)
defineDrawnSprite('grobber_chip', 6, 5, (p) => {
  p.stamp(0, 0, [
    '.ww...',
    'wWWw..',
    '.wWWb.',
    '..bWbs',
    '...ss.',
  ], { W: BONE[3], w: BONE[2], b: BONE[1], s: BONE[0] });
}, { outline: '#24100c' });

// ------------------------------------------------------------------ trap sprites
const TRAP_PAL: Record<string, string> = {
  H: IRON[5], h: IRON[4], m: IRON[3], M: IRON[2], k: IRON[1], d: '#140f18',
  t: '#fffaf0', T: '#d8d4e4', s: IRON[3], S: IRON[1], r: RUST, p: IRON[2], P: IRON[1],
};
/** Jaws laid flat and open (17x8): saw teeth along the far rim and the near rim, a pressure plate in the middle. */
const TRAP_OPEN = [
  '....t.t.t.t.t....',
  '...hHtHtHtHtHm...',
  '..hHdddddddddmm..',
  '.hHdddddddddddMm.',
  'shHddddddPdddddMS',
  'SrmdTdTdTdTdTddMr',
  '.kmmMMMMMMMMMMkk.',
  '...kkkkkkkkkkk...',
];
/** Jaws half raised (opening as it is set). */
const TRAP_HALF = [
  '.................',
  '.....t.t.t.t.....',
  '....HtHtHtHtm....',
  '..hHdddddddddMm..',
  'shHdddddPddddddMS',
  'SrmmTdTdTdTdTdMMr',
  '..kmmMMMMMMMMMk..',
  '....kkkkkkkkk....',
];
/** Jaws snapped upright and shut: an iron arch, teeth meshed along the top seam. */
const TRAP_SHUT = [
  '.................',
  '.................',
  '......t.t.t......',
  '....HtHtHtHtm....',
  '...Hhhmmmmmmmk...',
  'shHhmmmmmmmmmMMkS',
  'SrkMMMMMMMMMMMMkr',
  '...kkkkkkkkkkk...',
];
for (const [name, rows, lit] of [['grobber_trap_shut', TRAP_SHUT, false], ['grobber_trap_half', TRAP_HALF, false], ['grobber_trap_open', TRAP_OPEN, false], ['grobber_trap_armed', TRAP_OPEN, true]] as const) {
  defineDrawnSprite(name, 17, 8, (p) => {
    p.stamp(0, 0, rows, TRAP_PAL);
    if (lit) {
      // the plate glints red: armed
      p.px(9, 4, ARMED);
      p.px(8, 4, '#ff9aa4');
      p.px(9, 3, '#ff6a7a');
    }
  }, { outline: OUT });
}

// ------------------------------------------------------------------ the trap
type TrapState = 'set' | 'armed';

/**
 * An iron jaw trap a robber set. Harmless while it opens (TRAP_ARM), then the first
 * grounded, non-dashing, non-flying keeper within reach springs it: half a heart and a limp. Keeper
 * shots, swings and blasts (it is a hittable neutral actor), bullet-clears, old age and
 * its robber's death all spring it harmlessly. Once sprung it is gone at once; the shut
 * jaws left behind are a purely visual `TrapRemains`.
 */
export class JawTrap extends Actor {
  owner: Enemy;
  state: TrapState = 'set';

  constructor(x: number, y: number, owner: Enemy) {
    super();
    this.x = x;
    this.y = y;
    this.owner = owner;
    // as a hittable it can soak a keeper shot that grazes it: keep that footprint small
    this.r = 5;
    this.team = 'neutral';
    this.maxHp = this.hp = 1;
    this.solid = false;
    this.tileCollide = false;
    this.mass = Infinity;
    this.enemyHazard = true;
    this.layer = 0;
  }

  get armed(): boolean {
    return this.state === 'armed';
  }

  /** Does a keeper at (px, py) with radius `pr` step on it? */
  reaches(px: number, py: number, pr: number): boolean {
    const dx = px - this.x;
    const dy = py - this.y;
    const rr = TRAP_TRIGGER + pr * 0.5;
    return dx * dx + dy * dy < rr * rr;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.flash > 0) this.flash -= dt;
    this.updateSquash(dt);
    if (!this.owner.alive) {
      this.spring(w, false);
      return;
    }
    if (this.age >= TRAP_LIFE) {
      this.spring(w, false);
      return;
    }
    if (this.state === 'set') {
      if (this.age >= TRAP_ARM) {
        this.state = 'armed';
        this.squash(1.2, 0.85);
        w.sfx('clock_ratchet', { vol: 0.22, pitch: 1.6, x: this.x });
      }
      return;
    }
    for (const p of w.targets()) {
      // dashing, airborne or flying keepers pass over the jaws (flight also clears spikes)
      if (!p.alive || p.z > 2 || p.dashing || p.flying || !this.reaches(p.x, p.y, p.r)) continue;
      this.bite(w, p);
      return;
    }
  }

  /** Snap on a keeper: half a heart (base strength) and a limp. */
  private bite(w: World, p: Player): void {
    this.dead = true;
    if (p.hurt(w, 1, ROBBER_NAME, false, this)) {
      p.applyStatus({ kind: 'slow', duration: TRAP_SLOW_T, power: TRAP_SLOW }, () => 0);
      w.spawn(new TrapRemains(this.x, this.y, p, TRAP_SLOW_T));
    } else {
      w.spawn(new TrapRemains(this.x, this.y, null, 0));
    }
    w.sfx('clock_snap', { vol: 0.7, pitch: 0.75, x: this.x });
    w.sfx('hit_metal', { vol: 0.4, pitch: 0.9, x: this.x });
    w.particles.burst(this.x, this.y - 3, { count: 8, speed: [40, 110], life: [0.1, 0.25], colors: ['#ffffff', '#ffe0a0', IRON[4]], size: [1, 1], shape: 'spark' });
  }

  /** Snap shut on nothing (struck, shot, cleared, aged out, its robber died). */
  spring(w: World, loud = true): void {
    if (this.dead) return;
    this.dead = true;
    w.spawn(new TrapRemains(this.x, this.y, null, 0));
    w.sfx('clock_snap', { vol: loud ? 0.45 : 0.25, pitch: loud ? 1.1 : 1.3, x: this.x });
    w.particles.burst(this.x, this.y - 3, { count: loud ? 6 : 3, speed: [30, 80], life: [0.1, 0.22], colors: ['#ffffff', IRON[4], IRON[3]], size: [1, 1], shape: 'spark' });
  }

  override takeHit(w: World, hit: HitInfo): boolean {
    if (this.dead) return false;
    if (hit.attacker && hit.attacker.team !== 'player') return false;
    this.spring(w);
    return true;
  }

  override onCleared(w: World): void {
    this.spring(w, false);
  }

  override draw(r: Renderer, w: World): void {
    const name = this.state === 'set'
      ? (this.age < TRAP_ARM * 0.35 ? 'grobber_trap_shut' : this.age < TRAP_ARM * 0.7 ? 'grobber_trap_half' : 'grobber_trap_open')
      : Math.floor((w.time + this.id * 0.37) * 2.2) % 3 === 0 ? 'grobber_trap_armed' : 'grobber_trap_open';
    // fading out in its last second
    const left = TRAP_LIFE - this.age;
    const alpha = left < 1 ? (Math.floor(this.age * 12) % 2 ? 0.5 : 0.9) : 1;
    r.sprite(name, this.x, this.y, { flash: this.flash > 0 ? 1 : 0, sx: this.squashX, sy: this.squashY, alpha });
  }

  override light(w: World): void {
    if (this.armed) w.lights.add(this.x, this.y - 1, 12, '#d8dcff', { intensity: 0.28 });
  }
}

/**
 * The shut jaws a sprung trap leaves (cosmetic). When it bit a keeper it clings to
 * their foot for the limp, then drops off; either way it rusts away.
 */
class TrapRemains extends Entity {
  static override readonly cosmetic = true;
  private follow: { x: number; y: number; alive: boolean } | null;
  private cling: number;

  constructor(x: number, y: number, follow: { x: number; y: number; alive: boolean } | null, cling: number) {
    super();
    this.x = x;
    this.y = y;
    this.follow = follow;
    this.cling = cling;
    this.layer = follow ? 1 : 0;
    this.tileCollide = false;
  }

  override get sortY(): number {
    return this.y + 1;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.follow && this.age < this.cling && this.follow.alive) {
      this.x = this.follow.x + 3;
      this.y = this.follow.y + 4;
    } else if (this.follow) {
      // drops off the foot
      this.follow = null;
      this.layer = 0;
      dust(w, this.x, this.y, [IRON[2], RUST, DIRT[2]], 4, 30);
    }
    if (this.age >= this.cling + 0.6) {
      this.dead = true;
      w.particles.burst(this.x, this.y - 2, { count: 5, speed: [15, 45], life: [0.3, 0.6], colors: [RUST, IRON[2], IRON[1]], size: [1, 2], gravity: 240, vz: [20, 50], shape: 'square' });
    }
  }

  override draw(r: Renderer): void {
    const k = this.age - this.cling;
    const alpha = k > 0.3 ? Math.max(0, 1 - (k - 0.3) / 0.3) : 1;
    r.sprite('grobber_trap_shut', this.x, this.y, { alpha, sy: this.age < 0.08 ? 1.3 : 1 });
  }
}

// ------------------------------------------------------------------ AI
/** Living traps set by `owner`. */
export function liveTraps(w: World, owner: Enemy): JawTrap[] {
  const out: JawTrap[] = [];
  for (const e of w.entities) if (e instanceof JawTrap && !e.dead && e.owner === owner) out.push(e);
  return out;
}

/**
 * Is a trap within `d` px of (x, y): a live one (any robber's) or one still in the air
 * (every robber notes where its thrown trap will land)? New traps keep clear of both, so
 * two robbers never stack theirs on one spot.
 */
function trapNear(w: World, x: number, y: number, d: number): boolean {
  for (const e of w.entities) if (e instanceof JawTrap && !e.dead && Math.hypot(e.x - x, e.y - y) < d) return true;
  for (const e of w.enemies) {
    if (e.alive && e.def.id === ROBBER_ID && e.mem.tossEnd > w.time && Math.hypot(e.mem.tossX - x, e.mem.tossY - y) < d) return true;
  }
  return false;
}

/** Live traps a robber may keep (champion: one more). */
function trapCap(e: Enemy): number {
  return e.champion ? TRAP_MAX + 1 : TRAP_MAX;
}

/**
 * Direction to back off in: away from the keeper, bent toward open floor (rays sampled up
 * to about ±100°), so it slips along walls instead of pinning itself into a corner.
 * Re-picked every 0.2 s or on a bump.
 */
function escapeAngle(e: Enemy, w: World): number {
  e.mem.escT -= w.dt;
  if (e.mem.escT > 0 && !e.mem.__bumped) return e.mem.escA;
  const away = e.angleToTarget(w) + Math.PI;
  const side = e.mem.side || 1;
  let best = away;
  let bestS = -Infinity;
  for (const k of [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.75, -1.75]) {
    const a = away + k * side;
    const s = rayFree(w.room, e.x, e.y, a, e.r, 64, false, 4) - Math.abs(k) * 12;
    if (s > bestS + 0.5) {
      bestS = s;
      best = a;
    }
  }
  e.mem.escA = best;
  e.mem.escT = 0.2;
  return best;
}

/** Can the robber see its keeper? Re-checked a few times a second (kept in `e.mem.los`). */
function robberSees(e: Enemy, w: World): boolean {
  if (e.age >= e.mem.losAt) {
    const tg = e.target(w);
    e.mem.los = w.room.lineOfSight(e.x, e.y, tg.x, tg.y) ? 1 : 0;
    e.mem.losAt = e.age + 0.2;
  }
  return e.mem.los === 1;
}

/**
 * Robber footwork: keep 72–130 px, slip away from a keeper who closes in, lurk or sidle in
 * between. With cover between them it works its way round (flow field) instead of lurking
 * behind it forever: it needs a clear line to throw.
 */
function robberSpacing(e: Enemy, w: World): number {
  const d = e.distToTarget(w);
  const a = e.angleToTarget(w);
  e.mem.lurkT -= w.dt;
  if (d < 72) {
    e.setAnim('grobber_run');
    e.moveAngle(escapeAngle(e, w), e.speed);
  } else if (d > 130 || !robberSees(e, w)) {
    e.setAnim('grobber_walk');
    e.chase(w, e.speed * 0.85);
  } else {
    if (e.mem.lurkT <= 0) {
      e.mem.lurk = e.mem.lurk ? 0 : 1;
      e.mem.lurkT = e.mem.lurk ? w.rng.range(0.5, 0.9) : w.rng.range(0.8, 1.4);
      if (!e.mem.lurk && w.rng.chance(0.35)) e.mem.side = -e.mem.side;
    }
    if (e.mem.lurk) {
      e.setAnim('grobber_idle');
      e.stop();
      e.facing = Math.cos(a) >= 0 ? 1 : -1;
    } else {
      // sidle round the keeper (turning back before a wall), easing toward ~100 px
      e.setAnim('grobber_walk');
      let sa = a + (e.mem.side * Math.PI) / 2;
      if (e.mem.__bumped || rayFree(w.room, e.x, e.y, sa, e.r, 20, false, 4) < 16) {
        e.mem.side = -e.mem.side;
        sa = a + (e.mem.side * Math.PI) / 2;
      }
      const rk = Math.max(-0.5, Math.min(0.5, (d - 100) / 60));
      e.moveDir(Math.cos(sa) + Math.cos(a) * rk, Math.sin(sa) + Math.sin(a) * rk, e.speed * 0.55);
    }
  }
  return d;
}

/** Where a new trap goes: just in front of the robber, toward the keeper, on free floor. */
function trapSpot(e: Enemy, w: World): { x: number; y: number } {
  const a = e.angleToTarget(w);
  return landingSpot(w, e.x + Math.cos(a) * 9, e.y + 2 + Math.sin(a) * 6, 6);
}

function* plant(e: Enemy, w: World): Script {
  e.halt();
  const tg = e.target(w);
  e.facing = tg.x >= e.x ? 1 : -1;
  e.setAnim('grobber_plant');
  e.telegraph(PLANT_TIME);
  w.sfx('clock_ratchet', { vol: 0.3, pitch: 0.9 });
  for (let el = 0; el < PLANT_TIME; el += w.dt) {
    if (Math.floor(el * 8) !== Math.floor((el - w.dt) * 8) && el > w.dt) {
      dust(w, e.x + e.facing * 7, e.y + 4, [DIRT[3], DIRT[2], '#5a4a3a'], 2, 30);
    }
    yield;
  }
  const s = trapSpot(e, w);
  if (!trapNear(w, s.x, s.y, 14)) {
    w.spawn(new JawTrap(s.x, s.y, e));
    w.sfx('hit_metal', { vol: 0.25, pitch: 1.5 });
    dust(w, s.x, s.y + 2, [DIRT[3], DIRT[2]], 5, 40);
  }
  yield 0.12;
}

/** Where a thrown trap lands: a step ahead of the keeper, on free floor clear of every other trap (two robbers never stack theirs). */
function tossSpot(e: Enemy, w: World): { x: number; y: number } | null {
  const tg = e.target(w) as { x: number; y: number; vx?: number; vy?: number };
  let lx = (tg.vx ?? 0) * 0.3;
  let ly = (tg.vy ?? 0) * 0.3;
  const l = Math.hypot(lx, ly);
  if (l > 24) {
    lx *= 24 / l;
    ly *= 24 / l;
  }
  const a = Math.atan2(tg.y - e.y, tg.x - e.x);
  for (const k of [0, 1, -1]) {
    const s = landingSpot(w, tg.x + lx - Math.sin(a) * 18 * k, tg.y + ly + Math.cos(a) * 18 * k, 6);
    if (!trapNear(w, s.x, s.y, 16)) return s;
  }
  return null;
}

function* toss(e: Enemy, w: World): Script {
  e.halt();
  const tg = e.target(w);
  e.facing = tg.x >= e.x ? 1 : -1;
  e.setAnim('grobber_toss');
  e.telegraph(TOSS_WIND);
  w.sfx('clock_ratchet', { vol: 0.25, pitch: 1.25 });
  yield TOSS_WIND;
  const s = tossSpot(e, w);
  e.setAnim('grobber_throw');
  e.squash(0.85, 1.15);
  if (s) {
    const owner = e;
    // where it will land, until it has (other robbers keep their traps clear of it)
    e.mem.tossX = s.x;
    e.mem.tossY = s.y;
    e.mem.tossEnd = w.time + TOSS_FLIGHT + 0.05;
    // a shut trap tumbles through the air over a landing ring, lands, then opens
    lob(w, e.x + e.facing * 3, e.y - 18, s.x, s.y, {
      sprite: 'grobber_trap_shut', color: IRON[4], time: TOSS_FLIGHT, height: 34, warn: 9, damage: 0, spin: 5, light: 0, source: ROBBER_NAME,
      onLand: (ww, x, y) => {
        if (!owner.alive) return;
        ww.spawn(new JawTrap(x, y, owner));
        ww.sfx('hit_metal', { vol: 0.3, pitch: 1.3, x });
      },
    });
  }
  yield 0.35;
}

function* fling(e: Enemy, w: World): Script {
  e.halt();
  let tg = e.target(w);
  e.facing = tg.x >= e.x ? 1 : -1;
  e.setAnim('grobber_wind');
  e.telegraph(FLING_WIND);
  w.sfx('whoosh', { vol: 0.25, pitch: 0.7 });
  dust(w, e.x + e.facing * 5, e.y + 3, [DIRT[3], DIRT[2]], 4, 35);
  yield FLING_WIND;
  tg = e.target(w);
  e.facing = tg.x >= e.x ? 1 : -1;
  e.setAnim('grobber_fling', true);
  e.squash(0.85, 1.15);
  const ox = e.x + e.facing * 6;
  const oy = e.y - 1;
  const a = Math.atan2(tg.y - oy, tg.x - ox);
  const n = e.champion ? FLING_COUNT + 2 : FLING_COUNT;
  for (let i = 0; i < n; i++) {
    const ang = a + (i - (n - 1) / 2) * FLING_GAP + w.rng.range(-0.04, 0.04);
    const pr = e.shoot(w, ang, {
      x: ox, y: oy, z: 6, speed: FLING_SPEED * w.rng.range(0.92, 1.08), accel: -150, minSpeed: 95,
      range: FLING_RANGE, radius: 2.5, damage: 1, color: BONE[2], style: 'none', light: 0,
    });
    pr.mem.spinDir = i % 2 ? 1 : -1;
    pr.addBehavior(spinDraw('grobber_chip', 12));
  }
  w.sfx('whoosh', { vol: 0.45, pitch: 1.1 });
  w.sfx('rock_break', { vol: 0.25, pitch: 1.6 });
  w.particles.burst(e.x + e.facing * 8, e.y - 4, { count: 10, speed: [40, 110], angle: a, spread: 0.7, life: [0.2, 0.45], colors: [DIRT[3], DIRT[2], BONE[2]], size: [1, 2], gravity: 260, vz: [20, 60] });
  yield 0.4;
}

/** Scurry off toward open floor, a little faster than its walk. */
function* scurry(e: Enemy, w: World, time: number): Script {
  e.setAnim('grobber_run');
  for (let el = 0; el < time; el += w.dt) {
    e.moveAngle(escapeAngle(e, w), e.speed * 1.25);
    yield;
  }
}

type RobberAct = 'fling' | 'plant' | 'toss' | null;

defineEnemy({
  id: ROBBER_ID,
  name: ROBBER_NAME,
  hp: 28,
  radius: 5,
  speed: 40,
  sprite: 'grobber_walk',
  spriteYOffset: 5,
  shadow: 13,
  cost: 1.3,
  floors: [1],
  weight: 0.9,
  champion: true,
  deathFx: 'blood',
  bloodColor: '#4a3a2e',
  light: { radius: 14, color: '#ffd040' },
  init(e, w) {
    e.mem.side = w.rng.sign();
    e.mem.lurk = 0;
    e.mem.lurkT = 0;
    e.mem.escA = 0;
    e.mem.escT = 0;
    e.mem.los = 1;
    e.mem.losAt = 0;
    e.mem.tossEnd = 0;
  },
  *script(e, w) {
    yield w.rng.range(0.3, 0.8);
    let trapCd = w.rng.range(0.4, 1.0);
    let flingCd = 0.6;
    while (true) {
      let act: RobberAct = null;
      const t = w.rng.range(0.9, 1.5);
      for (let el = 0; el < 3.5; el += w.dt) {
        const d = robberSpacing(e, w);
        trapCd -= w.dt;
        flingCd -= w.dt;
        // charmed, it only skulks: its jaws and chips would still bite the keeper
        const charmed = e.hasStatus('charm');
        if (d < FLING_NEAR && flingCd <= 0 && !charmed && robberSees(e, w)) {
          act = 'fling';
          break;
        }
        if (el >= t && trapCd <= 0 && !charmed && liveTraps(w, e).length < trapCap(e)) {
          const tg = e.target(w);
          if (d >= 24 && d < TOSS_MIN) {
            act = 'plant';
            break;
          }
          if (d >= TOSS_MIN && d <= TOSS_MAX && w.room.lineOfSight(e.x, e.y, tg.x, tg.y)) {
            act = 'toss';
            break;
          }
        }
        yield;
      }
      if (act === 'fling') {
        yield* fling(e, w);
        flingCd = 2.4;
        yield* scurry(e, w, 0.6);
      } else if (act === 'plant') {
        yield* plant(e, w);
        trapCd = w.rng.range(1.6, 2.4);
        yield* scurry(e, w, 0.7);
      } else if (act === 'toss') {
        yield* toss(e, w);
        trapCd = w.rng.range(1.8, 2.6);
      }
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'grobber_hurt_0'));
  },
  onDeath(e, w) {
    for (const t of liveTraps(w, e)) t.spring(w, false);
    // the sack bursts: burlap scraps and a glint of stolen gold (cosmetic)
    w.particles.burst(e.x - e.facing * 4, e.y - 8, {
      count: 10, speed: [30, 90], life: [0.3, 0.7], colors: [SACK[3], SACK[2], SACK[1]], size: [1, 2], gravity: 300, vz: [40, 110], shape: 'square', vrot: 8,
    });
    w.particles.burst(e.x - e.facing * 4, e.y - 10, { count: 5, speed: [20, 70], life: [0.4, 0.8], colors: [GOLD[4], GOLD[3], GOLD[2]], size: [1, 1], gravity: 260, vz: [50, 110], shape: 'spark' });
    w.sfx('hit_metal', { vol: 0.25, pitch: 1.7 });
  },
});
