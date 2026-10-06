import { clockChime } from './laser-patterns';
import { pickBossPattern } from './tactics';
// Floor 7 boss: 시계장인 (the Clockmaker) — 시간을 되감는 태엽 장인.
// A gaunt porcelain-faced automaton craftsman grown into the spire's great clock: his
// thin body rises out of the dial, a loupe over one eye, a crown of cogs, a winding key
// in one hand and a needle-thin clock hand in the other. The clock still ticks — and
// everything he throws obeys the tick.
// Phase 1: 멈춘 탄환 (fans of verdigris shots that freeze mid-air and all rush at the
//   keeper on the next tick), 되감기 (amber fans that fly back along their own paths,
//   announced by afterimages), 시침 베기 (a dial overlay, then the giant hand sweeps the
//   arena as a blade), 굼뜬 시간 (slow-time pools), 톱니 굴리기 (bouncing cogs), 태엽 병정
//   (wind-up tin soldiers). Between attacks he skips through time to another spot.
// Phase 2 (≤50%): the dial glass shatters, the tick speeds up and the hands double —
//   two blades, longer frozen volleys, and 시간 정지: rings freeze into a cage around him
//   and every shot resumes at once, re-aimed, on the great tock.

import { defineBoss, defineEnemy } from '../../game/defs';
import { Entity } from '../../game/entity';
import { PixelPainter, bayer } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { clamp, TAU } from '../../engine/math';
import { Afterimage, GroundWarning, RingFx } from '../../game/effects';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { Script } from '../../engine/script';
import { frames, gather, spinDraw, spotAround } from '../enemies/shared';
import {
  ball, bossDeathBurst, clearEnemyShots, crack, dissolveMinions, gapRing, hash2, inRoom, limb, lum, minionCount,
  phaseDone, phaseGate, phaseShift, pickPattern, ShockRing,
} from './final-kit';
import {
  AMBER, BRASS7, brassSparks, bullet7, ClockHand, drawDial, gearSprite, nextTick, OUTLINE7, paintGear, PLUM, PORC, porcelainShards, rewind,
  summonMinion7, tickFreeze, TimeWell, VERD,
} from './kit7';

// ------------------------------------------------------------------ geometry
const W = 64;
const H = 78;
const CX = 32;
/** dial centre in sprite coords */
const DX = 32;
const DY = 32;
const DIAL_R = 21;
/** pivot = where the pedestal meets the floor (entity position) */
const ORIGIN: [number, number] = [32, 66];
/** dial centre above the pivot */
export const CK_DIAL_DY = DY - ORIGIN[1];
const HEAD_Y = 14;
const DEEP = '#07040c';

type V = [number, number];
interface CkPose {
  /** pendulum swing -1..1 */
  pend: number;
  /** cog tooth phase 0..1 */
  gear: number;
  /** torso bob */
  bob: number;
  head?: V;
  /** needle hand / key hand (sprite coords) */
  lh: V;
  rh: V;
  keyAng?: number;
  needleAng?: number;
  eyes?: 'dim' | 'glow';
  /** forward lean of the torso */
  lean?: number;
}

// ------------------------------------------------------------------ painting
function paintPedestal(p: PixelPainter, o: CkPose, p2: boolean): void {
  // brass case flaring to the floor, rivets, a slot with the pendulum, cogs at both sides
  p.poly([16, 50, 48, 50, 56, 68, 8, 68], BRASS7[2]);
  for (let y = 50; y <= 68; y++) {
    for (let x = 6; x < 58; x++) {
      if (!p.isSet(x, y)) continue;
      const nx = (x + 0.5 - CX) / 24;
      let idx = lum(nx * 0.9, (y - 59) / 18, BRASS7.length, x, y, true, -0.15);
      if (y === 50 || y === 68) idx = Math.max(0, idx - 2);
      let col = BRASS7[idx];
      // verdigris creeping up from the floor
      if (hash2(Math.floor(x / 2), Math.floor(y / 2), 5) < 0.12 + (y - 50) / 60) col = VERD[idx > 2 ? 2 : 1];
      p.px(x, y, col);
    }
  }
  for (let x = 10; x < 56; x += 5) {
    p.px(x, 52, BRASS7[5]);
    p.px(x + 2, 66, BRASS7[4]);
  }
  // the pendulum slot
  p.rect(27, 53, 11, 13, DEEP);
  p.rect(27, 53, 11, 1, PLUM[1]);
  const bx = 32 + o.pend * 3.5;
  p.line(32, 53, bx, 62, BRASS7[3]);
  p.circle(bx, 63, 2, BRASS7[3]);
  p.px(bx - 1, 62, BRASS7[5]);
  // side cogs turning in opposite directions
  paintGear(p, 9, 46, 5, 8, o.gear, BRASS7, p2 ? AMBER[3] : undefined);
  paintGear(p, 55, 46, 5, 8, -o.gear + 0.06, BRASS7, p2 ? AMBER[3] : undefined);
  paintGear(p, 16, 56, 3, 6, -o.gear * 1.5, VERD.slice(1), undefined);
  paintGear(p, 48, 56, 3, 6, o.gear * 1.5, VERD.slice(1), undefined);
  // feet
  p.rect(6, 66, 8, 3, BRASS7[1]);
  p.rect(50, 66, 8, 3, BRASS7[1]);
  p.line(6, 66, 13, 66, BRASS7[3]);
  p.line(50, 66, 57, 66, BRASS7[3]);
}

