// 회오리 · 검기 (melee II + cross-type) artifacts for play styles beyond plain shots:
//  - 회오리 손잡이 (whirl_grip): every few swing hits, the next swing whirls 360°.
//  - 하늘 가르는 칼집 (skysplit_sheath): swings throw a piercing crescent wave (melee reach).
//  - 장인의 줄 (craftsman_file): whets the weapons that fire no plain shots (melee / beam / charge).
//  - 교차 문장 (cross_crest): mark with one weapon, swap, strike with the other: a cross burst.
//  - 강철 맥박 (steel_pulse): melee / charge hits store pulses; a dash spends them on its path.
// Every effect only works with the weapon types it names and does nothing (never a
// penalty) with the others.

import { defineArtifact, Weapons, type WeaponDef } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { Entity, type HitInfo } from '../../game/entity';
import { Enemy } from '../../game/enemy';
import { MeleeSwing } from '../../game/melee';
import { Projectile, type ProjBehavior } from '../../game/projectile';
import { RingFx } from '../../game/effects';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import { fx } from '../../engine/rng';
import { TAU, clamp } from '../../engine/math';
import { effectProc } from '../../game/procs';
import { lookGlow } from '../../game/look';
import { O, ZapFx, amplify, amplifyShot, amplifySwing, cooldown, enemiesNear, isPrimary, itemHit, proc, stackMul } from './lib';

const dmg = (w: World) => w.player.stats.damage;

// ====================================================================== weapon classes
type WeaponKind = WeaponDef['kind'];
const KIND_CODE: Record<WeaponKind, number> = { ranged: 1, melee: 2, charge: 3, beam: 4 };

function heldDef(w: World): WeaponDef | undefined {
  return Weapons.get(w.player.weaponId);
}

/** The held weapon swings a blade: melee weapons and the charged greatsword (a 'charge' blade). */
export function swingsBlade(w: World): boolean {
  const d = heldDef(w);
  return !!d && (d.kind === 'melee' || (d.kind === 'charge' && !!d.tags?.includes('blade')));
}

/** A primary hit dealt by a weapon swing (not by a kit release, reflection or item effect). */
function swingHit(hit: HitInfo): boolean {
  return hit.kind === 'melee' && hit.source instanceof MeleeSwing && !hit.release && isPrimary(hit);
}

// ====================================================================== 회오리 손잡이 (whirl_grip)
const WIND = ['#1c3a5c', '#3a78a8', '#78c4e8', '#c8f0ff', '#ffffff'];
/** Item bonus of the whirl swing (rides in the swing's bonus pool); a thrust turned whirl gets less (it gains the most reach). */
export const WHIRL_AMP = 1.1;
export const WHIRL_THRUST_AMP = 0.9;
/** At most this many hits of one swing count toward the next whirl (a crowd does not chain whirls). */
const WHIRL_COUNT_CAP = 1;
/** Swing hits needed for a whirl: 4 / 3 / 2 with copies. */
export function whirlNeed(power: number): number {
  return Math.max(2, 5 - Math.max(1, power));
}
const whirls = new WeakSet<MeleeSwing>();
const whirlCounted = new WeakMap<MeleeSwing, number>();

defineDrawnSprite('icon_whirl_grip', 16, 16, (p) => {
  // a two-armed whirlwind spiral behind the hilt
  for (let arm = 0; arm < 2; arm++) {
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const r = 1.5 + t * 6.4;
      const a = arm * Math.PI + t * TAU * 0.95 - 0.6;
      const x = Math.round(7.8 + Math.cos(a) * r);
      const y = Math.round(8 + Math.sin(a) * r * 0.92);
      p.px(x, y, t < 0.3 ? WIND[4] : t < 0.6 ? WIND[3] : t < 0.85 ? WIND[2] : WIND[1]);
    }
  }
  // blade stub
  for (let k = 0; k < 3; k++) {
    p.px(12 + k, 3 - k, '#e8eef8');
    p.px(13 + k, 3 - k, '#8a94b0');
  }
  p.px(15, 0, '#ffffff');
  // gold crossguard, square to the grip
  for (let k = -2; k <= 2; k++) {
    p.px(10 + k, 4 + k, '#e0a840');
    p.px(11 + k, 4 + k, '#8a5a18');
  }
  p.px(8, 2, '#ffe08a');
  p.px(9, 3, '#ffe08a');
  // leather-wrapped grip (diamond wrap)
  for (let k = 0; k < 6; k++) {
    p.px(4 + k, 11 - k, k % 2 ? '#6a3a20' : '#c88a50');
    p.px(5 + k, 11 - k, k % 2 ? '#a86a3c' : '#5a2e18');
  }
  // gold pommel with a wind-blue gem
  p.circle(3, 12.6, 2, '#c08830');
  p.px(2, 12, '#ffe08a');
  p.px(3, 13, WIND[2]);
  p.px(3, 12, WIND[4]);
  p.px(4, 14, '#6a4010');
}, { outline: O });

