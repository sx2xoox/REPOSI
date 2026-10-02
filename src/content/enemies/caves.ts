// Floor 2 — 포자 동굴 (spore caves): a burrowing mushroom, a splitting slime and its
// slimelings, an artillery spore pod, an orbiting dust moth, a leaping leech and a
// gas bloater that explodes into a poison puddle.

import { defineEnemy } from '../../game/defs';
import { PixelPainter, ramp } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { GroundWarning, RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import {
  bullet, BUL, dust, frames, gather, Hazard, landingSpot, lob, OUTLINE, sphere, stepToward, volleyTargets, WARN_RED,
} from './shared';

const DIRT = ['#5a4636', '#3e2e24', '#7a604a'];

// ================================================================== 포자 버섯 (spore shroom) — burrower
// Tunnels toward the player (dirt trail), pops up after a ground warning, puffs a
// ring of spores, then burrows again. Untouchable while underground.
const CAP = ramp('#8a3cb4', 5);
const STALK = ramp('#e2d6c0', 4);
const SPOT = '#d6ff5a';

function paintShroomBody(p: PixelPainter, squash: number, glow: boolean): void {
  const ry = 5 * squash;
  const rx = 7.5 / Math.sqrt(squash);
  // stalk with an angry face
  p.rect(5, 11, 6, 6, STALK[2]);
  p.shadeVertical(5, 11, 6, 6, [STALK[0], STALK[1], STALK[2], STALK[3]].reverse());
  p.rect(5, 11, 1, 6, STALK[3]);
  p.rect(10, 11, 1, 6, STALK[1]);
  p.px(6, 13, '#2a0a20');
  p.px(9, 13, '#2a0a20');
  p.px(6, 12, '#2a0a20');
  p.px(9, 12, '#2a0a20');
  p.rect(7, 15, 2, 1, '#5a1a3a');
  // cap
  const cy = 10 - ry * 0.55;
  p.ellipse(8, cy, rx, ry, CAP[2]);
  sphere(p, 8, cy, rx, ry, CAP);
  // gills
  p.line(Math.round(8 - rx + 1), Math.round(cy + ry * 0.6), Math.round(8 + rx - 1), Math.round(cy + ry * 0.6), CAP[0]);
  // glowing spots
  const s = glow ? '#ffffff' : SPOT;
  p.circle(4.5, cy - ry * 0.1, 1.3, SPOT);
  p.circle(9.5, cy - ry * 0.55, 1.5, SPOT);
  p.circle(12, cy + ry * 0.15, 1, SPOT);
  p.px(7, Math.round(cy + ry * 0.1), SPOT);
  p.px(9, Math.round(cy - ry * 0.65), s);
  p.px(4, Math.round(cy - ry * 0.2), s);
}

/** Paint the shroom sunk `sink` px into the ground (clipped) with a dirt mound. */
function paintShroom(p: PixelPainter, sink: number, squash: number, glow: boolean, mound: boolean): void {
  const tmp = new PixelPainter(16, 18);
  paintShroomBody(tmp, squash, glow);
  tmp.outline(OUTLINE);
  for (let y = 0; y < 18; y++) {
    const ty = y + sink;
    if (ty > (mound ? 16 : 17) || ty < 0) continue;
    for (let x = 0; x < 16; x++) {
      const v = tmp.data[y * 16 + x];
      if (v >>> 24) p.data[ty * 16 + x] = v;
    }
  }
  if (mound) {
    p.ellipse(8, 17, 7.5, 1.8, DIRT[0]);
    p.px(2, 16, DIRT[2]);
    p.px(5, 16, DIRT[2]);
    p.px(11, 16, DIRT[2]);
    p.px(13, 17, DIRT[1]);
    p.px(0, 17, OUTLINE);
    p.px(15, 17, OUTLINE);
  }
}
const SHROOM_O = { anchor: 'bottom' as const, outline: null };
frames('sshroom', 'emerge', 3, 16, 18, (p, i) => paintShroom(p, [11, 5, 0][i], 1, false, true), { ...SHROOM_O, fps: 10, loop: false });
frames('sshroom', 'burrow', 3, 16, 18, (p, i) => paintShroom(p, [0, 5, 11][i], 1, false, true), { ...SHROOM_O, fps: 10, loop: false });
frames('sshroom', 'idle', 2, 16, 18, (p, i) => paintShroom(p, 0, i ? 0.92 : 1, i === 1, false), { ...SHROOM_O, fps: 3 });
frames('sshroom', 'puff', 2, 16, 18, (p, i) => paintShroom(p, 0, i ? 0.7 : 1.15, true, false), { ...SHROOM_O, fps: 6, loop: false });

defineEnemy({
  id: 'spore_shroom',
  name: '포자 버섯',
  hp: 26,
  radius: 5,
  speed: 56,
  sprite: 'sshroom_idle',
  spriteYOffset: 5,
  shadow: 10,
  cost: 1.5,
  floors: [2],
  weight: 1,
  champion: true,
  deathFx: 'spore',
  bloodColor: '#c070e0',
  light: { radius: 18, color: '#c0ff60' },
  init(e) {
    e.hidden = true;
    e.vulnerable = false;
    e.harmful = false;
  },
  *script(e, w) {
    while (true) {
      // ---- underground: tunnel toward a spot near the player
      e.hidden = true;
      e.vulnerable = false;
      e.harmful = false;
      const t = w.rng.range(0.9, 1.5);
      for (let el = 0; el < t; el += w.dt) {
        if (e.distToTarget(w) > 44) e.chase(w, e.speed);
        else e.flee(w, e.speed * 0.5);
        if (fx.chance(0.5)) dust(w, e.x + fx.range(-3, 3), e.y + 2, DIRT, 1, 30);
        yield;
      }
      e.halt();
      // ---- surfacing warning
      w.spawn(new GroundWarning(e.x, e.y, 11, 0.55, undefined, WARN_RED));
      for (let el = 0; el < 0.55; el += 0.11) {
        dust(w, e.x, e.y + 2, DIRT, 3, 45);
        yield 0.11;
      }
      // ---- emerge
      e.hidden = false;
      e.vulnerable = true;
      e.setAnim('sshroom_emerge', true);
      w.sfx('enemy_spawn', { vol: 0.4, pitch: 1.2 });
      dust(w, e.x, e.y + 3, DIRT, 10, 70);
      yield 0.3;
      e.harmful = true;
      e.setAnim('sshroom_idle');
      yield 0.25;
      // ---- spore puff
      e.setAnim('sshroom_puff', true);
      e.telegraph(0.4);
      gather(w, e.x, e.y - 8, ['#ffffff', SPOT, '#8a3cb4'], 8, 16);
      yield 0.4;
      const off = w.rng.angle();
      e.shootRing(w, 8, bullet('toxic', 3, { speed: 72, offset: off, z: 6 }));
      w.sfx('poison', { vol: 0.5 });
      w.particles.burst(e.x, e.y - 8, { count: 14, speed: [20, 60], life: [0.4, 0.8], colors: ['#e8ffb0', SPOT, '#8ac040'], size: [1, 2], drag: 2 });
      if (e.champion) {
        yield 0.3;
        e.shootRing(w, 8, bullet('toxic', 3, { speed: 56, offset: off + Math.PI / 8, z: 6 }));
      }
      e.setAnim('sshroom_idle');
      yield 0.9;
      // ---- burrow
      e.harmful = false;
      e.setAnim('sshroom_burrow', true);
      dust(w, e.x, e.y + 3, DIRT, 8, 50);
      yield 0.3;
      e.vulnerable = false;
      e.hidden = true;
      e.setAnim('sshroom_idle');
    }
  },
});

// ================================================================== 동굴 점액 (cave slime) — hopper + splitter
const JELLY = ramp('#e8a23a', 5);

function paintSlime(p: PixelPainter, W: number, H: number, sx: number, sy: number, eyes: 'open' | 'squint', core: boolean): void {
  const base = H - 1;
  const rx = (W / 2 - 1.5) * sx;
  const ry = (H - 2) * sy;
  const cx = W / 2;
  const cy = base;
  // dome (clipped at the base line) + a thin puddle skirt
  const tmp = new PixelPainter(W, H);
  tmp.ellipse(cx, cy, rx, ry, JELLY[2]);
  tmp.ellipse(cx, base - 0.5, Math.min(W / 2, rx * 1.12), 1.6, JELLY[2]);
  for (let y = 0; y <= base; y++) for (let x = 0; x < W; x++) if (tmp.isSet(x, y)) p.px(x, y, JELLY[2]);
  sphere(p, cx, cy - ry * 0.25, rx * 1.05, ry * 0.95, JELLY);
  // darker skirt where it touches the floor
  for (let x = 0; x < W; x++) if (p.isSet(x, base)) p.px(x, base, JELLY[1]);
  // nucleus + bubbles inside the jelly
  if (core) {
    p.circle(cx - rx * 0.3, cy - ry * 0.28, Math.max(1.2, rx * 0.2), JELLY[1]);
    p.px(Math.round(cx - rx * 0.36), Math.round(cy - ry * 0.36), JELLY[3]);
    p.circle(cx + rx * 0.5, cy - ry * 0.2, 0.9, JELLY[4]);
  }
  p.px(Math.round(cx - rx * 0.65), Math.round(cy - ry * 0.2), JELLY[4]);
  // glossy highlight streak
  p.line(Math.round(cx - rx * 0.62), Math.round(cy - ry * 0.45), Math.round(cx - rx * 0.32), Math.round(cy - ry * 0.8), '#fffbe8');
  p.px(Math.round(cx - rx * 0.12), Math.round(cy - ry * 0.9), '#fffbe8');
  // eyes
  const ey = Math.round(cy - ry * 0.55);
  const big = W > 14;
  const ex1 = Math.round(cx + rx * 0.02);
  const ex2 = Math.round(cx + rx * 0.48);
  if (eyes === 'open') {
    for (const ex of [ex1, ex2]) {
      p.rect(ex, ey - 1, 2, big ? 3 : 2, '#2a1004');
      p.px(ex, ey - 1, '#ffffff');
    }
  } else {
    p.rect(ex1, ey, 2, 1, '#2a1004');
    p.rect(ex2, ey, 2, 1, '#2a1004');
  }
  if (big) p.rect(Math.round(cx + rx * 0.2), ey + 3, 3, 1, '#5a2a08');
}
frames('cslime', 'idle', 2, 22, 17, (p, i) => paintSlime(p, 22, 17, i ? 1.04 : 1, i ? 0.92 : 1, 'open', true), { anchor: 'bottom', fps: 3 });
frames('cslime', 'crouch', 1, 22, 17, (p) => paintSlime(p, 22, 17, 1.12, 0.72, 'squint', true), { anchor: 'bottom' });
frames('cslime', 'air', 1, 22, 17, (p) => paintSlime(p, 22, 17, 0.84, 1.22, 'open', true), { anchor: 'bottom' });
frames('slimelet', 'idle', 2, 12, 10, (p, i) => paintSlime(p, 12, 10, i ? 1.06 : 1, i ? 0.9 : 1, 'open', false), { anchor: 'bottom', fps: 4 });
frames('slimelet', 'crouch', 1, 12, 10, (p) => paintSlime(p, 12, 10, 1.12, 0.72, 'squint', false), { anchor: 'bottom' });
frames('slimelet', 'air', 1, 12, 10, (p) => paintSlime(p, 12, 10, 0.86, 1.2, 'open', false), { anchor: 'bottom' });

function* slimeHop(e: Enemy, w: World, prefix: string, reach: number, time: number, height: number, warnR: number) {
  e.setAnim(`${prefix}_crouch`);
  e.telegraph(0.3);
  const tg = e.target(w);
  const s = stepToward(e.x, e.y, tg.x, tg.y, reach);
  const land = landingSpot(w, s.x + w.rng.range(-6, 6), s.y + w.rng.range(-6, 6), e.r);
  w.spawn(new GroundWarning(land.x, land.y, warnR, 0.3 + time, undefined, WARN_RED));
  e.facing = land.x >= e.x ? 1 : -1;
  yield 0.3;
  e.setAnim(`${prefix}_air`);
  yield* e.jumpTo(w, land.x, land.y, time, height);
  e.setAnim(`${prefix}_crouch`);
  w.sfx('splat', { vol: 0.5, pitch: prefix === 'cslime' ? 0.8 : 1.4 });
  w.particles.burst(e.x, e.y, { count: 8, speed: [30, 80], life: [0.25, 0.5], colors: ['#fff8e0', JELLY[3], JELLY[1]], size: [1, 2], gravity: 260, vz: [20, 60] });
}

defineEnemy({
  id: 'cave_slime',
  name: '동굴 점액',
  hp: 38,
  radius: 8,
  speed: 0,
  mass: 2,
  sprite: 'cslime_idle',
  spriteYOffset: 6,
  shadow: 18,
  cost: 2,
  floors: [2],
  weight: 1,
  champion: true,
  deathFx: 'goo',
  bloodColor: '#e8a23a',
  hurtSfx: 'splat',
  *script(e, w) {
    while (true) {
      e.setAnim('cslime_idle');
      yield w.rng.range(0.5, 0.9);
      yield* slimeHop(e, w, 'cslime', 64, 0.6, 28, 14);
      w.spawn(new RingFx(e.x, e.y, 22, 0.3, '#ffe0a0', 2));
      e.shootRing(w, 6, bullet('toxic', 3, { speed: 66, offset: w.rng.angle() }));
      w.shake(0.12);
      yield 0.25;
    }
  },
  onDeath(e, w) {
    for (const s of [-1, 1]) {
      const m = e.summon(w, 'slimeling', e.x + s * 7, e.y);
      if (m) {
        m.knock(s, 0.2, 140);
      }
    }
  },
});

defineEnemy({
  id: 'slimeling',
  name: '작은 점액',
  hp: 10,
  radius: 4,
  speed: 0,
  sprite: 'slimelet_idle',
  spriteYOffset: 4,
  shadow: 10,
  cost: 0.5,
  floors: [2],
  weight: 0.4,
  champion: true,
  deathFx: 'goo',
  bloodColor: '#e8a23a',
  hurtSfx: 'splat',
  *script(e, w) {
    yield w.rng.range(0.1, 0.4);
    while (true) {
      e.setAnim('slimelet_idle');
      yield w.rng.range(0.35, 0.7);
      yield* slimeHop(e, w, 'slimelet', 36, 0.36, 12, 7);
      yield 0.1;
    }
  },
});

// ================================================================== 포자 낭 (spore pod) — lobbed artillery
const POD = ramp('#a8467c', 5);

function paintPod(p: PixelPainter, k: number, mode: 'idle' | 'swell' | 'fire'): void {
  const sw = mode === 'swell' ? 1.12 : mode === 'fire' ? 0.92 : 1 + k * 0.04;
  const sh = mode === 'swell' ? 1.1 : mode === 'fire' ? 0.85 : 1 - k * 0.03;
  // roots
  p.ellipse(9.5, 18, 8, 1.6, '#3a1e2a');
  for (const [x0, x1, y1] of [[5, 0, 18], [6, 2, 19], [13, 18, 18], [12, 16, 19]] as const) p.line(x0, 17, x1, y1, '#4a2634');
  p.px(3, 17, '#6a3a4a');
  p.px(15, 17, '#6a3a4a');
  // bulb
  const rx = 7 * sw;
  const ry = 6.5 * sh;
  const cy = 17 - ry;
  p.ellipse(9, cy, rx, ry, POD[2]);
  sphere(p, 9, cy, rx, ry, POD);
  // veins
  p.line(4, Math.round(cy + 2), 7, Math.round(cy - 3), POD[1]);
  p.line(14, Math.round(cy + 2), 11, Math.round(cy - 3), POD[1]);
  p.line(9, Math.round(cy + 4), 9, Math.round(cy + 1), POD[1]);
  // glowing sacs
  const sac = mode === 'swell' ? '#f4ffb0' : '#b8ff4a';
  p.circle(5, cy + 1.5, 1.3, sac);
  p.circle(13, cy + 1, 1.5, sac);
  p.circle(10, cy + 3.5, 1, sac);
  // puckered opening on top
  const top = Math.round(cy - ry + 1);
  const ow = mode === 'fire' ? 3 : mode === 'swell' ? 1.2 : 2;
  p.ellipse(9, top + 1, ow + 1, 1.6, POD[0]);
  p.ellipse(9, top + 1, ow, 1, mode === 'fire' ? '#e8ff9a' : '#2a0a1a');
  if (mode === 'fire') {
    p.px(8, top - 1, '#e8ff9a');
    p.px(10, top - 2, '#b8ff4a');
  }
}
frames('spod', 'idle', 2, 19, 20, (p, i) => paintPod(p, i, 'idle'), { anchor: 'bottom', fps: 2 });
frames('spod', 'swell', 2, 19, 20, (p, i) => paintPod(p, i, i ? 'swell' : 'idle'), { anchor: 'bottom', fps: 10 });
frames('spod', 'fire', 1, 19, 20, (p) => paintPod(p, 0, 'fire'), { anchor: 'bottom' });

defineDrawnSprite('spod_glob', 8, 8, (p) => {
  p.circle(4, 4, 4, '#5aa020');
  sphere(p, 4, 4, 4, 4, ['#2a6a10', '#5aa020', '#a8ff3c', '#e8ffb0']);
  p.px(2, 2, '#ffffff');
  p.px(5, 5, '#2a6a10');
}, { outline: '#0a1e04' });

defineEnemy({
  id: 'spore_pod',
  name: '포자 낭',
  hp: 32,
  radius: 7,
  speed: 0,
  mass: Infinity,
  sprite: 'spod_idle',
  spriteYOffset: 5,
  shadow: 14,
  cost: 1.5,
  floors: [2],
  weight: 0.8,
  champion: true,
  deathFx: 'goo',
  bloodColor: '#a8467c',
  light: { radius: 22, color: '#b8ff4a' },
  *script(e, w) {
    yield w.rng.range(0.5, 1.5);
    while (true) {
      e.setAnim('spod_idle');
      yield w.rng.range(1.8, 2.6);
      e.setAnim('spod_swell');
      e.telegraph(0.65);
      w.sfx('charge', { vol: 0.3, pitch: 0.6 });
      gather(w, e.x, e.y - 14, ['#ffffff', '#b8ff4a'], 8, 14);
      yield 0.65;
      e.setAnim('spod_fire');
      const p = w.player;
      const tx = p.x + p.vx * 0.35;
      const ty = p.y + p.vy * 0.35;
      const n = e.champion ? 4 : 3;
      const pts = volleyTargets(e.x, e.y, tx, ty, n, 30);
      for (const pt of pts) {
        const land = landingSpot(w, pt.x, pt.y, 3);
        lob(w, e.x, e.y - 14, land.x, land.y, {
          sprite: 'spod_glob', color: BUL.toxic.color, time: 1.0, height: 52, warn: 12, hitRadius: 11, source: '포자 낭',
          onLand: (ww, x, y) => ww.spawn(new Hazard(x, y, 12, 2.2, 'poison', '포자 낭')),
        });
        w.particles.burst(e.x, e.y - 16, { count: 6, speed: [20, 50], angle: -Math.PI / 2, spread: 1, life: [0.3, 0.5], colors: ['#e8ffb0', '#b8ff4a'], size: [1, 2] });
        e.squash(0.8, 1.25);
        w.sfx('splat', { vol: 0.4, pitch: 1.4 });
        yield 0.16;
      }
      yield 0.3;
    }
  },
});

// ================================================================== 가루 나방 (dust moth) — orbiting flyer
const MOTH_WING = ramp('#d8c69a', 5);
const MOTH_BODY = ramp('#7a5a44', 4);

function paintMoth(p: PixelPainter, open: number, flare: boolean): void {
  // open: 0 = wings spread, 1 = half, 2 = raised (narrow)
  const tipX = [1, 3, 6][open];
  const tipY = [1, 0, 0][open];
  const lowY = [10, 9, 8][open];
  // hind wing
  p.poly([10, 8, tipX + 2, lowY + 1, tipX + 4, lowY + 4, 9, 11], MOTH_WING[1]);
  // fore wing
  p.poly([10, 5, tipX + 1, tipY, tipX - 1 < 0 ? 0 : tipX - 1, tipY + 4, tipX + 1, lowY, 10, 8], MOTH_WING[3]);
  p.line(10, 5, tipX + 1, tipY, MOTH_WING[4]);
  p.line(tipX, tipY + 2, tipX + 1, lowY - 1, MOTH_WING[0]);
  // eye spot
  if (open < 2) {
    const ex = tipX + 4;
    const ey = tipY + 4;
    p.circle(ex, ey, 1.8, flare ? '#ffb040' : '#d0782a');
    p.px(Math.floor(ex), Math.floor(ey), '#2a1424');
    p.px(Math.floor(ex) - 1, Math.floor(ey) - 1, '#ffffff');
  }
  // antennae
  p.line(9, 3, 6, 0, MOTH_BODY[1]);
  p.px(5, 0, MOTH_BODY[2]);
  p.px(7, 1, MOTH_BODY[2]);
  // furry body
  p.ellipse(10.5, 7.5, 2.2, 5, MOTH_BODY[2]);
  sphere(p, 10.5, 7.5, 2.2, 5, MOTH_BODY, false);
  p.px(10, 9, MOTH_BODY[0]);
  p.px(10, 11, MOTH_BODY[0]);
  p.circle(10.5, 3.5, 1.8, MOTH_BODY[3]);
  p.px(9, 3, '#1a0a10');
  p.mirrorX();
}
frames('dmoth', 'fly', 4, 21, 14, (p, i) => paintMoth(p, [0, 1, 2, 1][i], false), { fps: 14 });
frames('dmoth', 'flare', 2, 21, 14, (p, i) => paintMoth(p, i ? 0 : 1, true), { fps: 16 });
// fuzzy wing-scale powder: a spiky lilac puff, clearly not a coin or a tear
defineDrawnSprite('dmoth_dust', 9, 9, (p) => {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    p.line(4, 4, Math.round(4 + Math.cos(a) * 4), Math.round(4 + Math.sin(a) * 4), i % 2 ? '#8a62c8' : '#b894f0');
  }
  p.circle(4.5, 4.5, 2.6, '#d8c0ff');
  p.circle(4, 4, 1.4, '#f6eeff');
  p.px(3, 3, '#ffffff');
}, { outline: '#1c0c30' });

