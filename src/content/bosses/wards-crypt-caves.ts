// Boss skills, floors 1–2 (see resolve.ts):
//  조종지기 종 속 은신   — the bell drops over it; only the NUMBER of hits rings it open
//                         (how hard each hit is does not matter)
//  해골 거상 뼈 갑주     — bone plating on its front turns slowly toward the keeper;
//                         hits from the front glance off, flank or back strikes crack it
//  포자 어미 치유 고치   — mending cocoons sprout around the cave; while any stands she
//                         heals and shrugs off part of the damage — break them
//  점액 여왕 왕관 도주   — at each phase change a little slime runs off with her crown;
//                         she is pure jelly (untouchable) until it is caught and popped

import { defineEnemy, Enemies } from '../../game/defs';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { fx } from '../../engine/rng';
import { frames } from '../enemies/shared';
import {
  announceWard, angleDiff, blockedFx, daze, defineBossWard, freeSpot, helpersOf, hitFrom, keepers, raiseHelper,
} from './resolve';

const bodyY = (e: Enemy): number => e.y - e.z - e.r * 0.8;

/** Angle from the boss to the keeper it is after. */
function towardKeeper(e: Enemy, w: World): number {
  const t = e.target(w);
  return Math.atan2(t.y - e.y, t.x - e.x);
}

// ================================================================== 조종지기: 종 속 은신
/** Hits needed to ring the bell open; seconds it stays down at most; seconds between drops. */
export const BELL_RINGS = 8;
export const BELL_TIME = 9;
export const BELL_EVERY = 22;
const BRONZE = ['#2e1a0c', '#5a3818', '#8a5a26', '#bc8a3e', '#e8c070', '#fff0b8'];

function bellDrop(e: Enemy, w: World): void {
  const m = e.mem;
  m.wdBell = 1;
  m.wdRings = 0;
  m.wdBellT = BELL_TIME;
  w.sfx('slam', { vol: 0.7, pitch: 0.6 });
  w.sfx('clock_chime', { vol: 0.6, pitch: 0.45 });
  w.shake(0.12);
  w.particles.burst(e.x, e.y, { count: 14, speed: [30, 90], life: [0.3, 0.6], colors: ['#8a7a6a', '#5a4a3a', BRONZE[3]], size: [1, 2] });
  announceWard(e, w);
}

function bellLift(e: Enemy, w: World, rung: boolean): void {
  const m = e.mem;
  m.wdBell = 0;
  m.wdNext = BELL_EVERY;
  if (rung) {
    daze(e, w, 2);
    w.particles.burst(e.x, bodyY(e), { count: 22, speed: [50, 150], life: [0.3, 0.7], colors: ['#ffffff', BRONZE[5], BRONZE[4], BRONZE[2]], size: [1, 2], shape: 'spark', additive: true });
    w.sfx('rock_break', { vol: 0.6, pitch: 0.8 });
    w.sfx('clock_chime', { vol: 0.7, pitch: 0.7 });
  } else w.sfx('whoosh', { vol: 0.4, pitch: 0.7 });
}

