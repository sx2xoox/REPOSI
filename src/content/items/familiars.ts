// Familiars & orbitals granted by artifacts. All extend lib.Familiar and are
// kept alive per room by syncFamiliars() from the owning artifact's onUpdate.
//
//   GearTurret    (톱니 포탑)      follower, fires bolts at the nearest enemy
//   BallLightning (구전 정령)      follower, zaps enemies with chain lightning
//   MoonSatellite (작은 달)        orbital, blocks bullets + contact damage
//   WinterOrb     (겨울 구슬)      orbital, blocks bullets + chills/freezes
//   MirrorShard   (거울 파편)      orbital, reflects enemy bullets as player shots
//   TwinShadow    (쌍둥이 그림자)  delayed shadow copy that mimics attacks
//   LanternSun    (품 안의 태양)   big orbital: melts bullets, burns everything near it

import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { defineDrawnSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';
import { fx } from '../../engine/rng';
import { TAU, angleTo, damp } from '../../engine/math';
import { Familiar, O, chainLightning, enemiesNear, inflict, zoneDamage } from './lib';

// ====================================================================== sprites
defineDrawnSprite('fam_turret', 12, 11, (p) => {
  // legs
  p.line(2, 10, 4, 7, '#5a3a18');
  p.line(9, 10, 7, 7, '#5a3a18');
  p.line(6, 10, 6, 8, '#5a3a18');
  // body dome
  p.ellipse(6, 5.5, 5, 4, '#d8a850');
  p.shadeSphere(6, 5.5, 5, 4, ramp('#c89848', 4));
  p.rect(1, 6, 10, 2, '#8a5a28');
  p.line(1, 6, 10, 6, '#f0d080');
  // rivets + eye
  p.px(2, 7, '#fff0b0');
  p.px(9, 7, '#fff0b0');
  p.ellipse(6, 4, 1.6, 1.6, '#3a2410');
  p.px(6, 4, '#ff7040');
}, { outline: O });

defineDrawnSprite('fam_turret_barrel', 7, 3, (p) => {
  p.rect(0, 0, 6, 3, '#8a6a3a');
  p.line(0, 0, 5, 0, '#e8c070');
  p.rect(5, 0, 2, 3, '#5a3a18');
}, { outline: O, origin: [0, 1] });

defineDrawnSprite('fam_ball_core', 9, 9, (p) => {
  p.circle(4.5, 4.5, 4.5, '#ffe95a');
  p.shadeSphere(4.5, 4.5, 4.5, 4.5, ['#c08a10', '#ffd030', '#ffef80', '#ffffff'], { dither: false });
  p.circle(3.5, 3.5, 1.4, '#ffffff');
}, { outline: '#3a2a04' });

defineDrawnSprite('fam_moon', 9, 9, (p) => {
  p.circle(4.5, 4.5, 4.5, '#d8d4e8');
  p.shadeSphere(4.5, 4.5, 4.5, 4.5, ['#5a5878', '#9a96b8', '#d8d4e8', '#ffffff']);
  p.px(5, 5, '#8a86a8');
  p.px(6, 5, '#8a86a8');
  p.px(3, 6, '#9a96b8');
  p.px(6, 2, '#b0acc8');
}, { outline: '#1a1430' });

defineDrawnSprite('fam_winter_orb', 9, 9, (p) => {
  p.circle(4.5, 4.5, 4.5, '#9fe8ff');
  p.shadeSphere(4.5, 4.5, 4.5, 4.5, ['#3a88c0', '#6ac8f0', '#bff0ff', '#ffffff']);
  p.line(4, 2, 4, 6, '#ffffff');
  p.line(2, 4, 6, 4, '#ffffff');
  p.px(3, 3, '#ffffff');
  p.px(5, 5, '#ffffff');
}, { outline: '#0c2840' });

defineDrawnSprite('fam_mirror', 7, 10, (p) => {
  p.poly([3.5, 0, 7, 5, 3.5, 10, 0, 5], '#b8d0e8');
  p.poly([3.5, 1.5, 5.5, 5, 3.5, 8.5], '#e8f4ff');
  p.line(2, 4, 3, 2, '#ffffff');
  p.px(2, 6, '#7890b0');
}, { outline: '#141c30' });

defineDrawnSprite('fam_sun_core', 13, 13, (p) => {
  p.circle(6.5, 6.5, 6.5, '#ffd040');
  p.shadeSphere(6.5, 6.5, 6.5, 6.5, ['#d06010', '#ff9a20', '#ffd040', '#fff4a0', '#ffffff']);
  p.circle(5, 5, 2, '#fffbe0');
}, { outline: '#5a1a04' });

defineDrawnSprite('fam_sun_rays', 23, 23, (p) => {
  const c = 11.5;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const long = i % 2 === 0;
    const r0 = 8;
    const r1 = long ? 11.5 : 10;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const nx = -sa * 1.6;
    const ny = ca * 1.6;
    p.poly([c + ca * r0 + nx, c + sa * r0 + ny, c + ca * r1, c + sa * r1, c + ca * r0 - nx, c + sa * r0 - ny], long ? '#ffb030' : '#ff7a20');
  }
});