/** Full-turn wind streaks around the keeper while a whirl swing plays (cosmetic). */
class WhirlFx extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  constructor(readonly owner: Player, readonly reach: number, readonly dir: number) {
    super();
    this.layer = 2;
    this.tileCollide = false;
    this.x = owner.x;
    this.y = owner.y - 3;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    this.x = this.owner.x;
    this.y = this.owner.y - 3;
    if (this.age >= 0.3) this.dead = true;
  }

  override draw(r: Renderer): void {
    const t = this.age / 0.3;
    const a = 1 - t;
    const R = this.reach * (0.75 + 0.3 * t);
    const spin = this.dir * (this.age * 26);
    for (let k = 0; k < 3; k++) {
      const base = spin + (k / 3) * TAU;
      let px = this.x + Math.cos(base) * R;
      let py = this.y + Math.sin(base) * R * 0.78;
      for (let s = 1; s <= 6; s++) {
        const ang = base - this.dir * s * 0.16;
        const rr = R - s * 0.6;
        const nx = this.x + Math.cos(ang) * rr;
        const ny = this.y + Math.sin(ang) * rr * 0.78;
        r.pixelLine(px, py, nx, ny, s <= 2 ? WIND[4] : s <= 4 ? WIND[3] : WIND[2], s <= 2 ? 2 : 1, a * (1 - s * 0.1));
        px = nx;
        py = ny;
      }
    }
    r.pixelRing(this.x, this.y, R * 0.55, WIND[2], 1, 0.35 * a);
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y, this.reach * 1.4 * (1 - this.age / 0.3), '#a8e0ff', { intensity: 0.45 });
  }
}

defineArtifact({
  id: 'whirl_grip',
  name: '회오리 손잡이',
  desc: '근접 무기로 네 번 맞힐 때마다 다음 베기가 회전 베기가 된다.',
  quote: '손잡이를 쥐면 바람이 먼저 돈다.',
  rarity: 'epic',
  tags: ['storm'],
  icon: 'icon_whirl_grip',
  look: { mote: '#a8e0ff', step: '#c8f0ff', hit: '#e0f6ff' },
  pools: ['treasure', 'boss', 'challenge'],
  onHit(w, _t, hit, power) {
    if (!swingsBlade(w) || !swingHit(hit) || w.vars.__whirlArmed) return;
    const sw = hit.source as MeleeSwing;
    if (whirls.has(sw)) return;
    const n = whirlCounted.get(sw) ?? 0;
    if (n >= WHIRL_COUNT_CAP) return;
    whirlCounted.set(sw, n + 1);
    w.vars.__whirlN = (w.vars.__whirlN ?? 0) + 1;
    if (w.vars.__whirlN < whirlNeed(power)) return;
    w.vars.__whirlN = 0;
    w.vars.__whirlArmed = 1;
    const p = w.player;
    w.sfx('whoosh', { vol: 0.3, pitch: 1.6 });
    w.particles.burst(p.x, p.y - 6, { count: 8, speed: [30, 70], life: [0.2, 0.4], colors: ['#ffffff', WIND[3], WIND[2]], shape: 'spark', size: [1, 2], additive: true });
    proc(w, 'whirl_grip', true);
  },
  onSwing(w, sw) {
    if (!w.vars.__whirlArmed || !swingsBlade(w)) return;
    w.vars.__whirlArmed = 0;
    w.vars.__whirlN = 0;
    whirls.add(sw);
    // plain swings and thrusts become a full turn; special swing entities (rings) keep their shape
    let amp = WHIRL_AMP;
    if (sw.constructor === MeleeSwing) {
      if (sw.o.thrust) {
        amp = WHIRL_THRUST_AMP;
        sw.o.thrust = false;
        sw.o.reach = Math.max(26, sw.o.reach * 0.7);
      }
      sw.o.arc = TAU;
      sw.o.style = 'smear';
      sw.o.color = WIND[3];
      sw.o.duration = Math.max(sw.o.duration, 0.1);
      sw.o.visual = Math.max(sw.o.visual, 0.22);
    }
    amplifySwing(sw, amp);
    const p = w.player;
    w.spawn(new WhirlFx(p, Math.max(20, sw.o.reach), sw.o.swingDir >= 0 ? 1 : -1));
    w.particles.burst(p.x, p.y - 3, { count: 16, speed: [70, 150], life: [0.15, 0.32], colors: ['#ffffff', WIND[3], WIND[2]], shape: 'spark', size: [1, 2], additive: true, light: 4, lightColor: '#a8e0ff' });
    w.sfx('swing_heavy', { vol: 0.6, pitch: 1.25 });
    w.sfx('whoosh', { vol: 0.5, pitch: 1.1 });
    proc(w, 'whirl_grip');
  },
  onRemove(w) {
    w.vars.__whirlArmed = 0;
    w.vars.__whirlN = 0;
  },
  draw(w, r) {
    // the next swing is a whirl: a little whirlwind spins at the keeper's feet
    if (!w.vars.__whirlArmed || !swingsBlade(w)) return;
    const p = w.player;
    if (!p.alive || p.fall > 0) return;
    const t = w.time;
    // the blade hand glows wind-blue
    r.sprite(lookGlow(22, WIND[2]), p.x + Math.cos(p.aim) * 8, p.y - 6 + Math.sin(p.aim) * 6, { additive: true, alpha: 0.55 + 0.25 * Math.sin(t * 12) });
    for (let k = 0; k < 2; k++) {
      const base = t * 11 + k * Math.PI;
      for (const [rx, ry, dy] of [[12, 5, 1], [9, 3.5, -7]] as const) {
        let px = p.x + Math.cos(base) * rx;
        let py = p.y + dy + Math.sin(base) * ry;
        for (let s = 1; s <= 7; s++) {
          const a = base - s * 0.2;
          const nx = p.x + Math.cos(a) * rx;
          const ny = p.y + dy + Math.sin(a) * ry;
          r.pixelLine(px, py, nx, ny, s <= 1 ? '#ffffff' : s <= 4 ? WIND[3] : WIND[2], s <= 3 ? 2 : 1, 1 - s * 0.1);
          px = nx;
          py = ny;
        }
      }
    }
  },
});

