// Floor 4 — 얼어붙은 성소 (frozen sanctum), part 2:
//  - 서리 수정 (frost crystal): stationary; telegraphed lanes of shards (+ then ×)
//  - 성가대 선창자 (choir cantor) + 성가대 아이 (choir acolyte): shield-linked group.
//    While any acolyte lives the cantor is warded; it sings walls of rose notes with a gap.
//  - 서리 슬라임 (rime slime): hops, every landing leaves a freezing puddle
//  - 눈꽃 정령 (snowflake sprite): drifting fodder that bursts into shards if it gets close

import { defineEnemy } from '../../game/defs';
import { PixelPainter } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { GroundWarning, RingFx } from '../../game/effects';
import { fx } from '../../engine/rng';
import { TAU } from '../../engine/math';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import {
  appliedDamage, bullet, dust, frames, gapStartFor, gather, hurtFrame, landingSpot, laneWarning, rayFree, shard, sphere,
  stepToward, wallSlots, WARN_RED,
} from './shared';
import { FrostPatch, ICE, ROSE, SNOWDUST } from './sanctum';

const DEEP = '#061430';
const SLATE = ['#141a2e', '#262e4a', '#3a4668', '#56648a'];

// ================================================================== 서리 수정 (frost crystal)
function paintCrystal(p: PixelPainter, k: number, mode: 'idle' | 'charge' | 'fire' | 'hurt'): void {
  const bright = mode === 'charge' || mode === 'fire';
  const C = bright ? ['#2a62c8', '#5aaaf0', '#a8e4ff', '#e8faff', '#ffffff'] : ICE;
  // stone socket
  p.poly([2, 19, 5, 17, 15, 17, 18, 19, 18, 22, 15, 24, 5, 24, 2, 22], SLATE[1]);
  p.poly([2, 19, 5, 17, 15, 17, 18, 19, 15, 20, 5, 20], SLATE[3]);
  p.rect(2, 22, 16, 1, SLATE[0]);
  // glowing runes on the socket
  const rc = mode === 'idle' ? (k ? '#4a8ad0' : '#6cb6ee') : '#bff6ff';
  for (const x of [4, 8, 12, 15]) p.px(x, 21, rc);
  // side crystals (angled)
  const sideH = mode === 'fire' ? 1 : 0;
  p.poly([3, 19, 2, 11 - sideH, 4, 8 - sideH, 7, 12, 7, 19], C[1]);
  p.poly([3, 19, 2, 11 - sideH, 4, 8 - sideH, 4.5, 19], C[2]);
  p.poly([13, 19, 13, 12, 16, 7 - sideH, 18, 10 - sideH, 17, 19], C[1]);
  p.poly([13, 19, 13, 12, 16, 7 - sideH, 15, 19], C[2]);
  // main crystal
  p.poly([6.5, 19, 6.5, 6, 10, 0, 13.5, 6, 13.5, 19], C[2]);
  p.poly([6.5, 19, 6.5, 6, 10, 0, 10, 19], C[3]);
  p.line(10, 1, 10, 18, C[4]);
  p.line(13, 7, 13, 18, C[1]);
  // core
  const core = mode === 'fire' ? '#ffffff' : mode === 'charge' ? (k ? '#ffffff' : '#bff6ff') : k ? '#8cf2ff' : '#5ad0ff';
  p.rect(9, 9, 2, 4, core);
  p.px(8, 10, core);
  p.px(11, 11, core);
  if (mode === 'fire') {
    p.px(10, 7, '#ffffff');
    p.px(10, 14, '#ffffff');
  }
  if (mode === 'hurt') {
    p.line(8, 4, 11, 10, DEEP);
    p.line(11, 10, 9, 15, '#ffffff');
  }
}
frames('fcrystal', 'idle', 2, 20, 25, (p, i) => paintCrystal(p, i, 'idle'), { anchor: 'bottom', fps: 3, outline: DEEP });
frames('fcrystal', 'charge', 2, 20, 25, (p, i) => paintCrystal(p, i, 'charge'), { anchor: 'bottom', fps: 12, outline: DEEP });
frames('fcrystal', 'fire', 2, 20, 25, (p, i) => paintCrystal(p, i, 'fire'), { anchor: 'bottom', fps: 16, outline: DEEP });
frames('fcrystal', 'hurt', 1, 20, 25, (p) => paintCrystal(p, 0, 'hurt'), { anchor: 'bottom', outline: DEEP });

