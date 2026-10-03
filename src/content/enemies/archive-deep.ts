// Floor 6 — 수몰된 서고 (drowned archive), part 2:
//  - 서고 장어 (archive eel): swims under the flooded floor as a ripple, surfaces along a
//    telegraphed lane with a lunge, spits ink globs that leave puddles, dives again
//  - 젖은 등불 유령 (wet lantern wraith, floors 6–7): the ink fog closes in around the keeper
//    while it is near; its drowned lantern pulses a ring of glyphs
//  - 서가 골렘 (shelf golem): a walking bookcase; slams (books take wing as moths) or
//    topples a line of shelves down a telegraphed lane
//  - 먹물 해파리 (ink jellyfish, floors 6–7): drifts in pulses and releases swirling,
//    alternating rings of glyphs; bursts into an ink pool when it dies

import { defineEnemy } from '../../game/defs';
import { PixelPainter } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { GroundWarning, RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { TAU } from '../../engine/math';
import type { Enemy } from '../../game/enemy';
import type { Renderer } from '../../engine/renderer';
import type { World } from '../../game/world';
import {
  BUL, countChildren, dust, frames, gather, hurtFrame, landingSpot, laneWarning, lineSpots, lob, rayFree, sphere, volleyTargets, WARN_RED,
} from './shared';
import {
  AOUT, CYAN, ensureDarkness, flatBook, glyphShot, INKB, INKDUST, InkPool, inkSplash, pages, PAPER, shelfCrash, SPINES, toward,
} from './archive-shared';

// ================================================================== 서고 장어 (archive eel)
const EEL = ['#06141a', '#0c3038', '#1a5a62', '#3a9aa0', '#8ae8f0'];

/** Serpent body from the tail (left) to the head (right), undulating with `k`; `mode` opens the jaw. */
function paintEel(p: PixelPainter, k: number, mode: 'swim' | 'lunge' | 'spit' | 'hurt'): void {
  const L = 29;
  const amp = mode === 'lunge' ? 0.9 : 2;
  const mid = (x: number) => 6 + Math.sin(x * 0.46 + k * 1.3) * amp * (1 - (x / L) * 0.5);
  for (let x = 0; x <= L - 4; x++) {
    const t = x / L;
    const cy = mid(x);
    const hw = t < 0.15 ? 0.8 + t * 8 : 2 + Math.sin(t * Math.PI) * 1.3;
    for (let y = Math.floor(cy - hw); y <= Math.ceil(cy + hw); y++) {
      const dy = y + 0.5 - cy;
      if (Math.abs(dy) > hw) continue;
      // lit back, mid flank, dark belly with a pale underside line
      const c = dy < -hw * 0.45 ? EEL[3] : dy > hw * 0.5 ? EEL[1] : EEL[2];
      p.px(x, y, c);
    }
    if (hw > 1.5) p.px(x, Math.floor(cy - hw) + 1, (x + k) % 3 === 0 ? EEL[4] : EEL[3]); // wet highlight along the back
    // dorsal fin spines
    if (x % 4 === 1 && t > 0.15 && t < 0.85) {
      p.px(x, Math.floor(cy - hw) - 1, EEL[3]);
      p.px(x, Math.floor(cy - hw) - 2, CYAN.mid);
    }
    // belly glints
    if (x % 5 === 2 && t > 0.2) p.px(x, Math.ceil(cy + hw) - 1, EEL[4]);
  }
  // head: a broader wedge with a jaw that opens
  const hy = mid(L - 4);
  const open = mode === 'lunge' ? 3 : mode === 'spit' ? 2 : 0;
  p.ellipse(L - 3.5, hy, 3.6, 3, EEL[2]);
  sphere(p, L - 3.5, hy - 0.3, 3.6, 3, EEL, false);
  if (open) {
    p.poly([L - 4, hy, L + 0.5, hy - open - 0.5, L + 0.5, hy - 0.5], EEL[3]);
    p.poly([L - 4, hy, L + 0.5, hy + open + 0.5, L + 0.5, hy + 0.5], EEL[1]);
    p.poly([L - 3, hy - 0.5, L, hy - open, L, hy + open, L - 3, hy + 0.5], '#03080c');
    p.px(L - 1, Math.round(hy - open), PAPER[3]);
    p.px(L - 1, Math.round(hy + open), PAPER[3]);
    if (mode === 'spit') p.px(L, Math.round(hy), INKB[1]);
  } else {
    p.line(L - 4, Math.round(hy) + 1, L, Math.round(hy) + 1, EEL[0]);
  }
  // eye
  const ey = Math.round(hy) - 1;
  if (mode === 'hurt') {
    p.px(L - 4, ey, EEL[0]);
    p.px(L - 3, ey, EEL[0]);
  } else {
    p.px(L - 4, ey, CYAN.mid);
    p.px(L - 3, ey, '#ffffff');
  }
}
frames('aeel', 'swim', 3, 30, 12, (p, i) => paintEel(p, i, 'swim'), { fps: 9, outline: AOUT });
frames('aeel', 'lunge', 2, 30, 12, (p, i) => paintEel(p, i, 'lunge'), { fps: 12, outline: AOUT });
frames('aeel', 'spit', 1, 30, 12, (p) => paintEel(p, 0, 'spit'), { outline: AOUT });
frames('aeel', 'hurt', 1, 30, 12, (p) => paintEel(p, 1, 'hurt'), { outline: AOUT });
defineDrawnSprite('aeel_glob', 8, 8, (p) => {
  p.circle(4, 4, 4, INKB[2]);
  sphere(p, 4, 4, 4, 4, [INKB[0], INKB[1], INKB[2], INKB[3], '#6a8ad0'], false);
  p.px(2, 2, '#c8f0ff');
  p.px(5, 5, CYAN.low);
}, { outline: '#02040a' });

/** Draw an eel sprite rotated along its heading (the sprite faces right; flipped vertically when heading left). */
function drawEel(e: Enemy, r: Renderer, frame: string): void {
  const tel = e.telegraphT > 0 && Math.floor(e.telegraphT * 16) % 2 === 0;
  const tint = e.statusTint();
  r.sprite(frame, e.x, e.y - e.z, {
    rot: e.rot,
    flipY: Math.cos(e.rot) < 0,
    sx: e.squashX * e.scale,
    sy: e.squashY * e.scale,
    alpha: e.alpha * (e.dormant > 0.3 ? 0.6 + 0.4 * Math.sin(e.age * 40) : 1),
    flash: e.flash > 0 ? 1 : tel ? 0.55 : 0,
    tint: e.champion ? e.championColor : tint?.color,
    tintAmount: e.champion ? 0.35 : tint?.amount,
  });
}

function submerge(e: Enemy, under: boolean): void {
  e.mem.under = under ? 1 : 0;
  e.vulnerable = !under;
  e.harmful = !under;
  e.solid = !under;
  e.phasing = under;
}

defineEnemy({
  id: 'archive_eel',
  name: '서고 장어',
  hp: 56,
  radius: 7,
  speed: 72,
  mass: 2.5,
  flying: true,
  sprite: 'aeel_swim',
  shadow: 0,
  cost: 2.5,
  floors: [6],
  weight: 0.8,
  champion: true,
  deathFx: 'blood',
  bloodColor: '#164a52',
  dieSfx: 'splat',
  light: { radius: 18, color: CYAN.mid },
  init(e, w) {
    submerge(e, true);
    e.rot = w.rng.angle();
  },
  *script(e, w) {
    yield w.rng.range(0.3, 0.9);
    while (true) {
      // submerged: a ripple crawls toward the player's flank
      submerge(e, true);
      e.setAnim('aeel_swim');
      const side = w.rng.sign();
      const t = w.rng.range(1.1, 1.7);
      for (let el = 0; el < t; el += w.dt) {
        const tg = e.target(w);
        const a = Math.atan2(tg.y - e.y, tg.x - e.x);
        const fxp = tg.x + Math.cos(a + (side * Math.PI) / 2) * 34;
        const fyp = tg.y + Math.sin(a + (side * Math.PI) / 2) * 34;
        const d = Math.hypot(fxp - e.x, fyp - e.y);
        if (d < 8) break;
        e.moveDir(fxp - e.x, fyp - e.y, Math.min(e.speed, d * 3));
        yield;
      }
      e.halt();
      const spot = landingSpot(w, e.x, e.y, e.r);
      e.x = spot.x;
      e.y = spot.y;
      // the lane it will lunge along
      const a = e.angleToTarget(w);
      e.rot = a;
      const len = Math.min(130, rayFree(w.room, e.x, e.y, a, 6, 130, true)) + 10;
      laneWarning(w, e.x, e.y, a, len, 14, 0.6);
      e.telegraph(0.6);
      w.sfx('water_surge', { vol: 0.5, pitch: 1.2 });
      for (let el = 0; el < 0.6; el += w.dt) {
        if (fx.chance(0.5)) w.particles.spawn({ x: e.x + fx.range(-6, 6), y: e.y + fx.range(-3, 3), life: 0.4, size: 1, sizeEnd: 7, colors: ['#8ae8f4'], shape: 'ring', alpha: 0.5, ground: true });
        yield;
      }
      // surface + lunge
      submerge(e, false);
      e.contactDamage = 2;
      e.setAnim('aeel_lunge', true);
      w.shake(0.2);
      w.sfx('splat', { vol: 0.55, pitch: 0.6 });
      w.particles.burst(e.x, e.y, { count: 14, speed: [30, 110], life: [0.3, 0.6], colors: ['#d8ffff', '#5ad0dc', '#0f4450'], size: [1, 2], gravity: 260, vz: [40, 120] });
      yield* e.charge(w, a, 250, 0.42);
      e.contactDamage = 1;
      // surfaced: spit ink globs that leave puddles
      e.setAnim('aeel_spit');
      yield 0.25;
      const p = w.player;
      const n = e.champion ? 3 : 2;
      const pts = volleyTargets(e.x, e.y, p.x + p.vx * 0.3, p.y + p.vy * 0.3, n, 26);
      for (const pt of pts) {
        const land = landingSpot(w, pt.x + w.rng.range(-4, 4), pt.y + w.rng.range(-4, 4), 3);
        e.rot = Math.atan2(land.y - e.y, land.x - e.x);
        lob(w, e.x, e.y - 2, land.x, land.y, {
          sprite: 'aeel_glob', color: BUL.glyph.color, time: 0.8, height: 42, warn: 11, hitRadius: 10, source: e.def.name, spin: 4,
          onLand: (ww, x, y) => {
            ww.spawn(new InkPool(x, y, 11, 2.6));
            inkSplash(ww, x, y, 1);
            ww.sfx('ink_splash', { vol: 0.5, x });
          },
        });
        e.squash(1.2, 0.85);
        yield 0.3;
      }
      e.setAnim('aeel_swim');
      yield 0.45;
      // dive
      w.sfx('water_surge', { vol: 0.45, pitch: 0.8 });
      w.particles.burst(e.x, e.y, { count: 10, speed: [20, 70], life: [0.3, 0.5], colors: ['#d8ffff', '#5ad0dc'], size: [1, 2], gravity: 240, vz: [30, 80] });
      w.spawn(new RingFx(e.x, e.y, 16, 0.3, '#8ae8f4', 1));
      submerge(e, true);
      yield 0.4;
    }
  },
  update(e, w) {
    const sp = Math.hypot(e.vx, e.vy);
    if (sp > 6) e.rot = Math.atan2(e.vy, e.vx);
    if (e.mem.under && fx.chance(0.35)) {
      w.particles.spawn({ x: e.x + fx.range(-4, 4), y: e.y + fx.range(-2, 2), vy: -fx.range(3, 8), life: fx.range(0.3, 0.6), colors: ['#bff8ff', '#6ad8e8'], size: 1, alpha: 0.7, additive: true });
    }
  },
  draw(e, r, w) {
    if (e.mem.under) {
      // a long shadow moving under the flooded floor, with a V-wake
      const k = w.time * 7;
      r.shadow(e.x, e.y, 26, 8, 0.45);
      const bx = Math.cos(e.rot);
      const by = Math.sin(e.rot);
      for (let i = 0; i < 3; i++) {
        const d = 6 + i * 7 + (k % 7);
        r.rect(e.x - bx * d - by * (3 + i * 2), e.y - by * d + bx * (3 + i * 2), 1, 1, '#9ae8f4', 0.7 - i * 0.2);
        r.rect(e.x - bx * d + by * (3 + i * 2), e.y - by * d - bx * (3 + i * 2), 1, 1, '#9ae8f4', 0.7 - i * 0.2);
      }
      r.ring(e.x, e.y, 6 + Math.sin(k) * 1.2, '#6ad8e8', 1, 0.55);
      return;
    }
    r.shadow(e.x, e.y + 3, 22, 7, 0.3);
    drawEel(e, r, hurtFrame(e, w, 'aeel_hurt_0'));
  },
  onDeath(e, w) {
    w.spawn(new InkPool(e.x, e.y + 2, 13, 3));
    inkSplash(w, e.x, e.y, 1.6);
  },
});

// ================================================================== 젖은 등불 유령 (lantern wraith)
const SHROUD = ['#0e2430', '#1c3a48', '#2a5868', '#3a7a88', '#6ab0b8'];

function paintWraith(p: PixelPainter, k: number, mode: 'float' | 'ring' | 'hurt'): void {
  const bob = mode === 'float' ? [0, -1, -1, 0][k] : mode === 'hurt' ? 1 : -1;
  const sway = mode === 'float' ? [0, 1, 0, -1][k] : 0;
  // shroud: hooded figure trailing into weeds
  p.poly([4, 8 + bob, 11, 8 + bob, 13 + sway * 0.5, 17, 2 + sway * 0.5, 17], SHROUD[2]);
  p.shadeVertical(2, 8 + bob, 12, 10, [SHROUD[3], SHROUD[2], SHROUD[2], SHROUD[1]], false);
  for (let i = 0; i < 4; i++) {
    const x = 2.5 + i * 3 + sway * 0.5;
    const len = 3 + ((i * 5 + k) % 3);
    for (let y = 16; y < 16 + len && y < 22; y++) p.px(x + Math.sin(y * 0.8 + k + i) * 0.8, y, y > 18 ? '#1a5c58' : SHROUD[1]);
  }
  // hood
  p.circle(7.5, 6 + bob, 4.4, SHROUD[3]);
  sphere(p, 7.5, 6 + bob, 4.4, 4.4, SHROUD, false);
  p.poly([4, 4 + bob, 7, -1 + bob, 10, 4 + bob], SHROUD[3]);
  // hollow face with two cyan eyes
  p.ellipse(8, 7 + bob, 2.8, 2.6, '#06101a');
  if (mode === 'hurt') {
    p.px(7, 7 + bob, SHROUD[1]);
    p.px(9, 7 + bob, SHROUD[1]);
  } else {
    p.px(7, 7 + bob, CYAN.mid);
    p.px(9, 7 + bob, CYAN.mid);
    p.px(7, 8 + bob, CYAN.low);
  }
  // arm + drowned lantern (raised when ringing)
  const ly = mode === 'ring' ? 2 : 10;
  const lx = 12;
  p.line(10, 10 + bob, lx, ly + 3 + bob, SHROUD[3]);
  p.rect(lx - 1, ly + bob, 1, 1, '#3a3a48');
  p.rect(lx - 2, ly + 1 + bob, 4, 1, '#c8a048');
  p.rect(lx - 2, ly + 2 + bob, 4, 4, '#2a6a7a');
  p.rect(lx - 1, ly + 2 + bob, 2, 4, mode === 'ring' ? CYAN.hot : CYAN.mid);
  p.px(lx - 1, ly + 2 + bob, '#ffffff');
  p.rect(lx - 2, ly + 6 + bob, 4, 1, '#c8a048');
  // weed hanging off the hood
  p.px(3, 6 + bob, '#1a5c58');
  p.px(3, 7 + bob, '#2a8a80');
}
frames('lwraith', 'float', 4, 15, 22, (p, i) => paintWraith(p, i, 'float'), { fps: 6, outline: AOUT });
frames('lwraith', 'ring', 2, 15, 22, (p, i) => paintWraith(p, i, 'ring'), { fps: 10, outline: AOUT });
frames('lwraith', 'hurt', 1, 15, 22, (p) => paintWraith(p, 0, 'hurt'), { outline: AOUT });

defineEnemy({
  id: 'lantern_wraith',
  name: '젖은 등불 유령',
  hp: 36,
  radius: 6,
  speed: 28,
  flying: true,
  phasing: true,
  sprite: 'lwraith_float',
  shadow: 10,
  spriteYOffset: -8,
  cost: 2,
  floors: [6, 7],
  weight: 0.7,
  champion: true,
  deathFx: 'void',
  bloodColor: '#2a5868',
  dieSfx: 'splat',
  light: { radius: 22, color: CYAN.mid },
  init(e, w) {
    e.alpha = 0.9;
    e.mem.side = w.rng.sign();
    ensureDarkness(w);
  },
  *script(e, w) {
    yield w.rng.range(0.3, 0.9);
    while (true) {
      e.setAnim('lwraith_float');
      const t = w.rng.range(2.4, 3.2);
      for (let el = 0; el < t; el += w.dt) {
        const tg = e.target(w);
        const d = Math.hypot(tg.x - e.x, tg.y - e.y);
        if (d > 78) e.chase(w, e.speed);
        else if (d < 48) e.flee(w, e.speed * 0.8);
        else {
          const a = Math.atan2(e.y - tg.y, e.x - tg.x) + e.mem.side * 0.6;
          e.moveDir(tg.x + Math.cos(a) * 64 - e.x, tg.y + Math.sin(a) * 50 - e.y, e.speed * 0.8);
        }
        yield;
      }
      // the lantern flares, then rings out a circle of glyphs
      e.halt();
      e.setAnim('lwraith_ring');
      const R = 28;
      e.telegraph(0.6);
      w.spawn(new GroundWarning(e.x, e.y, R, 0.6, undefined, WARN_RED));
      gather(w, e.x + 5, e.y - 14, [CYAN.hot, CYAN.mid, CYAN.low], 10, 16);
      w.sfx('orb', { vol: 0.4, pitch: 0.5 });
      yield 0.6;
      w.spawn(new RingFx(e.x, e.y - 8, R + 6, 0.3, CYAN.mid, 2));
      w.sfx('beam_charge', { vol: 0.3, pitch: 1.6 });
      for (const p of w.targets()) {
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (p.alive && p.z < 8 && d < R + p.r * 0.5) {
          if (p.hurt(w, 1, e.def.name)) p.knock((p.x - e.x) / (d || 1), (p.y - e.y) / (d || 1), 200);
        }
      }
      e.shootRing(w, e.champion ? 12 : 8, glyphShot(3, 2, { speed: 62, offset: w.rng.angle(), z: 10, range: 260 }));
      yield 0.8;
    }
  },
  update(e, w) {
    if (fx.chance(0.15)) {
      w.particles.spawn({ x: e.x + fx.range(-5, 5), y: e.y + fx.range(-2, 4), vy: fx.range(6, 14), life: fx.range(0.4, 0.8), colors: ['#6ab8c4', '#1c3a48'], size: 1, alpha: 0.8 });
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'lwraith_hurt_0'), -8 + Math.sin(e.age * 2.4) * 1.5);
  },
  onDeath(e, w) {
    // the drowned light goes out for good: a last bright pulse
    w.spawn(new RingFx(e.x, e.y - 8, 36, 0.4, CYAN.hot, 3));
    w.particles.burst(e.x, e.y - 8, { count: 18, speed: [30, 110], life: [0.3, 0.7], colors: [CYAN.hot, CYAN.mid, SHROUD[1]], size: [1, 2], additive: true, light: 6 });
  },
});