// ====================================================================== 하늘 가르는 칼집 (skysplit_sheath)
const SKY = ['#2a1c5a', '#5a48a8', '#a898e8', '#e8e0ff', '#fff6d8'];
/** Wave damage (x the keeper's damage); inside the blade's own reach it deals half. */
export const SKYSPLIT_DMG = 0.5;
export const SKYSPLIT_RANGE = 2.5;

defineDrawnSprite('icon_skysplit_sheath', 16, 16, (p) => {
  // a crescent wave (검기) cut out of the sky, upper left
  for (let y = 0; y < 11; y++) {
    for (let x = 0; x < 11; x++) {
      const d1 = Math.hypot(x + 0.5 - 4.8, y + 0.5 - 4.8);
      const d2 = Math.hypot(x + 0.5 - 6.9, y + 0.5 - 6.9);
      if (d1 > 4.9 || d2 < 4.6) continue;
      const edge = 4.9 - d1;
      p.px(x, y, edge < 1 ? SKY[4] : edge < 2 ? SKY[3] : SKY[2]);
    }
  }
  p.px(1, 3, '#ffffff');
  p.px(3, 1, '#ffffff');
  // lacquered scabbard on the "/" diagonal: lit edge, lacquer, shadowed edge
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const c = x + y;
      const a = x - y;
      if (c < 15 || c > 18 || a < -15 || a > 1) continue;
      // gold bands at the chape, the middle and the throat
      const band = a === -13 || a === -7 || a === 1;
      p.px(x, y, band ? (c === 15 ? '#ffe08a' : c === 18 ? '#8a5a18' : '#d8a040') : c === 15 ? '#8a78d8' : c === 18 ? SKY[0] : '#4a3a98');
    }
  }
  // stars inlaid on the lacquer
  p.px(4, 12, '#ffe890');
  p.px(7, 10, '#fff6d8');
  // the round gold guard, a sliver of drawn blade and the wrapped grip
  p.px(9, 6, '#ffffff');
  p.px(10, 7, '#d8a040');
  p.px(10, 5, '#ffe08a');
  p.px(11, 6, '#d8a040');
  p.px(10, 6, '#c89030');
  p.px(11, 7, '#8a5a18');
  p.px(9, 5, '#ffe08a');
  for (let k = 0; k < 4; k++) {
    p.px(11 + k, 5 - k, k % 2 ? '#2a1c48' : '#a898e8');
    p.px(12 + k, 5 - k, k % 2 ? '#a898e8' : '#2a1c48');
  }
  p.px(15, 1, '#d8a040');
  p.px(15, 0, '#ffe08a');
  // a star twinkling beside the hilt
  p.px(13, 9, '#ffffff');
  p.px(12, 9, SKY[3]);
  p.px(14, 9, SKY[3]);
  p.px(13, 8, SKY[3]);
  p.px(13, 10, SKY[3]);
}, { outline: '#0c0820' });

// the wave (points right; the convex edge leads): white rim, starlit body, violet trailing edge
defineDrawnSprite('proj_skysplit_wave', 12, 24, (p) => {
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 12; x++) {
      const d1 = Math.hypot(x + 0.5 + 6, y + 0.5 - 12);
      const d2 = Math.hypot(x + 0.5 + 11, y + 0.5 - 12);
      if (d1 >= 17.5 || d2 <= 18) continue;
      const edge = 17.5 - d1;
      const tip = Math.abs(y + 0.5 - 12) / 12;
      p.px(x, y, edge < 1.3 ? (tip < 0.8 ? '#ffffff' : SKY[3]) : edge < 2.6 ? SKY[4] : edge < 3.8 ? SKY[3] : SKY[2]);
    }
  }
  p.px(9, 7, '#ffffff');
  p.px(9, 16, '#ffffff');
  p.px(7, 12, SKY[4]);
}, { outline: '#1a1040', origin: [6, 12] });

/** The wave: half damage while still inside the blade's reach, full beyond it; thins out at the end. */
const WAVE_FLIGHT: ProjBehavior = {
  id: 'skysplit_wave',
  update(pr, w) {
    const k = clamp(pr.traveled / Math.max(1, pr.range), 0, 1);
    pr.scale = Number(pr.mem.scale0 ?? 1) * (k < 0.66 ? 1 : 1 - (k - 0.66) * 0.9);
    pr.damage = Number(pr.mem.full ?? pr.damage) * (pr.traveled <= Number(pr.mem.blade ?? 0) ? 0.5 : 1);
    if (fx.chance(0.7)) {
      const a = pr.angle + Math.PI / 2;
      const off = fx.range(-8, 8) * pr.scale;
      w.particles.spawn({
        x: pr.x + Math.cos(a) * off - Math.cos(pr.angle) * 3, y: pr.y - pr.z + Math.sin(a) * off - Math.sin(pr.angle) * 3,
        vx: -Math.cos(pr.angle) * 30, vy: -Math.sin(pr.angle) * 30, life: 0.22, colors: ['#ffffff', SKY[3], SKY[2]],
        size: fx.chance(0.3) ? 2 : 1, sizeEnd: 0, shape: 'spark', additive: true, rot: fx.angle(),
      });
    }
  },
  onHit(pr, w) {
    if (pr.traveled > Number(pr.mem.blade ?? 0)) proc(w, 'skysplit_sheath');
  },
};

