// Active items (Q). Each one is a small, juicy tool with its own 16x16 icon.
//
//   oil_jar         등잔기름 단지      (10s)  throw a jar of lamp oil: burning pool at the cursor
//   frozen_hand     얼어붙은 초침      (4)    stop time for enemies & their bullets
//   moth_wing       나방 날개 가루     (5s)   blink toward the cursor, dust burst on arrival
//   wisp_whistle    혼불 사냥개 피리   (3)    summon a spirit hound that hunts for 20s
//   rewind_spool    되감는 실타래      (6)    reroll every item pedestal in the room
//   ember_bellows   풀무 가죽부대      (4)    instantly fill the ember gauge
//   sky_lantern     떨어지는 하늘등    (3)    a burning sky lantern crashes on the cursor
//   keeper_map      등불지기의 낡은 지도 (4)  reveal the floor map (secret room too)
//   oath_dagger     맹세의 단검        (1)    pay half a heart: big damage boost for the room
//   ember_hail      불비 주머니        (4)    fire-bombs rain on enemies
//
// Runtime state lives in w.vars (never in shared defs); a global hook ticks the
// time stop and keeps the spirit hound alive across rooms.

import { defineActive, defineGlobalHooks, defaultPrice, Actives, Artifacts, type ItemPool } from '../../game/defs';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { Entity } from '../../game/entity';
import type { Enemy } from '../../game/enemy';
import { Pedestal, itemInfo, type PedestalItem } from '../../game/pickups';
import { EMBER_MAX } from '../../game/player';
import { BeamFx, GroundWarning, RingFx } from '../../game/effects';
import { defineDrawnSprite, definePixelSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';
import { fx } from '../../engine/rng';
import { TAU, clamp, damp, lerp } from '../../engine/math';
import {
  O, Familiar, HazardZone, enemiesNear, itemHit, miniBlast, shout, syncFamiliars, tickTimeStop, timeStop, timeStopped,
} from './lib';

// ====================================================================== shared helpers
/** Clamp a world point to the current room's interior (a few px from the walls). */
function clampToRoom(w: World, x: number, y: number, pad = 8): { x: number; y: number } {
  const rm = w.room;
  return {
    x: clamp(x, rm.interiorX + pad, rm.interiorX + rm.interiorW - pad),
    y: clamp(y, rm.interiorY + pad, rm.interiorY + rm.interiorH - pad),
  };
}

/** Cursor target limited to `maxD` px from the player and clamped to the room. */
function aimPoint(w: World, maxD: number): { x: number; y: number } {
  const p = w.player;
  const m = w.mouseWorld();
  let dx = m.x - p.x;
  let dy = m.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d > maxD) {
    dx *= maxD / d;
    dy *= maxD / d;
  }
  return clampToRoom(w, p.x + dx, p.y + dy);
}

/** Reveal every room of the floor (secret room included) + hidden doors here. Returns false if nothing new. */
export function revealFloorMap(w: World): boolean {
  let changed = 0;
  for (const n of w.map.nodes) if (!n.discovered) {
    n.discovered = true;
    changed++;
  }
  if (!w.flags.has('mapRevealSecret')) {
    w.flags.add('mapRevealSecret');
    changed++;
  }
  for (const d of w.room.doors) if (d.state === 'hidden') {
    w.revealSecretDoor(d);
    changed++;
  }
  if (!changed) return false;
  w.mapVersion++;
  w.sfx('secret_found', { vol: 0.6 });
  w.sfx('ui_open', { vol: 0.5 });
  w.renderer.screenFlash('#ffe8b0', 0.12);
  const p = w.player;
  w.spawn(new RingFx(p.x, p.y - 6, 60, 0.5, '#ffe0a0', 2));
  w.particles.burst(p.x, p.y - 8, { count: 22, speed: [30, 110], life: [0.4, 0.8], colors: ['#fff8e0', '#ffe0a0', '#c8a060'], size: [1, 2], drag: 2 });
  shout(w, '지도가 밝혀졌다', '#ffe0a0');
  return true;
}

/** Something falling from the sky onto (x, y): floor telegraph + falling sprite, then `onLand`. */
class SkyDrop extends Entity {
  fall: number;
  sprite: string;
  color: string;
  drift: number;
  height: number;
  spin: number;
  onLand: (w: World, x: number, y: number) => void;
  constructor(x: number, y: number, o: { fall: number; sprite: string; color: string; drift?: number; height?: number; spin?: number; onLand: (w: World, x: number, y: number) => void }) {
    super();
    this.x = x;
    this.y = y;
    this.fall = o.fall;
    this.sprite = o.sprite;
    this.color = o.color;
    this.drift = o.drift ?? 30;
    this.height = o.height ?? 160;
    this.spin = o.spin ?? 0;
    this.onLand = o.onLand;
    this.layer = 2;
    this.tileCollide = false;
  }

  private get t(): number {
    return clamp(this.age / this.fall, 0, 1);
  }