defineEnemy({
  id: 'dust_moth',
  name: '가루 나방',
  hp: 18,
  radius: 5,
  speed: 54,
  flying: true,
  sprite: 'dmoth_fly',
  shadow: 10,
  spriteYOffset: -9,
  cost: 1,
  floors: [2],
  weight: 1.1,
  champion: true,
  deathFx: 'spore',
  bloodColor: '#e8d8a8',
  light: { radius: 16, color: '#ffe0a0' },
  *script(e, w) {
    let a = Math.atan2(e.y - w.player.y, e.x - w.player.x);
    let dir = w.rng.sign();
    let next = w.rng.range(1.2, 2.2);
    while (true) {
      e.setAnim('dmoth_fly');
      for (let el = 0; el < next; el += w.dt) {
        a += dir * 1.05 * w.dt;
        const tg = e.target(w);
        const R = 64 + Math.sin(e.age * 1.7) * 8;
        const gx = tg.x + Math.cos(a) * R;
        const gy = tg.y + Math.sin(a) * R * 0.75;
        e.moveDir(gx - e.x, gy - e.y, Math.min(e.speed, Math.hypot(gx - e.x, gy - e.y) * 3));
        if (e.mem.__bumped) dir = -dir;
        if (fx.chance(0.2)) {
          w.particles.spawn({ x: e.x + fx.range(-5, 5), y: e.y - 9 + fx.range(-2, 2), vy: fx.range(4, 12), life: fx.range(0.4, 0.8), colors: ['#fff4c0', '#d8c69a'], size: 1, alpha: 0.8 });
        }
        yield;
      }
      // dust volley: three motes that slow down and hang in the air
      e.stop();
      e.setAnim('dmoth_flare');
      e.telegraph(0.4);
      w.sfx('whoosh', { vol: 0.3, pitch: 0.8 });
      yield 0.4;
      e.shootAt(w, null, {
        count: e.champion ? 5 : 3, spread: 0.42, speed: 78, accel: -52, minSpeed: 0, life: 2.8, z: 9, radius: 3,
        color: '#d8b8ff', sprite: 'dmoth_dust', spriteRotates: true, curve: 1.5, light: 14,
      });
      next = w.rng.range(1.8, 2.6);
      if (w.rng.chance(0.3)) dir = -dir;
    }
  },
  draw(e, r) {
    e.drawDefault(r, e.frame(), -9 + Math.sin(e.age * 6) * 1.5);
  },
});

