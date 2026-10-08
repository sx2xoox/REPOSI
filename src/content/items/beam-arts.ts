// 광선 (beam) artifacts for the beam weapons (kind 'beam': 공허의 눈 void_gaze,
// 프리즘 지팡이 prism_staff, 뇌명 지팡이 thunder_rod):
//  - 그을린 렌즈 (smoked_lens): keeping the beam on one enemy heats it up (+damage steps)
//  - 반딧불 필라멘트 (firefly_filament): longer beams; enemies in the beam are slowed
//  - 프리즘 조각 (prism_shard): the lit enemy refracts a thin branch beam into a neighbour
//  - 과열 코일 (overheat_coil): long channels overheat (+damage); letting go vents a blast
//  - 일식 렌즈 (eclipse_lens): beam kills burst into four short eclipse rays (chaining)
//
// "Beam hit" = a direct hit of the held beam weapon: kind 'laser', no source entity,
// not noProc, dealt by the context keeper while a kind 'beam' weapon is in its hands.
// With any other weapon (or the beam weapon holstered in the second slot) these
// artifacts do nothing — never a penalty. Everything they spawn hits with noProc.

import { defineArtifact, Weapons } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { Entity, type Actor, type HitInfo } from '../../game/entity';
import { Enemy } from '../../game/enemy';
import { RingFx } from '../../game/effects';
import { visualHandPos } from '../../game/weapon-pose';
import { currentProcEffect, withProcContext } from '../../game/procs';
import { angleDiff, clamp } from '../../engine/math';
import { fx } from '../../engine/rng';
import type { Renderer } from '../../engine/renderer';
import type { World } from '../../game/world';
import { glowSprite, handPos, rayLength, segDist } from '../weapons/common';
import { O, amplify, enemiesNear, inflict, itemHit, proc, stackMul } from './lib';

// ====================================================================== tuning (exported for tests)
/** 그을린 렌즈: seconds per heat step, damage per step per copy, steps */
export const LENS_STEP_T = 0.4;
export const LENS_STEP = 0.03;
export const LENS_STEPS = 5;
/** 반딧불 필라멘트: beam range per copy, slow strength and duration */
export const FIREFLY_RANGE = 0.15;
export const FIREFLY_SLOW = 0.15;
export const FIREFLY_SLOW_T = 0.6;
/** 프리즘 조각: branch damage (x keeper damage), reach from the lit enemy, min interval, max branches */
export const PRISM_DMG = 0.35;
export const PRISM_REACH = 72;
export const PRISM_EVERY = 0.5;
export const PRISM_MAX = 3;
/** 과열 코일: channel seconds to overheat, beam bonus while hot, blast (x keeper damage at full heat), radius, cooldown */
export const HEAT_OVER = 2;
export const HEAT_BONUS = 0.15;
export const HEAT_MIN = 1;
export const HEAT_FULL = 3;
export const HEAT_BLAST = 1.5;
export const HEAT_RADIUS = 30;
export const HEAT_CD = 4;
/** 일식 렌즈: ray damage (x keeper damage), ray length, min seconds between bursts, generations, queue */
export const ECLIPSE_DMG = 0.8;
export const ECLIPSE_LEN = 44;
export const ECLIPSE_GAP = 0.4;
export const ECLIPSE_GENS = 3;
export const ECLIPSE_QUEUE = 3;
const ECLIPSE_WIND = 0.12;
const ECLIPSE_WAIT = 1.5;

// ====================================================================== shared
/** Is the context keeper holding a beam weapon? */
export function holdsBeam(w: World): boolean {
  const id = w?.player?.weaponId;
  return !!id && Weapons.get(id)?.kind === 'beam';
}

/** A direct hit of the held beam weapon (no item / kit / release / other weapon's hits). */
export function beamHit(w: World, hit: HitInfo): boolean {
  return hit.kind === 'laser' && !hit.noProc && !hit.release && !hit.source && hit.attacker === w.player && holdsBeam(w);
}

function liveEnemy(w: World, id: number | undefined): Enemy | null {
  if (id === undefined) return null;
  const e = w.entityById(id);
  return e instanceof Enemy && e.alive && !e.hidden && e.vulnerable ? e : null;
}

/** Any enemy to fight in the room? */
const anyFoe = (w: World) => w.enemies.some((e) => e.alive && !e.hidden && e.vulnerable);

/** Body center of an enemy for effects. */
const bodyY = (e: Enemy) => e.y - e.z - Math.max(3, e.r * 0.6);

// ====================================================================== 그을린 렌즈 (common, flame)
const SOOT = ['#1e1418', '#3a2c30', '#5a4646', '#7e6a62', '#b8a490'];
const BRASS = ['#4a3018', '#7a5426', '#b08440', '#e0bc6a', '#fff0b8'];

defineDrawnSprite('icon_smoked_lens', 16, 16, (p) => {
  // a burning glass held at an angle: brass rim, its thickness showing on the right
  p.ellipse(6.4, 7, 4, 6.6, BRASS[0]);
  p.ellipse(5.6, 7, 3.8, 6.4, BRASS[2]);
  // smoked glass: soot pooled low on the right, clearer toward the light
  p.ellipse(5.4, 7, 2.8, 5.4, SOOT[2]);
  p.ellipse(4.9, 6.2, 1.9, 4, SOOT[3]);
  p.ellipse(6.2, 8.6, 1.6, 3.2, SOOT[1]);
  p.px(6, 10, SOOT[0]);
  p.px(7, 9, SOOT[0]);
  p.line(3, 4, 3, 7, SOOT[4]);
  p.px(4, 3, '#fff4e0');
  // rim highlights from the top-left
  p.px(3, 1, BRASS[4]);
  p.px(2, 2, BRASS[3]);
  p.px(4, 0, BRASS[3]);
  p.px(1, 4, BRASS[3]);
  p.px(9, 12, BRASS[0]);
  // the light it gathers folds into one cone that meets at a burning point
  p.line(9, 3, 13, 12, '#fff0c0');
  p.line(9, 4, 13, 11, '#ffd890');
  p.line(9, 8, 13, 12, '#ffc060');
  p.line(8, 11, 12, 12, '#ff9a40');
  p.circle(13.4, 12.6, 2, '#c0401a');
  p.circle(13.4, 12.6, 1.3, '#ff8a2a');
  p.px(13, 12, '#ffffff');
  p.px(14, 12, '#fff4c0');
  p.px(13, 13, '#ffd070');
  // smoke curling up off the spot, and a spark
  p.px(14, 10, '#9a8c92');
  p.px(15, 9, '#867880');
  p.px(14, 8, '#a89aa0');
  p.px(14, 7, '#b8acb0');
  p.px(15, 6, '#c8bcc0');
  p.px(11, 15, '#ffd070');
}, { outline: O });