  private get pos(): { x: number; y: number } {
    const t = this.t;
    return { x: this.x + this.drift * (1 - t), y: this.y - this.height * (1 - t * t) };
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const { x, y } = this.pos;
    if (fx.chance(dt * 45)) {
      w.particles.spawn({ x: x + fx.range(-1.5, 1.5), y: y + 2, vx: fx.range(-8, 8), vy: -fx.range(10, 30), life: fx.range(0.2, 0.4), colors: ['#ffffff', '#ffe080', this.color, '#802010'], size: fx.range(1, 2), sizeEnd: 0, additive: true });
    }
    if (this.age >= this.fall) {
      this.dead = true;
      this.onLand(w, this.x, this.y);
    }
  }

  override draw(r: Renderer): void {
    const t = this.t;
    const { x, y } = this.pos;
    r.shadow(this.x, this.y, 4 + 10 * t, 2 + 3 * t, 0.15 + 0.3 * t);
    r.sprite(this.sprite, x, y, { rot: this.spin ? this.age * this.spin : Math.sin(this.age * 9) * 0.15 });
  }

  override light(w: World): void {
    const { x, y } = this.pos;
    w.lights.add(x, y, 26, this.color, { intensity: 0.8 });
  }
}

function skyDrop(w: World, x: number, y: number, radius: number, o: ConstructorParameters<typeof SkyDrop>[2]): void {
  w.spawn(new GroundWarning(x, y, radius, o.fall, undefined, o.color));
  w.spawn(new SkyDrop(x, y, o));
}

// ====================================================================== 1. 등잔기름 단지 (oil jar)
defineDrawnSprite('icon_act_oil_jar', 16, 16, (p) => {
  const clay = '#b0643a';
  p.ellipse(8, 10.5, 5.5, 4.5, clay);
  p.rect(6, 4, 4, 4, clay);
  p.rect(5, 4, 6, 2, '#c87a48');
  p.shadeSphere(7.5, 9.5, 6, 6, ramp(clay, 4));
  // paper label band + oil stain
  p.rect(3, 10, 10, 2, '#e0c890');
  p.rect(3, 11, 10, 1, '#b89a60');
  p.px(7, 10, '#c03030');
  p.px(8, 10, '#c03030');
  p.px(11, 13, '#3a2416');
  p.px(11, 14, '#3a2416');
  p.px(5, 7, '#ffd0a0');
  // rag wick + flame
  p.rect(7, 2, 2, 2, '#e8dcc0');
  p.ellipse(8, 1.5, 1.5, 1.5, '#ff9a30');
  p.px(8, 1, '#fff4b0');
}, { outline: O });

defineDrawnSprite('fx_oil_jar', 7, 8, (p) => {
  p.ellipse(3.5, 5, 3, 2.6, '#b0643a');
  p.rect(2, 1, 3, 2, '#c87a48');
  p.shadeSphere(3.5, 4.5, 3.2, 3.2, ramp('#b0643a', 3));
  p.px(3, 0, '#ffb040');
}, { outline: O });

/** The thrown jar: arcs from the player to the target and shatters into fire. */
class OilJar extends Entity {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  dur: number;
  constructor(sx: number, sy: number, tx: number, ty: number) {
    super();
    this.sx = this.x = sx;
    this.sy = this.y = sy;
    this.tx = tx;
    this.ty = ty;
    this.dur = clamp(Math.hypot(tx - sx, ty - sy) / 260, 0.22, 0.5);
    this.tileCollide = false;
    this.layer = 1;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const t = clamp(this.age / this.dur, 0, 1);
    this.x = lerp(this.sx, this.tx, t);
    this.y = lerp(this.sy, this.ty, t);
    this.z = 6 + Math.sin(Math.PI * t) * 30 - t * 6;
    if (fx.chance(dt * 30)) w.particles.spawn({ x: this.x, y: this.y - this.z - 4, vy: -15, life: 0.25, colors: ['#fff0a0', '#ff9a30'], size: 1, additive: true });
    if (t >= 1) {
      this.dead = true;
      shatterOil(w, this.tx, this.ty);
    }
  }

  override draw(r: Renderer): void {
    r.shadow(this.x, this.y, 7, 3, 0.3);
    r.sprite('fx_oil_jar', this.x, this.y - this.z, { rot: this.age * 14 });
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - this.z, 18, '#ffa040', { intensity: 0.6 });
  }
}

function shatterOil(w: World, x: number, y: number): void {
  const dmg = w.player.stats.damage;
  w.sfx('pot_break', { vol: 0.7, pitch: 1.2 });
  w.sfx('fire', { vol: 0.8 });
  w.shake(0.25);
  w.particles.burst(x, y - 2, { count: 10, speed: [40, 110], life: [0.3, 0.6], colors: ['#c87a48', '#8a4a28', '#e0c890'], size: [1, 2], gravity: 320, vz: [40, 110] });
  w.particles.burst(x, y - 2, { count: 26, speed: [30, 130], life: [0.25, 0.6], colors: ['#ffffff', '#fff0a0', '#ffb040', '#ff5020'], size: [1, 3], sizeEnd: 0, additive: true, light: 6, lightColor: '#ff9040' });
  w.decal(x, y, '#1a1008', 16, 0.55);
  w.lights.glow(x, y, 70, '#ff9040', 0.8);
  for (const e of enemiesNear(w, x, y, 22)) itemHit(w, e, dmg * 1.2, { from: { x, y }, knockback: 70, statuses: [{ kind: 'burn', duration: 3, power: dmg * 0.4 }], kind: 'other' });
  const burn = [{ kind: 'burn' as const, duration: 2, power: dmg * 0.3 }];
  const tick = Math.max(3, dmg * 0.45);
  HazardZone.add(w, new HazardZone(w, x, y, 'fire', { radius: 24, life: 6, tick: 0.35, damage: tick, statuses: burn }), 8);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + fx.range(-0.4, 0.4);
    HazardZone.add(w, new HazardZone(w, x + Math.cos(a) * 13, y + Math.sin(a) * 8, 'fire', { radius: 12, life: 5.5 + i * 0.3, tick: 0.35, damage: tick, statuses: burn }), 8);
  }
}