// ================================================================== 동굴 거머리 (cave leech) — leaper
const LEECH = ramp('#6a1e46', 5);

function paintLeech(p: PixelPainter, k: number, mode: 'crawl' | 'rear' | 'leap'): void {
  // segments from tail (left) to head (right)
  let segs: [number, number, number][];
  if (mode === 'crawl') {
    const hump = [0, 2, 1][k];
    const len = [0, -2, -1][k];
    segs = [
      [3, 8, 2], [6 + len * 0.3, 7.5 - hump * 0.3, 2.6], [9 + len * 0.5, 7 - hump, 3], [12 + len * 0.6, 7.5 - hump * 0.5, 2.8], [15 + len * 0.7, 8, 2.6],
    ];
  } else if (mode === 'rear') {
    segs = [[3, 8, 2], [6, 7.5, 2.6], [9, 6.5, 2.9], [11.5, 4.5, 2.7], [13.5, 2.8, 2.6]];
  } else {
    segs = [[2, 7, 1.8], [6, 6.5, 2.4], [10, 6, 2.7], [14, 5.5, 2.6], [17, 5, 2.5]];
  }
  for (const [x, y, r] of segs) p.ellipse(x, y, r, r * 0.9, LEECH[2]);
  for (const [x, y, r] of segs) sphere(p, x, y - 0.3, r, r * 0.9, LEECH);
  // pale belly stripe + segment rings
  for (let i = 0; i < segs.length - 1; i++) {
    const [x, y, r] = segs[i];
    p.px(Math.round(x), Math.round(y + r * 0.6), '#d07a90');
    p.px(Math.round(x + r * 0.7), Math.round(y - r * 0.2), LEECH[0]);
  }
  // sucker mouth
  const [hx, hy, hr] = segs[segs.length - 1];
  if (mode === 'crawl') {
    p.px(Math.round(hx + hr * 0.5), Math.round(hy - 0.5), '#ffd8e0');
    p.px(Math.round(hx + 0.2), Math.round(hy - hr * 0.6), '#ff5a5a');
  } else {
    p.circle(hx + 0.6, hy, hr * 0.75, '#1a0610');
    p.ring(hx + 0.6, hy, hr * 0.75, 1, '#ffd8e0');
    p.px(Math.round(hx + 0.6), Math.round(hy), '#ff5a7a');
  }
  // gloss
  p.px(Math.round(segs[2][0] - 1), Math.round(segs[2][1] - segs[2][2] * 0.6), '#ffb0d0');
}
frames('cleech', 'crawl', 3, 20, 11, (p, i) => paintLeech(p, i, 'crawl'), { anchor: 'bottom', fps: 6 });
frames('cleech', 'rear', 2, 20, 11, (p) => paintLeech(p, 0, 'rear'), { anchor: 'bottom', fps: 6 });
frames('cleech', 'leap', 1, 20, 11, (p) => paintLeech(p, 0, 'leap'), { anchor: 'bottom' });