defineArtifact({
  id: 'skysplit_sheath',
  name: '하늘 가르는 칼집',
  desc: '근접 무기를 휘두르면 적을 꿰뚫는 검기가 날아간다.',
  quote: '칼을 뽑기도 전에 하늘이 먼저 갈라졌다.',
  rarity: 'legendary',
  tags: ['star'],
  icon: 'icon_skysplit_sheath',
  look: { aura: '#a898e8', mote: '#e8e0ff', hit: '#fff6d8' },
  pools: ['treasure', 'boss', 'secret'],
  unique: true,
  onSwing(w, sw) {
    if (!swingsBlade(w)) return;
    const pl = w.player;
    // at most the keeper's own cadence, whatever the weapon's attack speed
    if (!cooldown(w, 'skysplit_sheath', 1 / Math.max(0.5, pl.stats.fireRate)) || !effectProc(w, () => true)) return;
    const a = sw.o.angle;
    const reach = Math.max(20, sw.o.reach);
    const full = dmg(w) * SKYSPLIT_DMG;
    const pr = new Projectile({
      team: 'player', x: pl.x + Math.cos(a) * 5, y: pl.y - 4 + Math.sin(a) * 4, angle: a, speed: 300,
      // it starts inside the blade's reach (half damage); WAVE_FLIGHT restores the full damage past it
      damage: full * 0.5, radius: 6, range: reach * SKYSPLIT_RANGE, owner: pl, pierce: 99, knockback: 50,
      color: SKY[3], style: 'sprite', sprite: 'proj_skysplit_wave', spriteRotates: true, light: 26, accel: -260, minSpeed: 150,
    });
    pr.generation = 1;
    pr.mem.skysplit = 1;
    pr.mem.blade = reach;
    pr.mem.full = full;
    pr.mem.scale0 = clamp(reach / 34, 0.85, 1.35);
    pr.scale = pr.mem.scale0;
    pr.addBehavior(WAVE_FLIGHT);
    w.spawn(pr);
    w.sfx('whoosh', { vol: 0.35, pitch: 1.5 });
    proc(w, 'skysplit_sheath', true);
  },
});

// ====================================================================== 장인의 줄 (craftsman_file)
const BRASS = ['#5a3a18', '#8a6028', '#c89848', '#f0d080', '#fff4c0'];
/** Bonus on the own hits of melee / beam / charge weapons, per copy. */
export const FILE_BONUS = 0.1;
const FILE_KINDS = new Set<WeaponKind>(['melee', 'beam', 'charge']);

function fileWeapon(w: World): boolean {
  const d = heldDef(w);
  return !!d && FILE_KINDS.has(d.kind);
}

defineDrawnSprite('icon_craftsman_file', 16, 16, (p) => {
  // a flat file on the "/" diagonal: cross-cut toothed blade, square tip, brass ferrule, wooden handle
  const along = (x: number, y: number) => x - y;
  const across = (x: number, y: number) => x + y;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const a = along(x, y);
      const c = across(x, y);
      if (a >= -2 && a <= 12 && c >= 14 && c <= 17) {
        // the blade: lit upper edge, cross-cut teeth (a dark groove every third step), shaded lower edge
        const groove = (a + 30) % 3 === 0 && c <= 16;
        p.px(x, y, c === 14 ? (groove ? '#8a92a8' : '#eef2f8') : c <= 16 ? (groove ? '#4a5266' : c === 15 ? '#b8c0d2' : '#9aa2b8') : '#5a6278');
      } else if (a >= -5 && a <= -3 && c >= 13 && c <= 18) {
        p.px(x, y, c === 13 ? BRASS[4] : c <= 16 ? BRASS[2] : BRASS[0]);
      } else if (a >= -13 && a <= -6 && c >= 13 && c <= 18 && !(a === -13 && (c === 13 || c === 18))) {
        p.px(x, y, c === 13 ? '#c88a58' : c <= 16 ? '#8a5430' : '#5a3018');
      }
    }
  }
  // grain on the handle
  p.px(3, 12, '#b07a48');
  p.px(5, 11, '#6a3a20');
  // sparks and filings off the tip
  p.px(15, 4, '#ffffff');
  p.px(14, 5, BRASS[4]);
  p.px(12, 6, BRASS[3]);
  p.px(13, 8, BRASS[3]);
  p.px(11, 9, BRASS[2]);
  p.px(15, 7, BRASS[2]);
}, { outline: O });

