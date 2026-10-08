// 칼날 (blade) artifacts for melee play and weapon swapping:
//  - 숫돌 조각 (whetstone_chip): longer, sharper weapon swings
//  - 박자 칼집 (rhythm_scabbard): every third melee attack lands a heavy beat
//  - 되받는 날 (riposte_edge): bullets a swing knocks away fly back as frost blades
//  - 창끝 별 (spear_tip): hits with the outer part of the reach are sweet spots
//  - 손에 익은 끈 (grip_wrap): the first attack after a weapon swap hits harder
//
// "Melee weapon" here = the held weapon attacks with swings (kind 'melee', plus the
// swinging charge greatsword). Only swings made by that weapon count: releases
// (noProc), character kit swings (made mid-dash) and item swings are left alone.
// With any other weapon these artifacts do nothing (never a penalty).

import { defineArtifact, Weapons } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { Entity, type Actor, type HitInfo } from '../../game/entity';
import { Enemy } from '../../game/enemy';
import { MeleeSwing } from '../../game/melee';
import { Projectile, type ProjBehavior } from '../../game/projectile';
import { RingFx } from '../../game/effects';
import { lookGlow } from '../../game/look';
import { visualHandPos } from '../../game/weapon-pose';
import { angleDiff, angleTo, clamp } from '../../engine/math';
import { fx } from '../../engine/rng';
import type { Renderer } from '../../engine/renderer';
import type { World } from '../../game/world';
import { O, amplify, amplifyShot, amplifySwing, isPrimary, proc, stackMul } from './lib';

// ====================================================================== tuning (exported for tests)
/** 숫돌 조각: melee reach and melee damage per copy */
export const WHET_REACH = 0.12;
export const WHET_EDGE = 0.08;
/** 박자 칼집: every Nth melee attack, damage bonus per copy, knockback factor */
export const BEAT_EVERY = 3;
export const BEAT_BONUS = 0.3;
export const BEAT_KNOCK = 1.6;
/** 되받는 날: returned blade damage (x keeper damage), extra per copy, ember per deflect and per-second caps */
export const RIPOSTE_DMG = 0.5;
export const RIPOSTE_DMG_COPY = 0.3;
export const RIPOSTE_EMBER = 2;
export const RIPOSTE_EMBER_CAP = 3;
export const RIPOSTE_SHOTS_CAP = 2;
/** 창끝 별: outer share of the reach that counts as the sweet spot, damage bonus and crit chance per copy */
export const TIP_ZONE = 0.35;
export const TIP_BONUS = 0.15;
export const TIP_CRIT = 0.1;
/** 손에 익은 끈: damage bonus per copy, min seconds between triggers, swap -> attack window, beam window */
export const GRIP_BONUS = 0.4;
export const GRIP_CD = 1.5;
export const GRIP_AFTER_SWAP = 2;
export const GRIP_BEAM = 0.6;
const GRIP_SHOT = 0.2;

/** charge weapons that attack with swings (the rest of the swinging weapons are kind 'melee') */
const SWINGING_CHARGE = new Set(['titan_greatsword']);

/** Does the context keeper's held weapon attack with swings? */
export function holdsSwingWeapon(w: World): boolean {
  const d = Weapons.get(w.player.weaponId);
  return !!d && (d.kind === 'melee' || SWINGING_CHARGE.has(d.id));
}

/** A swing made by the context keeper's held melee weapon (not a release, kit or item swing). */
function weaponSwing(w: World, sw: MeleeSwing): boolean {
  return sw.owner === w.player && !sw.o.noProc && !sw.o.release && !w.player.dashing && holdsSwingWeapon(w);
}

/** Final radius of a swing: its reach, or the full radius of a growing ring (공명 종). */
function swingReach(sw: MeleeSwing): number {
  const r1 = (sw as unknown as { r1?: unknown }).r1;
  return Math.max(sw.o.reach, typeof r1 === 'number' ? r1 : 0);
}