/** Seconds without a beam hit on the focused enemy before the focus cools (slow weapons get longer). */
function lensGap(w: World): number {
  return Math.max(0.5, 1.5 / Math.max(0.5, w.player.weaponStats.fireRate));
}

/** Heat steps on the focused enemy right now (0 when the focus is cold or lost). */
export function lensSteps(w: World): number {
  const v = w.vars;
  if (w.time - (v.__lensL ?? -99) > lensGap(w)) return 0;
  return Math.min(LENS_STEPS, Math.floor((w.time - (v.__lensS ?? w.time)) / LENS_STEP_T + 1e-6));
}

defineArtifact({
  id: 'smoked_lens',
  name: '그을린 렌즈',
  desc: '광선 무기: 한 적을 계속 비추면 피해 증가 (최대 +15%)',
  detail: '광선 무기의 직접 적중만. 같은 적을 끊김 없이 비추면 0.4초마다 그 적에게 주는 피해 +3% (최대 5단계 +15%). 다른 적으로 옮기거나 공격 간격의 1.5배(최소 0.5초) 넘게 놓치면 처음부터. 광선이 꿰뚫은 다른 적은 오르지 않는다. 다른 무기를 들면 효과 없음. 중복 시 단계당 수치가 그대로 더해진다.',
  quote: '그을음 너머로 모인 빛은 종이도 적도 태운다.',
  rarity: 'common',
  tags: ['flame'],
  icon: 'icon_smoked_lens',
  look: { mote: '#ffb35a', hit: '#ffd27a' },
  pools: ['treasure', 'shop'],
  modifyHit(w, t, hit, power) {
    if (!(t instanceof Enemy) || !beamHit(w, hit)) return;
    const v = w.vars;
    const now = w.time;
    const lit = now - (v.__lensL ?? -99) <= lensGap(w);
    if (v.__lensT !== t.id) {
      // the beam only passes through this one while another enemy stays in focus
      if (lit && liveEnemy(w, v.__lensT)) return;
      v.__lensT = t.id;
      v.__lensS = now;
      v.__lensN = 0;
    } else if (!lit) {
      v.__lensS = now;
      v.__lensN = 0;
    }
    v.__lensL = now;
    const n = lensSteps(w);
    if (n <= 0) return;
    amplify(hit, LENS_STEP * n * power);
    if (n !== v.__lensN) {
      v.__lensN = n;
      const y = bodyY(t);
      w.particles.burst(t.x, y, { count: 2 + n, speed: [10, 40], life: [0.2, 0.4], colors: ['#ffffff', '#ffd070', '#ff8a28'], shape: 'spark', size: [1, 2], additive: true });
      if (n === LENS_STEPS) {
        w.sfx('fire', { vol: 0.3, pitch: 1.5 });
        w.spawn(new RingFx(t.x, y, 10, 0.25, '#ffb35a', 1));
      }
      proc(w, 'smoked_lens', n < LENS_STEPS);
    }
    // the focused spot smokes once it is hot
    if (n >= 2 && fx.chance(0.15 * n)) {
      w.particles.spawn({ x: t.x + fx.range(-2, 2), y: bodyY(t) - 2, vx: fx.range(-4, 4), vy: -fx.range(12, 24), life: 0.6, colors: ['#9a8a90a0', '#6a5a6480'], size: 1.5, sizeEnd: 3, shape: 'circle' });
    }
  },
  onRoomEnter(w) {
    w.vars.__lensL = -99;
    w.vars.__lensN = 0;
  },
  draw(w, r) {
    if (!holdsBeam(w)) return;
    const n = lensSteps(w);
    if (n <= 0) return;
    const e = liveEnemy(w, w.vars.__lensT);
    if (!e) return;
    // a burning focus: four light ticks close in on the spot as the steps climb; they stay
    // outside the beam's own width (dark backing) so a bright beam does not swallow them
    const k = n / LENS_STEPS;
    const cx = e.x;
    const cy = bodyY(e);
    const R = 13 - 5 * k;
    const col = k >= 1 ? '#fff0b0' : k > 0.5 ? '#ffc060' : '#ff9030';
    const rot = w.time * (1.5 + 2 * k);
    for (let i = 0; i < 4; i++) {
      const a = rot + (i * Math.PI) / 2;
      const c = Math.cos(a);
      const s = Math.sin(a) * 0.8;
      r.line(cx + c * (R + 3), cy + s * (R + 3), cx + c * R, cy + s * R, '#2a1410', 3, 0.45 + 0.3 * k);
      r.line(cx + c * (R + 3), cy + s * (R + 3), cx + c * R, cy + s * R, col, 1, 0.65 + 0.35 * k);
    }
    r.sprite(glowSprite(5 + 7 * k, '#ff9a30'), cx, cy, { additive: true, alpha: 0.35 + 0.45 * k });
    r.rect(Math.round(cx) - 0.5, Math.round(cy) - 0.5, 1, 1, '#ffffff', 0.6 + 0.4 * k);
  },
});

// ====================================================================== 반딧불 필라멘트 (common, frost)
const GLASS = ['#16303a', '#24505c', '#4a8a98', '#9fd8e8', '#e8fbff'];
const FLY = ['#5a9a30', '#a8e050', '#e8ff9a', '#fffde0'];

