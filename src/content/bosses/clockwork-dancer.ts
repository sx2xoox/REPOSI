import { pickBossPattern } from './tactics';
// Floor 7 boss: 태엽 무희 (the Clockwork Dancer) — 음악상자 위의 도자기 무희.
// A porcelain ballerina automaton stepped down off a giant music box: cream porcelain
// skin with painted cheeks, a verdigris tutu trimmed in brass, a brass bun with a
// winding key in her back, dancing en pointe on the box's spinning cylinder disc.
// Graceful, fast, and every figure of her choreography is an attack.
// Phase 1: 피루엣 돌진 (lane-telegraphed spinning dashes), 회전 치마 (a spiral of rose
//   shots as she pirouettes), 실린더 핀 (a row of pins along a wall advances in unison,
//   one gap), 거울 무희 (mirrored ghost dancers dash through the keeper's spot), 그랑 주테
//   (a leap onto the keeper: gapped shock ring + a burst), 리본 (serpentine shot ribbons).
//   Her clones and afterimages (user 2026-10-08: "분신·잔상을 쓰는 패턴") keep dancing on their own
//   while she starts the next figure: 론도 (a ring of clones circles the keeper, tosses petals on
//   the beat, then collapses through the centre), 다 카포 (an echo replays her dash route
//   backwards), 삼인무 (two clones spin their own counter-turning spirals with her), and every
//   pirouette leaves afterimages standing on its lane (남는 잔상).
// Phase 2 (≤50%): the porcelain cracks and the gears show, the tempo rises, the box
//   detunes — 깨진 왈츠: dashes mirrored by ghosts, double pin rows, four-armed skirts, bigger
//   rings, afterimages that throw petals, encores without a pause, and once under 30% HP the
//   커튼콜 (six clones round the stage dash through the keeper cue by cue while she spins).

import { defineBoss } from '../../game/defs';
import { Entity } from '../../game/entity';
import { PixelPainter, bayer, packColor } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { clamp, TAU } from '../../engine/math';
import { Afterimage, GroundWarning, RingFx } from '../../game/effects';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { Script } from '../../engine/script';
import type { ProjBehavior } from '../../game/projectile';
import { frames, gather, laneWarning, spotAround } from '../enemies/shared';
import {
  ball, beamToWall, bossDeathBurst, clearEnemyShots, crack, dissolveMinions, gapRing, hash2, hitPlayerCircle, inRoom, insideRoom, limb, lum,
  phaseDone, phaseGate, phaseShift, pickPattern, ShockRing, spiralAngles,
} from './final-kit';
import { AMBER, BRASS7, bullet7, gapSlotFor, OUTLINE7, paintGear, PLUM, PORC, porcelainShards, ROSE, rowWithGap, VERD } from './kit7';

// ------------------------------------------------------------------ geometry
const W = 44;
const H = 62;
const CX = 22;
/** pivot = the centre of the music-box disc on the floor (entity position) */
const ORIGIN: [number, number] = [22, 56];
const DEEP = '#07040c';

type V = [number, number];
type Arms = 'crown' | 'forward' | 'open' | 'side' | 'back';
type Legs = 'pointe' | 'arabesque' | 'split' | 'passe';
interface DancerPose {
  bob: number;
  arms: Arms;
  legs: Legs;
  /** pirouette frame 0..3 (undefined = facing us) */
  spin?: number;
  /** skirt flare (half width) */
  flare?: number;
  head?: V;
  /** disc pin phase 0..1 */
  disc: number;
  lean?: number;
}

// ------------------------------------------------------------------ painting
function paintDisc(p: PixelPainter, phase: number, p2: boolean): void {
  // the music-box cylinder disc: brass, a verdigris rim, a ring of pins turning with the tune
  const cy = 54;
  p.ellipse(CX, cy, 15, 5, BRASS7[2]);
  p.shadeSphere(CX, cy, 15, 5, BRASS7 as string[], { dither: true, lightX: -0.4, lightY: -0.9 });
  for (let x = CX - 15; x <= CX + 15; x++) {
    const dy = Math.sqrt(Math.max(0, 1 - ((x + 0.5 - CX) / 15) * ((x + 0.5 - CX) / 15))) * 5;
    p.px(x, Math.floor(cy + dy), BRASS7[0]);
    if (p.isSet(x, Math.floor(cy + dy + 1))) p.px(x, Math.floor(cy + dy + 1), BRASS7[0]);
  }
  p.ellipse(CX, cy, 11, 3.4, VERD[2]);
  p.ellipse(CX, cy - 0.5, 9.5, 2.6, BRASS7[3]);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + phase * TAU;
    const px = CX + Math.cos(a) * 12.5;
    const py = cy + Math.sin(a) * 4;
    if (Math.sin(a) > -0.2) p.px(px, py, i % 2 ? PORC[5] : BRASS7[5]);
  }
  p.circle(CX, cy - 1, 1.6, BRASS7[1]);
  p.px(CX - 1, cy - 2, BRASS7[4]);
  if (p2) {
    crack(p, CX - 12, cy, CX + 2, cy + 3, PLUM[0], 5, 0.6);
    p.px(CX - 6, cy + 1, AMBER[3]);
    p.px(CX - 2, cy + 2, AMBER[4]);
    p.pxIn(CX + 8, cy + 2, VERD[1]);
    p.pxIn(CX + 10, cy + 1, VERD[1]);
  }
}

function paintLegs(p: PixelPainter, o: DancerPose, p2: boolean): void {
  const hip: V = [CX, 40 + o.bob];
  const side = o.spin !== undefined && (o.spin === 1 || o.spin === 3);
  let feet: V[];
  if (o.legs === 'arabesque') feet = [[CX - 1, 52], [CX + 15, 36 + o.bob]];
  else if (o.legs === 'split') feet = [[CX - 15, 46], [CX + 15, 46]];
  else if (o.legs === 'passe') feet = [[CX, 52], [CX + 5, 44]];
  else feet = side ? [[CX, 52], [CX + 1, 52]] : [[CX - 2.5, 52], [CX + 2.5, 52]];
  for (let i = 0; i < feet.length; i++) {
    const f = feet[i];
    const hx = hip[0] + (i ? 2.5 : -2.5);
    const knee: V = [(hx + f[0]) / 2 + (o.legs === 'arabesque' && i ? 2 : 0), (hip[1] + f[1]) / 2 + (o.legs === 'split' ? 2 : 0)];
    limb(p, hx, hip[1], 2, knee[0], knee[1], 1.6, PORC.slice(1, 5));
    limb(p, knee[0], knee[1], 1.6, f[0], f[1], 1.3, PORC.slice(1, 5));
    // verdigris slipper with a brass ribbon
    p.rect(f[0] - 1, f[1] - 1, 3, 2, VERD[3]);
    p.px(f[0], f[1] - 2, BRASS7[4]);
    if (o.legs === 'pointe' || o.legs === 'passe') p.px(f[0], f[1] + 1, VERD[2]);
    if (p2 && i === 0) crack(p, hx, hip[1] + 2, knee[0], knee[1] + 2, PLUM[1], 3 + i, 0.5);
  }
}

function paintSkirt(p: PixelPainter, o: DancerPose, p2: boolean): void {
  const flare = o.flare ?? 13;
  const cy = 38 + o.bob + (o.lean ?? 0) * 0.5;
  // three stiff layers of verdigris tulle, brass trim on the hem, frills of lighter teal
  p.ellipse(CX, cy + 2, flare, 4.4, VERD[1]);
  p.ellipse(CX, cy + 1, flare - 1, 3.8, VERD[2]);
  p.ellipse(CX, cy - 0.5, flare - 2.5, 3.2, VERD[3]);
  const top = packColor(VERD[3]);
  const mid = packColor(VERD[2]);
  for (let y = cy - 4; y <= cy + 7; y++) {
    for (let x = CX - flare - 1; x <= CX + flare + 1; x++) {
      if (!p.isSet(x, y)) continue;
      const c = p.get(x, y);
      if (c !== top && c !== mid) continue;
      const nx = (x + 0.5 - CX) / flare;
      if (nx < -0.3 && y < cy + 1 && bayer(x, y) < 0.5) p.px(x, y, VERD[4]);
      // frills: pleats every 3 px
      if ((x + Math.floor(y)) % 3 === 0 && y > cy) p.px(x, y, VERD[1]);
    }
  }
  // brass hem line following the lower edge
  // Rose-lined scalloped overskirt, readable at the native pixel scale.
  for (let i = -2; i <= 2; i++) {
    const x = CX + i * flare * 0.31;
    const y = cy + 1 - Math.abs(i) * 0.45;
    p.poly([x - 3, y - 2, x + 3, y - 2, x + 2, y + 3, x, y + 4, x - 2, y + 2], i % 2 ? '#6c4766' : '#875776');
    p.line(x - 2, y - 1, x, y + 3, '#c29aa3');
    p.px(x + 1, y + 1, p2 ? AMBER[3] : BRASS7[3]);
  }
  for (let x = CX - flare; x <= CX + flare; x++) {
    const nx = (x + 0.5 - CX) / flare;
    const dy = Math.sqrt(Math.max(0, 1 - nx * nx)) * 4.4;
    const y = Math.floor(cy + 2 + dy);
    if (p.isSet(x, y)) p.px(x, y, x % 2 ? BRASS7[3] : BRASS7[4]);
  }
  p.px(CX - flare + 2, cy - 2, PORC[5]);
  if (p2) {
    // torn at the hem, a crack with the works glowing behind it
    for (let y = cy; y <= cy + 7; y++) for (let x = CX + 3; x <= CX + flare + 1; x++) if (p.isSet(x, y) && hash2(x, y, 4) < 0.22 && y > cy + 2) p.px(x, y, null);
    crack(p, CX - 6, cy - 2, CX - 2, cy + 5, PLUM[0], 6, 0.6);
    crack(p, CX + 2, cy - 3, CX + 7, cy + 2, PLUM[0], 8, 0.5);
    p.px(CX - 4, cy + 1, AMBER[3]);
    p.px(CX - 3, cy - 1, AMBER[4]);
    p.px(CX + 5, cy, AMBER[3]);
  }
}