// ====================================================================== 숫돌 조각 (common, blood)
defineDrawnSprite('icon_whetstone_chip', 16, 16, (p) => {
  // a two-tone combination whetstone seen from above: fine grey-blue layer over a coarse rust base
  p.poly([5, 10, 14.5, 5.2, 14.5, 9.6, 5, 14.4], '#a4523a');
  p.poly([5, 10, 14.5, 5.2, 14.5, 7.6, 5, 12.4], '#7f90a4');
  p.poly([0.5, 7.8, 5, 10, 5, 14.4, 0.5, 12.2], '#6e2e24');
  p.poly([0.5, 7.8, 5, 10, 5, 12.4, 0.5, 10.2], '#56647a');
  p.poly([0.5, 7.8, 10, 3, 14.5, 5.2, 5, 10], '#b4c4d4');
  // lit back edge, bright front rim, layer seam and grit
  p.line(1, 8, 9, 4, '#e2ecf4');
  p.line(5, 10, 13, 6, '#d0dce8');
  p.line(6, 12, 13, 8, '#c87a5a');
  p.line(5, 13, 13, 9, '#86402e');
  p.px(8, 12, '#d89070');
  p.px(11, 10, '#d89070');
  p.px(2, 11, '#8a3c2c');
  p.line(1, 10, 4, 11, '#6e7c90');
  // light from the top-left: the far half of the face catches it, the near corner dims
  p.poly([5, 10, 14.5, 5.2, 12.2, 4.1, 2.8, 8.9], '#a2b4c6');
  p.line(5, 10, 13, 6, '#d0dce8');
  // sharpening streaks on the face
  p.line(3, 7, 7, 5, '#f4f8fc');
  p.line(6, 8, 10, 6, '#e8f0f8');
  // chipped corner and the flake that flew off
  p.poly([11.5, 3.5, 14.8, 5.1, 14.8, 7.2, 12.6, 5.2], null);
  p.px(12, 5, '#6a7a8e');
  p.px(13, 6, '#56647a');
  p.px(13, 1, '#c8d4e0');
  p.px(14, 2, '#7f90a4');
  p.px(14, 1, '#e2ecf4');
  // sparks
  p.px(11, 1, '#ffe8a0');
  p.px(10, 0, '#fff8e0');
  p.px(15, 4, '#ffb060');
}, { outline: O });

defineArtifact({
  id: 'whetstone_chip',
  name: '숫돌 조각',
  desc: '근접 무기: 근접 사거리 +12%, 근접 피해 +8%',
  detail: '들고 있는 근접 무기(거인의 대검 포함)의 휘두르기·찌르기·파동에만 적용된다. 해방, 캐릭터 기술, 다른 유물이 만든 베기와 탄환·광선 무기에는 효과가 없다. 중복 시 수치가 그대로 더해진다.',
  quote: '한 번 갈 때마다 칼끝이 한 치씩 멀어진다.',
  rarity: 'common',
  tags: ['blood'],
  icon: 'icon_whetstone_chip',
  look: { mote: '#cfe0ee', hit: '#e8f4ff' },
  pools: ['treasure', 'shop', 'challenge'],
  onSwing(w, sw, power) {
    if (!weaponSwing(w, sw)) return;
    const k = 1 + WHET_REACH * power;
    const ring = sw as unknown as { r1?: number };
    if (typeof ring.r1 === 'number') ring.r1 *= k;
    else sw.o.reach *= k;
    amplifySwing(sw, WHET_EDGE * power);
    // a steel glint runs out to the lengthened tip
    if (sw.o.arc < Math.PI * 1.9 || sw.o.thrust) {
      const R = swingReach(sw);
      const tx = sw.x + Math.cos(sw.o.angle) * R;
      const ty = sw.y + Math.sin(sw.o.angle) * R;
      w.particles.burst(tx, ty, { count: 3, speed: [20, 60], angle: sw.o.angle, spread: 0.8, life: [0.08, 0.16], colors: ['#ffffff', '#e8f4ff', '#a8c0d8'], shape: 'spark', size: [1, 2] });
    }
    proc(w, 'whetstone_chip', true);
  },
});

// ====================================================================== 박자 칼집 (common, clockwork)
const BRASS = ['#5a3a18', '#8a6028', '#c89848', '#f0d080', '#fff4c0'];

defineDrawnSprite('icon_rhythm_scabbard', 16, 16, (p) => {
  // a fat leather sheath from the brass chape (bottom-left) to the brass throat, the hilt out top-right
  p.poly([0.7, 12.7, 8.2, 5.2, 10.8, 7.8, 3.3, 15.3], '#6a2c3e');
  p.line(1, 13, 8, 6, '#9a4a5c');
  p.line(2, 13, 8, 7, '#7e3a4c');
  p.line(3, 15, 10, 8, '#3e1424');
  p.poly([0, 15.6, 0.6, 12.6, 3.4, 15.4], BRASS[2]);
  p.px(1, 14, BRASS[4]);
  p.px(1, 13, BRASS[3]);
  p.poly([7.4, 5.4, 9, 3.8, 12.2, 7, 10.6, 8.6], BRASS[2]);
  p.line(8, 5, 10, 7, BRASS[3]);
  p.line(9, 4, 11, 6, BRASS[4]);
  p.px(11, 8, BRASS[0]);
  // wrapped grip and pommel
  p.poly([10.4, 4.6, 13.4, 1.6, 14.4, 2.6, 11.4, 5.6], '#3a2238');
  p.px(11, 4, '#6a4a68');
  p.px(13, 2, '#6a4a68');
  p.circle(14.6, 1.4, 1.2, BRASS[2]);
  p.px(14, 1, BRASS[4]);
  // three beat studs on the sheath: two dull, the third lit with tick flashes
  p.rect(2, 11, 2, 2, BRASS[1]);
  p.px(2, 11, BRASS[2]);
  p.rect(4, 9, 2, 2, BRASS[1]);
  p.px(4, 9, BRASS[2]);
  p.rect(6, 7, 2, 2, BRASS[4]);
  p.px(6, 7, '#ffffff');
  p.px(7, 8, BRASS[3]);
  // the lit stud ticks: short flashes perpendicular to the sheath
  p.px(4, 5, BRASS[4]);
  p.px(5, 6, BRASS[3]);
  p.px(9, 10, BRASS[3]);
  p.px(10, 11, BRASS[4]);
}, { outline: O });

