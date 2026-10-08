// 충전 (charge) artifacts for weapons that are held to charge an attack (kind 'charge': the
// bows and crossbows, the musket and the titan greatsword, which swings):
//  - 시위 밀랍 (bowstring_wax): fully charged attacks hit harder
//  - 숨 고르기 (steady_breath): the moment a charge fills, a frost breath slows enemies and bullets nearby
//  - 독 깃 (venom_fletch): charged attacks poison what they hit, by how full the charge was
//  - 낙뢰 깃털 (thunder_fletching): a fully charged attack calls lightning on the first enemy it hits
//  - 별똥 시위 (meteor_string): hold half a second past full to overcharge the next attack into a meteor
//
// "Charge weapon" = the held weapon has kind 'charge'. Only that weapon's own release counts:
// releases, kit attacks and item-made shots / swings are left alone. With any other weapon these
// artifacts do nothing (never a penalty).
//
// The charge of a release: most charge weapons zero `weapon.charge` before their attack hooks
// run, so the artifacts record the charge every frame (onUpdate runs after the keeper's weapon
// update) and read the last value when the attack starts. Weapons that fire on their own the
// instant they are full (AUTO_FIRE) attack while the trigger is still held: that attack is full.

import { defineArtifact, Weapons } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { Entity, type Actor, type HitInfo } from '../../game/entity';
import { Enemy } from '../../game/enemy';
import { MeleeSwing } from '../../game/melee';
import { Projectile, type ProjBehavior } from '../../game/projectile';
import { RingFx } from '../../game/effects';
import { lookGlow } from '../../game/look';
import { visualHandPos } from '../../game/weapon-pose';
import { FIXED_DT } from '../../game/constants';
import { TAU, clamp, dist2 } from '../../engine/math';
import { fx } from '../../engine/rng';
import type { Renderer } from '../../engine/renderer';
import type { World } from '../../game/world';
import {
  O, amplifyShot, amplifySwing, chainLightning, cooldown, enemiesNear, inflict, isPrimary, itemHit, proc, skyBolt, stackMul, statusPuff,
} from './lib';

// ====================================================================== tuning (exported for tests)
/** 시위 밀랍: damage bonus of a fully charged attack, per copy */
export const WAX_BONUS = 0.12;
/** 숨 고르기: field radius and duration (+ per extra copy), slow strength, interval */
export const BREATH_R = 90;
export const BREATH_R_COPY = 10;
export const BREATH_T = 0.8;
export const BREATH_T_COPY = 0.3;
export const BREATH_SLOW = 0.5;
export const BREATH_CD = 3;
/** 독 깃: poison per second at full charge (x keeper damage), duration (+50 % per extra copy) */
export const VENOM_DPS = 0.13;
export const VENOM_T = 3;
/** 낙뢰 깃털: bolt and chain damage (x keeper damage), chain targets, stun on the struck enemy */
export const BOLT_DMG = 0.55;
export const CHAIN_DMG = 0.35;
export const CHAIN_JUMPS = 2;
export const BOLT_STUN = 0.25;
/**
 * 별똥 시위: hold time past full, shot bonus, explosion (x the shot's damage: the struck enemy /
 * the others in reach) and radius, shockwave (x the swing's damage)
 */
export const OVER_T = 0.5;
export const OVER_AMP = 0.5;
export const OVER_BLAST = 0.8;
export const OVER_SPLASH = 0.4;
export const OVER_BLAST_R = 30;
export const OVER_WAVE = 0.9;

/** a release counts as full from here (weapons compare against exactly 1) */
const FULL = 1 - 1e-6;
/** charge weapons that fire by themselves the instant their charge is full */
const AUTO_FIRE = new Set(['silvermoon_longbow', 'ember_musket', 'glacier_arbalest']);
/** how long 별똥 시위 keeps an auto-firing weapon waiting at full per frame (weapon cooldown) */
const HOLD = FIXED_DT * 1.5;

// ====================================================================== charge tracking (shared)
const weaponIdx = new Map<string, number>();
/** Registry position of a weapon (a number, so it can live in w.vars). */
function weaponIndex(id: string): number {
  let i = weaponIdx.get(id);
  if (i === undefined) {
    i = Weapons.all().findIndex((d) => d.id === id);
    weaponIdx.set(id, i);
  }
  return i;
}

/** Does the context keeper hold a charge weapon? */
export function holdsChargeWeapon(w: World): boolean {
  return Weapons.get(w.player.weaponId)?.kind === 'charge';
}

/** Record the held charge weapon's charge (every frame from onUpdate; idempotent, any artifact may call it). */
function trackCharge(w: World): void {
  const p = w.player;
  w.vars.__chgLast = holdsChargeWeapon(w) ? p.weapon.charge : 0;
  w.vars.__chgW = weaponIndex(p.weaponId);
}

/**
 * The release starting now (call from onAttack): stores its charge, serial number and the
 * overcharge in w.vars (__chgAtkT / __chgAtkC / __chgAtkN / __chgAtkO). Idempotent within one
 * attack, so every artifact can call it. Returns false when it is not a charge weapon's attack.
 */
function noteRelease(w: World): boolean {
  const p = w.player;
  if (!holdsChargeWeapon(w) || p.dashing) return false;
  if (w.vars.__chgAtkT === w.time) return true;
  const same = w.vars.__chgW === weaponIndex(p.weaponId);
  // an auto-firing weapon only attacks with the trigger held when its charge just filled
  const auto = p.firing && AUTO_FIRE.has(p.weaponId) ? 1 : 0;
  const c = clamp(Math.max(auto, p.weapon.charge, same ? (w.vars.__chgLast ?? 0) : 0), 0, 1);
  w.vars.__chgAtkT = w.time;
  w.vars.__chgAtkC = c;
  w.vars.__chgAtkN = (w.vars.__chgAtkN ?? 0) + 1;
  w.vars.__chgAtkO = c >= FULL && (w.vars.__meteorReady ?? 0) > 0 ? 1 : 0;
  return true;
}

