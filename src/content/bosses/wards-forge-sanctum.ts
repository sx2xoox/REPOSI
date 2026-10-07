// Boss skills, floors 3–4 (see resolve.ts):
//  사슬 대장장이 사슬 고정 — hammers anchors into the floor and chains itself to them;
//                           chained it takes a fifth of the damage. Strike an anchor, or
//                           shoot across a chain anywhere along its length, to break it
//  쇳물 이무기   식은 껍질 — its body cools into a slag crust: hits on the body barely
//                           scratch it, only the head (the pearl in its jaws) takes them
//  빙결 성녀     얼음 거울 — a warned ice mirror: shots that strike it fly back as frost
//                           shards; blades and blasts still get through
//  서리 기사단장 군기 진형 — plants a frozen war banner; within its aura he takes a quarter
//                           of the damage. Lure him away from it, or cut it down

import { defineEnemy, Enemies } from '../../game/defs';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import { Projectile } from '../../game/projectile';
import { fx } from '../../engine/rng';
import { bullet, frames } from '../enemies/shared';
import { ImugiPart } from './slag-imugi';
import { announceWard, blockedFx, daze, defineBossWard, freeSpot, helpersOf, raiseHelper } from './resolve';

const bodyY = (e: Enemy): number => e.y - e.z - e.r * 0.8;

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const l = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l));
  return { d: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)), t };
}

// ================================================================== 사슬 대장장이: 사슬 고정
/** Anchors per mooring, their HP share, damage through while chained. */
export const ANCHORS = 2;
const ANCHOR_HP = 0.03;
export const CHAIN_THROUGH = 0.2;
const IRON = ['#121018', '#26222c', '#403a46', '#625a66', '#8a8090', '#b0a6b0'];
const HOT = ['#3a0a06', '#7a1a0a', '#b8340e', '#e8641a', '#ffa040', '#ffe0a0'];
const CHAIN = ['#2a2630', '#5a5462', '#8a8292'];

/** Where a chain leaves the anchor and where it meets the smith. */
export function chainEnds(e: Enemy, a: Enemy): [number, number, number, number] {
  return [a.x, a.y - 11, e.x, e.y - e.z - e.r * 0.6];
}

function moor(e: Enemy, w: World): void {
  const spots: { x: number; y: number }[] = [];
  for (let i = 0; i < ANCHORS; i++) {
    const at = freeSpot(w, e, 56, spots);
    spots.push(at);
    raiseHelper(w, e, 'ward_anchor', at.x, at.y, ANCHOR_HP);
  }
  w.sfx('slam', { vol: 0.7, pitch: 0.8 });
  w.sfx('hit_metal', { vol: 0.6, pitch: 0.6 });
  w.shake(0.1);
  announceWard(e, w);
}

defineBossWard('chain_smith', {
  name: '사슬 고정',
  hint: '사슬로 몸을 묶어 피해를 버팁니다 · 닻을 치거나 사슬을 가로질러 쏘아 끊으세요',
  color: '#ffa040',
  begin(e) {
    e.mem.wdNext = 10;
  },
  phase(e, w) {
    moor(e, w);
    e.mem.wdNext = 28;
  },
  update(e, w, dt) {
    const m = e.mem;
    const anchors = helpersOf(w, e, 'ward_anchor');
    if (!anchors.length) {
      if (!m.rsHold && (m.wdNext -= dt) <= 0) {
        moor(e, w);
        m.wdNext = 28;
      }
      return;
    }
    // a shot crossing a chain strikes its anchor (once) and is spent on the links
    for (const pr of w.projectiles) {
      if (pr.dead || pr.team !== 'player') continue;
      for (const a of anchors) {
        if (!a.alive || pr.hitIds.has(a.id)) continue;
        const [ax, ay, bx, by] = chainEnds(e, a);
        const s = segDist(pr.x, pr.y - pr.z * 0.5, ax, ay, bx, by);
        if (s.d > pr.r + 2.5 || s.t > 0.85) continue;
        pr.hitIds.add(a.id);
        w.applyHit(a, { damage: pr.damage, kind: 'projectile', source: pr, attacker: pr.owner, dirX: 0, dirY: 0, knockback: 0 });
        pr.dead = true;
        w.particles.burst(pr.x, pr.y - pr.z, { count: 5, speed: [40, 110], life: [0.1, 0.25], colors: ['#ffffff', HOT[5], HOT[4]], size: [1, 1], shape: 'spark' });
        if (fx.chance(0.4)) w.sfx('hit_metal', { vol: 0.3, pitch: 1.4 });
        break;
      }
    }
  },
  filter(e, w, hit, dmg) {
    if (!helpersOf(w, e, 'ward_anchor').length) return dmg;
    blockedFx(e, w, hit, ['#ffffff', CHAIN[2], HOT[4]]);
    return dmg * CHAIN_THROUGH;
  },
  active: (e, w) => helpersOf(w, e, 'ward_anchor').length > 0,
  draw(r, w, e, t) {
    for (const a of helpersOf(w, e, 'ward_anchor')) {
      const [ax, ay, bx, by] = chainEnds(e, a);
      const len = Math.hypot(bx - ax, by - ay);
      const n = Math.max(4, Math.floor(len / 4));
      const taut = 0.5 + 0.5 * Math.sin(t * 7 + a.id);
      // heavy links alternate face-on / edge-on; a small sag
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n;
        const sag = Math.sin(k * Math.PI) * (3 - taut * 1.5);
        const x = Math.round(ax + (bx - ax) * k);
        const y = Math.round(ay + (by - ay) * k + sag);
        r.rect(x - 2, y - 2, 4, 4, '#0c0810', 0.95);
        if (i % 2) {
          r.rect(x - 1, y - 1, 2, 2, CHAIN[2], 1);
          r.rect(x - 1, y - 1, 1, 1, '#c8c0d0', 1);
        } else r.rect(x - 1, y, 2, 1, CHAIN[1], 1);
      }
    }
  },
});