defineEnemy({
  id: 'frost_crystal',
  name: '서리 수정',
  hp: 48,
  radius: 8,
  speed: 0,
  mass: Infinity,
  sprite: 'fcrystal_idle',
  spriteYOffset: 7,
  shadow: 18,
  cost: 2,
  floors: [4],
  weight: 0.7,
  champion: true,
  deathFx: 'ice',
  bloodColor: '#bff4ff',
  hurtSfx: 'hit_metal',
  dieSfx: 'freeze',
  light: { radius: 30, color: '#6cc8ff' },
  init(e, w) {
    e.mem.rot = w.rng.chance(0.5) ? 0 : Math.PI / 4;
  },
  *script(e, w) {
    yield w.rng.range(0.5, 1.4);
    while (true) {
      e.setAnim('fcrystal_idle');
      yield w.rng.range(1.3, 1.9);
      // show the lanes, then pour shards down them
      const lanes: number[] = [];
      const n = e.champion ? 8 : 4;
      for (let i = 0; i < n; i++) lanes.push(e.mem.rot + (i / n) * TAU);
      e.setAnim('fcrystal_charge');
      e.telegraph(0.75);
      for (const a of lanes) laneWarning(w, e.x, e.y - 2, a, rayFree(w.room, e.x, e.y, a, 3, 260, true) + 6, 10, 0.75);
      gather(w, e.x, e.y - 10, SNOWDUST, 12, 18);
      w.sfx('beam_charge', { vol: 0.35, pitch: 1.3 });
      yield 0.75;
      e.setAnim('fcrystal_fire');
      w.sfx('freeze', { vol: 0.45, pitch: 1.1 });
      for (let t = 0; t < 1.05; t += 0.07) {
        for (const a of lanes) e.shoot(w, a, shard('frost', 3, { speed: 150, z: 10, range: 300 }));
        if (Math.round(t / 0.07) % 3 === 0) w.sfx('enemy_shoot', { vol: 0.25, pitch: 1.5 });
        yield 0.07;
      }
      e.mem.rot += Math.PI / 4;
    }
  },
  update(e, w) {
    if (fx.chance(0.08)) {
      w.particles.spawn({ x: e.x + fx.range(-7, 7), y: e.y - fx.range(4, 20), vy: -fx.range(3, 8), life: fx.range(0.4, 0.8), colors: ['#ffffff', '#bff6ff'], size: 1, additive: true });
    }
  },
  draw(e, r, w) {
    const facing0 = e.facing;
    e.facing = 1;
    e.drawDefault(r, hurtFrame(e, w, 'fcrystal_hurt_0'));
    e.facing = facing0;
  },
});

// ================================================================== 성가대 (frozen choir)
const ROBE = ['#3a0a24', '#6a1640', '#a02858', '#d04a7a'];
const LACE = ['#8a9ab8', '#c8d4e8', '#f4f8ff'];
const SKIN = ['#7aa4c8', '#bfe0f4', '#e8f8ff'];

defineDrawnSprite('hymn_note', 5, 7, (p) => {
  p.rect(3, 0, 1, 5, '#ffffff');
  p.px(4, 1, '#ffffff');
  p.px(4, 2, '#ffd0e0');
  p.ellipse(2, 5.5, 2, 1.4, ROSE.mid);
  p.px(1, 5, '#ffffff');
}, { outline: '#1e0410' });

function notes(w: World, x: number, y: number, n = 1): void {
  for (let i = 0; i < n; i++) {
    w.particles.spawn({
      x: x + fx.range(-6, 6), y: y + fx.range(-3, 3), vx: fx.range(-10, 10), vy: -fx.range(14, 28), life: fx.range(0.6, 1.0),
      colors: ['#ffffff'], shape: 'sprite', sprite: 'hymn_note', alpha: 0.9, fade: true,
    });
  }
}