/** Charge of the release this weapon shot belongs to (tags the shot once), or -1. */
function tagShot(w: World, pr: Projectile): number {
  if (pr.mem.chgN) return pr.mem.chgC;
  if (!pr.fromWeapon || pr.generation > 0 || pr.team !== 'player' || w.vars.__chgAtkT !== w.time || !holdsChargeWeapon(w)) return -1;
  pr.mem.chgN = w.vars.__chgAtkN;
  pr.mem.chgC = w.vars.__chgAtkC;
  pr.mem.chgO = w.vars.__chgAtkO;
  return pr.mem.chgC;
}

interface SwingTag { c: number; n: number; o: number }
/** swings of a charge weapon's release, taken when they are made (hits read them) */
const swingTags = new WeakMap<MeleeSwing, SwingTag>();

/** The release a weapon swing belongs to (tags it once), or null. */
function tagSwing(w: World, sw: MeleeSwing): SwingTag | null {
  const cur = swingTags.get(sw);
  if (cur) return cur;
  if (sw.owner !== w.player || sw.o.noProc || sw.o.release || w.vars.__chgAtkT !== w.time || !holdsChargeWeapon(w)) return null;
  const tag = { c: w.vars.__chgAtkC ?? 0, n: w.vars.__chgAtkN ?? 0, o: w.vars.__chgAtkO ?? 0 };
  swingTags.set(sw, tag);
  return tag;
}

/** The release a hit came from (its weapon shot or swing), or null. */
function hitRelease(hit: HitInfo): SwingTag | null {
  const s = hit.source;
  if (s instanceof Projectile) return s.mem.chgN ? { c: s.mem.chgC, n: s.mem.chgN, o: s.mem.chgO ?? 0 } : null;
  if (s instanceof MeleeSwing) return swingTags.get(s) ?? null;
  return null;
}

// ====================================================================== 시위 밀랍 (common, venom)
const WAX = ['#5a2c0c', '#9a5418', '#d08a2a', '#f4bc4c', '#ffe08a', '#fff6d6'];

defineDrawnSprite('icon_bowstring_wax', 16, 16, (p) => {
  // the tip of a bow (top-right) and its string; a cake of beeswax rubbed along the string
  // leaves the upper part glossy amber, the lower part is still bare cord
  // the bow limb: its recurved tip (where the string is tied) curving away down the right edge
  p.line(11, 0, 12, 0, '#e8c080');
  p.line(13, 1, 15, 3, '#6a4428');
  p.line(15, 3, 15, 11, '#6a4428');
  p.line(13, 2, 14, 3, '#b07a44');
  p.line(14, 4, 14, 10, '#b07a44');
  p.px(12, 1, '#b07a44');
  p.px(14, 5, '#e8c080');
  // the bare string below the wax
  p.line(0, 15, 6, 10, '#e8e0cc');
  p.line(1, 15, 6, 11, '#8a7a64');
  // the waxed string above it: amber with glints
  p.line(9, 7, 13, 2, WAX[3]);
  p.line(10, 7, 13, 3, WAX[1]);
  p.px(11, 4, WAX[5]);
  p.px(12, 3, WAX[4]);
  // the wax cake threaded on the string: a short cylinder, lit from the top-left
  p.ellipse(7.5, 11.2, 4.6, 2.2, WAX[0]);
  p.rect(2.9, 8, 9.2, 3.4, WAX[1]);
  p.rect(2.9, 8, 3, 3.6, WAX[2]);
  p.px(3, 11, WAX[2]);
  p.rect(10, 8, 2.1, 3.4, WAX[0]);
  p.ellipse(7.5, 8, 4.6, 2.3, WAX[3]);
  p.ellipse(6.6, 7.5, 2.8, 1.3, WAX[4]);
  p.px(5, 7, WAX[5]);
  p.px(6, 7, WAX[5]);
  // the string cut into the rim (top-right) and out of the side (lower-left)
  p.line(9, 7, 11, 6, '#c8b898');
  p.px(10, 7, WAX[1]);
  p.px(3, 11, '#c8b898');
  p.px(4, 10, WAX[0]);
  // a drip down the side
  p.px(8, 12, WAX[2]);
  p.px(8, 13, WAX[3]);
  // a sparkle of fresh wax
  p.px(3, 3, WAX[5]);
  p.px(2, 4, WAX[4]);
  p.px(4, 4, WAX[4]);
  p.px(3, 5, WAX[4]);
}, { outline: O });

/** A waxed full-charge shot: a warm amber halo (cosmetic only). */
const waxGlow: ProjBehavior = {
  id: 'wax-glow',
  update(p, w) {
    if (fx.chance(0.3)) w.particles.spawn({ x: p.x + fx.range(-1, 1), y: p.y - p.z + fx.range(-1, 1), vy: fx.range(8, 20), life: 0.3, colors: ['#fff6d6', WAX[4], WAX[3]], size: 1 });
  },
  draw(p, r) {
    r.sprite(lookGlow(12 + p.r * 2, WAX[4]), p.x, p.y - p.z, { additive: true, alpha: 0.5 });
  },
};

/** The full release snaps off the waxed string: amber glints at the weapon hand. */
function waxFlourish(w: World): void {
  const p = w.player;
  const h = visualHandPos(p, p.aim, 10);
  w.particles.burst(h.x, h.y, { count: 7, speed: [30, 90], angle: p.aim, spread: 1.4, life: [0.15, 0.3], colors: ['#ffffff', WAX[5], WAX[4], WAX[3]], shape: 'spark', size: [1, 2], additive: true });
  w.sfx('hit_metal', { vol: 0.14, pitch: fx.range(2.1, 2.3) });
}