frames('wanchor', 'idle', 2, 12, 18, (p, i) => {
  // the iron spike driven into the floor
  p.poly([4, 7, 8, 7, 7, 16, 5, 16], IRON[3]);
  p.line(5, 8, 5, 15, IRON[4]);
  p.rect(3, 15, 6, 2, IRON[1]);
  p.px(2, 16, IRON[0]);
  p.px(9, 16, IRON[0]);
  // a hot rivet band
  p.rect(3, 9, 6, 2, i ? HOT[3] : HOT[2]);
  p.px(4, 9, HOT[5]);
  // the ring the chain runs through
  p.ring(6, 4, 3.4, 1.2, IRON[4]);
  p.px(4, 2, IRON[5]);
}, { fps: 3 });
frames('wanchor', 'hurt', 1, 12, 18, (p) => {
  p.poly([4, 7, 8, 7, 7, 16, 5, 16], '#ffffff');
  p.ring(6, 4, 3.4, 1.2, '#ffffff');
  p.rect(3, 15, 6, 2, IRON[3]);
});

if (!Enemies.has('ward_anchor')) defineEnemy({
  id: 'ward_anchor',
  name: '사슬 닻',
  hp: 20,
  radius: 6,
  speed: 0,
  mass: Infinity,
  contactDamage: 0,
  sprite: 'wanchor_idle',
  shadow: 9,
  deathFx: 'metal',
  bloodColor: HOT[4],
  light: { radius: 18, color: HOT[4] },
  hurtSfx: 'hit_metal',
  *script(e) {
    while (true) {
      if (!e.parent || !e.parent.alive) {
        e.dead = true;
        e.hp = 0;
        return;
      }
      e.setAnim('wanchor_idle');
      yield 0.1;
    }
  },
  onDeath(e, w) {
    w.particles.burst(e.x, e.y - 8, { count: 14, speed: [40, 130], life: [0.2, 0.5], colors: ['#ffffff', HOT[5], HOT[4], IRON[4]], size: [1, 2], shape: 'spark' });
    w.sfx('rock_break', { vol: 0.5, pitch: 1.4 });
    w.sfx('hit_metal', { vol: 0.5, pitch: 0.7 });
  },
});

// ================================================================== 쇳물 이무기: 식은 껍질
/** Damage a body hit lands with while crusted (the head takes it all). */
export const CRUST_THROUGH = 0.12;
const SLAG = ['#1a1416', '#2e2628', '#4a3e3c', '#6a5a52'];

function crust(e: Enemy, w: World, t: number): void {
  e.mem.wdCrust = 1;
  e.mem.wdCrustT = t;
  w.sfx('clock_steam', { vol: 0.5, pitch: 0.7 });
  w.sfx('rock_break', { vol: 0.35, pitch: 0.6 });
  announceWard(e, w);
}

