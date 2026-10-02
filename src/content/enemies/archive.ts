// Floor 6 — 수몰된 서고 (drowned archive), part 1:
//  - 잉크 방울 (ink droplet) + 잉크 구슬 (ink bead): hopping ink fodder; every landing leaves a
//    slowing puddle, and a droplet splits into two beads when it dies
//  - 종이 나방 (paper moth): erratic swarm flier; dives down a telegraphed lane, and when a
//    scribe finishes a line the moths nearby dive together with its glyphs
//  - 익사한 필경사 (drowned scribe): writes a row of glyphs in the air that wait, then fire
//    one after another at the player; slams its book if you get close
//  - 책 더미 미믹 (book-pile mimic): pixel-identical to a book pile until you come close or
//    hit it; snaps, fans pages, hops after you, then settles back into a pile

import { defineEnemy } from '../../game/defs';
import { PixelPainter } from '../../engine/painter';
import { GroundWarning, RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { TAU } from '../../engine/math';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Script } from '../../engine/script';
import { dust, frames, gather, hurtFrame, landingSpot, laneWarning, rayFree, sphere, stepToward, WARN_RED } from './shared';
import {
  AOUT, CYAN, glyphShot, INKB, INKDUST, inkGlyph, InkPool, inkSplash, pageShot, pages, paintBookStack, PAPER,
} from './archive-shared';

// ================================================================== 잉크 방울 (ink droplet)
function paintDroplet(p: PixelPainter, k: number, mode: 'idle' | 'crouch' | 'air' | 'hurt', small: boolean): void {
  const sx = mode === 'crouch' ? 1.22 : mode === 'air' ? 0.82 : mode === 'hurt' ? 1.1 : k ? 1.06 : 1;
  const sy = mode === 'crouch' ? 0.72 : mode === 'air' ? 1.25 : mode === 'hurt' ? 0.9 : k ? 0.93 : 1;
  const base = small ? 8 : 11;
  const rx = (small ? 3.6 : 5.4) * sx;
  const ry = (small ? 3 : 4.4) * sy;
  const cx = small ? 4.5 : 6.5;
  const cy = base - ry;
  p.ellipse(cx, cy + 0.5, rx, ry, INKB[2]);
  for (let x = 0; x < p.w; x++) for (let y = base; y < p.h; y++) p.px(x, y, null);
  // teardrop peak
  const tip = mode === 'air' ? 3 : 2;
  p.poly([cx - rx * 0.45, cy - ry + 1, cx + (k ? 0.5 : -0.5) * (mode === 'idle' ? 1 : 0), cy - ry - tip, cx + rx * 0.45, cy - ry + 1], INKB[2]);
  sphere(p, cx, cy, rx, ry, INKB, false);
  // glossy specular
  p.px(Math.round(cx - rx * 0.5), Math.round(cy - ry * 0.35), '#8ad8ff');
  p.px(Math.round(cx - rx * 0.5) + 1, Math.round(cy - ry * 0.55), '#d8f8ff');
  // eyes
  const ey = Math.round(cy - ry * 0.1);
  const ex = Math.round(rx * 0.45);
  if (mode === 'hurt') {
    p.line(Math.round(cx) - ex - 1, ey - 1, Math.round(cx) - ex + 1, ey + 1, CYAN.low);
    p.line(Math.round(cx) + ex - 1, ey - 1, Math.round(cx) + ex + 1, ey + 1, CYAN.low);
  } else {
    p.px(Math.round(cx) - ex, ey, CYAN.mid);
    p.px(Math.round(cx) + ex, ey, CYAN.mid);
    p.px(Math.round(cx) - ex, ey - 1, CYAN.hot);
  }
  for (let x = 0; x < p.w; x++) if (p.isSet(x, base - 1)) p.px(x, base - 1, INKB[0]);
}
for (const small of [false, true]) {
  const pre = small ? 'ibead' : 'idrop';
  const w = small ? 9 : 13;
  const h = small ? 9 : 12;
  frames(pre, 'idle', 2, w, h, (p, i) => paintDroplet(p, i, 'idle', small), { anchor: 'bottom', fps: 3, outline: AOUT });
  frames(pre, 'crouch', 1, w, h, (p) => paintDroplet(p, 0, 'crouch', small), { anchor: 'bottom', outline: AOUT });
  frames(pre, 'air', 1, w, h, (p) => paintDroplet(p, 0, 'air', small), { anchor: 'bottom', outline: AOUT });
  frames(pre, 'hurt', 1, w, h, (p) => paintDroplet(p, 0, 'hurt', small), { anchor: 'bottom', outline: AOUT });
}