defineDrawnSprite('icon_firefly_filament', 16, 16, (p) => {
  // the bulb: dark cold glass so the lit filament reads
  p.circle(8, 6, 5.4, GLASS[1]);
  p.circle(8.6, 6.6, 4.4, GLASS[0]);
  p.poly([5.2, 9.5, 10.8, 9.5, 10, 11.5, 6, 11.5], GLASS[1]);
  // glass rim light from the top-left
  for (const [x, y] of [[3, 5], [3, 4], [4, 3], [4, 2], [5, 2], [6, 1], [7, 1]]) p.px(x, y, GLASS[3]);
  p.px(5, 3, GLASS[4]);
  p.px(4, 4, GLASS[2]);
  // support wires and the glowing coil between them
  p.line(6, 11, 6, 7, '#7a8a90');
  p.line(10, 11, 10, 7, '#7a8a90');
  p.circle(8, 6.5, 3.2, '#2e5a40');
  for (const [x, y] of [[6, 6], [7, 5], [8, 6], [9, 5], [10, 6]]) p.px(x, y, FLY[2]);
  for (const [x, y] of [[7, 6], [9, 6]]) p.px(x, y, FLY[1]);
  p.px(8, 5, FLY[3]);
  // the brass screw cap with its threads
  p.rect(5, 12, 6, 3, BRASS[2]);
  p.line(5, 13, 10, 13, BRASS[1]);
  p.line(5, 12, 10, 12, BRASS[3]);
  p.px(5, 14, BRASS[1]);
  p.rect(7, 15, 2, 1, '#3a3038');
  // fireflies drifting off the light
  p.px(13, 3, FLY[3]);
  p.px(14, 3, FLY[1]);
  p.px(13, 2, '#c8e8ff');
  p.px(14, 1, '#c8e8ff');
  p.px(1, 10, FLY[2]);
  p.px(1, 11, FLY[0]);
  p.px(0, 9, '#c8e8ff');
  p.px(14, 9, FLY[2]);
}, { outline: O });

const ffKey = (w: World) => `__ffLit${w.player.slot}`;

defineArtifact({
  id: 'firefly_filament',
  name: '반딧불 필라멘트',
  desc: '광선 무기: 사거리 +15%. 광선에 닿은 적 15% 둔화',
  detail: '광선 무기를 들고 있을 때만 사거리 +15%. 광선 무기의 직접 적중을 받은 적은 0.6초간 15% 둔화(보스 포함, 빛에 닿아 있는 동안 유지). 더 강한 둔화가 걸린 적은 그 둔화가 끝난 뒤에 이어 건다(강한 둔화를 늘리지 않는다). 다른 무기를 들면 효과 없음. 같은 적 둔화 재부여 0.5초. 중복 시 사거리만 더해진다.',
  quote: '불빛 하나에 반딧불이 줄지어 모여든다.',
  rarity: 'common',
  tags: ['frost'],
  icon: 'icon_firefly_filament',
  look: { mote: '#d8ff9a', hit: '#c8f0ff' },
  pools: ['treasure', 'shop'],
  stats(m, power, w) {
    if (holdsBeam(w)) m.mulStat('range', 1 + FIREFLY_RANGE * power);
  },
  onHit(w, t, hit) {
    if (t instanceof Enemy && beamHit(w, hit)) t.mem[ffKey(w)] = w.time;
  },
  onUpdate(w) {
    if (!holdsBeam(w) || (w.vars.__ffNext ?? -99) > w.time) return;
    const key = ffKey(w);
    let n = 0;
    for (const e of w.enemies) {
      if (!e.alive || w.time - (e.mem[key] ?? -99) > 0.25) continue;
      // a stronger slow runs its own course: refreshing it would keep it alive for good
      if ((e.statuses.get('slow')?.power ?? 0) > FIREFLY_SLOW + 1e-9) continue;
      if (inflict(w, e, { kind: 'slow', duration: FIREFLY_SLOW_T, power: FIREFLY_SLOW }, false)) n++;
    }
    if (!n) return;
    w.vars.__ffNext = w.time + 0.2;
    proc(w, 'firefly_filament', true);
  },
  draw(w, r) {
    if (!holdsBeam(w)) return;
    const key = ffKey(w);
    // fireflies circle the enemies the beam is touching
    for (const e of w.enemies) {
      const since = w.time - (e.mem[key] ?? -99);
      if (!e.alive || e.hidden || since > FIREFLY_SLOW_T) continue;
      const a0 = w.time * 3.2 + e.id * 1.7;
      const fade = clamp(1 - since / FIREFLY_SLOW_T, 0, 1);
      for (let i = 0; i < 2; i++) {
        const a = a0 + i * Math.PI;
        const x = e.x + Math.cos(a) * (e.r + 3);
        const y = bodyY(e) + Math.sin(a) * (e.r + 1) * 0.6 + Math.sin(w.time * 7 + i) * 1.2;
        const blink = 0.6 + 0.4 * Math.sin(w.time * 11 + i * 2 + e.id);
        const fx0 = Math.round(x);
        const fy0 = Math.round(y);
        r.sprite(glowSprite(9, '#c8ff70'), fx0, fy0, { additive: true, alpha: 0.75 * fade * blink });
        // a tiny firefly: dark body, glowing tail, wings catching the light
        r.rect(fx0 - 1, fy0 - 1, 1, 1, '#2a3a20', fade);
        r.rect(fx0, fy0, 2, 1, '#f4ffc8', fade * (0.6 + 0.4 * blink));
        r.rect(fx0 - 1, fy0 - 2, 1, 1, '#d8f0ff', fade * 0.7);
      }
    }
  },
});

// ====================================================================== 프리즘 조각 (rare, storm)
const SPECTRUM = ['#ff5a6a', '#ffb040', '#ffe860', '#6ae08a', '#5ab0ff', '#a070ff'];