defineBossWard('slag_imugi', {
  name: '식은 껍질',
  hint: '몸통이 식은 쇳물 껍질로 굳었습니다 · 여의주를 문 머리를 노리세요',
  color: '#ffcf4a',
  begin(e) {
    e.mem.wdCrust = 0;
    e.mem.wdCrustT = 0;
    e.mem.wdNext = 8;
  },
  phase(e, w) {
    crust(e, w, 10);
  },
  update(e, w, dt) {
    const m = e.mem;
    if (m.wdCrust) {
      m.wdCrustT -= dt;
      if (m.wdCrustT <= 0) {
        m.wdCrust = 0;
        m.wdNext = 15;
        w.sfx('fire', { vol: 0.4, pitch: 1.1 });
      }
    } else if (!m.rsHold && (m.wdNext -= dt) <= 0) crust(e, w, 8);
  },
  filter(e, w, hit, dmg) {
    const m = e.mem;
    if (!m.wdCrust) return dmg;
    if (hit.kind === 'status') return dmg * 0.5;
    if (m.viaSeg) {
      blockedFx(e, w, hit, ['#c8b8a8', SLAG[3], '#8a7a6a']);
      return dmg * CRUST_THROUGH;
    }
    // the head: the pearl's glow flares
    if (fx.chance(0.5)) w.particles.burst(e.x, e.y - e.z - 6, { count: 4, speed: [30, 90], life: [0.12, 0.3], colors: ['#ffffff', '#fff0a0', '#ffcf4a'], size: [1, 2], shape: 'spark', additive: true });
    return dmg;
  },
  active: (e) => !!e.mem.wdCrust,
  draw(r, w, e, t) {
    const m = e.mem;
    if (!m.wdCrust) return;
    const fade = m.wdCrustT < 1 && Math.floor(t * 10) % 2 ? 0.5 : 1;
    // grey slag plates over every raised body segment
    for (const s of w.entities) {
      if (!(s instanceof ImugiPart) || s.head !== e || !s.up || s.dead) continue;
      const rad = Math.max(3, s.r - 1);
      r.pixelDisc(s.x, s.y - 1, rad, SLAG[1], 0.55 * fade);
      r.rect(Math.round(s.x - rad * 0.5), Math.round(s.y - rad * 0.6), Math.max(1, Math.round(rad * 0.6)), 1, SLAG[3], 0.8 * fade);
      if ((s.idx + Math.floor(t * 2)) % 3 === 0) r.rect(Math.round(s.x + rad * 0.2), Math.round(s.y), 1, 1, '#ff6a2a', 0.8 * fade);
    }
    // the weak point: a ring of light around the head
    if (!e.hidden) {
      const pulse = 0.55 + 0.35 * Math.sin(t * 9);
      r.pixelRing(e.x, e.y - e.z - 6, e.r + 4 + Math.sin(t * 6), '#fff0a0', 1, pulse * fade);
    }
  },
});

// ================================================================== 빙결 성녀: 얼음 거울
export const MIRROR_WARN = 0.9;
export const MIRROR_TIME = 2.6;
const ICE = ['#1a3a78', '#4a86d0', '#8cc8f8', '#e8faff'];

