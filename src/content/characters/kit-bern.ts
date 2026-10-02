// 베른's kit — the husky sled-runner swordsman, built around momentum.
//   passive 기세: consecutive hits build stacks (max 5): +7% attack speed and
//     +5% move speed each; they drop one by one after 1.6s without a hit.
//     Deflecting a bullet still feeds the ember gauge (the sentinel's old oath).
//   dash 설원 돌진: a rushing charge that hits and shoves every enemy it passes
//   affinity 근접 무기: +12% damage, +20% knockback with melee weapons

import type { World } from '../../game/world';
import type { AffinityDef, DashDef, PassiveDef } from '../../game/defs';
import { RingFx } from '../../game/effects';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { isAttack, proc, watch } from '../items/lib';
import { O } from './kit';

export const BERN_MAX_STACKS = 5;
/** attack speed / move speed per stack */
export const BERN_STACK_FIRE = 0.07;
export const BERN_STACK_MOVE = 0.05;
/** seconds without a hit before stacks start dropping, and the drop interval */
export const BERN_DECAY_DELAY = 1.6;
export const BERN_DECAY_STEP = 0.4;
/** rush damage (fraction of player damage) and knockback */
export const BERN_RUSH_DMG = 0.9;
export const BERN_RUSH_KNOCK = 240;

const FROST = ['#ffffff', '#e0ecff', '#b8d0ff', '#7896dc'];

// ------------------------------------------------------------------ icons
defineDrawnSprite('icon_bern_passive', 16, 16, (p) => {
  // three stacked chevrons racing right, wind lines behind
  for (let i = 0; i < 3; i++) {
    const x = 3 + i * 3.5;
    const c = ['#7896dc', '#b8d0ff', '#ffffff'][i];
    p.poly([x, 3, x + 4, 8, x, 13, x + 1.6, 8], c);
  }
  p.line(0, 5, 2, 5, '#b8d0ff');
  p.line(0, 11, 2, 11, '#b8d0ff');
  p.px(1, 8, '#e0ecff');
}, { outline: O });

defineDrawnSprite('icon_bern_dash', 16, 16, (p) => {
  // a snow plume behind a charging arrow
  p.poly([2, 8, 11, 2, 11, 6, 15, 8, 11, 10, 11, 14], '#b8d0ff');
  p.poly([4, 8, 10, 4, 10, 7, 13, 8, 10, 9, 10, 12], '#e0ecff');
  p.px(11, 7, '#ffffff');
  p.px(12, 8, '#ffffff');
  p.circle(2, 4, 1.4, '#ffffff');
  p.circle(1.5, 12, 1.2, '#ffffff');
  p.px(4, 2, '#e0ecff');
  p.px(3, 14, '#e0ecff');
}, { outline: O });

/** Current momentum stacks (0..BERN_MAX_STACKS). */
export function momentum(w: World): number {
  return w.vars.__bernStacks ?? 0;
}

function setStacks(w: World, n: number): void {
  w.vars.__bernStacks = n;
  watch(w, 'bernStacks', n);
}

