// Floor 3 boss: 쇳물 이무기 (the slag imugi) — 용이 되지 못한 쇳물.
// A serpent of cooling slag swimming through the forge floor, a molten pearl
// (여의주) clenched in its jaws — it never became a dragon.
// The body is a chain of segments that follow the head's path; every segment is
// hittable (damage goes to the head, once per hit source) and burns on contact
// when it is low to the ground.
// Phase 1: breaches (bursts up under the player, arcs across the room and dives,
// leaving fire), fire-breath sweeps while reared, slag rain, geyser ambush.
// Phase 2 (≤50%): it swallows the pearl and glows white-hot — double breaches
// with shot rings, burning dive trails, faster sweeps, slag lumps.

import { defineBoss } from '../../game/defs';
import { bayer, PixelPainter } from '../../engine/painter';
import { defineAnim, defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { clamp, ease } from '../../engine/math';
import { Actor, type HitInfo } from '../../game/entity';
import { GroundWarning, RingFx } from '../../game/effects';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { Script } from '../../engine/script';
import { bullet, BUL, gather, Hazard, landingSpot, lob, spotAround, volleyTargets } from '../enemies/shared';
import {
  arcZ, ball, bossDeathBurst, crack, Eruption, inRoom, laneWarning, limb, minionCount, OUTLINE, phaseShift, pickPattern, shootGapRing,
  ShiftedPainter, summonMinion, Trail,
  clearArena,
} from './kit13';

// ------------------------------------------------------------------ palette
const SLAG = ['#0a090e', '#18151c', '#2a2530', '#403844', '#5c525e', '#7e7280'];
const MOLTEN = ['#8a1a06', '#d84a0e', '#ffa424', '#ffe070', '#fffbe0'];
const PEARL = ['#ff8a20', '#ffd060', '#fff6c8', '#ffffff'];

// ------------------------------------------------------------------ painting
function cracks(p: PixelPainter, cx: number, cy: number, r: number, seed: number, hot: number): void {
  const col = MOLTEN[Math.min(4, 1 + hot)];
  for (let i = 0; i < 4; i++) {
    const a = seed * 1.7 + i * 1.6;
    crack(p, cx + Math.cos(a) * r * 0.15, cy + Math.sin(a) * r * 0.15, cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.7, col, seed + i, 0.9);
  }
  p.px(cx, cy, MOLTEN[Math.min(4, 2 + hot)]);
}

function paintSegment(p: PixelPainter, w: number, h: number, hot: number, seed: number, p2: boolean): void {
  const cx = w / 2;
  const cy = h / 2 + 1;
  const rx = w / 2 - 1;
  const ry = h / 2 - 1.5;
  ball(p, cx, cy, rx, ry, SLAG.slice(0, 5), false);
  cracks(p, cx, cy, Math.min(rx, ry) * 1.1, seed, hot + (p2 ? 1 : 0));
  // Overlapping cooled plates frame the molten seams.
  p.line(cx - rx * 0.7, cy, cx - rx * 0.3, cy + ry * 0.3, SLAG[4]);
  p.line(cx - rx * 0.3, cy + ry * 0.3, cx + rx * 0.4, cy + ry * 0.3, SLAG[1]);
  // dorsal crest plate
  p.poly([cx - rx * 0.4, cy - ry * 0.55, cx, cy - ry - 2.5, cx + rx * 0.4, cy - ry * 0.55], SLAG[3]);
  p.line(cx, cy - ry - 2, cx, cy - ry * 0.4, SLAG[5]);
  p.px(cx - rx * 0.5, cy - ry * 0.4, SLAG[5]);
  if (p2) {
    p.px(cx + rx * 0.4, cy + ry * 0.3, MOLTEN[4]);
    p.px(cx - rx * 0.3, cy + ry * 0.5, MOLTEN[3]);
  }
}

function paintTail(p: PixelPainter, hot: number, p2: boolean): void {
  ball(p, 6, 7, 5, 4, SLAG.slice(0, 5), false);
  limb(p, 6, 6, 2.5, 6, 0.5, 0.5, SLAG.slice(1, 5));
  cracks(p, 6, 7, 4, 3, hot + (p2 ? 1 : 0));
}

function paintPearl(p: PixelPainter, x: number, y: number, r: number): void {
  p.circle(x, y, r + 0.8, PEARL[0]);
  ball(p, x, y, r, r, PEARL, false);
  p.px(x - r * 0.4, y - r * 0.4, '#ffffff');
}

/** side view, facing right */
function paintHeadSide(p: PixelPainter, hot: number, p2: boolean, open: number): void {
  // horn nubs swept back
  limb(p, 9, 6, 2, 2, 2, 0.6, SLAG.slice(1, 5));
  limb(p, 12, 5, 1.6, 6, 0.5, 0.5, SLAG.slice(1, 5));
  // jaw
  const jo = open;
  p.poly([8, 13, 27, 14 + jo, 26, 17 + jo, 12, 18], SLAG[2]);
  // skull + snout
  ball(p, 12, 10, 9, 6.5, SLAG.slice(0, 5), false);
  p.poly([14, 5, 28, 9, 29, 12, 26, 14, 14, 15], SLAG[3]);
  ball(p, 20, 10, 8, 4.5, SLAG.slice(0, 5), false);
  p.line(15, 6, 27, 9, SLAG[5]);
  // mouth glow / teeth
  p.line(13, 14, 28, 13, MOLTEN[jo > 0 ? 3 : 1]);
  if (jo > 0) {
    p.poly([14, 14, 28, 13, 27, 14 + jo, 14, 16], MOLTEN[2]);
    for (let x = 16; x < 27; x += 3) p.px(x, 14, '#fff0d0');
  }
  if (!p2) paintPearl(p, 26, 14 + jo * 0.5, 2.4);
  // eye
  p.rect(16, 7, 3, 2, MOLTEN[3]);
  p.px(17, 7, '#ffffff');
  p.px(18, 8, '#3a0a04');
  // glowing cracks + nostril
  crack(p, 5, 10, 11, 7, MOLTEN[Math.min(4, 1 + hot + (p2 ? 1 : 0))], 2, 0.8);
  crack(p, 9, 14, 14, 11, MOLTEN[Math.min(4, 1 + hot)], 5, 0.7);
  p.px(27, 10, MOLTEN[2]);
  // whisker barbels trailing back
  p.line(26, 12, 22, 19, MOLTEN[2]);
  p.line(22, 19, 16, 21, MOLTEN[1]);
  p.px(16, 21, MOLTEN[3]);
}

/** facing the camera (moving down the screen); `open` = jaw px */
function paintHeadDown(p: PixelPainter, hot: number, p2: boolean, open: number, w = 26): void {
  const cx = w / 2;
  const hotc = MOLTEN[Math.min(4, 1 + hot + (p2 ? 1 : 0))];
  // swept-back horns low on the sides of the skull
  limb(p, cx - 8, 8, 1.6, cx - 12, 4, 0.5, SLAG.slice(1, 5));
  limb(p, cx + 8, 8, 1.6, cx + 12, 4, 0.5, SLAG.slice(1, 5));
  // lower jaw (opens downward)
  p.poly([cx - 7, 15, cx + 7, 15, cx + 5, 20 + open, cx - 5, 20 + open], SLAG[1]);
  if (open > 0) {
    p.poly([cx - 6, 15, cx + 6, 15, cx + 4, 18 + open, cx - 4, 18 + open], '#2a0604');
    p.ellipse(cx, 16.5 + open * 0.5, 3.6, 1 + open * 0.4, MOLTEN[2]);
    p.ellipse(cx, 17 + open * 0.5, 2, 0.5 + open * 0.2, MOLTEN[3]);
    for (let i = -2; i <= 2; i++) p.px(cx + i * 2.4, 15, '#fff0d0');
    for (let i = -1; i <= 1; i++) p.px(cx + i * 3, 19 + open, '#fff0d0');
  }
  // broad, flat serpent skull tapering to the snout
  p.poly([cx - 11, 7, cx - 6, 3, cx + 6, 3, cx + 11, 7, cx + 9, 12, cx + 6, 16, cx - 6, 16, cx - 9, 12], SLAG[3]);
  for (let y = 2; y <= 17; y++) {
    for (let x = 0; x < w; x++) {
      if (!p.isSet(x, y) || y > 16) continue;
      const v = p.get(x, y);
      if (v !== 0 && y >= 3 && y <= 16 && Math.abs(x + 0.5 - cx) < 11.5) {
        const lum = 0.62 - (x + 0.5 - cx) / 14 * 0.4 - (y - 3) / 30;
        const idx = Math.max(0, Math.min(5, Math.floor(lum * 6)));
        if (y < 16 || Math.abs(x + 0.5 - cx) < 6) p.px(x, y, SLAG[idx]);
      }
    }
  }
  // dorsal crest of three spines (reads as a serpent, not ears)
  for (const [dx, hh] of [[-2.5, 3], [0, 4], [2.5, 3]] as const) p.poly([cx + dx - 1, 4, cx + dx, 3 - hh, cx + dx + 1, 4], SLAG[4]);
  // brow ridges + slanted eyes on the sides
  for (const s2 of [-1, 1]) {
    p.line(cx + s2 * 3, 6, cx + s2 * 9, 7, SLAG[5]);
    p.line(cx + s2 * 4, 8, cx + s2 * 8, 9, MOLTEN[3]);
    p.px(cx + s2 * 7, 8, '#ffffff');
    p.px(cx + s2 * 5, 9, MOLTEN[2]);
  }
  // nostrils + glowing seams
  p.px(cx - 2, 14, MOLTEN[2]);
  p.px(cx + 2, 14, MOLTEN[2]);
  crack(p, cx - 6, 5, cx - 2, 12, hotc, 3, 0.6);
  crack(p, cx + 7, 5, cx + 3, 12, MOLTEN[Math.min(4, 1 + hot)], 6, 0.6);
  // whisker barbels
  p.line(cx - 6, 14, cx - 12, 19, MOLTEN[2]);
  p.line(cx + 6, 14, cx + 12, 19, MOLTEN[2]);
  p.px(cx - 12, 20, MOLTEN[3]);
  p.px(cx + 12, 20, MOLTEN[3]);
  if (!p2) paintPearl(p, cx, 17 + open * 0.7, open > 2 ? 3 : 2.3);
}

function paintHeadUp(p: PixelPainter, hot: number, p2: boolean): void {
  const cx = 12;
  limb(p, cx - 6, 10, 1.8, cx - 9, 16, 0.5, SLAG.slice(1, 5));
  limb(p, cx + 6, 10, 1.8, cx + 9, 16, 0.5, SLAG.slice(1, 5));
  ball(p, cx, 11, 9.5, 8.5, SLAG.slice(0, 5), false);
  ball(p, cx, 6, 6, 4, SLAG.slice(0, 5), false);
  p.line(cx, 3, cx, 18, SLAG[5]);
  crack(p, cx - 6, 6, cx - 2, 14, MOLTEN[Math.min(4, 1 + hot + (p2 ? 1 : 0))], 4, 0.8);
  crack(p, cx + 6, 7, cx + 2, 15, MOLTEN[Math.min(4, 1 + hot)], 8, 0.8);
  p.px(cx - 8, 9, MOLTEN[3]);
  p.px(cx + 8, 9, MOLTEN[3]);
}

for (const [pre, p2] of [['imugi', false], ['imugi2', true]] as const) {
  for (let k = 0; k < 2; k++) {
    defineDrawnSprite(`${pre}_seg_l_${k}`, 18, 16, (p) => paintSegment(p, 18, 16, k, 1, p2), { outline: OUTLINE });
    defineDrawnSprite(`${pre}_seg_m_${k}`, 15, 14, (p) => paintSegment(p, 15, 14, k, 2, p2), { outline: OUTLINE });
    defineDrawnSprite(`${pre}_seg_s_${k}`, 12, 12, (p) => paintSegment(p, 12, 12, k, 3, p2), { outline: OUTLINE });
    defineDrawnSprite(`${pre}_tail_${k}`, 12, 12, (p) => paintTail(p, k, p2), { outline: OUTLINE });
    defineDrawnSprite(`${pre}_side_${k}`, 30, 23, (p) => paintHeadSide(p, k, p2, 0), { outline: OUTLINE });
    defineDrawnSprite(`${pre}_down_${k}`, 26, 25, (p) => paintHeadDown(p, k, p2, 0), { outline: OUTLINE });
    defineDrawnSprite(`${pre}_up_${k}`, 24, 21, (p) => paintHeadUp(p, k, p2), { outline: OUTLINE });
    defineDrawnSprite(`${pre}_rear_${k}`, 26, 28, (p) => paintHeadDown(p, k, p2, 5 + k), { outline: OUTLINE });
  }
  defineDrawnSprite(`${pre}_bite`, 30, 23, (p) => paintHeadSide(p, 1, p2, 3), { outline: OUTLINE });
  // recoil: head thrown back, jaws wide, cracks flaring (phase change / big hits)
  defineDrawnSprite(`${pre}_hurt_0`, 26, 28, (p) => {
    paintHeadDown(p, 2, p2, 7);
    for (const sd of [-1, 1]) p.line(13 + sd * 4, 8, 13 + sd * 8, 9, '#ffffff');
  }, { outline: OUTLINE });
  defineDrawnSprite(`${pre}_hurt_1`, 26, 28, (p) => paintHeadDown(p, 3, p2, 6), { outline: OUTLINE });
  defineAnim(`${pre}_hurt`, [`${pre}_hurt_0`, `${pre}_hurt_1`], 12);
  for (const v of ['seg_l', 'seg_m', 'seg_s', 'tail', 'side', 'down', 'up', 'rear']) defineAnim(`${pre}_${v}`, [`${pre}_${v}_0`, `${pre}_${v}_1`], 5);
}

// intro-card portrait: the serpent's head rearing from its coils, jaws parted on the
// molten pearl it never got to swallow
function paintPortrait(p: PixelPainter): void {
  const cx = 38;
  // coils of the body: an S-curve of segments rising to the head
  const coil: [number, number, number][] = [[64, 70, 10], [50, 76, 11], [30, 76, 11], [14, 68, 10], [12, 52, 9], [22, 42, 9], [34, 44, 10], [40, 40, 10]];
  coil.forEach(([x, y, r], i) => {
    ball(p, x, y, r, r * 0.85, SLAG.slice(0, 5), false);
    cracks(p, x, y, r, i * 3 + 1, 1);
    p.poly([x - r * 0.3, y - r * 0.6, x, y - r - 3, x + r * 0.3, y - r * 0.6], SLAG[3]);
  });
  // horns sweeping back and down like a dragon's
  for (const sd of [-1, 1]) {
    limb(p, cx + sd * 15, 12, 3.2, cx + sd * 25, 8, 2.4, SLAG.slice(1, 5));
    limb(p, cx + sd * 25, 8, 2.4, cx + sd * 33, 12, 1.4, SLAG.slice(1, 5));
    limb(p, cx + sd * 33, 12, 1.4, cx + sd * 35, 19, 0.5, SLAG.slice(1, 5));
    p.px(cx + sd * 35, 19, MOLTEN[3]);
  }
  // crest of spines
  for (const [dx, hh] of [[-6, 6], [-2, 9], [2, 9], [6, 6]] as const) p.poly([cx + dx - 2, 10, cx + dx, 10 - hh, cx + dx + 2, 10], SLAG[4]);
  // lower jaw, open
  p.poly([cx - 14, 28, cx + 14, 28, cx + 10, 42, cx - 10, 42], SLAG[1]);
  p.poly([cx - 12, 28, cx + 12, 28, cx + 8, 39, cx - 8, 39], '#2a0604');
  p.ellipse(cx, 33, 8, 4, MOLTEN[1]);
  p.ellipse(cx, 33, 6, 2.6, MOLTEN[2]);
  for (let i = -3; i <= 3; i++) p.poly([cx + i * 3.2 - 1, 39, cx + i * 3.2 + 1, 39, cx + i * 3.2, 36], '#fff0d0');
  // broad, flat skull
  p.poly([cx - 22, 15, cx - 13, 7, cx + 13, 7, cx + 22, 15, cx + 18, 22, cx + 13, 28, cx - 13, 28, cx - 18, 22], SLAG[3]);
  for (let y = 6; y <= 28; y++) {
    for (let x = 0; x < 76; x++) {
      if (!p.isSet(x, y) || Math.abs(x + 0.5 - cx) > 22.5) continue;
      if (y > 27 && Math.abs(x + 0.5 - cx) > 13) continue;
      const lum = 0.64 - ((x + 0.5 - cx) / 26) * 0.45 - (y - 6) / 46;
      p.px(x, y, SLAG[clamp(Math.floor(lum * 6 + (bayer(x, y) - 0.5) * 0.5), 0, 5)]);
    }
  }
  // upper fangs
  for (let i = -3; i <= 3; i++) p.poly([cx + i * 3.2 - 1, 28, cx + i * 3.2 + 1, 28, cx + i * 3.2, 31 + (Math.abs(i) === 3 ? 2 : 0)], '#fff0d0');
  // brow ridges + slanted molten eyes set wide on the skull
  for (const sd of [-1, 1]) {
    p.line(cx + sd * 6, 11, cx + sd * 19, 15, SLAG[5]);
    p.poly([cx + sd * 10, 14, cx + sd * 19, 17, cx + sd * 17, 20, cx + sd * 10, 17], '#1a0604');
    p.poly([cx + sd * 11, 15, cx + sd * 18, 17.5, cx + sd * 16.5, 19, cx + sd * 11, 16.5], MOLTEN[3]);
    p.px(cx + sd * 16, 17, '#ffffff');
    p.line(cx + sd * 13, 15, cx + sd * 13, 18, '#3a0a04');
  }
  // nostrils, glowing seams
  p.rect(cx - 4, 23, 2, 2, MOLTEN[2]);
  p.rect(cx + 3, 23, 2, 2, MOLTEN[2]);
  crack(p, cx - 15, 10, cx - 7, 22, MOLTEN[2], 3, 0.8);
  crack(p, cx + 16, 11, cx + 7, 23, MOLTEN[3], 6, 0.8);
  crack(p, cx - 2, 8, cx + 2, 13, MOLTEN[1], 9, 0.5);
  // whisker barbels, trailing fire
  for (const sd of [-1, 1]) {
    p.line(cx + sd * 13, 25, cx + sd * 24, 34, MOLTEN[2]);
    p.line(cx + sd * 24, 34, cx + sd * 33, 31, MOLTEN[1]);
    p.px(cx + sd * 33, 30, MOLTEN[3]);
  }
  // the pearl
  p.circle(cx, 35, 5.4, PEARL[0]);
  ball(p, cx, 35, 4.4, 4.4, PEARL, false);
  p.px(cx - 2, 33, '#ffffff');
  p.px(cx - 1, 33, '#ffffff');
}

defineDrawnSprite('imugi_portrait', 76, 84, (p) => {
  const tmp = new ShiftedPainter(76, 84, 3);
  paintPortrait(tmp);
  p.blit(tmp, 0, 0);
}, { outline: OUTLINE });

// molten ripple: what shows while it swims under the floor
for (let k = 0; k < 3; k++) {
  defineDrawnSprite(`imugi_ripple_${k}`, 26, 12, (p) => {
    p.ellipse(13, 7, 12, 4, SLAG[2]);
    p.ellipse(13, 7, 9 + k, 2.6, SLAG[1]);
    for (let i = 0; i < 5; i++) {
      const x = 3 + i * 5 + ((k + i) % 2);
      p.line(x, 7 - (i % 2), x + 2, 5 + ((i + k) % 3), MOLTEN[(i + k) % 3 === 0 ? 3 : 2]);
    }
    p.px(13, 6, MOLTEN[4]);
  }, { outline: '#120404' });
}
defineAnim('imugi_ripple', ['imugi_ripple_0', 'imugi_ripple_1', 'imugi_ripple_2'], 10);

defineDrawnSprite('imugi_slag', 9, 9, (p) => {
  ball(p, 4.5, 4.5, 4, 4, [SLAG[2], MOLTEN[0], MOLTEN[1], MOLTEN[2], MOLTEN[3]], true);
  p.px(3, 3, '#ffffff');
}, { outline: '#160300' });

// ------------------------------------------------------------------ body segments
const NAME = '쇳물 이무기';
const SEG_SPACING = 10.5;
const SEG_SIZES: ('seg_l' | 'seg_m' | 'seg_s' | 'tail')[] = ['seg_l', 'seg_l', 'seg_l', 'seg_m', 'seg_m', 'seg_m', 'seg_s', 'seg_s', 'tail'];
const SEG_R: Record<string, number> = { seg_l: 8, seg_m: 7, seg_s: 6, tail: 5 };
const EMBERS = ['#ffffff', '#ffe070', '#ffa424', '#d84a0e'];

/** Dedupe key for a hit: projectiles by identity, swings / blasts by kind (per frame). */
export function hitKey(hit: HitInfo): string {
  return hit.kind === 'projectile' && hit.source ? `s${hit.source.id}` : hit.kind;
}

/**
 * One body segment. A neutral (hittable) actor positioned by the head every
 * frame; hits are forwarded to the head once per hit source.
 */
export class ImugiPart extends Actor {
  head: Enemy;
  idx: number;
  kind: string;
  up = false;
  /** ground y + height (x, y hold the visual position) */
  gy = 0;
  h = 0;
  constructor(head: Enemy, idx: number) {
    super();
    this.head = head;
    this.idx = idx;
    this.kind = SEG_SIZES[Math.min(idx, SEG_SIZES.length - 1)];
    this.team = 'neutral';
    this.solid = false;
    this.tileCollide = false;
    this.flying = true;
    this.phasing = true;
    this.mass = Infinity;
    this.r = SEG_R[this.kind];
    this.hp = this.maxHp = 1e9;
    this.x = -9999;
    this.y = -9999;
  }

  override get sortY(): number {
    return this.gy;
  }

  override takeHit(w: World, hit: HitInfo): boolean {
    const head = this.head;
    if (!this.up || head.dead || !head.alive) return false;
    // one hit (projectile / swing / explosion) only counts once per frame, however many
    // body parts (and the head itself) it overlaps
    const key = hitKey(hit);
    if (head.mem.segKey === key && head.mem.segT === w.time) return true;
    head.mem.segKey = key;
    head.mem.segT = w.time;
    this.flash = 0.1;
    this.squash(1.2, 0.85);
    const wasHidden = head.hidden;
    const wasVuln = head.vulnerable;
    head.hidden = false;
    head.vulnerable = true;
    const ok = w.applyHit(head, { ...hit, attacker: hit.attacker ?? w.player, knockback: 0 });
    head.hidden = wasHidden;
    head.vulnerable = wasVuln || head.dead;
    if (ok) w.particles.burst(this.x, this.y - 2, { count: 4, speed: [30, 80], life: [0.15, 0.3], colors: EMBERS, size: [1, 2] });
    return ok;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.flash > 0) this.flash -= dt;
    this.updateSquash(dt);
  }

  override draw(r: Renderer): void {
    if (!this.up) return;
    const k = Math.min(0.7, this.h / 70);
    r.shadow(this.x, this.gy + 2, this.r * 2.2 * (1 - k), this.r * 0.8 * (1 - k), 0.35);
    const pre = this.head.mem.p2 ? 'imugi2' : 'imugi';
    const t = this.age + this.idx * 0.13;
    r.anim(`${pre}_${this.kind}`, t, this.x, this.y - 2, { flash: this.flash > 0 ? 1 : 0, sx: this.squashX, sy: this.squashY });
  }

  override light(w: World): void {
    if (this.up) w.lights.add(this.x, this.y, 22, '#ff7020', { intensity: 0.45 });
  }
}