/** Hop toward the player; every landing splashes a slowing puddle of ink. */
function* dropletScript(e: Enemy, w: World, pre: string, hop: number, poolR: number): Script {
  yield w.rng.range(0.2, 0.6);
  while (true) {
    e.setAnim(`${pre}_idle`);
    yield w.rng.range(0.35, 0.7);
    e.setAnim(`${pre}_crouch`);
    e.telegraph(0.22);
    const tg = e.target(w) as { x: number; y: number; vx?: number; vy?: number };
    // lead the target a little
    const s = stepToward(e.x, e.y, tg.x + (tg.vx ?? 0) * 0.2, tg.y + (tg.vy ?? 0) * 0.2, hop);
    const land = landingSpot(w, s.x, s.y, e.r);
    w.spawn(new GroundWarning(land.x, land.y, poolR, 0.22 + 0.36, undefined, WARN_RED));
    yield 0.22;
    e.setAnim(`${pre}_air`);
    yield* e.jumpTo(w, land.x, land.y, 0.36, 14);
    e.setAnim(`${pre}_idle`);
    w.spawn(new InkPool(e.x, e.y + 1, poolR, 2.4));
    inkSplash(w, e.x, e.y, poolR / 10);
    w.sfx('ink_splash', { vol: 0.45, pitch: fx.range(0.9, 1.2) });
    yield 0.1;
  }
}

defineEnemy({
  id: 'ink_droplet',
  name: '잉크 방울',
  hp: 14,
  radius: 5,
  speed: 50,
  sprite: 'idrop_idle',
  spriteYOffset: 4,
  shadow: 11,
  cost: 0.7,
  floors: [6],
  weight: 1.2,
  champion: true,
  deathFx: 'goo',
  bloodColor: '#141c36',
  dieSfx: 'splat',
  light: { radius: 12, color: CYAN.mid },
  script(e, w) {
    return dropletScript(e, w, 'idrop', 46, 9);
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'idrop_hurt_0'));
  },
  onDeath(e, w) {
    inkSplash(w, e.x, e.y, 1.4);
    w.spawn(new InkPool(e.x, e.y + 1, 11, 2.8));
    w.sfx('ink_splash', { vol: 0.6, pitch: 0.8 });
    // splits into two beads flung apart
    for (const side of [-1, 1]) {
      const b = e.summon(w, 'ink_bead', e.x + side * 7, e.y);
      if (!b) continue;
      b.mem.owner = e;
      b.dormant = 0.45;
      b.knock(side, 0, 150);
    }
  },
});

defineEnemy({
  id: 'ink_bead',
  name: '잉크 구슬',
  hp: 6,
  radius: 3,
  speed: 60,
  sprite: 'ibead_idle',
  spriteYOffset: 3,
  shadow: 7,
  cost: 0.3,
  champion: false,
  deathFx: 'goo',
  bloodColor: '#141c36',
  dieSfx: 'splat',
  light: { radius: 8, color: CYAN.mid },
  script(e, w) {
    return dropletScript(e, w, 'ibead', 34, 6);
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'ibead_hurt_0'));
  },
  onDeath(e, w) {
    inkSplash(w, e.x, e.y, 0.7);
  },
});