function paintDial(p: PixelPainter, p2: boolean): void {
  // housing + brass rim (lit top-left), cream dial face, hour ticks, quarter marks
  for (let y = DY - DIAL_R - 4; y <= DY + DIAL_R + 4; y++) {
    for (let x = DX - DIAL_R - 4; x <= DX + DIAL_R + 4; x++) {
      const dx = x + 0.5 - DX;
      const dy = y + 0.5 - DY;
      const d = Math.hypot(dx, dy);
      if (d > DIAL_R + 3.5) continue;
      if (d > DIAL_R) {
        const idx = lum(dx / (DIAL_R + 3), dy / (DIAL_R + 3), BRASS7.length, x, y, true, 0.05);
        let col = BRASS7[idx];
        if (hash2(x, y, 9) < 0.08) col = VERD[2];
        p.px(x, y, col);
      } else if (d > DIAL_R - 1.2) p.px(x, y, PLUM[1]);
      else {
        const k = 0.75 - (dx + dy) / (DIAL_R * 4);
        p.px(x, y, PORC[clamp(Math.floor(k * 5 + bayer(x, y) - 0.5), 2, 5)]);
      }
    }
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const len = i % 3 === 0 ? 3.5 : 2;
    p.line(DX + Math.cos(a) * (DIAL_R - 2 - len), DY + Math.sin(a) * (DIAL_R - 2 - len), DX + Math.cos(a) * (DIAL_R - 2), DY + Math.sin(a) * (DIAL_R - 2), i % 3 === 0 ? BRASS7[1] : PLUM[1]);
    if (i % 3 === 0) p.px(DX + Math.cos(a) * (DIAL_R - 3), DY + Math.sin(a) * (DIAL_R - 3), BRASS7[3]);
  }
  // fine minute marks between the hours
  for (let i = 0; i < 60; i++) {
    if (i % 5 === 0) continue;
    const a = (i / 60) * TAU;
    p.px(DX + Math.cos(a) * (DIAL_R - 2), DY + Math.sin(a) * (DIAL_R - 2), PORC[1]);
  }
  // the maker's mark below the hub
  p.rect(DX - 3, DY + 8, 7, 1, PLUM[2]);
  p.px(DX, DY + 10, VERD[3]);
  if (p2) {
    // the glass is gone: cracks across the face, two shards missing with the works showing through
    crack(p, DX - 15, DY - 12, DX + 9, DY + 16, PLUM[0], 3, 1.5);
    crack(p, DX + 14, DY - 14, DX - 6, DY + 12, PLUM[0], 7, 1.2);
    crack(p, DX - 4, DY - 19, DX + 2, DY + 4, PLUM[0], 11, 1.0);
    p.poly([DX + 4, DY + 2, DX + 19, DY - 4, DX + 18, DY + 11, DX + 6, DY + 14], PLUM[0]);
    p.poly([DX - 19, DY - 2, DX - 8, DY - 8, DX - 5, DY + 2, DX - 16, DY + 9], PLUM[0]);
    paintGear(p, DX + 12, DY + 5, 4.5, 8, 0.2, BRASS7, AMBER[2]);
    paintGear(p, DX - 12, DY + 1, 3.5, 6, 0.5, BRASS7, AMBER[2]);
    for (const [gx, gy] of [[DX - 10, DY - 6], [DX + 3, DY + 9], [DX + 9, DY - 10]] as const) {
      p.px(gx, gy, AMBER[3]);
      p.px(gx + 1, gy, AMBER[4]);
    }
    // a bent rim
    p.line(DX + 16, DY - 17, DX + 21, DY - 21, BRASS7[3]);
    p.px(DX + 21, DY - 22, BRASS7[5]);
  }
  // hub
  p.circle(DX, DY, 2.2, BRASS7[2]);
  p.px(DX - 1, DY - 1, BRASS7[5]);
}

function paintTorso(p: PixelPainter, o: CkPose, p2: boolean): void {
  const lean = o.lean ?? 0;
  const by = o.bob + lean;
  // a thin plum coat rising from the dial's centre; brass fusion bands where flesh became clockwork
  p.poly([25, 21 + by, 39, 21 + by, 37, 36 + by * 0.5, 36, 42, 28, 42, 27, 36 + by * 0.5], PLUM[2]);
  for (let y = 20; y < 43; y++) {
    for (let x = 24; x < 40; x++) {
      if (!p.isSet(x, y)) continue;
      const nx = (x + 0.5 - CX) / 7;
      p.px(x, y, PLUM[lum(nx, (y - 30) / 14, PLUM.length, x, y, true, -0.1)]);
    }
  }
  // collar
  p.poly([24, 19 + by, 40, 19 + by, 38, 23 + by, 26, 23 + by], PLUM[3]);
  p.line(25, 19 + by, 39, 19 + by, PLUM[4]);
  // buttons + the lapel seam
  for (let y = 25; y <= 37; y += 3) p.px(CX, y + by * 0.5, y % 2 ? BRASS7[4] : BRASS7[3]);
  p.line(CX - 3, 23 + by, CX - 2, 40, PLUM[1]);
  // fusion bands: brass rings around the waist, pipes and a verdigris tube into the dial
  p.rect(26, 39, 12, 3, BRASS7[2]);
  p.line(26, 39, 37, 39, BRASS7[4]);
  for (let x = 27; x < 38; x += 3) p.px(x, 40, BRASS7[5]);
  p.line(26, 36, 23, 44, VERD[3]);
  p.line(38, 36, 41, 44, VERD[3]);
  p.px(23, 44, VERD[5]);
  p.px(41, 44, VERD[5]);
  if (p2) {
    crack(p, 29, 24 + by, 34, 38, AMBER[2], 5, 0.8);
    p.px(31, 30, AMBER[4]);
    p.px(33, 35, AMBER[3]);
  }
}

function paintHead(p: PixelPainter, o: CkPose, p2: boolean): void {
  const hx = CX + (o.head?.[0] ?? 0);
  const hy = HEAD_Y + (o.head?.[1] ?? 0) + o.bob + (o.lean ?? 0);
  // neck of brass vertebrae
  p.line(hx, hy + 5, CX, 21 + o.bob + (o.lean ?? 0), BRASS7[2]);
  p.px(hx, hy + 6, BRASS7[4]);
  // a crown of cogs behind the skull and a thin brass antenna with a verdigris jewel
  paintGear(p, hx - 5, hy - 6, 2.8, 6, o.gear, BRASS7, BRASS7[1]);
  paintGear(p, hx + 5, hy - 6, 2.4, 6, -o.gear, BRASS7, BRASS7[1]);
  paintGear(p, hx, hy - 8.5, 3.2, 7, o.gear * 0.7, BRASS7, p2 ? AMBER[3] : BRASS7[1]);
  p.line(hx, hy - 11, hx, hy - 13, BRASS7[3]);
  p.px(hx, hy - 13, VERD[5]);
  // gaunt porcelain face: a long skull, hollow cheeks
  ball(p, hx, hy, 5.2, 6.6, PORC, false);
  for (let y = hy + 1; y <= hy + 3; y++) {
    p.pxIn(hx - 4, y, PORC[1]);
    p.pxIn(hx + 4, y, PORC[1]);
  }
  p.pxIn(hx - 3, hy + 2, PORC[1]);
  p.pxIn(hx + 3, hy + 2, PORC[1]);
  // sunken left eye: a deep socket with an amber ember; the right behind a brass loupe with verdigris glass
  const glow = o.eyes === 'glow' || p2;
  p.rect(hx - 4, hy - 2, 3, 3, DEEP);
  p.px(hx - 3, hy - 1, glow ? AMBER[4] : AMBER[2]);
  if (glow) p.px(hx - 2, hy - 1, AMBER[3]);
  p.ring(hx + 3, hy - 1, 3.4, 1.3, BRASS7[3]);
  p.px(hx + 1, hy - 3, BRASS7[5]);
  p.px(hx + 2, hy - 4, BRASS7[5]);
  p.circle(hx + 3, hy - 1, 2.1, VERD[4]);
  p.px(hx + 3, hy - 1, glow ? AMBER[4] : VERD[2]);
  p.px(hx + 2, hy - 2, VERD[5]);
  p.px(hx + 3, hy - 3, PORC[5]);
  p.px(hx + 4, hy, VERD[1]);
  p.line(hx + 6, hy, hx + 7, hy + 3, BRASS7[2]);
  // hinged jaw with brass pins at the corners
  p.line(hx - 2, hy + 4, hx + 2, hy + 4, PLUM[1]);
  p.px(hx - 3, hy + 4, BRASS7[3]);
  p.px(hx + 3, hy + 4, BRASS7[3]);
  // hairline cracks (a great one in phase 2)
  p.line(hx - 1, hy - 6, hx - 2, hy - 4, PORC[1]);
  if (p2) {
    crack(p, hx + 1, hy - 6, hx - 2, hy + 3, PLUM[0], 4, 0.7);
    p.px(hx - 1, hy, AMBER[3]);
    p.px(hx, hy - 3, AMBER[4]);
  }
}