// ------------------------------------------------------------------ head movement
interface ImugiState {
  gx: number;
  gy: number;
  h: number;
  under: boolean;
  trail: Trail;
  parts: ImugiPart[];
  /** last ground movement direction (for picking the head view) */
  dx: number;
  dy: number;
  dh: number;
  rear: boolean;
}

function st(e: Enemy): ImugiState {
  return e.mem.st as ImugiState;
}

/** Put the head at ground (gx, gy) with height h (visual position = gy - h). */
function place(e: Enemy, gx: number, gy: number, h: number): void {
  const s = st(e);
  s.dx = gx - s.gx;
  s.dy = gy - s.gy;
  s.dh = h - s.h;
  s.gx = gx;
  s.gy = gy;
  s.h = h;
  e.x = gx;
  e.y = gy - h;
}

function setUnder(e: Enemy, under: boolean): void {
  const s = st(e);
  s.under = under;
  e.vulnerable = !under;
  e.harmful = !under;
}

function sfxRumble(w: World): void {
  w.sfx('rock_break', { vol: 0.5, pitch: 0.5 });
}

/** Swim under the floor to (x, y). */
function* swimTo(e: Enemy, w: World, x: number, y: number, speed = 175): Script {
  const s = st(e);
  setUnder(e, true);
  s.rear = false;
  for (let el = 0; el < 3; el += w.dt) {
    const d = Math.hypot(x - s.gx, y - s.gy);
    if (d < 2) break;
    const sp = Math.min(d, speed * w.dt);
    place(e, s.gx + ((x - s.gx) / d) * sp, s.gy + ((y - s.gy) / d) * sp, 0);
    if (fx.chance(0.5)) w.particles.spawn({ x: s.gx + fx.range(-6, 6), y: s.gy + fx.range(-2, 2), vy: -fx.range(10, 30), life: fx.range(0.3, 0.5), colors: EMBERS, size: 1, additive: true, light: 3 });
    if (e.mem.p2 && w.rng.chance(0.06)) w.spawn(new Hazard(s.gx, s.gy, 9, 1.6, 'fire', NAME));
    yield;
  }
}