defineActive({
  id: 'oil_jar',
  name: '등잔기름 단지',
  desc: '조준한 곳에 기름 단지를 던져 불바다를 만든다',
  quote: '불은 기름을 탓하지 않는다.',
  rarity: 'common',
  icon: 'icon_act_oil_jar',
  pools: ['treasure', 'shop'],
  charge: 10,
  timed: true,
  use(w) {
    const p = w.player;
    const t = aimPoint(w, 130);
    w.spawn(new OilJar(p.x, p.y - 4, t.x, t.y));
    w.sfx('whoosh', { vol: 0.6, pitch: 1.3 });
  },
});

// ====================================================================== 2. 얼어붙은 초침 (time stop)
defineDrawnSprite('icon_act_frozen_hand', 16, 16, (p) => {
  p.ring(8, 2, 1.6, 1, '#a8b0c0');
  p.rect(7, 3, 2, 2, '#d8dce8');
  p.circle(8, 9.5, 5.6, '#a8b4c8');
  p.shadeSphere(8, 9.5, 5.6, 5.6, ramp('#a8b4c8', 4));
  p.circle(8, 9.5, 4, '#e8f4ff');
  p.shadeSphere(8, 9.5, 4, 4, ['#b8d0e8', '#d8ecff', '#f4faff']);
  // ticks
  p.px(8, 6, '#304060');
  p.px(11, 9, '#304060');
  p.px(8, 13, '#304060');
  p.px(4, 9, '#304060');
  // hands (the red second hand is stuck)
  p.line(8, 9, 8, 7, '#203048');
  p.line(8, 10, 10, 12, '#d02838');
  p.px(8, 9, '#203048');
  // frost creeping over the case
  p.poly([1, 14, 4, 11, 6, 13, 3, 15], '#bfefff');
  p.px(3, 13, '#ffffff');
  p.px(12, 5, '#ffffff');
  p.px(13, 4, '#bfefff');
  p.px(14, 6, '#bfefff');
}, { outline: O });

defineActive({
  id: 'frozen_hand',
  name: '얼어붙은 초침',
  desc: '3.5초 동안 적과 적 탄환의 시간을 멈춘다',
  quote: '째깍, 그리고 아무 소리도.',
  rarity: 'rare',
  icon: 'icon_act_frozen_hand',
  pools: ['treasure', 'shop', 'secret'],
  charge: 4,
  use(w) {
    if (timeStopped(w)) return false;
    timeStop(w, 3.5, 0.02);
    const p = w.player;
    w.spawn(new RingFx(p.x, p.y - 6, 140, 0.6, '#c8d8ff', 2));
    w.particles.burst(p.x, p.y - 8, { count: 30, speed: [40, 160], life: [0.3, 0.7], colors: ['#ffffff', '#c8e8ff', '#8ab0ff'], size: [1, 2], shape: 'spark', drag: 2 });
    shout(w, '시간 정지', '#c8d8ff');
  },
});

// ====================================================================== 3. 나방 날개 가루 (blink)
definePixelSprite('icon_act_moth_wing', {
  a: '#d8c0f0', b: '#9a78c8', c: '#6a4a98', d: '#3e2a62', e: '#ffe8a0', k: '#2a1a30', s: '#fff8ff',
}, [
  '................',
  '....k......k....',
  '.....k....k.....',
  '.aab..k..k..baa.',
  'abbbb.kkkk.bbbba',
  'abekbbkkkkbbkeba',
  'abkkbbkkkkbbkkba',
  '.bbbbbkkkkbbbbb.',
  '..cbbbkkkkbbbc..',
  '...cccdkkdccc...',
  '..bbccdkkdccbb..',
  '.bbcccdkkdcccbb.',
  '.bccd..kk..dccb.',
  '..dd...kk...dd..',
  '.s......k.....s.',
  '................',
], { outline: O });