defineArtifact({
  id: 'bowstring_wax',
  name: '시위 밀랍',
  desc: '충전 무기로 가득 모은 공격의 피해가 12% 오른다.',
  quote: '잘 먹인 시위는 소리부터 다르다.',
  rarity: 'common',
  tags: ['venom'],
  icon: 'icon_bowstring_wax',
  look: { mote: '#f4bc4c', hit: '#ffe08a' },
  pools: ['treasure', 'shop'],
  onUpdate(w) {
    trackCharge(w);
  },
  onAttack(w) {
    if (!noteRelease(w) || (w.vars.__chgAtkC ?? 0) < FULL) return;
    waxFlourish(w);
    proc(w, 'bowstring_wax');
  },
  onShoot(w, pr, power) {
    if (tagShot(w, pr) < FULL) return;
    amplifyShot(pr, WAX_BONUS * power);
    pr.addBehavior(waxGlow);
  },
  onSwing(w, sw, power) {
    const tag = tagSwing(w, sw);
    if (!tag || tag.c < FULL) return;
    amplifySwing(sw, WAX_BONUS * power);
    if (sw.o.style !== 'none') sw.o.color = '#ffd890';
  },
});

// ====================================================================== 숨 고르기 (rare, frost)
const FROST = ['#2a5a8a', '#4a8ac0', '#8fc8ec', '#c8ecff', '#ffffff'];

defineDrawnSprite('icon_steady_breath', 16, 16, (p) => {
  // a held breath let out as a frost swirl around a snow crystal, unwinding into a gust
  const cx = 9.5;
  const cy = 7;
  // the swirl: a thick ring open at the lower left, lit on its upper-left
  for (let i = 0; i <= 64; i++) {
    const a = -Math.PI * 0.2 + (i / 64) * Math.PI * 1.45;
    for (const r of [4.1, 5.1]) {
      const x = cx + Math.cos(a) * r;
      const y = cy - Math.sin(a) * r;
      const lit = Math.cos(a - Math.PI * 0.75);
      p.px(x, y, r > 4.5 ? (lit > 0.3 ? FROST[4] : FROST[3]) : lit > 0.3 ? FROST[3] : FROST[2]);
    }
  }
  // the gust leaving the swirl to the lower left
  p.line(0, 12, 5, 10, FROST[3]);
  p.line(1, 13, 6, 11, FROST[2]);
  p.line(4, 10, 5, 10, FROST[4]);
  p.line(0, 15, 3, 14, FROST[2]);
  // the snow crystal in its eye
  p.line(cx - 0.5, cy - 2, cx - 0.5, cy + 2, FROST[4]);
  p.line(cx - 2.5, cy, cx + 1.5, cy, FROST[4]);
  p.px(cx - 1.5, cy - 1, FROST[2]);
  p.px(cx + 0.5, cy - 1, FROST[2]);
  p.px(cx - 1.5, cy + 1, FROST[2]);
  p.px(cx + 0.5, cy + 1, FROST[2]);
  // stray crystals
  p.px(15, 1, FROST[4]);
  p.px(14, 14, FROST[3]);
  p.px(1, 3, FROST[3]);
}, { outline: '#0c1830' });

/** Enemy bullets inside the breath field move at half speed (vx / vy only for this step). */
const breathSlow: ProjBehavior = {
  id: 'breath-slow',
  update(p, w) {
    if ((p.mem.breathT ?? -1) < w.time) return;
    p.vx *= 1 - BREATH_SLOW;
    p.vy *= 1 - BREATH_SLOW;
  },
  draw(p, r, w) {
    if ((p.mem.breathT ?? -1) < w.time - 0.05) return;
    r.pixelRing(p.x, p.y - p.z, p.r + 2, FROST[3], 1, 0.75);
  },
};

function breathRadius(power: number): number {
  return BREATH_R + BREATH_R_COPY * (power - 1);
}

/** Let the breath out: the field starts around the keeper (at most once per BREATH_CD). */
function breathe(w: World, power: number): void {
  const p = w.player;
  const hostile = w.enemies.some((e) => e.alive && !e.hidden) || w.projectiles.some((b) => b.team === 'enemy' && !b.dead);
  if (!hostile || !cooldown(w, 'steady_breath', BREATH_CD)) return;
  const dur = BREATH_T + BREATH_T_COPY * (power - 1);
  w.vars.__breathEnd = w.time + dur;
  w.vars.__breathAt = w.time;
  w.vars.__breathR = breathRadius(power);
  const R = breathRadius(power);
  w.spawn(new RingFx(p.x, p.y - 6, R, 0.35, FROST[3], 2));
  w.spawn(new RingFx(p.x, p.y - 6, R * 0.6, 0.3, FROST[4], 1));
  w.particles.burst(p.x, p.y - 8, { count: 22, speed: [40, 150], life: [0.35, 0.7], colors: [FROST[4], FROST[3], FROST[2]], size: [1, 3], shape: 'circle', drag: 3, fade: true });
  w.sfx('freeze', { vol: 0.35, pitch: 0.65 });
  w.sfx('whoosh', { vol: 0.3, pitch: 0.55 });
  breathTick(w);
  proc(w, 'steady_breath');
}

/** While the field lasts: slow enemies inside it and mark enemy bullets inside it. */
function breathTick(w: World): void {
  const end = w.vars.__breathEnd ?? 0;
  if (end <= w.time) return;
  const p = w.player;
  const R = w.vars.__breathR ?? BREATH_R;
  const cy = p.y - 6;
  for (const e of enemiesNear(w, p.x, cy, R)) {
    if ((e.mem.__breathSlowT ?? -1) >= end) continue;
    if (inflict(w, e, { kind: 'slow', duration: end - w.time + 0.1, power: BREATH_SLOW }, false)) e.mem.__breathSlowT = end;
  }
  for (const b of w.projectiles) {
    if (b.dead || b.team !== 'enemy' || dist2(b.x, b.y, p.x, cy) > (R + b.r) * (R + b.r)) continue;
    b.addBehavior(breathSlow);
    b.mem.breathT = w.time + HOLD;
  }
}