// ================================================================== 종이 나방 (paper moth)
function paintMoth(p: PixelPainter, k: number, mode: 'flap' | 'poise' | 'dive' | 'hurt'): void {
  // wing spread per frame: wide, mid, raised
  const spread = mode === 'flap' ? [1, 0.7, 0.35][k] : mode === 'poise' ? 1.05 : mode === 'dive' ? 0.5 : 0.8;
  const back = mode === 'dive' ? 3 : 0;
  const cx = 7;
  const cy = 6;
  const wing = (dir: number) => {
    const tip = cx + dir * 7;
    const top = cy - 4 * spread + back;
    const bot = cy + 3 * spread + back;
    p.poly([cx + dir * 1, cy - 1, tip, top, tip + dir * 0 - dir * 1, cy + 1 + back * 0.5, tip - dir * 1, bot, cx + dir * 1, cy + 2], PAPER[2]);
    // edges and veins
    p.line(cx + dir * 2, cy - 1, tip, top, PAPER[3]);
    p.line(cx + dir * 2, cy + 1, tip - dir * 1, bot, PAPER[1]);
    p.line(cx + dir * 2, cy, tip - dir * 1, cy + back * 0.5, PAPER[1]);
    // ink-blot eyespot with a bright centre
    const ex = Math.round(cx + dir * 4.5);
    const ey = Math.round(cy - 1.2 * spread + back * 0.6);
    if (spread > 0.45) {
      p.px(ex, ey, mode === 'hurt' ? '#8a3a3a' : '#1a1a2a');
      p.px(ex - dir, ey, '#1a1a2a');
      p.px(ex, ey + 1, '#1a1a2a');
      if (mode !== 'hurt') p.px(ex, ey, CYAN.mid);
    }
  };
  wing(-1);
  wing(1);
  // fuzzy body
  p.ellipse(cx, cy + 0.5, 1.6, 3.2, '#2a2430');
  p.px(cx, cy - 2, '#4a4452');
  p.px(cx, cy - 1, '#3a3444');
  p.px(cx, cy + 2, '#1a1620');
  // antennae
  p.px(cx - 1, cy - 4, '#3a3444');
  p.px(cx + 1, cy - 4, '#3a3444');
  p.px(cx - 2, cy - 5, PAPER[1]);
  p.px(cx + 2, cy - 5, PAPER[1]);
}
frames('pmoth', 'flap', 3, 15, 11, (p, i) => paintMoth(p, i, 'flap'), { fps: 14, outline: AOUT });
frames('pmoth', 'poise', 1, 15, 11, (p) => paintMoth(p, 0, 'poise'), { outline: AOUT });
frames('pmoth', 'dive', 1, 15, 11, (p) => paintMoth(p, 0, 'dive'), { outline: AOUT });
frames('pmoth', 'hurt', 1, 15, 11, (p) => paintMoth(p, 0, 'hurt'), { outline: AOUT });

/** Does a scribe's line fire within the next `window` seconds? (moths dive with it) */
export function scribeCue(now: number, castT: number | undefined, window = 0.45): boolean {
  if (castT === undefined) return false;
  return castT - now <= window && castT - now > -0.05;
}