function paintCantor(p: PixelPainter, k: number, mode: 'idle' | 'sing' | 'hurt'): void {
  const sway = mode === 'idle' ? [0, 1][k] : 0;
  // cassock
  p.poly([6, 11, 14, 11, 17, 25, 3, 25], ROBE[2]);
  p.shadeVertical(3, 11, 14, 14, [ROBE[3], ROBE[2], ROBE[1], ROBE[0]], false);
  p.line(10, 15, 10, 24, ROBE[1]);
  p.line(7, 16, 6, 24, ROBE[1]);
  // white surplice with a lace hem
  p.poly([5.5, 11, 14.5, 11, 16, 19, 4, 19], LACE[1]);
  p.shadeVertical(4, 11, 12, 8, [LACE[2], LACE[1], LACE[0]], false);
  for (let x = 4; x <= 15; x += 2) p.px(x, 19, LACE[2]);
  // rose stole
  p.rect(8, 11, 1, 9, ROSE.mid);
  p.rect(11, 11, 1, 9, ROSE.mid);
  p.px(8, 19, ROSE.hot);
  p.px(11, 19, ROSE.hot);
  // hymnal held up in front
  const by = mode === 'sing' ? 12 : 14 + sway;
  p.rect(5, by, 10, 5, ROBE[1]);
  p.rect(6, by, 8, 4, LACE[2]);
  p.line(10, by, 10, by + 3, LACE[0]);
  p.line(7, by + 1, 9, by + 1, LACE[0]);
  p.line(11, by + 2, 13, by + 2, LACE[0]);
  p.px(4, by + 2, SKIN[1]);
  p.px(15, by + 2, SKIN[1]);
  // head
  const hy = mode === 'hurt' ? 8 : 7;
  p.circle(10, hy, 3.4, SKIN[1]);
  sphere(p, 10, hy, 3.4, 3.4, SKIN, false);
  // tall pointed hat
  p.poly([6.5, hy - 2, 10, -1 + (mode === 'sing' ? 0 : sway), 13.5, hy - 2], ROBE[2]);
  p.poly([6.5, hy - 2, 10, -1 + (mode === 'sing' ? 0 : sway), 10, hy - 2], ROBE[3]);
  p.rect(6, hy - 3, 9, 1, LACE[2]);
  p.px(10, hy - 6, LACE[2]);
  // face: closed eyes, singing mouth
  if (mode === 'hurt') {
    p.px(8, hy, '#2a1030');
    p.px(12, hy, '#2a1030');
    p.px(8, hy - 1, '#2a1030');
    p.px(12, hy - 1, '#2a1030');
  } else {
    p.px(8, hy, '#3a5070');
    p.px(9, hy, '#3a5070');
    p.px(11, hy, '#3a5070');
    p.px(12, hy, '#3a5070');
  }
  const mh = mode === 'sing' ? 2 : 1;
  p.rect(10, hy + 1, 1, mh, '#2a0a1a');
  if (mode === 'sing') p.px(11, hy + 1, '#2a0a1a');
  // frost on the shoulders
  p.px(6, 11, '#ffffff');
  p.px(13, 11, '#ffffff');
}
frames('ccantor', 'idle', 2, 21, 26, (p, i) => paintCantor(p, i, 'idle'), { anchor: 'bottom', fps: 2, outline: '#14040e' });
frames('ccantor', 'sing', 2, 21, 26, (p, i) => paintCantor(p, i, 'sing'), { anchor: 'bottom', fps: 6, outline: '#14040e' });
frames('ccantor', 'hurt', 1, 21, 26, (p) => paintCantor(p, 0, 'hurt'), { anchor: 'bottom', outline: '#14040e' });

