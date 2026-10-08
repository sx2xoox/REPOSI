// 니엘's kit — the void pomeranian, built around void echoes.
//   passive 공허 메아리: every 4th attack sends out a void echo (a slow homing
//     orb at 80% damage, pierces one enemy); the child floats over pits and spikes
//   dash 공허 걸음: a short blink that leaves a rift at the origin, which pulls
//     and bites nearby enemies before collapsing
//   affinity 마법 무기: echoes every 2nd attack instead and the echo is a larger,
//     stronger orb (90% damage instead of 80%)

import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { AffinityDef, DashDef, PassiveDef } from '../../game/defs';
import { Entity } from '../../game/entity';
import { Projectile } from '../../game/projectile';
import { RingFx } from '../../game/effects';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { glowSprite } from '../weapons/common';
import { cooldown, proc } from '../items/lib';
import { O } from './kit';

export const NIEL_ECHO_EVERY = 4;
export const NIEL_ECHO_EVERY_AFFINITY = 2;
export const NIEL_ECHO_DMG = 0.8;
/** echo damage with a favoured arcane weapon (the deeper echo) */
export const NIEL_ECHO_DMG_AFFINITY = 0.9;
/** rift: radius, life (s), bite damage (fraction of player damage) and the two bite times */
export const NIEL_RIFT_RADIUS = 20;
export const NIEL_RIFT_LIFE = 0.7;
export const NIEL_RIFT_DMG = 0.6;
const RIFT_BITES = [0.18, 0.48];

const VOID = ['#ffffff', '#ead0ff', '#b070ff', '#4a2a7a'];
// echo glows (normal / deeper echo) compiled up front with the boot warm-up
glowSprite(14, '#9a50ff');
glowSprite(18, '#9a50ff');

// ------------------------------------------------------------------ icons
defineDrawnSprite('icon_niel_passive', 16, 16, (p) => {
  // a void orb and its echo, ripples spreading right
  p.circle(5, 8, 3.6, '#2a1844');
  p.circle(5, 8, 2.4, '#9a50ff');
  p.circle(5.5, 7.5, 1, '#ead0ff');
  p.px(5, 7, '#ffffff');
  p.circle(11, 8, 2.6, '#2a1844');
  p.circle(11, 8, 1.6, '#7c6ac4');
  p.px(11, 8, '#ead0ff');
  p.line(14, 5, 15, 8, '#b070ff');
  p.line(15, 8, 14, 11, '#b070ff');
}, { outline: O });

defineDrawnSprite('icon_niel_dash', 16, 16, (p) => {
  // a dark vertical rift with a violet rim, sparks around it
  p.ellipse(8, 8, 2.6, 6.5, '#1a0e2a');
  p.ellipse(8, 8, 1.6, 5.2, '#2a1844');
  p.px(8, 5, '#9a50ff');
  p.px(8, 8, '#ead0ff');
  p.px(8, 11, '#9a50ff');
  p.px(3, 4, '#b070ff');
  p.px(13, 12, '#b070ff');
  p.px(2, 11, '#ead0ff');
  p.px(14, 3, '#ead0ff');
}, { outline: '#4a2a7a' });

/** Attacks until the next echo with / without a favoured weapon. */
export function echoEvery(w: World): number {
  return w.player.flags.has('affinity') ? NIEL_ECHO_EVERY_AFFINITY : NIEL_ECHO_EVERY;
}

/** Spawn the void echo: a slow homing orb from the keeper toward `angle`. */
export function spawnEcho(w: World, angle: number): Projectile {
  const p = w.player;
  const s = p.stats;
  // 마법 무기: the deeper echo — a larger orb that bites harder
  const deep = p.flags.has('affinity');
  const glow = deep ? 18 : 14;
  const pr = new Projectile({
    team: 'player', x: p.x + Math.cos(angle) * 6, y: p.y - 5 + Math.sin(angle) * 4, angle, speed: 150, damage: s.damage * (deep ? NIEL_ECHO_DMG_AFFINITY : NIEL_ECHO_DMG),
    radius: deep ? 5 : 4, range: Math.max(160, s.range * 1.1), owner: p, pierce: 1, homing: 5, color: '#b070ff', light: deep ? 30 : 24, knockback: 50, z: 7,
    behaviors: [{
      id: 'void_echo',
      update(q, ww, dt) {
        if (fx.chance(dt * 30)) ww.particles.spawn({ x: q.x + fx.range(-2, 2), y: q.y - q.z + fx.range(-2, 2), life: 0.3, colors: ['#ead0ff', '#9a50ff', '#2a1844'], size: 1.5, sizeEnd: 0.5, shape: 'circle', additive: true });
      },
      draw(q, r) {
        r.sprite(glowSprite(glow, '#9a50ff'), q.x, q.y - q.z, { alpha: 0.5 + 0.2 * Math.sin(q.age * 18), additive: true });
      },
    }],
  });
  pr.generation = 1; // an item-made shot: never re-triggers spawn procs
  w.spawn(pr);
  w.sfx('echo', { vol: 0.5, pitch: 0.95 + w.rng.next() * 0.1 });
  w.particles.burst(pr.x, pr.y - pr.z, { count: 8, speed: [20, 60], life: [0.2, 0.4], colors: VOID, size: [1, 2], additive: true });
  proc(w, 'passive:niel', true);
  return pr;
}