function paintArm(p: PixelPainter, sh: V, hand: V, down = 1): void {
  // two thin brass-jointed segments, the elbow dropped below the straight line
  const mx = (sh[0] + hand[0]) / 2 + (hand[0] < sh[0] ? -2 : 2);
  const my = (sh[1] + hand[1]) / 2 + 5 * down;
  limb(p, sh[0], sh[1], 2.6, mx, my, 2.2, [PLUM[0], PLUM[1], PLUM[2]]);
  limb(p, mx, my, 2.2, hand[0], hand[1], 1.7, [PLUM[0], PLUM[1], PLUM[2]]);
  p.circle(mx, my, 1.6, BRASS7[3]);
  p.px(mx - 1, my - 1, BRASS7[5]);
  p.circle(sh[0], sh[1], 1.8, BRASS7[2]);
  // the hand: a porcelain palm with three long brass fingers spread toward the tool
  p.circle(hand[0], hand[1], 1.8, PORC[3]);
  const a = Math.atan2(hand[1] - my, hand[0] - mx);
  for (let k = -1; k <= 1; k++) {
    const fa = a + k * 0.45;
    p.line(hand[0], hand[1], hand[0] + Math.cos(fa) * 4, hand[1] + Math.sin(fa) * 4, BRASS7[3]);
    p.px(hand[0] + Math.cos(fa) * 4, hand[1] + Math.sin(fa) * 4, BRASS7[5]);
  }
}

function paintKey(p: PixelPainter, x: number, y: number, ang: number): void {
  // a winding key: shaft, bit, and a looped bow
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  p.line(x, y, x + dx * 9, y + dy * 9, BRASS7[3]);
  p.line(x + dx * 2 - dy, y + dy * 2 + dx, x + dx * 2 + dy, y + dy * 2 - dx, BRASS7[4]);
  p.ring(x + dx * 11, y + dy * 11, 3, 1.3, BRASS7[3]);
  p.px(x + dx * 11 - 2, y + dy * 11 - 2, BRASS7[5]);
}

function paintNeedle(p: PixelPainter, x: number, y: number, ang: number, lit: boolean): void {
  // a clock hand the length of a rapier, diamond near the tip
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  p.line(x - dx * 4, y - dy * 4, x + dx * 17, y + dy * 17, BRASS7[2]);
  p.line(x, y, x + dx * 16, y + dy * 16, BRASS7[4]);
  p.circle(x + dx * 12, y + dy * 12, 1.6, BRASS7[4]);
  p.px(x + dx * 12, y + dy * 12, lit ? AMBER[4] : BRASS7[5]);
  p.px(x + dx * 17, y + dy * 17, lit ? AMBER[4] : PORC[5]);
}

function paintClockmaker(p: PixelPainter, o: CkPose, p2: boolean): void {
  paintPedestal(p, o, p2);
  paintDial(p, p2);
  // Exposed escapement on the lower dial, behind the coat.
  for (const s of [-1, 1]) {
    const x = DX + s * 14;
    p.circle(x, DY + 12, 6, '#342136');
    paintGear(p, x, DY + 12, 5, 8, o.gear * s, BRASS7, p2 ? AMBER[3] : '#446a68');
    p.line(x, DY + 17, DX + s * 9, DY + 23, BRASS7[2]);
  }
  paintTorso(p, o, p2);
  const by = o.bob + (o.lean ?? 0);
  paintArm(p, [25, 23 + by], o.lh);
  paintArm(p, [39, 23 + by], o.rh);
  paintHead(p, o, p2);
  paintNeedle(p, o.lh[0], o.lh[1], o.needleAng ?? -1.9, o.eyes === 'glow' || p2);
  paintKey(p, o.rh[0], o.rh[1], o.keyAng ?? -0.5);
  if (p2) {
    // the broken works throw sparks and amber light onto the case
    for (const [sx, sy] of [[DX - 20, DY + 14], [DX + 21, DY + 10], [DX + 6, DY + 22]] as const) {
      p.px(sx, sy, AMBER[3]);
      p.px(sx + 1, sy - 1, AMBER[4]);
    }
    for (let y = 50; y < 60; y++) for (let x = 20; x < 44; x++) if (p.isSet(x, y) && hash2(x, y, 2) < 0.12) p.pxIn(x, y, AMBER[1]);
  }
}

// ------------------------------------------------------------------ frames
const POSES: Record<string, CkPose[]> = {
  idle: [0, 1, 2, 3].map((i) => ({
    pend: [-1, 0, 1, 0][i], gear: i / 4, bob: [0, -1, 0, 0][i], lh: [16, 36 + [0, -1, 0, 0][i]] as V, rh: [48, 36 + [0, 0, -1, 0][i]] as V,
    needleAng: -1.9 + [0, 0.05, 0, -0.05][i], keyAng: -0.5 + i * 0.3, eyes: 'dim' as const,
  })),
  wind: [
    { pend: -1, gear: 0.1, bob: -1, head: [1, -1], lh: [16, 34], rh: [50, 15], keyAng: -1.2, needleAng: -1.9, eyes: 'glow' },
    { pend: 1, gear: 0.6, bob: -1, head: [1, -1], lh: [16, 34], rh: [51, 14], keyAng: 0.4, needleAng: -1.8, eyes: 'glow' },
  ],
  cast: [
    { pend: 0, gear: 0.2, bob: -2, head: [0, -1], lh: [5, 26], rh: [59, 26], needleAng: Math.PI + 0.1, keyAng: -0.1, eyes: 'glow' },
    { pend: 0, gear: 0.7, bob: -2, head: [0, -2], lh: [4, 24], rh: [60, 24], needleAng: Math.PI - 0.1, keyAng: 0.1, eyes: 'glow' },
  ],
  lean: [
    { pend: 1, gear: 0.3, bob: 1, lean: 2, head: [0, 2], lh: [20, 46], rh: [44, 46], needleAng: 1.0, keyAng: 2.2, eyes: 'glow' },
    { pend: -1, gear: 0.8, bob: 1, lean: 3, head: [0, 3], lh: [19, 47], rh: [45, 47], needleAng: 1.1, keyAng: 2.0, eyes: 'glow' },
  ],
  hurt: [{ pend: 1, gear: 0.5, bob: -2, head: [-2, 0], lh: [12, 28], rh: [52, 28], needleAng: -2.6, keyAng: -1.6, eyes: 'glow' }],
};
const FPS: Record<string, number> = { idle: 4, wind: 9, cast: 7, lean: 8, hurt: 1 };

for (const [state, poses] of Object.entries(POSES)) {
  for (const [pre, p2] of [['ck', false], ['ck2', true]] as const) {
    frames(pre, state, poses.length, W, H, (p, i) => paintClockmaker(p, poses[i], p2), { origin: ORIGIN, fps: FPS[state] ?? 7, outline: OUTLINE7 });
  }
}