/** Whetting sparks along the held weapon (cosmetic). */
function fileSparks(w: World, n: number): void {
  const p = w.player;
  const a = p.aim;
  for (let i = 0; i < n; i++) {
    const d = fx.range(5, 16);
    w.particles.spawn({
      x: p.x + Math.cos(a) * d, y: p.y - 5 + Math.sin(a) * d * 0.8, vx: fx.range(-40, 40), vy: -fx.range(20, 60), gravity: 220,
      life: fx.range(0.18, 0.35), colors: ['#ffffff', BRASS[4], BRASS[3]], size: 1, shape: 'pixel', additive: true,
    });
  }
}

defineArtifact({
  id: 'craftsman_file',
  name: '장인의 줄',
  desc: '근접·광선·충전 무기의 피해가 10% 오른다.',
  signature: '전투가 시작되면 무기를 줄로 슥슥 간다',
  quote: '좋은 날은 쓰는 손이 만든다.',
  rarity: 'rare',
  tags: ['clockwork'],
  icon: 'icon_craftsman_file',
  look: { hit: '#ffd890', mote: '#c89848' },
  pools: ['treasure', 'shop', 'challenge'],
  onSwing(w, sw, power) {
    if (!fileWeapon(w)) return;
    amplifySwing(sw, FILE_BONUS * power);
  },
  onShoot(w, p, power) {
    // a charge weapon's own shots (and the waves some melee weapons throw)
    if (!fileWeapon(w) || !p.fromWeapon || p.generation > 0) return;
    amplifyShot(p, FILE_BONUS * power);
  },
  modifyHit(w, _t, hit, power) {
    if (!fileWeapon(w) || !isPrimary(hit)) return;
    // shots and swings carry their bonus already; beams and the weapon's own blasts / shockwaves get it here
    if (hit.source instanceof Projectile || hit.source instanceof MeleeSwing) {
      if (fx.chance(0.35)) fileSparkAt(w, hit);
      proc(w, 'craftsman_file', true);
      return;
    }
    amplify(hit, FILE_BONUS * power);
    if (fx.chance(0.2)) fileSparkAt(w, hit);
    proc(w, 'craftsman_file', true);
  },
  onRoomEnter(w) {
    if (!w.node.cleared) w.vars.__fileHoneT = w.time + 0.35;
  },
  onUpdate(w) {
    const t = w.vars.__fileHoneT ?? 0;
    if (t <= 0 || w.time < t) return;
    w.vars.__fileHoneT = 0;
    if (!fileWeapon(w)) return;
    fileSparks(w, 12);
    w.sfx('clock_ratchet', { vol: 0.35, pitch: 1.5 });
    proc(w, 'craftsman_file');
  },
  draw(w, r) {
    // a brass glint runs up the held weapon now and then
    if (!fileWeapon(w)) return;
    const p = w.player;
    if (!p.alive || p.fall > 0) return;
    const ph = (w.time * 0.7) % 1;
    if (ph > 0.25) return;
    const k = ph / 0.25;
    const d = 6 + k * 12;
    r.rect(Math.round(p.x + Math.cos(p.aim) * d), Math.round(p.y - 5 + Math.sin(p.aim) * d * 0.8), 1, 1, '#fff4c0', 1 - k * 0.6);
  },
});

function fileSparkAt(w: World, hit: HitInfo): void {
  const s = hit.source as { x: number; y: number } | null | undefined;
  const p = w.player;
  const x = s ? s.x : p.x;
  const y = s ? s.y : p.y - 5;
  w.particles.burst(x + (hit.dirX ?? 0) * 6, y + (hit.dirY ?? 0) * 6, { count: 3, speed: [30, 80], life: [0.12, 0.25], colors: ['#ffffff', BRASS[4], BRASS[3]], shape: 'pixel', size: [1, 1], additive: true });
}

// ====================================================================== 교차 문장 (cross_crest)
const CRIM = ['#3a0610', '#801020', '#c81c30', '#ff4a5a', '#ffb0b8'];
/** Cross burst damage (x the keeper's damage) and radius. */
export const CROSS_DMG = 1.8;
const CROSS_R = 22;
/** Share of the burst for the other enemies caught in it (60 % of the keeper's damage). */
export const CROSS_SPLASH = 1 / 3;
/** Seconds after a swap during which the other weapon can trigger marks. */
export const CROSS_WINDOW = 3;
/** A mark lasts this long after the hit that made it. */
const CROSS_MARK_LIFE = 4;
/** One burst per enemy per this many seconds. */
export const CROSS_CD = 3;

const crossKeys = (w: World) => {
  const s = w.player.slot;
  return { kind: `__xcK${s}`, at: `__xcT${s}`, cd: `__xcCd${s}` };
};

/** Kind codes of the held and the holstered weapon when they differ (else null). */
function crossPair(w: World): [number, number] | null {
  const p = w.player;
  const a = Weapons.get(p.weaponId);
  const b = p.weapon2Id ? Weapons.get(p.weapon2Id) : undefined;
  if (!a || !b || a.kind === b.kind) return null;
  return [KIND_CODE[a.kind], KIND_CODE[b.kind]];
}