/** Ground warning + rumble before surfacing at the current spot. */
function* warnSurface(e: Enemy, w: World, time: number, radius = 22): Script {
  const s = st(e);
  w.spawn(new GroundWarning(s.gx, s.gy, radius, time));
  for (let el = 0; el < time; el += 0.12) {
    w.particles.burst(s.gx, s.gy, { count: 3, speed: [20, 60], life: [0.2, 0.4], colors: EMBERS, size: [1, 2], gravity: 250, vz: [20, 70] });
    if (Math.floor(el / 0.12) % 2 === 0) sfxRumble(w);
    yield 0.12;
  }
}

/** Erupting from the floor: hurts whoever stands on the spot, kicks up molten debris. */
function burstOut(e: Enemy, w: World, radius: number, ring: boolean): void {
  const s = st(e);
  setUnder(e, false);
  w.sfx('explosion', { vol: 0.6, pitch: 0.7 });
  w.shake(0.55);
  const p = w.player;
  if (p.alive && p.z < 8 && Math.hypot(p.x - s.gx, p.y - s.gy) < radius + p.r * 0.6 && p.hurt(w, 2, NAME)) {
    const d = Math.hypot(p.x - s.gx, p.y - s.gy) || 1;
    p.knock((p.x - s.gx) / d, (p.y - s.gy) / d, 220);
  }
  w.particles.burst(s.gx, s.gy, { count: 26, speed: [50, 170], life: [0.3, 0.7], colors: EMBERS, size: [1, 3], gravity: 300, vz: [60, 180], light: 4 });
  w.spawn(new RingFx(s.gx, s.gy, radius + 8, 0.3, '#ffa424', 2));
  w.decal(s.gx, s.gy, '#1a0806', radius * 0.6, 0.5);
  if (ring) {
    const g = w.rng.angle();
    for (const pr of shootGapRingFrom(e, w, s.gx, s.gy, 16, [g, g + Math.PI])) pr.z = 6;
  }
}