// the dial hands (pivot at the base, pointing right at rot 0)
defineDrawnSprite('ck_hand_long', 20, 5, (p) => {
  p.line(0, 2, 17, 2, BRASS7[2]);
  p.line(1, 2, 16, 2, BRASS7[4]);
  p.poly([12, 2, 15, 0, 19, 2, 15, 4], BRASS7[3]);
  p.px(15, 2, BRASS7[5]);
  p.px(19, 2, PORC[5]);
}, { origin: [2, 2], outline: OUTLINE7 });
defineDrawnSprite('ck_hand_short', 14, 5, (p) => {
  p.line(0, 2, 12, 2, BRASS7[2]);
  p.line(1, 2, 11, 2, BRASS7[3]);
  p.poly([8, 2, 10, 0, 13, 2, 10, 4], BRASS7[3]);
  p.px(10, 2, BRASS7[5]);
}, { origin: [2, 2], outline: OUTLINE7 });

// minion: a wind-up tin soldier (two march frames) — brass helmet, verdigris coat, a key in the back
for (let i = 0; i < 2; i++) {
  defineDrawnSprite(`tinsoldier_walk_${i}`, 14, 18, (p) => {
    const s = i ? 1 : -1;
    // legs on a round tin base
    p.ellipse(7, 16.5, 5, 1.5, BRASS7[2]);
    p.rect(4 + (s > 0 ? 1 : 0), 12, 2, 4, PLUM[2]);
    p.rect(8 - (s > 0 ? 1 : 0), 12, 2, 4, PLUM[2]);
    // coat
    p.rect(3, 6, 8, 7, VERD[2]);
    for (let y = 6; y < 13; y++) for (let x = 3; x < 11; x++) if (p.isSet(x, y)) p.px(x, y, VERD[lum((x + 0.5 - 7) / 4, 0, 4, x, y, true, -0.1) + 1]);
    p.line(7, 6, 7, 12, BRASS7[3]);
    p.px(5, 8, BRASS7[4]);
    p.px(9, 8, BRASS7[4]);
    // porcelain face + tall brass helmet
    p.rect(5, 3, 4, 3, PORC[3]);
    p.px(5, 4, PLUM[1]);
    p.px(8, 4, PLUM[1]);
    p.rect(4, 0, 6, 3, BRASS7[2]);
    p.rect(5, 0, 4, 1, BRASS7[4]);
    p.px(7, 0, AMBER[3]);
    // rifle + the key in the back
    p.line(11, 5 + s, 11, 12, BRASS7[1]);
    p.px(11, 4 + s, PORC[5]);
    p.line(1, 8, 3, 8, BRASS7[3]);
    p.ring(0.5, 8, 1.4, 1, BRASS7[3]);
  }, { outline: OUTLINE7, anchor: 'bottom' });
}

// intro-card portrait: the gaunt face and loupe, the crown of cogs, the dial as a halo, the needle raised
defineDrawnSprite('ck_portrait', 70, 88, (p) => {
  const cx = 35;
  // dial halo behind
  for (let y = 0; y < 70; y++) {
    for (let x = 0; x < 70; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - 36;
      const d = Math.hypot(dx, dy);
      if (d > 33.5) continue;
      if (d > 30) p.px(x, y, BRASS7[lum(dx / 33, dy / 33, BRASS7.length, x, y, true, 0.05)]);
      else if (d > 28.8) p.px(x, y, PLUM[1]);
      else p.px(x, y, PORC[clamp(Math.floor((0.72 - (dx + dy) / 140) * 5 + bayer(x, y) - 0.5), 2, 5)]);
    }
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const len = i % 3 === 0 ? 5 : 3;
    p.line(cx + Math.cos(a) * (27 - len), 36 + Math.sin(a) * (27 - len), cx + Math.cos(a) * 27, 36 + Math.sin(a) * 27, i % 3 === 0 ? BRASS7[1] : PLUM[1]);
  }
  for (let i = 0; i < 60; i++) if (i % 5) p.px(cx + Math.cos((i / 60) * TAU) * 27, 36 + Math.sin((i / 60) * TAU) * 27, PORC[1]);
  // dial hands behind the shoulders
  p.line(cx, 36, cx + 22, 24, BRASS7[2]);
  p.line(cx, 36, cx - 10, 54, BRASS7[2]);
  // coat and collar
  p.poly([cx - 18, 88, cx - 16, 58, cx - 8, 50, cx + 8, 50, cx + 16, 58, cx + 18, 88], PLUM[2]);
  for (let y = 50; y < 88; y++) for (let x = cx - 18; x <= cx + 18; x++) if (p.isSet(x, y) && y >= 50 && Math.abs(x - cx) <= 18) p.px(x, y, PLUM[lum((x + 0.5 - cx) / 16, (y - 70) / 30, PLUM.length, x, y, true, -0.1)]);
  p.poly([cx - 12, 50, cx + 12, 50, cx + 9, 58, cx - 9, 58], PLUM[3]);
  for (let y = 60; y < 86; y += 5) p.px(cx, y, BRASS7[4]);
  p.rect(cx - 14, 80, 28, 4, BRASS7[2]);
  p.line(cx - 14, 80, cx + 13, 80, BRASS7[4]);
  for (let x = cx - 12; x < cx + 13; x += 4) p.px(x, 82, BRASS7[5]);
  // neck + the big gaunt face
  p.line(cx, 42, cx, 52, BRASS7[2]);
  p.rect(cx - 1, 44, 3, 1, BRASS7[4]);
  p.rect(cx - 1, 48, 3, 1, BRASS7[4]);
  ball(p, cx, 30, 11, 15, PORC, false);
  for (let y = 30; y <= 38; y++) {
    p.pxIn(cx - 8, y, PORC[1]);
    p.pxIn(cx + 8, y, PORC[1]);
  }
  p.pxIn(cx - 7, 34, PORC[0]);
  p.pxIn(cx + 7, 34, PORC[0]);
  // eyes: a deep socket with an amber ember; the loupe over the other
  p.rect(cx - 9, 25, 6, 4, DEEP);
  p.rect(cx - 7, 26, 2, 2, AMBER[3]);
  p.px(cx - 7, 26, AMBER[4]);
  p.ring(cx + 5, 26.5, 6.5, 2, BRASS7[3]);
  p.px(cx + 1, 22, BRASS7[5]);
  p.px(cx + 2, 21, BRASS7[5]);
  p.circle(cx + 5, 26.5, 4.6, VERD[3]);
  p.circle(cx + 4, 25.5, 2.4, VERD[4]);
  p.px(cx + 3, 24, VERD[5]);
  p.line(cx + 3, 23, cx + 6, 22, PORC[5]);
  p.px(cx + 8, 29, VERD[1]);
  p.rect(cx + 4, 26, 2, 2, AMBER[4]);
  p.line(cx + 11, 28, cx + 15, 36, BRASS7[2]);
  // hinged jaw + hairline cracks
  p.line(cx - 4, 39, cx + 4, 39, PLUM[1]);
  p.px(cx - 6, 39, BRASS7[3]);
  p.px(cx + 6, 39, BRASS7[3]);
  p.line(cx - 2, 18, cx - 4, 24, PORC[1]);
  crack(p, cx + 9, 19, cx + 7, 31, PORC[1], 3, 0.6);
  // crown of cogs + antenna
  paintGear(p, cx - 9, 16, 5, 8, 0.1, BRASS7, BRASS7[1]);
  paintGear(p, cx + 9, 16, 4.5, 8, 0.6, BRASS7, BRASS7[1]);
  paintGear(p, cx, 12, 6, 9, 0.3, BRASS7, AMBER[2]);
  p.line(cx, 5, cx, 0, BRASS7[3]);
  p.px(cx, 0, VERD[5]);
  // the needle hand raised on the right, the key low on the left
  limb(p, cx + 22, 72, 2.6, cx + 30, 56, 2, [PLUM[0], PLUM[1], PLUM[2]]);
  p.circle(cx + 30, 56, 2.4, PORC[3]);
  paintNeedle(p, cx + 30, 54, -1.35, true);
  p.line(cx + 30, 54, cx + 33, 36, BRASS7[4]);
  p.px(cx + 33, 35, AMBER[4]);
  limb(p, cx - 22, 72, 2.6, cx - 30, 66, 2, [PLUM[0], PLUM[1], PLUM[2]]);
  p.circle(cx - 30, 66, 2.4, PORC[3]);
  paintKey(p, cx - 30, 66, -1.3);
}, { outline: OUTLINE7 });