defineEnemy({
  id: 'paper_moth',
  name: '종이 나방',
  hp: 12,
  radius: 4,
  speed: 58,
  flying: true,
  sprite: 'pmoth_flap',
  shadow: 8,
  spriteYOffset: -7,
  cost: 0.7,
  floors: [6],
  weight: 1.1,
  champion: true,
  deathFx: 'none',
  bloodColor: '#d8c8a0',
  light: { radius: 10, color: '#d8c8a0' },
  init(e, w) {
    e.mem.ph = w.rng.range(0, TAU);
    e.mem.side = w.rng.sign();
    e.mem.lastDive = -9;
  },
  *script(e, w) {
    yield w.rng.range(0.1, 0.7);
    while (true) {
      e.setAnim('pmoth_flap');
      const t = w.rng.range(2.0, 3.2);
      let synced = false;
      for (let el = 0; el < t; el += w.dt) {
        const tg = e.target(w);
        // flutter around the player on a wobbly orbit
        const a = Math.atan2(e.y - tg.y, e.x - tg.x) + e.mem.side * 0.7 * w.dt + Math.sin(e.age * 2.3 + e.mem.ph) * 0.5;
        const gx = tg.x + Math.cos(a) * 78;
        const gy = tg.y + Math.sin(a) * 60;
        const ga = Math.atan2(gy - e.y, gx - e.x) + Math.sin(e.age * 7 + e.mem.ph) * 1.1;
        e.moveAngle(ga, Math.min(e.speed, Math.hypot(gx - e.x, gy - e.y) * 2 + 20));
        if (e.mem.__bumped) e.mem.side = -e.mem.side;
        // a scribe nearby finished a line: dive with the glyphs
        const cue = w.vars.__scribeCastT;
        if (scribeCue(w.time, cue) && e.mem.syncT !== cue && e.age - e.mem.lastDive > 1.2) {
          e.mem.syncT = cue;
          synced = true;
          break;
        }
        yield;
      }
      const p = w.player;
      if (e.distToTarget(w) > 170 || !w.room.lineOfSight(e.x, e.y, p.x, p.y)) continue;
      // the swarm staggers its dives (a synced dive ignores the stagger)
      if (!synced && w.time < (w.vars.__mothDiveT ?? 0)) continue;
      w.vars.__mothDiveT = w.time + 0.3;
      e.halt();
      e.setAnim('pmoth_poise');
      const a = e.angleToTarget(w);
      e.facing = Math.cos(a) >= 0 ? 1 : -1;
      const len = Math.min(150, rayFree(w.room, e.x, e.y, a, e.r, 150, true) + 24);
      laneWarning(w, e.x, e.y, a, len, 10, 0.35);
      e.telegraph(0.35);
      w.sfx('paper_flutter', { vol: 0.4, pitch: fx.range(1.1, 1.3) });
      yield 0.35;
      e.setAnim('pmoth_dive');
      e.mem.lastDive = e.age;
      w.sfx('whoosh', { vol: 0.35, pitch: 1.4 });
      yield* e.charge(w, a, 235, 0.42);
      pages(w, e.x, e.y - 7, 2, 30);
      e.setAnim('pmoth_flap');
      yield 0.4;
    }
  },
  update(e, w) {
    if (fx.chance(0.06)) {
      w.particles.spawn({ x: e.x + fx.range(-5, 5), y: e.y - 7 + fx.range(-3, 3), vx: fx.range(-6, 6), vy: fx.range(2, 8), life: fx.range(0.4, 0.8), colors: [PAPER[2], PAPER[1]], size: 1, alpha: 0.8 });
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'pmoth_hurt_0'), -7 + Math.sin(e.age * 5 + e.id) * 1.5);
  },
  onDeath(e, w) {
    pages(w, e.x, e.y - 7, 6, 50);
    w.sfx('paper_flutter', { vol: 0.5, pitch: 0.8 });
  },
});

// ================================================================== 익사한 필경사 (drowned scribe)
const ROBE = ['#0c1424', '#182440', '#243660', '#34507e'];
const DROWNED = ['#4a6a78', '#7a9aa6', '#a8c4cc'];