defineBossWard('bell_keeper', {
  name: '종 속 은신',
  hint: '종을 여러 번 쳐서 깨우세요 · 한 방의 세기보다 타격 횟수가 중요합니다',
  color: '#e8c070',
  begin(e) {
    e.mem.wdBell = 0;
    e.mem.wdRings = 0;
    e.mem.wdBellT = 0;
    e.mem.wdNext = 12;
  },
  phase(e, w) {
    bellDrop(e, w);
  },
  update(e, w, dt) {
    const m = e.mem;
    if (m.wdBell) {
      m.wdBellT -= dt;
      if (m.wdBellT <= 0) bellLift(e, w, false);
    } else if (!m.rsHold && (m.wdNext -= dt) <= 0) bellDrop(e, w);
  },
  filter(e, w, hit) {
    const m = e.mem;
    if (!m.wdBell) return hit.damage;
    if (hit.kind !== 'status') {
      m.wdRings++;
      w.sfx('clock_chime', { vol: 0.28, pitch: 0.7 + m.wdRings * 0.06 });
      w.particles.burst(e.x + fx.range(-8, 8), bodyY(e) + fx.range(-6, 6), { count: 3, speed: [30, 80], life: [0.1, 0.25], colors: [BRONZE[5], BRONZE[4]], size: [1, 1], shape: 'spark' });
      if (m.wdRings >= BELL_RINGS) bellLift(e, w, true);
    }
    return 0;
  },
  active: (e) => !!e.mem.wdBell,
  draw(r, _w, e, t) {
    const m = e.mem;
    if (!m.wdBell) return;
    const W = e.r * 2 + 16;
    const H = e.r * 2.4 + 18;
    const drop = Math.max(0, 1 - (BELL_TIME - m.wdBellT) / 0.18);
    const lip = e.y + 3 - drop * 40;
    const top = lip - H;
    // a solid bronze bell over it: shaded row by row, darker at the rim, a bright band near the lip
    const halfAt = (k: number) => W * (k < 0.16 ? 0.16 + k * 0.9 : k < 0.8 ? 0.3 + (k - 0.16) * 0.16 : 0.4 + (k - 0.8) * 0.5);
    for (let yy = Math.round(top); yy <= Math.round(lip); yy++) {
      const k = (yy - top) / (lip - top);
      const half = Math.round(halfAt(k));
      const x0 = Math.round(e.x - half);
      const band = k > 0.78 && k < 0.86;
      r.rect(x0, yy, half * 2, 1, band ? BRONZE[4] : k > 0.94 ? BRONZE[3] : BRONZE[2], 0.92);
      // light from the top-left: a highlight streak and a shadowed right side
      r.rect(x0 + Math.max(1, Math.round(half * 0.35)), yy, Math.max(1, Math.round(half * 0.22)), 1, BRONZE[3], 0.9);
      r.rect(x0 + half * 2 - Math.max(1, Math.round(half * 0.3)), yy, Math.max(1, Math.round(half * 0.3)), 1, BRONZE[1], 0.9);
      r.rect(x0 - 1, yy, 1, 1, '#140c08', 0.95);
      r.rect(x0 + half * 2, yy, 1, 1, '#140c08', 0.95);
    }
    r.rect(Math.round(e.x - halfAt(0) ), Math.round(top) - 1, Math.round(halfAt(0) * 2), 1, '#140c08', 0.95);
    // the crown loop on top
    r.pixelRing(e.x, top - 3, 3, BRONZE[4], 1, 0.95);
    r.rect(Math.round(e.x - halfAt(1)), Math.round(lip) + 1, Math.round(halfAt(1) * 2), 1, '#140c08', 0.9);
    // cracks spread as it is rung
    const k = m.wdRings / BELL_RINGS;
    const crack = (x0: number, y0: number, x1: number, y1: number) => r.pixelLine(e.x + x0 * W, top + y0 * H, e.x + x1 * W, top + y1 * H, '#1a0e06', 1, 0.95);
    if (k > 0.2) { crack(-0.18, 0.3, -0.1, 0.5); crack(-0.1, 0.5, -0.16, 0.66); }
    if (k > 0.45) { crack(0.14, 0.2, 0.2, 0.45); crack(0.2, 0.45, 0.12, 0.62); }
    if (k > 0.7) { crack(-0.04, 0.62, 0.06, 0.8); crack(0.06, 0.8, 0.0, 0.98); }
    // ring count: a pip per hit still needed, lit as the bell is struck
    for (let i = 0; i < BELL_RINGS; i++) {
      const x = Math.round(e.x - (BELL_RINGS - 1) * 2.5 + i * 5);
      const lit = i < m.wdRings;
      r.rect(x - 2, Math.round(lip + 4), 4, 4, '#140c08', 0.95);
      r.rect(x - 1, Math.round(lip + 5), 2, 2, lit ? BRONZE[5] : BRONZE[1], 1);
    }
    // a soft hum
    if (Math.sin(t * 10) > 0.6) r.pixelRing(e.x, top + H * 0.55, W * 0.62, BRONZE[4], 1, 0.2);
  },
  light(w, e) {
    if (e.mem.wdBell) w.lights.add(e.x, e.y - 12, 50, '#e8c070', { intensity: 0.35 });
  },
});

// ================================================================== 해골 거상: 뼈 갑주
/** Half-width of the plated front (rad); damage through it; turn rate toward the keeper (rad/s). */
export const PLATE_FRONT = 1.05;
export const PLATE_THROUGH = 0.2;
export const PLATE_TURN = 0.9;
/** Damage of a strike from the flank or behind while plated. */
export const PLATE_BACK = 1.15;
const BONE = ['#3a2e3e', '#665a64', '#988a7c', '#c6b99c', '#ece2c6'];
const SOUL_V = ['#3a2a8a', '#8a6af0', '#d8d0ff'];