function paintBody(p: PixelPainter, o: DancerPose, p2: boolean): void {
  const by = o.bob + (o.lean ?? 0);
  const back = o.spin === 2;
  const side = o.spin === 1 || o.spin === 3;
  const hw = side ? 2.6 : 4.2;
  // bodice: verdigris with a brass V trim; porcelain chest and neck above
  p.poly([CX - hw, 26 + by, CX + hw, 26 + by, CX + hw - 1, 39 + by * 0.5, CX - hw + 1, 39 + by * 0.5], VERD[2]);
  const bod = packColor(VERD[2]);
  for (let y = 26; y < 40; y++) for (let x = CX - 5; x <= CX + 5; x++) if (p.isSet(x, y) && p.get(x, y) === bod) p.px(x, y, VERD[lum((x + 0.5 - CX) / hw, (y - 32) / 8, 4, x, y, true, -0.05) + 1]);
  if (!back) {
    p.line(CX - hw + 1, 26 + by, CX, 31 + by, BRASS7[3]);
    p.line(CX + hw - 1, 26 + by, CX, 31 + by, BRASS7[3]);
    p.px(CX, 31 + by, BRASS7[5]);
  }
  p.line(CX - hw + 1, 38 + by * 0.5, CX + hw - 1, 38 + by * 0.5, BRASS7[2]);
  // porcelain shoulders / neck
  p.poly([CX - hw - 1, 27 + by, CX + hw + 1, 27 + by, CX + 2, 23 + by, CX - 2, 23 + by], PORC[3]);
  p.rect(CX - 1, 21 + by, 3, 3, PORC[3]);
  p.px(CX - 1, 22 + by, PORC[4]);
  if (p2) {
    crack(p, CX - 3, 27 + by, CX + 1, 36 + by, PLUM[0], 2, 0.5);
    p.px(CX - 1, 31 + by, AMBER[3]);
    p.px(CX, 34 + by, AMBER[4]);
    // an exposed cog at the shoulder, the works glowing behind it
    p.circle(CX - hw - 1, 28 + by, 3.2, PLUM[0]);
    paintGear(p, CX - hw - 1, 28 + by, 2.6, 6, 0.2, BRASS7, AMBER[3]);
  }
}

function paintArms(p: PixelPainter, o: DancerPose, p2: boolean): void {
  const by = o.bob + (o.lean ?? 0);
  const sh: [V, V] = [[CX - 4, 27 + by], [CX + 4, 27 + by]];
  let hands: [V, V];
  let elbows: [V, V] | null = null;
  switch (o.arms) {
    case 'crown':
      hands = [[CX - 2, 11 + by], [CX + 2, 11 + by]];
      elbows = [[CX - 10, 19 + by], [CX + 10, 19 + by]];
      break;
    case 'forward':
      hands = [[CX - 17, 30 + by], [CX - 15, 25 + by]];
      elbows = [[CX - 11, 31 + by], [CX - 8, 28 + by]];
      break;
    case 'open':
      hands = [[CX - 17, 20 + by], [CX + 17, 20 + by]];
      elbows = [[CX - 11, 26 + by], [CX + 11, 26 + by]];
      break;
    case 'back':
      hands = [[CX - 6, 14 + by], [CX + 7, 15 + by]];
      elbows = [[CX - 10, 21 + by], [CX + 10, 21 + by]];
      break;
    default:
      hands = [[CX - 6, 40 + by], [CX + 7, 39 + by]];
      elbows = [[CX - 8, 33 + by], [CX + 8, 33 + by]];
  }
  for (let i = 0; i < 2; i++) {
    const s = sh[i];
    const el = elbows![i];
    const h = hands[i];
    limb(p, s[0], s[1], 1.7, el[0], el[1], 1.4, PORC.slice(1, 5));
    limb(p, el[0], el[1], 1.4, h[0], h[1], 1.2, PORC.slice(1, 5));
    p.px(el[0], el[1], BRASS7[3]);
    p.circle(h[0], h[1], 1.4, PORC[4]);
    p.px(h[0], h[1] - 1, PORC[5]);
    if (p2 && i === 1) crack(p, s[0], s[1], el[0], el[1], PLUM[1], 7, 0.4);
  }
}

function paintHead(p: PixelPainter, o: DancerPose, p2: boolean): void {
  const hx = CX + (o.head?.[0] ?? 0);
  const hy = 17 + (o.head?.[1] ?? 0) + o.bob + (o.lean ?? 0);
  const back = o.spin === 2;
  const side = o.spin === 1 || o.spin === 3;
  // the winding key in her back (seen beside the head when she turns)
  const kx = back ? hx : hx + (side ? 6 : 7);
  const ky = hy + 8;
  if (!back) {
    p.line(kx, ky, kx + 5, ky - 3, BRASS7[3]);
    p.ring(kx + 7, ky - 4, 2.4, 1.2, BRASS7[3]);
    p.px(kx + 6, ky - 5, BRASS7[5]);
  } else {
    p.line(kx, ky + 1, kx, ky + 5, BRASS7[3]);
    p.ring(kx, ky + 7, 2.4, 1.2, BRASS7[3]);
    p.px(kx - 1, ky + 6, BRASS7[5]);
  }
  // porcelain head
  ball(p, hx, hy, side ? 3.8 : 4.6, 5.2, PORC, false);
  // brass hair pulled into a bun, a verdigris jewel in the tiara
  for (let y = hy - 6; y <= hy - 2; y++) {
    for (let x = hx - 5; x <= hx + 5; x++) {
      if (!p.isSet(x, y)) continue;
      const nx = (x + 0.5 - hx) / 4.6;
      const ny = (y + 0.5 - hy) / 5.2;
      if (ny < -0.45 || (back && ny < 0.3) || nx * nx + ny * ny > 0.85) p.px(x, y, BRASS7[lum(nx, ny, 4, x, y, true, 0.1) + 1]);
    }
  }
  p.circle(hx + (back ? 0 : 1), hy - 7, 2.6, BRASS7[2]);
  p.px(hx + (back ? 0 : 1) - 1, hy - 8, BRASS7[4]);
  p.px(hx + (back ? 0 : 1), hy - 9, BRASS7[5]);
  p.px(hx - (back ? 0 : 2), hy - 5, VERD[5]);
  // A delicate three-point tiara above the porcelain brow.
  p.line(hx - 3, hy - 4, hx + 3, hy - 4, BRASS7[3]);
  for (const dx of [-2, 0, 2]) p.px(hx + dx, hy - 5 - (dx === 0 ? 1 : 0), BRASS7[5]);
  if (!back) {
    // painted face: dark glass eyes with a glint, rosy cheeks, a tiny mouth
    const ex = side ? hx + 1 : hx;
    if (!side) {
      p.px(ex - 2, hy - 1, PLUM[1]);
      p.px(ex - 2, hy, p2 ? PLUM[1] : DEEP);
      p.px(ex - 3, hy - 1, PORC[5]);
    }
    p.px(ex + 2, hy - 1, PLUM[1]);
    p.px(ex + 2, hy, DEEP);
    p.px(ex + 1, hy - 1, PORC[5]);
    p.px(ex - 3, hy + 2, ROSE[3]);
    p.px(ex + 3, hy + 2, ROSE[3]);
    p.px(ex, hy + 3, ROSE[2]);
    if (p2) {
      // a crack from the brow to the jaw; one eye is a bare cog now
      crack(p, hx - 1, hy - 6, hx - 2, hy + 4, PLUM[0], 9, 0.5);
      if (!side) {
        p.px(ex - 2, hy - 1, AMBER[3]);
        p.px(ex - 2, hy, AMBER[2]);
        p.px(ex - 3, hy, BRASS7[2]);
        p.px(ex - 3, hy - 1, BRASS7[3]);
      }
      p.px(hx - 1, hy + 1, AMBER[3]);
      p.px(hx - 1, hy - 3, AMBER[4]);
      p.px(hx - 2, hy + 3, AMBER[3]);
    }
  } else {
    // back of the head: hair only, the nape porcelain
    p.px(hx, hy + 4, PORC[4]);
  }
}

function paintDancer(p: PixelPainter, o: DancerPose, p2: boolean): void {
  paintDisc(p, o.disc, p2);
  paintLegs(p, o, p2);
  paintSkirt(p, o, p2);
  paintBody(p, o, p2);
  paintArms(p, o, p2);
  paintHead(p, o, p2);
  if (o.spin !== undefined) {
    // motion: the hem smears into arcs
    const cy = 40 + o.bob;
    const f = (o.flare ?? 15) + 2;
    for (let i = 0; i < 2; i++) {
      const s = i ? -1 : 1;
      for (let k = 0; k < 5; k++) {
        const a = Math.PI * (0.5 + s * (0.15 + k * 0.08));
        p.px(CX + Math.cos(a) * f, cy + 2 + Math.sin(a) * 4.5, k % 2 ? VERD[4] : VERD[5]);
      }
    }
  }
  if (p2) {
    for (let y = 20; y < 50; y++) for (let x = 8; x < 36; x++) if (p.isSet(x, y) && hash2(x, y, 6) < 0.05) p.pxIn(x, y, PLUM[1]);
  }
}

// ------------------------------------------------------------------ frames
const POSES: Record<string, DancerPose[]> = {
  idle: [0, 1, 2, 3].map((i) => ({ bob: [0, -1, -1, 0][i], arms: 'crown' as Arms, legs: 'pointe' as Legs, disc: i / 4, head: [0, [0, 0, -1, 0][i]] as V })),
  spin: [0, 1, 2, 3].map((i) => ({ bob: -1, arms: (i % 2 ? 'back' : 'crown') as Arms, legs: (i % 2 ? 'pointe' : 'passe') as Legs, spin: i, flare: [16, 15, 16, 15][i], disc: i / 4 })),
  pose: [
    { bob: 0, arms: 'forward', legs: 'arabesque', disc: 0.1, lean: 1, head: [-2, 1] },
    { bob: -1, arms: 'forward', legs: 'arabesque', disc: 0.35, lean: 1, head: [-2, 0] },
  ],
  leap: [{ bob: -3, arms: 'open', legs: 'split', disc: 0.5, flare: 15, head: [0, -1] }],
  hurt: [{ bob: 1, arms: 'side', legs: 'pointe', disc: 0.7, head: [2, 1], lean: 1 }],
};
const FPS: Record<string, number> = { idle: 5, spin: 14, pose: 8, leap: 1, hurt: 1 };

for (const [state, poses] of Object.entries(POSES)) {
  for (const [pre, p2] of [['dancer', false], ['dancer2', true]] as const) {
    frames(pre, state, poses.length, W, H, (p, i) => paintDancer(p, poses[i], p2), { origin: ORIGIN, fps: FPS[state] ?? 7, outline: OUTLINE7 });
  }
}

// a music-box pin bullet: a brass pin head on a cream shaft (points down at rot 0 — not rotated)
defineDrawnSprite('dancer_pin', 7, 9, (p) => {
  p.rect(3, 2, 1, 6, PORC[3]);
  p.px(3, 8, PORC[5]);
  p.circle(3.5, 2.5, 2.4, BRASS7[3]);
  p.px(2, 1, BRASS7[5]);
  p.px(4, 3, BRASS7[1]);
}, { outline: '#200a02' });