function shootGapRingFrom(e: Enemy, w: World, x: number, y: number, n: number, gaps: number[]) {
  const ox = e.x;
  const oy = e.y;
  e.x = x;
  e.y = y;
  const out = shootGapRing(e, w, n, w.rng.angle(), gaps, 0.9, bullet('molten', 3, { speed: 76, z: 6 }));
  e.x = ox;
  e.y = oy;
  return out;
}

/** Rise out of the floor to a reared pose (head up, neck in a column). */
function* rear(e: Enemy, w: World, height: number, time: number): Script {
  const s = st(e);
  s.rear = true;
  const h0 = s.h;
  for (let el = 0; el < time; el += w.dt) {
    place(e, s.gx, s.gy, h0 + (height - h0) * ease.outCubic(Math.min(1, el / time)));
    yield;
  }
  place(e, s.gx, s.gy, height);
}

/** Sink back under the floor. */
function* sink(e: Enemy, w: World, time: number): Script {
  const s = st(e);
  const h0 = s.h;
  for (let el = 0; el < time; el += w.dt) {
    place(e, s.gx, s.gy, h0 * (1 - ease.inQuad(Math.min(1, el / time))));
    yield;
  }
  place(e, s.gx, s.gy, 0);
  w.sfx('splat', { vol: 0.6, pitch: 0.5 });
  w.particles.burst(s.gx, s.gy, { count: 14, speed: [30, 110], life: [0.25, 0.5], colors: EMBERS, size: [1, 2], gravity: 300, vz: [40, 120] });
  setUnder(e, true);
  s.rear = false;
}