defineDrawnSprite('fx_beat_pip', 3, 3, (p) => {
  p.px(1, 0, '#fff4c0');
  p.px(0, 1, '#f0d080');
  p.px(1, 1, '#ffffff');
  p.px(2, 1, '#f0d080');
  p.px(1, 2, '#c89848');
});
defineDrawnSprite('fx_beat_pip_off', 3, 3, (p) => {
  p.px(1, 0, '#8a6028');
  p.px(0, 1, '#5a3a18');
  p.px(1, 1, '#c89848');
  p.px(2, 1, '#5a3a18');
  p.px(1, 2, '#5a3a18');
});

/** Beat counter of the current cycle (1 .. BEAT_EVERY-1, 0 right after the beat). */
function beatCount(w: World): number {
  return w.vars.__beatN ?? 0;
}

/** One flourish per strong beat: a brass tick ring, sparks along the cut and a clock tick. */
function beatFlourish(w: World, x: number, y: number, angle: number): void {
  if (w.vars.__beatFx === w.vars.__beatAt) return;
  w.vars.__beatFx = w.vars.__beatAt;
  const p = w.player;
  w.spawn(new RingFx(p.x, p.y - 6, 20, 0.22, '#f0d080', 2));
  w.particles.burst(x, y, {
    count: 8, speed: [40, 120], angle, spread: 1.2, life: [0.12, 0.26], colors: ['#ffffff', '#fff4c0', '#f0d080', '#c89848'], shape: 'spark', size: [1, 2], additive: true,
  });
  w.sfx('clock_tick', { vol: 0.55, pitch: fx.range(1.25, 1.4) });
  w.sfx('clock_chime', { vol: 0.18, pitch: 1.6 });
  proc(w, 'rhythm_scabbard');
}

defineArtifact({
  id: 'rhythm_scabbard',
  name: '박자 칼집',
  desc: '근접 무기: 3번째 공격마다 피해 +30%, 넉백 +60%',
  detail: '근접 무기(거인의 대검 포함)의 공격만 센다. 원거리·광선 공격은 세지 않고, 방에 들어가면 처음부터 다시 센다. 세 번째 공격의 휘두르기와 근접 일격(질주 베기·충격파 등)이 모두 강해진다. 강타는 금빛 궤적과 째깍 소리로, 박자는 발밑의 눈금 세 칸으로 보인다. 중복 시 피해 보너스가 더해진다.',
  quote: '하나, 둘, 베어라.',
  rarity: 'common',
  tags: ['clockwork'],
  icon: 'icon_rhythm_scabbard',
  look: { aura: '#e0b860', hit: '#fff0b8' },
  pools: ['treasure', 'shop'],
  onAttack(w) {
    if (!holdsSwingWeapon(w) || w.player.dashing) return;
    const n = (beatCount(w) + 1) % BEAT_EVERY;
    w.vars.__beatN = n;
    w.vars.__beatAt = w.time;
    // the beat covers every swing of this one attack (wind-ups, ring echoes), not the next attack
    w.vars.__beatOn = n === 0 ? w.time + 0.3 : -1;
  },
  onSwing(w, sw, power) {
    if ((w.vars.__beatOn ?? -1) < w.time || !weaponSwing(w, sw)) return;
    amplifySwing(sw, BEAT_BONUS * power);
    sw.o.knockback *= BEAT_KNOCK;
    sw.o.hitKick = Math.max(sw.o.hitKick, 2.2);
    if (sw.o.style !== 'none') sw.o.color = '#fff0b8';
    const R = Math.min(swingReach(sw), 48);
    beatFlourish(w, sw.x + Math.cos(sw.o.angle) * R * 0.6, sw.y + Math.sin(sw.o.angle) * R * 0.6, sw.o.angle);
  },
  modifyHit(w, t, hit, power) {
    // melee strikes of the beat attack that are not swings (an iai dash cut, a hammer's shockwave)
    if ((w.vars.__beatOn ?? -1) < w.time || hit.kind !== 'melee' || !isPrimary(hit) || hit.source instanceof MeleeSwing || !holdsSwingWeapon(w)) return;
    amplify(hit, BEAT_BONUS * power);
    hit.knockback = (hit.knockback ?? 0) * BEAT_KNOCK;
    beatFlourish(w, t.x, t.y - t.z - 4, Math.atan2(hit.dirY ?? 0, hit.dirX ?? 1));
  },
  onRoomEnter(w) {
    w.vars.__beatN = 0;
    w.vars.__beatOn = -1;
    w.vars.__beatAt = -99;
  },
  draw(w, r) {
    const p = w.player;
    if (!p.alive || p.fall > 0 || !holdsSwingWeapon(w)) return;
    const since = w.time - (w.vars.__beatAt ?? -99);
    if (since > 1.6) return;
    const n = beatCount(w);
    const fade = since < 1.2 ? 1 : 1 - (since - 1.2) / 0.4;
    // three pips under the feet: lit for the beats so far, all three flash on the strong beat
    for (let i = 0; i < BEAT_EVERY; i++) {
      const on = n === 0 || i < n;
      const pop = n === 0 && since < 0.2 ? 1 + (1 - since / 0.2) * 0.8 : 1;
      r.sprite(on ? 'fx_beat_pip' : 'fx_beat_pip_off', p.x + (i - 1) * 5, p.y + 9, { sx: pop, sy: pop, alpha: fade * (on ? 1 : 0.7) });
    }
  },
});