defineActive({
  id: 'moth_wing',
  name: '나방 날개 가루',
  desc: '조준한 곳으로 순간이동하고, 도착 지점의 적을 밀쳐낸다',
  quote: '빛을 향해, 단숨에.',
  rarity: 'rare',
  icon: 'icon_act_moth_wing',
  pools: ['treasure', 'secret'],
  charge: 5,
  timed: true,
  use(w) {
    const p = w.player;
    const t = aimPoint(w, 120);
    const dest = w.room.nearestFree(t.x, t.y, p.r + 1);
    if (Math.hypot(dest.x - p.x, dest.y - p.y) < 8) {
      w.sfx('ui_error', { vol: 0.5 });
      return false;
    }
    const dust = ['#fff8ff', '#e0c8ff', '#b090e0', '#6a4a98'];
    w.particles.burst(p.x, p.y - 6, { count: 18, speed: [20, 80], life: [0.3, 0.6], colors: dust, size: [1, 2], drag: 3, additive: true });
    w.spawn(new BeamFx(p.x, p.y - 6, dest.x, dest.y - 6, 3, '#b090e0', 0.18, '#ffffff'));
    const steps = 8;
    for (let i = 1; i < steps; i++) {
      const k = i / steps;
      w.particles.spawn({ x: lerp(p.x, dest.x, k), y: lerp(p.y, dest.y, k) - 6, vx: fx.range(-10, 10), vy: fx.range(-10, 10), life: fx.range(0.3, 0.5), colors: dust, size: 2, sizeEnd: 0, additive: true });
    }
    p.x = dest.x;
    p.y = dest.y;
    p.vx = p.vy = p.kbx = p.kby = 0;
    p.invuln = Math.max(p.invuln, 0.4);
    p.squash(1.3, 0.75);
    w.sfx('teleport', { vol: 0.7, pitch: 1.2 });
    w.spawn(new RingFx(dest.x, dest.y - 4, 30, 0.3, '#e0c8ff', 2));
    w.particles.burst(dest.x, dest.y - 6, { count: 22, speed: [40, 120], life: [0.3, 0.6], colors: dust, size: [1, 2], drag: 2, additive: true, light: 4, lightColor: '#b090e0' });
    const dmg = p.stats.damage;
    for (const e of enemiesNear(w, dest.x, dest.y, 26)) itemHit(w, e, dmg * 1.5, { from: dest, knockback: 220, statuses: [{ kind: 'stun', duration: 0.6 }] });
  },
});

// ====================================================================== 4. 혼불 사냥개 피리 (spirit hound)
definePixelSprite('icon_act_wisp_whistle', {
  a: '#fff8e8', b: '#e0d4b8', c: '#a89470', h: '#3a2a20', g: '#d09040', d: '#8a7458',
  w: '#6ad8c8', f: '#d8fffa', x: '#2e8f98', y: '#4fb8c8',
}, [
  '................',
  '...w............',
  '..wfw...........',
  '..wfx...........',
  '.wffxw.....aah..',
  '.wfffx....abbbc.',
  '.xfffy...abhbbc.',
  '..xyy...abbbbc..',
  '.......abbhbc...',
  '......abbbbc....',
  '.....abbbcc.....',
  '....gbbbc.......',
  '...dggbc........',
  '..ddgcc.........',
  '..ddd...........',
  '................',
], { outline: O });

const HOUND = { a: '#d8fff4', b: '#74dccb', c: '#2e8f98', e: '#ffffff', f: '#c8fff8', g: '#4fb8c8' };
const HOUND_TOP = [
  '............a...',
  '...........aba..',
  '..........abbbb.',
  'gf........bbebbb',
  '.gf......abbbbbc',
  '..gf.aaaabbbbcc.',
  '...abbbbbbbbbc..',
  '...bbbbbbbbbbc..',
  '...cbbccccbbcc..',
];
definePixelSprite('fam_wisp_hound_0', HOUND, [...HOUND_TOP, '...bc......bc...', '..bc........bc..'], { outline: O });
definePixelSprite('fam_wisp_hound_1', HOUND, [...HOUND_TOP, '....bc....bc....', '....bc....bc....'], { outline: O });

const HOUND_TIME = 20;

/** Ghostly hound that hunts the nearest enemy and bites it. */
class WispHound extends Familiar {
  face = 1;
  target: Enemy | null = null;
  retarget = 0;
  runT = 0;
  biteT = 0;
  constructor(w: World) {
    super(w);
    this.z = 0;
    this.x += fx.range(-10, 10);
    this.y += fx.range(4, 10);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const p = w.player;
    this.retarget -= dt;
    if (this.retarget <= 0 || (this.target && !this.target.alive)) {
      this.target = w.nearestEnemy(this.x, this.y, 240);
      this.retarget = 0.35;
    }
    let tx: number;
    let ty: number;
    let speed: number;
    if (this.target && this.target.alive) {
      tx = this.target.x;
      ty = this.target.y;
      speed = 155;
    } else {
      const side = this.slot % 2 ? 1 : -1;
      tx = p.x + side * (16 + this.slot * 8);
      ty = p.y + 6;
      speed = 120;
    }
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const s = Math.min(speed, d * 6);
    this.vx = damp(this.vx, (dx / d) * s, 9, dt);
    this.vy = damp(this.vy, (dy / d) * s, 9, dt);
    const c = clampToRoom(w, this.x + this.vx * dt, this.y + this.vy * dt, 6);
    this.x = c.x;
    this.y = c.y;
    if (Math.abs(this.vx) > 6) this.face = this.vx > 0 ? 1 : -1;
    this.runT += dt * (Math.hypot(this.vx, this.vy) / 18);
    if (this.biteT > 0) this.biteT -= dt;
    const bitten = this.contact(w, 7, p.stats.damage * 1.3 * (1 + (this.power - 1) * 0.3), 0.4);
    if (bitten.length) {
      this.biteT = 0.15;
      w.sfx('hit', { vol: 0.4, pitch: 1.4 });
      const e = bitten[0];
      w.particles.burst(e.x, e.y - 4, { count: 8, speed: [30, 90], life: [0.15, 0.35], colors: ['#ffffff', '#c8fff8', '#6ad8c8'], size: [1, 2], additive: true });
    }
    if (fx.chance(dt * 22)) {
      w.particles.spawn({ x: this.x - this.face * 7 + fx.range(-1, 1), y: this.y - 7 + fx.range(-1, 1), vx: -this.face * fx.range(10, 25), vy: -fx.range(5, 20), life: fx.range(0.25, 0.5), colors: ['#ffffff', '#c8fff8', '#4fb8c8'], size: fx.range(1, 2), sizeEnd: 0, additive: true });
    }
  }