defineDrawnSprite('proj_shadow_slash', 10, 12, (p) => {
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 10; x++) {
      const d1 = Math.hypot(x - 0, y - 6);
      const d2 = Math.hypot(x + 3, y - 6);
      if (d1 < 9.5 && d2 > 9.5) p.px(x, y, d1 > 8 ? '#e0d0ff' : '#9a6aff');
    }
  }
}, { outline: '#1a0838' });

// ====================================================================== helpers
const dmgOf = (w: World) => w.player.stats.damage;

function orbitPos(f: Familiar, w: World, radius: number, speed: number, phase = 0): { x: number; y: number } {
  const p = w.player;
  const a = w.time * speed + (f.slot / Math.max(1, f.count)) * TAU + phase;
  return { x: p.x + Math.cos(a) * radius, y: p.y - 2 + Math.sin(a) * radius * 0.8 };
}

// ====================================================================== followers
/** Brass turret on little legs that trots behind the player and shoots. */
export class GearTurret extends Familiar {
  cd = 0.5;
  aim = 0;
  hop = 0;
  constructor(w: World) {
    super(w);
    this.z = 0;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const p = w.player;
    // trail behind the player, spaced by slot
    const back = Math.atan2(-(p.vy || 0.01), -(p.vx || 0.01));
    const moving = Math.hypot(p.vx, p.vy) > 10;
    const dist = 16 + this.slot * 12;
    const tx = moving ? p.x + Math.cos(back) * dist : p.x + (this.slot % 2 ? 1 : -1) * (14 + this.slot * 6);
    const ty = moving ? p.y + Math.sin(back) * dist : p.y + 6;
    this.x = damp(this.x, tx, 5, dt);
    this.y = damp(this.y, ty, 5, dt);
    const speed = Math.hypot(tx - this.x, ty - this.y);
    this.hop = speed > 3 ? Math.abs(Math.sin(this.age * 14)) * 2 : 0;
    const e = w.nearestEnemy(this.x, this.y, 170);
    if (e) this.aim = angleTo(this.x, this.y - 5, e.x, e.y - e.z - 3);
    this.cd -= dt;
    if (this.cd <= 0 && e) {
      this.cd = 0.85 / Math.min(2, 1 + (this.power - 1) * 0.25);
      this.shoot(w, this.aim, { damage: dmgOf(w) * 0.55, color: '#ffc860', speed: 260, radius: 2, range: 190 });
      w.sfx('shoot', { vol: 0.25, pitch: 1.5 });
      w.particles.burst(this.x + Math.cos(this.aim) * 8, this.y - 5 + Math.sin(this.aim) * 6, { count: 3, speed: [20, 60], angle: this.aim, spread: 0.6, life: [0.08, 0.18], colors: ['#ffffff', '#ffd080'], size: [1, 1] });
    }
  }