defineEnemy({
  id: 'cave_leech',
  name: '동굴 거머리',
  hp: 28,
  radius: 5,
  speed: 26,
  sprite: 'cleech_crawl',
  spriteYOffset: 4,
  shadow: 14,
  cost: 1.5,
  floors: [2],
  weight: 1,
  champion: true,
  deathFx: 'blood',
  bloodColor: '#8a1a3a',
  hurtSfx: 'splat',
  *script(e, w) {
    while (true) {
      e.setAnim('cleech_crawl');
      yield* e.chaseFor(w, w.rng.range(1.3, 2.1), e.speed);
      const p = w.player;
      if (e.distToTarget(w) < 125 && w.room.lineOfSight(e.x, e.y, p.x, p.y)) {
        e.halt();
        e.setAnim('cleech_rear');
        e.facing = p.x >= e.x ? 1 : -1;
        const s = stepToward(e.x, e.y, p.x, p.y, 100);
        const land = landingSpot(w, s.x, s.y, e.r);
        w.spawn(new GroundWarning(land.x, land.y, 10, 0.5 + 0.42, undefined, WARN_RED));
        e.telegraph(0.5);
        w.sfx('enemy_roar', { vol: 0.3, pitch: 1.9 });
        yield 0.5;
        e.setAnim('cleech_leap');
        yield* e.jumpTo(w, land.x, land.y, 0.42, 16);
        w.particles.burst(e.x, e.y, { count: 8, speed: [30, 70], life: [0.2, 0.4], colors: ['#8a1a3a', '#d07a90'], size: [1, 2], gravity: 260, vz: [20, 50] });
        e.setAnim('cleech_crawl');
        yield 0.6;
      }
    }
  },
});