  override draw(r: Renderer, w: World): void {
    const left = (w.vars.__houndEnd ?? 0) - w.time;
    const flicker = left < 2 && Math.floor(left * 12) % 2 === 0;
    const a = clamp(Math.min(this.age / 0.3, left / 0.4), 0, 1) * (flicker ? 0.45 : 0.9);
    const frame = Math.floor(this.runT) % 2;
    const hop = Math.abs(Math.sin(this.runT * Math.PI)) * 1.5;
    r.shadow(this.x, this.y + 1, 12, 3, 0.25 * a);
    r.sprite(`fam_wisp_hound_${frame}`, this.x, this.y - 6 - hop, { flipX: this.face < 0, alpha: a, flash: this.biteT > 0 ? 0.6 : 0 });
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 6, 26, '#6ad8c8', { intensity: 0.55 });
  }
}

defineActive({
  id: 'wisp_whistle',
  name: '혼불 사냥개 피리',
  desc: '20초 동안 적을 쫓아 무는 혼불 사냥개를 부른다 (다시 불면 한 마리 더)',
  quote: '휘파람 끝에 푸른 발자국.',
  rarity: 'rare',
  icon: 'icon_act_wisp_whistle',
  pools: ['treasure', 'boss'],
  charge: 3,
  use(w) {
    const active = (w.vars.__houndEnd ?? 0) > w.time;
    w.vars.__houndN = active ? Math.min(3, (w.vars.__houndN ?? 1) + 1) : 1;
    w.vars.__houndEnd = w.time + HOUND_TIME;
    const p = w.player;
    w.sfx('summon', { vol: 0.6, pitch: 1.3 });
    w.sfx('orb', { vol: 0.4, pitch: 1.6 });
    w.spawn(new RingFx(p.x, p.y - 4, 34, 0.4, '#6ad8c8', 2));
    w.particles.burst(p.x, p.y - 6, { count: 20, speed: [30, 100], life: [0.3, 0.6], colors: ['#ffffff', '#c8fff8', '#6ad8c8', '#2e8f98'], size: [1, 2], additive: true });
    syncHounds(w);
  },
});

function syncHounds(w: World): void {
  const on = (w.vars.__houndEnd ?? 0) > w.time;
  if (!on && w.vars.__houndN) w.vars.__houndN = 0;
  syncFamiliars(w, 'wisp_hound', on ? w.vars.__houndN ?? 1 : 0, (ww) => new WispHound(ww));
}

// ====================================================================== 5. 되감는 실타래 (reroll pedestals)
defineDrawnSprite('icon_act_rewind_spool', 16, 16, (p) => {
  // thread body
  p.rect(4, 4, 8, 8, '#c83848');
  p.shadeSphere(7, 7, 6, 6, ramp('#c83848', 4));
  for (let y = 5; y < 12; y += 2) p.line(4, y, 11, y, '#8a1c30');
  p.px(5, 4, '#ff90a0');
  p.px(6, 4, '#ff90a0');
  // wooden flanges
  p.rect(2, 2, 12, 2, '#c08a50');
  p.rect(2, 12, 12, 2, '#c08a50');
  p.line(2, 3, 13, 3, '#8a5a30');
  p.line(2, 13, 13, 13, '#8a5a30');
  p.line(3, 2, 12, 2, '#e8b878');
  p.line(3, 12, 12, 12, '#e8b878');
  // loose thread curling backwards (the rewind)
  p.px(12, 7, '#e05060');
  p.px(13, 8, '#e05060');
  p.px(14, 9, '#e05060');
  p.px(14, 10, '#e05060');
  p.px(13, 11, '#e05060');
  p.px(12, 1, '#ffffff');
  p.px(11, 0, '#ffe0a0');
}, { outline: O });

const POOL_OF_ROOM: Record<string, ItemPool> = {
  treasure: 'treasure', shop: 'shop', boss: 'boss', secret: 'secret', curse: 'curse', challenge: 'challenge', shrine: 'shrine',
};

function priceFor(it: PedestalItem): number {
  const base = it.kind === 'artifact' ? Artifacts.get(it.id)?.price : it.kind === 'active' ? Actives.get(it.id)?.price : undefined;
  return base ?? defaultPrice(itemInfo(it).rarity);
}