function paintAcolyte(p: PixelPainter, k: number, mode: 'float' | 'sing' | 'hurt'): void {
  const bob = mode === 'float' ? [0, 0, 1, 1][k] : 0;
  const hem = [0, 1, 0, -1][k % 4];
  // little bell-shaped robe
  p.poly([4, 7 + bob, 9, 7 + bob, 12, 15, 1, 15], LACE[1]);
  p.shadeVertical(1, 7 + bob, 11, 8, [LACE[2], LACE[1], LACE[0]], false);
  for (let x = 1 + hem; x < 12; x += 3) p.px(x, 15, null);
  // rose collar ruff
  p.rect(3, 7 + bob, 7, 1, ROSE.mid);
  p.px(3, 8 + bob, ROSE.low);
  p.px(9, 8 + bob, ROSE.low);
  // candle in the hands
  const cy = mode === 'sing' ? 6 : 9;
  p.rect(9, cy + bob, 2, 4, '#f4f8ff');
  p.px(9, cy + 3 + bob, SKIN[1]);
  p.px(10, cy - 1 + bob, '#8cf2ff');
  p.px(10, cy - 2 + bob, k % 2 ? '#ffffff' : '#bff6ff');
  // head
  p.circle(6.5, 4 + bob, 3.2, SKIN[1]);
  sphere(p, 6.5, 4 + bob, 3.2, 3.2, SKIN, false);
  p.px(5, 1 + bob, '#3a4a6a');
  p.px(6, 1 + bob, '#3a4a6a');
  p.px(7, 1 + bob, '#4a5e84');
  p.px(4, 2 + bob, '#3a4a6a');
  // face
  if (mode === 'hurt') {
    p.px(5, 4 + bob, '#2a1030');
    p.px(8, 4 + bob, '#2a1030');
  } else {
    p.px(5, 4 + bob, '#3a5070');
    p.px(8, 4 + bob, '#3a5070');
  }
  p.rect(6, 5 + bob, 1, mode === 'sing' ? 2 : 1, '#2a0a1a');
}
frames('cacolyte', 'float', 4, 13, 16, (p, i) => paintAcolyte(p, i, 'float'), { fps: 6, outline: '#14040e' });
frames('cacolyte', 'sing', 2, 13, 16, (p, i) => paintAcolyte(p, i, 'sing'), { fps: 8, outline: '#14040e' });
frames('cacolyte', 'hurt', 1, 13, 16, (p) => paintAcolyte(p, 0, 'hurt'), { outline: '#14040e' });

/** Living acolytes linked to `cantor`. */
export function linkedAcolytes(w: World, cantor: Enemy): Enemy[] {
  return w.enemies.filter((o) => o.alive && o.def.id === 'choir_acolyte' && o.mem.owner === cantor);
}

/** Fire a wall of rose notes from `e` toward the player with a gap the player must find. */
function hymnWall(e: Enemy, w: World): void {
  const a = e.angleToTarget(w);
  const count = 15;
  const spacing = 11;
  const gap = 3;
  const gs = gapStartFor(count, gap, w.rng.sign() * w.rng.range(2, 4));
  const px = -Math.sin(a);
  const py = Math.cos(a);
  const cx = e.x + Math.cos(a) * 10;
  const cy = e.y + Math.sin(a) * 10;
  for (const s of wallSlots(count, gs, gap)) {
    e.shoot(w, a, bullet('hymn', 3, { x: cx + px * s * spacing, y: cy + py * s * spacing, speed: 58, delay: 0.3, range: 380, z: 8 }));
  }
  w.sfx('enemy_shoot', { vol: 0.5, pitch: 1.4 });
  w.sfx('orb', { vol: 0.3, pitch: 1.6 });
}