// ------------------------------------------------------------------ arena pieces
const NAME = '시계장인';
const BUL_BRASS = '#ffb438';
const BRASS_FX = [AMBER[4], BRASS7[4], BRASS7[2]];
const VERD_FX = [VERD[5], VERD[4], VERD[2]];

/** 시간 정지: a cosmetic tint over the room while every shot hangs frozen. */
class TimeStopFx extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  owner: Enemy;
  until: number;
  level = 0;
  constructor(owner: Enemy, until: number) {
    super();
    this.owner = owner;
    this.until = until;
    this.layer = 2;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const target = w.time < this.until && this.owner.alive ? 1 : 0;
    this.level += (target - this.level) * Math.min(1, dt * (target ? 5 : 7));
    if (!target && this.level < 0.02) this.dead = true;
  }

  override draw(r: Renderer, w: World): void {
    if (this.level < 0.02) return;
    const room = w.room;
    r.rect(room.interiorX - 32, room.interiorY - 32, room.interiorW + 64, room.interiorH + 64, VERD[1], 0.2 * this.level);
    drawDial(r, this.owner.x, this.owner.y + 2, 46, VERD[5], 0.4 * this.level, -Math.PI / 2 + this.age * 0.2);
    // the great hand creeping toward the tock
    const left = clamp((this.until - w.time) / 1.6, 0, 1);
    const a = -Math.PI / 2 - left * TAU;
    r.line(this.owner.x, this.owner.y + 2, this.owner.x + Math.cos(a) * 40, this.owner.y + 2 + Math.sin(a) * 40, VERD[5], 2, 0.8 * this.level);
  }
}

// ------------------------------------------------------------------ minion: 태엽 병정
defineEnemy({
  id: 'tin_soldier',
  name: '태엽 병정',
  hp: 30,
  radius: 5,
  speed: 46,
  mass: 1.5,
  sprite: 'tinsoldier_walk_0',
  shadow: 9,
  deathFx: 'metal',
  bloodColor: '#d4a040',
  contactDamage: 1,
  light: { radius: 14, color: '#e8b040' },
  *script(e, w) {
    while (true) {
      // marches in straight bursts (a wound spring), stops, aims, fires one brass round
      const a = e.angleToTarget(w) + w.rng.range(-0.3, 0.3);
      for (let el = 0; el < w.rng.range(0.9, 1.4); el += w.dt) {
        e.moveAngle(a, e.speed);
        e.setAnim(`tinsoldier_walk_${Math.floor(e.age * 7) % 2}`);
        if (e.mem.__bumped) break;
        yield;
      }
      e.stop();
      e.telegraph(0.5);
      w.sfx('clockboss_wind', { vol: 0.25, pitch: 1.6 });
      yield 0.5;
      e.shoot(w, e.angleToTarget(w), bullet7('brass', 3, { speed: 118 }));
      w.sfx('enemy_shoot', { vol: 0.3, pitch: 1.2 });
      yield 0.4;
    }
  },
});

// ------------------------------------------------------------------ behaviour
function anim(e: Enemy, state: string, restart = false): void {
  e.setAnim(`${e.mem.p2 ? 'ck2' : 'ck'}_${state}`, restart);
}

function tickPeriod(e: Enemy): number {
  return e.mem.p2 ? 0.55 : 0.8;
}

/** World position of the dial centre (the hands' hub, where shots are born). */
function dialPos(e: Enemy): { x: number; y: number } {
  return { x: e.x, y: e.y + CK_DIAL_DY + (e.mem.bob ?? 0) };
}

/** Anchor spots he skips between: three along the upper third of the room. */
function anchors(w: World): { x: number; y: number }[] {
  const room = w.room;
  // low enough that the whole clock (78 px tall above its foot) stands clear of the top wall
  const y = clamp(room.interiorY + 72, room.interiorY + 40, room.centerY + 8);
  const span = Math.min(96, room.interiorW / 2 - 50);
  return [{ x: room.centerX - span, y }, { x: room.centerX, y }, { x: room.centerX + span, y }];
}

/** 시간 건너뛰기: he is gone between one tick and the next, and stands somewhere else. */
function* skip(e: Enemy, w: World): Script {
  const spots = anchors(w).filter((s) => Math.hypot(s.x - e.x, s.y - e.y) > 20 && Math.hypot(s.x - w.player.x, s.y - w.player.y) > 60);
  if (!spots.length) return;
  const s = spots[w.rng.int(0, spots.length - 1)];
  e.vulnerable = false;
  e.harmful = false;
  w.sfx('clockboss_tick', { vol: 0.6, pitch: 0.6 });
  // a ghost of him forms where he will be while he fades here
  w.spawn(new Afterimage(e.frame(), s.x, s.y, false, VERD[4], 0.5));
  for (let el = 0; el < 0.25; el += w.dt) {
    e.alpha = 1 - el / 0.25;
    yield;
  }
  e.alpha = 0;
  w.spawn(new Afterimage(e.frame(), e.x, e.y, false, AMBER[3], 0.35));
  gather(w, s.x, s.y + CK_DIAL_DY, VERD_FX, 10, 30);
  e.x = s.x;
  e.y = s.y;
  e.halt();
  yield 0.12;
  w.sfx('clockboss_tick', { vol: 0.7, pitch: 1.1 });
  for (let el = 0; el < 0.18; el += w.dt) {
    e.alpha = el / 0.18;
    yield;
  }
  e.alpha = 1;
  e.vulnerable = true;
  e.harmful = true;
}