function paintScribe(p: PixelPainter, k: number, mode: 'idle' | 'write' | 'hurt'): void {
  const bob = mode === 'idle' ? [0, 1][k] : mode === 'hurt' ? 1 : 0;
  // waterlogged robe, hem heavy and dark
  p.poly([5, 9 + bob, 12, 9 + bob, 15, 25, 2, 25], ROBE[2]);
  p.shadeVertical(2, 9 + bob, 14, 17, [ROBE[3], ROBE[2], ROBE[2], ROBE[1], ROBE[0]], false);
  for (let x = 2; x < 16; x++) if (p.isSet(x, 24) && (x * 5) % 7 < 3) p.px(x, 24, '#0a1a24');
  p.line(8, 12 + bob, 7, 24, ROBE[1]);
  p.rect(14, 14, 1, 11, ROBE[1]);
  // rope belt with a bottle of ink
  p.rect(4, 15 + bob, 9, 1, '#6a5a3a');
  p.rect(11, 16 + bob, 2, 3, INKB[1]);
  p.px(11, 16 + bob, '#3a7a8a');
  // hunched hood
  p.ellipse(8.5, 7 + bob, 4.6, 4.2, ROBE[2]);
  sphere(p, 8.5, 7 + bob, 4.6, 4.2, ROBE, false);
  p.poly([5, 5 + bob, 8, 1 + bob, 12, 5 + bob], ROBE[2]);
  // drowned face: pale, swollen, cyan eyes
  p.ellipse(9, 8.5 + bob, 2.8, 2.6, DROWNED[1]);
  p.px(8, 7 + bob, DROWNED[2]);
  p.px(10, 10 + bob, DROWNED[0]);
  if (mode === 'hurt') {
    p.px(8, 8 + bob, ROBE[0]);
    p.px(10, 8 + bob, ROBE[0]);
  } else {
    p.px(8, 8 + bob, CYAN.mid);
    p.px(10, 8 + bob, CYAN.mid);
    p.px(8, 9 + bob, CYAN.low);
  }
  // the book in the left hand, dripping
  p.rect(1, 14 + bob, 6, 4, '#5a1e2a');
  p.rect(2, 14 + bob, 4, 3, PAPER[2]);
  p.px(3, 15 + bob, '#5a5068');
  p.px(2, 19 + bob + (k % 2), '#6ab8c4');
  // writing hand + quill
  if (mode === 'write') {
    p.line(12, 11 + bob, 15, 5 + bob, DROWNED[1]);
    p.line(15, 5 + bob, 16, 1 + bob, PAPER[3]);
    p.px(16, 1 + bob, k ? CYAN.hot : CYAN.mid);
    p.px(16, 0 + bob, CYAN.mid);
  } else {
    p.line(12, 11 + bob, 14, 15 + bob, DROWNED[1]);
    p.line(14, 15 + bob, 16, 12 + bob, PAPER[3]);
  }
  // weed hanging from the hood
  p.px(4, 8 + bob, '#1a5c58');
  p.px(4, 9 + bob, '#2a8a80');
}
frames('dscribe', 'idle', 2, 17, 26, (p, i) => paintScribe(p, i, 'idle'), { anchor: 'bottom', fps: 2, outline: AOUT });
frames('dscribe', 'write', 2, 17, 26, (p, i) => paintScribe(p, i, 'write'), { anchor: 'bottom', fps: 8, outline: AOUT });
frames('dscribe', 'hurt', 1, 17, 26, (p) => paintScribe(p, 0, 'hurt'), { anchor: 'bottom', outline: AOUT });

/** Spots of a written glyph line: `n` points across the aim direction, `spacing` apart, `dist` ahead of (x, y). */
export function glyphLine(x: number, y: number, aim: number, n: number, spacing: number, dist: number): { x: number; y: number }[] {
  const px = -Math.sin(aim);
  const py = Math.cos(aim);
  const cx = x + Math.cos(aim) * dist;
  const cy = y + Math.sin(aim) * dist;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const s = i - (n - 1) / 2;
    out.push({ x: cx + px * s * spacing, y: cy + py * s * spacing * 0.8 });
  }
  return out;
}