// ====================================================================== 되받는 날 (rare, frost)
const ICE = ['#2a6a9a', '#4aa0d8', '#8fd8f8', '#d8f6ff', '#ffffff'];

defineDrawnSprite('icon_riposte_edge', 16, 16, (p) => {
  // short ice sabre from the bottom-left grip to the top-right tip
  p.poly([4, 11, 13, 2, 15.5, 0.5, 14, 3.5, 5.5, 12.5], ICE[1]);
  p.poly([4, 11, 13, 2, 15.5, 0.5, 4.8, 11.8], ICE[2]);
  p.line(5, 11, 14, 2, ICE[3]);
  p.line(6, 12, 13, 5, ICE[0]);
  p.px(15, 0, ICE[4]);
  p.px(13, 2, ICE[4]);
  // guard and grip
  p.line(2, 10, 6, 14, '#7080a0');
  p.line(3, 10, 6, 13, '#c0cce0');
  p.line(0, 15, 3, 12, '#2a3048');
  p.px(1, 14, '#5a6480');
  // the U-turn: a bullet struck at the edge curls back out as a frost shard
  for (const [x, y] of [[4, 1], [5, 1], [6, 1], [3, 2], [2, 3], [2, 4], [2, 5], [3, 6], [4, 7], [5, 7], [6, 7]]) p.px(x, y, ICE[2]);
  for (const [x, y] of [[4, 2], [5, 2], [3, 3], [3, 4], [3, 5], [4, 6], [5, 6]]) p.px(x, y, ICE[4]);
  p.px(6, 2, ICE[3]);
  p.px(6, 6, ICE[3]);
  p.poly([7, -0.5, 10.5, 1.5, 7, 3.5], ICE[3]);
  p.line(7, 1, 9, 1, '#ffffff');
  p.px(7, 2, ICE[1]);
  // the clash spark on the edge
  p.px(8, 7, '#ffffff');
  p.px(9, 6, '#ffe8a0');
  p.px(8, 6, '#fff8e0');
  p.px(7, 7, '#fff8e0');
}, { outline: '#0c1830' });

defineDrawnSprite('proj_riposte', 11, 5, (p) => {
  p.poly([0, 2.5, 4, 0.5, 11, 2.5, 4, 4.5], ICE[2]);
  p.poly([2, 2.5, 5, 1.2, 10, 2.5], ICE[3]);
  p.line(3, 2, 9, 2, '#ffffff');
  p.px(1, 2, ICE[1]);
  p.px(2, 3, ICE[0]);
}, { outline: '#10284a' });

/** Frost-blade look of a returned bullet: icy sparkles behind it and a soft glow (cosmetic only). */
const riposteFx: ProjBehavior = {
  id: 'riposte-fx',
  update(p, w) {
    if (fx.chance(0.6)) w.particles.spawn({ x: p.x + fx.range(-1, 1), y: p.y - p.z + fx.range(-1, 1), vx: fx.range(-6, 6), vy: fx.range(2, 10), life: 0.3, colors: ['#ffffff', ICE[3], ICE[2]], size: 1, shape: 'square', vrot: 6 });
  },
  draw(p, r) {
    r.sprite(lookGlow(14, ICE[2]), p.x, p.y - p.z, { additive: true, alpha: 0.45 });
  },
};

/** Spend from a refilling per-second budget kept in w.vars (deterministic); returns true if it allowed `cost`. */
function spendBudget(w: World, key: string, cap: number, cost: number): boolean {
  const kv = `__bud_${key}`;
  const kt = `__budT_${key}`;
  const last = w.vars[kt] ?? -99;
  const have = Math.min(cap, (w.vars[kv] ?? cap) + Math.max(0, w.time - last) * cap);
  w.vars[kt] = w.time;
  if (have < cost) {
    w.vars[kv] = have;
    return false;
  }
  w.vars[kv] = have - cost;
  return true;
}