/** Pick an arc A -> B through/near the player that fits in the room. */
function pickArc(w: World, from: { x: number; y: number }): { ax: number; ay: number; bx: number; by: number } {
  const p = w.player;
  let best = { ax: p.x, ay: p.y, bx: p.x, by: p.y };
  let bestLen = -1;
  for (let i = 0; i < 10; i++) {
    const a = w.rng.angle();
    const A = inRoom(w, p.x, p.y, 24);
    const B = inRoom(w, A.x + Math.cos(a) * 160, A.y + Math.sin(a) * 160, 24);
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    // prefer long arcs that head away from where the serpent came from
    const score = len + Math.hypot(B.x - from.x, B.y - from.y) * 0.25;
    if (score > bestLen) {
      bestLen = score;
      best = { ax: A.x, ay: A.y, bx: B.x, by: B.y };
    }
  }
  return best;
}

function* breach(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  const s = st(e);
  const arc = pickArc(w, { x: s.gx, y: s.gy });
  yield* swimTo(e, w, arc.ax, arc.ay);
  yield* warnSurface(e, w, p2 ? 0.5 : 0.65, 22);
  // also warn where it will dive
  w.spawn(new GroundWarning(arc.bx, arc.by, 18, 1.15));
  burstOut(e, w, 22, p2);
  e.setAnim(`${pre(e)}_side`);
  w.sfx('whoosh', { vol: 0.8, pitch: 0.5 });
  const T = 1.05;
  const H = 52;
  for (let el = 0; el < T; el += w.dt) {
    const t = Math.min(1, el / T);
    place(e, arc.ax + (arc.bx - arc.ax) * t, arc.ay + (arc.by - arc.ay) * t, arcZ(t, H));
    yield;
  }
  // dive splash
  place(e, arc.bx, arc.by, 0);
  setUnder(e, true);
  w.sfx('explosion', { vol: 0.45, pitch: 0.9 });
  w.shake(0.35);
  w.particles.burst(arc.bx, arc.by, { count: 20, speed: [40, 140], life: [0.3, 0.6], colors: EMBERS, size: [1, 2], gravity: 300, vz: [40, 140] });
  const pl = w.player;
  if (pl.alive && Math.hypot(pl.x - arc.bx, pl.y - arc.by) < 18 + pl.r * 0.6) pl.hurt(w, 1, NAME);
  w.spawn(new Hazard(arc.bx, arc.by, 15, p2 ? 4 : 3, 'fire', NAME));
  // continue under the floor so the body follows the arc down
  const dx = arc.bx - arc.ax;
  const dy = arc.by - arc.ay;
  const d = Math.hypot(dx, dy) || 1;
  const cont = inRoom(w, arc.bx + (dx / d) * 40, arc.by + (dy / d) * 40, 20);
  yield* swimTo(e, w, cont.x, cont.y, 160);
}