  override draw(r: Renderer): void {
    const y = this.y - this.hop;
    r.shadow(this.x, this.y + 4, 9, 3, 0.3);
    r.sprite('fam_turret', this.x, y - 2);
    r.sprite('fam_turret_barrel', this.x, y - 4, { rot: this.aim, flipY: Math.cos(this.aim) < 0 });
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 4, 16, '#ffc060', { intensity: 0.4 });
  }
}

/** Crackling ball of lightning that drifts near the player and zaps enemies. */
export class BallLightning extends Familiar {
  cd = 0.8;
  driftA = fx.angle();
  arcT = 0;
  arcs: number[] = [];
  constructor(w: World) {
    super(w);
    this.z = 12;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const p = w.player;
    this.driftA += dt * (0.9 + this.slot * 0.3);
    const tx = p.x + Math.cos(this.driftA + this.slot * 2) * 20;
    const ty = p.y - 4 + Math.sin(this.driftA * 1.7 + this.slot) * 10;
    this.x = damp(this.x, tx, 3, dt);
    this.y = damp(this.y, ty, 3, dt);
    this.arcT -= dt;
    if (this.arcT <= 0) {
      this.arcT = 0.06;
      this.arcs = [];
      for (let i = 0; i < 3; i++) {
        const a = fx.angle();
        const l = fx.range(5, 9);
        this.arcs.push(a, l, a + fx.range(-0.8, 0.8));
      }
    }
    this.cd -= dt;
    if (this.cd <= 0) {
      const e = w.nearestEnemy(this.x, this.y, 115);
      if (e) {
        this.cd = 1.35 / Math.min(2, 1 + (this.power - 1) * 0.25);
        chainLightning(w, this.x, this.y - this.z, { jumps: 2, damage: dmgOf(w) * 0.85, range: 115, first: e });
      } else this.cd = 0.2;
    }
  }

  override draw(r: Renderer): void {
    const y = this.y - this.z + Math.sin(this.age * 5) * 1.5;
    r.shadow(this.x, this.y + 3, 7, 3, 0.2);
    r.circle(this.x, y, 7 + Math.sin(this.age * 20) * 0.8, '#ffe95a', 0.18);
    for (let i = 0; i < this.arcs.length; i += 3) {
      const a = this.arcs[i];
      const l = this.arcs[i + 1];
      const b = this.arcs[i + 2];
      const mx = this.x + Math.cos(a) * l * 0.55;
      const my = y + Math.sin(a) * l * 0.55;
      r.line(this.x, y, mx, my, '#fff6b0', 1, 0.9);
      r.line(mx, my, mx + Math.cos(b) * l * 0.5, my + Math.sin(b) * l * 0.5, '#ffe95a', 1, 0.8);
    }
    r.sprite('fam_ball_core', this.x, y, { sx: 1 + Math.sin(this.age * 30) * 0.06, sy: 1 - Math.sin(this.age * 30) * 0.06 });
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - this.z, 34 + Math.sin(this.age * 25) * 3, '#ffe95a', { intensity: 0.75 });
  }
}

// ====================================================================== orbitals
/** Little moon: blocks bullets, bumps enemies. */
export class MoonSatellite extends Familiar {
  override update(w: World, dt: number): void {
    this.age += dt;
    const t = orbitPos(this, w, 21, 2.8);
    this.x = damp(this.x, t.x, 14, dt);
    this.y = damp(this.y, t.y, 14, dt);
    this.blockBullets(w, 5.5);
    const hit = this.contact(w, 5, dmgOf(w) * 0.7, 0.3);
    if (hit.length) w.sfx('hit', { vol: 0.3, pitch: 1.4 });
  }