/** 멈춘 탄환: fans at the keeper freeze mid-air; on the tick they all rush, re-aimed. */
function* frozenVolley(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  anim(e, 'wind', true);
  e.telegraph(0.55);
  w.sfx('clockboss_wind', { vol: 0.7, pitch: 1.0 });
  yield 0.55;
  const n = p2 ? 4 : 3;
  const period = tickPeriod(e);
  // every shot of the attack releases on the same tick, a little after the last fan froze
  const resumeAt = nextTick(w.time, e.mem.tickAt ?? w.time, period, n * 0.4 + 0.9);
  const d = dialPos(e);
  for (let k = 0; k < n; k++) {
    const t = e.target(w);
    const base = Math.atan2(t.y - d.y, t.x - d.x);
    const count = p2 ? 7 : 6;
    const spread = 0.2;
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * spread;
      const pr = e.shoot(w, base + off, bullet7('verd', 3, {
        speed: 125, life: 9, range: 900, behaviors: [tickFreeze({ after: 0.55 + k * 0.08, resumeAt, reaim: true, off: off * 0.45, speed: p2 ? 150 : 135 })],
      }));
      pr.x = d.x + Math.cos(base + off) * 10;
      pr.y = d.y + Math.sin(base + off) * 10;
    }
    w.sfx('enemy_shoot', { vol: 0.4, pitch: 1.3 + k * 0.1 });
    anim(e, 'cast', true);
    yield 0.4;
  }
  // the moment they freeze
  yield 0.3;
  w.sfx('clockboss_freeze', { vol: 0.8, pitch: 1.0 });
  anim(e, 'idle');
  const wait = resumeAt - w.time;
  if (wait > 0) yield wait;
  w.sfx('clockboss_tick', { vol: 1, pitch: 0.75 });
  w.shake(0.12);
  yield 0.9;
}

/** 되감기: fast amber fans fly past the keeper, then rewind along their own paths. */
function* rewindVolley(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  anim(e, 'wind', true);
  e.telegraph(0.5);
  w.sfx('clockboss_wind', { vol: 0.6, pitch: 0.8 });
  yield 0.5;
  const period = tickPeriod(e);
  const at = nextTick(w.time, e.mem.tickAt ?? w.time, period, p2 ? 1.5 : 1.7);
  const d = dialPos(e);
  const fans = p2 ? 3 : 2;
  for (let k = 0; k < fans; k++) {
    const t = e.target(w);
    const base = Math.atan2(t.y - 4 - d.y, t.x - d.x);
    const count = p2 ? 6 : 5;
    for (let i = 0; i < count; i++) {
      const a = base + (i - (count - 1) / 2) * 0.17;
      const pr = e.shoot(w, a, bullet7('brass', 3, { speed: 165, life: 9, range: 2000, behaviors: [rewind(at)] }));
      pr.x = d.x + Math.cos(a) * 10;
      pr.y = d.y + Math.sin(a) * 10;
    }
    anim(e, 'cast', true);
    w.sfx('enemy_shoot', { vol: 0.45, pitch: 0.9 + k * 0.1 });
    yield 0.32;
  }
  anim(e, 'idle');
  const warnAt = at - 0.45;
  if (warnAt > w.time) yield warnAt - w.time;
  w.sfx('clockboss_rewind', { vol: 0.9, pitch: 1.0 });
  if (at > w.time) yield at - w.time;
  w.sfx('clockboss_tick', { vol: 0.9, pitch: 0.7 });
  anim(e, 'wind', true);
  yield 1.4;
  anim(e, 'idle');
  yield 0.3;
}

/** 시침 베기: the dial shows where the hand starts and which way it turns, then it sweeps. */
function* handSweep(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  anim(e, 'cast', true);
  e.telegraph(p2 ? 0.8 : 0.95);
  w.sfx('clockboss_wind', { vol: 0.5, pitch: 0.6 });
  const dir = w.rng.sign();
  const t = e.target(w);
  // start a little behind the keeper so the blade reaches them about a second in
  const a0 = Math.atan2(t.y - e.y, t.x - e.x) - dir * 1.15;
  const hands = p2 ? 2 : 1;
  const omega = dir * (p2 ? 1.35 : 1.15);
  const warn = p2 ? 0.8 : 0.95;
  const duration = p2 ? TAU / Math.abs(omega) + 0.4 : 3.5 / Math.abs(omega);
  // phase 2: the second hand stands at a right angle, so both blades point into the room
  const hand = w.spawn(new ClockHand(e, a0, { source: NAME, warn, duration, omega, half: 5, hands, spacing: p2 ? dir * (Math.PI / 2) : undefined, damage: 1, rehit: 0.8 }));
  e.mem.hand = hand;
  yield warn;
  anim(e, 'idle');
  for (let el = 0; el < duration; el += w.dt) yield;
  e.mem.hand = null;
  yield 0.6;
}

/** 굼뜬 시간: pools of slowed time, the first under the keeper. */
function* timeWells(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  anim(e, 'lean', true);
  e.telegraph(0.5);
  w.sfx('clockboss_wind', { vol: 0.5, pitch: 1.3 });
  yield 0.5;
  const n = p2 ? 4 : 3;
  const life = p2 ? 8 : 7;
  for (let k = 0; k < n; k++) {
    const t = e.target(w);
    const s = k === 0 ? inRoom(w, t.x, t.y, 24) : spotAround(w, t.x, t.y, 60, 120, 10) ?? inRoom(w, t.x + w.rng.range(-80, 80), t.y + w.rng.range(-50, 50), 24);
    w.spawn(new GroundWarning(s.x, s.y, 30, 0.7, (ww) => {
      ww.spawn(new TimeWell(s.x, s.y, 30, life, 0.5));
      ww.sfx('clockboss_freeze', { vol: 0.45, pitch: 1.4 });
    }, VERD[4]));
    w.sfx('clockboss_tick', { vol: 0.4, pitch: 1.4 });
    yield 0.18;
  }
  anim(e, 'idle');
  yield 1.0;
}

/** 톱니 굴리기: heavy cogs roll out in a fan and bounce once off the walls. */
function* gears(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  e.halt();
  anim(e, 'lean', true);
  e.telegraph(0.55);
  w.sfx('clockboss_gear', { vol: 0.5, pitch: 1.3 });
  yield 0.55;
  const n = p2 ? 5 : 3;
  const t = e.target(w);
  const base = Math.atan2(t.y - e.y, t.x - e.x);
  for (let i = 0; i < n; i++) {
    const a = base + (i - (n - 1) / 2) * 0.32;
    const pr = e.shoot(w, a, {
      color: BUL_BRASS, radius: 5, speed: 92, bounce: 1, life: 5.5, range: 900, light: 22, style: 'none',
      behaviors: [spinDraw(gearSprite(13, true), 6)],
    });
    pr.mem.spinDir = i % 2 ? -1 : 1;
    pr.x = e.x + Math.cos(a) * 16;
    pr.y = e.y + 2 + Math.sin(a) * 10;
    brassSparks(w, pr.x, pr.y, 5, 70);
  }
  w.sfx('clockboss_gear', { vol: 0.8, pitch: 0.9 });
  w.shake(0.12);
  anim(e, 'idle');
  yield 1.2;
}