// ================================================================== 서가 골렘 (shelf golem)
const WOOD = ['#1a120c', '#2e1f14', '#45301e', '#5e452a', '#7a5c38'];

function paintGolem(p: PixelPainter, k: number, mode: 'walk' | 'raise' | 'slam' | 'hurt'): void {
  const step = mode === 'walk' ? [2, 0, -2, 0][k] : 0;
  const bob = mode === 'walk' ? [0, -1, 0, -1][k] : mode === 'slam' ? 2 : 0;
  // plank legs
  p.rect(7 + step, 24, 4, 6, WOOD[2]);
  p.rect(13 - step, 24, 4, 6, WOOD[2]);
  p.rect(7 + step, 29, 4, 1, WOOD[0]);
  p.rect(13 - step, 29, 4, 1, WOOD[0]);
  p.px(8 + step, 25, WOOD[4]);
  p.px(14 - step, 25, WOOD[4]);
  // bookcase body
  const by = 6 + bob;
  p.rect(4, by, 16, 19, WOOD[1]);
  p.rect(4, by, 16, 2, WOOD[3]);
  p.rect(4, by, 16, 1, WOOD[4]);
  p.rect(4, by, 1, 19, WOOD[2]);
  p.rect(19, by, 1, 19, WOOD[0]);
  p.rect(4, by + 18, 16, 1, WOOD[0]);
  // lamp-eye compartment
  p.rect(5, by + 2, 14, 5, '#0a0c14');
  const eye = mode === 'hurt' ? CYAN.low : mode === 'raise' || mode === 'slam' ? CYAN.hot : CYAN.mid;
  p.rect(11, by + 3, 3, 3, eye);
  p.px(12, by + 4, '#ffffff');
  p.px(10, by + 4, CYAN.low);
  p.px(14, by + 4, CYAN.low);
  // two shelves of books (front view)
  for (let row = 0; row < 2; row++) {
    const y0 = by + 8 + row * 5;
    p.rect(5, y0 + 4, 14, 1, WOOD[3]);
    p.rect(5, y0, 14, 4, '#0a0c14');
    let x = 5;
    let i = 0;
    while (x < 19) {
      const w = 2 + ((i + row + k) % 3 === 0 ? 1 : 0);
      const h = 4 - ((i * 7 + row * 3) % 2);
      if ((i + row * 3) % 6 !== 4) {
        const c = SPINES[(i * 2 + row * 3) % SPINES.length];
        p.rect(x, y0 + (4 - h), Math.min(w, 19 - x), h, c);
        p.px(x, y0 + (4 - h), toward(c, '#ffffff', 0.35));
      }
      x += w;
      i++;
    }
  }
  // arms (planks) — hanging, raised with a shelf board overhead, or slammed down
  if (mode === 'raise') {
    p.rect(1, by - 4, 3, 10, WOOD[2]);
    p.rect(20, by - 4, 3, 10, WOOD[2]);
    p.rect(0, by - 6, 24, 3, WOOD[3]);
    p.rect(0, by - 6, 24, 1, WOOD[4]);
    p.rect(0, by - 4, 24, 1, WOOD[0]);
  } else if (mode === 'slam') {
    p.rect(1, by + 12, 3, 12, WOOD[2]);
    p.rect(20, by + 12, 3, 12, WOOD[2]);
    p.rect(0, 27, 24, 2, WOOD[3]);
    p.rect(0, 27, 24, 1, WOOD[4]);
  } else {
    const swing = mode === 'walk' ? step : 0;
    p.rect(1, by + 3 + swing, 3, 12, WOOD[2]);
    p.rect(20, by + 3 - swing, 3, 12, WOOD[2]);
    p.px(2, by + 14 + swing, '#6a6a74');
    p.px(21, by + 14 - swing, '#6a6a74');
  }
  // tide line and algae on the lower body
  p.rect(4, by + 15, 16, 1, toward('#8aa8a4', WOOD[2], 0.4));
  for (const [x, y] of [[6, by + 17], [9, by + 18], [15, by + 17], [18, by + 18]] as [number, number][]) p.px(x, y, '#1a5c58');
  if (mode === 'hurt') {
    p.px(8, by + 9, PAPER[3]);
    p.px(16, by + 13, PAPER[3]);
  }
}
frames('shgolem', 'walk', 4, 24, 30, (p, i) => paintGolem(p, i, 'walk'), { anchor: 'bottom', fps: 5, outline: AOUT });
frames('shgolem', 'raise', 2, 24, 30, (p, i) => paintGolem(p, i, 'raise'), { anchor: 'bottom', fps: 6, outline: AOUT });
frames('shgolem', 'slam', 1, 24, 30, (p) => paintGolem(p, 0, 'slam'), { anchor: 'bottom', outline: AOUT });
frames('shgolem', 'hurt', 1, 24, 30, (p) => paintGolem(p, 0, 'hurt'), { anchor: 'bottom', outline: AOUT });
defineDrawnSprite('shgolem_book', 9, 6, (p) => {
  flatBook(p, 0, 1, 8, 4, SPINES[1]);
  p.px(3, 2, '#c8a048');
}, { outline: '#1a0e02' });