function* fireBreath(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  const p = w.player;
  const spot = spotAround(w, p.x, p.y, 80, 110, 14, true) ?? inRoom(w, w.room.centerX, w.room.centerY - 20, 30);
  yield* swimTo(e, w, spot.x, spot.y);
  yield* warnSurface(e, w, 0.5, 20);
  burstOut(e, w, 20, false);
  e.setAnim(`${pre(e)}_rear`);
  yield* rear(e, w, 30, 0.4);
  const s = st(e);
  const a0 = Math.atan2(w.player.y - (s.gy - 10), w.player.x - s.gx);
  const dir = w.rng.sign();
  const span = 0.85;
  const start = a0 - dir * span;
  // telegraph: the mouth fills with fire, a lane shows where the sweep begins
  laneWarning(w, s.gx, s.gy, start, 150, 12, 0.75);
  e.telegraph(0.75);
  w.sfx('beam_charge', { vol: 0.7, pitch: 0.7 });
  for (let k = 0; k < 3; k++) {
    gather(w, e.x, e.y + 6, EMBERS, 8, 16);
    yield 0.25;
  }
  const T = p2 ? 1.2 : 1.5;
  let fired = 0;
  for (let el = 0; el < T; el += w.dt) {
    const a = start + dir * span * 2 * (el / T);
    e.mem.breathA = a;
    if (el >= fired * 0.055) {
      fired++;
      const pr = e.shoot(w, a, bullet('molten', 3, { speed: p2 ? 140 : 125, z: 12 }));
      pr.x = e.x + Math.cos(a) * 8;
      pr.y = s.gy + Math.sin(a) * 6;
      if (fired % 3 === 0) w.sfx('fire', { vol: 0.35, pitch: 1.1 });
    }
    w.particles.spawn({ x: e.x + Math.cos(a) * 10, y: e.y + 8 + Math.sin(a) * 6, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, life: 0.25, colors: EMBERS, size: 2, sizeEnd: 0.5, additive: true, light: 6 });
    yield;
  }
  e.mem.breathA = undefined;
  yield 0.35;
  e.setAnim(`${pre(e)}_down`);
  yield* sink(e, w, 0.45);
}