defineArtifact({
  id: 'steady_breath',
  name: '숨 고르기',
  desc: '충전 무기가 가득 차는 순간 주변 적과 적탄이 느려진다.',
  quote: '쏘기 전에 한 번, 깊게.',
  rarity: 'rare',
  tags: ['frost'],
  icon: 'icon_steady_breath',
  look: { aura: '#8fc8ec', step: '#c8ecff' },
  pools: ['treasure', 'shop', 'shrine'],
  onUpdate(w, _dt, power) {
    trackCharge(w);
    const p = w.player;
    const c = holdsChargeWeapon(w) ? p.weapon.charge : 0;
    const prev = w.vars.__breathPrev ?? 0;
    w.vars.__breathPrev = c;
    if (prev < FULL && c >= FULL) breathe(w, power);
    breathTick(w);
  },
  onAttack(w, _angle, power) {
    if (!noteRelease(w)) return;
    // auto-firing weapons fill and fire in the same instant
    if (w.player.firing && AUTO_FIRE.has(w.player.weaponId) && (w.vars.__breathPrev ?? 0) < FULL) {
      w.vars.__breathPrev = 1;
      breathe(w, power);
    }
  },
  onRoomEnter(w) {
    w.vars.__breathEnd = 0;
  },
  draw(w, r) {
    const end = w.vars.__breathEnd ?? 0;
    if (end <= w.time) return;
    const p = w.player;
    const start = w.vars.__breathAt ?? w.time;
    const R = w.vars.__breathR ?? BREATH_R;
    const t = clamp((w.time - start) / Math.max(0.01, end - start), 0, 1);
    const a = Math.min(1, (w.time - start) / 0.12) * (t > 0.7 ? (1 - t) / 0.3 : 1);
    r.circle(p.x, p.y - 6, R, FROST[3], 0.07 * a);
    // a frosted rim: dotted ring slowly turning, brighter on the top-left
    const n = 40;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + w.time * 0.6;
      if (i % 2) continue;
      const lit = Math.cos(ang + Math.PI * 0.75) > 0;
      r.rect(p.x + Math.cos(ang) * R - 0.5, p.y - 6 + Math.sin(ang) * R * 0.9 - 0.5, 1, 1, lit ? FROST[4] : FROST[2], 0.8 * a);
    }
    // a few mist motes drifting outward
    for (let i = 0; i < 6; i++) {
      const ang = i * 1.05 + start * 3;
      const d = R * (0.35 + 0.55 * ((t + i * 0.17) % 1));
      r.rect(p.x + Math.cos(ang) * d, p.y - 6 + Math.sin(ang) * d * 0.9, 2, 1, FROST[3], 0.55 * a);
    }
  },
});

// ====================================================================== 독 깃 (rare, venom)
const VEN = ['#1e5010', '#3a8a20', '#5ad030', '#8aff5a', '#d8ffa0'];
const VIOLET = ['#3a1840', '#7a3a8a', '#b070c0'];

defineDrawnSprite('icon_venom_fletch', 16, 16, (p) => {
  // the shaft of an arrow, steel head at the top-right, poison fletching at the back
  p.line(1, 15, 13, 3, '#6a4426');
  p.line(2, 15, 14, 3, '#a87444');
  p.poly([12, 4, 15.5, 0.5, 14.5, 5, 13, 5], '#9aa4bc');
  p.line(13, 3, 15, 1, '#e8eef8');
  p.px(15, 0, VEN[3]);
  p.px(14, 2, VEN[4]);
  // upper vane (lit) and lower vane (in shadow), both swept back along the shaft
  p.poly([3.5, 12.5, 8.5, 7.5, 7.2, 5.2, 1.2, 9.2], VEN[2]);
  p.poly([3.5, 12.5, 8.5, 7.5, 10.8, 9.8, 6.4, 15.4], VEN[1]);
  p.line(2, 9, 7, 6, VEN[4]);
  p.px(1, 9, VEN[3]);
  p.line(8, 9, 10, 10, VEN[2]);
  // violet barb bands across both vanes
  p.line(3, 9, 5, 11, VIOLET[1]);
  p.line(5, 7, 7, 9, VIOLET[1]);
  p.px(4, 9, VIOLET[2]);
  p.px(6, 7, VIOLET[2]);
  p.line(5, 13, 7, 11, VIOLET[0]);
  p.line(7, 14, 9, 12, VIOLET[0]);
  // the nock
  p.rect(0, 14, 2, 2, '#e0d0b0');
  p.px(0, 15, '#a89070');
  // a drop of venom falling from the lower vane
  p.ellipse(12.5, 13.5, 1.6, 1.8, VEN[2]);
  p.px(12, 12, VEN[3]);
  p.px(12, 13, VEN[4]);
  p.px(13, 15, VEN[1]);
}, { outline: '#0a1806' });

/** A poisoned release drips venom as it flies (cosmetic only; more for a fuller charge). */
const venomDrip: ProjBehavior = {
  id: 'venom-drip',
  update(p, w) {
    if (!fx.chance(0.15 + 0.35 * clamp(Number(p.mem.chgC ?? 0), 0, 1))) return;
    w.particles.spawn({ x: p.x + fx.range(-1, 1), y: p.y - p.z + 1, vy: fx.range(10, 30), vx: fx.range(-5, 5), life: 0.35, colors: [VEN[4], VEN[3], VEN[2]], size: 1, gravity: 120 });
  },
};

/** Poison of a release charged to `c`, for the keeper's damage (copies lengthen it). */
function venomFor(w: World, c: number, power: number) {
  return {
    kind: 'poison' as const,
    duration: VENOM_T * (1 + 0.5 * (power - 1)),
    power: w.player.stats.damage * VENOM_DPS * clamp(c, 0, 1),
    procKey: 'item:venom_fletch:poison',
  };
}