defineEnemy({
  id: 'shelf_golem',
  name: '서가 골렘',
  hp: 100,
  radius: 10,
  speed: 20,
  mass: 5,
  sprite: 'shgolem_walk',
  spriteYOffset: 8,
  shadow: 22,
  cost: 3.5,
  floors: [6],
  weight: 0.55,
  champion: true,
  deathFx: 'bone',
  bloodColor: '#7a5c38',
  hurtSfx: 'hit_metal',
  dieSfx: 'enemy_die_big',
  light: { radius: 18, color: CYAN.mid },
  *script(e, w) {
    yield w.rng.range(0.4, 1.0);
    while (true) {
      e.setAnim('shgolem_walk');
      yield* e.chaseFor(w, w.rng.range(1.6, 2.4), e.speed);
      const p = w.player;
      const d = e.distToTarget(w);
      if (d < 54) {
        // close: raise and slam; the books take wing
        e.halt();
        e.setAnim('shgolem_raise');
        const R = 34;
        w.spawn(new GroundWarning(e.x, e.y, R, 0.7, undefined, WARN_RED));
        e.telegraph(0.7);
        w.sfx('enemy_charge', { vol: 0.45, pitch: 0.7 });
        yield 0.7;
        e.setAnim('shgolem_slam');
        w.shake(0.35);
        w.sfx('slam', { vol: 0.65 });
        dust(w, e.x, e.y + 4, [PAPER[2], WOOD[3], WOOD[1]], 12, 70);
        for (const q of w.targets()) {
          if (q.alive && q.z < 8 && Math.hypot(q.x - e.x, q.y - e.y) < R + q.r * 0.5) {
            if (q.hurt(w, 2, e.def.name)) {
              const dd = Math.hypot(q.x - e.x, q.y - e.y) || 1;
              q.knock((q.x - e.x) / dd, (q.y - e.y) / dd, 220);
            }
          }
        }
        const pts = volleyTargets(e.x, e.y, p.x + p.vx * 0.3, p.y + p.vy * 0.3, 3, 28);
        for (const pt of pts) {
          const land = landingSpot(w, pt.x + w.rng.range(-4, 4), pt.y + w.rng.range(-4, 4), 3);
          lob(w, e.x, e.y - 20, land.x, land.y, { sprite: 'shgolem_book', color: BUL.page.color, time: 0.85, height: 50, warn: 11, hitRadius: 10, source: e.def.name, spin: 6, light: 10 });
        }
        if (countChildren(w, e, 'paper_moth') < 2) {
          const m = e.summon(w, 'paper_moth', e.x + e.facing * 10, e.y - 6);
          if (m) {
            m.mem.owner = e;
            pages(w, e.x, e.y - 16, 4, 50);
            w.sfx('paper_flutter', { vol: 0.45, pitch: 1.1 });
          }
        }
        yield 1.0;
      } else if (d < 180 && w.room.lineOfSight(e.x, e.y, p.x, p.y)) {
        // far: topple a line of shelves toward the player
        e.halt();
        e.setAnim('shgolem_raise');
        e.facing = p.x >= e.x ? 1 : -1;
        const a0 = e.angleToTarget(w);
        const lines = e.champion ? [a0 - 0.32, a0, a0 + 0.32] : [a0];
        for (const a of lines) laneWarning(w, e.x, e.y, a, Math.min(150, rayFree(w.room, e.x, e.y, a, 5, 150, true)), 16, 0.8);
        e.telegraph(0.8);
        gather(w, e.x, e.y - 30, [PAPER[3], CYAN.mid], 10, 16);
        w.sfx('enemy_charge', { vol: 0.45, pitch: 0.6 });
        yield 0.8;
        e.setAnim('shgolem_slam');
        w.shake(0.3);
        w.sfx('slam', { vol: 0.6, pitch: 0.9 });
        dust(w, e.x + e.facing * 10, e.y + 4, [WOOD[3], WOOD[1]], 10, 60);
        const spots = lines.map((a) => lineSpots(e.x, e.y, a, 9, 16, 18).filter((s) => s.x > w.room.interiorX && s.x < w.room.interiorX + w.room.interiorW && s.y > w.room.interiorY && s.y < w.room.interiorY + w.room.interiorH));
        for (let i = 0; i < 9; i++) {
          for (const line of spots) {
            const s = line[i];
            if (!s) continue;
            w.spawn(new GroundWarning(s.x, s.y, 9, 0.28, (ww) => shelfCrash(ww, s.x, s.y, 9, '서가 골렘'), WARN_RED));
          }
          yield 0.07;
        }
        yield 0.9;
      }
    }
  },
  update(e, w) {
    if (e.anim === 'shgolem_walk' && fx.chance(0.06)) {
      w.particles.spawn({ x: e.x + fx.range(-6, 6), y: e.y + 4, vy: -fx.range(2, 5), life: fx.range(0.4, 0.8), colors: ['#6ab8c4'], size: 1, alpha: 0.7 });
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'shgolem_hurt_0'));
  },
  onDeath(e, w) {
    pages(w, e.x, e.y - 14, 10, 80);
    w.particles.burst(e.x, e.y - 10, { count: 22, speed: [40, 140], life: [0.4, 0.9], colors: [WOOD[2], WOOD[3], ...SPINES.slice(0, 3)], size: [2, 3], gravity: 320, vz: [40, 130], bounce: 0.3, shape: 'square', vrot: 8 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      shelfCrash(w, e.x + Math.cos(a) * 18, e.y + Math.sin(a) * 12, 0, e.def.name, 0);
    }
  },
});