defineDrawnSprite('icon_prism_shard', 16, 16, (p) => {
  // white light enters from the left ...
  p.line(0, 8, 4, 8, '#ffffff');
  p.line(0, 9, 3, 9, '#b8c8f0');
  // ... a jagged shard of a broken prism splits it ...
  p.poly([2, 13, 6.5, 1, 12, 9.5, 9.5, 10.5, 10.5, 13.5, 7, 12.5, 4.5, 14.5], '#a8c8ec');
  p.poly([2, 13, 6.5, 1, 7, 12.8, 4.5, 14.5], '#e2f0ff');
  p.poly([7, 12.8, 9.5, 10.5, 12, 9.5, 8.8, 6], '#86a8d4');
  p.line(6, 2, 3, 11, '#ffffff');
  p.line(7, 2, 10, 7, '#cfe2ff');
  p.line(5, 13, 3, 13, '#7a9ccc');
  p.px(8, 12, '#5a7cb0');
  p.px(10, 12, '#5a7cb0');
  p.px(6, 1, '#ffffff');
  p.px(5, 6, '#ffffff');
  // ... into a fan of colours on the right
  p.line(10, 8, 15, 3, SPECTRUM[0]);
  p.line(10, 8, 15, 5, SPECTRUM[1]);
  p.line(11, 9, 15, 7, SPECTRUM[2]);
  p.line(11, 9, 15, 9, SPECTRUM[3]);
  p.line(12, 10, 15, 11, SPECTRUM[4]);
  p.line(12, 11, 15, 13, SPECTRUM[5]);
  p.px(9, 8, '#ffffff');
  // a chip that broke off
  p.poly([12.5, 13.5, 14.5, 14, 13, 15.5], '#a8c8ec');
  p.px(13, 14, '#e2f0ff');
}, { outline: O });

defineDrawnSprite('fx_prism_glint', 7, 7, (p) => {
  p.line(3, 0, 3, 6, '#c8e8ff');
  p.line(0, 3, 6, 3, '#c8e8ff');
  p.rect(2, 2, 3, 3, '#e8f6ff');
  p.px(3, 3, '#ffffff');
});

/** Thin refracted branch beam: a white core fringed with spectrum colours (cosmetic). */
class PrismRayFx extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  constructor(x: number, y: number, readonly x2: number, readonly y2: number, readonly dur = 0.3) {
    super();
    this.x = x;
    this.y = y;
    this.layer = 2;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.age >= this.dur) this.dead = true;
  }

  override draw(r: Renderer, w: World): void {
    const u = this.age / this.dur;
    const a = u < 0.45 ? 1 : 1 - (u - 0.45) / 0.55;
    const dx = this.x2 - this.x;
    const dy = this.y2 - this.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    // dispersion: the colours spread apart toward the far end, a white core between them
    const spread = 1.5 + u;
    const k = Math.floor(w.time * 20) % 2;
    r.pixelLine(this.x + nx, this.y + ny, this.x2 + nx * spread, this.y2 + ny * spread, SPECTRUM[k], 1, 0.9 * a);
    r.pixelLine(this.x - nx, this.y - ny, this.x2 - nx * spread, this.y2 - ny * spread, SPECTRUM[4 + k], 1, 0.9 * a);
    r.pixelLine(this.x, this.y, this.x2, this.y2, '#ffffff', 1, a);
    r.sprite(glowSprite(9, '#c8e8ff'), this.x, this.y, { additive: true, alpha: 0.8 * a });
    r.sprite('fx_prism_glint', this.x, this.y, { alpha: a, rot: this.age * 6 });
    r.sprite(glowSprite(10, SPECTRUM[2 + k]), this.x2, this.y2, { additive: true, alpha: 0.8 * a });
  }

  override light(w: World): void {
    const t = 1 - this.age / this.dur;
    w.lights.add(this.x2, this.y2, 22 * t, '#c8e8ff', { intensity: 0.6 });
    w.lights.add(this.x, this.y, 16 * t, '#e8f6ff', { intensity: 0.5 });
  }
}

defineArtifact({
  id: 'prism_shard',
  name: '프리즘 조각',
  desc: '광선 무기: 비추는 적에게서 갈래 광선이 옆 적으로 꺾인다',
  detail: '광선 무기로 적을 비추는 동안 0.5초마다(공격 간격보다 빠르지 않게) 그 적에서 72px 안의 가장 가까운 다른 적 1명에게 갈래 광선(공격력의 35%). 혼자 남은 적에게는 꺾이지 않는다. 갈래 광선은 다른 유물을 발동시키지 않는다. 중복 시 갈래가 1줄씩 늘어난다 (최대 3줄, 서로 다른 적).',
  quote: '깨진 조각도 빛을 나누는 법은 잊지 않았다.',
  rarity: 'rare',
  tags: ['storm'],
  icon: 'icon_prism_shard',
  look: { mote: '#bfe6ff', hit: '#e8d0ff' },
  pools: ['treasure', 'shop', 'secret'],
  onHit(w, t, hit) {
    if (!(t instanceof Enemy) || !beamHit(w, hit)) return;
    w.vars.__prismT = t.id;
    w.vars.__prismAt = w.time;
  },
  onUpdate(w, _dt, power) {
    const v = w.vars;
    // "lit" = hit within about one attack of the beam weapon (instant beams flash once per attack)
    const lit = Math.max(0.25, 1.2 / Math.max(0.5, w.player.weaponStats.fireRate));
    if (!holdsBeam(w) || w.time - (v.__prismAt ?? -99) > lit || (v.__prismNext ?? -99) > w.time) return;
    const src = liveEnemy(w, v.__prismT);
    if (!src) return;
    const sx = src.x;
    const sy = bodyY(src);
    const skip = new Set<number>([src.id]);
    const targets: Enemy[] = [];
    for (let i = 0; i < Math.min(PRISM_MAX, power); i++) {
      const e = w.nearestEnemy(src.x, src.y, PRISM_REACH, skip);
      if (!e) break;
      skip.add(e.id);
      targets.push(e);
    }
    if (!targets.length) return;
    const p = w.player;
    v.__prismNext = w.time + Math.max(PRISM_EVERY, 1 / Math.max(0.5, p.stats.fireRate));
    let hits = 0;
    for (const e of targets) {
      const ey = bodyY(e);
      if (!itemHit(w, e, p.stats.damage * PRISM_DMG, { from: { x: sx, y: sy }, kind: 'laser', knockback: 25, procs: ['prism_shard'] })) continue;
      hits++;
      w.spawn(new PrismRayFx(sx, sy, e.x, ey));
      w.particles.burst(e.x, ey, { count: 4, speed: [30, 80], life: [0.1, 0.22], colors: ['#ffffff', ...SPECTRUM.slice(2, 5)], shape: 'spark', size: [1, 2], additive: true });
    }
    if (!hits) return;
    w.sfx('laser', { vol: 0.22, pitch: fx.range(1.8, 2.1) });
    proc(w, 'prism_shard');
  },
});