defineBossWard('frost_saint', {
  name: '얼음 거울',
  hint: '얼음 거울이 빛나는 동안 투사체가 되돌아옵니다 · 기다리거나 근접·폭발로 공격하세요',
  color: '#c4f0ff',
  begin(e) {
    const m = e.mem;
    m.wdMirror = 0;
    m.wdMirrorT = 0;
    m.wdNext = 9;
    m.wdReflect = 6;
  },
  phase(e) {
    e.mem.wdNext = Math.min(e.mem.wdNext, 2);
  },
  update(e, w, dt) {
    const m = e.mem;
    m.wdReflect = Math.min(6, m.wdReflect + dt * 6);
    if (m.wdMirror === 0) {
      if (m.rsHold || (m.wdNext -= dt) > 0) return;
      m.wdMirror = 1;
      m.wdMirrorT = MIRROR_WARN;
      w.sfx('beam_charge', { vol: 0.45, pitch: 1.5 });
      w.sfx('freeze', { vol: 0.4, pitch: 1.3 });
      announceWard(e, w);
      return;
    }
    m.wdMirrorT -= dt;
    if (m.wdMirrorT > 0) return;
    if (m.wdMirror === 1) {
      m.wdMirror = 2;
      m.wdMirrorT = MIRROR_TIME;
      w.sfx('shield_block', { vol: 0.5, pitch: 1.3 });
    } else {
      m.wdMirror = 0;
      m.wdNext = 12 + w.rng.range(0, 3);
      w.sfx('clock_crack', { vol: 0.4, pitch: 1.4 });
    }
  },
  filter(e, w, hit, dmg) {
    const m = e.mem;
    if (m.wdMirror !== 2) return dmg;
    if (hit.kind === 'melee' || hit.kind === 'explosion' || hit.kind === 'status') return dmg;
    const src = hit.source;
    if (src instanceof Projectile && src.team === 'player') {
      src.dead = true;
      if (m.wdReflect >= 1) {
        m.wdReflect -= 1;
        const owner = src.owner;
        const a = owner ? Math.atan2(owner.y - e.y, owner.x - e.x) : src.angle + Math.PI;
        e.shoot(w, a, bullet('frost', 3, { speed: 150, damage: 1 }));
      }
    }
    if (fx.chance(0.5)) w.particles.burst(e.x, bodyY(e), { count: 4, speed: [40, 110], life: [0.12, 0.25], colors: ['#ffffff', ICE[3], ICE[2]], size: [1, 1], shape: 'spark', additive: true });
    return 0;
  },
  active: (e) => e.mem.wdMirror === 2,
  draw(r, _w, e, t) {
    const m = e.mem;
    if (!m.wdMirror) return;
    const cx = e.x;
    const cy = bodyY(e);
    const rad = Math.max(18, e.r * 1.25 + 9);
    if (m.wdMirror === 1) {
      // warning: frost creeps inward and blinks
      const k = 1 - Math.max(0, m.wdMirrorT) / MIRROR_WARN;
      r.pixelRing(cx, cy, rad + 14 * (1 - k), ICE[2], 1, 0.35 + 0.5 * k);
      return;
    }
    const blink = m.wdMirrorT < 0.5 && Math.floor(t * 12) % 2 ? 0.35 : 0.9;
    // six ice panes around her, a bright rim
    r.pixelRing(cx, cy, rad, ICE[3], 2, blink * 0.8);
    for (let i = 0; i < 6; i++) {
      const a0 = -t * 0.8 + (i * Math.PI) / 3;
      const a1 = a0 + Math.PI / 3 - 0.12;
      r.pixelLine(cx + Math.cos(a0) * rad, cy + Math.sin(a0) * rad, cx + Math.cos(a1) * rad, cy + Math.sin(a1) * rad, ICE[2], 1, blink);
      const x = Math.round(cx + Math.cos(a0) * rad);
      const y = Math.round(cy + Math.sin(a0) * rad);
      r.rect(x - 1, y - 1, 3, 3, ICE[3], blink);
      r.rect(x, y, 1, 1, '#ffffff', blink);
    }
  },
  light(w, e) {
    if (e.mem.wdMirror === 2) w.lights.add(e.x, e.y - 12, 60, '#c4f0ff', { intensity: 0.5 });
  },
});

// ================================================================== 서리 기사단장: 군기 진형
/** Aura radius around the banner, damage through inside it, banner HP share. */
export const BANNER_AURA = 72;
export const BANNER_THROUGH = 0.25;
const BANNER_HP = 0.05;
const STEEL = ['#121828', '#232e48', '#3a4c6e', '#5c7398', '#90a8c8', '#d0def0'];
const CLOTH = ['#0a1230', '#18285a', '#2a468c', '#466abc'];
const GOLDC = ['#4a300c', '#8a5c1c', '#c8983a', '#ffe08a'];

function plant(e: Enemy, w: World): void {
  // planted beside him (on the side away from the keeper), on free floor
  const t = e.target(w);
  const side = t.x >= e.x ? -1 : 1;
  let at = { x: e.x + side * (e.r + 16), y: e.y + 4 };
  if (!w.room.isFree(at.x, at.y, 8)) at = { x: e.x - side * (e.r + 16), y: e.y + 4 };
  if (!w.room.isFree(at.x, at.y, 8)) at = freeSpot(w, e, 0);
  raiseHelper(w, e, 'ward_banner', at.x, at.y, BANNER_HP);
  w.sfx('slam', { vol: 0.6, pitch: 1.1 });
  w.sfx('freeze', { vol: 0.5, pitch: 0.8 });
  announceWard(e, w);
}

/** The commander stands in his banner's aura. */
export function inBannerAura(w: World, e: Enemy): boolean {
  return helpersOf(w, e, 'ward_banner').some((b) => Math.hypot(b.x - e.x, b.y - e.y) <= BANNER_AURA);
}