// ================================================================== 먹물 해파리 (ink jellyfish)
const JELLY = ['#0e1428', '#1c2850', '#2e3e78', '#4a5ca0', '#8aa0d8'];

function paintJelly(p: PixelPainter, k: number, mode: 'drift' | 'pulse' | 'hurt'): void {
  const squeeze = mode === 'pulse' ? 1 : mode === 'hurt' ? 0.4 : [0, 0.35, 0.7, 0.35][k];
  const rx = 7.4 - squeeze * 1.4;
  const ry = 7 + squeeze * 0.9;
  const cy = 9;
  const rim = cy + 2;
  p.ellipse(8.5, cy, rx, ry, JELLY[2]);
  for (let y = rim; y < 20; y++) for (let x = 0; x < 17; x++) p.px(x, y, null);
  sphere(p, 8.5, cy - 1, rx, ry * 0.9, JELLY, true);
  for (let x = 0; x < 17; x++) {
    if (!p.isSet(x, rim - 1)) continue;
    p.px(x, rim - 1, JELLY[4]);
    if (Math.sin(x * 1.5 + k) > -0.1) p.px(x, rim, JELLY[3]);
  }
  // ink tentacles
  for (let i = 0; i < 5; i++) {
    const x0 = 8.5 + (i - 2) * (rx * 0.36);
    const len = 7 + ((i * 3 + k) % 3);
    for (let y = rim + 1; y < Math.min(20, rim + 1 + len); y++) {
      const x = x0 + Math.sin(y * 0.7 + k * 1.5 + i * 1.3) * (0.6 + (y - rim) * 0.12);
      p.px(x, y, y === rim + len ? CYAN.low : i % 2 ? JELLY[1] : JELLY[2]);
    }
    p.px(x0 + Math.sin((rim + len) * 0.7 + k * 1.5 + i * 1.3) * (0.6 + len * 0.12), Math.min(19, rim + len), CYAN.mid);
  }
  // bioluminescent spots
  const hot = mode === 'pulse';
  for (const [sx, sy] of [[5, 7], [11, 5], [8, 9], [12, 9], [4, 10]]) {
    if (!p.isSet(sx, sy)) continue;
    p.px(sx, sy, hot || (sx + k) % 3 === 0 ? CYAN.mid : CYAN.low);
    if (hot) p.px(sx, sy - 1, CYAN.hot);
  }
  if (mode === 'hurt') {
    p.px(8, 6, '#ffffff');
    p.line(5, 5, 7, 7, JELLY[4]);
  }
  // specular
  p.px(5, 4, '#9ad8ff');
  p.px(6, 3, '#d8f8ff');
}
frames('ijelly', 'drift', 4, 17, 20, (p, i) => paintJelly(p, i, 'drift'), { fps: 6, outline: AOUT });
frames('ijelly', 'pulse', 2, 17, 20, (p, i) => paintJelly(p, i, 'pulse'), { fps: 10, outline: AOUT });
frames('ijelly', 'hurt', 1, 17, 20, (p) => paintJelly(p, 1, 'hurt'), { outline: AOUT });