function plate(e: Enemy, w: World, t: number): void {
  e.mem.wdPlate = 1;
  e.mem.wdPlateT = t;
  w.sfx('hit_metal', { vol: 0.6, pitch: 0.55 });
  w.sfx('rock_break', { vol: 0.4, pitch: 1.2 });
  w.particles.burst(e.x, bodyY(e), { count: 12, speed: [30, 90], life: [0.2, 0.5], colors: [BONE[4], BONE[3], BONE[2]], size: [1, 2] });
  announceWard(e, w);
}

defineBossWard('bone_colossus', {
  name: '뼈 갑주',
  hint: '앞쪽 뼈 갑옷은 공격을 튕겨냅니다 · 옆이나 뒤로 돌아가 치세요',
  color: '#ece2c6',
  begin(e, w) {
    e.mem.wdPlate = 0;
    e.mem.wdPlateT = 0;
    e.mem.wdNext = 6;
    e.mem.wdFace = towardKeeper(e, w);
  },
  phase(e, w) {
    plate(e, w, 10);
  },
  update(e, w, dt) {
    const m = e.mem;
    // the plated front turns toward the keeper, slower than a keeper can circle
    const want = towardKeeper(e, w);
    const d = angleDiff(want - m.wdFace);
    const step = PLATE_TURN * dt;
    m.wdFace = angleDiff(m.wdFace + Math.max(-step, Math.min(step, d)));
    if (m.wdPlate) {
      m.wdPlateT -= dt;
      if (m.wdPlateT <= 0) {
        m.wdPlate = 0;
        m.wdNext = 16;
        w.sfx('rock_break', { vol: 0.35, pitch: 0.9 });
      }
    } else if (!m.rsHold && (m.wdNext -= dt) <= 0) plate(e, w, 7);
  },
  filter(e, w, hit, dmg) {
    const m = e.mem;
    if (!m.wdPlate) return dmg;
    if (hit.kind === 'status') return dmg * 0.6;
    const from = hitFrom(e, hit);
    const off = Math.abs(angleDiff(Math.atan2(from.y - e.y, from.x - e.x) - m.wdFace));
    if (off < PLATE_FRONT) {
      blockedFx(e, w, hit, ['#ffffff', BONE[4], BONE[3]]);
      return dmg * PLATE_THROUGH;
    }
    if (fx.chance(0.5)) w.particles.burst(e.x, bodyY(e), { count: 4, speed: [40, 110], life: [0.12, 0.3], colors: ['#ffffff', '#e0d8ff', BONE[4]], size: [1, 2], shape: 'spark', additive: true });
    return dmg * PLATE_BACK;
  },
  active: (e) => !!e.mem.wdPlate,
  draw(r, _w, e, t) {
    const m = e.mem;
    if (!m.wdPlate) return;
    const cx = e.x;
    const cy = bodyY(e);
    const rad = e.r + 13;
    const a0 = m.wdFace - PLATE_FRONT;
    const a1 = m.wdFace + PLATE_FRONT;
    const fade = m.wdPlateT < 1 && Math.floor(t * 10) % 2 ? 0.45 : 1;
    // the soul flame binds the plates: a violet arc behind them
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      r.rect(Math.round(cx + Math.cos(a) * rad), Math.round(cy + Math.sin(a) * rad * 0.8), 2, 1, SOUL_V[1], 0.55 * fade);
    }
    // a curved wall of thick bone plates in front of it
    const k = 7;
    for (let i = 0; i < k; i++) {
      const a = a0 + ((a1 - a0) * (i + 0.5)) / k;
      const x = Math.round(cx + Math.cos(a) * rad);
      const y = Math.round(cy + Math.sin(a) * rad * 0.8);
      r.rect(x - 3, y - 4, 7, 8, '#0c0810', 0.95 * fade);
      r.rect(x - 2, y - 3, 5, 6, BONE[3], fade);
      r.rect(x - 2, y - 3, 5, 1, BONE[4], fade);
      r.rect(x - 2, y + 2, 5, 1, BONE[1], fade);
      r.rect(x, y - 1, 1, 2, SOUL_V[2], fade);
    }
  },
});