defineArtifact({
  id: 'venom_fletch',
  name: '독 깃',
  desc: '충전 무기로 맞힌 적은 모은 만큼 강한 독에 걸린다.',
  quote: '깃털 끝에 한 방울이면 충분하다.',
  rarity: 'rare',
  tags: ['venom'],
  icon: 'icon_venom_fletch',
  look: { trail: 'drip', hit: '#8aff5a' },
  pools: ['treasure', 'shop', 'curse'],
  onUpdate(w) {
    trackCharge(w);
  },
  onAttack(w) {
    noteRelease(w);
  },
  onShoot(w, pr, power) {
    const c = tagShot(w, pr);
    if (c <= 0) return;
    pr.statuses = [...pr.statuses, venomFor(w, c, power)];
    pr.addBehavior(venomDrip);
  },
  onSwing(w, sw, power) {
    const tag = tagSwing(w, sw);
    if (!tag || tag.c <= 0) return;
    sw.o.statuses = [...(sw.o.statuses ?? []), venomFor(w, tag.c, power)];
  },
  onHit(w, t, hit) {
    if (!(t instanceof Enemy) || !isPrimary(hit) || !hitRelease(hit) || !t.hasStatus('poison')) return;
    if (!hit.statuses?.some((s) => s.procKey === 'item:venom_fletch:poison') || (t.mem.__venomFx ?? -1) > w.time) return;
    t.mem.__venomFx = w.time + 0.5;
    statusPuff(w, t, 'poison');
    proc(w, 'venom_fletch');
  },
});

// ====================================================================== 낙뢰 깃털 (epic, storm)
const STORM = ['#141a48', '#283a98', '#4a6ad8', '#8aa8ff', '#d8e4ff'];
const BOLT = '#ffe95a';

defineDrawnSprite('icon_thunder_fletching', 16, 16, (p) => {
  // one long storm-blue quill feather, a lightning bolt branded across its vane
  p.poly([2.5, 14.5, 3, 10, 5.5, 6, 9.5, 2.5, 15, 0.5, 14, 4.5, 11, 9, 7, 12.5], STORM[1]);
  // the lit upper-left half of the vane
  p.poly([2.5, 14.5, 3, 10, 5.5, 6, 9.5, 2.5, 15, 0.5], STORM[2]);
  // barbs: short strokes swept back from the rachis
  for (let i = 0; i < 5; i++) {
    const x = 4 + i * 2.2;
    const y = 12 - i * 2.2;
    p.line(x - 1, y - 2, x, y - 1, STORM[3]);
    p.line(x + 1, y + 1, x + 2, y + 2, STORM[0]);
  }
  // split barbs on both edges
  p.px(3, 9, null);
  p.px(6, 5, null);
  p.px(12, 9, null);
  p.px(9, 12, null);
  // the rachis
  p.line(1, 15, 14, 2, STORM[4]);
  p.px(0, 15, '#f0f0ff');
  // the bolt: a bold yellow zig-zag with a white core
  const bolt = [13, 3, 9, 6, 11, 8, 6, 12];
  for (let i = 0; i + 3 < bolt.length; i += 2) {
    p.line(bolt[i], bolt[i + 1], bolt[i + 2], bolt[i + 3], BOLT);
    p.line(bolt[i] + 1, bolt[i + 1], bolt[i + 2] + 1, bolt[i + 3], BOLT);
  }
  p.line(12, 4, 10, 5, '#ffffff');
  p.line(10, 7, 11, 7, '#ffffff');
  p.line(9, 9, 7, 11, '#ffffff');
  p.px(5, 13, BOLT);
  // sparks thrown off the tip
  p.px(15, 3, BOLT);
  p.px(13, 6, '#fff8c0');
  p.px(11, 0, '#fff8c0');
}, { outline: '#0a0c24' });

/** A thunder-fletched full-charge shot crackles in flight (cosmetic only). */
const thunderCrackle: ProjBehavior = {
  id: 'thunder-crackle',
  update(p, w) {
    if (fx.chance(0.35)) w.particles.spawn({ x: p.x + fx.range(-3, 3), y: p.y - p.z + fx.range(-3, 3), vx: fx.range(-30, 30), vy: fx.range(-30, 30), life: 0.12, colors: ['#ffffff', BOLT], size: 1, shape: 'spark', additive: true });
  },
  draw(p, r) {
    r.sprite(lookGlow(10 + p.r * 2, BOLT), p.x, p.y - p.z, { additive: true, alpha: 0.35 });
  },
};

defineArtifact({
  id: 'thunder_fletching',
  name: '낙뢰 깃털',
  desc: '충전 무기로 가득 모은 공격이 맞힌 적에게 벼락이 떨어진다.',
  quote: '깃털 하나가 하늘을 끌어내린다.',
  rarity: 'epic',
  tags: ['storm'],
  icon: 'icon_thunder_fletching',
  look: { mote: '#ffe95a', hit: '#fff8c0' },
  pools: ['treasure', 'boss', 'challenge'],
  onUpdate(w) {
    trackCharge(w);
  },
  onAttack(w) {
    if (!noteRelease(w) || (w.vars.__chgAtkC ?? 0) < FULL) return;
    const p = w.player;
    const h = visualHandPos(p, p.aim, 10);
    w.particles.burst(h.x, h.y, { count: 6, speed: [40, 110], life: [0.08, 0.2], colors: ['#ffffff', BOLT], shape: 'spark', size: [1, 2], additive: true });
  },
  onShoot(w, pr) {
    if (tagShot(w, pr) >= FULL) pr.addBehavior(thunderCrackle);
  },
  onSwing(w, sw) {
    tagSwing(w, sw);
  },
  onHit(w, t, hit, power) {
    if (!isPrimary(hit) || !(t instanceof Enemy)) return;
    const rel = hitRelease(hit);
    if (!rel || rel.c < FULL || w.vars.__thunderN === rel.n) return;
    const p = w.player;
    if (!cooldown(w, 'thunder_fletching', 1 / Math.max(0.5, p.stats.fireRate))) return;
    w.vars.__thunderN = rel.n;
    const target = t.alive ? t : w.nearestEnemy(t.x, t.y, 60);
    if (!target) return;
    const d = p.stats.damage;
    skyBolt(w, target, d * BOLT_DMG * stackMul(power), BOLT_STUN, BOLT);
    chainLightning(w, target.x, target.y - target.z - 4, { jumps: CHAIN_JUMPS, damage: d * CHAIN_DMG, range: 90, exclude: new Set([target.id]) });
    w.sfx('lightning', { vol: 0.5, pitch: fx.range(0.8, 0.95) });
    w.shake(0.12);
    proc(w, 'thunder_fletching');
  },
});

