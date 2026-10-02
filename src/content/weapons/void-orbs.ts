// 망령 구슬 (wraith orbs): spectral orbs circle the wielder, grazing whatever
// they touch. Attacking flings the orb nearest the aim; new orbs re-form over
// time (faster with fire rate). More orbs with multishot.

import { defineWeapon, type WeaponState } from '../../game/defs';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import { Projectile, type ProjBehavior } from '../../game/projectile';
import { defineDrawnSprite } from '../../engine/sprites';
import { angleDiff, TAU } from '../../engine/math';
import { O, attackInterval, glowSprite, kick } from './common';

defineDrawnSprite('proj_void_orb', 8, 8, (p) => {
  p.circle(4, 4, 3.8, '#3a2470');
  p.circle(4, 4, 2.8, '#7a50e0');
  p.circle(4.5, 4.5, 1.6, '#d0b0ff');
  p.px(3, 3, '#ffffff');
}, { outline: '#120a24' });

defineDrawnSprite('icon_void_orbs', 16, 16, (p) => {
  p.ring(8, 8, 6.5, 1, '#5a3aa0');
  const orb = (x: number, y: number) => {
    p.circle(x, y, 2.6, '#7a50e0');
    p.circle(x + 0.4, y + 0.4, 1.3, '#d0b0ff');
    p.px(x - 1, y - 1, '#ffffff');
  };
  orb(8, 2.5);
  orb(13, 10);
  orb(3, 10);
  p.circle(8, 8, 1.5, '#1a0e2a');
}, { outline: O });

/** Orbiting orbs per weapon state (entities can't live in WeaponState.mem). */
const ORBS = new WeakMap<WeaponState, Projectile[]>();

/** Max orbs for a multishot count (exported for tests). */
export function maxOrbs(shots: number): number {
  return Math.min(7, 2 + Math.max(1, shots));
}

function orbitBehavior(st: WeaponState): ProjBehavior {
  return {
    id: 'void_orbit',
    update(pr, w) {
      const p = w.player;
      if (pr.mem.flung) {
        if (pr.mem.trail !== undefined && w.time > pr.mem.trail) {
          pr.mem.trail = w.time + 0.03;
          w.particles.spawn({ x: pr.x, y: pr.y - pr.z, life: 0.25, colors: ['#d0b0ff', '#7a50e0', '#3a2470'], size: 2, sizeEnd: 0.5, additive: true });
        }
        return;
      }
      if (p.weaponId !== 'void_orbs' || !p.alive) {
        pr.expire(w, false);
        return;
      }
      const list = ORBS.get(st) ?? [];
      const i = Math.max(0, list.indexOf(pr));
      const n = Math.max(1, list.length);
      const a = w.time * 3.2 + (i / n) * TAU;
      const rad = 15 + Math.sin(w.time * 2 + i) * 1.5;
      pr.x = p.x + Math.cos(a) * rad;
      pr.y = p.y - 2 + Math.sin(a) * rad * 0.75;
      pr.vx = 0;
      pr.vy = 0;
      pr.angle = a + Math.PI / 2;
      // grazing hits: forget victims periodically so the orb can hit again
      if (w.time > (pr.mem.reset ?? 0)) {
        pr.mem.reset = w.time + 0.45;
        pr.hitIds.clear();
      }
    },
    onWall(pr) {
      return !pr.mem.flung;
    },
    draw(pr, r) {
      r.sprite(glowSprite(pr.mem.flung ? 14 : 11, '#9a70ff'), pr.x, pr.y - pr.z, { alpha: 0.45, additive: true });
    },
  };
}

function spawnOrb(w: World, p: Player, st: WeaponState): Projectile {
  const s = p.stats;
  const pr = new Projectile({
    team: 'player', x: p.x, y: p.y - 4, angle: 0, speed: 0, damage: s.damage * 0.45, radius: Math.max(3, s.projSize),
    range: 99999, life: 99999, owner: p, pierce: 999, knockback: 40, color: '#b080ff', style: 'sprite',
    sprite: 'proj_void_orb', spriteRotates: false, light: 14, fromWeapon: true, spectral: p.flags.has('spectral'),
    behaviors: [orbitBehavior(st)],
  });
  pr.z = 6;
  pr.mem.orb = 1;
  w.spawn(pr);
  w.particles.burst(p.x, p.y - 6, { count: 6, speed: [20, 50], life: [0.2, 0.4], colors: ['#d0b0ff', '#7a50e0'], size: [1, 2], additive: true });
  return pr;
}