defineEnemy({
  id: 'drowned_scribe',
  name: '익사한 필경사',
  hp: 40,
  radius: 6,
  speed: 24,
  mass: 1.5,
  sprite: 'dscribe_idle',
  spriteYOffset: 6,
  shadow: 13,
  cost: 2.5,
  floors: [6],
  weight: 0.8,
  champion: true,
  deathFx: 'blood',
  bloodColor: '#243660',
  light: { radius: 18, color: CYAN.mid },
  *script(e, w) {
    yield w.rng.range(0.5, 1.1);
    let side = w.rng.sign();
    while (true) {
      e.setAnim('dscribe_idle');
      const t = w.rng.range(1.6, 2.3);
      for (let el = 0; el < t; el += w.dt) {
        const d = e.distToTarget(w);
        const a = e.angleToTarget(w);
        if (d < 80) e.moveAngle(a + Math.PI + side * 0.5, e.speed * 1.35);
        else if (d > 150) e.chase(w, e.speed);
        else e.moveAngle(a + (side * Math.PI) / 2, e.speed * 0.8);
        if (e.mem.__bumped) side = -side;
        yield;
      }
      e.halt();
      e.facing = w.player.x >= e.x ? 1 : -1;
      if (e.distToTarget(w) < 56) {
        // too close: slams the book shut, a ring of glyphs bursts out
        e.setAnim('dscribe_write');
        e.telegraph(0.45);
        w.spawn(new GroundWarning(e.x, e.y, 26, 0.45, undefined, WARN_RED));
        w.sfx('paper_flutter', { vol: 0.5, pitch: 0.9 });
        yield 0.45;
        e.squash(1.25, 0.8);
        e.shootRing(w, e.champion ? 8 : 6, glyphShot(3, 1, { speed: 82, offset: w.rng.angle(), z: 8, range: 220 }));
        inkSplash(w, e.x, e.y, 1);
        yield 0.6;
        continue;
      }
      // writes a row of glyphs that fire one after the other
      e.setAnim('dscribe_write');
      const n = e.champion ? 8 : 6;
      e.telegraph(0.6 + n * 0.08);
      w.sfx('paper_flutter', { vol: 0.45, pitch: 1.2 });
      const a = e.angleToTarget(w);
      const spots = glyphLine(e.x, e.y - 8, a, n, 10, 22);
      // the first glyph fires 0.7 s after it is written; nearby moths dive with it
      w.vars.__scribeCastT = w.time + 0.7;
      for (let i = 0; i < n; i++) {
        const s = spots[i];
        e.shoot(w, a, glyphShot(3, i % 3, { x: s.x, y: s.y, speed: 0, z: 10, life: 6, range: 440, behaviors: [inkGlyph(0.7 - i * 0.08 + i * 0.14, 125)] }));
        gather(w, s.x, s.y - 10, [CYAN.hot, CYAN.mid], 4, 8);
        w.sfx('orb', { vol: 0.18, pitch: 1.8 + i * 0.1 });
        yield 0.08;
      }
      yield 0.7 + n * 0.14 + 0.5;
    }
  },
  update(e, w) {
    if (fx.chance(0.08)) {
      w.particles.spawn({ x: e.x + fx.range(-5, 5), y: e.y - 2, vy: fx.range(6, 14), life: fx.range(0.3, 0.6), colors: ['#6ab8c4', '#2a5868'], size: 1, alpha: 0.8 });
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'dscribe_hurt_0'));
  },
  onDeath(e, w) {
    pages(w, e.x, e.y - 10, 5, 45);
    inkSplash(w, e.x, e.y, 1.2);
  },
});

// ================================================================== 책 더미 미믹 (book-pile mimic)
frames('bmimic', 'closed', 1, 16, 18, (p) => paintBookStack(p, 0, 0), { anchor: 'bottom', outline: AOUT });
frames('bmimic', 'stir', 2, 16, 18, (p, i) => paintBookStack(p, 0.25, i), { anchor: 'bottom', fps: 6, outline: AOUT });
frames('bmimic', 'open', 2, 16, 18, (p, i) => paintBookStack(p, 1, i), { anchor: 'bottom', fps: 8, outline: AOUT });
frames('bmimic', 'hurt', 1, 16, 18, (p) => paintBookStack(p, 0.6, 0, true), { anchor: 'bottom', outline: AOUT });