function* slagRain(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  const p = w.player;
  const spot = spotAround(w, p.x, p.y, 70, 120, 14, true) ?? inRoom(w, w.room.centerX, w.room.centerY, 30);
  yield* swimTo(e, w, spot.x, spot.y);
  yield* warnSurface(e, w, 0.5, 20);
  burstOut(e, w, 20, false);
  e.setAnim(`${pre(e)}_rear`);
  yield* rear(e, w, 34, 0.4);
  e.telegraph(0.5);
  w.sfx('fire', { vol: 0.6, pitch: 0.6 });
  yield 0.5;
  const n = p2 ? 7 : 5;
  const pts = volleyTargets(e.x, e.y, p.x + p.vx * 0.3, p.y + p.vy * 0.3, 3, 32);
  while (pts.length < n) pts.push(spotAround(w, p.x, p.y, 30, 100, 5) ?? { x: p.x, y: p.y });
  for (const pt of pts) {
    const land = landingSpot(w, pt.x, pt.y, 4);
    lob(w, e.x, e.y, land.x, land.y, {
      sprite: 'imugi_slag', color: BUL.molten.color, time: 1.0, height: 60, warn: 13, hitRadius: 11, source: NAME, spin: 6,
      onLand: (ww, x, y) => ww.spawn(new Hazard(x, y, 12, 3, 'fire', NAME)),
    });
    e.squash(0.85, 1.2);
    w.sfx('splat', { vol: 0.4, pitch: 1.2 });
    yield 0.14;
  }
  yield 0.4;
  e.setAnim(`${pre(e)}_down`);
  yield* sink(e, w, 0.45);
}

function* geyser(e: Enemy, w: World): Script {
  const p2 = !!e.mem.p2;
  const p = w.player;
  yield* swimTo(e, w, p.x, p.y, 200);
  const s = st(e);
  // a ring of fire vents opens around the spot, then it bursts straight up
  const n = p2 ? 8 : 6;
  const off = w.rng.angle();
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2;
    const x = s.gx + Math.cos(a) * 34;
    const y = s.gy + Math.sin(a) * 26;
    w.spawn(new Eruption(x, y, 'fire', 0.85 + (i % 2) * 0.15, { radius: 10, source: NAME, linger: 0.4 }));
  }
  yield* warnSurface(e, w, 0.7, 24);
  burstOut(e, w, 24, true);
  e.setAnim(`${pre(e)}_rear`);
  yield* rear(e, w, 40, 0.3);
  yield 0.5;
  e.setAnim(`${pre(e)}_down`);
  yield* sink(e, w, 0.4);
}

/** Place every body segment along the head's trail; burning low segments hurt on contact. */
function layoutBody(e: Enemy, w: World, contact: boolean): void {
  const s = st(e);
  const p = w.player;
  for (const part of s.parts) {
    const t = s.trail.sample((part.idx + 1) * SEG_SPACING);
    part.up = t.up && !e.dead;
    part.gy = t.y;
    part.h = t.z;
    if (!part.up) {
      part.x = -9999;
      part.y = -9999;
      continue;
    }
    part.x = t.x;
    part.y = t.y - t.z;
    if (contact && t.z < 10 && p.alive && p.z < 6 && Math.hypot(p.x - t.x, p.y - t.y) < part.r + p.r - 2 && p.hurt(w, 1, NAME)) {
      const d = Math.hypot(p.x - t.x, p.y - t.y) || 1;
      p.knock((p.x - t.x) / d, (p.y - t.y) / d, 160);
    }
  }
}

function pre(e: Enemy): string {
  return e.mem.p2 ? 'imugi2' : 'imugi';
}

function* phaseTwo(e: Enemy, w: World): Script {
  const room = w.room;
  yield* swimTo(e, w, room.centerX, room.centerY - 10);
  yield* warnSurface(e, w, 0.5, 22);
  burstOut(e, w, 22, false);
  e.setAnim(`${pre(e)}_rear`);
  yield* rear(e, w, 36, 0.4);
  yield* phaseShift(e, w, {
    anim: 'imugi_hurt',
    color: '#ffb040',
    time: 1.6,
    onPeak: () => {
      e.mem.p2 = true;
      e.setAnim('imugi2_hurt', true);
      w.sfx('fire', { vol: 1, pitch: 0.5 });
      // the pearl is swallowed: a flash of white-hot light
      w.particles.burst(e.x, e.y + 6, { count: 30, speed: [40, 160], life: [0.3, 0.8], colors: ['#ffffff', '#fff6c8', '#ffd060'], size: [1, 3], additive: true, light: 8 });
      const g = w.rng.angle();
      shootGapRingFrom(e, w, st(e).gx, st(e).gy, 22, [g, g + Math.PI]);
      for (let i = 0; i < Math.max(0, 2 - minionCount(w, e)); i++) {
        const s = spotAround(w, st(e).gx, st(e).gy, 40, 80, 7) ?? { x: st(e).gx + (i ? 40 : -40), y: st(e).gy + 10 };
        lob(w, e.x, e.y, s.x, s.y, {
          sprite: 'imugi_slag', color: BUL.molten.color, time: 0.8, height: 50, warn: 10, hitRadius: 9, source: NAME,
          onLand: (ww, x, y) => {
            summonMinion(e, ww, 'slag_lump', x, y, EMBERS);
          },
        });
      }
    },
  });
  e.setAnim(`${pre(e)}_down`);
  yield* sink(e, w, 0.45);
}