  override draw(r: Renderer): void {
    r.shadow(this.x, this.y + 6, 6, 2, 0.2);
    r.sprite('fam_moon', this.x, this.y - this.z * 0.5);
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 4, 20, '#c8c8ff', { intensity: 0.45 });
  }
}

/** Ice orb: counter-rotating, blocks bullets, chills and sometimes freezes enemies. */
export class WinterOrb extends Familiar {
  override update(w: World, dt: number): void {
    this.age += dt;
    const t = orbitPos(this, w, 29, -2.1, Math.PI / 3);
    this.x = damp(this.x, t.x, 14, dt);
    this.y = damp(this.y, t.y, 14, dt);
    this.blockBullets(w, 5.5);
    const hit = this.contact(w, 5, dmgOf(w) * 0.45, 0.4, [{ kind: 'slow', duration: 2, power: 0.5 }]);
    for (const e of hit) if (w.rng.chance(0.2)) inflict(w, e, { kind: 'freeze', duration: 1.1 });
    if (fx.chance(dt * 10)) {
      w.particles.spawn({ x: this.x + fx.range(-3, 3), y: this.y - this.z * 0.5 + fx.range(-3, 3), vy: 10, life: 0.5, colors: ['#ffffff', '#bff0ff', '#6ac8f0'], size: 1 });
    }
  }

  override draw(r: Renderer): void {
    r.shadow(this.x, this.y + 6, 6, 2, 0.2);
    r.sprite('fam_winter_orb', this.x, this.y - this.z * 0.5, { rot: Math.sin(this.age * 2) * 0.4 });
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 4, 22, '#9fe8ff', { intensity: 0.5 });
  }
}

/** Mirror shard: reflects enemy bullets back at enemies. */
export class MirrorShard extends Familiar {
  glint = 0;
  override update(w: World, dt: number): void {
    this.age += dt;
    this.glint = Math.max(0, this.glint - dt * 4);
    const t = orbitPos(this, w, 16, 4.2, Math.PI);
    this.x = damp(this.x, t.x, 18, dt);
    this.y = damp(this.y, t.y, 18, dt);
    this.blockBullets(w, 5, (b) => {
      this.glint = 1;
      const e = w.nearestEnemy(this.x, this.y, 220);
      const a = e ? angleTo(this.x, this.y, e.x, e.y - e.z) : b.angle + Math.PI;
      const s = this.shoot(w, a, { damage: dmgOf(w) * 0.9, color: '#d8ecff', speed: Math.max(220, b.speed * 1.6), radius: Math.max(2, b.r), range: 240 });
      s.homing = 3;
    });
  }

  override draw(r: Renderer): void {
    r.shadow(this.x, this.y + 6, 5, 2, 0.2);
    const flip = Math.cos(this.age * 6);
    r.sprite('fam_mirror', this.x, this.y - this.z * 0.5, { sx: Math.max(0.25, Math.abs(flip)), flash: this.glint > 0 ? this.glint : flip > 0.92 ? 0.6 : 0 });
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 4, 14 + this.glint * 20, '#d8ecff', { intensity: 0.5 });
  }
}

/** A delayed shadow copy of the player that repeats every attack. */
export class TwinShadow extends Familiar {
  hist: number[] = [];
  frame = '';
  flip = false;
  constructor(w: World) {
    super(w);
    this.z = 0;
    this.x = w.player.x;
    this.y = w.player.y;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const p = w.player;
    const delay = Math.round((0.16 + this.slot * 0.1) * 60);
    this.hist.push(p.x, p.y);
    while (this.hist.length > delay * 2) this.hist.splice(0, 2);
    const side = this.slot % 2 ? 1 : -1;
    const tx = this.hist[0] + side * 10;
    const ty = this.hist[1] + 2;
    this.x = damp(this.x, tx, 12, dt);
    this.y = damp(this.y, ty, 12, dt);
    this.frame = p.frameName();
    this.flip = p.flip;
    if (fx.chance(dt * 12)) {
      w.particles.spawn({ x: this.x + fx.range(-4, 4), y: this.y - fx.range(0, 12), vy: -12, life: 0.5, colors: ['#9a6aff', '#3a1a70'], size: 1 });
    }
  }