defineEnemy({
  id: 'book_mimic',
  name: '책 더미 미믹',
  hp: 48,
  radius: 7,
  speed: 0,
  mass: 4,
  sprite: 'bmimic_closed',
  spriteYOffset: 1,
  shadow: 0,
  cost: 2,
  floors: [6],
  weight: 0.7,
  champion: true,
  deathFx: 'none',
  bloodColor: '#d8c8a0',
  dieSfx: 'pot_break',
  light: { radius: 8, color: CYAN.low },
  init(e) {
    e.mem.lurk = 1;
    e.harmful = false;
  },
  *script(e, w) {
    while (true) {
      // lurking: a plain pile of books (harmless to touch, but it can be hit)
      e.setAnim('bmimic_closed');
      e.harmful = false;
      e.mem.lurk = 1;
      while (e.distToTarget(w) > 58 && w.time - e.lastHurtAt > 0.25) yield;
      e.mem.lurk = 0;
      e.harmful = true;
      e.setAnim('bmimic_stir');
      e.telegraph(0.5);
      w.spawn(new GroundWarning(e.x, e.y, 30, 0.5, undefined, WARN_RED));
      w.sfx('paper_flutter', { vol: 0.5, pitch: 0.7 });
      yield 0.5;
      // snap!
      e.setAnim('bmimic_open', true);
      e.squash(1.3, 0.8);
      e.facing = w.player.x >= e.x ? 1 : -1;
      w.shake(0.2);
      w.sfx('splat', { vol: 0.6, pitch: 0.7 });
      const p = w.player;
      const d = Math.hypot(p.x - e.x, p.y - e.y);
      if (p.alive && p.z < 8 && d < 30 + p.r * 0.5) {
        if (p.hurt(w, 2, e.def.name)) p.knock((p.x - e.x) / (d || 1), (p.y - e.y) / (d || 1), 220);
      }
      e.shootAt(w, null, pageShot(3, { count: e.champion ? 7 : 5, spread: 0.26, speed: 118, z: 8, range: 260 }));
      pages(w, e.x, e.y - 8, 5, 60);
      w.spawn(new RingFx(e.x, e.y - 4, 30, 0.3, PAPER[3], 2));
      yield 0.5;
      // two hops after the player
      for (let h = 0; h < 2; h++) {
        const tg = e.target(w);
        const s = stepToward(e.x, e.y, tg.x, tg.y, 52);
        const land = landingSpot(w, s.x, s.y, e.r);
        w.spawn(new GroundWarning(land.x, land.y, 12, 0.3 + 0.42, undefined, WARN_RED));
        e.telegraph(0.3);
        yield 0.3;
        e.setAnim('bmimic_open');
        yield* e.jumpTo(w, land.x, land.y, 0.42, 22);
        e.shootRing(w, 4, pageShot(2, { speed: 90, offset: w.rng.angle() + Math.PI / 4, z: 4, range: 150 }));
        dust(w, e.x, e.y + 2, [PAPER[2], PAPER[1]], 6, 50);
        yield 0.25;
      }
      // settles back into a pile
      e.setAnim('bmimic_closed');
      e.harmful = false;
      yield 1.4;
    }
  },
  draw(e, r, w) {
    r.shadow(e.x + 2, e.y + 3, 16, 6, 0.4);
    e.drawDefault(r, hurtFrame(e, w, 'bmimic_hurt_0'));
  },
  onDeath(e, w) {
    pages(w, e.x, e.y - 8, 10, 70);
    w.particles.burst(e.x, e.y - 6, { count: 14, speed: [30, 100], life: [0.3, 0.7], colors: [...INKDUST, '#5a1e2a', '#2a2f6a'], size: [1, 3], gravity: 300, vz: [40, 120], shape: 'square', vrot: 8 });
    w.sfx('paper_flutter', { vol: 0.6, pitch: 0.7 });
  },
});