// intro-card portrait: the painted porcelain face, the brass bun and key, the tutu's rim below
defineDrawnSprite('dancer_portrait', 64, 86, (p) => {
  const cx = 31;
  // tutu as a wide verdigris ring at the bottom, the bodice rising from it
  p.ellipse(cx, 80, 31, 9, VERD[1]);
  p.ellipse(cx, 78, 28, 7.5, VERD[2]);
  p.ellipse(cx, 76, 24, 6, VERD[3]);
  for (let x = 0; x < 64; x++) {
    const nx = (x + 0.5 - cx) / 31;
    const dy = Math.sqrt(Math.max(0, 1 - nx * nx)) * 9;
    const y = Math.floor(80 + dy);
    if (p.isSet(x, y)) p.px(x, y, x % 2 ? BRASS7[3] : BRASS7[4]);
    if (x % 3 === 0 && p.isSet(x, y - 2)) p.px(x, y - 2, VERD[1]);
  }
  p.poly([cx - 11, 76, cx + 11, 76, cx + 9, 56, cx - 9, 56], VERD[2]);
  const bod = packColor(VERD[2]);
  for (let y = 56; y < 76; y++) for (let x = cx - 11; x <= cx + 11; x++) if (p.isSet(x, y) && p.get(x, y) === bod) p.px(x, y, VERD[lum((x + 0.5 - cx) / 10, (y - 66) / 10, 4, x, y, true, -0.05) + 1]);
  p.line(cx - 9, 56, cx, 66, BRASS7[3]);
  p.line(cx + 9, 56, cx, 66, BRASS7[3]);
  p.px(cx, 66, BRASS7[5]);
  // porcelain shoulders, neck, the key behind the shoulder
  p.poly([cx - 14, 58, cx + 14, 58, cx + 5, 50, cx - 5, 50], PORC[3]);
  p.rect(cx - 3, 44, 7, 7, PORC[3]);
  p.line(cx + 14, 54, cx + 24, 46, BRASS7[3]);
  p.line(cx + 14, 55, cx + 24, 47, BRASS7[2]);
  p.ring(cx + 27, 44, 5, 2, BRASS7[3]);
  p.px(cx + 25, 41, BRASS7[5]);
  // the head
  ball(p, cx, 28, 15, 18, PORC, false);
  // brass hair swept up into a bun, a verdigris tiara
  for (let y = 8; y <= 24; y++) {
    for (let x = cx - 16; x <= cx + 16; x++) {
      if (!p.isSet(x, y)) continue;
      const nx = (x + 0.5 - cx) / 15;
      const ny = (y + 0.5 - 28) / 18;
      if (ny < -0.55 || nx * nx + ny * ny > 0.86) p.px(x, y, BRASS7[lum(nx, ny, 4, x, y, true, 0.1) + 1]);
    }
  }
  p.circle(cx + 3, 7, 7, BRASS7[2]);
  p.shadeSphere(cx + 3, 7, 7, 7, BRASS7.slice(1) as string[]);
  for (let i = 0; i < 3; i++) p.line(cx - 10 + i * 2, 16 + i, cx - 2 + i * 3, 11 + i, BRASS7[1]);
  p.px(cx - 4, 15, VERD[5]);
  p.px(cx - 5, 16, VERD[3]);
  p.px(cx - 3, 16, VERD[3]);
  p.line(cx - 10, 18, cx + 10, 18, BRASS7[3]);
  for (const dx of [-7, 0, 7]) {
    p.line(cx + dx, 18, cx + dx, dx === 0 ? 12 : 14, BRASS7[4]);
    p.px(cx + dx, dx === 0 ? 11 : 13, VERD[5]);
  }
  // painted eyes with lashes and glints, rosy cheeks, a small mouth; a hairline crack
  for (const sd of [-1, 1]) {
    const ex = cx + sd * 6;
    p.rect(ex - 2, 26, 4, 3, PLUM[1]);
    p.rect(ex - 1, 27, 2, 2, DEEP);
    p.px(ex - 2 + (sd < 0 ? 0 : 3), 26, PORC[5]);
    // a painted lash flick at the outer corner, a soft brow above
    p.px(ex + sd * 3, 25, PLUM[1]);
    p.px(ex + sd * 4, 24, PLUM[1]);
    p.line(ex - 2, 22, ex + 2, 22, PORC[1]);
    p.ellipse(ex + sd, 34, 3, 2, ROSE[3]);
    p.px(ex + sd - 1, 33, ROSE[4]);
  }
  p.rect(cx - 2, 38, 5, 2, ROSE[2]);
  p.px(cx, 38, ROSE[1]);
  p.px(cx - 1, 37, ROSE[3]);
  p.px(cx + 1, 37, ROSE[3]);
  crack(p, cx + 12, 16, cx + 9, 30, PORC[1], 5, 0.6);
  p.px(cx + 10, 24, PORC[1]);
}, { outline: OUTLINE7 });

// ------------------------------------------------------------------ arena pieces
const NAME = '태엽 무희';
const ROSE_FX = [ROSE[4], ROSE[3], ROSE[1]];
const PORC_FX = [PORC[5], PORC[3], VERD[4]];

interface GhostOpts {
  source: string;
  /** fade-in before the dash */
  warn: number;
  speed: number;
  len: number;
  damage?: number;
  p2?: boolean;
}

/** 거울 무희: a rose afterimage of the dancer that fades in on a lane, then pirouettes along it. */
class GhostDancer extends Entity {
  angle: number;
  o: GhostOpts;
  travelled = 0;
  struck = false;
  private trailT = 0;
  constructor(x: number, y: number, angle: number, o: GhostOpts) {
    super();
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.o = o;
    this.r = 8;
    this.layer = 1;
    this.tileCollide = false;
    this.team = 'enemy';
    this.enemyHazard = true;
  }

  get dashing(): boolean {
    return this.age >= this.o.warn && this.travelled < this.o.len;
  }

  get done(): boolean {
    return this.travelled >= this.o.len;
  }

  override get sortY(): number {
    return this.y + 1;
  }

  frameName(): string {
    return `${this.o.p2 ? 'dancer2' : 'dancer'}_spin_${Math.floor(this.age * 16) % 4}`;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.age < this.o.warn) return;
    if (this.travelled < this.o.len) {
      const step = Math.min(this.o.speed * dt, this.o.len - this.travelled);
      this.x += Math.cos(this.angle) * step;
      this.y += Math.sin(this.angle) * step;
      this.travelled += step;
      if (!this.struck && hitPlayerCircle(w, this.x, this.y, 9, this.o.damage ?? 1, this.o.source, 170)) this.struck = true;
      this.trailT += dt;
      if (this.trailT > 0.045) {
        this.trailT = 0;
        w.spawn(new Afterimage(this.frameName(), this.x, this.y, false, ROSE[3], 0.3));
      }
      if (fx.chance(0.5)) w.particles.spawn({ x: this.x + fx.range(-6, 6), y: this.y - 20 + fx.range(-10, 10), vy: -fx.range(6, 16), life: fx.range(0.25, 0.5), colors: ROSE_FX, size: 1, additive: true, light: 3 });
      if (this.travelled >= this.o.len) this.age = this.o.warn; // reuse age as the fade clock
    } else if (this.age - this.o.warn >= 0.25) this.dead = true;
  }

  override draw(r: Renderer): void {
    let alpha: number;
    if (this.age < this.o.warn) alpha = 0.15 + 0.5 * clamp(this.age / this.o.warn, 0, 1) * (Math.floor(this.age * 12) % 2 ? 1 : 0.7);
    else if (this.done) alpha = 0.6 * clamp(1 - (this.age - this.o.warn) / 0.25, 0, 1);
    else alpha = 0.78;
    r.shadow(this.x, this.y + 2, 20, 6, 0.2 * alpha);
    r.sprite(this.frameName(), this.x, this.y, { alpha, tint: ROSE[3], tintAmount: 0.5, flipX: Math.cos(this.angle) < 0 });
    if (this.age < this.o.warn) r.ring(this.x, this.y, 10 + Math.sin(this.age * 10) * 2, ROSE[3], 1, 0.6 * alpha);
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 16, 30, '#ff70a8', { intensity: this.dashing ? 0.8 : 0.4 });
  }
}

/** A rose copy of the dancer (shared look of every clone and afterimage). */
function drawClone(r: Renderer, frame: string, x: number, y: number, alpha: number, flipX = false, tint: string = ROSE[3]): void {
  r.shadow(x, y + 2, 20, 6, 0.2 * alpha);
  r.sprite(frame, x, y, { alpha, tint, tintAmount: 0.5, flipX });
}

/** Fade-in flicker of a clone that is not dangerous yet (0.15..0.65). */
function fadeIn(age: number, warn: number): number {
  return 0.15 + 0.5 * clamp(age / warn, 0, 1) * (Math.floor(age * 12) % 2 ? 1 : 0.7);
}

/** One rose petal from (x, y) at `angle`, fired in the dancer's name (her shots die with her). */
function petal(boss: Enemy, w: World, x: number, y: number, angle: number, speed: number): void {
  if (!boss.alive) return;
  const pr = boss.shoot(w, angle, bullet7('rose', 3, { speed, z: 5 }));
  pr.x = x + Math.cos(angle) * 6;
  pr.y = y - 6 + Math.sin(angle) * 4;
}

/** Clamp a clone's feet into the room so its tall sprite stays off the top wall. */
function stageSpot(w: World, x: number, y: number): { x: number; y: number } {
  const r = w.room;
  return { x: clamp(x, r.interiorX + 16, r.interiorX + r.interiorW - 16), y: clamp(y, r.interiorY + 32, r.interiorY + r.interiorH - 12) };
}

/** The keeper the clones dance at (a charm turns her on another target). */
function targetOf(boss: Enemy, w: World): { x: number; y: number } {
  return boss.alive ? boss.target(w) : w.player;
}

interface RondoOpts {
  count: number;
  /** fade-in before the clones can hurt */
  warn: number;
  /** circling time */
  hold: number;
  /** lane telegraph before the collapse */
  aim: number;
  r0: number;
  r1: number;
  /** ring rotation (rad/s, signed) */
  spin: number;
  /** how fast the ring's centre follows the keeper (px/s, well under their walk) */
  drift: number;
  /** a clone tosses petals every `beat` seconds */
  beat: number;
  petalSpeed: number;
  dashSpeed: number;
  p2: boolean;
}

/** The ring is squashed like the floor (and so fits the room's height). */
const RONDO_SQUASH = 0.62;