  /** Mimic an attack toward `angle`. */
  mimic(w: World, angle: number, melee: boolean): void {
    const p = w.player;
    if (melee) {
      const s = this.shoot(w, angle, { damage: dmgOf(w) * 0.5, style: 'sprite', sprite: 'proj_shadow_slash', speed: 210, range: 48, radius: 7, pierce: 6, color: '#9a6aff', knockback: 50 });
      s.z = 4;
    } else {
      this.shoot(w, angle, { damage: dmgOf(w) * 0.5, color: '#b08aff', speed: p.stats.shotSpeed, radius: Math.max(2, p.stats.projSize * 0.8), range: p.stats.range * 0.9 });
    }
  }

  override draw(r: Renderer): void {
    if (!this.frame) return;
    r.shadow(this.x, this.y + 4, 10, 3, 0.25);
    r.sprite(this.frame, this.x, this.y + 5, { flipX: this.flip, alpha: 0.72, tint: '#3a1a78', tintAmount: 0.85 });
    // glowing eyes
    const ex = this.x + (this.flip ? -2 : 2) * 0;
    r.rect(ex - 2, this.y - 8, 1, 1, '#d8b8ff', 0.9);
    r.rect(ex + 2, this.y - 8, 1, 1, '#d8b8ff', 0.9);
  }
}

/** The legendary lantern sun: melts bullets, burns and sears enemies near it. */
export class LanternSun extends Familiar {
  auraT = 0;
  override update(w: World, dt: number): void {
    this.age += dt;
    const t = orbitPos(this, w, 36, 1.45);
    this.x = damp(this.x, t.x, 8, dt);
    this.y = damp(this.y, t.y, 8, dt);
    this.z = 10;
    this.blockBullets(w, 10, (b) => {
      w.particles.burst(b.x, b.y, { count: 4, speed: [20, 50], life: [0.15, 0.3], colors: ['#ffffff', '#ffd040', '#ff7020'], size: [1, 2], additive: true });
    });
    this.contact(w, 9, dmgOf(w) * 1.1, 0.35, [{ kind: 'burn', duration: 3, power: dmgOf(w) * 0.5 }]);
    this.auraT -= dt;
    if (this.auraT <= 0) {
      this.auraT = 0.5;
      for (const e of enemiesNear(w, this.x, this.y, 26)) zoneDamage(w, e, dmgOf(w) * 0.25, 'burn', [{ kind: 'burn', duration: 2, power: dmgOf(w) * 0.4 }]);
    }
    if (fx.chance(dt * 30)) {
      const a = fx.angle();
      w.particles.spawn({
        x: this.x + Math.cos(a) * 7, y: this.y - this.z + Math.sin(a) * 7, vx: Math.cos(a) * 25, vy: Math.sin(a) * 25 - 10,
        life: fx.range(0.3, 0.6), colors: ['#ffffff', '#ffe080', '#ff9a30', '#c04010'], size: fx.range(1, 2), additive: true,
      });
    }
  }

  override draw(r: Renderer): void {
    const y = this.y - this.z;
    r.shadow(this.x, this.y + 6, 12, 4, 0.25);
    r.circle(this.x, y, 13 + Math.sin(this.age * 6) * 1, '#ffb030', 0.16);
    r.sprite('fam_sun_rays', this.x, y, { rot: this.age * 0.9, additive: false });
    r.sprite('fam_sun_core', this.x, y, { sx: 1 + Math.sin(this.age * 8) * 0.04, sy: 1 + Math.sin(this.age * 8) * 0.04 });
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - this.z, 78 + Math.sin(this.age * 7) * 4, '#ffc060', { intensity: 0.9 });
    w.lights.glow(this.x, this.y - this.z, 26, '#ffb040', 0.35);
  }
}