/** Where a returned blade flies: back at its shooter when it is in front of the swing, else outward along the aim. */
function riposteAngle(w: World, pr: Projectile): number {
  const pl = w.player;
  const out = angleTo(pl.x, pl.y - 3, pr.x, pr.y);
  const base = pl.aim + angleDiff(pl.aim, out) * 0.35;
  const shooter = pr.owner;
  if (shooter instanceof Enemy && shooter.alive && !shooter.hidden && shooter.vulnerable) {
    const at = angleTo(pr.x, pr.y, shooter.x, shooter.y - shooter.z * 0.3);
    if (Math.abs(angleDiff(base, at)) < 1.1) return at;
  }
  return base;
}

function riposteLook(pr: Projectile): void {
  pr.mem.riposte = 1;
  pr.color = ICE[3];
  pr.lightR = 16;
  pr.look = null;
  if (pr.style !== 'none') {
    pr.style = 'sprite';
    pr.sprite = 'proj_riposte';
    pr.spriteRotates = true;
    pr.scale = 1;
  }
  pr.addBehavior(riposteFx);
}

defineArtifact({
  id: 'riposte_edge',
  name: '되받는 날',
  desc: '근접 무기: 쳐낸 적탄을 되받아친다. 해방 게이지 +2',
  detail: '근접 무기의 휘두르기나 방패로 쳐낸 적 탄환이 서리 칼날이 되어 쏜 적에게 되돌아간다(공격력의 50%, 초당 최대 2발). 원래 탄환을 되돌리는 무기는 되돌린 탄환이 서리 칼날이 되어 최소 그만큼 강해진다. 쳐낼 때마다 해방 게이지 +2(보스 탄환 +1, 초당 최대 +3). 되돌아간 칼날은 다른 유물 효과나 게이지 충전을 일으키지 않는다. 중복 시 칼날 피해 +30%p씩.',
  quote: '받은 것은 돌려준다. 조금 더 차갑게.',
  rarity: 'rare',
  tags: ['frost'],
  icon: 'icon_riposte_edge',
  look: { mote: '#bff0ff', hit: '#9fe8ff' },
  pools: ['treasure', 'shop', 'challenge'],
  onDeflect(w, pr, power) {
    // weapon deflects only: a character's dash counter (made mid-dash) is left alone
    if (!holdsSwingWeapon(w) || w.player.dashing || pr.mem.riposte) return;
    const pl = w.player;
    // a boss's bullets charge at half rate (bosses fill the gauge at half rate everywhere)
    const ember = RIPOSTE_EMBER * (pr.owner instanceof Enemy && pr.owner.isBoss ? 0.5 : 1);
    if (spendBudget(w, 'riposte_ember', RIPOSTE_EMBER_CAP, ember)) pl.addEmber(ember);
    const dmg = pl.stats.damage * RIPOSTE_DMG * (1 + RIPOSTE_DMG_COPY * (power - 1));
    if (pr.team === 'player' && !pr.dead && pr.generation >= 1) {
      // the weapon already sent it back (a reflecting blade, the mirror shield): it becomes a frost blade, at least this strong
      pr.damage = Math.max(pr.damage, dmg);
      riposteLook(pr);
    } else if (pr.team === 'enemy') {
      // at most RIPOSTE_SHOTS_CAP blades per second, and never faster than the keeper's own cadence
      if (!spendBudget(w, 'riposte_shots', clamp(pl.stats.fireRate, 1, RIPOSTE_SHOTS_CAP), 1)) return;
      const a = riposteAngle(w, pr);
      const s = new Projectile({
        team: 'player', x: pr.x, y: pr.y, angle: a, speed: 290, damage: dmg, radius: 3, range: 300, life: 2.5,
        owner: pl, pierce: 0, knockback: 80, color: ICE[3], style: 'sprite', sprite: 'proj_riposte', light: 16,
      });
      // a returned bullet never starts another item proc chain
      s.generation = 1;
      riposteLook(s);
      w.spawn(s);
    } else return;
    w.particles.burst(pr.x, pr.y - pr.z, { count: 7, speed: [40, 120], life: [0.12, 0.3], colors: ['#ffffff', ICE[3], ICE[2]], shape: 'spark', size: [1, 2], additive: true });
    w.sfx('freeze', { vol: 0.22, pitch: fx.range(1.5, 1.8) });
    proc(w, 'riposte_edge');
  },
});