defineBossWard('frost_commander', {
  name: '군기 진형',
  hint: '얼어붙은 군기 곁에서는 피해를 거의 받지 않습니다 · 깃발에서 떨어뜨리거나 깃발을 베세요',
  color: '#8cc8f8',
  begin(e) {
    e.mem.wdNext = 4;
  },
  phase(e, w) {
    if (!helpersOf(w, e, 'ward_banner').length) plant(e, w);
    e.mem.wdNext = 24;
  },
  update(e, w, dt) {
    const m = e.mem;
    if (helpersOf(w, e, 'ward_banner').length) return;
    if (!m.rsHold && (m.wdNext -= dt) <= 0) {
      plant(e, w);
      m.wdNext = 24;
    }
  },
  filter(e, w, hit, dmg) {
    if (!inBannerAura(w, e)) return dmg;
    blockedFx(e, w, hit, ['#ffffff', ICE[3], ICE[2]]);
    return dmg * BANNER_THROUGH;
  },
  active: (e, w) => inBannerAura(w, e),
  draw(r, w, e, t) {
    for (const b of helpersOf(w, e, 'ward_banner')) {
      const inside = Math.hypot(b.x - e.x, b.y - e.y) <= BANNER_AURA;
      // the aura: a ring of frost marks on the floor, turning slowly
      const n = 24;
      for (let i = 0; i < n; i++) {
        if (i % 2) continue;
        const a = t * 0.3 + (i / n) * Math.PI * 2;
        const x = Math.round(b.x + Math.cos(a) * BANNER_AURA);
        const y = Math.round(b.y + Math.sin(a) * BANNER_AURA * 0.8);
        r.rect(x - 2, y, 5, 1, '#020820', 0.6);
        r.rect(x - 1, y, 3, 1, inside ? ICE[3] : ICE[2], inside ? 0.95 : 0.6);
      }
      if (inside) {
        // cold light runs from the banner to him
        const x1 = e.x;
        const y1 = bodyY(e);
        r.pixelLine(b.x, b.y - 20, x1, y1, ICE[2], 1, 0.45 + 0.25 * Math.sin(t * 8));
        const k = (t * 1.5) % 1;
        r.rect(Math.round(b.x + (x1 - b.x) * k) - 1, Math.round(b.y - 20 + (y1 - b.y + 20) * k) - 1, 2, 2, '#ffffff', 0.9);
      }
    }
  },
});

frames('wbanner', 'idle', 3, 16, 28, (p, i) => {
  // pole of rimed steel, gold finial
  p.rect(3, 3, 2, 24, STEEL[3]);
  p.line(3, 3, 3, 26, STEEL[4]);
  p.poly([2, 3, 4, 0, 6, 3], GOLDC[2]);
  p.px(4, 1, GOLDC[3]);
  p.rect(1, 25, 6, 2, STEEL[1]);
  // the frozen banner: blue cloth, gold trim, tattered tail stiff with ice
  const sway = [0, 1, 0][i];
  p.poly([5, 4, 15, 5 + sway, 14, 15 + sway, 11, 13 + sway, 9, 17, 5, 15], CLOTH[2]);
  p.poly([5, 4, 15, 5 + sway, 15, 7 + sway, 5, 6], CLOTH[3]);
  p.line(5, 4, 15, 5 + sway, GOLDC[2]);
  // the order's emblem: a snowflake sword
  p.line(10, 7, 10, 13, GOLDC[3]);
  p.line(8, 9, 12, 9, GOLDC[3]);
  p.px(10, 6, '#ffffff');
  // ice on the hem
  p.px(9, 17, ICE[3]);
  p.px(11, 14 + sway, ICE[3]);
  p.px(14, 15 + sway, ICE[2]);
}, { fps: 3, origin: [4, 27] });
frames('wbanner', 'hurt', 1, 16, 28, (p) => {
  p.rect(3, 3, 2, 24, '#ffffff');
  p.poly([5, 4, 15, 5, 14, 15, 11, 13, 9, 17, 5, 15], '#ffffff');
}, { origin: [4, 27] });

if (!Enemies.has('ward_banner')) defineEnemy({
  id: 'ward_banner',
  name: '얼어붙은 군기',
  hp: 30,
  radius: 6,
  speed: 0,
  mass: Infinity,
  contactDamage: 0,
  sprite: 'wbanner_idle',
  shadow: 10,
  deathFx: 'ice',
  bloodColor: ICE[2],
  light: { radius: 26, color: ICE[2] },
  hurtSfx: 'hit_metal',
  *script(e) {
    while (true) {
      if (!e.parent || !e.parent.alive) {
        e.dead = true;
        e.hp = 0;
        return;
      }
      e.setAnim('wbanner_idle');
      yield 0.1;
    }
  },
  onDeath(e, w) {
    w.particles.burst(e.x, e.y - 14, { count: 18, speed: [40, 130], life: [0.25, 0.6], colors: ['#ffffff', ICE[3], ICE[2], CLOTH[3]], size: [1, 2], shape: 'spark' });
    w.sfx('clock_crack', { vol: 0.5, pitch: 0.9 });
    w.sfx('freeze', { vol: 0.4, pitch: 1.2 });
    const boss = e.parent;
    if (boss?.alive) daze(boss, w, 2);
  },
});