/** Shared state of one 론도 ring; the first living clone advances it each step. */
interface RondoState {
  boss: Enemy;
  o: RondoOpts;
  cx: number;
  cy: number;
  angle: number;
  rad: number;
  age: number;
  beatT: number;
  beatK: number;
  collapsed: boolean;
  members: RondoDancer[];
}

/**
 * 론도 (분신 윤무): clone dancers fade in on a ring round the keeper and circle them while the
 * ring slowly follows and closes in (on every beat one clone tosses a fan of petals); then each
 * clone collapses through the centre along a telegraphed lane. Leave the ring between two
 * clones before it closes — or stand between the lanes.
 */
class RondoDancer extends Entity {
  s: RondoState;
  i: number;
  lane: { a: number; len: number; travelled: number; struck: boolean } | null = null;
  laneAt = 0;
  private trailT = 0;
  constructor(s: RondoState, i: number) {
    super();
    this.s = s;
    this.i = i;
    this.r = 7;
    this.layer = 1;
    this.tileCollide = false;
    this.team = 'enemy';
    this.enemyHazard = true;
    this.place(null);
  }

  /** Clone `i`'s spot on the ring (the ring is squashed like the floor). */
  private place(w: World | null): void {
    const s = this.s;
    const a = s.angle + (this.i / s.o.count) * TAU;
    const x = s.cx + Math.cos(a) * s.rad;
    const y = s.cy + Math.sin(a) * s.rad * RONDO_SQUASH;
    const p = w ? stageSpot(w, x, y) : { x, y };
    this.x = p.x;
    this.y = p.y;
  }

  get dashing(): boolean {
    return !!this.lane && this.age >= this.laneAt && this.lane.travelled < this.lane.len;
  }

  get done(): boolean {
    return !!this.lane && this.lane.travelled >= this.lane.len;
  }

  override get sortY(): number {
    return this.y + 1;
  }

  frameName(): string {
    const pre = this.s.o.p2 ? 'dancer2' : 'dancer';
    return this.lane ? `${pre}_spin_${Math.floor(this.age * 16) % 4}` : `${pre}_spin_${Math.floor(this.age * 9 + this.i) % 4}`;
  }

  /** The first living clone moves the whole ring (spawn order: deterministic). */
  private advance(w: World, dt: number): void {
    const s = this.s;
    const o = s.o;
    s.age += dt;
    if (s.collapsed) return;
    const t = targetOf(s.boss, w);
    const dx = t.x - s.cx;
    const dy = t.y - s.cy;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      const k = Math.min(d, o.drift * dt) / d;
      s.cx += dx * k;
      s.cy += dy * k;
    }
    s.angle += o.spin * dt;
    s.rad = o.r0 + (o.r1 - o.r0) * clamp((s.age - o.warn) / o.hold, 0, 1);
    if (s.age < o.warn) return;
    s.beatT += dt;
    if (s.beatT >= o.beat) {
      s.beatT -= o.beat;
      const alive = s.members.filter((m) => !m.dead);
      const m = alive[s.beatK % Math.max(1, alive.length)];
      s.beatK++;
      if (m) {
        const a = Math.atan2(t.y - m.y, t.x - m.x);
        for (const da of [-0.24, 0, 0.24]) petal(s.boss, w, m.x, m.y, a + da, o.petalSpeed);
        chime(w, s.beatK, 0.22, o.p2);
      }
    }
    if (s.age >= o.warn + o.hold) {
      // the collapse: every clone shows its lane through the centre, then dashes along it
      s.collapsed = true;
      w.sfx('clockboss_pirouette', { vol: 0.7, pitch: 1.25 });
      for (const m of s.members) {
        if (m.dead) continue;
        const a = Math.atan2(s.cy - m.y, s.cx - m.x);
        const len = Math.max(30, Math.min(s.rad * 2 + 40, beamToWall(w, m.x, m.y, a) - 6));
        m.lane = { a, len, travelled: 0, struck: false };
        m.laneAt = m.age + o.aim;
        laneWarning(w, m.x, m.y, a, len, 16, o.aim, ROSE[2]);
      }
    }
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const s = this.s;
    if (s.members.find((m) => !m.dead) === this) this.advance(w, dt);
    if (!this.lane) {
      this.place(w);
      if (s.age >= s.o.warn) hitPlayerCircle(w, this.x, this.y, 7, 1, NAME, 150);
      return;
    }
    const l = this.lane;
    if (this.age < this.laneAt) return;
    if (l.travelled < l.len) {
      const step = Math.min(s.o.dashSpeed * dt, l.len - l.travelled);
      this.x += Math.cos(l.a) * step;
      this.y += Math.sin(l.a) * step;
      l.travelled += step;
      if (!l.struck && hitPlayerCircle(w, this.x, this.y, 9, 1, NAME, 170)) l.struck = true;
      this.trailT += dt;
      if (this.trailT > 0.045) {
        this.trailT = 0;
        w.spawn(new Afterimage(this.frameName(), this.x, this.y, false, ROSE[3], 0.28));
      }
      if (l.travelled >= l.len) this.laneAt = this.age; // fade clock
    } else if (this.age - this.laneAt >= 0.25) this.dead = true;
  }

  override draw(r: Renderer): void {
    const s = this.s;
    let alpha: number;
    if (s.age < s.o.warn) alpha = fadeIn(s.age, s.o.warn);
    else if (this.done) alpha = 0.6 * clamp(1 - (this.age - this.laneAt) / 0.25, 0, 1);
    else alpha = 0.78;
    // the leader traces the ring on the floor: where the clones will dance
    if (!s.collapsed && s.members.find((m) => !m.dead) === this) {
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * TAU + s.angle * 0.5;
        r.rect(Math.round(s.cx + Math.cos(a) * s.rad), Math.round(s.cy + Math.sin(a) * s.rad * RONDO_SQUASH), 2, 1, ROSE[3], 0.5);
      }
    }
    drawClone(r, this.frameName(), this.x, this.y, alpha, this.lane ? Math.cos(this.lane.a) < 0 : false);
    if (s.age < s.o.warn) r.ring(this.x, this.y, 9 + Math.sin(s.age * 10) * 2, ROSE[3], 1, 0.6 * alpha);
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 16, 26, '#ff70a8', { intensity: this.dashing ? 0.8 : 0.4 });
  }
}

/**
 * 다 카포 (잔상 되감기): a rose echo of the dancer replays her route backwards — every segment
 * of it is telegraphed at once, and each warning lasts until the echo has danced past it.
 * Phase 2: the echo sheds a ring of petals at every turn.
 */
class EchoDancer extends Entity {
  boss: Enemy;
  pts: { x: number; y: number }[];
  warn: number;
  speed: number;
  p2: boolean;
  seg = 0;
  segT = 0;
  finished = false;
  fadeAt = 0;
  struck = false;
  private trailT = 0;
  private echoD = 0;
  private echoN = 0;
  constructor(boss: Enemy, pts: { x: number; y: number }[], warn: number, speed: number, p2: boolean) {
    super();
    this.boss = boss;
    this.pts = pts;
    this.warn = warn;
    this.speed = speed;
    this.p2 = p2;
    this.x = pts[0].x;
    this.y = pts[0].y;
    this.r = 8;
    this.layer = 1;
    this.tileCollide = false;
    this.team = 'enemy';
    this.enemyHazard = true;
  }

  get dashing(): boolean {
    return this.age >= this.warn && !this.finished;
  }

  override get sortY(): number {
    return this.y + 1;
  }

  frameName(): string {
    return `${this.p2 ? 'dancer2' : 'dancer'}_spin_${Math.floor(this.age * 16) % 4}`;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.finished) {
      if (this.age - this.fadeAt >= 0.25) this.dead = true;
      return;
    }
    if (this.age < this.warn) return;
    let step = this.speed * dt;
    // the replay leaves its own afterimages standing (each throws a petal after its flare)
    this.echoD += step;
    if (this.echoD >= (this.p2 ? 44 : 58)) {
      this.echoD = 0;
      w.spawn(new StepEcho(this.boss, this.x, this.y, this.frameName(), 0.7 + (this.echoN++ % 3) * 0.08, true, false, this.p2 ? 82 : 72));
    }
    while (step > 0 && this.seg < this.pts.length - 1) {
      const b = this.pts[this.seg + 1];
      const d = Math.hypot(b.x - this.x, b.y - this.y);
      if (d <= step) {
        this.x = b.x;
        this.y = b.y;
        step -= d;
        this.seg++;
        // a turn of the route: petals in phase 2, a step of the tune either way
        chime(w, this.seg, 0.25, this.p2);
        if (this.p2 && this.seg < this.pts.length - 1) {
          const off = w.rng.range(0, 0.6);
          for (const a of gapRing(6, off, [], 0)) petal(this.boss, w, this.x, this.y, a, 70);
        }
      } else {
        this.x += ((b.x - this.x) / d) * step;
        this.y += ((b.y - this.y) / d) * step;
        step = 0;
      }
    }
    if (!this.struck && hitPlayerCircle(w, this.x, this.y, 9, 1, NAME, 170)) this.struck = true;
    this.trailT += dt;
    if (this.trailT > 0.045) {
      this.trailT = 0;
      w.spawn(new Afterimage(this.frameName(), this.x, this.y, false, ROSE[3], 0.3));
    }
    if (this.seg >= this.pts.length - 1) {
      this.finished = true;
      this.fadeAt = this.age;
    }
  }

  override draw(r: Renderer): void {
    let alpha: number;
    if (this.age < this.warn) alpha = fadeIn(this.age, this.warn);
    else if (this.finished) alpha = 0.6 * clamp(1 - (this.age - this.fadeAt) / 0.25, 0, 1);
    else alpha = 0.8;
    const nx = this.pts[Math.min(this.seg + 1, this.pts.length - 1)];
    drawClone(r, this.frameName(), this.x, this.y, alpha, nx.x < this.x);
    if (this.age < this.warn) r.ring(this.x, this.y, 10 + Math.sin(this.age * 10) * 2, ROSE[3], 1, 0.6 * alpha);
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 16, 30, '#ff70a8', { intensity: this.dashing ? 0.8 : 0.4 });
  }
}

/**
 * 남는 잔상: an afterimage that stays where she spun, still dancing — it blocks the spot for a
 * moment, and with `shot` it flares (telegraph) and throws one petal at the keeper before fading.
 */
class StepEcho extends Entity {
  boss: Enemy;
  frame: string;
  hold: number;
  shot: boolean;
  flipX: boolean;
  speed: number;
  fired = false;
  constructor(boss: Enemy, x: number, y: number, frame: string, hold: number, shot: boolean, flipX: boolean, speed = 80) {
    super();
    this.boss = boss;
    this.speed = speed;
    this.x = x;
    this.y = y;
    this.frame = frame;
    this.hold = hold;
    this.shot = shot;
    this.flipX = flipX;
    this.r = 6;
    this.layer = 1;
    this.tileCollide = false;
    this.team = 'enemy';
    this.enemyHazard = true;
  }