// ====================================================================== 창끝 별 (rare, star)
defineDrawnSprite('icon_spear_tip', 16, 16, (p) => {
  // a broad leaf spearhead pointing up-right on a short shaft
  p.line(0, 15, 3, 12, '#6a4428');
  p.line(1, 15, 4, 12, '#9a6a3c');
  const pts: number[] = [];
  const W = [1.1, 2.4, 3, 2.9, 2.5, 2, 1.5, 1, 0.2];
  for (let i = 0; i < W.length; i++) pts.push(4.6 + i * 1.1 + W[i] * 0.707, 11.4 - i * 1.1 + W[i] * 0.707);
  for (let i = W.length - 1; i >= 0; i--) pts.push(4.6 + i * 1.1 - W[i] * 0.707, 11.4 - i * 1.1 - W[i] * 0.707);
  p.poly(pts, '#7a84a4');
  // lit upper-left half, shaded lower-right half, bright ridge
  const lit: number[] = [];
  for (let i = 0; i < W.length; i++) lit.push(4.6 + i * 1.1, 11.4 - i * 1.1);
  for (let i = W.length - 1; i >= 0; i--) lit.push(4.6 + i * 1.1 - W[i] * 0.707, 11.4 - i * 1.1 - W[i] * 0.707);
  p.poly(lit, '#c4cce0');
  p.line(5, 11, 13, 3, '#ffffff');
  p.line(6, 12, 12, 6, '#5a6280');
  p.px(5, 8, '#e8eef8');
  p.px(7, 6, '#e8eef8');
  // bronze socket and a lavender tassel
  p.poly([2.6, 11.4, 4.6, 9.4, 6.6, 11.4, 4.6, 13.4], '#c89848');
  p.line(3, 11, 5, 9, '#f0d080');
  p.px(5, 12, '#8a6028');
  p.line(3, 13, 2, 15, '#b8a8ff');
  p.line(4, 13, 4, 15, '#8a70d8');
  // the star blazing at the point
  p.poly([13.5, 0, 14.3, 1.7, 16, 2.5, 14.3, 3.3, 13.5, 5, 12.7, 3.3, 11, 2.5, 12.7, 1.7], '#ffd84a');
  p.px(13, 2, '#ffffff');
  p.px(13, 1, '#fffbe0');
  p.px(12, 2, '#fffbe0');
  p.px(14, 2, '#fff4b0');
  p.px(13, 3, '#fff4b0');
  p.px(10, 1, '#fff2b0');
  p.px(15, 6, '#d8c8ff');
}, { outline: '#141030' });

defineDrawnSprite('fx_tip_star', 13, 13, (p) => {
  p.poly([6.5, 0, 7.7, 5.3, 13, 6.5, 7.7, 7.7, 6.5, 13, 5.3, 7.7, 0, 6.5, 5.3, 5.3], '#ffc830');
  p.poly([6.5, 2, 7.2, 5.8, 11, 6.5, 7.2, 7.2, 6.5, 11, 5.8, 7.2, 2, 6.5, 5.8, 5.8], '#fff0a0');
  p.rect(6, 5, 1, 3, '#ffffff');
  p.rect(5, 6, 3, 1, '#ffffff');
  p.px(4, 4, '#fff8d0');
  p.px(8, 8, '#fff8d0');
  p.px(8, 4, '#fff8d0');
  p.px(4, 8, '#fff8d0');
}, { outline: '#3a2408' });

const TIP_FX = 0.36;

/** Gold star that pops where a sweet-spot hit lands (purely visual). */
class TipStarFx extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  private rot = fx.range(-0.4, 0.4);
  private big: boolean;
  constructor(x: number, y: number, big: boolean) {
    super();
    this.x = x;
    this.y = y;
    this.big = big;
    this.layer = 3;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    this.y -= 12 * dt;
    this.rot += 4 * dt;
    if (this.age > TIP_FX) this.dead = true;
  }

  override draw(r: Renderer): void {
    const t = this.age / TIP_FX;
    const k = this.big ? 1.35 : 1.1;
    // pops in large, settles, then shrinks away
    const s = k * (t < 0.15 ? 0.6 + t * 4 : t < 0.5 ? 1.2 - (t - 0.15) * 0.6 : 0.99 - (t - 0.5) * 1.2);
    r.sprite(lookGlow(18, '#ffd84a'), this.x, this.y, { additive: true, alpha: 0.6 * (1 - t) });
    r.sprite('fx_tip_star', this.x, this.y, { rot: this.rot, sx: s, sy: s, alpha: t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35 });
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y, 26 * (1 - this.age / TIP_FX), '#ffd84a', { intensity: 0.85 });
  }
}

/** swings of the held melee weapon, taken when they are made (hits read them in modifyHit) */
const tipSwings = new WeakSet<MeleeSwing>();

/** Is `t` in the outer part of the swing's reach? Arcs measure the distance, thrusts the depth along the thrust. */
export function inSweetSpot(sw: MeleeSwing, t: Actor): boolean {
  const R = swingReach(sw);
  const ty = t.y - t.z * 0.5;
  const dx = t.x - sw.x;
  const dy = ty - sw.y;
  const d = sw.o.thrust ? dx * Math.cos(sw.o.angle) + dy * Math.sin(sw.o.angle) : Math.hypot(dx, dy);
  return d + t.r * 0.5 >= R * (1 - TIP_ZONE);
}

