// 바위깨기 망치 (rockbreaker hammer): a heavy two-handed maul. Each attack winds
// up for a beat, then slams the ground: a crushing blow in front, a shockwave
// ring that hits everything around the impact, and it smashes rocks and pots.

import { defineWeapon, type WeaponState } from '../../game/defs';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import { Entity } from '../../game/entity';
import { defineDrawnSprite } from '../../engine/sprites';
import { TILE } from '../../game/constants';
import { tileProps } from '../../game/tiles';
import { clamp, dist } from '../../engine/math';
import { O, attackInterval, drawHeld, kick, meleeRest, startSwingPose, swingPose, attackInput, consumeAttack } from './common';

defineDrawnSprite('w_hammer', 20, 11, (p) => {
  p.rect(0, 5, 13, 2, '#8a5a30');
  p.rect(0, 5, 13, 1, '#b07a44');
  p.rect(1, 4, 2, 4, '#4a2a1a');
  p.rect(12, 0, 8, 11, '#6a7088');
  p.rect(13, 1, 6, 9, '#8a92ac');
  p.rect(13, 1, 6, 2, '#c8d0e4');
  p.rect(12, 0, 1, 11, '#4a5068');
  p.rect(19, 0, 1, 11, '#4a5068');
  p.px(15, 5, '#f0c050');
  p.px(16, 5, '#f0c050');
  p.px(15, 6, '#c09030');
}, { outline: O, origin: [2, 6] });

defineDrawnSprite('icon_great_hammer', 16, 16, (p) => {
  p.line(2, 14, 9, 7, '#8a5a30');
  p.line(3, 14, 10, 7, '#b07a44');
  p.poly([6, 4, 11, 0, 15, 5, 11, 9.5], '#8a92ac');
  p.poly([7, 4, 11, 1, 12, 2, 8, 5], '#c8d0e4');
  p.line(11, 9, 15, 5, '#4a5068');
  p.px(11, 5, '#f0c050');
}, { outline: O });

/** Expanding ground ring that hits each enemy once as it passes. */
export class Shockwave extends Entity {
  maxR: number;
  dur: number;
  damage: number;
  hit = new Set<number>();
  color: string;
  constructor(x: number, y: number, maxR: number, damage: number, color = '#ffd8a0', dur = 0.24) {
    super();
    this.x = x;
    this.y = y;
    this.maxR = maxR;
    this.damage = damage;
    this.color = color;
    this.dur = dur;
    this.layer = 0;
    this.tileCollide = false;
  }

  get radius(): number {
    return 4 + (this.maxR - 4) * (1 - Math.pow(1 - clamp(this.age / this.dur, 0, 1), 2));
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const rad = this.radius;
    for (const e of w.enemies) {
      if (!e.alive || e.hidden || e.z > 6 || this.hit.has(e.id)) continue;
      const d = dist(this.x, this.y, e.x, e.y);
      if (d > rad + e.r) continue;
      this.hit.add(e.id);
      const n = d || 1;
      w.applyHit(e, { damage: this.damage, kind: 'melee', attacker: w.player, dirX: (e.x - this.x) / n, dirY: (e.y - this.y) / n, knockback: 160 });
    }
    if (this.age >= this.dur) this.dead = true;
  }

  override draw(r: Renderer): void {
    const t = this.age / this.dur;
    const rad = this.radius;
    r.ring(this.x, this.y, rad, this.color, Math.max(1, 3 * (1 - t)), 0.9 * (1 - t));
    r.ring(this.x, this.y, rad * 0.75, '#ffffff', 1, 0.5 * (1 - t));
  }
}

function slam(w: World, p: Player, st: WeaponState): void {
  const s = p.stats;
  const a = st.mem.windAim ?? p.aim;
  const ix = p.x + Math.cos(a) * 20;
  const iy = p.y - 1 + Math.sin(a) * 15;
  p.swing(w, {
    angle: a, arc: 1.9, reach: 30 + s.range * 0.03, damage: s.damage, knockback: s.knockback * 3.5,
    color: '#ffd8a0', visual: 0.12, duration: 0.07, style: 'none', hitKick: 2.5,
  });
  w.spawn(new Shockwave(ix, iy, 34 + s.range * 0.04, s.damage * 0.55));
  // crack rocks and pots around the impact
  let broke = false;
  for (let ty = Math.floor((iy - 18) / TILE); ty <= Math.floor((iy + 18) / TILE); ty++) {
    for (let tx = Math.floor((ix - 18) / TILE); tx <= Math.floor((ix + 18) / TILE); tx++) {
      if (dist(ix, iy, (tx + 0.5) * TILE, (ty + 0.5) * TILE) > 18) continue;
      const pr = tileProps(w.room.tileAt(tx, ty));
      if (pr.bombable) { w.room.destroyTile(w, tx, ty, 'bomb'); broke = true; }
      else if (pr.breakable) w.room.destroyTile(w, tx, ty, 'shot');
    }
  }
  w.particles.burst(ix, iy, { count: 18, speed: [40, 140], life: [0.3, 0.7], colors: ['#a09080', '#706050', '#d8c8b0'], size: [1, 3], gravity: 300, vz: [40, 120], shape: 'square' });
  w.particles.burst(ix, iy, { count: 10, speed: [10, 50], life: [0.4, 0.9], colors: ['#8a8078', '#5a5048'], size: [2, 4], sizeEnd: 6, drag: 3 });
  w.decal(ix, iy, '#14100c', 7, 0.45);
  w.shake(broke ? 0.45 : 0.32);
  w.hitstop(0.05);
  kick(w, a, 3);
  w.sfx('slam', { vol: 0.9 });
  w.sfx('hit_metal', { vol: 0.4, pitch: 0.6 });
}

defineWeapon({
  id: 'great_hammer',
  name: '바위깨기 망치',
  desc: '느리고 무거운 망치. 내려찍으면 충격파가 퍼지고, 바위와 항아리를 부순다.',
  icon: 'icon_great_hammer',
  heldSprite: 'w_hammer',
  kind: 'melee',
  rarity: 'rare',
  pools: ['treasure', 'boss'],
  stats(m) {
    m.mulStat('damage', 1.75);
    m.mulStat('fireRate', 0.43);
    m.addStat('knockback', 40);
  },
  update(w, p, st, dt, firing, aim) {
    const want = attackInput(st, w, firing);
    if ((st.mem.wind ?? 0) > 0) {
      st.mem.wind -= dt;
      if (st.mem.wind <= 0) slam(w, p, st);
      return;
    }
    if (!want || st.cooldown > 0) return;
    consumeAttack(st);
    st.sinceAttack = 0;
    w.items.onAttack(aim);
    const wind = 0.13;
    st.mem.wind = wind;
    st.mem.windAim = aim;
    const side = Math.cos(aim) >= 0 ? 1 : -1;
    startSwingPose(st, w, aim - side * 2.3, aim + side * 0.15, wind, 0.18);
    st.cooldown = attackInterval(p);
    w.sfx('whoosh', { vol: 0.45, pitch: 0.6 });
  },
  draw(w, p, r, st) {
    const pose = swingPose(st, w, meleeRest(st, p.aim));
    drawHeld(r, p, 'w_hammer', pose.angle, pose.phase === 1 ? 4 : 3);
  },
});