// ====================================================================== 별똥 시위 (legendary, star)
const STAR = ['#2a1a50', '#5a40a8', '#8a70d8', '#b8a8ff', '#e8e0ff', '#ffffff'];
const GOLD = ['#6a4010', '#b07a20', '#e8b840', '#ffe890'];

defineDrawnSprite('icon_meteor_string', 16, 16, (p) => {
  // a recurve limb (gold, violet grip) bowed toward the top-right, its string drawn back to the
  // bottom-left where a shooting star is nocked
  const limb: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const x = 3 + 11 * t + Math.sin(t * Math.PI) * 3.6;
    const y = 1 + 11 * t - Math.sin(t * Math.PI) * 3.6;
    limb.push([x, y]);
  }
  for (const [x, y] of limb) p.rect(x - 0.5, y - 0.5, 2, 2, GOLD[1]);
  for (const [x, y] of limb) p.px(x, y, GOLD[2]);
  p.px(4, 1, GOLD[3]);
  p.px(7, 0, GOLD[3]);
  p.px(10, 1, GOLD[3]);
  // the grip, wrapped in violet
  p.rect(11, 4, 3, 3, STAR[1]);
  p.px(11, 4, STAR[3]);
  p.px(12, 5, STAR[2]);
  // the string, pulled to the nock
  p.line(3, 1, 6, 10, STAR[4]);
  p.line(14, 12, 6, 10, STAR[4]);
  // the meteor's tail streaming back to the corner
  p.line(0, 15, 4, 12, STAR[1]);
  p.line(1, 15, 5, 12, STAR[2]);
  p.line(0, 14, 4, 11, STAR[2]);
  p.px(2, 13, STAR[3]);
  p.px(3, 12, STAR[4]);
  // the star itself, nocked on the string
  p.poly([6.5, 6, 7.6, 9, 10.5, 9.5, 8.2, 11.4, 9, 14.5, 6.5, 12.6, 4, 14.5, 4.8, 11.4, 2.5, 9.5, 5.4, 9], '#ffd84a');
  p.poly([6.5, 7.6, 7.2, 9.8, 8.8, 10.2, 7.4, 11.4, 7.8, 13, 6.5, 12, 5.2, 13, 5.6, 11.4, 4.2, 10.2, 5.8, 9.8], GOLD[3]);
  p.px(6, 10, '#ffffff');
  p.px(6, 11, '#ffffff');
  p.px(7, 10, '#fffbe0');
  // twinkles
  p.px(15, 15, STAR[4]);
  p.px(12, 14, STAR[3]);
  p.px(1, 6, STAR[4]);
}, { outline: '#120a28' });

defineDrawnSprite('fx_meteor_crest', 11, 11, (p) => {
  p.poly([5.5, 0, 6.6, 4.4, 11, 5.5, 6.6, 6.6, 5.5, 11, 4.4, 6.6, 0, 5.5, 4.4, 4.4], STAR[3]);
  p.poly([5.5, 1.8, 6.2, 4.8, 9.2, 5.5, 6.2, 6.2, 5.5, 9.2, 4.8, 6.2, 1.8, 5.5, 4.8, 4.8], STAR[4]);
  p.rect(5, 4, 1, 3, '#ffffff');
  p.rect(4, 5, 3, 1, '#ffffff');
  p.px(3, 3, '#ffd84a');
  p.px(7, 7, '#ffd84a');
}, { outline: STAR[0] });

/**
 * Star-shaped burst around (x, y) for a meteor of `shot` damage: the struck enemy takes OVER_BLAST of
 * it, every other enemy in reach OVER_SPLASH (explosion hits, crits allowed, no procs).
 */
function meteorBlast(w: World, x: number, y: number, radius: number, shot: number, struck: Actor | null): void {
  w.spawn(new RingFx(x, y, radius, 0.3, STAR[4], 2));
  w.spawn(new RingFx(x, y, radius * 0.6, 0.22, '#ffd84a', 1));
  w.particles.spawn({ x, y, life: 0.28, size: 3, sizeEnd: radius * 1.2, colors: ['#ffffff', STAR[3]], shape: 'ring' });
  w.particles.burst(x, y, { count: 18, speed: [50, 160], life: [0.2, 0.5], colors: ['#ffffff', STAR[4], STAR[3], '#ffd84a'], shape: 'spark', size: [1, 3], additive: true, light: 7, lightColor: STAR[3] });
  w.particles.burst(x, y, { count: 6, speed: [10, 40], life: [0.4, 0.8], colors: [STAR[2], STAR[1]], size: [2, 3], sizeEnd: 4, drag: 3 });
  w.lights.glow(x, y, radius * 2.2, STAR[3], 0.7);
  w.decal(x, y, '#20184a', radius * 0.45, 0.4);
  w.sfx('explosion', { vol: 0.4, pitch: 1.45 });
  w.sfx('orb', { vol: 0.45, pitch: 1.5 });
  w.shake(0.18);
  for (const e of enemiesNear(w, x, y, radius)) {
    itemHit(w, e, shot * (e === struck ? OVER_BLAST : OVER_SPLASH), { from: { x, y }, knockback: 130, kind: 'explosion', procs: ['meteor'] });
  }
  proc(w, 'meteor_string');
}