  /** the flare before its petal */
  static readonly FLARE = 0.35;

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.age > 0.12 && this.age < this.hold) hitPlayerCircle(w, this.x, this.y, 6, 1, NAME, 130);
    if (this.shot && !this.fired && this.age >= this.hold) {
      this.fired = true;
      const t = targetOf(this.boss, w);
      petal(this.boss, w, this.x, this.y, Math.atan2(t.y - this.y, t.x - this.x), this.speed);
    }
    if (this.age >= this.hold + 0.22) this.dead = true;
  }

  override draw(r: Renderer): void {
    const flare = this.shot && this.age > this.hold - StepEcho.FLARE && this.age < this.hold;
    const alpha = this.age < this.hold ? (flare ? 0.85 : 0.5) : 0.5 * clamp(1 - (this.age - this.hold) / 0.22, 0, 1);
    drawClone(r, this.frame, this.x, this.y, alpha, this.flipX, flare ? '#ffffff' : ROSE[3]);
    if (flare) r.ring(this.x, this.y - 12, 4 + (this.hold - this.age) * 24, ROSE[4], 1, 0.8);
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 14, 18, '#ff70a8', { intensity: 0.35 });
  }
}

interface TrioOpts {
  warn: number;
  arms: number;
  steps: number;
  stepT: number;
  turn: number;
  speed: number;
  /** phase 2: after the spin, dash once at the keeper */
  dash: boolean;
  p2: boolean;
}

/**
 * 삼인무: a clone that fades in, then spins on the spot shedding its own spiral of petals in
 * time with the dancer's (counter-turning, so the three spirals weave a lattice).
 */
class TrioClone extends Entity {
  boss: Enemy;
  o: TrioOpts;
  base: number;
  k = 0;
  stepT = 0;
  constructor(boss: Enemy, x: number, y: number, base: number, o: TrioOpts) {
    super();
    this.boss = boss;
    this.x = x;
    this.y = y;
    this.base = base;
    this.o = o;
    this.r = 7;
    this.layer = 1;
    this.tileCollide = false;
    this.team = 'enemy';
    this.enemyHazard = true;
  }

  override get sortY(): number {
    return this.y + 1;
  }

  frameName(): string {
    const pre = this.o.p2 ? 'dancer2' : 'dancer';
    return this.age < this.o.warn ? `${pre}_pose_${Math.floor(this.age * 8) % 2}` : `${pre}_spin_${Math.floor(this.age * 14) % 4}`;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const o = this.o;
    if (this.age < o.warn) return;
    hitPlayerCircle(w, this.x, this.y, 7, 1, NAME, 140);
    this.stepT -= dt;
    while (this.stepT <= 0 && this.k < o.steps) {
      this.stepT += o.stepT;
      for (const a of spiralAngles(this.base, o.arms, this.k, o.turn)) {
        if (!this.boss.alive) break;
        const pr = this.boss.shoot(w, a, bullet7('rose', 3, { speed: o.speed, z: 6 }));
        pr.x = this.x + Math.cos(a) * 12;
        pr.y = this.y - 10 + Math.sin(a) * 6;
      }
      this.k++;
    }
    if (this.k >= o.steps) {
      this.dead = true;
      if (o.dash && this.boss.alive) {
        // the clone breaks off its spin and dashes through the keeper
        const t = targetOf(this.boss, w);
        const a = Math.atan2(t.y - this.y, t.x - this.x);
        const len = Math.min(230, beamToWall(w, this.x, this.y, a) - 8);
        const warn = 0.55;
        laneWarning(w, this.x, this.y, a, len, 18, warn, ROSE[2]);
        w.spawn(new GhostDancer(this.x, this.y, a, { source: NAME, warn, speed: 300, len, damage: 1, p2: o.p2 }));
      } else {
        w.spawn(new Afterimage(this.frameName(), this.x, this.y, false, ROSE[3], 0.3));
      }
    }
  }

  override draw(r: Renderer): void {
    const alpha = this.age < this.o.warn ? fadeIn(this.age, this.o.warn) : 0.8;
    drawClone(r, this.frameName(), this.x, this.y, alpha);
    if (this.age < this.o.warn) r.ring(this.x, this.y - 12, 16 - 8 * clamp(this.age / this.o.warn, 0, 1), ROSE[3], 1, 0.7);
    else {
      r.ring(this.x, this.y - 16, 17 + Math.sin(this.age * 20) * 1.5, ROSE[3], 2, 0.3);
    }
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 16, 28, '#ff70a8', { intensity: 0.5 });
  }
}

/**
 * 커튼콜 clone: poses at the edge of the stage until its cue, then locks onto the keeper
 * (lane telegraph) and becomes a dashing ghost dancer.
 */
class CueClone extends Entity {
  cue: number;
  lead: number;
  boss: Enemy;
  p2: boolean;
  constructor(boss: Enemy, x: number, y: number, cue: number, lead: number, p2: boolean) {
    super();
    this.boss = boss;
    this.x = x;
    this.y = y;
    this.cue = cue;
    this.lead = lead;
    this.p2 = p2;
    this.r = 7;
    this.layer = 1;
    this.tileCollide = false;
    this.team = 'enemy';
    this.enemyHazard = true;
  }

  override get sortY(): number {
    return this.y + 1;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.age < this.cue - this.lead) return;
    this.dead = true;
    if (!this.boss.alive) return;
    const t = targetOf(this.boss, w);
    const a = Math.atan2(t.y - this.y, t.x - this.x);
    const len = Math.min(300, beamToWall(w, this.x, this.y, a) - 8);
    laneWarning(w, this.x, this.y, a, len, 18, this.lead, ROSE[2]);
    w.spawn(new GhostDancer(this.x, this.y, a, { source: NAME, warn: this.lead, speed: 320, len, damage: 1, p2: this.p2 }));
  }

  override draw(r: Renderer): void {
    const pre = this.p2 ? 'dancer2' : 'dancer';
    const near = this.age > this.cue - this.lead - 0.4;
    drawClone(r, `${pre}_pose_${Math.floor(this.age * 6) % 2}`, this.x, this.y, near ? 0.75 : fadeIn(this.age, 0.6), false);
    if (near) r.ring(this.x, this.y - 12, 6 + Math.sin(this.age * 14) * 2, ROSE[4], 1, 0.8);
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 16, 22, '#ff70a8', { intensity: 0.35 });
  }
}

/**
 * 주테 분신: the clone that follows her grand jeté — it waits where she took off, then leaps
 * onto the keeper's spot (ground warning for the whole flight) with its own gapped shock ring.
 */
class LeapEcho extends Entity {
  boss: Enemy;
  delay: number;
  flight: number;
  p2: boolean;
  fromX: number;
  fromY: number;
  toX = 0;
  toY = 0;
  launched = false;
  landedAt = -1;
  constructor(boss: Enemy, x: number, y: number, delay: number, flight: number, p2: boolean) {
    super();
    this.boss = boss;
    this.x = this.fromX = x;
    this.y = this.fromY = y;
    this.delay = delay;
    this.flight = flight;
    this.p2 = p2;
    this.r = 8;
    this.layer = 1;
    this.tileCollide = false;
    this.team = 'enemy';
    this.enemyHazard = true;
  }

  override get sortY(): number {
    return this.y + 1;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.landedAt >= 0) {
      if (this.age - this.landedAt > 0.25) this.dead = true;
      return;
    }
    if (this.age < this.delay) return;
    if (!this.launched) {
      this.launched = true;
      const t = targetOf(this.boss, w);
      const s = inRoom(w, t.x, t.y, 20);
      this.toX = s.x;
      this.toY = s.y;
      w.spawn(new GroundWarning(s.x, s.y, 26, this.flight, undefined, ROSE[2]));
      w.sfx('clockboss_pirouette', { vol: 0.45, pitch: 0.9 });
    }
    const k = clamp((this.age - this.delay) / this.flight, 0, 1);
    this.x = this.fromX + (this.toX - this.fromX) * k;
    this.y = this.fromY + (this.toY - this.fromY) * k;
    this.z = Math.sin(k * Math.PI) * 64;
    if (k >= 1) {
      this.z = 0;
      this.landedAt = this.age;
      w.sfx('clockboss_gear', { vol: 0.6, pitch: 1.2 });
      w.shake(0.2);
      hitPlayerCircle(w, this.x, this.y, 22, 1, NAME, 170);
      porcelainShards(w, this.x, this.y, 6, 70);
      const g = Math.atan2(w.player.y - this.y, w.player.x - this.x) + w.rng.range(-0.4, 0.4);
      w.spawn(new ShockRing(this.x, this.y + 2, { speed: 125, maxR: 120, color: ROSE[2], gaps: [g + Math.PI / 2, g - Math.PI / 2], gapWidth: 1.1, damage: 1, source: NAME, thick: 4, debris: ROSE_FX }));
    }
  }

  override draw(r: Renderer): void {
    const pre = this.p2 ? 'dancer2' : 'dancer';
    let alpha: number;
    let frame: string;
    if (this.landedAt >= 0) {
      alpha = 0.6 * clamp(1 - (this.age - this.landedAt) / 0.25, 0, 1);
      frame = `${pre}_idle_0`;
    } else if (!this.launched) {
      alpha = fadeIn(this.age, this.delay);
      frame = `${pre}_pose_${Math.floor(this.age * 8) % 2}`;
    } else {
      alpha = 0.8;
      frame = `${pre}_leap_0`;
    }
    const k = Math.min(0.6, this.z / 70);
    r.shadow(this.x, this.y + 2, 20 * (1 - k), 6 * (1 - k), 0.2 * alpha);
    r.sprite(frame, this.x, this.y - this.z, { alpha, tint: ROSE[3], tintAmount: 0.5, flipX: this.toX < this.fromX });
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - this.z - 16, 26, '#ff70a8', { intensity: 0.45 });
  }
}

/** Projectile behavior: the shot's curve flips sign every `every` seconds — a ribbon rippling through the air. */
function ribbonWave(every: number, curve: number): ProjBehavior {
  return {
    id: 'ribbon',
    update(p, _w, dt) {
      p.mem.rbT = (p.mem.rbT ?? 0) + dt;
      const k = Math.floor(p.mem.rbT / every);
      p.curve = (k % 2 === 0 ? 1 : -1) * curve * (p.mem.rbS ?? 1);
    },
    draw(p, r) {
      const c = Math.cos(p.angle);
      const s = Math.sin(p.angle);
      for (let i = 1; i <= 3; i++) r.sprite(p.sprite!, p.x - c * i * 5, p.y - p.z - s * i * 5, { alpha: 0.35 - i * 0.1 });
    },
  };
}