// ================================================================== 포자 어미: 치유 고치
/** Cocoons sprouted at a time; each heals this share of max HP per second; damage through while any stands. */
export const COCOONS = 2;
export const COCOON_HEAL = 0.008;
export const COCOON_THROUGH = 0.6;
const COCOON_HP = 0.04;
const SPORE = '#d6ff5a';
const CAP = ['#1a0a2c', '#32124a', '#521e6a', '#74308c', '#9a4cae', '#c07ccc'];
const MYCEL = ['#5e5446', '#8a8070', '#c8c0a8', '#ece6d4'];

function sprout(e: Enemy, w: World): void {
  const spots: { x: number; y: number }[] = [];
  for (let i = 0; i < COCOONS; i++) {
    const at = freeSpot(w, e, 60, spots);
    spots.push(at);
    raiseHelper(w, e, 'ward_cocoon', at.x, at.y, COCOON_HP);
  }
  w.sfx('summon', { vol: 0.5, pitch: 1.2 });
  w.sfx('poison', { vol: 0.4, pitch: 0.8 });
  announceWard(e, w);
}

defineBossWard('spore_mother', {
  name: '치유 고치',
  hint: '고치가 남아 있는 동안 포자 어미가 회복하고 피해를 덜 받습니다 · 고치부터 부수세요',
  color: SPORE,
  begin(e) {
    e.mem.wdNext = 14;
  },
  phase(e, w) {
    sprout(e, w);
    e.mem.wdNext = 26;
  },
  update(e, w, dt) {
    const m = e.mem;
    const n = helpersOf(w, e, 'ward_cocoon').length;
    if (n > 0) {
      if (!m.rsHold) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * COCOON_HEAL * n * dt);
      if (fx.chance(0.2)) w.particles.spawn({ x: e.x + fx.range(-10, 10), y: bodyY(e) + fx.range(-8, 8), vy: -20, life: 0.5, size: 1, colors: ['#f6ffd0', SPORE], additive: true });
      return;
    }
    if (!m.rsHold && (m.wdNext -= dt) <= 0) {
      sprout(e, w);
      m.wdNext = 26;
    }
  },
  filter(e, w, _hit, dmg) {
    return helpersOf(w, e, 'ward_cocoon').length ? dmg * COCOON_THROUGH : dmg;
  },
  active: (e, w) => helpersOf(w, e, 'ward_cocoon').length > 0,
  draw(r, w, e, t) {
    for (const c of helpersOf(w, e, 'ward_cocoon')) {
      // a root vine from the cocoon to her, sap of light running along it
      const x0 = c.x;
      const y0 = c.y - 6;
      const x1 = e.x;
      const y1 = bodyY(e);
      const n = 12;
      let px = x0;
      let py = y0;
      for (let i = 1; i <= n; i++) {
        const k = i / n;
        const sway = Math.sin(k * Math.PI) * 6 * Math.sin(t * 2 + c.id);
        const x = x0 + (x1 - x0) * k - ((y1 - y0) / 100) * sway;
        const y = y0 + (y1 - y0) * k + ((x1 - x0) / 100) * sway;
        r.pixelLine(px, py, x, y, '#2a1c1c', 1, 0.9);
        r.pixelLine(px, py - 1, x, y - 1, '#8a6a44', 1, 0.9);
        px = x;
        py = y;
      }
      for (let j = 0; j < 2; j++) {
        const k = (t * 0.8 + j * 0.5 + c.id * 0.13) % 1;
        const x = x0 + (x1 - x0) * k;
        const y = y0 + (y1 - y0) * k;
        r.rect(Math.round(x) - 1, Math.round(y) - 2, 3, 3, '#1a2a08', 0.8);
        r.rect(Math.round(x), Math.round(y) - 1, 1, 1, SPORE, 1);
      }
    }
  },
});

frames('wcocoon', 'idle', 2, 14, 17, (p, i) => {
  // root base
  p.rect(2, 14, 10, 2, '#4a3428');
  p.px(1, 15, '#2a1c1c');
  p.px(12, 15, '#2a1c1c');
  // the pod: mycelium wrapping over a glowing heart
  const sw = i ? 0.4 : 0;
  p.ellipse(7, 8.5, 5.4 + sw, 6.2 + sw, MYCEL[1]);
  p.ellipse(7, 8.5, 3.6 + sw, 4.6, CAP[3]);
  p.ellipse(7, 9, 2 + sw, 2.6, SPORE);
  p.px(6, 8, '#f6ffd0');
  for (const [x, y] of [[3, 5], [4, 4], [10, 6], [11, 9], [3, 11], [9, 13]]) p.px(x, y, MYCEL[3]);
  p.line(4, 3, 9, 12, MYCEL[2]);
  p.line(10, 3, 5, 13, MYCEL[2]);
  p.px(7, 2, MYCEL[3]);
}, { fps: 3 });
frames('wcocoon', 'hurt', 1, 14, 17, (p) => {
  p.rect(2, 14, 10, 2, '#6a4c34');
  p.ellipse(7, 8.5, 5.4, 6.2, '#ffffff');
  p.ellipse(7, 9, 2, 2.6, SPORE);
});