defineEnemy({
  id: 'choir_cantor',
  name: '성가대 선창자',
  hp: 46,
  radius: 7,
  speed: 24,
  mass: 2,
  sprite: 'ccantor_idle',
  spriteYOffset: 6,
  shadow: 16,
  cost: 4,
  floors: [4],
  weight: 0.45,
  champion: true,
  deathFx: 'ice',
  bloodColor: '#ff8ab0',
  light: { radius: 26, color: '#ff8ab0' },
  init(e, w) {
    for (let i = 0; i < 2; i++) {
      const m = e.summon(w, 'choir_acolyte', e.x + (i ? 16 : -16), e.y - 4);
      if (m) {
        m.mem.owner = e;
        m.mem.slot = i;
        m.dormant = e.dormant;
      }
    }
    e.mem.links = 2;
  },
  *script(e, w) {
    yield w.rng.range(0.6, 1.2);
    while (true) {
      e.setAnim('ccantor_idle');
      const t = e.mem.enraged ? w.rng.range(1.1, 1.5) : w.rng.range(1.8, 2.4);
      for (let el = 0; el < t; el += w.dt) {
        const d = e.distToTarget(w);
        if (d < 80) e.flee(w, e.speed * 1.2);
        else if (d > 140) e.chase(w, e.speed);
        else e.stop();
        yield;
      }
      e.halt();
      e.setAnim('ccantor_sing');
      e.facing = w.player.x >= e.x ? 1 : -1;
      e.telegraph(0.7);
      w.sfx('beam_charge', { vol: 0.3, pitch: 1.8 });
      for (let el = 0; el < 0.7; el += 0.1) {
        notes(w, e.x, e.y - 22);
        yield 0.1;
      }
      hymnWall(e, w);
      if (e.mem.enraged || e.champion) {
        yield 0.6;
        hymnWall(e, w);
      }
      yield 0.9;
    }
  },
  update(e, w, dt) {
    if (e.mem.blockT > 0) e.mem.blockT -= dt;
    const n = linkedAcolytes(w, e).length;
    if (e.mem.links > 0 && n === 0 && e.alive) {
      // ward shatters
      e.mem.enraged = true;
      w.spawn(new RingFx(e.x, e.y - 12, 28, 0.4, ROSE.hot, 3));
      w.particles.burst(e.x, e.y - 12, { count: 18, speed: [40, 120], life: [0.3, 0.6], colors: ['#ffffff', ROSE.hot, ROSE.mid], size: [1, 2], shape: 'spark' });
      w.sfx('shield_block', { vol: 0.6, pitch: 0.6 });
      w.sfx('freeze', { vol: 0.4, pitch: 1.4 });
      e.squash(1.2, 0.85);
    }
    e.mem.links = n;
  },
  onHurt(e, w, hit) {
    if (!linkedAcolytes(w, e).length) return;
    // warded: the hymn of the living acolytes turns every hit away
    e.hp += appliedDamage(hit, e.hasStatus('weak'), e.hasStatus('freeze'));
    e.kbx *= 0.2;
    e.kby *= 0.2;
    e.squash(1, 1);
    if (hit.kind === 'status') return;
    e.mem.blockT = 0.12;
    const a = Math.atan2(-(hit.dirY ?? 0), -(hit.dirX ?? 1));
    w.particles.burst(e.x + Math.cos(a) * 12, e.y - 12 + Math.sin(a) * 10, { count: 5, speed: [40, 110], life: [0.1, 0.25], colors: ['#ffffff', ROSE.hot, ROSE.mid], shape: 'spark', size: [1, 2] });
    w.sfx('shield_block', { vol: 0.35, pitch: fx.range(1.2, 1.4) });
  },
  draw(e, r, w) {
    // link beams from the acolytes
    for (const a of linkedAcolytes(w, e)) {
      const fl = 0.45 + 0.25 * Math.sin(w.time * 9 + a.id);
      r.line(a.x, a.y - 9, e.x, e.y - 14, ROSE.mid, 2, fl * 0.6);
      r.line(a.x, a.y - 9, e.x, e.y - 14, '#ffffff', 1, fl);
    }
    e.drawDefault(r, hurtFrame(e, w, 'ccantor_hurt_0'));
    if (e.mem.links > 0) {
      const k = 0.5 + 0.2 * Math.sin(w.time * 5);
      r.circle(e.x, e.y - 12, 15, ROSE.hot, e.mem.blockT > 0 ? 0.3 : 0.08);
      r.ring(e.x, e.y - 12, 15, e.mem.blockT > 0 ? '#ffffff' : '#ffb0cc', 1, k);
    }
  },
  onDeath(e, w) {
    for (let i = 0; i < 4; i++) notes(w, e.x, e.y - 14);
  },
});