defineDrawnSprite('icon_cross_crest', 16, 16, (p) => {
  // crossed sword (\) and arrow (/) behind the shield
  p.line(1, 1, 14, 14, '#9aa0b8');
  p.line(2, 1, 15, 14, '#d8dce8');
  p.poly([0, 0, 2.6, 0.4, 0.4, 2.6], '#ffffff');
  p.line(13, 1, 2, 12, '#8a5a30');
  p.poly([12, 0, 15.6, 0, 15.6, 3.6], '#d8dce8');
  p.px(15, 0, '#ffffff');
  p.px(1, 13, '#e8e8f0');
  p.px(2, 14, '#e8e8f0');
  p.px(1, 14, '#b0b0c0');
  // heater shield
  p.poly([3.5, 3, 12.5, 3, 12.5, 8.4, 8, 13.6, 3.5, 8.4], CRIM[1]);
  p.poly([3.5, 3, 8, 3, 8, 13.6, 3.5, 8.4], CRIM[2]);
  p.line(4, 3, 12, 3, '#ffd060');
  p.line(4, 4, 4, 8, '#f0b040');
  p.line(12, 4, 12, 8, '#a06818');
  p.px(8, 13, '#a06818');
  // the gold cross on the shield
  p.line(5.5, 5, 10.5, 10, '#ffd060');
  p.line(10.5, 5, 5.5, 10, '#ffd060');
  p.px(8, 7, '#fff4c0');
  p.px(5, 4, CRIM[4]);
}, { outline: O });

// small crest drawn above marked enemies: dim (swap to use it) and lit (strike now)
for (const lit of [false, true]) {
  defineDrawnSprite(lit ? 'fx_cross_mark_lit' : 'fx_cross_mark', 7, 8, (p) => {
    p.poly([0, 0, 7, 0, 7, 4, 3.5, 8, 0, 4], lit ? CRIM[2] : CRIM[1]);
    p.poly([0, 0, 3.5, 0, 3.5, 8, 0, 4], lit ? CRIM[3] : CRIM[2]);
    p.line(1, 1, 5, 5, lit ? '#fff4c0' : '#c89848');
    p.line(5, 1, 1, 5, lit ? '#fff4c0' : '#c89848');
  }, { outline: '#1a0408' });
}

/** The cross burst: a crimson X slash and a small blast around a marked enemy (the others nearby take a third). */
function crossBurst(w: World, center: Enemy, x: number, y: number, damage: number): boolean {
  const targets = enemiesNear(w, x, y, CROSS_R);
  if (!targets.length || !effectProc(w, () => true)) return false;
  w.spawn(new CrossSlashFx(x, y));
  w.spawn(new RingFx(x, y, CROSS_R, 0.22, CRIM[3], 2));
  w.particles.burst(x, y, { count: 16, speed: [50, 150], life: [0.15, 0.35], colors: ['#ffffff', CRIM[4], CRIM[3], CRIM[2]], shape: 'spark', size: [1, 2], additive: true, light: 5, lightColor: CRIM[3] });
  w.lights.glow(x, y, CROSS_R * 2, CRIM[3], 0.55);
  w.sfx('hit_crit', { vol: 0.5, pitch: 0.8 });
  w.sfx('swing_heavy', { vol: 0.45, pitch: 1.4 });
  w.floatText(x, y - 16, '교차!', CRIM[4], 0.8);
  for (const e of targets) itemHit(w, e, e === center ? damage : damage * CROSS_SPLASH, { from: { x, y }, knockback: 110, kind: 'explosion', procs: ['cross_crest'] });
  return true;
}

class CrossSlashFx extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  constructor(x: number, y: number) {
    super();
    this.x = x;
    this.y = y;
    this.layer = 3;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.age >= 0.26) this.dead = true;
  }

  override draw(r: Renderer): void {
    const t = this.age / 0.26;
    const L = 15 * Math.min(1, t * 4);
    const a = t < 0.5 ? 1 : 1 - (t - 0.5) * 2;
    for (const [dx, dy] of [[1, 1], [1, -1]]) {
      const n = Math.SQRT1_2;
      const x0 = this.x - dx * n * L;
      const y0 = this.y - 4 - dy * n * L;
      const x1 = this.x + dx * n * L;
      const y1 = this.y - 4 + dy * n * L;
      r.pixelLine(x0, y0, x1, y1, CRIM[2], 3, a);
      r.pixelLine(x0, y0, x1, y1, '#ffffff', 1, a);
    }
  }
}