// ====================================================================== 과열 코일 (epic, flame)
const COPPER = ['#3a1a10', '#6a3018', '#a4522a', '#d8844a', '#f4b880'];
const HOT = ['#c02818', '#ff5a20', '#ffa040', '#ffe080', '#fffbe0'];

defineDrawnSprite('icon_overheat_coil', 16, 16, (p) => {
  // the base block with two terminal posts
  p.rect(2, 13, 12, 3, '#3a3440');
  p.line(2, 13, 13, 13, '#5a5468');
  p.px(2, 13, '#8a84a0');
  p.px(3, 15, '#2a2430');
  // a helical coil, 3 1/4 turns: the far strokes first, then the near ones over them;
  // copper at the foot, glowing red, orange and white-hot toward the top
  const T = 3.25 * Math.PI * 2;
  const heat = (h: number, near: boolean) => {
    const c = h < 0.32 ? COPPER : h < 0.58 ? [COPPER[1], HOT[0], HOT[1], HOT[2], HOT[3]] : h < 0.8 ? [HOT[0], HOT[1], HOT[2], HOT[3], HOT[4]] : [HOT[1], HOT[2], HOT[3], HOT[4], '#ffffff'];
    return near ? c : [c[0], c[0], c[1], c[2], c[3]];
  };
  for (const near of [false, true]) {
    for (let i = 0; i <= 600; i++) {
      const t = (i / 600) * T;
      if (Math.cos(t) > 0 !== near) continue;
      const h = t / T;
      const x = 7.5 + Math.sin(t) * 4.6;
      const y = 11.6 - h * 9.2 + Math.cos(t) * 1.5;
      const c = heat(h, near);
      // lit from the top-left: the left side of each near stroke catches the light
      p.px(x, y, near ? (Math.sin(t) < -0.2 ? c[4] : c[3]) : c[1]);
      if (near) p.px(x, y + 1, c[1]);
    }
  }
  // heat shimmer and sparks above the white-hot end
  p.px(7, 0, '#fffbe0');
  p.px(10, 1, HOT[3]);
  p.px(4, 1, HOT[2]);
  p.px(13, 2, HOT[1]);
  p.px(1, 3, HOT[1]);
}, { outline: O });

/** Where the vented heat lands: the enemy the beam is burning, else the beam's end along the aim. */
function heatSpot(w: World): { x: number; y: number } {
  const v = w.vars;
  const p = w.player;
  if (w.time - (v.__heatLitAt ?? -99) <= 0.5) {
    const e = liveEnemy(w, v.__heatLit);
    if (e) return { x: e.x, y: e.y };
  }
  const m = p.weapon.mem;
  if (m.on && m.len && m.beamA !== undefined) {
    const a = Number(m.beamA);
    const o = handPos(p, a, 9);
    return { x: o.x + Math.cos(a) * Number(m.len), y: o.y + Math.sin(a) * Number(m.len) + 5 };
  }
  const a = p.aim;
  const o = handPos(p, a, 12);
  const reach = rayLength(w, o.x, o.y, a, p.weaponStats.range * 0.75, p.flags.has('spectral'));
  const c = w.mouseWorld();
  const dc = Math.hypot(c.x - o.x, c.y - o.y);
  const along = dc > 8 && Math.abs(angleDiff(a, Math.atan2(c.y - o.y, c.x - o.x))) < 0.3;
  const len = along ? Math.min(reach, dc) : reach * 0.6;
  return { x: o.x + Math.cos(a) * len, y: o.y + Math.sin(a) * len + 5 };
}

/** Heat 0..1 toward the biggest blast. */
export function heatFrac(w: World): number {
  return clamp((w.vars.__heat ?? 0) / HEAT_FULL, 0, 1);
}

/** Vented blast: visible fireball + damage to every enemy in the radius (cosmetic parts use fx). */
function ventBlast(w: World, x: number, y: number, heat: number, power: number): number {
  const k = clamp(heat / HEAT_FULL, 0, 1);
  const R = HEAT_RADIUS * (0.7 + 0.3 * k);
  const dmg = w.player.stats.damage * HEAT_BLAST * k * stackMul(power);
  let n = 0;
  for (const e of enemiesNear(w, x, y, R)) if (itemHit(w, e, dmg, { from: { x, y }, knockback: 120, kind: 'explosion', procs: ['overheat_coil'] })) n++;
  w.spawn(new HeatBlastFx(x, y, R, k));
  w.sfx('explosion', { vol: 0.35 + 0.25 * k, pitch: 1.35 - 0.3 * k });
  w.sfx('fire', { vol: 0.4, pitch: 0.8 });
  w.shake(0.12 + 0.18 * k);
  w.lights.glow(x, y, R * 2.4, '#ff8a30', 0.8);
  w.decal(x, y, '#2a1410', R * 0.45, 0.5);
  return n;
}

/** Fireball of a vented blast (cosmetic). */
class HeatBlastFx extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  constructor(x: number, y: number, readonly R: number, readonly k: number) {
    super();
    this.x = x;
    this.y = y;
    this.layer = 2;
    this.tileCollide = false;
  }

  override update(w: World, dt: number): void {
    if (this.age === 0) {
      w.particles.burst(this.x, this.y - 3, { count: 18 + Math.round(this.k * 14), speed: [50, 160], life: [0.2, 0.5], colors: ['#ffffff', ...HOT.slice(1).reverse()], size: [1, 3], additive: true, light: 6, lightColor: '#ff9040' });
      w.particles.burst(this.x, this.y - 2, { count: 8, speed: [10, 40], life: [0.5, 0.9], colors: ['#6a5a5a', '#3a3030'], size: [2, 3], sizeEnd: 5, drag: 3, vz: [10, 30] });
    }
    this.age += dt;
    if (this.age >= 0.4) this.dead = true;
  }

  override draw(r: Renderer): void {
    const t = this.age / 0.4;
    const f = 1 - t;
    const y = this.y - 2;
    const R = this.R * (0.45 + 0.55 * Math.min(1, t * 3));
    // white flash, then a fireball that swells and burns out inside a hot shock ring
    if (t < 0.25) r.sprite(glowSprite(Math.min(48, this.R * 2.4), '#fff0b0'), this.x, y, { additive: true, alpha: 1 - t * 4 });
    r.sprite(glowSprite(Math.min(48, R * 2), '#ff7a2a'), this.x, y, { additive: true, alpha: 0.9 * f });
    r.pixelDisc(this.x, y, R * 0.5 * f, '#ffd070', 0.9 * f);
    r.pixelDisc(this.x, y, R * 0.25 * f, '#fffbe0', f);
    r.pixelRing(this.x, y, R, '#ffe080', Math.max(1, Math.round(3 * f)), f);
    if (t > 0.2) r.pixelRing(this.x, y, R * 0.75, '#ff6a20', 1, 0.7 * f);
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y, this.R * 2 * (1 - this.age / 0.4), '#ff9040', { intensity: 0.9 });
  }
}