// ------------------------------------------------------------------ behaviour
function anim(e: Enemy, state: string, restart = false): void {
  e.setAnim(`${e.mem.p2 ? 'dancer2' : 'dancer'}_${state}`, restart);
}

/** tempo factor: phase 2 dances faster */
function tempo(e: Enemy): number {
  return e.mem.p2 ? 0.8 : 1;
}

/** Floor 7 keeps up the pressure: the pause after a figure, shortened (shorter still in phase 2). */
function recover(e: Enemy, t: number): number {
  return t * (e.mem.p2 ? 0.35 : 0.5);
}

function chime(w: World, step: number, vol = 0.4, detuned = false): void {
  const notes = [0, 4, 7, 12, 7, 4];
  w.sfx('clockboss_chime', { vol, pitch: Math.pow(2, notes[step % notes.length] / 12) * (detuned ? 0.955 : 1) });
}

/** Glide round the keeper on a wide arc, facing them, like a dancer circling the stage. */
function* glide(e: Enemy, w: World, time: number): Script {
  anim(e, 'idle');
  const room = w.room;
  const side = e.mem.side ?? 1;
  for (let el = 0; el < time; el += w.dt) {
    const t = e.target(w);
    const a = Math.atan2(e.y - t.y, e.x - t.x) + side * 1.2 * w.dt;
    const gx = clamp(t.x + Math.cos(a) * 88, room.interiorX + 22, room.interiorX + room.interiorW - 22);
    const gy = clamp(t.y + Math.sin(a) * 64, room.interiorY + 22, room.interiorY + room.interiorH - 22);
    const d = Math.hypot(gx - e.x, gy - e.y);
    e.moveDir(gx - e.x, gy - e.y, Math.min(e.speed * (e.mem.p2 ? 1.25 : 1), d * 2.5));
    yield;
  }
  e.stop();
  if (w.rng.chance(0.35)) e.mem.side = -side;
}

/** Distance between the afterimages a pirouette leaves standing (px). */
const ECHO_STEP = 36;

/**
 * Spin-dash along a lane toward `angle` for `len` px, trailing afterimages. With `echoes`
 * some of them stay behind on the lane (남는 잔상): they block it for a moment, and in phase 2
 * each one flares and throws a petal at the keeper.
 */
function* spinDash(e: Enemy, w: World, angle: number, len: number, speed: number, echoes = false): Script {
  anim(e, 'spin', true);
  e.mem.spinning = 1;
  w.sfx('clockboss_pirouette', { vol: 0.8, pitch: 1 + (e.mem.p2 ? 0.1 : 0) });
  const time = len / speed;
  let trail = 0;
  let sx = e.x;
  let sy = e.y;
  let n = 0;
  const sub = e.charge(w, angle, speed, time);
  while (!sub.next().done) {
    trail += w.dt;
    if (trail > 0.04) {
      trail = 0;
      w.spawn(new Afterimage(e.frame(), e.x, e.y, e.facing < 0, ROSE[3], 0.28));
    }
    if (echoes && Math.hypot(e.x - sx, e.y - sy) >= ECHO_STEP) {
      sx = e.x;
      sy = e.y;
      const p2 = !!e.mem.p2;
      w.spawn(new StepEcho(e, e.x, e.y, e.frame(), (p2 ? 0.7 : 0.75) + n * 0.06, true, e.facing < 0, p2 ? 84 : 72));
      n++;
    }
    yield;
  }
  e.halt();
  e.mem.spinning = 0;
}

/** 피루엣 돌진: lane telegraphs, then spinning dashes at the keeper (phase 2: ghosts mirror each one). */
function* pirouette(e: Enemy, w: World, ghosts = false): Script {
  const p2 = !!e.mem.p2;
  const T = tempo(e);
  const n = p2 ? 3 : 2;
  for (let k = 0; k < n; k++) {
    e.halt();
    anim(e, 'pose', true);
    const t = e.target(w);
    const a = Math.atan2(t.y - e.y, t.x - e.x);
    const len = Math.min(190, Math.max(60, beamToWall(w, e.x, e.y, a) - 12));
    const warn = 0.6 * T;
    e.telegraph(warn);
    laneWarning(w, e.x, e.y, a, len, 20, warn, ROSE[3]);
    chime(w, k, 0.45, p2);
    if (ghosts) {
      // ghosts take the mirrored lane through the keeper from the far side
      for (const sd of [-1, 1]) {
        const ga = a + Math.PI / 2 * sd;
        const sx = t.x + Math.cos(ga) * 110;
        const sy = t.y + Math.sin(ga) * 80;
        const s = inRoom(w, sx, sy, 16);
        const da = Math.atan2(t.y - s.y, t.x - s.x);
        const glen = Math.min(220, beamToWall(w, s.x, s.y, da) - 8);
        laneWarning(w, s.x, s.y, da, glen, 18, warn + 0.15, ROSE[2]);
        w.spawn(new GhostDancer(s.x, s.y, da, { source: NAME, warn: warn + 0.15, speed: 300, len: glen, damage: 1, p2 }));
      }
    }
    yield warn;
    yield* spinDash(e, w, a, len, p2 ? 340 : 310, true);
    if (p2) {
      // a burst of petals where she stops
      for (const b of gapRing(8, w.rng.range(0, 0.4), [], 0)) e.shoot(w, b, bullet7('rose', 3, { speed: 76 }));
      w.sfx('enemy_shoot', { vol: 0.35, pitch: 1.4 });
    }
    yield 0.22 * T;
  }
  anim(e, 'idle');
  yield recover(e, 0.5);
}

/** 회전 치마: she pirouettes in place and the skirt sheds a spiral of rose shots. */
function* skirt(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  const T = tempo(e);
  e.halt();
  anim(e, 'pose', true);
  e.telegraph(0.55 * T);
  w.sfx('clockboss_box', { vol: 0.5, pitch: 1.2 });
  gather(w, e.x, e.y - 16, ROSE_FX, 10, 26);
  yield 0.55 * T;
  anim(e, 'spin', true);
  e.mem.spinning = 1;
  const arms = p2 ? 4 : 3;
  const steps = p2 ? 30 : 26;
  const dir = w.rng.sign();
  const base = w.rng.angle();
  for (let k = 0; k < steps; k++) {
    for (const a of spiralAngles(base, arms, k, dir * 0.24)) {
      const pr = e.shoot(w, a, bullet7('rose', 3, { speed: p2 ? 84 : 76, z: 6 }));
      pr.x = e.x + Math.cos(a) * 13;
      pr.y = e.y - 10 + Math.sin(a) * 6;
    }
    if (k % 4 === 0) chime(w, k / 4, 0.3, p2);
    // she drifts toward the keeper while spinning so the spiral's eye moves
    const t = e.target(w);
    e.moveDir(t.x - e.x, t.y - e.y, 26);
    yield 0.095 * T;
  }
  e.halt();
  e.mem.spinning = 0;
  anim(e, 'idle');
  yield recover(e, 0.7);
}

/** 실린더 핀: a row of pins appears along a wall, holds, then marches across in unison — one gap. */
function* pins(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  const T = tempo(e);
  const room = w.room;
  e.halt();
  anim(e, 'pose', true);
  e.telegraph(0.5 * T);
  w.sfx('clockboss_box', { vol: 0.8, pitch: 0.9 });
  yield 0.5 * T;
  const rows = p2 ? 2 : 1;
  const t = e.target(w);
  // the first row comes from the wall behind the keeper, the second from the opposite one
  const fromTop = t.y < room.centerY;
  for (let r = 0; r < rows; r++) {
    const top = r === 0 ? fromTop : !fromTop;
    const y = top ? room.interiorY + 10 : room.interiorY + room.interiorH - 10;
    const n = clamp(Math.round(room.interiorW / 20), 10, 20);
    const gapW = 3;
    // the gap sits a little off the keeper: not a free pass, a place to reach
    const px = w.player.x + w.rng.range(-70, 70);
    const gap = gapSlotFor(room.interiorX + 12, room.interiorX + room.interiorW - 12, n, gapW, px);
    const hold = (0.95 + r * 0.45) * T;
    for (const s of rowWithGap(room.interiorX + 12, room.interiorX + room.interiorW - 12, y, n, gap, gapW)) {
      const pr = e.shoot(w, top ? Math.PI / 2 : -Math.PI / 2, {
        ...bullet7('brass', 3, { speed: p2 ? 80 : 72, delay: hold, life: 9, range: 600 }), sprite: 'dancer_pin', spriteRotates: false, z: 4,
      });
      pr.x = s.x;
      pr.y = s.y;
    }
    for (let k = 0; k < 4; k++) chime(w, k, 0.25, p2);
    yield 0.25 * T;
  }
  anim(e, 'idle');
  // the pins march on their own while she starts the next figure
  yield recover(e, 1.0);
}

/** 거울 무희: ghost dancers appear on opposite sides of the keeper and dash through their spot. */
function* mirrors(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  const T = tempo(e);
  e.halt();
  anim(e, 'pose', true);
  e.telegraph(0.5 * T);
  w.sfx('clockboss_box', { vol: 0.5, pitch: 1.4 });
  yield 0.4 * T;
  const t = e.target(w);
  const pairs = p2 ? 2 : 1;
  const a0 = w.rng.angle();
  for (let k = 0; k < pairs; k++) {
    const warn = 0.75 * T;
    for (const sd of [0, Math.PI]) {
      const ga = a0 + sd + (k * Math.PI) / 2;
      const s = inRoom(w, t.x + Math.cos(ga) * 120, t.y + Math.sin(ga) * 86, 16);
      const da = Math.atan2(t.y - s.y, t.x - s.x);
      const len = Math.min(240, beamToWall(w, s.x, s.y, da) - 8);
      laneWarning(w, s.x, s.y, da, len, 18, warn, ROSE[2]);
      w.spawn(new GhostDancer(s.x, s.y, da, { source: NAME, warn, speed: 290, len, damage: 1, p2 }));
    }
    chime(w, k * 2, 0.4, p2);
    w.sfx('warn', { vol: 0.3, pitch: 1.2 });
    yield 0.3 * T;
  }
  anim(e, 'idle');
  // the ghosts dash on their own while she goes on dancing
  yield recover(e, 0.9);
}