defineArtifact({
  id: 'cross_crest',
  name: '교차 문장',
  desc: '한 무기로 맞힌 적을 무기를 바꿔 다시 맞히면 폭발한다.',
  detail: '종류가 다른 무기 두 개를 들어야 한다.',
  quote: '두 손에 다른 무기, 한 가문의 이름.',
  rarity: 'epic',
  tags: ['blood'],
  icon: 'icon_cross_crest',
  look: { aura: '#c81c30', hit: '#ff8090' },
  pools: ['treasure', 'boss', 'shrine'],
  onHit(w, t, hit, power) {
    if (!(t instanceof Enemy) || !isPrimary(hit)) return;
    const pair = crossPair(w);
    if (!pair) return;
    const p = w.player;
    const since = w.time - p.swapAt;
    // a shot / swing already flying before the last swap belongs to the holstered weapon
    const src = hit.source;
    const old = (src instanceof Projectile || src instanceof MeleeSwing) && src.age > since + 1e-6;
    const kind = old ? pair[1] : pair[0];
    const K = crossKeys(w);
    const e = t;
    const mk = Number(e.mem[K.kind] ?? 0);
    const mt = Number(e.mem[K.at] ?? -99);
    if (!old && mk && mk !== kind && since <= CROSS_WINDOW && w.time - mt <= CROSS_MARK_LIFE && Number(e.mem[K.cd] ?? -99) <= w.time) {
      // a burst held back by the proc interval (several lit crests struck at once) keeps its
      // mark for the next hit instead of silently using it up
      if (crossBurst(w, e, e.x, e.y - 3, dmg(w) * CROSS_DMG * stackMul(power))) {
        e.mem[K.cd] = w.time + CROSS_CD;
        e.mem[K.kind] = 0;
        proc(w, 'cross_crest');
      }
      return;
    }
    e.mem[K.kind] = kind;
    e.mem[K.at] = w.time;
  },
  draw(w, r) {
    const pair = crossPair(w);
    if (!pair) return;
    const p = w.player;
    const K = crossKeys(w);
    const since = w.time - p.swapAt;
    for (const e of w.enemies) {
      if (!e.alive || e.hidden) continue;
      const mk = Number(e.mem[K.kind] ?? 0);
      if (!mk || w.time - Number(e.mem[K.at] ?? -99) > CROSS_MARK_LIFE) continue;
      const ready = mk !== pair[0] && since <= CROSS_WINDOW && Number(e.mem[K.cd] ?? -99) <= w.time;
      const top = e.y - e.z - e.r * 2 - 9;
      if (ready) {
        const bob = Math.sin(w.time * 14) * 1;
        r.sprite('fx_cross_mark_lit', e.x, top + bob, { sx: 1.15, sy: 1.15 });
        r.pixelRing(e.x, e.y - e.z - 3, e.r + 3 + Math.sin(w.time * 10), CRIM[3], 1, 0.6);
      } else r.sprite('fx_cross_mark', e.x, top, { alpha: 0.85 });
    }
  },
});

// ====================================================================== 강철 맥박 (steel_pulse)
const STEEL = ['#2a3448', '#4a5a78', '#8a9ab8', '#c8d4e8', '#ffffff'];
const BOLT = '#ffe95a';
/** Pulse cap, shock per pulse (x the keeper's damage) and the half-width of the shocked dash path. */
export const PULSE_MAX = 3;
export const PULSE_DMG = 0.4;
/** Seconds between two gained pulses (the heartbeat's rhythm). */
export const PULSE_GAP = 0.7;
const PULSE_PATH = 14;

function pulseWeapon(w: World): boolean {
  const d = heldDef(w);
  return !!d && (d.kind === 'melee' || d.kind === 'charge');
}

defineDrawnSprite('icon_steel_pulse', 16, 16, (p) => {
  // riveted steel heart, lit from the upper left
  p.stamp(0, 0, [
    '................',
    '...efe....edd...',
    '..effed..eedcc..',
    '.eeeedd..dddccb.',
    '.eeedddddddcccb.',
    '.eedddddddcccbb.',
    '.edddrddddccrbb.',
    '.ddddddddcccbbb.',
    '..dddddcccccbb..',
    '...ddddccccbb...',
    '....dddcccbb....',
    '.....ddcccb.....',
    '......dccb......',
    '.......cb.......',
    '................',
    '................',
  ], { f: STEEL[4], e: STEEL[3], d: STEEL[2], c: STEEL[1], b: STEEL[0], r: STEEL[0] });
  // the heartbeat, a jagged bolt across the whole heart
  const pts = [[0, 8], [4, 8], [5, 9], [7, 3], [9, 12], [10, 8], [15, 8]];
  for (let i = 0; i + 1 < pts.length; i++) p.line(pts[i][0], pts[i][1] + 1, pts[i + 1][0], pts[i + 1][1] + 1, '#a06810');
  for (let i = 0; i + 1 < pts.length; i++) p.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], BOLT);
  p.px(7, 3, '#ffffff');
  p.px(9, 12, '#fff6a0');
  p.px(15, 8, '#ffffff');
}, { outline: O });