defineArtifact({
  id: 'overheat_coil',
  name: '과열 코일',
  desc: '광선 무기: 2초 넘게 쏘면 과열(+15%), 손을 떼면 열 폭발',
  detail: '광선 무기로 계속 쏘면 발밑 게이지에 열이 쌓인다. 2초부터 과열: 광선 피해 +15%. 1초 넘게 쏘다 멈추면 쌓인 열이 비추던 적(없으면 광선 끝)에서 터진다: 공격력의 50%(1초)~150%(3초), 반경 24~30px. 폭발 재사용 4초(그동안 떼면 열만 식는다). 무기를 바꾸거나 방을 옮기면 열이 식는다. 폭발은 다른 유물을 발동시키지 않는다. 다른 무기를 들면 효과 없음. 중복 시 과열 피해·폭발 x1.6, x2 ...',
  quote: '식기 전에 놓아라. 놓기 전에 식지 마라.',
  rarity: 'epic',
  tags: ['flame'],
  icon: 'icon_overheat_coil',
  look: { aura: '#ff6a2a', mote: '#ffb040' },
  pools: ['treasure', 'boss', 'challenge'],
  modifyHit(w, t, hit, power) {
    if (!(t instanceof Enemy) || !beamHit(w, hit)) return;
    w.vars.__heatLit = t.id;
    w.vars.__heatLitAt = w.time;
    if ((w.vars.__heat ?? 0) >= HEAT_OVER) {
      amplify(hit, HEAT_BONUS * stackMul(power));
      if (fx.chance(0.35)) w.particles.burst(t.x, bodyY(t), { count: 2, speed: [20, 60], life: [0.15, 0.3], colors: ['#ffffff', HOT[3], HOT[1]], shape: 'spark', size: [1, 2], additive: true });
    }
  },
  onUpdate(w, dt, power) {
    const v = w.vars;
    const p = w.player;
    if (!holdsBeam(w) || !p.alive || v.__heatSwap !== p.swapAt) {
      // another weapon (a swap or a pickup, also from one beam weapon to another): the coil cools
      v.__heatSwap = p.swapAt;
      v.__heat = 0;
      v.__heatHot = 0;
      return;
    }
    if (p.firing) {
      v.__heat = Math.min(HEAT_FULL + 1, (v.__heat ?? 0) + dt);
      const s = heatSpot(w);
      v.__heatX = s.x;
      v.__heatY = s.y;
      const heat = v.__heat;
      if (heat >= HEAT_OVER && !v.__heatHot) {
        v.__heatHot = 1;
        w.sfx('fire', { vol: 0.45, pitch: 1.2 });
        w.sfx('charge_ready', { vol: 0.3, pitch: 0.7 });
        w.floatText(p.x, p.y - 22, '과열', '#ff8a3a');
        proc(w, 'overheat_coil');
      }
      // the coil glows and spits sparks as it heats
      const h = handPos(p, p.aim, 8);
      if (heat >= HEAT_MIN && fx.chance(dt * (6 + 14 * heatFrac(w)))) {
        w.particles.spawn({ x: h.x + fx.range(-2, 2), y: h.y + fx.range(-2, 2), vx: fx.range(-30, 30), vy: -fx.range(20, 60), gravity: 140, life: fx.range(0.2, 0.4), colors: ['#ffffff', HOT[3], HOT[1]], size: 1, shape: 'pixel', additive: true });
      }
      if (heat >= HEAT_OVER && fx.chance(dt * 5)) {
        w.particles.spawn({ x: h.x, y: h.y - 2, vx: fx.range(-5, 5), vy: -fx.range(10, 20), life: 0.7, colors: ['#8a7a7aa0', '#4a3a3a80'], size: 2, sizeEnd: 4, shape: 'circle' });
      }
      return;
    }
    const heat = v.__heat ?? 0;
    if (heat <= 0) return;
    v.__heat = 0;
    v.__heatHot = 0;
    const x = v.__heatX ?? p.x;
    const y = v.__heatY ?? p.y;
    if (heat < HEAT_MIN || (v.__heatNext ?? -99) > w.time || !anyFoe(w)) {
      // too short, still cooling down or nothing to burn: the heat just hisses off the coil
      const h = handPos(p, p.aim, 8);
      w.particles.burst(h.x, h.y, { count: 4, speed: [10, 30], life: [0.3, 0.6], colors: ['#c8b8b8a0', '#8a7a7a80'], size: [1, 2], sizeEnd: 3, vz: [5, 15] });
      return;
    }
    v.__heatNext = w.time + HEAT_CD;
    ventBlast(w, x, y, heat, power);
    proc(w, 'overheat_coil');
  },
  onRoomEnter(w) {
    w.vars.__heat = 0;
    w.vars.__heatHot = 0;
  },
  draw(w, r) {
    const p = w.player;
    const heat = w.vars.__heat ?? 0;
    if (heat <= 0 || !p.alive || !holdsBeam(w)) return;
    const k = heatFrac(w);
    const hot = heat >= HEAT_OVER;
    // the heat gauge under the feet: fills over 3 s, the notch marks overheating (2 s)
    if (heat >= 0.15) {
      const W = 15;
      const x0 = Math.round(p.x - W / 2);
      const y0 = Math.round(p.y + 9);
      const fill = Math.round(k * W);
      const flick = hot ? 0.75 + 0.25 * Math.sin(w.time * 40) : 1;
      r.rect(x0 - 1, y0 - 1, W + 2, 4, '#140c1c', 0.85);
      for (let i = 0; i < W; i++) {
        const u = i / W;
        const col = i >= fill ? '#3a1a14' : u >= 0.8 ? HOT[4] : u >= 0.6 ? HOT[3] : u >= 0.4 ? HOT[2] : u >= 0.2 ? HOT[1] : HOT[0];
        r.rect(x0 + i, y0, 1, 2, col, i >= fill ? 0.9 : flick);
      }
      const notch = x0 + Math.round((HEAT_OVER / HEAT_FULL) * W);
      r.rect(notch, y0 - 2, 1, 2, hot ? '#ffffff' : '#a08070', 1);
      if (hot) {
        const h = visualHandPos(p, p.aim, 8);
        r.sprite(glowSprite(10 + 3 * Math.sin(w.time * 20), '#ff6a20'), h.x, h.y, { additive: true, alpha: 0.6 });
      }
    }
    // where the heat will burst, sized like the blast it will be
    if (heat >= HEAT_MIN && p.firing && anyFoe(w)) {
      const x = w.vars.__heatX ?? p.x;
      const y = w.vars.__heatY ?? p.y;
      const R = HEAT_RADIUS * (0.7 + 0.3 * k);
      const pulse = 0.5 + 0.5 * Math.sin(w.time * (hot ? 16 : 8));
      const ready = (w.vars.__heatNext ?? -99) <= w.time;
      const col = ready ? (hot ? '#ffb040' : '#ff7a2a') : '#7a5a50';
      const n = 14;
      for (let i = 0; i < n; i += 2) {
        const a0 = (i / n) * Math.PI * 2 + w.time * 1.5;
        const a1 = a0 + (Math.PI * 2) / n;
        r.pixelLine(x + Math.cos(a0) * R, y + Math.sin(a0) * R * 0.6, x + Math.cos(a1) * R, y + Math.sin(a1) * R * 0.6, col, 1, (0.5 + 0.45 * pulse) * (0.55 + 0.45 * k));
      }
      if (ready) r.sprite(glowSprite(6 + 10 * k, '#ff7a2a'), x, y - 2, { additive: true, alpha: 0.25 + 0.35 * k * pulse });
    }
  },
});