defineEnemy({
  id: 'choir_acolyte',
  name: '성가대 아이',
  hp: 16,
  radius: 4,
  speed: 40,
  flying: true,
  sprite: 'cacolyte_float',
  shadow: 8,
  spriteYOffset: -7,
  cost: 0.5,
  champion: false,
  deathFx: 'ice',
  bloodColor: '#ff8ab0',
  light: { radius: 14, color: '#8cf2ff' },
  *script(e, w) {
    let next = w.rng.range(1.4, 2.6);
    while (true) {
      const owner = e.mem.owner as Enemy | undefined;
      const linked = !!owner && owner.alive;
      if (linked) {
        const ang = owner.age * 1.3 + (e.mem.slot ?? 0) * Math.PI;
        const gx = owner.x + Math.cos(ang) * 22;
        const gy = owner.y - 2 + Math.sin(ang) * 14;
        e.moveDir(gx - e.x, gy - e.y, Math.min(80, Math.hypot(gx - e.x, gy - e.y) * 6));
      } else {
        const tg = e.target(w);
        const a = Math.atan2(e.y - tg.y, e.x - tg.x) + 0.6 * w.dt;
        const gx = tg.x + Math.cos(a) * 62;
        const gy = tg.y + Math.sin(a) * 50;
        e.moveDir(gx - e.x, gy - e.y, Math.min(e.speed, Math.hypot(gx - e.x, gy - e.y) * 2));
      }
      next -= w.dt;
      if (next <= 0) {
        e.stop();
        e.setAnim('cacolyte_sing');
        e.telegraph(0.45);
        notes(w, e.x, e.y - 12);
        yield 0.45;
        e.shootAt(w, null, bullet('hymn', 3, { speed: 74, z: 8, count: linked ? 1 : 3, spread: 0.3 }));
        e.setAnim('cacolyte_float');
        next = linked ? w.rng.range(2.2, 3.2) : w.rng.range(1.2, 1.8);
      }
      yield;
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'cacolyte_hurt_0'), -7 + Math.sin(e.age * 3 + e.id) * 1.2);
  },
  onDeath(e, w) {
    const owner = e.mem.owner as Enemy | undefined;
    if (!owner || !owner.alive) return;
    // the link snaps back into the cantor
    for (let i = 0; i < 8; i++) {
      const t = i / 8;
      w.particles.spawn({
        x: e.x + (owner.x - e.x) * t, y: e.y - 9 + (owner.y - 14 - e.y + 9) * t, vx: fx.range(-20, 20), vy: fx.range(-20, 20),
        life: fx.range(0.2, 0.4), colors: ['#ffffff', ROSE.hot, ROSE.mid], size: 1, additive: true,
      });
    }
    w.sfx('shield_block', { vol: 0.3, pitch: 0.8 });
  },
});