export const NIEL_PASSIVE: PassiveDef = {
  name: '공허 메아리',
  desc: '네 번째 공격마다 공허의 메아리가 적을 쫓는다. 발이 땅에 닿지 않아 함정 위를 지난다.',
  icon: 'icon_niel_passive',
  look: { step: '#8a5ad8', aura: '#4a2a7a', mote: '#b070ff' },
  stats(m) {
    m.flag('flying');
  },
  onAttack(w, angle) {
    // counted at the keeper's own cadence: a fast weapon does not call more echoes
    if (!cooldown(w, 'nielEcho', 0.9 / Math.max(0.5, w.player.stats.fireRate))) return;
    const n = (w.vars.__nielAtk ?? 0) + 1;
    if (n >= echoEvery(w)) {
      w.vars.__nielAtk = 0;
      spawnEcho(w, angle);
    } else w.vars.__nielAtk = n;
  },
  draw(w, r) {
    // the echo counter: small void dots filling up beside the keeper's head
    const every = echoEvery(w);
    const n = w.vars.__nielAtk ?? 0;
    if (n <= 0) return;
    const p = w.player;
    for (let i = 0; i < every - 1; i++) {
      const on = i < n;
      r.rect(p.x + 9 + i * 3, p.y - 22 - p.z + Math.sin(w.time * 4 + i) * 0.6, 2, 2, on ? '#b070ff' : '#2a1844', on ? 0.95 : 0.5);
    }
  },
};

/** The rift left behind by 공허 걸음: pulls enemies in and bites twice, then collapses. */
export class VoidRift extends Entity {
  damage: number;
  private bites = 0;
  constructor(x: number, y: number, damage: number) {
    super();
    this.x = x;
    this.y = y;
    this.damage = damage;
    this.r = NIEL_RIFT_RADIUS;
    this.layer = 0;
    this.tileCollide = false;
    this.team = 'player';
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const R = NIEL_RIFT_RADIUS;
    for (const e of w.enemies) {
      if (!e.alive || e.hidden || e.z > 12) continue;
      const dx = this.x - e.x;
      const dy = this.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d > R + e.r + 12 || d < 1) continue;
      e.knock(dx / d, dy / d, 160 * dt);
    }
    while (this.bites < RIFT_BITES.length && this.age >= RIFT_BITES[this.bites]) {
      this.bites++;
      for (const e of w.enemies) {
        if (!e.alive || e.hidden || !e.vulnerable || e.z > 12) continue;
        const dx = e.x - this.x;
        const dy = e.y - this.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d > R + e.r) continue;
        w.applyHit(e, { damage: this.damage, kind: 'explosion', attacker: w.player, dirX: -dx / d, dirY: -dy / d, knockback: 40, noProc: true, light: true });
      }
      w.spawn(new RingFx(this.x, this.y, R, 0.22, '#b070ff', 1));
    }
    if (fx.chance(dt * 40)) {
      const a = fx.angle();
      w.particles.spawn({ x: this.x + Math.cos(a) * R, y: this.y + Math.sin(a) * R * 0.6, vx: -Math.cos(a) * 60, vy: -Math.sin(a) * 40, life: 0.3, colors: ['#ead0ff', '#9a50ff'], size: 1, additive: true });
    }
    if (this.age >= NIEL_RIFT_LIFE) {
      this.dead = true;
      w.sfx('rift', { vol: 0.6, x: this.x });
      w.particles.burst(this.x, this.y, { count: 18, speed: [40, 120], life: [0.2, 0.4], colors: VOID, size: [1, 2], additive: true, light: 5, lightColor: '#9a50ff' });
      w.spawn(new RingFx(this.x, this.y, R * 1.4, 0.3, '#ead0ff', 2));
      w.lights.glow(this.x, this.y, R * 2.5, '#9a50ff', 0.6);
    }
  }

  override draw(r: Renderer): void {
    const t = this.age / NIEL_RIFT_LIFE;
    const open = Math.min(1, this.age / 0.12) * (t > 0.85 ? (1 - t) / 0.15 : 1);
    const R = NIEL_RIFT_RADIUS * open;
    r.circle(this.x, this.y, R * 0.9, '#1a0e2a', 0.75);
    r.ring(this.x, this.y, R, '#9a50ff', 1, 0.8);
    const a = this.age * 9;
    for (let i = 0; i < 3; i++) {
      const ang = a + (i / 3) * Math.PI * 2;
      r.rect(this.x + Math.cos(ang) * R * 0.6 - 1, this.y + Math.sin(ang) * R * 0.6 * 0.6 - 1, 2, 2, '#ead0ff', 0.9);
    }
    r.sprite(glowSprite(10, '#b070ff'), this.x, this.y, { alpha: 0.6 * open, additive: true });
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y, 40, '#9a50ff', { intensity: 0.7 });
  }
}

export const NIEL_DASH: DashDef = {
  name: '공허 걸음',
  desc: '짧게 순간이동하고, 떠난 자리에 적을 끌어당겨 깨무는 공허의 틈을 남긴다.',
  icon: 'icon_niel_dash',
  color: '#b070ff',
  sfx: 'blink',
  blink: true,
  iframes: 0.1,
  start(w, p) {
    w.spawn(new VoidRift(p.dashX0, p.dashY0, p.stats.damage * NIEL_RIFT_DMG));
    w.particles.burst(p.dashX0, p.dashY0 - 6, { count: 12, speed: [30, 90], life: [0.2, 0.4], colors: VOID, size: [1, 2], additive: true });
    w.particles.burst(p.x, p.y - 6, { count: 10, speed: [10, 40], life: [0.15, 0.3], colors: ['#ffffff', '#ead0ff', '#b070ff'], size: [1, 2], additive: true });
    w.spawn(new RingFx(p.x, p.y - 6, 14, 0.25, '#ead0ff', 1));
  },
};

export const NIEL_AFFINITY: AffinityDef = {
  name: '마법 무기',
  desc: '마법 무기를 들면 공허 메아리가 두 번째 공격마다 나오고 더 크고 세진다.',
  tags: ['arcane'],
};