// ================================================================== 독가스 부풀이 (gas bloater) — exploder
const SAC = ramp('#b6c44a', 5);

function paintBloater(p: PixelPainter, k: number, swell: number): void {
  const R = 6.5 + swell * 1.1;
  const cy = 19 - 3 - R;
  // stubby legs
  if (swell === 0) {
    const s = k ? 1 : 0;
    p.rect(5 + s, 17, 2, 2, '#4a4a1a');
    p.rect(13 - s, 17, 2, 2, '#4a4a1a');
    p.rect(8 - s, 18, 2, 1, '#3a3a14');
    p.rect(11 + s, 18, 2, 1, '#3a3a14');
  } else {
    p.rect(5, 17, 2, 2, '#4a4a1a');
    p.rect(13, 17, 2, 2, '#4a4a1a');
  }
  // gas sac
  const base = swell >= 2 ? '#d6e05a' : SAC[2];
  p.circle(10, cy, R, base);
  sphere(p, 10, cy, R, R, swell >= 2 ? ramp('#d6e05a', 5) : SAC);
  // bulges / veins
  p.line(Math.round(10 - R * 0.7), Math.round(cy - 1), Math.round(10 - R * 0.2), Math.round(cy + R * 0.5), SAC[1]);
  p.line(Math.round(10 + R * 0.6), Math.round(cy - R * 0.4), Math.round(10 + R * 0.2), Math.round(cy + R * 0.3), SAC[1]);
  // glowing pores
  const pore = swell >= 1 ? '#ffffff' : '#eaff8a';
  p.circle(10 - R * 0.35, cy - R * 0.45, 1, pore);
  p.px(Math.round(10 + R * 0.4), Math.round(cy - R * 0.1), pore);
  p.px(Math.round(10 - R * 0.1), Math.round(cy + R * 0.15), pore);
  if (swell >= 2) {
    // cracks of light about to burst
    p.line(Math.round(10 + R * 0.1), Math.round(cy - R * 0.8), Math.round(10 + R * 0.3), Math.round(cy - R * 0.3), '#ffffff');
    p.line(Math.round(10 - R * 0.6), Math.round(cy + R * 0.2), Math.round(10 - R * 0.3), Math.round(cy + R * 0.5), '#ffffff');
  }
  // little face on the front-bottom
  const fy = Math.round(cy + R * 0.45);
  p.px(8, fy, '#1a1a08');
  p.px(12, fy, '#1a1a08');
  p.rect(9, fy + 2, 3, 1, swell ? '#1a1a08' : '#5a5a1a');
}
frames('bloater', 'walk', 2, 20, 20, (p, i) => paintBloater(p, i, 0), { anchor: 'bottom', fps: 4 });
frames('bloater', 'swell', 3, 20, 20, (p, i) => paintBloater(p, 0, i + 1), { anchor: 'bottom', fps: 3.4, loop: false });