defineArtifact({
  id: 'spear_tip',
  name: '창끝 별',
  desc: '근접 무기: 끝부분 적중 시 피해 +15%, 치명타 +10%',
  detail: '근접 무기의 휘두르기·찌르기가 사거리 바깥 35% 안에서 적을 맞히면 발동한다(공명 종은 고리가 가장 크게 퍼진 반경 기준). 금빛 별이 튀면 성공. 해방·캐릭터 기술·다른 유물의 베기에는 적용되지 않는다. 중복 시 피해 보너스가 더해지고 치명타 확률은 조금씩 덜 오른다.',
  quote: '창은 끝에서 빛난다.',
  rarity: 'rare',
  tags: ['star'],
  icon: 'icon_spear_tip',
  look: { mote: '#ffe890', hit: '#ffd84a' },
  pools: ['treasure', 'shop', 'shrine'],
  onSwing(w, sw) {
    if (weaponSwing(w, sw)) tipSwings.add(sw);
  },
  modifyHit(w, t, hit, power) {
    const sw = hit.source;
    if (!(sw instanceof MeleeSwing) || hit.noProc || hit.kind !== 'melee' || !tipSwings.has(sw) || !inSweetSpot(sw, t)) return;
    amplify(hit, TIP_BONUS * power);
    // the damage bonus adds up per copy, the crit chance grows with stackMul: three copies stay about linear
    const crit = !hit.crit && w.rng.chance(clamp(TIP_CRIT * stackMul(power), 0, 0.95));
    if (crit) {
      hit.crit = true;
      hit.damage *= w.player.stats.critMult;
    }
    const sy = t.y - t.z - t.r - 3;
    w.spawn(new TipStarFx(t.x, sy, crit));
    w.particles.burst(t.x, sy, { count: crit ? 7 : 4, speed: [40, 110], life: [0.12, 0.28], colors: ['#ffffff', '#fff0a0', '#ffc830'], shape: 'spark', size: [1, 2], additive: true });
    w.sfx('hit_metal', { vol: 0.22, pitch: fx.range(1.9, 2.2) });
    proc(w, 'spear_tip');
  },
});

// ====================================================================== 손에 익은 끈 (common, shadow)
const VIO = ['#1a0c38', '#3a1a70', '#6a3ad0', '#9a6aff', '#d0b8ff'];
const GRIP_COLOR = '#c9a0ff';

defineDrawnSprite('icon_grip_wrap', 16, 16, (p) => {
  // an upright hilt: blade stub, brass guard, violet criss-cross wrap, steel pommel
  p.rect(7, 0, 2, 3, '#c8d0e4');
  p.px(7, 0, '#ffffff');
  p.px(7, 1, '#ffffff');
  p.rect(4, 3, 8, 2, '#c8a060');
  p.line(4, 3, 11, 3, '#f0d890');
  p.px(11, 4, '#8a6a3a');
  p.rect(6, 5, 4, 7, VIO[2]);
  for (let y = 5; y < 12; y += 2) {
    p.px(6, y, VIO[4]);
    p.px(7, y + 1, VIO[3]);
    p.px(8, y, VIO[3]);
    p.px(9, y + 1, VIO[1]);
  }
  p.line(6, 5, 6, 11, VIO[3]);
  p.line(9, 5, 9, 11, VIO[1]);
  p.circle(8, 13, 2, '#8a8aa0');
  p.px(7, 12, '#e0e0f0');
  p.px(9, 14, '#4a4a5a');
  // two loose ribbon tails curling around the hilt like swap arrows
  p.line(10, 12, 12, 13, VIO[3]);
  p.line(12, 13, 13, 12, VIO[3]);
  p.line(13, 12, 13, 8, VIO[3]);
  p.line(14, 12, 14, 9, VIO[2]);
  p.poly([11.5, 8.5, 13.5, 5.5, 15.5, 8.5], VIO[4]);
  p.line(5, 6, 3, 5, VIO[3]);
  p.line(3, 5, 2, 6, VIO[3]);
  p.line(2, 6, 2, 9, VIO[3]);
  p.line(1, 6, 1, 8, VIO[2]);
  p.poly([0.5, 8.5, 2.5, 11.5, 4.5, 8.5], VIO[4]);
}, { outline: '#0c0418' });

/** The armed bonus glows on a shot: a soft violet halo (cosmetic only). */
const gripGlow: ProjBehavior = {
  id: 'grip-glow',
  draw(p, r) {
    r.sprite(lookGlow(16, GRIP_COLOR), p.x, p.y - p.z, { additive: true, alpha: 0.55 });
  },
};

/** True while the next attack would still get the swap bonus. */
function gripArmed(w: World): boolean {
  const p = w.player;
  const at = p.swapAt;
  // a quick double swap back to the weapon that just had the bonus does not re-arm it
  return at > (w.vars.__gripUsed ?? -99) && w.time - at <= GRIP_AFTER_SWAP && w.time >= (w.vars.__gripNext ?? 0)
    && weaponIndex(p.weaponId) !== (w.vars.__gripWeapon ?? -1);
}

/** Registry position of a weapon (a number, so it can live in w.vars). */
function weaponIndex(id: string): number {
  return Weapons.all().findIndex((d) => d.id === id);
}

/** The swap bonus window of the attack that consumed it is open. */
function gripOn(w: World): boolean {
  return (w.vars.__gripOn ?? -1) >= w.time;
}