/** An overcharged shot: flies as a meteor and bursts where it first strikes (or where it stops). */
const meteorShot: ProjBehavior = {
  id: 'meteor-shot',
  update(p, w) {
    if (fx.chance(0.7)) {
      w.particles.spawn({ x: p.x - Math.cos(p.angle) * 4 + fx.range(-2, 2), y: p.y - p.z + fx.range(-2, 2), life: fx.range(0.2, 0.4), colors: ['#ffffff', STAR[4], STAR[3], STAR[2]], size: 2, sizeEnd: 0, additive: true });
    }
  },
  onHit(p, w, target) {
    if (p.mem.metBoom) return;
    p.mem.metBoom = 1;
    meteorBlast(w, target.x, target.y - 2, OVER_BLAST_R, Number(p.mem.metDmg ?? p.damage), target);
  },
  onExpire(p, w) {
    if (p.mem.metBoom) return;
    p.mem.metBoom = 1;
    if (w.enemies.some((e) => e.alive && !e.hidden && dist2(e.x, e.y, p.x, p.y) < (OVER_BLAST_R + e.r) * (OVER_BLAST_R + e.r))) {
      meteorBlast(w, p.x, p.y, OVER_BLAST_R, Number(p.mem.metDmg ?? p.damage), null);
    }
  },
  draw(p, r, w) {
    r.sprite(lookGlow(16 + p.r * 3, STAR[3]), p.x, p.y - p.z, { additive: true, alpha: 0.55 });
    r.sprite('fx_meteor_crest', p.x + Math.cos(p.angle) * p.r, p.y - p.z + Math.sin(p.angle) * p.r, { rot: w.time * 8, alpha: 0.9 });
  },
};

/** the meteor of each keeper's latest overcharged release (the release's other shots merge into it) */
const meteors = new WeakMap<object, { n: number; p: Projectile }>();

/** Turn the first shot of an overcharged release into the meteor; later shots of the release merge into it. */
function overchargeShot(w: World, pr: Projectile): void {
  const cur = meteors.get(w.player);
  if (cur && cur.n === pr.mem.chgN && cur.p !== pr && !cur.p.dead) {
    cur.p.damage += pr.damage;
    cur.p.mem.metDmg = Number(cur.p.mem.metDmg ?? 0) + pr.damage;
    // payloads built from weaponDamage (bursts, stakes ...) keep the merged share too
    if (pr.mem.weaponDamage !== undefined) cur.p.mem.weaponDamage = Number(cur.p.mem.weaponDamage ?? 0) + Number(pr.mem.weaponDamage);
    cur.p.mem.merged = Number(cur.p.mem.merged ?? 1) + 1;
    pr.damage = 0;
    pr.dead = true;
    return;
  }
  meteors.set(w.player, { n: pr.mem.chgN, p: pr });
  pr.mem.metDmg = pr.damage;
  pr.r *= 2;
  pr.scale *= 2;
  pr.lightR = Math.max(pr.lightR, 30);
  amplifyShot(pr, OVER_AMP);
  pr.addBehavior(meteorShot);
}

/** The greatsword's overcharged spin: a star shockwave rolls out from the keeper. */
export class MeteorWave extends Entity {
  room: unknown;
  maxR: number;
  dmg: number;
  hit = new Set<number>();
  r0: number;
  dur = 0.32;
  constructor(w: World, x: number, y: number, maxR: number, dmg: number) {
    super();
    this.x = x;
    this.y = y;
    this.maxR = maxR;
    this.r0 = maxR * 0.2;
    this.dmg = dmg;
    this.layer = 0;
    this.tileCollide = false;
    this.room = w.room;
  }

  get radius(): number {
    const t = clamp(this.age / this.dur, 0, 1);
    return this.r0 + (this.maxR - this.r0) * (1 - (1 - t) * (1 - t));
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.room !== w.room) {
      this.dead = true;
      return;
    }
    const R = this.radius;
    for (const e of enemiesNear(w, this.x, this.y, R)) {
      if (this.hit.has(e.id)) continue;
      this.hit.add(e.id);
      itemHit(w, e, this.dmg, { from: this, knockback: 170, kind: 'explosion', procs: ['meteor'] });
    }
    if (this.age < this.dur) {
      for (let i = 0; i < 3; i++) {
        const a = fx.angle();
        w.particles.spawn({ x: this.x + Math.cos(a) * R, y: this.y + Math.sin(a) * R * 0.8, vx: Math.cos(a) * 30, vy: Math.sin(a) * 24, life: 0.3, colors: ['#ffffff', STAR[4], STAR[3]], size: 1, shape: 'spark', additive: true });
      }
    }
    if (this.age >= this.dur + 0.15) this.dead = true;
  }

  override draw(r: Renderer): void {
    const t = clamp(this.age / (this.dur + 0.15), 0, 1);
    const R = this.radius;
    r.ring(this.x, this.y, R, STAR[3], 3 * (1 - t) + 1, 0.8 * (1 - t));
    r.ring(this.x, this.y, R - 3, '#ffffff', 1, 0.7 * (1 - t));
    r.ring(this.x, this.y, R * 0.8, '#ffd84a', 1, 0.35 * (1 - t));
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y, this.radius * 1.1, STAR[3], { intensity: 0.5 * (1 - clamp(this.age / (this.dur + 0.15), 0, 1)) });
  }
}

/** The overcharge is ready: star flash, chime and a word above the keeper. */
function overchargeCue(w: World): void {
  const p = w.player;
  const h = visualHandPos(p, p.aim, 12);
  w.spawn(new RingFx(p.x, p.y - 6, 26, 0.35, STAR[4], 2));
  w.spawn(new RingFx(h.x, h.y, 12, 0.25, '#ffd84a', 1));
  w.particles.burst(h.x, h.y, { count: 14, speed: [30, 110], life: [0.25, 0.5], colors: ['#ffffff', STAR[4], STAR[3], '#ffd84a'], shape: 'spark', size: [1, 2], additive: true });
  w.sfx('charge_ready', { vol: 0.6, pitch: 1.45 });
  w.sfx('orb', { vol: 0.4, pitch: 1.8 });
  w.floatText(p.x, p.y - 24, '과충전', STAR[4]);
  proc(w, 'meteor_string', true);
}

/** Hold time past full that overcharges: OVER_T at base attack speed, scaled like the weapon's own charge time. */
export function overchargeTime(w: World): number {
  return OVER_T * clamp(2.6 / Math.max(0.4, w.player.weaponStats.fireRate), 0.35, 2.5);
}

function meteorReset(w: World): void {
  w.vars.__meteorHold = 0;
  w.vars.__meteorReady = 0;
  w.vars.__meteorWait = 0;
}