// ================================================================== 서리 슬라임 (rime slime)
function paintSlime(p: PixelPainter, k: number, mode: 'idle' | 'crouch' | 'air' | 'hurt'): void {
  const sx = mode === 'crouch' ? 1.2 : mode === 'air' ? 0.85 : mode === 'hurt' ? 1.1 : k ? 1.06 : 1;
  const sy = mode === 'crouch' ? 0.75 : mode === 'air' ? 1.2 : mode === 'hurt' ? 0.85 : k ? 0.92 : 1;
  const rx = 6.6 * sx;
  const ry = 5.6 * sy;
  const base = 13;
  const cy = base - ry;
  p.ellipse(7.5, cy + 0.5, rx, ry, '#6cb6ee');
  for (let x = 0; x < 16; x++) for (let y = base; y < 14; y++) p.px(x, y, null);
  sphere(p, 7.5, cy, rx, ry, ['#2e6ab8', '#4a90d8', '#7ccaf4', '#a8e2ff', '#e8faff'], false);
  // frozen core cube (seen through the jelly)
  const cyy = Math.round(cy) + 1;
  p.rect(8, cyy, 3, 3, '#3a7ad0');
  p.rect(8, cyy, 3, 1, '#bfeaff');
  p.px(10, cyy + 2, '#2856a8');
  // specular glints
  p.px(Math.round(7.5 - rx * 0.55), Math.round(cy - ry * 0.4), '#ffffff');
  p.px(Math.round(7.5 - rx * 0.55) + 1, Math.round(cy - ry * 0.55), '#ffffff');
  // ice spikes on top
  const top = base - ry * 2;
  p.poly([3.5, top + 3, 4.5, top - 1, 6, top + 2], '#e8faff');
  p.poly([6.5, top + 1.5, 8, top - 3, 9.5, top + 1.5], '#ffffff');
  p.poly([10, top + 2, 11.5, top - 0.5, 12, top + 3], '#bff6ff');
  // eyes
  const ey = Math.round(cy - ry * 0.25);
  if (mode === 'hurt') {
    p.line(4, ey - 1, 6, ey, DEEP);
    p.line(11, ey - 1, 9, ey, DEEP);
  } else {
    p.rect(5, ey - 1, 1, 2, DEEP);
    p.rect(9, ey - 1, 1, 2, DEEP);
    p.px(6, ey - 1, '#0a2048');
    p.px(10, ey - 1, '#0a2048');
  }
  for (let x = 0; x < 16; x++) if (p.isSet(x, base - 1)) p.px(x, base - 1, '#2e6ab8');
}
frames('rslime', 'idle', 2, 15, 14, (p, i) => paintSlime(p, i, 'idle'), { anchor: 'bottom', fps: 3, outline: DEEP });
frames('rslime', 'crouch', 1, 15, 14, (p) => paintSlime(p, 0, 'crouch'), { anchor: 'bottom', outline: DEEP });
frames('rslime', 'air', 1, 15, 14, (p) => paintSlime(p, 0, 'air'), { anchor: 'bottom', outline: DEEP });
frames('rslime', 'hurt', 1, 15, 14, (p) => paintSlime(p, 0, 'hurt'), { anchor: 'bottom', outline: DEEP });

defineEnemy({
  id: 'rime_slime',
  name: '서리 슬라임',
  hp: 36,
  radius: 6,
  speed: 0,
  sprite: 'rslime_idle',
  spriteYOffset: 5,
  shadow: 13,
  cost: 1.5,
  floors: [4],
  weight: 1,
  champion: true,
  deathFx: 'ice',
  bloodColor: '#a8ecff',
  dieSfx: 'freeze',
  light: { radius: 16, color: '#7cd0ff' },
  *script(e, w) {
    yield w.rng.range(0.2, 0.7);
    let hops = 0;
    while (true) {
      e.setAnim('rslime_idle');
      yield w.rng.range(0.45, 0.8);
      e.setAnim('rslime_crouch');
      const big = hops % 3 === 2;
      e.telegraph(big ? 0.45 : 0.3);
      const tg = e.target(w);
      const s = stepToward(e.x, e.y, tg.x, tg.y, big ? 60 : 46);
      const land = landingSpot(w, s.x, s.y, e.r);
      w.spawn(new GroundWarning(land.x, land.y, big ? 14 : 8, (big ? 0.45 : 0.3) + 0.5, undefined, WARN_RED));
      yield big ? 0.45 : 0.3;
      e.setAnim('rslime_air');
      yield* e.jumpTo(w, land.x, land.y, 0.5, big ? 30 : 18);
      e.setAnim('rslime_crouch');
      w.spawn(new FrostPatch(e.x, e.y + 1, big ? 16 : 12, 3.2));
      dust(w, e.x, e.y + 2, SNOWDUST, 6, 50);
      if (big) {
        const off = w.rng.angle();
        e.shootRing(w, e.champion ? 10 : 8, shard('frost', 3, { speed: 78, offset: off, z: 4 }));
        w.shake(0.15);
      }
      hops++;
      yield 0.15;
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'rslime_hurt_0'));
  },
  onDeath(e, w) {
    w.spawn(new FrostPatch(e.x, e.y + 1, 18, 3.5));
    const off = w.rng.angle();
    for (let i = 0; i < 6; i++) e.shoot(w, off + (i / 6) * TAU, shard('frost', 2, { speed: 60, delay: 0.3, z: 4, range: 140 }));
  },
});