defineArtifact({
  id: 'grip_wrap',
  name: '손에 익은 끈',
  desc: '모든 무기: 무기를 바꾼 직후 첫 공격 피해 +40%',
  detail: '무기를 바꾸거나 새로 집은 뒤 2초 안에 시작한 첫 공격에 적용된다(발동 간격 1.5초, 간격 안의 첫 공격은 보너스 없이 지나간다). 방금 보너스를 받은 무기로 곧장 되돌아오면 발동하지 않는다. 탄환·휘두르기는 그 공격 한 번, 광선은 0.6초 동안의 적중이 강해진다. 다른 유물이 만든 탄환·베기에는 적용되지 않는다. 중복 시 보너스가 더해진다.',
  quote: '익숙한 손잡이는 망설이지 않는다.',
  rarity: 'common',
  tags: ['shadow'],
  icon: 'icon_grip_wrap',
  look: { step: '#b48aff', hit: GRIP_COLOR },
  pools: ['treasure', 'shop'],
  onAttack(w) {
    const beamOpen = gripOn(w) && w.vars.__gripBeam === 1;
    if (!beamOpen) w.vars.__gripOn = -1;
    const p = w.player;
    // the first attack after a swap uses the swap up, whether or not the bonus was ready
    const armed = gripArmed(w);
    if (p.swapAt > (w.vars.__gripUsed ?? -99)) w.vars.__gripUsed = p.swapAt;
    if (!armed) return;
    const beam = Weapons.get(p.weaponId)?.kind === 'beam';
    w.vars.__gripWeapon = weaponIndex(p.weaponId);
    w.vars.__gripNext = w.time + GRIP_CD;
    w.vars.__gripOn = w.time + (beam ? GRIP_BEAM : GRIP_SHOT);
    w.vars.__gripBeam = beam ? 1 : 0;
    // the wrap snaps tight: a violet ribbon burst at the weapon hand
    const h = visualHandPos(p, p.aim, 8);
    w.particles.burst(h.x, h.y, { count: 10, speed: [30, 100], angle: p.aim, spread: 1.6, life: [0.15, 0.35], colors: ['#ffffff', VIO[4], GRIP_COLOR, VIO[2]], shape: 'spark', size: [1, 2], additive: true });
    w.spawn(new RingFx(h.x, h.y, 12, 0.2, GRIP_COLOR, 2));
    w.sfx('whoosh', { vol: 0.35, pitch: fx.range(1.4, 1.6) });
    w.sfx('hit_metal', { vol: 0.16, pitch: 2.2 });
    proc(w, 'grip_wrap');
  },
  onShoot(w, pr, power) {
    if (!gripOn(w) || w.vars.__gripBeam === 1 || pr.generation > 0 || !pr.fromWeapon) return;
    amplifyShot(pr, GRIP_BONUS * power);
    pr.color = GRIP_COLOR;
    pr.scale = Math.max(pr.scale, 1.2);
    pr.addBehavior(gripGlow);
  },
  onSwing(w, sw, power) {
    if (!gripOn(w) || w.vars.__gripBeam === 1 || sw.owner !== w.player || sw.o.noProc || sw.o.release || w.player.dashing) return;
    amplifySwing(sw, GRIP_BONUS * power);
    if (sw.o.style !== 'none') sw.o.color = GRIP_COLOR;
  },
  modifyHit(w, t, hit: HitInfo, power) {
    // beam ticks and other direct weapon hits that carry no shot / swing of their own
    if (!gripOn(w) || !isPrimary(hit) || hit.source instanceof Projectile || hit.source instanceof MeleeSwing) return;
    amplify(hit, GRIP_BONUS * power);
    if (fx.chance(0.5)) w.particles.burst(t.x, t.y - t.z - 4, { count: 3, speed: [30, 80], life: [0.1, 0.22], colors: ['#ffffff', GRIP_COLOR], shape: 'spark', size: [1, 2], additive: true });
  },
  draw(w, r) {
    const p = w.player;
    if (!p.alive || p.fall > 0 || !p.weapon2Id || !gripArmed(w)) return;
    // armed: two violet ribbon tails flutter from the weapon hand
    const h = visualHandPos(p, p.aim, 7);
    const back = p.aim + Math.PI;
    const t = w.time * 9;
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      let x = h.x;
      let y = h.y;
      for (let k = 1; k <= 3; k++) {
        const wave = Math.sin(t + k * 1.3 + i * 2) * 1.6 * k * 0.5;
        const nx = h.x + Math.cos(back + side * 0.45) * k * 3 + Math.cos(back + Math.PI / 2) * wave;
        const ny = h.y + Math.sin(back + side * 0.45) * k * 3 + Math.sin(back + Math.PI / 2) * wave + k * 0.6;
        r.line(x, y, nx, ny, k === 1 ? VIO[4] : GRIP_COLOR, 1, clamp(1.1 - k * 0.25, 0.3, 1));
        x = nx;
        y = ny;
      }
    }
  },
});