/** 태엽 병정: tin soldiers wind themselves up at the room's edge. */
function* summonSoldiers(e: Enemy, w: World, n: number): Script {
  e.halt();
  anim(e, 'wind', true);
  e.telegraph(0.5);
  w.sfx('clockboss_wind', { vol: 0.6, pitch: 1.2 });
  yield 0.5;
  for (let i = 0; i < n; i++) {
    const s = spotAround(w, w.player.x, w.player.y, 80, 130, 7) ?? inRoom(w, e.x + (i ? 60 : -60), e.y + 40, 14);
    w.spawn(new GroundWarning(s.x, s.y, 10, 0.7, (ww) => {
      summonMinion7(e, ww, 'tin_soldier', s.x, s.y, BRASS_FX);
      ww.sfx('clockboss_gear', { vol: 0.4, pitch: 1.5 });
    }, BRASS7[4]));
  }
  yield 0.9;
  anim(e, 'idle');
}

/** 시간 정지 (P2): rings freeze into a cage around him; on the great tock everything moves at once. */
function* timeStop(e: Enemy, w: World): Script {
  e.mem.stopAt = e.age;
  e.halt();
  anim(e, 'wind', true);
  e.telegraph(0.8);
  w.sfx('clockboss_wind', { vol: 0.9, pitch: 0.7 });
  gather(w, e.x, e.y + CK_DIAL_DY, VERD_FX, 16, 36);
  if (!e.mem.taught) {
    e.mem.taught = 1;
    w.banner('시간이 멈춘다', '다음 울림에 모든 것이 한꺼번에 움직인다', { color: VERD[4], small: true });
  }
  yield 0.8;
  const period = tickPeriod(e);
  const resumeAt = nextTick(w.time, e.mem.tickAt ?? w.time, period, 2.4);
  const d = dialPos(e);
  w.spawn(new TimeStopFx(e, resumeAt));
  // two staggered rings that stop at different radii: a cage with lanes between the bars
  for (let ring = 0; ring < 2; ring++) {
    const g = w.rng.angle();
    let i = 0;
    for (const a of gapRing(18, ring * (TAU / 36), [g, g + Math.PI], 0.7)) {
      const pr = e.shoot(w, a, bullet7('verd', 3, {
        speed: 110, life: 10, range: 900, behaviors: [tickFreeze({ after: 0.5 + ring * 0.35, resumeAt, reaim: true, off: ((i++ % 3) - 1) * 0.35, speed: 140 })],
      }));
      pr.x = d.x + Math.cos(a) * 10;
      pr.y = d.y + Math.sin(a) * 10;
    }
    w.sfx('enemy_shoot', { vol: 0.5, pitch: 0.8 + ring * 0.2 });
    yield 0.3;
  }
  anim(e, 'cast', true);
  // and a fan at the keeper that freezes further out
  const t = e.target(w);
  const base = Math.atan2(t.y - d.y, t.x - d.x);
  for (let i = 0; i < 7; i++) {
    const off = (i - 3) * 0.2;
    const pr = e.shoot(w, base + off, bullet7('verd', 3, { speed: 130, life: 10, range: 900, behaviors: [tickFreeze({ after: 0.7, resumeAt, reaim: true, off: off * 0.4, speed: 140 })] }));
    pr.x = d.x + Math.cos(base + off) * 10;
    pr.y = d.y + Math.sin(base + off) * 10;
  }
  yield 0.75;
  w.sfx('clockboss_freeze', { vol: 1, pitch: 0.8 });
  w.renderer?.screenFlash(VERD[4], 0.18);
  w.shake(0.15);
  anim(e, 'idle');
  const wait = resumeAt - w.time;
  if (wait > 0) yield wait;
  w.sfx('clockboss_tick', { vol: 1, pitch: 0.55 });
  w.sfx('clockboss_gear', { vol: 0.7, pitch: 0.7 });
  w.shake(0.3);
  yield 1.2;
}

function* phaseTwo(e: Enemy, w: World): Script {
  yield* phaseShift(e, w, {
    anim: 'ck_hurt',
    color: AMBER[3],
    time: 1.7,
    onPeak: () => {
      e.mem.p2 = true;
      anim(e, 'cast', true);
      const d = dialPos(e);
      w.sfx('clockboss_shatter', { vol: 1, pitch: 0.8 });
      w.sfx('clockboss_gear', { vol: 0.8, pitch: 0.6 });
      // the dial glass blows out
      porcelainShards(w, d.x, d.y, 36, 170);
      w.particles.burst(d.x, d.y, { count: 26, speed: [30, 130], life: [0.4, 1.0], colors: BRASS_FX, size: [1, 2], additive: true, light: 5, gravity: -30 });
      const g = w.rng.angle();
      for (const a of gapRing(16, 0, [g, g + Math.PI], 0.9)) {
        const pr = e.shoot(w, a, bullet7('brass', 3, { speed: 90, z: 6 }));
        pr.x = d.x + Math.cos(a) * 12;
        pr.y = d.y + Math.sin(a) * 12;
      }
    },
  });
}

function* patterns(e: Enemy, w: World): Script {
  while (true) {
    const p2 = !!e.mem.p2;
    const wells = w.entities.some((x) => x instanceof TimeWell && !x.dead);
    const sinceStop = e.age - (e.mem.stopAt ?? -99);
    const id = pickBossPattern(e, w, [
      { id: 'freeze', w: 3 },
      { id: 'chime', w: 2.6, when: e.age - (e.mem.lastLaserAt ?? -99) > 13 },
      { id: 'rewind', w: 2.6 },
      { id: 'hands', w: 2.6 },
      { id: 'wells', w: 2.0, when: !wells },
      { id: 'gears', w: 2.2 },
      { id: 'summon', w: 1.1, when: minionCount(w, e) === 0 && w.enemies.length < 4 },
      { id: 'stop', w: 3.2, when: p2 && sinceStop > 16 },
    ], e.mem.last as string | null);
    e.mem.last = id;
    if (id === 'chime') yield* clockChime(e, w);
    else if (id === 'freeze') yield* frozenVolley(e, w);
    else if (id === 'rewind') yield* rewindVolley(e, w);
    else if (id === 'hands') yield* handSweep(e, w);
    else if (id === 'wells') yield* timeWells(e, w);
    else if (id === 'gears') yield* gears(e, w);
    else if (id === 'summon') yield* summonSoldiers(e, w, 2);
    else yield* timeStop(e, w);
    if (w.rng.chance(p2 ? 0.8 : 0.65)) yield* skip(e, w);
    yield p2 ? w.rng.range(0.25, 0.4) : w.rng.range(0.35, 0.55);
  }
}

/** Everything he had in the air or on the floor goes with him. */
function clearArena(w: World): void {
  clearEnemyShots(w);
  for (const x of w.entities) {
    if (x.dead) continue;
    if (x instanceof GroundWarning || x instanceof ClockHand || x instanceof ShockRing) x.dead = true;
    else if (x instanceof TimeWell) x.onCleared();
  }
}