/** 그랑 주테: a leap onto the keeper — gapped shock ring and a burst of petals on landing. */
function* leap(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  const T = tempo(e);
  const jumps = p2 ? 2 : 1;
  for (let k = 0; k < jumps; k++) {
    e.halt();
    anim(e, 'pose', true);
    e.telegraph(0.3 * T);
    w.sfx('clockboss_pirouette', { vol: 0.6, pitch: 0.8 });
    yield 0.3 * T;
    const t = e.target(w);
    // lead the keeper a little (a charmed target has no velocity to lead)
    const lead = t === w.player ? 0.25 : 0;
    const s = inRoom(w, t.x + w.player.vx * lead, t.y + w.player.vy * lead, 20);
    const flight = 0.85 * T;
    w.spawn(new GroundWarning(s.x, s.y, 26, flight));
    // 듀엣: a clone waits where she took off and leaps after her onto the keeper's new spot
    w.spawn(new LeapEcho(e, e.x, e.y, flight + 0.15 * T, 0.7 * T, p2));
    anim(e, 'leap', true);
    yield* e.jumpTo(w, s.x, s.y, flight, 74);
    anim(e, 'idle', true);
    w.sfx('clockboss_gear', { vol: 0.9, pitch: 1.0 });
    w.shake(0.4);
    w.hitstop(0.03);
    hitPlayerCircle(w, e.x, e.y, 24, 1, NAME, 180);
    porcelainShards(w, e.x, e.y, 10, 90);
    const g = Math.atan2(w.player.y - e.y, w.player.x - e.x) + w.rng.range(-0.4, 0.4);
    w.spawn(new ShockRing(e.x, e.y + 2, { speed: 135, maxR: 150, color: ROSE[3], gaps: [g, g + Math.PI], gapWidth: 1.0, damage: 1, source: NAME, thick: 5, debris: ROSE_FX }));
    const n = p2 ? 12 : 8;
    for (const a of gapRing(n, w.rng.range(0, 0.5), [], 0)) {
      const pr = e.shoot(w, a, bullet7('rose', 3, { speed: 92, z: 5 }));
      pr.x = e.x + Math.cos(a) * 10;
      pr.y = e.y - 4 + Math.sin(a) * 6;
    }
    w.sfx('enemy_shoot', { vol: 0.4, pitch: 1.1 });
    yield 0.5 * T;
  }
  yield recover(e, 0.5);
}

/** 리본: two (three) serpentine ribbons of shots stream from her hands toward the keeper. */
function* ribbons(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  const T = tempo(e);
  e.halt();
  anim(e, 'pose', true);
  e.telegraph(0.5 * T);
  w.sfx('clockboss_pirouette', { vol: 0.5, pitch: 1.3 });
  yield 0.5 * T;
  anim(e, 'spin', true);
  e.mem.spinning = 1;
  const streams = p2 ? 3 : 2;
  const perStream = p2 ? 13 : 11;
  for (let i = 0; i < perStream; i++) {
    const t = e.target(w);
    const base = Math.atan2(t.y - 4 - e.y, t.x - e.x);
    for (let s = 0; s < streams; s++) {
      const off = (s - (streams - 1) / 2) * 0.28;
      const pr = e.shoot(w, base + off, bullet7('rose', 3, { speed: 98, life: 7, range: 700, behaviors: [ribbonWave(0.3, 1.9)] }));
      pr.mem.rbS = s % 2 ? -1 : 1;
      pr.mem.rbT = i * 0.05;
      pr.x = e.x + Math.cos(base + off) * 8 + (s % 2 ? 6 : -6);
      pr.y = e.y - 18 + Math.sin(base + off) * 4;
    }
    if (i % 3 === 0) chime(w, i / 3 + 2, 0.3, p2);
    yield 0.11 * T;
  }
  e.mem.spinning = 0;
  anim(e, 'idle');
  yield recover(e, 1.1);
}

/** Is any clone of hers still dancing (rondo ring, echo, trio, curtain clones, ghosts)? */
function clonesLive(w: World): boolean {
  return w.entities.some((x) => !x.dead && (x instanceof GhostDancer || x instanceof RondoDancer || x instanceof EchoDancer || x instanceof TrioClone || x instanceof CueClone));
}

/** 론도: she raises her arms and her clones take a ring round the keeper (see RondoDancer); she dances on meanwhile. */
function* rondo(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  const T = tempo(e);
  e.halt();
  anim(e, 'pose', true);
  e.telegraph(0.45 * T);
  w.sfx('clockboss_box', { vol: 0.6, pitch: 1.5 });
  yield 0.45 * T;
  const t = e.target(w);
  const o: RondoOpts = {
    count: p2 ? 7 : 5, warn: 0.75, hold: p2 ? 3.3 : 3.0, aim: 0.6 * T, r0: 104, r1: p2 ? 56 : 62,
    spin: w.rng.sign() * (p2 ? 1.0 : 0.85), drift: p2 ? 38 : 30, beat: p2 ? 0.42 : 0.5, petalSpeed: p2 ? 80 : 74, dashSpeed: p2 ? 340 : 320, p2,
  };
  const s: RondoState = { boss: e, o, cx: t.x, cy: t.y, angle: w.rng.angle(), rad: o.r0, age: 0, beatT: 0, beatK: 0, collapsed: false, members: [] };
  for (let i = 0; i < o.count; i++) s.members.push(w.spawn(new RondoDancer(s, i)));
  for (let k = 0; k < 3; k++) chime(w, k * 2, 0.3, p2);
  anim(e, 'idle');
  // the ring dances on its own while she starts her next figure
  yield recover(e, 0.6);
}

/**
 * 다 카포: three (four) quick pirouette dashes at the keeper; then the music box replays the
 * whole route backwards as a rose echo of her (see EchoDancer) while she goes on.
 */
function* dacapo(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  const T = tempo(e);
  const n = p2 ? 4 : 3;
  const route: { x: number; y: number }[] = [{ x: e.x, y: e.y }];
  for (let k = 0; k < n; k++) {
    e.halt();
    anim(e, 'pose', true);
    const t = e.target(w);
    const a = Math.atan2(t.y - e.y, t.x - e.x) + w.rng.range(-0.25, 0.25);
    const len = Math.min(150, Math.max(50, beamToWall(w, e.x, e.y, a) - 14));
    const warn = 0.5 * T;
    e.telegraph(warn);
    laneWarning(w, e.x, e.y, a, len, 20, warn, ROSE[3]);
    chime(w, k, 0.4, p2);
    yield warn;
    yield* spinDash(e, w, a, len, p2 ? 360 : 330);
    route.push({ x: e.x, y: e.y });
    yield 0.12 * T;
  }
  anim(e, 'pose', true);
  // da capo: the echo dances the route from her last step back to her first
  const pts = route.reverse();
  const warn = 0.75;
  const speed = p2 ? 320 : 290;
  let at = warn;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < 4) continue;
    at += d / speed;
    laneWarning(w, a.x, a.y, Math.atan2(b.y - a.y, b.x - a.x), d, 18, at, ROSE[2]);
  }
  w.spawn(new EchoDancer(e, pts, warn, speed, p2));
  w.sfx('clockboss_detune', { vol: 0.5, pitch: 1.3 });
  for (let k = 0; k < 4; k++) chime(w, 5 - k, 0.28, p2);
  yield 0.3 * T;
  anim(e, 'idle');
  yield recover(e, 0.5);
}

/**
 * 삼인무: two clones step out to make a triangle round the keeper with her, and all three
 * spin their skirts at once — counter-turning spirals that weave a lattice. Phase 2: when the
 * spin ends the clones dash through the keeper.
 */
function* trio(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  const T = tempo(e);
  e.halt();
  anim(e, 'pose', true);
  const t = e.target(w);
  const a0 = Math.atan2(e.y - t.y, e.x - t.x);
  const dist = clamp(Math.hypot(e.x - t.x, e.y - t.y), 80, 112);
  const warn = 0.75 * T;
  const steps = p2 ? 24 : 22;
  const stepT = 0.11 * T;
  const dir = w.rng.sign();
  for (const sd of [-1, 1]) {
    const a = a0 + (sd * TAU) / 3;
    const s = stageSpot(w, t.x + Math.cos(a) * dist, t.y + Math.sin(a) * dist * 0.8);
    w.spawn(new GroundWarning(s.x, s.y, 16, warn, undefined, ROSE[2]));
    w.spawn(new TrioClone(e, s.x, s.y, w.rng.angle(), { warn, arms: 2, steps, stepT, turn: -dir * 0.26, speed: p2 ? 72 : 66, dash: p2, p2 }));
  }
  e.telegraph(warn);
  w.sfx('clockboss_box', { vol: 0.6, pitch: 1.1 });
  gather(w, e.x, e.y - 16, ROSE_FX, 10, 26);
  yield warn;
  anim(e, 'spin', true);
  e.mem.spinning = 1;
  const arms = p2 ? 3 : 2;
  const base = w.rng.angle();
  for (let k = 0; k < steps; k++) {
    for (const a of spiralAngles(base, arms, k, dir * 0.26)) {
      const pr = e.shoot(w, a, bullet7('rose', 3, { speed: p2 ? 76 : 70, z: 6 }));
      pr.x = e.x + Math.cos(a) * 13;
      pr.y = e.y - 10 + Math.sin(a) * 6;
    }
    if (k % 4 === 0) chime(w, k / 4, 0.3, p2);
    yield stepT;
  }
  e.mem.spinning = 0;
  anim(e, 'idle');
  yield recover(e, 0.8);
}

/** HP share under which the one-time 커튼콜 plays (phase 2). */
const CURTAIN_HP = 0.3;

/**
 * 커튼콜 (once, phase 2 under 30% HP): she leaps to the middle of the stage and spins a slow
 * spiral while six clones pose round its edge and, cue by cue, dash through the keeper.
 */