defineBoss({
  id: 'slag_imugi',
  name: NAME,
  bossTitle: '용이 되지 못한 쇳물',
  bossFloors: [3],
  hp: 880,
  radius: 11,
  speed: 0,
  mass: Infinity,
  flying: true,
  phasing: true,
  sprite: 'imugi_down',
  portrait: 'imugi_portrait',
  shadow: 0,
  deathFx: 'ember',
  bloodColor: '#ffa424',
  contactDamage: 1,
  hurtSfx: 'hit_metal',
  light: { radius: 46, color: '#ff8030' },
  init(e, w) {
    e.mem.last = null;
    const s: ImugiState = { gx: e.x, gy: e.y, h: 0, under: false, trail: new Trail(SEG_SIZES.length * SEG_SPACING + 40), parts: [], dx: 0, dy: 1, dh: 0, rear: true };
    e.mem.st = s;
    // starts reared out of the floor (shown on the intro card), body coiled below
    for (let i = 0; i < 12; i++) s.trail.push(e.x, e.y + 12 - i, 0, i > 4);
    for (let i = 0; i <= 30; i++) s.trail.push(e.x, e.y, i, true);
    place(e, e.x, e.y, 30);
    s.dx = 0;
    s.dy = 1;
    for (let i = 0; i < SEG_SIZES.length; i++) s.parts.push(w.spawn(new ImugiPart(e, i)));
    layoutBody(e, w, false);
    e.setAnim('imugi_rear');
  },
  *script(e, w) {
    const s = st(e);
    e.setAnim('imugi_rear');
    w.sfx('enemy_roar', { vol: 0.7, pitch: 0.5 });
    yield 0.4;
    e.setAnim('imugi_down');
    yield* sink(e, w, 0.5);
    let sinceBreach = 9;
    while (true) {
      if (e.phase === 0 && e.hp <= e.maxHp * 0.5) yield* phaseTwo(e, w);
      const p2 = !!e.mem.p2;
      // the breach is its signature: it always opens with one and never goes long without
      const id = sinceBreach >= 9 ? 'breach' : pickPattern(w.rng, [
        { id: 'breach', w: 3 + sinceBreach * 1.5 },
        { id: 'breath', w: 2.4 },
        { id: 'rain', w: 2 },
        { id: 'geyser', w: 1.8 },
      ], e.mem.last as string | null);
      e.mem.last = id;
      sinceBreach = id === 'breach' ? 0 : sinceBreach + 1;
      if (id === 'breach') {
        yield* breach(e, w);
        if (p2) yield* breach(e, w);
      } else if (id === 'breath') yield* fireBreath(e, w);
      else if (id === 'rain') yield* slagRain(e, w);
      else yield* geyser(e, w);
      // circle under the floor for a moment
      const drift = inRoom(w, s.gx + w.rng.range(-50, 50), s.gy + w.rng.range(-30, 30), 30);
      yield* swimTo(e, w, drift.x, drift.y, 120);
      yield p2 ? 0.15 : 0.35;
    }
  },
  update(e, w) {
    const s = st(e);
    if (!s) return;
    // keep the position in sync if something else moved the entity
    s.trail.push(s.gx, s.gy, s.h, !s.under);
    // pick the head view from the travel direction
    if (!s.under && !s.rear) {
      const pre2 = pre(e);
      const dx = s.dx;
      const dy = s.dy;
      if (Math.abs(dx) >= Math.abs(dy) * 0.7) {
        e.setAnim(`${pre2}_side`);
        e.facing = dx >= 0 ? 1 : -1;
      } else e.setAnim(dy < 0 ? `${pre2}_up` : `${pre2}_down`);
    }
    // contact damage from the head is handled by the world when it is low; never while high
    e.harmful = !s.under && s.h < 10;
    layoutBody(e, w, true);
    if (!s.under && fx.chance(0.3)) {
      w.particles.spawn({ x: e.x + fx.range(-6, 6), y: e.y + fx.range(-4, 4), vy: -fx.range(10, 30), life: fx.range(0.3, 0.6), colors: EMBERS, size: 1, additive: true, light: 3 });
    }
  },
  onHurt(e, w, hit) {
    // a swing / blast that also overlaps body parts this frame only counts once
    e.mem.segKey = hitKey(hit);
    e.mem.segT = w.time;
  },
  draw(e: Enemy, r: Renderer) {
    const s = st(e);
    if (!s) return;
    if (s.under) {
      r.anim('imugi_ripple', e.age, s.gx, s.gy);
      return;
    }
    const k = Math.min(0.7, s.h / 70);
    r.shadow(s.gx, s.gy + 2, 26 * (1 - k), 9 * (1 - k), 0.4);
    e.drawDefault(r, e.frame(), -2);
    const a = e.mem.breathA as number | undefined;
    if (a !== undefined) {
      // fire gushing from the jaws
      for (let i = 1; i <= 4; i++) r.circle(e.x + Math.cos(a) * i * 5, e.y + 8 + Math.sin(a) * i * 4, 4 - i * 0.6, i < 2 ? '#fff6c8' : '#ffa424', 0.85);
    }
  },
  onDeath(e, w) {
    clearArena(w);
    const s = st(e);
    for (const part of s.parts) {
      if (part.up) {
        w.particles.burst(part.x, part.y, { count: 12, speed: [40, 140], life: [0.3, 0.8], colors: EMBERS, size: [1, 3], gravity: 300, vz: [40, 140], light: 3 });
        w.decal(part.x, part.gy, '#1a0806', part.r * 0.8, 0.5);
      }
      part.dead = true;
    }
    for (const m of [...w.enemies]) if (m.mem.owner === e && m.alive) { m.dead = true; m.hp = 0; }
    bossDeathBurst(w, e.x, e.y, ['#ffe070', '#ffa424', '#d84a0e', '#4e302a', '#33201f']);
    w.particles.burst(e.x, e.y, { count: 30, speed: [60, 200], life: [0.3, 0.9], colors: EMBERS, shape: 'spark', size: [1, 2], light: 5 });
    for (let i = 0; i < 3; i++) w.spawn(new RingFx(s.gx, s.gy, 34 + i * 24, 0.5 + i * 0.15, '#ffa424', 2));
  },
});