// ====================================================================== 일식 렌즈 (legendary, shadow)
const UMBRA = ['#120a1c', '#2a1840', '#4a2c70', '#7a58b0', '#b89ae0'];
const CORONA = ['#a07020', '#e0b048', '#ffe08a', '#fff6d0', '#ffffff'];

defineDrawnSprite('icon_eclipse_lens', 16, 16, (p) => {
  // four tapered rays out of the eclipse, on the diagonals
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    p.line(7.5 + sx * 4.5, 7.5 + sy * 4.5, 7.5 + sx * 7.5, 7.5 + sy * 7.5, CORONA[2]);
    p.line(7.5 + sx * 4.5 + (sx < 0 ? 1 : 0), 7.5 + sy * 4.5, 7.5 + sx * 6 + (sx < 0 ? 1 : 0), 7.5 + sy * 6, CORONA[1]);
  }
  p.px(0, 0, '#ffffff');
  // the violet lens: a thin dark rim, glass catching the light at the top-left
  p.circle(7.5, 7.5, 6.6, UMBRA[1]);
  p.ring(7.5, 7.5, 6.6, 1, UMBRA[2]);
  for (const [x, y] of [[3, 2], [2, 3], [4, 1], [1, 4]]) p.px(x, y, UMBRA[4]);
  // the corona: a wide gold halo with a white-hot inner edge
  p.circle(7.5, 7.5, 5.4, CORONA[0]);
  p.circle(7.5, 7.5, 4.8, CORONA[1]);
  p.circle(7.5, 7.5, 4.1, CORONA[3]);
  // the moon covering the sun, faint rim light on its far side
  p.circle(7.9, 7.9, 3.3, UMBRA[0]);
  p.px(10, 9, UMBRA[2]);
  p.px(9, 10, UMBRA[2]);
  p.px(10, 8, UMBRA[1]);
  // the diamond ring: one bead of sun with a small cross flare
  p.px(5, 5, '#ffffff');
  p.px(4, 5, '#ffffff');
  p.px(5, 4, '#ffffff');
  p.px(3, 5, CORONA[3]);
  p.px(5, 3, CORONA[3]);
  p.px(6, 5, CORONA[3]);
  p.px(5, 6, CORONA[3]);
}, { outline: O });

/** A kill's eclipse: forms over the body, then fires four short rays (gameplay; chains on kills). */
class EclipseBurst extends Entity {
  procEffect: string | undefined;
  fired = -1;
  readonly ends: number[] = [];
  readonly dmg: number;
  readonly spectral: boolean;
  constructor(w: World, x: number, y: number, readonly gen: number, readonly angle: number) {
    super();
    this.x = x;
    this.y = y;
    this.layer = 2;
    this.tileCollide = false;
    this.procEffect = currentProcEffect(w);
    this.dmg = w.player.stats.damage * ECLIPSE_DMG;
    this.spectral = w.player.flags.has('spectral');
  }

  override update(w: World, dt: number): void {
    if (this.procEffect) return withProcContext(w, this.procEffect, () => this.tick(w, dt), true);
    this.tick(w, dt);
  }

  private tick(w: World, dt: number): void {
    this.age += dt;
    if (this.fired >= 0) {
      if (this.age - this.fired >= 0.3) this.dead = true;
      return;
    }
    if (this.age < ECLIPSE_WIND) return;
    const v = w.vars;
    if (this.age > ECLIPSE_WAIT) {
      // waited too long behind other bursts: the eclipse passes
      v.__eclipseQ = Math.max(0, (v.__eclipseQ ?? 0) - 1);
      this.dead = true;
      return;
    }
    if ((v.__eclipseNext ?? -99) > w.time + 1e-9) return;
    this.fire(w);
  }