if (!Enemies.has('ward_cocoon')) defineEnemy({
  id: 'ward_cocoon',
  name: '치유 고치',
  hp: 20,
  radius: 6,
  speed: 0,
  mass: Infinity,
  contactDamage: 0,
  sprite: 'wcocoon_idle',
  shadow: 10,
  deathFx: 'spore',
  bloodColor: SPORE,
  light: { radius: 22, color: SPORE },
  *script(e) {
    while (true) {
      if (!e.parent || !e.parent.alive) {
        e.dead = true;
        e.hp = 0;
        return;
      }
      e.setAnim('wcocoon_idle');
      yield 0.1;
    }
  },
  onDeath(e, w) {
    w.particles.burst(e.x, e.y - 8, { count: 16, speed: [40, 120], life: [0.25, 0.6], colors: ['#f6ffd0', SPORE, MYCEL[2]], size: [1, 2] });
    w.sfx('splat', { vol: 0.5, pitch: 1.2 });
  },
});

// ================================================================== 점액 여왕: 왕관 도주
/** Seconds the crown stays away before it hops home on its own; crown slime HP share; its speed. */
export const CROWN_TIME = 12;
const CROWN_HP = 0.03;
export const CROWN_SPEED = 72;
const JELLY = ['#4a1c06', '#86400e', '#c4701c', '#eea032', '#ffcc6a', '#fff0c0'];
const GOLD = ['#7a4a08', '#c08a18', '#ffd040', '#fff4a0'];

defineBossWard('slime_queen', {
  name: '왕관 도주',
  hint: '작은 슬라임이 왕관을 들고 달아났습니다 · 잡아서 터뜨리기 전엔 여왕에게 피해가 들어가지 않습니다',
  color: '#ffd040',
  begin(e) {
    e.mem.wdCrown = 0;
    e.mem.wdCrownT = 0;
  },
  phase(e, w) {
    const m = e.mem;
    const h = raiseHelper(w, e, 'ward_crown_slime', e.x, e.y + 4, CROWN_HP);
    if (!h) return;
    h.dormant = 0.2;
    m.wdCrown = 1;
    m.wdCrownT = CROWN_TIME;
    w.sfx('enemy_jump', { vol: 0.6, pitch: 1.6 });
    w.particles.burst(e.x, bodyY(e) - 8, { count: 10, speed: [40, 110], life: [0.2, 0.4], colors: [GOLD[3], GOLD[2], JELLY[4]], size: [1, 2], shape: 'spark' });
    announceWard(e, w);
  },
  update(e, w, dt) {
    const m = e.mem;
    if (!m.wdCrown) return;
    const crowns = helpersOf(w, e, 'ward_crown_slime');
    m.wdCrownT -= dt;
    if (!crowns.length) {
      // caught and popped: the crown flies home and she reels
      m.wdCrown = 0;
      daze(e, w, 2);
      return;
    }
    if (m.wdCrownT <= 0) {
      m.wdCrown = 0;
      for (const c of crowns) {
        c.dead = true;
        c.hp = 0;
        w.particles.burst(c.x, c.y - 6, { count: 8, speed: [30, 80], life: [0.2, 0.4], colors: [GOLD[2], JELLY[4]], size: [1, 2] });
      }
      w.sfx('enemy_jump', { vol: 0.4, pitch: 1.2 });
    }
  },
  filter(e, w, hit) {
    if (!e.mem.wdCrown) return hit.damage;
    // shots squelch straight through the jelly
    if (hit.kind !== 'status' && fx.chance(0.5)) w.particles.burst(e.x + fx.range(-8, 8), bodyY(e) + fx.range(-6, 6), { count: 3, speed: [20, 60], life: [0.15, 0.3], colors: [JELLY[4], JELLY[3]], size: [1, 2] });
    return 0;
  },
  active: (e) => !!e.mem.wdCrown,
  draw(r, w, e, t) {
    const m = e.mem;
    if (!m.wdCrown) return;
    // the queen goes see-through: a wobbling jelly rim
    const rad = e.r + 4;
    const cy = bodyY(e);
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const wob = Math.sin(t * 6 + i * 1.7) * 1.5;
      r.rect(Math.round(e.x + Math.cos(a) * (rad + wob)), Math.round(cy + Math.sin(a) * (rad + wob) * 0.8), 1, 1, JELLY[5], 0.7);
    }
    // a dotted gold line to where her crown ran
    for (const c of helpersOf(w, e, 'ward_crown_slime')) {
      const n = Math.max(3, Math.floor(Math.hypot(c.x - e.x, c.y - cy) / 7));
      for (let i = 1; i < n; i++) {
        const k = (i + ((t * 3) % 1)) / n;
        r.rect(Math.round(e.x + (c.x - e.x) * k), Math.round(cy + (c.y - 8 - cy) * k), 1, 1, GOLD[2], 0.75);
      }
    }
  },
});