function bloaterBlast(w: World, x: number, y: number, radius: number, e: Enemy | null): void {
  w.explode(x, y, radius, 22, { hurtsPlayer: true, byPlayer: false, color: '#b4ff4a', source: e });
  w.spawn(new Hazard(x, y, Math.round(radius * 0.6), 2.6, 'poison', '독가스 부풀이'));
  w.particles.burst(x, y - 4, { count: 26, speed: [20, 90], life: [0.6, 1.2], colors: ['#e8ffb0', '#b4ff4a', '#6a9a2a'], size: [2, 4], sizeEnd: 6, drag: 3 });
}

defineEnemy({
  id: 'gas_bloater',
  name: '독가스 부풀이',
  hp: 20,
  radius: 6,
  speed: 26,
  sprite: 'bloater_walk',
  spriteYOffset: 5,
  shadow: 14,
  cost: 1.5,
  floors: [2],
  weight: 0.7,
  champion: true,
  deathFx: 'spore',
  bloodColor: '#b6c44a',
  light: { radius: 16, color: '#d0ff60' },
  hurtSfx: 'splat',
  *script(e, w) {
    let near = 0;
    while (true) {
      e.setAnim('bloater_walk');
      e.chase(w, e.speed);
      near = e.distToTarget(w) < 40 ? near + w.dt : Math.max(0, near - w.dt);
      if (near > 0.15) break;
      yield;
    }
    // fuse: swell up and burst
    e.halt();
    e.setAnim('bloater_swell', true);
    e.telegraph(0.9);
    w.spawn(new GroundWarning(e.x, e.y, 30, 0.9, undefined, '#a0ff30'));
    w.sfx('fuse', { vol: 0.6 });
    for (let el = 0; el < 0.9; el += w.dt) {
      e.squash(1 + Math.sin(el * 40) * 0.06, 1 - Math.sin(el * 40) * 0.06);
      yield;
    }
    e.mem.exploded = true;
    bloaterBlast(w, e.x, e.y, 30, e);
    w.killEnemy(e);
  },
  onDeath(e, w) {
    if (e.mem.exploded) return;
    // popped early: it still bursts after a short, clearly marked delay
    const x = e.x;
    const y = e.y;
    w.spawn(new GroundWarning(x, y, 24, 0.55, (ww) => bloaterBlast(ww, x, y, 24, null), '#a0ff30'));
    w.sfx('fuse', { vol: 0.5, pitch: 1.4 });
  },
});