// ================================================================== 눈꽃 정령 (snowflake sprite)
function paintFlake(p: PixelPainter, k: number, mode: 'spin' | 'flare' | 'hurt'): void {
  const c = 6.5;
  const rot = (k * Math.PI) / 12 + (mode === 'hurt' ? 0.2 : 0);
  const len = mode === 'flare' ? 6.4 : 5.6;
  for (let i = 0; i < 6; i++) {
    const a = rot + (i / 6) * TAU;
    const ex = c + Math.cos(a) * len;
    const ey = c + Math.sin(a) * len;
    p.line(c, c, ex, ey, i % 2 ? '#bff6ff' : '#ffffff');
    // side branches
    const bx = c + Math.cos(a) * len * 0.6;
    const by = c + Math.sin(a) * len * 0.6;
    p.line(bx, by, bx + Math.cos(a + 0.9) * 1.8, by + Math.sin(a + 0.9) * 1.8, '#8cf2ff');
    p.line(bx, by, bx + Math.cos(a - 0.9) * 1.8, by + Math.sin(a - 0.9) * 1.8, '#8cf2ff');
    p.px(ex, ey, mode === 'flare' ? '#ffffff' : '#5ad0ff');
  }
  // face
  p.circle(c, c, 3, mode === 'flare' ? '#ffffff' : '#e8f8ff');
  p.px(c - 1, c, '#bfeaff');
  const eye = mode === 'hurt' ? '#6cb6ee' : DEEP;
  p.rect(4, 5, 1, 2, eye);
  p.rect(8, 5, 1, 2, eye);
  if (mode === 'flare') p.rect(6, 7, 1, 2, DEEP);
}
frames('sflake', 'spin', 4, 13, 13, (p, i) => paintFlake(p, i, 'spin'), { fps: 10, outline: DEEP });
frames('sflake', 'flare', 2, 13, 13, (p, i) => paintFlake(p, i * 2, 'flare'), { fps: 18, outline: DEEP });
frames('sflake', 'hurt', 1, 13, 13, (p) => paintFlake(p, 1, 'hurt'), { outline: DEEP });

defineEnemy({
  id: 'snowflake_sprite',
  name: '눈꽃 정령',
  hp: 12,
  radius: 4,
  speed: 46,
  flying: true,
  sprite: 'sflake_spin',
  shadow: 8,
  spriteYOffset: -7,
  cost: 0.7,
  floors: [4],
  weight: 1,
  champion: true,
  deathFx: 'ice',
  bloodColor: '#e8f8ff',
  dieSfx: 'freeze',
  light: { radius: 14, color: '#bfefff' },
  *script(e, w) {
    yield w.rng.range(0.1, 0.6);
    const ph = w.rng.range(0, TAU);
    while (true) {
      e.setAnim('sflake_spin');
      for (let el = 0; el < 3; el += w.dt) {
        const a = e.angleToTarget(w) + Math.sin(e.age * 3 + ph) * 0.8;
        e.moveAngle(a, e.speed);
        if (e.distToTarget(w) < 34) break;
        yield;
      }
      if (e.distToTarget(w) >= 40) continue;
      // burst into shards (it dies doing it — shoot it before it gets close)
      e.halt();
      e.setAnim('sflake_flare');
      e.telegraph(0.5);
      gather(w, e.x, e.y - 7, SNOWDUST, 8, 14);
      w.sfx('freeze', { vol: 0.3, pitch: 1.8 });
      yield 0.5;
      e.shootRing(w, e.champion ? 8 : 6, shard('frost', 2, { speed: 92, offset: w.rng.angle(), z: 7, range: 200 }));
      w.spawn(new RingFx(e.x, e.y - 7, 14, 0.25, '#ffffff', 2));
      w.killEnemy(e);
      return;
    }
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'sflake_hurt_0'), -7 + Math.sin(e.age * 4 + e.id) * 1.5);
  },
});