defineEnemy({
  id: 'ink_jelly',
  name: '먹물 해파리',
  hp: 34,
  radius: 7,
  speed: 36,
  flying: true,
  sprite: 'ijelly_drift',
  shadow: 12,
  spriteYOffset: -8,
  cost: 2,
  floors: [6, 7],
  weight: 0.75,
  champion: true,
  deathFx: 'goo',
  bloodColor: '#24305a',
  dieSfx: 'splat',
  light: { radius: 28, color: CYAN.mid },
  init(e, w) {
    e.mem.side = w.rng.sign();
  },
  *script(e, w) {
    yield w.rng.range(0.3, 1.0);
    while (true) {
      e.setAnim('ijelly_drift');
      const t = w.rng.range(2.2, 2.8);
      for (let el = 0; el < t; el += w.dt) {
        // jet propulsion in pulses, drifting sideways between pushes
        const push = Math.max(0, Math.sin(e.age * 3.6));
        const tg = e.target(w);
        const d = Math.hypot(tg.x - e.x, tg.y - e.y);
        const a = Math.atan2(tg.y - e.y, tg.x - e.x) + (d > 64 ? 0 : Math.PI) + e.mem.side * (1 - push) * 0.9;
        e.moveAngle(a, 8 + e.speed * push);
        if (e.mem.__bumped) e.mem.side = -e.mem.side;
        yield;
      }
      e.halt();
      e.setAnim('ijelly_pulse');
      e.telegraph(0.5);
      gather(w, e.x, e.y - 8, [CYAN.hot, CYAN.mid, JELLY[3]], 10, 18);
      w.sfx('orb', { vol: 0.4, pitch: 0.8 });
      yield 0.5;
      // two swirling rings in opposite directions (three as a champion)
      const n = 10;
      const spin = w.rng.sign() * 0.55;
      const off = w.rng.range(0, TAU);
      e.shootRing(w, n, glyphShot(3, 0, { speed: 72, offset: off, z: 8, range: 260, curve: spin }));
      w.spawn(new RingFx(e.x, e.y - 8, 20, 0.3, CYAN.mid, 2));
      e.squash(1.25, 0.8);
      yield 0.35;
      e.shootRing(w, n, glyphShot(3, 1, { speed: 54, offset: off + Math.PI / n, z: 8, range: 240, curve: -spin }));
      e.squash(1.2, 0.85);
      if (e.champion) {
        yield 0.35;
        e.shootRing(w, n, glyphShot(3, 2, { speed: 88, offset: off, z: 8, range: 280, curve: spin * 0.6 }));
      }
      yield 0.7;
    }
  },
  update(e, w) {
    if (fx.chance(0.12)) {
      w.particles.spawn({ x: e.x + fx.range(-5, 5), y: e.y - 2 + fx.range(-3, 6), vy: fx.range(4, 10), life: fx.range(0.4, 0.8), colors: [CYAN.hot, CYAN.mid, JELLY[3]], size: 1, additive: true });
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'ijelly_hurt_0'), -8 + Math.sin(e.age * 2.1) * 2);
  },
  onDeath(e, w) {
    // bursts into a spreading pool of ink
    w.spawn(new InkPool(e.x, e.y + 6, 14, 3));
    inkSplash(w, e.x, e.y + 4, 2);
    w.particles.burst(e.x, e.y - 8, { count: 12, speed: [20, 60], life: [0.3, 0.6], colors: INKDUST, size: [1, 2], additive: true });
  },
});