defineActive({
  id: 'rewind_spool',
  name: '되감는 실타래',
  desc: '이 방의 모든 아이템 받침대를 다른 아이템으로 바꾼다',
  quote: '마음에 들 때까지 다시 감으면 된다.',
  rarity: 'epic',
  icon: 'icon_act_rewind_spool',
  pools: ['secret', 'shop', 'curse'],
  charge: 6,
  use(w) {
    const peds = w.entities.filter((e): e is Pedestal => e instanceof Pedestal && !e.dead && !!e.item);
    if (!peds.length) {
      w.sfx('ui_error', { vol: 0.5 });
      return false;
    }
    const pool = POOL_OF_ROOM[w.node.kind] ?? 'treasure';
    let n = 0;
    for (const ped of peds) {
      const it = ped.item!;
      const kinds: ('artifact' | 'active' | 'weapon')[] = it.kind === 'weapon' ? ['weapon'] : ['artifact', 'active'];
      const exclude = new Set([it.id, 'rewind_spool']);
      const next = w.loot.rollItem(pool, w.run.lootRng, { kinds, exclude }) ?? (pool !== 'treasure' ? w.loot.rollItem('treasure', w.run.lootRng, { kinds, exclude }) : null);
      if (!next) continue;
      ped.item = next;
      if (ped.price > 0) ped.price = priceFor(next);
      ped.spawnFx = 0.5;
      ped.waitForLeave = Math.hypot(ped.x - w.player.x, ped.y - w.player.y) < 20;
      n++;
      w.spawn(new RingFx(ped.x, ped.y - 10, 18, 0.35, '#ff90a0', 2));
      w.particles.burst(ped.x, ped.y - 10, { count: 16, speed: [30, 90], life: [0.3, 0.6], colors: ['#ffffff', '#ffd0d8', '#e05060'], size: [1, 2], additive: true });
    }
    if (!n) {
      w.sfx('ui_error', { vol: 0.5 });
      return false;
    }
    w.sfx('teleport', { vol: 0.6, pitch: 0.8 });
    w.sfx('item_get', { vol: 0.4, pitch: 1.3 });
    w.renderer.screenFlash('#ffd0d8', 0.12);
    shout(w, '다시 감기', '#ff90a0');
  },
});

// ====================================================================== 6. 풀무 가죽부대 (ember fill)
definePixelSprite('icon_act_ember_bellows', {
  a: '#e8b878', b: '#c08a50', c: '#8a5a30', l: '#a86a40', m: '#7a4628', n: '#4e2a18',
  y: '#e8c860', z: '#a08020', f: '#ffb040', g: '#fff0a0', r: '#ff6020',
}, [
  '................',
  '.aab............',
  '.abbbbb.........',
  '..cccccbbb......',
  '..lllllllcc.....',
  '..lmlllmllll....',
  '..lmllmmllllyy.g',
  '..lmllmllllmzzfr',
  '..lmlllmllmmyy.f',
  '..mnmmmnmmmm..r.',
  '..cccccccc......',
  '.abbbbbbb.......',
  '.aab............',
  '.aab............',
  '................',
  '................',
], { outline: O });

defineActive({
  id: 'ember_bellows',
  name: '풀무 가죽부대',
  desc: '불씨 게이지를 즉시 가득 채운다',
  quote: '숨 한 번에 불꽃이 일어선다.',
  rarity: 'rare',
  icon: 'icon_act_ember_bellows',
  pools: ['treasure', 'shop'],
  charge: 4,
  use(w) {
    const p = w.player;
    if (p.ember >= EMBER_MAX) {
      w.sfx('ui_error', { vol: 0.5 });
      return false;
    }
    p.ember = EMBER_MAX;
    p.emberReadyFlash = 1;
    w.sfx('fire', { vol: 0.8, pitch: 0.8 });
    w.sfx('power_up', { vol: 0.6 });
    w.spawn(new RingFx(p.x, p.y - 6, 40, 0.35, '#ffb040', 3));
    // embers rush inward
    for (let i = 0; i < 28; i++) {
      const a = fx.angle();
      const d = fx.range(26, 46);
      const x = p.x + Math.cos(a) * d;
      const y = p.y - 6 + Math.sin(a) * d * 0.7;
      w.particles.spawn({ x, y, vx: (p.x - x) * 2.6, vy: (p.y - 6 - y) * 2.6, life: 0.38, colors: ['#fff0a0', '#ffb040', '#ff6020'], size: fx.range(1, 2), sizeEnd: 0, additive: true });
    }
    w.lights.glow(p.x, p.y - 6, 70, '#ffa040', 0.8);
    shout(w, '불씨 가득!', '#ffb040');
  },
});

// ====================================================================== 7. 떨어지는 하늘등 (meteor)
defineDrawnSprite('icon_act_sky_lantern', 16, 16, (p) => {
  p.poly([3, 2, 13, 2, 11, 12, 5, 12], '#ff7a38');
  p.shadeSphere(8, 6, 6, 7, ramp('#ff7a38', 4));
  p.line(6, 2, 6, 12, '#c84a20');
  p.line(10, 2, 10, 12, '#c84a20');
  p.ellipse(8, 9, 1.8, 2, '#ffe080');
  p.px(8, 9, '#ffffff');
  p.line(3, 2, 12, 2, '#ffd0a0');
  p.rect(5, 12, 6, 1, '#5a2a10');
  p.px(8, 13, '#ffb040');
  p.px(8, 14, '#fff0a0');
  p.px(14, 5, '#ffe080');
  p.px(1, 8, '#ffe080');
}, { outline: O });