defineArtifact({
  id: 'steel_pulse',
  name: '강철 맥박',
  desc: '근접·충전 무기로 맞힌 뒤 대시하면 지나간 길에 충격이 터진다.',
  quote: '쇠도 뛴다. 맞을 때마다 더 세게.',
  rarity: 'epic',
  tags: ['storm'],
  icon: 'icon_steel_pulse',
  look: { step: '#ffe95a', aura: '#8a9ab8' },
  pools: ['treasure', 'boss', 'challenge'],
  onAttack(w) {
    if (pulseWeapon(w)) w.vars.__spAtk = (w.vars.__spAtk ?? 0) + 1;
  },
  onHit(w, _t, hit) {
    if (!pulseWeapon(w) || !isPrimary(hit)) return;
    const atk = w.vars.__spAtk ?? 0;
    // one pulse per attack that connects (a crowd or a triple stab still gives one)
    if (w.vars.__spGot === atk) return;
    const n = w.vars.__spN ?? 0;
    if (n >= PULSE_MAX) return;
    // a heartbeat keeps its rhythm: at most one pulse per PULSE_GAP (fast weapons and dash spam)
    if ((w.vars.__spBeat ?? -99) > w.time) return;
    w.vars.__spBeat = w.time + PULSE_GAP;
    w.vars.__spGot = atk;
    w.vars.__spN = n + 1;
    const p = w.player;
    w.sfx('clock_tick', { vol: 0.3, pitch: 1.2 + n * 0.2 });
    w.particles.burst(p.x, p.y - 7, { count: 4 + n * 2, speed: [20, 60], life: [0.12, 0.25], colors: ['#ffffff', BOLT, STEEL[3]], shape: 'spark', size: [1, 1], additive: true });
    if (n + 1 >= PULSE_MAX) w.sfx('charge_ready', { vol: 0.25, pitch: 1.6 });
    proc(w, 'steel_pulse', true);
  },
  onDash(w) {
    const n = w.vars.__spN ?? 0;
    if (n <= 0) return;
    // the dash spends every pulse; the path is struck when it ends
    w.vars.__spN = 0;
    w.vars.__spLoad = n;
    w.vars.__spPend = 1;
    const p = w.player;
    w.vars.__spX0 = p.x;
    w.vars.__spY0 = p.y;
    w.sfx('lightning', { vol: 0.3, pitch: 1.6 });
  },
  onUpdate(w, _dt, power) {
    if (!w.vars.__spPend) return;
    const p = w.player;
    if (p.dashing) {
      if (fx.chance(0.8)) w.particles.spawn({ x: p.x + fx.range(-4, 4), y: p.y - fx.range(2, 10), vx: fx.range(-30, 30), vy: fx.range(-30, 30), drag: 6, life: 0.2, colors: ['#ffffff', BOLT], size: 1, shape: 'spark', additive: true, rot: fx.angle() });
      return;
    }
    w.vars.__spPend = 0;
    const n = w.vars.__spLoad ?? 0;
    w.vars.__spLoad = 0;
    if (n <= 0 || !p.alive) return;
    const x0 = w.vars.__spX0 ?? p.x;
    const y0 = w.vars.__spY0 ?? p.y;
    const x1 = p.x;
    const y1 = p.y;
    const hits = w.enemies.filter((e) => e.alive && !e.hidden && e.vulnerable && e.z < 24 && segDistance(e.x, e.y, x0, y0, x1, y1) <= PULSE_PATH + e.r);
    // the streak along the path shows the shock even when it misses
    w.spawn(new ZapFx(x0, y0 - 5, x1, y1 - 5, { color: BOLT, dur: 0.22, width: 1 + n * 0.5 }));
    if (!hits.length || !effectProc(w, () => true)) return;
    const d = dmg(w) * PULSE_DMG * n * stackMul(power);
    for (const e of hits) {
      w.spawn(new ZapFx(x1, y1 - 5, e.x, e.y - e.z - 4, { color: STEEL[3], dur: 0.18, width: 1 }));
      w.particles.burst(e.x, e.y - e.z - 4, { count: 6 + n * 2, speed: [40, 130], life: [0.12, 0.3], colors: ['#ffffff', BOLT, STEEL[3]], shape: 'spark', size: [1, 2], additive: true, light: 4, lightColor: BOLT });
      itemHit(w, e, d, { from: { x: x1, y: y1 }, knockback: 70 + 20 * n, procs: ['steel_pulse'] });
    }
    w.spawn(new RingFx(x1, y1 - 4, 14 + n * 4, 0.25, BOLT, 2));
    w.sfx('lightning', { vol: 0.35 + 0.1 * n, pitch: 1.1 });
    w.shake(0.06 * n);
    proc(w, 'steel_pulse');
  },
  onRoomEnter(w) {
    // a dash that carried the keeper through a door does not strike across rooms
    w.vars.__spPend = 0;
    w.vars.__spLoad = 0;
  },
  onRemove(w) {
    w.vars.__spN = 0;
    w.vars.__spPend = 0;
  },
  draw(w, r) {
    // stored pulses: a row of three steel diamonds under the keeper, lit ones crackling
    const n = w.vars.__spN ?? 0;
    if (n <= 0) return;
    const p = w.player;
    if (!p.alive || p.fall > 0) return;
    const full = n >= PULSE_MAX;
    const flick = full && Math.floor(w.time * 10) % 2 === 0;
    for (let i = 0; i < PULSE_MAX; i++) {
      const x = Math.round(p.x + (i - 1) * 7);
      const y = Math.round(p.y + 10);
      const lit = i < n;
      r.rect(x - 2, y, 5, 1, '#140c1c');
      r.rect(x, y - 2, 1, 5, '#140c1c');
      r.rect(x - 1, y - 1, 3, 3, '#140c1c');
      r.rect(x - 1, y, 3, 1, lit ? BOLT : STEEL[1]);
      r.rect(x, y - 1, 1, 3, lit ? BOLT : STEEL[1]);
      r.rect(x, y, 1, 1, lit ? (flick ? BOLT : '#ffffff') : STEEL[2]);
    }
    if (full) r.pixelLine(p.x - 7, p.y + 10, p.x + 7, p.y + 10, '#fff6a0', 1, flick ? 0.55 : 0.25);
  },
});

function segDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const l2 = abx * abx + aby * aby;
  const t = l2 > 0 ? clamp(((px - ax) * abx + (py - ay) * aby) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}