  private fire(w: World): void {
    const v = w.vars;
    this.fired = this.age;
    v.__eclipseQ = Math.max(0, (v.__eclipseQ ?? 0) - 1);
    v.__eclipseNext = w.time + Math.max(ECLIPSE_GAP, 1 / Math.max(0.5, w.player.stats.fireRate));
    const hit = new Set<number>();
    const kills: Enemy[] = [];
    const cy = this.y - 4;
    for (let k = 0; k < 4; k++) {
      const a = this.angle + (k * Math.PI) / 2;
      const len = rayLength(w, this.x, cy, a, ECLIPSE_LEN, this.spectral);
      const ex = this.x + Math.cos(a) * len;
      const ey = cy + Math.sin(a) * len;
      this.ends.push(ex, ey);
      for (const e of w.enemies) {
        if (!e.alive || e.hidden || !e.vulnerable || hit.has(e.id) || e.z > 20) continue;
        if (segDist(e.x, e.y - e.z * 0.3 - 3, this.x, cy, ex, ey).d > e.r + 3) continue;
        hit.add(e.id);
        if (!itemHit(w, e, this.dmg, { from: { x: this.x, y: cy }, kind: 'laser', knockback: 50, procs: ['eclipse_lens'] })) continue;
        w.particles.burst(e.x, bodyY(e), { count: 4, speed: [30, 90], life: [0.12, 0.25], colors: ['#ffffff', CORONA[2], UMBRA[3]], shape: 'spark', size: [1, 2], additive: true });
        if (!e.alive) kills.push(e);
      }
    }
    w.particles.burst(this.x, cy, { count: 10, speed: [40, 120], life: [0.15, 0.35], colors: ['#ffffff', CORONA[3], CORONA[2], UMBRA[3]], shape: 'spark', size: [1, 2], additive: true, light: 5, lightColor: '#ffe08a' });
    w.sfx('laser', { vol: 0.3, pitch: 0.75 + this.gen * 0.12 });
    w.sfx('orb', { vol: 0.25, pitch: 0.6 + this.gen * 0.1 });
    if (this.gen === 0) w.shake(0.06);
    proc(w, 'eclipse_lens');
    if (this.gen + 1 < ECLIPSE_GENS) for (const e of kills) queueEclipse(w, e.x, e.y, this.gen + 1, this.angle + Math.PI / 4);
  }

  override draw(r: Renderer): void {
    const cy = this.y - 4;
    if (this.fired < 0) {
      // forming: the moon slides over a flaring corona; faint guides show where the rays go
      const k = clamp(this.age / ECLIPSE_WIND, 0, 1);
      const R = 2 + 3 * k;
      r.sprite(glowSprite(10 + 8 * k, '#ffe08a'), this.x, cy, { additive: true, alpha: 0.5 + 0.3 * k });
      r.pixelRing(this.x, cy, R + 1, CORONA[2], 1, 0.9);
      r.pixelDisc(this.x, cy, R, UMBRA[0], 0.95);
      for (let i = 0; i < 4; i++) {
        const a = this.angle + (i * Math.PI) / 2;
        const g = R + 3 + 4 * k;
        r.line(this.x + Math.cos(a) * (R + 2), cy + Math.sin(a) * (R + 2), this.x + Math.cos(a) * g, cy + Math.sin(a) * g, CORONA[3], 1, 0.5 * k);
      }
      return;
    }
    const t = clamp((this.age - this.fired) / 0.3, 0, 1);
    const f = 1 - t;
    for (let i = 0; i + 1 < this.ends.length; i += 2) {
      const ex = this.ends[i];
      const ey = this.ends[i + 1];
      // pale-gold light with a violet shadow core: light around a hole in the sun
      r.line(this.x, cy, ex, ey, CORONA[2], 1 + 3 * f, 0.55 * f);
      r.line(this.x, cy, ex, ey, UMBRA[3], 1 + 1.5 * f, 0.9 * f);
      r.line(this.x, cy, ex, ey, '#ffffff', 1, f);
      r.sprite(glowSprite(7, CORONA[2]), ex, ey, { additive: true, alpha: 0.8 * f });
    }
    r.pixelRing(this.x, cy, 6 + 6 * t, CORONA[3], Math.max(1, 2 * f), f);
    r.pixelDisc(this.x, cy, 4 * f + 1, UMBRA[0], f);
  }

  override light(w: World): void {
    const f = this.fired < 0 ? clamp(this.age / ECLIPSE_WIND, 0, 1) * 0.6 : 1 - clamp((this.age - this.fired) / 0.3, 0, 1);
    w.lights.add(this.x, this.y - 4, 40 * f, '#ffe08a', { intensity: 0.8 });
  }
}

/** Queue an eclipse burst at (x, y) for the context keeper (at most ECLIPSE_QUEUE waiting). */
function queueEclipse(w: World, x: number, y: number, gen: number, angle: number): boolean {
  const v = w.vars;
  if ((v.__eclipseQ ?? 0) >= ECLIPSE_QUEUE) return false;
  v.__eclipseQ = (v.__eclipseQ ?? 0) + 1;
  w.spawn(new EclipseBurst(w, x, y, gen, angle));
  return true;
}

defineArtifact({
  id: 'eclipse_lens',
  name: '일식 렌즈',
  desc: '광선 무기: 광선으로 처치하면 그 자리에서 광선 4줄이 뻗는다',
  detail: '광선 무기의 직접 적중으로 적을 처치하면 0.12초 뒤 그 자리에서 십자로 짧은 광선 4줄(44px, 줄마다 공격력의 80%)이 뻗는다. 이 광선으로 처치한 적에게서도 45° 돌아간 광선이 이어진다 (처음 것 포함 3번까지). 발동은 0.4초에 한 번씩(공격 간격보다 빠르지 않게), 차례를 기다리는 일식은 3개까지(1.5초 넘게 기다리면 사라진다). 벽에 막힌다. 다른 유물을 발동시키지 않는다. 다른 무기를 들면 효과 없음.',
  quote: '해가 가려지는 순간, 가장자리만이 가장 밝게 빛난다.',
  rarity: 'legendary',
  tags: ['shadow'],
  icon: 'icon_eclipse_lens',
  look: { aura: '#7a58b0', mote: '#ffe08a' },
  pools: ['treasure', 'boss', 'secret'],
  unique: true,
  onHit(w, t: Actor, hit) {
    if (!(t instanceof Enemy) || t.hp > 0 || !beamHit(w, hit)) return;
    queueEclipse(w, t.x, t.y, 0, Math.atan2(hit.dirY ?? 0, hit.dirX ?? 1));
  },
  onRoomEnter(w) {
    w.vars.__eclipseQ = 0;
  },
});