defineDrawnSprite('fx_sky_lantern', 9, 12, (p) => {
  p.poly([1, 1, 8, 1, 7, 8, 2, 8], '#ff7a38');
  p.shadeSphere(4.5, 4, 4, 5, ramp('#ff7a38', 3));
  p.ellipse(4.5, 6, 1.5, 1.5, '#fff0a0');
  p.rect(2, 8, 5, 1, '#5a2a10');
  p.ellipse(4.5, 10, 1.2, 1.5, '#ffb040');
}, { outline: O });

defineActive({
  id: 'sky_lantern',
  name: '떨어지는 하늘등',
  desc: '조준한 곳에 불타는 하늘등을 떨어뜨려 폭발시킨다 (바위도 부순다)',
  quote: '소원을 빌었더니 하늘이 대답했다.',
  rarity: 'rare',
  icon: 'icon_act_sky_lantern',
  pools: ['treasure', 'boss'],
  charge: 3,
  use(w) {
    const t = aimPoint(w, 220);
    w.sfx('whoosh', { vol: 0.7, pitch: 0.7 });
    skyDrop(w, t.x, t.y, 38, {
      fall: 0.85, sprite: 'fx_sky_lantern', color: '#ffa040', drift: 36, height: 130,
      onLand(ww, x, y) {
        ww.explode(x, y, 38, 35 + ww.player.stats.damage * 3, { hurtsPlayer: false, color: '#ff8a30' });
        HazardZone.add(ww, new HazardZone(ww, x, y, 'fire', { radius: 16, life: 3, tick: 0.4, damage: Math.max(3, ww.player.stats.damage * 0.35) }), 8);
      },
    });
  },
});

// ====================================================================== 8. 등불지기의 낡은 지도 (map reveal)
defineDrawnSprite('icon_act_keeper_map', 16, 16, (p) => {
  p.rect(2, 3, 12, 10, '#e8d0a0');
  p.shadeVertical(2, 3, 12, 10, ramp('#e0c890', 4));
  p.rect(1, 2, 2, 12, '#c8a868');
  p.rect(13, 2, 2, 12, '#c8a868');
  p.line(1, 2, 1, 13, '#e8d0a0');
  p.line(14, 2, 14, 13, '#8a6a38');
  // rooms + path
  p.rect(4, 5, 2, 2, '#7a5a3a');
  p.rect(7, 5, 2, 2, '#7a5a3a');
  p.rect(7, 8, 2, 2, '#7a5a3a');
  p.px(6, 6, '#a07a50');
  p.px(8, 7, '#a07a50');
  p.px(9, 9, '#a07a50');
  p.px(10, 10, '#a07a50');
  // secret room X
  p.px(11, 9, '#d02838');
  p.px(12, 10, '#d02838');
  p.px(12, 9, '#d02838');
  p.px(11, 10, '#d02838');
  // lantern mark
  p.px(5, 10, '#ffb040');
  p.px(5, 9, '#fff0a0');
}, { outline: O });

defineActive({
  id: 'keeper_map',
  name: '등불지기의 낡은 지도',
  desc: '이 층의 모든 방과 비밀방, 이 방의 숨은 문을 드러낸다',
  quote: '선배 등불지기의 낙서가 빼곡하다.',
  rarity: 'common',
  icon: 'icon_act_keeper_map',
  pools: ['shop', 'treasure'],
  charge: 4,
  use(w) {
    if (!revealFloorMap(w)) {
      w.sfx('ui_error', { vol: 0.5 });
      return false;
    }
  },
});

// ====================================================================== 9. 맹세의 단검 (blood for power)
defineDrawnSprite('icon_act_oath_dagger', 16, 16, (p) => {
  // blade
  p.poly([5, 10, 13, 1, 14, 2, 6, 11], '#c8d0e0');
  p.line(6, 10, 13, 2, '#ffffff');
  p.line(7, 10, 13, 3, '#8890a8');
  p.line(8, 8, 11, 5, '#c02030');
  // guard
  p.line(3, 8, 7, 12, '#e0b040');
  p.line(4, 8, 8, 12, '#a07820');
  // grip + pommel
  p.line(2, 12, 4, 10, '#5a2a3a');
  p.line(3, 12, 4, 11, '#7a3a4a');
  p.circle(1.5, 13.5, 1, '#e02040');
  p.px(1, 13, '#ff90a0');
  // drop of blood
  p.ellipse(11.5, 12, 1.5, 2, '#e02030');
  p.px(11, 10, '#e02030');
  p.px(11, 11, '#ff8090');
}, { outline: O });