frames('wcrown', 'idle', 2, 13, 13, (p, i) => {
  const squash = i ? 0.6 : 0;
  // little jelly body
  p.ellipse(6.5, 9 + squash * 0.5, 5.2 + squash, 3.6 - squash * 0.6, JELLY[2]);
  p.ellipse(6.5, 8.6 + squash * 0.5, 4 + squash, 2.6 - squash * 0.4, JELLY[3]);
  p.px(4, 8, JELLY[5]);
  p.px(5, 8, JELLY[4]);
  p.px(5, 10, '#2a0e04');
  p.px(8, 10, '#2a0e04');
  // the queen's crown, much too big for it
  const cy = 4 + squash;
  p.rect(3, cy, 7, 2, GOLD[2]);
  p.rect(3, cy + 1, 7, 1, GOLD[1]);
  p.px(3, cy - 1, GOLD[2]);
  p.px(6, cy - 2, GOLD[3]);
  p.px(6, cy - 1, GOLD[2]);
  p.px(9, cy - 1, GOLD[2]);
  p.px(6, cy, '#e0204a');
}, { fps: 6 });
frames('wcrown', 'hurt', 1, 13, 13, (p) => {
  p.ellipse(6.5, 9, 5.2, 3.6, '#ffffff');
  p.rect(3, 4, 7, 2, GOLD[3]);
});

if (!Enemies.has('ward_crown_slime')) defineEnemy({
  id: 'ward_crown_slime',
  name: '왕관 슬라임',
  hp: 12,
  radius: 5,
  speed: CROWN_SPEED,
  contactDamage: 0,
  sprite: 'wcrown_idle',
  shadow: 8,
  deathFx: 'goo',
  bloodColor: JELLY[3],
  light: { radius: 20, color: GOLD[2] },
  *script(e, w) {
    while (true) {
      if (!e.parent || !e.parent.alive) {
        e.dead = true;
        e.hp = 0;
        return;
      }
      // scurry away from the nearest keeper, sliding along the walls
      let nx = 0;
      let ny = 0;
      for (const p of keepers(w)) {
        const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
        const k = Math.max(0, 140 - d) / 140;
        nx += ((e.x - p.x) / d) * k;
        ny += ((e.y - p.y) / d) * k;
      }
      const room = w.room;
      const cx = room.centerX;
      const cy = room.centerY;
      // keep off the walls: lean back toward the middle near an edge
      const ex = Math.abs(e.x - cx) / (room.interiorW / 2);
      const ey = Math.abs(e.y - cy) / (room.interiorH / 2);
      if (ex > 0.7) nx += (cx - e.x) / room.interiorW * 4 * (ex - 0.7);
      if (ey > 0.6) ny += (cy - e.y) / room.interiorH * 4 * (ey - 0.6);
      if (Math.hypot(nx, ny) < 0.05) e.stop();
      else e.moveDir(nx, ny, CROWN_SPEED);
      e.setAnim('wcrown_idle');
      yield 0.1;
    }
  },
  onDeath(e, w) {
    w.particles.burst(e.x, e.y - 6, { count: 14, speed: [40, 120], life: [0.25, 0.5], colors: [GOLD[3], GOLD[2], JELLY[4], JELLY[3]], size: [1, 2], shape: 'spark' });
    w.sfx('splat', { vol: 0.5, pitch: 1.5 });
    w.sfx('coin', { vol: 0.4, pitch: 0.8 });
  },
});