// ------------------------------------------------------------------ definition
defineBoss({
  id: 'clockmaker',
  name: NAME,
  bossTitle: '시간을 되감는 태엽 장인',
  bossFloors: [7],
  bossMusic: 'boss_clockwork',
  hp: 1030,
  radius: 15,
  speed: 0,
  mass: Infinity,
  phasing: true,
  sprite: 'ck_idle',
  portrait: 'ck_portrait',
  shadow: 0,
  deathFx: 'metal',
  bloodColor: '#d4a040',
  contactDamage: 1,
  hurtSfx: 'hit_metal',
  light: { radius: 76, color: '#e8b040' },
  init(e, w) {
    e.mem.last = null;
    e.mem.tickT = 0;
    e.mem.tick = 0;
    e.mem.tickAt = w.time ?? 0;
    e.mem.minAng = -Math.PI / 2;
    e.mem.hourAng = -Math.PI / 2 + 2.6;
    e.mem.pulse = 0;
    e.mem.hand = null;
    // the clock stands at its central anchor from the first tick (clear of the top wall whatever the template says)
    if (w.room) {
      const a = anchors(w)[1];
      e.x = a.x;
      e.y = a.y;
    }
    // every attack by name (debug console / screenshot tooling: `e.script.set(e.mem.attacks.freeze(e, w))`)
    e.mem.attacks = {
      freeze: frozenVolley, rewind: rewindVolley, hands: handSweep, wells: timeWells, gears, summon: (b: Enemy, ww: World) => summonSoldiers(b, ww, 2),
      stop: timeStop, skip, patterns,
    } satisfies Record<string, (b: Enemy, ww: World) => Script>;
  },
  *script(e, w) {
    anim(e, 'idle');
    yield 0.4;
    yield* patterns(e, w);
  },
  update(e, w, dt) {
    phaseGate(e, 0.5, 1, function* () {
      e.mem.hand = null;
      yield* phaseTwo(e, w);
      phaseDone(e);
      yield* timeStop(e, w);
      yield* patterns(e, w);
    });
    e.mem.bob = Math.sin(e.age * 1.6) * 1;
    // the great clock ticks: shots that froze wait for it, the hands jump with it
    const period = tickPeriod(e);
    e.mem.tickT = (e.mem.tickT ?? 0) + dt;
    if (e.mem.tickT >= period) {
      e.mem.tickT -= period;
      e.mem.tick = (e.mem.tick ?? 0) + 1;
      e.mem.tickAt = w.time;
      e.mem.minAng = (e.mem.minAng ?? 0) + TAU / 24;
      e.mem.hourAng = (e.mem.hourAng ?? 0) + TAU / 288;
      e.mem.pulse = 1;
      w.sfx('clockboss_tick', { vol: e.mem.p2 ? 0.5 : 0.4, pitch: e.mem.tick % 2 ? 1.0 : 0.86 });
    }
    e.mem.pulse = Math.max(0, (e.mem.pulse ?? 0) - dt * 4);
    // brass dust off the works; in phase 2 the broken dial throws sparks
    if (fx.chance(e.mem.p2 ? 0.45 : 0.12)) {
      const d = dialPos(e);
      w.particles.spawn({
        x: d.x + fx.range(-16, 16), y: d.y + fx.range(-14, 14), vx: fx.range(-10, 10), vy: fx.range(-20, -4), vz: 0, life: fx.range(0.3, 0.7),
        colors: e.mem.p2 ? [AMBER[4], AMBER[3]] : [BRASS7[4], VERD[4]], size: 1, additive: true, light: e.mem.p2 ? 4 : 0, gravity: e.mem.p2 ? 220 : 0,
      });
    }
  },
  draw(e, r) {
    if (e.hidden) return;
    const bob = e.mem.bob ?? 0;
    const alpha = e.alpha;
    r.shadow(e.x, e.y + 3, 50, 12, 0.35 * alpha);
    // a faint ring on the floor pulses with every tick (and brightens while a blade is out)
    const pulse = e.mem.pulse ?? 0;
    if (pulse > 0) r.ring(e.x, e.y + 2, 20 + (1 - pulse) * 26, e.mem.p2 ? AMBER[3] : VERD[4], 1, pulse * 0.5 * alpha);
    e.drawDefault(r, e.frame(), 0);
    // the dial hands, jumping with the tick (doubled in phase 2)
    const d = dialPos(e);
    const p2 = !!e.mem.p2;
    const hour = e.mem.hourAng ?? 0;
    const min = e.mem.minAng ?? 0;
    const o = { rot: hour, alpha, flash: e.flash > 0 ? 0.8 : 0 };
    r.sprite('ck_hand_short', d.x, d.y, o);
    o.rot = min;
    r.sprite('ck_hand_long', d.x, d.y, o);
    if (p2) {
      o.rot = hour + Math.PI;
      r.sprite('ck_hand_short', d.x, d.y, o);
      o.rot = min + Math.PI;
      r.sprite('ck_hand_long', d.x, d.y, o);
      r.circle(d.x, d.y, 8 + Math.sin(e.age * 6) * 1.5, AMBER[3], 0.16 * alpha);
    }
    r.circle(d.x, d.y, 2, BRASS7[5], alpha);
    void bob;
  },
  onDeath(e, w) {
    clearArena(w);
    dissolveMinions(w, e);
    const d = dialPos(e);
    w.sfx('clockboss_tick', { vol: 1, pitch: 0.5 });
    w.sfx('clockboss_shatter', { vol: 1, pitch: 0.7 });
    w.sfx('clockboss_gear', { vol: 1, pitch: 0.55 });
    w.sfx('explosion', { vol: 0.7, pitch: 0.7 });
    bossDeathBurst(w, e.x, e.y - 20, [BRASS7[4], BRASS7[2], PLUM[2], PORC[4], VERD[3]], 40);
    // the clock stops: the works burst, hands and cogs fly, springs bounce across the floor
    porcelainShards(w, d.x, d.y, 40, 190);
    w.particles.burst(d.x, d.y, { count: 22, speed: [50, 170], life: [0.8, 1.6], colors: [BRASS7[3], BRASS7[4]], size: [3, 5], gravity: 300, vz: [60, 200], bounce: 0.4, shape: 'square', vrot: 10 });
    w.particles.burst(d.x, d.y, { count: 40, speed: [20, 120], life: [0.8, 1.8], colors: [AMBER[4], AMBER[3], VERD[4]], size: [1, 2], additive: true, light: 6, gravity: -30 });
    for (let i = 0; i < 5; i++) w.spawn(new RingFx(d.x, d.y, 36 + i * 32, 0.55 + i * 0.18, i % 2 ? AMBER[3] : VERD[5], 2));
    for (let i = 0; i < 3; i++) w.spawn(new RingFx(e.x, e.y + 2, 46 + i * 36, 0.5 + i * 0.15, i % 2 ? '#ffffff' : BRASS7[4], 2));
    for (let i = 0; i < 6; i++) w.decal(e.x + fx.range(-30, 30), e.y + 10 + fx.range(-8, 16), PLUM[0], fx.range(3, 7), 0.6);
    brassSparks(w, e.x, e.y, 20, 140);
  },
});

export { TimeStopFx };