defineActive({
  id: 'oath_dagger',
  name: '맹세의 단검',
  desc: '체력 반 칸을 바쳐 이 방에서 공격력 +3, 공격력 x1.3',
  quote: '피로 쓴 맹세는 지워지지 않는다.',
  rarity: 'rare',
  icon: 'icon_act_oath_dagger',
  pools: ['curse', 'secret'],
  charge: 1,
  use(w) {
    const p = w.player;
    // never kills: needs at least one half heart left afterwards
    if (p.red >= 2) p.red -= 1;
    else if (p.soul >= 1 && p.red + p.soul >= 2) p.soul -= 1;
    else {
      w.sfx('ui_error', { vol: 0.5 });
      return false;
    }
    w.items.addBuff({
      key: 'oath_dagger', time: Infinity, until: 'room', label: '피의 맹세', icon: 'icon_act_oath_dagger',
      hooks: {
        stats(m) {
          m.addStat('damage', 3);
          m.mulStat('damage', 1.3);
        },
        onUpdate(ww, dt) {
          const pl = ww.player;
          if (fx.chance(dt * 10)) ww.particles.spawn({ x: pl.x + fx.range(-5, 5), y: pl.y - fx.range(2, 12), vy: -fx.range(10, 25), life: fx.range(0.3, 0.6), colors: ['#ff5060', '#c01828', '#600010'], size: fx.range(1, 2), sizeEnd: 0 });
        },
      },
    });
    w.sfx('splat', { vol: 0.7 });
    w.sfx('power_up', { vol: 0.6, pitch: 0.8 });
    w.shake(0.3);
    w.renderer.screenFlash('#ff2030', 0.2);
    w.decal(p.x, p.y + 2, '#6a0a14', 5, 0.7);
    w.particles.burst(p.x, p.y - 6, { count: 18, speed: [40, 120], life: [0.3, 0.6], colors: ['#ff5060', '#c01828', '#800010'], size: [1, 2], gravity: 300, vz: [40, 100] });
    w.spawn(new RingFx(p.x, p.y - 6, 30, 0.35, '#ff3040', 2));
    shout(w, '피의 맹세', '#ff5060');
  },
});

// ====================================================================== 10. 불비 주머니 (bomb rain)
defineDrawnSprite('icon_act_ember_hail', 16, 16, (p) => {
  p.ellipse(8, 11.5, 5.5, 3.5, '#b09468');
  p.rect(6, 7, 4, 2, '#b09468');
  p.shadeSphere(8, 10, 6, 5, ramp('#b09468', 4));
  p.rect(6, 7, 4, 1, '#c03030');
  p.px(10, 6, '#c03030');
  p.px(11, 5, '#c03030');
  // stitched flame emblem
  p.px(8, 10, '#ffb040');
  p.px(7, 11, '#ff7030');
  p.px(8, 11, '#fff0a0');
  p.px(9, 11, '#ff7030');
  p.px(8, 12, '#ff7030');
  // fire-bombs falling
  p.circle(3.5, 4, 1.6, '#4a4060');
  p.px(3, 3, '#a8a0c0');
  p.px(4, 2, '#ffb040');
  p.px(5, 1, '#fff0a0');
  p.circle(12.5, 3, 1.6, '#4a4060');
  p.px(12, 2, '#a8a0c0');
  p.px(13, 1, '#ffb040');
  p.px(14, 0, '#fff0a0');
  p.px(2, 7, '#ff7030');
  p.px(14, 7, '#ff7030');
  p.px(1, 6, '#ffb040');
}, { outline: O });

defineDrawnSprite('fx_fire_bomb', 7, 8, (p) => {
  p.circle(3.5, 4.5, 2.8, '#3a3048');
  p.shadeSphere(3.5, 4.5, 2.8, 2.8, ['#1e1828', '#3a3048', '#6a6080']);
  p.px(4, 1, '#c8a060');
  p.px(5, 0, '#ffb040');
}, { outline: O });

defineActive({
  id: 'ember_hail',
  name: '불비 주머니',
  desc: '적들의 머리 위로 불씨 폭탄 8개를 쏟아붓는다',
  quote: '오늘의 일기예보: 맑음, 곳에 따라 폭탄.',
  rarity: 'epic',
  icon: 'icon_act_ember_hail',
  pools: ['treasure', 'boss', 'curse'],
  charge: 4,
  use(w) {
    const p = w.player;
    const spots: { x: number; y: number }[] = [];
    const foes = w.rng.shuffle(w.enemies.filter((e) => e.alive && !e.hidden && e.vulnerable));
    for (const e of foes.slice(0, 5)) spots.push(clampToRoom(w, e.x + e.vx * 0.3, e.y + e.vy * 0.3));
    while (spots.length < 8) spots.push(w.room.randomFreePos(w.rng, 8, { x: p.x, y: p.y, dist: 36 }));
    const dmg = p.stats.damage;
    spots.forEach((s, i) => {
      skyDrop(w, s.x, s.y, 22, {
        fall: 0.6 + i * 0.13, sprite: 'fx_fire_bomb', color: '#ff7030', drift: fx.range(-20, 20), height: 170, spin: 8,
        onLand(ww, x, y) {
          miniBlast(ww, x, y, 24, 15 + dmg * 1.6, '#ff7030', [{ kind: 'burn', duration: 2, power: dmg * 0.3 }]);
          ww.shake(0.2);
          ww.decal(x, y, '#140c0c', 8, 0.5);
        },
      });
    });
    w.sfx('whoosh', { vol: 0.7, pitch: 0.6 });
    w.sfx('fuse', { vol: 0.5 });
    shout(w, '불비!', '#ff9040');
  },
});

// ====================================================================== runtime ticker
defineGlobalHooks({
  id: 'actives_runtime',
  onUpdate(w) {
    tickTimeStop(w);
    if (w.vars.__houndEnd !== undefined) syncHounds(w);
  },
  onRoomEnter(w) {
    tickTimeStop(w);
    if (w.vars.__houndEnd !== undefined) syncHounds(w);
  },
  onFloorStart(w) {
    // a fresh floor never starts frozen
    if ((w.vars.__tsEnd ?? 0) > w.time) w.vars.__tsEnd = w.time;
    tickTimeStop(w);
  },
});