function* curtainCall(e: Enemy, w: World): Script {
  const T = tempo(e);
  const room = w.room;
  e.halt();
  anim(e, 'pose', true);
  e.telegraph(0.5);
  w.banner('커튼콜', '무희의 분신들이 차례로 무대를 가로지른다', { color: ROSE[3], small: true });
  w.sfx('clockboss_detune', { vol: 0.9, pitch: 1.1 });
  yield 0.5;
  const c = inRoom(w, room.centerX, room.centerY, 30);
  w.spawn(new GroundWarning(c.x, c.y, 24, 0.7));
  anim(e, 'leap', true);
  yield* e.jumpTo(w, c.x, c.y, 0.7, 70);
  anim(e, 'idle', true);
  w.sfx('clockboss_gear', { vol: 0.8, pitch: 1.1 });
  hitPlayerCircle(w, e.x, e.y, 22, 1, NAME, 170);
  porcelainShards(w, e.x, e.y, 10, 90);
  // six clones round the edge of the stage; cues alternate across it
  const rx = room.interiorW / 2 - 22;
  const ry = room.interiorH / 2 - 18;
  const off = w.rng.angle();
  const spots = [0, 1, 2, 3, 4, 5].map((i) => stageSpot(w, c.x + Math.cos(off + (i / 6) * TAU) * rx, c.y + Math.sin(off + (i / 6) * TAU) * ry));
  const order = [0, 3, 1, 4, 2, 5, 0, 3, 1, 4];
  const lead = 0.6;
  const gap = 0.42 * T;
  for (let k = 0; k < order.length; k++) {
    const s = spots[order[k]];
    w.spawn(new CueClone(e, s.x, s.y, 0.9 + k * gap, lead, true));
  }
  // she spins a slow two-armed spiral in the middle through the whole call
  anim(e, 'spin', true);
  e.mem.spinning = 1;
  const steps = Math.round((0.9 + order.length * gap + 0.4) / 0.14);
  const base = w.rng.angle();
  const dir = w.rng.sign();
  for (let k = 0; k < steps; k++) {
    for (const a of spiralAngles(base, 2, k, dir * 0.3)) {
      const pr = e.shoot(w, a, bullet7('rose', 3, { speed: 62, z: 6 }));
      pr.x = e.x + Math.cos(a) * 13;
      pr.y = e.y - 10 + Math.sin(a) * 6;
    }
    if (k % 3 === 0) chime(w, k / 3, 0.3, true);
    yield 0.14;
  }
  e.mem.spinning = 0;
  anim(e, 'idle');
  yield recover(e, 0.8);
}

function* phaseTwo(e: Enemy, w: World): Script {
  yield* phaseShift(e, w, {
    anim: 'dancer_hurt',
    color: ROSE[3],
    time: 1.8,
    onPeak: () => {
      e.mem.p2 = true;
      anim(e, 'spin', true);
      w.sfx('clockboss_shatter', { vol: 1, pitch: 0.9 });
      w.sfx('clockboss_detune', { vol: 0.9, pitch: 1.0 });
      // the porcelain cracks: shards fly, the works glow through
      porcelainShards(w, e.x, e.y - 20, 36, 160);
      w.particles.burst(e.x, e.y - 20, { count: 24, speed: [20, 110], life: [0.5, 1.1], colors: [AMBER[4], AMBER[3], ROSE[3]], size: [1, 2], additive: true, light: 5, gravity: -40 });
      const g = w.rng.angle();
      for (const a of gapRing(14, 0, [g, g + Math.PI], 1.0)) {
        const pr = e.shoot(w, a, bullet7('rose', 3, { speed: 88, z: 6 }));
        pr.x = e.x + Math.cos(a) * 12;
        pr.y = e.y - 10 + Math.sin(a) * 6;
      }
    },
  });
  if (!e.mem.taught) {
    e.mem.taught = 1;
    w.banner('음악상자가 어긋난다', '박자가 빨라지고, 분신들이 쉬지 않고 함께 춤춘다', { color: ROSE[3], small: true });
  }
}

function* patterns(e: Enemy, w: World): Script {
  while (true) {
    const p2 = !!e.mem.p2;
    if (p2 && !e.mem.curtain && e.hp <= e.maxHp * CURTAIN_HP) {
      e.mem.curtain = 1;
      e.mem.last = 'curtain';
      yield* curtainCall(e, w);
      continue;
    }
    const ghosts = w.entities.some((x) => x instanceof GhostDancer && !x.dead);
    const live = (cls: abstract new (...a: never[]) => unknown) => w.entities.some((x) => x instanceof cls && !x.dead);
    // one clone figure at a time in phase 1; once cracked she layers them (each kind once)
    const clones = clonesLive(w);
    const free = (cls: abstract new (...a: never[]) => unknown) => (p2 ? !live(cls) : !clones);
    const near = e.distToTarget(w) < 110;
    const id = pickBossPattern(e, w, [
      { id: 'pirouette', w: 2.6 },
      { id: 'skirt', w: 1.6 },
      { id: 'pins', w: 2.0 },
      { id: 'mirrors', w: 1.8, when: !ghosts },
      { id: 'leap', w: near ? 1.4 : 2.2 },
      { id: 'ribbons', w: 1.8 },
      { id: 'rondo', w: 2.8, when: free(RondoDancer) },
      { id: 'dacapo', w: 2.4, when: free(EchoDancer) },
      { id: 'trio', w: 2.2, when: free(TrioClone) },
      { id: 'waltz', w: 2.6, when: p2 && !ghosts },
    ], e.mem.last as string | null);
    e.mem.last = id;
    if (id === 'pirouette') yield* pirouette(e, w, false);
    else if (id === 'skirt') yield* skirt(e, w);
    else if (id === 'pins') yield* pins(e, w);
    else if (id === 'mirrors') yield* mirrors(e, w);
    else if (id === 'leap') yield* leap(e, w);
    else if (id === 'ribbons') yield* ribbons(e, w);
    else if (id === 'rondo') yield* rondo(e, w);
    else if (id === 'dacapo') yield* dacapo(e, w);
    else if (id === 'trio') yield* trio(e, w);
    else yield* pirouette(e, w, true);
    // encore: now and then she runs straight into the next figure (more often once cracked)
    if (w.rng.chance(p2 ? 0.35 : 0.15)) continue;
    yield* glide(e, w, p2 ? w.rng.range(0.2, 0.32) : w.rng.range(0.28, 0.45));
  }
}

/** Everything she had in the air goes with her. */
function clearArena(w: World): void {
  clearEnemyShots(w);
  for (const x of w.entities) {
    if (x.dead) continue;
    if (x instanceof GroundWarning || x instanceof GhostDancer || x instanceof ShockRing || x instanceof RondoDancer || x instanceof EchoDancer
      || x instanceof StepEcho || x instanceof TrioClone || x instanceof CueClone || x instanceof LeapEcho) x.dead = true;
  }
}

// ------------------------------------------------------------------ definition
defineBoss({
  id: 'clockwork_dancer',
  name: NAME,
  bossTitle: '음악상자 위의 도자기 무희',
  bossFloors: [7],
  bossMusic: 'boss_clockwork',
  hp: 970,
  radius: 10,
  speed: 72,
  mass: 4,
  sprite: 'dancer_idle',
  portrait: 'dancer_portrait',
  shadow: 0,
  deathFx: 'metal',
  bloodColor: '#e4dccc',
  contactDamage: 1,
  hurtSfx: 'hit',
  light: { radius: 60, color: '#ffb0c8' },
  init(e) {
    e.mem.last = null;
    e.mem.side = 1;
    e.mem.spinning = 0;
    // every attack by name (debug console / screenshot tooling: `e.script.set(e.mem.attacks.skirt(e, w))`)
    e.mem.attacks = {
      pirouette: (b: Enemy, ww: World) => pirouette(b, ww, false), skirt, pins, mirrors, leap, ribbons, waltz: (b: Enemy, ww: World) => pirouette(b, ww, true),
      rondo, dacapo, trio, curtain: curtainCall, patterns,
    } satisfies Record<string, (b: Enemy, ww: World) => Script>;
  },
  *script(e, w) {
    anim(e, 'idle');
    yield 0.4;
    yield* patterns(e, w);
  },
  update(e, w, dt) {
    phaseGate(e, 0.5, 1, function* () {
      yield* phaseTwo(e, w);
      phaseDone(e);
      yield* pirouette(e, w, true);
      yield* patterns(e, w);
    });
    e.mem.disc = (e.mem.disc ?? 0) + dt * (e.mem.spinning ? 6 : 1.2) * (e.mem.p2 ? 1.3 : 1);
    // brass dust off the box; amber motes from the cracks in phase 2
    if (fx.chance(e.mem.p2 ? 0.4 : 0.1)) {
      w.particles.spawn({
        x: e.x + fx.range(-8, 8), y: e.y - 24 + fx.range(-12, 12), vy: -fx.range(6, 14), life: fx.range(0.4, 0.9),
        colors: e.mem.p2 ? [AMBER[4], AMBER[3]] : [BRASS7[5], PORC[5]], size: 1, additive: true, light: e.mem.p2 ? 3 : 0, alpha: 0.8,
      });
    }
    void insideRoom;
  },
  draw(e, r) {
    if (e.hidden) return;
    const k = Math.min(0.6, e.z / 70);
    r.shadow(e.x, e.y + 2, 30 * (1 - k), 8 * (1 - k), 0.35 * e.alpha);
    if (e.mem.spinning) {
      // the spinning skirt smears into a rose ring
      r.ring(e.x, e.y - 16 - e.z, 17 + Math.sin(e.age * 20) * 1.5, ROSE[3], 2, 0.35 * e.alpha);
      r.ring(e.x, e.y - 16 - e.z, 21, VERD[4], 1, 0.25 * e.alpha);
    }
    e.drawDefault(r, e.frame(), 0);
    if (e.mem.p2) r.circle(e.x, e.y - 24 - e.z, 7 + Math.sin(e.age * 7) * 1.5, AMBER[3], 0.14 * e.alpha);
  },
  onDeath(e, w) {
    clearArena(w);
    dissolveMinions(w, e);
    w.sfx('clockboss_shatter', { vol: 1, pitch: 0.75 });
    w.sfx('clockboss_detune', { vol: 1, pitch: 0.8 });
    w.sfx('clockboss_gear', { vol: 0.8, pitch: 0.6 });
    bossDeathBurst(w, e.x, e.y - 16, [PORC[5], PORC[3], VERD[3], BRASS7[4], ROSE[3]], 40);
    // the porcelain shatters; the key, the bun and a rain of cogs fall, the box plays one sour note
    porcelainShards(w, e.x, e.y - 20, 46, 180);
    w.particles.burst(e.x, e.y - 24, { count: 16, speed: [40, 140], life: [0.8, 1.5], colors: [BRASS7[3], BRASS7[4]], size: [2, 4], gravity: 300, vz: [60, 180], bounce: 0.4, shape: 'square', vrot: 10 });
    w.particles.burst(e.x, e.y - 20, { count: 36, speed: [20, 110], life: [0.8, 1.7], colors: [ROSE[4], ROSE[3], AMBER[3]], size: [1, 2], additive: true, light: 5, gravity: -40 });
    for (let i = 0; i < 5; i++) w.spawn(new RingFx(e.x, e.y - 16, 34 + i * 30, 0.5 + i * 0.18, i % 2 ? ROSE[3] : PORC[5], 2));
    for (let i = 0; i < 6; i++) w.decal(e.x + fx.range(-28, 28), e.y + 6 + fx.range(-8, 14), PORC[2], fx.range(2, 5), 0.5);
  },
});

export { GhostDancer, RondoDancer, EchoDancer, StepEcho, TrioClone, CueClone, LeapEcho, ribbonWave, PORC_FX };