export const BERN_PASSIVE: PassiveDef = {
  name: '기세',
  desc: '연속으로 적중하면 기세가 쌓여 공격·이동 속도가 오른다 (최대 5). 탄환을 쳐내면 등불이 찬다.',
  icon: 'icon_bern_passive',
  look: { aura: '#b8d0ff', hit: '#e0ecff' },
  stats(m, _power, w) {
    const n = w?.vars?.__bernStacks ?? 0;
    if (n <= 0) return;
    m.mulStat('fireRate', 1 + n * BERN_STACK_FIRE);
    m.mulStat('moveSpeed', 1 + n * BERN_STACK_MOVE);
  },
  onHit(w, _t, hit) {
    if (!isAttack(hit)) return;
    w.vars.__bernHitAt = w.time;
    const cur = momentum(w);
    // one stack per attack (a cleave through a crowd is still one swing)
    if (cur >= BERN_MAX_STACKS || w.time - (w.vars.__bernStackAt ?? -99) < 0.12) return;
    w.vars.__bernStackAt = w.time;
    setStacks(w, cur + 1);
    const p = w.player;
    w.sfx('momentum', { vol: 0.35 + 0.06 * cur, pitch: 0.9 + cur * 0.1 });
    w.particles.burst(p.x, p.y - 4, { count: 5 + cur * 2, speed: [30, 90], angle: Math.atan2(-p.vy, -p.vx), spread: 1.4, life: [0.15, 0.35], colors: FROST, size: [1, 2], additive: true });
    if (cur + 1 === BERN_MAX_STACKS) {
      w.spawn(new RingFx(p.x, p.y - 6, 24, 0.3, '#cfe0ff', 2));
      w.floatText(p.x, p.y - 22, '기세 최대!', '#cfe0ff');
      proc(w, 'passive:bern');
    } else proc(w, 'passive:bern', true);
  },
  onUpdate(w, dt) {
    const n = momentum(w);
    if (n <= 0) return;
    const p = w.player;
    if (w.time - (w.vars.__bernHitAt ?? -99) > BERN_DECAY_DELAY && w.time - (w.vars.__bernDropAt ?? -99) > BERN_DECAY_STEP) {
      w.vars.__bernDropAt = w.time;
      setStacks(w, n - 1);
      return;
    }
    // wind streaks peel off the runner while the momentum is up
    if (p.alive && (Math.abs(p.vx) + Math.abs(p.vy) > 30 || p.dashing) && fx.chance(dt * (6 + n * 5))) {
      const back = Math.atan2(-p.vy, -p.vx) + fx.range(-0.5, 0.5);
      w.particles.spawn({ x: p.x + fx.range(-4, 4), y: p.y - 4 + fx.range(-6, 4), vx: Math.cos(back) * 70, vy: Math.sin(back) * 70, life: 0.22, colors: ['#ffffff', '#cfe0ff', '#b8d0ff'], size: 2, sizeEnd: 1, shape: 'spark', rot: back, additive: true });
    }
  },
  onDeflect(w) {
    w.player.addEmber(3.5);
    proc(w, 'passive:bern', true);
  },
  draw(w, r) {
    const n = momentum(w);
    if (n <= 0) return;
    const p = w.player;
    // stack pips above the head; the newest pops and the row pulses at full momentum
    const since = w.time - (w.vars.__bernStackAt ?? -99);
    const pulse = n >= BERN_MAX_STACKS ? 0.8 + 0.2 * Math.sin(w.time * 12) : 1;
    for (let i = 0; i < n; i++) {
      const pop = i === n - 1 && since < 0.2 ? 1 + (1 - since / 0.2) * 0.6 : 1;
      r.sprite('fx_momentum_pip', p.x + (i - (n - 1) / 2) * 6, p.y - 25 - p.z + Math.sin(w.time * 6 + i) * 0.8, { sx: pop, sy: pop, alpha: pulse, additive: n >= BERN_MAX_STACKS });
    }
  },
};

export const BERN_DASH: DashDef = {
  name: '설원 돌진',
  desc: '눈보라처럼 돌진해 지나치는 적을 들이받고 밀쳐낸다.',
  icon: 'icon_bern_dash',
  color: '#cfe0ff',
  sfx: 'rush',
  iframes: 0.08,
  start(w, p) {
    w.particles.burst(p.x, p.y + 3, { count: 12, speed: [30, 90], angle: Math.atan2(-p.dashDY, -p.dashDX), spread: 1.0, life: [0.25, 0.5], colors: ['#ffffff', '#e0ecff', '#b8d0ff'], size: [1, 3], ground: true });
  },
  update(w, p) {
    const d = p.stats.damage * BERN_RUSH_DMG;
    for (const e of w.enemies) {
      if (!e.alive || e.hidden || !e.vulnerable || e.z > 12) continue;
      if ((e.mem.__bernRushAt ?? -99) > w.time - 0.4) continue;
      const rr = p.r + e.r + 6;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      if (dx * dx + dy * dy > rr * rr) continue;
      e.mem.__bernRushAt = w.time;
      // shove sideways-forward so the runner keeps going
      const l = Math.hypot(dx, dy) || 1;
      const kx = (dx / l) * 0.5 + p.dashDX;
      const ky = (dy / l) * 0.5 + p.dashDY;
      const kl = Math.hypot(kx, ky) || 1;
      if (w.applyHit(e, { damage: d, kind: 'melee', attacker: p, dirX: kx / kl, dirY: ky / kl, knockback: BERN_RUSH_KNOCK })) {
        w.sfx('hit_metal', { vol: 0.35, pitch: 1.3, x: e.x });
        w.spawn(new RingFx(e.x, e.y - e.z - 4, 14, 0.2, '#cfe0ff', 2));
        w.particles.burst(e.x, e.y - e.z - 4, { count: 10, speed: [50, 140], angle: Math.atan2(p.dashDY, p.dashDX), spread: 1.2, life: [0.15, 0.3], colors: FROST, size: [1, 2], shape: 'spark', additive: true });
        w.renderer.kick(p.dashDX * 1.5, p.dashDY * 1.5);
      }
    }
  },
};

export const BERN_AFFINITY: AffinityDef = {
  name: '근접 무기',
  desc: '근접 무기를 들면 피해 +12%, 넉백 +20%.',
  kinds: ['melee'],
  stats(m) {
    m.mulStat('damage', 1.12);
    m.mulStat('knockback', 1.2);
  },
};