defineWeapon({
  id: 'void_orbs',
  name: '망령 구슬',
  desc: '주위를 도는 구슬이 닿는 적을 스친다. 공격하면 조준 방향의 구슬을 날려 보낸다.',
  icon: 'icon_void_orbs',
  heldSprite: 'proj_void_orb',
  kind: 'ranged',
  rarity: 'epic',
  tags: ['arcane'],
  pools: ['treasure', 'boss', 'secret'],
  stats(m) {
    m.mulStat('damage', 0.8);
  },
  update(w, p, st, dt, firing, aim) {
    const s = p.stats;
    let list = ORBS.get(st);
    if (!list) {
      list = [];
      ORBS.set(st, list);
    }
    // new room / dead orbs: prune, and re-form instantly after a room change
    const fresh = st.mem.room !== w.node.id;
    st.mem.room = w.node.id;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].dead || fresh) list.splice(i, 1);
    const max = maxOrbs(s.shots);
    if (fresh) {
      for (let i = 0; i < max; i++) list.push(spawnOrb(w, p, st));
      st.mem.regen = 0;
      st.mem.stash = 0;
    } else if ((st.mem.stash ?? 0) > 0) {
      // drawn again after a swap: the orbs that were put away come back
      for (let i = 0; i < Math.min(max, st.mem.stash); i++) list.push(spawnOrb(w, p, st));
      st.mem.stash = 0;
    } else if (list.length < max) {
      st.mem.regen = (st.mem.regen ?? 0) + dt;
      if (st.mem.regen >= attackInterval(p, 1.3)) {
        st.mem.regen = 0;
        list.push(spawnOrb(w, p, st));
        w.sfx('orb', { vol: 0.3, pitch: 1.4 });
      }
    }
    if (!firing || st.cooldown > 0 || !list.length) return;
    // fling the orb closest to the aim direction
    let best = list[0];
    let bd = Infinity;
    for (const o of list) {
      const d = Math.abs(angleDiff(aim, Math.atan2(o.y - (p.y - 2), o.x - p.x)));
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    list.splice(list.indexOf(best), 1);
    st.sinceAttack = 0;
    w.items.onAttack(aim);
    best.mem.flung = 1;
    best.mem.trail = w.time;
    best.angle = aim;
    best.speed = s.shotSpeed * 1.45;
    best.syncVel();
    best.damage = s.damage * 1.5;
    best.pierce = s.pierce + 1;
    best.homing = s.homing + 1.2;
    best.bounce = s.bounce;
    best.range = s.range * 1.3;
    best.traveled = 0;
    best.life = 3;
    best.age = 0;
    best.knockback = s.knockback * 1.4;
    best.hitIds.clear();
    w.items.onShoot(best);
    p.recoil = 2;
    p.lastAttackAt = w.time;
    st.cooldown = attackInterval(p, 0.5);
    kick(w, aim, 0.8);
    w.sfx('orb', { vol: 0.55, pitch: 0.9 });
    w.sfx('whoosh', { vol: 0.25, pitch: 1.6 });
  },
  onHolster(_w, _p, st) {
    const list = ORBS.get(st);
    if (!list) return;
    st.mem.stash = list.filter((o) => !o.dead).length;
    for (const o of list) o.dead = true;
    list.length = 0;
  },
  draw(w, p, r) {
    // no held object: a faint wisp in the casting hand
    const x = p.x + Math.cos(p.aim) * 6;
    const y = p.y - 5 + Math.sin(p.aim) * 5;
    r.sprite(glowSprite(7 + Math.sin(w.time * 9), '#b080ff'), x, y, { alpha: 0.7, additive: true });
  },
});