defineArtifact({
  id: 'meteor_string',
  name: '별똥 시위',
  desc: '충전 무기가 가득 찬 뒤 더 모으면 터지는 별똥 일격이 나간다.',
  detail: '자동으로 쏘는 무기도 별똥이 될 때까지 기다렸다 쏜다.',
  quote: '가장 오래 버틴 별이 가장 멀리 떨어진다.',
  rarity: 'legendary',
  tags: ['star'],
  icon: 'icon_meteor_string',
  look: { aura: '#b8a8ff', mote: '#ffd84a' },
  pools: ['treasure', 'boss', 'secret'],
  unique: true,
  onUpdate(w, dt) {
    const p = w.player;
    const st = p.weapon;
    const idx = weaponIndex(p.weaponId);
    if (!holdsChargeWeapon(w) || w.vars.__meteorW !== idx) {
      if ((w.vars.__meteorHold ?? 0) > 0 || (w.vars.__meteorReady ?? 0) > 0 || w.vars.__meteorWait) meteorReset(w);
      w.vars.__meteorW = idx;
      w.vars.__meteorPrevC = 0;
      trackCharge(w);
      return;
    }
    const ready = (w.vars.__meteorReady ?? 0) > 0;
    // an auto-firing weapon waits at full while the trigger is held (until overcharged)
    if (AUTO_FIRE.has(p.weaponId)) {
      if (w.vars.__meteorWait) {
        if (p.firing && !ready && st.charge >= FULL) st.cooldown = Math.max(st.cooldown, HOLD);
        else w.vars.__meteorWait = 0;
      } else if (p.firing && !p.dashing && !ready && st.cooldown <= 0 && st.charge > 0) {
        const inc = st.charge - (w.vars.__meteorPrevC ?? 0);
        if (inc > 0 && st.charge + inc * 1.05 >= 1) {
          st.charge = 1;
          st.cooldown = Math.max(st.cooldown, HOLD);
          w.vars.__meteorWait = 1;
          w.sfx('charge_ready', { vol: 0.35, pitch: 1.1 });
        }
      }
    }
    w.vars.__meteorPrevC = st.charge;
    if (st.charge < FULL) {
      if ((w.vars.__meteorHold ?? 0) > 0 || ready) meteorReset(w);
    } else if (p.firing && !p.dashing && !ready) {
      w.vars.__meteorHold = (w.vars.__meteorHold ?? 0) + dt;
      if (w.vars.__meteorHold >= overchargeTime(w) - 1e-9) {
        w.vars.__meteorReady = 1;
        // an auto-firing weapon lets go now: it fires (overcharged) on the next step
        w.vars.__meteorWait = 0;
        overchargeCue(w);
      }
    }
    trackCharge(w);
  },
  onAttack(w) {
    if (!noteRelease(w) || !w.vars.__chgAtkO) return;
    meteorReset(w);
    const p = w.player;
    const h = visualHandPos(p, p.aim, 12);
    w.particles.burst(h.x, h.y, { count: 16, speed: [60, 180], angle: p.aim, spread: 0.9, life: [0.15, 0.35], colors: ['#ffffff', STAR[4], '#ffd84a'], shape: 'spark', size: [1, 2], additive: true });
    w.sfx('whoosh', { vol: 0.45, pitch: 1.5 });
    w.sfx('orb', { vol: 0.35, pitch: 1.2 });
    w.shake(0.12);
  },
  onShoot(w, pr) {
    tagShot(w, pr);
    if (pr.mem.chgO && !pr.mem.metDmg && !pr.dead) overchargeShot(w, pr);
  },
  onSwing(w, sw) {
    const tag = tagSwing(w, sw);
    if (!tag || !tag.o) return;
    amplifySwing(sw, OVER_AMP);
    if (sw.o.style !== 'none') sw.o.color = STAR[4];
    if (w.vars.__meteorWaveN === tag.n) return;
    w.vars.__meteorWaveN = tag.n;
    const R = Math.min(150, Math.max(sw.o.reach, 40) * 1.35);
    w.spawn(new MeteorWave(w, sw.x, sw.y + 3, R, sw.o.damage * OVER_WAVE));
    w.sfx('explosion', { vol: 0.35, pitch: 1.3 });
    w.sfx('orb', { vol: 0.4, pitch: 1.3 });
    proc(w, 'meteor_string');
  },
  onRoomEnter(w) {
    meteorReset(w);
  },
  onRemove(w) {
    meteorReset(w);
  },
  draw(w, r) {
    const p = w.player;
    if (!p.alive || p.fall > 0 || !holdsChargeWeapon(w)) return;
    const hold = w.vars.__meteorHold ?? 0;
    const ready = (w.vars.__meteorReady ?? 0) > 0;
    if (!ready && hold <= 0) return;
    const k = ready ? 1 : clamp(hold / overchargeTime(w), 0, 1);
    // the overcharge gauge: star beads on an ellipse at the keeper's feet, lighting up clockwise
    const n = 12;
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + (i / n) * TAU;
      const x = Math.round(p.x + Math.cos(ang) * 12) - 1;
      const y = Math.round(p.y + 2 + Math.sin(ang) * 5) - 1;
      const on = (i + 1) / n <= k + 1e-6;
      const pulse = ready ? 0.75 + 0.25 * Math.sin(w.time * 14 - i * 0.8) : 1;
      r.rect(x - 1, y - 1, 4, 4, STAR[0], 0.55);
      r.rect(x, y, 2, 2, on ? (ready ? '#ffffff' : STAR[4]) : STAR[1], on ? pulse : 0.8);
    }
    if (ready) {
      const h = visualHandPos(p, p.aim, 14);
      const s = 1 + 0.18 * Math.sin(w.time * 16);
      r.sprite(lookGlow(22, STAR[3]), h.x, h.y, { additive: true, alpha: 0.6 });
      r.sprite('fx_meteor_crest', h.x, h.y, { rot: w.time * 5, sx: s, sy: s });
    }
  },
});
